"use strict";
/* app.js — UI・SVG描画・粒子アニメーション。
   粒子の座標や動きは見た目専用。正否判定は model.js の個数・原子数集計のみで行う。 */
(() => {

const SVG_NS = "http://www.w3.org/2000/svg";

const beakerSvg   = document.getElementById("beaker");
const toolbarEl   = document.getElementById("toolbar");
const ionCountsEl = document.getElementById("ionCounts");
const msgEl       = document.getElementById("msg");
const equationEl  = document.getElementById("equation");
const eqMsgEl     = document.getElementById("eqMsg");
const tallyEl     = document.getElementById("tally");
const netionEl    = document.getElementById("netion");
const clearEl     = document.getElementById("clearBanner");
const stageNavEl  = document.getElementById("stageNav");
const stageTitleEl = document.getElementById("stageTitle");
const addedFormulaEl = document.getElementById("addedFormula");

/* ビーカー内の水の領域（SVG座標） */
const WATER = { x: 55, y: 145, w: 370, h: 245 };
/* 沈殿が積もるビーカーの底（水面下・ガラスの底の内側） */
const FLOOR_Y = 396;
/* C群の気体ステージで粒が動ける四角い空間（水より高い位置まで使える）。
   生成物を2列に分けても収まる高さにしている */
const GAS_AREA = { x: 55, y: 95, w: 370, h: 310 };
/* いまのステージで粒が動ける領域 */
function area() {
  return STAGES[stageIdx].phase === "gas" ? GAS_AREA : WATER;
}

const STYLE = {
  "H+":     { color: "#d95757", r: 15 },
  "Na+":    { color: "#e08a3c", r: 17 },
  "Ca^2+":  { color: "#b8792e", r: 18 },
  "Ag+":    { color: "#8f9aa8", r: 17 },
  "Ba^2+":  { color: "#4f9d6b", r: 18 },
  "OH-":    { color: "#4d78d8", r: 18 },
  "Cl-":    { color: "#3f9fc9", r: 17 },
  "SO4^2-": { color: "#7a68d8", r: 21 },
  "NO3-":   { color: "#4f9fae", r: 20 },
  "K+":     { color: "#a86bc9", r: 17 },
  "Cu^2+":  { color: "#4a90d9", r: 17 },
  "SO3^2-": { color: "#8a5fd0", r: 20 },
  "CO3^2-": { color: "#9268c8", r: 21 },
  "H2O":    { color: "#c2e2f4", r: 15, darkText: true },
  "H2CO3":  { color: "#c9d6a3", r: 22, darkText: true },
  "CO2":    { color: "#e4f2f7", r: 16, darkText: true },
  "AgCl":   { color: "#f0f0f0", r: 18, darkText: true },
  "BaSO4":  { color: "#f5f2ea", r: 20, darkText: true },
  "NaHSO4": { color: "#f3eee2", r: 21, darkText: true },
  "NaHCO3": { color: "#eef0e2", r: 21, darkText: true },
  "HCO3-":  { color: "#6aa0b8", r: 20 },
  "NH3":    { color: "#7fa8d8", r: 17 },
  // 錯イオン（配位子が結びついた姿。式が長いので円は大きめ）
  "Cu(NH3)4^2+": { color: "#1f4fbf", r: 27 },
  "Ag(NH3)2^+":  { color: "#8d97a6", r: 25 },
  // 両性水酸化物 系
  "Al^3+":       { color: "#7189a6", r: 17 },
  "Zn^2+":       { color: "#5d7d9d", r: 17 },
  "Al(OH)3":     { color: "#f2f4f6", r: 21, darkText: true },
  "Zn(OH)2":     { color: "#eef1f3", r: 20, darkText: true },
  "Al(OH)4^-":   { color: "#6f86a8", r: 24 },
  "Zn(OH)4^2-":  { color: "#5f7f9f", r: 25 },
  // 弱酸（酢酸）系
  "CH3COOH":     { color: "#c9a86a", r: 24, darkText: true },
  "CH3COO-":     { color: "#b8935a", r: 23 },
  "CH3COONa":    { color: "#d8c191", r: 24, darkText: true },
  // 弱塩基（アンモニア）系
  "NH4+":        { color: "#6f93cf", r: 19 },
  "NH4Cl":       { color: "#b8c8de", r: 21, darkText: true },
  // C群: ばらけた原子（元素色に合わせる）
  "H":           { color: "#eceff1", r: 13, darkText: true },
  "O":           { color: "#e06055", r: 15 },
  "C":           { color: "#565c64", r: 15 },
};
const MOLECULE_STYLE = { color: "#8a8f98", r: 20 };

/* 房表示の原子の元素色（全モード共通の見た目ルール）。dark はラベルを濃色にする */
const ELEMENT_STYLE = {
  H:  { color: "#eceff1", dark: true, stroke: "#90a0ab" },
  K:  { color: "#a86bc9" },
  Cu: { color: "#c47a3c" },
  O:  { color: "#e06055" },
  C:  { color: "#565c64" },
  N:  { color: "#5b8def" },
  S:  { color: "#e6c34a", dark: true },
  Cl: { color: "#58b184" },
  Na: { color: "#e08a3c" },
  Ca: { color: "#b8792e" },
  Ag: { color: "#a6adb8", dark: true },
  Ba: { color: "#4f9d6b" },
};

/* 房の外接半径（運動・境界判定に使う。座標は見た目専用でも半径は接触に使う） */
function structExtent(struct) {
  if (struct.env) return struct.env;
  return Math.max(...struct.atoms.map((a) => Math.hypot(a.x, a.y) + a.r));
}
const CHIP_ORDER = ["H+", "OH-", "Ag+", "Ba^2+", "Na+", "Ca^2+", "Cu^2+", "Cl-", "NO3-", "SO4^2-", "CO3^2-", "HCO3-", "NH3", "H2O", "H2CO3", "CO2", "AgCl", "BaSO4", "NaHSO4", "NaHCO3", "Cu(NH3)4^2+", "Ag(NH3)2^+",
  "Al^3+", "Zn^2+", "Al(OH)3", "Zn(OH)2", "Al(OH)4^-", "Zn(OH)4^2-",
  "CH3COOH", "CH3COO-", "CH3COONa", "NH4+", "NH4Cl", "C2H6", "C3H8",
  "C", "H", "O", "CH4", "O2", "H2"];
/* 生成後に泡となって水面へ逃げる気体 */
const BUBBLE_SPECIES = new Set(["CO2", "SO2"]);

let stageIdx = 0;
let particles = [];
let groups = [];
let escaped = {};
let nextId = 1;
let addedCount = {};
let producedCount = {};   // ルールの生成物として作られた種の数（余り判定から差し引く）
let madeCount = 0;
let simTime = 0;          // 演出用の内部時計（秒）
let events = [];          // schedule() で積む予定
let gasAligned = false;   // C群: 反応前の整列が済んだか
let productSlot = 0;      // C群: 生成物を並べる位置
let productCount = {};    // C群: 種類ごとにできた数（種類ごとに並べるため）
let atomSlotCount = 0;    // C群: ばらけた原子を並べる位置
let sequenceRunning = 0;  // 段取り演出（沈殿の再溶解など）の実行中カウント
let reactionZone = null;  // 演出中の反応の場。傍観イオンを近づけない
let coeffs = [];
let coeffEls = [];
let coeffOk = false;
let reactionDone = false;
let cleared = false;
let particleLayer = null;

const rnd = (a, b) => a + Math.random() * (b - a);

/* delay 秒後に fn を実行する（演出の段取り用。advance() で決定論的に進む） */
function schedule(delay, fn) {
  events.push({ at: simTime + delay, fn });
}

function isGasStage() {
  return STAGES[stageIdx].phase === "gas";
}

/* C群の投入上限。模範係数は必ず入力できるようにし、少し余裕を持たせる */
function gasInputCap() {
  const stage = STAGES[stageIdx];
  return Math.max(4, Math.max(...stage.answer) + 1);
}

/* 原子までほどくと画面に並びきらない反応は、分子どうしの組み替えとして簡易表示する。
   1列に読める原子数の目安を8個とし、それを超えるなら簡易モード（stage.animMode で上書き可）。 */
function useSimpleGas() {
  const stage = STAGES[stageIdx];
  if (stage.animMode) return stage.animMode === "simple";
  const nL = stage.reactants.length;
  const atomsOf = (sp) => Object.values(SPECIES[sp].atoms).reduce((a, b) => a + b, 0);
  const top = atomsOf(stage.reactants[0]);
  const bottom = atomsOf(stage.reactants[1]) * Math.ceil(stage.answer[1] / stage.answer[0]);
  return nL >= 2 && (top > 8 || bottom > 8);
}


function mk(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  (parent || beakerSvg).appendChild(el);
  return el;
}

/* ---- ビーカー静的描画 ---- */

function drawBeakerStatic() {
  beakerSvg.innerHTML = "";
  const gas = STAGES[stageIdx].phase === "gas";
  if (gas) {
    // C群: 水溶液ではないのでビーカーではなく「閉じた四角い容器（気体の空間）」で描く
    mk("rect", {
      x: 45, y: WATER.y - 60, width: 390, height: 330, rx: 6,
      fill: "#fbf7ef", stroke: "#7c8792", "stroke-width": 4,
    });
    const t = mk("text", { x: 240, y: WATER.y - 40, "text-anchor": "middle", "font-size": 12, fill: "#b0a08a" });
    t.textContent = "気体の空間（水にとけていない）";
    return;
  }
  // 水
  mk("rect", { x: 49, y: WATER.y, width: 382, height: 250, rx: 8, fill: "#eaf5fc" });
  mk("line", { x1: 49, y1: WATER.y, x2: 431, y2: WATER.y, stroke: "#a9cfe4", "stroke-width": 2 });
  // ガラス（上が開いた輪郭）
  mk("path", {
    d: "M 45 75 L 45 385 Q 45 410 70 410 L 410 410 Q 435 410 435 385 L 435 75",
    fill: "none", stroke: "#7c8792", "stroke-width": 4, "stroke-linecap": "round",
  });
}

/* ---- 粒子 ---- */

/* 式の末尾の電荷（右肩の ⁺ ⁻ ²⁺ など）を外す。下付きの ₄ などは式の一部なので残す。
   電荷は丸バッジで示すため、円内の表示と二重にならないようにする */
function stripCharge(disp) {
  return disp.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+$/u, "");
}

function addChargeBadge(g, r, charge, strokeColor) {
  const btxt = (Math.abs(charge) > 1 ? String(Math.abs(charge)) : "") + (charge > 0 ? "+" : "−");
  const bx = r * 0.8, by = -r * 0.8;
  mk("circle", { cx: bx, cy: by, r: 9.5, fill: "#fff", stroke: strokeColor, "stroke-width": 1.5 }, g);
  const bt = mk("text", { x: bx, y: by + 4.2, "text-anchor": "middle", "font-size": 12, fill: "#333", "font-weight": "bold" }, g);
  bt.textContent = btxt;
}

/* 構成イオンを枠に収めた姿の配置を計算する（見た目専用）。
   4個以上は2段に折り返す。返り値の r は当たり判定にも使う外接半径 */
function compositionLayout(sp) {
  const parts = COMPOSITION[sp];
  const pad = 5;
  const geo = COORDINATION[sp];
  if (geo) {
    // 錯イオン: 中心イオンのまわりに配位子を対称に並べ、立体構造が図から分かるようにする
    const rc = 12, rl = 10;
    const offs = COORDINATION_OFFSETS[geo];
    const slots = [{ sp: parts[0], x: 0, y: 0, r: rc }];
    parts.slice(1).forEach((s, i) => {
      const o = offs[i % offs.length];
      slots.push({ sp: s, x: o[0], y: o[1], r: rl });
    });
    const rx = Math.max(...slots.map((s) => Math.abs(s.x) + s.r)) + pad;
    const ry = Math.max(...slots.map((s) => Math.abs(s.y) + s.r)) + pad;
    return { parts, slots, rx, ry, pad, geo, r: Math.hypot(rx, ry) };
  }
  // 沈殿など: 構成イオンを1〜2段に並べる
  const ri = 11, gap = 3;
  const cols = parts.length <= 3 ? parts.length : Math.ceil(parts.length / 2);
  const rows = parts.length <= 3 ? 1 : 2;
  const w = cols * (2 * ri + gap) - gap;
  const h = rows * (2 * ri + gap) - gap;
  const slots = parts.map((s, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    return {
      sp: s, r: ri,
      x: -w / 2 + ri + c * (2 * ri + gap),
      y: -h / 2 + ri + r * (2 * ri + gap),
    };
  });
  return { parts, slots, rx: w / 2 + pad, ry: h / 2 + pad, pad, r: Math.hypot(w / 2 + pad, h / 2 + pad) };
}

function makeParticleEl(p) {
  const g = mk("g", { class: "particle" }, particleLayer);
  const spec = SPECIES[p.sp];
  const tip = mk("title", {}, g);
  tip.textContent = `${spec.disp}（${spec.name}）`;
  // 沈殿・錯イオンは「もとの構成イオンが枠に入った姿」で描く（〇枠＝イオン／□枠＝沈殿）
  if (COMPOSITION[p.sp]) {
    const L = compositionLayout(p.sp);
    const solid = SOLID_SPECIES.has(p.sp);
    if (solid) {
      mk("rect", {
        x: -L.rx, y: -L.ry, width: L.rx * 2, height: L.ry * 2, rx: 5,
        fill: "rgba(120,130,140,.14)", stroke: "#6b7681", "stroke-width": 2,
      }, g);
    } else {
      const warm = spec.charge > 0;
      mk("ellipse", {
        rx: L.rx, ry: L.ry,
        fill: warm ? "rgba(224,138,60,.13)" : "rgba(77,120,216,.12)",
        stroke: warm ? "rgba(224,138,60,.75)" : "rgba(77,120,216,.7)",
        "stroke-width": 1.5,
      }, g);
    }
    for (const slot of L.slots) {
      const cs = STYLE[slot.sp] || MOLECULE_STYLE;
      mk("circle", { cx: slot.x, cy: slot.y, r: slot.r, fill: cs.color, stroke: "rgba(0,0,0,.25)", "stroke-width": 1 }, g);
      const d = SPECIES[slot.sp].disp;
      const t = mk("text", {
        x: slot.x, y: slot.y + 3.5, "text-anchor": "middle",
        "font-size": d.length > 3 ? 8.5 : 10.5,
        fill: cs.darkText ? "#3a4a55" : "#fff", "font-weight": "bold",
      }, g);
      t.textContent = d;   // 構成イオンは電荷つきで読ませる（外枠にバッジが無い位置なので重複しない）
    }
    if (spec.charge !== 0) addChargeBadge(g, L.r * 0.78, spec.charge, "#e08a3c");
    return g;
  }
  const struct = STRUCTURE[p.sp];
  if (struct) {
    // 房表示: 多原子イオンは包み＋全体電荷、分子は裸の原子クラスタ
    const c = spec.charge;
    if (c !== 0) {
      const warm = c > 0;
      mk("circle", {
        r: struct.env,
        fill: warm ? "rgba(224,138,60,.13)" : "rgba(77,120,216,.12)",
        stroke: warm ? "rgba(224,138,60,.75)" : "rgba(77,120,216,.7)",
        "stroke-width": 1.5,
      }, g);
    }
    for (const a of struct.atoms) {
      const es = ELEMENT_STYLE[a.el] || { color: "#8a8f98" };
      mk("circle", { cx: a.x, cy: a.y, r: a.r, fill: es.color, stroke: es.stroke || "rgba(0,0,0,.2)", "stroke-width": 1 }, g);
      const t = mk("text", {
        x: a.x, y: a.y + (a.r >= 8 ? 3.5 : 3), "text-anchor": "middle",
        "font-size": a.r >= 8 ? 10 : 8,
        fill: es.dark ? "#3a4a55" : "#fff", "font-weight": "bold",
      }, g);
      t.textContent = a.el;
    }
    if (c !== 0) addChargeBadge(g, p.r, c, c > 0 ? "#e08a3c" : "#4d78d8");
    return g;
  }
  const st = STYLE[p.sp] || MOLECULE_STYLE;
  mk("circle", { r: p.r, fill: st.color, stroke: "rgba(0,0,0,.25)", "stroke-width": 1.5 }, g);
  // 電荷はバッジで示すので、円内の式からは電荷の右肩文字を外す（Na⁺ と ＋ の二重表示を防ぐ）
  const disp = spec.charge !== 0 ? stripCharge(spec.disp) : spec.disp;
  const label = mk("text", {
    y: 5, "text-anchor": "middle",
    "font-size": disp.length > 4 ? 13 : 14.5,
    fill: st.darkText ? "#23506b" : "#fff",
    "font-weight": "bold",
  }, g);
  label.textContent = disp;
  if (spec.charge !== 0) addChargeBadge(g, p.r, spec.charge, st.color);
  return g;
}

function spawnParticle(sp, x, y, mode) {
  const st = STYLE[sp] || MOLECULE_STYLE;
  const struct = STRUCTURE[sp];
  const p = {
    id: nextId++, sp, x, y,
    vx: rnd(-40, 40), vy: rnd(-30, 30),
    r: COMPOSITION[sp] ? compositionLayout(sp).r : struct ? structExtent(struct) : st.r,
    // hr/hw = 見た目の高さ・幅の半分。横長の枠は r（外接半径）より小さいので、
    // 着地位置や重なり判定はこちらで見る
    hr: COMPOSITION[sp] ? compositionLayout(sp).ry : struct ? structExtent(struct) : st.r,
    hw: COMPOSITION[sp] ? compositionLayout(sp).rx : struct ? structExtent(struct) : st.r,
    mode, partner: null, dead: false,
    born: performance.now(),
  };
  p.el = makeParticleEl(p);
  if (isDraggable(sp)) p.el.classList.add("draggable");
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

function countOf(sp) {
  return particles.filter((p) => !p.dead && p.sp === sp).length;
}

/* ---- 物理（見た目専用） ---- */

/* 粒が沈める下端。水溶液はビーカーの底、気体は箱の底 */
function bottomY() {
  return STAGES[stageIdx].phase === "gas" ? GAS_AREA.y + GAS_AREA.h : FLOOR_Y;
}

function clampToWater(p) {
  const A = area();
  const hr = p.hr || p.r;
  const minX = A.x + p.r, maxX = A.x + A.w - p.r;
  const minY = A.y + hr + 6, maxY = bottomY() - hr;
  if (p.x < minX) p.x = minX;
  if (p.x > maxX) p.x = maxX;
  if (p.y < minY) p.y = minY;
  if (p.y > maxY) p.y = maxY;
}

/* 粒子がめり込まないように押し離す（位置補正のみ・見た目専用）。
   aShare=1 なら a だけが動く（相手が沈殿などの固定物のとき） */
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

function separateParticles() {
  // 移動中の粒（seek/moveTo）は押し離さない。
  // 押すと目的地にたどり着けず反応が止まってしまうため（v72 で作り込んで撤回した不具合）
  const movers = particles.filter((p) => p.mode === "float" || p.mode === "pop");
  // settled（沈殿）と still（C群で整列して待つ粒）は動かさない固定物として扱う
  const solids = particles.filter((p) => p.mode === "settled" || p.mode === "still");
  for (let i = 0; i < movers.length; i++) {
    const a = movers[i];
    for (let j = i + 1; j < movers.length; j++) pushApart(a, movers[j], 0.5);
    for (const s of solids) pushApart(a, s, 1);
    clampToWater(a);
  }
}

function floatMove(p, dt) {
  p.vx += rnd(-1, 1) * 130 * dt;
  p.vy += rnd(-1, 1) * 130 * dt;
  const sp = Math.hypot(p.vx, p.vy), max = 55;
  if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  const A = area();
  const hr = p.hr || p.r;
  const minX = A.x + p.r, maxX = A.x + A.w - p.r;
  const minY = A.y + hr + 6, maxY = bottomY() - hr;
  if (p.x < minX) { p.x = minX; p.vx = Math.abs(p.vx); }
  if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx); }
  if (p.y < minY) { p.y = minY; p.vy = Math.abs(p.vy); }
  if (p.y > maxY) { p.y = maxY; p.vy = -Math.abs(p.vy); }
  // 演出中の反応の場には傍観イオンを入れない（何が反応しているか見やすくする）
  if (reactionZone && !p.busy) {
    const dx = p.x - reactionZone.x, dy = p.y - reactionZone.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (d < reactionZone.r) {
      p.x = reactionZone.x + (dx / d) * reactionZone.r;
      p.y = reactionZone.y + (dy / d) * reactionZone.r;
      p.vx = (dx / d) * 30; p.vy = (dy / d) * 30;
      clampToWater(p);
    }
  }
}

