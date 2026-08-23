'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowUpRight, Clock, ShieldCheck, Users } from 'lucide-react'
import { useVaultedConfig } from '@/lib/vaulted/client'
import { formatDuration } from '@/lib/vaulted/format'
import { CreateRequest } from './create-request'
import { Card, Eyebrow } from './primitives'
import { AppShell, EscrowUnavailable } from './shell'
import { getVaultedConfig, isConfigured } from '@/lib/vaulted/config'
import { useSession } from './session-provider'

/**
 * The original purpose of the protocol, on its own page: ask to be paid, and have the money secured
 * before the work starts.
 */
export function RequestPaymentPage({ jobId }: { jobId?: string }) {
  const config = useVaultedConfig()
  const { account } = useSession()
  const [job, setJob] = useState<{ jobId: string; amount: string; description: string; client: string } | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)

  // When raising the escrow for a job, the terms come from the job itself rather than the form.
  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    void (async () => {
      const response = await fetch(`/api/jobs/${jobId}`)
      if (!response.ok) {
        if (!cancelled) setJobError('That job could not be loaded.')
        return
      }
      const body = await response.json()
      if (cancelled) return
      if (body.job.status !== 'ASSIGNED') {
        setJobError('That job has not been assigned, so there is nothing to secure yet.')
        return
      }
      setJob({
        jobId: body.job.jobId,
        amount: body.job.budgetAmount,
        description: body.job.title,
        client: body.job.clientAddress,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (!config) {
    const resolved = getVaultedConfig()
    return (
      <AppShell>
        <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Request a payment</h1>
        <div className="mt-8">
          <EscrowUnavailable
            what="An escrowed request"
            message={isConfigured(resolved) ? '' : resolved.message}
          />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="vt-display text-3xl leading-tight sm:text-4xl">
          {jobId ? 'Secure the job budget' : 'Request a payment'}
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Create a link, send it to your client. They fund an escrow contract instead of paying your
          wallet directly, and it settles to you when the protection window closes.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {jobId && !job ? (
          <Card className="p-7">
            <p className="text-[13.5px] text-muted-foreground">
              {jobError ?? 'Loading the job…'}
            </p>
          </Card>
        ) : (
          <CreateRequest config={config} prefill={job ?? undefined} />
        )}

        <div className="flex flex-col gap-4">
          <Card className="p-6">
            <Eyebrow>What your client sees</Eyebrow>
            <ol className="mt-4 flex flex-col gap-3">
              {[
                { icon: Users, text: 'Your handle, the amount, and what the work is.' },
                { icon: ShieldCheck, text: 'A terms hash they can check against the contract before paying.' },
                { icon: Clock, text: `${formatDuration(config.defaultProtectionPeriod)} to release early or dispute.` },
              ].map((row, index) => (
                <li key={index} className="flex gap-3">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'var(--vt-accent-dim)', color: 'var(--vt-accent)' }}
                  >
                    <row.icon size={14} />
                  </span>
                  <span className="text-[13.5px] leading-relaxed text-muted-foreground">{row.text}</span>
                </li>
              ))}
            </ol>
          </Card>

          {account && !account.primaryAddress && (
            <Card className="p-6">
              <Eyebrow>Before you share a link</Eyebrow>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                No wallet is recorded for @{account.name} yet. Payments still work — the escrow pays
                whichever wallet creates it — but nobody can address a request to your handle until
                one is. It is assigned when you sign in; if it is missing, sign out and back in.
              </p>
              <Link
                href="/settings"
                className="mt-3 inline-flex items-center gap-1.5 text-[13px]"
                style={{ color: 'var(--vt-accent)' }}
              >
                Check your wallet <ArrowUpRight size={14} />
              </Link>
            </Card>
          )}

          <Card className="p-6">
            <Eyebrow>Cancelling</Eyebrow>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              Once created, a request lives on chain. Withdrawing it is a real transaction that costs
              gas — it moves no money, because nothing is locked until your client funds it.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
