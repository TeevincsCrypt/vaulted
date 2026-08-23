/**
 * Pins Privy access-token verification.
 *
 * The session cookie is minted from whatever this verifier accepts, so a hole here is a hole in
 * every authenticated route. None of it needs a network: a throwaway P-256 keypair stands in for
 * the app's verification key, and the suite mints tokens against it.
 *
 * Run: tsx scripts/check-privy-token.mjs
 */
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto'

process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'test-app-id'
process.env.PRIVY_APP_SECRET = 'test-app-secret'

const { verifyPrivyToken, PrivyError, __setVerificationKeyForTest } = await import('../lib/vaulted/server/privy.ts')

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

__setVerificationKeyForTest(publicKey.export({ type: 'spki', format: 'pem' }).toString())

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`)
  if (!ok) failures++
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function mint({ header = {}, payload = {}, key = privateKey, tamper = false } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const fullHeader = { alg: 'ES256', typ: 'JWT', ...header }
  const fullPayload = {
    sub: 'did:privy:test-user',
    iss: 'privy.io',
    aud: 'test-app-id',
    sid: randomUUID(),
    iat: now,
    exp: now + 3600,
    ...payload,
  }
  const body = `${b64url(JSON.stringify(fullHeader))}.${b64url(JSON.stringify(fullPayload))}`
  const signer = createSign('sha256')
  signer.update(tamper ? `${body}x` : body)
  const signature = signer.sign({ key, dsaEncoding: 'ieee-p1363' })
  return `${body}.${b64url(signature)}`
}

const rejects = async (token, label) => {
  try {
    await verifyPrivyToken(token)
    check(false, `${label} (accepted, should have been rejected)`)
  } catch (error) {
    check(PrivyError.is(error), `${label} — ${error instanceof Error ? error.message : error}`)
  }
}

console.log('\n[1] A well-formed token from the app’s key is accepted')
const identity = await verifyPrivyToken(mint())
check(identity.userId === 'did:privy:test-user', `subject -> ${identity.userId}`)
check(typeof identity.sessionId === 'string', 'session id is carried through')
check((await verifyPrivyToken(`Bearer ${mint()}`)).userId === 'did:privy:test-user', 'a Bearer prefix is tolerated')
check(
  (await verifyPrivyToken(mint({ payload: { aud: ['test-app-id', 'other'] } }))).userId === 'did:privy:test-user',
  'an audience array containing the app id is accepted',
)

console.log('\n[2] Forgeries and mismatches are rejected')
await rejects(mint({ key: other.privateKey }), 'signed with a different key')
await rejects(mint({ tamper: true }), 'payload altered after signing')
await rejects(mint({ header: { alg: 'none' } }), 'alg: none')
await rejects(mint({ header: { alg: 'HS256' } }), 'alg downgraded to HMAC')
await rejects(mint({ header: { typ: 'at+jwt' } }), 'wrong token type')
await rejects(mint({ payload: { iss: 'evil.example' } }), 'issued by someone other than Privy')
await rejects(mint({ payload: { aud: 'another-app' } }), 'issued for another app')
await rejects(mint({ payload: { exp: Math.floor(Date.now() / 1000) - 1 } }), 'already expired')
await rejects(mint({ payload: { exp: undefined } }), 'no expiry at all')
await rejects(mint({ payload: { nbf: Math.floor(Date.now() / 1000) + 3600 } }), 'not valid yet')
await rejects(mint({ payload: { sub: '' } }), 'empty subject')
await rejects('not.a.token', 'unparseable token')
await rejects('two.parts', 'wrong number of segments')

console.log('\n[3] Without an app id nothing verifies, rather than defaulting to trust')
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID
await rejects(mint(), 'unconfigured deployment')
process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'test-app-id'

console.log(failures === 0 ? '\nAll Privy token checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
