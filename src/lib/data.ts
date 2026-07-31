import raw from "../../data/subsidies.json";

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
  category: string;
  sourceUpdatedAt: string;
  /** 最後にAPI取得へ成功した時刻。取得に失敗した回はこの値が据え置かれる。 */
  lastSuccessfulFetch?: string;
  generatedAt: string;
  counts: { subsidies: number; areas: number; industries: number };
  facets: { areas: string[]; industries: string[] };
  records: Subsidy[];
};

export const dataset = raw as unknown as Dataset;
export const subsidies = dataset.records;

/** 都道府県 → URL用スラッグ。日本語URLを避けて経路を安定させる。 */
export const PREF_SLUG: Record<string, string> = {
  北海道: "hokkaido", 青森県: "aomori", 岩手県: "iwate", 宮城県: "miyagi",
  秋田県: "akita", 山形県: "yamagata", 福島県: "fukushima", 茨城県: "ibaraki",
  栃木県: "tochigi", 群馬県: "gunma", 埼玉県: "saitama", 千葉県: "chiba",
  東京都: "tokyo", 神奈川県: "kanagawa", 新潟県: "niigata", 富山県: "toyama",
  石川県: "ishikawa", 福井県: "fukui", 山梨県: "yamanashi", 長野県: "nagano",
  岐阜県: "gifu", 静岡県: "shizuoka", 愛知県: "aichi", 三重県: "mie",
  滋賀県: "shiga", 京都府: "kyoto", 大阪府: "osaka", 兵庫県: "hyogo",
  奈良県: "nara", 和歌山県: "wakayama", 鳥取県: "tottori", 島根県: "shimane",
  岡山県: "okayama", 広島県: "hiroshima", 山口県: "yamaguchi", 徳島県: "tokushima",
  香川県: "kagawa", 愛媛県: "ehime", 高知県: "kochi", 福岡県: "fukuoka",
  佐賀県: "saga", 長崎県: "nagasaki", 熊本県: "kumamoto", 大分県: "oita",
  宮崎県: "miyazaki", 鹿児島県: "kagoshima", 沖縄県: "okinawa",
};

/** 日本標準産業分類の大分類 → URL用スラッグ。 */
export const INDUSTRY_SLUG: Record<string, string> = {
  "農業、林業": "agriculture",
  漁業: "fishery",
  "鉱業、採石業、砂利採取業": "mining",
  建設業: "construction",
  製造業: "manufacturing",
  "電気・ガス・熱供給・水道業": "utilities",
  情報通信業: "ict",
  "運輸業、郵便業": "transport",
  "卸売業、小売業": "retail",
  "金融業、保険業": "finance",
  "不動産業、物品賃貸業": "realestate",
  "学術研究、専門・技術サービス業": "research",
  "宿泊業、飲食サービス業": "hospitality",
  "生活関連サービス業、娯楽業": "lifestyle",
  "教育、学習支援業": "education",
  "医療、福祉": "healthcare",
  複合サービス事業: "compound",
  "サービス業（他に分類されないもの）": "services",
  "公務（他に分類されるものを除く）": "public",
  分類不能の産業: "other",
};

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
