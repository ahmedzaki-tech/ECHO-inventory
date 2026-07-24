// /api/fawry-charge.js
// Vercel Serverless Function — يعمل تلقائياً بمجرد وجوده في مجلد /api
// يبدأ عملية دفع فوري (FawryPay Express Checkout Link) ويرجع رابط الدفع للعميل.
//
// المتغيرات البيئية المطلوبة (تُضاف من Vercel ← Project Settings ← Environment Variables):
//   FAWRY_MERCHANT_CODE   - كود التاجر من فوري
//   FAWRY_SECURE_KEY      - المفتاح السري من فوري (لا يظهر أبداً في الكود أو المتصفح)
//   FAWRY_BASE_URL        - رابط API فوري (staging أو production) — راجع الملاحظة أسفل الملف
//   SITE_URL              - رابط الموقع المنشور (مثال: https://echo-inventory-y281.vercel.app)
//
// ملاحظة مهمة: صيغة التوقيع (signature) واسم الـ endpoint موثّقة من صفحة فوري الرسمية
// (Express Checkout Link)، لكن يُنصح بمراجعتها مرة أخرى مع فريق دعم فوري بعد فتح حسابك،
// لأن التوثيق قد يتغير بمرور الوقت. اختبر أولاً على بيئة "staging" قبل التفعيل الفعلي.

const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { FAWRY_MERCHANT_CODE, FAWRY_SECURE_KEY, FAWRY_BASE_URL, SITE_URL } = process.env;

  if (!FAWRY_MERCHANT_CODE || !FAWRY_SECURE_KEY) {
    // البوابة لسه مش متفعّلة (مفيش بيانات فوري) — نرجع خطأ واضح بدل ما نكسر الطلب
    return res.status(503).json({ error: 'Fawry not configured yet. Set FAWRY_MERCHANT_CODE and FAWRY_SECURE_KEY in Vercel environment variables.' });
  }

  try {
    const { orderId, amount, customerName, customerPhone, customerEmail } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ error: 'orderId and amount are required' });
    }

    const merchantRefNum = String(orderId).replace(/-/g, '').slice(0, 25); // فوري بتفضّل مرجع مختصر
    const price = Number(amount).toFixed(2);
    const quantity = '1';
    const itemId = merchantRefNum;
    const returnUrl = `${SITE_URL}/store.html#order-success/${orderId}`;
    const webHookUrl = `${SITE_URL}/api/fawry-webhook`;

    // التوقيع: merchantCode + merchantRefNum + customerProfileId("" لو مش موجود) + returnUrl + itemId + quantity + price + secureKey
    const signatureRaw = FAWRY_MERCHANT_CODE + merchantRefNum + '' + returnUrl + itemId + quantity + price + FAWRY_SECURE_KEY;
    const signature = crypto.createHash('sha256').update(signatureRaw).digest('hex');

    const chargeRequest = {
      merchantCode: FAWRY_MERCHANT_CODE,
      merchantRefNum,
      customerMobile: customerPhone || '',
      customerEmail: customerEmail || '',
      customerName: customerName || '',
      language: 'ar-eg',
      chargeItems: [
        { itemId, description: 'طلب من صدى للعطور', price: Number(price), quantity: Number(quantity) },
      ],
      returnUrl,
      orderWebHookUrl: webHookUrl,
      signature,
    };

    const base = FAWRY_BASE_URL || 'https://atfawry.fawrystaging.com';
    const fawryRes = await fetch(`${base}/ECommerceWeb/Fawry/payments/charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chargeRequest),
    });
    const data = await fawryRes.json();

    // FawryPay Express Checkout Link ترجع رابط دفع (قد يكون في data.nextAction.redirectUrl
    // أو مباشرة كنص الرد حسب نسخة الـ API — تأكد من الشكل الفعلي أول تجربة حقيقية)
    const paymentUrl = data.nextAction?.redirectUrl || data.redirectUrl || null;

    if (!paymentUrl) {
      return res.status(502).json({ error: 'Fawry did not return a payment URL', raw: data });
    }
    return res.status(200).json({ paymentUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
