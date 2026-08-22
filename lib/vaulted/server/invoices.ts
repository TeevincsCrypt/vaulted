import { getAddress, isAddress, recoverMessageAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { getVaultedConfig, isConfigured, ZERO_ADDRESS } from '../config'
import {
  computeEscrowId,
  detailsHash as computeDetailsHash,
  escrowSalt,
  invoiceCreationMessage,
  isValidInvoiceId,
  type InvoiceTerms,
} from '../invoice'
import { displayStatus, EscrowState, type DisplayStatus } from '../status'
import { readEscrow } from './chain'

export class InvoiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const MAX_DESCRIPTION_LENGTH = 500
/** uint96 ceiling — the widest amount `VaultedEscrow` can store. */
const MAX_ESCROW_AMOUNT = BigInt('79228162514264337593543950335')
const MIN_PROTECTION_PERIOD = 60 * 60
const MAX_PROTECTION_PERIOD = 365 * 24 * 60 * 60

export type CreateInvoiceInput = {
  invoiceId: string
  chainId: number
  payee: string
  payer?: string | null
  amount: string
  description: string
  protectionPeriod: number
  fundingDeadline?: number | null
  signature: string
}

/**
 * Publishes a payment request.
 *
 * The payee's signature over the canonical terms is verified before anything is stored, so a link
 * can only ever be published by the wallet that will receive the money. Note what this does and
 * does not do: it authenticates the metadata behind the link. It creates no escrow and moves no
 * funds — the payee still has to send `createEscrow` from the same wallet, and the payment page
 * checks the on-chain `detailsHash` against these terms before inviting anyone to pay.
 */
export async function createInvoice(input: CreateInvoiceInput) {
  if (!isValidInvoiceId(input.invoiceId)) {
    throw new InvoiceError('Invalid invoice id.', 400)
  }
  if (!isAddress(input.payee)) throw new InvoiceError('payee must be a wallet address.', 400)
  if (input.payer && !isAddress(input.payer)) throw new InvoiceError('payer must be a wallet address.', 400)

  const config = getVaultedConfig(input.chainId)
  if (!isConfigured(config)) throw new InvoiceError(config.message, 503)

  const payee = getAddress(input.payee)
  const payer = input.payer ? getAddress(input.payer) : ZERO_ADDRESS
  if (payer !== ZERO_ADDRESS && payer.toLowerCase() === payee.toLowerCase()) {
    throw new InvoiceError('The client and the payee cannot be the same wallet.', 400)
  }

  let amount: bigint
  try {
    amount = BigInt(input.amount)
  } catch {
    throw new InvoiceError('amount must be an integer string in token base units.', 400)
  }
  if (amount <= BigInt(0)) throw new InvoiceError('amount must be greater than zero.', 400)
  if (amount > MAX_ESCROW_AMOUNT) throw new InvoiceError('amount exceeds what the escrow can hold.', 400)

  const description = input.description.trim()
  if (!description) throw new InvoiceError('description is required.', 400)
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvoiceError(`description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, 400)
  }

  const protectionPeriod = Number(input.protectionPeriod) || config.defaultProtectionPeriod
  if (protectionPeriod < MIN_PROTECTION_PERIOD || protectionPeriod > MAX_PROTECTION_PERIOD) {
    throw new InvoiceError('protectionPeriod must be between 1 hour and 365 days.', 400)
  }

  const fundingDeadline = input.fundingDeadline ? Math.floor(input.fundingDeadline) : 0
  if (fundingDeadline !== 0 && fundingDeadline <= Math.floor(Date.now() / 1000)) {
    throw new InvoiceError('fundingDeadline must be in the future.', 400)
  }

  const terms: InvoiceTerms = {
    invoiceId: input.invoiceId,
    chainId: config.chainId,
    escrowAddress: config.escrowAddress,
    tokenAddress: config.token.address,
    payee,
    payer,
    amount: amount.toString(),
    description,
    protectionPeriod,
    fundingDeadline,
  }

  const signer = await recoverMessageAddress({
    message: invoiceCreationMessage(terms),
    signature: input.signature as `0x${string}`,
  }).catch(() => null)

  if (!signer || signer.toLowerCase() !== payee.toLowerCase()) {
    throw new InvoiceError('Signature does not match the payee wallet.', 401)
  }

  const salt = escrowSalt(input.invoiceId)
  const escrowId = computeEscrowId({
    chainId: config.chainId,
    escrowAddress: config.escrowAddress,
    payee,
    salt,
  })

  const existing = await prisma.invoice.findUnique({ where: { id: input.invoiceId } })
  if (existing) throw new InvoiceError('That invoice id is already taken.', 409)

  return prisma.invoice.create({
    data: {
      id: input.invoiceId,
      salt,
      escrowId,
      chainId: config.chainId,
      escrowAddress: config.escrowAddress,
      tokenAddress: config.token.address,
      tokenSymbol: config.token.symbol,
      tokenDecimals: config.token.decimals,
      payeeAddress: payee,
      payerAddress: payer === ZERO_ADDRESS ? null : payer,
      amount: amount.toString(),
      description,
      detailsHash: computeDetailsHash(terms),
      protectionPeriod,
      fundingDeadline: fundingDeadline ? new Date(fundingDeadline * 1000) : null,
      creationSignature: input.signature,
      indexedStatus: 'AWAITING_CHAIN',
    },
  })
}

export async function getInvoice(invoiceId: string) {
  if (!isValidInvoiceId(invoiceId)) return null
  return prisma.invoice.findUnique({ where: { id: invoiceId } })
}

export async function listInvoices(filter: { payee?: string; payer?: string; limit?: number }) {
  const where: Record<string, unknown> = {}
  if (filter.payee && isAddress(filter.payee)) where.payeeAddress = getAddress(filter.payee)
  if (filter.payer && isAddress(filter.payer)) where.payerAddress = getAddress(filter.payer)
  if (!where.payeeAddress && !where.payerAddress) {
    throw new InvoiceError('Provide a payee or payer address to list invoices.', 400)
  }

  return prisma.invoice.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.limit ?? 50, 200),
  })
}

/**
 * Records a transaction hash the client reported. Purely a convenience for showing explorer links —
 * the hash is never treated as proof that anything happened. {syncInvoice} reads the chain for that.
 */
export async function recordTransaction(
  invoiceId: string,
  field: 'createTxHash' | 'fundTxHash' | 'settleTxHash',
  hash: string,
) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new InvoiceError('Not a transaction hash.', 400)
  const invoice = await getInvoice(invoiceId)
  if (!invoice) throw new InvoiceError('Invoice not found.', 404)
  return prisma.invoice.update({ where: { id: invoiceId }, data: { [field]: hash } })
}

export type InvoiceWithChain = {
  invoice: Awaited<ReturnType<typeof getInvoice>>
  onChain: Awaited<ReturnType<typeof readEscrow>>
  /** True when the escrow's on-chain terms commitment matches the metadata we are serving. */
  termsMatch: boolean | null
}

/**
 * Re-reads the escrow and caches what it saw. Returns both the row and the raw chain result so the
 * caller can show the live state — and, when the RPC is unreachable, say so instead of pretending
 * the cached status is current.
 */
export async function syncInvoice(invoiceId: string): Promise<InvoiceWithChain> {
  const invoice = await getInvoice(invoiceId)
  if (!invoice) throw new InvoiceError('Invoice not found.', 404)

  const onChain = await readEscrow(invoice.escrowId as `0x${string}`, invoice.chainId)
  if (!onChain.ok) return { invoice, onChain, termsMatch: null }

  const escrow = onChain.escrow
  const termsMatch = escrow.detailsHash.toLowerCase() === invoice.detailsHash.toLowerCase()
  const status: DisplayStatus = displayStatus(escrow.state, escrow.isExpired)

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      indexedStatus: status,
      indexedAt: new Date(),
      indexedBlock: escrow.blockNumber,
      fundedAt: escrow.fundedAt ? new Date(escrow.fundedAt * 1000) : null,
      expiresAt: escrow.expiresAt ? new Date(escrow.expiresAt * 1000) : null,
      fundedByAddress:
        escrow.state !== EscrowState.Created && escrow.payer !== ZERO_ADDRESS ? escrow.payer : null,
    },
  })

  return { invoice: updated, onChain, termsMatch }
}

/** Shapes a row for JSON: BigInt and Date are not serialisable as-is. */
export function serialiseInvoice(invoice: NonNullable<Awaited<ReturnType<typeof getInvoice>>>) {
  return {
    invoiceId: invoice.id,
    escrowId: invoice.escrowId,
    salt: invoice.salt,
    chainId: invoice.chainId,
    escrowAddress: invoice.escrowAddress,
    token: {
      address: invoice.tokenAddress,
      symbol: invoice.tokenSymbol,
      decimals: invoice.tokenDecimals,
    },
    payee: invoice.payeeAddress,
    payer: invoice.payerAddress,
    fundedBy: invoice.fundedByAddress,
    amount: invoice.amount,
    description: invoice.description,
    detailsHash: invoice.detailsHash,
    protectionPeriod: invoice.protectionPeriod,
    fundingDeadline: invoice.fundingDeadline ? Math.floor(invoice.fundingDeadline.getTime() / 1000) : 0,
    /**
     * Last status seen on chain. Advisory: the client reads the contract itself and that read wins.
     */
    indexedStatus: invoice.indexedStatus,
    indexedAt: invoice.indexedAt?.toISOString() ?? null,
    indexedBlock: invoice.indexedBlock?.toString() ?? null,
    fundedAt: invoice.fundedAt ? Math.floor(invoice.fundedAt.getTime() / 1000) : null,
    expiresAt: invoice.expiresAt ? Math.floor(invoice.expiresAt.getTime() / 1000) : null,
    transactions: {
      create: invoice.createTxHash,
      fund: invoice.fundTxHash,
      settle: invoice.settleTxHash,
    },
    createdAt: invoice.createdAt.toISOString(),
  }
}

export function serialiseChainRead(result: Awaited<ReturnType<typeof readEscrow>>) {
  if (!result.ok) return { available: false as const, reason: result.reason }
  const e = result.escrow
  return {
    available: true as const,
    state: e.state,
    status: e.status,
    payer: e.payer,
    payee: e.payee,
    amount: e.amount.toString(),
    createdAt: e.createdAt,
    fundedAt: e.fundedAt,
    expiresAt: e.expiresAt,
    fundingDeadline: e.fundingDeadline,
    protectionPeriod: e.protectionPeriod,
    detailsHash: e.detailsHash,
    isExpired: e.isExpired,
    canTimeout: e.canTimeout,
    canDispute: e.canDispute,
    secondsUntilExpiry: e.secondsUntilExpiry,
    blockNumber: e.blockNumber.toString(),
  }
}
