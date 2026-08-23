import { NextRequest, NextResponse } from 'next/server'
import { linkWallet, requireAccount } from '@/lib/vaulted/server/accounts'
import { ApiError } from '@/lib/vaulted/server/auth'

/**
 * POST /api/account/wallet — attach a verified wallet to the signed-in account.
 *
 * Requires both a session and a signature: the session says which account, the signature proves the
 * wallet is actually yours.
 */
export async function POST(request: NextRequest) {
  try {
    const account = await requireAccount()
    const body = await request.json()
    const updated = await linkWallet({
      accountId: account.id,
      handle: account.name,
      chainKey: String(body.chainKey ?? ''),
      address: String(body.address ?? ''),
      issuedAt: Number(body.issuedAt),
      signature: String(body.signature ?? ''),
    })
    return NextResponse.json({ account: updated })
  } catch (error) {
    if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/account wallet]', error)
    return NextResponse.json({ error: 'Unable to link that wallet.' }, { status: 500 })
  }
}
