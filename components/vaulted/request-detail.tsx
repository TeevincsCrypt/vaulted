'use client'

import Link from 'next/link'
import { ArrowLeft, Clock, Link2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import type { VaultedConfig } from '@/lib/vaulted/config'
import { ZERO_ADDRESS } from '@/lib/vaulted/config'
import { useChainCountdown, useEscrow, useTransaction } from '@/lib/vaulted/client'
import { detailsHash as computeDetailsHash, termsOf } from '@/lib/vaulted/invoice'
import { VAULTED_ESCROW_ABI } from '@/lib/vaulted/generated/abi'
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
  StateTrack,
  StatusPill,
  TxHashLink,
} from './primitives'
import { EscrowActions } from './escrow-actions'
import { TransactionStatus } from './transaction-status'
import { NetworkGuard } from './wallet'

/**
 * The freelancer's view of one escrow. Everything shown as status comes from a live contract read;
 * the stored row only supplies the description and the transaction hashes to link to.
 */
export function RequestDetail({ invoice, config }: { invoice: SerialisedInvoice; config: VaultedConfig }) {
  const { escrow, read, isLoading, refetch, readError, dataUpdatedAt } = useEscrow(invoice.escrowId)
  const secondsLeft = useChainCountdown(escrow?.secondsUntilExpiry ?? null, dataUpdatedAt)
  const [shareUrl, setShareUrl] = useState('')
  const { address } = useAccount()
  const tx = useTransaction()
  const isPayee = address?.toLowerCase() === invoice.payee.toLowerCase()

  /**
   * Recreates the escrow this request already committed to. Every argument is stored on the row
   * from when the link was published, so this reruns the exact same call — the one that failed or
   * was rejected the first time — rather than asking for a new signature.
   */
  async function retryCreateEscrow() {
    const hash = await tx.send({
      address: invoice.escrowAddress,
      abi: VAULTED_ESCROW_ABI,
      functionName: 'createEscrow',
      args: [
        (invoice.payer ?? ZERO_ADDRESS) as `0x${string}`,
        invoice.asset,
        BigInt(invoice.amount),
        invoice.protectionPeriod,
        invoice.fundingDeadline,
        invoice.detailsHash,
        invoice.salt,
      ],
      chainId: invoice.chainId,
    })
    if (!hash) return
    await fetch(`/api/invoices/${invoice.invoiceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'createTxHash', hash }),
    })
    void refetch()
  }

  useEffect(() => {
    setShareUrl(`${window.location.origin}/pay/${invoice.invoiceId}`)
  }, [invoice.invoiceId])

  const expectedDetailsHash = computeDetailsHash(termsOf(invoice))
  const termsMatch = escrow ? escrow.detailsHash.toLowerCase() === expectedDetailsHash.toLowerCase() : null

  /*
    The escrow's position along its own lifecycle, derived from the live contract state — never from
    the cached row, which is only ever advisory.

    "Protected" and "Settled" are one step apart on purpose: a funded escrow inside its window and a
    funded escrow past it are the same contract state but completely different situations for the
    person reading this, and the track is the only thing on the page that distinguishes them.

    An escrow that ended somewhere other than release keeps its position and relabels the last step,
    so a refund does not quietly render as though it had paid out.
  */
  const state = escrow?.state ?? EscrowState.None
  const trackPosition =
    state === EscrowState.None
      ? -1
      : state === EscrowState.Created
        ? 0
        : state === EscrowState.Funded || state === EscrowState.Disputed
          ? escrow?.isExpired
            ? 2
            : 1
          : 3
  const terminalStep =
    state === EscrowState.Refunded
      ? ({ label: 'Refunded', tone: 'warn' } as const)
      : state === EscrowState.Cancelled
        ? ({ label: 'Cancelled', tone: 'warn' } as const)
        : state === EscrowState.Resolved
          ? ({ label: 'Resolved', tone: 'warn' } as const)
          : state === EscrowState.Disputed
            ? ({ label: 'Disputed', tone: 'danger' } as const)
            : null

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft size={14} /> All payment requests
      </Link>

      {/*
        The escrow as a financial instrument: what it is for, then the amount at the size the amount
        deserves, then where it is in its life. Somebody arriving here wants those three facts in
        that order, and everything else is reference.
      */}
      <Card className="relative overflow-hidden p-7 sm:p-9">
        <div className="vt-grid-fine pointer-events-none absolute inset-0 opacity-30" aria-hidden />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <Eyebrow>Payment request</Eyebrow>
              <h1 className="mt-4 text-[19px] font-medium leading-snug">{invoice.description}</h1>
            </div>
            <div className="flex items-center gap-2">
              {escrow && <StatusPill status={escrow.status} />}
              <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => void refetch()}>
                <RefreshCw size={13} />
              </Button>
            </div>
          </div>

          <p className="vt-numeric vt-editorial mt-6 text-[clamp(2.6rem,7vw,4.2rem)] leading-none">
            {formatAmount(invoice.amount, invoice.token.decimals)}
            <span className="ml-3 text-[0.3em] uppercase tracking-[0.12em] text-muted-foreground">
              {invoice.token.symbol}
            </span>
          </p>

          {/* Where this escrow is out of where it can go, read from the live chain state. */}
          <div className="mt-8">
            <StateTrack
              steps={['Created', 'Funded', 'Protected', 'Settled']}
              current={trackPosition}
              terminal={terminalStep}
            />
          </div>
        </div>
      </Card>

      <Card className="p-7">
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-3.5 py-2.5">
          <Link2 size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{shareUrl || '…'}</span>
          {shareUrl && <CopyButton value={shareUrl} label="Copy" />}
        </div>

        <div className="mt-6">
          {isLoading && !read ? (
            <Skeleton className="h-16 w-full" />
          ) : readError && !read ? (
            <Notice tone="danger" title="Cannot reach the chain">
              The escrow could not be read on {config.chain.name}. The state below is unavailable
              rather than stale.
            </Notice>
          ) : !escrow ? (
            <div className="flex flex-col gap-3">
              <Notice tone="warn" icon={<Clock size={15} />}>
                This request has no escrow on chain yet.{' '}
                {isPayee
                  ? 'Your creation transaction likely failed or was rejected — create it now to make the link work.'
                  : 'If the creation transaction failed, the link will not work until the freelancer creates it.'}
              </Notice>
              {isPayee && (
                <NetworkGuard>
                  <Button
                    busy={tx.phase === 'signing' || tx.phase === 'pending'}
                    onClick={() => void retryCreateEscrow()}
                  >
                    Create escrow on chain
                  </Button>
                </NetworkGuard>
              )}
              <TransactionStatus
                phase={tx.phase}
                hash={tx.hash}
                error={tx.error}
                chain={config.chain}
                confirmedLabel="Escrow created on chain"
              />
            </div>
          ) : termsMatch === false ? (
            <Notice tone="danger" title="Terms mismatch">
              The escrow on chain commits to different terms than this record. Do not share this link.
            </Notice>
          ) : escrow.state === EscrowState.Funded && !escrow.isExpired ? (
            <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-4">
              <div>
                <p className="vt-eyebrow text-muted-foreground">Settles to you in</p>
                <p className="vt-numeric vt-editorial mt-1.5 text-[26px]">{formatCountdown(secondsLeft)}</p>
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
