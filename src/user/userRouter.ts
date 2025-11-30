import express from "express";
import jwt from "jsonwebtoken";
import z from "zod";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { prisma } from "../index.js";
import "dotenv/config";
import { signupSchema } from "../schemas/signupSchema.js";
import {
  busSearchSchema,
  bookTicketSchema,
  cancelTicketSchema,
  busInfoQuerySchema,
} from "../schemas/busSearchSchema.js";
import cookieParser from "cookie-parser";
import { sendGmail, sendPasswordResetOTP } from "./sendmail.js";
import {
  createNotification,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyOfferApplied,
  getUserNotifications,
  getUnreadCount,
  markNotificationAsRead,
} from "../services/notificationService.js";
import type { TicketData } from "../services/pdfService.js";
import {
  applyCouponSchema,
  enhancedSearchSchema,
  initiatePaymentSchema,
  verifyPaymentSchema,
  confirmBookingSchema,
} from "../schemas/busSearchSchema.js";
import type { Offer } from "@prisma/client";
import {
  CurrencyCode,
  DiscountType,
  OfferCreatorRole,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import Razorpay from "razorpay";
import crypto from "crypto";
import axios from "axios";
import { getPaymentConfig } from "../config/paymentConfig.js";
import {
  calculatePaymentAmounts,
  convertToMinorUnits,
} from "../services/payment/currencyService.js";

const JWT_SECRET = process.env.userSecret;
const app = express();
app.use(cookieParser());
export const userRouter = express.Router();

// Extend Express Request type to include userId
interface AuthRequest extends express.Request {
  userId?: string;
}

// Middleware to verify JWT token and extract userId
const authenticateUser = async (req: AuthRequest, res: any, next: any) => {
  let token = req.cookies.token;

  // Fallback to Authorization header
  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    return res.status(401).json({ errorMessage: "Authentication required" });
  }

  if (!JWT_SECRET) {
    return res.status(500).json({ errorMessage: "Internal server error" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as string;
    req.userId = decoded; // userId is the payload
    next();
  } catch (e) {
    return res.status(401).json({ errorMessage: "Invalid or expired token" });
  }
};

const calculateDiscountAmount = (
  offer: {
    discountType: DiscountType;
    discountValue: number;
    maxDiscount: number | null;
  },
  totalAmount: number
) => {
  let discount = 0;

  if (offer.discountType === DiscountType.PERCENTAGE) {
    discount = (totalAmount * offer.discountValue) / 100;
    if (offer.maxDiscount) {
      discount = Math.min(discount, offer.maxDiscount);
    }
  } else {
    discount = offer.discountValue;
  }

  return Math.max(0, Math.min(discount, totalAmount));
};

const hasRemainingUsage = (offer: {
  usageLimit: number | null;
  usageCount: number;
}) => {
  if (!offer.usageLimit) {
    return true;
  }

  return offer.usageCount < offer.usageLimit;
};

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;
type BookingRequestInput = z.infer<typeof bookTicketSchema>;

interface BookingPreparationResult {
  trip: any;
  fromStop: any;
  toStop: any;
  seats: any[];
  boardingPoint: any;
  droppingPoint: any;
  passengers: BookingRequestInput["passengers"];
  totalPrice: number;
  discountAmount: number;
  finalPrice: number;
  appliedOffer: Offer | null;
  offerDiscountReason?: string;
  bookingPayload: BookingRequestInput;
  isReturnTrip: boolean;
  seatFares: Record<string, number>;
}

const roundToTwo = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const appendQueryParams = (
  baseUrl: string,
  params: Record<string, string | number>
) => {
  const serialized = new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        acc[key] = String(value);
        return acc;
      },
      {}
    )
  ).toString();

  if (!baseUrl) {
    return `?${serialized}`;
  }

  return baseUrl.includes("?")
    ? `${baseUrl}&${serialized}`
    : `${baseUrl}?${serialized}`;
};

const prepareBookingDetails = async (
  client: PrismaClientOrTransaction,
  payload: BookingRequestInput,
  userId: string
): Promise<BookingPreparationResult> => {
  const {
    tripId,
    fromStopId,
    toStopId,
    seatIds,
    passengers,
    couponCode,
    boardingPointId,
    droppingPointId,
  } = payload;

  const trip = await client.trip.findUnique({
    where: { id: tripId },
    include: {
      bus: {
        include: {
          stops: {
            include: {
              boardingPoints: true,
            },
          },
          seats: {
            where: { isActive: true },
          },
        },
      },
    },
  });

  if (!trip) {
    throw new Error("Trip not found");
  }

  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") {
    throw new Error("Trip is not available for booking");
  }

  const now = new Date();
  const tripDate = new Date(trip.tripDate);
  tripDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (tripDate < today) {
    throw new Error("Cannot book tickets for past dates");
  }

  const fromStop = trip.bus.stops.find((s) => s.id === fromStopId);
  const toStop = trip.bus.stops.find((s) => s.id === toStopId);

  if (!fromStop || !toStop) {
    throw new Error("Stops not found");
  }

  if (fromStop.stopIndex === toStop.stopIndex) {
    throw new Error("From and to stops cannot be the same");
  }

  const isReturnTrip = fromStop.stopIndex > toStop.stopIndex;

  if (tripDate.getTime() === today.getTime()) {
    const departureTime = isReturnTrip
      ? fromStop.returnDepartureTime || fromStop.departureTime
      : fromStop.departureTime;

    if (departureTime) {
      const [hours, minutes] = departureTime.split(":").map(Number);
      if (hours !== undefined && minutes !== undefined) {
        const departureDateTime = new Date(tripDate);
        departureDateTime.setHours(hours, minutes, 0, 0);

        // 30-minute cutoff rule
        const cutoffTime = new Date(departureDateTime.getTime() - 30 * 60000);

        if (now > cutoffTime) {
          // If now is past the cutoff (e.g. 15:31 for 16:00 bus)
          // Check if it's actually departed or just booking closed
          if (now > departureDateTime) {
            throw new Error(
              "Cannot book tickets for buses that have already departed"
            );
          } else {
            throw new Error("Booking closes 30 minutes before departure.");
          }
        }
      }
    }
  }

  const boardingPoint = await client.stopPoint.findUnique({
    where: { id: boardingPointId },
  });

  if (!boardingPoint || boardingPoint.stopId !== fromStopId) {
    throw new Error("Invalid boarding point selected");
  }

  if (boardingPoint.type !== "BOARDING") {
    throw new Error("Selected boarding point is not valid for boarding");
  }

  const droppingPoint = await client.stopPoint.findUnique({
    where: { id: droppingPointId },
  });

  if (!droppingPoint || droppingPoint.stopId !== toStopId) {
    throw new Error("Invalid dropping point selected");
  }

  const seats = await client.seat.findMany({
    where: {
      id: { in: seatIds },
      busId: trip.busId,
      isActive: true,
    },
  });

  if (seats.length !== seatIds.length) {
    throw new Error("One or more seats are invalid or inactive");
  }

  const existingBookings = await client.booking.findMany({
    where: {
      tripId,
      seatId: { in: seatIds },
      status: "CONFIRMED",
    },
    include: {
      group: {
        select: {
          fromStop: { select: { stopIndex: true } },
          toStop: { select: { stopIndex: true } },
        },
      },
    },
  });

  const minIndex = Math.min(fromStop.stopIndex, toStop.stopIndex);
  const maxIndex = Math.max(fromStop.stopIndex, toStop.stopIndex);

  const conflictingBookings = existingBookings.filter((booking) => {
    const bookingFromIdx = booking.group.fromStop.stopIndex;
    const bookingToIdx = booking.group.toStop.stopIndex;

    // Check if booking is in the same direction
    const bookingIsReturnTrip = bookingFromIdx > bookingToIdx;
    if (bookingIsReturnTrip !== isReturnTrip) {
      return false;
    }

    const bookingMin = Math.min(bookingFromIdx, bookingToIdx);
    const bookingMax = Math.max(bookingFromIdx, bookingToIdx);

    return minIndex < bookingMax && maxIndex > bookingMin;
  });

  if (conflictingBookings.length > 0) {
    const conflictedSeats = conflictingBookings
      .map((b) => {
        const seat = seats.find((s) => s.id === b.seatId);
        return seat?.seatNumber || b.seatId;
      })
      .join(", ");

    throw new Error(
      `Seat(s) ${conflictedSeats} are already booked for this route segment. Please select different seats.`
    );
  }

  const getCumulativePriceForSeat = (stop: any, seat: any) => {
    if (!stop) {
      return 0;
    }

    const level = (seat.level || "").toUpperCase();
    const type = (seat.type || "").toUpperCase();

    if (level === "LOWER" && type === "SEATER") {
      return stop.lowerSeaterPrice ?? stop.priceFromOrigin ?? 0;
    }

    if (level === "LOWER" && type === "SLEEPER") {
      return stop.lowerSleeperPrice ?? stop.priceFromOrigin ?? 0;
    }

    if (level === "UPPER" && type === "SLEEPER") {
      return stop.upperSleeperPrice ?? stop.priceFromOrigin ?? 0;
    }

    if (level === "UPPER" && type === "SEATER") {
      return stop.upperSeaterPrice ?? stop.priceFromOrigin ?? 0;
    }

    return stop.priceFromOrigin ?? 0;
  };

  const seatFares: Record<string, number> = {};
  const totalPrice = seats.reduce((sum, seat) => {
    const fromPrice = getCumulativePriceForSeat(fromStop, seat);
    const toPrice = getCumulativePriceForSeat(toStop, seat);
    const seatSpecificFare = Math.abs(toPrice - fromPrice);

    const fare =
      Number.isFinite(seatSpecificFare) && seatSpecificFare > 0
        ? seatSpecificFare
        : Math.abs(
            (toStop.priceFromOrigin ?? 0) - (fromStop.priceFromOrigin ?? 0)
          );

    const normalizedFare = Number.isFinite(fare) ? fare : 0;
    seatFares[seat.id] = normalizedFare;
    return sum + normalizedFare;
  }, 0);

  let appliedOffer: Offer | null = null;
  let discountAmount = 0;
  let offerDiscountReason: string | undefined;

  if (couponCode) {
    const offer = await client.offer.findUnique({
      where: { code: couponCode.toUpperCase() },
    });

    if (offer && offer.isActive) {
      const nowDate = new Date();

      if (nowDate >= offer.validFrom && nowDate <= offer.validUntil) {
        if (hasRemainingUsage(offer)) {
          if (!offer.minBookingAmount || totalPrice >= offer.minBookingAmount) {
            const isAdminCoupon = offer.creatorRole === OfferCreatorRole.ADMIN;

            if (
              (!isAdminCoupon || trip.bus.adminId === offer.createdBy) &&
              (offer.applicableBuses.length === 0 ||
                offer.applicableBuses.includes(trip.busId))
            ) {
              discountAmount = calculateDiscountAmount(offer, totalPrice);
              appliedOffer = offer;
            } else {
              offerDiscountReason =
                "Coupon is not applicable to this bus or operator.";
            }
          } else {
            offerDiscountReason =
              "Booking amount does not meet minimum requirement.";
          }
        } else {
          offerDiscountReason = "Coupon usage limit reached.";
        }
      } else {
        offerDiscountReason = "Coupon is not currently valid.";
      }
    } else if (!offer) {
      offerDiscountReason = "Coupon not found or inactive.";
    }
  }

  const finalPrice = Math.max(0, roundToTwo(totalPrice - discountAmount));

  return {
    trip,
    fromStop,
    toStop,
    seats,
    boardingPoint,
    droppingPoint,
    passengers,
    totalPrice: roundToTwo(totalPrice),
    discountAmount: roundToTwo(discountAmount),
    finalPrice,
    appliedOffer,
    ...(offerDiscountReason ? { offerDiscountReason } : {}),
    bookingPayload: payload,
    isReturnTrip,
    seatFares,
  };
};
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
    return res
      .status(400)
      .json({ errorMessage: "Email and password are required" });
  }
  let userFound: any;
  try {
    userFound = await prisma.user.findFirst({
      where: {
        email,
        verified: true,
        role: "USER",
      },
    });
  } catch (e) {
    console.log("error while searching user");
  }

  if (!userFound) {
    return res.status(401).json({ errorMessage: "Invalid credentials" });
  }
  const validpass = await bcrypt.compare(password, userFound.password);
  if (!validpass) {
    return res.status(401).json({ errorMessage: "Invalid credentials" });
  }

  //  send the cookie
  if (!JWT_SECRET) {
    console.log("early return because secret not found");
    return res.json({ errorMessage: "internal server error" });
  }
  const token = jwt.sign((userFound?.id).toString(), JWT_SECRET);

  // Cookie configuration for cross-origin requests
  const isProduction = process.env.NODE_ENV === "production";

  // Set cookie AND return token in response body for mobile compatibility
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProduction, // Only use secure in production (HTTPS)
    sameSite: isProduction ? "lax" : "lax", // Use "lax" for better iOS compatibility (not "none")
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/", // Important: ensure cookie is sent to all paths
  });

  return res.status(200).json({
    message: "user signed in successfully",
    token, // Return token in body for header-based auth
    user: {
      id: userFound.id,
      name: userFound.name,
      email: userFound.email,
      verified: userFound.verified,
    },
  });
});

