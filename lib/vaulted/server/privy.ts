import { PrivyClient, type AuthTokenClaims } from '@privy-io/server-auth'

/**
 * Server-side verification of Privy sessions.
 *
 * Privy runs the X sign-in and holds the wallet's key material split across an enclave and the
 * user's device, so Vaulted never sees a private key. What Vaulted must not do is take the
 * browser's word for who signed in: the client sends a Privy access token, and everything the
 * session is built from — the account identity and the wallet address — is read back from Privy
 * over an app-secret-authenticated call, never from the request body.
 *
 * Verification is Privy's own `PrivyClient.verifyAuthToken`. An earlier version of this file
 * hand-rolled it — fetching the app's verification key, coercing it to PEM, and checking the ES256
 * signature with node's crypto — to keep a dependency out of the trust path. That coercion is the
 * part that broke: the key Privy returns did not survive it, and every sign-in failed at
 * `createPublicKey` with "not a valid public key" *after* the user had already authenticated with
 * X and had a wallet created. Guessing at another provider's key encoding is not a thing to
 * maintain by hand, and the SDK both parses it correctly and fetches it itself, so there is no
 * verification key left to configure.
 *
 * The security properties are unchanged: ES256 pinned, `typ` checked, issuer `privy.io`, audience
 * equal to this app id, and expiry enforced. Most are the SDK's; the checks it leaves optional are
 * re-asserted below, so its defaults cannot quietly widen what this app accepts.
 */

const ISSUER = 'privy.io'

export type PrivyIdentity = {
  /** Privy DID, e.g. `did:privy:clxxxxxx`. Stable for the life of the account. */
  userId: string
  sessionId: string | null
}

export type PrivyTwitterAccount = {
  subject: string
  username: string
  name: string | null
  profilePictureUrl: string | null
}

export type PrivyEmbeddedWallet = {
  address: string
  chainType: string
  walletClientType: string
}

export type PrivyUser = {
  id: string
  twitter: PrivyTwitterAccount | null
  /** The EVM wallet Privy provisioned for this account, if it has one yet. */
  embeddedWallet: PrivyEmbeddedWallet | null
  /** The Solana wallet, kept separate: the two are different keys on different curves. */
  solanaWallet: PrivyEmbeddedWallet | null
}

export class PrivyError extends Error {
  readonly status: number
  private readonly __vaultedPrivyError = true

  constructor(message: string, status = 401) {
    super(message)
    this.name = 'PrivyError'
    this.status = status
  }

  /** Identity check that survives the module being loaded twice, unlike `instanceof`. */
  static is(value: unknown): value is PrivyError {
    return typeof value === 'object' && value !== null && '__vaultedPrivyError' in value
  }
}

/** Privy app ids are exactly this long. A value of any other length cannot be one. */
const APP_ID_LENGTH = 25

export function privyAppId(): string | null {
  const value = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null
  return value && value.length === APP_ID_LENGTH ? value : null
}

/** Distinguishes "nothing configured" from "configured with something that cannot work". */
function appIdIsMalformed(): boolean {
  const value = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null
  return Boolean(value) && privyAppId() === null
}

function privyAppSecret(): string | null {
  return process.env.PRIVY_APP_SECRET?.trim() || null
}

/** True only when both halves are present — an app id alone cannot verify anything. */
export function isPrivyConfigured(): boolean {
  return Boolean(privyAppId() && privyAppSecret())
}

function requireCredentials(): { appId: string; appSecret: string } {
  const appId = privyAppId()
  const appSecret = privyAppSecret()
  if (!appId || !appSecret) {
    throw new PrivyError(
      appIdIsMalformed()
        ? `NEXT_PUBLIC_PRIVY_APP_ID is set but is not a Privy app id — they are exactly ${APP_ID_LENGTH} characters.`
        : 'Sign-in is not configured on this deployment: NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET must both be set.',
      503,
    )
  }
  return { appId, appSecret }
}

/**
 * One client per credential pair, built on first use.
 *
 * Not at module load: an unconfigured deployment must still be able to import this file, because
 * the session route reads `isPrivyConfigured()` from it to report that sign-in is unavailable.
 * Keyed on the credentials so a change of environment cannot be served by a stale client, and
 * reused otherwise because the SDK caches the fetched verification key on the instance.
 */
let cached: { key: string; client: PrivyClient } | null = null

function client(): PrivyClient {
  const { appId, appSecret } = requireCredentials()
  const apiURL = process.env.PRIVY_API_URL?.trim() || undefined
  const key = `${appId}:${appSecret}:${apiURL ?? ''}`

  if (cached?.key === key) return cached.client

  const created = new PrivyClient(appId, appSecret, apiURL ? { apiURL } : undefined)
  cached = { key, client: created }
  return created
}

