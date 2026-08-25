/**
 * Notifications reach the person they are about.
 *
 * The reported failure was that applicants, hires and submissions all stopped notifying at once,
 * with nothing broken anywhere obvious: every notify* function ran, every route returned 200, and
 * the bell polled correctly. The single point they all pass through is `accountForAddress`, whose
 * only input is a recorded `LinkedWallet` row — so an account whose sign-in never recorded its
 * wallet address is invisible to all of them, permanently and without a trace.
 *
 * This drives the four job notifications end to end against the real server functions, then repeats
 * the flow with the client's wallet row missing to pin the failure mode itself: the notifications
 * that depend on resolving that address must be the ones that go missing, and nothing may be
 * delivered to the wrong account in their place.
 *
 * Prerequisites: DATABASE_URL set (or in .env.local). This writes to a real database and clears the
 * tables it uses, so point it at a scratch one.
 * Run: npm run check:notifications
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  jobAcceptMessage,
  jobApplicationMessage,
  jobCreationMessage,
  workSubmissionMessage,
} from '../lib/vaulted/messages.ts'
import { acceptApplicant, applyToJob, createJob, submitWork } from '../lib/vaulted/server/jobs.ts'
import { notifyEscrowTransition, notifyPaymentReceived } from '../lib/vaulted/server/notifications.ts'
import { defaultChain, VAULTED_CHAINS } from '../lib/vaulted/registry.ts'

const ROOT = path.join(import.meta.dirname, '..')
for (const file of ['.env.local', '.env']) {
  const full = path.join(ROOT, file)
  if (!existsSync(full)) continue
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — this check writes to a real database.')
  process.exit(1)
}

const prisma = new PrismaClient()

const CLIENT = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const WORKER = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6')

let failures = 0
const step = (n, s) => console.log(`\n[${n}] ${s}`)
const check = (ok, msg) => {
  console.log(`   ${ok ? 'ok  ' : 'FAIL'}: ${msg}`)
  if (!ok) failures++
}

const chain = VAULTED_CHAINS.find((entry) => entry.family === 'evm' && entry.capabilities.transfer)
if (!chain) {
  console.error('This build exposes no transactable EVM chain, so there is no job to post.')
  process.exit(1)
}
// The same chain key `recordEmbeddedWallet` files an embedded wallet under.
const preferred = defaultChain()
const walletChainKey = preferred?.family === 'evm' ? preferred.key : chain.key

const now = () => Math.floor(Date.now() / 1000)

/** Posts, applies, hires and submits, returning the notifications each account ended up with. */
async function runFlow({ jobId, linkClientWallet }) {
  await prisma.notification.deleteMany({})
  await prisma.jobApplication.deleteMany({})
  await prisma.job.deleteMany({})
  await prisma.linkedWallet.deleteMany({})
  await prisma.account.deleteMany({})

  const client = await prisma.account.create({
    data: { name: 'checkclient', twitterId: 'check-t-client', privyUserId: 'check-p-client' },
  })
  const worker = await prisma.account.create({
    data: { name: 'checkworker', twitterId: 'check-t-worker', privyUserId: 'check-p-worker' },
  })

  if (linkClientWallet) {
    await prisma.linkedWallet.create({
      data: {
        usernameId: client.id,
        chainKey: walletChainKey,
        address: getAddress(CLIENT.address),
        provenance: 'PRIVY_EMBEDDED',
      },
    })
  }
  await prisma.linkedWallet.create({
    data: {
      usernameId: worker.id,
      chainKey: walletChainKey,
      address: getAddress(WORKER.address),
      provenance: 'PRIVY_EMBEDDED',
    },
  })

  const title = 'Notification delivery check'
  const budgetAmount = '1000000'

  const postedAt = now()
  await createJob({
    jobId,
    title,
    description: 'Driving the job notifications end to end.',
    budgetAmount,
    chainKey: chain.key,
    protectionPeriod: 86400,
    clientAddress: CLIENT.address,
    issuedAt: postedAt,
    signature: await CLIENT.signMessage({
      message: jobCreationMessage({
        jobId,
        title,
        budgetAmount,
        chainKey: chain.key,
        client: CLIENT.address,
        issuedAt: postedAt,
      }),
    }),
  })

  const appliedAt = now()
  await applyToJob({
    jobId,
    applicantAddress: WORKER.address,
    message: 'I would like to take this on.',
    issuedAt: appliedAt,
    signature: await WORKER.signMessage({
      message: jobApplicationMessage({ jobId, applicant: WORKER.address, issuedAt: appliedAt }),
    }),
  })

  const hiredAt = now()
  await acceptApplicant({
    jobId,
    applicantAddress: WORKER.address,
    clientAddress: CLIENT.address,
    issuedAt: hiredAt,
    signature: await CLIENT.signMessage({
      message: jobAcceptMessage({ jobId, applicant: WORKER.address, client: CLIENT.address, issuedAt: hiredAt }),
    }),
  })

  const submittedAt = now()
  await submitWork({
    jobId,
    applicantAddress: WORKER.address,
    note: 'Handed in.',
    links: '',
    issuedAt: submittedAt,
    signature: await WORKER.signMessage({
      message: workSubmissionMessage({ jobId, applicant: WORKER.address, issuedAt: submittedAt }),
    }),
  })

  const typesFor = async (accountId) =>
    (await prisma.notification.findMany({ where: { accountId }, select: { type: true } })).map((n) => n.type)

  return { client: await typesFor(client.id), worker: await typesFor(worker.id) }
}

