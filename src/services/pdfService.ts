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
  status: string;
}

/**
 * Generate PDF ticket for a booking
 * Returns a Buffer containing the PDF data
 */
export async function generateTicketPDF(
  ticketData: TicketData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      const buffers: Buffer[] = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Try to add logo (if available)
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
        doc.image(logoPath, 50, 45, { width: 60 });
      } catch (err) {
        console.log("Logo not found, skipping");
      }

      // Header
      doc
        .fontSize(24)
        .fillColor("#007bff")
        .text("Go Gantabya", 120, 50, { align: "left" });
      doc
        .fontSize(10)
        .fillColor("#666")
        .text("Your Journey Partner", 120, 78, { align: "left" });

      // Title
      doc.moveDown(2);
      doc
        .fontSize(20)
        .fillColor("#333")
        .text("Bus Ticket", { align: "center", underline: true });

      doc.moveDown(0.5);

      // Booking Status Badge
      const statusColor =
        ticketData.status === "CONFIRMED" ? "#22c55e" : "#ef4444";
      doc
        .fontSize(12)
        .fillColor(statusColor)
        .text(`Status: ${ticketData.status}`, { align: "center" });

      doc.moveDown(1);

      // Booking ID
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(`Booking ID: ${ticketData.bookingGroupId}`, { align: "center" });
      doc
        .fontSize(9)
        .fillColor("#999")
        .text(
          `Booked on: ${new Date(ticketData.bookedAt).toLocaleString("en-IN")}`,
          {
            align: "center",
          }
        );

      doc.moveDown(1.5);

      // Divider
      doc
        .strokeColor("#ddd")
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(1);

      // Bus Information
      doc
        .fontSize(14)
        .fillColor("#007bff")
        .text("Bus Details", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#333");
      doc.text(`Bus Name: ${ticketData.bus.name}`, { continued: false });
      doc.text(`Bus Number: ${ticketData.bus.busNumber}`);
      doc.text(`Type: ${ticketData.bus.type}`);
      doc.text(
        `Journey Date: ${new Date(ticketData.trip.tripDate).toLocaleDateString(
          "en-IN"
        )}`
      );

      doc.moveDown(1);

      // Route Information
      doc
        .fontSize(14)
        .fillColor("#007bff")
        .text("Journey Details", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#333");
      doc.text(
        `From: ${ticketData.route.from.name}, ${ticketData.route.from.city}`
      );
      if (ticketData.route.from.departureTime) {
        doc.text(`Departure Time: ${ticketData.route.from.departureTime}`);
      }
      doc.moveDown(0.3);
      doc.text(`To: ${ticketData.route.to.name}, ${ticketData.route.to.city}`);
      if (ticketData.route.to.arrivalTime) {
        doc.text(`Arrival Time: ${ticketData.route.to.arrivalTime}`);
      }

      doc.moveDown(1);

      // Boarding & Dropping Points
      if (ticketData.boardingPoint) {
        doc
          .fontSize(14)
          .fillColor("#007bff")
          .text("Boarding Point", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor("#333");
        doc.text(`Location: ${ticketData.boardingPoint.name}`);
        if (ticketData.boardingPoint.landmark) {
          doc.text(`Landmark: ${ticketData.boardingPoint.landmark}`);
        }
        doc.text(`Time: ${ticketData.boardingPoint.time}`);
        doc.moveDown(0.5);
      }

      if (ticketData.droppingPoint) {
        doc
          .fontSize(14)
          .fillColor("#007bff")
          .text("Dropping Point", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor("#333");
        doc.text(`Location: ${ticketData.droppingPoint.name}`);
        if (ticketData.droppingPoint.landmark) {
          doc.text(`Landmark: ${ticketData.droppingPoint.landmark}`);
        }
        doc.text(`Time: ${ticketData.droppingPoint.time}`);
        doc.moveDown(1);
      }

      // Passenger Details Table
      doc
        .fontSize(14)
        .fillColor("#007bff")
        .text("Passenger & Seat Details", { underline: true });
      doc.moveDown(0.5);

      const tableTop = doc.y;
      const colWidths = [120, 80, 60, 60, 80];
      const headers = [
        "Passenger Name",
        "Seat No.",
        "Age",
        "Gender",
        "Seat Type",
      ];

      // Table Header
      doc.fontSize(10).fillColor("#fff");
      doc.rect(50, tableTop, 495, 20).fill("#007bff");
      let xPos = 55;
      headers.forEach((header, i) => {
        const colWidth = colWidths[i];
        if (colWidth) {
          doc.text(header, xPos, tableTop + 5, {
            width: colWidth,
            align: "left",
          });
          xPos += colWidth;
        }
      });

      // Table Rows
      let yPos = tableTop + 25;
      doc.fillColor("#333").fontSize(9);
      ticketData.seats.forEach((seat, index) => {
        if (yPos > 700) {
          doc.addPage();
          yPos = 50;
        }

        const bg = index % 2 === 0 ? "#f9f9f9" : "#ffffff";
        doc.rect(50, yPos - 3, 495, 20).fill(bg);

        xPos = 55;
        doc.fillColor("#333");
        const col0 = colWidths[0];
        const col1 = colWidths[1];
        const col2 = colWidths[2];
        const col3 = colWidths[3];
        const col4 = colWidths[4];

        if (col0) {
          doc.text(seat.passenger.name, xPos, yPos, {
            width: col0,
            align: "left",
          });
          xPos += col0;
        }
        if (col1) {
          doc.text(seat.seatNumber, xPos, yPos, { width: col1, align: "left" });
          xPos += col1;
        }
        if (col2) {
          doc.text(String(seat.passenger.age), xPos, yPos, {
            width: col2,
            align: "left",
          });
          xPos += col2;
        }
        if (col3) {
          doc.text(seat.passenger.gender, xPos, yPos, {
            width: col3,
            align: "left",
          });
          xPos += col3;
        }
        if (col4) {
          doc.text(`${seat.seatLevel} ${seat.seatType}`, xPos, yPos, {
            width: col4,
            align: "left",
          });
        }

        yPos += 20;
      });

      doc.moveDown(2);

      // Pricing Details
      doc
        .fontSize(14)
        .fillColor("#007bff")
        .text("Fare Breakdown", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#333");

      const fareX = 350;
      doc.text("Total Fare:", 50, doc.y);
      doc.text(
        `₹${ticketData.pricing.totalPrice.toFixed(2)}`,
        fareX,
        doc.y - 13,
        {
          align: "right",
        }
      );

      if (
        ticketData.pricing.couponCode &&
        ticketData.pricing.discountAmount > 0
      ) {
        doc.moveDown(0.3);
        doc
          .fillColor("#22c55e")
          .text(`Discount (${ticketData.pricing.couponCode}):`, 50, doc.y);
        doc.text(
          `-₹${ticketData.pricing.discountAmount.toFixed(2)}`,
          fareX,
          doc.y - 13,
          {
            align: "right",
          }
        );
      }

      doc.moveDown(0.5);
      doc
        .strokeColor("#007bff")
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(0.3);
      doc.fontSize(13).fillColor("#007bff").text("Final Amount:", 50, doc.y);
      doc.text(
        `₹${ticketData.pricing.finalPrice.toFixed(2)}`,
        fareX,
        doc.y - 15,
        {
          align: "right",
        }
      );

      doc.moveDown(2);

      // Footer
      doc
        .strokeColor("#ddd")
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(0.5);
      doc.fontSize(9).fillColor("#666");
      doc.text(
        "⚠ Important: Please arrive at the boarding point 15 minutes before departure time.",
        {
          align: "center",
        }
      );
      doc.moveDown(0.3);
      doc.text("Show this ticket to the bus conductor. Have a safe journey!", {
        align: "center",
      });

      doc.moveDown(1);
      doc.fontSize(8).fillColor("#999");
      doc.text("For support, contact us at support@gogantabya.com", {
        align: "center",
      });
      doc.text(
        "This is a computer-generated ticket and does not require a signature.",
        {
          align: "center",
        }
      );

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
