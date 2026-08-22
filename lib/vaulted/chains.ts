import type { Chain } from 'viem'
import { base, baseSepolia, bsc, bscTestnet, hardhat, sepolia } from 'viem/chains'

/**
 * Chains Vaulted knows how to talk to. Being listed here only means the app can build a client
 * for the chain — whether the escrow contract actually exists on it is decided separately by the
 * deployment records in `generated/deployments.ts`.
 */
export const SUPPORTED_CHAINS: Chain[] = [baseSepolia, sepolia, bscTestnet, base, bsc, hardhat]

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
