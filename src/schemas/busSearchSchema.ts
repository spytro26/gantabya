import z from "zod";

export const busSearchSchema = z.object({
  startLocation: z
    .string()
    .min(2, "Start location must be at least 2 characters"),
  endLocation: z.string().min(2, "End location must be at least 2 characters"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
});

export const bookTicketSchema = z.object({
  tripId: z.string().uuid("Invalid trip ID"),
  fromStopId: z.string().uuid("Invalid from stop ID"),
  toStopId: z.string().uuid("Invalid to stop ID"),
  seatIds: z
    .array(z.string().uuid("Invalid seat ID"))
    .min(1, "At least one seat must be selected")
    .max(6, "Maximum 6 seats per booking"),
  passengers: z
    .array(
      z.object({
        seatId: z.string().uuid("Invalid seat ID"),
        name: z.string().min(2, "Name must be at least 2 characters"),
        age: z.number().int().min(1).max(120, "Age must be between 1 and 120"),
        gender: z.enum(["MALE", "FEMALE", "OTHER"]),
        phone: z.string().optional(),
        email: z.string().email().optional(),
      })
    )
    .min(1, "Passenger details required for all seats"),
  boardingPointId: z.string().uuid("Invalid boarding point ID"),
  droppingPointId: z.string().uuid("Invalid dropping point ID"),
  couponCode: z.string().optional(), // Optional coupon code
});

export const applyCouponSchema = z.object({
  code: z.string().min(1, "Coupon code is required"),
  tripId: z.string().uuid("Invalid trip ID"),
  totalAmount: z.number().positive("Amount must be positive"),
});

// Enhanced search schema with filters
export const enhancedSearchSchema = z.object({
  startLocation: z
    .string()
    .min(2, "Start location must be at least 2 characters"),
  endLocation: z.string().min(2, "End location must be at least 2 characters"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  // Filters
  busType: z.enum(["SEATER", "SLEEPER", "MIXED"]).optional(),
  hasWifi: z.boolean().optional(),
  hasAC: z.boolean().optional(),
  hasCharging: z.boolean().optional(),
  hasRestroom: z.boolean().optional(),
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  departureTimeStart: z.string().optional(), // HH:MM format
  departureTimeEnd: z.string().optional(),
  sortBy: z
    .enum(["price", "duration", "departureTime", "seatsAvailable"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const cancelTicketSchema = z.object({
  bookingGroupId: z.string().uuid("Invalid booking group ID"),
});

export const busInfoQuerySchema = z.object({
  fromStopId: z.string().uuid("Invalid from stop ID"),
  toStopId: z.string().uuid("Invalid to stop ID"),
});
