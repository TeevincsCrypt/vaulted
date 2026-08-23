import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * Signed session cookies.
 *
 * A small HMAC-signed payload rather than a session table: there is nothing secret in it, only an
 * account id, and signing means the server does not have to be consulted to know it was not
 * tampered with. Comparison is constant-time, and an expired or re-signed cookie is rejected.
 *
 * AUTH_SECRET is required in production. There is deliberately no fallback default — a predictable
 * signing key would let anyone mint a session for any account.
 */

export const SESSION_COOKIE = 'vaulted_session'
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

export type SessionPayload = { accountId: string; name: string; exp: number }

function secret(): string {
  const value = process.env.AUTH_SECRET?.trim()
  if (!value || value.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short. Set a random value of at least 32 characters — ' +
        'sessions cannot be signed safely without one.',
    )
  }
  return value
}

export function hasAuthSecret(): boolean {
  const value = process.env.AUTH_SECRET?.trim()
  return Boolean(value && value.length >= 32)
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64url = (input: string) => Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function sign(body: string): string {
  return b64url(createHmac('sha256', secret()).update(body).digest())
}

export function encodeSession(payload: Omit<SessionPayload, 'exp'>): string {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
  const body = b64url(JSON.stringify(full))
  return `${body}.${sign(body)}`
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  let expected: string
  try {
    expected = sign(body)
  } catch {
    return null
  }

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload
    if (!payload.accountId || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  return decodeSession(store.get(SESSION_COOKIE)?.value)
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}

/** Random, URL-safe value for OAuth state and PKCE verifiers. */
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}
