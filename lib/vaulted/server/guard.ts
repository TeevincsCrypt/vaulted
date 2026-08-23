import { redirect } from 'next/navigation'
import { currentAccount, type SessionAccount } from './accounts'

/**
 * Gate for pages that require an account.
 *
 * Enforced on the server, before anything renders, so a protected page cannot be reached by
 * disabling JavaScript or navigating client-side.
 *
 * Payment and receipt pages deliberately do not use this: anyone with the link can read the escrow
 * state without an account. Actually funding one is a different matter — signing needs a wallet,
 * and since wallets now come with the account, the pay button asks the client to sign in. That is
 * a real cost of the embedded-wallet model and the pay page says so rather than hiding it behind a
 * button that cannot work.
 */
export async function requirePage(): Promise<SessionAccount> {
  const account = await currentAccount().catch(() => null)
  if (!account) redirect('/login')
  return account
}
