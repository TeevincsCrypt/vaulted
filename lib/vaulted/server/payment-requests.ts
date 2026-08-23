import { randomBytes } from 'node:crypto'
import { getAddress, isAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { getChain, paymentChains, type VaultedChain } from '../registry'
import { isSolanaAddress, isSolanaSignature } from '../solana'
import { ApiError } from './auth'
import { accountByHandle, requireAccount } from './accounts'
import { serverRpcUrl } from './rpc'
import { verifyPayment } from './verify-payment'

/**
 * Direct payment requests.
 *
 * "Pay me $250" — settled by a transfer to the creator's wallet, not by escrow. That is what makes
 * it work on Solana and on Base today: it needs a token and an RPC, not a deployed contract.
 *
 * The rules that matter are all about who gets to say what:
 *
 *   The recipient comes from the creator's recorded wallet, never from the request body. A payee
 *   address a browser can choose is a payee address an attacker can choose.
 *
 *   PAID is set here and only here, after {@link verifyPayment} has read the transaction back off
 *   the network. A payer submitting a hash is making a claim; the chain settles it.
 *
 *   Cancelling is the creator's alone, and only while the request is still pending — cancelling
 *   something already paid would misreport a settled payment.
 */

export type PaymentRequestStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED'

export class PaymentRequestError extends Error {
  readonly status: number
  private readonly __vaultedPaymentRequestError = true

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'PaymentRequestError'
    this.status = status
  }

  static is(value: unknown): value is PaymentRequestError {
    return typeof value === 'object' && value !== null && '__vaultedPaymentRequestError' in value
  }
}

/** Prefixed so `/pay/{id}` can tell a payment request from an escrowed invoice (`v_…`). */
export function generatePaymentRequestId(): string {
  return `pr_${randomBytes(10).toString('hex')}`
}

export const PAYMENT_REQUEST_ID_PATTERN = /^pr_[0-9a-f]{20}$/

export function isPaymentRequestId(value: string): boolean {
  return PAYMENT_REQUEST_ID_PATTERN.test(value)
}

/** What a payer is allowed to see. No creator id, no internal fields. */
export type PublicPaymentRequest = {
  id: string
  amount: string
  currency: string
  decimals: number
  network: string
  networkName: string
  networkFamily: 'evm' | 'svm'
  description: string
  status: PaymentRequestStatus
  recipientAddress: string
  recipientHandle: string | null
  /** Set when the request is addressed to a Vaulted account rather than being an open link. */
  payerHandle: string | null
  /** Set when this payment is a job's budget, paid directly because the network has no escrow. */
  jobId: string | null
  txHash: string | null
  paidAmount: string | null
  paidAt: string | null
  expiresAt: string | null
  createdAt: string
  explorerUrl: string | null
}

function chainOrThrow(networkKey: string): VaultedChain {
  const chain = getChain(networkKey)
  if (!chain) {
    throw new PaymentRequestError(
      `"${networkKey}" is not a network this deployment supports.`,
      400,
    )
  }
  if (!chain.capabilities.transfer || !chain.token) {
    throw new PaymentRequestError(`${chain.name} cannot settle payments in this deployment.`, 409)
  }
  return chain
}

/** Expiry is derived, not stored twice: a pending request past its date is expired. */
function effectiveStatus(row: { status: string; expiresAt: Date | null }): PaymentRequestStatus {
  if (row.status === 'PENDING' && row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return 'EXPIRED'
  }
  return row.status as PaymentRequestStatus
}

function serialise(
  row: {
    id: string
    amount: string
    currency: string
    network: string
    description: string
    status: string
    recipientAddress: string
    payerAccountId?: string | null
    jobId?: string | null
    txHash: string | null
    paidAmount: string | null
    paidAt: Date | null
    expiresAt: Date | null
    createdAt: Date
  },
  recipientHandle: string | null,
  payerHandle: string | null = null,
): PublicPaymentRequest {
  const chain = getChain(row.network)
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    decimals: chain?.token?.decimals ?? 6,
    network: row.network,
    networkName: chain?.name ?? row.network,
    networkFamily: chain?.family ?? 'evm',
    description: row.description,
    status: effectiveStatus(row),
    recipientAddress: row.recipientAddress,
    recipientHandle,
    payerHandle,
    jobId: row.jobId ?? null,
    txHash: row.txHash,
    paidAmount: row.paidAmount,
    paidAt: row.paidAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    explorerUrl:
      chain && row.txHash
        ? chain.family === 'svm'
          ? `${chain.explorerUrl}/tx/${row.txHash}${chain.cluster === 'mainnet-beta' ? '' : `?cluster=${chain.cluster}`}`
          : `${chain.explorerUrl?.replace(/\/$/, '')}/tx/${row.txHash}`
        : null,
  }
}

/**
 * Creates a payment request for the signed-in account.
 *
 * The address is looked up, not accepted: whichever wallet the account has recorded for that
 * network is where the money will be asked to go.
 */
