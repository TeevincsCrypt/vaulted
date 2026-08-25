/**
 * Asserts the application's off-chain escrow id derivation matches what the contract computes.
 *
 * The vector in contracts/test-vectors/escrow-id.json is produced by the real deployed contract
 * (contracts/scripts/emit-id-vector.js). If this check fails, a payment link would resolve to an
 * escrow id that does not exist on chain.
 */
import { readFileSync } from 'node:fs'
import { computeEscrowId, escrowSalt } from '../lib/vaulted/invoice.ts'

const vector = JSON.parse(readFileSync(new URL('../contracts/test-vectors/escrow-id.json', import.meta.url), 'utf8'))

let failures = 0
for (const testCase of vector.cases) {
  const salt = escrowSalt(testCase.invoiceId)
  if (salt !== testCase.salt) {
    console.error(`salt mismatch for ${testCase.invoiceId}\n  contract ${testCase.salt}\n  app      ${salt}`)
    failures++
    continue
  }

  const escrowId = computeEscrowId({
    chainId: vector.chainId,
    escrowAddress: vector.escrowAddress,
    payee: testCase.payee,
    payer: testCase.payer,
    salt,
  })
  if (escrowId.toLowerCase() !== testCase.escrowId.toLowerCase()) {
    console.error(`escrow id mismatch for ${testCase.invoiceId}\n  contract ${testCase.escrowId}\n  app      ${escrowId}`)
    failures++
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${vector.cases.length} escrow id vectors disagree with the contract.`)
  process.exit(1)
}
/*
 * The pair, not just the payee. Two cases share a payee and an invoice id and differ only in the
 * payer; if they came out equal, the payer would not be contributing to the id and a stranger could
 * occupy an id they had merely seen — see the contract's own computeEscrowId.
 */
const byPair = new Set(vector.cases.map((testCase) => testCase.escrowId.toLowerCase()))
if (byPair.size !== vector.cases.length) {
  console.error('two vectors share an escrow id — the payer is not part of the derivation')
  process.exit(1)
}

console.log(`escrow id derivation matches the contract on all ${vector.cases.length} vectors`)
