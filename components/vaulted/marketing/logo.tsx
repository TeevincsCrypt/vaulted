/**
 * The Vaulted mark: a faceted downward-pointing vault shell with a padlock at its centre.
 *
 * Drawn as inline SVG on `currentColor`, so one asset works on any surface. The keyhole is punched
 * with `--vt-keyhole` (the page background) rather than a hardcoded colour, so it stays a hole.
 */
export function VaultedLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className} role="img" aria-label="Vaulted">
      {/* Outer shell: a broad chevron that reads as a V, clipped flat across the top. */}
      <path
        d="M8 20.5 A2.5 2.5 0 0 1 10.5 18h99A2.5 2.5 0 0 1 112 20.5v14.2a5 5 0 0 1-.9 2.9L64.4 104a5.4 5.4 0 0 1-8.8 0L8.9 37.6a5 5 0 0 1-.9-2.9V20.5Z"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinejoin="round"
      />
      {/* Inner facet, following the shell and giving the mark its cut-gem depth. */}
      <path
        d="M21 31.5h78L60 88 21 31.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.5"
      />
      {/* Faint geometry in the lower-right quadrant, echoing the source mark's mesh. */}
      <g stroke="currentColor" strokeWidth="1" opacity="0.3">
        <path d="M99 31.5 78 62l-18 26M78 62l21-30.5M60 88l18-26 21 .5" />
        <path d="M21 31.5 42 62l18 26M42 62 21 31.5M60 88 42 62l-21 .5" />
      </g>
      {/* Padlock shackle. */}
      <path d="M47 47v-6.5a13 13 0 0 1 26 0V47" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
      {/* Padlock body. */}
      <rect x="41.5" y="47" width="37" height="29" rx="7" fill="currentColor" />
      {/* Keyhole, punched out. */}
      <circle cx="60" cy="59" r="5" fill="var(--vt-keyhole, #08080a)" />
      <path d="M60 62.5 57.6 71h4.8L60 62.5Z" fill="var(--vt-keyhole, #08080a)" />
    </svg>
  )
}

export function VaultedWordmark({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <VaultedLogo size={size} />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Vaulted</span>
    </span>
  )
}
