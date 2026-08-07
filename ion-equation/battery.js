"use strict";
/* battery.js — 電池モード（DESIGN_battery_electrolysis.md）。

   操作の核は「どちらの板が溶けるかの予想」と「倍率合わせ」。
   判定は個数だけ（model.js の negativeOf / halvesForPair / checkRedoxMultipliers）で行い、
   座標は見た目専用。化学の判断はこのファイルに一切置かない（§0）。

   守っている決定:
     ・**電位・起電力の数値を出さない**（§6）。画面に出るのは序列の「差」まで
     ・過電圧・分極・局部電池・ボルタ電池を扱わない（§6）
     ・塩橋・素焼き板は**描くが操作にしない**（§2）
     ・ヘッダーを太らせない。新しい UI は必ず <main> の中
     ・320px で成立させる（縦積み）
     ・**半反応式を予想より先に出さない**。式が答えそのものなので、
       予想を宣言するまで段2は現れない */
(() => {

const SVG_NS = "http://www.w3.org/2000/svg";

const cellSvg      = document.getElementById("cell");
const predictMsgEl = document.getElementById("predictMsg");
const toolbarEl    = document.getElementById("toolbar");
const ionCountsEl  = document.getElementById("ionCounts");
const msgEl        = document.getElementById("msg");
const stepHalvesEl = document.getElementById("stepHalves");
const halfSheetEl  = document.getElementById("halfSheet");
const eTallyEl     = document.getElementById("eTally");
const stepSumEl    = document.getElementById("stepSum");
const calcSheetEl  = document.getElementById("calcSheet");
const clearEl      = document.getElementById("clearBanner");
const stageNavEl   = document.getElementById("stageNav");
const stageTitleEl = document.getElementById("stageTitle");

/* ---- 図の寸法（見た目専用。判定には一切使わない）----
   1つの容器を素焼き板で左右に仕切る、教科書のダニエル電池の絵。
   viewBox は 480×340。320px 幅の端末では 0.667 倍に縮む。 */
const CELL = {
  wireY: 46,                       // 導線の高さ
  lamp: { x: 240, y: 46, r: 17 },  // 豆電球（回路がつながっていることの目印）
  glass: { x: 56, y: 120, w: 368, h: 180 },
  liquid: { y: 138, h: 158 },
  divider: { x: 236, w: 8 },       // 素焼き板（仕切り）
  plate: { y: 64, h: 200, w: 26 },
  plateX: [126, 328],              // 左の板・右の板（中心は +13）
};
const plateCX = (i) => CELL.plateX[i] + CELL.plate.w / 2;

/* 金属の見た目（redox.js の RSTYLE と同じ色づかいでそろえる） */
const METAL_STYLE = {
  "Mg": { plate: "#9bb08f", ion: "#7d947f" },
  "Zn": { plate: "#7d8ea0", ion: "#5d7d9d" },
  "Fe": { plate: "#8a6d5a", ion: "#a98467" },
  "Cu": { plate: "#c47a3c", ion: "#4a90d9" },
  "Ag": { plate: "#c9ced6", ion: "#8f9aa8", darkText: true },
};
/* 電解液の色（見た目専用）。硫酸銅(Ⅱ)水溶液の青だけは、見どころなので出す */
const SOLUTION_TINT = { "CuSO4": "#cfe4f5", "ZnSO4": "#eef2f6", "AgNO3": "#eef2f6" };

let stageIdx = 0;
let guess = null;          // 予想（溶けると宣言した金属）。null なら未宣言
let guessTries = 0;        // 予想した回数（クリア条件は「的中、または2回目で修正」）
let guessOk = false;       // 予想が当たっているか
let mult = [1, 1];         // [負極の酸化 ×a, 正極の還元 ×b]

function stage() { return BATTERY_STAGES[stageIdx]; }
function pair()  { return halvesForPair(stage().metals[0], stage().metals[1]); }
/* REDOX_STAGES と同じ形。checkRedoxMultipliers / combineHalves にそのまま渡せる */
function rstage() { return batteryStageOf(stage()); }
function negHR() { return HALF_REACTIONS[pair().ox]; }
function posHR() { return HALF_REACTIONS[pair().red]; }

function setMsg(t, kind) { setStatusMsg(msgEl, t, kind); }
function setPredictMsg(t, kind) { setStatusMsg(predictMsgEl, t, kind); }

function mk(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
  (parent || cellSvg).appendChild(el);
  return el;
}
function txt(s, attrs, parent) {
  const t = mk("text", attrs, parent);
  t.textContent = s;
  return t;
}

/* ---- 電池の図 ----
   予想を宣言するまでは、**どちらが負極かを示すものを一切描かない**
   （役の札・e⁻ の矢印・電流の矢印・イオンの動き）。全部そろって答えなので。 */

let particleLayer = null;   // 粒（e⁻・イオン）を載せる層。第3歩のアニメで使う

function drawCell() {
  cellSvg.innerHTML = "";
  const st = stage();
  const revealed = guess !== null;
  const p = pair();

  // 導線（板の頭から上へ → 横 → もう片方の板の頭へ）
  const wire = `M ${plateCX(0)} ${CELL.plate.y} V ${CELL.wireY} H ${plateCX(1)} V ${CELL.plate.y}`;
  mk("path", { d: wire, fill: "none", stroke: "#5a6570", "stroke-width": 4, "stroke-linecap": "round" });
  // 豆電球。回路がつながっていること自体の目印（明るさは描かない＝起電力を出さない。§6）
  mk("circle", { cx: CELL.lamp.x, cy: CELL.lamp.y, r: CELL.lamp.r, fill: "#fdf6e0", stroke: "#5a6570", "stroke-width": 3, id: "lamp" });
  mk("path", { d: `M ${CELL.lamp.x - 8} ${CELL.lamp.y + 6} L ${CELL.lamp.x} ${CELL.lamp.y - 7} L ${CELL.lamp.x + 8} ${CELL.lamp.y + 6}`,
    fill: "none", stroke: "#c9a227", "stroke-width": 2.5, id: "lampFil" });

  // 容器（ガラス）と、左右の電解液
  mk("rect", { x: CELL.glass.x, y: CELL.glass.y, width: CELL.glass.w, height: CELL.glass.h,
    rx: 6, fill: "#fff", stroke: "#9fb0be", "stroke-width": 3 });
  const halfW = (CELL.divider.x - CELL.glass.x) - 2;
  [0, 1].forEach((i) => {
    const m = st.metals[i];
    const salt = st.electrolyte[m];
    const x = i === 0 ? CELL.glass.x + 2 : CELL.divider.x + CELL.divider.w;
    const w = i === 0 ? halfW : CELL.glass.x + CELL.glass.w - 2 - (CELL.divider.x + CELL.divider.w);
    mk("rect", { x, y: CELL.liquid.y, width: w, height: CELL.liquid.h,
      fill: SOLUTION_TINT[salt] || "#eef2f6" });
    txt(SPECIES[salt].disp + " aq", { x: x + w / 2, y: CELL.liquid.y + CELL.liquid.h - 8,
      "text-anchor": "middle", "font-size": 15, fill: "#46525e" });
  });

  /* 素焼き板（仕切り）。**操作にはしない**（§2）。
     イオンが行き来できることだけを、静かな矢印1本で添える */
  mk("rect", { x: CELL.divider.x, y: CELL.liquid.y - 14, width: CELL.divider.w, height: CELL.liquid.h + 14,
    fill: "#e6e0d4", stroke: "#b9ae99", "stroke-width": 1.5 });
  txt("素焼き板", { x: CELL.divider.x + CELL.divider.w / 2, y: CELL.liquid.y - 20,
    "text-anchor": "middle", "font-size": 13, fill: "#8a7f6a" });

  // 板2枚（タップして予想する標的）
  [0, 1].forEach((i) => {
    const m = st.metals[i];
    const sty = METAL_STYLE[m] || { plate: "#9aa4ae" };
    const g = mk("g", { class: "plateGroup", "data-metal": m, role: "button", tabindex: "0",
      "aria-label": m + " の板。この板が溶けると予想する" });
    // タップ標的を板より広く取る（板そのものは 26 単位＝320px 端末で 17px しかない）
    mk("rect", { x: plateCX(i) - 58, y: CELL.plate.y - 14, width: 116, height: CELL.plate.h + 30,
      fill: "transparent", class: "plateHit" }, g);
    mk("rect", { x: CELL.plateX[i], y: CELL.plate.y, width: CELL.plate.w, height: CELL.plate.h,
      rx: 3, fill: sty.plate, stroke: "#46525e", "stroke-width": 2, class: "plateBody" }, g);
    txt(SPECIES[m].disp, { x: plateCX(i), y: CELL.plate.y + 30, "text-anchor": "middle",
      "font-size": 19, "font-weight": "bold", fill: sty.darkText ? "#33404c" : "#fff" }, g);
    if (guess === m) g.classList.add("chosen");
    g.addEventListener("click", () => predict(m));
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); predict(m); }
    });
  });

  // 役の札。**予想するまで出さない**（これが答え）
  [0, 1].forEach((i) => {
    const m = st.metals[i];
    const y = CELL.glass.y + CELL.glass.h + 22;
    if (!revealed || !p.neg) {
      txt("？", { x: plateCX(i), y, "text-anchor": "middle", "font-size": 18, fill: "#9aa4ae" });
      return;
    }
    const isNeg = m === p.neg;
    txt(isNeg ? "(−) 負極" : "(+) 正極", { x: plateCX(i), y, "text-anchor": "middle",
      "font-size": 16, "font-weight": "bold", fill: isNeg ? "#3c7ac0" : "#c0603c" });
  });

  /* 導線の上の矢印。**e⁻ の向きと電流の向きは逆**で、ここが電池でいちばん誤解されるので
     2本とも常設する（§4）。ただし予想を宣言するまでは答えなので出さない。 */
  if (revealed && p.neg) {
    const negIdx = st.metals.indexOf(p.neg);
    const dir = negIdx === 0 ? 1 : -1;    // e⁻ は負極から正極へ導線を流れる
    arrowOnWire(CELL.wireY - 16, dir, "e⁻", "#c9a227");
    arrowOnWire(CELL.wireY - 38, -dir, "電流", "#a33a2c");
    // 素焼き板を SO₄²⁻ が負極側へ動くこと（描くだけ・操作にしない）
    const sx = CELL.divider.x + CELL.divider.w / 2;
    const sy = CELL.liquid.y + 26;
    mk("path", { d: `M ${sx + 30 * dir} ${sy} H ${sx - 30 * dir}`, stroke: "#7d8b97",
      "stroke-width": 2, fill: "none", "marker-end": "url(#bArrow)" });
    txt("SO₄²⁻", { x: sx, y: sy - 8, "text-anchor": "middle", "font-size": 13, fill: "#7d8b97" });
  }

  // 矢じり（defs）
  const defs = mk("defs", {});
  const mk2 = (id, color) => {
    const m2 = mk("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    mk("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }, m2);
  };
  mk2("bArrow", "#7d8b97");
  mk2("bArrowE", "#c9a227");
  mk2("bArrowI", "#a33a2c");

  particleLayer = mk("g", { id: "particleLayer" });
}

