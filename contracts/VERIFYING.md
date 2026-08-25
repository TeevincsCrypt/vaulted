# Verifying the escrow contract on Basescan

The usual route is `npx hardhat verify`, and the key for it lives in `contracts/.env`
(`ETHERSCAN_API_KEY`). That works from any machine with normal outbound internet:

```
cd contracts
npx hardhat verify --network base 0x9fE2812C730Ff588e74625213de95F9639f406F3 \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  0xdF9124Ed99aD229af02FE3aaB06B6384d07b8c18
```

It does *not* work from this repo's dev sandbox, whose egress policy denies
`api.etherscan.io` — the failure there is `Proxy response (403) !== 200`, which is the
gateway refusing the host, not a bad key. Nothing to fix in the repo; run it elsewhere.

## Without any toolchain

Basescan's web form accepts the compiler's own Standard JSON Input, which is committed
here as `VaultedEscrowV2.standard-input.json`. On the contract's page → **Verify & Publish**:

| Field | Value |
| --- | --- |
| Compiler type | Solidity (Standard-Json-Input) |
| Compiler version | `v0.8.28+commit.7893614a` |
| License | MIT |
| Upload | `VaultedEscrowV2.standard-input.json` |

Optimizer settings (enabled, 800 runs) and `evmVersion: paris` are inside that file, so
there is nothing else to set. Then paste the ABI-encoded constructor arguments:

```
000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000df9124ed99ad229af02fe3aab06b6384d07b8c18
```

That is `(token, arbiter)` = canonical Base USDC and the arbiter the deployment was made
with — the same two values recorded in `deployments/8453.json`.

## Regenerating the input file

It comes straight out of Hardhat's build info rather than being hand-assembled, so it is
by construction the exact input the deployed bytecode was compiled from:

```
cd contracts && npx hardhat compile
node -e "
const fs=require('node:fs'),p='artifacts/build-info';
for (const f of fs.readdirSync(p)) {
  const b=JSON.parse(fs.readFileSync(p+'/'+f,'utf8'));
  if (b.input.sources['contracts/VaultedEscrowV2.sol']) {
    fs.writeFileSync('VaultedEscrowV2.standard-input.json', JSON.stringify(b.input,null,2));
    console.log('written from', f, '—', b.solcLongVersion);
  }
}"
```
