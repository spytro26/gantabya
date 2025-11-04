/*
  Warnings:

  - A unique constraint covering the columns `[busId,tripDate]` on the table `Trip` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Trip" ALTER COLUMN "tripDate" SET DATA TYPE DATE;

-- CreateIndex
CREATE UNIQUE INDEX "Trip_busId_tripDate_key" ON "Trip"("busId", "tripDate");
