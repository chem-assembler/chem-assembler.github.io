"use strict";
/* audit.js — 夜間自動監査（audit.html から読み込む）。
   実アプリを iframe で駆動し、無人で不変条件を検査する。

   ここで見る不変条件は、これまで手動の実機確認でしか見つからなかった種類の破綻を対象にしている:
     ・原子の保存（粒が消える／勝手に増える）
     ・反応が完了する（途中で止まらない・無限に動き続けない）
     ・粒が重ならない（同じ位置に描かれて1個に見える）
     ・粒が容器の外に出ない
   回帰テスト（tests.js）は「結果の個数」を見るが、監査は「途中経過と見た目の破綻」を見る。 */

(() => {

const frame = document.getElementById("audit-frame");
const frameRedox = document.getElementById("audit-frame-redox");
const frameCond = document.getElementById("audit-frame-cond");
const frameLink = document.getElementById("audit-frame-link");
const resultsEl = document.getElementById("results");
const progressEl = document.getElementById("progress");
const summaryEl = document.getElementById("summary");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnDownload = document.getElementById("btn-download");

let running = false;
let stopReq = false;
let report = null;

/* 非表示タブでも速度が落ちない譲り合い。
   setTimeout は省電力で 1 秒に丸められ、5分以上隠れたタブでは 1 分に1回まで落ちる
   （Chrome の intensive throttling）。1件あたり最大1分では「無人の夜間実行」という
   このページの目的そのものが成り立たないので、待ち合わせをタイマーに依存させない。
   MessageChannel の postMessage は丸められないため、これでマクロタスクを1つ挟む
   （＝描画とiframeの読み込みには譲るが、時間では待たない）。 */
const yieldQueue = [];
const yieldCh = new MessageChannel();
yieldCh.port1.onmessage = () => { const r = yieldQueue.shift(); if (r) r(); };
const yieldTask = () => new Promise((r) => { yieldQueue.push(r); yieldCh.port2.postMessage(0); });

/* 再現可能な擬似乱数（mulberry32）。失敗したシードを控えれば同じ手順を再現できる */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function progress(text) { progressEl.textContent = text; }

function addResult(mode, name, issues, extra) {
  const ok = issues.length === 0;
  report.counts[ok ? "ok" : "fail"]++;
  const rec = Object.assign({ mode, name, issues }, extra || {});
  if (!ok) report.records.push(rec);
  if (!ok) {
    const li = document.createElement("li");
    li.className = "fail";
    li.textContent = `❌ [${mode}] ${name}: ${issues.join(" / ")}`;
    resultsEl.appendChild(li);
    resultsEl.scrollTop = resultsEl.scrollHeight;
  }
  summaryEl.textContent = `検査 ${report.counts.ok + report.counts.fail} 件（問題 ${report.counts.fail} 件）`;
  summaryEl.className = report.counts.fail === 0 ? "pass" : "fail";
}

/* ---- アプリ操作のヘルパ ---- */

function W() { return frame.contentWindow; }
function D() { return frame.contentDocument; }
const $$ = (sel) => [...D().querySelectorAll(sel)];
const addBtns = () => $$("#toolbar .add");
const reactBtn = () => D().querySelector("#toolbar .react");
const resetBtn = () => D().querySelector("#toolbar .reset");
const stageBtn = (i) => $$("#stageNav button")[i];

/* 種の原子数（e⁻ は原子を持たない） */
function atomCount(sp) {
  const s = SPECIES[sp];
  if (!s) return 0;
  return Object.values(s.atoms).reduce((a, b) => a + b, 0);
}

/* いまビーカーにある粒＋空気中へ逃げた気体の、原子の総数 */
function atomsInBeaker(st) {
  let n = 0;
  for (const [sp, c] of Object.entries(st.counts || {})) n += atomCount(sp) * c;
  for (const [sp, c] of Object.entries(st.escaped || {})) n += atomCount(sp) * c;
  return n;
}

/* 容器（水そう／気体の空間）の矩形。粒がここから出ていないかを見る */
function containerRect() {
  const r = D().querySelector("#beaker rect");
  if (!r) return null;
  return {
    x: +r.getAttribute("x"), y: +r.getAttribute("y"),
    w: +r.getAttribute("width"), h: +r.getAttribute("height"),
  };
}

/* 粒の重なり・枠外を検査する。
   移動中（seek/moveTo）はすれ違うことがあるので、静止している粒だけを対象にする */
function inspectParticles(margin) {
  const issues = [];
  const ps = W().IonEq.particles().filter((p) =>
    ["float", "still", "settled", "pop"].includes(p.mode));
  const rect = containerRect();
  if (rect) {
    for (const p of ps) {
      if (p.x + p.r < rect.x - margin || p.x - p.r > rect.x + rect.w + margin ||
          p.y + p.r < rect.y - margin || p.y - p.r > rect.y + rect.h + margin) {
        issues.push(`枠外に出た ${p.sp}(${Math.round(p.x)},${Math.round(p.y)})`);
        break;
      }
    }
  }
  // 枠つきの粒は横長なので、見た目の幅・高さ（hw/hr）で食い込みを見る。
  // 6割を超えて重なっていたら「1個に見える」とみなす
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const dx = Math.abs(ps[i].x - ps[j].x), dy = Math.abs(ps[i].y - ps[j].y);
      const sw = (ps[i].hw || ps[i].r) + (ps[j].hw || ps[j].r);
      const sh = (ps[i].hr || ps[i].r) + (ps[j].hr || ps[j].r);
      if (dx < sw * 0.4 && dy < sh * 0.4) {
        issues.push(`粒が重なっている ${ps[i].sp}/${ps[j].sp}（dx${Math.round(dx)}/${Math.round(sw)} dy${Math.round(dy)}/${Math.round(sh)}）`);
        return issues;
      }
    }
  }
  return issues;
}

