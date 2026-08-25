import { getAddress, isAddress, type Chain } from 'viem'
import { base, baseSepolia, hardhat } from 'viem/chains'
import { VAULTED_DEPLOYMENTS } from './generated/deployments'

/**
 * The networks Vaulted knows about, what each one can actually do, and which are production.
 *
 * Two ideas run through this file.
 *
 * **Tier.** Production is Base Mainnet and Solana Mainnet. Testnets exist for development and are
 * invisible unless `NEXT_PUBLIC_VAULTED_ENV=development`, so a production build cannot offer
 * Sepolia as somewhere to move real money.
 *
 * **Capability, not one "is it live" flag.** A network can settle a direct transfer without being
 * able to hold an escrow: a payment link needs only a token and an RPC, while escrow needs
 * VaultedEscrow deployed there. Solana can take payments today and cannot hold escrow at all,
 * because no Vaulted program exists for it. Collapsing those into a single boolean is what would
 * force the UI to lie in one direction or the other.
 *
 * Neither is ever declared. `escrow` is true only where a deployment record exists — written by the
 * deploy script from a real deployment — or an operator configured an address for a deployment they
 * made themselves. `transfer` is true only where a token address is known. Listing a network here
 * grants it nothing.
 */

export type ChainFamily = 'evm' | 'svm'
export type NetworkTier = 'production' | 'development'

export type ChainCapabilities = {
  /** VaultedEscrow is deployed here, so job escrows and escrowed invoices work. */
  escrow: boolean
  /** A token is known here, so payment links can be paid by direct transfer and verified. */
  transfer: boolean
}

export type ChainAvailability =
  /** Everything works: escrow and direct transfers. */
  | 'live'
  /** Payments work, escrow does not — no VaultedEscrow deployed on this network yet. */
  | 'payments-only'
  /** Nothing can be transacted here yet. */
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
  tier: NetworkTier
  capabilities: ChainCapabilities
  availability: ChainAvailability
  /** EVM chain id. Absent for non-EVM families. */
  evmChainId?: number
  /** Solana cluster. Absent for EVM families. */
  cluster?: 'mainnet-beta' | 'devnet'
  /** The viem chain object, for EVM families only. */
  viemChain?: Chain
  explorerUrl: string | null
  /** Set only where VaultedEscrow is deployed. Never a placeholder. */
  escrowAddress?: string
  /** The stablecoin payments on this network are denominated in. */
  token?: { address: string; symbol: string; decimals: number }
  /** Default RPC for reads. Overridable per network by environment. */
  rpcUrl?: string
  /** Why a network cannot do everything. Rendered verbatim, so it must be true. */
  note?: string
}

/**
 * Development networks are off unless asked for.
 *
 * Read through a literal `process.env.X` so Next can substitute it into the browser bundle; a
 * computed key silently becomes undefined there. It must be set at build time to affect the client.
 */
export const VAULTED_ENV =
  process.env.NEXT_PUBLIC_VAULTED_ENV?.trim() === 'development' ? 'development' : 'production'

export const IS_DEVELOPMENT = VAULTED_ENV === 'development'

/**
 * Canonical stablecoins, so a payment link on a production network has something real to be
 * denominated in. These are the issuers' own published addresses, not Vaulted contracts, and each
 * is overridable by environment.
 */
const TOKENS = {
  /** Circle's native USDC on Base. */
  base: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
  /** Circle's USDC mint on Solana mainnet-beta. */
  solana: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
} as const

/**
 * Per-network environment overrides.
 *
 * `NEXT_PUBLIC_ESCROW_ADDRESS_8453` is the single value that turns escrow on for Base Mainnet once
 * VaultedEscrow is deployed there — no code change. Literal keys again, for the build-time
 * substitution.
 */
function envOverrides(key: string) {
  const map: Record<string, { escrow?: string; token?: string; rpc?: string }> = {
    base: {
      escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_8453,
      token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_8453,
      rpc: process.env.NEXT_PUBLIC_RPC_URL_8453,
    },
    solana: {
      token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_SOLANA,
      rpc: process.env.NEXT_PUBLIC_RPC_URL_SOLANA,
    },
    'base-sepolia': {
      escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS_84532,
      token: process.env.NEXT_PUBLIC_TOKEN_ADDRESS_84532,
      rpc: process.env.NEXT_PUBLIC_RPC_URL_84532,
    },
  }
  const raw = map[key] ?? {}
  return {
    escrow: raw.escrow?.trim() || undefined,
    token: raw.token?.trim() || undefined,
    rpc: raw.rpc?.trim() || undefined,
  }
}

