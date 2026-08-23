import { NextRequest, NextResponse } from 'next/server'
import { requireAccount } from '@/lib/vaulted/server/accounts'
import { ApiError } from '@/lib/vaulted/server/auth'
import { serialiseJob, submitWork } from '@/lib/vaulted/server/jobs'

/**
 * POST /api/jobs/{jobId}/submit — the assignee hands in the work.
 *
 * Signed by the assignee, and off-chain: it releases nothing. The client still has to release on
 * chain, or let the protection window close.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  try {
    await requireAccount()
    const body = await request.json()
    const job = await submitWork({
      jobId,
      applicantAddress: String(body.applicantAddress ?? ''),
      note: String(body.note ?? ''),
      links: String(body.links ?? ''),
      issuedAt: Number(body.issuedAt),
      signature: String(body.signature ?? ''),
    })
    return NextResponse.json({ job: serialiseJob({ ...job, invoice: null, _count: { applications: 0 } } as never) })
  } catch (error) {
    if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/job submit]', error)
    return NextResponse.json({ error: 'Unable to submit the work.' }, { status: 500 })
  }
}
