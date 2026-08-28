"use strict";
/* oxidation.js — 酸化数を決めるモード（練習Y。ORDER_halfreaction_2026-08-22.md §3）。

   ユーザーの言葉:「**酸化数の決定についてはイオンに分けて考えることを徹底させたい。
   仮想的に単原子イオンに分解させてもよい**」

   ★ 徹底のさせ方は「段を分ける」。
       段1 イオンに分ける（K₂Cr₂O₇ → 2K[＋1] ＋ Cr₂O₇[−2]）… **ここを通らないと段2は書けない**
           ⚠ 問うのは**電荷**（個数は原子の保存から決まるので印で出す）。
              電荷を決めてから段2の「合計＝そのイオンの電荷」へ進む、という順序を守るため
       段2 それぞれのイオンの中で酸化数を決める（規則で決まるぶんは印。問うのは残り1つ）
       段3 仮想的に単原子イオンへ分ける（任意。⚠ 実在の電離ではないと断ってから見せる）

   ⚠ **答えの表は持たない。** 判定は model.js の checkOxSplit（原子・電荷の保存）と
   checkOxSheet（合計＝そのイオンの電荷）だけ。ここは描画と入力を持つ。

   ⚠ **順序は強いない**（発注書 §6）。段1 の中でも段2 の中でも、どの欄から埋めてもよい。
   段1→段2 の順だけは動かせないが、それは③→④と同じ「筆算が下へ伸びる」順で、
   同じ段の中で書く順を縛るのとは別の話。

   ★ **枠は最初から出す**（2026-08-28・ユーザーの指示「枠は固定で出しておき、
   入力する手順でハイライト」）。⚠ 以前は段1が正解になるまで段2そのものが hidden だった。
   いまは段2の枠（イオンの箱・元素の行・入力欄）を最初から出し、いま入れる段を
   ハイライトする。⚠ **ただし段2の「値」は段1の答えそのもの**なので、そこだけ伏せる:
     ・箱の見出しの電荷（2K⁺ の ⁺）        → 電荷を落として書く
     ・単原子イオンの灰色の数（K は +1）    → ？ にする（＝ 段1で問うている電荷そのもの）
     ・検算の「めざす合計 ＝ +1（このイオンの電荷）」→ ？ にする
   規則から来る灰色（O は −2・H は +1）は段1と無関係なので、そのまま出す。 */
