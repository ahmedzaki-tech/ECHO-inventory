// /api/fawry-webhook.js
// Vercel Serverless Function — يستقبل إشعار الدفع من فوري بعد إتمام العملية
// ويحدّث حالة الطلب في قاعدة البيانات مباشرة (باستخدام service_role key الآمن).
//
// المتغيرات البيئية المطلوبة (Vercel ← Environment Variables):
//   FAWRY_SECURE_KEY            - نفس المفتاح المستخدم في fawry-charge.js
//   SUPABASE_URL                - رابط مشروع Supabase (نفس القيمة في index.html)
//   SUPABASE_SERVICE_ROLE_KEY   - مفتاح service_role من Supabase ← API settings
//                                 (خطر: هذا المفتاح يتخطى كل الحماية RLS — لا يوضع أبداً
//                                 في أي ملف يظهر في المتصفح، فقط كمتغير بيئة في Vercel)

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { FAWRY_SECURE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  try {
    const body = req.body;
    const {
      referenceNumber, merchantRefNumber, paymentAmount, orderAmount,
      orderStatus, paymentMethod, fawryFees, shippingFees, authNumber,
      customerMail, customerMobile, signature,
    } = body;

    // تحقق من صحة التوقيع قبل تصديق أي بيانات قادمة من الطلب
    if (FAWRY_SECURE_KEY) {
      const parts = [
        referenceNumber || '', merchantRefNumber || '',
        Number(paymentAmount || 0).toFixed(2), Number(orderAmount || 0).toFixed(2),
        orderStatus || '', paymentMethod || '',
        fawryFees != null ? Number(fawryFees).toFixed(2) : '',
        shippingFees != null ? Number(shippingFees).toFixed(2) : '',
        authNumber || '', customerMail || '', customerMobile || '',
      ];
      const expectedSig = crypto.createHash('sha256').update(parts.join('') + FAWRY_SECURE_KEY).digest('hex');
      if (expectedSig !== signature) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // استرجاع الـ orderId الأصلي (نحن أرسلناه لفوري بدون شرطات كـ merchantRefNum)
    const { data: orders } = await supabase.from('orders').select('id').ilike('id', merchantRefNumber.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5') + '%');

    const orderId = orders && orders[0] ? orders[0].id : null;
    if (!orderId) {
      return res.status(404).json({ error: 'Order not found for merchantRefNumber ' + merchantRefNumber });
    }

    const payment_status = orderStatus === 'PAID' ? 'paid' : (orderStatus === 'FAILED' || orderStatus === 'EXPIRED' ? 'failed' : 'pending');
    await supabase.from('orders').update({ payment_status, fawry_reference: referenceNumber }).eq('id', orderId);

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
