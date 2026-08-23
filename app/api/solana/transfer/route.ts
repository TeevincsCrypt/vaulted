import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getChain } from '@/lib/vaulted/registry'
import { ApiError } from '@/lib/vaulted/server/auth'
import { requireAccount } from '@/lib/vaulted/server/accounts'
import {
  isPaymentRequestId,
  PaymentRequestError,
} from '@/lib/vaulted/server/payment-requests'
import { prepareTokenTransfer, SolanaTransferError } from '@/lib/vaulted/server/solana-transfer'

/**
 * POST /api/solana/transfer — the unsigned transaction that pays a Solana payment request.
 *
 * The body names a payment request and nothing else. Who pays comes from the session, who is paid
 * and how much come from the stored request, and the mint comes from the registry. There is no
 * field a caller could set to redirect money.
 *
 * This does not mark anything paid, and it cannot: it hands back bytes to sign. The request only
 * becomes PAID when `/api/payment-requests/[id]/verify` has read the transaction off the network.
 */
export async function POST(request: NextRequest) {
  try {
    const account = await requireAccount()
    const body = (await request.json().catch(() => ({}))) as { requestId?: unknown }
    const requestId = typeof body.requestId === 'string' ? body.requestId : ''
    if (!isPaymentRequestId(requestId)) {
      throw new PaymentRequestError('No such payment request.', 404)
    }

    const row = await prisma.paymentRequest.findUnique({ where: { id: requestId } })
    if (!row) throw new PaymentRequestError('No such payment request.', 404)
    if (row.status !== 'PENDING') {
      throw new PaymentRequestError(`That payment request is ${row.status.toLowerCase()}.`, 409)
    }
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw new PaymentRequestError('That payment request has expired.', 409)
    }
    if (row.creatorId === account.id) {
      throw new PaymentRequestError('That is your own payment request.', 400)
    }

    const chain = getChain(row.network)
    if (!chain || chain.family !== 'svm') {
      throw new PaymentRequestError('That payment request is not on a Solana network.', 400)
    }

    const wallet = account.wallets.find((entry) => entry.chainKey === chain.key)
    if (!wallet) {
      throw new PaymentRequestError(
        `No ${chain.name} wallet is recorded for your account. Sign out and back in to have one ` +
          'assigned.',
        409,
      )
    }

    const prepared = await prepareTokenTransfer({
      chain,
      payer: wallet.address,
      recipient: row.recipientAddress,
      amount: BigInt(row.amount),
    })

    return NextResponse.json(prepared)
  } catch (error) {
    if (SolanaTransferError.is(error) || PaymentRequestError.is(error) || ApiError.is(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[vaulted/solana transfer]', error)
    return NextResponse.json(
      { error: 'Could not build the transaction. The Solana network may be unreachable.' },
      { status: 502 },
    )
  }
}