(() => {

const stageNavEl   = document.getElementById("stageNav");
const stageTitleEl = document.getElementById("stageTitle");
const step1El      = document.getElementById("step1");
const step2El      = document.getElementById("step2");
const step3El      = document.getElementById("step3");
const splitSheetEl = document.getElementById("splitSheet");
const splitMsgEl   = document.getElementById("splitMsg");
const whySplitEl   = document.getElementById("whySplit");
const oxSheetEl    = document.getElementById("oxSheet");
const oxMsgEl      = document.getElementById("oxMsg");
const givenNoteEl  = document.getElementById("oxGivenNote");
const virtWrapEl   = document.getElementById("virtWrap");
const clearEl      = document.getElementById("clearBanner");

const TASKS = oxTaskList();

let taskIdx = 0;
/* 段1: 断片の**電荷**（空欄は undefined）。⚠ 0 は「電荷 0 と答えた」＝ 誤答であって未入力ではない */
let splitVals = [];
let oxVals = {};      // 段2: { 断片の添字: { 元素: 値 } }
let virtOpen = false;

function task() { return TASKS[taskIdx]; }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* 上付きの電荷（Cr⁶⁺）。SPECIES に無い**仮想の単原子イオン**を書くために要る */
const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
function supCharge(v) {
  if (v === 0) return "";
  const n = Math.abs(v);
  return (n === 1 ? "" : String(n).split("").map((c) => SUP[c]).join("")) + (v > 0 ? "⁺" : "⁻");
}

/* ---- 段1: イオンに分ける ---- */

function splitState() {
  return checkOxSplit(task().sp, splitVals);
}

/* 分ける必要が無い回（もともとイオン・分子）は段1を通過扱いにする */
function splitDone() {
  if (!task().needsSplit) return true;
  const r = splitState();
  return !!(r && r.ok);
}

function buildSplit() {
  splitSheetEl.innerHTML = "";
  const t = task();
  if (!t.needsSplit) {
    step1El.hidden = false;
    const row = el("div", "oxNoSplit");
    row.append(el("span", "oxBigFormula", SPECIES[t.sp].disp));
    row.append(el("span", "oxRole", SPECIES[t.sp].charge === 0 ? "分子（イオンに分かれない）" : "これ自体がイオン1個"));
    splitSheetEl.appendChild(row);
    setStatusMsg(splitMsgEl, "この回は分ける相手がいない。そのまま中身の酸化数を決める。", "info");
    whySplitEl.textContent = "";
    return;
  }
  step1El.hidden = false;
  /* ［もとの物質］→［□ イオン ＋ □ イオン］の1行。
     ⚠ **筆算の5列グリッド（#calcSheet）は使わない。** あちらは行が何本も重なるときに
     → の位置をそろえるための仕組みで、min-width:max-content ＝ 狭い画面では横にはみ出す。
     ここは1行しかないので → をそろえる相手がおらず、iPhone 13 の実機では
     右辺の2つめ（＋ SO₄²⁻）が画面の外に出て**そこに欄があること自体が見えなかった**。
     折り返す1行にする。 */
  const row = el("div", "oxSplitLine");
  row.append(el("span", "oxBigFormula", SPECIES[t.sp].disp));
  row.append(el("span", "fsep", "→"));
  const right = row;
  t.parts.forEach((p, i) => {
    const wrap = el("span", "fterm");
    // ⚠ ＋ は次の項の**中**に入れる。外に出すと折り返しで行末に取り残される（実機で確認）
    if (i > 0) wrap.appendChild(el("span", "fsep", "＋"));
    /* 個数は**印**。もとの式の原子がそのまま分かれるので、電荷が決まれば個数は考えなくてよい
       （1個のときは書かない ＝ ふつうの式の書き方に合わせる） */
    if (p.n > 1) {
      const coef = el("span", "oxSplitN", String(p.n));
      coef.title = "個数は、もとの式の原子がそのまま分かれるので決まる";
      wrap.appendChild(coef);
    }
    /* ⚠ **電荷を消した式を出す。** Na⁺ と書いてしまうと答えがそこに書いてある ＝ 写せる。
       上付きの電荷は式の末尾にしか来ないので、機械的に落とせる。 */
    wrap.appendChild(el("span", "oxBigFormula", dispNoCharge(p.sp)));
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "-4";
    inp.max = "4";
    inp.step = "1";
    inp.className = "oxIn oxChgIn";
    inp.id = "splitIn" + i;
    inp.value = splitVals[i] === undefined ? "" : String(splitVals[i]);
    inp.setAttribute("aria-label", dispNoCharge(p.sp) + " の電荷");
    /* ⚠ **打っている途中に行を作り直さない**（redox.js の calcSlots と同じ作法）。
       innerHTML を入れ替えると入力欄そのものが別物になり、1文字打つたびに焦点が飛ぶ。
       oninput は値と印と判定文だけを塗り替える。 */
    inp.oninput = () => {
      const v = inp.value.trim();
      // ⚠ 「−」だけの途中と 0 を取り違えない（0 は答えとして受け取り、誤答と判定する）
      if (v === "" || v === "-" || !Number.isInteger(Number(v))) delete splitVals[i];
      else splitVals[i] = Number(v);
      refresh();
    };
    wrap.appendChild(inp);
    right.appendChild(wrap);
  });
  splitSheetEl.appendChild(row);
  // 検算の行（段2と同じ形）。**答えは書かない** —— いまの合計と、めざす合計だけ
  const chk = el("div", "oxCheckLine");
  chk.id = "splitChk";
  splitSheetEl.appendChild(chk);
}

/* 電荷を落とした化学式（PO₄³⁻ → PO₄）。上付きの数字と ⁺⁻ は式の末尾にしか来ない */
function dispNoCharge(sp) {
  return SPECIES[sp].disp.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]*[⁺⁻]$/, "");
}

