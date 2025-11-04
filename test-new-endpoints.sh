#!/bin/bash

# Test script for all new endpoints
# Run this after starting the backend server on port 3000

BASE_URL="http://localhost:3000"
ADMIN_EMAIL="admin@test.com"
ADMIN_PASSWORD="admin123"
USER_EMAIL="user@test.com"
USER_PASSWORD="user123"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL=0
PASSED=0
FAILED=0

# Function to print test result
print_result() {
    local test_name="$1"
    local status_code="$2"
    local expected="$3"
    
    TOTAL=$((TOTAL + 1))
    
    if [ "$status_code" = "$expected" ]; then
        echo -e "${GREEN}✓${NC} $test_name (Status: $status_code)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗${NC} $test_name (Expected: $expected, Got: $status_code)"
        FAILED=$((FAILED + 1))
    fi
}

# Function to extract token from response
extract_token() {
    local response="$1"
    echo "$response" | grep -oP '(?<=token=)[^;]*'
}

echo "========================================="
echo "   NEW FEATURES ENDPOINT TESTING"
echo "========================================="
echo ""

# ==================== SETUP ====================
echo "Setting up test environment..."

# Signin as admin
ADMIN_SIGNIN_RESPONSE=$(curl -s -c admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASSWORD\"}")

ADMIN_STATUS=$(echo "$ADMIN_SIGNIN_RESPONSE" | grep "STATUS:" | cut -d':' -f2)

if [ "$ADMIN_STATUS" = "200" ]; then
    echo -e "${GREEN}✓${NC} Admin signin successful"
else
    echo -e "${YELLOW}⚠${NC} Admin signin returned $ADMIN_STATUS (may need to create admin user first)"
fi

# Signin as user
USER_SIGNIN_RESPONSE=$(curl -s -c user_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$USER_EMAIL\", \"password\": \"$USER_PASSWORD\"}")

USER_STATUS=$(echo "$USER_SIGNIN_RESPONSE" | grep "STATUS:" | cut -d':' -f2)

if [ "$USER_STATUS" = "200" ]; then
    echo -e "${GREEN}✓${NC} User signin successful"
else
    echo -e "${YELLOW}⚠${NC} User signin returned $USER_STATUS (may need to create user first)"
fi

echo ""
echo "========================================="
echo "   TESTING ADMIN ENDPOINTS"
echo "========================================="
echo ""

# ==================== ADMIN - OFFERS ====================
echo "--- Testing Offer Management ---"

# Test 1: Create offer
RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/offers" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "TEST50",
    "description": "Test 50% off",
    "discountType": "PERCENTAGE",
    "discountValue": 50,
    "maxDiscount": 200,
    "validFrom": "2024-11-01T00:00:00Z",
    "validUntil": "2024-12-31T23:59:59Z",
    "minBookingAmount": 100,
    "usageLimit": 100,
    "applicableBuses": []
  }')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "POST /admin/offers (Create offer)" "$STATUS" "201"

# Extract offer ID for later tests
OFFER_ID=$(echo "$RESPONSE" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)
echo "  Offer ID: $OFFER_ID"

# Test 2: Get all offers
RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /admin/offers (List all offers)" "$STATUS" "200"

# Test 3: Get active offers only
RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers?active=true")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /admin/offers?active=true (Filter active)" "$STATUS" "200"

# Test 4: Search offers
RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers?search=TEST")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /admin/offers?search=TEST (Search offers)" "$STATUS" "200"

# Test 5: Get specific offer
if [ -n "$OFFER_ID" ]; then
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers/$OFFER_ID")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "GET /admin/offers/:offerId (Get offer details)" "$STATUS" "200"
fi

# Test 6: Update offer
if [ -n "$OFFER_ID" ]; then
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/admin/offers/$OFFER_ID" \
      -H "Content-Type: application/json" \
      -d '{"description": "Updated test offer"}')
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "PATCH /admin/offers/:offerId (Update offer)" "$STATUS" "200"
fi

# Test 7: Get offer usage stats
if [ -n "$OFFER_ID" ]; then
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers/$OFFER_ID/usage-stats")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "GET /admin/offers/:offerId/usage-stats (Get statistics)" "$STATUS" "200"
fi

echo ""

# ==================== ADMIN - AMENITIES ====================
echo "--- Testing Bus Amenities ---"

# First, get a bus ID
BUS_RESPONSE=$(curl -s -b admin_cookies.txt -X GET "$BASE_URL/admin/bus?limit=1")
BUS_ID=$(echo "$BUS_RESPONSE" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)

