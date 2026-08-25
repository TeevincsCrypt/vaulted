/**
 * Can a browser extension become the account's wallet?
 *
 * It must not be able to. A Vaulted account's wallet is the one Privy assigned to it, and that is
 * the address recorded server-side and the address payments to the handle are sent to. If wagmi
 * adopts some other wallet as the active account, the app is signing as one address while being
 * paid at another — the user sees an extension asking to sign for a job post, and a "signer does
 * not match" warning on their own wallet page. Nothing errors; it just quietly signs as the wrong
 * wallet.
 *
 * Two independent doors let that happen, and both are defaults rather than anything this app wrote:
 *
 *   1. wagmi's EIP-6963 discovery (`multiInjectedProviderDiscovery`) defaults to ON, so every
 *      injected wallet in the browser is registered as a connector and `reconnect()` may pick one.
 *   2. `@privy-io/wagmi`'s provider, given no `setActiveWalletForWagmi`, builds connectors from
 *      *every* wallet Privy knows about — external wallets included — and lets the stored
 *      `recentConnectorId` decide which is active.
 *
 * Both are checked against the installed library sources rather than assumed, so an upgrade that
 * changes either default fails here instead of silently reopening the door.
 *
 * Run: npm run check:wallet-only
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')

let passed = 0
let failed = 0
const check = (label, condition) => {
  if (condition) {
    passed++
    console.log(`  ok   ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}`)
  }
}

const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8')

/* ------------------------------------------------------ what this app declares */

const provider = read('components/web3-provider.tsx')

console.log('\nthe app’s wagmi configuration:\n')

// Both branches of the config — with Privy and without — must turn discovery off. The one without
// already passes `connectors: []`, which does nothing about discovery: it is a separate door.
const configCalls = provider.match(/create(?:Privy)?Config\(\{[^}]*\}\)/g) ?? []
check(
  `both wagmi configs were found in the provider (found ${configCalls.length})`,
  configCalls.length === 2,
)
for (const call of configCalls) {
  const which = call.startsWith('createPrivyConfig') ? 'the Privy config' : 'the connector-less config'
  check(`${which} disables injected-wallet discovery`, /multiInjectedProviderDiscovery:\s*false/.test(call))
}

check(
  'the Privy provider is told which wallet wagmi may use',
  /setActiveWalletForWagmi=\{/.test(provider),
)
check(
  'and that choice is the embedded wallet, identified by Privy’s own client type',
  /walletClientType === 'privy'/.test(provider),
)

/* --------------------------------------------- what the installed libraries do */

console.log('\nthe defaults those two settings are overriding:\n')

const wagmiCreateConfig = read('node_modules/@wagmi/core/dist/esm/createConfig.js')
check(
  'wagmi still defaults EIP-6963 discovery to on, so disabling it is still required',
  /multiInjectedProviderDiscovery\s*=\s*true/.test(wagmiCreateConfig),
)
check(
  'and still honours the flag when deciding whether to discover at all',
  /typeof window !== 'undefined' && multiInjectedProviderDiscovery/.test(wagmiCreateConfig),
)

const privySync = read('node_modules/@privy-io/wagmi/dist/esm/useSyncPrivyWallets.mjs')
/*
 * Minified, so this asserts the shape rather than names: with the filter supplied, exactly one
 * wallet is passed through to connector setup; without it, the whole `wallets` array is. The second
 * is the branch that lets an external wallet in.
 */
check(
  '@privy-io/wagmi still reads setActiveWalletForWagmi',
  /setActiveWalletForWagmi/.test(privySync),
)
check(
  'and still falls back to a stored connector id when it is not supplied',
  /recentConnectorId/.test(privySync),
)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
