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

    let running = false;
    let stopReq = false;
    let report = null;

    // 判定のしきい値。**結果ファイルにこの値をそのまま書き出す**ので、
    // 検査で使う値と記録される値がずれない（ずれると版をまたいだ比較が静かに壊れる）。
    // 実際にそれで足をすくわれた: 1反復の操作数が 105→100 に変わっていたのに記録が無く、
    // 失敗率の変化を修正の効果と読み違えた（2026-07-30）
    const THRESHOLDS = {
        heavyMinPx: 24,     // 重原子どうしがこれ未満なら「原子の重なり」
        hydrogenMinPx: 12   // 自動水素と重原子がこれ未満なら「自動水素の重なり」
    };

    /**
     * ファズ1操作の内訳（**合計 1.0**。上から累積で引く）。
     *
     * **ここが唯一の宣言場所**。以前は if / else if に生の数値が散っていて範囲が重なり、
     * 伸縮が一度も回らず・消しゴムが 2% しか回っていなかった（下の分岐の注記を参照）。
     * 割合を変えたら **`OP_MIX_ID` を上げること** —— `summary.comparableKey` に載るので、
     * 内訳の違う実行どうしを並べてしまう事故（操作数 105→100 の前例）が機械的に防げる。
     */
    const OP_MIX_ID = 2;
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
        // JSONにはライブラリ検査は全件、ファズは失敗のみ残す（巨大化防止）
        if (mode === 'library' || !ok) report.records.push(rec);
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
        try {
            m.calculateHydrogens().forEach(h => atoms.forEach(a => {
                if (a.id === h.parentId) return;
                const d = Math.hypot(h.x - a.x, h.y - a.y);
                // 実質的な重なり（原子半径10 + 水素半径6 を考えると視認できる衝突）。
                // 混み合った分子では多少の接近は避けられないため、閾値は衝突の判定に絞る
                if (d < THRESHOLDS.hydrogenMinPx) issues.push(`自動水素の重なり ${a.element}付近 ${d.toFixed(1)}px`);
            }));
        } catch (e) {
            issues.push('calculateHydrogens例外: ' + e.message);
        }
        return issues.slice(0, 8);
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

    // ---------- ②ランダム操作ファズ ----------
    async function fuzzOnce(W, D, g, seed, opsCount, errBox) {
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
                    if (btns.length) {
                        const btn = btns[Math.floor(rnd() * btns.length)];
                        ops.push('react ' + btn.textContent.slice(0, 16));
                        btn.click();
                        if (W.reactor && W.reactor.picking) {
                            const sites = W.reactor.picking.sites;
                            const site = sites[Math.floor(rnd() * sites.length)];
                            const target = g.userMolecule.atoms.find(x => site.includes(x.id));
                            if (target) clickAt(target.x, target.y);
                            else W.reactor.picking = null;
                        }
                    }
                } else if (kind === 'summon') {
                    // 名称からの分子呼び出し（P9-1 M1）
                    const lib = g.getCompoundLibrary();
                    const entry = lib[Math.floor(rnd() * lib.length)];
                    ops.push('summon ' + entry.name);
                    g.summonMolecule(entry.name);
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
        }
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
            iterations: Math.max(1, Number(document.getElementById('fuzz-iterations').value) || 200),
            opsCount: Math.max(1, Number(document.getElementById('fuzz-ops').value) || 25),
            thresholds: THRESHOLDS,
            opMixId: OP_MIX_ID,
            opMix: Object.fromEntries(OP_MIX)
        };
        report = {
            startedAt: new Date().toISOString(),
            finishedAt: null,
            baseSeed: Date.now() >>> 0,
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

        const errBox = [];
        W.addEventListener('error', ev => errBox.push(ev.message));

        if (cfg.library) {
            await runLibrary(W, g);
        }
        if (cfg.fuzz && !stopReq) {
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
            comparableKey: `ops=${report.config.opsCount}/thr=${report.config.thresholds.heavyMinPx},${report.config.thresholds.hydrogenMinPx}/mix=${report.config.opMixId}`
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
    window.auditRerun = async (seed, opsCount) => {
        opsCount = opsCount || Math.max(1, Number(document.getElementById('fuzz-ops').value) || 80);
        const W = frame.contentWindow;
        const D = frame.contentDocument;
        const errBox = [];
        W.addEventListener('error', ev => errBox.push(ev.message));
        return fuzzOnce(W, D, W.game, seed, opsCount, errBox);
    };

    btnStart.addEventListener('click', start);
    btnStop.addEventListener('click', () => { stopReq = true; });
    btnDownload.addEventListener('click', download);
})();
