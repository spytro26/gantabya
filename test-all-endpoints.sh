#!/bin/bash

# Comprehensive API Testing Script
# Tests ALL user and admin endpoints

BASE_URL="http://localhost:3000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TOTAL=0
PASSED=0
FAILED=0

print_header() {
    echo ""
    echo -e "${BLUE}=========================================${NC}"
    echo -e "${BLUE}   $1${NC}"
    echo -e "${BLUE}=========================================${NC}"
    echo ""
}

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

extract_id() {
    echo "$1" | grep -oP '"id"\s*:\s*"\K[^"]+' | head -1
}

print_header "STARTING COMPREHENSIVE API TESTS"

# ==================== USER AUTHENTICATION ====================
print_header "USER AUTHENTICATION TESTS"

# Test 1: User Signup
echo "Creating new test user..."
RESPONSE=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "testuser'$(date +%s)'@test.com",
    "password": "password123"
  }')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "POST /user/signup" "$STATUS" "200"

# Save user email for later
TEST_USER_EMAIL=$(echo "$RESPONSE" | grep -oP '"email"\s*:\s*"\K[^"]+' | head -1)
echo "  Test user email: $TEST_USER_EMAIL"

# Test 2: User Signin
RESPONSE=$(curl -s -c user_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$TEST_USER_EMAIL\", \"password\": \"password123\"}")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "POST /user/signin" "$STATUS" "200"

# Test 3: Invalid signin
RESPONSE=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/signin" \
  -H "Content-Type: application/json" \
  -d '{"email": "wrong@test.com", "password": "wrongpass"}')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "POST /user/signin (invalid credentials)" "$STATUS" "401"

# ==================== ADMIN AUTHENTICATION ====================
print_header "ADMIN AUTHENTICATION TESTS"

# Test 4: Admin Signin (assuming admin@test.com exists with ADMIN role)
RESPONSE=$(curl -s -c admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/signin" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@test.com", "password": "admin123"}')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
if [ "$STATUS" = "200" ]; then
    print_result "POST /admin/signin" "$STATUS" "200"
    ADMIN_AVAILABLE=true
else
    echo -e "${YELLOW}⚠${NC} Admin signin failed - skipping admin tests"
    ADMIN_AVAILABLE=false
fi

# ==================== USER PROFILE ====================
print_header "USER PROFILE TESTS"

# Test 5: Get Profile
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/profile")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/profile" "$STATUS" "200"

# Test 6: Update Profile
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/user/profile" \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Test User", "phone": "9876543210"}')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "PATCH /user/profile" "$STATUS" "200"

# ==================== NOTIFICATIONS ====================
print_header "NOTIFICATION TESTS"

# Test 7: Get notifications
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/notifications")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/notifications" "$STATUS" "200"

# Test 8: Get unread count
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/notifications/unread-count")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/notifications/unread-count" "$STATUS" "200"

# Test 9: Mark all as read
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/user/notifications/read-all")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "PATCH /user/notifications/read-all" "$STATUS" "200"

# ==================== ADMIN BUS MANAGEMENT ====================
if [ "$ADMIN_AVAILABLE" = true ]; then
    print_header "ADMIN BUS MANAGEMENT TESTS"
    
    # Test 10: Create Bus
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/bus" \
      -H "Content-Type: application/json" \
      -d '{
        "busNumber": "TEST'$(date +%s)'",
        "name": "Test Bus",
        "type": "SEATER",
        "layoutType": "2x2",
        "totalSeats": 40,
        "gridRows": 10,
        "gridColumns": 4
      }')
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /admin/bus" "$STATUS" "200"
    
    BUS_ID=$(extract_id "$RESPONSE")
    echo "  Created Bus ID: $BUS_ID"
    
    # Test 11: Get all buses
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/bus")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "GET /admin/bus" "$STATUS" "200"
    
    if [ -n "$BUS_ID" ]; then
        # Test 12: Get bus details
        RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/bus/$BUS_ID")
        STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
        print_result "GET /admin/bus/:busId" "$STATUS" "200"
        
        # Test 13: Update bus
        RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/admin/bus/$BUS_ID" \
          -H "Content-Type: application/json" \
          -d '{"name": "Updated Test Bus"}')
        STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
        print_result "PATCH /admin/bus/:busId" "$STATUS" "200"
        
        # ==================== ADMIN AMENITIES ====================
        print_header "ADMIN AMENITIES TESTS"
        
        # Test 14: Add amenities
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
        print_result "POST /admin/bus/:busId/amenities" "$STATUS" "200"
        
        # Test 15: Get amenities
        RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/bus/$BUS_ID/amenities")
        STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
        print_result "GET /admin/bus/:busId/amenities" "$STATUS" "200"
        
        # Test 16: Update amenities
        RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/bus/$BUS_ID/amenities" \
          -H "Content-Type: application/json" \
          -d '{"hasWifi": false}')
        STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
        print_result "POST /admin/bus/:busId/amenities (update)" "$STATUS" "200"
        
        # ==================== ADMIN OFFERS ====================
        print_header "ADMIN OFFERS TESTS"
        
        # Test 17: Create offer
        RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/admin/offers" \
          -H "Content-Type: application/json" \
          -d '{
            "code": "TEST'$(date +%s)'",
            "description": "Test offer",
            "discountType": "PERCENTAGE",
            "discountValue": 20,
            "maxDiscount": 200,
            "validFrom": "2024-11-01T00:00:00Z",
            "validUntil": "2025-12-31T23:59:59Z",
            "minBookingAmount": 100,
            "usageLimit": 100
          }')
        STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
        print_result "POST /admin/offers" "$STATUS" "201"
        
        OFFER_ID=$(extract_id "$RESPONSE")
        OFFER_CODE=$(echo "$RESPONSE" | grep -oP '"code"\s*:\s*"\K[^"]+' | head -1)
        echo "  Created Offer ID: $OFFER_ID"
        echo "  Offer Code: $OFFER_CODE"
        
        # Test 18: Get all offers
        RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers")
        STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
        print_result "GET /admin/offers" "$STATUS" "200"
        
        if [ -n "$OFFER_ID" ]; then
            # Test 19: Get offer details
            RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers/$OFFER_ID")
            STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
            print_result "GET /admin/offers/:offerId" "$STATUS" "200"
            
            # Test 20: Update offer
            RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X PATCH "$BASE_URL/admin/offers/$OFFER_ID" \
              -H "Content-Type: application/json" \
              -d '{"description": "Updated test offer"}')
            STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
            print_result "PATCH /admin/offers/:offerId" "$STATUS" "200"
            
            # Test 21: Get usage stats
            RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/admin/offers/$OFFER_ID/usage-stats")
            STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
            print_result "GET /admin/offers/:offerId/usage-stats" "$STATUS" "200"
        fi
    fi
