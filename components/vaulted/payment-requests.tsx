'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Ban, Check, ExternalLink, Link2, Plus, RefreshCw } from 'lucide-react'
import { readableError } from '@/lib/vaulted/client'
import { formatAmount, formatTimestamp, parseAmount, shortAddress } from '@/lib/vaulted/format'
import { shortSolanaAddress } from '@/lib/vaulted/solana'
import {
  Button,
  Card,
  CopyButton,
  Divider,
  Eyebrow,
  Field,
  Notice,
  Skeleton,
  inputClass,
} from './primitives'
import { AppShell } from './shell'
import { SignInButton } from './wallet'

/**
 * Payment requests — "pay me $250", settled by transfer rather than escrow.
 *
 * Separate from the escrow flow on purpose, and that separation is what makes this work today:
 * a transfer needs a token and a network, not a deployed contract, so Base and Solana both settle
 * here while escrow waits on a deployment.
 *
 * Nothing on this page marks anything paid. Status comes from the server, which only moves a
 * request to PAID after reading the transaction back off the network.
 */

type PaymentRequest = {
  id: string
  amount: string
  currency: string
  decimals: number
  network: string
  networkName: string
  networkFamily: 'evm' | 'svm'
  description: string
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED'
  recipientAddress: string
  txHash: string | null
  paidAmount: string | null
  paidAt: string | null
  expiresAt: string | null
  createdAt: string
  explorerUrl: string | null
}

type Network = {
  key: string
  name: string
  shortName: string
  family: 'evm' | 'svm'
  symbol: string
  decimals: number
}

const STATUS_TONE: Record<PaymentRequest['status'], { label: string; bg: string; fg: string }> = {
  PENDING: { label: 'Awaiting payment', bg: 'var(--vt-accent-dim)', fg: 'var(--vt-accent)' },
  PAID: { label: 'Paid', bg: 'var(--vt-positive-soft)', fg: 'var(--vt-positive)' },
  EXPIRED: { label: 'Expired', bg: 'var(--muted)', fg: 'var(--muted-foreground)' },
  CANCELLED: { label: 'Cancelled', bg: 'var(--muted)', fg: 'var(--muted-foreground)' },
}

export function StatusChip({ status }: { status: PaymentRequest['status'] }) {
  const tone = STATUS_TONE[status]
  return (
    <span
      className="vt-eyebrow inline-flex items-center gap-1 rounded-full px-2.5 py-1"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {tone.label}
    </span>
  )
}

export function shortForFamily(address: string, family: 'evm' | 'svm'): string {
  return family === 'svm' ? shortSolanaAddress(address, 6) : shortAddress(address, 6)
}