/**
 * Overrides the verification key, for tests only.
 *
 * `verifyAuthToken` takes the key as an optional second argument, which lets a suite mint tokens
 * against a throwaway keypair and check them without reaching Privy. Null restores the normal
 * behaviour, where the SDK fetches the real key itself.
 */
let verificationKeyOverride: string | null = null

export function __setVerificationKeyForTest(pem: string | null): void {
  verificationKeyOverride = pem
  cached = null
}

/**
 * Verifies a Privy access token and returns who it belongs to.
 *
 * The SDK pins ES256 and checks the issuer, audience and expiry. Everything it rejects becomes a
 * 401 here: a caller cannot tell a malformed token from a forged one, and should not be able to.
 */
export async function verifyPrivyToken(rawToken: string): Promise<PrivyIdentity> {
  const token = rawToken.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new PrivyError('No sign-in token supplied.')

  // Resolved before the try so a configuration problem keeps its own 503 rather than being
  // reported as a bad token.
  const privy = client()

  let claims
  try {
    claims = await privy.verifyAuthToken(token, verificationKeyOverride ?? undefined)
  } catch (cause) {
    throw new PrivyError(
      `That sign-in token failed verification: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  // Belt and braces over the SDK's own checks. These cost nothing, and mean a change in its
  // defaults cannot quietly widen what this app accepts.
  if (claims.issuer !== ISSUER) throw new PrivyError('That sign-in token was not issued by Privy.')
  if (!audienceIncludesThisApp(claims.appId)) {
    throw new PrivyError('That sign-in token was issued for a different app.')
  }
  // jose enforces `exp` only when the claim is present, so a token carrying none would never
  // expire. Privy always issues one; requiring it means a token that somehow lacks one is refused
  // rather than being good forever.
  if (typeof claims.expiration !== 'number' || claims.expiration <= Math.floor(Date.now() / 1000)) {
    throw new PrivyError('That sign-in session expired.')
  }
  if (!claims.userId) throw new PrivyError('That sign-in token has no subject.')

  return { userId: claims.userId, sessionId: claims.sessionId || null }
}

/**
 * `aud` is a single string in every token Privy issues, but the JWT spec allows an array and the
 * SDK passes whatever was in the claim straight through. Matching the way its own audience check
 * behaves — membership, not equality — keeps this guard from rejecting a token the SDK accepted.
 */
function audienceIncludesThisApp(audience: AuthTokenClaims['appId']): boolean {
  const appId = privyAppId()
  if (!appId) return false
  return Array.isArray(audience) ? audience.includes(appId) : audience === appId
}

/**
 * Reads the account back from Privy. The browser never gets to assert its own handle or address.
 *
 * `getUserById` is rate limited by Privy — acceptable here because it runs only when a session is
 * established, not on every request.
 */
export async function fetchPrivyUser(userId: string): Promise<PrivyUser> {
  const privy = client()

  let user
  try {
    user = await privy.getUserById(userId)
  } catch (cause) {
    throw new PrivyError(
      `Privy could not return that account: ${cause instanceof Error ? cause.message : String(cause)}`,
      502,
    )
  }

  let twitter: PrivyTwitterAccount | null = null
  let embeddedWallet: PrivyEmbeddedWallet | null = null
  let solanaWallet: PrivyEmbeddedWallet | null = null

  for (const entry of user.linkedAccounts ?? []) {
    if (entry.type === 'twitter_oauth' && !twitter && entry.subject && entry.username) {
      twitter = {
        subject: entry.subject,
        username: entry.username,
        name: entry.name ?? null,
        profilePictureUrl: entry.profilePictureUrl ?? null,
      }
    }

    // `privy` is the wallet client of the enclave-backed wallet. Anything else is an external
    // wallet the user connected, which this deployment does not use. The two chain types are kept
    // apart deliberately: a Solana address is not an EVM address and must never be filed as one.
    if (entry.type === 'wallet' && entry.address && entry.walletClientType === 'privy') {
      const wallet = {
        address: entry.address,
        chainType: entry.chainType,
        walletClientType: entry.walletClientType,
      }
      if (entry.chainType === 'ethereum' && !embeddedWallet) embeddedWallet = wallet
      if (entry.chainType === 'solana' && !solanaWallet) solanaWallet = wallet
    }
  }

  return { id: user.id || userId, twitter, embeddedWallet, solanaWallet }
}
