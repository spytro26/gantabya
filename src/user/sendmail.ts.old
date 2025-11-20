import nodemailer from "nodemailer";
import 'dotenv/config'

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.gmail,
    pass: process.env.appPassword,
  },
});
function generateRandom() {
  const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let otp = 0;

  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * arr.length);
    const digit = arr[idx] ?? 0;
    otp = otp * 10 + digit;
  }
  console.log(otp); // Example output: 492857
  return otp;
}

 export async function sendGmail(userEmail : string): Promise<number> {
    console.log("sending mail")
    let otp = generateRandom();
try {


  const info = await transporter.sendMail({
    from: `"Go Gantabya" <${process.env.gmail}>`,
    to: userEmail,
    subject: "Email Verification - Go Gantabya",
    html: `
  <div style="font-family: Arial, sans-serif; background: #f9fafc; padding: 20px; border-radius: 10px; text-align: center;">
    

    <h2 style="color: #333;">Welcome to <span style="color: #007bff;">Go Gantabya</span> 🚍</h2>
    <p style="color: #555; font-size: 16px;">Thank you for signing up!</p>

    <div style="background: #ffffff; border: 1px solid #eee; border-radius: 8px; display: inline-block; padding: 15px 30px; margin-top: 20px;">
      <h1 style="letter-spacing: 4px; color: #007bff; margin: 0;">${otp}</h1>
    </div>

    <p style="margin-top: 25px; color: #666;">This OTP will expire in <b>10 minutes</b>.</p>
    <p style="font-size: 12px; color: #aaa; margin-top: 20px;">If you didn’t request this, please ignore this email.</p>
  </div>
  `,
  });
  console.log("Message sent: ", info.messageId);
}catch(e){
  console.log("error while sending the mail ")
}



  return otp ; 

};