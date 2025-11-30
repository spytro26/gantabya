import express from "express";
import { prisma } from "../index.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import "dotenv/config";
import {
  createOffer,
  handleOfferError,
  mapOfferWithUsage,
} from "../services/offerService.js";
import { DiscountType, OfferCreatorRole } from "@prisma/client";

const JWT_SECRET =
  process.env.superAdminSecret || "super-secret-key-change-in-production";
const app = express();
app.use(cookieParser());
export const superAdminRouter = express.Router();

// Extend Express Request type to include superAdminId
interface AuthRequest extends express.Request {
  superAdminId?: string;
}

// Middleware to verify JWT token and extract superAdminId
// Supports both cookie (preferred) and Authorization header (fallback for mobile)
const authenticateSuperAdmin = async (
  req: AuthRequest,
  res: any,
  next: any
) => {
  // Try cookie first
  let token = req.cookies.superAdminToken;

  // If no cookie, try Authorization header (fallback for mobile/iOS)
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7); // Remove "Bearer " prefix
    }
  }

  if (!token) {
    return res.status(401).json({ errorMessage: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    req.superAdminId = decoded.id;

    // Verify super admin exists
    const superAdmin = await prisma.superAdmin.findUnique({
      where: { id: decoded.id },
    });

    if (!superAdmin) {
      return res
        .status(403)
        .json({ errorMessage: "Super admin access required" });
    }

    next();
  } catch (e) {
    return res.status(401).json({ errorMessage: "Invalid or expired token" });
  }
};

const parseOptionalNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return parsed;
};

// Super Admin Signin endpoint
superAdminRouter.post("/signin", async (req, res): Promise<any> => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      errorMessage: "Username and password are required",
    });
  }

  try {
    // Find super admin
    const superAdmin = await prisma.superAdmin.findUnique({
      where: { username },
    });

    if (!superAdmin) {
      return res.status(401).json({
        errorMessage: "Invalid credentials",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, superAdmin.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        errorMessage: "Invalid credentials",
      });
    }

    // Generate JWT token
    const token = jwt.sign({ id: superAdmin.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Set token in HTTP-only cookie - configured for cross-origin requests
    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("superAdminToken", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "lax" : "lax", // Use "lax" for better iOS compatibility
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/", // Important: ensure cookie is sent to all paths
    });

    return res.status(200).json({
      message: "Super admin signin successful",
      token, // Return token in body for header-based auth
      superAdmin: {
        id: superAdmin.id,
        username: superAdmin.username,
      },
    });
  } catch (error) {
    console.error("Super admin signin error:", error);
    return res.status(500).json({
      errorMessage: "An error occurred during signin",
    });
  }
});

