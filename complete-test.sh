#!/bin/bash

# Complete API Test Suite with proper authentication flow
BASE_URL="http://localhost:3000"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TOTAL=0
PASSED=0
FAILED=0

# Test user credentials
TEST_USER_NAME="Test User"
TEST_USER_EMAIL="testuser_$(date +%s)@test.com"
TEST_USER_PASS="password123"

# Admin credentials (if exists)
ADMIN_EMAIL="admin@test.com"
ADMIN_PASS="admin123"

# Store tokens and IDs
USER_TOKEN=""
ADMIN_TOKEN=""
BUS_ID=""
TRIP_ID=""
OFFER_ID=""
BOOKING_ID=""

echo "========================================="
echo "   COMPLETE API TEST SUITE"
echo "========================================="
echo ""
echo "Test User: $TEST_USER_EMAIL"
echo ""

# Helper function to test endpoint
test_endpoint() {
    local name="$1"
    local method="$2"
    local url="$3"
    local data="$4"
    local expected_status="$5"
    local cookie="$6"
    
    TOTAL=$((TOTAL + 1))
    
    if [ -n "$cookie" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
            -H "Content-Type: application/json" \
            -H "Cookie: token=$cookie" \
            -d "$data")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    status=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status" = "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} $name"
        PASSED=$((PASSED + 1))
        echo "$body"
        return 0
    else
        echo -e "${RED}✗${NC} $name (Expected: $expected_status, Got: $status)"
        FAILED=$((FAILED + 1))
        echo "  Response: $body"
        return 1
    fi
}

echo "========================================="
echo "   1. USER REGISTRATION & AUTH"
echo "========================================="
echo ""

# 1. Signup
echo "--- Test 1: User Signup ---"
signup_response=$(test_endpoint \
    "POST /user/signup" \
    "POST" \
    "$BASE_URL/user/signup" \
    "{\"name\":\"$TEST_USER_NAME\",\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASS\"}" \
    "200" \
    "")

echo ""

# Since we can't get OTP from email in test, we need to get it from database
# For testing, we'll create a bypass or use Prisma Studio
echo "--- Getting OTP from Database ---"
echo "NOTE: In production, OTP would be sent via email"
echo "For testing, we need to either:"
echo "  1. Check Prisma Studio (http://localhost:5555)"
echo "  2. Manually set user as verified in database"
echo "  3. Use database query to get OTP"
echo ""
echo "Getting OTP via database query..."

