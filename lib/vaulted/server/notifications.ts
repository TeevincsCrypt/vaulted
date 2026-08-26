import { prisma } from '@/lib/prisma'
import { formatAmount } from '../format'
import { getChain } from '../registry'
import { accountForAddress } from './accounts'

/**
 * In-app notifications.
 *
 * Written only when something actually happened — a job was posted, an application arrived, someone
 * was hired. Nothing is generated speculatively, and delivery failures never take down the action
 * that triggered them: a notification is a side effect of the work, not a precondition for it.
 */

export type NotificationType =
  | 'JOB_POSTED'
  | 'JOB_APPLICATION'
  | 'JOB_HIRED'
  | 'JOB_DECLINED'
  | 'WORK_SUBMITTED'
  | 'PAYMENT_REQUESTED'
  | 'PAYMENT_ESCROW_CREATED'
  | 'PAYMENT_FUNDED'
  | 'PAYMENT_RELEASED'
  | 'PAYMENT_DISPUTED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_RECEIVED'

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
    if (!client) {
      /*
        The only link from a job to an account is the client's address, so an address with no
        recorded wallet means nobody can be told. That is a real delivery failure and used to be a
        silent `return` — the application still arrived, the poster was simply never notified and
        there was nothing anywhere to say why. Logged loudly so it is diagnosable.
      */
      console.error(
        `[vaulted/notify application] no account owns ${job.clientAddress}, so the poster of ` +
          `${job.id} could not be notified`,
      )
      return
    }
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

/**
 * Tells the freelancer they were hired, and what happens to the money next.
 *
 * Which is not the same on every network, so this does not pretend it is. Where an escrow can be
 * raised, the next step is theirs and the link goes straight to it. Where none can — Solana, and
 * Base until the contract is deployed — hiring has already raised a direct payment for the budget,
 * there is nothing for them to do, and sending them to the escrow page would only show them a
 * message saying escrow is unavailable.
 */
