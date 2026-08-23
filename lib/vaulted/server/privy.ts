import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto'

/**
 * Server-side verification of Privy sessions.
 *
 * Privy runs the X sign-in and holds the wallet's key material split across an enclave and the
 * user's device, so Vaulted never sees a private key. What Vaulted must not do is take the
 * browser's word for who signed in: the client sends a Privy access token, and everything the
 * session is built from — the account identity and the wallet address — is read back from Privy
 * over an app-secret-authenticated call, never from the request body.
 *
 * The token is an ES256 JWT. It is verified here with node's crypto rather than a JWT library, so
 * there is no third dependency in the trust path: the algorithm is pinned, the issuer and audience
 * are checked, and expiry is enforced.
 */

const PRIVY_API_URL = process.env.PRIVY_API_URL?.trim() || 'https://auth.privy.io'
const ISSUER = 'privy.io'
const ALGORITHM = 'ES256'

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
  /** The wallet Privy provisioned for this account, if it has one yet. */
  embeddedWallet: PrivyEmbeddedWallet | null
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

async function privyFetch(path: string): Promise<unknown> {
  const { appId, appSecret } = requireCredentials()
  const response = await fetch(`${PRIVY_API_URL}${path}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
      'privy-app-id': appId,
      'content-type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new PrivyError(
      `Privy rejected the request (${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`,
      response.status === 404 ? 404 : 502,
    )
  }
  return response.json()
}

let cachedVerificationKey: KeyObject | null = null

/**
 * The app's public verification key, as SPKI PEM.
 *
 * Set PRIVY_VERIFICATION_KEY to avoid a round trip on cold start; otherwise it is read once from
 * the app settings endpoint and cached for the life of the process. Only the public half is ever
 * involved — it cannot mint a token, only check one.
 */
async function verificationKey(): Promise<KeyObject> {
  if (cachedVerificationKey) return cachedVerificationKey

  const fromEnv = process.env.PRIVY_VERIFICATION_KEY?.trim()
  const pem = fromEnv ? normalisePem(fromEnv) : await fetchVerificationKey()

  let key: KeyObject
  try {
    key = createPublicKey(pem)
  } catch {
    throw new PrivyError('The Privy verification key is not a valid public key.', 500)
  }
  if (key.asymmetricKeyType !== 'ec') {
    throw new PrivyError('The Privy verification key is not an EC key, so it cannot verify ES256.', 500)
  }

  cachedVerificationKey = key
  return key
}

async function fetchVerificationKey(): Promise<string> {
  const { appId } = requireCredentials()
  const body = await privyFetch(`/api/v1/apps/${encodeURIComponent(appId)}`)
  const value = isRecord(body) ? body.verification_key : undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new PrivyError('Privy did not return a verification key for this app.', 502)
  }
  return normalisePem(value)
}

/** Dashboard copy-paste often arrives with escaped newlines or as a bare base64 body. */
function normalisePem(value: string): string {
  const text = value.replace(/\\n/g, '\n').trim()
  if (text.includes('BEGIN PUBLIC KEY')) return text
  const body = text.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? text
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`
}

/** Exposed for tests: lets a suite install a known key without reaching the network. */
export function __setVerificationKeyForTest(pem: string | null): void {
  cachedVerificationKey = pem ? createPublicKey(normalisePem(pem)) : null
}

const fromB64url = (input: string) => Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/**
 * Verifies a Privy access token and returns who it belongs to.
 *
 * Pins the algorithm rather than reading it from the header: accepting whatever the token declares
 * is how `alg: none` and HMAC-with-the-public-key forgeries get in.
 */
export async function verifyPrivyToken(rawToken: string): Promise<PrivyIdentity> {
  const { appId } = requireCredentials()
  const token = rawToken.replace(/^Bearer\s+/i, '').trim()

  const parts = token.split('.')
  if (parts.length !== 3) throw new PrivyError('That sign-in token is malformed.')
  const [encodedHeader, encodedPayload, encodedSignature] = parts

  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(fromB64url(encodedHeader).toString('utf8'))
    payload = JSON.parse(fromB64url(encodedPayload).toString('utf8'))
  } catch {
    throw new PrivyError('That sign-in token is malformed.')
  }
  if (!isRecord(header) || !isRecord(payload)) throw new PrivyError('That sign-in token is malformed.')
  if (header.alg !== ALGORITHM) throw new PrivyError('That sign-in token uses an unexpected algorithm.')
  if (header.typ !== undefined && header.typ !== 'JWT') throw new PrivyError('That sign-in token is not a JWT.')

  const key = await verificationKey()
  // ES256 signatures are the raw r‖s pair, not DER — node needs telling.
  const signatureOk = verifySignature(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    { key, dsaEncoding: 'ieee-p1363' },
    fromB64url(encodedSignature),
  )
  if (!signatureOk) throw new PrivyError('That sign-in token failed verification.')

  if (payload.iss !== ISSUER) throw new PrivyError('That sign-in token was not issued by Privy.')

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audience.includes(appId)) throw new PrivyError('That sign-in token was issued for a different app.')

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new PrivyError('That sign-in session expired.')
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) throw new PrivyError('That sign-in token is not valid yet.')

  if (typeof payload.sub !== 'string' || !payload.sub) throw new PrivyError('That sign-in token has no subject.')

  return { userId: payload.sub, sessionId: typeof payload.sid === 'string' ? payload.sid : null }
}

/** Reads the account back from Privy. The browser never gets to assert its own handle or address. */
export async function fetchPrivyUser(userId: string): Promise<PrivyUser> {
  const body = await privyFetch(`/api/v1/users/${encodeURIComponent(userId)}`)
  if (!isRecord(body)) throw new PrivyError('Privy returned an unreadable account.', 502)

  const linked = Array.isArray(body.linked_accounts) ? body.linked_accounts : []

  let twitter: PrivyTwitterAccount | null = null
  let embeddedWallet: PrivyEmbeddedWallet | null = null

  for (const entry of linked) {
    if (!isRecord(entry)) continue

    if (entry.type === 'twitter_oauth' && !twitter) {
      const subject = typeof entry.subject === 'string' ? entry.subject : null
      const username = typeof entry.username === 'string' ? entry.username : null
      if (subject && username) {
        twitter = {
          subject,
          username,
          name: typeof entry.name === 'string' ? entry.name : null,
          profilePictureUrl: typeof entry.profile_picture_url === 'string' ? entry.profile_picture_url : null,
        }
      }
    }

    if (entry.type === 'wallet' && !embeddedWallet) {
      // `privy` is the wallet client of the enclave-backed wallet. Anything else is an external
      // wallet the user connected, which this deployment does not use.
      const address = typeof entry.address === 'string' ? entry.address : null
      const walletClientType = typeof entry.wallet_client_type === 'string' ? entry.wallet_client_type : ''
      const chainType = typeof entry.chain_type === 'string' ? entry.chain_type : ''
      if (address && walletClientType === 'privy' && chainType === 'ethereum') {
        embeddedWallet = { address, chainType, walletClientType }
      }
    }
  }

  const id = typeof body.id === 'string' ? body.id : userId
  return { id, twitter, embeddedWallet }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
