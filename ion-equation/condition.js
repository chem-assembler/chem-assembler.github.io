"use strict";
/* condition.js — 液性で書き換えるモード（酸性条件 ⇄ 塩基性条件）。

   同じ酸化還元でも、液性によって半反応式の書き方が変わる。別々に暗記するのではなく、
   **酸性の式の両辺に OH⁻ を同数足す → H⁺ と OH⁻ が結びついて H₂O になる →
   両辺に共通する H₂O を相殺する** という操作で導けることを、筆算のかたちで見せる。

   判定はすべて model.js の toBasicHalf()（個数だけ）。ここは描画と入力だけを持つ。 */
(() => {

const SVG_NS = "http://www.w3.org/2000/svg";

const stageNavEl   = document.getElementById("stageNav");
const stageTitleEl = document.getElementById("stageTitle");
const msgEl        = document.getElementById("msg");
const acidSheetEl  = document.getElementById("acidSheet");
const calcSheetEl  = document.getElementById("calcSheet");
const neutralSvg   = document.getElementById("neutralFig");
const clearEl      = document.getElementById("clearBanner");

let stageIdx = 0;
let addedOH = 0;

function stage() { return CONDITION_STAGES[stageIdx]; }
function half() { return HALF_REACTIONS[stage().half]; }
function step() { return toBasicHalf(half(), addedOH); }

function mk(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

/* ---- 式の描画（酸化還元モードと同じ流儀。→ の位置がそろう5列グリッド） ---- */

function fmtOx(v) { return v > 0 ? "+" + v : String(v); }

function oxChanges() { return oxChangeOfHalf(half()); }

/* 項1つ。酸化数は**ステップ1の酸性条件の式にだけ**付ける（withOx）。
   ここでの書き換えは数の操作であって酸化数は動かないので、途中の行に出すとかえって邪魔になる
   （H⁺→H₂ の反応では、あとから足す H₂O や OH⁻ の H も +1 で、変化したように見えてしまう）。
   酸化数は変化する元素の真下に置き、その元素に下線を引く。 */
function termSpan(term, cancel, withOx) {
  const wrap = document.createElement("span");
  wrap.className = "fterm";
  const main = document.createElement("span");
  if (cancel) main.className = "cancel";
  const disp = SPECIES[term.sp].disp;
  const pre = term.n > 1 ? term.n + " " : "";
  const ox = (withOx && term.sp !== "e-") ? OXIDATION[term.sp] : null;
  const ch = ox && oxChanges().find((c) => ox[c.el] !== undefined && SPECIES[term.sp].atoms[c.el]);
  const at = ch ? disp.indexOf(ch.el) : -1;
  if (!ch || at < 0) {
    main.textContent = pre + disp;
    wrap.appendChild(main);
    return wrap;
  }
  const v = ox[ch.el];
  const head = document.createElement("span");
  head.textContent = pre + disp.slice(0, at);
  const anchor = document.createElement("span");
  anchor.className = "oxAnchor " + (v > 0 ? "oxpos" : v < 0 ? "oxneg" : "oxzero");
  anchor.textContent = ch.el;
  const tail = document.createElement("span");
  tail.textContent = disp.slice(at + ch.el.length);
  main.append(head, anchor, tail);
  wrap.appendChild(main);
  const sub = document.createElement("span");
  sub.className = "oxtag " + (v > 0 ? "oxpos" : v < 0 ? "oxneg" : "oxzero");
  sub.textContent = fmtOx(v);
  anchor.appendChild(sub);
  return wrap;
}

function sepEl(t) {
  const s = document.createElement("span");
  s.className = "fsep";
  s.textContent = t;
  return s;
}

/* terms を並べる。cancelSp/cancelN を渡すと、その種のうち cancelN 個ぶんに斜線を引き、
   残りを別の項として続けて描く（「4H₂O のうち2個が消えて 2H₂O になる」を式の形で見せる） */
function renderTerms(container, terms, cancelSp, cancelN, withOx) {
  container.innerHTML = "";
  let first = true;
  const put = (node) => {
    if (!first) container.appendChild(sepEl("＋"));
    container.appendChild(node);
    first = false;
  };
  for (const t of terms) {
    if (cancelSp && t.sp === cancelSp && cancelN > 0) {
      put(termSpan({ sp: t.sp, n: Math.min(cancelN, t.n) }, true, withOx));
      if (t.n > cancelN) put(termSpan({ sp: t.sp, n: t.n - cancelN }, false, withOx));
      continue;
    }
    put(termSpan(t, false, withOx));
  }
  if (first) {
    const none = document.createElement("span");
    none.className = "muted";
    none.textContent = "（なし）";
    container.appendChild(none);
  }
}

/* ---- 筆算シート ---- */

const SHEET = {};

function sheetRow(parent, id, cls) {
  const row = document.createElement("div");
  row.className = "calcRow" + (cls ? " " + cls : "");
  if (id) row.id = id;
  const cell = (c) => {
    const s = document.createElement("span");
    s.className = c;
    row.appendChild(s);
    return s;
  };
  parent.appendChild(row);
  return { row, mark: cell("cMark"), left: cell("cLeft"), arrow: cell("cArrow"), right: cell("cRight"), note: cell("cNote") };
}

function sheetSpan(parent, id, cls) {
  const d = document.createElement("div");
  d.className = "cSpan" + (cls ? " " + cls : "");
  if (id) d.id = id;
  parent.appendChild(d);
  return d;
}

function sheetRule(parent, id) {
  const d = document.createElement("div");
  d.className = "cRule";
  if (id) d.id = id;
  parent.appendChild(d);
  return d;
}

function buildSkeleton() {
  acidSheetEl.innerHTML = "";
  SHEET.acid = sheetRow(acidSheetEl, "rowAcid");
  calcSheetEl.innerHTML = "";
  calcSheetEl.style.gridTemplateColumns = "";
  SHEET.base = sheetRow(calcSheetEl, "rowAcid2");
  SHEET.add  = sheetRow(calcSheetEl, "rowAddOH");
  SHEET.addMsg = sheetSpan(calcSheetEl, "addMsg", "footNote");
  SHEET.rule1 = sheetRule(calcSheetEl, "rule1");
  SHEET.join  = sheetRow(calcSheetEl, "rowJoin");
  SHEET.rule2 = sheetRule(calcSheetEl, "rule2");
  SHEET.done  = sheetRow(calcSheetEl, "rowBasic");
}

function fillRow(o, left, right, tag, opts) {
  const t = opts || {};
  o.mark.textContent = t.mark || "";
  o.arrow.textContent = "→";
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  renderTerms(o.left, left, t.cancelSp, t.cancelLeft || 0, t.withOx);
  renderTerms(o.right, right, t.cancelSp, t.cancelRight || 0, t.withOx);
  o.note.innerHTML = "";
  if (tag) {
    const s = document.createElement("span");
    s.className = "rowTag" + (t.strong ? " strong" : "");
    s.textContent = tag;
    o.note.appendChild(s);
  }
}

function update() {
  const hr = half(), r = step();
  fillRow(SHEET.acid, hr.left, hr.right, "酸性条件", { strong: true, withOx: true });
  fillRow(SHEET.base, hr.left, hr.right, "酸性条件の式");
  // ＋) の行: 両辺に OH⁻ を addedOH 個
  const o = SHEET.add;
  o.mark.textContent = "＋)";
  o.arrow.textContent = "";
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  o.left.innerHTML = "";
  const down = document.createElement("button");
  down.textContent = "−";
  const num = document.createElement("span");
  num.className = "coeff";
  num.textContent = String(addedOH);
  const up = document.createElement("button");
  up.textContent = "＋";
  down.onclick = () => { if (addedOH > 0) { addedOH--; update(); } };
  up.onclick = () => { if (addedOH < 12) { addedOH++; update(); } };
  const stepper = document.createElement("span");
  stepper.className = "stepper";
  stepper.append(down, num, up);
  const f = document.createElement("span");
  f.className = "formula";
  f.textContent = SPECIES["OH-"].disp;
  o.left.append(stepper, f);
  o.right.textContent = addedOH > 0 ? `${addedOH} ${SPECIES["OH-"].disp}` : "（同じだけ）";
  o.right.classList.toggle("muted", addedOH === 0);
  o.note.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = "rowTag";
  tag.textContent = "両辺に OH⁻ を足す";
  o.note.appendChild(tag);
  SHEET.addMsg.textContent = r.reason;
  SHEET.addMsg.className = "cSpan footNote " + (r.ok ? "okcell" : "ngcell");

  // 中和した式（H⁺＋OH⁻ → H₂O）。相殺されるぶんの H₂O には斜線を引く
  const showJoin = addedOH > 0;
  SHEET.join.row.hidden = !showJoin;
  SHEET.rule1.hidden = !showJoin;
  if (showJoin) {
    const nL = (r.joined.left.find((t) => t.sp === "H2O") || { n: 0 }).n;
    const nR = (r.joined.right.find((t) => t.sp === "H2O") || { n: 0 }).n;
    fillRow(SHEET.join, r.joined.left, r.joined.right,
      r.cancelled > 0 ? `両辺の H₂O を ${r.cancelled}個 消す` : "H⁺ と OH⁻ が H₂O に", {
        cancelSp: "H2O", cancelLeft: Math.min(r.cancelled, nL), cancelRight: Math.min(r.cancelled, nR),
      });
  }
  // 完成した塩基性条件の式
  SHEET.rule2.hidden = !r.ok;
  SHEET.done.row.hidden = !r.ok;
  if (r.ok) fillRow(SHEET.done, r.left, r.right, "塩基性条件", { strong: true });
  SHEET.done.row.classList.toggle("doneRow", r.ok);

  drawNeutral(r);
  clearEl.hidden = !r.ok;
  if (r.ok) showClear();
}

/* H⁺ と OH⁻ が結びついて H₂O になる図。足した OH⁻ が余っていれば印をつける */
function drawNeutral(r) {
  neutralSvg.innerHTML = "";
  const W = 460, R = 13, STEP = 30;
  const pairs = r.neutralized.left + r.neutralized.right;
  const spare = Math.max(0, r.k - r.need);
  const shortH = Math.max(0, r.need - r.k);
  const dot = (cx, cy, sp, state) => {
    const c = SPECIES_COLOR[sp] || (sp === "H+" ? "#d95757" : sp === "OH-" ? "#4f9fae" : "#c2e2f4");
    mk("circle", {
      cx, cy, r: R, fill: state === "empty" ? "none" : c,
      stroke: state === "ok" ? "rgba(0,0,0,.3)" : "#c0392b",
      "stroke-width": state === "ok" ? 1 : 2.5,
      "stroke-dasharray": state === "empty" ? "4 3" : "none",
    }, neutralSvg);
    const t = mk("text", {
      x: cx, y: cy + 4, "text-anchor": "middle", "font-size": 10, "font-weight": "bold",
      fill: state === "empty" ? "#9aa4ae" : (sp === "H2O" ? "#2a3540" : "#fff"),
    }, neutralSvg);
    t.textContent = SPECIES[sp].disp;
  };
  const txt = (x, y, s, size, fill) => {
    const e = mk("text", { x, y, "font-size": size, fill }, neutralSvg);
    e.textContent = s;
    return e;
  };
  const yTop = 34, yBot = 34 + STEP + 4;
  txt(6, 16, `酸性条件の式にある H⁺ は ${r.need}個。同じ数の OH⁻ を足すと、ぜんぶ H₂O になる`, 11, "#5a6570")
    .setAttribute("font-weight", "bold");
  const n = Math.min(r.need, 10);
  for (let i = 0; i < n; i++) {
    const cx = 18 + i * STEP;
    dot(cx, yTop, "H+", "ok");
    dot(cx, yBot, "OH-", i < r.k ? "ok" : "empty");
    if (i < r.k) {
      mk("line", { x1: cx, y1: yTop + R, x2: cx, y2: yBot - R, stroke: "#9aa4ae", "stroke-width": 2 }, neutralSvg);
    }
  }
  const x2 = 18 + n * STEP;
  if (r.need > n) txt(x2 - 6, yBot + 4, `…他 ${r.need - n}`, 11, "#5a6570");
  if (pairs > 0) {
    schArrow(neutralSvg, x2 + 4, (yTop + yBot) / 2, x2 + 34, (yTop + yBot) / 2);
    drawSchematicProduct(neutralSvg, x2 + 74, (yTop + yBot) / 2, "H2O",
      (sp) => ({ color: "#c2e2f4", darkText: true, label: SPECIES[sp].disp }), "figProduct");
    const c = mk("text", {
      x: x2 + 74, y: yBot + 24, "text-anchor": "middle", "font-size": 12, "font-weight": "bold", fill: "#46525e",
    }, neutralSvg);
    c.textContent = `×${pairs}`;
  }
  let cap = yBot + R + 20;
  if (shortH > 0) txt(8, cap, `OH⁻ が ${shortH}個 足りない（点線は空席）。相手のいない H⁺ は塩基性では残れない`, 10.5, "#a33a2c");
  if (spare > 0) {
    for (let k = 0; k < Math.min(spare, 3); k++) dot(x2 + 24 + k * STEP, yBot + 6, "OH-", "mark");
    txt(8, cap, `足しすぎた OH⁻ が両辺に ${spare}個ずつ残っている`, 10.5, "#a33a2c");
  }
  neutralSvg.setAttribute("viewBox", `0 0 ${W} ${cap + 10}`);
}

function showClear() {
  clearEl.innerHTML = "";
  const t = document.createElement("div");
  t.textContent = "クリア！ 暗記しなくても、酸性の式から塩基性の式が導けた。";
  clearEl.appendChild(t);
  if (stageIdx < CONDITION_STAGES.length - 1) {
    const b = document.createElement("button");
    b.textContent = "次のステージへ →";
    b.onclick = () => { stageIdx++; initStage(); };
    clearEl.appendChild(b);
  } else {
    const d = document.createElement("div");
    d.textContent = "液性の書き換えを全クリア！";
    clearEl.appendChild(d);
  }
}

function stageLabel(i) {
  return `ステージ${i + 1}：${CONDITION_STAGES[i].title}`;
}

function buildStageNav() {
  stageNavEl.innerHTML = "";
  CONDITION_STAGES.forEach((st, i) => {
    const b = document.createElement("button");
    b.textContent = String(i + 1);
    b.className = i === stageIdx ? "active" : "";
    b.title = stageLabel(i);
    b.onclick = () => { stageIdx = i; initStage(); };
    stageNavEl.appendChild(b);
  });
}

function initStage() {
  addedOH = 0;
  clearEl.hidden = true;
  buildStageNav();
  buildSkeleton();
  stageTitleEl.innerHTML = `<strong>${stageLabel(stageIdx)}</strong>`;
  msgEl.textContent = stage().intro;
  update();
}

/* テスト・監査用フック */
window.ConditionEq = {
  state() {
    const r = step();
    const key = (t) => t.map((x) => x.sp + ":" + x.n).sort().join(",");
    return {
      stageIdx, addedOH, need: r.need, ok: r.ok, cancelled: r.cancelled,
      left: key(r.left), right: key(r.right),
      matchesData: key(r.left) === key(stage().basic.left) && key(r.right) === key(stage().basic.right),
    };
  },
};

const idParam = new URLSearchParams(location.search).get("s");
if (idParam) {
  const i = CONDITION_STAGES.findIndex((s) => s.id === idParam);
  if (i >= 0) stageIdx = i;
}

initStage();

})();
