const LIVE_CHECKOUT_URL = 'https://www.mandarinjer.com/platform-2022/';
const CHECKOUT_AJAX_URL = 'https://www.mandarinjer.com/?wc-ajax=checkout&wcf_checkout_id=19506';
const EXPECTED_PRODUCT_ID = '22053';

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function cookieHeader(setCookies) {
  return setCookies
    .map(v => v.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function extractValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('name=["\\\']' + escaped + '["\\\'][^>]*value=["\\\']([^"\\\']*)', 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

exports.handler = async function (event) {
  const origin = event.headers && (event.headers.origin || event.headers.Origin) || '*';

  if (event.httpMethod === 'OPTIONS') return json(204, {}, origin);
  if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method not allowed.' }, origin);

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { success: false, message: 'Invalid request.' }, origin);
  }

  const name = String(input.billing_first_name || '').trim();
  const country = String(input.billing_country || '').trim();
  const phone = String(input.billing_phone || '').trim();
  const email = String(input.billing_email || '').trim();

  if (!name || !country || !phone || !email) {
    return json(400, { success: false, message: 'Sila lengkapkan semua maklumat.' }, origin);
  }

  try {
    // Start a fresh WooCommerce/CartFlows session and obtain a fresh checkout nonce.
    const page = await fetch(LIVE_CHECKOUT_URL, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 MandarinJer Netlify Checkout' }
    });
    const html = await page.text();

    if (!page.ok) {
      return json(502, { success: false, message: 'Tidak dapat menghubungi sistem checkout MandarinJer.' }, origin);
    }

    // Safety check: never submit this flow unless the live checkout still contains product 22053.
    if (!html.includes(EXPECTED_PRODUCT_ID) && !html.includes('Online Platform Asas Mandarinjer')) {
      return json(409, { success: false, message: 'Produk checkout 22053 tidak ditemui pada checkout MandarinJer.' }, origin);
    }

    const nonce = extractValue(html, 'woocommerce-process-checkout-nonce');
    if (!nonce) {
      return json(502, { success: false, message: 'Checkout nonce tidak dapat diperoleh. Sila cuba lagi.' }, origin);
    }

    const cookies = cookieHeader(extractSetCookies(page.headers));

    const body = new URLSearchParams();
    body.set('billing_first_name', name);
    body.set('billing_country', country);
    body.set('billing_phone', phone);
    body.set('billing_email', email);
    body.set('payment_method', 'toyyibpay');
    body.set('woocommerce_checkout_place_order', 'Daftar Sekarang Juga  RM90.00');
    body.set('woocommerce-process-checkout-nonce', nonce);
    body.set('_wp_http_referer', '/platform-2022/');
    body.set('_wcf_flow_id', '19505');
    body.set('_wcf_checkout_id', '19506');

    const checkout = await fetch(CHECKOUT_AJAX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': LIVE_CHECKOUT_URL,
        'User-Agent': 'Mozilla/5.0 MandarinJer Netlify Checkout',
        ...(cookies ? { 'Cookie': cookies } : {})
      },
      body: body.toString()
    });

    const text = await checkout.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      data = null;
    }

    if (!checkout.ok || !data) {
      return json(502, { success: false, message: 'WooCommerce tidak memberikan respons checkout yang sah.' }, origin);
    }

    if (data.result !== 'success') {
      let message = 'WooCommerce tidak dapat memproses pesanan.';
      if (data.messages) {
        message = String(data.messages).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || message;
      }
      return json(422, { success: false, message }, origin);
    }

    return json(200, {
      success: true,
      redirect: data.redirect || ''
    }, origin);
  } catch (error) {
    return json(500, { success: false, message: 'Ralat sambungan checkout: ' + (error && error.message ? error.message : 'unknown error') }, origin);
  }
};
