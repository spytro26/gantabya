-- AlterTable
ALTER TABLE "Stop" ALTER COLUMN "arrivalTime" SET DATA TYPE TEXT,
ALTER COLUMN "departureTime" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "Stop_name_idx" ON "Stop"("name");
