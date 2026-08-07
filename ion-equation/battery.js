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
const paletteEl    = document.getElementById("palette");
const discoveryEl  = document.getElementById("discovery");
const predictHeadEl= document.getElementById("predictHead");
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
const SOLUTION_TINT = { "CuSO4": "#cfe4f5", "ZnSO4": "#eef2f6", "AgNO3": "#eef2f6",
  "CuCl2": "#cfe4f5", "H2SO4": "#eef2f6" };
/* 不活性電極の見た目（電気分解）。どちらも反応に参加しないので、金属の板とは色を分ける */
const INERT_LOOK = {
  "C":  { plate: "#4a4f55", label: "炭素棒", darkText: false },
  "Pt": { plate: "#c9ced6", label: "白金板", darkText: true },
};

let stageIdx = 0;
let guess = null;          // 予想（溶けると宣言した金属）。null なら未宣言
let guessTries = 0;        // 予想した回数（クリア条件は「的中、または2回目で修正」）
let guessOk = false;       // 予想が当たっているか
let mult = [1, 1];         // [負極の酸化 ×a, 正極の還元 ×b]
let picked = [null, null]; // b2（電極を選ぶ課題）で選んだ2枚。b1 では使わない
/* 「どの金属が、誰と組んだときにどちらの役をやったか」の記録（b2 の当たり）。
   ここから「同じ Cu でも相手で役が変わる」が**遊んだ結果として**出てくる。
   ステージをまたいでも消さない（b1 で見た Cu の正極ぶんも記録に入る）。 */
let roleLog = {};

/* いま遊んでいるステージ。b2（choose）は板が固定でないので、
   選んだ2枚を metals として差し込んだ形にして model.js に渡す
   （model 側は「metals を持つステージ」しか知らなくてよい）。 */
function rawStage() { return CELL_STAGES[stageIdx]; }
function stage() {
  const st = rawStage();
  return st.choose ? Object.assign({}, st, { metals: [picked[0], picked[1]] }) : st;
}
/* いまのモード。"battery"（電池）か "electrolysis"（電気分解）。
   **この2つの違いはデータの kind だけ**で、半反応式の扱いは同じ（§3-3）。 */
function modeKind() { return rawStage().kind; }
function isElyz()   { return modeKind() === "electrolysis"; }
function terms()    { return electrodeTerms(modeKind()); }

function metalsOf() { return stage().metals || []; }
function chosenBoth() { const m = metalsOf(); return !!(m[0] && m[1]); }
function pair()  { const m = metalsOf(); return halvesForPair(m[0], m[1]); }

/* 両極の半反応式の id を、モードによらず同じ形で返す。
     ox  … 酸化が起きる極（e⁻ が導線へ出ていく）＝ 電池の負極 ／ 電気分解の陽極
     red … 還元が起きる極（e⁻ が入ってくる）  ＝ 電池の正極 ／ 電気分解の陰極
   **物理は同じで名前だけが違う**ので、内部はここで1本にまとめ、
   呼び名は electrodeTerms（model.js）にだけ持たせる。 */
function halves() {
  const st = rawStage();
  if (st.kind === "electrolysis") return { ox: st.anode, red: st.cathode };
  const p = pair();
  return { ox: p.ox, red: p.red };
}
/* REDOX_STAGES と同じ形。checkRedoxMultipliers / combineHalves にそのまま渡せる */
function rstage() { return isElyz() ? electrolysisStageOf(rawStage()) : batteryStageOf(stage()); }
function oxHR()  { return HALF_REACTIONS[halves().ox]; }
function redHR() { return HALF_REACTIONS[halves().red]; }
/* 遊べる状態か（電池は板2枚がそろって、電気分解ははじめから） */
function ready() { return !!halves().ox && !!halves().red; }

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

/* モードで図が変わる。電池は2槽＋豆電球、電気分解は1槽＋電源。
   共通なのは「導線・矢印2本・粒の層」だけで、そこは同じ部品を呼ぶ。 */
function drawCell() {
  cellSvg.setAttribute("aria-label", isElyz()
    ? "電源につないだ2本の電極を、電解液にひたした電気分解の図"
    : "2枚の金属板を電解液にひたし、導線でつないだ電池の図");
  if (isElyz()) drawElectrolysisCell();
  else drawBatteryCell();
}

