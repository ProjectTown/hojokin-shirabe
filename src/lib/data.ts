import raw from "../../data/subsidies.json";
import seoRaw from "../../data/seo.json";

export type Subsidy = {
  id: string;
  code: string;
  title: string;
  catchPhrase: string | null;
  summary: string;
  bodyHtml: string;
  purposes: string[];
  industries: string[];
  areas: string[];
  isNational: boolean;
  areaLabel: string;
  employees: string | null;
  rate: string | null;
  maxLimit: number | null;
  acceptanceStart: string | null;
  acceptanceEnd: string | null;
  projectEndDeadline: string | null;
  officialUrl: string;
  institution: string | null;
  guidelines: string[];
  category: string;
};

export type Dataset = {
  /** Jグランツの目的カテゴリ（use_purpose）のうち、取得対象にしたもの */
  categories: string[];
  sourceUpdatedAt: string;
  /** 最後にAPI取得へ成功した時刻。取得に失敗した回はこの値が据え置かれる。 */
  lastSuccessfulFetch?: string;
  generatedAt: string;
  counts: { subsidies: number; areas: number; industries: number; purposes: number };
  facets: { areas: string[]; industries: string[]; purposes: string[] };
  records: Subsidy[];
};

export const dataset = raw as unknown as Dataset;
export const subsidies = dataset.records;

export { PREF_SLUG, INDUSTRY_SLUG } from "./slugs.mjs";
import { PREF_SLUG, INDUSTRY_SLUG } from "./slugs.mjs";

export const slugToPref = Object.fromEntries(Object.entries(PREF_SLUG).map(([k, v]) => [v, k]));
export const slugToIndustry = Object.fromEntries(Object.entries(INDUSTRY_SLUG).map(([k, v]) => [v, k]));

/** 締切までの残り日数。締切不明なら null。 */
export function daysLeft(iso: string | null, from = new Date()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - from.getTime();
  return Math.ceil(ms / 86_400_000);
}

export type Status = {
  kind: "closed" | "urgent" | "open" | "unknown";
  label: string;
  className: string;
};

/**
 * 制度の状態。データが古くなると「募集中として取得したが実際は終了済み」が起きるため、
 * 締切日を毎ビルド時に見直して受付終了を明示する。
 */
export function statusOf(s: Subsidy, now = new Date()): Status {
  const d = daysLeft(s.acceptanceEnd, now);
  if (d === null) return { kind: "unknown", label: "締切の記載なし", className: "st-unknown" };
  if (d < 0) return { kind: "closed", label: "受付終了", className: "st-closed" };
  if (d === 0) return { kind: "urgent", label: "本日締切", className: "st-urgent" };
  if (d <= 14) return { kind: "urgent", label: `あと${d}日で締切`, className: "st-urgent" };
  return { kind: "open", label: `あと${d}日`, className: "st-open" };
}

/** データ取得日からの経過日数。古いほど表示内容の信頼度が下がる。 */
export function dataAgeDays(now = new Date()): number {
  const src = dataset.lastSuccessfulFetch ?? dataset.sourceUpdatedAt;
  return Math.floor((now.getTime() - new Date(src).getTime()) / 86_400_000);
}

/** 3日以上更新されていないなら、利用者に注意を出す。 */
export function isStale(now = new Date()): boolean {
  return dataAgeDays(now) >= 3;
}

export const openSubsidies = () => subsidies.filter((s) => statusOf(s).kind !== "closed");
export const closedSubsidies = () => subsidies.filter((s) => statusOf(s).kind === "closed");

export function formatDate(iso: string | null): string {
  if (!iso) return "記載なし";
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 金額を「1,280万円」のような読みやすい表記にする。 */
export function formatYen(v: number | null): string {
  if (v === null || v === 0) return "記載なし";
  if (v >= 100_000_000) {
    const oku = v / 100_000_000;
    return `${Number.isInteger(oku) ? oku : oku.toFixed(1)}億円`;
  }
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString("ja-JP")}万円`;
  return `${v.toLocaleString("ja-JP")}円`;
}

export const byArea = (pref: string) => subsidies.filter((s) => s.areas.includes(pref));
export const byIndustry = (name: string) => subsidies.filter((s) => s.industries.includes(name));

/**
 * 検索エンジンに載せるページの判定。
 * 掲載データの半分以上が全国対象のため、絞り込みページの多くが
 * 互いにほぼ同一の内容になる。重複と判断されてサイト全体の評価が
 * 落ちるのを避けるため、固有情報があるページだけを掲載対象にする。
 * 対象外のページも利用者には通常どおり表示し、noindex, follow を付けるだけ。
 * 判定の実体は normalize 時に data/seo.json へ書き出している。
 */
type SeoPolicy = {
  rule: Record<string, string>;
  counts: Record<string, string>;
  indexableAreas: string[];
  indexableIndustries: string[];
  indexableFinds: string[];
};

export const seo = seoRaw as SeoPolicy;

export const isIndexableArea = (pref: string) => seo.indexableAreas.includes(pref);
export const isIndexableIndustry = (name: string) => seo.indexableIndustries.includes(name);
export const isIndexableFind = (pref: string, industry: string) =>
  seo.indexableFinds.includes(`${pref}\t${industry}`);
