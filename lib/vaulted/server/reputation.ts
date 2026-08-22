import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'

/**
 * Reputation derived from real Vaulted activity — nothing else.
 *
 * Every number here is counted from escrows this wallet actually took part in, using the status
 * last observed on chain. There is no seeded score, no bonus, no decay curve and no invented
 * baseline: a wallet with no history gets zeroes and an explicit `hasActivity: false`, so the UI
 * can say "no activity yet" instead of implying a fresh account is trustworthy.
 *
 * `indexedStatus` is a cache of what the chain said. It is fine for aggregates — a stale row makes
 * a count briefly low, never wrong in kind — but any single escrow on screen is read live.
 */

/** Statuses that mean the escrow reached a terminal, paid-out state. */
const PAID_STATUSES = ['RELEASED', 'RESOLVED']
const SETTLED_STATUSES = [...PAID_STATUSES, 'REFUNDED']

export type Reputation = {
  address: string
  hasActivity: boolean
  /** Escrows that settled to the payee. */
  completedJobs: number
  /** Base units secured across every escrow this wallet was paid through, per token symbol. */
  volumeByToken: { symbol: string; decimals: number; amount: string }[]
  releasedByClient: number
  autoReleased: number
  refunded: number
  disputed: number
  disputesResolved: number
  /**
   * Completed as a share of settled escrows, 0–100. Null when nothing has settled yet — an
   * undefined rate is not 0%, and rendering it as 0% would libel a new account.
   */
  completionRate: number | null
  /** When the wallet's first Vaulted escrow was created. */
  since: string | null
}

export async function reputationFor(rawAddress: string): Promise<Reputation | null> {
  if (!isAddress(rawAddress)) return null
  const address = getAddress(rawAddress)

  const invoices = await prisma.invoice.findMany({
    where: { payeeAddress: address },
    select: {
      amount: true,
      tokenSymbol: true,
      tokenDecimals: true,
      indexedStatus: true,
      settleTxHash: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const empty: Reputation = {
    address,
    hasActivity: false,
    completedJobs: 0,
    volumeByToken: [],
    releasedByClient: 0,
    autoReleased: 0,
    refunded: 0,
    disputed: 0,
    disputesResolved: 0,
    completionRate: null,
    since: null,
  }

  if (invoices.length === 0) return empty

  const volume = new Map<string, { symbol: string; decimals: number; amount: bigint }>()
  let completed = 0
  let refunded = 0
  let disputed = 0
  let resolved = 0

  for (const invoice of invoices) {
    const status = invoice.indexedStatus
    if (PAID_STATUSES.includes(status)) {
      completed++
      const entry = volume.get(invoice.tokenSymbol) ?? {
        symbol: invoice.tokenSymbol,
        decimals: invoice.tokenDecimals,
        amount: BigInt(0),
      }
      entry.amount += BigInt(invoice.amount)
      volume.set(invoice.tokenSymbol, entry)
    }
    if (status === 'REFUNDED') refunded++
    if (status === 'DISPUTED') disputed++
    if (status === 'RESOLVED') resolved++
  }

  const settled = invoices.filter((invoice) => SETTLED_STATUSES.includes(invoice.indexedStatus)).length

  return {
    address,
    hasActivity: true,
    completedJobs: completed,
    volumeByToken: [...volume.values()].map((entry) => ({
      symbol: entry.symbol,
      decimals: entry.decimals,
      amount: entry.amount.toString(),
    })),
    /**
     * Splitting "client released" from "auto-released after timeout" needs the release trigger,
     * which lives in the EscrowReleased event rather than the escrow struct. Until an event indexer
     * exists these stay at zero rather than being guessed from the settlement hash.
     * TODO: populate from EscrowReleased(trigger) once event indexing lands.
     */
    releasedByClient: 0,
    autoReleased: 0,
    refunded,
    disputed,
    disputesResolved: resolved,
    completionRate: settled > 0 ? Math.round((completed / settled) * 100) : null,
    since: invoices[0].createdAt.toISOString(),
  }
}
