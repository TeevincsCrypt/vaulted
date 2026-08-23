import type { Metadata } from 'next'
import { RequestPaymentPage } from '@/components/vaulted/request-page'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = {
  title: 'Request a payment — Vaulted',
  description: 'Create an escrow-protected payment link and share it with your client.',
}
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <RequestPaymentPage />
}
