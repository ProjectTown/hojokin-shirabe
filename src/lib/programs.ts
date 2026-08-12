import raw from "../../data/programs.json";
import { subsidies } from "./data";

/** 制度の1回分の公募。実施機関が複数ある回は1行にまとめてある。 */
export type ProgramRound = {
  /** 第何次・第何回か。title から読み取れなかった場合は null。 */
  round: number | null;
  /** 「次」か「回」か。制度ごとに呼び方が違うので原文の言い方に合わせる。 */
  roundUnit: string | null;
  /** 「一般型」「ビジネスモデル構築型」などの枠。無い制度は null。 */
  frame: string | null;
  /** 受付開始日 YYYY-MM-DD */
  start: string | null;
  /** 締切日 YYYY-MM-DD */
  end: string | null;
  maxLimit: number | null;
  /** この回を実施した機関の数（都道府県の商工会連合会ごとに分かれる制度がある）。 */
  bodies: number;
  ids: string[];
};

export type Program = {
  slug: string;
  name: string;
  roundCount: number;
  firstDeadline: string;
  lastDeadline: string;
  /** 同じ枠で回次が1つ進むまでにかかった実測日数。測れない制度は null。 */
  intervalDays: { median: number; min: number; max: number; samples: number } | null;
  rounds: ProgramRound[];
};

export type ProgramDataset = {
  generatedAt: string;
  lastSuccessfulFetch: string | null;
  degraded?: { reason: string; at: string };
  rule: Record<string, string>;
  counts: { scanned: number; published: number };
  programs: Program[];
};

export const programDataset = raw as unknown as ProgramDataset;
export const programs = programDataset.programs;

/** 詳細ページ（/s/[id]/）を持っているのは、いま募集中として取得できた回だけ。 */
const detailIds = new Set(subsidies.map((s) => s.id));
export const detailIdOf = (round: ProgramRound): string | null =>
  round.ids.find((id) => detailIds.has(id)) ?? null;

/** 締切日が今日より後か。制度ページで「受付中の回があるか」を示すのに使う。 */
export function isUpcoming(round: ProgramRound, now = new Date()): boolean {
  if (!round.end) return false;
  return new Date(`${round.end}T23:59:59+09:00`).getTime() >= now.getTime();
}

export const upcomingRounds = (p: Program, now = new Date()) => p.rounds.filter((r) => isUpcoming(r, now));

/** 制度名が長いので、タイトルや一覧では読める長さに切る。 */
export function clip(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max)}…` : name;
}

/**
 * タイトル用の短い制度名。
 *
 * 単純に切り詰めると「…受付1」「…受付2」のように末尾だけが違う制度が
 * 同じ文字列になり、title が重複してSEO監査で止まる。
 * かといって正式名称に戻すと50字を超え、検索結果では
 * 区別が付く部分がちょうど切り落とされてしまう。
 * そこでぶつかった制度は「先頭＋末尾」に畳んで、違いが残る形にする。
 */
function buildShortNames(max: number): Map<string, string> {
  const tally = (names: string[]) => {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    return counts;
  };

  const head = programs.map((p) => clip(p.name, max));
  const headCounts = tally(head);

  // 違いが出るまで末尾を長く取る。「商工会」と「商工会議所」のように
  // 差が名前の中ほどにある制度があり、末尾を固定長にすると畳んでも区別できない。
  let best = head;
  for (const tail of [6, 10, 14, 18]) {
    const folded = programs.map((p, i) =>
      (headCounts.get(head[i]) ?? 0) > 1 && p.name.length > max
        ? `${p.name.slice(0, Math.max(1, max - tail - 1))}…${p.name.slice(-tail)}`
        : head[i],
    );
    best = folded;
    if ([...tally(folded).values()].every((n) => n === 1)) break;
  }

  // どう畳んでも重なる場合だけ、やむを得ず正式名称を使う。
  const bestCounts = tally(best);
  return new Map(programs.map((p, i) => [p.slug, (bestCounts.get(best[i]) ?? 0) > 1 ? p.name : best[i]]));
}

const SHORT_NAMES = buildShortNames(24);
export const shortNameOf = (p: Program): string => SHORT_NAMES.get(p.slug) ?? p.name;

/** 「第20次」「第10回」。原文で使われている言い方をそのまま出す。 */
export function roundLabel(round: ProgramRound): string {
  if (round.round === null) return "記載なし";
  return `第${round.round}${round.roundUnit ?? "回"}`;
}

/** 制度全体で主に使われている呼び方（「次」か「回」か）。 */
export function unitOf(program: Program): string {
  const units = program.rounds.map((r) => r.roundUnit).filter(Boolean) as string[];
  const counts = new Map<string, number>();
  for (const u of units) counts.set(u, (counts.get(u) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "回";
}

export function formatDay(day: string | null): string {
  if (!day) return "記載なし";
  const [y, m, d] = day.split("-");
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}
