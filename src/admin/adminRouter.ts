import express from "express";
import { prisma } from "../index.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import { sendGmail } from "../user/sendmail.js";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import "dotenv/config";
import {
  createOffer,
  handleOfferError,
  mapOfferWithUsage,
  sanitizeApplicableBusesForAdmin,
} from "../services/offerService.js";
import { DiscountType, OfferCreatorRole } from "@prisma/client";

const JWT_SECRET = process.env.adminSecret || process.env.userSecret;
const app = express();
app.use(cookieParser());
export const adminRouter = express.Router();

// Extend Express Request type to include adminId
interface AuthRequest extends express.Request {
  adminId?: string;
}

// Middleware to verify JWT token and extract adminId
const authenticateAdmin = async (req: AuthRequest, res: any, next: any) => {
  const token = req.cookies.adminToken || req.cookies.token;

  if (!token) {
    return res.status(401).json({ errorMessage: "Authentication required" });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({ errorMessage: "Internal server error" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as string;
    req.adminId = decoded;

    // Verify user is admin
    const user = await prisma.user.findUnique({
      where: { id: decoded },
    });

    if (!user || user.role !== "ADMIN") {
      return res.status(403).json({ errorMessage: "Admin access required" });
    }

    // Check if admin is verified by super admin
    if (!user.adminVerified) {
      return res.status(403).json({
        errorMessage: "Admin account pending verification",
        needsVerification: true,
      });
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

const parseOptionalStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.map((item) => String(item));
};

adminRouter.get("/", async (req, res) => {
  return res.status(200).json({ message: "Welcome to the admin router" });
});

// Admin Signup endpoint (Step 1: Create account and send OTP)
adminRouter.post("/signup", async (req, res): Promise<any> => {
  const { name, email, password, busServiceName } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      errorMessage: "Name, email, and password are required",
    });
  }

  const normalizedServiceName =
    typeof busServiceName === "string" && busServiceName.trim().length > 0
      ? busServiceName.trim()
      : "Ankush Travels";

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ errorMessage: "Invalid email format" });
  }

  // Validate password strength
  if (password.length < 6) {
    return res.status(400).json({
      errorMessage: "Password must be at least 6 characters",
    });
  }

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({
        errorMessage: "Email already registered",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user (unverified - needs both email and super admin verification)
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "ADMIN",
        verified: false, // Email not verified yet
        adminVerified: false, // Super admin verification pending
        busServiceName: normalizedServiceName,
      },
    });

    // Generate and send OTP
    const otp = await sendGmail(email);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    await prisma.emailVerification.create({
      data: {
        email,
        otp: otp.toString(),
        expiresAt,
      },
    });

    return res.status(201).json({
      message:
        "Admin account created. Please verify your email with the OTP sent.",
      admin: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        busServiceName: user.busServiceName,
      },
    });
  } catch (error) {
    console.error("Error in admin signup:", error);
    return res.status(500).json({ errorMessage: "Internal server error" });
  }
});

// Admin Email Verification endpoint (Step 2: Verify OTP)
adminRouter.post("/verifyEmail", async (req, res): Promise<any> => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({
      errorMessage: "Email and OTP are required",
    });
  }

  try {
    // Find the most recent verification record
    const verification = await prisma.emailVerification.findFirst({
      where: {
        email,
        otp: otp.toString(),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!verification) {
      return res.status(400).json({
        errorMessage: "Invalid OTP",
      });
    }

    // Check if OTP is expired
    if (new Date() > verification.expiresAt) {
      return res.status(400).json({
        errorMessage: "OTP has expired. Please request a new one.",
      });
    }

    // Update user as email verified
    const user = await prisma.user.update({
      where: { email },
      data: { verified: true },
    });

    // Delete used OTP
    await prisma.emailVerification.deleteMany({
      where: { email },
    });

    return res.status(200).json({
      message:
        "Email verified successfully. Your account is pending super admin approval.",
      admin: {
        id: user.id,
        name: user.name,
        email: user.email,
        verified: user.verified,
        adminVerified: user.adminVerified,
      },
    });
  } catch (error) {
    console.error("Error in email verification:", error);
    return res.status(500).json({ errorMessage: "Internal server error" });
  }
});

// Admin Signin endpoint
adminRouter.post("/signin", async (req, res): Promise<any> => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ errorMessage: "Email and password are required" });
  }

  try {
    // Find user and verify they are admin
    const user = await prisma.user.findFirst({
      where: {
        email,
        role: "ADMIN",
      },
    });

    if (!user) {
      return res.status(401).json({ errorMessage: "Invalid credentials" });
    }

    // Check if email is verified
    if (!user.verified) {
      return res.status(403).json({
        errorMessage: "Please verify your email first",
        needsEmailVerification: true,
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ errorMessage: "Invalid credentials" });
    }

    // Generate JWT token with admin secret
    if (!JWT_SECRET) {
      return res.status(500).json({ errorMessage: "Internal server error" });
    }

    const token = jwt.sign(user.id, JWT_SECRET);

    // Set token in cookie - configured for cross-origin requests
    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax", // "none" required for cross-origin in production
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(200).json({
      message: "Admin signin successful",
      admin: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        adminVerified: user.adminVerified, // Frontend will use this to show verification status
        busServiceName: user.busServiceName,
      },
    });
  } catch (error) {
    console.error("Error in admin signin:", error);
    return res.status(500).json({ errorMessage: "Internal server error" });
  }
});

// Check admin verification status
adminRouter.get(
  "/verification-status",
  async (req: AuthRequest, res): Promise<any> => {
    const token = req.cookies.adminToken || req.cookies.token;

    if (!token) {
      return res.status(401).json({ errorMessage: "Authentication required" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET!) as string;

      const user = await prisma.user.findUnique({
        where: { id: decoded },
        select: {
          id: true,
          name: true,
          email: true,
          verified: true,
          adminVerified: true,
          role: true,
          busServiceName: true,
        },
      });

      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ errorMessage: "Admin access required" });
      }

      return res.status(200).json({
        admin: user,
        needsVerification: !user.adminVerified,
      });
    } catch (error) {
      return res.status(401).json({ errorMessage: "Invalid or expired token" });
    }
  }
);

// Update bus service name
adminRouter.put(
  "/profile/service-name",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { serviceName } = req.body;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    const normalizedServiceName =
      typeof serviceName === "string" && serviceName.trim().length > 0
        ? serviceName.trim()
        : "";

    if (!normalizedServiceName) {
      return res.status(400).json({ errorMessage: "Service name is required" });
    }

    if (normalizedServiceName.length < 3) {
      return res.status(400).json({
        errorMessage: "Service name must be at least 3 characters long",
      });
    }

    try {
      const updated = await prisma.user.update({
        where: { id: adminId },
        data: {
          busServiceName: normalizedServiceName,
        },
        select: {
          busServiceName: true,
        },
      });

      return res.status(200).json({
        message: "Service name updated successfully",
        serviceName: updated.busServiceName,
      });
    } catch (error) {
      console.error("Error updating service name:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to update service name" });
    }
  }
);

adminRouter.get(
  "/profile/service-name",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const admin = await prisma.user.findUnique({
        where: { id: adminId },
        select: {
          busServiceName: true,
          name: true,
        },
      });

      if (!admin) {
        return res.status(404).json({ errorMessage: "Admin not found" });
      }

      return res.status(200).json({
        serviceName: admin.busServiceName || "Ankush Travels",
        adminName: admin.name,
      });
    } catch (error) {
      console.error("Error fetching service name:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch service name" });
    }
  }
);

