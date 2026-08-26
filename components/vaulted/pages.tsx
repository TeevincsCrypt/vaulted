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
import { Button, PageHeader } from './primitives'
import { AppShell, EscrowUnavailable, NotConfigured } from './shell'

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

  if (!config) {
    return (
      <AppShell>
        <PageHeader eyebrow="Escrow" title="Your vaults" />
        <div className="mt-8">
          <EscrowUnavailable what="The escrow dashboard" message={unavailableMessage()} />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="mb-8">
        <PageHeader
          eyebrow="Escrow"
          title="Your vaults"
          body="Escrow state is read from the chain, not from our database. Anything we could not read is marked rather than guessed."
          actions={
            <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
              <div className="w-full sm:w-[210px]">
                <ChainSelector value={activeChainKey} onChange={setActiveChainKey} />
              </div>
              <Link href="/request" className="shrink-0">
                <Button full>
                  <Plus size={16} /> Request payment
                </Button>
              </Link>
            </div>
          }
        />
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
  if (!config) {
    return (
      <AppShell>
        <EscrowUnavailable what="This escrow" message={unavailableMessage()} />
      </AppShell>
    )
  }
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
