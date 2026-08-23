import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { usernameLinkMessage } from '../messages'
import { getChain } from '../registry'
import { ApiError, requireSigner } from './auth'
import { readSession } from './session'

/**
 * Accounts and their verified wallets.
 *
 * Identity comes from Twitter — the handle is issued by the provider, not self-asserted. Wallets
 * are a separate, cryptographic step: signing in tells us who you are, signing a message tells us
 * which wallet is yours, and only the second is trusted for payments.
 */

export type SessionAccount = {
  id: string
  name: string
  displayName: string | null
  avatarUrl: string | null
  primaryAddress: string | null
  wallets: { chainKey: string; address: string }[]
}

/** Creates the account on first login, and keeps handle/avatar in step with Twitter after that. */
export async function upsertTwitterAccount(profile: {
  id: string
  username: string
  name: string
  avatarUrl: string | null
}) {
  const handle = profile.username.toLowerCase()

  const existingById = await prisma.account.findUnique({ where: { twitterId: profile.id } })
  if (existingById) {
    return prisma.account.update({
      where: { id: existingById.id },
      // The handle is keyed on the immutable Twitter id, so a rename follows the same account.
      data: { name: handle, displayName: profile.name, avatarUrl: profile.avatarUrl },
    })
  }

  const existingByName = await prisma.account.findUnique({ where: { name: handle } })
  if (existingByName) {
    if (existingByName.twitterId && existingByName.twitterId !== profile.id) {
      throw new ApiError('That handle already belongs to another account.', 409)
    }
    return prisma.account.update({
      where: { id: existingByName.id },
      data: { twitterId: profile.id, displayName: profile.name, avatarUrl: profile.avatarUrl },
    })
  }

  return prisma.account.create({
    data: { twitterId: profile.id, name: handle, displayName: profile.name, avatarUrl: profile.avatarUrl },
  })
}

export async function currentAccount(): Promise<SessionAccount | null> {
  const session = await readSession()
  if (!session) return null

  const account = await prisma.account.findUnique({
    where: { id: session.accountId },
    include: { addresses: true },
  })
  if (!account) return null

  return {
    id: account.id,
    name: account.name,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    primaryAddress: account.ownerAddress,
    wallets: account.addresses.map((entry) => ({ chainKey: entry.chainKey, address: entry.address })),
  }
}

/** For API routes that must not run for a signed-out visitor. */
export async function requireAccount(): Promise<SessionAccount> {
  const account = await currentAccount()
  if (!account) throw new ApiError('Sign in to continue.', 401)
  return account
}

/**
 * Attaches a wallet to the signed-in account, proven by signature.
 *
 * Being signed in is not enough — without the signature anyone could point their handle at someone
 * else's wallet, or claim a wallet they do not control.
 */
export async function linkWallet(input: {
  accountId: string
  handle: string
  chainKey: string
  address: string
  issuedAt: number
  signature: string
}) {
  const chain = getChain(input.chainKey)
  if (!chain) throw new ApiError(`Unknown chain "${input.chainKey}".`, 400)
  if (chain.family !== 'evm') {
    throw new ApiError(
      `Linking a ${chain.name} wallet is not supported yet: Vaulted cannot verify a signature from ` +
        'that family, and an unverified address would misdirect payments.',
      409,
    )
  }
  if (!isAddress(input.address)) throw new ApiError('Not a wallet address.', 400)
  const address = getAddress(input.address)

  await requireSigner({
    message: usernameLinkMessage({
      handle: input.handle,
      address,
      chainKey: chain.key,
      issuedAt: input.issuedAt,
    }),
    signature: input.signature,
    expected: address,
    issuedAt: input.issuedAt,
    what: 'this wallet',
  })

  const taken = await prisma.linkedWallet.findUnique({
    where: { chainKey_address: { chainKey: chain.key, address } },
  })
  if (taken && taken.usernameId !== input.accountId) {
    throw new ApiError('That wallet is already linked to another account.', 409)
  }

  await prisma.$transaction([
    prisma.linkedWallet.upsert({
      where: { usernameId_chainKey: { usernameId: input.accountId, chainKey: chain.key } },
      create: {
        usernameId: input.accountId,
        chainKey: chain.key,
        address,
        proofSignature: input.signature,
      },
      update: { address, proofSignature: input.signature, verifiedAt: new Date() },
    }),
    prisma.account.update({
      where: { id: input.accountId },
      // The first linked wallet becomes the primary one payments resolve to.
      data: { ownerAddress: address, ownerChainKey: chain.key, claimSignature: input.signature },
    }),
  ])

  return currentAccount()
}

export async function accountByHandle(rawHandle: string) {
  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase()
  if (!handle) return null
  return prisma.account.findUnique({ where: { name: handle }, include: { addresses: true } })
}

/** Resolves `@handle` to the wallet that should be paid on a given chain. */
export async function resolvePayeeAddress(handle: string, chainKey: string): Promise<string | null> {
  const account = await accountByHandle(handle)
  if (!account) return null
  const onChain = account.addresses.find((entry) => entry.chainKey === chainKey)
  return onChain?.address ?? account.ownerAddress ?? null
}

export async function accountForAddress(address: string) {
  if (!isAddress(address)) return null
  const link = await prisma.linkedWallet.findFirst({
    where: { address: getAddress(address) },
    include: { account: true },
  })
  return link?.account ?? null
}

/** Batch reverse lookup — one query for a list, rather than one per row. */
export async function handlesForAddresses(addresses: string[]): Promise<Record<string, string>> {
  const valid = [...new Set(addresses.filter((a) => isAddress(a)).map((a) => getAddress(a)))]
  if (valid.length === 0) return {}

  const rows = await prisma.linkedWallet.findMany({
    where: { address: { in: valid } },
    include: { account: true },
  })

  const map: Record<string, string> = {}
  for (const row of rows) map[row.address.toLowerCase()] = row.account.name
  return map
}
