import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { adapterFor, ChainNotImplementedError } from '../adapters'
import { getChain, getChainByEvmId, type VaultedChain } from '../registry'
import { displayStatus, EscrowState, type DisplayStatus } from '../status'
import { handlesForAddresses } from './accounts'

/**
 * The dashboard's data, assembled from the database for *metadata* and the chain for *state*.
 *
 * Every row is read live from its escrow contract. When a read fails the row is returned with
 * `live: false` and the reason, and it is excluded from the totals — a number that silently folds
 * in a stale row is worse than a number that says part of it could not be read.
 */

export type DashboardRow = {
  invoiceId: string
  escrowId: string
  chainKey: string
  chainName: string
  description: string
  amount: string
  token: { symbol: string; decimals: number }
  payer: string | null
  payee: string
  payerHandle: string | null
  payeeHandle: string | null
  /** Whether the escrow state below came from the chain just now. */
  live: boolean
  /** Present when `live` is false — why the chain could not be read. */
  unavailableReason?: string
  status: DisplayStatus
  state: EscrowState | null
  expiresAt: number | null
  fundedAt: number | null
  secondsUntilExpiry: number | null
  isExpired: boolean
  canTimeout: boolean
  /** What the requesting wallet can do right now, derived from live state plus their role. */
  actions: string[]
  role: 'payer' | 'payee' | 'observer'
  transactions: { create: string | null; fund: string | null; settle: string | null }
  explorerTx: string | null
}

export type DashboardTotals = {
  /** Base units currently locked in escrow, per token. Funded and disputed escrows only. */
  securedByToken: { symbol: string; decimals: number; amount: string }[]
  activeVaults: number
  completed: number
  pendingRelease: number
  disputed: number
  /** Rows whose chain state could not be read; the counts above exclude them. */
  unreadable: number
}

const LOCKED_STATES = [EscrowState.Funded, EscrowState.Disputed]

function chainForInvoice(invoice: { chainKey: string | null; chainId: number }): VaultedChain | null {
  return (invoice.chainKey ? getChain(invoice.chainKey) : null) ?? getChainByEvmId(invoice.chainId)
}

