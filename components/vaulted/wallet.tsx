'use client'

import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import { useVaultedConfig, useWrongNetwork } from '@/lib/vaulted/client'
import { shortAddress } from '@/lib/vaulted/format'
import { PRIVY_APP_ID_MALFORMED } from '@/lib/vaulted/privy'
import { useVaultedAuth } from './auth-provider'
import { Button, Notice, XLogo } from './primitives'

/**
 * The wallet surface.
 *
 * There is nothing to connect: signing in with X provisions the account's wallet and wagmi is
 * pointed at it. So this file has a sign-in call to action, a read-only indicator of the wallet
 * the account owns, and the network guard — no connector picker, because there is no choice to
 * offer and offering one would imply a wallet you could swap.
 */

/**
 * Shown wherever an action needs a signer and there is none yet.
 *
 * Three honest states: sign-in is impossible here, sign-in is possible, or the account exists and
 * its wallet is still being created. None of them render a button that cannot do what it says.
 */
export function SignInButton({
  size = 'md',
  full,
  label = 'Sign in with X',
}: {
  size?: 'md' | 'lg'
  full?: boolean
  label?: string
}) {
  const { configured, ready, signIn, syncing, error, walletPending } = useVaultedAuth()

  if (!configured) {
    return (
      <Notice tone="warn" title="Sign-in is not configured">
        {PRIVY_APP_ID_MALFORMED
          ? 'NEXT_PUBLIC_PRIVY_APP_ID is set but is not a Privy app id — they are exactly 25 characters. Until it is corrected, no account can be signed in and no wallet can be assigned.'
          : 'This deployment has no Privy app id set, so no account can be signed in and no wallet can be assigned. See the README for the variables it needs.'}
      </Notice>
    )
  }

  if (walletPending) {
    return (
      <Notice tone="warn" title="Your wallet is being created">
        Privy is provisioning the wallet for this account. It will appear here in a moment — nothing
        can be signed until it does.
      </Notice>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size={size} full={full} busy={!ready || syncing} onClick={signIn}>
        <XLogo />
        {label}
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  )
}

/**
 * Blocks any action while the wallet is on the wrong chain, and offers the real switch. Signing on
 * a different chain than the escrow would produce a transaction against nothing.
 */
export function NetworkGuard({ children }: { children: React.ReactNode }) {
  const { wrong, expected } = useWrongNetwork()
  const config = useVaultedConfig()
  const { switchChain, isPending } = useSwitchChain()

  if (!wrong || !expected) return <>{children}</>

  return (
    <div className="flex flex-col gap-3">
      <Notice tone="warn" title="Wrong network">
        Your wallet is on a different chain. Vaulted escrows for this payment live on{' '}
        {config?.chain.name ?? `chain ${expected}`}.
      </Notice>
      <Button full size="lg" busy={isPending} onClick={() => switchChain({ chainId: expected })}>
        Switch to {config?.chain.name ?? `chain ${expected}`}
      </Button>
    </div>
  )
}

/**
 * Header indicator for the account's wallet. Read-only by design — the address is not a setting,
 * it is what the account is. It links to the wallet page rather than opening a picker.
 */
export function WalletBadge() {
  const { address, isConnected } = useAccount()
  const { configured, walletAddress, walletPending } = useVaultedAuth()

  if (!configured) return null

  const shown = address ?? walletAddress
  const live = isConnected && Boolean(address)

  return (
    <Link
      href="/settings"
      className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[12px] transition hover:border-white/25 hover:bg-white/[0.06]"
      title={shown ?? 'No wallet yet'}
    >
      {walletPending ? (
        <Loader2 size={11} className="animate-spin text-muted-foreground" />
      ) : (
        <span
          className="size-1.5 rounded-full"
          style={{ background: live ? 'var(--vt-positive)' : 'var(--muted-foreground)' }}
        />
      )}
      <span className="hidden font-mono sm:block">
        {walletPending ? 'Creating wallet' : shown ? shortAddress(shown) : 'No wallet'}
      </span>
    </Link>
  )
}
