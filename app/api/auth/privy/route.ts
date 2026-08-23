import { NextRequest, NextResponse } from 'next/server'
import { upsertPrivyAccount, currentAccount } from '@/lib/vaulted/server/accounts'
import { ApiError } from '@/lib/vaulted/server/auth'
import { fetchPrivyUser, isPrivyConfigured, PrivyError, verifyPrivyToken } from '@/lib/vaulted/server/privy'
import { encodeSession, hasAuthSecret, SESSION_COOKIE, sessionCookieOptions } from '@/lib/vaulted/server/session'

/**
 * POST /api/auth/privy — exchange a verified Privy access token for a Vaulted session.
 *
 * The browser hands over a token, nothing else. The handle, the display name and above all the
 * wallet address are read back from Privy with the app secret, so the request body cannot decide
 * who you are or which address gets paid.
 */
export async function POST(request: NextRequest) {
  if (!isPrivyConfigured() || !hasAuthSecret()) {
    return NextResponse.json(
      {
        error:
          'Sign-in is not configured on this deployment. NEXT_PUBLIC_PRIVY_APP_ID (a real 25-character ' +
          'Privy app id), PRIVY_APP_SECRET and AUTH_SECRET must all be set.',
      },
      { status: 503 },
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const header = request.headers.get('authorization')
    const token = typeof body?.token === 'string' && body.token ? body.token : (header ?? '')
    if (!token) return NextResponse.json({ error: 'No sign-in token supplied.' }, { status: 400 })

    const identity = await verifyPrivyToken(token)
    const user = await fetchPrivyUser(identity.userId)
    const account = await upsertPrivyAccount(user)

    const response = NextResponse.json({
      account: {
        id: account.id,
        name: account.name,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        primaryAddress: account.ownerAddress,
      },
      // Surfaced so the UI can say "your wallet is still being created" instead of showing a blank
      // address as if one existed.
      walletAssigned: Boolean(user.embeddedWallet),
    })
    response.cookies.set(
      SESSION_COOKIE,
      encodeSession({ accountId: account.id, name: account.name }),
      sessionCookieOptions(),
    )
    return response
  } catch (error) {
    if (PrivyError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/auth privy]', error)
    return NextResponse.json({ error: 'Could not complete sign-in.' }, { status: 500 })
  }
}

/** GET is the same session read as /api/auth/session, kept so a stale client cannot 405 silently. */
export async function GET() {
  const account = await currentAccount().catch(() => null)
  return NextResponse.json({ account })
}
