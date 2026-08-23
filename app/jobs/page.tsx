import type { Metadata } from 'next'
import { requirePage } from '@/lib/vaulted/server/guard'
import { JobsBoard } from '@/components/vaulted/jobs'

export const metadata: Metadata = {
  title: 'Jobs — Vaulted',
  description: 'Open work posted on Vaulted, with budgets secured by on-chain escrow.',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <JobsBoard />
}