/* 反応が落ち着くまで進める。動きが止まった時点で切り上げ、
   最後まで動きが残っていたら「止まらない」とみなして返す */
function settle(maxSeconds) {
  const MOVING = ["seek", "arrivedWait", "intermediate", "moveTo", "sink", "fall"];
  const moving = () => W().IonEq.particles().filter((p) => MOVING.includes(p.mode));
  // busy = 段取り演出の途中（粒は静止しているが、予約された動きが残っている）
  const busy = () => !!W().IonEq.state().busy;
  for (let t = 0; t < maxSeconds; t += 2) {
    W().IonEq.advance(2000);
    if (!moving().length && !busy()) {
      // 連鎖反応などが動き出さないか、少しだけ様子を見る
      W().IonEq.advance(2000);
      if (!moving().length && !busy()) return [];
    }
  }
  return moving();
}

/* 1ケースぶんの検査（ステージを選び、指定数だけ投入して反応させる） */
function runCase(stageIdx, counts) {
  const issues = [];
  const stage = STAGES[stageIdx];
  stageBtn(stageIdx).click();
  const btns = addBtns();
  stage.reactants.forEach((sp, i) => {
    for (let k = 0; k < (counts[i] || 0); k++) btns[i].click();
  });
  // 押した回数ではなく**実際に入った数**で数える。
  // C群には並べられる上限があり、押しても入らないことがある（それは仕様であって不具合ではない）
  const added = W().IonEq.state().added || {};
  const baseAtoms = stage.reactants.reduce((s, sp) => s + atomCount(sp) * (added[sp] || 0), 0);
  // 反応に参加した溶媒（弱塩基の電離で使う水）は投入ぶんに足す。反応が進むと増えるので毎回数え直す
  const solventAtoms = () => {
    const used = W().IonEq.state().solventUsed || {};
    return Object.keys(used).reduce((s, sp) => s + atomCount(sp) * used[sp], 0);
  };
  W().IonEq.advance(6000);
  // 投入直後の原子数（電離・原子化で分かれても総数は変わらないはず）
  const before = atomsInBeaker(W().IonEq.state());
  if (before !== baseAtoms + solventAtoms()) {
    issues.push(`投入直後に原子数が合わない（入れた${baseAtoms + solventAtoms()} / ある${before}）`);
  }
  reactBtn().click();
  const moving = settle(70);
  if (moving.length) {
    issues.push(`反応が止まらない（${moving.map((p) => p.sp + ":" + p.mode).slice(0, 4).join(",")}）`);
  }
  const st = W().IonEq.state();
  const after = atomsInBeaker(st);
  const addedAtoms = baseAtoms + solventAtoms();
  if (after !== addedAtoms) {
    issues.push(`反応で原子数が変わった（入れた${addedAtoms} → ${after}）`);
  }
  issues.push(...inspectParticles(14));
  return { issues, state: st, addedAtoms };
}

