"use strict";
/* redox.js — 酸化還元モード（DESIGN_redox.md）。
   半反応式を部品として見せ、倍率 ×a・×b を合わせて e⁻ の授受をそろえる。
   判定は個数（e⁻ プール・待ちイオン・析出数）のみで行い、座標は見た目専用。 */
(() => {

const SVG_NS = "http://www.w3.org/2000/svg";

const beakerSvg   = document.getElementById("beaker");
const toolbarEl   = document.getElementById("toolbar");
const ionCountsEl = document.getElementById("ionCounts");
const msgEl       = document.getElementById("msg");
const calcSheetEl = document.getElementById("calcSheet");
const halfSheetEl = document.getElementById("halfSheet");
const stepCalcEl  = document.getElementById("stepCalc");
const stepCleaveEl = document.getElementById("stepCleave");
const cleaveSheetEl = document.getElementById("cleaveSheet");
const cleaveMsgEl = document.getElementById("cleaveMsg");
const eTallyEl    = document.getElementById("eTally");
const clearEl     = document.getElementById("clearBanner");
const stageNavEl  = document.getElementById("stageNav");
const stageTitleEl = document.getElementById("stageTitle");
/* 自由組み立てモード（?free=1）の段0。通常の入口では一切出てこない */
const step1El     = document.getElementById("step1");
const step2El     = document.getElementById("step2");
const stepPickEl  = document.getElementById("stepPick");
const pickOxEl    = document.getElementById("pickOx");
const pickRedEl   = document.getElementById("pickRed");
const pickOxNoteEl  = document.getElementById("pickOxNote");
const pickRedNoteEl = document.getElementById("pickRedNote");
const pickCondEl    = document.getElementById("pickCond");
const pickCondNoteEl = document.getElementById("pickCondNote");
const pickGoEl    = document.getElementById("pickGo");
const pickMsgEl   = document.getElementById("pickMsg");
const pickBridgeEl = document.getElementById("pickBridge");
const pickWhyEl   = document.getElementById("pickWhy");

const WATER = { x: 55, y: 145, w: 370, h: 245 };
const PLATE = { x: 85, y: 160, w: 26, h: 210 };
/* 生成後に泡となって水面へ逃げる気体（酸化・還元どちらの生成物でも扱う） */
const BUBBLE_SP = new Set(["H2", "CO2", "O2", "SO2", "NO", "NO2"]);

const RSTYLE = {
  "Zn":    { color: "#7d8ea0", r: 16 },
  "Zn^2+": { color: "#5d7d9d", r: 16 },
  "Cu":    { color: "#c47a3c", r: 16 },
  "Cu^2+": { color: "#4a90d9", r: 17 },
  "Ag":    { color: "#c9ced6", r: 16, darkText: true },
  "Ag+":   { color: "#8f9aa8", r: 16 },
  "H+":    { color: "#d95757", r: 14 },
  "H2":    { color: "#e4f2f7", r: 15, darkText: true },
  "e-":    { color: "#f2c14e", r: 8, darkText: true },
  "Mg":    { color: "#9bb08f", r: 16 },
  "Mg^2+": { color: "#7d947f", r: 16 },
  "Fe":    { color: "#8a6d5a", r: 16 },
  "Fe^2+": { color: "#a98467", r: 16 },
  "Al":    { color: "#b8c4d2", r: 16, darkText: true },
  "Al^3+": { color: "#7189a6", r: 16 },
  // 溶液中の酸化還元（色は SPECIES_COLOR を優先。ここは半径と暗字フラグ）
  "MnO4-":    { color: "#7b2fb0", r: 19 },
  "Mn^2+":    { color: "#f0e6f3", r: 16, darkText: true },
  /* 中性・塩基性で MnO₄⁻ が行き着く先（M6-D）。黒褐色の固体なので暗い色にする。
     溶液の色（SOLUTION_TINT）には入れない ＝ 溶けているのではなく濁るので、
     液そのものではなく粒として見せる。紫が消えることは MnO₄⁻ が減ることで出る。 */
  "MnO2":     { color: "#4a3226", r: 17 },
  "OH-":      { color: "#5fa3a0", r: 15 },
  "Cr2O7^2-": { color: "#e0842a", r: 19 },
  "Cr^3+":    { color: "#3f9d5a", r: 16 },
  "Fe^3+":    { color: "#c79a3a", r: 16 },
  "H2O":      { color: "#c2e2f4", r: 14, darkText: true },
  "C2O4^2-":  { color: "#b7c0c8", r: 18, darkText: true },
  "CO2":      { color: "#e4f2f7", r: 15, darkText: true },
  "NO3-":     { color: "#4f9fae", r: 20 },
  "NO":       { color: "#eef2f5", r: 15, darkText: true },
  "NO2":      { color: "#b4611f", r: 16 },
  // 硫黄まわり（M6-F）。SO₂ は刺激臭の気体なので泡になって出ていく（BUBBLE_SP）
  "H2SO4":    { color: "#d8c98e", r: 20, darkText: true },
  "SO2":      { color: "#e9dc9a", r: 17, darkText: true },
  // ビーカーには出ないが、イオン反応式→化学反応式の図で生成物として描く分子・塩
  "HNO3":     { color: "#e6c6a4", r: 16, darkText: true },
  "Cu(NO3)2": { color: "#5a9fd4", r: 16 },
  // 有機（アルコールの酸化）。名前が長いので粒を大きめに取る
  "C2H5OH":   { color: "#cfd8e3", r: 27, darkText: true },
  "CH3CHO":   { color: "#d7e2cd", r: 25, darkText: true },
  "CH3COOH":  { color: "#e8ddc6", r: 27, darkText: true },
  "C3H7OH":   { color: "#cfd8e3", r: 33, darkText: true },
  "CH3COCH3": { color: "#d7e2cd", r: 28, darkText: true },
  // ヨードホルム反応。ヨードホルムは黄色（沈殿の色）
  "I2":       { color: "#7a4b8c", r: 17 },
  "I-":       { color: "#b48ac4", r: 15 },
  "CH3COCI3": { color: "#cdbfa0", r: 30, darkText: true },
  "CI3CHO":   { color: "#cdbfa0", r: 27, darkText: true },
  "CHI3":     { color: "#f0d65a", r: 20, darkText: true },
  "CH3COO-":  { color: "#e8ddc6", r: 26, darkText: true },
  "HCOO-":    { color: "#e8ddc6", r: 22, darkText: true },
};

let stageIdx = 0;
/* 自由組み立てモードで選んだ組み合わせ（composeStage が実行時に組み立てたステージ）。
   null なら通常どおり収録ステージを開いている。**既存エンジンは
   { ox, red, answer, mode } の形しか見ていない**ので、差し替えるのはここ1点だけで済む
   （DESIGN_redox_matching.md §3-2）。 */
let freeStage = null;
/* 自由モードで「まだ組み合わせが決まっていない」あいだ true。
   段1以降を出さないための状態で、**収録ステージへ戻ったら false になる**
   （?free=1 のまま帯からステージへ跳んでも、そこは従来どおり最後まで解ける）。 */
let freeIdle = false;
let mult = [1, 1];          // [酸化×a, 還元×b]
let particles = [];
let nextId = 1;
let poolE = [];             // 板の上にたまった e⁻
let poolTotal = 0;
let units = [];             // 還元の1単位 = {ions, need, mx, my, arrived, eArrived, waiting, resolved}
let deposited = 0;
let escaped = {};
let phase = "idle";         // idle | running | done
let soloMode = null;        // null=足し合わせ | "ox"=酸化単体 | "red"=還元単体
let runExact = false;
let cleared = false;
let simTime = 0;
let events = [];
let particleLayer = null;

const rnd = (a, b) => a + Math.random() * (b - a);

function mk(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  (parent || beakerSvg).appendChild(el);
  return el;
}

function schedule(delay, fn) {
  events.push({ at: simTime + delay, fn });
}

function stage() { return freeStage || REDOX_STAGES[stageIdx]; }
function oxHR() { return HALF_REACTIONS[stage().ox]; }
function redHR() { return HALF_REACTIONS[stage().red]; }
/* 溶液中モード（板なし・両者溶液中の浮遊粒・色変化）。既定は金属モード */
function isSolution() { return stage().mode === "solution"; }
/* 酸化側の源となる種（左辺の非 e⁻ 項。金属モードでは板の金属、溶液モードでは還元剤イオン） */
function oxMetal() { return oxHR().left.find((t) => t.sp !== "e-").sp; }
function oxIonSp() { return oxHR().right.find((t) => t.sp !== "e-").sp; }
/* この種の描画色（溶液モードでは有色種の実際の色を優先） */
function colorOf(sp) {
  if (typeof SPECIES_COLOR !== "undefined" && SPECIES_COLOR[sp]) return SPECIES_COLOR[sp];
  return (RSTYLE[sp] || {}).color || "#8a8f98";
}

/* ---- 酸化数表示（変化する原子だけ、円の中に） ---- */

function fmtOx(v) { return v > 0 ? "+" + v : String(v); }

function stageOxChanges() {
  return [...oxChangeOfHalf(oxHR()), ...oxChangeOfHalf(redHR())];
}

/* この種で酸化数を表示すべきなら { el, text, at } を返す。
   多原子イオン（NO₃⁻）でも有機（エタノールの2つの C）でも**どの原子の話か**が肝心なので、
   元素と、化学式の中での位置まで持って返す。
   変化に関わっていない値（傍観の O など）には出さない。 */
function oxAtomFor(sp) {
  if (sp === "e-") return null;
  const ox = OXIDATION[sp];
  if (!ox) return null;
  for (const c of stageOxChanges()) {
    const v = ox[c.el];
    if (v === undefined || !SPECIES[sp].atoms[c.el]) continue;
    if (Array.isArray(v)) {
      // 原子ごとに違う値。変化の前後どちらかに一致する原子を選ぶ
      const hit = v.find((a) => a.ox === c.from || a.ox === c.to);
      if (hit) return { el: c.el, text: fmtOx(hit.ox), at: hit.at };
      continue;
    }
    if (v !== c.from && v !== c.to) continue;
    return { el: c.el, text: fmtOx(v) };
  }
  return null;
}

/* この種を円内酸化数つきで描くべきなら表示文字列、そうでなければ null */
function oxLabelFor(sp) {
  const a = oxAtomFor(sp);
  return a ? a.text : null;
}

/* ---- 描画 ---- */

let solutionRect = null;

function drawBeakerStatic() {
  beakerSvg.innerHTML = "";
  solutionRect = mk("rect", { x: 49, y: WATER.y, width: 382, height: 250, rx: 8, fill: "#eaf5fc" });
  mk("line", { x1: 49, y1: WATER.y, x2: 431, y2: WATER.y, stroke: "#a9cfe4", "stroke-width": 2 });
  mk("path", {
    d: "M 45 75 L 45 385 Q 45 410 70 410 L 410 410 Q 435 410 435 385 L 435 75",
    fill: "none", stroke: "#7c8792", "stroke-width": 4, "stroke-linecap": "round",
  });
  if (!isSolution()) {
    // 金属板（溶液モードでは板なし）
    mk("rect", { x: PLATE.x, y: PLATE.y - 40, width: PLATE.w, height: PLATE.h + 40, rx: 4, fill: "#aeb6bf", stroke: "#7c8792", "stroke-width": 2 });
    const label = mk("text", { x: PLATE.x + PLATE.w / 2, y: PLATE.y - 48, "text-anchor": "middle", "font-size": 13, "font-weight": "bold", fill: "#4a5560" });
    label.textContent = SPECIES[oxMetal()].disp + "板";
  }
}

/* 溶液全体の色を、いま溶けている有色種の量で重み付けブレンドして更新する。
   反応が進むと酸化剤の色（MnO₄⁻紫・Cr₂O₇²⁻橙）が消え、有色の生成物（Cr³⁺緑）の色に移る。
   MnO₄⁻→Mn²⁺ はほぼ無色に、Cr₂O₇²⁻→Cr³⁺ は橙→緑、が自然に出る。 */
/* 溶液を強く着色する種のみ（Fe²⁺/Fe³⁺・Mn²⁺ は淡いので溶液色には数えない）。
   これで MnO₄⁻→Mn²⁺ は紫→無色、Cr₂O₇²⁻→Cr³⁺ は橙→緑、が自然に出る。 */
const SOLUTION_TINT = {
  "MnO4-":    ["#7b2fb0", 1.0],
  "Cr2O7^2-": ["#e0842a", 1.0],
  "Cr^3+":    ["#3f9d5a", 0.7],
};
function hexRGB(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function updateSolutionColor() {
  if (!solutionRect || !isSolution()) return;
  const counts = {};
  for (const p of particles) if (!p.dead) counts[p.sp] = (counts[p.sp] || 0) + 1;
  let r = 0, g = 0, b = 0, wsum = 0;
  for (const sp of Object.keys(SOLUTION_TINT)) {
    const n = counts[sp] || 0;
    if (!n) continue;
    const [hex, wt] = SOLUTION_TINT[sp];
    const w = wt * n;
    const [cr, cg, cb] = hexRGB(hex);
    r += cr * w; g += cg * w; b += cb * w; wsum += w;
  }
  if (wsum <= 0) { solutionRect.setAttribute("fill", "#eaf5fc"); return; }
  const avg = "#" + [r, g, b].map((v) => Math.round(v / wsum).toString(16).padStart(2, "0")).join("");
  // 濃さ: 溶けている有色種の重み合計で 0.25〜0.72 に（初期の酸化剤単位数で正規化）
  const frac = Math.min(1, wsum / Math.max(1, mult[1]));
  solutionRect.setAttribute("fill", mixColor("#eaf5fc", avg, 0.25 + 0.47 * frac));
}

/* 2色を t の割合で混ぜる（0=c1, 1=c2） */
function mixColor(c1, c2, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = p(c1), [r2, g2, b2] = p(c2);
  const h = (v) => Math.round(v).toString(16).padStart(2, "0");
  return "#" + h(r1 + (r2 - r1) * t) + h(g1 + (g2 - g1) * t) + h(b1 + (b2 - b1) * t);
}

function makeParticleEl(p) {
  const st = RSTYLE[p.sp] || { color: "#8a8f98", r: 16 };
  const g = mk("g", { class: "particle" }, particleLayer);
  mk("circle", { r: p.r, fill: colorOf(p.sp), stroke: "rgba(0,0,0,.25)", "stroke-width": 1.5 }, g);
  const disp = SPECIES[p.sp].disp;
  const oxAt = oxAtomFor(p.sp);
  const label = mk("text", {
    y: oxAt ? -1.5 : (p.sp === "e-" ? 3 : 4.5), "text-anchor": "middle",
    "font-size": p.sp === "e-" ? 8 : (disp.length > 8 ? 8.5 : disp.length > 3 ? 10 : 12),
    fill: st.darkText ? "#3a4a55" : "#fff", "font-weight": "bold",
  }, g);
  if (oxAt) {
    // 多原子イオンでは酸化数を**その原子の真下**に置き、原子には下線を引く。
    // 化学式の真ん中に数字を置くと、NO₃⁻ の +5 が O の話に見えてしまう
    const at = oxAt.at !== undefined ? oxAt.at : disp.indexOf(oxAt.el);
    const parts = at < 0 ? [disp, "", ""] : [disp.slice(0, at), oxAt.el, disp.slice(at + oxAt.el.length)];
    const spans = parts.map((txt) => {
      const ts = mk("tspan", {}, label);
      ts.textContent = txt;
      return ts;
    });
    const sub = st.darkText ? "#5a6570" : "rgba(255,255,255,.92)";
    const anchor = spans[1].textContent ? spans[1] : label;
    const bb = anchor.getBBox();
    const cx = bb.x + bb.width / 2;
    mk("line", {
      x1: bb.x - 0.5, y1: 2.5, x2: bb.x + bb.width + 0.5, y2: 2.5,
      stroke: sub, "stroke-width": 1.4, "stroke-linecap": "round",
    }, g);
    const ot = mk("text", {
      x: cx, y: 12, "text-anchor": "middle", "font-size": 8.5,
      fill: sub, "font-weight": "bold",
    }, g);
    ot.textContent = oxAt.text;
  } else {
    label.textContent = disp;
  }
  const c = SPECIES[p.sp].charge;
  if (c !== 0 && p.sp !== "e-") {
    const btxt = (Math.abs(c) > 1 ? String(Math.abs(c)) : "") + (c > 0 ? "+" : "−");
    const bx = p.r * 0.85, by = -p.r * 0.85;
    mk("circle", { cx: bx, cy: by, r: 8, fill: "#fff", stroke: st.color, "stroke-width": 1.5 }, g);
    const bt = mk("text", { x: bx, y: by + 3.5, "text-anchor": "middle", "font-size": 10, fill: "#333", "font-weight": "bold" }, g);
    bt.textContent = btxt;
  }
  return g;
}

/* 描く円の半径。酸化数を円内に書く粒はひと回り大きくして2行を収める。
   並べ方を先に決めるとき（対向整列）に、粒を作る前から大きさが要る */
function spRadius(sp) {
  return (RSTYLE[sp] || { r: 16 }).r + (oxLabelFor(sp) !== null ? 3 : 0);
}

function spawnParticle(sp, x, y, mode) {
  const p = {
    id: nextId++, sp, x, y, vx: rnd(-30, 30), vy: rnd(-20, 20),
    r: spRadius(sp),
    mode, dead: false, born: performance.now(),
  };
  p.el = makeParticleEl(p);
  particles.push(p);
  return p;
}

function removeParticle(p) {
  p.dead = true;
  particles = particles.filter((o) => o !== p);
  if (p.el) p.el.remove();
}

function splash(x, y) {
  const c = mk("circle", { cx: x, cy: y, r: 14, fill: "none", stroke: "#79b8d8", "stroke-width": 2.5, class: "splash" }, particleLayer);
  setTimeout(() => c.remove(), 500);
}

/* 酸化数が変化した瞬間の強調（黄色いリング） */
function oxFlash(x, y) {
  const c = mk("circle", { cx: x, cy: y, r: 17, fill: "none", stroke: "#f2c14e", "stroke-width": 3, class: "splash" }, particleLayer);
  setTimeout(() => c.remove(), 500);
}

/* kind は "ok"（そろった）／"ng"（過不足・進めない）／"info"（案内・途中経過。既定）。
   見た目は schematic.js の setStatusMsg が付ける（3モードで同じ流儀にする） */
function setMsg(t, kind) { setStatusMsg(msgEl, t, kind); }

/* ---- レイアウト（倍率に連動） ---- */

/* 板の未反応原子は**水中の上下方向の中央**に集める。上から詰めると、
   倍率を上げたときに板より下（水の外）まではみ出してしまっていた。
   数が増えたら間隔を詰めて、板の中に収める。 */
let plateStep = 36;
function plateAtomPos(i, n) {
  const span = PLATE.h - 52;
  plateStep = n > 1 ? Math.min(36, span / (n - 1)) : 0;
  const first = PLATE.y + PLATE.h / 2 - plateStep * (n - 1) / 2;
  return { x: PLATE.x + PLATE.w - 2, y: first + i * plateStep };
}

/* ---- 溶液モードの対向整列 ----
   板が無い反応（MnO₄⁻×Fe²⁺・Cr₂O₇²⁻×Fe²⁺・アルコールの酸化・ヨードホルム）では、
   両者をビーカー中に漂わせていた。粒が入り混じるので、**どの粒が e⁻ を出して
   どの粒が受け取ったのか**が混雑にまぎれて追えない。
   そこで、還元剤（e⁻ を出す側）を左列・酸化剤（受け取る側）を右列に向かい合わせ、
   あいだを e⁻ の通り道にする。e⁻ は「左 → 通り道 → 右」と必ず右向きに流れるので、
   模式図（左＝出す・右＝受け取る）とビーカーの絵が同じ向きで読める。 */
const SOL_LEFT_X  = WATER.x + 44;                 //  99 … 還元剤の列
const SOL_LANE_X  = WATER.x + WATER.w * 0.40;     // 203 … 出た e⁻ が並ぶ通り道
const SOL_RIGHT_X = WATER.x + WATER.w * 0.60;     // 277 … 酸化剤の列

/* 半反応式1回ぶんの粒の並び（4個で折り返す）。左右で同じ流儀にそろえる。
   間隔は溶液モードだけ粒の大きさから取る（有機の分子は円が大きく、22px では重なって読めない）。
   板があるモードは従来どおり詰めて置く — こちらは泳いで集まる動きで粒を見分けられる。 */
function cellPlan(radii) {
  const n = radii.length;
  const cols = Math.min(4, n);
  const rows = Math.ceil(n / cols);
  const maxR = Math.max(...radii);
  const step = isSolution() ? Math.max(22, maxR + 7) : 22;
  return { cols, step, maxR, w: (cols - 1) * step, h: (rows - 1) * step };
}
function cellPos(plan, i, mx, my) {
  return { x: mx + (i % plan.cols) * plan.step, y: my + Math.floor(i / plan.cols) * plan.step };
}

/* n 個のかたまりを水の高さいっぱいに縦へ配る（板モードの plateAtomPos と同じ考え方）。
   上下の余白は**いちばん大きな円の半径**から取る。ここを固定値にすると、
   2-プロパノールのように円の大きい分子が水面より上へ出てしまう。
   数が増えたら間隔を詰めて、必ず水の中に収める。 */
function solSlotPos(i, n, x0, cell) {
  const span = Math.max(0, WATER.h - 2 * cell.maxR - 12 - cell.h);
  // かたまりの高さぶんを空ければ隣とぶつからない。入りきらないときだけ詰める
  const want = Math.min(56 + cell.h, span);
  const step = n > 1 ? Math.min(want, span / (n - 1)) : 0;
  const top = WATER.y + WATER.h / 2 - (step * (n - 1) + cell.h) / 2;
  return { x: x0, y: top + i * step };
}

/* 半反応式の左辺（e⁻ を除く）を、個数ぶん展開した種の配列にする */
function expandTerms(terms) {
  const out = [];
  for (const t of terms) for (let k = 0; k < t.n; k++) out.push(t.sp);
  return out;
}

function poolSlotPos(k) {
  // 溶液モードは板が無い。左右のあいだの「通り道」に上から並べる
  if (isSolution()) {
    const per = 10, col = Math.floor(k / per), row = k % per;
    return { x: SOL_LANE_X + col * 15, y: WATER.y + 26 + row * 18 };
  }
  return { x: PLATE.x + 13, y: PLATE.y + PLATE.h - 14 - k * 18 };
}
function depositPos(d) {
  return { x: PLATE.x + PLATE.w + 10, y: PLATE.y + PLATE.h - 16 - d * 26 };
}

function layoutLab() {
  drawBeakerStatic();
  particleLayer = mk("g", {});
  particles = [];
  poolE = []; poolTotal = 0;
  units = []; deposited = 0; escaped = {};
  phase = "idle"; runExact = false;
  simTime = 0; events = [];
  const a = mult[0], b = mult[1];
  const sol = isSolution();
  const oxSps = expandTerms(oxHR().left.filter((t) => t.sp !== "e-"));
  const ionTerms = redHR().left.filter((t) => t.sp !== "e-");
  const redSps = expandTerms(ionTerms);
  // 溶液モードは半反応式1回ぶんをひとかたまりにして、左右の列に向かい合わせて置く
  const oxCell = cellPlan(oxSps.map(spRadius));
  const redCell = cellPlan(redSps.map(spRadius));
  const nOx = soloMode === "red" ? 0 : a;
  const nRed = soloMode === "ox" ? 0 : b;
  // 酸化側: 金属モードは板の縁に金属原子 a 個、溶液モードは還元剤を左列に a 組
  for (let i = 0; i < nOx; i++) {
    if (sol) {
      const s = solSlotPos(i, nOx, SOL_LEFT_X, oxCell);
      const c0 = cellPos(oxCell, 0, s.x, s.y);
      const p = spawnParticle(oxMetal(), c0.x, c0.y, "oxSource");
      p.still = true;
      // 酸化の左辺にある他の反応物（ヨード化の I⁻ など）も同じかたまりに置く。
      // 1つの酸化と同時に消費されるので、この粒に紐づけておく
      p.co = [];
      for (let k = 1; k < oxSps.length; k++) {
        const c = cellPos(oxCell, k, s.x, s.y);
        const q = spawnParticle(oxSps[k], c.x, c.y, "float");
        q.still = true;
        p.co.push(q);
      }
    } else {
      const pos = plateAtomPos(i, a);
      spawnParticle(oxMetal(), pos.x, pos.y, "plateAtom");
    }
  }
  // 還元単体: e⁻ をあらかじめストック（電池なら導線の向こうから来るぶん）
  const need = electronsOf(redHR());
  if (soloMode === "red") {
    for (let k = 0; k < need * b; k++) {
      const pos = poolSlotPos(poolTotal++);
      const e = spawnParticle("e-", pos.x, pos.y, "pool");
      poolE.push(e);
    }
  }
  // 還元側: b 単位ぶんの酸化剤（溶液モードは MnO₄⁻ ＋ 8H⁺ など。左辺の非 e⁻ 項すべて）
  for (let u = 0; u < nRed; u++) {
    const s = sol ? solSlotPos(u, nRed, SOL_RIGHT_X, redCell) : null;
    const unit = {
      ions: [], need,
      mx: sol ? s.x : PLATE.x + PLATE.w + 52,
      my: sol ? s.y : PLATE.y + 40 + u * 46,
      arrived: 0, eArrived: 0, waiting: false, resolved: false, reserved: null, pendingE: false,
    };
    redSps.forEach((sp, i) => {
      let p;
      if (sol) {
        // 溶液モードは最初から整列位置に置く（泳がせず、対向のかたちを最初から見せる）
        const c = cellPos(redCell, i, unit.mx, unit.my);
        p = spawnParticle(sp, c.x, c.y, "float");
        p.still = true;
      } else {
        p = spawnParticle(sp, rnd(PLATE.x + PLATE.w + 90, WATER.x + WATER.w - 40),
          rnd(WATER.y + 40, WATER.y + WATER.h - 40), "float");
      }
      p.unit = unit;
      unit.ions.push(p);
    });
    units.push(unit);
  }
  updateSolutionColor();
  refreshHUD();
}

/* ---- アニメーション本体 ---- */

function play() {
  if (phase !== "idle") {
    setMsg("「↺ やり直す」か倍率の変更でリセットしてから、もう一度押そう。", "ng");
    return;
  }
  phase = "running";
  cleared = false;
  const atoms = particles.filter((p) => p.mode === "plateAtom" || p.mode === "oxSource");
  if (soloMode === "ox") {
    setMsg(`【還元剤だけ】${SPECIES[oxMetal()].disp} が e⁻ を置いて ${SPECIES[oxIonSp()].disp} になり、溶け出す…`);
    atoms.forEach((atom, i) => schedule(i * 0.9, () => oxidizeAtom(atom)));
    schedule(atoms.length * 0.9 + 1.6, () => {
      phase = "done";
      setMsg(`還元剤の半反応（酸化される側）: ${SPECIES[oxMetal()].disp} ${atoms.length}個が e⁻ を合計 ${electronsOf(oxHR()) * atoms.length}個 板に置き、` +
        `${SPECIES[oxIonSp()].disp} になって溶け出した。この e⁻ を受け取るのが酸化剤。`);
    });
    return;
  }
  if (soloMode === "red") {
    startReduction();
    return;
  }
  setMsg(isSolution()
    ? `${SPECIES[oxMetal()].disp} が e⁻ を出して ${SPECIES[oxIonSp()].disp} になる…`
    : `${SPECIES[oxMetal()].disp} が e⁻ を置いて ${SPECIES[oxIonSp()].disp} になり、溶け出す…`);
  atoms.forEach((atom, i) => schedule(i * (isSolution() ? 0.5 : 0.9), () => oxidizeAtom(atom)));
  schedule(atoms.length * (isSolution() ? 0.5 : 0.9) + 1.2, () => startReduction());
}

function playSolo(kind) {
  soloMode = kind;
  cleared = false;
  clearEl.hidden = true;
  layoutLab();
  play();
}

function oxidizeAtom(atom) {
  const eN = electronsOf(oxHR());
  // 置いていかれた e⁻ は**原子が元いた場所にそのまま留まる**（共通プールへ飛ばさない）。
  // どの原子が何個置いていったかが位置で分かり、余った e⁻ もその場に残る。
  // 溶液モードは板が無いので、左右のあいだの通り道へ**右向きに**渡していく
  const spread = Math.min(17, Math.max(9, plateStep / 2));
  for (let j = 0; j < eN; j++) {
    if (isSolution()) {
      // 同じ点から出すと重なって何個出たのか分からない。縦に少しずらして出す
      const e = spawnParticle("e-", atom.x, atom.y + (j - (eN - 1) / 2) * 11, "eToPool");
      const slot = poolSlotPos(poolTotal++);
      e.tx = slot.x; e.ty = slot.y;
    } else {
      const e = spawnParticle("e-", PLATE.x + PLATE.w / 2, atom.y + (j - (eN - 1) / 2) * spread, "pool");
      poolE.push(e);
      poolTotal++;
    }
  }
  const { x, y } = atom;
  (atom.co || []).forEach(removeParticle);   // 一緒に消費される反応物（I⁻ など）
  removeParticle(atom);
  oxFlash(x, y);
  // 酸化生成物（金属イオン1個 / シュウ酸なら CO₂ の泡が2個、のように複数・気体もあり）
  for (const t of oxHR().right.filter((t) => t.sp !== "e-")) {
    for (let k = 0; k < t.n; k++) {
      if (BUBBLE_SP.has(t.sp)) {
        const bub = spawnParticle(t.sp, x + rnd(-8, 8), y, "bubble");
        bub.vx = 0; bub.vy = -30;
      } else {
        const ion = spawnParticle(t.sp, x, y, "pop");
        ion.vx = isSolution() ? rnd(-50, -10) : 90;
        ion.vy = rnd(-20, 20);
        // 溶液モードでは生成物を**通り道より左**に留める。
        // 右へ流れていくと、これから渡る e⁻ の道筋に重なって授受が見えなくなる
        if (isSolution()) ion.maxX = SOL_LANE_X - 14;
      }
    }
  }
  refreshHUD();
}

function startReduction() {
  const redIonDisp = redHR().left.find((t) => t.sp !== "e-").sp;
  setMsg(isSolution()
    ? `${SPECIES[redIonDisp].disp} が、渡ってきた e⁻ を受け取る…`
    : `${SPECIES[redIonDisp].disp} が板へ近づき、e⁻ を受け取る…`);
  units.forEach((u, i) => schedule(i * 1.2, () => sendUnit(u)));
}

function sendUnit(unit) {
  // 受け取る e⁻ を先に予約し、**その e⁻ のすぐ隣**を集合地点にする。
  // こうするとイオンが「板の上の e⁻ をめがけて泳ぐ」動きになり、
  // どの e⁻ を受け取りに行ったのかが目で追える
  // 予約するのは板があるモードだけ。溶液モードの e⁻ は集合場所へ泳いでいる途中で、
  // この時点ではまだ poolE に入っていないことがある（入っていなければ予約せず、
  // 従来どおり processUnit で取りに行く）
  if (!isSolution() && poolE.length >= unit.need) {
    unit.reserved = poolE.splice(0, unit.need);
    const ey = unit.reserved.reduce((sum, e) => sum + e.y, 0) / unit.need;
    unit.mx = PLATE.x + PLATE.w + 40;
    unit.my = Math.min(Math.max(ey, WATER.y + 40), WATER.y + WATER.h - 60);
  }
  // 集合地点にコンパクトなグリッドで寄せる（H⁺ を含む多粒の単位でもビーカー内に収まるよう）。
  // 溶液モードは layoutLab で既にこの位置に置いてあるので、その場で待つ形になる
  const plan = cellPlan(unit.ions.map((p) => p.r));
  unit.ions.forEach((p, i) => {
    p.mode = "swim";
    const c = cellPos(plan, i, unit.mx, unit.my);
    p.tx = c.x; p.ty = c.y;
  });
}

/* まだ集合場所へ泳いでいる途中の e⁻ があるか（溶液モードだけ。板があるモードの e⁻ は
   置かれた瞬間に poolE に入るので、この状態は起こらない） */
function eStillComing() {
  return particles.some((p) => !p.dead && p.mode === "eToPool");
}

/* final=true なら「もう e⁻ は来ない」ことが分かっている呼び出し。
   足りなければその場で待ちぼうけを確定させる。 */
function processUnit(unit, final) {
  let taken = unit.reserved;
  unit.reserved = null;
  if (!taken && poolE.length >= unit.need) taken = poolE.splice(0, unit.need);
  if (taken) {
    unit.pendingE = false;
    taken.forEach((e, i) => {
      e.mode = "eToIon";
      e.tx = unit.mx - 14 + i * 8;
      e.ty = unit.my + 14;
      e.unit = unit;
    });
  } else if (!final && eStillComing()) {
    /* 溶液モードでは e⁻ は集合場所へ**泳いでいる途中**なので、イオンのほうが先に着くことがある。
       ここで待ちぼうけを確定させると、数十 ms 後に届く e⁻ を受け取れないまま終わり、
       倍率は正しいのに「e⁻ が余った」と出てしまう（ri2 で間欠的に起きていた）。
       届くまで保留し、e⁻ が着くたびに serveWaitingUnits() が拾い直す。 */
    unit.pendingE = true;
  } else {
    unit.pendingE = false;
    unit.waiting = true;
    unit.resolved = true;
    unit.ions.forEach((p) => p.el.classList.add("waiting"));
    checkAllResolved();
  }
  refreshHUD();
}

/* e⁻ が1個 poolE に着くたびに呼ぶ。保留中の還元単位を**着いた順**に拾い直し、
   最後の e⁻ が着いてもまだ足りない単位は、そこで待ちぼうけを確定させる（＝必ず終わる）。 */
function serveWaitingUnits() {
  const last = !eStillComing();
  for (const u of units) {
    if (!u.pendingE || u.resolved) continue;
    if (poolE.length >= u.need) processUnit(u);
    else if (last) processUnit(u, true);
    else break;   // 先着順を崩さない（先に待っている単位を追い越さない）
  }
}

/* 板に析出するのは**単体**（元素1種・電荷0）の金属だけ。
   同じ還元でも H₂O のように溶けたまま残る生成物は、板に積まず溶液中に漂わせる
   （銅と硝酸では NO が泡・H₂O が溶液中、と1つの半反応式で行き先が3通りに分かれる）。 */
function isDepositable(sp) {
  const s = SPECIES[sp];
  return !BUBBLE_SP.has(sp) && s.charge === 0 && Object.keys(s.atoms).length === 1;
}

/* 析出した金属は、**反応が起きたその場所から板まで滑って**着地する。
   板の上にいきなり現れる（＝ワープ）と、どのイオンが板のどこに付いたのかが切れてしまい、
   「イオンが e⁻ を受け取って金属になり、板に積もる」という因果が絵から抜け落ちる。
   距離はステージや倍率でまちまちなので、**どこから出ても同じ時間で着く**ように
   速度を距離から決める（着地のタイミングがそろい、遅れて1個だけ残らない）。
   上限・下限で止めるのは、ごく近い/遠い組み合わせで不自然に見えないようにするため。
   所要は checkAllResolved の締め（0.6秒）より短く取り、クリア表示までに着き終える。 */
const DEPOSIT_GLIDE_SEC = 0.45;
function spawnDeposit(sp, x, y, pos) {
  const p = spawnParticle(sp, x, y, "toDeposit");
  p.tx = pos.x; p.ty = pos.y;
  p.vx = 0; p.vy = 0;
  const d = Math.hypot(pos.x - x, pos.y - y);
  p.speed = Math.min(460, Math.max(120, d / DEPOSIT_GLIDE_SEC));
  return p;
}

function transformUnit(unit) {
  const mx = unit.ions.reduce((s, p) => s + p.x, 0) / unit.ions.length;
  const my = unit.ions.reduce((s, p) => s + p.y, 0) / unit.ions.length;
  unit.ions.forEach(removeParticle);
  oxFlash(mx, my);
  for (const t of redHR().right.filter((t) => t.sp !== "e-")) {
    for (let k = 0; k < t.n; k++) {
      if (BUBBLE_SP.has(t.sp)) {
        const bub = spawnParticle(t.sp, mx, my, "bubble");
        bub.vx = 0; bub.vy = -30;
      } else if (isSolution() || !isDepositable(t.sp)) {
        // 溶けたまま残る生成物（Mn²⁺・H₂O など）は溶液中に浮遊。色が変わる（紫→無色）
        const p = spawnParticle(t.sp, mx + rnd(-16, 16), my + rnd(-16, 16), "pop");
        p.vx = rnd(-30, 30); p.vy = rnd(-20, 20);
      } else {
        const pos = depositPos(deposited++);
        spawnDeposit(t.sp, mx + rnd(-6, 6), my + rnd(-6, 6), pos);
      }
    }
  }
  unit.resolved = true;
  updateSolutionColor();
  refreshHUD();
  checkAllResolved();
}

function checkAllResolved() {
  if (units.every((u) => u.resolved)) schedule(0.6, finishRun);
}

function finishRun() {
  phase = "done";
  if (soloMode === "red") {
    const b = mult[1];
    setMsg(`酸化剤の半反応（還元される側）: 用意した e⁻ ${electronsOf(redHR()) * b}個を受け取って反応した。` +
      `電池では、この e⁻ が導線の向こう（還元剤がある極）からやって来る。`);
    refreshHUD();
    return;
  }
  const leftoverE = poolE.length;
  const waiting = units.filter((u) => u.waiting).length;
  const chk = checkRedoxMultipliers(stage(), mult[0], mult[1]);
  if (leftoverE > 0) {
    poolE.forEach((e) => e.el.classList.add("leftoverE"));
    setMsg(`e⁻ が ${leftoverE} 個、板の上に余った！ 電子は水中に残れない。受け取る側（酸化剤）の倍率を増やそう。`, "ng");
  } else if (waiting > 0) {
    setMsg(`e⁻ が足りず、イオンが ${waiting} 組待ちぼうけ。還元剤の倍率を増やすか、酸化剤を減らそう。`, "ng");
  } else {
    runExact = true;
    if (chk.ok) {
      cleared = true;
      setMsg(`ぴったり！ e⁻ を ${chk.give} 個渡して受け取った。倍率 ×${mult[0]}・×${mult[1]} がそのまま係数になる。`, "ok");
      showClear();
    } else {
      setMsg(`反応はぴったり終わったが、${chk.reason}。`, "ng");
    }
  }
  updateSheetTail();
  refreshHUD();
}

function showClear() {
  clearEl.hidden = false;
  clearEl.innerHTML = "";
  const t = document.createElement("div");
  t.textContent = "クリア！ 半反応式の足し合わせが完成した。";
  clearEl.appendChild(t);
  if (stageIdx < REDOX_STAGES.length - 1) {
    const b = document.createElement("button");
    b.textContent = "次のステージへ →";
    b.onclick = () => { stageIdx++; initStage(); };
    clearEl.appendChild(b);
  } else {
    const d = document.createElement("div");
    d.textContent = "酸化還元ステージを全クリア！";
    clearEl.appendChild(d);
  }
}

/* ---- 物理（見た目専用） ---- */

function moveToward(p, dt, speed) {
  const dx = p.tx - p.x, dy = p.ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 5) { p.x = p.tx; p.y = p.ty; return true; }
  p.x += (dx / d) * speed * dt;
  p.y += (dy / d) * speed * dt;
  return false;
}

/* 粒子がめり込まないように押し離す（位置補正のみ・見た目専用） */
function separateParticles() {
  const movers = particles.filter((p) => !p.still && (p.mode === "float" || p.mode === "pop" || p.mode === "oxSource"));
  // 滑っている途中の析出粒も「よけられる側」に入れる。着地の瞬間にだけ押しのけると、
  // そこに居合わせた粒が突然はじかれて見える（滑ってくる間に少しずつどいてもらう）。
  // 対向整列で並べた粒（still）も動かさない側 — 生成物にぶつかられて列が崩れないように
  const solids = particles.filter((p) => p.still || p.mode === "deposit" || p.mode === "toDeposit" || p.mode === "plateAtom");
  for (let i = 0; i < movers.length; i++) {
    const a = movers[i];
    for (let j = i + 1; j < movers.length; j++) pushApart(a, movers[j], 0.5);
    for (const s of solids) pushApart(a, s, 1);
  }
}

function pushApart(a, b, aShare) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const min = a.r + b.r + 2;
  if (d >= min) return;
  const ov = min - d;
  const ux = dx / d, uy = dy / d;
  a.x -= ux * ov * aShare;
  a.y -= uy * ov * aShare;
  if (aShare < 1) {
    b.x += ux * ov * (1 - aShare);
    b.y += uy * ov * (1 - aShare);
  }
}

function floatMove(p, dt) {
  p.vx += rnd(-1, 1) * 120 * dt;
  p.vy += rnd(-1, 1) * 120 * dt;
  const sp = Math.hypot(p.vx, p.vy), max = 50;
  if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  // maxX を持つ粒は、そこから右へ行かない（溶液モードの生成物を e⁻ の通り道より左に留める）
  const minX = (isSolution() ? WATER.x : PLATE.x + PLATE.w + 30) + p.r;
  const maxX = Math.max(minX, (p.maxX !== undefined ? p.maxX : WATER.x + WATER.w) - p.r);
  const minY = WATER.y + p.r + 6, maxY = WATER.y + WATER.h - p.r;
  if (p.x < minX) { p.x = minX; p.vx = Math.abs(p.vx); }
  if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx); }
  if (p.y < minY) { p.y = minY; p.vy = Math.abs(p.vy); }
  if (p.y > maxY) { p.y = maxY; p.vy = -Math.abs(p.vy); }
}