// Forgot Password - Step 1: Send OTP
adminRouter.post("/forgot-password", async (req, res): Promise<any> => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      errorMessage: "Email is required",
    });
  }

  try {
    // Check if admin exists
    const user = await prisma.user.findFirst({
      where: {
        email,
        role: "ADMIN",
      },
    });

    if (!user) {
      // Don't reveal if email exists or not for security
      return res.status(200).json({
        message:
          "If an account with this email exists, a password reset OTP has been sent.",
      });
    }

    // Generate and send OTP
    const otp = await sendGmail(email);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete any existing password reset requests
    await prisma.passwordReset.deleteMany({
      where: { email },
    });

    // Store OTP in database
    await prisma.passwordReset.create({
      data: {
        email,
        otp: otp.toString(),
        expiresAt,
      },
    });

    return res.status(200).json({
      message:
        "If an account with this email exists, a password reset OTP has been sent.",
    });
  } catch (error) {
    console.error("Error in forgot password:", error);
    return res.status(500).json({ errorMessage: "Internal server error" });
  }
});

// Forgot Password - Step 2: Verify OTP and Reset Password
adminRouter.post("/reset-password", async (req, res): Promise<any> => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({
      errorMessage: "Email, OTP, and new password are required",
    });
  }

  // Validate password strength
  if (newPassword.length < 6) {
    return res.status(400).json({
      errorMessage: "Password must be at least 6 characters",
    });
  }

  try {
    // Find the most recent password reset record
    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        email,
        otp: otp.toString(),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!resetRequest) {
      return res.status(400).json({
        errorMessage: "Invalid OTP",
      });
    }

    // Check if OTP is expired
    if (new Date() > resetRequest.expiresAt) {
      return res.status(400).json({
        errorMessage: "OTP has expired. Please request a new one.",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    // Delete used OTP
    await prisma.passwordReset.deleteMany({
      where: { email },
    });

    return res.status(200).json({
      message:
        "Password reset successfully. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("Error in reset password:", error);
    return res.status(500).json({ errorMessage: "Internal server error" });
  }
});

// ==================== BUS SEAT LAYOUT ENDPOINT ====================

interface SeatGridInput {
  seatNumber: string; // "1", "2", "3", "" for empty
}

interface ProcessedSeat {
  seatNumber: string;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  type: "SEATER" | "SLEEPER";
}

/**
 * Process admin's grid input to detect sleeper seats
 * Rules:
 * - Same number twice horizontally = Horizontal sleeper (1 row × 2 cols)
 * - Same number twice vertically = Vertical sleeper (2 rows × 1 col)
 * - Single cell = Seater (1 row × 1 col)
 */
function processGridToSeats(
  grid: SeatGridInput[][],
  level: "LOWER" | "UPPER"
): ProcessedSeat[] {
  const seats: ProcessedSeat[] = [];
  const processed = new Set<string>(); // Track processed cells

  for (let row = 0; row < grid.length; row++) {
    const currentRow = grid[row];
    if (!currentRow) continue;

    for (let col = 0; col < currentRow.length; col++) {
      const currentCell = currentRow[col];
      if (!currentCell) continue;

      const seatNum = currentCell.seatNumber?.trim();
      const cellKey = `${level}-${row}-${col}`;

      // Skip empty cells or already processed cells
      if (!seatNum || processed.has(cellKey)) continue;

      // Check if horizontal sleeper (scan ahead for all cells with same number)
      let horizontalSpan = 1;
      for (let c = col + 1; c < currentRow.length && c < col + 4; c++) {
        const checkCell = currentRow[c];
        if (checkCell && checkCell.seatNumber?.trim() === seatNum) {
          horizontalSpan++;
        } else {
          break;
        }
      }

      if (horizontalSpan > 1) {
        // Horizontal sleeper (2-4 cells wide)
        seats.push({
          seatNumber: seatNum,
          row,
          column: col,
          rowSpan: 1,
          columnSpan: horizontalSpan,
          type: "SLEEPER",
        });
        // Mark all spanned cells as processed
        for (let c = col; c < col + horizontalSpan; c++) {
          processed.add(`${level}-${row}-${c}`);
        }
        continue;
      }

      // Check if vertical sleeper (same number below)
      const nextRow = row + 1 < grid.length ? grid[row + 1] : null;
      const belowCellObj = nextRow && nextRow[col] ? nextRow[col] : null;
      const belowCell = belowCellObj ? belowCellObj.seatNumber?.trim() : null;

      if (belowCell === seatNum) {
        // Vertical sleeper (2 cells tall)
        seats.push({
          seatNumber: seatNum,
          row,
          column: col,
          rowSpan: 2,
          columnSpan: 1,
          type: "SLEEPER",
        });
        processed.add(`${level}-${row}-${col}`);
        processed.add(`${level}-${row + 1}-${col}`);
        continue;
      }

      // Single cell = Seater
      seats.push({
        seatNumber: seatNum,
        row,
        column: col,
        rowSpan: 1,
        columnSpan: 1,
        type: "SEATER",
      });
      processed.add(`${level}-${row}-${col}`);
    }
  }

  return seats;
}

/**
 * POST /admin/bus/create
 * Create a new bus with basic info
 */
adminRouter.post(
  "/bus/create",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busNumber, name, type, layoutType, gridRows, gridColumns } =
      req.body;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busNumber || !name || !type) {
      return res.status(400).json({ errorMessage: "Missing required fields" });
    }

    try {
      const bus = await prisma.bus.create({
        data: {
          adminId,
          busNumber,
          name,
          type,
          layoutType: layoutType || "TWO_TWO",
          gridRows: gridRows || 6,
          gridColumns: gridColumns || 20,
          totalSeats: 0, // Will be updated when seats are added
        },
      });

      return res.status(201).json({
        message: "Bus created successfully",
        bus,
      });
    } catch (e: any) {
      console.error("Error creating bus:", e);

      if (e.code === "P2002") {
        return res
          .status(400)
          .json({ errorMessage: "Bus number already exists" });
      }

      return res.status(500).json({ errorMessage: "Failed to create bus" });
    }
  }
);

/**
 * POST /admin/bus/:busId/seats/layout
 * Submit seat layout grid for a bus
 * Body: {
 *   lowerDeckGrid: SeatGridInput[][], // 6×20 grid
 *   upperDeckGrid: SeatGridInput[][]  // 6×20 grid (optional)
 * }
 */
adminRouter.post(
  "/bus/:busId/seats/layout",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;
    const { lowerDeckGrid, upperDeckGrid } = req.body;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    if (!lowerDeckGrid) {
      return res
        .status(400)
        .json({ errorMessage: "Lower deck grid is required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to modify this bus" });
      }

      // Validate grid dimensions
      if (lowerDeckGrid.length !== bus.gridRows) {
        return res.status(400).json({
          errorMessage: `Lower deck grid must have ${bus.gridRows} rows`,
        });
      }

      if (lowerDeckGrid[0].length !== bus.gridColumns) {
        return res.status(400).json({
          errorMessage: `Lower deck grid must have ${bus.gridColumns} columns`,
        });
      }

      // Process grids to extract seats
      const lowerSeats = processGridToSeats(lowerDeckGrid, "LOWER");
      const upperSeats = upperDeckGrid
        ? processGridToSeats(upperDeckGrid, "UPPER")
        : [];

      const allSeats = [...lowerSeats, ...upperSeats];

      // ✅ Check if there are any confirmed bookings for this bus before allowing layout changes
      const existingBookings = await prisma.booking.count({
        where: {
          seat: {
            busId: busId,
          },
          status: "CONFIRMED",
        },
      });

      if (existingBookings > 0) {
        return res.status(400).json({
          errorMessage: `Cannot modify seat layout. This bus has ${existingBookings} active booking(s). Please cancel all bookings first or create a new bus with the desired layout.`,
          activeBookings: existingBookings,
        });
      }

      // Use transaction to delete old seats and create new ones
      // Increased timeout to 15 seconds for large layouts (15×4 = 60 seats)
      const result = await prisma.$transaction(
        async (tx) => {
          // Delete existing seats for this bus (safe now - no bookings exist)
          await tx.seat.deleteMany({
            where: { busId },
          });

          // Create new seats using createMany for better performance
          await tx.seat.createMany({
            data: allSeats.map((seat) => ({
              busId,
              seatNumber: seat.seatNumber,
              row: seat.row,
              column: seat.column,
              rowSpan: seat.rowSpan,
              columnSpan: seat.columnSpan,
              type: seat.type,
              level: lowerSeats.includes(seat) ? "LOWER" : "UPPER",
              isActive: true,
            })),
          });

          // Get count of created seats
          const seatCount = allSeats.length;

          // Update bus totalSeats count
          await tx.bus.update({
            where: { id: busId },
            data: { totalSeats: seatCount },
          });

          return seatCount;
        },
        {
          maxWait: 10000, // Maximum time to wait for a transaction slot (10s)
          timeout: 15000, // Maximum time for the transaction to complete (15s)
        }
      );

      return res.status(200).json({
        message: "Seat layout saved successfully",
        totalSeats: result,
        lowerDeckSeats: lowerSeats.length,
        upperDeckSeats: upperSeats.length,
      });
    } catch (e: any) {
      console.error("Error saving seat layout:", e);

      // Handle foreign key constraint error
      if (e.code === "P2003") {
        return res.status(400).json({
          errorMessage:
            "Cannot modify seat layout because some seats have active bookings. Please ensure all bookings are cancelled first.",
          details: e.message,
        });
      }

      return res.status(500).json({
        errorMessage: "Failed to save seat layout",
        details: e.message,
      });
    }
  }
);

