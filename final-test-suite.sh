#!/bin/bash

# Final Comprehensive Test Suite
# Tests ALL user and admin endpoints with proper authentication flow

BASE_URL="http://localhost:3000"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TOTAL=0
PASSED=0
FAILED=0

# Test data
TEST_USER_EMAIL="finaltest@example.com"
TEST_USER_PASS="password123"
TEST_USER_NAME="Final Test User"

ADMIN_EMAIL="admin@test.com"
ADMIN_PASS="admin123"

USER_TOKEN=""
ADMIN_TOKEN=""

# Helper function
test_api() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    local expected_status="$5"
    local token="$6"
    
    TOTAL=$((TOTAL + 1))
    
    if [ -n "$token" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "Cookie: token=$token" \
            -d "$data" 2>&1)
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" 2>&1)
    fi
    
    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status" = "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} $name"
        PASSED=$((PASSED + 1))
        echo "$body" | jq -C '.' 2>/dev/null || echo "$body"
        return 0
    else
        echo -e "${RED}✗${NC} $name (Expected: $expected_status, Got: $status)"
        FAILED=$((FAILED + 1))
        echo "$body" | jq -C '.' 2>/dev/null || echo "$body"
        return 1
    fi
}

echo ""
echo "========================================="
echo "   FINAL COMPREHENSIVE TEST SUITE"
echo "========================================="
echo ""
echo "Testing Backend API: $BASE_URL"
echo ""

