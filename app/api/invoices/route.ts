import { NextRequest, NextResponse } from 'next/server'
import {
  InvoiceError,
  createInvoice,
  listInvoices,
  serialiseInvoice,
} from '@/lib/vaulted/server/invoices'

/** GET /api/invoices?payee=0x…  — payment requests a wallet created or was addressed. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  try {
    const invoices = await listInvoices({
      payee: params.get('payee') ?? undefined,
      payer: params.get('payer') ?? undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    })
    return NextResponse.json({ invoices: invoices.map(serialiseInvoice) })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/invoices — publish a payment request.
 *
 * Requires a signature from the payee over the canonical terms. This authenticates the link's
 * metadata; it does not create the escrow. The payee still sends `createEscrow` from the same
 * wallet, and the payment page verifies the on-chain terms hash before inviting anyone to pay.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const invoice = await createInvoice({
      invoiceId: String(body.invoiceId ?? ''),
      chainId: Number(body.chainId),
      payee: String(body.payee ?? ''),
      payer: body.payer ? String(body.payer) : null,
      amount: String(body.amount ?? ''),
      description: String(body.description ?? ''),
      protectionPeriod: Number(body.protectionPeriod ?? 0),
      fundingDeadline: body.fundingDeadline ? Number(body.fundingDeadline) : null,
      signature: String(body.signature ?? ''),
    })
    return NextResponse.json({ invoice: serialiseInvoice(invoice) }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

function errorResponse(error: unknown) {
  if (error instanceof InvoiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('[vaulted/invoices]', error)
  return NextResponse.json({ error: 'Unable to process the payment request.' }, { status: 500 })
}
