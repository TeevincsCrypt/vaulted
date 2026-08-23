/**
 * Pins payment verification on both rails.
 *
 * This is the code that decides whether somebody got paid, so every way of *not* getting paid has
 * to be a case here: the wrong recipient, the wrong asset, too little, a reverted transaction, a
 * signature the network has never heard of. A false positive in this file is money considered
 * received that was not.
 *
 * No network is needed. Both rails talk to a local server speaking the real JSON-RPC shapes —
 * viem's `eth_getTransactionReceipt` with genuine ERC-20 `Transfer` logs, and Solana's
 * `getTransaction` with genuine pre/post token balances.
 *
 * Run: npm run check:payments
 */
import { createServer } from 'node:http'
import { encodeAbiParameters, keccak256, pad, toHex } from 'viem'
import { base, solana } from './helpers/verification-fixtures.ts'
import { verifyPayment } from '../lib/vaulted/server/verify-payment.ts'
import { base58Decode, isSolanaAddress, isSolanaSignature } from '../lib/vaulted/solana.ts'

let failures = 0
const section = (title) => console.log(`\n${title}`)
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
}

/* ------------------------------------------------------------------- fixtures */

const TRANSFER_TOPIC = keccak256(new TextEncoder().encode('Transfer(address,address,uint256)'))
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const OTHER_TOKEN = '0x4200000000000000000000000000000000000006'
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const OTHER_PARTY = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const HASH = `0x${'ab'.repeat(32)}`

const SOL_RECIPIENT = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const SOL_OTHER = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const SOL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL_OTHER_MINT = 'So11111111111111111111111111111111111111112'
const SIGNATURE =
  '5wHu1qwD4kLwYqAd1ZuFtQmzMWCsffhg1MzsKKW3rP9BiKmMqJdFxkQBfg9y8kZm7cGDGm1qNqAfNwLDCPBbjKf3'

function transferLog({ token = TOKEN, from = SENDER, to = RECIPIENT, value }) {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, pad(from, { size: 32 }), pad(to, { size: 32 })],
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: '0x10',
    blockHash: `0x${'11'.repeat(32)}`,
    logIndex: '0x0',
    transactionHash: HASH,
    transactionIndex: '0x0',
    removed: false,
  }
}

function receipt({ status = '0x1', logs = [] }) {
  return {
    status,
    logs: logs.map((log, index) => ({ ...log, logIndex: toHex(index) })),
    blockNumber: '0x10',
    blockHash: `0x${'11'.repeat(32)}`,
    transactionHash: HASH,
    transactionIndex: '0x0',
    from: SENDER,
    to: TOKEN,
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    gasUsed: '0x5208',
    logsBloom: `0x${'00'.repeat(256)}`,
    type: '0x2',
  }
}

/* --------------------------------------------------------------------- servers */

// What the mocks will answer with, swapped between cases.
const evmState = { receipt: null }
const solState = { transaction: null }

const evmServer = createServer((request, response) => {
  let raw = ''
  request.on('data', (chunk) => (raw += chunk))
  request.on('end', () => {
    const { id, method } = JSON.parse(raw || '{}')
    const send = (result) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
    }
    if (method === 'eth_getTransactionReceipt') return send(evmState.receipt)
    if (method === 'eth_blockNumber') return send('0x12')
    if (method === 'eth_chainId') return send('0x2105')
    return send(null)
  })
})

const solServer = createServer((request, response) => {
  let raw = ''
  request.on('data', (chunk) => (raw += chunk))
  request.on('end', () => {
    const { id } = JSON.parse(raw || '{}')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id, result: solState.transaction }))
  })
})

await new Promise((resolve) => evmServer.listen(4610, '127.0.0.1', resolve))
await new Promise((resolve) => solServer.listen(4611, '127.0.0.1', resolve))

const EVM_RPC = 'http://127.0.0.1:4610'
const SOL_RPC = 'http://127.0.0.1:4611'

const baseChain = base({ token: { address: TOKEN, symbol: 'USDC', decimals: 6 } })
const solanaChain = solana({ token: { address: SOL_MINT, symbol: 'USDC', decimals: 6 } })

const payEvm = (amount, recipient = RECIPIENT, reference = HASH) =>
  verifyPayment({ chain: baseChain, reference, recipient, amount, rpcUrl: EVM_RPC })

const paySol = (amount, recipient = SOL_RECIPIENT, reference = SIGNATURE) =>
  verifyPayment({ chain: solanaChain, reference, recipient, amount, rpcUrl: SOL_RPC })

function solTx({ err = null, pre = [], post = [] }) {
  return { slot: 100, meta: { err, preTokenBalances: pre, postTokenBalances: post } }
}
const solBalance = (owner, mint, amount) => ({ owner, mint, uiTokenAmount: { amount: String(amount) } })

/* ----------------------------------------------------------------------- tests */

