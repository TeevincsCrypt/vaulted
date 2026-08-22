/**
 * End-to-end check of the whole Vaulted path against a real chain and a real database.
 *
 * Nothing here is stubbed: it signs with real keys, writes real transactions to a local EVM node,
 * and asserts the API's view of each escrow against what the contract actually reports.
 *
 * Prerequisites:
 *   1. cd contracts && npx hardhat node --port 8545
 *   2. cd contracts && TOKEN_ADDRESS=$(npx hardhat run scripts/deploy-dev-token.js --network localhost) \
 *        ARBITER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
 *        npx hardhat run scripts/deploy.js --network localhost
 *   3. DATABASE_URL=... npx prisma db push
 *   4. npm run dev     (with NEXT_PUBLIC_CHAIN_ID=31337)
 *
 * Run: node --experimental-strip-types scripts/e2e-invoice-flow.mjs
 */
import { createPublicClient, createWalletClient, http, parseUnits, getAddress, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hardhat } from 'viem/chains'
import { readFileSync } from 'node:fs'
import { generateInvoiceId, invoiceCreationMessage, escrowSalt, computeEscrowId } from '../lib/vaulted/invoice.ts'

const API = process.env.VAULTED_APP_URL ?? 'http://127.0.0.1:3000'
const RPC = 'http://127.0.0.1:8545'
const dep = JSON.parse(readFileSync(new URL('../contracts/deployments/31337.json', import.meta.url), 'utf8'))
const ABI = dep.abi

// Standard hardhat accounts.
const PAYEE = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') // #1
const PAYER = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a') // #2

const pub = createPublicClient({ chain: hardhat, transport: http(RPC) })
const payeeWallet = createWalletClient({ account: PAYEE, chain: hardhat, transport: http(RPC) })
const payerWallet = createWalletClient({ account: PAYER, chain: hardhat, transport: http(RPC) })

const step = (n, s) => console.log(`\n[${n}] ${s}`)
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return { raw: t.slice(0, 400) } } }
function assert(cond, msg) { if (!cond) { console.error(`   FAIL: ${msg}`); process.exitCode = 1 } else console.log(`   ok: ${msg}`) }

const amount = parseUnits('500', 6)
const invoiceId = generateInvoiceId()
const terms = {
  invoiceId,
  chainId: 31337,
  escrowAddress: getAddress(dep.address),
  tokenAddress: getAddress(dep.token.address),
  payee: PAYEE.address,
  payer: PAYER.address,
  amount: amount.toString(),
  description: 'Web3 Growth Campaign',
  protectionPeriod: 86400,
  fundingDeadline: 0,
}

step(1, `publish invoice ${invoiceId} (signed by payee)`)
const signature = await payeeWallet.signMessage({ message: invoiceCreationMessage(terms) })
let res = await fetch(`${API}/api/invoices`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...terms, payer: terms.payer, signature }),
})
let body = await j(res)
assert(res.status === 201, `created (HTTP ${res.status}) ${res.status !== 201 ? JSON.stringify(body) : ''}`)
const escrowId = body.invoice?.escrowId
assert(escrowId === computeEscrowId({ chainId: 31337, escrowAddress: terms.escrowAddress, payee: PAYEE.address, salt: escrowSalt(invoiceId) }), 'escrow id matches off-chain derivation')

step(2, 'reject a forged invoice signed by the wrong wallet')
const forgedId = generateInvoiceId()
const forgedTerms = { ...terms, invoiceId: forgedId }
const forgedSig = await payerWallet.signMessage({ message: invoiceCreationMessage(forgedTerms) })
res = await fetch(`${API}/api/invoices`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...forgedTerms, signature: forgedSig }),
})
assert(res.status === 401, `forged signature rejected (HTTP ${res.status})`)

step(3, 'GET before the escrow exists on chain')
body = await j(await fetch(`${API}/api/invoices/${invoiceId}`))
assert(body.onChain?.available === false, `chain read reports not-on-chain: "${body.onChain?.reason}"`)
assert(body.verification?.metadataIntact === true, 'stored metadata hashes to the recorded commitment')

