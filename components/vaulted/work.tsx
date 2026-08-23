'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, Briefcase, CheckCircle2, Clock, FileCheck2, RefreshCw, Upload } from 'lucide-react'
import { useAccount, useSignMessage } from 'wagmi'
import { readableError } from '@/lib/vaulted/client'
import { workSubmissionMessage } from '@/lib/vaulted/messages'
import { Field, inputClass } from './primitives'
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
    submittedAt: number | null
    submissionNote: string | null
    submissionLinks: string | null
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
          <Group title="Hired" rows={hired} emptyLabel="Nothing yet." highlight onChanged={load} />
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
  onChanged,
}: {
  title: string
  rows: WorkRow[]
  emptyLabel: string
  highlight?: boolean
  onChanged?: () => void
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
            <WorkCard key={row.applicationId} row={row} highlight={highlight} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  )
}

function WorkCard({ row, highlight, onChanged }: { row: WorkRow; highlight?: boolean; onChanged?: () => void }) {
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

          <SubmitWork row={row} onChanged={onChanged} />
        </div>
      )}
    </Card>
  )
}


/**
 * Hand in the work.
 *
 * Deliberately off-chain and clearly labelled as such: submitting releases nothing. The client
 * still has to release on chain, and if they do nothing the protection window pays out anyway.
 */
function SubmitWork({ row, onChanged }: { row: WorkRow; onChanged?: () => void }) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(row.job.submissionNote ?? '')
  const [links, setLinks] = useState(row.job.submissionLinks ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submitted = row.job.submittedAt !== null

  async function submit() {
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      const issuedAt = Math.floor(Date.now() / 1000)
      const signature = await signMessageAsync({
        message: workSubmissionMessage({ jobId: row.job.jobId, applicant: address, issuedAt }),
      })
      const response = await fetch(`/api/jobs/${row.job.jobId}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicantAddress: address, note: note.trim(), links: links.trim(), issuedAt, signature }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not submit.')
      setOpen(false)
      onChanged?.()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      {submitted && !open ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--vt-positive)' }}>
              <FileCheck2 size={14} /> Work submitted {formatTimestamp(row.job.submittedAt)}
            </p>
            {row.job.submissionNote && (
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                {row.job.submissionNote}
              </p>
            )}
          </div>
          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>
            Update
          </Button>
        </div>
      ) : open ? (
        <div className="flex flex-col gap-3">
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="What you delivered">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={1500}
              placeholder="A short summary of the work."
              className={inputClass}
              disabled={busy}
            />
          </Field>
          <Field label="Links" optional hint="One per line — a repo, a preview, a file.">
            <textarea
              value={links}
              onChange={(event) => setLinks(event.target.value)}
              rows={2}
              placeholder="https://…"
              className={inputClass}
              disabled={busy}
            />
          </Field>
          <div className="flex gap-2">
            <Button busy={busy} disabled={!note.trim() || !isConnected} onClick={submit}>
              {submitted ? 'Update submission' : 'Submit work'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Submitting notifies the client. It does not release funds — they release on chain, or the
            protection window closes and it settles to you anyway.
          </p>
        </div>
      ) : (
        <Button full variant="secondary" onClick={() => setOpen(true)} disabled={!isConnected}>
          <Upload size={15} />
          {isConnected ? 'Submit completed work' : 'Sign in to submit work'}
        </Button>
      )}
    </div>
  )
}
