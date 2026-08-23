import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { jobAcceptMessage, jobApplicationMessage, jobCreationMessage } from '../messages'
import { ApiError, requireSigner, requireTransactableChain } from './auth'
import { notifyApplicationReceived, notifyDeclined, notifyHired, notifyJobPosted } from './notifications'

/**
 * Jobs: a client posts funded work, freelancers apply, the client accepts one.
 *
 * Jobs sit *alongside* invoices rather than replacing them. Accepting an applicant does not invent
 * a new settlement path — it produces an ordinary Vaulted escrow through the existing invoice flow,
 * so the money moves through the contract that is already in production.
 *
 * `status` here only ever tracks the off-chain part of the lifecycle (OPEN → ASSIGNED, or
 * CANCELLED). Whether the work is *paid* is a property of the linked escrow on chain, read live —
 * this table never claims a payment state the chain has not confirmed.
 */

export type JobStatus = 'OPEN' | 'ASSIGNED' | 'CANCELLED'

const MAX_TITLE = 120
const MAX_DESCRIPTION = 4000
const MAX_APPLICATION = 1500
const MAX_BUDGET = BigInt('79228162514264337593543950335') // uint96 ceiling, as the escrow enforces

const JOB_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function generateJobId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) id += JOB_ID_ALPHABET[byte % JOB_ID_ALPHABET.length]
  return `job_${id}`
}

export const JOB_ID_PATTERN = /^job_[0-9a-z]{16}$/

export async function createJob(input: {
  jobId: string
  title: string
  description: string
  budgetAmount: string
  chainKey: string
  deadline?: number | null
  protectionPeriod: number
  clientAddress: string
  issuedAt: number
  signature: string
}) {
  if (!JOB_ID_PATTERN.test(input.jobId)) throw new ApiError('Invalid job id.', 400)

  // Refuses a chain with no deployed escrow, so a job can never promise payment on one.
  const chain = requireTransactableChain(input.chainKey)
  if (!chain.token) throw new ApiError(`${chain.name} has no escrow token recorded.`, 409)

  const title = input.title.trim()
  const description = input.description.trim()
  if (!title || title.length > MAX_TITLE) throw new ApiError(`Title is required, up to ${MAX_TITLE} characters.`, 400)
  if (!description || description.length > MAX_DESCRIPTION) {
    throw new ApiError(`Description is required, up to ${MAX_DESCRIPTION} characters.`, 400)
  }

  let budget: bigint
  try {
    budget = BigInt(input.budgetAmount)
  } catch {
    throw new ApiError('Budget must be an integer string in token base units.', 400)
  }
  if (budget <= BigInt(0)) throw new ApiError('Budget must be greater than zero.', 400)
  if (budget > MAX_BUDGET) throw new ApiError('Budget exceeds what the escrow can hold.', 400)

  const protectionPeriod = Number(input.protectionPeriod)
  if (protectionPeriod < 3600 || protectionPeriod > 365 * 24 * 3600) {
    throw new ApiError('Protection period must be between 1 hour and 365 days.', 400)
  }

  const client = await requireSigner({
    message: jobCreationMessage({
      jobId: input.jobId,
      title,
      budgetAmount: budget.toString(),
      chainKey: chain.key,
      client: input.clientAddress,
      issuedAt: input.issuedAt,
    }),
    signature: input.signature,
    expected: input.clientAddress,
    issuedAt: input.issuedAt,
    what: 'this job',
  })

  if (await prisma.job.findUnique({ where: { id: input.jobId } })) {
    throw new ApiError('That job id is already taken.', 409)
  }

  const job = await prisma.job.create({
    data: {
      id: input.jobId,
      title,
      description,
      budgetAmount: budget.toString(),
      chainKey: chain.key,
      tokenSymbol: chain.token.symbol,
      tokenDecimals: chain.token.decimals,
      deadline: input.deadline ? new Date(input.deadline * 1000) : null,
      protectionPeriod,
      clientAddress: client,
      clientSignature: input.signature,
      status: 'OPEN',
    },
  })

  await notifyJobPosted(job)
  return job
}