// Forgot Password - Step 1: Send OTP
userRouter.post("/forgot-password", async (req, res): Promise<any> => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      errorMessage: "Email is required",
    });
  }

  try {
    // Check if user exists
    const user = await prisma.user.findFirst({
      where: {
        email,
        role: "USER",
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
    const otp = await sendPasswordResetOTP(email);
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
userRouter.post("/reset-password", async (req, res): Promise<any> => {
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

// after the signin route we need the which returns the bus with the specific router

// after the  signin route we need the which returns the bus with the specicxit router
userRouter.post("/showbus", async (req, res): Promise<any> => {
  const {
    startLocation,
    endLocation,
    date,
    busType,
    hasWifi,
    hasAC,
    hasCharging,
    hasRestroom,
    minPrice,
    maxPrice,
    departureTimeStart,
    departureTimeEnd,
    sortBy,
    sortOrder,
  } = req.body;

  // Trim locations to avoid issues with trailing spaces
  const trimmedStartLocation =
    typeof startLocation === "string" ? startLocation.trim() : startLocation;
  const trimmedEndLocation =
    typeof endLocation === "string" ? endLocation.trim() : endLocation;

  // Try enhanced schema first, fall back to basic schema
  const enhancedValidation = enhancedSearchSchema.safeParse({
    ...req.body,
    startLocation: trimmedStartLocation,
    endLocation: trimmedEndLocation,
  });
  const basicValidation = busSearchSchema.safeParse({
    ...req.body,
    startLocation: trimmedStartLocation,
    endLocation: trimmedEndLocation,
  });

  if (!enhancedValidation.success && !basicValidation.success) {
    return res.status(400).json({
      errorMessage: "Invalid input",
      errors: basicValidation.error.issues,
    });
  }

  try {
    // ✅ FIX: Parse date string correctly to avoid timezone issues
    // When date is "2025-11-05", create date in local timezone, not UTC
    const [year, month, day] = date.split("-").map(Number);
    const searchDate = new Date(year, month - 1, day, 0, 0, 0, 0);

    // Create end of day for range queries
    const searchDateEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

    // ✅ FIX: Create normalized UTC date for database storage (to prevent duplicates)
    // This ensures all trips for same date have identical timestamp in database
    const normalizedTripDate = new Date(
      Date.UTC(year, month - 1, day, 0, 0, 0, 0)
    );

    // ✅ AUTO-TRIP GENERATION: First, find all buses with matching stops
    const busesWithStops = await prisma.bus.findMany({
      where: {
        stops: {
          some: {
            OR: [
              { name: { contains: trimmedStartLocation, mode: "insensitive" } },
              { city: { contains: trimmedStartLocation, mode: "insensitive" } },
            ],
          },
        },
      },
      select: {
        id: true,
        holidays: {
          where: {
            date: {
              gte: searchDate,
              lte: searchDateEnd,
            },
          },
        },
      },
    });

    // ✅ Auto-create trips ONLY for buses that don't have holidays on this date
    for (const bus of busesWithStops) {
      // Skip trip creation if bus has a holiday on this date
      if (bus.holidays.length === 0) {
        // No holiday on this date, create trip if doesn't exist
        try {
          await prisma.trip.upsert({
            where: {
              busId_tripDate: {
                busId: bus.id,
                tripDate: normalizedTripDate, // ✅ Use UTC midnight for consistent storage
              },
            },
            create: {
              busId: bus.id,
              tripDate: normalizedTripDate, // ✅ Use UTC midnight for consistent storage
              status: "SCHEDULED",
            },
            update: {}, // Do nothing if already exists
          });
        } catch (e: any) {
          // Handle race condition: if trip was created by another request, silently continue
          if (e.code !== "P2002") {
            console.error("Error creating trip:", e);
          }
        }
      }
      // If holiday exists (bus.holidays.length > 0), do NOT create trip
    }

    // Build where clause for trip query
    // ✅ FIX: Query for exact normalized date to prevent finding multiple trips for same bus/date
    const tripWhere: any = {
      tripDate: normalizedTripDate, // Search for exact UTC midnight date
      status: {
        in: ["SCHEDULED", "ONGOING"],
      },
      bus: {
        stops: {
          some: {
            OR: [
              { name: { contains: trimmedStartLocation, mode: "insensitive" } },
              { city: { contains: trimmedStartLocation, mode: "insensitive" } },
            ],
          },
        },
      },
    };

    // Add bus type filter if provided
    if (busType) {
      tripWhere.bus = {
        ...tripWhere.bus,
        type: busType,
      };
    }

    // Find all buses that have trips on this date with stops matching start and end
    const trips = await prisma.trip.findMany({
      where: tripWhere,
      include: {
        bus: {
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
            amenities: true,
            images: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                imageUrl: true,
                createdAt: true,
              },
            },
            holidays: {
              where: {
                date: {
                  gte: searchDate,
                  lte: searchDateEnd,
                },
              },
            },
          },
        },
        bookings: {
          where: {
            status: "CONFIRMED",
          },
          select: {
            seatId: true,
            group: {
              select: {
                fromStop: {
                  select: {
                    stopIndex: true,
                  },
                },
                toStop: {
                  select: {
                    stopIndex: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Filter trips where both start and end locations exist in correct order
    let validTrips = trips
      .map((trip) => {
        // ✅ HOLIDAY CHECK: Skip buses that have a holiday on this date
        if (trip.bus.holidays && trip.bus.holidays.length > 0) {
          console.log(
            `Filtering out bus ${trip.bus.busNumber} - has holiday on ${
              searchDate.toISOString().split("T")[0]
            }`
          );
          return null; // Bus has a holiday, don't show it
        }

        const stops = trip.bus.stops;

        // Find matching stops - must match user's search direction
        // User searched for "startLocation" → "endLocation"
        const fromStop = stops.find(
          (s) =>
            s.name.toLowerCase().includes(trimmedStartLocation.toLowerCase()) ||
            s.city.toLowerCase().includes(trimmedStartLocation.toLowerCase())
        );

        const toStop = stops.find(
          (s) =>
            s.name.toLowerCase().includes(trimmedEndLocation.toLowerCase()) ||
            s.city.toLowerCase().includes(trimmedEndLocation.toLowerCase())
        );

        // If stops not found, skip
        if (!fromStop || !toStop) {
          return null;
        }

        // Skip if stops are the same
        if (fromStop.stopIndex === toStop.stopIndex) {
          return null;
        }

        // Determine trip direction based on stop indices
        const isForwardTrip = fromStop.stopIndex < toStop.stopIndex;
        const isReturnTrip = fromStop.stopIndex > toStop.stopIndex;

        // ✅ FIX: Only show the trip that matches the user's ACTUAL search direction
        // If fromStop < toStop: It's a forward trip, use forward timings
        // If fromStop > toStop: It's a return trip, check if return timings exist

        if (isReturnTrip) {
          // For return trips, check if return timings are configured
          const hasReturnTimings = stops.some(
            (s) => s.returnArrivalTime || s.returnDepartureTime
          );
          if (!hasReturnTimings) {
            return null; // Return trip not available if no return timings configured
          }
        }

        // Calculate available seats (direction-aware logic)
        const totalSeats = trip.bus.totalSeats;
        const minIndex = Math.min(fromStop.stopIndex, toStop.stopIndex);
        const maxIndex = Math.max(fromStop.stopIndex, toStop.stopIndex);

        const occupiedSeatsCount = new Set(
          trip.bookings
            .filter((booking) => {
              const bookingFromIdx = booking.group.fromStop.stopIndex;
              const bookingToIdx = booking.group.toStop.stopIndex;

              // ✅ CRITICAL FIX: Check if booking is in the SAME DIRECTION
              const bookingIsReturnTrip = bookingFromIdx > bookingToIdx;

              // Skip bookings in opposite direction
              if (bookingIsReturnTrip !== isReturnTrip) {
                return false;
              }

              const bookingMin = Math.min(bookingFromIdx, bookingToIdx);
              const bookingMax = Math.max(bookingFromIdx, bookingToIdx);

              // Check if segments overlap (only for same direction)
              return minIndex < bookingMax && maxIndex > bookingMin;
            })
            .map((b) => b.seatId)
        ).size;

        const availableSeats = totalSeats - occupiedSeatsCount;

        // Calculate fare (price is same for both directions, just absolute difference)
        const fare = Math.abs(
          toStop.priceFromOrigin - fromStop.priceFromOrigin
        );

        // For seat prices, use the price from the farther stop (higher stopIndex)
        // This ensures consistent pricing regardless of direction
        const farStopIndex = Math.max(fromStop.stopIndex, toStop.stopIndex);
        const farStop = stops.find((s) => s.stopIndex === farStopIndex);
        const nearStopIndex = Math.min(fromStop.stopIndex, toStop.stopIndex);
        const nearStop = stops.find((s) => s.stopIndex === nearStopIndex);

        // Journey price = farStop price - nearStop price
        const journeyLowerSeaterPrice =
          (farStop?.lowerSeaterPrice || 0) - (nearStop?.lowerSeaterPrice || 0);
        const journeyLowerSleeperPrice =
          (farStop?.lowerSleeperPrice || 0) -
          (nearStop?.lowerSleeperPrice || 0);
        const journeyUpperSleeperPrice =
          (farStop?.upperSleeperPrice || 0) -
          (nearStop?.upperSleeperPrice || 0);

        // Get appropriate departure and arrival times based on trip direction (isReturnTrip already defined above)
        const departureTime = isReturnTrip
          ? fromStop.returnDepartureTime || fromStop.departureTime
          : fromStop.departureTime;

        const arrivalTime = isReturnTrip
          ? toStop.returnArrivalTime || toStop.arrivalTime
          : toStop.arrivalTime;

        // Calculate duration in minutes
        let duration = 0;
        if (arrivalTime && departureTime) {
          const dep = new Date(`1970-01-01T${departureTime}`);
          const arr = new Date(`1970-01-01T${arrivalTime}`);
          let diffMs = arr.getTime() - dep.getTime();

          // Handle overnight trips (arrival is next day)
          if (diffMs < 0) {
            diffMs += 24 * 60 * 60 * 1000; // Add 24 hours
          }

          duration = diffMs / (1000 * 60);
        }

        return {
          tripId: trip.id,
          busId: trip.bus.id,
          busNumber: trip.bus.busNumber,
          busName: trip.bus.name,
          busType: trip.bus.type,
          layoutType: trip.bus.layoutType,
          tripDate: trip.tripDate.toISOString().split("T")[0], // ✅ FIX: Return as "YYYY-MM-DD" string
          isReturnTrip, // Flag to indicate if this is a return trip
          fromStop: {
            id: fromStop.id,
            name: fromStop.name,
            city: fromStop.city,
            departureTime: departureTime,
            stopIndex: fromStop.stopIndex,
            boardingPoints: (fromStop.boardingPoints || []).map((point) => ({
              id: point.id,
              name: point.name,
              time: point.time,
              landmark: point.landmark,
              address: point.address,
              pointOrder: point.pointOrder,
            })),
          },
          toStop: {
            id: toStop.id,
            name: toStop.name,
            city: toStop.city,
            arrivalTime: arrivalTime,
            stopIndex: toStop.stopIndex,
            boardingPoints: (toStop.boardingPoints || []).map((point) => ({
              id: point.id,
              name: point.name,
              time: point.time,
              landmark: point.landmark,
              address: point.address,
              pointOrder: point.pointOrder,
            })),
          },
          availableSeats,
          totalSeats,
          fare,
          // Add seat-specific pricing for the journey (same regardless of direction)
          lowerSeaterPrice: journeyLowerSeaterPrice,
          lowerSleeperPrice: journeyLowerSleeperPrice,
          upperSleeperPrice: journeyUpperSleeperPrice,
          duration,
          amenities: trip.bus.amenities
            ? {
                hasWifi: trip.bus.amenities.hasWifi,
                hasAC: trip.bus.amenities.hasAC,
                hasCharging: trip.bus.amenities.hasCharging,
                hasRestroom: trip.bus.amenities.hasRestroom,
                hasBlanket: trip.bus.amenities.hasBlanket,
                hasWaterBottle: trip.bus.amenities.hasWaterBottle,
                hasSnacks: trip.bus.amenities.hasSnacks,
                hasTV: trip.bus.amenities.hasTV,
              }
            : null,
        };
      })
      .filter((trip) => trip !== null);

    // ✅ FILTER: Remove buses that have already departed (if searching for today)
    const now = new Date();
    const todayDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    if (searchDate.getTime() === todayDate.getTime()) {
      // Searching for today - filter out buses that have already departed
      validTrips = validTrips.filter((trip) => {
        if (!trip.fromStop.departureTime) return true; // Keep if no departure time

        try {
          const [hours, minutes] = trip.fromStop.departureTime
            .split(":")
            .map(Number);
          if (hours === undefined || minutes === undefined) return true;

          const departureDateTime = new Date(searchDate);
          departureDateTime.setHours(hours, minutes, 0, 0);

          // Keep only buses that haven't departed yet
          return departureDateTime > now;
        } catch {
          return true; // Keep if parsing fails
        }
      });
    }

    // Apply amenity filters
    if (hasWifi !== undefined) {
      validTrips = validTrips.filter(
        (trip) => trip.amenities?.hasWifi === hasWifi
      );
    }
    if (hasAC !== undefined) {
      validTrips = validTrips.filter((trip) => trip.amenities?.hasAC === hasAC);
    }
    if (hasCharging !== undefined) {
      validTrips = validTrips.filter(
        (trip) => trip.amenities?.hasCharging === hasCharging
      );
    }
    if (hasRestroom !== undefined) {
      validTrips = validTrips.filter(
        (trip) => trip.amenities?.hasRestroom === hasRestroom
      );
    }

    // Apply price filters
    if (minPrice !== undefined) {
      validTrips = validTrips.filter((trip) => trip.fare >= minPrice);
    }
    if (maxPrice !== undefined) {
      validTrips = validTrips.filter((trip) => trip.fare <= maxPrice);
    }

    // Apply departure time filters
    if (departureTimeStart) {
      validTrips = validTrips.filter(
        (trip) =>
          trip.fromStop.departureTime &&
          trip.fromStop.departureTime >= departureTimeStart
      );
    }
    if (departureTimeEnd) {
      validTrips = validTrips.filter(
        (trip) =>
          trip.fromStop.departureTime &&
          trip.fromStop.departureTime <= departureTimeEnd
      );
    }

    // Apply sorting
    if (sortBy) {
      validTrips.sort((a, b) => {
        let compareValue = 0;

        switch (sortBy) {
          case "price":
            compareValue = a.fare - b.fare;
            break;
          case "duration":
            compareValue = a.duration - b.duration;
            break;
          case "departureTime":
            if (a.fromStop.departureTime && b.fromStop.departureTime) {
              compareValue = a.fromStop.departureTime.localeCompare(
                b.fromStop.departureTime
              );
            }
            break;
          case "seatsAvailable":
            compareValue = a.availableSeats - b.availableSeats;
            break;
          default:
            compareValue = 0;
        }

        return sortOrder === "desc" ? -compareValue : compareValue;
      });
    }

    return res.status(200).json({
      message: "Buses fetched successfully",
      count: validTrips.length,
      trips: validTrips,
      filters: {
        busType: busType || null,
        amenities: {
          wifi: hasWifi,
          ac: hasAC,
          charging: hasCharging,
          restroom: hasRestroom,
        },
        priceRange: { min: minPrice, max: maxPrice },
        departureTimeRange: {
          start: departureTimeStart,
          end: departureTimeEnd,
        },
      },
    });
  } catch (e) {
    console.error("Error fetching buses:", e);
    return res.status(500).json({ errorMessage: "Failed to fetch buses" });
  }
});

userRouter.get("/showbusinfo/:tripId", async (req, res): Promise<any> => {
  const { tripId } = req.params;
  const { fromStopId, toStopId } = req.query;

  // Validate query params
  const validation = busInfoQuerySchema.safeParse({ fromStopId, toStopId });
  if (!validation.success) {
    return res.status(400).json({
      errorMessage: "Invalid stop IDs",
      errors: validation.error.issues,
    });
  }

  try {
    // Fetch trip with bus details
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: {
          include: {
            stops: {
              orderBy: { stopIndex: "asc" },
              include: {
                boardingPoints: {
                  orderBy: { pointOrder: "asc" },
                },
              },
            },
            seats: {
              where: { isActive: true },
              orderBy: [{ level: "asc" }, { row: "asc" }, { column: "asc" }],
            },
            images: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                imageUrl: true,
                createdAt: true,
              },
            },
          },
        },
        bookings: {
          where: {
            status: "CONFIRMED",
          },
          include: {
            seat: true,
            group: {
              select: {
                fromStop: {
                  select: {
                    stopIndex: true,
                    id: true,
                  },
                },
                toStop: {
                  select: {
                    stopIndex: true,
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!trip) {
      return res.status(404).json({ errorMessage: "Trip not found" });
    }

    // Find the from and to stops
    const fromStop = trip.bus.stops.find((s) => s.id === fromStopId);
    const toStop = trip.bus.stops.find((s) => s.id === toStopId);

    if (!fromStop || !toStop) {
      return res.status(404).json({ errorMessage: "Stops not found" });
    }

    // Allow both forward trips (A→B) and return trips (B→A)
    if (fromStop.stopIndex === toStop.stopIndex) {
      return res
        .status(400)
        .json({ errorMessage: "From and to stops cannot be the same" });
    }

    // Determine if this is a return trip
    const isReturnTrip = fromStop.stopIndex > toStop.stopIndex;

    // Determine which seats are occupied for this route segment
    // Use min/max logic to handle both forward and return trips correctly
    const minIndex = Math.min(fromStop.stopIndex, toStop.stopIndex);
    const maxIndex = Math.max(fromStop.stopIndex, toStop.stopIndex);

    console.log(
      `🔍 Checking seat availability for route segment: stopIndex ${
        fromStop.stopIndex
      } → ${toStop.stopIndex} (${isReturnTrip ? "RETURN" : "FORWARD"} trip)`
    );
    console.log(`📊 Total bookings to check: ${trip.bookings.length}`);

    const occupiedSeatIds = new Set<string>();
    trip.bookings.forEach((booking) => {
      const bookingFromIdx = booking.group.fromStop.stopIndex;
      const bookingToIdx = booking.group.toStop.stopIndex;

      // Determine if the existing booking is a return trip (same logic as current request)
      const bookingIsReturnTrip = bookingFromIdx > bookingToIdx;

      // ✅ CRITICAL FIX: Only consider bookings in the SAME DIRECTION
      if (bookingIsReturnTrip !== isReturnTrip) {
        console.log(
          `✅ Seat ${booking.seat.seatNumber} is AVAILABLE (booking is ${
            bookingIsReturnTrip ? "RETURN" : "FORWARD"
          }, current trip is ${isReturnTrip ? "RETURN" : "FORWARD"})`
        );
        return; // Skip this booking - it's in the opposite direction
      }

      // For same direction trips, check if route segments overlap
      // Forward trip: lower index → higher index
      // Return trip: higher index → lower index
      const bookingMin = Math.min(bookingFromIdx, bookingToIdx);
      const bookingMax = Math.max(bookingFromIdx, bookingToIdx);

      // Check if segments overlap
      if (minIndex < bookingMax && maxIndex > bookingMin) {
        console.log(
          `❌ Seat ${booking.seat.seatNumber} is OCCUPIED (${
            bookingIsReturnTrip ? "RETURN" : "FORWARD"
          } trip: ${bookingFromIdx}→${bookingToIdx} overlaps with ${
            fromStop.stopIndex
          }→${toStop.stopIndex})`
        );
        occupiedSeatIds.add(booking.seatId);
      } else {
        console.log(
          `✅ Seat ${booking.seat.seatNumber} is AVAILABLE (${
            bookingIsReturnTrip ? "RETURN" : "FORWARD"
          } trip: ${bookingFromIdx}→${bookingToIdx} does NOT overlap with ${
            fromStop.stopIndex
          }→${toStop.stopIndex})`
        );
      }
    });

    console.log(
      `🔒 Total occupied seats in ${
        isReturnTrip ? "RETURN" : "FORWARD"
      } direction: ${occupiedSeatIds.size}`
    );

    // Organize seats by level and create layout
    const seats = trip.bus.seats.map((seat) => ({
      id: seat.id,
      seatNumber: seat.seatNumber,
      row: seat.row,
      column: seat.column,
      rowSpan: seat.rowSpan,
      columnSpan: seat.columnSpan,
      type: seat.type,
      level: seat.level,
      isAvailable: !occupiedSeatIds.has(seat.id),
    }));

    const lowerDeckSeats = seats.filter((s) => s.level === "LOWER");
    const upperDeckSeats = seats.filter((s) => s.level === "UPPER");

    const fare = Math.abs(toStop.priceFromOrigin - fromStop.priceFromOrigin);

    const orderedStops = [...trip.bus.stops].sort(
      (a, b) => a.stopIndex - b.stopIndex
    );
    const routeStops = (
      isReturnTrip ? [...orderedStops].reverse() : orderedStops
    ).map((stop) => ({
      id: stop.id,
      name: stop.name,
      city: stop.city,
      state: stop.state,
      stopIndex: stop.stopIndex,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      returnArrivalTime: stop.returnArrivalTime,
      returnDepartureTime: stop.returnDepartureTime,
      boardingPoints: (stop.boardingPoints || []).map((point) => ({
        id: point.id,
        name: point.name,
        time: point.time,
        type: point.type,
        landmark: point.landmark,
        address: point.address,
        pointOrder: point.pointOrder,
      })),
    }));

    const mapPoint = (point: any) => ({
      id: point.id,
      name: point.name,
      time: point.time,
      type: point.type,
      landmark: point.landmark,
      address: point.address,
      pointOrder: point.pointOrder,
    });

    const candidateBoardingPoints = (fromStop.boardingPoints || []).filter(
      (point) => point.type === "BOARDING"
    );
    const availableBoardingPoints =
      candidateBoardingPoints.length > 0
        ? candidateBoardingPoints
        : fromStop.boardingPoints || [];

    const candidateDroppingPoints = (toStop.boardingPoints || []).filter(
      (point) => point.type === "DROPPING"
    );
    const availableDroppingPoints =
      candidateDroppingPoints.length > 0
        ? candidateDroppingPoints
        : toStop.boardingPoints || [];

    return res.status(200).json({
      message: "Bus info fetched successfully",
      trip: {
        id: trip.id,
        tripDate: trip.tripDate,
        status: trip.status,
      },
      bus: {
        id: trip.bus.id,
        busNumber: trip.bus.busNumber,
        name: trip.bus.name,
        type: trip.bus.type,
        layoutType: trip.bus.layoutType,
        totalSeats: trip.bus.totalSeats,
        gridRows: trip.bus.gridRows,
        gridColumns: trip.bus.gridColumns,
        images: trip.bus.images,
      },
      route: {
        fromStop: {
          id: fromStop.id,
          name: fromStop.name,
          city: fromStop.city,
          departureTime: fromStop.departureTime,
          lowerSeaterPrice: fromStop.lowerSeaterPrice,
          lowerSleeperPrice: fromStop.lowerSleeperPrice,
          upperSleeperPrice: fromStop.upperSleeperPrice,
          boardingPoints: availableBoardingPoints.map(mapPoint),
        },
        toStop: {
          id: toStop.id,
          name: toStop.name,
          city: toStop.city,
          arrivalTime: toStop.arrivalTime,
          lowerSeaterPrice: toStop.lowerSeaterPrice,
          lowerSleeperPrice: toStop.lowerSleeperPrice,
          upperSleeperPrice: toStop.upperSleeperPrice,
          boardingPoints: (toStop.boardingPoints || []).map(mapPoint),
        },
        fare,
        isReturnTrip,
        path: routeStops,
        boardingPoints: availableBoardingPoints.map(mapPoint),
        droppingPoints: availableDroppingPoints.map(mapPoint),
      },
      seats: {
        lowerDeck: lowerDeckSeats,
        upperDeck: upperDeckSeats,
        availableCount: seats.length - occupiedSeatIds.size,
      },
    });
  } catch (e) {
    console.error("Error fetching bus info:", e);
    return res.status(500).json({ errorMessage: "Failed to fetch bus info" });
  }
});

userRouter.post(
  "/payments/initiate",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    const validation = initiatePaymentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        errorMessage: "Invalid payment initiation data",
        errors: validation.error.issues,
      });
    }

    const payload = validation.data;
    const method = payload.paymentMethod as PaymentMethod;

    try {
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });

      if (!userExists) {
        return res.status(401).json({
          errorMessage: "User account not found. Please sign in again.",
        });
      }

      const bookingDetails = await prepareBookingDetails(
        prisma,
        {
          tripId: payload.tripId,
          fromStopId: payload.fromStopId,
          toStopId: payload.toStopId,
          seatIds: payload.seatIds,
          passengers: payload.passengers,
          couponCode: payload.couponCode,
          boardingPointId: payload.boardingPointId,
          droppingPointId: payload.droppingPointId,
        },
        userId
      );

      const config = getPaymentConfig();
      const amounts = calculatePaymentAmounts(
        method,
        bookingDetails.finalPrice
      );

      let gatewayOrderId: string | undefined;
      let gatewayMeta: any = {};

      const bookingMetadata = {
        ...bookingDetails.bookingPayload,
        seatFares: bookingDetails.seatFares,
        totalPrice: bookingDetails.totalPrice,
        discountAmount: bookingDetails.discountAmount,
        finalPrice: bookingDetails.finalPrice,
        offerId: bookingDetails.appliedOffer?.id ?? null,
        offerDiscountReason: bookingDetails.offerDiscountReason || null,
      };

      if (method === PaymentMethod.RAZORPAY) {
        const razorpay = new Razorpay({
          key_id: config.razorpay.keyId,
          key_secret: config.razorpay.keySecret,
        });

        const order = await razorpay.orders.create({
          amount: convertToMinorUnits(
            amounts.chargedAmount,
            amounts.chargedCurrency
          ),
          currency: config.razorpay.currency,
          receipt: `rb-${Date.now()}`,
          notes: {
            userId,
            tripId: payload.tripId,
            fromStopId: payload.fromStopId,
            toStopId: payload.toStopId,
          },
        });

        gatewayOrderId = order.id;
        gatewayMeta = {
          orderId: order.id,
          currency: order.currency,
          amount: order.amount,
          razorpayKeyId: config.razorpay.keyId,
        };
      } else {
        const transactionUuid = `rb-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;

        const totalAmount = roundToTwo(amounts.chargedAmount);
        const totalAmountStr = totalAmount.toFixed(2);

        // eSewa v2 signature: concatenate values in the exact order of signed_field_names
        // Format: "total_amount={value},transaction_uuid={value},product_code={value}"
        const signaturePayload = `total_amount=${totalAmountStr},transaction_uuid=${transactionUuid},product_code=${config.esewa.productCode}`;
        const signature = crypto
          .createHmac("sha256", config.esewa.secretKey)
          .update(signaturePayload)
          .digest("base64");

        gatewayOrderId = transactionUuid;
        gatewayMeta = {
          formUrl: config.esewa.endpoint,
          params: {
            amount: totalAmountStr,
            tax_amount: "0",
            total_amount: totalAmountStr,
            transaction_uuid: transactionUuid,
            product_code: config.esewa.productCode,
            product_service_charge: "0",
            product_delivery_charge: "0",
            success_url: config.esewa.successUrl,
            failure_url: config.esewa.failureUrl,
            signed_field_names: "total_amount,transaction_uuid,product_code",
            signature,
          },
        };
      }

      let paymentRecord = await prisma.payment.create({
        data: {
          userId,
          method,
          baseAmount: amounts.baseAmount,
          baseCurrency: amounts.baseCurrency,
          chargedAmount: amounts.chargedAmount,
          chargedCurrency: amounts.chargedCurrency,
          exchangeRate: amounts.exchangeRate ?? null,
          gatewayOrderId,
          status: PaymentStatus.INITIATED,
          metadata: {
            booking: bookingMetadata,
            gatewayMeta,
          },
        },
      });

      if (method === PaymentMethod.ESEWA) {
        const updatedGatewayMeta = {
          ...gatewayMeta,
          params: {
            ...gatewayMeta.params,
            // Use path parameters instead of query parameters to avoid issues with eSewa appending ?data=...
            success_url: `${config.esewa.successUrl}/${paymentRecord.id}`,
            failure_url: `${config.esewa.failureUrl}/${paymentRecord.id}`,
            payment_id: paymentRecord.id,
          },
        };

        paymentRecord = await prisma.payment.update({
          where: { id: paymentRecord.id },
          data: {
            metadata: {
              booking: bookingMetadata,
              gatewayMeta: updatedGatewayMeta,
            },
          },
        });

        return res.status(200).json({
          message: "Payment initiation data for eSewa",
          paymentId: paymentRecord.id,
          method,
          amount: amounts.chargedAmount,
          currency: amounts.chargedCurrency,
          form: updatedGatewayMeta,
        });
      }

      if (method === PaymentMethod.RAZORPAY) {
        return res.status(200).json({
          message: "Payment initiated via Razorpay",
          paymentId: paymentRecord.id,
          method,
          amount: amounts.chargedAmount,
          currency: amounts.chargedCurrency,
          orderId: gatewayMeta.orderId,
          razorpayKeyId: gatewayMeta.razorpayKeyId,
        });
      }

      return res.status(500).json({
        errorMessage: "Unsupported payment method",
      });
    } catch (error: any) {
      console.error("Error initiating payment:", error);
      return res.status(500).json({
        errorMessage: error.message || "Failed to initiate payment",
      });
    }
  }
);

userRouter.post(
  "/payments/verify",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    const validation = verifyPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        errorMessage: "Invalid payment verification data",
        errors: validation.error.issues,
      });
    }

    const {
      paymentId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      esewaRefId,
    } = validation.data;

    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment || payment.userId !== userId) {
        return res.status(404).json({ errorMessage: "Payment not found" });
      }

      if (payment.status !== PaymentStatus.INITIATED) {
        return res.status(400).json({
          errorMessage: "Payment is not in a verifiable state",
        });
      }

      const config = getPaymentConfig();

      if (payment.method === PaymentMethod.RAZORPAY) {
        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
          return res.status(400).json({
            errorMessage: "Missing Razorpay verification fields",
          });
        }

        if (payment.gatewayOrderId !== razorpayOrderId) {
          return res.status(400).json({
            errorMessage: "Razorpay order ID mismatch",
          });
        }

        const expectedSignature = crypto
          .createHmac("sha256", config.razorpay.keySecret)
          .update(`${razorpayOrderId}|${razorpayPaymentId}`)
          .digest("hex");

        if (expectedSignature !== razorpaySignature) {
          await prisma.payment.update({
            where: { id: paymentId },
            data: {
              gatewayPaymentId: razorpayPaymentId,
              gatewaySignature: razorpaySignature,
              status: PaymentStatus.FAILED,
            },
          });

          return res.status(400).json({
            errorMessage: "Invalid Razorpay signature",
          });
        }

        const updatedPayment = await prisma.payment.update({
          where: { id: paymentId },
          data: {
            gatewayPaymentId: razorpayPaymentId,
            gatewaySignature: razorpaySignature,
            status: PaymentStatus.SUCCESS,
          },
        });

        return res.status(200).json({
          message: "Payment verified successfully",
          paymentId: updatedPayment.id,
          method: updatedPayment.method,
          status: updatedPayment.status,
        });
      }

      if (!esewaRefId) {
        return res.status(400).json({
          errorMessage: "Missing eSewa reference ID",
        });
      }

      const verificationPayload = {
        product_code: config.esewa.productCode,
        total_amount: payment.chargedAmount.toFixed(2),
        transaction_uuid: payment.gatewayOrderId,
      };

      let verificationStatus = "FAILED";

      try {
        const response = await axios.get(config.esewa.verificationEndpoint, {
          params: verificationPayload,
          headers: {
            Accept: "application/json",
          },
        });

        const statusValue =
          response?.data?.status ||
          response?.data?.state ||
          response?.data?.result;

        if (typeof statusValue === "string") {
          const normalized = statusValue.toUpperCase();
          if (["SUCCESS", "COMPLETED", "COMPLETE", "OK"].includes(normalized)) {
            verificationStatus = "SUCCESS";
          }
        }
      } catch (verificationError) {
        console.error("eSewa verification error:", verificationError);
        verificationStatus = "FAILED";
      }

      if (verificationStatus !== "SUCCESS") {
        await prisma.payment.update({
          where: { id: paymentId },
          data: {
            gatewayPaymentId: esewaRefId,
            status: PaymentStatus.FAILED,
            metadata: {
              ...(payment.metadata as any),
              verification: {
                status: "FAILED",
                payload: verificationPayload,
              },
            },
          },
        });

        return res.status(400).json({
          errorMessage: "eSewa payment verification failed",
        });
      }

      const updatedPayment = await prisma.payment.update({
        where: { id: paymentId },
        data: {
          gatewayPaymentId: esewaRefId,
          status: PaymentStatus.SUCCESS,
          metadata: {
            ...(payment.metadata as any),
            verification: {
              status: "SUCCESS",
              payload: verificationPayload,
            },
          },
        },
      });

      return res.status(200).json({
        message: "Payment verified successfully",
        paymentId: updatedPayment.id,
        method: updatedPayment.method,
        status: updatedPayment.status,
      });
    } catch (error: any) {
      console.error("Error verifying payment:", error);
      return res.status(500).json({
        errorMessage: error.message || "Failed to verify payment",
      });
    }
  }
);

userRouter.post(
  "/payments/confirm",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    const validation = confirmBookingSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        errorMessage: "Invalid booking confirmation data",
        errors: validation.error.issues,
      });
    }

    const { paymentId } = validation.data;

    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment || payment.userId !== userId) {
        return res.status(404).json({ errorMessage: "Payment not found" });
      }

      if (payment.status !== PaymentStatus.SUCCESS) {
        return res.status(400).json({
          errorMessage: "Payment has not been verified successfully",
        });
      }

      const bookingPayload = (payment.metadata as any)?.booking;

      if (!bookingPayload) {
        return res.status(400).json({
          errorMessage: "Payment metadata missing booking information",
        });
      }

      if (payment.bookingGroupId) {
        const existingGroup = await prisma.bookingGroup.findUnique({
          where: { id: payment.bookingGroupId },
        });

        if (existingGroup) {
          return res.status(200).json({
            message: "Booking already confirmed",
            bookingGroupId: existingGroup.id,
            totalPrice: existingGroup.totalPrice,
            discountAmount: existingGroup.discountAmount,
            finalPrice: existingGroup.finalPrice,
            couponApplied: !!existingGroup.offerId,
          });
        }
      }

      const bookingValidation = bookTicketSchema.safeParse(bookingPayload);
      if (!bookingValidation.success) {
        return res.status(400).json({
          errorMessage: "Stored booking data is invalid",
          errors: bookingValidation.error.issues,
        });
      }

      const {
        tripId,
        fromStopId,
        toStopId,
        seatIds,
        passengers,
        couponCode,
        boardingPointId,
        droppingPointId,
        seatFares,
        totalPrice,
        discountAmount,
        finalPrice,
        offerId,
      } = bookingPayload;

      if (!Array.isArray(seatIds) || seatIds.length === 0) {
        return res.status(400).json({
          errorMessage: "Booking metadata missing seats",
        });
      }

      const result = await prisma.$transaction(
        async (tx) => {
          const trip = await tx.trip.findUnique({
            where: { id: tripId },
            include: {
              bus: {
                include: {
                  stops: true,
                  seats: true,
                },
              },
            },
          });

          if (!trip) {
            throw new Error("Trip not found");
          }

          if (trip.status === "CANCELLED" || trip.status === "COMPLETED") {
            throw new Error("Trip is not available for booking");
          }

          const now = new Date();
          const tripDate = new Date(trip.tripDate);
          tripDate.setHours(0, 0, 0, 0);

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (tripDate < today) {
            throw new Error("Cannot book tickets for past dates");
          }

          const fromStop = trip.bus.stops.find((s) => s.id === fromStopId);
          const toStop = trip.bus.stops.find((s) => s.id === toStopId);

          if (!fromStop || !toStop) {
            throw new Error("Stops not found");
          }

          if (fromStop.stopIndex === toStop.stopIndex) {
            throw new Error("From and to stops cannot be the same");
          }

          const boardingPoint = await tx.stopPoint.findUnique({
            where: { id: boardingPointId },
          });

          if (!boardingPoint || boardingPoint.stopId !== fromStopId) {
            throw new Error("Invalid boarding point selected");
          }

          if (boardingPoint.type !== "BOARDING") {
            throw new Error(
              "Selected boarding point is not valid for boarding"
            );
          }

          const droppingPoint = await tx.stopPoint.findUnique({
            where: { id: droppingPointId },
          });

          if (!droppingPoint || droppingPoint.stopId !== toStopId) {
            throw new Error("Invalid dropping point selected");
          }

          const seats = await tx.seat.findMany({
            where: {
              id: { in: seatIds },
              busId: trip.busId,
              isActive: true,
            },
          });

          if (seats.length !== seatIds.length) {
            throw new Error("One or more seats are invalid or inactive");
          }

          const existingBookings = await tx.booking.findMany({
            where: {
              tripId,
              seatId: { in: seatIds },
              status: "CONFIRMED",
            },
            include: {
              group: {
                select: {
                  fromStop: { select: { stopIndex: true } },
                  toStop: { select: { stopIndex: true } },
                },
              },
            },
          });

          const minIndex = Math.min(fromStop.stopIndex, toStop.stopIndex);
          const maxIndex = Math.max(fromStop.stopIndex, toStop.stopIndex);
          const isReturnTrip = fromStop.stopIndex > toStop.stopIndex;

          const conflictingBookings = existingBookings.filter((booking) => {
            const bookingFromIdx = booking.group.fromStop.stopIndex;
            const bookingToIdx = booking.group.toStop.stopIndex;

            // Check if booking is in the same direction
            const bookingIsReturnTrip = bookingFromIdx > bookingToIdx;
            if (bookingIsReturnTrip !== isReturnTrip) {
              return false;
            }

            const bookingMin = Math.min(bookingFromIdx, bookingToIdx);
            const bookingMax = Math.max(bookingFromIdx, bookingToIdx);

            return minIndex < bookingMax && maxIndex > bookingMin;
          });

          if (conflictingBookings.length > 0) {
            const conflictedSeats = conflictingBookings
              .map((b) => {
                const seat = seats.find((s) => s.id === b.seatId);
                return seat?.seatNumber || b.seatId;
              })
              .join(", ");

            throw new Error(
              `Seat(s) ${conflictedSeats} are already booked for this route segment. Please select different seats.`
            );
          }

          const computedTotal =
            typeof totalPrice === "number"
              ? totalPrice
              : seats.reduce((sum, seat) => {
                  const seatFare = seatFares?.[seat.id] ?? 0;
                  return sum + seatFare;
                }, 0);

          const computedFinal =
            typeof finalPrice === "number"
              ? finalPrice
              : computedTotal - (discountAmount ?? 0);

          const bookingGroup = await tx.bookingGroup.create({
            data: {
              userId,
              tripId,
              fromStopId,
              toStopId,
              totalPrice: roundToTwo(computedTotal),
              offerId: offerId ?? null,
              discountAmount: roundToTwo(discountAmount ?? 0),
              finalPrice: roundToTwo(computedFinal),
              boardingPointId: boardingPoint.id,
              droppingPointId: droppingPoint.id,
              status: "CONFIRMED",
            },
          });

          const bookings = await Promise.all(
            seatIds.map((seatId: string) =>
              tx.booking.create({
                data: {
                  groupId: bookingGroup.id,
                  tripId,
                  seatId,
                  status: "CONFIRMED",
                },
              })
            )
          );

          const passengerRecords = await Promise.all(
            bookings.map((booking) => {
              const passengerData = passengers.find(
                (p: any) => p.seatId === booking.seatId
              );
              if (!passengerData) {
                throw new Error("Passenger data missing for seat");
              }
              return tx.passenger.create({
                data: {
                  bookingId: booking.id,
                  name: passengerData.name,
                  age: passengerData.age,
                  gender: passengerData.gender,
                  phone: passengerData.phone || "",
                  email: passengerData.email,
                },
              });
            })
          );

          await tx.payment.update({
            where: { id: paymentId },
            data: {
              bookingGroupId: bookingGroup.id,
              status: PaymentStatus.SUCCESS,
            },
          });

          if (offerId) {
            await tx.offer.update({
              where: { id: offerId },
              data: { usageCount: { increment: 1 } },
            });
          }

          return {
            bookingGroup,
            bookings,
            passengers: passengerRecords,
            seats,
            fromStop,
            toStop,
            boardingPoint,
            droppingPoint,
            totalPrice: roundToTwo(computedTotal),
            discountAmount: roundToTwo(discountAmount ?? 0),
            finalPrice: roundToTwo(computedFinal),
            couponCode,
          };
        },
        {
          maxWait: 15000,
          timeout: 30000,
        }
      );

      const tripWithBus = await prisma.trip.findUnique({
        where: { id: result.bookingGroup.tripId },
        include: {
          bus: {
            select: {
              name: true,
              busNumber: true,
              type: true,
            },
          },
        },
      });

      // Get user details for email
      const userDetails = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });

      await notifyBookingConfirmed(userId, result.bookingGroup.id, {
        busName: tripWithBus?.bus.name || "Bus",
        busNumber: tripWithBus?.bus.busNumber || "",
        date: tripWithBus?.tripDate.toISOString() || new Date().toISOString(),
        from: result.fromStop.name,
        to: result.toStop.name,
        seatNumbers: result.seats.map((s) => s.seatNumber),
        totalPrice: result.finalPrice,
      });

      if (result.couponCode) {
        await notifyOfferApplied(
          userId,
          result.couponCode,
          result.discountAmount
        );
      }

      // Generate PDF ticket and send email
      try {
        const { generateTicketPDF } = await import("../services/pdfService.js");
        const { sendBookingConfirmationEmail } = await import(
          "../services/brevoEmailService.js"
        );

        // Fetch payment details
        const payment = await prisma.payment.findUnique({
          where: { bookingGroupId: result.bookingGroup.id },
        });

        // Prepare ticket data
        const ticketData = {
          bookingGroupId: result.bookingGroup.id,
          bookedAt: result.bookingGroup.createdAt.toISOString(),
          user: {
            name: userDetails?.name || "Passenger",
            email: userDetails?.email || "",
          },
          trip: {
            tripDate:
              tripWithBus?.tripDate.toISOString() || new Date().toISOString(),
            tripStatus: tripWithBus?.status || "ACTIVE",
          },
          bus: {
            busNumber: tripWithBus?.bus.busNumber || "",
            name: tripWithBus?.bus.name || "",
            type: tripWithBus?.bus.type || "SEATER",
          },
          route: {
            from: {
              name: result.fromStop.name,
              city: result.fromStop.city,
              departureTime: result.fromStop.departureTime,
            },
            to: {
              name: result.toStop.name,
              city: result.toStop.city,
              arrivalTime: result.toStop.arrivalTime,
            },
          },
          boardingPoint: result.boardingPoint
            ? {
                name: result.boardingPoint.name,
                landmark: result.boardingPoint.landmark,
                time: result.boardingPoint.time,
              }
            : null,
          droppingPoint: result.droppingPoint
            ? {
                name: result.droppingPoint.name,
                landmark: result.droppingPoint.landmark,
                time: result.droppingPoint.time,
              }
            : null,
          seats: result.passengers.map((p, idx) => {
            const seat = result.seats[idx];
            return {
              seatNumber: seat?.seatNumber || "",
              seatLevel: seat?.level || "LOWER",
              seatType: seat?.type || "SEATER",
              fare: (seatFares as any)?.[seat?.id || ""] || 0,
              passenger: {
                name: p.name,
                age: p.age,
                gender: p.gender,
              },
            };
          }),
          pricing: {
            totalPrice: result.totalPrice,
            discountAmount: result.discountAmount,
            finalPrice: result.finalPrice,
            couponCode: result.couponCode || undefined,
          },
          payment: payment
            ? {
                method: payment.method as string,
                amountPaid: payment.chargedAmount,
                currency: payment.chargedCurrency as string,
              }
            : undefined,
          status: "CONFIRMED" as const,
        };

        // Generate PDF
        const pdfBuffer = await generateTicketPDF(ticketData);

        // Send email with PDF attachment
        if (userDetails?.email) {
          await sendBookingConfirmationEmail(
            userDetails.email,
            userDetails.name,
            {
              bookingGroupId: result.bookingGroup.id,
              busName: tripWithBus?.bus.name || "",
              busNumber: tripWithBus?.bus.busNumber || "",
              tripDate: new Date(
                tripWithBus?.tripDate || new Date()
              ).toLocaleDateString("en-IN"),
              fromStop: result.fromStop.name,
              toStop: result.toStop.name,
              boardingPoint: result.boardingPoint?.name || "",
              boardingTime: result.boardingPoint?.time || "",
              droppingPoint: result.droppingPoint?.name || "",
              seats: ticketData.seats.map((s) => ({
                seatNumber: s.seatNumber,
                passengerName: s.passenger.name,
                age: s.passenger.age,
                gender: s.passenger.gender,
                level: s.seatLevel,
                type: s.seatType,
              })),
              totalPrice: result.totalPrice,
              discountAmount: result.discountAmount,
              finalPrice: result.finalPrice,
              couponCode: result.couponCode,
              bookedAt: result.bookingGroup.createdAt.toLocaleString("en-IN"),
            },
            pdfBuffer
          );
          console.log(
            "✅ Booking confirmation email with PDF sent successfully"
          );
        }
      } catch (pdfError) {
        console.error("Error generating PDF or sending email:", pdfError);
        // Don't fail the booking if PDF/email fails
      }

      return res.status(200).json({
        message: "Booking confirmed successfully",
        bookingGroupId: result.bookingGroup.id,
        totalPrice: result.totalPrice,
        discountAmount: result.discountAmount,
        finalPrice: result.finalPrice,
        couponApplied: !!result.couponCode,
        seatCount: result.seats.length,
        seatNumbers: result.seats.map((s) => s.seatNumber),
        route: {
          from: result.fromStop.name,
          to: result.toStop.name,
        },
        boardingPoint: result.boardingPoint
          ? {
              id: result.boardingPoint.id,
              name: result.boardingPoint.name,
              time: result.boardingPoint.time,
              type: result.boardingPoint.type,
            }
          : null,
        droppingPoint: result.droppingPoint
          ? {
              id: result.droppingPoint.id,
              name: result.droppingPoint.name,
              time: result.droppingPoint.time,
              type: result.droppingPoint.type,
            }
          : null,
        passengers: result.passengers.map((p) => ({
          name: p.name,
          age: p.age,
          gender: p.gender,
        })),
      });
    } catch (error: any) {
      console.error("Error confirming payment booking:", error);
      return res.status(500).json({
        errorMessage: error.message || "Failed to confirm booking",
      });
    }
  }
);

userRouter.post(
  "/cancelticket",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const { bookingGroupId } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    // Validate input
    const validation = cancelTicketSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        errorMessage: "Invalid booking group ID",
        errors: validation.error.issues,
      });
    }

    try {
      // Start transaction
      const result = await prisma.$transaction(async (tx) => {
        // 1. Find booking group
        const bookingGroup = await tx.bookingGroup.findUnique({
          where: { id: bookingGroupId },
          include: {
            bookings: true,
            trip: true,
          },
        });

        if (!bookingGroup) {
          throw new Error("Booking not found");
        }

        // 2. Verify ownership
        if (bookingGroup.userId !== userId) {
          throw new Error("Unauthorized: This booking doesn't belong to you");
        }

        // 3. Check if already cancelled
        if (bookingGroup.status === "CANCELLED") {
          throw new Error("Booking is already cancelled");
        }

        // 4. Check if trip has already completed
        if (bookingGroup.trip.status === "COMPLETED") {
          throw new Error("Cannot cancel completed trip");
        }

        // 5. Check cancellation policy (optional - you can add time-based restrictions)
        const tripDate = bookingGroup.trip.tripDate;
        const now = new Date();
        const hoursUntilTrip =
          (tripDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (hoursUntilTrip < 2) {
          throw new Error(
            "Cannot cancel bookings less than 2 hours before departure"
          );
        }

        // 6. Update booking group status
        await tx.bookingGroup.update({
          where: { id: bookingGroupId },
          data: { status: "CANCELLED" },
        });

        // 7. Update all bookings in the group
        await tx.booking.updateMany({
          where: { groupId: bookingGroupId },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
          },
        });

        return {
          bookingGroup,
          seatCount: bookingGroup.bookings.length,
        };
      });

      // Get user details for notification
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      // Send cancellation notification
      if (user) {
        await notifyBookingCancelled(
          userId,
          bookingGroupId,
          result.bookingGroup.finalPrice || result.bookingGroup.totalPrice
        );
      }

      return res.status(200).json({
        message: "Booking cancelled successfully",
        bookingGroupId,
        refundAmount:
          result.bookingGroup.finalPrice || result.bookingGroup.totalPrice,
        seatCount: result.seatCount,
      });
    } catch (e: any) {
      console.error("Error cancelling ticket:", e);
      return res.status(500).json({
        errorMessage: e.message || "Failed to cancel ticket",
      });
    }
  }
);

userRouter.get(
  "/mybookings",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;
    const { status, upcoming, page = "1", limit = "5" } = req.query;

    try {
      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 5;
      const skip = (pageNum - 1) * limitNum;

      const where: any = { userId };

      // Filter by status if provided
      if (status && typeof status === "string") {
        where.status = status.toUpperCase();
      }

      // Filter by upcoming trips
      if (upcoming === "true") {
        where.trip = {
          tripDate: {
            gte: new Date(),
          },
          status: {
            in: ["SCHEDULED", "ONGOING"],
          },
        };
      }

      const bookingGroups = await prisma.bookingGroup.findMany({
        where,
        include: {
          trip: {
            include: {
              bus: {
                select: {
                  busNumber: true,
                  name: true,
                  type: true,
                },
              },
            },
          },
          fromStop: {
            select: {
              name: true,
              city: true,
              departureTime: true,
            },
          },
          toStop: {
            select: {
              name: true,
              city: true,
              arrivalTime: true,
            },
          },
          boardingPoint: {
            select: {
              name: true,
              landmark: true,
              time: true,
            },
          },
          droppingPoint: {
            select: {
              name: true,
              landmark: true,
              time: true,
            },
          },
          offer: {
            select: {
              code: true,
              description: true,
            },
          },
          bookings: {
            include: {
              seat: {
                select: {
                  seatNumber: true,
                  type: true,
                  level: true,
                },
              },
            },
          },
          payment: {
            select: {
              method: true,
              chargedAmount: true,
              chargedCurrency: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limitNum,
      });

      const totalCount = await prisma.bookingGroup.count({ where });

      const formattedBookings = bookingGroups.map((group: any) => ({
        bookingGroupId: group.id,
        status: group.status,
        totalPrice: group.totalPrice,
        discountAmount: group.discountAmount || 0,
        finalPrice: group.finalPrice || group.totalPrice,
        payment: group.payment
          ? {
              method: group.payment.method,
              amount: group.payment.chargedAmount,
              currency: group.payment.chargedCurrency,
            }
          : null,
        coupon: group.offer
          ? {
              code: group.offer.code,
              description: group.offer.description,
            }
          : null,
        bookedAt: group.createdAt,
        trip: {
          tripId: group.tripId,
          tripDate: group.trip.tripDate.toISOString().split("T")[0], // ✅ FIX: Return as "YYYY-MM-DD" string
          tripStatus: group.trip.status,
        },
        bus: {
          busNumber: group.trip.bus.busNumber,
          name: group.trip.bus.name,
          type: group.trip.bus.type,
        },
        route: {
          from: {
            name: group.fromStop.name,
            city: group.fromStop.city,
            departureTime: group.fromStop.departureTime,
          },
          to: {
            name: group.toStop.name,
            city: group.toStop.city,
            arrivalTime: group.toStop.arrivalTime,
          },
        },
        boardingPoint: group.boardingPoint
          ? {
              name: group.boardingPoint.name,
              landmark: group.boardingPoint.landmark,
              time: group.boardingPoint.time,
            }
          : null,
        droppingPoint: group.droppingPoint
          ? {
              name: group.droppingPoint.name,
              landmark: group.droppingPoint.landmark,
              time: group.droppingPoint.time,
            }
          : null,
        seats: group.bookings.map((b: any) => ({
          seatNumber: b.seat.seatNumber,
          type: b.seat.type,
          level: b.seat.level,
        })),
        seatCount: group.bookings.length,
      }));

      return res.status(200).json({
        message: "Bookings fetched successfully",
        count: formattedBookings.length,
        total: totalCount,
        page: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        bookings: formattedBookings,
      });
    } catch (e) {
      console.error("Error fetching bookings:", e);
      return res.status(500).json({
        errorMessage: "Failed to fetch bookings",
      });
    }
  }
);

userRouter.get(
  "/bookingdetails/:groupId",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const { groupId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    if (!groupId) {
      return res.status(400).json({ errorMessage: "Group ID is required" });
    }

    try {
      const bookingGroup = await prisma.bookingGroup.findUnique({
        where: { id: groupId },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          trip: {
            include: {
              bus: {
                select: {
                  busNumber: true,
                  name: true,
                  type: true,
                  layoutType: true,
                },
              },
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
      });

      if (!bookingGroup) {
        return res.status(404).json({ errorMessage: "Booking not found" });
      }

      // Verify ownership
      if (bookingGroup.userId !== userId) {
        return res.status(403).json({
          errorMessage: "Unauthorized: This booking doesn't belong to you",
        });
      }

      const response = {
        bookingGroupId: bookingGroup.id,
        status: bookingGroup.status,
        totalPrice: bookingGroup.totalPrice,
        bookedAt: bookingGroup.createdAt,
        updatedAt: bookingGroup.updatedAt,
        passenger: {
          name: bookingGroup.user.name,
          email: bookingGroup.user.email,
        },
        trip: {
          tripId: bookingGroup.tripId,
          tripDate: bookingGroup.trip.tripDate,
          status: bookingGroup.trip.status,
        },
        bus: {
          busNumber: bookingGroup.trip.bus.busNumber,
          name: bookingGroup.trip.bus.name,
          type: bookingGroup.trip.bus.type,
          layoutType: bookingGroup.trip.bus.layoutType,
        },
        route: {
          from: {
            id: bookingGroup.fromStop.id,
            name: bookingGroup.fromStop.name,
            city: bookingGroup.fromStop.city,
            departureTime: bookingGroup.fromStop.departureTime,
            stopIndex: bookingGroup.fromStop.stopIndex,
          },
          to: {
            id: bookingGroup.toStop.id,
            name: bookingGroup.toStop.name,
            city: bookingGroup.toStop.city,
            arrivalTime: bookingGroup.toStop.arrivalTime,
            stopIndex: bookingGroup.toStop.stopIndex,
          },
        },
        seats: bookingGroup.bookings.map((booking) => ({
          bookingId: booking.id,
          seatNumber: booking.seat.seatNumber,
          type: booking.seat.type,
          level: booking.seat.level,
          row: booking.seat.row,
          column: booking.seat.column,
          status: booking.status,
          cancelledAt: booking.cancelledAt,
        })),
      };

      return res.status(200).json({
        message: "Booking details fetched successfully",
        booking: response,
      });
    } catch (e) {
      console.error("Error fetching booking details:", e);
      return res.status(500).json({
        errorMessage: "Failed to fetch booking details",
      });
    }
  }
);

/**
 * GET /user/booking/download-ticket/:groupId
 * Download booking ticket as PDF
 */
userRouter.get(
  "/booking/download-ticket/:groupId",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const { groupId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    if (!groupId) {
      return res.status(400).json({ errorMessage: "Group ID is required" });
    }

    try {
      // Fetch complete booking details
      const bookingGroup = await prisma.bookingGroup.findUnique({
        where: { id: groupId },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          trip: {
            include: {
              bus: {
                select: {
                  busNumber: true,
                  name: true,
                  type: true,
                },
              },
            },
          },
          fromStop: true,
          toStop: true,
          boardingPoint: true,
          droppingPoint: true,
          offer: {
            select: {
              code: true,
            },
          },
          bookings: {
            include: {
              seat: true,
              passenger: true,
            },
          },
        },
      });

      if (!bookingGroup) {
        return res.status(404).json({ errorMessage: "Booking not found" });
      }

      // Verify ownership
      if (bookingGroup.userId !== userId) {
        return res.status(403).json({
          errorMessage: "Unauthorized: This booking doesn't belong to you",
        });
      }

      const { generateTicketPDF } = await import("../services/pdfService.js");

      // Fetch payment details
      const payment = await prisma.payment.findUnique({
        where: { bookingGroupId: bookingGroup.id },
      });

      // Prepare ticket data
      const ticketData = {
        bookingGroupId: bookingGroup.id,
        bookedAt: bookingGroup.createdAt.toISOString(),
        user: {
          name: bookingGroup.user.name,
          email: bookingGroup.user.email,
        },
        trip: {
          tripDate: bookingGroup.trip.tripDate.toISOString(),
          tripStatus: bookingGroup.trip.status,
        },
        bus: {
          busNumber: bookingGroup.trip.bus.busNumber,
          name: bookingGroup.trip.bus.name,
          type: bookingGroup.trip.bus.type,
        },
        route: {
          from: {
            name: bookingGroup.fromStop.name,
            city: bookingGroup.fromStop.city,
            departureTime: bookingGroup.fromStop.departureTime,
          },
          to: {
            name: bookingGroup.toStop.name,
            city: bookingGroup.toStop.city,
            arrivalTime: bookingGroup.toStop.arrivalTime,
          },
        },
        boardingPoint: bookingGroup.boardingPoint
          ? {
              name: bookingGroup.boardingPoint.name,
              landmark: bookingGroup.boardingPoint.landmark,
              time: bookingGroup.boardingPoint.time,
            }
          : null,
        droppingPoint: bookingGroup.droppingPoint
          ? {
              name: bookingGroup.droppingPoint.name,
              landmark: bookingGroup.droppingPoint.landmark,
              time: bookingGroup.droppingPoint.time,
            }
          : null,
        seats: bookingGroup.bookings.map((booking) => ({
          seatNumber: booking.seat.seatNumber,
          seatLevel: booking.seat.level,
          seatType: booking.seat.type,
          fare: 0, // Calculate if needed from stop prices
          passenger: {
            name: booking.passenger?.name || "Passenger",
            age: booking.passenger?.age || 0,
            gender: booking.passenger?.gender || "MALE",
          },
        })),
        pricing: {
          totalPrice: bookingGroup.totalPrice,
          discountAmount: bookingGroup.discountAmount || 0,
          finalPrice: bookingGroup.finalPrice || bookingGroup.totalPrice,
          couponCode: bookingGroup.offer?.code,
        },
        payment: payment
          ? {
              method: payment.method,
              amountPaid: payment.chargedAmount,
              currency: payment.chargedCurrency,
            }
          : undefined,
        status: bookingGroup.status,
      } as TicketData;

      // Generate PDF
      const pdfBuffer = await generateTicketPDF(ticketData);

      // Set response headers for PDF download
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=ticket-${groupId}.pdf`
      );
      res.setHeader("Content-Length", pdfBuffer.length);

      return res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating ticket PDF:", error);
      return res.status(500).json({
        errorMessage: "Failed to generate ticket PDF",
      });
    }
  }
);

/**
 * GET /user/notifications
 * Get user notifications
 */
userRouter.get(
  "/notifications",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;
    const { unreadOnly, limit } = req.query;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    try {
      const notifications = await getUserNotifications(
        userId,
        unreadOnly === "true",
        limit ? parseInt(limit as string) : 50
      );

      const unreadCount = await getUnreadCount(userId);

      return res.status(200).json({
        message: "Notifications fetched successfully",
        notifications,
        unreadCount,
      });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch notifications" });
    }
  }
);

/**
 * GET /user/notifications/unread-count
 * Get unread notification count
 */
userRouter.get(
  "/notifications/unread-count",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    try {
      const count = await getUnreadCount(userId);
      return res.status(200).json({ unreadCount: count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to fetch unread count" });
    }
  }
);

/**
 * PATCH /user/notifications/:notificationId/read
 * Mark notification as read
 */
userRouter.patch(
  "/notifications/:notificationId/read",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;
    const { notificationId } = req.params;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    if (!notificationId) {
      return res
        .status(400)
        .json({ errorMessage: "Notification ID is required" });
    }

    try {
      const notification = await markNotificationAsRead(notificationId, userId);
      return res.status(200).json({
        message: "Notification marked as read",
        notification,
      });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to update notification" });
    }
  }
);

/**
 * PATCH /user/notifications/read-all
 * Mark all notifications as read
 */
userRouter.patch(
  "/notifications/read-all",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    try {
      await prisma.notification.updateMany({
        where: {
          userId,
          isRead: false,
        },
        data: {
          isRead: true,
        },
      });

      return res.status(200).json({
        message: "All notifications marked as read",
      });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      return res
        .status(500)
        .json({ errorMessage: "Failed to update notifications" });
    }
  }
);

/**
 * POST /user/booking/apply-coupon
 * Apply coupon and check validity
 */
userRouter.post(
  "/booking/apply-coupon",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;
    const { code, tripId, totalAmount } = req.body;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    // Validate input
    const validation = applyCouponSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        errorMessage: "Invalid coupon data",
        errors: validation.error.issues,
      });
    }

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          busId: true,
          bus: {
            select: {
              adminId: true,
            },
          },
        },
      });

      if (!trip) {
        return res.status(404).json({ errorMessage: "Trip not found" });
      }

      // Find offer
      const offer = await prisma.offer.findUnique({
        where: { code: code.toUpperCase() },
      });

      if (!offer) {
        return res.status(404).json({ errorMessage: "Invalid coupon code" });
      }

      // Check if offer is active
      if (!offer.isActive) {
        return res
          .status(400)
          .json({ errorMessage: "This coupon is no longer active" });
      }

      // Check validity period
      const now = new Date();
      if (now < offer.validFrom || now > offer.validUntil) {
        return res.status(400).json({
          errorMessage: "This coupon has expired or is not yet valid",
        });
      }

      // Check usage limit
      if (!hasRemainingUsage(offer)) {
        return res
          .status(400)
          .json({ errorMessage: "This coupon has reached its usage limit" });
      }

      // Check minimum booking amount
      if (offer.minBookingAmount && totalAmount < offer.minBookingAmount) {
        return res.status(400).json({
          errorMessage: `Minimum booking amount of ₹${offer.minBookingAmount} required`,
        });
      }

      if (offer.creatorRole === OfferCreatorRole.ADMIN) {
        if (!trip.bus?.adminId || trip.bus.adminId !== offer.createdBy) {
          return res.status(400).json({
            errorMessage: "This coupon is not applicable to this bus",
          });
        }
      }

      // Check if applicable to this trip
      if (
        offer.applicableBuses.length > 0 &&
        !offer.applicableBuses.includes(trip.busId)
      ) {
        return res.status(400).json({
          errorMessage: "This coupon is not applicable to this bus",
        });
      }

      // Calculate discount
      const discountAmount = calculateDiscountAmount(offer, totalAmount);
      const finalAmount = Math.max(0, totalAmount - discountAmount);

      return res.status(200).json({
        message: "Coupon applied successfully",
        offer: {
          id: offer.id,
          code: offer.code,
          description: offer.description,
          creatorRole: offer.creatorRole,
        },
        originalAmount: totalAmount,
        discountAmount,
        finalAmount,
      });
    } catch (error) {
      console.error("Error applying coupon:", error);
      return res.status(500).json({ errorMessage: "Failed to apply coupon" });
    }
  }
);

