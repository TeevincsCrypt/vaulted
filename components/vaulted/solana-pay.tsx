'use client'

import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana'
import { readableError } from '@/lib/vaulted/client'
import { formatAmountExact, parseAmount } from '@/lib/vaulted/format'
import { base58Encode, isSolanaAddress } from '@/lib/vaulted/solana'
import { Button, Divider, Eyebrow, Field, Notice, inputClass } from './primitives'

/**
 * Spending from the Solana wallet Vaulted assigns.
 *
 * Before this, Solana was receive-only: the address was shown and the money had to be moved from
 * somewhere else, which is not much use when it is sitting in the wallet Vaulted itself created.
 *
 * The signing key still lives with Privy and the user, split so that neither Privy alone nor
 * Vaulted — which holds no share at all — can sign. These components ask the user to approve a
 * transaction; they cannot produce one without them.
 *
 * The transaction is always built on the server, from state the browser cannot influence: the
 * payer is the session's own recorded wallet, and for a payment request the recipient and amount
 * come from the stored row. This file chooses none of those. It is handed bytes, it shows them to
 * the wallet, and it reports back the signature.
 *
 * A signature is not a payment, and nothing here says it is. It is handed to the caller, whose job
 * is to have the server read it back off the network before anything is called paid.
 */

type Phase = 'idle' | 'building' | 'signing' | 'verifying'

function useSolanaSend() {
  const { ready, wallets } = useWallets()
  const { signAndSendTransaction } = useSignAndSendTransaction()

  return {
    available: ready && wallets.length > 0,

    /**
     * Asks `endpoint` for an unsigned transaction. Split out from signing so a caller can move the
     * button to "waiting for your approval" the instant this resolves, rather than leaving it
     * saying "preparing" straight through the part where Privy's approval screen is already open
     * and waiting on the person — which read as the popup being slow or never arriving, when it
     * had arrived and the button just never said so.
     */
    async build(endpoint: string, payload: Record<string, unknown>): Promise<{ bytes: Uint8Array; payer: string }> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Could not build the transaction.')

      const bytes = Uint8Array.from(atob(body.transaction as string), (character) =>
        character.charCodeAt(0),
      )
      /*
        Only a shape check. Parsing the transaction here to inspect it would mean shipping a Solana
        SDK to every visitor for a reassurance it cannot really give — the browser cannot vouch for
        a transaction it did not build. What actually protects the user is the wallet's own
        approval screen, which shows them the transfer before they sign it.
      */
      if (bytes.length === 0 || bytes.length > 1232) {
        throw new Error('The server returned a transaction Solana would not accept.')
      }

      return { bytes, payer: body.payer as string }
    },

    /**
     * Hands the transaction to the wallet Vaulted assigned and returns the base58 signature.
     */
    async sign(bytes: Uint8Array, payer: string): Promise<string> {
      /*
        The signer is matched to the wallet the server built for, never picked here. If some other
        Solana wallet is loaded in this browser, signing with it would fail — and the failure would
        be far less clear than saying so.
      */
      const wallet = wallets.find((entry) => entry.address === payer)
      if (!wallet) {
        throw new Error(
          'The wallet recorded for your account is not loaded in this browser. Sign out and back ' +
            'in, then try again.',
        )
      }

      /*
        `optimisticBroadcast` returns as soon as the cluster accepts the transaction, rather than
        waiting on Privy's websocket confirmation. Two reasons. The websocket is a second endpoint
        that has to be reachable from the browser, and its confirmation wait throws after ten
        seconds — on a transaction that has *already* been broadcast, so a slow slot would report a
        successful payment as a failure. And Vaulted does not need Privy's opinion: whether the
        money moved is settled by reading the transaction back on the server, which is the only
        thing this app has ever treated as proof.
      */
      const { signature } = await signAndSendTransaction({
        transaction: bytes,
        wallet,
        options: { optimisticBroadcast: true },
      })
      return base58Encode(signature)
    },
  }
}

function phaseLabel(phase: Phase, idle: string): string {
  if (phase === 'building') return 'Preparing the transaction'
  if (phase === 'signing') return 'Waiting for your approval'
  if (phase === 'verifying') return 'Checking it against Solana'
  return idle
}

/** Pays a Solana payment request from the account's own wallet. */
export function SolanaPayButton({
  requestId,
  label,
  onSignature,
  onUnavailable,
  disabled,
}: {
  requestId: string
  label: string
  /** Called with the base58 signature. Verification is the caller's to do. */
  onSignature: (signature: string) => Promise<void> | void
  /**
   * Told whether the wallet ever loaded. The page wraps this button in a "or pay another way"
   * divider, and a divider with nothing above it is worse than no divider — it reads as a control
   * that failed to draw.
   */
  onUnavailable?: (unavailable: boolean) => void
  disabled?: boolean
}) {
  const { available, build, sign } = useSolanaSend()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onUnavailable?.(!available)
  }, [available, onUnavailable])

  if (!available) return null

  async function pay() {
    setError(null)
    try {
      setPhase('building')
      const { bytes, payer } = await build('/api/solana/transfer', { requestId })
      setPhase('signing')
      const signature = await sign(bytes, payer)
      setPhase('verifying')
      await onSignature(signature)
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="danger">{error}</Notice>}
      <Button size="lg" full busy={phase !== 'idle'} disabled={disabled || phase !== 'idle'} onClick={pay}>
        <Wallet size={16} />
        {phaseLabel(phase, label)}
      </Button>
    </div>
  )
}

