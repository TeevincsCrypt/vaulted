'use client'

import { useEffect, useState } from 'react'
import { ArrowUpFromLine, Coins, ShieldCheck } from 'lucide-react'
import { erc20Abi, isAddress, getAddress } from 'viem'
import { useAccount, useBalance } from 'wagmi'
import { readableError, usePaymentConfig, useTokenBalance, useTransaction } from '@/lib/vaulted/client'
import { formatAmount, formatAmountExact, parseAmount, shortAddress } from '@/lib/vaulted/format'
import { useVaultedAuth } from './auth-provider'
import {
  Button,
  Card,
  CopyButton,
  Divider,
  Eyebrow,
  Field,
  Notice,
  Skeleton,
  inputClass,
} from './primitives'
import { useSession } from './session-provider'
import { AppShell } from './shell'
import { TransactionStatus } from './transaction-status'
import { NetworkGuard, SignInButton } from './wallet'

/**
 * The account's funds.
 *
 * Worth being precise about what "deposit" and "withdraw" mean here, because Vaulted is not a bank
 * and there is no Vaulted balance to move money in and out of. The money sits in the wallet Privy
 * assigned to the account, on chain, under the user's control:
 *
 *   Balance   read straight from the token contract and the chain's native balance.
 *   Deposit   somebody sends tokens to this address. There is nothing to authorise, so the page
 *             gives you the address rather than pretending there is a deposit button.
 *   Withdraw  a real ERC-20 transfer signed by the wallet. The tokens leave and do not come back.
 *
 * Escrowed money is deliberately absent from these numbers. It is not in the wallet — it is locked
 * in the escrow contract, and the dashboard is where that is accounted for.
 */
