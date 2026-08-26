'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Lock, Receipt, RefreshCw, Send } from 'lucide-react'
import { useAccount } from 'wagmi'
import { formatAmount, shortAddress, shortHash } from '@/lib/vaulted/format'
import { Button, Card, Chip, EmptyState, Eyebrow, PageHeader, Skeleton } from './primitives'
import { AppShell } from './shell'

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

const KIND_ICON = { CREATED: Send, FUNDED: Lock, SETTLED: Receipt } as const

/**
 * Transaction history.
 *
 * Every row is a step that actually happened: a transaction hash Vaulted recorded, with a link to
 * check it on an explorer, or a state the contract itself confirms when no hash was ever reported.
 * A log of what happened, not a statement of current escrow state — the dashboard reads that live.
 */
export function ActivityPage() {
  const { address } = useAccount()
  const [events, setEvents] = useState<Event[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'ALL' | Event['kind']>('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/activity${address ? `?address=${address}` : ''}`, { cache: 'no-store' })
      const body = await response.json()
      setEvents(body.events ?? [])
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    void load()
  }, [load])

  const visible = (events ?? []).filter((event) => filter === 'ALL' || event.kind === filter)

  return (
    <AppShell>
      <div className="mb-8">
        <PageHeader
          eyebrow="Ledger"
          title="Activity"
          body="Every Vaulted transaction for your wallets, with a link to verify each one on chain."
          actions={
            <Button variant="ghost" busy={loading} onClick={load}>
              {!loading && <RefreshCw size={14} />} Refresh
            </Button>
          }
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {(['ALL', 'CREATED', 'FUNDED', 'SETTLED'] as const).map((option) => {
          const count = option === 'ALL' ? (events?.length ?? 0) : (events ?? []).filter((e) => e.kind === option).length
          return (
            <Chip key={option} selected={filter === option} onClick={() => setFilter(option)} count={count}>
              {option === 'ALL' ? 'All' : option.charAt(0) + option.slice(1).toLowerCase()}
            </Chip>
          )
        })}
      </div>

      {events === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[74px]" />
          <Skeleton className="h-[74px]" />
          <Skeleton className="h-[74px]" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Receipt size={22} />}
          title="No transactions yet"
          body="Escrow transactions appear here once you create, fund or settle one."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((event) => {
            const Icon = KIND_ICON[event.kind]
            const incoming = event.role === 'payee'
            return (
              <Card key={event.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--muted)', color: 'var(--vt-accent)' }}
                >
                  <Icon size={16} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                    {event.label}
                    <span className="text-muted-foreground">·</span>
                    <Link href={`/requests/${event.invoiceId}`} className="truncate font-normal text-muted-foreground hover:underline">
                      {event.description}
                    </Link>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      {incoming ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
                      {incoming ? 'from' : 'to'}{' '}
                      {event.counterpartyHandle
                        ? `@${event.counterpartyHandle}`
                        : shortAddress(event.counterparty)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{event.chainName}</span>
                    <span aria-hidden>·</span>
                    <span>{new Date(event.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="vt-numeric text-[13.5px] font-semibold">
                    {formatAmount(event.amount, event.token.decimals)} {event.token.symbol}
                  </p>
                  {event.explorerUrl ? (
                    <a
                      href={event.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {shortHash(event.hash)} <ExternalLink size={10} />
                    </a>
                  ) : event.hash ? (
                    <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{shortHash(event.hash)}</span>
                  ) : (
                    /*
                      Read from the contract rather than from a hash the browser reported. Said
                      plainly, because "—" on its own reads as missing data when the step is in fact
                      confirmed — there is simply no transaction to link to.
                    */
                    <span className="mt-1 block text-[11px] text-muted-foreground">confirmed on chain</span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
