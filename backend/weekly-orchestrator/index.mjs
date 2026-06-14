// 週次オーケストレーター（EventBridgeから週1で起動）
//  1) 天文現象を計算 → 不足分を下書き投入（星空情報局の手入力ゼロ化）
//  2) 直近コミット → Claudeで開発日誌の下書き生成
//  3) コンテンツ鮮度を集計 → 「今週の一手」をLINEにプッシュ
import { fetchAllData, addDraft } from './store.mjs';
import { computeAstroEvents, toJstDateStr } from './astro.mjs';
import { fetchRecentCommits } from './github.mjs';
import { draftDevlog, proposeIdeasForTab } from './draft.mjs';
import { sendLine } from './line.mjs';

const WEEKS_AHEAD = Number(process.env.WEEKS_AHEAD || 8);
const ADMIN_URL = process.env.ADMIN_URL || '';

// 鮮度監視の対象カテゴリ（admin の週次コックピットと対応）
const CATS = [
  { key: 'column',    label: '星空コラム',   target: 21, human: true },
  { key: 'gallery',   label: 'ギャラリー',   target: 30, human: true },
  { key: 'radio',     label: 'ヨゾラジ',     target: 30, human: true },
  { key: 'devlog',    label: '開発日誌',     target: 14, human: false },
  { key: 'sky_event', label: '星空イベント', target: 30, human: false },
];

const DAY = 86400000;

function computeFreshness(allData) {
  const now = Date.now();
  const lastByCat = {};
  Object.keys(allData).forEach((date) => {
    (allData[date] || []).forEach((item) => {
      const cat = item.category || 'sky_event';
      const t = item.updatedAt ? Date.parse(item.updatedAt) : Date.parse(date);
      if (!Number.isNaN(t) && (lastByCat[cat] === undefined || t > lastByCat[cat])) {
        lastByCat[cat] = t;
      }
    });
  });
  return CATS.map((c) => {
    const last = lastByCat[c.key];
    const days = last === undefined ? null : Math.floor((now - last) / DAY);
    let dot;
    if (days === null) dot = '🔴';
    else if (days < 0) dot = '🟢';        // 未来日付（イベントが先まで仕込まれている）
    else if (days < c.target) dot = '🟢';
    else if (days < c.target * 2) dot = '🟡';
    else dot = '🔴';
    return { ...c, days, dot };
  });
}

// 人が作るタブで一番放置されているものを返す
function pickStalest(freshness) {
  const human = freshness.filter((f) => f.human);
  human.sort((a, b) => {
    const av = a.days === null ? Infinity : a.days;
    const bv = b.days === null ? Infinity : b.days;
    return bv - av; // 放置日数が大きい順
  });
  return human[0] || null;
}

// 最近の同カテゴリ投稿タイトル（重複回避用）
function recentTitles(allData, cat, n = 5) {
  const items = [];
  Object.keys(allData).forEach((date) => {
    (allData[date] || []).forEach((it) => {
      if ((it.category || 'sky_event') === cat && it.status !== 'draft') {
        items.push({ date, title: it.title });
      }
    });
  });
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return items.slice(0, n).map((i) => i.title);
}

function buildMessage({ devlogAdded, freshness, stalest, ideas }) {
  const lines = [];
  lines.push('🌌 今週の orbit-canvas 運用');
  lines.push('');
  if (devlogAdded > 0) {
    lines.push('📥 開発日誌の下書きを追加しました（管理画面で確認・公開を）');
    lines.push('');
  }

  // 今週の一手 + ネタ提案
  if (stalest) {
    const since = stalest.days === null ? 'まだ未投稿' : `${stalest.days}日前が最終更新`;
    lines.push(`✍️ 今週の一手: 「${stalest.label}」を1本（${since}）`);
    if (ideas && ideas.length) {
      lines.push('💡 ネタ案:');
      ideas.slice(0, 3).forEach((idea) => {
        const angle = idea.angle ? ` — ${idea.angle}` : '';
        lines.push(`・${idea.title}${angle}`);
      });
    }
    lines.push('');
  }

  lines.push('📊 コンテンツ鮮度');
  freshness.forEach((f) => {
    const txt = f.days === null ? '未投稿' : f.days < 0 ? '先の予定あり' : `${f.days}日前`;
    lines.push(`${f.dot} ${f.label}（${txt}）`);
  });

  if (ADMIN_URL) {
    lines.push('');
    lines.push('▼ 下書きの確認・公開はこちら');
    lines.push(ADMIN_URL);
  }
  return lines.join('\n');
}

export const handler = async () => {
  const log = [];
  const allData = await fetchAllData();

  // --- 1) 今後の天文現象を計算（※カレンダーへの自動投入はしない／手動AIインポートで運用）---
  //   ここで得た現象は「ネタ提案」のタイムリーな種としてのみ使う。
  const now = new Date();
  const end = new Date(now.getTime() + WEEKS_AHEAD * 7 * DAY);
  const astro = computeAstroEvents(now, end);

  // --- 2) 開発日誌のAI下書き ---
  let devlogAdded = 0;
  try {
    const commits = await fetchRecentCommits();
    if (commits.length > 0) {
      const draft = await draftDevlog(commits);
      await addDraft(toJstDateStr(now), {
        title: draft.title,
        desc: draft.body,
        image: '',
        category: 'devlog',
      });
      devlogAdded++;
    } else {
      log.push('直近コミットなし。開発日誌はスキップ');
    }
  } catch (e) {
    log.push(`devlog失敗: ${e.message}`);
  }

  // --- 3) 鮮度集計 + LINE通知 ---
  // 投入直後の鮮度を反映するため再取得（任意。失敗しても通知は出す）
  let dataForFreshness = allData;
  try {
    dataForFreshness = await fetchAllData();
  } catch (e) {
    log.push(`鮮度用の再取得失敗: ${e.message}`);
  }
  const freshness = computeFreshness(dataForFreshness);
  const stalest = pickStalest(freshness);

  // 「今週の一手」タブのネタをAIで提案（直近の天文現象を種に）
  let ideas = [];
  if (stalest) {
    try {
      const recent = recentTitles(dataForFreshness, stalest.key);
      const upcoming = astro.slice(0, 10).map((e) => ({ date: e.date, title: e.title }));
      ideas = await proposeIdeasForTab({ tabLabel: stalest.label, upcoming, recent });
    } catch (e) {
      log.push(`ネタ提案失敗: ${e.message}`);
    }
  }

  try {
    await sendLine(buildMessage({ devlogAdded, freshness, stalest, ideas }));
  } catch (e) {
    log.push(`LINE通知失敗: ${e.message}`);
  }

  const result = { ok: true, devlogAdded, log };
  console.log(JSON.stringify(result));
  return result;
};
