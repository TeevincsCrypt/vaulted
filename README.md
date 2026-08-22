# Vaulted

Trustless escrow payment links for freelancers. Share `/pay/{invoiceId}`; your client funds an escrow
contract with a stablecoin; the funds settle according to rules the contract enforces, not rules we
promise.

```
freelancer                        escrow contract                        client
   │  createEscrow(terms) ───────────▶  Created
   │                                       │  ◀─────────── fund(escrowId)  │
   │                                    Funded ── protection window ──┐    │
   │                                       │                          │    │
   │            release ◀──────────────────┤◀──── release() ──────────┘    │
   │                                       ├◀──── dispute() ───▶ Disputed   │
   │  anyone ── executeTimeout() ─────────▶┘  (after expiry)                │
```

If the client goes quiet, the freelancer is paid anyway: once the protection window closes, **anyone**
can execute the settlement. No chasing, no intermediary, no custody.

## What the contract guarantees, and what it does not

Enforced with no trusted party:

- Escrowed funds can only ever move to that escrow's own payer or payee.
- Only the payer releases early; only the payer disputes; only the payee refunds.
- After expiry the settlement is permissionless, so the freelancer never depends on the client's
  cooperation — or on us.
- Each escrow settles exactly once. `totalLocked` is an invariant that `rescue()` can never dip below.

Not provided:

- **Decentralised arbitration.** `dispute()` only *pauses* settlement. Deciding a disputed escrow
  requires the `arbiter` address configured at deployment: a single, trusted, external party (an
  operator key, a multisig, or a bridge into a system such as Kleros). This is an explicit external
  dependency, not a property of the contract.
- **A guaranteed outcome for a disputed escrow.** If the arbiter never acts, funds stay locked until
  one side concedes — the payer can still release, the payee can still refund. There is deliberately
  no automatic fallback, because any fallback hands a free win to whichever side it favours. With
  `arbiter = address(0)`, concession is the *only* exit.
- **Any opinion on whether the work was delivered.**

The arbiter's power is bounded by construction: it acts only on escrows already `Disputed`, and only
splits that escrow's own amount between that escrow's own payer and payee. It can never pay itself,
touch a non-disputed escrow, pause the contract, or upgrade it.

## Stack

Next.js 16 (App Router) · wagmi 3 + viem 2 · Prisma + Postgres · Solidity 0.8.28 via Hardhat.

| Path | What it is |
| --- | --- |
| `contracts/contracts/VaultedEscrow.sol` | The escrow contract |
| `contracts/contracts/test/` | Hostile and non-standard tokens used only by the test suite |
| `contracts/test/` | 99 tests: lifecycle, authorisation, timestamps, reentrancy, token failures, invariants |
| `contracts/scripts/deploy.js` | Deploys and records address, chain, token, tx, ABI |
| `contracts/deployments/<chainId>.json` | One record per real deployment |
| `lib/vaulted/` | Config, id/hash derivation, client hooks, server chain reads |
| `app/api/` | Payment-request REST API |
| `app/pay/[invoiceId]` | Client payment page |
| `app/` | Freelancer workspace |

## Where the truth lives

Blockchain state is authoritative everywhere. The database stores metadata (description, addresses,
amount, expiry) and a cached `indexedStatus`, which exists so a list can be rendered without an RPC
round trip per row. It is never consulted to decide what a user may do:

- Every screen showing one escrow reads `getEscrowView` from the contract and acts on that.
- `GET /api/invoices/{id}` returns a live chain read next to the stored row. If the RPC is
  unreachable it returns `{ available: false, reason }` rather than passing the cache off as current.
- There is no balance column anywhere in the schema.

Two integrity properties are enforced rather than asserted:

1. **Link authenticity.** Publishing a payment request requires a signature from the payee over the
   canonical terms, so nobody can raise an invoice in someone else's name.
2. **Terms commitment.** The terms hash to `detailsHash`, which the escrow stores on chain. The
   payment page recomputes it and refuses to present a link as safe to pay when the two disagree.

## Running it

### 1. Contracts

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
```

> `solc` is pinned exactly, and `hardhat.config.cjs` hands Hardhat that package's `soljson.js`
> instead of downloading a native build — so compilation is reproducible and needs no network. The
> config fails loudly if the installed compiler ever drifts from the pinned version.

### 2. Deploy

Base Sepolia is the reference target: it carries Circle's official testnet USDC and has a public
faucet for both ETH and USDC.

```bash
cd contracts
cp .env.example .env          # DEPLOYER_PRIVATE_KEY, and ARBITER_ADDRESS if you want one
npm run deploy:baseSepolia
npm run verify:baseSepolia    # needs ETHERSCAN_API_KEY
```

Faucets: [ETH](https://portal.cdp.coinbase.com/products/faucet) ·
[USDC](https://faucet.circle.com).

`TOKEN_ADDRESS` defaults to the canonical USDC for known chains (`scripts/tokens.js`) and is required
elsewhere. Before deploying, the script checks there is real contract code at that address whose
symbol and decimals match the record, and refuses to proceed otherwise. It aborts on an unfunded
deployer rather than failing halfway. Afterwards it writes `deployments/<chainId>.json` — address,
chain id, token, deployment transaction, block, gas, constructor args, compiler settings, ABI — and
copies the ABI and deployment record into `lib/vaulted/generated/`.

`verify:*` reads that record, so the constructor arguments never have to be retyped.

Then point the app at it:

```
NEXT_PUBLIC_CHAIN_ID=84532
```

The addresses come from the committed deployment record, so nothing else needs setting. Chains with
no record simply do not appear, and the UI shows "not deployed yet" with the reason — it never
substitutes a placeholder address.

**Choosing an arbiter.** With `ARBITER_ADDRESS` set, that address can split a *disputed* escrow
between its own two participants and nothing more. With it empty, `resolveDispute` is permanently
unavailable and a dispute can only end by the payer releasing or the payee refunding. Pick
deliberately — the trade-off is a trusted party versus a dispute with no third-party resolution.

### 3. App

```bash
cp .env.example .env.local     # set DATABASE_URL
npm install                    # or `npm ci` for an exact lockfile install
npm run db:deploy              # or: npm run db:push
npm run dev
```

`npm run build` runs `prisma migrate deploy` before bundling, so a deployment either brings the
database to the committed migration state or fails. It never ships an app whose schema is missing —
which is what produces `P2021: The table public.Invoice does not exist` on the first request. The
step is skipped (with a warning) when `DATABASE_URL` is absent, so a build with no database still
works.

**Always run Prisma through the npm scripts, never as bare `npx prisma`.** `prisma` and
`@prisma/client` are pinned to exactly `6.19.3`, and the scripts resolve the binary from
`node_modules/.bin`. A bare `npx prisma` in a tree with no `node_modules` downloads the latest
published CLI (Prisma 7), which rejects this schema with
`P1012: The datasource property url is no longer supported in schema files` — Prisma 7 moved
`datasource.url` into a config file. This project stays on Prisma 6.

### 4. Local end-to-end

```bash
cd contracts && npx hardhat node --port 8545
cd contracts && TOKEN=$(npx hardhat run scripts/deploy-dev-token.js --network localhost) \
  && TOKEN_ADDRESS=$TOKEN ARBITER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
     npx hardhat run scripts/deploy.js --network localhost

