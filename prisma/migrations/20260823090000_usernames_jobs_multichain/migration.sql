-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "chainKey" TEXT,
ADD COLUMN     "jobId" TEXT;

-- CreateTable
CREATE TABLE "Username" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "ownerChainKey" TEXT NOT NULL,
    "claimSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Username_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsernameAddress" (
    "id" TEXT NOT NULL,
    "usernameId" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "proofSignature" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsernameAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budgetAmount" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenDecimals" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3),
    "protectionPeriod" INTEGER NOT NULL,
    "clientAddress" TEXT NOT NULL,
    "clientSignature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "applicantAddress" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Username_name_key" ON "Username"("name");

-- CreateIndex
CREATE INDEX "Username_ownerAddress_idx" ON "Username"("ownerAddress");

-- CreateIndex
CREATE INDEX "UsernameAddress_address_idx" ON "UsernameAddress"("address");

-- CreateIndex
CREATE UNIQUE INDEX "UsernameAddress_usernameId_chainKey_key" ON "UsernameAddress"("usernameId", "chainKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsernameAddress_chainKey_address_key" ON "UsernameAddress"("chainKey", "address");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_clientAddress_idx" ON "Job"("clientAddress");

-- CreateIndex
CREATE INDEX "Job_assignedTo_idx" ON "Job"("assignedTo");

-- CreateIndex
CREATE INDEX "JobApplication_applicantAddress_idx" ON "JobApplication"("applicantAddress");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_jobId_applicantAddress_key" ON "JobApplication"("jobId", "applicantAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_jobId_key" ON "Invoice"("jobId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsernameAddress" ADD CONSTRAINT "UsernameAddress_usernameId_fkey" FOREIGN KEY ("usernameId") REFERENCES "Username"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

