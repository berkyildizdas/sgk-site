/**
 * Asistan sohbeti (METİN) servisi — Netlify Function.
 * Uygulama, asistan prompt'unu (metin) buraya gönderir; Anthropic'e iletir, metin yanıtı döner.
 *
 * Netlify ortam değişkenleri:
 *   ANTHROPIC_API_KEY  → Anthropic API anahtarı (ZORUNLU)
 *   CHAT_MODEL         → (opsiyonel) model, varsayılan "claude-haiku-4-5"
 *   APP_SECRET         → (opsiyonel) ayarlıysa "x-app-secret" başlığıyla eşleşmeli
 *
 * Dönen biçim (app bunu bekler — electron/ai.ts):  { ok: true, metin: "..." }  veya  { ok: false, hata: "..." }
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-app-secret",
  "Content-Type": "application/json; charset=utf-8",
};
const cevap = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return cevap({ ok: false, hata: "POST gerekli" }, 405);

  const beklenen = process.env.APP_SECRET;
  if (beklenen && req.headers.get("x-app-secret") !== beklenen) {
    return cevap({ ok: false, hata: "Yetkisiz istek." }, 401);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY
    || process.env.CLAUDE_API_KEY || process.env.CLAUDE_KEY || process.env.API_KEY;
  if (!apiKey) return cevap({ ok: false, hata: "Sunucu yapılandırması eksik (ANTHROPIC API anahtarı env'de yok)." }, 500);

  let body = {};
  try { body = await req.json(); } catch { return cevap({ ok: false, hata: "Geçersiz istek gövdesi." }, 400); }

  const prompt = String(body.prompt || body.soru || "");
  if (!prompt) return cevap({ ok: false, hata: "Soru (prompt) boş." }, 400);
  const model = process.env.CHAT_MODEL || "claude-haiku-4-5";

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
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data) {
      const detay = data?.error?.message || `Anthropic ${resp.status}`;
      return cevap({ ok: false, hata: `AI servisi hatası: ${detay}` }, 502);
    }
    if (data.stop_reason === "refusal") return cevap({ ok: false, hata: "AI isteği reddetti." });

    const blok = (data.content || []).find((b) => b.type === "text");
    return cevap({ ok: true, metin: (blok && blok.text) ? String(blok.text) : "" });
  } catch (e) {
    return cevap({ ok: false, hata: `Sunucu hatası: ${String(e?.message || e)}` }, 500);
  }
};
