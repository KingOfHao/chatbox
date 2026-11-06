// api/image.js — trả ảnh JPEG theo id: /api/image?id=xxxxxxxxxxxxxxxx

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).end();

  try {
    const r = await fetch(`${URL_}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([["GET", `chat:img:${id}`]]),
    });
    const [{ result }] = await r.json();
    if (!result) return res.status(404).end();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // id không bao giờ đổi nội dung nên cache được rất lâu → mỗi ảnh chỉ tải một lần
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000 immutable");
    return res.status(200).send(Buffer.from(result, "base64"));
  } catch (e) {
    return res.status(500).end();
  }
};