step(4, 'payee creates the escrow on chain')
const detailsHash = body.invoice.detailsHash
let hash = await payeeWallet.writeContract({
  address: dep.address, abi: ABI, functionName: 'createEscrow',
  args: [PAYER.address, amount, 86400, 0, detailsHash, escrowSalt(invoiceId)],
})
await pub.waitForTransactionReceipt({ hash })
await fetch(`${API}/api/invoices/${invoiceId}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ field: 'createTxHash', hash }),
})
body = await j(await fetch(`${API}/api/invoices/${invoiceId}/sync`, { method: 'POST' }))
assert(body.onChain?.available === true, 'chain read now available')
assert(body.onChain?.status === 'AWAITING_PAYMENT', `status = ${body.onChain?.status}`)
assert(body.termsMatchChain === true, 'on-chain terms hash matches the link')
assert(body.invoice?.indexedStatus === 'AWAITING_PAYMENT', 'cached status updated')

step(5, 'client approves and funds the escrow')
hash = await payerWallet.writeContract({ address: dep.token.address, abi: erc20Abi, functionName: 'approve', args: [dep.address, amount] })
await pub.waitForTransactionReceipt({ hash })
// The dev token was minted to account #0; move some to the payer first.
const DEPLOYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const depWallet = createWalletClient({ account: DEPLOYER, chain: hardhat, transport: http(RPC) })
hash = await depWallet.writeContract({ address: dep.token.address, abi: erc20Abi, functionName: 'transfer', args: [PAYER.address, amount] })
await pub.waitForTransactionReceipt({ hash })

hash = await payerWallet.writeContract({ address: dep.address, abi: ABI, functionName: 'fund', args: [escrowId] })
const fundReceipt = await pub.waitForTransactionReceipt({ hash })
assert(fundReceipt.status === 'success', `fund tx mined ${hash}`)
body = await j(await fetch(`${API}/api/invoices/${invoiceId}/sync`, { method: 'POST' }))
assert(body.onChain?.status === 'IN_ESCROW', `status = ${body.onChain?.status}`)
assert(body.invoice?.fundedBy?.toLowerCase() === PAYER.address.toLowerCase(), 'funder recorded from chain')
assert(Number(body.onChain?.secondsUntilExpiry) > 86000, `protection window running (${body.onChain?.secondsUntilExpiry}s left)`)

step(6, 'escrow balance is real, held by the contract')
const escrowBalance = await pub.readContract({ address: dep.token.address, abi: erc20Abi, functionName: 'balanceOf', args: [dep.address] })
assert(escrowBalance === amount, `contract holds ${escrowBalance} base units`)

step(7, 'expiry makes the timeout settlement available to anyone')
await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [86401] }) })
await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'evm_mine', params: [] }) })
body = await j(await fetch(`${API}/api/invoices/${invoiceId}/sync`, { method: 'POST' }))
assert(body.onChain?.status === 'EXPIRED', `status = ${body.onChain?.status}`)
assert(body.onChain?.canTimeout === true, 'canTimeout is true')

step(8, 'a third party executes the timeout; funds reach the payee')
const THIRD = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6')
const thirdWallet = createWalletClient({ account: THIRD, chain: hardhat, transport: http(RPC) })
const payeeBefore = await pub.readContract({ address: dep.token.address, abi: erc20Abi, functionName: 'balanceOf', args: [PAYEE.address] })
hash = await thirdWallet.writeContract({ address: dep.address, abi: ABI, functionName: 'executeTimeout', args: [escrowId] })
await pub.waitForTransactionReceipt({ hash })
const payeeAfter = await pub.readContract({ address: dep.token.address, abi: erc20Abi, functionName: 'balanceOf', args: [PAYEE.address] })
assert(payeeAfter - payeeBefore === amount, `payee received ${payeeAfter - payeeBefore} base units from a permissionless call`)
body = await j(await fetch(`${API}/api/invoices/${invoiceId}/sync`, { method: 'POST' }))
assert(body.onChain?.status === 'RELEASED', `status = ${body.onChain?.status}`)

step(9, 'listing by payee')
body = await j(await fetch(`${API}/api/invoices?payee=${PAYEE.address}`))
assert(Array.isArray(body.invoices) && body.invoices.length >= 1, `listed ${body.invoices?.length} invoice(s)`)

console.log(process.exitCode ? '\nINTEGRATION FAILED' : '\nINTEGRATION PASSED')
