// 七夕短冊「みんなで共有」API
// GET  /  → { wishes: [ {id,text,name,color,at}, ... ] }   … 古い順（吊るされた順）
// POST /  body {text,name,color} → { ok:true, wish:{id,text,name,color,at} }
//
// DynamoDB は「単一パーティション pk=WISH#v1 + sk=<at>#<id>」で時系列に並べる素朴な設計。
// 個人規模のボードなのでこれで十分（ホットパーティションの心配はない）。
// AWS SDK v3 は nodejs22.x ランタイムに同梱されているため node_modules 不要。

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;
const MAX = parseInt(process.env.MAX_WISHES || "1000", 10);
const ORIGIN = process.env.ALLOW_ORIGIN || "*";
const PK = "WISH#v1";
const COLORS = new Set(["aka", "ki", "midori", "murasaki", "shiro"]);

const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (statusCode, obj) => ({ statusCode, headers: CORS, body: JSON.stringify(obj) });

// 制御文字（改行・タブ以外）を除去してトリムし、最大長でカット
function clean(s, max) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}
function uid() {
  return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const handler = async (event) => {
  const method =
    event?.requestContext?.http?.method || event?.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  try {
    if (method === "GET") {
      const wishes = [];
      let ExclusiveStartKey;
      do {
        const r = await ddb.send(
          new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: "pk = :p",
            ExpressionAttributeValues: { ":p": PK },
            ScanIndexForward: true, // 古い順
            Limit: 200,
            ExclusiveStartKey,
          })
        );
        for (const it of r.Items || []) {
          wishes.push({
            id: it.id,
            text: it.text,
            name: it.name || "",
            color: it.color,
            at: it.at,
          });
        }
        ExclusiveStartKey = r.LastEvaluatedKey;
      } while (ExclusiveStartKey && wishes.length < MAX);
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
      const at = Date.now();
      const id = uid();
      const Item = {
        pk: PK,
        sk: String(at).padStart(15, "0") + "#" + id,
        id,
        text,
        name,
        color,
        at,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item }));
      return reply(201, { ok: true, wish: { id, text, name, color, at } });
    }

    return reply(405, { error: "method not allowed" });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "server error" });
  }
};
