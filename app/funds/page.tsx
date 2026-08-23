import type { Metadata } from 'next'
import { Funds } from '@/components/vaulted/funds'
import { requirePage } from '@/lib/vaulted/server/guard'

export const metadata: Metadata = { title: 'Funds — Vaulted' }
export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <Funds />
}