/**
 * GET /admin/bus/:busId/seats
 * Get current seat layout for a bus
 */
adminRouter.get(
  "/bus/:busId/seats",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;
    const adminId = req.adminId;

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        include: {
          seats: {
            orderBy: [{ level: "asc" }, { row: "asc" }, { column: "asc" }],
          },
        },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to view this bus" });
      }

      const lowerDeckSeats = bus.seats.filter((s: any) => s.level === "LOWER");
      const upperDeckSeats = bus.seats.filter((s: any) => s.level === "UPPER");

      return res.status(200).json({
        message: "Seat layout fetched successfully",
        bus: {
          id: bus.id,
          busNumber: bus.busNumber,
          name: bus.name,
          type: bus.type,
          layoutType: bus.layoutType,
          gridRows: bus.gridRows,
          gridColumns: bus.gridColumns,
          totalSeats: bus.totalSeats,
        },
        seats: {
          lowerDeck: lowerDeckSeats.map((s: any) => ({
            id: s.id,
            seatNumber: s.seatNumber,
            row: s.row,
            column: s.column,
            rowSpan: s.rowSpan,
            columnSpan: s.columnSpan,
            type: s.type,
            isActive: s.isActive,
          })),
          upperDeck: upperDeckSeats.map((s: any) => ({
            id: s.id,
            seatNumber: s.seatNumber,
            row: s.row,
            column: s.column,
            rowSpan: s.rowSpan,
            columnSpan: s.columnSpan,
            type: s.type,
            isActive: s.isActive,
          })),
        },
      });
    } catch (e) {
      console.error("Error fetching seat layout:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch seat layout" });
    }
  }
);

/**
 * GET /admin/buses
 * Get all buses owned by this admin
 */
adminRouter.get(
  "/buses",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const buses = await prisma.bus.findMany({
        where: { adminId },
        include: {
          _count: {
            select: {
              seats: true,
              stops: true,
              trips: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return res.status(200).json({
        message: "Buses fetched successfully",
        count: buses.length,
        buses: buses.map((bus) => ({
          id: bus.id,
          busNumber: bus.busNumber,
          name: bus.name,
          type: bus.type,
          layoutType: bus.layoutType,
          totalSeats: bus.totalSeats,
          gridRows: bus.gridRows,
          gridColumns: bus.gridColumns,
          seatCount: bus._count.seats,
          stopCount: bus._count.stops,
          tripCount: bus._count.trips,
          createdAt: bus.createdAt,
        })),
      });
    } catch (e) {
      console.error("Error fetching buses:", e);
      return res.status(500).json({ errorMessage: "Failed to fetch buses" });
    }
  }
);

// ==================== STOPS MANAGEMENT ====================

/**
 * POST /admin/bus/:busId/stops
 * Add stops to a bus route
 */
adminRouter.post(
  "/bus/:busId/stops",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;
    const { stops } = req.body; // Array of stop objects

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    if (!stops || !Array.isArray(stops) || stops.length < 2) {
      return res
        .status(400)
        .json({ errorMessage: "At least 2 stops are required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to modify this bus" });
      }

      // Use transaction to delete old stops and create new ones
      // Increased timeout for routes with many stops and boarding points
      const result = await prisma.$transaction(
        async (tx) => {
          // Delete existing stops for this bus
          await tx.stop.deleteMany({
            where: { busId },
          });

          // Create new stops with proper indexing
          const createdStops = await Promise.all(
            stops.map((stop: any, index: number) =>
              tx.stop.create({
                data: {
                  busId,
                  name: stop.name,
                  city: stop.city,
                  state: stop.state || null,
                  stopIndex: index,
                  arrivalTime: index === 0 ? null : stop.arrivalTime,
                  departureTime:
                    index === stops.length - 1 ? null : stop.departureTime,
                  returnArrivalTime:
                    index === stops.length - 1
                      ? null
                      : stop.returnArrivalTime || null,
                  returnDepartureTime:
                    index === 0 ? null : stop.returnDepartureTime || null,
                  distanceFromOrigin:
                    typeof stop.distanceFromOrigin === "number"
                      ? stop.distanceFromOrigin
                      : Number(stop.distanceFromOrigin) || 0,
                  priceFromOrigin:
                    typeof stop.priceFromOrigin === "number"
                      ? stop.priceFromOrigin
                      : Number(stop.priceFromOrigin) || 0,
                  lowerSeaterPrice:
                    typeof stop.lowerSeaterPrice === "number"
                      ? stop.lowerSeaterPrice
                      : Number(stop.lowerSeaterPrice) || 0,
                  lowerSleeperPrice:
                    typeof stop.lowerSleeperPrice === "number"
                      ? stop.lowerSleeperPrice
                      : Number(stop.lowerSleeperPrice) || 0,
                  upperSleeperPrice:
                    typeof stop.upperSleeperPrice === "number"
                      ? stop.upperSleeperPrice
                      : Number(stop.upperSleeperPrice) || 0,
                  boardingPoints: {
                    create: stop.boardingPoints.map(
                      (point: any, pointIndex: number) => ({
                        type: "BOARDING",
                        name: point.name,
                        time: point.time,
                        landmark: point.landmark || null,
                        address: point.address || null,
                        pointOrder: pointIndex,
                      })
                    ),
                  },
                },
                include: {
                  boardingPoints: {
                    orderBy: { pointOrder: "asc" },
                  },
                },
              })
            )
          );

          return createdStops;
        },
        {
          maxWait: 10000, // Wait up to 10 seconds for transaction slot
          timeout: 20000, // Allow up to 20 seconds for transaction to complete
        }
      );

      return res.status(200).json({
        message: "Stops added successfully",
        count: result.length,
        stops: result,
      });
    } catch (e: any) {
      console.error("Error adding stops:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to add stops", details: e.message });
    }
  }
);

/**
 * GET /admin/bus/:busId/stops
 * Get all stops for a bus
 */
adminRouter.get(
  "/bus/:busId/stops",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;
    const adminId = req.adminId;

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        include: {
          stops: {
            orderBy: { stopIndex: "asc" },
            include: {
              boardingPoints: {
                where: { type: "BOARDING" },
                orderBy: { pointOrder: "asc" },
              },
            },
          },
        },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to view this bus" });
      }

      return res.status(200).json({
        message: "Stops fetched successfully",
        count: bus.stops.length,
        stops: bus.stops,
      });
    } catch (e) {
      console.error("Error fetching stops:", e);
      return res.status(500).json({ errorMessage: "Failed to fetch stops" });
    }
  }
);