/**
 * GET /user/trip/:tripId/coupons
 * Fetch eligible coupons for a trip
 */
userRouter.get(
  "/trip/:tripId/coupons",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const { tripId } = req.params;
    const { totalAmount } = req.query;

    if (!tripId) {
      return res.status(400).json({ errorMessage: "Trip ID is required" });
    }

    const parsedTotalAmount =
      totalAmount !== undefined ? Number(totalAmount) : null;

    if (
      parsedTotalAmount !== null &&
      (Number.isNaN(parsedTotalAmount) || parsedTotalAmount < 0)
    ) {
      return res.status(400).json({
        errorMessage: "totalAmount must be a positive number",
      });
    }

    try {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          busId: true,
          bus: {
            select: {
              adminId: true,
              name: true,
            },
          },
        },
      });

      if (!trip) {
        return res.status(404).json({ errorMessage: "Trip not found" });
      }

      const now = new Date();

      const offers = await prisma.offer.findMany({
        where: {
          isActive: true,
          validFrom: { lte: now },
          validUntil: { gte: now },
          OR: [
            { creatorRole: OfferCreatorRole.SUPERADMIN },
            {
              creatorRole: OfferCreatorRole.ADMIN,
              createdBy: trip.bus?.adminId || "",
              applicableBuses: { has: trip.busId },
            },
          ],
        },
        include: {
          _count: {
            select: {
              bookingGroups: true,
            },
          },
        },
        orderBy: [{ creatorRole: "desc" }, { validUntil: "asc" }],
      });

      const coupons = offers
        .filter((offer) => hasRemainingUsage(offer))
        .map((offer) => {
          const meetsMinAmount =
            parsedTotalAmount !== null
              ? parsedTotalAmount >= (offer.minBookingAmount || 0)
              : true;

          const potentialDiscount =
            parsedTotalAmount !== null && meetsMinAmount
              ? calculateDiscountAmount(offer, parsedTotalAmount)
              : null;

          return {
            id: offer.id,
            code: offer.code,
            description: offer.description,
            discountType: offer.discountType,
            discountValue: offer.discountValue,
            maxDiscount: offer.maxDiscount,
            minBookingAmount: offer.minBookingAmount,
            usageLimit: offer.usageLimit,
            usageCount: offer.usageCount,
            remainingUsage: offer.usageLimit
              ? Math.max(offer.usageLimit - offer.usageCount, 0)
              : null,
            validFrom: offer.validFrom,
            validUntil: offer.validUntil,
            applicableBuses: offer.applicableBuses,
            creatorRole: offer.creatorRole,
            createdBy: offer.createdBy,
            meetsMinAmount,
            potentialDiscount,
          };
        });

      return res.status(200).json({
        message: "Eligible coupons fetched successfully",
        coupons,
        count: coupons.length,
      });
    } catch (error) {
      console.error("Error fetching coupons:", error);
      return res.status(500).json({ errorMessage: "Failed to fetch coupons" });
    }
  }
);

