/**
 * RPC endpoint for server-side reads.
 *
 * Prefers `RPC_URL`, which is server-only and can therefore carry a provider API key without it
 * ending up in the client bundle. Falls back to the public `NEXT_PUBLIC_RPC_URL`, then to the
 * chain's default endpoint.
 */
export function serverRpcUrl(): string | undefined {
  return process.env.RPC_URL?.trim() || process.env.NEXT_PUBLIC_RPC_URL?.trim() || undefined
}
