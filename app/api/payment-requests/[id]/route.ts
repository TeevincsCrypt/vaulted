import { NextResponse } from 'next/server'
import { getPaymentRequest } from '@/lib/vaulted/server/payment-requests'

/**
 * GET /api/payment-requests/[id] — what a payment link resolves to.
 *
 * Deliberately public and unauthenticated: the whole point of a payment link is that the person
 * paying does not have an account yet. Only payer-facing fields are returned.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const found = await getPaymentRequest(id).catch(() => null)
  if (!found) return NextResponse.json({ error: 'No such payment request.' }, { status: 404 })
  return NextResponse.json({ request: found })
}