# .env.local: NEXT_PUBLIC_CHAIN_ID=31337, NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
npm run db:push && npm run dev

npm run e2e:local        # drives the whole path and asserts it against the chain
npm run seed:local       # escrows in every state, for looking at the UI
npm run check:escrow-id  # pins the app's id derivation to the contract's
```

`check:escrow-id` compares the app's viem escrow-id derivation against vectors produced by the real
contract. If those drift, a payment link resolves to an escrow id that does not exist.

Deploying to the local chain regenerates `lib/vaulted/generated/deployments.ts` with your throwaway
chain-31337 addresses. That file is committed for real deployments only — leave the local churn out
of your commits (`git checkout -- lib/vaulted/generated/deployments.ts`).

## Troubleshooting

**`P2021: The table public.Invoice does not exist`** — the app is connected to a database that has
no schema. Migrations were never applied there, or they were applied to a *different* database than
the one `DATABASE_URL` points at. Check what that database actually has:

```bash
DATABASE_URL="<the url the app uses>" npm run db:status
```

Then apply them:

```bash
DATABASE_URL="<same url>" npm run db:deploy
```

A redeploy fixes it too, since `npm run build` now runs the same command.

**`DATABASE_URL resolved to an empty string`** — the variable exists but is empty. On Vercel, check
it is set for the environment being built (Production is separate from Preview), that the value has
no wrapping quotes or trailing newline, and redeploy: environment changes do not apply to an
existing deployment.

**Migrations fail against a pooled connection.** Neon and Supabase hand out a pooled (PgBouncer)
URL alongside a direct one. Queries work fine over the pooler; `migrate deploy` needs the direct
connection. If migrations hang or error while normal queries work, run them against the direct URL.

**Prisma CLI reports version 7.x** — you ran a bare `npx prisma` in a tree with no `node_modules`,
so npx downloaded the latest published CLI. Run `npm ci`, then use the `npm run db:*` scripts.

## Contract reference

| Function | Who | When | Effect |
| --- | --- | --- | --- |
| `createEscrow` | anyone (becomes payee) | — | `Created`. Terms on chain, no funds moved |
| `fund` | the named payer, or anyone on an open link | `Created` | `Funded`, protection window starts |
| `release` | payer | `Funded`/`Disputed` | `Released` — full amount to payee |
| `dispute` | payer | `Funded`, before expiry | `Disputed` — settlement paused |
| `refund` | payee | `Funded`/`Disputed` | `Refunded` — full amount to payer |
| `executeTimeout` | **anyone** | `Funded`, at or after expiry | `Released` — full amount to payee |
| `resolveDispute` | arbiter | `Disputed` | `Resolved` — split between payer and payee |
| `cancel` | payee, or anyone past the funding deadline | `Created` | `Cancelled` |

Protection period: default 24 hours, configurable between 1 hour and 365 days, counted from funding.

`Expired` is not a stored state — it is `Funded && block.timestamp >= expiresAt`, exposed through
`getEscrowView`. Storing it would mean paying gas to record the passage of time.

## Design decisions worth knowing

- **One token per deployment.** `token` is immutable, so there is no allowlist and no admin able to
  introduce a malicious token later. Another stablecoin or chain means another deployment.
- **Fee-on-transfer tokens are rejected, not tolerated.** `fund` measures the balance delta and
  reverts unless the escrow received exactly the amount, rather than silently under-funding.
- **`uint96` amounts.** Enough for any realistic stablecoin figure, and it packs the escrow into four
  storage slots.
- **Escrow ids are deterministic** — `keccak256(chainId, contract, payee, salt)` with
  `salt = keccak256(invoiceId)` — so the application can mint the id alongside the invoice row, and
  ids are namespaced per payee.
- **The countdown is chain-relative.** It is seeded from the contract's own `secondsUntilExpiry` and
  re-seeded each poll, never derived from the browser clock — expiry is decided by block timestamps.
- **No protocol fee.** Nothing is skimmed, and there is no owner who could add one.

## Status

The contract is **unaudited**. It has a thorough test suite and a deliberately small surface, but it
has not been reviewed by a third party. Treat mainnet deployment accordingly.
