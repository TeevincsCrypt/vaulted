'use client'

import { useState } from 'react'
import { getVaultedConfig, isConfigured } from '@/lib/vaulted/config'
import { useVaultedConfig } from '@/lib/vaulted/client'
import type { SerialisedInvoice } from '@/lib/vaulted/types'
import { CreateRequest } from './create-request'
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

  if (!config) return <NotConfigured message={unavailableMessage()} />

  return (
    <AppShell>
      <div className="mb-9">
        <h1 className="vt-display text-3xl leading-tight sm:text-4xl">
          Escrowed payment links
          <br />
          <span className="text-muted-foreground">for freelance work.</span>
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
          Send a link. Your client funds a smart contract instead of your wallet. If they go quiet,
          the escrow settles to you automatically once the protection window closes — no chasing, no
          intermediary.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CreateRequest config={config} onCreated={() => setCreatedCount((count) => count + 1)} />
        <RequestsList config={config} refreshKey={createdCount} />
      </div>
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
