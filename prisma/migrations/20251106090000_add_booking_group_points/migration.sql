-- Add boarding and dropping stop point references to booking groups
ALTER TABLE "BookingGroup"
    ADD COLUMN "boardingPointId" TEXT,
    ADD COLUMN "droppingPointId" TEXT;

ALTER TABLE "BookingGroup"
    ADD CONSTRAINT "BookingGroup_boardingPointId_fkey"
        FOREIGN KEY ("boardingPointId") REFERENCES "StopPoint"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BookingGroup"
    ADD CONSTRAINT "BookingGroup_droppingPointId_fkey"
        FOREIGN KEY ("droppingPointId") REFERENCES "StopPoint"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
