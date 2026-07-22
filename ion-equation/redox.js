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
const halfOxEl    = document.getElementById("halfOx");
const halfRedEl   = document.getElementById("halfRed");
const eTallyEl    = document.getElementById("eTally");
const sumViewEl   = document.getElementById("sumView");
const clearEl     = document.getElementById("clearBanner");
const stageNavEl  = document.getElementById("stageNav");
const stageTitleEl = document.getElementById("stageTitle");

const WATER = { x: 55, y: 145, w: 370, h: 245 };
const PLATE = { x: 85, y: 160, w: 26, h: 210 };

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
};

let stageIdx = 0;
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

function stage() { return REDOX_STAGES[stageIdx]; }
function oxHR() { return HALF_REACTIONS[stage().ox]; }
function redHR() { return HALF_REACTIONS[stage().red]; }
/* 酸化側の金属種（左辺の非 e⁻ 項） */
function oxMetal() { return oxHR().left.find((t) => t.sp !== "e-").sp; }
function oxIonSp() { return oxHR().right.find((t) => t.sp !== "e-").sp; }

/* ---- 酸化数表示（変化する原子だけ、円の中に） ---- */

function fmtOx(v) { return v > 0 ? "+" + v : String(v); }

function stageOxChanges() {
  return [...oxChangeOfHalf(oxHR()), ...oxChangeOfHalf(redHR())];
}

/* この種を円内酸化数つきで描くべきなら表示文字列、そうでなければ null */
function oxLabelFor(sp) {
  if (sp === "e-") return null;
  const ox = OXIDATION[sp];
  if (!ox) return null;
  for (const c of stageOxChanges()) {
    if (ox[c.el] !== undefined && SPECIES[sp].atoms[c.el]) return fmtOx(ox[c.el]);
  }
  return null;
}

/* ---- 描画 ---- */

function drawBeakerStatic() {
  beakerSvg.innerHTML = "";
  mk("rect", { x: 49, y: WATER.y, width: 382, height: 250, rx: 8, fill: "#eaf5fc" });
  mk("line", { x1: 49, y1: WATER.y, x2: 431, y2: WATER.y, stroke: "#a9cfe4", "stroke-width": 2 });
  mk("path", {
    d: "M 45 75 L 45 385 Q 45 410 70 410 L 410 410 Q 435 410 435 385 L 435 75",
    fill: "none", stroke: "#7c8792", "stroke-width": 4, "stroke-linecap": "round",
  });
  // 金属板
  mk("rect", { x: PLATE.x, y: PLATE.y - 40, width: PLATE.w, height: PLATE.h + 40, rx: 4, fill: "#aeb6bf", stroke: "#7c8792", "stroke-width": 2 });
  const label = mk("text", { x: PLATE.x + PLATE.w / 2, y: PLATE.y - 48, "text-anchor": "middle", "font-size": 13, "font-weight": "bold", fill: "#4a5560" });
  label.textContent = SPECIES[oxMetal()].disp + "板";
}

