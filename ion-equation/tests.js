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
      for (const el of Object.keys(s.atoms)) {
        assert(ox[el] !== undefined, sp + ": " + el + " の酸化数の定義漏れ");
        // 原子ごとに書いた場合、個数が組成と合っていること・表示位置が化学式の中を指すこと
        if (Array.isArray(ox[el])) {
          assert(ox[el].length === s.atoms[el],
            sp + ": " + el + " の原子ごとの酸化数が " + ox[el].length + "個（組成は " + s.atoms[el] + "個）");
          for (const a of ox[el]) {
            assert(Number.isInteger(a.ox), sp + ": 原子ごとの酸化数が整数でない");
            assert(Number.isInteger(a.at) && a.at >= 0 && a.at < s.disp.length,
              sp + ": 表示位置 at=" + a.at + " が化学式「" + s.disp + "」の外");
            assert(s.disp.slice(a.at, a.at + el.length) === el,
              sp + ": at=" + a.at + " が指すのは「" + s.disp.slice(a.at, a.at + el.length) + "」で " + el + " でない");
          }
        }
      }
      assert(oxSum(sp) === s.charge,
        sp + ": 酸化数の合計(" + oxSum(sp) + ")が電荷(" + s.charge + ")と一致しない");
    }
    for (const [id, hr] of Object.entries(HALF_REACTIONS)) {
      const changes = oxChangeOfHalf(hr);
      assert(changes.length === 1, id + ": 変化する元素が1つでない");
      assert(!changes[0].ambiguous, id + ": 1種類の変化にまとまらない: " + JSON.stringify(changes[0]));
      // 変化した**原子の個数**ぶんだけ数える（O₃→O₂＋H₂O のように一部の原子だけ変わる反応がある）
      const delta = changes.reduce((acc, c) => acc + (c.to - c.from) * c.count, 0);
      const e = electronsOf(hr);
      assert(delta === (hr.kind === "oxidation" ? e : -e),
        id + ": Δ酸化数(" + delta + ")と e⁻ 数(" + e + ")の帳尻が合わない");
    }
  });

  t("銅と硝酸: 硝酸が酸と酸化剤の二役をこなす（希→NO・濃→NO₂）", () => {
    for (const [id, a, b, gas, hPer] of [["rn1", 3, 2, "NO", 4], ["rn2", 1, 2, "NO2", 2]]) {
      const st = REDOX_STAGES.find((s) => s.id === id);
      assert(st, id + " が無い");
      assert(checkRedoxMultipliers(st, a, b).ok, id + ": 模範倍率が正解にならない");
      const red = HALF_REACTIONS[st.red];
      // 還元されるのは NO₃⁻ で、H⁺ も一緒に消費する＝酸としての顔
      assert(red.left.some((t) => t.sp === "NO3-"), id + ": 還元される種が NO₃⁻ でない");
      assert(red.left.find((t) => t.sp === "H+").n === hPer, id + ": NO₃⁻ 1個あたりの H⁺ が違う");
      assert(red.right.some((t) => t.sp === gas), id + ": 発生する気体が " + gas + " でない");
      // 足し合わせたイオン反応式がつり合う
      const c = combineHalves(st, a, b);
      assert(!c.left.concat(c.right).some((t) => t.sp === "e-"), id + ": e⁻ が残った");
      assert(compareSides(c.left, c.right).balanced, id + ": イオン反応式が保存しない");
    }
    // 銅は塩酸には溶けない（H⁺ で酸化されない）＝硝酸に溶けるのは NO₃⁻ のおかげ、という対比
    assert(OXIDATION["NO3-"].N === 5 && OXIDATION["NO"].N === 2 && OXIDATION["NO2"].N === 4,
      "N の酸化数が想定と違う");
  });

  t("筆算で化学反応式に戻す: 傍観イオンの必要数が左右で一致し、模範の係数を導ける", () => {
    for (const id of ["rn1", "rn2"]) {
      const st = REDOX_STAGES.find((s) => s.id === id);
      const me = st.molecularEq;
      assert(me && me.spectator && me.join, id + ": 傍観イオンの定義が無い");
      const [a, b] = st.answer;
      // まだ足していない状態: 左辺の H⁺ も右辺の Cu²⁺ も相手がいない
      const zero = molecularizeStep(st, a, b, 0);
      assert(zero.consistent,
        id + ": 左右で必要な傍観イオンの数が食い違う: " + JSON.stringify([zero.left.need, zero.right.need]));
      assert(!zero.ok && zero.reason.includes("足りない"), id + ": 0個で完成扱い");
      assert(zero.left.free.some((f) => f.sp === "H+") && zero.right.free.some((f) => f.sp === "Cu^2+"),
        id + ": あぶれるイオンを拾えていない: " + JSON.stringify([zero.left.free, zero.right.free]));
      // ぴったり足すと化学反応式が完成し、模範係数と一致する
      const need = zero.need;
      const done = molecularizeStep(st, a, b, need);
      assert(done.ok, id + ": 必要数を足しても完成しない: " + done.reason);
      assert(done.verified, id + ": 導いた式が検算（原子・電荷・最簡比）を通らない");
      assert(String(done.coeffs) === String(me.answer),
        id + ": 導いた係数が模範と違う: " + done.coeffs + " / " + me.answer);
      // 多すぎると、相手のいない傍観イオンが両辺に残る
      const over = molecularizeStep(st, a, b, need + 1);
      assert(!over.ok && over.reason.includes("多い"), id + ": 多すぎを通した");
      assert(over.left.free.some((f) => f.sp === me.spectator), id + ": あまった傍観イオンが残らない");
      // 酸の係数は「還元されるぶん＋塩に入る傍観ぶん」（データの自己整合）
      assert(me.answer[me.acid] === me.answer[me.reduced] + me.answer[me.salt] * me.spectatorPerSalt,
        id + ": 酸の係数が 還元ぶん＋傍観ぶん になっていない");
      assert(need === me.answer[me.salt] * me.spectatorPerSalt,
        id + ": 足す傍観イオンの数が塩に入るぶんと合わない: " + need);
    }
    // 2倍は最簡でないので検算を通さない
    for (const id of ["rn1", "rn2"]) {
      const st = REDOX_STAGES.find((s) => s.id === id);
      const t2 = checkMolecularEq(st, st.molecularEq.answer.map((n) => n * 2));
      assert(!t2.ok && t2.gcd === 2, id + ": 2倍を通した");
    }
    // molecularEq を持たない反応にはこの段が無い
    assert(molecularizeStep(REDOX_STAGES[0], 1, 1, 0) === null, "molecularEq 無しで筆算の段が出る");
    assert(!checkMolecularEq(REDOX_STAGES[0], [1, 1]).ok, "molecularEq 無しで正解になる");
  });

  t("有機酸化の分子反応式: K⁺・SO₄²⁻ を戻すと教科書の式を導ける（ro1〜ro3）", () => {
    for (const id of ["ro1", "ro2", "ro3"]) {
      const st = REDOX_STAGES.find((s) => s.id === id);
      const me = st.molecularEq;
      assert(me && me.spectator === "SO4^2-" && me.fixed && me.join, id + ": molecularEq の定義が無い");
      // 原子・電荷の保存を模範係数で独立に数え直す（K・S・O は間違えやすい）
      const nL = me.reactants.length;
      const L = me.reactants.map((sp, i) => ({ sp, n: me.answer[i] }));
      const R = me.products.map((sp, i) => ({ sp, n: me.answer[nL + i] }));
      assert(compareSides(L, R).balanced, id + ": 模範係数で原子か電荷が保存しない");
      assert(gcdAll(me.answer) === 1, id + ": 模範係数が最簡整数比でない");
      const [a, b] = st.answer;
      // まだ足していない状態: 左右の必要数が一致し、4個（=H₂SO₄ の係数）
      const zero = molecularizeStep(st, a, b, 0);
      assert(zero.consistent,
        id + ": 左右で必要な傍観イオンの数が食い違う: " + JSON.stringify([zero.left.need, zero.right.need]));
      assert(zero.need === 4, id + ": 足す SO₄²⁻ は4個のはず: " + zero.need);
      assert(!zero.ok && zero.reason.includes("足りない"), id + ": 0個で完成扱い");
      // K₂Cr₂O₇ は SO₄²⁻ を足す前から組めている（K⁺ は fixed の2個で足りる）
      assert(zero.left.terms.some((x) => x.sp === "K2Cr2O7"),
        id + ": K₂Cr₂O₇ が組めていない: " + JSON.stringify(zero.left.terms));
      // あぶれるイオン: 左辺 H⁺、右辺 Cr³⁺（→Cr₂(SO₄)₃）と K⁺（→K₂SO₄）
      assert(zero.left.free.some((f) => f.sp === "H+"), id + ": 左辺の H⁺ があぶれない");
      assert(zero.right.free.some((f) => f.sp === "Cr^3+") && zero.right.free.some((f) => f.sp === "K+"),
        id + ": 右辺の Cr³⁺・K⁺ があぶれない: " + JSON.stringify(zero.right.free));
      // ぴったり4個で完成し、係数が模範と一致・並びも登録順にそろう
      const done = molecularizeStep(st, a, b, 4);
      assert(done.ok, id + ": 4個で完成しない: " + done.reason);
      assert(done.verified, id + ": 導いた式が検算（原子・電荷・最簡比）を通らない");
      assert(String(done.coeffs) === String(me.answer),
        id + ": 導いた係数が模範と違う: " + done.coeffs + " / " + me.answer);
      assert(done.left.terms.map((x) => x.sp).join() === me.reactants.join() &&
             done.right.terms.map((x) => x.sp).join() === me.products.join(),
        id + ": 完成形の並びが登録順でない: " + JSON.stringify(done.right.terms));
      // 多すぎると SO₄²⁻ が両辺に残る
      const over = molecularizeStep(st, a, b, 5);
      assert(!over.ok && over.reason.includes("多い"), id + ": 多すぎを通した");
      assert(over.left.free.some((f) => f.sp === "SO4^2-") && over.right.free.some((f) => f.sp === "SO4^2-"),
        id + ": あまった SO₄²⁻ が両辺に残らない");
      // 2倍は最簡でないので検算を通さない
      const dbl = checkMolecularEq(st, me.answer.map((n) => n * 2));
      assert(!dbl.ok && dbl.gcd === 2, id + ": 2倍を通した");
    }
    // rn 系（従来形の join）が一般化後も同じ結果を返すことは上のテストが担保する
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

  /* ---- M6-A: 酸化剤×還元剤の組み合わせ判定（DESIGN_redox_matching.md §6）----
     画面はまだ無い（M6-B 以降）が、**既存14ステージの answer と mode が導出値と一致する**
     ことをここで機械検査するので、この段だけで値打ちがある。 */

  t("M6 梯子: キーが実在の対で、孤児が無く、値はすべて数値", () => {
    const couples = new Set(Object.values(HALF_REACTIONS).map((hr) => hr.couple));
    for (const [couple, rank] of Object.entries(REDOX_LADDER_ACID)) {
      assert(typeof rank === "number" && Number.isFinite(rank), couple + ": 順位が数値でない");
      // 孤児（誰も指していない順位）が無い ＝ 梯子に書いたのに使われていない対を残さない
      assert(couples.has(couple), couple + ": この対を指す半反応式が無い（梯子の孤児）");
      const p = coupleParts(couple);
      assert(p && SPECIES[p.ox] && SPECIES[p.red], couple + ": 対の両側が SPECIES に無い");
    }
    // 順位の数値そのものは画面に出さない約束なので、表示用の関数は化学式しか返さない
    const d = coupleDisp("Cu^2+/Cu");
    assert(d.ox === "Cu²⁺" && d.red === "Cu", "対の表示が化学式になっていない");
  });

  t("M6 対: 全半反応式に couple があり、向き違いが同じ対を指し、対の両側が式の中にある", () => {
    const byCouple = {};
    for (const [id, hr] of Object.entries(HALF_REACTIONS)) {
      assert(hr.couple, id + ": couple が無い");
      const p = coupleParts(hr.couple);
      assert(p && SPECIES[p.ox] && SPECIES[p.red], id + ": couple の両側が SPECIES に無い: " + hr.couple);
      // 酸化の式なら「還元型が左辺・酸化型が右辺」、還元の式ならその逆
      const inL = (sp) => hr.left.some((t) => t.sp === sp);
      const inR = (sp) => hr.right.some((t) => t.sp === sp);
      const ok = hr.kind === "oxidation" ? (inL(p.red) && inR(p.ox)) : (inL(p.ox) && inR(p.red));
      assert(ok, id + ": couple(" + hr.couple + ") の向きが式と合っていない");
      (byCouple[hr.couple] = byCouple[hr.couple] || []).push(id);
    }
    // 同じ対を持つ式どうしは kind が違う（同じ向きの重複が無い）
    for (const [couple, ids] of Object.entries(byCouple)) {
      const kinds = ids.map((id) => HALF_REACTIONS[id].kind);
      assert(new Set(kinds).size === kinds.length, couple + ": 同じ向きの式が重複: " + ids.join(","));
    }
    // Cu_ox / Cu_red・I2_red / I_ox が実際に対になっている（この設計の要）
    assert(HALF_REACTIONS["Cu_ox"].couple === HALF_REACTIONS["Cu_red"].couple, "Cu の対がそろわない");
    assert(HALF_REACTIONS["I2_red"].couple === HALF_REACTIONS["I_ox"].couple, "I の対がそろわない");
    // 過酸化水素は**別の対**として梯子に2回出る（同じ物質が両方の役をこなす）
    assert(HALF_REACTIONS["H2O2_red"].couple !== HALF_REACTIONS["H2O2_ox"].couple,
      "H₂O₂ の酸化剤側と還元剤側が同じ対になっている");
  });

  t("M6 既存14ステージ: 全部「反応する」になり、answer と mode が導出値と一致する", () => {
    for (const st of REDOX_STAGES) {
      // st.ox は酸化される式（＝還元剤）、st.red は還元される式（＝酸化剤）。引数の向きに注意
      const r = matchHalves(st.red, st.ox);
      assert(r.verdict === "reacts",
        st.id + ": 収録ステージなのに reacts にならない（" + r.verdict + " / " + r.reasonCode + "）");
      const cs = composeStage(st.ox, st.red);
      assert(cs, st.id + ": composeStage が組み立てられない");
      // answer を**持たずに導く**。ここがずれたら梯子か登録データのどちらかが壊れている
      assert(String(cs.answer) === String(st.answer),
        st.id + ": 導いた倍率 " + cs.answer + " が登録値 " + st.answer + " と違う");
      // mode（板あり／溶液中）も導出。undefined と "solution" のどちらかで一致すること
      assert((cs.mode || null) === (st.mode || null),
        st.id + ": 導いた mode " + cs.mode + " が登録値 " + st.mode + " と違う");
      assert(checkRedoxMultipliers(cs, cs.answer[0], cs.answer[1]).ok, st.id + ": 導いた倍率が正解にならない");
    }
    // 試薬から引ける組み合わせは、試薬経由でも同じ結論になる
    const viaReagent = [["CuSO4", "Zn"], ["AgNO3", "Cu"], ["HCl_dil", "Zn"], ["CuSO4", "Al"],
      ["KMnO4", "FeSO4"], ["K2Cr2O7", "FeSO4"], ["KMnO4", "H2C2O4"], ["K2Cr2O7", "C2H5OH"],
      ["K2Cr2O7", "CH3CHO"], ["K2Cr2O7", "C3H7OH"], ["HNO3_dil", "Cu"], ["HNO3_conc", "Cu"]];
    for (const [a, b] of viaReagent) {
      const r = matchRedox(a, b, "acid");
      assert(r.verdict === "reacts", a + "×" + b + ": 試薬経由で reacts にならない: " + r.reasonCode);
    }
    // 収録ステージへの橋は対応表を持たず走査で引く。同じ組で複数あるものは複数返る
    assert(stagesForHalves("iodoform_ox", "I2_red").length === 2, "ri1/ri2 が2件返らない");
    assert(stagesForHalves("Zn_ox", "Cu_red").map((s) => s.id).join() === "r1", "r1 が引けない");
  });

  t("M6 全ペア総なめ: 3値のいずれかで、reacts 以外には理由コードと説明文がある", () => {
    const oxs = REAGENTS.filter((r) => r.side === "ox");
    const reds = REAGENTS.filter((r) => r.side === "red");
    assert(oxs.length > 0 && reds.length > 0, "試薬が片側しかない");
    const tally = { reacts: 0, "no-reaction": 0, undecided: 0 };
    for (const a of oxs) {
      for (const b of reds) {
        const tag = a.id + "×" + b.id;
        let r;
        try { r = matchRedox(a.id, b.id, "acid"); }
        catch (e) { throw new Error(tag + ": matchRedox が例外を投げた: " + e); }
        assert(tally[r.verdict] !== undefined, tag + ": verdict が3値の外: " + r.verdict);
        tally[r.verdict]++;
        assert(typeof r.message === "string" && r.message.length > 0, tag + ": 説明文が空");
        // 順位の数値（180・170…）は画面に出さない約束。説明文に漏らしていないこと
        for (const rank of new Set(Object.values(REDOX_LADDER_ACID))) {
          assert(!r.message.includes(String(rank)), tag + ": 説明文に順位の数値 " + rank + " が漏れている");
        }
        if (r.verdict === "reacts") {
          assert(r.reasonCode === null || r.reasonCode === undefined, tag + ": reacts なのに理由コードがある");
          assert(r.stage && r.stage.answer, tag + ": reacts なのに合成ステージが無い");
        } else {
          assert(r.reasonCode, tag + ": " + r.verdict + " なのに理由コードが無い");
          assert(r.stage === null, tag + ": 反応しないのに合成ステージがある");
        }
      }
    }
    // 3値がどれも死んでいないこと（どれかが0件なら判定が片寄っている）
    for (const k of Object.keys(tally)) assert(tally[k] > 0, k + " が1件も出ない");
  });

  t("M6 理由コード: verdict ごとに使える値が決まっている（enum の外が出ない）", () => {
    const seen = new Set();
    const check = (r, tag) => {
      if (r.verdict === "reacts") return;
      const allowed = r.verdict === "no-reaction" ? NO_REACTION_REASONS : UNDECIDED_REASONS;
      assert(allowed.includes(r.reasonCode), tag + ": " + r.verdict + " に " + r.reasonCode + " は使えない");
      seen.add(r.reasonCode);
    };
    for (const a of REAGENTS) for (const b of REAGENTS) check(matchRedox(a.id, b.id, "acid"), a.id + "×" + b.id);
    // 液性が合わないとき（M6-A では画面から選べないが、経路は生きている）
    const wc = matchRedox("KMnO4", "Zn", "basic");
    check(wc, "KMnO4×Zn(basic)");
    assert(wc.verdict === "undecided" && wc.reasonCode === "wrong-condition",
      "塩基性で wrong-condition にならない: " + JSON.stringify(wc));
    /* 「液性が足りないから**反応しない**」とは言わない（DESIGN §2-4。MnO₄⁻ は中性・塩基性でも
       酸化剤としてはたらき、生成物が MnO₂ に変わるだけ）。文面が「別の式になる」であること */
    assert(wc.message.includes("別の式"), "液性の説明が「別の式になる」になっていない");
    // 役が同じ・順位が逆・例外の3つが実際に出せること
    assert(matchRedox("KMnO4", "K2Cr2O7", "acid").reasonCode === "same-role", "両方 酸化剤で same-role が出ない");
    assert(matchRedox("Zn", "Cu", "acid").reasonCode === "same-role", "両方 還元剤で same-role が出ない");
    const rev = matchRedox("HCl_dil", "Cu", "acid");
    assert(rev.verdict === "no-reaction" && rev.reasonCode === "ladder-reversed",
      "銅×うすい塩酸が ladder-reversed にならない: " + JSON.stringify(rev));
    // 「差が小さいから」ではなく「順序が逆だから」と言う（DESIGN §2-6・採らなかった案3）
    assert(!/差|わずか|小さ/.test(rev.message), "順位差を理由にした文面になっている: " + rev.message);
    const pass = matchRedox("HNO3_conc", "Al", "acid");
    assert(pass.verdict === "no-reaction" && pass.reasonCode === "exception", "不動態が exception にならない");
    assert(pass.message.includes("止まり"), "不動態の説明が「そこで止まる」になっていない");
    /* no-rank は「梯子に無く、有機の許可リストにも無い」ときの逃げ道。
       いまの収録範囲ではその形の式が無い（＝全ペアの総なめでは出ない）ので、
       半反応式を直に渡す経路で生きていることを確かめる */
    const noRank = matchHalves("Zn_ox", "Cu_red");   // 引数の向きが逆＝呼び出し側の取り違え
    assert(noRank.verdict === "undecided" && noRank.reasonCode === "no-rank",
      "向きが逆のとき黙って入れ替えている: " + JSON.stringify(noRank));
    seen.add("no-rank");
    for (const code of [...NO_REACTION_REASONS, ...UNDECIDED_REASONS]) {
      if (code === "wrong-condition") continue;   // 上で個別に確かめた
      assert(seen.has(code), code + ": 全ペアを総なめしても1件も出ない（死んだ理由コード）");
    }
  });

  t("M6 反応すると判定したペア: 組み立てた式が原子・電荷ともつり合う", () => {
    let n = 0;
    for (const a of REAGENTS.filter((r) => r.side === "ox")) {
      for (const b of REAGENTS.filter((r) => r.side === "red")) {
        const r = matchRedox(a.id, b.id, "acid");
        if (r.verdict !== "reacts") continue;
        const st = r.stage;
        const tag = a.id + "×" + b.id;
        assert(checkRedoxMultipliers(st, st.answer[0], st.answer[1]).ok, tag + ": 倍率が最簡比でない");
        const c = combineHalves(st, st.answer[0], st.answer[1]);
        assert(![...c.left, ...c.right].some((t) => t.sp === "e-"), tag + ": e⁻ が残った");
        assert(compareSides(c.left, c.right).balanced, tag + ": 機械が組み立てた式がつり合わない");
        n++;
      }
    }
    assert(n > 30, "reacts と判定されたペアが少なすぎる: " + n);
  });

  t("M6 液性: 必要な液性が半反応式の形から導け、REAGENTS の書き方と一致する", () => {
    for (const [id, hr] of Object.entries(HALF_REACTIONS)) {
      const c = conditionOfHalf(hr);
      const hasH = hr.left.some((t) => t.sp === "H+");
      const hasOH = hr.left.some((t) => t.sp === "OH-");
      assert(c === (hasH ? "acid" : hasOH ? "basic" : "any"), id + ": 液性の導出が合わない: " + c);
    }
    assert(conditionOfHalf(HALF_REACTIONS["MnO4_red"]) === "acid", "MnO₄⁻ の式が酸性必須にならない");
    assert(conditionOfHalf(HALF_REACTIONS["Zn_ox"]) === "any", "Zn の式が液性に依らない扱いにならない");
    // 人が書いた REAGENTS.half のキーが、式から導いた液性と食い違わない
    for (const rg of REAGENTS) {
      for (const [key, halfId] of Object.entries(rg.half)) {
        const c = conditionOfHalf(HALF_REACTIONS[halfId]);
        assert(key === (c === "any" ? "any" : c),
          rg.id + ": half のキー「" + key + "」が式から導いた液性「" + c + "」と違う");
      }
    }
  });

  t("M6 REAGENTS と例外表の健全性", () => {
    const ids = new Set();
    for (const rg of REAGENTS) {
      assert(!ids.has(rg.id), rg.id + ": 試薬 id が重複");
      ids.add(rg.id);
      assert(SPECIES[rg.sp], rg.id + ": sp が SPECIES に無い: " + rg.sp);
      assert(rg.label, rg.id + ": label が無い");
      assert(rg.side === "ox" || rg.side === "red", rg.id + ": side 不正");
      assert(Object.keys(rg.half).length > 0, rg.id + ": half が空");
      for (const halfId of Object.values(rg.half)) {
        const hr = HALF_REACTIONS[halfId];
        assert(hr, rg.id + ": 半反応式が無い: " + halfId);
        /* side は kind から導けるが、**持って一致を検査する**ほうがよい
           （酸化剤の欄に還元剤を並べる書き間違いが機械で止まる）。
           side:"ox"＝酸化剤 なので、その半反応式は kind:"reduction" になる */
        assert(hr.kind === (rg.side === "ox" ? "reduction" : "oxidation"),
          rg.id + ": side(" + rg.side + ") と kind(" + hr.kind + ") が対応しない");
      }
      for (const p of rg.pairsWith || []) {
        assert(HALF_REACTIONS[p], rg.id + ": pairsWith に無い半反応式: " + p);
        assert(HALF_REACTIONS[p].kind !== HALF_REACTIONS[Object.values(rg.half)[0]].kind,
          rg.id + ": pairsWith の相手が自分と同じ向き: " + p);
      }
    }
    // 同じ物質が酸化剤と還元剤の両方に出せること（この設計の見どころ）
    const h2o2 = REAGENTS.filter((r) => r.sp === "H2O2");
    assert(h2o2.length === 2 && new Set(h2o2.map((r) => r.side)).size === 2,
      "過酸化水素が両方の役で出せない");
    // 例外表: 実在の式で、**梯子では reacts になるペアだけ**が載っている（二重持ちを防ぐ）
    for (const ex of REDOX_EXCEPTIONS) {
      assert(HALF_REACTIONS[ex.oxidant] && HALF_REACTIONS[ex.reductant],
        "例外表: 実在しない半反応式: " + ex.oxidant + "/" + ex.reductant);
      assert(HALF_REACTIONS[ex.oxidant].kind === "reduction", "例外表: oxidant が還元の式でない: " + ex.oxidant);
      assert(HALF_REACTIONS[ex.reductant].kind === "oxidation", "例外表: reductant が酸化の式でない: " + ex.reductant);
      assert(ex.message && ex.message.length > 10, "例外表: 理由文が無い/短い: " + ex.oxidant);
      const rOx = rankOfHalf(ex.oxidant), rRed = rankOfHalf(ex.reductant);
      assert(rOx !== null && rRed !== null && rOx > rRed,
        "例外表: 梯子でも反応しないペアが載っている（重複）: " + ex.oxidant + "×" + ex.reductant);
    }
  });

  t("M6 追加した半反応式: I_ox・H2O2_ox が対の裏返しになっている", () => {
    // 中身の保存・Δ酸化数の一致は既存の総なめテストが自動で見る（データを足すだけで検査が増える）
    const iOx = HALF_REACTIONS["I_ox"], iRed = HALF_REACTIONS["I2_red"];
    assert(iOx && iRed && electronsOf(iOx) === 2 && electronsOf(iRed) === 2, "I の対の e⁻ が2個でない");
    assert(iOx.left.some((t) => t.sp === "I-" && t.n === 2) && iOx.right.some((t) => t.sp === "I2" && t.n === 1),
      "I_ox が 2I⁻ → I₂ ＋ 2e⁻ になっていない");
    const hOx = HALF_REACTIONS["H2O2_ox"];
    assert(hOx && electronsOf(hOx) === 2, "H2O2_ox の e⁻ が2個でない");
    assert(hOx.right.some((t) => t.sp === "O2") && hOx.right.some((t) => t.sp === "H+" && t.n === 2),
      "H2O2_ox が H₂O₂ → O₂ ＋ 2H⁺ ＋ 2e⁻ になっていない");
    // 過酸化水素の還元剤側は、相手が自分より強い酸化剤のときだけ（KNOWLEDGE_CAVEATS H-3）
    assert(matchRedox("KMnO4", "H2O2_asReductant", "acid").verdict === "reacts", "KMnO₄ × H₂O₂ が反応しない");
    assert(matchRedox("O3", "H2O2_asReductant", "acid").verdict === "reacts", "O₃ × H₂O₂ が反応しない");
    assert(matchRedox("H2O2_asOxidant", "KI", "acid").verdict === "reacts", "H₂O₂ × KI が反応しない");
    assert(matchRedox("I2", "H2O2_asReductant", "acid").reasonCode === "ladder-reversed",
      "I₂ × H₂O₂(還元剤として) が順位逆にならない");
  });

  t("M6 イオン化傾向: 梯子から金属の対だけを抜くと並びが完全に一致する", () => {
    /* DESIGN §9-2 の A案は「**下半分は覚えているイオン化傾向そのものです**」と画面で言い切る。
       ここがずれるとアプリが嘘をつくので、順位を1つ動かしただけで落ちるように書く。
       B3 の IONIZATION_SERIES が実装されたら、そちらはこの導出を参照する（二重に持たない）。 */
    const expected = ["Mg", "Al", "Zn", "Fe", "H", "Cu", "Ag"];
    assert(IONIZATION_SERIES.join(" > ") === expected.join(" > "),
      "梯子から導いたイオン化傾向が違う: " + IONIZATION_SERIES.join(" > "));
    // 金属でない対（I₂/I⁻・O₂/H₂O・MnO₄⁻/Mn²⁺ など）が混ざらない
    assert(!IONIZATION_SERIES.includes("I") && !IONIZATION_SERIES.includes("O") &&
           !IONIZATION_SERIES.includes("Mn") && !IONIZATION_SERIES.includes("Cr") &&
           !IONIZATION_SERIES.includes("N"), "金属以外が混ざった: " + IONIZATION_SERIES.join(","));
    // H はイオン化傾向の「境目」なので必ず入る（Cu より前、Fe より後）
    const at = (el) => IONIZATION_SERIES.indexOf(el);
    assert(at("Fe") < at("H") && at("H") < at("Cu"), "H の位置が Fe と Cu の間でない");
    // 順位を1つ動かすと落ちること（この検査が効いていることの検査）
    const moved = Object.assign({}, REDOX_LADDER_ACID, { "Zn^2+/Zn": 95 });
    const order = Object.entries(moved)
      .filter(([c]) => ["Mg^2+/Mg", "Al^3+/Al", "Zn^2+/Zn", "Fe^2+/Fe", "H+/H2", "Cu^2+/Cu", "Ag+/Ag"].includes(c))
      .sort((a, b) => a[1] - b[1]).map(([c]) => coupleParts(c).red);
    assert(order.join() !== ["Mg", "Al", "Zn", "Fe", "H2", "Cu", "Ag"].join(),
      "順位を動かしても並びが変わらない（検査が効いていない）");
  });

  t("アプリ横断の突き合わせ: 反応式を正準化して ratio の問題と対応づけられる", () => {
    // 並び順に依存せず、係数は最簡整数比にそろえてから比べる
    const a = canonicalEquation(["HCl", "NaOH"], ["NaCl", "H2O"], [1, 1, 1, 1]);
    const b = canonicalEquation(["NaOH", "HCl"], ["H2O", "NaCl"], [2, 2, 2, 2]);
    assert(a === b, "並び順や倍率で正準形が変わる: " + a + " / " + b);
    assert(canonicalEquation(["H2", "O2"], ["H2O"], [2, 1, 2]) !==
           canonicalEquation(["H2", "O2"], ["H2O"], [1, 1, 1]), "係数の比の違いを取り違える");
    // 対応表: 同じ式の問題が複数あるときは最初のものを採る
    const ratio = [
      { id: "x1", eq: [{ sub: "H2", coef: 2 }, { sub: "O2", coef: 1 }, { sub: "H2O", coef: 2, product: true }] },
      { id: "x2", eq: [{ sub: "H2", coef: 2 }, { sub: "O2", coef: 1 }, { sub: "H2O", coef: 2, product: true }] },
      { id: "x3", eq: [{ sub: "N2", coef: 1 }, { sub: "H2", coef: 3 }, { sub: "NH3", coef: 2, product: true }] },
    ];
    const ion = [
      { id: "burn", reactants: ["H2", "O2"], products: ["H2O"], coeffs: [2, 1, 2] },
      { id: "none", reactants: ["HCl", "NaOH"], products: ["NaCl", "H2O"], coeffs: [1, 1, 1, 1] },
    ];
    const cross = buildCrossAppIndex(ion, ratio);
    assert(cross.burn === "x1", "同じ式の最初の問題に対応づかない: " + JSON.stringify(cross));
    assert(cross.none === undefined, "相手のない反応に対応がついた");
    // データが無いときは黙って空（隣のアプリが読めない環境でも壊れない）
    assert(Object.keys(buildCrossAppIndex(ion, null)).length === 0, "ratio 無しで空にならない");
    assert(Object.keys(buildCrossAppIndex(null, ratio)).length === 0, "ion 無しで空にならない");
    // 物質は**キーではなく組成式**で照合する。ratio のキーは括弧を落とすことがあり
    // （Al2SO43）、キーで見ると ion 側の Al2(SO4)3 と別物になって静かに対応が切れる
    const ratioAl = [{ id: "x9", eq: [
      { sub: "Al", coef: 2 }, { sub: "H2SO4", coef: 3 },
      { sub: "Al2SO43", coef: 1, product: true }, { sub: "H2", coef: 3, product: true }] }];
    const ionAl = [{ id: "al", reactants: ["Al", "H2SO4"], products: ["Al2(SO4)3", "H2"], coeffs: [2, 3, 1, 3] }];
    const subs = { Al2SO43: { formula: "Al<sub>2</sub>(SO<sub>4</sub>)<sub>3</sub>" } };
    assert(buildCrossAppIndex(ionAl, ratioAl, subs).al === "x9", "組成式で照合できていない");
    assert(buildCrossAppIndex(ionAl, ratioAl).al === undefined, "キー照合なのに対応がついた（前提の確認）");
  });

  t("科目・単元ツリー: 全ステージがどこかの単元に入り、単元の参照先が全部実在する", () => {
    const ids = new Set();
    const seen = { ion: new Set(), redox: new Set(), condition: new Set() };
    for (const sub of CURRICULUM) {
      assert(sub.subject && sub.units && sub.units.length, "科目に単元が無い: " + sub.subject);
      for (const u of sub.units) {
        assert(!ids.has(u.id), "単元IDが重複: " + u.id);
        ids.add(u.id);
        assert(u.name && u.note, u.id + ": 名前か説明が無い");
        // id 直指定はタイプミスしても黙って消えるので、実在を明示的に確かめる
        for (const id of u.redox || []) {
          assert(REDOX_STAGES.some((s) => s.id === id), u.id + ": 酸化還元ステージ " + id + " が無い");
        }
        for (const id of u.condition || []) {
          assert(CONDITION_STAGES.some((s) => s.id === id), u.id + ": 液性ステージ " + id + " が無い");
        }
        const stages = stagesOfUnit(u);
        assert(stages.length > 0, u.id + ": 属するステージが0件");
        for (const st of stages) {
          assert(seen[st.mode], u.id + ": 未知のモード " + st.mode);
          assert(st.title, u.id + ": ステージ名が空 " + st.id);
          seen[st.mode].add(st.id);
        }
      }
    }
    // 逆向き: どのステージも必ずどこかの単元から辿れる（入り口から行けないステージを作らない）
    const missing = [
      ...STAGES.filter((s) => !seen.ion.has(s.id)).map((s) => "ion:" + s.id),
      ...REDOX_STAGES.filter((s) => !seen.redox.has(s.id)).map((s) => "redox:" + s.id),
      ...CONDITION_STAGES.filter((s) => !seen.condition.has(s.id)).map((s) => "condition:" + s.id),
    ];
    assert(missing.length === 0, "単元から辿れないステージがある: " + missing.join(", "));
  });

  t("有機の酸化還元: 官能基のついた炭素1個だけが酸化され、段階が数でつながる", () => {
    // 第1級アルコールは 2段階（−1 → +1 → +3）、第2級は 1段階で止まる（0 → +2）
    const steps = [
      { id: "EtOH_ox",  from: -1, to: 1 },
      { id: "MeCHO_ox", from: 1,  to: 3 },
      { id: "iPrOH_ox", from: 0,  to: 2 },
    ];
    for (const s of steps) {
      const hr = HALF_REACTIONS[s.id];
      assert(hr, s.id + ": 半反応式が無い");
      const ch = oxChangeOfHalf(hr);
      assert(ch.length === 1 && !ch[0].ambiguous, s.id + ": 変化が1種類にまとまらない");
      assert(ch[0].el === "C" && ch[0].count === 1,
        s.id + ": 変化するのが炭素1個でない: " + JSON.stringify(ch[0]));
      assert(ch[0].from === s.from && ch[0].to === s.to,
        s.id + ": 酸化数の変化が違う: " + ch[0].from + "→" + ch[0].to);
      // e⁻ 2個ぶんで、原子も電荷も保存する
      assert(electronsOf(hr) === 2, s.id + ": e⁻ が2個でない");
      const L = tallyTerms(hr.left), R = tallyTerms(hr.right);
      assert(JSON.stringify(L.atoms) === JSON.stringify(R.atoms) && L.charge === R.charge,
        s.id + ": 原子か電荷が保存しない");
    }
    // 第1級の2段階はつながっている（①の生成物が②の反応物）
    assert(HALF_REACTIONS["EtOH_ox"].right.some((t) => t.sp === "CH3CHO") &&
           HALF_REACTIONS["MeCHO_ox"].left.some((t) => t.sp === "CH3CHO"),
      "アルデヒドで①と②がつながっていない");
    // CH₃ の炭素（−3）は最後まで動かない
    for (const sp of ["C2H5OH", "CH3CHO", "CH3COOH", "C3H7OH", "CH3COCH3"]) {
      assert(OXIDATION[sp].C.some((a) => a.ox === -3), sp + ": CH₃ の炭素(−3)が無い");
    }
    // ステージとして収録され、模範倍率でイオン反応式がつり合う
    for (const id of ["ro1", "ro2", "ro3"]) {
      const st = REDOX_STAGES.find((s) => s.id === id);
      assert(st && st.mode === "solution", id + ": ステージが無いか溶液モードでない");
      assert(checkRedoxMultipliers(st, st.answer[0], st.answer[1]).ok, id + ": 模範倍率が正解にならない");
      const c = combineHalves(st, st.answer[0], st.answer[1]);
      assert(compareSides(c.left, c.right).balanced, id + ": イオン反応式が保存しない");
      assert(st.red === "Cr2O7_red", id + ": 酸化剤が二クロム酸でない");
    }
  });

  t("ヨードホルム反応: メチル基を CH₃⁺ に切り離すと半反応式になり、I₂ 3個で教科書と一致する", () => {
    // 切り離した CH₃⁺ の炭素は −2（分子の中では −3。C–C の電子対を置いていくぶん1つ上がる）
    assert(OXIDATION["CH3+"].C === -2, "CH₃⁺ の炭素が −2 でない: " + OXIDATION["CH3+"].C);
    assert(oxSum("CH3+") === 1, "CH₃⁺ の酸化数の合計が電荷と合わない");
    // 酸化の半反応式: 変化するのは炭素1個だけ（−2 → +2）、e⁻ は4個
    const ox = HALF_REACTIONS["iodoform_ox"];
    const ch = oxChangeOfHalf(ox);
    assert(ch.length === 1 && !ch[0].ambiguous, "変化が1種類にまとまらない: " + JSON.stringify(ch));
    assert(ch[0].el === "C" && ch[0].count === 1 && ch[0].from === -2 && ch[0].to === 2,
      "炭素の変化が −2→+2 の1個でない: " + JSON.stringify(ch[0]));
    assert(electronsOf(ox) === 4, "e⁻ が4個でない: " + electronsOf(ox));
    // ヨウ素は二役。酸化の側は I⁻ で受けるので、酸化半反応式の中では I の酸化数は動かない
    assert(ox.left.some((t) => t.sp === "I-"), "酸化の側のヨウ素源が I⁻ でない");
    assert(!ch.some((c) => c.el === "I"), "酸化の半反応式の中で I が変化している");
    for (const [id, sp] of [["ri1", "CH3COCH3"], ["ri2", "CH3CHO"]]) {
      const st = REDOX_STAGES.find((s) => s.id === id);
      assert(st && st.ox === "iodoform_ox", id + ": 切り出したあとの半反応式が共通でない");
      assert(String(st.answer) === "1,2", id + ": 模範倍率が 1:2 でない（I₂ 2個）: " + st.answer);
      assert(checkRedoxMultipliers(st, 1, 2).ok, id + ": 模範倍率が正解にならない");
      const c = combineHalves(st, 1, 2);
      assert(compareSides(c.left, c.right).balanced, id + ": イオン反応式が保存しない");
      // 足し合わせで I⁻（媒介役）が打ち消える
      assert((c.left.find((t) => t.sp === "I-") || { n: 0 }).n === 0, id + ": 左辺に I⁻ が残った");
      // 切断の段: 酸化還元ではない（正味0）が、原子と電荷は保存する
      const cv = IODOFORM_CLEAVAGE[st.cleavage];
      assert(cv && cv.left[0].sp === sp, id + ": 切断のもとの物質が違う");
      const r = checkCleavage(cv);
      assert(r.balanced, id + ": 切断で原子か電荷が保存しない");
      assert(!r.redox && r.net === 0, id + ": 切断が酸化還元になっている（正味 " + r.net + "）");
      assert(cv.right.some((t) => t.sp === "CH3+"), id + ": 切断で CH₃⁺ が出ない");
      // 残った断片の酸化を足すと e⁻ 6個 ＝ I₂ 3個 ＝ 教科書の全体式と同じ本数になる
      const rest = HALF_REACTIONS[cv.rest];
      assert(rest && electronsOf(rest) === 2, id + ": 残った断片の酸化が e⁻ 2個でない");
      const total = electronsOf(ox) + electronsOf(rest);
      assert(total === 6, id + ": 合計 e⁻ が6個でない: " + total);
      assert(cv.overall && cv.overall.includes("3I₂"), id + ": 全体式に 3I₂ が出てこない: " + cv.overall);
      // 残った断片の酸化も、炭素1個だけが +2 上がる
      const rc = oxChangeOfHalf(rest);
      assert(rc.length === 1 && rc[0].el === "C" && rc[0].count === 1 && rc[0].to - rc[0].from === 2,
        id + ": 残った断片の変化が炭素1個の +2 でない: " + JSON.stringify(rc));
    }
    // 切り出したあとは、アセトンでもアセトアルデヒドでも同じ半反応式1本
    assert(REDOX_STAGES.find((s) => s.id === "ri1").ox === REDOX_STAGES.find((s) => s.id === "ri2").ox,
      "切り出したあとの半反応式が共通になっていない");
    // **便宜的な見方だというただし書き**が用意されていること（画面に必ず出す前提）
    assert(IODOFORM_CAVEAT && IODOFORM_CAVEAT.head.includes("実際の反応機構とは異なります"),
      "ただし書きの見出しが無い");
    assert(IODOFORM_CAVEAT.body.includes("CI₃⁻"), "ただし書きに実際に外れる CI₃⁻ が出てこない");
    assert(IODOFORM_CAVEAT.body.includes("便宜的"), "便宜的な見方だと書いていない");
    assert(IODOFORM_CAVEAT.body.includes("係数"), "係数は一致することを書いていない");
  });

  t("液性の書き換え: 両辺に OH⁻ を足して塩基性の式が導け、原子と電荷が保存する", () => {
    for (const st of CONDITION_STAGES) {
      const hr = HALF_REACTIONS[st.half];
      assert(hr, st.id + ": 半反応式が無い");
      const key = (terms) => terms.map((t) => t.sp + ":" + t.n).sort().join(",");
      // 足す前は H⁺ が残っているので未完成
      const zero = toBasicHalf(hr, 0);
      assert(!zero.ok && zero.need === st.answerOH, st.id + ": 必要な OH⁻ の数が違う: " + zero.need);
      assert(zero.reason.includes("残っている"), st.id + ": 不足の助言が出ない");
      // ちょうど足すと、登録してある塩基性の式に一致する
      const done = toBasicHalf(hr, st.answerOH);
      assert(done.ok, st.id + ": 必要数を足しても完成しない: " + done.reason);
      assert(key(done.left) === key(st.basic.left) && key(done.right) === key(st.basic.right),
        st.id + ": 導いた式が登録と違う: " + key(done.left) + " → " + key(done.right));
      // 導いた式が原子・電荷ともに保存している（H⁺ も残っていない）
      const cmp = compareSides(done.left, done.right);
      assert(cmp.balanced, st.id + ": 塩基性の式が保存しない");
      assert(!done.left.concat(done.right).some((t) => t.sp === "H+"), st.id + ": H⁺ が残った");
      // 足しすぎると OH⁻ が両辺に残る
      const over = toBasicHalf(hr, st.answerOH + 1);
      assert(!over.ok && over.reason.includes("多い"), st.id + ": 足しすぎを通した");
      assert(over.left.some((t) => t.sp === "OH-") && over.right.some((t) => t.sp === "OH-"),
        st.id + ": あまった OH⁻ が両辺に残らない");
      // 酸性の式も塩基性の式も、e⁻ の数は変わらない（書き換えただけ）
      assert(electronsOf(hr) === (done.left.concat(done.right).find((t) => t.sp === "e-") || { n: 0 }).n,
        st.id + ": 書き換えで e⁻ の数が変わった");
    }
    // MnO₄⁻ の塩基性形のように e⁻ の数まで変わるものは、この操作では導けない（扱わない）
    assert(CONDITION_STAGES.every((st) => st.half !== "MnO4_red"), "この操作で導けない反応が混ざっている");
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

  await t("UI: 本質の1行 - 燃焼は「原子の組み替え」・s8 は結びなし・通常は傍観イオンに触れる（S-6）", async () => {
    const netion = () => doc.getElementById("netion");
    const solve = (i) => {
      stageBtn(i).click();
      eqOf(STAGES[i]).answer.forEach((v, k) => setCoeff(k, v));
      assert(!netion().hidden, STAGES[i].id + ": 正解なのに本質の行が出ない");
      return netion().textContent;
    };
    // 燃焼4ステージ: イオンが出ないので「イオン反応式」「傍観イオン」と言わない
    for (let i = 0; i < STAGES.length; i++) {
      if (STAGES[i].phase !== "gas") continue;
      const txt = solve(i);
      assert(txt.includes("原子の組み替え"), STAGES[i].id + ": 見出しが「原子の組み替え」でない: " + txt);
      assert(!txt.includes("イオン反応式"), STAGES[i].id + ": 分子反応なのに「イオン反応式」と言う: " + txt);
      assert(!txt.includes("傍観イオン"), STAGES[i].id + ": イオンが出ないのに「傍観イオン」と言う: " + txt);
    }
    // 「イオンは出ない」と書くステージが実在すること（h2 の燃焼。上の検査が空回りしない担保）
    assert(STAGES.some((s) => s.phase === "gas" && s.netIon.includes("イオンは出ない")),
      "「イオンは出ない」の文言を持つ燃焼ステージが無くなった");
    // s8: 傍観イオンが1つも残らないので「ほかのイオンは傍観イオン」の結びを出さない
    const s8 = STAGES.findIndex((s) => s.id === "s8");
    assert(STAGES[s8].noSpectator, "s8 に noSpectator フラグが無い");
    const t8 = solve(s8);
    assert(t8.includes("イオン反応式"), "s8: 見出しはイオン反応式のはず: " + t8);
    assert(!t8.includes("傍観イオン"), "s8: 傍観イオンが残らないのに結びが付く: " + t8);
    // 通常のステージ（s1）は従来どおり結びが付く
    const t1 = solve(0);
    assert(t1.includes("イオン反応式") && t1.includes("— ほかのイオンは傍観イオン"),
      "s1: 従来の見出しと結びが出ない: " + t1);
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
      assert(g && g.includes("🎯"), STAGES[i].id + ": 目標バナーが無い: " + g);
    }
    assert(goalOf(0).includes("中和") && goalOf(0).includes("NaCl"), "s1 は中和して NaCl のはず: " + goalOf(0));
    assert(goalOf(3).includes("沈殿") && goalOf(3).includes("AgCl"), "s4 は沈殿 AgCl のはず: " + goalOf(3));
    assert(goalOf(5).includes("気体") && goalOf(5).includes("CO₂"), "s6 は気体 CO₂ のはず: " + goalOf(5));
    const s11 = STAGES.findIndex((st) => st.id === "s11");
    assert(goalOf(s11).includes("酸性塩") && goalOf(s11).includes("NaHSO₄"), "s11 は酸性塩 NaHSO₄ のはず: " + goalOf(s11));
    assert(doc.querySelector("#stageTitle .goal.acid"), "酸性塩ステージの目標が acid スタイルでない");
  });

  await t("UI: 見出しは既定でたたまれ、閉じたままでも目標が読める（縦の圧迫を戻さない）", async () => {
    stageBtn(0).click();
    const head = doc.querySelector("#stageTitle .stageHead");
    assert(head, "ステージ見出しが details になっていない");
    assert(!head.open, "見出しが既定で開いている（初見の画面を説明で埋めない）");
    // 閉じた状態で見えているのは summary の中身だけ＝目標がそこに無いと「何をするか」が分からない
    const sum = head.querySelector("summary");
    assert(sum && sum.querySelector(".goal"), "閉じた状態で目標が見えない");
    assert(!sum.contains(doc.querySelector("#stageTitle .stageName")), "ステージ名が summary に残っている（1行に収まらない）");
    // 開けばステージ名と単元札まで読める（畳んだのは隠したのではなく、たたんだのだと分かること）
    head.open = true;
    assert(doc.querySelector("#stageTitle .stageName").textContent.includes(STAGES[0].title),
      "開いてもステージ名が出ない");
    // 開閉はステージを移っても引き継ぐ（毎回たたみ直されると読む人の邪魔になる）。
    // details の toggle は**非同期**に飛ぶので、1タスク待ってから移る
    const tick = () => new Promise((r) => setTimeout(r, 30));
    await tick();
    stageBtn(1).click();
    assert(doc.querySelector("#stageTitle .stageHead").open, "ステージを移ると開閉が戻ってしまう");
    doc.querySelector("#stageTitle .stageHead").open = false;
    await tick();
    stageBtn(0).click();
    assert(!doc.querySelector("#stageTitle .stageHead").open, "閉じ直したのに開いて戻る");
  });

  await t("UI: 判定メッセージが成功・過不足・案内で色分けされる（色だけに頼らない）", async () => {
    const cls = (id) => doc.getElementById(id).className;
    const mark = (id) => win.getComputedStyle(doc.getElementById(id), "::before").content;
    const txt = (id) => doc.getElementById(id).textContent;
    stageBtn(0).click();
    // まだ何も判定していない ＝ 案内
    assert(/\binfo\b/.test(cls("msg")), "ステージの案内が info でない: " + cls("msg"));
    assert(/\binfo\b/.test(cls("eqMsg")), "係数の案内が info でない: " + cls("eqMsg"));
    // 過不足（HCl 2個 : NaOH 1個）＝ 失敗
    addBtn(0).click(); addBtn(0).click(); addBtn(1).click();
    adv(4000); reactBtn().click(); adv(12000);
    assert(/\bng\b/.test(cls("msg")), "余りが出たのに ng でない: " + cls("msg") + " / " + txt("msg"));
    // つり合わない係数 ＝ 失敗、そろった係数 ＝ 成功
    // （模式図は係数を見るので、ここまでは案内のまま。係数を入れてから見る）
    setCoeff(0, 2); setCoeff(1, 1); setCoeff(2, 1); setCoeff(3, 1);
    assert(/\bng\b/.test(cls("eqMsg")), "つり合わないのに ng でない: " + cls("eqMsg") + " / " + txt("eqMsg"));
    assert(/\bng\b/.test(cls("schematicMsg")), "模式図の過不足が ng でない: " + cls("schematicMsg") + " / " + txt("schematicMsg"));
    eqOf(STAGES[0]).answer.forEach((v, k) => setCoeff(k, v));
    assert(/\bok\b/.test(cls("eqMsg")), "つり合ったのに ok でない: " + cls("eqMsg") + " / " + txt("eqMsg"));
    // ちょうど反応しきった ＝ 成功
    stageBtn(0).click();
    addBtn(0).click(); addBtn(1).click();
    adv(4000); reactBtn().click(); adv(12000);
    assert(/\bok\b/.test(cls("msg")), "ちょうど反応しきったのに ok でない: " + cls("msg") + " / " + txt("msg"));
    // **色だけに頼らない**: 記号が消えていないこと（CSS を色だけに戻したらここで落ちる）
    assert(/[✓✗💡]/.test(mark("msg")), "成功・失敗の記号が出ていない: " + mark("msg"));
    stageBtn(0).click();
    assert(/[✓✗💡]/.test(mark("eqMsg")), "係数メッセージの記号が出ていない: " + mark("eqMsg"));
  });

  await t("UI: 遊び方は既定でたたまれ、開閉は覚える（初見の画面を説明で埋めない）", async () => {
    // 既定は **HTML の側**で決まる（app.js は覚えた設定を上書きするだけ）ので、素の属性を見る
    const html = await (await fetch("index.html", { cache: "no-store" })).text();
    const tag = (html.match(/<details[^>]*id="howto"[^>]*>/) || [])[0];
    assert(tag, "遊び方パネル（#howto）が見つからない");
    assert(!/\sopen[\s>]/.test(tag), "遊び方が既定で開いている: " + tag);
    const howto = doc.getElementById("howto");
    assert(howto, "iframe 側に #howto が無い");
    // 開発者の環境に「開く」が残っていることがあるので、そのときだけ DOM の判定を飛ばす
    if (localStorage.getItem("ioneq_howto") !== "open") assert(!howto.open, "読み込み直後に開いている");
    // 既定を閉じにしても、開閉を覚える仕組み（ioneq_howto）は壊さない。
    // 検査で学習者の設定を書き換えてしまわないよう、控えを取って必ず戻す
    const saved = localStorage.getItem("ioneq_howto");
    const tick2 = () => new Promise((r) => setTimeout(r, 30));
    try {
      howto.open = true; await tick2();
      assert(localStorage.getItem("ioneq_howto") === "open", "開いたことを覚えない");
      howto.open = false; await tick2();
      assert(localStorage.getItem("ioneq_howto") === "closed", "閉じたことを覚えない");
    } finally {
      if (saved === null) localStorage.removeItem("ioneq_howto");
      else localStorage.setItem("ioneq_howto", saved);
    }
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

  /* ---- ヘッダーの圧縮（docs/review_others.md 項目3） ----
     ステージの丸は index で30個あり、折り返して並べると 375px 幅ではそれだけで5段・200px、
     ヘッダー全体で画面の40%（実測 324px）を占めてビーカーが下へ押し出されていた。
     段が戻る（＝帯がまた折り返す）と静かに元に戻ってしまうので、実寸で見張る。
     テストページの iframe は 960px 固定なので、ここでは幅を指定した専用の iframe を建てる。 */
  /* 幅を指定して開くが、**実際に効いた幅は win.innerWidth で確かめてから使う**。
     スマホ実機やモバイルエミュレーション下では `width=device-width` が優先され、
     iframe を 1280px にしても中の画面幅は端末幅のままになる。ここで幅を決め打ちすると
     「開発機では通り、実機を模した環境では落ちる」テストになってしまう。 */
  const openAt = async (page, width, height) => {
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;left:-9999px;top:0;border:0;width:" + width + "px;height:" + (height || 812) + "px";
    f.src = page + "?probe=" + Date.now();
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; });
    for (let i = 0; i < 60 && !(f.contentWindow && f.contentWindow.IonHeader); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return {
      win: f.contentWindow, doc: f.contentDocument,
      w: f.contentWindow.innerWidth, h: f.contentWindow.innerHeight,
      cleanup: () => f.remove(),
    };
  };

  await t("HEADER: ヘッダーの帯が折り返さず、ページも横に伸びない（全5ページ）", async () => {
    for (const page of ["index.html", "redox.html", "condition.html", "library.html", "portal.html"]) {
      const p = await openAt(page, 375);
      assert(p.win.IonHeader, page + ": header-ui.js が読まれていない");
      const st = p.win.IonHeader.state();
      // 実測の上限。スマホ幅では画面（812px）の2割強、PC 幅では現状（index の133px）を上限にする
      const limit = p.w <= 560 ? 170 : 140;
      assert(st.headerHeight <= limit,
        page + ": 幅" + p.w + "px でヘッダーが高すぎる（" + st.headerHeight + "px／上限 " + limit + "px）");
      for (const b of st.bars) {
        assert(b.rows === 1, page + ": 幅" + p.w + "px で帯 " + b.id + " が " + b.rows + " 段に折り返している");
      }
      // はみ出しは帯の中だけで受け止める。ページ自体が横に伸びてはいけない
      assert(p.doc.documentElement.scrollWidth <= p.w + 1,
        page + ": ページが横にはみ出している（" + p.doc.documentElement.scrollWidth + " > " + p.w + "）");
      p.cleanup();
    }
  });

  await t("HEADER: 続きがある側だけに印が出て、開いたステージは必ず帯の中に見えている", async () => {
    const p = await openAt("index.html", 375);
    const nav = p.doc.getElementById("stageNav");
    const visible = () => {
      const b = nav.querySelector("button.active");
      const r1 = b.getBoundingClientRect(), r2 = nav.getBoundingClientRect();
      return r1.left >= r2.left - 1 && r1.right <= r2.right + 1;
    };
    let st = p.win.IonHeader.state();
    const narrow = st.bars[0].overflowing; // 30個が入りきらない幅かどうか
    if (narrow) {
      assert(st.bars[0].moreRight && !st.bars[0].moreLeft, "先頭なのに『右に続く』の印が出ていない");
      assert(st.stage.count === "1/30", "全体で何個あるかが示されていない: " + st.stage.count);
    } else {
      assert(!st.bars[0].moreRight && !st.bars[0].moreLeft, "全部見えているのに続きの印が出ている");
      assert(st.stage.count === "", "全部見えているなら「n/30」は要らない: " + st.stage.count);
    }
    // 帯の外にいるステージ20を開く（buildStageNav の作り直しに MutationObserver が追従する）
    nav.children[19].click();
    await new Promise((r) => setTimeout(r, 120));
    assert(visible(), "開いたステージが帯の外にいる（帯を中央へ寄せていない）");
    st = p.win.IonHeader.state();
    if (narrow) {
      assert(st.stage.count === "20/30", "いま何番めかが追従していない: " + st.stage.count);
      assert(st.bars[0].moreLeft && st.bars[0].moreRight, "中ほどなのに両側の印が出ていない");
    }
    p.cleanup();
  });

  /* ---- 横持ちのヘッダー（docs/REVIEW_layout_devices.md 論点B） ----
     縦持ちだけを見て詰めてきたので、横向きは縦と同じ3段（題名／ステージの帯／モードの帯）が
     高さ 320px の画面に乗り、ヘッダーだけで 43%（136px）を占めていた。
     style.css の `(orientation:landscape) and (max-height:500px)` で1段に畳んで 42px にしたが、
     **段が戻れば静かに元に戻る**種類の修正なので、いちばん条件の厳しい 568×320（iPhone SE 横）
     と 750×342（iPhone 13 横）を実寸で見張る。

     メディアクエリは iframe 自身のビューポートで判定されるので、iframe を横長・低くすれば
     端末エミュレーションなしでもこの分岐に入れる。ただし実機やモバイルエミュレーション下では
     `width=device-width` が優先されて指定した形にならないことがあるため、
     **本当に横長・低くなったときだけ**測る（そうでない環境では黙って見送る）。 */
  await t("HEADER: 横持ち（568×320・750×342）でヘッダーが画面の25%を超えない（全5ページ）", async () => {
    const pages = ["index.html", "redox.html", "condition.html", "library.html", "portal.html"];
    let checked = 0;
    for (const [w, h] of [[568, 320], [750, 342]]) {
      for (const page of pages) {
        const p = await openAt(page, w, h);
        // 指定した形にならなかった環境（実機・モバイルエミュレーション）では測らない
        if (!(p.w > p.h && p.h <= 500)) { p.cleanup(); continue; }
        checked++;
        const st = p.win.IonHeader.state();
        const limit = Math.floor(p.h * 0.25);
        assert(st.headerHeight <= limit,
          page + ": " + p.w + "×" + p.h + " でヘッダーが画面の " +
          Math.round(st.headerHeight / p.h * 100) + "%（" + st.headerHeight + "px／上限 " + limit + "px）");
        for (const b of st.bars) {
          assert(b.rows === 1, page + ": " + p.w + "×" + p.h + " で帯 " + b.id + " が " + b.rows + " 段に折り返している");
        }
        assert(p.doc.documentElement.scrollWidth <= p.w + 1,
          page + ": " + p.w + "×" + p.h + " でページが横にはみ出している（" +
          p.doc.documentElement.scrollWidth + " > " + p.w + "）");
        p.cleanup();
      }
    }
    // 全部見送られたなら、このテストは何も守れていない。それが分かるようにしておく
    assert(checked > 0, "iframe が横長・低い形にならず、横持ちの検査が1件も走らなかった");
  });

  /* ---- 狭い縦持ちのヘッダー（v128） ----
     横持ちを 42px に畳んだあと、**縦持ちのいちばん狭い幅**が残っていた。
     320px では h1 の中のモード名の札が題名の行に収まらずに折り返し、それだけで1段（22px）増えて
     condition / redox が 142px（画面の25%）＝ 札を持たない index の 120px より厚い、という逆転が起きていた。
     style.css の `(max-width:500px) and (orientation:portrait)` で札を短い呼び名に差し替えて 116px にしたが、
     これも**札の文言が伸びれば静かに元に戻る**種類の修正なので、320×568（iPhone SE 縦）で実寸を見張る。

     測るのは高さだけでなく **h1 が1行に収まっていること**も。高さの上限だけだと、
     他の段が縮んだぶんで札の折り返しが埋め合わされて通ってしまう。
     横持ちの検査と同じく、iframe が本当にその形になったときだけ測る。 */
  await t("HEADER: 狭い縦持ち（320×568）でヘッダーが 120px を超えず、題名の行が折り返さない（全5ページ）", async () => {
    const pages = ["index.html", "redox.html", "condition.html", "library.html", "portal.html"];
    let checked = 0;
    for (const page of pages) {
      const p = await openAt(page, 320, 568);
      // 指定した形にならなかった環境（実機・モバイルエミュレーション）では測らない
      if (!(p.w <= 500 && p.h > p.w)) { p.cleanup(); continue; }
      checked++;
      const st = p.win.IonHeader.state();
      assert(st.headerHeight <= 120,
        page + ": " + p.w + "×" + p.h + " でヘッダーが高すぎる（" + st.headerHeight + "px／上限 120px）");
      const h1 = p.doc.querySelector("header h1");
      const line = parseFloat(p.win.getComputedStyle(h1).fontSize) * 1.6; // 1行ぶんの余裕を見た上限
      assert(h1.getBoundingClientRect().height <= line,
        page + ": " + p.w + "px で題名の行が折り返している（h1 が " +
        Math.round(h1.getBoundingClientRect().height) + "px／1行なら " + Math.round(line) + "px 以内）");
      // 短い呼び名は見た目だけの差し替え。**元の全文は DOM に残す**（読み上げのため）
      const tag = h1.querySelector(".modeTag[data-short]");
      if (tag) {
        assert(tag.textContent.trim().length > tag.dataset.short.length,
          page + ": 短い呼び名で置き換えるだけのはずが、札の全文が DOM から消えている");
        assert(p.win.getComputedStyle(tag, "::after").content.indexOf(tag.dataset.short) >= 0,
          page + ": 狭い縦持ちなのに短い呼び名が出ていない（" +
          p.win.getComputedStyle(tag, "::after").content + "）");
      }
      assert(p.doc.documentElement.scrollWidth <= p.w + 1,
        page + ": " + p.w + "×" + p.h + " でページが横にはみ出している（" +
        p.doc.documentElement.scrollWidth + " > " + p.w + "）");
      p.cleanup();
    }
    assert(checked > 0, "iframe が狭い縦持ちの形にならず、検査が1件も走らなかった");
  });

  /* ---- 押せるものの大きさ（docs/REVIEW_layout_devices.md 論点C） ----
     Apple の指針は 44pt・Google は 48dp。32px はその手前の最低ラインで、
     そこにも届いていないものが ion だけで 300 件近くあった（.modeLink 25px・
     .stageChip 28px・.rxnLink 19px …）。tools/check-mobile.mjs と同じ物差しで、
     ここでも見張る（あちらは無人実行、こちらはコミット前の門番）。

     数え方も check-mobile.mjs に合わせる:
     **本文中のリンク（display:inline の a）は数えない**。行の一部であって押しボタンではなく、
     ここを拾うと警告が数百件になって使い物にならない。 */
  await t("TAP: 押せるものが 32px 未満にならない（全5ページ・幅375px）", async () => {
    for (const page of ["index.html", "redox.html", "condition.html", "library.html", "portal.html"]) {
      const p = await openAt(page, 375);
      /* 反応インデックスは reactions.json を読んでから行を組み立てる。
         待たずに測ると「ヘッダーの5個だけ数えて合格」になり、**いちばん件数の多かった
         .rxnLink / .rxnPlay を1つも見ない**空振りのテストになる（実際に一度そうなった）。 */
      if (page === "library.html") {
        for (let i = 0; i < 80 && !p.doc.querySelector(".rxnRow"); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        assert(p.doc.querySelector(".rxnRow"), "library.html: 反応の行が組み上がらないまま測ろうとした");
      }
      const bad = [];
      p.doc.querySelectorAll("button, input, select, summary, a").forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const cs = p.win.getComputedStyle(e);
        if (cs.visibility === "hidden") return;
        if (e.tagName === "A" && cs.display === "inline") return;
        if (r.height < 32 || r.width < 24) {
          bad.push((e.id ? "#" + e.id : e.tagName +
            (typeof e.className === "string" && e.className ? "." + e.className.split(" ")[0] : "")) +
            " " + Math.round(r.width) + "×" + Math.round(r.height));
        }
      });
      assert(!bad.length, page + ": 32px に届かない標的が " + bad.length + " 件 — " +
        [...new Set(bad)].slice(0, 8).join(" / "));
      p.cleanup();
    }
  });

  /* ---- ステージ一覧のシート（v146） ----
     ヘッダーの帯に出ているのは番号（1・2・3 … 14）だけで、**押す前にどの反応へ跳ぶのかが
     見えない**。目的の反応にたどり着くには総当たりになる、という指摘があった
     （docs/PLAN_stage_nav_and_combinatorial_matching.md フェーズ1）。
     番号の title 属性には名前が入っているが、**ホバーは指では出ない**ので、
     タッチ端末では情報がまったく無い状態だった。

     解決策として**ヘッダーに段を足すことはできない**（狭い縦持ちで 120px 以下という
     既存の制約。実測 116px で、1段足すと盤面が削られる）。そこで
     「閉じているあいだ高さを持たないシート」＋「帯と同じ行に置く釦1つ」にした。
     ここで見張るのは、その約束が崩れていないこと:
       ・一覧を開いてもヘッダーの高さが 1px も変わらない
       ・行き先の名前が全ステージぶん出る（番号だけの行が無い）
       ・押せば実際にそのステージが開く ＝ ホバーに頼らず指だけで完結する
     ヘッダーを太らせる修正が入れば1つめが、名前を落とす修正が入れば2つめが落ちる。 */
  await t("STAGELIST: 一覧を開いてもヘッダーは太らず、行き先の名前が全ステージぶん出る（320×568）", async () => {
    let checked = 0;
    for (const page of ["index.html", "redox.html", "condition.html"]) {
      const p = await openAt(page, 320, 568);
      // 指定した形にならなかった環境（実機・モバイルエミュレーション）では測らない
      if (!(p.w <= 500 && p.h > p.w)) { p.cleanup(); continue; }
      checked++;
      const btn = p.doc.getElementById("stageListBtn");
      assert(btn, page + ": ステージ一覧をひらく釦が無い");
      const before = p.win.IonHeader.state().headerHeight;
      btn.click();
      await new Promise((r) => setTimeout(r, 80));
      const st = p.win.IonHeader.state();
      assert(st.sheet && st.sheet.open, page + ": 釦を押しても一覧が開かない");
      assert(st.headerHeight === before,
        page + ": 一覧を開いたらヘッダーが太った（" + before + "px → " + st.headerHeight + "px）");
      assert(st.sheet.rows === st.bars[0].items,
        page + ": 一覧の行数（" + st.sheet.rows + "）が帯のステージ数（" + st.bars[0].items + "）と違う");
      const nameless = st.sheet.labels.filter((s) => !s.trim() || /^\d+$/.test(s.trim()));
      assert(!nameless.length,
        page + ": 名前ではなく番号だけの行がある（" + nameless.length + "件）— 一覧の意味が無い");
      assert(st.sheet.active === st.stage.active,
        page + ": いま開いているステージが一覧で示されていない（" +
        st.sheet.active + " / 帯は " + st.stage.active + "）");
      // 一覧そのものも「押せるもの」なので 32px の床を守る
      const small = [...p.doc.querySelectorAll("#stageListBtn, .sheetRow, .sheetClose")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.height < 32 || r.width < 24;
        });
      assert(!small.length, page + ": 一覧まわりに 32px に届かない標的が " + small.length + " 件");
      assert(p.doc.documentElement.scrollWidth <= p.w + 1,
        page + ": 一覧を開いたらページが横にはみ出した（" +
        p.doc.documentElement.scrollWidth + " > " + p.w + "）");
      p.cleanup();
    }
    assert(checked > 0, "iframe が狭い縦持ちの形にならず、一覧の検査が1件も走らなかった");
  });

  await t("STAGELIST: 一覧の行を押すとそのステージが開き、Esc と背景で閉じられる", async () => {
    const p = await openAt("redox.html", 375, 812);
    const btn = p.doc.getElementById("stageListBtn");
    assert(btn, "ステージ一覧をひらく釦が無い");
    btn.click();
    await new Promise((r) => setTimeout(r, 80));
    const rows = [...p.doc.querySelectorAll(".sheetRow")];
    assert(rows.length > 10, "一覧の行が足りない: " + rows.length);
    const label = rows[9].querySelector(".sheetName").textContent;
    rows[9].click();
    await new Promise((r) => setTimeout(r, 150));
    let st = p.win.IonHeader.state();
    assert(!st.sheet.open, "行を押しても一覧が閉じない");
    assert(st.stage.active === 9, "押した行のステージが開いていない（帯の active は " + st.stage.active + "）");
    const title = p.doc.getElementById("stageTitle").textContent;
    assert(title.includes(label),
      "開いたステージの題が一覧に出ていた名前と違う（一覧「" + label + "」／題「" + title + "」）");
    // 閉じ方は3つとも要る（釦・Esc・背景）。どれかだけだと行き止まりになる端末が出る
    btn.click();
    await new Promise((r) => setTimeout(r, 80));
    assert(p.win.IonHeader.state().sheet.open, "2回めが開かない");
    p.doc.dispatchEvent(new p.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    assert(!p.win.IonHeader.state().sheet.open, "Esc で閉じない");
    btn.click();
    await new Promise((r) => setTimeout(r, 80));
    p.doc.getElementById("stageSheet").click();  // シートの外（背景）
    await new Promise((r) => setTimeout(r, 80));
    assert(!p.win.IonHeader.state().sheet.open, "背景を押しても閉じない");
    p.cleanup();
  });

  await t("STAGELIST: ステージの帯を持たないページには一覧の釦もシートも作らない", async () => {
    for (const page of ["library.html", "portal.html"]) {
      const p = await openAt(page, 375);
      assert(!p.doc.getElementById("stageListBtn"), page + ": 帯が無いのに一覧の釦が出ている");
      assert(!p.doc.getElementById("stageSheet"), page + ": 帯が無いのにシートが作られている");
      assert(!p.win.IonHeader.state().sheet, page + ": 帯が無いのに sheet の状態がある");
      p.cleanup();
    }
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
    assert(doc.getElementById("rowSumRed").textContent.includes("2 Ag"), "倍率をかけた還元の式に 2Ag が出ない");
  });

  /* 析出はワープではなくスライド着地（v144）。板の上にいきなり湧かせると、
     どのイオンが e⁻ を受け取って金属になり板に積もったのかが、絵の上で切れてしまう。
     途中を刻んで見て、析出の列（x=121）から離れた水中に一度は居ることを固定する。 */
  await t("REDOX: 析出した銀は反応した場所から板へ滑ってくる（板の上に湧かない）", async () => {
    const DEP_X = 121;
    const posOf = (label) => $$("#beaker .particle").map((e) => {
      const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(e.getAttribute("transform") || "");
      const tx = e.querySelector("text");
      return m && tx ? { t: tx.textContent, x: +m[1], y: +m[2] } : null;
    }).filter((p) => p && p.t === label);
    stageBtn(1).click();
    upBtns()[1].click();          // 還元側 ×2（模範）
    playBtn().click();
    let away = 0;
    for (let k = 0; k < 300; k++) {
      adv(50);
      for (const p of posOf("Ag")) if (p.x > DEP_X + 20) away++;
      if (state().phase === "done") break;
    }
    assert(away >= 2, "Ag が板の外に一度も現れない＝板の上にワープしている: " + away);
    adv(1000);
    const fin = posOf("Ag");
    assert(fin.length === 2 && fin.every((p) => Math.abs(p.x - DEP_X) < 1),
      "最後に析出の列へそろわない: " + JSON.stringify(fin));
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
    // 多原子イオンでは、タグは項の中央ではなく**その元素記号の真下**に付く
    stageBtn(REDOX_STAGES.findIndex((s) => s.id === "rs1")).click();
    let checkedTags = 0, offCenter = 0;
    for (const f of $$("#halfSheet .fterm")) {
      const tag = f.querySelector(".oxtag"), anc = f.querySelector(".oxAnchor");
      if (!tag) continue;
      checkedTags++;
      assert(anc, "酸化数タグに元素記号のアンカーが無い: " + f.textContent);
      assert(anc.firstChild.textContent.length > 0, "アンカーが空: " + f.textContent);
      const tb = tag.getBoundingClientRect(), ab = anc.getBoundingClientRect(), fb = f.getBoundingClientRect();
      assert(Math.abs((tb.left + tb.width / 2) - (ab.left + ab.width / 2)) < 2,
        "タグが元素記号の真下にない: " + f.textContent);
      assert(tb.top >= ab.bottom - 1, "タグが元素記号の下に来ていない: " + f.textContent);
      if (Math.abs((tb.left + tb.width / 2) - (fb.left + fb.width / 2)) > 3) offCenter++;
    }
    assert(checkedTags >= 4, "酸化数タグが少なすぎる: " + checkedTags);
    assert(offCenter >= 1, "多原子イオンでもタグが項の中央のまま（MnO₄⁻ の +7 が Mn の下に来ていない）");
    // 式のほうは、対象の元素に下線も引く
    assert($$("#halfSheet .oxAnchor").every((e) => win.getComputedStyle(e).borderBottomStyle === "solid"),
      "対象の元素に下線が引かれていない");
    // ビーカーの粒でも、多原子イオンなら酸化数はその原子の真下（円の中央ではない）
    stageBtn(REDOX_STAGES.findIndex((s) => s.id === "rn1")).click();
    adv(60);
    let poly = 0;
    for (const g of $$("#beaker .particle")) {
      const label = g.querySelector("text");
      const anc = [...label.querySelectorAll("tspan")][1];
      if (!anc || !anc.textContent) continue;
      const ox = [...g.querySelectorAll("text")].find((e) => e.getAttribute("y") === "12");
      assert(ox, "粒に酸化数が無い: " + label.textContent);
      const ab = anc.getBBox(), ob = ox.getBBox(), lb = label.getBBox();
      assert(Math.abs((ab.x + ab.width / 2) - (ob.x + ob.width / 2)) < 1.5,
        "粒の酸化数が対象原子の真下にない: " + label.textContent);
      const line = g.querySelector("line");
      assert(line && Math.abs(+line.getAttribute("x1") - ab.x) < 2 &&
             Math.abs(+line.getAttribute("x2") - (ab.x + ab.width)) < 2,
        "粒の対象原子に下線が引かれていない: " + label.textContent);
      // 多原子イオン（NO₃⁻）では円の中央からずれているはず
      if (label.textContent.length > anc.textContent.length) {
        poly++;
        assert(Math.abs((ob.x + ob.width / 2) - (lb.x + lb.width / 2)) > 2,
          "多原子イオンなのに酸化数が円の中央のまま: " + label.textContent);
      }
    }
    assert(poly >= 1, "多原子イオンの粒を検査できていない");
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

  await t("REDOX: 筆算の5行 - 半反応式→イオン反応式→傍観イオンを足す→化学反応式", async () => {
    const setM = (idx, v) => {
      let g = 0;
      const svg = doc.getElementById("schematic");
      while (state().mult[idx] > v && g++ < 20) {
        const bs = [...svg.querySelectorAll(".schBlock")];
        (idx === 0 ? bs[0] : bs[bs.length - 1]).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      }
      while (state().mult[idx] < v && g++ < 20) doc.querySelectorAll("#schematicAdd button")[idx].click();
    };
    // ④行目のステッパー（行は毎回作り直されるので、押すたびに引き直す）
    const addStep = (dir) => $$("#rowAdd .stepper button")[dir === "+" ? 1 : 0].click();
    const addMsg = () => doc.getElementById("addMsg").textContent;
    // 酸化数タグは元素記号の中に入っているので、式として読むときは取り除く
    const rowText = (id) => {
      const c = doc.getElementById(id).cloneNode(true);
      [...c.querySelectorAll(".oxtag")].forEach((e) => e.remove());
      return c.textContent;
    };
    const i = REDOX_STAGES.findIndex((s) => s.id === "rn1");
    stageBtn(i).click();
    // ①②行目は最初から。③以降は e⁻ がそろうまで出ない
    assert(!doc.getElementById("step1").hidden && !doc.getElementById("step2").hidden, "ステップ1・2が出ない");
    assert(doc.getElementById("stepCalc").hidden, "e⁻ が合う前から筆算の段が出ている");
    setM(0, 3); setM(1, 2);
    // ③ 倍率をかけた2本が並び、両辺の e⁻ に斜線が入る
    assert(!doc.getElementById("stepCalc").hidden, "e⁻ が合っても筆算の段が出ない");
    assert(rowText("rowSumOx").includes("3 Cu") && rowText("rowSumRed").includes("8 H⁺"),
      "倍率をかけた式が出ない: " + rowText("rowSumOx") + " / " + rowText("rowSumRed"));
    const struck = $$("#rowSumOx .cancel, #rowSumRed .cancel").map((e) => e.textContent);
    assert(struck.length === 2 && struck.every((x) => x.includes("6 e⁻")),
      "打ち消される e⁻ に斜線が入らない: " + struck.join("/"));
    // 行ラベルは役割名で言う（還元剤＝酸化される側、の対応を明示。v132）
    assert(rowText("rowSumOx").includes("【還元剤】") && rowText("rowSumOx").includes("×3 酸化される式"),
      "還元剤の行ラベルが役割名でない: " + rowText("rowSumOx"));
    assert(rowText("rowSumRed").includes("【酸化剤】") && rowText("rowSumRed").includes("×2 還元される式"),
      "酸化剤の行ラベルが役割名でない: " + rowText("rowSumRed"));
    assert(!doc.getElementById("halfOx").textContent.includes("3 Cu"),
      "ステップ1の半反応式まで倍数化されている: " + doc.getElementById("halfOx").textContent);
    const ionic = rowText("rowIonic");
    assert(ionic.includes("H⁺") && ionic.includes("NO₃⁻") && ionic.includes("イオン反応式"),
      "イオン反応式の行が組み立たない: " + ionic);
    // ④まだ0個。作業行にイオンが残り、⑤はまだ出ない
    assert(!doc.getElementById("rowAdd").hidden, "倍率が合っても傍観イオンの段が出ない");
    assert(state().spectatorNeed === 6, "必要な傍観イオンが6でない: " + state().spectatorNeed);
    assert(rowText("rowWork").includes("H⁺") && rowText("rowWork").includes("Cu²⁺"),
      "0個のとき自由なイオンが残らない: " + rowText("rowWork"));
    assert(doc.getElementById("rowMol").hidden && doc.getElementById("head5").hidden,
      "補充が合う前から化学反応式が出ている");
    assert(addMsg().includes("足りない") && addMsg().includes("HNO₃"), "不足の助言が出ない: " + addMsg());
    // 6個足すと⑤が下に現れる
    for (let k = 0; k < 6; k++) addStep("+");
    assert(state().molOk, "6個足しても完成しない: " + addMsg());
    assert(String(state().molCoeffs) === "3,8,3,2,4", "導いた係数が違う: " + state().molCoeffs);
    assert(!doc.getElementById("rowMol").hidden && doc.getElementById("rowWork").hidden,
      "完成しても⑤が出ない／作業行が残る");
    const mol = rowText("rowMol");
    assert(mol.includes("HNO₃") && mol.includes("Cu(NO₃)₂") && !mol.includes("H⁺"),
      "化学反応式の姿になっていない: " + mol);
    // 図: 済んだぶんは組み換えず、残ったイオンだけが組んで塩・分子になる
    const fig = () => doc.getElementById("molFigure");
    const figTexts = () => [...fig().querySelectorAll("text")].map((e) => e.textContent);
    const circles = () => [...fig().querySelectorAll("circle")];
    const roles = figTexts();
    assert(roles.some((x) => x.includes("済") && x.includes("e⁻")), "済のパネルが無い: " + roles.join("/"));
    assert(roles.some((x) => x.includes("3 Cu → 3 Cu²⁺")), "酸化された分が出ない: " + roles.join("/"));
    assert(roles.some((x) => x.includes("2 NO") && x.includes("4 H₂O")), "還元で決着した分が出ない: " + roles.join("/"));
    assert(roles.some((x) => x === "HNO₃") && roles.some((x) => x === "Cu(NO₃)₂"),
      "組み換えでできる分子・塩が出ない: " + roles.join("/"));
    assert(roles.includes("×8") && roles.includes("×3"), "できた個数が出ない: " + roles.join("/"));
    assert(circles().every((c) => c.getAttribute("stroke-dasharray") === "none"),
      "ぴったりなのに空席が残っている");
    assert(roles.some((x) => x.includes("8 HNO₃")), "二役のまとめに酸の総数が無い: " + roles.join("/"));
    assert(roles.some((x) => x.includes("2 個") && x.includes("酸化剤")), "還元されるぶんが出ない: " + roles.join("/"));
    assert(roles.some((x) => x.includes("6 個") && x.includes("NO₃⁻")), "傍観ぶんが出ない: " + roles.join("/"));
    assert(roles.join("/").includes("傍観イオン"), "傍観イオンだと言っていない: " + roles.join("/"));
    // 足しすぎると余ると言い、図でも相手のいない NO₃⁻ に赤い印がつく
    addStep("+");
    assert(!state().molOk && addMsg().includes("多い"), "多すぎを通した: " + addMsg());
    assert(circles().filter((c) => c.getAttribute("stroke") === "#c0392b").length === 2,
      "あまった傍観イオンに印がつかない");
    // 逆に足りないときは、空席（点線）と相手のいないイオンの印が図に出る
    for (let k = 0; k < 7; k++) addStep("-");
    assert(state().added === 0, "0個まで戻せない: " + state().added);
    assert(circles().filter((c) => c.getAttribute("stroke-dasharray") !== "none").length === 12,
      "足りないぶんが空席にならない");
    assert(figTexts().includes("（まだできない）"), "できていない側の表示が出ない");
    for (let k = 0; k < 6; k++) addStep("+");
    // 倍率を崩すと④⑤は引っ込み、足した数も白紙に戻る
    setM(1, 3);
    assert(doc.getElementById("stepCalc").hidden, "e⁻ が合わなくなっても筆算が残る");
    assert(state().added === 0, "倍率を変えても足した数が残る: " + state().added);
    // molecularEq を持たないステージでは④⑤が出ない
    stageBtn(0).click();
    assert(doc.getElementById("rowAdd").hidden, "登録の無い反応で傍観イオンの段が出る");
  });

  await t("REDOX: 「この H⁺ は誰が出す？」の図 - 硝酸から来たぶんと足したぶんに分かれる", async () => {
    const setM = (idx, v) => {
      let g = 0;
      const svg = doc.getElementById("schematic");
      while (state().mult[idx] > v && g++ < 20) {
        const bs = [...svg.querySelectorAll(".schBlock")];
        (idx === 0 ? bs[0] : bs[bs.length - 1]).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      }
      while (state().mult[idx] < v && g++ < 20) doc.querySelectorAll("#schematicAdd button")[idx].click();
    };
    const wrap = () => doc.getElementById("acidSourceWrap");
    const figTexts = () => $$("#acidSource text").map((e) => e.textContent);
    // 酸化剤を酸として持ち込む反応でだけ出る
    stageBtn(0).click();
    assert(wrap().hidden, "r1（酸を使わない反応）で H⁺ の由来の図が出ている");
    stageBtn(REDOX_STAGES.findIndex((s) => s.id === "rs1")).click();
    assert(wrap().hidden, "rs1（硫酸酸性・分子反応式の登録なし）で出ている");
    // 濃硝酸 ×2 なら「(H⁺＋NO₃⁻)2個」＋「追加ぶん2個」
    stageBtn(REDOX_STAGES.findIndex((s) => s.id === "rn2")).click();
    setM(1, 2);
    assert(!wrap().hidden, "rn2 で H⁺ の由来の図が出ない");
    const txt = figTexts();
    assert(txt.some((x) => x.includes("用意したのは Cu と HNO₃")), "用意した物質を示していない: " + txt.join("/"));
    assert(txt.some((x) => x.includes("2個") && x.includes("一緒に来た")), "酸化剤と来たぶんが出ない: " + txt.join("/"));
    assert(txt.some((x) => x.includes("2個") && x.includes("追加")), "追加ぶんが出ない: " + txt.join("/"));
    // H⁺ と NO₃⁻ が対で並ぶ（必要な H⁺ の数だけ）
    assert($$("#acidSource circle").length === 8, "H⁺4個ぶんの対にならない: " + $$("#acidSource circle").length);
    const msg = doc.getElementById("acidSourceMsg").textContent;
    assert(msg.includes("必要な H⁺ は 4個") && msg.includes("残り 2個"), "不足の説明が出ない: " + msg);
    // 追加ぶんの数は、④で両辺に足す傍観イオンの数と一致する
    setM(0, 1);
    assert(state().spectatorNeed === 2, "rn2 の必要数が2でない: " + state().spectatorNeed);
    // 希硝酸なら 1個につき4個要るので、追加ぶんが増える
    stageBtn(REDOX_STAGES.findIndex((s) => s.id === "rn1")).click();
    setM(0, 3); setM(1, 2);
    assert(doc.getElementById("acidSourceMsg").textContent.includes("残り 6個"),
      "rn1 の追加ぶんが6個でない: " + doc.getElementById("acidSourceMsg").textContent);
    assert(state().spectatorNeed === 6, "④の必要数と食い違う: " + state().spectatorNeed);
  });

  await t("REDOX: 組み換えの図 - 粒が見出しの文字に重ならず、枠内に収まる", async () => {
    const setM = (idx, v) => {
      let g = 0;
      const svg = doc.getElementById("schematic");
      while (state().mult[idx] > v && g++ < 20) {
        const bs = [...svg.querySelectorAll(".schBlock")];
        (idx === 0 ? bs[0] : bs[bs.length - 1]).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      }
      while (state().mult[idx] < v && g++ < 20) doc.querySelectorAll("#schematicAdd button")[idx].click();
    };
    let checked = 0;
    for (const [id, a, b] of [["rn1", 3, 2], ["rn2", 1, 2]]) {
      stageBtn(REDOX_STAGES.findIndex((s) => s.id === id)).click();
      setM(0, a); setM(1, b);
      const svg = doc.getElementById("molFigure");
      const need = state().spectatorNeed;
      for (let add = 0; add <= need + 2; add++) {
        while (state().added < add) $$("#rowAdd .stepper button")[1].click();
        checked++;
        const vbW = +svg.getAttribute("viewBox").split(" ")[2];
        const caps = [...svg.querySelectorAll("text")]
          .filter((e) => /^(左辺|右辺|済)/.test(e.textContent))
          .map((e) => e.getBBox());
        for (const c of [...svg.querySelectorAll("circle")]) {
          const cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy"), r = +c.getAttribute("r");
          assert(cx + r <= vbW + 0.5, `${id} +${add}: 粒が枠からはみ出す`);
          for (const b2 of caps) {
            assert(!(cy - r < b2.y + b2.height && cy + r > b2.y && cx - r < b2.x + b2.width && cx + r > b2.x),
              `${id} +${add}: 粒が見出しの文字に重なる`);
          }
        }
      }
      while (state().added > 0) $$("#rowAdd .stepper button")[0].click();
    }
    assert(checked >= 12, "検査した組み合わせが少なすぎる: " + checked);
  });

  await t("REDOX: 筆算の幅が固定され、足す数を変えても左右にぶれない", async () => {
    const setM = (idx, v) => {
      let g = 0;
      const svg = doc.getElementById("schematic");
      while (state().mult[idx] > v && g++ < 20) {
        const bs = [...svg.querySelectorAll(".schBlock")];
        (idx === 0 ? bs[0] : bs[bs.length - 1]).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      }
      while (state().mult[idx] < v && g++ < 20) doc.querySelectorAll("#schematicAdd button")[idx].click();
    };
    for (const [id, a, b] of [["rn1", 3, 2], ["rn2", 1, 2]]) {
      stageBtn(REDOX_STAGES.findIndex((s) => s.id === id)).click();
      setM(0, a); setM(1, b);
      const sheet = doc.getElementById("calcSheet");
      const fig = doc.getElementById("molFigure");
      const widths = new Set(), lefts = new Set();
      for (let add = 0; add <= state().spectatorNeed + 3; add++) {
        while (state().added < add) $$("#rowAdd .stepper button")[1].click();
        widths.add(Math.round(sheet.getBoundingClientRect().width));
        widths.add(Math.round(fig.getBoundingClientRect().width));
        lefts.add(Math.round(doc.querySelector("#rowIonic .cLeft").getBoundingClientRect().right));
        // 幅を固定しても、はみ出して読めなくなっていないこと
        assert(sheet.scrollWidth <= sheet.getBoundingClientRect().width + 1,
          `${id} +${add}: 固定幅より中身が広い（${sheet.scrollWidth} > ${sheet.getBoundingClientRect().width}）`);
      }
      assert(widths.size === 2, `${id}: 足す数で筆算・図の幅が動く: ${[...widths]}`);
      assert(lefts.size === 1, `${id}: 足す数で式の位置が左右にぶれる: ${[...lefts]}`);
      while (state().added > 0) $$("#rowAdd .stepper button")[0].click();
    }
  });

  await t("REDOX: 板の原子は水中の中央にそろい、e⁻ は原子がいた場所に残る", async () => {
    const PLATE_TOP = 160, PLATE_BOTTOM = 370, PLATE_MID = 265;
    const at = (label) => {
      adv(60);   // 静止している粒にも transform を書かせる
      return $$("#beaker .particle").map((e) => {
        const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(e.getAttribute("transform") || "");
        return { t: e.querySelector("text").textContent, y: m ? +m[2] : null };
      }).filter((p) => p.t === label && p.y !== null).map((p) => p.y).sort((x, y) => x - y);
    };
    const r4 = REDOX_STAGES.findIndex((s) => s.id === "r4");   // Al × Cu²⁺（2:3）
    stageBtn(r4).click();
    // 倍率を上げても板からはみ出さず、上下の中央にそろう（以前は上から詰めて水の外まで伸びていた）
    for (let k = 0; k < 8; k++) doc.querySelectorAll("#schematicAdd button")[0].click();
    const many = at("Al");
    assert(many.length === 9, "×9 で原子が9個でない: " + many.length);
    assert(many[0] >= PLATE_TOP + 6 && many[many.length - 1] <= PLATE_BOTTOM - 6,
      "原子が板からはみ出す: " + many[0] + "〜" + many[many.length - 1]);
    assert(Math.abs((many[0] + many[many.length - 1]) / 2 - PLATE_MID) < 2,
      "原子が上下の中央にそろわない: " + JSON.stringify(many));
    // 模範の 2:3 に戻して反応させる
    const svg = doc.getElementById("schematic");
    while (state().mult[0] > 2) {
      [...svg.querySelectorAll(".schBlock")][0].dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    }
    while (state().mult[1] < 3) doc.querySelectorAll("#schematicAdd button")[1].click();
    const atomYs = at("Al");
    playBtn().click();
    adv(3000);
    // e⁻ は原子がいた高さに残る（板の下の一列に集められない）
    const eYs = at("e⁻");
    assert(eYs.length === 6, "e⁻ が6個でない: " + eYs.length);
    for (const y of eYs) {
      assert(atomYs.some((ay) => Math.abs(ay - y) <= 20),
        "e⁻ が原子のいた高さから離れている: e⁻=" + JSON.stringify(eYs) + " 原子=" + JSON.stringify(atomYs));
    }
    adv(25000);
    const s = state();
    assert(s.cleared && s.deposited === 3 && s.poolE === 0 && s.waiting === 0,
      "2:3 で反応しきらない: " + JSON.stringify(s));
    // 析出した金属は板の下側から積み上がる
    const dep = at("Cu");
    assert(dep.length === 3 && dep[dep.length - 1] > PLATE_MID + 30,
      "析出が板の下側に積まれない: " + JSON.stringify(dep));
  });

  await t("REDOX: 銅と硝酸 - 気体が逃げ、水は溶液に残る（板に析出しない）", async () => {
    const setM = (idx, v) => {
      let g = 0;
      const svg = doc.getElementById("schematic");
      while (state().mult[idx] > v && g++ < 20) {
        const bs = [...svg.querySelectorAll(".schBlock")];
        (idx === 0 ? bs[0] : bs[bs.length - 1]).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      }
      while (state().mult[idx] < v && g++ < 20) doc.querySelectorAll("#schematicAdd button")[idx].click();
    };
    for (const [id, a, b, gas, nGas, nWater] of [["rn1", 3, 2, "NO", 2, 4], ["rn2", 1, 2, "NO2", 2, 2]]) {
      const i = REDOX_STAGES.findIndex((s) => s.id === id);
      assert(i >= 0, id + " が無い");
      stageBtn(i).click();
      setM(0, a); setM(1, b);
      playBtn().click();
      adv(45000);
      const s = state();
      assert(s.escaped[gas] === nGas, `${id}: ${gas} が${nGas}個逃げない: ` + JSON.stringify(s.escaped));
      assert(s.counts["H2O"] === nWater, `${id}: H₂O が${nWater}個できない: ` + JSON.stringify(s.counts));
      assert(s.counts["Cu^2+"] === a, id + ": Cu²⁺ の数が違う: " + JSON.stringify(s.counts));
      // 水は溶けたまま。板に析出するのは単体の金属だけ
      assert(s.deposited === 0, id + ": 水を析出として数えている: deposited=" + s.deposited);
      assert(s.cleared, id + ": クリアにならない");
    }
    // 金属が析出する反応では今までどおり析出として数える
    stageBtn(0).click();
    playBtn().click();
    adv(25000);
    assert(state().deposited === 1, "金属の析出が数えられない: " + state().deposited);
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

  /* 溶液モードの e⁻ は集合場所へ**泳いでいる途中**なので、還元単位のイオンのほうが
     先に着くことがある。着いた時点の poolE だけで待ちぼうけを確定させていたころは、
     正しい倍率なのに「e⁻ が余った」と出て終わる並びが混ざっていた（ri2 で間欠再現）。
     乱数を種つきに差し替えて、その並びを毎回わざと作る。 */
  await t("REDOX: 溶液モードで e⁻ より先にイオンが着いてもクリアできる（ri2・取りこぼしの回帰）", async () => {
    const orig = win.Math.random;
    let sd = 1016;   // 修正前はこの並びで必ず poolE:2 / waiting:1 になった
    win.Math.random = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
    try {
      const i = REDOX_STAGES.findIndex((x) => x.id === "ri2");
      assert(i >= 0, "ri2 が無い");
      stageBtn(i).click();
      for (let k = 1; k < REDOX_STAGES[i].answer[0]; k++) upBtns()[0].click();
      for (let k = 1; k < REDOX_STAGES[i].answer[1]; k++) upBtns()[1].click();
      playBtn().click();
      adv(45000);
      const s = state();
      assert(s.cleared, "模範倍率なのにクリアにならない: " + JSON.stringify(s));
      assert(s.poolE === 0 && s.waiting === 0, "e⁻ を取りこぼした: " + JSON.stringify(s));
    } finally {
      win.Math.random = orig;
    }
  });

  /* 上の「届くまで保留する」がやりすぎて、**本当に e⁻ が足りない**ときまで待ち続けたら
     アニメが終わらなくなる。最後の e⁻ が着いた時点で待ちぼうけを確定させることを固定する。 */
  await t("REDOX: e⁻ が本当に足りない倍率では待ちぼうけになって終わる（ri2 を 1:3）", async () => {
    const i = REDOX_STAGES.findIndex((x) => x.id === "ri2");
    stageBtn(i).click();
    upBtns()[1].click();  // 還元側 ×2（模範）
    upBtns()[1].click();  // ×3 ＝ e⁻ が2個足りない
    playBtn().click();
    adv(60000);
    const s = state();
    assert(s.mult[0] === 1 && s.mult[1] === 3, "倍率が 1:3 になっていない: " + JSON.stringify(s.mult));
    assert(s.phase === "done", "アニメが終わらない（保留のまま止まった）: " + JSON.stringify(s));
    assert(s.waiting === 1 && !s.cleared, "待ちぼうけにならない: " + JSON.stringify(s));
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

  /* 溶液モードの対向整列（v145）。漂わせていたころは、どの粒が e⁻ を出して
     どの粒が受け取ったのかが混雑にまぎれて追えなかった。
     「還元剤は左列にそろう・酸化剤は右列にそろう・e⁻ は右へしか動かない」を固定する。 */
  await t("REDOX: 溶液モードは還元剤が左列・酸化剤が右列に対向整列し、e⁻ は右へ渡る（rs1）", async () => {
    const posOf = (label) => {
      adv(50);   // 静止している粒にも transform を書かせる
      return $$("#beaker .particle").map((e) => {
        const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(e.getAttribute("transform") || "");
        const tx = e.querySelector("text");
        return m && tx ? { t: tx.textContent, x: +m[1], y: +m[2] } : null;
      }).filter((p) => p && p.t === label);
    };
    const rs1 = REDOX_STAGES.findIndex((s) => s.id === "rs1");
    stageBtn(rs1).click();
    for (let k = 1; k < 5; k++) upBtns()[0].click(); // 酸化側 ×5（模範）
    const fe = posOf("Fe²⁺"), mn = posOf("MnO₄⁻"), h = posOf("H⁺");
    assert(fe.length === 5 && mn.length === 1 && h.length === 8,
      "初期の粒数が想定外: Fe²⁺" + fe.length + " MnO₄⁻" + mn.length + " H⁺" + h.length);
    // 還元剤は1本の縦線にそろう（漂っていたころは x がばらばらだった）
    assert(fe.every((p) => Math.abs(p.x - fe[0].x) < 0.5), "還元剤が左列にそろわない: " + JSON.stringify(fe.map((p) => p.x)));
    const ys = fe.map((p) => p.y).sort((a, b) => a - b);
    assert(ys.every((y, i) => i === 0 || Math.abs((y - ys[i - 1]) - (ys[1] - ys[0])) < 0.5),
      "還元剤の間隔が等しくない: " + JSON.stringify(ys));
    // 酸化剤は還元剤より右。あいだが e⁻ の通り道になる
    const oxLeft = Math.min(...[...mn, ...h].map((p) => p.x));
    assert(oxLeft > fe[0].x + 120, "酸化剤が右列に離れていない: 還元剤x=" + fe[0].x + " 酸化剤の左端x=" + oxLeft);
    // e⁻ は左から右へ。左へ戻る動きが1回でもあれば授受の向きが読めない
    playBtn().click();
    let prev = new Map(), backward = 0, forward = 0, tag = 0;
    for (let k = 0; k < 240 && state().phase !== "done"; k++) {
      const now = new Map();
      for (const e of $$("#beaker .particle")) {
        const tx = e.querySelector("text");
        if (!tx || tx.textContent !== "e⁻") continue;
        const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(e.getAttribute("transform") || "");
        if (!m) continue;
        let key = e.getAttribute("data-etag");
        if (!key) { key = "e" + (++tag); e.setAttribute("data-etag", key); }
        now.set(key, +m[1]);
        if (prev.has(key)) { const d = +m[1] - prev.get(key); if (d < -0.05) backward++; else if (d > 0.05) forward++; }
      }
      prev = now;
      adv(50);
    }
    assert(forward > 20, "e⁻ が右へ動いていない: " + forward);
    assert(backward === 0, "e⁻ が左へ戻る動きがある（左→右の授受にならない）: " + backward);
    assert(state().cleared, "クリアにならない: " + JSON.stringify(state()));
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

  await t("REDOX: 切断の段（ヨードホルム）に酸化数ラベルを出さない（S-7）", async () => {
    // 切断そのものはステージの半反応式（CH₃⁺ の −2→+2）とは別の話。ステージの変化を
    // 基準に選ぶと、値がたまたま一致するだけの原子（アセトンのカルボニル炭素 +2）に
    // ラベルが付いて「+2 の炭素が変化する」ように読めてしまう（ri1 で実発生・ri2 は無印で不揃い）
    for (const id of ["ri1", "ri2"]) {
      const i = REDOX_STAGES.findIndex((s) => s.id === id);
      assert(i >= 0, id + " が無い");
      stageBtn(i).click();
      assert(!doc.getElementById("stepCleave").hidden, id + ": 切断の段が出ない");
      const sheet = doc.getElementById("cleaveSheet");
      assert(sheet.querySelectorAll(".oxtag").length === 0,
        id + ": 切断の段に酸化数タグが付いている: " + sheet.textContent);
      assert(sheet.querySelectorAll(".oxAnchor").length === 0,
        id + ": 切断の段に酸化数の下線が付いている");
      // 消しすぎていないこと: ステップ1の半反応式には従来どおり酸化数が付く（−2 と +2）
      const half = doc.getElementById("halfSheet").textContent;
      assert(half.includes("-2") && half.includes("+2"),
        id + ": 半反応式の酸化数（−2/+2）が消えた: " + half);
    }
    stageBtn(0).click();
  });

  await t("REDOX: ro1 の筆算 - SO₄²⁻ を4個戻すと 3C₂H₅OH＋K₂Cr₂O₇＋4H₂SO₄ の化学反応式になる", async () => {
    const rowText = (id) => {
      const c = doc.getElementById(id).cloneNode(true);
      [...c.querySelectorAll(".oxtag")].forEach((e) => e.remove());
      return c.textContent;
    };
    const i = REDOX_STAGES.findIndex((s) => s.id === "ro1");
    stageBtn(i).click();
    // 倍率を 3:1 にそろえる（模式図の＋ボタン）
    doc.querySelectorAll("#schematicAdd button")[0].click();
    doc.querySelectorAll("#schematicAdd button")[0].click();
    assert(!doc.getElementById("stepCalc").hidden, "3:1 でも筆算の段が出ない");
    assert(!doc.getElementById("rowAdd").hidden, "④傍観イオンの段が出ない");
    assert(state().spectatorNeed === 4, "必要な SO₄²⁻ が4でない: " + state().spectatorNeed);
    // 0個の作業行: K₂Cr₂O₇ は組めており、H⁺ と K⁺ がまだ残っている
    const work = rowText("rowWork");
    assert(work.includes("K₂Cr₂O₇") && work.includes("H⁺") && work.includes("K⁺"),
      "0個の作業行が想定外: " + work);
    assert(doc.getElementById("addMsg").textContent.includes("K₂Cr₂O₇ が連れてきた"),
      "K⁺ のただし書きが出ない: " + doc.getElementById("addMsg").textContent);
    // rn 系専用の図（1イオン×per 個の列図）は、束ねる join を持つ ro では出さない
    assert(doc.getElementById("molFigure").style.display === "none", "ro1 で組み換えの図が出ている");
    // SO₄²⁻ を4個足すと⑤の化学反応式が完成する
    for (let k = 0; k < 4; k++) $$("#rowAdd .stepper button")[1].click();
    assert(!doc.getElementById("rowMol").hidden, "4個そろえても⑤が出ない: " + doc.getElementById("addMsg").textContent);
    const mol = rowText("rowMol");
    for (const s of ["3 CH₃CH₂OH", "K₂Cr₂O₇", "4 H₂SO₄", "3 CH₃CHO", "Cr₂(SO₄)₃", "K₂SO₄", "7 H₂O"]) {
      assert(mol.includes(s), "⑤に " + s + " が出ない: " + mol);
    }
    stageBtn(0).click();
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
    assert(eq === "H₂SO₄ ＋ 2NaOH → Na₂SO₄ ＋ 2H₂O", "整形が想定外: " + eq);
    // markup 版（索引の一覧）は同じ式を、係数だけ別の要素にして組み立てる。
    // 文字列版と食い違うと、同じ反応が2通りの書き方で並ぶことになる
    const box = document.createElement("div");
    renderEquation(box, byId["s2"], (sp) => SPECIES[sp].disp);
    assert(box.textContent === eq, "markup 版と文字列版で式が違う: " + box.textContent + " ≠ " + eq);
    const coeffs = [...box.querySelectorAll(".rxnCoeff")].map((e) => e.textContent);
    assert(coeffs.join(",") === "2,2", "係数だけを取り出せていない: " + coeffs.join(","));
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

  await t("有機の酸化・ヨードホルムが索引に載っている（P-5: 物質で検索して0件だった5本）", () => {
    // 「有機の酸化」「ヨードホルム反応」の単元に属するステージは、全部が索引から引けること。
    // ステージ名を並べずに単元から引くので、**単元にステージを足したら索引も要る**が自動で効く
    const units = CURRICULUM.reduce((a, s) => a.concat(s.units), [])
      .filter((u) => u.id === "u-redox-organic" || u.id === "u-iodoform");
    const need = units.reduce((a, u) => a.concat(u.redox || []), []);
    assert(need.length === 5, "対象のステージ数が想定と違う: " + need.join(","));
    for (const id of need) {
      assert(data.reactions.some((rx) => rx.redoxStage === id),
        "索引に " + id + " が無い（portal の単元カードからしか行けない）");
    }
    // 索引の入口は物質検索なので、代表的な物質で必ず当たること
    const hits = (q) => data.reactions.filter((rx) => matchesQuery(rx, q)).map((r) => r.id);
    assert(hits("C2H5OH").length === 1, "エタノールで引けない: " + hits("C2H5OH").join(","));
    assert(hits("CHI3").length === 2, "ヨードホルムで引けない: " + hits("CHI3").join(","));
    assert(hits("I2").length === 2, "I₂ で引けない: " + hits("I2").join(","));
    assert(hits("CH3COCH3").length === 2, "アセトンで引けない: " + hits("CH3COCH3").join(","));
  });

  await t("金属×イオンの4反応が索引に載っている（P-5 第3波: r1〜r4）", () => {
    // 単元から引くので、u-redox-basic にステージを足したら索引の欠落で落ちる
    const unit = CURRICULUM.reduce((a, s) => a.concat(s.units), []).find((u) => u.id === "u-redox-basic");
    assert(unit && (unit.redox || []).length === 4, "対象の単元が想定と違う");
    for (const id of unit.redox) {
      assert(data.reactions.some((rx) => rx.redoxStage === id),
        "索引に " + id + " が無い（portal の単元カードからしか行けない）");
    }
    // 酸化還元モードの全ステージが索引から引けること（ここまでで取りこぼしゼロになった）
    for (const st of REDOX_STAGES) {
      assert(data.reactions.some((rx) => rx.redoxStage === st.id),
        "索引に " + st.id + "（" + st.title + "）が無い");
    }
    const hits = (q) => data.reactions.filter((rx) => matchesQuery(rx, q)).map((r) => r.id);
    assert(hits("Zn").length >= 3, "亜鉛で引けない: " + hits("Zn").join(","));
    assert(hits("Ag").length >= 1, "銀で引けない: " + hits("Ag").join(","));
    assert(hits("ZnCl2").length === 1, "塩化亜鉛で引けない: " + hits("ZnCl2").join(","));
    assert(hits("Al2(SO4)3").length === 2, "硫酸アルミニウムで引けない: " + hits("Al2(SO4)3").join(","));
  });

  /* 参照エントリの式を**書き起こしていない**ことの担保。
     ステージの半反応式を answer 倍して足し、e⁻ と傍観イオンを消したものが、
     reactions.json の分子反応式を電離させて傍観イオンを消したものと一致するはず。
     どちらかを手で書き換えたら、ここで食い違いとして出る。 */
  await t("参照エントリの分子反応式が、ステージの半反応式の和と一致する", () => {
    const gcd2 = (a, b) => (b ? gcd2(b, a % b) : a);
    const cancel = (L, R) => {
      for (const sp of Object.keys(L)) {
        if (!R[sp]) continue;
        const m = Math.min(L[sp], R[sp]);
        L[sp] -= m; R[sp] -= m;
        if (!L[sp]) delete L[sp];
        if (!R[sp]) delete R[sp];
      }
    };
    // 左右をまとめて1つの gcd で割る（別々に割ると式そのものが変わってしまう）
    const key = (L, R) => {
      const vals = [...Object.values(L), ...Object.values(R)].filter((v) => v > 0);
      const k = vals.length ? vals.reduce(gcd2) : 1;
      const norm = (m) => Object.entries(m).filter(([, v]) => v).map(([s, v]) => s + ":" + v / k).sort().join(",");
      return norm(L) + " → " + norm(R);
    };
    let n = 0;
    for (const rx of data.reactions) {
      if (!rx.redoxStage) continue;
      const st = REDOX_STAGES.find((s) => s.id === rx.redoxStage);
      if (st.cleavage) continue;   // 切断型（ヨードホルム）は半反応式の単純な和ではない
      const HL = {}, HR = {};
      const add = (m, terms, k) => terms.forEach((tm) => (m[tm.sp] = (m[tm.sp] || 0) + k * tm.n));
      add(HL, HALF_REACTIONS[st.ox].left, st.answer[0]);
      add(HR, HALF_REACTIONS[st.ox].right, st.answer[0]);
      add(HL, HALF_REACTIONS[st.red].left, st.answer[1]);
      add(HR, HALF_REACTIONS[st.red].right, st.answer[1]);
      cancel(HL, HR);
      assert(!HL["e-"] && !HR["e-"], rx.id + ": 半反応式を足しても e⁻ が消えない");

      const ML = {}, MR = {}, nL = rx.reactants.length;
      const expand = (m, sp, k) => (DISSOCIATION[sp] || [sp]).forEach((i) => (m[i] = (m[i] || 0) + k));
      rx.reactants.forEach((sp, i) => expand(ML, sp, rx.coeffs[i]));
      rx.products.forEach((sp, i) => expand(MR, sp, rx.coeffs[nL + i]));
      cancel(ML, MR);
      assert(key(HL, HR) === key(ML, MR),
        rx.id + ": 半反応式の和と分子反応式が食い違う\n  半反応 " + key(HL, HR) + "\n  分子式 " + key(ML, MR));
      n++;
    }
    assert(n >= 12, "突き合わせた反応が少なすぎる: " + n);
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

  await t("アプリ横断: 実データで ratio の量的計算とつながる反応がある", async () => {
    const lib = await loadReactionLibrary();
    if (typeof ChemRatio === "undefined" || !ChemRatio.REACTIONS) {
      // ../ratio/model.js はリポジトリルート配信でないと読めない。純ロジックはモデル側で検証済み
      throw new Error("隣のアプリ（ratio/model.js）が読めていない。リポジトリルートから配信して開くこと");
    }
    const RS = ChemRatio.SUBSTANCES;
    const formulaOf = (k) => (RS[k] && RS[k].formula) ? RS[k].formula.replace(/<\/?sub>/g, "") : k;
    const cross = buildCrossAppIndex(lib.reactions, ChemRatio.REACTIONS, RS);
    assert(Object.keys(cross).length >= 8, "横断できる反応が少なすぎる: " + JSON.stringify(cross));
    // 中和（NaOH＋HCl）と燃焼2件は両アプリに載っているので、必ずつながる
    for (const id of ["s1", "combustion-h2-o2", "combustion-ch4-o2"]) {
      assert(cross[id], id + ": 量的計算につながらない");
      assert(ChemRatio.REACTIONS.some((p) => p.id === cross[id]),
        id + ": 対応先 " + cross[id] + " が ratio に無い");
    }
    // つながった先の式が、ほんとうに同じ式か（正準形の一致をもう一度確かめる）
    for (const [ionId, ratioId] of Object.entries(cross)) {
      const rx = lib.byId[ionId];
      const p = ChemRatio.REACTIONS.find((x) => x.id === ratioId);
      const L = p.eq.filter((x) => !x.product), R = p.eq.filter((x) => x.product);
      assert(canonicalEquation(rx.reactants, rx.products, rx.coeffs) ===
             canonicalEquation(L.map((x) => formulaOf(x.sub)), R.map((x) => formulaOf(x.sub)),
               L.map((x) => x.coef).concat(R.map((x) => x.coef))),
        ionId + " と " + ratioId + " の式が一致しない");
    }
    /* ratio の**全部の式**に相手がいること。対応が切れても画面にはリンクが出ないだけで
       何も壊れないので、黙って減っていく。ここで数えて気づけるようにする。
       ratio に新しい反応が入って落ちたときは、ion-equation にもその式を足す
       （参照エントリでよい）か、載せない理由を KNOWN_UNPAIRED に書くこと。 */
    const KNOWN_UNPAIRED = [];
    const paired = new Set(Object.values(cross));
    const unpaired = new Map();
    for (const p of ChemRatio.REACTIONS) {
      if (paired.has(p.id)) continue;
      const L = p.eq.filter((x) => !x.product), R = p.eq.filter((x) => x.product);
      const key = canonicalEquation(L.map((x) => formulaOf(x.sub)), R.map((x) => formulaOf(x.sub)),
        L.map((x) => x.coef).concat(R.map((x) => x.coef)));
      // 同じ式の別問題は、代表1件が対応していれば足りる
      const repIsPaired = ChemRatio.REACTIONS.some((q) => paired.has(q.id) &&
        canonicalEquation(
          q.eq.filter((x) => !x.product).map((x) => formulaOf(x.sub)),
          q.eq.filter((x) => x.product).map((x) => formulaOf(x.sub)),
          q.eq.filter((x) => !x.product).map((x) => x.coef)
            .concat(q.eq.filter((x) => x.product).map((x) => x.coef))) === key);
      if (!repIsPaired && !KNOWN_UNPAIRED.includes(key)) unpaired.set(key, p.id);
    }
    assert(unpaired.size === 0,
      "ratio にあって ion-equation に無い式: " + [...unpaired.entries()].map(([k, v]) => v + " " + k).join(" / "));

    /* library.html?from=<ratio 問題ID> の契約。
       **代表1件ではなく全問**が引けること。cross は式ごとに最初の問題しか持たないので、
       ID の対応表を逆引きする実装だと同じ式の2問目以降（メタンの燃焼は5問ある）が
       引けない。resolveFrom() が式で照合しているのはこのため。 */
    const keyOfRatio = (p) => {
      const L = p.eq.filter((x) => !x.product), R = p.eq.filter((x) => x.product);
      return canonicalEquation(L.map((x) => formulaOf(x.sub)), R.map((x) => formulaOf(x.sub)),
        L.map((x) => x.coef).concat(R.map((x) => x.coef)));
    };
    const ionByKey = new Map();
    for (const rx of lib.reactions) {
      const k = canonicalEquation(rx.reactants, rx.products, rx.coeffs);
      if (!ionByKey.has(k)) ionByKey.set(k, rx.id);
    }
    const unresolvable = ChemRatio.REACTIONS
      .filter((p) => !ionByKey.has(keyOfRatio(p))).map((p) => p.id);
    assert(unresolvable.length === 0,
      "?from= で相手を引けない ratio の問題: " + unresolvable.join(", "));

    // 同じ式を共有する問題が実際にあり、その2問目以降も引けている（回帰の要）
    const shared = ChemRatio.REACTIONS.filter((p) =>
      keyOfRatio(p) === keyOfRatio(ChemRatio.REACTIONS.find((q) => q.id === "r2")));
    assert(shared.length >= 2, "同じ式を共有する問題が無いと、この検査の意味が無い");
    for (const p of shared) {
      assert(ionByKey.has(keyOfRatio(p)), p.id + ": 同じ式なのに引けない");
    }

    // 往復が閉じている: ion→ratio で送った先から ?from= で戻ると、同じ ion の反応に着く
    for (const [ionId, ratioId] of Object.entries(cross)) {
      const p = ChemRatio.REACTIONS.find((x) => x.id === ratioId);
      assert(ionByKey.get(keyOfRatio(p)) === ionId,
        ionId + " → " + ratioId + " → " + ionByKey.get(keyOfRatio(p)) + " で往復が閉じない");
    }
  });

  return results;
}

/* ---- ブラウザでの実行と描画 ---- */

/* ---- 液性で書き換えるモードの UI テスト（condition.html を iframe で駆動） ---- */

async function runConditionUITests(iframe) {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const state = () => win.ConditionEq.state();
  const stageBtn = (i) => $$("#stageNav button")[i];
  const addOH = (dir) => $$("#rowAddOH .stepper button")[dir === "+" ? 1 : 0].click();
  const rowText = (id) => {
    const e = doc.getElementById(id);
    if (e.hidden) return "(hidden)";
    const c = e.cloneNode(true);
    [...c.querySelectorAll(".oxtag")].forEach((x) => x.remove());
    return c.textContent.replace(/\s+/g, " ").trim();
  };

  await t("COND: 全ステージ - OH⁻ をちょうど足すと塩基性の式が導ける", async () => {
    for (let i = 0; i < CONDITION_STAGES.length; i++) {
      stageBtn(i).click();
      const st = CONDITION_STAGES[i];
      assert(state().addedOH === 0, st.id + ": 足した数が初期化されない");
      assert(state().need === st.answerOH, st.id + ": 必要数が違う: " + state().need);
      assert(doc.getElementById("rowBasic").hidden, st.id + ": 足す前から塩基性の式が出ている");
      for (let k = 0; k < st.answerOH; k++) addOH("+");
      assert(state().ok && state().matchesData, st.id + ": 導いた式が登録と違う: " + JSON.stringify(state()));
      assert(!doc.getElementById("rowBasic").hidden, st.id + ": 塩基性の式が出ない");
      assert(!doc.getElementById("clearBanner").hidden, st.id + ": クリアにならない");
    }
  });

  await t("COND: 途中経過 - H⁺ が残る／相殺する H₂O に斜線が入る／足しすぎは指摘される", async () => {
    const i = CONDITION_STAGES.findIndex((s) => s.id === "b2");   // 陽極: H₂O が2個相殺される
    stageBtn(i).click();
    assert(doc.getElementById("rowJoin").hidden, "足す前から中和の行が出ている");
    addOH("+");
    assert(!doc.getElementById("rowJoin").hidden, "中和の行が出ない");
    assert(doc.getElementById("addMsg").textContent.includes("残っている"), "不足の助言が出ない");
    for (let k = 0; k < 3; k++) addOH("+");   // ちょうど4個
    assert(state().ok && state().cancelled === 2, "相殺した H₂O が2個でない: " + JSON.stringify(state()));
    const struck = $$("#rowJoin .cancel").map((e) => e.textContent);
    assert(struck.length === 2 && struck.every((x) => x.includes("H₂O")),
      "相殺する H₂O に斜線が入らない: " + struck.join("/"));
    assert(rowText("rowBasic").includes("4 OH⁻") && !rowText("rowBasic").includes("H⁺"),
      "塩基性の式の姿になっていない: " + rowText("rowBasic"));
    // 足しすぎ
    addOH("+");
    assert(!state().ok && doc.getElementById("addMsg").textContent.includes("多い"), "足しすぎを通した");
    assert(doc.getElementById("rowBasic").hidden, "足しすぎでも塩基性の式が残る");
  });

  await t("COND: 酸化数はステップ1の式にだけ付く（書き換えの行には出さない）", async () => {
    stageBtn(0).click();   // 陰極: 変化する元素が H なので、H₂O や OH⁻ にも H が含まれる
    for (let k = 0; k < 2; k++) addOH("+");
    assert($$("#rowAcid .oxtag").length === 2, "酸性条件の式に酸化数が2個出ない: " + $$("#rowAcid .oxtag").length);
    assert($$("#calcSheet .oxtag").length === 0,
      "書き換えの行にも酸化数が出ている（H₂O の H が変化したように見えてしまう）");
  });

  return results;
}

/* ---- 反応インデックスの UI テスト（library.html を iframe で駆動） ---- */

async function runLibraryUITests(iframe) {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  const ui = () => win.IonLibUI;
  const state = () => ui().state();
  const clearBtn = () => doc.querySelector(".filterChip.clearAll");

  /* 絞り込みの全解除（docs/review_others.md 項目4）。
     選んだチップを1つずつ押し直すしかなかった。処理は jumpTo() と共用しているので、
     どちらか片方だけ直しても気づけるように「戻り先＝全件」で見張る。 */
  await t("LIB: 絞り込みを重ねてから、ワンタップで全件に戻せる", async () => {
    const total = state().total;
    assert(total > 0, "反応データが読めていない");
    assert(!clearBtn(), "何も絞り込んでいないのに全解除ボタンが出ている");
    // 分類・単元・検索語を重ねて掛ける
    ui().setFilter("type", "中和");
    ui().setFilter("difficulty", 1);
    ui().setQuery("HCl");
    let s = state();
    assert(s.rows > 0 && s.rows < total, "絞り込みが効いていない: " + s.rows + "/" + total);
    assert(s.anyFilter && clearBtn(), "絞り込み中なのに全解除ボタンが出ない");
    // 全解除
    clearBtn().click();
    s = state();
    assert(s.rows === total, "全件に戻らない: " + s.rows + "/" + total);
    assert(!s.anyFilter, "内部の絞り込みが残っている: " + JSON.stringify(s.selected) + " q=" + s.query);
    assert(doc.getElementById("libSearch").value === "", "検索欄が空にならない");
    assert(!clearBtn(), "全件表示に戻ったのに全解除ボタンが残っている");
  });

  await t("LIB: 横断の絞り込み（量的計算もできる）も同じボタンで外れる", async () => {
    const total = state().total;
    ui().toggleCrossFilter();
    let s = state();
    assert(s.onlyCross && s.rows < total, "横断の絞り込みが効いていない: " + s.rows + "/" + total);
    assert(clearBtn(), "横断だけ絞り込んだときに全解除ボタンが出ない");
    clearBtn().click();
    s = state();
    assert(!s.onlyCross && s.rows === total, "横断の絞り込みが外れない: " + s.rows + "/" + total);
  });

  return results;
}

/* ---- 入り口ページの UI テスト（portal.html を iframe で検査） ---- */

async function runPortalUITests(iframe) {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  const $$ = (sel) => [...doc.querySelectorAll(sel)];

  await t("PORTAL: 役割カードと単元ツリーが出て、リンク先がすべて実在するステージを指す", async () => {
    const s = win.Portal.state();
    assert(s.roles === 5, "役割カードが5枚でない: " + s.roles);
    assert(s.subjects === 2, "科目が2つでない: " + s.subjects);
    assert(s.units === CURRICULUM.reduce((a, x) => a + x.units.length, 0), "単元の数が合わない: " + s.units);
    assert(s.chips > 40, "ステージのチップが少なすぎる: " + s.chips);
    // 全リンクが「実在するモード＋実在するステージID」を指しているか
    const lists = { "index.html": STAGES, "redox.html": REDOX_STAGES, "condition.html": CONDITION_STAGES };
    for (const href of s.links) {
      const m = /^([\w.]+)\?(rxn|s)=(.+)$/.exec(href);
      assert(m, "リンクの形が想定外: " + href);
      const list = lists[m[1]];
      assert(list, "未知のページを指している: " + href);
      const id = decodeURIComponent(m[3]);
      assert(list.some((x) => x.id === id), "存在しないステージを指している: " + href);
    }
    // 役割カードの行き先も実在するページ
    const pages = ["index.html", "redox.html", "condition.html", "library.html"];
    for (const a of $$(".roleCard")) {
      const page = a.getAttribute("href").split("?")[0];
      assert(pages.includes(page), "役割カードの行き先が想定外: " + a.getAttribute("href"));
    }
  });

  /* 単元アンカー。ハブ（ルート index.html）の単元表は portal.html#<単元id> で着地する。
     **相手が持つのは単元の id だけ**で、どのステージへ送るかはこのページの内部知識にしてある。
     単元を足したのにアンカーが無い（＝ハブからの着地が静かに効かなくなる）を機械で止める。 */
  await t("PORTAL: CURRICULUM の全単元が id 付きの区画として実在する（外から名指しできる）", async () => {
    const anchors = win.Portal.state().unitAnchors;
    assert(new Set(anchors).size === anchors.length, "アンカーが重複している: " + anchors.join(", "));
    for (const sub of CURRICULUM) {
      for (const u of sub.units) {
        const box = doc.getElementById(u.id);
        assert(box, "単元 " + u.id + "（" + u.name + "）のアンカーが portal.html に無い");
        assert(box.classList.contains("unitBox"), u.id + " が単元の区画を指していない");
        // 止まったときに単元名が見えること（見出しごと着地する、が要件）
        assert(box.querySelector(".unitName"), u.id + ": 区画の中に単元名の見出しが無い");
      }
    }
  });

  await t("PORTAL: #単元id で開くと、その単元が見出しごと見えて強調される", async () => {
    win.location.hash = "#u-gas";
    await new Promise((r) => setTimeout(r, 150));
    const box = doc.getElementById("u-gas");
    assert(box.classList.contains("landed"), "着地した単元が強調されない");
    assert(win.Portal.state().landed === "u-gas", "着地先の記録が合わない: " + win.Portal.state().landed);
    const r = box.getBoundingClientRect();
    assert(r.top >= 0 && r.top < win.innerHeight,
      "単元の見出しが画面の外にいる（top=" + Math.round(r.top) + " / 画面 " + win.innerHeight + "）");
    // 存在しない id で来ても壊れない（強調は付かないまま）
    win.location.hash = "#u-nowhere";
    await new Promise((r2) => setTimeout(r2, 150));
    assert(win.Portal.state().landed === "", "存在しない単元を強調している");
    win.location.hash = "";
  });

  await t("PORTAL: 各モードのヘッダーから入り口ページに戻れる", async () => {
    // ここは iframe の中ではなく、テストページ側で他モードの header を確認する
    for (const id of ["app", "appRedox", "appCond"]) {
      const d = document.getElementById(id).contentDocument;
      const links = [...d.querySelectorAll("header a")].map((a) => a.getAttribute("href"));
      assert(links.includes("portal.html"), id + ": ヘッダーに入り口ページへのリンクが無い");
    }
  });

  /* ヘッダーの導線の穴を機械で見張る（docs/review_others.md 項目1・2）。
     画面は何も壊れないまま「そのモードに気づけない」だけなので、目視では見つからない。
     全モードの総当たりにはしない——リンクを増やすほどスマホでヘッダーが伸びるため
     （項目3）、必要な2本だけを固定する。 */
  await t("MODE-NAV: どのページのヘッダーからも本体に戻れ、液性モードへも行ける", async () => {
    const headerLinks = async (page) => {
      const res = await fetch(page, { cache: "no-store" });
      assert(res.ok, page + " が取得できない");
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const header = doc.querySelector("header");
      assert(header, page + " に header が無い");
      return [...header.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    };
    // 本体（index.html）へ戻れること: 自分以外の全ページ
    for (const page of ["redox.html", "condition.html", "library.html", "portal.html"]) {
      const links = await headerLinks(page);
      assert(links.includes("index.html"), page + ": ヘッダーからイオン反応モードに戻れない");
    }
    // 液性モードへ行けること: 入り口ページ以外（portal は役割カードで案内している）
    for (const page of ["index.html", "redox.html", "library.html"]) {
      const links = await headerLinks(page);
      assert(links.includes("condition.html"), page + ": ヘッダーから液性モードへ行けない");
    }
    // 化学レンズ（ハブ）へ出られること: 全ページ。
    // アプリに直接流入した人がここで行き止まりにならないための1本で、
    // ratio・muki・qa には既にある。ion だけ無い状態が続いていた
    for (const page of ["index.html", "redox.html", "condition.html", "library.html", "portal.html"]) {
      const links = await headerLinks(page);
      assert(links.includes("../index.html"), page + ": ヘッダーからハブへ出られない");
    }
  });

  await t("MODE-NAV: GA4 が入っている全ページの末尾からプライバシーポリシーへ行ける（D-1）", async () => {
    // リンクはヘッダーでなくページ末尾の1行（ヘッダーの高さを増やさないため）
    for (const page of ["index.html", "redox.html", "condition.html", "library.html", "portal.html"]) {
      const res = await fetch(page, { cache: "no-store" });
      assert(res.ok, page + " が取得できない");
      const doc2 = new DOMParser().parseFromString(await res.text(), "text/html");
      const foot = doc2.querySelector("footer.pageFoot a");
      assert(foot && foot.getAttribute("href") === "../privacy.html",
        page + ": ページ末尾にプライバシーポリシーへの導線が無い");
      assert(!doc2.querySelector("header a[href='../privacy.html']"),
        page + ": ポリシーのリンクがヘッダーに入っている（高さを増やさない方針）");
    }
  });

  return results;
}

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
  const iframeC = document.getElementById("appCond");
  const iframeP = document.getElementById("appPortal");
  const iframeL = document.getElementById("appLib");
  const startUI = () => {
    const ready = iframe.contentWindow && iframe.contentWindow.IonEq &&
      iframeR.contentWindow && iframeR.contentWindow.RedoxEq &&
      iframeC.contentWindow && iframeC.contentWindow.ConditionEq &&
      iframeP.contentWindow && iframeP.contentWindow.Portal &&
      iframeL.contentWindow && iframeL.contentWindow.IonLibUI &&
      iframeL.contentWindow.IonLibUI.state().total > 0;   // reactions.json の読み込み待ち
    if (!ready) { setTimeout(startUI, 100); return; }
    runReactionLibraryTests().then((rlib) =>
      runUITests(iframe).then((rs1) => runRedoxUITests(iframeR).then((rs2) =>
        runConditionUITests(iframeC).then((rs3) =>
          runPortalUITests(iframeP).then((rs4) =>
            runLibraryUITests(iframeL).then((rs5) => {
              const libOk = render(document.getElementById("results"), rlib, "反応ライブラリ");
              const uiEl = document.getElementById("uiresults");
              const uiOk = render(uiEl, rs1, "UI(イオン反応)");
              const rOk = render(uiEl, rs2, "UI(酸化還元)");
              const cOk = render(uiEl, rs3, "UI(液性)");
              const pOk = render(uiEl, rs4, "UI(入り口)");
              const lOk = render(uiEl, rs5, "UI(索引)");
              const total = document.getElementById("total");
              const allOk = modelOk && libOk && uiOk && rOk && cOk && pOk && lOk;
              total.textContent = allOk ? "TOTAL: ALL PASS" : "TOTAL: FAIL";
              total.className = allOk ? "pass" : "fail";
            }))))));
  };
  startUI();
}
