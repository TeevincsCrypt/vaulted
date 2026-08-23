/**
 * End-to-end check of the Privy sign-in path, against the real app and the real database.
 *
 * Privy's own service is the one thing that cannot be reached from here, so it — and only it — is
 * stood in for: a local server speaking Privy's REST shape, and a throwaway P-256 keypair standing
 * in for the app's verification key. Everything downstream is real. The token is a genuine ES256
 * JWT, the route is the deployed route, the rows are written to Postgres, and the session cookie is
 * the one a browser would get.
 *
 * What this pins is the property that matters: the browser supplies a token and nothing else, and
 * the handle and wallet address are taken from what the server reads back with the app secret.
 *
 * Prerequisites: `npm run build`, and DATABASE_URL set (or in .env.local).
 * Run: npm run e2e:privy
 */
import { spawn } from 'node:child_process'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

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

const APP_PORT = Number(process.env.VAULTED_E2E_PORT ?? 3399)
const MOCK_PORT = APP_PORT + 1
const APP = `http://127.0.0.1:${APP_PORT}`
const APP_ID = 'e2e-privy-app'
const APP_SECRET = 'e2e-app-secret'
const DID = 'did:privy:e2e-vaulted'
const SUBJECT = '4815162342'
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

let failures = 0
const step = (n, s) => console.log(`\n[${n}] ${s}`)
const assert = (ok, msg) => {
  console.log(`   ${ok ? 'ok  ' : 'FAIL'}: ${msg}`)
  if (!ok) failures++
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const verificationKey = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function mint({ key = privateKey, payload = {} } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      sub: DID,
      iss: 'privy.io',
      aud: APP_ID,
      sid: 'e2e-session',
      iat: now,
      exp: now + 600,
      ...payload,
    }),
  )
  const signer = createSign('sha256')
  signer.update(`${header}.${claims}`)
  return `${header}.${claims}.${b64url(signer.sign({ key, dsaEncoding: 'ieee-p1363' }))}`
}

/* ------------------------------------------------------------------ mock Privy */

// What the mock answers with. Mutated between steps to reproduce Privy's real timing, where the
// embedded wallet appears a moment after the account does.
const state = { username: 'E2ETester', name: 'E2E Tester', wallet: null, twitter: true }
const seen = { authorization: null, appIdHeader: null, calls: 0 }

const mock = createServer((request, response) => {
  seen.calls++
  seen.authorization = request.headers.authorization ?? null
  seen.appIdHeader = request.headers['privy-app-id'] ?? null

  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  if (request.url?.startsWith(`/api/v1/users/${encodeURIComponent(DID)}`)) {
    const linked = []
    if (state.twitter) {
      linked.push({
        type: 'twitter_oauth',
        subject: SUBJECT,
        username: state.username,
        name: state.name,
        profile_picture_url: 'https://pbs.twimg.com/profile_images/e2e.jpg',
        verified_at: 1700000000,
        first_verified_at: 1700000000,
        latest_verified_at: 1700000000,
      })
    }
    if (state.wallet) {
      linked.push({
        type: 'wallet',
        id: 'wallet-1',
        address: state.wallet,
        chain_type: 'ethereum',
        wallet_client_type: 'privy',
        connector_type: 'embedded',
        verified_at: 1700000000,
        first_verified_at: 1700000000,
        latest_verified_at: 1700000000,
      })
    }
    return send(200, { id: DID, created_at: 1700000000, is_guest: false, linked_accounts: linked })
  }

  return send(404, { error: 'unexpected path', path: request.url })
})
await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve))

/* --------------------------------------------------------------------- the app */

