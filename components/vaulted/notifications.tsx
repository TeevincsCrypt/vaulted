'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, Briefcase, CheckCheck, FileCheck2, Loader2, RefreshCw, Send, UserPlus, Wallet } from 'lucide-react'
import { useSession } from './session-provider'

type Item = {
  id: string
  type: string
  title: string
  body: string
  href: string | null
  read: boolean
  createdAt: string
}

const ICON: Record<string, typeof Bell> = {
  JOB_POSTED: Briefcase,
  JOB_APPLICATION: UserPlus,
  JOB_HIRED: CheckCheck,
  JOB_DECLINED: Bell,
  WORK_SUBMITTED: FileCheck2,
  PAYMENT_REQUESTED: Send,
  PAYMENT_FUNDED: Wallet,
  PAYMENT_RELEASED: CheckCheck,
  PAYMENT_DISPUTED: Bell,
  PAYMENT_REFUNDED: Wallet,
}

/** Notification bell. Polls while signed in; there is no websocket, and none is claimed. */
export function NotificationBell() {
  const { account } = useSession()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    if (!account) return
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' })
      const body = await response.json()
      setItems(body.notifications ?? [])
      setUnread(body.unread ?? 0)
    } catch {
      /* A failed poll should not surface as an error; the next one will refresh. */
    }
  }, [account])

  useEffect(() => {
    if (!account) return
    void load()
    const timer = setInterval(load, 30_000)

    /*
      A poll alone leaves a gap that is exactly the shape of the complaint: come back to a tab that
      has been sitting in the background and the badge is up to half a minute stale, or older still
      if the browser throttled the timer — which background tabs routinely do. Checking on focus
      means the answer is current by the time anybody is actually looking at it.
    */
    const onFocus = () => void load()
    const onVisible = () => document.visibilityState === 'visible' && void load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [account, load])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  async function refresh() {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  if (!account) return null

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      await fetch('/api/notifications', { method: 'POST' })
      setUnread(0)
      setItems((current) => current.map((item) => ({ ...item, read: true })))
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span
            className="absolute right-1 top-1 flex min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-[#08080a]"
            style={{ background: 'var(--vt-accent)' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[330px] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="vt-eyebrow text-muted-foreground">Notifications</p>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {refreshing ? <Loader2 size={12} className="vt-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="max-h-[380px] overflow-y-auto">
              {items.map((item) => {
                const Icon = ICON[item.type] ?? Bell
                const content = (
                  <span className="flex gap-3 px-4 py-3 transition hover:bg-muted">
                    <Icon size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--vt-accent)' }} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{item.body}</span>
                      <span className="mt-1 block text-[10.5px] text-muted-foreground/70">
                        {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </span>
                  </span>
                )
                return (
                  <li key={item.id} className="border-b border-border last:border-b-0">
                    {item.href ? (
                      <Link href={item.href} onClick={() => setOpen(false)} className="block">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
