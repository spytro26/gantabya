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
app.use(
  cors({
   // Frontend URL
    credentials: true, // Allow cookies
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
