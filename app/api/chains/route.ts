import { NextResponse } from 'next/server'
import { availabilityLabel, VAULTED_CHAINS } from '@/lib/vaulted/registry'

/**
 * GET /api/chains — the chain registry with its real availability.
 *
 * `availability` is derived from whether a deployment record exists, so this endpoint cannot claim
 * a chain is usable when nothing is deployed on it.
 */
export async function GET() {
  return NextResponse.json({
    chains: VAULTED_CHAINS.map((chain) => ({
      key: chain.key,
      name: chain.name,
      shortName: chain.shortName,
      family: chain.family,
      network: chain.network,
      availability: chain.availability,
      label: availabilityLabel(chain),
      evmChainId: chain.evmChainId ?? null,
      cluster: chain.cluster ?? null,
      escrowAddress: chain.escrowAddress ?? null,
      token: chain.token ?? null,
      explorerUrl: chain.explorerUrl,
      note: chain.note ?? null,
    })),
  })
}
