import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/vaulted/server/auth'
import { linkAddress, resolveHandle, serialiseUsername } from '@/lib/vaulted/server/usernames'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const record = await resolveHandle(handle).catch(() => null)
  return record
    ? NextResponse.json({ username: serialiseUsername(record) })
    : NextResponse.json({ error: 'No such handle.' }, { status: 404 })
}

/** POST /api/usernames/{handle} — link a verified address for another chain. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  try {
    const body = await request.json()
    await linkAddress({
      handle,
      chainKey: String(body.chainKey ?? ''),
      address: String(body.address ?? ''),
      issuedAt: Number(body.issuedAt),
      signature: String(body.signature ?? ''),
    })
    const record = await resolveHandle(handle)
    return NextResponse.json({ username: record ? serialiseUsername(record) : null })
  } catch (error) {
    if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/usernames link]', error)
    return NextResponse.json({ error: 'Unable to link that address.' }, { status: 500 })
  }
}
