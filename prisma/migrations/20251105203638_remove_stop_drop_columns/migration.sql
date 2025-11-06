-- AlterTable
ALTER TABLE "Stop" DROP COLUMN "boardingPointAddress",
DROP COLUMN "boardingPointLandmark",
DROP COLUMN "boardingPointName",
DROP COLUMN "boardingPointTime",
DROP COLUMN "dropPointAddress",
DROP COLUMN "dropPointLandmark",
DROP COLUMN "dropPointName",
DROP COLUMN "dropPointTime";

-- AlterTable
ALTER TABLE "StopPoint" ALTER COLUMN "type" SET DEFAULT 'BOARDING';