export function PaymentRequests() {
  const [requests, setRequests] = useState<PaymentRequest[] | null>(null)
  const [networks, setNetworks] = useState<Network[]>([])
  const [error, setError] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/payment-requests', { cache: 'no-store' })
      if (response.status === 401) {
        setSignedOut(true)
        setRequests([])
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not load your payment requests.')
      setRequests(body.requests ?? [])
      setNetworks(body.networks ?? [])
    } catch (cause) {
      setRequests([])
      setError(readableError(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (signedOut) {
    return (
      <AppShell>
        <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Payment requests</h1>
        <div className="mt-8 max-w-sm">
          <SignInButton size="lg" full label="Sign in to request a payment" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Payment requests</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Ask to be paid, share the link, and the money arrives in your wallet directly. No escrow
            and no contract — which is why these settle on Base and Solana today.
          </p>
        </div>
        <Button variant="secondary" busy={refreshing} onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mt-6">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <CreateForm networks={networks} onCreated={load} />

        <div className="flex flex-col gap-4">
          <Eyebrow>Your requests</Eyebrow>
          {requests === null ? (
            <>
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </>
          ) : requests.length === 0 ? (
            <Card className="p-8 text-center">
              <Link2 size={20} className="mx-auto text-muted-foreground" />
              <p className="mt-3 text-[14px] font-medium">No payment requests yet</p>
              <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                Raise one and you get a link to send. Anyone can open it and pay, with or without a
                Vaulted account.
              </p>
            </Card>
          ) : (
            requests.map((request) => (
              <RequestRow key={request.id} request={request} onChanged={load} />
            ))
          )}
        </div>
      </div>
    </AppShell>
  )
}

function CreateForm({ networks, onCreated }: { networks: Network[]; onCreated: () => Promise<void> }) {
  const [network, setNetwork] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<PaymentRequest | null>(null)

  // Default to the first network the deployment offers rather than assuming one exists.
  useEffect(() => {
    if (!network && networks.length > 0) setNetwork(networks[0].key)
  }, [networks, network])

  const selected = networks.find((entry) => entry.key === network) ?? null
  const parsed = selected && amount.trim() ? parseAmount(amount, selected.decimals) : null
  const ready = Boolean(selected && parsed && parsed > 0n && description.trim())

  async function submit() {
    if (!selected || !parsed) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/payment-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          network: selected.key,
          amount: parsed.toString(),
          description: description.trim(),
          expiresInHours: expiry ? Number(expiry) : null,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not create that payment request.')
      setCreated(body.request)
      setAmount('')
      setDescription('')
      await onCreated()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  if (networks.length === 0) {
    return (
      <Card className="p-7">
        <Eyebrow>New request</Eyebrow>
        <div className="mt-4">
          <Notice tone="warn">
            No network in this deployment has a token configured, so there is nothing to be paid in.
          </Notice>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-7">
      <Eyebrow>New request</Eyebrow>
      <h2 className="vt-display mt-2 text-lg">Ask to be paid</h2>

      <Divider className="my-5" />

      <div className="flex flex-col gap-4">
        <Field label="Network" hint="Where the money settles. The link tells the payer.">
          <div className="grid grid-cols-2 gap-2">
            {networks.map((entry) => {
              const active = entry.key === network
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setNetwork(entry.key)}
                  className="rounded-xl border px-4 py-3 text-left transition"
                  style={{
                    borderColor: active ? 'var(--vt-accent)' : 'var(--border)',
                    background: active ? 'var(--vt-accent-dim)' : 'transparent',
                  }}
                >
                  <span className="block text-[13.5px] font-medium">{entry.shortName}</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{entry.symbol}</span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field label={`Amount${selected ? ` (${selected.symbol})` : ''}`}>
          <input
            className={inputClass}
            placeholder="250.00"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>

        <Field label="What is it for" hint="Shown to whoever opens the link.">
          <input
            className={inputClass}
            placeholder="Brand identity refresh"
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <Field label="Expires after" hint="Optional. Leave blank and it stays open.">
          <select className={inputClass} value={expiry} onChange={(event) => setExpiry(event.target.value)}>
            <option value="">Never</option>
            <option value="24">24 hours</option>
            <option value="72">3 days</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </Field>
      </div>

      {amount.trim() && parsed === null && (
        <div className="mt-4">
          <Notice tone="danger">That is not an amount.</Notice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {created && (
        <div className="mt-4">
          <Notice tone="good" icon={<Check size={15} />} title="Request created">
            Share this link — anyone can open it and pay, account or not.
            <span className="mt-2 block break-all font-mono text-[11.5px]">{linkFor(created.id)}</span>
            <span className="mt-2 block">
              <CopyButton value={linkFor(created.id)} label="Copy payment link" />
            </span>
          </Notice>
        </div>
      )}

      <div className="mt-5">
        <Button size="lg" full busy={busy} disabled={!ready} onClick={submit}>
          <Plus size={16} />
          Create payment request
        </Button>
      </div>
    </Card>
  )
}

function linkFor(id: string): string {
  if (typeof window === 'undefined') return `/pay/${id}`
  return `${window.location.origin}/pay/${id}`
}

function RequestRow({ request, onChanged }: { request: PaymentRequest; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/payment-requests/${request.id}/cancel`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not cancel that request.')
      await onChanged()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[20px] font-semibold tracking-tight">
            {formatAmount(request.amount, request.decimals)} {request.currency}
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{request.description}</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {request.networkName} · to {shortForFamily(request.recipientAddress, request.networkFamily)}
          </p>
        </div>
        <StatusChip status={request.status} />
      </div>

      {request.status === 'PAID' && (
        <div className="mt-4 rounded-xl border border-border px-4 py-3">
          <p className="text-[12.5px] text-muted-foreground">
            Paid {request.paidAt ? formatTimestamp(Math.floor(new Date(request.paidAt).getTime() / 1000)) : ''}
            {request.paidAmount && request.paidAmount !== request.amount && (
              <> · {formatAmount(request.paidAmount, request.decimals)} {request.currency} received</>
            )}
          </p>
          {request.explorerUrl && (
            <a
              href={request.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px]"
              style={{ color: 'var(--vt-accent)' }}
            >
              View the transaction <ExternalLink size={12} />
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <CopyButton value={linkFor(request.id)} label="Copy link" />
        <Link
          href={`/pay/${request.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          Open <ExternalLink size={12} />
        </Link>
        {request.status === 'PENDING' && (
          <Button variant="ghost" busy={busy} onClick={cancel}>
            <Ban size={14} /> Cancel
          </Button>
        )}
      </div>
    </Card>
  )
}
