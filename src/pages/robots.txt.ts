import type { APIRoute } from "astro";

/**
 * robots.txt。Sitemap は絶対URLでなければクローラに無視されるため、
 * 静的ファイルではなく site 設定から組み立てる。
 */
export const GET: APIRoute = ({ site }) => {
  const origin = site?.toString().replace(/\/$/, "") ?? "";
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /go/",
    "Disallow: /search/result/",
    "Disallow: /search/none/",
    "",
    `Sitemap: ${origin}/sitemap-index.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
