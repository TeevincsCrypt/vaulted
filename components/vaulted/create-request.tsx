'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Link2, PenLine, ShieldCheck } from 'lucide-react'
import { isAddress } from 'viem'
import { useAccount, useSignMessage } from 'wagmi'
import { VAULTED_ESCROW_ABI } from '@/lib/vaulted/generated/abi'
import type { VaultedConfig } from '@/lib/vaulted/config'
import { ZERO_ADDRESS } from '@/lib/vaulted/config'
import { readableError, useTransaction } from '@/lib/vaulted/client'
import {
  detailsHash as computeDetailsHash,
  escrowSalt,
  generateInvoiceId,
  invoiceCreationMessage,
  type InvoiceTerms,
} from '@/lib/vaulted/invoice'
import { PROTECTION_PERIOD_PRESETS, formatAmount, parseAmount } from '@/lib/vaulted/format'
import { Button, Card, CopyButton, Divider, Eyebrow, Field, Notice, inputClass } from './primitives'
import { TransactionStatus } from './transaction-status'
import { ConnectWalletButton, NetworkGuard } from './wallet'

type Stage = 'form' | 'signing' | 'publishing' | 'chain' | 'done'

/**
 * Freelancer flow: describe the work, sign the terms, put the escrow on chain, share the link.
 *
 * Two distinct signatures, for two distinct reasons. The first is an off-chain message that proves
 * the link was published by the wallet that will be paid. The second is the real `createEscrow`
 * transaction — until it confirms, there is no escrow, and the UI says so rather than showing a
 * link that would not work.
 */
export function CreateRequest({ config, onCreated }: { config: VaultedConfig; onCreated?: () => void }) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const tx = useTransaction()

  const [stage, setStage] = useState<Stage>('form')
  const [error, setError] = useState<string | null>(null)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)

  const [clientAddress, setClientAddress] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [description, setDescription] = useState('')
  const [protectionPeriod, setProtectionPeriod] = useState(config.defaultProtectionPeriod)
  const [deadlineDays, setDeadlineDays] = useState('')

  const amount = useMemo(() => parseAmount(amountInput, config.token.decimals), [amountInput, config.token.decimals])
  const clientValid = clientAddress.trim() === '' || isAddress(clientAddress.trim())
  const sameWallet =
    Boolean(address) && clientAddress.trim().toLowerCase() === address?.toLowerCase()

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
      payee: address,
      payer: (clientAddress.trim() || ZERO_ADDRESS) as `0x${string}`,
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
          payer: clientAddress.trim() || null,
          amount: amount.toString(),
          description: description.trim(),
          protectionPeriod,
          fundingDeadline: fundingDeadline || null,
          signature,
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
      <Eyebrow>New payment request</Eyebrow>
      <h2 className="vt-display mt-2 text-xl">Get paid, with escrow protection</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Your client funds a contract, not your wallet. You are paid automatically once the protection
        window closes.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <Field
          label={`Amount (${config.token.symbol})`}
          error={amountInput && !amount ? 'Enter an amount greater than zero.' : null}
        >
          <div className="relative">
            <input
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              inputMode="decimal"
              placeholder="500.00"
              className={`${inputClass} vt-numeric pr-20 text-lg`}
              disabled={busy}
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
              {config.token.symbol}
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
            disabled={busy}
          />
        </Field>

        <Field
          label="Client wallet"
          optional
          error={!clientValid ? 'That is not a wallet address.' : sameWallet ? 'This cannot be your own wallet.' : null}
          hint="Leave empty for an open link: the first wallet to fund it becomes the client."
        >
          <input
            value={clientAddress}
            onChange={(event) => setClientAddress(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className={`${inputClass} font-mono text-[13px]`}
            disabled={busy}
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
                    ? 'border-foreground bg-foreground text-background'
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
          <ConnectWalletButton size="lg" full label="Connect wallet to continue" />
        ) : (
          <NetworkGuard>
            <Button size="lg" full disabled={!canSubmit} busy={busy} onClick={submit}>
              {amount ? `Create request for ${formatAmount(amount, config.token.decimals)} ${config.token.symbol}` : 'Create payment request'}
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
