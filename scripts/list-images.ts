import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const images = await prisma.busImage.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  if (images.length === 0) {
    console.log("No bus images found");
    return;
  }

  console.log(`Found ${images.length} images`);
  for (const image of images) {
    console.log(
      `${image.id} | busId=${
        image.busId
      } | uploaded=${image.createdAt.toISOString()}\n  url=${
        image.imageUrl
      }\n  publicId=${image.publicId}`
    );
  }
}

main()
  .catch((err) => {
    console.error("Failed to list images", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
