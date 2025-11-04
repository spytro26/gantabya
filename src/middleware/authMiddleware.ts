import jwt from "jsonwebtoken";
import { prisma } from "../index.js";
import type { Request, Response, NextFunction } from "express";
import "dotenv/config";

// Extend Express Request to include user/admin ID
export interface AuthRequest extends Request {
  userId?: string;
  adminId?: string;
}

const USER_JWT_SECRET = process.env.userSecret;
const ADMIN_JWT_SECRET = process.env.adminSecret || process.env.userSecret;

/**
 * Middleware to authenticate user via JWT token
 * Checks cookie for token and verifies it
 * Adds userId to request object
 */
export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ errorMessage: "Authentication required" });
  }

  if (!USER_JWT_SECRET) {
    return res.status(500).json({ errorMessage: "Internal server error" });
  }

  try {
    const decoded = jwt.verify(token, USER_JWT_SECRET) as string;
    req.userId = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ errorMessage: "Invalid or expired token" });
  }
};

/**
 * Middleware to authenticate admin via JWT token
 * Checks cookie for token, verifies it, and confirms user has ADMIN role
 * Adds adminId to request object
 */
export const authenticateAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const token = req.cookies.adminToken || req.cookies.token;

  if (!token) {
    return res.status(401).json({ errorMessage: "Authentication required" });
  }

  if (!ADMIN_JWT_SECRET) {
    return res.status(500).json({ errorMessage: "Internal server error" });
  }

  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET) as string;
    req.adminId = decoded;

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { id: decoded },
    });

    if (!user || user.role !== "ADMIN") {
      return res.status(403).json({ errorMessage: "Admin access required" });
    }

    next();
  } catch (e) {
    return res.status(401).json({ errorMessage: "Invalid or expired token" });
  }
};

/**
 * Optional authentication middleware
 * Adds userId if token is present, but doesn't fail if not
 * Useful for endpoints that work differently for logged-in users
 */
export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<any> => {
  const token = req.cookies.token;

  if (!token || !USER_JWT_SECRET) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, USER_JWT_SECRET) as string;
    req.userId = decoded;
  } catch (e) {
    // Token invalid, but we don't fail - just continue without userId
  }

  next();
};

/**
 * Rate limiting middleware (simple implementation)
 * Limits requests per IP address
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const rateLimiter = (
  maxRequests: number = 100,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    const record = requestCounts.get(ip);

    if (!record || now > record.resetTime) {
      requestCounts.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    if (record.count >= maxRequests) {
      return res.status(429).json({
        errorMessage: "Too many requests. Please try again later.",
      });
    }

    record.count++;
    next();
  };
};

/**
 * Validation middleware factory
 * Validates request body against a Zod schema
 */
export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction): any => {
    const validation = schema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        errorMessage: "Invalid request data",
        errors: validation.error.issues,
      });
    }

    next();
  };
};

/**
 * Error handling middleware
 * Catches any unhandled errors and returns appropriate response
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): any => {
  console.error("Error:", err);

  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ errorMessage: "Invalid token" });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ errorMessage: "Token expired" });
  }

  if (err.code === "P2002") {
    return res.status(400).json({ errorMessage: "Duplicate entry" });
  }

  if (err.code === "P2025") {
    return res.status(404).json({ errorMessage: "Record not found" });
  }

  return res.status(500).json({
    errorMessage: "Internal server error",
    ...(process.env.NODE_ENV === "development" && { details: err.message }),
  });
};
