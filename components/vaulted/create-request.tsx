'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Link2, PenLine, ShieldCheck } from 'lucide-react'
import { isAddress } from 'viem'
import { useAccount, useSignMessage } from 'wagmi'
import { VAULTED_ESCROW_ABI } from '@/lib/vaulted/generated/abi'
import type { VaultedConfig } from '@/lib/vaulted/config'
import { ZERO_ADDRESS } from '@/lib/vaulted/config'
import { getChainByEvmId } from '@/lib/vaulted/registry'
import { readableError, useTransaction } from '@/lib/vaulted/client'
import {
  detailsHash as computeDetailsHash,
  escrowSalt,
  generateInvoiceId,
  invoiceCreationMessage,
  type InvoiceTerms,
} from '@/lib/vaulted/invoice'
import { PROTECTION_PERIOD_PRESETS, formatAmount, formatAmountExact, parseAmount } from '@/lib/vaulted/format'
import { Button, Card, CopyButton, Divider, Eyebrow, Field, Notice, inputClass } from './primitives'
import { TransactionStatus } from './transaction-status'
import { NetworkGuard, SignInButton } from './wallet'

type Stage = 'form' | 'signing' | 'publishing' | 'chain' | 'done'

/**
 * Freelancer flow: describe the work, sign the terms, put the escrow on chain, share the link.
 *
 * Two distinct signatures, for two distinct reasons. The first is an off-chain message that proves
 * the link was published by the wallet that will be paid. The second is the real `createEscrow`
 * transaction — until it confirms, there is no escrow, and the UI says so rather than showing a
 * link that would not work.
 */
