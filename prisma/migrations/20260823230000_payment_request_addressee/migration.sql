-- A payment request can now be addressed to a Vaulted account, and can stand in for a job's budget
-- on a network that cannot hold an escrow.
--
-- Additive only: both columns are nullable, so every existing open-link request is unaffected.

ALTER TABLE "PaymentRequest" ADD COLUMN "payerAccountId" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN "jobId" TEXT;

CREATE UNIQUE INDEX "PaymentRequest_jobId_key" ON "PaymentRequest"("jobId");
CREATE INDEX "PaymentRequest_payerAccountId_createdAt_idx" ON "PaymentRequest"("payerAccountId", "createdAt");

ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_payerAccountId_fkey"
    FOREIGN KEY ("payerAccountId") REFERENCES "Username"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
