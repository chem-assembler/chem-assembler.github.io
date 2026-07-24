"use strict";
/* tests.js — 回帰テスト。
   前半: model.js の純ロジックテスト（node でも実行可）。
   後半: iframe で実アプリを駆動する UI テスト（ブラウザのみ）。
   アニメ時間は IonEq.advance(ms) で決定論的に進めるため、待ち時間やタイマーに依存しない。 */

function sortObjKeys(o) {
  return Object.fromEntries(Object.entries(o).sort());
}

function runModelTests() {
  const results = [];
  const t = (name, fn) => {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };

  t("SPECIES: 全種に disp・atoms・charge が定義されている", () => {
    for (const [k, s] of Object.entries(SPECIES)) {
      assert(s.disp && s.atoms && typeof s.charge === "number", k);
      assert(Object.keys(s.atoms).length > 0 || k === "e-", k + " atoms empty");
    }
  });

  t("電離表: 電離の前後で原子と電荷が保存される", () => {
    for (const [mol, ions] of Object.entries(DISSOCIATION)) {
      const L = tallyTerms([{ sp: mol, n: 1 }]);
      const R = tallyTerms(ions.map((i) => ({ sp: i, n: 1 })));
      assert(JSON.stringify(sortObjKeys(L.atoms)) === JSON.stringify(sortObjKeys(R.atoms)), mol + ": 原子が保存されない");
      assert(L.charge === R.charge, mol + ": 電荷が保存されない");
    }
  });

  t("各ステージの模範係数が正解判定される", () => {
    for (const st of STAGES) {
      assert(checkStageCoeffs(st, st.answer).ok, st.id);
    }
  });

  t("係数に0（未入力）があれば不正解", () => {
    assert(!checkStageCoeffs(STAGES[0], [0, 1, 1, 1]).ok);
  });

  t("つり合っていない係数は不正解", () => {
    assert(!checkStageCoeffs(STAGES[1], [1, 1, 1, 1]).ok, "H2SO4+NaOH を全部1で通してしまう");
  });

  t("最簡整数比でない係数は不正解", () => {
    const res = checkStageCoeffs(STAGES[0], [2, 2, 2, 2]);
    assert(!res.ok, "2,2,2,2 を通してしまう");
    assert(res.reason.includes("簡単な整数比"), "理由が最簡比になっていない: " + res.reason);
  });

  t("ステージ参照種がすべて定義済み・反応物は電離表にある", () => {
    for (const st of STAGES) {
      for (const sp of [...st.reactants, ...st.products]) assert(SPECIES[sp], st.id + ": " + sp);
      for (const sp of st.reactants) assert(DISSOCIATION[sp], st.id + " 電離表なし: " + sp);
      assert(st.answer.length === st.reactants.length + st.products.length, st.id + ": answer の長さ");
      assert(st.netIon && st.intro && st.title, st.id + ": 表示文の欠落");
    }
  });

  t("単元タグ: 全ステージに正しいタグが定義されている（塩の分類含む）", () => {
    for (const st of STAGES) {
      const tags = STAGE_TAGS[st.id];
      assert(tags && tags.length > 0, st.id + ": 単元タグなし");
      // saltGoal を持つ＝酸性塩、持たない＝正塩、で塩の分類が整合すること
      if (st.saltGoal) assert(tags.includes("酸性塩"), st.id + ": 酸性塩タグが無い");
      else assert(!tags.includes("酸性塩"), st.id + ": 正塩なのに酸性塩タグ");
    }
  });

  t("PARTS: 全ステージの全項が粒に分解でき、原子と電荷が保存される", () => {
    for (const st of STAGES) {
      for (const sp of [...st.reactants, ...st.products]) {
        const parts = PARTS[sp];
        assert(parts, sp + " の分解表なし");
        const L = tallyTerms([{ sp, n: 1 }]);
        const R = tallyTerms(parts.map((p) => ({ sp: p, n: 1 })));
        assert(JSON.stringify(sortObjKeys(L.atoms)) === JSON.stringify(sortObjKeys(R.atoms)), sp + ": 原子が保存されない");
        assert(L.charge === R.charge, sp + ": 電荷が保存されない");
      }
    }
  });

  t("simulateFormation: 模範の左辺係数なら余りゼロで右辺係数どおりの個数ができる", () => {
    for (const st of STAGES) {
      const nL = st.reactants.length;
      const sim = simulateFormation(st, st.answer.slice(0, nL));
      assert(Object.keys(sim.leftovers).length === 0, st.id + ": 余り " + JSON.stringify(sim.leftovers));
      st.products.forEach((sp, j) => {
        assert(sim.formed[sp] === st.answer[nL + j], st.id + ": " + sp + " が " + sim.formed[sp] + " 個");
      });
    }
  });

  t("simulateFormation: 左辺が不つり合いなら余りが出る", () => {
    const sim = simulateFormation(STAGES[1], [1, 1]); // H₂SO₄ 1 : NaOH 1
    assert(sim.leftovers["H+"] >= 1, "H+ が余らない: " + JSON.stringify(sim.leftovers));
    assert(sim.formed["H2O"] === 1, "H2O は1個できるはず");
    assert(sim.formed["Na2SO4"] === 0, "Na2SO4 は作れないはず");
  });

  t("反応ルール: 参照種が定義済みで、原子と電荷が保存される（中間体含む）", () => {
    for (const st of STAGES) {
      assert(st.rules && st.rules.length > 0, st.id + ": rules なし");
      for (const rule of st.rules) {
        assert(rule.find.length >= 2, st.id + ": find が2種未満");
        for (const sp of rule.find) assert(SPECIES[sp], st.id + ": " + sp);
        const makes = Array.isArray(rule.make) ? rule.make : [rule.make];
        for (const sp of makes) assert(SPECIES[sp], st.id + ": " + sp);
        assert(["combine", "precipitate", "gas"].includes(rule.kind), st.id + ": kind 不正 " + rule.kind);
        const L = tallyTerms(rule.find.map((sp) => ({ sp, n: 1 })));
        const R = tallyTerms(makes.map((sp) => ({ sp, n: 1 })));
        assert(JSON.stringify(sortObjKeys(L.atoms)) === JSON.stringify(sortObjKeys(R.atoms)), st.id + ": ルールで原子が保存されない");
        assert(L.charge === R.charge, st.id + ": ルールで電荷が保存されない");
        if (rule.via) {
          const V = tallyTerms([{ sp: rule.via, n: 1 }]);
          assert(JSON.stringify(sortObjKeys(L.atoms)) === JSON.stringify(sortObjKeys(V.atoms)) && L.charge === V.charge,
            st.id + ": 中間体 " + rule.via + " で保存されない");
        }
      }
    }
  });

  t("STRUCTURE: 房の原子の内訳が SPECIES の組成と一致する", () => {
    for (const [sp, st] of Object.entries(STRUCTURE)) {
      assert(SPECIES[sp], sp + ": SPECIES にない");
      const m = {};
      for (const a of st.atoms) m[a.el] = (m[a.el] || 0) + 1;
      assert(JSON.stringify(sortObjKeys(m)) === JSON.stringify(sortObjKeys(SPECIES[sp].atoms)),
        sp + ": 房の内訳 " + JSON.stringify(m) + " ≠ 組成 " + JSON.stringify(SPECIES[sp].atoms));
      if (SPECIES[sp].charge !== 0) assert(st.env, sp + ": 多原子イオンに包み（env）がない");
    }
    // ステージに登場する多原子イオンと分子はすべて房データを持つ
    for (const st2 of STAGES) {
      for (const sp of [...st2.reactants, ...st2.products]) {
        if (Object.keys(SPECIES[sp].atoms).length > 1) {
          assert(STRUCTURE[sp] || DISSOCIATION[sp], sp + ": 房も電離表もない");
        }
      }
    }
  });

  t("半反応式: 原子と電荷が保存され、e⁻ を含む", () => {
    for (const [id, hr] of Object.entries(HALF_REACTIONS)) {
      assert(compareSides(hr.left, hr.right).balanced, id + " がつり合わない");
      assert(electronsOf(hr) > 0, id + ": e⁻ がない");
      assert(hr.kind === "oxidation" || hr.kind === "reduction", id + ": kind 不正");
    }
  });

  t("酸化還元: 模範倍率が正解、e⁻ 不一致や非最簡比は不正解", () => {
    for (const st of REDOX_STAGES) {
      assert(HALF_REACTIONS[st.ox] && HALF_REACTIONS[st.red], st.id + ": 半反応式なし");
      assert(checkRedoxMultipliers(st, st.answer[0], st.answer[1]).ok, st.id);
      assert(!checkRedoxMultipliers(st, st.answer[0] * 2, st.answer[1] * 2).ok, st.id + ": 2倍を通した");
    }
    assert(!checkRedoxMultipliers(REDOX_STAGES[1], 1, 1).ok, "r2 の 1:1 を通した");
  });

  t("酸化数: 種の電荷と一致し、Δ酸化数が半反応式の e⁻ 数と一致する", () => {
    for (const [sp, ox] of Object.entries(OXIDATION)) {
      const s = SPECIES[sp];
      let sum = 0;
      for (const el of Object.keys(s.atoms)) {
        assert(ox[el] !== undefined, sp + ": " + el + " の酸化数の定義漏れ");
        sum += ox[el] * s.atoms[el];
      }
      assert(sum === s.charge, sp + ": 酸化数の合計(" + sum + ")が電荷(" + s.charge + ")と一致しない");
    }
    for (const [id, hr] of Object.entries(HALF_REACTIONS)) {
      const changes = oxChangeOfHalf(hr);
      assert(changes.length === 1, id + ": 変化する元素が1つでない");
      const atomsL = tallyTerms(hr.left.filter((t) => t.sp !== "e-"));
      const delta = changes.reduce((acc, c) => acc + (c.to - c.from) * atomsL.atoms[c.el], 0);
      const e = electronsOf(hr);
      assert(delta === (hr.kind === "oxidation" ? e : -e),
        id + ": Δ酸化数(" + delta + ")と e⁻ 数(" + e + ")の帳尻が合わない");
    }
  });

  t("溶液中の酸化還元: 半反応式が定義され、combineHalves でイオン反応式がつり合う", () => {
    // MnO₄⁻ × Fe²⁺（1:5）と Cr₂O₇²⁻ × Fe²⁺（1:6）の足し合わせが釣り合う
    const cases = [
      { ox: "Fe2_ox", red: "MnO4_red", a: 5, b: 1 },
      { ox: "Fe2_ox", red: "Cr2O7_red", a: 6, b: 1 },
    ];
    for (const c of cases) {
      assert(HALF_REACTIONS[c.ox] && HALF_REACTIONS[c.red], c.red + ": 半反応式なし");
      const chk = checkRedoxMultipliers({ ox: c.ox, red: c.red }, c.a, c.b);
      assert(chk.ok, c.red + ": 倍率が e⁻ 一致＆最簡比にならない: " + JSON.stringify(chk));
      const combined = combineHalves({ ox: c.ox, red: c.red }, c.a, c.b);
      assert(!combined.left.concat(combined.right).some((t) => t.sp === "e-"), c.red + ": e⁻ が残った");
      assert(compareSides(combined.left, combined.right).balanced, c.red + ": イオン反応式が保存しない");
    }
  });

  t("色データ: SPECIES_COLOR は SPECIES 内で、主要な有色種に色がある", () => {
    for (const sp of Object.keys(SPECIES_COLOR)) assert(SPECIES[sp], sp + ": SPECIES にない");
    for (const sp of ["MnO4-", "Mn^2+", "Cr2O7^2-", "Cr^3+", "Fe^2+", "Fe^3+"]) {
      assert(SPECIES_COLOR[sp], sp + ": 色定義がない");
    }
  });

  t("combineHalves: e⁻ が打ち消され、イオン反応式がつり合う", () => {
    for (const st of REDOX_STAGES) {
      const c = combineHalves(st, st.answer[0], st.answer[1]);
      assert(![...c.left, ...c.right].some((t) => t.sp === "e-"), st.id + ": e⁻ が残った");
      assert(compareSides(c.left, c.right).balanced, st.id + ": つり合わない");
    }
    const c2 = combineHalves(REDOX_STAGES[1], 1, 2);
    assert(c2.left.some((t) => t.sp === "Ag+" && t.n === 2), "r2: 2Ag⁺ にならない");
  });

  t("compareSides: 電荷の不一致を検出する", () => {
    const cmp = compareSides([{ sp: "H+", n: 1 }], [{ sp: "H+", n: 1 }, { sp: "H+", n: 1 }]);
    assert(!cmp.balanced);
    const ionEq = compareSides(
      [{ sp: "H+", n: 1 }, { sp: "OH-", n: 1 }],
      [{ sp: "H2O", n: 1 }]
    );
    assert(ionEq.balanced, "イオン反応式 H+ + OH- → H2O がつり合い判定されない");
  });

  return results;
}

