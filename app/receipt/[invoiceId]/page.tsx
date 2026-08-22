import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Receipt } from '@/components/vaulted/receipt'
import { formatAmount } from '@/lib/vaulted/format'
import { getInvoice, serialiseInvoice } from '@/lib/vaulted/server/invoices'
import { handlesForAddresses } from '@/lib/vaulted/server/usernames'
import type { SerialisedInvoice } from '@/lib/vaulted/types'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}): Promise<Metadata> {
  const { invoiceId } = await params
  const invoice = await getInvoice(invoiceId).catch(() => null)
  if (!invoice) return { title: 'Receipt not found — Vaulted' }

  const amount = `${formatAmount(invoice.amount, invoice.tokenDecimals)} ${invoice.tokenSymbol}`
  return {
    title: `Receipt · ${amount} — ${invoice.description}`,
    description: `Vaulted escrow receipt for ${amount}, verified against the escrow contract.`,
  }
}

export default async function Page({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params
  const invoice = await getInvoice(invoiceId).catch(() => null)
  if (!invoice) notFound()

  const handles = await handlesForAddresses([invoice.payeeAddress, invoice.payerAddress ?? '']).catch((): Record<string, string> => ({}))

  return (
    <Receipt
      invoice={serialiseInvoice(invoice) as SerialisedInvoice}
      handles={{
        payer: handles[(invoice.payerAddress ?? '').toLowerCase()] ?? null,
        payee: handles[invoice.payeeAddress.toLowerCase()] ?? null,
      }}
    />
  )
}
