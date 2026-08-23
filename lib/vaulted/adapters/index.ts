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

/**
 * Caps how long one chain read may hold up a page.
 *
 * The adapter already fails fast per request, but a rate-limited endpoint can still stall a batch
 * behind a queue. A list of escrows is better rendered with one row marked unreadable than not
 * rendered at all, so this turns a slow read into a known-unknown instead of a hung request.
 */
export async function readWithDeadline<T>(
  read: () => Promise<T>,
  ms = 8_000,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const value = await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the chain did not respond within ${ms / 1000}s`)), ms)
      }),
    ])
    return { ok: true, value }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
