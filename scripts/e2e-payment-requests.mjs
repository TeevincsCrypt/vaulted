/**
 * End-to-end check of payment requests, against the real app and the real database.
 *
 * The chains are the only thing stood in for: two local servers speaking the real JSON-RPC shapes,
 * so the app runs its own verification code against real transaction structures. Everything else is
 * live — the routes are the deployed routes, the rows are written to Postgres, and authorisation is
 * the real session cookie.
 *
 * What this pins is the part that decides where money goes and when it counts as arrived:
 *   - the recipient comes from the creator's recorded wallet, never from the request body
 *   - PAID is reachable only through server-side verification
 *   - a transaction that pays someone else, or pays too little, moves nothing
 *   - cancelling belongs to the creator, and not after payment
 *   - a request addressed to a handle reaches that account and nobody else
 *   - hiring on a network with no escrow raises a real, verifiable payment for the budget
 *
 * Prerequisites: `npm run build`, and DATABASE_URL set (or in .env.local).
 * Run: npm run e2e:payments
 */
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { encodeAbiParameters, keccak256, pad, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PrismaClient } from '@prisma/client'
import { jobAcceptMessage, jobApplicationMessage, jobCreationMessage } from '../lib/vaulted/messages.ts'

const ROOT = path.join(import.meta.dirname, '..')
for (const file of ['.env.local', '.env']) {
  const full = path.join(ROOT, file)
  if (!existsSync(full)) continue
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — this check writes to a real database.')
  process.exit(1)
}

const APP_PORT = Number(process.env.VAULTED_E2E_PORT ?? 3455)
const EVM_PORT = APP_PORT + 1
const SOL_PORT = APP_PORT + 2
const APP = `http://127.0.0.1:${APP_PORT}`
const AUTH_SECRET = 'e2e-auth-secret-that-is-comfortably-long-enough'

const CREATOR_SIGNER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
// Anvil #3, kept clear of ATTACKER_EVM so the injection assertions above stay meaningful.
const OTHER_SIGNER = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6')
const EVM_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const OTHER_EVM_WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const OTHER_SOL_WALLET = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T'
const SOL_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const ATTACKER_EVM = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const GOOD_HASH = `0x${'a1'.repeat(32)}`
const WRONG_PAYEE_HASH = `0x${'b2'.repeat(32)}`
const SHORT_HASH = `0x${'c3'.repeat(32)}`
const GOOD_SIG = '5wHu1qwD4kLwYqAd1ZuFtQmzMWCsffhg1MzsKKW3rP9BiKmMqJdFxkQBfg9y8kZm7cGDGm1qNqAfNwLDCPBbjKf3'
const WRONG_SIG = '2xJk8vQpRt3nHgYwLmCdFbXsAeZoPuNiKrTyWqBvDhGjMcSfUaEoRnLpXtYbZwQvKmJhGfDsAcNbVxCzMqPwRtYu'

let failures = 0
const step = (n, s) => console.log(`\n[${n}] ${s}`)
const assert = (ok, msg) => {
  console.log(`   ${ok ? 'ok  ' : 'FAIL'}: ${msg}`)
  if (!ok) failures++
}

/* ------------------------------------------------------------------- mock chains */

const TRANSFER_TOPIC = keccak256(new TextEncoder().encode('Transfer(address,address,uint256)'))

function transferLog(to, value, token = BASE_USDC) {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, pad(EVM_WALLET, { size: 32 }), pad(to, { size: 32 })],
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: '0x10',
    blockHash: `0x${'11'.repeat(32)}`,
    logIndex: '0x0',
    transactionHash: GOOD_HASH,
    transactionIndex: '0x0',
    removed: false,
  }
}

function receipt(logs) {
  return {
    status: '0x1',
    logs: logs.map((log, index) => ({ ...log, logIndex: toHex(index) })),
    blockNumber: '0x10',
    blockHash: `0x${'11'.repeat(32)}`,
    transactionHash: GOOD_HASH,
    transactionIndex: '0x0',
    from: EVM_WALLET,
    to: BASE_USDC,
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    gasUsed: '0x5208',
    logsBloom: `0x${'00'.repeat(256)}`,
    type: '0x2',
  }
}