function step(dt, now) {
  simTime += dt;
  const due = events.filter((e) => e.at <= simTime);
  if (due.length) {
    events = events.filter((e) => e.at > simTime);
    due.forEach((e) => e.fn());
  }
  for (const p of [...particles]) {
    if (p.dead) continue;
    if (p.mode === "float" || p.mode === "pop" || p.mode === "oxSource") {
      if (!p.still) floatMove(p, dt);   // 対向整列で並べた粒は漂わせない
      if (p.mode === "pop" && now - p.born > 300) p.mode = "float";
    } else if (p.mode === "eToPool") {
      if (moveToward(p, dt, 160)) { p.mode = "pool"; poolE.push(p); refreshHUD(); serveWaitingUnits(); }
    } else if (p.mode === "swim") {
      if (moveToward(p, dt, 110)) {
        p.mode = "waitUnit";
        p.unit.arrived++;
        if (p.unit.arrived === p.unit.ions.length) processUnit(p.unit);
      }
    } else if (p.mode === "eToIon") {
      if (moveToward(p, dt, 170)) {
        const unit = p.unit;
        removeParticle(p);
        unit.eArrived++;
        if (unit.eArrived === unit.need) transformUnit(unit);
      }
    } else if (p.mode === "toDeposit") {
      if (moveToward(p, dt, p.speed)) p.mode = "deposit";   // 板に着いたらそこで固定
    } else if (p.mode === "bubble") {
      p.vy = Math.max(p.vy - 300 * dt, -110);
      p.y += p.vy * dt;
      p.x += Math.sin((p.y + p.id * 37) / 14) * 30 * dt;
      if (p.y <= WATER.y + p.r) {
        splash(p.x, WATER.y + 4);
        escaped[p.sp] = (escaped[p.sp] || 0) + 1;
        removeParticle(p);
        refreshHUD();
      }
    }
    // plateAtom / pool / waitUnit / deposit は静止
  }
  separateParticles();
  updateTransforms(now);
}