if [ -n "$BUS_ID" ]; then
    echo "  Using Bus ID: $BUS_ID"
    
    # Test 8: Add amenities
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/bus/$BUS_ID/amenities" \
      -H "Content-Type: application/json" \
      -d '{
        "hasWifi": true,
        "hasAC": true,
        "hasCharging": true,
        "hasRestroom": true,
        "hasBlanket": false,
        "hasWaterBottle": true,
        "hasSnacks": false,
        "hasTV": true
      }')
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /admin/bus/:busId/amenities (Add amenities)" "$STATUS" "200"
    
    # Test 9: Get amenities
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/bus/$BUS_ID/amenities")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "GET /admin/bus/:busId/amenities (Get amenities)" "$STATUS" "200"
    
    # Test 10: Update amenities (partial)
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/bus/$BUS_ID/amenities" \
      -H "Content-Type: application/json" \
      -d '{"hasWifi": false}')
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /admin/bus/:busId/amenities (Update amenities)" "$STATUS" "200"
else
    echo -e "${YELLOW}⚠${NC} No bus found, skipping amenities tests"
fi

echo ""
echo "========================================="
echo "   TESTING USER ENDPOINTS"
echo "========================================="
echo ""

# ==================== USER - PROFILE ====================
echo "--- Testing User Profile ---"

# Test 11: Get profile
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/profile")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/profile (Get user profile)" "$STATUS" "200"

# Test 12: Update profile
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/user/profile" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test User Updated", "phone": "9876543210"}')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "PATCH /user/profile (Update profile)" "$STATUS" "200"

echo ""

# ==================== USER - NOTIFICATIONS ====================
echo "--- Testing Notifications ---"

# Test 13: Get all notifications
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/notifications")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/notifications (Get all notifications)" "$STATUS" "200"

# Test 14: Get unread notifications only
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/notifications?unreadOnly=true")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/notifications?unreadOnly=true (Filter unread)" "$STATUS" "200"

# Test 15: Get unread count
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/notifications/unread-count")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/notifications/unread-count (Get unread count)" "$STATUS" "200"

# Test 16: Mark all as read
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/user/notifications/read-all")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "PATCH /user/notifications/read-all (Mark all as read)" "$STATUS" "200"

echo ""

# ==================== USER - COUPON ====================
echo "--- Testing Coupon Application ---"

# Get a trip ID for coupon testing
TRIP_RESPONSE=$(curl -s -b user_cookies.txt -X POST "$BASE_URL/user/showbus" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Mumbai",
    "to": "Pune",
    "date": "2024-11-10"
  }')
TRIP_ID=$(echo "$TRIP_RESPONSE" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1)

if [ -n "$TRIP_ID" ]; then
    echo "  Using Trip ID: $TRIP_ID"
    
    # Test 17: Apply valid coupon
    RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/booking/apply-coupon" \
      -H "Content-Type: application/json" \
      -d "{
        \"code\": \"TEST50\",
        \"tripId\": \"$TRIP_ID\",
        \"totalAmount\": 1000
      }")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /user/booking/apply-coupon (Apply valid coupon)" "$STATUS" "200"
    
    # Test 18: Apply invalid coupon
    RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/booking/apply-coupon" \
      -H "Content-Type: application/json" \
      -d "{
        \"code\": \"INVALID123\",
        \"tripId\": \"$TRIP_ID\",
        \"totalAmount\": 1000
      }")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /user/booking/apply-coupon (Apply invalid coupon)" "$STATUS" "404"
    
    # Test 19: Apply coupon with insufficient amount
    RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/booking/apply-coupon" \
      -H "Content-Type: application/json" \
      -d "{
        \"code\": \"TEST50\",
        \"tripId\": \"$TRIP_ID\",
        \"totalAmount\": 50
      }")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /user/booking/apply-coupon (Below minimum amount)" "$STATUS" "400"
else
    echo -e "${YELLOW}⚠${NC} No trip found, skipping coupon tests"
fi

echo ""

# ==================== CLEANUP ====================
echo "--- Cleanup ---"

# Deactivate test offer
if [ -n "$OFFER_ID" ]; then
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X DELETE "$BASE_URL/admin/offers/$OFFER_ID")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "DELETE /admin/offers/:offerId (Deactivate offer)" "$STATUS" "200"
fi

# Remove amenities
if [ -n "$BUS_ID" ]; then
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X DELETE "$BASE_URL/admin/bus/$BUS_ID/amenities")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "DELETE /admin/bus/:busId/amenities (Remove amenities)" "$STATUS" "200"
fi

# Cleanup cookie files
rm -f admin_cookies.txt user_cookies.txt

echo ""
echo "========================================="
echo "   TEST SUMMARY"
echo "========================================="
echo -e "Total Tests:  $TOTAL"
echo -e "${GREEN}Passed:       $PASSED${NC}"
echo -e "${RED}Failed:       $FAILED${NC}"
echo -e "Success Rate: $(awk "BEGIN {printf \"%.1f\", ($PASSED/$TOTAL)*100}")%"
echo "========================================="

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
