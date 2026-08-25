import { NextRequest, NextResponse } from 'next/server'
import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { currentAccount, handlesForAddresses, evmAddressesOf } from '@/lib/vaulted/server/accounts'
import { getChain, getChainByEvmId, explorerTxUrl } from '@/lib/vaulted/registry'

/**
 * GET /api/activity — every transaction Vaulted has a hash for, for this account's wallets.
 *
 * Built from the hashes reported when each step was taken, each with an explorer link so it can be
 * checked independently. This is a history of transactions, not a claim about current escrow state
 * — the dashboard reads that from the chain.
 */
export async function GET(request: NextRequest) {
  const account = await currentAccount().catch(() => null)
  const extra = request.nextUrl.searchParams.get('address')

  const unique = [
    ...evmAddressesOf(account),
    ...(extra && isAddress(extra) ? [getAddress(extra)] : []),
  ]

  if (unique.length === 0) return NextResponse.json({ events: [] })

  const invoices = await prisma.invoice.findMany({
    where: {
      OR: [
        { payeeAddress: { in: unique } },
        { payerAddress: { in: unique } },
        { fundedByAddress: { in: unique } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const handles = await handlesForAddresses(
    invoices.flatMap((i) => [i.payeeAddress, i.payerAddress ?? '', i.fundedByAddress ?? '']).filter(Boolean),
  )

  type Event = {
    id: string
    kind: 'CREATED' | 'FUNDED' | 'SETTLED'
    label: string
    invoiceId: string
    description: string
    amount: string
    token: { symbol: string; decimals: number }
    chainName: string
    counterparty: string | null
    counterpartyHandle: string | null
    role: 'payee' | 'payer'
    /** Null when the step is known from the chain but no hash was ever reported for it. */
    hash: string | null
    explorerUrl: string | null
    at: string
  }

  const events: Event[] = []

  for (const invoice of invoices) {
    const chain = (invoice.chainKey ? getChain(invoice.chainKey) : null) ?? getChainByEvmId(invoice.chainId)
    const isPayee = unique.some((a) => a.toLowerCase() === invoice.payeeAddress.toLowerCase())
    const counterparty = isPayee ? (invoice.payerAddress ?? invoice.fundedByAddress) : invoice.payeeAddress

    const base = {
      invoiceId: invoice.id,
      description: invoice.description,
      amount: invoice.amount,
      token: { symbol: invoice.tokenSymbol, decimals: invoice.tokenDecimals },
      chainName: chain?.name ?? `Chain ${invoice.chainId}`,
      counterparty,
      counterpartyHandle: counterparty ? (handles[counterparty.toLowerCase()] ?? null) : null,
      role: (isPayee ? 'payee' : 'payer') as 'payee' | 'payer',
    }

    /*
     * A step counts as having happened if we hold its transaction hash, or if the chain says it did.
     *
     * Hashes alone used to be the whole story, and they are reported by a browser after the fact —
     * so a tab closed at the wrong moment, or a page that never reported one, erased the step from
     * this history permanently. A payment that demonstrably settled on chain then appeared under no
     * category at all, which is the one thing a record of what happened must never do.
     *
     * `indexedStatus` is written by the sync path from a real contract read, so it is evidence of
     * the same quality as a hash — just with no transaction to link to, which is why the explorer
     * link is null rather than invented.
     */
    const settledOnChain = ['RELEASED', 'REFUNDED', 'RESOLVED'].includes(invoice.indexedStatus)
    const fundedOnChain = settledOnChain || ['IN_ESCROW', 'DISPUTED', 'EXPIRED'].includes(invoice.indexedStatus)
    const createdOnChain = fundedOnChain || invoice.indexedStatus === 'AWAITING_PAYMENT'

    for (const [kind, label, hash, at, onChain] of [
      ['CREATED', 'Escrow created', invoice.createTxHash, invoice.createdAt, createdOnChain],
      ['FUNDED', 'Escrow funded', invoice.fundTxHash, invoice.fundedAt ?? invoice.updatedAt, fundedOnChain],
      ['SETTLED', 'Escrow settled', invoice.settleTxHash, invoice.updatedAt, settledOnChain],
    ] as const) {
      if (!hash && !onChain) continue
      events.push({
        ...base,
        id: `${invoice.id}:${kind}`,
        kind,
        label,
        hash,
        explorerUrl: hash && chain ? explorerTxUrl(chain, hash) : null,
        at: at.toISOString(),
      })
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : -1))
  return NextResponse.json({ events })
}