/* ---- UI テスト（iframe 内の実アプリを駆動） ---- */

async function runUITests(iframe) {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const ups = () => $$("#equation .stepper button").filter((b) => b.textContent === "＋");
  const stageBtn = (i) => $$("#stageNav button")[i];
  const addBtn = (i) => $$("#toolbar .add")[i];
  const reactBtn = () => doc.querySelector("#toolbar .react");
  const recombineBtn = () => doc.getElementById("recombineBtn");
  const adv = (ms) => win.IonEq.advance(ms);
  const state = () => win.IonEq.state();

  await t("UI: 投入→電離→中和→傍観イオンと H₂O が残る", async () => {
    stageBtn(0).click();
    addBtn(0).click(); addBtn(1).click();
    adv(3000);
    let s = state();
    assert(s.counts["H+"] === 1 && s.counts["OH-"] === 1 && s.counts["Na+"] === 1 && s.counts["Cl-"] === 1,
      "電離していない: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(8000);
    s = state();
    assert(!s.counts["H+"] && !s.counts["OH-"] && s.counts["H2O"] === 1, "中和していない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了フラグが立たない");
  });

  await t("UI: 正しい係数でクリアになる", async () => {
    ups().forEach((b) => b.click()); // ステージ1は全部1が正解
    const s = state();
    assert(s.coeffOk, "coeffOk にならない");
    assert(s.cleared, "cleared にならない");
    assert(!doc.getElementById("clearBanner").hidden, "クリアバナーが出ない");
  });

  await t("UI: ドラッグで H⁺ を OH⁻ に重ねると1組だけ中和する", async () => {
    stageBtn(0).click();
    addBtn(0).click(); addBtn(0).click(); addBtn(1).click(); // HCl×2, NaOH×1 → H⁺×2, OH⁻×1
    adv(3000);
    let s = state();
    assert(s.counts["H+"] === 2 && s.counts["OH-"] === 1, "初期電離が想定外: " + JSON.stringify(s.counts));
    const r = win.IonEq.dragReact("H+", "OH-");
    assert(r.launched, "ドラッグ反応が起きない: " + JSON.stringify(r));
    adv(8000);
    s = state();
    assert(s.counts["H2O"] === 1, "H₂O が1個できない: " + JSON.stringify(s.counts));
    assert(s.counts["H+"] === 1 && !s.counts["OH-"], "1組だけ反応し H⁺ が1個残るはず: " + JSON.stringify(s.counts));
  });

  await t("UI: ドラッグ - 相手にならないイオンには反応しない", async () => {
    stageBtn(0).click();
    addBtn(0).click(); // HCl → H⁺, Cl⁻
    adv(3000);
    const r = win.IonEq.dragReact("H+", "Cl-"); // Cl⁻ は傍観イオン
    assert(!r.launched, "傍観イオン Cl⁻ と反応してしまった: " + JSON.stringify(r));
  });

  await t("UI: ドラッグ - 気体発生でも H⁺ を CO₃²⁻ に重ねれば H⁺2個で1組反応する", async () => {
    stageBtn(5).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // Na₂CO₃×1, HCl×2 → CO₃²⁻×1, H⁺×2
    adv(3000);
    let s = state();
    assert(s.counts["H+"] === 2 && s.counts["CO3^2-"] === 1, "初期電離が想定外: " + JSON.stringify(s.counts));
    const r = win.IonEq.dragReact("H+", "CO3^2-");
    assert(r.launched, "多重集合ルールのドラッグ反応が起きない: " + JSON.stringify(r));
    adv(15000);
    s = state();
    assert(s.counts["H2O"] === 1 && s.escaped["CO2"] === 1, "H₂O と CO₂ ができない: " + JSON.stringify({ c: s.counts, e: s.escaped }));
    assert(!s.counts["H+"] && !s.counts["CO3^2-"], "H⁺2個と CO₃²⁻ が使われるはず: " + JSON.stringify(s.counts));
  });

  await t("UI: 投入数がビーカー上に反応式の形で表示され、ちょうど反応で matched になる", async () => {
    stageBtn(0).click();
    const el = doc.getElementById("addedFormula");
    assert(el.querySelector(".n").textContent === "0", "初期は0のはず: " + el.textContent);
    addBtn(0).click(); addBtn(1).click(); // 1 HCl, 1 NaOH
    const ns = [...el.querySelectorAll(".n")].map((e) => e.textContent);
    const fs = [...el.querySelectorAll(".f")].map((e) => e.textContent);
    assert(ns[0] === "1" && ns[1] === "1", "投入数が反映されない: " + JSON.stringify(ns));
    assert(fs[0] === "HCl" && fs[1] === "NaOH", "反応物の表示が違う: " + JSON.stringify(fs));
    assert(!el.classList.contains("matched"), "まだ反応前なのに matched");
    adv(3000); reactBtn().click(); adv(8000);
    assert(state().reactionDone, "反応完了しない");
    assert(el.classList.contains("matched"), "ちょうど反応で matched にならない");
  });

  await t("UI: 数合わせ - 左辺のみで試すと「できた数」を教える", async () => {
    stageBtn(1).click(); // ステージ2にリセット
    ups()[0].click(); ups()[1].click(); ups()[1].click(); // 左辺 1,2
    recombineBtn().click();
    adv(10000);
    const r = state().recombine;
    assert(r && r.unclaimed && !r.mismatch && r.leftovers.length === 0, JSON.stringify(r));
    assert(r.formed["H2O"] === 2 && r.formed["Na2SO4"] === 1, "できた数が違う: " + JSON.stringify(r.formed));
    assert(doc.getElementById("recombineMsg").textContent.includes("右辺の係数に入れよう"), "誘導メッセージがない");
  });

  await t("UI: 数合わせ - 左辺が不つり合いだとイオンが余る", async () => {
    stageBtn(1).click();
    ups()[0].click(); ups()[1].click(); // 左辺 1,1
    recombineBtn().click();
    adv(10000);
    const r = state().recombine;
    assert(r && r.leftovers.includes("H+"), "H+ が余らない: " + JSON.stringify(r));
    assert(doc.querySelectorAll("#recombine .rpart.leftover").length >= 1, "赤リングが出ない");
  });

  await t("UI: 数合わせ - 右辺の係数ができた数と違うと指摘される", async () => {
    stageBtn(1).click();
    ups()[0].click(); ups()[1].click(); ups()[1].click(); // 左辺 1,2
    ups()[2].click(); ups()[3].click();                   // 右辺 1,1（H₂O は2が正しい）
    recombineBtn().click();
    adv(10000);
    const r = state().recombine;
    assert(r && r.mismatch, "mismatch にならない: " + JSON.stringify(r));
    assert(doc.getElementById("recombineMsg").textContent.includes("2 個できた"), "個数指摘メッセージがない");
  });

  await t("UI: ビーカーと数合わせの両方がそろうとステージ2もクリア", async () => {
    stageBtn(1).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // H₂SO₄×1, NaOH×2
    adv(3000);
    reactBtn().click();
    adv(10000);
    assert(state().reactionDone, "完全中和にならない");
    ups()[0].click(); ups()[1].click(); ups()[1].click();
    ups()[2].click(); ups()[3].click(); ups()[3].click(); // 1,2,1,2
    const s = state();
    assert(s.coeffOk && s.cleared, "クリアにならない: coeffOk=" + s.coeffOk + " cleared=" + s.cleared);
  });

  await t("UI: 多原子イオンと分子が原子の房で描かれる", async () => {
    stageBtn(1).click(); // ステージ2
    addBtn(0).click();   // H₂SO₄
    adv(3000);
    const groups = [...doc.querySelectorAll("#beaker .particle")];
    const so4 = groups.find((gr) => [...gr.querySelectorAll("text")].some((t) => t.textContent === "S"));
    assert(so4, "S 原子を含む房（SO₄²⁻）が見つからない");
    assert(so4.querySelectorAll("circle").length >= 6,
      "SO₄²⁻ の房の要素数が少ない（包み+原子5+バッジ）: " + so4.querySelectorAll("circle").length);
    const hplus = groups.find((gr) => [...gr.querySelectorAll("text")].some((t) => t.textContent === "H⁺"));
    assert(hplus, "単原子イオン H⁺ が従来表示で見つからない");
  });

  await t("UI: ステージ4で AgCl が沈殿し、傍観イオンが残る", async () => {
    stageBtn(3).click();
    addBtn(0).click(); addBtn(1).click(); // AgNO₃×1, NaCl×1
    adv(3000);
    reactBtn().click();
    adv(10000);
    const s = state();
    assert(s.counts["AgCl"] === 1, "AgCl ができない: " + JSON.stringify(s.counts));
    assert(s.counts["Na+"] === 1 && s.counts["NO3-"] === 1, "傍観イオンが残らない: " + JSON.stringify(s.counts));
    assert(s.settled === 1, "沈殿が底に積もらない: settled=" + s.settled);
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 浮遊イオンと沈殿が重ならずに配置される", async () => {
    stageBtn(3).click(); // ステージ4（沈殿）
    addBtn(0).click(); addBtn(0).click(); addBtn(1).click(); addBtn(1).click();
    adv(4000);
    reactBtn().click();
    adv(12000);
    const ps = win.IonEq.particles().filter((p) => ["float", "pop", "settled"].includes(p.mode));
    assert(ps.some((p) => p.mode === "settled"), "沈殿がない");
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
        assert(d >= ps[i].r + ps[j].r - 3,
          `重なり: ${ps[i].sp}(${ps[i].mode}) と ${ps[j].sp}(${ps[j].mode}) d=${d.toFixed(1)} < ${(ps[i].r + ps[j].r).toFixed(1)}`);
      }
    }
  });

  await t("UI: ステージ5の数合わせ - BaCl₂ 1 : Na₂SO₄ 1 で BaSO₄×1 と NaCl×2 ができる", async () => {
    stageBtn(4).click();
    ups()[0].click(); ups()[1].click(); // 左辺 1,1
    recombineBtn().click();
    adv(10000);
    const r = state().recombine;
    assert(r && r.leftovers.length === 0, "余りが出た: " + JSON.stringify(r));
    assert(r.formed["BaSO4"] === 1 && r.formed["NaCl"] === 2, "できた数が違う: " + JSON.stringify(r.formed));
  });

  await t("UI: ステージ6で H₂CO₃ を経て CO₂ の泡が逃げ、H₂O が残る", async () => {
    stageBtn(5).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // Na₂CO₃×1, HCl×2
    adv(3000);
    reactBtn().click();
    adv(15000);
    const s = state();
    assert(s.counts["H2O"] === 1, "H2O ができない: " + JSON.stringify(s.counts));
    assert(!s.counts["CO2"] && s.escaped["CO2"] === 1, "CO2 が泡として逃げない: " + JSON.stringify({ counts: s.counts, escaped: s.escaped }));
    assert(s.counts["Na+"] === 2 && s.counts["Cl-"] === 2, "傍観イオンが残らない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 全ステージに目標バナーが出る（沈殿・気体・中和・酸性塩で文言が変わる）", async () => {
    const goalOf = (i) => { stageBtn(i).click(); return doc.querySelector("#stageTitle .goal").textContent; };
    for (let i = 0; i < STAGES.length; i++) {
      const g = goalOf(i);
      assert(g && g.includes("目標"), STAGES[i].id + ": 目標バナーが無い: " + g);
    }
    assert(goalOf(0).includes("中和") && goalOf(0).includes("NaCl"), "s1 は中和して NaCl のはず: " + goalOf(0));
    assert(goalOf(3).includes("沈殿") && goalOf(3).includes("AgCl"), "s4 は沈殿 AgCl のはず: " + goalOf(3));
    assert(goalOf(5).includes("気体") && goalOf(5).includes("CO₂"), "s6 は気体 CO₂ のはず: " + goalOf(5));
    const s11 = STAGES.findIndex((st) => st.id === "s11");
    assert(goalOf(s11).includes("酸性塩") && goalOf(s11).includes("NaHSO₄"), "s11 は酸性塩 NaHSO₄ のはず: " + goalOf(s11));
    assert(doc.querySelector("#stageTitle .goal.acid"), "酸性塩ステージの目標が acid スタイルでない");
  });

  await t("UI: 全ステージ総なめ - 模範比で投入→反応→係数→数合わせ→クリア", async () => {
    for (let i = 0; i < STAGES.length; i++) {
      const st = STAGES[i];
      const nL = st.reactants.length;
      stageBtn(i).click();
      for (let j = 0; j < nL; j++) {
        for (let k = 0; k < st.answer[j]; k++) addBtn(j).click();
      }
      adv(5000);
      reactBtn().click();
      adv(20000);
      assert(state().reactionDone, st.id + ": 反応が完了しない");
      st.answer.forEach((n, idx) => { for (let k = 0; k < n; k++) ups()[idx].click(); });
      const s = state();
      assert(s.coeffOk, st.id + ": 模範係数が正解にならない");
      assert(s.cleared, st.id + ": クリアにならない");
      recombineBtn().click();
      adv(15000);
      const r = state().recombine;
      assert(r && r.fit, st.id + ": 数合わせが fit しない: " + JSON.stringify(r));
    }
  });

  await t("UI: 酸性塩ステージ - 1:1 で NaHSO₄ ができてクリア、1:2 だと正塩で不成立", async () => {
    const s11 = STAGES.findIndex((st) => st.id === "s11");
    assert(s11 >= 0, "s11 が無い");
    // まず 1:2（過剰な塩基）＝完全中和して正塩 → 目標未達
    stageBtn(s11).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // H₂SO₄×1, NaOH×2
    adv(3000); reactBtn().click(); adv(8000);
    let s = state();
    assert(!s.reactionDone, "1:2 で完全中和したのにクリア扱いになった: " + JSON.stringify(s.counts));
    assert(doc.getElementById("msg").textContent.includes("正塩"), "正塩になった旨の指摘がない: " + doc.getElementById("msg").textContent);
    // 次に 1:1 ＝ 酸性塩 NaHSO₄ ができる
    stageBtn(s11).click();
    addBtn(0).click(); addBtn(1).click(); // H₂SO₄×1, NaOH×1
    adv(3000); reactBtn().click(); adv(8000);
    s = state();
    assert(s.reactionDone, "1:1 で酸性塩ができない: " + JSON.stringify(s.counts));
    assert(s.counts["H+"] === 1 && s.counts["SO4^2-"] === 1 && s.counts["Na+"] === 1,
      "残ったイオンが NaHSO₄ の組（H⁺・SO₄²⁻・Na⁺）でない: " + JSON.stringify(s.counts));
    assert(s.counts["H2O"] === 1, "H₂O が1個できていない: " + JSON.stringify(s.counts));
    assert(doc.getElementById("msg").textContent.includes("NaHSO"), "NaHSO₄ 生成メッセージがない");
  });

  await t("UI: 酸性塩ステージ - 係数もそろうとクリアになる", async () => {
    const s11 = STAGES.findIndex((st) => st.id === "s11");
    ups().forEach((b, i) => { for (let k = 0; k < STAGES[s11].answer[i]; k++) b.click(); }); // 1,1,1,1
    const s = state();
    assert(s.coeffOk, "係数が正解にならない");
    assert(s.cleared, "クリアにならない: reactionDone=" + s.reactionDone + " coeffOk=" + s.coeffOk);
  });

  await t("UI: 酸性塩ステージ NaHCO₃ - 1:1 で HCO₃⁻ ができ NaHCO₃＋NaCl でクリア", async () => {
    const s12 = STAGES.findIndex((st) => st.id === "s12");
    assert(s12 >= 0, "s12 が無い");
    stageBtn(s12).click();
    addBtn(0).click(); addBtn(1).click(); // Na₂CO₃×1, HCl×1
    adv(3000); reactBtn().click(); adv(9000);
    let s = state();
    assert(s.reactionDone, "1:1 で NaHCO₃ ができない: " + JSON.stringify(s.counts));
    assert(s.counts["HCO3-"] === 1, "HCO₃⁻ が1個できていない（部分プロトン化）: " + JSON.stringify(s.counts));
    assert(s.counts["Na+"] === 2 && s.counts["Cl-"] === 1, "残イオンが NaHCO₃＋NaCl の組でない: " + JSON.stringify(s.counts));
    assert(!s.counts["CO3^2-"] && !s.counts["H+"], "CO₃²⁻ や H⁺ が残っている（泡まで行きすぎ）: " + JSON.stringify(s.counts));
    // 係数もそろえるとクリア
    ups().forEach((b, i) => { for (let k = 0; k < STAGES[s12].answer[i]; k++) b.click(); });
    s = state();
    assert(s.coeffOk && s.cleared, "係数クリアにならない: coeffOk=" + s.coeffOk + " cleared=" + s.cleared);
  });

  await t("UI: 酸性塩ステージ NaHCO₃ - 酸を入れすぎると目標未達（H⁺ が余る）", async () => {
    const s12 = STAGES.findIndex((st) => st.id === "s12");
    stageBtn(s12).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // Na₂CO₃×1, HCl×2
    adv(3000); reactBtn().click(); adv(9000);
    const s = state();
    assert(!s.reactionDone, "酸過剰なのにクリアになった: " + JSON.stringify(s.counts));
    assert(doc.getElementById("msg").textContent.includes("余っている"), "余り指摘メッセージがない: " + doc.getElementById("msg").textContent);
  });

  await t("UI: ステージ6の数合わせ - H₂O と CO₂ は H₂CO₃ 経由で同数できる", async () => {
    stageBtn(5).click();
    ups()[0].click(); ups()[1].click(); ups()[1].click(); // 左辺 1,2
    recombineBtn().click();
    adv(10000);
    const r = state().recombine;
    assert(r && r.leftovers.length === 0, "余りが出た: " + JSON.stringify(r));
    assert(r.formed["NaCl"] === 2 && r.formed["H2O"] === 1 && r.formed["CO2"] === 1, "できた数が違う: " + JSON.stringify(r.formed));
  });

  return results;
}

/* ---- 酸化還元モードの UI テスト（redox.html を iframe で駆動） ---- */

async function runRedoxUITests(iframe) {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const stageBtn = (i) => $$("#stageNav button")[i];
  const playBtn = () => doc.getElementById("playBtn");
  const upBtns = () => $$(".halfRow .stepper button").filter((b) => b.textContent === "＋");
  const adv = (ms) => win.RedoxEq.advance(ms);
  const state = () => win.RedoxEq.state();

  await t("REDOX: r2 で倍率1:1のままだと e⁻ が1個余る", async () => {
    stageBtn(1).click();
    playBtn().click();
    adv(20000);
    const s = state();
    assert(s.phase === "done", "アニメが終わらない: " + s.phase);
    assert(s.poolE === 1, "e⁻ の余りが1でない: " + JSON.stringify(s));
    assert(s.deposited === 1 && !s.cleared, "析出/クリア状態が想定外: " + JSON.stringify(s));
  });

  await t("REDOX: r2 で 1:2 にすると銀が2個析出してクリア", async () => {
    upBtns()[1].click(); // 還元側 ×2（レイアウトもリセットされる）
    playBtn().click();
    adv(25000);
    const s = state();
    assert(s.poolE === 0 && s.waiting === 0, "e⁻ が過不足: " + JSON.stringify(s));
    assert(s.deposited === 2, "銀樹が2個でない: " + s.deposited);
    assert(s.cleared, "クリアにならない");
    assert(doc.getElementById("sumView").textContent.includes("2 Ag"), "足し合わせ表示に 2Ag が出ない");
  });

  await t("REDOX: r3 で H₂ の泡が逃げてクリア", async () => {
    stageBtn(2).click();
    playBtn().click();
    adv(25000);
    const s = state();
    assert(s.escaped["H2"] === 1, "H2 が逃げない: " + JSON.stringify(s));
    assert(s.cleared, "クリアにならない");
  });

  await t("REDOX: 酸化数が円内と式の直下に表示される（変化する原子のみ）", async () => {
    stageBtn(0).click(); // r1: Zn(0)・Cu²⁺(+2) が初期配置
    const beakerTexts = [...doc.querySelectorAll("#beaker .particle text")].map((t) => t.textContent);
    assert(beakerTexts.includes("0"), "Zn の円内に 0 がない: " + beakerTexts.join(","));
    assert(beakerTexts.includes("+2"), "Cu²⁺ の円内に +2 がない");
    const oxRow = doc.getElementById("halfOx").textContent;
    assert(oxRow.includes("0") && oxRow.includes("+2"), "半反応式の直下に酸化数がない: " + oxRow);
    assert(doc.querySelectorAll("#halfOx .oxtag").length === 2, "酸化行のタグが2個でない");
  });

  await t("REDOX: 酸化の半反応を単体再生できる（e⁻ が板にたまる）", async () => {
    doc.querySelectorAll(".halfRow .solo")[0].click();
    adv(10000);
    const s = state();
    assert(s.soloMode === "ox" && s.phase === "done", "単体再生が終わらない: " + JSON.stringify(s));
    assert(s.poolE === 2, "e⁻ が2個たまらない: " + s.poolE);
    assert(s.counts["Zn^2+"] === 1, "Zn²⁺ にならない: " + JSON.stringify(s.counts));
    assert(s.deposited === 0 && !s.cleared, "還元まで起きてしまった");
  });

  await t("REDOX: 全ステージ総なめ - 模範倍率で再生するとクリアできる", async () => {
    for (let i = 0; i < REDOX_STAGES.length; i++) {
      const st = REDOX_STAGES[i];
      stageBtn(i).click();
      for (let k = 1; k < st.answer[0]; k++) upBtns()[0].click();
      for (let k = 1; k < st.answer[1]; k++) upBtns()[1].click();
      playBtn().click();
      adv(45000);
      const s = state();
      assert(s.cleared, st.id + ": クリアにならない: " + JSON.stringify(s));
    }
  });

  await t("REDOX: 還元の半反応を単体再生できる（e⁻ ストックから受け取る）", async () => {
    stageBtn(0).click(); // r1（還元側が析出する Cu_red）を明示
    doc.querySelectorAll(".halfRow .solo")[1].click();
    adv(12000);
    const s = state();
    assert(s.soloMode === "red" && s.phase === "done", "単体再生が終わらない: " + JSON.stringify(s));
    assert(s.deposited === 1, "析出しない: " + s.deposited);
    assert(s.poolE === 0, "ストックの e⁻ が残った: " + s.poolE);
    assert(!s.counts["Zn"] && !s.counts["Zn^2+"], "酸化側が混ざっている: " + JSON.stringify(s.counts));
  });

  await t("REDOX: 溶液中(rs1) 5:1 で MnO₄⁻×Fe²⁺ が反応し、紫が消えて Mn²⁺+Fe³⁺+H₂O になる", async () => {
    const rs1 = REDOX_STAGES.findIndex((s) => s.id === "rs1");
    assert(rs1 >= 0, "rs1 が無い");
    stageBtn(rs1).click();
    for (let k = 1; k < 5; k++) upBtns()[0].click(); // 酸化側 ×5
    const beakerRect = () => doc.querySelector("#beaker rect");
    const colorBefore = beakerRect().getAttribute("fill");
    playBtn().click();
    adv(30000);
    const s = state();
    assert(s.cleared, "5:1 でクリアにならない: " + JSON.stringify(s));
    assert(s.counts["Mn^2+"] === 1 && s.counts["Fe^3+"] === 5 && s.counts["H2O"] === 4,
      "生成物が MnO₄⁻+5Fe²⁺+8H⁺→Mn²⁺+5Fe³⁺+4H₂O と合わない: " + JSON.stringify(s.counts));
    assert(!s.counts["MnO4-"] && !s.counts["H+"], "MnO₄⁻/H⁺ が残っている: " + JSON.stringify(s.counts));
    const colorAfter = beakerRect().getAttribute("fill");
    assert(colorBefore !== colorAfter && colorAfter === "#eaf5fc", "溶液の色が紫→無色に戻らない: " + colorBefore + "→" + colorAfter);
  });

  await t("REDOX: 溶液中(rs1) 1:1 では e⁻ 不足でクリアせず紫が残る", async () => {
    const rs1 = REDOX_STAGES.findIndex((s) => s.id === "rs1");
    stageBtn(rs1).click(); // 倍率 [1,1] のまま（e⁻ 1個 vs 5個必要）
    playBtn().click();
    adv(30000);
    const s = state();
    assert(!s.cleared, "1:1 でクリアしてしまった: " + JSON.stringify(s));
    assert(s.counts["MnO4-"] === 1, "MnO₄⁻ が残っていない（紫が残るはず）: " + JSON.stringify(s.counts));
  });

  return results;
}

/* ---- 反応ライブラリ（reactions.json）の検証（fetch・ブラウザのみ） ----
   両立期間の担保として、reactions.json のスキーマ不変条件と、既存 STAGES との一致を検査する。
   反応を足すほど自動で網羅が広がるデータ駆動テスト（DESIGN_reaction_library.md の品質保証）。 */

async function runReactionLibraryTests() {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };

  const TYPE_ENUM = ["中和", "沈殿", "気体発生", "弱酸弱塩基の遊離", "酸化還元", "錯イオン生成", "加水分解", "分子反応", "その他"];
  const SALT_ENUM = ["正塩", "酸性塩", "塩基性塩"];
  const REDOX_ENUM = ["金属の析出", "金属と酸", "溶液中の酸化剤還元剤", "ハロゲンの酸化力", "電池", "電気分解"];
  const ANIM_ENUM = ["aqueous", "redox-metal", "redox-solution", "complex-ion", "weak-partial", "molecular"];

  const deriveSpecies = (rx) => {
    const s = new Set();
    [...rx.reactants, ...rx.products].forEach((x) => s.add(x));
    rx.reactants.forEach((r) => (DISSOCIATION[r] || []).forEach((i) => s.add(i)));
    rx.products.forEach((p) => (PARTS[p] || [p]).forEach((i) => s.add(i)));
    (rx.rules || []).forEach((r) => {
      (r.find || []).forEach((i) => s.add(i));
      (Array.isArray(r.make) ? r.make : [r.make]).forEach((i) => s.add(i));
      if (r.via) s.add(r.via);
    });
    if (rx.saltGoal && rx.saltGoal.ions) Object.keys(rx.saltGoal.ions).forEach((i) => s.add(i));
    return s;
  };

  let data = null;
  await t("reactions.json が読み込めて reactions 配列を持つ", async () => {
    const res = await fetch("reactions.json", { cache: "no-store" });
    assert(res.ok, "fetch 失敗: " + res.status);
    data = await res.json();
    assert(Array.isArray(data.reactions) && data.reactions.length > 0, "reactions が空");
  });
  if (!data) return results;

  await t("id が一意", () => {
    const ids = data.reactions.map((r) => r.id);
    assert(new Set(ids).size === ids.length, "id が重複: " + ids.join(","));
  });

  await t("全反応: coeffs で原子・電荷が保存し、最簡整数比になっている", () => {
    for (const rx of data.reactions) {
      const nL = rx.reactants.length;
      const left = rx.reactants.map((sp, i) => ({ sp, n: rx.coeffs[i] }));
      const right = rx.products.map((sp, i) => ({ sp, n: rx.coeffs[nL + i] }));
      assert(rx.coeffs.length === rx.reactants.length + rx.products.length, rx.id + ": coeffs の長さ不一致");
      assert(compareSides(left, right).balanced, rx.id + ": 原子/電荷が保存しない");
      assert(gcdAll(rx.coeffs) === 1, rx.id + ": 最簡整数比でない");
    }
  });

  await t("全反応: species が全登場種を過不足なく含み、SPECIES に定義済み", () => {
    for (const rx of data.reactions) {
      const derived = deriveSpecies(rx);
      const listed = new Set(rx.species);
      for (const s of derived) assert(listed.has(s), rx.id + ": species に " + s + " が欠落（検索逆引きの穴）");
      for (const s of listed) assert(derived.has(s), rx.id + ": species に余分な " + s);
      for (const s of listed) assert(SPECIES[s], rx.id + ": 未定義種 " + s);
    }
  });

  await t("全反応: 分類・アニメ種別・難易度がタキソノミー内", () => {
    for (const rx of data.reactions) {
      assert(TYPE_ENUM.includes(rx.classes.type), rx.id + ": type 不正 " + rx.classes.type);
      assert(rx.classes.saltType === null || SALT_ENUM.includes(rx.classes.saltType), rx.id + ": saltType 不正");
      assert(rx.classes.redox === null || REDOX_ENUM.includes(rx.classes.redox), rx.id + ": redox 不正");
      assert(ANIM_ENUM.includes(rx.animationType), rx.id + ": animationType 不正 " + rx.animationType);
      assert(Number.isInteger(rx.difficulty) && rx.difficulty >= 1 && rx.difficulty <= 5, rx.id + ": difficulty は1〜5");
      assert(rx.netIonic && rx.note, rx.id + ": 表示文（netIonic/note）欠落");
      // redoxStage を持つなら実在する REDOX_STAGE を指すこと（インデックス→酸化還元モードの連携）
      if (rx.redoxStage) {
        assert(REDOX_STAGES.some((s) => s.id === rx.redoxStage), rx.id + ": redoxStage " + rx.redoxStage + " が REDOX_STAGES に無い");
        assert(rx.playable, rx.id + ": redoxStage があるのに playable でない");
      }
    }
  });

  await t("逆引きインデックス: 物質・分類からの検索が正しい（buildReactionIndex）", () => {
    assert(typeof buildReactionIndex === "function", "library.js（buildReactionIndex）が読み込まれていない");
    const lib = buildReactionIndex(data);
    // byId
    assert(lib.byId["s1"] && lib.byId["s1"].id === "s1", "byId が引けない");
    // 物質逆引き: H+ を含む反応集合が species ベースと一致
    const withHp = data.reactions.filter((r) => r.species.includes("H+")).map((r) => r.id).sort();
    assert(JSON.stringify((lib.bySpecies["H+"] || []).sort()) === JSON.stringify(withHp), "H⁺ の逆引きが不一致");
    // 分類逆引き: 中和・酸性塩
    const neu = data.reactions.filter((r) => r.classes.type === "中和").map((r) => r.id).sort();
    assert(JSON.stringify((lib.byType["中和"] || []).sort()) === JSON.stringify(neu), "byType 中和 が不一致");
    assert(JSON.stringify((lib.bySalt["酸性塩"] || []).sort()) === JSON.stringify(["s11", "s12"]), "bySalt 酸性塩 が不一致");
    // 単元逆引き
    assert((lib.byUnit["沈殿"] || []).length >= 2, "byUnit 沈殿 が少ない");
    // allSpecies が全登場物質を漏れなく含む
    const all = new Set();
    data.reactions.forEach((r) => r.species.forEach((s) => all.add(s)));
    assert(lib.allSpecies.length === all.size, "allSpecies の網羅漏れ: " + lib.allSpecies.length + " != " + all.size);
    // 逆引きは全 species を鍵に持つ
    for (const s of all) assert(lib.bySpecies[s] && lib.bySpecies[s].length > 0, "bySpecies に " + s + " が無い");
  });

  await t("検索・整形: matchesQuery と formatEquation（インデックスUIの純ロジック）", () => {
    assert(typeof matchesQuery === "function" && typeof formatEquation === "function", "library.js の検索関数が無い");
    const byId = {};
    data.reactions.forEach((r) => (byId[r.id] = r));
    // 物質検索: "h2so4" は H₂SO₄ を含む反応にマッチ、Ca(OH)2 のみの s3 にはしない
    assert(matchesQuery(byId["s2"], "h2so4"), "s2 が h2so4 にマッチしない");
    assert(matchesQuery(byId["s2"], "H2SO4"), "大小無視でマッチしない");
    assert(!matchesQuery(byId["s1"], "so4"), "s1（SO4なし）が so4 にマッチしてしまう");
    assert(matchesQuery(byId["s2"], "so4"), "s2 が so4（SO4^2-）にマッチしない");
    // イオンの ^ を無視: "co3" は CO3^2- にマッチ
    assert(matchesQuery(byId["s6"], "co3"), "s6 が co3 にマッチしない");
    // 空クエリは全マッチ
    assert(matchesQuery(byId["s1"], ""), "空クエリで落ちる");
    // 反応式整形（係数1は省略）
    const eq = formatEquation(byId["s2"], (sp) => SPECIES[sp].disp);
    assert(eq === "H₂SO₄ ＋ 2 NaOH → Na₂SO₄ ＋ 2 H₂O", "整形が想定外: " + eq);
  });

  await t("移行の同一性: 既存 STAGES と reactions.json が一致（両立期間の担保）", () => {
    for (const st of STAGES) {
      const rx = data.reactions.find((r) => r.id === st.id);
      assert(rx, "reactions.json に " + st.id + " が無い");
      assert(JSON.stringify(rx.reactants) === JSON.stringify(st.reactants), st.id + ": reactants 不一致");
      assert(JSON.stringify(rx.products) === JSON.stringify(st.products), st.id + ": products 不一致");
      assert(JSON.stringify(rx.coeffs) === JSON.stringify(st.answer), st.id + ": 係数不一致");
    }
  });

  return results;
}

