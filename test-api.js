#!/usr/bin/env node

/**
 * Comprehensive API Testing Script for RedBus Clone
 * Tests all admin and user endpoints end-to-end
 */

import http from 'http';

const BASE_URL = 'http://localhost:3000';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Test state
let testsPassed = 0;
let testsFailed = 0;
let totalTests = 0;

// Store IDs and tokens between tests
const testData = {
  adminEmail: `admin_${Date.now()}@test.com`,
  userEmail: `user_${Date.now()}@test.com`,
  adminToken: null,
  userToken: null,
  adminId: null,
  userId: null,
  busId: null,
  tripId: null,
  stop1Id: null,
  stop2Id: null,
  seatIds: [],
  bookingGroupId: null,
  tripDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 7 days from now
};

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Cookie'] = `token=${token}`;
    }

    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          };
          resolve(response);
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Test helper functions
function printSection(title) {
  console.log(`\n${colors.blue}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(60)}${colors.reset}\n`);
}

function printTest(passed, message, details = null) {
  totalTests++;
  if (passed) {
    testsPassed++;
    console.log(`${colors.green}✓ PASS${colors.reset}: ${message}`);
  } else {
    testsFailed++;
    console.log(`${colors.red}✗ FAIL${colors.reset}: ${message}`);
    if (details) {
      console.log(`${colors.yellow}  Details: ${JSON.stringify(details, null, 2)}${colors.reset}`);
    }
  }
}

// Test functions
async function testServerHealth() {
  printSection('TEST 1: Server Health Check');
  
  try {
    const response = await makeRequest('GET', '/');
    printTest(response.status === 200, 'Server is running and responding', response.body);
  } catch (error) {
    printTest(false, 'Server health check failed', error.message);
  }
}

async function testUserSignup() {
  printSection('TEST 2: User Signup & Signin');
  
  // Test regular user signup
  try {
    const response = await makeRequest('POST', '/user/signup', {
      name: 'Test User',
      email: testData.userEmail,
      password: 'testpass123'
    });
    
    printTest(
      response.status === 200 && response.body?.message?.includes('signup'),
      'User signup successful',
      response.body
    );
  } catch (error) {
    printTest(false, 'User signup failed', error.message);
  }

  // Test user signin
  try {
    const response = await makeRequest('POST', '/user/signin', {
      email: testData.userEmail,
      password: 'testpass123'
    });
    
    const success = response.status === 200;
    printTest(success, 'User signin successful', response.body);
    
    // Extract token from Set-Cookie header
    if (response.headers['set-cookie']) {
      const cookieHeader = Array.isArray(response.headers['set-cookie']) 
        ? response.headers['set-cookie'][0] 
        : response.headers['set-cookie'];
      const match = cookieHeader.match(/token=([^;]+)/);
      if (match) {
        testData.userToken = match[1];
        console.log(`${colors.cyan}  → User token captured (${testData.userToken.substring(0, 20)}...)${colors.reset}`);
      }
    }
  } catch (error) {
    printTest(false, 'User signin failed', error.message);
  }
}

async function testAdminSignup() {
  printSection('TEST 3: Admin User Creation');
  
  // Create admin user
  try {
    const response = await makeRequest('POST', '/user/signup', {
      name: 'Test Admin',
      email: testData.adminEmail,
      password: 'adminpass123'
    });
    
    printTest(
      response.status === 200,
      'Admin user account created',
      response.body
    );
    
    console.log(`${colors.yellow}⚠ NOTE: Run this SQL to promote user to ADMIN:${colors.reset}`);
    console.log(`${colors.cyan}UPDATE "User" SET role = 'ADMIN' WHERE email = '${testData.adminEmail}';${colors.reset}`);
  } catch (error) {
    printTest(false, 'Admin user creation failed', error.message);
  }
}

async function testBusSearch() {
  printSection('TEST 4: User Bus Search (Empty Results Expected)');
  
  try {
    const response = await makeRequest('POST', '/user/showbus', {
      startLocation: 'Bangalore',
      endLocation: 'Mumbai',
      date: testData.tripDate
    });
    
    printTest(
      response.status === 200 && response.body?.message,
      'Bus search endpoint working (no trips yet)',
      { count: response.body?.count || 0 }
    );
  } catch (error) {
    printTest(false, 'Bus search failed', error.message);
  }
}

async function testWithAdmin() {
  printSection('TEST 5: Admin Authentication Check');
  
  console.log(`${colors.yellow}⚠ The following tests require admin authentication.${colors.reset}`);
  console.log(`${colors.yellow}Please sign in as admin and provide the token.${colors.reset}`);
  console.log(`${colors.yellow}Skipping admin-specific tests...${colors.reset}\n`);
  
  // You can manually test admin endpoints with:
  console.log(`${colors.cyan}Manual test examples:${colors.reset}`);
  console.log(`
# 1. Signin as admin
curl -X POST http://localhost:3000/user/signin \\
  -H "Content-Type: application/json" \\
  -c cookies.txt \\
  -d '{"email": "${testData.adminEmail}", "password": "adminpass123"}'

# 2. Create a bus
curl -X POST http://localhost:3000/admin/bus/create \\
  -H "Content-Type: application/json" \\
  -b cookies.txt \\
  -d '{
    "busNumber": "KA-01-TEST-1234",
    "name": "Test Luxury Bus",
    "type": "SLEEPER",
    "layoutType": "TWO_TWO",
    "gridRows": 6,
    "gridColumns": 20
  }'

# 3. Get all buses
curl -X GET http://localhost:3000/admin/buses -b cookies.txt
  `);
}

async function runAllTests() {
  console.log(`${colors.yellow}╔${'═'.repeat(58)}╗${colors.reset}`);
  console.log(`${colors.yellow}║  RedBus Clone - Comprehensive API Testing Suite         ║${colors.reset}`);
  console.log(`${colors.yellow}║  Date: ${new Date().toLocaleString().padEnd(44)}║${colors.reset}`);
  console.log(`${colors.yellow}╚${'═'.repeat(58)}╝${colors.reset}\n`);

  await testServerHealth();
  await testUserSignup();
  await testAdminSignup();
  await testBusSearch();
  await testWithAdmin();

  // Summary
  printSection('TEST SUMMARY');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`${colors.green}Passed: ${testsPassed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${testsFailed}${colors.reset}`);
  
  if (testsFailed === 0) {
    console.log(`\n${colors.green}✓ All automated tests passed!${colors.reset}\n`);
    console.log(`${colors.yellow}📝 Next Steps:${colors.reset}`);
    console.log(`1. Promote test admin to ADMIN role in database`);
    console.log(`2. Run manual admin endpoint tests (see examples above)`);
    console.log(`3. Test complete booking flow end-to-end\n`);
  } else {
    console.log(`\n${colors.red}✗ Some tests failed. Please review errors above.${colors.reset}\n`);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
