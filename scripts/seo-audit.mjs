/**
 * ビルド成果物のSEO監査。
 * noindexとサイトマップの整合、title/descriptionの長さ、見出し構造、
 * canonical、構造化データ、内部リンクの到達性をまとめて検査する。
 */
import fs from "node:fs";
import path from "node:path";

const DIST = "dist";
const pages = [];

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "index.html") {
      const url = `/${path.relative(DIST, dir).split(path.sep).join("/")}/`.replace("//", "/");
      pages.push({ url, file: p, html: fs.readFileSync(p, "utf8") });
    }
  }
})(DIST);

const attr = (html, re) => (html.match(re) ?? [])[1] ?? null;
const titleOf = (h) => attr(h, /<title>([\s\S]*?)<\/title>/);
const descOf = (h) => attr(h, /<meta name="description" content="([\s\S]*?)"/);
const canonOf = (h) => attr(h, /<link rel="canonical" href="([^"]*)"/);
const isNoindex = (h) => /<meta name="robots" content="noindex/.test(h);
const h1Count = (h) => (h.match(/<h1[\s>]/g) ?? []).length;
const hasJsonLd = (h) => /application\/ld\+json/.test(h);

const sitemapUrls = new Set();
for (const f of fs.readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f))) {
  for (const m of fs.readFileSync(path.join(DIST, f), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)) {
    sitemapUrls.add(new URL(m[1]).pathname);
  }
}

const indexable = pages.filter((p) => !isNoindex(p.html) && !p.url.startsWith("/go/"));
const noindexed = pages.filter((p) => isNoindex(p.html));

console.log("=== ページ分類 ===");
console.log(`生成ページ         : ${pages.length}`);
console.log(`検索掲載する       : ${indexable.length}`);
console.log(`noindex            : ${noindexed.length}`);
console.log(`サイトマップ掲載   : ${sitemapUrls.size}`);

// サイトマップとnoindexの矛盾
const contradiction = [...sitemapUrls].filter((u) => {
  const p = pages.find((x) => x.url === u);
  return p && isNoindex(p.html);
});
const missing = indexable.filter((p) => !sitemapUrls.has(p.url));
console.log("");
console.log("=== 整合性 ===");
console.log(`noindexなのにサイトマップ掲載 : ${contradiction.length}件 ${contradiction.slice(0, 3).join(" ")}`);
console.log(`掲載対象なのにサイトマップ漏れ : ${missing.length}件 ${missing.slice(0, 5).map((p) => p.url).join(" ")}`);

// canonical
const badCanon = indexable.filter((p) => {
  const c = canonOf(p.html);
  return !c || new URL(c).pathname !== p.url;
});
console.log(`canonicalが自ページを指さない  : ${badCanon.length}件 ${badCanon.slice(0, 3).map((p) => p.url).join(" ")}`);

// title / description
const overTitle = indexable.filter((p) => (titleOf(p.html) ?? "").length > 40);
const dupTitle = new Map();
for (const p of indexable) {
  const t = titleOf(p.html);
  dupTitle.set(t, (dupTitle.get(t) ?? 0) + 1);
}
const dupT = [...dupTitle.entries()].filter(([, n]) => n > 1);
const noDesc = indexable.filter((p) => !descOf(p.html));
const overDesc = indexable.filter((p) => (descOf(p.html) ?? "").length > 120);
const dupDesc = new Map();
for (const p of indexable) {
  const d = descOf(p.html);
  dupDesc.set(d, (dupDesc.get(d) ?? 0) + 1);
}
const dupD = [...dupDesc.entries()].filter(([, n]) => n > 1);

console.log("");
console.log("=== タイトル・説明文（検索掲載ページのみ） ===");
console.log(`title 40文字超     : ${overTitle.length}件`);
console.log(`title 重複         : ${dupT.length}種 ${dupT.slice(0, 2).map(([t, n]) => `"${String(t).slice(0, 24)}"x${n}`).join(" ")}`);
console.log(`description なし   : ${noDesc.length}件`);
console.log(`description 120字超: ${overDesc.length}件`);
console.log(`description 重複   : ${dupD.length}種`);

// 本文量。
//
// Googleは2024年3月から Scaled Content Abuse（大量生成コンテンツの悪用）を
// スパムポリシーに明記しており、独自の価値が薄いページを大量に並べると
// サイト全体が手動対策の対象になる。ページを機械生成する以上、
// 「中身が薄いページを1件も公開しない」ことを人手の判断ではなく関門で担保する。
//
// 判定はヘッダー・フッターを除いた <main> 内の文字数で行う。
// 共通部分を含めると、中身が空のページでも1,000字を超えてしまう。
const mainTextLength = (html) => {
  const main = (html.match(/<main[^>]*>([\s\S]*?)<\/main>/) ?? [])[1] ?? "";
  return main
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, "")
    .length;
};
const MIN_MAIN_TEXT = 300;
const thin = indexable
  .map((p) => ({ url: p.url, n: mainTextLength(p.html) }))
  .filter((x) => x.n < MIN_MAIN_TEXT)
  .sort((a, b) => a.n - b.n);

