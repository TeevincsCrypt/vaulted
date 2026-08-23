import { createPublicClient, erc20Abi, getAddress, http, isAddress, parseEventLogs } from 'viem'
import { isSolanaAddress, isSolanaSignature, solanaRpcUrl } from '../solana'
import type { VaultedChain } from '../registry'

/**
 * Did this transaction actually pay this person?
 *
 * A payment link is marked paid by this file and nowhere else. The browser can say "I paid" all it
 * likes; what settles the question is reading the transaction back off the network and checking
 * that the recipient's balance went up by at least the amount, in the right asset. A transaction
 * hash supplied by a payer is a *claim* until this returns `paid: true`.
 *
 * Both rails are checked the same way — by balance movement, not by trusting the shape of the
 * instruction that caused it. A transfer wrapped in a router, a multisig, or a batch still moves
 * the balance, and an inspection that only recognises a bare `transfer` call would reject real
 * payments while a balance check accepts them.
 */

export type PaymentCheck =
  | { paid: true; amount: string; confirmations: number | null; from: string | null }
  | { paid: false; reason: string; pending?: boolean }

/** How long to give an RPC before giving up. A hung check must not hang the request. */
const TIMEOUT_MS = 12_000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    ),
  ])
}

/* ------------------------------------------------------------------------------ EVM */

/**
 * Verifies an ERC-20 payment on an EVM network.
 *
 * Reads the receipt, requires success, then sums the `Transfer` logs of the expected token that
 * credit the recipient. Summing rather than taking the first match is deliberate: a payment split
 * across two transfers in one transaction is still a payment of the total.
 */
async function verifyEvmPayment(input: {
  chain: VaultedChain
  hash: string
  recipient: string
  amount: bigint
  rpcUrl?: string | null
}): Promise<PaymentCheck> {
  const { chain, hash, recipient, amount } = input

  if (!chain.viemChain || !chain.token) {
    return { paid: false, reason: `${chain.name} has no token configured, so nothing can be verified.` }
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return { paid: false, reason: 'That is not an EVM transaction hash.' }
  }
  if (!isAddress(recipient)) {
    return { paid: false, reason: 'The recipient is not a valid EVM address.' }
  }

  const client = createPublicClient({
    chain: chain.viemChain,
    transport: http(input.rpcUrl ?? chain.rpcUrl ?? undefined),
  })

  let receipt
  try {
    receipt = await withTimeout(client.getTransactionReceipt({ hash: hash as `0x${string}` }), chain.name)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    // Not yet mined is a different answer from "did not pay", and the caller should keep checking.
    if (/not be found|not found/i.test(message)) {
      return { paid: false, pending: true, reason: `${chain.name} has not seen that transaction yet.` }
    }
    return { paid: false, reason: `Could not read ${chain.name}: ${message.split('\n')[0]}` }
  }

  if (receipt.status !== 'success') {
    return { paid: false, reason: 'That transaction reverted on chain, so nothing was transferred.' }
  }

  const token = getAddress(chain.token.address)
  const to = getAddress(recipient)

  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: 'Transfer',
    logs: receipt.logs,
  }).filter((log) => getAddress(log.address) === token && getAddress(log.args.to) === to)

  const credited = transfers.reduce((total, log) => total + log.args.value, 0n)

  if (credited < amount) {
    return {
      paid: false,
      reason:
        credited === 0n
          ? `That transaction moved no ${chain.token.symbol} to the recipient.`
          : `That transaction moved ${credited} of the ${amount} base units required.`,
    }
  }

  let confirmations: number | null = null
  try {
    const head = await withTimeout(client.getBlockNumber(), chain.name)
    confirmations = Number(head - receipt.blockNumber) + 1
  } catch {
    // The payment is proven either way; the depth is a nicety.
  }

  return {
    paid: true,
    amount: credited.toString(),
    confirmations,
    from: transfers[0]?.args.from ? getAddress(transfers[0].args.from) : null,
  }
}

