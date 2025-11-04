/*
  Warnings:

  - You are about to drop the column `lowerSeaterPrice` on the `Bus` table. All the data in the column will be lost.
  - You are about to drop the column `lowerSleeperPrice` on the `Bus` table. All the data in the column will be lost.
  - You are about to drop the column `upperSleeperPrice` on the `Bus` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Bus" DROP COLUMN "lowerSeaterPrice",
DROP COLUMN "lowerSleeperPrice",
DROP COLUMN "upperSleeperPrice";

-- AlterTable
ALTER TABLE "Stop" ADD COLUMN     "lowerSeaterPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "lowerSleeperPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "upperSleeperPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Holiday_busId_date_idx" ON "Holiday"("busId", "date");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_busId_date_key" ON "Holiday"("busId", "date");

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