function availabilityFrom(capabilities: ChainCapabilities): ChainAvailability {
  if (capabilities.escrow && capabilities.transfer) return 'live'
  if (capabilities.transfer) return 'payments-only'
  return 'coming-soon'
}

type EvmSpec = {
  key: string
  shortName: string
  chain: Chain
  network: NetworkKind
  tier: NetworkTier
  token?: { address: string; symbol: string; decimals: number }
}

const EVM_SPECS: EvmSpec[] = [
  // Production. Base Mainnet is the primary EVM network.
  { key: 'base', shortName: 'Base', chain: base, network: 'mainnet', tier: 'production', token: TOKENS.base },
  // Development only.
  { key: 'base-sepolia', shortName: 'Base Sepolia', chain: baseSepolia, network: 'testnet', tier: 'development' },
  { key: 'localhost', shortName: 'Localhost', chain: hardhat, network: 'testnet', tier: 'development' },
]

function evmChain(spec: EvmSpec): VaultedChain {
  const overrides = envOverrides(spec.key)
  const deployment = VAULTED_DEPLOYMENTS[spec.chain.id]

  // An escrow address exists only because something real put it there: the deploy script wrote a
  // record, or an operator configured one for a deployment they made themselves.
  const escrowAddress = overrides.escrow ?? deployment?.address

  const token = deployment
    ? {
        address: overrides.token ?? deployment.token.address,
        symbol: deployment.token.symbol ?? 'TOKEN',
        decimals: deployment.token.decimals,
      }
    : overrides.token
      ? { address: overrides.token, symbol: spec.token?.symbol ?? 'TOKEN', decimals: spec.token?.decimals ?? 6 }
      : spec.token

  const capabilities: ChainCapabilities = {
    escrow: Boolean(escrowAddress && token),
    transfer: Boolean(token),
  }

  return {
    key: spec.key,
    name: spec.chain.name,
    shortName: spec.shortName,
    family: 'evm',
    network: spec.network,
    tier: spec.tier,
    capabilities,
    availability: availabilityFrom(capabilities),
    evmChainId: spec.chain.id,
    viemChain: spec.chain,
    explorerUrl: spec.chain.blockExplorers?.default?.url ?? null,
    escrowAddress,
    token,
    rpcUrl: overrides.rpc,
    note: capabilities.escrow
      ? undefined
      : capabilities.transfer
        ? `Payment links settle on ${spec.chain.name}. Escrow needs VaultedEscrow deployed here — ` +
          `set NEXT_PUBLIC_ESCROW_ADDRESS_${spec.chain.id} once it is.`
        : `No token is configured for ${spec.chain.name}, so nothing can be paid here yet.`,
  }
}

/**
 * Solana.
 *
 * Payments are real: a payment link is a direct SPL transfer of USDC to the recipient, and the
 * server verifies the signature against the cluster before a request is marked paid. Escrow is
 * not — it needs an on-chain Vaulted program, and none is deployed. `docs/SOLANA.md` carries the
 * program design; until it exists this network reports `payments-only` and the escrow adapter
 * refuses every call rather than returning something plausible.
 */
function solanaChain(spec: {
  key: string
  name: string
  shortName: string
  cluster: 'mainnet-beta' | 'devnet'
  tier: NetworkTier
  network: NetworkKind
  token?: { address: string; symbol: string; decimals: number }
}): VaultedChain {
  const overrides = envOverrides(spec.key)
  const token = overrides.token
    ? { address: overrides.token, symbol: spec.token?.symbol ?? 'USDC', decimals: spec.token?.decimals ?? 6 }
    : spec.token

  const capabilities: ChainCapabilities = { escrow: false, transfer: Boolean(token) }

  return {
    key: spec.key,
    name: spec.name,
    shortName: spec.shortName,
    family: 'svm',
    network: spec.network,
    tier: spec.tier,
    capabilities,
    availability: availabilityFrom(capabilities),
    cluster: spec.cluster,
    explorerUrl: 'https://explorer.solana.com',
    token,
    rpcUrl: overrides.rpc,
    note:
      'Payment links settle on Solana. Escrow does not: no Vaulted program is deployed, so a job ' +
      'budget cannot be held here.',
  }
}

