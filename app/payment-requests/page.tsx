import type { Metadata } from 'next'
import { PaymentRequests } from '@/components/vaulted/payment-requests'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = { title: 'Payment requests — Vaulted' }
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <PaymentRequests />
}
