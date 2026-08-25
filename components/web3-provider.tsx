'use client'

import {
  PrivyProvider,
  type ConnectedWallet as PrivyConnectedWallet,
  type PrivyClientConfig,
  type User as PrivyUser,
} from '@privy-io/react-auth'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyConfig } from '@privy-io/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { Chain } from 'viem'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { SUPPORTED_CHAINS } from '@/lib/vaulted/chains'
import { getVaultedConfig, isConfigured } from '@/lib/vaulted/config'
import { PRIVY_APP_ID } from '@/lib/vaulted/privy'
import { VAULTED_CHAINS } from '@/lib/vaulted/registry'

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

/*
  No browser extension is ever discovered.

  wagmi turns on EIP-6963 discovery by default, which registers every injected wallet in the browser
  — Rabby, MetaMask, whatever is installed — as a connector, and `reconnect()` will happily pick one
  of them as the active account. On an app with a connect-wallet step that is the point. Here it is
  a bug: the account's wallet is the one Privy assigned and the one payments to the handle are
  recorded against, so a browser extension winning that slot means the signer is not the payee. What
  the user sees is an extension asking to sign for a job post, and a "signer does not match" warning
  on their own wallet page.
*/
const wagmiConfig = PRIVY_APP_ID
  ? createPrivyConfig({ chains, transports, multiInjectedProviderDiscovery: false })
  : createConfig({ chains, transports, connectors: [], multiInjectedProviderDiscovery: false })

/**
 * Which wallet wagmi is allowed to treat as the account's.
 *
 * Only ever the embedded one. Privy hands `useWallets()` every wallet it knows about, external ones
 * included, and without this the connector set is built from all of them and the active account is
 * decided by whichever id `reconnect()` finds stored — which is how an extension ends up signing.
 * Returning a single wallet makes Privy build exactly one connector and set the connection to it
 * outright, so the answer no longer depends on reconnect ordering. That is also what fixes a wallet
 * that never loads at all: the connection is set directly rather than waiting on a reconnect that
 * may never fire.
 *
 * Returning nothing is the honest answer while Privy is still provisioning — wagmi holds no account
 * rather than adopting a wallet that is not the account's.
 */
function embeddedWalletOnly({
  wallets,
  user,
}: {
  wallets: PrivyConnectedWallet[]
  user: PrivyUser | null
}): PrivyConnectedWallet | undefined {
  const embedded = wallets.find((wallet) => wallet.walletClientType === 'privy')
  if (embedded) return embedded
  // Same wallet by a different route: Privy's own record of it, in case the flag is not yet set on
  // the entry in `wallets`. Never a fallback to "any wallet" — that is the bug, not a recovery.
  const recorded = user?.wallet?.address?.toLowerCase()
  return recorded ? wallets.find((wallet) => wallet.address.toLowerCase() === recorded) : undefined
}

/**
 * The RPC Privy signs Solana transactions against.
 *
 * Without this Privy has no endpoint to broadcast through and throws "No RPC configuration found
 * for chain solana:mainnet" the moment the user approves — which is exactly what made the pay page
 * fall over on click.
 *
 * It points at Vaulted's own proxy rather than a cluster. Public endpoints refuse browser origins,
 * and a private one would have to be a `NEXT_PUBLIC_` variable to be reachable here, which is no
 * longer private. The proxy keeps the endpoint server-side and forwards only the methods a send
 * needs.
 *
 * Built lazily and per-origin, because `window` does not exist while this module is evaluated on
 * the server and `@solana/kit` wants an absolute URL.
 */
function solanaRpcs() {
  if (typeof window === 'undefined') return undefined

  const clusters = VAULTED_CHAINS.filter((chain) => chain.family === 'svm')
  if (clusters.length === 0) return undefined

  const entries = clusters.flatMap((chain) => {
    const key = chain.cluster === 'devnet' ? 'solana:devnet' : 'solana:mainnet'
    const http = `${window.location.origin}/api/solana/rpc?network=${encodeURIComponent(chain.key)}`
    return [
      [
        key,
        {
          rpc: createSolanaRpc(http),
          /*
            Never actually connected: every send passes `optimisticBroadcast`, so Privy returns the
            signature once the cluster accepts it and does not wait on a subscription. Whether the
            payment happened is settled by reading the transaction back on the server, which is the
            only thing Vaulted ever treats as proof. The value is required by the config shape.
          */
          rpcSubscriptions: createSolanaRpcSubscriptions(
            http.replace(/^http/, 'ws').replace('/api/solana/rpc', '/api/solana/rpc-subscriptions'),
          ),
          blockExplorerUrl: chain.explorerUrl ?? undefined,
        },
      ] as const,
    ]
  })

  return Object.fromEntries(entries)
}

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
    // Every account gets a wallet on both rails, so a signed-in user can be paid on either without
    // a second onboarding. wagmi only ever sees the Ethereum one; the Solana address is an address
    // to receive at, and Vaulted has no Solana program to sign against yet.
    ethereum: { createOnLogin: 'all-users' },
    solana: { createOnLogin: 'all-users' },
  },
  supportedChains: chains,
  solana: { rpcs: solanaRpcs() },
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
        <PrivyWagmiProvider config={wagmiConfig} setActiveWalletForWagmi={embeddedWalletOnly}>
          {children}
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
