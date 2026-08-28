"use strict";
/* halfreaction.js — 半反応式を組む練習（練習X。ORDER_halfreaction_2026-08-22.md §2）。

   ユーザーの言葉:「**反応前後の化学式を与え、H+、e- などを入力させる／やり方が大きく2通り
   あるので対応したい／半反応式は H2O H+ e- の順に決定するのが簡単だが、本質的には
   酸化数の変化を調べ e- (H2O H+) の順に決定する方が本質的である**」

   ★ **2通りは「選択式」にした**（§7-2 の決め）。段階（A を全部やってから B）ではない:
     (a) 2通りが**同じ式に至る別の道**であることは、**同じ式で切り替えて初めて見える**。
         段階制だと違う式で比べることになり、「A で組んだ式」と「B で組んだ式」が
         同じものだと分からない
     (b) 段階制は **B に着かない人が出る** ＝「両方に対応したい」という発注が実質半分になる
     (c) 段階のよさ（順に通す）は、**クリアしたあとに「同じ式をもう一方の手順で」を出す**
         ことで選択式の中に入れられる
   ⚠ **手順を切り替えたら入力は捨てる。** 残すと B に切り替えた瞬間に完成していて、
   「先に e⁻ を決める」という手順B の芯を一度も通らない。

   ⚠ **答えの表は持たない。** 判定は model.js の checkHalfStep（原子・電荷の保存と
   酸化数の変化）だけ。ここは描画と入力を持つ。
   ⚠ **完成した式（hr.disp）を画面に出さない** —— 帯の名前も「☰ 一覧」も骨格で書く。 */
