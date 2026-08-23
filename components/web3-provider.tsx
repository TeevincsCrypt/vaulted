'use client'

import { PrivyProvider, type PrivyClientConfig } from '@privy-io/react-auth'
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyConfig } from '@privy-io/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { Chain } from 'viem'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { SUPPORTED_CHAINS } from '@/lib/vaulted/chains'
import { getVaultedConfig, isConfigured } from '@/lib/vaulted/config'
import { PRIVY_APP_ID } from '@/lib/vaulted/privy'

/**
 * Wallet and chain plumbing.
 *
 * Vaulted has no "connect wallet" step. Signing in with X through Privy provisions an embedded
 * wallet for the account and keeps it: the key material is split between a secure enclave and the
 * user's device, so Privy alone cannot sign, and Vaulted — which never holds a share at all —
 * certainly cannot. That wallet is exposed to wagmi through Privy's connector, so every
 * `useWriteContract` in the escrow flow keeps talking to a real signer on a real chain.
 *
 * With no Privy app id configured there is no wallet and none is faked: the tree still provides a
 * wagmi config so public reads (escrow state, receipts, balances) work, but it has no connectors,
 * so nothing can pretend to be able to sign.
 */

// The configured chain goes first so the wallet is prompted to switch to it, with the rest of the
// supported list registered behind it for reads.
const vaultedConfig = getVaultedConfig()
const active = isConfigured(vaultedConfig) ? vaultedConfig.chain : null
const rpcUrl = isConfigured(vaultedConfig) ? vaultedConfig.rpcUrl : null

const chains = (
  active ? [active, ...SUPPORTED_CHAINS.filter((chain) => chain.id !== active.id)] : SUPPORTED_CHAINS
) as [Chain, ...Chain[]]

const transports = Object.fromEntries(
  chains.map((chain) => [chain.id, http(active && chain.id === active.id && rpcUrl ? rpcUrl : undefined)]),
)

const wagmiConfig = PRIVY_APP_ID
  ? createPrivyConfig({ chains, transports })
  : createConfig({ chains, transports, connectors: [] })

const privyConfig: PrivyClientConfig = {
  // X only. There is deliberately no `wallet` method and no wallet list: one account, one wallet,
  // no external connection to choose between.
  loginMethods: ['twitter'],
  appearance: {
    theme: '#08080a',
    accentColor: '#ff8a00',
    walletList: [],
    showWalletLoginFirst: false,
    landingHeader: 'Sign in to Vaulted',
    loginMessage: 'Your X handle becomes your Vaulted username.',
  },
  embeddedWallets: {
    // Every account gets a wallet, so a signed-in user is never left unable to be paid.
    ethereum: { createOnLogin: 'all-users' },
  },
  supportedChains: chains,
  ...(active ? { defaultChain: active } : {}),
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  if (!PRIVY_APP_ID) {
    return (
      <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    )
  }

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>{children}</PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