function updateTransforms(now) {
  for (const p of particles) {
    let s = 1;
    if (p.mode === "pop") s = Math.min(1, 0.3 + (0.7 * (now - p.born)) / 300);
    p.el.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) scale(${s.toFixed(2)})`);
  }
}

let lastT = performance.now();
function tick(now) {
  if (now <= lastT) return;
  let dt = Math.min(1, (now - lastT) / 1000);
  lastT = now;
  while (dt > 0) {
    const h = Math.min(dt, 0.033);
    step(h, now);
    dt -= h;
  }
}
function frame(now) {
  tick(now);
  requestAnimationFrame(frame);
}
setInterval(() => {
  const now = performance.now();
  if (now - lastT > 80) tick(now);
}, 66);

/* ---- HUD・パネル ---- */

function refreshHUD() {
  const counts = {};
  for (const p of particles) {
    // 板へ滑っている途中の粒も「析出」として数え済み（deposited）。
    // ここで溶液中の粒として数えると、着地までの一瞬だけ二重に出てしまう
    if (p.mode === "deposit" || p.mode === "toDeposit") continue;
    counts[p.sp] = (counts[p.sp] || 0) + 1;
  }
  ionCountsEl.innerHTML = "";
  const chip = (text, color, extraClass) => {
    const c = document.createElement("span");
    c.className = "chip" + (extraClass ? " " + extraClass : "");
    if (color) c.style.borderColor = color;
    c.textContent = text;
    ionCountsEl.appendChild(c);
  };
  for (const sp of Object.keys(counts)) {
    if (sp === "e-") continue;
    chip(`${SPECIES[sp].disp} ×${counts[sp]}`, (RSTYLE[sp] || {}).color);
  }
  const eCount = particles.filter((p) => p.sp === "e-").length;
  if (eCount > 0) chip(`e⁻ ×${eCount}（板の上）`, RSTYLE["e-"].color);
  if (deposited > 0) {
    const depSp = redHR().right.find((t) => t.sp !== "e-").sp;
    if (depSp !== "H2") chip(`${SPECIES[depSp].disp} ×${deposited}（析出）`, (RSTYLE[depSp] || {}).color);
  }
  for (const sp of Object.keys(escaped)) chip(`${SPECIES[sp].disp}↑ ×${escaped[sp]}（空気中へ）`, null, "escaped");
}

/* 項を描く。酸化数は変化する元素の項だけに付き、**その元素記号の真下**に置く
   （MnO₄⁻ なら +7 は Mn の下。項の中央に置くと、どの原子の話なのかが伝わらない）。
   記号のところだけ span で切り出して位置の基準にし、タグはその中に絶対配置する。 */
function termSpan(term, changes, cancel) {
  const wrap = document.createElement("span");
  wrap.className = "fterm";
  const main = document.createElement("span");
  if (cancel) main.className = "cancel";
  const disp = SPECIES[term.sp].disp;
  const pre = term.n > 1 ? term.n + " " : "";
  const oxAt = changes.length ? oxAtomFor(term.sp) : null;
  const at = oxAt ? (oxAt.at !== undefined ? oxAt.at : disp.indexOf(oxAt.el)) : -1;
  if (!oxAt || at < 0) {
    main.textContent = pre + disp;
    wrap.appendChild(main);
    return wrap;
  }
  const v = Number(oxAt.text);
  const head = document.createElement("span");
  head.textContent = pre + disp.slice(0, at);
  const anchor = document.createElement("span");
  // 下線でも「どの原子の酸化数か」を示す（数字の位置だけだと見落としやすい）
  anchor.className = "oxAnchor " + (v > 0 ? "oxpos" : v < 0 ? "oxneg" : "oxzero");
  anchor.textContent = oxAt.el;
  const tail = document.createElement("span");
  tail.textContent = disp.slice(at + oxAt.el.length);
  main.append(head, anchor, tail);
  wrap.appendChild(main);
  const sub = document.createElement("span");
  sub.className = "oxtag " + (v > 0 ? "oxpos" : v < 0 ? "oxneg" : "oxzero");
  sub.textContent = oxAt.text;
  anchor.appendChild(sub);
  return wrap;
}

function sepEl(t) {
  const s = document.createElement("span");
  s.className = "fsep";
  s.textContent = t;
  return s;
}

/* 片側の項だけを並べる（筆算は左辺と右辺が別のセルに入り、→ の位置がそろう）。
   cancelSp を渡すと、その種の項に斜線を引く（足し算で打ち消される e⁻ の表現） */
function renderTerms(container, terms, changes, cancelSp) {
  container.innerHTML = "";
  terms.forEach((t, i) => {
    if (i > 0) container.appendChild(sepEl("＋"));
    container.appendChild(termSpan(t, changes, cancelSp && t.sp === cancelSp));
  });
}

/* ---- 筆算シート（縦スクロールのタイムライン）----
   手で解くときの並びをそのまま上から下へ置く。前の段が片づくと次の段が下に現れる。
     ステップ1（#step1）  半反応式2本。**式は元のまま**で、倍率だけ ×a・×b で決める
     ステップ2（#step2）  ビーカーと模式図で e⁻ の数を合わせる
     ステップ3（#stepCalc の上半分）  倍数化した2本を並べて足し、e⁻ に斜線 → イオン反応式
     ステップ4（同・中ほど）  省略していた傍観イオンを両辺に戻す
     ステップ5（同・下）      化学反応式
   ③〜⑤を1枚のグリッドに入れてあるのは、→ の位置を段をまたいでそろえるため。 */

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

/* 段の見出し（グリッドの中に置く「③ …」の行） */
function sheetStepHead(parent, id, no, text) {
  const d = sheetSpan(parent, id, "stepHead inSheet");
  const n = document.createElement("span");
  n.className = "stepNo";
  n.textContent = String(no);
  d.append(n, document.createTextNode(text));
  return d;
}

function buildSheetSkeleton() {
  halfSheetEl.innerHTML = "";
  SHEET.ox  = sheetRow(halfSheetEl, "halfOx", "halfRow");
  SHEET.red = sheetRow(halfSheetEl, "halfRed", "halfRow");

  calcSheetEl.innerHTML = "";
  calcSheetEl.style.gridTemplateColumns = "";
  sheetWidthKey = null;
  SHEET.head3  = sheetStepHead(calcSheetEl, "head3", 3, "足し合わせて e⁻ を消す — 倍率をかけた2本を縦に足す");
  SHEET.sumOx  = sheetRow(calcSheetEl, "rowSumOx");
  SHEET.sumRed = sheetRow(calcSheetEl, "rowSumRed");
  SHEET.rule1  = sheetRule(calcSheetEl, "rule1");
  SHEET.ionic  = sheetRow(calcSheetEl, "rowIonic");
  SHEET.head4  = sheetStepHead(calcSheetEl, "head4", 4, "省略していたイオンを両辺に戻す — 用意した物質の姿に");
  SHEET.add    = sheetRow(calcSheetEl, "rowAdd");
  SHEET.addMsg = sheetSpan(calcSheetEl, "addMsg", "footNote");
  SHEET.work   = sheetRow(calcSheetEl, "rowWork");
  SHEET.roles  = sheetSpan(calcSheetEl, "roleWrap");
  SHEET.rule2  = sheetRule(calcSheetEl, "rule2");
  SHEET.head5  = sheetStepHead(calcSheetEl, "head5", 5, "化学反応式 — 完成");
  SHEET.mol    = sheetRow(calcSheetEl, "rowMol");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = "molFigure";
  svg.setAttribute("viewBox", "0 0 480 240");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "酸化還元で決着したぶんと、残ったイオンの組み換えの図");
  SHEET.roles.appendChild(svg);
  molFigureSvg = svg;
}

/* 段の出し入れ。現れるときだけスライドインさせる（すでに出ている段は動かさない） */
function revealStep(el, show) {
  if (!show) { el.hidden = true; el.classList.remove("appear"); return; }
  if (el.hidden) {
    el.hidden = false;
    el.classList.remove("appear");
    void el.offsetWidth;      // アニメを付け直すための強制リフロー
    el.classList.add("appear");
  }
}

function buildHalfRow(o, hr, idx, tag) {
  const changes = oxChangeOfHalf(hr);
  o.mark.innerHTML = "";
  const times = document.createElement("span");
  times.textContent = "×";
  const down = document.createElement("button");
  down.textContent = "−";
  const num = document.createElement("span");
  num.className = "coeff";
  num.textContent = String(mult[idx]);
  const up = document.createElement("button");
  up.textContent = "＋";
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
  renderTerms(o.left, hr.left, changes);
  renderTerms(o.right, hr.right, changes);
  o.arrow.textContent = "→";
  o.note.innerHTML = "";
  const kind = document.createElement("span");
  kind.className = "kindTag " + (idx === 0 ? "ox" : "red");
  kind.textContent = tag;
  const solo = document.createElement("button");
  solo.className = "solo";
  solo.textContent = "▶ 単体";
  solo.title = "この半反応式だけをアニメで見る";
  solo.onclick = () => playSolo(idx === 0 ? "ox" : "red");
  o.note.append(kind, solo);
}

function onMultChange() {
  buildHalfRow(SHEET.ox, oxHR(), 0, "還元剤");
  buildHalfRow(SHEET.red, redHR(), 1, "酸化剤");
  // 倍率が変わればイオン反応式も変わる＝足すべき傍観イオンの数も変わるので、④行目は白紙に戻す
  added = 0;
  cleared = false;
  soloMode = null;
  clearEl.hidden = true;
  layoutLab();
  setMsg("倍率を変えた。ビーカーの配置も変わった。「▶ 反応を見る」で確かめよう。");
  updateETally();
  buildRedoxSchematic();
  updateCleaveStep();
  updateSheetTail();
}

function updateETally() {
  const a = mult[0], b = mult[1];
  const givePer = electronsOf(oxHR()), takePer = electronsOf(redHR());
  const give = givePer * a, take = takePer * b;
  const ok = give === take;
  // 粒の絵は模式図が受け持つので、ここは式のかたちの数だけを残す
  eTallyEl.innerHTML =
    `出す e⁻: ${givePer}×${a} ＝ <strong>${give}個</strong>　／　` +
    `受け取る e⁻: ${takePer}×${b} ＝ <strong>${take}個</strong> ` +
    `<span class="${ok ? "okcell" : "ngcell"}">${ok ? "そろった（足せる）" : "そろっていない"}</span>`;
}

/* ---- e⁻ の受け渡しのブロック模式図 ----
   中和の模式図（H⁺ と OH⁻ が結びついて H₂O）と同じ図法で、酸化還元を見せる。
   左＝還元剤（e⁻ を出す側）・右＝酸化剤（e⁻ を受け取る側）。1ブロック＝半反応式1回ぶん、
   縦1行＝e⁻ 1個ぶん。Al は3行・Cu²⁺ は2行の高さになるので、
   **倍率をそろえる＝最小公倍数を探す**ことが図の高さでそのまま分かる。 */

const schematicWrap = document.getElementById("schematicWrap");
const schematicSvg = document.getElementById("schematic");
const schematicHeadEl = document.getElementById("schematicHead");
const schematicMsgEl = document.getElementById("schematicMsg");
const schematicAddEl = document.getElementById("schematicAdd");

function redoxLook(sp) {
  const st = RSTYLE[sp] || {};
  return {
    color: SPECIES_COLOR[sp] || st.color || "#8a8f98",
    darkText: !!st.darkText,
    label: SPECIES[sp].disp,
  };
}

/* 半反応式の左辺から e⁻ を除いた「本体」を取り出す（[{sp, n}]） */
function halfCore(hr) {
  return hr.left.filter((t) => t.sp !== "e-").map((t) => ({ sp: t.sp, n: t.n }));
}

function buildRedoxSchematic() {
  if (!schematicSvg) return;
  const ox = oxHR(), red = redHR();
  const givePer = electronsOf(ox), takePer = electronsOf(red);
  const mkUnit = (hr, per, idx) => ({
    core: halfCore(hr), per, count: mult[idx], tag: `e⁻${per}個`,
    onClick: () => { if (mult[idx] > 1) { mult[idx]--; onMultChange(); } },
  });
  const c = drawBlockSchematic(schematicSvg, {
    look: redoxLook,
    // e⁻ は1個ずつ受け渡されるので need は左右とも1（1行＝e⁻ 1個）
    left:  { partSp: "e-", need: 1, units: [mkUnit(ox, givePer, 0)] },
    right: { partSp: "e-", need: 1, hollow: true, units: [mkUnit(red, takePer, 1)] },
    center: null,
  });

  schematicAddEl.innerHTML = "";
  const add = (label, idx, cls) => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = `＋ ${label}`;
    b.onclick = () => { if (mult[idx] < 9) { mult[idx]++; onMultChange(); } };
    schematicAddEl.appendChild(b);
  };
  add(SPECIES[halfCore(ox)[0].sp].disp + "（還元剤）", 0, "schAdd acc");
  add(SPECIES[halfCore(red)[0].sp].disp + "（酸化剤）", 1, "schAdd don");

  const give = c.leftTotal, take = c.rightTotal;
  if (give === take) {
    // e⁻ がそろっていても最簡整数比とは限らない。割り切れるなら割り方まで示す
    const adv = simplestRatioAdvice([mult[0], mult[1]]);
    if (adv) {
      setStatusMsg(schematicMsgEl,
        `e⁻ の数は合っているけれど、同じ組み合わせを ${adv.gcd} 回くり返しているだけ。` +
        `どちらも ${adv.gcd} で割って ×${mult[0]}・×${mult[1]} → ×${adv.to[0]}・×${adv.to[1]} に直そう` +
        `（e⁻ ${give}個 → ${give / adv.gcd}個 でも同じ反応）。`, "ng");
    } else {
      setStatusMsg(schematicMsgEl,
        `ぴったり！ 還元剤が出す e⁻ ${give} 個 ＝ 酸化剤が受け取れる ${take} 個。` +
        `この倍率 ×${mult[0]}・×${mult[1]} がそのまま係数になる。`, "ok");
    }
  } else if (give > take) {
    setStatusMsg(schematicMsgEl, `e⁻ が ${give - take} 個 あまっている（受け取る席が足りない）。酸化剤のブロックを足そう。`, "ng");
  } else {
    setStatusMsg(schematicMsgEl, `e⁻ の席が ${take - give} 個 空いている（出す e⁻ が足りない）。還元剤のブロックを足そう。`, "ng");
  }
  schematicHeadEl.textContent = `e⁻ の受け渡し（模式図）— ${givePer}個ずつ出す × ${takePer}個ずつ受け取る`;
  drawAcidSource();
}

/* ---- 「この H⁺ は誰が出す？」の図 ----
   酸化剤が NO₃⁻ のように**酸として持ち込まれる**反応では、必要な H⁺ をひとまとめに
   「8H⁺」と書いてしまうと、それがどこから来たのかが消えてしまう。
   用意したのは Cu と HNO₃ だけで、HNO₃ 1個からは H⁺ が1個しか出ない。
   だから H⁺ を1個ずつ「連れてきた NO₃⁻ との対」に分けて描き、
   酸化剤として使う NO₃⁻ と一緒に来たぶん／足りなくて追加したぶん を色で分ける。
   後者の NO₃⁻ が、そのまま④で両辺に足す傍観イオンになる。 */

const acidSrcWrapEl = document.getElementById("acidSourceWrap");
const acidSrcSvg = document.getElementById("acidSource");
const acidSrcMsgEl = document.getElementById("acidSourceMsg");

/* この反応が「酸化剤を酸として持ち込む」形かどうか。そうならその内訳を返す */
function acidSourcePlan() {
  const me = stage().molecularEq;
  if (!me || !acidSrcSvg) return null;
  const j = me.join.find((x) => x.side === "left" && x.ion === "H+");
  if (!j) return null;
  const red = redHR();
  const nOf = (terms, sp) => (terms.find((t) => t.sp === sp) || { n: 0 }).n;
  const hPer = nOf(red.left, "H+"), oxPer = nOf(red.left, me.spectator);
  if (!hPer || !oxPer) return null;
  const b = mult[1];
  return {
    acidSp: j.to, spectator: me.spectator, hPer, oxPer,
    withOxidant: oxPer * b,                  // 酸化剤の NO₃⁻ と一緒に来た H⁺
    extra: (hPer - oxPer) * b,               // 足りないので酸として追加したぶん
    needH: hPer * b,
  };
}

function drawAcidSource() {
  if (!acidSrcSvg) return;
  const p = acidSourcePlan();
  if (!p) { acidSrcWrapEl.hidden = true; return; }
  acidSrcWrapEl.hidden = false;
  acidSrcSvg.innerHTML = "";
  const W = 460, R = 11, colW = 27, MAX = 12;
  const acidD = SPECIES[p.acidSp].disp, sD = SPECIES[p.spectator].disp;
  const shown = Math.min(p.needH, MAX);
  const x0 = 8, yTop = 44, yBot = 44 + 30;
  const txt = (x, y, s, size, fill, weight) => {
    const e = mk("text", { x, y, "font-size": size, fill, "font-weight": weight || "normal" }, acidSrcSvg);
    e.textContent = s;
    return e;
  };
  txt(6, 14, `用意したのは ${SPECIES[oxMetal()].disp} と ${acidD} だけ。${acidD} 1個からは H⁺ が1個しか出ない`, 11, "#5a6570", "bold");
  // 内訳の帯（酸化剤と一緒に来たぶん／酸として足したぶん）
  const band = (from, to, fill, stroke) => {
    if (to <= from) return;
    mk("rect", {
      x: x0 + from * colW - 4, y: yTop - R - 8,
      width: (to - from) * colW, height: (yBot + R + 8) - (yTop - R - 8),
      rx: 8, fill, stroke, "stroke-width": 1.2,
    }, acidSrcSvg);
  };
  const nWith = Math.min(p.withOxidant, shown);
  band(0, nWith, "#eaf3fb", "#a8c8e2");
  band(nWith, shown, "#fdf1e6", "#e0b183");
  const dot = (cx, cy, sp, dim) => {
    const look = redoxLook(sp);
    mk("circle", {
      cx, cy, r: R, fill: look.color, stroke: "rgba(0,0,0,.3)", "stroke-width": 1, opacity: dim ? 0.55 : 1,
    }, acidSrcSvg);
    const t = mk("text", {
      x: cx, y: cy + 3.5, "text-anchor": "middle",
      "font-size": look.label.length > 3 ? 8 : 10, "font-weight": "bold",
      fill: look.darkText ? "#2a3540" : "#fff",
    }, acidSrcSvg);
    t.textContent = look.label;
  };
  for (let i = 0; i < shown; i++) {
    const cx = x0 + i * colW + colW / 2;
    // 1本の HNO₃ ＝ H⁺ と NO₃⁻ の対。縦線で「もとは1つ」を示す
    mk("line", { x1: cx, y1: yTop + R, x2: cx, y2: yBot - R, stroke: "#9aa4ae", "stroke-width": 2 }, acidSrcSvg);
    dot(cx, yTop, "H+", false);
    dot(cx, yBot, p.spectator, i >= nWith);
  }
  if (p.needH > shown) txt(x0 + shown * colW + 4, yBot + 4, `…他 ${p.needH - shown}`, 11, "#5a6570");
  const capY = yBot + R + 18;
  txt(x0 + 2, capY, `${p.withOxidant}個 … 酸化剤になる ${sD} と一緒に来た`, 10.5, "#2f5b7a");
  if (p.extra > 0) {
    txt(x0 + nWith * colW + 2, capY + 14, `${p.extra}個 … 足りないので ${acidD} を追加。この ${sD} は傍観イオン`, 10.5, "#8d5a25");
  }
  acidSrcSvg.setAttribute("viewBox", `0 0 ${W} ${capY + 22}`);
  acidSrcMsgEl.textContent = p.extra > 0
    ? `必要な H⁺ は ${p.needH}個。でも酸化剤の ${sD} が連れてくる H⁺ は ${p.withOxidant}個だけ。` +
      `残り ${p.extra}個は ${acidD} をもう ${p.extra}個 足して出す — その ${sD} は反応せず、④で両辺に足す傍観イオンになる。`
    : `必要な H⁺ ${p.needH}個は、酸化剤の ${sD} が連れてきたぶんでちょうど足りている。`;
}

/* ---- 筆算の④⑤行目: 傍観イオンを両辺に足して化学反応式に戻す ----
   イオン反応式（傍観イオンを除いた形）がそろったら、傍観の NO₃⁻ を両辺に足して戻す。
   硝酸は「酸」と「酸化剤」の二役をこなすので、電子を合わせただけでは係数が決まらない
   ＝ここがこの反応の山場。入力は「何個足すか」の1つだけで、手で解く筆算と同じ形にしてある。 */

let molFigureSvg = null;
let added = 0;              // ④行目で両辺に足した傍観イオンの数
let sheetWidthKey = null;   // 筆算の幅を固定した「ステージ／倍率」の組
let sheetCols = null;

function molStep() {
  return molecularizeStep(stage(), mult[0], mult[1], added);
}

/* ステップ③④⑤を、上から順に出しながら描き直す。
   ③ e⁻ がそろったら（＝足し算ができる状態になったら）
   ④ ③が最簡整数比まで片づいたら
   ⑤ ④の補充がぴったり合ったら */
function updateSheetTail() {
  const chk = checkRedoxMultipliers(stage(), mult[0], mult[1]);
  const balanced = chk.give !== undefined && chk.give === chk.take;
  revealStep(stepCalcEl, balanced);
  if (!balanced) {
    calcSheetEl.style.gridTemplateColumns = "";
    drawMolFigure(null);
    return;
  }
  updateSumRows(chk);
  updateIonicRow(chk);
  const step = (stage().molecularEq && chk.ok) ? molStep() : null;
  const show4 = !!step;
  revealStep(SHEET.head4, show4);
  SHEET.add.row.hidden = !show4;
  SHEET.addMsg.hidden = !show4;
  SHEET.roles.hidden = !show4;
  if (!show4) {
    SHEET.work.row.hidden = true;
    SHEET.rule2.hidden = true;
    SHEET.head5.hidden = true;
    SHEET.mol.row.hidden = true;
    calcSheetEl.style.gridTemplateColumns = "";
    drawMolFigure(null);
    return;
  }
  updateAddRow(step);
  // 途中は④の作業行に「まだイオンが残っている姿」を出し、
  // ぴったり合ったときだけ⑤の化学反応式を下に出す
  SHEET.work.row.hidden = step.ok;
  if (!step.ok) updateWorkRow(step);
  SHEET.rule2.hidden = !step.ok;
  revealStep(SHEET.head5, step.ok);
  SHEET.mol.row.hidden = !step.ok;
  if (step.ok) updateMolRow(step);
  lockSheetWidth(step);
  // 図は入力に連動させる（足りないぶんは点線の空席で見える）
  drawMolFigure(step);
}

/* ⑤行目は足した数によって項の数が変わる（`3Cu＋2HNO₃＋6H⁺→…` ⇄ `3Cu＋8HNO₃→…`）。
   列幅を内容まかせにしていると、＋/− を押すたびに列の取り分が変わって筆算全体と図が
   左右に揺れてしまう。**起こりうるいちばん広い状態を先に測って、5列とも px で固定する**。
   測るのは 0個・ちょうど・1個多い の3通り。項の数が変わるのはこの3つのどれかで、
   それ以上足しても係数の桁が増えるだけなので、伸びしろぶんを足して吸収する。 */
function lockSheetWidth(step) {
  // 自由組み立てではステージ番号が無いので、ステージ id で区別する
  const key = `${stage().id}/${mult[0]}/${mult[1]}`;
  if (sheetWidthKey !== key) {
    const keep = added;
    const keepWork = SHEET.work.row.hidden, keepMol = SHEET.mol.row.hidden;
    calcSheetEl.style.gridTemplateColumns = "";
    SHEET.work.row.hidden = false;
    SHEET.mol.row.hidden = false;
    const cols = [0, 0, 0, 0, 0];
    for (const k of [0, step.need, step.need + 1]) {
      added = k;
      const st = molecularizeStep(stage(), mult[0], mult[1], added);
      updateAddRow(st);
      updateWorkRow(st);
      updateMolRow(molecularizeStep(stage(), mult[0], mult[1], step.need));
      // どの行も同じ5列を共有するので、見えている1行のセル幅がそのまま列幅になる
      const cells = SHEET.ionic.row.children;
      for (let i = 0; i < cols.length; i++) {
        cols[i] = Math.max(cols[i], cells[i].getBoundingClientRect().width);
      }
    }
    added = keep;
    SHEET.work.row.hidden = keepWork;
    SHEET.mol.row.hidden = keepMol;
    updateAddRow(step);
    if (!keepWork) updateWorkRow(step);
    if (!keepMol) updateMolRow(step);
    sheetWidthKey = key;
    // 左辺・右辺の列だけ、係数が2桁になったときのぶんを少し足しておく
    sheetCols = cols.map((w, i) => Math.ceil(w) + (i === 1 || i === 3 ? 10 : 2));
  }
  calcSheetEl.style.gridTemplateColumns = sheetCols.map((w) => w + "px").join(" ");
}

/* ③の上2行 — 倍率をかけた半反応式。両辺にそろう e⁻ に斜線を引いて「消える」ことを見せる。
   ステップ1の半反応式は元のまま残してあるので、倍数化はここでだけ起こる。 */
function updateSumRows(chk) {
  const a = mult[0], b = mult[1];
  const mulTerms = (terms, k) => terms.map((t) => ({ sp: t.sp, n: t.n * k }));
  const fill = (o, hr, k, idx, tagText) => {
    o.mark.textContent = idx === 0 ? "" : "＋)";
    o.arrow.textContent = "→";
    o.left.className = "cLeft halfFormula";
    o.right.className = "cRight halfFormula";
    const changes = oxChangeOfHalf(hr);
    renderTerms(o.left, mulTerms(hr.left, k), changes, "e-");
    renderTerms(o.right, mulTerms(hr.right, k), changes, "e-");
    o.note.innerHTML = "";
    const t = document.createElement("span");
    t.className = "rowTag";
    t.textContent = tagText;
    o.note.appendChild(t);
  };
  // 「還元剤＝酸化される側」の対応を行ラベルでも明示する（Gemini レビュー採用・v132）。
  // ステップ1の kindTag（還元剤/酸化剤）と同じ言葉で結び、×a・×b がどちらの式に
  // かかったかを役割名で追えるようにする
  fill(SHEET.sumOx, oxHR(), a, 0, `【還元剤】（×${a} 酸化される式）`);
  fill(SHEET.sumRed, redHR(), b, 1, `【酸化剤】（×${b} 還元される式）`);
  SHEET.head3.querySelector(".stepNo").title = `e⁻ ${chk.give}個ずつ`;
}

/* ③の結論 — e⁻ を消したイオン反応式（筆算の横線の下） */
function updateIonicRow(chk) {
  const o = SHEET.ionic;
  SHEET.rule1.hidden = false;
  o.mark.textContent = "";
  o.note.innerHTML = "";
  const combined = combineHalves(stage(), mult[0], mult[1]);
  o.arrow.textContent = "→";
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  renderTerms(o.left, combined.left, stageOxChanges());
  renderTerms(o.right, combined.right, stageOxChanges());
  const tag = document.createElement("span");
  tag.className = "rowTag strong";
  tag.textContent = "イオン反応式";
  o.note.appendChild(tag);
  if (!chk.ok) {
    const w = document.createElement("span");
    w.className = "ngcell";
    w.textContent = "※最簡比でない";
    o.note.appendChild(w);
  }
}

/* ④の作業行 — まだ組めていないイオンが残っている途中の姿。
   ぴったり合うとこの行は引っ込み、代わりに⑤の化学反応式が下に出る */
function updateWorkRow(step) {
  const o = SHEET.work;
  o.mark.textContent = "";
  o.arrow.textContent = "→";
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  renderTerms(o.left, step.left.terms, []);
  renderTerms(o.right, step.right.terms, []);
  o.note.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = "rowTag ng";
  tag.textContent = "まだイオンが残っている";
  o.note.appendChild(tag);
}

function updateAddRow(step) {
  const o = SHEET.add;
  const sD = SPECIES[step.spectator].disp;
  o.mark.textContent = "＋)";
  o.arrow.textContent = "";
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  o.left.innerHTML = "";
  const down = document.createElement("button");
  down.textContent = "−";
  const num = document.createElement("span");
  num.className = "coeff";
  num.textContent = String(added);
  const up = document.createElement("button");
  up.textContent = "＋";
  down.onclick = () => { if (added > 0) { added--; updateSheetTail(); } };
  up.onclick = () => { if (added < 20) { added++; updateSheetTail(); } };
  const stepper = document.createElement("span");
  stepper.className = "stepper";
  stepper.append(down, num, up);
  const f = document.createElement("span");
  f.className = "formula";
  f.textContent = sD;
  o.left.append(stepper, f);
  o.right.textContent = added > 0 ? `${added} ${sD}` : `（同じだけ）`;
  o.right.classList.toggle("muted", added === 0);
  o.note.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = "rowTag";
  tag.textContent = "傍観イオンを両辺に";
  o.note.appendChild(tag);
  SHEET.addMsg.textContent = step.reason;
  SHEET.addMsg.className = "cSpan footNote " + (step.ok ? "okcell" : "ngcell");
}

function updateMolRow(step) {
  const o = SHEET.mol;
  o.mark.textContent = "";
  o.arrow.textContent = "→";
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  renderTerms(o.left, step.left.terms, []);
  renderTerms(o.right, step.right.terms, []);
  o.row.classList.add("doneRow");
  o.note.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = "rowTag strong";
  tag.textContent = "化学反応式";
  o.note.appendChild(tag);
}

/* ---- 切断の段（ヨードホルム反応）----
   ヨード化（酸化還元）が片づいたあと、OH⁻ が C–C を切って黄色い沈殿が落ちる。
   ここは**正味の酸化数が動かない**ので e⁻ の数合わせは要らない。
   同じ画面に混ぜると「まだ電子を合わせるのか」と思わせるので、段として分けて出す。 */
function updateCleaveStep() {
  if (!stepCleaveEl) return;
  const cv = stage().cleavage && IODOFORM_CLEAVAGE[stage().cleavage];
  revealStep(stepCleaveEl, !!cv);
  if (!cv) return;
  const r = checkCleavage(cv);
  cleaveSheetEl.innerHTML = "";
  const o = sheetRow(cleaveSheetEl, "rowCleave");
  o.mark.textContent = "";
  o.arrow.textContent = "→";
  o.left.className = "cLeft halfFormula";
  o.right.className = "cRight halfFormula";
  // 切断の段には酸化数を出さない（レビュー S-7）。ステージの変化（CH₃⁺ の −2→+2）を
  // 基準に選ぶと、値がたまたま一致するだけの無関係な原子（アセトンのカルボニル炭素 +2）に
  // ラベルが付き、「その原子が変化する」ように誤読させる。切断で入れ替わる ±1 は
  // 下の説明文が言葉で受け持つ（condition.js が途中行に出さないのと同じ判断）
  renderTerms(o.left, cv.left, []);
  renderTerms(o.right, cv.right, []);
  o.note.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = "rowTag" + (r.redox ? " ng" : " strong");
  tag.textContent = r.redox ? "※酸化還元になっている" : "酸化還元ではない";
  o.note.appendChild(tag);
  // 切断そのものは酸化還元ではないが、残った断片もこのあと酸化される。
  // その1個ぶんを足すと教科書の全体式（I₂ 3個）に一致する — ここを言わないと数が合わない
  const rest = cv.rest && HALF_REACTIONS[cv.rest];
  const eOx = electronsOf(oxHR()) * mult[0];
  const eRest = rest ? electronsOf(rest) : 0;
  cleaveMsgEl.innerHTML = "";
  const l1 = document.createElement("div");
  l1.textContent = `${cv.note} 切断そのものは酸化数の合計が動かない（正味 ${r.net}）ので、e⁻ の数合わせは要らない` +
    (r.shifts.length ? "（C–C を切ると結合の電子が一方に寄るため、原子ごとには ±1 の入れ替わりが起こる）" : "") + "。";
  cleaveMsgEl.appendChild(l1);
  if (rest) {
    const l2 = document.createElement("div");
    l2.className = "cleaveRest";
    l2.textContent = `残った断片もこのあと ${eRest} 個ぶん酸化される: ${rest.disp}。` +
      `メチル側の e⁻ ${eOx} 個（I₂ ${eOx / 2} 個）と合わせて e⁻ ${eOx + eRest} 個 ＝ I₂ ${(eOx + eRest) / 2} 個。`;
    cleaveMsgEl.appendChild(l2);
    if (cv.overall) {
      const l3 = document.createElement("div");
      l3.className = "cleaveOverall";
      l3.textContent = "教科書の全体式: " + cv.overall;
      cleaveMsgEl.appendChild(l3);
    }
  }
  // 便宜的な見方であることのただし書き。ここは必ず出す
  const cav = document.createElement("div");
  cav.className = "caveat";
  const ch = document.createElement("strong");
  ch.textContent = IODOFORM_CAVEAT.head;
  const cb = document.createElement("span");
  cb.textContent = " " + IODOFORM_CAVEAT.body.replace(/\*\*/g, "");
  cav.append(ch, cb);
  cleaveMsgEl.appendChild(cav);
}

/* ---- イオン反応式 → 化学反応式 の図 ----
   この段でやることは2種類あり、混ぜると分からなくなるので図でも分ける。
     ① 酸化還元で決着したぶん … e⁻ が動いて別の物質になった。もう組み換えない
     ② 残ったイオンの組み換え … e⁻ は動かない。相手を見つけて分子・塩になるだけ
   ②はイオン反応モードの組み換えと同じ見方（1列＝生成物1個・相手のいない粒には赤い印）で描く。
   足した傍観イオンが足りないぶんは点線の空席になるので、④行目の入力と図が連動する。 */

const FIG_R = 11, FIG_STEP = 25;

/* 1列＝生成物1個。上段に本体イオン1個、下段にそれが必要とする傍観イオンを per 個並べる */
function figRecombineRow(svg, y, o) {
  const paired = Math.min(o.ionN, Math.floor(o.avail / o.per));
  const colW = o.per * FIG_STEP + 8;
  // 見出しの下端（ベースライン＋descent）より粒の上端が下に来るように空ける。
  // ここを詰めすぎると、粒が見出しの文字に食い込む
  const capY = y + 11;
  const yTop = capY + 8 + FIG_R, yBot = yTop + FIG_STEP + 2;
  const cap = mk("text", { x: 6, y: capY, "font-size": 11, fill: "#5a6570" }, svg);
  cap.textContent = o.caption;
  const dot = (cx, cy, sp, state) => {
    const look = redoxLook(sp);
    mk("circle", {
      cx, cy, r: FIG_R,
      fill: state === "empty" ? "none" : look.color,
      stroke: state === "ok" ? "rgba(0,0,0,.3)" : "#c0392b",
      "stroke-width": state === "ok" ? 1 : 2.5,
      "stroke-dasharray": state === "empty" ? "4 3" : "none",
    }, svg);
    const t = mk("text", {
      x: cx, y: cy + 3.5, "text-anchor": "middle",
      "font-size": look.label.length > 3 ? 8 : 10, "font-weight": "bold",
      fill: state === "empty" ? "#9aa4ae" : (look.darkText ? "#2a3540" : "#fff"),
    }, svg);
    t.textContent = look.label;
  };
  let x = 6;
  for (let i = 0; i < o.ionN; i++) {
    const cx = x + i * colW + colW / 2;
    dot(cx, yTop, o.ionSp, i < paired ? "ok" : "mark");
    for (let k = 0; k < o.per; k++) {
      const idx = i * o.per + k;
      const px = cx - (o.per - 1) / 2 * FIG_STEP + k * FIG_STEP;
      dot(px, yBot, o.partSp, idx < o.avail ? "ok" : "empty");
    }
  }
  x += o.ionN * colW;
  if (paired > 0) schArrow(svg, x + 6, (yTop + yBot) / 2, x + 34, (yTop + yBot) / 2);
  // 相手のいない傍観イオン（足しすぎたぶん）は右にはみ出して赤い印をつける。
  // 生成物の絵にぶつからないよう2個までにして、それ以上は数で示す
  const spare = Math.max(0, o.avail - o.ionN * o.per);
  for (let k = 0; k < Math.min(spare, 2); k++) dot(x + 14 + k * FIG_STEP, yBot, o.partSp, "mark");
  if (spare > 2) {
    const more = mk("text", { x: x + 14 + 2 * FIG_STEP, y: yBot + 4, "font-size": 11, fill: "#c0392b" }, svg);
    more.textContent = `他 ${spare - 2}`;
  }
  const px = Math.max(x + 30, 300) + 60;
  if (paired > 0) {
    drawSchematicProduct(svg, px, (yTop + yBot) / 2, o.prodSp, redoxLook, "figProduct");
    const n = mk("text", {
      x: px, y: yBot + 22, "text-anchor": "middle", "font-size": 12, "font-weight": "bold", fill: "#46525e",
    }, svg);
    n.textContent = `×${paired}`;
  } else {
    const n = mk("text", { x: px, y: (yTop + yBot) / 2 + 4, "text-anchor": "middle", "font-size": 11, fill: "#b7c3cd" }, svg);
    n.textContent = "（まだできない）";
  }
  return yBot + FIG_R + 26;
}

function fmtSide(terms) {
  return terms.filter((t) => t.sp !== "e-")
    .map((t) => (t.n > 1 ? t.n + " " : "") + SPECIES[t.sp].disp).join(" ＋ ");
}

function drawMolFigure(step) {
  if (!molFigureSvg) return;
  const svg = molFigureSvg;
  svg.innerHTML = "";
  const me = stage().molecularEq;
  if (!step || !me) { svg.style.display = "none"; return; }
  // この図の図法は「本体イオン1個 × 傍観 per 個 → 生成物1個」（rn 系）専用。
  // ro 系のようにイオンを束ねる join（2Cr³⁺＋3SO₄²⁻→…）や固定の K⁺ を持つ反応では
  // 列の対応が崩れるので描かない（筆算の④⑤行と作業行がその役を担う）
  if (me.fixed || me.join.some((j) => (j.ionN || 1) !== 1 || j.withSp || !j.per)) {
    svg.style.display = "none";
    return;
  }
  svg.style.display = "block";
  const W = 480;
  const a = mult[0], b = mult[1];
  const give = electronsOf(oxHR()) * a;
  const mulT = (terms, k) => terms.map((t) => ({ sp: t.sp, n: t.n * k }));
  const txt = (x, y, s, size, fill, weight) => {
    const e = mk("text", { x, y, "font-size": size, fill, "font-weight": weight || "normal" }, svg);
    e.textContent = s;
    return e;
  };
  // ① 酸化還元で決着したぶん（もう組み換えない）
  mk("rect", { x: 3, y: 3, width: W - 6, height: 62, rx: 8, fill: "#f2f5f7", stroke: "#ccd5dd", "stroke-width": 1 }, svg);
  txt(12, 19, `済 ─ 酸化還元で決着したぶん（e⁻ が動いたのはここだけ・${give}個）`, 11, "#5a6570", "bold");
  txt(20, 38, `${fmtSide(mulT(oxHR().left, a))} → ${fmtSide(mulT(oxHR().right, a))}`, 12, "#8d5a25");
  txt(20, 56, `${fmtSide(mulT(redHR().left, b))} → ${fmtSide(mulT(redHR().right, b))}`, 12, "#2f5b7a");
  // ② 残ったイオンの組み換え（電子は動かない）
  let y = 76;
  const nOf = (terms, sp) => (terms.find((t) => t.sp === sp) || { n: 0 }).n;
  for (const name of ["left", "right"]) {
    const j = me.join.find((x) => x.side === name);
    if (!j) continue;
    const side = step[name];
    const ionN = nOf(step.ionic[name], j.ion);
    if (!ionN) continue;
    y = figRecombineRow(svg, y, {
      ionSp: j.ion, ionN, partSp: step.spectator, per: j.per,
      avail: side.have + added, prodSp: j.to,
      caption: name === "left"
        ? `左辺 ─ 入れたときの ${SPECIES[j.to].disp} の姿に戻す（${SPECIES[j.ion].disp} 1個に ${SPECIES[step.spectator].disp} ${j.per}個）`
        : `右辺 ─ 残ったイオンが組んで塩になる（${SPECIES[j.ion].disp} 1個に ${SPECIES[step.spectator].disp} ${j.per}個・電子は動かない）`,
    });
  }
  // 完成したら、この反応の山場である「硝酸の二役」を1行でまとめる
  if (step.ok) {
    const nL = me.reactants.length;
    const acidSp = me.reactants[me.acid], gasSp = me.products[me.reduced - nL], saltSp = me.products[me.salt - nL];
    const acid = nOf(step.left.terms, acidSp);
    const reduced = step.left.have;
    mk("rect", { x: 3, y, width: W - 6, height: 40, rx: 8, fill: "#fbe6d8", stroke: "#d9944a", "stroke-width": 1.2 }, svg);
    txt(12, y + 17, `${acid} ${SPECIES[acidSp].disp} が2つの顔で働いている`, 12, "#8d5a25", "bold");
    txt(12, y + 33,
      `${reduced} 個 … 酸化剤として還元され ${SPECIES[gasSp].disp} に　／　` +
      `${step.need} 個 … NO₃⁻ のまま ${SPECIES[saltSp].disp} に入る傍観イオン`, 11, "#7a5a4a");
    y += 46;
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${y}`);
}

