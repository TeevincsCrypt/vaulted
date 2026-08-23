import { NextRequest, NextResponse } from 'next/server'
import { getJob, serialiseJob } from '@/lib/vaulted/server/jobs'
import { getChain } from '@/lib/vaulted/registry'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const job = await getJob(jobId).catch(() => null)
  if (!job) return NextResponse.json({ error: 'No such job.' }, { status: 404 })

  /*
    Where the network cannot hold an escrow, hiring raises a direct payment for the budget. The page
    needs to know that it exists to point the client at it, so a summary rides along — id, amount
    and status only, which is what the job page shows. It is not escrow and the page says so.
  */
  const chain = getChain(job.chainKey)
  const payment = job.paymentRequest
    ? {
        id: job.paymentRequest.id,
        amount: job.paymentRequest.amount,
        currency: job.paymentRequest.currency,
        status:
          job.paymentRequest.status === 'PENDING' &&
          job.paymentRequest.expiresAt &&
          job.paymentRequest.expiresAt.getTime() < Date.now()
            ? 'EXPIRED'
            : job.paymentRequest.status,
        paidAt: job.paymentRequest.paidAt?.toISOString() ?? null,
      }
    : null

  return NextResponse.json({
    job: serialiseJob({ ...job, _count: { applications: job.applications.length } } as never),
    applications: job.applications.map((application) => ({
      id: application.id,
      applicantAddress: application.applicantAddress,
      message: application.message,
      status: application.status,
      createdAt: application.createdAt.toISOString(),
    })),
    payment,
    escrowCapable: chain?.capabilities.escrow ?? false,
  })
}
