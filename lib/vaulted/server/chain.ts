import { createPublicClient, http, type PublicClient } from 'viem'
import { VAULTED_ESCROW_ABI } from '../generated/abi'
import { getVaultedConfig, isConfigured } from '../config'
import { EscrowState, displayStatus, type DisplayStatus } from '../status'

/**
 * Server-side reads of escrow state.
 *
 * These are a convenience for indexing and for server-rendered first paint. They are explicitly
 * best-effort: if the RPC endpoint is unreachable the caller gets `{ ok: false, reason }` and is
 * expected to surface that, never to substitute a cached or invented status. The browser reads the
 * same contract through the user's own wallet provider, and that read is what the UI acts on.
 */

export type OnChainEscrow = {
  state: EscrowState
  status: DisplayStatus
  payer: `0x${string}`
  payee: `0x${string}`
  amount: bigint
  createdAt: number
  fundedAt: number
  expiresAt: number
  fundingDeadline: number
  protectionPeriod: number
  detailsHash: `0x${string}`
  isExpired: boolean
  canTimeout: boolean
  canDispute: boolean
  secondsUntilExpiry: number
  blockNumber: bigint
}

export type ChainReadResult =
  | { ok: true; escrow: OnChainEscrow }
  | { ok: false; reason: string }

let cachedClient: { chainId: number; client: PublicClient } | null = null

function publicClientFor(chainId?: number): PublicClient | null {
  const config = getVaultedConfig(chainId)
  if (!isConfigured(config)) return null
  if (cachedClient?.chainId === config.chainId) return cachedClient.client

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl ?? undefined),
  }) as PublicClient
  cachedClient = { chainId: config.chainId, client }
  return client
}

export async function readEscrow(escrowId: `0x${string}`, chainId?: number): Promise<ChainReadResult> {
  const config = getVaultedConfig(chainId)
  if (!isConfigured(config)) return { ok: false, reason: config.message }

  const client = publicClientFor(chainId)
  if (!client) return { ok: false, reason: 'No RPC client could be built for this chain.' }

  try {
    const [view, blockNumber] = await Promise.all([
      client.readContract({
        address: config.escrowAddress,
        abi: VAULTED_ESCROW_ABI,
        functionName: 'getEscrowView',
        args: [escrowId],
      }),
      client.getBlockNumber(),
    ])

    if (!view.exists) return { ok: false, reason: 'No escrow with this id exists on chain yet.' }

    const state = Number(view.escrow.state) as EscrowState
    return {
      ok: true,
      escrow: {
        state,
        status: displayStatus(state, view.isExpired),
        payer: view.escrow.payer,
        payee: view.escrow.payee,
        amount: view.escrow.amount,
        createdAt: Number(view.escrow.createdAt),
        fundedAt: Number(view.escrow.fundedAt),
        expiresAt: Number(view.escrow.expiresAt),
        fundingDeadline: Number(view.escrow.fundingDeadline),
        protectionPeriod: Number(view.escrow.protectionPeriod),
        detailsHash: view.escrow.detailsHash,
        isExpired: view.isExpired,
        canTimeout: view.canTimeout,
        canDispute: view.canDispute,
        secondsUntilExpiry: Number(view.secondsUntilExpiry),
        blockNumber,
      },
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `RPC read failed: ${error.message}` : 'RPC read failed.',
    }
  }
}
