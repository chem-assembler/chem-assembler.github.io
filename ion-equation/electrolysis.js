"use strict";
/* electrolysis.js — 電気分解のページだけが持つ段「まず、何が反応する？」
   （DESIGN_battery_electrolysis.md §9。2026-09-07）

   ユーザーの言葉:
     「電気分解はまず、何が反応するか　を考えさせるものをつくる」
     「反応する物質の優先順位を確認できるように」

   ★ このファイルが持つのは**画面と言い回しだけ**。
     何が反応するかの判定も、順位表の中身も、全部 model.js の
     ELECTRODE_PRIORITY / electrolysisPick から来る（§9-3）。
     ここに「Na⁺ は析出しない」と書き写した瞬間、表を直しても画面が古いまま、が起きる。

   ★ **順位を暗記させる画面ではない。**
     選ぶ → 当たり外れと1行の理由 → ▸ を押してはじめて表の全体が開く。
     酸化還元モードの「梯子の全体を見る」（redox.js の buildLadderFull）と同じ流儀で、
     既定は閉じたまま・開閉は覚えない。

   ★ cell.js との境目は window.CellPreStep の3つだけ（§9-5）:
       ok()     … 両極とも当たったか（当たるまで式の段を出さない）
       reason() … 済んでいないときに ▶ の下へ出す1行
       onReset(stage) … ステージが変わった・やり直したので答えを捨てる
     cell.js はこの段の中身を知らないので、電池のページは1文字も変わらない。 */
