-- CreateEnum
CREATE TYPE "OfferIssuer" AS ENUM ('SUPERADMIN', 'ADMIN');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "issuerType" "OfferIssuer" NOT NULL DEFAULT 'ADMIN',
ADD COLUMN     "ownerAdminId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "busServiceName" TEXT NOT NULL DEFAULT 'Ankush Travels';

-- CreateIndex
CREATE INDEX "Offer_issuerType_idx" ON "Offer"("issuerType");

-- CreateIndex
CREATE INDEX "Offer_ownerAdminId_idx" ON "Offer"("ownerAdminId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_ownerAdminId_fkey" FOREIGN KEY ("ownerAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
