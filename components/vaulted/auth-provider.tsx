'use client'

import { getAccessToken, useExportWallet, useLogin, usePrivy, useWallets } from '@privy-io/react-auth'
import {
  useExportWallet as useSolanaExportWallet,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { readableError } from '@/lib/vaulted/client'
import { PRIVY_APP_ID } from '@/lib/vaulted/privy'
import { VAULTED_CHAINS } from '@/lib/vaulted/registry'
import { useSession } from './session-provider'

/**
 * Bridges the Privy session to the Vaulted session.
 *
 * Privy owns the login and the wallet. Vaulted still needs its own cookie, because every API route
 * here authorises against an account row — so once Privy reports a signed-in user, the access
 * token goes to `/api/auth/privy`, which verifies it and reads the handle and wallet address back
 * from Privy before minting the cookie. The browser never asserts either.
 *
 * The two sessions are kept in step in both directions: signing out of Vaulted signs out of Privy,
 * and if Privy's session ends, the Vaulted cookie is dropped rather than left standing for an
 * account whose wallet is no longer reachable.
 */

/**
 * Privy's login error codes, in words that say what to do about them.
 *
 * Without this the SDK's failures go nowhere: `login()` opens a modal and returns void, so a
 * rejected OAuth handshake used to leave the page looking idle and the reason only visible in the
 * network tab. Every code is still printed alongside the explanation, so an unmapped one is
 * reported rather than swallowed.
 *
 * Note what this cannot catch: if the provider refuses the authorization request outright — an
 * unregistered redirect URI being the usual reason — the browser never comes back from the
 * provider, so no callback of ours runs. `npm run privy:probe` is the tool for that case; it asks
 * Privy for the exact redirect URI the provider is being sent.
 */
const LOGIN_ERRORS: Record<string, string> = {
  oauth_user_denied: 'You declined the request on X, so nothing was shared.',
  oauth_unexpected:
    'X rejected the sign-in request. This is usually the callback URL registered with X not ' +
    'matching the one Privy sends — run `npm run privy:probe` to print the exact value X expects.',
  oauth_account_suspended: 'That X account is suspended, so it cannot be used to sign in.',
  disallowed_login_method:
    'X is not enabled as a login method for this Privy app. Enable it in the Privy dashboard.',
  missing_or_invalid_privy_app_id:
    'Privy did not recognise this app id, or this origin is not in the app’s allowed domains.',
  invalid_credentials:
    'Privy could not use the X client id and secret it holds. Re-enter them in the Privy dashboard.',
  allowlist_rejected: 'This account is not on the allowlist for this app.',
  too_many_requests: 'Too many attempts. Wait a moment and try again.',
  embedded_wallet_create_error:
    'You are signed in, but the wallet could not be created. Sign out and back in to retry.',
  client_request_timeout: 'Privy did not respond in time. Try again.',
}

/** Closing the modal is a choice, not a failure, and must not be reported as one. */
const SILENT_LOGIN_ERRORS = new Set(['exited_auth_flow', 'exited_link_flow', 'user_exited_set_password_flow'])

/**
 * How long to wait for Privy's SDK before saying it did not arrive.
 *
 * Until it is ready the sign-in button is correctly disabled, but a button that stays disabled
 * forever tells the user nothing. If Privy cannot be reached — an extension blocking it, a
 * restrictive network, a CSP — that is a real and reportable state, not a load still in progress.
 */
const READY_TIMEOUT_MS = 12_000

/** Same lookup {@link recordSolanaWallet} uses server-side, so the two never disagree on which chain "the" Solana wallet is filed under. */
const SOLANA_CHAIN_KEY =
  VAULTED_CHAINS.find((chain) => chain.family === 'svm' && chain.tier === 'production')?.key ?? null

const SDK_UNREACHABLE =
  'Privy did not load, so sign-in cannot start. Check that auth.privy.io is reachable from this ' +
  'browser — an extension, a network filter or a content-security policy will block it.'

type AuthValue = {
  /** True once the auth layer has settled and `signIn` is meaningful. */
  ready: boolean
  /** False when this deployment has no Privy app id — sign-in is impossible, not merely pending. */
  configured: boolean
  signIn: () => void
  signOut: () => Promise<void>
  /** True while the Privy session is being exchanged for a Vaulted one. */
  syncing: boolean
  error: string | null
  /** The embedded wallet's address, once Privy has provisioned it. */
  walletAddress: string | null
  /** Signed in, but the wallet is not there yet. Shown as "being created", never as an address. */
  walletPending: boolean
  /**
   * Opens Privy's key-export flow. Null when there is no wallet to export. The key is rendered in
   * an iframe on Privy's own domain, so Vaulted never sees it — which is the point: the wallet is
   * the user's, and they can walk away with it.
   */
  exportWallet: (() => Promise<void>) | null
  /** The embedded Solana wallet's address, once Privy has provisioned it. */
  solanaWalletAddress: string | null
  /**
   * Same export flow as {@link exportWallet}, for the Solana wallet. A separate hook because Privy
   * ships EVM and Solana export as two different hooks with two different iframes — there is no
   * single "export" that covers both rails.
   */
  exportSolanaWallet: (() => Promise<void>) | null
}

const UNCONFIGURED: AuthValue = {
  ready: true,
  configured: false,
  signIn: () => {},
  signOut: async () => {},
  syncing: false,
  error: null,
  walletAddress: null,
  walletPending: false,
  exportWallet: null,
  solanaWalletAddress: null,
  exportSolanaWallet: null,
}

const AuthContext = createContext<AuthValue>(UNCONFIGURED)

export function useVaultedAuth(): AuthValue {
  return useContext(AuthContext)
}

/**
 * `PRIVY_APP_ID` is inlined at build time, so this branch is fixed for the life of the bundle and
 * the two subtrees never swap. Without it, nothing renders Privy's hooks — calling them outside a
 * `PrivyProvider` would throw, and there is no provider to be inside.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <AuthContext.Provider value={UNCONFIGURED}>{children}</AuthContext.Provider>
  }
  return <PrivyAuthProvider>{children}</PrivyAuthProvider>
}

function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, logout } = usePrivy()
  const { wallets } = useWallets()
  const { exportWallet } = useExportWallet()
  const { wallets: solanaWallets } = useSolanaWallets()
  const { exportWallet: exportSolanaWalletRaw } = useSolanaExportWallet()
  const { account, refresh, clearSession } = useSession()

  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `useLogin` is `usePrivy().login` with callbacks attached. Same modal, but a failed handshake
  // now reaches the page instead of ending in the console.
  const { login } = useLogin({
    onComplete: () => setError(null),
    onError: (code) => {
      const key = String(code)
      if (SILENT_LOGIN_ERRORS.has(key)) {
        setError(null)
        return
      }
      const explanation = LOGIN_ERRORS[key]
      setError(explanation ? `${explanation} (${key})` : `Sign-in failed: ${key}`)
    },
  })

  const embedded = wallets.find((wallet) => wallet.walletClientType === 'privy') ?? null
  const walletAddress = embedded?.address ?? null

  /*
    Matched against the address the server already recorded for this account, rather than by
    asking which connected wallet "is Privy's" — the wallet-standard type Privy exposes here does
    not carry that flag in its public shape, and matching against server state is the same rule
    the rest of this app already follows: the wallet that matters is the one on file, not whichever
    one the browser happens to be holding.
  */
  const recordedSolanaAddress = SOLANA_CHAIN_KEY
    ? account?.wallets.find((wallet) => wallet.chainKey === SOLANA_CHAIN_KEY)?.address ?? null
    : null
  const solanaEmbedded = solanaWallets.find((wallet) => wallet.address === recordedSolanaAddress) ?? null
  const solanaWalletAddress = solanaEmbedded?.address ?? null

  /**
   * What has already been pushed to the server.
   *
   * Privy provisions the wallets a moment after login and the two rails land independently, so the
   * first sync can legitimately carry no address and a later one is what records it. The key
   * therefore covers both rails, and the Solana side deliberately uses the addresses Privy is
   * holding rather than {@link recordedSolanaAddress} — keying on what the server already knows
   * would mean the sync that first records a Solana wallet could only fire once it was recorded.
   *
   * `pending` is the part that makes this self-correcting, and it is there because everything else
   * in the key is the browser's view. If Privy has not surfaced a wallet to these hooks — it is
   * still provisioning, or it does not tag the embedded one the way `walletAddress` expects — the
   * key stops changing and the account is stranded with no address on file. That is not a cosmetic
   * failure: `accountForAddress` is the only link from a wallet to an account, so an account with
   * no recorded address is invisible to every notification (an applicant, a hire, a submission) and
   * to handle resolution, silently and permanently. Keying on the server's own answer means the
   * sync keeps being retried until the address is actually recorded, and stops as soon as it is.
   */
  const syncedRef = useRef<string | null>(null)
  const solanaAddresses = solanaWallets
    .map((wallet) => wallet.address)
    .sort()
    .join(',')
  const addressRecorded = account !== null && account.primaryAddress !== null
  const syncKey =
    authenticated && user
      ? `${user.id}:${walletAddress ?? ''}:${solanaAddresses}:${addressRecorded ? 'recorded' : 'pending'}`
      : null

  /*
    Retries while the server still reports no address, since nothing else will change the key in
    that state. Bounded: this is a wallet that should appear within seconds, and a failure that has
    not resolved by then is a real one to surface rather than to poll at forever.
  */
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!ready || !authenticated || addressRecorded || syncing || retry >= 5) return
    const timer = setTimeout(() => setRetry((value) => value + 1), 4000)
    return () => clearTimeout(timer)
  }, [ready, authenticated, addressRecorded, syncing, retry])

  useEffect(() => {
    if (!ready || !syncKey) return
    const attempt = `${syncKey}:${addressRecorded ? 0 : retry}`
    if (syncedRef.current === attempt) return
    syncedRef.current = attempt

    let cancelled = false
    void (async () => {
      setSyncing(true)
      setError(null)
      try {
        const token = await getAccessToken()
        if (!token) throw new Error('Privy did not return a session token. Try signing in again.')

        const response = await fetch('/api/auth/privy', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? 'Could not complete sign-in.')
        if (!cancelled) await refresh()
      } catch (cause) {
        if (cancelled) return
        // Cleared so a retry is possible; leaving it set would strand the user on one failure.
        syncedRef.current = null
        setError(readableError(cause))
      } finally {
        if (!cancelled) setSyncing(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, syncKey, addressRecorded, retry, refresh])

  // Tracked apart from `error` so a late arrival clears itself, and so a login failure and a
  // failed load cannot overwrite one another.
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  useEffect(() => {
    if (ready) {
      setLoadTimedOut(false)
      return
    }
    const timer = setTimeout(() => setLoadTimedOut(true), READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [ready])

  // Privy's session is the source of truth. If it has ended, the Vaulted cookie must not outlive
  // it — it would name an account whose wallet the browser can no longer sign with.
  useEffect(() => {
    if (!ready || authenticated || !account) return
    syncedRef.current = null
    void clearSession()
  }, [ready, authenticated, account, clearSession])

  const signOut = useCallback(async () => {
    syncedRef.current = null
    await clearSession()
    await logout()
    window.location.href = '/'
  }, [clearSession, logout])

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      configured: true,
      signIn: () => login(),
      signOut,
      syncing,
      error: error ?? (loadTimedOut ? SDK_UNREACHABLE : null),
      walletAddress,
      walletPending: authenticated && !walletAddress,
      exportWallet: walletAddress ? () => exportWallet({ address: walletAddress }) : null,
      solanaWalletAddress,
      exportSolanaWallet: solanaWalletAddress
        ? () => exportSolanaWalletRaw({ address: solanaWalletAddress })
        : null,
    }),
    [
      ready,
      login,
      signOut,
      syncing,
      error,
      loadTimedOut,
      walletAddress,
      authenticated,
      exportWallet,
      solanaWalletAddress,
      exportSolanaWalletRaw,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