(() => {

const stageNavEl   = document.getElementById("stageNav");
const stageTitleEl = document.getElementById("stageTitle");
const formulaEl    = document.getElementById("hbFormula");
const procBarEl    = document.getElementById("procBar");
const procLeadEl   = document.getElementById("procLead");
const chargeEl     = document.getElementById("hbCharge");
const clearEl      = document.getElementById("clearBanner");

const TASKS = halfBuildList();

/* 入力欄の id に使う短い名前（"H+" や "e-" はそのままでは id に向かない） */
const KEYCODE = { "H2O": "w", "H+": "h", "e-": "e" };
const SIDES = ["left", "right"];

let taskIdx = 0;
let procId = "A";
let vals = {};        // { 種: { left: n, right: n } }（空欄は delete）

function task() { return TASKS[taskIdx]; }
function proc() { return HALF_PROCS[procId]; }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* 強調の ** は画面では使わない（採点の文は素で書かれている） */
function plain(s) { return String(s).replace(/\*\*/g, ""); }

/* ---- 式の面（1回だけ組み立て、あとは塗り替えるだけ）----
   ⚠ **打っている途中に作り直さない**（練習Y・redox.js と同じ作法）。
   3つの種 × 左右 ＝ 6つの欄をはじめから作っておく。作り直すと1文字打つたびに焦点が飛ぶ。

   ★ **欄は最初から6つとも見せる**（2026-08-28・ユーザーの指示「枠は固定で出しておき、
   入力する手順でハイライト」）。⚠ 以前は「まだ来ていない段の欄は hidden」だったが、
   隠すと**式が打つたびに伸び縮みして、これから何を入れるのかが見えない**。
   いま入れる欄は `.hbSlotNow` で示す。⚠ **枠を見せても答えは漏れない**
   —— 枠に入っているのは種の名前（H₂O・H⁺・e⁻）だけで、数も辺も書いていない。
   ⚠ 漏れるのは**採点の文のほう**なので、そちらは今までどおり伏せる（refresh を見よ）。 */

function termNode(t) {
  const wrap = el("span", "fterm");
  const coef = el("span", "fcoef");
  if (t.n > 1) coef.textContent = t.n + " ";
  wrap.appendChild(coef);
  wrap.appendChild(el("span", "oxBigFormula", SPECIES[t.sp].disp));
  return wrap;
}

function slotNode(key, side) {
  // ⚠ ＋ は欄の**中**に入れる。外に出すと、隠れたときに行末へ取り残される
  const wrap = el("span", "fterm hbSlot");
  wrap.id = "hbSlot_" + KEYCODE[key] + "_" + side;
  wrap.appendChild(el("span", "fsep", "＋"));
  const coef = el("span", "fcoef");
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = "0";
  inp.max = "20";
  inp.inputMode = "numeric";
  inp.className = "fcoefIn";
  inp.id = "hbIn_" + KEYCODE[key] + "_" + side;
  inp.setAttribute("aria-label", SPECIES[key].disp + " を" + (side === "left" ? "左辺" : "右辺") + "に何個");
  inp.oninput = () => {
    const v = inp.value.trim();
    if (!vals[key]) vals[key] = {};
    /* ⚠ **空欄と 0 を区別する。** 0 は「この辺には要らない」という正しい答えなので、
       係数の作法（v < 1 なら空欄）をそのまま持ち込むと 0 が入れられなくなる。 */
    if (v === "" || !Number.isInteger(Number(v))) delete vals[key][side];
    else vals[key][side] = Number(v);
    refresh();
  };
  coef.appendChild(inp);
  wrap.appendChild(coef);
  wrap.appendChild(el("span", "oxBigFormula", SPECIES[key].disp));
  return wrap;
}

function buildFormula() {
  formulaEl.innerHTML = "";
  const t = task();
  SIDES.forEach((side) => {
    if (side === "right") formulaEl.appendChild(el("span", "fsep", "→"));
    t.skeleton[side].forEach((term, i) => {
      if (i > 0) formulaEl.appendChild(el("span", "fsep", "＋"));
      formulaEl.appendChild(termNode(term));
    });
    for (const key of HALF_AUX) formulaEl.appendChild(slotNode(key, side));
  });
}

/* ---- 段（見出しは手順ごとに入れ替わる）---- */

function stepEls(i) {
  const sec = document.getElementById("hbStep" + i);
  return {
    sec,
    head: sec.querySelector(".hbHead"),
    now: sec.querySelector(".hbNowTag"),
    extra: sec.querySelector(".hbExtra"),
    msg: sec.querySelector(".hbMsg"),
  };
}

/* 手順B の1段目にだけ出す「調べた酸化数」。
   ⚠ **1個あたりの幅も、掛け算の答えも出さない** —— それを出すのがこの段の問い。
   ⚠ 酸化数そのものの出し方は練習Y の担当なので、ここでは**印として与え**、
   出し方を知りたい人は酸化数モードへ送る（同じ練習を2回やらせない）。 */
function buildOxHint(box) {
  box.innerHTML = "";
  const t = task();
  const c = t.change;
  const line = el("div", "oxCheckLine");
  line.append(el("span", null, c.el + " の酸化数　"));
  line.append(el("span", "oxGiven", fmtOxNum(c.from)));
  line.append(el("span", "fsep", "→"));
  line.append(el("span", "oxGiven", fmtOxNum(c.to)));
  line.append(el("span", null, "　変わった原子は " + c.count + " 個"));
  box.appendChild(line);
  // 練習Y への往復（この数の出し方はあちらの担当）
  const sp = [...t.skeleton.left, ...t.skeleton.right]
    .map((x) => x.sp)
    .find((x) => SPECIES[x].atoms[c.el] && halfOxLinkable(x));
  if (sp) {
    const a = document.createElement("a");
    a.className = "hbOxLink";
    a.href = "oxidation.html?sp=" + encodeURIComponent(sp);
    a.textContent = "この数の出し方 →";
    box.appendChild(a);
  }
}

/* 酸化数モードで名指しできる種か（あちらの出題になっていない種へは送らない） */
function halfOxLinkable(sp) {
  return !!oxTaskOf(sp);
}

/* ---- 塗り替え ---- */

function refresh() {
  const t = task();
  const p = proc();
  const at = halfStepIndex(t, procId, vals);
  const done = halfBuildDone(t, procId, vals);

  /* 欄の出し入れ: ★ **枠は全部出したまま**。隠すのは「完成して 0 になった項」だけ
     （1 MnO₄⁻ ＋ 0 H₂O のような式にしないため）。いま入れる段の欄はハイライトする。 */
  p.steps.forEach((st, i) => {
    for (const side of SIDES) {
      const node = document.getElementById("hbSlot_" + KEYCODE[st.key] + "_" + side);
      const v = (vals[st.key] || {})[side];
      const zero = !Number.isInteger(v) || v === 0;
      node.hidden = done && zero;
      node.classList.toggle("hbSlotNow", !done && i === at);
      const inp = document.getElementById("hbIn_" + KEYCODE[st.key] + "_" + side);
      const want = v === undefined ? "" : String(v);
      // 外（テストのフック）から入れたときだけ書き戻す（打っている途中は触らない）
      if (document.activeElement !== inp && inp.value !== want) inp.value = want;
    }
  });
  formulaEl.classList.toggle("hbDone", done);

  p.steps.forEach((st, i) => {
    const e = stepEls(i);
    const ahead = i > at;                 // まだ来ていない段（うすいまま置いておく）
    e.sec.classList.toggle("oxLocked", ahead);
    e.sec.classList.toggle("hbNow", !done && i === at);
    e.head.textContent = st.head;
    e.now.hidden = done || i !== at;      // ★「いま入れるところ」の印
    /* ⚠ **採点の文だけは、まだ来ていない段では出さない。** 全22出題×2手順を叩いて決めた:
       ・空欄のままの先の段の文に、数は **88件中 0件** しか出てこない ＝ 文からは答えは漏れない
       ・ただし先の段の欄に 0 と入れると、**88件中 52件が「そろった」と緑になる**
         （前の段の H₂O をまだ置いていないので、O も H も 0 対 0 でそろって見える）。
       うすい段に緑が出るのは嘘なので、文は「いまの段」に結びつけたままにする。
       ⚠ **枠と見出しには数が1つも出てこない**ので、伏せるのはここ1か所で足りる。 */
    e.msg.hidden = ahead;
    e.extra.hidden = ahead || st.by !== "ox";
    if (!e.extra.hidden) buildOxHint(e.extra);
    if (ahead) {
      e.msg.textContent = "";
      // 先の段の欄に、前に付いた赤い印を残さない
      for (const side of SIDES) {
        document.getElementById("hbIn_" + KEYCODE[st.key] + "_" + side).classList.remove("ng");
      }
      return;
    }
    const r = checkHalfStep(t, procId, i, vals);
    const ngIn = r && r.kind === "wrong";
    for (const side of SIDES) {
      const inp = document.getElementById("hbIn_" + KEYCODE[st.key] + "_" + side);
      inp.classList.toggle("ng", !!ngIn);
    }
    setStatusMsg(e.msg, plain(r.reason), r.ok ? "ok" : r.kind === "wrong" ? "ng" : "info");
  });

  /* ★ 手順B の締めは**電荷の検算**。A では電荷が答えを決めたが、B では最後に合っているかを
     確かめるだけ ＝ 同じ式でも、電荷の役どころが入れ替わることを1行で見せる。 */
  const showCharge = done && procId === "B";
  chargeEl.hidden = !showCharge;
  if (showCharge) {
    const terms = halfTerms(t, vals, HALF_AUX);
    const cmp = compareSides(terms.left, terms.right);
    chargeEl.textContent = `電荷は 左 ${fmtOxNum(cmp.chargeLeft)} ／ 右 ${fmtOxNum(cmp.chargeRight)} —— ` +
      "合っている。手順B では、電荷は答えを決める材料ではなく最後の答え合わせ。";
  }

  clearEl.hidden = !done;
  if (done) showClear();
}

function showClear() {
  clearEl.innerHTML = "";
  const t = task();
  const n = (vals["e-"] || {})[t.eSide];
  clearEl.appendChild(el("div", null, procId === "A"
    ? `クリア！ 電荷の差を埋めるのに e⁻ が ${n} 個要った。`
    : `クリア！ 先に決めた e⁻ ${n} 個のまま、O も H も電荷も合った。`));
  const other = procId === "A" ? "B" : "A";
  const b = document.createElement("button");
  b.id = "hbSwap";
  b.textContent = `同じ式を${HALF_PROCS[other].label.split("：")[0]}で組む →`;
  b.onclick = () => setProc(other);
  clearEl.appendChild(b);
  if (taskIdx < TASKS.length - 1) {
    const nx = document.createElement("button");
    nx.id = "hbNext";
    nx.textContent = "次の式へ →";
    nx.onclick = () => { taskIdx++; initTask(); };
    clearEl.appendChild(nx);
  }
}

/* ---- 手順の切り替え（選択式）---- */

function buildProcBar() {
  procBarEl.innerHTML = "";
  for (const id of ["A", "B"]) {
    const b = document.createElement("button");
    b.id = "hbProc" + id;
    b.textContent = HALF_PROCS[id].label;
    b.className = id === procId ? "active" : "";
    b.onclick = () => setProc(id);
    procBarEl.appendChild(b);
  }
  procLeadEl.textContent = proc().lead;
}

function setProc(id) {
  if (!HALF_PROCS[id]) return false;
  procId = id;
  vals = {};            // ⚠ 持ち越さない（持ち越すと B の1段目を通らずに完成する）
  buildProcBar();
  buildFormula();
  refresh();
  return true;
}

/* ---- 出題の切り替え ---- */

function taskLabel(i) {
  return `${i + 1}：${halfSkeletonDisp(TASKS[i].skeleton)}`;
}

function buildStageNav() {
  stageNavEl.innerHTML = "";
  TASKS.forEach((t, i) => {
    const b = document.createElement("button");
    // ⚠ 帯に出すのは番号だけ（他の全モードと同じ）。名前は title と「☰ 一覧」が持つ
    b.textContent = String(i + 1);
    b.className = i === taskIdx ? "active" : "";
    b.title = taskLabel(i);
    b.dataset.label = halfSkeletonDisp(t.skeleton);
    b.onclick = () => { taskIdx = i; initTask(); };
    stageNavEl.appendChild(b);
  });
}

function initTask() {
  vals = {};
  buildStageNav();
  stageTitleEl.innerHTML = "";
  stageTitleEl.appendChild(el("strong", null, taskLabel(taskIdx)));
  buildProcBar();
  buildFormula();
  refresh();
}

/* テスト・監査用フック */
window.HalfBuild = {
  count() { return TASKS.length; },
  list() { return TASKS.map((t) => t.id); },
  state() {
    const t = task();
    const at = halfStepIndex(t, procId, vals);
    return {
      taskIdx, id: t.id, proc: procId,
      steps: proc().steps.map((s) => s.key),
      at, done: halfBuildDone(t, procId, vals),
      clear: !clearEl.hidden,
      charge: !chargeEl.hidden,
    };
  },
  goto(id) {
    const i = TASKS.findIndex((t) => t.id === id);
    if (i < 0) return false;
    taskIdx = i; initTask(); return true;
  },
  setProc,
  set(key, side, v) {
    if (!vals[key]) vals[key] = {};
    if (v === null) delete vals[key][side]; else vals[key][side] = v;
    refresh();
  },
};

const q = new URLSearchParams(location.search);
const idParam = q.get("half");
if (idParam) {
  const i = TASKS.findIndex((t) => t.id === idParam);
  if (i >= 0) taskIdx = i;
}
if (q.get("proc") === "B") procId = "B";

initTask();

})();
