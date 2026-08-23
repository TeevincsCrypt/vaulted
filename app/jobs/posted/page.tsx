import type { Metadata } from 'next'
import { PostedJobs } from '@/components/vaulted/posted-jobs'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = {
  title: 'Jobs I posted — Vaulted',
  description: 'Review submitted work and release funds on the jobs you posted.',
}
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <PostedJobs />
}