/* 導線に沿った矢印1本（dir: +1 で右向き、−1 で左向き） */
function arrowOnWire(y, dir, label, color) {
  const x0 = plateCX(0) + 26, x1 = plateCX(1) - 26;
  const from = dir > 0 ? x0 : x1, to = dir > 0 ? x1 : x0;
  mk("path", { d: `M ${from} ${y} H ${to}`, stroke: color, "stroke-width": 2.5, fill: "none",
    "marker-end": "url(#" + (label === "e⁻" ? "bArrowE" : "bArrowI") + ")", opacity: .85 });
  txt(label, { x: (x0 + x1) / 2, y: y - 5, "text-anchor": "middle", "font-size": 13,
    fill: color, "font-weight": "bold" });
}

/* ---- 予想 ----
   判定は model.js の negativeOf に委ねる（画面側でイオン化傾向を書き写さない）。
   外れても「間違い」で終わらせず、**なぜそちらが溶けるのか**を1行で言う（§2-3）。 */
function predict(metal) {
  const p = pair();
  guess = metal;
  guessTries++;
  guessOk = p.neg === metal;

  if (!p.neg) {
    // 同じ金属2枚・順位を持たない金属。b1 では起きないが、b2 で通る道（第4歩）
    setPredictMsg("この2枚では、どちらが溶けるかを決められない。イオン化傾向に差がないと e⁻ は動かない。", "info");
  } else if (guessOk) {
    setPredictMsg(`当たり。イオン化傾向は ${SPECIES[p.neg].disp} ＞ ${SPECIES[p.pos].disp} で、` +
      `イオン化傾向の大きいほうが e⁻ を出して溶ける。${SPECIES[p.neg].disp} が負極(−)。`, "ok");
  } else {
    setPredictMsg(`溶けるのは ${SPECIES[p.neg].disp} のほう。イオン化傾向は ` +
      `${SPECIES[p.neg].disp} ＞ ${SPECIES[p.pos].disp} で、イオン化傾向の大きいほうが e⁻ を出す。` +
      `${SPECIES[p.pos].disp} は e⁻ を受け取る側（正極(+)）にまわる。`, "ng");
  }
  drawCell();
  refreshSteps();
  updateToolbar();   // 宣言したので「▶ つないでみる」が押せるようになる
}

