'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Clock, Lock, ShieldCheck } from 'lucide-react'
import { erc20Abi } from 'viem'
import { useAccount, useBalance } from 'wagmi'
import { VAULTED_ESCROW_ABI } from '@/lib/vaulted/generated/abi'
import type { VaultedConfig } from '@/lib/vaulted/config'
import { ZERO_ADDRESS } from '@/lib/vaulted/config'
import {
  useChainCountdown,
  useEscrow,
  useTokenAllowance,
  useTokenBalance,
  useTransaction,
} from '@/lib/vaulted/client'
import { detailsHash as computeDetailsHash, termsOf } from '@/lib/vaulted/invoice'
import {
  formatAmount,
  formatAmountExact,
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
  Divider,
  Eyebrow,
  Notice,
  Skeleton,
  StateTrack,
  StatusPill,
  TxHashLink,
} from './primitives'
import { EscrowActions } from './escrow-actions'
import { VaultedMark } from './shell'
import { TransactionStatus } from './transaction-status'
import { NetworkGuard, SignInButton } from './wallet'

/**
 * The client-facing payment page.
 *
 * Every figure and every state here comes from a live read of the escrow contract. The stored
 * invoice supplies the description and the link's metadata, and the page checks that metadata
 * against the terms hash committed on chain before inviting anybody to pay.
 */
