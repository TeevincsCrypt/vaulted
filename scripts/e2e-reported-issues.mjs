/**
 * The four things the user reported broken, each driven the way they hit it.
 *
 * Written as a regression test rather than a one-off because every one of these was invisible from
 * the layer below: the notification API was correct while the bell showed nothing, and the pay page
 * and "secure the budget" both returned 200 while being useless to the person looking at them.
 *
 *   1. Applying to a job notifies the person who posted it, and the bell shows it.
 *   2. Opening a payment addressed to you renders a page that can actually pay it.
 *   3. "Secure the budget" never leads to a page that can only say escrow is unavailable.
 *   4. Solana can send: Privy has an RPC to broadcast through, and the proxy behind it works.
 *
 * Prerequisites: DATABASE_URL set, Playwright available. This script builds its own copy of the
 * app with `NEXT_PUBLIC_PRIVY_APP_ID` baked in — see the note above the build step for why an
 * ambient `.next` from some other build cannot be reused here.
 * Run: npm run e2e:issues
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { privateKeyToAccount } from 'viem/accounts'
import { PrismaClient } from '@prisma/client'
import { jobAcceptMessage, jobApplicationMessage, jobCreationMessage } from '../lib/vaulted/messages.ts'

const require = createRequire('/opt/node22/lib/node_modules/playwright/')
const { chromium } = require('/opt/node22/lib/node_modules/playwright')

const ROOT = path.join(import.meta.dirname, '..')
for (const file of ['.env.local', '.env']) {
  const full = path.join(ROOT, file)
  if (!existsSync(full)) continue
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — this check writes to a real database.')
  process.exit(1)
}

const PORT = Number(process.env.VAULTED_E2E_PORT ?? 3499)
const APP = `http://127.0.0.1:${PORT}`
const AUTH_SECRET = 'issues-auth-secret-that-is-comfortably-long-enough'
// A syntactically valid Privy app id, so the provider mounts and the Solana config is exercised.
// Privy's own API is never reached, and nothing here depends on it being reachable.
const PRIVY_APP_ID = 'clzzzzzzz0000000zzzzzzzzz'

const CLIENT = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const WORKER = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6')
const CLIENT_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const WORKER_SOL = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const JOB_ID = 'job_issues0000000001'

let failures = 0
const step = (n, s) => console.log(`\n[${n}] ${s}`)
const check = (ok, msg) => {
  console.log(`   ${ok ? 'ok  ' : 'FAIL'}: ${msg}`)
  if (!ok) failures++
}

const prisma = new PrismaClient()
const b64url = (v) => Buffer.from(v).toString('base64url')
const sessionValue = (account) => {
  const p = b64url(JSON.stringify({ accountId: account.id, name: account.name, exp: Math.floor(Date.now() / 1000) + 3600 }))
  return `${p}.${b64url(createHmac('sha256', AUTH_SECRET).update(p).digest())}`
}
const api = (p, { cookie, method = 'GET', body } = {}) =>
  fetch(`${APP}${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `vaulted_session=${cookie}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

const names = ['issuesclient', 'issuesworker']
async function wipe() {
  const accounts = await prisma.account.findMany({ where: { name: { in: names } }, select: { id: true } })
  const ids = accounts.map((a) => a.id)
  await prisma.paymentRequest.deleteMany({ where: { OR: [{ creatorId: { in: ids } }, { jobId: JOB_ID }] } })
  await prisma.job.deleteMany({ where: { id: JOB_ID } })
  await prisma.notification.deleteMany({ where: { accountId: { in: ids } } })
  await prisma.linkedWallet.deleteMany({ where: { usernameId: { in: ids } } })
  await prisma.linkedWallet.deleteMany({ where: { address: { in: [CLIENT.address, WORKER.address, CLIENT_SOL, WORKER_SOL] } } })
  await prisma.account.deleteMany({ where: { id: { in: ids } } })
}
await wipe()

const client = await prisma.account.create({ data: {
  name: 'issuesclient', privyUserId: 'did:privy:issues-c', twitterId: 'issues-c',
  ownerAddress: CLIENT.address, ownerChainKey: 'base',
  addresses: { create: [
    { chainKey: 'base', address: CLIENT.address, provenance: 'PRIVY_EMBEDDED' },
    { chainKey: 'solana', address: CLIENT_SOL, provenance: 'PRIVY_EMBEDDED' }] } } })
const worker = await prisma.account.create({ data: {
  name: 'issuesworker', privyUserId: 'did:privy:issues-w', twitterId: 'issues-w',
  ownerAddress: WORKER.address, ownerChainKey: 'base',
  addresses: { create: [
    { chainKey: 'base', address: WORKER.address, provenance: 'PRIVY_EMBEDDED' },
    { chainKey: 'solana', address: WORKER_SOL, provenance: 'PRIVY_EMBEDDED' }] } } })
const clientCookie = sessionValue(client)
const workerCookie = sessionValue(worker)

const RUNTIME_ENV = {
  ...process.env,
  AUTH_SECRET,
  NEXT_PUBLIC_PRIVY_APP_ID: PRIVY_APP_ID,
  NODE_ENV: 'production',
}

/*
 * `NEXT_PUBLIC_` variables are inlined at build time into every bundle Next.js produces, server
 * included — not just the browser one — so setting `NEXT_PUBLIC_PRIVY_APP_ID` only for `next
 * start` has no effect on a build that was produced without it. Several checks below exist
 * specifically to exercise the Privy-configured code paths (the in-app Solana pay button, the
 * export controls in Settings); against a build with no app id baked in they still pass, but
 * vacuously — the condition they are meant to test never becomes true. Building it here removes
 * that trap regardless of what `.next` happened to be sitting on disk already.
 */