/* ---- ①全ステージ検査（模範比） ---- */

async function auditStages() {
  for (let i = 0; i < STAGES.length && !stopReq; i++) {
    const stage = STAGES[i];
    progress(`①全ステージ ${i + 1}/${STAGES.length}: ${stage.title}`);
    let res;
    try {
      resetBtn() && resetBtn().click();
      res = runCase(i, stage.answer.slice(0, stage.reactants.length));
    } catch (e) {
      addResult("stage", stage.id, ["例外: " + e.message]);
      await yieldTask();
      continue;
    }
    const issues = res.issues.slice();
    // 模範比なので、ちょうど反応しきってクリアできるはず
    if (!res.state.reactionDone) issues.push("模範比なのに反応が完了しない");
    addResult("stage", stage.id, issues, { counts: res.state.counts });
    await yieldTask();
  }
}

/* ---- ②ランダム投入ファズ ---- */

async function auditFuzz(iterations, seed) {
  const rnd = mulberry32(seed);
  for (let n = 0; n < iterations && !stopReq; n++) {
    const i = Math.floor(rnd() * STAGES.length);
    const stage = STAGES[i];
    // 0〜模範比+2 の範囲でランダムに投入する（0個や入れすぎも含めて壊れないか見る）
    const counts = stage.reactants.map((sp, k) =>
      Math.floor(rnd() * (stage.answer[k] + 3)));
    const label = `${stage.id} [${counts.join(",")}] seed=${seed}#${n}`;
    if (n % 5 === 0) progress(`②ファズ ${n + 1}/${iterations}: ${label}`);
    try {
      resetBtn() && resetBtn().click();
      const res = runCase(i, counts);
      const issues = res.issues.slice();
      // 何も入れていなければ反応は起きない、が正しい
      if (counts.every((c) => c === 0) && res.state.reactionDone) {
        issues.push("何も入れていないのに反応完了になった");
      }
      addResult("fuzz", label, issues, { counts: res.state.counts });
    } catch (e) {
      addResult("fuzz", label, ["例外: " + e.message]);
    }
    await yieldTask();
  }
}

/* ---- ③酸化還元モード ---- */

async function auditRedox(seed) {
  const RW = frameRedox.contentWindow;
  const RD = frameRedox.contentDocument;
  const rnd = mulberry32(seed + 977);
  const navs = () => [...RD.querySelectorAll("#stageNav button")];
  const ups = () => [...RD.querySelectorAll(".halfRow .stepper button")].filter((b) => b.textContent === "＋");
  for (let i = 0; i < REDOX_STAGES.length && !stopReq; i++) {
    const st = REDOX_STAGES[i];
    // 模範倍率と、ランダムにずらした倍率の両方を試す
    for (const useAnswer of [true, false]) {
      const label = `${st.id} ${useAnswer ? "模範倍率" : "ランダム倍率"}`;
      progress(`③酸化還元 ${label}`);
      try {
        navs()[i].click();
        const mult = useAnswer
          ? st.answer.slice()
          : [1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 4)];
        for (let k = 1; k < mult[0]; k++) ups()[0].click();
        for (let k = 1; k < mult[1]; k++) ups()[1].click();
        RD.getElementById("playBtn").click();
        RW.RedoxEq.advance(60000);
        const s = RW.RedoxEq.state();
        const issues = [];
        if (s.phase !== "done") issues.push(`再生が終わらない（phase=${s.phase}）`);
        // 模範倍率ならクリア、e⁻ の過不足なし
        if (useAnswer) {
          if (!s.cleared) issues.push("模範倍率なのにクリアにならない");
          if (s.poolE !== 0) issues.push(`e⁻ が ${s.poolE} 個余った`);
          if (s.waiting !== 0) issues.push(`e⁻ 待ちが ${s.waiting} 組残った`);
        } else if (s.cleared) {
          // ずらした倍率でクリアするのは、たまたま模範と一致したときだけ
          const ok = mult[0] === st.answer[0] && mult[1] === st.answer[1];
          if (!ok) issues.push(`模範でない倍率 ${mult.join(":")} でクリアになった`);
        }
        addResult("redox", `${label} ×${mult.join(":")}`, issues, { state: s });
      } catch (e) {
        addResult("redox", label, ["例外: " + e.message]);
      }
      await yieldTask();
    }
  }
}

