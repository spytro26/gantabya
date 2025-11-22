import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TicketData {
  bookingGroupId: string;
  bookedAt: string;
  user: {
    name: string;
    email: string;
  };
  trip: {
    tripDate: string;
    tripStatus: string;
  };
  bus: {
    busNumber: string;
    name: string;
    type: string;
  };
  route: {
    from: {
      name: string;
      city: string;
      departureTime: string | null;
    };
    to: {
      name: string;
      city: string;
      arrivalTime: string | null;
    };
  };
  boardingPoint: {
    name: string;
    landmark: string | null;
    time: string;
  } | null;
  droppingPoint: {
    name: string;
    landmark: string | null;
    time: string;
  } | null;
  seats: Array<{
    seatNumber: string;
    seatLevel: string;
    seatType: string;
    fare: number;
    passenger: {
      name: string;
      age: number;
      gender: string;
    };
  }>;
  pricing: {
    totalPrice: number;
    discountAmount: number;
    finalPrice: number;
    couponCode?: string; // Made optional
  };
  payment?:
    | {
        method: string;
        amountPaid: number;
        currency: string;
      }
    | undefined;
  status: string;
}

/**
 * Generate PDF ticket for a booking
 * Returns a Buffer containing the PDF data
 * Designed to fit on a single page with beautiful, modern layout
 */
