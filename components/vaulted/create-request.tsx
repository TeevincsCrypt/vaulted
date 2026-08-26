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
  computeEscrowId,
  detailsHash as computeDetailsHash,
  escrowSalt,
  generateInvoiceId,
  invoiceCreationMessage,
  type InvoiceTerms,
} from '@/lib/vaulted/invoice'
import { PROTECTION_PERIOD_PRESETS, formatAmount, formatAmountExact, parseAmount } from '@/lib/vaulted/format'
import { Button, Card, Chip, CopyButton, Divider, Eyebrow, Field, Notice, StateTrack, inputClass } from './primitives'
import { TransactionStatus } from './transaction-status'
import { NetworkGuard, SignInButton } from './wallet'

type Stage = 'form' | 'signing' | 'publishing' | 'chain' | 'funding' | 'done'

/** Decimals for whichever asset an escrow holds — the token's, or the chain's own. */
function assetDecimalsFor(asset: `0x${string}`, config: VaultedConfig): number {
  return asset === ZERO_ADDRESS ? config.chain.nativeCurrency.decimals : config.token.decimals
}

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
  prefill?: {
    jobId: string
    amount: string
    asset: `0x${string}`
    description: string
    client: string
    payee: string
  }
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
  /*
    A job's escrow is denominated by the job, not by this form. Choosing here would mean securing a
    budget in something other than what was agreed and posted.
  */
  const assetAddress = (prefill ? prefill.asset : asset === 'native' ? ZERO_ADDRESS : config.token.address) as `0x${string}`
  const native = assetAddress === ZERO_ADDRESS
  const assetSymbol = native ? config.chain.nativeCurrency.symbol : config.token.symbol
  const assetDecimals = native ? config.chain.nativeCurrency.decimals : config.token.decimals

  /*
    Which side of this escrow is looking at the page.

    'payer' is the whole point of the v2 contract: the client creates the escrow naming the
    freelancer and funds it in the same flow, so the freelancer signs nothing on chain and needs no
    balance at all. 'payee' is a freelancer raising a request of their own, which still works and
    still costs them the gas for it.
  */
  const role: 'payer' | 'payee' =
    prefill && address && prefill.client.toLowerCase() === address.toLowerCase() ? 'payer' : 'payee'
  const asClient = role === 'payer'

  const [clientAddress, setClientAddress] = useState(prefill?.client ?? '')
  // A handle typed into the client field is resolved to the wallet linked to that account.
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState<{ handle: string; address: string | null } | null>(null)
  const [amountInput, setAmountInput] = useState(
    prefill ? formatAmountExact(prefill.amount, assetDecimalsFor(prefill.asset, config)) : '',
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

  // The two sides of the escrow, whichever of them is sitting at this form.
  const payee = (asClient ? prefill!.payee : address) as `0x${string}` | undefined
  const payer = (asClient ? address : effectiveClient) as `0x${string}` | undefined

  const canSubmit =
    isConnected &&
    Boolean(address) &&
    Boolean(amount) &&
    description.trim().length > 0 &&
    Boolean(payee) &&
    Boolean(payer) &&
    (asClient || (clientValid && !sameWallet))

  const busy = stage === 'signing' || stage === 'publishing' || stage === 'chain' || stage === 'funding'

  /*
    The flow's own stages, as a track. Labelled for what the person has to do rather than for what
    the code calls it, and the funding step only appears where funding actually happens here — a
    token escrow is funded on the payment page instead, and promising a step that never comes would
    be worse than showing one fewer.
  */
  const stageSteps = asClient && native
    ? ['Terms', 'Sign', 'Publish', 'Create', 'Fund']
    : ['Terms', 'Sign', 'Publish', 'Create']
  const stageIndex = { form: 0, signing: 1, publishing: 2, chain: 3, funding: 4, done: stageSteps.length }[stage]
  const shareUrl = invoiceId && typeof window !== 'undefined' ? `${window.location.origin}/pay/${invoiceId}` : null

  async function submit() {
    if (!address || !amount || !payee || !payer) return
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
      payee,
      payer,
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
          payee,
          payer,
          asset: assetAddress,
          signedBy: role,
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

      /*
        The client names the freelancer; the freelancer names the client. Same escrow either way —
        the contract derives its id from the pair — so all that differs is who is msg.sender, and
        therefore who pays for it.
      */
      setStage('chain')
      const commitment = computeDetailsHash(terms)
      const salt = escrowSalt(id)
      const hash = await tx.send({
        address: config.escrowAddress,
        abi: VAULTED_ESCROW_ABI,
        functionName: asClient ? 'createEscrowFor' : 'createEscrow',
        args: [
          asClient ? payee : payer,
          assetAddress,
          amount,
          protectionPeriod,
          fundingDeadline,
          commitment,
          salt,
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

      /*
        Funding, immediately, while the client is still here.

        Splitting it across two visits is what left budgets unsecured: an escrow that exists but
        holds nothing protects nobody, and the freelancer starts work on the strength of it. The
        client is the payer either way, so there is nobody else to wait for.

        A token escrow needs an allowance first, so that path stays on the payment page where the
        approve step already lives. Native has no allowance, so it is done here in one go.
      */
      if (asClient && native) {
        setStage('funding')
        const escrowId = computeEscrowId({
          chainId: config.chainId,
          escrowAddress: config.escrowAddress,
          payee,
          payer,
          salt,
        })
        const fundHash = await tx.send({
          address: config.escrowAddress,
          abi: VAULTED_ESCROW_ABI,
          functionName: 'fund',
          args: [escrowId],
          chainId: config.chainId,
          value: amount,
        })
        if (fundHash) {
          await fetch(`/api/invoices/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ field: 'fundTxHash', hash: fundHash }),
          })
        }
      }

      setStage('done')
      onCreated?.()
    } catch (cause) {
      setError(readableError(cause))
      setStage('form')
    }
  }

  if (stage === 'done' && invoiceId) {
    return (
      <Card className="p-7 sm:p-9">
        <div className="mb-8">
          <StateTrack steps={stageSteps} current={stageSteps.length} />
        </div>
        <span
          className="flex size-11 items-center justify-center rounded-full"
          style={{ background: 'var(--vt-positive-soft)', color: 'var(--vt-positive)' }}
        >
          <Check size={20} />
        </span>
        <h2 className="vt-editorial mt-6 text-[26px] uppercase">Payment request is live</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The escrow exists on {config.chain.name}. Share this link with your client — funds go
          straight into the contract, not to us.
        </p>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-3.5 py-3">
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
    <Card className="p-7 sm:p-9">
      <Eyebrow>{prefill ? 'Escrow for a job' : 'New payment request'}</Eyebrow>

      {/*
        What raising an escrow actually involves, shown before it starts rather than discovered one
        prompt at a time. Every step here is a real step the flow takes — the signature, the
        published record, and the transactions — and the track advances off the same `stage` the
        submit handler already drives, so it cannot claim progress the flow has not made.
      */}
      <div className="mt-7">
        <StateTrack steps={stageSteps} current={stageIndex} />
      </div>

      <h2 className="vt-editorial mt-9 text-[26px] uppercase">
        {prefill ? 'Secure the agreed budget' : 'Get paid, with escrow protection'}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {asClient
          ? 'The terms come from the job you posted. You create the escrow and fund it — the freelancer pays nothing and needs no balance at all.'
          : prefill
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
              <Chip
                key={option.key}
                selected={asset === option.key}
                disabled={busy || Boolean(prefill)}
                onClick={() => {
                  setAsset(option.key)
                  // Typed against the other asset's decimals — the same digits are a different
                  // quantity here.
                  setAmountInput('')
                }}
              >
                {option.label}
              </Chip>
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

        {asClient ? (
          <Field label="Freelancer" hint="Assigned to this job. The escrow pays this wallet.">
            <input
              value={prefill!.payee}
              readOnly
              spellCheck={false}
              className={`${inputClass} font-mono text-[13px] opacity-70`}
            />
          </Field>
        ) : (
        <Field
          label="Client"
          /*
            Nothing typed is not an error. An untouched field was greeting people with "That is not
            a wallet address or handle." the moment the form loaded, which reads as a mistake they
            have already made. The hint below says the field is required, and the submit button was
            always gated on the same `clientValid` — so this only stops the accusation, it does not
            let an empty field through.
          */
          error={
            raw === ''
              ? null
              : !clientValid
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
        )}

        <Field label="Protection window" hint="Counted from the moment the client funds the escrow.">
          <div className="flex flex-wrap gap-2">
            {PROTECTION_PERIOD_PRESETS.map((preset) => (
              <Chip
                key={preset.seconds}
                selected={protectionPeriod === preset.seconds}
                disabled={busy}
                onClick={() => setProtectionPeriod(preset.seconds)}
              >
                {preset.label}
              </Chip>
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
        {stage === 'funding' && <Notice>Escrow created. Approve the deposit to secure the budget…</Notice>}

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
              {!amount
                ? asClient
                  ? 'Secure the budget'
                  : 'Create payment request'
                : asClient
                  ? `Secure ${formatAmount(amount, assetDecimals)} ${assetSymbol} in escrow`
                  : `Create request for ${formatAmount(amount, assetDecimals)} ${assetSymbol}`}
            </Button>
          </NetworkGuard>
        )}

        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          {asClient
            ? native
              ? `A signature, then two transactions on ${config.chain.name}: one to create the escrow, one to fund it. The freelancer sends nothing and pays nothing.`
              : `A signature, then a transaction on ${config.chain.name} that creates the escrow. You fund it on the next screen, where ${config.token.symbol} needs an approval first. The freelancer sends nothing and pays nothing.`
            : `Two steps: a signature that publishes the link, then one transaction that creates the escrow on ${config.chain.name}. You pay gas only for the second.`}
        </p>
      </div>
    </Card>
  )
}
