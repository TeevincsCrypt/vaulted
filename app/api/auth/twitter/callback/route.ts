import { NextRequest, NextResponse } from 'next/server'
import { upsertTwitterAccount } from '@/lib/vaulted/server/accounts'
import { encodeSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/vaulted/server/session'
import { callbackUrl, exchangeCode, fetchProfile, isTwitterConfigured } from '@/lib/vaulted/server/twitter'

/**
 * GET /api/auth/twitter/callback
 *
 * Verifies the `state` against the cookie set at the start of the handshake before touching the
 * code — without that check, an attacker could complete a login into someone else's browser.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, request.url))

  if (!isTwitterConfigured()) return fail('not-configured')
  if (url.searchParams.get('error')) return fail('denied')

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const expectedState = request.cookies.get('vaulted_oauth_state')?.value
  const verifier = request.cookies.get('vaulted_oauth_verifier')?.value

  if (!code || !state || !expectedState || state !== expectedState || !verifier) return fail('state')

  try {
    const accessToken = await exchangeCode({ code, verifier, redirectUri: callbackUrl(request.url) })
    const profile = await fetchProfile(accessToken)
    const account = await upsertTwitterAccount(profile)

    const response = NextResponse.redirect(new URL('/dashboard', request.url))
    response.cookies.set(
      SESSION_COOKIE,
      encodeSession({ accountId: account.id, name: account.name }),
      sessionCookieOptions(),
    )
    // The handshake is over; these must not linger.
    response.cookies.delete('vaulted_oauth_state')
    response.cookies.delete('vaulted_oauth_verifier')
    return response
  } catch (error) {
    console.error('[vaulted/auth callback]', error)
    return fail('exchange')
  }
}
