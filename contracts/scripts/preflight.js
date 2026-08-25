/**
 * Everything that must be true before the escrow contract is deployed with real money behind it.
 *
 * Read-only. This sends no transaction and spends no gas; it exists so that the deploy itself is
 * the boring part. Run it, read it, then deploy.
 *
 * Usage:
 *   ARBITER_ADDRESS=0x... npx hardhat run scripts/preflight.js --network base
 *
 * Every check below corresponds to something that, if wrong, produces a deployment that looks fine
 * and is unusable — or worse, usable but pointed at the wrong token.
 */
const hre = require('hardhat')
const { KNOWN_TOKENS } = require('./tokens')
const { CONTRACT_NAME } = require('./contract')

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
]

let failed = 0
function check(label, ok, detail) {
  if (!ok) failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`)
}
function section(name) {
  console.log(`\n${name}`)
}

async function main() {
  const { ethers, network } = hre

  section('Network')
  const chainId = Number((await ethers.provider.getNetwork()).chainId)
  console.log(`  hardhat network name   ${network.name}`)
  console.log(`  RPC                    ${network.config.url ?? '(in-process)'}`)
  check('the chain reports an id', Number.isFinite(chainId), String(chainId))

  const expected = Number(process.env.EXPECT_CHAIN_ID || 8453)
  check(
    `it is chain ${expected}, the one this deploy is for`,
    chainId === expected,
    chainId === expected ? String(chainId) : `got ${chainId}, refusing to continue`,
  )
  check(
    'the configured chainId matches what the RPC actually reports',
    network.config.chainId === undefined || network.config.chainId === chainId,
    `config ${network.config.chainId} vs chain ${chainId}`,
  )

  // A live read proves the endpoint is real and reachable, not merely configured.
  const head = await ethers.provider.getBlockNumber()
  check('the RPC answers a live read', head > 0, `head block ${head}`)

  section('Deployer')
  const [deployer] = await ethers.getSigners()
  check('a signer is available (DEPLOYER_PRIVATE_KEY is set)', Boolean(deployer))
  if (!deployer) {
    console.log('\nNothing further can be checked without a signer.')
    process.exitCode = 1
    return
  }
  console.log(`  address                ${deployer.address}`)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log(`  balance                ${ethers.formatEther(balance)} ETH`)
  check('it holds native token for gas', balance > 0n)

  /*
    A rough floor, not an estimate of this deployment. Base is cheap, but a deployer scraping the
    bottom is how you get a half-broadcast deploy and a contract you cannot verify.
  */
  const floor = ethers.parseEther('0.0005')
  check(
    'the balance clears a sane floor for a deploy plus verification',
    balance >= floor,
    balance >= floor ? undefined : `${ethers.formatEther(balance)} ETH is below ${ethers.formatEther(floor)} ETH`,
  )

  const nonce = await ethers.provider.getTransactionCount(deployer.address)
  console.log(`  nonce                  ${nonce}`)

  section('Token')
  const known = KNOWN_TOKENS[chainId]
  const tokenAddress = process.env.TOKEN_ADDRESS || known?.address
  check('a token address is resolved for this chain', Boolean(tokenAddress), tokenAddress)
  if (!tokenAddress) {
    process.exitCode = 1
    return
  }
  console.log(`  address                ${tokenAddress}${process.env.TOKEN_ADDRESS ? '  (from TOKEN_ADDRESS)' : '  (canonical)'}`)

  const code = await ethers.provider.getCode(tokenAddress)
  check('there is contract code at that address', code !== '0x', `${(code.length - 2) / 2} bytes`)

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, ethers.provider)
  const [symbol, decimals, name, supply] = await Promise.all([
    token.symbol().catch(() => null),
    token.decimals().catch(() => null),
    token.name().catch(() => null),
    token.totalSupply().catch(() => null),
  ])
  console.log(`  reports                ${name ?? '?'} / ${symbol ?? '?'} / ${decimals ?? '?'} decimals`)
  check('it answers ERC-20 metadata', symbol !== null && decimals !== null)
  check('it has a non-zero supply, so it is a live token', supply !== null && supply > 0n)

  if (known) {
    check('the symbol matches the canonical record', symbol === known.symbol, `${symbol} vs ${known.symbol}`)
    check('the decimals match the canonical record', Number(decimals) === known.decimals, `${decimals} vs ${known.decimals}`)
  }

  /*
    The app and the contract must agree on the token, or escrows are denominated in something the
    UI does not display. The app's registry is the other half of this pair.
  */
  const appToken = process.env.APP_TOKEN_ADDRESS
  if (appToken) {
    check(
      'it matches the token the app is configured for',
      appToken.toLowerCase() === tokenAddress.toLowerCase(),
      `${appToken} vs ${tokenAddress}`,
    )
  }

  section('Arbiter')
  const arbiter = process.env.ARBITER_ADDRESS || ethers.ZeroAddress
  check('ARBITER_ADDRESS is a valid address', ethers.isAddress(arbiter), arbiter)
  if (arbiter === ethers.ZeroAddress) {
    console.log('  NOTE  Deploying with no arbiter. Disputes can then only end by the payer')
    console.log('        releasing or the payee refunding, and `rescue` becomes permanently')
    console.log('        unreachable — tokens sent here by mistake would be stuck forever.')
  } else {
    const arbiterCode = await ethers.provider.getCode(arbiter)
    console.log(`  address                ${arbiter}`)
    console.log(`  kind                   ${arbiterCode === '0x' ? 'externally owned account' : 'contract (multisig?)'}`)
    check('the arbiter is not the zero address by accident', arbiter !== ethers.ZeroAddress)
    check(
      'the arbiter is not the token contract',
      arbiter.toLowerCase() !== tokenAddress.toLowerCase(),
    )
  }

  section('Bytecode')
  await hre.run('compile')
  const artifact = await hre.artifacts.readArtifact(CONTRACT_NAME)
  const creation = artifact.bytecode
  check('the contract compiles', creation.length > 2, `${(creation.length - 2) / 2} bytes of creation code`)
  check(
    'it is under the 24576-byte deployed-code limit',
    (artifact.deployedBytecode.length - 2) / 2 < 24576,
    `${(artifact.deployedBytecode.length - 2) / 2} bytes deployed`,
  )
  console.log(`  keccak256(creation)    ${ethers.keccak256(creation)}`)
  console.log(`  compiler               ${hre.config.solidity.compilers[0].version}, optimizer runs ${hre.config.solidity.compilers[0].settings.optimizer.runs}, evm ${hre.config.solidity.compilers[0].settings.evmVersion}`)

  section('The transaction that would be sent')
  const factory = await ethers.getContractFactory(CONTRACT_NAME)
  const deployTx = await factory.getDeployTransaction(tokenAddress, arbiter)
  const gas = await ethers.provider.estimateGas({ ...deployTx, from: deployer.address }).catch((error) => {
    console.log(`  gas estimate failed: ${error.shortMessage ?? error.message}`)
    return null
  })
  const fee = await ethers.provider.getFeeData()
  check('the deployment simulates without reverting', gas !== null, gas ? `${gas} gas` : undefined)
  if (gas && fee.maxFeePerGas) {
    const cost = gas * fee.maxFeePerGas
    console.log(`  est. max cost          ${ethers.formatEther(cost)} ETH at ${ethers.formatUnits(fee.maxFeePerGas, 'gwei')} gwei`)
    check('the deployer can afford it', balance > cost, `${ethers.formatEther(balance)} ETH available`)
  }
  console.log(`  constructor args       token=${tokenAddress}  arbiter=${arbiter}`)

  section('Command that will be run')
  console.log(
    `  ${process.env.ARBITER_ADDRESS ? `ARBITER_ADDRESS=${arbiter} ` : ''}npx hardhat run scripts/deploy.js --network ${network.name}`,
  )

  console.log(`\n${failed === 0 ? 'Pre-flight clean. Safe to deploy.' : `${failed} check(s) failed — do NOT deploy.`}\n`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\nPre-flight failed to run: ${error.message}`)
  process.exitCode = 1
})
