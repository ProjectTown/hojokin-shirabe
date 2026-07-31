import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// 公開URLは環境変数 SITE_URL で差し替える。
// Cloudflare Pages は本番ビルド時に CF_PAGES_URL を自動で渡してくる。
const site = process.env.SITE_URL ?? process.env.CF_PAGES_URL ?? "https://hojokin-shirabe.pages.dev";

export default defineConfig({
  site,
  base: process.env.BASE_PATH ?? "/",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [sitemap({ filter: (page) => !page.includes("/go/") })],
});
