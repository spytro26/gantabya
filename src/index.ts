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

// CORS configuration - supports multiple origins for local dev and production
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:5173",
  "http://localhost:5173", // Always allow local development
  "http://localhost:5174", // Vite alternative port
  "https://gogantabya.netlify.app",
  
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies and authentication headers
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
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
