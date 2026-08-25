import type { VaultedChain } from '../registry'
import type { EscrowState } from '../status'

/**
 * The chain-agnostic escrow contract, as the application sees it.
 *
 * Every family (EVM today, SVM next) implements this. The React and API layers talk to the
 * interface, so adding a chain means adding an adapter — not editing the payment flow.
 *
 * Writes are returned as descriptors rather than executed here. Signing belongs to the wallet layer
 * (wagmi for EVM, a wallet adapter for Solana), and keeping the adapter free of React lets the same
 * code run on the server for indexing.
 */

/** An unsigned write, shaped for the family that will execute it. */
export type TxRequest =
  | {
      kind: 'evm'
      chainId: number
      address: `0x${string}`
      abi: readonly unknown[]
      functionName: string
      args: readonly unknown[]
      /** Wei to send with the call. Only funding a native escrow sets it. */
      value?: bigint
    }
  | {
      kind: 'svm'
      cluster: string
      programId: string
      instruction: string
      accounts: Record<string, string>
      data: Record<string, unknown>
    }

/** Chain-agnostic view of one escrow, read from the chain. */
export type EscrowSnapshot = {
  state: EscrowState
  payer: string
  payee: string
  /** Base units of the escrow's token, as a string so no precision is lost across families. */
  amount: string
  createdAt: number
  fundedAt: number
  expiresAt: number
  fundingDeadline: number
  protectionPeriod: number
  detailsHash: string
  isExpired: boolean
  canTimeout: boolean
  canDispute: boolean
  secondsUntilExpiry: number
}

export type CreateEscrowParams = {
  payee: string
  payer: string
  /**
   * What the escrow holds. The zero address means the chain's own currency; anything else must be
   * the token the deployment was constructed with, the only ERC-20 it accepts.
   */
  asset: string
  /** Base units, as a decimal string. */
  amount: string
  protectionPeriod: number
  fundingDeadline: number
  detailsHash: string
  salt: string
  /**
   * Which side is sending this transaction.
   *
   * 'payer' is the route that lets a freelancer hold nothing: the client creates the escrow naming
   * them, so the freelancer never sends a transaction and never needs a balance. 'payee' is a
   * freelancer raising their own payment request, which is still how an unsolicited one works.
   */
  by: 'payer' | 'payee'
}

export interface EscrowAdapter {
  readonly chain: VaultedChain

  /**
   * Deterministic escrow id, computable before the escrow exists on chain.
   *
   * Both parties, because either may create it — see the note on the contract's own
   * `computeEscrowId`. An id reachable from the payee alone could be occupied by anyone who had
   * seen the payment link.
   */
  deriveEscrowId(input: { payee: string; payer: string; salt: string }): string

  buildCreate(params: CreateEscrowParams): TxRequest
  /** Funding a native escrow carries the amount as value, so the caller needs it back. */
  buildFund(escrowId: string, value?: string): TxRequest
  buildRelease(escrowId: string): TxRequest
  buildRefund(escrowId: string): TxRequest
  buildDispute(escrowId: string, evidenceHash: string): TxRequest
  buildExecuteTimeout(escrowId: string): TxRequest

  /** Approval needed before funding, or null when the family does not need one. */
  buildApprove(amount: string): TxRequest | null

  /**
   * Live read. Resolves to null when the escrow does not exist yet; throws when the chain could
   * not be reached, so callers can tell "no escrow" from "no answer".
   */
  readEscrow(escrowId: string): Promise<EscrowSnapshot | null>

  explorerTx(hash: string): string | null
  explorerAddress(address: string): string | null
}

/**
 * Thrown when something targets a chain Vaulted does not yet implement. Carrying the chain makes
 * the UI able to say which one, instead of failing generically.
 */
export class ChainNotImplementedError extends Error {
  /**
   * Identified by a branded field rather than `instanceof`.
   *
   * A bundler that ends up with two copies of this module — different import specifiers, a server
   * and a client graph — produces two distinct classes, and `instanceof` then silently returns
   * false. For an error that decides whether the UI says "not supported yet" or "something broke",
   * silently wrong is the worst outcome, so the check does not depend on prototype identity.
   */
  static readonly code = 'VAULTED_CHAIN_NOT_IMPLEMENTED'
  readonly code = ChainNotImplementedError.code
  readonly chainKey: string

  constructor(chainKey: string, detail: string) {
    super(`Vaulted does not support ${chainKey} yet. ${detail}`)
    this.name = 'ChainNotImplementedError'
    this.chainKey = chainKey
  }

  static is(error: unknown): error is ChainNotImplementedError {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === ChainNotImplementedError.code
    )
  }
}
