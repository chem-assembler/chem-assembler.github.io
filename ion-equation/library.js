"use strict";
/* library.js — 反応ライブラリ（reactions.json）のローダと逆引きインデックス。
   DOM 非依存の純ロジック（buildReactionIndex）＋ fetch ローダ（loadReactionLibrary）。
   ゲームプレイ（app.js の STAGES）とは独立。インデックス/検索UI（Phase 2）の土台。 */

/* パース済み reactions.json → 検索用インデックス一式を構築する（純関数）。
   - byId:      id → 反応
   - bySpecies: 物質/イオン → [id]（登場物質からの逆引き検索）
   - byType:    分類（反応の型）→ [id]
   - bySalt:    塩の分類 → [id]
   - byUnit:    単元タグ → [id]
   - allSpecies: 登場する全物質（ソート済み。検索候補用） */
function buildReactionIndex(data) {
  const reactions = (data && data.reactions) || [];
  const byId = {};
  const bySpecies = {};
  const byType = {};
  const bySalt = {};
  const byUnit = {};
  const push = (map, key, id) => {
    if (key === null || key === undefined) return;
    (map[key] || (map[key] = [])).push(id);
  };
  for (const rx of reactions) {
    byId[rx.id] = rx;
    (rx.species || []).forEach((sp) => push(bySpecies, sp, rx.id));
    push(byType, rx.classes && rx.classes.type, rx.id);
    push(bySalt, rx.classes && rx.classes.saltType, rx.id);
    (rx.units || []).forEach((u) => push(byUnit, u, rx.id));
  }
  const allSpecies = Object.keys(bySpecies).sort();
  return { reactions, byId, bySpecies, byType, bySalt, byUnit, allSpecies };
}

/* reactions.json を取得してインデックスを構築する。成功時 window.IonLib に載せる。
   fetch を使うため file:// 直開きでは失敗する（＝サーバー必須。呼び出し側で握りつぶせば
   ゲームプレイは STAGES で継続＝両立）。 */
async function loadReactionLibrary(url) {
  const res = await fetch(url || "reactions.json", { cache: "no-store" });
  if (!res.ok) throw new Error("reactions.json の取得に失敗: " + res.status);
  const data = await res.json();
  const lib = buildReactionIndex(data);
  if (typeof window !== "undefined") window.IonLib = lib;
  return lib;
}

/* 検索用に物質記号を正規化（^ と空白を除き小文字化）。"Fe^2+"→"fe2+"、"H2SO4"→"h2so4" */
function normSpecies(s) {
  return String(s).replace(/[\^\s]/g, "").toLowerCase();
}

/* 反応が検索語にマッチするか。登場物質（species：分子＋イオン）の正規化キーに部分一致 */
function matchesQuery(rx, q) {
  if (!q) return true;
  const nq = normSpecies(q);
  return (rx.species || []).some((sp) => normSpecies(sp).includes(nq));
}

/* ---- アプリをまたぐ辞書引き（項目31）----
   反応インデックスを ion-equation の中だけの索引で終わらせず、
   「この式で量的計算もできる」と隣のアプリ（比例式でみる化学計算）へつなぐ。
   突き合わせは物質名の一覧ではなく**反応式そのもの**で行う。 */

/* 反応式を「係数を最簡整数比にそろえた正準文字列」にする（並び順に依存しない） */
function canonicalEquation(reactants, products, coeffs) {
  const gcd2 = (a, b) => { while (b) { const t = b; b = a % b; a = t; } return a; };
  const g = coeffs.reduce((a, b) => gcd2(a, b), 0) || 1;
  const side = (list, off) => list.map((sp, i) => sp + ":" + coeffs[off + i] / g).sort().join(",");
  return side(reactants, 0) + "|" + side(products, reactants.length);
}

/* ion-equation の反応 → ratio（比例式でみる化学計算）の問題ID の対応表を作る。
   ratioReactions は ChemRatio.REACTIONS（[{ id, eq: [{ sub, coef, product }] }]）。
   同じ式の問題が複数あるときは最初のもの（いちばん導入向き）を採る。
   ratio が読めない環境（単体で開いたときなど）では空の表を返して黙って無効になる。

   ratioSubstances に ChemRatio.SUBSTANCES を渡すと、物質を**キーではなく組成式**で
   照合する。ratio のキーは識別子なので括弧を落とすことがあり（Al2SO43）、
   そのままでは ion-equation の Al2(SO4)3 と別物になって静かに対応が切れる。
   化学として同じものかを見たいのだから、キーではなく formula を正とする。 */
function buildCrossAppIndex(ionReactions, ratioReactions, ratioSubstances) {
  // formula は表示用に <sub> を含むので落とす（Al<sub>2</sub>(SO<sub>4</sub>)<sub>3</sub> → Al2(SO4)3）
  const formulaOf = (key) => {
    const s = ratioSubstances && ratioSubstances[key];
    return (s && s.formula) ? s.formula.replace(/<\/?sub>/g, "") : key;
  };
  const byEq = {};
  for (const p of ratioReactions || []) {
    const L = p.eq.filter((t) => !t.product), R = p.eq.filter((t) => t.product);
    const key = canonicalEquation(
      L.map((t) => formulaOf(t.sub)), R.map((t) => formulaOf(t.sub)),
      L.map((t) => t.coef).concat(R.map((t) => t.coef)));
    if (!byEq[key]) byEq[key] = p.id;
  }
  const out = {};
  for (const rx of ionReactions || []) {
    const key = canonicalEquation(rx.reactants, rx.products, rx.coeffs);
    if (byEq[key]) out[rx.id] = byEq[key];
  }
  return out;
}

/* 反応式を文字列に整形。disp(sp)=表示名を返す関数（SPECIES[sp].disp 等）。係数1は省略 */
function formatEquation(rx, disp) {
  const nL = rx.reactants.length;
  const side = (species, offset) => species
    .map((sp, i) => { const c = rx.coeffs[offset + i]; return (c > 1 ? c + " " : "") + disp(sp); })
    .join(" ＋ ");
  return side(rx.reactants, 0) + " → " + side(rx.products, nL);
}

if (typeof window !== "undefined") {
  window.buildReactionIndex = buildReactionIndex;
  window.loadReactionLibrary = loadReactionLibrary;
  window.normSpecies = normSpecies;
  window.matchesQuery = matchesQuery;
  window.formatEquation = formatEquation;
  window.canonicalEquation = canonicalEquation;
  window.buildCrossAppIndex = buildCrossAppIndex;
}
