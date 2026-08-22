'use client'

import { ArrowDown, Lock } from 'lucide-react'

/**
 * The hero diagram: money into the vault, work out, money on to the freelancer.
 *
 * The figures are illustrative of the mechanic, not a claim about volume — deliberately a round
 * "500 USDC" example rather than anything that could read as a real statistic.
 */
export function EscrowFlow() {
  return (
    <div className="vt-glass relative mx-auto w-full max-w-[380px] rounded-2xl p-6 sm:p-7">
      <p className="vt-eyebrow text-center text-muted-foreground">Example flow</p>

      <div className="mt-5 flex flex-col items-center gap-3">
        <Node label="Client" sub="funds the vault" />
        <Amount />
        <Vault />
        <Step label="Work delivered" />
        <Amount />
        <Node label="Freelancer" sub="gets paid" accent />
      </div>
    </div>
  )
}

function Node({ label, sub, accent }: { label: string; sub: string; accent?: boolean }) {
  return (
    <div
      className="w-full rounded-xl border px-4 py-3 text-center"
      style={{
        borderColor: accent ? 'var(--vt-accent-dim)' : 'var(--border)',
        background: accent ? 'var(--vt-accent-dim)' : 'var(--muted)',
      }}
    >
      <p className="text-sm font-semibold" style={accent ? { color: 'var(--vt-accent)' } : undefined}>
        {label}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

function Amount() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <ArrowDown size={14} className="text-muted-foreground/60 vt-flow-pulse" />
      <span className="vt-numeric rounded-full border border-border bg-card px-3 py-1 text-[13px] font-medium">
        500 USDC
      </span>
      <ArrowDown size={14} className="text-muted-foreground/60 vt-flow-pulse" />
    </div>
  )
}

function Vault() {
  return (
    <div
      className="flex w-full items-center justify-center gap-2.5 rounded-xl px-4 py-4"
      style={{ background: 'var(--vt-accent-dim)', border: '1px solid rgba(255,138,0,0.28)' }}
    >
      <Lock size={16} style={{ color: 'var(--vt-accent)' }} />
      <span className="vt-eyebrow tracking-[0.2em]" style={{ color: 'var(--vt-accent)' }}>
        Vaulted
      </span>
    </div>
  )
}

function Step({ label }: { label: string }) {
  return (
    <div className="flex w-full items-center gap-3">
      <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
    </div>
  )
}
