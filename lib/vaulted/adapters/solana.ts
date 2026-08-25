import type { VaultedChain } from '../registry'
import {
  ChainNotImplementedError,
  type CreateEscrowParams,
  type EscrowAdapter,
  type EscrowSnapshot,
  type TxRequest,
} from './types'

/**
 * Solana adapter — NOT IMPLEMENTED.
 *
 * Solana is a first-class chain in this architecture: it has an adapter slot, a registry entry and
 * a place in the chain selector. What it does not have is a deployed Vaulted program, so every
 * operation here refuses loudly rather than returning something plausible.
 *
 * This is deliberate. A stub that returned an empty escrow, or a fabricated signature, would make
 * the UI look finished while moving no money. Refusing keeps `availability: 'coming-soon'` in the
 * registry honest all the way down to the call site.
 *
 * The Solidity VaultedEscrow cannot be reused here — Solana has no EVM. It needs a native program.
 * `docs/SOLANA.md` specifies the accounts, instructions, PDA derivation and checks required, and
 * lists the exact frontend integration points that stay unchanged because they go through
 * {@link EscrowAdapter}.
 */
export class SolanaEscrowAdapter implements EscrowAdapter {
  readonly chain: VaultedChain

  constructor(chain: VaultedChain) {
    this.chain = chain
  }

  private unavailable(operation: string): never {
    throw new ChainNotImplementedError(
      this.chain.key,
      `The Vaulted Solana program is not deployed, so "${operation}" cannot run. See docs/SOLANA.md.`,
    )
  }

  deriveEscrowId(_input: { payee: string; payer: string; salt: string }): string {
    // Would be a PDA: findProgramAddress(["escrow", payee, salt], programId). Deriving one now
    // would produce an address that no program owns.
    return this.unavailable('deriveEscrowId')
  }

  buildCreate(_params: CreateEscrowParams): TxRequest {
    return this.unavailable('createEscrow')
  }

  buildFund(_escrowId: string, _value?: string): TxRequest {
    return this.unavailable('fund')
  }

  buildRelease(_escrowId: string): TxRequest {
    return this.unavailable('release')
  }

  buildRefund(_escrowId: string): TxRequest {
    return this.unavailable('refund')
  }

  buildDispute(_escrowId: string, _evidenceHash: string): TxRequest {
    return this.unavailable('dispute')
  }

  buildExecuteTimeout(_escrowId: string): TxRequest {
    return this.unavailable('executeTimeout')
  }

  /** SPL transfers are authorised per-instruction, so there is no separate approval step. */
  buildApprove(_amount: string): TxRequest | null {
    return null
  }

  async readEscrow(_escrowId: string): Promise<EscrowSnapshot | null> {
    return this.unavailable('readEscrow')
  }

  explorerTx(hash: string): string | null {
    return this.chain.explorerUrl ? `${this.chain.explorerUrl}/tx/${hash}?cluster=${this.chain.cluster}` : null
  }

  explorerAddress(address: string): string | null {
    return this.chain.explorerUrl
      ? `${this.chain.explorerUrl}/address/${address}?cluster=${this.chain.cluster}`
      : null
  }
}
