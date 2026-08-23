import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PayPage } from '@/components/vaulted/pages'
import { PayRequest } from '@/components/vaulted/pay-request'
import { formatAmount } from '@/lib/vaulted/format'
import { getInvoice, serialiseInvoice } from '@/lib/vaulted/server/invoices'
import { getPaymentRequest, isPaymentRequestId } from '@/lib/vaulted/server/payment-requests'
import type { SerialisedInvoice } from '@/lib/vaulted/types'

/**
 * One public payment URL for both kinds of ask.
 *
 * `pr_…` is a direct payment request, settled by transfer and verified server-side; `v_…` is an
 * escrowed invoice, funded into the contract. Same link shape either way, because whoever is paying
 * should not have to know which mechanism they are looking at until the page tells them.
 */

// Both are read live — the escrow from its contract, the request from the database — so there is
// nothing worth caching at the edge here.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}): Promise<Metadata> {
  const { invoiceId } = await params

  if (isPaymentRequestId(invoiceId)) {
    const request = await getPaymentRequest(invoiceId).catch(() => null)
    if (!request) return { title: 'Payment request not found — Vaulted' }
    const amount = `${formatAmount(request.amount, request.decimals)} ${request.currency}`
    return {
      title: `${amount} — ${request.description}`,
      description: `Payment request for ${amount} on ${request.networkName}. Paid by direct transfer and confirmed against the network.`,
    }
  }

  const invoice = await getInvoice(invoiceId).catch(() => null)
  if (!invoice) return { title: 'Payment request not found — Vaulted' }

  const amount = `${formatAmount(invoice.amount, invoice.tokenDecimals)} ${invoice.tokenSymbol}`
  return {
    title: `${amount} — ${invoice.description}`,
    description: `Escrow-protected payment request for ${amount}. Funds are held by a smart contract until released, disputed, or auto-settled.`,
  }
}

export default async function Page({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params

  if (isPaymentRequestId(invoiceId)) {
    const request = await getPaymentRequest(invoiceId).catch(() => null)
    if (!request) notFound()
    return <PayRequest initial={request} />
  }

  const invoice = await getInvoice(invoiceId).catch(() => null)
  if (!invoice) notFound()
  return <PayPage invoice={serialiseInvoice(invoice) as SerialisedInvoice} />
}
