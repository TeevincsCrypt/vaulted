import { NextResponse } from 'next/server'
import { currentAccount } from '@/lib/vaulted/server/accounts'
import { isPrivyConfigured } from '@/lib/vaulted/server/privy'
import { hasAuthSecret } from '@/lib/vaulted/server/session'

/** GET /api/auth/session — who is signed in, and whether sign-in is even possible here. */
export async function GET() {
  const configured = isPrivyConfigured() && hasAuthSecret()
  try {
    const account = await currentAccount()
    return NextResponse.json({ account, authConfigured: configured })
  } catch {
    return NextResponse.json({ account: null, authConfigured: configured })
  }
}
