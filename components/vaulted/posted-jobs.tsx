'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  Clock,
  ExternalLink,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useAccount } from 'wagmi'
import { useVaultedConfig } from '@/lib/vaulted/client'
import { formatAmount, formatTimestamp, shortAddress } from '@/lib/vaulted/format'
import { EscrowState, type DisplayStatus } from '@/lib/vaulted/status'
import { EscrowActions } from './escrow-actions'
import { useEscrow } from '@/lib/vaulted/client'
import { Button, Card, Divider, Eyebrow, Notice, Skeleton, StatusPill } from './primitives'
import { AppShell } from './shell'

type PostedJob = {
  jobId: string
  title: string
  description: string
  budgetAmount: string
  token: { symbol: string; decimals: number }
  chainName: string
  status: string
  assignedTo: string | null
  applicationCount: number
  deadline: number | null
  submittedAt: number | null
  submissionNote: string | null
  submissionLinks: string | null
  invoiceId: string | null
  escrowId: string | null
  escrow: { status: string; live: boolean; reason?: string } | null
  createdAt: string
}

/**
 * Jobs this account posted, at every stage.
 *
 * The open board hides a job the moment it is assigned, which left clients unable to follow their
 * own work. This page is where a client reviews a submission and releases the funds.
 */
export function PostedJobs() {
  const { address } = useAccount()
  const [jobs, setJobs] = useState<PostedJob[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fetchJobs = async () => {
        const response = await fetch(`/api/jobs/posted${address ? `?address=${address}` : ''}`, { cache: 'no-store' })
        const body = await response.json()
        return (body.jobs ?? []) as PostedJob[]
      }

      const rows = await fetchJobs()
      setJobs(rows)

      /*
        Re-read each escrow from the contract, the way the freelancer's own list already does.

        Not only for a fresher status. Syncing is what records a state change and notifies both
        sides of it, and the client had no path that ever ran one — so an escrow raised for their
        job went on chain, sat there waiting to be funded, and said nothing to the one person who
        had to act next.

        Rendered first and refreshed after, so the page is never blank while this happens.
      */
      const withEscrow = rows.filter((job) => job.invoiceId)
      if (withEscrow.length > 0) {
        await Promise.all(
          withEscrow.map((job) =>
            fetch(`/api/invoices/${job.invoiceId}/sync`, { method: 'POST' }).catch(() => null),
          ),
        )
        setJobs(await fetchJobs())
      }
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Jobs I posted</h1>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Every job you posted, including the ones already assigned — review submitted work and
            release the funds here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" busy={loading} onClick={load} className="h-8 px-2 text-xs">
            {!loading && <RefreshCw size={13} />} Refresh
          </Button>
          <Link href="/jobs">
            <Button variant="secondary">Open board</Button>
          </Link>
        </div>
      </div>

      {jobs === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[140px]" />
          <Skeleton className="h-[140px]" />
        </div>
      ) : jobs.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-7 py-14 text-center">
          <Briefcase size={20} className="text-muted-foreground" />
          <p className="text-sm font-medium">You have not posted any jobs</p>
          <Link href="/jobs" className="mt-1 text-[13px]" style={{ color: 'var(--vt-accent)' }}>
            Post one →
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <PostedJobCard key={job.jobId} job={job} onChanged={load} />
          ))}
        </div>
      )}
    </AppShell>
  )
}

function PostedJobCard({ job, onChanged }: { job: PostedJob; onChanged: () => void }) {
  const config = useVaultedConfig()
  // Live read for the release controls — the list endpoint's snapshot is for display only.
  const { escrow: live } = useEscrow((job.escrowId as `0x${string}` | null) ?? undefined)

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/jobs/${job.jobId}`} className="text-[15px] font-medium hover:underline">
              {job.title}
            </Link>
            <span className="vt-eyebrow rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{job.status}</span>
            {job.escrow && <StatusPill status={job.escrow.status as DisplayStatus} />}
          </div>
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">{job.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            <span>{job.chainName}</span>
            <span aria-hidden>·</span>
            <span>{job.applicationCount} applicant{job.applicationCount === 1 ? '' : 's'}</span>
            {job.assignedTo && (
              <>
                <span aria-hidden>·</span>
                <span>Assigned to {shortAddress(job.assignedTo)}</span>
              </>
            )}
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

      {job.status === 'ASSIGNED' && (
        <>
          <Divider className="my-5" />

          {job.submittedAt ? (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--vt-positive)' }}>
                <FileCheck2 size={14} /> Work submitted {formatTimestamp(job.submittedAt)}
              </p>
              {job.submissionNote && (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{job.submissionNote}</p>
              )}
              {job.submissionLinks && (
                <ul className="mt-3 flex flex-col gap-1">
                  {job.submissionLinks
                    .split('\n')
                    .map((link) => link.trim())
                    .filter(Boolean)
                    .map((link) => (
                      <li key={link}>
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1.5 text-[12.5px] hover:underline"
                          style={{ color: 'var(--vt-accent)' }}
                        >
                          <ExternalLink size={11} /> {link}
                        </a>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ) : (
            <Notice tone="neutral" icon={<Clock size={15} />}>
              The freelancer has not submitted the work yet.
            </Notice>
          )}

          <div className="mt-4">
            {!job.invoiceId ? (
              <Notice tone="warn" icon={<AlertTriangle size={15} />}>
                No escrow exists for this job, so the budget is not secured. The contract makes the
                person being paid its creator, so the freelancer raises it — they have been notified
                — and you fund it here as soon as they do.
              </Notice>
            ) : !job.escrow?.live ? (
              <Notice tone="warn" icon={<AlertTriangle size={15} />}>
                {job.escrow?.reason ?? 'The chain could not be read just now.'}
              </Notice>
            ) : live && live.state === EscrowState.Created ? (
              /*
                Raised but not funded: the budget is not secured yet, and `EscrowActions` has
                nothing to offer the payer in this state. Funding is the action, so offer it here.
              */
              <div className="flex flex-col gap-3">
                <Notice tone="warn" icon={<AlertTriangle size={15} />} title="Budget not secured yet">
                  The escrow exists but holds nothing until you fund it. Do it before work starts —
                  until then there is no protection for either side.
                </Notice>
                <Link
                  href={`/pay/${job.invoiceId}`}
                  className="inline-flex h-12 w-fit items-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-[#08080a] transition-transform hover:-translate-y-0.5"
                  style={{ background: 'var(--vt-accent)' }}
                >
                  Fund {formatAmount(job.budgetAmount, job.token.decimals)} {job.token.symbol}
                </Link>
              </div>
            ) : live && config ? (
              <>
                <p className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <ShieldCheck size={13} style={{ color: 'var(--vt-positive)' }} />
                  Releasing pays the freelancer immediately and cannot be undone.
                </p>
                {/*
                  The same on-chain actions as everywhere else — reviewing a submission does not
                  create a second, softer way to move money.
                */}
                <EscrowActions
                  escrowId={job.escrowId as `0x${string}`}
                  escrow={live}
                  config={config}
                  compact
                  onSettled={() => onChanged()}
                />
              </>
            ) : (
              <Skeleton className="h-11 w-full" />
            )}
          </div>

          {job.invoiceId && (
            <Link
              href={`/requests/${job.invoiceId}`}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Open the escrow <ArrowUpRight size={14} />
            </Link>
          )}
        </>
      )}
    </Card>
  )
}
