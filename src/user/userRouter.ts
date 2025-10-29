import express from "express";
import jwt from "jsonwebtoken";
import z from "zod";
import nodemailer from "nodemailer";

import { prisma } from "../index.js";
import "dotenv/config";
import { signupSchema } from "../schemas/signupSchema.js";
import cookieParser from "cookie-parser";
const JWT_SECRET = process.env.userSecret;
import { sendGmail } from "./sendmail.js";
const app = express();
app.use(cookieParser());
export const userRouter = express.Router();
import bcrypt from "bcrypt";
userRouter.get("/", async (req, res) => {
  return res.status(402).json({ message: "welcome to the user router" });
});

userRouter.post("/signup", async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ errorMessage: "body not recieved" });
  }

  const { name, email, password } = req.body;

  const isInSchema = signupSchema.safeParse(req.body);
  if (!isInSchema.success) {
    return res.status(402).json({
      mesage: "not in the proper signup schema format",
      errorMessage: isInSchema.error?.issues[0]?.message,
    });
  }
  // where is the email and number verification man ?
  const otp = await sendGmail(email);

  try {
    await prisma.emailVerification.create({
      data: {
        otp: otp.toString(),
        email,
        expiresAt: new Date(Date.now() + 60 * 1000 * 10),
      },
    });
  } catch (e) {
    console.log("error while th email otp db updation ");
    return;
  }

  // now we will create this user
  const hashedPassword = await bcrypt.hash(password, 2);
  let created;
  try {
    created = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });
  } catch (e: any) {
    console.dir(e, { depth: null });

    if (e.code === "P2002" && e.meta?.target?.includes("phone")) {
      return res
        .status(400)
        .json({ errorMessage: "phone number already registered" });
    }
    return res.status(500).json({ errorMessage: "error while signup " });
  }

  return res.status(200).json({ message: "signup sucessfull" });
});

userRouter.post("/verifyEmail", async (req, res) => {
  const { otp, email } = req.body;
  let find: any;
  try {
    find = await prisma.emailVerification.findFirst({
      where: {
        email: email,
        otp: otp,
      },
    });
  } catch (e) {
    console.log("error while  searching th eemail ");
  }

  if (!find) {
    return res.status(404).json({ message: "wrong otp " });
  }

  if (new Date() > find.expiresAt) {
    return res.status(404).json({ message: "otp expired " });
  }
  try {
    // use transaction here

    await prisma.emailVerification.deleteMany({
      where: {
        email: email,
        otp: otp,
      },
    });
    await prisma.user.update({
      where: {
        email,
      },
      data: {
        verified: true,
      },
    });
  } catch (e) {
    console.log("error while the email verification ");
  }

  return res.status(200).json({ message: "email verified" });
});

userRouter.post("/signin", async (req, res): Promise<any> => {
  const { email, password } = req.body;
  if (!email || !password) {
    return;
  }
  let userFound: any;
  try {
    userFound = await prisma.user.findFirst({
      where: {
        email,
        verified: true,
      },
    });
  } catch (e) {
    console.log("error while the serchign user ");
  }

  if (!userFound) {
    return res.status(500).json({ message: "user not found in the database" });
  }
  const validpass = await bcrypt.compare(password, userFound.password);
  if (!validpass) {
    return res.status(500).json({ message: "invalid password" });
  }

  //  send the cookie
  if (!JWT_SECRET) {
    console.log("early return because secret not find");
    return res.json({ erroMessage: "internal server error" });
  }
  const token = jwt.sign((userFound?.id).toString(), JWT_SECRET);
  return res
    .status(200)
    .cookie("token", token, { httpOnly: true, secure: true })
    .json({ message: "user signined succefully" });
});

// after the  signin route we need the which returns the bus with the specicxit router
userRouter.post("/showbus", async (req, res): Promise<any> => {
  // >?/

  const { start, end } = req.body;
});

userRouter.get("/showbusinfo/:busId", async (req, res): Promise<any> => {
  // shows the bus details from the backend  returns seat and which are booked
});

userRouter.post("/bookticket", async (req, res) => {
  // book the ticket
});

userRouter.post("/cancelticket", async (req, res) => {});
