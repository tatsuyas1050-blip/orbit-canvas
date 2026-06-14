// 直近コミットから「開発日誌」の下書きをClaudeに書かせる。
// モデルは既存の管理画面AI解析(claude-sonnet-4-6)に揃える。
// 高品質を求める場合は環境変数 CLAUDE_MODEL=claude-opus-4-8 に変更可。
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// commitMessages: string[]、options.nextNum: 連番(#N)、options.examples: [{title,body}] 文体の手本
export async function draftDevlog(commitMessages, { nextNum = null, examples = [] } = {}) {
  const list = commitMessages.map((m) => `- ${m}`).join('\n');
  const exampleText = examples.length
    ? examples.map((e) => `見出し: ${e.title}\n本文: ${e.body}`).join('\n\n')
    : '（手本なし）';

  const prompt = `あなたは星空アプリ「orbit-canvas」の開発者です。直近のGitコミットをもとに、サイトの「開発日誌」の新しい1件を、これまでのスタイルにそろえて書いてください。

# これまでの開発日誌（文体・書き方の手本。必ずこの調子に合わせる）
${exampleText}

# 書き方のルール
- 見出し：体言中心で簡潔に。例「「星を探す」に「ログ記録機能」追加」。機能名・画面名は「」で囲む。先頭の番号(#15 等)は付けない（番号はシステムが付与する）。
- 本文：1〜3文。「何を追加/変更したか」と「どう使えるか・どう動くか」を、ですます調で淡々と説明する。あいさつ・自己紹介・感想（「こんにちは」「ソノッキーです」「がんばりました」等）は書かない。
- コミットメッセージの専門用語をそのまま使わず、利用者目線の言葉にまとめ直す。
- 今回の更新が複数あれば、最も主要な1つに絞る。
- 出力はJSONのみ（前後に説明文を付けない）: {"title":"<番号なしの見出し>","body":"<本文>"}

# 今回のコミット
${list}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('開発日誌の下書きJSONを抽出できませんでした');
  const obj = JSON.parse(match[0]);

  // 見出しに番号が混じっていれば除去し、正しい連番を前置（番号はシステムが管理）
  const headline = (obj.title || '開発更新').toString().trim().replace(/^#\s*\d+\s*/, '');
  const title = (Number.isFinite(nextNum) ? `#${nextNum} ` : '') + headline;
  return {
    title: title.slice(0, 80),
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
