import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Create default super admin
  const superAdminExists = await prisma.superAdmin.findUnique({
    where: { username: "super" },
  });

  if (!superAdminExists) {
    const hashedPassword = await bcrypt.hash("admin", 10);

    const superAdmin = await prisma.superAdmin.create({
      data: {
        username: "super",
        password: hashedPassword,
      },
    });

    console.log("✅ Super Admin created:");
    console.log("   Username: super");
    console.log("   Password: admin");
    console.log("   ID:", superAdmin.id);
  } else {
    console.log("ℹ️  Super Admin already exists");
  }

  console.log("✅ Database seeding completed!");
}

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
