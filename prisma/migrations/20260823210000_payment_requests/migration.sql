-- Direct payment requests: "pay me $250", settled by transfer rather than escrow.
--
-- Additive only. Nothing existing is altered, so escrowed invoices are untouched.

CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recipientAddress" TEXT NOT NULL,
    "txHash" TEXT,
    "paidAmount" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentRequest_creatorId_createdAt_idx" ON "PaymentRequest"("creatorId", "createdAt");
CREATE INDEX "PaymentRequest_status_idx" ON "PaymentRequest"("status");

ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "Username"("id") ON DELETE CASCADE ON UPDATE CASCADE;
