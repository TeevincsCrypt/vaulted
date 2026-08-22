import { notFound } from 'next/navigation'
import { RequestPage } from '@/components/vaulted/pages'
import { getInvoice, serialiseInvoice } from '@/lib/vaulted/server/invoices'
import type { SerialisedInvoice } from '@/lib/vaulted/types'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params
  const invoice = await getInvoice(invoiceId).catch(() => null)
  if (!invoice) notFound()
  return <RequestPage invoice={serialiseInvoice(invoice) as SerialisedInvoice} />
}
