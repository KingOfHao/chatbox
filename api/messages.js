// api/messages.js — Vercel Serverless Function (có hỗ trợ gửi ảnh)
// Tin nhắn nằm trong một list Redis; mỗi ảnh lưu ở một key riêng để list luôn nhẹ.

const crypto = require("crypto");

const MAX_MESSAGES = 100;        // vượt quá thì xóa tin cũ nhất (và ảnh của tin đó)
const MAX_LENGTH = 500;          // ký tự tối đa mỗi tin
const MAX_IMAGE_CHARS = 800000;  // độ dài base64 tối đa của 1 ảnh (~600KB), Upstash free giới hạn 1MB/request
const KEY = "chat:messages";
const imgKey = (id) => `chat:img:${id}`;

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(commands) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error("Redis error " + r.status);
  const out = await r.json();
  const bad = out.find((x) => x.error);
  if (bad) throw new Error(bad.error);
  return out;
}

const clampInt = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "public, s-maxage=1, stale-while-revalidate=2");
      const [{ result }] = await redis([["LRANGE", KEY, "0", "-1"]]);
      return res.status(200).json((result || []).map((m) => JSON.parse(m)));
    }

    if (req.method === "POST") {
      res.setHeader("Cache-Control", "no-store");
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const text = String(body.text || "").trim().slice(0, MAX_LENGTH);
      const sender = String(body.sender || "").slice(0, 40);

      // Chỉ nhận JPEG base64 (client luôn nén về JPEG trước khi gửi)
      let b64 = null;
      if (body.image) {
        const prefix = "data:image/jpeg;base64,";
        const img = String(body.image);
        if (!img.startsWith(prefix)) return res.status(400).json({ error: "Ảnh không hợp lệ" });
        b64 = img.slice(prefix.length);
        if (b64.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
          return res.status(400).json({ error: "Ảnh không hợp lệ hoặc quá lớn" });
        }
      }

      if (!text && !b64) return res.status(400).json({ error: "Tin nhắn trống" });

      const msg = { text, sender, time: Date.now() };
      const commands = [];

      if (b64) {
        const id = crypto.randomBytes(8).toString("hex"); // 16 ký tự hex
        msg.img = id;
        msg.w = clampInt(body.w, 1, 4000);
        msg.h = clampInt(body.h, 1, 4000);
        commands.push(["SET", imgKey(id), b64]);
      }

      commands.push(["RPUSH", KEY, JSON.stringify(msg)]);
      commands.push(["LLEN", KEY]);
      const results = await redis(commands);
      const len = results[results.length - 1].result;

      // Quá giới hạn: bỏ tin cũ nhất và xóa luôn ảnh của chúng
      if (len > MAX_MESSAGES) {
        const [{ result: removed }] = await redis([["LPOP", KEY, String(len - MAX_MESSAGES)]]);
        const oldKeys = (removed || [])
          .map((s) => { try { return JSON.parse(s).img; } catch { return null; } })
          .filter(Boolean)
          .map(imgKey);
        if (oldKeys.length) await redis([["DEL", ...oldKeys]]);
      }

      return res.status(200).json(msg);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: e.message });
  }
};
