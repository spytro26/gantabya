import { CurrencyCode, PaymentMethod } from "@prisma/client";
import { getPaymentConfig } from "../../config/paymentConfig.js";

type ConversionResult = {
  baseAmount: number;
  baseCurrency: CurrencyCode;
  chargedAmount: number;
  chargedCurrency: CurrencyCode;
  exchangeRate?: number;
};

export const calculatePaymentAmounts = (
  method: PaymentMethod,
  amountInNpr: number
): ConversionResult => {
  const config = getPaymentConfig();
  const baseCurrency = CurrencyCode.NPR;
  const roundedBase = roundToTwo(amountInNpr);

  if (method === PaymentMethod.RAZORPAY) {
    const rate = config.currency.razorpayConversionRate;
    const amountInInr = roundToTwo(roundedBase * rate);

    return {
      baseAmount: roundedBase,
      baseCurrency,
      chargedAmount: amountInInr,
      chargedCurrency: CurrencyCode.INR,
      exchangeRate: rate,
    };
  }

  return {
    baseAmount: roundedBase,
    baseCurrency,
    chargedAmount: roundedBase,
    chargedCurrency: CurrencyCode.NPR,
  };
};

export const convertToMinorUnits = (amount: number, currency: CurrencyCode) => {
  if (currency === CurrencyCode.INR) {
    // Razorpay expects amount in paise (INR * 100)
    return Math.round(amount * 100);
  }

  // eSewa accepts amount in rupees (no conversion to paisa needed)
  return Math.round(amount);
};

const roundToTwo = (value: number) => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};
