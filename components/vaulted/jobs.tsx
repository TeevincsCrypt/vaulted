'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Briefcase, Clock, Loader2, ShieldCheck } from 'lucide-react'
import { useAccount, useSignMessage } from 'wagmi'
import { readableError } from '@/lib/vaulted/client'
import { formatAmount, formatTimestamp, parseAmount, PROTECTION_PERIOD_PRESETS, shortAddress } from '@/lib/vaulted/format'
import { jobAcceptMessage, jobApplicationMessage, jobCreationMessage } from '@/lib/vaulted/messages'
import { defaultChain, defaultPaymentChain, getChain, paymentChains } from '@/lib/vaulted/registry'
import { ChainSelector } from './chain-selector'
import { AddressChip, Button, Card, Divider, Eyebrow, Field, Notice, Skeleton, inputClass } from './primitives'
import { AppShell } from './shell'
import { SignInButton } from './wallet'

/**
 * Funded jobs.
 *
 * A job is off-chain metadata that a client signs. Accepting an applicant assigns the job; it does
 * not move money. Securing the budget is the existing escrow flow — this feature deliberately adds
 * no new settlement path, so nothing here can claim a payment the contract has not made.
 */

type Job = {
  jobId: string
  title: string
  description: string
  budgetAmount: string
  chainKey: string
  token: { symbol: string; decimals: number }
  deadline: number | null
  protectionPeriod: number
  clientAddress: string
  status: 'OPEN' | 'ASSIGNED' | 'CANCELLED'
  assignedTo: string | null
  applicationCount?: number
  invoiceId: string | null
  escrowId: string | null
  createdAt: string
}

/** The direct payment that stands in for escrow where the network cannot hold one. */
type JobPayment = {
  id: string
  amount: string
  currency: string
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED'
  paidAt: string | null
}

type Application = {
  id: string
  applicantAddress: string
  message: string
  status: string
  createdAt: string
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

function generateJobId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) id += alphabet[byte % alphabet.length]
  return `job_${id}`
}

/* ------------------------------------------------------------------ list */

