import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/vaulted/server/auth'
import { cancelPaymentRequest, PaymentRequestError } from '@/lib/vaulted/server/payment-requests'

/** POST /api/payment-requests/[id]/cancel — the creator's alone, and only while unpaid. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json({ request: await cancelPaymentRequest(id) })
  } catch (error) {
    if (PaymentRequestError.is(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/payment-requests cancel]', error)
    return NextResponse.json({ error: 'Unable to cancel that payment request.' }, { status: 500 })
  }
}
