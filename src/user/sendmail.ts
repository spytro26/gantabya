// Legacy function - now using Brevo email service
// This file is kept for backward compatibility but redirects to Brevo
import { sendOTPEmail } from "../services/brevoEmailService.js";

/**
 * Send OTP email for signup verification
 * Now powered by Brevo
 */
export async function sendGmail(userEmail: string): Promise<number> {
  console.log("Sending OTP email via Brevo to:", userEmail);
  return await sendOTPEmail(userEmail, "signup");
}

/**
 * Send OTP email for password reset
 * Now powered by Brevo
 */
export async function sendPasswordResetOTP(userEmail: string): Promise<number> {
  console.log("Sending password reset OTP via Brevo to:", userEmail);
  return await sendOTPEmail(userEmail, "password-reset");
}