/* 数の計算が壊れると画面に NaN や undefined が出る。それを文字列から拾う。
   ただし化学式には **NaNO₃**（硝酸ナトリウム）のように "NaN" を含むものがあるので、
   単語境界で見る（NaNO₃ の N と O は続いた文字なので境界にならず、拾われない）。 */
const BROKEN_NUMBER = /NaN|Infinity|undefined/;

/* ---- ④液性モード（酸性 ⇄ 塩基性の書き換え） ---- */

async function auditCondition(seed) {
  const CW = frameCond.contentWindow;
  const CD = frameCond.contentDocument;
  const rnd = mulberry32(seed + 4231);
  const navs = () => [...CD.querySelectorAll("#stageNav button")];
  const plus = () => CD.querySelectorAll("#rowAddOH .stepper button")[1];
  for (let i = 0; i < CONDITION_STAGES.length && !stopReq; i++) {
    const st = CONDITION_STAGES[i];
    for (const useAnswer of [true, false]) {
      const label = `${st.id} ${useAnswer ? "正解の個数" : "ずらした個数"}`;
      progress(`④液性 ${label}`);
      try {
        navs()[i].click();
        const need = CW.ConditionEq.state().need;
        const n = useAnswer ? need : 1 + Math.floor(rnd() * 6);
        for (let k = 0; k < n; k++) plus().click();
        const s = CW.ConditionEq.state();
        const issues = [];
        if (s.addedOH !== n) issues.push(`足した数が反映されない（${s.addedOH} ≠ ${n}）`);
        if (useAnswer) {
          if (!s.ok) issues.push("正解の個数なのに完成しない");
          if (!s.matchesData) issues.push("導いた式が登録の塩基性形と違う");
          if (CD.getElementById("rowBasic").hidden) issues.push("塩基性条件の式が出ない");
          if (CD.getElementById("clearBanner").hidden) issues.push("クリアにならない");
        } else if (n !== need) {
          if (s.ok) issues.push(`ずらした個数 ${n} で完成扱いになった`);
          if (!CD.getElementById("rowBasic").hidden) issues.push("未完成なのに塩基性条件の式が出ている");
          if (!CD.getElementById("clearBanner").hidden) issues.push("未完成なのにクリアになった");
        }
        // 数の計算が壊れると文字列に出るので、表示ごと見る
        if (BROKEN_NUMBER.test(CD.getElementById("timeline").textContent)) {
          issues.push("表示に NaN/undefined が出ている");
        }
        addResult("condition", `${label} +${n}`, issues, { state: s });
      } catch (e) {
        addResult("condition", label, ["例外: " + e.message]);
      }
      await yieldTask();
    }
  }
}

/* ---- ⑤入り口のリンク ----
   単元ページのリンクを**実際に開いて**、狙ったステージが開くかを見る。
   回帰テストは href の形しか見ないので、ページ側のディープリンク処理が壊れても気づけない。 */

function loadFrame(url) {
  return new Promise((res) => {
    frameLink.onload = () => res();
    frameLink.src = url;
  });
}

/* 条件が満たされるまで待つ（アプリのフックが用意されるまでの待ち合わせ）。
   ここも sleep で刻まない（非表示タブだと1回の待ちが1分になる）。マクロタスクを
   譲りながら回すので、iframe の読み込みは進む。整うのは普通 0.2 秒ほどで、
   空回りが続くのは本当に開けなかったときだけ（上限 ms で打ち切る） */
async function waitFor(fn, ms) {
  const until = Date.now() + (ms || 4000);
  while (Date.now() < until) {
    try { if (fn()) return true; } catch (e) { /* まだ読み込み中 */ }
    await yieldTask();
  }
  return false;
}

