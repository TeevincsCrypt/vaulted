import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, toBytes } from 'viem'

/**
 * Identifiers and commitments that tie an off-chain invoice to its on-chain escrow.
 *
 * Everything here is deterministic and computed identically on the client, on the server and (for
 * the escrow id and the details hash) inside the contract. That is what lets the payment page prove
 * the link it is rendering describes the same terms the escrow was created with, rather than asking
 * the viewer to trust our database.
 */

export type InvoiceTerms = {
  invoiceId: string
  chainId: number
  escrowAddress: `0x${string}`
  tokenAddress: `0x${string}`
  /**
   * What the escrow holds: the zero address for the chain's own currency, otherwise the token.
   * Committed to in the details hash, so a link cannot claim one asset while the escrow holds
   * another.
   */
  asset: `0x${string}`
  payee: `0x${string}`
  /** Required: the escrow id is derived from both parties, so there is no unaddressed escrow. */
  payer: `0x${string}`
  /** Amount in token base units, as a decimal string. */
  amount: string
  description: string
  /** Seconds between funding and expiry. */
  protectionPeriod: number
  /** Unix seconds, or 0 for a link that never goes stale. */
  fundingDeadline: number
}

const ZERO = '0x0000000000000000000000000000000000000000'

const INVOICE_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
export const INVOICE_ID_PATTERN = /^v_[0-9a-z]{20}$/

/** URL-safe public identifier. This is the `abc123` in vaulted.app/pay/abc123. */
export function generateInvoiceId(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const byte of bytes) id += INVOICE_ID_ALPHABET[byte % INVOICE_ID_ALPHABET.length]
  return `v_${id}`
}

export function isValidInvoiceId(value: string): boolean {
  return INVOICE_ID_PATTERN.test(value)
}

/** The contract's per-payee uniqueness value. Derived from the invoice id so the two always agree. */
export function escrowSalt(invoiceId: string): `0x${string}` {
  return keccak256(toBytes(invoiceId))
}

/**
 * Mirrors `VaultedEscrowV2.computeEscrowId`:
 * `keccak256(abi.encode(block.chainid, address(this), payee, payer, salt))`.
 *
 * Both parties, not just the payee. v1 namespaced ids by the payee alone, which was safe only
 * because the payee was the only account that could create an escrow. Now that a client can create
 * one and name the freelancer, an id derived from the payee and a salt would be reachable by anyone
 * who had seen the payment link — and since ids are never reopened, occupying one would kill it
 * permanently. With the payer folded in, nobody outside the pair can reach their id.
 *
 * Verified against the deployed contract by `scripts/check-escrow-id-vector.mjs`.
 */
export function computeEscrowId(input: {
  chainId: number
  escrowAddress: `0x${string}`
  payee: `0x${string}`
  payer: `0x${string}`
  salt: `0x${string}`
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('uint256, address, address, address, bytes32'), [
      BigInt(input.chainId),
      getAddress(input.escrowAddress),
      getAddress(input.payee),
      getAddress(input.payer),
      input.salt,
    ]),
  )
}

/**
 * The terms a stored invoice commits to.
 *
 * Every page that verifies a link recomputes the details hash, and every one of them has to build
 * the terms from the same fields in the same way — a single field read differently in one place is
 * a hash mismatch that reads as "this link is not safe to pay". Doing it here once means there is
 * only one definition to get right.
 */
export function termsOf(invoice: {
  invoiceId: string
  chainId: number
  escrowAddress: `0x${string}`
  asset: `0x${string}`
  token: { address: `0x${string}` }
  payee: `0x${string}`
  payer: `0x${string}` | null
  amount: string
  description: string
  protectionPeriod: number
  fundingDeadline: number
}): InvoiceTerms {
  return {
    invoiceId: invoice.invoiceId,
    chainId: invoice.chainId,
    escrowAddress: invoice.escrowAddress,
    tokenAddress: invoice.token.address,
    asset: invoice.asset,
    payee: invoice.payee,
    payer: (invoice.payer ?? ZERO) as `0x${string}`,
    amount: invoice.amount,
    description: invoice.description,
    protectionPeriod: invoice.protectionPeriod,
    fundingDeadline: invoice.fundingDeadline,
  }
}

/**
 * Stable serialisation of the invoice terms. Key order is fixed and addresses are checksummed so
 * the same terms always hash to the same value, whoever computes it.
 */
export function canonicalTerms(terms: InvoiceTerms): string {
  return JSON.stringify({
    // Bumped with the asset: a v1 hash and a v2 hash over the same terms must not collide, or a
    // link written before escrows could hold ether would verify against one that does.
    v: 2,
    invoiceId: terms.invoiceId,
    chainId: terms.chainId,
    escrow: getAddress(terms.escrowAddress),
    token: getAddress(terms.tokenAddress),
    asset: getAddress(terms.asset),
    payee: getAddress(terms.payee),
    payer: getAddress(terms.payer),
    amount: terms.amount,
    description: terms.description,
    protectionPeriod: terms.protectionPeriod,
    fundingDeadline: terms.fundingDeadline,
  })
}

/**
 * Commitment stored on chain as the escrow's `detailsHash`. The payment page recomputes it from the
 * invoice it fetched and compares: a mismatch means the link and the escrow disagree, and the page
 * refuses to present it as safe to fund.
 */
export function detailsHash(terms: InvoiceTerms): `0x${string}` {
  return keccak256(toBytes(canonicalTerms(terms)))
}

/**
 * Message signed when creating an invoice.
 *
 * Either side may sign it, and the API verifies the recovered signer is the party it claims to be,
 * so nobody can publish terms in someone else's name. The freelancer signs when raising a payment
 * request of their own; the client signs when securing the budget for a job already agreed, which
 * is what lets the freelancer hold no balance and still be hired.
 */
export function invoiceCreationMessage(terms: InvoiceTerms): string {
  return [
    'Vaulted — create payment request',
    '',
    `Invoice: ${terms.invoiceId}`,
    `Payee: ${getAddress(terms.payee)}`,
    `Client: ${getAddress(terms.payer)}`,
    `Asset: ${terms.asset === ZERO ? 'native currency' : getAddress(terms.asset)}`,
    `Amount: ${terms.amount} (base units)`,
    `Chain: ${terms.chainId}`,
    `Escrow: ${getAddress(terms.escrowAddress)}`,
    `Protection period: ${terms.protectionPeriod}s`,
    `Funding deadline: ${terms.fundingDeadline === 0 ? 'none' : new Date(terms.fundingDeadline * 1000).toISOString()}`,
    `Description: ${terms.description}`,
    '',
    `Terms hash: ${detailsHash(terms)}`,
    '',
    'Signing only publishes this payment link. It does not move any funds.',
  ].join('\n')
}