function dissociateMolecule(p) {
  const { x, y, sp } = p;
  // 弱電解質（酢酸など）は電離せず分子のまま溶かす。C群の気体も分子のまま漂わせる。
  // どちらも「反応の相手が来たときに初めて分かれる」（breakApart）
  if (WEAK_ELECTROLYTES[sp] || STAGES[stageIdx].phase === "gas") {
    splash(x, y);
    p.mode = "pop";
    p.born = performance.now();
    p.vx = rnd(-40, 40); p.vy = rnd(-30, 10);
    // 「電離しかけてはもどる」ゆらぎは弱電解質だけの表現（気体分子には付けない）
    if (WEAK_ELECTROLYTES[sp]) p.el.classList.add("weak");
    refreshHUD();
    return;
  }
  removeParticle(p);
  splash(x, y);
  // 水溶液は電離する。電離表に無ければ分子のまま溶ける（NH₃ など）
  const ions = DISSOCIATION[sp] || [sp];
  ions.forEach((ion, i) => {
    const q = spawnParticle(ion, x + (i - (ions.length - 1) / 2) * 30, y, "pop");
    q.vx = rnd(-70, 70); q.vy = rnd(-50, 20);
  });
  refreshHUD();
}

/* ---- 沈殿の再溶解を段階的に見せる ----
   一瞬で入れ替わるとイオンの動きが追えないため、次の順で演出する:
   ①沈殿を持ち上げる ②配位子が近づく ③沈殿の枠が消える（構成イオンがほどける）
   ④取り残される OH⁻ が横へ離れる ⑤中心イオンに配位子が取り付いて錯イオン ⑥OH⁻ が泳ぎだす */

/* このルールは「沈殿が試薬で溶ける」タイプか */
function isDissolveRule(rule) {
  return rule.kind === "complex" && rule.find.some((sp) => SOLID_SPECIES.has(sp));
}

function runDissolveSequence(g) {
  groups = groups.filter((o) => o !== g);
  const members = particles.filter((p) => g.memberIds.includes(p.id));
  const solid = members.find((p) => SOLID_SPECIES.has(p.sp));
  const incoming = members.filter((p) => p !== solid);
  if (!solid) { mergeGroup(g, performance.now()); return; }
  // 通常の「集合して合体」ではなく段取りで動かすので、seek から外し、
  // 演出中は他の反応に巻き込まれないよう busy にする
  members.forEach((m) => { m.mode = "still"; m.group = null; m.busy = true; });
  sequenceRunning++;

  const makes = Array.isArray(g.rule.make) ? g.rule.make : [g.rule.make];
  const complexSp = makes[0];
  const comp = COMPOSITION[solid.sp];           // 沈殿の構成イオン（中心＋くっついていたイオン）
  const L = compositionLayout(complexSp);       // 錯イオンの配置（slots[0]=中心、以降=配位子）
  const ligSlots = L.slots.slice(1);

  const hx = Math.min(Math.max(solid.x, WATER.x + 120), WATER.x + WATER.w - 120);
  const hy = WATER.y + 95;
  // 演出中は傍観イオンを近づけない（何が反応しているか分かりにくくなるため）
  reactionZone = { x: hx, y: hy, r: 118 };

  // ① 沈殿を持ち上げる
  solid.mode = "moveTo"; solid.tx = hx; solid.ty = hy;
  solid.el.classList.add("spotlight");
  setMsg(`沈殿 ${SPECIES[solid.sp].disp} を見てみよう。${SPECIES[incoming[0].sp].disp} が近づいていく…`);

  // ② 沈殿がほどけ、中心イオンを真ん中に、くっついていたイオンを左右に分ける
  let center = null;
  const freed = [];
  const T_UNPACK = 1.1;
  schedule(T_UNPACK, () => {
    if (solid.dead) return;
    removeParticle(solid);
    splash(hx, hy);
    center = spawnParticle(comp[0], hx, hy, "still");
    center.busy = true;
    center.el.classList.add("spotlight");
    const attached = comp.slice(1);
    attached.forEach((sp, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const q = spawnParticle(sp, hx, hy, "moveTo");
      q.busy = true;
      q.tx = hx + side * 62;
      q.ty = hy + (attached.length > 2 ? (k - (attached.length - 1) / 4) * 30 : 0);
      freed.push(q);
    });
    refreshHUD();
    setMsg(`沈殿がほどけて ${SPECIES[comp[0]].disp} と ${SPECIES[comp[1]].disp} に分かれた。`);
  });

  // ③ 配位子を1個ずつ、錯イオンでの定位置へ移動させる（沈殿から出たイオンも使う）
  const assigned = [];
  const released = [];
  const T_ASSIGN = T_UNPACK + 0.9;
  const STEP = 0.42;
  schedule(T_ASSIGN, () => {
    const pool = [...freed, ...incoming].filter((p) => !p.dead);
    ligSlots.forEach((slot, i) => {
      const p = pool.find((q) => q.sp === slot.sp && !assigned.includes(q));
      if (!p) return;
      assigned.push(p);
      schedule(i * STEP, () => {
        p.mode = "moveTo";
        p.tx = hx + slot.x; p.ty = hy + slot.y;
      });
    });
    // 定位置に入れなかったイオンは取り残される（Cu(OH)₂ の OH⁻ など）
    pool.filter((p) => !assigned.includes(p)).forEach((p, i) => {
      released.push(p);
      schedule(0.2 + i * 0.3, () => {
        p.mode = "moveTo";
        p.tx = hx + (i % 2 === 0 ? -1 : 1) * 112;
        p.ty = hy + 40;
      });
    });
    setMsg(released.length
      ? `${SPECIES[assigned[0].sp].disp} が1個ずつ ${SPECIES[comp[0]].disp} に取り付き、${SPECIES[released[0].sp].disp} は取り残される…`
      : `${SPECIES[assigned[0].sp].disp} が1個ずつ ${SPECIES[comp[0]].disp} のまわりに収まっていく…`);
  });

  // ④ 全員が定位置に収まったら、そのままの姿で錯イオンに切り替える（位置が飛ばない）
  const T_SWAP = T_ASSIGN + ligSlots.length * STEP + 0.9;
  schedule(T_SWAP, () => {
    assigned.forEach((p) => { if (!p.dead) removeParticle(p); });
    if (center && !center.dead) removeParticle(center);
    const cx = spawnParticle(complexSp, hx, hy, "still");
    cx.busy = true;
    producedCount[complexSp] = (producedCount[complexSp] || 0) + 1;
    released.forEach((p) => { producedCount[p.sp] = (producedCount[p.sp] || 0) + 1; });
    madeCount++;
    refreshHUD();
    setMsg(`${SPECIES[complexSp].disp} ができて溶けた。` +
      (released.length ? `${SPECIES[released[0].sp].disp} は溶液に残る。` : ""));
    schedule(0.7, () => {
      if (!cx.dead) { cx.busy = false; cx.mode = "float"; cx.vx = rnd(-25, 25); cx.vy = rnd(-20, 20); }
      released.forEach((q) => {
        if (q.dead) return;
        q.busy = false;
        q.mode = "float";
        q.vx = rnd(20, 55) * (q.x < hx ? -1 : 1); q.vy = rnd(-25, 25);
      });
      reactionZone = null;
      sequenceRunning--;
      maybeEvaluate();
    });
  });
}

