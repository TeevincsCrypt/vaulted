import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/vaulted/server/auth'
import { claimUsername, handleForAddress, resolveHandle, serialiseUsername } from '@/lib/vaulted/server/usernames'

/** GET /api/usernames?handle=alice — or ?address=0x… for the reverse lookup. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const handle = params.get('handle')
  const address = params.get('address')

  try {
    if (handle) {
      const record = await resolveHandle(handle)
      return record
        ? NextResponse.json({ username: serialiseUsername(record) })
        : NextResponse.json({ error: 'No such handle.' }, { status: 404 })
    }
    if (address) {
      const record = await handleForAddress(address, params.get('chainKey') ?? undefined)
      return NextResponse.json({ handle: record?.name ?? null })
    }
    return NextResponse.json({ error: 'Provide handle or address.' }, { status: 400 })
  } catch (error) {
    return errorResponse(error, 'usernames GET')
  }
}

/**
 * POST /api/usernames — claim a handle.
 *
 * Requires a signature over the canonical claim message from the wallet being claimed for. There is
 * no unsigned path and no operator override.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const record = await claimUsername({
      handle: String(body.handle ?? ''),
      address: String(body.address ?? ''),
      chainKey: String(body.chainKey ?? ''),
      issuedAt: Number(body.issuedAt),
      signature: String(body.signature ?? ''),
    })
    return NextResponse.json({ username: serialiseUsername(record) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'usernames POST')
  }
}

function errorResponse(error: unknown, scope: string) {
  if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(`[vaulted/${scope}]`, error)
  return NextResponse.json({ error: 'Unable to process the request.' }, { status: 500 })
}