// 250 USDC, in base units.
const ASKED = 250_000_000n

const receipts = {
  [GOOD_HASH]: receipt([transferLog(EVM_WALLET, ASKED)]),
  [WRONG_PAYEE_HASH]: receipt([transferLog(ATTACKER_EVM, ASKED)]),
  [SHORT_HASH]: receipt([transferLog(EVM_WALLET, ASKED - 1n)]),
}

const evmServer = createServer((request, response) => {
  let raw = ''
  request.on('data', (chunk) => (raw += chunk))
  request.on('end', () => {
    const { id, method, params } = JSON.parse(raw || '{}')
    const send = (result) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
    }
    if (method === 'eth_getTransactionReceipt') return send(receipts[params?.[0]] ?? null)
    if (method === 'eth_blockNumber') return send('0x12')
    if (method === 'eth_chainId') return send('0x2105')
    return send(null)
  })
})

const solBalance = (owner, mint, amount) => ({ owner, mint, uiTokenAmount: { amount: String(amount) } })
const solTransactions = {
  [GOOD_SIG]: {
    slot: 1,
    meta: {
      err: null,
      preTokenBalances: [solBalance(SOL_WALLET, SOL_USDC, 0)],
      postTokenBalances: [solBalance(SOL_WALLET, SOL_USDC, Number(ASKED))],
    },
  },
  [WRONG_SIG]: {
    slot: 1,
    meta: {
      err: null,
      preTokenBalances: [solBalance(SOL_WALLET, SOL_USDC, 0)],
      // Credits somebody else entirely.
      postTokenBalances: [solBalance('DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', SOL_USDC, Number(ASKED))],
    },
  },
}

const solServer = createServer((request, response) => {
  let raw = ''
  request.on('data', (chunk) => (raw += chunk))
  request.on('end', () => {
    const { id, params } = JSON.parse(raw || '{}')
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id, result: solTransactions[params?.[0]] ?? null }))
  })
})

await new Promise((resolve) => evmServer.listen(EVM_PORT, '127.0.0.1', resolve))
await new Promise((resolve) => solServer.listen(SOL_PORT, '127.0.0.1', resolve))

/* --------------------------------------------------------------------- the app */