const LINK_APPS = {
  "index.html":     { hook: "IonEq", list: () => STAGES },
  "redox.html":     { hook: "RedoxEq", list: () => REDOX_STAGES },
  "condition.html": { hook: "ConditionEq", list: () => CONDITION_STAGES },
};

async function auditPortalLinks() {
  progress("⑤入り口 リンクを集める");
  await loadFrame("portal.html");
  if (!await waitFor(() => frameLink.contentWindow.Portal, 5000)) {
    addResult("portal", "portal.html", ["入り口ページが読み込めない"]);
    return;
  }
  const PD = frameLink.contentDocument;
  const chips = [...PD.querySelectorAll(".stageChip")].map((a) => a.getAttribute("href"));
  const roles = [...PD.querySelectorAll(".roleCard")].map((a) => a.getAttribute("href"));
  addResult("portal", "リンクの数", chips.length >= 40 ? [] : [`ステージのリンクが少なすぎる（${chips.length}）`]);
  for (const href of [...roles, ...chips]) {
    if (stopReq) break;
    const [page, qs] = href.split("?");
    const app = LINK_APPS[page];
    progress(`⑤入り口 ${href}`);
    try {
      await loadFrame(href);
      if (!app) {
        // library.html など。フックが無いので「開けて中身がある」ことだけ見る
        const ok = await waitFor(() => frameLink.contentDocument.body.textContent.length > 50, 5000);
        addResult("portal", href, ok ? [] : ["ページが開かない／中身が空"]);
        continue;
      }
      const ok = await waitFor(() => frameLink.contentWindow[app.hook], 5000);
      if (!ok) { addResult("portal", href, [`${app.hook} が用意されない（開けていない）`]); continue; }
      const issues = [];
      const params = new URLSearchParams(qs || "");
      const id = params.get("rxn") || params.get("s");
      if (id) {
        const want = app.list().findIndex((x) => x.id === id);
        const got = frameLink.contentWindow[app.hook].state().stageIdx;
        if (want < 0) issues.push(`存在しないステージ ${id} を指している`);
        else if (got !== want) issues.push(`開いたステージが違う（${got} ≠ ${want}／${id}）`);
      }
      if (BROKEN_NUMBER.test(frameLink.contentDocument.body.textContent)) {
        issues.push("開いた先の表示に NaN/undefined が出ている");
      }
      addResult("portal", href, issues);
    } catch (e) {
      addResult("portal", href, ["例外: " + e.message]);
    }
    await yieldTask();
  }
}

/* ---- 実行制御 ---- */

async function start() {
  if (running) return;
  running = true; stopReq = false;
  btnStart.disabled = true; btnStop.disabled = false; btnDownload.disabled = true;
  resultsEl.innerHTML = "";
  const seed = +document.getElementById("seed").value || 1;
  report = {
    startedAt: new Date().toISOString(),
    app: "ion-equation",
    version: (D().querySelector(".version") || {}).textContent || "?",
    seed,
    counts: { ok: 0, fail: 0 },
    records: [],
  };
  try {
    if (document.getElementById("mode-stages").checked) await auditStages();
    if (document.getElementById("mode-fuzz").checked && !stopReq) {
      await auditFuzz(+document.getElementById("fuzz-iterations").value || 100, seed);
    }
    if (document.getElementById("mode-redox").checked && !stopReq) await auditRedox(seed);
    if (document.getElementById("mode-condition").checked && !stopReq) await auditCondition(seed);
    if (document.getElementById("mode-portal").checked && !stopReq) await auditPortalLinks();
  } catch (e) {
    addResult("audit", "監査そのものが停止", ["例外: " + e.message]);
  }
  report.finishedAt = new Date().toISOString();
  progress(stopReq ? "停止しました" : "監査おわり");
  running = false;
  btnStart.disabled = false; btnStop.disabled = true; btnDownload.disabled = false;
}

btnStart.onclick = start;
btnStop.onclick = () => { stopReq = true; progress("停止要求…"); };
btnDownload.onclick = () => {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ion-equation-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
};

/* 監査用フック（自動起動の待ち合わせに使う） */
window.IonAudit = {
  ready() {
    return !!(frame.contentWindow && frame.contentWindow.IonEq &&
      frameRedox.contentWindow && frameRedox.contentWindow.RedoxEq);
  },
  start,
  report() { return report; },
};

})();
