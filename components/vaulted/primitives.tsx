'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import type { Chain } from 'viem'
import { explorerAddressUrl, explorerTxUrl } from '@/lib/vaulted/chains'
import { shortAddress, shortHash } from '@/lib/vaulted/format'
import { STATUS_COPY, type DisplayStatus } from '@/lib/vaulted/status'

/**
 * Shared building blocks for the Vaulted surface.
 *
 * These carry the same language as the marketing page — bezelled panels, hairline rules, uppercase
 * micro-type for labels and status — so the app reads as the product behind that page rather than a
 * different website. Where the two deliberately diverge is register: the landing page sets its
 * labels in tracked capitals for effect, and this surface keeps running text and button labels in
 * sentence case, because these screens are read while somebody is moving money and legibility beats
 * atmosphere every time.
 *
 * Every component's props are unchanged. This is a reskin of the vocabulary, not a new API, so no
 * screen had to be rewritten to adopt it.
 */

const TONE_STYLE: Record<string, { background: string; color: string }> = {
  neutral: { background: 'var(--muted)', color: 'var(--muted-foreground)' },
  live: { background: 'var(--vt-live-soft)', color: 'var(--vt-live)' },
  warn: { background: 'var(--vt-warning-soft)', color: 'var(--vt-warning)' },
  good: { background: 'var(--vt-positive-soft)', color: 'var(--vt-positive)' },
  muted: { background: 'var(--muted)', color: 'var(--muted-foreground)' },
}

