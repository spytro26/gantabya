import { v2 as cloudinary } from "cloudinary";
import "dotenv/config";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dkulk73ck",
  api_key: process.env.CLOUDINARY_API_KEY || "727287236654959",
  api_secret: process.env.CLOUDINARY_API_SECRET || "",
});

// Validate configuration
if (!process.env.CLOUDINARY_API_SECRET) {
  console.error("⚠️  WARNING: CLOUDINARY_API_SECRET is not set in .env file!");
  console.error("Please add your Cloudinary API Secret to continue.");
}

export default cloudinary;