/* --------------------------------------------------------------------------- Solana */

type SolanaTokenBalance = {
  mint?: string
  owner?: string
  uiTokenAmount?: { amount?: string }
}

async function solanaRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache: 'no-store',
    }),
    'Solana RPC',
  )
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}`)
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'Solana RPC returned an error')
  return body.result
}

/**
 * Verifies an SPL token payment on Solana.
 *
 * Uses the transaction's own pre/post token balances rather than decoding instructions. The RPC
 * reports, for every token account the transaction touched, its owner, its mint and its balance
 * before and after — so the recipient's gain in the expected mint is a direct read, whatever
 * instruction produced it.
 */
async function verifySolanaPayment(input: {
  chain: VaultedChain
  signature: string
  recipient: string
  amount: bigint
  rpcUrl?: string | null
}): Promise<PaymentCheck> {
  const { chain, signature, recipient, amount } = input

  if (!chain.token) {
    return { paid: false, reason: `${chain.name} has no token configured, so nothing can be verified.` }
  }
  if (!isSolanaSignature(signature)) {
    return { paid: false, reason: 'That is not a Solana transaction signature.' }
  }
  if (!isSolanaAddress(recipient)) {
    return { paid: false, reason: 'The recipient is not a valid Solana address.' }
  }

  const url = solanaRpcUrl(chain.cluster ?? 'mainnet-beta', input.rpcUrl ?? chain.rpcUrl)

  let result: unknown
  try {
    result = await solanaRpc(url, 'getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ])
  } catch (cause) {
    return {
      paid: false,
      reason: `Could not read ${chain.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  if (result === null || result === undefined) {
    // Unknown to the cluster: either not landed yet, or never existed. Both mean "keep checking".
    return { paid: false, pending: true, reason: `${chain.name} has not seen that signature yet.` }
  }

  const tx = result as {
    meta?: {
      err?: unknown
      preTokenBalances?: SolanaTokenBalance[]
      postTokenBalances?: SolanaTokenBalance[]
    }
    slot?: number
  }

  if (!tx.meta) return { paid: false, reason: 'That transaction has no metadata to verify against.' }
  if (tx.meta.err) {
    return { paid: false, reason: 'That transaction failed on chain, so nothing was transferred.' }
  }

  const mint = chain.token.address
  const sum = (balances: SolanaTokenBalance[] | undefined) =>
    (balances ?? [])
      .filter((entry) => entry.mint === mint && entry.owner === recipient)
      .reduce((total, entry) => total + BigInt(entry.uiTokenAmount?.amount ?? '0'), 0n)

  const credited = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances)

  if (credited < amount) {
    return {
      paid: false,
      reason:
        credited <= 0n
          ? `That transaction moved no ${chain.token.symbol} to the recipient.`
          : `That transaction moved ${credited} of the ${amount} base units required.`,
    }
  }

  return { paid: true, amount: credited.toString(), confirmations: null, from: null }
}

/* ---------------------------------------------------------------------------- entry */

/**
 * Verifies a payment on whichever network it claims to be on.
 *
 * The chain decides which rail runs — an EVM hash is never checked against Solana and vice versa,
 * because the address formats and the failure modes have nothing in common.
 */
export async function verifyPayment(input: {
  chain: VaultedChain
  reference: string
  recipient: string
  /** Base units of the network's token. */
  amount: bigint
  rpcUrl?: string | null
}): Promise<PaymentCheck> {
  if (!input.chain.capabilities.transfer) {
    return { paid: false, reason: `${input.chain.name} cannot settle payments in this deployment.` }
  }
  if (input.amount <= 0n) {
    return { paid: false, reason: 'A payment must be for more than zero.' }
  }

  return input.chain.family === 'svm'
    ? verifySolanaPayment({ ...input, signature: input.reference.trim() })
    : verifyEvmPayment({ ...input, hash: input.reference.trim() })
}
