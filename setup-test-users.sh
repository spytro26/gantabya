#!/bin/bash

# Setup script to create test users and admin
# Run this before running test-new-endpoints.sh

BASE_URL="http://localhost:3000"

echo "========================================="
echo "   CREATING TEST USERS"
echo "========================================="
echo ""

# Create regular user
echo "Creating test user..."
USER_RESPONSE=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "user@test.com",
    "password": "user123"
  }')

USER_STATUS=$(echo "$USER_RESPONSE" | grep "STATUS:" | cut -d':' -f2)

if [ "$USER_STATUS" = "200" ] || [ "$USER_STATUS" = "201" ]; then
    echo "✓ User created successfully"
elif [ "$USER_STATUS" = "409" ]; then
    echo "ℹ User already exists"
else
    echo "✗ User creation failed (Status: $USER_STATUS)"
    echo "$USER_RESPONSE"
fi

echo ""

# Try to create admin user (using user signup endpoint with admin credentials)
echo "Creating admin user..."
ADMIN_RESPONSE=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin User",
    "email": "admin@test.com",
    "password": "admin123"
  }')

ADMIN_STATUS=$(echo "$ADMIN_RESPONSE" | grep "STATUS:" | cut -d':' -f2)

if [ "$ADMIN_STATUS" = "200" ] || [ "$ADMIN_STATUS" = "201" ]; then
    echo "✓ Admin user created successfully"
    echo "⚠ Note: You need to manually set role='ADMIN' in the database for this user"
    echo "  Run this SQL command:"
    echo "  UPDATE \"User\" SET role='ADMIN' WHERE email='admin@test.com';"
elif [ "$ADMIN_STATUS" = "409" ]; then
    echo "ℹ Admin user already exists"
else
    echo "✗ Admin user creation failed (Status: $ADMIN_STATUS)"
    echo "$ADMIN_RESPONSE"
fi

echo ""
echo "========================================="
echo "   MANUAL STEPS REQUIRED"
echo "========================================="
echo ""
echo "To complete setup, you need to:"
echo "1. Access your PostgreSQL database"
echo "2. Run this SQL command:"
echo ""
echo "   UPDATE \"User\" SET role='ADMIN' WHERE email='admin@test.com';"
echo ""
echo "3. Verify users with OTP (if required)"
echo "4. Then run: ./test-new-endpoints.sh"
echo ""
