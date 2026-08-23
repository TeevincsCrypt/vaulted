import { requirePage } from '@/lib/vaulted/server/guard'
import { JobDetail } from '@/components/vaulted/jobs'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  await requirePage()
  const { jobId } = await params
  return <JobDetail jobId={jobId} />
}
