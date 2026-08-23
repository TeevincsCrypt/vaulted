'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { getVaultedConfig, isConfigured } from '@/lib/vaulted/config'
import { defaultChain } from '@/lib/vaulted/registry'
import { useVaultedConfig } from '@/lib/vaulted/client'
import type { SerialisedInvoice } from '@/lib/vaulted/types'
import { ChainSelector } from './chain-selector'
import { DashboardOverview } from './dashboard-overview'
import { PayExperience } from './pay-experience'
import { RequestDetail } from './request-detail'
import { RequestsList } from './requests-list'
import { AppShell, NotConfigured } from './shell'

/**
 * Thin client wrappers. Config resolution lives on the client so the viem `Chain` object never has
 * to cross the server/client boundary, and so the "not deployed" state is decided in one place.
 */

function unavailableMessage(): string {
  const config = getVaultedConfig()
  return isConfigured(config) ? '' : config.message
}

export function Workspace() {
  const config = useVaultedConfig()
  const [createdCount, setCreatedCount] = useState(0)
  // The selector reflects the chain the app is configured for; switching targets is only
  // meaningful once more than one chain is live, so this is display state for now.
  const [activeChainKey, setActiveChainKey] = useState<string | null>(defaultChain()?.key ?? null)

  if (!config) return <NotConfigured message={unavailableMessage()} />

  return (
    <AppShell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Your vaults</h1>
          <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Escrow state is read from the chain, not from our database. Anything we could not read is
            marked rather than guessed.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
          <div className="w-full sm:w-[220px]">
            <p className="vt-eyebrow mb-1.5 text-muted-foreground">Network</p>
            <ChainSelector value={activeChainKey} onChange={setActiveChainKey} />
          </div>
          <Link
            href="/request"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[14px] font-semibold text-[#08080a]"
            style={{ background: 'var(--vt-accent)' }}
          >
            <Plus size={16} /> Request payment
          </Link>
        </div>
      </div>

      <div className="mb-10">
        <DashboardOverview key={createdCount} />
      </div>

      <RequestsList config={config} refreshKey={createdCount} />
    </AppShell>
  )
}

export function RequestPage({ invoice }: { invoice: SerialisedInvoice }) {
  const config = useVaultedConfig()
  if (!config) return <NotConfigured message={unavailableMessage()} />
  return (
    <AppShell>
      <RequestDetail invoice={invoice} config={config} />
    </AppShell>
  )
}

export function PayPage({ invoice }: { invoice: SerialisedInvoice }) {
  const config = useVaultedConfig()
  if (!config) return <NotConfigured message={unavailableMessage()} />
  return <PayExperience invoice={invoice} config={config} />
}
