import { NextRequest, NextResponse } from 'next/server'
import { requireAccount } from '@/lib/vaulted/server/accounts'
import { ApiError } from '@/lib/vaulted/server/auth'
import { acceptApplicant, serialiseJob } from '@/lib/vaulted/server/jobs'

/**
 * POST /api/jobs/{jobId}/accept — the client assigns the job to an applicant.
 *
 * Assignment only. Securing the budget is a separate on-chain step: the client creates the escrow
 * through the normal payment-request flow, which is what actually moves money.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  try {
    await requireAccount()
    const body = await request.json()
    const job = await acceptApplicant({
      jobId,
      applicantAddress: String(body.applicantAddress ?? ''),
      clientAddress: String(body.clientAddress ?? ''),
      issuedAt: Number(body.issuedAt),
      signature: String(body.signature ?? ''),
    })
    return NextResponse.json({ job: serialiseJob({ ...job, invoice: null, _count: { applications: 0 } } as never) })
  } catch (error) {
    if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/job accept]', error)
    return NextResponse.json({ error: 'Unable to accept that applicant.' }, { status: 500 })
  }
}
