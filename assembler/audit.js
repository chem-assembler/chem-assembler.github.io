/**
 * Chem-Assembler 自動監査（audit.html から読み込み。P9-5）
 * 実アプリを iframe に読み込み、
 *   ①ライブラリ検査: 登録済み全化合物の自動作図＋名称対応・重なり・価標の検査
 *   ②ランダム操作ファズ: 実イベントでランダム操作を流し込み、不変条件を検査
 * を無人実行する。結果はシード付きで記録され、JSONで保存して後から確認・評価できる。
 */

(() => {
    const frame = document.getElementById('audit-frame');
    const resultsEl = document.getElementById('results');
    const progressEl = document.getElementById('progress');
    const summaryEl = document.getElementById('summary');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnDownload = document.getElementById('btn-download');
    const reachEl = document.getElementById('reach');

    let running = false;
    let stopReq = false;
    let report = null;
    // ②ファズが「反応の面」へどこまで届いたかの帳簿と、そのための題材（v1502・下の注記）
    let rxLedger = null;
    let rxSamples = null;

    // 判定のしきい値。**結果ファイルにこの値をそのまま書き出す**ので、
    // 検査で使う値と記録される値がずれない（ずれると版をまたいだ比較が静かに壊れる）。
    // 実際にそれで足をすくわれた: 1反復の操作数が 105→100 に変わっていたのに記録が無く、
    // 失敗率の変化を修正の効果と読み違えた（2026-07-30）
    const THRESHOLDS = {
        heavyMinPx: 24,     // 重原子どうしがこれ未満なら「原子の重なり」
        hydrogenMinPx: 12,  // 自動水素と重原子がこれ未満なら「自動水素の重なり」
        // 結合線と、その結合の端点でない重原子との距離（§2g・v1160）。
        // **値は持たない**。アプリ本体の `BOND_ATOM_CLEARANCE` を起動時に写す
        // （監査だけ別の数字で数えると「アプリは避けたつもり・監査は別の物差し」になる）
        bondLinePx: null,
        // 結合線と、その結合の端点でない原子から生えた**自動水素**との距離（§10-7・v1240）。
        // これも値は持たず `HYDROGEN_BOND_CLEARANCE` を写す。**bondLinePx とは別項目**
        // （H のグリフは半径6px と小さく、実害が出る距離が重原子と違う）
        hydrogenLinePx: null
    };

    /**
     * ファズ1操作の内訳（**合計 1.0**。上から累積で引く）。
     *
     * **ここが唯一の宣言場所**。以前は if / else if に生の数値が散っていて範囲が重なり、
     * 伸縮が一度も回らず・消しゴムが 2% しか回っていなかった（下の分岐の注記を参照）。
     * 割合を変えたら **`OP_MIX_ID` を上げること** —— `summary.comparableKey` に載るので、
     * 内訳の違う実行どうしを並べてしまう事故（操作数 105→100 の前例）が機械的に防げる。
     */
    // mix=3（v1502）… `summon` に「**相手を並べる組**」の枝が入った版。
    // 割合の表そのものは mix=2 と同じだが、`summon` が引くものが変わった
    // ＝ **反応に届く回数がまるごと変わる**ので、mix=2 の実行とは並べられない
    const OP_MIX_ID = 3;
    const OP_MIX = [
        ['place', 0.30],    // 原子配置
        ['module', 0.14],   // モジュール配置
        ['toggle', 0.11],   // 結合次数トグル
        ['cut', 0.06],      // 結合切断
        ['erase', 0.07],    // 原子削除
        ['stretch', 0.05],  // 結合の伸縮ドラッグ（**mix=1 では一度も回っていなかった**）
        ['react', 0.11],    // 反応の実行
        ['summon', 0.05],   // 名称からの呼び出し
        ['undo', 0.07],
        ['redo', 0.04]
    ];

    /* ===== ★★ ファズを「反応の面」へ届かせる（v1502・DESIGN_review_pack2.md §4-3／発注書 B） =====
     *
     * ⚠⚠ **定期レビューの実測（2026-09-02）**: 200シード × 80操作 ＝ 16,000操作を流したところ、
     *   **49本の反応のうち16本に1回も届いていなかった**（重合4・加硫・ビニロン・開環重合・
     *   縮合重合・糖の縮合／加水分解・酸無水物2本・ワッカー・活性化環の臭素化・環化／開環）。
     *   さらに「react」を引いた回の **45% はボタンが0個で空振り**、押せた回の **38% は
     *   「🔍 反応の前後を見る」**（＝ 分子を変えない札）だった。
     *
     * ★ **原因は乱数の少なさではなく、題材の作り方**。`summon` は 1,145件から**一様に1件**引くので、
     *   **同じ単量体が2〜4個そろう確率がほぼ 0**。届かない16本の中心は「相手が要る反応」だった。
     *
     * ★ **手当て**: `summon` の枝に「**その反応が起きる題材を丸ごと並べる**」道を足す（`GROUP_SHARE`）。
     *   題材は **`buildReactionSamples()` が全ルールぶん用意する** ——
     *     ・相手が要るもの … 下の `PAIR_SAMPLES`（手で書いた表。tests.js の `CV_PAIR_SAMPLES` と同じ中身）
     *     ・1分子で起きるもの … **ライブラリ全件を1回なめて `detect` が通った最初の分子**（手で並べない）
     *   ＝ ★ **次に反応を1本足した人は、何も登録しなくても自動的にファズの対象に入る。**
     *
     * ⚠ **`PAIR_SAMPLES` は tests.js の `CV_PAIR_SAMPLES` と二重に持っている。**
     *   audit.html は tests.js を読み込まない（tests.js は load で自分から走り出す IIFE）ので
     *   そのままでは使い回せなかった。**片方だけ古くなる**のを防ぐため、
     *   ★ **`FZ1` が「2つの表が1文字でも違えば赤」にする**（このファイルを回帰テストから
     *   ライブラリとして読み込んで突き合わせる。→ ファイル末尾の `window.CHEM_AUDIT`）。
     */

    // 相手の分子が要るルールの題材（rule id → 呼び出す化合物名の並び）。
    // ⚠⚠ **tests.js の `CV_PAIR_SAMPLES` と完全に同じにすること**（`FZ1` が見張る）
    const PAIR_SAMPLES = {
        esterification: ['酢酸', 'エタノール'],
        amidation: ['酢酸', 'アニリン'],
        esterification_phenol_info: ['酢酸', 'フェノール'],
        dehydration_inter: ['エタノール', 'エタノール'],
        condensation_glycoside: ['α-D-グルコース（α-D-グルコピラノース）', 'α-D-グルコース（α-D-グルコピラノース）'],
        addition_polymerization: ['エチレン（エテン）', 'エチレン（エテン）', 'エチレン（エテン）'],
        alkyne_polymerization: ['アセチレン（エチン）', 'アセチレン（エチン）', 'アセチレン（エチン）'],
        diene_polymerization: ['1,3-ブタジエン', '1,3-ブタジエン', '1,3-ブタジエン'],
        // 加硫は「重合してできた鎖が2本」要る。単量体からは組めないので、先に重合を2回走らせる
        vulcanization: ['@二本の鎖'],
        condensation_polymerization: ['アジピン酸', 'ヘキサメチレンジアミン', 'アジピン酸', 'ヘキサメチレンジアミン'],
        condensation_polymer_info: ['アジピン酸', 'ヘキサメチレンジアミン'],
        acetalization_pva: ['ポリビニルアルコール', 'ホルムアルデヒド'],
        ring_opening_polymerization: ['ε-カプロラクタム', 'ε-カプロラクタム', 'ε-カプロラクタム'],
        /* ★ 系統樹レーンが v1501 で足した3本（酢酸2分子 → 無水酢酸／ベンゼン＋プロペン → クメン／
         *   アセチレン＋酢酸 → 酢酸ビニル）。⚠ **この3行は `FZ1` と `FZ2` が自分で見つけて名指しした** ——
         *   v1501 と v1502 が同じ版で出会った瞬間に、FZ1 が「表がずれている」・
         *   FZ2 が「題材を作れなかった反応が3本」で赤くなった ＝ 設計どおりの動き。
         *   ★ **二重持ちを機械で見張る、という判断がそのまま効いた実例**（人は気づいていない）。 */
        dehydration_anhydride_inter: ['酢酸', '酢酸'],
        alkylate_arene_propene: ['ベンゼン', 'プロペン（プロピレン）'],
        add_carboxylic_acid_alkyne: ['アセチレン（エチン）', '酢酸']
    };

    // `summon` を引いたとき、単品ではなく「組」を並べる割合。
    // ⚠ 1.0 にはしない —— **単品の呼び出しで出る失敗（段送り・見出しの重なり）が消える**。
    // 0.45 は「16本に届く」と「今までの面を見続ける」を両立させるための配分（実測は報告に残す）
    const GROUP_SHARE = 0.45;

    /* ★ **札の選び方をカバレッジで誘導する割合**（v1502・2つめの手当て）。
     *
     * ⚠ **「組」を足すだけでは届かなかった**（実測・同じ種300個の A/B）:
     *   0回の本数は 14 → 10 にしか減らず、届くようになったのは重合4本と開環重合だけ。
     *   ★ 残りが届かない理由は題材ではなく **札の選び方** —— 題材を並べた直後でも、
     *   一覧には 10〜20 枚の札が並んでいて、狙いの1枚が当たる確率が 1/10 以下になる。
     *
     * ★ **手当て**: react を引いたとき、半分の確率で「**まだ届いていない札**」を選ぶ
     *   （届いた回数 → 押した回数 の順に少ないものを選び、同点は乱数）。
     *   ⚠ 残りの半分は今までどおり一様な乱数 ＝ **元の分布を消さない**
     *   （消すと「よく通る道でだけ起きる壊れ方」が見つからなくなる）。
     * ⚠ 「🔍 反応の前後を見る」など rule id を持たない札は**いちばん後回し**にする
     *   ＝ レビューが指摘した「押せた回の 38% が前後比較」の偏りも同時に薄まる。
     */
    const REACT_COVERAGE_SHARE = 0.5;

    // 否定対照の口: `audit.html?nogroups=1` で「組」の枝を、`?noguide=1` で札の誘導を止める。
    // ★ **「届くようになった」を回数だけで言わない**ため —— 両方止めた実行（＝ v1496 までの
    //   ファズと同じ選び方）で 0回の本数が元に戻ることを確かめられる。
    //   結果ファイルの `comparableKey` にも載せるので、止めた実行を本走と取り違えない
    const GROUPS_ENABLED = !/[?&]nogroups=1/.test(location.search);
    const GUIDE_ENABLED = !/[?&]noguide=1/.test(location.search);

    /* ★ 基点シードを外から固定する口: `audit.html?seed=1000`（v1502）。
     * ⚠ **A/B は「同じ種の集合を両方で流す」でなければ成立しない**（`wilson95` の注記・
     *   `auditRerun` の注記）。基点が `Date.now()` のままだと、否定対照（`?nogroups=1`）と
     *   本走が**別の種の集合**になり、差が枝のせいか種のせいか分けられない。
     * ⚠ 版をまたぐときは注意: `summon` の単品はライブラリの**添字**で引くので、
     *   化合物が増減した版どうしでは同じ種でも別の分子が出る（レビュー §4-2b の落とし穴）。 */
    const FIXED_SEED = (() => {
        const m = /[?&]seed=(\d+)/.exec(location.search);
        return m ? (Number(m[1]) >>> 0) : null;
    })();

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // 再現可能な擬似乱数（mulberry32）
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function progress(text) {
        progressEl.textContent = text;
    }

    function addResult(mode, name, issues, extra = {}) {
        const ok = issues.length === 0;
        report.counts[ok ? 'ok' : 'fail']++;
        // 種類ごとの件数も数える。ok/fail だけだと「ライブラリ検査とファズが何回ずつ走ったか」が
        // 分からず、失敗率の分母を後から推測するしかなくなる
        report.counts[mode === 'library' ? 'libraryChecks' : 'fuzzIterations']++;
        const rec = Object.assign({ mode, name, issues }, extra);
        // JSONにはライブラリ検査は全件、ファズは失敗のみ残す（巨大化防止）。
        // **④当たり判定は合格でも残す** —— しきい値を割っていないことより、
        // 「いちばん狭い受け皿が何 px² だったか」のほうが後から効く。
        // 数字が無いと、緑が「余裕で通った」のか「ぎりぎり」のか読めず、
        // 検査が空振りしていても気づけない（ZM3 で実際に踏んだ形）
        if (mode === 'library' || mode === 'tap' || !ok) report.records.push(rec);
        if (!ok) {
            const li = document.createElement('li');
            li.className = 'fail';
            li.textContent = `❌ [${mode}] ${name}: ${issues.join(' / ')}`;
            resultsEl.appendChild(li);
        }
        summaryEl.textContent = `検査 ${report.counts.ok + report.counts.fail} 件（問題 ${report.counts.fail} 件）`;
        summaryEl.className = report.counts.fail === 0 ? 'pass' : 'fail';
    }

    // 分子の不変条件検査（孤児結合・価標超過・原子の重なり・自動水素の重なり）
    function inspectMolecule(W, g) {
        const issues = [];
        const m = g.userMolecule;
        const ids = new Set(m.atoms.map(a => a.id));
        m.bonds.forEach(b => {
            if (!ids.has(b.atomId1) || !ids.has(b.atomId2)) {
                issues.push('孤児結合（存在しない原子への結合）');
            }
        });
        // 価標の妥当性はアプリ本体と同じ判定（ニトロ基の電荷分離形のみ4本を許容）を使う。
        // 分母は VALENCIES ではなく maxValencyOf を出す。硫黄の上限は S=O の有無で 6↔2 と
        // 文脈で変わるため、元素表の6を出すと「S(4/6)」＝超過していないように読めてしまう
        // （v331 の監査結果を読み違えかけた。実際の上限は2で S(4/2)）
        m.atoms.forEach(a => {
            if (!W.isValencyValid(m, a.id)) {
                const max = W.maxValencyOf ? W.maxValencyOf(m, a.id) : (W.VALENCIES[a.element] || 0);
                issues.push(`価標超過 ${a.element}(${m.getUsedValency(a.id)}/${max})`);
            }
        });
        const atoms = m.atoms;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                const d = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y);
                if (d < THRESHOLDS.heavyMinPx) {
                    issues.push(`原子の重なり ${atoms[i].element}-${atoms[j].element} ${d.toFixed(1)}px`);
                }
            }
        }
        // 結合線が、その結合の端点でない重原子の**下をくぐって**いないか（§2g・v1160）。
        // **原子どうしの距離だけでは1件も出ない**壊れ方で、置き場が詰まって結合が
        // 42→84px に延ばされたときにだけ起きる（実測 5.6px。原子の絵は半径10px）。
        // 判定はアプリ本体と同じ `atomUnderBondLine` を呼ぶ ＝ 物差しは1本
        if (typeof W.atomUnderBondLine === 'function') {
            const byId = new Map(atoms.map(a => [a.id, a]));
            m.bonds.forEach(b => {
                const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
                if (!p || !q) return;
                atoms.forEach(a => {
                    if (a.id === p.id || a.id === q.id) return;
                    if (!W.atomUnderBondLine(a, p, q)) return;
                    const d = W.pointSegmentDistance(a, p, q);
                    // 書式は「原子の重なり C-O 21.7px」にそろえる（buildSummary の
                    // 種類ぶんけが末尾の「 …-… ○○px」を落として `byKind` の鍵にするため）
                    issues.push(`結合線の下の原子 ${a.element}(${Math.round(a.x)},${Math.round(a.y)})` +
                        `-${p.element}${q.element} ${d.toFixed(1)}px`);
                });
            });
        }
        try {
            const hs = m.calculateHydrogens();
            hs.forEach(h => atoms.forEach(a => {
                if (a.id === h.parentId) return;
                const d = Math.hypot(h.x - a.x, h.y - a.y);
                // 実質的な重なり（原子半径10 + 水素半径6 を考えると視認できる衝突）。
                // 混み合った分子では多少の接近は避けられないため、閾値は衝突の判定に絞る
                if (d < THRESHOLDS.hydrogenMinPx) issues.push(`自動水素の重なり ${a.element}付近 ${d.toFixed(1)}px`);
            }));
            // 結合線が、その端点でない原子から生えた**自動水素の上**を通っていないか
            // （§10-7 の決着・v1240）。上の「自動水素の重なり」は**原子と H の距離**で、
            // ここは「H が結合線の下」―― 別の量なので**別項目**にする。
            // 判定はアプリ本体と同じ `hydrogenUnderBondLine` を呼ぶ ＝ 物差しは1本
            if (typeof W.hydrogenUnderBondLine === 'function' && hs.length) {
                const byId = new Map(atoms.map(a => [a.id, a]));
                m.bonds.forEach(b => {
                    const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
                    if (!p || !q) return;
                    hs.forEach(h => {
                        if (h.parentId === p.id || h.parentId === q.id) return;
                        if (!W.hydrogenUnderBondLine(h, p, q)) return;
                        const d = W.pointSegmentDistance(h, p, q);
                        const par = byId.get(h.parentId);
                        issues.push(`結合線の下の自動水素 ${par ? par.element : '?'}付近` +
                            `(${Math.round(h.x)},${Math.round(h.y)})-${p.element}${q.element} ${d.toFixed(1)}px`);
                    });
                });
            }
        } catch (e) {
            issues.push('calculateHydrogens例外: ' + e.message);
        }
        inspectLabels(W, g).forEach(m => issues.push(m));
        return issues.slice(0, 8);
    }

    /**
     * 分子の見出し（🔍 ① 乳酸）の重なり検査（v731。DESIGN_molecule_modal.md §12）。
     * **ここまでの検査は原子どうしの距離しか見ておらず、見出しの重なりは1件も拾えなかった。**
     * ファズは分子を複数ばらまくので、段送りが破れる配置を見つけるならここが向いている。
     *
     * 判定はアプリと**同じ関数**（`rectsOverlap` ほか）を使う。監査だけ別の式で数えると、
     * アプリが避けたつもりの形と監査が見ている形がすれ違って、静かに空振りする。
     * 見ているのは実際に描いた矩形（`g._labelRects`）なので、描画を経ていないと何も出ない
     * （＝ 検査が空振りしていれば「重なり0」ではなく「見出し0個」として現れる）。
     */
    function inspectLabels(W, g) {
        const out = [];
        const rects = g._labelRects;
        if (!rects || rects.length < 1 || !W.rectsOverlap) return out;
        const mol = g.userMolecule;
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                if (W.rectsOverlap(rects[i], rects[j])) out.push(`見出しどうしの重なり（${i + 1}と${j + 1}）`);
            }
        }
        rects.forEach((lr, i) => {
            let hit = 0;
            mol.atoms.forEach(a => {
                if (lr.ids.has(a.id)) return;
                if (W.circleHitsRect({ x: a.x, y: a.y, r: 13 }, lr)) hit++;
            });
            mol.bonds.forEach(b => {
                const a1 = byId.get(b.atomId1), a2 = byId.get(b.atomId2);
                if (!a1 || !a2 || lr.ids.has(a1.id)) return;
                if (W.segmentHitsRect({ x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y, half: 5 }, lr)) hit++;
            });
            if (hit) out.push(`見出しが他の分子の図に乗っている（${i + 1}番・${hit}か所）`);
        });
        return out.slice(0, 4);
    }

    // ---------- ①ライブラリ検査 ----------
    async function runLibrary(W, g) {
        const lib = W.buildCompoundLibrary(g);
        for (let li = 0; li < lib.length && !stopReq; li++) {
            const entry = lib[li];
            const variants = [['原形', entry.target]];
            try {
                variants.push(['変形s2', W.transformCompoundDepiction(entry.target, 2)]);
            } catch (e) {
                addResult('library', `${entry.name} / 変形生成`, ['例外: ' + e.message]);
            }
            for (const [vn, td] of variants) {
                let issues = [];
                try {
                    const mol = g.createTargetFromData({ target: td });
                    g.userMolecule = mol;
                    g.updateDrawing();
                    issues = inspectMolecule(W, g);
                    if (!W.verifyMolecule(mol, entry.mol)) issues.push('同型判定不一致');
                    if (W.canonicalCode(mol) !== W.canonicalCode(entry.mol)) issues.push('正準コード不一致');
                } catch (e) {
                    issues.push('例外: ' + e.message);
                }
                addResult('library', `${entry.name} / ${vn}`, issues);
            }
            // 異性体列挙の不変条件（P9-3）: その化合物自身が必ず列挙結果に含まれること
            const heavy = entry.mol.atoms.filter(a => a.element !== 'H');
            // 重原子5個までに限定する（6個以上は不飽和な分子式で探索が重く、監査が長時間止まるため）
            if (heavy.length >= 2 && heavy.length <= 5) {
                const isoIssues = [];
                try {
                    const hCount = heavy.reduce((s, a) => s + entry.mol.getFreeValency(a.id), 0);
                    const { isomers, overflow } = W.enumerateConstitutionalIsomers(
                        heavy.map(a => a.element), hCount);
                    if (overflow) {
                        isoIssues.push('列挙が打ち切られた');
                    } else {
                        const selfCode = W.canonicalCode(entry.mol);
                        if (!isomers.some(m => W.canonicalCode(m) === selfCode)) {
                            isoIssues.push(`自分自身が列挙結果（${isomers.length}種）に含まれない`);
                        }
                    }
                } catch (e) {
                    isoIssues.push('例外: ' + e.message);
                }
                addResult('library', `${entry.name} / 異性体列挙`, isoIssues);
            }
            progress(`①ライブラリ検査 ${li + 1}/${lib.length}`);
            await sleep(0);
        }
    }

    // ---------- ③画面サイズ検査 ----------
    /**
     * **アプリが「置ける」と判定した点を、その画面サイズで本当にクリックできるか**を見る（2026-08-11）。
     *
     * きっかけは実際に踏んだ事故: ドーパミンの窒素にメチル基を置こうとして、
     * どの向きでも黙って無視された。`getSnappedCoords` は `isValid: true` を返していたので
     * **判定を読んでも原因が分からなかった**。実際は横長の画面で分子の下端が
     * 「この分子を調べる」バーの下へ回り込み、**クリックが別の要素へ吸われていた**。
     *
     * つまり「モデルの上では置ける」と「画面の上で押せる」がずれる。
     * ここはその2つを突き合わせる ＝ **座標変換とレイアウトをまたぐ唯一の検査**。
     * 原子そのものも見る（押せない原子は消すことも動かすこともできない）。
     *
     * **初回（2026-08-11・v1047）の結果: 35件中 21件で重なりを検出した。**
     * 覆っていたのは `#summon-input`（名前から呼び出す欄）・`#work-strip`・`DIV.canvas-header`・
     * `HEADER` / `MAIN`。**どれも回帰ではなく、もとからあるレイアウトの性質**で、
     * 大きい分子（二糖・環状エステル）を呼び出すと端が固定UIの下へ入る。
     * ⚠ **緑にするために検査をゆるめないこと。** ここが赤いのは「直す余地がある」という意味で、
     * 直し方はアプリ側の判断（キャンバスの余白を取る／UI を退ける／呼び出し後に寄せる）。
     */
    const VIEWPORTS = [
        ['携帯 縦 375x812', 375, 812],
        ['携帯 小 320x568', 320, 568],
        ['収録 810x1440', 810, 1440],
        ['タブレット 768x1024', 768, 1024],
        ['デスクトップ 1280x800', 1280, 800]
    ];

    /**
     * SVG 座標がその画面で「キャンバスに届く」かを調べる。覆われていれば理由を返す（届けば null）。
     *
     * ⚠ **画面の外は不具合として数えない。** 大きい分子（スクロース・ステアリン酸）は
     * 携帯の幅に収まりきらないが、**指でパンすれば届く**ので操作は成立している。
     * ここが拾うべきなのは「見えている位置なのに、別の要素がクリックを奪う」ほう——
     * 画面外まで失敗にすると、初回の試走で 35件中 35件が失敗になり**本物が埋もれた**。
     */
    function whyUnreachable(W, D, sx, sy) {
        const svg = D.getElementById('chem-svg');
        if (!svg) return 'chem-svg が無い';
        const pt = svg.createSVGPoint();
        pt.x = sx; pt.y = sy;
        const c = pt.matrixTransform(svg.getScreenCTM());
        if (c.x < 0 || c.y < 0 || c.x > W.innerWidth || c.y > W.innerHeight) return null; // 画面外＝パンで届く
        const el = D.elementFromPoint(c.x, c.y);
        if (!el) return null;
        if (el === svg || svg.contains(el)) return null;
        const who = el.id ? '#' + el.id
            : (el.className && el.className.baseVal !== undefined ? el.tagName + '.' + el.className.baseVal
                : el.tagName + '.' + (el.className || ''));
        return `${who} に覆われている（画面上 ${Math.round(c.x)},${Math.round(c.y)}）`;
    }

    async function runViewport(W, D, g) {
        const lib = W.buildCompoundLibrary(g);
        // **縦に長いものと横に広いもの**を選ぶ。事故は端が UI の下へ回り込むときに起きるので、
        // 小さく収まる分子をいくら見ても再現しない
        const extent = (t) => {
            const xs = t.atoms.map(a => a.x), ys = t.atoms.map(a => a.y);
            return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        };
        const scored = lib.filter(e => e.target.atoms.length <= 24)
            .map(e => ({ e, ex: extent(e.target) }));
        const tall = [...scored].sort((a, b) => b.ex.h - a.ex.h).slice(0, 4);
        const wide = [...scored].sort((a, b) => b.ex.w - a.ex.w).slice(0, 4);
        const picks = [];
        for (const s of [...tall, ...wide]) if (!picks.some(p => p.e.name === s.e.name)) picks.push(s);

        const origW = frame.style.width, origH = frame.style.height;
        for (const [label, vw, vh] of VIEWPORTS) {
            if (stopReq) break;
            frame.style.width = vw + 'px';
            frame.style.height = vh + 'px';
            W.dispatchEvent(new W.Event('resize'));
            await sleep(250);
            for (const { e } of picks) {
                if (stopReq) break;
                const issues = [];
                try {
                    g.userMolecule = g.createTargetFromData({ target: e.target });
                    g.updateDrawing();
                    // ⚠ `fitCanvasToTarget()` は**お題**に合わせる関数なので、呼び出した分子には合わない。
                    // 「名前から呼び出す」が実際に通る道（game.js の summon）と同じこちらを使う
                    g.fitCanvasToMolecule(g.userMolecule);
                    g.updateDrawing();
                    await sleep(60);
                    for (const a of g.userMolecule.atoms) {
                        const why = whyUnreachable(W, D, a.x, a.y);
                        if (why) issues.push(`原子 ${a.element}(${Math.round(a.x)},${Math.round(a.y)}) が押せない: ${why}`);
                        // その原子のまわりで「置ける」と判定される点も見る
                        for (const [dx, dy] of [[42, 0], [0, 42], [-42, 0], [0, -42]]) {
                            const svg = D.getElementById('chem-svg');
                            const pt = svg.createSVGPoint();
                            pt.x = a.x + dx; pt.y = a.y + dy;
                            const c = pt.matrixTransform(svg.getScreenCTM());
                            let coords;
                            try {
                                coords = g.getSnappedCoords({ clientX: c.x, clientY: c.y });
                            } catch (err) { continue; }
                            if (!coords || !coords.isValid) continue;
                            const w2 = whyUnreachable(W, D, coords.x, coords.y);
                            if (w2) issues.push(`置けると判定された点 (${Math.round(coords.x)},${Math.round(coords.y)}) に届かない: ${w2}`);
                        }
                        if (issues.length >= 4) break;
                    }
                } catch (err) {
                    issues.push('例外: ' + err.message);
                }
                addResult('viewport', `${label} / ${e.name}`, issues.slice(0, 4));
            }
            progress(`③画面サイズ検査 ${label}`);
            await sleep(0);
        }
        frame.style.width = origW;
        frame.style.height = origH;
        W.dispatchEvent(new W.Event('resize'));
        await sleep(200);
    }

    /**
     * **④当たり判定の検査**（2026-08-11。ユーザー要望）。
     *
     * ③は「押せるか（可能か）」を見る。こちらは「**押しやすいか**」を見る——
     * ユーザーの言葉で言えば「操作が可能なことと、やりやすいことは別」。
     * 実際、メントールのイソプロピルは**置ける点が32か所あったのに**、
     * 素直に狙った点（置きたい座標そのもの）が別の原子に吸われて何度も失敗した。
     *
     * 原子のまわりを走査して、**その原子に結合が伸びる置き先ごとに「受け皿」の広さと重心**を出し、
     *   ・受け皿が狭すぎる（面積が MIN_AREA_PX 未満）
     *   ・重心が直感からずれている（原子→置き先の線から DRIFT_PX 以上離れている）
     * を挙げる。**狭い**と当てられないし、**ずれている**と「そこを押すとは思わない」。
     */
    const TAP = {
        stepPx: 6,          // 走査の刻み（SVG 単位）
        reachPx: 60,        // 原子からどこまで走査するか
        minAreaPx: 600,     // 受け皿の面積の下限（約 25x25 相当）
        driftPx: 22         // 重心が「原子→置き先」の線からずれてよい距離
    };

    async function runTapTargets(W, D, g) {
        const lib = W.buildCompoundLibrary(g);
        // **枝の上に枝がある分子**を選ぶ（受け皿が競合するのはそこ）。
        // 環の原子だけの分子は候補が二等分線1つに決まるので、症状が出ない
        const picks = lib.filter(e => {
            const t = e.target;
            if (t.atoms.length < 8 || t.atoms.length > 16) return false;
            const deg = new Array(t.atoms.length).fill(0);
            t.bonds.forEach(b => { deg[b.atom1Index]++; deg[b.atom2Index]++; });
            return deg.some((d, i) => d >= 3 && t.atoms[i].element === 'C');
        }).slice(0, 6);

        const svg = D.getElementById('chem-svg');
        for (const e of picks) {
            if (stopReq) break;
            const issues = [];
            const stats = { minAreaPx: Infinity, maxDriftPx: 0, targets: 0 };
            try {
                g.userMolecule = g.createTargetFromData({ target: e.target });
                g.updateDrawing();
                g.fitCanvasToMolecule(g.userMolecule);
                g.updateDrawing();
                D.getElementById('btn-tool-select').click();
                D.querySelector('.atom-btn.atom-c').click();
                await sleep(40);
                for (const a of g.userMolecule.atoms.filter(x => x.element !== 'H')) {
                    // 置き先ごとに、その置き先へ導く走査点を集める
                    const buckets = new Map();
                    for (let dy = -TAP.reachPx; dy <= TAP.reachPx; dy += TAP.stepPx) {
                        for (let dx = -TAP.reachPx; dx <= TAP.reachPx; dx += TAP.stepPx) {
                            const pt = svg.createSVGPoint();
                            pt.x = a.x + dx; pt.y = a.y + dy;
                            const c = pt.matrixTransform(svg.getScreenCTM());
                            let s;
                            try { s = g.getSnappedCoords({ clientX: c.x, clientY: c.y }); } catch (err) { continue; }
                            if (!s || !s.isValid) continue;
                            // **この原子に吸着した置き先だけ**を数える（v1130）。
                            // 自由配置（snapAtom なし）はグリッドに丸まるので、既存原子も格子上にいると
                            // **たまたま 42px ちょうど**になり「その原子の置き先」に化ける
                            // （実測: ニトロベンゼンで 1点だけの受け皿 36px² が2件。結合はできていない）
                            if (!s.snapAtom || s.snapAtom.id !== a.id) continue;
                            // **この原子に付く置き先か**（結合長ぶん離れている）。
                            // ⚠ `BOND_LENGTH` は game.js の関数内ローカルで **window に出ていない**。
                            // 素で書くと undefined との引き算が NaN になり、`Math.abs(NaN) > 3` が
                            // false なので**素通りしてしまう**（初回の試走で、100px 離れた点まで
                            // 「その原子の置き先」と数えていた）。同じ値の `GRID_SIZE` を使う
                            if (Math.abs(Math.hypot(s.x - a.x, s.y - a.y) - W.GRID_SIZE) > 3) continue;
                            const key = `${Math.round(s.x)},${Math.round(s.y)}`;
                            if (!buckets.has(key)) buckets.set(key, { sx: 0, sy: 0, n: 0, x: s.x, y: s.y });
                            const b = buckets.get(key);
                            b.sx += a.x + dx; b.sy += a.y + dy; b.n++;
                        }
                    }
                    for (const b of buckets.values()) {
                        const area = b.n * TAP.stepPx * TAP.stepPx;
                        stats.targets++;
                        stats.minAreaPx = Math.min(stats.minAreaPx, area);
                        if (area < TAP.minAreaPx) {
                            issues.push(`${a.element}(${Math.round(a.x)},${Math.round(a.y)}) → (${Math.round(b.x)},${Math.round(b.y)}) の受け皿が ${area}px²（下限 ${TAP.minAreaPx}）`);
                            continue;
                        }
                        // 重心が「原子 → 置き先」の線からどれだけ離れているか
                        const gx = b.sx / b.n, gy = b.sy / b.n;
                        const vx = b.x - a.x, vy = b.y - a.y, L = Math.hypot(vx, vy) || 1;
                        const drift = Math.abs((gx - a.x) * (vy / L) - (gy - a.y) * (vx / L));
                        stats.maxDriftPx = Math.max(stats.maxDriftPx, Math.round(drift));
                        if (drift > TAP.driftPx) {
                            issues.push(`${a.element}(${Math.round(a.x)},${Math.round(a.y)}) → (${Math.round(b.x)},${Math.round(b.y)}) の受け皿の重心が線から ${Math.round(drift)}px ずれている`);
                        }
                    }
                    if (issues.length >= 4) break;
                }
            } catch (err) {
                issues.push('例外: ' + err.message);
            }
            if (!isFinite(stats.minAreaPx)) stats.minAreaPx = null;
            addResult('tap', e.name, issues.slice(0, 4), stats);
            progress(`④当たり判定の検査 ${e.name}（置き先 ${stats.targets}・最小 ${stats.minAreaPx}px²）`);
            await sleep(0);
        }
    }

    /**
     * **④-2「環 → 鎖 → その先端に枝」**（発注書 §4 の申し送り・DESIGN_hit_areas.md §5）。
     *
     * ④本体は登録図の原子まわりを走査するが、**この形は登録図に無い**（描いている途中の形）。
     * リモネンが組めなかった原因はここで、実測は「有効な的が 10px 幅 × 5方位中2方位」だった。
     * 受け皿の面積ではなく、**手が覚えている操作の言葉**で判定する:
     *   ・足せる方位が5方位中いくつか（下限 4）
     *   ・成功する距離の帯がどれだけ広いか（下限 40px）
     * 毎晩ここが出るので、当たり判定を触ったときの退行が翌朝わかる。
     */
    const TIP_BRANCH = {
        dirs: { '→': [1, 0], '↓': [0, 1], '↑': [0, -1], '↘': [0.7071, 0.7071], '↗': [0.7071, -0.7071] },
        stepPx: 2,        // 距離の刻み
        maxPx: 80,        // どこまで離して試すか
        minDirs: 4,       // 足せる方位の下限（5方位中）
        minBandPx: 40     // 成功する距離帯の幅の下限
    };

    async function runTipBranchTarget(W, D, g) {
        const issues = [];
        // 帯の幅は方位ごとに記録する。「緑だったか」より「どの方位が細いか」が後から効く
        const stats = { okDirs: 0, wideDirs: 0, maxBandPx: 0, deleteMaxPx: 0, bandPx: {} };
        const svg = D.getElementById('chem-svg');
        const toClient = (x, y) => {
            const p = new W.DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
            return { clientX: p.x, clientY: p.y };
        };
        const pe = (type, o) => new W.PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
            button: 0, clientX: o.clientX, clientY: o.clientY
        });
        const heavy = () => g.userMolecule.atoms.filter(a => a.element !== 'H');
        // 環（シクロヘキサン）→ 側鎖1本 → その先端 T、を毎回作り直す
        const build = () => {
            g.userMolecule = new W.Molecule();
            g.history = []; g.redoStack = [];
            g.selectedTool = 'select'; g.selectedModule = null; g.selectedAtomType = 'C';
            g.updateDrawing();
            g.placeModule('cyclohexane', 400, 300, null, null);
            const ring = heavy();
            const R = ring.reduce((b, a) => (a.x > b.x ? a : b), ring[0]);
            const sc = g.getSnappedCoords(toClient(R.x + 35, R.y));
            const T = g.userMolecule.addAtom('C', sc.x, sc.y);
            g.userMolecule.addBond(R.id, T.id, 1);
            g.updateDrawing();
            return { R, T };
        };
        try {
            const okDirs = [];
            for (const [name, [ux, uy]] of Object.entries(TIP_BRANCH.dirs)) {
                let band = 0, run = 0, deleteMax = 0;
                for (let d = 4; d <= TIP_BRANCH.maxPx; d += TIP_BRANCH.stepPx) {
                    const { T } = build();
                    const before = heavy().map(a => a.id);
                    const ev = toClient(T.x + ux * d, T.y + uy * d);
                    svg.dispatchEvent(pe('pointerdown', ev));
                    W.dispatchEvent(pe('pointerup', ev));
                    const after = heavy();
                    if (after.length < before.length) { deleteMax = Math.max(deleteMax, d); run = 0; continue; }
                    const added = after.find(a => !before.includes(a.id));
                    if (added && g.userMolecule.getBond(T.id, added.id)) {
                        run += TIP_BRANCH.stepPx;
                        band = Math.max(band, run);
                    } else {
                        run = 0;
                    }
                    if (stopReq) break;
                }
                stats.maxBandPx = Math.max(stats.maxBandPx, band);
                stats.deleteMaxPx = Math.max(stats.deleteMaxPx, deleteMax);
                stats.bandPx[name] = band;
                if (band > 0) okDirs.push(name);
                await sleep(0);
                if (stopReq) break;
            }
            const wide = okDirs.filter(n => stats.bandPx[n] >= TIP_BRANCH.minBandPx);
            stats.okDirs = okDirs.length;
            stats.wideDirs = wide.length;
            const shown = Object.entries(stats.bandPx).map(([k, v]) => `${k}${v}px`).join(' ');
            if (okDirs.length < TIP_BRANCH.minDirs) {
                issues.push(`先端に枝を足せる方位が ${okDirs.length}/5（下限 ${TIP_BRANCH.minDirs}）: ${okDirs.join('') || 'なし'}`);
            }
            // 幅も方位の数で見る（1方位だけ細いのは環側との分け目で、狙って外す幅ではない）
            if (wide.length < TIP_BRANCH.minDirs) {
                issues.push(`成功する距離帯が ${TIP_BRANCH.minBandPx}px 以上ある方位が ${wide.length}/5（${shown}）`);
            }
            // 「足すつもりで削除」の帯。破壊操作は原子の上（ATOM_TAP_RADIUS）だけのはず
            const tapR = (W.HIT_AREAS && W.HIT_AREAS.atomTapRadius) || 18;
            if (stats.deleteMaxPx > tapR) {
                issues.push(`先端から ${stats.deleteMaxPx}px で原子が消えた（破壊は ${tapR}px までのはず）`);
            }
        } catch (err) {
            issues.push('例外: ' + err.message);
        }
        addResult('tap', '環→鎖→その先端に枝', issues.slice(0, 4), stats);
        progress(`④当たり判定の検査 環→鎖→先端に枝（方位 ${stats.okDirs}/5・帯 ${stats.maxBandPx}px）`);
    }

    /**
     * ★ 全ルールぶんの「題材」を用意する（rule id → 呼び出す化合物名の並び）。
     *
     * ⚠ **手で並べるのは相手が要るものだけ**（`PAIR_SAMPLES`）。それ以外は
     *   ライブラリ全件を1回なめて `detect` が通った最初の分子を採る ＝
     *   **反応を足した人が登録を忘れても、黙って対象から外れない**。
     *   （tests.js の `CV1` ①と同じ拾い方。物差しを2つ持たないため考え方をそろえてある）
     *
     * ⚠ 走査は `entry.mol`（ライブラリの共有インスタンス）を **読むだけ**。`detect` は
     *   トポロジーしか見ないので、ここで作図し直す必要はない（1,145件ぶんの写しを作らない）。
     */
    function buildReactionSamples(W, g) {
        const rules = (W && W.REACTION_RULES) || [];
        const out = {};
        rules.forEach(r => { if (PAIR_SAMPLES[r.id]) out[r.id] = PAIR_SAMPLES[r.id].slice(); });
        let lib = [];
        try { lib = W.buildCompoundLibrary(g); } catch (e) { lib = []; }
        for (const entry of lib) {
            const rest = rules.filter(r => !out[r.id]);
            if (!rest.length) break;
            for (const r of rest) {
                try { if (r.detect && r.detect(entry.mol).length > 0) out[r.id] = [entry.name]; }
                catch (e) { /* 読めない図は飛ばす */ }
            }
        }
        return out;
    }

    /**
     * 題材をキャンバスへ並べる。⚠ `@二本の鎖` だけは特別（加硫）——
     * **単量体からは組めない**ので、先にジエンの重合を2回走らせて鎖を2本作る。
     * （tests.js の `cvSetup` と同じ組み立て。ここだけ `rule.apply` を直に呼ぶ ＝
     *  「反応の題材を用意する」ための下ごしらえで、ファズが押した操作ではない）
     */
    function summonGroup(W, g, names) {
        if (!names || !names.length) return;
        if (names[0] === '@二本の鎖') {
            const dien = (W.REACTION_RULES || []).find(r => r.id === 'diene_polymerization');
            if (!dien) return;
            for (let k = 0; k < 2; k++) {
                for (let i = 0; i < 3; i++) g.summonMolecule('1,3-ブタジエン');
                let s = [];
                try { s = dien.detect(g.userMolecule) || []; } catch (e) { s = []; }
                if (s.length) { try { dien.apply(g, s[0]); } catch (e) { /* 置き場が無いなど */ } }
            }
            g.updateDrawing();
            return;
        }
        names.forEach(n => g.summonMolecule(n));
    }

    /* ===== ★★ 「どこまで届いたか」の帳簿（発注書 B ②） =====
     *
     * ⚠⚠ **これがいちばん大事**: 届いていないことに**次の人が気づける形**にする。
     *   DEVELOPMENT.md の「『見張れた』と『見張っていない』が区別できない検査は、無いより危ない」。
     *
     * ★ **回数ではなく本数で出す**（1本に1万回届いても意味がない）。
     *   ・`rulesZeroApplied` … 一度も**実際に分子が変わらなかった**反応の本数（★ 必ず出す）
     *   ・`missedPercent`    … 「react」を引いたのにボタンが0個だった割合（＝ 空振り）
     *   ・`pressedByKind`    … 押した札の内訳（分子を変える札／前後比較／機構／解説カード）
     */
    function newReactionLedger(W) {
        const rules = (W && W.REACTION_RULES) || [];
        return {
            attempts: 0,   // 「react」を引いた回数
            missed: 0,     // そのうちボタンが0個だった回数（空振り）
            pressed: 0,    // 実際に押した回数
            byKind: { rule: 0, reverse: 0, info: 0, compare: 0, mechanism: 0, partner: 0, other: 0 },
            pressedRules: {},  // rule id → 押した回数
            appliedRules: {},  // rule id → **実際に分子が変わった**回数（reactor.lastReaction で見る）
            groupSummons: {},  // rule id → その題材を並べた回数
            ruleIds: rules.map(r => r.id),
            infoIds: rules.filter(r => r.info).map(r => r.id)
        };
    }

    /**
     * ★ どの札を押すかを決める（カバレッジ誘導。上の `REACT_COVERAGE_SHARE` の注記）。
     *
     * ⚠ **純関数にしてある**（帳簿と乱数を引数で受ける）ので `FZ4` が作りごとの札で単体検査できる。
     * ★ 物差しは「**届いた回数 → 押した回数**」の辞書順で少ないもの。
     *   - 届いた回数を先に見るので、**押しても分子が変わらない札**（解説カード）が
     *     いつまでも「0回」で選ばれ続けることがない（押した回数で後回しになる）
     *   - rule id を持たない札（前後比較・機構）は最後に回す
     */
    function pickReactionButton(btns, led, rnd, guided) {
        if (!btns.length) return null;
        if (!guided || !led || rnd() >= REACT_COVERAGE_SHARE) {
            return btns[Math.floor(rnd() * btns.length)];
        }
        const cost = (b) => {
            const ds = b.dataset || {};
            const rid = ds.rule || ds.reverseRule;
            if (!rid) return Infinity;                       // 札に反応が結びついていない
            return (led.appliedRules[rid] || 0) * 1000 + (led.pressedRules[rid] || 0);
        };
        let best = [], bestN = Infinity;
        btns.forEach(b => {
            const n = cost(b);
            if (n < bestN) { bestN = n; best = [b]; }
            else if (n === bestN) best.push(b);
        });
        if (!best.length) best = btns;                        // 全部 Infinity（rule id 無し）
        return best[Math.floor(rnd() * best.length)];
    }

    // 押した札が何だったかを数える。⚠ 見分けは **DOM の属性**で行う（文言に頼るのは最後だけ）
    function tallyPressedButton(led, btn) {
        const ds = btn.dataset || {};
        if (ds.partner) { led.byKind.partner++; return 'partner'; }
        if (ds.reverseRule) {
            led.byKind.reverse++;
            led.pressedRules[ds.reverseRule] = (led.pressedRules[ds.reverseRule] || 0) + 1;
            return 'reverse';
        }
        if (ds.rule) {
            const info = led.infoIds.indexOf(ds.rule) >= 0;
            led.byKind[info ? 'info' : 'rule']++;
            led.pressedRules[ds.rule] = (led.pressedRules[ds.rule] || 0) + 1;
            return info ? 'info' : 'rule';
        }
        const t = btn.textContent || '';
        if (t.indexOf('前後') >= 0) { led.byKind.compare++; return 'compare'; }
        if (t.indexOf('機構') >= 0) { led.byKind.mechanism++; return 'mechanism'; }
        led.byKind.other++;
        return 'other';
    }

    /**
     * 帳簿から「毎回出す数」を作る。**純関数**（`FZ3` が作りごとの入力で単体検査する）。
     * ⚠ 分母は用途ごとに変える: 空振り率は「react を引いた回数」・
     *   札の内訳は「押せた回数」・到達の本数は「**分子を変えられる反応の本数**」
     *   （解説カード `rule.info` は押しても分子が変わらないので分母から外す）。
     */
    function summarizeReactions(led) {
        if (!led) return null;
        const pct = (n, d) => d ? +(n / d * 100).toFixed(1) : null;
        const execIds = (led.ruleIds || []).filter(id => (led.infoIds || []).indexOf(id) < 0);
        const zeroPressed = execIds.filter(id => !(led.pressedRules || {})[id]);
        const zeroApplied = execIds.filter(id => !(led.appliedRules || {})[id]);
        return {
            attempts: led.attempts,
            missed: led.missed,
            missedPercent: pct(led.missed, led.attempts),
            pressed: led.pressed,
            pressedByKind: led.byKind,
            comparePercent: pct((led.byKind || {}).compare, led.pressed),
            moleculeChangingPercent: pct((led.byKind || {}).rule + (led.byKind || {}).reverse, led.pressed),
            rulesTotal: (led.ruleIds || []).length,
            rulesExecutable: execIds.length,
            rulesPressed: execIds.length - zeroPressed.length,
            rulesApplied: execIds.length - zeroApplied.length,
            rulesZeroPressed: zeroPressed.length,
            rulesZeroApplied: zeroApplied.length,
            zeroPressedIds: zeroPressed,
            zeroAppliedIds: zeroApplied,
            groupSummons: led.groupSummons,
            pressCounts: led.pressedRules,
            applyCounts: led.appliedRules
        };
    }

    // 画面に出す1行（緑でも読めるところに置く。⚠ 結果 JSON を開かないと分からない形にしない）
    function reachLine(s) {
        if (!s) return '';
        return `反応への到達: 分子を変えられる ${s.rulesExecutable} 本のうち ` +
            `${s.rulesApplied} 本で実際に分子が変わった（★ 0回 ${s.rulesZeroApplied} 本` +
            `${s.rulesZeroApplied ? '：' + s.zeroAppliedIds.join(', ') : ''}）` +
            `／react の空振り ${s.missedPercent}%（${s.missed}/${s.attempts}）` +
            `／押した ${s.pressed} 回の内訳 分子を変える札 ${s.moleculeChangingPercent}%・` +
            `前後を見る ${s.comparePercent}%`;
    }

    // ---------- ②ランダム操作ファズ ----------
    async function fuzzOnce(W, D, g, seed, opsCount, errBox, onOp) {
        const rnd = mulberry32(seed);
        if (W.reactionPlayer && W.reactionPlayer.active) W.reactionPlayer.exit();
        g.userMolecule = new W.Molecule();
        // 各反復を独立させる。履歴を残すと undo/redo が前の反復の分子を復元してしまい、
        // シードから同じ結果を再現できなくなる（失敗の再現に必須）
        g.history = [];
        g.redoStack = [];
        g.updateDrawing();
        g.selectedTool = 'select';
        g.selectedModule = null;
        g.selectedAtomType = 'C';
        g.asymmetricMode = false;
        errBox.length = 0;

        const svg = D.getElementById('chem-svg');
        const toClient = (x, y) => {
            const p = new W.DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
            return { clientX: p.x, clientY: p.y };
        };
        const pe = (type, opts) => new W.PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
            button: 0, clientX: opts.clientX, clientY: opts.clientY
        });
        const clickAt = (x, y) => {
            const ev = toClient(x, y);
            svg.dispatchEvent(pe('pointerdown', ev));
            W.dispatchEvent(pe('pointerup', ev));
        };
        const randAtom = () => {
            const list = g.userMolecule.atoms;
            return list.length ? list[Math.floor(rnd() * list.length)] : null;
        };

        const ops = [];
        for (let k = 0; k < opsCount; k++) {
            const r = rnd();
            try {
                // ⚠ **分岐は「累積の表（OP_MIX）を上から順に見る」形にしてある。**
                // 以前は if / else if に生の数値を直接書いていて、**範囲が重なっていた**:
                // 反応が [0.68,0.80) を先に取るのに、後ろの消しゴムが `r < 0.78`・
                // 伸縮が `r < 0.68` を名乗っていたため、
                //   ・**伸縮（結合のドラッグ）は一度も実行されていなかった**（範囲が空）
                //   ・消しゴムは意図の 12% ではなく **2%** しか回っていなかった
                // 実測（夜間監査5回の失敗レコードの ops のべ8770件）: stretch 0件・erase 1.86%。
                // 2026-08-05・監査レーン第3弾で発見。**割合を1か所で宣言すれば同じ事故は起きない。**
                const pick = () => {
                    let acc = 0;
                    for (const [name, share] of OP_MIX) { acc += share; if (r < acc) return name; }
                    return OP_MIX[OP_MIX.length - 1][0];
                };
                const kind = pick();
                if (kind === 'react') {
                    // 反応の実行（P9-1 M2〜M5）。適用箇所の選択待ちになったら候補をクリックして確定する
                    const btns = [...D.querySelectorAll('#reaction-actions button')];
                    // ★ 空振り（ボタンが0個）も数える —— 数えないと「react を 11% 引いている」
                    //   という**予定**と、実際に押せた回数の差（実測 45%）が誰にも見えない
                    if (rxLedger) rxLedger.attempts++;
                    if (btns.length) {
                        const btn = pickReactionButton(btns, rxLedger, rnd, GUIDE_ENABLED);
                        ops.push('react ' + btn.textContent.slice(0, 16));
                        const lastBefore = (W.reactor && W.reactor.lastReaction) || null;
                        if (rxLedger) { rxLedger.pressed++; tallyPressedButton(rxLedger, btn); }
                        btn.click();
                        if (W.reactor && W.reactor.picking) {
                            const sites = W.reactor.picking.sites;
                            const site = sites[Math.floor(rnd() * sites.length)];
                            const target = g.userMolecule.atoms.find(x => site.includes(x.id));
                            if (target) clickAt(target.x, target.y);
                            else W.reactor.picking = null;
                        }
                        // ★ **押した**と**実際に分子が変わった**は別。到達の本数は後者で数える
                        //   （箇所の選択で外した回・情報カードを押した回を「届いた」に混ぜない）
                        const lastAfter = (W.reactor && W.reactor.lastReaction) || null;
                        if (rxLedger && lastAfter && lastAfter !== lastBefore && lastAfter.ruleId) {
                            rxLedger.appliedRules[lastAfter.ruleId] =
                                (rxLedger.appliedRules[lastAfter.ruleId] || 0) + 1;
                        }
                    } else if (rxLedger) {
                        rxLedger.missed++;
                    }
                } else if (kind === 'summon') {
                    // 名称からの分子呼び出し（P9-1 M1）
                    // ★ **確率 GROUP_SHARE で「その反応が起きる題材」を丸ごと並べる**（§4-3 の手当て）。
                    //   単品を1件引くだけでは、同じ単量体が2〜4個そろう確率がほぼ 0 になる
                    const ruleIds = rxSamples ? Object.keys(rxSamples) : [];
                    // ⚠ サイコロは**枝を止めていても必ず振る**（`?nogroups=1` の否定対照で
                    //    乱数の並びがここで1つずれると、比べているものが変わってしまう）
                    const groupRoll = rnd();
                    if (GROUPS_ENABLED && ruleIds.length && groupRoll < GROUP_SHARE) {
                        const rid = ruleIds[Math.floor(rnd() * ruleIds.length)];
                        const names = rxSamples[rid];
                        ops.push(`summon@${rid} ${names.join('+')}`.slice(0, 60));
                        if (rxLedger) rxLedger.groupSummons[rid] = (rxLedger.groupSummons[rid] || 0) + 1;
                        summonGroup(W, g, names);
                    } else {
                        const lib = g.getCompoundLibrary();
                        const entry = lib[Math.floor(rnd() * lib.length)];
                        ops.push('summon ' + entry.name);
                        g.summonMolecule(entry.name);
                    }
                } else if (kind === 'place') {
                    // 原子配置（既存原子の近傍グリッド）
                    const els = ['C', 'C', 'C', 'O', 'N', 'Cl', 'Br'];
                    g.selectedTool = 'select';
                    g.selectedModule = null;
                    g.selectedAtomType = els[Math.floor(rnd() * els.length)];
                    const base = randAtom() || { x: 420, y: 294 };
                    const d = [[42, 0], [-42, 0], [0, 42], [0, -42], [84, 0], [0, 84]][Math.floor(rnd() * 6)];
                    ops.push(`place ${g.selectedAtomType} (${Math.round(base.x + d[0])},${Math.round(base.y + d[1])})`);
                    clickAt(base.x + d[0], base.y + d[1]);
                } else if (kind === 'module') {
                    // モジュール配置
                    const mods = ['benzene', 'cyclohexane', 'cyclopentane', 'oh', 'cooh', 'nh2', 'no2'];
                    const mod = mods[Math.floor(rnd() * mods.length)];
                    g.selectedTool = 'select';
                    g.selectedModule = mod;
                    const base = randAtom() || { x: 420, y: 294 };
                    const dx = Math.round((rnd() * 2 - 1) * 80);
                    const dy = Math.round((rnd() * 2 - 1) * 80);
                    ops.push(`module ${mod} (${Math.round(base.x + dx)},${Math.round(base.y + dy)})`);
                    clickAt(base.x + dx, base.y + dy);
                    g.selectedModule = null;
                } else if (kind === 'toggle') {
                    // 結合次数トグル
                    const hits = D.querySelectorAll('.svg-bond-hitbox');
                    if (hits.length) {
                        ops.push('toggle bond');
                        hits[Math.floor(rnd() * hits.length)]
                            .dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                } else if (kind === 'cut') {
                    // 結合切断
                    const hits = D.querySelectorAll('.svg-bond-hitbox');
                    if (hits.length) {
                        ops.push('cut bond');
                        hits[Math.floor(rnd() * hits.length)]
                            .dispatchEvent(new W.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                    }
                } else if (kind === 'erase') {
                    // 原子削除（消しゴム）
                    const a = randAtom();
                    if (a) {
                        g.selectedTool = 'erase';
                        ops.push(`erase (${Math.round(a.x)},${Math.round(a.y)})`);
                        clickAt(a.x, a.y);
                        g.selectedTool = 'select';
                    }
                } else if (kind === 'stretch') {
                    // 結合の伸縮ドラッグ
                    const hits = D.querySelectorAll('.svg-bond-hitbox');
                    if (hits.length) {
                        const h = hits[Math.floor(rnd() * hits.length)];
                        const mx = (Number(h.getAttribute('x1')) + Number(h.getAttribute('x2'))) / 2;
                        const my = (Number(h.getAttribute('y1')) + Number(h.getAttribute('y2'))) / 2;
                        const d = [[42, 0], [-42, 0], [0, 42], [0, -42]][Math.floor(rnd() * 4)];
                        ops.push(`stretch (${Math.round(mx)},${Math.round(my)})+(${d})`);
                        h.dispatchEvent(pe('pointerdown', toClient(mx, my)));
                        svg.dispatchEvent(pe('pointermove', toClient(mx + d[0], my + d[1])));
                        W.dispatchEvent(pe('pointerup', toClient(mx + d[0], my + d[1])));
                    }
                } else if (kind === 'undo') {
                    ops.push('undo');
                    g.undo();
                } else {
                    ops.push('redo');
                    g.redo();
                }
            } catch (e) {
                return { ops, issues: ['同期例外: ' + e.message] };
            }
            if (onOp) onOp(k, ops[ops.length - 1], g);
            if (k % 8 === 7) await sleep(0); // clickの抑止フラグ解除などを進める
        }
        await sleep(10);
        const issues = inspectMolecule(W, g).concat(errBox.map(m => 'JSエラー: ' + m));
        return { ops, issues };
    }

    async function runFuzz(W, D, g, iterations, opsCount, baseSeed, errBox) {
        for (let it = 0; it < iterations && !stopReq; it++) {
            const seed = (baseSeed + it) >>> 0;
            const { ops, issues } = await fuzzOnce(W, D, g, seed, opsCount, errBox);
            addResult('fuzz', `#${it} seed=${seed}`, issues, issues.length ? { ops } : {});
            progress(`②ランダム操作ファズ ${it + 1}/${iterations}（シード基点 ${baseSeed}）`);
            // ★ 到達の数は**走行中も画面に出す**（結果 JSON を開かないと分からない形にしない）。
            //   毎回数え直すと 49本 × 反復ぶん無駄なので 20 反復に1回
            if (reachEl && (it % 20 === 19 || it === iterations - 1)) {
                reachEl.textContent = reachLine(summarizeReactions(rxLedger));
            }
        }
        if (reachEl) reachEl.textContent = reachLine(summarizeReactions(rxLedger));
    }

    async function start() {
        if (running) return;
        running = true;
        stopReq = false;
        btnStart.disabled = true;
        btnStop.disabled = false;
        btnDownload.disabled = true;
        resultsEl.innerHTML = '';
        summaryEl.textContent = '';

        // 実行条件を先に確定して記録する。**これが無いと版をまたいだ比較ができない**
        // （操作数が105→100に変わったのに記録が無く、失敗率の差を修正の効果と読み違えた）
        const cfg = {
            library: document.getElementById('mode-library').checked,
            fuzz: document.getElementById('mode-fuzz').checked,
            viewport: document.getElementById('mode-viewport').checked,
            viewports: VIEWPORTS.map(v => v[0]),
            tap: document.getElementById('mode-tap').checked,
            tapThresholds: TAP,
            iterations: Math.max(1, Number(document.getElementById('fuzz-iterations').value) || 200),
            opsCount: Math.max(1, Number(document.getElementById('fuzz-ops').value) || 25),
            thresholds: THRESHOLDS,
            opMixId: OP_MIX_ID,
            opMix: Object.fromEntries(OP_MIX),
            // ★ 「組」の枝の有無と配分。⚠ **止めた実行（?nogroups=1）と並べない**ので
            //   `comparableKey` にも載せる（否定対照の実行を本走と取り違えないため）
            groupSummons: GROUPS_ENABLED,
            groupShare: GROUPS_ENABLED ? GROUP_SHARE : 0,
            reactGuide: GUIDE_ENABLED,
            reactCoverageShare: GUIDE_ENABLED ? REACT_COVERAGE_SHARE : 0
        };
        // 監査結果は window にも出す（ヘッドレスの検証スクリプトから読むため）
        report = window.__auditReport = {
            startedAt: new Date().toISOString(),
            finishedAt: null,
            baseSeed: FIXED_SEED === null ? (Date.now() >>> 0) : FIXED_SEED,
            // ⚠ 種を固定した実行はふだんの夜間監査と混ぜない（「毎晩ちがう種で回す」が本旨）
            seedFixed: FIXED_SEED !== null,
            config: cfg,
            counts: { ok: 0, fail: 0, libraryChecks: 0, fuzzIterations: 0 },
            records: []
        };

        progress('アプリの起動を待機中…');
        for (let i = 0; i < 100 && !frame.contentWindow.appReady; i++) await sleep(100);
        const W = frame.contentWindow;
        const D = frame.contentDocument;
        const g = W.game;
        if (!W.appReady) {
            progress('アプリが起動しませんでした');
            running = false;
            btnStart.disabled = false;
            btnStop.disabled = true;
            return;
        }
        report.appVersion = (D.querySelector('.version') || {}).textContent || '?';
        // 結合線のしきい値は**アプリ本体の値をそのまま写す**（監査だけ別の数字にしない）
        THRESHOLDS.bondLinePx = W.BOND_ATOM_CLEARANCE ?? null;
        THRESHOLDS.hydrogenLinePx = W.HYDROGEN_BOND_CLEARANCE ?? null;

        const errBox = [];
        W.addEventListener('error', ev => errBox.push(ev.message));

        if (cfg.library) {
            await runLibrary(W, g);
        }
        // **ファズより先に回す**。iframe の大きさを変えるので、
        // ファズの途中に挟むと「どの画面で出た失敗か」が記録から読めなくなる
        if (cfg.viewport && !stopReq) {
            await runViewport(W, D, g);
        }
        if (cfg.tap && !stopReq) {
            await runTapTargets(W, D, g);
            // 登録図に無い形（描いている途中の形）は別立てで見る
            if (!stopReq) await runTipBranchTarget(W, D, g);
        }
        if (cfg.fuzz && !stopReq) {
            // 題材づくりは1回だけ（ライブラリ全件 × detect の総当たりなので数秒かかる）
            progress('②の題材を用意しています（全ルールぶん）…');
            rxSamples = buildReactionSamples(W, g);
            rxLedger = newReactionLedger(W);
            report.reactionSamples = Object.fromEntries(
                Object.entries(rxSamples).map(([k, v]) => [k, v.join('＋')]));
            // ⚠ **題材が作れなかったルールはここで名指しする**（黙って対象から外さない）
            report.reactionSamplesMissing =
                (W.REACTION_RULES || []).map(r => r.id).filter(id => !rxSamples[id]);
            await runFuzz(W, D, g, cfg.iterations, cfg.opsCount, report.baseSeed, errBox);
        }

        // 後片付け
        g.userMolecule = new W.Molecule();
        g.updateDrawing();

        report.finishedAt = new Date().toISOString();
        report.stopped = stopReq; // 途中で止めた実行は完走した実行と比べてはいけない
        report.summary = buildSummary();
        progress((stopReq ? '停止しました' : '完了') + `（${report.startedAt} 開始 → ${report.finishedAt} 終了）`);
        running = false;
        btnStart.disabled = false;
        btnStop.disabled = true;
        btnDownload.disabled = false;
    }

    /**
     * 版をまたいで比べるための集計を作る（P12-8。ユーザー指摘「記録する内容を見直しては」）。
     * 生の records から毎回数え直すと、数え方のほうがぶれて比較にならないので、
     * **ここで一度だけ数えて書き出す**。
     * 率の分母は必ず「ファズ反復数」にする（ok+fail はライブラリ検査を含むため、
     * ライブラリの件数が増えただけで率が下がって見える）。
     */
    /**
     * 失敗率の 95%信頼区間（Wilson）。**この区間が無いと版をまたいだ比較を読み違える。**
     *
     * 実際に踏んだ（2026-08-05・監査レーン第3弾）: 5000反復で v640 が 17件・16件、
     * v650 が 26件・25件だったのを「版の中では揃い、版の間で割れているから乱数ではない」と
     * 読んだ。だが 4回はすべて基点シードの違う独立試行で、5000反復・p≈0.004 なら
     * 1回の件数の標準偏差は約4.5件ある。33/10000 対 51/10000 は両側 p≈0.06 ＝ 差とは言えない。
     * 同じ種5000個を両版で流し直した対照実験でも差は出ず（v640 24件 / v650 27件・29件、
     * **同じ版をもう一度流した差 27→29 のほうが大きい**）、退行ではなかった。
     *
     * **読み方: 2つの実行の区間が重なっているなら、差を主張してはいけない。**
     */
    function wilson95(k, n) {
        if (!n) return null;
        const z = 1.959964, p = k / n, den = 1 + z * z / n;
        const centre = (p + z * z / (2 * n)) / den;
        const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
        return [+Math.max(0, (centre - half) * 100).toFixed(3), +((centre + half) * 100).toFixed(3)];
    }

    function buildSummary() {
        const kinds = {};
        let hydrogen = 0, heavy = 0, other = 0;
        let worstHeavy = null, worstHydrogen = null;
        (report.records || []).forEach(r => {
            (r.issues || []).forEach(is => {
                const s = String(is);
                const kind = s.replace(/\s+[0-9.]+px$/, '').replace(/ \S+付近$/, '').replace(/ \S+-\S+$/, '');
                kinds[kind] = (kinds[kind] || 0) + 1;
                const m = s.match(/([0-9.]+)px$/);
                const d = m ? +m[1] : null;
                if (/自動水素の重なり/.test(s)) {
                    hydrogen++;
                    if (d !== null && (worstHydrogen === null || d < worstHydrogen)) worstHydrogen = d;
                } else if (/原子の重なり/.test(s)) {
                    heavy++;
                    if (d !== null && (worstHeavy === null || d < worstHeavy)) worstHeavy = d;
                } else other++;
            });
        });
        const iter = report.counts.fuzzIterations || 0;
        const rate = (n) => iter ? +(n / iter * 100).toFixed(3) : null;
        return {
            // 率は「ファズ1反復あたりの%」。版が違っても、config が同じならこの値で比べられる
            failRatePercent: rate(report.counts.fail),
            // **必ず区間で見ること**（上の wilson95 の注記）。5000反復で20件級なら幅は約 ±0.15pt あり、
            // 「17件 → 26件」程度の差は1回ずつの比較では区別できない
            failRateCI95Percent: wilson95(report.counts.fail, iter),
            hydrogenOverlapPercent: rate(hydrogen),
            heavyOverlapPercent: rate(heavy),
            otherIssuePercent: rate(other),
            counts: { hydrogenOverlap: hydrogen, heavyOverlap: heavy, other },
            worstDistancePx: { heavy: worstHeavy, hydrogen: worstHydrogen },
            byKind: kinds,
            libraryIssueCount: (report.records || [])
                .filter(r => r.mode === 'library' && (r.issues || []).length).length,
            // 比較の可否をファイル自身に書いておく（条件が違う実行を並べないため）
            // `mix` は操作の内訳の版（OP_MIX_ID）。**mix が違う実行は並べてはいけない。**
            // mix=1（v719 まで）は伸縮が0回・消しゴムが2%しか回らない内訳だった
            // `bondLinePx` は v1160 で足した「結合線の下の原子」のしきい値。
            // `hydrogenLinePx` は v1240 で足した「結合線の下の自動水素」のしきい値。
            // 検査が1つ増えた実行と増える前の実行は並べられないので鍵に載せる
            comparableKey: `ops=${report.config.opsCount}/thr=${report.config.thresholds.heavyMinPx},${report.config.thresholds.hydrogenMinPx},${report.config.thresholds.bondLinePx},${report.config.thresholds.hydrogenLinePx}/mix=${report.config.opMixId}/grp=${report.config.groupShare}/cov=${report.config.reactCoverageShare}`,
            /* ★★ **反応の面へどこまで届いたか**（v1502・発注書 B ②）。
             * ⚠ **回数ではなく本数を見ること** —— 1本に1万回届いても、他の48本が0回なら
             *   「監査がバグを見つけてくれる」は成り立たない。`rulesZeroApplied` が要。 */
            reactions: summarizeReactions(rxLedger)
        };
    }

    function download() {
        const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chem-audit-${(report.startedAt || '').replace(/[:.]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /**
     * 診断用フック: 失敗したシードを再現し、操作ログと検出内容を返す（開発者向け）。
     *
     * **既定の操作数は画面の「1反復の操作数」を読む。** 以前は 30 決め打ちで、
     * 夜間監査の 80 とは別の条件のまま再生していた ＝ 再現しないのを不思議がる罠だった。
     *
     * ⚠ **再現は完全ではない。** モーフィング（rAF・約0.8秒）と `scheduleLabelResync` の
     * 進み方が機械の速さで変わるため、同じ種でも指摘が出たり出なかったりする。
     * 実測（2026-08-05）: 夜間監査で失敗した種8個を同じツリーで再生して**再現は5個**、
     * 代わりに夜間監査では通っていた別の3個が失敗した。
     * **1件単位で「この版で新しく壊れた」と言ってはいけない。**
     * 版を比べるときは、**同じ種の集合を両版で流して率で比べ、
     * かならず「同じ版をもう一度流した差」をノイズの床として並べること。**
     */
    window.auditReport = () => report;
    /* ⚠ **再生でも題材を用意してから走る**（v1502）。用意しないと `summon` の枝が
     *   「組」を引けず、**同じ種でも操作列が丸ごと別物になる** ＝ 再現の道具が壊れる。
     *   本走が済んでいれば作り直さない（ライブラリ全件の総当たりなので数秒かかる） */
    const ensureSamples = (W, g) => {
        if (!rxSamples) rxSamples = buildReactionSamples(W, g);
        return rxSamples;
    };
    window.auditRerun = async (seed, opsCount) => {
        opsCount = opsCount || Math.max(1, Number(document.getElementById('fuzz-ops').value) || 80);
        const W = frame.contentWindow;
        const D = frame.contentDocument;
        const errBox = [];
        ensureSamples(W, W.game);
        W.addEventListener('error', ev => errBox.push(ev.message));
        return fuzzOnce(W, D, W.game, seed, opsCount, errBox);
    };
    // 診断用: 1操作ごとに任意の検査を挟む（0.0px の発生源の特定に使う）
    window.auditTrace = async (seed, opsCount, onOp) => {
        opsCount = opsCount || Math.max(1, Number(document.getElementById('fuzz-ops').value) || 80);
        const W = frame.contentWindow;
        const D = frame.contentDocument;
        const errBox = [];
        ensureSamples(W, W.game);
        return fuzzOnce(W, D, W.game, seed, opsCount, errBox, onOp);
    };

    /* ★ **回帰テスト（tests.js）から「ライブラリとして」読み込むための口**（v1502）。
     *
     * ⚠ audit.html は tests.js を読み込めない（tests.js は load で自分から走り出す IIFE）ので、
     *   題材の表を共有するには**こちら側を読ませる**しかない。`FZ1`〜`FZ3` は
     *   test.html の中へこのファイルを差し込んで、ここに出したものだけを見る。
     * ⚠ **`?v=` を付けて読み込ませない**（`verify-release.js` は .html しか見ないので
     *   .js の中のキャッシュバスターは版の更新もれの死角になる）。テスト側は毎回違う
     *   使い捨ての語を付けて読む。 */
    window.CHEM_AUDIT = {
        PAIR_SAMPLES,
        OP_MIX_ID,
        OP_MIX,
        GROUP_SHARE,
        REACT_COVERAGE_SHARE,
        buildReactionSamples,
        summonGroup,
        newReactionLedger,
        tallyPressedButton,
        pickReactionButton,
        summarizeReactions
    };

    // ⚠ ここから下は audit.html の中でしか意味がない。ライブラリとして読まれたときは
    //    ボタンが無いので、素通りさせる（読み込んだだけで例外を投げない）
    if (!btnStart || !btnStop || !btnDownload) return;

    btnStart.addEventListener('click', start);
    btnStop.addEventListener('click', () => { stopReq = true; });
    btnDownload.addEventListener('click', download);
})();
