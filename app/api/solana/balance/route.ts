import { NextRequest, NextResponse } from 'next/server'
import { getChain, VAULTED_CHAINS } from '@/lib/vaulted/registry'
import { isSolanaAddress, solanaRpcUrl } from '@/lib/vaulted/solana'

/**
 * GET /api/solana/balance?address=…
 *
 * Read on the server rather than from the browser for two reasons: the RPC endpoint can carry an
 * API key that must not reach a client bundle, and public Solana endpoints reject browser origins
 * often enough that a client-side read would look broken at random.
 *
 * Nothing is estimated. An unreachable cluster returns `readable: false` and the page says so.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.trim()
  if (!address || !isSolanaAddress(address)) {
    return NextResponse.json({ error: 'Not a Solana address.' }, { status: 400 })
  }

  const chain =
    getChain(request.nextUrl.searchParams.get('network') ?? '') ??
    VAULTED_CHAINS.find((entry) => entry.family === 'svm' && entry.tier === 'production')
  if (!chain || chain.family !== 'svm' || !chain.token) {
    return NextResponse.json({ error: 'No Solana network is configured.' }, { status: 409 })
  }

  const url = solanaRpcUrl(chain.cluster ?? 'mainnet-beta', chain.rpcUrl)
  const call = (method: string, params: unknown[]) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body.error) throw new Error(body.error.message ?? 'RPC error')
      return body.result
    })

  try {
    // Every token account the owner holds for this mint, summed: a wallet can legitimately have
    // more than one, and showing only the first would under-report the balance.
    const [accounts, lamports] = await Promise.all([
      call('getTokenAccountsByOwner', [
        address,
        { mint: chain.token.address },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]),
      call('getBalance', [address, { commitment: 'confirmed' }]),
    ])

    const value = (accounts as { value?: unknown[] })?.value ?? []
    const token = value.reduce((total: bigint, entry) => {
      const amount = (
        entry as { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }
      )?.account?.data?.parsed?.info?.tokenAmount?.amount
      return total + BigInt(amount ?? '0')
    }, 0n)

    return NextResponse.json({
      readable: true,
      network: chain.key,
      networkName: chain.name,
      token: { symbol: chain.token.symbol, decimals: chain.token.decimals, amount: token.toString() },
      native: { symbol: 'SOL', decimals: 9, amount: String((lamports as { value?: number })?.value ?? 0) },
    })
  } catch (error) {
    return NextResponse.json({
      readable: false,
      network: chain.key,
      networkName: chain.name,
      reason: `Could not read ${chain.name}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}
