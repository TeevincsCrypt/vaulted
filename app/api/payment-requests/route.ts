import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/vaulted/server/auth'
import {
  availablePaymentNetworks,
  createPaymentRequest,
  listIncomingPaymentRequests,
  listPaymentRequests,
  PaymentRequestError,
} from '@/lib/vaulted/server/payment-requests'

/** GET /api/payment-requests — everything the signed-in account has asked for. */
export async function GET() {
  try {
    const [requests, incoming] = await Promise.all([
      listPaymentRequests(),
      listIncomingPaymentRequests(),
    ])
    return NextResponse.json({ requests, incoming, networks: availablePaymentNetworks() })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/payment-requests — raise one.
 *
 * The body carries the ask, never the payee: the recipient is looked up from the creator's
 * recorded wallet for that network.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const created = await createPaymentRequest({
      network: String(body.network ?? ''),
      amount: String(body.amount ?? ''),
      description: String(body.description ?? ''),
      expiresInHours: body.expiresInHours ? Number(body.expiresInHours) : null,
      toHandle: body.toHandle ? String(body.toHandle) : null,
    })
    return NextResponse.json({ request: created }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

function errorResponse(error: unknown) {
  if (PaymentRequestError.is(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[vaulted/payment-requests]', error)
  return NextResponse.json({ error: 'Unable to process that payment request.' }, { status: 500 })
}