export async function createPaymentRequest(input: {
  network: string
  /** Base units, as a decimal string. */
  amount: string
  description: string
  /** Hours until it expires. Omitted means it never does. */
  expiresInHours?: number | null
  /** Optional `@handle` to address it to, so it lands in that person's list of what they owe. */
  toHandle?: string | null
}): Promise<PublicPaymentRequest> {
  const account = await requireAccount()
  const chain = chainOrThrow(input.network)

  let amount: bigint
  try {
    amount = BigInt(input.amount)
  } catch {
    throw new PaymentRequestError('That amount is not a whole number of base units.', 400)
  }
  if (amount <= 0n) throw new PaymentRequestError('A payment request must be for more than zero.', 400)

  const description = input.description.trim()
  if (!description) throw new PaymentRequestError('Say what the payment is for.', 400)
  if (description.length > 500) throw new PaymentRequestError('That description is too long.', 400)

  const wallet = await prisma.linkedWallet.findUnique({
    where: { usernameId_chainKey: { usernameId: account.id, chainKey: chain.key } },
  })
  const recipientAddress = wallet?.address
  if (!recipientAddress) {
    throw new PaymentRequestError(
      `No ${chain.name} wallet is recorded for @${account.name}, so there is nowhere for the money ` +
        'to go. Sign out and back in to have one assigned.',
      409,
    )
  }

  // Belt and braces: a wallet filed under the wrong family would misdirect real money.
  const wellFormed = chain.family === 'svm' ? isSolanaAddress(recipientAddress) : isAddress(recipientAddress)
  if (!wellFormed) {
    throw new PaymentRequestError(
      `The wallet recorded for ${chain.name} is not a valid ${chain.family === 'svm' ? 'Solana' : 'EVM'} address.`,
      500,
    )
  }

  /*
    Addressing it to somebody is a lookup, not a free-text field: the handle has to resolve to a
    real account, and it cannot be your own — a request to yourself would sit in your own list of
    debts forever. An unaddressed request stays an open link, which is still the default.
  */
  let payerAccountId: string | null = null
  let payerHandle: string | null = null
  const wanted = input.toHandle?.trim().replace(/^@/, '')
  if (wanted) {
    const payer = await accountByHandle(wanted)
    if (!payer) throw new PaymentRequestError(`No Vaulted account called @${wanted}.`, 404)
    if (payer.id === account.id) {
      throw new PaymentRequestError('You cannot address a payment request to yourself.', 400)
    }
    payerAccountId = payer.id
    payerHandle = payer.name
  }

  const expiresAt =
    input.expiresInHours && input.expiresInHours > 0
      ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
      : null

  const row = await prisma.paymentRequest.create({
    data: {
      id: generatePaymentRequestId(),
      creatorId: account.id,
      amount: amount.toString(),
      currency: chain.token?.symbol ?? 'TOKEN',
      network: chain.key,
      description,
      recipientAddress,
      payerAccountId,
      expiresAt,
    },
  })

  return serialise(row, account.name, payerHandle)
}

/**
 * What this account has been asked to pay.
 *
 * The mirror of {@link listPaymentRequests}. Only requests explicitly addressed to them appear —
 * an open link has no addressee and belongs in nobody's list of debts.
 */
