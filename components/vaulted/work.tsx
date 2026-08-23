'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, Briefcase, CheckCircle2, Clock, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { formatAmount, formatTimestamp, shortAddress } from '@/lib/vaulted/format'
import { STATUS_COPY, type DisplayStatus } from '@/lib/vaulted/status'
import { Button, Card, Eyebrow, Notice, Skeleton, StatusPill } from './primitives'
import { AppShell } from './shell'

type WorkRow = {
  applicationId: string
  applicationStatus: string
  appliedAt: string
  hired: boolean
  job: {
    jobId: string
    title: string
    description: string
    budgetAmount: string
    token: { symbol: string; decimals: number }
    chainName: string
    status: string
    deadline: number | null
    clientAddress: string
    invoiceId: string | null
  }
  escrow: { status: string; live: boolean; reason?: string } | null
}

/**
 * "My work" — the page a hired applicant previously had no way to reach.
 *
 * Shows every job applied to, whether it was won, and the live state of the escrow behind it.
 */
export function WorkPage() {
  const { address } = useAccount()
  const [rows, setRows] = useState<WorkRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = address ? `?address=${address}` : ''
      const response = await fetch(`/api/work${query}`, { cache: 'no-store' })
      const body = await response.json()
      setRows(body.applications ?? [])
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    void load()
  }, [load])

  const hired = rows?.filter((row) => row.hired) ?? []
  const pending = rows?.filter((row) => !row.hired && row.applicationStatus === 'PENDING') ?? []
  const closed = rows?.filter((row) => !row.hired && row.applicationStatus === 'DECLINED') ?? []

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vt-display text-3xl leading-tight sm:text-4xl">My work</h1>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Jobs you applied to, and the live state of the escrow behind anything you were hired for.
          </p>
        </div>
        <Button variant="ghost" busy={loading} onClick={load} className="h-8 px-2 text-xs">
          {!loading && <RefreshCw size={13} />} Refresh
        </Button>
      </div>

      {rows === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[120px]" />
          <Skeleton className="h-[120px]" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-7 py-14 text-center">
          <Briefcase size={20} className="text-muted-foreground" />
          <p className="text-sm font-medium">No applications yet</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">
            Apply to a job and it shows up here, along with whatever escrow gets created for it.
          </p>
          <Link href="/jobs" className="mt-2 text-[13px]" style={{ color: 'var(--vt-accent)' }}>
            Browse open jobs →
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          <Group title="Hired" rows={hired} emptyLabel="Nothing yet." highlight />
          <Group title="Awaiting a decision" rows={pending} emptyLabel="No open applications." />
          <Group title="Not selected" rows={closed} emptyLabel="None." />
        </div>
      )}
    </AppShell>
  )
}

function Group({
  title,
  rows,
  emptyLabel,
  highlight,
}: {
  title: string
  rows: WorkRow[]
  emptyLabel: string
  highlight?: boolean
}) {
  return (
    <section>
      <Eyebrow>
        {title} ({rows.length})
      </Eyebrow>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <WorkCard key={row.applicationId} row={row} highlight={highlight} />
          ))}
        </div>
      )}
    </section>
  )
}

function WorkCard({ row, highlight }: { row: WorkRow; highlight?: boolean }) {
  const { job, escrow } = row
  return (
    <Card className={`p-5 ${highlight ? 'border-[rgba(255,138,0,0.3)]' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/jobs/${job.jobId}`} className="text-sm font-medium hover:underline">
              {job.title}
            </Link>
            {row.hired && (
              <span
                className="vt-eyebrow inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{ background: 'var(--vt-accent-dim)', color: 'var(--vt-accent)' }}
              >
                <CheckCircle2 size={10} /> Hired
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">{job.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span>{job.chainName}</span>
            <span aria-hidden>·</span>
            <span>Client {shortAddress(job.clientAddress)}</span>
            {job.deadline && (
              <>
                <span aria-hidden>·</span>
                <span>Due {formatTimestamp(job.deadline)}</span>
              </>
            )}
          </p>
        </div>
        <p className="vt-numeric shrink-0 text-sm font-semibold">
          {formatAmount(job.budgetAmount, job.token.decimals)} {job.token.symbol}
        </p>
      </div>

      {row.hired && (
        <div className="mt-4 border-t border-border pt-4">
          {escrow ? (
            escrow.live ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  Escrow <StatusPill status={escrow.status as DisplayStatus} />
                </span>
                {job.invoiceId && (
                  <Link
                    href={`/requests/${job.invoiceId}`}
                    className="inline-flex items-center gap-1.5 text-[13px]"
                    style={{ color: 'var(--vt-accent)' }}
                  >
                    Monitor escrow <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
            ) : (
              <Notice tone="warn" icon={<AlertTriangle size={15} />}>
                {escrow.reason ?? 'The chain could not be read just now.'}
              </Notice>
            )
          ) : (
            <Notice tone="warn" icon={<Clock size={15} />}>
              The client has not created the escrow for this job yet, so the budget is not secured.
              Nothing is payable until they do.
            </Notice>
          )}
          {escrow?.live && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">{STATUS_COPY[escrow.status as DisplayStatus]?.detail}</p>
          )}
        </div>
      )}
    </Card>
  )
}