(() => {

const leadEl = document.getElementById("whatLead");
const pickEl = document.getElementById("whatPick");
const whyEl  = document.getElementById("whatWhy");
if (!leadEl || !pickEl || !whyEl) return;   // 電池のページに読み込まれても何もしない

/* 極の呼び名と向き。**呼び名は model.js の ELECTRODE_TERMS から引く**
   （電気分解の「陰極／陽極」を、ここで文字列としてもう1つ持たない）。 */
const SIDES = [
  { kind: "cathode", term: "red", verb: "還元", act: "e⁻ を受け取る" },
  { kind: "anode",   term: "ox",  verb: "酸化", act: "e⁻ を出す" },
];
function sideName(s) { return electrodeTerms("electrolysis")[s.term]; }

/* いま選んでいるステージ（cell.js が知らせてくる）。null なら未初期化 */
let stage = null;
/* 選んだ種。{ cathode: "H2O" | null, anode: … } */
let picked = { cathode: null, anode: null };
/* 表を開いているか。**覚えない**（ステージが変わるたびに閉じる） */
let tableOpen = false;

function picks() { return stage ? electrolysisPicks(stage) : null; }
function correct(kind) {
  const p = picks();
  return !!(p && picked[kind] && picked[kind] === p[kind].sp);
}
function bothOk() { return correct("cathode") && correct("anode"); }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function disp(sp) { return (SPECIES[sp] || {}).disp || sp; }

/* ---- 区画①: 液の中にいる顔ぶれ ----
   ★ **水を必ず並べる**のがこの段の肝。溶けているイオンだけを見せると
   「2つのうちどちらか」に見えてしまい、水が割り込む余地が画面から消える。
   顔ぶれは electrolysisCandidates（model.js）が返すものをそのまま出す。 */
function buildLead() {
  leadEl.innerHTML = "";
  if (!stage) return;
  const ions = [...new Set(DISSOCIATION[stage.solution] || [])];
  const line = el("p", "whatLeadLine");
  line.append(
    el("b", null, disp(stage.solution) + " 水溶液"),
    document.createTextNode(" の中にいるのは "));
  ions.forEach((sp, i) => {
    if (i) line.append(document.createTextNode("・"));
    line.append(el("span", "whatSp", disp(sp)));
  });
  line.append(document.createTextNode(" 。そして "),
    el("span", "whatSp whatWater", disp("H2O")),
    document.createTextNode(" は、いつでもそこにいる。"));
  leadEl.appendChild(line);
  const note = el("p", "whatLeadNote",
    "電極に来たイオンが、そのまま反応するとはかぎらない。両極で何が反応するかを選ぼう。");
  leadEl.appendChild(note);
}

/* ---- 区画②: 選ぶ ----
   候補は electrolysisCandidates が返す顔ぶれ（その極の符号に合うイオン ＋ 水）。
   **反応しないものも候補に出す**——出さないと、選ぶ前から答えが分かってしまう。 */
function buildPick() {
  pickEl.innerHTML = "";
  if (!stage) return;
  for (const s of SIDES) {
    const box = el("div", "whatRow");
    box.dataset.side = s.kind;
    const head = el("div", "whatRowHead");
    head.append(el("b", "whatSide", sideName(s)),
      el("span", "whatSideSub", `（${s.act}側・${s.verb}）で反応するのは？`));
    box.appendChild(head);
    const row = el("div", "whatBtns");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", sideName(s) + "で反応するものを選ぶ");
    for (const sp of electrolysisCandidates(s.kind, stage.solution)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "whatBtn" + (picked[s.kind] === sp ? " picked" : "") +
        (picked[s.kind] === sp && correct(s.kind) ? " ok" : "") +
        (picked[s.kind] === sp && !correct(s.kind) ? " ng" : "");
      b.dataset.sp = sp;
      b.textContent = disp(sp);
      b.setAttribute("aria-label", (SPECIES[sp] || {}).name || disp(sp));
      b.onclick = () => choose(s.kind, sp);
      row.appendChild(b);
    }
    box.appendChild(row);
    pickEl.appendChild(box);
  }
}

function choose(kind, sp) {
  picked[kind] = sp;
  render();
  // 段の出し入れと ▶ の可否は cell.js の担当（この段は答えを持つだけ）
  if (window.BatteryEq) window.BatteryEq.refreshGate();
}

/* ---- 区画③: 判定と、開いて確かめる順位表 ----
   ⚠ **理由は表から作る**。「Na⁺ は析出しない」と書かず、
   「選んだものの段」と「正解の段」を比べて言う ＝ 表を直せば理由も変わる。 */
function buildWhy() {
  whyEl.innerHTML = "";
  if (!stage) return;
  const p = picks();
  for (const s of SIDES) {
    const got = picked[s.kind];
    if (!got) continue;
    const want = p[s.kind];
    const line = el("div", "whatWhyLine" + (got === want.sp ? " ok" : " ng"));
    line.dataset.side = s.kind;
    line.textContent = verdictText(s, got, want);
    whyEl.appendChild(line);
  }
  if (!picked.cathode && !picked.anode) {
    whyEl.appendChild(el("div", "whyHead",
      "まだ選んでいません。分からなければ、下の表を開いて確かめてもかまいません。"));
  }
  // ▸ 表の全体。**既定は閉じたまま**（順位は覚えるものではなく、確かめるもの）
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ladderToggle";
  btn.id = "prToggle";
  const full = buildTables();
  const label = () => (tableOpen ? "▾ " : "▸ ") + "反応する順番の表を見る";
  btn.setAttribute("aria-expanded", String(tableOpen));
  btn.textContent = label();
  full.hidden = !tableOpen;
  btn.onclick = () => {
    tableOpen = !tableOpen;
    full.hidden = !tableOpen;
    btn.setAttribute("aria-expanded", String(tableOpen));
    btn.textContent = label();
  };
  whyEl.append(btn, full);
}

/* 1行の理由。段の上下だけで言い切れるように書いてある（物質名を条件に書かない）。 */
function verdictText(s, got, want) {
  const name = disp(got);
  const gotTier = priorityTierOf(s.kind, got);
  const rows = want.rows;
  const rowOf = (t) => rows.find((r) => r.tier === t) || { label: "", note: "", reacts: true };
  if (got === want.sp) {
    const row = rowOf(want.tier);
    const under = want.passed.map((x) => disp(x.sp));
    return `当たり。${name} は「${row.label}」の段。${row.note}。` +
      (under.length
        ? `${under.join("・")} はこれより下の段なので、${s.verb}されない。`
        : "");
  }
  if (gotTier === null) {
    return `${name} はこの表に載っていない（このアプリでは ${sideName(s)} の相手として扱っていない）。`;
  }
  const gotRow = rowOf(gotTier);
  const wantRow = rowOf(want.tier);
  if (gotTier === want.tier) {
    return `${name} も同じ段（${gotRow.label}）だが、このステージでは ${disp(want.sp)} の式で組み立てている。`;
  }
  if (!gotRow.reacts) {
    return `ちがう。${name} は「${gotRow.label}」の段で、水より下 ＝ 水溶液の中では${s.verb}されない。` +
      `${gotRow.note}。だから ${sideName(s)} で反応するのは ${disp(want.sp)} のほう。`;
  }
  return `ちがう。${name} は「${gotRow.label}」の段で、${disp(want.sp)}（${wantRow.label}）より下。` +
    `上にいるほうが先に${s.verb}されるので、${name} の出番はない。`;
}

/* 順位表の全体（両極ぶん）。**行はデータのまま並べる**ので、
   段を足したり並べ替えたりすれば、この画面もそのまま変わる。 */
function buildTables() {
  const box = el("div", "ladderFull prFull");
  box.id = "prFull";
  for (const s of SIDES) {
    const want = picks()[s.kind];
    const sec = el("div", "prSec");
    sec.dataset.side = s.kind;
    sec.appendChild(el("div", "ladderCap",
      `${sideName(s)}（${s.verb}）で反応する順番。上ほど先に${s.verb}される。` +
      "色がついているのが、いまの液にいるもの。"));
    for (const r of want.rows) {
      const row = el("div", "prRow" + (r.present.length ? " here" : "") +
        (r.reacts ? "" : " dead") + (r.tier === want.tier ? " chosen" : ""));
      row.dataset.tier = String(r.tier);
      row.dataset.id = r.id;
      row.append(el("span", "prTier", r.reacts ? String(r.tier) : "×"));
      const body = el("div", "prBody");
      const mem = el("div", "prMembers");
      r.members.forEach((sp, i) => {
        if (i) mem.append(document.createTextNode("・"));
        mem.append(el("span", "prSp" + (r.present.includes(sp) ? " in" : ""), disp(sp)));
      });
      body.append(mem, el("div", "prLabel", r.label), el("div", "prNote", r.note));
      row.appendChild(body);
      sec.appendChild(row);
    }
    box.appendChild(sec);
  }
  box.appendChild(el("div", "ladderNote",
    "覚えるのは「水がここに割り込む」ことだけ。上の顔ぶれ（イオン化傾向の小さい金属・" +
    "ハロゲン化物イオン）も、下の顔ぶれ（K〜Al のイオン・SO₄²⁻ や NO₃⁻）も、" +
    "イオン化傾向と多原子イオンの知識そのままです。"));
  return box;
}

function render() {
  buildLead();
  buildPick();
  buildWhy();
}

/* ---- cell.js との口（§9-5）---- */
window.CellPreStep = {
  ok() { return bothOk(); },
  reason() {
    if (!picked.cathode && !picked.anode) {
      return "まず段1で、両極それぞれ何が反応するかを選ぼう。";
    }
    if (!picked.cathode || !picked.anode) {
      const s = SIDES.find((x) => !picked[x.kind]);
      return `あと片方。${sideName(s)}で反応するものを選ぼう。`;
    }
    const s = SIDES.find((x) => !correct(x.kind));
    return `${sideName(s)}で反応するものが違う。段1の説明を読んで選び直そう（表も開ける）。`;
  },
  onReset(st) {
    stage = st && st.kind === "electrolysis" ? st : null;
    picked = { cathode: null, anode: null };
    tableOpen = false;
    render();
  },
};

/* cell.js は自分の initStage() を読み込みの最後に呼ぶが、そのときこのファイルはまだ
   評価されていない（script の順が model → cell → electrolysis）。だから初回だけ
   自分で今のステージを引きにいって、段を組み立て直す。 */
if (window.BatteryEq) {
  window.CellPreStep.onReset(ELECTROLYSIS_STAGES.find((s) => s.id === window.BatteryEq.state().stageId));
  window.BatteryEq.refreshGate();
}

/* テスト・監査用フック */
window.ElyzWhat = {
  pick(kind, sp) { choose(kind, sp); return picked[kind]; },
  toggleTable() { document.getElementById("prToggle").click(); return tableOpen; },
  state: () => ({
    stageId: stage ? stage.id : null,
    solution: stage ? stage.solution : null,
    picked: Object.assign({}, picked),
    ok: bothOk(),
    // 正解（テストが独立に model から引き直して突き合わせるための口）
    answer: stage ? { cathode: picks().cathode.sp, anode: picks().anode.sp } : null,
    halves: stage ? { cathode: picks().cathode.half, anode: picks().anode.half } : null,
    // 画面に出ている候補釦（**反応しないものも並んでいる**ことを見る）
    buttons: SIDES.reduce((m, s) => {
      m[s.kind] = [...pickEl.querySelectorAll(`.whatRow[data-side="${s.kind}"] .whatBtn`)]
        .map((b) => b.dataset.sp);
      return m;
    }, {}),
    why: [...whyEl.querySelectorAll(".whatWhyLine")]
      .map((d) => ({ side: d.dataset.side, ok: d.classList.contains("ok"), text: d.textContent })),
    tableOpen,
    // 順位表の行（開いていなくても DOM にはある。段の並びと「いま液にいるもの」を見る口）
    rows: SIDES.reduce((m, s) => {
      m[s.kind] = [...whyEl.querySelectorAll(`.prSec[data-side="${s.kind}"] .prRow`)].map((r) => ({
        tier: Number(r.dataset.tier), id: r.dataset.id,
        here: r.classList.contains("here"), dead: r.classList.contains("dead"),
        chosen: r.classList.contains("chosen"),
        present: [...r.querySelectorAll(".prSp.in")].map((x) => x.textContent),
      }));
      return m;
    }, {}),
    lead: leadEl.textContent.replace(/\s+/g, " ").trim(),
  }),
};

})();
