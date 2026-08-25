/**
 * The contract this repo deploys and talks to.
 *
 * Named in one place because three scripts have to agree on it — pre-flight simulates it, deploy
 * sends it, and the deployment record names it for verification. When they disagree, the failure is
 * a deployment that pre-flight approved and the app cannot use.
 *
 * v1 remains in `contracts/` so its deployed bytecode stays verifiable; nothing deploys it any more.
 */
module.exports = { CONTRACT_NAME: 'VaultedEscrowV2' }
