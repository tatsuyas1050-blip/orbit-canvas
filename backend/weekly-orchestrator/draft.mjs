// 直近コミットから「開発日誌」の下書きをClaudeに書かせる。
// モデルは既存の管理画面AI解析(claude-sonnet-4-6)に揃える。
// 高品質を求める場合は環境変数 CLAUDE_MODEL=claude-opus-4-8 に変更可。
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function draftDevlog(commitMessages) {
  const list = commitMessages.map((m) => `- ${m}`).join('\n');
  const prompt = `あなたは星空アプリ「orbit-canvas」の開発者「ソノッキー」です。
直近のGitコミット一覧をもとに、サイトを見にきてくれるファンに向けた「開発日誌」の下書きを日本語で書いてください。

# 制約
- タイトルは20文字以内
- 本文は200〜400字程度
- 技術用語はかみ砕き、「何が良くなったか」「次に何をしたいか」を親しみやすい語り口で
- コミットメッセージの丸写しは禁止。自分の言葉でまとめ直す
- 出力はJSONのみ。前後に説明文を付けない: {"title": "...", "body": "..."}

# 直近のコミット
${list}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('開発日誌の下書きJSONを抽出できませんでした');
  const obj = JSON.parse(match[0]);
  return {
    title: (obj.title || '開発日誌').toString().slice(0, 40),
    body: (obj.body || '').toString(),
  };
}

// 指定タブ（星空コラム/ギャラリー/ヨゾラジ等）の投稿ネタを2〜3案提案する。
// upcoming: [{date,title}] 今後の天文現象（タイムリーなネタの種）
// recent: string[] 最近の同タブ投稿タイトル（重複回避）
export async function proposeIdeasForTab({ tabLabel, upcoming = [], recent = [] }) {
  const upcomingTxt = upcoming.length
    ? upcoming.map((e) => `- ${e.date} ${e.title}`).join('\n')
    : '（特になし）';
  const recentTxt = recent.length ? recent.join(' / ') : '（なし）';

  const prompt = `あなたは星空アプリ「orbit-canvas」の運営アシスタントです。開発者「ソノッキー」が「ソノッキーの部屋」の「${tabLabel}」に投稿するネタを提案してください。

# 今後の天文現象（タイムリーなネタの種）
${upcomingTxt}

# 最近の「${tabLabel}」投稿タイトル（重複を避ける）
${recentTxt}

# 指示
- 2〜3案
- 直近の天文現象や季節を絡め、今すぐ取りかかれる具体的なネタにする
- 過去タイトルと重複しない
- angle は20〜40字で切り口を一言
- 出力はJSONのみ（前後に説明文を付けない）: [{"title":"","angle":""}]`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
