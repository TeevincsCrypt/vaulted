import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAddress, isAddress } from 'viem'
import { currentAccount } from '@/lib/vaulted/server/accounts'
import { adapterFor, ChainNotImplementedError } from '@/lib/vaulted/adapters'
import { getChain } from '@/lib/vaulted/registry'
import { displayStatus } from '@/lib/vaulted/status'
import { serverRpcUrl } from '@/lib/vaulted/server/rpc'

/**
 * GET /api/work — jobs the caller applied to, with the outcome and the escrow behind it.
 *
 * Addressed by every wallet linked to the account, plus an optional `address` for a wallet that is
 * connected but not linked yet, so a hired applicant can find their job either way.
 */
export async function GET(request: NextRequest) {
  const account = await currentAccount().catch(() => null)
  const extra = request.nextUrl.searchParams.get('address')

  const addresses = [
    ...(account?.wallets.map((wallet) => wallet.address) ?? []),
    ...(account?.primaryAddress ? [account.primaryAddress] : []),
    ...(extra && isAddress(extra) ? [getAddress(extra)] : []),
  ]
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]

  if (unique.length === 0) return NextResponse.json({ applications: [], addresses: [] })

  const applications = await prisma.jobApplication.findMany({
    where: { applicantAddress: { in: unique.map((a) => getAddress(a)) } },
    orderBy: { createdAt: 'desc' },
    include: { job: { include: { invoice: true } } },
    take: 100,
  })

  const rows = await Promise.all(
    applications.map(async (application) => {
      const job = application.job
      const chain = getChain(job.chainKey)

      // Escrow state, when one exists, is read live — a job page must never imply a payment the
      // chain has not made.
      let escrow: { status: string; live: boolean; reason?: string } | null = null
      if (job.invoice && chain) {
        try {
          const snapshot = await adapterFor(chain, serverRpcUrl()).readEscrow(job.invoice.escrowId)
          escrow = snapshot
            ? { status: displayStatus(snapshot.state, snapshot.isExpired), live: true }
            : { status: 'AWAITING_CHAIN', live: true }
        } catch (error) {
          escrow = {
            status: job.invoice.indexedStatus,
            live: false,
            reason: ChainNotImplementedError.is(error)
              ? error.message
              : 'The chain could not be read just now.',
          }
        }
      }

      return {
        applicationId: application.id,
        applicationStatus: application.status,
        appliedAt: application.createdAt.toISOString(),
        message: application.message,
        hired: job.assignedTo?.toLowerCase() === application.applicantAddress.toLowerCase(),
        job: {
          jobId: job.id,
          title: job.title,
          description: job.description,
          budgetAmount: job.budgetAmount,
          token: { symbol: job.tokenSymbol, decimals: job.tokenDecimals },
          chainKey: job.chainKey,
          chainName: chain?.name ?? job.chainKey,
          status: job.status,
          deadline: job.deadline ? Math.floor(job.deadline.getTime() / 1000) : null,
          clientAddress: job.clientAddress,
          invoiceId: job.invoice?.id ?? null,
        },
        escrow,
      }
    }),
  )

  return NextResponse.json({ applications: rows, addresses: unique })
}
