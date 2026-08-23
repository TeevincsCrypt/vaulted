import type { Metadata } from 'next'
import { Settings } from '@/components/vaulted/settings'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = { title: 'Wallets — Vaulted' }
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <Settings />
}
