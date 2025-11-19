-- Add boarding and dropping stop point references to booking groups

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BookingGroup' AND column_name = 'boardingPointId'
    ) THEN
        ALTER TABLE "BookingGroup"
            ADD COLUMN "boardingPointId" TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'BookingGroup' AND column_name = 'droppingPointId'
    ) THEN
        ALTER TABLE "BookingGroup"
            ADD COLUMN "droppingPointId" TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'BookingGroup_boardingPointId_fkey'
    ) THEN
        ALTER TABLE "BookingGroup"
            ADD CONSTRAINT "BookingGroup_boardingPointId_fkey"
            FOREIGN KEY ("boardingPointId") REFERENCES "StopPoint"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'BookingGroup_droppingPointId_fkey'
    ) THEN
        ALTER TABLE "BookingGroup"
            ADD CONSTRAINT "BookingGroup_droppingPointId_fkey"
            FOREIGN KEY ("droppingPointId") REFERENCES "StopPoint"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
