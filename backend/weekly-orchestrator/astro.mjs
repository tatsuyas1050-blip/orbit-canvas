// 天文現象を計算で生成する。星空情報局(events.html)の「手入力ゼロ化」の中核。
// 計算で確定できる現象（新月・満月・二至二分・主要流星群）を対象にする。
// すべて日本時間(JST = UTC+9)の日付キー(YYYY-MM-DD)で返す。
import * as Astronomy from 'astronomy-engine';

// 主要流星群の年間ピーク日（JSTの日付。年によって±1日ずれるが、下書きとして十分）
const METEOR_SHOWERS = [
  { name: 'しぶんぎ座流星群', month: 1,  day: 4 },
  { name: '4月こと座流星群', month: 4,  day: 22 },
  { name: 'みずがめ座η流星群', month: 5,  day: 6 },
  { name: 'みずがめ座δ南流星群', month: 7,  day: 30 },
  { name: 'ペルセウス座流星群', month: 8,  day: 13 },
  { name: 'オリオン座流星群', month: 10, day: 21 },
  { name: 'おうし座南流星群', month: 11, day: 6 },
  { name: 'しし座流星群', month: 11, day: 18 },
  { name: 'ふたご座流星群', month: 12, day: 14 },
  { name: 'こぐま座流星群', month: 12, day: 22 },
];

// UTCのDate → JSTの "YYYY-MM-DD"
export function toJstDateStr(date) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// UTCのDate → JSTの "HH:MM頃"
function toJstHm(date) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}頃`;
}

// startDate〜endDate（Dateオブジェクト）の範囲の天文現象を配列で返す。
// 各要素: { date, title, type, time, desc }（type は events.html の凡例に合わせる）
export function computeAstroEvents(startDate, endDate) {
  const events = [];

  // --- 月相（新月・満月のみ。上弦/下弦は情報量が少ないので除外） ---
  let mq = Astronomy.SearchMoonQuarter(startDate);
  let guard = 0;
  while (mq.time.date <= endDate && guard < 400) {
    guard++;
    if (mq.quarter === 0 || mq.quarter === 2) {
      const isNew = mq.quarter === 0;
      events.push({
        date: toJstDateStr(mq.time.date),
        title: isNew ? '新月' : '満月',
        type: 'eclipse', // 月・太陽カテゴリ（黄）
        time: toJstHm(mq.time.date),
        desc: isNew
          ? '新月。月明かりがなく、淡い天体まで見渡せる星空観察に最適な夜です。'
          : '満月。夜空高くに輝く丸い月を楽しめます。',
      });
    }
    mq = Astronomy.NextMoonQuarter(mq);
  }

  // --- 二至二分（春分・夏至・秋分・冬至） ---
  for (let y = startDate.getUTCFullYear(); y <= endDate.getUTCFullYear(); y++) {
    const s = Astronomy.Seasons(y);
    const seasonList = [
      { t: s.mar_equinox,  name: '春分' },
      { t: s.jun_solstice, name: '夏至' },
      { t: s.sep_equinox,  name: '秋分' },
      { t: s.dec_solstice, name: '冬至' },
    ];
    for (const se of seasonList) {
      if (se.t.date >= startDate && se.t.date <= endDate) {
        events.push({
          date: toJstDateStr(se.t.date),
          title: se.name,
          type: 'phenomenon', // 天文現象（青）
          time: toJstHm(se.t.date),
          desc: `${se.name}。季節の移ろいを天文の節目から感じられる日です。`,
        });
      }
    }
  }

  // --- 主要流星群 ---
  for (let y = startDate.getUTCFullYear(); y <= endDate.getUTCFullYear(); y++) {
    for (const sh of METEOR_SHOWERS) {
      const dateStr = `${y}-${String(sh.month).padStart(2, '0')}-${String(sh.day).padStart(2, '0')}`;
      // JST正午を代表時刻として範囲判定（日付キー自体はJSTピーク日）
      const dObj = new Date(`${dateStr}T12:00:00+09:00`);
      if (dObj >= startDate && dObj <= endDate) {
        events.push({
          date: dateStr,
          title: `${sh.name}（極大）`,
          type: 'meteor', // 流星群（緑）
          time: '深夜〜明け方',
          desc: `${sh.name}が極大を迎えます。空の暗い場所で、放射点が高く昇る深夜から明け方が観察の狙い目です。`,
        });
      }
    }
  }

  return events;
}