# ============================================
# PART 1: USER AUTHENTICATION & SETUP
# ============================================
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   PART 1: USER AUTHENTICATION${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Cleanup previous test user
echo "Cleaning up previous test users..."
cd /home/ankush/Documents/coding/red_bus/back
npm run test-helper verify-user "$TEST_USER_EMAIL" 2>/dev/null
sleep 1

# Clean up previous test user to avoid duplicate email error
cd /home/ankush/Documents/coding/red_bus/back
# Try to delete the test user if it exists
npx ts-node -e "
import { prisma } from './dist/index.js';
(async () => {
  try {
    await prisma.user.deleteMany({
      where: { email: '$TEST_USER_EMAIL' }
    });
    await prisma.\$disconnect();
  } catch (e) {
    await prisma.\$disconnect();
  }
})();
" 2>/dev/null

# 1. Signup
echo ""
echo "--- Test 1: User Signup ---"
test_api \
    "POST /user/signup" \
    "POST" \
    "/user/signup" \
    "{\"name\":\"$TEST_USER_NAME\",\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASS\"}" \
    "200" \
    ""

# 2. Verify user (directly via helper since we can't get email OTP in test)
echo ""
echo "--- Test 2: Email Verification (via helper) ---"
echo "In production, user would receive OTP via email"
cd /home/ankush/Documents/coding/red_bus/back
verify_result=$(npm run test-helper verify-user "$TEST_USER_EMAIL" 2>&1 | grep "verified successfully")
if [ -n "$verify_result" ]; then
    echo -e "${GREEN}✓${NC} User verified via test helper"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Failed to verify user"
    FAILED=$((FAILED + 1))
fi
TOTAL=$((TOTAL + 1))

# 3. Signin
echo ""
echo "--- Test 3: User Signin ---"
signin_response=$(curl -s -c /tmp/final-test-cookies.txt -X POST "$BASE_URL/user/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASS\"}")

echo "$signin_response" | jq -C '.'

USER_TOKEN=$(grep -oP 'token\s+\K[^\s]+' /tmp/final-test-cookies.txt 2>/dev/null || echo "")

if [ -n "$USER_TOKEN" ] && echo "$signin_response" | grep -q "succefully"; then
    echo -e "${GREEN}✓${NC} User authenticated (token obtained)"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Failed to authenticate user"
    FAILED=$((FAILED + 1))
    echo "Note: Cannot proceed with authenticated tests"
    exit 1
fi
TOTAL=$((TOTAL + 1))

# ============================================
# PART 2: USER PROFILE MANAGEMENT
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   PART 2: USER PROFILE${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# 4. Get Profile
test_api \
    "GET /user/profile" \
    "GET" \
    "/user/profile" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""

# 5. Update Profile
test_api \
    "PATCH /user/profile" \
    "PATCH" \
    "/user/profile" \
    "{\"name\":\"Updated Final Test\",\"phone\":\"9876543210\"}" \
    "200" \
    "$USER_TOKEN"

# ============================================
# PART 3: NOTIFICATIONS
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   PART 3: NOTIFICATIONS${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# 6. Get All Notifications
test_api \
    "GET /user/notifications" \
    "GET" \
    "/user/notifications" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""

# 7. Get Unread Count
test_api \
    "GET /user/notifications/unread-count" \
    "GET" \
    "/user/notifications/unread-count" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""

# 8. Mark All as Read
test_api \
    "PATCH /user/notifications/read-all" \
    "PATCH" \
    "/user/notifications/read-all" \
    "" \
    "200" \
    "$USER_TOKEN"

# ============================================
# PART 4: BUS SEARCH
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   PART 4: BUS SEARCH${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# 9. Basic Search
echo "--- Test 9: Basic Bus Search ---"
search_result=$(test_api \
    "POST /user/showbus (basic)" \
    "POST" \
    "/user/showbus" \
    "{\"startLocation\":\"New York\",\"endLocation\":\"Boston\",\"date\":\"2024-12-31\"}" \
    "200" \
    "")

echo ""

# 10. Enhanced Search with Filters
echo ""
echo "--- Test 10: Enhanced Search with Filters ---"
test_api \
    "POST /user/showbus (enhanced)" \
    "POST" \
    "/user/showbus" \
    "{\"startLocation\":\"New York\",\"endLocation\":\"Boston\",\"date\":\"2024-12-31\",\"busType\":\"AC\",\"hasWifi\":true,\"hasAC\":true,\"minPrice\":500,\"maxPrice\":2000,\"sortBy\":\"price\",\"sortOrder\":\"asc\"}" \
    "200" \
    ""

# ============================================
# PART 5: BOOKINGS
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   PART 5: BOOKINGS${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# 11. Get User Bookings
test_api \
    "GET /user/mybookings" \
    "GET" \
    "/user/mybookings" \
    "" \
    "200" \
    "$USER_TOKEN"

# Note: Booking test requires valid trip ID, which requires database setup
# Skipping for now unless trip data exists

# ============================================
# PART 6: ADMIN AUTHENTICATION
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}   PART 6: ADMIN AUTHENTICATION${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Ensure admin exists
echo "Ensuring admin user exists..."
cd /home/ankush/Documents/coding/red_bus/back
npm run test-helper create-admin "$ADMIN_EMAIL" "$ADMIN_PASS" "Admin User" 2>&1 | grep "created/updated"

# 12. Admin Signin
echo ""
echo "--- Test 12: Admin Signin ---"
admin_signin_response=$(curl -s -c /tmp/admin-test-cookies.txt -X POST "$BASE_URL/admin/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")

echo "$admin_signin_response" | jq -C '.'

ADMIN_TOKEN=$(grep -oP 'token\s+\K[^\s]+' /tmp/admin-test-cookies.txt 2>/dev/null || echo "")

if [ -n "$ADMIN_TOKEN" ] && echo "$admin_signin_response" | grep -q "successfully"; then
    echo -e "${GREEN}✓${NC} Admin authenticated (token obtained)"
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠${NC} Admin authentication failed - skipping admin tests"
    FAILED=$((FAILED + 1))
fi
TOTAL=$((TOTAL + 1))

# ============================================
# PART 7: ADMIN ENDPOINTS
# ============================================
if [ -n "$ADMIN_TOKEN" ]; then
    echo ""
    echo -e "${BLUE}=========================================${NC}"
    echo -e "${BLUE}   PART 7: ADMIN ENDPOINTS${NC}"
    echo -e "${BLUE}=========================================${NC}"
    echo ""
    
    # 13. Get All Offers
    echo "--- Test 13: Get All Offers ---"
    test_api \
        "GET /admin/offers" \
        "GET" \
        "/admin/offers" \
        "" \
        "200" \
        "$ADMIN_TOKEN"
    
    echo ""
    
    # 14. Create Offer
    echo "--- Test 14: Create Offer ---"
    test_api \
        "POST /admin/offers" \
        "POST" \
        "/admin/offers" \
        "{\"code\":\"FINALTEST50\",\"description\":\"Final Test 50% Off\",\"discountType\":\"PERCENTAGE\",\"discountValue\":50,\"maxDiscount\":500,\"minBookingAmount\":1000,\"validFrom\":\"2024-01-01T00:00:00.000Z\",\"validUntil\":\"2024-12-31T23:59:59.000Z\",\"usageLimit\":100,\"isActive\":true}" \
        "201" \
        "$ADMIN_TOKEN"
    
    echo ""
    
    # 15. Get Active Offers
    echo "--- Test 15: Filter Active Offers ---"
    test_api \
        "GET /admin/offers?active=true" \
        "GET" \
        "/admin/offers?active=true" \
        "" \
        "200" \
        "$ADMIN_TOKEN"
    
    echo ""
    
    # 16. Search Offers
    echo "--- Test 16: Search Offers ---"
    test_api \
        "GET /admin/offers?search=FINAL" \
        "GET" \
        "/admin/offers?search=FINAL" \
        "" \
        "200" \
        "$ADMIN_TOKEN"
fi

# ============================================
# FINAL SUMMARY
# ============================================
echo ""
echo "========================================="
echo "   FINAL TEST SUMMARY"
echo "========================================="
echo "Total Tests:  $TOTAL"
echo "Passed:       ${GREEN}$PASSED${NC}"
echo "Failed:       ${RED}$FAILED${NC}"
echo "Success Rate: $(awk "BEGIN {printf \"%.1f\", ($PASSED/$TOTAL)*100}")%"
echo "========================================="
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED!${NC}"
    echo ""
    exit 0
else
    echo -e "${YELLOW}⚠ $FAILED test(s) failed${NC}"
    echo ""
    exit 1
fi
