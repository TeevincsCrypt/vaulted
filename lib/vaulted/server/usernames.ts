import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { getChain } from '../registry'
import { usernameClaimMessage, usernameLinkMessage } from '../messages'
import { ApiError, requireSigner } from './auth'

/**
 * Handles (`@alice`) that resolve to wallet addresses.
 *
 * Ownership is proven, never asserted. A handle exists only after a signature over the canonical
 * claim message recovers to the claiming wallet, and each per-chain address needs its own proof.
 * There is no admin path to assign or reassign a handle, because a handle that can be reassigned by
 * an operator is a way to redirect somebody's payments.
 */

export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/

/** Reserved so a handle cannot impersonate the product or shadow a route. */
const RESERVED = new Set([
  'vaulted', 'admin', 'support', 'help', 'api', 'app', 'www', 'root', 'system',
  'dashboard', 'jobs', 'pay', 'receipt', 'requests', 'settings', 'login', 'signup',
  'about', 'terms', 'privacy', 'security', 'status', 'null', 'undefined',
])

export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

function assertValidHandle(handle: string) {
  if (!HANDLE_PATTERN.test(handle)) {
    throw new ApiError('Handles are 3–20 characters, using a–z, 0–9 and underscore.', 400)
  }
  if (RESERVED.has(handle)) throw new ApiError('That handle is reserved.', 409)
}

export async function claimUsername(input: {
  handle: string
  address: string
  chainKey: string
  issuedAt: number
  signature: string
}) {
  const handle = normaliseHandle(input.handle)
  assertValidHandle(handle)

  const chain = getChain(input.chainKey)
  if (!chain) throw new ApiError(`Unknown chain "${input.chainKey}".`, 400)
  if (chain.family !== 'evm') {
    // Verifying a Solana signature needs ed25519 and a Solana wallet to produce it. Neither is
    // wired up, so claiming from a non-EVM wallet is refused rather than trusted.
    throw new ApiError(`Claiming from ${chain.name} is not supported yet — claim from an EVM wallet.`, 409)
  }
  if (!isAddress(input.address)) throw new ApiError('Not a wallet address.', 400)

  const owner = await requireSigner({
    message: usernameClaimMessage({ handle, address: input.address, chainKey: chain.key, issuedAt: input.issuedAt }),
    signature: input.signature,
    expected: input.address,
    issuedAt: input.issuedAt,
    what: 'this handle claim',
  })

  const existing = await prisma.username.findUnique({ where: { name: handle } })
  if (existing) throw new ApiError('That handle is already taken.', 409)

  // One handle per wallet keeps resolution unambiguous in both directions.
  const alreadyOwns = await prisma.username.findFirst({ where: { ownerAddress: owner } })
  if (alreadyOwns) throw new ApiError(`That wallet already owns @${alreadyOwns.name}.`, 409)

  return prisma.username.create({
    data: {
      name: handle,
      ownerAddress: owner,
      ownerChainKey: chain.key,
      claimSignature: input.signature,
      addresses: {
        create: {
          chainKey: chain.key,
          address: owner,
          proofSignature: input.signature,
        },
      },
    },
    include: { addresses: true },
  })
}

/** Adds a verified address for another chain to a handle the caller already owns. */
export async function linkAddress(input: {
  handle: string
  chainKey: string
  address: string
  issuedAt: number
  signature: string
}) {
  const handle = normaliseHandle(input.handle)
  const username = await prisma.username.findUnique({ where: { name: handle }, include: { addresses: true } })
  if (!username) throw new ApiError('No such handle.', 404)

  const chain = getChain(input.chainKey)
  if (!chain) throw new ApiError(`Unknown chain "${input.chainKey}".`, 400)
  if (chain.family !== 'evm') {
    throw new ApiError(
      `Linking a ${chain.name} address is not supported yet: Vaulted cannot verify a signature from ` +
        `that family, and an unverified address would misdirect payments.`,
      409,
    )
  }
  if (!isAddress(input.address)) throw new ApiError('Not a wallet address.', 400)

  await requireSigner({
    message: usernameLinkMessage({ handle, address: getAddress(input.address), chainKey: chain.key, issuedAt: input.issuedAt }),
    signature: input.signature,
    expected: input.address,
    issuedAt: input.issuedAt,
    what: 'this address',
  })

  const taken = await prisma.usernameAddress.findUnique({
    where: { chainKey_address: { chainKey: chain.key, address: getAddress(input.address) } },
  })
  if (taken && taken.usernameId !== username.id) {
    throw new ApiError('That address is already linked to another handle.', 409)
  }

  return prisma.usernameAddress.upsert({
    where: { usernameId_chainKey: { usernameId: username.id, chainKey: chain.key } },
    create: {
      usernameId: username.id,
      chainKey: chain.key,
      address: getAddress(input.address),
      proofSignature: input.signature,
    },
    update: {
      address: getAddress(input.address),
      proofSignature: input.signature,
      verifiedAt: new Date(),
    },
  })
}

export async function resolveHandle(rawHandle: string) {
  const handle = normaliseHandle(rawHandle)
  if (!HANDLE_PATTERN.test(handle)) return null
  return prisma.username.findUnique({ where: { name: handle }, include: { addresses: true } })
}

/** Reverse lookup, so the UI can render `@alice` where it would otherwise print an address. */
export async function handleForAddress(address: string, chainKey?: string) {
  if (!isAddress(address)) return null
  const record = await prisma.usernameAddress.findFirst({
    where: { address: getAddress(address), ...(chainKey ? { chainKey } : {}) },
    include: { username: true },
  })
  return record?.username ?? null
}

/** Batch reverse lookup — one query for a whole list, rather than one per row. */
export async function handlesForAddresses(addresses: string[]): Promise<Record<string, string>> {
  const valid = [...new Set(addresses.filter((a) => isAddress(a)).map((a) => getAddress(a)))]
  if (valid.length === 0) return {}

  const rows = await prisma.usernameAddress.findMany({
    where: { address: { in: valid } },
    include: { username: true },
  })

  const map: Record<string, string> = {}
  for (const row of rows) map[row.address.toLowerCase()] = row.username.name
  return map
}

export function serialiseUsername(
  record: NonNullable<Awaited<ReturnType<typeof resolveHandle>>>,
) {
  return {
    handle: record.name,
    ownerAddress: record.ownerAddress,
    ownerChainKey: record.ownerChainKey,
    addresses: record.addresses.map((entry) => ({
      chainKey: entry.chainKey,
      address: entry.address,
      verifiedAt: entry.verifiedAt.toISOString(),
    })),
    createdAt: record.createdAt.toISOString(),
  }
}
