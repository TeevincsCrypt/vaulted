import { getAddress } from 'viem'
import { normaliseAssetId } from './registry'

/**
 * Canonical messages users sign to authenticate off-chain actions.
 *
 * These prove *authorship*, not payment — none of them move funds, and each says so, so a wallet
 * prompt is never mistaken for a transfer. Every message carries an `issuedAt` so a captured
 * signature cannot be replayed indefinitely.
 *
 * Both sides rebuild the message from the stored fields rather than trusting a client-supplied
 * string; a signature over text we did not construct proves nothing.
 */

/** How long a signed action stays valid. Long enough for a slow wallet, short enough to matter. */
export const SIGNATURE_TTL_SECONDS = 10 * 60

export function isFresh(issuedAt: number, now = Math.floor(Date.now() / 1000)): boolean {
  // A little tolerance for clock skew, but no open-ended future timestamps.
  return issuedAt <= now + 60 && now - issuedAt <= SIGNATURE_TTL_SECONDS
}

export function jobCreationMessage(input: {
  jobId: string
  title: string
  budgetAmount: string
  chainKey: string
  /**
   * What the budget is denominated in — the zero address for the chain's own currency, otherwise
   * its token. Part of the signed terms rather than a detail settled afterwards: without it a
   * signature over "1000000" says nothing about whether that is a dollar or a fortune.
   */
  budgetAsset: string
  client: string
  issuedAt: number
}): string {
  return [
    'Vaulted — post job',
    '',
    `Job: ${input.jobId}`,
    `Title: ${input.title}`,
    `Budget: ${input.budgetAmount} (base units)`,
    `Asset: ${normaliseAssetId(input.budgetAsset)}`,
    `Chain: ${input.chainKey}`,
    `Client: ${getAddress(input.client)}`,
    `Issued: ${new Date(input.issuedAt * 1000).toISOString()}`,
    '',
    'Signing posts this job. It does not fund an escrow or move any funds.',
  ].join('\n')
}

export function jobApplicationMessage(input: {
  jobId: string
  applicant: string
  issuedAt: number
}): string {
  return [
    'Vaulted — apply to job',
    '',
    `Job: ${input.jobId}`,
    `Applicant: ${getAddress(input.applicant)}`,
    `Issued: ${new Date(input.issuedAt * 1000).toISOString()}`,
    '',
    'Signing submits your application. It does not move any funds.',
  ].join('\n')
}

export function jobAcceptMessage(input: {
  jobId: string
  applicant: string
  client: string
  issuedAt: number
}): string {
  return [
    'Vaulted — accept applicant',
    '',
    `Job: ${input.jobId}`,
    `Applicant: ${getAddress(input.applicant)}`,
    `Client: ${getAddress(input.client)}`,
    `Issued: ${new Date(input.issuedAt * 1000).toISOString()}`,
    '',
    'Signing assigns this job. Funding the escrow is a separate on-chain transaction.',
  ].join('\n')
}

export function workSubmissionMessage(input: { jobId: string; applicant: string; issuedAt: number }): string {
  return [
    'Vaulted — submit work',
    '',
    `Job: ${input.jobId}`,
    `Freelancer: ${getAddress(input.applicant)}`,
    `Issued: ${new Date(input.issuedAt * 1000).toISOString()}`,
    '',
    'Signing marks the work as delivered. It does not release any funds.',
  ].join('\n')
}
