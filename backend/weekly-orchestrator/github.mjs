// 開発日誌の自動下書き用に、直近のGitコミット（1行サマリ）をGitHub APIから取得する。
// パブリックリポジトリならトークン不要だが、GITHUB_TOKEN を設定するとレート制限が緩和される。
const REPO = process.env.GITHUB_REPO;            // "owner/repo"
const TOKEN = process.env.GITHUB_TOKEN || '';    // 任意
const SINCE_DAYS = Number(process.env.DEVLOG_SINCE_DAYS || 7);

export async function fetchRecentCommits() {
  if (!REPO) throw new Error('GITHUB_REPO 未設定');
  const since = new Date(Date.now() - SINCE_DAYS * 86400000).toISOString();
  const url = `https://api.github.com/repos/${REPO}/commits?since=${encodeURIComponent(since)}&per_page=50`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'orbit-canvas-weekly-orchestrator',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();

  // マージコミット等のノイズは除き、コミットメッセージの1行目だけを使う
  return data
    .map((c) => (c.commit?.message || '').split('\n')[0].trim())
    .filter((m) => m && !/^Merge /.test(m));
}
