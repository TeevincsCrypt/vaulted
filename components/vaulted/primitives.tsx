'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import type { Chain } from 'viem'
import { explorerAddressUrl, explorerTxUrl } from '@/lib/vaulted/chains'
import { shortAddress, shortHash } from '@/lib/vaulted/format'
import { STATUS_COPY, type DisplayStatus } from '@/lib/vaulted/status'

/** Shared building blocks for the Vaulted surface. Monochrome, quiet, high contrast. */

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
      className={`vt-eyebrow inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${className}`}
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
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all ' +
    'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-offset-2 focus-visible:ring-[var(--ring)]'
  const sizes = size === 'lg' ? 'h-13 px-6 text-[15px]' : 'h-11 px-4 text-sm'
  const variants = {
    primary:
      'bg-[var(--vt-accent)] text-[#08080a] font-semibold hover:brightness-110 active:brightness-95',
    secondary: 'border border-border bg-card text-foreground hover:bg-secondary',
    ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'border border-transparent text-[var(--vt-danger)] bg-[var(--vt-danger-soft)] hover:brightness-125',
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

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card ${className}`}
      style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 32px -20px rgba(0,0,0,0.9)' }}
    >
      {children}
    </div>
  )
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`vt-eyebrow text-muted-foreground ${className}`}>{children}</p>
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
    <div className="flex items-start justify-between gap-6 py-3">
      <span className="shrink-0 text-sm text-muted-foreground" title={hint}>
        {label}
      </span>
      <span className="min-w-0 text-right text-sm font-medium">{children}</span>
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
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        {optional && <span className="text-[11px] text-muted-foreground">Optional</span>}
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
  'w-full rounded-xl border border-input bg-card px-3.5 py-3 text-sm outline-none transition ' +
  'placeholder:text-muted-foreground/70 focus:border-foreground focus:ring-1 focus:ring-foreground'

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
  const palette = {
    neutral: { background: 'var(--muted)', color: 'var(--foreground)', border: 'var(--border)' },
    warn: { background: 'var(--vt-warning-soft)', color: 'var(--vt-warning)', border: 'transparent' },
    danger: { background: 'var(--vt-danger-soft)', color: 'var(--vt-danger)', border: 'transparent' },
    good: { background: 'var(--vt-positive-soft)', color: 'var(--vt-positive)', border: 'transparent' },
  }[tone]

  return (
    <div
      className="flex gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed"
      style={{ background: palette.background, color: palette.color, borderColor: palette.border }}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5 opacity-90' : 'opacity-90'}>{children}</div>
      </div>
    </div>
  )
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`h-px w-full bg-border ${className}`} />
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`vt-pulse rounded-lg bg-muted ${className}`} />
}

/** The X mark, used wherever sign-in is offered. Inherits colour so it works on any button. */
export function XLogo({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
}
