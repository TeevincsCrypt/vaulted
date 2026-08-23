import type { Metadata } from 'next'
import { WorkPage } from '@/components/vaulted/work'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = {
  title: 'My work — Vaulted',
  description: 'Jobs you applied to, and the escrow behind anything you were hired for.',
}
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <WorkPage />
}