/* ---- 段2: 両極の半反応式と倍率 ---- */

/* 項の一覧を文字列にする（"Zn²⁺ ＋ 2e⁻"）。
   酸化数つきの作図は redox.js の担当なので、ここは式の姿だけを出す。 */
function termsText(terms) {
  return terms.map((t) => (t.n > 1 ? t.n : "") + SPECIES[t.sp].disp).join(" ＋ ");
}

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

function buildHalfRow(o, hr, idx, tag, cls) {
  o.mark.innerHTML = "";
  const times = document.createElement("span");
  times.textContent = "×";
  const down = document.createElement("button");
  down.textContent = "−";
  down.setAttribute("aria-label", tag + "の倍率を減らす");
  const num = document.createElement("span");
  num.className = "coeff";
  num.textContent = String(mult[idx]);
  const up = document.createElement("button");
  up.textContent = "＋";
  up.setAttribute("aria-label", tag + "の倍率を増やす");
  down.onclick = () => { if (mult[idx] > 1) { mult[idx]--; onMultChange(); } };
  up.onclick = () => { if (mult[idx] < 9) { mult[idx]++; onMultChange(); } };
  const stepper = document.createElement("span");
  stepper.className = "stepper";
  stepper.append(down, num, up);
  const paren = document.createElement("span");
  paren.className = "paren";
  paren.textContent = ")";
  o.mark.append(times, stepper, paren);
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  o.left.textContent = termsText(hr.left);
  o.right.textContent = termsText(hr.right);
  o.arrow.textContent = "→";
  o.note.innerHTML = "";
  const kind = document.createElement("span");
  kind.className = "kindTag " + cls;
  kind.textContent = tag;
  o.note.append(kind);
}

