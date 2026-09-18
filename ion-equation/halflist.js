"use strict";
/* halflist.js — 半反応式の一覧（2026-09-18）。

   ユーザーの決定（2026-09-18）: 半反応式まわりを3つに分ける。
     ・**資料**（このページ）… 式を並べて見せる
     ・暗記をテストするところ … まだ無い。**ここから予告もしない**
     ・係数を決めるところ … halfreaction.html（既にある）

   ★ このページがやること
     (1) halfCatalog() の全件を、科目（化学基礎だけ／化学まで）とレベルで絞って並べる
     (2) 式・条件（液性）・役（酸化剤／還元剤／電極）を1行で読めるようにする
     (3) half-marks.js の印を 〇・×・未挑戦 の3通りで出す
     (4) 「順に」「ランダム」「×だけ」を選んで、その列のまま係数決定へ送る

   ⚠ **化学の判断はここに書かない。** 役も液性も e⁻ の数も model.js が式から導いたものを並べるだけ。
   ⚠ **出典は書かない**（どの本に載っているか・載っていないかを画面で断定しない）。 */
(() => {

const filtersEl = document.getElementById("hlFilters");
const orderEl   = document.getElementById("hlOrder");
const goEl      = document.getElementById("hlGo");
const goNoteEl  = document.getElementById("hlGoNote");
const tallyEl   = document.getElementById("hlTally");
const listEl    = document.getElementById("hlList");

const CATALOG = halfCatalog();

/* 絞り込みの状態。既定は「化学まで・発展まで」＝ 全件
   （絞るのは自分の学年に合わせたい人のためで、既定で隠すと式が消えたように見える） */
let upTo = "chem";
let maxLevel = 3;
let order = "seq";

const marks = () => (window.HalfMarks || null);
const markOf = (id) => (marks() ? marks().shown(id) : null);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function shown() { return halfCatalogFilter(CATALOG, { upTo, maxLevel }); }

/* ---- 役（画面の言葉）----
   ⚠ **札の言葉は場所で変わる。** 同じ「e⁻ を出す式」でも、
   溶液の中でなら還元剤、電気分解なら陽極、電池なら負極と呼ばれる。
   どれも kind（酸化か還元か）と section から導く ＝ データを二重に持たない。 */
function roleWord(e) {
  const gives = e.kind === "oxidation";        // e⁻ を出す側
  if (e.section === "electrolysis") return gives ? "陽極" : "陰極";
  if (e.section === "battery") return gives ? "負極" : "正極";
  return gives ? "還元剤" : "酸化剤";
}

/* ---- 条件（液性）----
   cond は「その式を使うのに要る液性」、written は「紙の上の書き方」。
   要る液性が決まっている式はそれを言い、決まっていない式は書き方だけを言う。 */
function condWord(e) {
  if (e.cond === "acid") return "酸性の溶液";
  if (e.cond === "basic") return "塩基性の溶液";
  if (e.written === "acid") return "酸性の書き方";
  return "液性を問わない";
}

/* ---- 絞り込みの札 ---- */

function chip(label, on, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "filterChip" + (on ? " on" : "");
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function buildFilters() {
  filtersEl.innerHTML = "";
  const g1 = el("div", "filterGroup");
  g1.appendChild(el("span", "filterLead", "どこまで"));
  g1.appendChild(chip("化学基礎だけ", upTo === "basic", () => { upTo = "basic"; render(); }));
  g1.appendChild(chip("化学まで", upTo === "chem", () => { upTo = "chem"; render(); }));
  filtersEl.appendChild(g1);
  const g2 = el("div", "filterGroup");
  g2.appendChild(el("span", "filterLead", "くわしさ"));
  /* ⚠ 札の言葉は HALF_LEVELS の呼び名そのままだと「まず覚えるまで」と読めてしまう。
     ここは**絞り込みの言い方**に直す（中身の段階は model.js が持つ） */
  const LEVEL_CHIPS = { 1: "まず覚えるものだけ", 2: "次のものまで", 3: "発展まで" };
  for (const lv of Object.keys(HALF_LEVELS)) {
    const n = Number(lv);
    g2.appendChild(chip(LEVEL_CHIPS[n], maxLevel === n, () => { maxLevel = n; render(); }));
  }
  filtersEl.appendChild(g2);
}

/* ---- 練習に進む口 ---- */

function buildOrder() {
  orderEl.innerHTML = "";
  orderEl.appendChild(el("span", "filterLead", "出題の順"));
  for (const [key, label] of Object.entries(HALF_ORDERS)) {
    orderEl.appendChild(chip(label, order === key, () => { order = key; render(); }));
  }
}

/* いま選んでいる順で、係数決定へ渡す列。
   ⚠ **ランダムは押した時点で決めて URL に入れる** —— 送り先で混ぜ直すと、
   「次の式へ」を押すたびに並びが変わって、どこまでやったか分からなくなる。 */
function queueIds() { return halfQueueIds(shown(), order, markOf); }

function hrefFor(ids, startId) {
  if (!ids.length) return null;
  const q = "q=" + ids.join(",");
  return "halfreaction.html?" + q + (startId ? "&half=" + encodeURIComponent(startId) : "");
}

function refreshGo() {
  const ids = queueIds();
  const href = hrefFor(ids);
  goEl.hidden = !href;
  if (href) goEl.href = href;
  goNoteEl.textContent = ids.length
    ? `${ids.length} 本の式を ${HALF_ORDERS[order]} 組む。`
    : (order === "ng" ? "× の付いた式はまだ無い。" : "係数を決められる式が、この絞り込みには無い。");
}

/* ---- 表 ---- */

function markNode(id) {
  const m = markOf(id);
  const b = el("span", "hlMark " + (m === "o" ? "hlOk" : m === "x" ? "hlNg" : "hlNone"),
    m === "o" ? "〇" : m === "x" ? "×" : "—");
  b.title = m === "o" ? "できた" : m === "x" ? "とちゅうで間違えた" : "まだやっていない";
  return b;
}

function rowNode(e, ids) {
  const row = el("div", "rxnRow hlRow");
  row.dataset.half = e.id;

  const head = el("div", "hlHead");
  head.appendChild(markNode(e.id));
  head.appendChild(el("span", "hlName", e.name));
  head.appendChild(el("span", "hlSp", SPECIES[e.sp].disp));
  row.appendChild(head);

  row.appendChild(el("div", "rxnEq hlEq", e.disp));
  /* 書き方が2通りある式（硝酸・熱濃硫酸・シュウ酸）。
     ⚠ **どちらが教科書かは言わない。** 言うのは「どちらで書いてもよい」だけ */
  if (e.forms.length > 1) {
    const alt = e.forms[1];
    const line = el("div", "hlAlt");
    line.appendChild(el("span", "hlAltLead", "こう書いてもよい"));
    line.appendChild(el("span", "hlAltEq", alt.disp));
    row.appendChild(line);
  }

  const meta = el("div", "rxnMeta");
  meta.appendChild(el("span", "rxnBadge hlRole", roleWord(e)));
  meta.appendChild(el("span", "rxnBadge" + (e.cond === "acid" ? " acid" : ""), condWord(e)));
  meta.appendChild(el("span", "rxnBadge", "e⁻ " + e.electrons + " 個"));
  row.appendChild(meta);

  if (e.build) {
    const a = document.createElement("a");
    a.className = "rxnPlay hlGoOne";
    a.href = hrefFor(ids.includes(e.id) ? ids : [e.id], e.id);
    a.textContent = "この半反応式の係数を決める →";
    row.appendChild(a);
  }
  return row;
}

function render() {
  buildFilters();
  buildOrder();
  refreshGo();
  const list = shown();
  const ids = queueIds();

  const tal = marks() ? marks().tally(list.map((e) => e.id)) : { o: 0, x: 0, none: list.length, total: list.length };
  tallyEl.textContent = `全 ${tal.total} 本 —— できた ${tal.o}・間違えた ${tal.x}・まだ ${tal.none}`;

  listEl.innerHTML = "";
  for (const [sec, secName] of Object.entries(HALF_SECTIONS)) {
    const rows = list.filter((e) => e.section === sec);
    if (!rows.length) continue;
    const box = el("section", "hlSec");
    box.id = "sec-" + sec;
    box.appendChild(el("h2", "portalHead", secName));
    for (const e of rows) box.appendChild(rowNode(e, ids));
    listEl.appendChild(box);
  }
}

/* テスト・監査用フック */
window.HalfList = {
  state: () => ({
    upTo, maxLevel, order,
    rows: [...listEl.querySelectorAll(".hlRow")].map((r) => r.dataset.half),
    sections: [...listEl.querySelectorAll(".hlSec")].map((s) => s.id.replace("sec-", "")),
    marks: [...listEl.querySelectorAll(".hlRow")].map((r) => r.querySelector(".hlMark").textContent),
    queue: queueIds(),
    go: goEl.hidden ? null : goEl.getAttribute("href"),
    goNote: goNoteEl.textContent,
    tally: tallyEl.textContent,
  }),
  setFilter(o) {
    if (o && o.upTo) upTo = o.upTo;
    if (o && Number.isInteger(o.maxLevel)) maxLevel = o.maxLevel;
    render();
  },
  setOrder(o) { if (HALF_ORDERS[o]) { order = o; render(); } return order; },
  hrefOf(id) {
    const row = listEl.querySelector('.hlRow[data-half="' + id + '"]');
    const a = row && row.querySelector(".hlGoOne");
    return a ? a.getAttribute("href") : null;
  },
  render,
};

render();

})();