// ==================== HOLIDAYS MANAGEMENT ====================

/**
 * POST /admin/bus/:busId/holidays
 * Add holiday dates when bus doesn't run
 */
adminRouter.post(
  "/bus/:busId/holidays",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;
    const { dates, reason } = req.body; // dates: array of date strings

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      return res
        .status(400)
        .json({ errorMessage: "At least one date is required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId as string },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res.status(403).json({ errorMessage: "Not authorized" });
      }

      // Create holidays
      const holidays = await Promise.all(
        dates.map((date: string) =>
          prisma.holiday
            .create({
              data: {
                busId: busId as string,
                date: new Date(date),
                reason: reason || null,
                createdBy: adminId as string,
              },
            })
            .catch((e) => {
              // Skip if already exists
              if (e.code === "P2002") return null;
              throw e;
            })
        )
      );

      const created = holidays.filter(Boolean);

      return res.status(201).json({
        message: "Holidays added successfully",
        count: created.length,
        holidays: created,
      });
    } catch (e: any) {
      console.error("Error adding holidays:", e);
      return res.status(500).json({ errorMessage: "Failed to add holidays" });
    }
  }
);

/**
 * GET /admin/bus/:busId/holidays
 * Get all holidays for a bus
 */
adminRouter.get(
  "/bus/:busId/holidays",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;

    try {
      const bus = await prisma.bus.findUnique({
        where: { id: busId as string },
        include: {
          holidays: {
            orderBy: { date: "asc" },
          },
        },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res.status(403).json({ errorMessage: "Not authorized" });
      }

      return res.status(200).json({
        message: "Holidays fetched successfully",
        count: bus.holidays.length,
        holidays: bus.holidays,
      });
    } catch (e) {
      console.error("Error fetching holidays:", e);
      return res.status(500).json({ errorMessage: "Failed to fetch holidays" });
    }
  }
);

/**
 * DELETE /admin/holiday/:holidayId
 * Delete a holiday
 */
adminRouter.delete(
  "/holiday/:holidayId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { holidayId } = req.params;

    try {
      const holiday = await prisma.holiday.findUnique({
        where: { id: holidayId as string },
        include: { bus: true },
      });

      if (!holiday) {
        return res.status(404).json({ errorMessage: "Holiday not found" });
      }

      if (holiday.bus.adminId !== adminId) {
        return res.status(403).json({ errorMessage: "Not authorized" });
      }

      await prisma.holiday.delete({
        where: { id: holidayId as string },
      });

      return res.status(200).json({
        message: "Holiday deleted successfully",
      });
    } catch (e) {
      console.error("Error deleting holiday:", e);
      return res.status(500).json({ errorMessage: "Failed to delete holiday" });
    }
  }
);

// ==================== TRIPS MANAGEMENT ====================

/**
 * POST /admin/bus/:busId/trips
 * Create trips for a bus (can create multiple trips at once)
 */
adminRouter.post(
  "/bus/:busId/trips",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;
    const { trips } = req.body; // Array of trip objects with dates

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    if (!trips || !Array.isArray(trips) || trips.length === 0) {
      return res
        .status(400)
        .json({ errorMessage: "At least one trip is required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        include: {
          stops: true,
        },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to modify this bus" });
      }

      if (bus.stops.length < 2) {
        return res.status(400).json({
          errorMessage: "Bus must have at least 2 stops before creating trips",
        });
      }

      // Create trips
      const createdTrips = await Promise.all(
        trips.map((trip: any) =>
          prisma.trip.create({
            data: {
              busId,
              tripDate: new Date(trip.tripDate),
              status: trip.status || "SCHEDULED",
            },
          })
        )
      );

      return res.status(201).json({
        message: "Trips created successfully",
        count: createdTrips.length,
        trips: createdTrips,
      });
    } catch (e: any) {
      console.error("Error creating trips:", e);

      if (e.code === "P2002") {
        return res.status(400).json({
          errorMessage: "Trip already exists for this bus and date",
        });
      }

      return res
        .status(500)
        .json({ errorMessage: "Failed to create trips", details: e.message });
    }
  }
);

/**
 * GET /admin/bus/:busId/trips
 * Get all trips for a bus
 */
adminRouter.get(
  "/bus/:busId/trips",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;
    const adminId = req.adminId;
    const { status, startDate, endDate } = req.query;

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to view this bus" });
      }

      // Build where clause
      const where: any = { busId };

      if (status) {
        where.status = status;
      }

      if (startDate || endDate) {
        where.tripDate = {};
        if (startDate) {
          where.tripDate.gte = new Date(startDate as string);
        }
        if (endDate) {
          where.tripDate.lte = new Date(endDate as string);
        }
      }

      const trips = await prisma.trip.findMany({
        where,
        include: {
          _count: {
            select: {
              bookings: true,
              bookingGroups: true,
            },
          },
        },
        orderBy: { tripDate: "asc" },
      });

      return res.status(200).json({
        message: "Trips fetched successfully",
        count: trips.length,
        trips: trips.map((trip) => ({
          id: trip.id,
          tripDate: trip.tripDate,
          status: trip.status,
          bookingCount: trip._count.bookingGroups,
          seatsBooked: trip._count.bookings,
          createdAt: trip.createdAt,
        })),
      });
    } catch (e) {
      console.error("Error fetching trips:", e);
      return res.status(500).json({ errorMessage: "Failed to fetch trips" });
    }
  }
);

/**
 * PATCH /admin/trip/:tripId/status
 * Update trip status (SCHEDULED, ONGOING, COMPLETED, CANCELLED)
 */
adminRouter.patch(
  "/trip/:tripId/status",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { tripId } = req.params;
    const { status } = req.body;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!tripId) {
      return res.status(400).json({ errorMessage: "Trip ID is required" });
    }

    if (
      !status ||
      !["SCHEDULED", "ONGOING", "COMPLETED", "CANCELLED"].includes(status)
    ) {
      return res.status(400).json({ errorMessage: "Invalid status" });
    }

    try {
      // Find trip and verify ownership
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        include: {
          bus: true,
        },
      });

      if (!trip) {
        return res.status(404).json({ errorMessage: "Trip not found" });
      }

      if (trip.bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to modify this trip" });
      }

      // Update trip status
      const updatedTrip = await prisma.trip.update({
        where: { id: tripId },
        data: { status },
      });

      return res.status(200).json({
        message: "Trip status updated successfully",
        trip: updatedTrip,
      });
    } catch (e: any) {
      console.error("Error updating trip status:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to update trip status" });
    }
  }
);

/**
 * POST /admin/bus/:busId/cancel-trip
 * Cancel a trip for a specific bus on a specific date
 * This prevents users from seeing or booking this trip
 */
adminRouter.post(
  "/bus/:busId/cancel-trip",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;
    const { tripDate } = req.body;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    if (!tripDate) {
      return res.status(400).json({ errorMessage: "Trip date is required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to modify this bus" });
      }

      // Parse the trip date
      const searchDate = new Date(tripDate);
      searchDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(searchDate.getTime() + 24 * 60 * 60 * 1000);

      // Find the trip for this bus and date
      const trip = await prisma.trip.findFirst({
        where: {
          busId,
          tripDate: {
            gte: searchDate,
            lt: nextDay,
          },
        },
        include: {
          bookingGroups: {
            where: {
              status: "CONFIRMED",
            },
          },
        },
      });

      if (!trip) {
        return res.status(404).json({
          errorMessage: "No trip found for this bus on the specified date",
        });
      }

      // Check if trip already cancelled
      if (trip.status === "CANCELLED") {
        return res.status(400).json({
          errorMessage: "Trip is already cancelled",
        });
      }

      // Check for existing confirmed bookings
      const confirmedBookingsCount = trip.bookingGroups.length;

      if (confirmedBookingsCount > 0) {
        return res.status(400).json({
          errorMessage: `Cannot cancel trip. There are ${confirmedBookingsCount} confirmed booking(s). Please cancel or refund all bookings first.`,
          confirmedBookings: confirmedBookingsCount,
        });
      }

      // Update trip status to CANCELLED
      const updatedTrip = await prisma.trip.update({
        where: { id: trip.id },
        data: { status: "CANCELLED" },
      });

      return res.status(200).json({
        message:
          "Trip cancelled successfully. Users will no longer see or be able to book this trip.",
        trip: {
          id: updatedTrip.id,
          tripDate: updatedTrip.tripDate,
          status: updatedTrip.status,
          busNumber: bus.busNumber,
          busName: bus.name,
        },
      });
    } catch (e: any) {
      console.error("Error cancelling trip:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to cancel trip", details: e.message });
    }
  }
);

