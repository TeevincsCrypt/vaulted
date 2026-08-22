/** Mirrors `VaultedEscrow.State`. The on-chain value is always the authority. */
export enum EscrowState {
  None = 0,
  Created = 1,
  Funded = 2,
  Released = 3,
  Disputed = 4,
  Refunded = 5,
  Cancelled = 6,
  Resolved = 7,
}

/**
 * What the app shows. `Expired` is not a contract state — it is `Funded` past its expiry timestamp,
 * the point at which anybody may execute the timeout settlement.
 */
export type DisplayStatus =
  | 'AWAITING_CHAIN'
  | 'AWAITING_PAYMENT'
  | 'IN_ESCROW'
  | 'EXPIRED'
  | 'DISPUTED'
  | 'RELEASED'
  | 'REFUNDED'
  | 'RESOLVED'
  | 'CANCELLED'

export const TERMINAL_STATUSES: DisplayStatus[] = ['RELEASED', 'REFUNDED', 'RESOLVED', 'CANCELLED']

export function displayStatus(state: EscrowState, isExpired: boolean): DisplayStatus {
  switch (state) {
    case EscrowState.None:
      return 'AWAITING_CHAIN'
    case EscrowState.Created:
      return 'AWAITING_PAYMENT'
    case EscrowState.Funded:
      return isExpired ? 'EXPIRED' : 'IN_ESCROW'
    case EscrowState.Disputed:
      return 'DISPUTED'
    case EscrowState.Released:
      return 'RELEASED'
    case EscrowState.Refunded:
      return 'REFUNDED'
    case EscrowState.Resolved:
      return 'RESOLVED'
    case EscrowState.Cancelled:
      return 'CANCELLED'
  }
}

export const STATUS_COPY: Record<DisplayStatus, { label: string; detail: string; tone: 'neutral' | 'live' | 'warn' | 'good' | 'muted' }> = {
  AWAITING_CHAIN: {
    label: 'Not on chain yet',
    detail: 'The payment request exists but the escrow has not been created on chain.',
    tone: 'muted',
  },
  AWAITING_PAYMENT: {
    label: 'Awaiting payment',
    detail: 'The escrow is live on chain and waiting for the client to deposit.',
    tone: 'neutral',
  },
  IN_ESCROW: {
    label: 'In escrow',
    detail: 'Funds are locked. The client can release early or dispute until the window closes.',
    tone: 'live',
  },
  EXPIRED: {
    label: 'Escrow expired',
    detail: 'The protection window closed with no release and no dispute. Anyone can settle it now.',
    tone: 'warn',
  },
  DISPUTED: {
    label: 'Disputed',
    detail: 'Settlement is paused. It needs the arbiter, or one side to concede.',
    tone: 'warn',
  },
  RELEASED: { label: 'Paid out', detail: 'The full amount reached the payee.', tone: 'good' },
  REFUNDED: { label: 'Refunded', detail: 'The payee returned the full amount to the client.', tone: 'muted' },
  RESOLVED: { label: 'Dispute resolved', detail: 'The arbiter split the escrow between both sides.', tone: 'muted' },
  CANCELLED: { label: 'Cancelled', detail: 'The payment request was withdrawn before it was funded.', tone: 'muted' },
}
