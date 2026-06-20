// Netlify Function: create-bill.js
// This runs server-side so your Toyyibpay secret key is never exposed.
//
// HOW TO SET YOUR SECRET KEY:
// 1. Go to Netlify dashboard → your site → Site configuration → Environment variables
// 2. Add: TOYYIBPAY_SECRET_KEY = (your key from toyyibpay.com dashboard)
// 3. Add: TOYYIBPAY_CATEGORY_CODE = (your category code from toyyibpay.com)
// 4. Redeploy the site

const TOYYIBPAY_API = "https://toyyibpay.com/index.php/api/createBill";
const BASE_PRICE_CENTS = 12000; // RM120.00 in cents

exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const SECRET_KEY = process.env.TOYYIBPAY_SECRET_KEY;
  const CATEGORY_CODE = process.env.TOYYIBPAY_CATEGORY_CODE;

  if (!SECRET_KEY || !CATEGORY_CODE) {
    console.error("Missing TOYYIBPAY_SECRET_KEY or TOYYIBPAY_CATEGORY_CODE env vars");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Payment gateway not configured. Please contact admin." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { name, email, phone, couponCode, discountPct } = body;

  // Validate inputs
  if (!name || !email || !phone) {
    return { statusCode: 400, body: JSON.stringify({ error: "Name, email and phone are required." }) };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid email address." }) };
  }

  // Calculate final price
  const pct = Math.min(Math.max(parseInt(discountPct) || 0, 0), 30); // cap at 30%
  const discountAmount = Math.floor(BASE_PRICE_CENTS * pct / 100);
  const finalAmountCents = BASE_PRICE_CENTS - discountAmount;

  // Build a unique order reference
  const orderRef = `MJQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  // Description: clean alphanumeric only (Toyyibpay requirement)
  const discountLabel = pct > 0 ? `Diskaun ${pct} peratus` : `Tiada diskaun`;
  const billDesc = `Mandarinjer Online Platform ${discountLabel}`.replace(/[^a-zA-Z0-9 _]/g, "").slice(0, 100);

  // Build form body for Toyyibpay API
  const params = new URLSearchParams({
    userSecretKey: SECRET_KEY,
    categoryCode: CATEGORY_CODE,
    billName: "MandarinjerPlatform",
    billDescription: billDesc,
    billPriceSetting: "1",
    billPayorInfo: "1",
    billAmount: String(finalAmountCents),
    billReturnUrl: "https://mandarinjer-quiz.netlify.app/thank-you.html",
    billCallbackUrl: "https://mandarinjer-quiz.netlify.app/.netlify/functions/payment-callback",
    billExternalReferenceNo: orderRef,
    billTo: name,
    billEmail: email,
    billPhone: phone.replace(/\D/g, ""),
    billPaymentChannel: "0",
    billDisplayMerchant: "1",
    billChargeToCustomer: "2",
    billContentEmail: pct > 0
      ? `Tahniah! Diskaun ${pct}% daripada Mandarinjer Quiz telah diaplikasikan. Kod: ${couponCode || "N/A"}. Jumlah dibayar: RM${(finalAmountCents / 100).toFixed(2)}`
      : `Terima kasih kerana mendaftar Mandarinjer Online Platform! Jumlah dibayar: RM${(finalAmountCents / 100).toFixed(2)}`,
  });

  try {
    const response = await fetch(TOYYIBPAY_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await response.json();

    if (!data || !data[0] || !data[0].BillCode) {
      console.error("Toyyibpay error response:", JSON.stringify(data));
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Payment gateway returned an unexpected response. Please try again." }),
      };
    }

    const billCode = data[0].BillCode;
    const paymentUrl = `https://toyyibpay.com/${billCode}`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        billCode,
        paymentUrl,
        orderRef,
        finalAmount: (finalAmountCents / 100).toFixed(2),
        discountPct: pct,
      }),
    };
  } catch (err) {
    console.error("Toyyibpay fetch error:", err);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Could not connect to payment gateway. Please try again." }),
    };
  }
};
