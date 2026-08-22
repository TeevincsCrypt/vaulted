import type { Metadata } from 'next'
import { Landing } from '@/components/vaulted/marketing/landing'

export const metadata: Metadata = {
  title: 'Vaulted — the trust layer for Web3 work',
  description:
    'Hire people. Secure the money. Get the work done. Programmable on-chain escrow for freelancers, creators, sponsors, developers and Web3 teams.',
}

export default function Page() {
  return <Landing />
}
