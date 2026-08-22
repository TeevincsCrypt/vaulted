import type { Metadata } from 'next'
import { Workspace } from '@/components/vaulted/pages'

export const metadata: Metadata = {
  title: 'Dashboard — Vaulted',
  description: 'Your vaults, their live escrow state, and the actions available to you.',
}

export default function Page() {
  return <Workspace />
}
