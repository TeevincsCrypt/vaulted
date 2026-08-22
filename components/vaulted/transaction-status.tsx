'use client'

import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import type { Chain } from 'viem'
import type { TxPhase } from '@/lib/vaulted/client'
import { Notice, TxHashLink } from './primitives'

/**
 * The real lifecycle of a real transaction: wallet prompt, broadcast, mined. The hash appears as
 * soon as the network has it, so the user can follow it on an explorer independently of this page.
 */
export function TransactionStatus({
  phase,
  hash,
  error,
  chain,
  pendingLabel = 'Waiting for confirmation',
  confirmedLabel = 'Confirmed on chain',
}: {
  phase: TxPhase
  hash: `0x${string}` | undefined
  error: string | null
  chain: Chain | null
  pendingLabel?: string
  confirmedLabel?: string
}) {
  if (phase === 'idle') return null

  if (phase === 'error') {
    return (
      <Notice tone="danger" icon={<AlertCircle size={15} />}>
        {error ?? 'The transaction failed.'}
        {hash && (
          <div className="mt-1.5">
            <TxHashLink hash={hash} chain={chain} label="Transaction" />
          </div>
        )}
      </Notice>
    )
  }

  if (phase === 'signing') {
    return (
      <Notice icon={<Loader2 size={15} className="vt-spin" />}>Confirm the transaction in your wallet.</Notice>
    )
  }

  if (phase === 'pending') {
    return (
      <Notice icon={<Loader2 size={15} className="vt-spin" />}>
        {pendingLabel}
        {hash && (
          <div className="mt-1.5">
            <TxHashLink hash={hash} chain={chain} label="Transaction" />
          </div>
        )}
      </Notice>
    )
  }

  return (
    <Notice tone="good" icon={<CheckCircle2 size={15} />}>
      {confirmedLabel}
      {hash && (
        <div className="mt-1.5">
          <TxHashLink hash={hash} chain={chain} label="Transaction" />
        </div>
      )}
    </Notice>
  )
}