// Its own process group, and the Next binary directly rather than through npx: `next start` forks
// a server child, and killing only the wrapper would leave it holding the port — which then makes
// the next run silently talk to a stale server instead of the one it just configured.
const app = spawn(path.join(ROOT, 'node_modules', '.bin', 'next'), ['start', '-p', String(APP_PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
  env: {
    ...process.env,
    AUTH_SECRET: 'e2e-auth-secret-that-is-comfortably-long-enough',
    NEXT_PUBLIC_PRIVY_APP_ID: APP_ID,
    PRIVY_APP_SECRET: APP_SECRET,
    PRIVY_VERIFICATION_KEY: verificationKey,
    PRIVY_API_URL: `http://127.0.0.1:${MOCK_PORT}`,
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
  await new Promise((resolve) => mock.close(resolve))
  process.exit(code)
}

async function waitForApp() {
  // If something is already listening the spawn will have failed to bind, and every assertion
  // below would be made against a server configured with someone else's keys.
  try {
    await fetch(`${APP}/api/auth/session`)
    console.error(`something is already listening on ${APP}. Stop it, or set VAULTED_E2E_PORT.`)
    await shutdown(1)
  } catch {
    /* nothing there, as it should be */
  }

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${APP}/api/auth/session`)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.error(`the app did not start:\n${appLog.join('')}`)
  await shutdown(1)
}

const post = (token) =>
  fetch(`${APP}/api/auth/privy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })

try {
  await waitForApp()

  // Rows left by a previous run would make the assertions below meaningless.
  await prisma.linkedWallet.deleteMany({ where: { address: WALLET } })
  await prisma.account.deleteMany({ where: { OR: [{ privyUserId: DID }, { twitterId: SUBJECT }] } })

  step(1, 'a valid token, before Privy has finished creating the wallet')
  let response = await post(mint())
  let body = await response.json()
  assert(response.status === 200, `sign-in accepted (${response.status})`)
  assert(body.walletAssigned === false, 'walletAssigned is false — no address is claimed yet')
  assert(body.account?.name === 'e2etester', `handle lowercased from X: ${body.account?.name}`)
  assert(body.account?.primaryAddress === null, 'no primary address recorded yet')
  const setCookie = response.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]
  assert(cookie.startsWith('vaulted_session='), 'a session cookie was set')
  assert(setCookie.toLowerCase().includes('httponly'), 'the session cookie is httpOnly')

  step(2, 'the app authenticated to Privy with the app secret, not the browser’s word')
  const expected = `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`
  assert(seen.authorization === expected, 'the user lookup carried the app secret')
  assert(seen.appIdHeader === APP_ID, 'the user lookup carried the app id header')

  step(3, 'the wallet appears, and the next sync records it')
  state.wallet = WALLET
  response = await post(mint())
  body = await response.json()
  assert(response.status === 200, `sign-in accepted again (${response.status})`)
  assert(body.walletAssigned === true, 'walletAssigned is true once Privy reports one')
  assert(body.account?.primaryAddress === WALLET, `primary address recorded: ${body.account?.primaryAddress}`)

  const stored = await prisma.account.findUnique({ where: { privyUserId: DID }, include: { addresses: true } })
  assert(stored?.ownerAddress === WALLET, 'Account.ownerAddress written')
  assert(stored?.twitterId === SUBJECT, 'the immutable X subject is stored')
  assert(stored?.addresses.length === 1, `exactly one wallet row, not one per chain (${stored?.addresses.length})`)
  assert(stored?.addresses[0]?.provenance === 'PRIVY_EMBEDDED', 'the wallet row is labelled PRIVY_EMBEDDED')
  assert(stored?.addresses[0]?.proofSignature === null, 'no signature is invented for an attested wallet')

  step(4, 'the session cookie identifies the account')
  response = await fetch(`${APP}/api/auth/session`, { headers: { cookie } })
  body = await response.json()
  assert(body.account?.name === 'e2etester', 'GET /api/auth/session resolves the account')
  assert(body.authConfigured === true, 'the deployment reports sign-in as configured')
  assert(body.account?.primaryAddress === WALLET, 'the session carries the assigned wallet')

  step(5, 'the handle follows a rename on X, and the account does not fork')
  const idBefore = stored?.id
  state.username = 'E2ERenamed'
  response = await post(mint())
  body = await response.json()
  assert(body.account?.name === 'e2erenamed', `handle updated: ${body.account?.name}`)
  assert(body.account?.id === idBefore, 'the same account row, keyed on the X subject')
  assert((await prisma.account.count({ where: { privyUserId: DID } })) === 1, 'no duplicate account was created')

  step(6, 'a handle resolves to the assigned wallet')
  // The wallet is filed under one chain; the other EVM networks reach it through the same-family
  // fallback, because an EVM account address is the same address everywhere.
  for (const chainKey of ['base-sepolia', 'base']) {
    response = await fetch(`${APP}/api/accounts/resolve?handle=e2erenamed&chainKey=${chainKey}`)
    const resolved = await response.json()
    assert(response.ok, `resolve on ${chainKey} responded ${response.status}`)
    assert(resolved.address === WALLET, `@e2erenamed -> ${resolved.address} on ${chainKey}`)
  }
  // A Solana payment must never be sent an EVM address.
  response = await fetch(`${APP}/api/accounts/resolve?handle=e2erenamed&chainKey=solana-devnet`)
  const svm = await response.json()
  assert(svm.found === true && svm.address === null, `no address is offered for a Solana payment (${svm.address})`)

  step(7, 'forged and unusable tokens are refused, and change nothing')
  const before = await prisma.account.findUnique({ where: { privyUserId: DID } })
  for (const [token, label] of [
    [mint({ key: other.privateKey }), 'a token signed with another key'],
    [mint({ payload: { aud: 'someone-elses-app' } }), 'a token for another app'],
    [mint({ payload: { exp: Math.floor(Date.now() / 1000) - 5 } }), 'an expired token'],
    ['garbage', 'a malformed token'],
  ]) {
    const rejected = await post(token)
    assert(rejected.status === 401, `${label} -> ${rejected.status}`)
    assert(!(rejected.headers.get('set-cookie') ?? '').includes('vaulted_session='), `${label} sets no cookie`)
  }
  const after = await prisma.account.findUnique({ where: { privyUserId: DID } })
  assert(after?.updatedAt?.getTime() === before?.updatedAt?.getTime(), 'no row was touched by the refused attempts')

  step(8, 'a Privy account with no X profile cannot become a Vaulted handle')
  state.twitter = false
  response = await post(mint())
  body = await response.json()
  assert(response.status === 409, `refused with ${response.status}`)
  assert(String(body.error).includes('X'), `and says why: ${body.error}`)
  state.twitter = true

  console.log(failures === 0 ? '\nAll Privy session checks passed.\n' : `\n${failures} check(s) failed.\n`)
  if (failures > 0) console.log(appLog.join('').slice(-3000))
  await shutdown(failures === 0 ? 0 : 1)
} catch (error) {
  console.error('\nunexpected failure:', error)
  console.log(appLog.join('').slice(-3000))
  await shutdown(1)
}
