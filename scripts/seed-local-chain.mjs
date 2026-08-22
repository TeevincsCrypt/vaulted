/**
 * Seeds a LOCAL chain with escrows in every interesting state, so the interface can be exercised
 * without waiting on real counterparties. It uses the standard Hardhat development keys and refuses
 * to touch anything but chain 31337.
 *
 * This is development data, not mock data: every escrow below is a real contract call against a
 * real EVM node, and the app reads it back from the chain like any other.
 *
 * Run: node --experimental-strip-types scripts/seed-local-chain.mjs
 */
import { createPublicClient, createWalletClient, http, parseUnits, getAddress, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hardhat } from 'viem/chains'
import { readFileSync } from 'node:fs'
import { generateInvoiceId, invoiceCreationMessage, escrowSalt, detailsHash } from '../lib/vaulted/invoice.ts'

const API = 'http://127.0.0.1:3300'
const RPC = 'http://127.0.0.1:8545'
const dep = JSON.parse(readFileSync(new URL('../contracts/deployments/31337.json', import.meta.url), 'utf8'))
const ABI = dep.abi

const PAYEE = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const PAYER = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
const DEPLOYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

const pub = createPublicClient({ chain: hardhat, transport: http(RPC) })
const payee = createWalletClient({ account: PAYEE, chain: hardhat, transport: http(RPC) })
const payer = createWalletClient({ account: PAYER, chain: hardhat, transport: http(RPC) })
const deployer = createWalletClient({ account: DEPLOYER, chain: hardhat, transport: http(RPC) })

const chainId = await pub.getChainId()
if (chainId !== 31337) throw new Error(`Refusing to seed chain ${chainId}. Local node only.`)

async function fundPayer(amount) {
  const h = await deployer.writeContract({ address: dep.token.address, abi: erc20Abi, functionName: 'transfer', args: [PAYER.address, amount] })
  await pub.waitForTransactionReceipt({ hash: h })
}

async function make({ description, amountHuman, protectionPeriod, open }) {
  const amount = parseUnits(amountHuman, 6)
  const invoiceId = generateInvoiceId()
  const terms = {
    invoiceId, chainId: 31337,
    escrowAddress: getAddress(dep.address), tokenAddress: getAddress(dep.token.address),
    payee: PAYEE.address, payer: open ? '0x0000000000000000000000000000000000000000' : PAYER.address,
    amount: amount.toString(), description, protectionPeriod, fundingDeadline: 0,
  }
  const signature = await payee.signMessage({ message: invoiceCreationMessage(terms) })
  const res = await fetch(`${API}/api/invoices`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...terms, payer: open ? null : PAYER.address, signature }),
  })
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${await res.text()}`)
  const { invoice } = await res.json()

  const hash = await payee.writeContract({
    address: dep.address, abi: ABI, functionName: 'createEscrow',
    args: [terms.payer, amount, protectionPeriod, 0, detailsHash(terms), escrowSalt(invoiceId)],
  })
  await pub.waitForTransactionReceipt({ hash })
  await fetch(`${API}/api/invoices/${invoiceId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ field: 'createTxHash', hash }) })
  return { invoiceId, escrowId: invoice.escrowId, amount }
}

async function fund({ escrowId, invoiceId, amount }) {
  await fundPayer(amount)
  let h = await payer.writeContract({ address: dep.token.address, abi: erc20Abi, functionName: 'approve', args: [dep.address, amount] })
  await pub.waitForTransactionReceipt({ hash: h })
  h = await payer.writeContract({ address: dep.address, abi: ABI, functionName: 'fund', args: [escrowId] })
  await pub.waitForTransactionReceipt({ hash: h })
  await fetch(`${API}/api/invoices/${invoiceId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ field: 'fundTxHash', hash: h }) })
}

const rpc = (method, params = []) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })

const awaiting = await make({ description: 'Brand identity system', amountHuman: '1250', protectionPeriod: 86400, open: false })
const inEscrow = await make({ description: 'Web3 Growth Campaign', amountHuman: '500', protectionPeriod: 86400, open: false })
await fund(inEscrow)
const expired = await make({ description: 'Protocol documentation rewrite', amountHuman: '2400', protectionPeriod: 3600, open: false })
await fund(expired)
const disputed = await make({ description: 'Smart contract audit retainer', amountHuman: '8000', protectionPeriod: 604800, open: false })
await fund(disputed)
let h = await payer.writeContract({ address: dep.address, abi: ABI, functionName: 'dispute', args: [disputed.escrowId, '0x0000000000000000000000000000000000000000000000000000000000000000'] })
await pub.waitForTransactionReceipt({ hash: h })

// Push past the 1 hour window of the third escrow only.
await rpc('evm_increaseTime', [3700])
await rpc('evm_mine')

for (const id of [awaiting.invoiceId, inEscrow.invoiceId, expired.invoiceId, disputed.invoiceId]) {
  const r = await fetch(`${API}/api/invoices/${id}/sync`, { method: 'POST' })
  const b = await r.json()
  console.log(`${id}  ${b.onChain?.status}`)
}
console.log(JSON.stringify({ awaiting: awaiting.invoiceId, inEscrow: inEscrow.invoiceId, expired: expired.invoiceId, disputed: disputed.invoiceId }))