/**
 * POST /admin/bus/:busId/reactivate-trip
 * Reactivate a cancelled trip for a specific date
 */
adminRouter.post(
  "/bus/:busId/reactivate-trip",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;
    const { tripDate } = req.body;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    if (!tripDate) {
      return res.status(400).json({ errorMessage: "Trip date is required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to modify this bus" });
      }

      // Parse the trip date
      const searchDate = new Date(tripDate);
      searchDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(searchDate.getTime() + 24 * 60 * 60 * 1000);

      // Find the trip for this bus and date
      const trip = await prisma.trip.findFirst({
        where: {
          busId,
          tripDate: {
            gte: searchDate,
            lt: nextDay,
          },
        },
      });

      if (!trip) {
        return res.status(404).json({
          errorMessage: "No trip found for this bus on the specified date",
        });
      }

      // Check if trip is actually cancelled
      if (trip.status !== "CANCELLED") {
        return res.status(400).json({
          errorMessage: `Trip is currently ${trip.status}. Only cancelled trips can be reactivated.`,
        });
      }

      // Update trip status to SCHEDULED
      const updatedTrip = await prisma.trip.update({
        where: { id: trip.id },
        data: { status: "SCHEDULED" },
      });

      return res.status(200).json({
        message:
          "Trip reactivated successfully. Users can now see and book this trip again.",
        trip: {
          id: updatedTrip.id,
          tripDate: updatedTrip.tripDate,
          status: updatedTrip.status,
          busNumber: bus.busNumber,
          busName: bus.name,
        },
      });
    } catch (e: any) {
      console.error("Error reactivating trip:", e);
      return res.status(500).json({
        errorMessage: "Failed to reactivate trip",
        details: e.message,
      });
    }
  }
);

/**
 * GET /admin/trip/:tripId/bookings
 * View all bookings for a specific trip
 */
adminRouter.get(
  "/trip/:tripId/bookings",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { tripId } = req.params;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!tripId) {
      return res.status(400).json({ errorMessage: "Trip ID is required" });
    }

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        include: {
          bus: true,
          bookingGroups: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              fromStop: true,
              toStop: true,
              bookings: {
                include: {
                  seat: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!trip) {
        return res.status(404).json({ errorMessage: "Trip not found" });
      }

      if (trip.bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to view this trip" });
      }

      // Calculate revenue and statistics
      const totalRevenue = trip.bookingGroups
        .filter((bg) => bg.status === "CONFIRMED")
        .reduce((sum, bg) => sum + bg.totalPrice, 0);

      const totalBookings = trip.bookingGroups.length;
      const confirmedBookings = trip.bookingGroups.filter(
        (bg) => bg.status === "CONFIRMED"
      ).length;
      const cancelledBookings = trip.bookingGroups.filter(
        (bg) => bg.status === "CANCELLED"
      ).length;

      return res.status(200).json({
        message: "Trip bookings fetched successfully",
        trip: {
          id: trip.id,
          tripDate: trip.tripDate,
          status: trip.status,
          busNumber: trip.bus.busNumber,
          busName: trip.bus.name,
        },
        statistics: {
          totalBookings,
          confirmedBookings,
          cancelledBookings,
          totalRevenue,
          totalSeatsBooked: trip.bookingGroups
            .filter((bg) => bg.status === "CONFIRMED")
            .reduce((sum, bg) => sum + bg.bookings.length, 0),
          availableSeats:
            trip.bus.totalSeats -
            trip.bookingGroups
              .filter((bg) => bg.status === "CONFIRMED")
              .reduce((sum, bg) => sum + bg.bookings.length, 0),
        },
        bookings: trip.bookingGroups.map((group) => ({
          bookingGroupId: group.id,
          status: group.status,
          totalPrice: group.totalPrice,
          bookedAt: group.createdAt,
          passenger: {
            id: group.user.id,
            name: group.user.name,
            email: group.user.email,
          },
          route: {
            from: group.fromStop.name,
            to: group.toStop.name,
          },
          seats: group.bookings.map((b) => ({
            seatNumber: b.seat.seatNumber,
            type: b.seat.type,
            level: b.seat.level,
          })),
          seatCount: group.bookings.length,
        })),
      });
    } catch (e) {
      console.error("Error fetching trip bookings:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch trip bookings" });
    }
  }
);

// ==================== DASHBOARD & ANALYTICS ====================

/**
 * GET /admin/dashboard
 * Get admin dashboard statistics
 */
adminRouter.get(
  "/dashboard",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const adminProfile = await prisma.user.findUnique({
        where: { id: adminId },
        select: {
          name: true,
          busServiceName: true,
        },
      });

      // Get all buses count
      const totalBuses = await prisma.bus.count({
        where: { adminId },
      });

      // Get total trips
      const totalTrips = await prisma.trip.count({
        where: {
          bus: {
            adminId,
          },
        },
      });

      // Get upcoming trips
      const upcomingTrips = await prisma.trip.count({
        where: {
          bus: {
            adminId,
          },
          tripDate: {
            gte: new Date(),
          },
          status: {
            in: ["SCHEDULED", "ONGOING"],
          },
        },
      });

      // Get total bookings
      const totalBookings = await prisma.bookingGroup.count({
        where: {
          trip: {
            bus: {
              adminId,
            },
          },
        },
      });

      // Get confirmed bookings
      const confirmedBookings = await prisma.bookingGroup.count({
        where: {
          trip: {
            bus: {
              adminId,
            },
          },
          status: "CONFIRMED",
        },
      });

      // Calculate total revenue
      const bookingGroups = await prisma.bookingGroup.findMany({
        where: {
          trip: {
            bus: {
              adminId,
            },
          },
          status: "CONFIRMED",
        },
        select: {
          totalPrice: true,
        },
      });

      const totalRevenue = bookingGroups.reduce(
        (sum, bg) => sum + bg.totalPrice,
        0
      );

      // Get recent bookings
      const recentBookings = await prisma.bookingGroup.findMany({
        where: {
          trip: {
            bus: {
              adminId,
            },
          },
        },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          trip: {
            select: {
              tripDate: true,
              bus: {
                select: {
                  busNumber: true,
                  name: true,
                },
              },
            },
          },
          fromStop: {
            select: {
              name: true,
            },
          },
          toStop: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      // Get bus-wise statistics
      const buses = await prisma.bus.findMany({
        where: { adminId },
        include: {
          _count: {
            select: {
              trips: true,
            },
          },
        },
      });

      const busStats = await Promise.all(
        buses.map(async (bus) => {
          const bookingCount = await prisma.bookingGroup.count({
            where: {
              trip: {
                busId: bus.id,
              },
              status: "CONFIRMED",
            },
          });

          const revenue = await prisma.bookingGroup.aggregate({
            where: {
              trip: {
                busId: bus.id,
              },
              status: "CONFIRMED",
            },
            _sum: {
              totalPrice: true,
            },
          });

          return {
            busId: bus.id,
            busNumber: bus.busNumber,
            busName: bus.name,
            totalTrips: bus._count.trips,
            totalBookings: bookingCount,
            totalRevenue: revenue._sum.totalPrice || 0,
          };
        })
      );

      return res.status(200).json({
        message: "Dashboard data fetched successfully",
        serviceProfile: {
          adminName: adminProfile?.name || "",
          busServiceName: adminProfile?.busServiceName || "Ankush Travels",
        },
        overview: {
          totalBuses,
          totalTrips,
          upcomingTrips,
          totalBookings,
          confirmedBookings,
          totalRevenue,
        },
        busStatistics: busStats,
        recentBookings: recentBookings.map((booking) => ({
          bookingGroupId: booking.id,
          passengerName: booking.user.name,
          passengerEmail: booking.user.email,
          bus: `${booking.trip.bus.busNumber} - ${booking.trip.bus.name}`,
          route: `${booking.fromStop.name} → ${booking.toStop.name}`,
          tripDate: booking.trip.tripDate,
          amount: booking.totalPrice,
          status: booking.status,
          bookedAt: booking.createdAt,
        })),
      });
    } catch (e) {
      console.error("Error fetching dashboard data:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch dashboard data" });
    }
  }
);

