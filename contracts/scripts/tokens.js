/**
 * Canonical stablecoin addresses per chain, used as the default when TOKEN_ADDRESS is not set.
 *
 * Nothing here is trusted blindly: deploy.js reads the token on chain and aborts unless there is
 * real contract code at the address whose symbol and decimals match what is recorded below. A stale
 * or wrong entry therefore fails loudly at deploy time instead of quietly shipping a bad address.
 * Chains with no canonical deployment are absent on purpose — pass TOKEN_ADDRESS explicitly.
 */
const KNOWN_TOKENS = {
  // Circle's official testnet USDC.
  84532: { symbol: 'USDC', decimals: 6, address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', label: 'Base Sepolia' },
  11155111: {
    symbol: 'USDC',
    decimals: 6,
    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    label: 'Ethereum Sepolia',
  },
  // Circle's official mainnet USDC.
  8453: { symbol: 'USDC', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', label: 'Base' },
}

module.exports = { KNOWN_TOKENS }
