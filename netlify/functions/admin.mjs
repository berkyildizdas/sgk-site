/**
 * Lisans yönetim API'si (Netlify Function) — admin.html buradan beslenir.
 * Şifre: env ADMIN_SIFRE. Depo: Netlify Blobs ("lisans" → "veri" = {KEY:{ad,bitis,aktif}}).
 * lisans.mjs aynı Blobs'u okur (env'in üstüne) → buradan yapılan aç/kapa/ekle ANINDA etki eder.
 */
import { getStore } from "@netlify/blobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};
const cevap = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

// Karışmasın diye 0/O/1/I yok
const HARFLER = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function segment(n = 4) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += HARFLER[b[i] % HARFLER.length];
  return s;
}
const keyUret = () => `ECZ-${segment()}-${segment()}-${segment()}`;

async function tumLisanslar(store) {
  let keys = {};
  try { keys = JSON.parse(process.env.LISANS_KEYS || "{}"); } catch {}
  try {
    const blob = await store.get("veri", { type: "json" });
    if (blob && typeof blob === "object") keys = { ...keys, ...blob };
  } catch { /* blob yok */ }
  return keys;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return cevap({ ok: false, hata: "POST gerekli" }, 405);

  let body = {};
  try { body = await req.json(); } catch {}
  if (String(body.sifre || "") !== (process.env.ADMIN_SIFRE || "___ayarlanmadi___")) {
    return cevap({ ok: false, hata: "Hatalı şifre" }, 401);
  }

  const store = getStore("lisans");
  const keys = await tumLisanslar(store);
  const action = body.action;

  if (action === "list") {
    const liste = Object.entries(keys)
      .map(([key, v]) => ({ key, ad: v.ad || "", bitis: v.bitis || "", aktif: v.aktif !== false }))
      .sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
    return cevap({ ok: true, liste });
  }

  if (action === "toggle") {
    const k = String(body.key || "");
    if (!keys[k]) return cevap({ ok: false, hata: "Key bulunamadı" });
    keys[k] = { ...keys[k], aktif: keys[k].aktif === false }; // pasifse aç, aktifse kapat
    await store.setJSON("veri", keys);
    return cevap({ ok: true, key: k, aktif: keys[k].aktif });
  }

  if (action === "ekle") {
    const ad = String(body.ad || "").trim();
    if (!ad) return cevap({ ok: false, hata: "Eczane adı gerekli" });
    let yeni;
    do { yeni = keyUret(); } while (keys[yeni]);
    keys[yeni] = { ad, bitis: "", aktif: true };
    await store.setJSON("veri", keys);
    return cevap({ ok: true, key: yeni, ad });
  }

  return cevap({ ok: false, hata: "Bilinmeyen işlem" });
};
