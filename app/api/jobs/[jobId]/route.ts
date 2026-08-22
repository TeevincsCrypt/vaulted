import { NextRequest, NextResponse } from 'next/server'
import { getJob, serialiseJob } from '@/lib/vaulted/server/jobs'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const job = await getJob(jobId).catch(() => null)
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 })

  return NextResponse.json({
    job: serialiseJob({ ...job, _count: { applications: job.applications.length } } as never),
    applications: job.applications.map((application) => ({
      id: application.id,
      applicantAddress: application.applicantAddress,
      message: application.message,
      status: application.status,
      createdAt: application.createdAt.toISOString(),
    })),
  })
}
