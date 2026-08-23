import { NextResponse } from 'next/server'
import { currentAccount } from '@/lib/vaulted/server/accounts'
import { listNotifications, markAllRead, unreadCount } from '@/lib/vaulted/server/notifications'

/** GET /api/notifications — the signed-in account's notifications. */
export async function GET() {
  const account = await currentAccount()
  if (!account) return NextResponse.json({ notifications: [], unread: 0, signedIn: false })

  const [notifications, unread] = await Promise.all([
    listNotifications(account.id),
    unreadCount(account.id),
  ])

  return NextResponse.json({
    signedIn: true,
    unread,
    notifications: notifications.map((entry) => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      body: entry.body,
      href: entry.href,
      read: entry.readAt !== null,
      createdAt: entry.createdAt.toISOString(),
    })),
  })
}

/** POST /api/notifications — mark everything read. */
export async function POST() {
  const account = await currentAccount()
  if (!account) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  await markAllRead(account.id)
  return NextResponse.json({ ok: true })
}
