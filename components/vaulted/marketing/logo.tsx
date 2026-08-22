/**
 * The Vaulted mark: a downward chevron/vault shell around a padlock.
 *
 * Drawn as inline SVG using `currentColor`, so it inherits from whatever surface it sits on rather
 * than needing a light and a dark asset.
 */
export function VaultedLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="Vaulted"
    >
      {/* Outer vault shell — a shield that reads as a V. */}
      <path
        d="M6 12.5C6 11.1 7.1 10 8.5 10h47c1.4 0 2.5 1.1 2.5 2.5v8.8c0 .9-.3 1.7-.8 2.4L34.6 55.3c-1.3 1.7-3.9 1.7-5.2 0L6.8 23.7c-.5-.7-.8-1.5-.8-2.4v-8.8Z"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      {/* Inner bevel, echoing the facet in the source mark. */}
      <path
        d="M14.5 18.5h35L32 44.5 14.5 18.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.45"
      />
      {/* Padlock shackle. */}
      <path
        d="M26.2 25.5v-3.2a5.8 5.8 0 0 1 11.6 0v3.2"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      {/* Padlock body. */}
      <rect x="23.6" y="25.5" width="16.8" height="13.4" rx="3.4" fill="currentColor" />
      {/* Keyhole, punched out of the body. */}
      <circle cx="32" cy="31" r="2.3" fill="var(--vt-keyhole, #0a0a0b)" />
      <path d="M32 32.4 30.9 36.4h2.2L32 32.4Z" fill="var(--vt-keyhole, #0a0a0b)" />
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
