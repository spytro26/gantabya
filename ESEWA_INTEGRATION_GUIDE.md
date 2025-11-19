# eSewa Payment Integration Guide

## Current Status: Invalid Payload Signature Error ❌

This error (ES104) indicates that eSewa cannot validate the signature we're sending.

## eSewa API v2 Requirements

### 1. Endpoint

**Test Environment:**

```
POST https://rc-epay.esewa.com.np/api/epay/main/v2/form
```

**Production Environment:**

```
POST https://epay.esewa.com.np/api/epay/main/v2/form
```

### 2. Required Form Parameters

| Field                     | Type   | Required | Description                           |
| ------------------------- | ------ | -------- | ------------------------------------- |
| `amount`                  | string | Yes      | Product amount (without tax)          |
| `tax_amount`              | string | Yes      | Tax amount (use "0" if no tax)        |
| `total_amount`            | string | Yes      | amount + tax_amount                   |
| `transaction_uuid`        | string | Yes      | Unique transaction ID                 |
| `product_code`            | string | Yes      | Merchant code (EPAYTEST for test)     |
| `product_service_charge`  | string | Yes      | Service charge (use "0")              |
| `product_delivery_charge` | string | Yes      | Delivery charge (use "0")             |
| `success_url`             | string | Yes      | Callback URL for success              |
| `failure_url`             | string | Yes      | Callback URL for failure              |
| `signed_field_names`      | string | Yes      | Comma-separated list of signed fields |
| `signature`               | string | Yes      | HMAC-SHA256 signature                 |

### 3. Signature Generation (CRITICAL!)

The signature MUST be created from fields in `signed_field_names` using this format:

```javascript
// If signed_field_names = "total_amount,transaction_uuid,product_code"
const message = `total_amount=${totalAmount},transaction_uuid=${uuid},product_code=${productCode}`;

const signature = crypto
  .createHmac("sha256", SECRET_KEY)
  .update(message)
  .digest("base64");
```

**Important:**

- Field names and values must be in the EXACT order as `signed_field_names`
- Format: `field1=value1,field2=value2,field3=value3`
- NO spaces around `=` or `,`
- All values must be strings

### 4. Test Credentials

```
Merchant ID: EPAYTEST
Secret Key: 8gBm/:&EnhH.1/q
Product Code: EPAYTEST
```

## Current Implementation Fix

### What Was Wrong:

```javascript
// ❌ OLD (Incorrect)
const signaturePayload = `${totalAmount},${transactionUuid},${productCode}`;
```

### What's Fixed:

```javascript
// ✅ NEW (Correct)
const signaturePayload = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`;
```

## Verification Checklist

- [x] Signature payload includes field names
- [x] Field order matches `signed_field_names`
- [x] All amounts are strings with 2 decimals (e.g., "100.00")
- [x] Using correct secret key: `8gBm/:&EnhH.1/q`
- [x] Using test endpoint: `https://rc-epay.esewa.com.np/api/epay/main/v2/form`
- [x] Added required fields: `product_service_charge`, `product_delivery_charge`

## Testing Steps

1. Restart the backend:

```bash
cd /home/ankush/Documents/coding/red_bus/back
npm run build
# Or if already running, just restart
```

2. Try a test payment through the frontend

3. If still getting ES104, check:
   - Browser Network tab → see exact payload being sent
   - Compare with test script output: `node test-esewa-signature.js`
   - Verify no extra characters in SECRET_KEY

## Success Response

When successful, eSewa redirects to `success_url` with:

```
?oid={transaction_uuid}&amt={total_amount}&refId={esewa_reference_id}
```

## Failure Response

When failed, eSewa redirects to `failure_url` with error details.

## References

- eSewa API Documentation: https://developer.esewa.com.np/
- Test Environment: https://rc-epay.esewa.com.np (for testing only)