/**
 * PATCH /user/profile
 * Update user profile
 */
userRouter.patch(
  "/profile",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;
    const { name, phone } = req.body;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(name && { name }),
          ...(phone && { phone }),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
        },
      });

      return res.status(200).json({
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      return res.status(500).json({ errorMessage: "Failed to update profile" });
    }
  }
);

/**
 * GET /user/profile
 * Get user profile
 */
userRouter.get(
  "/profile",
  authenticateUser,
  async (req: AuthRequest, res): Promise<any> => {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ errorMessage: "User not authenticated" });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          verified: true,
          createdAt: true,
        },
      });

      if (!user) {
        return res.status(404).json({ errorMessage: "User not found" });
      }

      // Get booking statistics
      const bookingStats = await prisma.bookingGroup.aggregate({
        where: {
          userId,
          status: "CONFIRMED",
        },
        _count: true,
        _sum: {
          totalPrice: true,
        },
      });

      return res.status(200).json({
        message: "Profile fetched successfully",
        user,
        statistics: {
          totalBookings: bookingStats._count,
          totalSpent: bookingStats._sum.totalPrice || 0,
        },
      });
    } catch (error) {
      console.error("Error fetching profile:", error);
      return res.status(500).json({ errorMessage: "Failed to fetch profile" });
    }
  }
);

