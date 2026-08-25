import { getAddress, isAddress, recoverMessageAddress } from 'viem'
import { prisma } from '@/lib/prisma'
import { getVaultedConfig, isConfigured, ZERO_ADDRESS } from '../config'
import { getChainByEvmId } from '../registry'
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
import { currentAccount, evmAddressesOf } from './accounts'
import { notifyEscrowTransition, notifyPaymentRequested } from './notifications'

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
  /** Zero address for the chain's own currency; otherwise the deployment's token. */
  asset?: string | null
  amount: string
  description: string
  protectionPeriod: number
  fundingDeadline?: number | null
  signature: string
  /** Which side signed. Defaults to the payee, which is how a raised request works. */
  signedBy?: 'payee' | 'payer' | null
  /** Optional: the job this escrow secures. Validated against the job's client. */
  jobId?: string | null
}

/**
 * Publishes a payment request.
 *
 * A signature over the canonical terms is verified before anything is stored, so terms can only be
 * published by a wallet that is party to them. Either side may sign, and which one matters:
 *
 *   payee  a freelancer raising a request of their own. They will then create the escrow, and pay
 *          the gas for it.
 *   payer  a client securing the budget for a job already agreed. The client goes on to create and
 *          fund the escrow in one go, so the freelancer signs nothing and sends nothing — which is
 *          the only way somebody holding a zero balance can be hired at all.
 *
 * Note what this does and does not do. It authenticates the metadata behind the link. It creates no
 * escrow and moves no funds, and the payment page checks the on-chain `detailsHash` against these
 * terms before inviting anyone to pay.
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
  /*
   * A named client is required now, where it used to be optional.
   *
   * The escrow id is derived from both parties, so it cannot be known before the payer is — which
   * is the price of letting either side create the escrow, and of a stranger not being able to
   * occupy an id they have merely seen. An "open link anyone may fund" has no id to publish, so the
   * contract has no such thing any more and neither does this.
   */
  if (!input.payer) {
    throw new InvoiceError('Say which client this request is for — an escrow names both sides.', 400)
  }
  const payer = getAddress(input.payer)
  if (payer.toLowerCase() === payee.toLowerCase()) {
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

  /*
   * The asset the escrow will hold. Only two are possible, both fixed in the contract at
   * construction, so anything else is refused here rather than reaching a call that would revert.
   */
  const asset = input.asset ? getAddress(input.asset) : ZERO_ADDRESS
  const native = asset === ZERO_ADDRESS
  if (!native && asset.toLowerCase() !== config.token.address.toLowerCase()) {
    throw new InvoiceError(`${config.chain.name} escrows cannot hold that asset.`, 400)
  }

  const terms: InvoiceTerms = {
    invoiceId: input.invoiceId,
    chainId: config.chainId,
    escrowAddress: config.escrowAddress,
    tokenAddress: config.token.address,
    asset,
    payee,
    payer,
    amount: amount.toString(),
    description,
    protectionPeriod,
    fundingDeadline,
  }

  const signedBy = input.signedBy === 'payer' ? 'payer' : 'payee'
  const author = signedBy === 'payer' ? payer : payee

  const signer = await recoverMessageAddress({
    message: invoiceCreationMessage(terms),
    signature: input.signature as `0x${string}`,
  }).catch(() => null)

  if (!signer || signer.toLowerCase() !== author.toLowerCase()) {
    throw new InvoiceError(`Signature does not match the ${signedBy} wallet.`, 401)
  }

  /*
   * Whoever signed must be a wallet the signed-in account owns, for the same reason job postings
   * must — see {@link requireOwnedSigner}. Terms authored under an address no account owns are
   * unreachable: nobody is notified about them, and they appear on nobody's list.
   */
  const signedInAs = await currentAccount().catch(() => null)
  if (signedInAs) {
    const owned = evmAddressesOf(signedInAs)
    if (!owned.some((address) => address.toLowerCase() === author.toLowerCase())) {
      throw new InvoiceError(
        `That signature came from ${author.slice(0, 8)}…${author.slice(-6)}, which is not a wallet ` +
          `on @${signedInAs.name}.`,
        403,
      )
    }
  }

  const salt = escrowSalt(input.invoiceId)
  const escrowId = computeEscrowId({
    chainId: config.chainId,
    escrowAddress: config.escrowAddress,
    payee,
    payer,
    salt,
  })

  const existing = await prisma.invoice.findUnique({ where: { id: input.invoiceId } })
  if (existing) throw new InvoiceError('That invoice id is already taken.', 409)

  /*
   * Linking to a job.
   *
   * Both ends must match the job whichever side authored the terms: the payee is the assignee and
   * the payer is the client who posted it. Without both checks anyone could bolt an escrow of their
   * own choosing onto someone else's job and have the UI present it as that job's secured budget.
   * Only who signed differs, and that is already established above.
   */
  let jobId: string | null = null
  if (input.jobId) {
    const job = await prisma.job.findUnique({ where: { id: input.jobId }, include: { invoice: true } })
    if (!job) throw new InvoiceError('No such job.', 404)
    if (job.invoice) throw new InvoiceError('That job already has an escrow.', 409)
    if (job.status !== 'ASSIGNED' || !job.assignedTo) {
      throw new InvoiceError('That job has not been assigned to anyone yet.', 409)
    }
    if (job.assignedTo.toLowerCase() !== payee.toLowerCase()) {
      throw new InvoiceError('A job escrow must pay the freelancer assigned to it.', 403)
    }
    if (payer.toLowerCase() !== job.clientAddress.toLowerCase()) {
      throw new InvoiceError('A job escrow must be addressed to the client who posted the job.', 400)
    }
    jobId = job.id
  }

  const invoice = await prisma.invoice.create({
    data: {
      id: input.invoiceId,
      salt,
      escrowId,
      chainId: config.chainId,
      escrowAddress: config.escrowAddress,
      tokenAddress: config.token.address,
      asset,
      // Whichever asset this escrow holds, described in its own units — a native escrow is not
      // denominated in the token however it is displayed elsewhere.
      tokenSymbol: native ? config.chain.nativeCurrency.symbol : config.token.symbol,
      tokenDecimals: native ? config.chain.nativeCurrency.decimals : config.token.decimals,
      payeeAddress: payee,
      payerAddress: payer,
      creationSignedBy: signedBy,
      amount: amount.toString(),
      description,
      detailsHash: computeDetailsHash(terms),
      protectionPeriod,
      fundingDeadline: fundingDeadline ? new Date(fundingDeadline * 1000) : null,
      creationSignature: input.signature,
      indexedStatus: 'AWAITING_CHAIN',
      chainKey: getChainByEvmId(config.chainId)?.key,
      jobId,
    },
  })

  await notifyPaymentRequested(invoice)
  return invoice
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

  const previousStatus = invoice.indexedStatus

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

  // The transition is a fact read from the contract, not an optimistic guess made on a click.
  if (previousStatus !== status) {
    await notifyEscrowTransition({
      invoiceId: updated.id,
      description: updated.description,
      amount: updated.amount,
      tokenSymbol: updated.tokenSymbol,
      tokenDecimals: updated.tokenDecimals,
      payeeAddress: updated.payeeAddress,
      payerAddress: updated.payerAddress ?? updated.fundedByAddress,
      from: previousStatus,
      to: status,
    })
  }

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
    asset: invoice.asset,
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
