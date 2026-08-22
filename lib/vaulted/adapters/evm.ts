import { createPublicClient, encodeAbiParameters, erc20Abi, getAddress, http, keccak256, parseAbiParameters, type PublicClient } from 'viem'
import { VAULTED_ESCROW_ABI } from '../generated/abi'
import { explorerAddressUrl, explorerTxUrl, type VaultedChain } from '../registry'
import { displayStatus, EscrowState } from '../status'
import {
  ChainNotImplementedError,
  type CreateEscrowParams,
  type EscrowAdapter,
  type EscrowSnapshot,
  type TxRequest,
} from './types'

/**
 * EVM adapter, backed by the deployed VaultedEscrow Solidity contract.
 *
 * This is the implementation the live Base Sepolia deployment runs on. It wraps the same ABI and
 * the same call shapes the payment flow has always used — the interface is new, the on-chain
 * behaviour is unchanged.
 */
export class EvmEscrowAdapter implements EscrowAdapter {
  readonly chain: VaultedChain
  private readonly rpcUrl?: string
  private client: PublicClient | null = null

  constructor(chain: VaultedChain, rpcUrl?: string) {
    if (chain.family !== 'evm' || !chain.viemChain || !chain.evmChainId) {
      throw new Error(`EvmEscrowAdapter built for a non-EVM chain: ${chain.key}`)
    }
    this.chain = chain
    this.rpcUrl = rpcUrl
  }

  private get escrowAddress(): `0x${string}` {
    if (!this.chain.escrowAddress) {
      throw new ChainNotImplementedError(this.chain.key, 'No VaultedEscrow deployment is recorded for it.')
    }
    return this.chain.escrowAddress as `0x${string}`
  }

  private get chainId(): number {
    return this.chain.evmChainId as number
  }

  /** Mirrors `VaultedEscrow.computeEscrowId`. Verified against the contract by test vectors. */
  deriveEscrowId({ payee, salt }: { payee: string; salt: string }): string {
    return keccak256(
      encodeAbiParameters(parseAbiParameters('uint256, address, address, bytes32'), [
        BigInt(this.chainId),
        this.escrowAddress,
        getAddress(payee),
        salt as `0x${string}`,
      ]),
    )
  }

  private write(functionName: string, args: readonly unknown[]): TxRequest {
    return {
      kind: 'evm',
      chainId: this.chainId,
      address: this.escrowAddress,
      abi: VAULTED_ESCROW_ABI,
      functionName,
      args,
    }
  }

  buildCreate(params: CreateEscrowParams): TxRequest {
    return this.write('createEscrow', [
      getAddress(params.payer),
      BigInt(params.amount),
      params.protectionPeriod,
      params.fundingDeadline,
      params.detailsHash,
      params.salt,
    ])
  }

  buildFund(escrowId: string): TxRequest {
    return this.write('fund', [escrowId])
  }

  buildRelease(escrowId: string): TxRequest {
    return this.write('release', [escrowId])
  }

  buildRefund(escrowId: string): TxRequest {
    return this.write('refund', [escrowId])
  }

  buildDispute(escrowId: string, evidenceHash: string): TxRequest {
    return this.write('dispute', [escrowId, evidenceHash])
  }

  buildExecuteTimeout(escrowId: string): TxRequest {
    return this.write('executeTimeout', [escrowId])
  }

  /** ERC-20 needs an allowance before `fund` can pull the amount. Exactly the amount, no more. */
  buildApprove(amount: string): TxRequest {
    if (!this.chain.token) {
      throw new ChainNotImplementedError(this.chain.key, 'No escrow token is recorded for it.')
    }
    return {
      kind: 'evm',
      chainId: this.chainId,
      address: this.chain.token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: [this.escrowAddress, BigInt(amount)],
    }
  }

  private publicClient(): PublicClient {
    if (!this.client) {
      this.client = createPublicClient({
        chain: this.chain.viemChain,
        transport: http(this.rpcUrl),
      }) as PublicClient
    }
    return this.client
  }

  async readEscrow(escrowId: string): Promise<EscrowSnapshot | null> {
    const view = await this.publicClient().readContract({
      address: this.escrowAddress,
      abi: VAULTED_ESCROW_ABI,
      functionName: 'getEscrowView',
      args: [escrowId as `0x${string}`],
    })

    if (!view.exists) return null

    return {
      state: Number(view.escrow.state) as EscrowState,
      payer: view.escrow.payer,
      payee: view.escrow.payee,
      amount: view.escrow.amount.toString(),
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
  }

  explorerTx(hash: string): string | null {
    return explorerTxUrl(this.chain, hash)
  }

  explorerAddress(address: string): string | null {
    return explorerAddressUrl(this.chain, address)
  }
}

/** Re-exported so callers can label a snapshot without importing the status module separately. */
export { displayStatus }
