'use client'

/**
 * The vault.
 *
 * A recurring visual motif rather than an illustration used once. It is drawn rather than
 * photographed or imported: an SVG costs nothing to ship, scales to any viewport without a second
 * asset, recolours itself from the same tokens as everything else, and can be animated with CSS
 * that already respects the reduced-motion preference.
 *
 * What it depicts is the actual mechanism, not a bank vault: value enters from the payer, is held
 * by a contract at the centre for a bounded window, and leaves to the payee. The concentric rings
 * are the protection window closing. Anyone who understands the product should recognise it, and
 * anyone who does not should still read it as something engineered.
 */
export function VaultVisual({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 520"
      className={className}
      role="img"
      aria-label="An escrow holding value between a payer and a payee"
    >
      <defs>
        <radialGradient id="vv-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--vt-accent)" stopOpacity="0.85" />
          <stop offset="55%" stopColor="var(--vt-accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--vt-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="vv-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
          <stop offset="45%" stopColor="rgba(255,255,255,0.09)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.28)" />
        </linearGradient>
        <linearGradient id="vv-path" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--vt-accent)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--vt-accent)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--vt-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Ambient bloom behind the held amount. */}
      <circle cx="260" cy="260" r="150" fill="url(#vv-core)" className="vt-breathe" />

      {/* The protection window, drawn as rings tightening toward settlement. */}
      {[210, 176, 142].map((r, index) => (
        <circle
          key={r}
          cx="260"
          cy="260"
          r={r}
          fill="none"
          stroke="url(#vv-ring)"
          strokeWidth={index === 0 ? 1 : 0.75}
          strokeDasharray={index === 1 ? '2 7' : undefined}
          opacity={0.9 - index * 0.18}
        />
      ))}

      {/* Aperture leaves. Eight segments, the shape a vault door makes as it closes. */}
      <g opacity="0.55">
        {Array.from({ length: 8 }, (_, index) => {
          const angle = (index * Math.PI * 2) / 8
          const inner = 104
          const outer = 138
          return (
            <line
              key={index}
              x1={260 + Math.cos(angle) * inner}
              y1={260 + Math.sin(angle) * inner}
              x2={260 + Math.cos(angle) * outer}
              y2={260 + Math.sin(angle) * outer}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
            />
          )
        })}
      </g>

      {/* The held amount itself. */}
      <circle cx="260" cy="260" r="100" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.16)" />
      <circle cx="260" cy="260" r="72" fill="none" stroke="var(--vt-accent)" strokeOpacity="0.5" strokeWidth="1.25" />

      {/* Keyhole, at the centre, punched out. */}
      <g fill="var(--vt-accent)" opacity="0.9">
        <circle cx="260" cy="248" r="13" />
        <path d="M253 258 L267 258 L271 288 L249 288 Z" />
      </g>

      {/* Value in, value out. The two nodes an escrow is always between. */}
      <path
        d="M18 118 L128 118 Q160 118 160 150 L160 238"
        fill="none"
        stroke="url(#vv-path)"
        strokeWidth="1.5"
      />
      <path
        d="M502 402 L392 402 Q360 402 360 370 L360 282"
        fill="none"
        stroke="url(#vv-path)"
        strokeWidth="1.5"
      />

      <NodeLabel x={18} y={118} label="PAYER" anchor="start" />
      <NodeLabel x={502} y={402} label="PAYEE" anchor="end" />

      {/* Corner ticks. Technical framing rather than a border. */}
      <g stroke="rgba(255,255,255,0.22)" strokeWidth="1" fill="none">
        <path d="M14 52 L14 22 L44 22" />
        <path d="M506 468 L506 498 L476 498" />
      </g>
    </svg>
  )
}

function NodeLabel({
  x,
  y,
  label,
  anchor,
}: {
  x: number
  y: number
  label: string
  anchor: 'start' | 'end'
}) {
  return (
    <>
      <circle cx={x + (anchor === 'start' ? 4 : -4)} cy={y} r="3.5" fill="var(--vt-accent)" />
      <text
        x={x + (anchor === 'start' ? 16 : -16)}
        y={y - 12}
        textAnchor={anchor}
        fill="rgba(255,255,255,0.5)"
        style={{ fontSize: 10, letterSpacing: '0.18em', fontWeight: 600 }}
      >
        {label}
      </text>
    </>
  )
}

/**
 * A compact mark of the same object, for places that need the motif at a glance — a section
 * corner, a stat panel, the final call to action. Same geometry, fewer elements, so the two read
 * as one family rather than two drawings.
 */
export function VaultMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden>
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeOpacity="0.28" />
      <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeDasharray="2 5" />
      <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeOpacity="0.75" />
      <circle cx="24" cy="21.5" r="3" fill="currentColor" />
      <path d="M22.4 24 L25.6 24 L26.6 31 L21.4 31 Z" fill="currentColor" />
    </svg>
  )
}
