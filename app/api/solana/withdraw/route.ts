import { NextRequest, NextResponse } from 'next/server'
import { getChain, VAULTED_CHAINS } from '@/lib/vaulted/registry'
import { isSolanaAddress } from '@/lib/vaulted/solana'
import { ApiError } from '@/lib/vaulted/server/auth'
import { requireAccount } from '@/lib/vaulted/server/accounts'
import { prepareTokenTransfer, SolanaTransferError } from '@/lib/vaulted/server/solana-transfer'

/**
 * POST /api/solana/withdraw — the unsigned transaction that moves the account's own USDC out.
 *
 * Unlike paying a request, the destination here does come from the body, and that is correct: this
 * is the user moving their own money to an address of their choosing, and there is nobody else to
 * ask. What still does not come from the body is the source — the payer is the wallet recorded for
 * the session, so this cannot be pointed at somebody else's funds.
 *
 * The server never signs. It hands back bytes; the user's wallet decides whether to approve them.
 */
export async function POST(request: NextRequest) {
  try {
    const account = await requireAccount()
    const body = (await request.json().catch(() => ({}))) as {
      to?: unknown
      amount?: unknown
      network?: unknown
    }

    const to = typeof body.to === 'string' ? body.to.trim() : ''
    if (!isSolanaAddress(to)) {
      throw new SolanaTransferError('That is not a Solana address.', 400)
    }

    let amount: bigint
    try {
      amount = BigInt(String(body.amount))
    } catch {
      throw new SolanaTransferError('That amount is not a whole number of base units.', 400)
    }
    if (amount <= 0n) throw new SolanaTransferError('Enter an amount greater than zero.', 400)

    const chain =
      getChain(typeof body.network === 'string' ? body.network : '') ??
      VAULTED_CHAINS.find((entry) => entry.family === 'svm' && entry.tier === 'production')
    if (!chain || chain.family !== 'svm' || !chain.token) {
      throw new SolanaTransferError('No Solana network is configured.', 409)
    }

    const wallet = account.wallets.find((entry) => entry.chainKey === chain.key)
    if (!wallet) {
      throw new SolanaTransferError(
        `No ${chain.name} wallet is recorded for your account. Sign out and back in to have one assigned.`,
        409,
      )
    }
    if (wallet.address === to) {
      throw new SolanaTransferError('That is this wallet — pick a different destination.', 400)
    }

    const prepared = await prepareTokenTransfer({
      chain,
      payer: wallet.address,
      recipient: to,
      amount,
    })
    return NextResponse.json(prepared)
  } catch (error) {
    if (SolanaTransferError.is(error) || ApiError.is(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[vaulted/solana withdraw]', error)
    return NextResponse.json(
      { error: 'Could not build the transaction. Solana may be unreachable.' },
      { status: 502 },
    )
  }
}
