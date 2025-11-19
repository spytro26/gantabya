import "dotenv/config";

const requireEnv = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const requireNumberEnv = (key: string, fallback?: number) => {
  const raw = process.env[key];
  if (!raw || raw.trim() === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing required numeric environment variable: ${key}`);
  }

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
};

export const getPaymentConfig = () => {
  return {
    razorpay: {
      keyId: requireEnv("RAZORPAY_KEY_ID"),
      keySecret: requireEnv("RAZORPAY_KEY_SECRET"),
      currency: "INR" as const,
    },
    esewa: {
      merchantId: requireEnv("ESEWA_MERCHANT_ID"),
      publicKey: requireEnv("ESEWA_PUBLIC_KEY"),
      secretKey: requireEnv("ESEWA_SECRET_KEY"),
      productCode: requireEnv("ESEWA_PRODUCT_CODE"),
      successUrl: requireEnv("ESEWA_SUCCESS_URL"),
      failureUrl: requireEnv("ESEWA_FAILURE_URL"),
      endpoint: requireEnv(
        "ESEWA_ENDPOINT",
        "https://epay.esewa.com.np/api/epay/main"
      ),
      verificationEndpoint: requireEnv(
        "ESEWA_VERIFICATION_ENDPOINT",
        "https://epay.esewa.com.np/api/epay/transaction"
      ),
    },
    currency: {
      baseCurrency: "NPR" as const,
      razorpayConversionRate: requireNumberEnv("NPR_TO_INR_RATE", 0.625),
    },
  } as const;
};

export type PaymentConfig = ReturnType<typeof getPaymentConfig>;
