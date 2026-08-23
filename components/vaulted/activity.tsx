'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Lock, Receipt, RefreshCw, Send } from 'lucide-react'
import { useAccount } from 'wagmi'
import { formatAmount, shortAddress, shortHash } from '@/lib/vaulted/format'
import { Button, Card, Eyebrow, Skeleton } from './primitives'
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
  hash: string
  explorerUrl: string | null
  at: string
}

const KIND_ICON = { CREATED: Send, FUNDED: Lock, SETTLED: Receipt } as const

/**
 * Transaction history.
 *
 * Every row is a transaction hash Vaulted recorded, with a link to check it on an explorer. It is a
 * log of what happened, not a statement of current escrow state — the dashboard reads that live.
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
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Activity</h1>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Every Vaulted transaction for your wallets, with a link to verify each one on chain.
          </p>
        </div>
        <Button variant="ghost" busy={loading} onClick={load} className="h-8 px-2 text-xs">
          {!loading && <RefreshCw size={13} />} Refresh
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(['ALL', 'CREATED', 'FUNDED', 'SETTLED'] as const).map((option) => {
          const count = option === 'ALL' ? (events?.length ?? 0) : (events ?? []).filter((e) => e.kind === option).length
          return (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`rounded-lg px-3 py-1.5 text-[13px] transition ${
                filter === option
                  ? 'bg-[var(--vt-accent)] font-medium text-[#08080a]'
                  : 'border border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {option === 'ALL' ? 'All' : option.charAt(0) + option.slice(1).toLowerCase()}
              <span className="ml-1.5 opacity-60">{count}</span>
            </button>
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
        <Card className="flex flex-col items-center gap-2 px-7 py-14 text-center">
          <Receipt size={20} className="text-muted-foreground" />
          <p className="text-sm font-medium">No transactions yet</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">
            Escrow transactions appear here once you create, fund or settle one.
          </p>
        </Card>
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
                  ) : (
                    <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{shortHash(event.hash)}</span>
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