/* グループ（rule.find の全員）が集合地点にそろったら生成物になる */
function mergeGroup(g, now) {
  groups = groups.filter((o) => o !== g);
  if (isGasStage()) reactionZone = null;   // 反応が済んだら場の確保を解除
  const members = particles.filter((p) => g.memberIds.includes(p.id));
  for (const m of members) removeParticle(m);
  splash(g.tx, g.ty);
  if (g.rule.via) {
    // 不安定な中間体（H₂CO₃ など）を一瞬見せてから分解する
    const mid = spawnParticle(g.rule.via, g.tx, g.ty, "intermediate");
    mid.rule = g.rule;
    mid.decomposeAt = now + 700;
  } else {
    spawnProducts(g.rule, g.tx, g.ty);
  }
  refreshHUD();
  maybeEvaluate();
}

function spawnProducts(rule, x, y) {
  const makes = Array.isArray(rule.make) ? rule.make : [rule.make];
  // 気体の空間（C群）では「水から泡になって逃げる」は起きない。原子が消えて見えないよう浮遊させる
  const gas = isGasStage();
  makes.forEach((sp, i) => {
    const mode = rule.kind === "precipitate" ? "sink" : (!gas && BUBBLE_SPECIES.has(sp)) ? "bubble" : "pop";
    const prod = spawnParticle(sp, x + (i - (makes.length - 1) / 2) * 26, y, mode);
    if (mode === "sink") { prod.vx = 0; prod.vy = 20; }
    if (mode === "bubble") { prod.vx = 0; prod.vy = -30; }
    if (gas) prod.mode = "moveTo";   // 位置はこのあと relayoutGasProducts でまとめて決める
    // 生成物として作られた数を覚えておく（沈殿の再溶解で放出される OH⁻ などを
    // 「反応せずに余ったイオン」と誤って数えないため）
    producedCount[sp] = (producedCount[sp] || 0) + 1;
  });
  if (gas) relayoutGasProducts();
  madeCount++;
}

function decomposeIntermediate(p, now) {
  const { x, y, rule } = p;
  removeParticle(p);
  splash(x, y);
  spawnProducts(rule, x, y);
  refreshHUD();
  maybeEvaluate();
}

function maybeEvaluate() {
  if (sequenceRunning > 0) return;   // 段取り中の演出が終わるまで判定しない
  if (particles.some((o) => o.mode === "seek" || o.mode === "arrivedWait" || o.mode === "intermediate")) return;
  // 沈殿が沈んでいる途中なら、着地を見せてから次の反応へ進む（過程がスキップされないように）
  if (particles.some((o) => o.mode === "sink")) { schedule(0.6, maybeEvaluate); return; }
  // C群はほどく→組むを段取りで進める
  if (isGasStage()) { schedule(0.7, gasStep); return; }
  // できた生成物がさらに反応できるなら続けて反応させる（例: 沈殿ができ→試薬で溶ける の二段変化）。
  // 反応のたびに粒が消費されるので必ず止まる。
  if (launchGroups() > 0) return;
  evaluateReaction();
}

function step(dt, now) {
  // 段階的な演出のためのタイマー（advance() で決定論的に進む）
  simTime += dt;
  if (events.length) {
    const due = events.filter((e) => e.at <= simTime);
    if (due.length) {
      events = events.filter((e) => e.at > simTime);
      due.forEach((e) => e.fn());
    }
  }
  for (const p of [...particles]) {
    if (p.dead) continue;
    if (p.mode === "fall") {
      p.vy += 800 * dt;
      p.y += p.vy * dt;
      if (p.y >= WATER.y + 40) dissociateMolecule(p);
    } else if (p.mode === "seek") {
      const g = p.group;
      // 出発を少し遅らせる原子（後から近づく相手）はその場で待つ
      if (p.seekDelay > 0) { p.seekDelay -= dt; continue; }
      // 簡易モードでは集合地点のまわりに散らして、重ならないようにする
      const dx = g.tx + (p.seekOffX || 0) - p.x, dy = g.ty + (p.seekOffY || 0) - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        p.mode = "arrivedWait";
        g.arrived++;
        if (g.arrived === g.size) mergeGroup(g, now);
        continue;
      }
      // C群はゆっくり近づけて、どれとどれが組んだか目で追えるようにする
      const s = (isGasStage() ? 65 : 150) * dt;
      p.x += (dx / d) * s;
      p.y += (dy / d) * s;
    } else if (p.mode === "arrivedWait") {
      // 集合地点で組の完成を待つ
    } else if (p.mode === "intermediate") {
      if (now >= p.decomposeAt) decomposeIntermediate(p, now);
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
    } else if (p.mode === "sink") {
      p.vy = Math.min(p.vy + 400 * dt, 90);
      p.y += p.vy * dt;
      // ビーカーの底まで沈める（枠の高さぶんだけ浮かせる）
      const floorY = FLOOR_Y - (p.hr || p.r);
      // 底、または先に積もった沈殿の上に乗ったら着地（山になって積もる）。
      // 縦の間隔は**見た目の高さ**で決める（外接半径で離すと、着地位置の制限に
      // 引き戻されて先客にめり込んでいた）
      let rest = false;
      const phr = p.hr || p.r;
      for (const q of particles) {
        if (q === p || q.mode !== "settled") continue;
        const qhr = q.hr || q.r;
        // 横がかぶっているときだけ、その上に積む
        if (Math.abs(q.x - p.x) < (p.r + q.r) * 0.62) {
          const restY = q.y - (phr + qhr) - 2;
          if (p.y > restY) { p.y = restY; rest = true; }
        }
      }
      if (p.y >= floorY) { p.y = floorY; rest = true; }
      if (rest) {
        // 横だけ枠内に収める（縦は積み上げた位置を保つ）
        const A = area();
        p.x = Math.min(Math.max(p.x, A.x + p.r), A.x + A.w - p.r);
        p.vy = 0;
        p.mode = "settled";
      }
    } else if (p.mode === "settled") {
      // 沈殿は底に積もったまま動かない
    } else if (p.mode === "drag") {
      // ドラッグ中はポインタが位置を決めるので物理は止める
    } else if (p.mode === "moveTo") {
      // 決まった位置へ移動し、着いたらその場で待つ（C群の整列）
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) { p.x = p.tx; p.y = p.ty; p.mode = "still"; }
      else {
        const s = Math.min(d, 120 * dt);
        p.x += (dx / d) * s;
        p.y += (dy / d) * s;
      }
    } else if (p.mode === "still") {
      // 相手が来るまでその場で待機（余った原子は泳がせない）。
      // ただし反応の場に入っている粒はよける（何が反応しているか見やすくする）
      if (reactionZone && !p.busy) {
        const dx = p.x - reactionZone.x, dy = p.y - reactionZone.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < reactionZone.r) {
          p.mode = "moveTo";
          p.tx = reactionZone.x + (dx / d) * reactionZone.r;
          p.ty = reactionZone.y + (dy / d) * reactionZone.r;
        }
      }
    } else {
      floatMove(p, dt);
      if (p.mode === "pop" && now - p.born > 300) p.mode = "float";
    }
  }
  separateParticles();
  updateTransforms(now);
  stepStripTweens(dt);
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
  // advance() 使用後は lastT が実時計より先に進むことがある。逆行 dt は無視する
  if (now <= lastT) return;
  let dt = Math.min(1, (now - lastT) / 1000);
  lastT = now;
  // 実経過時間ぶんを 33ms 以下のサブステップで進める（非表示タブのタイマー間引き対策）
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
/* 非表示タブでは rAF が発火しないため、自動テスト・監査でも進むようフォールバックで駆動する */
setInterval(() => {
  const now = performance.now();
  if (now - lastT > 80) tick(now);
}, 66);

/* ---- 操作 ---- */

function addMolecule(sp) {
  if (particles.length > 60) {
    setMsg("ビーカーがいっぱい！「やり直す」で整理しよう。");
    return;
  }
  // C群は分子を列に整列させるため上限を設ける。模範係数は必ず入力できる数にする
  if (isGasStage()) {
    const cap = gasInputCap();
    if ((addedCount[sp] || 0) >= cap) {
      setMsg(`${SPECIES[sp].disp} はこれ以上入らない（この空間に並べられるのは${cap}個まで）。`);
      return;
    }
  }
  addedCount[sp] = (addedCount[sp] || 0) + 1;
  if (!cleared) reactionDone = false;
  const p = spawnParticle(sp, rnd(WATER.x + 50, WATER.x + WATER.w - 50), 95, "fall");
  p.vx = 0; p.vy = 0;
  refreshHUD();
  updateAddedFormula();
}

/* 反応に参加できる粒か。settled（底に積もった沈殿）も対象にすることで
   「沈殿ができる→さらに試薬を加えると溶ける」（沈殿の再溶解）を表現できる。
   沈殿の種がどのルールの find にも無いステージでは、従来どおり選ばれない。 */
function isReactive(p) {
  // busy = 段取り演出に参加中の粒（二重に反応へ巻き込まれないよう除外する）
  if (p.busy) return false;
  // sink（沈降中）も対象。沈み切る前でも試薬が来れば溶け始められる。
  // moveTo/still は C群で整列・待機している分子や原子
  return p.mode === "float" || p.mode === "pop" || p.mode === "settled" || p.mode === "sink" ||
    p.mode === "moveTo" || p.mode === "still";
}

/* members を集合地点へ向かわせるグループを作る（doReact・ドラッグ操作の共通処理） */
/* 原子どうしが組むとき、「できる分子の形」に合わせた位置へ寄せる。
   生成物の房データ（STRUCTURE）を粒の大きさに合わせて広げ、元素の一致する原子を割り当てる。
   房が無い生成物のときは横一列に並べる。 */
function assignAtomSlots(rule, members) {
  const makeSp = Array.isArray(rule.make) ? rule.make[0] : rule.make;
  const st = STRUCTURE[makeSp];
  if (st) {
    // 房は小さく描かれているので、粒（半径13〜15）が軽く触れ合う程度まで広げる
    const SCALE = 1.8;
    const slots = st.atoms.map((a) => ({ el: a.el, x: a.x * SCALE, y: a.y * SCALE, used: false }));
    const seen = {};   // 種類ごとの何個目か（出発をずらすため）
    let ok = true;
    for (const m of members) {
      const slot = slots.find((s) => !s.used && s.el === m.sp);
      if (!slot) { ok = false; break; }
      slot.used = true;
      m.seekOffX = slot.x;
      m.seekOffY = slot.y;
      // 同じ種類の原子（H₂O なら H 2個）が先に寄り添い、そのあと相手（O）が近づく。
      // さらに1個ずつ間を空けて出発させ、同時に動いてすれ違い重なるのを防ぐ
      const order = seen[m.sp] = (seen[m.sp] || 0) + 1;
      m.seekDelay = (m.sp === members[0].sp ? 0 : 0.55) + (order - 1) * 0.3;
    }
    if (ok) return;
  }
  // 房が無い/対応が取れないときは、触れ合う横一列に並べる
  let x = 0;
  const xs = members.map((m, i) => {
    if (i > 0) x += members[i - 1].r + m.r - 3;
    return x;
  });
  const mid = xs[xs.length - 1] / 2;
  members.forEach((m, i) => { m.seekOffX = xs[i] - mid; m.seekOffY = 0; });
}

