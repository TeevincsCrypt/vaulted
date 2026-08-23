'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Inbox as InboxIcon, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useEscrow, useVaultedConfig } from '@/lib/vaulted/client'
import { formatAmount, shortAddress } from '@/lib/vaulted/format'
import { EscrowState, type DisplayStatus } from '@/lib/vaulted/status'
import { EscrowActions } from './escrow-actions'
import { Button, Card, Eyebrow, Notice, Skeleton, StatusPill } from './primitives'
import { useSession } from './session-provider'
import { AppShell, EscrowUnavailable } from './shell'
import { SignInButton } from './wallet'

/**
 * Payments other people have asked you for.
 *
 * The mirror of `/request`: that page is what you ask others to pay, this is what you owe. Rows are
 * the escrows where your wallet is the payer, and every one of them is read live from its contract
 * — the release button is only offered when the chain says the call will succeed.
 *
 * Releasing sends the escrowed tokens to the payee. It is a real transaction from your wallet and
 * it is final; the contract has no reversal.
 */

type Row = {
  invoiceId: string
  escrowId: string
  chainName: string
  description: string
  amount: string
  token: { symbol: string; decimals: number }
  payee: string
  payeeHandle: string | null
  live: boolean
  unavailableReason?: string
  status: DisplayStatus
  state: number | null
  role: 'payer' | 'payee' | 'observer'
}

export function Inbox() {
  const { address: connected } = useAccount()
  const config = useVaultedConfig()
  const { account } = useSession()

  // Listing what you owe is a read against an address the session already knows. Only the buttons
  // inside each row need a signer, and they gate themselves.
  const address = connected ?? account?.primaryAddress ?? null
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!address) return
    setError(null)
    try {
      const response = await fetch(`/api/dashboard?address=${address}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Could not load your requests.')
      // Only what you are being asked to pay. The escrows you raised live on /request.
      setRows((body.rows as Row[]).filter((row) => row.role === 'payer'))
    } catch (cause) {
      setRows([])
      setError(cause instanceof Error ? cause.message : 'Could not load your requests.')
    }
  }, [address])

  useEffect(() => {
    setRows(null)
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const outstanding = rows?.filter((row) => row.state !== EscrowState.Released && row.state !== EscrowState.Refunded)

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="vt-display text-3xl leading-tight sm:text-4xl">To pay</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Payment requests addressed to you. Funding one locks the money in the escrow contract;
            releasing it sends the money to them.
          </p>
        </div>
        {address && (
          <Button variant="secondary" busy={refreshing} onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </Button>
        )}
      </div>

      {!address ? (
        <div className="mt-8 max-w-sm">
          <SignInButton size="lg" full label="Sign in to see what you owe" />
        </div>
      ) : !config ? (
        <div className="mt-8">
          <EscrowUnavailable
            what="This list"
            message="Nobody can raise an escrow for you to pay until the contract is deployed, so there is nothing to list here."
          />
        </div>
      ) : rows === null ? (
        <div className="mt-8 flex flex-col gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <>
          {error && (
            <div className="mt-6">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}

          {outstanding && outstanding.length === 0 ? (
            <Card className="mt-8 p-10 text-center">
              <InboxIcon size={22} className="mx-auto text-muted-foreground" />
              <p className="mt-3 text-[14px] font-medium">Nothing to pay</p>
              <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                When somebody raises a payment request addressed to your wallet, it appears here with
                everything you need to fund or release it.
              </p>
            </Card>
          ) : (
            <div className="mt-8 flex flex-col gap-4">
              {rows.map((row) => (
                <InboxRow key={row.invoiceId} row={row} onSettled={refresh} />
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}

function InboxRow({ row, onSettled }: { row: Row; onSettled: () => void }) {
  const config = useVaultedConfig()
  // The list endpoint's snapshot is for display. The controls below act on a live read, so a row
  // that went stale in another tab cannot offer a call the contract would reject.
  const { escrow: live } = useEscrow((row.escrowId as `0x${string}`) ?? undefined)

  const awaitingFunding = live?.state === EscrowState.Created

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>
            {row.payeeHandle ? `@${row.payeeHandle}` : shortAddress(row.payee, 6)} is requesting
          </Eyebrow>
          <p className="mt-1.5 text-[22px] font-semibold tracking-tight">
            {formatAmount(row.amount, row.token.decimals)} {row.token.symbol}
          </p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{row.description}</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">{row.chainName}</p>
        </div>
        <StatusPill status={row.status} />
      </div>

      <div className="mt-5">
        {!row.live ? (
          <Notice tone="warn" title="Chain unreadable">
            {row.unavailableReason ?? 'The chain could not be read just now.'} Nothing is shown as
            payable until it can be.
          </Notice>
        ) : awaitingFunding ? (
          <Link
            href={`/pay/${row.invoiceId}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-[#08080a] transition-transform hover:-translate-y-0.5"
            style={{ background: 'var(--vt-accent)' }}
          >
            Fund {formatAmount(row.amount, row.token.decimals)} {row.token.symbol}
          </Link>
        ) : live && config ? (
          <EscrowActions
            escrowId={row.escrowId as `0x${string}`}
            escrow={live}
            config={config}
            compact
            onSettled={onSettled}
          />
        ) : (
          <Skeleton className="h-11" />
        )}
      </div>

      <Link
        href={`/requests/${row.invoiceId}`}
        className="mt-4 inline-flex items-center gap-1.5 text-[13px]"
        style={{ color: 'var(--vt-accent)' }}
      >
        Open the escrow <ArrowUpRight size={14} />
      </Link>
    </Card>
  )
}
