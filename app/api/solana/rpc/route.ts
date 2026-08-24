import { NextRequest, NextResponse } from 'next/server'
import { VAULTED_CHAINS, getChain } from '@/lib/vaulted/registry'
import { solanaRpcUrl } from '@/lib/vaulted/solana'

/**
 * POST /api/solana/rpc — a narrow JSON-RPC proxy to the Solana cluster.
 *
 * The wallet has to reach an RPC from the browser to broadcast a transaction, and pointing it
 * straight at a cluster does not work in practice: the public endpoints refuse browser origins,
 * and a private one would mean putting its API key in a `NEXT_PUBLIC_` variable, where it is not
 * private at all. So the browser talks to this, and the key — if there is one — stays here.
 *
 * It is a proxy, not an open relay. Only the methods a send actually needs are forwarded, so this
 * cannot be used to drive arbitrary RPC traffic through the deployment's quota.
 *
 * Nothing here is trusted for anything. Broadcasting a transaction is not evidence it succeeded —
 * whether a payment happened is still decided by reading it back in `verify-payment`, and this
 * route has no way to mark anything paid.
 */

/** Everything `sendAndConfirmTransaction` and preflight need, and nothing else. */
const ALLOWED = new Set([
  'sendTransaction',
  'simulateTransaction',
  'getLatestBlockhash',
  'getSignatureStatuses',
  'getFeeForMessage',
  'getGenesisHash',
  'getTransaction',
  'getEpochInfo',
  'getHealth',
])

const MAX_BODY = 200_000
const MAX_BATCH = 10

type Call = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

function rejection(id: unknown, message: string) {
  // A JSON-RPC error, not an HTTP one: the caller is an RPC client and will not read anything else.
  return { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message } }
}

export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (raw.length > MAX_BODY) {
    return NextResponse.json(rejection(null, 'That request is too large.'), { status: 413 })
  }

  let payload: Call | Call[]
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json(rejection(null, 'That is not JSON.'), { status: 400 })
  }

  const calls = Array.isArray(payload) ? payload : [payload]
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return NextResponse.json(rejection(null, 'Too many calls in one request.'), { status: 400 })
  }

  const blocked = calls.find((call) => typeof call?.method !== 'string' || !ALLOWED.has(call.method))
  if (blocked) {
    return NextResponse.json(
      rejection(blocked.id, `"${String(blocked.method)}" is not proxied by this deployment.`),
      { status: 400 },
    )
  }

  const requested = request.nextUrl.searchParams.get('network')
  const chain =
    getChain(requested ?? '') ??
    VAULTED_CHAINS.find((entry) => entry.family === 'svm' && entry.tier === 'production')
  if (!chain || chain.family !== 'svm') {
    return NextResponse.json(rejection(null, 'No Solana network is configured.'), { status: 409 })
  }

  try {
    const upstream = await fetch(solanaRpcUrl(chain.cluster ?? 'mainnet-beta', chain.rpcUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    // Passed through as-is, including an upstream error: an RPC client knows what to do with a
    // JSON-RPC error and does not know what to do with a reworded one.
    const text = await upstream.text()
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error('[vaulted/solana rpc]', error)
    return NextResponse.json(
      rejection(calls[0]?.id, `Solana could not be reached: ${error instanceof Error ? error.message : 'unknown'}`),
      { status: 502 },
    )
  }
}
