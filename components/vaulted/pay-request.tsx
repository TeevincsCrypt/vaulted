'use client'

import { useState } from 'react'
import { ArrowUpRight, Check, Clock, ShieldCheck, Wallet } from 'lucide-react'
import { erc20Abi, getAddress, isAddress } from 'viem'
import { useAccount } from 'wagmi'
import { readableError, useTransaction, useVaultedConfig } from '@/lib/vaulted/client'
import { formatAmount, formatTimestamp } from '@/lib/vaulted/format'
import { PRIVY_APP_ID } from '@/lib/vaulted/privy'
import { VaultedWordmark } from './marketing/logo'
import { useSession } from './session-provider'
import { SolanaPayButton } from './solana-pay'
import { Button, Card, CopyButton, Divider, Eyebrow, Field, Notice, inputClass } from './primitives'
import { StatusChip, shortForFamily } from './payment-requests'
import { TransactionStatus } from './transaction-status'

/**
 * The public payment page. Anybody with the link can open it, account or not.
 *
 * Three ways to pay, and none of them decides whether the payment happened:
 *
 *   In-app on an EVM network, when a Vaulted wallet is loaded — a real ERC-20 transfer, whose hash
 *   is then submitted for verification like any other.
 *
 *   In-app on Solana, when signed in — an SPL transfer the server builds and the user's own wallet
 *   signs. This is what makes the wallet Vaulted assigns usable for paying and not only for being
 *   paid.
 *
 *   From anywhere else, on either network — pay from whatever wallet you like and hand back the
 *   transaction. It is not a lesser route: the verification is identical.
 *
 * The button never sets the status. `POST /verify` reads the transaction off the network and the
 * server decides; until it says so, this page says "checking", not "paid".
 */

/** Roughly twenty seconds of grace, which covers a normal Solana or Base confirmation. */
const VERIFY_ATTEMPTS = 8
const VERIFY_INTERVAL_MS = 2_500

type PaymentRequest = {
  id: string
  amount: string
  currency: string
  decimals: number
  network: string
  networkName: string
  networkFamily: 'evm' | 'svm'
  description: string
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED'
  recipientAddress: string
  recipientHandle: string | null
  txHash: string | null
  paidAmount: string | null
  paidAt: string | null
  expiresAt: string | null
  createdAt: string
  explorerUrl: string | null
}

