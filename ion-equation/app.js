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
const CHIP_ORDER = ["H+", "OH-", "Ag+", "Ba^2+", "Na+", "Ca^2+", "Cl-", "NO3-", "SO4^2-", "CO3^2-", "HCO3-", "H2O", "H2CO3", "CO2", "AgCl", "BaSO4", "NaHSO4", "NaHCO3"];
/* 生成後に泡となって水面へ逃げる気体 */
const BUBBLE_SPECIES = new Set(["CO2", "SO2"]);

let stageIdx = 0;
let particles = [];
let groups = [];
let escaped = {};
let nextId = 1;
let addedCount = {};
let madeCount = 0;
let coeffs = [];
let coeffEls = [];
let coeffOk = false;
let reactionDone = false;
let cleared = false;
let particleLayer = null;

const rnd = (a, b) => a + Math.random() * (b - a);

function mk(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  (parent || beakerSvg).appendChild(el);
  return el;
}

/* ---- ビーカー静的描画 ---- */

function drawBeakerStatic() {
  beakerSvg.innerHTML = "";
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

function addChargeBadge(g, r, charge, strokeColor) {
  const btxt = (Math.abs(charge) > 1 ? String(Math.abs(charge)) : "") + (charge > 0 ? "+" : "−");
  const bx = r * 0.8, by = -r * 0.8;
  mk("circle", { cx: bx, cy: by, r: 8, fill: "#fff", stroke: strokeColor, "stroke-width": 1.5 }, g);
  const bt = mk("text", { x: bx, y: by + 3.5, "text-anchor": "middle", "font-size": 10, fill: "#333", "font-weight": "bold" }, g);
  bt.textContent = btxt;
}

function makeParticleEl(p) {
  const g = mk("g", { class: "particle" }, particleLayer);
  const spec = SPECIES[p.sp];
  const tip = mk("title", {}, g);
  tip.textContent = `${spec.disp}（${spec.name}）`;
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
        x: a.x, y: a.y + (a.r >= 8 ? 3 : 2.5), "text-anchor": "middle",
        "font-size": a.r >= 8 ? 8 : 6.5,
        fill: es.dark ? "#3a4a55" : "#fff", "font-weight": "bold",
      }, g);
      t.textContent = a.el;
    }
    if (c !== 0) addChargeBadge(g, p.r, c, c > 0 ? "#e08a3c" : "#4d78d8");
    return g;
  }
  const st = STYLE[p.sp] || MOLECULE_STYLE;
  mk("circle", { r: p.r, fill: st.color, stroke: "rgba(0,0,0,.25)", "stroke-width": 1.5 }, g);
  const disp = spec.disp;
  const label = mk("text", {
    y: 4.5, "text-anchor": "middle",
    "font-size": disp.length > 4 ? 11 : 12,
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
    r: struct ? structExtent(struct) : st.r,
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

function clampToWater(p) {
  const minX = WATER.x + p.r, maxX = WATER.x + WATER.w - p.r;
  const minY = WATER.y + p.r + 6, maxY = WATER.y + WATER.h - p.r;
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
  const movers = particles.filter((p) => p.mode === "float" || p.mode === "pop");
  const solids = particles.filter((p) => p.mode === "settled");
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
  const minX = WATER.x + p.r, maxX = WATER.x + WATER.w - p.r;
  const minY = WATER.y + p.r + 6, maxY = WATER.y + WATER.h - p.r;
  if (p.x < minX) { p.x = minX; p.vx = Math.abs(p.vx); }
  if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx); }
  if (p.y < minY) { p.y = minY; p.vy = Math.abs(p.vy); }
  if (p.y > maxY) { p.y = maxY; p.vy = -Math.abs(p.vy); }
}

function dissociateMolecule(p) {
  const { x, y, sp } = p;
  removeParticle(p);
  splash(x, y);
  const ions = DISSOCIATION[sp];
  ions.forEach((ion, i) => {
    const q = spawnParticle(ion, x + (i - (ions.length - 1) / 2) * 30, y, "pop");
    q.vx = rnd(-70, 70); q.vy = rnd(-50, 20);
  });
  refreshHUD();
}

/* グループ（rule.find の全員）が集合地点にそろったら生成物になる */
function mergeGroup(g, now) {
  groups = groups.filter((o) => o !== g);
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
  makes.forEach((sp, i) => {
    const mode = rule.kind === "precipitate" ? "sink" : BUBBLE_SPECIES.has(sp) ? "bubble" : "pop";
    const prod = spawnParticle(sp, x + (i - (makes.length - 1) / 2) * 26, y, mode);
    if (mode === "sink") { prod.vx = 0; prod.vy = 20; }
    if (mode === "bubble") { prod.vx = 0; prod.vy = -30; }
  });
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
  if (!particles.some((o) => o.mode === "seek" || o.mode === "arrivedWait" || o.mode === "intermediate")) {
    evaluateReaction();
  }
}

