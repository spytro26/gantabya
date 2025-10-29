import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { userRouter } from "./user/userRouter.js";
import type { Response, Request } from "express";
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();

const app = express();
app.use(express.json());
app.use(cors());

app.use("/user", userRouter);

function testFunction(req: Request, res: Response): Response {
  return res.json({ message: "working fine " });
}
app.get("/", testFunction);

app.listen(3000, () => {
  console.log("server running on the port 3000");
});
