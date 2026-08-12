/**
 * 制度ごとの公募履歴（回次の時系列）を作る。
 *
 * 既存の fetch-category.mjs は「いま募集中の制度」だけを取る。
 * それだけだと、実際に検索される「ものづくり補助金 20次 締切」「持続化補助金 次はいつ」
 * のような固有名詞＋回次の問いに何も答えられない。
 *
 * ここでは検索APIを acceptance=0（終了分を含む）で引き、制度名から
 * 年度・実施機関・枠・回次を剥がして束ね直し、制度ごとの公募履歴にする。
 *
 * 設計上の判断:
 *   - 詳細APIは叩かない。検索結果に受付開始日・締切日・上限額が含まれており、
 *     時系列を作るのに足りる。詳細を取ると数千リクエストになり、
 *     さらに「1回次1ページ」の薄いページを量産する誘惑が生まれる。
 *   - 回次が少ない制度は載せない。時系列として読めないものはページにしない。
 *   - 予測はしない。「次回はいつ」は書かず、過去の実測間隔だけを出す。
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseProgramTitle, programKey, toHalfWidth } from "./program-name.mjs";
import { redact, findContacts } from "./redact.mjs";

const API = `${process.env.JGRANTS_API_BASE || "https://api.jgrants-portal.go.jp"}/exp/v1/public/subsidies`;
const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_FILE = path.join(DATA_DIR, "programs.json");

// ---- 取得範囲のハードリミット -------------------------------------------
/**
 * 全文検索の入口。APIはキーワード必須（2文字以上）で、
 * この3語で公開制度のほぼ全体を覆える（実測 3,085件）。
 */
const KEYWORDS = ["補助", "助成", "支援"];
/** 1回の実行で送ってよいリクエスト総数。相手は公共APIなので厳しく抑える。 */
const MAX_REQUESTS = 6;
/** リクエスト間隔(ms)。 */
const INTERVAL = 800;

// ---- 掲載の下限 -----------------------------------------------------------
/** 時系列として読めるだけの回次があること。 */
const MIN_ROUNDS = 3;
/** 締切日が実際に散らばっていること（同日の重複を数えない）。 */
const MIN_DISTINCT_DEADLINES = 3;
/** 公募の間隔が測れない制度に必要な回次。表だけで読ませるには回数が要る。 */
const MIN_ROUNDS_WITHOUT_INTERVAL = 4;

let requestCount = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  if (requestCount >= MAX_REQUESTS) throw new Error(`リクエスト上限 ${MAX_REQUESTS} に到達`);
  requestCount++;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sweep() {
  const byId = new Map();
  for (const keyword of KEYWORDS) {
    const params = new URLSearchParams({
      keyword,
      sort: "acceptance_end_datetime",
      order: "DESC",
      acceptance: "0", // 0 = 終了分を含む全件
    });
    const json = await getJson(`${API}?${params}`);
    const items = json?.result ?? [];
    for (const it of items) byId.set(it.id, it);
    console.log(`   ${String(items.length).padStart(5)}件  keyword=${keyword}  (累計 ${byId.size})`);
    await sleep(INTERVAL);
  }
  return [...byId.values()];
}

