/**
 * 既存キャッシュの後始末。
 *   1. 対象カテゴリ外のファイルを削除する（範囲外のデータは保持しない）
 *   2. 残すファイルから担当窓口の連絡先を取り除く
 * APIへの再取得は行わない。
 */
import fs from "node:fs";
import { redactFields, findContacts } from "./redact.mjs";

/**
 * 一時ファイルに書いてから置き換える。
 * 同名ファイルを直接開くとロック残りで UNKNOWN エラーになることがあるため。
 */
function writeAtomic(target, contents) {
  const tmp = `${target}.tmp`;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(tmp, contents);
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      if (attempt >= 4) throw err;
      const until = Date.now() + 300;
      while (Date.now() < until) { /* 短く待つ */ }
    }
  }
}

const manifest = JSON.parse(fs.readFileSync("data/manifest.json", "utf8"));
const want = new Set(manifest.ids);
const files = fs.readdirSync("data/details").filter((f) => f.endsWith(".json"));

let removed = 0;
let cleaned = 0;
let before = 0;

for (const f of files) {
  const p = `data/details/${f}`;
  if (!want.has(f.slice(0, -5))) {
    fs.unlinkSync(p);
    removed++;
    continue;
  }
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const c = findContacts(JSON.stringify(d));
  before += c.emails.length + c.tels.length;
  redactFields(d, ["detailHtml", "outlineOfGrant", "targetAreaDetail", "catchPhrase", "title"]);
  writeAtomic(p, JSON.stringify(d));
  cleaned++;
}

console.log(`対象カテゴリ外を削除: ${removed} 件`);
console.log(`連絡先を除去して書き直し: ${cleaned} 件（除去前の検出数 ${before}）`);

const rest = fs.readdirSync("data/details").filter((f) => f.endsWith(".json"));
let emails = 0;
let tels = 0;
for (const f of rest) {
  const c = findContacts(fs.readFileSync(`data/details/${f}`, "utf8"));
  emails += c.emails.length;
  tels += c.tels.length;
}
console.log(`除去後: ${rest.length} 件 / 残存メール ${emails} 件 / 残存電話 ${tels} 件`);