const SHEET = {};
function buildHalfSheet() {
  halfSheetEl.innerHTML = "";
  SHEET.neg = sheetRow(halfSheetEl, "halfNeg", "halfRow");
  SHEET.pos = sheetRow(halfSheetEl, "halfPos", "halfRow");
  const p = pair();
  if (!p.ox || !p.red) return;
  // 負極＝酸化（e⁻ を出す）／正極＝還元（e⁻ を受け取る）。用語は教科書表記
  buildHalfRow(SHEET.neg, negHR(), 0, "負極(−)・酸化", "ox");
  buildHalfRow(SHEET.pos, posHR(), 1, "正極(+)・還元", "red");
}

function updateETally() {
  const p = pair();
  if (!p.ox || !p.red) { eTallyEl.textContent = ""; return; }
  const a = mult[0], b = mult[1];
  const givePer = electronsOf(negHR()), takePer = electronsOf(posHR());
  const give = givePer * a, take = takePer * b;
  const ok = give === take;
  eTallyEl.innerHTML =
    `負極が出す e⁻: ${givePer}×${a} ＝ <strong>${give}個</strong>　／　` +
    `正極が受け取る e⁻: ${takePer}×${b} ＝ <strong>${take}個</strong> ` +
    `<span class="${ok ? "okcell" : "ngcell"}">${ok ? "そろった（足せる）" : "そろっていない"}</span>`;
}

function onMultChange() {
  buildHalfSheet();
  updateETally();
  refreshSteps();
  setMsg("倍率を変えた。「▶ つないでみる」で e⁻ の数が合うか確かめよう。");
}

