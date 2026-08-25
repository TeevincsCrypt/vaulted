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
    await hre.ethers.getContractFactory('VaultedEscrowV2')
  ).deploy(await token.getAddress(), hre.ethers.ZeroAddress)
  await escrow.waitForDeployment()

  /*
   * Both parties, because v2 namespaces ids by the pair rather than by the payee alone. The last
   * case deliberately reuses the first case's payee with a different payer and the same invoice id:
   * if the payer ever stopped contributing to the id, those two would collide, and that collision
   * is exactly the id-squatting the scheme exists to prevent.
   */
  const cases = []
  for (const [payee, payer, invoiceId] of [
    [
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      'v_a1b2c3d4e5f6g7h8i9j0',
    ],
    [
      '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      'v_zzzzzzzzzzzzzzzzzzzz',
    ],
    [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      'v_00000000000000000001',
    ],
    [
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      'v_a1b2c3d4e5f6g7h8i9j0',
    ],
  ]) {
    const salt = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(invoiceId))
    cases.push({
      payee,
      payer,
      invoiceId,
      salt,
      escrowId: await escrow.computeEscrowId(payee, payer, salt),
    })
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
