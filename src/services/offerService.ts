import { prisma } from "../index.js";
import { DiscountType, OfferCreatorRole, Prisma } from "@prisma/client";

export interface OfferPayload {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscount?: number | null;
  validFrom: string | Date;
  validUntil: string | Date;
  minBookingAmount?: number | null;
  usageLimit?: number | null;
  applicableBuses?: string[] | null;
}

export interface OfferActor {
  id: string;
  role: OfferCreatorRole;
}

class OfferValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function ensurePositiveNumber(
  value: number | null | undefined,
  field: string,
  allowZero = false
) {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new OfferValidationError(`${field} must be a number`);
  }

  if (value < 0 || (!allowZero && value === 0)) {
    throw new OfferValidationError(`${field} must be greater than 0`);
  }
}

function parseDate(input: string | Date, field: string): Date {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new OfferValidationError(`${field} must be a valid date`);
  }
  return date;
}

async function getAdminOwnedBusIds(adminId: string): Promise<string[]> {
  const buses = await prisma.bus.findMany({
    where: { adminId },
    select: { id: true },
  });

  if (!buses.length) {
    throw new OfferValidationError(
      "You need at least one active bus before creating coupons",
      400
    );
  }

  return buses.map((bus) => bus.id);
}

export async function sanitizeApplicableBusesForAdmin(
  rawBusIds: string[] | null | undefined,
  adminId: string
): Promise<string[]> {
  const ownedBusIds = await getAdminOwnedBusIds(adminId);

  const requestedBusIds = Array.from(
    new Set(
      (rawBusIds || [])
        .filter((id): id is string => Boolean(id))
        .map((id) => id.trim())
    )
  );

  if (requestedBusIds.length === 0) {
    return ownedBusIds;
  }

  const invalidBusIds = requestedBusIds.filter(
    (id) => !ownedBusIds.includes(id)
  );

  if (invalidBusIds.length > 0) {
    throw new OfferValidationError(
      "Coupons can only target buses owned by your service",
      403
    );
  }

  return requestedBusIds;
}

async function resolveApplicableBuses(
  payload: OfferPayload,
  actor: OfferActor
): Promise<string[]> {
  if (actor.role === OfferCreatorRole.SUPERADMIN) {
    // Super admin coupons are always global
    return [];
  }

  return sanitizeApplicableBusesForAdmin(payload.applicableBuses, actor.id);
}

export async function createOffer(payload: OfferPayload, actor: OfferActor) {
  if (!payload.code || !payload.code.trim()) {
    throw new OfferValidationError("Coupon code is required");
  }

  if (!payload.description || !payload.description.trim()) {
    throw new OfferValidationError("Description is required");
  }

  if (!payload.discountType) {
    throw new OfferValidationError("Discount type is required");
  }

  if (!Object.values(DiscountType).includes(payload.discountType)) {
    throw new OfferValidationError("Invalid discount type");
  }

  ensurePositiveNumber(payload.discountValue, "Discount value", false);
  ensurePositiveNumber(payload.maxDiscount ?? undefined, "Max discount", false);
  ensurePositiveNumber(
    payload.minBookingAmount ?? undefined,
    "Minimum booking amount",
    false
  );
  ensurePositiveNumber(payload.usageLimit ?? undefined, "Usage limit", false);

  if (
    payload.usageLimit !== null &&
    payload.usageLimit !== undefined &&
    !Number.isInteger(payload.usageLimit)
  ) {
    throw new OfferValidationError("Usage limit must be an integer");
  }

  if (
    payload.discountType === DiscountType.PERCENTAGE &&
    payload.discountValue > 100
  ) {
    throw new OfferValidationError("Percentage discount cannot exceed 100%");
  }

  if (
    payload.discountType === DiscountType.FIXED_AMOUNT &&
    payload.maxDiscount
  ) {
    throw new OfferValidationError(
      "Max discount is only applicable for percentage based coupons"
    );
  }

  const validFromDate = parseDate(payload.validFrom, "Valid from");
  const validUntilDate = parseDate(payload.validUntil, "Valid until");

  if (validUntilDate <= validFromDate) {
    throw new OfferValidationError("Valid until must be later than valid from");
  }

  const cleanedCode = payload.code.trim().toUpperCase();

  const existingOffer = await prisma.offer.findUnique({
    where: { code: cleanedCode },
  });

  if (existingOffer) {
    throw new OfferValidationError(
      "An offer with this code already exists",
      409
    );
  }

  const applicableBuses = await resolveApplicableBuses(payload, actor);

  const offer = await prisma.offer.create({
    data: {
      code: cleanedCode,
      description: payload.description.trim(),
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      maxDiscount: payload.maxDiscount ?? null,
      validFrom: validFromDate,
      validUntil: validUntilDate,
      minBookingAmount: payload.minBookingAmount ?? null,
      usageLimit: payload.usageLimit ?? null,
      applicableBuses,
      createdBy: actor.id,
      creatorRole: actor.role,
    },
  });

  return offer;
}

export function mapOfferWithUsage(offer: any) {
  const { _count, ...rest } = offer;
  return {
    ...rest,
    usageCount: _count?.bookingGroups ?? offer.usageCount ?? 0,
  };
}

export function handleOfferError(error: unknown, res: any) {
  if (error instanceof OfferValidationError) {
    return res.status(error.statusCode).json({ errorMessage: error.message });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return res
        .status(409)
        .json({ errorMessage: "An offer with this code already exists" });
    }
  }

  console.error("Offer operation failed:", error);
  return res.status(500).json({ errorMessage: "Failed to process offer" });
}
