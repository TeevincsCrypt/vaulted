import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { readWithDeadline } from '../adapters'
import { solanaRpcUrl } from '../solana'
import type { VaultedChain } from '../registry'

/**
 * Builds the SPL transfer that pays a Solana payment request.
 *
 * Built here rather than in the browser on purpose. Every field that decides where money goes —
 * payer, recipient, mint, amount — comes from server state the caller cannot influence, so the
 * only thing the browser contributes is the signature. A transaction assembled in a page is a
 * transaction whose recipient a compromised page can change.
 *
 * Nothing here signs, and nothing here can: the wallet's key lives with Privy and the user. This
 * returns an unsigned message for them to approve, and the sending is theirs.
 */

export type PreparedTransfer = {
  /** Base64 of the unsigned {@link VersionedTransaction}, ready for the wallet to sign. */
  transaction: string
  /** The wallet this was built for. The browser matches it to pick the right signer, not to choose one. */
  payer: string
  blockhash: string
  lastValidBlockHeight: number
}

export class SolanaTransferError extends Error {
  readonly status: number
  private readonly __vaultedSolanaTransferError = true

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SolanaTransferError'
    this.status = status
  }

  static is(value: unknown): value is SolanaTransferError {
    return typeof value === 'object' && value !== null && '__vaultedSolanaTransferError' in value
  }
}

export async function prepareTokenTransfer(input: {
  chain: VaultedChain
  /** The wallet that will sign and pay. Read from the session, never from a request body. */
  payer: string
  /** Read from the stored payment request, never from a request body. */
  recipient: string
  /** Base units. */
  amount: bigint
}): Promise<PreparedTransfer> {
  const { chain } = input
  if (chain.family !== 'svm' || !chain.token) {
    throw new SolanaTransferError('That is not a Solana network with a token.', 400)
  }

  let payer: PublicKey
  let recipient: PublicKey
  let mint: PublicKey
  try {
    payer = new PublicKey(input.payer)
    recipient = new PublicKey(input.recipient)
    mint = new PublicKey(chain.token.address)
  } catch {
    throw new SolanaTransferError('One of the addresses involved is not a valid Solana address.', 400)
  }

  const connection = new Connection(solanaRpcUrl(chain.cluster ?? 'mainnet-beta', chain.rpcUrl), {
    commitment: 'confirmed',
  })

  /*
    An address that is not on the ed25519 curve is not a wallet — it is a program-derived account,
    most often a token account somebody has pasted in mistaking it for their wallet. Sending there
    would work and the money would be unreachable, so it is refused with the reason.
  */
  let from: PublicKey
  let to: PublicKey
  try {
    from = getAssociatedTokenAddressSync(mint, payer)
    to = getAssociatedTokenAddressSync(mint, recipient)
  } catch {
    throw new SolanaTransferError(
      'One of those addresses is not a Solana wallet — it looks like a token account or a program ' +
        'address. Use the wallet address itself.',
      400,
    )
  }

  /*
    Check the source account before building anything, and fetch the blockhash alongside it —
    these are independent reads, and doing them one after another was pure dead time sitting
    between the user pressing "pay" and the wallet's approval screen even appearing. Both are also
    given a deadline: `Connection` has no timeout of its own, so an RPC that merely stalls used to
    hang this endpoint (and the button) indefinitely, which is indistinguishable from "broken" no
    matter how good the user's own connection is.
  */
  const [balanceRead, blockhashRead] = await Promise.all([
    readWithDeadline(() => connection.getTokenAccountBalance(from), 8_000),
    readWithDeadline(() => connection.getLatestBlockhash('confirmed'), 8_000),
  ])

  if (!blockhashRead.ok) {
    throw new SolanaTransferError(
      `Solana could not be reached to prepare this payment (${blockhashRead.reason}). Try again ` +
        'in a moment.',
      502,
    )
  }
  const { blockhash, lastValidBlockHeight } = blockhashRead.value

  /*
    A missing token account and an unreachable RPC both surface as a rejected promise, but they are
    not the same failure and must not be reported as one: telling someone their wallet is empty
    when the real story is that Solana timed out sends them chasing a balance that was never the
    problem. `getTokenAccountBalance` fails a specific, stable way for "this account has never
    held the token" — anything else here is treated as an outage.
  */
  let balance: { amount: string; uiAmountString?: string | null } | null = null
  if (balanceRead.ok) {
    balance = balanceRead.value.value
  } else if (!/could not find account/i.test(balanceRead.reason)) {
    throw new SolanaTransferError(
      `Solana could not be reached to check the balance (${balanceRead.reason}). Try again in a ` +
        'moment.',
      502,
    )
  }

  if (!balance) {
    throw new SolanaTransferError(
      `That wallet holds no ${chain.token.symbol} on ${chain.name}, so there is nothing to send.`,
      409,
    )
  }
  if (BigInt(balance.amount) < input.amount) {
    throw new SolanaTransferError(
      `That wallet holds ${balance.uiAmountString ?? '0'} ${chain.token.symbol}, which is ` +
        'less than this payment. Top it up and try again.',
      409,
    )
  }

  const instructions = [
    /*
      The recipient may never have held this token. The idempotent form creates their token account
      if it is missing and is a no-op if it is not, so one instruction covers both cases without
      the race a check-then-create would have. The payer covers the rent either way, which is a few
      cents of SOL and only on the first payment to that person.
    */
    createAssociatedTokenAccountIdempotentInstruction(payer, to, recipient, mint),
    // Checked, so the network rejects the transfer outright if the mint or decimals are not what
    // this deployment thinks they are.
    createTransferCheckedInstruction(from, mint, to, payer, input.amount, chain.token.decimals),
  ]

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()

  const transaction = new VersionedTransaction(message)
  return {
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    payer: payer.toBase58(),
    blockhash,
    lastValidBlockHeight,
  }
}
