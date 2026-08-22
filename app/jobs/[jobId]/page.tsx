import { JobDetail } from '@/components/vaulted/jobs'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  return <JobDetail jobId={jobId} />
}