/**
 * GET /admin/analytics
 * Get detailed analytics and reports
 */
adminRouter.get(
  "/analytics",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { startDate, endDate, busId } = req.query;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const where: any = {
        trip: {
          bus: {
            adminId,
          },
        },
        status: "CONFIRMED",
      };

      // Add date filter if provided
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate as string);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate as string);
        }
      }

      // Add bus filter if provided
      if (busId) {
        where.trip.busId = busId;
      }

      // Get bookings for the period
      const bookings = await prisma.bookingGroup.findMany({
        where,
        include: {
          trip: {
            include: {
              bus: true,
            },
          },
          bookings: true,
        },
      });

      // Calculate analytics
      const totalRevenue = bookings.reduce((sum, b) => sum + b.totalPrice, 0);
      const totalBookings = bookings.length;
      const totalSeatsBooked = bookings.reduce(
        (sum, b) => sum + b.bookings.length,
        0
      );

      // Group by date
      const revenueByDate: Record<string, number> = {};
      const bookingsByDate: Record<string, number> = {};

      bookings.forEach((booking) => {
        const date = booking.createdAt.toISOString().split("T")[0];
        if (date) {
          revenueByDate[date] = (revenueByDate[date] || 0) + booking.totalPrice;
          bookingsByDate[date] = (bookingsByDate[date] || 0) + 1;
        }
      });

      // Group by bus
      const revenueByBus: Record<string, any> = {};

      bookings.forEach((booking) => {
        const busKey = booking.trip.bus.id;
        if (!revenueByBus[busKey]) {
          revenueByBus[busKey] = {
            busId: booking.trip.bus.id,
            busNumber: booking.trip.bus.busNumber,
            busName: booking.trip.bus.name,
            revenue: 0,
            bookings: 0,
            seatsBooked: 0,
          };
        }
        revenueByBus[busKey].revenue += booking.totalPrice;
        revenueByBus[busKey].bookings += 1;
        revenueByBus[busKey].seatsBooked += booking.bookings.length;
      });

      return res.status(200).json({
        message: "Analytics fetched successfully",
        summary: {
          totalRevenue,
          totalBookings,
          totalSeatsBooked,
          averageBookingValue:
            totalBookings > 0 ? totalRevenue / totalBookings : 0,
        },
        revenueByDate: Object.entries(revenueByDate)
          .map(([date, revenue]) => ({
            date,
            revenue,
            bookings: bookingsByDate[date],
          }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        revenueByBus: Object.values(revenueByBus).sort(
          (a: any, b: any) => b.revenue - a.revenue
        ),
      });
    } catch (e) {
      console.error("Error fetching analytics:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch analytics" });
    }
  }
);

// ==================== BUS MANAGEMENT ====================

/**
 * PATCH /admin/bus/:busId
 * Update bus details
 */
adminRouter.patch(
  "/bus/:busId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;
    const { busNumber, name, type, layoutType, gridRows, gridColumns } =
      req.body;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to modify this bus" });
      }

      // Update bus
      const updatedBus = await prisma.bus.update({
        where: { id: busId },
        data: {
          ...(busNumber && { busNumber }),
          ...(name && { name }),
          ...(type && { type }),
          ...(layoutType && { layoutType }),
          ...(gridRows && { gridRows }),
          ...(gridColumns && { gridColumns }),
        },
      });

      return res.status(200).json({
        message: "Bus updated successfully",
        bus: updatedBus,
      });
    } catch (e: any) {
      console.error("Error updating bus:", e);

      if (e.code === "P2002") {
        return res
          .status(400)
          .json({ errorMessage: "Bus number already exists" });
      }

      return res.status(500).json({ errorMessage: "Failed to update bus" });
    }
  }
);

/**
 * DELETE /admin/bus/:busId
 * Delete a bus (and all related data)
 */
adminRouter.delete(
  "/bus/:busId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    const { busId } = req.params;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      // Verify bus exists and belongs to admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        include: {
          trips: {
            include: {
              bookingGroups: {
                where: {
                  status: "CONFIRMED",
                },
              },
            },
          },
        },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to delete this bus" });
      }

      // Check if there are confirmed bookings
      const hasConfirmedBookings = bus.trips.some(
        (trip) => trip.bookingGroups.length > 0
      );

      if (hasConfirmedBookings) {
        return res.status(400).json({
          errorMessage:
            "Cannot delete bus with confirmed bookings. Please cancel all bookings first.",
        });
      }

      // Delete bus (cascade will delete related data)
      await prisma.bus.delete({
        where: { id: busId },
      });

      return res.status(200).json({
        message: "Bus deleted successfully",
      });
    } catch (e: any) {
      console.error("Error deleting bus:", e);
      return res.status(500).json({ errorMessage: "Failed to delete bus" });
    }
  }
);

/**
 * GET /admin/bus/:busId
 * Get detailed information about a specific bus
 */
adminRouter.get(
  "/bus/:busId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;
    const adminId = req.adminId;

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        include: {
          stops: {
            orderBy: { stopIndex: "asc" },
          },
          _count: {
            select: {
              seats: true,
              trips: true,
            },
          },
        },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res
          .status(403)
          .json({ errorMessage: "Not authorized to view this bus" });
      }

      return res.status(200).json({
        message: "Bus details fetched successfully",
        bus: {
          id: bus.id,
          busNumber: bus.busNumber,
          name: bus.name,
          type: bus.type,
          layoutType: bus.layoutType,
          totalSeats: bus.totalSeats,
          gridRows: bus.gridRows,
          gridColumns: bus.gridColumns,
          seatCount: bus._count.seats,
          tripCount: bus._count.trips,
          stops: bus.stops,
          createdAt: bus.createdAt,
          updatedAt: bus.updatedAt,
        },
      });
    } catch (e) {
      console.error("Error fetching bus details:", e);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch bus details" });
    }
  }
);

/**
 * POST /admin/bus/:busId/amenities
 * Add/update amenities for a bus
 */
