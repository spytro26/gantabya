#!/bin/bash

# Simplified Final Test Suite
BASE_URL="http://localhost:3000"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Counters
TOTAL=0
PASSED=0
FAILED=0

# Generate unique email with timestamp
TEST_EMAIL="test$(date +%s)@test.com"
TEST_PASS="password123"

echo ""
echo "========================================="
echo "   SIMPLIFIED COMPREHENSIVE TEST"
echo "========================================="
echo ""
echo "Test user: $TEST_EMAIL"
echo ""

# Test function
test_api() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    local expected="$5"
    local token="$6"
    
    TOTAL=$((TOTAL + 1))
    
    if [ -n "$token" ]; then
        resp=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "Cookie: token=$token" \
            -d "$data")
    else
        resp=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    status=$(echo "$resp" | tail -n1)
    body=$(echo "$resp" | sed '$d')
    
    if [ "$status" = "$expected" ]; then
        echo -e "${GREEN}✓${NC} $name ($(($PASSED + 1))/$TOTAL)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗${NC} $name (Expected: $expected, Got: $status)"
        echo "  $body" | head -c 200
        echo ""
        FAILED=$((FAILED + 1))
    fi
}

# 1. Signup
test_api "Signup" "POST" "/user/signup" \
    "{\"name\":\"Test User\",\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" \
    "200" ""

# 2. Verify user
cd /home/ankush/Documents/coding/red_bus/back
npm run test-helper verify-user "$TEST_EMAIL" 2>&1 | grep -q "verified successfully"
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Email verified ($((PASSED + 1))/$((TOTAL + 1)))"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Email verification failed"
    FAILED=$((FAILED + 1))
fi
TOTAL=$((TOTAL + 1))

# 3. Signin
signin_resp=$(curl -s -c /tmp/test.txt -X POST "$BASE_URL/user/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")

TOKEN=$(grep -oP 'token\s+\K[^\s]+' /tmp/test.txt 2>/dev/null || echo "")
if [ -n "$TOKEN" ] && echo "$signin_resp" | grep -q "succefully"; then
    echo -e "${GREEN}✓${NC} Signin ($((PASSED + 1))/$((TOTAL + 1)))"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Signin failed"
    FAILED=$((FAILED + 1))
fi
TOTAL=$((TOTAL + 1))

# 4. Get Profile
test_api "Get Profile" "GET" "/user/profile" "" "200" "$TOKEN"

# 5. Update Profile
test_api "Update Profile" "PATCH" "/user/profile" \
    "{\"name\":\"Updated\",\"phone\":\"1234567890\"}" \
    "200" "$TOKEN"

# 6. Get Notifications
test_api "Get Notifications" "GET" "/user/notifications" "" "200" "$TOKEN"

# 7. Unread Count
test_api "Unread Count" "GET" "/user/notifications/unread-count" "" "200" "$TOKEN"

# 8. Mark All Read
test_api "Mark All Read" "PATCH" "/user/notifications/read-all" "" "200" "$TOKEN"

# 9. Basic Search
test_api "Basic Search" "POST" "/user/showbus" \
    "{\"startLocation\":\"New York\",\"endLocation\":\"Boston\",\"date\":\"2024-12-31\"}" \
    "200" ""

# 10. Enhanced Search
test_api "Enhanced Search" "POST" "/user/showbus" \
    "{\"startLocation\":\"New York\",\"endLocation\":\"Boston\",\"date\":\"2024-12-31\",\"busType\":\"SEATER\",\"hasWifi\":true,\"sortBy\":\"price\",\"sortOrder\":\"asc\"}" \
    "200" ""

# 11. My Bookings
test_api "My Bookings" "GET" "/user/mybookings" "" "200" "$TOKEN"

# Admin Tests
echo ""
echo "--- Admin Tests ---"

# Ensure admin exists
npm run test-helper create-admin admin@test.com admin123 "Admin" 2>&1 | grep -q "created/updated"

# 12. Admin Signin
admin_resp=$(curl -s -c /tmp/admin.txt -X POST "$BASE_URL/admin/signin" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@test.com","password":"admin123"}')

ADMIN_TOKEN=$(grep -oP 'token\s+\K[^\s]+' /tmp/admin.txt 2>/dev/null || echo "")
if [ -n "$ADMIN_TOKEN" ] && echo "$admin_resp" | grep -q "successfully"; then
    echo -e "${GREEN}✓${NC} Admin Signin ($((PASSED + 1))/$((TOTAL + 1)))"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Admin Signin failed"
    FAILED=$((FAILED + 1))
fi
TOTAL=$((TOTAL + 1))

if [ -n "$ADMIN_TOKEN" ]; then
    # 13. Get Offers
    test_api "Get Offers" "GET" "/admin/offers" "" "200" "$ADMIN_TOKEN"
    
    # 14. Create Offer
    test_api "Create Offer" "POST" "/admin/offers" \
        "{\"code\":\"TEST$(date +%s)\",\"description\":\"Test Offer\",\"discountType\":\"PERCENTAGE\",\"discountValue\":50,\"maxDiscount\":500,\"minBookingAmount\":1000,\"validFrom\":\"2024-01-01T00:00:00Z\",\"validUntil\":\"2024-12-31T23:59:59Z\",\"usageLimit\":100}" \
        "201" "$ADMIN_TOKEN"
    
    # 15. Filter Active Offers
    test_api "Filter Active" "GET" "/admin/offers?active=true" "" "200" "$ADMIN_TOKEN"
    
    # 16. Search Offers
    test_api "Search Offers" "GET" "/admin/offers?search=TEST" "" "200" "$ADMIN_TOKEN"
fi

# Summary
echo ""
echo "========================================="
echo "   RESULTS"
echo "========================================="
echo "Total:  $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo "Rate:   $(awk "BEGIN {printf \"%.1f\", ($PASSED/$TOTAL)*100}")%"
echo "========================================="

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠ $FAILED tests failed${NC}"
    exit 1
fi
