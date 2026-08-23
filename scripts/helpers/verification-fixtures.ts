import { base as baseChain } from 'viem/chains'
import type { VaultedChain } from '../../lib/vaulted/registry'

/**
 * Synthetic networks for the verification suite.
 *
 * Built by hand rather than read from the registry: the suite is about what the verifier does with
 * a given network, and reading the real registry would make the cases depend on whatever happens to
 * be configured in the environment running them.
 */

export function base(overrides: Partial<VaultedChain> = {}): VaultedChain {
  return {
    key: 'base',
    name: 'Base',
    shortName: 'Base',
    family: 'evm',
    network: 'mainnet',
    tier: 'production',
    capabilities: { escrow: false, transfer: true },
    availability: 'payments-only',
    evmChainId: baseChain.id,
    viemChain: baseChain,
    explorerUrl: 'https://basescan.org',
    ...overrides,
  }
}

export function solana(overrides: Partial<VaultedChain> = {}): VaultedChain {
  const token = 'token' in overrides ? overrides.token : undefined
  return {
    key: 'solana',
    name: 'Solana',
    shortName: 'Solana',
    family: 'svm',
    network: 'mainnet',
    tier: 'production',
    cluster: 'mainnet-beta',
    capabilities: { escrow: false, transfer: Boolean(token) },
    availability: token ? 'payments-only' : 'coming-soon',
    explorerUrl: 'https://explorer.solana.com',
    ...overrides,
  }
}
