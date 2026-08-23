'use client'

import { getAccessToken, useExportWallet, usePrivy, useWallets } from '@privy-io/react-auth'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { readableError } from '@/lib/vaulted/client'
import { PRIVY_APP_ID } from '@/lib/vaulted/privy'
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
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { wallets } = useWallets()
  const { exportWallet } = useExportWallet()
  const { account, refresh, clearSession } = useSession()

  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const embedded = wallets.find((wallet) => wallet.walletClientType === 'privy') ?? null
  const walletAddress = embedded?.address ?? null

  /**
   * What has already been pushed to the server. The wallet address is part of the key because
   * Privy creates it just after login: the first sync can legitimately carry no address, and the
   * second — once the wallet exists — is what records it.
   */
  const syncedRef = useRef<string | null>(null)
  const syncKey = authenticated && user ? `${user.id}:${walletAddress ?? ''}` : null

  useEffect(() => {
    if (!ready || !syncKey) return
    if (syncedRef.current === syncKey) return
    syncedRef.current = syncKey

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
  }, [ready, syncKey, refresh])

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
      error,
      walletAddress,
      walletPending: authenticated && !walletAddress,
      exportWallet: walletAddress ? () => exportWallet({ address: walletAddress }) : null,
    }),
    [ready, login, signOut, syncing, error, walletAddress, authenticated, exportWallet],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
