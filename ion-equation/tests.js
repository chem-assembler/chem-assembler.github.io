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
      // 式を molecular / ionic に持つステージは top-level の answer を持たない（二重管理を避ける）
      const eq = eqOf(st);
      assert(eq.answer.length === eq.reactants.length + eq.products.length, st.id + ": answer の長さ");
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
      /* saltGoal を持つ＝部分中和で「余った側」が塩に残る型、持たない＝正塩。
         **どちらの塩になるかは残るイオンから決まる**ので、タグを手で見比べずに導く:
         OH⁻ が残れば塩基性塩、H を持つイオンが残れば酸性塩。
         v172 で塩基性塩（s13）を足すまで、この検査は「saltGoal ＝ 酸性塩」と決めうちだった。 */
      if (st.saltGoal) {
        const ions = Object.keys(st.saltGoal.ions);
        const kind = ions.includes("OH-") ? "塩基性塩"
          : ions.some((sp) => sp !== "OH-" && (SPECIES[sp].atoms.H || 0) > 0) ? "酸性塩" : null;
        assert(kind, st.id + ": 残るイオンから塩の種類が決まらない " + ions.join(","));
        assert(tags.includes(kind), st.id + ": " + kind + "タグが無い");
      } else {
        assert(!tags.includes("酸性塩") && !tags.includes("塩基性塩"),
          st.id + ": 正塩なのに酸性塩／塩基性塩タグ");
      }
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
    /* 模範解答であまりが出てよいのは部分中和のステージ（saltGoal）だけ。
       しかも**余る側は塩の種類と一致していなければならない** ——
       酸性塩なら H⁺ が余り、塩基性塩なら受け皿（OH⁻）が余る。逆になっていたら
       ステージのどこかが間違っている。
       同じ酸性塩でも s12 は CO₃²⁻ が H⁺ を1個受け取るだけなので、あまりゼロが正しい。
       v172 まではここが「受け皿は絶対に余らない」と決めうちで、塩基性塩を足せなかった。 */
    for (const st of STAGES) {
      const sc = protonSchema(st);
      if (!sc) continue;
      const b = protonBalance(sc, sampleInputs(st));
      if (!st.saltGoal) {
        assert(b.hLeft === 0 && b.accLeft === 0, st.id + ": 模範解答なのに余る " + JSON.stringify(b));
        continue;
      }
      if (st.saltGoal.ions["OH-"]) {
        assert(b.hLeft === 0, st.id + ": 塩基性塩なのに H⁺ が余る " + JSON.stringify(b));
      } else {
        assert(b.accLeft === 0, st.id + ": 酸性塩なのに受け皿が余る " + JSON.stringify(b));
      }
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
      // 分子反応式が書けない反応は数合わせビュー自体が出ない
      // （recombineWrap はイオン反応式のとき隠れる）ので、対象から外す
      if (st.noMolecular) continue;
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
        // 加水分解・電離だけは相手を待たない反応なので find が1種でよい（水は solvent として持つ）
        assert(rule.find.length + (rule.solvent ? 1 : 0) >= 2 || PARTIAL_KINDS.includes(rule.kind),
          st.id + ": find が2種未満");
        for (const sp of rule.find) assert(SPECIES[sp], st.id + ": " + sp);
        if (rule.solvent) assert(SPECIES[rule.solvent], st.id + ": 溶媒 " + rule.solvent);
        const makes = Array.isArray(rule.make) ? rule.make : [rule.make];
        for (const sp of makes) assert(SPECIES[sp], st.id + ": " + sp);
        assert(["combine", "precipitate", "gas", "complex"].concat(PARTIAL_KINDS).includes(rule.kind), st.id + ": kind 不正 " + rule.kind);
        // 消費する溶媒（弱塩基・加水分解の水）も左辺に数える。数えないと原子が合わない
        const L = tallyTerms(rule.find.concat(rule.solvent ? [rule.solvent] : []).map((sp) => ({ sp, n: 1 })));
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

  t("加水分解: 相手を待たない反応の宣言がそろっている（液性の目印・平衡の刻み・模範投入数）", () => {
    const stages = STAGES.filter((st) => partialRule(st));
    assert(stages.length > 0, "加水分解ステージが1つも無い（この検査が空回りしている）");
    for (const st of stages) {
      const r = partialRule(st);
      assert(st.rules.length === 1, st.id + ": 加水分解ステージに別のルールが混ざっている");
      assert(r.find.length === 1, st.id + ": 加水分解の find は1種（相手を待たない反応）");
      assert(Array.isArray(r.make), st.id + ": make は配列（もとの分子と H⁺/OH⁻ の2つ）");
      // 液性の目印はルールから決まる。両方できたり片方も無かったりすると画面が何も言えない
      const marks = r.make.filter((sp) => sp === "H+" || sp === "OH-");
      assert(marks.length === 1, st.id + ": 生成物に H⁺ か OH⁻ がちょうど1つ要る（" + r.make.join("+") + "）");
      // 水を使うのは「H⁺ を奪う側」だけ（OH⁻ が残る）。「放す側」は水が要らない
      assert(!!r.solvent === (marks[0] === "OH-"),
        st.id + ": 水を使うかどうかと、できる目印（" + marks[0] + "）が対応しない");
      if (r.solvent) assert(r.solvent === "H2O", st.id + ": 溶媒は水のはず");
      // 「ごく一部しか進まない」を数で持つ。1だと全部が変わってしまい平衡の嘘になる
      assert(Number.isInteger(r.per) && r.per >= 2, st.id + ": per は2以上の整数（" + r.per + "）");
      // 投入数は per から導く（sampleInputs）。**答えを二重に持たない**ための決まりなので、
      // top-level の answer を投入数として書き足していないことをここで固定する。
      // 書き足すと、per を変えたときに片方だけ古くなって「模範どおり入れたのに何も起きない」になる
      assert(sampleInputs(st)[0] === r.per, st.id + ": 模範投入数が per と違う");
      const eqIsTopLevel = !st.molecular && !st.ionic;
      assert(eqIsTopLevel || st.answer === undefined,
        st.id + ": 式を molecular/ionic に持つのに top-level の answer が残っている（投入数の二重管理）");
      // 加水分解でできる分子は、そのステージの生成物として宣言されていること
      //（宣言が無いと、できたそばからまた分解する）
      const molecule = r.make.find((sp) => sp !== marks[0]);
      assert(st.products.includes(molecule), st.id + ": " + molecule + " が products に無い");
      // 平衡なので「ちょうど反応しきる」型の評価（saltGoal・余りゼロ）とは併用しない
      assert(!st.saltGoal, st.id + ": 加水分解に saltGoal を併用している");
      /* ---- 誇張していることを隠さない（v185・台帳の O）----
         per は「見えるようにするための個数」で、実際の進み具合はけた違いに小さい
         （0.1 mol/L の酢酸ナトリウム・塩化アンモニウムなら1万個に1個ほど）。
         v185 からはこの per 個を**アプリが置く**ので、置かれた数が
         「これが本当の割合だ」と読まれる危険はむしろ増えた。
         **本当の割合と、画面が誇張であることを、どのステージも必ず言う**。
         塩化アンモニウム側はこの一文が無く、酢酸ナトリウム側とだけ食い違っていた（v185 で追加）。 */
      assert(/誇張/.test(st.doneNote),
        st.id + ": 画面の個数が誇張だと doneNote が言っていない（per=" + r.per + " を本当の割合と読まれる）");
      assert(/個に1個/.test(st.doneNote),
        st.id + ": 実際は何個に1個なのかを doneNote が言っていない");
      // 画面に置く個数と、式の係数が同じ数になっていないこと（同じだと見分けがつかない）
      const eq = st.ionic || st.molecular || st;
      assert(eq.answer[0] !== r.per,
        st.id + ": 画面に置く個数（" + r.per + "）と左辺の係数が同じ数 — 個数と係数の区別がつかない");
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
    /* どのステージも「自分自身が引ける」こと。収録を足したときに橋から漏れないための総なめ
       （対応表を書かない代わりに、走査が全件を拾うことをここで固定する。M6-E） */
    for (const st of REDOX_STAGES) {
      assert(stagesForHalves(st.ox, st.red).includes(st), st.id + ": 自分自身が橋から引けない");
    }
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
    /* 液性が合わないとき。M6-D で液性を選べるようにしたので、これは**画面から出る道**になった。
       KMnO₄ は中性・塩基性の式（MnO₄⁻→MnO₂）を持つようになったので、
       ここで見るのは**酸性の式しか持っていない**試薬にする（持っている試薬で試すと
       wrong-condition ではなく別の判定になり、この検査が空振りする）。 */
    const wc = matchRedox("K2Cr2O7", "Zn", "basic");
    check(wc, "K2Cr2O7×Zn(basic)");
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
      // OH⁻ は左右どちらにあっても塩基性の書き方（酸性の水溶液に OH⁻ は書けない）
      const hasOH = [...hr.left, ...hr.right].some((t) => t.sp === "OH-");
      assert(c === (hasH ? "acid" : hasOH ? "basic" : "any"), id + ": 液性の導出が合わない: " + c);
    }
    assert(conditionOfHalf(HALF_REACTIONS["MnO4_red"]) === "acid", "MnO₄⁻ の式が酸性必須にならない");
    assert(conditionOfHalf(HALF_REACTIONS["MnO4_red_neutral"]) === "basic",
      "MnO₄⁻→MnO₂ の式が中性・塩基性の扱いにならない（右辺の OH⁻ を見ていない）");
    assert(conditionOfHalf(HALF_REACTIONS["Zn_ox"]) === "any", "Zn の式が液性に依らない扱いにならない");
    // 人が書いた REAGENTS.half のキーが、式から導いた液性と食い違わない
    for (const rg of REAGENTS) {
      for (const [key, halfId] of Object.entries(rg.half)) {
        const c = conditionOfHalf(HALF_REACTIONS[halfId]);
        assert(key === (c === "any" ? "any" : c),
          rg.id + ": half のキー「" + key + "」が式から導いた液性「" + c + "」と違う");
      }
    }
    /* writtenFor は「紙の上の書き方」。conditionOfHalf（要る液性）とは別物なので、
       両方を持っている意味が消えていないことを確かめる。
       右辺に H⁺ が出るだけの式は「酸性の書き方」だが「酸性が要る」とは言わない。 */
    assert(writtenFor(HALF_REACTIONS["H2O2_ox"]) === "acid" &&
           conditionOfHalf(HALF_REACTIONS["H2O2_ox"]) === "any",
      "右辺の H⁺ だけの式が、書き方＝酸性・要る液性＝任意 になっていない");
    assert(writtenFor(HALF_REACTIONS["MnO4_red_neutral"]) === "basic", "MnO₂ の式の書き方が塩基性でない");
    assert(writtenFor(HALF_REACTIONS["Zn_ox"]) === "any", "Zn の式に液性の書き分けがある");
  });

  /* ---- M6-D: 液性の選択（DESIGN_redox_matching.md §2-4・§7 の M6-D）----
     「足りないから反応しない」ではなく「別の式になる」を、モデルの側で固定する。 */

  t("M6-D 中性・塩基性の MnO₄⁻: 別の対として立ち、Mn²⁺ ではなく MnO₂ になる", () => {
    const hr = HALF_REACTIONS["MnO4_red_neutral"];
    assert(hr, "MnO4_red_neutral が無い");
    /* 原子・電荷の保存と「Δ酸化数＝e⁻ の数」は、既存の総なめテストが自動で見る
       （データを足すだけで検査が増える。DESIGN §6-12）。ここでは念のため素通りしていないか確かめる。 */
    assert(compareSides(hr.left, hr.right).balanced, "MnO4_red_neutral がつり合わない");
    assert(electronsOf(hr) === 3, "受け取る e⁻ が3個でない: " + electronsOf(hr));
    const ch = oxChangeOfHalf(hr);
    assert(ch.length === 1 && ch[0].el === "Mn" && ch[0].from === 7 && ch[0].to === 4,
      "Mn が +7→+4 になっていない: " + JSON.stringify(ch));
    assert(hr.right.some((t) => t.sp === "MnO2") && hr.right.some((t) => t.sp === "OH-" && t.n === 4),
      "右辺が MnO₂ ＋ 4OH⁻ でない");
    // 酸性の式とは**別の対**。同じ couple にすると「同じ向きの重複」で対の検査に引っかかる
    assert(hr.couple !== HALF_REACTIONS["MnO4_red"].couple, "酸性の式と同じ対になっている");
    // 順位は持たない（梯子は酸性条件のものだけ。中性・塩基性の順位は作らない）
    assert(rankOfHalf("MnO4_red_neutral") === null, "中性・塩基性の式に酸性の順位が付いている");
    assert(LISTED_OXIDANTS["MnO4_red_neutral"], "順位が無いのに相手の列挙も無い（判定できなくなる）");
    for (const p of LISTED_OXIDANTS["MnO4_red_neutral"].partners) {
      assert(HALF_REACTIONS[p] && HALF_REACTIONS[p].kind === "oxidation",
        "列挙した相手が酸化の式でない: " + p);
      /* 列挙した相手は**そのまま足せる**書き方でなければならない。
         酸性の書き方の式を混ぜると、1本の式に H⁺ と OH⁻ が並んでしまう。 */
      assert(writtenFor(HALF_REACTIONS[p]) !== "acid",
        "列挙した相手が酸性の書き方: " + p + "（足すと H⁺ と OH⁻ が同じ式に並ぶ）");
    }
  });

  /* 列挙表そのものの健全性（M6-F で 2件目が入ったので、鍵ごとではなく総なめで見る）。
     **理由文は鍵ごとに違う**（液性の話と、濃度・温度の話は別もの）ので、
     使い回していないことも見張る。 */
  t("M6 列挙表: 順位を持たない酸化剤は、相手が実在し・そのまま足せて・理由が個別に書いてある", () => {
    const whys = new Set();
    for (const [oxId, entry] of Object.entries(LISTED_OXIDANTS)) {
      const hr = HALF_REACTIONS[oxId];
      assert(hr && hr.kind === "reduction", oxId + ": 列挙表の鍵が還元の式（＝酸化剤）でない");
      // 順位を持つものを列挙表に入れるのは二重持ち（梯子で決まるなら列挙は要らない）
      assert(rankOfHalf(oxId) === null, oxId + ": 順位を持っているのに列挙表にも載っている");
      assert(entry.partners && entry.partners.length, oxId + ": 相手の列挙が空");
      assert(entry.why && entry.why.trim().length > 0, oxId + ": 列挙から外れたときの理由が無い");
      assert(!whys.has(entry.why), oxId + ": 理由文を他の酸化剤と使い回している");
      whys.add(entry.why);
      for (const p of entry.partners) {
        assert(HALF_REACTIONS[p] && HALF_REACTIONS[p].kind === "oxidation",
          oxId + ": 列挙した相手が酸化の式でない: " + p);
        // 列挙した相手とは実際に reacts になる（書き方の食い違いで止まるものを列挙しない）
        const r = matchHalves(oxId, p);
        assert(r.verdict === "reacts", oxId + "×" + p + ": 列挙したのに reacts にならない: " + r.reasonCode);
      }
    }
  });

  t("M6-F 熱濃硫酸: 札が「熱濃硫酸」で、銅を溶かし、順位は持たない", () => {
    const hr = HALF_REACTIONS["H2SO4_hot_red"];
    assert(hr, "H2SO4_hot_red が無い");
    assert(compareSides(hr.left, hr.right).balanced, "熱濃硫酸の式がつり合わない");
    assert(electronsOf(hr) === 2, "受け取る e⁻ が2個でない: " + electronsOf(hr));
    const ch = oxChangeOfHalf(hr);
    assert(ch.length === 1 && ch[0].el === "S" && ch[0].from === 6 && ch[0].to === 4,
      "S が +6→+4 になっていない: " + JSON.stringify(ch));
    // 分子の H₂SO₄ で書く（SO₄²⁻ で書くと「うすい硫酸」の話に化けて、銅が溶けなくなる）
    assert(hr.left.some((t) => t.sp === "H2SO4") && !hr.left.some((t) => t.sp === "SO4^2-"),
      "熱濃硫酸を分子の形で書いていない");
    /* **札は必ず「熱濃硫酸」**（qa/KNOWLEDGE_CAVEATS.md H-2）。
       「濃硫酸」だけの札にすると、冷濃硫酸の不動態と一緒くたになる。 */
    const rg = REAGENTS.find((r) => r.id === "H2SO4_hot");
    assert(rg && rg.label === "熱濃硫酸", "札が「熱濃硫酸」でない: " + (rg && rg.label));
    assert(/不動態|被膜/.test(rg.note || ""), "冷濃硫酸との違いを但し書きに書いていない");
    for (const r of REAGENTS) {
      assert(!/^(濃硫酸|硫酸)$/.test(r.label),
        r.id + ": 「濃硫酸」「硫酸」という札は使わない（熱と冷が一緒くたになる）");
    }
    // 順位は持たない（濃度・温度の効果は一次元の梯子に乗らない。§9-1 の硝酸と同じ理由）
    assert(rankOfHalf("H2SO4_hot_red") === null, "熱濃硫酸に順位が付いている");
    assert(!REDOX_LADDER_ACID["H2SO4/SO2"], "熱濃硫酸の対が梯子に載っている");
    // 見どころ: 銅は塩酸には溶けないが、熱濃硫酸には溶ける
    const hot = matchRedox("H2SO4_hot", "Cu", "acid");
    assert(hot.verdict === "reacts", "熱濃硫酸が銅を溶かさない: " + JSON.stringify(hot));
    assert(String(hot.stage.answer) === "1,1", "倍率が 1:1 でない: " + hot.stage.answer);
    const c = combineHalves(hot.stage, 1, 1);
    assert(compareSides(c.left, c.right).balanced, "組み上がった式がつり合わない");
    assert(c.right.some((t) => t.sp === "SO2" && t.n === 1), "SO₂ が出ない: " + JSON.stringify(c.right));
    assert(matchRedox("HCl_dil", "Cu", "acid").reasonCode === "ladder-reversed",
      "うすい塩酸×銅との対比が崩れている");
    // 列挙に無い相手は「反応しない」ではなく undecided（順位を持っていないので言えない）
    for (const red of ["Zn", "Fe", "Mg", "KI"]) {
      const r = matchRedox("H2SO4_hot", red, "acid");
      assert(r.verdict === "undecided" && r.reasonCode === "not-listed",
        "熱濃硫酸×" + red + " が undecided/not-listed でない: " + r.verdict + "/" + r.reasonCode);
      assert(!/反応しません|溶けません/.test(r.message), "熱濃硫酸×" + red + " で「反応しない」と言っている");
    }
    // 中性・塩基性では、その液性の式を持っていないので wrong-condition（反応しないとは言わない）
    assert(matchRedox("H2SO4_hot", "Cu", "basic").reasonCode === "wrong-condition",
      "中性・塩基性の扱いが wrong-condition でない");
  });

  t("M6-F 二酸化硫黄: 同じ物質が梯子に2回出て、相手しだいで役が入れ替わる", () => {
    const red = HALF_REACTIONS["SO2_ox"], ox = HALF_REACTIONS["SO2_red"];
    assert(red && ox, "SO₂ の式が2本そろっていない");
    for (const [id, hr, e, from, to] of [["SO2_ox", red, 2, 4, 6], ["SO2_red", ox, 4, 4, 0]]) {
      assert(compareSides(hr.left, hr.right).balanced, id + ": つり合わない");
      assert(electronsOf(hr) === e, id + ": e⁻ が " + e + " 個でない: " + electronsOf(hr));
      const ch = oxChangeOfHalf(hr);
      assert(ch.length === 1 && ch[0].el === "S" && ch[0].from === from && ch[0].to === to,
        id + ": S が " + from + "→" + to + " になっていない: " + JSON.stringify(ch));
    }
    // 二役の実体 ＝ **別の対**として梯子に2回出る（H₂O₂ と同じ形）
    assert(red.couple !== ox.couple, "SO₂ の2本が同じ対になっている（二役にならない）");
    assert(rankOfHalf("SO2_red") > rankOfHalf("SO2_ox"),
      "酸化剤としての SO₂ が還元剤としての SO₂ より上に無い");
    /* S/H₂S と SO₄²⁻/SO₂ は**同じ順位**（E° の差が高校で扱える解像度より細かい）。
       同値＝強弱を決めない、という §2-3 の使い方をここでもしている */
    assert(REDOX_LADDER_ACID["SO4^2-/SO2"] === REDOX_LADDER_ACID["S/H2S"],
      "S/H₂S と SO₄²⁻/SO₂ に別々の順位を付けている");
    // 選択肢には両方の顔が出る（酸化剤の欄と還元剤の欄に、同じ SO₂ が1つずつ）
    const rgs = REAGENTS.filter((r) => r.sp === "SO2");
    assert(rgs.length === 2 && new Set(rgs.map((r) => r.side)).size === 2,
      "SO₂ が両方の欄に出ていない: " + JSON.stringify(rgs.map((r) => r.side)));
    for (const r of rgs) assert(/として/.test(r.label), r.id + ": 札に役が書いていない（同じ名前が2つ並ぶ）");
    /* 見どころ①: 硫化水素が相手のときだけ酸化剤にまわる。
       2H₂S ＋ SO₂ → 3S ＋ 2H₂O（H⁺ が打ち消えて教科書の式そのものになる） */
    const a = matchRedox("SO2_asOxidant", "H2S", "acid");
    assert(a.verdict === "reacts", "SO₂ × H₂S が反応しない: " + a.reasonCode);
    assert(String(a.stage.answer) === "2,1", "倍率が 2:1 でない: " + a.stage.answer);
    const c = combineHalves(a.stage, 2, 1);
    assert(compareSides(c.left, c.right).balanced, "組み上がった式がつり合わない");
    const n = (side, sp) => (side.find((x) => x.sp === sp) || { n: 0 }).n;
    assert(n(c.left, "H2S") === 2 && n(c.left, "SO2") === 1 && n(c.left, "H+") === 0,
      "左辺が 2H₂S ＋ SO₂ でない（H⁺ が残っている）: " + JSON.stringify(c.left));
    assert(n(c.right, "S") === 3 && n(c.right, "H2O") === 2,
      "右辺が 3S ＋ 2H₂O でない: " + JSON.stringify(c.right));
    // 見どころ②: 相手が I₂ なら役が入れ替わる（酸化剤の顔では順序が逆になる）
    assert(matchRedox("SO2_asOxidant", "KI", "acid").reasonCode === "ladder-reversed",
      "SO₂（酸化剤として）× KI が ladder-reversed でない");
    assert(matchRedox("I2", "SO2_asReductant", "acid").verdict === "reacts",
      "SO₂（還元剤として）× I₂ が反応しない");
    // 還元剤としての相手は教科書が扱うものに絞る（順位だけだとほぼ全部と反応してしまう）
    const b = matchRedox("KMnO4", "SO2_asReductant", "acid");
    assert(b.verdict === "reacts" && String(b.stage.answer) === "5,2", "KMnO₄ × SO₂ が 5:2 で反応しない");
    const c2 = combineHalves(b.stage, 5, 2);
    assert(n(c2.left, "SO2") === 5 && n(c2.left, "MnO4-") === 2 && n(c2.left, "H2O") === 2,
      "左辺が 5SO₂ ＋ 2MnO₄⁻ ＋ 2H₂O でない: " + JSON.stringify(c2.left));
    assert(n(c2.right, "SO4^2-") === 5 && n(c2.right, "Mn^2+") === 2 && n(c2.right, "H+") === 4,
      "右辺が 5SO₄²⁻ ＋ 2Mn²⁺ ＋ 4H⁺ でない: " + JSON.stringify(c2.right));
    for (const ox2 of ["HNO3_dil", "AgNO3", "CuSO4"]) {
      const r = matchRedox(ox2, "SO2_asReductant", "acid");
      assert(r.verdict === "undecided" && r.reasonCode === "not-listed",
        ox2 + " × SO₂ が undecided/not-listed でない: " + r.verdict + "/" + r.reasonCode);
    }
    // うすい塩酸では酸化されない（順位が逆。ここは絞りではなく梯子が言っている）
    assert(matchRedox("HCl_dil", "SO2_asReductant", "acid").reasonCode === "ladder-reversed",
      "うすい塩酸 × SO₂ が ladder-reversed でない");
    // 自分どうし（不均化）は言い切らない。高校では扱わないし、水溶液では起こらない
    const self = matchRedox("SO2_asOxidant", "SO2_asReductant", "acid");
    assert(self.verdict === "undecided", "SO₂ どうしの不均化を言い切っている: " + self.verdict);
  });

  t("M6-F 硫化水素: 還元剤にしかなれず、硫化物の沈殿が先に立つ相手は例外で止まる", () => {
    const hr = HALF_REACTIONS["H2S_ox"];
    assert(hr, "H2S_ox が無い");
    assert(compareSides(hr.left, hr.right).balanced, "H₂S の式がつり合わない");
    assert(electronsOf(hr) === 2, "出す e⁻ が2個でない: " + electronsOf(hr));
    const ch = oxChangeOfHalf(hr);
    assert(ch.length === 1 && ch[0].el === "S" && ch[0].from === -2 && ch[0].to === 0,
      "S が −2→0 になっていない: " + JSON.stringify(ch));
    // S は −2 が下限。だから H₂S は**還元剤の欄にしか出ない**（酸化剤側の式を持たない）
    assert(OXIDATION["H2S"].S === -2 && OXIDATION["S"].S === 0, "硫黄の酸化数が想定と違う");
    const rgs = REAGENTS.filter((r) => r.sp === "H2S");
    assert(rgs.length === 1 && rgs[0].side === "red", "硫化水素が還元剤の欄以外にも出ている");
    assert(!Object.values(HALF_REACTIONS).some((h) => h.kind === "reduction" && h.couple === "S/H2S"),
      "S が −2 より下がる式を持ってしまっている");
    /* 梯子の 85（H⁺/H₂ と Cu²⁺/Cu のあいだ）に置くと、教科書どおりの相手がそろう。
       ここが1つでも崩れたら順位を置き直したということなので、実例で固定する。 */
    for (const ox of ["KMnO4", "K2Cr2O7", "O3", "H2O2_asOxidant", "HNO3_dil", "HNO3_conc", "I2"]) {
      const r = matchRedox(ox, "H2S", "acid");
      assert(r.verdict === "reacts", ox + " × 硫化水素が反応しない: " + r.reasonCode);
    }
    // うすい塩酸では酸化されない（順位が逆）＝ H₂S が「何にでも酸化される」わけではない
    const hcl = matchRedox("HCl_dil", "H2S", "acid");
    assert(hcl.verdict === "no-reaction" && hcl.reasonCode === "ladder-reversed",
      "うすい塩酸 × 硫化水素が ladder-reversed でない: " + hcl.verdict + "/" + hcl.reasonCode);
    /* Cu²⁺・Ag⁺ は順位では進む向きだが、先に黒い硫化物の沈殿ができる（AgI と同じ形の例外）。
       例外表は「梯子では reacts になるペアだけ」を載せる約束なので、
       順位のうえで reacts であることも一緒に確かめる。 */
    for (const [ox, sulfide] of [["CuSO4", "CuS"], ["AgNO3", "Ag₂S"]]) {
      const r = matchRedox(ox, "H2S", "acid");
      assert(r.verdict === "no-reaction" && r.reasonCode === "exception",
        ox + " × 硫化水素が例外にならない: " + r.verdict + "/" + r.reasonCode);
      assert(r.message.includes(sulfide), ox + ": 沈殿の名前（" + sulfide + "）が説明に無い");
      assert(/酸化還元ではありません/.test(r.message), ox + ": 酸化還元ではないことを言っていない");
    }
    // KMnO₄ × H₂S の組み上がりが教科書どおり（5H₂S ＋ 2MnO₄⁻ ＋ 6H⁺ → 5S ＋ 2Mn²⁺ ＋ 8H₂O）
    const st = matchRedox("KMnO4", "H2S", "acid").stage;
    assert(String(st.answer) === "5,2", "倍率が 5:2 でない: " + st.answer);
    const c = combineHalves(st, 5, 2);
    assert(compareSides(c.left, c.right).balanced, "組み上がった式がつり合わない");
    const n = (side, sp) => (side.find((x) => x.sp === sp) || { n: 0 }).n;
    assert(n(c.left, "H2S") === 5 && n(c.left, "MnO4-") === 2 && n(c.left, "H+") === 6,
      "左辺が 5H₂S ＋ 2MnO₄⁻ ＋ 6H⁺ でない: " + JSON.stringify(c.left));
    assert(n(c.right, "S") === 5 && n(c.right, "Mn^2+") === 2 && n(c.right, "H2O") === 8,
      "右辺が 5S ＋ 2Mn²⁺ ＋ 8H₂O でない: " + JSON.stringify(c.right));
  });

  t("M6-D 液性を変えると結果が変わる — MnO₄⁻ だけが別の式に切り替わる", () => {
    // 酸性なら Mn²⁺ の式、中性・塩基性なら MnO₂ の式（同じ試薬・同じ相手で式が変わる）
    const a = matchRedox("KMnO4", "KI", "acid");
    const b = matchRedox("KMnO4", "KI", "basic");
    assert(a.verdict === "reacts" && b.verdict === "reacts", "どちらかの液性で反応しない");
    assert(a.stage.red === "MnO4_red" && b.stage.red === "MnO4_red_neutral",
      "液性で半反応式が切り替わらない: " + a.stage.red + " / " + b.stage.red);
    // 酸性は e⁻ 5個・中性/塩基性は3個なので、倍率も変わる（5:2 → 3:2）
    assert(String(a.stage.answer) === "5,2" && String(b.stage.answer) === "3,2",
      "液性で倍率が変わらない: " + a.stage.answer + " / " + b.stage.answer);
    // 組み上がる式が教科書どおり（2MnO₄⁻ ＋ 4H₂O ＋ 6I⁻ → 2MnO₂ ＋ 8OH⁻ ＋ 3I₂）
    const c = combineHalves(b.stage, b.stage.answer[0], b.stage.answer[1]);
    assert(compareSides(c.left, c.right).balanced, "中性・塩基性で組み立てた式がつり合わない");
    const n = (side, sp) => (side.find((t) => t.sp === sp) || {}).n || 0;
    assert(n(c.left, "MnO4-") === 2 && n(c.left, "H2O") === 4 && n(c.left, "I-") === 6,
      "左辺が 2MnO₄⁻ ＋ 4H₂O ＋ 6I⁻ でない");
    assert(n(c.right, "MnO2") === 2 && n(c.right, "OH-") === 8 && n(c.right, "I2") === 3,
      "右辺が 2MnO₂ ＋ 8OH⁻ ＋ 3I₂ でない");
    // 酸性の式しか持たない試薬は、中性・塩基性では wrong-condition（＝「反応しない」とは言わない）
    const wc = matchRedox("K2Cr2O7", "FeSO4", "basic");
    assert(wc.verdict === "undecided" && wc.reasonCode === "wrong-condition", "液性違いが素通りする");
    assert(wc.message.includes("別の式") && !/反応しません|起こりません/.test(wc.message),
      "「反応しない」と言ってしまっている: " + wc.message);
    // 液性に依らない式どうし（Zn × Cu²⁺）は、どちらの液性でも同じ結論になる
    for (const pair of [["CuSO4", "Zn"], ["AgNO3", "Cu"], ["HCl_dil", "Cu"]]) {
      const x = matchRedox(pair[0], pair[1], "acid"), y = matchRedox(pair[0], pair[1], "basic");
      const same = pair[0] === "HCl_dil" ? y.reasonCode === "wrong-condition" : x.verdict === y.verdict;
      assert(same, pair.join("×") + ": 液性に依らない式のはずが結論が変わった");
    }
    /* 書き方がそろわない組み合わせ（塩基性の式 × 酸性の書き方の式）は、
       足せないことを言う。ここも「反応しない」ではない。 */
    const mix = matchRedox("KMnO4", "C2H5OH", "basic");
    assert(mix.verdict === "undecided" && mix.reasonCode === "wrong-condition",
      "書き方が食い違う組み合わせが素通りする: " + JSON.stringify(mix));
    assert(!/反応しません|起こりません/.test(mix.message), "書き方の食い違いを「反応しない」と言っている");
  });

  t("M6-D 中性・塩基性の全ペア総なめ: 3値のいずれかで、reacts の式はつり合う", () => {
    const oxs = REAGENTS.filter((r) => r.side === "ox");
    const reds = REAGENTS.filter((r) => r.side === "red");
    const tally = { reacts: 0, "no-reaction": 0, undecided: 0 };
    let wrongCond = 0;
    for (const a of oxs) {
      for (const b of reds) {
        const tag = a.id + "×" + b.id + "(basic)";
        let r;
        try { r = matchRedox(a.id, b.id, "basic"); }
        catch (e) { throw new Error(tag + ": matchRedox が例外を投げた: " + e); }
        assert(tally[r.verdict] !== undefined, tag + ": verdict が3値の外: " + r.verdict);
        tally[r.verdict]++;
        assert(typeof r.message === "string" && r.message.length > 0, tag + ": 説明文が空");
        for (const rank of new Set(Object.values(REDOX_LADDER_ACID))) {
          assert(!r.message.includes(String(rank)), tag + ": 説明文に順位の数値 " + rank + " が漏れている");
        }
        if (r.verdict === "reacts") {
          const st = r.stage;
          assert(st && st.answer, tag + ": reacts なのに合成ステージが無い");
          const c = combineHalves(st, st.answer[0], st.answer[1]);
          assert(![...c.left, ...c.right].some((t) => t.sp === "e-"), tag + ": e⁻ が残った");
          assert(compareSides(c.left, c.right).balanced, tag + ": 組み立てた式がつり合わない");
          /* 1本の式に H⁺ と OH⁻ が並んでいない（並んでいたら書き方が混ざっている）。
             実際には結びついて水になるので、そんな式は書かない。 */
          const all = [...c.left, ...c.right].map((t) => t.sp);
          assert(!(all.includes("H+") && all.includes("OH-")), tag + ": H⁺ と OH⁻ が同じ式に並んだ");
        } else {
          assert(r.reasonCode, tag + ": " + r.verdict + " なのに理由コードが無い");
          const allowed = r.verdict === "no-reaction" ? NO_REACTION_REASONS : UNDECIDED_REASONS;
          assert(allowed.includes(r.reasonCode), tag + ": " + r.verdict + " に " + r.reasonCode + " は使えない");
          if (r.reasonCode === "wrong-condition") wrongCond++;
        }
      }
    }
    // 3値がどれも死んでいない＋「別の式になる」の道が実際に通っている
    for (const k of Object.keys(tally)) assert(tally[k] > 0, k + " が1件も出ない（中性・塩基性）");
    assert(wrongCond > 0, "中性・塩基性なのに wrong-condition が1件も出ない");
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

  /* ---- B3-1: 電池モードのモデル（DESIGN_battery_electrolysis.md §3・§5）---- */

  t("B3 電極パレット: 序列（IONIZATION_SERIES）を二重に持たず、そこから絞り込んでいる", () => {
    // 電極候補はすべて序列に載っている（載っていなければ負極が決まらない）
    for (const m of BATTERY_ELECTRODES) {
      assert(IONIZATION_SERIES.includes(m), m + " が序列に無いのに電極候補にいる");
      assert(SPECIES[m] && SPECIES[m].charge === 0, m + " が単体の種でない");
    }
    // 並びも序列どおり（画面で「上ほど溶けやすい」と言い切るための土台）
    const inSeries = IONIZATION_SERIES.filter((m) => BATTERY_ELECTRODES.includes(m));
    assert(inSeries.join() === BATTERY_ELECTRODES.join(),
      "電極候補の並びが序列とずれている: " + BATTERY_ELECTRODES.join() + " / " + inSeries.join());
    // H は金属でない・Al は酸化被膜。どちらも板としては候補に出さない（§0）
    assert(!BATTERY_ELECTRODES.includes("H"), "H が電極候補に入っている");
    assert(!BATTERY_ELECTRODES.includes("Al"), "Al が電極候補に入っている");
    // ただし序列そのものからは外さない（M6 の梯子が元データ。B3 は参照するだけ）
    assert(IONIZATION_SERIES.includes("H") && IONIZATION_SERIES.includes("Al"),
      "序列のほうから H・Al が消えている（B3 が元データを書き換えてしまっている）");
  });

  t("B3 negativeOf: 全組み合わせで、イオン化傾向の大きいほうが負極になる", () => {
    let pairs = 0, sames = 0;
    for (const a of BATTERY_ELECTRODES) {
      for (const b of BATTERY_ELECTRODES) {
        const neg = negativeOf(a, b);
        if (a === b) {
          sames++;
          assert(neg === null, a + " どうしで負極が決まってしまう（差がないので流れないはず）");
          continue;
        }
        pairs++;
        const want = IONIZATION_SERIES.indexOf(a) < IONIZATION_SERIES.indexOf(b) ? a : b;
        assert(neg === want, `${a}×${b} の負極が ${neg}（${want} のはず）`);
        // 引数の順に依らない（板の左右を入れ替えても答えは同じ）
        assert(negativeOf(b, a) === neg, `${a}×${b} が引数の順で変わる`);
      }
    }
    assert(pairs === 20 && sames === 5, `組み合わせの数が合わない: ${pairs} / ${sames}`);
    // 序列に無い金属は判定しない（「反応しない」ではなく「決めない」）
    assert(negativeOf("Zn", "Au") === null, "序列に無い金属で負極を決めてしまう");
    assert(negativeOf("Al", "Cu") === "Al", "序列に載っていれば電極候補外でも順位は引ける");
  });

  t("B3 halvesForPair: 負極は酸化・正極は還元の式が引け、引けない組は理由を返す", () => {
    let ok = 0, noHalf = 0;
    for (const a of BATTERY_ELECTRODES) {
      for (const b of BATTERY_ELECTRODES) {
        const h = halvesForPair(a, b);
        if (a === b) { assert(h.reason === "same-metal", a + " どうしの理由が same-metal でない"); continue; }
        if (h.reason === "no-half") {
          noHalf++;
          // 収録していないだけ。負極がどちらかは言えている
          assert(h.neg && h.pos, "no-half なのに負極・正極が決まっていない");
          assert(!h.ox && !h.red, "no-half なのに式が付いている（式を捏造している）");
          continue;
        }
        ok++;
        const oxHR = HALF_REACTIONS[h.ox], redHR = HALF_REACTIONS[h.red];
        assert(oxHR.kind === "oxidation", h.ox + " が酸化の式でない");
        assert(redHR.kind === "reduction", h.red + " が還元の式でない");
        // 負極の板が溶ける＝負極の金属の単体が酸化の式の左辺にいる
        assert(oxHR.left.some((x) => x.sp === h.neg), `${h.neg} が負極の式の左辺にいない`);
        // 正極には相手の金属が析出する＝正極の金属の単体が還元の式の右辺にいる
        assert(redHR.right.some((x) => x.sp === h.pos), `${h.pos} が正極の式の右辺にいない`);
        // 板の左右を入れ替えても同じ2本
        const r = halvesForPair(b, a);
        assert(r.ox === h.ox && r.red === h.red, `${a}×${b} が引数の順で変わる`);
      }
    }
    /* 順序つき20組のうち、式まで引けるのは14組（左右を入れ替えた同じ組も数えている）。
       残り6組（Mg×Zn・Mg×Fe・Zn×Fe とその裏返し）は、正極側の還元の式
       （Zn²⁺＋2e⁻→Zn・Fe²⁺＋2e⁻→Fe）を収録していないので no-half。 */
    assert(ok === 14 && noHalf === 6, `式が引けた組の数が合わない: ok=${ok} noHalf=${noHalf}`);
  });

  t("B3 電池の足し合わせ: 全ペアで e⁻ が消え、原子と電荷が保存し、最簡整数比になる", () => {
    for (const a of BATTERY_ELECTRODES) {
      for (const b of BATTERY_ELECTRODES) {
        const h = halvesForPair(a, b);
        if (!h.stage) continue;
        const st = h.stage, [x, y] = st.answer;
        // 導出した倍率が既存の判定（e⁻ の数＋最簡整数比）を通る
        assert(checkRedoxMultipliers(st, x, y).ok, `${a}×${b} の導出倍率 ${x}:${y} が通らない`);
        assert(gcdAll(st.answer) === 1, `${a}×${b} の倍率が最簡整数比でない`);
        // 1つずらせば落ちる（判定が効いていることの検査）
        assert(!checkRedoxMultipliers(st, x + 1, y).ok, `${a}×${b} で倍率をずらしても通ってしまう`);
        const c = combineHalves(st, x, y);
        const all = [...c.left, ...c.right];
        assert(!all.some((tm) => tm.sp === "e-"), `${a}×${b} の足し合わせに e⁻ が残っている`);
        const cmp = compareSides(c.left, c.right);
        assert(cmp.balanced, `${a}×${b} の足し合わせがつり合わない: ` + JSON.stringify(cmp));
        // 負極の金属が溶け、正極の金属が析出する向きになっている
        assert(c.left.some((tm) => tm.sp === h.neg), `${a}×${b}: 負極の金属が左辺にいない`);
        assert(c.right.some((tm) => tm.sp === h.pos), `${a}×${b}: 正極の金属が右辺にいない`);
      }
    }
  });

  t("B3 ダニエル電池（b1）: 倍率 1:1・電池式・イオン反応式が教科書どおり", () => {
    const stage = BATTERY_STAGES.find((s) => s.id === "b1");
    assert(stage, "b1 が無い");
    const h = halvesForPair(stage.metals[0], stage.metals[1]);
    assert(h.neg === "Zn" && h.pos === "Cu", "ダニエル電池の負極が Zn・正極が Cu でない");
    assert(h.ox === "Zn_ox" && h.red === "Cu_red", "引かれた式が違う: " + h.ox + " / " + h.red);
    const st = batteryStageOf(stage);
    assert(st.answer.join(":") === "1:1", "倍率が 1:1 でない: " + st.answer.join(":"));
    assert(st.id === "battery:b1", "ステージ id が自由組み立てのままになっている: " + st.id);
    // 電池式は教科書表記（負極を左・正極を右、電解液を縦棒で挟む）
    assert(cellNotation(stage) === "(−) Zn | ZnSO₄ aq | CuSO₄ aq | Cu (+)",
      "電池式が教科書表記でない: " + cellNotation(stage));
    // 足し合わせ Zn ＋ Cu²⁺ → Zn²⁺ ＋ Cu
    const c = combineHalves(st, 1, 1);
    const fmt = (terms) => terms.map((x) => (x.n > 1 ? x.n : "") + x.sp).sort().join("+");
    assert(fmt(c.left) === "Cu^2++Zn", "左辺が Zn ＋ Cu²⁺ でない: " + fmt(c.left));
    assert(fmt(c.right) === "Cu+Zn^2+", "右辺が Zn²⁺ ＋ Cu でない: " + fmt(c.right));
    // 電解液は「役」ではなく「金属」で引く（電極を選び直しても役が入れ替わるだけで済む）
    assert(stage.electrolyte.Zn === "ZnSO4" && stage.electrolyte.Cu === "CuSO4",
      "電解液が金属で引ける形になっていない");
  });

  /* ---- B3-4: b2「電極を選ぶ」課題（実装の刻み4）---- */

  t("B3 b2: 板を自分で選ぶステージがあり、どちらが負極かをデータに持っていない", () => {
    const st = BATTERY_STAGES.find((s) => s.id === "b2");
    assert(st, "b2 が無い");
    assert(st.choose === true, "b2 が選択ステージになっていない");
    // metals も electrolyte も答えも持たない ＝ 役はすべて negativeOf が決める
    assert(!st.metals, "b2 が板を先に決めてしまっている");
    assert(!st.electrolyte, "b2 が電解液を役で先に決めてしまっている");
    assert(!st.answer, "b2 が倍率を直書きしている");
    assert(st.electrodes && st.electrodes.join() === BATTERY_ELECTRODES.join(),
      "パレットが電極候補と別物になっている: " + (st.electrodes || []).join());
  });

  t("B3 batteryPartnersOf: 言い切れる組だけを候補にし、同じ金属は残す", () => {
    for (const m of BATTERY_ELECTRODES) {
      const ps = batteryPartnersOf(m);
      // 自分自身は必ず残す（「差がないと流れない」は言い切れる結論。§2-1）
      assert(ps.includes(m), m + ": 同じ金属どうしが候補から消えている");
      for (const p of ps) {
        if (p === m) continue;
        const h = halvesForPair(m, p);
        assert(h.ox && h.red, `${m}×${p} を候補にしているのに式が引けない`);
      }
      // 候補から外れたものは「式が無い」からで、負極が決まらないからではない
      for (const p of BATTERY_ELECTRODES.filter((x) => !ps.includes(x))) {
        const h = halvesForPair(m, p);
        assert(h.reason === "no-half", `${m}×${p} を外した理由が no-half でない: ` + h.reason);
        assert(h.neg, `${m}×${p}: 負極は決まっているのに候補から外している`);
      }
      assert(ps.every((x) => BATTERY_ELECTRODES.includes(x)), m + ": 候補外の金属が混ざっている");
    }
    // 具体値で固定（Cu と Ag だけが還元の式を持つので、この2つは全員と組める）
    assert(batteryPartnersOf("Mg").join() === "Mg,Cu,Ag", "Mg の相手: " + batteryPartnersOf("Mg").join());
    assert(batteryPartnersOf("Zn").join() === "Zn,Cu,Ag", "Zn の相手: " + batteryPartnersOf("Zn").join());
    assert(batteryPartnersOf("Cu").join() === "Mg,Zn,Fe,Cu,Ag", "Cu の相手: " + batteryPartnersOf("Cu").join());
    assert(batteryPartnersOf("Ag").join() === "Mg,Zn,Fe,Cu,Ag", "Ag の相手: " + batteryPartnersOf("Ag").join());
    assert(batteryPartnersOf("Au").length === 0, "電極候補でない金属に相手が付く");
  });

  t("B3 相対性: 同じ金属でも、相手を変えると負極と正極が入れ替わる", () => {
    // これが b2 の狙い（設計 §1-3）。Cu が両方の役をやれることを値で固定する
    assert(halvesForPair("Zn", "Cu").pos === "Cu", "Cu が Zn と組んで正極にならない");
    assert(halvesForPair("Cu", "Ag").neg === "Cu", "Cu が Ag と組んで負極にならない");
    // 式も入れ替わる（役がデータでなく導出であることの裏取り）
    assert(halvesForPair("Zn", "Cu").red === "Cu_red", "正極側が Cu の還元式でない");
    assert(halvesForPair("Cu", "Ag").ox === "Cu_ox", "負極側が Cu の酸化式でない");
    // 端の2つは役が固定される（序列の端だから。これも発見のうち）
    for (const p of batteryPartnersOf("Mg")) if (p !== "Mg") {
      assert(halvesForPair("Mg", p).neg === "Mg", "Mg が負極にならない相手がいる: " + p);
    }
    for (const p of batteryPartnersOf("Ag")) if (p !== "Ag") {
      assert(halvesForPair("Ag", p).pos === "Ag", "Ag が正極にならない相手がいる: " + p);
    }
  });

  t("B3 電解液: どの電極にも電解液があり、その金属の陽イオンを含む", () => {
    for (const m of BATTERY_ELECTRODES) {
      const salt = electrolyteFor({}, m);
      assert(salt && SPECIES[salt], m + ": 電解液が無い（板は選べるのに槽が作れない）");
      const ions = DISSOCIATION[salt];
      assert(ions, salt + ": 電離表が無い");
      // 正極では相手のイオンが e⁻ を受け取る。その相手が液に居ないと絵が嘘になる
      const cation = ions.find((i) => SPECIES[i].charge > 0);
      assert(cation && Object.keys(SPECIES[cation].atoms).join() === m,
        `${m} の電解液 ${salt} に ${m} の陽イオンが居ない: ` + ions.join("+"));
    }
    // ステージが明示していればそちらが勝つ（b1 のダニエル電池は硫酸塩で固定）
    const b1 = BATTERY_STAGES.find((s) => s.id === "b1");
    assert(electrolyteFor(b1, "Zn") === "ZnSO4" && electrolyteFor(b1, "Cu") === "CuSO4",
      "ステージの指定が既定表に負けている");
  });

  t("B3 b2: 選んだ2枚を差し込むと、電池式も倍率も全部そこから導かれる", () => {
    const b2 = BATTERY_STAGES.find((s) => s.id === "b2");
    const withMetals = (a, b) => Object.assign({}, b2, { metals: [a, b] });
    // 左右を入れ替えても電池式は同じ（(−) を左に置くのは negativeOf の答え）
    assert(cellNotation(withMetals("Ag", "Cu")) === "(−) Cu | CuSO₄ aq | AgNO₃ aq | Ag (+)",
      "Ag×Cu の電池式: " + cellNotation(withMetals("Ag", "Cu")));
    assert(cellNotation(withMetals("Cu", "Ag")) === cellNotation(withMetals("Ag", "Cu")),
      "板の左右で電池式が変わる");
    assert(cellNotation(withMetals("Mg", "Cu")) === "(−) Mg | MgSO₄ aq | CuSO₄ aq | Cu (+)",
      "Mg×Cu の電池式: " + cellNotation(withMetals("Mg", "Cu")));
    // 倍率も導出（Ag は 1e⁻ なので 1:2 が出る）
    assert(batteryStageOf(withMetals("Zn", "Ag")).answer.join(":") === "1:2",
      "Zn×Ag の倍率: " + batteryStageOf(withMetals("Zn", "Ag")).answer.join(":"));
    assert(batteryStageOf(withMetals("Zn", "Cu")).answer.join(":") === "1:1", "Zn×Cu の倍率");
    // 板がそろっていない・組めない盤面では、式を捏造せず null を返す
    assert(cellNotation(withMetals(null, "Cu")) === null, "板が1枚でも電池式を出してしまう");
    assert(cellNotation(withMetals("Zn", "Zn")) === null, "同じ金属2枚で電池式を出してしまう");
    assert(batteryStageOf(withMetals("Zn", "Zn")) === null, "同じ金属2枚でステージが組めてしまう");
    assert(batteryStageOf(withMetals(undefined, undefined)) === null, "板が無いのにステージが組める");
    // 板を選ぶ前は「同じ金属だから流れない」と言わない（まだ何も選んでいないだけ）
    assert(halvesForPair(undefined, undefined).reason === "not-ranked",
      "板を選ぶ前を same-metal と言っている");
  });

  /* ---- M（2026-08-18 実機指摘）板の左右をランダムにする ----
     ⚠ **測定の問題。** 左が固定だと生徒は化学ではなく位置で答えられる。
     ⚠ Math.random() を直に呼ぶ実装だと、この検査そのものが書けない。
     並びを決める arrangeElectrodes は乱数を持たない純関数、
     乱数は setCellRandomSeed で種を差せる——この分け方自体をここで固定する。 */
  t("M arrangeElectrodes: 並びを決めるのは flip だけ（乱数を持たない純関数）", () => {
    assert(typeof arrangeElectrodes === "function", "並びを決める関数が無い");
    assert(arrangeElectrodes(["Zn", "Cu"], false).join() === "Zn,Cu", "flip なしで入れ替わる");
    assert(arrangeElectrodes(["Zn", "Cu"], true).join() === "Cu,Zn", "flip しても入れ替わらない");
    // 2回呼んでも同じ（乱数を内側で引いていない）
    assert(arrangeElectrodes(["Zn", "Cu"], true).join() === arrangeElectrodes(["Zn", "Cu"], true).join(),
      "同じ引数で結果が変わる ＝ 中で乱数を引いている");
    // 元の配列を書き換えない（ステージのデータを壊さない）
    const src = ["Zn", "Cu"];
    arrangeElectrodes(src, true);
    assert(src.join() === "Zn,Cu", "元の metals を書き換えている: " + src.join());
    // 2枚そろっていない盤面（b2 の選びかけ）は入れ替えず、そのまま返す
    assert(arrangeElectrodes(["Zn"], true).join() === "Zn", "1枚のときに空きが混ざる: " +
      JSON.stringify(arrangeElectrodes(["Zn"], true)));
    assert(arrangeElectrodes([], true).length === 0 && arrangeElectrodes(null, false).length === 0,
      "空でも落ちないこと");
  });

  t("M setCellRandomSeed: 種を差せば決定的・差さなければ毎回ちがう", () => {
    assert(typeof setCellRandomSeed === "function" && typeof rollElectrodeFlip === "function",
      "種を差し込む口が無い ＝ 決定的に検査できない実装");
    const runOf = (seed, n) => {
      setCellRandomSeed(seed);
      return Array.from({ length: n }, () => rollElectrodeFlip());
    };
    assert(runOf(12345, 20).join() === runOf(12345, 20).join(), "同じ種で並びが再現しない");
    assert(runOf(12345, 20).join() !== runOf(999, 20).join(), "種を変えても同じ並びが出る");
    // 表も裏も出る（片方に寄りきっていない ＝ 位置で当てられない）
    const r = runOf(20260818, 200);
    const trues = r.filter(Boolean).length;
    assert(trues > 60 && trues < 140, "200回の入れ替えが偏りすぎ: " + trues + "回");
    // 種を外すと本番（Math.random）に戻る。ここは値でなく「落ちないこと」だけ見る
    setCellRandomSeed(null);
    assert(typeof rollElectrodeFlip() === "boolean", "種を外すと真偽値を返さない");
  });

  /* ---- B3-5: 電気分解（実装の刻み5）---- */

  t("B3 Cl_ox: 陽極の式が保存し、梯子には載せていない（自由組み立てに漏らさない）", () => {
    const hr = HALF_REACTIONS["Cl_ox"];
    assert(hr && hr.kind === "oxidation", "Cl_ox が無いか向きが違う");
    assert(compareSides(hr.left, hr.right).balanced, "2Cl⁻ → Cl₂ ＋ 2e⁻ がつり合わない");
    assert(electronsOf(hr) === 2, "e⁻ が2個でない: " + electronsOf(hr));
    // 酸化数 −1 → 0 が2原子ぶんで +2 ＝ e⁻ 2個（帳尻の独立検算）
    assert(oxSum("Cl-") === -1 && oxSum("Cl2") === 0, "塩素の酸化数が入っていない");
    /* 電気分解は電源が押し込む反応なので、酸化還元の強さ比べ（梯子）には載せない。
       載せると自由組み立てモードが「Cl⁻ は誰と反応するか」を勝手に答えてしまう。 */
    assert(REDOX_LADDER_ACID["Cl2/Cl-"] === undefined, "Cl₂/Cl⁻ が梯子に載っている");
    assert(rankOfHalf("Cl_ox") === null, "順位を持ってしまっている: " + rankOfHalf("Cl_ox"));
    // 試薬パレット（自由組み立て）にも増えていない
    assert(!REAGENTS.some((r) => Object.values(r.half || {}).includes("Cl_ox")),
      "自由組み立ての試薬に Cl_ox が混ざっている");
  });

  t("B3 電気分解: 両ステージで倍率が導け、原子・電荷が保存する", () => {
    assert(ELECTROLYSIS_STAGES.length === 2, "電気分解のステージ数が2でない");
    const want = { e1: "1:1", e2: "1:2" };            // [陽極 ×a, 陰極 ×b]
    for (const st of ELECTROLYSIS_STAGES) {
      assert(HALF_REACTIONS[st.anode].kind === "oxidation", st.id + ": 陽極が酸化の式でない");
      assert(HALF_REACTIONS[st.cathode].kind === "reduction", st.id + ": 陰極が還元の式でない");
      assert(!st.answer, st.id + ": 倍率を直書きしている（導出に一本化するはず）");
      assert(SPECIES[st.solution], st.id + ": 電解液が SPECIES に無い");
      assert(["C", "Pt"].includes(st.electrode), st.id + ": 電極が不活性でない（§3-3）");
      const n = electrolysisStageOf(st);
      assert(n && n.id === "electrolysis:" + st.id, st.id + ": 正規化したステージの id が違う");
      const [a, b] = n.answer;
      assert(a + ":" + b === want[st.id], st.id + " の倍率: " + a + ":" + b);
      // e⁻ の数が両極でそろう（独立に数え直す）
      assert(electronsOf(HALF_REACTIONS[n.ox]) * a === electronsOf(HALF_REACTIONS[n.red]) * b,
        st.id + ": e⁻ の数がそろわない");
      assert(checkRedoxMultipliers(n, a, b).ok, st.id + ": 導出倍率が判定を通らない");
      assert(!checkRedoxMultipliers(n, a * 2, b * 2).ok, st.id + ": 2倍を通した");
      const c = combineHalves(n, a, b);
      assert(![...c.left, ...c.right].some((x) => x.sp === "e-"), st.id + ": e⁻ が残った");
      assert(compareSides(c.left, c.right).balanced, st.id + ": 全体の反応がつり合わない");
      // 電解液が、両極で使われるイオンをちゃんと供給している（絵と式が食い違わないための検査）
      const ions = DISSOCIATION[st.solution] || [];
      for (const x of [...HALF_REACTIONS[st.anode].left, ...HALF_REACTIONS[st.cathode].left]) {
        if (x.sp === "e-" || SPECIES[x.sp].charge === 0) continue;   // 水など中性の種は液そのもの
        assert(ions.includes(x.sp), `${st.id}: ${st.solution} が ${x.sp} を出さない`);
      }
    }
    // 具体値で固定: Cu²⁺ ＋ 2Cl⁻ → Cu ＋ Cl₂ ／ 2H₂O → O₂ ＋ 2H₂
    const fmt = (t2) => t2.map((x) => (x.n > 1 ? x.n : "") + x.sp).sort().join("+");
    const e1 = electrolysisStageOf(ELECTROLYSIS_STAGES[0]);
    const c1 = combineHalves(e1, 1, 1);
    assert(fmt(c1.left) === "2Cl-+Cu^2+" && fmt(c1.right) === "Cl2+Cu", "e1: " + fmt(c1.left) + "→" + fmt(c1.right));
    const e2 = electrolysisStageOf(ELECTROLYSIS_STAGES[1]);
    const c2 = combineHalves(e2, 1, 2);
    // H⁺ は両辺で 4個ずつ打ち消える（水の電気分解の見どころ）
    assert(fmt(c2.left) === "2H2O" && fmt(c2.right) === "2H2+O2", "e2: " + fmt(c2.left) + "→" + fmt(c2.right));
  });

  t("B3 用語: 同じ酸化側なのに、電池は負極・電気分解は陽極（教科書表記）", () => {
    const bt = electrodeTerms("battery"), el = electrodeTerms("electrolysis");
    assert(bt.ox === "負極(−)" && bt.red === "正極(+)", "電池の呼び名: " + bt.ox + "/" + bt.red);
    assert(el.ox === "陽極" && el.red === "陰極", "電気分解の呼び名: " + el.ox + "/" + el.red);
    // 札には向き（酸化・還元）も添える。これが両モードをつなぐ手すり
    assert(bt.oxTag.includes("酸化") && el.oxTag.includes("酸化"), "酸化側の札に酸化と書いていない");
    assert(bt.redTag.includes("還元") && el.redTag.includes("還元"), "還元側の札に還元と書いていない");
    // 混ぜない: 電池側に陰極・陽極が、電気分解側に負極・正極が混ざらない
    const bAll = Object.values(bt).join(), eAll = Object.values(el).join();
    assert(!/陰極|陽極/.test(bAll), "電池の呼び名に陰極・陽極が混ざっている: " + bAll);
    assert(!/負極|正極/.test(eAll), "電気分解の呼び名に負極・正極が混ざっている: " + eAll);
    // 知らないモードを渡しても落ちない（既定は電池）
    assert(electrodeTerms("なにか").ox === "負極(−)", "未知のモードで落ちる");
  });

  t("B3 ステージ表: 電池2つ・電気分解2つが並び、id も種別も重複しない", () => {
    assert(CELL_STAGES.length === BATTERY_STAGES.length + ELECTROLYSIS_STAGES.length,
      "ステージ表の数が合わない: " + CELL_STAGES.length);
    const ids = CELL_STAGES.map((s) => s.id);
    assert(new Set(ids).size === ids.length, "ステージ id が重複: " + ids.join(","));
    for (const s of CELL_STAGES) {
      assert(s.kind === "battery" || s.kind === "electrolysis", s.id + ": kind が無い");
      assert(s.title && s.intro, s.id + ": 題名か導入文が無い");
      // **電位・起電力の数値を出さない**（§6）。導入文にも書かない
      assert(!/\d+\s*V|電位|起電力|ネルンスト/.test(s.intro), s.id + ": 導入文が電位に触れている");
      // ボルタ電池は入れない（§6。分極の説明なしには嘘になる）
      assert(!/ボルタ/.test(s.title + s.intro), s.id + ": ボルタ電池が入っている");
    }
    // 電気分解では電極を選ばせない（§3-3）
    for (const s of ELECTROLYSIS_STAGES) assert(!s.choose, s.id + ": 電気分解で電極を選ばせている");
  });

  t("B3 序列は参照であって複製でない: 梯子を動かすと負極の判定も動く", () => {
    // 梯子（REDOX_LADDER_ACID）が唯一の原理データであることの検査。
    // B3 が自前の配列を持っていたら、梯子を差し替えても導出結果が変わらない
    const saved = REDOX_LADDER_ACID["Zn^2+/Zn"];
    try {
      REDOX_LADDER_ACID["Zn^2+/Zn"] = 95;                   // Cu と Ag のあいだへ動かす
      const moved = ionizationSeriesFromLadder();
      assert(moved.indexOf("Zn") > moved.indexOf("Cu"),
        "梯子を動かしても導出が変わらない（どこかに序列の複製がある）: " + moved.join(">"));
      assert(halfOfMetal("Zn", "oxidation") === "Zn_ox", "順位を動かすと式まで引けなくなる");
    } finally {
      REDOX_LADDER_ACID["Zn^2+/Zn"] = saved;
    }
    assert(ionizationSeriesFromLadder().join() === IONIZATION_SERIES.join(), "梯子を戻せていない");
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

  /* ---- 系列（ステージの仲間分け）【R】DESIGN_stage_series.md ----
     ⚠ ここは**1件でも漏れたら赤**にする。系列は「重ならない分け方」なので、
     取りこぼしたステージが黙ってどこにも出なくなるのがいちばん怖い事故。 */
  t("系列: 全 62 ステージがちょうど1つの系列に入り、取りこぼしが1件も無い", () => {
    const r = stagesBySeries();
    const expected = STAGES.length + REDOX_STAGES.length + CONDITION_STAGES.length + CELL_STAGES.length;
    assert(r.total === expected, "並べたステージ数が合わない: " + r.total + " / " + expected);
    // ① どこにも入らなかったもの（seriesOfStage が null）を名指しで出す
    assert(r.unclassified.length === 0,
      "系列に入らないステージがある: " + r.unclassified.map((s) => s.mode + s.no + ":" + s.id).join(", "));
    // ② 合計が全数と一致（＝二重計上も取りこぼしも無い）
    const sum = r.groups.reduce((a, g) => a + g.stages.length, 0);
    assert(sum === r.total, "系列ごとの件数の合計が全数と合わない: " + sum + " / " + r.total);
    // ③ 同じステージが2つの系列に出ていない（partition であることの直接確認）
    const seen = new Set();
    for (const g of r.groups) {
      for (const s of g.stages) {
        const key = s.mode + ":" + s.id;
        assert(!seen.has(key), "2つの系列に出ている: " + key);
        seen.add(key);
      }
    }
    assert(seen.size === expected, "系列から引けるステージが全数に足りない: " + seen.size);
  });

  t("系列: 定義そのものが健全（id・名前・説明が重複なくそろう）", () => {
    const ids = new Set(), names = new Set();
    for (const sr of STAGE_SERIES) {
      assert(/^sr-[a-z-]+$/.test(sr.id), "系列 id の形が想定外: " + sr.id);
      assert(!ids.has(sr.id), "系列 id が重複: " + sr.id);
      ids.add(sr.id);
      assert(sr.name && !names.has(sr.name), "系列名が空か重複: " + sr.name);
      names.add(sr.name);
      assert(sr.note, sr.id + ": 説明が無い");
      assert(Array.isArray(sr.modes) && Array.isArray(sr.tags), sr.id + ": modes / tags が配列でない");
      // タグ指定とモード指定を混ぜない（どちらで決まったのか読めなくなる）
      assert(!(sr.modes.length && sr.tags.length), sr.id + ": modes と tags の両方を持っている");
      assert(sr.modes.length || sr.tags.length, sr.id + ": 何も指定していない");
    }
    // タグで決める系列のタグは、実在する STAGE_TAGS のタグであること（打ち間違いは黙って消える）
    const known = new Set(Object.values(STAGE_TAGS).reduce((a, b) => a.concat(b), []));
    for (const sr of STAGE_SERIES) {
      for (const tg of sr.tags) assert(known.has(tg), sr.id + ": 誰も付けていないタグ " + tg);
    }
  });

  t("系列: 内訳が想定どおり（酸塩基19・沈殿14・分子7・酸化還元18・電池4）", () => {
    const want = { "sr-acid-base": 19, "sr-precipitate": 14, "sr-molecule": 7, "sr-redox": 18, "sr-cell": 4 };
    for (const g of stagesBySeries().groups) {
      assert(g.stages.length === want[g.series.id],
        g.series.id + " の件数が変わった: " + g.stages.length + "（想定 " + want[g.series.id] + "）");
    }
    // 番号はアプリの帯と同じ順番から作る＝**並べ替えていない**ことの担保。
    // ユーザーは「31」「18-21」「34-」と通し番号で呼ぶので、ここがずれたら会話と画面が食い違う
    const byNo = {};
    for (const g of stagesBySeries().groups) for (const s of g.stages) if (s.mode === "ion") byNo[s.no] = s.id;
    assert(byNo[8] === "s8", "ion 8 が s8 でない: " + byNo[8]);
    assert(byNo[18] === "cu-nh3-step2", "ion 18 がずれた: " + byNo[18]);
    assert(byNo[21] === "complex-agcl-nh3", "ion 21 がずれた: " + byNo[21]);
    assert(byNo[31] === "hydrolysis-ch3coona", "ion 31 がずれた: " + byNo[31]);
    assert(byNo[34] === "combustion-c-o2", "ion 34 がずれた: " + byNo[34]);
    STAGES.forEach((st, i) => assert(byNo[i + 1] === st.id, "ion " + (i + 1) + " の番号が帯とずれた"));
  });

  t("系列: 重なるステージ（中和かつ沈殿）は規則で酸と塩基に入る（s8 を名指ししていない）", () => {
    // s8 は「中和＋沈殿」で本当に両方。分類のミスではなく事実の重なりなので、
    // **並び順の規則**で決めている。id で分岐していないことを、規則の側から確かめる
    assert(STAGE_TAGS["s8"].includes("中和") && STAGE_TAGS["s8"].includes("沈殿"), "s8 の前提が変わった");
    const st = STAGES.find((s) => s.id === "s8");
    assert(seriesOfStage("ion", st).id === "sr-acid-base", "s8 が酸と塩基に入らない");
    // 中和のタグを持たない架空のステージは沈殿へ落ちる＝規則が id ではなくタグを見ている
    const fake = { id: "__fake__" };
    STAGE_TAGS["__fake__"] = ["沈殿"];
    assert(seriesOfStage("ion", fake).id === "sr-precipitate", "タグだけの判定になっていない");
    STAGE_TAGS["__fake__"] = ["中和", "沈殿"];
    assert(seriesOfStage("ion", fake).id === "sr-acid-base", "重なりの優先順位が並び順で決まっていない");
    // タグが1つも無ければ「どこにも入らない」＝ null（黙って既定の系列へ吸わせない）
    STAGE_TAGS["__fake__"] = ["原子の保存"];
    assert(seriesOfStage("ion", fake) === null, "知らないタグのステージが系列に入ってしまう");
    delete STAGE_TAGS["__fake__"];
  });

  t("系列と難度は別の軸（有機（発展）は酸化還元の系列から抜けない）", () => {
    const redox = stagesBySeries().groups.find((g) => g.series.id === "sr-redox");
    const organic = redox.stages.filter((s) => s.mode === "redox" && isOrganicStage(s.stage));
    assert(organic.length === 5, "有機（発展）が酸化還元の系列に5本そろっていない: " + organic.length);
    assert(organic.map((s) => s.no).join(",") === "8,9,10,11,12",
      "有機（発展）の番号が 8〜12 でない: " + organic.map((s) => s.no).join(","));
    // 液性モードも同じ系列にいる（半反応式の書き換えなので酸化還元の仲間）
    assert(redox.stages.some((s) => s.mode === "condition"), "液性モードが酸化還元の系列に入っていない");
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

  /* ---- 瓶から化学反応式を組み立てる（v180・DESIGN_redox.md）---- */

  t("BOTTLE: 塩の組成が電荷から導け、組成式の原子数と一致する", () => {
    for (const key of Object.keys(SALT_FORMULA)) {
      const [c, an] = key.split("|");
      assert(SPECIES[c] && SPECIES[an], key + ": 種が無い");
      const u = saltOf(c, an);
      assert(u, key + ": saltOf が引けない");
      // 電荷が釣り合う（＝塩は中性）
      assert(SPECIES[c].charge * u.cn + SPECIES[an].charge * u.an === 0,
        key + ": 電荷が釣り合わない " + u.cn + "/" + u.an);
      // 個数は最小（どちらかの係数が1になる）
      assert(gcd2(u.cn, u.an) === 1, key + ": 個数が最簡でない");
      // 組成式の原子数と一致する（Fe(SO₄) のような釣り合わない塩を黙って通さない）
      const L = tallyTerms([{ sp: c, n: u.cn }, { sp: an, n: u.an }]);
      const R = tallyTerms([{ sp: u.sp, n: 1 }]);
      assert(JSON.stringify(sortObjKeys(L.atoms)) === JSON.stringify(sortObjKeys(R.atoms)),
        key + ": " + u.sp + " の原子数が " + u.cn + c + "+" + u.an + an + " と合わない");
      assert(R.charge === 0, u.sp + ": 塩が中性でない");
    }
  });

  t("BOTTLE: 瓶を持つ全ステージで化学反応式が導け、原子と電荷が保存し最簡整数比になる", () => {
    const withBottles = REDOX_STAGES.filter((s) => s.bottles);
    assert(withBottles.length >= 8, "瓶を持つステージが少なすぎる: " + withBottles.length);
    for (const st of withBottles) {
      const [a, b] = st.answer;
      const s = minBottleScale(st, a, b);
      assert(s, st.id + ": 成立する倍率が見つからない: " + bottlePlan(st, a, b, 1).reason);
      const p = bottlePlan(st, a, b, s);
      assert(!p.dataError, st.id + ": " + p.dataError);
      assert(p.ok, st.id + ": 組み立てが完成しない: " + p.reason);
      // **係数を独立に数え直す**（bottlePlan の内部と同じ道を通らない検算）
      const cmp = compareSides(p.left, p.right);
      assert(cmp.balanced, st.id + ": 原子か電荷が保存しない: " + JSON.stringify(cmp));
      assert(gcdAll(p.coeffs) === 1, st.id + ": 最簡整数比でない: " + p.coeffs);
      assert(p.left.every((x) => x.n >= 1) && p.right.every((x) => x.n >= 1), st.id + ": 係数に0がある");
      // 左辺は**瓶そのもの**（イオンが1つも出てこない）
      for (const x of p.left) assert(SPECIES[x.sp].charge === 0, st.id + ": 左辺にイオン " + x.sp + " が出ている");
      for (const x of p.right) assert(SPECIES[x.sp].charge === 0, st.id + ": 右辺にイオン " + x.sp + " が出ている");
      // 傍観イオンは「加えた」のではなく瓶が連れてきたもの ＝ どこかの瓶の riders になっている
      const ridden = new Set(p.bottles.flatMap((B) => B.riders.map((r) => r.sp)));
      for (const c of p.cations.concat(p.anions)) {
        const fromRight = p.ionic.right.some((x) => x.sp === c.sp);
        assert(fromRight || ridden.has(c.sp), st.id + ": " + c.sp + " の出どころが無い");
      }
    }
  });

  t("BOTTLE: 瓶からの導出が、手で書いた molecularEq 5本の模範係数を再現する", () => {
    // この段の値打ちはここにある —— rs1・rs2 のために作った導出が、
    // **すでに検算済みの5本**（ro1〜ro3・rn1・rn2）に裏を取られる
    let checked = 0;
    for (const st of REDOX_STAGES.filter((s) => s.molecularEq && s.bottles)) {
      const me = st.molecularEq;
      const [a, b] = st.answer;
      const p = bottlePlan(st, a, b, minBottleScale(st, a, b));
      const want = {}, got = {};
      me.reactants.forEach((sp, i) => { want["L|" + sp] = me.answer[i]; });
      me.products.forEach((sp, i) => { want["R|" + sp] = me.answer[me.reactants.length + i]; });
      p.left.forEach((x) => { got["L|" + x.sp] = x.n; });
      p.right.forEach((x) => { got["R|" + x.sp] = x.n; });
      // 並び順は筆算（molecularEq）と瓶で違ってよい。一致を見るのは**項と係数の組**
      assert(JSON.stringify(sortObjKeys(want)) === JSON.stringify(sortObjKeys(got)),
        st.id + ": 瓶から導いた係数が模範と違う " + JSON.stringify(got) + " / " + JSON.stringify(want));
      checked++;
    }
    assert(checked === 5, "照合できた既存ステージが5本でない: " + checked);
  });

  t("BOTTLE: rs1 は倍率 ×2 が要り、rs2 は ×1 で済む（あまりの理由を言う）", () => {
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    const rs2 = REDOX_STAGES.find((s) => s.id === "rs2");
    assert(minBottleScale(rs1, 5, 1) === 2, "rs1 の最小倍率が2でない: " + minBottleScale(rs1, 5, 1));
    assert(minBottleScale(rs2, 6, 1) === 1, "rs2 の最小倍率が1でない: " + minBottleScale(rs2, 6, 1));
    // ×1 では Fe³⁺ が5個であまる。**何が何個ずつ要るか**まで言い、倍率そのものは言わない
    const p1 = bottlePlan(rs1, 5, 1, 1);
    assert(!p1.ok, "rs1 の ×1 を通した");
    assert(p1.reason.includes("Fe³⁺ が 5個") && p1.reason.includes("2個ずつ使う"),
      "あまりの理由が出ない: " + p1.reason);
    assert(!/×2/.test(p1.reason), "答えの倍率を言ってしまっている: " + p1.reason);
    // ちょうど2倍で教科書の式になる
    const p2 = bottlePlan(rs1, 5, 1, 2);
    assert(String(p2.coeffs) === "2,10,8,5,2,1,8", "rs1 の係数が教科書と違う: " + p2.coeffs);
    assert(p2.left.map((x) => x.sp).join() === "KMnO4,FeSO4,H2SO4", "左辺が瓶の並びでない");
    assert(p2.right.map((x) => x.sp).join() === "Fe2(SO4)3,MnSO4,K2SO4,H2O", "右辺の並びが想定と違う");
    // 4倍はつり合うが最簡でない
    const p4 = bottlePlan(rs1, 5, 1, 4);
    assert(p4.balanced && !p4.ok && p4.gcd === 2, "rs1 の ×4 を通した: " + p4.reason);
    assert(p4.reason.includes("割り切れる"), "割り切れると言っていない: " + p4.reason);
    // rs2 は最初から組める
    const q = bottlePlan(rs2, 6, 1, 1);
    assert(q.ok && String(q.coeffs) === "1,6,7,3,1,1,7", "rs2 の係数が教科書と違う: " + q.coeffs);
  });

  t("BOTTLE: SO₄²⁻ は「加える」のではなく H₂SO₄ が連れてくる（本数は割り算で決まる）", () => {
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    const p = bottlePlan(rs1, 5, 1, 2);
    const h2so4 = p.bottles.find((B) => B.sp === "H2SO4");
    // H⁺ が16個、1本から2個 → 8本。その8本が SO₄²⁻ を8個連れてくる
    assert(h2so4.covers.length === 1 && h2so4.covers[0].sp === "H+" && h2so4.covers[0].need === 16,
      "H₂SO₄ が担当するのが H⁺ 16個でない: " + JSON.stringify(h2so4.covers));
    assert(h2so4.per["H+"] === 2 && h2so4.n === 8, "H₂SO₄ の本数が 16÷2=8 でない: " + h2so4.n);
    assert(h2so4.riders.length === 1 && h2so4.riders[0].sp === "SO4^2-" && h2so4.riders[0].n === 8,
      "ついて来る SO₄²⁻ が8個でない: " + JSON.stringify(h2so4.riders));
    // 右辺の SO₄²⁻ 18個は、3本の瓶が連れてきた合計とちょうど同じ（どこからも降ってこない）
    const rode = p.bottles.reduce((k, B) => k + (B.riders.find((r) => r.sp === "SO4^2-") || { n: 0 }).n, 0);
    assert(rode === p.pool["SO4^2-"] && rode === 18, "SO₄²⁻ の出どころが合わない: " + rode + "/" + p.pool["SO4^2-"]);
    // 硝酸は1本で H⁺ と NO₃⁻ の両方を担当し、余った NO₃⁻ が傍観に回る（二役がこの割り算に入る）
    const rn1 = REDOX_STAGES.find((s) => s.id === "rn1");
    const q = bottlePlan(rn1, 3, 2, 1);
    const hno3 = q.bottles.find((B) => B.sp === "HNO3");
    assert(hno3.n === 8, "HNO₃ が8本でない: " + hno3.n);
    assert(hno3.covers.length === 2, "HNO₃ が2つのイオンを担当していない");
    assert(hno3.riders.length === 1 && hno3.riders[0].sp === "NO3-" && hno3.riders[0].n === 6,
      "余る NO₃⁻ が6個でない: " + JSON.stringify(hno3.riders));
  });

  t("BOTTLE: 誤った組み合わせを黙って弾かず、理由を返す", () => {
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    const rows = bottleOwnerChoices(rs1, 5, 1);
    assert(rows.length === 3, "左辺のイオンが3つでない: " + rows.length);
    // 選択肢には**罠**（左辺の反対符号のイオンと組む）が必ず混ざる
    const hRow = rows.find((r) => r.ion === "H+");
    assert(hRow.answer === "H2SO4", "H⁺ の正解が H₂SO₄ でない: " + hRow.answer);
    assert(hRow.options.some((o) => o.kind === "ion" && o.sp === "MnO4-"), "罠の選択肢が出ない");
    assert(hRow.options.filter((o) => o.kind === "bottle").length === 3, "瓶が3本並ばない");
    // ① 左辺のイオンどうしを組む → 出自が別だと言う（申し立ての本体）
    const bad1 = explainBottleOwner(rs1, 5, 1, "H+", { kind: "ion", sp: "MnO4-" });
    assert(!bad1.ok && bad1.kind === "not-together", "罠を通した: " + JSON.stringify(bad1));
    assert(bad1.reason.includes("互いを連れてきていません"), "理由の言い方が違う: " + bad1.reason);
    assert(bad1.reason.includes("H₂SO₄") && bad1.reason.includes("KMnO₄"),
      "どちらが連れてきたかを言っていない: " + bad1.reason);
    // ② そのイオンを出さない瓶 → 何を出すのかを言う
    const bad2 = explainBottleOwner(rs1, 5, 1, "H+", { kind: "bottle", sp: "FeSO4" });
    assert(!bad2.ok && bad2.kind === "wrong-bottle", "出さない瓶を通した");
    assert(bad2.reason.includes("Fe²⁺") && bad2.reason.includes("H⁺ は出しません"),
      "何を出すのかを言っていない: " + bad2.reason);
    // ③ 正解 → 一緒に来る傍観イオンまで言う（ここが「なぜ SO₄²⁻ が居るのか」の答え）
    const good = explainBottleOwner(rs1, 5, 1, "H+", { kind: "bottle", sp: "H2SO4" });
    assert(good.ok && good.reason.includes("SO₄²⁻"), "一緒に来る傍観イオンを言わない: " + good.reason);
    assert(good.reason.includes("反応しない"), "傍観だと言っていない: " + good.reason);
    // 未選択も黙らない
    assert(!explainBottleOwner(rs1, 5, 1, "H+", null).ok, "未選択を正解にした");
  });

  /* ---- ⑤の数入力と、例外としての倍率（v182・DESIGN_redox.md「実機レビュー」B・D）---- */
  /* 【F】区別が**画面の3か所**（見出し・帯の番号・☰一覧）に出ていること。
     見出しだけだと、帯を見ているときにどこから有機か分からない */
  // （UI 側の検査は runRedoxUITests に置く。ここはモデルの並びだけ）


  t("BOTTLE: ⑤は瓶の本数を入力させ、外したら「何個出るか」まで言う（答えの本数は言わない）", () => {
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    // ×1 のときの答え。**画面が表示するのではなく、これが入力の正解になる**
    const rows = bottleCountRows(rs1, 5, 1, 1);
    assert(rows.map((r) => r.sp + ":" + r.answer).join() === "KMnO4:1,FeSO4:5,H2SO4:4",
      "×1 の本数が想定と違う: " + JSON.stringify(rows.map((r) => [r.sp, r.answer])));
    // ×2 にすると本数も倍になる（学習者が出した値がそのまま倍になって見えること）
    const rows2 = bottleCountRows(rs1, 5, 1, 2);
    assert(rows2.map((r) => r.answer).join() === "2,10,8", "×2 の本数が倍になっていない: " + rows2.map((r) => r.answer));
    // 外した本数 → **1本ぶんが何個かまで**を言う。÷ の答えは言わない（それが入力の中身だから）
    const few = explainBottleCount(rs1, 5, 1, 2, "H2SO4", 4);
    assert(!few.ok && few.kind === "few", "足りない本数を通した: " + JSON.stringify(few));
    assert(few.reason.includes("2×4＝8個") && few.reason.includes("16個 要る"),
      "何個になるかを言っていない: " + few.reason);
    assert(!/＝\s*8本|8 ?本 でちょうど/.test(few.reason), "答えの本数を言ってしまっている: " + few.reason);
    // 多すぎる側も同じ形で言う
    const many = explainBottleCount(rs1, 5, 1, 2, "H2SO4", 12);
    assert(!many.ok && many.kind === "many", "多すぎる本数を通した: " + JSON.stringify(many));
    // 正解 → 割り算の筋道と、**ついて来た**傍観イオンを言う（「加えた」とは言わない）
    const ok = explainBottleCount(rs1, 5, 1, 2, "H2SO4", 8);
    assert(ok.ok && ok.reason.includes("16個 要る") && ok.reason.includes("＝ 8本"),
      "正解の筋道が出ない: " + ok.reason);
    assert(ok.reason.includes("SO₄²⁻ が 8個 ついて来る") && ok.reason.includes("加えたのではなく"),
      "ついて来たと言っていない: " + ok.reason);
    // そろったかどうかの判定は個数だけで決まる
    assert(!bottleCountsDone(rs1, 5, 1, 2, { KMnO4: 2, FeSO4: 10, H2SO4: 4 }), "1本外れているのに done");
    assert(bottleCountsDone(rs1, 5, 1, 2, { KMnO4: 2, FeSO4: 10, H2SO4: 8 }), "そろっているのに done でない");
  });

  t("BOTTLE: 瓶が連れてきた傍観イオンの合計が、筆算の「両辺に足す数」と一致する", () => {
    // ⑤の要（DESIGN_redox.md の B）: 同じ 18 を「足す」ではなく「ついて来た」で取りに行く。
    // 数が食い違ったら、2つの作り方が別のことを言っていることになる
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    const tot = bottleRiderTotals(rs1, 5, 1, 2);
    const so4 = tot.find((x) => x.sp === "SO4^2-");
    assert(so4 && so4.n === 18, "SO₄²⁻ の合計が18でない: " + JSON.stringify(tot));
    // 内訳は FeSO₄ 10本ぶん ＋ H₂SO₄ 8本ぶん。KMnO₄ は SO₄²⁻ を出さない
    const p = bottlePlan(rs1, 5, 1, 2);
    const per = {};
    for (const B of p.bottles) for (const r of B.riders) per[B.sp] = (per[B.sp] || 0) + (r.sp === "SO4^2-" ? r.n : 0);
    assert(per.FeSO4 === 10 && per.H2SO4 === 8 && !per.KMnO4, "SO₄²⁻ の内訳が違う: " + JSON.stringify(per));
    // **筆算を持つ5本では、この合計が molecularizeStep の need と一致する**
    // （瓶の言い方と筆算の言い方が同じ数に着地することの機械検査）
    let checked = 0;
    for (const st of REDOX_STAGES.filter((s) => s.molecularEq && s.bottles)) {
      const [a, b] = st.answer;
      const s = minBottleScale(st, a, b);
      const need = molecularizeStep(st, a, b, 0).need;
      const t = bottleRiderTotals(st, a, b, s).find((x) => x.sp === st.molecularEq.spectator);
      assert(t && t.n === need * s,
        st.id + ": ついて来た数と筆算の足す数が違う " + (t && t.n) + " / " + need * s);
      checked++;
    }
    assert(checked === 5, "照合できた筆算のステージが5本でない: " + checked);
  });

  t("BOTTLE: 全体の倍率は例外 — 半端が出たときだけ案内が立ち、1/2 が出ることを言う", () => {
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    const rs2 = REDOX_STAGES.find((s) => s.id === "rs2");
    const r3 = REDOX_STAGES.find((s) => s.id === "r3");
    // ふつうは倍率の話が立たない ＝ 画面に「倍率」という言葉が出ない
    assert(bottleScaleAdvice(rs2, 6, 1, 1) === null, "rs2 で倍率の案内が立っている");
    assert(bottleScaleAdvice(r3, 1, 1, 1) === null, "r3 で倍率の案内が立っている");
    // rs1 だけが例外。**1/2 が出ることを数そのもので言う**
    const adv = bottleScaleAdvice(rs1, 5, 1, 1);
    assert(adv && adv.kind === "half", "rs1 で例外の案内が立たない: " + JSON.stringify(adv));
    assert(adv.to === 2 && adv.units === 2.5, "行き先と半端が想定と違う: " + JSON.stringify([adv.to, adv.units]));
    assert(adv.reason.includes("2.5個") && adv.reason.includes("1/2"),
      "1/2 が出ることを言っていない: " + adv.reason);
    assert(adv.reason.includes("こういうときだけ"), "例外だと言っていない: " + adv.reason);
    // 倍にすれば半端は消え、案内は「戻せる」だけに変わる（探させない）
    const done = bottleScaleAdvice(rs1, 5, 1, 2);
    assert(done && done.kind === "revert" && done.to === 1, "×2 のあとの案内が想定と違う: " + JSON.stringify(done));
    assert(bottlePlan(rs1, 5, 1, 2).ok, "×2 で組めない");
  });

  t("BOTTLE: 瓶の段は、既存の筆算（molecularEq）を持つステージには出さない", () => {
    for (const st of REDOX_STAGES) {
      const shown = !!bottleStepOf(st);
      const expect = !!st.bottles && !st.molecularEq;
      assert(shown === expect, st.id + ": 瓶の段の出し方が想定と違う");
    }
    /* 【A】金属樹（r1・r2・r4）には出さない。ユーザーの指示
       「金属樹では通常イオン反応式で済ませるので④ではこの機能は不要です」
       「ステージ１，２，４は化学反応式が要らない」。
       r3（亜鉛×塩酸）は金属樹でも電池でもなく気体発生なので残す。 */
    const shown = REDOX_STAGES.filter((s) => bottleStepOf(s)).map((s) => s.id).join();
    assert(shown === "r3,rs1,rs2,rs3", "瓶の段が出るステージが想定と違う: " + shown);
    for (const id of ["r1", "r2", "r4"]) {
      const st = REDOX_STAGES.find((s) => s.id === id);
      assert(!st.bottles, id + "（金属樹）が瓶を持ったままになっている");
      assert(bottlePlan(st, st.answer[0], st.answer[1], 1) === null, id + ": 導出が立っている");
      assert(bottleOwnerChoices(st, st.answer[0], st.answer[1]) === null, id + ": 選択肢が出る");
    }
    // 瓶を持たないステージでは、導出そのものが立たない（黙って空の式を作らない）
    const ri1 = REDOX_STAGES.find((s) => s.id === "ri1");
    assert(!ri1.bottles && bottlePlan(ri1, 1, 2, 1) === null, "ri1 に瓶の導出が立っている");
    assert(bottleOwnerChoices(ri1, 1, 2) === null, "瓶を持たないステージに選択肢が出る");
  });

  /* 【G】rs3（KMnO₄ × シュウ酸）—— **1つのイオンを複数の瓶が担当する**初めての形。
     ユーザーの言葉「シュウ酸は弱酸なので硫酸を加える必要がある」が、ここで数になる。 */
  t("BOTTLE: rs3 は H⁺ が2本の瓶から出て、教科書の式（2:5:3）が組める", () => {
    const rs3 = REDOX_STAGES.find((s) => s.id === "rs3");
    assert(minBottleScale(rs3, 5, 2) === 1, "rs3 に倍率が要る: " + minBottleScale(rs3, 5, 2));
    const p = bottlePlan(rs3, 5, 2, 1);
    assert(p.ok && !p.dataError, "rs3 が組めない: " + p.reason);
    // 教科書: 2KMnO₄ ＋ 5H₂C₂O₄ ＋ 3H₂SO₄ → 2MnSO₄ ＋ K₂SO₄ ＋ 10CO₂ ＋ 8H₂O
    assert(p.left.map((x) => x.n + x.sp).join() === "2KMnO4,5H2C2O4,3H2SO4", "左辺が違う: " + JSON.stringify(p.left));
    assert(p.right.map((x) => x.n + x.sp).join() === "2MnSO4,1K2SO4,10CO2,8H2O", "右辺が違う: " + JSON.stringify(p.right));
    // **係数を独立に数え直す**（bottlePlan の内部と同じ道を通らない検算）
    const cmp = compareSides(p.left, p.right);
    assert(cmp.balanced, "rs3 の原子か電荷が合っていない: " + JSON.stringify(cmp));
    assert(gcdAll(p.coeffs) === 1, "rs3 の係数が最簡でない: " + p.coeffs);
    // H⁺ 16個 の内訳 —— シュウ酸が 10個・硫酸が 6個
    const m = p.multi["H+"];
    assert(m && m.need === 16, "H⁺ の必要数が違う: " + JSON.stringify(m));
    assert(m.parts.map((x) => x.sp + ":" + x.n).join() === "H2C2O4:10,H2SO4:6",
      "H⁺ の内訳が違う: " + JSON.stringify(m.parts));
    // 単独で出どころが決まるイオンは owners に残り、分担するイオンは載らない
    assert(p.owners["C2O4^2-"] === "H2C2O4" && p.owners["MnO4-"] === "KMnO4", "単独の出どころが崩れた");
    assert(!p.owners["H+"], "分担しているのに1本の担当になっている");
  });

  t("BOTTLE: rs3 の④は「両方から」が正解で、片方だけだと何個足りないかを言う", () => {
    const rs3 = REDOX_STAGES.find((s) => s.id === "rs3");
    const rows = bottleOwnerChoices(rs3, 5, 2);
    const h = rows.find((r) => r.ion === "H+");
    assert(h.shared && h.answerKey === "bottles:H2C2O4+H2SO4", "H⁺ の正解が両方になっていない: " + h.answerKey);
    // 「両方から」が選択肢に**ある**（片方を正解にすると嘘を教えることになる）
    assert(h.options.some((o) => o.kind === "bottles"), "「両方から」の選択肢が無い");
    // 罠（左辺のイオンと組む）は分担しているイオンでも出る
    assert(h.options.some((o) => o.kind === "ion" && o.sp === "MnO4-"), "罠の選択肢が消えた");
    // 単独のイオンは今までどおり1本が正解
    const c = rows.find((r) => r.ion === "C2O4^2-");
    assert(!c.shared && c.answerKey === "bottle:H2C2O4", "C₂O₄²⁻ の正解が違う: " + c.answerKey);
    // 片方だけ → **何個足りないか**を言う（これが「なぜ硫酸を加えるのか」の答え）
    const one = explainBottleOwner(rs3, 5, 2, "H+", { kind: "bottle", sp: "H2C2O4" });
    assert(!one.ok && one.kind === "not-enough", "片方だけを正解にした: " + JSON.stringify(one));
    assert(one.reason.includes("10個 だけ") && one.reason.includes("6個 足りません"),
      "足りない数を言わない: " + one.reason);
    // 両方 → 弱酸だから強酸を足す、と言い切る
    const both = explainBottleOwner(rs3, 5, 2, "H+", { kind: "bottles", sps: ["H2C2O4", "H2SO4"] });
    assert(both.ok && both.reason.includes("弱酸") && both.reason.includes("強酸"),
      "弱酸・強酸の説明が出ない: " + both.reason);
    assert(both.reason.includes("H₂C₂O₄ が 10個") && both.reason.includes("H₂SO₄ が 6個"),
      "内訳を言わない: " + both.reason);
    // 出さない瓶は今までどおり弾く
    const no = explainBottleOwner(rs3, 5, 2, "H+", { kind: "bottle", sp: "KMnO4" });
    assert(!no.ok && no.kind === "wrong-bottle", "H⁺ を出さない瓶を通した");
    // 罠の文面も、出どころが2本あることを正しく言う（種の記号がそのまま出ていない）
    const trap = explainBottleOwner(rs3, 5, 2, "H+", { kind: "ion", sp: "MnO4-" });
    assert(trap.reason.includes("H₂C₂O₄ と H₂SO₄") && trap.reason.includes("KMnO₄"),
      "罠の文面の出どころが違う: " + trap.reason);
    assert(!/KMnO4|H2SO4|H2C2O4/.test(trap.reason), "種の記号が生のまま出ている: " + trap.reason);
    // ⑤の手がかりは「全体の何個のうち、この瓶が何個」まで言う
    const few = explainBottleCount(rs3, 5, 2, 1, "H2SO4", 2);
    assert(few.reason.includes("16個 要り") && few.reason.includes("6個 がこの瓶のぶん"),
      "分担ぶんを言わない: " + few.reason);
  });

  /* 【C】③のイオン反応式の係数を先に言う（v182）。
     模範の係数はどこにも手で書かない ＝ combineHalves が出したものと突き合わせる */
  t("IONIC-GUESS: ③の係数の正解は combineHalves から導け、各項の出どころも分かる", () => {
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    const rows = ionicCoeffRows(rs1, 5, 1);
    assert(rows.terms.map((x) => x.sp).join() === "Fe^2+,MnO4-,H+,Fe^3+,Mn^2+,H2O",
      "項の並びが想定と違う: " + rows.terms.map((x) => x.sp).join());
    assert(rows.terms.map((x) => x.n).join() === "5,1,8,5,1,4", "係数が想定と違う: " + rows.terms.map((x) => x.n));
    // e⁻ は消えているので聞かない
    assert(!rows.terms.some((x) => x.sp === "e-"), "e⁻ の係数を聞いている");
    // どちらの半反応式から来て何倍されるか（外したときの助言の材料）
    const fe = rows.terms[0], h = rows.terms[2];
    assert(fe.from === "ox" && fe.mult === 5, "Fe²⁺ の出どころが違う: " + JSON.stringify(fe));
    assert(h.from === "red" && h.mult === 1, "H⁺ の出どころが違う: " + JSON.stringify(h));
    // 全ステージで、聞く係数が combineHalves の結果とずれない（模範を二重に持たないことの検査）
    for (const st of REDOX_STAGES) {
      const [a, b] = st.answer;
      const r = ionicCoeffRows(st, a, b);
      const c = combineHalves(st, a, b);
      const want = c.left.concat(c.right).filter((x) => x.sp !== "e-").map((x) => x.sp + ":" + x.n).join();
      assert(r.terms.map((x) => x.sp + ":" + x.n).join() === want, st.id + ": 聞く係数が導出とずれている");
    }
  });

  t("IONIC-GUESS: 外した係数に、答えの数を言わずに「どこから来るか」で答える", () => {
    const rs1 = REDOX_STAGES.find((s) => s.id === "rs1");
    // 途中まで
    const half = checkIonicCoeffs(rs1, 5, 1, [5, 1]);
    assert(!half.ok && half.kind === "partial" && half.reason.includes("あと 4 つ"),
      "残りを言わない: " + JSON.stringify(half));
    // よくある外し方: 全体が同じ倍率（最簡比まで詰めていない）
    const sc = checkIonicCoeffs(rs1, 5, 1, [10, 2, 16, 10, 2, 8]);
    assert(!sc.ok && sc.kind === "scaled" && sc.k === 2, "全体倍を見抜けない: " + JSON.stringify(sc));
    assert(sc.reason.includes("ぜんぶが 2 倍"), "全体倍だと言わない: " + sc.reason);
    // 1つだけ違う → 出どころと倍率を言い、**答えの数は言わない**
    const w = checkIonicCoeffs(rs1, 5, 1, [1, 1, 8, 5, 1, 4]);
    assert(!w.ok && w.kind === "wrong" && w.wrong.join() === "0", "違う項を指せない: " + JSON.stringify(w));
    assert(w.reason.includes("【還元剤】") && w.reason.includes("×5"), "出どころを言わない: " + w.reason);
    assert(!/Fe²⁺ は 5|＝ 5|正解は/.test(w.reason), "答えの数を言ってしまっている: " + w.reason);
    // 正解
    const ok = checkIonicCoeffs(rs1, 5, 1, [5, 1, 8, 5, 1, 4]);
    assert(ok.ok && ok.reason.includes("e⁻"), "正解の言葉が出ない: " + JSON.stringify(ok));
    // 模範倍率の全ステージで、模範の係数が正解と判定される
    for (const st of REDOX_STAGES) {
      const [a, b] = st.answer;
      const want = ionicCoeffRows(st, a, b).terms.map((x) => x.n);
      assert(checkIonicCoeffs(st, a, b, want).ok, st.id + ": 模範の係数が不正解になる");
      assert(!checkIonicCoeffs(st, a, b, want.map((n, i) => (i === 0 ? n + 1 : n))).ok,
        st.id + ": 1つずらしても正解になる");
    }
  });

  /* 【F】ユーザーの指示「ステージ８－１２は化学基礎でなく、有機（発展）なので区別する」。
     **id の一覧を手で書かない**ので、導出（ORGANIC_OXIDANTS に載っているか）が
     指示どおりの5本とちょうど一致することを機械で固定する。 */
  t("LEVEL: 有機（発展）はステージ8〜12ちょうど。id の一覧を手で持たずに導ける", () => {
    const org = REDOX_STAGES.filter(isOrganicStage).map((s) => s.id).join();
    assert(org === "ro1,ro2,ro3,ri1,ri2", "有機と判定される並びが想定と違う: " + org);
    // 並び順で数えても 8〜12（ユーザーの言う番号と一致すること）
    const nums = REDOX_STAGES.map((s, i) => (isOrganicStage(s) ? i + 1 : 0)).filter(Boolean).join();
    assert(nums === "8,9,10,11,12", "有機の番号が 8〜12 でない: " + nums);
    /* シュウ酸（rs3・ステージ7）は分子としては有機だが、ここには入らない。
       無機の還元剤とまったく同じ扱い方をする（梯子に順位を持つ）ため。
       銅×硝酸（13・14）も化学基礎のまま */
    for (const id of ["rs3", "rn1", "rn2", "r1", "r3"]) {
      assert(!isOrganicStage(REDOX_STAGES.find((s) => s.id === id)), id + " を有機と判定している");
    }
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

/* 使い捨ての iframe を1枚開き、`ready(win)` が真を返すまで待つ。
   駄目なら**開き直して1回だけやり直し**、それでも駄目なら { f: null, win: null } を返す。

   **`f.contentWindow.X` と素で書いてはいけない**（2026-08-10）。読み込みの途中や、
   読み込みが転けてエラーページが出ている間、`contentWindow` は**別オリジン扱い**になり、
   プロパティを触っただけで `SecurityError: Blocked a frame ... from accessing a
   cross-origin frame` を投げる。待ちループの中でそれが飛ぶと、**アプリの不具合の顔で
   テストが落ちる**。実際、負荷が高いときだけ「M6 UI: 根拠は既定で2行…」と
   「M6-D UI: 液性を選べて…」の2件がこれで落ちていた（アプリは無傷。再実行すると通る）。
   openAt / openFree の両方が同じ書き方をしていたので、ここに集約する。 */
async function openProbeFrame(src, ready, style) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const f = document.createElement("iframe");
        f.style.cssText = style;
        // 検査対象に ?free=1 のようなクエリ付きが混じるので、区切りを間違えない
        f.src = src + (src.includes("?") ? "&" : "?") + "probe=" + Date.now();
        document.body.appendChild(f);
        // onload が来ないまま固まることがあるので、待ちに上限を設ける
        await new Promise((r) => { f.onload = r; setTimeout(r, 10000); });
        for (let i = 0; i < 100; i++) {
            try {
                const w = f.contentWindow;
                // 同一オリジンかどうかは**触ってみないと分からない**。location で試す
                if (w && w.location && typeof w.location.href === "string" && ready(w)) return { f, win: w };
            } catch (e) { /* 読み込み中／エラーページ。まだ読めないだけなので待つ */ }
            await new Promise((r) => setTimeout(r, 50));
        }
        f.remove();   // この1枚は諦めて開き直す
    }
    return { f: null, win: null };
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
      // 投入数はモデルから導く（加水分解・電離は per 個、ほかは左辺の係数）
      const inputs = sampleInputs(st);
      stageBtn(i).click();
      for (let j = 0; j < inputs.length; j++) {
        for (let k = 0; k < inputs[j]; k++) addBtn(j).click();
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

  /* 塩基性塩。s11 の**鏡**（あちらは多価の酸を部分中和、こちらは多価の塩基）なので、
     余る側が H⁺ ではなく OH⁻ になっていること、入れすぎで落ちる先が正塩 CaCl₂ に
     なることを見る。ここが逆になっていたら、どちらかのステージが間違っている */
  await t("UI: 塩基性塩ステージ - 1:1 で CaCl(OH) ができ、余るのは H⁺ ではなく OH⁻", async () => {
    const i = STAGES.findIndex((st) => st.id === "s13");
    assert(i >= 0, "s13 が無い");
    // まず 1:2（過剰な酸）＝完全中和して正塩 CaCl₂ → 目標未達
    stageBtn(i).click();
    addBtn(0).click(); addBtn(1).click(); addBtn(1).click();   // Ca(OH)₂×1, HCl×2
    adv(3000); reactBtn().click(); adv(8000);
    let s = state();
    assert(!s.reactionDone, "1:2 で完全中和したのにクリア扱いになった: " + JSON.stringify(s.counts));
    assert(doc.getElementById("msg").textContent.includes("正塩"),
      "正塩になった旨の指摘がない: " + doc.getElementById("msg").textContent);
    // 次に 1:1 ＝ 塩基性塩 CaCl(OH)
    stageBtn(i).click();
    addBtn(0).click(); addBtn(1).click();
    adv(3000); reactBtn().click(); adv(8000);
    s = state();
    assert(s.reactionDone, "1:1 で塩基性塩ができない: " + JSON.stringify(s.counts));
    assert(s.counts["OH-"] === 1 && s.counts["Ca^2+"] === 1 && s.counts["Cl-"] === 1,
      "残ったイオンが CaCl(OH) の組（OH⁻・Ca²⁺・Cl⁻）でない: " + JSON.stringify(s.counts));
    // **s11 との違いはここ**。酸性塩では H⁺ が残るが、塩基性塩では残らない
    assert(!s.counts["H+"], "塩基性塩なのに H⁺ が余っている: " + JSON.stringify(s.counts));
    assert(s.counts["H2O"] === 1, "H₂O が1個できていない: " + JSON.stringify(s.counts));
    assert(doc.getElementById("msg").textContent.includes("CaCl(OH)"), "CaCl(OH) 生成メッセージがない");
    ups().forEach((b, k) => { for (let m = 0; m < eqOf(STAGES[i], state().eqMode).answer[k]; m++) b.click(); });
    s = state();
    assert(s.coeffOk && s.cleared, "係数クリアにならない: coeffOk=" + s.coeffOk + " cleared=" + s.cleared);
  });

  /* 比予想クイズ。**予想が入力そのものになる**のが要点なので、
     押したら予想どおりの数が入って反応まで進むこと、正誤が
     「反応の結果が出たあと」に出ること、倍の比（2:4）も当たりになることを見る */
  await t("UI: 比予想クイズ - 予想した数がそのまま入り、外すと余り・当てると反応しきる", async () => {
    const i = STAGES.findIndex((st) => st.id === "s2");   // H₂SO₄ ＋ 2NaOH
    assert(i >= 0, "s2 が無い");
    stageBtn(i).click();
    const quiz = doc.getElementById("ratioQuiz");
    assert(quiz && !quiz.hidden, "反応物2種のステージなのにクイズが出ない");
    quiz.open = true;
    const nums = () => [...doc.querySelectorAll("#ratioQuiz .rqNum")].map((e) => Number(e.textContent));
    const steps = () => [...doc.querySelectorAll("#ratioQuiz .rqStep")];
    const go = () => doc.querySelector("#ratioQuiz .rqGo").click();
    const msg = () => doc.getElementById("rqMsg").textContent;
    assert(JSON.stringify(nums()) === JSON.stringify([1, 1]), "初期値が 1 : 1 でない: " + nums());
    // ① わざと外す（1:1）
    go(); adv(12000);
    let s = state();
    assert(s.added["H2SO4"] === 1 && s.added["NaOH"] === 1,
      "予想した数どおりに入っていない: " + JSON.stringify(s.added));
    assert(s.counts["H+"] === 1, "H⁺ が余らない（1:1 なら余るはず）: " + JSON.stringify(s.counts));
    assert(msg().includes("余りが出た"), "外したのに外れたと言わない: " + msg());
    // ② 直して当てる（1:2）
    steps()[3].click();   // 2つ目の ＋
    assert(JSON.stringify(nums()) === JSON.stringify([1, 2]), "＋で増えない: " + nums());
    go(); adv(15000);
    s = state();
    assert(!s.counts["H+"] && !s.counts["OH-"], "ちょうど反応しきっていない: " + JSON.stringify(s.counts));
    assert(msg().includes("当たり"), "当てたのに当たりと言わない: " + msg());
    // ③ 倍の比（2:4）も同じ比なので当たり。
    //    同じステージに入り直したときは**予想を持ち越す**（直前の 1 : 2 のまま）——
    //    比を1つ動かして試し直す使い方が主なので、毎回 1 : 1 に戻すと押し直しが増える
    stageBtn(i).click();
    quiz.open = true;
    assert(JSON.stringify(nums()) === JSON.stringify([1, 2]),
      "同じステージに入り直したのに予想が捨てられている: " + nums());
    steps()[1].click();                            // 1つ目を 2 に
    [3, 3].forEach((k) => steps()[k].click());     // 2つ目を 4 に
    assert(JSON.stringify(nums()) === JSON.stringify([2, 4]), "2 : 4 にならない: " + nums());
    go(); adv(20000);
    assert(msg().includes("当たり"), "2 : 4 は 1 : 2 と同じ比なので当たりのはず: " + msg());
    // ④ 相手のいない反応（加水分解）では出さない
    const h = STAGES.findIndex((st) => st.id === "hydrolysis-ch3coona");
    stageBtn(h).click();
    assert(doc.getElementById("ratioQuiz").hidden, "相手を待たない反応にクイズが出ている");
  });

  /* 三段中和。**同じ酸・同じ塩基**なのに、入れる数だけで3種類の塩ができるところが要点。
     3本まとめて見て、残る H⁺ が 2→1→0 と減ること・目標の呼び名が
     酸性塩→酸性塩→正塩 と変わることを固定する（1本ずつ見ても分からない） */
  await t("UI: リン酸の三段中和 - NaOH を1・2・3個で残る H⁺ が 2・1・0 と減る", async () => {
    const expect = [
      { id: "s14", naoh: 1, hLeft: 2, na: 1, water: 1, kind: "酸性塩", salt: "NaH₂PO₄" },
      { id: "s15", naoh: 2, hLeft: 1, na: 2, water: 2, kind: "酸性塩", salt: "Na₂HPO₄" },
      // 3段目は完全中和なので saltGoal を持たず、バナーは全ステージ共通の
      // 「ちょうど中和して…をつくる」になる（正塩であることは単元タグと doneNote が言う）
      { id: "s16", naoh: 3, hLeft: 0, na: 3, water: 3, kind: "ちょうど中和して", salt: "Na₃PO₄" },
    ];
    for (const e of expect) {
      const i = STAGES.findIndex((st) => st.id === e.id);
      assert(i >= 0, e.id + " が無い");
      stageBtn(i).click();
      addBtn(0).click();
      for (let k = 0; k < e.naoh; k++) addBtn(1).click();
      adv(3000); reactBtn().click(); adv(12000);
      const s = state();
      assert(s.reactionDone, e.id + ": 反応が完了しない " + JSON.stringify(s.counts));
      assert((s.counts["H+"] || 0) === e.hLeft,
        e.id + ": 残る H⁺ が " + e.hLeft + " 個でない " + JSON.stringify(s.counts));
      assert(s.counts["Na+"] === e.na && s.counts["PO4^3-"] === 1 && s.counts["H2O"] === e.water,
        e.id + ": 残りの組が合わない " + JSON.stringify(s.counts));
      const goal = doc.querySelector("#stageTitle .goal").textContent;
      assert(goal.includes(e.kind) && goal.includes(e.salt),
        e.id + ": 目標バナーが「" + e.kind + " " + e.salt + "」でない: " + goal);
      ups().forEach((b, k) => { for (let m = 0; m < eqOf(STAGES[i], state().eqMode).answer[k]; m++) b.click(); });
      assert(state().cleared, e.id + ": 係数クリアにならない");
    }
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

  /* 加水分解は「ちょうど反応しきる」型ではない。ここで守るのは3つ:
     ①**アプリが per 個を置いた状態で始まる**（v185・台帳の O。人に並べさせない）
     ②そのまま反応させると1個だけ変わり、**残りはもとのイオンのまま**でクリアになる
     ③平衡なので式の矢印は ⇄（片矢印だと「全部変わる」に見える）

     ①は v185 で入れ替わった検査。それまでは「1個だけ入れても起こらない」ことを見ていたが、
     **per 個そろえる作業そのものが「係数は5」という誤読を生んでいた**という指摘を受けて、
     アプリが置く形にした。数を並べる操作に学びは無く、伝えたいのは
     「入れたもののごく一部しか変わらない」ことだけ。 */
  await t("UI: 加水分解 - アプリが per 個を置いた状態で始まり、1個だけ変わって残りはそのまま", async () => {
    const i = STAGES.findIndex((st) => st.id === "hydrolysis-ch3coona");
    assert(i >= 0, "hydrolysis-ch3coona ステージが無い");
    const per = partialRule(STAGES[i]).per;
    // ① 開いた時点で per 個入っている（＋を押す前）
    stageBtn(i).click();
    let s = state();
    assert(s.added["CH3COONa"] === per,
      "ステージを開いた時点で " + per + " 個入っていない（人に並べさせている）: " + JSON.stringify(s.added));
    adv(5000);
    s = state();
    assert(s.counts["CH3COO-"] === per && s.counts["Na+"] === per,
      "酢酸ナトリウムが完全電離していない: " + JSON.stringify(s.counts));
    // 置いた個数が「係数」と読まれないよう、数のすぐ下で打ち消していること
    const addedNote = doc.querySelector("#addedFormula .addedNote");
    assert(addedNote && addedNote.textContent.includes("係数ではない"),
      "画面の個数を「係数ではない」と打ち消していない: " + (addedNote ? addedNote.textContent : "（注記が無い）"));
    // 導入文でも「誇張であること」と「係数とは別もの」を言っている
    const intro = doc.getElementById("msg").textContent;
    assert(intro.includes("誇張") && intro.includes("係数"),
      "置いてある理由（誇張・係数とは別もの）を導入文が言っていない: " + intro);
    // ② そのまま反応させると1個ぶんだけ進む（＋を1回も押さない）
    reactBtn().click();
    adv(15000);
    s = state();
    assert(s.counts["OH-"] === 1, "OH⁻ が1個できない（塩基性の目印）: " + JSON.stringify(s.counts));
    assert(s.counts["CH3COOH"] === 1, "酢酸の分子に戻っていない: " + JSON.stringify(s.counts));
    assert(s.counts["CH3COO-"] === per - 1,
      "残りが元のままでない（" + (per - 1) + "個のはず）: " + JSON.stringify(s.counts));
    assert(s.counts["Na+"] === per, "傍観イオン Na⁺ が減っている: " + JSON.stringify(s.counts));
    // 使った水は溶媒として1個ぶん数えられている（原子の保存の帳尻）
    assert(s.solventUsed["H2O"] === 1, "溶媒の水が数えられていない: " + JSON.stringify(s.solventUsed));
    assert(s.reactionDone, "加水分解が起きたのに完了にならない");
    const msg = doc.getElementById("msg").textContent;
    assert(msg.includes("塩基性"), "液性を言っていない: " + msg);
    assert(msg.includes("残り"), "残りがそのままであることに触れていない: " + msg);
    // ③ 平衡の矢印。既定はイオン反応式
    assert(state().eqMode === "ionic", "加水分解の既定がイオン反応式でない: " + state().eqMode);
    assert(doc.querySelector("#equation .arrow").textContent === "⇄",
      "平衡なのに片矢印: " + doc.querySelector("#equation .arrow").textContent);
    // 係数もそろえるとクリア（イオン反応式 CH₃COO⁻＋H₂O⇄CH₃COOH＋OH⁻ は全部1）
    eqOf(STAGES[i], "ionic").answer.forEach((n, k) => { for (let m = 0; m < n; m++) ups()[k].click(); });
    s = state();
    assert(s.coeffOk && s.cleared, "係数クリアにならない: coeffOk=" + s.coeffOk + " cleared=" + s.cleared);
    // 目標バナーは「つくる」ではなく液性の確認
    const goal = doc.querySelector("#stageTitle .goal").textContent;
    assert(goal.includes("加水分解") && goal.includes("塩基性"), "目標バナーが液性の確認になっていない: " + goal);
  });

  /* 塩化アンモニウム側。酢酸ナトリウムと**違うところ**だけを見る:
     ①液性が逆（酸性）②水を使わない（solventUsed が増えない）
     ③分子反応式が書けないので切り替えが出ず、理由が出る
     置かれ方（per 個をアプリが置く）は**同じ**でなければならない。
     この2本は背中合わせで「液性はもとの酸と塩基のうち弱いほうが顔を出す」を
     両側から見せる組なので、**始まりの形が違うと比べものにならない**。 */
  await t("UI: 加水分解 - 塩化アンモニウムは酸性。水を使わず、分子反応式は出さない", async () => {
    const i = STAGES.findIndex((st) => st.id === "hydrolysis-nh4cl");
    assert(i >= 0, "hydrolysis-nh4cl ステージが無い");
    const per = partialRule(STAGES[i]).per;
    stageBtn(i).click();
    assert(state().added["NH4Cl"] === per,
      "開いた時点で " + per + " 個入っていない（酢酸ナトリウム側と始まりの形が違う）: " +
      JSON.stringify(state().added));
    adv(5000);
    let s = state();
    assert(s.counts["NH4+"] === per && s.counts["Cl-"] === per,
      "塩化アンモニウムが完全電離していない: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(15000);
    s = state();
    // ① H⁺ ができる＝酸性（酢酸ナトリウムは OH⁻ ＝塩基性）
    assert(s.counts["H+"] === 1, "H⁺ が1個できない（酸性の目印）: " + JSON.stringify(s.counts));
    assert(!s.counts["OH-"], "OH⁻ ができてしまっている（酸性のはず）: " + JSON.stringify(s.counts));
    assert(s.counts["NH3"] === 1, "アンモニアに戻っていない: " + JSON.stringify(s.counts));
    assert(s.counts["NH4+"] === per - 1,
      "残りが元のままでない（" + (per - 1) + "個のはず）: " + JSON.stringify(s.counts));
    assert(s.counts["Cl-"] === per, "傍観イオン Cl⁻ が減っている: " + JSON.stringify(s.counts));
    // ② こちらは水を使わない。使うと式に H₂O が要るのに ionic には無い＝原子が合わなくなる
    assert(!s.solventUsed["H2O"], "水を使っている（NH₄⁺ は水なしで H⁺ を放す）: " + JSON.stringify(s.solventUsed));
    const msg = doc.getElementById("msg").textContent;
    assert(msg.includes("酸性"), "液性を言っていない: " + msg);
    // ③ できた NH₃ が水に拾われて NH₄⁺＋OH⁻ に戻る「作ってはほどく」が起きていないこと。
    //    products に NH3 を挙げ忘れると、ここが無限に往復する
    adv(20000);
    s = state();
    assert(s.counts["NH3"] === 1 && s.counts["H+"] === 1,
      "作ってはほどくをくり返している: " + JSON.stringify(s.counts));
    // ④ 分子反応式は書けないので切り替えボタンを出さず、代わりに理由を出す
    assert(state().eqMode === "ionic", "既定がイオン反応式でない: " + state().eqMode);
    assert(doc.querySelectorAll("#eqMode .eqModeBtn").length === 0,
      "分子反応式が書けないのに切り替えが出ている");
    const note = doc.querySelector("#eqMode .eqModeNote");
    assert(note && note.textContent.includes("イオン反応式だけ"),
      "なぜ分子反応式が無いかを出していない: " + (note ? note.textContent : "（無い）"));
    // 係数をそろえるとクリア（NH₄⁺ ⇄ NH₃ ＋ H⁺ は全部1）
    eqOf(STAGES[i], "ionic").answer.forEach((n, k) => { for (let m = 0; m < n; m++) ups()[k].click(); });
    s = state();
    assert(s.coeffOk && s.cleared, "係数クリアにならない: coeffOk=" + s.coeffOk + " cleared=" + s.cleared);
    const goal = doc.querySelector("#stageTitle .goal").textContent;
    assert(goal.includes("酸性"), "目標バナーが酸性の確認になっていない: " + goal);
  });

  /* 弱酸そのものの電離。加水分解と同じ per の仕組みを使うが、
     **見どころが液性ではなく電離度**なので言い回しと目標が変わる。そこを固定する */
  await t("UI: 電離度 - 酢酸は入れたぶんの一部だけが電離し、割合を言葉で出す", async () => {
    const i = STAGES.findIndex((st) => st.id === "ionization-ch3cooh");
    assert(i >= 0, "ionization-ch3cooh ステージが無い");
    const per = partialRule(STAGES[i]).per;
    stageBtn(i).click();
    // 加水分解の2本と同じく、per 個はアプリが置く（電離度も「並べる作業」に学びは無い）
    assert(state().added["CH3COOH"] === per,
      "開いた時点で " + per + " 個入っていない: " + JSON.stringify(state().added));
    adv(5000);
    let s = state();
    // 弱酸なので、入れた時点では**分子のまま**（強酸ならここで全部イオンになっている）
    assert(s.counts["CH3COOH"] === per, "分子のまま溶けていない: " + JSON.stringify(s.counts));
    assert(!s.counts["H+"], "入れただけで電離してしまっている: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(15000);
    s = state();
    assert(s.counts["H+"] === 1 && s.counts["CH3COO-"] === 1,
      "1個ぶんだけ電離していない: " + JSON.stringify(s.counts));
    assert(s.counts["CH3COOH"] === per - 1,
      "残りが分子のままでない（" + (per - 1) + "個のはず）: " + JSON.stringify(s.counts));
    // 見どころは割合そのもの。何個中何個かを言葉で出していること
    const msg = doc.getElementById("msg").textContent;
    assert(msg.includes("電離度") && msg.includes(per + " 個のうち 1 個"),
      "電離度を割合で言っていない: " + msg);
    // 電離式に「分子反応式／イオン反応式」の区別は無いので切り替えは出ない
    assert(doc.getElementById("eqMode").hidden, "電離式なのに式の切り替えが出ている");
    assert(doc.querySelector("#equation .arrow").textContent === "⇄", "平衡なのに片矢印");
    eqOf(STAGES[i], state().eqMode).answer.forEach((n, k) => { for (let m = 0; m < n; m++) ups()[k].click(); });
    s = state();
    assert(s.coeffOk && s.cleared, "係数クリアにならない: coeffOk=" + s.coeffOk + " cleared=" + s.cleared);
    const goal = doc.querySelector("#stageTitle .goal").textContent;
    assert(goal.includes("電離度"), "目標バナーが電離度になっていない: " + goal);
  });

  /* ---- 画面の個数と、式の係数（ORDER_review_2026-08-18 の O・v185）----
     ユーザーの申し立て:「31 酢酸5分子で正解にするのは微妙（反応式の係数は１）。
     分子の模型は勝手に増やしてよいのでは？」

     per は「変わるところが見えるようにするための誇張した個数」で、式の係数（すべて1）とは
     別ものだった。ところが画面は **per 個そろえて初めて先へ進む**作りで、しかも投入数は
     ビーカーの上に 25px の太字で出る（「5 CH₃COONa」）——「5個で正解」＝**係数は5**と読まれた。

     直し方は「並べる作業をアプリが引き受け、個数と係数を言葉で切り離す」。
     ここで見張るのは、その約束が **仕組み（partialRule）ぜんぶ**で守られていること:
       ①開いた時点で per 個入っている（人に並べさせない）
       ②その個数を「係数ではない」と打ち消す注記が、数のすぐ下に出る
       ③「ちょうど反応しきった」の緑（.matched）を当てない ＝ 個数比＝係数比の合図を出さない
       ④係数を入れる場所でも「画面の個数ではない」と言う
       ⑤＋ボタンは残っていて、もっと入れれば2個目が変わる（誇張だと自分で確かめられる）
       ⑥「やり直す」でまた per 個の状態に戻る
     ステージ id ではなく partialRule で回すので、同じ仕組みのステージを足せば自動で対象になる。 */
  await t("O: 加水分解・電離は per 個をアプリが置き、その個数を「係数ではない」と打ち消す（3ステージ）", async () => {
    const partials = STAGES.map((st, i) => ({ st, i })).filter((x) => partialRule(x.st));
    assert(partials.length >= 3, "per を使うステージが足りない（この検査が空回りしている）: " + partials.length);
    for (const { st, i } of partials) {
      const per = partialRule(st).per;
      const sp = st.reactants[0];
      stageBtn(i).click();
      // ① 人に並べさせない
      assert(state().added[sp] === per,
        st.id + ": 開いた時点で " + per + " 個入っていない（" + JSON.stringify(state().added) + "）");
      // ② 数のすぐ下で打ち消す
      const note = doc.querySelector("#addedFormula .addedNote");
      assert(note && note.textContent.includes("係数ではない"),
        st.id + ": 個数を「係数ではない」と打ち消す注記が無い");
      // ④ 係数を入れる場所でも言う
      assert(doc.getElementById("eqMsg").textContent.includes("個数ではなく"),
        st.id + ": 係数の案内が「画面の個数ではない」と言っていない: " + doc.getElementById("eqMsg").textContent);
      adv(5000);
      reactBtn().click();
      adv(15000);
      const s = state();
      assert(s.reactionDone, st.id + ": 置いてあるぶんだけで反応が成立しない（＋を押させている）");
      // ③ 「この個数比が係数の比」の合図を出さない
      assert(!doc.getElementById("addedFormula").classList.contains("matched"),
        st.id + ": 個数比＝係数比の緑（matched）が当たっている — 係数が " + per + " に見える");
      // 誇張であることは結果の文（doneNote）でも言い続ける
      assert(doc.getElementById("msg").textContent.includes("誇張"),
        st.id + ": 反応後の説明が「誇張してある」と言っていない");
      // ⑤ ＋ボタンは残っていて、倍入れれば2個目が変わる
      assert(addBtn(0), st.id + ": ＋ボタンが消えている（もっと入れて確かめられない）");
      for (let k = 0; k < per; k++) addBtn(0).click();
      adv(6000);
      assert(state().added[sp] === per * 2,
        st.id + ": ＋で足せない（" + JSON.stringify(state().added) + "）");
      reactBtn().click();
      adv(30000);
      assert(state().made === 2,
        st.id + ": " + (per * 2) + " 個入れても2個目が変わらない（made=" + state().made + "）");
      // ⑥ やり直すと per 個の状態へ戻る
      doc.querySelector("#toolbar .reset").click();
      assert(state().added[sp] === per,
        st.id + ": やり直したら空になった（また人が並べる羽目になる）: " + JSON.stringify(state().added));
    }
  });

  /* 背中合わせの2本（酢酸ナトリウム＝塩基性／塩化アンモニウム＝酸性）は、
     **始まりの形がそろっていて初めて比べものになる**。片方だけ per 個を置く形にすると
     「液性はもとの酸と塩基のうち弱いほうが顔を出す」の対比が崩れる。 */
  await t("O: 背中合わせの加水分解2本は、置かれる個数も変わる個数も同じで、液性だけが逆", async () => {
    const seen = {};
    for (const id of ["hydrolysis-ch3coona", "hydrolysis-nh4cl"]) {
      const i = STAGES.findIndex((st) => st.id === id);
      assert(i >= 0, id + " が無い");
      const per = partialRule(STAGES[i]).per;
      stageBtn(i).click();
      adv(5000);
      reactBtn().click();
      adv(15000);
      const s = state();
      seen[id] = {
        per, placed: s.added[STAGES[i].reactants[0]], made: s.made,
        oh: s.counts["OH-"] || 0, h: s.counts["H+"] || 0,
        // 誇張の断り書きが両方にあること（片方に無いと、置かれた数の意味が食い違う）
        exaggerated: /誇張/.test(STAGES[i].doneNote),
      };
    }
    const a = seen["hydrolysis-ch3coona"], b = seen["hydrolysis-nh4cl"];
    assert(a.per === b.per && a.placed === b.placed,
      "置かれる個数がそろっていない: " + JSON.stringify(seen));
    assert(a.made === 1 && b.made === 1, "変わる個数がそろっていない: " + JSON.stringify(seen));
    assert(a.exaggerated && b.exaggerated,
      "片方だけ「誇張してある」と言っている（対比が食い違う）: " + JSON.stringify(seen));
    // 違うのは液性だけ
    assert(a.oh === 1 && a.h === 0, "酢酸ナトリウム側が塩基性になっていない: " + JSON.stringify(a));
    assert(b.h === 1 && b.oh === 0, "塩化アンモニウム側が酸性になっていない: " + JSON.stringify(b));
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

  /* 塩化水素の生成。**燃焼ではない化合**で、C群で唯一 O₂ が出てこない。
     HCl は水にとかせば強酸だが、気体の空間では分子のまま —— ここが取り違えやすいので固定する */
  await t("UI: 分子反応 - H₂＋Cl₂→2HCl。気体の空間では HCl は電離しない", async () => {
    const i = STAGES.findIndex((st) => st.id === "synthesis-hcl");
    assert(i >= 0, "synthesis-hcl ステージが無い");
    stageBtn(i).click();
    addBtn(0).click(); addBtn(1).click();   // H₂×1, Cl₂×1
    adv(4500);
    let s = state();
    assert(s.counts["H2"] === 1 && s.counts["Cl2"] === 1, "分子のまま漂わない: " + JSON.stringify(s.counts));
    reactBtn().click();
    adv(15000);
    s = state();
    assert(s.counts["HCl"] === 2, "HCl が2個できない: " + JSON.stringify(s.counts));
    // **ここが要点**: PARTS の既定では HCl は H⁺＋Cl⁻ に分かれる。
    // 気体の空間では水が無いので分子のまま（stage.parts の上書きが効いていること）
    assert(!s.counts["H+"] && !s.counts["Cl-"],
      "水が無いのに電離してしまっている: " + JSON.stringify(s.counts));
    assert(!s.escaped["HCl"], "気体の空間なのに泡で逃げた: " + JSON.stringify(s.escaped));
    assert(s.reactionDone, "反応完了にならない");
    eqOf(STAGES[i], state().eqMode).answer.forEach((n, k) => { for (let m = 0; m < n; m++) ups()[k].click(); });
    s = state();
    assert(s.coeffOk && s.cleared, "係数クリアにならない: coeffOk=" + s.coeffOk + " cleared=" + s.cleared);
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
    const { f, win } = await openProbeFrame(page, (w) => w.IonHeader,
      "position:fixed;left:-9999px;top:0;border:0;width:" + width + "px;height:" + (height || 812) + "px");
    assert(win, page + " が起動しない（iframe を2回開いても IonHeader が現れない）");
    return {
      win, doc: f.contentDocument,
      w: win.innerWidth, h: win.innerHeight,
      cleanup: () => f.remove(),
    };
  };

  /* 自由組み立てモード（redox.html?free=1）も同じ物差しで見張る。
     段0のピッカーは <main> の中に置く決まりなので、**ヘッダーは1pxも太らない**
     （DESIGN_redox_matching.md §4-1）。太らせる修正が入ればここで落ちる。 */
  await t("HEADER: ヘッダーの帯が折り返さず、ページも横に伸びない（全5ページ＋自由組み立て）", async () => {
    for (const page of ["index.html", "redox.html", "redox.html?free=1", "condition.html", "library.html", "portal.html"]) {
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
    // ステージ数は増える。数え上げはデータから引く（手で書くと足すたびに落ちる）
    const total = STAGES.length;
    const narrow = st.bars[0].overflowing; // 全ステージが入りきらない幅かどうか
    if (narrow) {
      assert(st.bars[0].moreRight && !st.bars[0].moreLeft, "先頭なのに『右に続く』の印が出ていない");
      assert(st.stage.count === "1/" + total, "全体で何個あるかが示されていない: " + st.stage.count);
    } else {
      assert(!st.bars[0].moreRight && !st.bars[0].moreLeft, "全部見えているのに続きの印が出ている");
      assert(st.stage.count === "", "全部見えているなら「n/" + total + "」は要らない: " + st.stage.count);
    }
    // 帯の外にいるステージ20を開く（buildStageNav の作り直しに MutationObserver が追従する）
    nav.children[19].click();
    await new Promise((r) => setTimeout(r, 120));
    assert(visible(), "開いたステージが帯の外にいる（帯を中央へ寄せていない）");
    st = p.win.IonHeader.state();
    if (narrow) {
      assert(st.stage.count === "20/" + total, "いま何番めかが追従していない: " + st.stage.count);
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
  await t("HEADER: 横持ち（568×320・750×342）でヘッダーが画面の25%を超えない（全5ページ＋自由組み立て）", async () => {
    const pages = ["index.html", "redox.html", "redox.html?free=1", "condition.html", "library.html", "portal.html"];
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
  await t("HEADER: 狭い縦持ち（320×568）でヘッダーが 120px を超えず、題名の行が折り返さない（全5ページ＋自由組み立て）", async () => {
    const pages = ["index.html", "redox.html", "redox.html?free=1", "condition.html", "library.html", "portal.html"];
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
  await t("TAP: 押せるものが 32px 未満にならない（全5ページ＋自由組み立て・幅375px）", async () => {
    for (const page of ["index.html", "redox.html", "redox.html?free=1", "condition.html", "library.html", "portal.html"]) {
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

  /* ---- 「いま何をする画面か」を示す札（ORDER_review_2026-08-18 の N・v185）----
     「🎯 目標の表示が小さくわかりづらい」という指摘。14px・太さ400 の小さな札で、
     すぐ上の「❓ 遊び方」とまったく同じ見た目だったため、目が拾わなかった
     （320×568 で実測: 札 284×48px・font-size 14px・font-weight 400）。

     **同じ型の指摘が酸化還元にもある**（台帳の H ＝ ⑤の「左辺 ─ …／右辺 ─ …」）ので、
     大きさは style.css の `--now-size` ただ1つが持ち、HTML の札は `.nowLabel`、
     SVG の見出しは `nowLabelPx()` から同じ数を読む、という形にした。
     片方だけ大きくして不ぞろいになるのを防ぐのがこの検査の主目的。

     見張るのは4つ:
       ①札が `--now-size` で出ていて、本文（.hint）より大きく太いこと
         ＝ 誰かが .goal に font-size を書き足して 14px に戻したら落ちる
       ②別レーン（H）が読む共通の値が生きていること（nowLabelPx() === --now-size）
       ③行いっぱいの帯であること（inline-block の小さな札に戻ると、また拾われない）
       ④**大きくした代償を作っていないこと** —— 横にはみ出さない／押しものの床（32px）を
         割らない／札が3行に膨らまない／320×568 でビーカーの頭が画面の外へ出ない
     幅はテストページの iframe に左右されるので openAt で明示的に固定して測る。 */
  await t("NOW: 目標の札が共通の大きさ（--now-size）で本文より大きく、狭い画面でもはみ出さない（320×568 / 375×812）", async () => {
    for (const size of [[320, 568], [375, 812]]) {
      const p = await openAt("index.html", size[0], size[1]);
      // ② 酸化還元の H が SVG の行送りを合わせるために読む共通の値
      assert(typeof p.win.nowLabelPx === "function",
        "nowLabelPx() が無い（redox の SVG 見出しが同じ大きさをたどれない）");
      const varPx = parseFloat(p.win.getComputedStyle(p.doc.documentElement).getPropertyValue("--now-size"));
      assert(varPx >= 16, "--now-size が小さすぎる（" + varPx + "px）— 本文と見分けがつかない");
      assert(p.win.nowLabelPx() === varPx,
        "nowLabelPx() が --now-size と食い違う（" + p.win.nowLabelPx() + " / " + varPx + "px）");
      const hint = parseFloat(p.win.getComputedStyle(p.doc.querySelector(".hint")).fontSize);
      const btns = [...p.doc.querySelectorAll("#stageNav button")];
      // 目標の文がいちばん短い回と長い回の両方で見る（長いほうが折り返しの限界を決める）
      let shortest = 0, longest = 0, sLen = Infinity, lLen = -1;
      for (let i = 0; i < btns.length; i++) {
        btns[i].click();
        const n = p.doc.querySelector("#stageTitle .goal").textContent.length;
        if (n < sLen) { sLen = n; shortest = i; }
        if (n > lLen) { lLen = n; longest = i; }
      }
      for (const i of [shortest, longest]) {
        btns[i].click();
        const g = p.doc.querySelector("#stageTitle .goal");
        const sum = p.doc.querySelector("#stageTitle .stageHead summary");
        const cs = p.win.getComputedStyle(g);
        const r = g.getBoundingClientRect();
        const where = "幅" + p.w + "px ステージ" + (i + 1) + "「" + g.textContent + "」";
        // ①
        assert(parseFloat(cs.fontSize) === varPx,
          where + ": 札が共通の大きさで出ていない（" + cs.fontSize + " ／ --now-size は " + varPx + "px）");
        assert(parseFloat(cs.fontSize) > hint,
          where + ": 札が本文（" + hint + "px）より大きくない");
        assert(parseInt(cs.fontWeight, 10) >= 700, where + ": 札が太字でない（" + cs.fontWeight + "）");
        // ③
        assert(r.width > p.w * 0.7,
          where + ": 札が行いっぱいに広がっていない（" + Math.round(r.width) + "px ／ 画面 " + p.w + "px）");
        // ④ 押しものの床（summary がタップ標的）。TAP の検査と同じ物差し
        assert(sum.getBoundingClientRect().height >= 32,
          where + ": 見出しが 32px の床を割っている（" + Math.round(sum.getBoundingClientRect().height) + "px）");
        // 2行ぶんの高さ＋余白（padding+border）が上限。3行に膨らむと下が押し出される
        const cap = varPx * 1.4 * 2 + 16;
        assert(r.height <= cap,
          where + ": 札が2行に収まっていない（" + Math.round(r.height) + "px ／ 上限 " + Math.round(cap) + "px）");
        assert(p.doc.documentElement.scrollWidth <= p.w + 1,
          where + ": ページが横にはみ出した（" + p.doc.documentElement.scrollWidth + " > " + p.w + "）");
        // 押し出しの実害を直接見る: いちばん狭い画面でもビーカーの頭は1画面目に残る
        if (p.h <= 568) {
          const top = p.doc.getElementById("beaker").getBoundingClientRect().top;
          assert(top < p.h,
            where + ": 札を大きくしたせいでビーカーが1画面目から押し出された（頭が " +
            Math.round(top) + "px ／ 画面の高さ " + p.h + "px）");
        }
      }
      p.cleanup();
    }
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

  /* ================================================================================
     M6-B / M6-C: 自由組み立てモード（redox.html?free=1）
     DESIGN_redox_matching.md §6 の UI 群（14〜17）。

     判定そのもの（3値・理由コード・式のつり合い）は runModelTests が総なめしている。
     ここで見張るのは「**その判定が画面のどこに、どう出るか**」で、とくに次の4つ:
       ・「反応しない」は赤（ng）ではなく案内（info）で出る＝正解のひとつとして扱う
       ・reacts 以外には必ず理由コードと空でない説明文があり、コードは enum の外に出ない
       ・順位の**数値**が画面に出ていない（電位の暗記にすり替わるので絶対に出さない）
       ・梯子の全体は既定で閉じており、開くと上下に分かれて、下半分の並びが
         IONIZATION_SERIES と一致する（＝「イオン化傾向そのもの」という説明が嘘にならない）
     ================================================================================ */

  /* 段0は ?free=1 のときだけ出るので、既存の iframe（通常の入口）とは別に開く */
  const openFree = async () => {
    const { f, win: w } = await openProbeFrame("redox.html?free=1",
      (win) => win.RedoxEq && win.RedoxEq.free,
      "position:fixed;left:-9999px;top:0;border:0;width:375px;height:812px");
    assert(w, "redox.html?free=1 が起動しない（iframe を2回開いても RedoxEq.free が現れない）");
    return {
      win: w, doc: f.contentDocument, free: w.RedoxEq.free,
      // 第3引数は液性（M6-D）。省略すると、いま選ばれているまま（既定は硫酸酸性）
      pick: (a, b, cond) => w.RedoxEq.free.pick(a, b, cond),
      st: () => w.RedoxEq.free.state(),
      cleanup: () => f.remove(),
    };
  };

  await t("M6 UI: ?free=1 で段0が出て、ステージ帯14個は残り、選ぶまで段1は出ない", async () => {
    const p = await openFree();
    const s = p.st();
    assert(s.pickShown, "段0（相手を選ぶ）が出ていない");
    assert(!s.step1Shown && !s.step2Shown, "何も選んでいないのに段1・段2が出ている");
    // ステージ帯は自由モード中も残す（行き止まりを作らない。§4-1）
    assert(p.doc.querySelectorAll("#stageNav button").length === REDOX_STAGES.length,
      "ステージ帯が消えている（自由モードでも収録ステージへ戻れること）");
    // 段0は必ず <main> の中。ヘッダーに新しい UI を足していないこと（§4-1）
    assert(p.doc.querySelector("main #stepPick"), "段0が <main> の外にある");
    assert(!p.doc.querySelector("header #stepPick, header select"), "ヘッダーに選ぶ道具が生えている");
    // どちらの欄にも全試薬が並ぶ（役の取り違え＝same-role を起こせるようにするため。§2-6）
    assert(s.options.ox.length === REAGENTS.length && s.options.red.length === REAGENTS.length,
      "選択肢が役で絞られている（same-role の説明に到達できなくなる）");
    // 通常の入口（?free=1 なし）には段0を出さない
    assert(doc.getElementById("stepPick").hidden, "通常の入口に段0が出ている");
    p.cleanup();
  });

  await t("M6 UI: KMnO₄×FeSO₄ を選ぶと段1に rs1 と同じ2本が出て、5:1 でクリアできる", async () => {
    const p = await openFree();
    const v = p.pick("KMnO4", "FeSO4");
    assert(v.verdict === "reacts", "反応すると判定されない: " + JSON.stringify(v));
    const s = p.st();
    assert(s.step1Shown && s.step2Shown, "反応するのに段1・段2が出ない");
    const rs1 = REDOX_STAGES.find((x) => x.id === "rs1");
    assert(s.stageId === "free:" + rs1.ox + "+" + rs1.red,
      "合成ステージが rs1 と同じ2本になっていない: " + s.stageId);
    assert(JSON.stringify(s.answer) === JSON.stringify(rs1.answer),
      "導いた倍率が rs1 の登録値と違う: " + JSON.stringify(s.answer));
    // 式の中には酸化数のタグが挟まるので、行ごとに主役の元素があることで見る
    const oxRow = p.doc.getElementById("halfOx").textContent;
    const redRow = p.doc.getElementById("halfRed").textContent;
    assert(/Fe/.test(oxRow) && /e⁻/.test(oxRow), "段1の酸化側が Fe²⁺→Fe³⁺ になっていない: " + oxRow);
    assert(/Mn/.test(redRow) && /H₂O/.test(redRow), "段1の還元側が MnO₄⁻ の式になっていない: " + redRow);
    // 模範倍率（5:1）まで上げてクリアできる ＝ 段1以降が収録ステージと同じに動く
    const up = [...p.doc.querySelectorAll(".halfRow .stepper button")].filter((b) => b.textContent === "＋");
    for (let k = 1; k < rs1.answer[0]; k++) up[0].click();
    p.win.RedoxEq.advance(0);
    p.doc.getElementById("playBtn").click();
    p.win.RedoxEq.advance(30000);
    const rs = p.win.RedoxEq.state();
    assert(rs.cleared, "模範倍率にしてもクリアにならない: " + JSON.stringify(rs));
    // ③のイオン反応式まで出る（④⑤は molecularEq を持たないので出ない ＝ 無改修で段③まで）
    assert(!p.doc.getElementById("stepCalc").hidden, "③の筆算が出ない");
    assert(p.doc.getElementById("rowMol").hidden, "molecularEq が無いのに⑤が出ている");
    p.cleanup();
  });

  await t("M6 UI: 「反応しない」4種と undecided が、赤ではなく案内として画面に出る", async () => {
    const p = await openFree();
    /* 4つの理由コードと undecided が、それぞれ**実際に画面へ出る**組み合わせ。
       ここが空振りすると「説明文を用意したのに一生出ない」状態を見逃す。 */
    const cases = [
      ["KMnO4", "K2Cr2O7", "no-reaction", "same-role"],
      ["HCl_dil", "Cu", "no-reaction", "ladder-reversed"],
      ["HNO3_conc", "Al", "no-reaction", "exception"],
      ["AgNO3", "KI", "no-reaction", "exception"],
      ["CuSO4", "Cu", "undecided", "tie"],
      ["HCl_dil", "H2C2O4", "undecided", "not-listed"],
    ];
    for (const [a, b, verdict, code] of cases) {
      const v = p.pick(a, b);
      const tag = a + "×" + b;
      assert(v.verdict === verdict, tag + ": " + verdict + " にならない（" + v.verdict + "）");
      assert(v.reasonCode === code, tag + ": 理由コードが " + code + " でない（" + v.reasonCode + "）");
      const s = p.st();
      assert(!s.step1Shown, tag + ": 反応しないのに段1が出ている");
      // 「反応しない」は正解のひとつ。ng（赤）にはしない（§4-3）
      assert(s.msgKind === "info", tag + ": 赤（ng）で出ている — " + s.msgKind);
      assert(s.msg.trim().length > 0, tag + ": 説明文が空");
      assert(s.fix.trim().length > 0, tag + ": 直せる方向が添えられていない");
    }
    // same-role の主語は「いま選んだ式」。物質を主語にした断定を出さない（§2-6）
    const sr = p.pick("H2O2_asOxidant", "KMnO4");
    assert(sr.reasonCode === "same-role", "H₂O₂×KMnO₄（どちらも酸化剤の欄）が same-role にならない");
    assert(!/H₂O₂ は|は酸化剤です|は還元剤です/.test(p.st().msg),
      "物質を主語にした断定が出ている: " + p.st().msg);
    // 同じ H₂O₂ を還元剤の側で選べば反応する ＝ 役は相手しだいで変わる
    assert(p.pick("KMnO4", "H2O2_asReductant").verdict === "reacts",
      "H₂O₂ を還元剤として選んでも反応しない");
    // 「差が小さいから」という誤った因果を、順位が逆のときの説明に混ぜない（§2-6）
    p.pick("HCl_dil", "Cu");
    assert(!/差が小さ|わずか|著しい反応/.test(p.st().msg), "順位が逆の説明に「差の大小」が混じっている: " + p.st().msg);
    p.cleanup();
  });

  await t("M6 UI: 全ペア総なめ — reacts 以外は必ず理由コードと説明文があり、enum の外が出ない", async () => {
    const p = await openFree();
    const NO_REACTION = ["same-role", "ladder-reversed", "exception"];
    const UNDECIDED = ["wrong-condition", "no-rank", "tie", "not-listed"];
    const seen = new Set();
    let reacts = 0, no = 0, und = 0;
    for (const a of REAGENTS) {
      for (const b of REAGENTS) {
        const tag = a.id + "×" + b.id;
        const v = p.pick(a.id, b.id);
        const s = p.st();
        assert(["reacts", "no-reaction", "undecided"].includes(v.verdict), tag + ": 3値の外 — " + v.verdict);
        if (v.verdict === "reacts") {
          reacts++;
          assert(s.step1Shown && s.msgKind === "ok", tag + ": 反応するのに段1が出ない／ok にならない");
          continue;
        }
        (v.verdict === "no-reaction" ? no++ : und++);
        assert(v.reasonCode, tag + ": " + v.verdict + " なのに理由コードが無い");
        const allowed = v.verdict === "no-reaction" ? NO_REACTION : UNDECIDED;
        assert(allowed.includes(v.reasonCode), tag + ": " + v.verdict + " に " + v.reasonCode + " は使えない");
        assert(s.msg.trim().length > 0, tag + ": 説明文が空のまま画面に出ている");
        assert(s.fix.trim().length > 0, tag + ": 直せる方向が空");
        assert(s.msgKind === "info", tag + ": 赤（ng）で出ている");
        seen.add(v.reasonCode);
      }
    }
    assert(reacts > 0 && no > 0 && und > 0,
      "3値のどれかが1件も出ていない（reacts " + reacts + " / no " + no + " / undecided " + und + "）");
    for (const code of ["same-role", "ladder-reversed", "exception", "tie", "not-listed"]) {
      assert(seen.has(code), code + " が画面から一度も出ない（説明文が死んでいる）");
    }
    p.cleanup();
  });

  await t("M6 UI: 根拠は既定で2行。梯子の全体は閉じて始まり、開くと下半分がイオン化傾向と一致する", async () => {
    const p = await openFree();
    p.pick("AgNO3", "Cu");
    let s = p.st();
    assert(s.whyShown, "判定の根拠が出ていない");
    assert(JSON.stringify(s.whyPair) === JSON.stringify(["Ag⁺", "Cu²⁺"]),
      "根拠の2行が「Ag⁺ ＞ Cu²⁺」になっていない: " + JSON.stringify(s.whyPair));
    assert(!s.ladderOpen, "梯子の全体が既定で開いている（既定は2行。§9-2 A案）");
    // 例外表で決まったものに順位の2行を添えない（「順位でそう決まった」という嘘になる）
    p.pick("HNO3_conc", "Al");
    assert(p.st().whyPair.length === 0, "例外で止まったのに順位の2行が出ている");
    // 開くと上下に分かれ、下半分の金属の並びが IONIZATION_SERIES（の逆順）と一致する
    p.pick("AgNO3", "Cu");
    p.free.toggleLadder();
    s = p.st();
    assert(s.ladderOpen, "「梯子の全体を見る」を押しても開かない");
    assert(s.ladderBandText.length === 2, "梯子が上下2つに分かれていない: " + s.ladderBandText.length);
    const metals = s.ladderMetals.map((x) => x.replace(/[()]/g, ""));
    assert(JSON.stringify(metals) === JSON.stringify([...IONIZATION_SERIES].reverse()),
      "下半分の並びがイオン化傾向と一致しない（「覚えているものそのもの」という説明が嘘になる）: " +
      JSON.stringify(metals) + " / " + JSON.stringify([...IONIZATION_SERIES].reverse()));
    assert(/イオン化傾向/.test(p.doc.getElementById("pickWhy").textContent),
      "「下半分はイオン化傾向そのもの」という枠組みを添えていない");
    /* **順位の数値は絶対に画面に出さない**（§2-3）。梯子の値がそのまま出ていないか総なめする。
       10刻みの値をそのまま書けば、電位の暗記にすり替わる。 */
    const shown = p.doc.querySelector("main").textContent;
    for (const rank of new Set(Object.values(REDOX_LADDER_ACID))) {
      assert(!new RegExp("(^|[^\\d])" + rank + "([^\\d]|$)").test(shown),
        "順位の数値 " + rank + " が画面に出ている");
    }
    // 開閉の状態は覚えない（選び直したら閉じた状態に戻る）
    p.pick("HCl_dil", "Cu");
    assert(!p.st().ladderOpen, "選び直しても梯子が開いたまま（既定を2行に保つのが A案の要）");
    p.cleanup();
  });

  /* ---- M6-D: 液性の選択 ----
     M6-C までは液性が酸性固定だったので、wrong-condition の文面は**画面に出る道が無かった**。
     選べるようにした以上、そこが実際に出ること・出たときに「反応しない」と言っていないことを
     ここで固定する（用意したのに一生出ない文面を作らないための検査）。 */

  await t("M6-D UI: 液性を選べて、切り替えると同じ組み合わせでも別の式になる", async () => {
    const p = await openFree();
    // 既定は酸性。液性の道具は <main> の中（ヘッダーには何も足さない。§4-1）
    assert(p.st().condition === "acid", "既定が硫酸酸性になっていない");
    assert(p.doc.querySelector("main #pickCond"), "液性の選択が <main> の外にある");
    assert(!p.doc.querySelector("header #pickCond, header input"), "ヘッダーに液性の道具が生えている");
    assert(p.doc.querySelectorAll("#pickCond input[type=radio]").length === 2,
      "液性の選択肢が2つでない");
    // 酸性なら MnO₄⁻ → Mn²⁺（5:1 の相手なら e⁻ 5個）
    const a = p.pick("KMnO4", "KI", "acid");
    assert(a.verdict === "reacts", "硫酸酸性で KMnO₄×KI が反応しない");
    assert(p.st().stageId === "free:I_ox+MnO4_red", "酸性なのに Mn²⁺ の式になっていない: " + p.st().stageId);
    /* 式の中には酸化数のタグが挟まる（"Mn+7O₄⁻" のように）ので、化学式まるごとでは照合できない。
       行き先が違うことは**酸化数**で見るのがいちばん確か（+7→+2 か +7→+4 か）。 */
    const acidRow = p.doc.getElementById("halfRed").textContent;
    assert(/\+7/.test(acidRow) && /\+2/.test(acidRow) && !/OH⁻/.test(acidRow),
      "段1が MnO₄⁻→Mn²⁺（+7→+2）になっていない: " + acidRow);
    // 中性・塩基性なら MnO₄⁻ → MnO₂（同じ2つを選んでいるのに式が変わる ＝ M6-D の主眼）
    const b = p.pick("KMnO4", "KI", "basic");
    assert(b.verdict === "reacts", "中性・塩基性で KMnO₄×KI が反応しない");
    assert(p.st().condition === "basic", "液性が切り替わっていない");
    assert(p.st().stageId === "free:I_ox+MnO4_red_neutral",
      "中性・塩基性なのに MnO₂ の式にならない: " + p.st().stageId);
    const redRow = p.doc.getElementById("halfRed").textContent;
    assert(/\+7/.test(redRow) && /\+4/.test(redRow) && /OH⁻/.test(redRow),
      "段1が MnO₄⁻→MnO₂（+7→+4）の式になっていない: " + redRow);
    // 液性は見出しにも出る（あとから見比べられるように）
    assert(/中性・塩基性/.test(p.doc.getElementById("stageTitle").textContent),
      "見出しに液性が出ていない: " + p.doc.getElementById("stageTitle").textContent);
    // 液性の但し書きは「反応しない」ではなく「行き先が変わる」と言う（§2-4）
    assert(/MnO₂/.test(p.st().condNote) && !/反応しません/.test(p.st().condNote),
      "液性の但し書きが「別の式になる」になっていない: " + p.st().condNote);
    // 書き換えモードへの橋（片道にしない。condition.html 側にも帰り道がある）
    assert(p.st().condLinks.includes("condition.html"), "液性の説明から condition.html へ行けない");
    p.cleanup();
  });

  await t("M6-D UI: 中性・塩基性の MnO₄⁻×KI が、模範倍率で最後まで動く", async () => {
    const p = await openFree();
    const v = p.pick("KMnO4", "KI", "basic");
    assert(v.verdict === "reacts", "反応すると判定されない: " + JSON.stringify(v));
    const s = p.st();
    assert(String(s.answer) === "3,2", "導いた倍率が 3:2 でない: " + s.answer);
    // 3:2 まで上げてクリアできる（板は無し＝溶液中。MnO₂ は溶液の中に現れる）
    const up = [...p.doc.querySelectorAll(".halfRow .stepper button")].filter((b) => b.textContent === "＋");
    for (let k = 1; k < 3; k++) up[0].click();
    for (let k = 1; k < 2; k++) up[1].click();
    p.win.RedoxEq.advance(0);
    p.doc.getElementById("playBtn").click();
    p.win.RedoxEq.advance(30000);
    const rs = p.win.RedoxEq.state();
    assert(rs.cleared, "模範倍率にしてもクリアにならない: " + JSON.stringify(rs));
    // 黒褐色の MnO₂ が実際に2個できている（液性で行き先が変わったことの実物）
    assert(rs.counts["MnO2"] === 2, "MnO₂ が2個できない: " + JSON.stringify(rs.counts));
    assert(rs.counts["OH-"] === 8, "OH⁻ が8個できない: " + JSON.stringify(rs.counts));
    assert(!p.doc.getElementById("stepCalc").hidden, "③の筆算が出ない");
    p.cleanup();
  });

  await t("M6-D UI: wrong-condition が実際に画面へ出て、「反応しない」とは言わない", async () => {
    const p = await openFree();
    /* 2つの出かた。どちらも undecided（no-reaction ではない）で、赤ではなく案内。
       ① その液性の式を持っていない試薬（K₂Cr₂O₇ は酸性の式しか無い）
       ② 書き方が食い違う2本（塩基性の MnO₄⁻ × 酸性の書き方のエタノール） */
    for (const [a, b, why] of [["K2Cr2O7", "FeSO4", "式を持っていない"],
                               ["KMnO4", "C2H5OH", "書き方が食い違う"]]) {
      const v = p.pick(a, b, "basic");
      const tag = a + "×" + b + "（" + why + "）";
      assert(v.verdict === "undecided" && v.reasonCode === "wrong-condition",
        tag + ": wrong-condition にならない — " + v.verdict + "/" + v.reasonCode);
      const s = p.st();
      assert(!s.step1Shown, tag + ": 進めないのに段1が出ている");
      assert(s.msgKind === "info", tag + ": 赤（ng）で出ている — " + s.msgKind);
      assert(s.msg.trim().length > 0, tag + ": 説明文が空のまま画面に出ている");
      assert(!/反応しません|起こりません/.test(s.msg), tag + ": 「反応しない」と言っている — " + s.msg);
      assert(s.fix.trim().length > 0, tag + ": 直せる方向が添えられていない");
      // 液性で止まったときは書き換えモードへ渡す（相互リンクの片方）
      assert(s.condLinks.filter((h) => h === "condition.html").length >= 2,
        tag + ": 説明のそばに condition.html への橋が無い");
      // 順位で決まったわけではないので、順位の2行は添えない
      assert(s.whyPair.length === 0, tag + ": 液性で止まったのに順位の2行が出ている");
    }
    // 酸性に戻せば、同じ組み合わせがちゃんと反応する（行き止まりにしない）
    assert(p.pick("K2Cr2O7", "FeSO4", "acid").verdict === "reacts", "酸性に戻しても反応しない");
    p.cleanup();
  });

  await t("M6-D UI: 中性・塩基性で梯子を開くと「この表は酸性条件のもの」と断る", async () => {
    const p = await openFree();
    p.pick("CuSO4", "Zn", "basic");
    p.free.toggleLadder();
    const txt = p.doc.getElementById("pickWhy").textContent;
    assert(/酸性条件のもの/.test(txt), "中性・塩基性なのに酸性の梯子を黙って見せている");
    // 順位の数値は液性を変えても出さない
    const shown = p.doc.querySelector("main").textContent;
    for (const rank of new Set(Object.values(REDOX_LADDER_ACID))) {
      assert(!new RegExp("(^|[^\\d])" + rank + "([^\\d]|$)").test(shown),
        "順位の数値 " + rank + " が画面に出ている");
    }
    p.cleanup();
  });

  /* ---- M6-E: 収録ステージへの橋（§3-3・§6 の 17）----
     選んだ組み合わせが収録ステージと同じなら、解説つきのそちらへ渡す。
     ここで見張るのは3つ:
       ・**対応表を書かず走査で引く**ので、収録ステージを足しても橋が自動で増える
         （試薬で選べるステージを総なめして、1本でも橋が出ないものがあれば落ちる）
       ・引くのは1件ではなく**一覧**（ri1 / ri2 のように同じ組で複数あるものを取りこぼさない）
       ・橋を渡っても**行き止まりにならない**（?free=1 のまま、また組み合わせに戻れる） */

  await t("M6-E UI: 試薬で選べる収録ステージは、全部そのステージへの橋が出る", async () => {
    const p = await openFree();
    /* 硫酸酸性のときに、その半反応式になる試薬（無ければ null）。
       ステージ側の ox は酸化される式（＝還元剤）、red は還元される式（＝酸化剤）。 */
    const reagentFor = (halfId, side) =>
      REAGENTS.find((r) => r.side === side && (r.half.acid || r.half.any) === halfId) || null;
    let covered = 0;
    const missed = [];
    for (const st of REDOX_STAGES) {
      const oxRg = reagentFor(st.red, "ox"), redRg = reagentFor(st.ox, "red");
      if (!oxRg || !redRg) { missed.push(st.id); continue; }
      const v = p.pick(oxRg.id, redRg.id, "acid");
      const tag = st.id + "（" + oxRg.id + "×" + redRg.id + "）";
      assert(v.verdict === "reacts", tag + ": 収録ステージなのに反応しない — " + v.reasonCode);
      const s = p.st();
      assert(s.bridgeShown, tag + ": 収録ステージと同じ組み合わせなのに橋が出ない");
      assert(s.bridge.includes(st.id), tag + ": 橋の行き先に自分がいない — " + JSON.stringify(s.bridge));
      // 走査の結果と画面が一致する ＝ 途中で1件に間引いていない
      assert(JSON.stringify(s.bridge) === JSON.stringify(stagesForHalves(st.ox, st.red).map((x) => x.id)),
        tag + ": 画面の橋が走査の結果と食い違う — " + JSON.stringify(s.bridge));
      assert(/解説つき/.test(s.bridgeText), tag + ": 「解説つきのステージがある」と案内していない");
      covered++;
    }
    /* いま試薬で選べないのはヨードホルムの2本だけ（切り離した断片が出発点なので
       試薬として持てない）。ここが増えたら、収録を足したのに橋から届かない道ができている */
    assert(JSON.stringify(missed) === JSON.stringify(["ri1", "ri2"]),
      "試薬から届かない収録ステージが増えている: " + JSON.stringify(missed));
    assert(covered === REDOX_STAGES.length - 2, "橋を確かめたステージが足りない: " + covered);
    p.cleanup();
  });

  await t("M6-E UI: 同じ組み合わせのステージが複数あるときは、複数とも並ぶ", async () => {
    const p = await openFree();
    /* ri1 と ri2 はどちらも iodoform_ox × I2_red。**1件だけ拾う実装にしない**のが
       この段のいちばん壊れやすいところ（ion ↔ ratio の横断で同じ失敗を踏んでいる）。
       この2本は試薬として選べないので、描画そのものを半反応式で直接叩いて見張る。 */
    const ids = p.free.bridgeIdsFor("iodoform_ox", "I2_red");
    assert(JSON.stringify(ids) === JSON.stringify(["ri1", "ri2"]),
      "同じ組のステージ2本が両方とも並ばない: " + JSON.stringify(ids));
    // 走査で1件も見つからない組み合わせでは、橋そのものを出さない
    assert(p.free.bridgeIdsFor("I_ox", "MnO4_red").length === 0, "収録が無いのに橋が出ている");
    const v = p.pick("KMnO4", "KI", "acid");
    assert(v.verdict === "reacts", "KMnO₄×KI が反応しない");
    assert(!p.st().bridgeShown, "収録ステージが無いのに橋が出ている");
    // 反応しない組み合わせにも橋は出ない
    p.pick("HCl_dil", "Cu");
    assert(!p.st().bridgeShown, "反応しないのに橋が出ている");
    p.cleanup();
  });

  await t("M6-E UI: 橋を渡ると収録ステージが開き、そのまま自由モードに戻れる", async () => {
    const p = await openFree();
    p.pick("CuSO4", "Zn", "acid");
    assert(JSON.stringify(p.st().bridge) === JSON.stringify(["r1"]), "r1 への橋が出ない");
    p.free.openBridge("r1");
    const s = p.st();
    assert(s.freeStage === null && s.stageId === "r1", "橋を渡っても r1 が開かない: " + s.stageId);
    assert(s.step1Shown, "収録ステージなのに段1が出ない");
    // 解説（intro）つきの道に入れたこと
    assert(/亜鉛板/.test(p.doc.getElementById("msg").textContent),
      "収録ステージの解説が出ていない: " + p.doc.getElementById("msg").textContent);
    // 行き止まりを作らない ＝ 段0は残り、選び直せば橋も消えて自由モードへ戻る
    assert(s.pickShown, "橋を渡ったら段0が消えた（また組み合わせられなくなる）");
    p.pick("KMnO4", "FeSO4", "acid");
    assert(p.st().freeStage === "free:Fe2_ox+MnO4_red", "自由モードに戻れない: " + p.st().freeStage);
    assert(JSON.stringify(p.st().bridge) === JSON.stringify(["rs1"]), "選び直した先の橋が出ない");
    p.cleanup();
  });

  /* 申し立て（2026-08-18）:「**ステージを選んでも、自由に組み合わせる、が残っているのが問題です**」。
     v181 では帯を押すとステージ自体は読み込まれていた（stageIdx も .active も動く）のに、
     **見出しが「自由に組み合わせる」のまま**・**段0 が 375px 出っぱなし**で、
     画面の上には何ひとつ変化が出なかった ＝ 押しても何も起きないように見えていた。
     見張るのは「選んだことが画面の上に出るか」と「戻る道が残っているか」の2つ。 */
  await t("M6 UI: 自由モードでステージ帯を押すと、そのステージが開いて見出しが変わり、段0がたたまれる", async () => {
    const p = await openFree();
    const before = p.st();
    assert(before.pickShown && !before.pickFolded, "選ぶ前から段0がたたまれている");
    assert(!before.pickToggleShown, "選ぶ前から「ひらく」釦が出ている");
    assert(before.title.includes("自由に組み合わせる"), "初期の見出しが違う: " + before.title);
    // 畳む前の高さを控える（あとで「どれだけ縮んだか」で見るため）
    const openH = p.doc.getElementById("stepPick").offsetHeight;
    assert(openH > 200, "段0が開いている状態の高さが取れない: " + openH);
    // 帯の5番目（rs1）を押す ＝ ユーザーがやったのと同じ操作
    p.free.openStageFromNav(4);
    const s = p.st();
    const foldedH = p.doc.getElementById("stepPick").offsetHeight;
    assert(s.stageId === "rs1" && s.freeStage === null, "帯からステージが開かない: " + s.stageId);
    // ① 見出しがステージ名になる（申し立ての本体）
    assert(s.title.includes("ステージ5") && !s.title.includes("自由に組み合わせる"),
      "見出しが「自由に組み合わせる」のまま: " + s.title);
    // ② 段0 は見出し1行にたたまれ、画面の上を占めない
    assert(s.pickFolded, "段0がたたまれない（ステージが 375px の下に隠れる）");
    /* **px の決め打ちで測らない**（器の幅が変わると畳んだ高さも変わり、
       開発機の窓では通ってヘッドレスで落ちる。v182 で実際に踏んだ）。
       見るのは「開いていたときと比べて畳めているか」と「見出しが1行に収まるか」の2つ */
    assert(foldedH * 3 < openH, `畳んでも縮んでいない: ${openH} → ${foldedH}`);
    {
      const ht = p.doc.getElementById("pickHeadText");
      const lh = parseFloat(p.win.getComputedStyle(ht).lineHeight);
      assert(lh > 0, "見出しの行の高さが数で取れない（line-height が normal のまま）");
      assert(ht.offsetHeight < lh * 1.6,
        `畳んだ見出しが折り返している（${Math.round(ht.offsetHeight / lh)}行・幅 ${ht.offsetWidth}px）`);
    }
    assert(s.step1Shown && s.step2Shown, "ステージの段1・段2が出ない");
    // ③ 押した番号に印が付く
    const active = [...p.doc.querySelectorAll("#stageNav button.active")].map((b) => b.textContent);
    assert(JSON.stringify(active) === JSON.stringify(["5"]), "帯の印が付かない: " + JSON.stringify(active));
    // ④ 行き止まりを作らない ＝ 釦ひとつで自由の組み合わせに戻れる（?free=1 は外れない）
    assert(s.pickToggleShown, "たたんだのに開き直す釦が出ていない");
    p.free.togglePick();
    const o = p.st();
    assert(!o.pickFolded && o.pickShown, "開き直せない（自由の組み合わせが行き止まりになる）");
    assert(o.stageId === "rs1", "開き直しただけでステージが消えた: " + o.stageId);
    assert(p.win.location.search.includes("free=1"), "?free=1 が外れた: " + p.win.location.search);
    // ⑤ 別の番号を押せば、たたんだ状態からやり直せる
    p.free.openStageFromNav(0);
    assert(p.st().stageId === "r1" && p.st().pickFolded && p.st().title.includes("ステージ1"),
      "2本目のステージへ移れない: " + JSON.stringify([p.st().stageId, p.st().title]));
    p.cleanup();
  });

  await t("M6-E UI: 橋を渡ったときも見出しがステージ名になり、段0はたたまれる", async () => {
    const p = await openFree();
    p.pick("CuSO4", "Zn", "acid");
    // 組み合わせが成立しているあいだは、判定と根拠がここに出るのでたたまない
    assert(!p.st().pickFolded, "自分の組み合わせを見ているのに段0がたたまれた");
    assert(p.st().title.includes("自由に組み合わせる："), "合成ステージの見出しが違う: " + p.st().title);
    p.free.openBridge("r1");
    const s = p.st();
    assert(s.title.includes("ステージ1") && !s.title.includes("自由に組み合わせる"),
      "橋を渡っても見出しが変わらない: " + s.title);
    assert(s.pickFolded && s.pickToggleShown, "橋を渡っても段0がたたまれない");
    assert(s.pickHead.includes("別の組み合わせ"), "たたんだ見出しが案内になっていない: " + s.pickHead);
    p.cleanup();
  });

  /* ---- 瓶から化学反応式を組み立てる段（v180）---- */
  const openB = (id) => stageBtn(REDOX_STAGES.findIndex((s) => s.id === id)).click();
  const bumpB = (i) => doc.querySelectorAll("#schematicAdd button")[i].click();
  const selsB = () => $$("#bottleQuiz select");
  const pickB = (sel, v) => { sel.value = v; sel.dispatchEvent(new win.Event("change", { bubbles: true })); };
  const noteB = (sel) => sel.parentElement.querySelector(".bottleNote").textContent;
  const txtB = (id) => (doc.getElementById(id).textContent || "").replace(/\s+/g, " ").trim();
  /* ⑤の数入力（v182）。瓶 → 入力欄。値を入れて input を撃つ（実際の打鍵と同じ道） */
  const cinB = (sp) => doc.getElementById("bc_" + sp.replace(/[^A-Za-z0-9]/g, "_"));
  const putB = (sp, n) => {
    const i = cinB(sp);
    if (!i) throw new Error("その瓶の入力欄が無い: " + sp);
    i.value = String(n);
    i.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const cnoteB = (sp) => cinB(sp).parentElement.parentElement.querySelector(".bcNote").textContent;
  /* rs1 を「倍率 5:1・瓶の割り当ては3つとも正解」の状態まで進める。
     テストの順番に頼らないよう、必要な回で毎回ここから作り直す */
  const setupRs1B = () => {
    openB("rs1");
    let g = 0;
    while (state().mult[0] < 5 && g++ < 10) bumpB(0);
    const s = selsB();
    pickB(s[0], "bottle:FeSO4");
    pickB(s[1], "bottle:KMnO4");
    pickB(s[2], "bottle:H2SO4");
    return s;
  };

  /* 【C】③の係数を先に言う段（v182）。
     いちばん見張りたいのは **「写すだけ」になっていないこと** ＝ 答えるあいだ、
     倍率をかけた2行も、係数の入った④の問いも、画面のどこにも出ていないこと */
  await t("REDOX: ③の係数を先に言う段 - 答えるあいだ筆算は伏せられ、写せる場所がどこにも無い", async () => {
    openB("rs1");
    const ig = doc.getElementById("ionicGuess");
    // 既定は閉じ（ふつうの流れを置き換えない・v174 の比予想クイズと同じ流儀）
    assert(!ig.open, "既定で開いている（ふつうの流れを置き換えている）");
    // e⁻ がそろうまでは段そのものが出ない（最簡比でない係数を答えさせても意味がない）
    assert(ig.hidden, "倍率が合う前から③の係数入力が出ている");
    let g = 0;
    while (state().mult[0] < 5 && g++ < 10) bumpB(0);
    assert(!ig.hidden, "倍率がそろっても③の係数入力が出ない");
    ig.open = true;
    ig.dispatchEvent(new win.Event("toggle"));
    // ① 筆算そのものが伏せられる ＝ ×5 した式・×1 した式が読めない
    assert(doc.getElementById("calcSheetWrap").hidden, "答える前から筆算が見えている（写せてしまう）");
    // ② ④⑤（瓶の段）も出ない。「H⁺ 8個 を連れてきたのは？」に係数が入っているので
    assert(doc.getElementById("stepBottles").hidden, "答える前から瓶の段が出ている（係数が下から漏れる）");
    /* ③ **目に見えている**文字のどこにも、答えの係数の並びが無い。
       textContent をそのまま読むと、隠れている段（別のステージで組んだままの DOM）まで
       拾って落ちるので、隠れている枝を除いて数える */
    const visibleText = (root) => {
      let out = "";
      const walk = (n) => {
        if (n.nodeType === 3) { out += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        if (n.hidden || win.getComputedStyle(n).display === "none") return;
        for (const c of n.childNodes) walk(c);
      };
      walk(root);
      return out.replace(/\s+/g, " ");
    };
    const seen = visibleText(doc.getElementById("timeline"));
    /* 見張るのは**掛け算をした側**（×5 の還元剤）。ここが読めてしまうと写すだけになる。
       ⚠ 酸化剤側は ×1 なので、①の素の式の係数（8 H⁺・4 H₂O）が答えと同じ数になる ——
       これは伏せようがないし、伏せる意味もない（掛け算をしていないので作業が無い）。
       この段が測っているのは「①に倍率をかけて足す」ことで、その仕事は ×5 の側にある */
    for (const s of ["5 Fe²⁺", "5 Fe³⁺"]) {
      assert(!seen.includes(s), `答えの係数「${s}」が画面に出ている（写せてしまう）: ` + seen.slice(0, 240));
    }
    // 手がかりは①の素の半反応式（倍率なし）と、②で自分が決めた ×5・×1 だけ
    // （①の式には酸化数のラベルが挟まるので "MnO₄⁻" は連続した文字列にならない）
    const half = (doc.getElementById("halfSheet").textContent || "").replace(/\s+/g, " ");
    assert(half.includes("O₄⁻") && half.includes("e⁻"), "①の半反応式が消えている: " + half);
    const igInput = (i, n) => {
      const e = doc.getElementById("ig_" + i);
      e.value = String(n);
      e.dispatchEvent(new win.Event("input", { bubbles: true }));
    };
    const igMsg = () => doc.getElementById("ionicGuessMsg").textContent;
    assert($$(".igInput").length === 6, "係数の欄が6つでない: " + $$(".igInput").length);
    // 全体が2倍 → 形は合っていると認めたうえで割らせる
    [10, 2, 16, 10, 2, 8].forEach((n, i) => igInput(i, n));
    assert(igMsg().includes("ぜんぶが 2 倍"), "全体倍を見抜かない: " + igMsg());
    assert(doc.getElementById("calcSheetWrap").hidden, "外しているのに筆算が出た");
    // 1つだけ違う → その項に印が付き、出どころを言う
    igInput(0, 1);
    assert(doc.getElementById("ig_0").classList.contains("ng"), "違う項に印が付かない");
    assert(igMsg().includes("【還元剤】"), "出どころを言わない: " + igMsg());
    // 当てると、その場で筆算が現れて答え合わせになる
    [5, 1, 8, 5, 1, 4].forEach((n, i) => igInput(i, n));
    assert(!doc.getElementById("calcSheetWrap").hidden, "当てても筆算が出ない");
    const sumOx = (doc.getElementById("rowSumOx").textContent || "").replace(/\s+/g, " ");
    assert(sumOx.includes("5 Fe"), "答え合わせの筆算が出ない: " + sumOx);
    assert(!doc.getElementById("stepBottles").hidden, "当てても瓶の段が出ない");
    // 後片づけ: この段は localStorage で開閉を覚えるので、閉じずに終わると
    // 同じ iframe を使う後続のテストが「伏せられたまま」になる
    ig.open = false;
    ig.dispatchEvent(new win.Event("toggle"));
  });

  await t("REDOX: ③の係数を先に言う段 - 「筆算を見る」で降りられ、開閉は覚える（行き止まりを作らない）", async () => {
    openB("rs1");
    const ig = doc.getElementById("ionicGuess");
    let g = 0;
    while (state().mult[0] < 5 && g++ < 10) bumpB(0);
    ig.open = true;
    ig.dispatchEvent(new win.Event("toggle"));
    assert(doc.getElementById("calcSheetWrap").hidden, "伏せられていない");
    // 答えられなくても進める（学習を止めない）
    doc.getElementById("ionicGuessSkip").click();
    assert(!doc.getElementById("calcSheetWrap").hidden, "「筆算を見る」で降りられない");
    assert(!doc.getElementById("stepBottles").hidden, "降りても瓶の段が出ない");
    // 開いたことは覚えている（localStorage）
    assert(win.localStorage.getItem("ionEq.redox.ionicGuess.open") === "1", "開閉を覚えていない");
    // ステージを開き直すと、また伏せた状態からやり直せる（前の答えが残らない）
    openB("rs1");
    let h = 0;
    while (state().mult[0] < 5 && h++ < 10) bumpB(0);
    assert(doc.getElementById("calcSheetWrap").hidden, "開き直しても伏せに戻らない");
    assert($$(".igInput").every((i) => i.value === ""), "前に入れた係数が残っている");
    // 後片づけ: 次のテストのために閉じておく（既定は閉じ）
    ig.open = false;
    ig.dispatchEvent(new win.Event("toggle"));
    assert(win.localStorage.getItem("ionEq.redox.ionicGuess.open") === "0", "閉じたことを覚えていない");
  });

  /* 【F】有機（発展）の区別が、画面の3か所に出ていること。
     見出しだけだと帯を見ているときに分からないので、帯の番号と「☰ 一覧」にも出す */
  await t("REDOX: 有機（発展）の段は、見出し・帯の番号・☰一覧の3か所で区別される", async () => {
    const organics = REDOX_STAGES.map((s, i) => (isOrganicStage(s) ? i : -1)).filter((i) => i >= 0);
    assert(organics.length === 5, "有機のステージが5本でない: " + organics.length);
    // ① 帯の番号（8〜12 だけに印が付き、それ以外には付かない）
    openB("ro1");
    const marked = [...doc.querySelectorAll("#stageNav button.organic")].map((b) => b.textContent).join();
    assert(marked === "8,9,10,11,12", "帯の番号の印が 8〜12 でない: " + marked);
    // ② 見出しの札
    const tag = doc.querySelector("#stageTitle .levelTag");
    assert(tag && tag.textContent === "有機（発展）", "見出しに有機の札が出ない: " + (tag && tag.textContent));
    // ③ ☰ 一覧の行き先の名前（指ではホバーが出ないので、押さずに読めるところに置く）
    const labels = [...doc.querySelectorAll("#stageNav button")].map((b) => b.dataset.label);
    assert(labels[7].includes("有機（発展）"), "一覧の行に札が入らない: " + labels[7]);
    assert(!labels[6].includes("有機"), "化学基礎のステージ7に札が付いている: " + labels[6]);
    assert(!labels[12].includes("有機"), "化学基礎のステージ13に札が付いている: " + labels[12]);
    // 化学基礎の段に戻ると札は消える（出しっぱなしにしない）
    openB("rs1");
    assert(!doc.querySelector("#stageTitle .levelTag"), "化学基礎の段に有機の札が残っている");
    assert(doc.querySelectorAll("#stageNav button.organic").length === 5, "帯の印が5個から変わった");
  });

  await t("REDOX: 瓶の段 - 左辺のイオンどうしを組もうとすると「互いを連れてきていません」と言う", async () => {
    openB("rs1");
    // e⁻ がそろうまでは段そのものが出ない（イオン反応式が決まっていないので瓶も決まらない）
    assert(doc.getElementById("stepBottles").hidden, "e⁻ が合う前から瓶の段が出ている");
    let g = 0;
    while (state().mult[0] < 5 && g++ < 10) bumpB(0);
    assert(String(state().mult) === "5,1", "倍率が 5:1 にならない: " + state().mult);
    assert(!doc.getElementById("stepBottles").hidden, "倍率をそろえても瓶の段が出ない");
    // 瓶棚には「入れた3本」と、それぞれが溶けて出すイオンが並ぶ
    const rack = txtB("bottleRack");
    for (const s of ["KMnO₄", "K⁺ ＋ MnO₄⁻", "FeSO₄", "Fe²⁺ ＋ SO₄²⁻", "H₂SO₄", "2 H⁺ ＋ SO₄²⁻"]) {
      assert(rack.includes(s), "瓶棚に " + s + " が出ない: " + rack);
    }
    const s = selsB();
    assert(s.length === 3, "左辺のイオンぶんの欄が出ない: " + s.length);
    const hSel = s[2];
    // **罠が選択肢にある**（黙って隠さない）
    assert([...hSel.options].some((o) => o.value === "ion:MnO4-"), "左辺のイオンと組む選択肢が無い");
    // ① 左辺のイオンどうしを組む → 出自が別だと言う
    pickB(hSel, "ion:MnO4-");
    const n1 = noteB(hSel);
    assert(n1.includes("互いを連れてきていません"), "出自の説明が出ない: " + n1);
    assert(n1.includes("H₂SO₄") && n1.includes("KMnO₄"), "どちらが連れてきたかを言わない: " + n1);
    assert(hSel.parentElement.querySelector(".bottleNote").classList.contains("ngcell"), "誤りの色にならない");
    assert(doc.getElementById("bottleTail").hidden, "誤ったまま⑤が出ている");
    // ② そのイオンを出さない瓶
    pickB(hSel, "bottle:FeSO4");
    assert(noteB(hSel).includes("H⁺ は出しません"), "出さない瓶の説明が出ない: " + noteB(hSel));
    assert(doc.getElementById("bottleTail").hidden, "誤ったまま⑤が出ている");
    // ③ 正解 → 一緒に来る傍観イオンまで言う（「なぜ SO₄²⁻ が居るのか」の答え）
    pickB(hSel, "bottle:H2SO4");
    const n3 = noteB(hSel);
    assert(n3.includes("SO₄²⁻") && n3.includes("反応しない"), "ついて来る傍観イオンを言わない: " + n3);
    assert(hSel.parentElement.querySelector(".bottleNote").classList.contains("okcell"), "正解の色にならない");
    // 3つそろって初めて⑤が出る
    assert(doc.getElementById("bottleTail").hidden, "1つ答えただけで⑤が出る");
    assert(txtB("bottleMsg").includes("あと 2 個"), "残りの数を言わない: " + txtB("bottleMsg"));
    pickB(s[0], "bottle:FeSO4");
    pickB(s[1], "bottle:KMnO4");
    assert(!doc.getElementById("bottleTail").hidden, "3つそろっても⑤が出ない");
  });

  /* v182・B: ⑤は本数の**数入力**になった。画面が割り算の答えを表示していた v181 と違い、
     答えの本数はどこにも出ていないこと（＝写して埋められないこと）まで見張る */
  await t("REDOX: 瓶の段⑤ - 本数を自分で入れる。答えは画面に出ておらず、外すと何個になるかを言う", async () => {
    setupRs1B();
    const counts = txtB("bottleCounts");
    // 手がかりは「要る個数」と「1本ぶんの内訳」まで
    assert(counts.includes("H⁺ が 8個 要る"), "必要な H⁺ の数が出ない: " + counts);
    assert(counts.includes("H₂SO₄ 1本が出すのは 2 H⁺ ＋ SO₄²⁻"), "1本ぶんの内訳が出ない: " + counts);
    // **答えの本数は出ていない**（v181 は「8 ÷ 2 = H₂SO₄ 4本」と表示していた）
    assert(!/本数|4本|5本|1本が出す.*＝/.test(counts.replace("H₂SO₄ 1本が出すのは 2 H⁺ ＋ SO₄²⁻", "")),
      "答えの本数が画面に出ている: " + counts);
    // 入力欄は瓶の数だけあり、最初は空
    assert($$(".bottleCountInput").length === 3, "入力欄が3つでない: " + $$(".bottleCountInput").length);
    assert($$(".bottleCountInput").every((i) => i.value === ""), "入力欄が最初から埋まっている");
    // そろうまで、蒸発のあとも化学反応式も出さない（答えが先に見えない）
    assert(doc.getElementById("bottlePool").hidden, "入力前から蒸発後のイオンが出ている");
    assert(txtB("bottleTailMsg").includes("あと 3 本ぶん"), "残りを言わない: " + txtB("bottleTailMsg"));
    // 外した本数 → 「その本数だと何個になるか」と「何個要るか」を言う。答えは言わない
    putB("H2SO4", 2);
    const ng = cnoteB("H2SO4");
    assert(ng.includes("2×2＝4個") && ng.includes("8個 要る"), "外したときの説明が出ない: " + ng);
    assert(!/＝ 4本|4本 でちょうど/.test(ng), "答えの本数を言ってしまっている: " + ng);
    assert(cinB("H2SO4").parentElement.parentElement.querySelector(".bcNote").classList.contains("ngcell"),
      "誤りの色にならない");
    // 正解 → 割り算の筋道と、**ついて来た**傍観イオンを言う
    putB("H2SO4", 4);
    const ok = cnoteB("H2SO4");
    assert(ok.includes("＝ 4本") && ok.includes("SO₄²⁻ が 4個 ついて来る") && ok.includes("加えたのではなく"),
      "正解の筋道が出ない: " + ok);
    putB("KMnO4", 1);
    putB("FeSO4", 5);
    // 3本そろうと蒸発のあとが出る。×1 では Fe³⁺ が5個であまる ＝ ここが山場
    assert(!doc.getElementById("bottlePool").hidden, "そろっても蒸発後が出ない");
    assert(doc.getElementById("bottleSheet").textContent.trim() === "", "組めていないのに化学反応式が出ている");
  });

  /* v182・D: 全体の倍率は**例外**。常設のステッパーをやめ、半端が出たときだけ案内が立つ */
  await t("REDOX: 瓶の段⑤ - 倍率は常設せず、半端が出たときだけ案内が出て ×2 で完成する", async () => {
    setupRs1B();
    // 常設のステッパーはもう無い
    assert($$(".bottleScaleRow").length === 0, "倍率のステッパーが常設のまま");
    putB("KMnO4", 1); putB("FeSO4", 5); putB("H2SO4", 4);
    // 半端が出たので、ここで初めて案内が立つ。**1/2 が出ることを数で言う**
    const box = doc.getElementById("bottleScaleBox");
    assert(!box.hidden, "半端が出ても倍率の案内が出ない");
    const why = (box.textContent || "").replace(/\s+/g, " ");
    assert(why.includes("Fe₂(SO₄)₃ が 2.5個") && why.includes("1/2"), "1/2 が出ると言っていない: " + why);
    assert(why.includes("めずらしい"), "例外だと言っていない: " + why);
    // 釦は1つ（探させない）
    assert(box.querySelectorAll("button").length === 1, "倍率の釦が1つでない");
    box.querySelector(".bsGo").click();
    // **入力ずみの本数も倍になる**（自分で出した値がそのまま2倍になって見える）
    assert(cinB("KMnO4").value === "2" && cinB("FeSO4").value === "10" && cinB("H2SO4").value === "8",
      "本数が倍にならない: " + [cinB("KMnO4").value, cinB("FeSO4").value, cinB("H2SO4").value]);
    const sheet = txtB("bottleSheet");
    assert(sheet.includes("2 KMnO₄") && sheet.includes("10 FeSO₄") && sheet.includes("8 H₂SO₄"),
      "左辺が瓶の姿で出ない: " + sheet);
    assert(sheet.includes("5 Fe₂(SO₄)₃") && sheet.includes("2 MnSO₄") && sheet.includes("K₂SO₄") && sheet.includes("8 H₂O"),
      "右辺の塩が出ない: " + sheet);
    assert(txtB("bottleTailMsg").includes("ぴったり"), "完成と言わない: " + txtB("bottleTailMsg"));
    // 蒸発後のプール。**筆算の「両辺に18個足す」と同じ 18 を「ついて来た」で出す**
    const pool = txtB("bottlePool");
    assert(pool.includes("瓶が連れてきて、反応しなかったイオン") && pool.includes("SO₄²⁻ 18個"),
      "ついて来た合計が出ない: " + pool);
    assert(pool.includes("K⁺ 2個"), "残ったイオンが出ない: " + pool);
    assert(pool.includes("10 Fe³⁺ ＋ 15 SO₄²⁻ → Fe₂(SO₄)₃ 5個"), "対の作り方が出ない: " + pool);
    assert(pool.includes("イオンでないものはそのまま右辺に残る"), "中性のものの行が出ない: " + pool);
    // 戻る道は残す（×1 に戻せる）
    assert(!doc.getElementById("bottleScaleBox").hidden, "倍にしたあと戻す道が無い");
    // rs2 は倍率の話が一度も出ない（rs1 との対比）
    openB("rs2");
    let g = 0;
    while (state().mult[0] < 6 && g++ < 10) bumpB(0);
    const s = selsB();
    assert(s.length === 3, "rs2 の欄が3つでない: " + s.length);
    pickB(s[0], "bottle:FeSO4");
    pickB(s[1], "bottle:K2Cr2O7");
    pickB(s[2], "bottle:H2SO4");
    putB("K2Cr2O7", 1); putB("FeSO4", 6); putB("H2SO4", 7);
    const sheet2 = txtB("bottleSheet");
    assert(sheet2.includes("K₂Cr₂O₇") && sheet2.includes("6 FeSO₄") && sheet2.includes("7 H₂SO₄"),
      "rs2 の左辺が出ない: " + sheet2);
    assert(sheet2.includes("3 Fe₂(SO₄)₃") && sheet2.includes("Cr₂(SO₄)₃") && sheet2.includes("7 H₂O"),
      "rs2 の右辺が出ない: " + sheet2);
    assert(doc.getElementById("bottleScaleBox").hidden, "rs2 で倍率の案内が出ている（例外が既定の顔をしている）");
  });

  await t("REDOX: 瓶の段 - 筆算のあるステージには出ず、倍率を崩すと引っ込む", async () => {
    /* 【A】金属樹（r1・r2・r4）には瓶の段を出さない ＝ イオン反応式で終わる。
       押しても何も無いのではなく、そもそも段が現れない */
    for (const id of ["r1", "r2", "r4"]) {
      openB(id);
      const st = REDOX_STAGES.find((s) => s.id === id);
      let g = 0;
      while (state().mult[0] < st.answer[0] && g++ < 10) bumpB(0);
      while (state().mult[1] < st.answer[1] && g++ < 10) bumpB(1);
      assert(String(state().mult) === String(st.answer), id + ": 模範倍率にならない: " + state().mult);
      assert(doc.getElementById("stepBottles").hidden, id + "（金属樹）で瓶の段が出ている");
    }
    // r3（亜鉛×塩酸）は気体発生なので残す。電離しない瓶（板）も同じ仕組みに乗る
    openB("r3");
    assert(!doc.getElementById("stepBottles").hidden, "r3 で瓶の段が出ない");
    assert(txtB("bottleRack").includes("水にとけてイオンに分かれない"), "板が電離しないと言っていない");
    const s = selsB();
    pickB(s[0], "bottle:HCl");
    assert(noteB(s[0]).includes("Zn は出しません"), "誤りの説明が出ない: " + noteB(s[0]));
    pickB(s[0], "bottle:Zn");
    pickB(s[1], "bottle:HCl");
    // ⑤の数入力（v182）。板（Zn）も「1本」として同じ入力に乗る
    putB("Zn", 1);
    putB("HCl", 2);
    assert(txtB("bottleSheet").includes("2 HCl") && txtB("bottleSheet").includes("ZnCl₂"),
      "r3 の化学反応式が出ない: " + txtB("bottleSheet"));
    assert(doc.getElementById("bottleScaleBox").hidden, "r3 で倍率の案内が出ている（例外が既定の顔をしている）");
    // 倍率を崩すと段ごと引っ込み、選んだ答えも入れた本数も白紙に戻る
    bumpB(0);
    assert(doc.getElementById("stepBottles").hidden, "e⁻ が合わなくなっても瓶の段が残る");
    openB("r3");
    assert(selsB().every((x) => x.value === ""), "ステージを開き直しても答えが残っている");
    // 既存の筆算（molecularEq）を持つステージには出さない ＝ 1画面に2つの作り方を並べない
    openB("rn1");
    let g = 0;
    while (state().mult[0] < 3 && g++ < 10) bumpB(0);
    while (state().mult[1] < 2 && g++ < 10) bumpB(1);
    assert(doc.getElementById("stepBottles").hidden, "筆算のある rn1 で瓶の段が出ている");
    assert(!doc.getElementById("rowAdd").hidden, "rn1 の筆算④が出ていない（既存の段を壊した）");
    openB("ri1");
    assert(doc.getElementById("stepBottles").hidden, "瓶を持たない ri1 で瓶の段が出ている");
  });

  await t("M6 UI: 自由モードからステージ帯で収録ステージへ戻れる（行き止まりを作らない）", async () => {
    const p = await openFree();
    p.pick("KMnO4", "FeSO4");
    assert(p.st().freeStage, "自由モードの合成ステージになっていない");
    p.doc.querySelectorAll("#stageNav button")[2].click();
    const s = p.st();
    assert(s.freeStage === null, "ステージ帯を押しても自由モードから抜けない");
    assert(s.stageId === REDOX_STAGES[2].id, "3番めのステージが開かない: " + s.stageId);
    assert(s.step1Shown, "収録ステージに戻ったのに段1が出ない");
    assert(s.pickShown, "自由モードの段0が消えている（また組み合わせられなくなる）");
    p.cleanup();
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
  // アニメ種別の enum は**レジストリそのもの**（library.js の ANIMATIONS）。
  // ここに別の配列を書くと、レジストリに足した型を enum に足し忘れる／その逆が起きる
  const ANIM_ENUM = Object.keys(ANIMATIONS);

  const deriveSpecies = (rx) => {
    const s = new Set();
    // 反応ごとの分解上書き（C群は原子に分解）を尊重する
    const partsFor = (sp) => (rx.parts && rx.parts[sp]) || PARTS[sp] || [sp];
    [...rx.reactants, ...rx.products].forEach((x) => s.add(x));
    rx.reactants.forEach((r) => (DISSOCIATION[r] || ATOMIZATION[r] || []).forEach((i) => s.add(i)));
    rx.products.forEach((p) => partsFor(p).forEach((i) => s.add(i)));
    // イオン反応式の項も登場種（物質検索で引けること）
    if (rx.ionic) [...rx.ionic.reactants, ...rx.ionic.products].forEach((i) => s.add(i));
    // ビーカーに入れる試薬。ふつうは式の反応物と同じだが、**分子反応式を書けない反応**
    // （noMolecular。NH₄Cl の加水分解）は式がイオンだけになるので、これが無いと
    // 「NH₄Cl」で索引を引いても出てこない ＝ 入れる物質の名前で辿り着けなくなる
    (rx.reagents || []).forEach((r) => {
      s.add(r);
      (DISSOCIATION[r] || ATOMIZATION[r] || []).forEach((i) => s.add(i));
    });
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

  /* 画面にそのまま出る文に Markdown が混ざっていないこと。
     このアプリは説明文を素のテキストとして描くので、`**強調**` と書くと
     **アスタリスクがそのまま表示される**。設計書を書く手のまま解説文を書くと必ず起きる
     （実際 v166 で1件公開してしまい、v169 の実機確認で気づいた）。
     /qa/ の test.html が同じ検査を持っており、そちらと同じ趣旨。 */
  await t("画面に出る文に Markdown 記法が混ざっていない（そのまま表示されてしまう）", () => {
    const NG = /\*\*|__|`|^#{1,6}\s/;
    let checked = 0;
    const look = (id, field, s) => {
      if (typeof s !== "string") return;
      checked++;
      assert(!NG.test(s), id + " の " + field + " に Markdown 記法: " +
        s.slice(Math.max(0, s.search(NG) - 20), s.search(NG) + 40));
    };
    for (const st of [...STAGES, ...REDOX_STAGES]) {
      for (const f of ["title", "intro", "doneNote", "netIon", "noMolecular"]) look(st.id, f, st[f]);
    }
    for (const rx of data.reactions) for (const f of ["note", "netIonic"]) look(rx.id, f, rx[f]);
    assert(checked >= 200, "調べた文が少なすぎる（検査が空回りしている）: " + checked);
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
      }
    }
  });

  /* ---- アニメタイプ・レジストリ（Phase 3）----
     「遊べるか・どこへ送るか」を手書きの真偽値ではなくデータから導出する、の担保。
     この4本があると、ステージの増減と索引の表示が二度と食い違わない。 */

  await t("アニメレジストリ: 全 animationType が登録され、実装ありの型は行き先を宣言している", () => {
    assert(typeof ANIMATIONS === "object" && ANIMATIONS, "library.js の ANIMATIONS が読み込まれていない");
    assert(typeof resolvePlayback === "function" && typeof stageIndex === "function", "resolvePlayback / stageIndex が無い");
    for (const rx of data.reactions) {
      assert(ANIMATIONS[rx.animationType], rx.id + ": animationType " + rx.animationType + " がレジストリに無い");
    }
    for (const [type, a] of Object.entries(ANIMATIONS)) {
      assert(a.title, type + ": title が無い");
      if (!a.screen) {
        // 未実装の型は「なぜ準備中なのか」を必ず書く（黙って遊べない型を増やさない）
        assert(a.pending && !a.engine, type + ": 未実装なら pending に理由を書き、engine は持たない");
        continue;
      }
      assert(a.engine && a.param && a.stageKey && a.playLabel, type + ": 実装ありの宣言が欠けている");
      assert(["puzzle", "redox"].includes(a.stageSet), type + ": stageSet 不正 " + a.stageSet);
      assert(a.stageKey === (a.stageSet === "redox" ? "redoxStage" : "id"), type + ": stageSet と stageKey が対応しない");
    }
  });

  await t("遊べるかは導出で決まる: 54件が遊べ、2件が準備中（内訳を固定）", () => {
    const idx = stageIndex(STAGES, REDOX_STAGES);
    const pending = data.reactions.filter((rx) => !resolvePlayback(rx, idx).playable).map((r) => r.id).sort();
    const playable = data.reactions.filter((rx) => resolvePlayback(rx, idx).playable);
    // 準備中は5本とも**式はあるがステージが無い**だけ。エンジンはすべて実装ずみ
    //（C群は v40／部分電離は v165〜v167。v168 でレジストリの「未実装」宣言を実態に合わせた）
    const expected = ["gas-caco3-hcl", "redox-al-h2so4"];
    assert(JSON.stringify(pending) === JSON.stringify(expected),
      "準備中の内訳が変わった: " + pending.join(",") + "（想定 " + expected.join(",") + "）");
    assert(playable.length === 54, "遊べる反応が 54 件でない: " + playable.length);
    const reason = (id) => resolvePlayback(data.reactions.find((r) => r.id === id), idx).reason;
    for (const id of expected) {
      assert(reason(id) === "stage-missing", id + ": ステージ未実装のはず（" + reason(id) + "）");
    }
  });

  /* v168 で入れた検査。**レジストリが「このエンジンは未実装」と言い張れないようにする。**
     実際に起きていた事故: C群エンジンは v40 から動いていたのに、レジストリは
     「原子にばらけて再結合するアニメは未実装」と宣言したままだった。しかも動いていた
     4本の燃焼ステージは animationType が aqueous と付け違えられていたので、
     宣言と実態のどちらを見ても食い違いに気づけなかった。
     部分電離（weak-partial）も同じで、v165〜v167 で実装したあとも「未実装」のままだった。

     これを放っておくと、次の人が**すでにあるエンジンを作り直す**。
     索引の「準備中」の理由も嘘になる（本当はステージが無いだけなのに、エンジンのせいにする）。 */
  /* 上の事故の**本体**はこちら。付け違えを直に捕まえる。
     animationType は実装（ステージの中身）から導けるので、手書きの宣言と突き合わせる。
     ステージがまだ無い反応だけは導きようがないので、そこだけ宣言を信じる。 */
  await t("アニメ種別は実装から導ける（手で付け違えたら落ちる）", () => {
    let checked = 0;
    for (const rx of data.reactions) {
      const derived = animationTypeOf(rx, STAGES, REDOX_STAGES);
      if (!derived) continue;
      checked++;
      assert(rx.animationType === derived,
        rx.id + ": animationType が実装と食い違う（宣言 " + rx.animationType + " / 実装 " + derived + "）");
    }
    assert(checked >= 40, "導出できた反応が少なすぎる（検査が空回りしている）: " + checked);
  });

  await t("レジストリの「未実装」宣言が実態と食い違わない（動いているのに未実装と言わない）", () => {
    const idx = stageIndex(STAGES, REDOX_STAGES);
    const used = {};
    for (const rx of data.reactions) {
      const t2 = rx.animationType;
      used[t2] = used[t2] || { total: 0, playable: 0 };
      used[t2].total++;
      if (resolvePlayback(rx, idx).playable) used[t2].playable++;
    }
    for (const [type, a] of Object.entries(ANIMATIONS)) {
      const u = used[type] || { total: 0, playable: 0 };
      if (!a.screen) {
        // 未実装と宣言した型で遊べてしまうなら、宣言か付け方のどちらかが嘘
        assert(u.playable === 0,
          type + ": 「未実装」と宣言しているのに " + u.playable + " 件が実際に遊べる（宣言か animationType の付け方が誤り）");
      }
      // 誰も使っていない型は、レジストリに残しても宣言が腐るだけ
      assert(u.total > 0, type + ": この型を使っている反応が1件も無い（消すか、使う反応を足す）");
    }
  });

  await t("「▶遊ぶ」の行き先が実在する（消えたステージ・id の打ち間違いを捕まえる）", () => {
    const idx = stageIndex(STAGES, REDOX_STAGES);
    for (const rx of data.reactions) {
      const p = resolvePlayback(rx, idx);
      if (!p.playable) continue;
      const [file, qs] = p.href.split("?");
      const id = decodeURIComponent(new URLSearchParams(qs).get("rxn"));
      if (file === "index.html") assert(STAGES.some((s) => s.id === id), rx.id + ": 行き先 " + p.href + " のステージが無い");
      else if (file === "redox.html") assert(REDOX_STAGES.some((s) => s.id === id), rx.id + ": 行き先 " + p.href + " のステージが無い");
      else assert(false, rx.id + ": 未知の行き先 " + file);
    }
    // 逆向き。実装があるのに索引から遊べない＝ステージを足して索引を直し忘れた事故
    for (const st of STAGES) {
      const rx = data.reactions.find((r) => r.id === st.id);
      assert(rx && resolvePlayback(rx, idx).playable, st.id + ": ステージがあるのに索引から遊べない");
    }
    for (const st of REDOX_STAGES) {
      const rx = data.reactions.find((r) => r.redoxStage === st.id);
      assert(rx && resolvePlayback(rx, idx).playable, st.id + ": 酸化還元ステージがあるのに索引から遊べない");
    }
  });

  /* 手書きの対応表を作らない、の見張り（このリポジトリが繰り返し避けてきた事故）。
     playable を書き戻すと、ステージの増減と索引の表示が再び黙って食い違えるようになる。 */
  await t("遊べるかどうかを reactions.json に手書きしていない（playable を持たない）", () => {
    for (const rx of data.reactions) {
      assert(!("playable" in rx),
        rx.id + ": playable は導出値なので JSON に持たない（resolvePlayback が唯一の根拠）");
    }
  });

  await t("animationType と実装の対応が食い違わない（redox 系だけが redoxStage を持つ）", () => {
    for (const rx of data.reactions) {
      const a = ANIMATIONS[rx.animationType];
      const isRedox = !!(a && a.stageSet === "redox");
      assert(!rx.redoxStage || isRedox, rx.id + ": redoxStage を持つのに animationType が redox 系でない");
      // 水溶液側は反応 id がそのままステージ id。redox 系が同じ id を持つと行き先が二重になる
      if (isRedox) assert(!STAGES.some((s) => s.id === rx.id), rx.id + ": redox 系なのに水溶液ステージにも同じ id がある");
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
    // 期待値を並べ書きせず data から作る（塩を1本足すたびにここを直す作業をなくす）
    const acid = data.reactions.filter((r) => r.classes.saltType === "酸性塩").map((r) => r.id).sort();
    assert(acid.length >= 4, "酸性塩の反応が少なすぎる（検査が空回りしている）: " + acid.length);
    assert(JSON.stringify((lib.bySalt["酸性塩"] || []).sort()) === JSON.stringify(acid), "bySalt 酸性塩 が不一致");
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

/* ---- 電池モードの UI テスト（battery.html を iframe で駆動） ---- */

async function runBatteryUITests(iframe) {
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, err: String(e) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const state = () => win.BatteryEq.state();
  const adv = (ms) => win.BatteryEq.advance(ms);
  /* 板は SVG の <g>。SVGElement には click() が無いので、実際に貼ってある
     リスナーを叩くために MouseEvent を投げる（＝画面をタップしたのと同じ道を通る） */
  const plate = (metal) => doc.querySelector('.plateGroup[data-metal="' + metal + '"]');
  const tap = (metal) => {
    const g = plate(metal);
    if (!g) throw new Error(metal + " の板が無い");
    g.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  };
  const reset = () => doc.querySelector("#toolbar .reset").click();
  const rowText = (id) => doc.getElementById(id).textContent.replace(/\s+/g, " ").trim();
  /* L（v186）: 倍率は「？」から始まるようになった。1:1 で走らせたいテストは、
     画面の生徒と同じように**自分で 1・1 を置いてから**再生する。
     （置かないと再生できないこと自体は、下の L のテストが見張る） */
  const put11 = () => win.BatteryEq.setMult(1, 1);

  await t("BATTERY: 予想する前は、答えになるものを何ひとつ出さない", async () => {
    reset();
    const s = state();
    assert(s.guess === null, "はじめから予想が入っている");
    // 半反応式は答えそのもの（負極 Zn → Zn²⁺ ＋ 2e⁻）なので、宣言するまで出さない
    assert(!s.halvesShown, "予想する前に半反応式の段が出ている");
    assert(!s.roleLabels.length, "予想する前に負極・正極の札が出ている: " + s.roleLabels.join("/"));
    // 宣言するまで再生できない（DESIGN §2-2）
    assert(s.playDisabled, "予想する前に「つないでみる」が押せる");
    // 板は2枚ともタップできる状態で出ている
    assert(plate("Zn") && plate("Cu"), "板が2枚とも出ていない");
  });

  /* I（2026-08-19 実機指摘）: 「つないでみる」は電極を選んでから。
     v181 の実測では disabled は付いていたが、#toolbar のボタンは背景色を自分で塗るので
     **見た目が押せる釦のまま**（background rgb(224,138,60)・opacity 1・cursor pointer）で、
     押せない理由も title 属性にしか無かった＝タッチ端末では読めない。
     ここで見るのは「押せないと分かる見た目」と「次に何をすればよいかが画面に出ていること」。 */
  await t("BATTERY I: 押せないときは、見た目でも押せないと分かり、次の一手が画面に出る", async () => {
    reset();
    const btn = doc.getElementById("playBtn");
    let s = state();
    assert(s.playDisabled, "予想する前に「つないでみる」が押せる");
    const cs = win.getComputedStyle(btn);
    assert(cs.cursor === "not-allowed", "押せない釦のカーソルが変わらない: " + cs.cursor);
    // 押せる釦の橙（#e08a3c = rgb(224,138,60)）のままなら、見た目が押せる釦のまま
    assert(cs.backgroundColor !== "rgb(224, 138, 60)",
      "押せないのに押せる釦と同じ色: " + cs.backgroundColor);
    // 次の一手が **画面に** 出ていること（title だけでは足りない）
    assert(s.playHint.includes("予想"), "次の一手が画面に出ていない: " + JSON.stringify(s.playHint));
    assert(btn.title === s.playHint, "title と画面の文が食い違う: " + btn.title + " / " + s.playHint);
    /* 予想すると次の一手が「倍率を決める」に進む（L で倍率が「？」から始まるため）。
       ⚠ ここが「順に1つずつ案内する」の要。詰まっている理由が入れ替わっていく */
    tap("Zn");
    s = state();
    assert(s.playDisabled && s.playHint.includes("倍率"),
      "予想したのに次の一手が倍率にならない: " + s.playHint);
    assert(!s.playHint.includes("予想"), "済んだ予想をまだ求めている: " + s.playHint);
    // 倍率を置けば押せるようになり、文は消える
    put11();
    s = state();
    assert(!s.playDisabled && s.playHint === "", "倍率を置いても押せるようにならない: " + s.playHint);
    assert(win.getComputedStyle(btn).backgroundColor === "rgb(224, 138, 60)",
      "押せる釦の色に戻らない: " + win.getComputedStyle(btn).backgroundColor);
  });

  await t("BATTERY: 板をタップして予想が当たると、負極(−)・正極(+) の札が出る", async () => {
    reset();
    tap("Zn");
    const s = state();
    assert(s.guess === "Zn" && s.guessOk, "Zn が当たりにならない: " + JSON.stringify(s.guess));
    assert(s.neg === "Zn" && s.pos === "Cu", "負極・正極の割り当てが違う");
    assert(s.roleLabels.includes("(−) 負極") && s.roleLabels.includes("(+) 正極"),
      "役の札が教科書表記で出ていない: " + s.roleLabels.join("/"));
    assert(s.halvesShown, "予想したのに半反応式の段が出ない");
    // 次は倍率（L）。予想が済んだこと自体は、案内の文が先へ進んだことで見る
    assert(s.playHint.includes("倍率"), "予想のあとに倍率を求めていない: " + s.playHint);
    put11();
    assert(!state().playDisabled, "予想して倍率も置いたのに「つないでみる」が押せない");
    assert(s.predictMsg.includes("当たり"), "当たりと言っていない: " + s.predictMsg);
    // **順位の数値は画面に出さない**（DESIGN §6・M6 と同じ原則）
    assert(!/\d+\s*V|電位|起電力/.test(s.predictMsg), "電位・起電力を口にしている: " + s.predictMsg);
  });

  await t("BATTERY: 予想が外れても行き止まりにせず、どちらが溶けるかを言う", async () => {
    reset();
    tap("Cu");
    const s = state();
    assert(s.guess === "Cu" && !s.guessOk, "Cu が外れにならない");
    assert(s.predictMsg.includes("溶けるのは Zn"), "溶けるほうを言っていない: " + s.predictMsg);
    assert(s.predictMsg.includes("イオン化傾向"), "理由（イオン化傾向）を言っていない: " + s.predictMsg);
    // 外れても先へ進める（宣言はした）。役の札も正しいほうが出る
    put11();
    assert(s.halvesShown && !state().playDisabled, "外れると先へ進めない");
    assert(s.roleLabels.includes("(−) 負極"), "外れたときに役の札が出ない");
    // 言い直せる
    tap("Zn");
    assert(state().guessOk && state().guessTries === 2, "予想し直せない");
  });

  await t("BATTERY: 両極の半反応式が、負極＝酸化・正極＝還元で出る", async () => {
    reset();
    tap("Zn");
    const neg = rowText("halfNeg"), pos = rowText("halfPos");
    assert(neg.includes("Zn") && neg.includes("Zn²⁺") && neg.includes("2e⁻"), "負極の式が違う: " + neg);
    assert(pos.includes("Cu²⁺") && pos.includes("2e⁻") && pos.includes("Cu"), "正極の式が違う: " + pos);
    // 役の札は行の右端ではなく、行の上の見出しに置く（J・v186）
    assert(rowText("halfNegCap").includes("負極(−)・酸化"),
      "負極の札が教科書表記でない: " + rowText("halfNegCap"));
    assert(rowText("halfPosCap").includes("正極(+)・還元"),
      "正極の札が教科書表記でない: " + rowText("halfPosCap"));
    const s = state();
    assert(s.halves.join() === "Zn_ox,Cu_red", "引かれた式が違う: " + s.halves.join());
    assert(s.cell === "(−) Zn | ZnSO₄ aq | CuSO₄ aq | Cu (+)", "電池式が違う: " + s.cell);
  });

  /* J（2026-08-18 実機指摘）「正極・負極を表示」。
     ⚠ **予想する前に伏せる設計は変えていない**（すぐ上のテストが見張っている）。
     ここで見るのは「予想したあと、はっきり大きく出ているか」の2か所:
       ① 図の役の札 … v181 は素の 16px（375px 幅で実効 9.9px）だった → 帯つき 20px
       ② 段2 の札  … v181 は筆算の右端で、375px では枠から 112px はみ出していた
                      → 行の上の見出し（.cSpan）へ移し、横に送らずに読める */
  await t("BATTERY J: 予想したあとの負極・正極が、帯つきで大きく出る", async () => {
    reset();
    assert(!state().roleLabels.length, "予想前に役の札が出ている（J で伏せ字を壊していないか）");
    tap("Zn");
    const svg = doc.getElementById("cell");
    const badges = [...svg.querySelectorAll(".roleBadge")];
    assert(badges.length === 2, "役の帯が2つ出ない: " + badges.length);
    for (const b of badges) {
      const label = b.querySelector("text");
      assert(Number(label.getAttribute("font-size")) >= 20,
        "役の札が小さいまま: " + label.getAttribute("font-size"));
      const bg = b.querySelector(".roleBadgeBg");
      assert(bg, "役の札に帯（下地）が無い: " + label.textContent);
      // 帯は字より広いこと（字が帯からはみ出していない）
      assert(Number(bg.getAttribute("width")) > label.getComputedTextLength(),
        "帯より字のほうが広い: " + label.textContent);
      // 帯は字の**下**（DOM の前）にあること。あとに置くと字を塗りつぶす
      assert([...b.childNodes].indexOf(bg) < [...b.childNodes].indexOf(label),
        "帯が字より前面にあって字が読めない: " + label.textContent);
    }
    // 「何が起きる極か」も添える（負極＝酸化・正極＝還元）
    const s = state();
    assert(/酸化（e⁻ を出す）/.test(s.svgText) && /還元（e⁻ を受け取る）/.test(s.svgText),
      "極に酸化・還元を添えていない: " + s.svgText);
    assert(s.roleLabels.includes("(−) 負極") && s.roleLabels.includes("(+) 正極"),
      "教科書表記が消えた: " + s.roleLabels.join("/"));
    // 図が切れていないこと（帯と添え書きが viewBox の下端に収まっている）
    const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const bottom = vb[1] + vb[3];
    for (const tx of [...svg.querySelectorAll(".roleBadge text")]) {
      assert(Number(tx.getAttribute("y")) <= bottom - 2,
        "役の札が図の下端からはみ出している: " + tx.textContent + " y=" + tx.getAttribute("y"));
    }
  });

  await t("BATTERY J: 375px でも、どちらの式が負極かが横に送らず読める", async () => {
    const { f, win: w } = await openProbeFrame("battery.html",
      (x) => x.BatteryEq, "position:fixed;left:-9999px;top:0;border:0;width:375px;height:900px");
    assert(w, "battery.html が 375px で起動しない");
    try {
      // 実際にその幅になった環境でだけ測る（実機・モバイルエミュレーションでは見送る）
      if (w.innerWidth !== 375) return;
      const d = f.contentDocument;
      d.querySelector('.plateGroup[data-metal="Zn"]')
        .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      const box = d.querySelector("#stepHalves .sheetScroll");
      for (const id of ["halfNegCap", "halfPosCap"]) {
        const tag = d.querySelector("#" + id + " .kindTag");
        assert(tag, id + " の役の札が無い");
        const tr = tag.getBoundingClientRect(), br = box.getBoundingClientRect();
        assert(tr.right <= br.right + 0.5,
          id + " の札が筆算の枠から " + Math.round(tr.right - br.right) +
          "px はみ出している（横に送らないと読めない）");
        assert(tr.left >= br.left - 0.5, id + " の札が左にはみ出している");
      }
      // 筆算そのものは横に伸びてよい（式の → をそろえるため）。伸びていても札は読める、が要点
      assert(box.scrollWidth > box.clientWidth,
        "筆算が横に伸びていない ＝ このテストが守るべき状況になっていない");
    } finally { f.remove(); }
  });

  await t("BATTERY: 倍率のステッパーが e⁻ の数を数え直す", async () => {
    reset();
    tap("Zn");
    const tally = () => doc.getElementById("eTally").textContent.replace(/\s+/g, " ");
    const plus = (id) => $$("#" + id + " .stepper button").find((b) => b.textContent === "＋").click();
    // 「？」から始まる（L）。＋ を1回押すと 1 が入る
    assert(state().mult.join() === ",", "はじめの倍率が「？」でない: " + state().mult.join());
    plus("halfNeg");
    assert(state().mult.join() === "1,", "＋ で 1 が入らない: " + state().mult.join());
    plus("halfPos");
    assert(state().mult.join() === "1,1", "両方置けない: " + state().mult.join());
    assert(tally().includes("そろった"), "1:1 でそろわない: " + tally());
    // 負極だけ ×2 にすると e⁻ が 4 対 2 でそろわなくなる
    plus("halfNeg");
    assert(state().mult.join() === "2,1", "ステッパーが効かない: " + state().mult.join());
    assert(tally().includes("そろっていない"), "2:1 でそろってしまう: " + tally());
    assert(tally().includes("4個") && tally().includes("2個"), "e⁻ の数を出していない: " + tally());
    reset();
    assert(state().mult.join() === ",", "やり直しても倍率が「？」に戻らない: " + state().mult.join());
  });

  /* L（2026-08-18 実機指摘）「最初から係数が合ってしまう場合はどうする？」。
     ダニエル電池は 1:1 なので、倍率を 1 から始めると**何もしていないのに正解の状態**で
     始まってしまう。倍率を「？」から置かせ、そのうえで
     「そろえる必要がない」ことを言葉にする、という形を採った。 */
  await t("BATTERY L: 倍率は「？」から始まり、置くまで再生できない", async () => {
    reset();
    tap("Zn");
    let s = state();
    assert(s.mult.join() === ",", "倍率が最初から入っている: " + s.mult.join());
    // 画面にも「？」が出ていて、数字を先に見せていない
    const coeffs = $$("#halfSheet .coeff").map((c) => c.textContent);
    assert(coeffs.join() === "？,？", "画面の倍率が「？」でない: " + coeffs.join());
    // e⁻ の数え上げも、置いていない倍率をかけた数は出さない
    assert(s.eTally.includes("まだ「？」"), "倍率が未定だと言っていない: " + s.eTally);
    assert(!/＝ *\d+個/.test(s.eTally), "置いていない倍率で計算してしまっている: " + s.eTally);
    // 置くまでは再生できない（理由も画面に出る＝ I と同じ約束）
    assert(s.playDisabled, "倍率が「？」でも「つないでみる」が押せる");
    assert(s.playHint.includes("倍率"), "倍率を決めよ、と画面に出ていない: " + s.playHint);
    assert(s.sumBtn.disabled && s.sumBtn.why.includes("倍率"),
      "倍率が未定なのに足し合わせの理由が出ていない: " + JSON.stringify(s.sumBtn));
    // 盤面にも粒を置かない（何単位ならべるか決まらないので）
    assert(!Object.keys(s.counts).length, "倍率が未定なのに粒が置いてある: " + JSON.stringify(s.counts));
    // 片方だけではまだ駄目
    win.BatteryEq.setMult(1, null);
    assert(state().playDisabled, "片方だけ置いて再生できてしまう");
    put11();
    s = state();
    assert(!s.playDisabled && s.playHint === "", "1・1 を置いても再生できない: " + s.playHint);
    assert(s.counts.atom === 1 && s.counts.wait === 1, "置いても盤面が並ばない: " + JSON.stringify(s.counts));
  });

  await t("BATTERY L: そろえる必要がない回は「そろっている」と言う（ダニエル電池）", async () => {
    reset();
    tap("Zn");
    put11();
    let s = state();
    assert(s.answer.join(":") === "1:1", "ダニエル電池が 1:1 でない: " + s.answer.join(":"));
    // 「合わせる必要がない」も1つの答え。黙って正解にせず言葉にする
    const note = doc.getElementById("tallyNote");
    assert(note, "そろっている回の説明が出ていない");
    assert(/そろっている/.test(note.textContent) && /必要がない/.test(note.textContent),
      "そろえる必要がないと言っていない: " + note.textContent);
    assert(note.textContent.includes("2個ずつ"), "1単位あたりの e⁻ の数を言っていない: " + note.textContent);
    // 倍率が要る回では出さない（水の電気分解は 1:2）
    const go = (label) => {
      const b = [...doc.querySelectorAll("#stageNav button")].find((x) => x.dataset.label === label);
      if (!b) throw new Error(label + " のステージ釦が無い");
      b.click();
    };
    go("水の電気分解（希硫酸）");
    win.BatteryEq.setMult(1, 2);
    assert(state().answer.join(":") === "1:2", "水の電気分解が 1:2 でない");
    assert(!doc.getElementById("tallyNote"),
      "倍率が要る回で「そろえる必要がない」と言っている: " +
      (doc.getElementById("tallyNote") || {}).textContent);
    // 2:2 のように「そろってはいるが最簡でない」ときも、そろっている回の文句は出さない
    go("ダニエル電池");
    tap("Zn");
    win.BatteryEq.setMult(2, 2);
    assert(!doc.getElementById("tallyNote"), "2:2 で「×1・×1 が答え」と言ってしまっている");
    doc.getElementById("playBtn").click();
    adv(20000);
    assert(!state().cleared, "2:2（最簡でない）でクリアになってしまう: " + state().msg);
  });

  /* K（2026-08-18 実機指摘）「両極の反応式を足し合わせて全体のイオン反応式をつくる」。
     v181 まで足し合わせは**アニメを走らせてクリアしたときだけ**ひとりでに出た
     ＝ 生徒の操作ではなかった。釦にして自分で足せるようにする。
     ⚠ 化学は増やさない: 足し合わせは model.js の combineHalves、数合わせは electronsOf。
     ⚠ 押しても何も起きない釦にしない: e⁻ がそろうまでは押せない見た目＋理由を出す。 */
  await t("BATTERY K: 自分で「足し合わせる」を押して全体のイオン反応式をつくれる", async () => {
    reset();
    // 段2 が出る前は釦も無い（予想してから）
    assert(!state().sumBtn.there, "予想する前から足し合わせの釦がある");
    tap("Zn");
    put11();
    let s = state();
    assert(s.sumBtn.there, "段2に足し合わせの釦が無い");
    assert(!s.sumShown, "押していないのに足し合わせの段が出ている");
    assert(!s.sumBtn.disabled, "1:1 で e⁻ がそろっているのに押せない: " + s.sumBtn.why);
    doc.getElementById("sumBtn").click();
    s = state();
    assert(s.sumShown, "押しても足し合わせの段が出ない");
    // 中身は model.js の combineHalves そのまま（Zn ＋ Cu²⁺ → Zn²⁺ ＋ Cu、e⁻ は消える）
    assert(s.ionic.includes("Zn＋Cu²⁺") && s.ionic.includes("Zn²⁺＋Cu"), "全体の反応が違う: " + s.ionic);
    assert(!s.ionic.includes("e⁻"), "足し合わせに e⁻ が残っている: " + s.ionic);
    // 打ち消した e⁻ には取り消し線（.cancel）が付いて、消えたことが見える
    assert($$("#sumNeg .cancel").length && $$("#sumPos .cancel").length,
      "両極の e⁻ に消した印が付いていない");
    // ⚠ アニメを走らせていないのに出せる、が要点（クリアのごほうびではない）
    assert(!s.cleared, "足し合わせただけでクリアになってしまう");
  });

  await t("BATTERY K: e⁻ がそろっていないと足せない（理由も画面に出る）", async () => {
    reset();
    tap("Zn");
    win.BatteryEq.setMult(2, 1);
    let s = state();
    assert(s.sumBtn.disabled, "e⁻ が 4 対 2 なのに足せてしまう");
    assert(s.sumBtn.why.includes("4個") && s.sumBtn.why.includes("2個"),
      "そろっていない数を言っていない: " + s.sumBtn.why);
    const btn = doc.getElementById("sumBtn");
    assert(win.getComputedStyle(btn).cursor === "not-allowed",
      "押せない釦なのにカーソルが変わらない: " + win.getComputedStyle(btn).cursor);
    // 押しても何も起きない（＝押せない釦をわざと残していない、の裏取り）
    btn.click();
    assert(!state().sumShown, "そろっていないのに足し合わせが出た");
    // そろえれば押せるようになる
    win.BatteryEq.setMult(1, 1);
    s = state();
    assert(!s.sumBtn.disabled, "そろえても押せない: " + s.sumBtn.why);
    assert(s.sumBtn.why.includes("そろった"), "そろったと言っていない: " + s.sumBtn.why);
    // 倍率を触ると、作った式は白紙に戻る（古い式が残ると嘘になる）
    doc.getElementById("sumBtn").click();
    assert(state().sumShown, "足し合わせが出ない");
    win.BatteryEq.setMult(1, 2);
    assert(!state().sumShown, "倍率を変えても前の足し合わせが残っている");
  });

  await t("BATTERY K: 電気分解でも同じ釦で足し合わせられる（1:2 の水の電気分解）", async () => {
    /* ステージの切り替えは下の goStage と同じことをするが、あちらは
       このテストより後で宣言されるので（const の巻き上げなし）ここでは自前で押す */
    const go = (label) => {
      const b = [...doc.querySelectorAll("#stageNav button")].find((x) => x.dataset.label === label);
      if (!b) throw new Error(label + " のステージ釦が無い");
      b.click();
    };
    go("水の電気分解（希硫酸）");
    put11();
    let s = state();
    assert(s.sumBtn.there && s.sumBtn.disabled, "1:1 では足せないはず: " + s.sumBtn.why);
    win.BatteryEq.setMult(1, 2);
    s = state();
    assert(!s.sumBtn.disabled, "1:2 にしても足せない: " + s.sumBtn.why);
    doc.getElementById("sumBtn").click();
    s = state();
    assert(s.sumShown, "電気分解で足し合わせの段が出ない");
    assert(s.ionic.includes("2H₂O") && s.ionic.includes("O₂") && s.ionic.includes("2H₂"),
      "全体の反応が 2H₂O → O₂ ＋ 2H₂ でない: " + s.ionic);
    assert(!s.ionic.includes("H⁺"), "打ち消えるはずの H⁺ が残っている: " + s.ionic);
    // 電池式は電池だけのもの（用語が混ざらないことの確認は既存テストと同じ約束）
    assert(!s.cellShown, "電気分解で電池式を出している: " + s.cellShown);
    go("ダニエル電池");
  });

  await t("BATTERY: 予想する前は盤面に粒を1つも置かない（並べた時点で答えになる）", async () => {
    reset();
    const s = state();
    assert(!Object.keys(s.counts).length, "予想する前から粒が置いてある: " + JSON.stringify(s.counts));
    tap("Zn");
    put11();
    // 宣言して倍率を置いてはじめて、負極の板に溶ける原子・正極側に待ちイオンが並ぶ
    const s2 = state();
    assert(s2.counts.atom === 1 && s2.counts.wait === 1,
      "宣言しても盤面が並ばない: " + JSON.stringify(s2.counts));
  });

  await t("BATTERY: ダニエル電池が最後まで動いてクリアになる（予想 → 再生 → 足し合わせ）", async () => {
    reset();
    tap("Zn");
    put11();
    doc.getElementById("playBtn").click();
    adv(20000);
    const s = state();
    assert(s.phase === "done", "アニメが終わらない: " + s.phase);
    assert(s.cleared, "クリアにならない: " + s.msg);
    assert(s.deposited === 1, "正極に析出した Cu が1個でない: " + s.deposited);
    assert(s.poolE === 0 && s.waiting === 0, "e⁻ の余りか待ちイオンが残っている: " + JSON.stringify(s));
    assert(s.sumShown && s.clearShown, "足し合わせの段かクリアの帯が出ない");
    // 足し合わせ Zn ＋ Cu²⁺ → Zn²⁺ ＋ Cu（e⁻ は打ち消えて残らない）
    assert(s.ionic.includes("Zn＋Cu²⁺") && s.ionic.includes("Zn²⁺＋Cu"), "全体の反応が違う: " + s.ionic);
    assert(!s.ionic.includes("e⁻"), "足し合わせに e⁻ が残っている: " + s.ionic);
    assert(s.cellShown.includes("(−) Zn | ZnSO₄ aq | CuSO₄ aq | Cu (+)"), "電池式が出ない: " + s.cellShown);
  });

  await t("BATTERY: e⁻ は導線の上を一定の速さで進む（ワープしない）", async () => {
    reset();
    tap("Zn");
    put11();
    doc.getElementById("playBtn").click();
    const seen = new Map();     // id → 直前の座標
    const touched = new Map();  // id → 通った y の並び（道すじの検査に使う）
    let moved = 0, maxJump = 0, travelled = 0;
    for (let i = 0; i < 30; i++) {
      adv(100);                 // 0.1 秒ずつ
      for (const p of state().epos) {
        const prev = seen.get(p.id);
        if (prev) {
          const d = Math.hypot(p.x - prev.x, p.y - prev.y);
          maxJump = Math.max(maxJump, d);
          travelled += d;
          if (d > 0.5) moved++;
        }
        seen.set(p.id, p);
        touched.set(p.id, (touched.get(p.id) || []).concat(p.y));
      }
    }
    assert(moved > 10, "e⁻ が動いた形跡が少なすぎる（" + moved + "回）");
    // 0.1 秒あたりの進みは速さ×時間＝23単位。折れ角ぶんの余裕をみても 30 は超えない
    assert(maxJump <= 30, "e⁻ が1コマで " + maxJump.toFixed(1) + " 単位も飛んだ（ワープしている）");
    assert(seen.size >= 2, "e⁻ が2個出ていない");
    /* 導線の高さ（y=46）まで上がっていること ＝ 液の中をショートカットしていない。
       ここは以前コメントで言うだけだったので、実際に座標で検査する。
       あわせて、フック（state().epos）が本当に座標を返していることの検査にもなる
       （x・y が数値でなければ最小値・最大値の比較がここで落ちる）。 */
    const ys = [...touched.values()].flat();
    assert(ys.length && ys.every((v) => typeof v === "number" && isFinite(v)),
      "epos が座標を返していない: " + JSON.stringify([...touched].slice(0, 2)));
    assert(Math.min(...ys) <= 48, "e⁻ が導線（y=46）まで上がっていない: 最小 y=" + Math.min(...ys));
    assert(Math.max(...ys) >= 120, "e⁻ が液の中まで下りていない: 最大 y=" + Math.max(...ys));
    // 板の頭（y=64）より上、つまり導線の上を左右に渡っている区間があること
    assert(travelled >= 100, "e⁻ が導線の上を横切っていない（総移動 " + travelled.toFixed(0) + "）");
  });

  /* M（2026-08-18 実機指摘）「電極の配置をランダムにしないと、常に左が解ける」。
     ⚠ **測定の問題。** 左が固定だと、生徒はイオン化傾向ではなく位置で当てられる。
     ⚠ 種（setSeed）を差せるので、ここは**決定的に**検査できる。
     見るのは3つ: ①同じ種で再現する ②左右の両方が出る
     ③どちらの並びでも、記録（予想・役・電池式）が位置ではなく板の中身で持たれている */
  await t("BATTERY M: b1 の板の左右がふり分けられ、種を差せば決定的に再現できる", async () => {
    assert(typeof win.BatteryEq.setSeed === "function",
      "setSeed が無い ＝ 乱数に種を差せない（決定的に検査できない実装）");
    const rollN = (seed, n) => {
      win.BatteryEq.setSeed(seed);
      const out = [];
      for (let i = 0; i < n; i++) { out.push(state().metals.join()); reset(); }
      return out;
    };
    const a = rollN(20260818, 16), b = rollN(20260818, 16);
    assert(a.join("|") === b.join("|"), "同じ種で並びが再現しない");
    assert(new Set(a).size === 2, "16回ふっても左右が入れ替わらない: " + [...new Set(a)].join(" / "));
    assert(a.every((x) => x === "Zn,Cu" || x === "Cu,Zn"), "知らない並びが出た: " + [...new Set(a)].join(" / "));
    // 種を変えれば別の出方になる（種が本当に効いている）
    assert(rollN(4242, 16).join("|") !== a.join("|"), "種を変えても同じ出方");
  });

  await t("BATTERY M: どちらの並びでも、役も予想も電池式も板の中身で決まる", async () => {
    const seen = {};
    win.BatteryEq.setSeed(20260818);
    for (let i = 0; i < 16 && Object.keys(seen).length < 2; i++) {
      const order = state().metals.join();
      if (!seen[order]) {
        tap("Zn");                 // **位置ではなく板をタップ**して予想する
        put11();
        doc.getElementById("playBtn").click();
        adv(20000);
        const s = state();
        // 図の中で、Zn の板の真下に「負極」の帯が来ていること（役が位置に張りついていない）
        const znX = s.plateSides.find((p) => p.metal === "Zn").x;
        const cuX = s.plateSides.find((p) => p.metal === "Cu").x;
        const near = (x) => s.roleSides.slice()
          .sort((p, q) => Math.abs(p.x - x) - Math.abs(q.x - x))[0].label;
        seen[order] = {
          cleared: s.cleared, neg: s.neg, cell: s.cell, flipped: s.flipped,
          underZn: near(znX + 13), underCu: near(cuX + 13),
        };
      }
      reset();
    }
    assert(Object.keys(seen).length === 2,
      "16回ふっても片方の並びしか出ない: " + Object.keys(seen).join(" / "));
    for (const order of Object.keys(seen)) {
      const r = seen[order];
      assert(r.cleared, order + " の並びでクリアできない");
      assert(r.neg === "Zn", order + " で負極が Zn でない: " + r.neg);
      // 電池式は (−) を左に書く教科書表記。**板の位置では変わらない**
      assert(r.cell === "(−) Zn | ZnSO₄ aq | CuSO₄ aq | Cu (+)",
        order + " の電池式が板の位置で変わった: " + r.cell);
      assert(r.underZn.includes("負極"), order + " で Zn の下が負極でない: " + r.underZn);
      assert(r.underCu.includes("正極"), order + " で Cu の下が正極でない: " + r.underCu);
    }
    assert(seen["Zn,Cu"].flipped !== seen["Cu,Zn"].flipped, "flipped が並びと対応していない");
    win.BatteryEq.setSeed(null);   // 本番と同じ「毎回ちがう」に戻す
    reset();
  });

  /* ---- b2「電極を選ぶ」（実装の刻み4）---- */

  const palBtn  = (m) => doc.querySelector('.palMetal[data-metal="' + m + '"]');
  const slotBtn = (i) => doc.querySelector('.palSlot[data-slot="' + i + '"]');
  const goB2 = () => {
    const b = [...doc.querySelectorAll("#stageNav button")].find((x) => x.dataset.label === "電極を選ぶ");
    if (!b) throw new Error("b2 のステージ釦が無い");
    b.click();
  };
  const goB1 = () => {
    const b = [...doc.querySelectorAll("#stageNav button")].find((x) => x.dataset.label === "ダニエル電池");
    b.click();
  };

  await t("BATTERY b2: 板がそろうまで、予想も再生もできない（答えになるものを出さない）", async () => {
    goB2();
    let s = state();
    assert(s.stageId === "b2" && s.choose, "b2 に来ていない: " + s.stageId);
    assert(s.picked.join() === ",", "はじめから板が入っている: " + s.picked.join());
    assert(s.palette.length === 5, "パレットの金属が5枚でない: " + s.palette.length);
    assert(s.playDisabled, "板を選ぶ前に「つないでみる」が押せる");
    // I: 押せない理由（＝次の一手）が画面に出ている。b2 は「板を選ぶ」が先
    assert(s.playHint.includes("板を2枚"), "板を選べ、と画面に出ていない: " + s.playHint);
    assert(!s.halvesShown, "板を選ぶ前に半反応式が出ている");
    assert(!s.roleLabels.length, "板を選ぶ前に役の札が出ている: " + s.roleLabels.join("/"));
    assert(!doc.querySelector(".plateGroup"), "板を選ぶ前からタップできる板がある");
    assert(s.cell === null, "板を選ぶ前から電池式が出ている: " + s.cell);
    // 1枚だけでもまだ駄目
    palBtn("Zn").click();
    s = state();
    assert(s.picked.join() === "Zn,", "1枚目が入らない: " + s.picked.join());
    assert(s.playDisabled, "板1枚で「つないでみる」が押せる");
    assert(s.playHint.includes("あと1枚") && s.playHint.includes("Zn"),
      "残り1枚だと分かる文になっていない: " + s.playHint);
  });

  await t("BATTERY b2: 扱えない組み合わせは、1枚目を選んだ時点で候補から消える", async () => {
    goB2();
    // 何も選んでいないうちは全部押せる
    assert(state().palette.every((p) => !p.disabled), "はじめから押せない金属がある");
    palBtn("Mg").click();
    const dis = state().palette.filter((p) => p.disabled).map((p) => p.metal);
    // Mg×Zn・Mg×Fe は正極側の還元の式を収録していないので候補に出さない（設計 §0）
    assert(dis.join() === "Zn,Fe", "Mg と組めない相手が候補から消えていない: " + dis.join());
    assert(palBtn("Mg").disabled === false, "同じ金属2枚が選べない（流れないことも発見のうち）");
    assert(palBtn("Cu").disabled === false && palBtn("Ag").disabled === false,
      "組める相手まで消している");
    // 左を外すと候補も戻る
    slotBtn(0).click();
    assert(state().picked.join() === "," && state().palette.every((p) => !p.disabled),
      "左の板を外しても候補が戻らない");
    // Cu と Ag はどちらとも組めるので、誰も消えない
    palBtn("Cu").click();
    assert(state().palette.every((p) => !p.disabled), "Cu を選ぶと消える相手がいる");
  });

  await t("BATTERY b2: Cu は Zn と組むと正極、Ag と組むと負極（役は相手で決まる）", async () => {
    goB2();
    palBtn("Cu").click();
    palBtn("Zn").click();
    assert(state().metals.join() === "Cu,Zn", "選んだ2枚が入らない: " + state().metals.join());
    tap("Zn");
    let s = state();
    assert(s.neg === "Zn" && s.pos === "Cu", "Cu×Zn で Cu が正極にならない: " + s.neg + "/" + s.pos);
    assert(s.halves.join() === "Zn_ox,Cu_red", "式が違う: " + s.halves.join());
    assert(s.cell === "(−) Zn | ZnSO₄ aq | CuSO₄ aq | Cu (+)", "電池式が違う: " + s.cell);
    // 右の板だけ Ag に差し替える（左の Cu は残る）
    palBtn("Ag").click();
    s = state();
    assert(s.metals.join() === "Cu,Ag", "右の板だけ差し替わらない: " + s.metals.join());
    assert(s.guess === null && !s.halvesShown, "差し替えたのに前の予想と式が残っている");
    tap("Cu");
    s = state();
    assert(s.neg === "Cu" && s.pos === "Ag", "Cu×Ag で Cu が負極にならない: " + s.neg + "/" + s.pos);
    assert(s.halves.join() === "Cu_ox,Ag_red", "式が入れ替わらない: " + s.halves.join());
    assert(s.answer.join(":") === "1:2", "Ag は 1e⁻ なので 1:2 のはず: " + s.answer.join(":"));
    // 両方の役をこなしたので「発見」が出る（先に言わず、遊んだ結果として出す）
    assert(s.discovery.includes("Cu") && s.discovery.includes("負極") &&
      s.discovery.includes("正極") && s.discovery.includes("役は相手で決まる"),
      "相対性の発見が出ない: " + s.discovery);
    // 電位・起電力の数値は出さない（§6）
    assert(!/\d+\s*V|電位|起電力/.test(s.discovery + s.predictMsg), "電位を口にしている");
    // 最後まで動いてクリアになる（Ag は2個析出する）
    win.BatteryEq.setMult(1, 2);
    doc.getElementById("playBtn").click();
    adv(30000);
    s = state();
    assert(s.cleared, "Cu×Ag がクリアにならない: " + s.msg);
    assert(s.deposited === 2, "Ag が2個析出しない: " + s.deposited);
    assert(s.ionic.includes("Cu＋2Ag⁺") && s.ionic.includes("Cu²⁺＋2Ag"),
      "全体の反応が Cu ＋ 2Ag⁺ → Cu²⁺ ＋ 2Ag でない: " + s.ionic);
  });

  await t("BATTERY b2: 同じ金属2枚は「電池にならない」と正直に言う（豆電球も点かない）", async () => {
    goB2();
    palBtn("Zn").click();
    palBtn("Zn").click();
    let s = state();
    assert(s.metals.join() === "Zn,Zn", "同じ金属2枚が選べない: " + s.metals.join());
    assert(s.reason === "same-metal", "理由が same-metal でない: " + s.reason);
    assert(!s.halvesShown, "式が引けないのに半反応式の段が出ている");
    assert(!s.roleLabels.length, "負極・正極の札が出てしまっている: " + s.roleLabels.join("/"));
    tap("Zn");
    s = state();
    assert(s.predictMsg.includes("同じ金属"), "同じ金属だと言っていない: " + s.predictMsg);
    assert(!s.playDisabled, "宣言しても「つないでみる」が押せない");
    doc.getElementById("playBtn").click();
    adv(5000);
    s = state();
    assert(s.phase === "done", "再生が終わらない: " + s.phase);
    assert(!s.cleared, "電池にならないのにクリアになる");
    assert(!Object.keys(s.counts).length, "粒が動いている: " + JSON.stringify(s.counts));
    assert(s.epos.length === 0, "e⁻ が出てしまっている");
    assert(s.lampDead, "豆電球が点いたままになっている");
    assert(s.msg.includes("電流が流れない") && s.msg.includes("差"),
      "流れない理由を言っていない: " + s.msg);
    // 言い訳をせず、次の一手を示す
    assert(s.msg.includes("選び直") || s.msg.includes("試して"), "行き止まりで終わっている: " + s.msg);
  });

  /* ---- 電気分解 e1・e2（実装の刻み5）---- */

  const goStage = (label) => {
    const b = [...doc.querySelectorAll("#stageNav button")].find((x) => x.dataset.label === label);
    if (!b) throw new Error(label + " のステージ釦が無い");
    b.click();
  };

  await t("ELYZ: 電気分解では電源マークが出て、呼び名が陰極・陽極になる", async () => {
    goStage("塩化銅(Ⅱ)水溶液の電気分解");
    const s = state();
    assert(s.kind === "electrolysis", "電気分解モードになっていない: " + s.kind);
    assert(s.powerShown, "電源のマークが出ていない（e⁻ が動く理由が画にない）");
    // 用語の出し分け。**ここを混ぜると生徒がいちばん混乱する**ので DOM で固定する
    assert(s.terms.ox === "陽極" && s.terms.red === "陰極", "呼び名: " + s.terms.ox + "/" + s.terms.red);
    assert(s.halfTags.join() === "陽極・酸化,陰極・還元", "式の札: " + s.halfTags.join());
    assert(!/負極|正極/.test(s.svgText), "図に負極・正極が混ざっている: " + s.svgText);
    assert(!/負極|正極/.test(s.halfTags.join() + s.eTally), "式や数え上げに負極・正極が混ざっている");
    assert(/陽極/.test(s.svgText) && /陰極/.test(s.svgText), "図に陰極・陽極が出ていない: " + s.svgText);
    // 酸化・還元の向きは両モードで同じ、という手すりを画に添えている
    assert(s.svgText.includes("酸化") && s.svgText.includes("還元"), "極に酸化・還元を添えていない");
    /* 電気分解には予想の段が無い（電極を選ばせない・§3-3）ので、
       あとは倍率を置くだけで遊べる。倍率が「？」のうちは押せない（L） */
    assert(s.playDisabled && s.playHint.includes("倍率"),
      "倍率が未定なのに再生できる: " + s.playHint);
    win.BatteryEq.setMult(1, 1);
    assert(!state().playDisabled, "倍率を置いても再生できない");
    assert(s.halvesShown, "電気分解で半反応式が出ていない");
    assert(!doc.querySelector(".plateGroup"), "電気分解なのに電極がタップできる");
    assert(!doc.querySelector(".palMetal"), "電気分解でパレットが出ている");
    // 電位・起電力は出さない（§6）
    assert(!/\d+\s*V|電位|起電力/.test(s.svgText + s.predictMsg), "電位を口にしている");
  });

  await t("ELYZ e1: 塩化銅(Ⅱ)水溶液 — 陰極に Cu、陽極に Cl₂ が出てクリア", async () => {
    goStage("塩化銅(Ⅱ)水溶液の電気分解");
    let s = state();
    assert(s.halves.join() === "Cl_ox,Cu_red", "引かれた式が違う: " + s.halves.join());
    assert(s.answer.join(":") === "1:1", "倍率が 1:1 でない: " + s.answer.join(":"));
    put11();
    s = state();
    // 陽極には 2Cl⁻ が、陰極には Cu²⁺ が1個ならぶ（式の左辺そのまま）
    assert(s.counts.atom === 2 && s.counts.wait === 1, "盤面の並び: " + JSON.stringify(s.counts));
    doc.getElementById("playBtn").click();
    adv(40000);
    s = state();
    assert(s.phase === "done" && s.cleared, "クリアにならない: " + s.msg);
    assert(s.deposited === 1, "陰極に Cu が1個析出しない: " + s.deposited);
    assert(s.gas["Cl2"] === 1, "陽極から Cl₂ が1個出ない: " + JSON.stringify(s.gas));
    assert(s.poolE === 0 && s.waiting === 0, "e⁻ か待ちが残っている");
    assert(s.ionic.includes("2Cl⁻＋Cu²⁺") && s.ionic.includes("Cl₂＋Cu"),
      "全体の反応が違う: " + s.ionic);
    // 電池式は電池のもの。電気分解では出さない
    assert(!s.cellShown, "電気分解で電池式を出している: " + s.cellShown);
    assert(doc.getElementById("termNote"), "用語の読み物（負極と陽極のちがい）が無い");
    assert(!doc.getElementById("cellNotation"), "電気分解で電池式の枠が出ている");
  });

  await t("ELYZ e2: 水の電気分解 — 倍率 1:2 でないと合わず、2H₂O → O₂ ＋ 2H₂ になる", async () => {
    goStage("水の電気分解（希硫酸）");
    let s = state();
    assert(s.halves.join() === "H2O_ox,H_red", "引かれた式が違う: " + s.halves.join());
    assert(s.answer.join(":") === "1:2", "倍率が 1:2 でない: " + s.answer.join(":"));
    // 自分で置いた 1:1 では 4 対 2 でそろわない（ここが操作）
    put11();
    s = state();
    assert(s.mult.join() === "1,1" && s.eTally.includes("そろっていない"), "1:1 でそろってしまう: " + s.eTally);
    assert(s.eTally.includes("4個") && s.eTally.includes("2個"), "e⁻ の数を出していない: " + s.eTally);
    doc.getElementById("playBtn").click();
    adv(40000);
    s = state();
    assert(s.phase === "done" && !s.cleared, "1:1 でクリアになってしまう");
    win.BatteryEq.setMult(1, 2);
    assert(state().eTally.includes("そろった"), "1:2 でもそろわない: " + state().eTally);
    doc.getElementById("playBtn").click();
    adv(40000);
    s = state();
    assert(s.cleared, "1:2 でクリアにならない: " + s.msg);
    // 陰極から H₂ が2個、陽極から O₂ が1個。金属は析出しない
    assert(s.gas["H2"] === 2 && s.gas["O2"] === 1, "気体の数: " + JSON.stringify(s.gas));
    assert(s.deposited === 0, "気体を析出として数えている: " + s.deposited);
    // H⁺ は両辺で打ち消えて、水だけが分解した式になる
    assert(s.ionic.includes("2H₂O") && s.ionic.includes("O₂") && s.ionic.includes("2H₂"),
      "全体の反応が 2H₂O → O₂ ＋ 2H₂ でない: " + s.ionic);
    assert(!s.ionic.includes("H⁺"), "打ち消えるはずの H⁺ が残っている: " + s.ionic);
  });

  await t("ELYZ: 電池と電気分解を行き来しても、用語が混ざらない", async () => {
    goStage("ダニエル電池");
    tap("Zn");
    let s = state();
    assert(s.halfTags.join() === "負極(−)・酸化,正極(+)・還元", "電池の札: " + s.halfTags.join());
    assert(!/陰極|陽極/.test(s.svgText + s.eTally), "電池の画面に陰極・陽極が出ている");
    assert(!s.powerShown, "電池の画面に電源のマークが出ている");
    goStage("水の電気分解（希硫酸）");
    s = state();
    assert(s.halfTags.join() === "陽極・酸化,陰極・還元", "電気分解の札: " + s.halfTags.join());
    assert(!/負極|正極/.test(s.svgText + s.eTally), "電気分解の画面に負極・正極が出ている");
    goStage("ダニエル電池");
    s = state();
    assert(s.kind === "battery" && !s.powerShown && s.playDisabled,
      "電池に戻れていない: " + JSON.stringify([s.kind, s.powerShown, s.playDisabled]));
    assert(s.guess === null && !s.halvesShown, "電池が初期状態に戻っていない");
  });

  await t("BATTERY b2: b1（ダニエル電池）に戻っても壊れない", async () => {
    goB2();
    palBtn("Mg").click();
    palBtn("Ag").click();
    tap("Mg");
    assert(state().answer.join(":") === "1:2", "Mg×Ag の倍率: " + state().answer.join(":"));
    goB1();
    const s = state();
    assert(s.stageId === "b1" && !s.choose, "b1 に戻れない: " + s.stageId);
    // 板の2枚は Zn と Cu（左右はふり分けられるので、並びではなく中身で見る・M）
    assert([...s.metals].sort().join() === "Cu,Zn", "b1 の板が Zn と Cu でない: " + s.metals.join());
    assert(s.guess === null && !s.halvesShown && s.playDisabled, "b1 が初期状態に戻っていない");
    assert(!doc.querySelector(".palMetal"), "b1 でパレットが出ている");
    tap("Zn");
    put11();
    doc.getElementById("playBtn").click();
    adv(20000);
    assert(state().cleared, "b1 が壊れている: " + state().msg);
  });

  await t("BATTERY: 倍率がずれていると、余りか待ちが残ってクリアにならない", async () => {
    reset();
    tap("Zn");
    win.BatteryEq.setMult(2, 1);
    win.BatteryEq.play();
    adv(20000);
    let s = state();
    assert(s.phase === "done" && !s.cleared, "2:1 でクリアになってしまう");
    assert(s.poolE === 2, "余った e⁻ が2個でない: " + s.poolE);
    assert(s.msg.includes("余っている"), "余りを言っていない: " + s.msg);
    assert(!s.sumShown, "そろっていないのに足し合わせを出している");
    win.BatteryEq.setMult(1, 2);
    win.BatteryEq.play();
    adv(20000);
    s = state();
    assert(s.phase === "done" && !s.cleared, "1:2 でクリアになってしまう");
    assert(s.waiting === 1, "待ちイオンが1単位でない: " + s.waiting);
    assert(s.msg.includes("待っている"), "待ちを言っていない: " + s.msg);
  });

  await t("BATTERY: 予想が外れたままなら、e⁻ の数が合っていてもクリアにしない", async () => {
    reset();
    tap("Cu");                    // 外れ
    put11();
    doc.getElementById("playBtn").click();
    adv(20000);
    let s = state();
    assert(s.phase === "done", "アニメが終わらない");
    assert(s.mult.join() === "1,1" && !s.cleared, "外れたままクリアになる: " + s.msg);
    assert(s.msg.includes("予想は外れていた"), "外れを言っていない: " + s.msg);
    assert(!s.sumShown, "外れたのに足し合わせが出ている");
    // 言い直せばクリアできる（行き止まりにしない）
    tap("Zn");
    put11();
    doc.getElementById("playBtn").click();
    adv(20000);
    s = state();
    assert(s.cleared && s.guessTries === 2, "言い直してもクリアできない: " + s.msg);
    assert(doc.getElementById("clearBanner").textContent.includes("言い直して"),
      "クリアの帯が言い直しに触れていない");
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

  /* Phase 3。遊べるかどうかを導出に切り替えても、**画面に出る内訳が変わっていない**ことを
     DOM で実測する。ロジックのテスト（resolvePlayback）は同じ関数を呼び直すだけなので、
     配線を間違えても気づけない ＝ ここは組み上がった行を数える。 */
  await t("LIB: 「▶遊ぶ」54件・「準備中」2件が実際に出ていて、行き先が全部そろっている", async () => {
    const s = state();
    assert(s.rows === s.total, "全件表示になっていない: " + s.rows + "/" + s.total);
    assert(s.playLinks.length === 54, "「▶遊ぶ」が 54 件でない: " + s.playLinks.length);
    assert(s.pendingCount === 2, "「準備中（参照のみ）」が 2 件でない: " + s.pendingCount);
    assert(s.playLinks.length + s.pendingCount === s.total, "遊べる＋準備中が全件にならない");
    // 行き先は2画面だけ。空リンクや undefined が混ざっていないこと
    const files = s.playLinks.map((h) => String(h).split("?")[0]);
    assert(files.every((f) => f === "index.html" || f === "redox.html"), "未知の行き先: " + [...new Set(files)].join(","));
    assert(files.filter((f) => f === "redox.html").length === 14, "酸化還元モード行きが 14 件でない");
    assert(s.playLinks.every((h) => /\?rxn=[^&]+$/.test(h)), "?rxn= の付いていないリンクがある");
    // 行き先のステージが相手側に実在すること（iframe の外＝テスト側の model.js で照合）
    for (const h of s.playLinks) {
      const [file, qs] = h.split("?");
      const id = decodeURIComponent(new URLSearchParams(qs).get("rxn"));
      const list = file === "redox.html" ? REDOX_STAGES : STAGES;
      assert(list.some((st) => st.id === id), "行き先 " + h + " のステージが実在しない");
    }
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
    // 枚数は MODES から導く（モードを足したら1枚増えるのが正しい）。
    // hub（化学レンズへ戻る）はモードではないのでカードにしない
    const modeCount = MODES.filter((m) => m.id !== "hub" && m.id !== "portal").length;
    assert(s.roles >= modeCount,
      "役割カードがモードの数に足りない: " + s.roles + " < " + modeCount);
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
    // 役割カードの行き先も実在するページ（MODES から導く）
    const pages = MODES.map((m) => m.href.split("?")[0]);
    for (const a of $$(".roleCard")) {
      const page = a.getAttribute("href").split("?")[0];
      assert(pages.includes(page), "役割カードの行き先が想定外: " + a.getAttribute("href"));
    }
    /* **入り口ページに載っていないモードを作らない。**
       ハブ（ルート index.html）がアプリの入口として指しているのはこのページなので、
       ここに無いモードは「アプリを開いた人からは存在しないのと同じ」になる。
       実際 v175 まで、電池モードと自由組み立てはここに載っていなかった。
       ヘッダーの帯（MODE-NAV）とこの2本で、新しいモードが埋もれるのを両側から止める。 */
    const portalHrefs = [...$$(".roleCard"), ...$$("header nav.modeBar a")]
      .map((a) => a.getAttribute("href"));
    for (const m of MODES) {
      if (m.id === "hub" || m.id === "portal") continue;
      assert(portalHrefs.includes(m.href),
        m.id + "（" + m.label + "）が入り口ページのどこにも出ていない");
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

  /* ---- 【R】系列の索引（DESIGN_stage_series.md）----
     ⚠ 索引のページは新設していない。この入り口ページに区画を1つ足しただけ。 */
  await t("PORTAL: 系列の索引に 62 ステージ全部が出て、取りこぼしの区画が出ていない", async () => {
    const s = win.Portal.seriesState();
    assert(s.boxes === STAGE_SERIES.length, "系列の区画の数が合わない: " + s.boxes);
    const expected = STAGES.length + REDOX_STAGES.length + CONDITION_STAGES.length + CELL_STAGES.length;
    assert(s.chips.length === expected, "系列のチップが全ステージぶん出ていない: " + s.chips.length + " / " + expected);
    // どこにも入らないステージが出たら画面に赤い区画が出る。0件であること
    assert(s.unclassified === 0, "系列が決まっていないステージの区画が出ている");
    // 区画ごとの件数がモデルの分類と一致（画面側だけ取りこぼす、を止める）
    const model = stagesBySeries();
    for (const g of model.groups) {
      const shown = s.groups.find((x) => x.id === g.series.id);
      assert(shown, "系列の区画が出ていない: " + g.series.id);
      assert(shown.count === g.stages.length,
        g.series.id + ": 画面の件数がモデルと違う " + shown.count + " / " + g.stages.length);
      assert(shown.name === g.series.name, g.series.id + ": 系列名が違う " + shown.name);
    }
    // 行き先が実在するステージであること（電池だけはモードのページまで＝案内を必ず添える）
    const lists = { "index.html": STAGES, "redox.html": REDOX_STAGES, "condition.html": CONDITION_STAGES };
    for (const c of s.chips) {
      if (c.href === "battery.html") continue;
      const m = /^([\w.]+)\?(rxn|s)=(.+)$/.exec(c.href);
      assert(m, "系列のリンクの形が想定外: " + c.href);
      const list = lists[m[1]];
      assert(list, "未知のページを指している: " + c.href);
      assert(list.some((x) => x.id === decodeURIComponent(m[3])), "存在しないステージ: " + c.href);
    }
    const cell = s.groups.find((g) => g.id === "sr-cell");
    assert(cell.hints === 1, "ステージを名指しできないモードに案内が添えられていない");
  });

  /* ⚠ **番号を変えていないこと**の直接の担保。
     ユーザーは「31」「18-21」「34-」と通し番号で呼ぶので、索引の番号が
     アプリの帯の番号とずれたら会話と画面が食い違う。**実際の帯と突き合わせる。** */
  await t("PORTAL: 系列の索引の番号とステージ名が、各モードの帯とそのまま一致する", async () => {
    const chips = win.Portal.seriesState().chips;
    const modes = [
      { id: "app", label: "イオン反応" },
      { id: "appRedox", label: "酸化還元" },
      { id: "appCond", label: "液性" },
      { id: "appBattery", label: "電池" },
    ];
    let checked = 0;
    for (const m of modes) {
      const d = document.getElementById(m.id).contentDocument;
      const btns = [...d.querySelectorAll("#stageNav button")];
      assert(btns.length, m.id + ": 帯のボタンが読めない");
      /* 索引は系列ごとに並ぶので、帯の順とは並びが違う（同じモードが複数の系列にまたがる）。
         **番号で引き当てて**突き合わせる ＝ 番号そのものが対応の鍵になっていることも同時に見る */
      const mine = chips.filter((c) => c.mode === m.label);
      assert(mine.length === btns.length,
        m.label + ": 索引の件数が帯と違う " + mine.length + " / " + btns.length);
      const byNo = {};
      for (const c of mine) {
        assert(!byNo[c.no], m.label + ": 索引に同じ番号が2つある " + c.no);
        byNo[c.no] = c;
      }
      btns.forEach((b, i) => {
        const no = b.textContent.trim();
        const c = byNo[no];
        assert(c, m.label + ": 帯の番号 " + no + " が索引に無い");
        assert(c.no === String(i + 1),
          m.label + ": 帯の " + (i + 1) + " 番目のボタンの番号が " + c.no + " になっている");
        // 帯の data-label には難度の札が混ざることがあるので、題が含まれることを見る
        assert(b.dataset.label.includes(c.title),
          m.label + " " + no + ": 索引の題が帯と違う（" + c.title + " / " + b.dataset.label + "）");
        checked++;
      });
    }
    assert(checked === 62, "突き合わせた件数が 62 でない: " + checked);
  });

  /* 系列（区画）と難度（札）は別の軸。両方が同時に見えること。
     ⚠ 札の文字列は redox.js の ORGANIC_TAG と1文字も違えない（別レーンが触る側なので、
     参照しに行かずに**実際の画面から読んで**突き合わせる）。 */
  await t("PORTAL: 有機（発展）の札が、酸化還元モードが出す札と同じ文字列で 5 枚だけ付く", async () => {
    const chips = win.Portal.seriesState().chips;
    const tagged = chips.filter((c) => c.level);
    assert(tagged.length === 5, "難度の札が 5 枚でない: " + tagged.length);
    assert(tagged.every((c) => c.mode === "酸化還元"), "酸化還元モード以外に札が付いている");
    assert(tagged.map((c) => c.no).join(",") === "8,9,10,11,12",
      "札が付く番号が 8〜12 でない: " + tagged.map((c) => c.no).join(","));
    // 酸化還元モードの帯が実際に出している札と、1文字も違わないこと
    const d = document.getElementById("appRedox").contentDocument;
    const label = [...d.querySelectorAll("#stageNav button")][7].dataset.label;
    const word = tagged[0].level;
    assert(label.includes(word), "索引の札「" + word + "」が酸化還元モードの札と食い違う: " + label);
    // 系列としては酸化還元に残っている（難度で別の系列に切り出していない）
    const box = doc.getElementById("sr-redox");
    assert(box && box.querySelectorAll(".chipLevel").length === 5,
      "有機（発展）が酸化還元の区画から抜けている");
  });

  await t("PORTAL: #系列id で開くと、その系列が見出しごと見えて強調される", async () => {
    win.location.hash = "#sr-precipitate";
    await new Promise((r) => setTimeout(r, 150));
    const box = doc.getElementById("sr-precipitate");
    assert(box.classList.contains("landed"), "着地した系列が強調されない");
    assert(win.Portal.state().landed === "sr-precipitate", "着地先の記録が合わない: " + win.Portal.state().landed);
    const r = box.getBoundingClientRect();
    assert(r.top >= 0 && r.top < win.innerHeight,
      "系列の見出しが画面の外にいる（top=" + Math.round(r.top) + "）");
    // 系列のアンカーが全部実在し、単元のアンカーと衝突していない
    const s = win.Portal.seriesState();
    assert(s.anchors.join(",") === STAGE_SERIES.map((x) => x.id).join(","),
      "系列のアンカーが定義と合わない: " + s.anchors.join(","));
    const units = win.Portal.state().unitAnchors;
    assert(!s.anchors.some((a) => units.includes(a)), "系列と単元でアンカーがぶつかっている");
    win.location.hash = "";
    await new Promise((r2) => setTimeout(r2, 150));
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

     **v175 で総当たりに変えた。** それまでは「リンクを増やすほどスマホでヘッダーが伸びる」
     （項目3）ことを理由に必要な2本だけを固定していたが、その結果6ページが別々の部分集合を
     手書きする状態になり、48マス中27マスしか埋まっていなかった —— いちばん新しい
     電池モードは6ページ中1ページからしかリンクが無く、自由組み立ては正面玄関（index）から
     行けなかった。帯は横スクロールの1行なので、**本数を増やしてもヘッダーは伸びない**
     （320×568 実測で 116px のまま・段数1）。伸びないことも下で一緒に見張る。

     帯は model.js の MODES から組み立てられるので、raw HTML ではなく
     **描画後の DOM**（iframe）を見る。 */
  await t("MODE-NAV: どのページからも全モードへ行ける（自分以外・帯は1段のまま）", async () => {
    const pages = {
      app: "index", appRedox: "redox", appCond: "condition",
      appBattery: "battery", appPortal: "portal", appLib: "library",
    };
    const seen = new Set();
    for (const [frameId, modeId] of Object.entries(pages)) {
      const d2 = document.getElementById(frameId).contentDocument;
      const bar = d2.querySelector("header nav.modeBar");
      assert(bar, frameId + ": モードの帯が無い");
      const ids = [...bar.children].map((a) => a.dataset.mode);
      ids.forEach((x) => seen.add(x));
      // 自分以外の全モードがそろっていること
      const want = MODES.filter((m) => m.id !== modeId).map((m) => m.id);
      assert(JSON.stringify(ids) === JSON.stringify(want),
        frameId + ": 帯の中身が MODES と違う（" + ids.join(",") + " / 想定 " + want.join(",") + "）");
      // 行き先が実在すること（href の取り違え）
      for (const a of bar.children) {
        const m = MODES.find((x) => x.id === a.dataset.mode);
        assert(m && a.getAttribute("href") === m.href,
          frameId + ": " + a.dataset.mode + " の行き先が MODES と違う");
      }
      /* **帯が折り返していないこと**。本数を増やした代わりに、ここが命綱になる。
         高さの実数（120px 以下）は端末幅しだいなので、ここでは見ない ——
         iframe の幅は実機と違い、ここでは 140px になる。
         実寸の見張りは `tools/check-mobile.mjs`（25端末）の担当。 */
      const rows = bar.children.length
        ? Math.round(bar.scrollHeight / bar.children[0].offsetHeight) : 0;
      assert(rows === 1, frameId + ": 帯が " + rows + " 段に折り返している");
    }
    // どのモードも「どこからも見えない」状態になっていないこと
    for (const m of MODES) assert(seen.has(m.id), m.id + ": どのページの帯にも出てこない");
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
  const iframeB = document.getElementById("appBattery");
  const startUI = () => {
    const ready = iframe.contentWindow && iframe.contentWindow.IonEq &&
      iframeR.contentWindow && iframeR.contentWindow.RedoxEq &&
      iframeC.contentWindow && iframeC.contentWindow.ConditionEq &&
      iframeP.contentWindow && iframeP.contentWindow.Portal &&
      iframeB.contentWindow && iframeB.contentWindow.BatteryEq &&
      iframeL.contentWindow && iframeL.contentWindow.IonLibUI &&
      iframeL.contentWindow.IonLibUI.state().total > 0;   // reactions.json の読み込み待ち
    if (!ready) { setTimeout(startUI, 100); return; }
    runReactionLibraryTests().then((rlib) =>
      runUITests(iframe).then((rs1) => runRedoxUITests(iframeR).then((rs2) =>
        runConditionUITests(iframeC).then((rs3) =>
          runPortalUITests(iframeP).then((rs4) =>
            runLibraryUITests(iframeL).then((rs5) =>
              runBatteryUITests(iframeB).then((rs6) => {
                const libOk = render(document.getElementById("results"), rlib, "反応ライブラリ");
                const uiEl = document.getElementById("uiresults");
                const uiOk = render(uiEl, rs1, "UI(イオン反応)");
                const rOk = render(uiEl, rs2, "UI(酸化還元)");
                const cOk = render(uiEl, rs3, "UI(液性)");
                const pOk = render(uiEl, rs4, "UI(入り口)");
                const lOk = render(uiEl, rs5, "UI(索引)");
                const bOk = render(uiEl, rs6, "UI(電池)");
                const total = document.getElementById("total");
                const allOk = modelOk && libOk && uiOk && rOk && cOk && pOk && lOk && bOk;
                total.textContent = allOk ? "TOTAL: ALL PASS" : "TOTAL: FAIL";
                total.className = allOk ? "pass" : "fail";
              })))))));
  };
  startUI();
}