function makeGroup(rule, members) {
  // C群は「先頭の原子（C や H）のところへ O が近づく」形にすると、何と何が組んだか分かりやすい
  const gas = isGasStage();
  // 原子の反応は2列の中間で組ませる（列の中で組むと、来た原子が待機中の原子を通り抜けてしまう）
  const gasDetailed = gas && !useSimpleGas();
  const g = {
    rule,
    tx: gas ? members[0].x : members.reduce((s, p) => s + p.x, 0) / members.length,
    ty: gas ? members[0].y + (gasDetailed ? GAS_ATOM_ROW_GAP / 2 : 0)
      : members.reduce((s, p) => s + p.y, 0) / members.length,
    size: members.length,
    arrived: 0,
    memberIds: members.map((m) => m.id),
  };
  groups.push(g);
  // C群: 反応の場のまわりを空けて、組んでいる原子だけが見えるようにする
  if (gas) {
    const simple = useSimpleGas();
    // 簡易モードは分子を1点に重ねず、中心の分子のまわりに輪に並べる
    // （何個の分子が反応したのか数えられるように）
    const maxR = Math.max(...members.map((m) => m.r));
    // 近づけて「ひとつの反応」に見せる（輪郭が少し重なるくらいがちょうどよい）
    const ring = 12 + maxR;
    if (simple) {
      members.forEach((m, i) => {
        if (i === 0) { m.seekOffX = 0; m.seekOffY = 0; return; }
        const a = ((i - 1) / (members.length - 1)) * Math.PI * 2 - Math.PI / 2;
        m.seekOffX = Math.cos(a) * ring;
        m.seekOffY = Math.sin(a) * ring * 0.85;
      });
    } else {
      // 原子は「できる分子の形」に並ぶように寄る。
      // H₂O なら H 2個が隣り合った状態に O が近づく形になり、重なったり見失ったりしない
      assignAtomSlots(rule, members);
    }
    members.forEach((m) => { m.busy = true; });
    if (simple) {
      // 分子どうしの反応: まわりの分子を寄せない（数が少ないので場を確保するだけでよい）
      reactionZone = { x: g.tx, y: g.ty, r: ring + maxR + 10 };
    } else {
      // 原子の反応: 待機中の原子は動かさない。
      // （押しのけると押しのけ先で重なり、並べ直すと出ていく原子と交差してしまう。
      //   組になった原子だけが列から抜けていくのが、いちばん追いやすい）
      reactionZone = null;
    }
  }
  for (const m of members) { m.mode = "seek"; m.group = g; }
  // 沈殿の再溶解は段取りを踏んで見せる（一瞬で入れ替わると動きが追えないため）
  if (isDissolveRule(rule)) runDissolveSequence(g);
  return g;
}

/* 「必要になったら分かれる」分子の分解先。
   弱電解質は電離（酢酸→H⁺＋CH₃COO⁻）、C群の気体分子は原子化（CH₄→C＋4H）。
   どちらも「反応の相手が来たときに初めて分かれる」という同じ振る舞いにまとめる */
function donorPartsOf(sp) {
  return WEAK_ELECTROLYTES[sp] || ATOMIZATION[sp] || null;
}

/* 分子を1個ばらして、できた粒の配列を返す。
   弱酸なら「H⁺ が使われると残りがさらに電離して補う」（ルシャトリエ）、
   C群なら「反応の瞬間に分子が原子にほどける」の表現 */
function breakApart(p) {
  const { x, y, sp } = p;
  const parts = donorPartsOf(sp);
  removeParticle(p);
  splash(x, y);
  const gas = isGasStage();
  // ほどけた原子は「分子の中にいた位置」から現れる（同じ点に重ねて出すと団子になる）
  const st = STRUCTURE[sp];
  const BURST = 2.4;
  const burst = st ? st.atoms.map((a) => ({ el: a.el, x: a.x * BURST, y: a.y * BURST, used: false })) : null;
  const bornAt = (s) => {
    if (!burst) return { x, y };
    const slot = burst.find((o) => !o.used && o.el === s);
    if (!slot) return { x, y };
    slot.used = true;
    return { x: x + slot.x, y: y + slot.y };
  };
  const made = parts.map((s, i) => {
    if (gas) {
      // C群: ばらけた原子は由来ごとの列に整列して待つ（泳がせない）
      const slot = gasAtomSlot(sp);
      const b = bornAt(s);
      const q = spawnParticle(s, b.x, b.y, "moveTo");
      q.tx = slot.x; q.ty = slot.y;
      return q;
    }
    const q = spawnParticle(s, x + (i - (parts.length - 1) / 2) * 26, y, "pop");
    q.vx = rnd(-60, 60); q.vy = rnd(-40, 20);
    return q;
  });
  refreshHUD();
  return made;
}

/* ルールが必要とする種の粒を1個みつける。足りないときは分子をばらして供給する。
   freeOnly=true なら分子をばらさず、すでにほどけている粒だけで探す（C群はほどく段取りを分けている） */
function findReactant(sp, used, freeOnly) {
  const cands = particles.filter((o) => o.sp === sp && isReactive(o) && !used.has(o.id));
  // C群は左から順に反応させる（列の中を横切らないので、動きが最短で追いやすい）
  if (cands.length && isGasStage()) {
    return cands.reduce((best, o) => (o.x < best.x ? o : best), cands[0]);
  }
  const p = cands[0];
  if (p) return p;
  if (freeOnly) return null;
  const donor = particles.find((o) => {
    const parts = donorPartsOf(o.sp);
    return isReactive(o) && parts && parts.includes(sp) && !used.has(o.id);
  });
  if (!donor) return null;
  return breakApart(donor).find((q) => q.sp === sp) || null;
}

/* このルールを満たす組をいま用意できるか（分子をばらして得られるぶんも見込んで数える）。
   実際にばらす前に確かめることで、成立しない反応のために分子を壊してしまうのを防ぐ */
function canSatisfy(rule, freeOnly) {
  const avail = {};
  const donors = [];
  for (const o of particles) {
    if (!isReactive(o)) continue;
    if (freeOnly && donorPartsOf(o.sp)) continue;   // ばらす前の分子は数えない
    avail[o.sp] = (avail[o.sp] || 0) + 1;
    if (!freeOnly && donorPartsOf(o.sp)) donors.push(o.sp);
  }
  const need = {};
  for (const sp of rule.find) need[sp] = (need[sp] || 0) + 1;
  for (const sp of Object.keys(need)) {
    while ((avail[sp] || 0) < need[sp]) {
      const i = donors.findIndex((d) => donorPartsOf(d).includes(sp));
      if (i < 0) return false;
      const d = donors.splice(i, 1)[0];   // 1分子は1回しかばらせない
      avail[d]--;
      for (const part of donorPartsOf(d)) avail[part] = (avail[part] || 0) + 1;
    }
  }
  return true;
}

/* そのルールを、いま自由になっている粒（分子をばらさずに使える粒）だけでどれだけ賄えるか。
   大きいほど「すでにほどけた分子を使い切る」選択になり、次々と別の分子を壊さずに済む */
function freeUsage(rule) {
  const avail = {};
  for (const o of particles) {
    if (!isReactive(o) || donorPartsOf(o.sp)) continue;   // ばらす必要のある分子は数えない
    avail[o.sp] = (avail[o.sp] || 0) + 1;
  }
  const need = {};
  for (const sp of rule.find) need[sp] = (need[sp] || 0) + 1;
  return Object.keys(need).reduce((s, sp) => s + Math.min(need[sp], avail[sp] || 0), 0);
}

/* いま反応できる組をすべてグループにする。作った数を返す */
function launchGroups() {
  const stage = STAGES[stageIdx];
  // C群は1組ずつ。かつ「すでにばらけている原子を使い切る」ルールを優先して選び、
  // 分子を次々に壊す（食い散らかす）のを防ぐ
  if (isGasStage()) {
    // 簡易モードは分子のまま（ステージのルールが反応式まるごと1組になっている）。
    // 通常モードはほどけている原子だけで1組ずつ（ほどく作業は別の段取り）
    const freeOnly = !useSimpleGas();
    const candidates = stage.rules.filter((r) => canSatisfy(r, freeOnly));
    if (!candidates.length) return 0;
    candidates.sort((a, b) => freeUsage(b) - freeUsage(a));
    const rule = candidates[0];
    const used = new Set();
    const members = [];
    for (const sp of rule.find) {
      const p = findReactant(sp, used, freeOnly);
      if (!p) return 0;
      used.add(p.id);
      members.push(p);
    }
    makeGroup(rule, members);
    return 1;
  }
  let launched = 0;
  for (const rule of stage.rules) {
    // find は多重集合（例: ["H+","H+","CO3^2-"]）。そろう限りグループを作る
    while (canSatisfy(rule)) {
      const used = new Set();
      const members = [];
      let ok = true;
      for (const sp of rule.find) {
        const p = findReactant(sp, used);
        if (!p) { ok = false; break; }
        used.add(p.id);
        members.push(p);
      }
      if (!ok) break;
      makeGroup(rule, members);
      launched++;
    }
  }
  return launched;
}

/* ---- C群（気体）の段取り: 整列 → 1分子ずつばらして組み替え ---- */

/* 上から: 反応物1の分子・反応物2の分子・ばらけた原子（上列）・生成物。
   原子の下列は「原子の上列＋GAS_ATOM_ROW_GAP」、生成物の2列目は「生成物＋GAS_PROD_ROW_GAP」 */
const GAS_ROW_Y = [34, 94, 150, 235];
const GAS_ATOM_ROW_GAP = 44;
const GAS_PROD_ROW_GAP = 40;

function gasRowY(i) { return GAS_AREA.y + GAS_ROW_Y[Math.min(i, GAS_ROW_Y.length - 1)]; }

/* 反応前に分子を種類ごとの段へ整列させる（どれが反応するか目で追えるように） */
function alignGasMolecules() {
  const stage = STAGES[stageIdx];
  stage.reactants.forEach((sp, row) => {
    const list = particles.filter((p) => p.sp === sp && !p.dead && isReactive(p));
    // 数が多いときは間隔を詰めて、枠からはみ出さないようにする
    const span = GAS_AREA.w - 90;
    const gap = Math.min(62, list.length > 1 ? span / (list.length - 1) : span);
    list.forEach((p, i) => {
      p.mode = "moveTo";
      p.tx = GAS_AREA.x + 45 + i * gap;
      p.ty = gasRowY(row);
    });
  });
}

/* できた分子を下段に並べ直す。**種類ごとにまとめ**、数が多い（2種以上で合計6個超）ときは
   種類ごとに列を分ける。**実際にできた数**をもとに毎回並べ直すので、模範より多くできても
   位置が衝突しない（模範係数を前提に位置を決めると重なる不具合があった） */
function relayoutGasProducts() {
  const stage = STAGES[stageIdx];
  const bySp = stage.products.map((sp) =>
    particles.filter((p) => p.sp === sp && !p.dead &&
      (p.mode === "still" || p.mode === "moveTo" || p.mode === "pop")));
  const total = bySp.reduce((s, list) => s + list.length, 0);
  if (!total) return;
  const span = GAS_AREA.w - 76;
  const twoRows = stage.products.length >= 2 && total > 6;
  let placed = 0;
  bySp.forEach((list, idx) => {
    if (!list.length) return;
    list.sort((a, b) => a.x - b.x);
    const n = twoRows ? list.length : total;
    const gap = Math.min(52, n > 1 ? span / (n - 1) : span);
    list.forEach((p, k) => {
      const seat = twoRows ? k : placed + k;
      p.mode = "moveTo";
      p.tx = GAS_AREA.x + 38 + seat * gap;
      p.ty = gasRowY(3) + (twoRows ? (idx % 2) * GAS_PROD_ROW_GAP : 0);
    });
    placed += list.length;
  });
}

/* ばらけた原子を並べる位置。反応物1（CH₄ など）由来は上列、反応物2（O₂）由来は下列。
   左から順に並べ、左端の組から順に分子になっていくのを見せる */
const atomRowCount = [0, 0];
function gasAtomSlot(fromSp) {
  const row = STAGES[stageIdx].reactants.indexOf(fromSp) === 0 ? 0 : 1;
  const k = atomRowCount[row]++;
  // 列からはみ出さないよう右端で頭打ちにする
  const x = Math.min(GAS_AREA.x + 44 + k * 38, GAS_AREA.x + GAS_AREA.w - 28);
  return { x, y: gasRowY(2) + row * GAS_ATOM_ROW_GAP };
}

/* ばらけている原子を2列に並べ直す。
   2分子目以降をほどいたとき、前の余りと混ざって並びが崩れるのを防ぐ（毎回きれいに整列させる） */
function relayoutGasAtoms(avoid) {
  const stage = STAGES[stageIdx];
  const rowOf = {};
  stage.reactants.forEach((sp, i) => {
    (partsOf(stage, sp) || []).forEach((a) => { if (rowOf[a] === undefined) rowOf[a] = i === 0 ? 0 : 1; });
  });
  const rows = [[], []];
  for (const p of particles) {
    if (p.dead || p.busy || donorPartsOf(p.sp)) continue;
    if (!(p.mode === "still" || p.mode === "moveTo")) continue;
    const r = rowOf[p.sp];
    if (r === undefined) continue;   // 原子以外（生成物など）は並べ直さない
    rows[r].push(p);
  }
  atomRowCount[0] = rows[0].length;
  atomRowCount[1] = rows[1].length;
  const x0 = GAS_AREA.x + 44, x1 = GAS_AREA.x + GAS_AREA.w - 28;
  // いま反応に参加している原子（busy）がいる場所は空けておく。
  // そこへ待機中の原子を置くと、出ていく原子と重なって見える
  const blocked = particles.filter((p) => p.busy && !p.dead).map((p) => ({ x: p.x, y: p.y }));
  if (avoid) blocked.push({ x: avoid.x, y: avoid.y });
  rows.forEach((list, row) => {
    if (!list.length) return;
    // いまの左右の並び順のまま席に着かせる（順序を入れ替えると経路が交差して重なって見える）
    list.sort((a, b) => a.x - b.x);
    const y = gasRowY(2) + row * GAS_ATOM_ROW_GAP;
    const inRow = blocked.filter((b) => Math.abs(b.y - y) < 34);
    const n = list.length + inRow.length;
    const gap = n > 1 ? Math.min(38, (x1 - x0) / (n - 1)) : 0;
    const slots = [];
    for (let k = 0; k < n; k++) {
      const sx = x0 + k * gap;
      if (inRow.some((b) => Math.abs(b.x - sx) < 32)) continue;   // 反応中の原子の場所は飛ばす
      slots.push(sx);
    }
    list.forEach((p, i) => {
      p.mode = "moveTo";
      p.tx = slots[i] !== undefined ? slots[i] : x1;
      p.ty = y;
    });
  });
}