/* ---- ブラウザでの実行と描画 ---- */

if (typeof document !== "undefined" && document.getElementById("results")) {
  const render = (el, results, title) => {
    const okCount = results.filter((r) => r.ok).length;
    const head = document.createElement("h2");
    head.textContent = title + ": " + (okCount === results.length ? "ALL PASS " : "FAIL ") + okCount + "/" + results.length;
    head.className = okCount === results.length ? "pass" : "fail";
    el.appendChild(head);
    for (const r of results) {
      const li = document.createElement("div");
      li.className = "case " + (r.ok ? "pass" : "fail");
      li.textContent = (r.ok ? "〇 " : "× ") + r.name + (r.err ? " — " + r.err : "");
      el.appendChild(li);
    }
    return okCount === results.length;
  };
  const modelOk = render(document.getElementById("results"), runModelTests(), "モデル");
  const iframe = document.getElementById("app");
  const iframeR = document.getElementById("appRedox");
  const startUI = () => {
    const ready = iframe.contentWindow && iframe.contentWindow.IonEq &&
      iframeR.contentWindow && iframeR.contentWindow.RedoxEq;
    if (!ready) { setTimeout(startUI, 100); return; }
    runReactionLibraryTests().then((rlib) =>
      runUITests(iframe).then((rs1) => runRedoxUITests(iframeR).then((rs2) => {
        const libOk = render(document.getElementById("results"), rlib, "反応ライブラリ");
        const uiEl = document.getElementById("uiresults");
        const uiOk = render(uiEl, rs1, "UI(イオン反応)");
        const rOk = render(uiEl, rs2, "UI(酸化還元)");
        const total = document.getElementById("total");
        const allOk = modelOk && libOk && uiOk && rOk;
        total.textContent = allOk ? "TOTAL: ALL PASS" : "TOTAL: FAIL";
        total.className = allOk ? "pass" : "fail";
      })));
  };
  startUI();
}
