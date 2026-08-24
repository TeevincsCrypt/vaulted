/**
 * Does the Solana RPC proxy allow every method the signing path actually calls?
 *
 * This exists because of a specific, nasty failure. The proxy at `/api/solana/rpc` allowlists
 * methods so it cannot be driven as an open relay. The wallet's approval screen — Privy's, in its
 * own iframe — issues several RPC calls before it can render a confirm button: it decodes the
 * transaction, resolves address lookup tables, estimates the fee, simulates, and reads the signer's
 * balance. An allowlist written from memory missed three of them.
 *
 * Nothing about that failed visibly. The approval screen catches its balance read's rejection and
 * leaves its own loading flag set, so the modal opened and span forever, with the only evidence in
 * a console nobody was looking at. It is indistinguishable from a slow connection, and no amount of
 * staring at the payment code would have found it.
 *
 * So the required set is not maintained by hand here either. It is re-derived from the installed
 * bundles — Privy's own chunks, plus `@solana/accounts`, which is what resolves lookup tables — and
 * compared against the proxy's list. A Privy upgrade that starts calling something new fails this
 * check instead of silently breaking the popup again.
 *
 * Run: npm run check:solana-rpc
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
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

/* ------------------------------------------------- what the proxy currently allows */

const routeSource = readFileSync(path.join(ROOT, 'app/api/solana/rpc/route.ts'), 'utf8')
const allowedBlock = routeSource.match(/const ALLOWED = new Set\(\[([\s\S]*?)\]\)/)
if (!allowedBlock) {
  console.error('Could not find the ALLOWED set in app/api/solana/rpc/route.ts.')
  process.exit(1)
}
const allowed = new Set([...allowedBlock[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]))
console.log(`\nThe proxy allows ${allowed.size} methods: ${[...allowed].sort().join(', ')}\n`)

/* ------------------------------------------- what the signing path actually calls */

function scan(dir, patterns) {
  const found = new Set()
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.mjs') || entry.endsWith('.map')) continue
    const source = readFileSync(path.join(dir, entry), 'utf8')
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) found.add(match[1])
    }
  }
  return found
}

// Privy issues these directly off its own RPC client.
const fromPrivy = scan(path.join(ROOT, 'node_modules/@privy-io/react-auth/dist/esm'), [
  /\.rpc\.([a-zA-Z]+)\(/g,
])

/*
  `@solana/accounts` is how the approval screen resolves address lookup tables — Privy calls
  `fetchAddressesForLookupTables`, which fetches accounts underneath. Those calls never appear as
  `.rpc.something(` in Privy's own source, which is exactly why reading Privy alone was not enough.
*/
const fromAccounts = scan(path.join(ROOT, 'node_modules/@solana/accounts/dist'), [
  /'(getAccountInfo|getMultipleAccounts)'/g,
  /\.(getAccountInfo|getMultipleAccounts)\(/g,
])

const required = new Set([...fromPrivy, ...fromAccounts])

check('the scan found methods at all (a silent zero would make this check meaningless)', required.size > 0)
console.log(`  …the signing path calls ${required.size}: ${[...required].sort().join(', ')}\n`)

const missing = [...required].filter((method) => !allowed.has(method)).sort()
for (const method of [...required].sort()) {
  check(`"${method}" is allowed by the proxy`, allowed.has(method))
}

/*
  The specific three that were missing. Named explicitly so that even if the derivation above ever
  stops finding them — a bundler change, a renamed export — their absence is still caught.
*/
for (const method of ['getBalance', 'getAccountInfo', 'getMultipleAccounts']) {
  check(`"${method}" is allowed (this one broke the approval popup)`, allowed.has(method))
}

if (missing.length > 0) {
  console.log(
    `\nThe proxy would reject ${missing.length} method(s) the wallet needs: ${missing.join(', ')}.\n` +
      'Add them to ALLOWED in app/api/solana/rpc/route.ts. Leaving them out does not produce an\n' +
      'error the user can see — the approval popup just never finishes loading.',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
