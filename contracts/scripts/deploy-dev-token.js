/**
 * Local development only: puts a 6-decimal USDC stand-in on a local chain so the deployment
 * pipeline can be exercised end to end. Refuses to run against any chain but a local node —
 * public deployments must point at a real stablecoin.
 */
const hre = require('hardhat')

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId)
  if (chainId !== 31337) {
    throw new Error(`Refusing to deploy a stand-in token on chain ${chainId}. Local chains only.`)
  }

  const token = await (await hre.ethers.getContractFactory('MockUSDC')).deploy(6)
  await token.waitForDeployment()
  const address = await token.getAddress()

  const [deployer] = await hre.ethers.getSigners()
  await (await token.mint(deployer.address, hre.ethers.parseUnits('1000000', 6))).wait()

  console.log(address)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
