/**
 * Asks Privy what it actually sends X, and prints it.
 *
 * The OAuth authorize URL is built by Privy's backend, not by the SDK, so the `redirect_uri` that
 * X validates against your registered callbacks exists nowhere in this repo or in
 * `@privy-io/react-auth` — there is nothing to read it out of locally, and guessing it is how you
 * end up registering a URL that X rejects.
 *
 * So this makes the same call the browser makes. It replicates `POST /api/v1/oauth/init` exactly as
 * the SDK does (verified against `@privy-io/react-auth`: the `privy-app-id` / `privy-client` /
 * `privy-ca-id` headers, and a `{provider, redirect_to, code_challenge, state_code}` body with a
 * real PKCE S256 challenge), then parses the authorize URL Privy hands back and prints its
 * parameters. Nothing is completed: no browser opens, no account is touched, no token is issued.
 *
 * What it tells you:
 *   redirect_uri  the exact string to register in the X Developer Portal
 *   client_id     which X app Privy is using, so you can confirm it is the one you configured
 *   scope         what X is being asked for, so you can confirm "Read" is enough
 *
 * And if the call itself is refused, that is the answer too — an unallowed `redirect_to` means your
 * origin is missing from Privy's allowed domains, which is a different failure with the same
 * symptom.
 *
 * Run: npm run privy:probe -- --redirect-to https://your-domain
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

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

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 ? process.argv[index + 1] : undefined
}

const appId = flag('app-id') ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim()
const provider = flag('provider') ?? 'twitter'
const redirectTo = flag('redirect-to') ?? process.env.NEXT_PUBLIC_APP_URL?.trim()
const apiUrl = process.env.PRIVY_API_URL?.trim() || 'https://auth.privy.io'

if (!appId) {
  console.error(
    'No Privy app id. Set NEXT_PUBLIC_PRIVY_APP_ID in .env.local, or pass --app-id <id>.',
  )
  process.exit(1)
}
if (appId.length !== 25) {
  console.error(`"${appId}" is ${appId.length} characters. A Privy app id is exactly 25.`)
  process.exit(1)
}
if (!redirectTo) {
  console.error(
    'No return URL. Pass --redirect-to https://your-domain (the origin users sign in from),\n' +
      'or set NEXT_PUBLIC_APP_URL. This is where Privy sends the browser back afterwards — it is\n' +
      'not the X callback, but Privy checks it against your allowed domains, so it must be real.',
  )
  process.exit(1)
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// PKCE S256, the same shape the SDK generates.
const verifier = b64url(randomBytes(32))
const codeChallenge = b64url(createHash('sha256').update(verifier).digest())

const sdkVersion = JSON.parse(
  readFileSync(path.join(ROOT, 'node_modules/@privy-io/react-auth/package.json'), 'utf8'),
).version

console.log(`\nasking ${apiUrl} what it sends ${provider}`)
console.log(`  app id      ${appId}`)
console.log(`  return url  ${redirectTo}\n`)

let response
try {
  response = await fetch(`${apiUrl}/api/v1/oauth/init`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'privy-app-id': appId,
      'privy-client': `react-auth:${sdkVersion}`,
      'privy-ca-id': '',
    },
    body: JSON.stringify({
      provider,
      redirect_to: redirectTo,
      code_challenge: codeChallenge,
      state_code: b64url(randomBytes(16)),
    }),
  })
} catch (cause) {
  console.error(`Could not reach ${apiUrl}: ${cause instanceof Error ? cause.message : cause}`)
  console.error('Run this from a machine with outbound access to Privy.')
  process.exit(1)
}

const raw = await response.text()
let body
try {
  body = JSON.parse(raw)
} catch {
  body = null
}

if (!response.ok) {
  console.error(`Privy refused the request (HTTP ${response.status}).`)
  console.error(raw.slice(0, 600) || '(empty response)')
  console.error('')
  if (response.status === 400 || response.status === 403) {
    console.error('Most likely one of:')
    console.error(`  • "${redirectTo}" is not in this app's allowed domains in the Privy dashboard`)
    console.error(`  • ${provider} is not enabled as a login method for this app`)
    console.error('  • the OAuth credentials for that provider are missing or rejected')
  }
  process.exit(1)
}

const url = typeof body?.url === 'string' ? body.url : null
if (!url) {
  console.error('Privy returned no authorize URL:')
  console.error(raw.slice(0, 600))
  process.exit(1)
}

const parsed = new URL(url)
const redirectUri = parsed.searchParams.get('redirect_uri')

console.log(`authorize endpoint  ${parsed.origin}${parsed.pathname}\n`)
for (const [key, value] of parsed.searchParams) {
  // The challenge and state are per-request noise; everything else is configuration.
  if (key === 'code_challenge' || key === 'state') continue
  console.log(`  ${key.padEnd(22)}${value}`)
}

console.log('\n' + '─'.repeat(72))
if (redirectUri) {
  console.log('\nRegister this exact string as the callback URL in the X Developer Portal:\n')
  console.log(`  ${redirectUri}\n`)
  console.log('X matches it byte for byte — no trailing slash, no scheme or case changes.')
} else {
  console.log('\nThe authorize URL carries no redirect_uri parameter. Full URL:\n')
  console.log(`  ${url}`)
}
console.log('')
