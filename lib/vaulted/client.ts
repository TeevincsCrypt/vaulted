'use client'

import { useEffect, useMemo, useState } from 'react'
import { erc20Abi, type Address } from 'viem'
import {
  useAccount,
  useReadContract,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { VAULTED_ESCROW_ABI } from './generated/abi'
import {
  getPaymentConfig,
  getVaultedConfig,
  isConfigured,
  type PaymentConfig,
  type VaultedConfig,
} from './config'
import { displayStatus, EscrowState, type DisplayStatus } from './status'

/**
 * Client-side access to escrow state.
 *
 * Everything the UI decides — which buttons exist, whether funds have moved, whether the window has
 * closed — comes from these contract reads, not from the database. The API's cached status is only
 * ever used to render a list quickly; the moment a specific escrow is on screen, this is the source.
 */

export function useVaultedConfig(): VaultedConfig | null {
  return useMemo(() => {
    const config = getVaultedConfig()
    return isConfigured(config) ? config : null
  }, [])
}

/**
 * The network balances and direct transfers use.
 *
 * Separate from {@link useVaultedConfig} on purpose: that one answers "where can an escrow live",
 * this one answers "where is the money". A page that only reads a balance must ask this, or a
 * deployment with a token but no escrow contract wrongly reports having no token.
 */
export function usePaymentConfig(): PaymentConfig | null {
  return useMemo(() => getPaymentConfig(), [])
}

export type EscrowSnapshot = {
  state: EscrowState
  status: DisplayStatus
  payer: Address
  payee: Address
  amount: bigint
  createdAt: number
  fundedAt: number
  expiresAt: number
  fundingDeadline: number
  protectionPeriod: number
  detailsHash: `0x${string}`
  isExpired: boolean
  canTimeout: boolean
  canDispute: boolean
  secondsUntilExpiry: number
}

/**
 * Live read of one escrow. Polls, because a payment page has to notice a counterparty's transaction
 * without the viewer refreshing.
 */
export function useEscrow(escrowId: `0x${string}` | undefined, pollMs = 6000) {
  const config = useVaultedConfig()
  const query = useReadContract({
    address: config?.escrowAddress,
    abi: VAULTED_ESCROW_ABI,
    functionName: 'getEscrowView',
    args: escrowId ? [escrowId] : undefined,
    chainId: config?.chainId,
    query: {
      enabled: Boolean(config && escrowId),
      refetchInterval: pollMs,
      refetchOnWindowFocus: true,
    },
  })

  const snapshot: EscrowSnapshot | null = useMemo(() => {
    const view = query.data
    if (!view || !view.exists) return null
    const state = Number(view.escrow.state) as EscrowState
    return {
      state,
      status: displayStatus(state, view.isExpired),
      payer: view.escrow.payer,
      payee: view.escrow.payee,
      amount: view.escrow.amount,
      createdAt: Number(view.escrow.createdAt),
      fundedAt: Number(view.escrow.fundedAt),
      expiresAt: Number(view.escrow.expiresAt),
      fundingDeadline: Number(view.escrow.fundingDeadline),
      protectionPeriod: Number(view.escrow.protectionPeriod),
      detailsHash: view.escrow.detailsHash,
      isExpired: view.isExpired,
      canTimeout: view.canTimeout,
      canDispute: view.canDispute,
      secondsUntilExpiry: Number(view.secondsUntilExpiry),
    }
  }, [query.data])

  return {
    ...query,
    /** Null means the escrow does not exist on chain yet — not that the read failed. */
    escrow: snapshot,
    /** True once the chain has been read successfully, whatever it said. */
    read: query.isSuccess,
    /** Set when the chain could not be reached at all, which is not the same as "no escrow". */
    readError: query.isError ? (query.error?.message ?? 'The chain could not be read.') : null,
  }
}

export function useTokenAllowance(owner: Address | undefined) {
  const config = useVaultedConfig()
  return useReadContract({
    address: config?.token.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner && config ? [owner, config.escrowAddress] : undefined,
    chainId: config?.chainId,
    query: { enabled: Boolean(owner && config), refetchInterval: 6000 },
  })
}

export function useTokenBalance(owner: Address | undefined) {
  const config = usePaymentConfig()
  return useReadContract({
    address: config?.token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: config?.chainId,
    query: { enabled: Boolean(owner && config), refetchInterval: 10000 },
  })
}

export type TxPhase = 'idle' | 'signing' | 'pending' | 'confirmed' | 'error'

export type TxState = {
  phase: TxPhase
  hash: `0x${string}` | undefined
  error: string | null
  reset: () => void
}

/**
 * Wraps a write and its receipt into one state machine, so the UI can show a real transaction
 * lifecycle — wallet prompt, mined, confirmed — with the actual hash at every step.
 */
export function useTransaction() {
  const { writeContractAsync, data: writeHash, reset: resetWrite, isPending: writePending } = useWriteContract()
  /*
    Moving the chain's own currency is not a contract call and has no ABI to write through. ETH is
    what gas is paid in, so a wallet holding it and no token has real money here with no way out —
    which is what "I have ETH on it" was about. Kept inside this hook rather than beside it so both
    kinds of transaction produce the same phases, and `TransactionStatus` needs to know nothing
    about which one it is watching.
  */
  const { sendTransactionAsync, data: sendHash, reset: resetSend, isPending: sendPending } = useSendTransaction()

  // Only one of the two can be in flight: `send` and `sendNative` each reset the pair first, so
  // there is never a stale hash from the other sitting alongside a live one.
  const hash = writeHash ?? sendHash
  const receipt = useWaitForTransactionReceipt({ hash })
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)

  const phase: TxPhase = error
    ? 'error'
    : receipt.isSuccess
      ? 'confirmed'
      : hash
        ? 'pending'
        : signing || writePending || sendPending
          ? 'signing'
          : 'idle'

  useEffect(() => {
    if (receipt.isError) setError(receipt.error?.message ?? 'The transaction failed on chain.')
  }, [receipt.isError, receipt.error])

  function clear() {
    setError(null)
    resetWrite()
    resetSend()
  }

  async function send(request: Parameters<typeof writeContractAsync>[0]): Promise<`0x${string}` | null> {
    clear()
    setSigning(true)
    try {
      return await writeContractAsync(request)
    } catch (cause) {
      setError(readableError(cause))
      return null
    } finally {
      setSigning(false)
    }
  }

  /** A plain value transfer of the chain's native currency. */
  async function sendNative(request: Parameters<typeof sendTransactionAsync>[0]): Promise<`0x${string}` | null> {
    clear()
    setSigning(true)
    try {
      return await sendTransactionAsync(request)
    } catch (cause) {
      setError(readableError(cause))
      return null
    } finally {
      setSigning(false)
    }
  }

  return {
    send,
    sendNative,
    phase,
    hash,
    error,
    receipt,
    reset: clear,
  }
}