export async function applyToJob(input: {
  jobId: string
  applicantAddress: string
  message: string
  issuedAt: number
  signature: string
}) {
  const job = await prisma.job.findUnique({ where: { id: input.jobId } })
  if (!job) throw new ApiError('No such job.', 404)
  if (job.status !== 'OPEN') throw new ApiError('This job is no longer accepting applications.', 409)

  const text = input.message.trim()
  if (!text || text.length > MAX_APPLICATION) {
    throw new ApiError(`A message is required, up to ${MAX_APPLICATION} characters.`, 400)
  }

  const applicant = await requireSigner({
    message: jobApplicationMessage({ jobId: job.id, applicant: input.applicantAddress, issuedAt: input.issuedAt }),
    signature: input.signature,
    expected: input.applicantAddress,
    issuedAt: input.issuedAt,
    what: 'this application',
  })

  if (applicant.toLowerCase() === job.clientAddress.toLowerCase()) {
    throw new ApiError('You cannot apply to your own job.', 400)
  }

  const existing = await prisma.jobApplication.findUnique({
    where: { jobId_applicantAddress: { jobId: job.id, applicantAddress: applicant } },
  })

  const application = await prisma.jobApplication.upsert({
    where: { jobId_applicantAddress: { jobId: job.id, applicantAddress: applicant } },
    create: { jobId: job.id, applicantAddress: applicant, message: text, signature: input.signature },
    update: { message: text, signature: input.signature },
  })

  // Only on a first application — editing a message should not re-notify the client.
  if (!existing) await notifyApplicationReceived(job, applicant)
  return application
}

/**
 * The client accepts one applicant. This assigns the job; it does not move money.
 *
 * Funding is the next, separate step: the client creates the escrow for this job through the normal
 * payment-request flow, which is what actually secures the budget on chain.
 */
export async function acceptApplicant(input: {
  jobId: string
  applicantAddress: string
  clientAddress: string
  issuedAt: number
  signature: string
}) {
  const job = await prisma.job.findUnique({ where: { id: input.jobId } })
  if (!job) throw new ApiError('No such job.', 404)
  if (job.status !== 'OPEN') throw new ApiError('This job has already been assigned or cancelled.', 409)

  const client = await requireSigner({
    message: jobAcceptMessage({
      jobId: job.id,
      applicant: input.applicantAddress,
      client: input.clientAddress,
      issuedAt: input.issuedAt,
    }),
    signature: input.signature,
    expected: input.clientAddress,
    issuedAt: input.issuedAt,
    what: 'this job',
  })

  if (client.toLowerCase() !== job.clientAddress.toLowerCase()) {
    throw new ApiError('Only the client who posted this job can accept an applicant.', 403)
  }

  const application = await prisma.jobApplication.findUnique({
    where: { jobId_applicantAddress: { jobId: job.id, applicantAddress: getAddress(input.applicantAddress) } },
  })
  if (!application) throw new ApiError('That applicant has not applied to this job.', 404)

  const [updated] = await prisma.$transaction([
    prisma.job.update({
      where: { id: job.id },
      data: { status: 'ASSIGNED', assignedTo: application.applicantAddress },
    }),
    prisma.jobApplication.update({ where: { id: application.id }, data: { status: 'ACCEPTED' } }),
    prisma.jobApplication.updateMany({
      where: { jobId: job.id, id: { not: application.id } },
      data: { status: 'DECLINED' },
    }),
  ])

  await notifyHired(job, application.applicantAddress)

  const declined = await prisma.jobApplication.findMany({
    where: { jobId: job.id, status: 'DECLINED' },
    select: { applicantAddress: true },
  })
  await notifyDeclined(job, declined.map((entry) => entry.applicantAddress))

  return updated
}

export async function getJob(jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) return null
  return prisma.job.findUnique({
    where: { id: jobId },
    include: { applications: { orderBy: { createdAt: 'desc' } }, invoice: true },
  })
}

export async function listJobs(filter: { status?: string; client?: string; applicant?: string; limit?: number }) {
  const where: Record<string, unknown> = {}
  if (filter.status) where.status = filter.status
  if (filter.client && isAddress(filter.client)) where.clientAddress = getAddress(filter.client)
  if (filter.applicant && isAddress(filter.applicant)) {
    where.applications = { some: { applicantAddress: getAddress(filter.applicant) } }
  }

  return prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.limit ?? 50, 100),
    include: { invoice: true, _count: { select: { applications: true } } },
  })
}

type JobWithExtras = Awaited<ReturnType<typeof listJobs>>[number]

export function serialiseJob(job: JobWithExtras) {
  return {
    jobId: job.id,
    title: job.title,
    description: job.description,
    budgetAmount: job.budgetAmount,
    chainKey: job.chainKey,
    token: { symbol: job.tokenSymbol, decimals: job.tokenDecimals },
    deadline: job.deadline ? Math.floor(job.deadline.getTime() / 1000) : null,
    protectionPeriod: job.protectionPeriod,
    clientAddress: job.clientAddress,
    status: job.status as JobStatus,
    assignedTo: job.assignedTo,
    applicationCount: '_count' in job ? job._count.applications : undefined,
    /**
     * The invoice carrying this job's escrow, if one exists. Whether it is actually funded is a
     * chain fact — the client reads the escrow rather than trusting this link.
     */
    invoiceId: job.invoice?.id ?? null,
    escrowId: job.invoice?.escrowId ?? null,
    createdAt: job.createdAt.toISOString(),
  }
}