/* 段1の塗り替え（作り直さない）。検算の行と、入力欄の赤い印だけを更新する */
function refreshSplit(res) {
  const t = task();
  const chk = document.getElementById("splitChk");
  if (!chk) return;
  let sum = 0, allIn = true;
  const cells = t.parts.map((p, i) => {
    const v = splitVals[i];
    if (Number.isInteger(v)) sum += v * p.n; else allIn = false;
    return `(${Number.isInteger(v) ? fmtOxNum(v) : "？"})×${p.n}`;
  });
  const want = SPECIES[t.sp].charge;
  /* ⚠ 緑にするのは**通ったとき**だけ。合計だけ合って中身が違う回（＋と−が
     たまたま打ち消し合う）で緑を出すと、「緑なのに進めない」に見える。
     数そのものは書いてあるので、色は判定と一致させておくほうが読める。 */
  chk.className = "oxCheckLine" + (allIn ? (res && res.ok ? " okcell" : " ngcell") : "");
  chk.textContent = `${cells.join(" ＋ ")} ＝ ${allIn ? fmtOxNum(sum) : "？"}` +
    `　　めざす合計 ＝ ${want === 0 ? "0（もとの粒は電気的に中性）" : fmtOxNum(want)}`;
  t.parts.forEach((p, i) => {
    const inp = document.getElementById("splitIn" + i);
    if (!inp) return;
    inp.classList.toggle("ng", !!(res && res.wrong && res.wrong.includes(i)));
    const want2 = splitVals[i] === undefined ? "" : String(splitVals[i]);
    if (document.activeElement !== inp && inp.value !== want2) inp.value = want2;
  });
}

/* ---- 段2: イオンの中で酸化数を決める ---- */

function oxInput(i, elName) {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = "-4";
  inp.max = "8";
  inp.step = "1";
  inp.className = "oxIn";
  inp.id = "oxIn" + i + "_" + elName;
  const cur = (oxVals[i] || {})[elName];
  inp.value = cur === undefined ? "" : String(cur);
  inp.setAttribute("aria-label", elName + " の酸化数");
  // ⚠ ここでも作り直さない（焦点が飛ぶ）。印と検算の行だけ塗り替える
  inp.oninput = () => {
    const v = inp.value.trim();
    if (!oxVals[i]) oxVals[i] = {};
    /* ⚠ **空欄と 0 を区別する。** 0 は酸化数として正しい答えでありうる
       （単体の O₂ は 0）ので、係数の作法（v < 1 なら空欄）をそのまま持ち込むと
       0 が永遠に受け付けられない。 */
    if (v === "" || v === "-" || !Number.isInteger(Number(v))) delete oxVals[i][elName];
    else oxVals[i][elName] = Number(v);
    refresh();
  };
  return inp;
}

/* この元素の灰色の数が「その断片の電荷から出ている」か（＝ 段1で問うている答えそのものか）。
   単体の 0 も単原子イオンの値も、どちらも電荷からそのまま来る（oxKnownOf の最初の2枝）。 */
function chargeDerived(sp) {
  const s = SPECIES[sp];
  const els = Object.keys(s.atoms);
  return els.length === 1 && (s.charge === 0 || s.atoms[els[0]] === 1);
}

/* 段2の枠を作る。値の反映と印は refreshOx が受け持つ。
   ⚠ masked ＝ 段1がまだ片づいていない状態。**枠は出すが、段1の答えになる値は伏せる。** */
