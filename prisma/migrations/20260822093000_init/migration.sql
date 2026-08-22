-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "escrowAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "payeeAddress" TEXT NOT NULL,
    "payerAddress" TEXT,
    "fundedByAddress" TEXT,
    "amount" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detailsHash" TEXT NOT NULL,
    "protectionPeriod" INTEGER NOT NULL,
    "fundingDeadline" TIMESTAMP(3),
    "creationSignature" TEXT NOT NULL,
    "indexedStatus" TEXT NOT NULL DEFAULT 'AWAITING_CHAIN',
    "indexedAt" TIMESTAMP(3),
    "indexedBlock" BIGINT,
    "fundedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createTxHash" TEXT,
    "fundTxHash" TEXT,
    "settleTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_payeeAddress_createdAt_idx" ON "Invoice"("payeeAddress", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_payerAddress_createdAt_idx" ON "Invoice"("payerAddress", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_indexedStatus_idx" ON "Invoice"("indexedStatus");

-- CreateIndex
CREATE INDEX "Invoice_chainId_expiresAt_idx" ON "Invoice"("chainId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_chainId_escrowId_key" ON "Invoice"("chainId", "escrowId");

