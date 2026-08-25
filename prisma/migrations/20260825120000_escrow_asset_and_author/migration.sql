-- VaultedEscrowV2: escrows can hold the chain's own currency as well as the token, and either
-- side may author the terms.
--
-- Both columns are defaulted rather than required so the migration applies to a table that already
-- has rows. The default asset is the zero address, which the contract reads as native currency;
-- that is correct for new rows and harmless for old ones, whose escrows live on the superseded v1
-- deployment and are no longer read through the app.
ALTER TABLE "Invoice"
  ADD COLUMN "asset" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
  ADD COLUMN "creationSignedBy" TEXT NOT NULL DEFAULT 'payee';
