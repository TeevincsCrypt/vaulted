import { NextRequest, NextResponse } from 'next/server'
import {
  InvoiceError,
  serialiseChainRead,
  serialiseInvoice,
  syncInvoice,
} from '@/lib/vaulted/server/invoices'

/**
 * POST /api/invoices/{invoiceId}/sync
 *
 * Re-reads the escrow and refreshes the cached status. The cache exists so listings can be sorted
 * and filtered without an RPC round trip per row; it is never consulted in place of the chain when
 * deciding what a user can do.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params
  try {
    const { invoice, onChain, termsMatch } = await syncInvoice(invoiceId)
    return NextResponse.json({
      invoice: invoice ? serialiseInvoice(invoice) : null,
      onChain: serialiseChainRead(onChain),
      termsMatchChain: termsMatch,
    })
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/invoices/:id/sync]', error)
    return NextResponse.json({ error: 'Unable to sync with the chain.' }, { status: 500 })
  }
}
