-- AlterTable
ALTER TABLE "Username" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "twitterId" TEXT,
ALTER COLUMN "ownerAddress" DROP NOT NULL,
ALTER COLUMN "ownerChainKey" DROP NOT NULL,
ALTER COLUMN "claimSignature" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "jobId" TEXT,
    "invoiceId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_accountId_readAt_createdAt_idx" ON "Notification"("accountId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_accountId_createdAt_idx" ON "Notification"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Username_twitterId_key" ON "Username"("twitterId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Username"("id") ON DELETE CASCADE ON UPDATE CASCADE;

