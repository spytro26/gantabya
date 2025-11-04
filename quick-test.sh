#!/bin/bash

# Quick API Test Script
# Tests critical endpoints to verify everything works

BASE_URL="http://localhost:3000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

USER_EMAIL="testuser@example.com"
USER_PASS="password123"
ADMIN_EMAIL="admin@test.com"
ADMIN_PASS="admin123"

PASSED=0
FAILED=0
TOTAL=0

test_endpoint() {
    local name="$1"
    local expected="$2"
    local response="$3"
    
    TOTAL=$((TOTAL + 1))
    local status=$(echo "$response" | tail -1 | grep -oP 'STATUS:\K\d+')
    
    if [ "$status" = "$expected" ]; then
        echo -e "${GREEN}✓${NC} $name"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗${NC} $name (Expected: $expected, Got: $status)"
        FAILED=$((FAILED + 1))
    fi
}

echo "========================================="
echo "   QUICK API TEST SUITE"
echo "========================================="
echo ""

# User Authentication
echo "=== User Auth ==="
RESP=$(curl -s -c user.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test User\",\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\"}")
test_endpoint "POST /user/signup" "200" "$RESP"

RESP=$(curl -s -c user.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\"}")
test_endpoint "POST /user/signin" "200" "$RESP"

# User Profile
echo ""
echo "=== User Profile ==="
RESP=$(curl -s -b user.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/profile")
test_endpoint "GET /user/profile" "200" "$RESP"

RESP=$(curl -s -b user.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/user/profile" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated User","phone":"1234567890"}')
test_endpoint "PATCH /user/profile" "200" "$RESP"

# Notifications
echo ""
echo "=== Notifications ==="
RESP=$(curl -s -b user.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/notifications")
test_endpoint "GET /user/notifications" "200" "$RESP"

RESP=$(curl -s -b user.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/notifications/unread-count")
test_endpoint "GET /user/notifications/unread-count" "200" "$RESP"

RESP=$(curl -s -b user.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/user/notifications/read-all")
test_endpoint "PATCH /user/notifications/read-all" "200" "$RESP"

# Bus Search
echo ""
echo "=== Bus Search ==="
RESP=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/showbus" \
  -H "Content-Type: application/json" \
  -d '{"startLocation":"Mumbai","endLocation":"Pune","date":"2024-11-10"}')
test_endpoint "POST /user/showbus (basic)" "200" "$RESP"

RESP=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/showbus" \
  -H "Content-Type: application/json" \
  -d '{"startLocation":"Mumbai","endLocation":"Pune","date":"2024-11-10","hasAC":true,"sortBy":"price","sortOrder":"asc"}')
test_endpoint "POST /user/showbus (enhanced)" "200" "$RESP"

# User Bookings
echo ""
echo "=== User Bookings ==="
RESP=$(curl -s -b user.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/mybookings")
test_endpoint "GET /user/mybookings" "200" "$RESP"

# Admin Tests (if admin exists)
echo ""
echo "=== Admin Tests ==="
RESP=$(curl -s -c admin.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_STATUS=$(echo "$RESP" | tail -1 | grep -oP 'STATUS:\K\d+')

if [ "$ADMIN_STATUS" = "200" ]; then
    test_endpoint "POST /admin/signin" "200" "$RESP"
    
    # Create Bus
    RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/bus" \
      -H "Content-Type: application/json" \
      -d "{\"busNumber\":\"TEST$(date +%s)\",\"name\":\"Test Bus\",\"type\":\"SEATER\",\"layoutType\":\"2x2\",\"totalSeats\":40,\"gridRows\":10,\"gridColumns\":4}")
    test_endpoint "POST /admin/bus" "200" "$RESP"
    BUS_ID=$(echo "$RESP" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)
    
    # Get buses
    RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/bus")
    test_endpoint "GET /admin/bus" "200" "$RESP"
    
    if [ -n "$BUS_ID" ]; then
        # Add amenities
        RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/bus/$BUS_ID/amenities" \
          -H "Content-Type: application/json" \
          -d '{"hasWifi":true,"hasAC":true,"hasCharging":true}')
        test_endpoint "POST /admin/bus/:id/amenities" "200" "$RESP"
        
        # Get amenities
        RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/bus/$BUS_ID/amenities")
        test_endpoint "GET /admin/bus/:id/amenities" "200" "$RESP"
    fi
    
    # Create Offer
    RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/offers" \
      -H "Content-Type: application/json" \
      -d "{\"code\":\"TEST$(date +%s)\",\"description\":\"Test Offer\",\"discountType\":\"PERCENTAGE\",\"discountValue\":20,\"validFrom\":\"2024-11-01T00:00:00Z\",\"validUntil\":\"2025-12-31T23:59:59Z\",\"minBookingAmount\":100}")
    test_endpoint "POST /admin/offers" "201" "$RESP"
    OFFER_ID=$(echo "$RESP" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)
    
    # Get offers
    RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers")
    test_endpoint "GET /admin/offers" "200" "$RESP"
    
    if [ -n "$OFFER_ID" ]; then
        # Get offer details
        RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers/$OFFER_ID")
        test_endpoint "GET /admin/offers/:id" "200" "$RESP"
        
        # Update offer
        RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/admin/offers/$OFFER_ID" \
          -H "Content-Type: application/json" \
          -d '{"description":"Updated"}')
        test_endpoint "PATCH /admin/offers/:id" "200" "$RESP"
        
        # Get stats
        RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers/$OFFER_ID/usage-stats")
        test_endpoint "GET /admin/offers/:id/usage-stats" "200" "$RESP"
        
        # Deactivate
        RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X DELETE "$BASE_URL/admin/offers/$OFFER_ID")
        test_endpoint "DELETE /admin/offers/:id" "200" "$RESP"
    fi
    
    if [ -n "$BUS_ID" ]; then
        # Remove amenities
        RESP=$(curl -s -b admin.txt -w "\nSTATUS:%{http_code}" -X DELETE "$BASE_URL/admin/bus/$BUS_ID/amenities")
        test_endpoint "DELETE /admin/bus/:id/amenities" "200" "$RESP"
    fi
else
    echo -e "${YELLOW}⚠ Admin not available - skipping admin tests${NC}"
fi

# Cleanup
rm -f user.txt admin.txt

# Summary
echo ""
echo "========================================="
echo "   TEST SUMMARY"
echo "========================================="
echo "Total:  $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Rate:   $(awk "BEGIN {printf \"%.1f\", ($PASSED/$TOTAL)*100}")%"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED!${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