export async function dashboardFor(rawAddress: string, rpcUrl?: string) {
  if (!isAddress(rawAddress)) return null
  const address = getAddress(rawAddress)

  const invoices = await prisma.invoice.findMany({
    where: {
      OR: [{ payeeAddress: address }, { payerAddress: address }, { fundedByAddress: address }],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const handles = await handlesForAddresses(
    invoices.flatMap((invoice) => [invoice.payeeAddress, invoice.payerAddress ?? '']).filter(Boolean),
  )

  const rows = await Promise.all(
    invoices.map(async (invoice): Promise<DashboardRow> => {
      const chain = chainForInvoice(invoice)
      const base = {
        invoiceId: invoice.id,
        escrowId: invoice.escrowId,
        chainKey: chain?.key ?? `evm-${invoice.chainId}`,
        chainName: chain?.name ?? `Chain ${invoice.chainId}`,
        description: invoice.description,
        amount: invoice.amount,
        token: { symbol: invoice.tokenSymbol, decimals: invoice.tokenDecimals },
        payer: invoice.payerAddress ?? invoice.fundedByAddress,
        payee: invoice.payeeAddress,
        payerHandle: handles[(invoice.payerAddress ?? '').toLowerCase()] ?? null,
        payeeHandle: handles[invoice.payeeAddress.toLowerCase()] ?? null,
        transactions: {
          create: invoice.createTxHash,
          fund: invoice.fundTxHash,
          settle: invoice.settleTxHash,
        },
        role: roleFor(address, invoice.payeeAddress, invoice.payerAddress ?? invoice.fundedByAddress),
      }

      if (!chain) {
        return {
          ...base,
          live: false,
          unavailableReason: `Chain ${invoice.chainId} is not in the registry.`,
          status: invoice.indexedStatus as DisplayStatus,
          state: null,
          expiresAt: null,
          fundedAt: null,
          secondsUntilExpiry: null,
          isExpired: false,
          canTimeout: false,
          actions: [],
          explorerTx: null,
        }
      }

      try {
        const adapter = adapterFor(chain, rpcUrl)
        const snapshot = await adapter.readEscrow(invoice.escrowId)

        if (!snapshot) {
          return {
            ...base,
            live: true,
            status: 'AWAITING_CHAIN',
            state: EscrowState.None,
            expiresAt: null,
            fundedAt: null,
            secondsUntilExpiry: null,
            isExpired: false,
            canTimeout: false,
            actions: [],
            explorerTx: invoice.createTxHash ? adapter.explorerTx(invoice.createTxHash) : null,
          }
        }

        const status = displayStatus(snapshot.state, snapshot.isExpired)
        return {
          ...base,
          live: true,
          status,
          state: snapshot.state,
          expiresAt: snapshot.expiresAt || null,
          fundedAt: snapshot.fundedAt || null,
          secondsUntilExpiry: snapshot.secondsUntilExpiry,
          isExpired: snapshot.isExpired,
          canTimeout: snapshot.canTimeout,
          actions: actionsFor(address, snapshot),
          explorerTx: invoice.settleTxHash
            ? adapter.explorerTx(invoice.settleTxHash)
            : invoice.fundTxHash
              ? adapter.explorerTx(invoice.fundTxHash)
              : null,
        }
      } catch (error) {
        const reason =
          ChainNotImplementedError.is(error)
            ? error.message
            : `Could not read ${chain.name}: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`
        return {
          ...base,
          live: false,
          unavailableReason: reason,
          status: invoice.indexedStatus as DisplayStatus,
          state: null,
          expiresAt: null,
          fundedAt: null,
          secondsUntilExpiry: null,
          isExpired: false,
          canTimeout: false,
          actions: [],
          explorerTx: null,
        }
      }
    }),
  )

  return { address, rows, totals: totalsFrom(rows) }
}

function roleFor(viewer: string, payee: string, payer: string | null): DashboardRow['role'] {
  const lower = viewer.toLowerCase()
  if (payee.toLowerCase() === lower) return 'payee'
  if (payer && payer.toLowerCase() === lower) return 'payer'
  return 'observer'
}

/** Mirrors what the contract will actually permit, so the dashboard never offers a doomed call. */
function actionsFor(viewer: string, snapshot: { state: EscrowState; payer: string; payee: string; canTimeout: boolean; canDispute: boolean }): string[] {
  const lower = viewer.toLowerCase()
  const isPayer = snapshot.payer.toLowerCase() === lower
  const isPayee = snapshot.payee.toLowerCase() === lower
  const locked = snapshot.state === EscrowState.Funded || snapshot.state === EscrowState.Disputed

  const actions: string[] = []
  if (snapshot.canTimeout) actions.push('executeTimeout') // permissionless
  if (locked && isPayer) actions.push('release')
  if (snapshot.state === EscrowState.Funded && isPayer && snapshot.canDispute) actions.push('dispute')
  if (locked && isPayee) actions.push('refund')
  if (snapshot.state === EscrowState.Created && isPayee) actions.push('cancel')
  return actions
}

function totalsFrom(rows: DashboardRow[]): DashboardTotals {
  const secured = new Map<string, { symbol: string; decimals: number; amount: bigint }>()
  let activeVaults = 0
  let completed = 0
  let pendingRelease = 0
  let disputed = 0
  let unreadable = 0

  for (const row of rows) {
    // Only rows we could actually read contribute to a total.
    if (!row.live || row.state === null) {
      unreadable++
      continue
    }

    if (LOCKED_STATES.includes(row.state)) {
      activeVaults++
      const entry = secured.get(row.token.symbol) ?? {
        symbol: row.token.symbol,
        decimals: row.token.decimals,
        amount: BigInt(0),
      }
      entry.amount += BigInt(row.amount)
      secured.set(row.token.symbol, entry)
    }

    if (row.state === EscrowState.Released || row.state === EscrowState.Resolved) completed++
    if (row.state === EscrowState.Disputed) disputed++
    if (row.canTimeout) pendingRelease++
  }

  return {
    securedByToken: [...secured.values()].map((entry) => ({
      symbol: entry.symbol,
      decimals: entry.decimals,
      amount: entry.amount.toString(),
    })),
    activeVaults,
    completed,
    pendingRelease,
    disputed,
    unreadable,
  }
}
