'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { ArrowRight, LogOut, Menu, X } from 'lucide-react'
import { useVaultedConfig } from '@/lib/vaulted/client'
import { VaultedWordmark } from './marketing/logo'
import { Card, Eyebrow } from './primitives'
import { NotificationBell } from './notifications'
import { useVaultedAuth } from './auth-provider'
import { useSession } from './session-provider'
import { WalletBadge } from './wallet'

export { VaultedWordmark as VaultedMark } from './marketing/logo'

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/jobs', label: 'Marketplace' },
  { href: '/jobs/posted', label: 'My jobs' },
  { href: '/work', label: 'My work' },
  { href: '/payment-requests', label: 'Payments' },
  { href: '/funds', label: 'Funds' },
  { href: '/activity', label: 'Activity' },
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
        <div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-6 px-6">
          <div className="flex min-w-0 items-center gap-9">
            <Link href="/dashboard" className="shrink-0 transition-opacity hover:opacity-80">
              <VaultedWordmark />
            </Link>
            <nav className="hidden items-center gap-1 xl:flex" aria-label="Primary">
              {NAV.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/jobs' && pathname.startsWith(`${item.href}/`)) ||
                  (item.href === '/jobs' && /^\/jobs\/(?!posted)/.test(pathname))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                      active
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
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
              className="rounded-lg p-2 text-muted-foreground xl:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-border px-6 py-3 xl:hidden" aria-label="Primary mobile">
            {[...NAV, { href: '/request', label: 'Raise an escrow' }, { href: '/inbox', label: 'To pay' }].map(
              (item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-3 text-[14px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-[1240px] px-6 py-10">{children}</main>

      <footer className="mx-auto max-w-[1240px] px-6 pb-12">
        <p className="text-xs text-muted-foreground">
          Escrow is enforced by a smart contract. Vaulted never takes custody of your funds.
          {account && <> Signed in as @{account.name}.</>}
        </p>
      </footer>
    </div>
  )
}

function AccountChip() {
  const { account } = useSession()
  const { signOut } = useVaultedAuth()
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
          {/* Kept out of the top row to keep it uncluttered, but never unreachable. */}
          {[
            { href: '/settings', label: 'Your wallet' },
            { href: '/request', label: 'Raise an escrow' },
            { href: '/inbox', label: 'To pay' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
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
 * Escrow is unavailable, but the rest of the product is not.
 *
 * Rendered inside the shell rather than as a full-page wall: escrow needing a contract says nothing
 * about payment links, which settle by transfer and work today. A page that blacks out entirely
 * hides the thing the user can actually do.
 */
export function EscrowUnavailable({ what, message }: { what: string; message: string }) {
  return (
    <Card className="p-8">
      <Eyebrow>Not available yet</Eyebrow>
      <h2 className="vt-display mt-2 text-xl">{what} needs the escrow contract</h2>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">{message}</p>
      <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
        Getting paid does not have to wait for it. A payment link settles by direct transfer on Base
        or Solana, with the transaction verified against the network before anything is marked paid.
      </p>
      <Link
        href="/payment-requests"
        className="mt-6 inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-[#08080a] transition-transform hover:-translate-y-0.5"
        style={{ background: 'var(--vt-accent)' }}
      >
        Request a payment instead <ArrowRight size={16} />
      </Link>
    </Card>
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
