import { prisma } from '@/lib/prisma'
import { formatAmount } from '../format'
import { accountForAddress } from './accounts'

/**
 * In-app notifications.
 *
 * Written only when something actually happened — a job was posted, an application arrived, someone
 * was hired. Nothing is generated speculatively, and delivery failures never take down the action
 * that triggered them: a notification is a side effect of the work, not a precondition for it.
 */

export type NotificationType = 'JOB_POSTED' | 'JOB_APPLICATION' | 'JOB_HIRED' | 'JOB_DECLINED'

type Input = {
  accountId: string
  type: NotificationType
  title: string
  body: string
  href?: string
  jobId?: string
  invoiceId?: string
}

async function create(inputs: Input[]) {
  if (inputs.length === 0) return
  await prisma.notification.createMany({ data: inputs })
}

/**
 * Announces a new job to everyone else.
 *
 * A per-account row rather than a shared feed, so read state is per person. This fans out across
 * the whole account table — fine at the current size, and the point at which it stops being fine is
 * the point to move to a feed table with a cursor.
 */
export async function notifyJobPosted(job: {
  id: string
  title: string
  budgetAmount: string
  tokenSymbol: string
  tokenDecimals: number
  clientAddress: string
}) {
  try {
    const poster = await accountForAddress(job.clientAddress)
    const recipients = await prisma.account.findMany({
      where: poster ? { id: { not: poster.id } } : {},
      select: { id: true },
    })

    const amount = `${formatAmount(job.budgetAmount, job.tokenDecimals)} ${job.tokenSymbol}`
    await create(
      recipients.map((recipient) => ({
        accountId: recipient.id,
        type: 'JOB_POSTED' as const,
        title: 'New job posted',
        body: `${job.title} — ${amount}`,
        href: `/jobs/${job.id}`,
        jobId: job.id,
      })),
    )
  } catch (error) {
    console.error('[vaulted/notify job posted]', error)
  }
}

export async function notifyApplicationReceived(job: { id: string; title: string; clientAddress: string }, applicantAddress: string) {
  try {
    const client = await accountForAddress(job.clientAddress)
    if (!client) return
    const applicant = await accountForAddress(applicantAddress)
    const who = applicant ? `@${applicant.name}` : `${applicantAddress.slice(0, 8)}…`

    await create([
      {
        accountId: client.id,
        type: 'JOB_APPLICATION',
        title: 'New applicant',
        body: `${who} applied to ${job.title}`,
        href: `/jobs/${job.id}`,
        jobId: job.id,
      },
    ])
  } catch (error) {
    console.error('[vaulted/notify application]', error)
  }
}

export async function notifyHired(job: { id: string; title: string }, applicantAddress: string) {
  try {
    const applicant = await accountForAddress(applicantAddress)
    if (!applicant) return
    await create([
      {
        accountId: applicant.id,
        type: 'JOB_HIRED',
        title: 'You were hired',
        body: `You were accepted for ${job.title}`,
        href: `/work`,
        jobId: job.id,
      },
    ])
  } catch (error) {
    console.error('[vaulted/notify hired]', error)
  }
}

export async function notifyDeclined(job: { id: string; title: string }, addresses: string[]) {
  try {
    const accounts = (await Promise.all(addresses.map((address) => accountForAddress(address)))).filter(
      (account): account is NonNullable<typeof account> => account !== null,
    )
    await create(
      accounts.map((account) => ({
        accountId: account.id,
        type: 'JOB_DECLINED' as const,
        title: 'Application not selected',
        body: `${job.title} went to another applicant`,
        href: `/jobs/${job.id}`,
        jobId: job.id,
      })),
    )
  } catch (error) {
    console.error('[vaulted/notify declined]', error)
  }
}

export async function listNotifications(accountId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { accountId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  })
}

export async function unreadCount(accountId: string) {
  return prisma.notification.count({ where: { accountId, readAt: null } })
}

export async function markAllRead(accountId: string) {
  await prisma.notification.updateMany({
    where: { accountId, readAt: null },
    data: { readAt: new Date() },
  })
}
