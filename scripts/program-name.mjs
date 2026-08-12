/**
 * Jグランツの制度名（title）を、制度・枠・回次に分解する。
 *
 * なぜ必要か:
 *   公式データは1回の公募＝1レコードで、制度名の中に年度・回次・実施機関が
 *   文字列として混ざっている。しかも表記が揺れる。
 *
 *     【経済産業省】令和元年度補正ものづくり…促進補助金〔一般型〕（3次締切）
 *     ［第三回］令和2年度事業再構築補助金（交付申請等）
 *     【長崎県商工会連合会】令和元年度補正予算 小規模事業者持続化補助金＜一般型＞ 第2回受付締切
 *
 *   このままでは「同じ制度の何回目か」を機械的に並べられない。
 *   ここで年度・回次・実施機関・枠を剥がして制度名だけを取り出すことで、
 *   初めて「制度ごとの公募履歴」という時系列が作れる。
 *
 * 方針:
 *   剥がすのは表記だけで、事実は足さない。判別できない要素は null のまま返す。
 */

/**
 * 表記ゆれを寄せる。
 *
 * NFKC は全角英数字・全角括弧を半角にするだけでなく、
 * 「⼩規模事業者持続化補助⾦」のように部首用の互換文字が混ざった実データも
 * 通常の漢字に直す（Jグランツに実在する）。これをやらないと同じ制度が
 * 別の制度として二重に並ぶ。
 */
export function toHalfWidth(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/　/g, " ")
    .replace(/[‐‑‒–—―－]/g, "-");
}

const KANJI_DIGITS = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/**
 * 漢数字を整数にする。「十」「十二」「二十」「二十三」まで対応する。
 * 回次は現実には数十までなので、それ以上は扱わない。
 */
export function kanjiToNumber(s) {
  const t = String(s ?? "").trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  if (!/^[〇一二三四五六七八九十]+$/.test(t)) return null;
  if (!t.includes("十")) {
    let n = 0;
    for (const c of t) {
      if (!(c in KANJI_DIGITS)) return null;
      n = n * 10 + KANJI_DIGITS[c];
    }
    return n;
  }
  const [tens, ones] = t.split("十");
  const high = tens === "" ? 1 : KANJI_DIGITS[tens];
  const low = ones === "" ? 0 : KANJI_DIGITS[ones];
  if (high === undefined || low === undefined) return null;
  return high * 10 + low;
}

const NUM = "[0-9]+|[〇一二三四五六七八九十]+";

/**
 * 回次の後ろに付く語。「第9回受付締切分」のように重なるため、
 * 個別の語を並べるのではなく一続きの並びとして飲み込む。
 */
const ROUND_TAIL = "(?:受付)?(?:締切|公募|募集|受付)?分?";

/**
 * 「3次締切」「第二回受付締切分」「[１次公募]」などの回次表現。
 *
 * 「次」と「回」はどちらを使うかが制度ごとに決まっている
 * （ものづくり補助金は「第20次締切」、事業再構築補助金は「第10回」）。
 * 検索もその言葉で打たれるため、数字だけでなく単位も保持する。
 */
const ROUND_PATTERNS = [
  { unit: "次", re: new RegExp(`第?\\s*(${NUM})\\s*次\\s*${ROUND_TAIL}`) },
  { unit: "回", re: new RegExp(`第\\s*(${NUM})\\s*回\\s*${ROUND_TAIL}`) },
];

/**
 * 年度・予算年度の表記。制度名の一部ではないので落とす。
 *
 * 「年度」または「補正」まで揃っている場合だけ落とす。
 * 「令和6年能登半島地震」のように年号が固有名詞の一部になっている例があり、
 * 「令和6年」だけで落とすと制度名を壊してしまう（実データで確認済み）。
 */
const FISCAL_YEAR = /(?:令和|平成)\s*(?:元|[0-9]+)\s*年(?:度(?:補正)?|補正)(?:予算)?分?/g;

/**
 * 「第2次補正（予算）」は補正予算の回であって、公募の回次ではない。
 * 回次として読むと「令和4年度第2次補正」の制度が全て2回目になってしまうため、
 * 回次を取り出す前にここで落としておく。
 */
const SUPPLEMENTARY_BUDGET = new RegExp(`第\\s*(?:[0-9]+|[〇一二三四五六七八九十]+)\\s*次\\s*補正(?:予算)?分?`, "g");

/**
 * 年号と切り離して「（補正予算）」「当初予算」だけが置かれている書き方。
 * どの予算から出ているかの注記であって、制度名ではない。
 */
