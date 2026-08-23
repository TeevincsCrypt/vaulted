import { NextRequest, NextResponse } from 'next/server'
import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { adapterFor, ChainNotImplementedError, readWithDeadline } from '@/lib/vaulted/adapters'
import { currentAccount, evmAddressesOf } from '@/lib/vaulted/server/accounts'
import { serverRpcUrl } from '@/lib/vaulted/server/rpc'
import { getChain } from '@/lib/vaulted/registry'
import { displayStatus } from '@/lib/vaulted/status'

/**
 * GET /api/jobs/posted — jobs this account posted, at every stage.
 *
 * The jobs board only lists OPEN work, so a client lost sight of a job the moment they hired
 * someone. This is the other half: assigned and closed jobs, with the escrow behind each read live.
 */
export async function GET(request: NextRequest) {
  const account = await currentAccount().catch(() => null)
  const extra = request.nextUrl.searchParams.get('address')

  const unique = [
    ...evmAddressesOf(account),
    ...(extra && isAddress(extra) ? [getAddress(extra)] : []),
  ]

  if (unique.length === 0) return NextResponse.json({ jobs: [] })

  const jobs = await prisma.job.findMany({
    where: { clientAddress: { in: unique } },
    orderBy: { createdAt: 'desc' },
    include: { invoice: true, _count: { select: { applications: true } } },
    take: 100,
  })

  const rows = await Promise.all(
    jobs.map(async (job) => {
      const chain = getChain(job.chainKey)
      let escrow: { status: string; live: boolean; reason?: string } | null = null

      if (job.invoice && chain) {
        try {
          const escrowId = job.invoice.escrowId
          const read = await readWithDeadline(() =>
            adapterFor(chain, serverRpcUrl()).readEscrow(escrowId),
          )
          if (!read.ok) throw new Error(read.reason)
          const snapshot = read.value
          escrow = snapshot
            ? { status: displayStatus(snapshot.state, snapshot.isExpired), live: true }
            : { status: 'AWAITING_CHAIN', live: true }
        } catch (error) {
          escrow = {
            status: job.invoice.indexedStatus,
            live: false,
            reason: ChainNotImplementedError.is(error) ? error.message : 'The chain could not be read just now.',
          }
        }
      }

      return {
        jobId: job.id,
        title: job.title,
        description: job.description,
        budgetAmount: job.budgetAmount,
        token: { symbol: job.tokenSymbol, decimals: job.tokenDecimals },
        chainName: chain?.name ?? job.chainKey,
        status: job.status,
        assignedTo: job.assignedTo,
        applicationCount: job._count.applications,
        deadline: job.deadline ? Math.floor(job.deadline.getTime() / 1000) : null,
        submittedAt: job.submittedAt ? Math.floor(job.submittedAt.getTime() / 1000) : null,
        submissionNote: job.submissionNote,
        submissionLinks: job.submissionLinks,
        invoiceId: job.invoice?.id ?? null,
        escrowId: job.invoice?.escrowId ?? null,
        escrow,
        createdAt: job.createdAt.toISOString(),
      }
    }),
  )

  return NextResponse.json({ jobs: rows })
}