/**
 * Moving money out of the Solana wallet to an address of the user's choosing.
 *
 * Either asset the wallet holds — the network's USDC, or SOL itself. SOL was the conspicuous gap:
 * the balance was shown, the wallet plainly held it, and the only route out was exporting the key.
 *
 * The destination is theirs to pick and there is no undo, so the address is shown back in full
 * before the button is offered — a truncated one hides exactly the characters a typo lives in.
 */
export function SolanaWithdraw({
  symbol,
  decimals,
  available,
  solAvailable,
  onSent,
}: {
  symbol: string
  decimals: number
  /** Base units currently held, so an over-send is caught before the network rejects it. */
  available: string | null
  /** Lamports currently held. Null when that balance could not be read. */
  solAvailable: string | null
  onSent: () => void
}) {
  const { available: canSign, build, sign } = useSolanaSend()
  const [asset, setAsset] = useState<'token' | 'native'>('token')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)

  const native = asset === 'native'
  const activeSymbol = native ? 'SOL' : symbol
  const activeDecimals = native ? 9 : decimals
  const activeAvailable = native ? solAvailable : available

  const destinationValid = isSolanaAddress(to.trim())
  const base = parseAmount(amount, activeDecimals)
  /*
    For SOL this is a first pass and deliberately not the last word. The fee comes out of the same
    balance as the amount, and only the server can quote it against the real message — so sending
    every last lamport looks affordable here and is refused there, with the actual numbers. Better
    that than this page inventing a fee to subtract.
  */
  const tooMuch = base !== null && activeAvailable !== null && base > BigInt(activeAvailable)

  if (!canSign) {
    return (
      <>
        <Divider className="my-5" />
        <Eyebrow>Sending out</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Your Solana wallet has not loaded in this browser yet. Reload the page; if it stays this
          way, sign out and back in.
        </p>
      </>
    )
  }

  async function withdraw() {
    if (!destinationValid || !base || tooMuch) return
    setError(null)
    setSignature(null)
    try {
      setPhase('building')
      const { bytes, payer } = await build('/api/solana/withdraw', {
        to: to.trim(),
        amount: base.toString(),
        asset,
      })
      setPhase('signing')
      const result = await sign(bytes, payer)
      setSignature(result)
      setAmount('')
      onSent()
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <>
      <Divider className="my-5" />
      <Eyebrow>Sending out</Eyebrow>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        Straight from this wallet to any Solana address. You approve it; Vaulted cannot sign for
        you, and there is no way to reverse it once it is sent.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <Field label="Asset">
          <div className="flex flex-wrap gap-2">
            {([
              { key: 'token' as const, label: symbol },
              { key: 'native' as const, label: 'SOL' },
            ]).map((option) => (
              <button
                key={option.key}
                type="button"
                disabled={phase !== 'idle'}
                onClick={() => {
                  setAsset(option.key)
                  // The amount was typed against the other asset's decimals and balance. Carrying
                  // it over would be a different quantity wearing the same digits.
                  setAmount('')
                  setError(null)
                }}
                className={`rounded-lg border px-3 py-2 text-[13px] transition disabled:opacity-50 ${
                  asset === option.key
                    ? 'border-[var(--vt-accent)] bg-[var(--vt-accent-dim)] text-[var(--vt-accent)]'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Destination address"
          error={to.trim() && !destinationValid ? 'That is not a Solana address.' : null}
        >
          <input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            spellCheck={false}
            placeholder="Solana address"
            className={`${inputClass} font-mono text-[12.5px]`}
            disabled={phase !== 'idle'}
          />
        </Field>

        <Field
          label={`Amount (${activeSymbol})`}
          hint={
            activeAvailable !== null
              ? `${formatAmountExact(BigInt(activeAvailable), activeDecimals)} ${activeSymbol} available` +
                (native ? ' — the network fee comes out of this too' : '')
              : undefined
          }
          error={
            amount && !base
              ? 'Enter an amount greater than zero.'
              : tooMuch
                ? 'That is more than this wallet holds.'
                : null
          }
        >
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={`${inputClass} vt-numeric`}
            disabled={phase !== 'idle'}
          />
        </Field>
      </div>

      {error && <div className="mt-4"><Notice tone="danger">{error}</Notice></div>}
      {signature && (
        <div className="mt-4">
          <Notice tone="good" title="Sent">
            Solana accepted the transaction.
            <span className="mt-1 block break-all font-mono text-[11.5px]">{signature}</span>
          </Notice>
        </div>
      )}

      <div className="mt-5">
        <Button
          full
          busy={phase !== 'idle'}
          disabled={!destinationValid || !base || tooMuch || phase !== 'idle'}
          onClick={withdraw}
        >
          {phaseLabel(phase, `Send ${activeSymbol}`)}
        </Button>
      </div>
    </>
  )
}