function buildToolbar() {
  toolbarEl.innerHTML = "";
  const playBtn = document.createElement("button");
  playBtn.id = "playBtn";
  playBtn.className = "react";
  playBtn.textContent = "▶ 反応を見る";
  playBtn.onclick = () => {
    if (soloMode) { soloMode = null; layoutLab(); }
    play();
  };
  const reset = document.createElement("button");
  reset.className = "reset";
  reset.textContent = "↺ やり直す";
  reset.onclick = () => { soloMode = null; layoutLab(); setMsg(stage().intro); };
  toolbarEl.append(playBtn, reset);
}

/* 見出し名。番号はデータに持たず並び順から作る（ステージを足すたび振り直さずに済む） */
function stageLabel(i) {
  return `ステージ${i + 1}：${REDOX_STAGES[i].title}`;
}

function buildStageNav() {
  stageNavEl.innerHTML = "";
  REDOX_STAGES.forEach((st, i) => {
    const b = document.createElement("button");
    b.textContent = String(i + 1);
    // 自由組み立て中はどのステージも開いていないので、印は付けない
    b.className = (!freeStage && !freeIdle && i === stageIdx) ? "active" : "";
    b.title = stageLabel(i);
    // ヘッダーの「☰ 一覧」が読む行き先の名前（header-ui.js）。
    // title は指では出ないので、タッチでも読めるところに同じ中身を置く
    b.dataset.label = st.title;
    // 自由組み立てからでも収録ステージへ戻れる（行き止まりを作らない。§4-1）
    b.onclick = () => { freeStage = null; freeIdle = false; stageIdx = i; initStage(); };
    stageNavEl.appendChild(b);
  });
}