export function JobsBoard() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [composing, setComposing] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch('/api/jobs?status=OPEN')
    const body = await response.json().catch(() => ({ jobs: [] }))
    setJobs(body.jobs ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Open jobs</h1>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Work posted with a budget attached. Whether a job&rsquo;s escrow is funded is read from the
            chain on its page — never asserted here.
          </p>
        </div>
        <Button onClick={() => setComposing((value) => !value)}>
          {composing ? 'Close' : 'Post a job'}
        </Button>
      </div>

      {composing && (
        <div className="mb-8">
          <PostJob
            onPosted={() => {
              setComposing(false)
              void load()
            }}
          />
        </div>
      )}

      {jobs === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[104px]" />
        </div>
      ) : jobs.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-7 py-14 text-center">
          <Briefcase size={20} className="text-muted-foreground" />
          <p className="text-sm font-medium">No open jobs yet</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">
            Post one and it appears here for freelancers to apply to.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((job) => (
            <Link key={job.jobId} href={`/jobs/${job.jobId}`} className="group">
              <Card className="px-5 py-4 transition group-hover:border-foreground/25">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{job.title}</p>
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                      {job.description}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                      <span>{getChain(job.chainKey)?.shortName ?? job.chainKey}</span>
                      {job.deadline && (
                        <>
                          <span aria-hidden>·</span>
                          <span>Due {formatTimestamp(job.deadline)}</span>
                        </>
                      )}
                      {typeof job.applicationCount === 'number' && (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            {job.applicationCount} applicant{job.applicationCount === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <p className="vt-numeric shrink-0 text-sm font-semibold">
                    {formatAmount(job.budgetAmount, job.token.decimals)} {job.token.symbol}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  )
}

/* -------------------------------------------------------------- post job */

function PostJob({ onPosted }: { onPosted: () => void }) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()

  /*
    The budget has to be denominated in the network the client actually holds money on, so the
    network is picked rather than assumed. The default is a network with escrow where one exists,
    because a held budget is the better deal for both sides; where none does, any network that can
    move the token will do, since posting itself moves nothing.
  */
  const networks = paymentChains()
  const [chainKey, setChainKey] = useState<string | null>(
    () => (defaultChain() ?? defaultPaymentChain())?.key ?? null,
  )
  const chain = chainKey ? getChain(chainKey) : null

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [budget, setBudget] = useState('')
  const [protectionPeriod, setProtectionPeriod] = useState(24 * 3600)
  const [deadlineDays, setDeadlineDays] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decimals = chain?.token?.decimals ?? 6
  const amount = parseAmount(budget, decimals)

  async function submit() {
    if (!address || !amount || !chain) return
    setBusy(true)
    setError(null)
    try {
      const jobId = generateJobId()
      const issuedAt = nowSeconds()
      const signature = await signMessageAsync({
        message: jobCreationMessage({
          jobId,
          title: title.trim(),
          budgetAmount: amount.toString(),
          chainKey: chain.key,
          client: address,
          issuedAt,
        }),
      })

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId,
          title: title.trim(),
          description: description.trim(),
          budgetAmount: amount.toString(),
          chainKey: chain.key,
          deadline: deadlineDays ? nowSeconds() + Number(deadlineDays) * 86400 : null,
          protectionPeriod,
          clientAddress: address,
          issuedAt,
          signature,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not post the job.')
      }
      onPosted()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!chain) {
    return (
      <Notice tone="warn">
        This deployment has no network with a token, so a budget cannot be denominated yet.
      </Notice>
    )
  }

  return (
    <Card className="p-7">
      <Eyebrow>New job</Eyebrow>
      <h2 className="vt-display mt-2 text-xl">Post work with a budget</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Posting is a signature, not a payment. You fund the budget once you accept an applicant —
        into escrow where the network has one, and by direct payment where it does not.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {networks.length > 1 && (
          <Field label="Network" hint="Where the budget will be paid. Pick the one you hold funds on.">
            <ChainSelector value={chainKey} onChange={setChainKey} capability="transfer" />
          </Field>
        )}
        {!chain.capabilities.escrow && (
          <Notice tone="warn">
            {chain.name} has no escrow contract in this deployment, so a budget posted here is paid
            directly to whoever you hire rather than being held. The payment is still verified
            against the network before Vaulted calls it paid, but there is nothing to claw back.
          </Notice>
        )}
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Build Landing Page" className={inputClass} disabled={busy} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={4} placeholder="What needs building, and what done looks like." className={inputClass} disabled={busy} />
        </Field>
        <Field label={`Budget (${chain.token?.symbol ?? 'token'})`} error={budget && !amount ? 'Enter an amount greater than zero.' : null}>
          <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="500.00" className={`${inputClass} vt-numeric`} disabled={busy} />
        </Field>
        {/*
          The protection window is a property of an escrow, so it is only asked for where one can
          exist. Offering it on a network with no contract would be asking for a setting that
          nothing would ever read.
        */}
        {chain.capabilities.escrow && (
          <Field label="Protection window" hint="Applied to the escrow once it is funded.">
            <div className="flex flex-wrap gap-2">
              {PROTECTION_PERIOD_PRESETS.map((preset) => (
                <button
                  key={preset.seconds}
                  type="button"
                  disabled={busy}
                  onClick={() => setProtectionPeriod(preset.seconds)}
                  className={`rounded-lg border px-3 py-2 text-[13px] transition disabled:opacity-50 ${
                    protectionPeriod === preset.seconds ? 'border-[var(--vt-accent)] bg-[var(--vt-accent-dim)] text-[var(--vt-accent)]' : 'border-border hover:bg-muted'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Deadline (days)" optional>
          <input value={deadlineDays} onChange={(e) => setDeadlineDays(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="No deadline" className={`${inputClass} vt-numeric`} disabled={busy} />
        </Field>
      </div>

      <Divider className="my-6" />
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}

      {!isConnected ? (
        <SignInButton size="lg" full label="Sign in to post a job" />
      ) : (
        <Button size="lg" full busy={busy} disabled={!title.trim() || !description.trim() || !amount} onClick={submit}>
          Post job on {chain.shortName}
        </Button>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------ job detail */

export function JobDetail({ jobId }: { jobId: string }) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [job, setJob] = useState<Job | null>(null)
  const [applications, setApplications] = useState<Application[]>([])
  const [payment, setPayment] = useState<JobPayment | null>(null)
  const [escrowCapable, setEscrowCapable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/jobs/${jobId}`)
    if (!response.ok) {
      setJob(null)
      setLoading(false)
      return
    }
    const body = await response.json()
    setJob(body.job)
    setApplications(body.applications ?? [])
    setPayment(body.payment ?? null)
    setEscrowCapable(Boolean(body.escrowCapable))
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  const isClient = Boolean(address && job && address.toLowerCase() === job.clientAddress.toLowerCase())
  const alreadyApplied = Boolean(address && applications.some((a) => a.applicantAddress.toLowerCase() === address.toLowerCase()))

  async function apply() {
    if (!address || !job) return
    setBusy(true)
    setError(null)
    try {
      const issuedAt = nowSeconds()
      const signature = await signMessageAsync({
        message: jobApplicationMessage({ jobId: job.jobId, applicant: address, issuedAt }),
      })
      const response = await fetch(`/api/jobs/${job.jobId}/applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicantAddress: address, message: message.trim(), issuedAt, signature }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not apply.')
      setMessage('')
      await load()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function accept(applicant: string) {
    if (!address || !job) return
    setBusy(true)
    setError(null)
    try {
      const issuedAt = nowSeconds()
      const signature = await signMessageAsync({
        message: jobAcceptMessage({ jobId: job.jobId, applicant, client: address, issuedAt }),
      })
      const response = await fetch(`/api/jobs/${job.jobId}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applicantAddress: applicant, clientAddress: address, issuedAt, signature }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not accept.')
      await load()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <Skeleton className="h-64 w-full" />
      </AppShell>
    )
  }

  if (!job) {
    return (
      <AppShell>
        <Notice tone="warn">No such job.</Notice>
      </AppShell>
    )
  }

  const chain = getChain(job.chainKey)

  return (
    <AppShell>
      <Link href="/jobs" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> All jobs
      </Link>

      <Card className="p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>Job</Eyebrow>
            <h1 className="vt-display mt-2 text-2xl">{job.title}</h1>
            <p className="vt-numeric mt-1 text-lg text-muted-foreground">
              {formatAmount(job.budgetAmount, job.token.decimals)} {job.token.symbol}
            </p>
          </div>
          <span className="vt-eyebrow rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{job.status}</span>
        </div>

        <p className="mt-5 whitespace-pre-wrap text-[14px] leading-relaxed">{job.description}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Fact label="Network" value={chain?.name ?? job.chainKey} />
          <Fact label="Client" value={<AddressChip address={job.clientAddress} chain={chain?.viemChain ?? null} />} />
          <Fact label="Deadline" value={job.deadline ? formatTimestamp(job.deadline) : 'None'} />
          <Fact label="Assigned to" value={job.assignedTo ? shortAddress(job.assignedTo, 6) : 'Nobody yet'} />
        </div>

        {/*
          Payment state is a chain fact. Until the escrow for this job exists, the page says the
          budget is not secured rather than implying it is.
        */}
        <div className="mt-5">
          {!escrowCapable ? (
            <JobDirectPayment job={job} payment={payment} isClient={isClient} />
          ) : job.status === 'ASSIGNED' &&
          !job.invoiceId &&
          address &&
          job.assignedTo?.toLowerCase() === address.toLowerCase() ? (
            <Notice tone="neutral" title="You were hired — secure the budget">
              Nothing is locked yet. Raising the escrow takes one signature and one transaction;
              the client then funds it before you start.{' '}
              <Link href={`/request?job=${job.jobId}`} className="underline">
                Secure the budget
              </Link>
            </Notice>
          ) : job.invoiceId ? (
            <Notice tone="good" icon={<ShieldCheck size={15} />}>
              An escrow exists for this job.{' '}
              <Link href={`/requests/${job.invoiceId}`} className="underline">
                Open it
              </Link>{' '}
              to see its live state.
              {isClient && (
                <>
                  {' '}
                  If it is still awaiting funding,{' '}
                  <Link href={`/pay/${job.invoiceId}`} className="underline">
                    fund the budget
                  </Link>{' '}
                  to lock it in.
                </>
              )}
            </Notice>
          ) : (
            <Notice tone="warn" icon={<Clock size={15} />}>
              No escrow has been created for this job yet, so the budget is not secured. The
              contract makes the person being paid the escrow's creator, so the freelancer raises it
              once hired and the client funds it.
            </Notice>
          )}
        </div>


        {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}

        {job.status === 'OPEN' && !isClient && (
          <div className="mt-6">
            <Divider className="mb-6" />
            <Eyebrow>Apply</Eyebrow>
            {alreadyApplied ? (
              <p className="mt-2 text-[13.5px] text-muted-foreground">You have already applied to this job.</p>
            ) : !isConnected ? (
              <div className="mt-3">
                <SignInButton full label="Sign in to apply" />
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={1500}
                  placeholder="Why you, and how you would approach it."
                  className={inputClass}
                  disabled={busy}
                />
                <Button full busy={busy} disabled={!message.trim()} onClick={apply}>
                  Submit application
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {isClient && (
        <Card className="mt-5 p-7">
          <Eyebrow>Applicants ({applications.length})</Eyebrow>
          {applications.length === 0 ? (
            <p className="mt-3 text-[13.5px] text-muted-foreground">Nobody has applied yet.</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {applications.map((application) => (
                <div key={application.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <AddressChip address={application.applicantAddress} chain={chain?.viemChain ?? null} size={5} />
                    <span className="vt-eyebrow text-muted-foreground">{application.status}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{application.message}</p>
                  {job.status === 'OPEN' && (
                    <Button
                      variant="secondary"
                      className="mt-3"
                      busy={busy}
                      onClick={() => accept(application.applicantAddress)}
                    >
                      {busy ? <Loader2 size={14} className="vt-spin" /> : null}
                      Accept applicant
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {job.status === 'ASSIGNED' && (
            <Notice tone="neutral" title="Next step">
              Accepting an applicant moves no funds. {shortAddress(job.assignedTo, 6)} raises the
              escrow — the contract only lets the person being paid create it — and you will be
              notified to fund it. Nothing is secured until you do.
            </Notice>
          )}
        </Card>
      )}
    </AppShell>
  )
}

/**
 * The budget on a network with no escrow contract.
 *
 * Nothing is held. The client pays the freelancer directly, the server verifies the transaction
 * against the network before it says a word about it being paid, and the money is the
 * freelancer's the moment it lands. Every string here says that rather than implying escrow.
 */
function JobDirectPayment({
  job,
  payment,
  isClient,
}: {
  job: Job
  payment: JobPayment | null
  isClient: boolean
}) {
  if (job.status !== 'ASSIGNED') {
    return (
      <Notice tone="neutral" icon={<Clock size={15} />}>
        {getChain(job.chainKey)?.name ?? job.chainKey} has no escrow contract in this deployment, so
        this budget is paid directly to whoever is hired rather than being held by a contract. It is
        raised as a payment request the moment you hire somebody.
      </Notice>
    )
  }

  if (!payment) {
    return (
      <Notice tone="warn" icon={<Clock size={15} />}>
        Somebody is hired, but no payment has been raised for the budget yet. Reload in a moment; if
        it does not appear, the freelancer may have no{' '}
        {getChain(job.chainKey)?.name ?? job.chainKey} wallet recorded yet.
      </Notice>
    )
  }

  if (payment.status === 'PAID') {
    return (
      <Notice tone="good" icon={<ShieldCheck size={15} />}>
        The budget was paid directly to the freelancer and the transaction was read back off the
        network.{' '}
        <Link href={`/pay/${payment.id}`} className="underline">
          See the receipt
        </Link>
      </Notice>
    )
  }

  if (payment.status === 'CANCELLED' || payment.status === 'EXPIRED') {
    return (
      <Notice tone="warn" icon={<Clock size={15} />}>
        The payment raised for this budget is {payment.status.toLowerCase()}, so the budget is
        unpaid.
      </Notice>
    )
  }

  return (
    <Notice
      tone="neutral"
      title={isClient ? 'Pay the budget' : 'Waiting on the client to pay'}
      icon={<Clock size={15} />}
    >
      This network has no escrow contract, so nothing is held: the budget is paid straight to the
      freelancer and is theirs as soon as it arrives.{' '}
      <Link href={`/pay/${payment.id}`} className="underline">
        {isClient ? `Pay ${formatAmount(payment.amount, job.token.decimals)} ${payment.currency}` : 'Open the payment'}
      </Link>
    </Notice>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-muted px-4 py-3">
      <p className="vt-eyebrow text-muted-foreground">{label}</p>
      <p className="mt-1 text-[13.5px] font-medium">{value}</p>
    </div>
  )
}