adminRouter.post(
  "/bus/:busId/amenities",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;
    const {
      hasWifi,
      hasAC,
      hasCharging,
      hasRestroom,
      hasBlanket,
      hasWaterBottle,
      hasSnacks,
      hasTV,
    } = req.body;

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      // Check if bus exists
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      // Upsert amenities
      const amenities = await prisma.busAmenities.upsert({
        where: { busId },
        update: {
          hasWifi: hasWifi ?? undefined,
          hasAC: hasAC ?? undefined,
          hasCharging: hasCharging ?? undefined,
          hasRestroom: hasRestroom ?? undefined,
          hasBlanket: hasBlanket ?? undefined,
          hasWaterBottle: hasWaterBottle ?? undefined,
          hasSnacks: hasSnacks ?? undefined,
          hasTV: hasTV ?? undefined,
        },
        create: {
          busId,
          hasWifi: hasWifi ?? false,
          hasAC: hasAC ?? false,
          hasCharging: hasCharging ?? false,
          hasRestroom: hasRestroom ?? false,
          hasBlanket: hasBlanket ?? false,
          hasWaterBottle: hasWaterBottle ?? false,
          hasSnacks: hasSnacks ?? false,
          hasTV: hasTV ?? false,
        },
      });

      return res.status(200).json({
        message: "Amenities updated successfully",
        amenities,
      });
    } catch (error) {
      console.error("Error updating amenities:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to update amenities" });
    }
  }
);

/**
 * GET /admin/bus/:busId/amenities
 * Get amenities for a bus
 */
adminRouter.get(
  "/bus/:busId/amenities",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      const amenities = await prisma.busAmenities.findUnique({
        where: { busId },
      });

      if (!amenities) {
        return res.status(404).json({
          errorMessage: "Amenities not found for this bus",
        });
      }

      return res.status(200).json({
        message: "Amenities fetched successfully",
        amenities,
      });
    } catch (error) {
      console.error("Error fetching amenities:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch amenities" });
    }
  }
);

/**
 * DELETE /admin/bus/:busId/amenities
 * Remove amenities for a bus (set all to false)
 */
adminRouter.delete(
  "/bus/:busId/amenities",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;

    if (!busId) {
      return res.status(400).json({ errorMessage: "Bus ID is required" });
    }

    try {
      await prisma.busAmenities.update({
        where: { busId },
        data: {
          hasWifi: false,
          hasAC: false,
          hasCharging: false,
          hasRestroom: false,
          hasBlanket: false,
          hasWaterBottle: false,
          hasSnacks: false,
          hasTV: false,
        },
      });

      return res.status(200).json({
        message: "Amenities removed successfully",
      });
    } catch (error) {
      console.error("Error removing amenities:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to remove amenities" });
    }
  }
);

/**
 * POST /admin/offers
 * Create a new offer
 */
adminRouter.post(
  "/offers",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin ID not found" });
    }

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
      applicableBuses,
    } = req.body;

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
          applicableBuses: parseOptionalStringArray(applicableBuses),
        },
        { id: adminId, role: OfferCreatorRole.ADMIN }
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
 * GET /admin/offers
 * Get all offers with optional filters
 */
adminRouter.get(
  "/offers",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const adminId = req.adminId;
    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin ID not found" });
    }

    const { active, expired, search } = req.query;

    try {
      const now = new Date();

      const offers = await prisma.offer.findMany({
        where: {
          createdBy: adminId,
          creatorRole: OfferCreatorRole.ADMIN,
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
                description: { contains: String(search), mode: "insensitive" },
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
        orderBy: {
          createdAt: "desc",
        },
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
 * GET /admin/offers/:offerId
 * Get details of a specific offer
 */
adminRouter.get(
  "/offers/:offerId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { offerId } = req.params;
    const adminId = req.adminId;

    if (!offerId) {
      return res.status(400).json({ errorMessage: "Offer ID is required" });
    }

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        include: {
          bookingGroups: {
            select: {
              id: true,
              createdAt: true,
              totalPrice: true,
              discountAmount: true,
              finalPrice: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 10,
          },
          _count: {
            select: {
              bookingGroups: true,
            },
          },
        },
      });

      if (!offer) {
        return res.status(404).json({ errorMessage: "Offer not found" });
      }

      if (
        offer.createdBy !== adminId ||
        offer.creatorRole !== OfferCreatorRole.ADMIN
      ) {
        return res
          .status(403)
          .json({ errorMessage: "You can only view your own offers" });
      }

      return res.status(200).json({
        message: "Offer details fetched successfully",
        offer: {
          ...offer,
          usageCount: offer._count.bookingGroups,
          recentBookings: offer.bookingGroups,
        },
      });
    } catch (error) {
      console.error("Error fetching offer details:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch offer details" });
    }
  }
);

/**
 * PATCH /admin/offers/:offerId
 * Update an offer
 */
adminRouter.patch(
  "/offers/:offerId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { offerId } = req.params;
    const adminId = req.adminId;
    const {
      description,
      discountValue,
      maxDiscount,
      validFrom,
      validUntil,
      minBookingAmount,
      usageLimit,
      applicableBuses,
      isActive,
    } = req.body;

    if (!offerId) {
      return res.status(400).json({ errorMessage: "Offer ID is required" });
    }

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const existingOffer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!existingOffer) {
        return res.status(404).json({ errorMessage: "Offer not found" });
      }

      if (
        existingOffer.creatorRole !== OfferCreatorRole.ADMIN ||
        existingOffer.createdBy !== adminId
      ) {
        return res
          .status(403)
          .json({ errorMessage: "You can only update your own offers" });
      }

      const updateData: Record<string, unknown> = {};

      if (description) {
        updateData.description = description;
      }

      if (discountValue !== undefined) {
        const parsedDiscountValue = Number(discountValue);
        if (Number.isNaN(parsedDiscountValue) || parsedDiscountValue <= 0) {
          return res.status(400).json({
            errorMessage: "Discount value must be a positive number",
          });
        }
        updateData.discountValue = parsedDiscountValue;
      }

      if (maxDiscount !== undefined) {
        const parsedMaxDiscount = parseOptionalNumber(maxDiscount);
        if (parsedMaxDiscount !== null) {
          if (Number.isNaN(parsedMaxDiscount) || parsedMaxDiscount <= 0) {
            return res.status(400).json({
              errorMessage: "Max discount must be a positive number",
            });
          }
        }
        updateData.maxDiscount = parsedMaxDiscount;
      }

      if (validFrom) {
        const parsedValidFrom = new Date(validFrom);
        if (Number.isNaN(parsedValidFrom.getTime())) {
          return res
            .status(400)
            .json({ errorMessage: "Valid from must be a valid date" });
        }
        updateData.validFrom = parsedValidFrom;
      }

      if (validUntil) {
        const parsedValidUntil = new Date(validUntil);
        if (Number.isNaN(parsedValidUntil.getTime())) {
          return res
            .status(400)
            .json({ errorMessage: "Valid until must be a valid date" });
        }
        updateData.validUntil = parsedValidUntil;
      }

      if (minBookingAmount !== undefined) {
        const parsedMinBooking = parseOptionalNumber(minBookingAmount);
        if (parsedMinBooking !== null) {
          if (Number.isNaN(parsedMinBooking) || parsedMinBooking <= 0) {
            return res.status(400).json({
              errorMessage: "Minimum booking amount must be a positive number",
            });
          }
        }
        updateData.minBookingAmount = parsedMinBooking;
      }

      if (usageLimit !== undefined) {
        const parsedUsageLimit = parseOptionalNumber(usageLimit);
        if (parsedUsageLimit !== null) {
          if (
            Number.isNaN(parsedUsageLimit) ||
            parsedUsageLimit <= 0 ||
            !Number.isInteger(parsedUsageLimit)
          ) {
            return res.status(400).json({
              errorMessage: "Usage limit must be a positive whole number",
            });
          }
        }
        updateData.usageLimit = parsedUsageLimit;
      }

      if (applicableBuses !== undefined) {
        try {
          updateData.applicableBuses = await sanitizeApplicableBusesForAdmin(
            parseOptionalStringArray(applicableBuses),
            adminId
          );
        } catch (error) {
          return handleOfferError(error, res);
        }
      }

      if (typeof isActive === "boolean") {
        updateData.isActive = isActive;
      }

      if (updateData.validFrom && updateData.validUntil) {
        const validFromDate = updateData.validFrom as Date;
        const validUntilDate = updateData.validUntil as Date;
        if (validUntilDate <= validFromDate) {
          return res.status(400).json({
            errorMessage: "Valid until must be later than valid from",
          });
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          errorMessage: "No valid fields provided for update",
        });
      }

      const offer = await prisma.offer.update({
        where: { id: offerId },
        data: updateData,
      });

      return res.status(200).json({
        message: "Offer updated successfully",
        offer,
      });
    } catch (error) {
      console.error("Error updating offer:", error);
      return res.status(500).json({ errorMessage: "Failed to update offer" });
    }
  }
);

