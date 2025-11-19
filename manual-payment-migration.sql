-- Manual migration script to add Payment table
-- Run this directly on your Neon database when connection is available

-- Step 1: Create enums (idempotent)
DO $$ BEGIN
 CREATE TYPE "PaymentMethod" AS ENUM ('RAZORPAY', 'ESEWA');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'REFUNDED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "CurrencyCode" AS ENUM ('NPR', 'INR');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Step 2: Create Payment table (idempotent)
CREATE TABLE IF NOT EXISTS "Payment" (
    "id" TEXT NOT NULL,
    "bookingGroupId" TEXT,
    "userId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "baseCurrency" "CurrencyCode" NOT NULL DEFAULT 'NPR',
    "chargedAmount" DOUBLE PRECISION NOT NULL,
    "chargedCurrency" "CurrencyCode" NOT NULL,
    "exchangeRate" DOUBLE PRECISION,
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewaySignature" TEXT,
    "metadata" JSONB,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- Step 3: Create indexes (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_bookingGroupId_key" ON "Payment"("bookingGroupId");
CREATE INDEX IF NOT EXISTS "Payment_userId_idx" ON "Payment"("userId");
CREATE INDEX IF NOT EXISTS "Payment_method_status_idx" ON "Payment"("method", "status");

-- Step 4: Add foreign keys (idempotent)
DO $$ BEGIN
 ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingGroupId_fkey" 
   FOREIGN KEY ("bookingGroupId") REFERENCES "BookingGroup"("id") 
   ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" 
   FOREIGN KEY ("userId") REFERENCES "User"("id") 
   ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Verify table exists
SELECT 'Payment table created successfully!' as status
WHERE EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'Payment'
);
