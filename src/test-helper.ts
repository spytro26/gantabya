// Test Helper - Use this to setup test data and verify users
import { prisma } from "./index.js";
import bcrypt from "bcrypt";

async function main() {
  const command = process.argv[2];

  if (command === "verify-user") {
    const email = process.argv[3];
    if (!email) {
      console.log("Usage: npm run test-helper verify-user <email>");
      process.exit(1);
    }

    try {
      await prisma.user.update({
        where: { email },
        data: { verified: true },
      });
      console.log(`✓ User ${email} verified successfully`);
    } catch (error) {
      console.error(`✗ Error verifying user: ${error}`);
    }
  } else if (command === "create-admin") {
    const email = process.argv[3] || "admin@test.com";
    const password = process.argv[4] || "admin123";
    const name = process.argv[5] || "Admin User";

    try {
      const hashedPassword = await bcrypt.hash(password, 2);
      const admin = await prisma.user.upsert({
        where: { email },
        update: {
          role: "ADMIN",
          verified: true,
        },
        create: {
          email,
          name,
          password: hashedPassword,
          role: "ADMIN",
          verified: true,
        },
      });
      console.log(`✓ Admin user created/updated: ${email}`);
      console.log(`  Password: ${password}`);
    } catch (error) {
      console.error(`✗ Error creating admin: ${error}`);
    }
  } else if (command === "get-otp") {
    const email = process.argv[3];
    if (!email) {
      console.log("Usage: npm run test-helper get-otp <email>");
      process.exit(1);
    }

    try {
      const otpRecord = await prisma.emailVerification.findFirst({
        where: { email },
        orderBy: { createdAt: "desc" },
      });

      if (otpRecord) {
        console.log(otpRecord.otp);
      } else {
        console.error("No OTP found for this email");
      }
    } catch (error) {
      console.error(`✗ Error getting OTP: ${error}`);
    }
  } else if (command === "list-users") {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          verified: true,
          createdAt: true,
        },
        take: 10,
      });
      console.log("\nUsers in database:");
      console.table(users);
    } catch (error) {
      console.error(`✗ Error listing users: ${error}`);
    }
  } else if (command === "cleanup-test-users") {
    try {
      const result = await prisma.user.deleteMany({
        where: {
          email: {
            contains: "test",
          },
        },
      });
      console.log(`✓ Deleted ${result.count} test users`);
    } catch (error) {
      console.error(`✗ Error cleaning up: ${error}`);
    }
  } else {
    console.log(`
Test Helper Commands:

  npm run test-helper verify-user <email>
    - Verify a user's email (set verified=true)
  
  npm run test-helper create-admin [email] [password] [name]
    - Create or update an admin user
    - Default: admin@test.com / admin123
  
  npm run test-helper get-otp <email>
    - Get the latest OTP for an email
  
  npm run test-helper list-users
    - List all users in the database
  
  npm run test-helper cleanup-test-users
    - Delete all users with 'test' in email
    `);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
