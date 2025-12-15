import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { userRouter } from "./user/userRouter.js";
import adminRouter from "./admin/adminRouter.js";
import { superAdminRouter } from "./superadmin/superAdminRouter.js";
import type { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
export type PrismaClientType = typeof prisma;

const app = express();
app.use(express.json());

// CORS Configuration - Allow multiple origins
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://gogantabya.netlify.app",
  "https://gantabya-front-git-main-hars-projects-5e449a73.vercel.app/",
  "https://gogantabya.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`⚠️  Blocked CORS request from origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    exposedHeaders: ["Set-Cookie"],
  })
);

app.use(cookieParser());

app.use("/user", userRouter);
app.use("/admin", adminRouter);
app.use("/superadmin", superAdminRouter);

function testFunction(req: Request, res: Response): Response {
  return res.json({ message: "working fine " });
}
app.get("/", testFunction);

app.listen(3000, () => {
  console.log("server running on the port 3000");
});
