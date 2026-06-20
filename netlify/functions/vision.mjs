/**
 * Vision (reçete OKUMA) servisi — Netlify Function.
 * Uygulama, MEDULA ekran görüntüsünü (PNG base64) + okuma PROMPT'unu buraya gönderir;
 * fonksiyon Anthropic'e iletir, ham JSON metnini döndürür. Uygulama ham'ı parse eder.
 *
 * NEDEN client prompt: Prompt artık UYGULAMADAN (electron/ai.ts VISION_PROMPT) gelir →
 * prompt iyileştirmeleri için BU FONKSİYONU yeniden deploy etmeye gerek YOK. Sadece app güncellenir.
 *
 * Netlify ortam değişkenleri (Site settings → Environment variables):
 *   ANTHROPIC_API_KEY  → Anthropic API anahtarı (ZORUNLU; herkese açık DEĞİL, sadece sunucuda)
 *   VISION_MODEL       → (opsiyonel) model adı, varsayılan "claude-haiku-4-5"
 *   APP_SECRET         → (opsiyonel) ayarlıysa, istek "x-app-secret" başlığıyla eşleşmeli
 *
 * Dönen biçim (app bunu bekler):  { ok: true, ham: "<Anthropic ham metni>" }  veya
 *                                 { ok: false, hata: "..." }
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-app-secret, x-lisans",
  "Content-Type": "application/json; charset=utf-8",
};
const cevap = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

/* ── LİSANS KAPISI + HIZ SINIRI ──
   Yalnız geçerli+AKTİF lisanslı uygulama hizmet alır → URL'i bulan rastgele biri senin
   Anthropic kontörünü harcayamaz. Sızan key'i admin panelinden "Kapat" → anında erişimi biter. */
async function lisanslariYukle() {
  let keys = {};
  try { keys = JSON.parse(process.env.LISANS_KEYS || "{}"); } catch {}
  try {
    const { getStore } = await import("@netlify/blobs");
    const blob = await getStore("lisans").get("veri", { type: "json", consistency: "strong" });
    if (blob && typeof blob === "object") keys = { ...keys, ...blob };
  } catch { /* env ile devam */ }
  return keys;
}
async function lisansKontrol(key) {
  if (!key) return { gecerli: false, mesaj: "Lisans gerekli (uygulamayı güncelleyin)." };
  const r = (await lisanslariYukle())[key];
  if (!r) return { gecerli: false, mesaj: "Geçersiz lisans." };
  if (r.aktif === false) return { gecerli: false, mesaj: "Lisans pasif." };
  if (r.bitis && r.bitis < new Date().toISOString().slice(0, 10)) return { gecerli: false, mesaj: "Lisans süresi doldu." };
  return { gecerli: true };
}
async function limitAsildi(key, max) {
  try {
    const store = (await import("@netlify/blobs")).getStore("ratelimit");
    const id = `${key}:${Math.floor(Date.now() / 60000)}`;
    const n = (await store.get(id, { type: "json", consistency: "strong" })) || 0;
    if (n >= max) return true;
    await store.setJSON(id, n + 1);
    return false;
  } catch { return false; } // limit altyapısı çökerse hizmeti kesme
}
// Aylık kullanım sayacı (lisans başına) — admin panelinde "Bu ay: X okuma" gösterilir.
async function kullanimArtir(key) {
  try {
    const store = (await import("@netlify/blobs")).getStore("kullanim");
    const id = `${key}:${new Date().toISOString().slice(0, 7)}`; // YYYY-MM
    const n = (await store.get(id, { type: "json", consistency: "strong" })) || 0;
    await store.setJSON(id, n + 1);
  } catch { /* sayaç çökerse hizmeti kesme */ }
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return cevap({ ok: false, hata: "POST gerekli" }, 405);

  // Opsiyonel app-secret kapısı (ayarlıysa zorunlu)
  const beklenen = process.env.APP_SECRET;
  if (beklenen && req.headers.get("x-app-secret") !== beklenen) {
    return cevap({ ok: false, hata: "Yetkisiz istek." }, 401);
  }

  // LİSANS KAPISI: geçerli + aktif lisans şart (kontör kötüye kullanımını engeller)
  const lisans = String(req.headers.get("x-lisans") || "").trim().toUpperCase();
  const lk = await lisansKontrol(lisans);
  if (!lk.gecerli) return cevap({ ok: false, hata: lk.mesaj }, 401);
  if (await limitAsildi(lisans, 60)) return cevap({ ok: false, hata: "Çok fazla istek — biraz sonra deneyin." }, 429);
  await kullanimArtir(lisans);

  // Anahtar farklı isimle kayıtlı olabilir — yaygın adları sırayla dene.
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY
    || process.env.CLAUDE_API_KEY || process.env.CLAUDE_KEY || process.env.API_KEY;
  if (!apiKey) return cevap({ ok: false, hata: "Sunucu yapılandırması eksik (ANTHROPIC API anahtarı env'de yok)." }, 500);

  let body = {};
  try { body = await req.json(); } catch { return cevap({ ok: false, hata: "Geçersiz istek gövdesi." }, 400); }

  const image = String(body.image || "");
  if (!image) return cevap({ ok: false, hata: "Görüntü (image) boş." }, 400);
  // Prompt UYGULAMADAN gelir; gelmezse minimal yedek.
  const prompt = String(body.prompt || "Bu reçete görüntüsündeki bilgileri JSON olarak çıkar. Göremediğin alana null yaz.");
  const model = process.env.VISION_MODEL || "claude-haiku-4-5";

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: image } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      const detay = data?.error?.message || `Anthropic ${resp.status}`;
      return cevap({ ok: false, hata: `AI servisi hatası: ${detay}` }, 502);
    }
    if (data.stop_reason === "refusal") return cevap({ ok: false, hata: "AI isteği reddetti." });

    const blok = (data.content || []).find((b) => b.type === "text");
    const ham = (blok && blok.text) ? String(blok.text) : "";
    if (!ham) return cevap({ ok: false, hata: "AI boş yanıt döndü." });
    return cevap({ ok: true, ham });
  } catch (e) {
    return cevap({ ok: false, hata: `Sunucu hatası: ${String(e?.message || e)}` }, 500);
  }
};