export function CreateRequest({
  config,
  onCreated,
  prefill,
}: {
  config: VaultedConfig
  onCreated?: () => void
  /**
   * Pre-populated terms, used when raising the escrow for a job. The amount, client and description
   * come from the job that was agreed, so they are locked — editing them here would mean the escrow
   * no longer matches the job it claims to secure.
   */
  prefill?: { jobId: string; amount: string; description: string; client: string }
}) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const tx = useTransaction()

  const [stage, setStage] = useState<Stage>('form')
  const [error, setError] = useState<string | null>(null)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)

  /*
    Which asset the escrow will hold. One deployment serves the chain's own currency and one token,
    so this is a choice between exactly two things — not a token picker.
  */
  const [asset, setAsset] = useState<'token' | 'native'>('token')
  const native = asset === 'native'
  const assetAddress = (native ? ZERO_ADDRESS : config.token.address) as `0x${string}`
  const assetSymbol = native ? config.chain.nativeCurrency.symbol : config.token.symbol
  const assetDecimals = native ? config.chain.nativeCurrency.decimals : config.token.decimals

  const [clientAddress, setClientAddress] = useState(prefill?.client ?? '')
  // A handle typed into the client field is resolved to the wallet linked to that account.
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState<{ handle: string; address: string | null } | null>(null)
  const [amountInput, setAmountInput] = useState(
    prefill ? formatAmountExact(prefill.amount, config.token.decimals) : '',
  )
  const [description, setDescription] = useState(prefill?.description ?? '')
  const [protectionPeriod, setProtectionPeriod] = useState(config.defaultProtectionPeriod)
  const [deadlineDays, setDeadlineDays] = useState('')

  const amount = useMemo(() => parseAmount(amountInput, assetDecimals), [amountInput, assetDecimals])

  // Registry key for the configured chain, so handle resolution asks for the right network.
  const chainKey = getChainByEvmId(config.chainId)?.key ?? null

  const raw = clientAddress.trim()
  const looksLikeHandle = raw.startsWith('@') || /^[a-z0-9_]{3,20}$/i.test(raw)
  const resolvedAddress = resolved?.address ?? null
  const effectiveClient = isAddress(raw) ? raw : resolvedAddress
  /*
    A client is required now, where it used to be optional. The escrow id is derived from both
    parties, so an escrow addressed to nobody has no id to publish — see the contract's
    computeEscrowId. "Open link anyone can fund" is gone rather than quietly broken.
  */
  const clientValid =
    isAddress(raw) || (looksLikeHandle && resolved !== null && resolved.address !== null)

  // Resolve a typed handle, debounced, whenever it is not already an address.
  useEffect(() => {
    if (raw === '' || isAddress(raw) || !looksLikeHandle) {
      setResolved(null)
      return
    }
    let cancelled = false
    setResolving(true)
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/accounts/resolve?handle=${encodeURIComponent(raw.replace(/^@/, ''))}&chainKey=${chainKey ?? ''}`,
        )
        const body = await response.json()
        if (!cancelled) setResolved(body.found ? { handle: body.handle, address: body.address } : null)
      } catch {
        if (!cancelled) setResolved(null)
      } finally {
        if (!cancelled) setResolving(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [raw, looksLikeHandle, chainKey])
  const sameWallet = Boolean(address) && effectiveClient?.toLowerCase() === address?.toLowerCase()

  const canSubmit =
    isConnected && Boolean(address) && Boolean(amount) && description.trim().length > 0 && clientValid && !sameWallet

  const busy = stage === 'signing' || stage === 'publishing' || stage === 'chain'
  const shareUrl = invoiceId && typeof window !== 'undefined' ? `${window.location.origin}/pay/${invoiceId}` : null

  async function submit() {
    if (!address || !amount) return
    setError(null)

    const id = invoiceId ?? generateInvoiceId()
    setInvoiceId(id)

    const fundingDeadline = deadlineDays
      ? Math.floor(Date.now() / 1000) + Number(deadlineDays) * 24 * 60 * 60
      : 0

    const terms: InvoiceTerms = {
      invoiceId: id,
      chainId: config.chainId,
      escrowAddress: config.escrowAddress,
      tokenAddress: config.token.address,
      asset: assetAddress,
      payee: address,
      payer: effectiveClient as `0x${string}`,
      amount: amount.toString(),
      description: description.trim(),
      protectionPeriod,
      fundingDeadline,
    }

    try {
      setStage('signing')
      const signature = await signMessageAsync({ message: invoiceCreationMessage(terms) })

      setStage('publishing')
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceId: id,
          chainId: config.chainId,
          payee: address,
          payer: effectiveClient,
          asset: assetAddress,
          signedBy: 'payee',
          amount: amount.toString(),
          description: description.trim(),
          protectionPeriod,
          fundingDeadline: fundingDeadline || null,
          signature,
          jobId: prefill?.jobId ?? null,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not publish the payment request.')
      }

      setStage('chain')
      const hash = await tx.send({
        address: config.escrowAddress,
        abi: VAULTED_ESCROW_ABI,
        functionName: 'createEscrow',
        args: [
          terms.payer,
          assetAddress,
          amount,
          protectionPeriod,
          fundingDeadline,
          computeDetailsHash(terms),
          escrowSalt(id),
        ],
        chainId: config.chainId,
      })
      if (!hash) {
        setStage('form')
        return
      }

      await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field: 'createTxHash', hash }),
      })

      setStage('done')
      onCreated?.()
    } catch (cause) {
      setError(readableError(cause))
      setStage('form')
    }
  }

  if (stage === 'done' && invoiceId) {
    return (
      <Card className="p-7">
        <span
          className="flex size-10 items-center justify-center rounded-xl"
          style={{ background: 'var(--vt-positive-soft)', color: 'var(--vt-positive)' }}
        >
          <Check size={19} />
        </span>
        <h2 className="vt-display mt-5 text-xl">Payment request is live</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The escrow exists on {config.chain.name}. Share this link with your client — funds go
          straight into the contract, not to us.
        </p>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-muted px-3.5 py-3">
          <Link2 size={15} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{shareUrl}</span>
          {shareUrl && <CopyButton value={shareUrl} label="Copy link" />}
        </div>

        <div className="mt-3">
          <TransactionStatus
            phase={tx.phase}
            hash={tx.hash}
            error={tx.error}
            chain={config.chain}
            confirmedLabel="Escrow created on chain"
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`/requests/${invoiceId}`}>
            <Button variant="secondary">
              Monitor escrow <ArrowUpRight size={15} />
            </Button>
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              setStage('form')
              setInvoiceId(null)
              setAmountInput('')
              setDescription('')
              setClientAddress('')
              tx.reset()
            }}
          >
            Create another
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-7">
      <Eyebrow>{prefill ? 'Escrow for a job' : 'New payment request'}</Eyebrow>
      <h2 className="vt-display mt-2 text-xl">
        {prefill ? 'Secure the agreed budget' : 'Get paid, with escrow protection'}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {prefill
          ? 'The amount, client and description come from the job you were hired for and cannot be changed here.'
          : 'Your client funds a contract, not your wallet. You are paid automatically once the protection window closes.'}
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <Field label="Paid in" hint="What the escrow will hold until it settles.">
          <div className="flex flex-wrap gap-2">
            {([
              { key: 'token' as const, label: config.token.symbol },
              { key: 'native' as const, label: config.chain.nativeCurrency.symbol },
            ]).map((option) => (
              <button
                key={option.key}
                type="button"
                disabled={busy || Boolean(prefill)}
                onClick={() => {
                  setAsset(option.key)
                  // Typed against the other asset's decimals — the same digits are a different
                  // quantity here.
                  setAmountInput('')
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
          label={`Amount (${assetSymbol})`}
          error={amountInput && !amount ? 'Enter an amount greater than zero.' : null}
        >
          <div className="relative">
            <input
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              inputMode="decimal"
              placeholder="500.00"
              className={`${inputClass} vt-numeric pr-20 text-lg`}
              disabled={busy || Boolean(prefill)}
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
              {assetSymbol}
            </span>
          </div>
        </Field>

        <Field label="Description" hint="Shown to your client on the payment page.">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Web3 Growth Campaign"
            maxLength={500}
            className={inputClass}
            disabled={busy || Boolean(prefill)}
          />
        </Field>

        <Field
          label="Client"
          error={
            !clientValid
              ? looksLikeHandle && !resolving
                ? resolved === null
                  ? 'No Vaulted account with that handle.'
                  : 'That account has not linked a wallet yet, so it cannot be paid.'
                : 'That is not a wallet address or handle.'
              : sameWallet
                ? 'This cannot be your own wallet.'
                : null
          }
          hint={
            resolving
              ? 'Looking up that handle…'
              : resolved?.address
                ? `@${resolved.handle} → ${resolved.address.slice(0, 10)}…${resolved.address.slice(-6)}`
                : 'An @handle or a 0x address. An escrow names both sides, so this is required.'
          }
        >
          <input
            value={clientAddress}
            onChange={(event) => setClientAddress(event.target.value)}
            placeholder="@handle or 0x…"
            spellCheck={false}
            className={`${inputClass} font-mono text-[13px]`}
            disabled={busy || Boolean(prefill)}
          />
        </Field>

        <Field label="Protection window" hint="Counted from the moment the client funds the escrow.">
          <div className="flex flex-wrap gap-2">
            {PROTECTION_PERIOD_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                disabled={busy}
                onClick={() => setProtectionPeriod(preset.seconds)}
                className={`rounded-lg border px-3 py-2 text-[13px] transition disabled:opacity-50 ${
                  protectionPeriod === preset.seconds
                    ? 'border-[var(--vt-accent)] bg-[var(--vt-accent-dim)] text-[var(--vt-accent)]'
                    : 'border-border hover:bg-muted'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Link expires in (days)" optional hint="After this the link can no longer be funded.">
          <input
            value={deadlineDays}
            onChange={(event) => setDeadlineDays(event.target.value.replace(/[^0-9]/g, ''))}
            placeholder="No expiry"
            inputMode="numeric"
            className={`${inputClass} vt-numeric`}
            disabled={busy}
          />
        </Field>
      </div>

      <Divider className="my-6" />

      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}

        {stage === 'signing' && (
          <Notice icon={<PenLine size={15} />}>
            Sign the terms in your wallet. This publishes the link; it does not move any funds.
          </Notice>
        )}
        {stage === 'publishing' && <Notice>Publishing the payment request…</Notice>}

        <TransactionStatus
          phase={tx.phase}
          hash={tx.hash}
          error={tx.error}
          chain={config.chain}
          pendingLabel="Creating the escrow on chain"
          confirmedLabel="Escrow created on chain"
        />

        {!isConnected ? (
          <SignInButton size="lg" full label="Sign in to continue" />
        ) : (
          <NetworkGuard>
            <Button size="lg" full disabled={!canSubmit} busy={busy} onClick={submit}>
              {amount ? `Create request for ${formatAmount(amount, assetDecimals)} ${assetSymbol}` : 'Create payment request'}
            </Button>
          </NetworkGuard>
        )}

        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          Two steps: a signature that publishes the link, then one transaction that creates the escrow
          on {config.chain.name}. You pay gas only for the second.
        </p>
      </div>
    </Card>
  )
}