function drawBatteryCell() {
  cellSvg.innerHTML = "";
  const st = stage();
  const ms = metalsOf();
  const revealed = guess !== null;
  const p = pair();
  /* 「つないでも電流が流れない」ことが分かっている状態（同じ金属2枚）だけ、豆電球を消す。
     まだ何も選んでいない／予想していない段階では、答えになるので点灯のまま描く。 */
  const dead = revealed && chosenBoth() && !p.neg;

  // 導線（板の頭から上へ → 横 → もう片方の板の頭へ）
  const wire = `M ${plateCX(0)} ${CELL.plate.y} V ${CELL.wireY} H ${plateCX(1)} V ${CELL.plate.y}`;
  mk("path", { d: wire, fill: "none", stroke: "#5a6570", "stroke-width": 4, "stroke-linecap": "round" });
  // 豆電球。回路がつながっていること自体の目印（明るさは描かない＝起電力を出さない。§6）
  mk("circle", { cx: CELL.lamp.x, cy: CELL.lamp.y, r: CELL.lamp.r,
    fill: dead ? "#eceff1" : "#fdf6e0", stroke: "#5a6570", "stroke-width": 3, id: "lamp" });
  mk("path", { d: `M ${CELL.lamp.x - 8} ${CELL.lamp.y + 6} L ${CELL.lamp.x} ${CELL.lamp.y - 7} L ${CELL.lamp.x + 8} ${CELL.lamp.y + 6}`,
    fill: "none", stroke: dead ? "#aab3bb" : "#c9a227", "stroke-width": 2.5, id: "lampFil" });
  if (dead) txt("点かない", { x: CELL.lamp.x, y: CELL.lamp.y + CELL.lamp.r + 14,
    "text-anchor": "middle", "font-size": 13, fill: "#8a97a3", id: "lampDead" });

  // 容器（ガラス）と、左右の電解液
  mk("rect", { x: CELL.glass.x, y: CELL.glass.y, width: CELL.glass.w, height: CELL.glass.h,
    rx: 6, fill: "#fff", stroke: "#9fb0be", "stroke-width": 3 });
  const halfW = (CELL.divider.x - CELL.glass.x) - 2;
  [0, 1].forEach((i) => {
    const m = ms[i];
    const salt = m ? electrolyteFor(st, m) : null;
    const x = i === 0 ? CELL.glass.x + 2 : CELL.divider.x + CELL.divider.w;
    const w = i === 0 ? halfW : CELL.glass.x + CELL.glass.w - 2 - (CELL.divider.x + CELL.divider.w);
    mk("rect", { x, y: CELL.liquid.y, width: w, height: CELL.liquid.h,
      fill: salt ? (SOLUTION_TINT[salt] || "#eef2f6") : "#f4f6f8" });
    txt(salt ? SPECIES[salt].disp + " aq" : "？", { x: x + w / 2, y: CELL.liquid.y + CELL.liquid.h - 8,
      "text-anchor": "middle", "font-size": 15, fill: salt ? "#46525e" : "#a7b0b8" });
  });

  /* 素焼き板（仕切り）。**操作にはしない**（§2）。
     イオンが行き来できることだけを、静かな矢印1本で添える */
  mk("rect", { x: CELL.divider.x, y: CELL.liquid.y - 14, width: CELL.divider.w, height: CELL.liquid.h + 14,
    fill: "#e6e0d4", stroke: "#b9ae99", "stroke-width": 1.5 });
  txt("素焼き板", { x: CELL.divider.x + CELL.divider.w / 2, y: CELL.liquid.y - 20,
    "text-anchor": "middle", "font-size": 13, fill: "#8a7f6a" });

  // 板2枚（タップして予想する標的）。b2 でまだ選んでいないスロットは点線の空枠
  [0, 1].forEach((i) => {
    const m = ms[i];
    if (!m) {
      mk("rect", { x: CELL.plateX[i], y: CELL.plate.y, width: CELL.plate.w, height: CELL.plate.h,
        rx: 3, fill: "none", stroke: "#b7c3cd", "stroke-width": 2, "stroke-dasharray": "6 5",
        class: "plateEmpty" });
      txt("？", { x: plateCX(i), y: CELL.plate.y + 30, "text-anchor": "middle",
        "font-size": 19, "font-weight": "bold", fill: "#b7c3cd" });
      return;
    }
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
    const m = ms[i];
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
    const negIdx = ms.indexOf(p.neg);
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

/* ---- 電気分解の図 ----
   電池と違うのは3つだけ:
     ① 槽が1つ（仕切りが要らない。両方のイオンが同じ液の中にいる）
     ② 豆電球ではなく**電源**。e⁻ が流れる理由がこれ（イオン化傾向ではない）
     ③ 呼び名が陰極／陽極
   逆に、**e⁻ が「酸化の起きる極 → 導線 → 還元の起きる極」と動く向きは電池と同じ**。
   そこを同じ絵で描くのが、この画面のいちばんの狙い。 */
function drawElectrolysisCell() {
  cellSvg.innerHTML = "";
  const st = rawStage();
  const look = INERT_LOOK[st.electrode] || { plate: "#7d8ea0", label: "電極" };
  const sol = st.solution;

  // 導線（電極の頭 → 上 → 横 → もう片方へ）。真ん中に電源をはさむ
  const wire = `M ${plateCX(0)} ${CELL.plate.y} V ${CELL.wireY} H ${plateCX(1)} V ${CELL.plate.y}`;
  mk("path", { d: wire, fill: "none", stroke: "#5a6570", "stroke-width": 4, "stroke-linecap": "round" });

  // 容器（1槽）と電解液
  mk("rect", { x: CELL.glass.x, y: CELL.glass.y, width: CELL.glass.w, height: CELL.glass.h,
    rx: 6, fill: "#fff", stroke: "#9fb0be", "stroke-width": 3 });
  mk("rect", { x: CELL.glass.x + 2, y: CELL.liquid.y, width: CELL.glass.w - 4, height: CELL.liquid.h,
    fill: SOLUTION_TINT[sol] || "#eef2f6" });
  txt(SPECIES[sol].disp + " aq", { x: CELL.glass.x + CELL.glass.w / 2,
    y: CELL.liquid.y + CELL.liquid.h - 8, "text-anchor": "middle", "font-size": 15, fill: "#46525e" });

  // 電極2本（不活性。**タップしても何も起きない**＝電気分解では電極を選ばせない。§3-3）
  [0, 1].forEach((i) => {
    mk("rect", { x: CELL.plateX[i], y: CELL.plate.y, width: CELL.plate.w, height: CELL.plate.h,
      rx: 3, fill: look.plate, stroke: "#46525e", "stroke-width": 2, class: "plateBody inert" });
    // 札は導線の真下を避けて横へ寄せる（真ん中に置くと縦の導線が字を貫く）
    txt(look.label, { x: plateCX(i) + (i === 0 ? -38 : 38), y: CELL.plate.y - 6,
      "text-anchor": "middle", "font-size": 13, fill: "#6d7a86" });
  });

  /* 電源。長い棒が (+)・短い棒が (−) の、教科書どおりの電池記号。
     (+) 側が陽極（左）につながる ＝ 陽極から e⁻ が電源へ吸い出される。 */
  drawPowerSupply(CELL.lamp.x, CELL.wireY);

  // 役の札（電気分解ははじめから出す。予想する要素が無いので隠す意味がない）
  const y = CELL.glass.y + CELL.glass.h + 22;
  txt("陽極 (+側)", { x: plateCX(0), y, "text-anchor": "middle",
    "font-size": 16, "font-weight": "bold", fill: "#c0603c" });
  txt("陰極 (−側)", { x: plateCX(1), y, "text-anchor": "middle",
    "font-size": 16, "font-weight": "bold", fill: "#3c7ac0" });
  txt("酸化（e⁻ を出す）", { x: plateCX(0), y: y + 17, "text-anchor": "middle",
    "font-size": 12, fill: "#8a7f6a" });
  txt("還元（e⁻ を受け取る）", { x: plateCX(1), y: y + 17, "text-anchor": "middle",
    "font-size": 12, fill: "#8a7f6a" });

  // 矢じり（defs）— 電池側と同じ id を使う
  const defs = mk("defs", {});
  const mk2 = (id, color) => {
    const m2 = mk("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    mk("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }, m2);
  };
  mk2("bArrow", "#7d8b97");
  mk2("bArrowE", "#c9a227");
  mk2("bArrowI", "#a33a2c");

  /* e⁻ は陽極（左）から導線を通って陰極（右）へ。電流はその逆。
     電池と同じ描き方にしてあるのは、**同じことが起きている**からで、
     違うのは「なぜ動くか」（電源が押す）と呼び名だけ。 */
  arrowOnWire(CELL.wireY - 16, 1, "e⁻", "#c9a227");
  arrowOnWire(CELL.wireY - 38, -1, "電流", "#a33a2c");

  particleLayer = mk("g", { id: "particleLayer" });
}

/* 電源の記号（長い棒＝(+)・短い棒＝(−)）。左が (+)、右が (−) */
function drawPowerSupply(cx, cy) {
  const g = mk("g", { id: "powerSupply" });
  // 導線を切って記号を置く（切らないと「ただの線に飾りが乗っている」ように見える）
  mk("rect", { x: cx - 26, y: cy - 16, width: 52, height: 32, fill: "#fff", stroke: "none" }, g);
  const bar = (x, h, w) => mk("path", { d: `M ${x} ${cy - h} V ${cy + h}`, stroke: "#33404c",
    "stroke-width": w, "stroke-linecap": "round" }, g);
  bar(cx - 12, 14, 3);   // 長い棒＝正極端子
  bar(cx - 4, 7, 5);     // 短い棒＝負極端子
  bar(cx + 4, 14, 3);
  bar(cx + 12, 7, 5);
  txt("＋", { x: cx - 30, y: cy - 6, "text-anchor": "middle", "font-size": 15,
    "font-weight": "bold", fill: "#a33a2c" }, g);
  txt("−", { x: cx + 30, y: cy - 6, "text-anchor": "middle", "font-size": 17,
    "font-weight": "bold", fill: "#3c7ac0" }, g);
  txt("電源", { x: cx, y: cy + 30, "text-anchor": "middle", "font-size": 13,
    "font-weight": "bold", fill: "#46525e", id: "powerLabel" }, g);
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

/* ================================================================================
   e⁻ が導線を流れるアニメ（実装の刻み3）

   redox.js のビーカーと違って、**e⁻ は板の上にたまらず導線の中を通る**。
   電池で最も誤解されるのが「e⁻ の向きと電流の向き」なので、そこを絵で見せるのが本題。

   判定は個数だけ（§0）。座標はここに書いてある通り**見た目専用**で、
   クリアかどうかは checkRedoxMultipliers と「待ちイオンが残っていないか」で決める。
   ================================================================================ */

const E_SPEED = 230;        // e⁻ が導線を進む速さ（単位/秒）
const ION_SPEED = 95;       // イオンが泳ぐ速さ
const GAS_SPEED = 70;       // 泡が水面へ上がる速さ
const RELEASE_EVERY = 0.85; // 負極の板から原子が1個溶けていく間隔（秒）
const E_STAGGER = 0.16;     // 同じ原子から出た e⁻ を少しずらして出す

/* 粒を置く場所（すべて見た目専用）。
   板は液の中に立っているので、片側にしか広い空きが無い。
     左の槽 58〜236 … 板が 126〜152 なので、広いほうは仕切り側の 152〜236
     右の槽 244〜422 … 板が 328〜354 なので、広いほうは仕切り側の 244〜328
   どちらも**仕切り側の面**に寄せると、板の裏に粒が隠れない。 */
const plateFaceX = (i) => (i === 0 ? 165 : 315);   // 板の面（原子・析出・到着した e⁻）
const waitX      = (i) => (i === 0 ? 196 : 284);   // e⁻ を待つイオンの居場所
const driftX     = (i) => (i === 0 ? 222 : 258);   // 溶け出したイオンが広がっていく先

function slotY(k, n) {
  const top = CELL.liquid.y + 28, bottom = CELL.liquid.y + CELL.liquid.h - 28;
  const step = n > 1 ? Math.min(34, (bottom - top) / (n - 1)) : 0;
  const first = (top + bottom) / 2 - step * (n - 1) / 2;
  return first + k * step;
}

let particles = [];
let nextId = 1;
let phase = "idle";     // idle | running | done
let cleared = false;
let released = 0;       // 溶けた原子の数
let spawnedE = 0;       // これまでに出した e⁻ の数（プールの席順に使う）
let arrivedE = [];      // 正極まで着いた e⁻（受け渡し待ち）
let deposited = 0;
let gasUp = 0;          // 泡になって上がった気体の数（置き場所をずらすのに使う）
let clock = 0;          // 再生開始からの秒数（advance で決定論的に進む）
let nextRelease = 0;

/* 酸化が起きる極の位置。電池は負極（イオン化傾向が決める）、電気分解は左に固定。
   **左＝ e⁻ が出ていく極**を両モードでそろえてあるのは、
   「呼び名は違うが起きていることは同じ」を絵で言うため。 */
function oxIdx()  { return isElyz() ? 0 : metalsOf().indexOf(pair().neg); }
function redIdx() { return 1 - oxIdx(); }

/* e⁻ の道すじ。酸化の極の頭 → 導線を上って → 横切って → 還元の極を下る */
function ePath(poolK) {
  const n = oxIdx(), p = redIdx();
  return [
    { x: plateCX(n), y: CELL.plate.y + 22 },
    { x: plateCX(n), y: CELL.wireY },
    { x: plateCX(p), y: CELL.wireY },
    { x: plateCX(p), y: CELL.liquid.y + 8 },
    { x: plateFaceX(p), y: CELL.liquid.y + 20 + (poolK % 8) * 15 },
  ];
}

function particleEl(p) {
  const g = mk("g", { class: "bPart" }, particleLayer);
  const isE = p.sp === "e-";
  const sty = METAL_STYLE[p.sp.replace(/\^.*$/, "")] || {};
  const fill = isE ? "#f2c14e" : (p.kind === "ion" || p.kind === "wait" ? (sty.ion || "#8fa3b4") : (sty.plate || "#8fa3b4"));
  mk("circle", { r: p.r, fill, stroke: "#33404c", "stroke-width": 1.5 }, g);
  const t = txt(SPECIES[p.sp].disp, { x: 0, y: p.r * 0.35, "text-anchor": "middle",
    "font-size": isE ? 10 : 12, fill: isE || sty.darkText ? "#33404c" : "#fff", "font-weight": "bold" }, g);
  t.setAttribute("pointer-events", "none");
  return g;
}

function spawn(kind, sp, x, y, extra) {
  const p = Object.assign({ id: nextId++, kind, sp, x, y, r: sp === "e-" ? 9 : 15 }, extra || {});
  p.el = particleEl(p);
  particles.push(p);
  moveEl(p);
  return p;
}
function moveEl(p) { p.el.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`); }
function killParticle(p) {
  particles = particles.filter((o) => o !== p);
  if (p.el) p.el.remove();
}

/* 目標へ一定の速さで近づく。着いたら true */
function stepToward(p, tx, ty, speed, dt) {
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  const move = speed * dt;
  if (d <= move) { p.x = tx; p.y = ty; return true; }
  p.x += (dx / d) * move; p.y += (dy / d) * move;
  return false;
}

function flash(x, y, color) {
  const c = mk("circle", { cx: x, cy: y, r: 17, fill: "none", stroke: color,
    "stroke-width": 3, class: "splash" }, particleLayer);
  setTimeout(() => c.remove(), 500);
}

/* ---- 再生 ---- */
function play() {
  const p = pair();
  if (guess === null) return;
  /* 同じ金属を2枚選んだとき。**電池にならない**ことを、ごまかさずそのまま言う。
     e⁻ を1個も出さないので、粒も動かないし豆電球も点かない（§2-1「流れないことも発見のうち」）。
     ここで「イオン化傾向が同じだから」と言わないのは、**同じ金属なら傾向を比べる相手が
     そもそも居ない**から。差の有無の話に寄せる。 */
  if (!p.ox && p.reason === "same-metal") {
    layoutRun();
    phase = "done";
    setMsg("つないでも e⁻ は動かない。2枚とも " + SPECIES[metalsOf()[0]].disp +
      " では「どちらが e⁻ を出しやすいか」の差が無いので、e⁻ が一方向へ動く理由がない。" +
      "電流が流れない ＝ 電池にならない。板を選び直して、ちがう2枚で試してみよう。", "ng");
    drawCell();
    return;
  }
  if (!p.ox) return;
  layoutRun();
  phase = "running";
  setMsg(guessOk
    ? "つないだ。e⁻ が負極の板から導線を通って正極へ流れていく（電流はその逆向き）。"
    : "つないだ。e⁻ は予想とは逆向きに流れる。溶けるのは " + SPECIES[p.neg].disp + " のほう。",
    guessOk ? "info" : "ng");
}

/* 電気分解の再生。予想の段が無いので、押せばすぐ動く。
   **e⁻ が動く理由は電源**（イオン化傾向ではない）ことを、最初の1行で言い切る。 */
function playElyz() {
  layoutRun();
  phase = "running";
  setMsg("電源を入れた。電源が e⁻ を押し出すので、陽極で酸化・陰極で還元が起きる。" +
    "どちらが溶けやすいかの勝負ではなく、外から押し込んでいるのがちがい。", "info");
}

/* 盤面を倍率どおりに並べ直す（再生前の姿） */
function layoutRun() {
  particles.forEach((q) => q.el && q.el.remove());
  particles = [];
  arrivedE = [];
  released = 0; spawnedE = 0; deposited = 0;
  clock = 0; nextRelease = 0;
  phase = "idle";
  cleared = false;
  clearEl.hidden = true;
  gasUp = 0;
  revealStep(stepSumEl, false);
  if (!ready()) return;
  /* 電池では**予想を宣言するまで粒を置かない**。溶ける原子は負極の板にしか並ばないので、
     並べた時点で「どちらが溶けるか」を先に答えてしまう。
     電気分解には予想が無い（どちらの極で何が起きるかは電源が決める）ので、はじめから並べる。 */
  if (!isElyz() && guess === null) { refreshHUD(); return; }
  const n = oxIdx(), q = redIdx();
  const a = mult[0], b = mult[1];
  /* 酸化側に、1単位ぶんの出発種を a 単位ならべる。
     金属板なら1単位＝原子1個（Zn）だが、電気分解では 2Cl⁻ や 2H₂O のように複数個で1単位。
     **式の左辺をそのまま並べる**ので、倍率を変えると盤面の数もそのまま変わる。 */
  spawnUnits("atom", oxHR().left, a, plateFaceX(n), null);
  // 還元側に、e⁻ を待つ種を b 単位ならべる（1単位が受け取る e⁻ の数＝need）
  spawnUnits("wait", redHR().left, b, driftX(q), waitX(q));
  refreshHUD();
}

/* 半反応式の片側（e⁻ を除く）を n 単位ぶん並べる。
   1単位の中身は式の係数どおり（2Cl⁻ なら Cl⁻ を2個）。 */
function spawnUnits(kind, side, n, x, tx) {
  const ts = side.filter((t) => t.sp !== "e-");
  const per = ts.reduce((s, t) => s + t.n, 0);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (const t of ts) {
      for (let j = 0; j < t.n; j++, k++) {
        const y = slotY(i, n) + (k - (per - 1) / 2) * 26;
        spawn(kind, t.sp, x, y, tx === null ? { unit: i } : { unit: i, tx, ty: y });
      }
    }
  }
}

/* 1単位ぶんの生成物を置く。気体は泡になって上がり、単体は極に析出し、
   イオンは液の中へ広がっていく。**どれになるかは種の性質から決める**
   （気体の一覧は model.js の NON_PLATEABLE_GAS を借りる。表を二重に持たない）。 */
function spawnProducts(side, i, baseY) {
  const ts = side.filter((t) => t.sp !== "e-");
  const per = ts.reduce((s, t) => s + t.n, 0);
  let k = 0;
  for (const t of ts) {
    for (let j = 0; j < t.n; j++, k++) {
      const y = baseY + (k - (per - 1) / 2) * 24;
      if (NON_PLATEABLE_GAS.has(t.sp)) {
        const side2 = i === 0 ? 1 : -1;
        const bx = plateFaceX(i) + side2 * (14 + (gasUp % 3) * 24);
        spawn("gas", t.sp, plateFaceX(i), y, { tx: bx, ty: CELL.liquid.y + 16 });
        flash(plateFaceX(i), y, "#8fb8c8");
        gasUp++;
      } else if (SPECIES[t.sp].charge === 0) {
        const dy = CELL.liquid.y + CELL.liquid.h - 26 - deposited * 25;
        spawn("dep", t.sp, plateFaceX(i), dy);
        flash(plateFaceX(i), dy, "#7fb08a");
        deposited++;
      } else {
        spawn("ion", t.sp, plateFaceX(i), y, { tx: driftX(i), ty: y });
        flash(plateFaceX(i), y, "#f2c14e");
      }
    }
  }
}

function step(dt) {
  /* 終わったあとも泡だけは上がりきらせる（途中で止まると、水面まで出ていないのに
     「発生した」と言うことになる）。判定はもう済んでいるので数には影響しない。 */
  if (phase === "done") {
    for (const x of particles) if (x.kind === "gas") { stepToward(x, x.tx, x.ty, GAS_SPEED, dt); moveEl(x); }
    return;
  }
  if (phase !== "running") return;
  clock += dt;
  const n = oxIdx(), q = redIdx();
  const givePer = electronsOf(oxHR());
  const need = electronsOf(redHR());

  /* ① 酸化の極で1単位ぶんが反応する（＝ e⁻ を givePer 個出して、生成物になる）。
        金属板なら「原子1個が溶けてイオンになる」、電気分解なら「2Cl⁻ が Cl₂ になる」。
        どちらも**式の左辺1単位ぶんを消して、右辺1単位ぶんを置く**という同じ処理。 */
  if (released < mult[0] && clock >= nextRelease) {
    const members = particles.filter((x) => x.kind === "atom" && x.unit === released);
    if (members.length) {
      const baseY = members.reduce((s, x) => s + x.y, 0) / members.length;
      members.forEach(killParticle);
      spawnProducts(oxHR().right, n, baseY);
      for (let k = 0; k < givePer; k++) {
        const path = ePath(spawnedE);
        spawn("e", "e-", path[0].x, path[0].y, { path, seg: 0, delay: k * E_STAGGER, poolK: spawnedE });
        spawnedE++;
      }
      released++;
      nextRelease = clock + RELEASE_EVERY;
    }
  }

  // ② 粒を動かす
  for (const x of [...particles]) {
    if (x.kind === "ion") { stepToward(x, x.tx, x.ty, ION_SPEED, dt); moveEl(x); }
    else if (x.kind === "wait") { stepToward(x, x.tx, x.ty, ION_SPEED, dt); moveEl(x); }
    else if (x.kind === "gas") { stepToward(x, x.tx, x.ty, GAS_SPEED, dt); moveEl(x); }
    else if (x.kind === "e") {
      if (x.delay > 0) { x.delay -= dt; continue; }
      if (x.seg >= x.path.length - 1) continue;
      const to = x.path[x.seg + 1];
      if (stepToward(x, to.x, to.y, E_SPEED, dt)) {
        x.seg++;
        if (x.seg === x.path.length - 1 && !arrivedE.includes(x)) arrivedE.push(x);
      }
      moveEl(x);
    }
  }

  /* ③ 還元の極で受け渡し。待っていた1単位に e⁻ が need 個そろったら、右辺の生成物になる
        （金属なら極に析出、水素・塩素・酸素なら泡になって上がる）。 */
  while (arrivedE.length >= need) {
    const units = [...new Set(particles.filter((x) => x.kind === "wait").map((x) => x.unit))].sort((u, v) => u - v);
    if (!units.length) break;
    const u = units[0];
    const members = particles.filter((x) => x.kind === "wait" && x.unit === u);
    const baseY = members.reduce((s, x) => s + x.y, 0) / members.length;
    arrivedE.splice(0, need).forEach(killParticle);
    members.forEach(killParticle);
    spawnProducts(redHR().right, q, baseY);
  }

  // ④ 終わりの判定（数だけで決める）
  const movingE = particles.filter((x) => x.kind === "e" && x.seg < x.path.length - 1);
  const waiting = particles.filter((x) => x.kind === "wait");
  if (released >= mult[0] && !movingE.length && (arrivedE.length < need || !waiting.length)) {
    finish();
  }
  refreshHUD();
}

function finish() {
  phase = "done";
  const st = rstage();
  const chk = checkRedoxMultipliers(st, mult[0], mult[1]);
  const leftoverE = arrivedE.length;
  const waiting = [...new Set(particles.filter((x) => x.kind === "wait").map((x) => x.unit))].length;
  arrivedE.forEach((e) => e.el.classList.add("leftoverE"));
  particles.filter((x) => x.kind === "wait").forEach((x) => x.el.classList.add("waitingIon"));

  const T = terms();
  if (!chk.ok) {
    setMsg(chk.reason + (leftoverE ? `　${T.red}で e⁻ が ${leftoverE}個 余っている。`
      : waiting ? `　e⁻ を待っているイオンが ${waiting}単位 残っている。` : ""), "ng");
    return;
  }
  // 予想の当たり外れは電池だけの条件（電気分解には予想の段が無い）
  if (!isElyz() && !guessOk) {
    setMsg("e⁻ の数はぴったり合った。ただし予想は外れていた —— 溶けたのは " +
      SPECIES[pair().neg].disp + " のほう。板をタップして言い直してから、もう一度つないでみよう。", "ng");
    return;
  }
  cleared = true;
  if (isElyz()) {
    const prod = (hr) => hr.right.filter((t) => t.sp !== "e-")
      .map((t) => (t.n > 1 ? t.n : "") + SPECIES[t.sp].disp).join(" ＋ ");
    setMsg(`ぴったり。陽極で ${prod(oxHR())} ができて e⁻ を ${electronsOf(oxHR()) * mult[0]}個 出し、` +
      `その e⁻ が導線と電源を通って陰極で使われ、${prod(redHR())} ができた。余りも待ちも無い。`, "ok");
  } else {
    setMsg(`ぴったり。負極の ${SPECIES[pair().neg].disp} が溶けて e⁻ を出し、` +
      `その e⁻ が導線を通って正極で ${SPECIES[pair().pos].disp} になった。余りも待ちも無い。`, "ok");
  }
  buildSumSheet();
  revealStep(stepSumEl, true);
  showClear();
}

function showClear() {
  clearEl.hidden = false;
  clearEl.innerHTML = "";
  const p = pair();
  const t1 = document.createElement("div");
  const what = isElyz() ? rawStage().title
    : rawStage().choose ? SPECIES[p.neg].disp + "と" + SPECIES[p.pos].disp + "の電池"
    : stage().title;
  t1.innerHTML = `<strong>クリア！</strong> ${what}が最後まで動いた。` +
    (isElyz() ? "e⁻ の数もぴったり合った。"
      : guessTries === 1 ? "予想も一発で当てた。" : "予想を言い直して当てた。");
  clearEl.appendChild(t1);
  // b2 は「1組できて終わり」ではない。相手を変えると役が入れ替わる、が本題
  if (rawStage().choose) {
    const t2 = document.createElement("div");
    t2.className = "clearNudge";
    t2.textContent = "右の板を別の金属に替えると、同じ板の役が変わることがある。ほかの組み合わせも試そう。";
    clearEl.appendChild(t2);
  }
  const again = document.createElement("button");
  again.textContent = "↺ もう一度";
  again.onclick = () => resetRound();
  clearEl.appendChild(again);
}

function refreshHUD() {
  const counts = {};
  for (const x of particles) {
    if (x.kind === "e" || x.kind === "atom") continue;
    counts[x.sp] = (counts[x.sp] || 0) + 1;
  }
  ionCountsEl.innerHTML = "";
  const chip = (text, color, extra) => {
    const c = document.createElement("span");
    c.className = "chip" + (extra ? " " + extra : "");
    if (color) c.style.borderColor = color;
    c.textContent = text;
    ionCountsEl.appendChild(c);
  };
  for (const sp of Object.keys(counts)) {
    const base = (METAL_STYLE[sp.replace(/\^.*$/, "")] || {});
    chip(`${SPECIES[sp].disp} ×${counts[sp]}`, base.ion || base.plate);
  }
  const flying = particles.filter((x) => x.kind === "e" && x.seg < x.path.length - 1).length;
  if (flying) chip(`e⁻ ×${flying}（導線の中）`, "#f2c14e");
  if (arrivedE.length) chip(`e⁻ ×${arrivedE.length}（${terms().red}に到着）`, "#f2c14e");
}

/* ---- 時間を進める（redox / condition と同じ流儀の決定論的なフック）---- */
let lastT = performance.now();
function tick(now) {
  if (now <= lastT) return;
  let dt = Math.min(1, (now - lastT) / 1000);
  lastT = now;
  while (dt > 0) {
    const h = Math.min(dt, 0.033);
    step(h);
    dt -= h;
  }
}
function frame(now) { tick(now); requestAnimationFrame(frame); }

/* ---- 段3: 足し合わせと電池式 ---- */

function renderTermsInto(el, terms, k, markE) {
  el.innerHTML = "";
  terms.forEach((t, i) => {
    if (i) {
      const s = document.createElement("span");
      s.className = "fsep";
      s.textContent = "＋";
      el.appendChild(s);
    }
    const s = document.createElement("span");
    if (markE && t.sp === "e-") s.className = "cancel";
    s.textContent = (t.n * k > 1 ? t.n * k : "") + SPECIES[t.sp].disp;
    el.appendChild(s);
  });
}

function buildSumSheet() {
  calcSheetEl.innerHTML = "";
  const head = document.createElement("div");
  head.className = "cSpan stepHead inSheet";
  const no = document.createElement("span");
  no.className = "stepNo";
  no.textContent = "3";
  head.append(no, document.createTextNode("足し合わせて e⁻ を消す — 両極の式を縦に足す"));
  calcSheetEl.appendChild(head);

  const a = mult[0], b = mult[1];
  const T = terms();
  const rowN = sheetRow(calcSheetEl, "sumNeg");
  const rowP = sheetRow(calcSheetEl, "sumPos");
  [[rowN, oxHR(), a, T.ox], [rowP, redHR(), b, T.red]].forEach(([r, hr, k, tag]) => {
    r.mark.textContent = "×" + k + " )";
    r.left.className = "cLeft halfFormula";
    r.right.className = "cRight halfFormula";
    renderTermsInto(r.left, hr.left, k, true);
    renderTermsInto(r.right, hr.right, k, true);
    r.arrow.textContent = "→";
    r.note.textContent = tag;
  });

  const rule = document.createElement("div");
  rule.className = "cRule";
  calcSheetEl.appendChild(rule);

  const ionic = combineHalves(rstage(), a, b);
  const rowI = sheetRow(calcSheetEl, "sumIonic");
  rowI.left.className = "cLeft halfFormula";
  rowI.right.className = "cRight halfFormula";
  renderTermsInto(rowI.left, ionic.left, 1, false);
  renderTermsInto(rowI.right, ionic.right, 1, false);
  rowI.arrow.textContent = "→";
  rowI.note.textContent = "全体の反応";

  if (!isElyz()) {
    // 電池式（教科書表記）。負極を左・正極を右に置き、電解液を縦棒で挟む
    const cellBox = document.createElement("div");
    cellBox.className = "cSpan cellNotation";
    cellBox.id = "cellNotation";
    const cap = document.createElement("div");
    cap.className = "cellCap";
    cap.textContent = "電池式（この電池の書き表し方）";
    const val = document.createElement("div");
    val.className = "cellVal";
    val.textContent = cellNotation(stage());
    cellBox.append(cap, val);
    calcSheetEl.appendChild(cellBox);
  }

  /* 発展の読み物。**操作にはしない**ので折りたたみ1枚。
     電池は「なぜ仕切りが要るか」（§2）、電気分解は「なぜ名前が入れ替わるか」。 */
  const more = document.createElement("details");
  more.className = "cSpan howto";
  more.id = isElyz() ? "termNote" : "separatorNote";
  const sum = document.createElement("summary");
  const body = document.createElement("p");
  if (isElyz()) {
    sum.textContent = "発展：電池の負極と、電気分解の陽極は何がちがう？";
    body.textContent =
      "どちらも「酸化が起きて e⁻ が導線へ出ていく極」で、起きていることは同じ。" +
      "ちがうのは名前と符号だけ。電池では e⁻ を押し出す側が電源になるので、その極を負極(−)とよぶ。" +
      "電気分解では外の電源が e⁻ を引き抜くので、その極は電源の(+)端子につながり、陽極とよぶ。" +
      "覚え方は「極の名前」ではなく「e⁻ がどちらへ動くか」。" +
      "e⁻ が出ていく極＝酸化、e⁻ が入ってくる極＝還元。これは両方で変わらない。";
  } else {
    sum.textContent = "発展：素焼き板は何のためにある？";
    body.textContent =
      "仕切りが無いと2つの水溶液が混ざり、Cu²⁺ が亜鉛板まで届いて、その場で e⁻ を受け取ってしまう" +
      "（導線を通らないので電流にならない）。素焼き板は水溶液が混ざるのは防ぎ、イオンだけを通す。" +
      "反応が進むと負極側は Zn²⁺ が増えて陽イオンが余り、正極側は Cu²⁺ が減って陰イオンが余る。" +
      "そこで SO₄²⁻ が仕切りを通って負極側へ移り、電気のかたよりを打ち消す。これが無いと電流はすぐ止まる。";
  }
  more.append(sum, body);
  calcSheetEl.appendChild(more);
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
    // 同じ金属2枚（b1 では起きない。b2 で通る道）
    setPredictMsg("2枚とも同じ金属なので、「どちらが溶けるか」を決める差がない。" +
      "イオン化傾向はちがう金属どうしを比べるものなので、同じ金属では比べようがない。" +
      "▶ つないでみると、どうなるか分かる。", "info");
  } else if (guessOk) {
    setPredictMsg(`当たり。イオン化傾向は ${SPECIES[p.neg].disp} ＞ ${SPECIES[p.pos].disp} で、` +
      `イオン化傾向の大きいほうが e⁻ を出して溶ける。${SPECIES[p.neg].disp} が負極(−)。`, "ok");
  } else {
    setPredictMsg(`溶けるのは ${SPECIES[p.neg].disp} のほう。イオン化傾向は ` +
      `${SPECIES[p.neg].disp} ＞ ${SPECIES[p.pos].disp} で、イオン化傾向の大きいほうが e⁻ を出す。` +
      `${SPECIES[p.pos].disp} は e⁻ を受け取る側（正極(+)）にまわる。`, "ng");
  }
  /* 役が画面に出た＝この組み合わせでの役が分かった、という記録。
     当たり外れに関係なく残す（外れて知ったことも発見のうち）。 */
  if (p.neg) recordRoles(p.neg, p.pos);
  drawCell();
  layoutRun();       // 宣言できたので、盤面に原子と待ちイオンを並べる
  refreshSteps();
  renderDiscovery();
  updateToolbar();   // 宣言したので「▶ つないでみる」が押せるようになる
}

/* ================================================================================
   電極パレット（実装の刻み4）— b2「電極を選ぶ」

   ここが B3 の核心（設計 §1）。板を選ばせないと
   「Cu は Zn と組めば正極、Ag と組めば負極」という**役の相対性**が体験にならない。
   選ばせるのは金属だけで、どちらが負極かは negativeOf が決める（画面は判定を持たない）。
   ================================================================================ */

function pickMetal(m) {
  if (picked[0] === null) picked[0] = m;
  else picked[1] = m;          // 左は残したまま右だけ差し替える（相手を変えて比べやすい）
  resetRound();
}
function clearSlot(i) {
  if (i === 0) picked = [null, null];   // 左を外すと、選べる相手も変わるので右も外す
  else picked[1] = null;
  resetRound();
}

function buildPalette() {
  const st = rawStage();
  if (!st.choose) { paletteEl.hidden = true; paletteEl.innerHTML = ""; return; }
  paletteEl.hidden = false;
  paletteEl.innerHTML = "";

  const slots = document.createElement("div");
  slots.className = "palSlots";
  [0, 1].forEach((i) => {
    const b = document.createElement("button");
    b.className = "palSlot" + (picked[i] ? " filled" : "");
    b.dataset.slot = String(i);
    const cap = document.createElement("span");
    cap.className = "palSlotCap";
    cap.textContent = i === 0 ? "左の板" : "右の板";
    const val = document.createElement("span");
    val.className = "palSlotVal";
    val.textContent = picked[i] ? SPECIES[picked[i]].disp : "？";
    b.append(cap, val);
    b.setAttribute("aria-label", (i === 0 ? "左" : "右") + "の板：" +
      (picked[i] ? SPECIES[picked[i]].name + "。タップで外す" : "まだ選んでいない"));
    b.onclick = () => clearSlot(i);
    slots.appendChild(b);
    if (i === 0) {
      const s = document.createElement("span");
      s.className = "palAnd";
      s.textContent = "と";
      slots.appendChild(s);
    }
  });
  paletteEl.appendChild(slots);

  const all = st.electrodes || BATTERY_ELECTRODES;
  /* 選べる相手は model.js が決める（§0「判断できない組み合わせは候補に出さない」）。
     画面側で「Mg と Zn は駄目」と書き写さない——収録の増減に自動で追従させるため。 */
  const allowed = picked[0] ? batteryPartnersOf(picked[0]) : all;
  const row = document.createElement("div");
  row.className = "palRow";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "板に使う金属を選ぶ");
  all.forEach((m) => {
    const b = document.createElement("button");
    b.className = "palMetal" + (picked.includes(m) ? " used" : "");
    b.dataset.metal = m;
    b.textContent = SPECIES[m].disp;
    const sty = METAL_STYLE[m] || {};
    b.style.setProperty("--pm", sty.plate || "#9aa4ae");
    if (sty.darkText) b.style.color = "#33404c";
    if (!allowed.includes(m)) {
      b.disabled = true;
      b.setAttribute("aria-label", SPECIES[m].name + "：いまの左の板とは組ませられない");
    } else {
      b.setAttribute("aria-label", SPECIES[m].name + "の板にする");
      b.onclick = () => pickMetal(m);
    }
    row.appendChild(b);
  });
  paletteEl.appendChild(row);

  const hint = document.createElement("div");
  hint.className = "palHint";
  hint.textContent =
    !picked[0] ? "まず1枚目の金属を選ぼう。"
    : !picked[1] ? SPECIES[picked[0]].disp + " と組ませる相手を選ぼう。" +
        "灰色の金属は、正極側で起きることをこのアプリが用意していない組み合わせ（起きないという意味ではない）。"
    : "板をタップして予想 → 「▶ つないでみる」。別の金属を押せば右の板を差し替えられる。";
  paletteEl.appendChild(hint);
}

/* 役の記録。metal → { neg: [相手…], pos: [相手…] } */
function recordRoles(neg, pos) {
  const add = (m, role, other) => {
    roleLog[m] = roleLog[m] || { neg: [], pos: [] };
    if (!roleLog[m][role].includes(other)) roleLog[m][role].push(other);
  };
  add(neg, "neg", pos);
  add(pos, "pos", neg);
}

/* 両方の役をこなした金属が出たら、そこで初めて「相対性」を言葉にする。
   先に言ってしまうと発見にならないので、**遊んだ記録が揃うまで出さない**。 */
function renderDiscovery() {
  const both = Object.keys(roleLog).filter((m) => roleLog[m].neg.length && roleLog[m].pos.length);
  discoveryEl.innerHTML = "";
  // 電気分解では出さない（負極・正極の話なので、陰極・陽極の画面に混ぜると用語が混ざる）
  discoveryEl.hidden = isElyz() || !both.length;
  if (discoveryEl.hidden) return;
  const names = (list) => list.map((x) => SPECIES[x].disp).join("・");
  for (const m of both) {
    const d = document.createElement("div");
    const lead = document.createElement("strong");
    lead.textContent = "発見　";
    d.appendChild(lead);
    d.appendChild(document.createTextNode(SPECIES[m].disp + " は "));
    const a = document.createElement("b");
    a.className = "rNeg";
    a.textContent = names(roleLog[m].neg) + " と組むと負極(−)";
    d.appendChild(a);
    d.appendChild(document.createTextNode("、"));
    const b = document.createElement("b");
    b.className = "rPos";
    b.textContent = names(roleLog[m].pos) + " と組むと正極(+)";
    d.appendChild(b);
    d.appendChild(document.createTextNode("。同じ金属でも、役は相手で決まる。"));
    discoveryEl.appendChild(d);
  }
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
  if (!ready()) return;
  /* 酸化（e⁻ を出す）／還元（e⁻ を受け取る）。**呼び名だけ**モードで差し替える:
     電池は 負極(−)/正極(+)、電気分解は 陽極/陰極（設計 §3-3）。
     中身が同じで名前が違うことを、同じ行の同じ位置で見せるのが狙い。 */
  const T = terms();
  buildHalfRow(SHEET.neg, oxHR(), 0, T.oxTag, "ox");
  buildHalfRow(SHEET.pos, redHR(), 1, T.redTag, "red");
}

function updateETally() {
  if (!ready()) { eTallyEl.textContent = ""; return; }
  const a = mult[0], b = mult[1];
  const T = terms();
  const givePer = electronsOf(oxHR()), takePer = electronsOf(redHR());
  const give = givePer * a, take = takePer * b;
  const ok = give === take;
  eTallyEl.innerHTML =
    `${T.ox}が出す e⁻: ${givePer}×${a} ＝ <strong>${give}個</strong>　／　` +
    `${T.red}が受け取る e⁻: ${takePer}×${b} ＝ <strong>${take}個</strong> ` +
    `<span class="${ok ? "okcell" : "ngcell"}">${ok ? "そろった（足せる）" : "そろっていない"}</span>`;
}

function onMultChange() {
  buildHalfSheet();
  updateETally();
  // 倍率が変われば盤面の並びも足し合わせも変わるので、白紙に戻す
  layoutRun();
  refreshSteps();
  setMsg("倍率を変えた。「" + (isElyz() ? "▶ 電源を入れる" : "▶ つないでみる") +
    "」で e⁻ の数が合うか確かめよう。");
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
  /* 段2（半反応式）は**予想を宣言してから**。式が答えそのものなので先に出さない。
     電気分解には予想の段が無い（どちらの極で何が起きるかは電源が決めるので
     当てさせる余地がない）ので、はじめから出す。 */
  revealStep(stepHalvesEl, ready() && (isElyz() || guess !== null));
}

/* ---- 釦 ---- */
function buildToolbar() {
  toolbarEl.innerHTML = "";
  const playBtn = document.createElement("button");
  playBtn.id = "playBtn";
  playBtn.className = "react";
  playBtn.textContent = isElyz() ? "▶ 電源を入れる" : "▶ つないでみる";
  playBtn.onclick = () => (isElyz() ? playElyz() : play());
  const reset = document.createElement("button");
  reset.className = "reset";
  reset.textContent = "↺ やり直す";
  // 板の組み合わせは残す（相手を変えて比べる遊びを切らないため）。板を外すのはスロットのタップ
  reset.onclick = () => resetRound();
  toolbarEl.append(playBtn, reset);
  updateToolbar();
}

function updateToolbar() {
  const btn = document.getElementById("playBtn");
  if (!btn) return;
  // 電気分解には予想の段が無いので、はじめから押せる
  if (isElyz()) { btn.disabled = false; btn.title = ""; return; }
  // 板がそろうまで、そして宣言するまで再生できない（§2-1・§2-2）
  btn.disabled = !chosenBoth() || guess === null;
  btn.title = !chosenBoth() ? "先に板を2枚選ぼう"
    : guess === null ? "先に、溶けると思う板をタップして予想しよう" : "";
}

/* ---- ステージ ---- */
function stageLabel(i) { return `ステージ${i + 1}：${CELL_STAGES[i].title}`; }

function buildStageNav() {
  stageNavEl.innerHTML = "";
  CELL_STAGES.forEach((st, i) => {
    const b = document.createElement("button");
    b.textContent = String(i + 1);
    b.className = i === stageIdx ? "active" : "";
    b.title = stageLabel(i);
    b.dataset.label = st.title;
    b.onclick = () => { stageIdx = i; initStage(); };
    stageNavEl.appendChild(b);
  });
}

/* 1回ぶんの盤面をまっさらに戻す。**選んだ板（picked）と役の記録（roleLog）は残す**
   ——「やり直す」で組み合わせまで消えると、相手を変えて比べる遊びが続かない。 */
function resetRound() {
  guess = null;
  guessTries = 0;
  guessOk = false;
  mult = [1, 1];
  buildStageNav();
  buildToolbar();
  buildPalette();
  renderDiscovery();
  predictHeadEl.textContent = isElyz()
    ? "電源につなぐと、両極で何が起きる？"
    : rawStage().choose ? "板を2枚選んで、どちらが溶けるか予想しよう"
    : "どちらの板が溶ける？ — 板をタップして予想しよう";
  stageTitleEl.innerHTML = `<strong>${stageLabel(stageIdx)}</strong>`;
  drawCell();
  buildHalfSheet();
  updateETally();
  layoutRun();          // 粒を片づける（drawCell が particleLayer を作り直した直後に呼ぶ）
  ionCountsEl.innerHTML = "";
  clearEl.hidden = true;
  calcSheetEl.innerHTML = "";
  revealStep(stepSumEl, false);
  refreshSteps();
  setPredictMsg(rawStage().intro, "info");
  // まだ何も起きていないので、応答の枠ごと空にする（空の枠に 💡 だけが出るのを避ける）
  msgEl.className = "";
  msgEl.textContent = "";
  updateToolbar();
}

/* ステージを開き直す（板の選択も白紙に戻す） */
function initStage() {
  picked = [null, null];
  resetRound();
}

/* テスト・監査用フック（redox / condition と同じ流儀）。
   advance(ms) で時間を決定論的に進めるので、待ち時間やタイマーに依存せず検査できる。 */
window.BatteryEq = {
  advance(ms) {
    let remaining = ms;
    while (remaining > 0) {
      const chunk = Math.min(1000, remaining);
      tick(lastT + chunk);
      remaining -= chunk;
    }
  },
  predict(metal) { predict(metal); return guessOk; },
  setMult(a, b) { mult = [a, b]; onMultChange(); },
  play() { isElyz() ? playElyz() : play(); },
  /* b2 の電極パレット用（第4歩）。画面のタップと同じ道を通す */
  goStage(id) {
    const i = CELL_STAGES.findIndex((s) => s.id === id);
    if (i < 0) return false;
    stageIdx = i; initStage(); return true;
  },
  pick(m) { pickMetal(m); return [...picked]; },
  clearSlot(i) { clearSlot(i); return [...picked]; },
  state: () => ({
    stageId: rawStage().id,
    kind: rawStage().kind,
    choose: !!rawStage().choose,
    picked: [...picked],
    metals: [...metalsOf()],
    // パレットで押せる金属／押せない金属（§0 の「候補に出さない」が効いているかを見る口）
    palette: [...paletteEl.querySelectorAll(".palMetal")].map((b) => ({
      metal: b.dataset.metal, disabled: !!b.disabled,
    })),
    discovery: discoveryEl.hidden ? "" : discoveryEl.textContent.replace(/\s+/g, " ").trim(),
    reason: pair().reason || null,
    lampDead: !!cellSvg.querySelector("#lampDead"),
    guess, guessTries, guessOk,
    neg: pair().neg, pos: pair().pos,
    halves: [halves().ox || null, halves().red || null],
    // いま画面に出ている呼び名（電池なら負極/正極、電気分解なら陽極/陰極）
    terms: { ox: terms().ox, red: terms().red, oxTag: terms().oxTag, redTag: terms().redTag },
    // 半反応式の行の札。用語の出し分けが実際に効いているかを DOM から見る
    halfTags: ["halfNeg", "halfPos"].map((id) => {
      const r = document.getElementById(id);
      const k = r && r.querySelector(".kindTag");
      return k ? k.textContent : "";
    }),
    eTally: eTallyEl.textContent.replace(/\s+/g, " ").trim(),
    powerShown: !!cellSvg.querySelector("#powerSupply"),
    gas: particles.filter((x) => x.kind === "gas")
      .reduce((m, x) => (m[x.sp] = (m[x.sp] || 0) + 1, m), {}),
    mult: [...mult],
    answer: rstage() ? [...rstage().answer] : null,
    cell: cellNotation(stage()),
    phase, cleared, released, deposited,
    poolE: arrivedE.length,
    flyingE: particles.filter((x) => x.kind === "e" && x.seg < x.path.length - 1).length,
    waiting: [...new Set(particles.filter((x) => x.kind === "wait").map((x) => x.unit))].length,
    counts: particles.reduce((m, x) => (m[x.kind] = (m[x.kind] || 0) + 1, m), {}),
    // e⁻ の座標。ワープしていないことを時間で追って確かめるための口
    epos: particles.filter((x) => x.sp === "e-")
      .map((x) => ({ id: x.id, x: Math.round(x.x * 10) / 10, y: Math.round(x.y * 10) / 10, seg: x.seg })),
    halvesShown: !stepHalvesEl.hidden,
    sumShown: !stepSumEl.hidden,
    playDisabled: !!(document.getElementById("playBtn") || {}).disabled,
    predictMsg: predictMsgEl.textContent,
    msg: msgEl.textContent,
    ionic: (() => {
      const r = document.getElementById("sumIonic");
      return r ? r.textContent.replace(/\s+/g, " ").trim() : "";
    })(),
    cellShown: (document.getElementById("cellNotation") || {}).textContent || "",
    clearShown: !clearEl.hidden,
    // 役の札は予想するまで画面に出ていないこと（答えの先出しを見張る）
    roleLabels: [...cellSvg.querySelectorAll("text")].map((t) => t.textContent)
      .filter((s) => s.includes("負極") || s.includes("正極") ||
        s.includes("陽極") || s.includes("陰極")),
    // 図の中の文字すべて（用語が混ざっていないかを見る）
    svgText: [...cellSvg.querySelectorAll("text")].map((t) => t.textContent).join(" "),
  }),
};

initStage();
requestAnimationFrame(frame);

})();
