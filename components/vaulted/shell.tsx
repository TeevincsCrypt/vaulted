'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useVaultedConfig } from '@/lib/vaulted/client'
import { ConnectWalletButton } from './wallet'

export function VaultedMark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="flex size-7 items-center justify-center rounded-lg text-[13px] font-bold"
        style={{ background: 'var(--foreground)', color: 'var(--background)' }}
        aria-hidden
      >
        V
      </span>
      <span className="text-[15px] font-semibold tracking-tight">
        Vaulted
      </span>
    </span>
  )
}

/** Chrome for the freelancer-facing pages. The payment page uses a barer frame of its own. */
export function AppShell({ children }: { children: ReactNode }) {
  const config = useVaultedConfig()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/dashboard" className="transition-opacity hover:opacity-70">
            <VaultedMark />
          </Link>
          <div className="flex items-center gap-4">
            <nav className="hidden items-center gap-4 sm:flex" aria-label="Primary">
              <Link href="/dashboard" className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/jobs" className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">
                Jobs
              </Link>
            </nav>
            {config && (
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
                <span className="size-1.5 rounded-full" style={{ background: 'var(--vt-positive)' }} />
                {config.chain.name}
              </span>
            )}
            <ConnectWalletButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">{children}</main>
      <footer className="mx-auto max-w-5xl px-5 pb-12">
        <p className="text-xs text-muted-foreground">
          Escrow is enforced by a smart contract. Vaulted never takes custody of your funds.
        </p>
      </footer>
    </div>
  )
}

/**
 * Shown wherever the protocol has no deployment on the configured chain. It states the reason
 * rather than rendering a payment surface that could not possibly work.
 */
export function NotConfigured({ message }: { message: string }) {
  return (
    <div className="vt-canvas flex min-h-screen items-center justify-center px-5">
      <div className="max-w-lg text-center">
        <VaultedMark className="justify-center" />
        <h1 className="vt-display mt-6 text-2xl">Not deployed yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <p className="mt-6 text-xs text-muted-foreground">
          Nothing on this page is simulated. Until the escrow contract is deployed and configured,
          there is no chain state to show.
        </p>
      </div>
    </div>
  )
}
