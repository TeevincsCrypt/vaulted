'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type SessionAccount = {
  id: string
  name: string
  displayName: string | null
  avatarUrl: string | null
  primaryAddress: string | null
  wallets: { chainKey: string; address: string }[]
}

type SessionValue = {
  account: SessionAccount | null
  /** False when sign-in is not configured on this deployment. */
  authConfigured: boolean
  loading: boolean
  refresh: () => Promise<void>
  /**
   * Drops the Vaulted session cookie. Does not touch the Privy session — signing out of both is
   * orchestrated by {@link useVaultedAuth}, which can reach Privy's hooks and this cannot.
   */
  clearSession: () => Promise<void>
}

const SessionContext = createContext<SessionValue>({
  account: null,
  authConfigured: false,
  loading: true,
  refresh: async () => {},
  clearSession: async () => {},
})

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<SessionAccount | null>(null)
  const [authConfigured, setAuthConfigured] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' })
      const body = await response.json()
      setAccount(body.account ?? null)
      setAuthConfigured(Boolean(body.authConfigured))
    } catch {
      setAccount(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const clearSession = useCallback(async () => {
    await fetch('/api/auth/signout', { method: 'POST' })
    setAccount(null)
  }, [])

  const value = useMemo(
    () => ({ account, authConfigured, loading, refresh, clearSession }),
    [account, authConfigured, loading, refresh, clearSession],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  return useContext(SessionContext)
}
