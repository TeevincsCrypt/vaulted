import { NextRequest, NextResponse } from 'next/server'
import { readEscrow } from '@/lib/vaulted/server/chain'
import {
  InvoiceError,
  getInvoice,
  recordTransaction,
  serialiseChainRead,
  serialiseInvoice,
} from '@/lib/vaulted/server/invoices'
import { detailsHash } from '@/lib/vaulted/invoice'
import { ZERO_ADDRESS } from '@/lib/vaulted/config'

/**
 * GET /api/invoices/{invoiceId}
 *
 * Returns the stored metadata alongside a live read of the escrow. The on-chain block is the
 * authority; when the RPC endpoint is unreachable it comes back as `{ available: false, reason }`
 * rather than falling back to the cached status as though it were current.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params
  const invoice = await getInvoice(invoiceId)
  if (!invoice) return NextResponse.json({ error: 'Payment request not found.' }, { status: 404 })

  const onChain = await readEscrow(invoice.escrowId as `0x${string}`, invoice.chainId)

  // Recomputing the commitment here proves the metadata we are serving is the metadata the escrow
  // was created with. A mismatch means the link and the escrow disagree and must not be paid.
  const expectedDetailsHash = detailsHash({
    invoiceId: invoice.id,
    chainId: invoice.chainId,
    escrowAddress: invoice.escrowAddress as `0x${string}`,
    tokenAddress: invoice.tokenAddress as `0x${string}`,
    asset: invoice.asset as `0x${string}`,
    payee: invoice.payeeAddress as `0x${string}`,
    payer: (invoice.payerAddress ?? ZERO_ADDRESS) as `0x${string}`,
    amount: invoice.amount,
    description: invoice.description,
    protectionPeriod: invoice.protectionPeriod,
    fundingDeadline: invoice.fundingDeadline ? Math.floor(invoice.fundingDeadline.getTime() / 1000) : 0,
  })

  return NextResponse.json({
    invoice: serialiseInvoice(invoice),
    onChain: serialiseChainRead(onChain),
    verification: {
      /** The stored metadata hashes to the commitment we recorded. */
      metadataIntact: expectedDetailsHash.toLowerCase() === invoice.detailsHash.toLowerCase(),
      /** The escrow on chain commits to these same terms. Null when the chain could not be read. */
      termsMatchChain: onChain.ok
        ? onChain.escrow.detailsHash.toLowerCase() === invoice.detailsHash.toLowerCase()
        : null,
      expectedDetailsHash,
    },
  })
}

/**
 * PATCH /api/invoices/{invoiceId} — attach a transaction hash for display.
 *
 * Reported hashes are shown as explorer links and nothing more; they never change what the app
 * believes about escrow state.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params
  try {
    const body = await request.json()
    const field = String(body.field ?? '')
    if (field !== 'createTxHash' && field !== 'fundTxHash' && field !== 'settleTxHash') {
      return NextResponse.json({ error: 'field must be createTxHash, fundTxHash or settleTxHash.' }, { status: 400 })
    }
    const invoice = await recordTransaction(invoiceId, field, String(body.hash ?? ''))
    return NextResponse.json({ invoice: serialiseInvoice(invoice) })
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/invoices/:id PATCH]', error)
    return NextResponse.json({ error: 'Unable to update the payment request.' }, { status: 500 })
  }
}
