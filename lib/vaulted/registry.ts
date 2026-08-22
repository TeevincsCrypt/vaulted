import type { Chain } from 'viem'
import { arbitrum, avalanche, base, baseSepolia, bsc, hardhat, mainnet, optimism, polygon } from 'viem/chains'
import { VAULTED_DEPLOYMENTS } from './generated/deployments'

/**
 * The chains Vaulted knows about, and — importantly — how far along each one actually is.
 *
 * Availability is *derived*, never declared: an EVM chain is only `live` when a deployment record
 * for it exists in `generated/deployments.ts`, which the deploy script writes from a real on-chain
 * deployment. Listing a chain here does not make it usable, and the UI is expected to render the
 * difference rather than imply every entry can take a payment.
 */

export type ChainFamily = 'evm' | 'svm'

export type ChainAvailability =
  /** An escrow implementation is deployed and the app can transact. */
  | 'live'
  /** Planned; no escrow implementation is deployed, so no transaction can be initiated. */
  | 'coming-soon'

export type NetworkKind = 'mainnet' | 'testnet'

export type VaultedChain = {
  /** Stable identifier used in URLs, the database and adapter lookups. */
  key: string
  name: string
  /** Short label for dense UI. */
  shortName: string
  family: ChainFamily
  network: NetworkKind
  availability: ChainAvailability
  /** EVM chain id. Absent for non-EVM families. */
  evmChainId?: number
  /** Solana cluster. Absent for EVM families. */
  cluster?: 'mainnet-beta' | 'devnet'
  /** The viem chain object, for EVM families only. */
  viemChain?: Chain
  explorerUrl: string | null
  /** Set only when an escrow implementation is deployed. */
  escrowAddress?: string
  /** The stablecoin this chain's escrow holds, when deployed. */
  token?: { address: string; symbol: string; decimals: number }
  /**
   * Why a chain is not yet live. Rendered verbatim in the UI, so it must be true.
   */
  note?: string
}

type EvmSpec = { key: string; shortName: string; chain: Chain; network: NetworkKind }

const EVM_SPECS: EvmSpec[] = [
  { key: 'base-sepolia', shortName: 'Base Sepolia', chain: baseSepolia, network: 'testnet' },
  { key: 'base', shortName: 'Base', chain: base, network: 'mainnet' },
  { key: 'ethereum', shortName: 'Ethereum', chain: mainnet, network: 'mainnet' },
  { key: 'arbitrum', shortName: 'Arbitrum', chain: arbitrum, network: 'mainnet' },
  { key: 'optimism', shortName: 'Optimism', chain: optimism, network: 'mainnet' },
  { key: 'bnb', shortName: 'BNB Chain', chain: bsc, network: 'mainnet' },
  { key: 'polygon', shortName: 'Polygon', chain: polygon, network: 'mainnet' },
  { key: 'avalanche', shortName: 'Avalanche', chain: avalanche, network: 'mainnet' },
  // Local development. Only ever `live` when a chain-31337 deployment record exists, and that
  // record is gitignored — so this entry is invisible in any real deployment.
  { key: 'localhost', shortName: 'Localhost', chain: hardhat, network: 'testnet' },
]

function evmChain(spec: EvmSpec): VaultedChain {
  const deployment = VAULTED_DEPLOYMENTS[spec.chain.id]
  return {
    key: spec.key,
    name: spec.chain.name,
    shortName: spec.shortName,
    family: 'evm',
    network: spec.network,
    // A record only exists because the deploy script wrote one after a real deployment.
    availability: deployment ? 'live' : 'coming-soon',
    evmChainId: spec.chain.id,
    viemChain: spec.chain,
    explorerUrl: spec.chain.blockExplorers?.default?.url ?? null,
    escrowAddress: deployment?.address,
    token: deployment
      ? {
          address: deployment.token.address,
          symbol: deployment.token.symbol ?? 'TOKEN',
          decimals: deployment.token.decimals,
        }
      : undefined,
    note: deployment ? undefined : 'No VaultedEscrow deployment recorded for this chain yet.',
  }
}

/**
 * Solana is a first-class chain in the architecture — {@link lib/vaulted/adapters} has a slot for
 * it — but no Vaulted program is deployed, so it cannot be transacted on. See
 * `docs/SOLANA.md` for the program design and what remains.
 */
const SOLANA_DEVNET: VaultedChain = {
  key: 'solana-devnet',
  name: 'Solana Devnet',
  shortName: 'Solana',
  family: 'svm',
  network: 'testnet',
  availability: 'coming-soon',
  cluster: 'devnet',
  explorerUrl: 'https://explorer.solana.com',
  note: 'The Vaulted Solana program is not implemented yet — architecture only.',
}

const ALL_CHAINS: VaultedChain[] = [...EVM_SPECS.map(evmChain), SOLANA_DEVNET]

/**
 * The local dev chain is only part of the registry when something is actually deployed to it, so
 * it never shows up in a hosted build.
 */
export const VAULTED_CHAINS: VaultedChain[] = ALL_CHAINS.filter(
  (chain) => chain.key !== 'localhost' || chain.availability === 'live',
)

export function getChain(key: string): VaultedChain | null {
  return VAULTED_CHAINS.find((chain) => chain.key === key) ?? null
}

export function getChainByEvmId(evmChainId: number): VaultedChain | null {
  return VAULTED_CHAINS.find((chain) => chain.evmChainId === evmChainId) ?? null
}

/** Chains a user can actually transact on right now. */
export function liveChains(): VaultedChain[] {
  return VAULTED_CHAINS.filter((chain) => chain.availability === 'live')
}

/**
 * The chain the app defaults to: the single live one, or the first if several are live.
 * Null when nothing is deployed anywhere — the UI must say so rather than pick something.
 */
export function defaultChain(): VaultedChain | null {
  return liveChains()[0] ?? null
}

export function isTransactable(chain: VaultedChain | null | undefined): boolean {
  return chain?.availability === 'live'
}

export function explorerTxUrl(chain: VaultedChain, hash: string): string | null {
  if (!chain.explorerUrl) return null
  if (chain.family === 'svm') return `${chain.explorerUrl}/tx/${hash}?cluster=${chain.cluster}`
  return `${chain.explorerUrl.replace(/\/$/, '')}/tx/${hash}`
}

export function explorerAddressUrl(chain: VaultedChain, address: string): string | null {
  if (!chain.explorerUrl) return null
  if (chain.family === 'svm') return `${chain.explorerUrl}/address/${address}?cluster=${chain.cluster}`
  return `${chain.explorerUrl.replace(/\/$/, '')}/address/${address}`
}

/** Human label for the availability badge. Kept in one place so the UI cannot drift from truth. */
export function availabilityLabel(chain: VaultedChain): string {
  if (chain.availability === 'live') return chain.network === 'testnet' ? 'Live · Testnet' : 'Live'
  return 'Coming soon'
}
