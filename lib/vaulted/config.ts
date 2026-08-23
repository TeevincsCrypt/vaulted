import type { Chain } from 'viem'
import { VAULTED_DEPLOYMENTS, type VaultedDeployment } from './generated/deployments'
import { findChain } from './chains'
import { defaultChain, getChainByEvmId } from './registry'

export type VaultedConfig = {
  chain: Chain
  chainId: number
  escrowAddress: `0x${string}`
  token: { address: `0x${string}`; symbol: string; decimals: number }
  arbiter: `0x${string}` | null
  defaultProtectionPeriod: number
  rpcUrl: string | null
  deployment: VaultedDeployment | null
}

/**
 * Why the protocol is unavailable, so the UI can say something true rather than showing a dead
 * button or, worse, a made-up address.
 */
export type VaultedUnavailable = {
  reason: 'no-deployment' | 'unknown-chain' | 'incomplete-env'
  message: string
  chainId: number | null
}

const env = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  escrowAddress: process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
  tokenAddress: process.env.NEXT_PUBLIC_TOKEN_ADDRESS,
  tokenSymbol: process.env.NEXT_PUBLIC_TOKEN_SYMBOL,
  tokenDecimals: process.env.NEXT_PUBLIC_TOKEN_DECIMALS,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
}

const isAddress = (value: string | undefined): value is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(value ?? '')

/**
 * The EVM chain escrow runs on.
 *
 * The registry decides — Base Mainnet in production, once VaultedEscrow is deployed there. The
 * explicit override remains for development and for anyone pointing at their own deployment, but
 * it is no longer how the production network gets chosen: "whichever single chain happens to have
 * a deployment record" was how a testnet ended up as the default.
 */
export function activeChainId(): number | null {
  if (env.chainId) {
    const parsed = Number(env.chainId)
    return Number.isFinite(parsed) ? parsed : null
  }
  return defaultChain()?.evmChainId ?? null
}

/**
 * Resolves the live protocol configuration, or explains why there isn't one.
 *
 * Addresses come from the deployment records written by the deploy script, and may be overridden by
 * environment variables. Nothing is ever defaulted to a placeholder: with no real deployment this
 * returns an unavailable result and the UI is expected to say so plainly.
 */
export function getVaultedConfig(chainIdOverride?: number): VaultedConfig | VaultedUnavailable {
  const chainId = chainIdOverride ?? activeChainId()

  if (chainId === null) {
    return {
      reason: 'no-deployment',
      chainId: null,
      message:
        'No network can hold an escrow yet. VaultedEscrow needs deploying to Base Mainnet, and ' +
        'NEXT_PUBLIC_ESCROW_ADDRESS_8453 set to its address. Payment links do not need this and ' +
        'work on every network with a configured token.',
    }
  }

  const chain = findChain(chainId)
  if (!chain) {
    return {
      reason: 'unknown-chain',
      chainId,
      message:
        `NEXT_PUBLIC_CHAIN_ID is set to ${chainId}, which this build does not expose. ` +
        'Production builds carry Base Mainnet only; testnets need NEXT_PUBLIC_VAULTED_ENV=development. ' +
        'Leave NEXT_PUBLIC_CHAIN_ID unset to use the default network.',
    }
  }

  const deployment: VaultedDeployment | undefined = VAULTED_DEPLOYMENTS[chainId]
  const registered = getChainByEvmId(chainId)

  // Precedence: the global override (one network, legacy), then what the registry resolved for
  // this network (its per-network env vars and deployment record), then the record itself.
  const escrowAddress = isAddress(env.escrowAddress)
    ? env.escrowAddress
    : isAddress(registered?.escrowAddress)
      ? registered.escrowAddress
      : deployment?.address
  const tokenAddress = isAddress(env.tokenAddress)
    ? env.tokenAddress
    : isAddress(registered?.token?.address)
      ? registered.token.address
      : deployment?.token.address

  if (!escrowAddress || !tokenAddress) {
    return {
      reason: deployment ? 'incomplete-env' : 'no-deployment',
      chainId,
      message:
        `No VaultedEscrow deployment is recorded for ${chain.name} (chain ${chainId}). ` +
        `Deploy it there and set NEXT_PUBLIC_ESCROW_ADDRESS_${chainId}, or point ` +
        'NEXT_PUBLIC_CHAIN_ID at a network that has one. Payment links are unaffected.',
    }
  }

  return {
    chain,
    chainId,
    escrowAddress,
    token: {
      address: tokenAddress,
      symbol: env.tokenSymbol || deployment?.token.symbol || registered?.token?.symbol || 'TOKEN',
      decimals: env.tokenDecimals
        ? Number(env.tokenDecimals)
        : (deployment?.token.decimals ?? registered?.token?.decimals ?? 6),
    },
    arbiter: deployment?.arbiter && deployment.arbiter !== ZERO_ADDRESS ? deployment.arbiter : null,
    defaultProtectionPeriod: deployment?.defaultProtectionPeriod ?? 24 * 60 * 60,
    rpcUrl: env.rpcUrl || registered?.rpcUrl || null,
    deployment: deployment ?? null,
  }
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function isConfigured(value: VaultedConfig | VaultedUnavailable): value is VaultedConfig {
  return 'escrowAddress' in value
}
