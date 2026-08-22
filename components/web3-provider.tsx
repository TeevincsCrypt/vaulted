'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { Chain } from 'viem'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { SUPPORTED_CHAINS } from '@/lib/vaulted/chains'
import { getVaultedConfig, isConfigured } from '@/lib/vaulted/config'

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
const connectors = [
  injected({ shimDisconnect: true }),
  ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })] : []),
]

// The configured chain goes first so wallets are prompted to switch to it, with the rest of the
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

const config = createConfig({ chains, connectors, transports })

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
