import { prisma } from "../index.js";
import { sendGmail } from "../user/sendmail.js";

export interface NotificationData {
  userId: string;
  type:
    | "BOOKING_CONFIRMED"
    | "BOOKING_CANCELLED"
    | "TRIP_CANCELLED"
    | "OFFER_APPLIED"
    | "TRIP_REMINDER"
    | "GENERAL";
  title: string;
  message: string;
  metadata?: any;
  sendEmail?: boolean;
}

/**
 * Create a notification in the database
 */
export async function createNotification(data: NotificationData) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        metadata: data.metadata || {},
      },
    });

    // Send email if requested
    if (data.sendEmail) {
      const user = await prisma.user.findUnique({
        where: { id: data.userId },
        select: { email: true, name: true },
      });

      if (user) {
        await sendEmailNotification(
          user.email,
          user.name,
          data.title,
          data.message
        );
      }
    }

    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

/**
 * Send email notification
 */
async function sendEmailNotification(
  email: string,
  name: string,
  subject: string,
  message: string
) {
  try {
    // Using existing sendGmail function to send HTML email
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #d32f2f; color: white; padding: 20px; text-align: center; }
            .content { background: #f9f9f9; padding: 30px; }
            .footer { background: #333; color: white; padding: 15px; text-align: center; font-size: 12px; }
            .button { background: #d32f2f; color: white; padding: 12px 30px; text-decoration: none; display: inline-block; margin: 20px 0; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚌 RedBus Notification</h1>
            </div>
            <div class="content">
              <h2>Hello ${name}!</h2>
              <p>${message}</p>
              <a href="http://localhost:3000/user/mybookings" class="button">View My Bookings</a>
            </div>
            <div class="footer">
              <p>© 2025 RedBus Clone. All rights reserved.</p>
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Note: sendGmail currently sends OTP, we'll enhance it to send HTML emails
    console.log(`Email would be sent to ${email} with subject: ${subject}`);
    // For now, just log. In production, use a proper email service like SendGrid or AWS SES
  } catch (error) {
    console.error("Error sending email notification:", error);
  }
}

/**
 * Create notification for booking confirmation
 */
export async function notifyBookingConfirmed(
  userId: string,
  bookingGroupId: string,
  tripDetails: {
    busName: string;
    busNumber: string;
    date: string;
    from: string;
    to: string;
    seatNumbers: string[];
    totalPrice: number;
  }
) {
  const seatList = tripDetails.seatNumbers.join(", ");
  
  // Format date nicely (remove time portion)
  const dateObj = new Date(tripDetails.date);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return createNotification({
    userId,
    type: "BOOKING_CONFIRMED",
    title: "Booking Confirmed",
    message: `Your booking for ${tripDetails.busName} (${tripDetails.busNumber}) from ${tripDetails.from} to ${tripDetails.to} on ${formattedDate} has been confirmed. Seats: ${seatList}. Total: ₹${tripDetails.totalPrice}`,
    metadata: {
      bookingGroupId,
      tripDetails,
    },
    sendEmail: true,
  });
}

/**
 * Create notification for booking cancellation
 */
export async function notifyBookingCancelled(
  userId: string,
  bookingGroupId: string,
  refundAmount: number
) {
  return createNotification({
    userId,
    type: "BOOKING_CANCELLED",
    title: "Booking Cancelled",
    message: `Your booking has been cancelled successfully. Refund amount: ₹${refundAmount} will be processed within 5-7 business days.`,
    metadata: {
      bookingGroupId,
      refundAmount,
    },
    sendEmail: true,
  });
}

/**
 * Create notification for trip cancellation by admin
 */
export async function notifyTripCancelled(
  userId: string,
  tripDetails: {
    busName: string;
    date: string;
    from: string;
    to: string;
  }
) {
  return createNotification({
    userId,
    type: "TRIP_CANCELLED",
    title: "Trip Cancelled by Operator",
    message: `Unfortunately, the trip ${tripDetails.busName} scheduled for ${tripDetails.date} (${tripDetails.from} to ${tripDetails.to}) has been cancelled. Full refund will be initiated automatically.`,
    metadata: tripDetails,
    sendEmail: true,
  });
}

/**
 * Create notification for offer applied
 */
export async function notifyOfferApplied(
  userId: string,
  offerCode: string,
  discountAmount: number
) {
  return createNotification({
    userId,
    type: "OFFER_APPLIED",
    title: "Coupon Applied Successfully",
    message: `Coupon code "${offerCode}" applied successfully. You saved ₹${discountAmount} on this booking!`,
    metadata: {
      offerCode,
      discountAmount,
    },
    sendEmail: false,
  });
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(
  notificationId: string,
  userId: string
) {
  return prisma.notification.update({
    where: {
      id: notificationId,
      userId, // Ensure user owns the notification
    },
    data: {
      isRead: true,
    },
  });
}

/**
 * Get user notifications
 */
export async function getUserNotifications(
  userId: string,
  unreadOnly: boolean = false,
  limit: number = 50
) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly && { isRead: false }),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  });
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  });
}