step(1, 'Both sides have a recorded wallet — every job notification is delivered')
{
  const seen = await runFlow({ jobId: 'job_notifycheck00001', linkClientWallet: true })
  check(seen.client.includes('JOB_APPLICATION'), 'the client is told an applicant applied')
  check(seen.worker.includes('JOB_HIRED'), 'the worker is told they were hired')
  check(seen.client.includes('WORK_SUBMITTED'), 'the client is told work was submitted')
  check(seen.worker.includes('JOB_POSTED'), 'the worker is told about the new job')
  check(!seen.client.includes('JOB_POSTED'), 'the poster is not announced their own job')
}

step(2, 'The client has no recorded wallet — the notifications about them go missing')
{
  const seen = await runFlow({ jobId: 'job_notifycheck00002', linkClientWallet: false })
  /*
    Asserted so the failure mode stays pinned rather than silently changing shape. The worker's
    notifications still arrive, which is exactly why this was so hard to see from the outside: the
    feature is not down, only one account is unreachable.
  */
  check(!seen.client.includes('JOB_APPLICATION'), 'nothing reaches an account with no wallet on file')
  check(seen.worker.includes('JOB_HIRED'), 'the side that does have a wallet is unaffected')
  check(
    !seen.worker.includes('JOB_APPLICATION') && !seen.worker.includes('WORK_SUBMITTED'),
    'an undeliverable notification is dropped, never redirected to the other party',
  )
}

step(3, 'The two moments that used to pass in silence: escrow on chain, and money arriving')
{
  await prisma.notification.deleteMany({})
  await prisma.jobApplication.deleteMany({})
  await prisma.job.deleteMany({})
  await prisma.linkedWallet.deleteMany({})
  await prisma.account.deleteMany({})

  const client = await prisma.account.create({
    data: { name: 'checkclient', twitterId: 'check-t-client', privyUserId: 'check-p-client' },
  })
  const worker = await prisma.account.create({
    data: { name: 'checkworker', twitterId: 'check-t-worker', privyUserId: 'check-p-worker' },
  })
  for (const [account, wallet] of [[client, CLIENT], [worker, WORKER]]) {
    await prisma.linkedWallet.create({
      data: {
        usernameId: account.id,
        chainKey: walletChainKey,
        address: getAddress(wallet.address),
        provenance: 'PRIVY_EMBEDDED',
      },
    })
  }

  /*
    The escrow reaching the chain. The contract makes the freelancer raise it, so it is the client
    who has to act next — and this transition had no entry in the map at all, so neither side was
    told anything. Driven through the real transition function, because what is being checked is
    precisely that this status is now mapped.
  */
  await notifyEscrowTransition({
    invoiceId: 'v_notifycheck00000001',
    description: 'A landing page',
    amount: '1000000',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    payeeAddress: getAddress(WORKER.address),
    payerAddress: getAddress(CLIENT.address),
    from: 'AWAITING_CHAIN',
    to: 'AWAITING_PAYMENT',
  })

  const created = await prisma.notification.findMany({ where: { type: 'PAYMENT_ESCROW_CREATED' } })
  check(created.length === 2, `an escrow reaching the chain notifies both sides (${created.length})`)
  check(
    created.some((row) => row.accountId === client.id && /fund it/i.test(row.body)),
    'the client is told it is waiting on them to fund',
  )
  check(created.some((row) => row.accountId === worker.id), 'and the freelancer is told it is on chain')

  // A status that did not actually change must still produce nothing.
  await prisma.notification.deleteMany({})
  await notifyEscrowTransition({
    invoiceId: 'v_notifycheck00000001', description: 'A landing page', amount: '1000000',
    tokenSymbol: 'USDC', tokenDecimals: 6,
    payeeAddress: getAddress(WORKER.address), payerAddress: getAddress(CLIENT.address),
    from: 'AWAITING_PAYMENT', to: 'AWAITING_PAYMENT',
  })
  check((await prisma.notification.count()) === 0, 'a status that did not change notifies nobody')

  /*
    Money arriving. Direct payments settle by transfer and never touch an escrow transition, so
    nothing above ever fires for them — which left the event most worth knowing about as the one
    that arrived in silence.
  */
  await notifyPaymentReceived({
    requestId: 'pr_notifycheck00000001',
    accountId: worker.id,
    description: 'A landing page',
    amount: '2500000',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    networkName: 'Base',
    payerName: 'checkclient',
  })

  const received = await prisma.notification.findMany({ where: { type: 'PAYMENT_RECEIVED' } })
  check(received.length === 1, `money arriving notifies the recipient (${received.length})`)
  check(received[0]?.accountId === worker.id, 'and only the recipient')
  check(/2\.5/.test(received[0]?.body ?? ''), `naming what arrived (${received[0]?.body ?? 'none'})`)
  check(/@checkclient/.test(received[0]?.body ?? ''), 'and who it came from')
}

await prisma.notification.deleteMany({})
await prisma.jobApplication.deleteMany({})
await prisma.job.deleteMany({})
await prisma.linkedWallet.deleteMany({})
await prisma.account.deleteMany({})
await prisma.$disconnect()

console.log(failures === 0 ? '\nAll notification delivery checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
