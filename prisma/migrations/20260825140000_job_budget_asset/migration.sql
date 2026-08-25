-- A job's budget can be denominated in the chain's own currency as well as its token, now that
-- VaultedEscrowV2 can hold either.
--
-- Defaulted rather than required so the migration applies to a table that already has rows. Every
-- existing job was posted in the token, so they are backfilled to it rather than left on the
-- default: the zero address would silently restate a USDC budget as an ETH one.
ALTER TABLE "Job"
  ADD COLUMN "budgetAsset" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000';

UPDATE "Job" SET "budgetAsset" = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' WHERE "chainKey" = 'base';
