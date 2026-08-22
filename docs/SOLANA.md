# Solana — NOT IMPLEMENTED

**Status: architecture only.** There is no Vaulted program on Solana. `solana-devnet` appears in the
chain registry with `availability: 'coming-soon'`, its adapter refuses every operation, and the
chain selector renders it as unselectable. Nothing in the app can initiate a Solana transaction.

This document is the specification for finishing it.

## Why it stopped here

The Solidity `VaultedEscrow` cannot be reused — Solana has no EVM. It needs a native program, and
building one needs the Solana platform tools:

| Requirement | State in the build environment |
| --- | --- |
| Rust / Cargo | Available |
| crates.io | Reachable |
| `cargo-build-sbf` (Solana LLVM toolchain, from `release.anza.xyz`) | **Blocked — HTTP 403 by egress policy** |
| Devnet RPC (`api.devnet.solana.com`) | **Blocked — HTTP 403 by egress policy** |

Without the SBF toolchain the program cannot be compiled, and without Devnet it cannot be deployed
or tested. Shipping unbuilt, untested Rust that *looks* like a deployed escrow would be worse than
shipping nothing: it invites someone to deploy it and put real money behind code no one has run.

## What already exists

- `lib/vaulted/adapters/types.ts` — the chain-agnostic `EscrowAdapter` interface both families implement.
- `lib/vaulted/adapters/solana.ts` — the adapter slot. Every method throws `ChainNotImplementedError`.
- `lib/vaulted/registry.ts` — `solana-devnet`, marked `coming-soon` with a truthful note.
- `scripts/check-adapters.mjs` — asserts the Solana adapter refuses everything, so it cannot quietly
  start returning plausible-looking data.

The application layer is already chain-agnostic: the payment flow, dashboard and receipt talk to
`EscrowAdapter`, not to viem.

## Program architecture required

An Anchor program mirroring the Solidity state machine:
`Created → Funded → Released | Refunded | Disputed → Resolved`, plus `Created → Cancelled`.

### Accounts

```
Escrow (PDA, seeds = ["escrow", payee.key(), salt])
  payer:             Pubkey        // zero until funded on an open link
  payee:             Pubkey
  mint:              Pubkey        // Devnet USDC: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
  amount:            u64
  state:             u8
  created_at:        i64
  funded_at:         i64
  expires_at:        i64
  funding_deadline:  i64
  protection_period: i64
  details_hash:      [u8; 32]
  vault_bump:        u8
  bump:              u8

Vault (PDA, seeds = ["vault", escrow.key()])
  An SPL token account owned by the Escrow PDA. Funds live here, never in a program-owned
  wallet, so the program has no key that could move them.
```

### Instructions

| Instruction | Signer | Preconditions | Effect |
| --- | --- | --- | --- |
| `create_escrow` | payee | escrow PDA uninitialised | writes terms, `state = Created` |
| `fund` | payer | `Created`, before `funding_deadline` | SPL transfer into the vault, `state = Funded`, sets `expires_at` |
| `release` | payer | `Funded` or `Disputed` | vault → payee, `state = Released` |
| `refund` | payee | `Funded` or `Disputed` | vault → payer, `state = Refunded` |
| `dispute` | payer | `Funded`, `now < expires_at` | `state = Disputed` |
| `execute_timeout` | **anyone** | `Funded`, `now >= expires_at` | vault → payee, `state = Released` |
| `resolve_dispute` | arbiter | `Disputed`, `payee_amount <= amount` | splits vault, `state = Resolved` |
| `cancel` | payee, or anyone past the deadline | `Created` | `state = Cancelled` |

### Checks that must be present

1. **Ownership** — constrain `escrow.payer` / `escrow.payee` with Anchor `has_one`; never trust a
   passed-in account.
2. **Vault authority** — the vault token account's authority must be the escrow PDA, verified by
   seeds, so only the program can move funds and only along the paths above.
3. **Mint match** — `vault.mint == escrow.mint`, rejecting a lookalike token.
4. **Double settlement** — every payout path asserts the current state and writes the terminal state
   *before* the CPI transfer, the same checks-effects-interactions ordering the Solidity contract uses.
5. **Rent / close** — close the vault and escrow accounts to the payer on settlement so rent is
   reclaimed and the PDA cannot be reused.
6. **Timeout is permissionless** — `execute_timeout` takes no signer constraint. This is the property
   that makes the payee independent of the payer, and it must survive.
7. **Amount is `u64`** — reject `amount == 0`, and check the vault balance actually increased by
   `amount` after the transfer (the SPL equivalent of the fee-on-transfer rejection).

### Frontend integration points

All of these already exist; only `solana.ts` changes.

1. Replace each `unavailable(...)` in `SolanaEscrowAdapter` with a real implementation returning
   `TxRequest` of `kind: 'svm'`.
2. `deriveEscrowId` returns the escrow PDA as a base58 string.
3. `readEscrow` fetches and decodes the Escrow account into the shared `EscrowSnapshot`.
4. Add a Solana wallet adapter alongside wagmi, and teach the transaction hook to execute
   `kind: 'svm'` requests — the switch point is already there in `TxRequest`.
5. Flip `solana-devnet` in `lib/vaulted/registry.ts` to `availability: 'live'` **only** once a
   program id is recorded, the same way EVM chains derive it from a deployment record.
6. `Invoice.chainKey` already stores `solana-devnet`; `Invoice.chainId` stays null-ish for non-EVM.

### Deployment, once the toolchain is available

```bash
anchor build
anchor deploy --provider.cluster devnet
anchor test                       # must cover every check above
solana address -k target/deploy/vaulted_escrow-keypair.json
```

Record the program id in a deployment record so the registry derives `live` from it rather than a
hand-edited flag — the same discipline the EVM side uses.

## Remaining work

- [ ] Anchor program implementing the instructions above
- [ ] Program tests: unauthorised release, double settlement, timeout before expiry, permissionless
      timeout after expiry, dispute states, wrong-mint rejection
- [ ] Devnet deployment + recorded program id
- [ ] Solana wallet adapter in the frontend
- [ ] `TxRequest` execution for `kind: 'svm'`
- [ ] USDC (Devnet) decimals/mint wiring in the registry
