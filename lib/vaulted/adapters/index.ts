import { getChain, type VaultedChain } from '../registry'
import { EvmEscrowAdapter } from './evm'
import { SolanaEscrowAdapter } from './solana'
import { ChainNotImplementedError, type EscrowAdapter } from './types'

export * from './types'
export { EvmEscrowAdapter } from './evm'
export { SolanaEscrowAdapter } from './solana'

/**
 * Resolves the escrow implementation for a chain.
 *
 * Returning an adapter is not a promise that the chain works — a `coming-soon` chain gets an
 * adapter whose operations throw {@link ChainNotImplementedError}. Callers that are about to move
 * money should check `chain.availability` first and keep the button disabled; the throw is the
 * backstop, not the guard.
 */
export function getAdapter(chainKey: string, rpcUrl?: string): EscrowAdapter {
  const chain = getChain(chainKey)
  if (!chain) throw new ChainNotImplementedError(chainKey, 'It is not in the chain registry.')
  return adapterFor(chain, rpcUrl)
}

export function adapterFor(chain: VaultedChain, rpcUrl?: string): EscrowAdapter {
  switch (chain.family) {
    case 'evm':
      return new EvmEscrowAdapter(chain, rpcUrl)
    case 'svm':
      return new SolanaEscrowAdapter(chain)
  }
}
