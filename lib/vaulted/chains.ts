import type { Chain } from 'viem'
import { VAULTED_CHAINS } from './registry'

/**
 * The EVM chains wagmi is configured with, derived from the network registry rather than listed
 * again here.
 *
 * One source of truth matters: a chain present in wagmi but absent from the registry is a chain the
 * wallet can be switched to and the app knows nothing about. Because the registry drops development
 * networks from a production build, so does this — a production wallet cannot be switched to
 * Sepolia by Vaulted.
 */
export const SUPPORTED_CHAINS: Chain[] = VAULTED_CHAINS.flatMap((chain) =>
  chain.family === 'evm' && chain.viemChain ? [chain.viemChain] : [],
)

export function findChain(chainId: number): Chain | null {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId) ?? null
}

export function explorerTxUrl(chain: Chain | null, hash: string): string | null {
  const base_ = chain?.blockExplorers?.default?.url
  return base_ ? `${base_.replace(/\/$/, '')}/tx/${hash}` : null
}

export function explorerAddressUrl(chain: Chain | null, address: string): string | null {
  const base_ = chain?.blockExplorers?.default?.url
  return base_ ? `${base_.replace(/\/$/, '')}/address/${address}` : null
}