/* ---- 段の出し入れ ---- */
function revealStep(el, show) {
  if (!show) { el.hidden = true; el.classList.remove("appear"); return; }
  if (el.hidden) {
    el.hidden = false;
    el.classList.remove("appear");
    void el.offsetWidth;      // アニメを付け直すための強制リフロー
    el.classList.add("appear");
  }
}

function refreshSteps() {
  // 段2（半反応式）は**予想を宣言してから**。式が答えそのものなので先に出さない
  revealStep(stepHalvesEl, guess !== null && !!pair().ox);
}

/* ---- 釦 ---- */
function buildToolbar() {
  toolbarEl.innerHTML = "";
  const play = document.createElement("button");
  play.id = "playBtn";
  play.className = "react";
  play.textContent = "▶ つないでみる";
  play.onclick = () => play0();
  const reset = document.createElement("button");
  reset.className = "reset";
  reset.textContent = "↺ やり直す";
  reset.onclick = () => initStage();
  toolbarEl.append(play, reset);
  updateToolbar();
}

function updateToolbar() {
  const play = document.getElementById("playBtn");
  if (!play) return;
  // 宣言するまで再生できない（§2-2）
  play.disabled = guess === null;
  play.title = guess === null ? "先に、溶けると思う板をタップして予想しよう" : "";
}

/* 第3歩でアニメを載せる口。いまは数の照合だけを言う */
function play0() {
  if (guess === null) return;
  const st = rstage();
  if (!st) { setMsg("この組み合わせは、このアプリでは扱えない。", "info"); return; }
  const chk = checkRedoxMultipliers(st, mult[0], mult[1]);
  setMsg(chk.ok
    ? "e⁻ の数がそろっている。（導線を流れるアニメは次の版で入る）"
    : chk.reason, chk.ok ? "ok" : "ng");
}

/* ---- ステージ ---- */
function stageLabel(i) { return `ステージ${i + 1}：${BATTERY_STAGES[i].title}`; }

function buildStageNav() {
  stageNavEl.innerHTML = "";
  BATTERY_STAGES.forEach((st, i) => {
    const b = document.createElement("button");
    b.textContent = String(i + 1);
    b.className = i === stageIdx ? "active" : "";
    b.title = stageLabel(i);
    b.dataset.label = st.title;
    b.onclick = () => { stageIdx = i; initStage(); };
    stageNavEl.appendChild(b);
  });
}

function initStage() {
  guess = null;
  guessTries = 0;
  guessOk = false;
  mult = [1, 1];
  buildStageNav();
  buildToolbar();
  stageTitleEl.innerHTML = `<strong>${stageLabel(stageIdx)}</strong>`;
  drawCell();
  buildHalfSheet();
  updateETally();
  ionCountsEl.innerHTML = "";
  clearEl.hidden = true;
  calcSheetEl.innerHTML = "";
  revealStep(stepSumEl, false);
  refreshSteps();
  setPredictMsg(stage().intro, "info");
  // まだ何も起きていないので、応答の枠ごと空にする（空の枠に 💡 だけが出るのを避ける）
  msgEl.className = "";
  msgEl.textContent = "";
  updateToolbar();
}

/* テスト・監査用フック（redox / condition と同じ流儀） */
window.BatteryEq = {
  predict(metal) { predict(metal); return guessOk; },
  setMult(a, b) { mult = [a, b]; onMultChange(); },
  play() { play0(); },
  state: () => ({
    stageId: stage().id,
    metals: [...stage().metals],
    guess, guessTries, guessOk,
    neg: pair().neg, pos: pair().pos,
    halves: [pair().ox || null, pair().red || null],
    mult: [...mult],
    answer: rstage() ? [...rstage().answer] : null,
    cell: cellNotation(stage()),
    halvesShown: !stepHalvesEl.hidden,
    sumShown: !stepSumEl.hidden,
    playDisabled: !!(document.getElementById("playBtn") || {}).disabled,
    predictMsg: predictMsgEl.textContent,
    msg: msgEl.textContent,
    // 役の札は予想するまで画面に出ていないこと（答えの先出しを見張る）
    roleLabels: [...cellSvg.querySelectorAll("text")].map((t) => t.textContent)
      .filter((s) => s.includes("負極") || s.includes("正極")),
  }),
};

initStage();

})();