export function StatusPill({ status, className = '' }: { status: DisplayStatus; className?: string }) {
  const copy = STATUS_COPY[status]
  const tone = TONE_STYLE[copy.tone]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${className}`}
      style={tone}
      title={copy.detail}
    >
      <span className="size-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {copy.label}
    </span>
  )
}

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'lg'
  disabled?: boolean
  busy?: boolean
  full?: boolean
  className?: string
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled,
  busy,
  full,
  className = '',
}: ButtonProps) {
  /*
    Pill geometry, matching the landing page's calls to action. The lift on hover is the same
    gesture too — small enough to feel like a physical control rather than a bouncing one, and it
    disappears with the disabled state so a dead button never invites a click.
  */
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-[var(--background)] focus-visible:ring-[var(--ring)]'
  const sizes = size === 'lg' ? 'h-13 px-7 text-[14.5px]' : 'h-11 px-5 text-[13.5px]'
  const variants = {
    primary:
      'bg-[var(--vt-accent)] text-[#08080a] font-semibold hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0',
    secondary:
      'border border-white/12 bg-white/[0.03] text-foreground hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06]',
    ghost: 'text-muted-foreground hover:bg-white/[0.05] hover:text-foreground',
    danger:
      'border border-[var(--vt-danger)]/25 text-[var(--vt-danger)] bg-[var(--vt-danger-soft)] hover:-translate-y-0.5 hover:brightness-125',
  }[variant]

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={`${base} ${sizes} ${variants} ${full ? 'w-full' : ''} ${className}`}
    >
      {busy && <Loader2 size={16} className="vt-spin" />}
      {children}
    </button>
  )
}

/*
  The same bezelled panel the marketing surface uses: a hairline lip catching light along the top
  edge over a surface barely lifted off the page. It reads as a machined object rather than a
  bordered box, which is what stops a screen full of them looking like a wall of cards.
*/
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`vt-panel ${className}`}
      style={{ boxShadow: '0 18px 40px -28px rgba(0,0,0,0.95)' }}
    >
      {children}
    </div>
  )
}

/** Section label. Carries the marker dot that anchors a section on the landing page. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`vt-marker text-muted-foreground ${className}`}>{children}</p>
}

/** Label/value row. The workhorse of both the invoice summary and the escrow detail panel. */
export function DetailRow({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <span
        className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"
        title={hint}
      >
        {label}
      </span>
      <span className="min-w-0 text-right text-[13.5px] font-medium">{children}</span>
    </div>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          /* Clipboard is unavailable in some browser contexts; the value stays selectable. */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
      aria-label={label}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function AddressChip({
  address,
  chain,
  size = 4,
}: {
  address: string | null | undefined
  chain?: Chain | null
  size?: number
}) {
  if (!address) return <span className="text-muted-foreground">—</span>
  const url = chain ? explorerAddressUrl(chain, address) : null
  const text = <span className="font-mono text-[13px]">{shortAddress(address, size)}</span>
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 hover:underline"
      title={address}
    >
      {text}
      <ExternalLink size={11} className="opacity-50" />
    </a>
  ) : (
    <span title={address}>{text}</span>
  )
}

/** A real transaction hash with a real explorer link. Never rendered for a transaction we invented. */
export function TxHashLink({ hash, chain, label }: { hash: string; chain: Chain | null; label?: string }) {
  const url = explorerTxUrl(chain, hash)
  const body = (
    <>
      <span className="font-mono text-[12px]">{shortHash(hash)}</span>
      {url && <ExternalLink size={11} className="opacity-50" />}
    </>
  )
  return (
    <span className="inline-flex items-center gap-2">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
          {body}
        </a>
      ) : (
        <span className="inline-flex items-center gap-1" title={hash}>
          {body}
        </span>
      )}
    </span>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
  optional?: boolean
}) {
  return (
    <label className="block">
      {/*
        Field labels in the same tracked caps as every other label in the product. They were the one
        place still set in sentence case, which made a form look like it had been dropped in from a
        different application than the panel around it.
      */}
      <span className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em]">{label}</span>
        {optional && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Optional
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs" style={{ color: 'var(--vt-danger)' }}>
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3.5 text-[14px] outline-none transition ' +
  'placeholder:text-muted-foreground/60 hover:border-white/20 ' +
  'focus:border-[var(--vt-accent)] focus:bg-black/40 focus:ring-1 focus:ring-[var(--vt-accent)]/40'

export function Notice({
  tone = 'neutral',
  title,
  children,
  icon,
}: {
  tone?: 'neutral' | 'warn' | 'danger' | 'good'
  title?: string
  children: ReactNode
  icon?: ReactNode
}) {
  /*
    A tinted wash with a solid rule down the leading edge, rather than a filled block. At the
    densities these screens run at, a stack of saturated boxes turns every message into an alarm —
    the rule keeps the tone legible while letting the surrounding page stay calm.
  */
  const palette = {
    neutral: { background: 'rgba(255,255,255,0.035)', color: 'var(--foreground)', rule: 'rgba(255,255,255,0.22)' },
    warn: { background: 'var(--vt-warning-soft)', color: 'var(--vt-warning)', rule: 'var(--vt-warning)' },
    danger: { background: 'var(--vt-danger-soft)', color: 'var(--vt-danger)', rule: 'var(--vt-danger)' },
    good: { background: 'var(--vt-positive-soft)', color: 'var(--vt-positive)', rule: 'var(--vt-positive)' },
  }[tone]

  return (
    <div
      className="flex gap-3 rounded-r-xl py-3.5 pl-4 pr-4 text-[13px] leading-relaxed"
      style={{
        background: palette.background,
        color: palette.color,
        borderLeft: `2px solid ${palette.rule}`,
      }}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="text-[10.5px] font-semibold uppercase tracking-[0.13em]">{title}</p>}
        <div className={title ? 'mt-1.5 opacity-90' : 'opacity-90'}>{children}</div>
      </div>
    </div>
  )
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`vt-hairline w-full ${className}`} />
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`vt-pulse rounded-lg bg-white/[0.055] ${className}`} />
}

/** The X mark, used wherever sign-in is offered. Inherits colour so it works on any button. */
export function XLogo({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
}

/* ------------------------------------------------------- page vocabulary */

/*
  Every screen was opening with its own hand-rolled heading block, which is why no two of them
  agreed on type size or spacing. One component, so they do.
*/
export function PageHeader({
  eyebrow,
  title,
  body,
  actions,
}: {
  eyebrow?: string
  title: string
  body?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className={`vt-editorial text-[clamp(1.9rem,4vw,2.7rem)] uppercase ${eyebrow ? 'mt-4' : ''}`}>
          {title}
        </h1>
        {body && <div className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">{body}</div>}
      </div>
      {/*
        Page-level controls sit level with the eyebrow, not with the bottom of the body copy — an
        `items-end` row dropped them a long way from the title whenever the description ran to two
        lines, and they stopped reading as controls for this page.
      */}
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5 sm:pt-1">{actions}</div>}
    </div>
  )
}

/** A figure worth reading at a glance: the label small and tracked, the number large and tabular. */
export function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  accent?: boolean
}) {
  return (
    <div className="vt-panel p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p
        className="vt-numeric vt-editorial mt-4 text-[clamp(1.5rem,3vw,2rem)] leading-none"
        style={accent ? { color: 'var(--vt-accent)' } : undefined}
      >
        {value}
      </p>
      {note && <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  )
}

/*
  Where an escrow is in its life, as a track rather than a word.

  A status pill says what the state is; this says what it is *out of*, which is the question
  somebody actually has when money of theirs is sitting in a contract. Steps already passed are
  filled, the current one is marked, and the rest are drawn but dim — so the remaining distance is
  visible rather than implied.

  Purely presentational: the caller decides which step is current from its own live chain read, and
  a terminal state that is not "released" is passed as its own final label rather than being forced
  into this happy path.
*/
export function StateTrack({
  steps,
  current,
  terminal,
}: {
  steps: string[]
  /** Index of the step the escrow is on. Negative when it has not reached the first one. */
  current: number
  /** Overrides the last step's label when the escrow ended somewhere other than the happy path. */
  terminal?: { label: string; tone: 'good' | 'warn' | 'danger' } | null
}) {
  const toneColour = terminal
    ? { good: 'var(--vt-positive)', warn: 'var(--vt-warning)', danger: 'var(--vt-danger)' }[terminal.tone]
    : 'var(--vt-accent)'

  return (
    <ol className="flex w-full items-start gap-1.5">
      {steps.map((step, index) => {
        const done = index < current
        const active = index === current
        const isLast = index === steps.length - 1
        const label = isLast && terminal ? terminal.label : step
        return (
          <li key={step} className="min-w-0 flex-1">
            <div
              className="h-[3px] w-full rounded-full transition-colors"
              style={{
                background: done || active ? toneColour : 'rgba(255,255,255,0.1)',
                opacity: done ? 0.5 : 1,
              }}
            />
            <p
              className="mt-2.5 truncate text-[10px] font-semibold uppercase tracking-[0.13em]"
              style={{
                color: active ? toneColour : done ? 'var(--muted-foreground)' : 'rgba(255,255,255,0.28)',
              }}
              title={label}
            >
              {label}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

/*
  Nothing here yet, said without making it feel like a failure. An empty list is the normal state of
  a new account, so it gets the same panel treatment as a full one rather than a dashed outline.
*/
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <Card className="flex flex-col items-center gap-3 px-7 py-16 text-center">
      {icon && <span className="text-muted-foreground/50">{icon}</span>}
      <p className="vt-editorial text-[19px] uppercase">{title}</p>
      {body && <p className="max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

/*
  A choice you can toggle: the network's asset, a protection window, a filter.

  These existed as three separately hand-written buttons that had drifted apart — different radii,
  different type, different selected treatment — so picking a protection window looked like a
  different product from picking a filter. One shape, one selected state, everywhere.
*/
export function Chip({
  children,
  selected,
  disabled,
  onClick,
  count,
}: {
  children: ReactNode
  selected: boolean
  disabled?: boolean
  onClick: () => void
  /** Shown dimmed after the label — for filters that say how much is behind them. */
  count?: number
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition disabled:opacity-50 ${
        selected
          ? 'bg-[var(--vt-accent)] text-[#08080a]'
          : 'border border-white/12 text-muted-foreground hover:border-white/25 hover:bg-white/[0.05]'
      }`}
    >
      {children}
      {typeof count === 'number' && <span className="ml-1.5 opacity-60">{count}</span>}
    </button>
  )
}
