require('@nomicfoundation/hardhat-ethers')
require('@nomicfoundation/hardhat-chai-matchers')
require('@nomicfoundation/hardhat-verify')

const { subtask } = require('hardhat/config')
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names')
const path = require('node:path')

require('dotenv').config({ path: path.join(__dirname, '.env') })
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })

// See the file's own header: makes RPC calls respect HTTPS_PROXY, a no-op when it is unset.
require('./scripts/http-proxy-shim')

const SOLC_VERSION = '0.8.28'
const SOLC_LONG_VERSION = '0.8.28+commit.7893614a'

// This environment's egress policy blocks binaries.soliditylang.org, so Hardhat cannot download a
// native solc build. The `solc` npm package ships the identical emscripten build (soljson.js) for
// the pinned version, so we hand Hardhat that instead of letting it fetch one. Builds stay
// reproducible and work with no network at all.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    // We are telling Hardhat this build *is* SOLC_VERSION, so make sure it actually is. Without
    // this, a drifting dependency would compile with a different compiler under the pinned name.
    const installed = require('solc/package.json').version
    if (installed !== SOLC_VERSION) {
      throw new Error(
        `solc ${installed} is installed but ${SOLC_VERSION} is pinned. ` +
          `Run \`npm install solc@${SOLC_VERSION} --save-exact\`.`,
      )
    }
    return {
      compilerPath: require.resolve('solc/soljson.js'),
      isSolcJs: true,
      version: SOLC_VERSION,
      longVersion: SOLC_LONG_VERSION,
    }
  }
  return runSuper()
})

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY
const accounts = deployerKey ? [deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`] : []

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 800 },
      // `paris` keeps the bytecode deployable on every chain we target, including networks that
      // have not shipped the Cancun opcodes.
      evmVersion: 'paris',
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    /*
      Base Mainnet. The network key must be exactly `base`: hardhat-verify ships a built-in chain
      config under that name, and renaming it would mean hand-maintaining the Basescan API URLs.

      Real money. `accounts` stays empty unless DEPLOYER_PRIVATE_KEY is set, so a mistyped command
      cannot silently pick up a key from somewhere else, and every deploy against this network is a
      deliberate act.
    */
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      chainId: 8453,
      accounts,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      chainId: 84532,
      accounts,
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
      chainId: 97,
      accounts,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      accounts,
    },
  },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || '' },
  sourcify: { enabled: false },
  paths: { sources: './contracts', tests: './test', cache: './cache', artifacts: './artifacts' },
  mocha: { timeout: 120000 },
}
