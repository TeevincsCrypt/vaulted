'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useSession } from './session-provider'
import { VaultedWordmark } from './marketing/logo'
import { Card, Notice } from './primitives'

const ERRORS: Record<string, string> = {
  'not-configured':
    'Twitter sign-in is not configured on this deployment. TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET and AUTH_SECRET need to be set.',
  denied: 'You cancelled the Twitter authorisation.',
  state: 'That sign-in link expired or did not match. Start again.',
  exchange: 'Twitter rejected the sign-in. Try again.',
}

export function LoginPage({ next }: { next?: string }) {
  return (
    <Suspense fallback={null}>
      <LoginInner next={next} />
    </Suspense>
  )
}

function LoginInner({ next }: { next?: string }) {
  const params = useSearchParams()
  const { authConfigured, loading } = useSession()
  const error = params.get('error')

  return (
    <div className="vt-canvas flex min-h-screen items-center justify-center px-5">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back
        </Link>

        <Card className="p-8 text-center">
          <VaultedWordmark className="justify-center" size={34} />
          <h1 className="vt-display mt-6 text-[22px]">Sign in to Vaulted</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
            Your X handle becomes your Vaulted username, so clients can pay <span className="font-medium">@you</span>{' '}
            instead of an address.
          </p>

          {error && (
            <div className="mt-5 text-left">
              <Notice tone="danger">{ERRORS[error] ?? 'Sign-in failed. Try again.'}</Notice>
            </div>
          )}

          {!loading && !authConfigured && !error && (
            <div className="mt-5 text-left">
              <Notice tone="warn" title="Sign-in is not configured">
                This deployment has no Twitter credentials set, so the button below will not work
                yet. See the README for the three environment variables it needs.
              </Notice>
            </div>
          )}

          <a
            href={`/api/auth/twitter${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl text-[15px] font-semibold text-[#08080a] transition-transform hover:-translate-y-0.5"
            style={{ background: 'var(--vt-accent)' }}
          >
            <XLogo />
            Continue with X
          </a>

          <p className="mt-5 flex items-start gap-2 text-left text-[11.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            Signing in identifies you. It does not give Vaulted access to your wallet — you link a
            wallet separately, with a signature, and only that wallet can move funds.
          </p>
        </Card>

        <p className="mt-5 text-center text-[12px] text-muted-foreground">
          Paying an invoice? You do not need an account —{' '}
          <span className="text-foreground">payment links work without signing in.</span>
        </p>
      </div>
    </div>
  )
}

function XLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
}