const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** 日付の差（日数）。 */
function diffDays(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/** 中央値。実測値の代表として平均より外れ値に強い。 */
function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * 検索結果を制度ごとに束ねる。
 *
 * 同じ回次が実施機関の数だけ重複して存在する（小規模事業者持続化補助金は
 * 都道府県の商工会連合会ごとに1レコードあり、1回次で最大47件）。
 * 回次・枠・締切日が同じものは1行にまとめ、機関数だけを数える。
 */
function group(rows) {
  const programs = new Map();

  for (const row of rows) {
    const title = redact(toHalfWidth(row.title ?? ""));
    const parsed = parseProgramTitle(title);
    if (!parsed.program) continue;

    const key = programKey(parsed.program);
    if (!programs.has(key)) programs.set(key, { name: parsed.program, rounds: new Map() });
    const program = programs.get(key);

    // 制度名の表記が回によって揺れる場合は、より短い方（装飾が少ない方）を代表にする。
    if (parsed.program.length < program.name.length) program.name = parsed.program;

    const end = dayOf(row.acceptance_end_datetime);
    const roundKey = `${parsed.round ?? "-"}\t${parsed.frame ?? "-"}\t${end ?? "-"}`;
    if (!program.rounds.has(roundKey)) {
      program.rounds.set(roundKey, {
        round: parsed.round,
        // 「第20次」か「第20回」か。制度ごとに呼び方が決まっており、
        // 検索もその言葉で打たれるため、勝手に統一しない。
        roundUnit: parsed.roundUnit,
        frame: parsed.frame,
        start: dayOf(row.acceptance_start_datetime),
        end,
        maxLimit: typeof row.subsidy_max_limit === "number" ? row.subsidy_max_limit : null,
        bodies: 0,
        ids: [],
      });
    }
    const entry = program.rounds.get(roundKey);
    entry.bodies++;
    // 詳細ページ（/s/[id]/）へ繋ぐ余地を残す。募集中のものだけがそこに存在する。
    if (entry.ids.length < 60) entry.ids.push(row.id);
    // 上限額は記載のあるレコードを優先して拾う（無記載のレコードが混ざるため）。
    if (entry.maxLimit === null && typeof row.subsidy_max_limit === "number") {
      entry.maxLimit = row.subsidy_max_limit;
    }
  }

  const out = [];
  for (const [key, program] of programs) {
    const rounds = [...program.rounds.values()].sort((a, b) => String(a.end).localeCompare(String(b.end)));
    const deadlines = [...new Set(rounds.map((r) => r.end).filter(Boolean))].sort();
    const numbered = new Set(rounds.map((r) => r.round).filter((n) => n !== null));

    if (numbered.size < MIN_ROUNDS) continue;
    if (deadlines.length < MIN_DISTINCT_DEADLINES) continue;

    // 公募の間隔は「同じ枠の、隣り合う回次同士」でしか測らない。
    // 枠をまたいで並べると、一般型の5次とコロナ特別対応型の3次が
    // 数日違いで並ぶような比較になり、間隔として意味を持たなくなる。
    const intervals = [];
    const byFrame = new Map();
    for (const r of rounds) {
      if (r.round === null || !r.end) continue;
      const f = r.frame ?? "";
      if (!byFrame.has(f)) byFrame.set(f, []);
      byFrame.get(f).push(r);
    }
    for (const series of byFrame.values()) {
      series.sort((a, b) => a.round - b.round);
      for (let i = 1; i < series.length; i++) {
        if (series[i].round !== series[i - 1].round + 1) continue;
        const d = diffDays(series[i - 1].end, series[i].end);
        if (d > 0) intervals.push(d);
      }
    }

    const intervalDays = intervals.length
      ? { median: median(intervals), min: Math.min(...intervals), max: Math.max(...intervals), samples: intervals.length }
      : null;

    // 回次が3つしかなく、しかも公募の間隔すら測れない制度は載せない。
    // そういうページに書けるのは数行の表だけで、他所より詳しいとは言えない。
    // 中身の薄いページを並べる行為は Google のスパムポリシー
    // （Scaled Content Abuse）に真っ直ぐ当たるため、生成の段階で止める。
    if (numbered.size < MIN_ROUNDS_WITHOUT_INTERVAL && intervalDays === null) continue;

    out.push({
      slug: createHash("sha1").update(key).digest("hex").slice(0, 8),
      name: program.name,
      roundCount: numbered.size,
      firstDeadline: deadlines[0],
      lastDeadline: deadlines[deadlines.length - 1],
      /** 同じ枠で回次が1つ進むまでにかかった実測日数。予測ではない。 */
      intervalDays,
      rounds,
    });
  }

  // 回次が多い＝時系列として読み応えがある順。
  return out.sort((a, b) => b.roundCount - a.roundCount || String(a.name).localeCompare(String(b.name), "ja"));
}

async function previous() {
  try {
    return JSON.parse(await readFile(OUT_FILE, "utf8"));
  } catch {
    return null;
  }
}

/** 取得に失敗しても、前回の履歴を使い続けてサイトを落とさない。 */
async function keepPrevious(reason) {
  const prev = await previous();
  if (!prev) {
    // 初回はまだ何も無い。制度ページを持たない空の状態で先に進める。
    const empty = {
      generatedAt: new Date().toISOString(),
      lastSuccessfulFetch: null,
      degraded: { reason, at: new Date().toISOString() },
      rule: {},
      counts: { scanned: 0, groups: 0, published: 0 },
      programs: [],
    };
    await writeFile(OUT_FILE, JSON.stringify(empty));
    console.warn(`! 取得に失敗し、過去データもないため制度ページなしで続行します（${reason}）`);
    return;
  }
  prev.generatedAt = new Date().toISOString();
  prev.degraded = { reason, at: prev.generatedAt };
  await writeFile(OUT_FILE, JSON.stringify(prev));
  console.warn(`! 取得に失敗したため既存の履歴を維持します（${reason}）`);
  console.warn(`  最終取得: ${prev.lastSuccessfulFetch} / 制度 ${prev.programs.length}件`);
}

async function main() {
  console.log(`制度履歴の取得: keyword=${KEYWORDS.join(",")} / 上限 ${MAX_REQUESTS} リクエスト\n`);

  let rows;
  try {
    rows = await sweep();
  } catch (err) {
    return keepPrevious(`検索APIの取得に失敗 (${err.message})`);
  }
  if (rows.length === 0) return keepPrevious("検索結果が0件");

  const programs = group(rows);

  // 件数が急減した場合はAPI側の異常を疑い、既存データを優先する。
  const prev = await previous();
  if (prev && prev.programs?.length >= 10 && programs.length < prev.programs.length * 0.5) {
    return keepPrevious(`制度数が急減 (${prev.programs.length}件 → ${programs.length}件)`);
  }

  const now = new Date().toISOString();
  const out = {
    generatedAt: now,
    lastSuccessfulFetch: now,
    rule: {
      source: `検索API keyword=${KEYWORDS.join("/")} / acceptance=0（終了分を含む）`,
      publish: `回次が${MIN_ROUNDS}種類以上・締切日が${MIN_DISTINCT_DEADLINES}種類以上あり、かつ公募間隔が測れるか回次が${MIN_ROUNDS_WITHOUT_INTERVAL}種類以上ある制度のみ`,
      dedupe: "回次・枠・締切日が同じレコードは1行にまとめ、実施機関の数を数える",
      forecast: "次回の予測は行わない。過去の実測間隔のみを出す",
    },
    counts: { scanned: rows.length, published: programs.length },
    programs,
  };

  // 制度名に連絡先が紛れていないか、書き出し前に確認する（normalize と同じ関門）。
  const leftovers = findContacts(JSON.stringify(out));
  if (leftovers.emails.length || leftovers.tels.length) {
    console.error("制度名に連絡先が残っているため中断します。");
    console.error(`  メール ${leftovers.emails.length}件 / 電話 ${leftovers.tels.length}件`);
    process.exit(1);
  }

  await writeFile(OUT_FILE, JSON.stringify(out));
  console.log(`\n走査 ${rows.length}件 -> 掲載する制度 ${programs.length}件（送信リクエスト ${requestCount}）`);
  for (const p of programs.slice(0, 5)) {
    console.log(`   ${String(p.roundCount).padStart(2)}回次  ${p.name.slice(0, 44)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
