import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { defaultChain, getChain, VAULTED_CHAINS } from '../registry'
import { isSolanaAddress } from '../solana'
import { ApiError } from './auth'
import type { PrivyUser } from './privy'
import { readSession } from './session'

/**
 * Accounts and the wallet each one owns.
 *
 * Identity comes from X by way of Privy — the handle is issued by the provider, not self-asserted.
 * The wallet arrives with the account: Privy provisions an embedded wallet on first sign-in and
 * reports its address over an app-secret-authenticated call, so the address recorded here is
 * attested by the provider rather than claimed by the browser. Vaulted stores no key material and
 * cannot sign for it; only the signed-in user, through Privy, can move funds.
 *
 * Wallets linked by signature before embedded wallets existed are left exactly as they were — see
 * `LinkedWallet.provenance`.
 */

export type SessionAccount = {
  id: string
  name: string
  displayName: string | null
  avatarUrl: string | null
  primaryAddress: string | null
  wallets: { chainKey: string; address: string }[]
}

/**
 * The chain an embedded wallet is filed under.
 *
 * One row, not one per network: the same EVM account address is valid on every EVM chain, so
 * duplicating it would only make the account look like it owns nine wallets. Resolution for the
 * other EVM chains goes through the primary-address fallback in {@link resolvePayeeAddress}.
 */
function primaryEvmChainKey(): string | null {
  const preferred = defaultChain()
  if (preferred?.family === 'evm') return preferred.key
  return VAULTED_CHAINS.find((chain) => chain.family === 'evm')?.key ?? null
}

/**
 * Creates or refreshes the account behind a verified Privy session.
 *
 * Everything written here comes from {@link fetchPrivyUser}, which reads it back from Privy with
 * the app secret. Nothing in the request body reaches this function, so a caller cannot pick their
 * own handle or point their handle at an address they do not control.
 */
export async function upsertPrivyAccount(user: PrivyUser) {
  if (!user.twitter) {
    throw new ApiError(
      'That Privy account has no X profile linked. Vaulted usernames come from X, so sign in with X.',
      409,
    )
  }

  const handle = user.twitter.username.toLowerCase()
  const profile = {
    twitterId: user.twitter.subject,
    privyUserId: user.id,
    displayName: user.twitter.name,
    avatarUrl: user.twitter.profilePictureUrl,
  }

  // Match on the most stable identifier available, in order. The Privy DID is the identity this
  // deployment issues sessions against; the Twitter subject adopts an account created by the
  // earlier OAuth flow; the handle is last because handles can be renamed and reused.
  const existing =
    (await prisma.account.findUnique({ where: { privyUserId: user.id } })) ??
    (await prisma.account.findUnique({ where: { twitterId: user.twitter.subject } })) ??
    (await prisma.account.findUnique({ where: { name: handle } }))

  let account
  if (existing) {
    if (existing.privyUserId && existing.privyUserId !== user.id) {
      throw new ApiError('That handle already belongs to another Vaulted account.', 409)
    }
    if (existing.twitterId && existing.twitterId !== user.twitter.subject) {
      throw new ApiError('That handle already belongs to another Vaulted account.', 409)
    }
    account = await prisma.account.update({
      where: { id: existing.id },
      // The account is keyed on the immutable X user id, so a rename follows the same account.
      data: { ...profile, name: handle },
    })
  } else {
    account = await prisma.account.create({ data: { ...profile, name: handle } })
  }

  let attached = false
  if (user.embeddedWallet) {
    await recordEmbeddedWallet(account.id, user.embeddedWallet.address)
    attached = true
  }
  if (user.solanaWallet) {
    await recordSolanaWallet(account.id, user.solanaWallet.address)
    attached = true
  }

  if (attached) {
    // Re-read: the row above was fetched before the wallets were attached, and returning it would
    // report a null address for an account that now has one.
    return prisma.account.findUniqueOrThrow({ where: { id: account.id } })
  }

  return account
}

/**
 * Records the Privy-assigned wallet against the account.
 *
 * There is no signature to check and none is invented: the proof is that Privy returned this
 * address for this account over an authenticated call, and `provenance` says so rather than
 * leaving a blank where a signature used to be.
 */
