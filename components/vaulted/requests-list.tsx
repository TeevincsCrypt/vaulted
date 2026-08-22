'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Inbox, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import type { VaultedConfig } from '@/lib/vaulted/config'
import { formatAmount, formatTimestamp } from '@/lib/vaulted/format'
import type { DisplayStatus } from '@/lib/vaulted/status'
import type { SerialisedInvoice } from '@/lib/vaulted/types'
import { Button, Card, Eyebrow, Skeleton, StatusPill } from './primitives'

/**
 * The freelancer's payment requests.
 *
 * Rows show the last status observed on chain, which is what makes a list cheap to render. The
 * refresh control re-reads each escrow from the contract rather than trusting the cache; opening a
 * request reads it live.
 */
export function RequestsList({ config, refreshKey }: { config: VaultedConfig; refreshKey?: number }) {
  const { address, isConnected } = useAccount()
  const [invoices, setInvoices] = useState<SerialisedInvoice[] | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    if (!address) return
    const response = await fetch(`/api/invoices?payee=${address}`)
    if (!response.ok) {
      setInvoices([])
      return
    }
    const body = await response.json()
    setInvoices(body.invoices ?? [])
  }, [address])

  useEffect(() => {
    setInvoices(null)
    void load()
  }, [load, refreshKey])

  /** Re-reads every escrow from the contract and refreshes the cached statuses. */
  async function syncAll() {
    if (!invoices?.length) return
    setSyncing(true)
    try {
      await Promise.all(
        invoices.map((invoice) =>
          fetch(`/api/invoices/${invoice.invoiceId}/sync`, { method: 'POST' }).catch(() => null),
        ),
      )
      await load()
    } finally {
      setSyncing(false)
    }
  }

  if (!isConnected) {
    return (
      <Card className="flex flex-col items-center gap-2 px-7 py-12 text-center">
        <Inbox size={20} className="text-muted-foreground" />
        <p className="text-sm font-medium">Connect your wallet</p>
        <p className="max-w-xs text-[13px] text-muted-foreground">
          Your payment requests are listed against the wallet that created them.
        </p>
      </Card>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Your payment requests</Eyebrow>
        <Button variant="ghost" busy={syncing} onClick={syncAll} className="h-8 px-2 text-xs">
          {!syncing && <RefreshCw size={13} />}
          Refresh from chain
        </Button>
      </div>

      {invoices === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[68px] w-full" />
          <Skeleton className="h-[68px] w-full" />
        </div>
      ) : invoices.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-7 py-12 text-center">
          <Inbox size={20} className="text-muted-foreground" />
          <p className="text-sm font-medium">No payment requests yet</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">
            Create one and share the link. Nothing appears here until an escrow exists.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {invoices.map((invoice) => (
            <Link key={invoice.invoiceId} href={`/requests/${invoice.invoiceId}`} className="group">
              <Card className="flex items-center gap-4 px-5 py-4 transition group-hover:border-foreground/25">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{invoice.description}</p>
                  </div>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {invoice.payer ? `To ${invoice.payer.slice(0, 8)}…` : 'Open link'} ·{' '}
                    {formatTimestamp(Math.floor(new Date(invoice.createdAt).getTime() / 1000))}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="vt-numeric text-sm font-semibold">
                    {formatAmount(invoice.amount, invoice.token.decimals)} {invoice.token.symbol}
                  </p>
                  <div className="mt-1 flex justify-end">
                    <StatusPill status={invoice.indexedStatus as DisplayStatus} />
                  </div>
                </div>
                <ArrowUpRight size={15} className="shrink-0 text-muted-foreground transition group-hover:text-foreground" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