const app = spawn(path.join(ROOT, 'node_modules', '.bin', 'next'), ['start', '-p', String(APP_PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
  env: {
    ...process.env,
    AUTH_SECRET,
    // Both rails pointed at the mocks. Read at runtime on the server, which is where verification
    // happens, so no rebuild is needed to redirect them.
    RPC_URL: `http://127.0.0.1:${EVM_PORT}`,
    NEXT_PUBLIC_RPC_URL_SOLANA: `http://127.0.0.1:${SOL_PORT}`,
  },
})
const appLog = []
app.stdout.on('data', (chunk) => appLog.push(chunk.toString()))
app.stderr.on('data', (chunk) => appLog.push(chunk.toString()))

const prisma = new PrismaClient()

async function shutdown(code) {
  await prisma.$disconnect().catch(() => {})
  try {
    process.kill(-app.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
  await new Promise((resolve) => evmServer.close(resolve))
  await new Promise((resolve) => solServer.close(resolve))
  process.exit(code)
}

async function waitForApp() {
  try {
    await fetch(`${APP}/api/auth/session`)
    console.error(`something is already listening on ${APP}. Stop it, or set VAULTED_E2E_PORT.`)
    await shutdown(1)
  } catch {
    /* nothing there, as it should be */
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${APP}/api/auth/session`)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.error(`the app did not start:\n${appLog.join('')}`)
  await shutdown(1)
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function cookieFor(account) {
  const payload = { accountId: account.id, name: account.name, exp: Math.floor(Date.now() / 1000) + 3600 }
  const body = b64url(JSON.stringify(payload))
  return `vaulted_session=${body}.${b64url(createHmac('sha256', AUTH_SECRET).update(body).digest())}`
}

const api = (path, { cookie, method = 'GET', body } = {}) =>
  fetch(`${APP}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

/* ----------------------------------------------------------------------- tests */

try {
  await waitForApp()

  // A clean slate, or the assertions below mean nothing.
  await prisma.paymentRequest.deleteMany({ where: { creator: { name: { in: ['prcreator', 'prother'] } } } })
  await prisma.job.deleteMany({ where: { clientAddress: { in: [EVM_WALLET, OTHER_EVM_WALLET] } } })
  await prisma.linkedWallet.deleteMany({
    where: { address: { in: [EVM_WALLET, SOL_WALLET, OTHER_EVM_WALLET, OTHER_SOL_WALLET] } },
  })
  await prisma.account.deleteMany({ where: { name: { in: ['prcreator', 'prother'] } } })

  const creator = await prisma.account.create({
    data: {
      name: 'prcreator',
      privyUserId: 'did:privy:pr-creator',
      twitterId: 'pr-1',
      ownerAddress: EVM_WALLET,
      ownerChainKey: 'base',
      addresses: {
        create: [
          { chainKey: 'base', address: EVM_WALLET, provenance: 'PRIVY_EMBEDDED' },
          { chainKey: 'solana', address: SOL_WALLET, provenance: 'PRIVY_EMBEDDED' },
        ],
      },
    },
  })
  const other = await prisma.account.create({
    data: {
      name: 'prother',
      privyUserId: 'did:privy:pr-other',
      twitterId: 'pr-2',
      ownerAddress: OTHER_EVM_WALLET,
      ownerChainKey: 'base',
      addresses: {
        create: [
          { chainKey: 'base', address: OTHER_EVM_WALLET, provenance: 'PRIVY_EMBEDDED' },
          { chainKey: 'solana', address: OTHER_SOL_WALLET, provenance: 'PRIVY_EMBEDDED' },
        ],
      },
    },
  })
  const cookie = cookieFor(creator)
  const otherCookie = cookieFor(other)

  step(1, 'creating a request takes the recipient from the account, not from the caller')
  let response = await api('/api/payment-requests', {
    cookie,
    method: 'POST',
    body: {
      network: 'base',
      amount: ASKED.toString(),
      description: 'Brand identity refresh',
      // A caller trying to redirect the money to themselves.
      recipientAddress: ATTACKER_EVM,
      status: 'PAID',
      creatorId: other.id,
    },
  })
  let body = await response.json()
  assert(response.status === 201, `created (${response.status})`)
  const evmRequest = body.request
  assert(evmRequest?.recipientAddress === EVM_WALLET, `recipient is the creator's wallet: ${evmRequest?.recipientAddress}`)
  assert(evmRequest?.recipientAddress !== ATTACKER_EVM, 'the address in the body was ignored')
  assert(evmRequest?.status === 'PENDING', `status is PENDING despite the body asking for PAID (${evmRequest?.status})`)
  assert(evmRequest?.id?.startsWith('pr_'), `id is payment-request shaped: ${evmRequest?.id}`)
  const stored = await prisma.paymentRequest.findUnique({ where: { id: evmRequest.id } })
  assert(stored?.creatorId === creator.id, 'the creator is the session account, not the one in the body')

  step(2, 'signing out is enough to be refused')
  assert((await api('/api/payment-requests', { method: 'POST', body: { network: 'base', amount: '1', description: 'x' } })).status === 401,
    'creating without a session -> 401')
  assert((await api('/api/payment-requests')).status === 401, 'listing without a session -> 401')

  step(3, 'the payment link is public — the payer has no account')
  response = await api(`/api/payment-requests/${evmRequest.id}`)
  body = await response.json()
  assert(response.ok, `readable with no cookie (${response.status})`)
  assert(body.request?.recipientAddress === EVM_WALLET, 'the payer sees where to send')
  assert(body.request?.creatorId === undefined, 'no internal ids are exposed')

  step(4, 'a transaction that does not pay this request changes nothing')
  for (const [hash, label] of [
    [WRONG_PAYEE_HASH, 'a transfer to somebody else'],
    [SHORT_HASH, 'a transfer one base unit short'],
    [`0x${'ee'.repeat(32)}`, 'a hash the network has never seen'],
  ]) {
    response = await api(`/api/payment-requests/${evmRequest.id}/verify`, { method: 'POST', body: { txHash: hash } })
    body = await response.json()
    assert(body.verified === false, `${label} -> not verified (${body.reason ?? ''})`.slice(0, 110))
  }
  assert((await prisma.paymentRequest.findUnique({ where: { id: evmRequest.id } }))?.status === 'PENDING',
    'still PENDING after every rejected claim')

  assert((await api(`/api/payment-requests/${evmRequest.id}/verify`, { method: 'POST', body: { txHash: 'nonsense' } })).status === 400,
    'a malformed hash is refused before any RPC call')

  step(5, 'a real Base transfer settles it')
  response = await api(`/api/payment-requests/${evmRequest.id}/verify`, { method: 'POST', body: { txHash: GOOD_HASH } })
  body = await response.json()
  assert(body.verified === true, `verified (${body.reason ?? 'ok'})`)
  assert(body.request?.status === 'PAID', `status -> ${body.request?.status}`)
  const paid = await prisma.paymentRequest.findUnique({ where: { id: evmRequest.id } })
  assert(paid?.status === 'PAID', 'PAID is persisted, not just returned')
  assert(paid?.txHash === GOOD_HASH, 'the transaction is recorded')
  assert(paid?.paidAmount === ASKED.toString(), `what the chain credited is recorded (${paid?.paidAmount})`)
  assert(paid?.paidAt !== null, 'paidAt is set')

  step(6, 'verifying again is idempotent')
  response = await api(`/api/payment-requests/${evmRequest.id}/verify`, { method: 'POST', body: { txHash: GOOD_HASH } })
  body = await response.json()
  assert(body.verified === true && body.request.status === 'PAID', 'a refresh returns the same answer')
  assert((await prisma.paymentRequest.count({ where: { id: evmRequest.id, status: 'PAID' } })) === 1,
    'no second payment was recorded')

  step(7, 'Solana settles the same way, against its own rail')
  response = await api('/api/payment-requests', {
    cookie,
    method: 'POST',
    body: { network: 'solana', amount: ASKED.toString(), description: 'Solana invoice' },
  })
  body = await response.json()
  const solRequest = body.request
  assert(response.status === 201, `created on Solana (${response.status})`)
  assert(solRequest?.recipientAddress === SOL_WALLET, `recipient is the Solana wallet: ${solRequest?.recipientAddress}`)
  assert(solRequest?.recipientAddress !== EVM_WALLET, 'never the EVM address')

  assert((await api(`/api/payment-requests/${solRequest.id}/verify`, { method: 'POST', body: { txHash: GOOD_HASH } })).status === 400,
    'an EVM hash is refused on a Solana request')

  response = await api(`/api/payment-requests/${solRequest.id}/verify`, { method: 'POST', body: { txHash: WRONG_SIG } })
  body = await response.json()
  assert(body.verified === false, 'a Solana transfer crediting someone else is refused')

  response = await api(`/api/payment-requests/${solRequest.id}/verify`, { method: 'POST', body: { txHash: GOOD_SIG } })
  body = await response.json()
  assert(body.verified === true, `a real SPL transfer verifies (${body.reason ?? 'ok'})`)
  assert((await prisma.paymentRequest.findUnique({ where: { id: solRequest.id } }))?.status === 'PAID',
    'the Solana request is PAID in the database')

  step(8, 'cancelling belongs to the creator, and not after payment')
  response = await api('/api/payment-requests', {
    cookie,
    method: 'POST',
    body: { network: 'base', amount: '1000000', description: 'To be cancelled' },
  })
  const cancellable = (await response.json()).request

  assert((await api(`/api/payment-requests/${cancellable.id}/cancel`, { method: 'POST' })).status === 401,
    'a signed-out caller cannot cancel')
  assert((await api(`/api/payment-requests/${cancellable.id}/cancel`, { cookie: otherCookie, method: 'POST' })).status === 404,
    'another account gets 404, not a hint that it exists')

  response = await api(`/api/payment-requests/${cancellable.id}/cancel`, { cookie, method: 'POST' })
  body = await response.json()
  assert(response.ok && body.request.status === 'CANCELLED', `the creator can cancel (${body.request?.status})`)
  assert((await prisma.paymentRequest.findUnique({ where: { id: cancellable.id } }))?.status === 'CANCELLED',
    'CANCELLED is persisted')

  assert((await api(`/api/payment-requests/${cancellable.id}/verify`, { method: 'POST', body: { txHash: GOOD_HASH } })).status === 409,
    'a cancelled request cannot then be paid')
  assert((await api(`/api/payment-requests/${evmRequest.id}/cancel`, { cookie, method: 'POST' })).status === 409,
    'a paid request cannot be cancelled')

  step(9, 'expiry is enforced, not merely displayed')
  response = await api('/api/payment-requests', {
    cookie,
    method: 'POST',
    body: { network: 'base', amount: '1000000', description: 'Expiring' },
  })
  const expiring = (await response.json()).request
  await prisma.paymentRequest.update({
    where: { id: expiring.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  })
  response = await api(`/api/payment-requests/${expiring.id}`)
  body = await response.json()
  assert(body.request.status === 'EXPIRED', `a past expiry reads as EXPIRED (${body.request.status})`)
  assert((await api(`/api/payment-requests/${expiring.id}/verify`, { method: 'POST', body: { txHash: GOOD_HASH } })).status === 409,
    'an expired request cannot be paid')

  step(10, 'the creator sees their own requests and nobody else’s')
  response = await api('/api/payment-requests', { cookie })
  body = await response.json()
  assert(response.ok && body.requests.length === 4, `four requests listed (${body.requests?.length})`)
  assert(body.networks.some((n) => n.key === 'base') && body.networks.some((n) => n.key === 'solana'),
    'both production networks are offered')
  const otherList = await (await api('/api/payment-requests', { cookie: otherCookie })).json()
  assert(otherList.requests.length === 0, 'another account sees none of them')

  step(11, 'a request can be addressed to a handle, and reaches only that account')
  response = await api('/api/payment-requests', {
    cookie,
    method: 'POST',
    body: {
      network: 'solana',
      amount: '2500000',
      description: 'Illustration set',
      toHandle: '@prother',
    },
  })
  body = await response.json()
  assert(response.ok, `addressed request created (${response.status})`)
  const addressed = body.request
  assert(addressed?.payerHandle === 'prother', `it records who is being asked (${addressed?.payerHandle})`)
  assert(addressed?.recipientAddress === SOL_WALLET, 'and still pays the creator’s own Solana wallet')

  const incoming = await (await api('/api/payment-requests', { cookie: otherCookie })).json()
  assert(
    incoming.incoming?.length === 1 && incoming.incoming[0].id === addressed.id,
    `the addressee sees it in what they owe (${incoming.incoming?.length})`,
  )
  assert(incoming.incoming?.[0]?.recipientHandle === 'prcreator', 'and sees who is asking')
  assert(incoming.requests?.length === 0, 'without it appearing among what they have asked for')

  const creatorView = await (await api('/api/payment-requests', { cookie })).json()
  assert(creatorView.incoming?.length === 0, 'and the creator is not asked to pay their own request')

  assert(
    (await api('/api/payment-requests', {
      cookie,
      method: 'POST',
      body: { network: 'base', amount: '1000', description: 'To nobody', toHandle: 'ghost' },
    })).status === 404,
    'an unknown handle is refused',
  )
  assert(
    (await api('/api/payment-requests', {
      cookie,
      method: 'POST',
      body: { network: 'base', amount: '1000', description: 'To myself', toHandle: 'prcreator' },
    })).status === 400,
    'and so is addressing one to yourself',
  )

  step(12, 'hiring on a network with no escrow raises a real payment for the budget')
  // The client is `other`; the worker is the creator, whose Solana wallet is the one that gets paid.
  const jobId = 'job_e2ejobpay0000001'
  const budget = '1000000'
  let issuedAt = Math.floor(Date.now() / 1000)
  let signature = await OTHER_SIGNER.signMessage({
    message: jobCreationMessage({
      jobId,
      title: 'Solana landing page',
      budgetAmount: budget,
      chainKey: 'solana',
      client: OTHER_EVM_WALLET,
      issuedAt,
    }),
  })
  response = await api('/api/jobs', {
    cookie: otherCookie,
    method: 'POST',
    body: {
      jobId,
      title: 'Solana landing page',
      description: 'A page, on the network the client actually holds money on.',
      budgetAmount: budget,
      chainKey: 'solana',
      deadline: null,
      protectionPeriod: 86400,
      clientAddress: OTHER_EVM_WALLET,
      issuedAt,
      signature,
    },
  })
  assert(response.ok, `a job posts on Solana even though it has no escrow (${response.status})`)

  issuedAt = Math.floor(Date.now() / 1000)
  signature = await CREATOR_SIGNER.signMessage({
    message: jobApplicationMessage({ jobId, applicant: EVM_WALLET, issuedAt }),
  })
  response = await api(`/api/jobs/${jobId}/applications`, {
    cookie,
    method: 'POST',
    body: { applicantAddress: EVM_WALLET, message: 'I build these.', issuedAt, signature },
  })
  assert(response.ok, `the worker applies (${response.status})`)

  issuedAt = Math.floor(Date.now() / 1000)
  signature = await OTHER_SIGNER.signMessage({
    message: jobAcceptMessage({ jobId, applicant: EVM_WALLET, client: OTHER_EVM_WALLET, issuedAt }),
  })
  response = await api(`/api/jobs/${jobId}/accept`, {
    cookie: otherCookie,
    method: 'POST',
    body: { applicantAddress: EVM_WALLET, clientAddress: OTHER_EVM_WALLET, issuedAt, signature },
  })
  assert(response.ok, `the client hires (${response.status})`)

  const jobView = await (await api(`/api/jobs/${jobId}`)).json()
  assert(jobView.escrowCapable === false, 'the job page is told the network cannot hold an escrow')
  assert(jobView.payment?.amount === budget, `a payment for the budget exists (${jobView.payment?.amount})`)
  assert(jobView.payment?.status === 'PENDING', 'and it is not paid merely by having been raised')

  const jobPayment = await (await api(`/api/payment-requests/${jobView.payment.id}`)).json()
  assert(jobPayment.request?.recipientAddress === SOL_WALLET, 'it pays the worker’s Solana wallet')
  assert(jobPayment.request?.payerHandle === 'prother', 'and it is addressed to the client')
  assert(jobPayment.request?.jobId === jobId, 'and it names the job it belongs to')

  const clientOwes = await (await api('/api/payment-requests', { cookie: otherCookie })).json()
  assert(
    clientOwes.incoming?.some((entry) => entry.id === jobView.payment.id),
    'the client is shown the budget among what they owe',
  )

  step(13, 'the job budget is still only paid by proving it on the network')
  const badAttempt = await api(`/api/payment-requests/${jobView.payment.id}/verify`, {
    method: 'POST',
    body: { txHash: WRONG_SIG },
  })
  const badBody = await badAttempt.json()
  assert(badAttempt.status === 202 && badBody.verified === false,
    `an unrelated signature is answered but not accepted (${badAttempt.status})`)
  const stillPending = await (await api(`/api/payment-requests/${jobView.payment.id}`)).json()
  assert(stillPending.request?.status === 'PENDING', 'and the budget is still unpaid')

  const afterFailedVerify = await (await api(`/api/jobs/${jobId}`)).json()
  assert(afterFailedVerify.payment?.status === 'PENDING', 'the job page agrees it is unpaid')

  console.log(failures === 0 ? '\nAll payment request checks passed.\n' : `\n${failures} check(s) failed.\n`)
  if (failures > 0) console.log(appLog.join('').slice(-2500))
  await shutdown(failures === 0 ? 0 : 1)
} catch (error) {
  console.error('\nunexpected failure:', error)
  console.log(appLog.join('').slice(-2500))
  await shutdown(1)
}
