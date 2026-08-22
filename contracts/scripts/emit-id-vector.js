/**
 * Produces a test vector from the real contract so the application's off-chain escrow id derivation
 * can be checked against it. The app computes ids with viem; the contract computes them in
 * Solidity. If those two ever drift, payment links stop resolving to their escrows, so the
 * agreement is pinned by `scripts/check-escrow-id-vector.mjs` at the repo root.
 */
const fs = require('node:fs')
const path = require('node:path')
const hre = require('hardhat')

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId)
  const token = await (await hre.ethers.getContractFactory('MockUSDC')).deploy(6)
  const escrow = await (
    await hre.ethers.getContractFactory('VaultedEscrow')
  ).deploy(await token.getAddress(), hre.ethers.ZeroAddress)
  await escrow.waitForDeployment()

  const cases = []
  for (const [payee, invoiceId] of [
    ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'v_a1b2c3d4e5f6g7h8i9j0'],
    ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'v_zzzzzzzzzzzzzzzzzzzz'],
    ['0x0000000000000000000000000000000000000001', 'v_00000000000000000001'],
  ]) {
    const salt = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(invoiceId))
    cases.push({ payee, invoiceId, salt, escrowId: await escrow.computeEscrowId(payee, salt) })
  }

  const vector = { chainId, escrowAddress: await escrow.getAddress(), cases }
  const dir = path.join(__dirname, '..', 'test-vectors')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'escrow-id.json'), `${JSON.stringify(vector, null, 2)}\n`)
  console.log(`wrote ${cases.length} escrow id vectors for chain ${chainId}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
