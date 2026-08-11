/**
 * data/details/*.json （Jグランツ詳細のキャッシュ）を
 * サイト生成用の 1 ファイル data/subsidies.json に整形する。
 *
 * ここでやること:
 *   - manifest.json に載っている対象カテゴリの分だけを採用する（範囲を広げない）
 *   - 「北海道 / 青森県 / ...」のような複数地域文字列を都道府県配列に分解
 *   - 本文HTMLから style/script/クラス等を落として安全なタグだけ残す
 *   - 締切・金額など比較に使う値を数値/日付に正規化
 *
 * 補助金の可否判断は一切行わない。原文の事実を転記・整形するだけ。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { redact, findContacts } from "./redact.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "details");

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

const ALLOWED_TAGS = new Set(["p", "br", "ul", "ol", "li", "strong", "em", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td"]);

/** 本文HTMLを許可タグだけに削ぎ落とす。属性は全て捨てる。 */
function sanitizeHtml(html) {
  if (!html) return "";
  let out = html
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, slash, tag) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return t === "div" ? (slash ? "</p>" : "<p>") : "";
    return `<${slash}${t}>`;
  });
  // 空段落と連続改行を畳む
  out = out.replace(/<p>\s*(<br>\s*)*<\/p>/g, "").replace(/(<br>\s*){3,}/g, "<br><br>").trim();
  // 取得時に取りこぼした連絡先があればここでも落とす（二重の網）
  return redact(out);
}

/** HTMLからプレーンテキストを作る（説明文・検索用）。 */
function toText(html, limit = 0) {
  const t = String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return limit && t.length > limit ? `${t.slice(0, limit)}…` : t;
}

/** 「全国 / 東京都 / 大阪府」形式を都道府県配列に分解する。 */
function parseAreas(raw) {
  const s = String(raw || "");
  if (!s) return { areas: [], isNational: false };
  const parts = s.split("/").map((x) => x.trim()).filter(Boolean);
  const isNational = parts.includes("全国");
  const areas = parts.filter((p) => PREFECTURES.includes(p));
  return { areas: isNational ? PREFECTURES : areas, isNational };
}

const splitList = (raw) =>
  String(raw || "").split("/").map((x) => x.trim()).filter(Boolean);

function main_normalize(detail, category) {
  const { areas, isNational } = parseAreas(detail.targetAreaSearch);
  const purposes = splitList(detail.usePurpose);
  const end = detail.acceptanceEnd ? new Date(detail.acceptanceEnd) : null;
  const start = detail.acceptanceStart ? new Date(detail.acceptanceStart) : null;
  const body = sanitizeHtml(detail.detailHtml);
  return {
    id: detail.id,
    code: detail.name,
    title: detail.title,
    catchPhrase: detail.catchPhrase,
    summary: toText(body, 110),
    bodyHtml: body,
    purposes,
    industries: splitList(detail.industry),
    areas,
    isNational,
    areaLabel: isNational ? "全国" : (areas.join("・") || "指定なし"),
    employees: detail.targetEmployees || null,
    rate: detail.subsidyRate || null,
    maxLimit: detail.subsidyMaxLimit || null,
    acceptanceStart: start ? start.toISOString() : null,
    acceptanceEnd: end ? end.toISOString() : null,
    projectEndDeadline: detail.projectEndDeadline || null,
    officialUrl: detail.officialUrl,
    institution: detail.institutionName || null,
    guidelines: (detail.guidelines || []).map((g) => g.name),
    category,
  };
}

const OUT_FILE = path.join(DATA_DIR, "subsidies.json");

