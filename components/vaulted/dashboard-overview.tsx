'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, Gavel, Inbox, RefreshCw, Timer } from 'lucide-react'
import { useAccount } from 'wagmi'
import type { DashboardRow, DashboardTotals } from '@/lib/vaulted/server/dashboard'
import { formatAmount, formatCountdown, formatTimestamp, shortAddress } from '@/lib/vaulted/format'
import type { DisplayStatus } from '@/lib/vaulted/status'
import { Button, Card, Chip, EmptyState, Eyebrow, Notice, Skeleton, Stat, StatusPill } from './primitives'

/**
 * The authenticated overview.
 *
 * Rows and totals come from `/api/dashboard`, which reads each escrow from its chain. Anything the
 * chain could not answer for is shown as unreadable rather than filled in from the cache, and it is
 * left out of the headline numbers.
 */

type Payload = { address: string; rows: DashboardRow[]; totals: DashboardTotals }

const SECTIONS: { key: string; label: string; match: (row: DashboardRow) => boolean }[] = [
  { key: 'created', label: 'Created', match: (row) => row.status === 'AWAITING_PAYMENT' || row.status === 'AWAITING_CHAIN' },
  { key: 'funded', label: 'Funded', match: (row) => row.status === 'IN_ESCROW' || row.status === 'EXPIRED' },
  { key: 'completed', label: 'Completed', match: (row) => ['RELEASED', 'REFUNDED', 'RESOLVED', 'CANCELLED'].includes(row.status) },
  { key: 'disputed', label: 'Disputed', match: (row) => row.status === 'DISPUTED' },
]

export function DashboardOverview() {
  const { address, isConnected } = useAccount()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState('funded')

  const load = useCallback(async () => {
    if (!address) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/dashboard?address=${address}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not load your vaults.')
      setData(body)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your vaults.')
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    setData(null)
    void load()
  }, [load])

  if (!isConnected) return null

  const rows = data?.rows ?? []
  const visible = rows.filter(SECTIONS.find((entry) => entry.key === section)!.match)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Eyebrow>Overview</Eyebrow>
        <Button variant="ghost" busy={loading} onClick={load} className="h-8 px-2 text-xs">
          {!loading && <RefreshCw size={13} />}
          Read from chain
        </Button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {data === null && loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-[86px]" />
          ))}
        </div>
      ) : (
        data && <Totals totals={data.totals} />
      )}

      {data && data.totals.unreadable > 0 && (
        <Notice tone="warn" icon={<AlertTriangle size={15} />}>
          {data.totals.unreadable} vault{data.totals.unreadable === 1 ? '' : 's'} could not be read from
          the chain just now, so {data.totals.unreadable === 1 ? 'it is' : 'they are'} left out of the
          totals above rather than counted from a cached value.
        </Notice>
      )}

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((entry) => {
          const count = rows.filter(entry.match).length
          return (
            <Chip
              key={entry.key}
              selected={section === entry.key}
              onClick={() => setSection(entry.key)}
              count={count}
            >
              {entry.label}
            </Chip>
          )
        })}
      </div>

      {data === null && loading ? (
        <Skeleton className="h-24 w-full" />
      ) : visible.length === 0 ? (
        <EmptyState icon={<Inbox size={22} />} title="Nothing here yet" />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((row) => (
            <VaultRow key={row.invoiceId} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

function Totals({ totals }: { totals: DashboardTotals }) {
  const secured =
    totals.securedByToken.length > 0
      ? totals.securedByToken
          .map((entry) => `${formatAmount(entry.amount, entry.decimals)} ${entry.symbol}`)
          .join(' · ')
      : '—'

  const tiles = [
    { label: 'Total secured', value: secured, hint: 'Locked in escrow right now' },
    { label: 'Active vaults', value: String(totals.activeVaults) },
    { label: 'Completed', value: String(totals.completed) },
    { label: 'Pending release', value: String(totals.pendingRelease), hint: 'Expired and settleable by anyone' },
    { label: 'Disputed', value: String(totals.disputed) },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((tile, index) => (
        // The amount held is the figure this page exists for, so it is the one that takes accent.
        <Stat key={tile.label} label={tile.label} value={tile.value} note={tile.hint} accent={index === 0} />
      ))}
    </div>
  )
}

const ACTION_LABEL: Record<string, { label: string; icon: typeof Timer }> = {
  executeTimeout: { label: 'Auto-release available', icon: Timer },
  release: { label: 'You can release', icon: ArrowUpRight },
  dispute: { label: 'You can dispute', icon: Gavel },
  refund: { label: 'You can refund', icon: ArrowUpRight },
  cancel: { label: 'You can cancel', icon: ArrowUpRight },
}

function VaultRow({ row }: { row: DashboardRow }) {
  return (
    <Link href={`/requests/${row.invoiceId}`} className="group">
      <Card className="px-5 py-4 transition group-hover:border-foreground/25">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{row.description}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
              <span>{row.chainName}</span>
              <span aria-hidden>·</span>
              <span>
                {row.role === 'payee' ? 'from' : 'to'}{' '}
                {row.role === 'payee'
                  ? row.payerHandle
                    ? `@${row.payerHandle}`
                    : shortAddress(row.payer)
                  : row.payeeHandle
                    ? `@${row.payeeHandle}`
                    : shortAddress(row.payee)}
              </span>
              {row.expiresAt && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {row.isExpired ? 'expired' : `closes in ${formatCountdown(row.secondsUntilExpiry ?? 0)}`}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="vt-numeric text-sm font-semibold">
              {formatAmount(row.amount, row.token.decimals)} {row.token.symbol}
            </p>
            <div className="mt-1 flex justify-end">
              {row.live ? (
                <StatusPill status={row.status as DisplayStatus} />
              ) : (
                <span
                  className="vt-eyebrow inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{ background: 'var(--vt-warning-soft)', color: 'var(--vt-warning)' }}
                  title={row.unavailableReason}
                >
                  <AlertTriangle size={10} /> Chain unreadable
                </span>
              )}
            </div>
          </div>
        </div>

        {row.actions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/8 pt-4">
            {row.actions.map((action) => {
              const entry = ACTION_LABEL[action]
              if (!entry) return null
              return (
                <span
                  key={action}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[11.5px] text-muted-foreground"
                >
                  <entry.icon size={11} />
                  {entry.label}
                </span>
              )
            })}
          </div>
        )}

        {row.expiresAt && !row.isExpired && (
          <p className="mt-2 text-[11px] text-muted-foreground">Settles {formatTimestamp(row.expiresAt)}</p>
        )}
      </Card>
    </Link>
  )
}
