-- CreateEnum
CREATE TYPE "StopPointType" AS ENUM ('BOARDING', 'DROPPING');

-- AlterTable
ALTER TABLE "BookingGroup" ADD COLUMN     "boardingPointId" TEXT,
ADD COLUMN     "droppingPointId" TEXT;

-- CreateTable
CREATE TABLE "StopPoint" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "type" "StopPointType" NOT NULL,
    "name" TEXT NOT NULL,
    "landmark" TEXT,
    "address" TEXT,
    "time" TEXT NOT NULL,
    "pointOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StopPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StopPoint_stopId_type_pointOrder_idx" ON "StopPoint"("stopId", "type", "pointOrder");

-- CreateIndex
CREATE INDEX "BookingGroup_boardingPointId_idx" ON "BookingGroup"("boardingPointId");

-- CreateIndex
CREATE INDEX "BookingGroup_droppingPointId_idx" ON "BookingGroup"("droppingPointId");

-- AddForeignKey
ALTER TABLE "StopPoint" ADD CONSTRAINT "StopPoint_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingGroup" ADD CONSTRAINT "BookingGroup_boardingPointId_fkey" FOREIGN KEY ("boardingPointId") REFERENCES "StopPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingGroup" ADD CONSTRAINT "BookingGroup_droppingPointId_fkey" FOREIGN KEY ("droppingPointId") REFERENCES "StopPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
