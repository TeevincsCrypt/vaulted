import { NextRequest, NextResponse } from 'next/server'
import { requireAccount } from '@/lib/vaulted/server/accounts'
import { ApiError } from '@/lib/vaulted/server/auth'
import { applyToJob } from '@/lib/vaulted/server/jobs'

/** POST /api/jobs/{jobId}/applications — apply, signed by the applicant. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  try {
    await requireAccount()
    const body = await request.json()
    const application = await applyToJob({
      jobId,
      applicantAddress: String(body.applicantAddress ?? ''),
      message: String(body.message ?? ''),
      issuedAt: Number(body.issuedAt),
      signature: String(body.signature ?? ''),
    })
    return NextResponse.json(
      {
        application: {
          id: application.id,
          applicantAddress: application.applicantAddress,
          status: application.status,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vaulted/job apply]', error)
    return NextResponse.json({ error: 'Unable to submit the application.' }, { status: 500 })
  }
}
