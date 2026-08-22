/**
 * Pins the chain-abstraction layer to the real contract.
 *
 * Two things matter here and neither needs a network:
 *   1. The EVM adapter derives the same escrow ids the deployed Solidity contract does — checked
 *      against vectors emitted by the contract itself.
 *   2. The Solana adapter refuses every operation rather than returning something plausible, so a
 *      "coming soon" chain cannot quietly reach a code path that implies it works.
 *
 * Run: node --experimental-strip-types scripts/check-adapters.mjs
 */
import { readFileSync } from 'node:fs'
import { EvmEscrowAdapter } from '../lib/vaulted/adapters/evm.ts'
import { SolanaEscrowAdapter } from '../lib/vaulted/adapters/solana.ts'
import { ChainNotImplementedError } from '../lib/vaulted/adapters/types.ts'
import { escrowSalt } from '../lib/vaulted/invoice.ts'
import { getChain, VAULTED_CHAINS, availabilityLabel } from '../lib/vaulted/registry.ts'

const vector = JSON.parse(readFileSync(new URL('../contracts/test-vectors/escrow-id.json', import.meta.url), 'utf8'))

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`)
  if (!ok) failures++
}

console.log('\n[1] EVM adapter derives the contract’s escrow ids')
// A synthetic chain matching the vector, so the derivation is checked against the contract's own
// output rather than against whatever happens to be deployed today.
const vectorChain = {
  key: 'vector', name: 'Vector', shortName: 'Vector', family: 'evm', network: 'testnet',
  availability: 'live', evmChainId: vector.chainId, viemChain: { id: vector.chainId, name: 'Vector' },
  explorerUrl: null, escrowAddress: vector.escrowAddress,
}
const evm = new EvmEscrowAdapter(vectorChain)
for (const testCase of vector.cases) {
  const derived = evm.deriveEscrowId({ payee: testCase.payee, salt: escrowSalt(testCase.invoiceId) })
  check(derived.toLowerCase() === testCase.escrowId.toLowerCase(), `${testCase.invoiceId} -> ${testCase.escrowId.slice(0, 14)}…`)
}

console.log('\n[2] EVM adapter builds well-formed write descriptors')
const id = vector.cases[0].escrowId
for (const [name, request] of [
  ['fund', evm.buildFund(id)],
  ['release', evm.buildRelease(id)],
  ['refund', evm.buildRefund(id)],
  ['executeTimeout', evm.buildExecuteTimeout(id)],
  ['dispute', evm.buildDispute(id, `0x${'0'.repeat(64)}`)],
]) {
  check(
    request.kind === 'evm' &&
      request.address.toLowerCase() === vector.escrowAddress.toLowerCase() &&
      request.chainId === vector.chainId &&
      request.functionName === name &&
      Array.isArray(request.args),
    `${name} descriptor targets the escrow contract`,
  )
}

console.log('\n[3] Solana adapter refuses every operation')
const solanaChain = getChain('solana-devnet')
check(solanaChain !== null, 'solana-devnet is in the registry')
check(solanaChain?.availability === 'coming-soon', `availability is "${solanaChain?.availability}", not live`)

const solana = new SolanaEscrowAdapter(solanaChain)
for (const [name, run] of [
  ['deriveEscrowId', () => solana.deriveEscrowId({ payee: 'x', salt: 'y' })],
  ['buildCreate', () => solana.buildCreate({ payer: 'x', amount: '1', protectionPeriod: 3600, fundingDeadline: 0, detailsHash: '0x0', salt: '0x0' })],
  ['buildFund', () => solana.buildFund('x')],
  ['buildRelease', () => solana.buildRelease('x')],
  ['buildRefund', () => solana.buildRefund('x')],
  ['buildDispute', () => solana.buildDispute('x', '0x0')],
  ['buildExecuteTimeout', () => solana.buildExecuteTimeout('x')],
]) {
  let threw = false
  try {
    run()
  } catch (error) {
    threw = ChainNotImplementedError.is(error)
  }
  check(threw, `${name} throws ChainNotImplementedError`)
}

let readThrew = false
try {
  await solana.readEscrow('x')
} catch (error) {
  readThrew = ChainNotImplementedError.is(error)
}
check(readThrew, 'readEscrow throws ChainNotImplementedError')

console.log('\n[4] Registry availability is derived from real deployments')
for (const chain of VAULTED_CHAINS) {
  const claimsLive = chain.availability === 'live'
  // A chain may only claim to be live if it actually carries a deployed escrow address.
  check(!claimsLive || Boolean(chain.escrowAddress), `${chain.name}: ${availabilityLabel(chain)}${claimsLive ? ` @ ${chain.escrowAddress}` : ''}`)
}

console.log(failures === 0 ? '\nADAPTER CHECKS PASSED' : `\n${failures} ADAPTER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
