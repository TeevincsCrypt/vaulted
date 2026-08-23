/**
 * End-to-end check of the Privy sign-in path, against the real app and the real database.
 *
 * Privy's own service is the one thing that cannot be reached from here, so it — and only it — is
 * stood in for: a local server speaking Privy's REST shape, backed by a throwaway P-256 keypair.
 * Everything downstream is real. The app runs Privy's own SDK against that server, so the token is
 * a genuine ES256 JWT verified by `PrivyClient.verifyAuthToken`, the verification key is fetched
 * from app settings the way it is in production, the route is the deployed route, the rows are
 * written to Postgres, and the session cookie is the one a browser would get.
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
const APP_ID = 'cme2eprivyapp000000000000' // exactly 25 characters, as a real Privy app id is
const APP_SECRET = 'e2e-app-secret'
const DID = 'did:privy:e2e-vaulted'
const SUBJECT = '4815162342'
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const SOL_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

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
const state = { username: 'E2ETester', name: 'E2E Tester', wallet: null, solanaWallet: null, twitter: true }
const seen = { userLookup: null, appSettings: null, calls: 0 }

const mock = createServer((request, response) => {
  seen.calls++
  const credentials = {
    authorization: request.headers.authorization ?? null,
    appIdHeader: request.headers['privy-app-id'] ?? null,
  }

  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  // Decoded, because the SDK interpolates ids straight into the path: a Privy DID arrives with its
  // colons intact rather than percent-encoded, and matching only the encoded form silently 404s.
  const requestPath = decodeURIComponent((request.url ?? '').split('?')[0])

  // App settings, which is where the SDK reads the token verification key from. Serving it here
  // rather than injecting the key by environment means the run exercises the same fetch-and-parse
  // path production uses — the path that used to break.
  if (requestPath.startsWith(`/api/v1/apps/${APP_ID}`)) {
    seen.appSettings = credentials
    return send(200, {
      id: APP_ID,
      name: 'Vaulted e2e',
      verification_key: verificationKey,
      logo_url: null,
      theme: 'dark',
      accent_color: '#ff8a00',
      wallet_auth: false,
      email_auth: false,
      sms_auth: false,
      google_oauth: false,
      twitter_oauth: true,
      discord_oauth: false,
      github_oauth: false,
      apple_oauth: false,
      linkedin_oauth: false,
      tiktok_oauth: false,
      disable_plus_emails: false,
      terms_and_conditions_url: null,
      privacy_policy_url: null,
      allowlist_enabled: false,
      allowlist_config: { error_title: '', error_detail: '', cta_text: '', cta_link: '' },
      created_at: 1700000000,
      updated_at: 1700000000,
    })
  }

  if (requestPath.startsWith(`/api/v1/users/${DID}`)) {
    seen.userLookup = credentials
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
    if (state.solanaWallet) {
      linked.push({
        type: 'wallet',
        id: 'wallet-2',
        address: state.solanaWallet,
        chain_type: 'solana',
        wallet_client_type: 'privy',
        connector_type: 'embedded',
        verified_at: 1700000000,
        first_verified_at: 1700000000,
        latest_verified_at: 1700000000,
      })
    }
    return send(200, { id: DID, created_at: 1700000000, is_guest: false, linked_accounts: linked })
  }

  return send(404, { error: 'unexpected path', path: requestPath })
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
    // Deliberately no verification key: the SDK must fetch it from app settings, as in production.
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
  await prisma.linkedWallet.deleteMany({ where: { address: { in: [WALLET, SOL_WALLET] } } })
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
  assert(seen.userLookup?.authorization === expected, 'the user lookup carried the app secret')
  assert(seen.userLookup?.appIdHeader === APP_ID, 'the user lookup carried the app id header')
  assert(seen.appSettings !== null, 'the verification key was fetched from app settings, not configured')
  assert(seen.appSettings?.authorization === expected, 'that fetch carried the app secret too')

  step(3, 'both wallets appear, and the next sync records them')
  state.wallet = WALLET
  state.solanaWallet = SOL_WALLET
  response = await post(mint())
  body = await response.json()
  assert(response.status === 200, `sign-in accepted again (${response.status})`)
  assert(body.walletAssigned === true, 'walletAssigned is true once Privy reports one')
  assert(body.account?.primaryAddress === WALLET, `primary address recorded: ${body.account?.primaryAddress}`)

  const stored = await prisma.account.findUnique({ where: { privyUserId: DID }, include: { addresses: true } })
  assert(stored?.ownerAddress === WALLET, 'Account.ownerAddress written')
  assert(stored?.twitterId === SUBJECT, 'the immutable X subject is stored')
  assert(stored?.addresses.length === 2, `one row per rail, not one per network (${stored?.addresses.length})`)
  assert(
    stored?.addresses.every((row) => row.provenance === 'PRIVY_EMBEDDED'),
    'every wallet row is labelled PRIVY_EMBEDDED',
  )
  assert(
    stored?.addresses.every((row) => row.proofSignature === null),
    'no signature is invented for an attested wallet',
  )

  // The two rails must never be filed against each other: an EVM address recorded under Solana
  // would be handed out as a Solana payee and the money would go nowhere.
  const evmRow = stored?.addresses.find((row) => row.address === WALLET)
  const solRow = stored?.addresses.find((row) => row.address === SOL_WALLET)
  assert(evmRow !== undefined && evmRow.chainKey !== 'solana', `the EVM wallet is filed under ${evmRow?.chainKey}`)
  assert(solRow?.chainKey === 'solana', `the Solana wallet is filed under ${solRow?.chainKey}`)
  assert(stored?.ownerAddress === WALLET, 'the primary address stays the EVM one — escrow lives there')

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

  step(6, 'each rail resolves to its own wallet, and never to the other one')
  response = await fetch(`${APP}/api/accounts/resolve?handle=e2erenamed&chainKey=base`)
  const evmResolved = await response.json()
  assert(response.ok, `resolve on base responded ${response.status}`)
  assert(evmResolved.address === WALLET, `@e2erenamed -> ${evmResolved.address} on Base`)

  response = await fetch(`${APP}/api/accounts/resolve?handle=e2erenamed&chainKey=solana`)
  const svmResolved = await response.json()
  assert(response.ok, `resolve on solana responded ${response.status}`)
  assert(svmResolved.address === SOL_WALLET, `@e2erenamed -> ${svmResolved.address} on Solana`)
  // The whole point of keeping the rails apart: paying the EVM address on Solana burns the money.
  assert(svmResolved.address !== WALLET, 'the Solana payee is never the EVM address')

  // A development network is absent from a production build, so it cannot be routed to at all.
  response = await fetch(`${APP}/api/accounts/resolve?handle=e2erenamed&chainKey=base-sepolia`)
  const dev = await response.json()
  assert(dev.address === null, `no address is offered for a network this build does not expose (${dev.address})`)

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
