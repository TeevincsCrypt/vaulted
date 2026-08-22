/** Wire shape of a payment request, as returned by the API and passed into client components. */
export type SerialisedInvoice = {
  invoiceId: string
  escrowId: `0x${string}`
  salt: `0x${string}`
  chainId: number
  escrowAddress: `0x${string}`
  token: { address: `0x${string}`; symbol: string; decimals: number }
  payee: `0x${string}`
  payer: `0x${string}` | null
  fundedBy: `0x${string}` | null
  amount: string
  description: string
  detailsHash: `0x${string}`
  protectionPeriod: number
  fundingDeadline: number
  /** Last status seen on chain. Advisory — client components read the contract themselves. */
  indexedStatus: string
  indexedAt: string | null
  indexedBlock: string | null
  fundedAt: number | null
  expiresAt: number | null
  transactions: { create: string | null; fund: string | null; settle: string | null }
  createdAt: string
}