try {
  section('[1] Solana and EVM addresses are never confused')
  check(isSolanaAddress(SOL_RECIPIENT), 'a real Solana address is accepted')
  check(!isSolanaAddress(RECIPIENT), 'an EVM address is not a Solana address')
  check(!isSolanaAddress('0OIl'), 'characters outside the base58 alphabet are rejected')
  check(!isSolanaAddress(''), 'the empty string is rejected')
  check(!isSolanaAddress('abc'), 'a short string is rejected')
  check(isSolanaSignature(SIGNATURE), 'a 64-byte signature is accepted')
  check(!isSolanaSignature(SOL_RECIPIENT), 'a 32-byte address is not a signature')
  check(!isSolanaSignature(HASH), 'an EVM hash is not a Solana signature')
  check(base58Decode('1')?.length === 1 && base58Decode('1')[0] === 0, 'base58 "1" decodes to a zero byte')

  section('[2] EVM: a real transfer is accepted')
  evmState.receipt = receipt({ logs: [transferLog({ value: 250_000_000n })] })
  let result = await payEvm(250_000_000n)
  check(result.paid === true, `exact amount -> paid (${result.paid ? result.amount : result.reason})`)
  check(result.paid && result.confirmations === 3, `confirmation depth reported (${result.confirmations})`)
  check((await payEvm(100_000_000n)).paid === true, 'more than asked for is still paid')

  section('[3] EVM: everything that is not payment is refused')
  check((await payEvm(250_000_001n)).paid === false, 'one base unit short')
  check((await payEvm(250_000_000n, OTHER_PARTY)).paid === false, 'credited a different recipient')

  evmState.receipt = receipt({ logs: [transferLog({ token: OTHER_TOKEN, value: 250_000_000n })] })
  check((await payEvm(250_000_000n)).paid === false, 'the right amount of the wrong token')

  evmState.receipt = receipt({ status: '0x0', logs: [transferLog({ value: 250_000_000n })] })
  check((await payEvm(250_000_000n)).paid === false, 'a reverted transaction with a transfer log')

  evmState.receipt = receipt({ logs: [] })
  check((await payEvm(1n)).paid === false, 'a successful transaction that moved nothing')

  evmState.receipt = null
  result = await payEvm(250_000_000n)
  check(result.paid === false && result.pending === true, 'an unmined hash is pending, not refused outright')

  check((await payEvm(250_000_000n, RECIPIENT, '0xdeadbeef')).paid === false, 'a malformed hash')
  check((await payEvm(0n)).paid === false, 'a zero-amount payment')

  section('[4] EVM: a payment split across transfers still counts')
  evmState.receipt = receipt({
    logs: [transferLog({ value: 100_000_000n }), transferLog({ value: 150_000_000n })],
  })
  result = await payEvm(250_000_000n)
  check(result.paid === true, `two transfers summing to the amount (${result.paid ? result.amount : result.reason})`)

  evmState.receipt = receipt({
    logs: [transferLog({ value: 100_000_000n }), transferLog({ to: OTHER_PARTY, value: 150_000_000n })],
  })
  check((await payEvm(250_000_000n)).paid === false, 'a second transfer to somebody else does not count')

  section('[5] Solana: a real SPL transfer is accepted')
  solState.transaction = solTx({
    pre: [solBalance(SOL_RECIPIENT, SOL_MINT, 0)],
    post: [solBalance(SOL_RECIPIENT, SOL_MINT, 250_000_000)],
  })
  result = await paySol(250_000_000n)
  check(result.paid === true, `exact amount -> paid (${result.paid ? result.amount : result.reason})`)

  solState.transaction = solTx({
    pre: [solBalance(SOL_RECIPIENT, SOL_MINT, 1_000_000)],
    post: [solBalance(SOL_RECIPIENT, SOL_MINT, 251_000_000)],
  })
  check((await paySol(250_000_000n)).paid === true, 'a recipient who already held some is credited by the delta')

  section('[6] Solana: everything that is not payment is refused')
  check((await paySol(250_000_001n)).paid === false, 'one base unit short')

  solState.transaction = solTx({
    pre: [solBalance(SOL_OTHER, SOL_MINT, 0)],
    post: [solBalance(SOL_OTHER, SOL_MINT, 250_000_000)],
  })
  check((await paySol(250_000_000n)).paid === false, 'credited a different owner')

  solState.transaction = solTx({
    pre: [solBalance(SOL_RECIPIENT, SOL_OTHER_MINT, 0)],
    post: [solBalance(SOL_RECIPIENT, SOL_OTHER_MINT, 250_000_000)],
  })
  check((await paySol(250_000_000n)).paid === false, 'the right amount of the wrong mint')

  solState.transaction = solTx({
    err: { InstructionError: [0, 'Custom'] },
    pre: [solBalance(SOL_RECIPIENT, SOL_MINT, 0)],
    post: [solBalance(SOL_RECIPIENT, SOL_MINT, 250_000_000)],
  })
  check((await paySol(250_000_000n)).paid === false, 'a failed transaction with a credit in its metadata')

  solState.transaction = null
  result = await paySol(250_000_000n)
  check(result.paid === false && result.pending === true, 'an unknown signature is pending, not refused outright')

  check((await paySol(250_000_000n, SOL_RECIPIENT, 'not-a-signature')).paid === false, 'a malformed signature')
  check((await paySol(250_000_000n, RECIPIENT)).paid === false, 'an EVM address as the Solana recipient')

  section('[7] A network that cannot settle payments verifies nothing')
  const dead = solana({ token: undefined })
  check((await verifyPayment({ chain: dead, reference: SIGNATURE, recipient: SOL_RECIPIENT, amount: 1n })).paid === false,
    'a network with no token configured')
} catch (error) {
  console.error('\nunexpected failure:', error)
  failures++
}

evmServer.close()
solServer.close()

console.log(failures === 0 ? '\nAll payment verification checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
