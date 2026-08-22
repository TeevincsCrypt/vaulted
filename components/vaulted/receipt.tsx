'use client'

import Link from 'next/link'
import { ArrowUpRight, Check, Clock, ExternalLink, ShieldCheck } from 'lucide-react'
import { useEscrow, useVaultedConfig } from '@/lib/vaulted/client'
import { formatAmount, formatTimestamp, shortAddress } from '@/lib/vaulted/format'
import { EscrowState } from '@/lib/vaulted/status'
import type { SerialisedInvoice } from '@/lib/vaulted/types'
import { VaultedWordmark } from './marketing/logo'
import { Card, CopyButton, Notice, Skeleton, TxHashLink } from './primitives'

/**
 * A shareable proof of payment.
 *
 * The receipt only renders as complete when the chain says the escrow is settled — it is generated
 * from on-chain state, not from a database row that claims success. An escrow that is still open,
 * or that could not be read, says so instead of printing a receipt for a payment that has not
 * happened.
 */
export function Receipt({
  invoice,
  handles,
}: {
  invoice: SerialisedInvoice
  handles: { payer: string | null; payee: string | null }
}) {
  const config = useVaultedConfig()
  const { escrow, read, isLoading, readError } = useEscrow(invoice.escrowId, 15000)

  const settled =
    escrow &&
    [EscrowState.Released, EscrowState.Resolved, EscrowState.Refunded].includes(escrow.state)

  const outcome =
    escrow?.state === EscrowState.Released
      ? { label: 'Completed', tone: 'good' as const, detail: 'Released to the freelancer.' }
      : escrow?.state === EscrowState.Resolved
        ? { label: 'Resolved', tone: 'neutral' as const, detail: 'Split by the arbiter after a dispute.' }
        : escrow?.state === EscrowState.Refunded
          ? { label: 'Refunded', tone: 'neutral' as const, detail: 'Returned to the client.' }
          : null

  return (
    <div className="vt-canvas min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[520px] flex-col justify-center px-5 py-12">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="transition-opacity hover:opacity-70">
            <VaultedWordmark size={26} />
          </Link>
          <span className="vt-eyebrow text-muted-foreground">Receipt</span>
        </div>

        <Card className="overflow-hidden">
          <div className="px-7 pt-7">
            <p className="vt-eyebrow text-muted-foreground">Vaulted receipt</p>
            <h1 className="vt-display mt-3 text-[22px] leading-tight">{invoice.description}</h1>

            <p className="vt-numeric vt-display mt-5 text-[38px] leading-none">
              {formatAmount(invoice.amount, invoice.token.decimals)}
              <span className="ml-2 align-middle text-lg font-medium text-muted-foreground">
                {invoice.token.symbol}
              </span>
            </p>
          </div>

          <div className="px-7 py-5">
            {isLoading && !read ? (
              <Skeleton className="h-14 w-full" />
            ) : readError && !read ? (
              <Notice tone="danger" title="Cannot reach the chain">
                This receipt is generated from on-chain state, and the chain could not be read. It is
                deliberately not shown as complete until it can be.
              </Notice>
            ) : !escrow ? (
              <Notice tone="warn" icon={<Clock size={15} />}>
                No escrow exists on chain for this payment request yet.
              </Notice>
            ) : !settled ? (
              <Notice tone="warn" icon={<Clock size={15} />}>
                This payment has not settled yet, so there is nothing to receipt. The page updates
                itself once the escrow closes.
              </Notice>
            ) : (
              <div
                className="flex items-center gap-3 rounded-xl px-4 py-3.5"
                style={{
                  background: outcome?.tone === 'good' ? 'var(--vt-positive-soft)' : 'var(--muted)',
                  color: outcome?.tone === 'good' ? 'var(--vt-positive)' : 'var(--foreground)',
                }}
              >
                <Check size={17} />
                <div>
                  <p className="vt-eyebrow">{outcome?.label}</p>
                  <p className="mt-0.5 text-[12.5px] opacity-90">{outcome?.detail}</p>
                </div>
              </div>
            )}
          </div>

          <dl className="divide-y divide-border border-t border-border px-7">
            <Line label="Client">
              {handles.payer ? `@${handles.payer}` : shortAddress(escrow?.payer ?? invoice.payer, 6)}
            </Line>
            <Line label="Freelancer">
              {handles.payee ? `@${handles.payee}` : shortAddress(invoice.payee, 6)}
            </Line>
            <Line label="Amount">
              {formatAmount(invoice.amount, invoice.token.decimals)} {invoice.token.symbol}
            </Line>
            <Line label="Network">{config?.chain.name ?? `Chain ${invoice.chainId}`}</Line>
            {escrow?.fundedAt ? <Line label="Funded">{formatTimestamp(escrow.fundedAt)}</Line> : null}
            {invoice.transactions.settle && (
              <Line label="Transaction">
                <TxHashLink hash={invoice.transactions.settle} chain={config?.chain ?? null} />
              </Line>
            )}
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/50 px-7 py-4">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <ShieldCheck size={13} style={{ color: 'var(--vt-positive)' }} />
              Verified against the escrow contract
            </span>
            <div className="flex items-center gap-1">
              <ShareLink invoiceId={invoice.invoiceId} />
              {invoice.transactions.settle && config?.chain.blockExplorers?.default?.url && (
                <a
                  href={`${config.chain.blockExplorers.default.url}/tx/${invoice.transactions.settle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ExternalLink size={13} /> Explorer
                </a>
              )}
            </div>
          </div>
        </Card>

        <Link
          href={`/requests/${invoice.invoiceId}`}
          className="mt-5 inline-flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          View the full escrow <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-[13px] font-medium">{children}</dd>
    </div>
  )
}

function ShareLink({ invoiceId }: { invoiceId: string }) {
  const url = typeof window !== 'undefined' ? `${window.location.origin}/receipt/${invoiceId}` : ''
  return url ? <CopyButton value={url} label="Copy link" /> : null
}
