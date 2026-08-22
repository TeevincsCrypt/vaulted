const { ethers } = require('hardhat')

const State = {
  None: 0n,
  Created: 1n,
  Funded: 2n,
  Released: 3n,
  Disputed: 4n,
  Refunded: 5n,
  Cancelled: 6n,
  Resolved: 7n,
}

const ReleaseTrigger = { PayerRelease: 0n, Timeout: 1n }

const HOUR = 60 * 60
const DAY = 24 * HOUR

/** USDC-denominated amount in base units (6 decimals). */
const usdc = (amount) => ethers.parseUnits(String(amount), 6)

const saltFor = (label) => ethers.keccak256(ethers.toUtf8Bytes(label))

/**
 * Publishes an escrow and returns its id. Mirrors what the application does: derive the id from
 * the invoice reference up front, then create.
 */
async function createEscrow(escrow, payee, overrides = {}) {
  const params = {
    payer: ethers.ZeroAddress,
    amount: usdc(500),
    protectionPeriod: 0,
    fundingDeadline: 0,
    detailsHash: ethers.ZeroHash,
    salt: saltFor(`invoice-${Math.random()}`),
    ...overrides,
  }

  const escrowId = await escrow.computeEscrowId(payee.address, params.salt)
  const tx = await escrow
    .connect(payee)
    .createEscrow(
      params.payer,
      params.amount,
      params.protectionPeriod,
      params.fundingDeadline,
      params.detailsHash,
      params.salt,
    )

  return { escrowId, tx, params }
}

module.exports = { State, ReleaseTrigger, HOUR, DAY, usdc, saltFor, createEscrow }
