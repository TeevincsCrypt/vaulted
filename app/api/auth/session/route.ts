import { NextResponse } from 'next/server'
import { currentAccount } from '@/lib/vaulted/server/accounts'
import { hasAuthSecret } from '@/lib/vaulted/server/session'
import { isTwitterConfigured } from '@/lib/vaulted/server/twitter'

/** GET /api/auth/session — who is signed in, and whether sign-in is even possible here. */
export async function GET() {
  const configured = isTwitterConfigured() && hasAuthSecret()
  try {
    const account = await currentAccount()
    return NextResponse.json({ account, authConfigured: configured })
  } catch {
    return NextResponse.json({ account: null, authConfigured: configured })
  }
}
