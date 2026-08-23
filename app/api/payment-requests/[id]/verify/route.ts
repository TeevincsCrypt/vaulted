import { NextRequest, NextResponse } from 'next/server'
import { PaymentRequestError, verifyPaymentRequest } from '@/lib/vaulted/server/payment-requests'

/**
 * POST /api/payment-requests/[id]/verify — check a claimed transaction against the network.
 *
 * Unauthenticated on purpose: the person who can prove a payment is the payer, and they are not
 * signed in. Nothing is taken on trust — the hash is read back off the chain, and the only thing a
 * caller achieves by lying is a rejection. This is the only path that can set PAID.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const reference = String(body.txHash ?? body.signature ?? body.reference ?? '')

    const result = await verifyPaymentRequest(id, reference)
    return NextResponse.json(result, { status: result.verified ? 200 : 202 })
  } catch (error) {
    if (PaymentRequestError.is(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[vaulted/payment-requests verify]', error)
    return NextResponse.json({ error: 'Unable to verify that payment.' }, { status: 500 })
  }
}