export function Funds() {
  const { address: connected } = useAccount()
  const config = usePaymentConfig()
  const { account } = useSession()
  const { walletPending } = useVaultedAuth()

  /*
    Balances and the receive address are reads, and the account's wallet address is already known
    from the session — it was read back from Privy and recorded server-side. Waiting for the wallet
    provider to finish loading before showing them would hide information we already hold. Signing
    is different, and `Withdraw` gates itself on a connected wallet.
  */
  const address = (connected ?? account?.primaryAddress ?? null) as `0x${string}` | null

  // The account's Solana wallet, recorded server-side when Privy provisioned it. Filed under the
  // Solana network precisely so it can never be confused with the EVM one.
  const solanaAddress = account?.wallets.find((wallet) => wallet.chainKey === 'solana')?.address ?? null

  return (
    <AppShell>
      <h1 className="vt-display text-3xl leading-tight sm:text-4xl">Funds</h1>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        What is in {account ? <span className="text-foreground">@{account.name}</span> : 'your'}
        &rsquo;s wallet right now, how to add to it, and how to send it somewhere else.
      </p>

      {!address ? (
        <div className="mt-8 max-w-sm">
          {walletPending ? (
            <Notice tone="warn" title="Your wallet is being created">
              Privy is provisioning it now. Balances appear once it exists.
            </Notice>
          ) : (
            <SignInButton size="lg" full label="Sign in to see your funds" />
          )}
        </div>
      ) : !config ? (
        <div className="mt-8">
          <Notice tone="warn" title="No payment network configured">
            This deployment has no network with a token, so there is no balance to read. Escrow is a
            separate matter — a balance only needs a token and an RPC.
          </Notice>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          <section>
            <Eyebrow>{config.chainName}</Eyebrow>
            <div className="mt-3 grid items-start gap-5 lg:grid-cols-2">
              <Balances address={address} />
              <Receive address={address} />
              <div className="lg:col-span-2">
                <Withdraw address={address} />
              </div>
            </div>
          </section>

          {solanaAddress && (
            <section>
              <Eyebrow>Solana</Eyebrow>
              <div className="mt-3 grid items-start gap-5 lg:grid-cols-2">
                <SolanaFunds address={solanaAddress} />
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  )
}

function Balances({ address }: { address: `0x${string}` }) {
  const config = usePaymentConfig()
  const token = useTokenBalance(address)
  const native = useBalance({ address, chainId: config?.chainId })

  return (
    <Card className="p-7">
      <Eyebrow>Balance</Eyebrow>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <div className="flex items-baseline gap-2">
            {token.isLoading ? (
              <Skeleton className="h-9 w-40" />
            ) : token.isError ? (
              <span className="text-[15px] text-muted-foreground">unreadable</span>
            ) : (
              <>
                <span className="text-[30px] font-semibold leading-none tracking-tight">
                  {formatAmountExact(token.data ?? 0n, config?.token.decimals ?? 6)}
                </span>
                <span className="text-[15px] text-muted-foreground">{config?.token.symbol}</span>
              </>
            )}
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            What Vaulted payments are denominated in, on {config?.chainName}.
          </p>
        </div>

        <Divider />

        <div>
          <div className="flex items-baseline gap-2">
            {native.isLoading ? (
              <Skeleton className="h-6 w-28" />
            ) : native.isError ? (
              <span className="text-[13.5px] text-muted-foreground">unreadable</span>
            ) : (
              <>
                <span className="text-[17px] font-medium">
                  {native.data ? formatAmount(native.data.value, native.data.decimals, 6) : '0'}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {native.data?.symbol ?? config?.chain.nativeCurrency.symbol}
                </span>
              </>
            )}
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            Gas. Every transaction — funding, releasing, withdrawing — needs some.
          </p>
        </div>
      </div>

      {(token.isError || native.isError) && (
        <div className="mt-4">
          <Notice tone="warn">
            A balance could not be read from {config?.chainName} just now. Nothing is estimated in
            its place.
          </Notice>
        </div>
      )}

      <p className="mt-5 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <Coins size={13} className="mt-0.5 shrink-0" />
        Money locked in escrow is not counted here — it has left this wallet and sits in the
        contract until it settles. The dashboard tracks that.
      </p>
    </Card>
  )
}

function Receive({ address }: { address: `0x${string}` }) {
  const config = usePaymentConfig()

  return (
    <Card className="p-7">
      <Eyebrow>Add funds</Eyebrow>
      <h2 className="vt-display mt-2 text-lg">Send to this address</h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
        There is no deposit to authorise: the wallet is yours and anything sent to this address on{' '}
        {config?.chainName} arrives directly, whether from an exchange, another wallet, or a client
        paying you.
      </p>

      <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
        <p className="break-all font-mono text-[13px] leading-relaxed">{address}</p>
        <div className="mt-3">
          <CopyButton value={address} label="Copy address" />
        </div>
      </div>

      <div className="mt-4">
        <Notice tone="warn">
          Send only {config?.token.symbol} or {config?.chain.nativeCurrency.symbol} on{' '}
          {config?.chainName}. Tokens sent on a different network reach a different chain&rsquo;s
          copy of this address, and Vaulted cannot recover them.
        </Notice>
      </div>
    </Card>
  )
}

function Withdraw({ address }: { address: `0x${string}` }) {
  const config = usePaymentConfig()
  const { address: signer } = useAccount()
  const balance = useTokenBalance(address)
  const tx = useTransaction()

  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const decimals = config?.token.decimals ?? 6
  const parsed = amount.trim() ? parseAmount(amount, decimals) : null
  const available = (balance.data as bigint | undefined) ?? 0n

  const destinationValid = isAddress(destination.trim())
  const sendingToSelf = destinationValid && getAddress(destination.trim()) === address
  // Only a balance we actually read can contradict an amount. An unreadable one blocks the send
  // outright rather than being treated as zero, which would reject every valid withdrawal.
  const balanceKnown = !balance.isLoading && !balance.isError
  const overBalance = balanceKnown && parsed !== null && parsed > available
  const ready =
    destinationValid && !sendingToSelf && parsed !== null && parsed > 0n && balanceKnown && !overBalance

  async function send() {
    if (!config || !ready || parsed === null) return
    setError(null)
    try {
      await tx.send({
        address: config.token.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [getAddress(destination.trim()), parsed],
        chainId: config.chainId,
      })
    } catch (cause) {
      setError(readableError(cause))
    }
  }

  return (
    <Card className="p-7">
      <Eyebrow>Withdraw</Eyebrow>
      <h2 className="vt-display mt-2 text-lg">Send {config?.token.symbol} somewhere else</h2>
      <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
        A transfer from your wallet, signed by you. It is final once confirmed — the chain has no
        undo, and neither does Vaulted.
      </p>

      <Divider className="my-5" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Destination address" hint="An address on the same network.">
          <input
            className={inputClass}
            placeholder="0x…"
            value={destination}
            spellCheck={false}
            onChange={(event) => setDestination(event.target.value)}
          />
        </Field>

        <Field
          label={`Amount (${config?.token.symbol})`}
          hint={
            balance.isError
              ? 'Your balance could not be read, so "Max" is unavailable.'
              : balance.isLoading
                ? 'Reading your balance…'
                : `${formatAmountExact(available, decimals)} available`
          }
        >
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="0.00"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Button
              variant="secondary"
              onClick={() => setAmount(formatAmountExact(available, decimals))}
              disabled={available === 0n || balance.isError || balance.isLoading}
            >
              Max
            </Button>
          </div>
        </Field>
      </div>

      {destination.trim() && !destinationValid && (
        <div className="mt-4">
          <Notice tone="danger">That is not a valid address.</Notice>
        </div>
      )}
      {sendingToSelf && (
        <div className="mt-4">
          <Notice tone="warn">That is this wallet&rsquo;s own address — the transfer would do nothing.</Notice>
        </div>
      )}
      {overBalance && (
        <div className="mt-4">
          <Notice tone="danger">
            That is more than the {formatAmountExact(available, decimals)} {config?.token.symbol} in
            this wallet.
          </Notice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="mt-5">
        <TransactionStatus
          phase={tx.phase}
          hash={tx.hash}
          error={tx.error}
          chain={config?.chain ?? null}
          pendingLabel="Sending"
          confirmedLabel="Sent"
        />
      </div>

      {!signer && (
        <div className="mt-4">
          <Notice tone="warn" title="Wallet not loaded">
            Your balance is shown from the address recorded for this account, but sending needs the
            wallet itself. It loads a moment after sign-in — if it does not, sign out and back in.
          </Notice>
        </div>
      )}

      <div className="mt-4 max-w-sm">
        <NetworkGuard>
          <Button
            size="lg"
            full
            busy={tx.phase === 'signing' || tx.phase === 'pending'}
            disabled={!ready || !signer}
            onClick={send}
          >
            <ArrowUpFromLine size={16} />
            {ready
              ? `Send ${amount} ${config?.token.symbol} to ${shortAddress(destination.trim())}`
              : `Send ${config?.token.symbol}`}
          </Button>
        </NetworkGuard>
      </div>

      <p className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <ShieldCheck size={13} className="mt-0.5 shrink-0" />
        Vaulted cannot sign this for you and cannot move funds out of your wallet. Only your
        approval in Privy sends it.
      </p>
    </Card>
  )
}

/**
 * The Solana side of the wallet.
 *
 * Receiving is complete: the address is real, it is the one Privy provisioned, and anything sent to
 * it arrives. The balance is read from the cluster through the server, so an API-keyed RPC stays
 * off the client and a browser-origin rejection cannot make it look broken.
 *
 * Sending is not offered, and there is no button pretending otherwise. Vaulted has no Solana
 * signing flow — the EVM wallet reaches wagmi through Privy's connector and the Solana one does
 * not — so a "withdraw" here would be a dead control. Exporting the key is the honest route out,
 * and it is on the wallet page.
 */
function SolanaFunds({ address }: { address: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ok'; token: { symbol: string; decimals: number; amount: string }; native: { amount: string }; networkName: string }
    | { status: 'error'; reason: string }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/solana/balance?address=${address}`, { cache: 'no-store' })
        const body = await response.json()
        if (cancelled) return
        if (!response.ok) throw new Error(body.error ?? 'Could not read Solana.')
        if (!body.readable) {
          setState({ status: 'error', reason: body.reason ?? 'Solana could not be read.' })
          return
        }
        setState({ status: 'ok', token: body.token, native: body.native, networkName: body.networkName })
      } catch (cause) {
        if (!cancelled) setState({ status: 'error', reason: readableError(cause) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address])

  return (
    <>
      <Card className="p-7">
        <Eyebrow>Balance</Eyebrow>
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              {state.status === 'loading' ? (
                <Skeleton className="h-9 w-40" />
              ) : state.status === 'error' ? (
                <span className="text-[15px] text-muted-foreground">unreadable</span>
              ) : (
                <>
                  <span className="text-[30px] font-semibold leading-none tracking-tight">
                    {formatAmountExact(state.token.amount, state.token.decimals)}
                  </span>
                  <span className="text-[15px] text-muted-foreground">{state.token.symbol}</span>
                </>
              )}
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              USDC on Solana. Payment links settle here too.
            </p>
          </div>

          <Divider />

          <div>
            <div className="flex items-baseline gap-2">
              {state.status === 'ok' ? (
                <>
                  <span className="text-[17px] font-medium">
                    {formatAmount(state.native.amount, 9, 6)}
                  </span>
                  <span className="text-[13px] text-muted-foreground">SOL</span>
                </>
              ) : state.status === 'loading' ? (
                <Skeleton className="h-6 w-28" />
              ) : (
                <span className="text-[13.5px] text-muted-foreground">unreadable</span>
              )}
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Solana fees, and the rent for a token account.
            </p>
          </div>
        </div>

        {state.status === 'error' && (
          <div className="mt-4">
            <Notice tone="warn">{state.reason} Nothing is estimated in its place.</Notice>
          </div>
        )}
      </Card>

      <Card className="p-7">
        <Eyebrow>Add funds</Eyebrow>
        <h2 className="vt-display mt-2 text-lg">Send USDC on Solana here</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          Your Solana wallet, provisioned with the account. Anything sent to it on Solana mainnet
          arrives directly.
        </p>

        <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
          <p className="break-all font-mono text-[13px] leading-relaxed">{address}</p>
          <div className="mt-3">
            <CopyButton value={address} label="Copy Solana address" />
          </div>
        </div>

        <div className="mt-4">
          <Notice tone="warn">
            Solana only. This is not an EVM address — sending Base USDC here loses it, and Vaulted
            cannot recover it.
          </Notice>
        </div>

        <Divider className="my-5" />

        <Eyebrow>Sending out</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Vaulted cannot yet sign a Solana transaction for you — the EVM wallet reaches the app
          through Privy&rsquo;s wagmi connector and the Solana one does not — so there is no send
          button here rather than one that would not work. To move these funds now, export the
          wallet key from <a href="/settings" className="underline">your wallet page</a> and send
          from any Solana wallet.
        </p>
      </Card>
    </>
  )
}
