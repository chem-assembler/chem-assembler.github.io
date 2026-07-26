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
        // 価標の妥当性はアプリ本体と同じ判定（ニトロ基の電荷分離形のみ4本を許容）を使う
        m.atoms.forEach(a => {
            if (!W.isValencyValid(m, a.id)) {
                issues.push(`価標超過 ${a.element}(${m.getUsedValency(a.id)}/${W.VALENCIES[a.element] || 0})`);
            }
        });
        const atoms = m.atoms;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                const d = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y);
                if (d < 24) {
                    issues.push(`原子の重なり ${atoms[i].element}-${atoms[j].element} ${d.toFixed(1)}px`);
                }
            }
        }
        try {
            m.calculateHydrogens().forEach(h => atoms.forEach(a => {
                if (a.id === h.parentId) return;
                const d = Math.hypot(h.x - a.x, h.y - a.y);
                // 12px未満は実質的な重なり（原子半径10 + 水素半径6 を考えると視認できる衝突）。
                // 混み合った分子では多少の接近は避けられないため、閾値は衝突の判定に絞る
                if (d < 12) issues.push(`自動水素の重なり ${a.element}付近 ${d.toFixed(1)}px`);
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
                if (r >= 0.68 && r < 0.80) {
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
                } else if (r >= 0.80 && r < 0.86) {
                    // 名称からの分子呼び出し（P9-1 M1）
                    const lib = g.getCompoundLibrary();
                    const entry = lib[Math.floor(rnd() * lib.length)];
                    ops.push('summon ' + entry.name);
                    g.summonMolecule(entry.name);
                } else if (r < 0.32) {
                    // 原子配置（既存原子の近傍グリッド）
                    const els = ['C', 'C', 'C', 'O', 'N', 'Cl', 'Br'];
                    g.selectedTool = 'select';
                    g.selectedModule = null;
                    g.selectedAtomType = els[Math.floor(rnd() * els.length)];
                    const base = randAtom() || { x: 420, y: 294 };
                    const d = [[42, 0], [-42, 0], [0, 42], [0, -42], [84, 0], [0, 84]][Math.floor(rnd() * 6)];
                    ops.push(`place ${g.selectedAtomType} (${Math.round(base.x + d[0])},${Math.round(base.y + d[1])})`);
                    clickAt(base.x + d[0], base.y + d[1]);
                } else if (r < 0.47) {
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
                } else if (r < 0.59) {
                    // 結合次数トグル
                    const hits = D.querySelectorAll('.svg-bond-hitbox');
                    if (hits.length) {
                        ops.push('toggle bond');
                        hits[Math.floor(rnd() * hits.length)]
                            .dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                } else if (r < 0.66) {
                    // 結合切断
                    const hits = D.querySelectorAll('.svg-bond-hitbox');
                    if (hits.length) {
                        ops.push('cut bond');
                        hits[Math.floor(rnd() * hits.length)]
                            .dispatchEvent(new W.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                    }
                } else if (r < 0.78) {
                    // 原子削除（消しゴム）
                    const a = randAtom();
                    if (a) {
                        g.selectedTool = 'erase';
                        ops.push(`erase (${Math.round(a.x)},${Math.round(a.y)})`);
                        clickAt(a.x, a.y);
                        g.selectedTool = 'select';
                    }
                } else if (r < 0.68) {
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
                } else if (r < 0.94) {
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

        report = {
            startedAt: new Date().toISOString(),
            finishedAt: null,
            baseSeed: Date.now() >>> 0,
            counts: { ok: 0, fail: 0 },
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

        if (document.getElementById('mode-library').checked) {
            await runLibrary(W, g);
        }
        if (document.getElementById('mode-fuzz').checked && !stopReq) {
            const iterations = Math.max(1, Number(document.getElementById('fuzz-iterations').value) || 200);
            const opsCount = Math.max(1, Number(document.getElementById('fuzz-ops').value) || 25);
            await runFuzz(W, D, g, iterations, opsCount, report.baseSeed, errBox);
        }

        // 後片付け
        g.userMolecule = new W.Molecule();
        g.updateDrawing();

        report.finishedAt = new Date().toISOString();
        progress((stopReq ? '停止しました' : '完了') + `（${report.startedAt} 開始 → ${report.finishedAt} 終了）`);
        running = false;
        btnStart.disabled = false;
        btnStop.disabled = true;
        btnDownload.disabled = false;
    }

    function download() {
        const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chem-audit-${(report.startedAt || '').replace(/[:.]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // 診断用フック: 失敗したシードを再現し、操作ログと検出内容を返す（開発者向け）
    window.auditReport = () => report;
    window.auditRerun = async (seed, opsCount = 30) => {
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
