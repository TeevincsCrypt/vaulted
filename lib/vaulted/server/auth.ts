import { getAddress, isAddress, recoverMessageAddress } from 'viem'
import { getChain } from '../registry'
import { isFresh } from '../messages'

/** Raised by the server modules; carries the HTTP status the route should return. */
export class ApiError extends Error {
  /** Branded, so the check survives a duplicated module instance. See ChainNotImplementedError. */
  static readonly code = 'VAULTED_API_ERROR'
  readonly code = ApiError.code
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  static is(error: unknown): error is ApiError {
    return (
      typeof error === 'object' && error !== null && (error as { code?: unknown }).code === ApiError.code
    )
  }
}

/**
 * Verifies that `signature` over `message` was produced by `expected`.
 *
 * EOA signatures only, recovered locally with no RPC call. Smart-contract wallets (ERC-1271) would
 * need an on-chain `isValidSignature` check — not supported yet, and rejected rather than waved
 * through, because accepting an unverifiable signature would let anyone act as anyone.
 */
export async function requireSigner(input: {
  message: string
  signature: string
  expected: string
  issuedAt: number
  what: string
}): Promise<`0x${string}`> {
  if (!isAddress(input.expected)) throw new ApiError('Not a wallet address.', 400)
  if (!/^0x[0-9a-fA-F]+$/.test(input.signature)) throw new ApiError('Malformed signature.', 400)
  if (!Number.isFinite(input.issuedAt) || !isFresh(input.issuedAt)) {
    throw new ApiError('This request has expired. Sign again.', 401)
  }

  const signer = await recoverMessageAddress({
    message: input.message,
    signature: input.signature as `0x${string}`,
  }).catch(() => null)

  if (!signer || signer.toLowerCase() !== input.expected.toLowerCase()) {
    throw new ApiError(`Signature does not match the wallet for ${input.what}.`, 401)
  }
  return getAddress(signer)
}

/**
 * Resolves a chain key and refuses anything Vaulted cannot actually transact on.
 *
 * This is the server-side backstop behind the disabled buttons: a chain listed as "coming soon"
 * must not be able to produce a database row that implies a payment could happen on it.
 */
export function requireTransactableChain(chainKey: string) {
  const chain = getChain(chainKey)
  if (!chain) throw new ApiError(`Unknown chain "${chainKey}".`, 400)
  if (chain.availability !== 'live') {
    throw new ApiError(
      `${chain.name} is not live yet${chain.note ? ` — ${chain.note}` : ''}`,
      409,
    )
  }
  return chain
}
