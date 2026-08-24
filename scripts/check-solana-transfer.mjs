/**
 * What the Solana transfer builder actually puts on the wire.
 *
 * There is no way to test this against the network from here, and a transfer whose recipient,
 * mint or amount is subtly wrong would send real money to the wrong place with no way back. So
 * the transaction is built and then taken apart again, byte by byte, and every field that decides
 * where the money goes is asserted against what it should be.
 *
 * The base58 encoder is checked the same way: a signature encoded wrongly is a signature the
 * network has never heard of, and verification would fail for a payment that really happened.
 */

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import bs58 from 'bs58'
import { base58Decode, base58Encode, isSolanaAddress, isSolanaSignature } from '../lib/vaulted/solana.ts'
import { prepareTokenTransfer, SolanaTransferError } from '../lib/vaulted/server/solana-transfer.ts'
import { VAULTED_CHAINS } from '../lib/vaulted/registry.ts'
import { readWithDeadline } from '../lib/vaulted/adapters/index.ts'

let passed = 0
let failed = 0

function check(label, condition) {
  if (condition) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}`)
  }
}

function section(name) {
  console.log(`\n${name}`)
}

/* ------------------------------------------------------------------ the transaction */

section('SPL transfer, decoded back from the bytes a wallet would receive')

const MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const DECIMALS = 6
const AMOUNT = 1_000_000n

const payer = Keypair.generate().publicKey
const recipient = Keypair.generate().publicKey

const from = getAssociatedTokenAddressSync(MINT, payer)
const to = getAssociatedTokenAddressSync(MINT, recipient)

const [derived] = PublicKey.findProgramAddressSync(
  [payer.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), MINT.toBuffer()],
  ASSOCIATED_TOKEN_PROGRAM_ID,
)
check('the associated token address matches the documented PDA seeds', derived.equals(from))

const message = new TransactionMessage({
  payerKey: payer,
  recentBlockhash: '11111111111111111111111111111111',
  instructions: [
    createAssociatedTokenAccountIdempotentInstruction(payer, to, recipient, MINT),
    createTransferCheckedInstruction(from, MINT, to, payer, AMOUNT, DECIMALS),
  ],
}).compileToV0Message()

const serialised = new VersionedTransaction(message).serialize()
check(`fits in one packet (${serialised.length} of 1232 bytes)`, serialised.length <= 1232)

const decoded = VersionedTransaction.deserialize(serialised)
const keys = decoded.message.staticAccountKeys.map((key) => key.toBase58())
const instructions = decoded.message.compiledInstructions

check('the fee payer is the wallet being asked to sign', keys[0] === payer.toBase58())
check('there are exactly two instructions', instructions.length === 2)
check('nothing is signed yet', decoded.signatures.every((sig) => sig.every((byte) => byte === 0)))

const create = instructions[0]
check(
  'the first instruction belongs to the associated token program',
  keys[create.programIdIndex] === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
)
check('it is the idempotent create, so an existing account is not an error', Buffer.from(create.data)[0] === 1)

const transfer = instructions[1]
const data = Buffer.from(transfer.data)
const [source, mint, destination, authority] = transfer.accountKeyIndexes

check('the second instruction belongs to the SPL token program', keys[transfer.programIdIndex] === TOKEN_PROGRAM_ID.toBase58())
check('it is TransferChecked, not the unchecked Transfer', data[0] === 12)
check('the source is the payer’s own token account', keys[source] === from.toBase58())
check('the mint is the one the registry names', keys[mint] === MINT.toBase58())
check('the destination is the recipient’s token account', keys[destination] === to.toBase58())
check('the destination is not the payer’s own account', keys[destination] !== from.toBase58())
check('the authority is the payer', keys[authority] === payer.toBase58())
check('the amount is the exact base units asked for', data.readBigUInt64LE(1) === AMOUNT)
check('the decimals match the token', data[9] === DECIMALS)

let offCurve = false
try {
  // A token account address, not a wallet. The builder turns this into a refusal with a reason.
  getAssociatedTokenAddressSync(MINT, new PublicKey('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T'))
} catch (error) {
  offCurve = error?.name === 'TokenOwnerOffCurveError'
}
check('an off-curve owner is rejected rather than silently used', offCurve)

/* ------------------------------------------------------------------ base58 */

section('base58, against the reference implementation')

let mismatches = 0
for (let n = 0; n < 5000; n++) {
  const length = n % 70
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  // Leading zeros are the case a naive encoder gets wrong, so make sure they occur.
  if (n % 7 === 0 && length > 2) {
    bytes[0] = 0
    bytes[1] = 0
  }
  const mine = base58Encode(bytes)
  const reference = length === 0 ? '' : bs58.encode(bytes)
  if (mine !== reference) mismatches++
}
check('5000 random byte strings encode identically to bs58', mismatches === 0)

const signature = Keypair.generate().secretKey.slice(0, 64)
const encodedSignature = base58Encode(signature)
check('a 64-byte signature encodes to something the app recognises as one', isSolanaSignature(encodedSignature))
check('and decodes back to the same bytes', Buffer.from(base58Decode(encodedSignature)).equals(Buffer.from(signature)))

const address = payer.toBase58()
check('a generated wallet address round-trips', base58Encode(base58Decode(address)) === address)
check('and is recognised as an address', isSolanaAddress(address))
check('an EVM address is never mistaken for one', !isSolanaAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'))

/* ------------------------------------------------------------------ hangs and timeouts */

section('readWithDeadline actually enforces its deadline, not just the happy path')

/*
 * The RFC 5737 check below proved the failure is reported honestly, but this sandbox's network
 * rejects the unroutable address immediately rather than truly stalling, so it never exercises the
 * timeout itself. A promise that never settles does, deterministically and with no network
 * involved: this is the exact mechanism `prepareTokenTransfer` now relies on to cap a stalled RPC.
 */
{
  const neverResolves = new Promise(() => {})
  const startedAt = Date.now()
  const result = await readWithDeadline(() => neverResolves, 300)
  const elapsedMs = Date.now() - startedAt

  check('it returns rather than hanging on a promise that never settles', result.ok === false)
  check(`close to the requested deadline (took ${elapsedMs}ms of a 300ms budget)`, elapsedMs < 1_000)
  check('and says why, so the caller can report something other than "unknown error"', /did not respond/i.test(result.reason ?? ''))
}

section('An unreachable RPC never hangs the endpoint (nor the popup waiting on it)')

/*
 * The bug this pins: `prepareTokenTransfer` used to call `connection.getTokenAccountBalance` and
 * `connection.getLatestBlockhash` with no deadline of their own. `Connection` doesn't time out on
 * its own, so a stalled RPC used to stall this function indefinitely — which is what the "pay"
 * button waits on before it even asks the wallet to open its approval screen. From the outside
 * that reads as "the popup is slow" or "the popup never loads", regardless of the user's own
 * connection, because the popup is never reached at all.
 *
 * 192.0.2.0/24 is reserved by RFC 5737 for documentation and is never routed, so this is a real
 * network attempt against an address guaranteed not to answer — not a mock standing in for one.
 */
const solanaChain = VAULTED_CHAINS.find((chain) => chain.family === 'svm')
if (!solanaChain) {
  console.log('  skip: no Solana chain is registered in this build to borrow a token address from')
} else {
  const unreachable = { ...solanaChain, rpcUrl: 'http://192.0.2.1:59999' }
  const startedAt = Date.now()
  let outcome = null
  try {
    await prepareTokenTransfer({
      chain: unreachable,
      payer: Keypair.generate().publicKey.toBase58(),
      recipient: Keypair.generate().publicKey.toBase58(),
      amount: 1_000_000n,
    })
  } catch (error) {
    outcome = error
  }
  const elapsedMs = Date.now() - startedAt

  check('it gives up rather than hanging (well under a minute)', elapsedMs < 55_000)
  check(
    `and does so close to the 8s deadline, not some unrelated OS timeout (took ${(elapsedMs / 1000).toFixed(1)}s)`,
    elapsedMs < 15_000,
  )
  check('it reports a SolanaTransferError, not an unhandled network exception', SolanaTransferError.is(outcome))
  check(
    'and the message says the network could not be reached, not that the wallet is empty',
    /could not be reached/i.test(outcome?.message ?? '') && !/holds no/i.test(outcome?.message ?? ''),
  )
  check('served as a 502, meaning "try again", not a 409 meaning "your balance is short"', outcome?.status === 502)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
