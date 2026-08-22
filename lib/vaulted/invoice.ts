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
  payee: `0x${string}`
  /** Zero address for an open link that anybody may fund. */
  payer: `0x${string}`
  /** Amount in token base units, as a decimal string. */
  amount: string
  description: string
  /** Seconds between funding and expiry. */
  protectionPeriod: number
  /** Unix seconds, or 0 for a link that never goes stale. */
  fundingDeadline: number
}

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
 * Mirrors `VaultedEscrow.computeEscrowId`:
 * `keccak256(abi.encode(block.chainid, address(this), payee, salt))`.
 *
 * Verified against the deployed contract by `scripts/check-escrow-id-vector.mjs`.
 */
export function computeEscrowId(input: {
  chainId: number
  escrowAddress: `0x${string}`
  payee: `0x${string}`
  salt: `0x${string}`
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('uint256, address, address, bytes32'), [
      BigInt(input.chainId),
      getAddress(input.escrowAddress),
      getAddress(input.payee),
      input.salt,
    ]),
  )
}

/**
 * Stable serialisation of the invoice terms. Key order is fixed and addresses are checksummed so
 * the same terms always hash to the same value, whoever computes it.
 */
export function canonicalTerms(terms: InvoiceTerms): string {
  return JSON.stringify({
    v: 1,
    invoiceId: terms.invoiceId,
    chainId: terms.chainId,
    escrow: getAddress(terms.escrowAddress),
    token: getAddress(terms.tokenAddress),
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
 * Message the payee signs when creating an invoice. The API verifies the recovered signer is the
 * payee, so nobody can publish a payment link in someone else's name.
 */
export function invoiceCreationMessage(terms: InvoiceTerms): string {
  return [
    'Vaulted — create payment request',
    '',
    `Invoice: ${terms.invoiceId}`,
    `Payee: ${getAddress(terms.payee)}`,
    `Client: ${terms.payer === ZERO ? 'anyone with the link' : getAddress(terms.payer)}`,
    `Amount: ${terms.amount} (base units of ${getAddress(terms.tokenAddress)})`,
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

const ZERO = '0x0000000000000000000000000000000000000000'