/** 直前に生成できていたデータ。取得失敗時はこれをそのまま使う。 */
async function previousDataset() {
  try {
    return JSON.parse(await readFile(OUT_FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 取得に失敗した場合の退避。
 * 最後に正常取得できたデータを維持し、生成時刻だけ更新して返す。
 */
async function keepPrevious(reason) {
  const prev = await previousDataset();
  if (!prev) {
    console.error(`取得に失敗し、代わりに使える既存データもありません: ${reason}`);
    process.exit(1);
  }
  prev.generatedAt = new Date().toISOString();
  prev.degraded = { reason, at: prev.generatedAt };
  await writeFile(OUT_FILE, JSON.stringify(prev));
  console.warn(`! 取得に失敗したため既存データを維持します（${reason}）`);
  console.warn(`  最終取得: ${prev.lastSuccessfulFetch ?? prev.sourceUpdatedAt} / ${prev.records.length}件`);
}

/**
 * どのページを検索エンジンに載せるかを決める。
 *
 * 掲載データの半分以上が「全国対象」なので、地域や業種で絞っても
 * 中身がほとんど同じページが大量にできる。それを全部インデックスさせると
 * 重複・低品質と判断されてサイト全体の評価を落とす。
 * そのため「そのページにしかない情報があるか」を基準に選別する。
 * 落選したページも利用者には従来どおり表示し、noindex, follow を付けるだけ。
 */
function buildSeoPolicy(records, areas, industries) {
  const local = records.filter((r) => !r.isNational);

  // 都道府県ページはその県だけの制度を載せる（全国分は /national/ に集約）。
  // 内容は県ごとに重ならないが、2件しかないページは内容が薄いので掲載しない。
  const MIN_LOCAL_AREA = 3;
  const indexableAreas = areas.filter(
    (p) => local.filter((r) => r.areas.includes(p)).length >= MIN_LOCAL_AREA,
  );

  // 業種: 対象業種を絞り込んでいる制度が2件以上あるか。
  // 全20業種を一律に対象とする制度ばかりだと、業種ページ同士が同一内容になる。
  const SPECIFIC_MAX = 10;
  const indexableIndustries = industries.filter(
    (i) =>
      i !== "分類不能の産業" &&
      records.filter((r) => r.industries.includes(i) && r.industries.length <= SPECIFIC_MAX).length >= 2,
  );

  // 地域×業種の940ページは、検索エンジンには一切載せない。
  //
  // 多くの制度が複数業種をまとめて対象にするため、同じ県の中で業種を変えても
  // 結果がそっくり同じになる。地域限定の制度が1件以上ある238ページに絞っても、
  // なお176組が95%超で一致し、完全一致する組み合わせもあった（実測）。
  // これは誘導ページとみなされ、サイト全体の評価を落とす典型例。
  //
  // 利用者には従来どおり表示し、絞り込みの受け皿と利用状況の計測にだけ使う。
  const indexableFinds = [];

  return {
    generatedAt: new Date().toISOString(),
    rule: {
      area: `その県限定の制度が${MIN_LOCAL_AREA}件以上`,
      industry: `対象業種を${SPECIFIC_MAX}業種以下に絞った制度が2件以上`,
      find: "掲載しない（組み合わせページは相互に重複するため）",
    },
    counts: {
      areas: `${indexableAreas.length}/${areas.length}`,
      industries: `${indexableIndustries.length}/${industries.length}`,
      finds: `${indexableFinds.length}/${areas.length * industries.length}`,
    },
    indexableAreas,
    indexableIndustries,
    indexableFinds,
  };
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(DATA_DIR, "manifest.json"), "utf8"));
  } catch (err) {
    return keepPrevious(`manifest.json を読めない (${err.code ?? err.message})`);
  }

  const wanted = new Set(manifest.ids);
  const files = (await readdir(CACHE_DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return keepPrevious("詳細データのキャッシュが空");

  const records = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    if (!wanted.has(id)) continue; // 対象カテゴリ以外は採用しない
    const detail = JSON.parse(await readFile(path.join(CACHE_DIR, f), "utf8"));
    if (!detail.officialUrl) continue; // 公式リンクを出せないものは載せない
    records.push(main_normalize(detail, manifest.category));
  }

  // 件数が急減した場合はAPI側の異常を疑い、既存データを優先する。
  const prev = await previousDataset();
  if (prev && prev.records.length >= 10 && records.length < prev.records.length * 0.5) {
    return keepPrevious(`取得件数が急減 (${prev.records.length}件 → ${records.length}件)`);
  }
  if (records.length === 0) return keepPrevious("有効な制度が0件");

  // 締切が近い順。締切不明は末尾。
  records.sort((a, b) => {
    if (!a.acceptanceEnd) return 1;
    if (!b.acceptanceEnd) return -1;
    return a.acceptanceEnd.localeCompare(b.acceptanceEnd);
  });

  const industries = [...new Set(records.flatMap((r) => r.industries))].sort();
  const areasUsed = PREFECTURES.filter((p) => records.some((r) => r.areas.includes(p)));

  const purposes = [...new Set(records.flatMap((r) => r.purposes))].sort(
    (a, b) => records.filter((r) => r.purposes.includes(b)).length - records.filter((r) => r.purposes.includes(a)).length,
  );

  const out = {
    categories: manifest.categories ?? [manifest.category],
    sourceUpdatedAt: manifest.updatedAt,
    lastSuccessfulFetch: manifest.updatedAt,
    generatedAt: new Date().toISOString(),
    counts: {
      subsidies: records.length,
      areas: areasUsed.length,
      industries: industries.length,
      purposes: purposes.length,
    },
    facets: { areas: areasUsed, industries, purposes },
    records,
  };

  // 連絡先が1件でも残っていたら書き出さずに止める。
  const leftovers = findContacts(JSON.stringify(out));
  if (leftovers.emails.length || leftovers.tels.length) {
    console.error("連絡先が除去できていないため中断します。");
    console.error(`  メール ${leftovers.emails.length}件 / 電話 ${leftovers.tels.length}件`);
    process.exit(1);
  }

  await writeFile(OUT_FILE, JSON.stringify(out));
  await writeFile(path.join(DATA_DIR, "seo.json"), JSON.stringify(buildSeoPolicy(records, areasUsed, industries), null, 2));
  console.log(`整形完了: ${records.length} 件 / 地域 ${areasUsed.length} / 業種 ${industries.length}`);
  console.log("連絡先チェック: メール0件 / 電話0件");
  console.log(`カテゴリ: ${(manifest.categories ?? [manifest.category]).length}種類`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
