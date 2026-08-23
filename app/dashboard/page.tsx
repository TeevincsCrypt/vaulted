import type { Metadata } from 'next'
import { requirePage } from '@/lib/vaulted/server/guard'
import { Workspace } from '@/components/vaulted/pages'

export const metadata: Metadata = {
  title: 'Dashboard — Vaulted',
  description: 'Your vaults, their live escrow state, and the actions available to you.',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  await requirePage()
  return <Workspace />
}