/* ================================================================================
   自由組み立てモード（redox.html?free=1）— DESIGN_redox_matching.md の M6-B / M6-C

   収録14ステージを順に解くのではなく、酸化剤と還元剤を**自分で選んで**組み合わせ、
   反応するかどうかを確かめる。判定は model.js の matchRedox（純ロジック）が全部持つ。
   ここは「選ばせて、返ってきた3値を画面に出す」だけを受け持つ。

   守っている決定:
     ・ヘッダーには何も足さない。新しい UI は必ず <main> の中（§4-1）
     ・320px で成立させる。3つの区画は縦積み（§4-2）
     ・**順位の数値は画面に出さない**（電位の暗記にすり替わる。§2-3）
     ・「反応しない」は正解のひとつ。赤（ng）ではなく案内（info）で出す（§4-3）
     ・判定の根拠は既定で2行だけ。全体は開いたときだけ、上下に分けて見せる（§9-2 A案）
   ================================================================================ */
const FREE = new URLSearchParams(location.search).get("free") === "1";
let lastVerdict = null;

/* 「反応しない／決めていない」ときに必ず添える、直せる方向（§4-3）。
   押した操作が無駄にならないようにするための一行。 */
const FIX_HINT = {
  "same-role": "もう片方の欄から選び直そう（片方は e⁻ を出す側、もう片方は受け取る側）。",
  "ladder-reversed": "「e⁻ を受け取る側」に、もっと強い酸化剤を選ぼう。",
  "exception": "別の相手で試してみよう。",
  "wrong-condition": "液性を切り替えるか、その液性で式を持っている試薬を選ぼう。",
  "tie": "強弱を決めていない相手どうし。別の組み合わせで試してみよう。",
  "no-rank": "順位を持たない相手。別の組み合わせで試してみよう。",
  "not-listed": "この相手との組み合わせは、このアプリでは言い切らないことにしている。別の組み合わせで試そう。",
  "_": "別の組み合わせで試してみよう。",
};

