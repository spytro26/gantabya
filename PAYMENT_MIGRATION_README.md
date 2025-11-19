# Payment Migration - Manual Setup

## Problem

The Neon database connection is currently unavailable, preventing Prisma migrations from running automatically. The `Payment` table and related enums need to be created.

## Solution Options

### Option 1: Run via Neon Console (Recommended)

1. Go to your Neon dashboard: https://console.neon.tech
2. Navigate to your project: `ep-icy-pine-adqq4agu-pooler.c-2.us-east-1.aws.neon.tech`
3. Open the SQL Editor
4. Copy and paste the contents of `manual-payment-migration.sql`
5. Execute the script

### Option 2: Run via psql (when connection is restored)

```bash
# From the back directory
cd /home/ankush/Documents/coding/red_bus/back

# Run the migration SQL directly
psql "$DATABASE_URL" -f manual-payment-migration.sql
```

### Option 3: Use Prisma Migrate (when connection is restored)

```bash
cd /home/ankush/Documents/coding/red_bus/back

# This will apply all pending migrations including the Payment table
npx prisma migrate deploy

# Or reset and rebuild the entire database (CAUTION: deletes data)
npx prisma migrate reset --force
```

## What Gets Created

- **3 Enums**: `PaymentMethod`, `PaymentStatus`, `CurrencyCode`
- **Payment Table** with columns:
  - id, bookingGroupId, userId
  - method, baseAmount, baseCurrency
  - chargedAmount, chargedCurrency, exchangeRate
  - gatewayOrderId, gatewayPaymentId, gatewaySignature
  - metadata (JSON), status, createdAt, updatedAt
- **Indexes** on bookingGroupId, userId, and (method, status)
- **Foreign Keys** to BookingGroup and User tables

## Verification

After running the migration, verify with:

```sql
-- Check if table exists
SELECT * FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'Payment';

-- Check enums
SELECT typname FROM pg_type WHERE typname IN ('PaymentMethod', 'PaymentStatus', 'CurrencyCode');

-- Check structure
\d Payment
```

## Next Steps

Once the migration is applied:

```bash
# Regenerate Prisma client to pick up the new model
npx prisma generate

# Rebuild the backend
npm run build

# Start the server
npm run dev
```

## Current Status

- ✅ Migration files created and made idempotent
- ✅ Schema updated in `prisma/schema.prisma`
- ✅ Backend code updated to use Payment model
- ⏳ Waiting for database connection to apply migration