/* 反応1回ぶんの分子をほどいて、2列に整列させる。
   反応物1（CH₄ など）を1分子まるごと上列へ、必要な数の反応物2（O₂）を下列へ */
function gasDecomposeBatch() {
  const stage = STAGES[stageIdx];
  const findMolecule = (sp) => particles.find((p) => p.sp === sp && isReactive(p) && donorPartsOf(p.sp));
  const first = findMolecule(stage.reactants[0]);
  if (first) breakApart(first);
  // 反応物2は「1分子ぶんの反応に足りるだけ」ほどく。
  // すでにばらけて余っている原子を差し引くので、必要のない分子まで壊さない
  const secondSp = stage.reactants[1];
  const parts2 = donorPartsOf(secondSp) || [];
  const perMol = parts2.length || 1;
  const atomsNeeded = (stage.answer[1] / stage.answer[0]) * perMol;
  const freeAvail = particles.filter((p) =>
    !p.dead && !p.busy && isReactive(p) && !donorPartsOf(p.sp) && parts2.includes(p.sp)).length;
  const toBreak = Math.max(0, Math.ceil((atomsNeeded - freeAvail) / perMol));
  for (let k = 0; k < toBreak; k++) {
    const o = findMolecule(secondSp);
    if (!o) break;
    breakApart(o);
  }
  return !!first || toBreak > 0;
}

/* 使い切った反応物を「足す」ことで、この先まだ反応を進められるか。
   足せない（投入上限）／足しても相手の余りが1回ぶんに足りない、ときは やり直す しかない */
function gasCanProgressByAdding() {
  const stage = STAGES[stageIdx];
  const cap = gasInputCap();
  const gone = stage.reactants.filter((sp) => countOf(sp) === 0);
  if (!gone.length) return true;
  if (gone.some((sp) => (addedCount[sp] || 0) >= cap)) return false;   // もう入らない
  const other = stage.reactants.find((sp) => countOf(sp) > 0);
  if (!other || other === stage.reactants[0]) return true;             // 判定できない形は足せる扱い
  // 反応物1を1分子足したときに要る原子数と、余っている側で賄える原子数を比べる
  const parts = donorPartsOf(other) || [other];
  const perMol = parts.length || 1;
  const atomsNeeded = (stage.answer[1] / stage.answer[0]) * perMol;
  const avail = countOf(other) * perMol + parts.reduce((s, a) => s + countOf(a), 0);
  return avail >= atomsNeeded;
}

/* まだほどける分子が残っているか */
function gasHasMolecules() {
  return particles.some((p) => isReactive(p) && donorPartsOf(p.sp));
}

/* C群の次の一手: 組めるなら1組つくる。組めないが分子が残っていればほどく */
function gasStep() {
  if (launchGroups() > 0) {
    setMsg(useSimpleGas()
      ? "分子どうしが近づいて組み替わる…"
      : "原子が近づいて分子ができる…");
    return;
  }
  // 簡易モードは分子のまま組み替えるので、ほどく段取りは無い
  if (useSimpleGas()) { evaluateReaction(); return; }
  // ほどいた先に反応が成立する見込みがあるときだけ分子をほどく
  // （相手がいないのに分子を壊して原子を取り残さない）
  const canReact = STAGES[stageIdx].rules.some((r) => canSatisfy(r, false));
  if (canReact && gasHasMolecules()) {
    setMsg("分子が原子にほどけて、上下2列に並ぶ…");
    gasDecomposeBatch();
    relayoutGasAtoms();   // 前の余りと合わせて並べ直す（2分子目以降も列が乱れないように）
    schedule(1.3, gasStep);
    return;
  }
  evaluateReaction();
}

function doReact() {
  // C群は「整列 → ほどいて2列に並べる → 左から順に1分子ずつ組み替え」の順で、ゆっくり見せる
  if (isGasStage()) {
    if (!gasAligned) {
      gasAligned = true;
      alignGasMolecules();
      setMsg("分子を並べた。ここから原子にほどけて組み替わる…");
      schedule(1.4, gasStep);
      return;
    }
    if (!gasHasMolecules() && launchGroups() === 0) {
      setMsg("組み替えられる原子の組がない。反応物を追加してみよう。");
      return;
    }
    gasStep();
    return;
  }
  if (launchGroups() === 0) {
    setMsg("反応できるイオンの組がない。反応物を入れてみよう。");
    return;
  }
  setMsg("イオンが引き合って結びつく…");
}

/* ---- ドラッグ操作（イオンを相手に重ねて1組だけ反応させる） ---- */

/* この種は現ステージの反応ルールに登場する＝つかんで動かせる */
function isDraggable(sp) {
  return STAGES[stageIdx].rules.some((rule) => rule.find.includes(sp));
}

/* dSp と同じルールに入っている相手の種（重ねる先としてハイライトする対象） */
function compatibleTargetSpecies(dSp) {
  const set = new Set();
  for (const rule of STAGES[stageIdx].rules) {
    if (!rule.find.includes(dSp)) continue;
    for (const sp of rule.find) if (sp !== dSp) set.add(sp);
  }
  return set;
}

/* クライアント座標 → SVG座標。viewBox比の手計算ではなく getScreenCTM を使う（プロジェクト規約） */
function clientToSvg(clientX, clientY) {
  const pt = beakerSvg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const m = beakerSvg.getScreenCTM();
  if (!m) return { x: clientX, y: clientY };
  const q = pt.matrixTransform(m.inverse());
  return { x: q.x, y: q.y };
}

let drag = null;

function highlightTargets(dSp, on) {
  if (!on) {
    for (const el of particleLayer.querySelectorAll(".particle.target")) el.classList.remove("target");
    return;
  }
  const set = compatibleTargetSpecies(dSp);
  for (const p of particles) {
    if (isReactive(p) && set.has(p.sp)) p.el.classList.add("target");
  }
}

/* ドラッグ中のイオンが相手に十分重なっているか（重なり＝反応のヒント表示） */
function overParticle(d) {
  const set = compatibleTargetSpecies(d.sp);
  return particles.some((p) =>
    p !== d && isReactive(p) && set.has(p.sp) &&
    Math.hypot(p.x - d.x, p.y - d.y) <= p.r + d.r + 14);
}

function startDrag(p, pointerId) {
  drag = { p, pointerId };
  p.mode = "drag";
  p.el.classList.add("grabbed");
  highlightTargets(p.sp, true);
}

function moveDrag(clientX, clientY) {
  if (!drag) return;
  const { x, y } = clientToSvg(clientX, clientY);
  drag.p.x = x; drag.p.y = y;
  clampToWater(drag.p);
  drag.p.el.classList.toggle("dropReady", overParticle(drag.p));
}

