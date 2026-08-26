'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

/*
  Does the full navigation row actually fit?

  It used to be answered by a hardcoded breakpoint, which cannot work: the wallet cluster carries a
  network pill whose width is the *name of the current network*, so a row measured against "Base"
  overlapped the moment the same build ran on "Base Sepolia". A breakpoint chosen for the longest
  name would also hide the nav on viewports where it fits perfectly well.

  So it is measured, against the gap between the two things it has to sit between: the right edge
  of the wordmark and the left edge of the cluster. Both are laid out identically whichever answer
  we give — the row is `justify-between`, so the cluster is pinned to the right regardless of what
  the nav does — which is what keeps the measurement from chasing its own result.

  The nav's own width has to be remembered rather than read, because a hidden nav measures zero and
  would always "fit". It is cached from whenever the nav was last laid out, and the first layout
  effect always runs with the nav present, so there is always a real number to compare against. The
  reserve is the width of the menu button that replaces the nav plus a small margin — the geometry
  measured while the nav is shown is missing that button, so without the reserve the nav would fit,
  the button would appear, the row would shrink, and it would stop fitting again.
*/
const NAV_FIT_RESERVE = 42

function useNavFits() {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const clusterRef = useRef<HTMLDivElement | null>(null)
  const brandRef = useRef<HTMLAnchorElement | null>(null)
  /*
    Starts shown, on the server and on the client alike, so the first layout pass always has a nav
    to measure. `useLayoutEffect` runs before the browser paints, so a viewport that cannot hold it
    never actually shows it — this is a measuring position, not a flash.
  */
  const [fits, setFits] = useState(true)
  const naturalWidth = useRef(0)

  const measure = useCallback(() => {
    const nav = navRef.current
    const cluster = clusterRef.current
    const brand = brandRef.current
    if (!nav || !cluster || !brand) return
    // Only a laid-out nav has a width worth recording; a hidden one reports zero.
    if (nav.offsetParent !== null || nav.getClientRects().length > 0) {
      naturalWidth.current = Math.max(naturalWidth.current, nav.scrollWidth)
    }
    if (naturalWidth.current === 0) return
    const available =
      cluster.getBoundingClientRect().left - brand.getBoundingClientRect().right - NAV_FIT_RESERVE
    setFits(naturalWidth.current <= available)
  }, [])

  useLayoutEffect(() => {
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    // The cluster is observed as well as the row: it grows when the wallet connects and when the
    // network name resolves, neither of which changes the row's own size.
    for (const node of [rowRef.current, clusterRef.current]) if (node) observer.observe(node)
    return () => observer.disconnect()
  }, [measure])

  // The display face arrives after first paint and the tracked capitals get wider with it.
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (cancelled) return
      naturalWidth.current = 0
      measure()
    })
    return () => {
      cancelled = true
    }
  }, [measure])

  return { fits, rowRef, navRef, clusterRef, brandRef }
}