function buildOxSheet(masked) {
  oxSheetEl.innerHTML = "";
  const t = task();
  t.parts.forEach((p, i) => {
    const s = SPECIES[p.sp];
    const box = el("div", "oxPart" + (p.ask ? " oxAsk" : " oxSettled"));
    box.id = "oxPart" + i;
    const head = el("div", "oxPartHead");
    // ⚠ 伏せるあいだは電荷を落として書く（2K⁺ の ⁺ が段1の答え）
    head.append(el("span", "oxBigFormula",
      (p.n > 1 ? p.n + " " : "") + (masked ? dispNoCharge(p.sp) : s.disp)));
    if (!p.ask) head.append(el("span", "oxRole", "これで決まり"));
    box.appendChild(head);

    const rows = el("div", "oxRows");
    for (const eln of Object.keys(s.atoms)) {
      const known = oxKnownOf(p.sp, eln);
      const r = el("div", "oxRow");
      r.append(el("span", "oxEl", eln));
      if (known) {
        // ⚠ 電荷から来る灰色だけ伏せる。規則から来る灰色（O は −2）は段1と無関係
        const hide = masked && chargeDerived(p.sp);
        const g = el("span", "oxGiven", hide ? "？" : fmtOxNum(known.v));
        g.title = known.why;
        r.appendChild(g);
      } else {
        const inp = oxInput(i, eln);
        // 段1が片づくまでは押せない（めざす合計が決まっていないので、採点しようがない）
        inp.disabled = !!masked;
        r.appendChild(inp);
      }
      r.append(el("span", "oxCount", "× " + s.atoms[eln] + " 個"));
      r.append(el("span", "oxWhy", known ? known.why : "これを、合計から出す"));
      rows.appendChild(r);
    }
    box.appendChild(rows);

    // 検算の行。**答えは言わない** —— いま合計がいくつで、めざす合計がいくつか、だけ
    const chk = el("div", "oxCheckLine");
    chk.id = "oxChk" + i;
    if (masked) {
      /* ⚠ めざす合計 ＝ そのイオンの電荷 ＝ 段1の答え。伏せるあいだは ？ のまま。
         規則から来る数（O の −2）は上の行に出しているので、ここでも同じ数を出す
         —— 行と検算で食い違うと「どちらが本当か」が分からなくなる。 */
      const hide = chargeDerived(p.sp);
      chk.textContent = Object.keys(s.atoms).map((eln) => {
        const k = oxKnownOf(p.sp, eln);
        return `(${k && !hide ? fmtOxNum(k.v) : "？"})×${s.atoms[eln]}`;
      }).join(" ＋ ") + " ＝ ？　　めざす合計 ＝ ？（上の段で決める電荷）";
    }
    box.appendChild(chk);
    oxSheetEl.appendChild(box);
  });
}

/* 段2の塗り替え（作り直さない）。検算の行・入力欄の印だけを更新する */
function refreshOx(res) {
  const t = task();
  t.parts.forEach((p, i) => {
    const s = SPECIES[p.sp];
    let sum = 0, allKnown = true;
    const cells = Object.keys(s.atoms).map((eln) => {
      const known = oxKnownOf(p.sp, eln);
      const got = known ? known.v : (oxVals[i] || {})[eln];
      if (Number.isInteger(got)) sum += got * s.atoms[eln];
      else allKnown = false;
      return `(${Number.isInteger(got) ? fmtOxNum(got) : "？"})×${s.atoms[eln]}`;
    });
    const ok = allKnown && sum === s.charge;
    const chk = document.getElementById("oxChk" + i);
    if (chk) {
      chk.className = "oxCheckLine" + (allKnown ? (ok ? " okcell" : " ngcell") : "");
      chk.textContent = `${cells.join(" ＋ ")} ＝ ${allKnown ? fmtOxNum(sum) : "？"}` +
        `　　めざす合計 ＝ ${s.charge === 0 ? "0（電気的に中性）" : fmtOxNum(s.charge) + "（このイオンの電荷）"}`;
    }
    if (p.ask) {
      const inp = document.getElementById("oxIn" + i + "_" + p.ask);
      if (inp) {
        inp.classList.toggle("ng", !!(res && res.wrong && res.wrong.includes(i)));
        const cur = (oxVals[i] || {})[p.ask];
        const want = cur === undefined ? "" : String(cur);
        // 外（テストのフック）から値を入れたときだけ書き戻す（打っている途中は触らない）
        if (document.activeElement !== inp && inp.value !== want) inp.value = want;
      }
    }
  });
}