/* 液性の札（M6-D）。値は model.js の condition（"acid" / "basic"）。
   「中性・塩基性」をひとまとめにするのは、MnO₄⁻ がどちらでも同じ MnO₂ になるため
   （高校の教科書もこの2つをまとめて扱う）。 */
const COND_LABEL = { acid: "硫酸酸性", basic: "中性・塩基性" };

/* いま選ばれている液性。ラジオが無い（＝通常の入口）なら酸性とみなす */
function currentCondition() {
  const on = pickCondEl && pickCondEl.querySelector("input:checked");
  return on ? on.value : "acid";
}

/* 液性の但し書き。**「足りない」ではなく「別の式になる」**をここで言い切る（§2-4）。
   書き換えの手順そのものは condition.html の担当なので、そちらへ渡す（相互リンク）。 */
function showConditionNote() {
  if (!pickCondNoteEl) return;
  pickCondNoteEl.textContent = "";
  const cond = currentCondition();
  const line = document.createElement("span");
  line.textContent = cond === "acid"
    ? "収録している式のほとんどは、この硫酸酸性の書き方。"
    : "MnO₄⁻ は中性・塩基性でも酸化剤としてはたらく。反応しないのではなく、"
      + "行き先が Mn²⁺ から MnO₂（黒褐色）に変わり、受け取る e⁻ も5個から3個になる。";
  pickCondNoteEl.appendChild(line);
  /* 書き換えモードへの橋は**中性・塩基性を選んだときだけ**出す。
     酸性のあいだも出しておくと、段0が 320×568 の1画面（452px）から溢れて
     段1が画面外へ押し出される（M6-B が「畳まない」と決めた前提が崩れる）。
     ページどうしの往復はヘッダーの帯（「液性で書き換える →」）が常に持っているので、
     ここは「いま話に出たから添える」ぶん。 */
  if (cond !== "acid") {
    const a = document.createElement("a");
    a.className = "condLink";
    a.href = "condition.html";
    a.textContent = "同じ式を酸性 ⇄ 塩基性で書き換える手順を見る →";
    pickCondNoteEl.appendChild(a);
  }
}