/**
 * Chrome for the signed-in product.
 *
 * Shares the landing page's palette, mark and pill navigation so the app reads as the product
 * behind that page rather than a second website. The faint grid runs under every screen for the
 * same reason it runs under the hero: it gives large dark areas something to sit on.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { account } = useSession()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { fits, rowRef, navRef, clusterRef, brandRef } = useNavFits()

  return (
    <div className="relative min-h-screen">
      <div className="vt-grid-fine vt-fade-b pointer-events-none fixed inset-0 opacity-60" aria-hidden />

      <header className="sticky top-0 z-40 bg-[#08080a]/75 backdrop-blur-xl">
        <div
          ref={rowRef}
          className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between gap-6 px-5 sm:px-8"
        >
          <div className="flex min-w-0 items-center gap-5">
            <Link ref={brandRef} href="/dashboard" className="shrink-0 transition-opacity hover:opacity-80">
              <VaultedWordmark />
            </Link>
            {/*
              Laid out either way so it can be measured; `hidden` when it does not fit, where the
              same links live in the menu instead. `sr-only` rather than unmounted would keep it in
              the accessibility tree twice, so it is genuinely hidden and the menu is the one copy.
            */}
            <nav
              ref={navRef}
              className={`items-center gap-0.5 ${fits ? 'flex' : 'hidden'}`}
              aria-label="Primary"
            >
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
                    className={`whitespace-nowrap rounded-full px-1.5 py-2 text-[10px] font-semibold uppercase tracking-[0.07em] transition-colors ${
                      active
                        ? 'bg-white/[0.08] text-foreground'
                        : 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          {/*
            The network used to sit here as a pill. It cost the primary navigation about 130px of a
            1320px row — enough that seven links could not fit beside it at any width — for a fact
            that does not change while you use the app and that every page states anyway. It now
            lives in the account menu, where the rest of the session's state already is.
          */}
          <div ref={clusterRef} className="flex shrink-0 items-center gap-2.5">
            <NotificationBell />
            <WalletBadge />
            <AccountChip />
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className={`rounded-full p-2 text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground ${
                fits ? 'hidden' : ''
              }`}
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {open && (
          <nav
            className={`border-t border-white/8 px-5 py-3 sm:px-8 ${fits ? 'hidden' : ''}`}
            aria-label="Primary mobile"
          >
            {[...NAV, { href: '/request', label: 'Raise an escrow' }, { href: '/inbox', label: 'To pay' }].map(
              (item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground"
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        )}
      </header>

      <main className="relative mx-auto max-w-[1320px] px-5 py-10 sm:px-8 lg:py-14">{children}</main>

      <footer className="relative mx-auto max-w-[1320px] px-5 pb-14 sm:px-8">
        <div className="vt-hairline" />
        <p className="pt-6 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Escrow is enforced by a smart contract · Vaulted never takes custody of your funds
          {account && (
            <>
              {' · '}
              <span className="normal-case">@{account.name}</span>
            </>
          )}
        </p>
      </footer>
    </div>
  )
}

function AccountChip() {
  const { account } = useSession()
  const { signOut } = useVaultedAuth()
  const config = useVaultedConfig()
  const [open, setOpen] = useState(false)
  if (!account) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-2 py-1.5 transition hover:border-white/25 hover:bg-white/[0.06]"
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
        <div className="vt-panel absolute right-0 z-50 mt-2 w-56 overflow-hidden bg-[#101014] shadow-2xl">
          <div className="border-b border-white/8 px-4 py-3.5">
            <p className="text-[13px] font-medium">@{account.name}</p>
            {account.displayName && <p className="text-[11.5px] text-muted-foreground">{account.displayName}</p>}
            {config && (
              <p className="mt-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: 'var(--vt-positive)', boxShadow: '0 0 0 3px rgba(52,211,153,0.15)' }}
                />
                {config.chain.name}
              </p>
            )}
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
              className="block px-4 py-2.5 text-[12.5px] text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 border-t border-white/8 px-4 py-2.5 text-left text-[12.5px] text-muted-foreground transition hover:bg-white/[0.05] hover:text-foreground"
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
      <h2 className="vt-editorial mt-4 text-[26px] uppercase">{what} needs the escrow contract</h2>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">{message}</p>
      <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
        Getting paid does not have to wait for it. A payment link settles by direct transfer on Base
        or Solana, with the transaction verified against the network before anything is marked paid.
      </p>
      <Link
        href="/payment-requests"
        className="mt-7 inline-flex h-12 items-center gap-2 rounded-full px-7 text-[14px] font-semibold text-[#08080a] transition-transform hover:-translate-y-0.5"
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
        <h1 className="vt-editorial mt-8 text-[clamp(1.8rem,5vw,2.6rem)] uppercase">Not deployed yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
        <p className="mt-6 text-xs text-muted-foreground">
          Nothing on this page is simulated. Until the escrow contract is deployed and configured,
          there is no chain state to show.
        </p>
      </div>
    </div>
  )
}