// Get pending admins (waiting for verification)
superAdminRouter.get(
  "/pending-admins",
  authenticateSuperAdmin,
  async (req, res): Promise<any> => {
    try {
      const pendingAdmins = await prisma.user.findMany({
        where: {
          role: "ADMIN",
          adminVerified: false,
        },
        select: {
          id: true,
          name: true,
          email: true,
          verified: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return res.status(200).json({
        admins: pendingAdmins,
        count: pendingAdmins.length,
      });
    } catch (error) {
      console.error("Error fetching pending admins:", error);
      return res.status(500).json({
        errorMessage: "An error occurred while fetching pending admins",
      });
    }
  }
);

// Get all admins (both verified and pending)
superAdminRouter.get(
  "/admins",
  authenticateSuperAdmin,
  async (req, res): Promise<any> => {
    try {
      const admins = await prisma.user.findMany({
        where: {
          role: "ADMIN",
        },
        select: {
          id: true,
          name: true,
          email: true,
          verified: true,
          adminVerified: true,
          adminVerificationAt: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return res.status(200).json({
        admins,
        count: admins.length,
      });
    } catch (error) {
      console.error("Error fetching admins:", error);
      return res.status(500).json({
        errorMessage: "An error occurred while fetching admins",
      });
    }
  }
);

// Verify admin
superAdminRouter.post(
  "/verify-admin/:adminId",
  authenticateSuperAdmin,
  async (req, res): Promise<any> => {
    const { adminId } = req.params;

    if (!adminId) {
      return res.status(400).json({
        errorMessage: "Admin ID is required",
      });
    }

    try {
      // Check if admin exists
      const admin = await prisma.user.findUnique({
        where: { id: adminId as string },
      });

      if (!admin) {
        return res.status(404).json({
          errorMessage: "Admin not found",
        });
      }

      if (admin.role !== "ADMIN") {
        return res.status(400).json({
          errorMessage: "User is not an admin",
        });
      }

      if (admin.adminVerified) {
        return res.status(400).json({
          errorMessage: "Admin is already verified",
        });
      }

      // Verify admin
      const updatedAdmin = await prisma.user.update({
        where: { id: adminId as string },
        data: {
          adminVerified: true,
          adminVerificationAt: new Date(),
        },
      });

      return res.status(200).json({
        message: "Admin verified successfully",
        admin: {
          id: updatedAdmin.id,
          name: updatedAdmin.name,
          email: updatedAdmin.email,
          adminVerified: updatedAdmin.adminVerified,
        },
      });
    } catch (error) {
      console.error("Error verifying admin:", error);
      return res.status(500).json({
        errorMessage: "An error occurred while verifying admin",
      });
    }
  }
);

// Revoke admin verification
superAdminRouter.post(
  "/revoke-admin/:adminId",
  authenticateSuperAdmin,
  async (req, res): Promise<any> => {
    const { adminId } = req.params;

    if (!adminId) {
      return res.status(400).json({
        errorMessage: "Admin ID is required",
      });
    }

    try {
      const admin = await prisma.user.findUnique({
        where: { id: adminId as string },
      });

      if (!admin) {
        return res.status(404).json({
          errorMessage: "Admin not found",
        });
      }

      if (admin.role !== "ADMIN") {
        return res.status(400).json({
          errorMessage: "User is not an admin",
        });
      }

      // Revoke verification
      const updatedAdmin = await prisma.user.update({
        where: { id: adminId as string },
        data: {
          adminVerified: false,
          adminVerificationAt: null,
        },
      });

      return res.status(200).json({
        message: "Admin verification revoked successfully",
        admin: {
          id: updatedAdmin.id,
          name: updatedAdmin.name,
          email: updatedAdmin.email,
          adminVerified: updatedAdmin.adminVerified,
        },
      });
    } catch (error) {
      console.error("Error revoking admin:", error);
      return res.status(500).json({
        errorMessage: "An error occurred while revoking admin",
      });
    }
  }
);

/**
 * POST /superadmin/offers
 * Create a global offer that applies to all buses
 */
superAdminRouter.post(
  "/offers",
  authenticateSuperAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const superAdminId = req.superAdminId;
    const {
      code,
      description,
      discountType,
      discountValue,
      maxDiscount,
      validFrom,
      validUntil,
      minBookingAmount,
      usageLimit,
    } = req.body;

    if (!superAdminId) {
      return res
        .status(401)
        .json({ errorMessage: "Super admin not authenticated" });
    }

    try {
      const offer = await createOffer(
        {
          code,
          description,
          discountType: discountType as DiscountType,
          discountValue: Number(discountValue),
          maxDiscount: parseOptionalNumber(maxDiscount),
          validFrom,
          validUntil,
          minBookingAmount: parseOptionalNumber(minBookingAmount),
          usageLimit: parseOptionalNumber(usageLimit),
        },
        {
          id: superAdminId,
          role: OfferCreatorRole.SUPERADMIN,
        }
      );

      return res.status(201).json({
        message: "Offer created successfully",
        offer,
      });
    } catch (error) {
      return handleOfferError(error, res);
    }
  }
);

/**
 * GET /superadmin/offers
 * List offers with optional filters
 */
superAdminRouter.get(
  "/offers",
  authenticateSuperAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { active, expired, search } = req.query;

    try {
      const now = new Date();

      const offers = await prisma.offer.findMany({
        where: {
          ...(active === "true" && {
            isActive: true,
            validUntil: { gte: now },
          }),
          ...(expired === "true" && {
            validUntil: { lt: now },
          }),
          ...(search && {
            OR: [
              { code: { contains: String(search), mode: "insensitive" } },
              {
                description: {
                  contains: String(search),
                  mode: "insensitive",
                },
              },
            ],
          }),
        },
        include: {
          _count: {
            select: {
              bookingGroups: true,
            },
          },
        },
        orderBy: [{ creatorRole: "desc" }, { createdAt: "desc" }],
      });

      const offersWithUsage = offers.map(mapOfferWithUsage);

      return res.status(200).json({
        message: "Offers fetched successfully",
        offers: offersWithUsage,
        count: offers.length,
      });
    } catch (error) {
      console.error("Error fetching offers:", error);
      return res.status(500).json({ errorMessage: "Failed to fetch offers" });
    }
  }
);

/**
 * PATCH /superadmin/offers/:offerId
 * Toggle offer activation status
 */
superAdminRouter.patch(
  "/offers/:offerId",
  authenticateSuperAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { offerId } = req.params;
    const { isActive } = req.body;
    const superAdminId = req.superAdminId;

    if (!offerId) {
      return res.status(400).json({ errorMessage: "Offer ID is required" });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        errorMessage: "isActive flag must be provided as true or false",
      });
    }

    if (!superAdminId) {
      return res.status(401).json({ errorMessage: "Not authenticated" });
    }

    try {
      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!offer) {
        return res.status(404).json({ errorMessage: "Offer not found" });
      }

      if (
        offer.creatorRole !== OfferCreatorRole.SUPERADMIN ||
        offer.createdBy !== superAdminId
      ) {
        return res.status(403).json({
          errorMessage: "You can only update offers created by you",
        });
      }

      const updated = await prisma.offer.update({
        where: { id: offerId },
        data: { isActive },
      });

      return res.status(200).json({
        message: "Offer updated successfully",
        offer: updated,
      });
    } catch (error) {
      console.error("Error updating offer:", error);
      return res.status(500).json({ errorMessage: "Failed to update offer" });
    }
  }
);

