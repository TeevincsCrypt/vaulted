'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Wallet, X } from 'lucide-react'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { useVaultedConfig, useWrongNetwork } from '@/lib/vaulted/client'
import { shortAddress } from '@/lib/vaulted/format'
import { Button, Notice } from './primitives'

/** Wallet connection for the Vaulted surface — real wagmi connectors, no simulated state. */

export function useWalletDialog() {
  const [open, setOpen] = useState(false)
  return { open, setOpen }
}

export function ConnectWalletButton({
  size = 'md',
  full,
  label = 'Connect wallet',
}: {
  size?: 'md' | 'lg'
  full?: boolean
  label?: string
}) {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const dialog = useWalletDialog()

  if (isConnected && address) {
    return (
      <>
        <Button variant="secondary" size={size} full={full} onClick={() => disconnect()}>
          <span className="size-1.5 rounded-full" style={{ background: 'var(--vt-positive)' }} />
          <span className="font-mono text-[13px]">{shortAddress(address)}</span>
        </Button>
        <WalletDialog open={dialog.open} onClose={() => dialog.setOpen(false)} />
      </>
    )
  }

  return (
    <>
      <Button size={size} full={full} onClick={() => dialog.setOpen(true)}>
        <Wallet size={16} />
        {label}
      </Button>
      <WalletDialog open={dialog.open} onClose={() => dialog.setOpen(false)} />
    </>
  )
}

export function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connectors, isPending, error } = useConnect()
  const { isConnected } = useAccount()
  const config = useVaultedConfig()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (isConnected) onClose()
  }, [isConnected, onClose])

  if (!open || typeof document === 'undefined') return null

  const injected = connectors.filter((connector) => connector.id !== 'walletConnect')
  const walletConnect = connectors.find((connector) => connector.id === 'walletConnect')

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="vt-wallet-title">
      <button type="button" className="absolute inset-0 bg-[#0a0a0b]/40 backdrop-blur-[2px]" onClick={onClose} aria-label="Close" />
      <div className="relative z-10 w-full max-w-[400px] rounded-t-2xl border border-border bg-card p-6 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="vt-wallet-title" className="text-[17px] font-semibold tracking-tight">
              Connect wallet
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {config ? `Vaulted runs on ${config.chain.name}.` : 'Vaulted is not configured for a chain yet.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {injected.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              disabled={isPending}
              onClick={() => connect({ connector })}
              className="flex items-center gap-3 rounded-xl border border-border px-4 py-3.5 text-left transition hover:bg-muted disabled:opacity-50"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-[13px] font-semibold">
                {connector.name.slice(0, 1)}
              </span>
              <span className="text-sm font-medium">{connector.name}</span>
            </button>
          ))}

          {walletConnect && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => connect({ connector: walletConnect })}
              className="flex items-center gap-3 rounded-xl border border-border px-4 py-3.5 text-left transition hover:bg-muted disabled:opacity-50"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-[13px] font-semibold">W</span>
              <span className="text-sm font-medium">WalletConnect</span>
            </button>
          )}

          {injected.length === 0 && !walletConnect && (
            <Notice tone="warn">
              No wallet was detected in this browser. Install a wallet extension, or set
              NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable WalletConnect.
            </Notice>
          )}
        </div>

        {error && (
          <div className="mt-4">
            <Notice tone="danger">{error.message}</Notice>
          </div>
        )}
      </div>
    </div>,
    document.body,
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
