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
import { Button, Card, Divider, EmptyState, Notice, PageHeader, Skeleton, StatusPill } from './primitives'
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
      <div className="mb-8">
        <PageHeader
          eyebrow="Client"
          title="Jobs I posted"
          body={
            <>
              Every job you posted, including the ones already assigned — review submitted work and
              release the funds here.
            </>
          }
          actions={
            <>
              <Button variant="ghost" busy={loading} onClick={load}>
                {!loading && <RefreshCw size={14} />} Refresh
              </Button>
              <Link href="/jobs">
                <Button variant="secondary">Open board</Button>
              </Link>
            </>
          }
        />
      </div>

      {jobs === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[140px]" />
          <Skeleton className="h-[140px]" />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Briefcase size={22} />}
          title="No jobs posted"
          body="Post work with a budget attached and it shows up here at every stage — applicants, submission, release."
          action={
            <Link href="/jobs">
              <Button>Post a job</Button>
            </Link>
          }
        />
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/jobs/${job.jobId}`} className="text-[14.5px] font-medium hover:underline">
              {job.title}
            </Link>
            <span className="rounded-full border border-white/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {job.status}
            </span>
            {job.escrow && <StatusPill status={job.escrow.status as DisplayStatus} />}
          </div>
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">{job.description}</p>
          <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            <span>{job.chainName}</span>
            <span className="inline-flex items-center gap-2.5">
              <span aria-hidden className="opacity-40">/</span>
              {job.applicationCount} applicant{job.applicationCount === 1 ? '' : 's'}
            </span>
            {job.assignedTo && (
              // The meta row is set in capitals; an address is not, and uppercasing one destroys
              // the checksum casing that makes it verifiable.
              <span className="inline-flex items-center gap-2.5">
                <span aria-hidden className="opacity-40">/</span>
                <span>
                  Assigned to <span className="normal-case">{shortAddress(job.assignedTo)}</span>
                </span>
              </span>
            )}
            {job.deadline && (
              <span className="inline-flex items-center gap-2.5">
                <span aria-hidden className="opacity-40">/</span>
                Due {formatTimestamp(job.deadline)}
              </span>
            )}
          </p>
        </div>
        <p className="vt-numeric vt-editorial shrink-0 text-[19px] leading-none">
          {formatAmount(job.budgetAmount, job.token.decimals)}
          <span className="ml-1.5 text-[0.58em] uppercase tracking-[0.12em] text-muted-foreground">
            {job.token.symbol}
          </span>
        </p>
      </div>

      {job.status === 'ASSIGNED' && (
        <>
          <Divider className="my-5" />

          {job.submittedAt ? (
            <div className="rounded-xl border border-white/8 bg-black/25 p-4">
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
              /*
                The client's own route to securing the budget.

                Under the v1 contract the escrow's creator was always its payee, so this could only
                wait on the freelancer — and a freelancer with an empty wallet could not create it
                at all, which left the budget unsecured with nothing either side could do. v2 lets
                the client create it naming them, so the action belongs here, to the person who was
                going to pay for it anyway.
              */
              <div className="flex flex-col gap-3">
                <Notice tone="warn" icon={<AlertTriangle size={15} />} title="Budget not secured yet">
                  No escrow exists for this job. Create and fund it here — the freelancer pays
                  nothing and needs no balance of their own.
                </Notice>
                <Link href={`/request?job=${job.jobId}`} className="w-fit">
                  <Button>
                    Secure {formatAmount(job.budgetAmount, job.token.decimals)} {job.token.symbol}
                  </Button>
                </Link>
              </div>
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
                <Link href={`/pay/${job.invoiceId}`} className="w-fit">
                  <Button>
                    Fund {formatAmount(job.budgetAmount, job.token.decimals)} {job.token.symbol}
                  </Button>
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
                  /*
                    Record the hash, then reload.

                    This used to reload and nothing else, which quietly cost two things: the
                    settlement never appeared in Activity, which is built from reported hashes, and
                    nobody was notified, because recording a hash is what makes the server re-read
                    the chain. Releasing from here is the client's main route to paying somebody, so
                    it was the one place that most needed to report it.
                  */
                  onSettled={async (hash) => {
                    await fetch(`/api/invoices/${job.invoiceId}`, {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ field: 'settleTxHash', hash }),
                    }).catch(() => null)
                    onChanged()
                  }}
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
