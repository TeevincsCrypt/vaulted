import { formatUnits, parseUnits } from 'viem'

/** Formats token base units for display. Never used for arithmetic — that stays in base units. */
export function formatAmount(baseUnits: bigint | string, decimals: number, maxFractionDigits = 2): string {
  const raw = BigInt(baseUnits)
  const value = formatUnits(raw, decimals)
  const [whole, fraction = ''] = value.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')

  /*
   * Never round a real amount away to nothing.
   *
   * Two decimal places suit a stablecoin and destroy a native one: 0.0002 ETH — a real escrow —
   * came out as plain "0", and said so on a release button and in the notification telling somebody
   * they had been paid. Reporting a payment as zero is worse than reporting no figure at all.
   *
   * So when the cutoff would erase the whole value, precision widens to the first couple of
   * significant digits instead. Amounts that survive the cutoff are unaffected, and this never
   * shortens anything — it only refuses to claim that something is nothing.
   */
  if (!trimmed && raw !== BigInt(0) && whole === '0') {
    const firstSignificant = fraction.search(/[1-9]/)
    if (firstSignificant >= 0) {
      trimmed = fraction.slice(0, firstSignificant + 2).replace(/0+$/, '')
    }
  }

  return trimmed ? `${grouped}.${trimmed}` : grouped
}

/** Exact string, no rounding — for confirmation screens where the precise figure matters. */
export function formatAmountExact(baseUnits: bigint | string, decimals: number): string {
  return formatUnits(BigInt(baseUnits), decimals)
}

export function parseAmount(input: string, decimals: number): bigint | null {
  const cleaned = input.trim().replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  try {
    const value = parseUnits(cleaned, decimals)
    return value > BigInt(0) ? value : null
  } catch {
    return null
  }
}

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return '—'
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—'
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`
}

const UNITS: [number, string][] = [
  [24 * 60 * 60, 'day'],
  [60 * 60, 'hour'],
  [60, 'minute'],
  [1, 'second'],
]

/** "2 days 4 hours", "45 minutes" — the two coarsest non-zero units. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 seconds'
  const parts: string[] = []
  let remaining = Math.floor(seconds)
  for (const [size, label] of UNITS) {
    const count = Math.floor(remaining / size)
    if (count > 0) {
      parts.push(`${count} ${label}${count === 1 ? '' : 's'}`)
      remaining -= count * size
    }
    if (parts.length === 2) break
  }
  return parts.join(' ')
}

/** "23:59:04" — a live countdown, so the client can see the protection window closing. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':')
}

export function formatTimestamp(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—'
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export const PROTECTION_PERIOD_PRESETS = [
  { label: '1 hour', seconds: 60 * 60 },
  { label: '12 hours', seconds: 12 * 60 * 60 },
  { label: '24 hours', seconds: 24 * 60 * 60 },
  { label: '3 days', seconds: 3 * 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { label: '30 days', seconds: 30 * 24 * 60 * 60 },
]
