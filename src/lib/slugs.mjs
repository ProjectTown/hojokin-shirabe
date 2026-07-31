/**
 * URL用スラッグの対応表。
 * astro.config.mjs（サイトマップ生成）と src 側の双方から使うため、
 * TypeScript ではなく素の ESM に置いている。
 */

/** 都道府県 → URL用スラッグ。日本語URLを避けて経路を安定させる。 */
export const PREF_SLUG = {
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
export const INDUSTRY_SLUG = {
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