const BUDGET_NOTE = /[（(]?\s*(?:当初|補正)予算\s*[）)]?/g;

/** 事務手続き上のバリエーション。制度そのものの名前ではない。 */
const ADMIN_SUFFIXES = [
  /[（(]\s*(?:事務局|執行団体|基金設置法人)\s*公募\s*[）)]/g,
  /[（(]\s*交付申請等\s*[）)]/g,
  /[（(]\s*共同申請(?:者)?(?:[_\s]*リース会社)?\s*[）)]/g,
  /[_\s]*執行団体公募/g,
  /[（(]\s*[-\s]*(?:事務局|執行団体|基金設置法人)\s*公募\s*[）)]/g,
];

/** 枠・型の表記。同じ制度でも枠ごとに締切が違うため、制度とは別に保持する。 */
const FRAME_BRACKETS = [
  [/[＜<]([^＞>]*?)[＞>]/g],
  [/〔([^〕]*?)〕/g],
];

function extractRound(text) {
  for (const { unit, re } of ROUND_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const n = kanjiToNumber(m[1]);
    if (n === null || n === 0) continue;
    return { round: n, unit, matched: m[0] };
  }
  return null;
}

/**
 * 制度名を分解する。
 *
 * @param {string} rawTitle Jグランツの title をそのまま渡す
 * @returns {{program: string, frame: string|null, round: number|null, roundUnit: string|null, institution: string|null}}
 */
export function parseProgramTitle(rawTitle) {
  let t = toHalfWidth(rawTitle).replace(/\s+/g, " ").trim();

  let round = null;
  let roundUnit = null;
  let institution = null;

  // 1) 角括弧の中身を取り出す。回次のこともあれば実施機関のこともある。
  //    【二次公募】【3次公募】は回次、【経済産業省】【長崎県商工会連合会】は機関。
  t = t.replace(/[【［\[]([^】］\]]*)[】］\]]/g, (_m, inner) => {
    const r = extractRound(inner);
    if (r && round === null) {
      round = r.round;
      roundUnit = r.unit;
      return " ";
    }
    if (institution === null && inner.trim()) institution = inner.trim();
    return " ";
  });

  // 2) 年度・補正予算の表記を落とす。補正予算の「次」を先に消してから回次を読む。
  t = t.replace(FISCAL_YEAR, " ").replace(SUPPLEMENTARY_BUDGET, " ").replace(BUDGET_NOTE, " ");

  // 3) 枠・型を取り出す。
  let frame = null;
  for (const [re] of FRAME_BRACKETS) {
    t = t.replace(re, (_m, inner) => {
      if (frame === null && inner.trim()) frame = inner.trim();
      return " ";
    });
  }

  // 4) 事務手続き上のバリエーションを落とす。
  for (const re of ADMIN_SUFFIXES) t = t.replace(re, " ");

  // 5) 残りから回次を取り出す。丸括弧で囲まれている場合は括弧ごと落とす。
  if (round === null) {
    const paren = t.match(new RegExp(`[（(]\\s*第?\\s*(?:${NUM})\\s*[次回][^）)]*[）)]`));
    if (paren) {
      const r = extractRound(paren[0]);
      if (r) {
        round = r.round;
        roundUnit = r.unit;
        t = t.replace(paren[0], " ");
      }
    }
  }
  if (round === null) {
    const r = extractRound(t);
    if (r) {
      round = r.round;
      roundUnit = r.unit;
      t = t.replace(r.matched, " ");
    }
  }

  // 6) residue の整形。
  //    要素を抜いた跡に空の括弧や区切り記号だけが残る。区切りを消すと
  //    さらに括弧が空になる、という連鎖が起きるため、変化しなくなるまで回す。
  let program = t;
  for (let i = 0; i < 5; i++) {
    const before = program;
    program = program
      .replace(/[_\-‐–—]+/g, " ")
      .replace(/[（(]\s*[）)]/g, " ")
      .replace(/[「『]\s*[」』]/g, " ")
      .replace(/[＜〔\[]\s*[＞〕\]]/g, " ")
      .replace(/([（(「『])\s+/g, "$1")
      .replace(/\s+([）)」』])/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/^[\s・,、.。／/]+|[\s・,、.。／/]+$/g, "")
      .trim();
    if (program === before) break;
  }

  return { program, frame, round, roundUnit, institution };
}

/** 表示・URL用に制度名を安定したキーにする。 */
export function programKey(program) {
  return toHalfWidth(program).replace(/\s+/g, "").toLowerCase();
}