/* ---- 段3: 仮想的に単原子イオンへ分ける（⚠ 断りを外さない） ---- */

function buildVirtual() {
  virtWrapEl.innerHTML = "";
  const t = task();
  const target = t.parts.find((p) => p.ask);
  if (!target) { step3El.hidden = true; return; }
  const s = SPECIES[target.sp];
  if (Object.keys(s.atoms).length < 2) { step3El.hidden = true; return; }
  step3El.hidden = false;
  const btn = document.createElement("button");
  btn.className = "igSkip";
  btn.textContent = virtOpen ? "仮の分け方を閉じる" : "仮の分け方を見る（数えかたの正体）";
  btn.onclick = () => { virtOpen = !virtOpen; buildVirtual(); };
  virtWrapEl.appendChild(btn);
  if (!virtOpen) return;

  // 値は答えの表からではなく、**人が入れた数**から組み立てる（ここでも答えを持たない）
  const got = (oxVals[t.parts.indexOf(target)] || {})[target.ask];
  const vp = oxVirtualParts(target.sp, got);
  if (!vp) return;
  const line = el("div", "oxVirtLine halfFormula");
  line.append(el("span", "fterm", s.disp));
  line.append(el("span", "fsep", "→"));
  vp.forEach((v, i) => {
    if (i > 0) line.append(el("span", "fsep", "＋"));
    line.append(el("span", "fterm oxVirtIon", (v.n > 1 ? v.n + " " : "") + v.el + supCharge(v.ox)));
  });
  virtWrapEl.appendChild(line);
  const cav = el("div", "oxCaveat");
  cav.textContent = OX_VIRTUAL_CAVEAT.replace(/\*\*/g, "");
  virtWrapEl.appendChild(cav);
}

/* ---- 塗り替え（⚠ 入力欄は作り直さない） ----
   段2の枠は**最初から出す**。作り直すのは「回が変わったとき」と「伏せ方が変わったとき」だけ。
   ★ ここが **段を分けて徹底させる**しくみの実体 —— 段1が ok になるまで段2の値は伏せたまま
   （枠は見えるが、めざす合計が ？ なので**書きようがない**）。 */

let oxBuiltFor = null;     // 段2の枠を作った回（taskIdx）
let oxBuiltMasked = null;  // そのとき伏せていたか（切り替わったら作り直す）

function refresh() {
  const t = task();
  if (t.needsSplit) {
    const r = splitState();
    refreshSplit(r);
    setStatusMsg(splitMsgEl, r.reason, r.ok ? "ok" : r.kind === "wrong" ? "ng" : "info");
    whySplitEl.textContent = t.verdict.reason.replace(/\*\*/g, "");
    whySplitEl.className = "footNote" + (t.verdict.kind === "possible" ? "" : " oxWhyStrong");
  }
  const done = splitDone();
  // ★ いま入れるところをハイライトする（段は両方とも出したまま）
  step1El.classList.toggle("stepNow", !done);
  step2El.classList.toggle("stepNow", done);
  step2El.classList.toggle("oxLocked", !done);
  document.getElementById("step1Now").hidden = done;
  document.getElementById("step2Now").hidden = !done;
  if (oxBuiltFor !== taskIdx || oxBuiltMasked !== !done) {
    buildOxSheet(!done);
    oxBuiltFor = taskIdx; oxBuiltMasked = !done;
  }
  givenNoteEl.textContent =
    "灰色の数は規則で決まったぶん —— 単体は 0、単原子イオンは電荷そのもの、" +
    "化合物の中の O は −2・H は +1。自分で出すのは、残った1つだけ。";
  if (!done) {
    setStatusMsg(oxMsgEl, "上の段でイオンに分けると、ここが1個ずつの問題になる。", "info");
    step3El.hidden = true;
    clearEl.hidden = true;
    return;
  }
  const res = checkOxSheet(t.sp, oxVals);
  refreshOx(res);
  setStatusMsg(oxMsgEl, res.reason, res.ok ? "ok" : res.kind === "wrong" ? "ng" : "info");
  if (!res.ok) {
    step3El.hidden = true;
    clearEl.hidden = true;
    return;
  }
  buildVirtual();
  clearEl.hidden = false;
  showClear();
}

