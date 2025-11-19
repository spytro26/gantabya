import crypto from 'crypto';
import 'dotenv/config';

// Test eSewa signature generation
const totalAmount = "100.00";
const transactionUuid = "test-uuid-123";
const productCode = process.env.ESEWA_PRODUCT_CODE || "EPAYTEST";
const secretKey = process.env.ESEWA_SECRET_KEY || "8gBm/:&EnhH.1/q";

console.log("🔐 Testing eSewa Signature Generation\n");
console.log("Input Parameters:");
console.log("  Total Amount:", totalAmount);
console.log("  Transaction UUID:", transactionUuid);
console.log("  Product Code:", productCode);
console.log("  Secret Key:", secretKey);
console.log();

// Create signature payload - MUST match signed_field_names order
const signaturePayload = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`;

console.log("Signature Payload:");
console.log("  " + signaturePayload);
console.log();

// Generate signature
const signature = crypto
  .createHmac('sha256', secretKey)
  .update(signaturePayload)
  .digest('base64');

console.log("Generated Signature:");
console.log("  " + signature);
console.log();

console.log("Form Data to Send:");
console.log({
  amount: totalAmount,
  tax_amount: "0",
  total_amount: totalAmount,
  transaction_uuid: transactionUuid,
  product_code: productCode,
  product_service_charge: "0",
  product_delivery_charge: "0",
  success_url: "http://localhost:5173/payment/esewa/success",
  failure_url: "http://localhost:5173/payment/esewa/failure",
  signed_field_names: "total_amount,transaction_uuid,product_code",
  signature: signature,
});
console.log();

console.log("✅ Signature test complete!");
console.log("💡 Tip: If eSewa still shows 'Invalid payload signature', check:");
console.log("   1. Secret key matches exactly (no extra spaces/quotes)");
console.log("   2. signed_field_names order matches the signature payload");
console.log("   3. All field values are strings, not numbers");
console.log("   4. Using the correct eSewa environment (test vs production)");
