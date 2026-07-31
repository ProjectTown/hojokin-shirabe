import type { APIRoute } from "astro";
import { subsidies, formatYen } from "../lib/data";

/**
 * キーワード検索用の軽量インデックス。
 * 検索はすべて利用者のブラウザ内で行い、入力語はサーバーへ送らない。
 */
export const GET: APIRoute = () => {
  const items = subsidies.map((s) => ({
    i: s.id,
    t: s.title,
    a: s.isNational ? "全国" : s.areas.join(" "),
    n: s.industries.join(" "),
    m: formatYen(s.maxLimit),
    e: s.acceptanceEnd,
    s: s.summary.slice(0, 90),
  }));
  return new Response(JSON.stringify(items), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
