import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from '@/lib/vaulted/server/auth'
import { createJob, listJobs, serialiseJob } from '@/lib/vaulted/server/jobs'

/** GET /api/jobs?status=OPEN&client=0x…&applicant=0x… */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  try {
    const jobs = await listJobs({
      status: params.get('status') ?? undefined,
      client: params.get('client') ?? undefined,
      applicant: params.get('applicant') ?? undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    })
    return NextResponse.json({ jobs: jobs.map(serialiseJob) })
  } catch (error) {
    return errorResponse(error, 'jobs GET')
  }
}

/**
 * POST /api/jobs — post a job.
 *
 * Signed by the client, and rejected outright for a chain with no deployed escrow, so a job can
 * never advertise a budget on a network that could not hold it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const job = await createJob({
      jobId: String(body.jobId ?? ''),
      title: String(body.title ?? ''),
      description: String(body.description ?? ''),
      budgetAmount: String(body.budgetAmount ?? ''),
      chainKey: String(body.chainKey ?? ''),
      deadline: body.deadline ? Number(body.deadline) : null,
      protectionPeriod: Number(body.protectionPeriod ?? 0),
      clientAddress: String(body.clientAddress ?? ''),
      issuedAt: Number(body.issuedAt),
      signature: String(body.signature ?? ''),
    })
    return NextResponse.json({ job: serialiseJob({ ...job, invoice: null, _count: { applications: 0 } } as never) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'jobs POST')
  }
}

function errorResponse(error: unknown, scope: string) {
  if (ApiError.is(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(`[vaulted/${scope}]`, error)
  return NextResponse.json({ error: 'Unable to process the request.' }, { status: 500 })
}
