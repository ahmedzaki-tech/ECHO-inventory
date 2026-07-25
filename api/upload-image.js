// /api/upload-image.js
// Vercel Serverless Function — بيستقبل صورة من المتصفح ويرفعها لـ Supabase Storage
// من عنده (سيرفر لسيرفر)، بدل ما المتصفح يحاول يرفعها بنفسه عبر البروكسي.
//
// المتغيرات البيئية المطلوبة (Vercel ← Environment Variables):
//   SUPABASE_URL                - رابط مشروع Supabase الحقيقي (https://xxxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY   - من Supabase ← Project Settings ← API ← service_role
//                                 (نفس المفتاح المستخدم في fawry-webhook.js)

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'رفع الصور غير مفعّل بعد. أضف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في Vercel.' });
  }

  try {
    const { filename, contentType, dataBase64 } = req.body;
    if (!filename || !dataBase64) {
      return res.status(400).json({ error: 'filename and dataBase64 are required' });
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upErr } = await supabase.storage.from('product-images').upload(path, buffer, {
      contentType: contentType || 'application/octet-stream',
    });
    if (upErr) {
      return res.status(500).json({ error: upErr.message });
    }

    const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path);
    return res.status(200).json({ url: pub.publicUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
