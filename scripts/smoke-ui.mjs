/**
 * Does the signed-in app actually render?
 *
 * The API checks pin what the server will and will not do. This pins the other half: that the
 * pages a signed-in account lands on come up with content on them. Every one of these routes has
 * blanked out at some point — a chain read with no deadline, a component gated on an escrow that
 * does not exist — and each time it looked identical from the API side, which was fine.
 *
 * So the assertions are deliberately dumb: a 200, some text, no React crash, no console error. A
 * page that renders its own honest "not available" message passes; a page that renders nothing
 * does not.
 *
 * The post-job form gets its own attention because refusing to open is exactly what it did.
 *
 * With no Privy app id configured there is no signer, so the pages correctly end in a sign-in
 * state rather than a transaction button. That is the app working, and the checks below say so
 * rather than requiring a wallet this environment cannot have.
 *
 * Prerequisites: `npm run build`, DATABASE_URL set, and Playwright available.
 * Run: npm run smoke:ui
 */
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PrismaClient } from '@prisma/client'

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

const PORT = 3466
const APP = `http://127.0.0.1:${PORT}`
const AUTH_SECRET = 'smoke-auth-secret-that-is-comfortably-long-enough'
const EVM = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

const prisma = new PrismaClient()
let failures = 0
const check = (ok, label) => { if (!ok) failures++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}: ${label}`) }

await prisma.paymentRequest.deleteMany({ where: { creator: { name: 'smoketester' } } })
await prisma.linkedWallet.deleteMany({ where: { address: { in: [EVM, SOL] } } })
await prisma.account.deleteMany({ where: { name: 'smoketester' } })
const account = await prisma.account.create({
  data: {
    name: 'smoketester', privyUserId: 'did:privy:smoke', twitterId: 'smoke-1',
    ownerAddress: EVM, ownerChainKey: 'base',
    addresses: { create: [
      { chainKey: 'base', address: EVM, provenance: 'PRIVY_EMBEDDED' },
      { chainKey: 'solana', address: SOL, provenance: 'PRIVY_EMBEDDED' },
    ] },
  },
})

const b64url = (v) => Buffer.from(v).toString('base64url')
const payload = { accountId: account.id, name: account.name, exp: Math.floor(Date.now() / 1000) + 3600 }
const body = b64url(JSON.stringify(payload))
const cookieValue = `${body}.${b64url(createHmac('sha256', AUTH_SECRET).update(body).digest())}`

const app = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: ROOT, detached: true,
  env: { ...process.env, AUTH_SECRET, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const log = []
app.stdout.on('data', (d) => log.push(String(d)))
app.stderr.on('data', (d) => log.push(String(d)))

async function stop(code) {
  try { process.kill(-app.pid, 'SIGKILL') } catch {}
  await prisma.paymentRequest.deleteMany({ where: { creatorId: account.id } })
  await prisma.linkedWallet.deleteMany({ where: { usernameId: account.id } })
  await prisma.account.deleteMany({ where: { id: account.id } })
  await prisma.$disconnect()
  process.exit(code)
}

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${APP}/api/config`); if (r.ok || r.status < 500) break } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const context = await browser.newContext()
  await context.addCookies([{ name: 'vaulted_session', value: cookieValue, domain: '127.0.0.1', path: '/' }])
  const page = await context.newPage()

  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  for (const route of ['/jobs', '/payment-requests', '/funds', '/dashboard', '/work', '/jobs/posted', '/activity']) {
    pageErrors.length = 0
    const response = await page.goto(`${APP}${route}`, { waitUntil: 'networkidle', timeout: 45_000 })
    const text = (await page.locator('body').innerText()).trim()
    check(response.status() === 200, `${route} responds 200 (${response.status()})`)
    check(text.length > 60, `${route} renders content (${text.length} chars)`)
    check(!/Application error|client-side exception/i.test(text), `${route} has no React crash`)
    check(pageErrors.length === 0, `${route} raises no page errors${pageErrors.length ? `: ${pageErrors[0].slice(0, 160)}` : ''}`)
  }

  // The specific thing the user hit: opening the post-job form must not refuse.
  await page.goto(`${APP}/jobs`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /post a job/i }).click()
  await page.waitForTimeout(400)
  const jobsText = await page.locator('body').innerText()
  check(!/no network has a deployed escrow, so a job cannot be posted/i.test(jobsText),
    'the post-job form no longer refuses on escrow grounds')
  check(/Post work with a budget/i.test(jobsText), 'the post-job form opens')
  check(/Where the budget will be paid/i.test(jobsText), 'and offers a network to post on')
  check(/no escrow contract in this deployment/i.test(jobsText),
    'and says plainly that the budget will not be held')
  // With no Privy app id here there is no signer, so the form correctly offers sign-in instead of
  // the post button. Either is the form working; neither is the escrow refusal the user hit.
  // With no Privy app id here there is no signer, so the form correctly ends in the sign-in state
  // rather than the post button. Either is the form working; neither is the escrow refusal.
  check(/Post job on|Sign in to post a job|Sign-in is not configured/i.test(jobsText),
    'the form ends in an action, not a dead end')
  check(!/Applied to the escrow once it is funded/i.test(jobsText),
    'and does not ask for an escrow setting on a network with no escrow')

  // Addressing a request to a handle must be offered.
  await page.goto(`${APP}/payment-requests`, { waitUntil: 'networkidle' })
  const prText = await page.locator('body').innerText()
  check(/A Vaulted @handle/i.test(prText), 'a request can be addressed to a handle')
  check(/Solana/i.test(prText), 'and raised on Solana')

  // With something owed, the incoming section appears.
  const owed = await prisma.paymentRequest.create({
    data: {
      id: `pr_${'5'.repeat(20)}`,
      creatorId: account.id,
      payerAccountId: account.id,
      amount: '1000000',
      currency: 'USDC',
      network: 'solana',
      description: 'Smoke: something owed',
      recipientAddress: SOL,
    },
  })
  await page.goto(`${APP}/payment-requests`, { waitUntil: 'networkidle' })
  const owedText = await page.locator('body').innerText()
  check(/Asked of you/i.test(owedText), 'what you have been asked to pay is listed')
  check(/Smoke: something owed/i.test(owedText), 'with the description of the request')
  await prisma.paymentRequest.delete({ where: { id: owed.id } })

  await browser.close()
  console.log(failures === 0 ? '\nAll UI smoke checks passed.\n' : `\n${failures} check(s) failed.\n`)
  if (failures) console.log(log.join('').slice(-2000))
  await stop(failures === 0 ? 0 : 1)
} catch (error) {
  console.error('unexpected failure:', error)
  console.log(log.join('').slice(-2000))
  await stop(1)
}