fi

# ==================== BUS SEARCH ====================
print_header "BUS SEARCH TESTS"

# Test 22: Basic search
RESPONSE=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/showbus" \
  -H "Content-Type: application/json" \
  -d '{
    "startLocation": "Mumbai",
    "endLocation": "Pune",
    "date": "2024-11-10"
  }')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "POST /user/showbus (basic search)" "$STATUS" "200"

# Test 23: Enhanced search with filters
RESPONSE=$(curl -s -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/showbus" \
  -H "Content-Type: application/json" \
  -d '{
    "startLocation": "Mumbai",
    "endLocation": "Pune",
    "date": "2024-11-10",
    "busType": "SEATER",
    "hasAC": true,
    "minPrice": 100,
    "maxPrice": 1000,
    "sortBy": "price",
    "sortOrder": "asc"
  }')
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "POST /user/showbus (enhanced search)" "$STATUS" "200"

# ==================== COUPON APPLICATION ====================
print_header "COUPON APPLICATION TESTS"

# Extract a trip ID for coupon testing (if available)
TRIP_ID=$(echo "$RESPONSE" | grep -oP '"tripId"\s*:\s*"\K[^"]+' | head -1)

if [ -n "$TRIP_ID" ] && [ -n "$OFFER_CODE" ]; then
    # Test 24: Apply valid coupon
    RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/booking/apply-coupon" \
      -H "Content-Type: application/json" \
      -d "{
        \"code\": \"$OFFER_CODE\",
        \"tripId\": \"$TRIP_ID\",
        \"totalAmount\": 500
      }")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /user/booking/apply-coupon (valid)" "$STATUS" "200"
    
    # Test 25: Apply invalid coupon
    RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X POST "$BASE_URL/user/booking/apply-coupon" \
      -H "Content-Type: application/json" \
      -d "{
        \"code\": \"INVALID123\",
        \"tripId\": \"$TRIP_ID\",
        \"totalAmount\": 500
      }")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "POST /user/booking/apply-coupon (invalid)" "$STATUS" "404"
else
    echo -e "${YELLOW}⚠${NC} Skipping coupon tests (no trip or offer available)"
fi

# ==================== USER BOOKINGS ====================
print_header "USER BOOKING TESTS"

# Test 26: Get my bookings
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/mybookings")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/mybookings" "$STATUS" "200"

# Test 27: Get upcoming bookings
RESPONSE=$(curl -s -b user_cookies.txt -w "\nSTATUS:%{http_code}" -X GET "$BASE_URL/user/mybookings?upcoming=true")
STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
print_result "GET /user/mybookings?upcoming=true" "$STATUS" "200"

# ==================== CLEANUP ====================
print_header "CLEANUP"

# Deactivate test offer
if [ -n "$OFFER_ID" ] && [ "$ADMIN_AVAILABLE" = true ]; then
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X DELETE "$BASE_URL/admin/offers/$OFFER_ID")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "DELETE /admin/offers/:offerId" "$STATUS" "200"
fi

# Remove amenities
if [ -n "$BUS_ID" ] && [ "$ADMIN_AVAILABLE" = true ]; then
    RESPONSE=$(curl -s -b admin_cookies.txt -w "\nSTATUS:%{http_code}" -X DELETE "$BASE_URL/admin/bus/$BUS_ID/amenities")
    STATUS=$(echo "$RESPONSE" | grep "STATUS:" | cut -d':' -f2)
    print_result "DELETE /admin/bus/:busId/amenities" "$STATUS" "200"
fi

# Cleanup files
rm -f user_cookies.txt admin_cookies.txt

# ==================== SUMMARY ====================
print_header "TEST SUMMARY"

echo -e "Total Tests:  $TOTAL"
echo -e "${GREEN}Passed:       $PASSED${NC}"
echo -e "${RED}Failed:       $FAILED${NC}"
SUCCESS_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED/$TOTAL)*100}")
echo -e "Success Rate: $SUCCESS_RATE%"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ ALL TESTS PASSED!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
