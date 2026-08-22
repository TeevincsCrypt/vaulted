import { NextResponse } from 'next/server'
import { getVaultedConfig, isConfigured } from '@/lib/vaulted/config'

/**
 * GET /api/config — what the protocol is wired to, or why it is not wired up.
 *
 * When no deployment is recorded this returns `configured: false` with the reason. The UI shows
 * that reason. It does not fall back to a placeholder address.
 */
export async function GET() {
  const config = getVaultedConfig()
  if (!isConfigured(config)) {
    return NextResponse.json({ configured: false, reason: config.reason, message: config.message })
  }

  return NextResponse.json({
    configured: true,
    chainId: config.chainId,
    chainName: config.chain.name,
    escrowAddress: config.escrowAddress,
    token: config.token,
    arbiter: config.arbiter,
    defaultProtectionPeriod: config.defaultProtectionPeriod,
    explorer: config.chain.blockExplorers?.default?.url ?? null,
    deployment: config.deployment,
  })
}
