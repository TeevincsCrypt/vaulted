import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PayPage } from '@/components/vaulted/pages'
import { formatAmount } from '@/lib/vaulted/format'
import { getInvoice, serialiseInvoice } from '@/lib/vaulted/server/invoices'
import type { SerialisedInvoice } from '@/lib/vaulted/types'

// The escrow is read live in the browser, so there is nothing worth caching at the edge here.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}): Promise<Metadata> {
  const { invoiceId } = await params
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
  const invoice = await getInvoice(invoiceId).catch(() => null)
  if (!invoice) notFound()
  return <PayPage invoice={serialiseInvoice(invoice) as SerialisedInvoice} />
}
