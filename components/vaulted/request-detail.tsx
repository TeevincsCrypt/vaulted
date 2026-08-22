'use client'

import Link from 'next/link'
import { ArrowLeft, Clock, Link2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { VaultedConfig } from '@/lib/vaulted/config'
import { ZERO_ADDRESS } from '@/lib/vaulted/config'
import { useChainCountdown, useEscrow } from '@/lib/vaulted/client'
import { detailsHash as computeDetailsHash } from '@/lib/vaulted/invoice'
import {
  formatAmount,
  formatCountdown,
  formatDuration,
  formatTimestamp,
} from '@/lib/vaulted/format'
import { EscrowState, STATUS_COPY } from '@/lib/vaulted/status'
import type { SerialisedInvoice } from '@/lib/vaulted/types'
import {
  AddressChip,
  Button,
  Card,
  CopyButton,
  DetailRow,
  Divider,
  Eyebrow,
  Notice,
  Skeleton,
  StatusPill,
  TxHashLink,
} from './primitives'
import { EscrowActions } from './escrow-actions'

/**
 * The freelancer's view of one escrow. Everything shown as status comes from a live contract read;
 * the stored row only supplies the description and the transaction hashes to link to.
 */
export function RequestDetail({ invoice, config }: { invoice: SerialisedInvoice; config: VaultedConfig }) {
  const { escrow, read, isLoading, refetch, readError, dataUpdatedAt } = useEscrow(invoice.escrowId)
  const secondsLeft = useChainCountdown(escrow?.secondsUntilExpiry ?? null, dataUpdatedAt)
  const [shareUrl, setShareUrl] = useState('')

  useEffect(() => {
    setShareUrl(`${window.location.origin}/pay/${invoice.invoiceId}`)
  }, [invoice.invoiceId])

  const expectedDetailsHash = computeDetailsHash({
    invoiceId: invoice.invoiceId,
    chainId: invoice.chainId,
    escrowAddress: invoice.escrowAddress,
    tokenAddress: invoice.token.address,
    payee: invoice.payee,
    payer: (invoice.payer ?? ZERO_ADDRESS) as `0x${string}`,
    amount: invoice.amount,
    description: invoice.description,
    protectionPeriod: invoice.protectionPeriod,
    fundingDeadline: invoice.fundingDeadline,
  })
  const termsMatch = escrow ? escrow.detailsHash.toLowerCase() === expectedDetailsHash.toLowerCase() : null

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft size={14} /> All payment requests
      </Link>

      <Card className="p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>Payment request</Eyebrow>
            <h1 className="vt-display mt-2 text-2xl">{invoice.description}</h1>
            <p className="vt-numeric mt-1 text-lg text-muted-foreground">
              {formatAmount(invoice.amount, invoice.token.decimals)} {invoice.token.symbol}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {escrow && <StatusPill status={escrow.status} />}
            <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => void refetch()}>
              <RefreshCw size={13} />
            </Button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-muted px-3.5 py-2.5">
          <Link2 size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{shareUrl || '…'}</span>
          {shareUrl && <CopyButton value={shareUrl} label="Copy" />}
        </div>

        <div className="mt-5">
          {isLoading && !read ? (
            <Skeleton className="h-16 w-full" />
          ) : readError && !read ? (
            <Notice tone="danger" title="Cannot reach the chain">
              The escrow could not be read on {config.chain.name}. The state below is unavailable
              rather than stale.
            </Notice>
          ) : !escrow ? (
            <Notice tone="warn" icon={<Clock size={15} />}>
              This request has no escrow on chain. If your creation transaction failed, the link will
              not work until you create it.
            </Notice>
          ) : termsMatch === false ? (
            <Notice tone="danger" title="Terms mismatch">
              The escrow on chain commits to different terms than this record. Do not share this link.
            </Notice>
          ) : escrow.state === EscrowState.Funded && !escrow.isExpired ? (
            <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-4">
              <div>
                <p className="vt-eyebrow text-muted-foreground">Settles to you in</p>
                <p className="vt-numeric vt-display mt-1 text-2xl">{formatCountdown(secondsLeft)}</p>
              </div>
              <p className="max-w-[190px] text-right text-[12px] leading-relaxed text-muted-foreground">
                Unless the client releases early or opens a dispute.
              </p>
            </div>
          ) : (
            <Notice tone={escrow.isExpired ? 'warn' : 'neutral'}>{STATUS_COPY[escrow.status].detail}</Notice>
          )}
        </div>

        {escrow && termsMatch !== false && (
          <div className="mt-5">
            <EscrowActions
              escrowId={invoice.escrowId}
              escrow={escrow}
              config={config}
              onSettled={(hash) =>
                void fetch(`/api/invoices/${invoice.invoiceId}`, {
                  method: 'PATCH',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ field: 'settleTxHash', hash }),
                })
              }
            />
          </div>
        )}
      </Card>

      <Card className="px-7 py-3">
        <div className="divide-y divide-border">
          <DetailRow label="Client">
            {invoice.payer && invoice.payer !== ZERO_ADDRESS ? (
              <AddressChip address={invoice.payer} chain={config.chain} />
            ) : escrow && escrow.payer !== ZERO_ADDRESS ? (
              <AddressChip address={escrow.payer} chain={config.chain} />
            ) : (
              <span className="text-muted-foreground">Open link — first funder</span>
            )}
          </DetailRow>
          <DetailRow label="Protection window">{formatDuration(invoice.protectionPeriod)} after funding</DetailRow>
          <DetailRow label="Funded">{escrow?.fundedAt ? formatTimestamp(escrow.fundedAt) : '—'}</DetailRow>
          <DetailRow label="Expires">{escrow?.expiresAt ? formatTimestamp(escrow.expiresAt) : '—'}</DetailRow>
          <DetailRow label="Link deadline">
            {invoice.fundingDeadline ? formatTimestamp(invoice.fundingDeadline) : 'None'}
          </DetailRow>
          <DetailRow label="Escrow id" hint="Deterministic id of this escrow inside the contract">
            <span className="font-mono text-[11px]">{invoice.escrowId.slice(0, 18)}…</span>
          </DetailRow>
          <DetailRow label="Escrow contract">
            <AddressChip address={invoice.escrowAddress} chain={config.chain} />
          </DetailRow>
          <DetailRow label="Network">{config.chain.name}</DetailRow>
        </div>
      </Card>

      {(invoice.transactions.create || invoice.transactions.fund || invoice.transactions.settle) && (
        <Card className="p-7">
          <Eyebrow>Transactions</Eyebrow>
          <div className="mt-3 flex flex-col gap-2">
            {invoice.transactions.create && (
              <TxHashLink hash={invoice.transactions.create} chain={config.chain} label="Escrow created" />
            )}
            {invoice.transactions.fund && (
              <TxHashLink hash={invoice.transactions.fund} chain={config.chain} label="Funded" />
            )}
            {invoice.transactions.settle && (
              <TxHashLink hash={invoice.transactions.settle} chain={config.chain} label="Settled" />
            )}
          </div>
          <Divider className="my-4" />
          <p className="text-xs text-muted-foreground">
            These hashes are reported by the browser for convenience. The escrow state above is read
            from the contract and is what counts.
          </p>
        </Card>
      )}
    </div>
  )
}
