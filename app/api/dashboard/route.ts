import { NextRequest, NextResponse } from 'next/server'
import { dashboardFor } from '@/lib/vaulted/server/dashboard'
import { serverRpcUrl } from '@/lib/vaulted/server/rpc'

/**
 * GET /api/dashboard?address=0x…
 *
 * Reads every one of the wallet's escrows from its chain. Rows that could not be read come back
 * with `live: false` and a reason, and are excluded from the totals rather than silently counted
 * from the cache.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')
  if (!address) return NextResponse.json({ error: 'Provide an address.' }, { status: 400 })

  try {
    const data = await dashboardFor(address, serverRpcUrl())
    if (!data) return NextResponse.json({ error: 'Not a wallet address.' }, { status: 400 })
    return NextResponse.json(data)
  } catch (error) {
    console.error('[vaulted/dashboard]', error)
    return NextResponse.json({ error: 'Unable to load the dashboard.' }, { status: 500 })
  }
}