function showClear() {
  clearEl.innerHTML = "";
  const t = task();
  clearEl.appendChild(el("div", null,
    t.needsSplit
      ? `クリア！ ${SPECIES[t.sp].disp} を先にイオンへ分けたので、あとは1つずつ決まった。`
      : "クリア！ 規則で埋めて、残りを合計から出した。"));
  if (taskIdx < TASKS.length - 1) {
    const b = document.createElement("button");
    b.textContent = "次の物質へ →";
    b.onclick = () => { taskIdx++; initTask(); };
    clearEl.appendChild(b);
  } else {
    clearEl.appendChild(el("div", null, "酸化数の練習を全クリア！"));
  }
}

function taskLabel(i) {
  return `${i + 1}：${SPECIES[TASKS[i].sp].disp}`;
}

function buildStageNav() {
  stageNavEl.innerHTML = "";
  TASKS.forEach((t, i) => {
    const b = document.createElement("button");
    /* ⚠ **帯に出すのは番号だけ**（他の全モードと同じ）。#stageNav button は 34px の丸で、
       化学式を入れると (NH₄) や Cr₂(S のところで切れて読めなくなる（実機で確認）。
       行き先の名前は title と「☰ 一覧」のシートが持つ。 */
    b.textContent = String(i + 1);
    b.className = i === taskIdx ? "active" : "";
    b.title = taskLabel(i);
    // ヘッダーの「☰ 一覧」が読む行き先の名前（header-ui.js）
    b.dataset.label = SPECIES[t.sp].disp;
    b.onclick = () => { taskIdx = i; initTask(); };
    stageNavEl.appendChild(b);
  });
}

function initTask() {
  splitVals = [];
  oxVals = {};
  virtOpen = false;
  buildStageNav();
  const t = task();
  stageTitleEl.innerHTML = "";
  stageTitleEl.appendChild(el("strong", null, `${taskLabel(taskIdx)} —— ${SPECIES[t.sp].name}`));
  oxBuiltFor = null; oxBuiltMasked = null;
  buildSplit();
  refresh();
}

/* テスト・監査用フック */
window.OxNum = {
  count() { return TASKS.length; },
  list() { return TASKS.map((t) => t.sp); },
  state() {
    const t = task();
    const sp = t.needsSplit ? checkOxSplit(t.sp, splitVals) : null;
    const ox = checkOxSheet(t.sp, oxVals);
    return {
      taskIdx, sp: t.sp, needsSplit: t.needsSplit, verdict: t.verdict.kind,
      splitOk: t.needsSplit ? sp.ok : true, splitRest: t.needsSplit ? sp.rest : 0,
      // ★ 段2は最初から見えている。進みを示すのは「伏せているか」のほう
      step2Visible: !step2El.hidden, step2Masked: !!oxBuiltMasked, step3Visible: !step3El.hidden,
      oxOk: ox.ok, oxRest: ox.rest, asks: ox.total,
      clear: !clearEl.hidden,
    };
  },
  goto(sp) {
    const i = TASKS.findIndex((t) => t.sp === sp);
    if (i < 0) return false;
    taskIdx = i; initTask(); return true;
  },
  setSplit(i, v) {
    if (v === null) delete splitVals[i]; else splitVals[i] = v;
    const inp = document.getElementById("splitIn" + i);
    if (inp) inp.value = v === null ? "" : String(v);
    refresh();
  },
  setOx(i, elName, v) {
    if (!oxVals[i]) oxVals[i] = {};
    if (v === null) delete oxVals[i][elName]; else oxVals[i][elName] = v;
    refresh();
  },
  toggleVirtual() { virtOpen = !virtOpen; buildVirtual(); return virtOpen; },
};

const idParam = new URLSearchParams(location.search).get("sp");
if (idParam) {
  const i = TASKS.findIndex((t) => t.sp === idParam);
  if (i >= 0) taskIdx = i;
}

initTask();

})();