const ALL_CHAINS: VaultedChain[] = [
  ...EVM_SPECS.map(evmChain),
  solanaChain({
    key: 'solana',
    name: 'Solana',
    shortName: 'Solana',
    cluster: 'mainnet-beta',
    tier: 'production',
    network: 'mainnet',
    token: TOKENS.solana,
  }),
  solanaChain({
    key: 'solana-devnet',
    name: 'Solana Devnet',
    shortName: 'Solana Devnet',
    cluster: 'devnet',
    tier: 'development',
    network: 'testnet',
  }),
]

/**
 * What this build exposes.
 *
 * Development networks are dropped entirely from a production build, so no code path — a stale
 * link, a hand-typed chain key, an old database row — can route real money onto a testnet. The
 * local dev chain additionally has to have something deployed to it.
 */
export const VAULTED_CHAINS: VaultedChain[] = ALL_CHAINS.filter((chain) => {
  if (chain.tier === 'development' && !IS_DEVELOPMENT) return false
  if (chain.key === 'localhost' && !chain.capabilities.escrow) return false
  return true
})

export function getChain(key: string): VaultedChain | null {
  return VAULTED_CHAINS.find((chain) => chain.key === key) ?? null
}

export function getChainByEvmId(evmChainId: number): VaultedChain | null {
  return VAULTED_CHAINS.find((chain) => chain.evmChainId === evmChainId) ?? null
}

/** Networks that can hold an escrow — job budgets and escrowed invoices. */
export function escrowChains(): VaultedChain[] {
  return VAULTED_CHAINS.filter((chain) => chain.capabilities.escrow)
}

/** Networks a payment link can be paid on. A superset of {@link escrowChains}. */
export function paymentChains(): VaultedChain[] {
  return VAULTED_CHAINS.filter((chain) => chain.capabilities.transfer)
}

/** Kept for callers that only care whether anything can hold an escrow. */
export function liveChains(): VaultedChain[] {
  return escrowChains()
}

/**
 * The network escrow defaults to: the production one if it is ready, else whatever single network
 * can hold an escrow. Null when nothing can, and the UI must say so rather than pick something.
 */
export function defaultChain(): VaultedChain | null {
  const chains = escrowChains()
  return chains.find((chain) => chain.tier === 'production') ?? chains[0] ?? null
}

/** The network a payment link defaults to. Base Mainnet in production. */
export function defaultPaymentChain(): VaultedChain | null {
  const chains = paymentChains()
  return (
    chains.find((chain) => chain.tier === 'production' && chain.family === 'evm') ??
    chains.find((chain) => chain.tier === 'production') ??
    chains[0] ??
    null
  )
}

export function isTransactable(chain: VaultedChain | null | undefined): boolean {
  return Boolean(chain?.capabilities.transfer)
}

export function canEscrow(chain: VaultedChain | null | undefined): boolean {
  return Boolean(chain?.capabilities.escrow)
}

export function explorerTxUrl(chain: VaultedChain, hash: string): string | null {
  if (!chain.explorerUrl) return null
  if (chain.family === 'svm') {
    const cluster = chain.cluster === 'mainnet-beta' ? '' : `?cluster=${chain.cluster}`
    return `${chain.explorerUrl}/tx/${hash}${cluster}`
  }
  return `${chain.explorerUrl.replace(/\/$/, '')}/tx/${hash}`
}

export function explorerAddressUrl(chain: VaultedChain, address: string): string | null {
  if (!chain.explorerUrl) return null
  if (chain.family === 'svm') {
    const cluster = chain.cluster === 'mainnet-beta' ? '' : `?cluster=${chain.cluster}`
    return `${chain.explorerUrl}/address/${address}${cluster}`
  }
  return `${chain.explorerUrl.replace(/\/$/, '')}/address/${address}`
}

/** Human label for the availability badge. Kept in one place so the UI cannot drift from truth. */
export function availabilityLabel(chain: VaultedChain): string {
  if (chain.availability === 'live') {
    return chain.network === 'testnet' ? 'Escrow · Testnet' : 'Escrow + payments'
  }
  if (chain.availability === 'payments-only') {
    return chain.network === 'testnet' ? 'Payments · Testnet' : 'Payments only'
  }
  return 'Coming soon'
}

/**
 * One asset identifier, normalised the same way everywhere.
 *
 * Assets are identified differently per family — an EVM address is checksummed hex, a Solana mint
 * is base58 — and both end up in the same signed message and the same database column. Checksumming
 * unconditionally throws on a mint; not checksumming at all lets the same EVM address in two cases
 * produce two different signed messages, and a signature that does not verify.
 *
 * So: checksum what is an EVM address, leave anything else exactly as given.
 */
export function normaliseAssetId(asset: string): string {
  return isAddress(asset) ? getAddress(asset) : asset
}
