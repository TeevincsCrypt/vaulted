'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Fades content in as it scrolls into view.
 *
 * Uses an IntersectionObserver rather than an animation library: it is a few lines, adds no
 * dependency, and degrades to "just show it" when the observer is unavailable or the viewer has
 * asked for reduced motion (handled in CSS).
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  delay?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'span'
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true)
            observer.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref as never}
      className={`vt-reveal ${className}`}
      data-shown={shown ? 'true' : 'false'}
      style={{ ['--vt-delay' as string]: `${delay}ms` }}
    >
      {children}
    </Tag>
  )
}
