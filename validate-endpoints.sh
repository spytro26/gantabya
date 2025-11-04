#!/bin/bash

# Quick Endpoint Validation Script
# Tests that all endpoints are accessible and return expected status codes

BASE_URL="http://localhost:3000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   RedBus API Endpoint Validation      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"

# Test function
test_endpoint() {
    local method=$1
    local path=$2
    local expected=$3
    local description=$4
    local data=$5
    
    if [ -n "$data" ]; then
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X $method "$BASE_URL$path" \
            -H "Content-Type: application/json" \
            -d "$data")
    else
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X $method "$BASE_URL$path")
    fi
    
    if [ "$STATUS" = "$expected" ]; then
        echo -e "${GREEN}✓${NC} $method $path - $description (HTTP $STATUS)"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗${NC} $method $path - $description (Expected $expected, Got $STATUS)"
        FAILED=$((FAILED + 1))
    fi
}

echo -e "${YELLOW}Testing Public Endpoints...${NC}\n"

test_endpoint "GET" "/" "200" "Server health check"
test_endpoint "GET" "/user/" "402" "User router accessible"
test_endpoint "GET" "/admin/" "200" "Admin router accessible"

echo -e "\n${YELLOW}Testing Authentication Endpoints...${NC}\n"

# Test signup with valid data
SIGNUP_DATA='{"name":"Test User","email":"test'$(date +%s)'@test.com","password":"test123"}'
test_endpoint "POST" "/user/signup" "200" "User signup with valid data" "$SIGNUP_DATA"

# Test signin without data (should fail)
test_endpoint "POST" "/user/signin" "400" "Signin without credentials"

# Test signup with invalid email
INVALID_SIGNUP='{"name":"Test","email":"invalid","password":"test"}'
test_endpoint "POST" "/user/signup" "402" "Signup with invalid email format" "$INVALID_SIGNUP"

echo -e "\n${YELLOW}Testing Protected Endpoints (Should Fail Without Auth)...${NC}\n"

test_endpoint "POST" "/admin/bus/create" "401" "Admin bus create without auth"
test_endpoint "GET" "/admin/buses" "401" "Admin get buses without auth"
test_endpoint "POST" "/user/bookticket" "401" "User book ticket without auth"
test_endpoint "GET" "/user/mybookings" "401" "User get bookings without auth"

echo -e "\n${YELLOW}Testing Search Endpoint (Public)...${NC}\n"

SEARCH_DATA='{"startLocation":"Bangalore","endLocation":"Mumbai","date":"2025-11-10"}'
test_endpoint "POST" "/user/showbus" "200" "Bus search with valid data" "$SEARCH_DATA"

# Test search with missing data
INVALID_SEARCH='{"startLocation":"Bangalore"}'
test_endpoint "POST" "/user/showbus" "400" "Bus search with incomplete data" "$INVALID_SEARCH"

echo -e "\n${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}Test Results${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "Total Tests: $((PASSED + FAILED))"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✓ All endpoint validations passed!${NC}\n"
    echo -e "${YELLOW}Next Steps:${NC}"
    echo -e "1. Create an admin user and promote in database"
    echo -e "2. Follow MANUAL_TESTING_GUIDE.md for complete end-to-end testing"
    echo -e "3. Test admin-specific endpoints with authentication\n"
    exit 0
else
    echo -e "\n${RED}✗ Some validations failed${NC}\n"
    exit 1
fi
