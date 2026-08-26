'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { PRIVY_APP_ID_MALFORMED } from '@/lib/vaulted/privy'
import { useVaultedAuth } from './auth-provider'
import { useSession } from './session-provider'
import { VaultedWordmark } from './marketing/logo'
import { Button, Card, Notice, XLogo } from './primitives'

/**
 * Sign-in.
 *
 * One step, not two: X identifies you and the same step provisions the wallet you get paid into.
 * Nothing here fakes progress — while the deployment has no Privy app id, the page says so instead
 * of showing a button that cannot work.
 */
export function LoginPage({ next }: { next?: string }) {
  const router = useRouter()
  const { account } = useSession()
  const { configured, ready, signIn, syncing, error, walletPending } = useVaultedAuth()

  useEffect(() => {
    if (account) router.replace(next ?? '/dashboard')
  }, [account, next, router])

  return (
    <div className="vt-canvas flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-[400px]">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Back
        </Link>

        <Card className="p-8 text-center">
          <VaultedWordmark className="justify-center" size={34} />
          <h1 className="vt-editorial mt-7 text-[24px] uppercase">Sign in to Vaulted</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
            Your X handle becomes your Vaulted username, so clients can pay{' '}
            <span className="font-medium">@you</span> instead of an address — and the same step
            gives the account its wallet.
          </p>

          {error && (
            <div className="mt-5 text-left">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}

          {!configured && (
            <div className="mt-5 text-left">
              <Notice tone="warn" title="Sign-in is not configured">
                {PRIVY_APP_ID_MALFORMED
                  ? 'NEXT_PUBLIC_PRIVY_APP_ID is set but is not a Privy app id — they are exactly 25 characters. Correct it and rebuild.'
                  : 'This deployment has no Privy app id set, so there is nothing to sign in to yet. See the README for the variables it needs.'}
              </Notice>
            </div>
          )}

          {walletPending && (
            <div className="mt-5 text-left">
              <Notice tone="warn" title="Creating your wallet">
                You are signed in with X. Privy is provisioning the account&rsquo;s wallet now.
              </Notice>
            </div>
          )}

          <div className="mt-6">
            <Button size="lg" full busy={!ready || syncing} onClick={signIn} disabled={!configured}>
              <XLogo />
              Continue with X
            </Button>
          </div>

          <p className="mt-5 flex items-start gap-2 text-left text-[11.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            Your wallet&rsquo;s key is split between a secure enclave and your device by Privy.
            Vaulted holds no part of it and cannot move your funds — only you can, by approving each
            transaction.
          </p>
        </Card>

        <p className="mt-5 text-center text-[12px] text-muted-foreground">
          Paying an invoice? You still need an account to sign the transaction —{' '}
          <span className="text-foreground">signing in takes one step and costs nothing.</span>
        </p>
      </div>
    </div>
  )
}