/* 段0・段1・段2 の出し入れ。自由モードで「まだ何も選んでいない／反応しない」あいだは
   段1以降を出さない（選んでいないのに半反応式が出ていると、何の式なのか分からない）。 */
function updatePickVisibility() {
  if (!stepPickEl) return;
  revealStep(stepPickEl, FREE);
  const show = !freeIdle;
  revealStep(step1El, show);
  revealStep(step2El, show);
  if (!show) {
    revealStep(stepCalcEl, false);
    revealStep(stepCleaveEl, false);
    clearEl.hidden = true;
  }
}

/* **どちらの欄にも全部の試薬を並べる**。役で先に絞ってしまうと、最頻出のつまずきである
   「酸化剤と還元剤の取り違え」が起こせなくなり、same-role の説明（§2-6）が画面に
   出る道が消える。判定しないペアを選択肢から外さないと決めた §9-6 とも同じ考え方
   （選べないこと自体は理由の説明にならない）。
   なお役が入れ替わっているだけの選び方は matchRedox が side でそろえるので、
   「Zn を酸化剤の欄に、KMnO₄ を還元剤の欄に」入れてもちゃんと反応する。 */
function buildPicker() {
  const fill = (sel, def) => {
    sel.innerHTML = "";
    for (const [side, caption] of [["ox", "e⁻ を受け取る側（酸化剤）"], ["red", "e⁻ を出す側（還元剤）"]]) {
      const g = document.createElement("optgroup");
      g.label = caption;
      for (const rg of REAGENTS.filter((r) => r.side === side)) {
        const o = document.createElement("option");
        o.value = rg.id;
        // 選ぶのは**物質**であって半反応式ではない（学習者が手に持つのは試薬なので）
        o.textContent = rg.label + "　" + SPECIES[rg.sp].disp;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    if ([...sel.options].some((o) => o.value === def)) sel.value = def;
  };
  fill(pickOxEl, "KMnO4");
  fill(pickRedEl, "FeSO4");
  const onChange = () => { clearVerdict(); showReagentNotes(); showConditionNote(); };
  pickOxEl.onchange = onChange;
  pickRedEl.onchange = onChange;
  // 液性を変えるのも「選び直し」。前の液性で出た判定が残っていると何を見ているのか分からない
  if (pickCondEl) pickCondEl.addEventListener("change", onChange);
  pickGoEl.onclick = runPick;
  showReagentNotes();
  showConditionNote();
}

/* 「酸化剤としてはたらくのは H⁺」のような但し書き。手に持つ物と式の主役がずれる
   ところは、黙って H⁺ と書かずに札のほうへ添える（§5-2）。 */
function showReagentNotes() {
  const a = reagentById(pickOxEl.value), b = reagentById(pickRedEl.value);
  pickOxNoteEl.textContent = (a && a.note) || "";
  pickRedNoteEl.textContent = (b && b.note) || "";
}

/* 選び直したら前の判定は消す（古い結果が残っていると何を見ているのか分からなくなる） */
function clearVerdict() {
  freeStage = null;
  freeIdle = FREE;
  lastVerdict = null;
  /* 見出しには前に反応した組み合わせと液性が残っている。選び直したら消す
     （M6-D で見出しに液性を出すようにしたので、残っていると「いまどの液性を見ているのか」を
     取り違える。反応しなかったときも、この関数を通って素の見出しに戻る） */
  if (FREE) stageTitleEl.innerHTML = "<strong>自由に組み合わせる</strong>";
  pickMsgEl.textContent = "";
  pickMsgEl.className = "";
  pickBridgeEl.hidden = true;
  pickBridgeEl.innerHTML = "";
  pickWhyEl.hidden = true;
  pickWhyEl.innerHTML = "";
  updatePickVisibility();
}

function runPick() {
  const oxId = pickOxEl.value, redId = pickRedEl.value, cond = currentCondition();
  const res = matchRedox(oxId, redId, cond);
  lastVerdict = res;
  if (res.verdict === "reacts" && res.stage) {
    freeStage = res.stage;
    freeIdle = false;
    /* composeStage が付ける title は半反応式2本ぶんで長すぎる。見出しは
       **手に持っている物**の名前にする（画面用なので model.js には持ち込まない）。 */
    const a = reagentById(oxId), b = reagentById(redId);
    const oxRg = a.side === "ox" ? a : b, redRg = a.side === "ox" ? b : a;
    /* 液性も見出しに出す。同じ2つを選んでも液性で式が変わる（MnO₄⁻）ので、
       いまどちらを見ているのかが分からないと、あとから見比べられない */
    freeStage.title = SPECIES[oxRg.sp].disp + " × " + SPECIES[redRg.sp].disp +
      "（" + COND_LABEL[cond] + "）";
    freeStage.intro = res.message + " 倍率をそろえて、1本の式にまとめよう。";
    initStage();                      // 以後は収録ステージとまったく同じ体験になる
    setStatusMsg(pickMsgEl, res.message, "ok");
  } else {
    freeStage = null;
    freeIdle = FREE;
    /* 「反応しない」は**正解のひとつ**なので赤（ng）にしない。
       ng（過不足・進めない）は倍率合わせの失敗に取っておく（§4-3）。 */
    setStatusMsg(pickMsgEl, res.message, "info");
    const fix = document.createElement("div");
    fix.className = "pickFix";
    fix.textContent = FIX_HINT[res.reasonCode] || FIX_HINT._;
    /* 液性で止まったときだけ、書き換えモードへの橋を添える。
       あちらは「同じ酸化還元を両辺に OH⁻ を足して書き直す」担当で、
       ここで止まっている理由（書き方がそろっていない）とちょうど対になる。 */
    if (res.reasonCode === "wrong-condition") {
      const a = document.createElement("a");
      a.className = "condLink";
      a.href = "condition.html";
      a.textContent = "酸性 ⇄ 塩基性の書き換えを見る →";
      fix.appendChild(a);
    }
    pickMsgEl.appendChild(fix);
    updatePickVisibility();
  }
  /* 収録ステージへの橋（§3-3）。合成ステージの ox / red は**半反応式2本**そのものなので、
     それで REDOX_STAGES を走査する。反応しなかったときに橋が出ないのは当然で、
     収録14ステージは全部 reacts になることをモデル側のテストが固定している。 */
  buildStageBridge(pickBridgeEl, res.stage ? res.stage.ox : null, res.stage ? res.stage.red : null);
  renderWhy(oxId, redId, res);
}

/* 収録ステージへの橋（M6-E・DESIGN_redox_matching.md §3-3）。

   **`(oxId, redId) → ステージ` の対応表は書かない**。model.js の stagesForHalves が
   REDOX_STAGES を実行時に走査して拾う（対応表を別に持つと、収録を変えたときに黙って壊れる。
   ion ↔ ratio の横断で「対応表は書かない・式の照合で引く」と決めたのと同じ）。

   引くのは**1件ではなく一覧**。同じ (ox, red) を持つステージが複数ある
   （ri1 と ri2 はどちらも iodoform_ox × I2_red）ので、1件だけ拾う実装にすると
   横断リンクで踏んだのと同じ失敗を繰り返す。ここは list を map して全部並べる。

   行き先はページを開き直さず、**ステージ帯を押したときと同じその場の切り替え**にする
   （?free=1 が外れないので、見たあとまた組み合わせに戻れる ＝ 行き止まりを作らない）。 */
function buildStageBridge(box, oxHalfId, redHalfId) {
  box.innerHTML = "";
  const list = (oxHalfId && redHalfId) ? stagesForHalves(oxHalfId, redHalfId) : [];
  box.hidden = list.length === 0;
  if (!list.length) return list;
  const head = document.createElement("div");
  head.className = "bridgeHead";
  head.textContent = list.length > 1
    ? "この組み合わせを扱った、解説つきのステージが" + list.length + "本あります"
    : "この組み合わせには、解説つきのステージがあります";
  box.appendChild(head);
  for (const st of list) {
    const i = REDOX_STAGES.indexOf(st);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bridgeLink";
    b.dataset.stage = st.id;
    b.textContent = "ステージ" + (i + 1) + "：" + st.title + " →";
    b.onclick = () => {
      freeStage = null;
      freeIdle = false;
      stageIdx = i;
      initStage();
      step1El.scrollIntoView({ block: "start" });
    };
    box.appendChild(b);
  }
  return list;
}

/* その対が「金属の対」か（＝イオン化傾向に出てくるか）。
   判断は model.js の IONIZATION_SERIES に委ねる ＝ 画面側で条件を書き写さない
   （書き写すと、下半分が「イオン化傾向そのもの」でなくなったときに黙ってずれる）。 */
function metalOfCouple(couple) {
  const p = coupleParts(couple);
  if (!p) return null;
  const red = SPECIES[p.red];
  if (!red || red.charge !== 0) return null;
  const els = Object.keys(red.atoms);
  if (els.length !== 1) return null;
  return IONIZATION_SERIES.includes(els[0]) ? els[0] : null;
}

/* 梯子の全体（§9-2 A案の本体）。**必ず上下に分けて**出し、
   「下半分は覚えているイオン化傾向そのもので、新しく覚えることはない」という
   枠組みごと見せる。順位の数値は出さず、並びだけをデータから作る。 */
function buildLadderFull() {
  const box = document.createElement("div");
  box.className = "ladderFull";
  box.hidden = true;
  const entries = Object.entries(REDOX_LADDER_ACID)
    .map(([c, r]) => ({ c, r, metal: metalOfCouple(c) }))
    .sort((a, b) => b.r - a.r);
  const topMetal = Math.max(...entries.filter((e) => e.metal).map((e) => e.r));
  const cap = (text) => {
    const d = document.createElement("div");
    d.className = "ladderCap";
    d.textContent = text;
    return d;
  };
  const band = () => {
    const d = document.createElement("div");
    d.className = "ladderBand";
    return d;
  };
  const push = (parent, sepText, node) => {
    if (parent.children.length) {
      const s = document.createElement("span");
      s.className = "sep";
      s.textContent = sepText;
      parent.appendChild(s);
    }
    parent.appendChild(node);
  };
  // 上半分 — 「強い酸化剤」として習うもの。あえて ／ でつなぐ（順序を覚える対象にしない）
  const up = band();
  const seen = new Set();
  for (const e of entries.filter((x) => x.r > topMetal)) {
    const d = coupleDisp(e.c);
    if (!d || seen.has(d.ox)) continue;       // 希硝酸と濃硝酸は同じ NO₃⁻（順位も分けない）
    seen.add(d.ox);
    const t = document.createElement("span");
    t.textContent = d.ox;
    push(up, "／", t);
  }
  box.append(cap("「強い酸化剤」として習うもの（酸性条件。この中の細かい順位は覚えなくてよい）"), up);
  const cut = document.createElement("hr");
  cut.className = "ladderCut";
  box.appendChild(cut);
  // 下半分 — イオン化傾向そのもの。金属は太字、あいだに挟まるだけのものはうすい字
  const down = band();
  for (const e of entries.filter((x) => x.r <= topMetal)) {
    const t = document.createElement("span");
    if (e.metal) {
      t.className = "metal";
      t.textContent = e.metal === "H" ? "(H)" : e.metal;   // イオン化傾向の書き方にそろえる
    } else {
      const d = coupleDisp(e.c);
      t.className = "other";
      t.textContent = d ? d.ox + "/" + d.red : e.c;
    }
    push(down, "＞", t);
  }
  box.append(cap("ここから下は、覚えているイオン化傾向そのもの"), down);
  const note = document.createElement("div");
  note.className = "ladderNote";
  const b = document.createElement("strong");
  b.textContent = "下半分は、覚えているイオン化傾向そのものです。";
  note.append(b, document.createTextNode(
    "上半分は「強い酸化剤」として習うものが並んでいるだけで、上下の細かい順位まで覚える必要はありません" +
    "（このアプリが判定に使っているだけです）。うすい字のものは金属の列のあいだに入るだけで、" +
    "これも覚える対象ではありません。"));
  box.appendChild(note);
  /* この梯子は酸性条件のもの（REDOX_LADDER_ACID）。中性・塩基性を選んでいるときに
     黙って同じ表を見せると「どの液性でもこの順位」という嘘になるので、その場で断る。 */
  if (currentCondition() !== "acid") {
    const w = document.createElement("div");
    w.className = "ladderNote";
    w.textContent = "いま選んでいるのは中性・塩基性ですが、この順位の表は酸性条件のものです。" +
      "中性・塩基性の順位はこのアプリでは持っていません（高校では順位まで扱わないため）。";
    box.appendChild(w);
  }
  return box;
}

/* 判定の根拠。**既定は2行だけ**（§9-2 A案）。全体は「梯子の全体を見る」を
   押したときだけ開き、開閉の状態は覚えない（毎回閉じた状態で始める）。 */
function renderWhy(oxReagentId, redReagentId, res) {
  pickWhyEl.innerHTML = "";
  pickWhyEl.hidden = false;
  const a = reagentById(oxReagentId), b = reagentById(redReagentId);
  // 欄の取り違えは matchRedox が side でそろえるので、根拠の表示でも同じようにそろえる
  const oxRg = a && b && a.side !== b.side ? (a.side === "ox" ? a : b) : null;
  const redRg = a && b && a.side !== b.side ? (a.side === "ox" ? b : a) : null;
  const cond = currentCondition();
  const oxHalf = oxRg ? halfOfReagent(oxRg, cond) : null;
  const redHalf = redRg ? halfOfReagent(redRg, cond) : null;
  const rOx = oxHalf ? rankOfHalf(oxHalf) : null;
  const rRed = redHalf ? rankOfHalf(redHalf) : null;
  /* 2行を出してよいのは、**その2つの順位で決着したとき**だけ。
     例外表や許可リストで決まった結果に順位の2行を添えると、
     「順位でそう決まった」という嘘になる。 */
  const ranked = rOx !== null && rRed !== null && rOx !== rRed;
  const usedLadder = ranked &&
    (res.reasonCode === "ladder-reversed" || (res.verdict === "reacts" && rOx > rRed));
  const head = document.createElement("div");
  head.className = "whyHead";
  if (usedLadder) {
    head.textContent = "判定に使ったのは、この2つの順位だけ";
    pickWhyEl.appendChild(head);
    const pair = document.createElement("div");
    pair.className = "ladderPair";
    [{ c: coupleOf(oxHalf), r: rOx }, { c: coupleOf(redHalf), r: rRed }]
      .sort((a, b) => b.r - a.r)
      .forEach((row, i) => {
        const d = document.createElement("div");
        d.className = "lrow" + (i === 0 ? " top" : "");
        const f = document.createElement("span");
        const cd = coupleDisp(row.c);
        f.textContent = cd ? cd.ox : row.c;
        d.appendChild(f);
        if (i === 0) {
          const n = document.createElement("span");
          n.className = "lnote";
          n.textContent = "こちらのほうが e⁻ を奪う力が強い";
          d.appendChild(n);
        }
        pair.appendChild(d);
      });
    pickWhyEl.appendChild(pair);
  } else {
    head.textContent =
      res.verdict === "reacts" ? "順位ではなく、このアプリが収録している組み合わせとして扱っている。"
      : res.reasonCode === "same-role" ? "役が同じなので、強さの順位を比べる場面ではない。"
      : res.reasonCode === "exception" ? "順位のうえでは進む向きだが、別のことが先に起きて止まる。"
      : res.reasonCode === "wrong-condition" ? "液性がそろっていないので、強さを比べる前の段階。"
      : res.reasonCode === "not-listed" && ranked ? "順位はあるが、この相手との組み合わせまでは言い切らないことにしている。"
      : "この組み合わせは、強さの順位では決めていない。";
    pickWhyEl.appendChild(head);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ladderToggle";
  btn.setAttribute("aria-expanded", "false");
  btn.textContent = "▸ 梯子の全体を見る";
  const full = buildLadderFull();
  btn.onclick = () => {
    full.hidden = !full.hidden;
    btn.setAttribute("aria-expanded", String(!full.hidden));
    btn.textContent = (full.hidden ? "▸ " : "▾ ") + "梯子の全体を見る";
  };
  pickWhyEl.append(btn, full);
}

function initStage() {
  mult = [1, 1];
  added = 0;
  cleared = false;
  soloMode = null;
  clearEl.hidden = true;
  buildStageNav();
  buildToolbar();
  buildSheetSkeleton();
  stageTitleEl.innerHTML = freeStage
    ? `<strong>自由に組み合わせる：${freeStage.title}</strong>`
    : (FREE ? "<strong>自由に組み合わせる</strong>" : `<strong>${stageLabel(stageIdx)}</strong>`);
  buildHalfRow(SHEET.ox, oxHR(), 0, "還元剤");
  buildHalfRow(SHEET.red, redHR(), 1, "酸化剤");
  layoutLab();
  updateETally();
  buildRedoxSchematic();
  updateCleaveStep();
  updateSheetTail();
  setMsg(stage().intro);
  // 段の出し入れを全部済ませたあとで、自由モードの都合を最後にかぶせる
  // （updateSheetTail などが「出す」と決めた段を、選ぶ前は見せないため）
  updatePickVisibility();
}

/* テスト・監査用フック */
window.RedoxEq = {
  advance(ms) {
    let remaining = ms;
    while (remaining > 0) {
      const chunk = Math.min(1000, remaining);
      tick(lastT + chunk);
      remaining -= chunk;
    }
  },
  state() {
    const counts = {};
    for (const p of particles) counts[p.sp] = (counts[p.sp] || 0) + 1;
    const st = molStep();
    return {
      phase, cleared, runExact, stageIdx, soloMode,
      // 筆算④⑤行目「傍観イオンを両辺に足して化学反応式へ」（登録がある反応のみ）
      added,
      spectatorNeed: st ? st.need : null,
      molOk: !!(st && st.ok),
      molCoeffs: st && st.ok ? st.coeffs : [],
      mult: [...mult],
      poolE: poolE.length,
      waiting: units.filter((u) => u.waiting).length,
      deposited,
      escaped: Object.assign({}, escaped),
      counts,
    };
  },
  /* 自由組み立てモード（?free=1）のフック。判定そのものは model.js が持つので、
     ここで見るのは「画面に何が出たか」だけ。 */
  free: {
    on: FREE,
    /* 液性は省略すると「いま選ばれているもの」のまま（既定は酸性）。
       明示すればラジオを切り替えてから試す。 */
    setCondition(cond) {
      const r = pickCondEl.querySelector('input[value="' + cond + '"]');
      if (!r) throw new Error("そんな液性は無い: " + cond);
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
    },
    pick(oxReagentId, redReagentId, cond) {
      if (cond) this.setCondition(cond);
      pickOxEl.value = oxReagentId;
      pickRedEl.value = redReagentId;
      showReagentNotes();
      clearVerdict();
      pickOxEl.value = oxReagentId;
      pickRedEl.value = redReagentId;
      pickGoEl.click();
      return lastVerdict;
    },
    toggleLadder() { pickWhyEl.querySelector(".ladderToggle").click(); },
    /* 収録ステージへの橋を押す（その場で収録ステージに切り替わる） */
    openBridge(stageId) {
      const b = pickBridgeEl.querySelector(
        stageId ? '.bridgeLink[data-stage="' + stageId + '"]' : ".bridgeLink");
      if (!b) throw new Error("その橋は出ていない: " + stageId);
      b.click();
    },
    /* 橋の描画を**半反応式2本で直接**叩く（試薬を経由しない）。
       ヨードホルムの2本（iodoform_ox / I2_red）は切り離した断片が出発点で
       **試薬としては選べない**ので、「同じ (ox, red) のステージが複数」という
       いちばん壊れやすい場合を、ピッカー経由では一度も通れない。
       1件だけ拾う実装に戻っていないことを画面側でも見張るための口。 */
    bridgeIdsFor(oxHalfId, redHalfId) {
      const box = document.createElement("div");
      buildStageBridge(box, oxHalfId, redHalfId);
      return [...box.querySelectorAll(".bridgeLink")].map((b) => b.dataset.stage);
    },
    state: () => ({
      condition: currentCondition(),
      condNote: pickCondNoteEl.textContent,
      condLinks: [...document.querySelectorAll("#stepPick a.condLink")].map((a) => a.getAttribute("href")),
      pickShown: !stepPickEl.hidden,
      step1Shown: !step1El.hidden,
      step2Shown: !step2El.hidden,
      stageId: stage().id,
      freeStage: freeStage ? freeStage.id : null,
      answer: stage().answer ? [...stage().answer] : null,
      options: {
        ox: [...pickOxEl.options].map((o) => o.value),
        red: [...pickRedEl.options].map((o) => o.value),
      },
      verdict: lastVerdict && lastVerdict.verdict,
      reasonCode: lastVerdict ? lastVerdict.reasonCode : undefined,
      msg: pickMsgEl.firstChild ? pickMsgEl.firstChild.textContent : "",
      msgKind: ["ok", "ng", "info"].filter((k) => pickMsgEl.classList.contains(k)).join(""),
      fix: pickMsgEl.querySelector(".pickFix") ? pickMsgEl.querySelector(".pickFix").textContent : "",
      bridgeShown: !pickBridgeEl.hidden,
      bridge: [...pickBridgeEl.querySelectorAll(".bridgeLink")].map((b) => b.dataset.stage),
      bridgeText: pickBridgeEl.textContent,
      whyShown: !pickWhyEl.hidden,
      whyPair: [...pickWhyEl.querySelectorAll(".ladderPair .lrow")].map((r) => r.firstChild.textContent),
      ladderOpen: !!pickWhyEl.querySelector(".ladderFull:not([hidden])"),
      ladderTop: [...pickWhyEl.querySelectorAll(".ladderBand")].slice(0, 1)
        .flatMap((b) => [...b.children].filter((c) => !c.classList.contains("sep")).map((c) => c.textContent)),
      ladderMetals: [...pickWhyEl.querySelectorAll(".ladderBand .metal")].map((c) => c.textContent),
      ladderBandText: [...pickWhyEl.querySelectorAll(".ladderBand")].map((b) => b.textContent),
    }),
  },
};

/* 反応インデックスからのディープリンク（redox.html?rxn=<id>）。該当ステージを開く */
const rxnParam = new URLSearchParams(location.search).get("rxn");
if (rxnParam) {
  const i = REDOX_STAGES.findIndex((s) => s.id === rxnParam);
  if (i >= 0) stageIdx = i;
}

if (FREE) { freeIdle = true; buildPicker(); }
initStage();
requestAnimationFrame(frame);

})();