/**
 * DELETE /superadmin/offers/:offerId
 * Deactivate a super admin offer
 */
superAdminRouter.delete(
  "/offers/:offerId",
  authenticateSuperAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { offerId } = req.params;
    const superAdminId = req.superAdminId;

    if (!offerId) {
      return res.status(400).json({ errorMessage: "Offer ID is required" });
    }

    if (!superAdminId) {
      return res.status(401).json({ errorMessage: "Not authenticated" });
    }

    try {
      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!offer) {
        return res.status(404).json({ errorMessage: "Offer not found" });
      }

      if (
        offer.creatorRole !== OfferCreatorRole.SUPERADMIN ||
        offer.createdBy !== superAdminId
      ) {
        return res.status(403).json({
          errorMessage: "You can only update offers created by you",
        });
      }

      const updated = await prisma.offer.update({
        where: { id: offerId },
        data: { isActive: false },
      });

      return res.status(200).json({
        message: "Offer deactivated successfully",
        offer: updated,
      });
    } catch (error) {
      console.error("Error deactivating offer:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to deactivate offer" });
    }
  }
);

// Super admin logout
superAdminRouter.post("/logout", (req, res): any => {
  res.clearCookie("superAdminToken");
  return res.status(200).json({ message: "Logout successful" });
});

// Check super admin authentication status
superAdminRouter.get(
  "/me",
  authenticateSuperAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    try {
      if (!req.superAdminId) {
        return res.status(401).json({ errorMessage: "Not authenticated" });
      }

      const superAdmin = await prisma.superAdmin.findUnique({
        where: { id: req.superAdminId as string },
        select: {
          id: true,
          username: true,
          createdAt: true,
        },
      });

      if (!superAdmin) {
        return res.status(404).json({ errorMessage: "Super admin not found" });
      }

      return res.status(200).json({ superAdmin });
    } catch (error) {
      console.error("Error fetching super admin:", error);
      return res.status(500).json({
        errorMessage: "An error occurred",
      });
    }
  }
);

// Get specific admin details
superAdminRouter.get(
  "/admin/:adminId",
  authenticateSuperAdmin,
  async (req, res): Promise<any> => {
    const { adminId } = req.params;

    if (!adminId) {
      return res.status(400).json({ errorMessage: "Admin ID is required" });
    }

    try {
      const admin = await prisma.user.findUnique({
        where: { id: adminId as string },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          verified: true,
          adminVerified: true,
          adminVerificationAt: true,
          createdAt: true,
        },
      });

      if (!admin) {
        return res.status(404).json({ errorMessage: "Admin not found" });
      }

      if (admin.role !== "ADMIN") {
        return res.status(400).json({ errorMessage: "User is not an admin" });
      }

      return res.status(200).json({ admin });
    } catch (error) {
      console.error("Error fetching admin:", error);
      return res.status(500).json({
        errorMessage: "An error occurred while fetching admin",
      });
    }
  }
);

// Get admin's buses
superAdminRouter.get(
  "/admin/:adminId/buses",
  authenticateSuperAdmin,
  async (req, res): Promise<any> => {
    const { adminId } = req.params;

    if (!adminId) {
      return res.status(400).json({ errorMessage: "Admin ID is required" });
    }

    try {
      const buses = await prisma.bus.findMany({
        where: { adminId: adminId as string },
        select: {
          id: true,
          busNumber: true,
          name: true,
          type: true,
          layoutType: true,
          totalSeats: true,
          createdAt: true,
          stops: {
            orderBy: { stopIndex: "asc" },
            select: {
              id: true,
              name: true,
              city: true,
              stopIndex: true,
              lowerSeaterPrice: true,
              lowerSleeperPrice: true,
              upperSleeperPrice: true,
            },
          },
          images: {
            select: {
              id: true,
              imageUrl: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
          _count: {
            select: {
              trips: true,
              stops: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return res.status(200).json({ buses });
    } catch (error) {
      console.error("Error fetching admin buses:", error);
      return res.status(500).json({
        errorMessage: "An error occurred while fetching buses",
      });
    }
  }
);

// Get admin's trips
superAdminRouter.get(
  "/admin/:adminId/trips",
  authenticateSuperAdmin,
  async (req, res): Promise<any> => {
    const { adminId } = req.params;

    if (!adminId) {
      return res.status(400).json({ errorMessage: "Admin ID is required" });
    }

    try {
      const trips = await prisma.trip.findMany({
        where: {
          bus: {
            adminId: adminId as string,
          },
        },
        select: {
          id: true,
          tripDate: true,
          status: true,
          createdAt: true,
          bus: {
            select: {
              busNumber: true,
              name: true,
            },
          },
          _count: {
            select: {
              bookings: true,
            },
          },
        },
        orderBy: { tripDate: "desc" },
        take: 100, // Limit to recent 100 trips
      });

      return res.status(200).json({ trips });
    } catch (error) {
      console.error("Error fetching admin trips:", error);
      return res.status(500).json({
        errorMessage: "An error occurred while fetching trips",
      });
    }
  }
);
