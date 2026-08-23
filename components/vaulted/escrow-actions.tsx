'use client'

import { useEffect } from 'react'
import { AlertTriangle, Ban, Gavel, RotateCcw, Send, Timer } from 'lucide-react'
import { useAccount } from 'wagmi'
import { VAULTED_ESCROW_ABI } from '@/lib/vaulted/generated/abi'
import type { VaultedConfig } from '@/lib/vaulted/config'
import { useTransaction, type EscrowSnapshot } from '@/lib/vaulted/client'
import { EscrowState } from '@/lib/vaulted/status'
import { formatAmount } from '@/lib/vaulted/format'
import { Button, Divider, Notice } from './primitives'
import { TransactionStatus } from './transaction-status'
import { NetworkGuard, SignInButton } from './wallet'

/**
 * Every action a connected wallet is entitled to take on an escrow, derived from the on-chain state
 * rather than from anything stored off chain. Each button sends a real transaction; none of them
 * change local state on their own.
 */
export function EscrowActions({
  escrowId,
  escrow,
  config,
  onSettled,
  compact,
}: {
  escrowId: `0x${string}`
  escrow: EscrowSnapshot
  config: VaultedConfig
  onSettled?: (hash: `0x${string}`) => void
  compact?: boolean
}) {
  const { address, isConnected } = useAccount()
  const tx = useTransaction()

  const viewer = address?.toLowerCase()
  const isPayer = Boolean(viewer && viewer === escrow.payer.toLowerCase())
  const isPayee = Boolean(viewer && viewer === escrow.payee.toLowerCase())

  const locked = escrow.state === EscrowState.Funded || escrow.state === EscrowState.Disputed
  const canRelease = locked && isPayer
  const canDispute = escrow.state === EscrowState.Funded && isPayer && escrow.canDispute
  const canRefund = locked && isPayee
  const canTimeout = escrow.canTimeout
  const canCancel =
    escrow.state === EscrowState.Created &&
    (isPayee || (escrow.fundingDeadline !== 0 && Date.now() / 1000 > escrow.fundingDeadline))

  useEffect(() => {
    if (tx.phase === 'confirmed' && tx.hash) onSettled?.(tx.hash)
    // Reporting the hash once per confirmation; onSettled is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.phase, tx.hash])

  function call(functionName: 'release' | 'refund' | 'executeTimeout' | 'cancel') {
    return () =>
      tx.send({
        address: config.escrowAddress,
        abi: VAULTED_ESCROW_ABI,
        functionName,
        args: [escrowId],
        chainId: config.chainId,
      })
  }

  function raiseDispute() {
    tx.send({
      address: config.escrowAddress,
      abi: VAULTED_ESCROW_ABI,
      functionName: 'dispute',
      // No evidence commitment yet: Vaulted has no evidence store, and writing a hash of
      // nothing would imply one exists.
      args: [escrowId, '0x0000000000000000000000000000000000000000000000000000000000000000'],
      chainId: config.chainId,
    })
  }

  // The timeout settlement is permissionless, so it is offered to every visitor — including one
  // with no wallet connected yet, who is prompted to connect rather than shown nothing.
  const anyoneCanAct = canTimeout
  const viewerCanAct = canRelease || canDispute || canRefund || canCancel
  if (!anyoneCanAct && !viewerCanAct && tx.phase === 'idle') return null
  if (!anyoneCanAct && !viewerCanAct && !isConnected) return null

  const amount = formatAmount(escrow.amount, config.token.decimals)
  const busy = tx.phase === 'signing' || tx.phase === 'pending'

  return (
    <div className="flex flex-col gap-3">
      {!compact && <Divider />}

      {/* The payment page renders its own expired banner; do not say it twice. */}
      {canTimeout && !compact && (
        <Notice tone="warn" title="Escrow expired" icon={<AlertTriangle size={15} />}>
          The client did not release or dispute the payment before the window closed. Anyone can now
          settle it — the funds go to the freelancer either way.
        </Notice>
      )}

      <TransactionStatus
        phase={tx.phase}
        hash={tx.hash}
        error={tx.error}
        chain={config.chain}
        pendingLabel="Settling on chain"
        confirmedLabel="Settled on chain"
      />

      {!isConnected ? (
        <SignInButton
          size="lg"
          full
          label={canTimeout ? 'Sign in to auto-release' : 'Sign in with X'}
        />
      ) : (
        <NetworkGuard>
          <div className="flex flex-col gap-2.5">
            {canTimeout && (
              <Button full size="lg" busy={busy} onClick={call('executeTimeout')}>
                <Timer size={16} />
                Auto-release {amount} {config.token.symbol}
              </Button>
            )}

            {canRelease && (
              <Button full size="lg" busy={busy} onClick={call('release')}>
                <Send size={16} />
                Release {amount} {config.token.symbol} to the freelancer
              </Button>
            )}

            {canDispute && (
              <Button full variant="secondary" busy={busy} onClick={raiseDispute}>
                <Gavel size={16} />
                Open a dispute
              </Button>
            )}

            {canRefund && (
              <Button full variant="secondary" busy={busy} onClick={call('refund')}>
                <RotateCcw size={16} />
                Refund the client
              </Button>
            )}

            {canCancel && (
              <div className="flex flex-col gap-1.5">
                <Button full variant="ghost" busy={busy} onClick={call('cancel')}>
                  <Ban size={16} />
                  Cancel this payment request
                </Button>
                {/*
                  The escrow already exists on chain, so withdrawing it is a state transition and
                  costs gas. It moves no money — nothing is locked until the client funds it.
                */}
                <p className="text-center text-[11px] text-muted-foreground">
                  This is an on-chain transaction and costs gas. No funds move — nothing is locked yet.
                </p>
              </div>
            )}
          </div>
        </NetworkGuard>
      )}

      {canDispute && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          A dispute pauses settlement. Vaulted does not decide it: resolving a disputed escrow
          needs {config.arbiter ? 'the arbiter configured for this deployment' : 'one side to concede, as this deployment has no arbiter'} —
          the freelancer can refund you, or you can release at any time.
        </p>
      )}
    </div>
  )
}
