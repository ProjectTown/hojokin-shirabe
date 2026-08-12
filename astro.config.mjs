import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { readFileSync } from "node:fs";

import { PREF_SLUG, INDUSTRY_SLUG } from "./src/lib/slugs.mjs";

// 公開URLは環境変数 SITE_URL で差し替える。
// Cloudflare Pages は本番ビルド時に CF_PAGES_URL を自動で渡してくる。
const site = process.env.SITE_URL ?? process.env.CF_PAGES_URL ?? "https://hojokin-shirabe.pages.dev";

const seo = JSON.parse(readFileSync(new URL("./data/seo.json", import.meta.url), "utf8"));
const programs = JSON.parse(readFileSync(new URL("./data/programs.json", import.meta.url), "utf8"));

/**
 * サイトマップに載せてよいURLの集合。
 * noindex を付けたページをサイトマップに入れると、検索エンジンに
 * 矛盾した指示を出すことになるため、判定を1か所に揃える。
 */
const allowed = new Set([
  "/",
  "/search/",
  "/area/",
  "/industry/",
  "/deadline/",
  "/national/",
  "/about/",
  "/program/",
  ...programs.programs.map((p) => `/program/${p.slug}/`),
  ...seo.indexableAreas.map((p) => `/area/${PREF_SLUG[p]}/`),
  ...seo.indexableIndustries.map((i) => `/industry/${INDUSTRY_SLUG[i]}/`),
  ...seo.indexableFinds.map((k) => {
    const [p, i] = k.split("\t");
    return `/find/${PREF_SLUG[p]}/${INDUSTRY_SLUG[i]}/`;
  }),
]);

export default defineConfig({
  site,
  base: process.env.BASE_PATH ?? "/",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        // 個々の補助金ページは常に掲載する（1件ずつ内容が異なる）
        if (path.startsWith("/s/")) return true;
        return allowed.has(path);
      },
    }),
  ],
});
