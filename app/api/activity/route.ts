import { NextRequest, NextResponse } from 'next/server'
import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { currentAccount, handlesForAddresses } from '@/lib/vaulted/server/accounts'
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

  const addresses = [
    ...(account?.wallets.map((w) => w.address) ?? []),
    ...(account?.primaryAddress ? [account.primaryAddress] : []),
    ...(extra && isAddress(extra) ? [getAddress(extra)] : []),
  ].map((a) => getAddress(a))
  const unique = [...new Set(addresses)]

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
    hash: string
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

    for (const [kind, label, hash, at] of [
      ['CREATED', 'Escrow created', invoice.createTxHash, invoice.createdAt],
      ['FUNDED', 'Escrow funded', invoice.fundTxHash, invoice.fundedAt ?? invoice.updatedAt],
      ['SETTLED', 'Escrow settled', invoice.settleTxHash, invoice.updatedAt],
    ] as const) {
      if (!hash) continue
      events.push({
        ...base,
        id: `${invoice.id}:${kind}`,
        kind,
        label,
        hash,
        explorerUrl: chain ? explorerTxUrl(chain, hash) : null,
        at: at.toISOString(),
      })
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : -1))
  return NextResponse.json({ events })
}