function makeParticleEl(p) {
  const st = RSTYLE[p.sp] || { color: "#8a8f98", r: 16 };
  const g = mk("g", { class: "particle" }, particleLayer);
  mk("circle", { r: p.r, fill: st.color, stroke: "rgba(0,0,0,.25)", "stroke-width": 1.5 }, g);
  const disp = SPECIES[p.sp].disp;
  const oxTxt = oxLabelFor(p.sp);
  const label = mk("text", {
    y: oxTxt !== null ? -1.5 : (p.sp === "e-" ? 3 : 4.5), "text-anchor": "middle",
    "font-size": p.sp === "e-" ? 8 : (disp.length > 3 ? 10 : 12),
    fill: st.darkText ? "#3a4a55" : "#fff", "font-weight": "bold",
  }, g);
  label.textContent = disp;
  if (oxTxt !== null) {
    const ot = mk("text", {
      y: 11, "text-anchor": "middle", "font-size": 8.5,
      fill: st.darkText ? "#5a6570" : "rgba(255,255,255,.92)", "font-weight": "bold",
    }, g);
    ot.textContent = oxTxt;
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

function spawnParticle(sp, x, y, mode) {
  const st = RSTYLE[sp] || { r: 16 };
  const p = {
    id: nextId++, sp, x, y, vx: rnd(-30, 30), vy: rnd(-20, 20),
    // 酸化数を円内に書く粒はひと回り大きくして2行を収める
    r: st.r + (oxLabelFor(sp) !== null ? 3 : 0),
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

function setMsg(t) { msgEl.textContent = t; }

/* ---- レイアウト（倍率に連動） ---- */

function plateAtomPos(i) {
  return { x: PLATE.x + PLATE.w - 2, y: PLATE.y + 22 + i * 36 };
}
function poolSlotPos(k) {
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
  // 酸化側: 板の縁に金属原子 a 個（還元単体のときは置かない）
  if (soloMode !== "red") {
    for (let i = 0; i < a; i++) {
      const pos = plateAtomPos(i);
      spawnParticle(oxMetal(), pos.x, pos.y, "plateAtom");
    }
  }
  // 還元単体: e⁻ をあらかじめ板にストック（電池なら導線の向こうから来るぶん）
  const need = electronsOf(redHR());
  if (soloMode === "red") {
    for (let k = 0; k < need * b; k++) {
      const pos = poolSlotPos(poolTotal++);
      const e = spawnParticle("e-", pos.x, pos.y, "pool");
      poolE.push(e);
    }
  }
  // 還元側: 溶液中に b 単位ぶんのイオン（酸化単体のときは置かない）
  const ionTerms = redHR().left.filter((t) => t.sp !== "e-");
  for (let u = 0; u < (soloMode === "ox" ? 0 : b); u++) {
    const unit = {
      ions: [], need,
      mx: PLATE.x + PLATE.w + 52, my: PLATE.y + 40 + u * 46,
      arrived: 0, eArrived: 0, waiting: false, resolved: false,
    };
    for (const t of ionTerms) {
      for (let k = 0; k < t.n; k++) {
        const p = spawnParticle(t.sp, rnd(PLATE.x + PLATE.w + 90, WATER.x + WATER.w - 40), rnd(WATER.y + 40, WATER.y + WATER.h - 40), "float");
        p.unit = unit;
        unit.ions.push(p);
      }
    }
    units.push(unit);
  }
  refreshHUD();
}

/* ---- アニメーション本体 ---- */

function play() {
  if (phase !== "idle") {
    setMsg("「↺ やり直す」か倍率の変更でリセットしてから、もう一度押そう。");
    return;
  }
  phase = "running";
  cleared = false;
  const atoms = particles.filter((p) => p.mode === "plateAtom");
  if (soloMode === "ox") {
    setMsg(`【酸化だけ】${SPECIES[oxMetal()].disp} が e⁻ を置いて ${SPECIES[oxIonSp()].disp} になり、溶け出す…`);
    atoms.forEach((atom, i) => schedule(i * 0.9, () => oxidizeAtom(atom)));
    schedule(atoms.length * 0.9 + 1.6, () => {
      phase = "done";
      setMsg(`酸化の半反応: ${SPECIES[oxMetal()].disp} ${atoms.length}個が e⁻ を合計 ${electronsOf(oxHR()) * atoms.length}個 板に置き、` +
        `${SPECIES[oxIonSp()].disp} になって溶け出した。この e⁻ の行き先が還元の半反応。`);
    });
    return;
  }
  if (soloMode === "red") {
    startReduction();
    return;
  }
  setMsg(`${SPECIES[oxMetal()].disp} が e⁻ を置いて ${SPECIES[oxIonSp()].disp} になり、溶け出す…`);
  atoms.forEach((atom, i) => schedule(i * 0.9, () => oxidizeAtom(atom)));
  schedule(atoms.length * 0.9 + 1.2, () => startReduction());
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
  for (let j = 0; j < eN; j++) {
    const e = spawnParticle("e-", atom.x, atom.y, "eToPool");
    const slot = poolSlotPos(poolTotal++);
    e.tx = slot.x; e.ty = slot.y;
  }
  const { x, y } = atom;
  removeParticle(atom);
  oxFlash(x, y);
  const ion = spawnParticle(oxIonSp(), x, y, "pop");
  ion.vx = 90; ion.vy = rnd(-20, 20);
  refreshHUD();
}

function startReduction() {
  const redIonDisp = redHR().left.find((t) => t.sp !== "e-").sp;
  setMsg(`${SPECIES[redIonDisp].disp} が板へ近づき、e⁻ を受け取る…`);
  units.forEach((u, i) => schedule(i * 1.2, () => sendUnit(u)));
}

function sendUnit(unit) {
  unit.ions.forEach((p, i) => {
    p.mode = "swim";
    p.tx = unit.mx + i * 30;
    p.ty = unit.my;
  });
}

function processUnit(unit) {
  if (poolE.length >= unit.need) {
    const taken = poolE.splice(0, unit.need);
    taken.forEach((e, i) => {
      e.mode = "eToIon";
      e.tx = unit.mx - 14 + i * 8;
      e.ty = unit.my + 14;
      e.unit = unit;
    });
  } else {
    unit.waiting = true;
    unit.resolved = true;
    unit.ions.forEach((p) => p.el.classList.add("waiting"));
    checkAllResolved();
  }
  refreshHUD();
}

function transformUnit(unit) {
  const mx = unit.ions.reduce((s, p) => s + p.x, 0) / unit.ions.length;
  const my = unit.ions.reduce((s, p) => s + p.y, 0) / unit.ions.length;
  unit.ions.forEach(removeParticle);
  oxFlash(mx, my);
  for (const t of redHR().right.filter((t) => t.sp !== "e-")) {
    for (let k = 0; k < t.n; k++) {
      if (t.sp === "H2") {
        const bub = spawnParticle("H2", mx, my, "bubble");
        bub.vx = 0; bub.vy = -30;
      } else {
        const pos = depositPos(deposited++);
        spawnParticle(t.sp, pos.x, pos.y, "deposit");
      }
    }
  }
  unit.resolved = true;
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
    setMsg(`還元の半反応: 用意した e⁻ ${electronsOf(redHR()) * b}個を受け取って反応した。` +
      `電池では、この e⁻ が導線の向こう（酸化が起きている極）からやって来る。`);
    refreshHUD();
    return;
  }
  const leftoverE = poolE.length;
  const waiting = units.filter((u) => u.waiting).length;
  const chk = checkRedoxMultipliers(stage(), mult[0], mult[1]);
  if (leftoverE > 0) {
    poolE.forEach((e) => e.el.classList.add("leftoverE"));
    setMsg(`e⁻ が ${leftoverE} 個、板の上に余った！ 電子は水中に残れない。受け取る側（還元）の倍率を増やそう。`);
  } else if (waiting > 0) {
    setMsg(`e⁻ が足りず、イオンが ${waiting} 組待ちぼうけ。酸化側の倍率を増やすか、還元側を減らそう。`);
  } else {
    runExact = true;
    if (chk.ok) {
      cleared = true;
      setMsg(`ぴったり！ e⁻ を ${chk.give} 個渡して受け取った。倍率 ×${mult[0]}・×${mult[1]} がそのまま係数になる。`);
      showClear();
    } else {
      setMsg(`反応はぴったり終わったが、${chk.reason}。`);
    }
  }
  updateSumView();
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
  const movers = particles.filter((p) => p.mode === "float" || p.mode === "pop");
  const solids = particles.filter((p) => p.mode === "deposit" || p.mode === "plateAtom");
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
  const minX = PLATE.x + PLATE.w + 30 + p.r, maxX = WATER.x + WATER.w - p.r;
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
    if (p.mode === "float" || p.mode === "pop") {
      floatMove(p, dt);
      if (p.mode === "pop" && now - p.born > 300) p.mode = "float";
    } else if (p.mode === "eToPool") {
      if (moveToward(p, dt, 160)) { p.mode = "pool"; poolE.push(p); refreshHUD(); }
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
    if (p.mode === "deposit") continue;
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

/* 項を縦2段（化学式＋酸化数タグ）で描く。酸化数は変化する元素の項だけに付く */
function termSpan(term, changes) {
  const wrap = document.createElement("span");
  wrap.className = "fterm";
  const main = document.createElement("span");
  main.textContent = (term.n > 1 ? term.n + " " : "") + SPECIES[term.sp].disp;
  wrap.appendChild(main);
  const ox = term.sp === "e-" ? null : OXIDATION[term.sp];
  if (ox) {
    const ch = changes.find((c) => ox[c.el] !== undefined && SPECIES[term.sp].atoms[c.el]);
    if (ch) {
      const v = ox[ch.el];
      const sub = document.createElement("span");
      sub.className = "oxtag " + (v > 0 ? "oxpos" : v < 0 ? "oxneg" : "oxzero");
      sub.textContent = fmtOx(v);
      wrap.appendChild(sub);
    }
  }
  return wrap;
}

function renderTermsWithOx(container, left, right, changes) {
  container.innerHTML = "";
  const sep = (t) => {
    const s = document.createElement("span");
    s.className = "fsep";
    s.textContent = t;
    return s;
  };
  const addSide = (terms) => terms.forEach((t, i) => {
    if (i > 0) container.appendChild(sep("＋"));
    container.appendChild(termSpan(t, changes));
  });
  addSide(left);
  container.appendChild(sep("→"));
  addSide(right);
}

function buildHalfRow(el, hr, idx, tag) {
  el.innerHTML = "";
  const kind = document.createElement("span");
  kind.className = "kindTag " + (idx === 0 ? "ox" : "red");
  kind.textContent = tag;
  const formula = document.createElement("span");
  formula.className = "halfFormula";
  renderTermsWithOx(formula, hr.left, hr.right, oxChangeOfHalf(hr));
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
  const solo = document.createElement("button");
  solo.className = "solo";
  solo.textContent = "▶ 単体";
  solo.title = "この半反応式だけをアニメで見る";
  solo.onclick = () => playSolo(idx === 0 ? "ox" : "red");
  el.append(kind, formula, times, stepper, solo);
}

function onMultChange() {
  buildHalfRow(halfOxEl, oxHR(), 0, "酸化");
  buildHalfRow(halfRedEl, redHR(), 1, "還元");
  cleared = false;
  soloMode = null;
  clearEl.hidden = true;
  layoutLab();
  setMsg("倍率を変えた。ビーカーの配置も変わった。「▶ 反応を見る」で確かめよう。");
  updateETally();
  updateSumView();
}

function updateETally() {
  const a = mult[0], b = mult[1];
  const givePer = electronsOf(oxHR()), takePer = electronsOf(redHR());
  const give = givePer * a, take = takePer * b;
  const dots = (n, cls) => `<span class="edots ${cls}">${"●".repeat(Math.min(n, 12))}${n > 12 ? "…" : ""}</span>`;
  const ok = give === take;
  eTallyEl.innerHTML =
    `出す e⁻: ${givePer}×${a} ＝ <strong>${give}個</strong> ${dots(give, "give")}<br>` +
    `受け取る e⁻: ${takePer}×${b} ＝ <strong>${take}個</strong> ${dots(take, "take")} ` +
    `<span class="${ok ? "okcell" : "ngcell"}">${ok ? "そろった" : "そろっていない"}</span>`;
}

function fmtTerms(terms) {
  return terms.map((t) => (t.n > 1 ? t.n + " " : "") + SPECIES[t.sp].disp).join(" ＋ ");
}

function updateSumView() {
  const chk = checkRedoxMultipliers(stage(), mult[0], mult[1]);
  const balanced = chk.give !== undefined && chk.give === chk.take;
  sumViewEl.hidden = !balanced;
  if (!balanced) return;
  const a = mult[0], b = mult[1];
  const ox = oxHR(), red = redHR();
  const mulTerms = (terms, k) => terms.map((t) => ({ sp: t.sp, n: t.n * k }));
  const sumL = [...mulTerms(ox.left, a), ...mulTerms(red.left, b)];
  const sumR = [...mulTerms(ox.right, a), ...mulTerms(red.right, b)];
  const fmtWithCancel = (terms) => terms.map((t) => {
    const txt = (t.n > 1 ? t.n + " " : "") + SPECIES[t.sp].disp;
    return t.sp === "e-" ? `<span class="cancel">${txt}</span>` : txt;
  }).join(" ＋ ");
  const combined = combineHalves(stage(), a, b);
  sumViewEl.innerHTML = `足し合わせ: ${fmtWithCancel(sumL)} → ${fmtWithCancel(sumR)}`;
  const l2 = document.createElement("div");
  l2.className = "combinedLine";
  const lbl = document.createElement("span");
  lbl.textContent = "e⁻ を打ち消すと: ";
  const eq = document.createElement("span");
  eq.className = "combinedEq";
  renderTermsWithOx(eq, combined.left, combined.right, stageOxChanges());
  l2.append(lbl, eq);
  sumViewEl.appendChild(l2);
  if (!chk.ok) {
    const w = document.createElement("div");
    w.className = "ngcell";
    w.textContent = chk.reason;
    sumViewEl.appendChild(w);
  }
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

function buildStageNav() {
  stageNavEl.innerHTML = "";
  REDOX_STAGES.forEach((st, i) => {
    const b = document.createElement("button");
    b.textContent = String(i + 1);
    b.className = i === stageIdx ? "active" : "";
    b.title = st.title;
    b.onclick = () => { stageIdx = i; initStage(); };
    stageNavEl.appendChild(b);
  });
}

function initStage() {
  mult = [1, 1];
  cleared = false;
  soloMode = null;
  clearEl.hidden = true;
  buildStageNav();
  buildToolbar();
  stageTitleEl.innerHTML = `<strong>${stage().title}</strong>`;
  buildHalfRow(halfOxEl, oxHR(), 0, "酸化");
  buildHalfRow(halfRedEl, redHR(), 1, "還元");
  layoutLab();
  updateETally();
  updateSumView();
  setMsg(stage().intro);
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
    return {
      phase, cleared, runExact, stageIdx, soloMode,
      mult: [...mult],
      poolE: poolE.length,
      waiting: units.filter((u) => u.waiting).length,
      deposited,
      escaped: Object.assign({}, escaped),
      counts,
    };
  },
};

initStage();
requestAnimationFrame(frame);

})();