/** Wallet errors are verbose. Keep the first meaningful line and drop the stack of context. */
export function readableError(cause: unknown): string {
  if (!(cause instanceof Error)) return 'Something went wrong.'
  const message = cause.message
  if (/User rejected|User denied|rejected the request/i.test(message)) return 'You rejected the request in your wallet.'

  const custom = message.match(/reverted with the following reason:\s*\n?(.+)/)
  if (custom) return custom[1].trim()
  const errorName = message.match(/Error:\s*([A-Za-z]+)\((.*?)\)/)
  if (errorName) return humaniseContractError(errorName[1])

  return message.split('\n')[0].slice(0, 200)
}

const CONTRACT_ERRORS: Record<string, string> = {
  NotPayer: 'Only the client who funded this escrow can do that.',
  NotPayee: 'Only the freelancer receiving this payment can do that.',
  NotArbiter: 'Only the arbiter can do that.',
  NotYetExpired: 'The protection window has not closed yet.',
  ProtectionWindowClosed: 'The protection window has already closed, so a dispute is no longer possible.',
  InvalidState: 'This escrow has already moved past that step.',
  EscrowNotFound: 'No escrow with this id exists on chain.',
  EscrowAlreadyExists: 'An escrow already exists for this payment request.',
  FundingDeadlineInPast: 'The link deadline on this request has already passed. Create a new request with a later expiry, or none at all.',
  FundingDeadlinePassed: 'This payment link has expired and can no longer be funded.',
  UnexpectedAmountReceived: 'The token did not transfer the full amount, so the deposit was rejected.',
  ArbitrationUnavailable: 'This deployment has no arbiter configured.',
  ZeroAmount: 'The amount must be greater than zero.',
  PayerIsPayee: 'The client and the freelancer cannot be the same wallet.',
}

export function humaniseContractError(name: string): string {
  return CONTRACT_ERRORS[name] ?? `The contract rejected this call (${name}).`
}

/**
 * Ticking countdown seeded from the contract's own `secondsUntilExpiry`, re-seeded on every poll.
 *
 * Deliberately not derived from the browser clock: expiry is decided by block timestamps, and a
 * viewer whose clock is skewed would otherwise see a deadline that disagrees with the chain.
 */
export function useChainCountdown(secondsUntilExpiry: number | null | undefined, readAt?: number): number {
  const [remaining, setRemaining] = useState(secondsUntilExpiry ?? 0)

  useEffect(() => {
    if (secondsUntilExpiry === null || secondsUntilExpiry === undefined) return
    setRemaining(secondsUntilExpiry)
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [secondsUntilExpiry, readAt])

  return remaining
}

/** True when the wallet is connected but pointed at a different chain than the escrow. */
export function useWrongNetwork(): { wrong: boolean; expected: number | null; actual: number | undefined } {
  const config = useVaultedConfig()
  const { chainId, isConnected } = useAccount()
  return {
    wrong: Boolean(isConnected && config && chainId !== config.chainId),
    expected: config?.chainId ?? null,
    actual: chainId,
  }
}
