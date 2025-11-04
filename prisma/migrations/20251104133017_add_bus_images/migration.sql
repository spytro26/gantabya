-- CreateTable
CREATE TABLE "BusImage" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusImage_busId_idx" ON "BusImage"("busId");

-- AddForeignKey
ALTER TABLE "BusImage" ADD CONSTRAINT "BusImage_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