# Get OTP from database (requires psql or prisma)
OTP=$(cd /home/ankush/Documents/coding/red_bus/back && npx ts-node -e "
import { prisma } from './dist/index.js';
(async () => {
  const otp = await prisma.emailVerification.findFirst({
    where: { email: '$TEST_USER_EMAIL' },
    orderBy: { createdAt: 'desc' }
  });
  console.log(otp?.otp || '');
  await prisma.\$disconnect();
})();
" 2>/dev/null)

if [ -z "$OTP" ]; then
    echo -e "${YELLOW}⚠${NC} Could not retrieve OTP automatically"
    echo "Attempting to verify user directly in database..."
    
    # Directly verify user in database for testing
    cd /home/ankush/Documents/coding/red_bus/back && npx ts-node -e "
    import { prisma } from './dist/index.js';
    (async () => {
      await prisma.user.update({
        where: { email: '$TEST_USER_EMAIL' },
        data: { verified: true }
      });
      console.log('User verified successfully');
      await prisma.\$disconnect();
    })();
    " 2>/dev/null
    
    echo ""
else
    echo "OTP Retrieved: $OTP"
    echo ""
    
    # 2. Verify Email
    echo "--- Test 2: Email Verification ---"
    test_endpoint \
        "POST /user/verifyEmail" \
        "POST" \
        "$BASE_URL/user/verifyEmail" \
        "{\"email\":\"$TEST_USER_EMAIL\",\"otp\":\"$OTP\"}" \
        "200" \
        ""
    echo ""
fi

# 3. Signin
echo "--- Test 3: User Signin ---"
signin_response=$(curl -s -c /tmp/cookies.txt -X POST "$BASE_URL/user/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASS\"}")

echo "$signin_response"

# Extract token from cookies
USER_TOKEN=$(grep -oP 'token\s+\K[^\s]+' /tmp/cookies.txt 2>/dev/null || echo "")

if [ -n "$USER_TOKEN" ]; then
    echo -e "${GREEN}✓${NC} User authenticated successfully"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Failed to get authentication token"
    FAILED=$((FAILED + 1))
fi
TOTAL=$((TOTAL + 1))

echo ""
echo "========================================="
echo "   2. USER PROFILE MANAGEMENT"
echo "========================================="
echo ""

# 4. Get Profile
test_endpoint \
    "GET /user/profile" \
    "GET" \
    "$BASE_URL/user/profile" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""

# 5. Update Profile
test_endpoint \
    "PATCH /user/profile" \
    "PATCH" \
    "$BASE_URL/user/profile" \
    "{\"name\":\"Updated Test User\",\"phone\":\"1234567890\"}" \
    "200" \
    "$USER_TOKEN"

echo ""
echo "========================================="
echo "   3. NOTIFICATIONS"
echo "========================================="
echo ""

# 6. Get Notifications
test_endpoint \
    "GET /user/notifications" \
    "GET" \
    "$BASE_URL/user/notifications" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""

# 7. Get Unread Count
test_endpoint \
    "GET /user/notifications/unread-count" \
    "GET" \
    "$BASE_URL/user/notifications/unread-count" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""

# 8. Mark All as Read
test_endpoint \
    "PATCH /user/notifications/read-all" \
    "PATCH" \
    "$BASE_URL/user/notifications/read-all" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""
echo "========================================="
echo "   4. BUS SEARCH & BOOKING"
echo "========================================="
echo ""

# 9. Basic Search
echo "--- Test 9: Basic Bus Search ---"
search_response=$(test_endpoint \
    "POST /user/showbus" \
    "POST" \
    "$BASE_URL/user/showbus" \
    "{\"source\":\"New York\",\"destination\":\"Boston\",\"date\":\"2024-12-31\"}" \
    "200" \
    "")

# Extract bus/trip IDs if available
BUS_ID=$(echo "$search_response" | grep -oP '"busId":\s*"\K[^"]+' | head -1)
TRIP_ID=$(echo "$search_response" | grep -oP '"tripId":\s*"\K[^"]+' | head -1)

echo ""

# 10. Enhanced Search with Filters
test_endpoint \
    "POST /user/showbus (enhanced)" \
    "POST" \
    "$BASE_URL/user/showbus" \
    "{\"source\":\"New York\",\"destination\":\"Boston\",\"date\":\"2024-12-31\",\"busType\":\"AC\",\"hasWifi\":true,\"minPrice\":500,\"maxPrice\":2000,\"sortBy\":\"price\",\"sortOrder\":\"asc\"}" \
    "200" \
    ""

echo ""

# 11. Get User Bookings
test_endpoint \
    "GET /user/mybookings" \
    "GET" \
    "$BASE_URL/user/mybookings" \
    "" \
    "200" \
    "$USER_TOKEN"

echo ""

# If we have trip ID, test booking
if [ -n "$TRIP_ID" ]; then
    echo "--- Test 12: Book Ticket with Passenger Details ---"
    test_endpoint \
        "POST /user/bookticket" \
        "POST" \
        "$BASE_URL/user/bookticket" \
        "{\"tripId\":\"$TRIP_ID\",\"seatIds\":[\"A1\",\"A2\"],\"passengers\":[{\"seatId\":\"A1\",\"name\":\"John Doe\",\"age\":30,\"gender\":\"MALE\",\"phone\":\"1234567890\",\"email\":\"john@example.com\"},{\"seatId\":\"A2\",\"name\":\"Jane Doe\",\"age\":28,\"gender\":\"FEMALE\",\"phone\":\"0987654321\",\"email\":\"jane@example.com\"}]}" \
        "200" \
        "$USER_TOKEN"
    echo ""
else
    echo -e "${YELLOW}⚠${NC} Skipping booking test (no trip ID found)"
    echo ""
fi

echo "========================================="
echo "   5. ADMIN TESTS (if available)"
echo "========================================="
echo ""

# Try admin signin
admin_signin=$(curl -s -c /tmp/admin_cookies.txt -X POST "$BASE_URL/admin/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null)

ADMIN_TOKEN=$(grep -oP 'token\s+\K[^\s]+' /tmp/admin_cookies.txt 2>/dev/null || echo "")

if [ -n "$ADMIN_TOKEN" ]; then
    echo -e "${GREEN}✓${NC} Admin authenticated"
    
    # Test admin endpoints
    test_endpoint \
        "GET /admin/offers" \
        "GET" \
        "$BASE_URL/admin/offers" \
        "" \
        "200" \
        "$ADMIN_TOKEN"
    
    test_endpoint \
        "POST /admin/offers" \
        "POST" \
        "$BASE_URL/admin/offers" \
        "{\"offerCode\":\"TEST50\",\"description\":\"Test 50% Off\",\"discountType\":\"PERCENTAGE\",\"discountValue\":50,\"maxDiscount\":500,\"minBookingAmount\":1000,\"validFrom\":\"2024-01-01T00:00:00Z\",\"validUntil\":\"2024-12-31T23:59:59Z\",\"usageLimit\":100}" \
        "201" \
        "$ADMIN_TOKEN"
else
    echo -e "${YELLOW}⚠${NC} Admin not available - skipping admin tests"
    echo "To create admin: UPDATE \"User\" SET role='ADMIN' WHERE email='$ADMIN_EMAIL'"
fi

echo ""
echo "========================================="
echo "   TEST SUMMARY"
echo "========================================="
echo "Total Tests:  $TOTAL"
echo "Passed:       $PASSED"
echo "Failed:       $FAILED"
echo "Success Rate: $(awk "BEGIN {printf \"%.1f\", ($PASSED/$TOTAL)*100}")%"
echo "========================================="

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
