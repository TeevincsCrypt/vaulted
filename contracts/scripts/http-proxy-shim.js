/**
 * Makes Hardhat and ethers respect a configured HTTPS proxy.
 *
 * Two independent HTTP clients are involved in a single `hardhat run --network base`, and neither
 * reads the proxy environment variables the rest of the toolchain (curl, npm, git) already respects:
 *
 *   - ethers v6 talks to RPC endpoints with Node's core `http`/`https` modules directly
 *     (lib.commonjs/utils/geturl.js), never checking any proxy variable. Fixed here by registering
 *     a custom `getUrl` via `FetchRequest.registerGetUrl` that dispatches through an
 *     `HttpsProxyAgent`.
 *   - Hardhat's own network provider (internal/core/providers/http.js) uses undici directly, and
 *     checks only the single lowercase variable `http_proxy` — not `HTTPS_PROXY`, not
 *     `https_proxy`. Fixed here by setting that exact variable from whichever of the standard ones
 *     is actually present, since nothing else in this repo's tooling sets it.
 *
 * Without both fixes a sandboxed environment that requires an HTTPS proxy for all outbound traffic
 * (this repo's own CI/dev sandbox routes through one) sees every Hardhat command that talks to a
 * real chain fail as if the RPC were unreachable, even after that host is allowed through the proxy.
 *
 * A no-op everywhere else: outside a proxied environment none of `HTTPS_PROXY`/`https_proxy` is
 * set, so this changes nothing about how `npx hardhat run scripts/deploy.js --network base` behaves
 * on a normal machine.
 *
 * Required at the top of hardhat.config.cjs so it is active for every Hardhat command — `run`,
 * `verify`, the interactive console — not only the two scripts that happened to need it first.
 */
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy

if (proxyUrl) {
  const { ethers } = require('ethers')
  const { HttpsProxyAgent } = require('https-proxy-agent')
  const agent = new HttpsProxyAgent(proxyUrl)
  ethers.FetchRequest.registerGetUrl(ethers.FetchRequest.createGetUrlFunc({ agent }))

  if (process.env.http_proxy === undefined) {
    process.env.http_proxy = proxyUrl
  }
}