console.log("");
console.log("=== 本文量（検索掲載ページのみ） ===");
const lens = indexable.map((p) => mainTextLength(p.html)).sort((a, b) => a - b);
console.log(`本文 中央値 : ${lens[Math.floor(lens.length / 2)]} 字`);
console.log(`本文 最小   : ${lens[0]} 字（下限 ${MIN_MAIN_TEXT} 字）`);
console.log(`下限割れ    : ${thin.length}件 ${thin.slice(0, 5).map((x) => `${x.url}(${x.n})`).join(" ")}`);

// 見出し
const badH1 = indexable.filter((p) => h1Count(p.html) !== 1);
console.log("");
console.log("=== 見出し構造 ===");
console.log(`h1が1個でない      : ${badH1.length}件 ${badH1.slice(0, 3).map((p) => `${p.url}(${h1Count(p.html)})`).join(" ")}`);

// 構造化データ
const detailPages = pages.filter((p) => p.url.startsWith("/s/"));
console.log(`構造化データあり   : ${detailPages.filter((p) => hasJsonLd(p.html)).length}/${detailPages.length} (詳細ページ)`);

// 内部リンク: トップから何クリックで届くか
const linksOf = (html) =>
  [...html.matchAll(/href="(\/[^"#]*?)"/g)].map((m) => m[1]).filter((u) => !u.startsWith("/go/"));
const byUrl = new Map(pages.map((p) => [p.url, p]));
const depth = new Map([["/", 0]]);
let frontier = ["/"];
while (frontier.length) {
  const next = [];
  for (const u of frontier) {
    const p = byUrl.get(u);
    if (!p) continue;
    for (const l of linksOf(p.html)) {
      if (byUrl.has(l) && !depth.has(l)) {
        depth.set(l, depth.get(u) + 1);
        next.push(l);
      }
    }
  }
  frontier = next;
}
const unreachable = indexable.filter((p) => !depth.has(p.url));
const deep = indexable.filter((p) => (depth.get(p.url) ?? 9) >= 4);
console.log("");
console.log("=== 内部リンク（トップからの距離） ===");
const dist = {};
for (const p of indexable) dist[depth.get(p.url) ?? "到達不可"] = (dist[depth.get(p.url) ?? "到達不可"] ?? 0) + 1;
console.log(Object.entries(dist).map(([k, v]) => `${k}クリック:${v}件`).join(" / "));
console.log(`到達できない       : ${unreachable.length}件 ${unreachable.slice(0, 5).map((p) => p.url).join(" ")}`);
console.log(`4クリック以上      : ${deep.length}件`);

// ページ重量
const sizes = indexable.map((p) => Buffer.byteLength(p.html));
const css = fs.readdirSync(path.join(DIST, "_astro")).filter((f) => f.endsWith(".css"));
const cssBytes = css.reduce((n, f) => n + fs.statSync(path.join(DIST, "_astro", f)).size, 0);
// 致命的な不整合は失敗として扱う。
// 実際に seo.json の再生成を忘れ、noindexにしたはずのページが
// サイトマップに残ったまま公開されかけた。CIで止められるようにする。
const fatal = [];
if (contradiction.length) fatal.push(`noindexページがサイトマップに${contradiction.length}件`);
if (missing.length) fatal.push(`掲載対象がサイトマップから${missing.length}件漏れ`);
if (badCanon.length) fatal.push(`canonicalが自ページを指さないページ${badCanon.length}件`);
if (badH1.length) fatal.push(`h1が1個でないページ${badH1.length}件`);
if (dupT.length) fatal.push(`titleが重複${dupT.length}種`);
if (noDesc.length) fatal.push(`descriptionなし${noDesc.length}件`);
if (unreachable.length) fatal.push(`トップから到達できない掲載ページ${unreachable.length}件`);
if (thin.length) fatal.push(`本文が${MIN_MAIN_TEXT}字未満の掲載ページ${thin.length}件`);

console.log("");
console.log("=== ページ重量（Core Web Vitals の目安） ===");
console.log(`HTML 中央値 : ${Math.round(sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] / 1024)} KB`);
console.log(`HTML 最大   : ${Math.round(Math.max(...sizes) / 1024)} KB (${indexable.find((p) => Buffer.byteLength(p.html) === Math.max(...sizes)).url})`);
console.log(`CSS 合計    : ${Math.round(cssBytes / 1024)} KB (${css.length}ファイル)`);
console.log(`JSファイル  : ${fs.readdirSync(path.join(DIST, "_astro")).filter((f) => f.endsWith(".js")).length} 個`);

console.log("");
if (fatal.length) {
  console.error("=== 検査に失敗しました ===");
  for (const f of fatal) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("=== 検査に合格 ===");
