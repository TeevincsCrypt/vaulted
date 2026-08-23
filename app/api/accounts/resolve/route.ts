import { NextRequest, NextResponse } from 'next/server'
import { accountByHandle, resolvePayeeAddress } from '@/lib/vaulted/server/accounts'

/**
 * GET /api/accounts/resolve?handle=alice&chainKey=base-sepolia
 *
 * Turns a handle into the wallet that should be paid on that chain. Returns `address: null` when
 * the account exists but has linked no wallet — the caller must then refuse to build a payment
 * rather than fall back to something.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const handle = params.get('handle')
  const chainKey = params.get('chainKey')
  if (!handle || !chainKey) return NextResponse.json({ error: 'Provide handle and chainKey.' }, { status: 400 })

  const account = await accountByHandle(handle).catch(() => null)
  if (!account) return NextResponse.json({ found: false, address: null, handle: null })

  const address = await resolvePayeeAddress(handle, chainKey)
  return NextResponse.json({
    found: true,
    handle: account.name,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    address,
  })
}
