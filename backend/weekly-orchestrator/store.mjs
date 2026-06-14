// 既存の GET_URL / PUT_URL を「クライアントとして」呼ぶ。
// DynamoDB に直接触らず、admin と同じ書き込みAPIに status:'draft' で投入する疎結合方式。
const GET_URL = process.env.GET_URL;
const PUT_URL = process.env.PUT_URL;
const PASSWORD = process.env.PUT_PASSWORD;

export async function fetchAllData() {
  const res = await fetch(GET_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
}

// 下書きとして1件追加する。action:'add' なので id はサーバ側で採番される
// （admin の保存フローと同一）。承認制のため status は必ず 'draft'。
export async function addDraft(date, eventData) {
  const body = {
    password: PASSWORD,
    date,
    action: 'add',
    eventData: {
      ...eventData,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    },
  };
  const res = await fetch(PUT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json().catch(() => ({}));
}