/**
 * DELETE /admin/offers/:offerId
 * Deactivate an offer
 */
adminRouter.delete(
  "/offers/:offerId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { offerId } = req.params;
    const adminId = req.adminId;

    if (!offerId) {
      return res.status(400).json({ errorMessage: "Offer ID is required" });
    }

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const existingOffer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!existingOffer) {
        return res.status(404).json({ errorMessage: "Offer not found" });
      }

      if (
        existingOffer.creatorRole !== OfferCreatorRole.ADMIN ||
        existingOffer.createdBy !== adminId
      ) {
        return res
          .status(403)
          .json({ errorMessage: "You can only update your own offers" });
      }

      const offer = await prisma.offer.update({
        where: { id: offerId },
        data: {
          isActive: false,
        },
      });

      return res.status(200).json({
        message: "Offer deactivated successfully",
        offer,
      });
    } catch (error) {
      console.error("Error deactivating offer:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to deactivate offer" });
    }
  }
);

/**
 * GET /admin/offers/:offerId/usage-stats
 * Get usage statistics for an offer
 */
adminRouter.get(
  "/offers/:offerId/usage-stats",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { offerId } = req.params;
    const adminId = req.adminId;

    if (!offerId) {
      return res.status(400).json({ errorMessage: "Offer ID is required" });
    }

    if (!adminId) {
      return res.status(401).json({ errorMessage: "Admin not authenticated" });
    }

    try {
      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!offer) {
        return res.status(404).json({ errorMessage: "Offer not found" });
      }

      if (
        offer.creatorRole !== OfferCreatorRole.ADMIN ||
        offer.createdBy !== adminId
      ) {
        return res
          .status(403)
          .json({ errorMessage: "You can only view your own offers" });
      }

      const stats = await prisma.bookingGroup.aggregate({
        where: {
          offerId,
        },
        _count: true,
        _sum: {
          discountAmount: true,
          totalPrice: true,
          finalPrice: true,
        },
      });

      return res.status(200).json({
        message: "Usage stats fetched successfully",
        stats: {
          offerCode: offer.code,
          totalUsage: stats._count,
          usageLimit: offer.usageLimit,
          remainingUsage: offer.usageLimit
            ? offer.usageLimit - stats._count
            : null,
          totalDiscountGiven: stats._sum.discountAmount || 0,
          totalRevenue: stats._sum.finalPrice || 0,
          totalOriginalAmount: stats._sum.totalPrice || 0,
        },
      });
    } catch (error) {
      console.error("Error fetching usage stats:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch usage stats" });
    }
  }
);

// ==================== BUS IMAGE UPLOAD ENDPOINTS ====================

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB total limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow jpg and png
    if (file.mimetype === "image/jpeg" || file.mimetype === "image/png") {
      cb(null, true);
    } else {
      cb(new Error("Only JPG and PNG images are allowed"));
    }
  },
});

/**
 * POST /admin/buses/:busId/images
 * Upload images for a bus (max 10 images)
 */
adminRouter.post(
  "/buses/:busId/images",
  authenticateAdmin,
  upload.array("images", 10), // Max 10 images
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;
    const adminId = req.adminId;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ errorMessage: "No images provided" });
    }

    if (!busId || !adminId) {
      return res.status(400).json({ errorMessage: "Invalid request" });
    }

    try {
      // Verify bus belongs to this admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        include: { images: true },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res.status(403).json({
          errorMessage: "You can only upload images for your own buses",
        });
      }

      // Check if adding these images would exceed 10 total
      if (bus.images.length + files.length > 10) {
        return res.status(400).json({
          errorMessage: `Cannot upload ${files.length} images. Maximum 10 images allowed per bus. Current: ${bus.images.length}`,
        });
      }

      // Upload images to Cloudinary
      const uploadPromises = files.map((file) => {
        return new Promise<{ url: string; publicId: string }>(
          (resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: `bus_images/${busId}`,
                resource_type: "image",
                transformation: [
                  { width: 1200, height: 800, crop: "limit" }, // Limit max size
                  { quality: "auto:good" }, // Optimize quality
                ],
              },
              (error, result) => {
                if (error) {
                  console.error("Cloudinary upload error:", error);
                  reject(error);
                } else {
                  console.log(
                    "✅ Image uploaded to Cloudinary:",
                    result!.secure_url
                  );
                  resolve({
                    url: result!.secure_url,
                    publicId: result!.public_id,
                  });
                }
              }
            );
            uploadStream.end(file.buffer);
          }
        );
      });

      const uploadedImages = await Promise.all(uploadPromises);

      // Save image records to database
      const imageRecords = await Promise.all(
        uploadedImages.map((img) =>
          prisma.busImage.create({
            data: {
              busId,
              imageUrl: img.url,
              publicId: img.publicId,
              uploadedBy: adminId!,
            },
          })
        )
      );

      return res.status(201).json({
        message: `${imageRecords.length} image(s) uploaded successfully`,
        images: imageRecords,
        totalImages: bus.images.length + imageRecords.length,
      });
    } catch (error: any) {
      console.error("Error uploading images:", error);
      return res.status(500).json({
        errorMessage: error.message || "Failed to upload images",
      });
    }
  }
);

/**
 * GET /admin/buses/:busId/images
 * Get all images for a bus
 */
adminRouter.get(
  "/buses/:busId/images",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId } = req.params;
    const adminId = req.adminId;

    if (!busId || !adminId) {
      return res.status(400).json({ errorMessage: "Invalid request" });
    }

    try {
      // Verify bus belongs to this admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
        include: {
          images: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res.status(403).json({
          errorMessage: "You can only view images for your own buses",
        });
      }

      return res.status(200).json({
        message: "Images fetched successfully",
        images: bus.images,
        totalImages: bus.images.length,
        maxImages: 10,
      });
    } catch (error) {
      console.error("Error fetching images:", error);
      return res.status(500).json({ errorMessage: "Failed to fetch images" });
    }
  }
);

/**
 * DELETE /admin/buses/:busId/images/:imageId
 * Delete a bus image
 */
adminRouter.delete(
  "/buses/:busId/images/:imageId",
  authenticateAdmin,
  async (req: AuthRequest, res): Promise<any> => {
    const { busId, imageId } = req.params;
    const adminId = req.adminId;

    if (!busId || !imageId || !adminId) {
      return res.status(400).json({ errorMessage: "Invalid request" });
    }

    try {
      // Verify bus belongs to this admin
      const bus = await prisma.bus.findUnique({
        where: { id: busId },
      });

      if (!bus) {
        return res.status(404).json({ errorMessage: "Bus not found" });
      }

      if (bus.adminId !== adminId) {
        return res.status(403).json({
          errorMessage: "You can only delete images from your own buses",
        });
      }

      // Get image record
      const image = await prisma.busImage.findUnique({
        where: { id: imageId },
      });

      if (!image) {
        return res.status(404).json({ errorMessage: "Image not found" });
      }

      if (image.busId !== busId) {
        return res.status(400).json({
          errorMessage: "Image does not belong to this bus",
        });
      }

      // Delete from Cloudinary
      await cloudinary.uploader.destroy(image.publicId);

      // Delete from database
      await prisma.busImage.delete({
        where: { id: imageId },
      });

      return res.status(200).json({
        message: "Image deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting image:", error);
      return res.status(500).json({ errorMessage: "Failed to delete image" });
    }
  }
);

export default adminRouter;
