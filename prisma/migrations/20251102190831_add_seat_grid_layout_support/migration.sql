/*
  Warnings:

  - A unique constraint covering the columns `[busId,seatNumber,level]` on the table `Seat` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."Seat_busId_row_column_level_key";

-- AlterTable
ALTER TABLE "Bus" ADD COLUMN     "gridColumns" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "gridRows" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "Seat" ADD COLUMN     "columnSpan" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "rowSpan" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Seat_busId_level_idx" ON "Seat"("busId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_busId_seatNumber_level_key" ON "Seat"("busId", "seatNumber", "level");
