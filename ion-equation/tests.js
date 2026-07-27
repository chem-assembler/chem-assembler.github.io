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
      // 模範係数は「分子反応式の項」に対するもの（溶媒の水が式に入る反応では試薬と項が違う）
      assert(checkStageCoeffs(st, eqOf(st).answer).ok, st.id);
    }
  });

  t("係数に0（未入力）があれば不正解", () => {
    assert(!checkStageCoeffs(STAGES[0], [0, 1, 1, 1]).ok);
  });

  t("つり合っていない係数は不正解", () => {
    assert(!checkStageCoeffs(STAGES[1], [1, 1, 1, 1]).ok, "H2SO4+NaOH を全部1で通してしまう");
  });

  t("イオン反応式（eqOf/checkStageCoeffs の mode）", () => {
    const al1 = STAGES.find((s) => s.id === "amphoteric-al-step1");
    assert(al1.ionic && al1.primary === "ionic", "分割版がイオン反応式を主にしていない");
    // 既定（分子）とイオンで項が入れ替わる
    assert(eqOf(al1).reactants.join() === "AlCl3,NaOH", JSON.stringify(eqOf(al1)));
    assert(eqOf(al1, "ionic").reactants.join() === "Al^3+,OH-", JSON.stringify(eqOf(al1, "ionic")));
    // それぞれの模範係数で正解になる
    assert(checkStageCoeffs(al1, [1, 3, 1, 3]).ok, "分子式の模範が通らない");
    assert(checkStageCoeffs(al1, [1, 3, 1], "ionic").ok, "イオン式の模範が通らない");
    // 取り違えると通らない
    assert(!checkStageCoeffs(al1, [1, 3, 1, 3], "ionic").ok, "イオン式に分子式の係数が通る");
    // ionic を持たないステージは mode を渡しても分子式のまま
    const s1 = STAGES[0];
    assert(!s1.ionic && eqOf(s1, "ionic").reactants.join() === "HCl,NaOH", "ionic 無しで切り替わってしまう");
    // イオン反応式でも原子・電荷が保存し、最簡整数比になっている
    for (const st of STAGES) {
      if (!st.ionic) continue;
      const eq = st.ionic;
      assert(eq.answer.length === eq.reactants.length + eq.products.length, st.id + ": ionic.answer の長さ");
      assert(checkStageCoeffs(st, eq.answer, "ionic").ok, st.id + ": ionic の模範が正解にならない");
      // 分子式の模範と「本質のイオン」の個数が矛盾しないこと（両方が同じ反応を指す）
      assert(gcdAll(eq.answer) === 1, st.id + ": ionic が最簡整数比でない");
    }
  });

  t("最簡整数比でない係数は不正解。何で割ればよいかまで助言する", () => {
    const res = checkStageCoeffs(STAGES[0], [2, 2, 2, 2]);
    assert(!res.ok, "2,2,2,2 を通してしまう");
    assert(res.gcd === 2, "割る数を返さない: " + JSON.stringify(res.gcd));
    assert(res.reason.includes("2 で割り切れる"), "何で割るか言っていない: " + res.reason);
    assert(res.reason.includes("1 : 1 : 1 : 1"), "割った先を示していない: " + res.reason);
    // 3倍でも同じように具体的に言えること
    const r3 = checkStageCoeffs(STAGES[1], [3, 6, 3, 6]);
    assert(!r3.ok && r3.gcd === 3 && r3.reason.includes("1 : 2 : 1 : 2"), "3倍のとき: " + r3.reason);
  });

  t("simplestRatioAdvice: 割り切れるときだけ助言を返す", () => {
    assert(simplestRatioAdvice([1, 2]) === null, "最簡なのに助言が出る");
    assert(simplestRatioAdvice([1, 1]) === null, "1:1 に助言が出る");
    const a = simplestRatioAdvice([4, 6]);
    assert(a && a.gcd === 2 && a.to.join() === "2,3", JSON.stringify(a));
    assert(a.text.includes("4 : 6 → 2 : 3"), "割った先を文に含まない: " + a.text);
    const named = simplestRatioAdvice([2, 4], ["H₂SO₄", "NaOH"]);
    assert(named.text.includes("1H₂SO₄"), "物質名つきの答えがない: " + named.text);
    const b = simplestRatioAdvice([6, 9]);
    assert(b.gcd === 3 && b.to.join() === "2,3", JSON.stringify(b));
  });

  t("checkRedoxMultipliers: 倍率が最簡でないときも割り方まで助言する", () => {
    const st = REDOX_STAGES[3];   // Al × Cu²⁺（正解は 2:3）
    const ok = checkRedoxMultipliers(st, 2, 3);
    assert(ok.ok, "正解の 2:3 が通らない: " + ok.reason);
    const ng = checkRedoxMultipliers(st, 4, 6);
    assert(!ng.ok && ng.gcd === 2, "4:6 を通してしまう: " + JSON.stringify(ng));
    assert(ng.reason.includes("×2・×3"), "割った先を示していない: " + ng.reason);
    // e⁻ が合っていないときは最簡比の話をしない（先に数をそろえるのが先）
    const few = checkRedoxMultipliers(st, 1, 1);
    assert(!few.ok && few.gcd === undefined && few.reason.includes("合っていない"), few.reason);
  });

  t("ステージ参照種がすべて定義済み・反応物は電離表にある", () => {
    for (const st of STAGES) {
      for (const sp of [...st.reactants, ...st.products]) assert(SPECIES[sp], st.id + ": " + sp);
      // 反応物は電離表・原子化表・分子のまま、のいずれかで分解表を持つこと
      for (const sp of st.reactants) assert(partsOf(st, sp), st.id + " 分解表（電離表/原子化/PARTS）なし: " + sp);
      assert(st.answer.length === st.reactants.length + st.products.length, st.id + ": answer の長さ");
      assert(st.netIon && st.intro && st.title, st.id + ": 表示文の欠落");
      // 番号は並び順から作る（データに書くと途中に足すたび手で振り直すことになる）
      assert(!/^ステージ\d/.test(st.title), st.id + ": タイトルに番号が直書きされている");
    }
  });

  t("弱電解質: 部分電離の前後で原子と電荷が保存される", () => {
    for (const [mol, ions] of Object.entries(WEAK_ELECTROLYTES)) {
      assert(SPECIES[mol], mol + ": SPECIES にない");
      const L = tallyTerms([{ sp: mol, n: 1 }]);
      const R = tallyTerms(ions.map((i) => ({ sp: i, n: 1 })));
      assert(JSON.stringify(sortObjKeys(L.atoms)) === JSON.stringify(sortObjKeys(R.atoms)), mol + ": 原子が保存されない");
      assert(L.charge === R.charge, mol + ": 電荷が保存されない");
      // 弱電解質は完全電離しないので、強電解質の電離表には入れない
      assert(!DISSOCIATION[mol], mol + ": 電離表にも入っている（強電解質と二重定義）");
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

  t("protonSchema: 中和ステージは［本体イオン＋価数ぶんの粒］に分解できる", () => {
    const s2 = protonSchema(STAGES[1]);   // H₂SO₄ × NaOH
    assert(s2 && s2.accSp === "OH-" && s2.hNeed === 1 && s2.accNeed === 1, JSON.stringify(s2));
    assert(s2.product.join() === "H2O", "生成物が H₂O でない: " + s2.product);
    assert(s2.donors.length === 1 && s2.donors[0].per === 2, "H₂SO₄ が2価にならない");
    assert(s2.donors[0].core.join() === "SO4^2-", "本体イオンが SO₄²⁻ でない: " + s2.donors[0].core);
    assert(s2.acceptors.length === 1 && s2.acceptors[0].per === 1, "NaOH が1価にならない");
    // 2H⁺＋CO₃²⁻ のように1組に2個要るルールも扱える
    const s6 = protonSchema(STAGES[5]);   // Na₂CO₃ × HCl（気体発生）
    assert(s6.hNeed === 2 && s6.accSp === "CO3^2-" && s6.accNeed === 1, JSON.stringify(s6));
    assert(s6.acceptors[0].core.join() === "Na+,Na+", "傍観 Na⁺ が本体に入らない");
    // 弱塩基は OH⁻ を出さず NH₃ 自身が受け皿（本体イオン無し）
    const nh3 = protonSchema(STAGES.find((s) => s.id === "weak-base-nh3-hcl"));
    assert(nh3.accSp === "NH3" && nh3.acceptors[0].core.length === 0, JSON.stringify(nh3));
    // 弱酸の遊離は受け皿が OH⁻ ではなく CH₃COO⁻（H⁺ が結びつくと分子に戻る）
    const free = protonSchema(STAGES.find((s) => s.id === "weak-acid-free-ch3coona-hcl"));
    assert(free.accSp === "CH3COO-" && free.product.join() === "CH3COOH", JSON.stringify(free));
    assert(free.acceptors[0].core.join() === "Na+" && free.donors[0].core.join() === "Cl-", JSON.stringify(free));
    // H⁺ が軸でない反応（沈殿・錯イオン・燃焼）では模式図を出さない
    for (const st of STAGES) {
      const hasH = (st.rules || []).some((r) => r.find.includes("H+"));
      assert(!!protonSchema(st) === (hasH && !!st.rules), st.id + ": 模式図の出し分けが不整合");
    }
  });

  t("protonBalance: 係数から組の数とあまりが求まる（酸性塩は H⁺ が残るのが正解）", () => {
    const s2 = protonSchema(STAGES[1]);   // H₂SO₄ + 2NaOH
    assert(JSON.stringify(protonBalance(s2, [1, 2])) === JSON.stringify(
      { hTotal: 2, accTotal: 2, pairs: 2, hLeft: 0, accLeft: 0 }), "ちょうど中和の集計が違う");
    assert(protonBalance(s2, [1, 1]).hLeft === 1, "H⁺ の余りが出ない");
    assert(protonBalance(s2, [1, 3]).accLeft === 1, "OH⁻ の余りが出ない");
    assert(protonBalance(s2, [0, 0]).pairs === 0, "未入力で組ができてしまう");
    // 模範解答であまりが出てよいのは酸性塩ステージだけ（H₂SO₄ の H⁺ が1個残って NaHSO₄ になる型）。
    // 同じ酸性塩でも s12 は CO₃²⁻ が H⁺ を1個受け取るだけなのであまりゼロが正しい。
    for (const st of STAGES) {
      const sc = protonSchema(st);
      if (!sc) continue;
      const b = protonBalance(sc, st.answer.slice(0, st.reactants.length));
      if (!st.saltGoal) assert(b.hLeft === 0 && b.accLeft === 0, st.id + ": 模範解答なのに余る " + JSON.stringify(b));
      assert(b.accLeft === 0, st.id + ": 受け皿が余る模範解答はない " + JSON.stringify(b));
    }
    assert(protonBalance(protonSchema(STAGES[10]), [1, 1]).hLeft === 1, "s11: 残る H⁺ が NaHSO₄ の H にならない");
    assert(protonBalance(protonSchema(STAGES[11]), [1, 1]).hLeft === 0, "s12: 部分プロトン化なのに H⁺ が余る");
  });

  t("PARTS: 全ステージの全項が粒に分解でき、原子と電荷が保存される", () => {
    for (const st of STAGES) {
      for (const sp of [...st.reactants, ...st.products]) {
        // ステージごとの上書き（C群は原子に分解）も考慮する
        const parts = partsOf(st, sp);
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
      // 数合わせビューが扱うのは分子反応式の項（溶媒の水を含む）
      const eq = eqOf(st);
      const nL = eq.reactants.length;
      const sim = simulateFormation(st, eq.answer.slice(0, nL));
      assert(Object.keys(sim.leftovers).length === 0, st.id + ": 余り " + JSON.stringify(sim.leftovers));
      eq.products.forEach((sp, j) => {
        assert(sim.formed[sp] === eq.answer[nL + j], st.id + ": " + sp + " が " + sim.formed[sp] + " 個");
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
        assert(["combine", "precipitate", "gas", "complex"].includes(rule.kind), st.id + ": kind 不正 " + rule.kind);
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
          // 房（分子・多原子イオンの内訳）／電離表／構成イオン（沈殿・錯イオンの枠）
          // のいずれかで内訳を見せられること
          assert(STRUCTURE[sp] || DISSOCIATION[sp] || COMPOSITION[sp],
            sp + ": 房も電離表も構成イオンもない");
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
  /* i 番目の項の係数を v にそろえる（＋/− を必要な回数だけ押す） */
  const setCoeff = (i, v) => {
    const term = $$("#equation .term")[i];
    const btn = [...term.querySelectorAll("button")];
    const cur = () => (term.querySelector(".coeff").textContent === "？" ? 0 : +term.querySelector(".coeff").textContent);
    while (cur() > v) btn[0].click();
    while (cur() < v) btn[1].click();
  };

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

  await t("UI: ブロック模式図 - 係数ぶんのブロックと H₂O が並び、余りに印がつく", async () => {
    stageBtn(1).click();   // H₂SO₄ × NaOH（2価の酸 vs 1価の塩基）
    const wrap = doc.getElementById("schematicWrap");
    const msg = () => doc.getElementById("schematicMsg").textContent;
    const blocks = () => [...doc.querySelectorAll("#schematic .schBlock")];
    const red = () => [...doc.querySelectorAll("#schematic .schBlock circle")]
      .filter((c) => c.getAttribute("stroke") === "#c0392b");
    assert(!wrap.hidden, "中和ステージなのに模式図が出ない");
    ups()[0].click();      // H₂SO₄ = 1
    const tags = [...doc.querySelectorAll("#schematic text")].map((e) => e.textContent);
    assert(tags.includes("2価"), "H₂SO₄ を2価のブロックとして示していない: " + tags.join("/"));
    assert(blocks().length === 1, "ブロックが係数ぶん出ない: " + blocks().length);
    assert(red().length === 2, "相手のいない H⁺ 2個に印がつかない: " + red().length);
    assert(msg().includes("H⁺ が 2 個 あまっている"), "酸だけのとき過剰と示さない: " + msg());
    ups()[1].click();      // NaOH = 1
    assert(blocks().length === 2, "塩基のブロックが増えない: " + blocks().length);
    assert(msg().includes("H⁺ が 1 個 あまっている"), "1個ぶん足りないと示さない: " + msg());
    ups()[1].click();      // NaOH = 2 → つり合う
    assert(msg().includes("ぴったり"), "つり合いを示さない: " + msg());
    assert(red().length === 0, "つり合ったのに余りの印が残っている");
    // 中央の生成物（H₂O）が組の数だけ並ぶ（ブロック内の楕円は本体イオンなので除く）
    const prod = [...doc.getElementById("schematic").children].filter((e) => e.tagName === "ellipse");
    assert(prod.length === 2, "H₂O が組の数だけ並ばない: " + prod.length);
    // ブロックをクリックすると1個へる＝模式図の中で係数を操作できる
    blocks()[0].dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    assert(blocks().length === 2 && msg().includes("あまっている"), "ブロッククリックで減らせない: " + msg());
    // ＋ボタンで戻せる
    doc.querySelector("#schematicAdd .schAdd.acc").click();
    assert(msg().includes("ぴったり"), "＋ボタンで足せない: " + msg());
    // H⁺ のやりとりが軸でない反応（沈殿）では出さない
    stageBtn(3).click();
    assert(doc.getElementById("schematicWrap").hidden, "沈殿ステージで模式図が出てしまう");
  });

  await t("UI: ブロック模式図 - ブロックどうしが重ならず枠内に収まる（全ステージ×係数）", async () => {
    const svg = doc.getElementById("schematic");
    let checked = 0, maxH = 0;
    for (let i = 0; i < STAGES.length; i++) {
      stageBtn(i).click();
      if (doc.getElementById("schematicWrap").hidden) continue;
      const stage = STAGES[i], nr = stage.reactants.length;
      for (const combo of [stage.answer.slice(0, nr), [9, 9], [9, 1], [1, 9], [5, 3], [0, 0]]) {
        for (let k = 0; k < nr; k++) setCoeff(k, Math.min(9, combo[k] === undefined ? 1 : combo[k]));
        checked++;
        const vb = svg.getAttribute("viewBox").split(" ").map(Number);
        maxH = Math.max(maxH, vb[3]);
        const rs = [...svg.querySelectorAll(".schBlock rect")].map((r) => ({
          x: +r.getAttribute("x"), y: +r.getAttribute("y"),
          w: +r.getAttribute("width"), h: +r.getAttribute("height"),
        }));
        for (let a = 0; a < rs.length; a++) {
          for (let b = a + 1; b < rs.length; b++) {
            const p = rs[a], q = rs[b];
            assert(!(p.x < q.x + q.w - 0.01 && q.x < p.x + p.w - 0.01 &&
                     p.y < q.y + q.h - 0.01 && q.y < p.y + p.h - 0.01),
              `ブロックが重なる: ステージ${i + 1} 係数${combo} #${a}/#${b}`);
          }
        }
        for (const r of rs) {
          assert(r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= vb[2] + 0.01 && r.y + r.h <= vb[3] + 0.01,
            `ブロックが枠外: ステージ${i + 1} 係数${combo}`);
        }
      }
    }
    assert(checked >= 60, "検査した組み合わせが少なすぎる: " + checked);
    // 係数を上げすぎても図が青天井に伸びない（段数に上限がある）
    assert(maxH <= 1000, "模式図が伸びすぎる: " + maxH);
  });

  await t("UI: ブロック模式図 - つり合っていても最簡でなければ割り方を助言する", async () => {
    stageBtn(1).click();   // H₂SO₄ × NaOH（正解 1:2:1:2）
    [2, 4, 2, 4].forEach((v, i) => setCoeff(i, v));
    const msg = doc.getElementById("schematicMsg").textContent;
    assert(msg.includes("2 で割って"), "何で割るか言っていない: " + msg);
    assert(msg.includes("1H₂SO₄"), "割った先を物質名つきで示さない: " + msg);
    assert(doc.getElementById("eqMsg").textContent.includes("1 : 2 : 1 : 2"),
      "反応式側の助言に割った先が無い: " + doc.getElementById("eqMsg").textContent);
    // 最簡に直せば「ぴったり」に戻る
    [1, 2, 1, 2].forEach((v, i) => setCoeff(i, v));
    assert(doc.getElementById("schematicMsg").textContent.includes("ぴったり"),
      "最簡に直しても助言が残る: " + doc.getElementById("schematicMsg").textContent);
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
    // 単原子イオンは円＋式で描く。電荷はバッジで示すので式に ⁺ は付けない（二重表示の防止）
    const hplus = groups.find((gr) => [...gr.querySelectorAll("text")].some((t) => t.textContent === "H"));
    assert(hplus, "単原子イオン H⁺ が円＋式で見つからない");
    assert([...hplus.querySelectorAll("text")].some((t) => t.textContent === "+"), "電荷バッジが無い");
    assert(![...hplus.querySelectorAll("text")].some((t) => t.textContent.includes("⁺")), "式にも電荷が付いていて二重表示になっている");
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
    // 4個ぶん沈殿させる（横に並んで着地する場面を作り、隣どうしの重なりも拾う）
    for (let k = 0; k < 4; k++) { addBtn(0).click(); addBtn(1).click(); }
    adv(4000);
    reactBtn().click();
    adv(16000);
    const ps = win.IonEq.particles().filter((p) => ["float", "pop", "settled"].includes(p.mode));
    assert(ps.filter((p) => p.mode === "settled").length === 4, "沈殿が4個そろわない");
    // 判定は「描かれている形」に合わせる。丸い粒どうしは中心間距離、
    // 枠つきの粒（沈殿・錯イオン）どうしは見た目の幅・高さの箱、
    // 丸と枠なら**箱のいちばん近い点から円までの距離**で見る。
    // （どこも箱で見ると、斜めに接しているだけで重なり扱いになってしまう）
    const boxy = (p) => p.hw !== p.r || p.hr !== p.r;
    const hits = (a, b) => {
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      const ba = boxy(a), bb = boxy(b);
      if (ba && bb) return dx < a.hw + b.hw - 3 && dy < a.hr + b.hr - 3;
      if (!ba && !bb) return Math.hypot(dx, dy) < a.r + b.r - 3;
      const box = ba ? a : b, cir = ba ? b : a;
      const ox = Math.max(0, dx - box.hw), oy = Math.max(0, dy - box.hr);
      return Math.hypot(ox, oy) < cir.r - 3;
    };
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const dx = Math.abs(ps[i].x - ps[j].x), dy = Math.abs(ps[i].y - ps[j].y);
        const hit = hits(ps[i], ps[j]);
        assert(!hit,
          `重なり: ${ps[i].sp}(${ps[i].mode}) と ${ps[j].sp}(${ps[j].mode}) dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
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
      // C群は1組ずつゆっくり見せるため、生成物が多い反応は演出が長い（模擬時間なので実時間は増えない）
      adv(50000);
      assert(state().reactionDone, st.id + ": 反応が完了しない");
      // 反応式パネルの模範は「いま表示している式」のもの（イオン反応式が既定のステージがある）
      const eqAns = eqOf(st, state().eqMode).answer;
      eqAns.forEach((n, idx) => { for (let k = 0; k < n; k++) ups()[idx].click(); });
      const s = state();
      assert(s.coeffOk, st.id + ": 模範係数が正解にならない");
      assert(s.cleared, st.id + ": クリアにならない");
      if (s.eqMode === "ionic") continue;   // イオン反応式では数合わせビューを出さない
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

  await t("UI: 錯イオン - Cu²⁺ に NH₃ 4個が配位して [Cu(NH₃)₄]²⁺ ができる", async () => {
    const i = STAGES.findIndex((st) => st.id === "complex-cu-nh3");
    assert(i >= 0, "complex-cu-nh3 ステージが無い");
    stageBtn(i).click();
    addBtn(0).click(); // CuSO₄×1
    for (let k = 0; k < 4; k++) addBtn(1).click(); // NH₃×4
    adv(4000);
    let s = state();
    assert(s.counts["Cu^2+"] === 1 && s.counts["NH3"] === 4,
      "NH₃ は電離せず分子のまま溶けるはず: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(12000);
    s = state();
    assert(s.counts["Cu(NH3)4^2+"] === 1, "錯イオンができない: " + JSON.stringify(s.counts));
    assert(!s.counts["NH3"] && !s.counts["Cu^2+"], "NH₃4個と Cu²⁺ が使われるはず: " + JSON.stringify(s.counts));
    assert(s.counts["SO4^2-"] === 1, "傍観イオン SO₄²⁻ が残らない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
    assert(doc.querySelector("#stageTitle .goal").textContent.includes("錯イオン"), "目標が錯イオンでない");
  });

  await t("UI: 錯イオン - Ag⁺ の配位数は2（NH₃ が2個）", async () => {
    const i = STAGES.findIndex((st) => st.id === "complex-ag-nh3");
    stageBtn(i).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // AgNO₃×1, NH₃×2
    adv(4000);
    reactBtn().click();
    adv(12000);
    const s = state();
    assert(s.counts["Ag(NH3)2^+"] === 1, "[Ag(NH₃)₂]⁺ ができない: " + JSON.stringify(s.counts));
    assert(s.counts["NO3-"] === 1 && !s.counts["NH3"], "傍観イオン/配位子の残りが想定外: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 沈殿の再溶解 - NH₃ が足りなければ溶けきらず、4個そろうと錯イオンになる", async () => {
    const i = STAGES.findIndex((st) => st.id === "cu-nh3-step2");
    assert(i >= 0, "cu-nh3-step2 ステージが無い");
    stageBtn(i).click();
    // NH₃ が2個では配位数4に足りない＝沈殿は溶け残る
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click();
    adv(4000);
    reactBtn().click();
    adv(12000);
    let s = state();
    assert(s.counts["Cu(OH)2"] === 1 && s.settled === 1, "沈殿が残らない: " + JSON.stringify(s.counts));
    assert(!s.counts["Cu(NH3)4^2+"], "NH₃ が足りないのに錯イオンができる: " + JSON.stringify(s.counts));
    assert(!s.reactionDone, "溶けきっていないのに完了扱い");
    // 残り2個を足すと、沈殿（settled）が反応に参加して溶ける
    addBtn(1).click(); addBtn(1).click();
    adv(4000);
    reactBtn().click();
    adv(15000);
    s = state();
    assert(s.counts["Cu(NH3)4^2+"] === 1, "錯イオンができない（沈殿が溶けない）: " + JSON.stringify(s.counts));
    assert(!s.counts["Cu(OH)2"] && s.settled === 0, "沈殿が残っている: " + JSON.stringify(s.counts));
    assert(s.counts["OH-"] === 2, "放出された OH⁻ が2個でない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない（放出 OH⁻ を余りと誤判定した可能性）");
  });

  await t("UI: 沈殿を反応物として投入できる（AgCl＋2NH₃ が溶けて錯イオンになる）", async () => {
    const i = STAGES.findIndex((st) => st.id === "complex-agcl-nh3");
    assert(i >= 0, "AgCl×NH₃ ステージが無い");
    stageBtn(i).click();
    addBtn(0).click();          // AgCl（沈殿そのものを入れる）
    adv(5000);
    let s = state();
    assert(s.counts["AgCl"] === 1, "AgCl が粒として残らない: " + JSON.stringify(s.counts));
    assert(!s.counts["Ag+"] && !s.counts["Cl-"], "沈殿なのに電離してしまう: " + JSON.stringify(s.counts));
    assert(s.settled === 1, "投入した沈殿が底に沈まない: settled=" + s.settled);
    // NH₃ を2個加えると溶けて [Ag(NH₃)₂]⁺ と Cl⁻ になる
    addBtn(1).click(); addBtn(1).click();
    adv(4000);
    reactBtn().click();
    adv(20000);
    s = state();
    assert(s.counts["Ag(NH3)2^+"] === 1, "錯イオンができない: " + JSON.stringify(s.counts));
    assert(s.counts["Cl-"] === 1, "Cl⁻ が放出されない: " + JSON.stringify(s.counts));
    assert(!s.counts["AgCl"] && s.settled === 0, "沈殿が残る: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 弱塩基 - NH₃ は水から H⁺ を奪って OH⁻ を出し、Cu(OH)₂ の沈殿をつくる", async () => {
    const i = STAGES.findIndex((st) => st.id === "cu-nh3-step1");
    assert(i >= 0, "アンモニア水版が無い");
    stageBtn(i).click();
    // 水は溶媒なので投入ボタンには出ない（式には現れる）
    assert($$("#toolbar .add").length === 2, "投入ボタンが2つでない（水が出ている？）");
    assert($$("#equation .formula").map((e) => e.textContent).join() === "Cu²⁺,NH₃,H₂O,Cu(OH)₂,NH₄⁺",
      "イオン反応式の項が違う: " + $$("#equation .formula").map((e) => e.textContent).join());
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click();   // CuSO₄×1, NH₃×2
    adv(5000);
    let s = state();
    // 入れただけでは電離しない（弱塩基＝ほとんどが分子のまま）
    assert(s.counts["NH3"] === 2 && !s.counts["OH-"], "入れただけで電離してしまう: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(20000);
    s = state();
    assert(s.counts["Cu(OH)2"] === 1, "青白沈殿ができない: " + JSON.stringify(s.counts));
    assert(s.counts["NH4+"] === 2, "NH₄⁺ が2個できない: " + JSON.stringify(s.counts));
    assert(s.counts["SO4^2-"] === 1, "傍観の SO₄²⁻ が残らない: " + JSON.stringify(s.counts));
    // 反応に使った水を数えている（原子の保存検査に要る）
    assert(s.solventUsed["H2O"] === 2, "使った水を数えていない: " + JSON.stringify(s.solventUsed));
    assert(s.reactionDone, "反応完了にならない");
    [1, 2, 2, 1, 2].forEach((v, k) => setCoeff(k, v));
    assert(state().coeffOk && state().cleared, "イオン反応式の模範でクリアにならない");
    // 過剰にすると同じ NH₃ が今度は配位子として働き、沈殿が溶ける（水は使わない）
    const j = STAGES.findIndex((st) => st.id === "cu-nh3-step2");
    stageBtn(j).click();
    addBtn(0).click();
    for (let k = 0; k < 4; k++) addBtn(1).click();
    adv(5000);
    assert(state().settled === 1, "投入した Cu(OH)₂ が沈殿にならない");
    reactBtn().click();
    adv(25000);
    s = state();
    assert(s.counts["Cu(NH3)4^2+"] === 1 && s.counts["OH-"] === 2, "錯イオンにならない: " + JSON.stringify(s.counts));
    assert(!s.solventUsed["H2O"], "配位なのに水を使っている: " + JSON.stringify(s.solventUsed));
    assert(s.reactionDone, "再溶解が完了しない");
  });

  await t("UI: 分子反応式 ⇄ イオン反応式 を切り替えられる（電荷の行も出る）", async () => {
    const i = STAGES.findIndex((st) => st.id === "amphoteric-al-step1");
    stageBtn(i).click();
    const terms = () => $$("#equation .formula").map((e) => e.textContent);
    const modeBtns = () => $$(".eqModeBtn");
    const tallyRows = () => $$("#tally tr").map((r) => r.textContent);
    // primary:"ionic" なので既定はイオン反応式
    assert(state().eqMode === "ionic", "既定がイオン反応式でない: " + state().eqMode);
    assert(terms().join() === "Al³⁺,OH⁻,Al(OH)₃", "イオン式の項が違う: " + terms().join());
    assert(doc.getElementById("recombineWrap").hidden, "イオン式のとき数合わせが出てしまう");
    [1, 3, 1].forEach((v, k) => setCoeff(k, v));
    assert(state().coeffOk, "イオン式の模範が正解にならない");
    assert(tallyRows().some((r) => r.startsWith("電荷")), "電荷の行が出ない: " + tallyRows().join("/"));
    // 分子反応式へ切り替えると項も係数もそちらになる
    modeBtns()[0].click();
    assert(state().eqMode === "molecular", "切り替わらない");
    assert(terms().join() === "AlCl₃,NaOH,Al(OH)₃,NaCl", "分子式の項が違う: " + terms().join());
    assert(!doc.getElementById("recombineWrap").hidden, "分子式なのに数合わせが出ない");
    assert(!state().coeffOk, "切り替えたのに係数が持ち越されている");
    [1, 3, 1, 3].forEach((v, k) => setCoeff(k, v));
    assert(state().coeffOk, "分子式の模範が正解にならない");
    assert(!tallyRows().some((r) => r.startsWith("電荷")), "分子式で電荷の行が出てしまう");
    // 切り替えボタンは ionic を持つステージにだけ出る
    stageBtn(0).click();
    assert(doc.getElementById("eqMode").hidden, "ionic の無いステージに切り替えが出る");
  });

  await t("UI: 両性の分割版 - 少量で沈殿・過剰で再溶解が2本の式として別々に成立する", async () => {
    const run = (id, adds) => {
      const i = STAGES.findIndex((st) => st.id === id);
      assert(i >= 0, id + " が無い");
      stageBtn(i).click();
      adds.forEach((n, k) => { for (let j = 0; j < n; j++) addBtn(k).click(); });
      adv(5000);
      reactBtn().click();
      adv(22000);
      return state();
    };
    // ① 少量: Al³⁺ ＋ 3OH⁻ → Al(OH)₃↓（ここで止まる＝溶けない）
    let s = run("amphoteric-al-step1", [1, 3]);
    assert(s.counts["Al(OH)3"] === 1 && s.settled === 1, "Al(OH)₃ の沈殿ができない: " + JSON.stringify(s.counts));
    assert(!s.counts["Al(OH)4^-"], "少量の段で溶けてしまう: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "①が完了にならない");
    // ② 過剰: 沈殿から始めて OH⁻ 1個で溶ける
    s = run("amphoteric-al-step2", [1, 1]);
    assert(s.counts["Al(OH)4^-"] === 1, "[Al(OH)₄]⁻ にならない: " + JSON.stringify(s.counts));
    assert(!s.counts["Al(OH)3"] && s.settled === 0, "沈殿が残る: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "②が完了にならない");
    // Zn は沈殿に2個・再溶解にさらに2個（Al との違いが出る）
    s = run("amphoteric-zn-step1", [1, 2]);
    assert(s.counts["Zn(OH)2"] === 1 && s.reactionDone, "Zn(OH)₂ の沈殿ができない: " + JSON.stringify(s.counts));
    s = run("amphoteric-zn-step2", [1, 2]);
    assert(s.counts["Zn(OH)4^2-"] === 1 && s.reactionDone, "[Zn(OH)₄]²⁻ にならない: " + JSON.stringify(s.counts));
  });

  await t("UI: 沈殿の再溶解 - 段階を踏んで溶ける（持ち上げ→ほどけ→錯イオン→OH⁻が泳ぐ）", async () => {
    const i = STAGES.findIndex((st) => st.id === "cu-nh3-step2");
    stageBtn(i).click();
    addBtn(0).click();
    for (let k = 0; k < 4; k++) addBtn(1).click();
    adv(4000);
    assert(state().counts["Cu(OH)2"] === 1 && state().settled === 1, "沈殿が置かれない");
    reactBtn().click();
    // 途中経過: 沈殿がほどけて中心イオン Cu²⁺ が現れる段階がある（一瞬で入れ替わらない）
    adv(2600);
    let s = state();
    assert(s.counts["Cu^2+"] === 1 && !s.counts["Cu(NH3)4^2+"],
      "「ほどけて Cu²⁺ が現れる」段階が無い（一瞬で錯イオンになっている）: " + JSON.stringify(s.counts));
    assert(!s.counts["Cu(OH)2"], "沈殿の枠がまだ消えていない: " + JSON.stringify(s.counts));
    // 最後まで進むと錯イオンができ、OH⁻ が溶液に残る
    adv(6000);
    s = state();
    assert(s.counts["Cu(NH3)4^2+"] === 1 && s.counts["OH-"] === 2,
      "錯イオンと OH⁻ にならない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 沈殿の再溶解 - 一度の「反応させる」で沈殿生成→再溶解まで連鎖する", async () => {
    // 2つのルールを持つステージ（沈殿→過剰の塩基で再溶解）で、一度に全部入れても連鎖すること
    const i = STAGES.findIndex((st) => st.id === "amphoteric-aloh3-naoh");
    stageBtn(i).click();
    addBtn(0).click();
    for (let k = 0; k < 4; k++) addBtn(1).click(); // 最初から全部入れる
    adv(4000);
    reactBtn().click();
    adv(20000);
    const s = state();
    assert(s.counts["Al(OH)4^-"] === 1 && !s.counts["Al(OH)3"], "連鎖して再溶解まで進まない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 両性水酸化物 - NaOH が少量なら Al(OH)₃ の沈殿のまま、過剰なら溶ける", async () => {
    const i = STAGES.findIndex((st) => st.id === "amphoteric-aloh3-naoh");
    assert(i >= 0, "amphoteric-aloh3-naoh ステージが無い");
    // 少量（3個）＝沈殿どまり
    stageBtn(i).click();
    addBtn(0).click();
    for (let k = 0; k < 3; k++) addBtn(1).click();
    adv(4000); reactBtn().click(); adv(14000);
    let s = state();
    assert(s.counts["Al(OH)3"] === 1, "OH⁻3個で沈殿ができない: " + JSON.stringify(s.counts));
    assert(!s.reactionDone, "沈殿どまりなのに完了扱い");
    // さらに1個入れると溶けて錯イオンになる（同じ試薬で結果が変わる＝両性）
    addBtn(1).click();
    adv(3000); reactBtn().click(); adv(14000);
    s = state();
    assert(s.counts["Al(OH)4^-"] === 1, "OH⁻ 合計4個で溶けない: " + JSON.stringify(s.counts));
    assert(!s.counts["Al(OH)3"], "沈殿が残っている: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 両性水酸化物 - Zn²⁺ は 2個で沈殿・合計4個で [Zn(OH)₄]²⁻ になる", async () => {
    const i = STAGES.findIndex((st) => st.id === "amphoteric-znoh2-naoh");
    stageBtn(i).click();
    addBtn(0).click();
    for (let k = 0; k < 4; k++) addBtn(1).click(); // 最初から4個＝連鎖して溶ける
    adv(4000); reactBtn().click(); adv(18000);
    const s = state();
    assert(s.counts["Zn(OH)4^2-"] === 1 && !s.counts["Zn(OH)2"],
      "連鎖して [Zn(OH)₄]²⁻ にならない: " + JSON.stringify(s.counts));
    assert(s.counts["Na+"] === 4 && s.counts["SO4^2-"] === 1, "傍観イオンが想定外: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 弱酸 - 酢酸は分子のまま溶け、中和のときに電離して H⁺ を補う", async () => {
    const i = STAGES.findIndex((st) => st.id === "weak-acid-ch3cooh-naoh");
    assert(i >= 0, "weak-acid-ch3cooh-naoh ステージが無い");
    stageBtn(i).click();
    addBtn(0).click(); // 酢酸だけ入れる
    adv(4000);
    let s = state();
    assert(s.counts["CH3COOH"] === 1, "酢酸が分子のまま溶けない: " + JSON.stringify(s.counts));
    assert(!s.counts["H+"], "弱酸なのに完全電離してしまう: " + JSON.stringify(s.counts));
    assert(doc.querySelectorAll("#beaker .particle.weak").length === 1, "弱電解質の目印が付かない");
    // 相手がいないので反応は起こらない（ここで勝手に電離させない）
    reactBtn().click();
    adv(6000);
    s = state();
    assert(s.counts["CH3COOH"] === 1 && !s.counts["H+"], "相手がいないのに電離してしまった: " + JSON.stringify(s.counts));
    assert(!s.reactionDone, "酢酸が残っているのに完了扱い");
    // NaOH を入れると、酢酸が電離して H⁺ を供給し中和が進む（ルシャトリエ）
    addBtn(1).click();
    adv(4000);
    reactBtn().click();
    adv(12000);
    s = state();
    assert(s.counts["H2O"] === 1, "中和して H₂O ができない: " + JSON.stringify(s.counts));
    assert(s.counts["CH3COO-"] === 1 && s.counts["Na+"] === 1, "酢酸イオンと Na⁺ が残らない: " + JSON.stringify(s.counts));
    assert(!s.counts["CH3COOH"], "酢酸が残っている（電離して中和されるはず）: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 弱塩基 - NH₃ は分子のまま H⁺ を受け取って NH₄⁺ になる", async () => {
    const i = STAGES.findIndex((st) => st.id === "weak-base-nh3-hcl");
    assert(i >= 0, "weak-base-nh3-hcl ステージが無い");
    stageBtn(i).click();
    addBtn(0).click(); addBtn(1).click(); // NH₃×1, HCl×1
    adv(4000);
    let s = state();
    assert(s.counts["NH3"] === 1 && s.counts["H+"] === 1 && s.counts["Cl-"] === 1,
      "NH₃ は分子のまま・HCl は電離、が成り立たない: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(12000);
    s = state();
    assert(s.counts["NH4+"] === 1, "NH₄⁺ ができない: " + JSON.stringify(s.counts));
    assert(!s.counts["NH3"] && !s.counts["H+"], "NH₃ と H⁺ が使われていない: " + JSON.stringify(s.counts));
    assert(s.counts["Cl-"] === 1, "傍観イオン Cl⁻ が残らない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 分子反応（C群）- 分子が原子にばらけて組み替わり、原子は消えない", async () => {
    const i = STAGES.findIndex((st) => st.id === "combustion-ch4-o2");
    assert(i >= 0, "combustion-ch4-o2 ステージが無い");
    stageBtn(i).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // CH₄×1, O₂×2
    adv(4500);
    let s = state();
    // 投入しただけでは分子のまま（ばらけるのは反応の瞬間）
    assert(s.counts["CH4"] === 1 && s.counts["O2"] === 2, "分子のまま漂わない: " + JSON.stringify(s.counts));
    assert(!s.counts["C"] && !s.counts["H"] && !s.counts["O"], "投入時点でばらけてしまった: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(15000);
    s = state();
    assert(s.counts["CO2"] === 1 && s.counts["H2O"] === 2,
      "CO₂1個・H₂O2個にならない: " + JSON.stringify(s.counts));
    // 気体の空間なので「泡になって逃げる」は起きない＝原子が消えない
    assert(!s.escaped["CO2"], "CO₂ が泡で逃げてしまった（原子が消えたように見える）: " + JSON.stringify(s.escaped));
    assert(s.reactionDone, "反応完了にならない");
  });

  await t("UI: 枠の形で状態を区別 - 沈殿は□枠・錯イオンは〇枠、中に構成イオンを描く", async () => {
    // 沈殿 AgCl（□枠）
    stageBtn(3).click();
    addBtn(0).click(); addBtn(1).click();
    adv(3000); reactBtn().click(); adv(10000);
    const solid = [...doc.querySelectorAll("#beaker .particle")]
      .find((gr) => (gr.querySelector("title") || {}).textContent && gr.querySelector("title").textContent.includes("塩化銀"));
    assert(solid, "AgCl の粒が見つからない");
    assert(solid.querySelector("rect"), "沈殿が□枠で描かれていない");
    const solidLabels = [...solid.querySelectorAll("text")].map((t) => t.textContent);
    assert(solidLabels.includes("Ag⁺") && solidLabels.includes("Cl⁻"),
      "沈殿の中に構成イオンが描かれていない: " + solidLabels.join(","));
    // 錯イオン [Cu(NH₃)₄]²⁺（〇枠）
    const ci = STAGES.findIndex((st) => st.id === "complex-cu-nh3");
    stageBtn(ci).click();
    addBtn(0).click();
    for (let k = 0; k < 4; k++) addBtn(1).click();
    adv(4000); reactBtn().click(); adv(12000);
    const cx = [...doc.querySelectorAll("#beaker .particle")]
      .find((gr) => (gr.querySelector("title") || {}).textContent && gr.querySelector("title").textContent.includes("テトラアンミン"));
    assert(cx, "錯イオンの粒が見つからない");
    assert(cx.querySelector("ellipse"), "錯イオンが〇枠で描かれていない");
    assert(!cx.querySelector("rect"), "錯イオンが□枠になっている");
    const cxLabels = [...cx.querySelectorAll("text")].map((t) => t.textContent);
    assert(cxLabels.includes("Cu²⁺") && cxLabels.filter((l) => l === "NH₃").length === 4,
      "錯イオンの中に Cu²⁺ と NH₃×4 が描かれていない: " + cxLabels.join(","));
  });

  await t("UI: 分子反応 - 2CH₄+2O₂ でも1分子ずつ反応し、分子を食い散らかさない", async () => {
    const i = STAGES.findIndex((st) => st.id === "combustion-ch4-o2");
    stageBtn(i).click();
    addBtn(0).click(); addBtn(0).click(); addBtn(1).click(); addBtn(1).click(); // 2CH₄ + 2O₂
    adv(5000);
    reactBtn().click();
    adv(40000);
    const s = state();
    // CH₄ 1分子ぶんだけが反応し、もう1分子は分子のまま残る（バラバラの原子を残さない）
    assert(s.counts["CO2"] === 1 && s.counts["H2O"] === 2,
      "1分子ぶん（CO₂1・H₂O2）にならない: " + JSON.stringify(s.counts));
    assert(s.counts["CH4"] === 1, "余った CH₄ が分子のまま残らない: " + JSON.stringify(s.counts));
    assert(!s.counts["C"] && !s.counts["H"] && !s.counts["O"],
      "ばらけた原子が取り残されている（食い散らかし）: " + JSON.stringify(s.counts));
    assert(!s.reactionDone, "反応物が余っているのに完了扱い");
  });

  await t("UI: 分子反応 - 余分に入れた分子はほどかず、分子のまま残る", async () => {
    const i = STAGES.findIndex((st) => st.id === "combustion-c2h6-o2");
    assert(i >= 0, "combustion-c2h6-o2 ステージが無い");
    stageBtn(i).click();
    addBtn(0).click(); addBtn(0).click();
    for (let k = 0; k < 8; k++) addBtn(1).click();   // 模範は7個。1個余分に入れる
    adv(5000);
    reactBtn().click();
    adv(50000);
    const s = state();
    assert(s.counts["CO2"] === 4 && s.counts["H2O"] === 6, "4CO₂・6H₂O にならない: " + JSON.stringify(s.counts));
    assert(s.counts["O2"] === 1, "余分な O₂ が分子のまま残らない: " + JSON.stringify(s.counts));
    assert(!s.counts["O"] && !s.counts["C"] && !s.counts["H"],
      "使わない分子までほどいて原子が取り残されている: " + JSON.stringify(s.counts));
  });

  await t("UI: 分子反応 - 入れすぎのときは「入れすぎ」と伝え、やり直しも案内する", async () => {
    const i = STAGES.findIndex((st) => st.id === "combustion-c2h6-o2");
    stageBtn(i).click();
    addBtn(0).click();                                // C₂H₆×1（模範は2個）
    for (let k = 0; k < 8; k++) addBtn(1).click();    // O₂×8（模範は7個）
    adv(5000);
    reactBtn().click();
    adv(45000);
    const s = state();
    // 反応自体は進む（C₂H₆ 1個ぶん）
    assert(s.counts["CO2"] === 2 && s.counts["H2O"] === 3, "1分子ぶんの反応が進まない: " + JSON.stringify(s.counts));
    assert(!s.reactionDone, "ちょうどではないのに完了扱い");
    let msg = doc.getElementById("msg").textContent;
    assert(msg.includes("入れすぎ"), "入れすぎだと伝えていない: " + msg);
    assert(msg.includes("やり直す"), "入れ直しの案内が無い（足すだけでは比が合わない場合がある）: " + msg);
    // この時点は C₂H₆ を足せば進むので「足す」案内があるべき
    assert(msg.includes("C₂H₆ を足す"), "まだ足して進められるのに案内が無い: " + msg);
    // C₂H₆ を1個足すと O₂ が1個だけ余る＝もう足しても比が合わない状態になる
    addBtn(0).click();
    adv(4000);
    reactBtn().click();
    adv(45000);
    const s2 = state();
    assert(s2.counts["O2"] === 1 && s2.counts["CO2"] === 4 && s2.counts["H2O"] === 6,
      "O₂ が1個だけ余る状態にならない: " + JSON.stringify(s2.counts));
    msg = doc.getElementById("msg").textContent;
    assert(msg.includes("足しても比が合わない"), "足しても進めないのに「足す」案内が残っている: " + msg);
  });

  await t("UI: 大きい分子は簡易アニメ - C₃H₈ は原子にほどかず分子のまま組み替える", async () => {
    const i = STAGES.findIndex((st) => st.id === "combustion-c3h8-o2");
    assert(i >= 0, "combustion-c3h8-o2 ステージが無い");
    stageBtn(i).click();
    // 模範係数5が入力できること（投入上限が係数から自動算出されている）
    addBtn(0).click();
    for (let k = 0; k < 5; k++) addBtn(1).click();
    adv(5000);
    let s = state();
    assert(s.counts["C3H8"] === 1 && s.counts["O2"] === 5,
      "係数5ぶんの O₂ を入れられない（投入上限が固定になっている）: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(25000);
    s = state();
    assert(s.counts["CO2"] === 3 && s.counts["H2O"] === 4,
      "3CO₂・4H₂O にならない: " + JSON.stringify(s.counts));
    assert(!s.counts["C"] && !s.counts["H"] && !s.counts["O"],
      "簡易モードなのに原子へほどけている: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
    assert(doc.querySelector("#stageTitle .goal").textContent.includes("分子を組み替えて"),
      "目標文が簡易モード用になっていない");
  });

  await t("UI: 弱酸の遊離 - 塩酸が酢酸を追い出し、酢酸は分子のまま残る", async () => {
    const i = STAGES.findIndex((st) => st.id === "weak-acid-free-ch3coona-hcl");
    assert(i >= 0, "弱酸の遊離ステージが無い");
    stageBtn(i).click();
    // ビーカー: CH₃COONa と HCl を1個ずつ → CH₃COOH が1個できて Na⁺・Cl⁻ が残る
    addBtn(0).click(); addBtn(1).click();
    adv(4000);
    let s = state();
    assert(s.counts["CH3COO-"] === 1 && s.counts["H+"] === 1,
      "電離が想定外（酢酸イオンと H⁺ が1個ずつのはず）: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(12000);
    s = state();
    assert(s.counts["CH3COOH"] === 1, "酢酸分子ができない: " + JSON.stringify(s.counts));
    assert(s.counts["Na+"] === 1 && s.counts["Cl-"] === 1, "傍観イオンが残らない: " + JSON.stringify(s.counts));
    assert(!s.counts["CH3COO-"] && !s.counts["H+"], "H⁺・CH₃COO⁻ が使い切られない: " + JSON.stringify(s.counts));
    assert(s.reactionDone, "反応完了にならない");
    // 模式図は「CH₃COO⁻ が H⁺ を受け取る」形で出る
    assert(!doc.getElementById("schematicWrap").hidden, "模式図が出ない");
    [1, 1, 1, 1].forEach((v, k) => setCoeff(k, v));
    assert(doc.getElementById("schematicMsg").textContent.includes("ぴったり"),
      "1:1 でそろわない: " + doc.getElementById("schematicMsg").textContent);
  });

  await t("UI: 置き換えビュー - 中和ずみの図から強酸が座を奪うまで再生できる", async () => {
    const i = STAGES.findIndex((st) => st.id === "weak-acid-free-ch3coona-hcl");
    stageBtn(i).click();
    const wrap = doc.getElementById("displaceWrap");
    const svg = doc.getElementById("displace");
    assert(!wrap.hidden, "置き換えビューが出ない");
    // 初期: 塩基・弱酸・強酸の3ブロックと H₂O が並ぶ
    assert(svg.querySelectorAll(".schBlock").length === 3, "ブロックが3個でない: " + svg.querySelectorAll(".schBlock").length);
    const texts = () => [...svg.querySelectorAll("text")].map((e) => e.textContent);
    assert(texts().includes("H₂O"), "中和ずみの水がない: " + texts().join("/"));
    assert(texts().includes("CH₃COO⁻") && texts().includes("Cl⁻"), "酸の本体イオンがない: " + texts().join("/"));
    assert(state().displace && !state().displace.played, "初期状態が played になっている");
    // 再生
    win.IonEq.displace();
    adv(6000);
    assert(state().displace.finished, "演出が終わらない: " + JSON.stringify(state().displace));
    assert(texts().includes("CH₃COOH"), "遊離した酢酸の分子が出てこない: " + texts().join("/"));
    assert(svg.querySelectorAll(".dspSalt").length === 2, "残ったイオンの塩の表示が出ない");
    const msg = doc.getElementById("displaceMsg").textContent;
    assert(msg.includes("弱酸の遊離"), "まとめの文が出ない: " + msg);
    // もう一度押すと最初の状態に戻せる
    doc.getElementById("displaceBtn").click();
    assert(!state().displace.played && svg.querySelectorAll(".dspSalt").length === 0, "やり直せない");
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

  await t("REDOX: ブロック模式図 - e⁻ の数が高さで見え、席の空きが分かる", async () => {
    const svg = doc.getElementById("schematic");
    const blocks = () => [...svg.querySelectorAll(".schBlock")];
    const rects = () => blocks().map((g) => +g.querySelector("rect").getAttribute("height"));
    const msg = () => doc.getElementById("schematicMsg").textContent;
    const addBtns = () => [...doc.querySelectorAll("#schematicAdd button")];
    const r4 = REDOX_STAGES.findIndex((s) => s.id === "r4");   // Al(3e⁻) × Cu²⁺(2e⁻) → 2:3
    stageBtn(r4).click();
    assert(blocks().length === 2, "×1・×1 でブロックが2個でない: " + blocks().length);
    // 3個出す側は2個受け取る側より背が高い（＝価数が高さで見える）
    const h = rects();
    assert(h[0] > h[1], "e⁻ 3個のブロックが 2個より高くない: " + JSON.stringify(h));
    assert(msg().includes("あまっている"), "1:1 で e⁻ が余ると言わない: " + msg());
    // 席の空き（点線の輪）が余りの側に出る
    const dashed = [...svg.querySelectorAll(".schBlock circle")]
      .filter((c) => c.getAttribute("stroke-dasharray") !== "none");
    assert(dashed.length === 0, "1:1 では e⁻ が余る側なので空席は出ないはず");
    addBtns()[0].click();                       // 還元剤 ×2
    addBtns()[1].click(); addBtns()[1].click(); // 酸化剤 ×3
    assert(state().mult[0] === 2 && state().mult[1] === 3, "＋ボタンで倍率が動かない: " + JSON.stringify(state().mult));
    assert(msg().includes("ぴったり"), "2:3 でそろわない: " + msg());
    assert(blocks().length === 5, "2+3 ブロックにならない: " + blocks().length);
    assert(svg.querySelectorAll("polygon").length === 6, "e⁻ 6個ぶんの矢印が出ない");
    // 最小公倍数でない正解には「何で割るか」を助言する
    addBtns()[0].click(); addBtns()[0].click();                          // ×4
    addBtns()[1].click(); addBtns()[1].click(); addBtns()[1].click();    // ×6
    assert(msg().includes("×2・×3"), "4:6 に割り方の助言が出ない: " + msg());
    // ブロックのクリックで倍率を1つ減らせる
    blocks()[0].dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    assert(state().mult[0] === 3, "ブロッククリックで減らせない: " + JSON.stringify(state().mult));
  });

  await t("REDOX: ブロック模式図 - どの倍率でもブロックが重ならず枠内に収まる", async () => {
    const svg = doc.getElementById("schematic");
    const setM = (idx, v) => {
      let guard = 0;
      while (state().mult[idx] > v && guard++ < 25) {
        const bs = [...svg.querySelectorAll(".schBlock")];
        (idx === 0 ? bs[0] : bs[bs.length - 1]).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      }
      while (state().mult[idx] < v && guard++ < 25) doc.querySelectorAll("#schematicAdd button")[idx].click();
    };
    let checked = 0, maxH = 0;
    for (let i = 0; i < REDOX_STAGES.length; i++) {
      stageBtn(i).click();
      for (const [a, b] of [[1, 1], [9, 9], [9, 1], [1, 9], [5, 3], [2, 3]]) {
        setM(0, a); setM(1, b); checked++;
        const vb = svg.getAttribute("viewBox").split(" ").map(Number);
        maxH = Math.max(maxH, vb[3]);
        const rs = [...svg.querySelectorAll(".schBlock rect")].map((r) => ({
          x: +r.getAttribute("x"), y: +r.getAttribute("y"),
          w: +r.getAttribute("width"), h: +r.getAttribute("height"),
        }));
        for (let p = 0; p < rs.length; p++) {
          for (let q = p + 1; q < rs.length; q++) {
            const A = rs[p], B = rs[q];
            assert(!(A.x < B.x + B.w - 0.01 && B.x < A.x + A.w - 0.01 &&
                     A.y < B.y + B.h - 0.01 && B.y < A.y + A.h - 0.01),
              `ブロックが重なる: ${REDOX_STAGES[i].id} ×${a}・×${b}`);
          }
        }
        for (const r of rs) {
          assert(r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= vb[2] + 0.01 && r.y + r.h <= vb[3] + 0.01,
            `ブロックが枠外: ${REDOX_STAGES[i].id} ×${a}・×${b}`);
        }
      }
    }
    assert(checked >= 40, "検査した組み合わせが少なすぎる: " + checked);
    // 倍率を上げすぎても図が青天井に伸びない（段数に上限がある）
    assert(maxH <= 700, "模式図が伸びすぎる: " + maxH);
    stageBtn(0).click();
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

  await t("REDOX: 溶液中(rs2) 6:1 で Cr₂O₇²⁻×Fe²⁺ が反応し、橙が緑に変わる", async () => {
    const rs2 = REDOX_STAGES.findIndex((s) => s.id === "rs2");
    assert(rs2 >= 0, "rs2 が無い");
    stageBtn(rs2).click();
    for (let k = 1; k < 6; k++) upBtns()[0].click(); // 酸化側 ×6
    playBtn().click();
    adv(32000);
    const s = state();
    assert(s.cleared, "6:1 でクリアにならない: " + JSON.stringify(s));
    assert(s.counts["Cr^3+"] === 2 && s.counts["Fe^3+"] === 6 && s.counts["H2O"] === 7,
      "生成物が Cr₂O₇²⁻+6Fe²⁺+14H⁺→2Cr³⁺+6Fe³⁺+7H₂O と合わない: " + JSON.stringify(s.counts));
    const color = doc.querySelector("#beaker rect").getAttribute("fill");
    const rr = parseInt(color.slice(1, 3), 16), gg = parseInt(color.slice(3, 5), 16), bb = parseInt(color.slice(5, 7), 16);
    assert(color !== "#eaf5fc" && gg > rr && gg > bb, "溶液が緑（Cr³⁺）にならない: " + color);
  });

  await t("REDOX: 溶液中(rs3) 5:2 で MnO₄⁻×シュウ酸が反応し、CO₂ が泡で逃げ紫が消える", async () => {
    const rs3 = REDOX_STAGES.findIndex((s) => s.id === "rs3");
    assert(rs3 >= 0, "rs3 が無い");
    stageBtn(rs3).click();
    for (let k = 1; k < 5; k++) upBtns()[0].click(); // 酸化側(シュウ酸) ×5
    for (let k = 1; k < 2; k++) upBtns()[1].click(); // 還元側(MnO₄⁻) ×2
    playBtn().click();
    adv(35000);
    const s = state();
    assert(s.cleared, "5:2 でクリアにならない: " + JSON.stringify(s));
    assert(s.escaped["CO2"] === 10, "CO₂ が10個泡で逃げていない: " + JSON.stringify(s.escaped));
    assert(s.counts["Mn^2+"] === 2 && (s.counts["H2O"] || 0) === 8, "Mn²⁺2/H₂O8 と合わない: " + JSON.stringify(s.counts));
    assert(!s.counts["MnO4-"], "MnO₄⁻ が残っている（紫が消えるはず）: " + JSON.stringify(s.counts));
    const color = doc.querySelector("#beaker rect").getAttribute("fill");
    assert(color === "#eaf5fc", "溶液が無色に戻らない: " + color);
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
    // 反応ごとの分解上書き（C群は原子に分解）を尊重する
    const partsFor = (sp) => (rx.parts && rx.parts[sp]) || PARTS[sp] || [sp];
    [...rx.reactants, ...rx.products].forEach((x) => s.add(x));
    rx.reactants.forEach((r) => (DISSOCIATION[r] || ATOMIZATION[r] || []).forEach((i) => s.add(i)));
    rx.products.forEach((p) => partsFor(p).forEach((i) => s.add(i)));
    // イオン反応式の項も登場種（物質検索で引けること）
    if (rx.ionic) [...rx.ionic.reactants, ...rx.ionic.products].forEach((i) => s.add(i));
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

  await t("分割版とまとめ版のリンクが双方向でつながっている（steps / combined）", () => {
    const byId = {};
    data.reactions.forEach((r) => (byId[r.id] = r));
    let pairs = 0;
    for (const rx of data.reactions) {
      for (const sid of rx.steps || []) {
        assert(byId[sid], rx.id + ": steps の " + sid + " が無い");
        assert(byId[sid].combined === rx.id, sid + ": combined が " + rx.id + " を指していない");
        pairs++;
      }
      if (rx.combined) {
        const c = byId[rx.combined];
        assert(c, rx.id + ": combined の " + rx.combined + " が無い");
        assert((c.steps || []).includes(rx.id), rx.combined + ": steps に " + rx.id + " が無い");
      }
    }
    assert(pairs >= 4, "分割版のリンクが少なすぎる: " + pairs);
    // 分割版の係数を足すと、まとめ版の係数になること（2本に分けても同じ反応であることの担保）
    for (const rx of data.reactions.filter((r) => r.steps)) {
      const total = {};
      const add = (r, k) => {
        const nL = r.reactants.length;
        r.reactants.forEach((sp, i) => (total[sp] = (total[sp] || 0) + k * r.coeffs[i]));
        r.products.forEach((sp, i) => (total[sp] = (total[sp] || 0) - k * r.coeffs[nL + i]));
      };
      rx.steps.forEach((sid) => add(byId[sid], 1));
      add(rx, -1);
      // 途中でできて次の段で消える沈殿は打ち消し合い、残りはすべて 0 になるはず
      for (const sp of Object.keys(total)) {
        assert(total[sp] === 0, rx.id + ": 分割版の合計がまとめ版と合わない（" + sp + " が " + total[sp] + "）");
      }
    }
  });

  await t("移行の同一性: 既存 STAGES と reactions.json が一致（両立期間の担保）", () => {
    for (const st of STAGES) {
      const rx = data.reactions.find((r) => r.id === st.id);
      assert(rx, "reactions.json に " + st.id + " が無い");
      // 比べるのは**分子反応式**（溶媒の水が式に入る反応では、ビーカーの試薬と式の項が違う）
      const eq = eqOf(st);
      assert(JSON.stringify(rx.reactants) === JSON.stringify(eq.reactants), st.id + ": reactants 不一致");
      assert(JSON.stringify(rx.products) === JSON.stringify(eq.products), st.id + ": products 不一致");
      assert(JSON.stringify(rx.coeffs) === JSON.stringify(eq.answer), st.id + ": 係数不一致");
      // イオン反応式も両方に同じものが載っていること
      assert(!!rx.ionic === !!st.ionic, st.id + ": ionic の有無が食い違う");
      if (st.ionic) assert(JSON.stringify(rx.ionic) === JSON.stringify(st.ionic), st.id + ": ionic 不一致");
    }
  });

  await t("イオン反応式も原子・電荷が保存し、最簡整数比になっている", () => {
    let n = 0;
    for (const rx of data.reactions) {
      if (!rx.ionic) continue;
      const eq = rx.ionic, nL = eq.reactants.length;
      const left = eq.reactants.map((sp, i) => ({ sp, n: eq.answer[i] }));
      const right = eq.products.map((sp, i) => ({ sp, n: eq.answer[nL + i] }));
      const cmp = compareSides(left, right);
      assert(cmp.rows.every((r) => r.ok), rx.id + ": イオン反応式で原子が保存しない");
      assert(cmp.chargeOk, rx.id + `: イオン反応式で電荷が合わない（左 ${cmp.chargeLeft} / 右 ${cmp.chargeRight}）`);
      assert(gcdAll(eq.answer) === 1, rx.id + ": イオン反応式が最簡整数比でない");
      n++;
    }
    assert(n >= 9, "イオン反応式を持つ反応が少なすぎる: " + n);
  });

  await t("別バージョンのリンクが双方向（variantOf）", () => {
    const byId = {};
    data.reactions.forEach((r) => (byId[r.id] = r));
    let n = 0;
    for (const rx of data.reactions) {
      if (!rx.variantOf) continue;
      const other = byId[rx.variantOf];
      assert(other, rx.id + ": variantOf の " + rx.variantOf + " が無い");
      assert(other.variantOf === rx.id, rx.variantOf + ": variantOf が " + rx.id + " を指していない");
      n++;
    }
    assert(n >= 2, "別バージョンのリンクが無い: " + n);
    // NaOH 版とアンモニア水版は、イオン反応式で見ると同じ沈殿反応（＝行き来させる意味がある）
    const naoh = STAGES.find((s) => s.id === "s9");
    const nh3 = STAGES.find((s) => s.id === "cu-nh3-step1");
    assert(naoh.ionic && nh3.ionic, "どちらもイオン反応式を持つこと");
    assert(naoh.ionic.products.join() === "Cu(OH)2" && nh3.ionic.products.includes("Cu(OH)2"),
      "同じ沈殿にならない");
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
