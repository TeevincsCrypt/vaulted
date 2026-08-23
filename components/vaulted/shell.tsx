'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { LogOut, Menu, X } from 'lucide-react'
import { useVaultedConfig } from '@/lib/vaulted/client'
import { VaultedWordmark } from './marketing/logo'
import { NotificationBell } from './notifications'
import { useSession } from './session-provider'
import { WalletBadge } from './wallet'

export { VaultedWordmark as VaultedMark } from './marketing/logo'

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/request', label: 'Request payment' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/work', label: 'My work' },
]

/**
 * Chrome for the signed-in product.
 *
 * Shares the landing page's palette and mark so the app and the marketing site read as one product
 * rather than two websites.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const config = useVaultedConfig()
  const { account } = useSession()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-[#08080a]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-7">
            <Link href="/dashboard" className="transition-opacity hover:opacity-80">
              <VaultedWordmark />
            </Link>
            <nav className="hidden items-center gap-6 lg:flex" aria-label="Primary">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`text-[13.5px] transition-colors ${
                      active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {config && (
              <span className="hidden items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-[11.5px] text-muted-foreground md:flex">
                <span className="size-1.5 rounded-full" style={{ background: 'var(--vt-positive)' }} />
                {config.chain.name}
              </span>
            )}
            <NotificationBell />
            <WalletBadge />
            <AccountChip />
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="rounded-lg p-2 text-muted-foreground lg:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-border px-5 py-3 lg:hidden" aria-label="Primary mobile">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">{children}</main>

      <footer className="mx-auto max-w-6xl px-5 pb-12">
        <p className="text-xs text-muted-foreground">
          Escrow is enforced by a smart contract. Vaulted never takes custody of your funds.
          {account && <> Signed in as @{account.name}.</>}
        </p>
      </footer>
    </div>
  )
}

function AccountChip() {
  const { account, signOut } = useSession()
  const [open, setOpen] = useState(false)
  if (!account) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5 transition hover:bg-muted"
      >
        {account.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.avatarUrl} alt="" className="size-6 rounded-full" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
            {account.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="hidden text-[13px] font-medium sm:block">@{account.name}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          <div className="border-b border-border px-4 py-3">
            <p className="text-[13px] font-medium">@{account.name}</p>
            {account.displayName && <p className="text-[11.5px] text-muted-foreground">{account.displayName}</p>}
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Wallets
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Shown wherever the protocol has no deployment on the configured chain. States the reason rather
 * than rendering a payment surface that could not possibly work.
 */
export function NotConfigured({ message }: { message: string }) {
  return (
    <div className="vt-canvas flex min-h-screen items-center justify-center px-5">
      <div className="max-w-lg text-center">
        <VaultedWordmark className="justify-center" />
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
