import { createHash } from 'node:crypto'

/**
 * Twitter/X OAuth 2.0 with PKCE.
 *
 * Confidential client: the secret is used for the token exchange and never leaves the server. The
 * PKCE verifier is held in an httpOnly cookie for the duration of the redirect, so an intercepted
 * authorisation code is useless on its own.
 */

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
const TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const ME_URL = 'https://api.x.com/2/users/me?user.fields=profile_image_url,name,username'

export const TWITTER_SCOPES = ['users.read', 'tweet.read']

export type TwitterProfile = {
  id: string
  username: string
  name: string
  avatarUrl: string | null
}

export function isTwitterConfigured(): boolean {
  return Boolean(process.env.TWITTER_CLIENT_ID?.trim() && process.env.TWITTER_CLIENT_SECRET?.trim())
}

/**
 * Where Twitter sends the user back.
 *
 * Derived from the incoming request when APP_URL is unset, so preview deployments work without
 * per-environment configuration. Twitter requires an exact match, so whatever this resolves to must
 * be registered in the app's callback list.
 */
export function callbackUrl(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim()
  const origin = configured ? configured.replace(/\/$/, '') : new URL(requestUrl).origin
  return `${origin}/api/auth/twitter/callback`
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function authorizeUrl(input: { state: string; verifier: string; redirectUri: string }): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITTER_CLIENT_ID as string,
    redirect_uri: input.redirectUri,
    scope: TWITTER_SCOPES.join(' '),
    state: input.state,
    code_challenge: pkceChallenge(input.verifier),
    code_challenge_method: 'S256',
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

export async function exchangeCode(input: {
  code: string
  verifier: string
  redirectUri: string
}): Promise<string> {
  const basic = Buffer.from(
    `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`,
  ).toString('base64')

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
  })

  if (!response.ok) {
    // The body can echo request parameters, so only the status is surfaced.
    throw new Error(`Twitter rejected the authorisation code (HTTP ${response.status}).`)
  }

  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error('Twitter returned no access token.')
  return body.access_token
}

export async function fetchProfile(accessToken: string): Promise<TwitterProfile> {
  const response = await fetch(ME_URL, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!response.ok) throw new Error(`Could not read the Twitter profile (HTTP ${response.status}).`)

  const body = (await response.json()) as {
    data?: { id: string; username: string; name: string; profile_image_url?: string }
  }
  if (!body.data?.id || !body.data.username) throw new Error('Twitter returned an unexpected profile.')

  return {
    id: body.data.id,
    username: body.data.username,
    name: body.data.name,
    // The default avatar URL is the small variant; ask for the larger one.
    avatarUrl: body.data.profile_image_url?.replace('_normal', '_400x400') ?? null,
  }
}