export async function generateTicketPDF(
  ticketData: TicketData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        bufferPages: true,
      });

      // Register fonts
      const fontPath = path.join(__dirname, "..", "assets", "fonts");
      doc.registerFont(
        "Roboto-Regular",
        path.join(fontPath, "Roboto-Regular.ttf")
      );
      doc.registerFont("Roboto-Bold", path.join(fontPath, "Roboto-Bold.ttf"));

      const buffers: Buffer[] = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 40;
      const contentWidth = pageWidth - 2 * margin;

      // --- Helper Functions ---
      const drawSectionHeader = (text: string, y: number) => {
        doc.roundedRect(margin, y, contentWidth, 25, 4).fill("#f1f5f9");
        doc
          .fillColor("#334155")
          .font("Roboto-Bold")
          .fontSize(10)
          .text(text.toUpperCase(), margin + 10, y + 8);
      };

      const drawLabelValue = (
        label: string,
        value: string,
        x: number,
        y: number,
        width: number
      ) => {
        doc
          .font("Roboto-Regular")
          .fontSize(8)
          .fillColor("#64748b")
          .text(label, x, y);
        doc
          .font("Roboto-Bold")
          .fontSize(10)
          .fillColor("#0f172a")
          .text(value, x, y + 12, { width: width, ellipsis: true });
      };

      const formatDualPrice = (amountInNPR: number) => {
        // Using 0.625 rate to match system-wide configuration
        const amountInINR = (amountInNPR * 0.625).toFixed(2);
        return `NPR ${amountInNPR.toFixed(2)} / INR ${amountInINR}`;
      };

      // ==================== HEADER ====================
      // Blue Header Bar - Matching Navbar (Indigo 700)
      doc.rect(0, 0, pageWidth, 100).fill("#4338ca");

      // Logo & Title Centered
      const logoSize = 50;
      const title = "Go Gantabya";
      doc.font("Roboto-Bold").fontSize(24);
      const titleWidth = doc.widthOfString(title);
      const totalHeaderWidth = logoSize + 15 + titleWidth;
      const startX = (pageWidth - totalHeaderWidth) / 2;

      // Logo - Circular
      try {
        const logoPath = path.join(
          __dirname,
          "..",
          "..",
          "..",
          "front",
          "public",
          "buslogo.jpg"
        );

        doc.save();
        doc
          .circle(startX + logoSize / 2, 30 + logoSize / 2, logoSize / 2)
          .clip();
        doc.image(logoPath, startX, 30, { width: logoSize, height: logoSize });
        doc.restore();
      } catch (e) {
        // Fallback if image fails - just a circle
        doc
          .circle(startX + logoSize / 2, 30 + logoSize / 2, logoSize / 2)
          .fill("#ffffff");
      }

      // Title
      doc
        .fillColor("#ffffff")
        .fontSize(24)
        .text(title, startX + logoSize + 15, 38);

      doc
        .fontSize(10)
        .fillColor("#e0e7ff") // Lighter indigo for subtitle
        .text("Your Journey Partner", startX + logoSize + 15, 65);

      // ==================== TICKET INFO BAR ====================
      let currentY = 120;

      // Container Border
      doc
        .roundedRect(margin, currentY, contentWidth, 60, 8)
        .strokeColor("#e2e8f0")
        .lineWidth(1)
        .stroke();

      // 4 Columns: Booking ID | Booked By | Booked On | Status
      const colW = contentWidth / 4;

      drawLabelValue(
        "Booking Reference",
        ticketData.bookingGroupId.substring(0, 8).toUpperCase(),
        margin + 15,
        currentY + 15,
        colW - 20
      );
      drawLabelValue(
        "Booked By",
        ticketData.user.name,
        margin + colW + 15,
        currentY + 15,
        colW - 20
      );
      drawLabelValue(
        "Booked On",
        new Date(ticketData.bookedAt).toLocaleDateString("en-IN"),
        margin + 2 * colW + 15,
        currentY + 15,
        colW - 20
      );

      // Status Badge
      const statusColor =
        ticketData.status === "CONFIRMED" ? "#22c55e" : "#ef4444";
      doc
        .roundedRect(margin + 3 * colW + 15, currentY + 15, 80, 25, 4)
        .fill(statusColor);
      doc
        .fillColor("#ffffff")
        .font("Roboto-Bold")
        .fontSize(10)
        .text(ticketData.status, margin + 3 * colW + 15, currentY + 22, {
          width: 80,
          align: "center",
        });

      currentY += 80;

      // ==================== JOURNEY DETAILS ====================
      drawSectionHeader("Journey Information", currentY);
      currentY += 35;

      // Bus Details (Left) & Route Details (Right)
      const midPoint = pageWidth / 2;

      // Bus Info
      drawLabelValue(
        "Bus Operator",
        ticketData.bus.name,
        margin + 10,
        currentY,
        150
      );
      drawLabelValue(
        "Bus Number",
        ticketData.bus.busNumber,
        margin + 10,
        currentY + 30,
        150
      );
      drawLabelValue(
        "Bus Type",
        ticketData.bus.type,
        margin + 10,
        currentY + 60,
        150
      );

      // Route Arrow (Simple ASCII) - Removed as per request

      // Route Info
      drawLabelValue(
        "From",
        ticketData.route.from.city,
        midPoint + 20,
        currentY,
        150
      );
      drawLabelValue(
        "To",
        ticketData.route.to.city,
        midPoint + 20,
        currentY + 30,
        150
      );
      drawLabelValue(
        "Travel Date",
        new Date(ticketData.trip.tripDate).toLocaleDateString("en-IN", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        midPoint + 20,
        currentY + 60,
        200
      );

      currentY += 100;

      // ==================== BOARDING & DROPPING ====================
      drawSectionHeader("Boarding & Dropping", currentY);
      currentY += 35;

      // Boarding (Left)
      doc
        .font("Roboto-Bold")
        .fontSize(11)
        .fillColor("#0f172a")
        .text("Boarding Point", margin + 10, currentY + 2);
      if (ticketData.boardingPoint) {
        doc
          .font("Roboto-Bold")
          .fontSize(12)
          .fillColor("#4338ca") // Indigo
          .text(ticketData.boardingPoint.time, margin + 10, currentY + 20);
        doc
          .font("Roboto-Regular")
          .fontSize(10)
          .fillColor("#334155")
          .text(ticketData.boardingPoint.name, margin + 10, currentY + 38, {
            width: 200,
          });
        if (ticketData.boardingPoint.landmark) {
          doc
            .fontSize(9)
            .fillColor("#64748b")
            .text(
              ticketData.boardingPoint.landmark,
              margin + 10,
              currentY + 52,
              { width: 200 }
            );
        }
      }

      // Dropping (Right)
      doc
        .font("Roboto-Bold")
        .fontSize(11)
        .fillColor("#0f172a")
        .text("Dropping Point", midPoint + 20, currentY + 2);
      if (ticketData.droppingPoint) {
        doc
          .font("Roboto-Bold")
          .fontSize(12)
          .fillColor("#4338ca") // Indigo
          .text(ticketData.droppingPoint.time, midPoint + 20, currentY + 20);
        doc
          .font("Roboto-Regular")
          .fontSize(10)
          .fillColor("#334155")
          .text(ticketData.droppingPoint.name, midPoint + 20, currentY + 38, {
            width: 200,
          });
        if (ticketData.droppingPoint.landmark) {
          doc
            .fontSize(9)
            .fillColor("#64748b")
            .text(
              ticketData.droppingPoint.landmark,
              midPoint + 20,
              currentY + 52,
              { width: 200 }
            );
        }
      }

      currentY += 80;

      // ==================== PASSENGERS ====================
      drawSectionHeader("Passenger Details", currentY);
      currentY += 35;

      // Table Header
      const tableHeaders = ["Seat", "Passenger Name", "Age", "Gender", "Type"];
      const colWidths = [50, 200, 50, 80, 100];
      let x = margin + 10;

      doc.font("Roboto-Bold").fontSize(9).fillColor("#64748b");
      tableHeaders.forEach((h, i) => {
        doc.text(h, x, currentY);
        x += colWidths[i] || 0;
      });

      currentY += 15;
      doc
        .moveTo(margin, currentY)
        .lineTo(pageWidth - margin, currentY)
        .strokeColor("#e2e8f0")
        .stroke();
      currentY += 10;

      // Rows
      doc.font("Roboto-Regular").fontSize(10).fillColor("#0f172a");
      ticketData.seats.forEach((seat) => {
        x = margin + 10;
        doc.font("Roboto-Bold").text(seat.seatNumber, x, currentY);
        x += colWidths[0] || 0;
        doc.font("Roboto-Regular").text(seat.passenger.name, x, currentY);
        x += colWidths[1] || 0;
        doc.text(seat.passenger.age.toString(), x, currentY);
        x += colWidths[2] || 0;
        doc.text(seat.passenger.gender, x, currentY);
        x += colWidths[3] || 0;
        doc.text(`${seat.seatLevel} ${seat.seatType}`, x, currentY);

        currentY += 20;
      });

      currentY += 20;

      // ==================== PAYMENT ====================
      // Left aligned payment box as requested
      const paymentBoxWidth = 250;
      const paymentBoxX = margin; // Moved to left margin

      doc
        .roundedRect(paymentBoxX, currentY, paymentBoxWidth, 110, 8)
        .fill("#f8fafc");

      let payY = currentY + 15;
      const drawPayRow = (
        label: string,
        amount: string,
        isBold: boolean = false,
        color: string = "#0f172a"
      ) => {
        doc
          .font(isBold ? "Roboto-Bold" : "Roboto-Regular")
          .fontSize(10)
          .fillColor("#334155")
          .text(label, paymentBoxX + 15, payY);
        doc
          .font(isBold ? "Roboto-Bold" : "Roboto-Regular")
          .fontSize(10)
          .fillColor(color)
          .text(amount, paymentBoxX + 15, payY, {
            width: paymentBoxWidth - 30,
            align: "right",
          });
        payY += 20;
      };

      drawPayRow("Total Fare", formatDualPrice(ticketData.pricing.totalPrice));
      if (ticketData.pricing.discountAmount > 0) {
        drawPayRow(
          "Discount",
          `-${formatDualPrice(ticketData.pricing.discountAmount)}`,
          false,
          "#22c55e"
        );
      }
      doc
        .moveTo(paymentBoxX + 15, payY - 5)
        .lineTo(paymentBoxX + paymentBoxWidth - 15, payY - 5)
        .strokeColor("#cbd5e1")
        .stroke();

      // Final Amount (Dual Currency)
      drawPayRow(
        "Total Payable",
        formatDualPrice(ticketData.pricing.finalPrice),
        true,
        "#4338ca"
      );

      // Payment Method & Actual Paid Amount
      if (ticketData.payment) {
        payY += 5;
        doc
          .fontSize(9)
          .fillColor("#64748b")
          .text(
            `Paid via ${ticketData.payment.method}`,
            paymentBoxX + 15,
            payY
          );

        const paidAmountStr = `${
          ticketData.payment.currency
        } ${ticketData.payment.amountPaid.toFixed(2)}`;
        doc
          .font("Roboto-Bold")
          .fontSize(9)
          .fillColor("#0f172a")
          .text(paidAmountStr, paymentBoxX + 15, payY, {
            width: paymentBoxWidth - 30,
            align: "right",
          });
      }

      // ==================== FOOTER ====================
      const footerY = pageHeight - 60;
      doc
        .font("Roboto-Bold") // Made bold as requested
        .fontSize(12)
        .fillColor("#64748b")
        .text("Have a safe journey!", 0, footerY, { align: "center" });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Helper to convert PDF stream to buffer
 */
export function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];
    stream.on("data", (chunk) => buffers.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });
}
