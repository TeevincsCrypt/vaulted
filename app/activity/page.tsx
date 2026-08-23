import type { Metadata } from 'next'
import { ActivityPage } from '@/components/vaulted/activity'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = {
  title: 'Activity — Vaulted',
  description: 'Every Vaulted transaction for your wallets, verifiable on chain.',
}
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <ActivityPage />
}