console.log('Building the app with a Privy app id baked in…')
const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', env: RUNTIME_ENV })
if (build.status !== 0) {
  console.error('The build failed — see output above.')
  process.exit(1)
}

const app = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: ROOT, detached: true,
  env: RUNTIME_ENV,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const log = []
app.stdout.on('data', (d) => log.push(String(d)))
app.stderr.on('data', (d) => log.push(String(d)))

async function shutdown(code) {
  try { process.kill(-app.pid, 'SIGKILL') } catch {}
  await wipe().catch(() => {})
  await prisma.$disconnect()
  process.exit(code)
}

const now = () => Math.floor(Date.now() / 1000)

try {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${APP}/api/config`); if (r.status < 500) break } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const context = await browser.newContext()
  await context.addCookies([{ name: 'vaulted_session', value: clientCookie, domain: '127.0.0.1', path: '/' }])
  const page = await context.newPage()
  /*
    Privy's provider does not render identically on the server and the client, so every page it is
    mounted on logs React's recoverable hydration error. It predates this work, React re-renders
    the subtree and carries on, and it is not what any of these checks are about — so it is
    excluded by name rather than by ignoring errors wholesale. Anything else still fails.
  */
  const IGNORED = /Minified React error #(418|423|425)|Hydration failed|hydrat/i
  const pageErrors = []
  page.on('pageerror', (e) => { if (!IGNORED.test(String(e))) pageErrors.push(String(e)) })

  /* ------------------------------------------------------- 1. notifications */

  step(1, 'applying to a job notifies whoever posted it, and the bell shows it')

  let issuedAt = now()
  let signature = await CLIENT.signMessage({ message: jobCreationMessage({
    jobId: JOB_ID, title: 'Solana landing page', budgetAmount: '1000000',
    chainKey: 'solana', client: CLIENT.address, issuedAt }) })
  let response = await api('/api/jobs', { cookie: clientCookie, method: 'POST', body: {
    jobId: JOB_ID, title: 'Solana landing page', description: 'A page, paid in Solana USDC.',
    budgetAmount: '1000000', chainKey: 'solana', deadline: null, protectionPeriod: 86400,
    clientAddress: CLIENT.address, issuedAt, signature } })
  check(response.ok, `the job posts on Solana (${response.status})`)

  // The client is looking at the app when the application lands, which is when they said they saw
  // nothing. Load the page first, then apply, then let the bell poll.
  await page.goto(`${APP}/jobs/${JOB_ID}`, { waitUntil: 'networkidle', timeout: 45_000 })
  check(pageErrors.length === 0, `the job page raises no errors${pageErrors[0] ? `: ${pageErrors[0].slice(0, 180)}` : ''}`)

  issuedAt = now()
  signature = await WORKER.signMessage({ message: jobApplicationMessage({ jobId: JOB_ID, applicant: WORKER.address, issuedAt }) })
  response = await api(`/api/jobs/${JOB_ID}/applications`, { cookie: workerCookie, method: 'POST', body: {
    applicantAddress: WORKER.address, message: 'I build these.', issuedAt, signature } })
  check(response.ok, `the worker applies (${response.status})`)

  const stored = await prisma.notification.findMany({ where: { accountId: client.id, type: 'JOB_APPLICATION' } })
  check(stored.length === 1, `a JOB_APPLICATION notification is written for the poster (${stored.length})`)
  check(stored[0]?.body?.includes('@issuesworker'), `and names who applied (${stored[0]?.body ?? 'none'})`)

  const served = await (await api('/api/notifications', { cookie: clientCookie })).json()
  check(served.unread === 1, `the API reports it unread (${served.unread})`)

  // The bell polls on an interval; wait for it rather than reloading, because the complaint was
  // specifically about not being told while sitting on the page.
  const badge = page.locator('button[aria-label*="unread"]')
  await badge.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
  check(await badge.count() > 0, 'the bell shows an unread badge without a reload')
  if (await badge.count() > 0) {
    await badge.click()
    await page.waitForTimeout(600)
    const panel = await page.locator('body').innerText()
    check(/New applicant/i.test(panel), 'and the panel names the new applicant')
    check(/@issuesworker/i.test(panel), 'with the handle that applied')
  }

  /* ------------------------------------------------- 2 & 3. hire, then pay */

  step(2, 'hiring raises a payment, and the pages that follow it work')

  issuedAt = now()
  signature = await CLIENT.signMessage({ message: jobAcceptMessage({
    jobId: JOB_ID, applicant: WORKER.address, client: CLIENT.address, issuedAt }) })
  response = await api(`/api/jobs/${JOB_ID}/accept`, { cookie: clientCookie, method: 'POST', body: {
    applicantAddress: WORKER.address, clientAddress: CLIENT.address, issuedAt, signature } })
  check(response.ok, `the client hires (${response.status})`)

  const jobView = await (await api(`/api/jobs/${JOB_ID}`)).json()
  check(jobView.payment?.id, `a payment for the budget exists (${jobView.payment?.id ?? 'none'})`)

  const hired = await prisma.notification.findFirst({ where: { accountId: worker.id, type: 'JOB_HIRED' } })
  check(Boolean(hired), 'the worker is told they were hired')
  check(hired?.href === `/jobs/${JOB_ID}`,
    `and is not sent to the escrow page on a network with no escrow (${hired?.href})`)
  check(!/Raise the escrow/i.test(hired?.body ?? ''), 'nor told to raise one')

  pageErrors.length = 0
  await page.goto(`${APP}/pay/${jobView.payment.id}`, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForTimeout(1200)
  const payText = await page.locator('body').innerText()
  check(pageErrors.length === 0, `the pay page raises no errors${pageErrors[0] ? `: ${pageErrors[0].slice(0, 200)}` : ''}`)
  check(payText.length > 200, `and renders (${payText.length} chars)`)
  check(!/Application error|client-side exception/i.test(payText), 'with no React crash')
  // The wallet cannot load without reaching Privy, so the page must say so rather than leaving the
  // "or pay another way" divider hanging over nothing.
  check(!/or pay from another wallet/i.test(payText) || /Vaulted wallet has not loaded/i.test(payText),
    'and never shows a divider with no button above it')

  step(3, '"secure the budget" never leads to a page that can only refuse')

  pageErrors.length = 0
  await page.goto(`${APP}/request?job=${JOB_ID}`, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForTimeout(800)
  const secureText = await page.locator('body').innerText()
  check(pageErrors.length === 0, 'the secure-budget page raises no errors')
  check(/paid directly/i.test(secureText), 'it explains that the budget is paid directly')
  check(!/is unavailable|no network can hold an escrow/i.test(secureText),
    'rather than only saying escrow is unavailable')

  // And "My work" must not offer the button that led there.
  const workContext = await browser.newContext()
  await workContext.addCookies([{ name: 'vaulted_session', value: workerCookie, domain: '127.0.0.1', path: '/' }])
  const workPage = await workContext.newPage()
  await workPage.goto(`${APP}/work`, { waitUntil: 'networkidle', timeout: 45_000 })
  await workPage.waitForTimeout(1200)
  const workText = await workPage.locator('body').innerText()
  check(!/Secure the budget/i.test(workText), 'My work does not offer to secure a budget it cannot')
  check(/paid directly|pays .* straight to your wallet|client to pay/i.test(workText),
    'and says how the job is actually paid')

  /* ------------------------------------------------------------ 4. Solana */

  step(4, 'Solana can send: the RPC Privy broadcasts through is reachable')

  /*
    Outbound Solana is blocked from this sandbox, so whatever the cluster would say cannot be
    checked here — only that the proxy forwards a permitted method rather than refusing it, and
    that it speaks JSON-RPC whatever comes back.
  */
  const rpcOk = await api('/api/solana/rpc', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'getHealth' } })
  const rpcBody = await rpcOk.json().catch(() => ({}))
  check(!/not proxied/i.test(rpcBody.error?.message ?? ''),
    `the proxy forwards a permitted method (${rpcOk.status})`)
  check(!('error' in rpcBody) || typeof rpcBody.error?.message === 'string',
    'and speaks JSON-RPC either way')

  const rpcBlocked = await api('/api/solana/rpc', { method: 'POST', body: { jsonrpc: '2.0', id: 2, method: 'requestAirdrop', params: [] } })
  const blockedBody = await rpcBlocked.json()
  check(rpcBlocked.status === 400 && /not proxied/i.test(blockedBody.error?.message ?? ''),
    'and refuses a method that is not needed for sending')

  const oversized = await fetch(`${APP}/api/solana/rpc`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'sendTransaction', params: ['x'.repeat(250_000)] }),
  })
  check(oversized.status === 413, `and refuses an oversized body (${oversized.status})`)

  // The page that does the sending must carry an RPC for Privy to use, or signing throws
  // "No RPC configuration found for chain solana:mainnet" the moment the user approves.
  const wired = await page.evaluate(async () => {
    const response = await fetch('/api/solana/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    })
    return response.status
  })
  check(typeof wired === 'number' && wired !== 404 && wired !== 400,
    `the browser can reach the proxy on its own origin (${wired})`)

  // Withdrawing needs a session and refuses everything it should.
  const badDestination = await api('/api/solana/withdraw', { cookie: clientCookie, method: 'POST', body: { to: '0x1234', amount: '1000' } })
  check(badDestination.status === 400, `withdraw refuses an EVM address (${badDestination.status})`)
  const ownWallet = await api('/api/solana/withdraw', { cookie: clientCookie, method: 'POST', body: { to: CLIENT_SOL, amount: '1000' } })
  check(ownWallet.status === 400, `withdraw refuses sending to itself (${ownWallet.status})`)
  const signedOut = await api('/api/solana/withdraw', { method: 'POST', body: { to: WORKER_SOL, amount: '1000' } })
  check(signedOut.status === 401, `withdraw refuses a signed-out caller (${signedOut.status})`)
  const notMine = await api('/api/solana/transfer', { cookie: workerCookie, method: 'POST', body: { requestId: jobView.payment.id } })
  check(notMine.status === 400, `paying your own request is refused (${notMine.status})`)

  /*
    The endpoint the "pay" and "send" buttons actually call must never hang: it is what stands
    between the click and the wallet's approval screen appearing, and a stall here is exactly what
    reads as "the popup is slow" or "the popup doesn't load" — regardless of the payer's own
    connection, since the popup is never asked to open at all until this responds. Outbound Solana
    is blocked from this sandbox, so the call is expected to fail; what matters is that it fails
    fast and honestly rather than hanging until something else times out.
  */
  const buildStartedAt = Date.now()
  const build = await api('/api/solana/transfer', { cookie: clientCookie, method: 'POST', body: { requestId: jobView.payment.id } })
  const buildElapsedMs = Date.now() - buildStartedAt
  const buildBody = await build.json().catch(() => ({}))
  check(buildElapsedMs < 30_000, `building the transaction never hangs (took ${(buildElapsedMs / 1000).toFixed(1)}s)`)
  check(
    build.status === 200 || /could not be reached|unreachable/i.test(buildBody.error ?? ''),
    `either it succeeds, or it fails with an honest reason rather than a generic 500 (${build.status}: ${buildBody.error ?? 'no body'})`,
  )

  step(5, 'the Solana private key can be exported, same as the EVM one')

  /*
    What this can and cannot prove here: this sandbox cannot reach Privy at all, so there is no way
    to hold a genuine, browser-side Privy session — this test's own `vaulted_session` cookie
    authenticates it to Vaulted, but Privy's own SDK never sees a signed-in user or a loaded
    wallet, on either rail. Both export buttons are therefore expected to render in their disabled
    "no wallet loaded" state, same as the EVM one always has. What is actually new, and what this
    proves, is that the Solana control exists at all, is wired the same way as the EVM one, and is
    a genuinely separate control — not that either can complete a live export, which no automated
    check running here ever could.
  */
  await page.goto(`${APP}/settings`, { waitUntil: 'networkidle', timeout: 45_000 })
  const settingsText = await page.locator('body').innerText()
  check(/No EVM wallet to export yet/i.test(settingsText), 'the EVM export control renders (unloaded, as expected here)')
  check(/No Solana wallet to export yet/i.test(settingsText),
    'and a distinct Solana export control now exists alongside it — this is the fix')

  const evmExportControl = page.getByRole('button', { name: /No EVM wallet to export yet/i })
  const solanaExportControl = page.getByRole('button', { name: /No Solana wallet to export yet/i })
  check(await evmExportControl.count() === 1, 'exactly one EVM export control')
  check(await solanaExportControl.count() === 1, 'exactly one Solana export control')
  check(
    (await evmExportControl.first().textContent()) !== (await solanaExportControl.first().textContent()),
    'and they are two distinct controls, not the same button rendered twice',
  )

  await browser.close()
  console.log(failures === 0 ? '\nAll reported-issue checks passed.\n' : `\n${failures} check(s) failed.\n`)
  if (failures > 0) console.log(log.join('').slice(-3000))
  await shutdown(failures === 0 ? 0 : 1)
} catch (error) {
  console.error('\nunexpected failure:', error)
  console.log(log.join('').slice(-3000))
  await shutdown(1)
}