async function recordEmbeddedWallet(accountId: string, rawAddress: string) {
  if (!isAddress(rawAddress)) {
    throw new ApiError('Privy returned an address that is not a valid EVM address.', 502)
  }
  const address = getAddress(rawAddress)

  const conflicting = await prisma.linkedWallet.findMany({
    where: { address, usernameId: { not: accountId } },
  })
  if (conflicting.length > 0) {
    throw new ApiError('That wallet is already recorded against another Vaulted account.', 409)
  }

  const chainKey = primaryEvmChainKey()
  if (!chainKey) throw new ApiError('This deployment knows of no EVM chain to file the wallet under.', 500)

  await prisma.$transaction([
    prisma.linkedWallet.upsert({
      where: { usernameId_chainKey: { usernameId: accountId, chainKey } },
      create: { usernameId: accountId, chainKey, address, provenance: 'PRIVY_EMBEDDED' },
      update: { address, provenance: 'PRIVY_EMBEDDED', proofSignature: null, verifiedAt: new Date() },
    }),
    prisma.account.update({
      where: { id: accountId },
      data: { ownerAddress: address, ownerChainKey: chainKey, claimSignature: null },
    }),
  ])
}

/**
 * Records the account's Solana address.
 *
 * Filed under the production Solana network and never against an EVM key, so `resolvePayeeAddress`
 * — which refuses to cross chain families — hands out the right address for the right rail. The
 * primary address is left alone: it is the EVM one, and escrow lives there.
 */
async function recordSolanaWallet(accountId: string, address: string) {
  if (!isSolanaAddress(address)) {
    throw new ApiError('Privy returned an address that is not a valid Solana address.', 502)
  }

  const chainKey = VAULTED_CHAINS.find((chain) => chain.family === 'svm' && chain.tier === 'production')?.key
  if (!chainKey) return

  const conflicting = await prisma.linkedWallet.findMany({
    where: { address, usernameId: { not: accountId } },
  })
  if (conflicting.length > 0) {
    throw new ApiError('That Solana wallet is already recorded against another Vaulted account.', 409)
  }

  await prisma.linkedWallet.upsert({
    where: { usernameId_chainKey: { usernameId: accountId, chainKey } },
    create: { usernameId: accountId, chainKey, address, provenance: 'PRIVY_EMBEDDED' },
    update: { address, provenance: 'PRIVY_EMBEDDED', proofSignature: null, verifiedAt: new Date() },
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
 * The EVM addresses among an account's wallets.
 *
 * An account now holds a wallet per rail, and these are fed to viem, which throws on anything that
 * is not a 20-byte hex address. Passing the Solana one in is what made Activity, My work and My
 * jobs return 500 for every account that had one. Filtering here rather than at each call site
 * means the next rail added cannot break them again.
 */
export function evmAddressesOf(account: Pick<SessionAccount, 'wallets' | 'primaryAddress'> | null): string[] {
  const candidates = [
    ...(account?.wallets.map((wallet) => wallet.address) ?? []),
    ...(account?.primaryAddress ? [account.primaryAddress] : []),
  ]
  return [...new Set(candidates.filter((value) => isAddress(value)).map((value) => getAddress(value)))]
}

export async function accountByHandle(rawHandle: string) {
  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase()
  if (!handle) return null
  return prisma.account.findUnique({ where: { name: handle }, include: { addresses: true } })
}

/**
 * Resolves `@handle` to the wallet that should be paid on a given chain.
 *
 * The fallback to the primary address only crosses chains within the same family. An EVM account
 * address is the same on every EVM chain, so that fallback is sound; handing an EVM address back
 * for a Solana payment would send real money nowhere.
 */
export async function resolvePayeeAddress(handle: string, chainKey: string): Promise<string | null> {
  const account = await accountByHandle(handle)
  if (!account) return null

  const onChain = account.addresses.find((entry) => entry.chainKey === chainKey)
  if (onChain) return onChain.address

  if (!account.ownerAddress || !account.ownerChainKey) return null
  const requested = getChain(chainKey)
  const owner = getChain(account.ownerChainKey)
  if (!requested || !owner || requested.family !== owner.family) return null
  return account.ownerAddress
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
