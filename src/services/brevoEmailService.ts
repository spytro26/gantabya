import * as brevo from "@getbrevo/brevo";
import "dotenv/config";
import { getDualDateForPDF } from "../utils/nepaliDateConverter.js";

const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY || ""
);

/**
 * Generate a 6-digit OTP
 */
function generateOTP(): number {
  const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let otp = 0;

  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * arr.length);
    const digit = arr[idx] ?? 0;
    otp = otp * 10 + digit;
  }
  return otp;
}

/**
 * Send OTP email via Brevo for signup or password reset
 */
export async function sendOTPEmail(
  userEmail: string,
  purpose: "signup" | "password-reset" = "signup"
): Promise<number> {
  const otp = generateOTP();
  console.log(`Generated OTP for ${userEmail}: ${otp}`);

  const subject =
    purpose === "signup"
      ? "Email Verification - Go Gantabya"
      : "Password Reset OTP - Go Gantabya";

  const htmlContent = `
  <div style="font-family: Arial, sans-serif; background: #f9fafc; padding: 20px; border-radius: 10px; text-align: center;">
    <h2 style="color: #333;">Welcome to <span style="color: #007bff;">Go Gantabya</span> 🚍</h2>
    <p style="color: #555; font-size: 16px;">${
      purpose === "signup"
        ? "Thank you for signing up!"
        : "You requested a password reset."
    }</p>

    <div style="background: #ffffff; border: 1px solid #eee; border-radius: 8px; display: inline-block; padding: 15px 30px; margin-top: 20px;">
      <h1 style="letter-spacing: 4px; color: #007bff; margin: 0;">${otp}</h1>
    </div>

    <p style="margin-top: 25px; color: #666;">This OTP will expire in <b>10 minutes</b>.</p>
    <p style="font-size: 12px; color: #aaa; margin-top: 20px;">If you didn't request this, please ignore this email.</p>
  </div>
  `;

  try {
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = {
      name: process.env.BREVO_SENDER_NAME || "Go Gantabya",
      email: process.env.BREVO_SENDER_EMAIL || "noreply@gogantabya.com",
    };
    sendSmtpEmail.to = [{ email: userEmail }];

    const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(
      "Brevo email sent successfully:",
      (response as any).messageId || "Email sent"
    );
  } catch (error) {
    console.error("Error sending email via Brevo:", error);
    throw new Error("Failed to send OTP email");
  }

  return otp;
}

/**
 * Send booking confirmation email with PDF attachment via Brevo
 */
export async function sendBookingConfirmationEmail(
  userEmail: string,
  userName: string,
  bookingDetails: {
    bookingGroupId: string;
    busName: string;
    busNumber: string;
    tripDate: string;
    fromStop: string;
    toStop: string;
    boardingPoint: string;
    boardingTime: string;
    droppingPoint: string;
    seats: Array<{
      seatNumber: string;
      passengerName: string;
      age: number;
      gender: string;
      level: string;
      type: string;
    }>;
    totalPrice: number;
    discountAmount: number;
    finalPrice: number;
    couponCode?: string;
    bookedAt: string;
  },
  pdfBuffer: Buffer
): Promise<void> {
  // Get dual date display for trip date
  const tripDateDual = getDualDateForPDF(bookingDetails.tripDate);

  const htmlContent = `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafc; padding: 20px; border-radius: 10px;">
    <div style="text-align: center; margin-bottom: 20px;">
      <h2 style="color: #007bff; margin: 0;">Go Gantabya 🚍</h2>
      <p style="color: #666; font-size: 14px;">Your Journey Partner</p>
    </div>

    <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h3 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Booking Confirmed! 🎉</h3>
      
      <p style="color: #555;">Dear <strong>${userName}</strong>,</p>
      <p style="color: #555;">Your bus ticket has been successfully booked. Please find your ticket attached as a PDF.</p>

      <div style="background: #f0f7ff; padding: 15px; border-radius: 5px; margin: 15px 0;">
        <p style="margin: 5px 0;"><strong>Bus:</strong> ${
          bookingDetails.busName
        } (${bookingDetails.busNumber})</p>
        <p style="margin: 5px 0;"><strong>Date (AD):</strong> ${
          tripDateDual.ad
        }</p>
        <p style="margin: 5px 0;"><strong>Date (BS):</strong> ${
          tripDateDual.bs
        }</p>
        <p style="margin: 5px 0;"><strong>Route:</strong> ${
          bookingDetails.fromStop
        } → ${bookingDetails.toStop}</p>
        <p style="margin: 5px 0;"><strong>Boarding:</strong> ${
          bookingDetails.boardingPoint
        } at ${bookingDetails.boardingTime}</p>
        <p style="margin: 5px 0;"><strong>Seats:</strong> ${bookingDetails.seats
          .map((s) => s.seatNumber)
          .join(", ")}</p>
      </div>

      <p style="color: #555; font-size: 14px; margin-top: 20px;">Please arrive at the boarding point 15 minutes before departure. Show your ticket to the bus conductor.</p>

      <div style="border-top: 1px solid #ddd; margin-top: 20px; padding-top: 15px;">
        <p style="color: #999; font-size: 12px; margin: 5px 0;">Have a safe journey!</p>
        <p style="color: #999; font-size: 12px; margin: 5px 0;">- Team Go Gantabya</p>
      </div>
    </div>

    <div style="text-align: center; margin-top: 20px; color: #999; font-size: 11px;">
      <p>This is an automated email. Please do not reply.</p>
    </div>
  </div>
  `;

  try {
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `Booking Confirmed - ${bookingDetails.busName} | Go Gantabya`;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.sender = {
      name: process.env.BREVO_SENDER_NAME || "Go Gantabya",
      email: process.env.BREVO_SENDER_EMAIL || "noreply@gogantabya.com",
    };
    sendSmtpEmail.to = [{ email: userEmail, name: userName }];

    // Attach PDF ticket
    sendSmtpEmail.attachment = [
      {
        content: pdfBuffer.toString("base64"),
        name: `ticket-${bookingDetails.bookingGroupId}.pdf`,
      },
    ];

    const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(
      "Booking confirmation email sent successfully:",
      (response as any).messageId || "Email sent"
    );
  } catch (error) {
    console.error("Error sending booking confirmation email via Brevo:", error);
    throw new Error("Failed to send booking confirmation email");
  }
}