export function PayRequest({ initial }: { initial: PaymentRequest }) {
  const [request, setRequest] = useState(initial)
  const settled = request.status !== 'PENDING'

  return (
    <div className="vt-canvas min-h-screen px-5 py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <VaultedWordmark className="justify-center" />

        <Card className="mt-8 p-8">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>
                {request.recipientHandle ? `@${request.recipientHandle}` : 'Someone'} is requesting
              </Eyebrow>
              <p className="mt-2 text-[34px] font-semibold leading-none tracking-tight">
                {formatAmount(request.amount, request.decimals)}{' '}
                <span className="text-[18px] text-muted-foreground">{request.currency}</span>
              </p>
            </div>
            <StatusChip status={request.status} />
          </div>

          <p className="mt-4 text-[14.5px] leading-relaxed">{request.description}</p>

          <Divider className="my-6" />

          <dl className="flex flex-col gap-3 text-[13px]">
            <Row label="Network" value={request.networkName} />
            <Row
              label="Recipient"
              value={
                <span className="font-mono text-[12.5px]">
                  {shortForFamily(request.recipientAddress, request.networkFamily)}
                </span>
              }
            />
            <Row
              label="Requested"
              value={formatTimestamp(Math.floor(new Date(request.createdAt).getTime() / 1000))}
            />
            {request.expiresAt && request.status === 'PENDING' && (
              <Row
                label="Expires"
                value={formatTimestamp(Math.floor(new Date(request.expiresAt).getTime() / 1000))}
              />
            )}
          </dl>

          <div className="mt-7">
            {request.status === 'PAID' ? (
              <Notice tone="good" icon={<Check size={15} />} title="Paid">
                Confirmed on {request.networkName}
                {request.paidAt
                  ? ` on ${formatTimestamp(Math.floor(new Date(request.paidAt).getTime() / 1000))}`
                  : ''}
                . Verified against the network, not taken on trust.
                {request.explorerUrl && (
                  <a
                    href={request.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5"
                    style={{ color: 'var(--vt-accent)' }}
                  >
                    View the transaction <ArrowUpRight size={13} />
                  </a>
                )}
              </Notice>
            ) : request.status === 'CANCELLED' ? (
              <Notice tone="warn" icon={<Clock size={15} />} title="Cancelled">
                Whoever raised this withdrew it. Do not send anything.
              </Notice>
            ) : request.status === 'EXPIRED' ? (
              <Notice tone="warn" icon={<Clock size={15} />} title="Expired">
                This request passed its expiry date. Ask for a new link rather than paying this one.
              </Notice>
            ) : (
              <PayControls request={request} onSettled={setRequest} />
            )}
          </div>
        </Card>

        {!settled && (
          <p className="mt-5 flex items-start gap-2 px-2 text-[11.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            This is a direct transfer to the address above, not an escrow — the money is theirs the
            moment it lands. Vaulted marks it paid only after reading the transaction off{' '}
            {request.networkName}.
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}

function PayControls({
  request,
  onSettled,
}: {
  request: PaymentRequest
  onSettled: (next: PaymentRequest) => void
}) {
  const { address } = useAccount()
  const config = useVaultedConfig()
  const { account } = useSession()
  const tx = useTransaction()

  const [reference, setReference] = useState('')
  const [checking, setChecking] = useState(false)
  const [solanaWalletMissing, setSolanaWalletMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState<string | null>(null)

  // In-app paying is only offered where it can actually work: an EVM network the wallet is
  // configured for, with a signer loaded. Everything else goes through the paste path, which is
  // just as verifiable.
  const canPayInApp =
    request.networkFamily === 'evm' &&
    Boolean(address) &&
    Boolean(config) &&
    config?.chain.name === request.networkName &&
    isAddress(request.recipientAddress)

  /*
    Solana in-app needs a Vaulted session, because the server builds the transaction from the
    signed-in account's own wallet. Signed out, the page still works — it just falls back to
    paying from elsewhere and pasting the signature, which anyone can do.
  */
  const canPaySolanaInApp =
    request.networkFamily === 'svm' &&
    Boolean(PRIVY_APP_ID) &&
    Boolean(account) &&
    account?.wallets.some((wallet) => wallet.chainKey === request.network)

  /**
   * Submits a transaction for checking, and keeps asking while the network has merely not caught
   * up yet.
   *
   * A transaction that has just been broadcast is genuinely not visible for a moment, and the
   * first answer for a payment that will succeed is often "not seen yet". Reporting that and
   * stopping would leave the payer looking at a pending page for a payment that landed a second
   * later. So an unseen transaction is retried a few times before the page says anything.
   *
   * Only *unseen* is retried. A transaction that pays the wrong address or too little is a settled
   * answer, and asking again would not change it.
   */
  async function verify(candidate: string) {
    setChecking(true)
    setError(null)
    setPendingNote(null)
    try {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(`/api/payment-requests/${request.id}/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txHash: candidate }),
        })
        const body = await response.json()
        if (!response.ok && response.status !== 202) {
          throw new Error(body.error ?? 'Could not verify that payment.')
        }
        if (body.verified) {
          onSettled(body.request)
          return
        }
        if (!body.pending) {
          setError(body.reason ?? 'That transaction does not pay this request.')
          return
        }
        if (attempt >= VERIFY_ATTEMPTS - 1) {
          // Still unseen. Not proof it failed, and the page must not say it did.
          setPendingNote(body.reason ?? 'The network has not seen that transaction yet.')
          return
        }
        setPendingNote('Waiting for Solana to confirm it…')
        await new Promise((resolve) => setTimeout(resolve, VERIFY_INTERVAL_MS))
      }
    } catch (cause) {
      setError(readableError(cause))
    } finally {
      setChecking(false)
    }
  }

  async function payInApp() {
    if (!config || !isAddress(request.recipientAddress)) return
    setError(null)
    try {
      const hash = await tx.send({
        address: config.token.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [getAddress(request.recipientAddress), BigInt(request.amount)],
        chainId: config.chainId,
      })
      if (hash) await verify(hash)
    } catch (cause) {
      setError(readableError(cause))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canPaySolanaInApp && (
        <>
          <SolanaPayButton
            requestId={request.id}
            label={`Pay ${formatAmount(request.amount, request.decimals)} ${request.currency}`}
            disabled={checking}
            onSignature={verify}
            onUnavailable={setSolanaWalletMissing}
          />
          {solanaWalletMissing ? (
            <Notice tone="warn" title="Your Vaulted wallet has not loaded">
              Paying from it needs the wallet open in this browser. Reload the page, or pay from
              any Solana wallet using the address below — Vaulted checks either the same way.
            </Notice>
          ) : (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground">or pay from another wallet</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
        </>
      )}

      {canPayInApp && (
        <>
          <TransactionStatus
            phase={tx.phase}
            hash={tx.hash}
            error={tx.error}
            chain={config?.chain ?? null}
            pendingLabel="Sending"
            confirmedLabel="Sent — verifying"
          />
          <Button
            size="lg"
            full
            busy={tx.phase === 'signing' || tx.phase === 'pending' || checking}
            onClick={payInApp}
          >
            <Wallet size={16} />
            Pay {formatAmount(request.amount, request.decimals)} {request.currency}
          </Button>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] text-muted-foreground">or pay from another wallet</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <div className="rounded-xl border border-white/8 bg-black/25 p-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Send exactly{' '}
          <span className="text-foreground">
            {formatAmount(request.amount, request.decimals)} {request.currency}
          </span>{' '}
          on <span className="text-foreground">{request.networkName}</span> to:
        </p>
        <p className="mt-2 break-all font-mono text-[12.5px]">{request.recipientAddress}</p>
        <div className="mt-3">
          <CopyButton value={request.recipientAddress} label="Copy address" />
        </div>
      </div>

      <Field
        label={request.networkFamily === 'svm' ? 'Transaction signature' : 'Transaction hash'}
        hint="Paste it here and Vaulted checks it against the network."
      >
        <input
          className={inputClass}
          placeholder={request.networkFamily === 'svm' ? '5wHu1qwD…' : '0x…'}
          value={reference}
          spellCheck={false}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>

      {pendingNote && <Notice tone="warn" title="Not confirmed yet">{pendingNote} Try again in a moment.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      <Button
        variant={canPayInApp || canPaySolanaInApp ? 'secondary' : 'primary'}
        size="lg"
        full
        busy={checking}
        disabled={!reference.trim()}
        onClick={() => verify(reference.trim())}
      >
        I have paid — verify it
      </Button>
    </div>
  )
}
