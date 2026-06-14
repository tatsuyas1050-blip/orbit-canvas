// LINE Messaging API(Bot) で自分にプッシュ通知する。
// ※「LINE Notify」は2025/3/31で終了したため、Messaging APIのpushを使う。
//   LINE_CHANNEL_ACCESS_TOKEN: Messaging APIチャネルのアクセストークン
//   LINE_USER_ID: 通知先の自分のユーザーID（Webhookで取得、README参照）
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const TO = process.env.LINE_USER_ID;

export async function sendLine(text) {
  if (!TOKEN || !TO) {
    console.warn('LINE未設定のため通知をスキップしました');
    return;
  }
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      to: TO,
      messages: [{ type: 'text', text: text.slice(0, 4900) }], // LINEの上限5000字に対し余裕を持たせる
    }),
  });
  if (!res.ok) {
    throw new Error(`LINE push ${res.status} ${await res.text().catch(() => '')}`);
  }
}
