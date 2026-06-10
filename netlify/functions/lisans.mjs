/**
 * Lisans doğrulama servisi (Netlify Function).
 * Uygulama açılışta buraya key gönderir; geçerli/süre/durum cevabı döner.
 *
 * Key listesi Netlify ortam değişkeninde tutulur (panelden düzenlenir, herkese açık DEĞİL):
 *   Site settings → Environment variables → LISANS_KEYS
 *   Değer (JSON):
 *   {
 *     "SGK-A7F3-9K2M-XQ44": { "ad": "Berk Eczanesi", "bitis": "2026-07-31", "aktif": true },
 *     "SGK-B2C8-1L5N-ZZ09": { "ad": "Deneme Eczane",  "bitis": "2026-06-20", "aktif": false }
 *   }
 *  - bitis: YYYY-MM-DD (abonelik bitiş tarihi). Ödeme gelince ileri tarihe çek.
 *  - aktif: false yaparsan ANINDA kilitlenir (ödeme gelmezse).
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};
const cevap = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return cevap({ gecerli: false, mesaj: "POST gerekli" }, 405);

  let body = {};
  try { body = await req.json(); } catch {}
  const key = String(body.key || "").trim().toUpperCase();
  if (!key) return cevap({ gecerli: false, mesaj: "Lisans anahtarı boş." });

  let keys = {};
  try { keys = JSON.parse(process.env.LISANS_KEYS || "{}"); } catch {}

  const kayit = keys[key];
  const bugun = new Date().toISOString().slice(0, 10);

  if (!kayit) return cevap({ gecerli: false, mesaj: "Geçersiz lisans anahtarı." });
  if (kayit.aktif === false) return cevap({ gecerli: false, mesaj: "Lisansınız pasif. Ödeme/iletişim için bizimle görüşün." });
  if (kayit.bitis && kayit.bitis < bugun) return cevap({ gecerli: false, mesaj: `Aboneliğiniz ${kayit.bitis} tarihinde sona erdi. Yenilemek için iletişime geçin.` });

  return cevap({ gecerli: true, ad: kayit.ad || "", bitis: kayit.bitis || "", mesaj: "Lisans geçerli." });
};
