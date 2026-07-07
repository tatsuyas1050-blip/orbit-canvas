// 七夕短冊「みんなで共有」API（S3保存版）
// GET  /  → { wishes: [ {id,text,name,color,at}, ... ] }   … 古い順（吊るされた順）
// POST /  body {text,name,color} → { ok:true, wish:{id,text,name,color,at} }
//
// S3 の単一JSONファイル(wishes.json)に全短冊を配列で保存する素朴な設計。
// 個人〜家族規模のボードを想定（同時投稿はまれなので read→append→write で十分）。
// AWS SDK v3 は nodejs22.x ランタイムに同梱されているため node_modules 不要。

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;
const KEY = process.env.WISHES_KEY || "wishes.json";
const MAX = parseInt(process.env.MAX_WISHES || "1000", 10);
const COLORS = new Set(["aka", "ki", "midori", "murasaki", "shiro"]);

// CORS は Lambda Function URL 側の設定に一任する。
// ここでも Access-Control-* を付けるとヘッダが二重になり、ブラウザが CORS エラーで拒否する。
const HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const reply = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: JSON.stringify(obj) });

// 制御文字（タブ・改行・復帰は残す）を除去してトリム、最大長でカット
function clean(s, max) {
  const str = String(s == null ? "" : s);
  let out = "";
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) continue;
    out += ch;
  }
  return out.trim().slice(0, max);
}
function uid() {
  return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function readAll() {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
    const text = await r.Body.transformToString();
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return [];
    throw e;
  }
}
async function writeAll(list) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: KEY,
      Body: JSON.stringify(list),
      ContentType: "application/json; charset=utf-8",
    })
  );
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  try {
    if (method === "GET") {
      const all = await readAll();
      const wishes = all
        .slice(-MAX)
        .map((w) => ({ id: w.id, text: w.text, name: w.name || "", color: w.color, grove: w.grove | 0, at: w.at }));
      return reply(200, { wishes });
    }

    if (method === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return reply(400, { error: "invalid json" });
      }
      const text = clean(body.text, 40);
      if (!text) return reply(400, { error: "text required" });
      const name = clean(body.name, 16);
      const color = COLORS.has(body.color) ? body.color : "midori";
      // grove = どの笹か（0始まりの笹番号）。悪用防止に 0〜200 に制限
      const grove = Math.min(Math.max(0, parseInt(body.grove, 10) || 0), 200);
      const wish = { id: uid(), text, name, color, grove, at: Date.now() };

      const all = await readAll();
      all.push(wish);
      await writeAll(all);
      return reply(201, { ok: true, wish });
    }

    return reply(405, { error: "method not allowed" });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "server error" });
  }
};
