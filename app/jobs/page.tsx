import type { Metadata } from 'next'
import { JobsBoard } from '@/components/vaulted/jobs'

export const metadata: Metadata = {
  title: 'Jobs — Vaulted',
  description: 'Open work posted on Vaulted, with budgets secured by on-chain escrow.',
}

export default function Page() {
  return <JobsBoard />
}
