import type { Metadata } from 'next'
import { Inbox } from '@/components/vaulted/inbox'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = { title: 'To pay — Vaulted' }
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <Inbox />
}
