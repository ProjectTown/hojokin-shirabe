/**
 * デジタル庁 Jグランツ 公開APIから「1カテゴリ分だけ」補助金データを取得する。
 *
 * 方針（意図的に小さく保つ）:
 *   - 対象は use_purpose で指定した 1 カテゴリのみ。全件クロールはしない。
 *   - 1回の検索で扱う件数は MAX_PER_SEARCH (=100) 件までに切り詰める。
 *   - 1回の実行で送るリクエスト総数を MAX_REQUESTS で上限管理し、超えたら中断する。
 *   - 取得済みの詳細はキャッシュして再取得しない。
 *
 * API はデジタル庁が公開する無料・認証不要のエンドポイント。
 * 利用料・APIキー・アカウント登録のいずれも発生しない。
 * https://developers.digital.go.jp/documents/jgrants/api/
 */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { redactFields } from "./redact.mjs";

// 通常はデジタル庁の公開エンドポイント。
// 障害時の退避動作を検証するときだけ JGRANTS_API_BASE で差し替える。
const API = `${process.env.JGRANTS_API_BASE ?? "https://api.jgrants-portal.go.jp"}/exp/v1/public/subsidies`;
const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "details");

// ---- 取得範囲のハードリミット -------------------------------------------
/** 1回の検索で扱う最大件数。これを超える分は捨てる。 */
const MAX_PER_SEARCH = 100;
/** 1回の実行で送信してよいHTTPリクエストの総数。 */
const MAX_REQUESTS = 110;
/** 同時接続数。相手は公共APIなので低く保つ。 */
const CONCURRENCY = 3;
// -------------------------------------------------------------------------

/** Jグランツが公式に持つカテゴリ（use_purpose）。今回の対象は 1 つだけ。 */
export const CATEGORIES = [
  "設備整備・IT導入をしたい",
  "新たな事業を行いたい",
  "エコ・SDGs活動支援がほしい",
  "まちづくり・地域振興支援がほしい",
  "研究開発・実証事業を行いたい",
  "販路拡大・海外展開をしたい",
  "イベント・事業運営支援がほしい",
  "雇用・職場環境を改善したい",
  "資金繰りを改善したい",
  "安全・防災対策支援がほしい",
  "人材育成を行いたい",
  "災害（自然災害、感染症等）支援がほしい",
  "事業を引き継ぎたい",
  "スポーツ・文化支援がほしい",
  "教育・子育て・少子化支援がほしい",
];

const TARGET_CATEGORY = process.env.CATEGORY ?? CATEGORIES[0];

let requestCount = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { retries = 2 } = {}) {
  if (requestCount >= MAX_REQUESTS) {
    throw new Error(`リクエスト上限 ${MAX_REQUESTS} に到達したため中断`);
  }
  for (let attempt = 0; ; attempt++) {
    requestCount++;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/**
 * 詳細レスポンスから巨大なbase64添付を落とし、必要な項目だけ残す。
 * あわせて担当窓口の連絡先（メール・電話）を保存前に取り除く。
 */
function slimDetail(raw) {
  const r = raw?.result?.[0];
  if (!r) return null;
  const attachments = (list) =>
    (Array.isArray(list) ? list : []).map((a) => ({ name: a?.name ?? null })).filter((a) => a.name);
  const slim = {
    id: r.id,
    name: r.name,
    title: r.title,
    catchPhrase: r.subsidy_catch_phrase || null,
    detailHtml: r.detail || null,
    usePurpose: r.use_purpose || null,
    industry: r.industry || null,
    targetAreaSearch: r.target_area_search || null,
    targetAreaDetail: r.target_area_detail || null,
    targetEmployees: r.target_number_of_employees || null,
    subsidyRate: r.subsidy_rate || null,
    subsidyMaxLimit: typeof r.subsidy_max_limit === "number" ? r.subsidy_max_limit : null,
    acceptanceStart: r.acceptance_start_datetime || null,
    acceptanceEnd: r.acceptance_end_datetime || null,
    projectEndDeadline: r.project_end_deadline || null,
    requestReceptionPresence: r.request_reception_presence || null,
    isEnableMultipleRequest: r.is_enable_multiple_request ?? null,
    officialUrl: r.front_subsidy_detail_page_url || null,
    institutionName: r.institution_name || null,
    outlineOfGrant: r.outline_of_grant || null,
    guidelines: attachments(r.application_guidelines),
    forms: attachments(r.application_form),
    fetchedAt: new Date().toISOString(),
  };
  return redactFields(slim, ["detailHtml", "outlineOfGrant", "targetAreaDetail", "catchPhrase", "title"]);
}

/** 対象カテゴリの募集中案件を 1 リクエストで引く。 */
async function searchCategory(category) {
  const params = new URLSearchParams({
    keyword: "補助",
    sort: "acceptance_end_datetime",
    order: "ASC",
    acceptance: "1", // 募集中のみ
    use_purpose: category,
  });
  const json = await getJson(`${API}?${params}`);
  const all = json?.result ?? [];
  const total = json?.metadata?.resultset?.count ?? all.length;
  if (all.length > MAX_PER_SEARCH) {
    console.log(`   API返却 ${all.length} 件 -> 上限 ${MAX_PER_SEARCH} 件に切り詰め`);
  }
  return { items: all.slice(0, MAX_PER_SEARCH), total };
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        await worker(items[cursor++]);
      }
    }),
  );
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  console.log(`対象カテゴリ: ${TARGET_CATEGORY}`);
  console.log(`上限: 1検索あたり ${MAX_PER_SEARCH} 件 / 実行あたり ${MAX_REQUESTS} リクエスト\n`);

  console.log("1) カテゴリ検索（1リクエスト）");
  const { items, total } = await searchCategory(TARGET_CATEGORY);
  console.log(`   募集中 ${total} 件中 ${items.length} 件を対象にする`);

  const cached = new Set(
    (await readdir(CACHE_DIR).catch(() => [])).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)),
  );
  const targets = items.filter((it) => !cached.has(it.id));
  console.log(`\n2) 詳細取得: ${targets.length} 件 (キャッシュ流用 ${items.length - targets.length} 件)`);

  let ok = 0;
  let fail = 0;
  try {
    await pool(targets, CONCURRENCY, async (item) => {
      try {
        const slim = slimDetail(await getJson(`${API}/id/${encodeURIComponent(item.id)}`));
        if (!slim) return void fail++;
        await writeFile(path.join(CACHE_DIR, `${item.id}.json`), JSON.stringify(slim));
        ok++;
      } catch (err) {
        fail++;
        console.warn(`   ! ${item.id}: ${err.message}`);
      }
      await sleep(200);
    });
  } catch (err) {
    console.warn(`   中断: ${err.message}`);
  }

  const manifest = {
    category: TARGET_CATEGORY,
    totalOpenInCategory: total,
    collected: items.length,
    ids: items.map((i) => i.id),
    limits: { maxPerSearch: MAX_PER_SEARCH, maxRequests: MAX_REQUESTS },
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path.join(DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n完了: ok=${ok} fail=${fail} / 送信リクエスト数 ${requestCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
