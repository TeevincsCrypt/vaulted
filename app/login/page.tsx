import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LoginPage } from '@/components/vaulted/login'
import { currentAccount } from '@/lib/vaulted/server/accounts'

export const metadata: Metadata = { title: 'Sign in — Vaulted' }
export const dynamic = 'force-dynamic'

export default async function Page() {
  const account = await currentAccount().catch(() => null)
  if (account) redirect('/dashboard')
  return <LoginPage />
}
