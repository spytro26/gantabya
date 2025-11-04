#!/bin/bash

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Base URL
BASE_URL="http://localhost:3000"

# Test counter
PASSED=0
FAILED=0
TOTAL=0

# Function to print test results
print_test() {
    TOTAL=$((TOTAL + 1))
    if [ $1 -eq 0 ]; then
        PASSED=$((PASSED + 1))
        echo -e "${GREEN}✓ PASS${NC}: $2"
    else
        FAILED=$((FAILED + 1))
        echo -e "${RED}✗ FAIL${NC}: $2"
    fi
}

# Function to print section header
print_section() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

# Variables to store data between tests
ADMIN_EMAIL="admin_test_$(date +%s)@test.com"
USER_EMAIL="user_test_$(date +%s)@test.com"
ADMIN_TOKEN=""
USER_TOKEN=""
BUS_ID=""
TRIP_ID=""
STOP1_ID=""
STOP2_ID=""
SEAT_ID=""
BOOKING_GROUP_ID=""

echo -e "${YELLOW}Starting RedBus API Testing Suite${NC}"
echo -e "${YELLOW}Date: $(date)${NC}\n"

# ==================== TEST 1: Server Health Check ====================
print_section "TEST 1: Server Health Check"

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL/)
if [ "$RESPONSE" = "200" ]; then
    print_test 0 "Server is running on port 3000"
else
    print_test 1 "Server health check failed (HTTP $RESPONSE)"
    exit 1
fi

# ==================== TEST 2: User Signup ====================
print_section "TEST 2: User Signup"

RESPONSE=$(curl -s -X POST $BASE_URL/user/signup \
    -H "Content-Type: application/json" \
    -d "{
        \"name\": \"Test User\",
        \"email\": \"$USER_EMAIL\",
        \"password\": \"testpass123\"
    }")

if echo "$RESPONSE" | grep -q "signup sucessfull"; then
    print_test 0 "User signup successful"
else
    print_test 1 "User signup failed: $RESPONSE"
fi

# ==================== TEST 3: Admin Signup ====================
print_section "TEST 3: Admin User Creation"

# First create a regular user, then we'll manually promote to admin in database
ADMIN_RESPONSE=$(curl -s -X POST $BASE_URL/user/signup \
    -H "Content-Type: application/json" \
    -d "{
        \"name\": \"Test Admin\",
        \"email\": \"$ADMIN_EMAIL\",
        \"password\": \"adminpass123\"
    }")

if echo "$ADMIN_RESPONSE" | grep -q "signup"; then
    print_test 0 "Admin user created (needs role promotion in DB)"
    echo -e "${YELLOW}Note: Need to manually promote user to ADMIN role in database${NC}"
else
    print_test 1 "Admin user creation failed: $ADMIN_RESPONSE"
fi

# ==================== TEST 4: User Signin ====================
print_section "TEST 4: User Signin"

SIGNIN_RESPONSE=$(curl -s -X POST $BASE_URL/user/signin \
    -H "Content-Type: application/json" \
    -c /tmp/user_cookies.txt \
    -d "{
        \"email\": \"$USER_EMAIL\",
        \"password\": \"testpass123\"
    }")

if echo "$SIGNIN_RESPONSE" | grep -q "message"; then
    print_test 0 "User signin successful"
    # Extract token from cookies
    if [ -f /tmp/user_cookies.txt ]; then
        USER_TOKEN=$(grep -oP 'token\s+\K[^\s]+' /tmp/user_cookies.txt)
        echo "User token extracted (length: ${#USER_TOKEN})"
    fi
else
    print_test 1 "User signin failed: $SIGNIN_RESPONSE"
fi

# ==================== TEST 5: Admin Router Accessibility ====================
print_section "TEST 5: Admin Router Accessibility"

ADMIN_ROOT=$(curl -s $BASE_URL/admin/)
if echo "$ADMIN_ROOT" | grep -q "Welcome to the admin router"; then
    print_test 0 "Admin router is accessible"
else
    print_test 1 "Admin router not accessible: $ADMIN_ROOT"
fi

# ==================== TEST 6: User Router Accessibility ====================
print_section "TEST 6: User Router Accessibility"

USER_ROOT=$(curl -s $BASE_URL/user/)
if echo "$USER_ROOT" | grep -q "welcome to the user router"; then
    print_test 0 "User router is accessible"
else
    print_test 1 "User router not accessible: $USER_ROOT"
fi

# ==================== SUMMARY ====================
print_section "TEST SUMMARY"

echo -e "Total Tests: ${TOTAL}"
echo -e "${GREEN}Passed: ${PASSED}${NC}"
echo -e "${RED}Failed: ${FAILED}${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}\n"
    exit 0
else
    echo -e "\n${RED}✗ Some tests failed${NC}\n"
    exit 1
fi
