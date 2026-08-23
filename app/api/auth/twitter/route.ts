import { NextRequest, NextResponse } from 'next/server'
import { randomToken, sessionCookieOptions, hasAuthSecret } from '@/lib/vaulted/server/session'
import { authorizeUrl, callbackUrl, isTwitterConfigured } from '@/lib/vaulted/server/twitter'

/** GET /api/auth/twitter — begin the OAuth handshake. */
export async function GET(request: NextRequest) {
  if (!isTwitterConfigured() || !hasAuthSecret()) {
    return NextResponse.redirect(new URL('/login?error=not-configured', request.url))
  }

  const state = randomToken()
  const verifier = randomToken(48)
  const redirectUri = callbackUrl(request.url)

  const response = NextResponse.redirect(authorizeUrl({ state, verifier, redirectUri }))

  // Short-lived, httpOnly: the verifier must survive the round trip without being readable by
  // script, and must not outlive the handshake.
  const options = { ...sessionCookieOptions(600) }
  response.cookies.set('vaulted_oauth_state', state, options)
  response.cookies.set('vaulted_oauth_verifier', verifier, options)
  return response
}