export function PayExperience({ invoice, config }: { invoice: SerialisedInvoice; config: VaultedConfig }) {
  const { address, isConnected } = useAccount()
  const { escrow, read, isLoading, readError, dataUpdatedAt } = useEscrow(invoice.escrowId)
  const allowance = useTokenAllowance(address)
  const balance = useTokenBalance(address)
  const approveTx = useTransaction()
  const fundTx = useTransaction()
  const [reported, setReported] = useState<string | null>(null)

  const amount = BigInt(invoice.amount)
  const expectedDetailsHash = useMemo(
    () =>
      computeDetailsHash(termsOf(invoice)),
    [invoice],
  )

  /** Does the escrow on chain commit to the terms this page is showing? Null until we know. */
  const termsMatch = escrow ? escrow.detailsHash.toLowerCase() === expectedDetailsHash.toLowerCase() : null
  const amountMatch = escrow ? escrow.amount === amount : null
  const payeeMatch = escrow ? escrow.payee.toLowerCase() === invoice.payee.toLowerCase() : null
  const trustworthy = termsMatch !== false && amountMatch !== false && payeeMatch !== false

  const secondsLeft = useChainCountdown(escrow?.secondsUntilExpiry ?? null, dataUpdatedAt)
  /*
    A native escrow takes its amount as the call's value, so there is nothing to approve and no
    allowance to read — the two-step approve-then-fund only exists because ERC-20 needs it.
  */
  const native = invoice.asset === ZERO_ADDRESS
  const needsApproval = !native && (allowance.data ?? BigInt(0)) < amount
  const nativeBalance = useBalance({ address, chainId: config.chainId })
  const held = native ? nativeBalance.data?.value : (balance.data as bigint | undefined)
  const insufficientBalance = held !== undefined && held < amount
  const addressedTo = invoice.payer && invoice.payer !== ZERO_ADDRESS ? invoice.payer : null
  const wrongClient = Boolean(addressedTo && address && addressedTo.toLowerCase() !== address.toLowerCase())

  // Persist confirmed hashes so the record links to the real transactions.
  useEffect(() => {
    if (fundTx.phase === 'confirmed' && fundTx.hash && reported !== fundTx.hash) {
      setReported(fundTx.hash)
      void fetch(`/api/invoices/${invoice.invoiceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: 'fundTxHash', hash: fundTx.hash }),
      })
      void allowance.refetch()
    }
  }, [fundTx.phase, fundTx.hash, reported, invoice.invoiceId, allowance])

  function approve() {
    approveTx.send({
      address: config.token.address,
      abi: erc20Abi,
      functionName: 'approve',
      // Exactly what this escrow needs — no standing allowance left behind.
      args: [config.escrowAddress, amount],
      chainId: config.chainId,
    })
  }

  useEffect(() => {
    if (approveTx.phase === 'confirmed') void allowance.refetch()
  }, [approveTx.phase, allowance])

  function fund() {
    /*
      The amount travels with the call for a native escrow and must not for a token one — the
      contract rejects value it was not expecting rather than letting it strand. Two branches
      rather than a spread, because `value` is exactly what tells wagmi which of the two this is.
    */
    const request = {
      address: config.escrowAddress,
      abi: VAULTED_ESCROW_ABI,
      functionName: 'fund',
      args: [invoice.escrowId],
      chainId: config.chainId,
    } as const
    fundTx.send(native ? { ...request, value: amount } : request)
  }

  const state = escrow?.state ?? EscrowState.None
  const settled =
    state === EscrowState.Released ||
    state === EscrowState.Refunded ||
    state === EscrowState.Resolved ||
    state === EscrowState.Cancelled

  /*
    Where this escrow is along its life, derived the same way the freelancer's page derives it —
    from the live read, never from the row. A funded escrow inside its window and one past it are
    the same contract state but different situations, so they are different steps.
  */
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
    <div className="vt-canvas min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[460px] flex-col justify-center px-5 py-12">
        <div className="mb-6 flex items-center justify-between">
          <VaultedMark />
          {escrow && <StatusPill status={escrow.status} />}
        </div>

        <Card className="overflow-hidden">
          {/* ---------------- Header: who, how much, for what ---------------- */}
          <div className="px-7 pt-7">
            <Eyebrow>Payment request</Eyebrow>
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="flex size-6 items-center justify-center rounded-full bg-muted font-mono text-[10px]">
                {invoice.payee.slice(2, 4).toUpperCase()}
              </span>
              <AddressChip address={invoice.payee} chain={config.chain} size={5} />
            </div>

            <p className="vt-editorial vt-numeric mt-6 text-[clamp(2.6rem,7vw,3.4rem)] leading-none">
              {formatAmount(amount, invoice.token.decimals)}
              <span className="ml-2 align-middle text-xl font-medium text-muted-foreground">
                {invoice.token.symbol}
              </span>
            </p>

            <p className="mt-3 text-[15px] leading-snug">{invoice.description}</p>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Clock size={13} />
                {escrow?.fundedAt
                  ? `Due ${formatTimestamp(escrow.expiresAt)}`
                  : `Due ${formatDuration(invoice.protectionPeriod)} after funding`}
              </span>
              <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--vt-positive)' }}>
                <ShieldCheck size={13} />
                Escrow protected
              </span>
            </div>
          </div>

          {/*
            The same lifecycle track the freelancer sees on their own copy of this escrow. The payer
            is the one deciding whether to put money in, so the distance between "funded" and
            "settled" is if anything more their business than anybody's.
          */}
          <div className="mt-7 px-7">
            <StateTrack
              steps={['Created', 'Funded', 'Protected', 'Settled']}
              current={trackPosition}
              terminal={terminalStep}
            />
          </div>

          <div className="mt-6 px-7">
            <Divider />
          </div>

          {/* ---------------- Live escrow state ---------------- */}
          <div className="px-7 py-5">
            {isLoading && !read ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : readError && !read ? (
              <Notice tone="danger" title="Cannot reach the chain" icon={<AlertTriangle size={15} />}>
                The escrow could not be read on {config.chain.name}, so this page cannot tell you its
                real state. Nothing is shown as safe to pay until it can.
              </Notice>
            ) : !trustworthy ? (
              <Notice tone="danger" title="Do not pay this link" icon={<AlertTriangle size={15} />}>
                The escrow on chain does not match the terms shown here
                {amountMatch === false && escrow ? (
                  <> — it is for {formatAmountExact(escrow.amount, invoice.token.decimals)} {invoice.token.symbol}</>
                ) : payeeMatch === false ? (
                  <> — it pays a different wallet</>
                ) : null}
                . Ask whoever sent you this link for a new one.
              </Notice>
            ) : !escrow ? (
              <Notice tone="warn" icon={<Clock size={15} />}>
                This payment request has not been created on chain yet. There is nothing to fund
                until the freelancer submits it — the page updates by itself when they do.
              </Notice>
            ) : settled ? (
              <SettledPanel invoice={invoice} config={config} state={state} amount={amount} />
            ) : state === EscrowState.Created ? (
              <FundPanel
                {...{
                  config,
                  invoice,
                  amount,
                  isConnected,
                  wrongClient,
                  addressedTo,
                  needsApproval,
                  insufficientBalance,
                  balance: held,
                  approveTx,
                  fundTx,
                  approve,
                  fund,
                  fundingDeadline: escrow.fundingDeadline,
                }}
              />
            ) : (
              <LockedPanel
                invoice={invoice}
                config={config}
                escrow={escrow}
                secondsLeft={secondsLeft}
                amount={amount}
              />
            )}
          </div>

          {/* ---------------- Actions available to the connected wallet ---------------- */}
          {escrow && trustworthy && !settled && state !== EscrowState.Created && (
            <div className="px-7 pb-6">
              <EscrowActions
                escrowId={invoice.escrowId}
                escrow={escrow}
                config={config}
                compact
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

          {/* ---------------- Verifiable facts ---------------- */}
          <div className="border-t border-white/8 bg-black/25 px-7 py-5">
            <dl className="flex flex-col gap-1.5 text-[12px]">
              <Fact label="Network" value={config.chain.name} />
              <Fact
                label="Token"
                value={<AddressChip address={invoice.token.address} chain={config.chain} size={4} />}
              />
              <Fact
                label="Escrow contract"
                value={<AddressChip address={invoice.escrowAddress} chain={config.chain} size={4} />}
              />
              {/* Prefer the hash from this session: the server-rendered row predates a deposit
                  made on this page. */}
              {(fundTx.hash ?? invoice.transactions.fund) && (
                <Fact
                  label="Funding transaction"
                  value={<TxHashLink hash={(fundTx.hash ?? invoice.transactions.fund)!} chain={config.chain} />}
                />
              )}
              {escrow && (
                <Fact
                  label="Terms hash"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      {termsMatch ? (
                        <>
                          <Check size={12} style={{ color: 'var(--vt-positive)' }} />
                          <span>matches this page</span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--vt-danger)' }}>mismatch</span>
                      )}
                    </span>
                  }
                />
              )}
            </dl>
          </div>
        </Card>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          Funds are held by the escrow contract, never by Vaulted.
          {config.arbiter
            ? ' Disputed payments are decided by the arbiter configured for this deployment — a trusted third party.'
            : ' This deployment has no arbiter: a disputed payment can only end if one side concedes.'}
        </p>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  )
}

/** Approve, then deposit. Both are real transactions against real contracts. */
function FundPanel(props: {
  config: VaultedConfig
  invoice: SerialisedInvoice
  amount: bigint
  isConnected: boolean
  wrongClient: boolean
  addressedTo: string | null
  needsApproval: boolean
  insufficientBalance: boolean
  balance: bigint | undefined
  approveTx: ReturnType<typeof useTransaction>
  fundTx: ReturnType<typeof useTransaction>
  approve: () => void
  fund: () => void
  fundingDeadline: number
}) {
  const {
    config,
    invoice,
    amount,
    isConnected,
    wrongClient,
    addressedTo,
    needsApproval,
    insufficientBalance,
    balance,
    approveTx,
    fundTx,
    approve,
    fund,
    fundingDeadline,
  } = props

  const linkExpired = fundingDeadline !== 0 && Date.now() / 1000 > fundingDeadline
  const approving = approveTx.phase === 'signing' || approveTx.phase === 'pending'
  const funding = fundTx.phase === 'signing' || fundTx.phase === 'pending'

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-3">
        {addressedTo && (
          <p className="text-[13px] text-muted-foreground">
            This request is addressed to a specific wallet. Sign in to the account that owns it
            to pay.
          </p>
        )}
        <SignInButton size="lg" full />
      </div>
    )
  }

  if (linkExpired) {
    return (
      <Notice tone="warn" title="Link expired">
        This payment link passed its funding deadline on {formatTimestamp(fundingDeadline)} and can no
        longer be funded.
      </Notice>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {wrongClient && addressedTo && (
        <Notice tone="warn" title="Different wallet expected">
          This request is addressed to <span className="font-mono">{addressedTo}</span>. Switch to
          that wallet to fund it.
        </Notice>
      )}

      {insufficientBalance && !wrongClient && (
        <Notice tone="warn">
          You hold {formatAmount(balance ?? BigInt(0), invoice.token.decimals)} {invoice.token.symbol}, and this
          request needs {formatAmount(amount, invoice.token.decimals)}.
        </Notice>
      )}

      <TransactionStatus
        phase={approveTx.phase}
        hash={approveTx.hash}
        error={approveTx.error}
        chain={config.chain}
        pendingLabel={`Approving ${invoice.token.symbol}`}
        confirmedLabel={`${invoice.token.symbol} approved`}
      />
      <TransactionStatus
        phase={fundTx.phase}
        hash={fundTx.hash}
        error={fundTx.error}
        chain={config.chain}
        pendingLabel="Depositing into escrow"
        confirmedLabel="Funds are locked in escrow"
      />

      <NetworkGuard>
        {needsApproval ? (
          <Button
            size="lg"
            full
            busy={approving}
            disabled={wrongClient || insufficientBalance}
            onClick={approve}
          >
            Approve {formatAmount(amount, invoice.token.decimals)} {invoice.token.symbol}
          </Button>
        ) : (
          <Button size="lg" full busy={funding} disabled={wrongClient || insufficientBalance} onClick={fund}>
            <Lock size={16} />
            Fund escrow
          </Button>
        )}
      </NetworkGuard>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <StepDot done={!needsApproval} /> Approve
        <span className="h-px flex-1 bg-border" />
        <StepDot done={false} /> Deposit
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        After you deposit you have {formatDuration(invoice.protectionPeriod)} to release the payment
        early or open a dispute. If you do neither, the escrow settles to the freelancer.
      </p>
    </div>
  )
}

function StepDot({ done }: { done: boolean }) {
  return (
    <span
      className="flex size-4 items-center justify-center rounded-full border"
      style={{
        borderColor: done ? 'var(--vt-positive)' : 'var(--border)',
        background: done ? 'var(--vt-positive)' : 'transparent',
        color: 'var(--primary-foreground)',
      }}
    >
      {done && <Check size={10} />}
    </span>
  )
}

/** Funded and running, expired, or disputed. */
function LockedPanel({
  invoice,
  config,
  escrow,
  secondsLeft,
  amount,
}: {
  invoice: SerialisedInvoice
  config: VaultedConfig
  escrow: NonNullable<ReturnType<typeof useEscrow>['escrow']>
  secondsLeft: number
  amount: bigint
}) {
  if (escrow.state === EscrowState.Disputed) {
    return (
      <Notice tone="warn" title="Dispute open">
        {STATUS_COPY.DISPUTED.detail} The {formatAmount(amount, invoice.token.decimals)}{' '}
        {invoice.token.symbol} stays in the contract until then.
      </Notice>
    )
  }

  if (escrow.isExpired) {
    return (
      <div className="rounded-xl px-4 py-4 text-center" style={{ background: 'var(--vt-warning-soft)' }}>
        <p className="vt-eyebrow" style={{ color: 'var(--vt-warning)' }}>
          Escrow expired
        </p>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--vt-warning)' }}>
          The client did not release or dispute the payment. Anyone can now trigger the settlement.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-4 py-6 text-center">
      <p className="vt-eyebrow text-muted-foreground">Protection window closes in</p>
      <p className="vt-numeric vt-editorial text-[2rem] leading-none">{formatCountdown(secondsLeft)}</p>
      <p className="text-[12px] text-muted-foreground">
        {formatAmount(amount, invoice.token.decimals)} {invoice.token.symbol} locked · settles to{' '}
        {invoice.payee.slice(0, 6)}… on {formatTimestamp(escrow.expiresAt)}
      </p>
    </div>
  )
}

function SettledPanel({
  invoice,
  config,
  state,
  amount,
}: {
  invoice: SerialisedInvoice
  config: VaultedConfig
  state: EscrowState
  amount: bigint
}) {
  const copy: Record<number, { title: string; body: string; tone: 'good' | 'neutral' }> = {
    [EscrowState.Released]: {
      title: 'Paid',
      body: `${formatAmount(amount, invoice.token.decimals)} ${invoice.token.symbol} reached the freelancer.`,
      tone: 'good',
    },
    [EscrowState.Refunded]: {
      title: 'Refunded',
      body: `The freelancer returned ${formatAmount(amount, invoice.token.decimals)} ${invoice.token.symbol} to the client.`,
      tone: 'neutral',
    },
    [EscrowState.Resolved]: {
      title: 'Dispute resolved',
      body: 'The arbiter split the escrow between both sides. The transfers are on chain.',
      tone: 'neutral',
    },
    [EscrowState.Cancelled]: {
      title: 'Request cancelled',
      body: 'This payment request was withdrawn before anyone funded it.',
      tone: 'neutral',
    },
  }
  const entry = copy[state]

  return (
    <div className="flex flex-col gap-3">
      <Notice tone={entry.tone === 'good' ? 'good' : 'neutral'} title={entry.title} icon={<Check size={15} />}>
        {entry.body}
      </Notice>
      {invoice.transactions.settle && (
        <TxHashLink hash={invoice.transactions.settle} chain={config.chain} label="Settlement" />
      )}
    </div>
  )
}
