/**
 * Verifies a recorded deployment on the block explorer using the constructor arguments captured at
 * deploy time, so there is nothing to retype and nothing to get wrong.
 *
 * Usage: npx hardhat run scripts/verify.js --network baseSepolia
 */
const fs = require('node:fs')
const path = require('node:path')
const hre = require('hardhat')

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId)
  const file = path.join(__dirname, '..', 'deployments', `${chainId}.json`)

  if (!fs.existsSync(file)) {
    throw new Error(`No deployment recorded for chain ${chainId}. Run scripts/deploy.js first.`)
  }
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))

  console.log(`verifying ${record.address} on ${record.network} (chain ${chainId})`)
  console.log(`constructor args: ${record.constructorArgs.join(' ')}`)

  await hre.run('verify:verify', {
    address: record.address,
    constructorArguments: record.constructorArgs,
  })
}

main().catch((error) => {
  // Already-verified is a success for our purposes, not a failure.
  if (/already verified/i.test(error.message)) {
    console.log('Already verified.')
    return
  }
  console.error(`\nVerification failed: ${error.message}`)
  process.exitCode = 1
})
