'use client'

import { useState } from 'react'
import { Check, Download, ShieldCheck, Wallet } from 'lucide-react'
import { useAccount } from 'wagmi'
import { readableError } from '@/lib/vaulted/client'
import { getChain } from '@/lib/vaulted/registry'
import { useVaultedAuth } from './auth-provider'
import { AddressChip, Button, Card, Divider, Eyebrow, Notice } from './primitives'
import { useSession } from './session-provider'
import { AppShell } from './shell'
import { SignInButton } from './wallet'

/**
 * The account's wallet.
 *
 * There is nothing to link and nothing to choose: signing in with X provisions one wallet and it
 * stays with the account. What this page owes the user is the truth about who can move the funds
 * in it — and a way to take the key elsewhere, which is what makes that claim mean anything.
 */
export function Settings() {
  const { account } = useSession()
  const { address } = useAccount()
  const { configured, walletAddress, walletPending, exportWallet } = useVaultedAuth()

  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorded = account?.wallets ?? []
  // The signer wagmi is actually holding, which is what will sign the next transaction.
  const live = address ?? walletAddress

  async function runExport() {
    if (!exportWallet) return
    setExporting(true)
    setError(null)
    try {
      await exportWallet()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setExporting(false)
    }
  }

  return (
    <AppShell>
      <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Your wallet</h1>
      <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
        Every Vaulted account has one wallet, assigned when you sign in. People pay{' '}
        <span className="text-foreground">@{account?.name}</span> and it lands here.
      </p>

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-7">
          <Eyebrow>Account wallet</Eyebrow>

          {!account ? (
            <div className="mt-4">
              <SignInButton size="lg" full />
            </div>
          ) : walletPending ? (
            <div className="mt-4">
              <Notice tone="warn" title="Being created">
                Privy is provisioning this account&rsquo;s wallet. Nothing can be signed or received
                until it exists, and no address is shown until it does.
              </Notice>
            </div>
          ) : recorded.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {recorded.map((wallet) => {
                const walletChain = getChain(wallet.chainKey)
                return (
                  <li
                    key={`${wallet.chainKey}:${wallet.address}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">
                        {walletChain?.shortName ?? wallet.chainKey}
                      </span>
                      <AddressChip address={wallet.address} chain={walletChain?.viemChain ?? null} size={6} />
                    </span>
                    <span
                      className="vt-eyebrow inline-flex items-center gap-1 rounded-full px-2 py-1"
                      style={{ background: 'var(--vt-positive-soft)', color: 'var(--vt-positive)' }}
                    >
                      <Check size={10} /> Assigned
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted-foreground">
              No wallet recorded for this account yet. Sign out and back in to have one assigned.
            </p>
          )}

          {live && recorded.length > 0 && !recorded.some((w) => w.address.toLowerCase() === live.toLowerCase()) && (
            <div className="mt-4">
              <Notice tone="warn" title="Signer does not match">
                The wallet loaded in this browser is not the one recorded for @{account?.name}.
                Payments to your handle go to the address above, not to the one that would sign here.
              </Notice>
            </div>
          )}

          <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
            <Wallet size={13} className="mt-0.5 shrink-0" />
            The same address is used on every EVM network Vaulted supports.
          </p>
        </Card>

        <Card className="p-7">
          <Eyebrow>Custody</Eyebrow>
          <h2 className="vt-display mt-2 text-lg">Who can move the money</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            The wallet&rsquo;s key is split by Privy between a secure enclave and your device, and a
            transaction is only signed when you approve it. Vaulted holds no share of that key and
            has no way to sign for you — not for a transfer, and not to release an escrow.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
            This does mean Privy is a dependency: if you lose access to your X account, recovery
            goes through them, not through Vaulted. Exporting the key removes that dependency.
          </p>

          <Divider className="my-5" />

          {error && (
            <div className="mb-3">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}

          {!configured ? (
            <Notice tone="warn">
              Sign-in is not configured on this deployment, so no wallet has been assigned.
            </Notice>
          ) : exportWallet ? (
            <Button size="lg" full variant="secondary" busy={exporting} onClick={runExport}>
              <Download size={16} />
              Export private key
            </Button>
          ) : (
            <Notice tone="warn">There is no wallet to export yet.</Notice>
          )}

          <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            The key is shown by Privy in a frame on their own domain. Vaulted cannot read it, and
            never receives it.
          </p>
        </Card>
      </div>
    </AppShell>
  )
}
