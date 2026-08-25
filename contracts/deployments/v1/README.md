# v1 deployments

`VaultedEscrow` (v1), kept because its deployed bytecode stays verifiable and these records are the
audit trail of what was deployed where.

They are in this subdirectory rather than alongside the live records because `export-abi.js` reads
only the top level, and the app must not be handed a v1 address to call v2's ABI against. Both were
confirmed to hold nothing before the cutover — Base mainnet's `totalLocked` was zero, with no ether
balance — so no escrow was stranded by it.

| chain | address | note |
| --- | --- | --- |
| Base Mainnet (8453) | `0xfDF21Eb29D35286002FC0De5701dbEEDdC2A9ed0` | superseded by v2 |
| Base Sepolia (84532) | `0xDA365Cc851d26873f40c35B7D261DE86F110d969` | superseded by v2 |
