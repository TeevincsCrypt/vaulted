/**
 * Solana address handling, without a dependency.
 *
 * The only thing the app needs from Solana's address format is the ability to tell a real one from
 * a typo, and to never mistake one for an EVM address. Both directions matter: paying an EVM
 * address on Solana sends money to an account nobody controls, and the reverse is just as bad.
 *
 * A Solana address is a 32-byte ed25519 public key rendered in base58 with Bitcoin's alphabet. That
 * is a small enough thing to decode here — pulling in a Solana SDK to validate a string would add
 * megabytes to the server bundle for twenty lines of arithmetic.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]))

/** Decodes base58, or null if the string is not valid base58. */
export function base58Decode(value: string): Uint8Array | null {
  if (!value) return null

  // No seed byte: seeding with a zero would make an all-'1' string — base58 for zero — decode one
  // byte longer than it is. The carry loop below builds the value from nothing quite happily.
  const bytes: number[] = []
  for (const character of value) {
    const digit = BASE58_INDEX.get(character)
    if (digit === undefined) return null

    let carry = digit
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Leading '1's are leading zero bytes, and carry no value to propagate.
  for (const character of value) {
    if (character !== '1') break
    bytes.push(0)
  }

  return new Uint8Array(bytes.reverse())
}

/** True for a well-formed Solana address: 32 bytes of base58. */
export function isSolanaAddress(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  // Cheap rejects first: an EVM address is `0x`-prefixed and `0` is not in the base58 alphabet, so
  // one can never be mistaken for the other.
  if (trimmed.length < 32 || trimmed.length > 44) return false
  const decoded = base58Decode(trimmed)
  return decoded !== null && decoded.length === 32
}

/** A Solana transaction signature: 64 bytes of base58. */
export function isSolanaSignature(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length < 64 || trimmed.length > 90) return false
  const decoded = base58Decode(trimmed)
  return decoded !== null && decoded.length === 64
}

/** Public RPC per cluster. Overridable, because public endpoints are rate limited. */
export function solanaRpcUrl(cluster: 'mainnet-beta' | 'devnet', override?: string | null): string {
  if (override?.trim()) return override.trim()
  return cluster === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com'
}

export function shortSolanaAddress(value: string, size = 4): string {
  if (value.length <= size * 2 + 1) return value
  return `${value.slice(0, size)}…${value.slice(-size)}`
}