/* ドラッグ終了。相手に重なっていて1つのルールを満たせるなら、その1組だけ反応させる */
function endDrag() {
  if (!drag) return { launched: false };
  const d = drag.p;
  drag = null;
  d.el.classList.remove("grabbed", "dropReady");
  highlightTargets(d.sp, false);
  const stage = STAGES[stageIdx];
  for (const rule of stage.rules) {
    if (!rule.find.includes(d.sp)) continue;
    // ルールに必要な種と個数から、つかんでいる d を1つ差し引いた残り
    const need = {};
    for (const sp of rule.find) need[sp] = (need[sp] || 0) + 1;
    need[d.sp]--;
    if (need[d.sp] === 0) delete need[d.sp];
    // d の近くから残りを寄せ集める（最近傍を貪欲に割り当て）
    const avail = particles.filter((p) => p !== d && !p.dead && isReactive(p));
    const used = new Set();
    const chosen = [];
    let ok = true;
    for (const sp of Object.keys(need)) {
      for (let k = 0; k < need[sp]; k++) {
        let best = null, bestD = Infinity;
        for (const p of avail) {
          if (p.sp !== sp || used.has(p.id)) continue;
          const dd = Math.hypot(p.x - d.x, p.y - d.y);
          if (dd < bestD) { bestD = dd; best = p; }
        }
        if (!best) { ok = false; break; }
        used.add(best.id);
        chosen.push(best);
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // 少なくとも1つの相手に実際に重ねて落とされたときだけ反応させる
    const dropped = chosen.some((p) => Math.hypot(p.x - d.x, p.y - d.y) <= p.r + d.r + 14);
    if (!dropped) continue;
    if (!cleared) reactionDone = false;
    makeGroup(rule, [d, ...chosen]);
    setMsg("イオンをドラッグして1組だけ反応させた。「⚡反応させる」なら一度に全部反応する。");
    return { launched: true, find: rule.find };
  }
  // 反応相手がいなかった：ふわっと浮遊に戻す
  d.mode = "float";
  d.vx = rnd(-30, 30); d.vy = rnd(-20, 20);
  return { launched: false };
}

beakerSvg.addEventListener("pointerdown", (e) => {
  if (drag) return;
  const g = e.target.closest && e.target.closest(".particle");
  if (!g) return;
  const p = particles.find((o) => o.el === g);
  if (!p || !(p.mode === "float" || p.mode === "pop") || !isDraggable(p.sp)) return;
  startDrag(p, e.pointerId);
  moveDrag(e.clientX, e.clientY);
  e.preventDefault();
});
window.addEventListener("pointermove", (e) => {
  if (drag) moveDrag(e.clientX, e.clientY);
});
window.addEventListener("pointerup", () => { if (drag) endDrag(); });
window.addEventListener("pointercancel", () => { if (drag) endDrag(); });

/* rem（残ったイオンの多重集合）が comp のちょうど整数 k 倍か。違えば 0 を返す */
function multipleOf(rem, comp) {
  const remKeys = Object.keys(rem), compKeys = Object.keys(comp);
  if (remKeys.length !== compKeys.length) return 0;
  let k = null;
  for (const ion of compKeys) {
    if (!(ion in rem) || rem[ion] % comp[ion] !== 0) return 0;
    const q = rem[ion] / comp[ion];
    if (k === null) k = q; else if (k !== q) return 0;
  }
  for (const ion of remKeys) if (!(ion in comp)) return 0; // 余計なイオンが無いこと
  return k >= 1 ? k : 0;
}

/* 目標の塩（酸性塩など）をつくるステージの評価。
   完全中和（余りゼロ）ではなく「反応後にビーカーに残るイオンが、目標の塩の組
   （saltGoal.ions）のちょうど整数倍になっている」で判定する。生成物が複数の塩でも扱える。 */
function evaluateSaltGoal(stage) {
  const goal = stage.saltGoal;
  if (madeCount === 0) return; // まだ反応していない
  const oh = countOf("OH-");
  const hp = countOf("H+");
  // 残っている「イオン（電荷≠0）」の多重集合（H₂O など中性は除く）
  const rem = {};
  for (const p of particles) {
    if (p.mode === "fall" || SPECIES[p.sp].charge === 0) continue;
    rem[p.sp] = (rem[p.sp] || 0) + 1;
  }
  const k = multipleOf(rem, goal.ions);
  const saltDisp = SPECIES[goal.label].disp;
  if (k >= 1) {
    reactionDone = true;
    setMsg(`できた！ 目標の酸性塩 ${saltDisp} ができた。${stage.doneNote}`);
    updateAddedFormula();
    maybeClear();
  } else if (oh > 0) {
    setMsg(`OH⁻ が ${oh} 個 余っている（塩基性）。${saltDisp} には塩基を入れすぎ。少し減らそう。`);
  } else if (hp > 0) {
    setMsg(`H⁺ が ${hp} 個 余っている（酸性）。まだ ${saltDisp} になっていない。投入する比を見直そう。`);
  } else {
    // 反応性イオンは残っていないが目標の塩になっていない（＝完全中和で正塩になった等）
    setMsg(goal.overNote || `まだ ${saltDisp} になっていない。残ったイオンが ${saltDisp} の組になるよう比を見直そう。`);
  }
}

function evaluateReaction() {
  const stage = STAGES[stageIdx];
  if (stage.saltGoal) { evaluateSaltGoal(stage); return; }
  const leftover = [];
  const seen = new Set();
  for (const rule of stage.rules) {
    for (const sp of rule.find) {
      if (seen.has(sp)) continue;
      seen.add(sp);
      // 生成物として放出されたぶんは「反応せずに余った」ではない（沈殿の再溶解の OH⁻ など）
      const n = countOf(sp) - (producedCount[sp] || 0);
      if (n > 0) leftover.push({ sp, n });
    }
  }
  // 途中の姿（溶かすべき沈殿など）が残っていれば、まだゴールではない
  const pending = (stage.intermediates || []).filter((sp) => countOf(sp) > 0);
  // C群で片方の反応物を使い切り、もう片方が余っている＝入れすぎ。
  // 「相手を足そう」では比が合わないことがあるので、入れ直しも促す
  if (isGasStage() && (pending.length > 0 || leftover.length > 0) && madeCount > 0) {
    const remain = stage.reactants.filter((sp) => countOf(sp) > 0);
    const used = stage.reactants.filter((sp) => countOf(sp) === 0);
    if (remain.length > 0 && used.length > 0) {
      const ex = remain.map((sp) => `${SPECIES[sp].disp} が ${countOf(sp)} 個`).join("、");
      const stranded = leftover.length
        ? `（ほどけた ${leftover.map((l) => SPECIES[l.sp].disp).join("・")} も余っている）`
        : "";
      // 足して進められるときだけ「足す」を案内する（足しても進まない状態では やり直す だけを示す）
      const how = gasCanProgressByAdding()
        ? `${used.map((sp) => SPECIES[sp].disp).join("・")} を足すか、「↺ やり直す」で入れ直して、ちょうどの比にしよう。`
        : `ここからは足しても比が合わない。「↺ やり直す」で入れ直して、ちょうどの比にしよう。`;
      setMsg(`${ex} 余っている＝入れすぎ${stranded}。${how}`);
      return;
    }
  }
  if (pending.length > 0 && leftover.length === 0) {
    const names = pending.map((sp) => `${SPECIES[sp].disp} が ${countOf(sp)} 個`).join("、");
    setMsg(`${names} 残っている。反応する相手を加えて、もう一度「反応させる」を押そう。`);
    return;
  }
  if (leftover.length === 0 && madeCount > 0) {
    reactionDone = true;
    const names = stage.reactants.map((sp) => SPECIES[sp].disp).join(" : ");
    const ratio = stage.reactants.map((sp) => addedCount[sp] || 0).join(" : ");
    setMsg(`ちょうど反応しきった！ 投入した数は ${names} ＝ ${ratio}。この比が係数のヒント。${stage.doneNote}`);
    updateAddedFormula();
    maybeClear();
  } else if (leftover.length > 0) {
    const parts = leftover.map((l) => `${SPECIES[l.sp].disp} が ${l.n} 個`).join("、");
    const acidNote = leftover.some((l) => l.sp === "H+") ? "（まだ酸性）"
      : leftover.some((l) => l.sp === "OH-") ? "（まだ塩基性）" : "";
    const who = isGasStage() ? "組む相手の原子" : "相手のイオン";
    setMsg(`${parts} 残っている${acidNote}。${who}が足りない。反応物を追加してもう一度「反応させる」を押そう。`);
  }
}

function setMsg(t) {
  msgEl.textContent = t;
}

/* ビーカー上に「投入した反応物の数」を反応式の左辺の形（n₁ 反応物1 ＋ n₂ 反応物2）で大きく表示。
   投入した個数の比が、そのまま反応式の係数の比になることを体感させる。 */
function updateAddedFormula() {
  const stage = STAGES[stageIdx];
  addedFormulaEl.innerHTML = "";
  stage.reactants.forEach((sp, i) => {
    if (i > 0) {
      const plus = document.createElement("span");
      plus.className = "plus"; plus.textContent = "＋";
      addedFormulaEl.appendChild(plus);
    }
    const n = document.createElement("span");
    n.className = "n"; n.textContent = String(addedCount[sp] || 0);
    const f = document.createElement("span");
    f.className = "f"; f.textContent = SPECIES[sp].disp;
    addedFormulaEl.append(n, f);
  });
  // ちょうど反応しきったときだけ緑（この個数比が係数の比、というサイン）
  addedFormulaEl.classList.toggle("matched", reactionDone);
}

function refreshHUD() {
  const counts = {};
  for (const p of particles) {
    if (p.mode === "fall") continue;
    counts[p.sp] = (counts[p.sp] || 0) + 1;
  }
  ionCountsEl.innerHTML = "";
  const addChip = (sp) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const st = STYLE[sp];
    if (st) chip.style.borderColor = st.color;
    chip.textContent = `${SPECIES[sp].disp} ×${counts[sp]}`;
    ionCountsEl.appendChild(chip);
  };
  for (const sp of CHIP_ORDER) {
    if (counts[sp]) addChip(sp);
  }
  // CHIP_ORDER 未登録の種も落とさず末尾に表示する（種の追加漏れ対策）
  for (const sp of Object.keys(counts)) {
    if (!CHIP_ORDER.includes(sp)) addChip(sp);
  }
  for (const sp of Object.keys(escaped)) {
    const chip = document.createElement("span");
    chip.className = "chip escaped";
    chip.textContent = `${SPECIES[sp].disp}↑ ×${escaped[sp]}（空気中へ）`;
    ionCountsEl.appendChild(chip);
  }
}

/* ---- 反応式パネル ---- */

function buildEquationUI() {
  const stage = STAGES[stageIdx];
  const terms = [...stage.reactants, ...stage.products];
  coeffs = terms.map(() => 0);
  coeffEls = [];
  coeffOk = false;
  equationEl.classList.remove("balanced");
  equationEl.innerHTML = "";
  terms.forEach((sp, i) => {
    if (i === stage.reactants.length) {
      const a = document.createElement("span");
      a.className = "arrow"; a.textContent = "→";
      equationEl.appendChild(a);
    } else if (i > 0) {
      const pl = document.createElement("span");
      pl.className = "plus"; pl.textContent = "＋";
      equationEl.appendChild(pl);
    }
    const term = document.createElement("span");
    term.className = "term";
    const down = document.createElement("button");
    down.textContent = "−";
    const num = document.createElement("span");
    num.className = "coeff"; num.textContent = "？";
    const up = document.createElement("button");
    up.textContent = "＋";
    down.onclick = () => { if (coeffs[i] > 0) { coeffs[i]--; onCoeffChange(); } };
    up.onclick = () => { if (coeffs[i] < 9) { coeffs[i]++; onCoeffChange(); } };
    const stepper = document.createElement("span");
    stepper.className = "stepper";
    stepper.append(down, num, up);
    const f = document.createElement("span");
    f.className = "formula"; f.textContent = SPECIES[sp].disp;
    term.append(stepper, f);
    equationEl.appendChild(term);
    coeffEls.push(num);
  });
  eqMsgEl.textContent = "＋/− を押して係数を入れよう";
}

function onCoeffChange() {
  coeffs.forEach((c, i) => { coeffEls[i].textContent = c === 0 ? "？" : String(c); });
  renderTally();
  buildSchematic();
  buildRecombine();
  const stage = STAGES[stageIdx];
  const res = checkStageCoeffs(stage, coeffs);
  coeffOk = res.ok;
  equationEl.classList.toggle("balanced", coeffOk);
  netionEl.hidden = !coeffOk;
  if (coeffOk) {
    netionEl.innerHTML = `この反応の本質（イオン反応式）: <strong>${stage.netIon}</strong> — ほかのイオンは傍観イオン`;
    eqMsgEl.textContent = "つり合った！最も簡単な整数比になっている。";
  } else if (coeffs.some((c) => c === 0)) {
    eqMsgEl.textContent = "すべての係数を入れよう（？の場所）";
  } else {
    eqMsgEl.textContent = res.reason;
  }
  maybeClear();
}

function renderTally() {
  const stage = STAGES[stageIdx];
  tallyEl.innerHTML = "";
  if (coeffs.every((c) => c === 0)) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "係数を入れると左右の原子の数がここに出る";
    tr.appendChild(td);
    tallyEl.appendChild(tr);
    return;
  }
  const left = stage.reactants.map((sp, i) => ({ sp, n: coeffs[i] }));
  const right = stage.products.map((sp, i) => ({ sp, n: coeffs[stage.reactants.length + i] }));
  const cmp = compareSides(left, right);
  const hr = document.createElement("tr");
  hr.innerHTML = "<th>原子</th><th>左辺</th><th>右辺</th><th></th>";
  tallyEl.appendChild(hr);
  for (const r of cmp.rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.el}</td><td>${r.left}</td><td>${r.right}</td>` +
      `<td class="${r.ok ? "okcell" : "ngcell"}">${r.ok ? "〇" : "×"}</td>`;
    tallyEl.appendChild(tr);
  }
}

/* ---- 中和のブロック模式図 ----
   ビーカーが「どの物質がどんな状態であるか」を見せるのに対し、
   ここは「H⁺ と OH⁻ が 1:1 で結びついて H₂O になる」という**量の関係**だけを見せる。
   1ブロック＝反応物1個。ブロックの縁から出た受け渡し粒が矢印で中央の生成物に集まり、
   相手のいない粒はブロックごと余りとして残る＝そのままパズルの手がかりになる。
   ブロック（と＋の枠）はクリックで係数を増減できる。 */

const schematicWrap = document.getElementById("schematicWrap");
const schematicSvg = document.getElementById("schematic");
const schematicHeadEl = document.getElementById("schematicHead");
const schematicMsgEl = document.getElementById("schematicMsg");

const SCHEMA_W = 460;          // viewBox 幅（右パネルに収まる固定値）
const SCHEMA_BLOCK_W = 118;    // ブロックの幅

/* 太い矢印を start→end に描く（斜めでも向きが合うよう回転で置く） */
function schematicArrow(x0, y0, x1, y1, dim) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(20, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const head = Math.min(15, len * 0.5), w = 6, hw = 12;
  mk("polygon", {
    points: `0,${-w} ${len - head},${-w} ${len - head},${-hw} ${len},0 ${len - head},${hw} ${len - head},${w} 0,${w}`,
    fill: dim ? "#f2ecd0" : "#ffe14d", stroke: dim ? "#cfc79f" : "#9b8a24", "stroke-width": 1,
    transform: `translate(${x0},${y0}) rotate(${ang})`,
  }, schematicSvg);
}

function buildSchematic() {
  const stage = STAGES[stageIdx];
  const schema = protonSchema(stage);
  // H⁺ と受け皿の結合が軸になる反応（中和・弱酸の遊離など）でだけ意味がある
  if (!schema) { schematicWrap.hidden = true; return; }
  schematicWrap.hidden = false;

  const accDisp = SPECIES[schema.accSp].disp;
  const prodDisp = schema.product.map((sp) => SPECIES[sp].disp).join(" ＋ ");
  schematicHeadEl.textContent = `${accDisp} と H⁺ を組み合わせよう（模式図）`;

  const bal = protonBalance(schema, coeffs);
  const { hNeed, accNeed } = schema;
  // 行＝生成物1個ぶん。あまりも自分の行を持つので、多いほうの段数に合わせる
  const rows = Math.max(1, Math.ceil(bal.hTotal / hNeed), Math.ceil(bal.accTotal / accNeed));

  const tight = rows > 7;
  const R = tight ? 11 : 14;                                   // 受け渡し粒の半径
  // 1行の中に粒が複数あるとき（2H⁺+CO₃²⁻ など）の間隔。
  // ブロックの高さは粒の半径＋5 なので、間隔はそれより広くしないとブロックが重なる
  const subStep = 2 * (R + 5) + 4;
  const needMax = Math.max(hNeed, accNeed);
  const rowStep = needMax > 1 ? needMax * subStep : (tight ? 34 : 44);
  const top = 26;
  const H = top + rows * rowStep + 10;
  schematicSvg.setAttribute("viewBox", `0 0 ${SCHEMA_W} ${H}`);
  schematicSvg.innerHTML = "";

  const leftX = 3, rightX = SCHEMA_W - 3 - SCHEMA_BLOCK_W;
  const prodCx = SCHEMA_W / 2;
  const rowY = (k) => top + k * rowStep + rowStep / 2;
  // 1行の中での粒の縦位置（need 個を行の中心にそろえて並べる）
  const subY = (row, sub, need) => rowY(row) + (sub - (need - 1) / 2) * subStep;

  /* 列を1つ描く。side: -1=左（受け皿側）, +1=右（H⁺側） */
  const drawColumn = (list, side, partSp, need) => {
    const x0 = side < 0 ? leftX : rightX;
    const coreCx = side < 0 ? x0 + 40 : x0 + SCHEMA_BLOCK_W - 40;
    const partCx = side < 0 ? x0 + SCHEMA_BLOCK_W - 26 : x0 + 26;
    const edgeX = side < 0 ? x0 + SCHEMA_BLOCK_W : x0;
    const pst = STYLE[partSp] || MOLECULE_STYLE;
    let idx = 0;   // この列で配った受け渡し粒の通し番号

    for (const t of list) {
      for (let u = 0; u < (coeffs[t.i] || 0); u++) {
        const ys = [];
        for (let j = 0; j < t.per; j++, idx++) {
          ys.push(subY(Math.floor(idx / need), idx % need, need));
        }
        const bTop = ys[0] - R - 5, bBot = ys[ys.length - 1] + R + 5;
        const paired = idx <= (side < 0 ? bal.pairs * accNeed : bal.pairs * hNeed);
        const g = mk("g", { class: "schBlock", role: "button", tabindex: "0" }, schematicSvg);
        g.addEventListener("click", () => {
          if (coeffs[t.i] > 0) { coeffs[t.i]--; onCoeffChange(); }
        });
        mk("rect", {
          x: x0, y: bTop, width: SCHEMA_BLOCK_W, height: bBot - bTop, rx: 12,
          fill: paired ? "#e8d3ee" : "#f6e2d4",
          stroke: paired ? "#b98fc0" : "#d9944a", "stroke-width": paired ? 1.2 : 2,
        }, g);
        const vt = mk("text", {
          x: side < 0 ? x0 + 7 : x0 + SCHEMA_BLOCK_W - 7, y: bTop + 12,
          "text-anchor": side < 0 ? "start" : "end", "font-size": 10, fill: "#7c5c86",
        }, g);
        vt.textContent = `${t.per}価`;
        // 本体（残るイオン）。複数あるときは縦に小さく重ねる
        const midY = (bTop + bBot) / 2;
        t.core.forEach((csp, ci) => {
          const cst = STYLE[csp] || MOLECULE_STYLE;
          const n = t.core.length;
          const cy = midY + (ci - (n - 1) / 2) * (n > 1 ? 22 : 0);
          const ry = n > 1 ? 11 : 19;
          mk("ellipse", {
            cx: coreCx, cy, rx: 33, ry, fill: cst.color, stroke: "rgba(0,0,0,.3)", "stroke-width": 1,
          }, g);
          const el = mk("text", {
            x: coreCx, y: cy + (n > 1 ? 4 : 5), "text-anchor": "middle",
            "font-size": SPECIES[csp].disp.length > 4 ? 11 : 13, "font-weight": "bold",
            fill: cst.darkText ? "#2a3540" : "#fff",
          }, g);
          el.textContent = SPECIES[csp].disp;
        });
        if (!t.core.length) {   // NH₃ のように本体が無い（分子そのものが受け皿）
          const el = mk("text", {
            x: coreCx, y: midY + 5, "text-anchor": "middle", "font-size": 12, fill: "#9aa4ae",
          }, g);
          el.textContent = SPECIES[t.sp].disp;
        }
        // 受け渡し粒
        ys.forEach((y, j) => {
          const k = idx - t.per + j;
          const extra = k >= (side < 0 ? bal.pairs * accNeed : bal.pairs * hNeed);
          mk("circle", {
            cx: partCx, cy: y, r: R, fill: pst.color,
            stroke: extra ? (stage.saltGoal ? "#d19a2e" : "#c0392b") : "rgba(0,0,0,.3)",
            "stroke-width": extra ? 3 : 1,
          }, g);
          const el = mk("text", {
            x: partCx, y: y + 4, "text-anchor": "middle", "font-size": R > 12 ? 12 : 10,
            "font-weight": "bold", fill: pst.darkText ? "#2a3540" : "#fff",
          }, g);
          el.textContent = SPECIES[partSp].disp;
          if (!extra) {   // 相手がいる粒だけが矢印で生成物へ向かう
            const px = prodCx - side * 34;
            schematicArrow(edgeX, y, px, rowY(Math.floor(k / need)), false);
          }
        });
      }
    }
    return idx;
  };

  drawColumn(schema.acceptors, -1, schema.accSp, accNeed);
  drawColumn(schema.donors, +1, "H+", hNeed);

  // 中央の生成物
  for (let k = 0; k < bal.pairs; k++) {
    const y = rowY(k);
    schema.product.forEach((psp, j) => {
      const n = schema.product.length;
      const pst = STYLE[psp] || MOLECULE_STYLE;
      const cy = y + (j - (n - 1) / 2) * 26;
      mk("ellipse", {
        cx: prodCx, cy, rx: 33, ry: n > 1 ? 12 : 18,
        fill: pst.color, stroke: "rgba(0,0,0,.35)", "stroke-width": 1.5,
      }, schematicSvg);
      const el = mk("text", {
        x: prodCx, y: cy + 5, "text-anchor": "middle", "font-size": 14, "font-weight": "bold",
        fill: pst.darkText ? "#2a3540" : "#fff",
      }, schematicSvg);
      el.textContent = SPECIES[psp].disp;
    });
  }
  if (bal.pairs === 0) {
    const el = mk("text", {
      x: prodCx, y: rowY(0) + 5, "text-anchor": "middle", "font-size": 12, fill: "#b7c3cd",
    }, schematicSvg);
    el.textContent = "（まだできない）";
  }

  buildSchematicAdders(schema);
  updateSchematicMsg(schema, bal, accDisp, prodDisp);
}

/* 「＋ ブロックを足す」ボタン列。パズル操作をこの模式図の中で完結させる */
function buildSchematicAdders(schema) {
  const wrap = document.getElementById("schematicAdd");
  if (!wrap) return;
  wrap.innerHTML = "";
  const add = (t, cls) => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = `＋ ${SPECIES[t.sp].disp}`;
    b.onclick = () => { if (coeffs[t.i] < 9) { coeffs[t.i]++; onCoeffChange(); } };
    wrap.appendChild(b);
  };
  schema.acceptors.forEach((t) => add(t, "schAdd acc"));
  schema.donors.forEach((t) => add(t, "schAdd don"));
}

function updateSchematicMsg(schema, bal, accDisp, prodDisp) {
  const stage = STAGES[stageIdx];
  const m = schematicMsgEl;
  if (bal.hTotal === 0 && bal.accTotal === 0) {
    m.textContent = `「＋」でブロックを足すと、H⁺ と ${accDisp} が並ぶ。同じ数にそろえよう。`;
  } else if (bal.hLeft === 0 && bal.accLeft === 0) {
    m.textContent = `ぴったり！ H⁺ ${bal.hTotal} 個 と ${accDisp} ${bal.accTotal} 個 が余さず組んで ${prodDisp} ${bal.pairs} 個。このブロックの数が係数。`;
  } else if (bal.hLeft > 0 && stage.saltGoal) {
    m.textContent = `H⁺ が ${bal.hLeft} 個 あまる。この課題はそれでよい（あまった H⁺ が酸性塩 ${SPECIES[stage.saltGoal.label].disp} の H になる）。`;
  } else if (bal.hLeft > 0) {
    m.textContent = `H⁺ が ${bal.hLeft} 個 あまっている（酸が多い）。${accDisp} のブロックを足そう。`;
  } else {
    m.textContent = `${accDisp} が ${bal.accLeft} 個 あまっている（塩基が多い）。H⁺ のブロックを足そう。`;
  }
}

/* ---- 数合わせビュー（反応式の直下に係数ぶんの粒を並べ、組み変える） ---- */

const recombineSvg = document.getElementById("recombine");
const recombineBtn = document.getElementById("recombineBtn");
const recombineMsgEl = document.getElementById("recombineMsg");

/* 組み変えフェーズの順序: 反応の本質（H⁺+OH⁻→H₂O）を先に見せ、
   残ったイオンが塩の枠に集まるのを後にする（イオン反応式の強調と一致）。
   false にすると塩が先・水が後になる。 */
const MECH_FIRST = true;

let recombineState = null;
let lastRecombine = null;
let stripTweens = [];

function summarizeSpecies(list) {
  const m = {};
  for (const sp of list) m[sp] = (m[sp] || 0) + 1;
  return Object.entries(m).map(([sp, n]) => `${SPECIES[sp].disp}×${n}`).join("・");
}

function buildRecombine() {
  const stage = STAGES[stageIdx];
  const nL = stage.reactants.length;
  recombineSvg.innerHTML = "";
  recombineState = null;
  lastRecombine = null;
  stripTweens = [];
  recombineMsgEl.textContent = "";
  recombineBtn.textContent = "⇄ 組み変える";
  if (coeffs.slice(0, nL).some((c) => c === 0)) {
    recombineBtn.disabled = true;
    recombineSvg.setAttribute("viewBox", "0 0 360 30");
    const t = mk("text", { x: 180, y: 19, "text-anchor": "middle", "font-size": 12, fill: "#8a94a0" }, recombineSvg);
    t.textContent = "左辺の係数を入れると組み変えを試せる（右辺はあとからでもよい）";
    return;
  }
  recombineBtn.disabled = false;
  const sim = simulateFormation(stage, coeffs.slice(0, nL));

  const R = 13, GAP = 4, PAD = 5, ROWGAP = 8, LABELH = 26, SEP = 30, MARGIN = 8;
  const unitH = 2 * R + PAD * 2;
  // 列の定義。gasGroup の2項（H₂O と CO₂ など）は中間体1列にまとめる
  const colDefs = [];
  stage.reactants.forEach((sp, i) => colDefs.push({ sp, isLeft: true, entered: coeffs[i] }));
  const gg = stage.gasGroup;
  stage.products.forEach((sp, j) => {
    const entered = coeffs[nL + j];
    if (gg && gg.terms.includes(sp)) {
      let g = colDefs.find((c) => c.group);
      if (!g) {
        g = { group: true, sp: gg.via, terms: [], entereds: [], isLeft: false };
        colDefs.push(g);
      }
      g.terms.push(sp);
      g.entereds.push(entered);
    } else {
      colDefs.push({ sp, isLeft: false, entered });
    }
  });
  for (const c of colDefs) {
    if (!c.group) continue;
    // 両項が同数で入力されているときだけ「主張」とみなす（違う数は仕上げで指摘）
    c.entered = (c.entereds.every((e) => e > 0) && new Set(c.entereds).size === 1) ? c.entereds[0] : 0;
  }
  const cols = colDefs.map((c) => {
    const parts = partsOf(stage, c.sp);
    const unitW = parts.length * (2 * R + GAP) - GAP + PAD * 2;
    const formed = c.isLeft ? 0 : sim.formed[c.group ? c.terms[0] : c.sp];
    return Object.assign(c, {
      parts, unitW, formed,
      rows: c.isLeft ? c.entered : Math.max(c.entered, formed),
      w: Math.max(unitW, 50), claimedBoxes: [],
    });
  });
  let x = MARGIN;
  cols.forEach((col, i) => {
    if (i > 0) { col.sepX = x + SEP / 2; x += SEP; }
    col.x = x;
    x += col.w;
  });
  const totalW = x + MARGIN;
  const maxRows = Math.max(1, ...cols.map((c) => c.rows));
  recombineSvg.setAttribute("viewBox", `0 0 ${totalW} ${LABELH + maxRows * (unitH + ROWGAP)}`);

  const unitRect = (col, u) => ({
    x: col.x + col.w / 2 - col.unitW / 2,
    y: LABELH + u * (unitH + ROWGAP),
    w: col.unitW, h: unitH,
  });
  const slotPos = (col, u, k) => ({
    x: col.x + col.w / 2 - col.unitW / 2 + PAD + R + k * (2 * R + GAP),
    y: LABELH + u * (unitH + ROWGAP) + PAD + R,
  });

  const leftParticles = [];
  const formPlan = [];
  const rightCols = [];
  cols.forEach((col, i) => {
    if (i > 0) {
      const s = mk("text", { x: col.sepX, y: LABELH + unitH / 2 + 5, "text-anchor": "middle", "font-size": 17, fill: "#5a6570" }, recombineSvg);
      s.textContent = (cols[i - 1].isLeft && !col.isLeft) ? "→" : "＋";
    }
    const cx = col.x + col.w / 2;
    col.labelEl = mk("text", { x: cx, y: 16, "text-anchor": "middle", "font-size": 14.5, "font-weight": "bold", fill: "#2a3540" }, recombineSvg);
    col.labelEl.textContent = col.group
      ? `${col.entered === 0 ? "？" : col.entered} ${col.terms.map((t) => SPECIES[t].disp).join("＋")}`
      : `${col.entered === 0 ? "？" : col.entered} ${SPECIES[col.sp].disp}`;
    if (col.isLeft) {
      for (let u = 0; u < col.entered; u++) {
        const rc = unitRect(col, u);
        mk("rect", { x: rc.x, y: rc.y, width: rc.w, height: rc.h, rx: rc.h / 2, fill: "#f4f8fb", stroke: "#c4cdd6" }, recombineSvg);
      }
    } else {
      rightCols.push(col);
      // 入力済みの係数ぶんの「主張枠」（点線ゴースト）
      for (let u = 0; u < col.entered; u++) {
        const rc = unitRect(col, u);
        const box = mk("rect", { x: rc.x, y: rc.y, width: rc.w, height: rc.h, rx: rc.h / 2, fill: "none", stroke: "#c4cdd6", "stroke-dasharray": "4 3" }, recombineSvg);
        col.claimedBoxes.push(box);
        col.parts.forEach((psp, k) => {
          const pos = slotPos(col, u, k);
          const fontSize = SPECIES[psp].disp.length > 3 ? 9.5 : 11.5;
          const ghost = mk("g", { class: "rslot" }, recombineSvg);
          mk("circle", { cx: pos.x, cy: pos.y, r: R, fill: "none", stroke: "#b7c3cd", "stroke-dasharray": "3 3" }, ghost);
          const t = mk("text", { x: pos.x, y: pos.y + 3.5, "text-anchor": "middle", "font-size": fontSize, fill: "#b7c3cd" }, ghost);
          t.textContent = SPECIES[psp].disp;
        });
      }
      // 実際にできる数（シミュレーション結果）ぶんの組み立て予定
      for (let u = 0; u < col.formed; u++) {
        formPlan.push({
          sp: col.sp,
          isWater: col.sp === "H2O",
          col, row: u,
          overflow: u >= col.entered,
          rect: unitRect(col, u),
          boxEl: u < col.entered ? col.claimedBoxes[u] : null,
          slots: col.parts.map((psp, k) => Object.assign({ psp }, slotPos(col, u, k))),
        });
      }
    }
  });
  // 左辺の粒は飛行中に他の要素の下に隠れないよう、最後に追加して最前面にする
  cols.forEach((col) => {
    if (!col.isLeft) return;
    for (let u = 0; u < col.entered; u++) {
      col.parts.forEach((psp, k) => {
        const pos = slotPos(col, u, k);
        // STYLE 未登録の種でも落とさない（種の追加漏れで数合わせ全体が壊れるのを防ぐ）
        const st = STYLE[psp] || MOLECULE_STYLE;
        const fontSize = SPECIES[psp].disp.length > 3 ? 9.5 : 11.5;
        const g = mk("g", { class: "rpart" }, recombineSvg);
        mk("circle", { r: R, fill: st.color, stroke: "rgba(0,0,0,.25)", "stroke-width": 1 }, g);
        const t = mk("text", { y: 3.5, "text-anchor": "middle", "font-size": fontSize, fill: "#fff", "font-weight": "bold" }, g);
        t.textContent = SPECIES[psp].disp;
        g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
        leftParticles.push({ sp: psp, el: g, x: pos.x, y: pos.y, assigned: false });
      });
    }
  });
  recombineState = { leftParticles, formPlan, rightCols, sim, done: false };
}

/* 弧を描いて飛ぶ（2次ベジェ。制御点を中点の上に持ち上げる） */
function flyTo(p, tx, ty, delay, onDone) {
  const dist = Math.hypot(tx - p.x, ty - p.y);
  const lift = Math.max(24, Math.min(60, dist * 0.3));
  stripTweens.push({
    el: p.el, x0: p.x, y0: p.y,
    cx: (p.x + tx) / 2, cy: (p.y + ty) / 2 - lift,
    x1: tx, y1: ty, t: 0, dur: 0.7, delay, onDone,
  });
  p.x = tx; p.y = ty;
}

function stepStripTweens(dt) {
  for (const tw of [...stripTweens]) {
    if (tw.delay > 0) { tw.delay -= dt; continue; }
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = tw.t * tw.t * (3 - 2 * tw.t);
    const a = 1 - e;
    const px = a * a * tw.x0 + 2 * a * e * tw.cx + e * e * tw.x1;
    const py = a * a * tw.y0 + 2 * a * e * tw.cy + e * e * tw.y1;
    tw.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    if (tw.t >= 1) {
      stripTweens = stripTweens.filter((o) => o !== tw);
      if (tw.onDone) tw.onDone();
    }
  }
}

function animateRecombine() {
  if (!recombineState || recombineState.done) return;
  recombineState.done = true;
  recombineBtn.textContent = "↺ 並べ直す";
  const plan = recombineState.formPlan;
  const phase1 = plan.filter((f) => f.isWater === MECH_FIRST);
  const phase2 = plan.filter((f) => f.isWater !== MECH_FIRST);
  runRecombinePhase(phase1, () => runRecombinePhase(phase2, finalizeRecombine));
}

function runRecombinePhase(jobs, onAllDone) {
  if (!jobs.length) { onAllDone(); return; }
  const st = recombineState;
  let pending = 0;
  jobs.forEach((job, ji) => {
    if (!job.boxEl) {
      // 主張枠が足りない/未入力ぶんの受け皿。仕上げで色分けする
      job.boxEl = mk("rect", { x: job.rect.x, y: job.rect.y, width: job.rect.w, height: job.rect.h, rx: job.rect.h / 2, fill: "none", stroke: "#c4cdd6", "stroke-dasharray": "4 3" }, recombineSvg);
    }
    job.slots.forEach((slot) => {
      let best = null, bestD = Infinity;
      for (const p of st.leftParticles) {
        if (p.assigned || p.sp !== slot.psp) continue;
        const d = Math.hypot(slot.x - p.x, slot.y - p.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return;
      best.assigned = true;
      pending++;
      flyTo(best, slot.x, slot.y, ji * 0.18, () => { if (--pending === 0) onAllDone(); });
    });
  });
  if (pending === 0) onAllDone();
}

function finalizeRecombine() {
  const st = recombineState;
  const leftovers = st.leftParticles.filter((p) => !p.assigned);
  leftovers.forEach((p) => p.el.classList.add("leftover"));
  const msgs = [];
  if (leftovers.length) {
    msgs.push(`左辺の ${summarizeSpecies(leftovers.map((p) => p.sp))} が余った（組になる相手が足りない）。左辺の係数を見直そう。`);
  }
  let mismatch = false, unclaimed = false;
  st.rightCols.forEach((col) => {
    col.claimedBoxes.slice(col.formed).forEach((b) => b.classList.add("missingBox"));
    col.claimedBoxes.slice(0, col.formed).forEach((b) => b.classList.add("filledBox"));
    if (col.group && col.entereds.every((e) => e > 0) && new Set(col.entereds).size !== 1) {
      // 例: H₂O と CO₂ に違う係数を入れた
      mismatch = true;
      col.labelEl.classList.add("badLabel");
      msgs.push(`${col.terms.map((t) => SPECIES[t].disp).join(" と ")} は ${SPECIES[col.sp].disp} が分かれてできるので、同じ数になるはず。`);
    } else if (col.entered === 0) {
      unclaimed = true;
    } else if (col.entered !== col.formed) {
      mismatch = true;
      col.labelEl.classList.add("badLabel");
      const name = col.group ? col.terms.map((t) => SPECIES[t].disp).join("・") : SPECIES[col.sp].disp;
      msgs.push(`${name} は ${col.formed} 個${col.group ? "ずつ" : ""}できたのに、係数は ${col.entered} になっている。`);
    } else {
      col.labelEl.classList.add("goodLabel");
    }
  });
  st.formPlan.forEach((job) => {
    if (!job.overflow) return;
    job.boxEl.classList.add(job.col.entered === 0 ? "madeBox" : "overBox");
  });
  if (!leftovers.length && unclaimed) {
    const list = st.rightCols.map((c) => c.group
      ? `${c.terms.map((t) => SPECIES[t].disp).join("・")} 各${c.formed}`
      : `${SPECIES[c.sp].disp}×${c.formed}`).join("・");
    msgs.push(`できた数（${list}）を右辺の係数に入れよう。`);
  }
  if (!leftovers.length && !mismatch && !unclaimed) {
    msgs.push(coeffOk
      ? "ぴったり！ 余りなし、できた数と係数もすべて一致した。"
      : "できた数と係数は一致した。あとは全体を最も簡単な整数比にしよう。");
  }
  recombineMsgEl.textContent = msgs.join(" ");
  lastRecombine = {
    formed: Object.assign({}, st.sim.formed),
    leftovers: leftovers.map((p) => p.sp),
    mismatch, unclaimed,
    fit: !leftovers.length && !mismatch && !unclaimed,
  };
}

recombineBtn.onclick = () => {
  if (recombineState && recombineState.done) buildRecombine();
  else animateRecombine();
};

/* ---- 進行 ---- */

function maybeClear() {
  if (cleared || !reactionDone || !coeffOk) return;
  cleared = true;
  clearEl.hidden = false;
  clearEl.innerHTML = "";
  const t = document.createElement("div");
  t.textContent = "クリア！ ビーカーの実験と反応式が両方そろった。";
  clearEl.appendChild(t);
  if (stageIdx < STAGES.length - 1) {
    const b = document.createElement("button");
    b.textContent = "次のステージへ →";
    b.onclick = () => { stageIdx++; initStage(); };
    clearEl.appendChild(b);
  } else {
    const d = document.createElement("div");
    d.textContent = "全ステージクリア！おつかれさま。";
    clearEl.appendChild(d);
  }
}

function buildStageNav() {
  stageNavEl.innerHTML = "";
  STAGES.forEach((st, i) => {
    const b = document.createElement("button");
    b.textContent = String(i + 1);
    b.className = i === stageIdx ? "active" : "";
    b.title = st.title;
    b.onclick = () => { stageIdx = i; initStage(); };
    stageNavEl.appendChild(b);
  });
}

function buildToolbar() {
  toolbarEl.innerHTML = "";
  const stage = STAGES[stageIdx];
  for (const sp of stage.reactants) {
    const b = document.createElement("button");
    b.className = "add";
    b.textContent = "＋ " + SPECIES[sp].disp;
    b.onclick = () => addMolecule(sp);
    toolbarEl.appendChild(b);
  }
  const react = document.createElement("button");
  react.className = "react";
  react.textContent = "⚡ 反応させる";
  react.onclick = doReact;
  const reset = document.createElement("button");
  reset.className = "reset";
  reset.textContent = "↺ やり直す";
  reset.onclick = () => initStage();
  toolbarEl.append(react, reset);
}

/* ステージの「目標」文をステージ種別から自動生成する（全ステージを「目標の○をつくる」枠に統一）。
   酸性塩→saltGoal、沈殿→その沈殿、気体→その気体、それ以外→中和して正塩。 */
function stageGoalText(stage) {
  if (stage.saltGoal) return `酸性塩 ${SPECIES[stage.saltGoal.label].disp} をつくる`;
  const precip = stage.rules.find((r) => r.kind === "precipitate");
  // 錯イオンは沈殿より優先（沈殿を経て溶かすステージは「溶かす」が目標）
  const complexRule = stage.rules.find((r) => r.kind === "complex");
  if (complexRule) {
    const c = Array.isArray(complexRule.make) ? complexRule.make[0] : complexRule.make;
    return (precip ? "沈殿を溶かして " : "") + `錯イオン ${SPECIES[c].disp} をつくる`;
  }
  if (precip) {
    const p = Array.isArray(precip.make) ? precip.make[0] : precip.make;
    return `沈殿 ${SPECIES[p].disp}↓ をつくる`;
  }
  const gasRule = stage.rules.find((r) => r.kind === "gas");
  if (gasRule) {
    const makes = Array.isArray(gasRule.make) ? gasRule.make : [gasRule.make];
    const gas = makes.find((sp) => BUBBLE_SPECIES.has(sp)) || makes[0];
    return `気体 ${SPECIES[gas].disp}↑ を発生させる`;
  }
  if (stage.phase === "gas") {
    const how = useSimpleGas() ? "分子を組み替えて" : "原子を組み替えて";
    return `${how} ${stage.products.map((sp) => SPECIES[sp].disp).join("・")} をつくる`;
  }
  const salt = stage.products.find((sp) => sp !== "H2O");
  return `ちょうど中和して 塩 ${SPECIES[salt].disp} をつくる`;
}

function initStage() {
  for (const p of particles) if (p.el) p.el.remove();
  particles = [];
  groups = [];
  escaped = {};
  addedCount = {};
  producedCount = {};
  madeCount = 0;
  simTime = 0;
  events = [];
  gasAligned = false;
  productSlot = 0;
  productCount = {};
  atomSlotCount = 0;
  atomRowCount[0] = 0; atomRowCount[1] = 0;
  sequenceRunning = 0;
  reactionZone = null;
  reactionDone = false;
  coeffOk = false;
  cleared = false;
  drawBeakerStatic();
  particleLayer = mk("g", {});
  buildStageNav();
  buildToolbar();
  const stage = STAGES[stageIdx];
  const tags = STAGE_TAGS[stage.id] || [];
  const tagsHtml = tags.length
    ? `<div class="tags"><span class="lead">単元:</span>${tags.map((tg) => `<span class="tag${tg === "酸性塩" ? " saltAcid" : ""}">${tg}</span>`).join("")}</div>`
    : "";
  stageTitleEl.innerHTML = `<strong>${stage.title}</strong>` +
    `<div class="goal${stage.saltGoal ? " acid" : ""}">🎯 目標: ${stageGoalText(stage)}</div>` +
    tagsHtml;
  buildEquationUI();
  renderTally();
  buildSchematic();
  buildRecombine();
  netionEl.hidden = true;
  clearEl.hidden = true;
  setMsg(stage.intro);
  refreshHUD();
  updateAddedFormula();
}

/* テスト・監査用フック（UI からは使わない）。
   advance(ms) でシミュレーション時間を決定論的に進められる。 */
window.IonEq = {
  advance(ms) {
    // tick は1回で最大1秒しか進まないため、長い時間は分割して進める
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
    return {
      counts, made: madeCount, reactionDone, coeffOk, cleared, stageIdx,
      // 段取り演出の途中か（予約された動きが残っているか）。監査が「静止＝おしまい」と
      // 誤って判断しないための手がかり
      busy: sequenceRunning > 0 || events.length > 0,
      settled: particles.filter((p) => p.mode === "settled").length,
      escaped: Object.assign({}, escaped),
      recombine: lastRecombine,
    };
  },
  recombine() { animateRecombine(); return lastRecombine; },
  particles() {
    return particles.map((p) => ({
      sp: p.sp, mode: p.mode, x: p.x, y: p.y, r: p.r,
      // 見た目の幅・高さの半分（枠つきの粒は横長なので、重なり判定はこちらが正しい）
      hw: p.hw || p.r, hr: p.hr || p.r,
      // 集合位置のずらし（C群の簡易モードで分子を重ねないための配置。検証用）
      offX: p.seekOffX || 0, offY: p.seekOffY || 0,
    }));
  },
  /* ドラッグ操作の決定論テスト用: fromSp のイオンを toSp のイオンに重ねて離す */
  dragReact(fromSp, toSp) {
    const d = particles.find((p) => p.sp === fromSp && (p.mode === "float" || p.mode === "pop"));
    const target = particles.find((p) => p !== d && p.sp === toSp && (p.mode === "float" || p.mode === "pop"));
    if (!d || !target) return { launched: false, reason: "particle not found" };
    startDrag(d, 0);
    d.x = target.x; d.y = target.y; // 重ねて落とす位置に移動
    return endDrag();
  },
};

/* 遊び方パネルの開閉をセッションをまたいで覚える（初回は開いた状態） */
const howtoEl = document.getElementById("howto");
if (howtoEl) {
  try { if (localStorage.getItem("ioneq_howto") === "closed") howtoEl.open = false; } catch (e) { /* file:// 等で不可でも無視 */ }
  howtoEl.addEventListener("toggle", () => {
    try { localStorage.setItem("ioneq_howto", howtoEl.open ? "open" : "closed"); } catch (e) { /* 無視 */ }
  });
}

/* 反応インデックスからのディープリンク（index.html?rxn=<id>）。該当ステージを開く */
const rxnParam = new URLSearchParams(location.search).get("rxn");
if (rxnParam) {
  const i = STAGES.findIndex((s) => s.id === rxnParam);
  if (i >= 0) stageIdx = i;
}

initStage();
requestAnimationFrame(frame);

/* 反応ライブラリ（reactions.json）を裏で読み込み window.IonLib に載せる。
   インデックス/検索UI（Phase 2）で使う。失敗（file:// 等）してもゲームプレイは STAGES で継続＝両立。 */
if (typeof window.loadReactionLibrary === "function") {
  window.loadReactionLibrary().catch(() => { /* サーバー無し等では index 無しで続行 */ });
}

})();
