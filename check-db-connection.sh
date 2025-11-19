#!/bin/bash

echo "🔍 Checking Neon Database Connectivity..."
echo ""

# Extract host from DATABASE_URL
DB_HOST=$(grep DATABASE_URL .env | cut -d'@' -f2 | cut -d'/' -f1 | cut -d':' -f1)
DB_PORT=5432

echo "📍 Database Host: $DB_HOST"
echo "🔌 Port: $DB_PORT"
echo ""

# Test basic connectivity
echo "Testing network connectivity..."
if timeout 5 nc -zv "$DB_HOST" "$DB_PORT" 2>&1; then
    echo "✅ Network connection successful!"
    echo ""
    echo "Attempting to apply Payment migration..."
    npx prisma db push --accept-data-loss
else
    echo "❌ Cannot reach database server"
    echo ""
    echo "Possible solutions:"
    echo "1. Check if your internet connection is working"
    echo "2. Verify Neon project is not suspended (check https://console.neon.tech)"
    echo "3. Check if IP is allowlisted (if Neon has IP restrictions enabled)"
    echo "4. Try using the direct connection string instead of pooled"
    echo ""
    echo "Alternative: Run the migration manually via Neon Console:"
    echo "   • Go to: https://console.neon.tech"
    echo "   • Navigate to SQL Editor"
    echo "   • Run: manual-payment-migration.sql"
fi
