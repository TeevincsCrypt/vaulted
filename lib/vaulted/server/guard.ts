import { redirect } from 'next/navigation'
import { currentAccount, type SessionAccount } from './accounts'

/**
 * Gate for pages that require an account.
 *
 * Enforced on the server, before anything renders, so a protected page cannot be reached by
 * disabling JavaScript or navigating client-side. Payment and receipt pages deliberately do not use
 * this — a client paying an invoice must never be required to create an account.
 */
export async function requirePage(): Promise<SessionAccount> {
  const account = await currentAccount().catch(() => null)
  if (!account) redirect('/login')
  return account
}
