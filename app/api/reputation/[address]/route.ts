import { NextRequest, NextResponse } from 'next/server'
import { reputationFor } from '@/lib/vaulted/server/reputation'
import { accountForAddress } from '@/lib/vaulted/server/accounts'

/**
 * GET /api/reputation/{address}
 *
 * Every figure is counted from escrows this wallet actually took part in. A wallet with no history
 * returns zeroes and `hasActivity: false` rather than a starter score.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  try {
    const reputation = await reputationFor(address)
    if (!reputation) return NextResponse.json({ error: 'Not a wallet address.' }, { status: 400 })
    const handle = await accountForAddress(address)
    return NextResponse.json({ reputation, handle: handle?.name ?? null })
  } catch (error) {
    console.error('[vaulted/reputation]', error)
    return NextResponse.json({ error: 'Unable to compute reputation.' }, { status: 500 })
  }
}
