-- Embedded wallets: an account is now identified by its Privy DID, and the wallet that arrives with
-- it is attested by Privy rather than by a user signature.
--
-- Additive and widening only. Existing signature-linked wallets keep their signature and are
-- labelled `SIGNATURE` by the column default, so no row loses its proof.

ALTER TABLE "Username" ADD COLUMN "privyUserId" TEXT;
CREATE UNIQUE INDEX "Username_privyUserId_key" ON "Username"("privyUserId");

ALTER TABLE "UsernameAddress" ADD COLUMN "provenance" TEXT NOT NULL DEFAULT 'SIGNATURE';
ALTER TABLE "UsernameAddress" ALTER COLUMN "proofSignature" DROP NOT NULL;