/**
 * GET /user/offers
 * Get active public offers (no authentication required)
 */
userRouter.get("/offers", async (req, res): Promise<any> => {
  try {
    const now = new Date();

    const offers = await prisma.offer.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
      orderBy: [{ creatorRole: "desc" }, { createdAt: "desc" }],
      take: 10,
    });

    // Enrich offers with bus service name for admin-created offers
    const enrichedOffers = await Promise.all(
      offers.map(async (offer) => {
        if (offer.creatorRole === "ADMIN") {
          // Fetch the admin user to get bus service name
          const admin = await prisma.user.findUnique({
            where: { id: offer.createdBy },
            select: { busServiceName: true },
          });
          return {
            ...offer,
            busServiceName: admin?.busServiceName || "Unknown Service",
          };
        }
        return offer;
      })
    );

    return res.status(200).json({
      message: "Offers fetched successfully",
      offers: enrichedOffers,
    });
  } catch (error) {
    console.error("Error fetching offers:", error);
    return res.status(500).json({ errorMessage: "Failed to fetch offers" });
  }
});

/**
 * GET /user/trip/:tripId/seats
 * Get seat layout and booking status for a trip
 */
userRouter.get("/trip/:tripId/seats", async (req, res): Promise<any> => {
  try {
    const { tripId } = req.params;

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: {
          include: {
            seats: {
              include: {
                bookings: {
                  where: {
                    tripId: tripId,
                    status: "CONFIRMED",
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!trip) {
      return res.status(404).json({ errorMessage: "Trip not found" });
    }

    const seatsWithStatus = trip.bus.seats.map((seat: any) => ({
      id: seat.id,
      seatNumber: seat.seatNumber,
      type: seat.type,
      level: seat.level,
      row: seat.row,
      column: seat.column,
      rowSpan: seat.rowSpan,
      columnSpan: seat.columnSpan,
      isBooked: seat.bookings.length > 0,
      isActive: seat.isActive,
    }));

    return res.status(200).json({
      message: "Seats fetched successfully",
      seats: seatsWithStatus,
      gridRows: trip.bus.gridRows,
      gridColumns: trip.bus.gridColumns,
      busType: trip.bus.type,
      layoutType: trip.bus.layoutType,
    });
  } catch (error) {
    console.error("Error fetching seats:", error);
    return res.status(500).json({ errorMessage: "Failed to fetch seats" });
  }
});

export default userRouter;