export async function listIncomingPaymentRequests(): Promise<PublicPaymentRequest[]> {
  const account = await requireAccount()
  const rows = await prisma.paymentRequest.findMany({
    where: { payerAccountId: account.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { creator: { select: { name: true } } },
  })
  return rows.map((row) => serialise(row, row.creator.name, account.name))
}

/** Everything the signed-in account has asked for. */
export async function listPaymentRequests(): Promise<PublicPaymentRequest[]> {
  const account = await requireAccount()
  const rows = await prisma.paymentRequest.findMany({
    where: { creatorId: account.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { payer: { select: { name: true } } },
  })
  return rows.map((row) => serialise(row, account.name, row.payer?.name ?? null))
}

/** Public: this is what a payment link resolves to, and it has to work signed out. */
export async function getPaymentRequest(id: string): Promise<PublicPaymentRequest | null> {
  if (!isPaymentRequestId(id)) return null
  const row = await prisma.paymentRequest.findUnique({
    where: { id },
    include: { creator: { select: { name: true } }, payer: { select: { name: true } } },
  })
  return row ? serialise(row, row.creator.name, row.payer?.name ?? null) : null
}

/**
 * Checks a claimed transaction against the network, and marks the request paid if it holds up.
 *
 * Open to anyone, on purpose: the person who can prove a payment is the payer, and they are not
 * signed in. That is safe because nothing here is taken on trust — the hash is checked against the
 * chain, and the only thing a caller can achieve by lying is a rejection.
 */
export async function verifyPaymentRequest(
  id: string,
  reference: string,
): Promise<{ request: PublicPaymentRequest; verified: boolean; reason?: string; pending?: boolean }> {
  const row = await prisma.paymentRequest.findUnique({
    where: { id },
    include: { creator: { select: { name: true } } },
  })
  if (!row) throw new PaymentRequestError('No such payment request.', 404)

  const current = effectiveStatus(row)

  // Already settled: report it rather than re-reading the chain. Idempotent by design, because a
  // payer refreshing the page must not produce a second answer.
  if (current === 'PAID') {
    return { request: serialise(row, row.creator.name), verified: true }
  }
  if (current === 'CANCELLED') {
    throw new PaymentRequestError('That payment request was cancelled.', 409)
  }
  if (current === 'EXPIRED') {
    throw new PaymentRequestError('That payment request has expired.', 409)
  }

  const chain = chainOrThrow(row.network)
  const trimmed = reference.trim()
  if (!trimmed) throw new PaymentRequestError('Provide the transaction to check.', 400)

  // Reject the obviously wrong shape before spending an RPC call on it.
  const plausible = chain.family === 'svm' ? isSolanaSignature(trimmed) : /^0x[0-9a-fA-F]{64}$/.test(trimmed)
  if (!plausible) {
    throw new PaymentRequestError(
      chain.family === 'svm'
        ? 'That is not a Solana transaction signature.'
        : 'That is not an EVM transaction hash.',
      400,
    )
  }

  const check = await verifyPayment({
    chain,
    reference: trimmed,
    recipient: row.recipientAddress,
    amount: BigInt(row.amount),
    rpcUrl: chain.family === 'evm' ? serverRpcUrl() : null,
  })

  if (!check.paid) {
    return {
      request: serialise(row, row.creator.name),
      verified: false,
      reason: check.reason,
      pending: check.pending,
    }
  }

  const updated = await prisma.paymentRequest.update({
    where: { id: row.id },
    data: {
      status: 'PAID',
      txHash: trimmed,
      paidAmount: check.amount,
      paidAt: new Date(),
    },
  })

  return { request: serialise(updated, row.creator.name), verified: true }
}

/** The creator's alone, and only while nothing has been paid. */
export async function cancelPaymentRequest(id: string): Promise<PublicPaymentRequest> {
  const account = await requireAccount()
  const row = await prisma.paymentRequest.findUnique({ where: { id } })
  if (!row) throw new PaymentRequestError('No such payment request.', 404)
  if (row.creatorId !== account.id) {
    // Same answer as a missing one: whether somebody else's request exists is not the caller's
    // business.
    throw new PaymentRequestError('No such payment request.', 404)
  }

  const current = effectiveStatus(row)
  if (current === 'PAID') {
    throw new PaymentRequestError('That payment request was already paid, so it cannot be cancelled.', 409)
  }
  if (current === 'CANCELLED') return serialise(row, account.name)

  const updated = await prisma.paymentRequest.update({
    where: { id: row.id },
    data: { status: 'CANCELLED' },
  })
  return serialise(updated, account.name)
}

/**
 * The payment request that stands in for a job's budget where escrow cannot.
 *
 * On a network with no VaultedEscrow — Solana today, Base until it is deployed — there is nothing
 * to hold the money, so the alternative to "no jobs at all" is an honest direct payment: the client
 * pays the worker, the server verifies it, and the job is funded. What it is *not* is escrow, and
 * every surface that shows it says so. The money is the worker's the moment it lands.
 *
 * Called from the hire step, so the creator is the worker being paid and the payer is the client —
 * neither is taken from a request body.
 */
export async function createJobPaymentRequest(input: {
  jobId: string
  network: string
  amount: string
  description: string
  workerAccountId: string
  clientAccountId: string
}): Promise<PublicPaymentRequest | null> {
  const chain = getChain(input.network)
  if (!chain?.capabilities.transfer || !chain.token) return null

  const existing = await prisma.paymentRequest.findUnique({ where: { jobId: input.jobId } })
  if (existing) return serialise(existing, null)

  const wallet = await prisma.linkedWallet.findUnique({
    where: { usernameId_chainKey: { usernameId: input.workerAccountId, chainKey: chain.key } },
  })
  if (!wallet?.address) {
    throw new PaymentRequestError(
      `The person you hired has no ${chain.name} wallet recorded, so there is nowhere to send the ` +
        'budget. Ask them to sign in again.',
      409,
    )
  }

  const row = await prisma.paymentRequest.create({
    data: {
      id: generatePaymentRequestId(),
      creatorId: input.workerAccountId,
      payerAccountId: input.clientAccountId,
      jobId: input.jobId,
      amount: input.amount,
      currency: chain.token.symbol,
      network: chain.key,
      description: input.description,
      recipientAddress: wallet.address,
    },
  })
  return serialise(row, null)
}

/** Networks a payment request can be raised on, for the create form. */
export function availablePaymentNetworks() {
  return paymentChains().map((chain) => ({
    key: chain.key,
    name: chain.name,
    shortName: chain.shortName,
    family: chain.family,
    symbol: chain.token?.symbol ?? 'TOKEN',
    decimals: chain.token?.decimals ?? 6,
  }))
}

/** Normalises an EVM address for display without throwing on a Solana one. */
export function displayAddress(address: string, family: 'evm' | 'svm'): string {
  if (family === 'evm' && isAddress(address)) return getAddress(address)
  return address
}

export { ApiError }
