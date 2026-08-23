'use client'

import { useState } from 'react'
import { Check, Link2, ShieldCheck } from 'lucide-react'
import { useAccount, useSignMessage } from 'wagmi'
import { readableError } from '@/lib/vaulted/client'
import { shortAddress } from '@/lib/vaulted/format'
import { usernameLinkMessage } from '@/lib/vaulted/messages'
import { defaultChain, getChain } from '@/lib/vaulted/registry'
import { AddressChip, Button, Card, Divider, Eyebrow, Notice } from './primitives'
import { useSession } from './session-provider'
import { AppShell } from './shell'
import { ConnectWalletButton } from './wallet'

/**
 * Wallet settings.
 *
 * A Twitter account says who you are; a wallet says what pays and gets paid. Linking one needs a
 * signature from that wallet — being signed in is never enough, or a handle could be pointed at
 * somebody else's address.
 */
export function Settings() {
  const { account, refresh } = useSession()
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const chain = defaultChain()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const alreadyLinked = Boolean(
    account && address && account.wallets.some((w) => w.address.toLowerCase() === address.toLowerCase()),
  )

  async function link() {
    if (!account || !address || !chain) return
    setBusy(true)
    setError(null)
    try {
      const issuedAt = Math.floor(Date.now() / 1000)
      const signature = await signMessageAsync({
        message: usernameLinkMessage({ handle: account.name, address, chainKey: chain.key, issuedAt }),
      })
      const response = await fetch('/api/account/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chainKey: chain.key, address, issuedAt, signature }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Could not link that wallet.')
      setDone(true)
      await refresh()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Wallets</h1>
      <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
        Link a wallet so people can pay <span className="text-foreground">@{account?.name}</span> instead
        of an address.
      </p>

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-7">
          <Eyebrow>Linked wallets</Eyebrow>
          {account && account.wallets.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {account.wallets.map((wallet) => {
                const walletChain = getChain(wallet.chainKey)
                return (
                  <li
                    key={`${wallet.chainKey}:${wallet.address}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{walletChain?.shortName ?? wallet.chainKey}</span>
                      <AddressChip address={wallet.address} chain={walletChain?.viemChain ?? null} size={6} />
                    </span>
                    <span
                      className="vt-eyebrow inline-flex items-center gap-1 rounded-full px-2 py-1"
                      style={{ background: 'var(--vt-positive-soft)', color: 'var(--vt-positive)' }}
                    >
                      <Check size={10} /> Verified
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted-foreground">
              No wallet linked yet. Until you link one, people cannot pay your handle.
            </p>
          )}
        </Card>

        <Card className="p-7">
          <Eyebrow>Link a wallet</Eyebrow>
          <h2 className="vt-display mt-2 text-lg">Prove it is yours</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            One signature. It moves no funds and grants Vaulted nothing — it only proves the wallet
            is under your control.
          </p>

          <Divider className="my-5" />

          {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
          {done && <div className="mb-3"><Notice tone="good" icon={<Check size={15} />}>Wallet linked.</Notice></div>}

          {!chain ? (
            <Notice tone="warn">No network has a deployed escrow, so there is nothing to link to yet.</Notice>
          ) : !isConnected ? (
            <ConnectWalletButton size="lg" full label="Connect a wallet first" />
          ) : alreadyLinked ? (
            <Notice tone="good" icon={<ShieldCheck size={15} />}>
              {shortAddress(address, 6)} is already linked to @{account?.name}.
            </Notice>
          ) : (
            <Button size="lg" full busy={busy} onClick={link}>
              <Link2 size={16} />
              Link {shortAddress(address, 4)} on {chain.shortName}
            </Button>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
