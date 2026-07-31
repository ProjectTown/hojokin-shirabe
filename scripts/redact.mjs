/**
 * 補助金の公式データ本文には、担当窓口のメールアドレスや電話番号が
 * そのまま含まれていることがある（個人名入りのアドレスを含む）。
 *
 * 本サイトは連絡先を扱わない方針のため、保存前・表示前の両方で削る。
 * 利用者は各ページの公式リンクから一次情報に辿れるので、情報は失われない。
 *
 * 正規表現は必ず線形時間で走るよう組む。ドメイン部にドットを含む文字クラスを
 * 使うと「ラベル」と「区切り」が曖昧になり、長い連続文字列で破滅的バックトラックを
 * 起こす（実際にデータ中の長大な A の連続で処理が停止した）。
 * そのためラベルの文字クラスからドットを外し、区切りのドットを明示している。
 */

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,5}[A-Za-z]{2,24}/g;

// 日本の電話・FAX番号。3ブロックすべてが揃う形だけを対象にして、
// 郵便番号(〒060-0001)や日付(2026-07-31)を巻き込まないようにする。
const TEL = /0\d{1,4}-\d{1,4}-\d{3,4}/g;
const TEL_PAREN = /0\d{1,4}\(\d{1,4}\)\d{3,4}/g;

const NOTE = "（連絡先は公式ページをご確認ください）";
const LABEL = /(?:TEL|Tel|tel|電話番号|電話|℡|FAX|Fax|fax|ファックス|E-?mail|E-?MAIL|Ｅメール|メールアドレス|メール)[：:\s]*$/;

/** 文字列からメールアドレス・電話番号を取り除く。 */
export function redact(text) {
  if (!text) return text;
  let out = String(text).replace(EMAIL, NOTE).replace(TEL_PAREN, NOTE).replace(TEL, NOTE);

  // 「電話: （連絡先は…）」のように見出し語だけ残るのを整える
  out = out.split(NOTE).map((part, i, arr) => (i < arr.length - 1 ? part.replace(LABEL, "") : part)).join(NOTE);

  // 連続した同じ注記を1つにまとめる
  while (out.includes(NOTE + NOTE)) out = out.split(NOTE + NOTE).join(NOTE);
  return out;
}

/** オブジェクトの文字列フィールドをまとめて処理する。 */
export function redactFields(obj, fields) {
  for (const f of fields) {
    if (typeof obj[f] === "string") obj[f] = redact(obj[f]);
  }
  return obj;
}

/** 検査用。残っていれば一覧を返す。 */
export function findContacts(text) {
  const s = String(text || "");
  return {
    emails: [...new Set(s.match(EMAIL) ?? [])],
    tels: [...new Set([...(s.match(TEL) ?? []), ...(s.match(TEL_PAREN) ?? [])])],
  };
}
