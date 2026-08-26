/**
 * The app's chrome fits at every width it is shown at.
 *
 * This exists because of a specific way a redesign breaks a product silently. Setting the primary
 * navigation in tracked capitals made every item wider than the sentence case it replaced, and at
 * 1440 the last link ran underneath the network pill and the notification bell — a real collision,
 * on the only navigation the app has, that no type check or unit test can see and that a
 * screenshot only catches if somebody happens to look at that exact width.
 *
 * So the collision is measured rather than eyeballed: the primary nav's right edge against the
 * left edge of the cluster beside it, across the widths where the decision actually changes.
 * Where the nav does not fit it is a menu instead and there is nothing to collide.
 *
 * The cluster's width is not a constant — it carries a pill naming the current network, so the
 * same build measures differently on "Base" and on "Base Sepolia". That is what broke a fixed
 * breakpoint, so this runs against whatever network the app under test is configured for, and
 * additionally asserts the nav is actually shown on a wide viewport: silently collapsing it to a
 * hamburger at 1600px would otherwise be a passing result.
 *
 * Also checks that no page scrolls sideways, which is the other classic redesign regression.
 *
 * Prerequisites: a built app running on APP_URL (default http://127.0.0.1:3520), DATABASE_URL and
 * AUTH_SECRET set — the signed-in chrome only renders for a real session.
 * Run: APP_URL=… npm run check:chrome
 */
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const require = createRequire('/opt/node22/lib/node_modules/playwright/')
const { chromium } = require('/opt/node22/lib/node_modules/playwright')

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3520'
const AUTH_SECRET = process.env.AUTH_SECRET
if (!AUTH_SECRET || !process.env.DATABASE_URL) {
  console.error('AUTH_SECRET and DATABASE_URL are required — the chrome needs a real session.')
  process.exit(1)
}

let failures = 0
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}

const prisma = new PrismaClient()
const b64 = (value) => Buffer.from(value).toString('base64url')
/*
  Carries a wallet, because the badge that shows one is wider than the "No wallet" placeholder and
  it is the cluster's width that decides whether the navigation fits. Measuring against an account
  with nothing in it would be measuring the easy case.
*/
const account =
  (await prisma.account.findFirst({ where: { name: 'chromecheck' } })) ??
  (await prisma.account.create({
    data: {
      name: 'chromecheck',
      twitterId: 'chrome-t',
      privyUserId: 'chrome-p',
      ownerAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      ownerChainKey: 'base',
      addresses: {
        create: [
          {
            chainKey: 'base',
            address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
            provenance: 'PRIVY_EMBEDDED',
          },
        ],
      },
    },
  }))
const payload = b64(
  JSON.stringify({ accountId: account.id, name: account.name, exp: Math.floor(Date.now() / 1000) + 3600 }),
)
const cookie = `${payload}.${b64(createHmac('sha256', AUTH_SECRET).update(payload).digest())}`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

console.log('\nthe primary navigation never runs under the cluster beside it:\n')
// Spanning the breakpoint in both directions, so a breakpoint set where the row does not yet fit
// fails here rather than shipping.
for (const width of [1600, 1440, 1400, 1360, 1340, 1280, 1180, 1024, 900, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  await context.addCookies([{ name: 'vaulted_session', value: cookie, domain: '127.0.0.1', path: '/' }])
  const page = await context.newPage()
  await page.goto(`${APP}/dashboard`, { waitUntil: 'networkidle', timeout: 45_000 })

  const measured = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Primary"]')
    if (!nav) return { shown: false, overlap: 0 }
    // Parked off screen rather than unmounted when it does not fit, so that it stays measurable —
    // `visibility` is what says which of the two states it is in, not `display`.
    const style = getComputedStyle(nav)
    if (style.display === 'none' || style.visibility === 'hidden') return { shown: false, overlap: 0 }
    const cluster = document.querySelector('header .shrink-0.items-center')
    const navBox = nav.getBoundingClientRect()
    const clusterBox = cluster?.getBoundingClientRect()
    return {
      shown: true,
      overlap: clusterBox ? Math.max(0, Math.round(navBox.right - clusterBox.left)) : 0,
    }
  })
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  check(
    measured.overlap === 0,
    `${String(width).padEnd(4)} — nav ${measured.shown ? 'shown' : 'in menu'}, overlap ${measured.overlap}px`,
  )
  // A hamburger at 1600px is a regression too, just a quieter one than an overlap.
  if (width >= 1600) {
    check(measured.shown, `${String(width).padEnd(4)} — full nav is shown, not collapsed to a menu`)
  }
  check(sideways === 0, `${String(width).padEnd(4)} — no sideways scroll (${sideways}px)`)
  await context.close()
}

await browser.close()
await prisma.account.deleteMany({ where: { name: 'chromecheck' } }).catch(() => {})
await prisma.$disconnect()

console.log(failures === 0 ? '\nApp chrome fits at every width.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