export async function notifyHired(
  job: { id: string; title: string; chainKey: string },
  applicantAddress: string,
) {
  try {
    const applicant = await accountForAddress(applicantAddress)
    if (!applicant) {
      console.error(
        `[vaulted/notify hired] no account owns ${applicantAddress}, so the person hired for ` +
          `${job.id} could not be told`,
      )
      return
    }

    const chain = getChain(job.chainKey)
    const escrowCapable = chain?.capabilities.escrow ?? false

    await create([
      {
        accountId: applicant.id,
        type: 'JOB_HIRED',
        title: 'You were hired',
        body: escrowCapable
          ? `You were accepted for ${job.title}. Raise the escrow so the client can lock the budget.`
          : `You were accepted for ${job.title}. ${chain?.name ?? job.chainKey} has no escrow, so ` +
            'the client pays you directly — the budget is yours as soon as it lands.',
        // Where an escrow is possible, straight to the step that secures the money: the contract
        // makes the payee its creator, so this is the freelancer's move and nobody else can make
        // it. Where it is not, the job page, which shows the payment's real state.
        href: escrowCapable ? `/request?job=${job.id}` : `/jobs/${job.id}`,
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

/* ---------------------------------------------------------------- payments */

/**
 * Tells the client a payment request was addressed to them.
 *
 * Only fires when the request names a payer we can resolve to an account — an open link is
 * addressed to nobody, so there is nobody to notify.
 */
export async function notifyPaymentRequested(invoice: {
  id: string
  description: string
  amount: string
  tokenSymbol: string
  tokenDecimals: number
  payeeAddress: string
  payerAddress: string | null
}) {
  try {
    // An open link is addressed to nobody in particular, so there is nobody to tell — whoever funds
    // it arrives through the link itself. Not a delivery failure, so not logged as one.
    if (!invoice.payerAddress) return

    const payer = await accountForAddress(invoice.payerAddress)
    if (!payer) {
      // The delivery failure the job notifiers log, for the same reason: the escrow was raised, the
      // client was simply never told, and a silent return leaves nothing anywhere to say why. This
      // is what a request addressed to a wallet no account owns looks like from here.
      console.error(
        `[vaulted/notify payment requested] no account owns ${invoice.payerAddress}, so the client ` +
          `of ${invoice.id} could not be told an escrow was raised for them`,
      )
      return
    }

    const payee = await accountForAddress(invoice.payeeAddress)
    const from = payee ? `@${payee.name}` : `${invoice.payeeAddress.slice(0, 8)}…`
    const amount = `${formatAmount(invoice.amount, invoice.tokenDecimals)} ${invoice.tokenSymbol}`

    await create([
      {
        accountId: payer.id,
        type: 'PAYMENT_REQUESTED',
        title: 'Payment requested',
        body: `${from} requested ${amount} — ${invoice.description}`,
        href: `/pay/${invoice.id}`,
        invoiceId: invoice.id,
      },
    ])
  } catch (error) {
    console.error('[vaulted/notify payment requested]', error)
  }
}

/** Tells the assignee's client that work was handed in. */
export async function notifyWorkSubmitted(job: { id: string; title: string; clientAddress: string }, byAddress: string) {
  try {
    const client = await accountForAddress(job.clientAddress)
    if (!client) {
      // Same delivery failure {@link notifyApplicationReceived} logs, for the same reason: the work
      // was submitted, the client was simply never told, and a silent return leaves nothing
      // anywhere to say why.
      console.error(
        `[vaulted/notify work submitted] no account owns ${job.clientAddress}, so the client of ` +
          `${job.id} could not be told work was handed in`,
      )
      return
    }
    const who = await accountForAddress(byAddress)

    await create([
      {
        accountId: client.id,
        type: 'WORK_SUBMITTED',
        title: 'Work submitted',
        body: `${who ? `@${who.name}` : `${byAddress.slice(0, 8)}…`} submitted work for ${job.title}`,
        href: `/jobs/${job.id}`,
        jobId: job.id,
      },
    ])
  } catch (error) {
    console.error('[vaulted/notify work submitted]', error)
  }
}

/**
 * Money landed in someone's wallet.
 *
 * Direct payments settle by transfer rather than through escrow, so none of the escrow transitions
 * below ever fire for them — which meant the single most worth knowing about, someone actually
 * paying you, was the one thing that arrived in silence.
 *
 * Called only from the path that sets PAID, and that path sets PAID only after reading the
 * transaction back off the chain. So this reports a payment that demonstrably happened, never a
 * claim someone made by submitting a hash.
 *
 * The recipient is addressed by account id straight off the request, not resolved from an address,
 * so this cannot strand the way the address-resolved notifications can.
 */
export async function notifyPaymentReceived(input: {
  requestId: string
  accountId: string
  description: string | null
  amount: string
  tokenSymbol: string
  tokenDecimals: number
  networkName: string
  payerName: string | null
}) {
  try {
    const amount = `${formatAmount(input.amount, input.tokenDecimals)} ${input.tokenSymbol}`
    const from = input.payerName ? ` from @${input.payerName}` : ''
    await create([
      {
        accountId: input.accountId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment received',
        body: `${amount} arrived${from} on ${input.networkName}${input.description ? ` — ${input.description}` : ''}`,
        // Where the request itself lives. `/requests` is not a page — only `/requests/{id}` is —
        // so the notification about being paid used to lead to a 404.
        href: '/payment-requests',
      },
    ])
  } catch (error) {
    console.error('[vaulted/notify payment received]', error)
  }
}

/**
 * Escrow state changed on chain.
 *
 * Called from the sync path, which reads the contract — so these are reports of something that
 * demonstrably happened, not optimistic guesses made when a button was pressed. Both sides are
 * told, minus whoever caused it where that is knowable.
 */
export async function notifyEscrowTransition(input: {
  invoiceId: string
  description: string
  amount: string
  tokenSymbol: string
  tokenDecimals: number
  payeeAddress: string
  payerAddress: string | null
  from: string
  to: string
}) {
  try {
    const map: Record<string, { type: NotificationType; title: string; forPayee: string; forPayer: string } | undefined> = {
      /*
        The escrow exists on chain but holds nothing yet. This is the client's cue to fund it, and
        the step that used to pass in silence — the freelancer raised the escrow, and the person who
        had to act next was never told it was waiting for them.
      */
      AWAITING_PAYMENT: {
        type: 'PAYMENT_ESCROW_CREATED',
        title: 'Escrow ready to fund',
        forPayee: 'is now on chain, waiting for the client to fund it',
        forPayer: 'is on chain and waiting for you to fund it',
      },
      IN_ESCROW: {
        type: 'PAYMENT_FUNDED',
        title: 'Escrow funded',
        forPayee: 'is now locked in escrow for you',
        forPayer: 'is locked in escrow',
      },
      RELEASED: {
        type: 'PAYMENT_RELEASED',
        title: 'Payment released',
        forPayee: 'has been released to you',
        forPayer: 'was released to the freelancer',
      },
      DISPUTED: {
        type: 'PAYMENT_DISPUTED',
        title: 'Payment disputed',
        forPayee: 'was disputed by the client',
        forPayer: 'is on hold while the dispute is open',
      },
      REFUNDED: {
        type: 'PAYMENT_REFUNDED',
        title: 'Payment refunded',
        forPayee: 'was returned to the client',
        forPayer: 'was returned to you',
      },
    }

    const entry = map[input.to]
    if (!entry || input.from === input.to) return

    const amount = `${formatAmount(input.amount, input.tokenDecimals)} ${input.tokenSymbol}`
    const [payee, payer] = await Promise.all([
      accountForAddress(input.payeeAddress),
      input.payerAddress ? accountForAddress(input.payerAddress) : Promise.resolve(null),
    ])

    const rows: Input[] = []
    if (payee) {
      rows.push({
        accountId: payee.id,
        type: entry.type,
        title: entry.title,
        body: `${amount} ${entry.forPayee} — ${input.description}`,
        href: `/requests/${input.invoiceId}`,
        invoiceId: input.invoiceId,
      })
    }
    if (payer) {
      rows.push({
        accountId: payer.id,
        type: entry.type,
        title: entry.title,
        body: `${amount} ${entry.forPayer} — ${input.description}`,
        href: `/pay/${input.invoiceId}`,
        invoiceId: input.invoiceId,
      })
    }
    await create(rows)
  } catch (error) {
    console.error('[vaulted/notify escrow transition]', error)
  }
}