function step(dt, now) {
  for (const p of [...particles]) {
    if (p.dead) continue;
    if (p.mode === "fall") {
      p.vy += 800 * dt;
      p.y += p.vy * dt;
      if (p.y >= WATER.y + 40) dissociateMolecule(p);
    } else if (p.mode === "seek") {
      const g = p.group;
      const dx = g.tx - p.x, dy = g.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) {
        p.mode = "arrivedWait";
        g.arrived++;
        if (g.arrived === g.size) mergeGroup(g, now);
        continue;
      }
      const s = 150 * dt;
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
      const floorY = WATER.y + WATER.h - p.r - 4;
      // 底、または先に積もった沈殿の上に乗ったら着地（山になって積もる）
      let rest = false;
      for (const q of particles) {
        if (q === p || q.mode !== "settled") continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = p.r + q.r;
        if (d < min && p.y < q.y) {
          const ov = min - d;
          p.x -= (dx / d) * ov;
          p.y -= (dy / d) * ov;
          rest = true;
        }
      }
      if (p.y >= floorY) { p.y = floorY; rest = true; }
      if (rest) {
        clampToWater(p);
        p.vy = 0;
        p.mode = "settled";
      }
    } else if (p.mode === "settled") {
      // 沈殿は底に積もったまま動かない
    } else if (p.mode === "drag") {
      // ドラッグ中はポインタが位置を決めるので物理は止める
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
  addedCount[sp] = (addedCount[sp] || 0) + 1;
  if (!cleared) reactionDone = false;
  const p = spawnParticle(sp, rnd(WATER.x + 50, WATER.x + WATER.w - 50), 95, "fall");
  p.vx = 0; p.vy = 0;
  refreshHUD();
  updateAddedFormula();
}

/* members を集合地点へ向かわせるグループを作る（doReact・ドラッグ操作の共通処理） */
function makeGroup(rule, members) {
  const g = {
    rule,
    tx: members.reduce((s, p) => s + p.x, 0) / members.length,
    ty: members.reduce((s, p) => s + p.y, 0) / members.length,
    size: members.length,
    arrived: 0,
    memberIds: members.map((m) => m.id),
  };
  groups.push(g);
  for (const m of members) { m.mode = "seek"; m.group = g; }
  return g;
}

function doReact() {
  const stage = STAGES[stageIdx];
  let launched = 0;
  for (const rule of stage.rules) {
    // find は多重集合（例: ["H+","H+","CO3^2-"]）。そろう限りグループを作る
    while (true) {
      const used = new Set();
      const members = [];
      let ok = true;
      for (const sp of rule.find) {
        const p = particles.find((o) =>
          o.sp === sp && (o.mode === "float" || o.mode === "pop") && !used.has(o.id));
        if (!p) { ok = false; break; }
        used.add(p.id);
        members.push(p);
      }
      if (!ok) break;
      makeGroup(rule, members);
      launched++;
    }
  }
  if (launched === 0) {
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
    if ((p.mode === "float" || p.mode === "pop") && set.has(p.sp)) p.el.classList.add("target");
  }
}

/* ドラッグ中のイオンが相手に十分重なっているか（重なり＝反応のヒント表示） */
function overParticle(d) {
  const set = compatibleTargetSpecies(d.sp);
  return particles.some((p) =>
    p !== d && (p.mode === "float" || p.mode === "pop") && set.has(p.sp) &&
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
    const avail = particles.filter((p) => p !== d && !p.dead && (p.mode === "float" || p.mode === "pop"));
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
  for (const rule of stage.rules) {
    for (const sp of rule.find) {
      const n = countOf(sp);
      if (n > 0) leftover.push({ sp, n });
    }
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
    setMsg(`${parts} 残っている${acidNote}。相手のイオンが足りない。反応物を追加してもう一度「反応させる」を押そう。`);
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
    const parts = PARTS[c.sp];
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
      const s = mk("text", { x: col.sepX, y: LABELH + unitH / 2 + 5, "text-anchor": "middle", "font-size": 15, fill: "#5a6570" }, recombineSvg);
      s.textContent = (cols[i - 1].isLeft && !col.isLeft) ? "→" : "＋";
    }
    const cx = col.x + col.w / 2;
    col.labelEl = mk("text", { x: cx, y: 16, "text-anchor": "middle", "font-size": 13, "font-weight": "bold", fill: "#2a3540" }, recombineSvg);
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
          const fontSize = SPECIES[psp].disp.length > 3 ? 8 : 10;
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
        const st = STYLE[psp];
        const fontSize = SPECIES[psp].disp.length > 3 ? 8 : 10;
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

function initStage() {
  for (const p of particles) if (p.el) p.el.remove();
  particles = [];
  groups = [];
  escaped = {};
  addedCount = {};
  madeCount = 0;
  reactionDone = false;
  coeffOk = false;
  cleared = false;
  drawBeakerStatic();
  particleLayer = mk("g", {});
  buildStageNav();
  buildToolbar();
  const stage = STAGES[stageIdx];
  stageTitleEl.innerHTML = `<strong>${stage.title}</strong>` +
    (stage.saltGoal ? `<div class="goal">🎯 目標: <b>${SPECIES[stage.saltGoal.label].disp}</b>（酸性塩）をつくる</div>` : "");
  buildEquationUI();
  renderTally();
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
      settled: particles.filter((p) => p.mode === "settled").length,
      escaped: Object.assign({}, escaped),
      recombine: lastRecombine,
    };
  },
  recombine() { animateRecombine(); return lastRecombine; },
  particles() {
    return particles.map((p) => ({ sp: p.sp, mode: p.mode, x: p.x, y: p.y, r: p.r }));
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

initStage();
requestAnimationFrame(frame);

})();
