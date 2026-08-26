'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Lock } from 'lucide-react'
import { availabilityLabel, VAULTED_CHAINS, type VaultedChain } from '@/lib/vaulted/registry'

/**
 * Network picker.
 *
 * Every row's state comes from the registry, which derives availability from whether a deployment
 * record exists. A chain the caller's job cannot be done on is rendered disabled and cannot be
 * selected — the UI has no way to put the app into a state the chain would reject.
 *
 * What counts as selectable depends on what is being picked for. `escrow` is the strict reading:
 * only a chain with a deployed contract. `transfer` is the one for anything that just moves a
 * token — a payment link, a job budget — and it includes networks like Solana that can plainly
 * send USDC today but hold no escrow.
 */
export function ChainSelector({
  value,
  onChange,
  capability = 'escrow',
  className = '',
}: {
  value: string | null
  onChange?: (chainKey: string) => void
  /** What the selected chain has to be able to do. Defaults to the strict escrow reading. */
  capability?: 'escrow' | 'transfer'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const usable = (chain: VaultedChain) =>
    capability === 'escrow' ? chain.capabilities.escrow : chain.capabilities.transfer

  const selected = VAULTED_CHAINS.find((chain) => chain.key === value) ?? null
  const live = VAULTED_CHAINS.filter(usable)
  const planned = VAULTED_CHAINS.filter((chain) => !usable(chain))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-full border border-white/12 bg-white/[0.03] px-4 text-left text-[13.5px] transition hover:border-white/25 hover:bg-white/[0.06]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Dot live={Boolean(selected && usable(selected))} />
          <span className="truncate font-medium">{selected ? selected.shortName : 'Select network'}</span>
          {selected && (
            <span className="shrink-0 text-[11px] text-muted-foreground">{availabilityLabel(selected)}</span>
          )}
        </span>
        <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="vt-panel absolute left-0 right-0 z-50 mt-2 overflow-hidden bg-[#101014] shadow-2xl"
        >
          <Group label="Available">
            {live.length === 0 && (
              <p className="px-3.5 py-3 text-[12.5px] text-muted-foreground">
                {capability === 'escrow'
                  ? 'No network has a deployed escrow yet.'
                  : 'No network can move a token in this deployment.'}
              </p>
            )}
            {live.map((chain) => (
              <Row
                key={chain.key}
                chain={chain}
                usable
                selected={chain.key === value}
                onSelect={() => {
                  onChange?.(chain.key)
                  setOpen(false)
                }}
              />
            ))}
          </Group>

          {planned.length > 0 && (
            <Group label="Planned">
              {planned.map((chain) => (
                <Row key={chain.key} chain={chain} usable={false} selected={false} />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/8 last:border-b-0">
      <p className="vt-eyebrow px-3.5 pb-1.5 pt-3 text-muted-foreground">{label}</p>
      <div className="pb-1.5">{children}</div>
    </div>
  )
}

function Row({
  chain,
  usable,
  selected,
  onSelect,
}: {
  chain: VaultedChain
  /** Whether this chain can do what the picker is picking for. */
  usable: boolean
  selected: boolean
  /** Absent for chains that are not usable — those rows are not selectable at all. */
  onSelect?: () => void
}) {
  const live = usable
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={!live}
      onClick={onSelect}
      title={!live ? (chain.note ?? 'Not available yet') : undefined}
      className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition ${
        live ? 'hover:bg-white/[0.05]' : 'cursor-not-allowed opacity-55'
      }`}
    >
      <Dot live={live} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{chain.shortName}</span>
        <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
          {availabilityLabel(chain)}
          {chain.network === 'testnet' ? ` · ${chain.name}` : ''}
        </span>
      </span>
      {selected && <Check size={15} style={{ color: 'var(--vt-positive)' }} />}
      {!live && <Lock size={13} className="text-muted-foreground" />}
    </button>
  )
}

function Dot({ live }: { live: boolean }) {
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={
        live
          ? { background: 'var(--vt-positive)' }
          : { border: '1.5px solid var(--muted-foreground)', opacity: 0.5 }
      }
    />
  )
}
