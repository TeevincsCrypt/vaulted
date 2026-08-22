/**
 * Deploys VaultedEscrow and records everything needed to talk to it: address, chain id, token,
 * deployment transaction, block, constructor arguments, compiler settings and ABI.
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... ARBITER_ADDRESS=0x... npx hardhat run scripts/deploy.js --network baseSepolia
 *
 * Required environment:
 *   DEPLOYER_PRIVATE_KEY  funded key for the target chain (not needed on the in-process network)
 *   TOKEN_ADDRESS         stablecoin to escrow; defaults to the canonical USDC for known chains
 *   ARBITER_ADDRESS       trusted dispute settler; pass the zero address to deploy without one
 */
const fs = require('node:fs')
const path = require('node:path')
const hre = require('hardhat')
const { KNOWN_TOKENS } = require('./tokens')

const ERC20_METADATA_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
]

async function resolveToken(chainId) {
  const known = KNOWN_TOKENS[chainId]
  const address = process.env.TOKEN_ADDRESS || known?.address

  if (!address) {
    throw new Error(
      `No stablecoin configured for chain ${chainId}. Set TOKEN_ADDRESS to the address of the ` +
        `token this escrow should hold. Refusing to guess — a wrong token address would make every ` +
        `escrow on this deployment unusable.`,
    )
  }

  const code = await hre.ethers.provider.getCode(address)
  if (code === '0x') {
    throw new Error(`No contract code at ${address} on chain ${chainId}. Check TOKEN_ADDRESS.`)
  }

  const token = new hre.ethers.Contract(address, ERC20_METADATA_ABI, hre.ethers.provider)
  const [symbol, decimals, name] = await Promise.all([
    token.symbol().catch(() => null),
    token.decimals().catch(() => null),
    token.name().catch(() => null),
  ])

  if (known && !process.env.TOKEN_ADDRESS) {
    if (symbol !== known.symbol || Number(decimals) !== known.decimals) {
      throw new Error(
        `Token at the canonical address ${address} reports ${symbol}/${decimals}, expected ` +
          `${known.symbol}/${known.decimals}. Not deploying against an address that does not match ` +
          `its record. Set TOKEN_ADDRESS explicitly if this is intentional.`,
      )
    }
  }

  return { address, symbol, decimals: decimals === null ? null : Number(decimals), name }
}

async function main() {
  const { ethers, network } = hre
  const chainId = Number((await ethers.provider.getNetwork()).chainId)
  const [deployer] = await ethers.getSigners()

  if (!deployer) {
    throw new Error('No signer available. Set DEPLOYER_PRIVATE_KEY for this network.')
  }

  const balance = await ethers.provider.getBalance(deployer.address)
  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} holds no native token on chain ${chainId} and cannot pay for gas. ` +
        `Fund it from the chain's faucet and re-run.`,
    )
  }

  const token = await resolveToken(chainId)
  const arbiter = process.env.ARBITER_ADDRESS || ethers.ZeroAddress

  if (!ethers.isAddress(arbiter)) throw new Error(`ARBITER_ADDRESS is not an address: ${arbiter}`)

  console.log(`network        ${network.name} (chainId ${chainId})`)
  console.log(`deployer       ${deployer.address}  balance ${ethers.formatEther(balance)}`)
  console.log(`escrow token   ${token.address}  ${token.symbol ?? '?'} (${token.decimals ?? '?'} decimals)`)
  console.log(
    arbiter === ethers.ZeroAddress
      ? 'arbiter        none — disputes will only be resolvable by mutual concession'
      : `arbiter        ${arbiter}  (TRUSTED role, see the contract's trust model)`,
  )

  const factory = await ethers.getContractFactory('VaultedEscrow')
  const escrow = await factory.deploy(token.address, arbiter)
  const deploymentTx = escrow.deploymentTransaction()
  console.log(`\ndeploy tx      ${deploymentTx.hash}\nwaiting for confirmations...`)

  const confirmations = chainId === 31337 ? 1 : 5
  await escrow.waitForDeployment()
  const receipt = await deploymentTx.wait(confirmations)
  const address = await escrow.getAddress()

  // Read the deployed contract back so the record reflects on-chain truth, not our inputs.
  const [onChainToken, onChainArbiter, onChainDecimals, defaultPeriod] = await Promise.all([
    escrow.token(),
    escrow.arbiter(),
    escrow.tokenDecimals(),
    escrow.DEFAULT_PROTECTION_PERIOD(),
  ])
  if (onChainToken.toLowerCase() !== token.address.toLowerCase()) {
    throw new Error(`Deployed contract reports token ${onChainToken}, expected ${token.address}`)
  }

  const artifact = await hre.artifacts.readArtifact('VaultedEscrow')
  const record = {
    contractName: 'VaultedEscrow',
    network: network.name,
    chainId,
    address,
    token: {
      address: onChainToken,
      symbol: token.symbol,
      name: token.name,
      decimals: Number(onChainDecimals),
    },
    arbiter: onChainArbiter,
    defaultProtectionPeriod: Number(defaultPeriod),
    deployment: {
      transactionHash: deploymentTx.hash,
      blockNumber: receipt.blockNumber,
      deployer: deployer.address,
      gasUsed: receipt.gasUsed.toString(),
      timestamp: new Date().toISOString(),
    },
    constructorArgs: [onChainToken, onChainArbiter],
    compiler: {
      version: hre.config.solidity.compilers[0].version,
      optimizer: hre.config.solidity.compilers[0].settings.optimizer,
      evmVersion: hre.config.solidity.compilers[0].settings.evmVersion,
    },
    abi: artifact.abi,
  }

  const dir = path.join(__dirname, '..', 'deployments')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${chainId}.json`)
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)

  console.log(`\ndeployed       ${address}`)
  console.log(`block          ${receipt.blockNumber}`)
  console.log(`gas used       ${receipt.gasUsed}`)
  console.log(`record         ${path.relative(process.cwd(), file)}`)

  require('./export-abi').exportAll()

  if (chainId !== 31337) {
    console.log('\nNext steps:')
    console.log(`  1. Verify:  npx hardhat verify --network ${network.name} ${address} ${onChainToken} ${onChainArbiter}`)
    console.log(`  2. Add to the app environment:`)
    console.log(`       NEXT_PUBLIC_CHAIN_ID=${chainId}`)
    console.log(`       NEXT_PUBLIC_ESCROW_ADDRESS=${address}`)
    console.log(`       NEXT_PUBLIC_TOKEN_ADDRESS=${onChainToken}`)
  }

  return record
}

main().catch((error) => {
  console.error(`\nDeployment failed: ${error.message}`)
  process.exitCode = 1
})
