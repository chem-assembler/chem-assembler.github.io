/**
 * Chem-Assembler 回帰テスト（test.html から読み込み）
 * 実アプリを iframe に読み込み、実イベント（PointerEvent）で駆動して検証する。
 * 過去に修正した不具合の再発検出が目的（各テストの由来は DEVELOPMENT.md のロードマップ参照）。
 */

(() => {
    const tests = [];
    const test = (name, fn) => tests.push({ name, fn });
    const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
    const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

    // ===== テストコンテキスト（iframe内のアプリを操作するヘルパー群） =====
    function makeCtx(frame) {
        const W = frame.contentWindow;
        const D = frame.contentDocument;
        const svg = D.getElementById('chem-svg');
        const toClient = (x, y) => {
            const pt = new W.DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
            return { clientX: pt.x, clientY: pt.y };
        };
        const pe = (type, opts = {}) => new W.PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
            button: opts.button ?? 0, clientX: opts.clientX, clientY: opts.clientY
        });
        const clickAt = (x, y, button = 0) => {
            const ev = toClient(x, y);
            svg.dispatchEvent(pe('pointerdown', { ...ev, button }));
            W.dispatchEvent(pe('pointerup', { ...ev, button }));
        };
        const hoverAt = (x, y) => svg.dispatchEvent(pe('pointermove', toClient(x, y)));
        const dragBond = (hitEl, fromXY, toXY) => {
            hitEl.dispatchEvent(pe('pointerdown', toClient(fromXY.x, fromXY.y)));
            svg.dispatchEvent(pe('pointermove', toClient(toXY.x, toXY.y)));
            W.dispatchEvent(pe('pointerup', toClient(toXY.x, toXY.y)));
        };
        const hitbox = (i) => D.querySelectorAll('.svg-bond-hitbox')[i];
        const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
        const reset = () => {
            const g = W.game;
            // 初回ヒント（結合タップの案内）が他テストの途中で不意に発火しないよう既読にしておく
            // （R3が明示的にフラグを消して検証する）
            W.localStorage.setItem('chemHintBondToggle', '1');
            if (W.reactionPlayer && W.reactionPlayer.active) W.reactionPlayer.exit();
            if (g.setMode) g.setMode('puzzle');
            g.loadStage(0);
            g.selectedTool = 'select';
            g.selectedAtomType = 'C';
            g.asymmetricMode = false;
            g.judgeAsymmetric = false;
            g.reshapeMode = false;
            g._reshapeLastBond = null;
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            D.getElementById('verify-result').classList.add('hidden');
        };
        return { W, D, svg, toClient, pe, clickAt, hoverAt, dragBond, hitbox, tick, reset,
                 get game() { return W.game; } };
    }

    // ===== A. 基盤 =====

    test('A1: アプリ起動とデータロード（ステージ56+・反応4本）', async (c) => {
        assert(c.W.game, 'game が初期化されていない');
        assert(c.W.STAGES.length >= 56, `STAGES が ${c.W.STAGES.length} 件（56件以上を期待）`);
        assert(c.W.reactionPlayer && c.W.reactionPlayer.reactions.length >= 4,
            '反応データが4本ロードされていない');
        assert(c.W.COMPOUNDS && c.W.COMPOUNDS.length >= 20,
            `名称判定ライブラリ(compounds.json)が ${c.W.COMPOUNDS ? c.W.COMPOUNDS.length : 0} 件`);
    });

    test('A2: 座標変換の誤差ゼロ（getScreenCTM準拠・5点）', async (c) => {
        const rect = c.svg.getBoundingClientRect();
        const pts = [
            [rect.left + rect.width / 2, rect.top + 20],
            [rect.left + rect.width / 2, rect.bottom - 20],
            [rect.left + 20, rect.top + rect.height / 2],
            [rect.right - 20, rect.top + rect.height / 2],
            [rect.left + 20, rect.top + 20]
        ];
        pts.forEach(([cx, cy]) => {
            const code = c.game.getSnappedCoords({ clientX: cx, clientY: cy });
            const pt = new c.W.DOMPoint(cx, cy).matrixTransform(c.svg.getScreenCTM().inverse());
            assert(near(code.rawX, pt.x, 0.5) && near(code.rawY, pt.y, 0.5),
                `座標変換誤差: (${(code.rawX - pt.x).toFixed(1)}, ${(code.rawY - pt.y).toFixed(1)})`);
        });
    });

    test('A3: 全ステージ＋名称ライブラリの自己整合', async (c) => {
        const failures = [];
        [...c.W.STAGES, ...c.W.COMPOUNDS].forEach(entry => {
            const target = c.game.createTargetFromData(entry);
            const user = c.game.createTargetFromData(entry);
            if (!c.W.verifyMolecule(user, target)) failures.push(entry.name);
        });
        assert(failures.length === 0, `不整合エントリ: ${failures.join(', ')}`);
    });

    test('A4: 水ステージを実イベントでクリアできる', async (c) => {
        c.reset();
        c.game.selectedAtomType = 'O';
        c.clickAt(400, 300);
        assert(c.W.verifyMolecule(c.game.userMolecule, c.game.createTargetFromData(c.W.STAGES[0])),
            '水（O 1個配置）が正解にならない');
    });

    // ===== B. 検証ロジック =====

    test('B1: ケクレ位相の吸収（o-キシレン両位相とも正解）', async (c) => {
        const target = c.game.createTargetFromData(c.W.STAGES.find(s => s.name === 'o-キシレン'));
        [1, 0].forEach(attachBase => {
            const u = new c.W.Molecule();
            const ring = [];
            for (let i = 0; i < 6; i++) ring.push(u.addAtom('C', 400 + 42 * Math.cos(i * Math.PI / 3), 300 + 42 * Math.sin(i * Math.PI / 3)));
            for (let i = 0; i < 6; i++) u.addBond(ring[i].id, ring[(i + 1) % 6].id, i % 2 === 0 ? 2 : 1);
            const m1 = u.addAtom('C', 500, 300);
            const m2 = u.addAtom('C', 500, 350);
            u.addBond(ring[attachBase].id, m1.id, 1);
            u.addBond(ring[attachBase + 1].id, m2.id, 1);
            assert(c.W.verifyMolecule(u, target), `ケクレ位相 attachBase=${attachBase} で不正解`);
        });
    });

    test('B2: 負例が不正解のまま（メタ配置/酢酸の次数違い/シクロヘキサン）', async (c) => {
        const oxy = c.game.createTargetFromData(c.W.STAGES.find(s => s.name === 'o-キシレン'));
        const u1 = new c.W.Molecule();
        const r1 = [];
        for (let i = 0; i < 6; i++) r1.push(u1.addAtom('C', 400 + 42 * Math.cos(i * Math.PI / 3), 300 + 42 * Math.sin(i * Math.PI / 3)));
        for (let i = 0; i < 6; i++) u1.addBond(r1[i].id, r1[(i + 1) % 6].id, i % 2 === 0 ? 2 : 1);
        u1.addBond(r1[0].id, u1.addAtom('C', 500, 300).id, 1);
        u1.addBond(r1[2].id, u1.addAtom('C', 500, 350).id, 1);
        assert(!c.W.verifyMolecule(u1, oxy), 'メタ配置が o-キシレンとして正解になった');

        const acetic = c.game.createTargetFromData(c.W.STAGES.find(s => s.name === '酢酸'));
        const u2 = new c.W.Molecule();
        const c1 = u2.addAtom('C', 360, 300), c2 = u2.addAtom('C', 400, 300);
        const oA = u2.addAtom('O', 400, 260), oB = u2.addAtom('O', 440, 300);
        u2.addBond(c1.id, c2.id, 1);
        u2.addBond(c2.id, oA.id, 1); // 本来は二重結合
        u2.addBond(c2.id, oB.id, 1);
        assert(!c.W.verifyMolecule(u2, acetic), '結合次数違いの酢酸が正解になった');

        const tol = c.game.createTargetFromData(c.W.STAGES.find(s => s.name === 'トルエン'));
        const u3 = new c.W.Molecule();
        const r3 = [];
        for (let i = 0; i < 6; i++) r3.push(u3.addAtom('C', 400 + 42 * Math.cos(i * Math.PI / 3), 300 + 42 * Math.sin(i * Math.PI / 3)));
        for (let i = 0; i < 6; i++) u3.addBond(r3[i].id, r3[(i + 1) % 6].id, 1);
        u3.addBond(r3[0].id, u3.addAtom('C', 500, 300).id, 1);
        assert(!c.W.verifyMolecule(u3, tol), 'メチルシクロヘキサンがトルエンとして正解になった');
    });

    test('B3: -NO2モジュールでニトロベンゼンがクリア可能', async (c) => {
        c.reset();
        const idx = c.W.STAGES.findIndex(s => s.name === 'ニトロベンゼン');
        c.game.loadStage(idx);
        c.game.placeModule('benzene', 400, 300, null);
        const ring = c.game.userMolecule.atoms.filter(a => a.element === 'C');
        c.game.placeModule('no2', ring[0].x, ring[0].y, ring[0]);
        assert(c.W.verifyMolecule(c.game.userMolecule, c.game.createTargetFromData(c.W.STAGES[idx])),
            'モジュールで組んだニトロベンゼンが不正解');
    });

    test('B4: 自動水素数（アセチレン[1,1]・アセトニトリル C:3,C:0,N:0）', async (c) => {
        const acet = c.game.createTargetFromData(c.W.STAGES.find(s => s.name.startsWith('アセチレン')));
        assert(acet.atoms.every(a => acet.getFreeValency(a.id) === 1), 'アセチレンのH数が[1,1]でない');
        const mecn = c.game.createTargetFromData(c.W.STAGES.find(s => s.name === 'アセトニトリル'));
        const h = mecn.atoms.map(a => `${a.element}:${mecn.getFreeValency(a.id)}`).join(',');
        assert(h === 'C:3,C:0,N:0', `アセトニトリルのH数が ${h}`);
    });

    test('B5: アラニンのα炭素のみ不斉判定', async (c) => {
        const ala = c.game.createTargetFromData(c.W.STAGES.find(s => s.name === 'アラニン'));
        assert(ala.isAsymmetricCarbon(ala.atoms[1].id), 'α炭素が不斉と判定されない');
        assert(!ala.isAsymmetricCarbon(ala.atoms[0].id), 'メチル炭素が不斉と誤判定');
    });

    test('B6: 環原子の元素置換でピリジンがクリア可能（O置換は価標ブロック）', async (c) => {
        c.reset();
        const idx = c.W.STAGES.findIndex(s => s.name === 'ピリジン');
        c.game.loadStage(idx);
        c.game.placeModule('benzene', 400, 300, null);
        c.game.selectedAtomType = 'N';
        const ringAtom = c.game.userMolecule.atoms[0];
        c.clickAt(ringAtom.x, ringAtom.y);
        assert(ringAtom.element === 'N', '環CがNに置換されない');
        assert(c.W.verifyMolecule(c.game.userMolecule, c.game.createTargetFromData(c.W.STAGES[idx])),
            'ピリジンが不正解');
        c.game.selectedAtomType = 'O';
        const ringC = c.game.userMolecule.atoms[1];
        c.clickAt(ringC.x, ringC.y);
        assert(ringC.element === 'C', '価標超過のO置換がブロックされない');
    });

    test('B7: 三重結合の端のHは反対側180°に配置（エチン/プロピン）', async (c) => {
        // エテン→エチンのトグル時、Hが90°（垂直）に付く不具合の再発防止（2026-07-21 ユーザー報告）
        const m = new c.W.Molecule();
        const a = m.addAtom('C', 379, 300);
        const b = m.addAtom('C', 421, 300);
        m.addBond(a.id, b.id, 3);
        const hs = m.calculateHydrogens();
        assert(hs.length === 2, `エチンのH数が ${hs.length}（2を期待）`);
        const ha = hs.find(h => h.parentId === a.id);
        const hb = hs.find(h => h.parentId === b.id);
        assert(ha && ha.x < a.x && Math.abs(ha.y - 300) < 1, '左CのHが三重結合の反対側（左・直線上）にない');
        assert(hb && hb.x > b.x && Math.abs(hb.y - 300) < 1, '右CのHが三重結合の反対側（右・直線上）にない');

        // プロピン末端CのHも直線上（H–C≡C–CH3）
        const p = new c.W.Molecule();
        const c1 = p.addAtom('C', 358, 300);
        const c2 = p.addAtom('C', 400, 300);
        const c3 = p.addAtom('C', 442, 300);
        p.addBond(c1.id, c2.id, 3);
        p.addBond(c2.id, c3.id, 1);
        const h1 = p.calculateHydrogens().find(h => h.parentId === c1.id);
        assert(h1 && h1.x < c1.x && Math.abs(h1.y - 300) < 1, 'プロピン末端CのHが直線上にない');
    });

    test('B8: 二重結合の端の自動Hは空き結合手の数まで（イミンのNがNH₂表示になる不具合）', async (c) => {
        // CH₂=NH（メタンイミン）: C-N を二重結合にしたとき、N のHは1個（2026-07-24 ユーザー報告）
        const m = new c.W.Molecule();
        const cAtom = m.addAtom('C', 400, 300);
        const nAtom = m.addAtom('N', 442, 300);
        m.addBond(cAtom.id, nAtom.id, 2);
        const hs = m.calculateHydrogens();
        const cH = hs.filter(h => h.parentId === cAtom.id).length;
        const nH = hs.filter(h => h.parentId === nAtom.id).length;
        assert(cH === 2, `C=N端のCのH数が ${cH}（2を期待）`);
        assert(nH === 1, `C=N端のNのH数が ${nH}（1を期待。NH₂表示の再発）`);
        // 描画のH数と分子式のH数が一致する（CH₃N）
        assert(cH + nH === 3, `描画H合計 ${cH + nH} が分子式CH₃Nと不一致`);

        // 回帰確認: C=C 端の炭素は従来どおり2個（エテンのH合計4）
        const e = new c.W.Molecule();
        const e1 = e.addAtom('C', 400, 300);
        const e2 = e.addAtom('C', 442, 300);
        e.addBond(e1.id, e2.id, 2);
        assert(e.calculateHydrogens().length === 4, 'エテンの自動Hが4個でない');

        // ケトンの O（空き手0）にHが付かないことも確認（C=O）
        const k = new c.W.Molecule();
        const k1 = k.addAtom('C', 400, 300);
        const k2 = k.addAtom('O', 442, 300);
        k.addBond(k1.id, k2.id, 2);
        assert(k.calculateHydrogens().filter(h => h.parentId === k2.id).length === 0,
            'C=OのOにHが付いている');
    });

    // ===== C. 編集操作 =====

    test('C1: プレビュー＝実結合（2原子隣接の交点で2本）', async (c) => {
        c.reset();
        c.game.userMolecule.addAtom('C', 336, 294);
        c.game.userMolecule.addAtom('C', 378, 336);
        c.game.updateDrawing();
        c.hoverAt(378, 294);
        const previewLines = c.D.querySelectorAll('#ui-group line').length;
        c.clickAt(378, 294);
        const newAtom = c.game.userMolecule.atoms[2];
        const actual = c.game.userMolecule.getBondsForAtom(newAtom.id).length;
        assert(previewLines === 2 && actual === 2, `プレビュー${previewLines}本 vs 実結合${actual}本`);
    });

    test('C2: 4つ目のCで四員環が閉じシクロブタン判定', async (c) => {
        c.reset();
        c.clickAt(336, 294);
        c.clickAt(378, 294);
        c.clickAt(378, 336);
        c.clickAt(336, 336);
        assert(c.game.userMolecule.atoms.length === 4 && c.game.userMolecule.bonds.length === 4, '四員環が閉じない');
        const m = new c.W.Molecule();
        const cs = [m.addAtom('C', 0, 0), m.addAtom('C', 42, 0), m.addAtom('C', 42, 42), m.addAtom('C', 0, 42)];
        for (let i = 0; i < 4; i++) m.addBond(cs[i].id, cs[(i + 1) % 4].id, 1);
        assert(c.W.verifyMolecule(c.game.userMolecule, m), 'シクロブタンとして判定されない');
    });

    test('C3: Cl（価標1）は2隣接点でも結合1本のみ', async (c) => {
        c.reset();
        c.game.userMolecule.addAtom('C', 336, 294);
        c.game.userMolecule.addAtom('C', 378, 336);
        c.game.updateDrawing();
        c.game.selectedAtomType = 'Cl';
        c.clickAt(378, 294);
        const cl = c.game.userMolecule.atoms.find(a => a.element === 'Cl');
        assert(cl && c.game.userMolecule.getBondsForAtom(cl.id).length === 1,
            'Clの結合数が価標を超えた');
    });

    test('C4: プロパン中央Cの削除で両端が残る（巻き添え削除なし）', async (c) => {
        c.reset();
        const a = c.game.userMolecule.addAtom('C', 358, 300);
        const b = c.game.userMolecule.addAtom('C', 400, 300);
        const d = c.game.userMolecule.addAtom('C', 442, 300);
        c.game.userMolecule.addBond(a.id, b.id, 1);
        c.game.userMolecule.addBond(b.id, d.id, 1);
        c.game.updateDrawing();
        c.game.selectedTool = 'erase';
        c.clickAt(b.x, b.y);
        assert(c.game.userMolecule.atoms.length === 2, `残存原子が ${c.game.userMolecule.atoms.length} 個`);
    });

    test('C5: Undoで不斉マークが復元される', async (c) => {
        c.reset();
        const atom = c.game.userMolecule.addAtom('C', 400, 300);
        atom.isAsymmetricMarked = true;
        c.game.saveState();
        atom.isAsymmetricMarked = false;
        c.game.undo();
        assert(c.game.userMolecule.atoms[0].isAsymmetricMarked, 'Undoでマークが消えた');
    });

    test('C6: 空振り操作でUndo履歴を消費しない', async (c) => {
        c.reset();
        c.game.userMolecule.addAtom('C', 400, 300);
        c.game.updateDrawing();
        c.game.selectedTool = 'erase';
        const before = c.game.history.length;
        c.clickAt(150, 150); // 何もない場所
        assert(c.game.history.length === before, '消しゴム空振りで履歴が増えた');
        c.game.userMolecule = new c.W.Molecule();
        c.game.updateDrawing();
        const before2 = c.game.history.length;
        c.D.getElementById('btn-clear-all').click();
        assert(c.game.history.length === before2, '空の全消去で履歴が増えた');
    });

    test('C7: 右クリックで原子削除・右ドラッグはパン', async (c) => {
        c.reset();
        const a = c.game.userMolecule.addAtom('C', 379, 300);
        const b = c.game.userMolecule.addAtom('C', 421, 300);
        c.game.userMolecule.addBond(a.id, b.id, 1);
        c.game.updateDrawing();
        c.clickAt(a.x, a.y, 2); // 右クリック（移動なし）
        assert(c.game.userMolecule.atoms.length === 1, '右クリックで原子が削除されない');
        const vbx = c.svg.viewBox.baseVal.x;
        const g1 = c.toClient(b.x, b.y);
        c.svg.dispatchEvent(c.pe('pointerdown', { ...g1, button: 2 }));
        c.svg.dispatchEvent(c.pe('pointermove', { clientX: g1.clientX + 60, clientY: g1.clientY + 40, button: 2 }));
        c.W.dispatchEvent(c.pe('pointerup', { clientX: g1.clientX + 60, clientY: g1.clientY + 40, button: 2 }));
        assert(Math.abs(c.svg.viewBox.baseVal.x - vbx) > 1, '右ドラッグでパンしない');
        assert(c.game.userMolecule.atoms.length === 1, '右ドラッグで原子が消えた');
    });

    test('C8: スペース不足時は配置禁止（noSpace）＋トースト', async (c) => {
        c.reset();
        c.game.userMolecule.addAtom('C', 336, 294);
        for (let x = 372; x <= 428; x += 6) {
            const n1 = c.game.userMolecule.addAtom('N', x, 273);
            const n2 = c.game.userMolecule.addAtom('N', x, 231);
            c.game.userMolecule.addBond(n1.id, n2.id, 3); // 飽和ブロッカー
        }
        c.game.updateDrawing();
        const mouse = c.toClient(365, 301);
        const coords = c.game.getSnappedCoords({ clientX: mouse.clientX, clientY: mouse.clientY });
        assert(coords.isValid === false && coords.noSpace === true, 'noSpaceにならない');
        const before = c.game.userMolecule.atoms.length;
        c.clickAt(365, 301);
        assert(c.game.userMolecule.atoms.length === before, '配置がブロックされない');
        assert(c.D.getElementById('verify-result').textContent.includes('スペースが足りず'),
            '案内トーストが出ない');
    });

    test('C9: 結合クリックで次数トグル（エタン→エテン→エチン）', async (c) => {
        // v83退行の再発防止: 純クリック時にヒットラインが再生成されると
        // clickイベントが元要素に届かず、トグルが動かなくなる。
        // 「down+up後も要素がDOMに残っている」ことが実ブラウザでclickが届く条件。
        c.reset();
        c.clickAt(336, 294);
        c.clickAt(378, 294); // エタン（C-C 単結合）
        const bond = c.game.userMolecule.bonds[0];
        const mid = c.toClient(357, 294);
        const clickBond = async () => {
            const hit = c.D.querySelector('.svg-bond-hitbox');
            hit.dispatchEvent(c.pe('pointerdown', mid));
            c.W.dispatchEvent(c.pe('pointerup', mid));
            assert(hit.isConnected, 'クリック処理中にヒットラインが再生成された（clickが届かない）');
            hit.dispatchEvent(new c.W.MouseEvent('click', { ...mid, bubbles: true }));
            await c.tick();
        };
        await clickBond();
        assert(bond.type === 2, `1回目のクリックで二重結合にならない（type=${bond.type}）`);
        await clickBond();
        assert(bond.type === 3, `2回目のクリックで三重結合にならない（type=${bond.type}）`);
    });

    // ===== D. 伸縮・振り分け =====

    test('D1: 結合ドラッグで+42伸長・部分木追随・Undo復元', async (c) => {
        c.reset();
        const a = c.game.userMolecule.addAtom('C', 336, 294);
        const b = c.game.userMolecule.addAtom('C', 378, 294);
        const d = c.game.userMolecule.addAtom('C', 420, 294);
        c.game.userMolecule.addBond(a.id, b.id, 1);
        c.game.userMolecule.addBond(b.id, d.id, 1);
        c.game.updateDrawing();
        c.dragBond(c.hitbox(1), { x: 399, y: 294 }, { x: 441, y: 294 });
        assert(near(d.x, 462) && near(d.y, 294), `伸長後の座標が (${d.x.toFixed(0)}, ${d.y.toFixed(0)})`);
        assert(c.game.userMolecule.bonds.length === 2, '伸長でトポロジーが変わった');
        c.game.undo();
        assert(near(c.game.userMolecule.atoms[2].x, 420), 'Undoで伸長前に戻らない');
        await c.tick(); // suppressBondClick フラグの解除を待つ
    });

    test('D2: 環内結合の伸縮は拒否される', async (c) => {
        c.reset();
        c.game.placeModule('cyclohexane', 400, 300, null);
        const positions = c.game.userMolecule.atoms.map(a => `${a.x.toFixed(0)},${a.y.toFixed(0)}`).join('|');
        const rb = c.game.userMolecule.bonds[0];
        const ra1 = c.game.userMolecule.atoms.find(a => a.id === rb.atomId1);
        const ra2 = c.game.userMolecule.atoms.find(a => a.id === rb.atomId2);
        const mid = { x: (ra1.x + ra2.x) / 2, y: (ra1.y + ra2.y) / 2 };
        c.dragBond(c.hitbox(0), mid, { x: mid.x + 42, y: mid.y });
        assert(c.D.getElementById('verify-result').textContent.includes('環の内部'), '拒否トーストが出ない');
        assert(c.game.userMolecule.atoms.map(a => `${a.x.toFixed(0)},${a.y.toFixed(0)}`).join('|') === positions,
            '環の原子が動いた');
        await c.tick();
    });

    test('D3: 縮小はグリッド下限42pxでクランプ', async (c) => {
        // 2原子のみの対称構成では動く側がID順で不定になるため、
        // 「小さい側＝末端C」が一意に動く3原子構成でテストする
        c.reset();
        const a = c.game.userMolecule.addAtom('C', 336, 294);
        const b = c.game.userMolecule.addAtom('C', 378, 294);
        const d = c.game.userMolecule.addAtom('C', 462, 294); // B-C 間は長さ84
        c.game.userMolecule.addBond(a.id, b.id, 1);
        c.game.userMolecule.addBond(b.id, d.id, 1);
        c.game.updateDrawing();
        c.dragBond(c.hitbox(1), { x: 420, y: 294 }, { x: 336, y: 294 }); // 内側へ大きくドラッグ
        const len = Math.hypot(b.x - d.x, b.y - d.y);
        assert(near(len, 42, 0.5), `縮小後の結合長が ${len.toFixed(1)}px（42を期待）`);
        assert(near(a.x, 336, 0.5) && near(b.x, 378, 0.5), '静止側の原子が動いた');
        await c.tick();
    });

    test('D4: 環への側鎖1本目は外向き二等分線上', async (c) => {
        c.reset();
        // v102: 自由配置の環中心はグリッドに丸められるため、グリッド整列点(420,294)を使う
        c.game.placeModule('cyclohexane', 420, 294, null);
        c.clickAt(420, 210);
        const s1 = c.game.userMolecule.atoms[6];
        assert(s1 && near(s1.x, 420) && near(s1.y, 210), '1本目が二等分線上に配置されない');
    });

    test('D5: 側鎖2本目は±30°振り分け・枝が平行移動で追随・Undo一括', async (c) => {
        c.reset();
        c.game.placeModule('cyclohexane', 420, 294, null);
        const v0 = c.game.userMolecule.atoms.find(a => near(a.x, 420, 1) && near(a.y, 252, 1));
        c.clickAt(420, 210); // S1
        const s1 = c.game.userMolecule.atoms[6];
        c.clickAt(420, 168); // S2（S1の枝）
        const s2 = c.game.userMolecule.atoms[7];
        c.clickAt(446, 240); // 2本目（-60°側）
        const newAtom = c.game.userMolecule.atoms[8];
        assert(newAtom && near(newAtom.x, 441) && near(newAtom.y, 215.6), '新原子が-60°側に配置されない');
        assert(near(s1.x, 399) && near(s1.y, 215.6), '既存側鎖が-120°側へ振り分けられない');
        assert(near(s2.x - s1.x, 0, 1) && near(s2.y - s1.y, -42, 1), '枝の相対位置が崩れた');
        assert(c.game.userMolecule.getBond(v0.id, s1.id) && c.game.userMolecule.getBond(v0.id, newAtom.id),
            '振り分けで結合が壊れた');
        c.game.undo();
        assert(near(c.game.userMolecule.atoms[6].x, 420, 1) && c.game.userMolecule.atoms.length === 8,
            'Undoで振り分け前に戻らない');
    });

    test('D6: 二等分線上にない既存側鎖は動かさない', async (c) => {
        c.reset();
        const ring = [];
        for (let i = 0; i < 6; i++) {
            const ang = i * Math.PI / 3 - Math.PI / 2;
            ring.push(c.game.userMolecule.addAtom('C', 400 + 42 * Math.cos(ang), 300 + 42 * Math.sin(ang)));
        }
        for (let i = 0; i < 6; i++) c.game.userMolecule.addBond(ring[i].id, ring[(i + 1) % 6].id, 1);
        const sub = c.game.userMolecule.addAtom('C',
            400 + 42 * Math.cos(-Math.PI / 3), 258 + 42 * Math.sin(-Math.PI / 3)); // -60°位置
        c.game.userMolecule.addBond(ring[0].id, sub.id, 1);
        c.game.updateDrawing();
        const pos = { x: sub.x, y: sub.y };
        c.clickAt(374, 233); // -120°側へ2本目
        const newAtom = c.game.userMolecule.atoms[7];
        assert(newAtom && near(newAtom.x, 379) && near(newAtom.y, 221.6), '-120°側に配置されない');
        assert(near(sub.x, pos.x, 0.5) && near(sub.y, pos.y, 0.5), '既存側鎖が動いた');
    });

    // ===== E. 反応機構ビューア =====

    test('E1: 反応モード進入で状態0＋巻矢印を描画（エテン+Br2）', async (c) => {
        c.reset();
        const rp = c.W.reactionPlayer;
        rp.checkMode.checked = true;
        rp.enter(0);
        assert(c.D.querySelectorAll('#atoms-group .svg-atom-node').length === 8, '状態0の原子数が8でない');
        assert(c.D.getElementById('arrows-group').children.length === 2, '巻矢印が2本でない');
        rp.exit();
    });

    test('E2: ステップ送り（電荷表示→最終状態）と離脱', async (c) => {
        c.reset();
        const rp = c.W.reactionPlayer;
        rp.checkMode.checked = true;
        rp.enter(0);
        c.D.getElementById('btn-rx-next').click();
        assert(c.D.querySelectorAll('.svg-charge').length === 2, '中間体の形式電荷が2個でない');
        c.D.getElementById('btn-rx-next').click();
        assert(c.D.getElementById('reaction-caption').textContent.includes('反応完了'), '最終状態にならない');
        assert(c.D.getElementById('arrows-group').children.length === 0, '最終状態で矢印が残る');
        rp.exit();
        assert(!rp.active && c.D.getElementById('arrows-group').children.length === 0, '離脱がクリーンでない');
    });

    test('E3: 生成物予測のターゲット＝主生成物（C2Br2・副生成物除外）', async (c) => {
        c.reset();
        const rp = c.W.reactionPlayer;
        rp.checkMode.checked = true;
        rp.enter(0);
        const target = rp.buildMainProductTarget();
        const elems = target.atoms.map(a => a.element).sort().join(',');
        assert(elems === 'Br,Br,C,C', `ターゲットが ${elems}（Br,Br,C,C を期待）`);
        rp.exit();
    });

    test('E4: 教科書反応データの整合性と新規3機構の通し再生', async (c) => {
        c.reset();
        const rp = c.W.reactionPlayer;
        assert(rp.reactions.length >= 9, `機構数が ${rp.reactions.length}（9以上を期待）`);

        // 全機構・全状態のデータ検証（結合添字・価標・原子数の状態間一致・矢印添字）
        const VAL = { H: 1, C: 4, O: 2, N: 3, Cl: 1, Br: 1, S: 6 };
        const expected = (a) => {
            let exp = VAL[a.element];
            if (a.charge === 1) exp += (a.element === 'N' || a.element === 'O') ? 1 : -1;
            else if (a.charge === -1) exp -= 1;
            if (a.radical) exp -= 1;
            return exp;
        };
        rp.reactions.forEach(rx => {
            rx.states.forEach((s, si) => {
                assert(s.atoms.length === rx.states[0].atoms.length,
                    `${rx.name} state${si}: 原子数がstate0と不一致`);
                const used = s.atoms.map(() => 0);
                s.bonds.forEach(b => {
                    assert(b.atom1Index < s.atoms.length && b.atom2Index < s.atoms.length,
                        `${rx.name} state${si}: 結合添字が範囲外`);
                    used[b.atom1Index] += b.type;
                    used[b.atom2Index] += b.type;
                });
                s.atoms.forEach((a, ai) => assert(used[ai] === expected(a),
                    `${rx.name} state${si} atom${ai}(${a.element}): 価標${used[ai]}≠${expected(a)}`));
            });
            rx.steps.forEach(st => {
                assert(st.from >= 0 && st.from < rx.states.length && st.to >= 0 && st.to < rx.states.length,
                    `${rx.name}: stepのfrom/toが範囲外`);
                const n = rx.states[st.from].atoms.length;
                st.arrows.forEach(ar => [ar.source, ar.target].forEach(end => {
                    (end.atoms || [end.index]).forEach(i => assert(i >= 0 && i < n,
                        `${rx.name}: 矢印の原子添字${i}が範囲外`));
                }));
            });
        });

        // v99以降に追加した全機構をステップ送りで最後まで再生
        for (let ri = 4; ri < rp.reactions.length; ri++) {
            rp.checkMode.checked = true;
            rp.enter(ri);
            for (let s = 0; s < rp.currentReaction.steps.length; s++) {
                c.D.getElementById('btn-rx-next').click();
            }
            assert(c.D.getElementById('reaction-caption').textContent.includes('反応完了'),
                `${rp.currentReaction.name} が最終状態に到達しない`);
            assert(c.D.getElementById('arrows-group').children.length === 0,
                `${rp.currentReaction.name} の最終状態で矢印が残る`);
            rp.exit();
        }
    });

    // ===== F. エクスポート =====

    test('F1: 作図エクスポートJSONのラウンドトリップ（エタノール）', async (c) => {
        c.reset();
        const c1 = c.game.userMolecule.addAtom('C', 360, 300);
        const c2 = c.game.userMolecule.addAtom('C', 402, 300);
        const o = c.game.userMolecule.addAtom('O', 444, 300);
        c.game.userMolecule.addBond(c1.id, c2.id, 1);
        c.game.userMolecule.addBond(c2.id, o.id, 1);
        c.game.updateDrawing();
        const json = c.game.buildExportJson();
        const parsed = JSON.parse(json);
        assert(parsed.target.atoms.length === 3 && parsed.target.bonds.length === 2, 'target構造が不正');
        const rebuilt = c.game.createTargetFromData({ target: parsed.target });
        assert(c.W.verifyMolecule(rebuilt, c.game.userMolecule), '書き出したtargetから元の分子を再現できない');
        assert(parsed.withHydrogens.atoms.length === 9, // 重原子3 + H6（エタノール）
            `withHydrogens の原子数が ${parsed.withHydrogens.atoms.length}（9を期待）`);
        assert(parsed.withHydrogens.bonds.length === 8, 'withHydrogens の結合数が8でない');
    });

    test('F2: 化合物名判定と分子式のライブ表示（P7-6）', async (c) => {
        c.reset();
        const nameEl = () => c.D.getElementById('compound-name').textContent;
        const formulaEl = () => c.D.getElementById('compound-formula').textContent;

        // 空のキャンバス
        assert(nameEl() === '—' && formulaEl() === '—', '空キャンバスの表示が—でない');

        // メタン（C 1個 → compounds.json から）
        c.game.userMolecule.addAtom('C', 400, 300);
        c.game.updateDrawing();
        assert(nameEl() === 'メタン', `メタンが「${nameEl()}」と判定`);
        assert(formulaEl() === 'CH₄', `メタンの分子式が「${formulaEl()}」`);

        // エタノール（ステージ由来の名前）
        c.game.userMolecule = new c.W.Molecule();
        const c1 = c.game.userMolecule.addAtom('C', 360, 300);
        const c2 = c.game.userMolecule.addAtom('C', 402, 300);
        const o = c.game.userMolecule.addAtom('O', 444, 300);
        c.game.userMolecule.addBond(c1.id, c2.id, 1);
        c.game.userMolecule.addBond(c2.id, o.id, 1);
        c.game.updateDrawing();
        assert(nameEl() === 'エタノール', `エタノールが「${nameEl()}」と判定`);
        assert(formulaEl() === 'C₂H₆O', `エタノールの分子式が「${formulaEl()}」`);

        // ベンゼン（どちらのケクレ位相でも判定される）
        c.game.userMolecule = new c.W.Molecule();
        const ring = [];
        for (let i = 0; i < 6; i++) ring.push(c.game.userMolecule.addAtom('C', 400 + 42 * Math.cos(i * Math.PI / 3), 300 + 42 * Math.sin(i * Math.PI / 3)));
        for (let i = 0; i < 6; i++) c.game.userMolecule.addBond(ring[i].id, ring[(i + 1) % 6].id, i % 2 === 0 ? 1 : 2);
        c.game.updateDrawing();
        assert(nameEl() === 'ベンゼン', `ベンゼンが「${nameEl()}」と判定`);

        // 三員環エーテル（オキシラン）はライブラリ入り済み → 酸化エチレンと命名される
        c.game.userMolecule = new c.W.Molecule();
        const o1 = c.game.userMolecule.addAtom('C', 380, 300);
        const o2 = c.game.userMolecule.addAtom('C', 422, 300);
        const o3 = c.game.userMolecule.addAtom('O', 400, 264);
        c.game.userMolecule.addBond(o1.id, o2.id, 1);
        c.game.userMolecule.addBond(o2.id, o3.id, 1);
        c.game.userMolecule.addBond(o3.id, o1.id, 1);
        c.game.updateDrawing();
        assert(nameEl() === '酸化エチレン（エチレンオキシド）', `オキシランが「${nameEl()}」と判定`);

        // 未収録構造（アジリジン: C-C-N 三員環）→ 該当なし＋分子式は表示
        c.game.userMolecule = new c.W.Molecule();
        const a1 = c.game.userMolecule.addAtom('C', 380, 300);
        const a2 = c.game.userMolecule.addAtom('C', 422, 300);
        const a3 = c.game.userMolecule.addAtom('N', 400, 264);
        c.game.userMolecule.addBond(a1.id, a2.id, 1);
        c.game.userMolecule.addBond(a2.id, a3.id, 1);
        c.game.userMolecule.addBond(a3.id, a1.id, 1);
        c.game.updateDrawing();
        assert(nameEl() === '（ライブラリに該当なし）', `未収録構造が「${nameEl()}」と判定`);
        assert(formulaEl() === 'C₂H₅N', `アジリジンの分子式が「${formulaEl()}」`);
    });

    test('F3: シス/トランスの判定と命名区別（P8-1）', async (c) => {
        c.reset();
        const nameEl = () => c.D.getElementById('compound-name').textContent;
        const G = c.W.getDoubleBondGeometry;

        // トランス-2-ブテン（メチル基がC=C軸の反対側）
        const build2Butene = (y1, y4) => {
            const m = new c.W.Molecule();
            const a1 = m.addAtom('C', 379, y1);
            const a2 = m.addAtom('C', 379, 300);
            const a3 = m.addAtom('C', 421, 300);
            const a4 = m.addAtom('C', 421, y4);
            m.addBond(a1.id, a2.id, 1);
            m.addBond(a2.id, a3.id, 2);
            m.addBond(a3.id, a4.id, 1);
            return m;
        };
        assert(G(build2Butene(258, 342)) === 'trans', 'トランス描画がtransと判定されない');
        assert(G(build2Butene(258, 258)) === 'cis', 'シス描画がcisと判定されない');

        // 直線描画は未指定（null）
        const linear = new c.W.Molecule();
        const l1 = linear.addAtom('C', 337, 300);
        const l2 = linear.addAtom('C', 379, 300);
        const l3 = linear.addAtom('C', 421, 300);
        const l4 = linear.addAtom('C', 463, 300);
        linear.addBond(l1.id, l2.id, 1);
        linear.addBond(l2.id, l3.id, 2);
        linear.addBond(l3.id, l4.id, 1);
        assert(G(linear) === null, '直線描画がnullにならない');

        // 対象外: プロペン（1置換）・エテン（無置換）は null
        const propene = new c.W.Molecule();
        const p1 = propene.addAtom('C', 358, 300);
        const p2 = propene.addAtom('C', 400, 300);
        const p3 = propene.addAtom('C', 442, 300);
        propene.addBond(p1.id, p2.id, 2);
        propene.addBond(p2.id, p3.id, 1);
        assert(G(propene) === null, 'プロペン（1置換）がnullにならない');

        // 命名: トランス描画 → トランス-2-ブテン
        c.game.userMolecule = build2Butene(258, 342);
        c.game.updateDrawing();
        assert(nameEl() === 'トランス-2-ブテン', `トランス描画の名称が「${nameEl()}」`);

        // 命名: シス描画 → シス-2-ブテン
        c.game.userMolecule = build2Butene(258, 258);
        c.game.updateDrawing();
        assert(nameEl() === 'シス-2-ブテン', `シス描画の名称が「${nameEl()}」`);

        // 命名: 直線描画 → 2-ブテン（幾何未指定のためステージ名にフォールバック）
        c.game.userMolecule = linear;
        c.game.updateDrawing();
        assert(nameEl() === '2-ブテン', `直線描画の名称が「${nameEl()}」`);

        // マレイン酸／フマル酸も描き分けで命名が変わる（P8-6追加分の幾何エントリ）
        const buildButenedioic = (y2, y5) => {
            const m = new c.W.Molecule();
            const c2 = m.addAtom('C', 379, 300);
            const c3 = m.addAtom('C', 421, 300);
            const c1 = m.addAtom('C', 379, y2);
            const od1 = m.addAtom('O', 337, y2);
            const oh1 = m.addAtom('O', y2 < 300 ? 379 : 379, y2 < 300 ? y2 - 42 : y2 + 42);
            const c4 = m.addAtom('C', 421, y5);
            const od2 = m.addAtom('O', 463, y5);
            const oh2 = m.addAtom('O', 421, y5 < 300 ? y5 - 42 : y5 + 42);
            m.addBond(c2.id, c3.id, 2);
            m.addBond(c2.id, c1.id, 1);
            m.addBond(c1.id, od1.id, 2);
            m.addBond(c1.id, oh1.id, 1);
            m.addBond(c3.id, c4.id, 1);
            m.addBond(c4.id, od2.id, 2);
            m.addBond(c4.id, oh2.id, 1);
            return m;
        };
        c.game.userMolecule = buildButenedioic(258, 258); // 同じ側 = シス
        c.game.updateDrawing();
        assert(nameEl() === 'マレイン酸', `シス描画が「${nameEl()}」`);
        c.game.userMolecule = buildButenedioic(258, 342); // 反対側 = トランス
        c.game.updateDrawing();
        assert(nameEl() === 'フマル酸', `トランス描画が「${nameEl()}」`);
    });

    test('F4: 「同じ化合物？」クイズの生成と判定（P8-3）', async (c) => {
        c.reset();
        const quiz = c.W.quiz;
        assert(quiz, 'quiz が初期化されていない');
        quiz.buildLibrary();

        // 「違う」問題のペア健全性: 同分子式・別トポロジーのみ
        assert(quiz.differentPairs.length >= 5, `異性体ペアが ${quiz.differentPairs.length} 組（5組以上を期待）`);
        quiz.differentPairs.forEach(([i, j]) => {
            assert(quiz.library[i].formula === quiz.library[j].formula, '異分子式のペアが混入');
            assert(!c.W.verifyMolecule(quiz.library[i].mol, quiz.library[j].mol), '同一トポロジーのペアが混入');
        });

        // 表記変換はトポロジーを保存する（全ライブラリ×全強度）
        quiz.library.forEach(e => {
            [0, 1, 2].forEach(strength => {
                const t = quiz.transformDepiction(e.target, strength);
                const m = c.game.createTargetFromData({ target: t });
                assert(c.W.verifyMolecule(m, e.mol), `表記変換(強度${strength})でトポロジーが壊れた: ${e.name}`);
            });
        });

        // 出題20回: 判定はverifyMolecule由来で、名前の同一性と常に整合。両図が描画される
        quiz.open();
        for (let k = 0; k < 20; k++) {
            quiz.nextQuestion();
            assert(quiz.current.isSame === (quiz.current.nameA === quiz.current.nameB),
                `出題${k}: 判定と名前の不整合 (${quiz.current.nameA} / ${quiz.current.nameB})`);
            assert(c.D.querySelector('#quiz-svg-a .quiz-atoms').children.length > 0, '左の図が空');
            assert(c.D.querySelector('#quiz-svg-b .quiz-atoms').children.length > 0, '右の図が空');
        }

        // 回答フロー: 正答で成績加算・結果表示・ボタン無効化
        quiz.nextQuestion();
        const before = quiz.score.correct;
        quiz.answer(quiz.current.isSame);
        assert(quiz.score.correct === before + 1, '正答が加算されない');
        assert(c.D.getElementById('quiz-result').textContent.includes('正解'), '結果の解説が表示されない');
        assert(c.D.getElementById('btn-quiz-same').disabled, '回答後に回答ボタンが無効化されない');

        c.D.getElementById('btn-quiz-close').click();
        assert(c.D.getElementById('quiz-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('F5: 命名クイズの生成と回答フロー（P8-4）', async (c) => {
        c.reset();
        const nq = c.W.namingQuiz;
        assert(nq, 'namingQuiz が初期化されていない');
        nq.build();

        // 出題プール: トポロジー重複で正解が一意に決まらないエントリ（2-ブテン系）は除外される
        const poolNames = nq.pool.map(i => nq.library[i].name);
        assert(poolNames.length >= 70, `出題プールが ${poolNames.length} 件`);
        ['2-ブテン', 'シス-2-ブテン', 'トランス-2-ブテン'].forEach(n => {
            assert(!poolNames.includes(n), `曖昧なエントリ「${n}」が出題プールに残っている`);
        });

        // 出題20回: 選択肢は4件・重複なし・正解をちょうど1つ含む・図が描画される
        nq.open();
        let c7Checked = false;
        for (let k = 0; k < 20; k++) {
            nq.nextQuestion();
            const choices = nq.current.choices;
            assert(choices.length === 4, `選択肢が ${choices.length} 件`);
            assert(new Set(choices).size === 4, '選択肢に重複がある');
            assert(choices.filter(n => n === nq.current.entry.name).length === 1, '正解が選択肢にちょうど1つ含まれていない');
            assert(c.D.querySelector('#naming-svg .quiz-atoms').children.length > 0, '問題の図が空');
            // C7H16（異性体9種）の出題では、誤答3つがすべて同分子式（異性体名）になるはず
            if (!c7Checked && nq.current.entry.formula === 'C₇H₁₆') {
                const names = new Map(nq.library.map(e => [e.name, e.formula]));
                choices.forEach(n => {
                    assert(names.get(n) === 'C₇H₁₆', `C7H16の問題に他分子式の選択肢「${n}」`);
                });
                c7Checked = true;
            }
        }

        // 回答フロー: 正答で加算・解説表示・ボタン無効化と正解のハイライト
        nq.nextQuestion();
        const before = nq.score.correct;
        const correctBtn = [...c.D.getElementById('naming-choices').children]
            .find(b => b.textContent === nq.current.entry.name);
        correctBtn.click();
        assert(nq.score.correct === before + 1, '正答が加算されない');
        assert(c.D.getElementById('naming-result').textContent.includes('正解'), '解説が表示されない');
        assert([...c.D.getElementById('naming-choices').children].every(b => b.disabled), '回答後に選択肢が無効化されない');

        c.D.getElementById('btn-naming-close').click();
        assert(c.D.getElementById('naming-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('F10: クイズの変形は「主鎖を曲げる」を優先する（伸びただけの問題を減らす）', async (c) => {
        // 立体を名前に反映するトグルは**既定 OFF**（2026-08-02）。ここは立体命名そのものを
        // 見るテストなので明示的に ON にする（UI の既定値にテストを依存させない）
        c.game.setReadStereo(true);
        const W = c.W, g = c.game;
        // ユーザー指摘「結合が伸びただけの問題が出やすい」。実測すると強度2で
        // 一直線の分子の53%が「一直線のまま伸びただけ」だった。
        // 原因は屈曲の候補から**回す側が1原子の場合を除外**していたこと。
        // 炭素3個の鎖（プロパン・ジメチルエーテル等）は端の1原子を回すしか曲げようがない
        const collinear = (atoms) => {
            const h = atoms.filter(a => a.element !== 'H');
            if (h.length < 3) return true;
            return new Set(h.map(a => Math.round(a.y))).size === 1 ||
                   new Set(h.map(a => Math.round(a.x))).size === 1;
        };
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []).filter(e => e.target);
        // 重原子3個以上の直鎖（＝曲げられるはずの分子）
        const straight = source.filter(e => collinear(e.target.atoms) &&
            e.target.atoms.filter(a => a.element !== 'H').length >= 3);
        assert(straight.length >= 20, `検査対象の直鎖が少なすぎる（${straight.length}件）`);
        let still = 0, total = 0, topoBad = 0;
        straight.forEach(e => {
            const base = W.canonicalCode(g.createTargetFromData({ target: e.target }));
            for (let k = 0; k < 10; k++) {
                const t = W.transformCompoundDepiction(e.target, 2);
                total++;
                if (collinear(t.atoms)) still++;
                if (W.canonicalCode(g.createTargetFromData({ target: t })) !== base) topoBad++;
            }
        });
        assert(topoBad === 0, `変形でトポロジーが変わった（${topoBad}件）`);
        const rate = still / total;
        assert(rate < 0.25, `一直線のままの割合が ${(rate * 100).toFixed(0)}%（25%未満を期待。修正前は58%）`);
        // 3原子の鎖が実際に曲がること
        ['プロパン', 'ジメチルエーテル'].forEach(nm => {
            const e = source.find(x => x.name === nm && x.target);
            if (!e) return;
            let bent = 0;
            for (let k = 0; k < 12; k++) if (!collinear(W.transformCompoundDepiction(e.target, 2).atoms)) bent++;
            assert(bent > 0, `${nm} が一度も曲がらない（炭素3個の鎖は端の1原子を回して曲げられるはず）`);
        });
        // 立体は壊さない（v242 の保証が1原子の屈曲でも効いていること）
        ['シス-2-ブテン', 'トランス-2-ブテン', 'D-アラニン', 'β-D-グルコース（β-D-グルコピラノース）']
            .forEach(nm => {
                const e = source.find(x => x.name === nm && x.target);
                assert(e, `${nm} がライブラリに無い`);
                const readOf = (tg) => {
                    const info = W.readStereoOf(g.createTargetFromData({ target: tg }));
                    return info ? info.stereoCode : null;
                };
                const base = readOf(e.target);
                assert(base !== null, `${nm} の立体が読めない（テストの前提が崩れている）`);
                for (let k = 0; k < 10; k++) {
                    assert(readOf(W.transformCompoundDepiction(e.target, 2)) === base,
                        `${nm}: 1原子の屈曲で立体が変わった`);
                }
            });
    });

    test('LB7: 名称ライブラリ第3弾B（ベンゼン二置換体は o-/m-/p- の全108通りで名前が出る）', async (c) => {
        const g = c.game, W = c.W;
        // 環モジュール1回＋官能基2回＝3タップで作れる形。**どれを描いても名前が返る**ことを固定する
        const CX = 400, CY = 300, RB = 40;
        const RING = [[440, 300], [420, 334.64], [380, 334.64], [360, 300], [380, 265.36], [420, 265.36]];
        const RING_BONDS = [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]];
        // [元素, 追加原子の並び, 付け根からの結合] の形で官能基を持つ（添字0が付け根）
        const GROUPS = {
            '-OH': { els: ['O'], bonds: [] },
            '-COOH': { els: ['C', 'O', 'O'], bonds: [[0, 1, 2], [0, 2, 1]] },
            '-NH2': { els: ['N'], bonds: [] },
            '-NO2': { els: ['N', 'O', 'O'], bonds: [[0, 1, 2], [0, 2, 1]] },
            '-SO3H': { els: ['S', 'O', 'O', 'O'], bonds: [[0, 1, 2], [0, 2, 2], [0, 3, 1]] },
            '-Cl': { els: ['Cl'], bonds: [] },
            '-Br': { els: ['Br'], bonds: [] },
            '-CH3': { els: ['C'], bonds: [] }
        };
        const KEYS = Object.keys(GROUPS);
        // 判定はトポロジーだけなので、ここでの座標は「原子が同じ点に重ならない」程度でよい
        const build = (a, b, offset) => {
            const atoms = RING.map(([x, y]) => ({ element: 'C', x, y }));
            const bonds = RING_BONDS.map(([i, j, type]) => ({ atom1Index: i, atom2Index: j, type }));
            [[0, a], [offset, b]].forEach(([ri, key]) => {
                const v = atoms[ri];
                const ux = (v.x - CX) / RB, uy = (v.y - CY) / RB;
                const base = atoms.length;
                GROUPS[key].els.forEach((el, k) => atoms.push({
                    element: el,
                    x: v.x + 42 * ux * (k + 1) + (k ? 42 * -uy * (k - 1.5) : 0),
                    y: v.y + 42 * uy * (k + 1) + (k ? 42 * ux * (k - 1.5) : 0)
                }));
                bonds.push({ atom1Index: ri, atom2Index: base, type: 1 });
                GROUPS[key].bonds.forEach(([i, j, type]) =>
                    bonds.push({ atom1Index: base + i, atom2Index: base + j, type }));
            });
            return g.createTargetFromData({ target: { atoms, bonds } });
        };
        const unnamed = [], names = new Map();
        [1, 2, 3].forEach(offset => {
            for (let i = 0; i < KEYS.length; i++) for (let j = i; j < KEYS.length; j++) {
                const mol = build(KEYS[i], KEYS[j], offset);
                const nm = g.lookupCompoundName(mol);
                const label = `${['', 'o-', 'm-', 'p-'][offset]}${KEYS[i]}/${KEYS[j]}`;
                if (!nm) { unnamed.push(label); continue; }
                const code = W.canonicalCode(mol);
                if (names.has(nm) && names.get(nm) !== code) unnamed.push(`${label} が「${nm}」と名前を取り合う`);
                names.set(nm, code);
            }
        });
        assert(unnamed.length === 0, `名前が出ない二置換ベンゼン: ${unnamed.join(', ')}`);
        assert(names.size === 108, `108通りが ${names.size} 種の名前にしかならない（別々の構造が同じ名前を名乗っている）`);
        // 慣用名が優先される組み合わせ（ライブラリを先に引く順序が効いていること。§1）
        [['-OH', '-COOH', 1, 'サリチル酸'], ['-COOH', '-NH2', 1, 'アントラニル酸（o-アミノ安息香酸）'],
            ['-OH', '-CH3', 3, 'p-クレゾール'], ['-COOH', '-COOH', 2, 'イソフタル酸'],
            ['-NH2', '-SO3H', 3, 'スルファニル酸（p-アミノベンゼンスルホン酸）'],
            ['-COOH', '-NO2', 2, 'm-ニトロ安息香酸'], ['-NH2', '-CH3', 3, 'p-トルイジン'],
            ['-SO3H', '-CH3', 3, 'p-トルエンスルホン酸']].forEach(([a, b, off, want]) => {
            const got = g.lookupCompoundName(build(a, b, off));
            assert(got === want, `${a}/${b}（${off}）が「${want}」でなく「${got}」`);
        });
    });

    test('LB8: 名称ライブラリ第3弾C（重原子4〜5個の鎖状・複素環。数え上げで出た穴）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        [
            'シアン化水素', '亜硝酸', '炭酸',
            'プロピオニトリル（プロパンニトリル）',
            'ブチロニトリル（ブタンニトリル）', 'エチルメチルアミン', 'イソプロピルアミン',
            'ブチルアミン', 'sec-ブチルアミン', 'イソブチルアミン',
            'tert-ブチルアミン', 'メチルプロピルアミン', 'イソプロピルメチルアミン',
            'アリルアミン（2-プロペン-1-アミン）', '2-アミノエタノール（エタノールアミン）', 'エチレンジアミン',
            'プロピオンアミド', 'N-メチルアセトアミド', 'N,N-ジメチルホルムアミド（DMF）',
            'アクリルアミド', 'グリコールアルデヒド（ヒドロキシアセトアルデヒド）', 'グリオキサール',
            '2-メチルプロパナール（イソブチルアルデヒド）', 'クロトンアルデヒド（2-ブテナール）', 'メチルビニルケトン（3-ブテン-2-オン）',
            'グリコール酸（ヒドロキシ酢酸）', 'グリオキシル酸', 'アリルアルコール（2-プロペン-1-オール）',
            'プロパルギルアルコール（2-プロピン-1-オール）', '2-ブテン-1-オール（クロチルアルコール）', '3-ブテン-1-オール',
            'メチルビニルエーテル', 'フラン', 'ピロール',
            'イミダゾール', '1,3-シクロペンタジエン'
        ].forEach(nm => {
            assert(g.lookupCompoundName(targetOf(nm)) === nm, `${nm} が正しく命名されない`);
        });
        // 不飽和アルコールは v625 で iupacName が命名できるようになった（設計書 §9.6-3）。
        // **ライブラリ登録はそのまま残す**——慣用名（アリルアルコール・クロチルアルコール・
        // プロパルギルアルコール）は系統名からは出ないので、ライブラリが先に引かれる意味がある
        [['アリルアルコール（2-プロペン-1-オール）', '2-プロペン-1-オール'],
            ['プロパルギルアルコール（2-プロピン-1-オール）', '2-プロピン-1-オール'],
            ['2-ブテン-1-オール（クロチルアルコール）', '2-ブテン-1-オール'],
            ['3-ブテン-1-オール', '3-ブテン-1-オール']].forEach(([nm, systematic]) => {
            assert(W.iupacName(targetOf(nm)) === systematic,
                `${nm} の系統名が「${W.iupacName(targetOf(nm))}」（${systematic} を期待）`);
        });
        // 不飽和エーテルは今も命名器の守備範囲外（アルケニル基「ビニル」の名前が要る。
        // DEVELOPMENT.md の申し送り）。ライブラリが拾っていることを命名器の null と合わせて押さえる
        assert(W.iupacName(targetOf('メチルビニルエーテル')) === null,
            'メチルビニルエーテルを iupacName が命名できるなら、テストの前提を見直すこと');
        // 五員複素環は環内のヘテロ原子を取り違えていないこと（芳香族として二重結合が交互）。
        // チオフェンは §9.6-6 が直った v622 で登録した（LB11 が見る）
        [['フラン', 'O'], ['ピロール', 'N']].forEach(([nm, el]) => {
            const mol = targetOf(nm);
            assert(mol.atoms.length === 5, `${nm} が五員環でない`);
            assert(mol.atoms.filter(a => a.element === el).length === 1, `${nm} の環内 ${el} が1個でない`);
            assert(mol.bonds.filter(b => b.type === 2).length === 2, `${nm} の二重結合が2本でない`);
        });
        assert(targetOf('イミダゾール').atoms.filter(a => a.element === 'N').length === 2,
            'イミダゾールの N が2個でない');
        // N は =O と -O を両方持つときだけ4価が許される（開発方針4章2）。
        // ニトロメタン・ニトロエタンは v622 で登録した（LB11 が見る）ので、ここでは亜硝酸だけ
        ['亜硝酸'].forEach(nm => {
            const mol = targetOf(nm);
            const n = mol.atoms.find(a => a.element === 'N');
            assert(W.isValencyValid(mol, n.id), `${nm} の N が価標超過`);
        });
        // C4H11N のアミン異性体（第1〜3級）がすべて別の名前で引けること
        const c4 = ['ブチルアミン', 'sec-ブチルアミン', 'イソブチルアミン', 'tert-ブチルアミン',
            'メチルプロピルアミン', 'イソプロピルメチルアミン'].map(nm => W.canonicalCode(targetOf(nm)));
        assert(new Set(c4).size === 6, 'C4H11N のアミン6件のうち同じ構造のものがある');
    });

    test('F9: 「同じ化合物？」クイズが出題の前提を明示する（立体の種類を取り違えない）', async (c) => {
        const W = c.W, g = c.game, D = c.D;
        const quiz = W.compoundQuiz || W.quiz;
        assert(quiz && typeof quiz.showPremise === 'function', '前提表示の仕組みが無い');
        quiz.open();
        const premiseFor = (name) => {
            const e = quiz.library.find(x => x.name === name);
            assert(e, `${name} がクイズのプールに無い`);
            const m1 = g.createTargetFromData({ target: e.target });
            const m2 = g.createTargetFromData({ target: e.target });
            quiz.showPremise(m1, m2);
            return D.getElementById('quiz-premise').textContent;
        };
        // 立体の種類を取り違えないこと。**シス/トランスはフィッシャー投影ではない**
        // （シス-2-ブテンを「フィッシャー投影」と表示してしまった実例がある）
        const cis = premiseFor('シス-2-ブテン');
        assert(/シス・トランス/.test(cis), `シス-2-ブテンの前提が違う（${cis}）`);
        assert(!/フィッシャー/.test(cis), 'シス/トランスをフィッシャー投影と書いている');
        const ala = premiseFor('D-アラニン');
        assert(/フィッシャー投影/.test(ala), `D-アラニンの前提が違う（${ala}）`);
        const glc = premiseFor('β-D-グルコース（β-D-グルコピラノース）');
        assert(/ハース図/.test(glc), `ピラノースの前提が違う（${glc}）`);
        assert(!/フィッシャー/.test(glc), '環の立体をフィッシャー投影と書いている');
        const plain = premiseFor('酢酸');
        assert(/平面の構造式/.test(plain), `立体を持たない分子の前提が違う（${plain}）`);
        // どの場合も「つながり方だけを見る」ことは共通で書く（正解は verifyMolecule で決まる）
        [cis, ala, glc].forEach(t => assert(/つながり方/.test(t), '判定の基準が書かれていない'));
        // 実際の出題でも必ず何か表示される（空のままにならない）
        quiz.seriesEl.value = '';
        quiz.strengthEl.value = '2';
        quiz.computePools();
        for (let k = 0; k < 12; k++) {
            quiz.nextQuestion();
            assert((D.getElementById('quiz-premise').textContent || '').length > 10,
                '出題時に前提が表示されない');
        }
    });

    test('F6: クイズ調整 — シリーズ絞り込み・強度・構造ポイント解説（P8-5）', async (c) => {
        c.reset();
        const quiz = c.W.quiz;
        const nq = c.W.namingQuiz;
        quiz.buildLibrary();
        nq.build();

        // describeStructure の要約が主要官能基・骨格を検出する
        const byName = (n) => quiz.library.find(e => e.name === n);
        const pts = (n) => c.W.describeStructure(byName(n).mol);
        assert(pts('酢酸').includes('カルボキシ基 -COOH ×1'), `酢酸: ${pts('酢酸').join('、')}`);
        assert(pts('酢酸').includes('最長の炭素鎖 C2'), '酢酸の最長鎖がC2でない');
        assert(pts('トルエン').includes('ベンゼン環'), 'トルエンにベンゼン環が出ない');
        assert(pts('アセトン').includes('ケトンの C=O ×1'), `アセトン: ${pts('アセトン').join('、')}`);
        assert(pts('ジエチルエーテル').includes('エーテル結合 -O- ×1'), 'エーテルが検出されない');
        assert(pts('アセトニトリル').includes('ニトリル基 -C≡N ×1'), 'ニトリルが検出されない');

        // 同じ化合物？クイズ: シリーズ絞り込みで出題が範囲内に限定される。
        // **シリーズ名は直書きしない**（ラインナップを組み替えると落ちる。実際に一度落ちた）。
        // 選択肢に実在する中から、出題に足る数がある1つを選ぶ
        quiz.open();
        const countBySeries = {};
        quiz.library.forEach(e => { countBySeries[e.series] = (countBySeries[e.series] || 0) + 1; });
        const optionSeries = [...quiz.seriesEl.options].map(o => o.value).filter(v => v && countBySeries[v] >= 4);
        assert(optionSeries.length > 0, 'クイズの絞り込みに使えるシリーズが無い');
        const pickSeries = optionSeries[0];
        // 同じ化合物が複数のシリーズに載ることがあるので、**名前→シリーズの逆引きはしない**
        // （逆引きだと後に読み込んだ側のシリーズが返り、範囲内なのに範囲外と判定される）
        const namesIn = new Set(quiz.library.filter(e => e.series === pickSeries).map(e => e.name));
        quiz.seriesEl.value = pickSeries;
        quiz.computePools();
        for (let k = 0; k < 15; k++) {
            quiz.nextQuestion();
            assert(namesIn.has(quiz.current.nameA) && namesIn.has(quiz.current.nameB),
                `絞り込み外の出題（${pickSeries}）: ${quiz.current.nameA} / ${quiz.current.nameB}`);
        }
        // 強度0/2でも出題が動作し、回答解説に構造ポイントが含まれる
        quiz.strengthEl.value = '0';
        quiz.nextQuestion();
        quiz.strengthEl.value = '2';
        quiz.nextQuestion();
        quiz.answer(quiz.current.isSame);
        const qText = c.D.getElementById('quiz-result').textContent;
        assert(qText.includes('構造のポイント') || qText.includes('左:'), '同じ化合物？クイズの解説に構造ポイントがない');

        // 命名クイズ: シリーズ絞り込み＋解説の構造ポイント
        nq.open();
        const nqOptions = [...nq.seriesEl.options].map(o => o.value).filter(v => v && countBySeries[v] >= 4);
        assert(nqOptions.length > 0, '命名クイズの絞り込みに使えるシリーズが無い');
        const nqSeries = nqOptions[nqOptions.length - 1];
        nq.seriesEl.value = nqSeries;
        nq.computePool();
        for (let k = 0; k < 10; k++) {
            nq.nextQuestion();
            assert(nq.current.entry.series === nqSeries,
                `絞り込み外の出題（${nqSeries}）: ${nq.current.entry.name}`);
        }
        nq.nextQuestion();
        const okBtn = [...c.D.getElementById('naming-choices').children]
            .find(b => b.textContent === nq.current.entry.name);
        okBtn.click();
        assert(c.D.getElementById('naming-result').textContent.includes('構造のポイント'),
            '命名クイズの解説に構造ポイントがない');

        // 後片付け: 設定を既定に戻してモーダルを閉じる
        quiz.seriesEl.value = 'all';
        quiz.strengthEl.value = '1';
        quiz.computePools();
        nq.seriesEl.value = 'all';
        nq.strengthEl.value = '1';
        nq.computePool();
        c.D.getElementById('btn-quiz-close').click();
        c.D.getElementById('btn-naming-close').click();
        assert(c.D.getElementById('quiz-modal').classList.contains('hidden') &&
               c.D.getElementById('naming-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('F7: 正準コード — 同値⇔コード一致の性質と不斉判定の厳密化（P8-2）', async (c) => {
        c.reset();
        const CC = c.W.canonicalCode;
        c.W.quiz.buildLibrary();
        const lib = c.W.quiz.library;
        const codes = lib.map(e => CC(e.mol));

        // 1. 原子順を逆順・シャッフルで組み替えても同一コード（全ライブラリ）
        const rebuildPermuted = (target, perm) => {
            const m = new c.W.Molecule();
            const added = new Array(target.atoms.length);
            perm.forEach(origIdx => {
                added[origIdx] = m.addAtom(target.atoms[origIdx].element, target.atoms[origIdx].x, target.atoms[origIdx].y);
            });
            target.bonds.forEach(b => m.addBond(added[b.atom1Index].id, added[b.atom2Index].id, b.type));
            return m;
        };
        lib.forEach((e, ei) => {
            const n = e.target.atoms.length;
            const reversed = Array.from({ length: n }, (_, i) => n - 1 - i);
            const shuffled = Array.from({ length: n }, (_, i) => i);
            for (let i = n - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            assert(CC(rebuildPermuted(e.target, reversed)) === codes[ei], `逆順で不一致: ${e.name}`);
            assert(CC(rebuildPermuted(e.target, shuffled)) === codes[ei], `シャッフルで不一致: ${e.name}`);
        });

        // 2. 同分子式グループ内の全ペアで（コード一致 ⇔ グラフ同型）
        for (let i = 0; i < lib.length; i++) {
            for (let j = i + 1; j < lib.length; j++) {
                if (lib[i].formula !== lib[j].formula) continue;
                const same = c.W.verifyMolecule(lib[i].mol, lib[j].mol);
                assert((codes[i] === codes[j]) === same,
                    `コードと同型判定の不一致: ${lib[i].name} vs ${lib[j].name}`);
            }
        }

        // 3. ケクレ位相不変（o-キシレンの両位相が同一コード）
        const buildOXylene = (attachBase) => {
            const u = new c.W.Molecule();
            const ring = [];
            for (let i = 0; i < 6; i++) ring.push(u.addAtom('C', 400 + 42 * Math.cos(i * Math.PI / 3), 300 + 42 * Math.sin(i * Math.PI / 3)));
            for (let i = 0; i < 6; i++) u.addBond(ring[i].id, ring[(i + 1) % 6].id, i % 2 === 0 ? 2 : 1);
            u.addBond(ring[attachBase].id, u.addAtom('C', 500, 300).id, 1);
            u.addBond(ring[attachBase + 1].id, u.addAtom('C', 500, 350).id, 1);
            return u;
        };
        assert(CC(buildOXylene(0)) === CC(buildOXylene(1)), 'ケクレ位相でコードが変わった');

        // 4. 非連結・同一成分の繰り返しでも爆発せず順序不変（正準化ハング退行の再発防止）
        const buildDisc = (reverse) => {
            const m = new c.W.Molecule();
            if (!reverse) m.addAtom('C', 336, 294);
            const xs = [];
            for (let x = 372; x <= 428; x += 6) xs.push(x);
            if (reverse) xs.reverse();
            xs.forEach(x => {
                const n1 = m.addAtom('N', x, 273);
                const n2 = m.addAtom('N', x, 231);
                m.addBond(n1.id, n2.id, 3);
            });
            if (reverse) m.addAtom('C', 336, 294);
            return m;
        };
        const tDisc = performance.now();
        const discCode = CC(buildDisc(false));
        assert(performance.now() - tDisc < 500, `非連結分子の正準コードが遅すぎる (${Math.round(performance.now() - tDisc)}ms)`);
        assert(CC(buildDisc(true)) === discCode, '非連結分子の順序不変性が壊れている');

        // 5. 不斉判定の厳密化後の回帰
        const molOf = (n) => lib.find(e => e.name === n).mol;
        const ala = molOf('アラニン');
        assert(ala.isAsymmetricCarbon(ala.atoms[1].id), 'アラニンα炭素が不斉でない');
        assert(!ala.isAsymmetricCarbon(ala.atoms[0].id), 'アラニンのメチル炭素が不斉と誤判定');
        const lactic = molOf('乳酸');
        assert(lactic.isAsymmetricCarbon(lactic.atoms[1].id), '乳酸の中心炭素が不斉でない');
        const mhx = molOf('3-メチルヘキサン');
        assert(mhx.isAsymmetricCarbon(mhx.atoms[2].id), '3-メチルヘキサンのC3が不斉でない');
        // 環を含む置換基: メチルシクロヘキサンの環結合炭素は左右対称なので不斉ではない
        const mch = new c.W.Molecule();
        const ring = [];
        for (let i = 0; i < 6; i++) {
            const ang = i * Math.PI / 3 - Math.PI / 2;
            ring.push(mch.addAtom('C', 400 + 42 * Math.cos(ang), 300 + 42 * Math.sin(ang)));
        }
        for (let i = 0; i < 6; i++) mch.addBond(ring[i].id, ring[(i + 1) % 6].id, 1);
        mch.addBond(ring[0].id, mch.addAtom('C', 400, 216).id, 1);
        assert(!mch.isAsymmetricCarbon(ring[0].id), 'メチルシクロヘキサンの環炭素が不斉と誤判定');
    });

    test('F8: 名称ライブラリの全化合物が自己命名でき・構造が一意（P12-3 命名拡充の整合）', async (c) => {
        const g = c.game, W = c.W;
        const lib = g.getCompoundLibrary();
        // (1) すべての compounds.json エントリが lookupCompoundName で「同じ構造の名前」に命名できる
        const nameFails = [];
        W.COMPOUNDS.forEach(entry => {
            const mol = g.createTargetFromData({ target: entry.target });
            const name = g.lookupCompoundName(mol);
            if (!name) { nameFails.push(`${entry.name}(命名不可)`); return; }
            const hit = lib.find(e => e.name === name);
            if (!hit || hit.code !== W.canonicalCode(mol)) nameFails.push(`${entry.name}→${name}`);
        });
        assert(nameFails.length === 0, `自己命名に失敗: ${nameFails.join(', ')}`);
        // (2) ライブラリ全体（STAGES＋COMPOUNDS）で「同一構造＋同一立体」に別名が無い＝命名が一意
        // 立体指定エントリは事前計算した立体コードで区別する（P12-7 M1 で geometry を統合）
        const keyMap = new Map();
        lib.forEach(e => {
            const key = e.code + '|' + (e.stereoCode || '-');
            if (!keyMap.has(key)) keyMap.set(key, []);
            keyMap.get(key).push(e.name);
        });
        const dupes = [...keyMap.values()].filter(v => v.length > 1);
        assert(dupes.length === 0, `同一構造に複数の名前: ${dupes.map(v => v.join('=')).join(' / ')}`);
        // (3) P12-3 で追加した代表化合物が実在し命名できる
        ['酢酸メチル', 'コハク酸（ブタン二酸）', 'トリメチルアミン', 'アセトアミド'].forEach(nm => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            assert(g.lookupCompoundName(g.createTargetFromData({ target: entry.target })) === nm,
                `${nm} が正しく命名されない`);
        });
    });

    test('LB1: 名称ライブラリ第1弾（v460）が名前で引ける・オレイン酸はシスでだけ名乗る', async (c) => {
        const g = c.game, W = c.W;
        // (1) DESIGN_compound_coverage.md §4 の17件。消えたら気づけるように名前で押さえる
        ['ナトリウムフェノキシド（フェノールのナトリウム塩）', 'ベンゼンスルホン酸ナトリウム',
            'サリチル酸ナトリウム', '安息香酸ナトリウム', 'ギ酸ナトリウム', 'オレイン酸', 'メタクリル酸',
            '酢酸フェニル', 'ギ酸エチル', '安息香酸エチル', 'ペンタナール（吉草アルデヒド）',
            'アクロレイン（プロペナール）', 'カテコール（o-ジヒドロキシベンゼン）',
            'レゾルシノール（m-ジヒドロキシベンゼン）', 'm-ジニトロベンゼン', 'ブロモベンゼン',
            'グリシルグリシン（ジペプチド）'].forEach(nm => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            assert(g.lookupCompoundName(g.createTargetFromData({ target: entry.target })) === nm,
                `${nm} が正しく命名されない`);
        });
        // (2) オレイン酸のシスは **座標** で効いている（stereo.bondGeo と図が食い違っていない）。
        // C=C の片方の枝を反対側へ移すとトランスに読め、オレイン酸を名乗らなくなること
        const oleic = W.COMPOUNDS.find(e => e.name === 'オレイン酸');
        const mol = g.createTargetFromData({ target: oleic.target });
        assert(Object.values(W.readBondGeoFromCoords(mol)).join() === 'syn',
            'オレイン酸の図がシスに読めない');
        mol.atoms[12].y = 384; // C10 側の枝（C11）を C=C の反対側へ
        assert(Object.values(W.readBondGeoFromCoords(mol)).join() === 'anti',
            '枝を反対側へ移してもトランスに読めない');
        assert(g.lookupCompoundName(mol) !== 'オレイン酸', 'トランスに描いた図がオレイン酸を名乗る');
    });

    test('LB2: 名称ライブラリ第2弾①（トリオレイン・ニトログリセリン・二糖4件）', async (c) => {
        const g = c.game, W = c.W;
        const TRIOLEIN = 'トリオレイン（油脂・オレイン酸のグリセリド）';
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        const at = (mol, x, y) => {
            const a = mol.atoms.find(p => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5);
            assert(a, `(${x},${y}) に原子が無い（図を変えたらこのテストも直す）`);
            return a;
        };
        const saved = g.readStereo;
        g.setReadStereo(true);
        try {
            // (1) DESIGN_compound_coverage.md §4 の第2弾①。消えたら気づけるように名前で押さえる
            [TRIOLEIN, 'ニトログリセリン', 'マルトース（麦芽糖）', 'セロビオース',
                'ラクトース（乳糖）', 'スクロース（ショ糖）'].forEach(nm => {
                assert(g.lookupCompoundName(targetOf(nm)) === nm, `${nm} が正しく命名されない`);
            });
            // (2) トリオレインの3本の C=C はぜんぶシス。1本でも反対側へ移すと名乗らなくなる
            //     （オレイン酸3本ぶんの図が、硬化油の説明の主役として正しく読めていること）
            assert(Object.values(W.readBondGeoFromCoords(targetOf(TRIOLEIN))).join() === 'syn,syn,syn',
                'トリオレインの3本が全部シスに読めない');
            const flipped = targetOf(TRIOLEIN);
            at(flipped, 620, 150).y = 234; // 1本目の C11 を C=C の反対側へ
            assert(Object.values(W.readBondGeoFromCoords(flipped)).join() === 'anti,syn,syn',
                '枝を反対側へ移してもトランスに読めない');
            assert(g.lookupCompoundName(flipped) !== TRIOLEIN, '1本トランスの図がトリオレインを名乗る');
            // (3) 二糖はグリコシド結合の向きで区別される。橋のOを還元末端側で切ると、
            //     残った側が「何をつないだか」＝結合の α/β を単糖の名前で言う
            [[ 'マルトース（麦芽糖）', 500, 414, 542, 300, 'α-D-グルコース（α-D-グルコピラノース）'],
                ['セロビオース', 500, 262, 500, 186, 'β-D-グルコース（β-D-グルコピラノース）'],
                ['ラクトース（乳糖）', 500, 262, 500, 186, 'β-D-ガラクトース（β-D-ガラクトピラノース）'],
                ['スクロース（ショ糖）', 600, 276, 540, 382, 'α-D-グルコース（α-D-グルコピラノース）']
            ].forEach(([nm, ox, oy, cx, cy, expect]) => {
                const mol = targetOf(nm);
                const o = at(mol, ox, oy), cc = at(mol, cx, cy);
                mol.bonds = mol.bonds.filter(b => !((b.atomId1 === o.id && b.atomId2 === cc.id) ||
                    (b.atomId2 === o.id && b.atomId1 === cc.id)));
                g.userMolecule = mol;
                const names = g.splitMolecules().map(p => g.lookupCompoundName(p));
                assert(names.includes(expect), `${nm} を切ると ${expect} が出るはずが ${names.join('/')}`);
            });
            // (4) マルトース・セロビオース・ラクトースは構造が同じで立体だけが違う。
            //     ここが潰れると F8 の「同一構造に複数の名前」で落ちる
            const lib = g.getCompoundLibrary();
            const three = ['マルトース（麦芽糖）', 'セロビオース', 'ラクトース（乳糖）']
                .map(nm => lib.find(e => e.name === nm));
            assert(new Set(three.map(e => e.code)).size === 1, '二糖3件の正準コードが揃っていない');
            assert(new Set(three.map(e => e.stereoCode)).size === 3, '二糖3件の立体コードが区別できていない');
        } finally {
            g.userMolecule = new W.Molecule();
            g.setReadStereo(saved);
        }
    });

    test('LB3: 名称ライブラリ第2弾B（教科書の一覧表に残っていたアミノ酸5件）', async (c) => {
        const g = c.game, W = c.W;
        // 主鎖は横置き（DESIGN_compound_coverage.md §5.3-9）。側鎖だけが違う5件
        ['アスパラギン', 'グルタミン', 'トレオニン（スレオニン）', 'イソロイシン', 'プロリン'].forEach(nm => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            const mol = g.createTargetFromData({ target: entry.target });
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            // アミノ酸として検出できること（-NH2 と -COOH が両方ある。プロリンは環状イミノ酸）
            assert(mol.atoms.some(a => a.element === 'N') && mol.atoms.some(a => a.element === 'O'),
                `${nm} に N と O が無い`);
        });
        // プロリンだけは主鎖の N が環に入っている（横置きの規約に当てはまらない例外）
        const pro = g.createTargetFromData({ target: W.COMPOUNDS.find(e => e.name === 'プロリン').target });
        assert(W.findAnyCycle(pro), 'プロリンが環になっていない');
        assert(pro.getNeighbors(pro.atoms.find(a => a.element === 'N').id).length === 2,
            'プロリンの N が環の一員になっていない');
    });

    test('LB4: 名称ライブラリ第2弾C1（芳香族・脂環の②）', async (c) => {
        const g = c.game, W = c.W;
        ['メチルシクロヘキサン', 'メシチレン（1,3,5-トリメチルベンゼン）',
            '塩化ベンジル（ベンジルクロリド）', '2,4-ジニトロフェノール', 'サリチルアルデヒド',
            'p-トルエンスルホン酸', 'p-フェニレンジアミン', 'ベンズアミド', 'サリチル酸エチル',
            'o-ジクロロベンゼン（オルトジクロロベンゼン）', 'm-ジクロロベンゼン（メタジクロロベンゼン）'
        ].forEach(nm => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            assert(g.lookupCompoundName(g.createTargetFromData({ target: entry.target })) === nm,
                `${nm} が正しく命名されない`);
        });
        // 三置換ベンゼンの位置関係が o-/m-/p- で取り違えられていないこと。
        // 置換基どうしの距離は オルト 82px < メタ 142px < パラ 164px（環の半径40・置換基82）
        const gapOf = (nm) => {
            const mol = g.createTargetFromData({ target: W.COMPOUNDS.find(e => e.name === nm).target });
            const cl = mol.atoms.filter(a => a.element === 'Cl');
            return Math.round(Math.hypot(cl[0].x - cl[1].x, cl[0].y - cl[1].y));
        };
        const o = gapOf('o-ジクロロベンゼン（オルトジクロロベンゼン）');
        const mm = gapOf('m-ジクロロベンゼン（メタジクロロベンゼン）');
        const p = gapOf('p-ジクロロベンゼン（パラジクロロベンゼン）');
        assert(o < mm && mm < p, `オルト(${o}) < メタ(${mm}) < パラ(${p}) になっていない`);
        // 2,4-ジニトロフェノールのニトロ基は N(=O)(-O)。N(=O)(=O) で描くと価標超過になる
        const dnp = g.createTargetFromData({ target: W.COMPOUNDS.find(e => e.name === '2,4-ジニトロフェノール').target });
        dnp.atoms.filter(a => a.element === 'N').forEach(n => {
            const nb = dnp.getNeighbors(n.id).filter(x => x.atom.element === 'O');
            assert(nb.length === 2 && nb.some(x => x.type === 2) && nb.some(x => x.type === 1),
                'ニトロ基が N(=O)(-O) になっていない');
        });
        assert(dnp.atoms.every(a => W.isValencyValid(dnp, a.id)), '2,4-ジニトロフェノールに価標超過がある');
        // p-トルエンスルホン酸の S は S=O を持つので6価（K5 の文脈依存の価数）
        const tos = g.createTargetFromData({ target: W.COMPOUNDS.find(e => e.name === 'p-トルエンスルホン酸').target });
        const s = tos.atoms.find(a => a.element === 'S');
        assert(W.maxValencyOf(tos, s.id) === 6, 'スルホ基の S が6価と判定されない');
        assert(tos.getFreeValency(s.id) === 0, 'スルホ基の S に空き価標が残っている');
    });

    test('LB5: 名称ライブラリ第2弾C2（鎖状の②・2-ペンテンはシス/トランスで名乗り分ける）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        const saved = g.readStereo;
        g.setReadStereo(true);
        try {
            ['2-ペンタノン', 'ジエチルアミン', 'プロピルアミン', 'ホルムアミド', 'クエン酸', 'リンゴ酸',
                'ラウリン酸', 'ミリスチン酸', 'オレイン酸ナトリウム（セッケン）', '酢酸ブチル',
                'プロピオン酸エチル', 'シス-2-ペンテン', 'トランス-2-ペンテン'].forEach(nm => {
                assert(g.lookupCompoundName(targetOf(nm)) === nm, `${nm} が正しく命名されない`);
            });
            // 2-ペンテンは**図の形だけ**でシス/トランスが決まる（stereo.bondGeo と図が食い違わない）
            assert(Object.values(W.readBondGeoFromCoords(targetOf('シス-2-ペンテン'))).join() === 'syn',
                'シス-2-ペンテンの図がシスに読めない');
            assert(Object.values(W.readBondGeoFromCoords(targetOf('トランス-2-ペンテン'))).join() === 'anti',
                'トランス-2-ペンテンの図がトランスに読めない');
            // 立体トグルが OFF でも、シス/トランスは名前に残る（2026-08-02 の決定）
            g.setReadStereo(false);
            assert(g.lookupCompoundName(targetOf('シス-2-ペンテン')) === 'シス-2-ペンテン',
                '立体トグル OFF でシス-2-ペンテンが名乗らなくなった');
            assert(g.lookupCompoundName(targetOf('トランス-2-ペンテン')) === 'トランス-2-ペンテン',
                '立体トグル OFF でトランス-2-ペンテンが名乗らなくなった');
            g.setReadStereo(true);
            // オレイン酸ナトリウムも C=C はシスのまま（オレイン酸＋Na）
            assert(Object.values(W.readBondGeoFromCoords(targetOf('オレイン酸ナトリウム（セッケン）'))).join() === 'syn',
                'オレイン酸ナトリウムの C=C がシスに読めない');
            // ラウリン酸・ミリスチン酸は直鎖の飽和脂肪酸。炭素数を取り違えていないこと
            [['ラウリン酸', 12], ['ミリスチン酸', 14]].forEach(([nm, n]) => {
                const mol = targetOf(nm);
                assert(mol.atoms.filter(a => a.element === 'C').length === n, `${nm} の炭素が ${n} 個でない`);
            });
        } finally {
            g.setReadStereo(saved);
        }
    });

    test('LB10: リノール酸・リノレン酸がシスの折れ線で入っている（§6-4・ユーザー判断）', async (c) => {
        const g = c.game, W = c.W;
        // ユーザーの決定（2026-08-04）:
        //   「必要になるのは**融点判断・ヨウ素価**を視覚的に実感するときだけ。
        //    したがって**結合角は 120° のもの以外は必要ない**」
        // ＝ 直交格子に載せる必要はない。**折れ曲がった形が正しいこと**だけを見張る。
        const cases = [
            ['リノール酸', 2],
            ['リノレン酸（α-リノレン酸）', 3]
        ];
        cases.forEach(([nm, nDouble]) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            const mol = g.createTargetFromData({ target: entry.target });
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);

            // (1) **図から読んだ幾何**が、本数も向きも一致する。
            //     ⚠ 本数を数えないと、1本も読めていないとき `every` が空配列で真になり
            //     「すべてシス」と誤って緑になる（実際に作業中これに引っかかった）
            const geo = W.readBondGeoFromCoords(mol);
            const vals = Object.values(geo);
            assert(vals.length === nDouble,
                `${nm}: 読めた二重結合が ${vals.length} 本（${nDouble} 本のはず）`);
            assert(vals.every(v => v === 'syn'), `${nm}: シスでない二重結合がある（${vals}）`);

            // (2) 結合長は 42px でそろい、重原子どうしは監査のしきい値 24px を割らない
            const len = (b) => {
                const a1 = mol.atoms.find(a => a.id === b.atomId1);
                const a2 = mol.atoms.find(a => a.id === b.atomId2);
                return Math.hypot(a1.x - a2.x, a1.y - a2.y);
            };
            assert(mol.bonds.every(b => Math.abs(len(b) - 42) < 0.5),
                `${nm}: 結合長が 42px でそろっていない`);
            let min = Infinity;
            for (let i = 0; i < mol.atoms.length; i++) {
                for (let j = i + 1; j < mol.atoms.length; j++) {
                    min = Math.min(min, Math.hypot(mol.atoms[i].x - mol.atoms[j].x,
                                                  mol.atoms[i].y - mol.atoms[j].y));
                }
            }
            assert(min >= 24, `${nm}: 重原子どうしが ${Math.round(min * 10) / 10}px（24px 未満）`);
        });

        // (3) **負の対照**: 二重結合まわりの枝を反対側へ移すとトランスに読める
        //     ＝ シスの判定が座標で効いていることの裏取り（宣言だけで通っていない）
        const lino = W.COMPOUNDS.find(e => e.name === 'リノール酸');
        const mol = g.createTargetFromData({ target: lino.target });
        const geo0 = W.readBondGeoFromCoords(mol);
        const firstKey = Object.keys(geo0)[0];
        const [id1] = firstKey.split('_atom_').length > 1
            ? [firstKey.slice(0, firstKey.lastIndexOf('_atom_'))] : [null];
        assert(id1, '二重結合のキーを解釈できない');
        const a1 = mol.atoms.find(a => a.id === id1);
        const other = mol.getNeighbors(a1.id).find(n => n.type === 2 && n.atom.element === 'C');
        assert(other, '二重結合の相手が見つからない');
        // その炭素につながる「二重結合ではない」隣を、**二重結合の軸で鏡映して**反対側へ移す。
        // ⚠ 単に y を折り返す（`nb.atom.y = 2*a1.y - nb.atom.y`）と、軸が斜め（±120°）のときに
        //    枝が軸の上へ乗ってしまい readBondGeoFromCoords が「描き分けていない」として飛ばす。
        //    **原子IDは乱数**で、キーの前半（atomId1）が二重結合のどちら端になるかは実行ごとに
        //    変わるので、この折り返し方だと 1/2 の確率で undefined になり**テストが揺れていた**
        //    （2026-08-04・v620 で修正。IDの順序に頼らない＝MEMORY の chem-atom-id-hazard）
        const nb = mol.getNeighbors(a1.id).find(n => n.type === 1 && n.atom.element === 'C');
        assert(nb, '折り返す枝が見つからない');
        const ax = other.atom.x - a1.x, ay = other.atom.y - a1.y;
        const alen = Math.hypot(ax, ay) || 1;
        const ux = ax / alen, uy = ay / alen;
        const vx = nb.atom.x - a1.x, vy = nb.atom.y - a1.y;
        const dot = vx * ux + vy * uy;
        nb.atom.x = a1.x + 2 * dot * ux - vx;
        nb.atom.y = a1.y + 2 * dot * uy - vy;
        const geo1 = W.readBondGeoFromCoords(mol);
        assert(geo1[firstKey] === 'anti',
            `枝を反対側へ移してもトランスに読めない（${geo1[firstKey]}）`);
    });

    test('LB11: ニトロメタン・ニトロエタン・チオフェン（§9.6-6 が直って登録できたもの）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // この3件は作図も命名もできていたのに、**異性体列挙の価数モデルが本体と食い違っていた**ため
        // audit.html のライブラリ検査「自分自身が列挙結果に含まれない」で落ち、登録を見送っていた
        // （DESIGN_compound_coverage.md §12 の末尾）。v621 で列挙器を直したので入れられる。
        [['ニトロメタン', 'CH₃NO₂'], ['ニトロエタン', 'C₂H₅NO₂'], ['チオフェン', 'C₄H₄S']]
            .forEach(([nm, formula]) => {
                const mol = targetOf(nm);
                assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
                assert(g.computeMolecularFormula(mol) === formula,
                    `${nm} の分子式が ${g.computeMolecularFormula(mol)}（${formula} を期待）`);
                // **監査の受け入れ条件そのもの**: 自分自身が同じ分子式の列挙結果に含まれる
                const heavy = mol.atoms.filter(a => a.element !== 'H');
                const hCount = heavy.reduce((s, a) => s + mol.getFreeValency(a.id), 0);
                const r = W.enumerateConstitutionalIsomers(heavy.map(a => a.element), hCount);
                assert(!r.overflow, `${nm}: 列挙が打ち切られた`);
                const self = W.canonicalCode(mol);
                assert(r.isomers.some(m => W.canonicalCode(m) === self),
                    `${nm} が異性体列挙（${r.isomers.length}種）に含まれない`);
            });
        // ニトロ基は N(=O)(-O)（価標超過の N(=O)(=O) は禁止・開発方針4章2）。
        // 単結合Oには水素が付かない＝ニトロメタンの水素は3個（getFreeValency の特例）
        ['ニトロメタン', 'ニトロエタン'].forEach(nm => {
            const mol = targetOf(nm);
            const n = mol.atoms.find(a => a.element === 'N');
            assert(W.isValencyValid(mol, n.id), `${nm} の N が価標超過`);
            assert(mol.getUsedValency(n.id) === 4, `${nm} の N が4本使っていない`);
            const sglO = mol.getNeighbors(n.id).find(x => x.type === 1 && x.atom.element === 'O');
            assert(sglO && mol.getFreeValency(sglO.atom.id) === 0,
                `${nm} のニトロ基の単結合Oに水素が付いている`);
        });
        // チオフェンの S は S=O を持たないので2価（6価のままだと余分な水素が描かれる）
        const thio = targetOf('チオフェン');
        const s = thio.atoms.find(a => a.element === 'S');
        assert(W.maxValencyOf(thio, s.id) === 2, 'チオフェンの S が2価でない');
        assert(thio.getFreeValency(s.id) === 0, 'チオフェンの S に空き価標が残っている');
        assert(thio.atoms.length === 5 && thio.bonds.filter(b => b.type === 2).length === 2,
            'チオフェンが五員環・二重結合2本になっていない');
    });

    test('LB12: 名称ライブラリ第4弾A（鎖状の C=O。エステル・カルボン酸・アルデヒド・ケトン）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // **手数ではなく原子数で範囲を広げた分**（DESIGN_compound_coverage.md §15）。
        // C=O を持つので iupacName は null を返す＝登録しないと名前が出ない
        const names = [
            'ギ酸プロピル', 'ギ酸イソプロピル', 'ギ酸ブチル', 'ギ酸イソブチル',
            'ギ酸sec-ブチル', 'ギ酸tert-ブチル', '酢酸イソプロピル', '酢酸イソブチル',
            '酢酸sec-ブチル', '酢酸tert-ブチル', '酢酸ペンチル（酢酸アミル）',
            'プロピオン酸プロピル', 'プロピオン酸イソプロピル', 'プロピオン酸ブチル',
            '酪酸メチル（ブタン酸メチル）', '酪酸プロピル（ブタン酸プロピル）', '酪酸ブチル（ブタン酸ブチル）',
            'イソ酪酸メチル（2-メチルプロパン酸メチル）', 'イソ酪酸エチル（2-メチルプロパン酸エチル）',
            '吉草酸メチル（ペンタン酸メチル）', '吉草酸エチル（ペンタン酸エチル）',
            'アクリル酸メチル', 'アクリル酸エチル', 'メタクリル酸エチル',
            'シュウ酸ジメチル', 'シュウ酸ジエチル', 'マロン酸ジエチル',
            'ヘキサン酸（カプロン酸）', 'ヘプタン酸（エナント酸）', 'オクタン酸（カプリル酸）',
            'ノナン酸（ペラルゴン酸）', 'デカン酸（カプリン酸）', '2-メチルブタン酸',
            'イソ吉草酸（3-メチルブタン酸）', 'ピバル酸（2,2-ジメチルプロパン酸）',
            'クロトン酸（2-ブテン酸）', 'ビニル酢酸（3-ブテン酸）', '3-ヒドロキシプロパン酸（ヒドラクリル酸）',
            'ピメリン酸（ヘプタン二酸）', 'スベリン酸（オクタン二酸）', 'セバシン酸（デカン二酸）',
            'ヘキサナール', 'ヘプタナール', '2-メチルブタナール',
            '3-メチルブタナール（イソバレルアルデヒド）', '2,2-ジメチルプロパナール（ピバルアルデヒド）',
            '2-ヘキサノン（メチルブチルケトン）', '3-ヘキサノン（エチルプロピルケトン）',
            '2-ヘプタノン（メチルペンチルケトン）', '3-メチル-2-ブタノン（メチルイソプロピルケトン）',
            '4-メチル-2-ペンタノン（メチルイソブチルケトン）', '2,3-ブタンジオン（ジアセチル）',
            '2,4-ペンタンジオン（アセチルアセトン）', 'ヒドロキシアセトン（アセトール）', 'ジヒドロキシアセトン',
            'シクロブタノン', 'シクロヘプタノン', 'ブタンアミド（酪酸アミド）',
            'N,N-ジメチルアセトアミド（DMAc）', '無水プロピオン酸', '無水コハク酸',
            '塩化アセチル（アセチルクロリド）'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
        });
        // 入試の定番: C5H10O2 のエステル9種がそろい、**構造がすべて違う**
        const c5esters = ['ギ酸ブチル', 'ギ酸イソブチル', 'ギ酸sec-ブチル', 'ギ酸tert-ブチル',
            '酢酸プロピル', '酢酸イソプロピル', 'プロピオン酸エチル',
            '酪酸メチル（ブタン酸メチル）', 'イソ酪酸メチル（2-メチルプロパン酸メチル）'];
        const c5codes = new Set(c5esters.map(nm => {
            const mol = targetOf(nm);
            assert(g.computeMolecularFormula(mol) === 'C₅H₁₀O₂',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            return W.canonicalCode(mol);
        }));
        assert(c5codes.size === c5esters.length,
            `C₅H₁₀O₂ のエステルに同じ構造が混ざっている（${c5codes.size}/${c5esters.length}）`);
        // 同じく C5H10O のカルボニル化合物（アルデヒド4種＋ケトン3種）
        const c5carbonyl = ['ペンタナール（吉草アルデヒド）', '2-メチルブタナール',
            '3-メチルブタナール（イソバレルアルデヒド）', '2,2-ジメチルプロパナール（ピバルアルデヒド）',
            '2-ペンタノン', '3-ペンタノン（ジエチルケトン）', '3-メチル-2-ブタノン（メチルイソプロピルケトン）'];
        const c5cCodes = new Set(c5carbonyl.map(nm => {
            const mol = targetOf(nm);
            assert(g.computeMolecularFormula(mol) === 'C₅H₁₀O',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            return W.canonicalCode(mol);
        }));
        assert(c5cCodes.size === c5carbonyl.length,
            `C₅H₁₀O のカルボニル化合物に同じ構造が混ざっている（${c5cCodes.size}/${c5carbonyl.length}）`);
    });

    test('LB13: α/β-D-フルクトフラノースがアノマーとして区別される（§6-3・ユーザー決定 案b）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        const A = 'α-D-フルクトフラノース', B = 'β-D-フルクトフラノース';
        const saved = g.readStereo;
        g.setReadStereo(true);
        try {
            // (1) 2件とも名乗る。**これが立つこと自体が拡張の成果**——拡張前は C2 が読めず、
            //     両方登録すると同じコードに2つの名前が付いて F8 が落ちていた（§6-3 の制約）
            [A, B].forEach(nm => {
                assert(g.lookupCompoundName(targetOf(nm)) === nm, `${nm} が正しく命名されない`);
                assert(g.computeMolecularFormula(targetOf(nm)) === 'C₆H₁₂O₆',
                    `${nm} の分子式が ${g.computeMolecularFormula(targetOf(nm))}`);
            });
            // (2) 構造（骨格）は同じで、立体コードだけが違う＝正真正銘のアノマー対
            const lib = g.getCompoundLibrary();
            const pair = [A, B].map(nm => lib.find(e => e.name === nm));
            assert(new Set(pair.map(e => e.code)).size === 1,
                'α/β の正準コードが違う（骨格が同じ図になっていない）');
            assert(new Set(pair.map(e => e.stereoCode)).size === 2,
                'α/β の立体コードが同じ（アノマーを区別できていない）');
            // (3) 違いは**アノマー炭素1つだけ**。環の C3・C4・C5 は α と β で同じでなければ、
            //     図のどこかを余分に描き分けてしまっている
            const parOf = nm => {
                const e = W.COMPOUNDS.find(x => x.name === nm);
                const mol = g.createTargetFromData({ target: e.target });
                const p = W.readRingParityFromHaworth(mol);
                const out = {};
                Object.keys(p).forEach(id => { out[mol.atoms.findIndex(a => a.id === id)] = p[id]; });
                return out;
            };
            const pa = parOf(A), pb = parOf(B);
            assert(Object.keys(pa).length === 4 && Object.keys(pb).length === 4,
                `環の不斉中心4つが読めていない（α:${Object.keys(pa).length} β:${Object.keys(pb).length}）`);
            const diff = Object.keys(pa).filter(k => pa[k] !== pb[k]);
            assert(diff.join() === '1',
                `α/β の違いがアノマー炭素（添字1）だけになっていない（違う添字: ${diff.join()}）`);

            // (4) **スクロースとの突き合わせ**。グリコシド結合を**グルコース側**で切ると、
            //     橋の O はフルクトース側に残って -OH になる ＝ 切り出した断片は
            //     **β-D-フルクトフラノースそのもの**でなければならない。
            //     LB2 は同じ結合を反対側で切って「α-D-グルコピラノース」を確かめている。
            //     両側から挟むことで、スクロースの図が構成単位まで正しいことが立つ。
            //     ※ v710 まではフルクトース環の C3・C4 が裏返っていて、ここが α でも β でも
            //       なかった（アノマー C2 が読めなかったので誰も気づけなかった）
            const suc = targetOf('スクロース（ショ糖）');
            const at = (mol, x, y) => {
                const a = mol.atoms.find(p => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5);
                assert(a, `(${x},${y}) に原子が無い（図を変えたらこのテストも直す）`);
                return a;
            };
            const o = at(suc, 600, 276), glcC1 = at(suc, 600, 200);
            suc.bonds = suc.bonds.filter(b => !((b.atomId1 === o.id && b.atomId2 === glcC1.id) ||
                (b.atomId2 === o.id && b.atomId1 === glcC1.id)));
            g.userMolecule = suc;
            const names = g.splitMolecules().map(p => g.lookupCompoundName(p));
            assert(names.includes(B),
                `スクロースをグルコース側で切っても ${B} が出ない（${names.join('/')}）`);
            assert(!names.includes(A), `切り出した断片が ${A} を名乗る（アノマーが逆）`);
        } finally {
            g.userMolecule = new W.Molecule();
            g.setReadStereo(saved);
        }
    });

    test('LB16: 名称ライブラリ第4弾B-1（小さい鎖状の穴。ハロゲン化カルボン酸・アミン・ニトリルほか）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // **原子数の小さい順に埋めた分**（DESIGN_compound_coverage.md §15）。
        // どれも iupacName が命名を諦める形なので、登録しないと名前が出ない
        const names = [
            'クロロ酢酸（モノクロロ酢酸）', 'ジクロロ酢酸', 'トリクロロ酢酸', 'ブロモ酢酸',
            '2-クロロプロピオン酸（2-クロロプロパン酸）', '3-クロロプロピオン酸（3-クロロプロパン酸）',
            '2-ブロモプロピオン酸（2-ブロモプロパン酸）',
            'グリセリン酸（2,3-ジヒドロキシプロパン酸）', '2-ヒドロキシ酪酸（α-ヒドロキシ酪酸）',
            '3-ヒドロキシ酪酸（β-ヒドロキシ酪酸）', '4-ヒドロキシ酪酸（γ-ヒドロキシ酪酸）',
            '2-オキソ酪酸（α-ケト酪酸）', 'レブリン酸（4-オキソペンタン酸）', 'オキサロ酢酸',
            'α-ケトグルタル酸（2-オキソグルタル酸）', 'アゼライン酸（ノナン二酸）',
            'メチルマロン酸（2-メチルプロパン二酸）',
            'ペンチルアミン（アミルアミン）', 'イソペンチルアミン（イソアミルアミン）', 'ヘキシルアミン',
            'ジプロピルアミン', 'ジイソプロピルアミン', 'ジブチルアミン', 'トリエチルアミン',
            'エチルジメチルアミン（N,N-ジメチルエチルアミン）', 'ジエチルメチルアミン（N-メチルジエチルアミン）',
            '1,3-プロパンジアミン（トリメチレンジアミン）', '1,4-ブタンジアミン（プトレシン）',
            '1,5-ペンタンジアミン（カダベリン）',
            '2-メトキシエタノール（メチルセロソルブ）', '2-エトキシエタノール（セロソルブ）', 'ジエチレングリコール',
            'メタンスルホン酸', 'エタンスルホン酸',
            'バレロニトリル（ペンタンニトリル）', 'マロノニトリル（プロパンジニトリル）',
            'スクシノニトリル（ブタンジニトリル）',
            'アセトンシアノヒドリン（2-ヒドロキシ-2-メチルプロパンニトリル）',
            '乳酸ニトリル（アセトアルデヒドシアノヒドリン）',
            '1-ニトロプロパン', '2-ニトロプロパン',
            'オキサミド（シュウ酸ジアミド）', 'マロンアミド（マロン酸ジアミド）',
            '1,4-ジオキサン', 'ピラジン（1,4-ジアジン）', 'ピリミジン（1,3-ジアジン）',
            'プロピオン酸ナトリウム', '乳酸ナトリウム', 'シュウ酸ナトリウム',
            'ラウリン酸ナトリウム（セッケン）', 'ミリスチン酸ナトリウム（セッケン）', 'ラウリン酸メチル'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
        });
        // 酸の強さの比較で並べる酢酸のハロゲン置換体は、構造がすべて違う
        const haloAcids = ['クロロ酢酸（モノクロロ酢酸）', 'ジクロロ酢酸', 'トリクロロ酢酸', 'ブロモ酢酸'];
        const haloCodes = new Set(haloAcids.map(nm => W.canonicalCode(targetOf(nm))));
        assert(haloCodes.size === haloAcids.length,
            `ハロゲン化酢酸に同じ構造が混ざっている（${haloCodes.size}/${haloAcids.length}）`);
        // C₄H₈O₃ のヒドロキシ酪酸3種（α/β/γ）が分子式そろい・構造は別
        const hydroxy = ['2-ヒドロキシ酪酸（α-ヒドロキシ酪酸）', '3-ヒドロキシ酪酸（β-ヒドロキシ酪酸）',
            '4-ヒドロキシ酪酸（γ-ヒドロキシ酪酸）'];
        const hydroxyCodes = new Set(hydroxy.map(nm => {
            const mol = targetOf(nm);
            assert(g.computeMolecularFormula(mol) === 'C₄H₈O₃',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            return W.canonicalCode(mol);
        }));
        assert(hydroxyCodes.size === hydroxy.length,
            `ヒドロキシ酪酸に同じ構造が混ざっている（${hydroxyCodes.size}/${hydroxy.length}）`);
        // C₆H₁₅N のアミン（1級・2級・3級）が分子式そろい・構造は別
        const c6amines = ['ヘキシルアミン', 'ジプロピルアミン', 'ジイソプロピルアミン', 'トリエチルアミン'];
        const c6codes = new Set(c6amines.map(nm => {
            const mol = targetOf(nm);
            assert(g.computeMolecularFormula(mol) === 'C₆H₁₅N',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            return W.canonicalCode(mol);
        }));
        assert(c6codes.size === c6amines.length,
            `C₆H₁₅N のアミンに同じ構造が混ざっている（${c6codes.size}/${c6amines.length}）`);
    });

    test('LB14: 名称ライブラリ第4弾B-2（芳香族の穴。側鎖・芳香族カルボニル・三置換体・縮合環）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // §11 が埋めたのは「ベンゼン二置換体（8官能基の組み合わせ）」だけで、
        // 側鎖が2炭素を超えるもの・C=O を持つもの・三置換体・縮合環は残っていた
        const names = [
            'プロピルベンゼン', 'ブチルベンゼン', 'tert-ブチルベンゼン',
            'α-メチルスチレン（2-フェニルプロペン）', 'アリルベンゼン（3-フェニルプロペン）',
            '1,2,3-トリメチルベンゼン（ヘミメリテン）', '1,2,4-トリメチルベンゼン（プソイドクメン）',
            'ビフェニル', 'ジフェニルメタン', 'アントラセン', 'フェナントレン',
            'ベンゾフェノン（ジフェニルケトン）', 'プロピオフェノン（フェニルエチルケトン）',
            '塩化ベンゾイル（ベンゾイルクロリド）', '無水安息香酸', '安息香酸プロピル',
            '安息香酸フェニル', '安息香酸ベンジル', '酢酸ベンジル',
            'フェニル酢酸', 'フェニル酢酸メチル', 'ケイ皮酸（桂皮酸・3-フェニルプロペン酸）',
            'マンデル酸（フェニルグリコール酸）', 'フタル酸ジメチル', 'フタル酸ジエチル',
            'p-ヒドロキシ安息香酸メチル（パラベン）', 'p-トルアルデヒド（4-メチルベンズアルデヒド）',
            'p-ヒドロキシベンズアルデヒド', 'アニスアルデヒド（p-メトキシベンズアルデヒド）',
            'バニリン（4-ヒドロキシ-3-メトキシベンズアルデヒド）', 'p-ニトロベンズアルデヒド',
            '4-メチルアセトフェノン（p-メチルアセトフェノン）', 'p-ベンゾキノン（1,4-ベンゾキノン）',
            'N-メチルアニリン', 'N,N-ジメチルアニリン', 'ベンジルアミン', 'ジフェニルアミン',
            '2,4,6-トリブロモフェノール', '2,4,6-トリクロロフェノール', '1,3,5-トリニトロベンゼン',
            '2,4-ジニトロトルエン', '3,5-ジニトロ安息香酸',
            'ピロガロール（1,2,3-トリヒドロキシベンゼン）', 'フロログルシノール（1,3,5-トリヒドロキシベンゼン）',
            '臭化ベンジル（ベンジルブロミド）', 'フェネトール（エトキシベンゼン）', 'ジフェニルエーテル',
            'グアヤコール（o-メトキシフェノール）', '2-メチルナフタレン', '1-ニトロナフタレン'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
        });
        // C₉H₁₂ の芳香族炭化水素（側鎖の異性体）が分子式そろい・構造は別
        const c9 = ['プロピルベンゼン', 'クメン（イソプロピルベンゼン）',
            '1,2,3-トリメチルベンゼン（ヘミメリテン）', '1,2,4-トリメチルベンゼン（プソイドクメン）',
            'メシチレン（1,3,5-トリメチルベンゼン）'];
        const c9codes = new Set(c9.map(nm => {
            const mol = targetOf(nm);
            assert(g.computeMolecularFormula(mol) === 'C₉H₁₂',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            return W.canonicalCode(mol);
        }));
        assert(c9codes.size === c9.length,
            `C₉H₁₂ の芳香族炭化水素に同じ構造が混ざっている（${c9codes.size}/${c9.length}）`);
        // アントラセンとフェナントレンは同じ C₁₄H₁₀ でも別の構造（直線縮合／屈折縮合）
        const ant = targetOf('アントラセン'), phe = targetOf('フェナントレン');
        [['アントラセン', ant], ['フェナントレン', phe]].forEach(([nm, mol]) => {
            assert(g.computeMolecularFormula(mol) === 'C₁₄H₁₀',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            // 環3つ（結合数 − 原子数 + 1）
            assert(mol.bonds.length - mol.atoms.length + 1 === 3, `${nm} の環が3つでない`);
        });
        assert(W.canonicalCode(ant) !== W.canonicalCode(phe),
            'アントラセンとフェナントレンが同じ構造になっている');
        // ヒドロキノン（既出）と p-ベンゾキノンは酸化還元の対で、構造は別
        assert(W.canonicalCode(targetOf('p-ベンゾキノン（1,4-ベンゾキノン）'))
            !== W.canonicalCode(targetOf('ヒドロキノン（p-ジヒドロキシベンゼン）')),
            'p-ベンゾキノンとヒドロキノンが同じ構造になっている');
    });

    test('LB15: 名称ライブラリ第4弾B-3（脂環・複素環・鎖状カルボニルの残り）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        const names = [
            '1,1-ジメチルシクロヘキサン', 'エチルシクロヘキサン', 'エチルシクロペンタン',
            '1,4-シクロヘキサンジオン', '1,3-シクロヘキサンジオン', '1,2-シクロヘキサンジオン',
            '4-メチルシクロヘキサノン', '2-メチルシクロヘキサノン', '3-メチルシクロヘキサノン',
            '2-メチルシクロペンタノン', 'シクロオクタノン', '2-シクロヘキセン-1-オン',
            '2-シクロペンテン-1-オン', '1-メチルシクロヘキセン', 'シクロヘキサンカルボアルデヒド',
            'シクロヘキシルメタノール', 'テトラリン（1,2,3,4-テトラヒドロナフタレン）',
            'γ-ブチロラクトン（4-ブタノリド）', 'δ-バレロラクトン（5-ペンタノリド）',
            'ε-カプロラクトン（6-ヘキサノリド）', '2-ピロリドン（γ-ブチロラクタム）',
            'N-メチル-2-ピロリドン（NMP）', 'スクシンイミド（コハク酸イミド）',
            'フルフラール（2-フルアルデヒド）', 'フルフリルアルコール（2-フランメタノール）',
            'ピペラジン', 'ニコチン酸（ピリジン-3-カルボン酸・ナイアシン）',
            'キノリン', 'イソキノリン', 'インドール',
            'アセト酢酸エチル（3-オキソブタン酸エチル）', 'マロン酸ジメチル',
            '4-ヘプタノン（ジプロピルケトン）', '3-ヘプタノン（エチルブチルケトン）',
            '2-オクタノン（メチルヘキシルケトン）', '2,5-ヘキサンジオン（アセトニルアセトン）',
            'オクタナール', 'マロンアルデヒド（1,3-プロパンジアール）',
            'グルタルアルデヒド（1,5-ペンタンジアール）', 'メチルグリオキサール（2-オキソプロパナール）',
            '酢酸ヘキシル', 'ヘキサン酸メチル', 'ヘキサン酸エチル', 'パルミチン酸メチル',
            '塩化プロピオニル（プロピオニルクロリド）', 'N-メチルホルムアミド', '炭酸ジメチル',
            'クロラール（トリクロロアセトアルデヒド）', 'クロロアセトン（1-クロロ-2-プロパノン）',
            'ジアセトンアルコール（4-ヒドロキシ-4-メチル-2-ペンタノン）'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
        });
        // C₆H₈O₂ のシクロヘキサンジオン3種が分子式そろい・構造は別
        const diones = ['1,2-シクロヘキサンジオン', '1,3-シクロヘキサンジオン', '1,4-シクロヘキサンジオン'];
        const dioneCodes = new Set(diones.map(nm => {
            const mol = targetOf(nm);
            assert(g.computeMolecularFormula(mol) === 'C₆H₈O₂',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            return W.canonicalCode(mol);
        }));
        assert(dioneCodes.size === diones.length,
            `シクロヘキサンジオンに同じ構造が混ざっている（${dioneCodes.size}/${diones.length}）`);
        // C₇H₁₂O のメチルシクロヘキサノン3種も同様
        const mch = ['2-メチルシクロヘキサノン', '3-メチルシクロヘキサノン', '4-メチルシクロヘキサノン'];
        const mchCodes = new Set(mch.map(nm => {
            const mol = targetOf(nm);
            assert(g.computeMolecularFormula(mol) === 'C₇H₁₂O',
                `${nm} の分子式が ${g.computeMolecularFormula(mol)}`);
            return W.canonicalCode(mol);
        }));
        assert(mchCodes.size === mch.length,
            `メチルシクロヘキサノンに同じ構造が混ざっている（${mchCodes.size}/${mch.length}）`);
        // 縮合複素環: キノリンとイソキノリンは同じ C₉H₇N でも窒素の位置が違う
        const q = targetOf('キノリン'), iq = targetOf('イソキノリン');
        assert(W.canonicalCode(q) !== W.canonicalCode(iq),
            'キノリンとイソキノリンが同じ構造になっている');
        // ラクトンは環の中にエステル結合を持つ（開いたカルボン酸ではない）
        ['γ-ブチロラクトン（4-ブタノリド）', 'δ-バレロラクトン（5-ペンタノリド）',
            'ε-カプロラクトン（6-ヘキサノリド）'].forEach(nm => {
            const mol = targetOf(nm);
            const types = W.findFunctionalGroups(mol).map(x => x.type);
            assert(types.includes('ester'), `${nm} がエステル結合として拾われない（${types.join(',')}）`);
        });
    });

    test('LB17: 名称ライブラリ第5弾A（census --types の「環」の残量。ベンゼン二置換体の C=O 側）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // §16.3 の型ごとの数え上げで「環」の残量に出ていた 46 通り。
        // §11 が埋めたのは -OH/-CH₃/-NH₂/-Cl/-Br/-COOH/-NO₂ の総当たりまでで、
        // **-CHO と -COCH₃ を含む組み合わせ**がまるごと残っていた
        const names = [
            'o-ヒドロキシアセトフェノン', 'm-ヒドロキシベンズアルデヒド', 'm-ヒドロキシアセトフェノン',
            'p-ヒドロキシアセトフェノン', 'o-メチルベンズアルデヒド', 'o-メチルアセトフェノン',
            'm-メチルベンズアルデヒド', 'm-メチルアセトフェノン', 'o-アミノベンズアルデヒド',
            'o-アミノアセトフェノン', 'm-アミノベンズアルデヒド', 'm-アミノアセトフェノン',
            'p-アミノベンズアルデヒド', 'p-アミノアセトフェノン', 'o-クロロベンズアルデヒド',
            'o-クロロアセトフェノン', 'm-クロロベンズアルデヒド', 'm-クロロアセトフェノン',
            'p-クロロベンズアルデヒド', 'p-クロロアセトフェノン', 'o-ブロモベンズアルデヒド',
            'o-ブロモアセトフェノン', 'm-ブロモベンズアルデヒド', 'm-ブロモアセトフェノン',
            'p-ブロモベンズアルデヒド', 'p-ブロモアセトフェノン', 'o-ホルミル安息香酸',
            'o-アセチル安息香酸', 'm-ホルミル安息香酸', 'm-アセチル安息香酸',
            'p-ホルミル安息香酸', 'p-アセチル安息香酸',
            'フタルアルデヒド（o-ジホルミルベンゼン）', 'イソフタルアルデヒド（m-ジホルミルベンゼン）',
            'テレフタルアルデヒド（p-ジホルミルベンゼン）',
            'o-アセチルベンズアルデヒド', 'm-アセチルベンズアルデヒド', 'p-アセチルベンズアルデヒド',
            'o-ニトロベンズアルデヒド', 'm-ニトロベンズアルデヒド',
            'o-ジアセチルベンゼン', 'm-ジアセチルベンゼン', 'p-ジアセチルベンゼン',
            'o-ニトロアセトフェノン', 'm-ニトロアセトフェノン', 'p-ニトロアセトフェノン'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
        });
        // o-/m-/p- の3つ組は分子式がそろい、構造は3つとも別（**件数は決め打ちしない**）
        [['クロロベンズアルデヒド', 'C₇H₅ClO'], ['ブロモアセトフェノン', 'C₈H₇BrO'],
            ['アセチル安息香酸', 'C₉H₈O₃'], ['ジアセチルベンゼン', 'C₁₀H₁₀O₂']].forEach(([base, formula]) => {
            const trio = ['o-', 'm-', 'p-'].map(p => p + base);
            const codes = new Set(trio.map(nm => {
                const mol = targetOf(nm);
                assert(g.computeMolecularFormula(mol) === formula,
                    `${nm} の分子式が ${g.computeMolecularFormula(mol)}（期待 ${formula}）`);
                return W.canonicalCode(mol);
            }));
            assert(codes.size === 3, `${base} の o-/m-/p- に同じ構造が混ざっている（${codes.size}/3）`);
        });
        // 芳香族のカルボニルが正しく分類される（アルデヒド／ケトン／カルボン酸の別）
        const typesOf = nm => W.findFunctionalGroups(targetOf(nm)).map(x => x.type);
        assert(typesOf('m-ヒドロキシベンズアルデヒド').includes('aldehyde'),
            'm-ヒドロキシベンズアルデヒドがアルデヒドとして拾われない');
        assert(typesOf('p-ヒドロキシアセトフェノン').includes('ketone'),
            'p-ヒドロキシアセトフェノンがケトンとして拾われない');
        assert(typesOf('o-アセチル安息香酸').includes('carboxyl'),
            'o-アセチル安息香酸がカルボン酸として拾われない');
        // 否定対照: アセトフェノン型はアルデヒドではない／ベンズアルデヒド型はケトンではない
        assert(!typesOf('p-ヒドロキシアセトフェノン').includes('aldehyde'),
            'ケトン（-COCH₃）をアルデヒドとして拾っている');
        assert(!typesOf('m-ヒドロキシベンズアルデヒド').includes('ketone'),
            'アルデヒド（-CHO）をケトンとして拾っている');
        // 否定対照: -CHO と -COCH₃ は炭素1個ぶん違うので、同じ位置でも別構造
        assert(W.canonicalCode(targetOf('m-ヒドロキシベンズアルデヒド'))
            !== W.canonicalCode(targetOf('m-ヒドロキシアセトフェノン')),
            'ベンズアルデヒド型とアセトフェノン型が同じ構造になっている');
        // 否定対照: 登録していない位置異性体（o-ヒドロキシベンズアルデヒド＝サリチルアルデヒド）は
        // **既出の名前**で名乗る。今回の追加が既存の名前を上書きしていないこと
        assert(g.lookupCompoundName(targetOf('サリチルアルデヒド')) === 'サリチルアルデヒド',
            'サリチルアルデヒドの名前が今回の追加で変わってしまった');
    });

    test('LB18: 名称ライブラリ第5弾B（census --types の「環」の残量。脂環＋カルボニル）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // 脂環の二置換体はシス／トランスが付くので §13・§15.2 で見送っている。
        // **置換基の一方が =O（sp3 でなくなる）なら立体が生じない**ので、そこだけ埋めた
        const names = [
            '2-ヒドロキシシクロペンタノン', '3-ヒドロキシシクロペンタノン', '3-メチルシクロペンタノン',
            '2-アミノシクロペンタノン', '3-アミノシクロペンタノン',
            '2-クロロシクロペンタノン', '3-クロロシクロペンタノン',
            '2-ブロモシクロペンタノン', '3-ブロモシクロペンタノン',
            '2-オキソシクロペンタンカルボン酸', '3-オキソシクロペンタンカルボン酸',
            'シクロペンタンカルボアルデヒド',
            '2-オキソシクロペンタンカルボアルデヒド', '3-オキソシクロペンタンカルボアルデヒド',
            'アセチルシクロペンタン（1-シクロペンチルエタノン）',
            '2-アセチルシクロペンタノン', '3-アセチルシクロペンタノン',
            '2-ニトロシクロペンタノン', '3-ニトロシクロペンタノン',
            '1,2-シクロペンタンジオン', '1,3-シクロペンタンジオン',
            '2-ヒドロキシシクロヘキサノン', '3-ヒドロキシシクロヘキサノン', '4-ヒドロキシシクロヘキサノン',
            '2-アミノシクロヘキサノン', '3-アミノシクロヘキサノン', '4-アミノシクロヘキサノン',
            '2-クロロシクロヘキサノン', '3-クロロシクロヘキサノン', '4-クロロシクロヘキサノン',
            '2-ブロモシクロヘキサノン', '3-ブロモシクロヘキサノン', '4-ブロモシクロヘキサノン',
            '2-オキソシクロヘキサンカルボン酸', '3-オキソシクロヘキサンカルボン酸',
            '4-オキソシクロヘキサンカルボン酸',
            '2-オキソシクロヘキサンカルボアルデヒド', '3-オキソシクロヘキサンカルボアルデヒド',
            '4-オキソシクロヘキサンカルボアルデヒド',
            'アセチルシクロヘキサン（1-シクロヘキシルエタノン）',
            '2-アセチルシクロヘキサノン', '3-アセチルシクロヘキサノン', '4-アセチルシクロヘキサノン',
            '2-ニトロシクロヘキサノン', '3-ニトロシクロヘキサノン', '4-ニトロシクロヘキサノン'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
        });
        // 位置異性体の組は分子式がそろい、構造は全部別（**件数は決め打ちしない**）
        [[['2-', '3-', '4-'], 'ヒドロキシシクロヘキサノン', 'C₆H₁₀O₂'],
            [['2-', '3-', '4-'], 'ブロモシクロヘキサノン', 'C₆H₉BrO'],
            [['2-', '3-', '4-'], 'オキソシクロヘキサンカルボン酸', 'C₇H₁₀O₃'],
            [['2-', '3-'], 'クロロシクロペンタノン', 'C₅H₇ClO']].forEach(([pre, base, formula]) => {
            const set = pre.map(p => p + base);
            const codes = new Set(set.map(nm => {
                const mol = targetOf(nm);
                assert(g.computeMolecularFormula(mol) === formula,
                    `${nm} の分子式が ${g.computeMolecularFormula(mol)}（期待 ${formula}）`);
                return W.canonicalCode(mol);
            }));
            assert(codes.size === set.length,
                `${base} の位置異性体に同じ構造が混ざっている（${codes.size}/${set.length}）`);
        });
        // 環の中の C=O はケトンとして拾われる（環外の -CHO・-COOH と取り違えない）
        const typesOf = nm => W.findFunctionalGroups(targetOf(nm)).map(x => x.type);
        assert(typesOf('3-ヒドロキシシクロヘキサノン').includes('ketone'),
            '環内の C=O がケトンとして拾われない');
        assert(typesOf('3-オキソシクロヘキサンカルボン酸').includes('carboxyl'),
            '3-オキソシクロヘキサンカルボン酸のカルボキシ基が拾われない');
        assert(typesOf('3-オキソシクロヘキサンカルボアルデヒド').includes('aldehyde'),
            '3-オキソシクロヘキサンカルボアルデヒドのアルデヒド基が拾われない');
        // 否定対照: 環内ケトンだけの分子にアルデヒド・カルボン酸を立てない
        ['3-ヒドロキシシクロヘキサノン', '1,3-シクロペンタンジオン'].forEach(nm => {
            const t = typesOf(nm);
            assert(!t.includes('aldehyde') && !t.includes('carboxyl'),
                `${nm} にアルデヒド／カルボン酸が立っている（${t.join(',')}）`);
        });
        // 否定対照: シス/トランスが付く形（1,2-／1,4-ジメチルシクロヘキサン）は**登録していない**。
        // §13・§15.2 の判断を今回の追加が崩していないことを確かめる
        ['1,2-ジメチルシクロヘキサン', '1,4-ジメチルシクロヘキサン', '2-メチルシクロヘキサノール']
            .forEach(nm => assert(!W.COMPOUNDS.some(e => e.name === nm),
                `${nm} が登録されている（立体つきで別に立てる判断が崩れている）`));
        // 否定対照: 1,2-／1,3-シクロペンタンジオンは別構造（位置を取り違えていない）
        assert(W.canonicalCode(targetOf('1,2-シクロペンタンジオン'))
            !== W.canonicalCode(targetOf('1,3-シクロペンタンジオン')),
            '1,2-と1,3-シクロペンタンジオンが同じ構造になっている');
    });

    test('LB19: 名称ライブラリ第5弾C（census --types の残量。C₆ の鎖状カルボニルとニトリル・ニトロ）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        const names = [
            '2,2-ジメチルブタナール', '2,3-ジメチルブタナール', '2-メチルペンタナール',
            '2-エチルブタナール', '3,3-ジメチルブタナール', '3-メチルペンタナール', '4-メチルペンタナール',
            '2,2-ジメチルブタン酸', '2,3-ジメチルブタン酸', '2-メチルペンタン酸',
            '2-エチルブタン酸', '3,3-ジメチルブタン酸', '3-メチルペンタン酸', '4-メチルペンタン酸',
            '3,3-ジメチル-2-ブタノン', '3-メチル-2-ペンタノン', '2-メチル-3-ペンタノン',
            'ギ酸ペンチル', 'ギ酸イソペンチル', 'ギ酸ネオペンチル', 'ギ酸(1-メチルブチル)',
            'ギ酸(2-メチルブチル)', 'ギ酸(1-エチルプロピル)', 'ギ酸(1,1-ジメチルプロピル)',
            'ギ酸(1,2-ジメチルプロピル)',
            '2,2-ジメチルプロパン酸メチル', '2-メチルブタン酸メチル', '3-メチルブタン酸メチル',
            '2-メチルプロパンニトリル', '2,2-ジメチルプロパンニトリル', '2-メチルブタンニトリル',
            '3-メチルブタンニトリル', 'ヘキサンニトリル', '2,2-ジメチルブタンニトリル',
            '2,3-ジメチルブタンニトリル', '2-メチルペンタンニトリル', '2-エチルブタンニトリル',
            '3,3-ジメチルブタンニトリル', '3-メチルペンタンニトリル', '4-メチルペンタンニトリル',
            '1-ニトロブタン', '2-ニトロブタン', '2-メチル-1-ニトロプロパン', '2-メチル-2-ニトロプロパン',
            '1-ニトロペンタン', '2-ニトロペンタン', '3-ニトロペンタン', '2-メチル-1-ニトロブタン',
            '3-メチル-1-ニトロブタン', '2-メチル-2-ニトロブタン', '3-メチル-2-ニトロブタン',
            '2,2-ジメチル-1-ニトロプロパン'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
        });
        // C₆H₁₂O のアルデヒド（既出のヘキサナールを含む）が分子式そろい・構造は全部別。
        // **件数の決め打ちはしない**——リストを増やしても > 0 と「全部別」で成り立つ形にする
        [['C₆H₁₂O', ['ヘキサナール', '2,2-ジメチルブタナール', '2,3-ジメチルブタナール',
            '2-メチルペンタナール', '2-エチルブタナール', '3,3-ジメチルブタナール',
            '3-メチルペンタナール', '4-メチルペンタナール']],
        ['C₆H₁₂O₂', ['2,2-ジメチルブタン酸', '2,3-ジメチルブタン酸', '2-メチルペンタン酸',
            '2-エチルブタン酸', '3,3-ジメチルブタン酸', '3-メチルペンタン酸', '4-メチルペンタン酸',
            'ギ酸ペンチル', 'ギ酸イソペンチル', 'ギ酸ネオペンチル']],
        ['C₅H₁₁NO₂', ['1-ニトロペンタン', '2-ニトロペンタン', '3-ニトロペンタン',
            '2-メチル-1-ニトロブタン', '3-メチル-1-ニトロブタン', '2-メチル-2-ニトロブタン',
            '3-メチル-2-ニトロブタン', '2,2-ジメチル-1-ニトロプロパン']]].forEach(([formula, set]) => {
            assert(set.length > 0, `${formula} の一群が空`);
            const codes = new Set(set.map(nm => {
                const mol = targetOf(nm);
                assert(g.computeMolecularFormula(mol) === formula,
                    `${nm} の分子式が ${g.computeMolecularFormula(mol)}（期待 ${formula}）`);
                return W.canonicalCode(mol);
            }));
            assert(codes.size === set.length,
                `${formula} の一群に同じ構造が混ざっている（${codes.size}/${set.length}）`);
        });
        // 官能基の分類（アルデヒド／カルボン酸／ケトン／エステル／ニトリル／ニトロ）
        const typesOf = nm => W.findFunctionalGroups(targetOf(nm)).map(x => x.type);
        [['2-メチルペンタナール', 'aldehyde'], ['2-メチルペンタン酸', 'carboxyl'],
            ['3-メチル-2-ペンタノン', 'ketone'], ['ギ酸イソペンチル', 'ester'],
            ['ヘキサンニトリル', 'nitrile'], ['1-ニトロペンタン', 'nitro']].forEach(([nm, ty]) => {
            assert(typesOf(nm).includes(ty), `${nm} が ${ty} として拾われない（${typesOf(nm).join(',')}）`);
        });
        // 否定対照: ニトロはアミンではない・ニトリルもアミンではない（v756 の級数の線引き）
        ['1-ニトロペンタン', '2-ニトロブタン', 'ヘキサンニトリル', '2-メチルブタンニトリル']
            .forEach(nm => {
            const t = typesOf(nm);
            assert(!t.some(x => /^amine[123]$/.test(x)),
                `${nm} にアミンの型が立っている（${t.join(',')}）`);
        });
        // 否定対照: アルデヒドをカルボン酸として拾わない・その逆もない
        assert(!typesOf('2-メチルペンタナール').includes('carboxyl'),
            'アルデヒドをカルボン酸として拾っている');
        assert(!typesOf('2-メチルペンタン酸').includes('aldehyde'),
            'カルボン酸をアルデヒドとして拾っている');
        // 否定対照: 同じ分子式 C₆H₁₂O₂ でもエステルとカルボン酸は別の分類
        assert(typesOf('ギ酸ペンチル').includes('ester') && !typesOf('ギ酸ペンチル').includes('carboxyl'),
            'ギ酸ペンチルがエステルとして拾われない（またはカルボン酸として拾われている）');
    });

    test('LB20: 名称ライブラリ第5弾D（census --types の「N」の残量。C₅・C₆ のアミン49件）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        const typesOf = nm => new Set(W.findFunctionalGroups(targetOf(nm)).map(x => x.type));
        // 級数ごとの一覧。§16.1（v756）で 3級アミンが範囲内に戻ったので、まとめて登録できる
        const PRIMARY = [
            '(1,1-ジメチルプロピル)アミン', '(1,2-ジメチルプロピル)アミン', '(1-メチルブチル)アミン',
            '(1-エチルプロピル)アミン', 'ネオペンチルアミン', '(2-メチルブチル)アミン',
            '(1,1,2-トリメチルプロピル)アミン', '(1,1-ジメチルブチル)アミン',
            '(1-エチル-1-メチルプロピル)アミン', '(1,2,2-トリメチルプロピル)アミン',
            '(1,2-ジメチルブチル)アミン', '(1,3-ジメチルブチル)アミン', '(1-メチルペンチル)アミン',
            '(1-イソプロピルプロピル)アミン', '(1-エチルブチル)アミン', '(2,2-ジメチルブチル)アミン',
            '(2,3-ジメチルブチル)アミン', '(2-メチルペンチル)アミン', '(2-エチルブチル)アミン',
            '(3,3-ジメチルブチル)アミン', '(3-メチルペンチル)アミン', '(4-メチルペンチル)アミン'
        ];
        const SECONDARY = [
            'tert-ブチルメチルアミン', 'sec-ブチルメチルアミン', 'イソブチルメチルアミン',
            'ブチルメチルアミン', '(1,1-ジメチルプロピル)メチルアミン', '(1,2-ジメチルプロピル)メチルアミン',
            '(1-メチルブチル)メチルアミン', '(1-エチルプロピル)メチルアミン', 'メチルネオペンチルアミン',
            '(2-メチルブチル)メチルアミン', 'イソペンチルメチルアミン', 'メチルペンチルアミン',
            'エチルイソプロピルアミン', 'エチルプロピルアミン', 'tert-ブチルエチルアミン',
            'sec-ブチルエチルアミン', 'エチルイソブチルアミン', 'ブチルエチルアミン',
            'イソプロピルプロピルアミン'
        ];
        const TERTIARY = [
            'イソプロピルジメチルアミン', 'ジメチルプロピルアミン', 'tert-ブチルジメチルアミン',
            'sec-ブチルジメチルアミン', 'イソブチルジメチルアミン', 'ブチルジメチルアミン',
            'エチルイソプロピルメチルアミン', 'エチルメチルプロピルアミン'
        ];
        [PRIMARY, SECONDARY, TERTIARY].forEach(list => {
            assert(list.length > 0, 'アミンの一覧が空');
            list.forEach(nm => {
                const mol = targetOf(nm);
                assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
                assert(W.iupacName(mol) === null,
                    `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
                // 3級アミンも範囲外に落ちない（§16.1 の直しが効いていること）
                assert(W.findOutOfScopeMotifs(mol).length === 0,
                    `${nm} が範囲外（${W.findOutOfScopeMotifs(mol).map(x => x.type).join('/')}）`);
            });
        });
        // 級数が正しく立つ。**否定対照: 他の級数の型は立たない**
        [[PRIMARY, 'amine1'], [SECONDARY, 'amine2'], [TERTIARY, 'amine3']].forEach(([list, want]) => {
            list.forEach(nm => {
                const t = typesOf(nm);
                assert(t.has(want), `${nm} が ${want} にならない（${[...t].join(',')}）`);
                ['amine1', 'amine2', 'amine3'].filter(x => x !== want).forEach(other =>
                    assert(!t.has(other), `${nm} に ${other} まで立っている`));
                assert(!t.has('amino'), `${nm} に級数のない amino が立っている`);
            });
        });
        // C₆H₁₅N のアミンは1級・2級・3級がそろい、構造は全部別（**件数は決め打ちしない**）
        const c6 = [...PRIMARY, ...SECONDARY, ...TERTIARY]
            .filter(nm => g.computeMolecularFormula(targetOf(nm)) === 'C₆H₁₅N');
        assert(c6.length > 0, 'C₆H₁₅N のアミンが1件も無い');
        ['amine1', 'amine2', 'amine3'].forEach(t =>
            assert(c6.some(nm => typesOf(nm).has(t)), `C₆H₁₅N に ${t} が無い`));
        const c6codes = new Set(c6.map(nm => W.canonicalCode(targetOf(nm))));
        assert(c6codes.size === c6.length,
            `C₆H₁₅N のアミンに同じ構造が混ざっている（${c6codes.size}/${c6.length}）`);
        // 利用者が見る面（⚗ カードの1行）にも級数がそのまま出る
        [['(1-メチルブチル)アミン', '1級アミン'],
            ['ブチルメチルアミン', '2級アミン'],
            ['ブチルジメチルアミン', '3級アミン']].forEach(([nm, want]) => {
            const sum = g.functionalGroupSummary(targetOf(nm));
            assert(sum.includes(want), `${nm} の表示が「${sum}」（${want} を期待）`);
        });
        // 名前で呼び出しても同じ分子が出る（名称呼び出しの往復）
        g.setMode('free');
        ['ネオペンチルアミン', 'ブチルジメチルアミン'].forEach(nm => {
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.summonMolecule(nm);
            assert(g.lookupCompoundName(g.userMolecule) === nm, `${nm} を呼び出しても名乗らない`);
        });
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('LB21: 素の基本骨格 63件（census の (b)「命名器で名前が出る」は呼び出せることを意味しない）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // census の (a) は stages.json ＋ compounds.json を見ているが、**(b) は
        // 「iupacName が名前を返す」だけ**で、summonMolecule が引けるとは限らない。
        // 直鎖アルケン・アルキン・アルコール・ハロゲン化物の「素のもの」がまるごとここに落ちていた
        const names = [
            '1-ペンテン', '1-ヘキセン', '2-ヘキセン', '3-ヘキセン',
            '1-ヘプテン', '2-ヘプテン', '3-ヘプテン',
            '1-オクテン', '2-オクテン', '3-オクテン', '4-オクテン',
            '1-ブチン（エチルアセチレン）', '2-ブチン（ジメチルアセチレン）',
            '1-ペンチン', '2-ペンチン', '1-ヘキシン', '2-ヘキシン', '3-ヘキシン',
            '1-ヘプチン', '2-ヘプチン', '3-ヘプチン',
            '1-オクチン', '2-オクチン', '3-オクチン', '4-オクチン',
            '1-ペンタノール（n-アミルアルコール）', '1-ヘキサノール（ヘキシルアルコール）',
            '1-ヘプタノール', '1-オクタノール（オクチルアルコール）', '1-ノナノール', '1-デカノール',
            '2-ペンタノール', '2-ヘキサノール', '2-ヘプタノール', '2-オクタノール',
            '1-クロロプロパン（塩化プロピル）', '2-クロロプロパン（塩化イソプロピル）',
            '1-クロロブタン（塩化ブチル）', '2-クロロブタン',
            '1-クロロペンタン', '2-クロロペンタン', '3-クロロペンタン',
            'ブロモメタン（臭化メチル）', 'ブロモエタン（臭化エチル）',
            '1-ブロモプロパン（臭化プロピル）', '2-ブロモプロパン（臭化イソプロピル）',
            '1-ブロモブタン（臭化ブチル）', '2-ブロモブタン',
            '1-ブロモペンタン', '2-ブロモペンタン', '3-ブロモペンタン',
            '1,3-ペンタジエン', '1,4-ペンタジエン', 'アレン（1,2-プロパジエン）',
            '1,2-プロパンジオール（プロピレングリコール）', '1,3-プロパンジオール',
            '2-メチル-1-ブテン', '2-メチル-2-ブテン', '3-メチル-1-ブテン', '3-メチル-1-ブチン',
            'ブロモホルム（トリブロモメタン）', 'ジブロモメタン（臭化メチレン）',
            '四臭化炭素（テトラブロモメタン）'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            // ⚠ この一群だけは iupacName が名前を返す（(b) を埋めたもの）。
            //    「iupacName が null であること」は登録の条件ではない、というのがこの弾の学び
            assert(W.iupacName(mol) !== null,
                `${nm} は iupacName でも名前が出るはず（テストの前提が崩れている）`);
            // 名前で呼び出せる＝利用者から見て「在る」
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.summonMolecule(nm);
            assert(g.lookupCompoundName(g.userMolecule) === nm, `${nm} を呼び出しても名乗らない`);
        });
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        // 同族列がそろっている（**件数は決め打ちしない**。分子式が合い、構造が全部別）
        [['C₈H₁₆', ['1-オクテン', '2-オクテン', '3-オクテン', '4-オクテン']],
            ['C₈H₁₄', ['1-オクチン', '2-オクチン', '3-オクチン', '4-オクチン']],
            ['C₅H₁₁Br', ['1-ブロモペンタン', '2-ブロモペンタン', '3-ブロモペンタン']],
            ['C₅H₁₂O', ['1-ペンタノール（n-アミルアルコール）', '2-ペンタノール']]].forEach(([formula, set]) => {
            assert(set.length > 0, `${formula} の一群が空`);
            const codes = new Set(set.map(nm => {
                const mol = targetOf(nm);
                assert(g.computeMolecularFormula(mol) === formula,
                    `${nm} の分子式が ${g.computeMolecularFormula(mol)}（期待 ${formula}）`);
                return W.canonicalCode(mol);
            }));
            assert(codes.size === set.length,
                `${formula} の一群に同じ構造が混ざっている（${codes.size}/${set.length}）`);
        });
        // 官能基の分類（アルコールの級数・ハロゲン化物・不飽和）
        const typesOf = nm => W.findFunctionalGroups(targetOf(nm)).map(x => x.type);
        assert(typesOf('1-ヘキサノール（ヘキシルアルコール）').includes('alcohol1'),
            '1-ヘキサノールが1級アルコールにならない');
        assert(typesOf('2-ヘキサノール').includes('alcohol2'),
            '2-ヘキサノールが2級アルコールにならない');
        // 否定対照A: 1級と2級を取り違えていない
        assert(!typesOf('1-ヘキサノール（ヘキシルアルコール）').includes('alcohol2'),
            '1級アルコールを2級として拾っている');
        assert(!typesOf('2-ヘキサノール').includes('alcohol1'),
            '2級アルコールを1級として拾っている');
        // 否定対照B: **素のエチレン・プロペン・アセチレン・プロピンは stages.json にある**。
        // 同じ分子を compounds.json に二重登録していないことを確かめる（統合レーンの指摘）
        ['エチレン（エテン）', 'プロペン（プロピレン）', 'アセチレン（エチン）',
            'プロピン（メチルアセチレン）'].forEach(nm => {
            assert(!W.COMPOUNDS.some(e => e.name === nm),
                `${nm} が compounds.json にも登録されている（stages.json と二重）`);
            const st = (W.STAGES || []).find(s => s.name === nm && s.target);
            assert(st, `${nm} が stages.json から消えている（テストの前提が崩れている）`);
            const mol = g.createTargetFromData({ target: st.target });
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
        });
        // 否定対照C: 内部アルケンは**シス/トランスを未確定のまま**登録している（§5.3-5・2-ブテンと同じ）。
        // 直線に描いてあるので幾何が読めない＝特定の立体異性体を名乗らない
        ['2-ヘキセン', '3-ヘキセン', '2-オクテン'].forEach(nm => {
            const geo = W.readBondGeoFromCoords(targetOf(nm));
            assert(Object.keys(geo).length === 0,
                `${nm} の C=C から幾何が読めてしまう（シス/トランスを決め打ちしている）`);
        });
    });

    test('LB22: 名称ライブラリ第5弾F（アミド65件。これで C=O と N の残量が 0 になる）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // アミドは C=O の残量 93 のうち 65 を占め、N の残量にも同じ 65 が入っている（型が重なる）
        const names = [
            'N-エチルホルムアミド', 'N-イソプロピルホルムアミド', 'N-プロピルホルムアミド',
            'N-tert-ブチルホルムアミド', 'N-sec-ブチルホルムアミド', 'N-イソブチルホルムアミド',
            'N-ブチルホルムアミド', 'N-(1,1-ジメチルプロピル)ホルムアミド',
            'N-(1,2-ジメチルプロピル)ホルムアミド', 'N-(1-メチルブチル)ホルムアミド',
            'N-(1-エチルプロピル)ホルムアミド', 'N-ネオペンチルホルムアミド',
            'N-(2-メチルブチル)ホルムアミド', 'N-イソペンチルホルムアミド', 'N-ペンチルホルムアミド',
            'N-エチル-N-メチルホルムアミド', 'N-イソプロピル-N-メチルホルムアミド',
            'N-メチル-N-プロピルホルムアミド', 'N-tert-ブチル-N-メチルホルムアミド',
            'N-sec-ブチル-N-メチルホルムアミド', 'N-イソブチル-N-メチルホルムアミド',
            'N-ブチル-N-メチルホルムアミド', 'N,N-ジエチルホルムアミド',
            'N-エチル-N-イソプロピルホルムアミド', 'N-エチル-N-プロピルホルムアミド',
            'N-エチルアセトアミド', 'N-イソプロピルアセトアミド', 'N-プロピルアセトアミド',
            'N-tert-ブチルアセトアミド', 'N-sec-ブチルアセトアミド', 'N-イソブチルアセトアミド',
            'N-ブチルアセトアミド', 'N-エチル-N-メチルアセトアミド',
            'N-イソプロピル-N-メチルアセトアミド', 'N-メチル-N-プロピルアセトアミド',
            'N,N-ジエチルアセトアミド',
            'N-メチルプロパンアミド', 'N-エチルプロパンアミド', 'N-イソプロピルプロパンアミド',
            'N-プロピルプロパンアミド', 'N,N-ジメチルプロパンアミド', 'N-エチル-N-メチルプロパンアミド',
            '2-メチルプロパンアミド', 'N-メチル-2-メチルプロパンアミド', 'N-エチル-2-メチルプロパンアミド',
            'N,N-ジメチル-2-メチルプロパンアミド',
            'N-メチルブタンアミド', 'N-エチルブタンアミド', 'N,N-ジメチルブタンアミド',
            '2,2-ジメチルプロパンアミド', 'N-メチル-2,2-ジメチルプロパンアミド',
            '2-メチルブタンアミド', 'N-メチル-2-メチルブタンアミド',
            '3-メチルブタンアミド', 'N-メチル-3-メチルブタンアミド',
            'ペンタンアミド', 'N-メチルペンタンアミド',
            '2,2-ジメチルブタンアミド', '2,3-ジメチルブタンアミド', '2-メチルペンタンアミド',
            '2-エチルブタンアミド', '3,3-ジメチルブタンアミド', '3-メチルペンタンアミド',
            '4-メチルペンタンアミド', 'ヘキサンアミド'
        ];
        names.forEach(nm => {
            const mol = targetOf(nm);
            assert(g.lookupCompoundName(mol) === nm, `${nm} が正しく命名されない`);
            assert(W.iupacName(mol) === null,
                `${nm} を iupacName が「${W.iupacName(mol)}」と命名した（登録の要否を見直すこと）`);
            // アミドとして拾われる。**否定対照: アミドの N をアミンとして二重に数えない**（§16.1）
            const t = W.findFunctionalGroups(mol).map(x => x.type);
            assert(t.includes('amide'), `${nm} が amide として拾われない（${t.join(',')}）`);
            assert(!t.some(x => /^amine[123]$/.test(x)),
                `${nm} のアミド N がアミンとして二重に数えられている（${t.join(',')}）`);
            assert(!t.includes('amino'), `${nm} に級数のない amino が立っている`);
        });
        // C₄H₉NO のアミドが分子式そろい・構造は全部別（**件数は決め打ちしない**）
        [['C₄H₉NO', ['N-イソプロピルホルムアミド', 'N-プロピルホルムアミド',
            'N-エチル-N-メチルホルムアミド', 'N-エチルアセトアミド', 'N-メチルプロパンアミド',
            '2-メチルプロパンアミド']],
        ['C₅H₁₁NO', ['N-tert-ブチルホルムアミド', 'N-sec-ブチルホルムアミド', 'N-イソブチルホルムアミド',
            'N-ブチルホルムアミド', 'N-イソプロピル-N-メチルホルムアミド',
            'N-メチル-N-プロピルホルムアミド', 'N,N-ジエチルホルムアミド',
            'N-イソプロピルアセトアミド', 'N-プロピルアセトアミド', 'N-エチル-N-メチルアセトアミド',
            'N-エチルプロパンアミド', 'N,N-ジメチルプロパンアミド',
            'N-メチル-2-メチルプロパンアミド', 'N-メチルブタンアミド', 'ペンタンアミド',
            '2,2-ジメチルプロパンアミド', '2-メチルブタンアミド', '3-メチルブタンアミド']]
        ].forEach(([formula, set]) => {
            assert(set.length > 0, `${formula} の一群が空`);
            const codes = new Set(set.map(nm => {
                const mol = targetOf(nm);
                assert(g.computeMolecularFormula(mol) === formula,
                    `${nm} の分子式が ${g.computeMolecularFormula(mol)}（期待 ${formula}）`);
                return W.canonicalCode(mol);
            }));
            assert(codes.size === set.length,
                `${formula} の一群に同じ構造が混ざっている（${codes.size}/${set.length}）`);
        });
        // 否定対照: アミンの一群（前の弾で入れたもの）にはアミドが立たない。分類が逆流していない
        ['ブチルメチルアミン', 'ブチルジメチルアミン', '(1-メチルブチル)アミン'].forEach(nm => {
            const t = W.findFunctionalGroups(targetOf(nm)).map(x => x.type);
            assert(!t.includes('amide'), `${nm} にアミドが立っている（${t.join(',')}）`);
        });
        // 否定対照: N-置換アミドは範囲外に落ちない
        ['N,N-ジエチルアセトアミド', 'N-ネオペンチルホルムアミド', 'ヘキサンアミド'].forEach(nm =>
            assert(W.findOutOfScopeMotifs(targetOf(nm)).length === 0,
                `${nm} が範囲外（${W.findOutOfScopeMotifs(targetOf(nm)).map(x => x.type).join('/')}）`));
    });

    test('LB9: ヨードホルム CHI₃ が名前で引ける（ヨウ素レーン。DESIGN_compound_coverage.md §3.2 の優先度①）', async (c) => {
        const g = c.game, W = c.W;
        const entry = W.COMPOUNDS.find(e => e.name === 'ヨードホルム（トリヨードメタン）');
        assert(entry, 'ヨードホルム が compounds.json に無い');
        const mol = g.createTargetFromData({ target: entry.target });
        assert(g.lookupCompoundName(mol) === 'ヨードホルム（トリヨードメタン）', 'ヨードホルムが正しく命名されない');
        assert(g.computeMolecularFormula(mol) === 'CHI₃',
            `ヨードホルムの分子式が違う（${g.computeMolecularFormula(mol)}）`);
        // 呼び出しでも同じ図が出る（名称呼び出しが I を扱えること）
        g.setMode('free');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        g.summonMolecule('ヨードホルム（トリヨードメタン）');
        assert(g.userMolecule.atoms.filter(a => a.element === 'I').length === 3,
            '呼び出したヨードホルムのヨウ素が3個でない（名称呼び出しが I を扱えていない）');
        assert(g.lookupCompoundName(g.userMolecule) === 'ヨードホルム（トリヨードメタン）',
            '呼び出したヨードホルムが名乗らない');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('LB6: 名称ライブラリ第3弾A（1〜2タップで作れる脂環。tools/coverage-census.js で見つけた穴）', async (c) => {
        const g = c.game, W = c.W;
        const targetOf = (nm) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            return g.createTargetFromData({ target: entry.target });
        };
        // 環モジュールを置くだけ（1タップ）／置いて官能基を1つ足すだけ（2タップ）で作れるのに
        // 名前が出なかったもの。ここが名無しに戻ると「描けたのに名前が出ない」が復活する
        ['シクロヘプタン', 'シクロオクタン', 'テトラヒドロピラン（オキサン）',
            'シクロヘキサンカルボン酸', 'シクロヘキシルアミン', 'ニトロシクロヘキサン',
            'クロロシクロヘキサン', 'ブロモシクロヘキサン', 'シクロヘキサンスルホン酸',
            'シクロペンタノール', 'シクロペンタンカルボン酸', 'シクロペンチルアミン',
            'ニトロシクロペンタン', 'クロロシクロペンタン', 'ブロモシクロペンタン',
            'メチルシクロペンタン', 'シクロペンタンスルホン酸',
            'テトラヒドロフラン（オキソラン）', 'ピロリジン', 'ピペリジン'].forEach(nm => {
            assert(g.lookupCompoundName(targetOf(nm)) === nm, `${nm} が正しく命名されない`);
        });
        // 環の員数を取り違えていないこと（7・8員環は任意員環モジュールから作る）
        [['シクロヘプタン', 7], ['シクロオクタン', 8]].forEach(([nm, n]) => {
            const mol = targetOf(nm);
            assert(mol.atoms.length === n, `${nm} の環が ${n} 員でない`);
            assert(mol.bonds.length === n, `${nm} の結合が ${n} 本でない（環になっていない）`);
        });
        // ニトロ基は N(=O)(-O)。N(=O)(=O) で描くと価標超過になる（開発方針4章2）
        ['ニトロシクロヘキサン', 'ニトロシクロペンタン'].forEach(nm => {
            const mol = targetOf(nm);
            const n = mol.atoms.find(a => a.element === 'N');
            assert(W.isValencyValid(mol, n.id), `${nm} の N が価標超過`);
            assert(mol.getNeighbors(n.id).filter(x => x.type === 2).length === 1,
                `${nm} のニトロ基が N(=O)(-O) になっていない`);
        });
        // 環内にヘテロ原子を持つ3件は、環の員数と元素を取り違えていないこと
        [['テトラヒドロフラン（オキソラン）', 5, 'O'], ['ピロリジン', 5, 'N'],
            ['テトラヒドロピラン（オキサン）', 6, 'O'], ['ピペリジン', 6, 'N']].forEach(([nm, n, el]) => {
            const mol = targetOf(nm);
            assert(mol.atoms.length === n, `${nm} の環が ${n} 員でない`);
            assert(mol.atoms.filter(a => a.element === el).length === 1, `${nm} の環内 ${el} が1個でない`);
        });
    });

    test('F9: IUPAC系統名（アルカン・アルケン・アルキン・ハロゲン化物・アルコール・エーテル）＋アルキル基名（P12-3 第2〜5弾）', async (c) => {
        const g = c.game, W = c.W;
        // (1) ライブラリの全アルカン（C4〜C7の完全な異性体集合を含む）が系統名で既知の正解名に一致
        const isAlkane = m => m.atoms.every(a => a.element === 'C' || a.element === 'H') &&
            m.bonds.every(b => b.type === 1) && !W.findAnyCycle(m);
        const fails = [];
        let alkaneCount = 0;
        [...W.STAGES, ...W.COMPOUNDS].forEach(e => {
            if (!e.target) return;
            const m = g.createTargetFromData({ target: e.target });
            if (!isAlkane(m)) return;
            alkaneCount++;
            if (W.iupacName(m) !== e.name) fails.push(`${e.name}→${W.iupacName(m)}`);
        });
        assert(alkaneCount >= 19, `照合したアルカンが${alkaneCount}件（C4〜C7の19件以上を期待）`);
        assert(fails.length === 0, `アルカン系統名の不一致: ${fails.join(', ')}`);
        // (2) 代表骨格: 混在置換基のアルファベット順（エチル<メチル）・多重位置番号
        const skel = (atoms, bonds) => {
            const m = new W.Molecule();
            const ids = atoms.map(el => m.addAtom(el, 0, 0).id);
            bonds.forEach(([i, j]) => m.addBond(ids[i], ids[j], 1));
            return W.iupacName(m);
        };
        assert(skel(['C','C','C','C','C','C','C','C'], [[0,1],[1,2],[2,3],[3,4],[1,5],[2,6],[6,7]]) === '3-エチル-2-メチルペンタン',
            '混在置換基の命名・アルファベット順が不正');
        assert(skel(['C','C','C','C','C','C','C','C'], [[0,1],[1,2],[2,3],[3,4],[1,5],[1,6],[3,7]]) === '2,2,4-トリメチルペンタン',
            '多重位置番号の命名が不正');
        // (3) アルキル基名（付け根＝C1）
        const alkyl = (atoms, bonds, root) => {
            const m = new W.Molecule();
            const ids = atoms.map(el => m.addAtom(el, 0, 0).id);
            bonds.forEach(([i, j]) => m.addBond(ids[i], ids[j], 1));
            return W.iupacAlkylGroupName(m, ids[root]);
        };
        assert(alkyl(['C'], [], 0) === 'メチル', 'メチル基');
        assert(alkyl(['C','C','C'], [[0,1],[0,2]], 0) === 'イソプロピル', 'イソプロピル基');
        assert(alkyl(['C','C','C','C'], [[0,1],[0,2],[2,3]], 0) === 'sec-ブチル', 'sec-ブチル基');
        assert(alkyl(['C','C','C','C'], [[0,1],[1,2],[1,3]], 0) === 'イソブチル', 'イソブチル基');
        assert(alkyl(['C','C','C','C'], [[0,1],[0,2],[0,3]], 0) === 'tert-ブチル', 'tert-ブチル基');
        // (H) ハロゲン化アルキル: 接頭辞（クロロ/ブロモ…）、メタン誘導体は位置番号省略、混在はアルファベット順
        assert(skel(['C','Cl','Cl','Cl','Cl'], [[0,1],[0,2],[0,3],[0,4]]) === 'テトラクロロメタン', 'テトラクロロメタン（位置番号省略）');
        assert(skel(['C','Br','Cl'], [[0,1],[0,2]]) === 'ブロモクロロメタン', 'ハロゲンのアルファベット順（ブロモ<クロロ）');
        assert(skel(['C','C','Cl','Cl'], [[0,1],[0,2],[1,3]]) === '1,2-ジクロロエタン', '1,2-ジクロロエタン');
        assert(skel(['C','C','Cl','Cl'], [[0,1],[0,2],[0,3]]) === '1,1-ジクロロエタン', '1,1-ジクロロエタン');
        assert(skel(['C','C','C','Cl'], [[0,1],[1,2],[1,3]]) === '2-クロロプロパン', '2-クロロプロパン');
        assert(skel(['C','C','C','C','C','Cl'], [[0,1],[1,2],[2,3],[2,4],[1,5]]) === '2-クロロ-3-メチルブタン', 'ハロゲン＋アルキルのアルファベット順（クロロ<メチル）');
        assert(skel(['C','C','Br','Cl'], [[0,1],[0,2],[1,3]]) === '1-ブロモ-2-クロロエタン', '混在ハロゲンの位置番号（アルファベット最先に小番号）');
        // (U) アルケン/アルキン: 接尾辞 -エン/-イン、多重結合が置換基より優先で最小位置番号、ジエン、短鎖は位置省略
        const skelB = (atoms, bonds) => {
            const m = new W.Molecule();
            const ids = atoms.map(el => m.addAtom(el, 0, 0).id);
            bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t || 1));
            return W.iupacName(m);
        };
        assert(skelB(['C','C'], [[0,1,2]]) === 'エテン', 'エテン（位置番号省略）');
        assert(skelB(['C','C','C'], [[0,1,2],[1,2,1]]) === 'プロペン', 'プロペン（位置番号省略）');
        assert(skelB(['C','C','C','C'], [[0,1,2],[1,2,1],[2,3,1]]) === '1-ブテン', '1-ブテン');
        assert(skelB(['C','C','C','C'], [[0,1,1],[1,2,2],[2,3,1]]) === '2-ブテン', '2-ブテン');
        assert(skelB(['C','C','C','C'], [[0,1,2],[1,2,1],[2,3,2]]) === '1,3-ブタジエン', '1,3-ブタジエン');
        assert(skelB(['C','C','C','C','C'], [[0,1,2],[1,2,1],[2,3,1],[2,4,1]]) === '3-メチル-1-ブテン', '二重結合が置換基より小さい番号');
        assert(skelB(['C','C','C'], [[0,1,3],[1,2,1]]) === 'プロピン', 'プロピン（位置番号省略）');
        assert(skelB(['C','C','C','C'], [[0,1,1],[1,2,3],[2,3,1]]) === '2-ブチン', '2-ブチン');
        assert(skelB(['C','C','C','C','Cl'], [[0,1,2],[1,2,1],[2,3,1],[3,4,1]]) === '4-クロロ-1-ブテン', 'ハロアルケンの位置番号（二重結合優先）');
        // (O) アルコール（-オール、-OHが最優先で最小位置番号、ジオール）・エーテル（慣用ジアルキルエーテル）
        assert(skelB(['C','C','O'], [[0,1],[1,2]]) === 'エタノール', 'エタノール（位置番号省略）');
        assert(skelB(['C','C','C','O'], [[0,1],[1,2],[2,3]]) === '1-プロパノール', '1-プロパノール');
        assert(skelB(['C','C','C','O'], [[0,1],[1,2],[1,3]]) === '2-プロパノール', '2-プロパノール');
        assert(skelB(['C','C','C','C','O'], [[0,2],[1,2],[3,2],[2,4]]) === '2-メチル-2-プロパノール', '2-メチル-2-プロパノール(tert-ブタノール)');
        assert(skelB(['C','C','O','O'], [[0,1],[0,2],[1,3]]) === '1,2-エタンジオール', '1,2-エタンジオール(ジオール)');
        assert(skelB(['C','C','O','Cl'], [[0,1],[0,2],[1,3]]) === '2-クロロエタノール', '-OHが番号で最優先（ハロゲンより先）');
        assert(skelB(['C','O','C'], [[0,1],[1,2]]) === 'ジメチルエーテル', 'ジメチルエーテル');
        assert(skelB(['C','O','C','C'], [[0,1],[1,2],[2,3]]) === 'エチルメチルエーテル', 'エチルメチルエーテル（アルファベット順）');
        // (4) 対応外（環・芳香環・炭素以外のヘテロ原子・カルボニル）は null を返しライブラリ照合に委ねる
        assert(W.iupacName(g.createTargetFromData(W.STAGES.find(s => s.name === 'シクロヘキサン'))) === null, '環に系統名を付けた');
        assert(W.iupacName(g.createTargetFromData(W.STAGES.find(s => s.name === 'ベンゼン'))) === null, '芳香環に系統名を付けた');
        assert(W.iupacName(g.createTargetFromData({ target: W.COMPOUNDS.find(e => e.name === 'エチルアミン').target })) === null,
            'ヘテロ原子（N）を含む分子に系統名を付けた');
        assert(W.iupacName(g.createTargetFromData(W.STAGES.find(s => s.name === 'アセトアルデヒド'))) === null,
            'カルボニル（C=O）を含む分子に系統名を付けた');
        // (5) 統合: lookupCompoundName がライブラリ外のアルカン（オクタン）を系統名で返す
        const oct = new W.Molecule();
        let prev = null;
        for (let i = 0; i < 8; i++) { const a = oct.addAtom('C', i * 42, 300); if (prev) oct.addBond(prev.id, a.id, 1); prev = a; }
        assert(g.lookupCompoundName(oct) === 'オクタン', 'lookupCompoundName がライブラリ外のオクタンを命名しない');
        // ライブラリ外のハロゲン化アルキル（2-クロロブタン）も系統名で返す
        const cb = new W.Molecule();
        const cc = [];
        for (let i = 0; i < 4; i++) { const a = cb.addAtom('C', i * 42, 300); if (i) cb.addBond(cc[i - 1].id, a.id, 1); cc.push(a); }
        cb.addBond(cc[1].id, cb.addAtom('Cl', 42, 258).id, 1);
        assert(g.lookupCompoundName(cb) === '2-クロロブタン', 'lookupCompoundName がライブラリ外の 2-クロロブタン を命名しない');
        // ライブラリ外のアルコール（3-ペンタノール）も系統名で返す
        const pol = new W.Molecule();
        const pc = [];
        for (let i = 0; i < 5; i++) { const a = pol.addAtom('C', i * 42, 300); if (i) pol.addBond(pc[i - 1].id, a.id, 1); pc.push(a); }
        pol.addBond(pc[2].id, pol.addAtom('O', 2 * 42, 258).id, 1);
        assert(g.lookupCompoundName(pol) === '3-ペンタノール', 'lookupCompoundName がライブラリ外の 3-ペンタノール を命名しない');
    });

    test('F10: アルキル基の列挙（付け根マーカーR）と命名（P12-3 アルキル基練習の土台）', async (c) => {
        const W = c.W;
        assert(W.VALENCIES && W.VALENCIES.R === 1, '擬似元素 R の価標が1でない');
        // CnH(2n+1)R を列挙＝アルキル基の異性体。既知のアルキル基数 1,1,2,4,8 と一致・全て命名でき一意
        const expectCount = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
        for (let n = 1; n <= 5; n++) {
            const els = Array(n).fill('C').concat(['R']);
            const { isomers, overflow } = W.enumerateConstitutionalIsomers(els, 2 * n + 1, 200000);
            assert(!overflow, `C${n}H${2 * n + 1}R が overflow`);
            assert(isomers.length === expectCount[n], `C${n}アルキル基が${isomers.length}種（期待${expectCount[n]}）`);
            const codes = new Set(isomers.map(m => W.canonicalCode(m)));
            assert(codes.size === isomers.length, `C${n}アルキル基の正準コードが重複`);
            const names = isomers.map(m => W.iupacAlkylNameFromR(m));
            assert(names.every(Boolean), `C${n}アルキル基に命名できないものがある`);
            assert(new Set(names).size === names.length, `C${n}アルキル基の名前が重複（${names.join(',')}）`);
        }
        // C4 の4種の名前が揃う（ブチル・sec-ブチル・イソブチル・tert-ブチル）
        const c4 = W.enumerateConstitutionalIsomers(['C', 'C', 'C', 'C', 'R'], 9, 200000).isomers.map(m => W.iupacAlkylNameFromR(m)).sort();
        assert(JSON.stringify(c4) === JSON.stringify(['sec-ブチル', 'tert-ブチル', 'イソブチル', 'ブチル'].sort()),
            `C4アルキル基の名前集合が違う（${c4.join(',')}）`);
        // R は炭素の水素を1つ消費する（C-R の炭素は自動水素3個＝メチル基 CH3-R）
        const m = new W.Molecule();
        const cc = m.addAtom('C', 400, 300), rr = m.addAtom('R', 442, 300);
        m.addBond(cc.id, rr.id, 1);
        assert(m.getFreeValency(cc.id) === 3, 'C-R の炭素の自由価標が3でない（水素が減っていない）');
        assert(m.getFreeValency(rr.id) === 0, 'R の自由価標が0でない');
    });

    test('EL1: ヨウ素 I をモデルに足した（価標・自動水素・分子式・系統名・色・CIP。開発方針4章5）', async (c) => {
        const g = c.game, W = c.W, D = c.D;
        // (1) 価標は1（Cl・Br と同じ末端ハロゲン）
        assert(W.VALENCIES && W.VALENCIES.I === 1, 'ヨウ素の価標が1でない');
        // (2) CHI₃ … 自動水素は炭素に1つだけ・ヨウ素には生えない・価標は妥当
        const chi3 = new W.Molecule();
        const cc = chi3.addAtom('C', 400, 300);
        [[400, 258], [358, 300], [442, 300]].forEach(([x, y]) =>
            chi3.addBond(cc.id, chi3.addAtom('I', x, y).id, 1));
        assert(chi3.getFreeValency(cc.id) === 1, 'CHI₃ の炭素の自由価標が1でない');
        chi3.atoms.filter(a => a.element === 'I').forEach(a =>
            assert(chi3.getFreeValency(a.id) === 0, 'ヨウ素に自動水素が生えている'));
        assert(chi3.atoms.every(a => W.isValencyValid(chi3, a.id)), 'CHI₃ の価標が不正');
        assert(g.computeMolecularFormula(chi3) === 'CHI₃',
            `CHI₃ の分子式が違う（${g.computeMolecularFormula(chi3)}）`);
        // 命名は IUPAC_HALOGEN の 'ヨード' がもともと持っていた経路をそのまま使う
        assert(W.iupacName(chi3) === 'トリヨードメタン', `CHI₃ の系統名が違う（${W.iupacName(chi3)}）`);
        // (3) 色が引ける。描画は元素記号を小文字にした CSS 変数をそのまま引くので、
        //     未定義だと文字も丸も色が落ちる。Br と同じ色にしてしまうと図で見分けが付かない
        const cssVar = (n) => W.getComputedStyle(D.documentElement).getPropertyValue(n).trim().toLowerCase();
        assert(/^#[0-9a-f]{3,8}$/.test(cssVar('--color-i')), `--color-i が定義されていない（"${cssVar('--color-i')}"）`);
        assert(cssVar('--color-i') !== cssVar('--color-br'), 'ヨウ素と臭素の色が同じ');
        assert(cssVar('--color-i') !== cssVar('--color-na'), 'ヨウ素とナトリウムの色が同じ（けん化と同じ画面に出る）');
        // (4) CIP の原子番号を持つ。2-ヨードブタン CH₃-CHI-CH₂-CH₃ は不斉炭素を1つ持ち、
        //     I(53) が最優先になる。原子番号表に無いと順位が付かず null に落ちる
        const ib = new W.Molecule();
        const bc = [];
        for (let i = 0; i < 4; i++) {
            const a = ib.addAtom('C', 358 + i * 42, 300);
            if (i) ib.addBond(bc[i - 1].id, a.id, 1);
            bc.push(a);
        }
        const iodo = ib.addAtom('I', 400, 258);
        ib.addBond(bc[1].id, iodo.id, 1);
        assert(ib.isAsymmetricCarbon(bc[1].id), '2-ヨードブタンの不斉炭素を検出できない');
        const rank = W.cipRank(ib, bc[1].id);
        assert(rank && rank[0] === iodo.id, 'CIP でヨウ素が最優先になっていない（原子番号表に I が無い）');
        // (5) パレットには出さない（Na と同じ扱い。DESIGN_entry_points.md A-1 の順路を伸ばさないため）
        assert(!D.querySelector('.atom-palette [data-atom="I"]'), '原子パレットにヨウ素が出ている');
    });

    test('EL2: カリウム K をモデルに足した（Na とまったく同じ流儀。-COOK を線1本で書く）', async (c) => {
        const W = c.W, D = c.D;
        assert(W.VALENCIES && W.VALENCIES.K === 1, 'カリウムの価標が1でない');
        // 色。**Na と隣り合わせで出るアルカリ金属**なので、藤色と同じにしてはいけない
        const cssVar = (n) => W.getComputedStyle(D.documentElement).getPropertyValue(n).trim().toLowerCase();
        assert(/^#[0-9a-f]{3,8}$/.test(cssVar('--color-k')), `--color-k が定義されていない（"${cssVar('--color-k')}"）`);
        assert(cssVar('--color-k') !== cssVar('--color-na'), 'カリウムとナトリウムの色が同じ');
        // 乳酸カリウム CH₃-CH(OH)-COOK … -COOK は単結合1本（イオンは持ち込まない。v353 の流儀）
        const m = new W.Molecule();
        const a = ['C', 'C', 'O', 'C', 'O', 'O', 'K'].map(e => m.addAtom(e, 0, 0).id);
        [[0, 1, 1], [1, 2, 1], [1, 3, 1], [3, 4, 2], [3, 5, 1], [5, 6, 1]]
            .forEach(([i, j, t]) => m.addBond(a[i], a[j], t));
        assert(m.atoms.every(x => W.isValencyValid(m, x.id)), '-COOK の価標が不正');
        assert(m.getFreeValency(a[6]) === 0, 'カリウムに自動水素が生えている');
        // CIP の原子番号を持つ（cipRank は表に無い元素が1つでもあると分子ごと null を返す）
        assert(m.isAsymmetricCarbon(a[1]), '乳酸カリウムの不斉炭素を検出できない');
        const rank = W.cipRank(m, a[1]);
        assert(rank, 'K を含む分子で CIP の順位が付かない（原子番号表に K が無い）');
        assert(rank[0] === a[2], 'CIP で -OH が最優先になっていない');
        // パレットには出さない（Na と同じ扱い）
        assert(!D.querySelector('.atom-palette [data-atom="K"]'), '原子パレットにカリウムが出ている');
    });

    test('EL3: 窒素が4本になる文脈にアンモニウム型を足した（既存のアミン・ニトロは不変）', async (c) => {
        const W = c.W;
        const mk = (els, bonds) => {
            const m = new W.Molecule();
            const ids = els.map(e => m.addAtom(e, 0, 0).id);
            bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t || 1));
            return { m, ids };
        };
        // (1) 第四級アンモニウム N(CH₃)₄ … 単結合4本・相手はすべて炭素。通る＆自動水素は出ない
        let r = mk(['N', 'C', 'C', 'C', 'C'], [[0, 1], [0, 2], [0, 3], [0, 4]]);
        assert(W.isValencyValid(r.m, r.ids[0]), '第四級アンモニウム N(CH₃)₄ が価標超過と判定される');
        assert(r.m.getFreeValency(r.ids[0]) === 0, '第四級アンモニウムの N に自動水素が生えている');

        // (2) **ここが肝**: 既存のアミンが変わっていないこと。
        //     「N は常に4価」にすると -NH₂ の空き価標が 2→3 になり、すべてのアミンが -NH₃ で描かれる
        r = mk(['N', 'C'], [[0, 1]]);
        assert(r.m.getFreeValency(r.ids[0]) === 2, 'アミン -NH₂ の自動水素が2個でなくなった');
        r = mk(['N', 'C', 'C', 'C'], [[0, 1], [0, 2], [0, 3]]);
        assert(r.m.getFreeValency(r.ids[0]) === 0, '第三級アミンの自動水素が0個でなくなった');

        // (3) ニトロ基は不変（N も、H を付けない単結合の O も）
        r = mk(['N', 'C', 'O', 'O'], [[0, 1], [0, 2, 2], [0, 3]]);
        assert(W.isValencyValid(r.m, r.ids[0]), 'ニトロ基の N が通らなくなった');
        assert(r.m.getFreeValency(r.ids[3]) === 0, 'ニトロ基の単結合 O に自動水素が付いた');

        // (4) 通してはいけないもの。**ジアゾニウム N≡N⁺ は今回の対象外**（別のパターンなので分ける）
        r = mk(['N', 'C', 'C', 'C', 'C', 'C'], [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);
        assert(!W.isValencyValid(r.m, r.ids[0]), 'N が単結合5本でも通ってしまう');
        r = mk(['N', 'C', 'C', 'C'], [[0, 1, 2], [0, 2], [0, 3]]);
        assert(!W.isValencyValid(r.m, r.ids[0]), '二重結合を含む N(4)（イミニウム型）が通ってしまう');
        r = mk(['N', 'N', 'C'], [[0, 1, 3], [0, 2]]);
        assert(!W.isValencyValid(r.m, r.ids[0]), 'ジアゾニウム C-N≡N が通ってしまう（今回は対象外）');

        // (5) 新しい文脈が既存データに1件も当たらない（＝登録済みの分子の判定が変わらない）。
        //     ライブラリの N(4) はすべてニトロ型で、アンモニウム型は0件であること
        let nitro = 0, ammonium = 0;
        [...W.STAGES, ...W.COMPOUNDS].forEach(e => {
            if (!e.target) return;
            const m = c.game.createTargetFromData({ target: e.target });
            m.atoms.filter(a => a.element === 'N').forEach(a => {
                if (m.getUsedValency(a.id) !== 4) return;
                const nb = m.getNeighbors(a.id);
                if (nb.some(n => n.type === 2 && n.atom.element === 'O') &&
                    nb.some(n => n.type === 1 && n.atom.element === 'O')) nitro++;
                else if (nb.length === 4 && nb.every(n => n.type === 1 &&
                    (n.atom.element === 'C' || n.atom.element === 'H'))) ammonium++;
                else assert(false, `${e.name}: 分類できない N(4) がある`);
            });
        });
        // ⚠ **件数は決め打ちしない。** 当初は `nitro === 18` と書いてあったが、
        // 化合物ライブラリ第3弾（+143件・ベンゼン二置換体にニトロが多い）で 41 件になり落ちた。
        // **このテストが守りたいのは「新しい文脈が既存データに1件も当たらない」こと**で、
        // それは上のループの `分類できない N(4) がある` と下の `ammonium === 0` が担っている。
        // ニトロの実数は化合物を足すたびに動くので、**あることだけ**を確かめる
        assert(nitro > 0, 'ライブラリにニトロ型 N(4) が1件も無い（検査が素通りしている）');
        assert(ammonium === 0, `ライブラリにアンモニウム型 N(4) が ${ammonium} 件ある（0件の想定）`);
    });

    test('AK1: アルキル基の書き出し練習（付け根R・登録・命名・答え合わせ・付け根保護）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, ap = W.alkylPractice;
        assert(ap, 'alkylPractice が初期化されていない');
        g.setMode('learn');
        ap.start(3); // C₃H₇– : プロピル・イソプロピル
        assert(ap.active && ap.problem.n === 3 && ap.problem.total === 2, `開始状態が不正（total=${ap.problem && ap.problem.total}）`);
        // 付け根: 炭素C1（ロック）＋R（ロック）が自動配置
        const rs0 = g.userMolecule.atoms.filter(a => a.element === 'R');
        const cs0 = g.userMolecule.atoms.filter(a => a.element === 'C');
        assert(rs0.length === 1 && rs0[0].isLocked, 'R が置かれていない/ロックされていない');
        assert(cs0.length === 1 && cs0[0].isLocked, '付け根C1が置かれていない/ロックされていない');

        // 付け根は消せない（ロック原子の削除・付け根結合の削除が拒否される）
        const before = g.userMolecule.atoms.length;
        g.selectedTool = 'erase';
        c.clickAt(rs0[0].x, rs0[0].y); // R を消しゴムでクリック
        assert(g.userMolecule.atoms.length === before, '付け根マーカー R が消せてしまう');
        g.selectedTool = 'select';

        // プロピル: C1-C2-C3
        const c1 = g.userMolecule.atoms.find(a => a.element === 'C');
        const c2 = g.userMolecule.addAtom('C', 462, 300); g.userMolecule.addBond(c1.id, c2.id, 1);
        const c3 = g.userMolecule.addAtom('C', 504, 300); g.userMolecule.addBond(c2.id, c3.id, 1);
        g.updateDrawing();
        ap.register();
        assert(ap.entries.length === 1 && ap.entries[0].name === 'プロピル', `プロピル登録失敗（${ap.entries[0] && ap.entries[0].name}）`);
        // 登録後に付け根が置き直される
        assert(g.userMolecule.atoms.filter(a => a.element === 'R').length === 1 &&
            g.userMolecule.atoms.filter(a => a.element === 'C').length === 1, '登録後に付け根が置き直されない');
        // 右パネル(ak-body)の登録済みサムネが実際に描画される（renderSession の flushThumbs 欠落回帰の防止）
        const akBody = c.D.getElementById('ak-body');
        assert([...akBody.querySelectorAll('svg')].some(s => s.querySelector('.quiz-atoms') &&
            s.querySelector('.quiz-atoms').children.length > 0), '登録済み構造のサムネが右パネルに描画されない');

        // イソプロピル: C1に2本の枝
        const c1b = g.userMolecule.atoms.find(a => a.element === 'C');
        const c2b = g.userMolecule.addAtom('C', 420, 258); g.userMolecule.addBond(c1b.id, c2b.id, 1);
        const c3b = g.userMolecule.addAtom('C', 420, 342); g.userMolecule.addBond(c1b.id, c3b.id, 1);
        g.updateDrawing();
        ap.register();
        assert(ap.entries.length === 2, '2個目が登録されない');
        assert(ap.entries.map(e => e.name).sort().join(',') === 'イソプロピル,プロピル', `名前が違う（${ap.entries.map(e => e.name)}）`);
        assert(ap.uniqueCorrectCodes().size === 2, 'ちがう2種がそろわない');
        assert(W.localStorage.getItem('chemAlkylPractice.C3') === '1', 'クリア記録が残らない');

        // 答え合わせ: 全アルキル基が名前つきで並ぶ
        ap.openReview();
        const ov = c.D.getElementById('ak-review-overlay');
        assert(!ov.classList.contains('hidden'), '答え合わせが開かない');
        assert(/プロピル/.test(ov.textContent) && /イソプロピル/.test(ov.textContent), '全アルキル基の名前が出ない');
        assert([...ov.querySelectorAll('svg')].filter(s => s.querySelector('.quiz-atoms').children.length > 0).length >= 4, '答え合わせの図が描画されない');
        ap.closeReview();

        // 炭素数が違う（付け根のみ＝C1個）は登録できない
        const n = ap.entries.length;
        ap.register();
        assert(ap.entries.length === n, '炭素数不足が登録された');

        ap.stop();
        assert(!ap.active && ov.classList.contains('hidden'), 'stopで練習・オーバーレイが閉じない');
        g.setMode('puzzle');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    // ===== G. 学習体験の小粒改善（P7-4） =====

    test('G1: クリア状況のlocalStorage保存とドロップダウン✓表示', async (c) => {
        c.reset();
        c.W.localStorage.removeItem('chemAssembler.cleared');
        c.game.loadStage(0);
        c.game.selectedTool = 'select';
        c.game.selectedAtomType = 'O';
        const ev = c.toClient(400, 300);
        c.svg.dispatchEvent(c.pe('pointerdown', ev));
        c.W.dispatchEvent(c.pe('pointerup', ev));
        c.game.verifyCurrentStructure();
        await c.tick(1100); // 判定は800ms遅延
        assert(c.game.getClearedSet().has('水'), 'クリアがlocalStorageに保存されない');
        const opt = [...c.D.getElementById('select-stage').options].find(o => o.textContent.includes('水'));
        assert(opt && opt.textContent.startsWith('✓'), 'ドロップダウンに✓が表示されない');
        await c.tick(1300); // 勝利モーダル(1200ms遅延)を閉じる
        c.D.getElementById('win-modal').classList.add('hidden');
        c.W.localStorage.removeItem('chemAssembler.cleared');
        c.game.updateStageOptions(c.D.getElementById('select-series').value);
        c.game.selectedAtomType = 'C';
    });

    test('G2: Redo（Ctrl+Y）と新操作によるRedo履歴の破棄', async (c) => {
        c.reset();
        c.clickAt(336, 294); // C配置
        assert(c.game.userMolecule.atoms.length === 1, '配置失敗');
        c.game.undo();
        assert(c.game.userMolecule.atoms.length === 0, 'Undo失敗');
        c.game.redo();
        assert(c.game.userMolecule.atoms.length === 1, 'Redoで復元されない');
        c.game.undo();
        c.clickAt(378, 294); // 新しい操作 → Redo履歴は破棄される
        assert(c.game.userMolecule.atoms.length === 1, '新操作の配置失敗');
        c.game.redo();
        assert(c.game.userMolecule.atoms.length === 1, '破棄されたはずのRedoが実行された');
        // ショートカット Ctrl+Y
        c.game.undo();
        assert(c.game.userMolecule.atoms.length === 0, 'Undo失敗(2回目)');
        c.W.dispatchEvent(new c.W.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
        assert(c.game.userMolecule.atoms.length === 1, 'Ctrl+YでRedoされない');
    });

    test('G3: 任意員環は員数を先に選び、ゴースト→クリックで配置（7員環・キャンセル）', async (c) => {
        c.reset();
        const g = c.game, D = c.D;
        // モジュール選択で員数モーダルが開く
        D.querySelector('.mod-btn[data-module="n-ring"]').click();
        assert(g.selectedModule === 'n-ring' && !D.getElementById('nring-modal').classList.contains('hidden'),
            'n-ring選択で員数モーダルが開かない');
        // 7員環を選ぶ → モーダルが閉じ、員数が確定（モジュールは選択のまま）
        [...D.getElementById('nring-choices').children].find(b => b.textContent === '7員環').click();
        assert(g.nringSize === 7 && D.getElementById('nring-modal').classList.contains('hidden'),
            '7員環の選択後の状態が不正');
        // 選択後はゴースト計画が有効（＝プレビューが出る）
        const plan = g.getRingPlacementPlan('n-ring', 400, 300, g.nringSize);
        assert(plan.valid && plan.vertices.length === 7, 'ゴースト計画が7員環にならない');
        // キャンバスをクリックして配置
        c.clickAt(400, 300);
        assert(g.userMolecule.atoms.length === 7 && g.userMolecule.bonds.length === 7,
            `7員環が作られない（原子${g.userMolecule.atoms.length}・結合${g.userMolecule.bonds.length}）`);
        // キャンセル経路: モジュール選択が解除され、何も追加されない
        D.querySelector('.mod-btn[data-module="n-ring"]').click();
        D.getElementById('btn-nring-cancel').click();
        assert(g.selectedModule === null && D.getElementById('nring-modal').classList.contains('hidden'),
            'キャンセルでモジュール解除／モーダルが閉じない');
        assert(g.userMolecule.atoms.length === 7, 'キャンセルしたのに原子が増えた');
    });

    test('G4: 不斉マーク誤りは座標文字列ではなく原子ハイライトで示す', async (c) => {
        c.reset();
        const idx = c.W.STAGES.findIndex(s => s.name === '3-メチルヘキサン');
        c.game.loadStage(idx);
        c.game.userMolecule = c.game.createTargetFromData(c.W.STAGES[idx]);
        c.game.updateDrawing();
        c.game.judgeAsymmetric = true; // 判定オプションON。不斉炭素があるのにマーク無しのまま判定（P10 M2）
        c.game.verifyCurrentStructure();
        await c.tick(1100);
        const txt = c.D.getElementById('verify-result').textContent;
        assert(txt.includes('ハイライト'), 'ハイライト案内が表示されない');
        assert(!txt.includes('X:'), '座標文字列が残っている');
        assert(c.D.querySelectorAll('#ui-group circle').length >= 1, 'ハイライト円が描画されない');
        c.game.judgeAsymmetric = false;
        c.game.clearUIOverlay();
        c.game.loadStage(0);
    });

    // ===== H. 立体対照ビュー（P7-5-M1） =====

    test('H1: sp3炭素のくさび図モーダルと不斉連携', async (c) => {
        c.reset();
        const sv = c.W.stereoView;
        assert(sv, 'stereoView が初期化されていない');

        // 2-ブタノールを構築（C2が不斉炭素）
        const m = c.game.userMolecule;
        const c1 = m.addAtom('C', 295, 300);
        const c2 = m.addAtom('C', 337, 300);
        const c3 = m.addAtom('C', 379, 300);
        const c4 = m.addAtom('C', 421, 300);
        const o = m.addAtom('O', 337, 258);
        m.addBond(c1.id, c2.id, 1);
        m.addBond(c2.id, c3.id, 1);
        m.addBond(c3.id, c4.id, 1);
        m.addBond(c2.id, o.id, 1);
        c.game.updateDrawing();

        // 立体表示ボタンは中心を選ばせずに即開く（P12-8。入り口で止まらないようにした）。
        // 2-ブタノールでは不斉炭素C2が自動で選ばれる
        c.D.getElementById('btn-stereo').click();
        assert(!sv.picking, '選択モード待ちになっている（中心は自動で選ぶべき）');
        assert(!c.D.getElementById('stereo-modal').classList.contains('hidden'), '立体表示ボタンでモーダルが開かない');
        assert(sv.centerId === c2.id, `自動で選ばれた中心が不斉炭素C2でない（${sv.centerId} / C2=${c2.id}）`);
        assert(c.D.getElementById('stereo-center-label').textContent.includes('不斉炭素'),
            `中心の表示が「不斉炭素」でない（${c.D.getElementById('stereo-center-label').textContent}）`);
        // 「別の炭素を選ぶ」で選択モードに入り、C3（不斉でない）へ切り替えられる
        c.D.getElementById('btn-stereo-pick').click();
        assert(sv.picking, '「別の炭素を選ぶ」で選択モードにならない');
        assert(c.D.getElementById('stereo-modal').classList.contains('hidden'), '選択モード中もモーダルが開いている');
        c.clickAt(379, 300);
        assert(!sv.picking, '選択モードが解除されない');
        assert(sv.centerId === c3.id, '選び直した中心が反映されない');
        // 中心をC2に戻して以降の検証を続ける
        c.D.getElementById('btn-stereo-pick').click();
        c.clickAt(337, 300);
        assert(!sv.picking, '選択モードが解除されない');
        assert(!c.D.getElementById('stereo-modal').classList.contains('hidden'), 'モーダルが開かない');
        const cap = c.D.getElementById('stereo-caption').textContent;
        assert(cap.includes('109.5'), '結合角109.5°の説明がない');
        assert(cap.includes('不斉炭素原子です'), '不斉炭素原子の説明がない');
        assert(c.D.querySelectorAll('#stereo-svg text').length >= 5, 'くさび図のラベルが不足'); // 中心C+置換基4
        // P12-8 でフィッシャー準拠に変更: 横（左・右）の2本が塗りくさび、縦（上・下）の2本がハッシュ
        assert(c.D.querySelectorAll('#stereo-svg polygon').length === 2, '手前くさび（左右2本）が描かれない');
        c.D.getElementById('btn-stereo-close').click();
        assert(c.D.getElementById('stereo-modal').classList.contains('hidden'), 'モーダルが閉じない');

        // sp3炭素が無い分子（ベンゼン）: 1つの炭素まわりの図は描けないが、
        // 分子全体の立体は意味があるので「🧊 分子全体」で開く（P12-8 M4c）
        c.game.userMolecule = new c.W.Molecule();
        c.game.placeModule('benzene', 400, 300, null);
        c.game.updateDrawing();
        c.D.getElementById('btn-stereo').click();
        assert(!c.D.getElementById('stereo-modal').classList.contains('hidden'), 'ベンゼンでモーダルが開かない');
        assert(sv.mode === 'mol', `ベンゼンで「分子全体」が開かない（mode=${sv.mode}）`);
        assert(sv.centerId === null, '中心炭素を選んでいないのに centerId が入っている');
        assert(c.D.getElementById('btn-stereo-tab-wedge').disabled &&
               c.D.getElementById('btn-stereo-tab-3d').disabled,
            'sp3炭素が無いのに、くさび図・1炭素3Dのタブが有効になっている');
        assert(c.D.getElementById('stereo-center-label').textContent.includes('分子全体'),
            '「分子全体を表示しています」の表示が無い');
        assert(!sv.picking, '選択モードに入っている');
        sv.setMolSpin(false);
        c.D.getElementById('btn-stereo-close').click();
        // 選択モードでは非sp3炭素を拒否する（選び直しの経路）
        const ring0 = c.game.userMolecule.atoms[0];
        sv.picking = true;
        c.clickAt(ring0.x, ring0.y);
        assert(c.D.getElementById('stereo-modal').classList.contains('hidden'), '非sp3でモーダルが開いた');
        assert(c.D.getElementById('verify-result').textContent.includes('sp3'), '拒否の理由が出ない');
        assert(!sv.picking, '拒否後に選択モードが解除されない');

        // メタン（不斉でない）: 同一置換基の説明。sp3炭素が1つなので自動選択で開く
        c.game.userMolecule = new c.W.Molecule();
        c.game.userMolecule.addAtom('C', 400, 300);
        c.game.updateDrawing();
        c.D.getElementById('btn-stereo').click();
        assert(c.D.getElementById('stereo-center-label').textContent === '中心の炭素: sp3炭素',
            `メタンの中心表示が想定外（${c.D.getElementById('stereo-center-label').textContent}）`);
        const cap2 = c.D.getElementById('stereo-caption').textContent;
        assert(cap2.includes('不斉炭素原子ではありません'), 'メタンで不斉否定の説明がない');
        c.D.getElementById('btn-stereo-close').click();
        c.D.getElementById('verify-result').classList.add('hidden');
    });

    // ===== I. タッチ入力 =====

    test('I1: ピンチの誤配置巻き戻し・結合上からのピンチ・タッチ伸縮', async (c) => {
        c.reset();
        const g = c.game;
        const tpe = (type, xy, id) => new c.W.PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
            isPrimary: id === 10, button: type === 'pointermove' ? -1 : 0,
            clientX: xy.clientX, clientY: xy.clientY
        });

        // 1. 空きマスに1本目の指→原子が置かれる→2本目の指でピンチ→配置が巻き戻る
        const hist0 = g.history.length;
        c.svg.dispatchEvent(tpe('pointerdown', c.toClient(358, 300), 10));
        assert(g.userMolecule.atoms.length === 1, '1本目のタッチで原子が置かれない');
        c.svg.dispatchEvent(tpe('pointerdown', c.toClient(442, 384), 11));
        assert(g.pinch, 'ピンチが開始されない');
        assert(g.userMolecule.atoms.length === 0, 'ピンチ開始で配置が巻き戻らない');
        assert(g.history.length === hist0, '巻き戻した配置の幽霊Undo履歴が残る');
        const w0 = c.svg.viewBox.baseVal.width;
        c.svg.dispatchEvent(tpe('pointermove', c.toClient(337, 279), 10));
        c.svg.dispatchEvent(tpe('pointermove', c.toClient(463, 405), 11));
        assert(c.svg.viewBox.baseVal.width < w0, 'ピンチアウトでズームインしない');
        c.W.dispatchEvent(tpe('pointerup', c.toClient(337, 279), 10));
        c.W.dispatchEvent(tpe('pointerup', c.toClient(463, 405), 11));
        assert(!g.pinch && g.userMolecule.atoms.length === 0, 'ピンチ終了後の状態が不正');
        g.fitCanvasToTarget();

        // 2. タッチドラッグで結合伸縮（動く側はデータ順に依存するため両方向を試す）
        const a1 = g.userMolecule.addAtom('C', 358, 300);
        const a2 = g.userMolecule.addAtom('C', 400, 300);
        g.userMolecule.addBond(a1.id, a2.id, 1);
        g.updateDrawing();
        const bondLen = () => {
            const [p, q] = g.userMolecule.atoms;
            return Math.hypot(q.x - p.x, q.y - p.y);
        };
        const tryStretch = (dir) => {
            const [p, q] = g.userMolecule.atoms;
            const mx = (p.x + q.x) / 2;
            c.hitbox(0).dispatchEvent(tpe('pointerdown', c.toClient(mx, 300), 10));
            c.svg.dispatchEvent(tpe('pointermove', c.toClient(mx + dir * 84, 300), 10));
            c.W.dispatchEvent(tpe('pointerup', c.toClient(mx + dir * 84, 300), 10));
        };
        tryStretch(1);
        await c.tick();
        if (near(bondLen(), 42)) tryStretch(-1); // 動く側が左だった場合は逆方向へ
        await c.tick();
        assert(near(bondLen(), 126), `タッチ伸縮後の結合長が ${bondLen().toFixed(1)}（126を期待）`);

        // 3. 結合の上から始まる2本指ピンチ（従来はピンチと認識されなかった）
        const hist1 = g.history.length;
        const lenBefore = bondLen();
        const [p3, q3] = g.userMolecule.atoms;
        const mx3 = (p3.x + q3.x) / 2;
        c.hitbox(0).dispatchEvent(tpe('pointerdown', c.toClient(mx3, 300), 10));
        c.svg.dispatchEvent(tpe('pointerdown', c.toClient(mx3 + 42, 384), 11));
        assert(g.pinch, '結合上から始まるピンチが開始されない');
        assert(!g.bondStretch, 'ピンチ開始で伸縮がキャンセルされない');
        assert(g.history.length === hist1, '伸縮開始の幽霊Undo履歴が残る');
        c.W.dispatchEvent(tpe('pointerup', c.toClient(mx3, 300), 10));
        c.W.dispatchEvent(tpe('pointerup', c.toClient(mx3 + 42, 384), 11));
        assert(near(bondLen(), lenBefore), 'ピンチで結合長が変わった');

        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        g.fitCanvasToTarget();
    });

    // ===== J. 環モジュールの縮合スナップ（P7-8） =====

    test('I2: 2本指ドラッグでキャンバスをパン（ピンチズームと同時併用。P11-M2d）', async (c) => {
        c.reset();
        const tpe = (type, cl, id) => new c.W.PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
            isPrimary: id === 10, button: type === 'pointermove' ? -1 : 0,
            clientX: cl.clientX, clientY: cl.clientY
        });
        const vb = c.svg.viewBox.baseVal;
        const x0 = vb.x, y0 = vb.y, w0 = vb.width;

        // 2本指を置き、間隔を保ったまま両指を右下へ動かす → 純パン（倍率は不変）
        const p1 = c.toClient(358, 300), p2 = c.toClient(442, 300);
        c.svg.dispatchEvent(tpe('pointerdown', p1, 10));
        c.svg.dispatchEvent(tpe('pointerdown', p2, 11));
        const shift = cl => ({ clientX: cl.clientX + 50, clientY: cl.clientY + 30 });
        c.svg.dispatchEvent(tpe('pointermove', shift(p1), 10));
        c.svg.dispatchEvent(tpe('pointermove', shift(p2), 11));
        assert(Math.abs(vb.width - w0) < 1, `平行移動で倍率が変わった（${w0}→${vb.width}）`);
        assert(vb.x < x0 - 1 && vb.y < y0 - 1,
            `右下への2本指ドラッグでviewBoxが左上へ動かない（x:${x0}→${vb.x}, y:${y0}→${vb.y}）`);

        // 続けて間隔を広げる → パン位置を保ったままズームイン（幅が縮む）
        const s1 = { clientX: p1.clientX + 50 - 40, clientY: p1.clientY + 30 };
        const s2 = { clientX: p2.clientX + 50 + 40, clientY: p2.clientY + 30 };
        c.svg.dispatchEvent(tpe('pointermove', s1, 10));
        c.svg.dispatchEvent(tpe('pointermove', s2, 11));
        assert(vb.width < w0 - 1, 'ピンチアウトでズームインしない');

        c.W.dispatchEvent(tpe('pointerup', s1, 10));
        c.W.dispatchEvent(tpe('pointerup', s2, 11));
        assert(c.game.userMolecule.atoms.length === 0, 'パン操作で原子が置かれた');
        c.D.getElementById('btn-reset-view').click(); // 後続テストのため視野を戻す
    });

    // ===== I3〜I7: タッチ操作の削除・復旧（P12-B1。iPad実機不具合対応） =====

    // エタン（C-C）を実座標で組み、結合の判定線（hitbox）を返すヘルパー
    function buildEthaneWithHitbox(c) {
        const g = c.game;
        g.userMolecule = new c.W.Molecule();
        const a1 = g.userMolecule.addAtom('C', 379, 300);
        const a2 = g.userMolecule.addAtom('C', 421, 300);
        g.userMolecule.addBond(a1.id, a2.id, 1);
        g.updateDrawing();
        const hb = c.hitbox(0);
        assert(hb, '結合の判定線が描画されない');
        return { a1, a2, hb };
    }

    test('I3: 消しゴムで結合の判定線をクリック → 結合だけ削除（原子は残る）', async (c) => {
        c.reset();
        const g = c.game;
        const { hb } = buildEthaneWithHitbox(c);
        g.selectedTool = 'erase';
        hb.dispatchEvent(c.pe('pointerdown', c.toClient(400, 300)));
        c.W.dispatchEvent(c.pe('pointerup', c.toClient(400, 300)));
        assert(g.userMolecule.bonds.length === 0, '消しゴムで結合が消えない');
        assert(g.userMolecule.atoms.length === 2, '結合削除で原子まで消えた');
        // 判定線上でも click で次数トグルが走らない（削除済みフラグの消し込み）
        assert(g.userMolecule.bonds.length === 0, '削除後に結合が復活した');
        g.selectedTool = 'select';
    });

    test('I4: 結合判定線の上でも原子タップは原子操作を優先（同元素タップで原子削除）', async (c) => {
        c.reset();
        const g = c.game;
        const { a1, hb } = buildEthaneWithHitbox(c);
        g.selectedTool = 'select';
        g.selectedAtomType = 'C';
        // 原子中心の座標で「判定線に」pointerdown（太い判定線が原子タップを奪う状況の再現）
        hb.dispatchEvent(c.pe('pointerdown', c.toClient(379, 300)));
        c.W.dispatchEvent(c.pe('pointerup', c.toClient(379, 300)));
        assert(!g.userMolecule.atoms.find(a => a.id === a1.id), '判定線上の原子タップで原子が消えない');
        assert(g.userMolecule.bonds.length === 0, '原子削除に伴い結合も消えるべき');
        assert(g.userMolecule.atoms.length === 1, '残る原子数が不正');
    });

    test('I5: 幽霊ポインタからの自動復旧（pointerup喪失後も1本指で作図できる）', async (c) => {
        c.reset();
        const g = c.game;
        // pointerupが届かず指が残った状況を再現（iOSのジェスチャ奪取相当）
        g.activePointers.set(999, { x: 0, y: 0 });
        g.pinch = { startDist: 100, startWidth: 800, startHeight: 600, anchor: { x: 0, y: 0 } };
        // isPrimaryなタッチ＝新しいタッチ列の開始 → 幽霊を破棄して普通に作図できること
        const cl = c.toClient(400, 300);
        const tpe = (type) => new c.W.PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 20, pointerType: 'touch',
            isPrimary: true, button: 0, clientX: cl.clientX, clientY: cl.clientY
        });
        c.svg.dispatchEvent(tpe('pointerdown'));
        c.W.dispatchEvent(tpe('pointerup'));
        assert(!g.activePointers.has(999), '幽霊ポインタが破棄されない');
        assert(g.pinch === null, '幽霊ピンチ状態が解除されない');
        assert(g.userMolecule.atoms.length === 1, '復旧後の1本指タップで原子が置けない');
    });

    test('I6: タッチ長押し（550ms）で結合を削除', async (c) => {
        c.reset();
        const g = c.game;
        const { hb } = buildEthaneWithHitbox(c);
        g.selectedTool = 'select';
        const cl = c.toClient(400, 300);
        const tpe = (type, id) => new c.W.PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
            isPrimary: true, button: 0, clientX: cl.clientX, clientY: cl.clientY
        });
        hb.dispatchEvent(tpe('pointerdown', 21));
        assert(g.userMolecule.bonds.length === 1, '長押し前に結合が消えた');
        await c.tick(700); // 550msの長押しタイマー発火を待つ
        assert(g.userMolecule.bonds.length === 0, '長押しで結合が消えない');
        assert(g.userMolecule.atoms.length === 2, '長押し削除で原子まで消えた');
        c.W.dispatchEvent(tpe('pointerup', 21));
        // 伸縮開始時に積まれた履歴は巻き戻され、Undo1回で結合が復活する
        g.undo();
        assert(g.userMolecule.bonds.length === 1, 'Undo1回で長押し削除が取り消せない（履歴の二重積み）');
    });

    test('I7: タッチのすばやい2回タップで結合を削除（iOSはdblclick非発火のため自前判定）', async (c) => {
        c.reset();
        const g = c.game;
        const { hb } = buildEthaneWithHitbox(c);
        g.selectedTool = 'select';
        const cl = c.toClient(400, 300);
        const tap = (id) => {
            const mk = (type) => new c.W.PointerEvent(type, {
                bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
                isPrimary: true, button: 0, clientX: cl.clientX, clientY: cl.clientY
            });
            hb.dispatchEvent(mk('pointerdown'));
            hb.dispatchEvent(mk('pointerup')); // hitbox上で離す（バブリングでwindowにも届く）
        };
        tap(31);
        assert(g.userMolecule.bonds.length === 1, '1回目のタップで結合が消えた');
        tap(32); // 400ms以内の2回目
        assert(g.userMolecule.bonds.length === 0, '2回タップで結合が消えない');
        assert(g.userMolecule.atoms.length === 2, '2回タップ削除で原子まで消えた');
    });

    test('R5: シート連動は畳んだ —— 開く相手が無いので何も開かない（第5段。旧 R5 / R5b）', async (c) => {
        // 旧 R5 は「右パネル内の要素を対象にするとシートが開く」、旧 R5b は
        // 「見えないボタンのためには開かない」を見ていた。**右パネルごと消えた**ので、
        // 主張を「開かないこと」に畳む。⚠ メソッドは残してある（`?rec=` の再生経路が呼ぶ）
        c.reset();
        const p = c.W.tutorialPlayer, D = c.D;
        assert(p && typeof p.setSheetOpen === 'function' && typeof p.syncSheetFor === 'function' &&
            typeof p.syncSheetForButton === 'function',
            'シート連動 API が消えている（無害化して残す約束。台本の再生経路が呼ぶ）');
        const orig = p.isMobileLayout;
        p.isMobileLayout = () => true; // モバイル判定を強制（iframe は広幅のため）
        try {
            c.W.document.body.classList.remove('sheet-open');
            // 見えている押しもの（作業帯の 🔬 調べる）でも、隠れている押しもの（学習のクイズ）でも開かない
            c.game.setMode('free');
            for (const id of ['btn-molecule-modal', 'btn-time-attack', 'summon-input']) {
                const el = D.getElementById(id);
                assert(el, `${id} が無い（前提が崩れている）`);
                await p.syncSheetFor(el, true);
                assert(!c.W.document.body.classList.contains('sheet-open'),
                    `${id} を対象に syncSheetFor でシートが開いた（開く相手はもう無い）`);
                await p.syncSheetForButton(el, true);
                assert(!c.W.document.body.classList.contains('sheet-open'),
                    `${id} を対象に syncSheetForButton でシートが開いた`);
            }
            // キャンバス系アクションも従来どおり通る（閉じる側の呼び出しは残っている）
            await p.doAction({ type: 'hover', x: 400, y: 300 }, true);
            assert(!c.W.document.body.classList.contains('sheet-open'), 'キャンバス操作でシートが開いた');
        } finally {
            p.isMobileLayout = orig;
            c.W.document.body.classList.remove('sheet-open');
        }
    });

    test('J1: 縮合スナップでナフタレン・デカリン、重なりは拒否', async (c) => {
        c.reset();
        const g = c.game;
        const m = () => g.userMolecule;

        // ベンゼンを置き、辺の外側にカーソル→吸着ゴースト→クリックでナフタレン
        g.selectedModule = 'benzene';
        c.clickAt(420, 294);
        assert(m().atoms.length === 6, 'ベンゼンが置けない');
        g.selectedModule = 'benzene';
        c.hoverAt(473, 324); // 右下辺の縮合中心(472.5,324.4)付近
        assert(c.D.querySelectorAll('#ui-group polygon').length === 1, '環ゴーストが表示されない');
        c.clickAt(473, 324);
        assert(m().atoms.length === 10 && m().bonds.length === 11,
            `ナフタレンにならない（原子${m().atoms.length}・結合${m().bonds.length}）`);
        assert(g.computeMolecularFormula() === 'C₁₀H₈', `分子式が${g.computeMolecularFormula()}`);
        // ケクレ交互の維持: 全Cが二重結合をちょうど1本持つ
        const dbl = m().atoms.filter(a =>
            m().getNeighbors(a.id).filter(n => n.type === 2).length === 1).length;
        assert(dbl === 10, `二重結合の割り当てが不正（1本持ちが${dbl}/10原子）`);

        // シクロヘキサン×2 → デカリン
        c.reset();
        g.selectedModule = 'cyclohexane';
        c.clickAt(420, 294);
        g.selectedModule = 'cyclohexane';
        c.clickAt(493, 294); // 右辺(x=456.4)の縮合中心(492.7,294)付近
        assert(m().atoms.length === 10 && m().bonds.length === 11,
            `デカリンにならない（原子${m().atoms.length}・結合${m().bonds.length}）`);
        assert(g.computeMolecularFormula() === 'C₁₀H₁₈', `分子式が${g.computeMolecularFormula()}`);

        // 既存の環と重なる位置は拒否され、Undo履歴も消費しない
        const na = m().atoms.length, nh = g.history.length;
        g.selectedModule = 'cyclohexane';
        c.clickAt(450, 294); // 環の内部
        assert(m().atoms.length === na, '重なり配置が拒否されない');
        assert(g.history.length === nh, '拒否時にUndo履歴が消費された');
        assert(c.D.getElementById('verify-result').textContent.includes('配置できません'),
            '拒否トーストが出ない');
        c.D.getElementById('verify-result').classList.add('hidden');
    });

    test('J2: 手描き直交環では格子方向を優先（±30°抑制）・縮合環の手描き構築', async (c) => {
        c.reset();
        const g = c.game;
        const m = g.userMolecule;
        g.selectedTool = 'select';
        g.selectedAtomType = 'C';
        g.selectedModule = null;

        // 長方形（2×1グリッド）の六員環をクリックだけで描く
        [[294,294],[336,294],[378,294],[378,336],[336,336],[294,336]].forEach(p => c.clickAt(p[0], p[1]));
        assert(m.atoms.length === 6, `6原子にならない（${m.atoms.length}）`);
        assert(m.bonds.length === 7, `外周6＋中央の縦1の7結合にならない（${m.bonds.length}）`);
        // 中央の縦結合を切断 → 長方形の六員環
        const a1 = m.atoms.find(a => near(a.x, 336, 1) && near(a.y, 294, 1));
        const a2 = m.atoms.find(a => near(a.x, 336, 1) && near(a.y, 336, 1));
        g.handleBondInteraction(m.getBond(a1.id, a2.id), true);
        assert(m.bonds.length === 6 && g.computeMolecularFormula() === 'C₆H₁₂', '長方形六員環にならない');

        // 環の右へ格子方向に伸ばして2つ目の環を手描き（v101以前は±30°の斜め配置になり構築不能だった）
        [[420,294],[462,294],[462,336],[420,336]].forEach(p => c.clickAt(p[0], p[1]));
        const b1 = m.atoms.find(a => near(a.x, 420, 1) && near(a.y, 294, 1));
        assert(b1, '環の隣が格子位置に置かれない（±30°抑制が効いていない）');
        const b2 = m.atoms.find(a => near(a.x, 420, 1) && near(a.y, 336, 1));
        assert(b2, '2つ目の環が閉じる位置に置かれない');
        g.handleBondInteraction(m.getBond(b1.id, b2.id), true);
        assert(m.atoms.length === 10 && m.bonds.length === 11,
            `デカリン骨格にならない（原子${m.atoms.length}・結合${m.bonds.length}）`);
        assert(g.computeMolecularFormula() === 'C₁₀H₁₈', `分子式が${g.computeMolecularFormula()}`);
        await c.tick();
    });

    test('J3: 官能基モジュールのゴースト＝実配置・価標/重なり拒否', async (c) => {
        c.reset();
        const g = c.game;

        // 単独炭素に -COOH: ホバーでゴースト（C,O,O）を表示
        const base = g.userMolecule.addAtom('C', 336, 294);
        g.updateDrawing();
        g.selectedModule = 'cooh';
        c.hoverAt(336, 294);
        const ghostTexts = [...c.D.querySelectorAll('#ui-group text')].map(t => t.textContent).sort().join(',');
        assert(ghostTexts === 'C,O,O', `ゴーストの元素表示が「${ghostTexts}」（C,O,Oを期待）`);

        // クリック配置がゴースト（計画）と完全一致 → 酢酸
        const plan = g.getFunctionalGroupPlan('cooh', base);
        c.clickAt(336, 294);
        assert(g.userMolecule.atoms.length === 4, 'COOHが配置されない');
        plan.atoms.forEach(pa => {
            assert(g.userMolecule.atoms.some(a =>
                a.element === pa.element && near(a.x, pa.x, 1) && near(a.y, pa.y, 1)),
                'ゴーストと実配置の位置がずれた');
        });
        assert(g.computeMolecularFormula() === 'C₂H₄O₂', `分子式が${g.computeMolecularFormula()}`);

        // 空き価標のない原子（カルボニルC）への配置は拒否・Undo履歴も消費しない
        const cc = g.userMolecule.atoms.find(a =>
            a.element === 'C' && g.userMolecule.getFreeValency(a.id) === 0);
        const n0 = g.userMolecule.atoms.length, h0 = g.history.length;
        g.selectedModule = 'oh';
        c.clickAt(cc.x, cc.y);
        assert(g.userMolecule.atoms.length === n0, '空き価標なしへの配置が拒否されない');
        assert(g.history.length === h0, '拒否時にUndo履歴が消費された');
        assert(c.D.getElementById('verify-result').textContent.includes('価標'), '拒否トーストが出ない');
        c.D.getElementById('verify-result').classList.add('hidden');
    });

    // ===== K. 価標・分子式の化学的正しさ =====

    test('K1: ニトロ基の単結合Oに自動水素を付けない（C₆H₅NO₂）', async (c) => {
        c.reset();
        const g = c.game;
        g.placeModule('benzene', 420, 294, null);
        const ring = g.userMolecule.atoms.filter(a => a.element === 'C');
        g.placeModule('no2', ring[0].x, ring[0].y, ring[0]);
        assert(g.computeMolecularFormula() === 'C₆H₅NO₂',
            `ニトロベンゼンの分子式が${g.computeMolecularFormula()}（C₆H₅NO₂を期待）`);
        const oSingle = g.userMolecule.atoms.find(a => a.element === 'O' &&
            g.userMolecule.getNeighbors(a.id).length === 1 &&
            g.userMolecule.getNeighbors(a.id)[0].type === 1);
        assert(g.userMolecule.getFreeValency(oSingle.id) === 0, 'ニトロOの空き価標が0でない');
        assert(g.userMolecule.calculateHydrogens().every(h => h.parentId !== oSingle.id),
            'ニトロOに自動水素が描かれている');
        // 正解判定（ステージ照合）は維持される
        assert(c.W.verifyMolecule(g.userMolecule,
            g.createTargetFromData(c.W.STAGES.find(s => s.name === 'ニトロベンゼン'))),
            'ニトロベンゼンの正解判定が壊れた');
        // 反応ビューアの生成物予測ターゲットも正しい分子式になる
        const rp = c.W.reactionPlayer;
        rp.checkMode.checked = true;
        rp.enter(rp.reactions.findIndex(r => r.name.includes('ニトロ化')));
        const t = rp.buildMainProductTarget();
        assert(g.computeMolecularFormula(t) === 'C₆H₅NO₂',
            `予測ターゲットの分子式が${g.computeMolecularFormula(t)}`);
        rp.exit();
    });

    test('K2: 結合の判定領域上でもモジュール配置が効く（クリック握りつぶし修正）', async (c) => {
        c.reset();
        const g = c.game;
        const a1 = g.userMolecule.addAtom('C', 336, 294);
        const a2 = g.userMolecule.addAtom('C', 378, 294);
        g.userMolecule.addBond(a1.id, a2.id, 1);
        g.updateDrawing();
        g.selectedModule = 'benzene';
        // 結合線の8px下（幅20pxのヒットライン内）をヒットラインに向けてクリック
        const ev = c.toClient(357, 302);
        c.hitbox(0).dispatchEvent(c.pe('pointerdown', ev));
        c.W.dispatchEvent(c.pe('pointerup', ev));
        assert(g.userMolecule.atoms.length === 6,
            `既存結合を1辺にベンゼンが縮合しない（原子${g.userMolecule.atoms.length}）`);
        assert(g.computeMolecularFormula() === 'C₆H₆', `分子式が${g.computeMolecularFormula()}`);
        assert(g.selectedModule === null, '配置後にモジュール選択が解除されない');
        // 合成clickで結合次数がトグルされない（抑止フラグの確認）
        const t0 = g.userMolecule.getBond(a1.id, a2.id).type;
        const hit = c.D.querySelector('.svg-bond-hitbox');
        if (hit) hit.dispatchEvent(new c.W.MouseEvent('click', { bubbles: true }));
        assert(g.userMolecule.getBond(a1.id, a2.id).type === t0, '配置直後のclickで次数が変わった');
        await c.tick();
    });

    test('K3: 削除で分子が分かれたら案内トーストを出す', async (c) => {
        c.reset();
        const g = c.game;
        const ids = [[294, 294], [336, 294], [378, 294]].map(p => g.userMolecule.addAtom('C', p[0], p[1]));
        g.userMolecule.addBond(ids[0].id, ids[1].id, 1);
        g.userMolecule.addBond(ids[1].id, ids[2].id, 1);
        g.updateDrawing();
        // 中央の原子を選択ツールの同元素クリックで削除 → 2分子に分裂
        g.selectedTool = 'select';
        g.selectedAtomType = 'C';
        c.clickAt(336, 294);
        assert(g.userMolecule.atoms.length === 2, '中央原子が削除されない');
        assert(g.countMolecules() === 2, '2分子に分かれていない');
        assert(c.D.getElementById('verify-result').textContent.includes('分かれました'),
            '分裂の案内トーストが出ない');
        // 末端原子の削除では分裂しないのでトーストを出さない
        c.D.getElementById('verify-result').classList.add('hidden');
        c.D.getElementById('verify-result').textContent = '';
        c.clickAt(294, 294);
        assert(g.userMolecule.atoms.length === 1, '末端原子が削除されない');
        assert(!c.D.getElementById('verify-result').textContent.includes('分かれました'),
            '分裂していないのにトーストが出た');
    });

    // ===== L. 反応実行モード（P9-1） =====

    test('L1: 名称呼び出しとプロパティ（官能基分類）表示', async (c) => {
        c.reset();
        const g = c.game;
        const input = c.D.getElementById('summon-input');
        assert(input && c.D.getElementById('summon-list').children.length >= 100,
            '名称候補リストが構築されていない');

        // エタノールを呼び出し → 1級アルコールと分類される
        input.value = 'エタノール';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(g.userMolecule.atoms.length === 3, `エタノールが配置されない（原子${g.userMolecule.atoms.length}）`);
        const props1 = c.D.getElementById('molecule-props').textContent;
        assert(props1.includes('1級アルコール'), `プロパティが「${props1}」（1級アルコールを期待）`);
        assert(c.D.getElementById('compound-name').textContent.includes('エタノール'), '名称判定が出ない');

        // 酢酸を追加呼び出し → 2分子・重なりなし・カルボキシ基が加わる
        input.value = '酢酸';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(g.countMolecules() === 2, '2分子にならない');
        const atoms = g.userMolecule.atoms;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                assert(Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y) >= 24,
                    '呼び出した分子が既存分子と重なった');
            }
        }
        const props2 = c.D.getElementById('molecule-props').textContent;
        assert(props2.includes('カルボキシ基') && props2.includes('【2分子】'),
            `プロパティが「${props2}」`);

        // Undoで呼び出し前に戻る
        g.undo();
        assert(g.countMolecules() === 1 && g.userMolecule.atoms.length === 3, 'Undoで戻らない');

        // 官能基検出の追加ケース: 2-ブタノール（2級）とアセトン（ケトン）
        const check = (name, expect) => {
            g.userMolecule = new c.W.Molecule();
            g.updateDrawing();
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
            const t = c.D.getElementById('molecule-props').textContent;
            assert(t.includes(expect), `${name} のプロパティが「${t}」（${expect}を期待）`);
        };
        check('2-ブタノール', '2級アルコール');
        check('アセトン', 'ケトン');
        check('フェノール', 'フェノール性ヒドロキシ基');
        check('ニトロベンゼン', 'ニトロ基');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('L2: 反応実行M2（酸化の連鎖・3級の解説・分子内脱水とザイツェフ則）', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };
        const clickRule = (kw) => {
            const btn = [...c.D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes(kw));
            assert(btn, `「${kw}」の反応ボタンがない`);
            btn.click();
        };
        const nameShown = () => c.D.getElementById('compound-name').textContent;

        // エタノール → 酸化 → アセトアルデヒド → 酸化 → 酢酸（連鎖実行）
        summon('エタノール');
        clickRule('アルデヒド');
        assert(nameShown().includes('アセトアルデヒド'), `酸化後の名称が「${nameShown()}」`);
        clickRule('カルボン酸');
        assert(nameShown().includes('酢酸'), `再酸化後の名称が「${nameShown()}」`);
        // Undo×2 でエタノールに戻る
        g.undo();
        g.undo();
        assert(nameShown().includes('エタノール'), 'Undoでエタノールに戻らない');

        // 分子内脱水 → エテン + 水（2分子・C=Cができる・Oは孤立して水になる）
        clickRule('脱水');
        assert(g.countMolecules() === 2, '脱水で2分子（アルケン＋水）にならない');
        const dbl = g.userMolecule.bonds.find(b => b.type === 2);
        assert(dbl, '脱水でC=Cができない');
        const oAtom = g.userMolecule.atoms.find(a => a.element === 'O');
        assert(g.userMolecule.getNeighbors(oAtom.id).length === 0 &&
               g.userMolecule.getFreeValency(oAtom.id) === 2, '脱離したOが水(H₂O)になっていない');

        // 2級アルコール: 2-ブタノール → ケトン（ブタノン）
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        summon('2-ブタノール');
        clickRule('ケトン');
        assert(nameShown().includes('ブタノン'), `2級酸化後の名称が「${nameShown()}」`);

        // 3級アルコール: 解説のみ（分子は変化せずUndo履歴も積まない）
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        summon('2-メチル-2-プロパノール');
        const atoms0 = g.userMolecule.atoms.length;
        const hist0 = g.history.length;
        clickRule('3級アルコール');
        assert(g.userMolecule.atoms.length === atoms0, '3級の解説ボタンで分子が変化した');
        assert(g.history.length === hist0, '3級の解説ボタンでUndo履歴が積まれた');
        assert(c.D.getElementById('verify-result').textContent.includes('酸化されにくい'),
            '3級の解説トーストが出ない');

        // ザイツェフ則: 2-ブタノールの脱水 → 2-ブテン（1-ブテンではなく）
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        summon('2-ブタノール');
        clickRule('脱水');
        const db2 = g.userMolecule.bonds.find(b => b.type === 2);
        assert(db2, '2-ブタノールの脱水でC=Cができない');
        const ends = [db2.atomId1, db2.atomId2].map(id =>
            g.userMolecule.getNeighbors(id).filter(n => n.atom.element === 'C').length);
        assert(ends.every(n => n === 2), `末端C=C（1-ブテン）になった（隣接C数 ${ends}）`);

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('L3: 反応実行M3（エステル化・分子間脱水の二分子反応）', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };
        const clickRule = (kw) => {
            const btn = [...c.D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes(kw));
            assert(btn, `「${kw}」の反応ボタンがない`);
            btn.click();
        };
        const nameShown = () => c.D.getElementById('compound-name').textContent;
        const waterOk = () => {
            const water = g.userMolecule.atoms.filter(a =>
                a.element === 'O' && g.userMolecule.getNeighbors(a.id).length === 0);
            return water.length === 1 && g.userMolecule.getFreeValency(water[0].id) === 2;
        };

        // 酢酸 + エタノール → エステル化 → 酢酸エチル + 水
        summon('酢酸');
        summon('エタノール');
        assert(g.countMolecules() === 2, '2分子にならない');
        clickRule('エステル化');
        assert(g.countMolecules() === 2, `エステル化後が${g.countMolecules()}分子（エステル＋水を期待）`);
        assert(waterOk(), '脱離した水 H₂O が生成していない');
        assert(nameShown().includes('酢酸エチル'), `エステル化後の名称が「${nameShown()}」`);
        // エステル結合が検出される
        assert(c.D.getElementById('molecule-props').textContent.includes('エステル結合'),
            'プロパティにエステル結合が出ない');
        // 原子の重なりがない
        const atoms = g.userMolecule.atoms;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                assert(Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y) >= 24,
                    'エステル化で原子が重なった');
            }
        }
        g.undo();
        assert(g.countMolecules() === 2 && nameShown().includes('酢酸'), 'Undoで反応前に戻らない');

        // エタノール×2 → 分子間脱水 → ジエチルエーテル + 水
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        summon('エタノール');
        summon('エタノール');
        clickRule('分子間脱水');
        assert(waterOk(), '分子間脱水で水が生成していない');
        assert(nameShown().includes('ジエチルエーテル'), `分子間脱水後の名称が「${nameShown()}」`);

        // 単分子のときは二分子反応のボタンが出ない
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        summon('エタノール');
        const labels = [...c.D.querySelectorAll('#reaction-actions button')].map(b => b.textContent);
        assert(!labels.some(t => t.includes('エステル化') || t.includes('分子間脱水')),
            `単分子で二分子反応が提示された（${labels.join(' / ')}）`);

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('L4: 反応実行M4（付加反応4種・マルコフニコフ則・エステルの加水分解）', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            g.userMolecule = new c.W.Molecule();
            g.updateDrawing();
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };
        const clickRule = (kw) => {
            const btn = [...c.D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes(kw));
            assert(btn, `「${kw}」の反応ボタンがない`);
            btn.click();
        };
        const nameShown = () => c.D.getElementById('compound-name').textContent;

        // エテンへの付加3種（生成物はいずれもライブラリ収録名で確認）
        summon('エチレン（エテン）');
        clickRule('Br₂');
        assert(nameShown().includes('1,2-ジブロモエタン'), `Br₂付加後が「${nameShown()}」`);

        summon('エチレン（エテン）');
        clickRule('H₂O');
        assert(nameShown().includes('エタノール'), `水付加後が「${nameShown()}」`);

        summon('エチレン（エテン）');
        clickRule('H₂（水素化');
        assert(nameShown().includes('エタン'), `水素化後が「${nameShown()}」`);

        // マルコフニコフ則: プロペン + HBr → Brは置換基の多い炭素（中央）に付く
        summon('プロペン（プロピレン）');
        clickRule('HBr');
        const br = g.userMolecule.atoms.find(a => a.element === 'Br');
        assert(br, 'Brが付加されない');
        const brC = g.userMolecule.getNeighbors(br.id)[0].atom;
        const brCarbons = g.userMolecule.getNeighbors(brC.id).filter(n => n.atom.element === 'C').length;
        assert(brCarbons === 2, `Brが末端炭素に付いた（Br結合Cの隣接C数 ${brCarbons}、中央なら2）`);
        assert(!g.userMolecule.bonds.some(b => b.type > 1), '付加後も多重結合が残っている');

        // アセチレンへのBr₂付加は1段階だけ進む（三重→二重）
        summon('アセチレン（エチン）');
        clickRule('Br₂');
        assert(g.userMolecule.bonds.some(b => b.type === 2), '三重結合が二重結合にならない');
        assert(g.userMolecule.atoms.filter(a => a.element === 'Br').length === 2, 'Brが2個付加しない');

        // 酢酸エチルの加水分解 → 酢酸 ＋ エタノール（2分子）
        summon('酢酸エチル');
        clickRule('加水分解');
        assert(g.countMolecules() === 2, `加水分解後が${g.countMolecules()}分子（2を期待）`);
        assert(nameShown().includes('酢酸') && nameShown().includes('エタノール'),
            `加水分解後が「${nameShown()}」`);
        assert(!nameShown().includes('ナトリウム'), '加水分解なのに塩ができている');
        const atoms = g.userMolecule.atoms;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                assert(Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y) >= 24,
                    '加水分解で原子が重なった');
            }
        }
        g.undo();
        assert(nameShown().includes('酢酸エチル'), 'Undoでエステルに戻らない');

        // けん化は加水分解と**生成物が違う**: カルボン酸ではなくそのナトリウム塩ができる
        // （2026-08-01・検品レビュー A-1。V19 の「石けん」がこれ）
        summon('酢酸エチル');
        clickRule('けん化');
        assert(g.countMolecules() === 2, `けん化後が${g.countMolecules()}分子（2を期待）`);
        assert(nameShown().includes('酢酸ナトリウム') && nameShown().includes('エタノール'),
            `けん化後が「${nameShown()}」（酢酸ナトリウム＋エタノールを期待）`);
        assert(g.userMolecule.atoms.filter(a => a.element === 'Na').length === 1,
            'けん化で Na が1つ付かない');
        assert(c.W.findFunctionalGroups(g.userMolecule).some(x => x.type === 'carboxylate'),
            'けん化の生成物がカルボン酸の塩として分類されない');
        assert(g.computeMolecularFormula().includes('Na'), '分子式に Na が出ない');
        // 塩の Na は価標1なので自動水素が生えない（NaH のような図にならない）
        assert(g.userMolecule.calculateHydrogens().every(h => {
            const p = g.userMolecule.atoms.find(a => a.id === h.parentId);
            return !p || p.element !== 'Na';
        }), 'Na に自動水素が生えている');
        g.undo();
        assert(nameShown().includes('酢酸エチル'), 'Undoでエステルに戻らない（けん化）');

        // 油脂のけん化: 3回で セッケン3分子 ＋ グリセリン になる。
        // 途中のジ体・モノ体も登録してあるので、**どの段階でも名前が出る**
        // （登録が無いと途中2ステップが「（該当なし）」になり、動画で穴になる）
        summon('トリステアリン（油脂・ステアリン酸のグリセリド）');
        assert(nameShown().includes('トリステアリン'), `油脂を呼び出せない（${nameShown()}）`);
        assert(g.computeMolecularFormula() === 'C₅₇H₁₁₀O₆',
            `油脂の分子式が ${g.computeMolecularFormula()}（C₅₇H₁₁₀O₆ を期待）`);
        const sapo = c.W.REACTION_RULES.find(r => r.id === 'saponification');
        assert(sapo.detect(g.userMolecule).length === 3, '油脂のけん化の箇所が3つでない');
        const expected = ['ジステアリン酸グリセリド', 'モノステアリン酸グリセリド', 'グリセリン'];
        for (let i = 0; i < 3; i++) {
            const sites = sapo.detect(g.userMolecule);
            assert(sites.length === 3 - i, `${i + 1}回目のけん化の箇所が ${sites.length}`);
            g.saveState();
            sapo.apply(g, sites[0]);
            g.updateDrawing();
            assert(nameShown().includes(expected[i]),
                `${i + 1}回目のけん化のあとが「${nameShown()}」（${expected[i]} を期待）`);
            assert(!nameShown().includes('該当なし'),
                `${i + 1}回目のけん化のあとに名前の出ない分子がある（${nameShown()}）`);
        }
        assert((nameShown().match(/セッケン/g) || []).length === 3, 'セッケンが3分子できていない');
        assert(g.computeMolecularFormula() === 'C₅₇H₁₁₃Na₃O₉',
            `油脂のけん化後の分子式が ${g.computeMolecularFormula()}（C₅₇H₁₁₃Na₃O₉ を期待）`);

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('L5: 反応実行M5（芳香族置換: ニトロ化・スルホン化・塩素化）', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            g.userMolecule = new c.W.Molecule();
            g.updateDrawing();
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };
        const clickRule = (kw) => {
            const btn = [...c.D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes(kw));
            assert(btn, `「${kw}」の反応ボタンがない`);
            btn.click();
        };
        const nameShown = () => c.D.getElementById('compound-name').textContent;
        // P12-8 で「置換して同じ生成物になる位置」をまとめたため、ベンゼンのように
        // 等価な位置しかない分子は候補1件＝選択モードにならず即実行される。
        // 置換基があって o/m/p のように区別できる分子（トルエン等）では従来どおり選択モードになる
        const substitute = (kw) => {
            clickRule(kw);
            if (c.W.reactor.picking) {
                const ring = g.userMolecule.atoms.find(a =>
                    a.element === 'C' && g.userMolecule.getFreeValency(a.id) >= 1);
                c.clickAt(ring.x, ring.y);
                assert(!c.W.reactor.picking, '選択モードが解除されない');
            }
        };

        summon('ベンゼン');
        substitute('ニトロ化');
        assert(nameShown().includes('ニトロベンゼン'), `ニトロ化後が「${nameShown()}」`);
        assert(g.computeMolecularFormula() === 'C₆H₅NO₂', `分子式が${g.computeMolecularFormula()}`);

        // **同じ手順なら毎回同じ位置に置換基が生えること**（C-2b。2026-08-01・動画レーンの実測で
        // ニトロ化 6:4／スルホン化 6:4／塩素化 8:2 に揺れていた）。原子IDは乱数で、
        // addBond が端点をIDで正規化するため、mol.bonds の走査順に頼ると選ぶ頂点が変わる。
        // 化学的にはどの頂点でも正しいが、揺れると収録のたびに構図が動いて frame を書けない
        ['aromatic_nitration', 'aromatic_sulfonation', 'aromatic_halogenation'].forEach(ruleId => {
            const rule = c.W.REACTION_RULES.find(r => r.id === ruleId);
            assert(rule, `${ruleId} が見つからない`);
            const seen = new Set();
            for (let i = 0; i < 12; i++) {
                summon('ベンゼン');
                const sites = rule.detect(g.userMolecule);
                assert(sites.length === 1, `${ruleId}: ベンゼンの候補が${sites.length}件（等価なので1件のはず）`);
                const a = g.userMolecule.atoms.find(x => x.id === sites[0][0]);
                seen.add(`${Math.round(a.x)},${Math.round(a.y)}`);
            }
            assert(seen.size === 1,
                `${ruleId}: 同じ手順なのに置換位置が${seen.size}通りに揺れた（${[...seen].join(' / ')}）`);
        });

        summon('ベンゼン');
        substitute('スルホン化');
        assert(nameShown().includes('ベンゼンスルホン酸'), `スルホン化後が「${nameShown()}」`);

        summon('ベンゼン');
        substitute('塩素化');
        assert(nameShown().includes('クロロベンゼン'), `塩素化後が「${nameShown()}」`);

        // 価標超過や原子の重なりが起きていない
        const m = g.userMolecule;
        // ニトロ基の N は電荷分離形 N(=O)(-O) として4本を許す仕様なので、
        // 単純な上限比較ではなく実アプリと同じ isValencyValid で判定する（開発方針 4章-2）
        m.atoms.forEach(a => assert(c.W.isValencyValid(m, a.id),
            `${a.element}の価標超過（使用 ${m.getUsedValency(a.id)}）`));
        const atoms = m.atoms;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                assert(Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y) >= 24,
                    '芳香族置換で原子が重なった');
            }
        }
        g.undo();
        assert(nameShown().includes('ベンゼン') && !nameShown().includes('クロロ'),
            'Undoでベンゼンに戻らない');

        // 置換位置が複数通りある分子では、従来どおり位置の選択モードに入る（P12-8 後も維持）
        summon('トルエン');
        clickRule('ニトロ化');
        assert(c.W.reactor.picking, 'トルエンでは o/m/p の選択モードになるべき');
        // 候補として提示された位置（reactor.picking.sites）の中からクリックする。
        // 空いている炭素を適当に選ぶと、候補外＝メチル基側などを掴んで不正な構造になる
        const sites = c.W.reactor.picking.sites || [];
        assert(sites.length >= 2, `トルエンの候補が ${sites.length} 件（o/m/p で複数あるべき）`);
        const tId = Array.isArray(sites[0]) ? sites[0][0] : sites[0];
        const tRing = g.userMolecule.atoms.find(a => a.id === tId);
        assert(tRing, '候補の原子が見つからない');
        c.clickAt(tRing.x, tRing.y);
        assert(!c.W.reactor.picking, 'トルエンで選択モードが解除されない');
        assert(g.computeMolecularFormula() === 'C₇H₇NO₂', `トルエンのニトロ化後の分子式が${g.computeMolecularFormula()}`);

        // 非芳香族（シクロヘキサン）には芳香族置換を提示しない
        summon('シクロヘキサン');
        const labels = [...c.D.querySelectorAll('#reaction-actions button')].map(b => b.textContent);
        assert(!labels.some(t => t.includes('芳香族置換')),
            `非芳香族で芳香族置換が提示された（${labels.join(' / ')}）`);

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    // ===== M. 学習ビュー（P9-3） =====

    test('M4: 異性体列挙の価数モデルが本体とそろっている（ニトロ基の N・S=O の無い S。§9.6-6）', async (c) => {
        const W = c.W;
        const enumerate = W.enumerateConstitutionalIsomers;
        // 列挙器が VALENCIES を直に読んでいた頃の2つの食い違い（DESIGN_compound_coverage.md §9.6-6）:
        //   ・VALENCIES.N = 3 で打ち切るので、isValencyValid が許すニトロ基 N(=O)(-O)- が出てこない
        //   ・maxValencyOf が2価を返す S（S=O が無いもの）を6価として数えるので、水素数が食い違う
        // どちらも「自分自身が列挙結果に含まれない」＝ audit.html のライブラリ検査で落ちる形だった。

        // (1) 列挙されたものはすべて**本体の関数**で妥当・分子式一致（VALENCIES で数えない）
        const wellFormed = (els, h, label) => {
            const r = enumerate(els, h);
            assert(!r.overflow, `${label} で列挙が打ち切られた`);
            r.isomers.forEach(iso => {
                assert(iso.atoms.every(a => W.isValencyValid(iso, a.id)),
                    `${label}: 価標が本体の判定を通らない異性体がある`);
                const hSum = iso.atoms.reduce((s, a) => s + iso.getFreeValency(a.id), 0);
                assert(hSum === h, `${label}: 水素数が ${hSum}（${h} を期待）`);
            });
            return r.isomers;
        };

        // (2) ニトロメタン CH₃-N(=O)-O が列挙に現れる
        const nitroMethane = new W.Molecule();
        {
            const cc = nitroMethane.addAtom('C', 0, 0).id;
            const n = nitroMethane.addAtom('N', 42, 0).id;
            const o1 = nitroMethane.addAtom('O', 84, 0).id;
            const o2 = nitroMethane.addAtom('O', 42, 42).id;
            nitroMethane.addBond(cc, n, 1);
            nitroMethane.addBond(n, o1, 2);
            nitroMethane.addBond(n, o2, 1);
        }
        assert(nitroMethane.atoms.every(a => W.isValencyValid(nitroMethane, a.id)),
            'ニトロメタンが本体の価標判定を通らない（テストの前提が崩れている）');
        const hNitro = nitroMethane.atoms.reduce((s, a) => s + nitroMethane.getFreeValency(a.id), 0);
        assert(hNitro === 3, `ニトロメタンの水素が ${hNitro}（3 を期待）`);
        const nitroSet = wellFormed(['C', 'N', 'O', 'O'], hNitro, 'CH₃NO₂');
        const selfNitro = W.canonicalCode(nitroMethane);
        assert(nitroSet.some(m => W.canonicalCode(m) === selfNitro),
            `ニトロメタンが CH₃NO₂ の列挙（${nitroSet.length}種）に含まれない`);

        // (3) S=O を持たない S は2価。C₂H₆S はエタンチオールとジメチルスルフィドの2種だけ
        //     （6価で数えていた頃は水素数が合わず7種になっていた）
        const s2 = wellFormed(['C', 'C', 'S'], 6, 'C₂H₆S');
        assert(s2.length === 2, `C₂H₆S が ${s2.length} 種（2種＝チオール・スルフィドを期待）`);

        // (4) チオフェン C₄H₄S が列挙に現れる（環内の S は2価）
        const thiophene = new W.Molecule();
        {
            const ids = ['S', 'C', 'C', 'C', 'C'].map((e, i) => thiophene.addAtom(e, i * 42, 0).id);
            [[0, 1, 1], [1, 2, 2], [2, 3, 1], [3, 4, 2], [4, 0, 1]]
                .forEach(([i, j, t]) => thiophene.addBond(ids[i], ids[j], t));
        }
        const hThio = thiophene.atoms.reduce((s, a) => s + thiophene.getFreeValency(a.id), 0);
        assert(hThio === 4, `チオフェンの水素が ${hThio}（4 を期待）`);
        const thioSet = wellFormed(['C', 'C', 'C', 'C', 'S'], hThio, 'C₄H₄S');
        assert(thioSet.some(m => W.canonicalCode(m) === W.canonicalCode(thiophene)),
            `チオフェンが C₄H₄S の列挙（${thioSet.length}種）に含まれない`);

        // (5) S も N も無い分子式の結果は従来どおり（速い経路。既知の異性体数を再確認）
        assert(enumerate(['C', 'C', 'C', 'C'], 10).isomers.length === 2, 'C₄H₁₀ が2種でない');
        assert(enumerate(['C', 'C', 'C', 'C', 'O'], 10).isomers.length === 7, 'C₄H₁₀O が7種でない');
    });

    test('M5: 官能基の分類にアミド・ニトリル・ハロゲン化物・スルホン酸がある（§9.6-2 の表示の不具合）', async (c) => {
        const g = c.game, W = c.W;
        const build = (atoms, bonds) => {
            const m = new W.Molecule();
            const ids = atoms.map(([el, x, y]) => m.addAtom(el, x, y).id);
            bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
            return m;
        };
        const typesOf = (mol) => new Set(W.findFunctionalGroups(mol).map(x => x.type));

        // (1) アミド -C(=O)-N< … **直す前は「アルデヒド基」として拾われていた**
        //     （C に =O が1本・炭素が1つなので aldehyde の分岐に落ちる）
        const acetamide = build(
            [['C', 400, 300], ['C', 442, 300], ['O', 442, 258], ['N', 484, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 1]]);
        const amideTypes = typesOf(acetamide);
        assert(amideTypes.has('amide'), 'アセトアミドが アミド として分類されない');
        assert(!amideTypes.has('aldehyde'), 'アセトアミドが まだ アルデヒド基 として拾われている');
        // ホルムアミド（炭素が0個）も同じ扱い
        const formamide = build(
            [['C', 400, 300], ['O', 400, 258], ['N', 442, 300]],
            [[0, 1, 2], [0, 2, 1]]);
        assert(typesOf(formamide).has('amide') && !typesOf(formamide).has('aldehyde'),
            'ホルムアミドが アミド として分類されない');

        // (2) ニトリル -C≡N
        const acetonitrile = build(
            [['C', 400, 300], ['C', 442, 300], ['N', 484, 300]],
            [[0, 1, 1], [1, 2, 3]]);
        assert(typesOf(acetonitrile).has('nitrile'), 'アセトニトリルが ニトリル として分類されない');

        // (3) ハロゲン化物 -X … C に付いたハロゲンだけ。**N-Cl のような形は拾わない**
        const chloroethane = build(
            [['C', 400, 300], ['C', 442, 300], ['Cl', 484, 300]],
            [[0, 1, 1], [1, 2, 1]]);
        assert(typesOf(chloroethane).has('halide'), 'クロロエタンが ハロゲン化物 として分類されない');
        const chloramine = build([['N', 400, 300], ['Cl', 442, 300]], [[0, 1, 1]]);
        assert(!typesOf(chloramine).has('halide'), 'N に付いた Cl を ハロゲン化物 として拾っている');

        // (4) スルホン酸 -SO₃H とその塩 -SO₃Na
        const mesylic = build(
            [['C', 400, 300], ['S', 442, 300], ['O', 442, 258], ['O', 442, 342], ['O', 484, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 2], [1, 4, 1]]);
        assert(typesOf(mesylic).has('sulfo'), 'メタンスルホン酸が スルホ基 として分類されない');
        const mesylateNa = build(
            [['C', 400, 300], ['S', 442, 300], ['O', 442, 258], ['O', 442, 342], ['O', 484, 300], ['Na', 526, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 2], [1, 4, 1], [4, 5, 1]]);
        assert(typesOf(mesylateNa).has('sulfonate'), 'メタンスルホン酸ナトリウムが スルホン酸の塩 として分類されない');

        // (5) 既存の分類が動いていないこと（アルデヒド・ケトン・カルボン酸・エステル）
        const acetaldehyde = build(
            [['C', 400, 300], ['C', 442, 300], ['O', 442, 258]], [[0, 1, 1], [1, 2, 2]]);
        assert(typesOf(acetaldehyde).has('aldehyde'), 'アセトアルデヒドが アルデヒド基 でなくなった');
        const acetone = build(
            [['C', 400, 300], ['C', 442, 300], ['O', 442, 258], ['C', 484, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 1]]);
        assert(typesOf(acetone).has('ketone'), 'アセトンが ケトン でなくなった');
        [['酢酸メチル', 'ester'], ['酢酸ナトリウム', 'carboxylate'], ['クエン酸', 'carboxyl'],
            ['アセトアミド', 'amide'], ['アクリロニトリル', 'nitrile'],
            ['クロロシクロヘキサン', 'halide'], ['ベンゼンスルホン酸ナトリウム', 'sulfonate']
        ].forEach(([nm, type]) => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            const mol = g.createTargetFromData({ target: entry.target });
            assert(typesOf(mol).has(type), `${nm} が ${type} として分類されない`);
        });

        // (6) 補正B: ハロゲン・ニトリル・スルホ基しか持たない分子は「範囲外」ではない。
        //     以前は findFunctionalGroups が空になり「高校で習う官能基にあてはまらない」で
        //     範囲外に落ちていた（クロロシクロヘキサンは2タップで描ける形なのに）
        [chloroethane, acetonitrile, mesylic].forEach(mol => {
            assert(W.findOutOfScopeMotifs(mol).length === 0,
                `官能基があるのに範囲外と判定される（${W.findOutOfScopeMotifs(mol).map(m => m.type).join('/')}）`);
        });
    });

    test('M6: 範囲外の線引きに S とハロゲンを入れる（§9.6-1）／同じ炭素の2本は O・N だけ', async (c) => {
        const g = c.game, W = c.W;
        const build = (atoms, bonds) => {
            const m = new W.Molecule();
            const ids = atoms.map(([el, x, y]) => m.addAtom(el, x, y).id);
            bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
            return m;
        };
        const motifs = (mol) => W.findOutOfScopeMotifs(mol).map(m => m.type);

        // (1) ヘテロ原子どうしの結合は範囲外。**S とハロゲンが漏れていた**ので、
        //     H₂N-SH のような形が普通の分類へ流れていた（DESIGN_compound_coverage.md §9.6-1）
        [
            ['H₂N-SH', [['N', 400, 300], ['S', 442, 300]], [[0, 1, 1]]],
            ['H₂N-Cl', [['N', 400, 300], ['Cl', 442, 300]], [[0, 1, 1]]],
            ['HS-SH', [['S', 400, 300], ['S', 442, 300]], [[0, 1, 1]]],
            ['H₂N-Br', [['N', 400, 300], ['Br', 442, 300]], [[0, 1, 1]]],
            ['CH₃-S-Cl', [['C', 400, 300], ['S', 442, 300], ['Cl', 484, 300]], [[0, 1, 1], [1, 2, 1]]]
        ].forEach(([nm, atoms, bonds]) => {
            assert(motifs(build(atoms, bonds)).includes('hetero_bond'),
                `${nm} が範囲外と判定されない`);
        });
        // 従来からの2つ（過酸化物・ヒドラジン）も変わらず範囲外
        assert(motifs(build([['O', 400, 300], ['O', 442, 300]], [[0, 1, 1]])).includes('peroxide'),
            '過酸化水素が範囲外と判定されない');
        assert(motifs(build([['N', 400, 300], ['N', 442, 300]], [[0, 1, 1]])).includes('hetero_bond'),
            'ヒドラジンが範囲外と判定されない');

        // (2) 許してよいヘテロ原子間結合は**ニトロ基の N-O とスルホ基の S-O だけ**
        const nitroMethane = build(
            [['C', 400, 300], ['N', 442, 300], ['O', 442, 258], ['O', 442, 342]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 1]]);
        assert(motifs(nitroMethane).length === 0, `ニトロメタンが範囲外（${motifs(nitroMethane)}）`);
        const mesylic = build(
            [['C', 400, 300], ['S', 442, 300], ['O', 442, 258], ['O', 442, 342], ['O', 484, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 2], [1, 4, 1]]);
        assert(motifs(mesylic).length === 0, `メタンスルホン酸が範囲外（${motifs(mesylic)}）`);
        // C-S-C（チオエーテル・チオフェンの環内 S）はヘテロ原子どうしの結合ではない
        const thioether = build(
            [['C', 400, 300], ['S', 442, 300], ['C', 484, 300]], [[0, 1, 1], [1, 2, 1]]);
        assert(!motifs(thioether).includes('hetero_bond'), 'C-S-C を ヘテロ原子どうし と誤判定している');

        // (3) 「同じ炭素に2本」の検査は **-OH・-NH₂ だけ**。ハロゲンを混ぜると
        //     ジクロロメタン・クロロホルムのような教科書の常連が範囲外に落ちる
        ['ジクロロメタン', 'クロロホルム', '1,1-ジクロロエタン', '四塩化炭素',
            'ヨードホルム（トリヨードメタン）'].forEach(nm => {
            const entry = W.COMPOUNDS.find(e => e.name === nm);
            assert(entry, `${nm} が compounds.json に無い`);
            const ms = motifs(g.createTargetFromData({ target: entry.target }));
            assert(ms.length === 0, `${nm} が範囲外と判定される（${ms}）`);
        });
        // ジェミナルジオール（同じ炭素に -OH が2本）は従来どおり範囲外
        const gemDiol = build(
            [['C', 400, 300], ['O', 400, 258], ['O', 400, 342]], [[0, 1, 1], [0, 2, 1]]);
        assert(motifs(gemDiol).includes('gem_diol'), 'ジェミナルジオールが範囲外と判定されない');
    });

    test('M7: 不飽和アルコールの系統名（§9.6-3。エノール形と不飽和エーテルは対象外）', async (c) => {
        const W = c.W;
        const build = (els, bonds) => {
            const m = new W.Molecule();
            const ids = els.map(e => m.addAtom(e, 0, 0).id);
            bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
            return m;
        };
        // 番号付けは既存のアルケン命名の使い回し。主特性基 -OH の位置番号を最小にしてから
        // 不飽和の位置を決める（_iupacNameForMainChain の優先順位はそのまま）
        [
            ['2-プロペン-1-オール（アリルアルコール）', ['C', 'C', 'C', 'O'], [[0, 1, 2], [1, 2, 1], [2, 3, 1]], '2-プロペン-1-オール'],
            ['2-プロピン-1-オール（プロパルギルアルコール）', ['C', 'C', 'C', 'O'], [[0, 1, 3], [1, 2, 1], [2, 3, 1]], '2-プロピン-1-オール'],
            ['2-ブテン-1-オール', ['C', 'C', 'C', 'C', 'O'], [[0, 1, 1], [1, 2, 2], [2, 3, 1], [3, 4, 1]], '2-ブテン-1-オール'],
            ['3-ブテン-1-オール', ['C', 'C', 'C', 'C', 'O'], [[0, 1, 2], [1, 2, 1], [2, 3, 1], [3, 4, 1]], '3-ブテン-1-オール'],
            ['2-ブテン-1,4-ジオール', ['O', 'C', 'C', 'C', 'C', 'O'], [[0, 1, 1], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 1]], '2-ブテン-1,4-ジオール'],
            ['2,4-ヘキサジエン-1-オール', ['O', 'C', 'C', 'C', 'C', 'C', 'C'], [[0, 1, 1], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 6, 1]], '2,4-ヘキサジエン-1-オール'],
            ['2-メチル-3-ブテン-2-オール（枝つき）', ['C', 'C', 'C', 'C', 'C', 'O'], [[0, 1, 1], [1, 2, 1], [2, 3, 2], [1, 4, 1], [1, 5, 1]], '2-メチル-3-ブテン-2-オール']
        ].forEach(([label, els, bonds, expect]) => {
            const got = W.iupacName(build(els, bonds));
            assert(got === expect, `${label} が「${got}」（${expect} を期待）`);
        });

        // (2) エノール形 C=C-OH は命名しない。findOutOfScopeMotifs が「ケト形に変わる」として
        //     範囲外にしている形なので、名前を付けると分類と食い違う
        const vinylAlcohol = build(['C', 'C', 'O'], [[0, 1, 2], [1, 2, 1]]);
        assert(W.iupacName(vinylAlcohol) === null, 'エノール形（ビニルアルコール）を命名してしまう');
        assert(W.findOutOfScopeMotifs(vinylAlcohol).some(m => m.type === 'enol'),
            'エノール形が範囲外と判定されない（テストの前提）');

        // (3) 不飽和エーテルは対象外（アルケニル基「ビニル」の名前が要る）
        assert(W.iupacName(build(['C', 'C', 'O', 'C'], [[0, 1, 2], [1, 2, 1], [2, 3, 1]])) === null,
            'メチルビニルエーテルを命名してしまう（対象外のはず）');

        // (4) 飽和側の無回帰（従来どおりの名前が出る）
        [
            [['C', 'C', 'O'], [[0, 1, 1], [1, 2, 1]], 'エタノール'],
            [['C', 'C', 'C', 'O'], [[0, 1, 1], [1, 2, 1], [2, 3, 1]], '1-プロパノール'],
            [['C', 'C', 'C', 'O'], [[0, 1, 1], [1, 2, 1], [1, 3, 1]], '2-プロパノール'],
            [['O', 'C', 'C', 'O'], [[0, 1, 1], [1, 2, 1], [2, 3, 1]], '1,2-エタンジオール'],
            [['C', 'C', 'C', 'C'], [[0, 1, 2], [1, 2, 1], [2, 3, 2]], '1,3-ブタジエン'],
            [['C', 'C', 'O', 'C'], [[0, 1, 1], [1, 2, 1], [2, 3, 1]], 'エチルメチルエーテル']
        ].forEach(([els, bonds, expect]) => {
            const got = W.iupacName(build(els, bonds));
            assert(got === expect, `飽和側が「${got}」（${expect} を期待）`);
        });
    });

    test('CF1: アミンの級数が1級・2級・3級に分かれて拾える（§9.6-7 の表示の不具合）', async (c) => {
        const g = c.game, W = c.W;
        const build = (atoms, bonds) => {
            const m = new W.Molecule();
            const ids = atoms.map(([el, x, y]) => m.addAtom(el, x, y).id);
            bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
            return m;
        };
        const typesOf = (mol) => new Set(W.findFunctionalGroups(mol).map(x => x.type));
        const AMINES = ['amine1', 'amine2', 'amine3'];
        const anyAmine = (mol) => AMINES.some(t => typesOf(mol).has(t));
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const fromLib = (name) => {
            const entry = source.find(x => x.name === name && x.target);
            assert(entry, `${name} がライブラリに無い（テストの前提が崩れている）`);
            return g.createTargetFromData({ target: entry.target });
        };

        // (1) 級数ごとに**別の型**が立つ。アルコールの alcohol1/2/3 と同じ考え方。
        //     ⚠ 型の名前まで見る——直す前は水素の残る N を一律に 'amino' としていた
        const methylamine = build([['C', 400, 300], ['N', 442, 300]], [[0, 1, 1]]);
        const dimethylamine = build([['C', 400, 300], ['N', 442, 300], ['C', 484, 300]],
            [[0, 1, 1], [1, 2, 1]]);
        const trimethylamine = build(
            [['C', 400, 300], ['N', 442, 300], ['C', 484, 300], ['C', 442, 342]],
            [[0, 1, 1], [1, 2, 1], [1, 3, 1]]);
        assert(typesOf(methylamine).has('amine1'), 'メチルアミンが 1級アミン にならない');
        assert(typesOf(dimethylamine).has('amine2'), 'ジメチルアミンが 2級アミン にならない');
        assert(typesOf(trimethylamine).has('amine3'), 'トリメチルアミンが 3級アミン にならない');
        // 否定対照A: 級数が混ざっていない（1級が3級として拾われていない、など）
        assert(!typesOf(methylamine).has('amine2') && !typesOf(methylamine).has('amine3'),
            'メチルアミンに 2級/3級 の型まで立っている');
        assert(!typesOf(trimethylamine).has('amine1') && !typesOf(trimethylamine).has('amine2'),
            'トリメチルアミンに 1級/2級 の型まで立っている');
        // 否定対照B: 級数を持たない旧型 'amino' はもう誰も返さない
        [methylamine, dimethylamine, trimethylamine].forEach(m =>
            assert(!typesOf(m).has('amino'), '級数のない amino がまだ返っている'));

        // (2) 直す前は**3級アミンが官能基ゼロ**になり「高校で習う官能基にあてはまらない」で
        //     範囲外に落ちていた（登録ずみのトリメチルアミンさえ範囲外だった）
        ['トリメチルアミン', 'トリエチルアミン', 'エチルジメチルアミン（N,N-ジメチルエチルアミン）',
            'ジエチルメチルアミン（N-メチルジエチルアミン）', 'N,N-ジメチルアニリン'].forEach(nm => {
            const mol = fromLib(nm);
            assert(typesOf(mol).has('amine3'), `${nm} が 3級アミン として拾われない`);
            assert(W.findOutOfScopeMotifs(mol).length === 0,
                `${nm} がまだ範囲外（${W.findOutOfScopeMotifs(mol).map(x => x.type).join('/')}）`);
        });
        // 2級・1級のライブラリ登録も級数どおりに出る
        [['ジエチルアミン', 'amine2'], ['N-メチルアニリン', 'amine2'], ['ジフェニルアミン', 'amine2'],
            ['エチルアミン', 'amine1'], ['アニリン', 'amine1'], ['ヘキサメチレンジアミン', 'amine1']
        ].forEach(([nm, t]) => assert(typesOf(fromLib(nm)).has(t), `${nm} が ${t} にならない`));

        // (3) 巻き込んではいけない4つの N。**どれもアミンの型を立てない**
        const acetamide = build(
            [['C', 400, 300], ['C', 442, 300], ['O', 442, 258], ['N', 484, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 1]]);
        assert(typesOf(acetamide).has('amide') && !anyAmine(acetamide),
            'アミドの N がアミンとして二重に数えられている');
        const nitromethane = build(
            [['C', 400, 300], ['N', 442, 300], ['O', 442, 258], ['O', 442, 342]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 1]]);
        assert(typesOf(nitromethane).has('nitro') && !anyAmine(nitromethane),
            'ニトロ基の N がアミンとして拾われている');
        const acetonitrile = build(
            [['C', 400, 300], ['C', 442, 300], ['N', 484, 300]], [[0, 1, 1], [1, 2, 3]]);
        assert(typesOf(acetonitrile).has('nitrile') && !anyAmine(acetonitrile),
            'ニトリルの N がアミンとして拾われている');
        // アンモニウム型（N が単結合4本。isValencyValid の特例で描ける形）
        const ammonium = build(
            [['N', 400, 300], ['C', 442, 300], ['C', 358, 300], ['C', 400, 258], ['C', 400, 342]],
            [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]]);
        assert(ammonium.atoms.every(a => W.isValencyValid(ammonium, a.id)),
            'テトラメチルアンモニウムが価標検査を通らない（テストの前提が崩れている）');
        assert(!anyAmine(ammonium), 'アンモニウム（結合4本の N）がアミンとして拾われている');
        // ライブラリのアミド類。**アミドの型は立つがアミンの型は立たない**
        ['アセトアニリド', '尿素', 'アセトアミド', 'ε-カプロラクタム', 'パラセタモール'].forEach(nm => {
            const mol = fromLib(nm);
            assert(typesOf(mol).has('amide'), `${nm} が アミド として拾われない`);
            assert(!anyAmine(mol), `${nm} のアミド N がアミンとして二重に数えられている`);
        });

        // (4) N に炭素以外がつながる形はアミンにしない（範囲外の線引きの担当）。
        //     否定対照: ここを緩めると、ヒドラジン・ヒドロキシルアミンがアミンに化ける
        const hydrazine = build([['N', 400, 300], ['N', 442, 300]], [[0, 1, 1]]);
        assert(!anyAmine(hydrazine), 'ヒドラジンがアミンとして拾われている');
        assert(W.findOutOfScopeMotifs(hydrazine).some(m => m.type === 'hetero_bond'),
            'ヒドラジンが範囲外でなくなった');
        const ammonia = build([['N', 400, 300]], []);
        assert(!anyAmine(ammonia), '炭素の無い NH₃ をアミンとして拾っている');
        assert(W.findOutOfScopeMotifs(ammonia).some(m => m.type === 'no_group'),
            'NH₃ が範囲外でなくなった（範囲外の線引きごと壊していないか）');
        // 否定対照: 「官能基にあてはまらない」の判定そのものは生きている
        assert(W.findOutOfScopeMotifs(fromLib('水')).some(m => m.type === 'no_group'),
            '水 が範囲外でなくなった');

        // (5) 利用者が見る面（⚗ カードの1行）に級数が出る
        assert(g.functionalGroupSummary(trimethylamine).includes('3級アミン'),
            `トリメチルアミンの表示が「${g.functionalGroupSummary(trimethylamine)}」`);
        assert(g.functionalGroupSummary(dimethylamine).includes('2級アミン'),
            `ジメチルアミンの表示が「${g.functionalGroupSummary(dimethylamine)}」`);
        assert(!g.functionalGroupSummary(acetamide).includes('アミン'),
            `アセトアミドの表示にアミンが出ている（「${g.functionalGroupSummary(acetamide)}」）`);
    });

    test('CF2: カルボン酸の塩がカリウムでも拾える（§9.6-8。塩の見出しは実物の元素で出す）', async (c) => {
        const g = c.game, W = c.W;
        const build = (atoms, bonds) => {
            const m = new W.Molecule();
            const ids = atoms.map(([el, x, y]) => m.addAtom(el, x, y).id);
            bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
            return m;
        };
        const groupsOf = (mol) => W.findFunctionalGroups(mol);
        const typesOf = (mol) => new Set(groupsOf(mol).map(x => x.type));
        const labelOf = (mol, type) => (groupsOf(mol).find(x => x.type === type) || {}).label || '';
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const fromLib = (name) => {
            const entry = source.find(x => x.name === name && x.target);
            assert(entry, `${name} がライブラリに無い（テストの前提が崩れている）`);
            return g.createTargetFromData({ target: entry.target });
        };

        // (1) -COOK が塩として拾える。**直す前は Na だけを見ていた**ので、
        //     カリウム塩は官能基が1つも立たず「高校で習う官能基にあてはまらない」で範囲外だった
        ['酢酸カリウム', 'フタル酸水素カリウム'].forEach(nm => {
            const mol = fromLib(nm);
            assert(typesOf(mol).has('carboxylate'), `${nm} が カルボン酸の塩 として拾われない`);
            assert(W.findOutOfScopeMotifs(mol).length === 0,
                `${nm} がまだ範囲外（${W.findOutOfScopeMotifs(mol).map(x => x.type).join('/')}）`);
            assert(labelOf(mol, 'carboxylate').includes('COOK'),
                `${nm} の見出しが「${labelOf(mol, 'carboxylate')}」（-COOK を期待）`);
        });
        // フタル酸水素カリウムは「片方が塩・片方が酸」。両方とも出ていること
        const khp = fromLib('フタル酸水素カリウム');
        assert(typesOf(khp).has('carboxyl'), 'フタル酸水素カリウムの -COOH 側が出ていない');

        // (2) 否定対照A: ナトリウム塩の見出しは -COONa のまま（元素を決め打ちに戻していない）
        const acetateNa = fromLib('酢酸ナトリウム');
        assert(typesOf(acetateNa).has('carboxylate'), '酢酸ナトリウムが カルボン酸の塩 でなくなった');
        assert(labelOf(acetateNa, 'carboxylate').includes('COONa'),
            `酢酸ナトリウムの見出しが「${labelOf(acetateNa, 'carboxylate')}」`);

        // (3) 否定対照B: 「-C(=O)-O- の先が何であっても塩」にはしていない。
        //     金属でない原子（ここでは Cl）が先にある形は塩として拾わない
        const acetylHypochlorite = build(
            [['C', 400, 300], ['C', 442, 300], ['O', 442, 258], ['O', 484, 300], ['Cl', 526, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1]]);
        assert(!typesOf(acetylHypochlorite).has('carboxylate'),
            '-CO-O-Cl を カルボン酸の塩 として拾っている');
        // 酸そのもの・エステルは今までどおり別の型
        const aceticAcid = build(
            [['C', 400, 300], ['C', 442, 300], ['O', 442, 258], ['O', 484, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 1]]);
        assert(typesOf(aceticAcid).has('carboxyl') && !typesOf(aceticAcid).has('carboxylate'),
            '酢酸が カルボン酸の塩 に化けている');
        assert(typesOf(fromLib('酢酸メチル')).has('ester'), '酢酸メチルが エステル でなくなった');

        // (4) スルホン酸の塩の見出しも実物の元素で出す（carboxylate と同じ書き方）
        const sulfonate = (metal) => build(
            [['C', 400, 300], ['S', 442, 300], ['O', 442, 258], ['O', 442, 342],
                ['O', 484, 300], [metal, 526, 300]],
            [[0, 1, 1], [1, 2, 2], [1, 3, 2], [1, 4, 1], [4, 5, 1]]);
        assert(labelOf(sulfonate('Na'), 'sulfonate').includes('SO₃Na'),
            `Na 塩の見出しが「${labelOf(sulfonate('Na'), 'sulfonate')}」`);
        assert(labelOf(sulfonate('K'), 'sulfonate').includes('SO₃K'),
            `K 塩の見出しが「${labelOf(sulfonate('K'), 'sulfonate')}」`);
    });

    test('M1: 構造異性体の全列挙（既知の異性体数と一致）と学習モーダル', async (c) => {
        c.reset();
        const g = c.game;
        const enumerate = c.W.enumerateConstitutionalIsomers;

        // 教科書で確認できる異性体数と一致すること（立体異性体は数えない）
        const cases = [
            ['C₄H₁₀O', ['C', 'C', 'C', 'C', 'O'], 10, 7],
            ['C₃H₈O', ['C', 'C', 'C', 'O'], 8, 3],
            ['C₄H₁₀', ['C', 'C', 'C', 'C'], 10, 2],
            ['C₅H₁₂', ['C', 'C', 'C', 'C', 'C'], 12, 3],
            ['C₄H₈', ['C', 'C', 'C', 'C'], 8, 5],
            ['C₂H₆O', ['C', 'C', 'O'], 6, 2]
        ];
        cases.forEach(([name, els, h, expect]) => {
            const r = enumerate(els, h);
            assert(!r.overflow, `${name} で列挙が打ち切られた`);
            assert(r.isomers.length === expect,
                `${name} の異性体が ${r.isomers.length} 種類（${expect} を期待）`);
        });

        // 列挙結果はすべて連結・分子式一致・重複なし（C₄H₁₀O で検証）
        const res = enumerate(['C', 'C', 'C', 'C', 'O'], 10);
        const codes = new Set();
        res.isomers.forEach(iso => {
            const hSum = iso.atoms.reduce((s, a) => s + iso.getFreeValency(a.id), 0);
            assert(hSum === 10, `水素数が ${hSum}`);
            assert(iso.atoms.length === 5 && iso.bonds.length >= 4, '原子・結合数が不正');
            const code = c.W.canonicalCode(iso);
            assert(!codes.has(code), '重複した異性体が含まれる');
            codes.add(code);
        });

        // 2-ブタノールで学習モーダルを開く: アルコール4種・エーテル3種の内訳が出る
        const input = c.D.getElementById('summon-input');
        input.value = '2-ブタノール';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        c.D.getElementById('btn-isomers').click();
        assert(!c.D.getElementById('learn-modal').classList.contains('hidden'), '学習モーダルが開かない');
        assert(c.D.getElementById('learn-body').textContent.includes('計算中'), '計算中の表示が出ない');
        await c.tick(50); // 列挙は描画を譲ってから実行されるため待つ
        const body = c.D.getElementById('learn-body').textContent;
        assert(c.D.getElementById('learn-title').textContent.includes('C₄H₁₀O'),
            `タイトルが「${c.D.getElementById('learn-title').textContent}」`);
        assert(body.includes('全部で 7 種類'), `内訳文が「${body.slice(0, 60)}」`);
        assert(body.includes('アルコール … 4 種類'), 'アルコール4種の内訳が出ない');
        assert(body.includes('エーテル … 3 種類'), 'エーテル3種の内訳が出ない');
        assert(body.includes('2-ブタノール') && body.includes('（この分子）'),
            '自分自身が登録名として示されない');
        assert(body.includes('書き出し方のコツ'), '書き出し方の解説がない');
        assert(body.includes('2級アルコール'), '級に応じた学習ポイントが出ない');

        // ギャラリー（P9-3b）: 7異性体すべてのサムネイルが描画され、自分がシアン枠で示される
        const thumbs = c.D.querySelectorAll('#learn-body svg[id^="iso-svg-"]');
        assert(thumbs.length === 7, `サムネイルが${thumbs.length}個（7を期待）`);
        thumbs.forEach(svg => {
            assert(svg.querySelector('.quiz-atoms').children.length > 0, '構造式が描画されていないサムネイルがある');
        });
        const selfCells = [...c.D.querySelectorAll('#learn-body svg[id^="iso-svg-"]')]
            .map(s => s.parentElement)
            .filter(cell => cell.style.borderColor.includes('color-cyan') ||
                            cell.style.border.includes('color-cyan'));
        assert(selfCells.length === 1, `「この分子」の強調枠が${selfCells.length}個（1を期待）`);
        assert(c.D.getElementById('learn-body').textContent.includes('（この分子）'),
            '「この分子」ラベルが出ない');

        // レイアウトの健全性: 全サムネイルの分子で原子が重ならない（環テンプレート含む）
        const layoutCheck = c.W.enumerateConstitutionalIsomers(['C', 'C', 'C', 'C'], 8); // 環を含むC₄H₈
        layoutCheck.isomers.forEach(iso => {
            c.W.layoutMolecule(iso);
            for (let i = 0; i < iso.atoms.length; i++) {
                for (let j = i + 1; j < iso.atoms.length; j++) {
                    const d = Math.hypot(iso.atoms[i].x - iso.atoms[j].x, iso.atoms[i].y - iso.atoms[j].y);
                    assert(d >= 24, `自動レイアウトで原子が重なった（${d.toFixed(1)}px）`);
                }
            }
        });
        c.D.getElementById('btn-learn-close').click();
        assert(c.D.getElementById('learn-modal').classList.contains('hidden'), 'モーダルが閉じない');

        // 複数分子で**対象を渡さずに**呼んだときは、これまでどおり案内して開かない
        // （どの分子の話か決まらないため。対象を渡す経路＝分子モーダルの見出しは MM2 で見る。
        //  DESIGN_molecule_modal.md 第1段でボタンからは対象が渡るようになった）
        input.value = 'エタノール';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(g.countMolecules() === 2, '2分子にならない');
        c.W.learnView.showIsomers();
        assert(c.D.getElementById('learn-modal').classList.contains('hidden'), '複数分子でモーダルが開いた');
        assert(c.D.getElementById('verify-result').textContent.includes('1つだけ'), '案内トーストが出ない');

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('K5: 硫黄の価数は文脈で決まる（S=O があれば6価、なければ2価）', async (c) => {
        const W = c.W, g = c.game;
        // 6価固定だと C-S-C の硫黄に空き価標が4残り、架橋の硫黄に自動水素が描かれてしまう
        // （SH₄ のような有り得ない形）。加硫・チオール・ジスルフィドを正しく描くための前提。
        // 判別はニトロ特例と同じ「パターンで見分ける」やり方
        const sInfo = (build) => {
            const m = new W.Molecule();
            const s = build(m);
            const hs = m.calculateHydrogens().filter(h => h.parentId === s.id).length;
            return { free: m.getFreeValency(s.id), h: hs, valid: W.isValencyValid(m, s.id), mol: m, s };
        };
        // チオエーテル（加硫の架橋の形）: 空き価標0・水素なし
        const bridge = sInfo(m => {
            const a = m.addAtom('C', 358, 300), s = m.addAtom('S', 400, 300), b = m.addAtom('C', 442, 300);
            m.addBond(a.id, s.id, 1); m.addBond(s.id, b.id, 1); return s;
        });
        assert(bridge.free === 0 && bridge.h === 0,
            `C-S-C の硫黄に空き価標 ${bridge.free}・自動水素 ${bridge.h}（0/0 を期待）`);
        assert(bridge.valid, 'C-S-C の硫黄が価標違反と判定された');
        // ジスルフィド -S-S-（タンパク質の架橋）も同じ
        const disulfide = sInfo(m => {
            const a = m.addAtom('C', 316, 300), s1 = m.addAtom('S', 358, 300);
            const s2 = m.addAtom('S', 400, 300), b = m.addAtom('C', 442, 300);
            m.addBond(a.id, s1.id, 1); m.addBond(s1.id, s2.id, 1); m.addBond(s2.id, b.id, 1); return s1;
        });
        assert(disulfide.free === 0 && disulfide.h === 0, 'ジスルフィドの硫黄に余分な空き価標がある');
        // チオール -SH は水素1つ、H2S は2つ
        const thiol = sInfo(m => {
            const a = m.addAtom('C', 358, 300), s = m.addAtom('S', 400, 300);
            m.addBond(a.id, s.id, 1); return s;
        });
        assert(thiol.free === 1 && thiol.h === 1, `チオールの硫黄が -SH にならない（空き${thiol.free}・H${thiol.h}）`);
        const h2s = sInfo(m => m.addAtom('S', 400, 300));
        assert(h2s.free === 2 && h2s.h === 2, `孤立した硫黄が H₂S にならない（空き${h2s.free}・H${h2s.h}）`);

        // 硫黄を含むアミノ酸2件（価数を直したことで登録できるようになった）
        const src0 = (W.COMPOUNDS || []).concat(W.STAGES || []);
        [['システイン', 'C₃H₇NO₂S', 1], ['メチオニン', 'C₅H₁₁NO₂S', 0]].forEach(([nm, formula, sFree]) => {
            const e = src0.find(x => x.name === nm && x.target);
            assert(e, `${nm} がライブラリに無い`);
            const m = g.createTargetFromData({ target: e.target });
            const sAtoms = m.atoms.filter(a => a.element === 'S');
            assert(sAtoms.length === 1, `${nm} の硫黄が ${sAtoms.length} 個`);
            assert(m.getFreeValency(sAtoms[0].id) === sFree,
                `${nm} の硫黄の空き価標が ${m.getFreeValency(sAtoms[0].id)}（${sFree} を期待）`);
            g.setMode('free');
            g.userMolecule = m;
            g.updateDrawing();
            const shown = c.D.getElementById('compound-formula').textContent;
            assert(shown === formula, `${nm} の分子式が ${shown}（${formula} を期待）`);
            assert(g.lookupCompoundName(m) === nm, `${nm} が自分の名前で命名されない`);
        });

        // スルホ基は6価のまま＝既存データは無回帰（S を含むのはベンゼンスルホン酸のみ）
        const src = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const e = src.find(x => x.name === 'ベンゼンスルホン酸' && x.target);
        assert(e, 'ベンゼンスルホン酸がライブラリに無い');
        const mol = g.createTargetFromData({ target: e.target });
        const s = mol.atoms.find(a => a.element === 'S');
        assert(W.maxValencyOf(mol, s.id) === 6, 'S=O を持つ硫黄が6価と判定されない');
        assert(mol.getFreeValency(s.id) === 0, 'スルホ基の硫黄に空き価標が出た');
        assert(mol.calculateHydrogens().filter(h => h.parentId === s.id).length === 0,
            'スルホ基の硫黄に自動水素が描かれた');
        assert(g.lookupCompoundName(mol) === 'ベンゼンスルホン酸', 'スルホン酸の命名が壊れた');

        // **消しゴムで結合を消す経路にも価標の検査があること**（v341 の夜間監査で63件検出）。
        // ①スルホ基の片方の S=O を単結合へ落とす（上限は6のままなので許される）→
        // ②残る S=O の結合を消しゴムで消す、の順で「結合3本に対して上限2」の硫黄が作れていた。
        // 右クリック削除と原子削除には元から検査があり、消しゴムの結合削除だけ抜けていた
        g.setMode('free');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        c.D.getElementById('summon-input').value = 'ベンゼンスルホン酸';
        c.D.getElementById('summon-input').dispatchEvent(new c.W.Event('change', { bubbles: true }));
        const sulf = g.userMolecule.atoms.find(a => a.element === 'S');
        assert(sulf, 'ベンゼンスルホン酸を呼び出せない');
        const dblO = g.userMolecule.getNeighbors(sulf.id)
            .filter(n => n.type === 2 && n.atom.element === 'O').map(n => n.atom);
        assert(dblO.length === 2, `スルホ基の S=O が ${dblO.length} 本`);
        g.handleBondInteraction(g.userMolecule.getBond(sulf.id, dblO[0].id), false);
        assert(g.userMolecule.getUsedValency(sulf.id) === 5,
            `片方を単結合にしたあとの硫黄の結合数が ${g.userMolecule.getUsedValency(sulf.id)}（5を期待）`);
        const restO = g.userMolecule.getNeighbors(sulf.id)
            .filter(n => n.type === 2 && n.atom.element === 'O').map(n => n.atom)[0];
        assert(restO, '残る S=O が見つからない');
        g.selectedTool = 'erase';
        c.clickAt((sulf.x + restO.x) / 2, (sulf.y + restO.y) / 2);
        g.selectedTool = 'select';
        const sAfter = g.userMolecule.atoms.find(a => a.element === 'S');
        assert(!sAfter || W.isValencyValid(g.userMolecule, sAfter.id),
            `消しゴムで最後の S=O を消したあと硫黄が価標超過になっている` +
            `（${g.userMolecule.getUsedValency(sAfter.id)}/${W.maxValencyOf(g.userMolecule, sAfter.id)}）`);
        // ライブラリ全体で硫黄を含むエントリが価標違反にならないこと
        src.filter(x => x.target).forEach(x => {
            const m = g.createTargetFromData({ target: x.target });
            m.atoms.filter(a => a.element === 'S').forEach(a => {
                assert(W.isValencyValid(m, a.id), `${x.name} の硫黄が価標違反になった`);
            });
        });
    });

    test('K4: 監査で発見した2件（ニトロ破壊置換の拒否・置換基の重なり回避）', async (c) => {
        c.reset();
        const g = c.game;

        // (1) ニトロ基の -O を N に置換しようとすると拒否される（中心Nが4本結合のまま残るため）
        g.placeModule('benzene', 420, 294, null);
        const ringC = g.userMolecule.atoms.find(a => g.userMolecule.getFreeValency(a.id) >= 1);
        g.placeModule('no2', ringC.x, ringC.y, ringC);
        const nitroN = g.userMolecule.atoms.find(a => a.element === 'N');
        const singleO = g.userMolecule.getNeighbors(nitroN.id)
            .find(n => n.type === 1 && n.atom.element === 'O').atom;
        g.selectedTool = 'select';
        g.selectedAtomType = 'N';
        c.clickAt(singleO.x, singleO.y);
        assert(singleO.element === 'O', 'ニトロ基を壊す置換が拒否されない');
        assert(c.D.getElementById('verify-result').textContent.includes('隣の原子'), '拒否の案内が出ない');
        assert(c.W.isValencyValid(g.userMolecule, nitroN.id), 'ニトロNが不正な価標のまま');
        // 正当な置換（ベンゼン環のC→N でピリジン）は従来どおり通る
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        g.placeModule('benzene', 420, 294, null);
        const c0 = g.userMolecule.atoms[0];
        c.clickAt(c0.x, c0.y);
        assert(c0.element === 'N', '正当な元素置換までブロックされた');

        // (2) 芳香族置換を連続で行っても置換基の原子が重ならない
        c.reset();
        g.placeModule('benzene', 420, 294, null);
        const react = (kw) => {
            const btn = [...c.D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes(kw));
            assert(btn, `「${kw}」のボタンがない`);
            btn.click();
            if (c.W.reactor.picking) {
                const sites = c.W.reactor.picking.sites;
                const target = g.userMolecule.atoms.find(a => sites.some(s => s.includes(a.id)));
                c.clickAt(target.x, target.y);
            }
        };
        react('ニトロ化');
        react('ニトロ化');
        react('スルホン化');
        const atoms = g.userMolecule.atoms;
        let worst = Infinity;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                worst = Math.min(worst, Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y));
            }
        }
        assert(worst >= 24, `置換基の原子が重なった（最小間隔 ${worst.toFixed(1)}px）`);
        atoms.forEach(a => assert(c.W.isValencyValid(g.userMolecule, a.id),
            `${a.element} の価標が不正`));

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('L6: 検収修正（アルキン水和の互変異性・エノールの反応除外・フェノールのエステル化除外）', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            g.userMolecule = new c.W.Molecule();
            g.updateDrawing();
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };
        const ruleLabels = () => [...c.D.querySelectorAll('#reaction-actions button')].map(b => b.textContent);
        const clickRule = (kw) => {
            const btn = [...c.D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes(kw));
            assert(btn, `「${kw}」の反応ボタンがない`);
            btn.click();
            if (c.W.reactor.picking) {
                const sites = c.W.reactor.picking.sites;
                const t = g.userMolecule.atoms.find(a => sites.some(s => s.includes(a.id)));
                c.clickAt(t.x, t.y);
            }
        };
        const nameShown = () => c.D.getElementById('compound-name').textContent;

        // (1) アセチレン + H₂O → エノールではなくアセトアルデヒド（ケト・エノール互変異性）
        summon('アセチレン（エチン）');
        clickRule('H₂O');
        assert(nameShown().includes('アセトアルデヒド'), `アセチレン水和の生成物が「${nameShown()}」`);
        assert(c.D.getElementById('verify-result').textContent.includes('互変異性'), '互変異性の解説が出ない');

        // プロピン + H₂O → アセトン（マルコフニコフ則で内側炭素に=O）
        summon('プロピン（メチルアセチレン）');
        clickRule('H₂O');
        assert(nameShown().includes('アセトン'), `プロピン水和の生成物が「${nameShown()}」`);

        // (2) 手描きのエノール（CH₂=CH-OH）にアルコール系の反応が提示されない
        g.userMolecule = new c.W.Molecule();
        const e1 = g.userMolecule.addAtom('C', 336, 294);
        const e2 = g.userMolecule.addAtom('C', 378, 294);
        const eo = g.userMolecule.addAtom('O', 420, 294);
        g.userMolecule.addBond(e1.id, e2.id, 2);
        g.userMolecule.addBond(e2.id, eo.id, 1);
        g.updateDrawing();
        assert(c.D.getElementById('molecule-props').textContent.includes('エノール'),
            `エノールが分類されない（${c.D.getElementById('molecule-props').textContent}）`);
        const forbidden = ['酸化', '脱水', 'エステル化'];
        forbidden.forEach(kw => assert(!ruleLabels().some(t => t.includes(kw)),
            `エノールに「${kw}」が提示された（${ruleLabels().join(' / ')}）`));

        // (3) 酢酸 + フェノール: 実行可能なエステル化は出さず、「進行しにくい」解説ボタンを出す
        summon('酢酸');
        const input = c.D.getElementById('summon-input');
        input.value = 'フェノール';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(g.countMolecules() === 2, '2分子にならない');
        assert(!ruleLabels().some(t => t.includes('エステル化（カルボン酸')),
            `酢酸+フェノールで実行可能なエステル化が提示された（${ruleLabels().join(' / ')}）`);
        assert(ruleLabels().some(t => t.includes('進行しにくい')),
            `「進行しにくい」解説ボタンが出ない（${ruleLabels().join(' / ')}）`);
        const atomsBefore = g.userMolecule.atoms.length;
        clickRule('進行しにくい');
        assert(g.userMolecule.atoms.length === atomsBefore, '解説ボタンで分子が変化した');
        assert(c.D.getElementById('verify-result').textContent.includes('無水酢酸'),
            '無水酢酸によるアセチル化への誘導が出ない');
        // 酢酸 + エタノール では従来どおり提示される
        summon('酢酸');
        input.value = 'エタノール';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(ruleLabels().some(t => t.includes('エステル化')), '酢酸+エタノールのエステル化が消えた');

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('L7: アセチル化（アニリン→アセトアニリド・サリチル酸→アスピリン）', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            g.userMolecule = new c.W.Molecule();
            g.updateDrawing();
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };
        const clickRule = (kw) => {
            const btn = [...c.D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes(kw));
            assert(btn, `「${kw}」の反応ボタンがない`);
            btn.click();
            if (c.W.reactor.picking) {
                const sites = c.W.reactor.picking.sites;
                const t = g.userMolecule.atoms.find(a => sites.some(s => s.includes(a.id)));
                c.clickAt(t.x, t.y);
            }
        };
        const nameShown = () => c.D.getElementById('compound-name').textContent;

        // アニリン → アセチル化 → アセトアニリド（アミンのN-アセチル化）
        summon('アニリン');
        clickRule('アセチル化');
        assert(nameShown().includes('アセトアニリド'), `アニリンのアセチル化後が「${nameShown()}」`);

        // サリチル酸 → アセチル化 → アセチルサリチル酸（フェノール性OHのO-アセチル化。
        // カルボキシ基は対象にならず、サイトはフェノールOの1箇所だけ）
        summon('サリチル酸');
        clickRule('アセチル化');
        assert(nameShown().includes('アセチルサリチル酸'), `サリチル酸のアセチル化後が「${nameShown()}」`);
        // 価標と重なりの健全性
        const m = g.userMolecule;
        m.atoms.forEach(a => assert(c.W.isValencyValid(m, a.id), `${a.element}の価標が不正`));
        for (let i = 0; i < m.atoms.length; i++) {
            for (let j = i + 1; j < m.atoms.length; j++) {
                assert(Math.hypot(m.atoms[i].x - m.atoms[j].x, m.atoms[i].y - m.atoms[j].y) >= 24,
                    'アセチル化で原子が重なった');
            }
        }
        g.undo();
        assert(nameShown().includes('サリチル酸') && !nameShown().includes('アセチル'),
            'Undoでサリチル酸に戻らない');

        c.D.getElementById('verify-result').classList.add('hidden');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    // ===== RX. 反応の前後比較・機構ジャンプ（P12-5 第1弾） =====

    test('RX1: 前後比較 — エタノール酸化で2図＋差分ハイライトが出る（P12-5）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        g.setMode('free');
        // エタノールを召喚
        const input = c.D.getElementById('summon-input');
        input.value = 'エタノール';
        input.dispatchEvent(new W.Event('change', { bubbles: true }));
        assert(g.userMolecule.atoms.length > 0, 'エタノールが召喚されない');

        // 酸化 [O] → アルデヒド を実行（1箇所なので即実行）
        const btn = [...c.D.querySelectorAll('#reaction-actions button')]
            .find(b => b.textContent.includes('酸化') && b.textContent.includes('アルデヒド'));
        assert(btn, `酸化→アルデヒドのボタンがない（${[...c.D.querySelectorAll('#reaction-actions button')].map(b => b.textContent).join(' / ')}）`);
        btn.click();
        if (W.reactor.picking) {
            const sites = W.reactor.picking.sites;
            const t = g.userMolecule.atoms.find(a => sites.some(s => s.includes(a.id)));
            c.clickAt(t.x, t.y);
        }

        // 直近反応が記録され、前=エタノール・後=アセトアルデヒドのトポロジー
        const rx = W.reactor.lastReaction;
        assert(rx && rx.before && rx.after, 'lastReaction が記録されない');
        const beforeName = g.lookupCompoundName(g.createTargetFromData({ target: W.reactor.snapshotToTarget(rx.before) }));
        const afterName = g.lookupCompoundName(g.createTargetFromData({ target: W.reactor.snapshotToTarget(rx.after) }));
        assert(beforeName && beforeName.includes('エタノール'), `反応前が「${beforeName}」（エタノールを期待）`);
        assert(afterName && afterName.includes('アセトアルデヒド'), `反応後が「${afterName}」（アセトアルデヒドを期待）`);

        // 「反応の前後を見る」ボタン → オーバーレイに2図＋差分ハイライト
        const cmpBtn = [...c.D.querySelectorAll('#reaction-actions button')].find(b => b.textContent.includes('前後'));
        assert(cmpBtn, '「反応の前後を見る」ボタンが出ない');
        cmpBtn.click();
        const ov = c.D.getElementById('rx-compare-overlay');
        assert(!ov.classList.contains('hidden'), '前後比較オーバーレイが開かない');
        const drawn = [...ov.querySelectorAll('svg')].filter(s => s.querySelector('.quiz-atoms').children.length > 0);
        assert(drawn.length >= 2, `前後2図が描画されない（${drawn.length}）`);
        assert(ov.querySelectorAll('.rx-diff-mark').length >= 1, '差分ハイライトが1つも無い');
        assert(/反応前/.test(ov.textContent) && /反応後/.test(ov.textContent), '前後のラベルが無い');

        // 図クリックで閉じる
        drawn[0].closest('div').click();
        assert(ov.classList.contains('hidden'), '図クリックで閉じない');

        // モード離脱で記録が破棄される
        g.setMode('puzzle');
        assert(!W.reactor.lastReaction, 'モード離脱で lastReaction が破棄されない');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX2: 機構ジャンプ — mechanismId のある反応から learn モードで対応機構をロード（P12-5）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        g.setMode('free');
        // ベンゼンを配置してニトロ化（aromatic_nitration → mechanismId: benzene_nitration）
        g.placeModule('benzene', 420, 294, null);
        const btn = [...c.D.querySelectorAll('#reaction-actions button')].find(b => b.textContent.includes('ニトロ化'));
        assert(btn, 'ニトロ化ボタンがない');
        btn.click();
        if (W.reactor.picking) {
            const sites = W.reactor.picking.sites;
            const t = g.userMolecule.atoms.find(a => sites.some(s => s.includes(a.id)));
            c.clickAt(t.x, t.y);
        }
        assert(W.reactor.lastReaction && W.reactor.lastReaction.mechanismId === 'benzene_nitration',
            `mechanismId が記録されない（${W.reactor.lastReaction && W.reactor.lastReaction.mechanismId}）`);

        // 「機構を見る（代表例）」ボタン → learn モードへ切替わり、ビューアが対応機構をロード
        const mech = [...c.D.querySelectorAll('#reaction-actions button')].find(b => b.textContent.includes('機構を見る'));
        assert(mech, '「機構を見る」ボタンが出ない');
        mech.click();
        assert(g.currentMode === 'learn', `learnモードに切替わらない（${g.currentMode}）`);
        assert(W.reactionPlayer.active, '反応機構ビューアが起動しない');
        assert(W.reactionPlayer.currentReaction && W.reactionPlayer.currentReaction.id === 'benzene_nitration',
            `ビューアの機構が「${W.reactionPlayer.currentReaction && W.reactionPlayer.currentReaction.id}」（benzene_nitration期待）`);
        // ジャンプ後は前後比較の記録が破棄されている（モード離脱）
        assert(!W.reactor.lastReaction, '機構ジャンプ後に lastReaction が残っている');

        W.reactionPlayer.exit();
        g.setMode('puzzle');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX3: reactor の mechanismId が reactions.json の id に実在し・id は重複しない（P12-5）', async (c) => {
        const W = c.W;
        const reactions = W.reactionPlayer.reactions;
        assert(reactions.length > 0, 'reactions.json がロードされていない');
        // (1) 各機構に安定 id があり、重複しない
        const ids = reactions.map(r => r.id);
        ids.forEach((id, i) => assert(typeof id === 'string' && id.length > 0,
            `reactions[${i}]（${reactions[i].name}）に id がない`));
        assert(new Set(ids).size === ids.length,
            `reactions.json の id が重複している（${ids.join(', ')}）`);
        // (2) reactor ルールの mechanismId は必ず reactions.json の id に実在する
        assert(W.REACTION_RULES, 'REACTION_RULES が公開されていない');
        const idSet = new Set(ids);
        const withMech = W.REACTION_RULES.filter(r => r.mechanismId);
        assert(withMech.length >= 8, `mechanismId 付きルールが${withMech.length}件（8以上を期待）`);
        withMech.forEach(r => assert(idSet.has(r.mechanismId),
            `ルール ${r.id} の mechanismId「${r.mechanismId}」が reactions.json に存在しない`));
    });

    test('RX4: モーフィング補間は純関数で t=0→反応前・t=1→反応後に一致（P12-5 第2弾）', async (c) => {
        const W = c.W;
        // 合成スナップショット: a=共通(不動), b=共通(移動10→14), c=脱離, d=付加。a-b は次数1→2、b-c消滅、b-d生成
        const before = {
            atoms: [{ id: 'a', element: 'C', x: 0, y: 0 }, { id: 'b', element: 'O', x: 10, y: 0 },
                    { id: 'c', element: 'Cl', x: 20, y: 0 }],
            bonds: [{ atomId1: 'a', atomId2: 'b', type: 1 }, { atomId1: 'b', atomId2: 'c', type: 1 }]
        };
        const after = {
            atoms: [{ id: 'a', element: 'C', x: 0, y: 0 }, { id: 'b', element: 'O', x: 14, y: 0 },
                    { id: 'd', element: 'N', x: 30, y: 0 }],
            bonds: [{ atomId1: 'a', atomId2: 'b', type: 2 }, { atomId1: 'b', atomId2: 'd', type: 1 }]
        };
        const r0 = W.reactor.interpolateMorph(before, after, 0);
        const r1 = W.reactor.interpolateMorph(before, after, 1);
        // 共通原子 b の座標は端点で一致（線形補間）
        assert(r0.atoms.find(a => a.id === 'b').x === 10, 't=0で共通原子が反応前座標にならない');
        assert(r1.atoms.find(a => a.id === 'b').x === 14, 't=1で共通原子が反応後座標にならない');
        // 完全表示（opacity===1）の原子集合が t=0→反応前 {a,b,c}、t=1→反応後 {a,b,d}
        const visA = r => r.atoms.filter(a => a.opacity === 1).map(a => a.id).sort().join(',');
        assert(visA(r0) === 'a,b,c', `t=0の表示原子が反応前と違う（${visA(r0)}）`);
        assert(visA(r1) === 'a,b,d', `t=1の表示原子が反応後と違う（${visA(r1)}）`);
        // 完全表示の結合次数が t=0→[1,1]（a-b単・b-c単）、t=1→[1,2]（b-d単・a-b二重）
        const visB = r => r.bonds.filter(b => b.opacity === 1).map(b => b.type).sort().join(',');
        assert(visB(r0) === '1,1', `t=0の表示結合が反応前と違う（${visB(r0)}）`);
        assert(visB(r1) === '1,2', `t=1の表示結合が反応後と違う（${visB(r1)}）`);
        // 脱離原子はフェードアウト・付加原子はフェードイン
        assert(r0.atoms.find(a => a.id === 'c').opacity === 1 && r1.atoms.find(a => a.id === 'c').opacity === 0,
            '脱離原子のフェードが端点で不正');
        assert(r0.atoms.find(a => a.id === 'd').opacity === 0 && r1.atoms.find(a => a.id === 'd').opacity === 1,
            '付加原子のフェードが端点で不正');
    });

    test('RX5: モーフィングは表示のみ — 実行時に分子は即確定しアニメ中/後も不変（P12-5 第2弾）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        g.setMode('free');
        const input = c.D.getElementById('summon-input');
        input.value = 'エタノール';
        input.dispatchEvent(new W.Event('change', { bubbles: true }));
        const btn = [...c.D.querySelectorAll('#reaction-actions button')]
            .find(b => b.textContent.includes('酸化') && b.textContent.includes('アルデヒド'));
        assert(btn, '酸化→アルデヒドのボタンがない');
        btn.click();

        // 実行直後（アニメ再生中かもしれない）に分子は確定している＝after スナップショットと一致
        const code0 = W.canonicalCode(g.userMolecule);
        const afterCode = W.canonicalCode(g.createTargetFromData({ target: W.reactor.snapshotToTarget(W.reactor.lastReaction.after) }));
        assert(code0 === afterCode, '実行直後の確定分子が after スナップショットと一致しない');

        // 数フレーム進めても分子データは不変（アニメは表示のみ）
        await c.tick(60);
        assert(W.canonicalCode(g.userMolecule) === code0, 'モーフィング中に分子データが変化した');
        // スキップ（即完了）しても不変
        W.reactor.finalizeMorph();
        assert(!W.reactor._morphing, 'finalizeMorph 後も再生中フラグが立っている');
        assert(W.canonicalCode(g.userMolecule) === code0, 'スキップ後に分子データが変化した');

        g.setMode('puzzle');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    // ===== N. チュートリアル（P9-6） =====

    test('N1: チュートリアル（FAQ・検索・3パート高速再生・完全復元）', async (c) => {
        c.reset();
        const g = c.game;
        const tp = c.W.tutorialPlayer;
        assert(tp, 'tutorialPlayer が初期化されていない');
        for (let i = 0; i < 30 && tp.tutorials.length === 0; i++) await c.tick(100);
        assert(tp.tutorials.length >= 12, `チュートリアル項目が${tp.tutorials.length}件（12以上を期待）`);
        assert(tp.tutorials.filter(t => t.answer).length >= 4, 'FAQ（テキスト項目）が4件以上ない');
        assert(tp.tutorials.some(t => t.id === 'faq-modes'), 'FAQ「モードの違い」（P10 M4）がない');

        // FAQモーダル: 一覧・検索・デバイス切替の存在
        c.D.getElementById('btn-help').click();
        assert(!c.D.getElementById('tutorial-modal').classList.contains('hidden'), 'FAQが開かない');
        assert(c.D.querySelectorAll('#tutorial-list > div').length >= 3, '一覧が3件以上出ない');
        assert(c.D.getElementById('tutorial-device'), 'デバイス切替がない');
        c.D.getElementById('tutorial-search').value = '縮合';
        c.D.getElementById('tutorial-search').dispatchEvent(new c.W.Event('input', { bubbles: true }));
        const rows = [...c.D.querySelectorAll('#tutorial-list > div')];
        assert(rows.length === 1 && rows[0].textContent.includes('縮合'), '検索で絞り込めない');
        c.D.getElementById('tutorial-search').value = '';
        c.D.getElementById('btn-tutorial-close').click();
        assert(c.D.getElementById('tutorial-modal').classList.contains('hidden'), 'FAQが閉じない');

        // 復元検証用のマーカー分子を置いてから、3パートを高速再生
        const marker = g.userMolecule.addAtom('N', 336, 294);
        g.updateDrawing();
        const histLen = g.history.length;

        await tp.play('place-atom', { fast: true });
        assert(tp.lastResult && tp.lastResult.name.includes('エタノール'),
            `place-atomの結末が「${tp.lastResult && tp.lastResult.name}」（エタノールを期待）`);

        await tp.play('bond-edit', { fast: true });
        assert(tp.lastResult.formula === 'C₂H₂',
            `bond-editの結末が${tp.lastResult.formula}（C₂H₂=アセチレンを期待）`);

        await tp.play('ring-fusion', { fast: true });
        assert(tp.lastResult.formula === 'C₁₀H₈', `ring-fusionの結末が${tp.lastResult.formula}`);
        assert(tp.lastResult.name.includes('ナフタレン'), `ring-fusionの名称が「${tp.lastResult.name}」`);

        // M2で追加した4パート（座標の陳腐化を結末の分子で検出する）
        await tp.play('bond-stretch', { fast: true });
        assert(tp.lastResult.formula === 'C₃H₈', `bond-stretchの結末が${tp.lastResult.formula}（プロパンを期待）`);

        await tp.play('functional-group', { fast: true });
        assert(tp.lastResult.name.includes('フェノール'), `functional-groupの結末が「${tp.lastResult.name}」`);

        await tp.play('reaction', { fast: true });
        assert(tp.lastResult.name.includes('エタノール'),
            `reactionの結末が「${tp.lastResult.name}」（Undoでエタノールに戻る想定）`);

        await tp.play('view-control', { fast: true });
        assert(tp.lastResult.formula === 'C₆H₆', `view-controlの結末が${tp.lastResult.formula}`);

        // M3で追加したパート（反応機構ビューア・学習ツール）も通し再生できる
        await tp.play('mechanism', { fast: true });
        assert(!c.W.reactionPlayer.active, '反応機構デモ後にモードが残っている');
        await tp.play('learn-tools', { fast: true });
        assert([...c.D.querySelectorAll('.modal-overlay')]
            .every(m => m.id === 'tutorial-modal' || m.classList.contains('hidden')),
            '学習ツールのデモ後にモーダルが開いたまま');
        assert(!c.game.condensedMode, 'デモ後に縮約表示が残っている');

        // FAQ（操作デモを持たないテキスト項目）は開閉で答えを表示する
        c.D.getElementById('btn-help').click();
        const faqRow = [...c.D.querySelectorAll('#tutorial-list > div')]
            .find(r => r.textContent.includes('正しく描いたのに'));
        assert(faqRow, 'FAQ項目が一覧に出ない');
        const faqBtn = faqRow.querySelector('button');
        assert(faqBtn.textContent === '答えを見る', `FAQのボタンが「${faqBtn.textContent}」`);
        faqBtn.click();
        assert(faqRow.textContent.includes('つながり方'), 'FAQの答えが表示されない');
        faqBtn.click();
        // 検索はFAQの本文も対象にする
        const search = c.D.getElementById('tutorial-search');
        search.value = '水素';
        search.dispatchEvent(new c.W.Event('input', { bubbles: true }));
        assert([...c.D.querySelectorAll('#tutorial-list > div')].some(r => r.textContent.includes('水素（H）')),
            '検索でFAQが引っかからない');
        search.value = '';
        search.dispatchEvent(new c.W.Event('input', { bubbles: true }));
        c.D.getElementById('btn-tutorial-close').click();

        // ホバーチップの導線（data-tutorial が主要ボタンに付いている）
        assert(c.D.querySelectorAll('[data-tutorial]').length >= 5, 'ホバー導線の属性が付いていない');
        assert(c.D.getElementById('tutorial-chip'), 'ホバーチップの要素が作られていない');

        // 完全復元: マーカー分子・履歴・オーバーレイ・元素選択
        assert(g.userMolecule.atoms.length === 1 && g.userMolecule.atoms[0].element === 'N' &&
               g.userMolecule.atoms[0].id === marker.id, 'デモ後に作図が復元されない');
        assert(g.history.length === histLen, 'デモがUndo履歴を汚した');
        assert(!c.D.getElementById('tutorial-overlay'), 'デモ終了後にオーバーレイが残っている');
        assert(g.selectedAtomType === 'C', '元素の選択状態が復元されない');

        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('N2: 録画モード用のSNSデモ（demos*.json）が完走する（P13-2）', async (c) => {
        c.reset();
        const tp = c.W.tutorialPlayer;
        // 台本はシリーズごとのファイルに分かれている（demos.json ＋ demos-*.json。2026-08-01）。
        // rec.js が ?rec= の有無によらず公開している loadAllDemos() を使う＝一覧の持ち方が
        // 1か所に閉じる（テスト側にファイル名を書き写さない）
        const demos = await c.W.loadAllDemos();
        assert(demos.length > 0, 'デモ台本が1件も取得できない');
        assert(demos.some(d => d.id === 'intro-draw'), 'intro-draw（V1台本）が登録されていない');
        demos.forEach(d => {
            if (!tp.tutorials.some(x => x.id === d.id)) tp.tutorials.push(d);
        });
        // 全SNSデモを高速再生し、座標の陳腐化を結末の分子で検出する（N1と同じ流儀）。
        // **結末を見る intro-draw は最後に回す**（demos.json の並び順に依存させない。
        // SNS動画が増えるたびに並び替えが要る作り方だと、追加のたびに落ちる）
        // **`initialState` を渡すのが本番と同じ経路**（rec.js:106 がそうしている）。
        // 渡さないと state 付きの台本（7/28件）が空のキャンバスから始まり、
        // 「反応ボタンが見つかりません」で落ちる。play() は例外を握りつぶすので、
        // 渡し忘れていた間はテストが素通りしていた（2026-08-02 に発覚）
        for (const d of demos.filter(d => d.id !== 'intro-draw')) {
            await tp.play(d.id, { fast: true, keepResult: true, initialState: d.state });
            assert(!tp.lastError, `デモ「${d.id}」の再生が落ちた: ${tp.lastError && tp.lastError.message}`);
        }
        await tp.play('intro-draw', { fast: true, keepResult: true });
        assert(!tp.lastError, `デモ「intro-draw」の再生が落ちた: ${tp.lastError && tp.lastError.message}`);
        // intro-draw の結末: フェノール（C₆H₆O）が画面に残っている（keepResult）
        assert(tp.lastResult && tp.lastResult.name.includes('フェノール'),
            `intro-drawの結末が「${tp.lastResult && tp.lastResult.name}」（フェノールを期待）`);
        assert(c.game.userMolecule.atoms.length > 0, 'keepResult なのに最終状態が画面に残っていない');
        assert(!c.D.getElementById('tutorial-overlay'), 'デモ終了後にオーバーレイが残っている');
        // 後片付け（keepResult は復元しないため、次のテストのために自前で消す）。
        // デモが開いた学習タブのアコーディオンも閉じる（V15 デモが #learn-acc-quiz を
        // 開いたまま終わるため、閉じないと Q1 の「既定は折りたたみ」が落ちる）
        c.game.userMolecule = new c.W.Molecule();
        c.game.updateDrawing();
        tp.tutorials = tp.tutorials.filter(t => !demos.some(d => d.id === t.id));
        c.D.querySelectorAll('.learn-acc').forEach(d => { d.open = false; });
    });

    test('N2b: 立体を名前に出す台本は readStereo を宣言している（P13-2・2026-08-04）', async (c) => {
        c.reset();
        // 「立体（D/L・α/β）を名前に反映する」は 2026-08-02 から**既定 OFF**。
        // 立体シリーズの台本はこれが ON でないと名称チップが題材を指さなくなるので、
        // 台本側で `readStereo: true` を宣言する（rec.js が演技の前に入れる）。
        // **宣言の取りこぼしは動画を撮ってからでないと分からない**ので、ここで固定する
        const demos = await c.W.loadAllDemos();
        const need = [
            { id: 'stereo-mutarotation', on: 'α-D-グルコース' },
            { id: 'stereo-lactic-dl', on: 'D-乳酸' },
        ];
        const before = c.game.readStereo;
        try {
            for (const { id, on } of need) {
                const d = demos.find(x => x.id === id);
                assert(d, `台本が見つからない: ${id}`);
                assert(d.readStereo === true, `${id} が readStereo を宣言していない`);
                c.game.setReadStereo(false);
                c.game.restoreState(d.state);
                const off = c.D.getElementById('compound-name').textContent;
                assert(!off.includes(on), `${id}: 立体OFFでも「${on}」が出る（前提が変わった）`);
                c.game.setReadStereo(true);
                const nm = c.D.getElementById('compound-name').textContent;
                assert(nm.includes(on), `${id}: 立体ONでも名称が「${nm}」（「${on}」を期待）`);
            }
        } finally {
            c.game.setReadStereo(before);
            c.game.userMolecule = new c.W.Molecule();
            c.game.updateDrawing();
        }
    });

    test('M2: 表記変形の健全性（縮合環のケクレ反転で価標が壊れない）', async (c) => {
        c.reset();
        const g = c.game;
        // 芳香族を含む全化合物 × 強度0〜2 × 反復で、変形後も価標が妥当かつ同一化合物のまま
        const targets = [...c.W.STAGES, ...c.W.COMPOUNDS]
            .filter(e => ['ナフタレン', 'ベンゼン', 'ニトロベンゼン', 'o-キシレン', 'フェノール',
                          '2,4,6-トリニトロトルエン（TNT）', 'ベンゼンスルホン酸']
                .some(n => e.name === n));
        assert(targets.length >= 4, `検査対象が${targets.length}件（4件以上を期待）`);
        targets.forEach(entry => {
            const orig = g.createTargetFromData({ target: entry.target });
            const origCode = c.W.canonicalCode(orig);
            for (let s = 0; s <= 2; s++) {
                for (let i = 0; i < 12; i++) {
                    const td = c.W.transformCompoundDepiction(entry.target, s);
                    const mol = g.createTargetFromData({ target: td });
                    mol.atoms.forEach(a => assert(c.W.isValencyValid(mol, a.id),
                        `${entry.name} 強度${s}: ${a.element}が価標超過（${mol.getUsedValency(a.id)}）`));
                    assert(c.W.canonicalCode(mol) === origCode,
                        `${entry.name} 強度${s}: 変形で別の化合物になった`);
                }
            }
        });
        // ナフタレンは縮合環なのでケクレ反転は行われない（形が変わっても価標は妥当のまま）
        const naph = c.W.COMPOUNDS.find(e => e.name === 'ナフタレン');
        assert(naph, 'ナフタレンがライブラリにない');
        const nm = g.createTargetFromData({ target: c.W.transformCompoundDepiction(naph.target, 2) });
        assert(nm.atoms.filter(a => nm.getUsedValency(a.id) === 4).length === 2,
            '縮合部の炭素（4本結合×2）が保たれていない');
    });

    test('M3: 主鎖の屈曲出題（一直線でない描き方・トポロジーは不変）', async (c) => {
        c.reset();
        const g = c.game;
        const heavyPts = (t) => t.atoms.filter(a => a.element !== 'H');
        const isCollinear = (t) => {
            const h = heavyPts(t);
            return new Set(h.map(a => Math.round(a.y))).size === 1 ||
                   new Set(h.map(a => Math.round(a.x))).size === 1;
        };
        // 一直線に描かれている鎖式化合物（曲げられるもの）
        const entry = [...c.W.STAGES, ...c.W.COMPOUNDS].find(e =>
            e.name === 'ブタン' || e.name === 'ペンタン' || e.name === '1-ブタノール');
        assert(entry && isCollinear(entry.target), '一直線の対象化合物が見つからない');
        const origCode = c.W.canonicalCode(g.createTargetFromData({ target: entry.target }));

        let bent = 0;
        for (let i = 0; i < 20; i++) {
            const td = c.W.transformCompoundDepiction(entry.target, 2);
            const mol = g.createTargetFromData({ target: td });
            // 屈曲してもトポロジー・価標・原子間隔は保たれる
            assert(c.W.canonicalCode(mol) === origCode, `${entry.name}: 屈曲で別の化合物になった`);
            mol.atoms.forEach(a => assert(c.W.isValencyValid(mol, a.id), '屈曲で価標が壊れた'));
            const pts = td.atoms;
            for (let x = 0; x < pts.length; x++) {
                for (let y = x + 1; y < pts.length; y++) {
                    assert(Math.hypot(pts[x].x - pts[y].x, pts[x].y - pts[y].y) >= 24,
                        '屈曲で原子が重なった');
                }
            }
            // 直交作図が保たれる（結合はすべて水平か垂直）
            td.bonds.forEach(b => {
                const p = pts[b.atom1Index], q = pts[b.atom2Index];
                assert(Math.abs(p.x - q.x) < 1 || Math.abs(p.y - q.y) < 1 ||
                       Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - 35) < 3, // ベンゼン環の辺は除く
                    '屈曲で直交作図が崩れた');
            });
            if (!isCollinear(td)) bent++;
        }
        assert(bent >= 12, `20回中${bent}回しか屈曲しなかった（12回以上を期待）`);

        // 強度0では崩さない（原形のまま出題できる）
        const flat = c.W.transformCompoundDepiction(entry.target, 0);
        assert(isCollinear(flat), '強度0で主鎖が曲がった');

        // 変形で「原子が結合線の上に乗る」図を作らない（ユーザー報告のグリシン不具合）。
        // トポロジーは壊れていなくても、伸ばした結合の途中に無関係な原子が載ると
        // 「カルボキシ基のOが中心炭素についている」ように見える。修正前はグリシンで
        // 500回中192回、距離0.0px の重なりが出ていた。
        // 合格ラインは絶対値ではなく**元の図と同じ読みやすさを保つこと**
        // （ハース環のテンプレートは元から26pxの隙間を持つため）
        const distToSeg = (p, a, b) => {
            const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
            if (L2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
            let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
            t = Math.max(0, Math.min(1, t));
            return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
        };
        const tightest = (td) => {
            let g2 = Infinity;
            td.bonds.forEach(b => {
                const A = td.atoms[b.atom1Index], B = td.atoms[b.atom2Index];
                td.atoms.forEach((p, i) => {
                    if (i === b.atom1Index || i === b.atom2Index) return;
                    g2 = Math.min(g2, distToSeg(p, A, B));
                });
            });
            return g2;
        };
        const source = (c.W.COMPOUNDS || []).concat(c.W.STAGES || []);
        ['グリシン', 'アラニン', '乳酸', 'セリン', 'β-D-グルコース（β-D-グルコピラノース）']
            .forEach(nm => {
                const e2 = source.find(x => x.name === nm && x.target);
                assert(e2, `${nm} がライブラリに無い`);
                const floor = Math.min(27.3, tightest(e2.target));
                for (let i = 0; i < 40; i++) {
                    const td = c.W.transformCompoundDepiction(e2.target, 2);
                    const gp = tightest(td);
                    assert(gp >= floor - 0.01,
                        `${nm}: 変形で原子が結合線に近づいた（${gp.toFixed(1)}px / 元の図は ${floor.toFixed(1)}px）`);
                }
            });
        // 判定を厳しくしたせいで変形しなくなっていないこと（糖は元から26pxで落ちやすい）
        const sugar = source.find(x => x.name === 'β-D-グルコース（β-D-グルコピラノース）');
        const shapes = new Set();
        for (let i = 0; i < 30; i++) {
            shapes.add(c.W.transformCompoundDepiction(sugar.target, 2)
                .atoms.map(a => a.x + ',' + a.y).join(';'));
        }
        assert(shapes.size >= 5, `糖の見た目が ${shapes.size} 通りしか出ない（判定が厳しすぎる）`);

        // 多重結合を含む分子は sp2/sp の作図を壊さない（C=Cの両端は回さない）
        const ethene = [...c.W.STAGES].find(e => e.name.includes('エチレン'));
        if (ethene) {
            for (let i = 0; i < 10; i++) {
                const td = c.W.transformCompoundDepiction(ethene.target, 2);
                const mol = g.createTargetFromData({ target: td });
                assert(c.W.canonicalCode(mol) ===
                    c.W.canonicalCode(g.createTargetFromData({ target: ethene.target })),
                    'エチレンの変形でトポロジーが変わった');
            }
        }
    });

    // ===== O. 官能基の縮約表示（P9-2） =====

    test('O1: 官能基のカード表示切替（表示のみ・判定や反応に影響しない）', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            g.userMolecule = new c.W.Molecule();
            g.updateDrawing();
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };
        const toggle = () => c.D.getElementById('btn-condense').click();
        const atomCount = () => c.D.querySelectorAll('#atoms-group .svg-atom-node').length;
        const cards = () => [...c.D.querySelectorAll('.svg-group-card')];

        // 酢酸: -COOH が1枚のカードになり、骨格（CH₃側）は残る
        summon('酢酸');
        const before = atomCount();
        const beforeFormula = g.computeMolecularFormula();
        toggle();
        assert(cards().length === 1 && cards()[0].querySelector('text').textContent === 'COOH',
            `カードが正しく出ない（${cards().map(x => x.querySelector('text').textContent)}）`);
        assert(atomCount() < before, '縮約で原子が隠れていない');
        assert(g.computeMolecularFormula() === beforeFormula, '縮約で分子式が変わった');
        assert(c.D.getElementById('compound-name').textContent.includes('酢酸'), '縮約で名称判定が変わった');
        // 作図データ自体は不変（エクスポート・判定に影響しない）
        assert(g.userMolecule.atoms.length === 4, '縮約で原子データが削除された');
        assert(c.W.verifyMolecule(g.userMolecule,
            g.createTargetFromData(c.W.STAGES.find(s => s.name === '酢酸'))), '縮約で正解判定が壊れた');
        toggle();
        assert(atomCount() === before && cards().length === 0, '元の表示に戻らない');

        // TNT: ニトロ基3つがそれぞれカードになる
        summon('2,4,6-トリニトロトルエン（TNT）');
        toggle();
        assert(cards().length === 3 && cards().every(x => x.querySelector('text').textContent === 'NO₂'),
            `TNTのニトロ基3枚にならない（${cards().length}枚）`);
        // カードが表示中の原子と重ならない（方向の最適化）
        cards().forEach(card => {
            const r = card.querySelector('rect');
            const cx = +r.getAttribute('x') + +r.getAttribute('width') / 2;
            const cy = +r.getAttribute('y') + +r.getAttribute('height') / 2;
            [...c.D.querySelectorAll('#atoms-group .svg-atom-node')].forEach(node => {
                const a = g.userMolecule.atoms.find(at => at.id === node.getAttribute('data-id'));
                if (a) assert(Math.hypot(a.x - cx, a.y - cy) >= 30, 'カードが原子と重なった');
            });
        });
        toggle();

        // スルホ基・アルデヒド基も対象。骨格が消える分子（ギ酸）は縮約しない
        const labelOf = (name) => {
            summon(name);
            toggle();
            const l = cards().map(x => x.querySelector('text').textContent).join(',');
            toggle();
            return l;
        };
        assert(labelOf('ベンゼンスルホン酸') === 'SO₃H', 'スルホ基が縮約されない');
        assert(labelOf('アセトアルデヒド') === 'CHO', 'アルデヒド基が縮約されない');
        assert(labelOf('ギ酸') === '', 'ギ酸（骨格が消える）まで縮約された');

        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    // ===== P. 官能基/不斉モードのフィードバック改善（P9-7） =====

    test('P1: 官能基配置の距離拡張・カード接続線・不斉モードの排他とプレビュー', async (c) => {
        c.reset();
        const g = c.game;
        const summon = (name) => {
            g.userMolecule = new c.W.Molecule();
            if (g.condensedMode) c.D.getElementById('btn-condense').click();
            g.updateDrawing();
            const input = c.D.getElementById('summon-input');
            input.value = name;
            input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        };

        // (1) カード化: -COOH の接続線がスタブでなく通常結合の長さになる
        summon('酢酸');
        c.D.getElementById('btn-condense').click();
        const cardLines = [...c.D.querySelectorAll('#bonds-group line')]
            .filter(l => l.getAttribute('stroke') === 'rgba(255,255,255,0.4)')
            .map(l => Math.hypot(+l.getAttribute('x2') - +l.getAttribute('x1'),
                                 +l.getAttribute('y2') - +l.getAttribute('y1')));
        assert(cardLines.length === 1 && cardLines[0] >= 25,
            `カードの接続線が短すぎる（${cardLines.map(x => x.toFixed(0))}px、25px以上を期待）`);
        c.D.getElementById('btn-condense').click();

        // (2) 混み合った位置でも、外向きに伸ばして官能基を置ける
        g.userMolecule = new c.W.Molecule();
        const cc = g.userMolecule.addAtom('C', 420, 294);
        const left = g.userMolecule.addAtom('C', 378, 294);
        g.userMolecule.addBond(cc.id, left.id, 1);
        g.userMolecule.addAtom('O', 462, 294); // 右1マスを塞ぐ
        g.userMolecule.addAtom('O', 420, 336); // 下1マスを塞ぐ
        g.userMolecule.addAtom('O', 420, 252); // 上1マスを塞ぐ
        g.updateDrawing();
        const plan = g.getFunctionalGroupPlan('oh', cc);
        assert(plan.valid, '詰まった位置で官能基が置けない（距離拡張が効いていない）');
        assert(Math.hypot(plan.atoms[0].x - cc.x, plan.atoms[0].y - cc.y) > 43,
            '距離を伸ばさずに配置しようとしている'); // GRID_SIZE(42)より大きい＝伸長された
        // 全方向を塞げば正直に拒否する
        g.userMolecule = new c.W.Molecule();
        const c2 = g.userMolecule.addAtom('C', 420, 294);
        [[378, 294], [462, 294], [420, 336], [420, 252], [336, 294], [504, 294], [420, 378], [420, 210]]
            .forEach(p => g.userMolecule.addAtom('O', p[0], p[1]));
        g.updateDrawing();
        assert(!g.getFunctionalGroupPlan('oh', c2).valid, '完全に塞がれても置けてしまう');

        // (3) 官能基モジュールと不斉マーク編集モードは排他（左パレットのボタンで切替。P10 M2）
        c.reset();
        const markBtn = c.D.getElementById('btn-asym-mark');
        markBtn.click();
        assert(g.asymmetricMode && markBtn.classList.contains('active'), '不斉マーク編集がONにならない');
        c.D.querySelector('.mod-btn[data-module="cooh"]').click();
        assert(g.selectedModule === 'cooh', 'モジュールが選択されない');
        assert(!g.asymmetricMode && !markBtn.classList.contains('active'), 'モジュール選択で不斉マーク編集が解除されない');
        // 逆方向
        c.D.querySelector('.mod-btn[data-module="oh"]').click();
        assert(g.selectedModule === 'oh', 'モジュール（oh）が選択されない');
        markBtn.click();
        assert(g.asymmetricMode && g.selectedModule === null, '不斉マーク編集ONでモジュールが解除されない');

        // (4) 不斉マーク編集モード中のホバーでプレビューリングが出る
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        g.summonMolecule('2-ブタノール');
        const asymC = g.userMolecule.atoms.find(a => a.element === 'C' && g.userMolecule.isAsymmetricCarbon(a.id));
        assert(asymC, '2-ブタノールに不斉炭素がない');
        c.hoverAt(asymC.x, asymC.y);
        assert(c.D.querySelectorAll('#ui-group circle').length >= 1, '不斉プレビューのリングが出ない');
        assert([...c.D.querySelectorAll('#ui-group text')].some(t => t.textContent === '*'),
            '不斉プレビューの * が出ない');

        if (g.asymmetricMode) markBtn.click();
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('P2: 縮合環の接合原子は空き空間の二等分線方向に置換基を置く', async (c) => {
        c.reset();
        const g = c.game;
        // largestGapDirection の基本: 3方向(-150/90/-30)なら空き角の中央=-90(真上)
        const fake = { x: 0, y: 0 };
        const nb = [-150, 90, -30].map(d => ({ atom: { x: Math.cos(d * Math.PI / 180), y: Math.sin(d * Math.PI / 180) } }));
        const dir = g.largestGapDirection(fake, nb) * 180 / Math.PI;
        assert(Math.abs(dir - (-90)) < 1, `二等分線が${dir.toFixed(0)}°（-90°を期待）`);

        // デカリンの接合炭素に官能基を付けると、環に食い込まず重ならない方向へ置かれる
        g.placeModule('cyclohexane', 420, 294, null);
        g.placeModule('cyclohexane', 493, 294, null);
        const m = g.userMolecule;
        const junction = m.atoms.find(a =>
            m.getNeighbors(a.id).filter(n => n.atom.element !== 'H').length === 3);
        assert(junction, '接合炭素が見つからない');
        const plan = g.getFunctionalGroupPlan('oh', junction);
        assert(plan.valid, '接合炭素に官能基が置けない');
        // 置いた原子が既存の重原子と重ならない
        m.atoms.filter(a => a.element !== 'H' && a.id !== junction.id).forEach(a => {
            plan.atoms.forEach(p => assert(Math.hypot(a.x - p.x, a.y - p.y) >= 27,
                `接合炭素の官能基が既存原子と重なる（${Math.hypot(a.x - p.x, a.y - p.y).toFixed(0)}px）`));
        });
        // 方向が二等分線（真上=-90°）に一致
        const d = Math.atan2(plan.atoms[0].y - junction.y, plan.atoms[0].x - junction.x) * 180 / Math.PI;
        assert(Math.abs(d - (-90)) < 5, `接合炭素の官能基が${d.toFixed(0)}°（-90°付近を期待）`);

        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('P3: 不斉マーク編集（左パレット）と判定オプション（右）の分離', async (c) => {
        c.reset();
        const g = c.game;
        const markBtn = c.D.getElementById('btn-asym-mark');
        const judgeSwitch = c.D.getElementById('check-judge-asymmetric');
        assert(markBtn, '左パレットに不斉マークボタンがない');
        assert(judgeSwitch, 'パズルに不斉判定スイッチがない');

        // マークボタンは編集モード（asymmetricMode）だけを操作し、判定オプションは変えない
        markBtn.click();
        assert(g.asymmetricMode === true && g.judgeAsymmetric === false,
            'マークボタンが判定オプションまで変えている');
        // マーク編集モード中は通常ツールが非アクティブ（排他）
        assert(!c.D.getElementById('btn-tool-select').classList.contains('active'),
            'マーク編集中もSelectツールがアクティブ');
        // 通常ツールを選ぶとマーク編集は解除
        c.D.getElementById('btn-tool-select').click();
        assert(g.asymmetricMode === false && !markBtn.classList.contains('active'),
            'ツール選択でマーク編集が解除されない');

        // 判定スイッチは判定だけを制御（編集モードは変えない）
        judgeSwitch.checked = true;
        judgeSwitch.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(g.judgeAsymmetric === true && g.asymmetricMode === false,
            '判定スイッチが編集モードまで変えている');

        // 判定オプションONで、正しくマークしたアラニンが不斉込みで正解になる
        const idx = c.W.STAGES.findIndex(s => s.name === 'アラニン');
        if (idx >= 0) {
            c.game.loadStage(idx);
            const ala = c.game.createTargetFromData(c.W.STAGES[idx]);
            // 実際の不斉炭素に正しくマークを付ける
            ala.atoms.forEach(a => {
                if (a.element === 'C') a.isAsymmetricMarked = ala.isAsymmetricCarbon(a.id);
            });
            c.game.userMolecule = ala;
            c.game.judgeAsymmetric = true;
            c.game.updateDrawing();
            c.game.verifyCurrentStructure();
            await c.tick(1100);
            const txt = c.D.getElementById('verify-result').textContent;
            assert(txt.includes('不斉炭素') && txt.includes('正解'),
                `不斉込み判定の成功メッセージが出ない（「${txt}」）`);
        }
        c.game.judgeAsymmetric = false;
        c.game.loadStage(0);
    });

    test('RF1: シス/トランス整形モード（±120°整形・cis⇄trans反転・Undo復帰。P12-7）', async (c) => {
        c.reset();
        const g = c.game;
        const G = c.W.getDoubleBondGeometry;
        const reshapeBtn = c.D.getElementById('btn-cistrans-reshape');
        assert(reshapeBtn, '左パレットにシス/トランス整形ボタンがない');

        // トランス-2-ブテンを 90°（直交）で作図: メチルが C=C 軸の反対側
        const m = new c.W.Molecule();
        const a1 = m.addAtom('C', 379, 258); // 左メチル（上）
        const cA = m.addAtom('C', 379, 300);
        const cB = m.addAtom('C', 421, 300);
        const a4 = m.addAtom('C', 421, 342); // 右メチル（下）
        m.addBond(a1.id, cA.id, 1);
        m.addBond(cA.id, cB.id, 2);
        m.addBond(cB.id, a4.id, 1);
        g.userMolecule = m;
        g.updateDrawing();
        assert(G(g.userMolecule) === 'trans', '初期描画がtransと判定されない');
        // 元座標を控えておく（Undo復帰の検証用）
        const orig = new Map(g.userMolecule.atoms.map(a => [a.id, { x: a.x, y: a.y }]));

        // 整形モードON → C=C の左炭素をタップ（中点は原子半径に潜るため炭素を直接叩く）
        reshapeBtn.click();
        assert(g.reshapeMode && reshapeBtn.classList.contains('active'), '整形モードがONにならない');
        c.clickAt(cA.x, cA.y);

        // 両端の置換基が C=C 軸から約±120°（=軸との角度120°）に配置され、transが保存される
        const angleToAxis = (sub, carbon, other) => {
            const vx = sub.x - carbon.x, vy = sub.y - carbon.y;
            const axx = other.x - carbon.x, axy = other.y - carbon.y;
            const cos = (vx * axx + vy * axy) / ((Math.hypot(vx, vy) || 1) * (Math.hypot(axx, axy) || 1));
            return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
        };
        const angA = angleToAxis(a1, cA, cB);
        const angB = angleToAxis(a4, cB, cA);
        assert(Math.abs(angA - 120) < 4, `左メチルが軸から${angA.toFixed(1)}°（120°を期待）`);
        assert(Math.abs(angB - 120) < 4, `右メチルが軸から${angB.toFixed(1)}°（120°を期待）`);
        // 結合長は維持（元は42px）
        assert(Math.abs(Math.hypot(a1.x - cA.x, a1.y - cA.y) - 42) < 1, '整形で結合長が変わった');
        assert(G(g.userMolecule) === 'trans', '整形後にtransが保存されない');

        // 同じ結合を再タップ → cis に反転（近い側の炭素の置換基だけ鏡映）
        c.clickAt(cA.x, cA.y);
        assert(G(g.userMolecule) === 'cis', '再タップでcisに反転しない');
        // 反対側（右炭素）は動いていない
        assert(cB.x === orig.get(cB.id).x && cB.y === orig.get(cB.id).y, '反転で反対側の炭素が動いた');

        // Undo 2回で元座標に完全復帰（整形1回＋反転1回）
        g.undo();
        g.undo();
        let restored = true;
        g.userMolecule.atoms.forEach(a => {
            const o = orig.get(a.id);
            if (!o || Math.abs(a.x - o.x) > 0.01 || Math.abs(a.y - o.y) > 0.01) restored = false;
        });
        assert(restored, 'Undoで元座標に復帰しない');
        assert(G(g.userMolecule) === 'trans', 'Undo後にtransへ戻らない');

        // 対象外（C=C以外）のタップはトースト通知して座標を変えない
        c.reset();
        g.reshapeMode = true;
        const eth = new c.W.Molecule();
        const e1 = eth.addAtom('C', 379, 300);
        const e2 = eth.addAtom('C', 421, 300);
        eth.addBond(e1.id, e2.id, 1); // 単結合
        g.userMolecule = eth;
        g.updateDrawing();
        const before = eth.atoms.map(a => ({ x: a.x, y: a.y }));
        c.clickAt(e1.x, e1.y);
        const unchanged = eth.atoms.every((a, i) => a.x === before[i].x && a.y === before[i].y);
        assert(unchanged, '単結合のタップで座標が動いた');

        g.reshapeMode = false;
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('RF2: 同じ名称を呼び出すと毎回まったく同じ図になる（±120°整形の再現性。v377）', async (c) => {
        const g = c.game, W = c.W;
        // 原子IDは乱数で Bond が端点をIDで正規化するため、reshapeDoubleBond が
        // bond.atomId1 を軸の始点に使うと、軸の向きが呼び出しのたびに裏返っていた。
        // 「側が不定（軸上にある）」置換基へ当てる ±1 はその軸の向きで意味が変わるので、
        // 同じイソプレンでも -CH=CH₂ が上に付いたり下に付いたりした。
        // 鎖の座標が毎回変わるため加硫の架橋が3本つながらず、RX13 が約10%落ちていた（v377 で修正）
        const sig = () => g.userMolecule.atoms.filter(a => a.element !== 'H')
            .map(a => `${a.element}${Math.round(a.x)},${Math.round(a.y)}`).sort().join('|');
        const summonSig = (name) => {
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.summonMolecule(name);
            return sig();
        };
        // C=C を持ち、整形の対象になる分子を代表で見る（イソプレンが実際に揺れていた分子）
        ['イソプレン', 'クロロプレン', 'メタクリル酸メチル', '2-メチルプロペン（イソブテン）'].forEach(name => {
            const seen = new Set();
            for (let i = 0; i < 8; i++) seen.add(summonSig(name));
            assert(seen.size === 1,
                `「${name}」を呼び出すたびに図が変わる（${seen.size}通り。原子IDの順序に依存している）`);
        });
        // 名称ライブラリ全体でも揺れないこと（同じ形のバグが他の分子で出たら落ちる）
        const unstable = [];
        [...new Set(g.getCompoundLibrary().map(e => e.name))].forEach(name => {
            const seen = new Set();
            for (let i = 0; i < 3; i++) {
                try { seen.add(summonSig(name)); } catch (e) { return; }
            }
            if (seen.size > 1) unstable.push(name);
        });
        assert(unstable.length === 0,
            `呼び出すたびに図が変わる分子がある: ${unstable.slice(0, 5).join('、')}（計${unstable.length}件）`);
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RF3: 名称から呼び出した分子の重原子が近づきすぎない（±120°整形の詰まり。v434）', async (c) => {
        const g = c.game, W = c.W;
        // アクリル酸で実際に起きていた: -COOH の枝が ±120° 整形でまるごと 30° 回り、
        // カルボニルの O がビニル炭素の 2×42×sin15° ＝ 21.7px 隣に来ていた。
        // 枝は剛体で動くので結合は何も貫通せず、整形の取り消し条件（幾何の変化・貫通）に
        // 掛からないまま通っていた（夜間監査 v365 の「原子の重なり C-O 21.7px」33件の正体）。
        // しきい値は監査と同じ 24px（重原子の重なり判定）で見る
        const MIN_PX = 24;
        const worstGap = () => {
            const heavy = g.userMolecule.atoms.filter(a => a.element !== 'H');
            let min = Infinity, pair = '';
            for (let i = 0; i < heavy.length; i++) {
                for (let j = i + 1; j < heavy.length; j++) {
                    const d = Math.hypot(heavy[i].x - heavy[j].x, heavy[i].y - heavy[j].y);
                    if (d < min) { min = d; pair = `${heavy[i].element}-${heavy[j].element}`; }
                }
            }
            return { min, pair };
        };
        const tight = [];
        [...new Set(g.getCompoundLibrary().map(e => e.name))].forEach(name => {
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            try { g.summonMolecule(name); } catch (e) { return; }
            const { min, pair } = worstGap();
            if (min < MIN_PX) tight.push(`${name}（${pair} ${min.toFixed(1)}px）`);
        });
        assert(tight.length === 0,
            `呼び出した図で重原子が ${MIN_PX}px 未満に詰まる分子がある: ` +
            `${tight.slice(0, 5).join('、')}（計${tight.length}件）`);
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    // ===== Q. モード切替（P10 M1） =====

    test('QX1: 抜けるときの手当て（書きかけの確認・パズルのやめる。ユーザー判断 B・C）', async (c) => {
        c.reset();
        const g = c.game, D = c.D, W = c.W;
        const modal = D.getElementById('confirm-modal');
        assert(modal, '確認モーダルの器が無い');
        const saved = g.currentMode;

        // (1) **書きかけが無ければ黙って進む**（空の確認で邪魔しない）
        g.setMode('learn');
        assert(g.pendingPractices('free').length === 0, '練習していないのに書きかけ扱い');
        let moved = false;
        g.leaveGuard('free', () => { moved = true; });
        assert(moved, '書きかけが無いのに移動が止まった');
        assert(modal.classList.contains('hidden'), '書きかけが無いのに確認が出た');

        // (2) 書きかけ（entries が1個以上）があると確認が出て、**押すまで移動しない**
        const ip = W.isomerPractice;
        assert(ip, 'isomerPractice が初期化されていない');
        const savedActive = ip.active, savedEntries = ip.entries;
        ip.active = true;
        ip.entries = [{ code: 'dummy', name: 'ダミー', target: null, order: 1 }];
        assert(g.pendingPractices('free').length === 1, '書きかけが検出されない');
        assert(g.pendingPractices('learn').length === 0, '学習へ移るのに書きかけ扱いになる');
        moved = false;
        g.leaveGuard('free', () => { moved = true; });
        assert(!modal.classList.contains('hidden'), '書きかけがあるのに確認が出ない');
        assert(!moved, '確認を出す前に移動してしまった');
        assert(/異性体/.test(D.getElementById('confirm-title').textContent),
            `確認の見出しに何が消えるかが出ていない（${D.getElementById('confirm-title').textContent}）`);

        // (3) 「やめておく」で移動しない・閉じる
        D.getElementById('btn-confirm-cancel').click();
        assert(modal.classList.contains('hidden'), 'やめておくで閉じない');
        assert(!moved, 'やめておくのに移動した');

        // (4) 「移動する」で初めて進む
        g.leaveGuard('free', () => { moved = true; });
        D.getElementById('btn-confirm-ok').click();
        assert(moved, '移動するを押しても進まない');
        assert(modal.classList.contains('hidden'), '移動したのに確認が残っている');

        ip.active = savedActive; ip.entries = savedEntries;

        // (5) **setMode 自体は止めない。** 台本・テスト・?open= から呼ばれるため
        ip.active = true;
        ip.entries = [{ code: 'dummy', name: 'ダミー', target: null, order: 1 }];
        g.setMode('free');
        assert(g.currentMode === 'free', 'setMode が確認で止められている（無人再生が固まる）');
        assert(modal.classList.contains('hidden'), 'setMode が確認を出している');
        ip.active = savedActive; ip.entries = savedEntries;

        // (6) パズルの「やめて次へ」があり、次のお題へ進む（ユーザー判断 C）
        g.setMode('puzzle');
        const btn = D.getElementById('btn-give-up');
        assert(btn, 'パズルに「やめて次へ」が無い');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        const before = g.currentStageIndex;
        btn.click();                       // 空のキャンバスなら確認なしで進む
        assert(modal.classList.contains('hidden'), '空なのに確認が出た');
        assert(g.currentStageIndex !== before, 'お題が変わらない');

        // (7) 描いてあるときは確認が出る（描いた図が消えるため）
        g.userMolecule.addAtom('C', 400, 300);
        g.updateDrawing();
        btn.click();
        assert(!modal.classList.contains('hidden'), '描いてあるのに確認なしで進んだ');
        D.getElementById('btn-confirm-cancel').click();

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        g.setMode(saved);
    });

    test('Q0: 🧪自由が標準で、パズル・学習は呼び出す⇆戻る（入口見直し §8b）', async (c) => {
        c.reset();
        const g = c.game, D = c.D, W = c.W;
        const saved = g.currentMode;

        // (1) タブは3つのまま。**data-mode の3値は変えていない**
        const order = [...D.querySelectorAll('.mode-tab')].map(t => t.dataset.mode);
        assert(order.length === 3, `モードタブが3つない（${order.length}）`);
        assert(order.includes('free') && order.includes('puzzle') && order.includes('learn'),
            '自由・パズル・学習のタブが揃っていない');
        // ⚠ 第5段で右パネルが消え、**3つとも居場所はリボン1か所**になった
        // （📚 学習＝第3段／🧩 パズル・🧪 自由＝第4段）。空の器 `#mode-tabs` は残してあるが空のまま
        const hdr = D.querySelector('.canvas-header');
        assert([...D.querySelectorAll('.mode-tab')].every(t => hdr.contains(t)),
            'リボンの外にモードタブがある（3つともリボンへ移した）');
        assert(D.getElementById('mode-tabs').querySelectorAll('*').length === 0,
            '空の器 #mode-tabs にタブが戻っている（複製すると .active が2箇所で点く）');
        const freeTile = D.querySelector('.canvas-header .mode-tab[data-mode="free"]');
        assert(freeTile, '「← 自由へ」がリボン（.canvas-header）の中に無い');
        assert(D.querySelectorAll('.mode-tab[data-mode="free"]').length === 1,
            '自由タブが2つある（移設したのに複製が残っている）');

        // (1b) **標準にいる間は枠を使わない**（§12-1 の「1枠空く」の実体）
        g.setMode('free');
        assert(freeTile.getClientRects().length === 0,
            '標準（自由）にいるのにリボンの「← 自由へ」が出ている（枠が空かない）');
        g.setMode('puzzle');
        assert(freeTile.getClientRects().length > 0, 'パズルにいるのに「← 自由へ」が出ない');
        // 隠れていても click() は効く ＝ 台本 12箇所（`.mode-tab[data-mode="free"]`）は壊れない
        g.setMode('free');
        freeTile.click();
        assert(g.currentMode === 'free', '隠れた「← 自由へ」の click() が効かない（台本 12箇所が落ちる）');

        // (2) 知らない値は**自由**へ落ちる（以前はパズルだった）
        g.setMode('そんなモードは無い');
        assert(g.currentMode === 'free', `知らない値が ${g.currentMode} へ落ちる`);

        // (3) 「← 自由に戻る」は行き先にいるときだけ出る
        const back = D.getElementById('btn-back-to-free');
        assert(back, '「自由に戻る」ボタンが無い');
        assert(back.style.display === 'none', '標準にいるのに戻るボタンが出ている');
        ['puzzle', 'learn'].forEach(m => {
            g.setMode(m);
            assert(back.style.display !== 'none', `${m} で戻るボタンが出ない`);
        });

        // (4) 戻っても**描いている分子はそのまま**（setMode は表示を切り替えるだけ）
        g.setMode('free');
        g.userMolecule = new W.Molecule();
        const a1 = g.userMolecule.addAtom('C', 400, 300);
        const a2 = g.userMolecule.addAtom('O', 442, 300);
        g.userMolecule.addBond(a1.id, a2.id, 1);
        g.updateDrawing();
        const before = g.userMolecule.atoms.length;
        g.setMode('puzzle');
        back.click();
        assert(g.currentMode === 'free', '戻るボタンで自由へ帰れない');
        assert(g.userMolecule.atoms.length === before, '行き来で作図が消えた');
        assert(back.style.display === 'none', '戻った後も戻るボタンが残っている');

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        g.setMode(saved);
    });

    test('Q1: 3モードで面（作業帯・モーダル・data-modes）が正しく出し分けられる', async (c) => {
        c.reset();
        const g = c.game;
        const D = c.D;
        // 既定はパズル。localStorage汚染を避けるため最後にパズルへ戻す
        const rendered = (sel) => { const e = D.querySelector(sel); return !!(e && e.offsetParent !== null); };
        // ⚠ セレクタから `#right-panel` を外した（§8-3・第5段）。
        //    残っている `[data-modes]` は `#compound-info`（puzzle free）1つだけ
        const wrapperHidden = (modes) => {
            const el = [...D.querySelectorAll('[data-modes]')].find(w => w.dataset.modes === modes);
            return el && el.style.display === 'none';
        };
        assert(D.querySelectorAll('.mode-tab').length === 3, 'モードタブが3つない');

        g.setMode('puzzle');
        assert(g.currentMode === 'puzzle', 'モードがpuzzleにならない');
        // ⚠ 判定は右パネルではなく**作業帯のお題ストリップ**（第4段・§7-3 案A）。
        // 「モードに入ったら見えている」ことは変わらないので、置き場所だけ読み替える
        assert(rendered('#btn-verify'), 'パズルで判定ボタンが出ない');
        assert(D.getElementById('work-strip').contains(D.getElementById('btn-verify')),
            '構造判定が作業帯のお題ストリップに無い');
        // 項目21: 「何をするモードか」の案内は Puzzle モーダルの中（第4段・§7-4）
        g.setPuzzleOpen(true);
        assert(rendered('#puzzle-howto') && /構造判定/.test(D.getElementById('puzzle-howto').textContent),
            'パズルで操作手順の案内が出ない');
        g.setPuzzleOpen(false);
        assert(!wrapperHidden('puzzle free'), 'パズルで名前・分子式の器が隠れている');
        // 🧪 標準の面（名称呼び出し）はパズルでは畳む（帯は薄いほど良い・§16-3）
        assert(D.getElementById('ws-free').classList.contains('hidden'),
            'パズルなのに 🧪 標準の面（名称呼び出し）が帯に出ている');
        // 第5段の後、`[data-modes]` が残っているのは `#compound-info` の1つだけ ＝
        // 他は全部モーダル・作業帯・リボンへ出た（§5-2 の 38項目）
        const modeWrappers = [...D.querySelectorAll('[data-modes]')].map(w => w.dataset.modes);
        assert(modeWrappers.length === 1 && modeWrappers[0] === 'puzzle free',
            `data-modes の要素が想定外（${modeWrappers.join(' / ') || 'なし'}）`);
        assert([...D.querySelectorAll('.mode-tab')].find(t => t.classList.contains('active')).dataset.mode === 'puzzle',
            'アクティブタブがpuzzleでない');

        g.setMode('learn');
        // 項目20: 学習はアコーディオン3つ。入り口（summary）が見え、既定は折りたたみ、開くと中身が出る。
        // ⚠ 置き場所は右パネル → **Study モーダル**（リボン統合 第3段）。中身と id は無改変で、
        // 「モードで出し分ける」から「タイルで開く」に変わっただけなので、開いてから同じことを見る
        g.setStudyOpen(true);
        assert(rendered('#learn-acc-quiz > summary') && rendered('#learn-acc-practice > summary') &&
            rendered('#reaction-box > summary'), '学習でアコーディオンの入り口が出ない');
        const accQuiz = D.getElementById('learn-acc-quiz');
        const accRx = D.getElementById('reaction-box');
        assert(!accQuiz.open && !accRx.open, 'アコーディオンの既定が折りたたみでない');
        // 閉じた details の中身は display:none ではなく content-visibility で隠れる（Chrome 97+）ため
        // offsetParent ベースの rendered() では判定できない。checkVisibility() で見えないことを確認する
        assert(!D.getElementById('btn-quiz').checkVisibility(), '折りたたみ中なのにクイズボタンが見えている');
        accQuiz.open = true; accRx.open = true;
        assert(rendered('#btn-quiz') && rendered('#select-reaction'), 'アコーディオンを開いてもクイズ/機構が出ない');
        accQuiz.open = false; accRx.open = false;
        g.setStudyOpen(false);
        assert(wrapperHidden('puzzle free'), '学習で名前・分子式の器が隠れていない（出し分けが効いていない）');
        assert(D.getElementById('work-strip').classList.contains('hidden'),
            '学習に移っても作業帯が畳まれない');
        // ⚠ パズルの節は右パネルに無い（第4段）。代わりに**お題ストリップが畳まれている**ことを見る
        assert(!rendered('#btn-verify'), '学習に移ってもお題ストリップが出たまま');
        // verify-result（トースト表示先）は全モードで存在し続ける
        assert(D.getElementById('verify-result'), '学習でverify-resultが消えた');

        g.setMode('free');
        // ⚠ `#reaction-card`（🔬 調べる）は**作業帯の 🧪 の面**へ移った（第5段）。
        //    `#compound-info` は隠しの控えだが、`data-modes` の出し分けはここでも生きている
        assert(rendered('#reaction-card') && rendered('#compound-info'), '自由で反応カード/分子情報が出ない');
        assert(D.getElementById('ws-free').contains(D.getElementById('summon-input')),
            '名称呼び出しが 🧪 標準の面に無い');
        // ⚠ learn / puzzle の節はもう右パネルに無い（Study / Puzzle モーダルへ移設）。
        // 代わりに「離れたらモーダルが閉じている」を見る ＝ 裏で開きっぱなしにしない
        assert(!rendered('#btn-verify'), '自由に移ってもお題ストリップが出たまま');
        assert(D.getElementById('study-modal').classList.contains('hidden'),
            '自由へ移っても Study モーダルが開いたまま');
        assert(D.getElementById('puzzle-modal').classList.contains('hidden'),
            '自由へ移っても Puzzle モーダルが開いたまま');

        // モード切替でも作図中の分子は保持される
        g.setMode('puzzle');
        const c1 = g.userMolecule.addAtom('C', 336, 294);
        const c2 = g.userMolecule.addAtom('C', 378, 294);
        g.userMolecule.addBond(c1.id, c2.id, 1);
        g.updateDrawing();
        g.setMode('free');
        assert(g.userMolecule.atoms.length === 2, 'モード切替で分子が消えた');
        g.setMode('learn');
        assert(g.userMolecule.atoms.length === 2, 'モード切替で分子が消えた(2)');

        // 学習を離れると反応機構モードが終了する
        c.W.reactionPlayer.checkMode.checked = true;
        c.W.reactionPlayer.enter(0);
        assert(c.W.reactionPlayer.active, '反応機構モードに入れない');
        g.setMode('free');
        assert(!c.W.reactionPlayer.active, '学習を離れても反応機構モードが残っている');

        g.setMode('puzzle');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    // R1（スマホ用シートの開閉配線）は**畳んだ** —— ☰・✕閉じる・バックドロップ・
    // `body.sheet-open` は第5段で消えた。「無いこと」の主張は RB13 が引き継ぐ

    test('R2: モバイル横レイアウトのCSSルール（P11 M2・向き別メディアクエリ）', async (c) => {
        const D = c.D;
        // ⚠ 第5段でシート/ドロワー（`body.sheet-open #right-panel` の translateY / translateX）は
        //    消えた。向き別のブロックが**まだ生きている**ことは、向き専用の指定で見る。
        //    iframe のビューポートに依存しない CSSOM 検査。
        let portraitStrip = false, landscapeStrip = false, landscapeLeftCol = false;
        for (const sheet of D.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
            for (const r of rules) {
                if (r.type !== 4 /* MEDIA_RULE */) continue;
                const cond = r.conditionText || '';
                if (!/max-width:\s*899px/.test(cond)) continue;
                const isPortrait = /orientation:\s*portrait/.test(cond);
                const isLandscape = /orientation:\s*landscape/.test(cond);
                for (const rr of r.cssRules) {
                    // 横向きは作業帯がリボン（右端 109px）を避ける ＝ 向き別ブロックが効いている証拠
                    if (isLandscape && rr.selectorText === '.work-strip' && rr.style.right) landscapeStrip = true;
                    if (isPortrait && rr.selectorText === 'main' && rr.style.flexDirection === 'column') portraitStrip = true;
                    if (isLandscape && rr.selectorText === '#left-panel' && rr.style.width) {
                        landscapeLeftCol = true;
                    }
                }
            }
        }
        assert(portraitStrip, '縦向き専用のブロック（main を縦積みにする指定）がない');
        assert(landscapeStrip, '横向きで作業帯がリボンを避ける指定（.work-strip { right }）がない');
        assert(landscapeLeftCol, '横向きの左ツール列（幅指定）ルールがない');
    });

    test('R15: ベンゼン環の置換基もクリアランスを守る（P9-5e 夜間監査のフォロー）', async (c) => {
        const g = c.game, W = c.W, D = c.D;
        // getSnappedCoords のベンゼン環分岐は、8pxの占有判定だけで可否を決めており、
        // 他の経路が守っている MIN_CLEARANCE（GRID_SIZE*0.65 = 27.3px）を通っていなかった。
        // そのため環の近くに別の環があると、置換基が非結合原子の12〜23pxまで寄って置けた
        // （監査の「原子の重なり」約530件。実測で Br が既存の C から 12.9px に isValid=true）
        const svg = c.svg;
        const toClient = (x, y) => {
            const p = new W.DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
            return { clientX: p.x, clientY: p.y };
        };
        const tap = (x, y) => {
            const o = toClient(x, y);
            const mk = (t) => new W.PointerEvent(t, { bubbles: true, cancelable: true,
                pointerId: 1, pointerType: 'mouse', button: 0, clientX: o.clientX, clientY: o.clientY });
            svg.dispatchEvent(mk('pointerdown'));
            svg.dispatchEvent(mk('pointerup'));
        };
        const minHeavy = () => {
            const h = g.userMolecule.atoms.filter(a => a.element !== 'H');
            let m = 999;
            for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) {
                if (g.userMolecule.getBond(h[i].id, h[j].id)) continue;
                const d = Math.hypot(h[i].x - h[j].x, h[i].y - h[j].y);
                if (d < m) m = d;
            }
            return m;
        };
        const build = (second) => {
            c.reset();
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.history = []; g.redoStack = [];
            g.selectedTool = 'select'; g.selectedAtomType = 'C'; g.selectedModule = null;
            g.updateDrawing();
            g.selectedModule = 'benzene'; tap(420, 252); g.selectedModule = null;
            if (second) { g.selectedModule = 'benzene'; tap(second.x, second.y); g.selectedModule = null; }
        };
        // 置換基が出る位置（環中心から BOND_LENGTH*1.666 = 70px）を直接叩く
        const substPoints = () => g.userMolecule.atoms
            .filter(a => a.benzeneCenter && a.benzeneAngle !== undefined)
            .map(a => ({ x: a.benzeneCenter.x + 70 * Math.cos(a.benzeneAngle),
                         y: a.benzeneCenter.y + 70 * Math.sin(a.benzeneAngle) }));

        // 1. 単独のベンゼンでは6箇所すべてに置ける（従来動作の維持）
        build(null);
        let placed = 0;
        substPoints().forEach(p => {
            const n = g.userMolecule.atoms.length;
            g.selectedAtomType = 'Cl';
            tap(p.x, p.y);
            if (g.userMolecule.atoms.length > n) placed++;
        });
        assert(placed === 6, `単独のベンゼンで置けた置換基が ${placed} 個（6個を期待。判定が厳しすぎる）`);
        assert(minHeavy() >= 24, `単独のベンゼンで最接近 ${minHeavy().toFixed(1)}px`);

        // 2. 近くに別の環があっても、非結合原子に寄った位置には置かせない
        build({ x: 546, y: 336 });
        substPoints().forEach(p => {
            g.selectedAtomType = 'Br';
            tap(p.x, p.y);
        });
        assert(minHeavy() >= 24,
            `環が2つあるとき置換基が非結合原子に寄った（最接近 ${minHeavy().toFixed(1)}px < 24px）`);
    });

    test('R14: 自動水素は混雑した向きでは短く描く（P9-5e 夜間監査のフォロー）', async (c) => {
        const g = c.game, W = c.W;
        // 監査 v232 で「自動水素の重なり」1008件（Br付近481件が最多）。向きの選び方だけでは
        // 足りず、非結合原子が配置の許容下限（27.3px）ぎりぎりの28pxに**合法に**置かれると、
        // そちらを向いた水素は 28−16 = 12px まで寄る。向きを変えられないときは長さで逃がす。
        // 重原子の座標は動かさないので、判定・反応・エクスポートには影響しない
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []).filter(e => e.target);
        const HEAVY_MIN = 24; // 監査の「原子の重なり」閾値。これ未満は別の不具合クラス
        let cases = 0, viol = 0, worst = 999;
        source.slice(0, 40).forEach(e => {
            const base = g.createTargetFromData({ target: e.target });
            base.atoms.filter(a => a.element !== 'H').slice(0, 3).forEach(anchor => {
                ['Br', 'O'].forEach(el => {
                    for (let k = 0; k < 8; k++) {
                        const ang = k * Math.PI / 4;
                        const m = g.createTargetFromData({ target: e.target });
                        const ox = Math.round(anchor.x + 28 * Math.cos(ang));
                        const oy = Math.round(anchor.y + 28 * Math.sin(ang));
                        if (m.atoms.some(a => a.element !== 'H' && Math.hypot(a.x - ox, a.y - oy) < HEAVY_MIN)) continue;
                        m.addAtom(el, ox, oy);
                        cases++;
                        m.calculateHydrogens().forEach(h => m.atoms.forEach(at => {
                            if (at.id === h.parentId || at.element === 'H') return;
                            const d = Math.hypot(h.x - at.x, h.y - at.y);
                            if (d < 12) viol++;
                            if (d < worst) worst = d;
                        }));
                    }
                });
            });
        });
        assert(cases > 500, `検査した配置が少なすぎる（${cases}通り）`);
        assert(viol === 0, `自動水素が重原子に12px未満まで寄った配置が ${viol} 件（最接近 ${worst.toFixed(1)}px）`);
        // 短くしすぎて結合線が消えていないこと
        const m2 = g.createTargetFromData({ target: source.find(e => e.name === 'エタノール').target });
        const hs = m2.calculateHydrogens();
        hs.forEach(h => {
            const p = m2.atoms.find(a => a.id === h.parentId);
            const len = Math.hypot(h.x - p.x, h.y - p.y);
            assert(len >= 9, `水素の結合が短すぎる（${len.toFixed(1)}px）`);
        });
    });

    test('R13: 複数分子に①②③を振り、図の下に名前を出す／呼び出しは折り返して上限で止まる', async (c) => {
        const g = c.game, W = c.W, D = c.D;
        // ユーザー要望「分子名は図上の化合物の下側に表示」「分子に識別記号を振り、右ペインにも反映」。
        // 記号は **A/B/C を使わない**（C＝炭素・B＝ホウ素と元素記号がぶつかる。
        // α/β も糖のアノマー表記で使用中）。丸数字はどちらともぶつからない
        const setup = (n) => {
            c.reset();
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            for (let i = 0; i < n; i++) g.summonMolecule(i % 2 ? 'エタノール' : '酢酸');
        };
        const canvasLabels = () => [...c.svg.querySelectorAll('text')]
            .map(t => t.textContent).filter(s => /^🔍/.test(s));

        // **1分子でも出す**（DESIGN_molecule_modal.md §10-2 のユーザー決定）。
        // 見出しは分子モーダルの入口を兼ねるようになったので、1分子で消えると入口ごと消える。
        // 番号は付かない（指すものが1つしかない）＝ 右パネルの表記もこれまでどおり
        setup(1);
        assert(canvasLabels().length === 1, `1分子のとき図の見出しが ${canvasLabels().length} 個`);
        assert(!/[①-⑳]/.test(canvasLabels()[0]), `1分子なのに見出しに番号が付いている（${canvasLabels()[0]}）`);
        assert(!/^[①-⑳]/.test(D.getElementById('compound-name').textContent),
            '1分子なのに右パネルに番号が付いている');

        // 2分子で図と右パネルの両方に同じ番号が出る
        setup(2);
        const labels = canvasLabels();
        assert(typeof W.moleculeMark === 'function', 'moleculeMark が公開されていない');
        assert(labels.length === 2, `図の見出しが ${labels.length} 個（2個を期待）`);
        assert(labels.some(s => s.includes('①')) && labels.some(s => s.includes('②')),
            `見出しの番号が①②になっていない（${labels.join(' / ')}）`);
        labels.forEach(s => assert(!/\b[ABC]\b/.test(s), '元素記号とぶつかる A/B/C を使っている'));
        const panel = D.getElementById('compound-name').textContent;
        assert(/①/.test(panel) && /②/.test(panel), `右パネルに番号が反映されていない（${panel}）`);
        // 図の見出しは各分子の下にある
        const parts = g.splitMolecules();
        parts.forEach((p, i) => {
            const maxY = Math.max(...p.atoms.filter(a => a.element !== 'H').map(a => a.y));
            const t = [...c.svg.querySelectorAll('text')].find(x => x.textContent.includes(W.moleculeMark(i)));
            assert(t && +t.getAttribute('y') > maxY, `${i + 1}つめの見出しが分子の下に無い`);
        });

        // 呼び出しは横に伸ばし続けず、下の段へ折り返す（作図の上限 |x|>5000 を超えないため）
        setup(24);
        const xs = g.userMolecule.atoms.map(a => a.x), ys = g.userMolecule.atoms.map(a => a.y);
        assert(g.splitMolecules().length === 24, `24分子置けていない（${g.splitMolecules().length}）`);
        const LIMIT = W.CANVAS_LIMIT;
        assert(Math.max(...xs) <= LIMIT && Math.max(...ys) <= LIMIT, '作図の上限を超えた位置に置いた');
        assert(Math.max(...ys) > Math.min(...ys) + 100, '折り返していない（1段に並べ続けている）');
        // 折り返し後も1段に複数入る（全体の右端を基準にすると1段1分子になる不具合があった）
        const bandCount = new Set(g.userMolecule.atoms.map(a => Math.round(a.y / 210))).size;
        assert(bandCount <= 6, `24分子で段が ${bandCount} 段（詰まっていない）`);
    });

    test('R12: Shift+ドラッグで分子を丸ごと動かす（複数分子の位置調整）', async (c) => {
        const g = c.game, W = c.W, svg = c.svg;
        // 反応実行は場所が足りないと「分子を離してから実行してください」と案内するのに、
        // 離す手段が無かった（素の原子は select ツールではクリックで削除/置換になる）。
        // ユーザー要望「複数分子の位置関係を調整する移動機能がほしい」
        const drag = (from, to, shift) => {
            const orig = g.clientToSvg;
            g.clientToSvg = (x, y) => ({ x, y });
            const opt = (x, y, extra) => Object.assign({ bubbles: true, cancelable: true, pointerId: 55,
                pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y,
                isPrimary: true, shiftKey: !!shift }, extra || {});
            svg.dispatchEvent(new W.PointerEvent('pointerdown', opt(from.x, from.y)));
            const n = g.dragWholeIds ? g.dragWholeIds.size : 0;
            svg.dispatchEvent(new W.PointerEvent('pointermove', opt(to.x, to.y)));
            svg.dispatchEvent(new W.PointerEvent('pointerup', opt(to.x, to.y, { buttons: 0 })));
            g.clientToSvg = orig;
            return n;
        };
        const setup = () => {
            c.reset();
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.summonMolecule('酢酸');
            g.summonMolecule('エタノール');
        };

        setup();
        const GRID = W.GRID_SIZE || 42; // 作図の格子（game.js）
        const code0 = W.canonicalCode(g.userMolecule);
        const heavy = () => g.userMolecule.atoms.filter(a => a.element !== 'H');
        const grabbed = heavy().sort((a, b) => b.x - a.x)[0];
        const acetic = heavy().sort((a, b) => a.x - b.x)[0];
        const x0 = grabbed.x, y0 = grabbed.y, aceticX0 = acetic.x, aceticY0 = acetic.y;

        const n = drag({ x: x0, y: y0 }, { x: x0, y: y0 + GRID * 3 }, true);
        assert(n === 3, `掴んだ分子の原子数が ${n}（エタノールの3を期待）`);
        // 形は変えない＝構造コードは不変
        assert(W.canonicalCode(g.userMolecule) === code0, '分子ごと移動で構造が変わった');
        // 吸着に引かれて横へずれない（分子を離したいのに相手へ吸い寄せられては困る）
        assert(grabbed.x === x0, `横に ${grabbed.x - x0}px ずれた（吸着に引かれている）`);
        assert(grabbed.y === y0 + GRID * 3, `縦の移動量が違う（${grabbed.y - y0}）`);
        // 相手の分子は動いていない
        assert(acetic.x === aceticX0 && acetic.y === aceticY0, '掴んでいない分子まで動いた');

        // 相手と重なる位置へは置けない
        const keep = { x: grabbed.x, y: grabbed.y };
        drag({ x: grabbed.x, y: grabbed.y }, { x: acetic.x, y: acetic.y }, true);
        assert(grabbed.x === keep.x && grabbed.y === keep.y, '他の分子と重なる位置に置けてしまった');

        // Shift なしは従来どおり（同じ元素のクリックは削除）
        setup();
        const before = g.userMolecule.atoms.length;
        const cAtom = heavy().find(a => a.element === 'C');
        drag({ x: cAtom.x, y: cAtom.y }, { x: cAtom.x, y: cAtom.y }, false);
        assert(g.userMolecule.atoms.length < before, 'Shiftなしの従来動作（クリックで削除）が壊れた');
    });

    test('R11: 操作説明に書いたキャンバス操作が実装と一致する', async (c) => {
        const g = c.game, D = c.D, svg = c.svg;
        // 右パネルの説明文にキャンバスの移動・拡大縮小を載せた（ユーザー指摘「載っておらず分かりづらい」）。
        // 説明と実装がずれると案内が嘘になるので、両方をここで突き合わせる。
        // とくに**素のホイールは移動・拡大縮小は Ctrl+ホイール**である点（外部レビューでは逆に書かれていた）
        const box = D.querySelector('.hint-box');
        assert(box, '操作説明の箱がない');
        const nav = [...box.querySelectorAll('li')].find(e => /キャンバスの移動/.test(e.textContent));
        assert(nav, '説明に「キャンバスの移動・拡大縮小」がない');
        const txt = nav.textContent.replace(/\s+/g, '');
        ['右ボタンでドラッグ', 'Ctrl', 'ピンチ', '全体表示'].forEach(k =>
            assert(txt.includes(k), `説明に「${k}」が無い`));

        const vb = () => ({ x: +svg.viewBox.baseVal.x.toFixed(1), y: +svg.viewBox.baseVal.y.toFixed(1),
                            w: +svg.viewBox.baseVal.width.toFixed(1) });
        const W = c.W;
        // 素のホイール = 移動（幅は変わらない）
        const a0 = vb();
        svg.dispatchEvent(new W.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
        const a1 = vb();
        assert(a1.w === a0.w, `素のホイールで拡大縮小してしまった（幅 ${a0.w}→${a1.w}）`);
        assert(a1.y !== a0.y || a1.x !== a0.x, '素のホイールで移動しない');
        // Ctrl+ホイール = 拡大縮小
        svg.dispatchEvent(new W.WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
        const a2 = vb();
        assert(a2.w !== a1.w, `Ctrl+ホイールで拡大縮小しない（幅 ${a1.w}→${a2.w}）`);
        // 右ボタンドラッグ = 移動
        const opt = { bubbles: true, cancelable: true, pointerId: 91, pointerType: 'mouse', button: 2, buttons: 2, clientX: 400, clientY: 300, isPrimary: true };
        svg.dispatchEvent(new W.PointerEvent('pointerdown', opt));
        assert(g.pan && g.pan.isPanning, '右ボタンドラッグでパンが始まらない');
        svg.dispatchEvent(new W.PointerEvent('pointermove', Object.assign({}, opt, { clientX: 470 })));
        const a3 = vb();
        svg.dispatchEvent(new W.PointerEvent('pointerup', Object.assign({}, opt, { clientX: 470, buttons: 0 })));
        assert(a3.x !== a2.x && a3.w === a2.w, `右ボタンドラッグで移動しない（x ${a2.x}→${a3.x}）`);
        g.fitCanvasToTarget();
    });

    test('R10: 環炭素の2本目の側鎖が「出る位置」でも吸着する（1,1-ジメチルシクロヘキサン）', async (c) => {
        const g = c.game, W = c.W;
        // 2本目の側鎖は二等分線±30°に出るが、その位置は環炭素より既存の側鎖に近い。
        // 吸着先を原子までの距離だけで決めていたため、素直にドラッグすると側鎖に吸着し、
        // 同じ炭素に2本目を付ける判定が極端に狭かった（ユーザー指摘）。
        // 実測では2本目の出現位置(379,222)/(421,222)に対し、環炭素の範囲は y≥238 までだった
        c.reset();
        const e = (W.COMPOUNDS || []).concat(W.STAGES || []).find(x => x.name === 'シクロヘキサン');
        assert(e, 'シクロヘキサンがライブラリに無い');
        g.userMolecule = g.createTargetFromData({ target: e.target });
        const mol = g.userMolecule;
        const ring = mol.atoms.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x))[0];
        const me = mol.addAtom('C', ring.x, ring.y - 42);
        mol.addBond(ring.id, me.id, 1);
        g.updateDrawing();

        const pts = g.secondBranchPoints(ring);
        assert(pts.length === 2, `2本目の候補位置が ${pts.length} 個（2個を期待）`);

        // getSnappedCoords はクライアント座標を受けるので、変換を一時的に素通しにする
        const orig = g.clientToSvg;
        g.clientToSvg = (x, y) => ({ x, y });
        try {
            pts.forEach(p => {
                const r = g.getSnappedCoords({ clientX: Math.round(p.x), clientY: Math.round(p.y) });
                assert(r.snapAtom && r.snapAtom.id === ring.id,
                    `2本目の出現位置 (${Math.round(p.x)},${Math.round(p.y)}) で環炭素に吸着しない`);
            });
            // 側鎖の鎖を伸ばす操作は壊さない（側鎖の真上は側鎖に吸着したまま）
            const up = g.getSnappedCoords({ clientX: me.x, clientY: me.y - 42 });
            assert(up.snapAtom && up.snapAtom.id === me.id,
                '側鎖の真上が側鎖に吸着しない（鎖を伸ばせなくなっている）');
        } finally {
            g.clientToSvg = orig;
        }

        // 側鎖を持たない環炭素・鎖式原子では候補を返さない（他の作図に影響しない）
        const plain = mol.atoms.find(a => a.id !== ring.id && a.id !== me.id &&
            mol.getNeighbors(a.id).filter(n => n.atom.element !== 'H').length === 2);
        assert(plain && g.secondBranchPoints(plain).length === 0,
            '側鎖のない環炭素にも候補を返している');
        assert(g.secondBranchPoints(me).length === 0, '鎖式の側鎖炭素に候補を返している');
    });

    test('R9: 名称呼び出しは呼んだ分子に視野を合わせる（既定の視野より大きい分子でも画面外に出ない）', async (c) => {
        const g = c.game, W = c.W;
        // summonMolecule は以前 fitCanvasToTarget()＝**お題**に合わせていたため、
        // 既定の視野（360px幅）より大きい分子を呼ぶと画面外に出ていた。
        // ステアリン酸は炭素18個の直鎖で幅756pxあり、既定の2倍以上ある
        g.setMode('free');
        const wide = ['ステアリン酸', 'パルミチン酸', 'リシン'].filter(n =>
            (W.COMPOUNDS || []).some(x => x.name === n));
        assert(wide.length >= 1, '幅の広いエントリがライブラリに無い（テストの前提が崩れている）');
        wide.forEach(name => {
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.summonMolecule(name);
            const vb = c.svg.viewBox.baseVal;
            const xs = g.userMolecule.atoms.map(a => a.x);
            const ys = g.userMolecule.atoms.map(a => a.y);
            assert(g.userMolecule.atoms.length > 0, `${name} が呼び出せていない`);
            assert(Math.min(...xs) >= vb.x && Math.max(...xs) <= vb.x + vb.width,
                `${name} が視野の左右にはみ出す（x ${Math.min(...xs)}〜${Math.max(...xs)} / 視野 ${vb.x}〜${vb.x + vb.width}）`);
            assert(Math.min(...ys) >= vb.y && Math.max(...ys) <= vb.y + vb.height,
                `${name} が視野の上下にはみ出す（y ${Math.min(...ys)}〜${Math.max(...ys)} / 視野 ${vb.y}〜${vb.y + vb.height}）`);
        });
        // お題に合わせる従来の関数は残っていること（パズルモードの挙動は変えていない）
        assert(typeof g.fitCanvasToTarget === 'function' && typeof g.fitCanvasToMolecule === 'function',
            'fitCanvasToTarget / fitCanvasToMolecule のどちらかが無い');
    });

    test('R9b: 名称呼び出しは既存の原子に重ねて置かない（帯の外にある原子とも）', async (c) => {
        const g = c.game, W = c.W;
        // 置き場所の右端は「いまの段」＝ y > bottomY - 4マス の原子だけで決めるため、
        // その帯の外（上）にある原子は無視され、新しい分子が**真上に重なる**ことがあった
        // （v331 夜間監査で完全一致 0.0px を4件検出。シード 3101079014 ほか）
        const G = W.GRID_SIZE;
        const NAME = 'D-グリセルアルデヒド';
        // 帯の重心が上寄りになる形（横並び＋短くぶら下がる鎖）を作る。
        // こうすると呼び出した分子の上端が帯の外へ届き、監査が踏んだ配置と同じになる
        const build = () => {
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            let prev = null;
            for (let i = 0; i < 5; i++) {
                const a = g.userMolecule.addAtom('C', 232 + i * G, 434);
                if (prev) g.userMolecule.addBond(prev.id, a.id, 1);
                prev = a;
            }
            for (let j = 1; j <= 3; j++) {
                const b = g.userMolecule.addAtom('C', 400, 434 + j * G);
                g.userMolecule.addBond(prev.id, b.id, 1);
                prev = b;
            }
            g.updateDrawing();
        };
        const nearest = () => {
            const a = g.userMolecule.atoms;
            let worst = Infinity, pair = '';
            for (let i = 0; i < a.length; i++) {
                for (let j = i + 1; j < a.length; j++) {
                    if (g.userMolecule.getBond(a[i].id, a[j].id)) continue;
                    const d = Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
                    if (d < worst) { worst = d; pair = `${a[i].element}-${a[j].element}`; }
                }
            }
            return { worst, pair };
        };

        // (1) まず素の状態で呼んで、どこへ着地するかを実測する（定数を書き写さないため）
        build();
        const base = g.userMolecule.atoms.length;
        const bottomY = Math.max(...g.userMolecule.atoms.map(a => a.y));
        const band = bottomY - G * 4;
        g.summonMolecule(NAME);
        assert(g.userMolecule.atoms.length > base, `${NAME} が呼び出せていない`);
        const top = g.userMolecule.atoms.slice(base).reduce((m, p) => (p.y < m.y ? p : m));
        // 着地の上端が帯の外にあることがこの試験の前提。ここが崩れると素通りの試験になる
        assert(top.y <= band,
            `試験の前提が崩れている: 着地の上端 y=${top.y} が帯（境界 ${band}）の中にある`);

        // (2) その着地点に孤立した原子を置いてから呼ぶ。修正前はここが完全一致 0.0px になった
        const tx = top.x, ty = top.y;
        build();
        g.userMolecule.addAtom('O', tx, ty);
        g.updateDrawing();
        g.summonMolecule(NAME);
        const { worst, pair } = nearest();
        assert(worst >= 24, `結合していない原子どうしが ${worst.toFixed(1)}px まで近づいた（${pair}）`);

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('R8: 立体ビューの2カラム化（P12-8・広い画面のみ／スマホ縦は1カラムのまま）', async (c) => {
        const D = c.D, W = c.W;
        // iframe の幅に依存しないよう CSSOM で検査する（R2 と同じ考え方）。
        // ねらいは「広い画面でだけ2カラムになる」ことと、
        // 「鏡像を並べているあいだは1カラムに戻る」ことの2点を固定すること
        let twoCol = false, svgSpans = false, wideFigure = false, capped = false;
        for (const sheet of D.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
            for (const r of rules) {
                if (r.type !== 4 /* MEDIA_RULE */) continue;
                if (!/min-width:\s*1000px/.test(r.conditionText || '')) continue;
                for (const rr of r.cssRules) {
                    const sel = rr.selectorText || '';
                    if (!/stereo-pane-/.test(sel) && !/#stereo-modal \.modal-content/.test(sel)) continue;
                    if (/wide-figure/.test(sel)) {
                        if (rr.style.display === 'block') wideFigure = true;
                    } else if (rr.style.display === 'grid' && rr.style.gridTemplateColumns) {
                        twoCol = true;
                    } else if (/>\s*svg/.test(sel) && rr.style.gridRow) {
                        // `1 / -1` は暗黙の行に効かず、解説が図の下に落ちる。span で数え上げていること
                        svgSpans = /span/.test(rr.style.gridRow);
                    }
                    if (/#stereo-modal \.modal-content/.test(sel) && rr.style.maxHeight) capped = true;
                }
            }
        }
        assert(twoCol, '広い画面の2カラム指定（display:grid）がない');
        assert(svgSpans, '図の行またぎが span で指定されていない（1 / -1 では解説が図の下に落ちる）');
        assert(wideFigure, '鏡像時に1カラムへ戻す .wide-figure の指定がない');
        assert(capped, 'モーダルの高さ上限がない（画面からはみ出して切れる）');
        // スマホ縦の分岐は stereo.js 側。760px 未満で鏡像を上下に積む挙動は据え置き
        assert(W.stereoView && typeof W.stereoView.constructor.isNarrowLayout === 'function',
            'isNarrowLayout が無い');
        // 共通の解説文はサイズをインラインで持たない（持つとモバイル用の上書きが効かなくなる。実際に死んでいた）
        const cap = D.getElementById('stereo-caption');
        assert(cap && !/font-size/.test(cap.getAttribute('style') || ''),
            '#stereo-caption が inline で font-size を持っている（CSS の上書きが効かなくなる）');
    });

    test('R3: ボタン削減（P11 M2b）— 再タップ解除・結合ボタン連打・初回ヒント・モバイル非表示CSS', async (c) => {
        c.reset();
        const g = c.game;
        const D = c.D;

        // (1) アクティブなツールの再タップで Select に復帰する（モバイルの唯一の戻り道）
        D.getElementById('btn-tool-erase').click();
        assert(g.selectedTool === 'erase', '消しゴムに切り替わらない');
        D.getElementById('btn-tool-erase').click();
        assert(g.selectedTool === 'select', '再タップでSelectに戻らない');
        assert(D.getElementById('btn-tool-select').classList.contains('active'),
            '復帰時にSelectボタンがアクティブにならない');

        // (2) 結合次数ボタンの連続クリックで結合ツールが解除されない（.click()廃止の回帰）
        D.getElementById('btn-bond-double').click();
        assert(g.selectedTool === 'bond' && g.selectedBondType === 2, '二重結合選択で結合ツールにならない');
        D.getElementById('btn-bond-triple').click();
        assert(g.selectedTool === 'bond' && g.selectedBondType === 3,
            '結合次数ボタンの連打で結合ツールが解除された');
        g.setTool('select');
        g.selectedBondType = 1;
        D.getElementById('btn-bond-single').click();
        g.setTool('select');

        // (3) 初回ヒント: 初めて結合ができたとき一度だけトーストが出る
        c.W.localStorage.removeItem('chemHintBondToggle');
        c.clickAt(420, 294);
        c.clickAt(462, 294); // 2個目で自動結合 → ヒント表示
        await c.tick();
        const toast = D.getElementById('verify-result');
        assert(!toast.classList.contains('hidden') && /結合線をタップ/.test(toast.textContent),
            '初回の結合作成でヒントトーストが出ない');
        assert(c.W.localStorage.getItem('chemHintBondToggle') === '1', 'ヒント表示フラグが保存されない');
        // 2回目は出ない
        toast.classList.add('hidden');
        toast.textContent = '';
        c.clickAt(504, 294);
        await c.tick();
        assert(!/結合線をタップ/.test(toast.textContent), 'ヒントが2回表示された');

        // (4) モバイルCSS: Selectボタンと結合タイプ枠を隠すルールが 899px ブロックにある
        let hideRule = false;
        for (const sheet of D.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
            for (const r of rules) {
                if (r.type === 4 && /max-width:\s*899px/.test(r.conditionText || '')) {
                    for (const rr of r.cssRules) {
                        if (/#btn-tool-select/.test(rr.selectorText || '') &&
                            /#bond-type-group/.test(rr.selectorText || '') &&
                            rr.style.display === 'none') hideRule = true;
                    }
                }
            }
        }
        assert(hideRule, 'モバイルでボタンを隠すCSSルールがない');

        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('R4: Undo/Redoボタン（キーボードなしのスマホ向け・キャンバス上部に常設）', async (c) => {
        c.reset();
        const g = c.game;
        const D = c.D;
        assert(D.getElementById('btn-undo') && D.getElementById('btn-redo'), 'Undo/Redoボタンがない');

        // 原子を1つ置いて ↩ で消え、↪ で復活する
        c.clickAt(420, 294);
        assert(g.userMolecule.atoms.length === 1, '原子が置けていない');
        D.getElementById('btn-undo').click();
        assert(g.userMolecule.atoms.length === 0, '↩ ボタンでUndoされない');
        D.getElementById('btn-redo').click();
        assert(g.userMolecule.atoms.length === 1, '↪ ボタンでRedoされない');

        // 空履歴でのクリックは何も起きない（エラーにならない）
        D.getElementById('btn-redo').click();
        assert(g.userMolecule.atoms.length === 1, '空のRedoで状態が変わった');

        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('R6: 横画面の縦幅確保（P11 M3b）— ヘッダーとリボンのオーバーレイ化CSSルール', async (c) => {
        const D = c.D, W = c.W;
        // 横向きブロックに: header絶対配置・ロゴ非表示・canvas-header絶対配置
        let headerAbs = false, logoHidden = false, ribbonAbs = false;
        for (const sheet of D.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
            for (const r of rules) {
                if (r.type !== 4) continue;
                const cond = r.conditionText || '';
                if (!/max-width:\s*899px/.test(cond) || !/orientation:\s*landscape/.test(cond)) continue;
                for (const rr of r.cssRules) {
                    if (rr.selectorText === 'header' && rr.style.position === 'absolute') headerAbs = true;
                    if (rr.selectorText === 'header .logo' && rr.style.display === 'none') logoHidden = true;
                    if (rr.selectorText === '.canvas-header' && rr.style.position === 'absolute') ribbonAbs = true;
                }
            }
        }
        assert(headerAbs, '横向きでヘッダーがオーバーレイ化されていない');
        assert(logoHidden, '横向きでロゴが非表示になっていない');
        assert(ribbonAbs, '横向きでキャンバスリボンがオーバーレイ化されていない');

        // 座標表示は v650（リボンのタイル化）で**全画面で非表示**になった
        // （DESIGN_ribbon_consolidation.md §12 ユーザー決定②）。以前は「横画面だけ隠す」CSS ルールの
        // 有無を見ていたが、いまは向きを問わないので**要素の実効スタイル**で確かめる。
        // ⚠ 要素そのものは残っている ＝「id を消さない」不変条件（DESIGN_entry_points.md §7）
        const coord = D.getElementById('coord-display');
        assert(coord, '#coord-display の要素ごと消されている（id を消さない不変条件に反する）');
        assert(W.getComputedStyle(coord).display === 'none', '座標表示が非表示になっていない');
    });

    test('R7: モバイルの化合物名チップ（名称+分子式・学習/空分子で消える・名称なしは分子式のみ）', async (c) => {
        c.reset();
        const g = c.game;
        const chip = c.D.getElementById('mobile-name-chip');
        assert(chip, '化合物名チップの要素がない');

        g.setMode('free');
        g.summonMolecule('エタノール');
        assert(/エタノール/.test(chip.textContent) && /C₂H₆O/.test(chip.textContent),
            `チップに名称と分子式が出ない（${chip.textContent}）`);

        // 学習モードでは消える
        g.setMode('learn');
        assert(chip.textContent === '', '学習モードでチップが消えない');
        g.setMode('free');
        assert(chip.textContent !== '', '自由モードに戻ってもチップが出ない');

        // ライブラリにない分子は分子式のみ
        g.userMolecule = new c.W.Molecule();
        const a1 = g.userMolecule.addAtom('C', 400, 300);
        const a2 = g.userMolecule.addAtom('N', 442, 300);
        g.userMolecule.addBond(a1.id, a2.id, 2);
        g.updateDrawing();
        assert(chip.textContent === 'CH₃N', `名称なし分子でチップが分子式のみにならない（${chip.textContent}）`);

        // 空分子で消える
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        assert(chip.textContent === '', '空分子でチップが消えない');
        g.setMode('puzzle');
    });

    test('O2: スルホ基モジュールと、まとめON中の後追い官能基の自動カード化', async (c) => {
        c.reset();
        const g = c.game;
        // スルホ基モジュール: ベンゼンに付けてベンゼンスルホン酸（S=6価）
        g.placeModule('benzene', 420, 294, null);
        const ring = g.userMolecule.atoms.filter(a => a.element === 'C');
        g.placeModule('so3h', ring[0].x, ring[0].y, ring[0]);
        assert(g.computeMolecularFormula() === 'C₆H₆O₃S',
            `スルホ化後の分子式が${g.computeMolecularFormula()}`);
        assert(c.D.getElementById('compound-name').textContent.includes('ベンゼンスルホン酸'),
            'ベンゼンスルホン酸と判定されない');
        g.userMolecule.atoms.filter(a => a.element === 'S').forEach(a =>
            assert(c.W.isValencyValid(g.userMolecule, a.id), 'Sの価標が不正'));

        // カード化でも SO₃H として1枚にまとまる
        c.D.getElementById('btn-condense').click();
        assert([...c.D.querySelectorAll('.svg-group-card text')].some(t => t.textContent === 'SO₃H'),
            'スルホ基がカード化されない');
        c.D.getElementById('btn-condense').click();

        // S=O を単結合へ落とす向きのトグルでも価標が壊れないこと（v331 夜間監査で36件検出）。
        // 硫黄の上限は S=O の有無で 6↔2 と変わるため、「下げる操作は常に安全」が成り立たない
        const sAtom = g.userMolecule.atoms.find(a => a.element === 'S');
        const sDoubles = () => g.userMolecule.getNeighbors(sAtom.id)
            .filter(n => n.type === 2 && n.atom.element === 'O');
        assert(sDoubles().length === 2, `スルホ基の S=O が2本でない（${sDoubles().length}本）`);
        // 1本目は落とせる（もう1本の S=O が残るので上限は6のまま）
        g.handleBondInteraction(g.userMolecule.getBond(sAtom.id, sDoubles()[0].atom.id), false);
        assert(sDoubles().length === 1, '1本目の S=O が単結合にならない');
        assert(c.W.isValencyValid(g.userMolecule, sAtom.id), '1本目のトグルで S の価標が壊れた');
        // 2本目は落とせない（落とすと上限が 6→2 に縮み、残る4本と釣り合わなくなる）
        g.handleBondInteraction(g.userMolecule.getBond(sAtom.id, sDoubles()[0].atom.id), false);
        assert(sDoubles().length === 1, '最後の S=O が単結合になった（価標が壊れる操作が通っている）');
        assert(c.W.isValencyValid(g.userMolecule, sAtom.id), '最後のトグルで S の価標が壊れた');

        // 「減らす操作」はトグルだけではない。切断・原子削除にも同じ穴が開いていた
        // （v338 の夜間監査で S(3/2) 5件・S(4/2) 6件。トグルだけ塞いだ v333 では足りなかった）
        const usedNow = () => g.userMolecule.getUsedValency(sAtom.id);
        const kept = usedNow();
        // (a) 残った S=O の切断は取り消される
        g.handleBondInteraction(g.userMolecule.getBond(sAtom.id, sDoubles()[0].atom.id), true);
        assert(c.W.isValencyValid(g.userMolecule, sAtom.id), 'S=O の切断で S の価標が壊れた');
        assert(usedNow() === kept && sDoubles().length === 1, 'S=O の切断が取り消されていない');
        // (b) 残った S=O の相手を原子ごと消す操作も取り消される
        g.saveState();
        g.removeAtomWithSplitNotice(sDoubles()[0].atom.id);
        assert(c.W.isValencyValid(g.userMolecule, sAtom.id), '=O の原子削除で S の価標が壊れた');
        assert(usedNow() === kept && sDoubles().length === 1, '=O の原子削除が取り消されていない');
        // (c) 逃げ道は残す: S-O を二重結合へ戻せば、そのあとは普通に消せる（止めすぎの検出）
        const single = g.userMolecule.getNeighbors(sAtom.id)
            .find(n => n.type === 1 && n.atom.element === 'O' &&
                       g.userMolecule.getNeighbors(n.atom.id).length === 1);
        assert(single, '単結合になった S-O が見つからない');
        g.handleBondInteraction(g.userMolecule.getBond(sAtom.id, single.atom.id), false);
        assert(sDoubles().length === 2, 'S-O を二重結合へ戻せない（逃げ道がふさがっている）');
        g.saveState();
        g.removeAtomWithSplitNotice(sDoubles()[0].atom.id);
        assert(sDoubles().length === 1 && c.W.isValencyValid(g.userMolecule, sAtom.id),
            '戻したあとの =O 削除まで止められている（止めすぎ）');

        // まとめON中に後から官能基を足すと、自動でカード化される（一貫性）
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        g.summonMolecule('エタノール');
        c.D.getElementById('btn-condense').click();
        assert(c.D.querySelectorAll('.svg-group-card').length === 0, 'エタノールにまとめ対象があってはならない');
        const term = g.userMolecule.atoms.find(a => a.element === 'C' &&
            g.userMolecule.getNeighbors(a.id).filter(n => n.atom.element === 'C').length === 1);
        g.placeModule('cooh', term.x, term.y, term);
        assert([...c.D.querySelectorAll('.svg-group-card text')].some(t => t.textContent === 'COOH'),
            'まとめON中に追加したCOOHが自動でカード化されない');
        c.D.getElementById('btn-condense').click();

        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    // ===== IP. 異性体の書き出し練習（P12-1 M1） =====

    // 練習セッションの userMolecule を差し替えるヘルパー（登録ロジックの検証用）
    function ipBuild(c, spec) {
        const m = new c.W.Molecule();
        const ids = spec.atoms.map(e => m.addAtom(e, 0, 0).id);
        spec.bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
        c.game.userMolecule = m;
        c.game.updateDrawing();
    }

    test('IP1: 異性体練習 — C₄H₁₀を2種書いて名称付きで全種そろい・クリア記録＋答え合わせ', async (c) => {
        c.reset();
        const g = c.game, W = c.W, ip = W.isomerPractice;
        assert(ip, 'isomerPractice が初期化されていない');
        try { W.localStorage.removeItem('chemIsomerPractice.C₄H₁₀'); } catch (e) { /* noop */ }
        g.setMode('learn');
        ip.start(0);
        assert(ip.active && ip.problem.formula === 'C₄H₁₀' && ip.problem.total === 2,
            `開始状態が不正（${ip.problem && ip.problem.formula} / total=${ip.problem && ip.problem.total}）`);

        // ブタン（直鎖）
        ipBuild(c, { atoms: ['C', 'C', 'C', 'C'], bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1]] });
        ip.register();
        assert(ip.entries.length === 1 && g.userMolecule.atoms.length === 0, 'ブタン登録／白紙化に失敗');

        // 2-メチルプロパン（枝分かれ）
        ipBuild(c, { atoms: ['C', 'C', 'C', 'C'], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]] });
        ip.register();
        assert(ip.entries.length === 2 && ip.uniqueCorrectCodes().size === 2, 'ちがう2種がそろわない');

        const names = ip.entries.map(e => e.name).sort();
        assert(names.includes('ブタン') && names.includes('2-メチルプロパン'),
            `名称が付かない（${names.join(',')}）`);
        assert(W.localStorage.getItem('chemIsomerPractice.C₄H₁₀') === '1', 'クリア記録が残らない');

        // 答え合わせ（並べて比較）を開くと標準の図が並ぶ
        ip.openReview();
        const ov = c.D.getElementById('ip-review-overlay');
        assert(!ov.classList.contains('hidden'), '答え合わせオーバーレイが開かない');
        assert(/標準の書き方と答え/.test(ov.textContent), '標準の書き方セクションが出ない');
        assert([...ov.querySelectorAll('svg')].filter(s => s.querySelector('.quiz-atoms').children.length > 0).length >= 4,
            '答え合わせの図が描画されない');

        ip.stop();
        assert(!ip.active && ov.classList.contains('hidden'), 'stop() で練習・オーバーレイが閉じない');
        g.setMode('puzzle');
    });

    test('IP2: 異性体練習 — 重複は保持し、答え合わせで「①と②は同じ」と示す', async (c) => {
        c.reset();
        const g = c.game, W = c.W, ip = W.isomerPractice;
        g.setMode('learn');
        ip.start(0); // C₄H₁₀

        ipBuild(c, { atoms: ['C', 'C', 'C', 'C'], bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1]] });
        ip.register();
        // 逆順で描いた同じブタン（トポロジー同型）→ 弾かず2個目として保持
        ipBuild(c, { atoms: ['C', 'C', 'C', 'C'], bonds: [[3, 2, 1], [2, 1, 1], [1, 0, 1]] });
        ip.register();
        assert(ip.entries.length === 2, '重複が保持されない');
        assert(ip.uniqueCorrectCodes().size === 1, 'ちがう種類が1になっていない');

        // 確認モード（progress）: 同一判定は伏せる
        ip.openReview('progress');
        const ov = c.D.getElementById('ip-review-overlay');
        assert(!/①と② は同じ/.test(ov.textContent), '確認モードで同一判定が出てしまう');
        // 答え合わせモード: 「①と②は同じ」を示す
        ip.openReview('answer');
        assert(/①と② は同じ/.test(ov.textContent), '答え合わせで「①と②は同じ」の指摘が出ない');
        // サムネ再クリック相当（同モードのトグル）で作図に戻る
        ip.toggleReview('answer');
        assert(ov.classList.contains('hidden'), 'トグルで作図に戻らない');
        ip.stop();
        g.setMode('puzzle');
    });

    test('IP3: 異性体練習 — 分子式違い・複数分子は登録しない', async (c) => {
        c.reset();
        const g = c.game, W = c.W, ip = W.isomerPractice;
        g.setMode('learn');
        ip.start(0); // C₄H₁₀

        // プロパン（C₃H₈）→ 分子式が違うので登録しない
        ipBuild(c, { atoms: ['C', 'C', 'C'], bonds: [[0, 1, 1], [1, 2, 1]] });
        ip.register();
        assert(ip.entries.length === 0, '分子式違いが登録された');

        // 2分子（ブタン×2、連結なし）→ 複数分子なので登録しない
        ipBuild(c, { atoms: ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'],
            bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [4, 5, 1], [5, 6, 1], [6, 7, 1]] });
        assert(g.countMolecules() === 2, 'テスト前提（2分子）が満たされない');
        ip.register();
        assert(ip.entries.length === 0, '複数分子が登録された');

        ip.stop();
        g.setMode('puzzle');
    });

    test('IP4: 異性体練習 — 6問すべての異性体（計25種）に名称が付き列挙数が既知値と一致', async (c) => {
        const g = c.game, W = c.W, ip = W.isomerPractice;
        const expected = [2, 3, 3, 5, 5, 7];
        let total = 0;
        const unnamed = [];
        ip.problems.forEach((p, i) => {
            const data = ip.enumerate(i);
            assert(!data.overflow, `${data.formula} が列挙打ち切り（overflow）になる`);
            assert(data.isomers.length === expected[i],
                `${data.formula} の異性体数が ${data.isomers.length}（期待 ${expected[i]}）`);
            total += data.isomers.length;
            data.isomers.forEach(m => {
                if (!g.lookupCompoundName(m)) unnamed.push(data.formula + ':' + W.canonicalCode(m));
            });
        });
        assert(total === 25, `総異性体数が ${total}（期待25）`);
        assert(unnamed.length === 0, `名称未登録の異性体がある: ${unnamed.join(', ')}`);
    });

    test('IP5: 系統分類の純粋関数（findLongestCarbonChain / isomerSeriesKey）', async (c) => {
        const W = c.W;
        // 2-メチルブタン: 主鎖4・メチル基1つ・位置2
        const m = new W.Molecule();
        const ids = ['C', 'C', 'C', 'C', 'C'].map((e, k) => m.addAtom(e, k * 42, 0).id);
        [[0, 1], [1, 2], [2, 3], [1, 4]].forEach(([a, b]) => m.addBond(ids[a], ids[b], 1));
        assert(W.findLongestCarbonChain(m).length === 4, '2-メチルブタンの最長炭素鎖が4でない');
        const k = W.isomerSeriesKey(m);
        assert(k.chainLen === 4 && k.sideSizes.length === 1 && k.sideSizes[0] === 1 && k.locant === 2,
            `系列キーが不正: chain=${k.chainLen} side=[${k.sideSizes}] loc=${k.locant}`);
        assert(k.category === 'branch' && /主鎖4/.test(k.seriesLabel), `seriesLabel/category不正: ${k.seriesLabel}/${k.category}`);

        // 2,2-ジメチルプロパン（ネオペンタン）: 同一炭素のメチル2つ（gem）
        const n = new W.Molecule();
        const nid = ['C', 'C', 'C', 'C', 'C'].map(e => n.addAtom(e, 0, 0).id);
        [[0, 1], [0, 2], [0, 3], [0, 4]].forEach(([a, b]) => n.addBond(nid[a], nid[b], 1));
        const kn = W.isomerSeriesKey(n);
        assert(kn.gemPair === true && kn.category === 'sidechain2', `ネオペンタンのgem/category不正: ${kn.gemPair}/${kn.category}`);
    });

    test('IP6: 段階ヒント（系列内訳 → 手順の2段階。答えは答え合わせで）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, ip = W.isomerPractice;
        g.setMode('learn');
        ip.start(3); // C₆H₁₄
        // 直鎖ヘキサンを登録
        const m = new W.Molecule();
        const ids = [];
        for (let i = 0; i < 6; i++) ids.push(m.addAtom('C', 100 + 42 * i, 300).id);
        for (let i = 0; i < 5; i++) m.addBond(ids[i], ids[i + 1], 1);
        g.userMolecule = m; g.updateDrawing();
        ip.register();
        assert(ip.entries.length === 1, 'ヘキサン登録に失敗');
        const body = c.D.getElementById('ip-body');

        ip.showHint();
        assert(ip._hintLevel === 1 && /内訳/.test(body.textContent), 'ヒント1（系列内訳）が出ない');
        assert(/あと 2/.test(body.textContent), '主鎖5＋メチル基1つ が「あと2」で出ない');
        ip.showHint();
        assert(ip._hintLevel === 2 && /書き出しの手順/.test(body.textContent), 'ヒント2（手順）が出ない');
        ip.showHint();
        assert(ip._hintLevel === 2, 'ヒントは2段階で頭打ちにならない');
        // 答えはヒントには出さない（答え合わせで自分で開く）
        assert(!/標準の書き方と答え/.test(body.textContent), 'ヒントに答えが出てしまう');
        ip.stop();
        g.setMode('puzzle');
    });

    test('IP7: 答え合わせの標準レイアウト（主鎖を横一直線に・番号付き）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, ip = W.isomerPractice;
        g.setMode('learn');
        ip.start(3); // C₆H₁₄
        // 2-メチルペンタンを実座標で登録
        (function () {
            const m = new W.Molecule();
            const cc = [];
            for (let i = 0; i < 5; i++) cc.push(m.addAtom('C', 250 + 42 * i, 300).id);
            const me = m.addAtom('C', 292, 258).id;
            for (let i = 0; i < 4; i++) m.addBond(cc[i], cc[i + 1], 1);
            m.addBond(cc[1], me, 1);
            g.userMolecule = m; g.updateDrawing();
        })();
        ip.register();
        ip.openReview();
        const ov = c.D.getElementById('ip-review-overlay');
        // いずれかの標準図で、主鎖の番号(1..)が5個以上・同一yに横一直線で並ぶ
        const svgs = [...ov.querySelectorAll('svg')];
        const horiz = svgs.some(s => {
            const ns = [...s.querySelectorAll('text')].filter(t => /^\d+$/.test(t.textContent));
            return ns.length >= 5 && new Set(ns.map(t => t.getAttribute('y'))).size === 1;
        });
        assert(horiz, '主鎖を横一直線に番号付けした標準図がない');
        ip.stop();
        g.setMode('puzzle');
    });

    test('IP8: 任意分子式の練習（M3。解析・受理・拒否・上限）', async (c) => {
        c.reset();
        const g = c.game, ip = c.W.isomerPractice;
        const p = ip.parseFormula('C4H10O');
        assert(p && p.heavy.length === 5 && p.h === 10, 'C4H10O の解析に失敗');
        assert(ip.parseFormula('c4h10') === null, '小文字を弾かない');
        assert(ip.parseFormula('C4H10X') === null, '未対応元素を弾かない');
        assert(ip.parseFormula('') === null, '空文字を弾かない');

        g.setMode('learn');
        ip.startFromFormula('C5H12');
        assert(ip.active && ip.problem.total === 3, 'C5H12 の自由入力で開始できない');
        ip.stop();
        ip.startFromFormula('C7H16');
        assert(!ip.active, '重原子7個の式を受理してしまう');
        ip.startFromFormula('CH5');
        assert(!ip.active, '原子価の合わない式を受理してしまう');
        ip.startFromFormula('C6H6');
        assert(!ip.active, '異性体過多（217種）の式を受理してしまう');
        g.setMode('puzzle');
    });

    test('IP9: 描きながら名称表示モード（リアルタイム）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, ip = W.isomerPractice;
        g.setMode('learn');
        ip.start(0); // C₄H₁₀
        ip.setLiveNames(true);
        assert(c.D.getElementById('ip-live-cb').checked, 'トグルがONにならない');

        // ブタンを描く → ライブ表示に分子式＋ブタン
        (function () {
            const m = new W.Molecule();
            const ids = [];
            for (let i = 0; i < 4; i++) ids.push(m.addAtom('C', 150 + 42 * i, 300).id);
            for (let i = 0; i < 3; i++) m.addBond(ids[i], ids[i + 1], 1);
            g.userMolecule = m; g.updateDrawing();
        })();
        assert(/C₄H₁₀/.test(ip._liveEl.textContent) && /ブタン/.test(ip._liveEl.textContent),
            `ライブ表示が正しくない（${ip._liveEl.textContent}）`);

        // 分子式違い（プロパン）でも、いま描いている分子の名称が出る
        (function () {
            const m = new W.Molecule();
            const ids = [];
            for (let i = 0; i < 3; i++) ids.push(m.addAtom('C', 150 + 42 * i, 300).id);
            for (let i = 0; i < 2; i++) m.addBond(ids[i], ids[i + 1], 1);
            g.userMolecule = m; g.updateDrawing();
        })();
        assert(/プロパン/.test(ip._liveEl.textContent), '分子式違いのライブ名称が出ない');

        // OFFでライブ表示が消え、設定が保存される
        ip.setLiveNames(false);
        assert(ip._liveEl === null, 'OFFでライブ表示が消えない');
        assert(W.localStorage.getItem('chemIsomerPractice.liveNames') === '0', 'OFF設定が保存されない');

        ip.stop();
        g.setMode('puzzle');
    });

    test('ST30: R・S の読み物（用語と決め方の骨組み＋実装との一致・M2.5 その3）', async (c) => {
        c.reset();
        const W = c.W, D = c.D, sv = W.stereoView;
        // **v570 で方針が変わった**。以前は「CIP は実装しない」で、読み物は骨組みの説明だけ・
        // アプリが R / S を名指すことは一切しない、という取り決めだった。いまは
        // assignRSDescriptor が**フィッシャー投影として読める図に限って**判定して出す。
        // 開発方針5章「ヘルプと実装は常に一致させる」があるので、このテストは
        // 「読み物が古い方針のまま残っていないか」を最優先で見張る。
        // 判定そのものの正しさは ST36（順位づけ）と ST37（画面表示）が持つ

        // 乳酸 HOOC-CHOH-CH3（中心=C2・不斉・H あり）を開く
        const m = new W.Molecule();
        const c1 = m.addAtom('C', 400, 258);
        const c2 = m.addAtom('C', 400, 300);
        const c3 = m.addAtom('C', 400, 342);
        const od = m.addAtom('O', 400, 216);
        const os = m.addAtom('O', 442, 258);
        const oh = m.addAtom('O', 442, 300);
        m.addBond(c1.id, c2.id, 1); m.addBond(c2.id, c3.id, 1);
        m.addBond(c1.id, od.id, 2); m.addBond(c1.id, os.id, 1);
        m.addBond(c2.id, oh.id, 1);
        assert(m.isAsymmetricCarbon(c2.id), 'C2 が不斉炭素と判定されない（テストの前提が崩れている）');
        c.game.userMolecule = m;
        c.game.updateDrawing();
        D.getElementById('btn-stereo').click();
        assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体モーダルが開かない');
        assert(sv.centerId === c2.id, '不斉炭素が自動で中心に選ばれない（テストの前提が崩れている）');

        // (a) 読み物は立体ビューのモーダル内にあり、既定は折りたたみ（図の邪魔をしない）
        const tips = D.getElementById('stereo-rs-tips');
        assert(tips, 'R・S の読み物が立体モーダルに無い');
        assert(D.getElementById('stereo-modal').contains(tips), '読み物が立体モーダルの外にある');
        assert(tips.tagName.toLowerCase() === 'details', '読み物が details でない（開閉できない）');
        assert(!tips.open, '読み物が最初から開いている');
        tips.open = true;
        const body = D.getElementById('stereo-rs-tips-body');
        assert(body && body.offsetHeight > 0, '開いても本文が表示されない');
        const text = body.textContent;

        // (b) 説明として最低限そろえる項目（欠けたら教材として不十分になる）
        [
            ['不斉炭素', '「不斉炭素まわりの並び方の呼び名」であることが書かれていない'],
            ['優先順位', '優先順位を付ける手順が書かれていない'],
            ['原子番号', '優先順位を原子番号で決めることが書かれていない'],
            ['時計回り', '時計回り＝R の説明が無い'],
            ['反時計回り', '反時計回り＝S の説明が無い'],
            ['奥', '「最下位を奥に置く」が書かれていない'],
            ['1つ外側', '同点なら次の原子へ進む考え方が書かれていない']
        ].forEach(([word, why]) => assert(text.includes(word), why));
        // ⚠ **古い方針の文が残っていないこと**。ここが落ちたら、実装が判定しているのに
        //    ヘルプが「判定しません」と言い続けている＝ユーザーに嘘をついている状態
        assert(!/判定しません|判定しない/.test(text),
            'アプリは R・S を判定しているのに、読み物が「判定しない」と書いたまま（開発方針5章）');
        // 判定する図の条件と、記号がどこに出るのかを書く（条件を書かないと
        // 「出ないのは壊れているから」に見える）
        assert(/フィッシャー投影/.test(text), '判定するのがフィッシャー投影の図だと書かれていない');
        assert(/主鎖を縦/.test(text), '「主鎖を縦に描いた図だけ」という条件が書かれていない');
        assert(/R・S:/.test(text), '記号がどこ（「R・S:」の欄）に出るのかが書かれていない');
        // 記号が出ない図でも立体を比べる手立てがあることは、引き続き示す
        assert(/重ね合わせ/.test(text) && /鏡像/.test(text),
            '記号が出ない図で重ね合わせ・鏡像比較を使う道が書かれていない');
        // D/L が別の規約であることの明示（高校段階の典型的なつまずき）
        assert(/D・L|D\/L/.test(text), 'D・L との関係に触れていない');
        assert(/別の規約/.test(text), 'D・L と R・S が別の規約であることが明示されていない');
        // 食い違う実例（L 体なのに (R) になるシステイン）。
        // **この主張が本当かは ST37 がアプリ自身の判定で確かめる**ので、
        // ここは「書いてあるか」だけを見る
        assert(/システイン/.test(text), 'D・L と R・S が食い違う実例が挙げられていない');

        // (c) **読み物と実装の一致**。読み物は「フィッシャー投影として描かれた図なら判定する」と
        //     約束している。いま開いている乳酸はまさにその図（主鎖が縦）なので、
        //     約束どおり記号が出ていなければならない。出ない図の扱いは ST37 が見る
        const rsLetterEl = D.getElementById('stereo-rs-letter');
        assert(rsLetterEl, 'R・S の表示欄が立体モーダルに無い');
        const rs = W.assignRSDescriptor(c.game.userMolecule);
        assert(rs && rs[c2.id], '（前提）縦置きの乳酸から R/S が読めていない');
        assert(rsLetterEl.textContent.includes(`(${rs[c2.id].letter})`),
            `読み物は判定すると書いているのに、画面に記号が出ていない（${rsLetterEl.textContent}）`);

        // (d) 図との連動: 「最下位を奥に置く」を 3Dビューで実際に構えられる
        const faceBtn = D.getElementById('btn-stereo-rs-face-h');
        assert(faceBtn, '「H を奥に向けて構える」ボタンが無い');
        assert(!faceBtn.disabled, '中心に H があるのにボタンが無効になっている');
        faceBtn.click();
        assert(sv.mode === '3d', 'ボタンで 3Dビューに切り替わらない');
        assert(sv.axisFacing === 'away', '軸の向きが「奥」になっていない');
        const hIdx = sv._dirs.findIndex(d => d.ref === 'H');
        assert(hIdx >= 0 && sv.axisIndex === hIdx, '回転軸が H への結合になっていない');
        // 実際に描かれたベクトルで確かめる（SVG座標系は z+ が手前なので、奥は z<0）
        const hv = sv._drawn.left.find(d => d.ref === 'H').v;
        assert(hv[2] < -0.9, `H が視線の奥を向いていない（z=${hv[2].toFixed(3)}）`);
        // 残り3つは視線と垂直な面に開く＝どちら回りかが読める（重なっていない）
        const others = sv._drawn.left.filter(d => d.ref !== 'H');
        others.forEach(d => assert(Math.hypot(d.v[0], d.v[1]) > 0.5,
            '軸以外の置換基が中心に重なって回る向きが読めない'));
        // 姿勢を作るだけで、パリティ（＝描いた立体）は変えない
        assert(W.parityFromDirs(sv._drawn.left) === W.parityFromDirs(sv._dirs),
            '「奥に構える」で立体が変わってしまっている');

        // (e) 中心に H が無い炭素では使えない（理由を title で示す）。
        //     2-メチル-2-ブタノール C2: -OH -CH3 -CH3 -CH2CH3 ＝ H なし
        const m2 = new W.Molecule();
        const b1 = m2.addAtom('C', 400, 258);
        const b2 = m2.addAtom('C', 400, 300);
        const b3 = m2.addAtom('C', 400, 342);
        const b4 = m2.addAtom('C', 400, 384);
        const me2 = m2.addAtom('C', 358, 300);
        const oh2 = m2.addAtom('O', 442, 300);
        m2.addBond(b1.id, b2.id, 1); m2.addBond(b2.id, b3.id, 1); m2.addBond(b3.id, b4.id, 1);
        m2.addBond(b2.id, me2.id, 1); m2.addBond(b2.id, oh2.id, 1);
        assert(m2.getFreeValency(b2.id) === 0, 'C2 に H が残っている（テストの前提が崩れている）');
        c.game.userMolecule = m2;
        c.game.updateDrawing();
        D.getElementById('btn-stereo-pick').click();
        c.clickAt(b2.x, b2.y);
        assert(sv.centerId === b2.id, '中心を選び直せていない');
        assert(faceBtn.disabled, 'H が無い中心でボタンが有効のまま');
        assert(/H が付いていない/.test(faceBtn.title), 'ボタンが使えない理由が示されていない');

        tips.open = false;
        D.getElementById('btn-stereo-close').click();
    });

    test('ST26: くさび図モード（不斉炭素1個・鎖状に絞り、手前/奥を図に描き出す）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const q = W.stereoQuiz;
        q.build();
        const modeEl = D.getElementById('sq-mode');
        assert(modeEl.querySelector('option[value="wedge"]'), 'くさび図モードの選択肢が無い');
        modeEl.value = 'wedge';

        // (a) 出題範囲は「不斉炭素1個・鎖状・C=C の幾何なし」に限る（項目18）。
        //     中心が2つ以上あると、手前/奥の入れ替わりを見るだけの練習にならない
        const kinds = {};
        let outOfScope = 0, usedPair = 0;
        for (let i = 0; i < 60; i++) {
            q.nextQuestion();
            assert(q.current, 'くさび図モードで出題できていない');
            kinds[q.current.rel] = (kinds[q.current.rel] || 0) + 1;
            if (q.current.how === 'pair') usedPair++;
            const e = q.pool.find(x => x.name === q.current.nameA);
            if (!e || e.centers !== 1 || e.fromRing || e.geoms !== 0) outOfScope++;
        }
        assert(outOfScope === 0, `範囲外の分子が ${outOfScope} 件出題された`);
        // ライブラリのペアを使わないのは答えが偏るから。該当する組は D/L の3組しかなく、
        // 不斉炭素1個どうしなら関係は必ず鏡像異性体になる（＝いつも同じ答え）
        assert(usedPair === 0, `くさび図モードでライブラリのペアが ${usedPair} 件出た（答えが鏡像に偏る）`);
        assert(!kinds.diastereomer, '不斉炭素1個ではジアステレオマーは作れないはず');
        assert(kinds.same > 0 && kinds.enantiomer > 0,
            `「同じ」と「鏡像」の両方が出題されない（${JSON.stringify(kinds)}）`);

        // (b) 不斉炭素の4本は**くさび**で描かれ、素の線は残らない。
        //     向きは readAtomParityFromFischer と同じ軸判定（横=手前=塗り／縦=奥=破線）で、
        //     図とアプリの読みが食い違わないことを確かめる
        let checked = 0;
        for (let i = 0; i < 20; i++) {
            q.nextQuestion();
            [['sq-svg-a', q.current.molA], ['sq-svg-b', q.current.molB]].forEach(([id, mol]) => {
                const svg = D.getElementById(id);
                const centers = Object.keys(W.readAtomParityFromFischer(mol));
                assert(centers.length === 1, `不斉炭素が1個でない（${centers.length}）`);
                const ctr = mol.atoms.find(a => a.id === centers[0]);
                const solids = [...svg.querySelectorAll('.quiz-bonds polygon')];
                const hashes = [...svg.querySelectorAll('.quiz-bonds line')]
                    .filter(l => l.getAttribute('stroke') === '#78beff');
                assert(solids.length === 2, `塗りのくさびが2本でない（${solids.length}）`);
                assert(hashes.length % 4 === 0 && hashes.length / 4 === 2,
                    `破線のくさびが2本でない（横棒 ${hashes.length} 本）`);
                solids.forEach(p => {
                    const [ax, ay] = p.getAttribute('points').split(' ')[0].split(',').map(Number);
                    const dx = ax - ctr.x, dy = ay - ctr.y;
                    assert(Math.abs(dx) > Math.abs(dy), `横向きでない結合が塗りのくさびになっている（${dx},${dy}）`);
                });
                hashes.forEach(l => {
                    const mx = (+l.getAttribute('x1') + +l.getAttribute('x2')) / 2;
                    const my = (+l.getAttribute('y1') + +l.getAttribute('y2')) / 2;
                    assert(Math.abs(my - ctr.y) > Math.abs(mx - ctr.x),
                        `縦向きでない結合が破線のくさびになっている（${mx - ctr.x},${my - ctr.y}）`);
                });
                // 不斉炭素から出る素の結合線が残っていない（くさびと二重に描かない）
                const plainAtCenter = [...svg.querySelectorAll('.quiz-bonds line')]
                    .filter(l => l.getAttribute('stroke') !== '#78beff')
                    .filter(l => [['x1', 'y1'], ['x2', 'y2']].some(([kx, ky]) =>
                        Math.hypot(+l.getAttribute(kx) - ctr.x, +l.getAttribute(ky) - ctr.y) < 2));
                assert(plainAtCenter.length === 0,
                    `不斉炭素に素の結合線が ${plainAtCenter.length} 本残っている`);
                checked++;
            });
        }
        assert(checked === 40, `検査した図が足りない（${checked}）`);

        // (c) 4本の長さが揃う（水素だけ 16px の豆粒くさびにならない・表示専用の伸長）
        const mol = q.current.molA;
        const stretched = W.stretchStereoHydrogens(mol, mol.calculateHydrogens());
        const cid = Object.keys(W.readAtomParityFromFischer(mol))[0];
        const ctr = mol.atoms.find(a => a.id === cid);
        stretched.filter(h => h.parentId === cid).forEach(h => {
            assert(Math.abs(Math.hypot(h.x - ctr.x, h.y - ctr.y) - 42) < 0.01,
                '不斉炭素の水素が重原子と同じ長さに伸びていない');
        });

        // (d) 他のモードではくさびを描かない（＝フィッシャーの規約を読む練習のまま）
        modeEl.value = 'pair';
        q.nextQuestion();
        assert(D.querySelectorAll('#sq-svg-a .quiz-bonds polygon').length === 0,
            '標準モードにくさびが描かれている');
        assert(D.getElementById('sq-wedge-legend').classList.contains('hidden'),
            '標準モードで凡例が出ている');
        modeEl.value = 'wedge';
        q.nextQuestion();
        assert(!D.getElementById('sq-wedge-legend').classList.contains('hidden'),
            'くさび図モードで凡例が出ていない');
        D.getElementById('btn-sq-close').click();
    });

    test('ST25: 環ビューは手前側の環結合を太く描く／「水」は操作の練習シリーズ', async (c) => {
        const W = c.W, g = c.game, D = c.D, sv = W.stereoView;
        // 項目11: ハース投影の慣習として手前側の環結合を太く描く。手前かどうかは 3D の z で
        // 決めるので、環を回しても正しく入れ替わる。倒し角0°（ハース図の向き）では環が
        // z=0 平面にあり差が出ない＝そのときは効かないのが正しい
        const e = (W.COMPOUNDS || []).find(x => x.name === 'β-D-グルコース（β-D-グルコピラノース）');
        assert(e, 'グルコピラノースがライブラリに無い');
        c.reset();
        g.setMode('free');
        g.userMolecule = g.createTargetFromData({ target: e.target });
        g.updateDrawing();
        sv.openAuto();
        sv.setMode('ring');
        const survey = (deg) => {
            sv.setRingTiltDeg(deg);
            const ring = [...D.querySelectorAll('#stereo-ring-svg [data-ring-bond="ring"] line')];
            const front = [...D.querySelectorAll('#stereo-ring-svg [data-ring-front="1"] line')];
            const ws = ring.map(b => +b.getAttribute('stroke-width'));
            return { n: ring.length, front: front.length, min: Math.min.apply(null, ws), max: Math.max.apply(null, ws) };
        };
        const flat = survey(0);
        assert(flat.n === 6, `環結合が ${flat.n} 本（6本を期待）`);
        assert(flat.front === 0, 'ハース図の向き（倒し角0°）で手前判定が出ている（環はz=0平面なので出ないはず）');
        const side = survey(90);
        assert(side.front > 0 && side.front < side.n,
            `真横で手前の結合が ${side.front}/${side.n} 本（一部だけが手前になるはず）`);
        assert(side.max > side.min * 1.4,
            `手前の結合が太くなっていない（${side.min.toFixed(1)} 〜 ${side.max.toFixed(1)}）`);
        sv.setRingTiltDeg(90);
        D.getElementById('btn-stereo-close').click();

        // 項目23: 無機物の「水」が「有名な慣用名（脂肪族）」に混ざっていた
        const water = (W.STAGES || []).find(s => s.name === '水');
        assert(water, '水のステージが無い');
        assert(!/脂肪族/.test(water.series),
            `水が「${water.series}」に入っている（有機の慣用名シリーズから外すこと）`);
        assert(/はじめに|練習|チュートリアル/.test(water.series),
            `水のシリーズが操作の練習を示していない（${water.series}）`);
        // 並び順は変えていない（クリア記録は索引で持つため）
        assert(W.STAGES[0].name === '水', 'ステージの並び順が変わった（クリア記録がずれる）');
    });

    test('ST24: 枝を1原子ずつ辿って、どこで食い違うかを示す（不斉の理由の可視化）', async (c) => {
        const W = c.W, g = c.game, D = c.D, sv = W.stereoView;
        // ユーザー要望（docs/development_plan.md 項目9）: 環の炭素が不斉のとき、環の右回りと
        // 左回りは分子式では同じに見えるため、不斉である理由が分かりにくい。1原子ずつ辿りたい。
        // **CIP（R/S の順位規則）は実装しない方針**なので、順位づけはせず
        // 「どこで初めて違うか」だけを示す
        assert(typeof W.branchShells === 'function', 'branchShells が公開されていない');
        assert(typeof W.firstDifferingShell === 'function', 'firstDifferingShell が公開されていない');

        // 3-メチルシクロヘキサン-1-オール: C1 が不斉。環の2方向は第3層で初めて違う
        c.reset();
        g.setMode('free');
        const m = new W.Molecule();
        const R = 60, cx = 400, cy = 300, ring = [];
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            ring.push(m.addAtom('C', Math.round(cx + R * Math.cos(a)), Math.round(cy + R * Math.sin(a))));
        }
        for (let i = 0; i < 6; i++) m.addBond(ring[i].id, ring[(i + 1) % 6].id, 1);
        const oh = m.addAtom('O', ring[0].x + 42, ring[0].y);
        m.addBond(ring[0].id, oh.id, 1);
        const me = m.addAtom('C', ring[2].x - 42, ring[2].y);
        m.addBond(ring[2].id, me.id, 1);
        assert(m.isAsymmetricCarbon(ring[0].id), 'C1 が不斉炭素と判定されない（テストの前提が崩れている）');

        const s1 = W.branchShells(m, ring[1].id, ring[0].id);
        const s2 = W.branchShells(m, ring[5].id, ring[0].id);
        // 分子式では同じに見える＝どちらも炭素5個ぶん辿れる
        assert(s1.length === s2.length, `環の2方向で辿れる層の数が違う（${s1.length} / ${s2.length}）`);
        assert(W.firstDifferingShell(s1, s2) === 3,
            `環の2方向が初めて違う層が第${W.firstDifferingShell(s1, s2)}層（第3層を期待）`);
        // 同じ枝どうしは null（区別できない）
        assert(W.firstDifferingShell(s1, s1) === null, '同じ枝を比べたのに違いが出た');

        // 対称なシクロヘキサノール（C1に-OHだけ）では環の2方向が同じ＝不斉でない
        const m2 = new W.Molecule();
        const ring2 = [];
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            ring2.push(m2.addAtom('C', Math.round(cx + R * Math.cos(a)), Math.round(cy + R * Math.sin(a))));
        }
        for (let i = 0; i < 6; i++) m2.addBond(ring2[i].id, ring2[(i + 1) % 6].id, 1);
        const oh2 = m2.addAtom('O', ring2[0].x + 42, ring2[0].y);
        m2.addBond(ring2[0].id, oh2.id, 1);
        assert(!m2.isAsymmetricCarbon(ring2[0].id), 'シクロヘキサノールのC1が不斉と判定された');
        assert(W.firstDifferingShell(W.branchShells(m2, ring2[1].id, ring2[0].id),
                                    W.branchShells(m2, ring2[5].id, ring2[0].id)) === null,
            '対称な環なのに環の2方向に違いが出た');

        // 画面: ボタンで開閉でき、根拠と「順位づけではない」ことを明記する
        g.userMolecule = m;
        g.updateDrawing();
        sv.show(m.atoms.find(a => a.id === ring[0].id));
        const btn = D.getElementById('btn-stereo-branches');
        const note = D.getElementById('stereo-branch-note');
        assert(btn && note, '枝比較のボタンか表示先がない');
        assert(note.classList.contains('hidden'), '最初から開いている');
        btn.click();
        assert(!note.classList.contains('hidden'), 'ボタンで開かない');
        assert(/第3層 で初めて違います/.test(note.textContent),
            `本文に食い違う層が出ていない（${note.textContent.slice(0, 80)}）`);
        assert(/順位づけ/.test(note.textContent), '「順位づけではない」注記がない');
        btn.click();
        assert(note.classList.contains('hidden'), 'ボタンで閉じない');
        D.getElementById('btn-stereo-close').click();
    });

    test('ST23: 3D模型で C=C まわりが平面／シス・トランスが図と一致（複数の二重結合も）', async (c) => {
        const W = c.W, g = c.game;
        // 外部レビュー（docs/development_plan.md 項目8）の「二重結合が複数あるとき
        // 平面性が保たれているか検証が必要」に対する固定。調べた時点では既に正しかったので、
        // **黙って壊れないようにテストで留める**のが目的
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []).filter(e => e.target);
        let checked = 0, multi = 0;
        source.forEach(e => {
            const mol = g.createTargetFromData({ target: e.target, stereo: e.stereo });
            const cc = mol.bonds.filter(b => {
                if (b.type !== 2) return false;
                const a1 = mol.atoms.find(a => a.id === b.atomId1);
                const a2 = mol.atoms.find(a => a.id === b.atomId2);
                return a1 && a2 && a1.element === 'C' && a2.element === 'C';
            });
            if (!cc.length) return;
            let m3d = null;
            try { m3d = W.buildMolecule3D(mol); } catch (err) { return; }
            if (!m3d || !m3d.ok) return; // シス/トランス未指定などで断るのは正しい挙動
            if (cc.length >= 2) multi++;
            const pos = new Map();
            m3d.nodes.forEach(n => { if (n.atomId) pos.set(n.atomId, n.v); });
            cc.forEach(b => {
                const ids = [b.atomId1, b.atomId2];
                const pts = ids.slice();
                ids.forEach(id => mol.getNeighbors(id)
                    .filter(n => n.atom.element !== 'H' && !ids.includes(n.atom.id))
                    .forEach(n => pts.push(n.atom.id)));
                const all = pts.map(id => pos.get(id)).filter(Boolean);
                if (all.length < 4) return; // 置換基が少ない C=C は平面性が自明
                checked++;
                const [p, q, r] = all;
                const u = [q[0]-p[0], q[1]-p[1], q[2]-p[2]];
                const v = [r[0]-p[0], r[1]-p[1], r[2]-p[2]];
                const nrm = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
                const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
                all.slice(3).forEach(pt => {
                    const d = Math.abs((pt[0]-p[0])*nrm[0] + (pt[1]-p[1])*nrm[1] + (pt[2]-p[2])*nrm[2]) / len;
                    assert(d < 0.05, `${e.name}: C=C まわりが平面でない（ずれ ${d.toFixed(3)}／結合長1.0が基準）`);
                });
            });
        });
        assert(checked >= 40, `平面性を検査した C=C が少なすぎる（${checked}箇所）`);
        assert(multi >= 5, `二重結合が2本以上ある化合物が少なすぎる（${multi}件）`);

        // シス/トランスが 3D でも図どおりであること（回しても入れ替わらない、の土台）
        let geoChecked = 0;
        source.forEach(e => {
            const mol = g.createTargetFromData({ target: e.target, stereo: e.stereo });
            const geo = W.readBondGeoFromCoords(mol);
            if (!Object.keys(geo).length) return;
            let m3d = null;
            try { m3d = W.buildMolecule3D(mol); } catch (err) { return; }
            if (!m3d || !m3d.ok) return;
            const pos = new Map();
            m3d.nodes.forEach(n => { if (n.atomId) pos.set(n.atomId, n.v); });
            mol.bonds.forEach(b => {
                const want = geo[`${b.atomId1}_${b.atomId2}`] || geo[`${b.atomId2}_${b.atomId1}`];
                if (!want) return;
                const refs = W.bondGeoRefs(mol, b);
                if (!refs) return;
                const P = pos.get(b.atomId1), Q = pos.get(b.atomId2);
                const R1 = pos.get(refs.refA), R2 = pos.get(refs.refB);
                if (!P || !Q || !R1 || !R2) return;
                const ax = [Q[0]-P[0], Q[1]-P[1], Q[2]-P[2]];
                const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
                const u = ax.map(v => v / al);
                const perp = (pt, base) => {
                    const d = [pt[0]-base[0], pt[1]-base[1], pt[2]-base[2]];
                    const dot = d[0]*u[0] + d[1]*u[1] + d[2]*u[2];
                    return [d[0]-dot*u[0], d[1]-dot*u[1], d[2]-dot*u[2]];
                };
                const v1 = perp(R1, P), v2 = perp(R2, Q);
                const dot = v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2];
                const cosang = dot / ((Math.hypot(v1[0],v1[1],v1[2]) * Math.hypot(v2[0],v2[1],v2[2])) || 1);
                const got = cosang > 0.5 ? 'syn' : (cosang < -0.5 ? 'anti' : '中間');
                assert(got === want, `${e.name}: 図は ${want} なのに 3D は ${got}（cos=${cosang.toFixed(2)}）`);
                geoChecked++;
            });
        });
        assert(geoChecked >= 4, `シス/トランスを検査した結合が少なすぎる（${geoChecked}本）`);
    });

    test('ST22: 分子が2つ以上あるとき、立体ビューがどの分子かを示す', async (c) => {
        const W = c.W, g = c.game, sv = W.stereoView, D = c.D;
        // ユーザー要望「複数分子があるとき、どの分子を対象にするか識別する仕組みが必要」。
        // 実測では 命名カード・反応カードは複数分子を正しく扱えていた（酢酸＋エタノール／【2分子】）。
        // 足りなかったのは立体ビューの**識別**で、
        //   ・中心の炭素がどの分子のものか出ない（「他に sp3炭素が N 個」の N は別分子まで数える）
        //   ・分子全体の図には全部入るのに、1つの分子の模型に見える
        const setup = (names) => {
            c.reset();
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            names.forEach(n => g.summonMolecule(n));
            sv.openAuto();
        };
        const close = () => D.getElementById('btn-stereo-close').click();

        setup(['酢酸', 'エタノール']);
        const label2 = D.getElementById('stereo-center-label').textContent;
        assert(/2つある分子のうち/.test(label2), `中心ラベルに分子の別が出ない（${label2}）`);
        assert(/エタノール|酢酸/.test(label2), `中心ラベルに分子名が出ない（${label2}）`);
        assert(!D.getElementById('btn-stereo-tab-mol').disabled, '分子全体タブが使えない');
        sv.setMode('mol');
        const note2 = D.getElementById('stereo-mol-note').textContent;
        assert(/2 つの分子が入っています/.test(note2), `分子全体の解説が複数分子を説明していない（${note2.slice(0, 60)}）`);
        assert(/酢酸/.test(note2) && /エタノール/.test(note2), '分子全体の解説に分子名が出ていない');
        close();

        // 1分子のときは余計な但し書きを出さない
        setup(['エタノール']);
        const label1 = D.getElementById('stereo-center-label').textContent;
        assert(!/つある分子のうち/.test(label1), `1分子なのに分子の別が出ている（${label1}）`);
        sv.setMode('mol');
        const note1 = D.getElementById('stereo-mol-note').textContent;
        assert(!/つの分子が入っています/.test(note1), '1分子なのに複数分子の説明が出ている');
        close();
    });

    test('ST21: 環ビューの対応範囲は飽和単環に限る／解説文が化合物に合う', async (c) => {
        const W = c.W, g = c.game, sv = W.stereoView;
        // このビューは「環1つを平面とみなし、置換基が上下に突き出す」模型なので、
        // 平面近似が成り立たない環では使わせない（ユーザー指摘「糖以外の環でも有効になっている」）。
        // 縮合環は隣の環の原子が置換基扱いになり、芳香環・シクロアルケンは置換基が上下に出ない
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const openWith = (name) => {
            const e = source.find(x => x.name === name && x.target);
            assert(e, `${name} がライブラリに無い`);
            g.userMolecule = g.createTargetFromData({ target: e.target });
            g.updateDrawing();
            sv.openAuto();
            return c.D.getElementById('btn-stereo-tab-ring');
        };
        const close = () => c.D.getElementById('btn-stereo-close').click();

        [['ベンゼン', '二重結合'], ['シクロヘキセン', '二重結合'], ['ナフタレン', '環が2つ']]
            .forEach(([name, why]) => {
                const tab = openWith(name);
                assert(tab.disabled, `${name} で環ビューが有効になっている`);
                assert((tab.title || '').includes(why),
                    `${name} の無効化理由が「${why}」を説明していない（${tab.title}）`);
                close();
            });
        ['シクロヘキサン', 'シクロヘキサノール', 'β-D-グルコース（β-D-グルコピラノース）']
            .forEach(name => {
                const tab = openWith(name);
                assert(!tab.disabled, `${name} で環ビューが使えない`);
                close();
            });

        // 解説文: 糖は「ハース図」「α/β」、それ以外は言い換える
        const noteOf = (name) => {
            openWith(name);
            sv.setMode('ring');
            const t = c.D.getElementById('stereo-ring-note').textContent || '';
            close();
            return t;
        };
        const sugar = noteOf('β-D-グルコース（β-D-グルコピラノース）');
        assert(/ハース図/.test(sugar) && /α\/β/.test(sugar), '糖の解説に「ハース図」「α/β」が無い');
        const plain = noteOf('シクロヘキサノール');
        assert(!/あなたが描いたハース図の縦位置/.test(plain),
            '糖でない環の解説が「ハース図」前提のままになっている');
        // 上下が1つも決まっていない図では、斜めの結合から推測しないことを明示する
        const none = noteOf('メチルシクロプロパン');
        assert(/勝手には決めません/.test(none),
            '上下が決まっていないのに、その旨を説明していない');
    });

    test('ST20: 環ビューの回転軸は環の面に垂直（真横を保ったまま回る）', async (c) => {
        const W = c.W;
        // 環モデルは z=0 平面に組んである＝環の法線は z 軸。面内で回す（メリーゴーランド）には
        // z 軸まわりに回す必要がある。以前は画面の縦軸 y まわりに回していたため、
        // その軸が環の平面**内**にあり、回すと環が裏返って真横が崩れていた（ユーザー指摘）。
        // 旧実装では真横で90°回すと環が縦に200px広がり、正面向きになってしまっていた
        // クラス宣言は window に載らないので、公開されているインスタンス経由で取る
        assert(W.stereoView, 'stereoView が公開されていない');
        const SV = W.stereoView.constructor;
        assert(typeof SV.rotateZX === 'function', 'rotateZX が無い');
        const tilt = Math.PI / 2; // 真横
        // z=0 平面に置いた正六角形（環モデルと同じ組み方）
        const ring = [];
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            ring.push([100 * Math.cos(a), 100 * Math.sin(a), 0]);
        }
        const spread = (yaw) => {
            const ys = ring.map(v => SV.rotateZX(v, yaw, tilt)[1]);
            return Math.max.apply(null, ys) - Math.min.apply(null, ys);
        };
        const depth = (yaw) => {
            const zs = ring.map(v => SV.rotateZX(v, yaw, tilt)[2]);
            return Math.max.apply(null, zs) - Math.min.apply(null, zs);
        };
        [0, 30, 60, 90, 150].forEach(deg => {
            const yaw = deg * Math.PI / 180;
            assert(spread(yaw) < 0.001,
                `真横で ${deg}° 回すと環が縦に ${spread(yaw).toFixed(1)}px 広がる（横一線を保てていない）`);
            assert(depth(yaw) > 100,
                `真横で ${deg}° 回しても奥行きが変わらない（${depth(yaw).toFixed(1)}）＝回っていない`);
        });
        // 倒し角0（ハース図の向き）では正面向き＝縦に広がり、奥行きは出ない
        assert(Math.abs(ring.map(v => SV.rotateZX(v, 0, 0)[1]).reduce((m, y) => Math.max(m, y), -1e9)) > 50,
            'ハース図の向きで環が正面を向いていない');
        const zs0 = ring.map(v => SV.rotateZX(v, 0, 0)[2]);
        assert(Math.max.apply(null, zs0) - Math.min.apply(null, zs0) < 0.001,
            'ハース図の向きなのに環に奥行きが出ている');
    });

    test('ST19: クイズの変形が図の立体を変えない（ハース・フィッシャーの向き依存）', async (c) => {
        // 立体を名前に反映するトグルは**既定 OFF**（2026-08-02）。ここは立体命名そのものを
        // 見るテストなので明示的に ON にする（UI の既定値にテストを依存させない）
        c.game.setReadStereo(true);
        const W = c.W, g = c.game;
        // フィッシャーの十字もハースの上下も**画面上の絶対的な向き**で読む規約なので、
        // 90°回転や左右反転で意味が変わる。変形は剛体変換だから安全、ではない。
        // ユーザー報告: α-D-マンノースの比較で、90°回転した図が「同じ化合物」と誤判定された。
        // 修正前の実測では 185件中29件が回転で別の立体異性体の図になっていた
        const read = (target) => {
            const info = W.readStereoOf(g.createTargetFromData({ target }));
            return info ? info.stereoCode : null;
        };
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const names = ['α-D-マンノース（α-D-マンノピラノース）', 'β-D-グルコース（β-D-グルコピラノース）',
            'D-グルコース（鎖状）', 'D-アラニン', 'L-乳酸', 'シス-2-ブテン', '酒石酸'];
        let checked = 0;
        names.forEach(nm => {
            const e = source.find(x => x.name === nm && x.target);
            assert(e, `${nm} がライブラリに無い`);
            const base = read(e.target);
            assert(base !== null, `${nm} の図から立体が読めない（テストの前提が崩れている）`);
            const shapes = new Set();
            for (let i = 0; i < 25; i++) {
                const td = W.transformCompoundDepiction(e.target, 2);
                assert(read(td) === base, `${nm}: 変形で別の立体異性体の図になった`);
                shapes.add(td.atoms.map(a => a.x + ',' + a.y).join(';'));
                checked++;
            }
            // 立体を守るあまり変形しなくなっていないこと（一度これで全滅した）
            assert(shapes.size >= 3, `${nm}: 見た目が ${shapes.size} 通りしか出ない（判定が厳しすぎる）`);
        });
        assert(checked >= 150, `検査回数が少ない（${checked}）`);
    });

    test('ST18: 立体異性体の総数当てクイズ（M2.5 出題）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const q = W.countQuiz;
        assert(q, 'countQuiz が初期化されていない');
        q.build();
        assert(q.pool.length >= 10, `出題プールが少なすぎる（${q.pool.length}）`);
        assert(q.pool.every(p => !p.overflow && p.naive >= 2),
            '立体の単位が無い分子・数え切れない分子が出題プールに入っている');
        // 畳み込みが起きる分子（このクイズの要点）がプールにある
        const folded = q.pool.filter(p => p.folded);
        assert(folded.length >= 1, '2ⁿ が崩れる分子がプールに無い（酒石酸が必要）');
        assert(folded.some(p => p.name === '酒石酸' && p.naive === 4 && p.count === 3),
            '酒石酸が 2²=4 → 3 として入っていない');

        // 選択肢: 4つ・重複なし・正解を含む・畳み込みがあるときは 2ⁿ（引っかけ）も含む
        q.pool.forEach(p => {
            const ch = W.StereoCountQuiz.buildChoices(p);
            assert(ch.length === 4, `${p.name}: 選択肢が4つでない（${ch.length}）`);
            assert(new Set(ch).size === 4, `${p.name}: 選択肢が重複している`);
            assert(ch.includes(p.count), `${p.name}: 正解が選択肢に無い`);
            if (p.folded) assert(ch.includes(p.naive), `${p.name}: 引っかけの 2ⁿ が選択肢に無い`);
        });

        // 畳み込みが起きる分子が十分な頻度で出る（少数派なので重み付けしている）
        let foldedAsked = 0;
        for (let i = 0; i < 60; i++) {
            q.nextQuestion();
            if (q.current.folded) foldedAsked++;
        }
        assert(foldedAsked >= 10, `畳み込みが起きる分子の出題が少なすぎる（60問中 ${foldedAsked}）`);

        // 解答の流れ: 正解で成績が進み、解説に 2ⁿ と正解の数が出る
        q.score = { asked: 0, correct: 0 };
        while (!q.current.folded) q.nextQuestion(); // 引っかけのある問題で確かめる
        const cur = q.current;
        const btns = [...D.querySelectorAll('#cq-choices button')];
        assert(btns.length === 4, '選択肢ボタンが4つ描かれていない');
        btns.find(b => Number(b.dataset.value) === cur.count).click();
        assert(q.score.correct === 1, '正解を押しても成績が進まない');
        const text = D.getElementById('cq-result').textContent;
        assert(text.includes('正解'), '解説が出ていない');
        assert(text.includes(String(cur.naive)) && text.includes(String(cur.count)),
            `解説に 2ⁿ（${cur.naive}）と実際の数（${cur.count}）が出ていない`);
        assert(text.includes('メソ体') || text.includes('回転対称'), '畳み込みの理由が説明されていない');
        assert(btns.every(b => b.disabled), '解答後もボタンが押せる');
        // 誤答（2ⁿ を選ぶ）と正答で解説の書き出しが変わる
        q.nextQuestion();
        while (!q.current.folded) q.nextQuestion();
        const naive = q.current.naive;
        [...D.querySelectorAll('#cq-choices button')].find(b => Number(b.dataset.value) === naive).click();
        assert(D.getElementById('cq-result').textContent.includes('単純に数えた'),
            '2ⁿ を選んだときに、そこが引っかけである旨の説明が出ない');
        D.getElementById('btn-cq-close').click();
        assert(D.getElementById('count-quiz-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('ST17: 立体異性体の総数を数える（M2.5 総数当ての判定）', async (c) => {
        const W = c.W, g = c.game;
        assert(typeof W.countStereoisomers === 'function', 'countStereoisomers が公開されていない');
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const molOf = (name) => {
            const e = source.find(x => x.name === name && x.target);
            assert(e, `${name} がライブラリに無い`);
            return g.createTargetFromData({ target: e.target });
        };
        // 素朴な 2ⁿ どおりになる分子（畳み込みが起きない）
        [['エタノール', 1, 0, 0], ['グリセリン', 1, 0, 0], ['乳酸', 2, 1, 0],
         ['2-ブタノール', 2, 1, 0], ['シス-2-ブテン', 2, 0, 1],
         ['D-グルコース（鎖状）', 16, 4, 0]].forEach(([name, want, nc, nb]) => {
            const r = W.countStereoisomers(molOf(name));
            assert(r.centers === nc && r.bonds === nb,
                `${name}: 立体の単位が不斉${r.centers}/C=C${r.bonds}（期待 ${nc}/${nb}）`);
            assert(r.count === want, `${name}: 立体異性体が ${r.count} 種類（期待 ${want}）`);
            assert(!r.folded, `${name}: 畳み込みが起きるはずがない`);
        });

        // 畳み込みが起きる2例。「素朴な 2ⁿ が崩れる理由」は2通りある
        // ① メソ体（分子内に対称面）: 酒石酸 2²=4 → 3
        const tar = new W.Molecule();
        const cc = [274, 316, 358, 400].map(x => tar.addAtom('C', x, 300));
        tar.addBond(cc[0].id, cc[1].id, 1);
        tar.addBond(cc[1].id, cc[2].id, 1);
        tar.addBond(cc[2].id, cc[3].id, 1);
        [[0, 274, 258, 2], [0, 232, 300, 1], [3, 400, 258, 2], [3, 442, 300, 1]].forEach(([i, x, y, t]) => {
            const o = tar.addAtom('O', x, y);
            tar.addBond(cc[i].id, o.id, t);   // 両端の -COOH
        });
        [[1, 316, 258], [2, 358, 342]].forEach(([i, x, y]) => {
            const o = tar.addAtom('O', x, y);
            tar.addBond(cc[i].id, o.id, 1);   // 中央2つの -OH
        });
        const rt = W.countStereoisomers(tar);
        assert(rt.centers === 2 && rt.naive === 4, `酒石酸の単位が2個でない（${rt.centers}）`);
        assert(rt.count === 3, `酒石酸の立体異性体が ${rt.count} 種類（メソ体があるので3のはず）`);
        assert(rt.folded, '酒石酸で畳み込みが起きたと報告されない');

        // ② 環の回転対称: 乳酸3分子の環状エステル 2³=8 → 4（詳細は ST16）
        const ring = new W.Molecule();
        const R = 120, cx = 400, cy = 300, at = [];
        for (let i = 0; i < 9; i++) {
            const th = -Math.PI / 2 + i * 2 * Math.PI / 9;
            at.push(ring.addAtom(i % 3 === 0 ? 'O' : 'C',
                Math.round(cx + R * Math.cos(th)), Math.round(cy + R * Math.sin(th))));
        }
        for (let i = 0; i < 9; i++) ring.addBond(at[i].id, at[(i + 1) % 9].id, 1);
        for (let i = 0; i < 9; i++) {
            const th = -Math.PI / 2 + i * 2 * Math.PI / 9;
            const ox = Math.round(cx + 162 * Math.cos(th)), oy = Math.round(cy + 162 * Math.sin(th));
            if (i % 3 === 1) ring.addBond(at[i].id, ring.addAtom('C', ox, oy).id, 1);
            if (i % 3 === 2) ring.addBond(at[i].id, ring.addAtom('O', ox, oy).id, 2);
        }
        const rr = W.countStereoisomers(ring);
        assert(rr.centers === 3 && rr.naive === 8, `環状エステルの単位が3個でない（${rr.centers}）`);
        assert(rr.count === 4, `環状エステルの立体異性体が ${rr.count} 種類（回転対称があるので4のはず）`);
        assert(rr.folded, '環状エステルで畳み込みが起きたと報告されない');

        // 単位が多すぎる分子は数えずに overflow を返す（UIが固まらないように）
        const over = W.countStereoisomers(molOf('D-グルコース（鎖状）'), 2);
        assert(over.overflow && over.count === null, '上限を超えたときに overflow を返さない');
    });

    test('ST16: 環の回転対称で立体異性体がまとまる（乳酸3分子の環状エステル）', async (c) => {
        const W = c.W;
        // 大学入試で出題例のある題材（ユーザー提供）。乳酸3分子が頭尾で縮合した環状エステルは
        // 9員環 [ -O-CH(CH₃)-C(=O)- ]×3 で、不斉炭素が3個ある。
        // 素朴には 2³=8 通りだが、**環に3回回転対称があるため** RRS・RSR・SRR は
        // 同じ分子（同様に RSS・SRS・SSR も同じ）で、実際には4種類しかない。
        // メソ体の畳み込み（ST1）と同じ「自己同型で最小化する」仕組みが、
        // 環の回転対称にもそのまま効くことの担保。
        const m = new W.Molecule();
        const R = 120, cx = 400, cy = 300;
        const ring = [];
        for (let i = 0; i < 9; i++) {
            const th = -Math.PI / 2 + i * 2 * Math.PI / 9;
            ring.push(m.addAtom(i % 3 === 0 ? 'O' : 'C',
                Math.round(cx + R * Math.cos(th)), Math.round(cy + R * Math.sin(th))));
        }
        for (let i = 0; i < 9; i++) m.addBond(ring[i].id, ring[(i + 1) % 9].id, 1);
        const centers = [];
        for (let i = 0; i < 9; i++) {
            const th = -Math.PI / 2 + i * 2 * Math.PI / 9;
            const ox = Math.round(cx + (R + 42) * Math.cos(th));
            const oy = Math.round(cy + (R + 42) * Math.sin(th));
            if (i % 3 === 1) { // 不斉炭素に -CH₃
                const ch3 = m.addAtom('C', ox, oy);
                m.addBond(ring[i].id, ch3.id, 1);
                centers.push(ring[i].id);
            }
            if (i % 3 === 2) { // カルボニルの =O
                const o = m.addAtom('O', ox, oy);
                m.addBond(ring[i].id, o.id, 2);
            }
        }
        assert(centers.length === 3, `不斉炭素が3個でない（${centers.length}）`);
        assert(m.atoms.every(a => W.isValencyValid(m, a.id)), '価標が妥当でない');

        const stereoOf = (mask) => {
            const atomParity = {};
            centers.forEach((id, k) => { atomParity[id] = (mask >> k & 1) ? 1 : -1; });
            return { atomParity, bondGeo: {} };
        };
        const codeOf = (mask) => W.canonicalStereoCode(m, stereoOf(mask));
        const groups = new Map();
        for (let mask = 0; mask < 8; mask++) {
            const code = codeOf(mask);
            if (!groups.has(code)) groups.set(code, []);
            groups.get(code).push(mask);
        }
        assert(groups.size === 4,
            `2³=8通りが4種類にまとまるべき（実際は ${groups.size} 種類）`);
        const sizes = [...groups.values()].map(g => g.length).sort((a, b) => a - b);
        assert(JSON.stringify(sizes) === JSON.stringify([1, 1, 3, 3]),
            `まとまり方が 1,1,3,3 でない（${sizes.join(',')}）＝回転対称の畳み込みが効いていない`);
        // RRR(mask=7) と SSS(mask=0) は互いに鏡像、混合の2組も互いに鏡像。アキラル体は無い
        const mirrorOf = (mask) => W.canonicalStereoCode(m, W.mirrorStereo(stereoOf(mask)));
        [0, 1, 3, 7].forEach(mask => {
            assert(codeOf(mask) !== mirrorOf(mask),
                `mask=${mask} がアキラル（鏡像＝自分自身）と判定された。この環にはメソ体は無い`);
        });
        assert(mirrorOf(7) === codeOf(0), 'RRR の鏡像が SSS になっていない');
        assert(mirrorOf(1) === codeOf(3), '混合体どうしが鏡像の関係になっていない');
    });

    test('ST1: 立体レイヤ（P12-7 M0）— パリティ/EZ の区別・メソ体の畳み込み・既定不変', async (c) => {
        const W = c.W;
        const SC = W.canonicalStereoCode, AP = W.computeAtomParity, MIR = W.mirrorStereo;
        assert(typeof SC === 'function' && typeof AP === 'function', '立体レイヤ関数が公開されていない');

        // 1. 乳酸: 鏡像の区別・mirrorStereo の整合・立体未指定との区別
        const lac = new W.Molecule();
        const lc1 = lac.addAtom('C', 0, 0), lc2 = lac.addAtom('C', 40, 0), lc3 = lac.addAtom('C', 80, 0);
        const lo1 = lac.addAtom('O', 40, 40), lo2 = lac.addAtom('O', 80, -40), lo3 = lac.addAtom('O', 120, 0);
        lac.addBond(lc1.id, lc2.id, 1); lac.addBond(lc2.id, lc3.id, 1); lac.addBond(lc2.id, lo1.id, 1);
        lac.addBond(lc3.id, lo2.id, 2); lac.addBond(lc3.id, lo3.id, 1);
        const lp = AP(lac, lc2.id, [lc1.id, lc3.id, lo1.id, 'H']);
        assert(lp === 1 || lp === -1, '乳酸のパリティが計算できない');
        assert(AP(lac, lc2.id, [lc3.id, lc1.id, lo1.id, 'H']) === -lp, '置換基2つの交換で反転しない');
        const lA = SC(lac, { atomParity: { [lc2.id]: lp } });
        const lB = SC(lac, { atomParity: { [lc2.id]: -lp } });
        assert(lA !== lB, '乳酸の鏡像が区別されない');
        assert(lA !== SC(lac, {}), '立体未指定と区別されない');
        assert(SC(lac, MIR({ atomParity: { [lc2.id]: lp } })) === lB, 'mirrorStereo が鏡像に一致しない');

        // 2. 酒石酸: (R,R)/(S,S)/メソのちょうど3種。メソは鏡映不変（アキラル）
        const tar = new W.Molecule();
        const tc1 = tar.addAtom('C', 0, 0), to1 = tar.addAtom('O', 0, -40), to2 = tar.addAtom('O', -40, 0);
        const tc2 = tar.addAtom('C', 40, 0), to3 = tar.addAtom('O', 40, 40);
        const tc3 = tar.addAtom('C', 80, 0), to4 = tar.addAtom('O', 80, -40);
        const tc4 = tar.addAtom('C', 120, 0), to5 = tar.addAtom('O', 120, 40), to6 = tar.addAtom('O', 160, 0);
        tar.addBond(tc1.id, to1.id, 2); tar.addBond(tc1.id, to2.id, 1); tar.addBond(tc1.id, tc2.id, 1);
        tar.addBond(tc2.id, to3.id, 1); tar.addBond(tc2.id, tc3.id, 1); tar.addBond(tc3.id, to4.id, 1);
        tar.addBond(tc3.id, tc4.id, 1); tar.addBond(tc4.id, to5.id, 2); tar.addBond(tc4.id, to6.id, 1);
        const p2 = AP(tar, tc2.id, [tc1.id, tc3.id, to3.id, 'H']);
        const p3 = AP(tar, tc3.id, [tc4.id, tc2.id, to4.id, 'H']);
        const tcode = (a, b) => SC(tar, { atomParity: { [tc2.id]: a * p2, [tc3.id]: b * p3 } });
        const RR = tcode(1, 1), SS = tcode(-1, -1), RS = tcode(1, -1), SR = tcode(-1, 1);
        assert(RR !== SS, '(R,R)と(S,S)が区別されない');
        assert(RS === SR, 'メソ体が畳まれない（(R,S)≠(S,R)）');
        assert(new Set([RR, SS, RS, SR]).size === 3, `酒石酸が3種にならない`);
        assert(SC(tar, MIR({ atomParity: { [tc2.id]: p2, [tc3.id]: -p3 } })) === RS, 'メソ体が鏡映不変でない');

        // 3. E/Z: 2-ブテンのシス/トランス/未指定の3区別と、無効記述子の無視
        const bu = new W.Molecule();
        const b1 = bu.addAtom('C', 0, 0), b2 = bu.addAtom('C', 40, 0);
        const b3 = bu.addAtom('C', 80, 0), b4 = bu.addAtom('C', 120, 0);
        bu.addBond(b1.id, b2.id, 1); bu.addBond(b2.id, b3.id, 2); bu.addBond(b3.id, b4.id, 1);
        const bk = b2.id < b3.id ? `${b2.id}_${b3.id}` : `${b3.id}_${b2.id}`;
        const cis = SC(bu, { bondGeo: { [bk]: 'syn' } });
        const trans = SC(bu, { bondGeo: { [bk]: 'anti' } });
        assert(new Set([cis, trans, SC(bu, {})]).size === 3, 'シス/トランス/未指定が区別されない');
        assert(SC(bu, MIR({ bondGeo: { [bk]: 'syn' } })) === cis, 'シス体が鏡映不変でない');
        const ib = new W.Molecule();
        const i1 = ib.addAtom('C', 0, 0), i2 = ib.addAtom('C', 40, 0);
        const i3 = ib.addAtom('C', 40, 40), i4 = ib.addAtom('C', 80, 0);
        ib.addBond(i2.id, i1.id, 1); ib.addBond(i2.id, i3.id, 1); ib.addBond(i2.id, i4.id, 2);
        const ik = i2.id < i4.id ? `${i2.id}_${i4.id}` : `${i4.id}_${i2.id}`;
        assert(SC(ib, { bondGeo: { [ik]: 'syn' } }) === SC(ib, {}), 'イソブテンの無効な幾何指定が無視されない');
        assert(SC(ib, { atomParity: { [i1.id]: 1 } }) === SC(ib, {}), '非不斉炭素へのパリティ指定が無視されない');

        // 4. 既定の canonicalCode は立体レイヤの影響を受けない（回帰ゼロの要）
        assert(!W.canonicalCode(lac).includes('|'), 'canonicalCode に立体層が混入');
        const iso = W.enumerateConstitutionalIsomers(['C', 'C', 'C', 'C'], 10);
        assert(iso.isomers.length === 2, '既定の列挙が立体を数えている（C4H10≠2）');
    });

    test('ST2: 座標からの結合幾何読み取りと E/Z 命名統合（P12-7 M1）', async (c) => {
        c.reset();
        const W = c.W;
        const RG = W.readBondGeoFromCoords;
        assert(typeof RG === 'function', 'readBondGeoFromCoords が公開されていない');

        // (a) 2置換 2-ブテンの cis/trans を syn/anti で読む（compounds.json と同じ座標系）
        const build2Butene = (y4) => {
            const m = new W.Molecule();
            const a1 = m.addAtom('C', 379, 258);
            const a2 = m.addAtom('C', 379, 300);
            const a3 = m.addAtom('C', 421, 300);
            const a4 = m.addAtom('C', 421, y4);
            m.addBond(a1.id, a2.id, 1);
            m.addBond(a2.id, a3.id, 2);
            m.addBond(a3.id, a4.id, 1);
            return m;
        };
        const cisGeo = RG(build2Butene(258));   // メチル基が同じ側 → syn
        const transGeo = RG(build2Butene(342));  // 反対側 → anti
        assert(Object.keys(cisGeo).length === 1 && Object.values(cisGeo)[0] === 'syn',
            `シス2-ブテンが syn で読めない（${JSON.stringify(cisGeo)}）`);
        assert(Object.keys(transGeo).length === 1 && Object.values(transGeo)[0] === 'anti',
            `トランス2-ブテンが anti で読めない（${JSON.stringify(transGeo)}）`);

        // (b) 3置換アルケン（3-メチル-2-ペンテン）: 2置換端の置換基が相異なるので読める
        // （getDoubleBondGeometry は各端1置換のみ対象で、これを読めない）
        const tri = new W.Molecule();
        const t1 = tri.addAtom('C', 0, -40);   // C2 側のメチル
        const t2 = tri.addAtom('C', 0, 0);     // =CH
        const t3 = tri.addAtom('C', 40, 0);    // =C(CH3)(Et)
        const tm = tri.addAtom('C', 40, -40);  // C3 のメチル
        const t4 = tri.addAtom('C', 40, 40);   // エチルの CH2
        const t5 = tri.addAtom('C', 80, 40);   // エチルの CH3
        tri.addBond(t1.id, t2.id, 1);
        tri.addBond(t2.id, t3.id, 2);
        tri.addBond(t3.id, tm.id, 1);
        tri.addBond(t3.id, t4.id, 1);
        tri.addBond(t4.id, t5.id, 1);
        const triGeo = RG(tri);
        assert(Object.keys(triGeo).length === 1 && ['syn', 'anti'].includes(Object.values(triGeo)[0]),
            `3置換アルケンが読めない（${JSON.stringify(triGeo)}）`);
        assert(W.getDoubleBondGeometry(tri) === null,
            '3置換アルケンで getDoubleBondGeometry が非nullになった（新旧の守備範囲の差の確認）');

        // (c) C=C 2本（2,4-ヘキサジエン）が両方読める（getDoubleBondGeometry は複数本で null）
        const hexa = new W.Molecule();
        const h1 = hexa.addAtom('C', 0, 0);
        const h2 = hexa.addAtom('C', 40, 40);
        const h3 = hexa.addAtom('C', 80, 40);
        const h4 = hexa.addAtom('C', 120, 0);
        const h5 = hexa.addAtom('C', 160, 0);
        const h6 = hexa.addAtom('C', 200, -40);
        hexa.addBond(h1.id, h2.id, 1);
        hexa.addBond(h2.id, h3.id, 2);
        hexa.addBond(h3.id, h4.id, 1);
        hexa.addBond(h4.id, h5.id, 2);
        hexa.addBond(h5.id, h6.id, 1);
        const hexaGeo = RG(hexa);
        assert(Object.keys(hexaGeo).length === 2, `2,4-ヘキサジエンの2本が両方読めない（${JSON.stringify(hexaGeo)}）`);
        assert(new Set(Object.values(hexaGeo)).size === 2, 'ヘキサジエンの2本が syn/anti で描き分けられていない');
        assert(W.getDoubleBondGeometry(hexa) === null, '複数 C=C で getDoubleBondGeometry が null にならない');

        // (d) 直線描画は不定 → スキップ（空オブジェクト）
        const linear = new W.Molecule();
        const l1 = linear.addAtom('C', 0, 0);
        const l2 = linear.addAtom('C', 40, 0);
        const l3 = linear.addAtom('C', 80, 0);
        const l4 = linear.addAtom('C', 120, 0);
        linear.addBond(l1.id, l2.id, 1);
        linear.addBond(l2.id, l3.id, 2);
        linear.addBond(l3.id, l4.id, 1);
        assert(Object.keys(RG(linear)).length === 0, '直線描画がスキップされない');

        // (e) 実データ経由の統合: 描いたトランス/シス-2-ブテンが lookup で正しく命名される
        const nameEl = () => c.D.getElementById('compound-name').textContent;
        c.game.userMolecule = build2Butene(342);
        c.game.updateDrawing();
        assert(nameEl() === 'トランス-2-ブテン', `トランス描画の命名が「${nameEl()}」（stereo 経路）`);
        c.game.userMolecule = build2Butene(258);
        c.game.updateDrawing();
        assert(nameEl() === 'シス-2-ブテン', `シス描画の命名が「${nameEl()}」（stereo 経路）`);
    });

    test('ST3: フィッシャー投影の sp3 パリティ読み取りと開鎖糖・乳酸の立体命名（P12-7 M2a）', async (c) => {
        // 立体を名前に反映するトグルは**既定 OFF**（2026-08-02）。ここは立体命名そのものを
        // 見るテストなので明示的に ON にする（UI の既定値にテストを依存させない）
        c.game.setReadStereo(true);
        c.reset();
        const W = c.W;
        const RF = W.readAtomParityFromFischer;
        assert(typeof RF === 'function', 'readAtomParityFromFischer が公開されていない');

        // D-グリセルアルデヒド OHC-CHOH-CH2OH を中心(358,300)まわりに rot° 回転して構築。
        // ohDx>0 で OH 右（D）・<0 で OH 左（L）。
        const buildGly = (ohDx, ohDy, rot) => {
            const cx = 358, cy = 300, rad = rot * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
            const R = (x, y) => { const dx = x - cx, dy = y - cy; return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs]; };
            const m = new W.Molecule();
            const P = (el, x, y) => { const [rx, ry] = R(x, y); return m.addAtom(el, rx, ry); };
            const c1 = P('C', 358, 258), c2 = P('C', 358, 300), c3 = P('C', 358, 342);
            const oald = P('O', 358, 216), oh = P('O', 358 + ohDx, 300 + ohDy), c3oh = P('O', 358, 384);
            m.addBond(c1.id, c2.id, 1); m.addBond(c2.id, c3.id, 1);
            m.addBond(c1.id, oald.id, 2); m.addBond(c2.id, oh.id, 1); m.addBond(c3.id, c3oh.id, 1);
            return { m, center: c2.id };
        };

        // (a) D 体で中心に ±1 が出る。左右反転（L 体）で符号反転。
        const dG = buildGly(42, 0, 0);
        const pD = RF(dG.m)[dG.center];
        assert(pD === 1 || pD === -1, `D-グリセルアルデヒドの中心パリティが出ない（${pD}）`);
        assert(Object.keys(RF(dG.m)).length === 1, 'sp2 の C1 やアキラルな C3 まで記述子が出ている');
        const lG = buildGly(-42, 0, 0);
        assert(RF(lG.m)[lG.center] === -pD, '左右反転（L 体）でパリティが反転しない');

        // (b) 3 性質: 90°回転で符号反転・180°回転で符号不変・270°で反転。
        const p90 = (() => { const g = buildGly(42, 0, 90); return RF(g.m)[g.center]; })();
        const p180 = (() => { const g = buildGly(42, 0, 180); return RF(g.m)[g.center]; })();
        const p270 = (() => { const g = buildGly(42, 0, 270); return RF(g.m)[g.center]; })();
        assert(p90 === -pD, `90°回転で符号反転しない（${p90} vs ${-pD}）`);
        assert(p180 === pD, `180°回転で符号が変わった（${p180} vs ${pD}）`);
        assert(p270 === -pD, `270°回転で符号反転しない（${p270} vs ${-pD}）`);

        // (c) 軸から外れた置換基（斜め）を持つ中心はスキップ（記述子なし）。
        const off = buildGly(30, -30, 0); // OH を上右45°へ → 軸外
        assert(RF(off.m)[off.center] === undefined && Object.keys(RF(off.m)).length === 0,
            '軸外の置換基を持つ中心がスキップされない');

        // (d) 統合: D-グルコース/ガラクトース/マンノースが各々正しく・相互に異なる名前に。
        const molOf = (name) => {
            const e = W.COMPOUNDS.find(x => x.name === name);
            assert(e, `${name} が compounds.json に無い`);
            return c.game.createTargetFromData({ target: e.target });
        };
        const sugars = ['D-グルコース（鎖状）', 'D-ガラクトース（鎖状）', 'D-マンノース（鎖状）'];
        const sn = sugars.map(n => c.game.lookupCompoundName(molOf(n)));
        assert(sn.every((n, i) => n === sugars[i]), `糖の自己命名が不一致: ${JSON.stringify(sn)}`);
        assert(new Set(sn).size === 3, '3 種の糖が同一名に畳まれている（canonicalCode 同一・stereoCode 相異のはず）');
        // 立体未指定（各中心の OH を軸外へ回す）では糖名に一致しない。
        const g = molOf('D-グルコース（鎖状）');
        g.atoms.forEach(ca => {
            if (ca.element !== 'C' || !g.isAsymmetricCarbon(ca.id)) return;
            g.getNeighbors(ca.id).forEach(n => {
                if (n.atom.element !== 'O') return;
                const dx = n.atom.x - ca.x, dy = n.atom.y - ca.y;
                const rad = 40 * Math.PI / 180, cs = Math.cos(rad), sn2 = Math.sin(rad);
                n.atom.x = ca.x + dx * cs - dy * sn2; n.atom.y = ca.y + dx * sn2 + dy * cs;
            });
        });
        assert(Object.keys(RF(g)).length === 0, '軸外に描いた糖でまだ記述子が出ている');
        assert(!sugars.includes(c.game.lookupCompoundName(g)),
            `立体未指定の糖が糖名に一致してしまう（${c.game.lookupCompoundName(g)}）`);

        // (e) D-乳酸を描くと「D-乳酸」、中心 OH を軸外にした乳酸は総称「乳酸」に落ちる。
        assert(c.game.lookupCompoundName(molOf('D-乳酸')) === 'D-乳酸', 'D-乳酸が命名されない');
        assert(c.game.lookupCompoundName(molOf('L-乳酸')) === 'L-乳酸', 'L-乳酸が命名されない');
        const lac = molOf('D-乳酸');
        lac.atoms.forEach(ca => {
            if (ca.element !== 'C' || !lac.isAsymmetricCarbon(ca.id)) return;
            lac.getNeighbors(ca.id).forEach(n => {
                if (n.atom.element !== 'O') return;
                const dx = n.atom.x - ca.x, dy = n.atom.y - ca.y;
                const rad = 40 * Math.PI / 180, cs = Math.cos(rad), sn2 = Math.sin(rad);
                n.atom.x = ca.x + dx * cs - dy * sn2; n.atom.y = ca.y + dx * sn2 + dy * cs;
            });
        });
        assert(c.game.lookupCompoundName(lac) === '乳酸', `軸外の乳酸が総称名に落ちない（${c.game.lookupCompoundName(lac)}）`);
    });

    test('ST4: ハース面マークから環sp3パリティを読む（P12-7 M2b コア）', async (c) => {
        const W = c.W;
        assert(typeof W.readRingParityFromHaworth === 'function', 'readRingParityFromHaworth 未公開');

        // ピラノース環（正六角形 O,C1..C5）を組む。faces.cN=+1(上)/-1(下)。C5=CH2OH
        function buildPyranose(faces, opts) {
            opts = opts || {};
            const m = new W.Molecule();
            const R = 40, cx = 200, cy = 200;
            const ang = i => (-90 + i * 60) * Math.PI / 180;
            const vx = i => cx + R * Math.cos(ang(i)), vy = i => cy + R * Math.sin(ang(i));
            const elem = ['O', 'C', 'C', 'C', 'C', 'C'], atoms = [];
            for (let i = 0; i < 6; i++) atoms.push(m.addAtom(elem[i], vx(i), vy(i)));
            for (let i = 0; i < 6; i++) m.addBond(atoms[i].id, atoms[(i + 1) % 6].id, 1);
            const outDir = i => { const a = ang(i); return [Math.cos(a), Math.sin(a)]; };
            const addSub = (ci, face, kind) => {
                const d = outDir(ci), bx = vx(ci) + d[0] * 30, by = vy(ci) + d[1] * 30;
                if (kind === 'OH') { const o = m.addAtom('O', bx, by); m.addBond(atoms[ci].id, o.id, 1); o.haworthFace = face; }
                else { const cc = m.addAtom('C', bx, by); const o = m.addAtom('O', bx + d[0] * 30, by + d[1] * 30);
                       m.addBond(atoms[ci].id, cc.id, 1); m.addBond(cc.id, o.id, 1); cc.haworthFace = face; }
            };
            addSub(1, faces.c1, 'OH'); addSub(2, faces.c2, 'OH'); addSub(3, faces.c3, 'OH');
            addSub(4, faces.c4, 'OH'); addSub(5, faces.c5 == null ? 1 : faces.c5, 'CH2OH');
            if (opts.rot || opts.dx || opts.dy || opts.mirror) {
                const rad = (opts.rot || 0) * Math.PI / 180;
                m.atoms.forEach(a => { const x = a.x - cx, y = a.y - cy;
                    let nx = x * Math.cos(rad) - y * Math.sin(rad), ny = x * Math.sin(rad) + y * Math.cos(rad);
                    if (opts.mirror) nx = -nx; a.x = nx + cx + (opts.dx || 0); a.y = ny + cy + (opts.dy || 0); });
            }
            return m;
        }
        const SC = m => W.canonicalStereoCode(m, { atomParity: W.readRingParityFromHaworth(m) });
        const GLU = { c1: 1, c2: -1, c3: 1, c4: -1, c5: 1 };
        const base = buildPyranose(GLU);

        // 環5中心すべてで面パリティを読み、Fischer は環中心を読まない（相互排他）
        assert(Object.keys(W.readRingParityFromHaworth(base)).length === 5, '環5中心の面パリティを読む');
        assert(Object.keys(W.readAtomParityFromFischer(base)).length === 0, 'Fischer は環中心を読まない');

        const glu = SC(base);
        assert(SC(buildPyranose({ ...GLU, c1: -1 })) !== glu, 'α/β（C1面反転）で別コード');
        assert(W.canonicalCode(buildPyranose({ ...GLU, c1: -1 })) === W.canonicalCode(base), 'α/β は canonicalCode 同一');
        ['c2', 'c3', 'c4', 'c5'].forEach(k =>
            assert(SC(buildPyranose({ ...GLU, [k]: -GLU[k] })) !== glu, `${k}エピマーで別コード`));

        const codes = new Set();
        for (let mask = 0; mask < 32; mask++)
            codes.add(SC(buildPyranose({ c1: mask&1?1:-1, c2: mask&2?1:-1, c3: mask&4?1:-1, c4: mask&8?1:-1, c5: mask&16?1:-1 })));
        assert(codes.size === 32, `2^5=32 の環立体配置がすべて相異なる（実際 ${codes.size}）`);

        assert(SC(buildPyranose(GLU, { rot: 37, dx: 120, dy: -80 })) === glu, '回転・平行移動で立体コード不変');
        assert(SC(buildPyranose(GLU, { mirror: true })) !== glu, '鏡映でエナンチオマー＝別コード');
        assert(SC(buildPyranose(GLU, { mirror: true })) ===
            W.canonicalStereoCode(base, W.mirrorStereo({ atomParity: W.readRingParityFromHaworth(base) })),
            '鏡映コード＝mirrorStereo(元) と一致');

        // 面マーク未指定＋横向き描画はスキップ（M2c: 縦位置から読むが、縦でなければ記述子なし）
        const noMark = buildPyranose(GLU);
        const ringIds = new Set(noMark.atoms.slice(0, 6).map(a => a.id)); // O,C1..C5
        noMark.atoms.forEach(a => { delete a.haworthFace; });
        // 各環外置換基（環炭素の直接の隣接重原子）を横向きに置き直す
        noMark.atoms.forEach(a => {
            if (ringIds.has(a.id)) return;
            const parent = noMark.getNeighbors(a.id).map(n => n.atom).find(p => ringIds.has(p.id));
            if (parent) { a.y = parent.y; a.x = parent.x + 30; }
        });
        assert(Object.keys(W.readRingParityFromHaworth(noMark)).length === 0, '面マーク未指定＋横向きはスキップ（記述子なし）');
    });

    test('ST6: ハース投影の縦位置から環パリティを読む（P12-7 M2c・テンプレート方式のコア）', async (c) => {
        const W = c.W;
        // 向き固定の平たいハース六角形（O 右奥・C1 右）。置換基は縦のみ・haworthFace は付けない
        const RING = { O:{x:520,y:250}, C1:{x:520,y:300}, C2:{x:460,y:330}, C3:{x:340,y:330}, C4:{x:280,y:300}, C5:{x:340,y:250} };
        function build(faces, opts) {
            opts = opts || {};
            const m = new W.Molecule(); const mx = v => opts.mirror ? 800 - v.x : v.x;
            const a = {}; ['O','C1','C2','C3','C4','C5'].forEach(k => a[k] = m.addAtom(k === 'O' ? 'O' : 'C', mx(RING[k]), RING[k].y));
            const seq = ['O','C1','C2','C3','C4','C5'];
            for (let i = 0; i < 6; i++) m.addBond(a[seq[i]].id, a[seq[(i + 1) % 6]].id, 1);
            const put = (ck, up, kind) => {
                const C = a[ck]; let sx = C.x, sy = up ? C.y - 30 : C.y + 30;
                if (opts.sideways === ck) { sx = C.x + 30; sy = C.y; } // 横向き（縦から外す）
                if (kind === 'OH') { const o = m.addAtom('O', sx, sy); m.addBond(C.id, o.id, 1); }
                else { const cc = m.addAtom('C', sx, sy); const o = m.addAtom('O', sx, sy + (up ? -30 : 30)); m.addBond(C.id, cc.id, 1); m.addBond(cc.id, o.id, 1); }
            };
            put('C1', faces.c1, 'OH'); put('C2', faces.c2, 'OH'); put('C3', faces.c3, 'OH'); put('C4', faces.c4, 'OH'); put('C5', faces.c5, 'CH2OH');
            return m;
        }
        const SC = m => W.canonicalStereoCode(m, { atomParity: W.readRingParityFromHaworth(m) });
        const beta = { c1:true, c2:false, c3:true, c4:false, c5:true };
        const b = build(beta);
        // haworthFace を一切付けずに、縦位置だけで環5中心が読める
        assert(Object.keys(W.readRingParityFromHaworth(b)).length === 5, '縦位置だけで環5中心を読む（マークなし）');
        assert(SC(b) !== SC(build({ ...beta, c1: false })), 'α/β（C1の上下）で別コード');
        assert(SC(b) !== SC(build({ ...beta, c4: true })), 'グルコース/ガラクトース（C4）で別コード');
        const codes = new Set();
        for (let k = 0; k < 32; k++) codes.add(SC(build({ c1:!!(k&1), c2:!!(k&2), c3:!!(k&4), c4:!!(k&8), c5:!!(k&16) })));
        assert(codes.size === 32, `2^5=32 の縦位置配置がすべて相異なる（実際 ${codes.size}）`);
        // 横向きに描いた置換基（C1）は縦から外れるのでスキップ → 4中心
        assert(Object.keys(W.readRingParityFromHaworth(build(beta, { sideways: 'C1' }))).length === 4, '横向き置換基はスキップ（縦のみ読む）');
        // 鏡像（左右反転）は別コード＝エナンチオマー（テンプレートは向き固定なので実利用では起きない）
        assert(SC(b) !== SC(build(beta, { mirror: true })), '左右反転はエナンチオマーで別コード');
    });

    test('ST5: α/β 面マークモードUI・serialize・環グルコピラノースの立体命名（P12-7 M2b）', async (c) => {
        // 立体を名前に反映するトグルは**既定 OFF**（2026-08-02）。ここは立体命名そのものを
        // 見るテストなので明示的に ON にする（UI の既定値にテストを依存させない）
        c.game.setReadStereo(true);
        c.reset();
        const W = c.W, D = c.D, g = c.game;
        const haworthBtn = D.getElementById('btn-haworth-mark');
        const asymBtn = D.getElementById('btn-asym-mark');
        const reshapeBtn = D.getElementById('btn-cistrans-reshape');
        assert(haworthBtn && asymBtn && reshapeBtn, '面マーク/不斉/整形ボタンが揃っていない');

        // (1) トグルと相互排他
        haworthBtn.click();
        assert(g.haworthMode && haworthBtn.classList.contains('active'), '面マークモードがONにならない');
        asymBtn.click(); // 不斉マークON → 面マーク解除
        assert(g.asymmetricMode && !g.haworthMode && !haworthBtn.classList.contains('active'),
            '不斉マークON で面マークが解除されない');
        asymBtn.click();
        haworthBtn.click(); // 面マーク再ON
        reshapeBtn.click(); // 整形ON → 面マーク解除
        assert(g.reshapeMode && !g.haworthMode, '整形ON で面マークが解除されない');
        reshapeBtn.click();
        haworthBtn.click();
        assert(g.haworthMode, '面マーク再ONできない');
        g.loadStage(0); // loadStage で解除
        assert(!g.haworthMode && !haworthBtn.classList.contains('active'), 'loadStage で面マークが解除されない');

        // ピラノースを作図（β entry から。面マークは剥がして未設定から始める）
        const entry = W.COMPOUNDS.find(x => x.name === 'β-D-グルコース（β-D-グルコピラノース）');
        assert(entry, 'β-D-グルコピラノース が compounds.json に無い');
        const buildUser = () => {
            const m = g.createTargetFromData({ target: entry.target });
            m.atoms.forEach(a => { delete a.haworthFace; });
            return m;
        };

        // (2) 環外OHクリックで面トグル・レンダ変化・saveState/Undo復帰
        g.userMolecule = buildUser();
        g.updateDrawing();
        let anomer = g.userMolecule.atoms[6]; // アノマー OH（環外・環Cに単結合）
        assert(anomer.element === 'O' && anomer.haworthFace == null, 'アノマーOHの初期面が未設定でない');
        assert(g._isHaworthFaceTarget(anomer), 'アノマーOHが面マーク対象と判定されない');
        assert(!g._isHaworthFaceTarget(g.userMolecule.atoms[1]), '環内Cが面マーク対象になっている');
        assert(!g._isHaworthFaceTarget(g.userMolecule.atoms[0]), '環内Oが面マーク対象になっている');
        haworthBtn.click();
        assert(g.haworthMode, '面マークモードがONにならない(2)');
        assert(D.querySelectorAll('.svg-haworth-face').length === 0, '初期状態で面マークが描かれている');
        c.clickAt(anomer.x, anomer.y);
        assert(g.userMolecule.atoms[6].haworthFace === 1, '初回クリックで上(+1)にならない');
        assert(D.querySelectorAll('.svg-haworth-face').length >= 1, 'レンダに面マーク(▲/▽)が現れない');
        c.clickAt(anomer.x, anomer.y);
        assert(g.userMolecule.atoms[6].haworthFace === -1, '再クリックで下(-1)に反転しない');
        g.undo();
        assert(g.userMolecule.atoms[6].haworthFace === 1, 'Undoで上(+1)に戻らない');
        g.undo();
        assert(g.userMolecule.atoms[6].haworthFace == null, 'Undoで未設定に戻らない');
        // 対象外（環内O）をクリックしても面は付かない
        const before = D.querySelectorAll('.svg-haworth-face').length;
        c.clickAt(g.userMolecule.atoms[0].x, g.userMolecule.atoms[0].y);
        assert(g.userMolecule.atoms[0].haworthFace == null &&
            D.querySelectorAll('.svg-haworth-face').length === before, '環内Oのクリックで面が付いた');
        haworthBtn.click(); // 面マークOFF

        // (3) serialize → restore で haworthFace が保存復元される
        g.userMolecule = buildUser();
        g.userMolecule.atoms[6].haworthFace = 1;
        g.userMolecule.atoms[7].haworthFace = -1;
        const snap = g.serializeState();
        g.restoreState(JSON.parse(snap));
        assert(g.userMolecule.atoms[6].haworthFace === 1 && g.userMolecule.atoms[7].haworthFace === -1,
            'serialize→restore で haworthFace が保存復元されない');

        // (4) 統合: α/β を作図（面マーク付き）→ 命名が正しく互いに異なる
        const molOf = (name) => {
            const e = W.COMPOUNDS.find(x => x.name === name);
            assert(e, name + ' が compounds.json に無い');
            return g.createTargetFromData({ target: e.target });
        };
        const bName = g.lookupCompoundName(molOf('β-D-グルコース（β-D-グルコピラノース）'));
        const aName = g.lookupCompoundName(molOf('α-D-グルコース（α-D-グルコピラノース）'));
        assert(bName === 'β-D-グルコース（β-D-グルコピラノース）', 'β の命名が誤り: ' + bName);
        assert(aName === 'α-D-グルコース（α-D-グルコピラノース）', 'α の命名が誤り: ' + aName);
        assert(bName !== aName, 'α/β が同名に畳まれている');
        // C1(アノマー) の面だけ変えると α⇄β が入れ替わる
        const bMol = molOf('β-D-グルコース（β-D-グルコピラノース）');
        bMol.atoms[6].haworthFace = -1; // 上→下 で α へ
        assert(g.lookupCompoundName(bMol) === 'α-D-グルコース（α-D-グルコピラノース）', 'C1面反転で β→α にならない');
        const aMol = molOf('α-D-グルコース（α-D-グルコピラノース）');
        aMol.atoms[6].haworthFace = 1;  // 下→上 で β へ
        assert(g.lookupCompoundName(aMol) === 'β-D-グルコース（β-D-グルコピラノース）', 'C1面反転で α→β にならない');
        // 立体を表さない（面マークも縦位置も無い＝横向き）環グルコースはどちらにも一致しない
        // （総称/null）。M2c 以降はテンプレートを縦位置で描くため、横向きに置き直して立体を消す
        const noMark = molOf('β-D-グルコース（β-D-グルコピラノース）');
        const noMarkRingIds = new Set(noMark.atoms.slice(0, 6).map(a => a.id)); // O,C1..C5
        noMark.atoms.forEach(a => {
            delete a.haworthFace;
            if (noMarkRingIds.has(a.id)) return;
            const parent = noMark.getNeighbors(a.id).map(n => n.atom).find(p => noMarkRingIds.has(p.id));
            if (parent) { a.x = parent.x + 30; a.y = parent.y; } // 横向きに置き直す（縦位置を消す）
        });
        const nm = g.lookupCompoundName(noMark);
        assert(nm !== 'β-D-グルコース（β-D-グルコピラノース）' && nm !== 'α-D-グルコース（α-D-グルコピラノース）',
            '立体を表さない（横向き）環グルコースが α/β に一致してしまう: ' + nm);

        // (5) ST3 無回帰: 鎖グルコース/乳酸は従来どおり命名
        assert(g.lookupCompoundName(molOf('D-グルコース（鎖状）')) === 'D-グルコース（鎖状）',
            '鎖グルコースの命名が無回帰でない');
        assert(g.lookupCompoundName(molOf('D-乳酸')) === 'D-乳酸', 'D-乳酸の命名が無回帰でない');

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('ST7: ハース環テンプレート・モジュールと縦位置入力（P12-7 M2c プラミング）', async (c) => {
        // 立体を名前に反映するトグルは**既定 OFF**（2026-08-02）。ここは立体命名そのものを
        // 見るテストなので明示的に ON にする（UI の既定値にテストを依存させない）
        c.game.setReadStereo(true);
        c.reset();
        const W = c.W, D = c.D, g = c.game;

        // (1) モジュールボタンが存在（PC/モバイル共用の同一 DOM）
        const btn = D.querySelector('.mod-btn[data-module="haworth-pyranose"]');
        assert(btn, 'ハース環（ピラノース）モジュールボタンが無い');
        assert(g.isRingModule('haworth-pyranose'), 'haworth-pyranose が環モジュール扱いでない');

        // (2) 配置すると 環6原子（5C+環内1O）＋環6結合が置かれる
        g.userMolecule = new W.Molecule();
        g.placeModule('haworth-pyranose', 400, 300, null);
        const atoms = g.userMolecule.atoms;
        assert(atoms.length === 6, `ハース環の原子数が ${atoms.length}（6を期待）`);
        assert(atoms.filter(a => a.element === 'O').length === 1, '環内 O がちょうど1個でない');
        assert(atoms.filter(a => a.element === 'C').length === 5, '環炭素が5個でない');
        assert(g.userMolecule.bonds.length === 6, `環結合が ${g.userMolecule.bonds.length} 本（6を期待）`);
        const ringO = atoms.find(a => a.element === 'O');
        assert(g._atomInOxygenRing(atoms[1].id), '環炭素が「酸素を含む環」と判定されない');
        // Undo で配置前に戻る
        g.undo();
        assert(g.userMolecule.atoms.length === 0, 'ハース環配置が Undo で戻らない');

        // (3) 縦置きスナップ: 環炭素の真上/真下に O を吸着させる（面が縦で決まる）
        g.userMolecule = new W.Molecule();
        g.placeModule('haworth-pyranose', 400, 300, null);
        const C1 = g.userMolecule.atoms[1]; // アノマー炭素
        g.selectedTool = 'select';
        g.selectedAtomType = 'O';
        c.clickAt(C1.x + 6, C1.y - 40); // 少し上・右にずらしてクリック → 真上に吸着するはず
        const upO = g.userMolecule.atoms[g.userMolecule.atoms.length - 1];
        assert(upO.element === 'O' && Math.abs(upO.x - C1.x) < 3 && upO.y < C1.y,
            `環炭素の真上に吸着しない（Δx=${(upO.x - C1.x).toFixed(1)}, Δy=${(upO.y - C1.y).toFixed(1)}）`);
        // 全炭素環（ベンゼン）には縦スナップを効かせない（既存作図に非干渉）
        g.userMolecule = new W.Molecule();
        g.placeModule('benzene', 400, 300, null);
        assert(!g._atomInOxygenRing(g.userMolecule.atoms[0].id), 'ベンゼン環が酸素環と誤判定される');

        // (4) テンプレート座標で作図（haworthFace 無し・縦位置のみ）→ α/β を命名し分ける
        const molOf = (name) => {
            const e = W.COMPOUNDS.find(x => x.name === name);
            assert(e, name + ' が compounds.json に無い');
            const m = g.createTargetFromData({ target: e.target });
            assert(m.atoms.every(a => a.haworthFace == null), name + ' に haworthFace が残っている（M2c は縦位置で表す）');
            return m;
        };
        const bMol = molOf('β-D-グルコース（β-D-グルコピラノース）');
        const aMol = molOf('α-D-グルコース（α-D-グルコピラノース）');
        assert(g.lookupCompoundName(bMol) === 'β-D-グルコース（β-D-グルコピラノース）', 'テンプレ縦位置で β を命名できない');
        assert(g.lookupCompoundName(aMol) === 'α-D-グルコース（α-D-グルコピラノース）', 'テンプレ縦位置で α を命名できない');
        // アノマー(C1-OH=idx6)の上下を反転すると α⇄β が入れ替わる
        const bFlip = molOf('β-D-グルコース（β-D-グルコピラノース）');
        bFlip.atoms[6].y = bFlip.atoms[1].y + 30; // 上→下（奥）で α へ
        assert(g.lookupCompoundName(bFlip) === 'α-D-グルコース（α-D-グルコピラノース）', 'アノマー下反転で β→α にならない');
        const aFlip = molOf('α-D-グルコース（α-D-グルコピラノース）');
        aFlip.atoms[6].y = aFlip.atoms[1].y - 30; // 下→上（手前）で β へ
        assert(g.lookupCompoundName(aFlip) === 'β-D-グルコース（β-D-グルコピラノース）', 'アノマー上反転で α→β にならない');

        // (5) 面を付けない（横向き）作図はどちらにも一致しない（該当なし）
        const flat = molOf('β-D-グルコース（β-D-グルコピラノース）');
        const flatRing = new Set(flat.atoms.slice(0, 6).map(a => a.id));
        flat.atoms.forEach(a => {
            if (flatRing.has(a.id)) return;
            const p = flat.getNeighbors(a.id).map(n => n.atom).find(x => flatRing.has(x.id));
            if (p) { a.x = p.x + 30; a.y = p.y; } // 横向きに置き直す
        });
        const fn = g.lookupCompoundName(flat);
        assert(fn !== 'β-D-グルコース（β-D-グルコピラノース）' && fn !== 'α-D-グルコース（α-D-グルコピラノース）',
            '横向き（面なし）ピラノースが α/β に一致してしまう: ' + fn);

        // (6) 無回帰: 鎖状糖・cis/trans は従来どおり命名
        assert(g.lookupCompoundName(molOf('D-グルコース（鎖状）')) === 'D-グルコース（鎖状）',
            '鎖グルコースの命名が無回帰でない');
        const cis = g.createTargetFromData({ target: W.COMPOUNDS.find(x => x.name === 'シス-2-ブテン').target });
        assert(g.lookupCompoundName(cis) === 'シス-2-ブテン', 'シス-2-ブテンの命名が無回帰でない');

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('FR1: ハース環（フラノース）モジュール — 手で描いて α/β フルクトフラノースになる（P12-8）', async (c) => {
        // 立体命名トグルは既定 OFF。ここは立体そのものを見るので明示的に ON にする
        c.game.setReadStereo(true);
        c.reset();
        const W = c.W, D = c.D, g = c.game;

        // (1) パレットにボタンがあり、ハース環モジュールとして扱われる
        assert(D.querySelector('.mod-btn[data-module="haworth-furanose"]'),
            'ハース環（フラノース）モジュールのボタンが無い');
        assert(g.isHaworthModule('haworth-furanose') && g.isRingModule('haworth-furanose'),
            'haworth-furanose がハース環モジュール扱いでない');
        assert(g.isHaworthModule('haworth-pyranose') && g.isRingModule('haworth-pyranose'),
            'haworth-pyranose の扱いが無回帰でない');
        assert(!g.isHaworthModule('cyclopentane'), 'cyclopentane がハース環扱いになっている');

        // (2) 置くと 環5原子（4C＋環内1O）＋環5結合。Undo で戻る
        g.userMolecule = new W.Molecule();
        g.selectedTool = 'select';
        g.placeModule('haworth-furanose', 400, 300, null);
        let atoms = g.userMolecule.atoms;
        assert(atoms.length === 5, `フラノース環の原子数が ${atoms.length}（5を期待）`);
        assert(atoms.filter(a => a.element === 'O').length === 1, '環内 O がちょうど1個でない');
        assert(g.userMolecule.bonds.length === 5, `環結合が ${g.userMolecule.bonds.length} 本（5を期待）`);
        assert(g._atomInOxygenRing(atoms[1].id), '五員環の環炭素が「酸素を含む環」と判定されない');
        g.undo();
        assert(g.userMolecule.atoms.length === 0, 'フラノース環の配置が Undo で戻らない');

        // (3) 形と巡回の向きが compounds.json のフルクトフラノースと同じ。
        //     ここがずれると「呼び出した図」と「手で描いた図」で面の読みが食い違う
        const fur = g.getHaworthPlacementPlan('haworth-furanose', 400, 300);
        const pyr = g.getHaworthPlacementPlan('haworth-pyranose', 400, 300);
        assert(fur.valid && pyr.valid, 'ハース環の配置計画が立たない');
        assert(fur.vertices[0].el === 'O' && pyr.vertices[0].el === 'O', '環内 O が巡回の先頭でない');
        assert(fur.vertices[0].y < fur.center.y, '五員環の環内 O が奥（上）に無い');
        assert(fur.vertices[1].x > fur.center.x, '五員環のアノマー炭素が右に無い');
        const winding = (vs) => vs.reduce((s, v, i) => {
            const w = vs[(i + 1) % vs.length];
            return s + (v.x * w.y - w.x * v.y);
        }, 0);
        const rel = (pl) => pl.vertices.map(v => ({ x: v.x - pl.center.x, y: v.y - pl.center.y }));
        assert(Math.sign(winding(rel(fur))) === Math.sign(winding(rel(pyr))),
            'フラノース環の巡回の向きがピラノース環と逆');
        const libEntry = W.COMPOUNDS.find(x => x.name === 'α-D-フルクトフラノース');
        assert(libEntry, 'α-D-フルクトフラノースが compounds.json に無い');
        const libRing = libEntry.target.atoms.slice(0, 5); // 先頭5原子＝環（環内Oが先頭）
        const ref = rel(fur);
        libRing.forEach((a, i) => {
            const dx = a.x - libRing[0].x, dy = a.y - libRing[0].y;
            const mx = ref[i].x - ref[0].x, my = ref[i].y - ref[0].y;
            assert(near(dx, mx, 1) && near(dy, my, 1),
                `モジュールの頂点${i}がライブラリ図とずれる（(${mx},${my}) vs (${dx},${dy})）`);
        });

        // (4) 実際に手で描く: モジュール1回＋タップ7回で β-D-フルクトフラノースになる。
        //     置換基の座標はどこにも書かず、縦置きスナップに任せる
        g.userMolecule = new W.Molecule();
        g.placeModule('haworth-furanose', 400, 300, null);
        const ring = g.userMolecule.atoms.slice();
        const tap = (el, base, dy) => {
            g.selectedAtomType = el;
            const n0 = g.userMolecule.atoms.length;
            c.clickAt(base.x + 5, base.y + dy); // わざと横へ5pxずらす → 真上/真下へ吸着するはず
            assert(g.userMolecule.atoms.length === n0 + 1,
                `${el} を置けなかった（隣の環原子に吸われた: ${base.x},${base.y} dy=${dy}）`);
            return g.userMolecule.atoms[n0];
        };
        const c2OH = tap('O', ring[1], -40);          // アノマー C2 の -OH は上（β）
        const c1 = tap('C', ring[1], +40);            // C2 の -CH2OH は下
        const c1OH = tap('O', c1, +40);
        tap('O', ring[2], -40);                       // C3-OH 上
        tap('O', ring[3], +40);                       // C4-OH 下
        const c6 = tap('C', ring[4], -40);            // C5 の -CH2OH は上
        tap('O', c6, -40);
        const mol = g.userMolecule;
        assert(mol.atoms.length === 12 && mol.bonds.length === 12,
            `手描きフルクトフラノースが 12原子12結合でない（${mol.atoms.length}/${mol.bonds.length}）`);
        assert(near(c2OH.x, ring[1].x, 2) && c2OH.y < ring[1].y, '-OH が環炭素の真上に吸着しない');

        // 読めた立体中心は**ちょうど4個**（C2〜C5）。0個のまま緑にならないよう件数で縛る
        const par = W.readRingParityFromHaworth(mol);
        assert(Object.keys(par).length === 4,
            `手描きフラノースの読めた立体中心が ${Object.keys(par).length} 個（4を期待）`);
        assert(g.lookupCompoundName(mol) === 'β-D-フルクトフラノース',
            '手描きのフラノースが β-D-フルクトフラノースと命名されない: ' + g.lookupCompoundName(mol));

        // (5) 作図の余裕: 監査のしきい値（重原子24px・自動水素12px）を割らない。
        //     正五角形（cyclopentane）だと真下が隣の環原子から13pxしかなく、ここが破れる
        const dmin = (pts) => {
            let m = Infinity;
            for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
                const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
                if (d > 0.5) m = Math.min(m, d);
            }
            return m;
        };
        const mh = dmin(mol.atoms);
        const ma = dmin(mol.atoms.concat(mol.calculateHydrogens()));
        assert(mh >= 24, `手描きフラノースの重原子間が ${mh.toFixed(1)}px（24px以上を期待）`);
        assert(ma >= 12, `手描きフラノースの自動水素込みが ${ma.toFixed(1)}px（12px以上を期待）`);

        // (6) 否定対照その1: アノマー C2 まわりの上下を反転すると β→α になる
        const c2y = ring[1].y;
        [c2OH, c1, c1OH].forEach(a => { a.y = 2 * c2y - a.y; });
        assert(g.lookupCompoundName(mol) === 'α-D-フルクトフラノース',
            'アノマー C2 の上下反転で β→α にならない: ' + g.lookupCompoundName(mol));
        [c2OH, c1, c1OH].forEach(a => { a.y = 2 * c2y - a.y; }); // 元へ（β）
        assert(g.lookupCompoundName(mol) === 'β-D-フルクトフラノース', '反転を戻して β に復帰しない');

        // (7) 否定対照その2: C2 の2本を同じ側に描いたら面を表していない＝どちらにも一致しない
        const keepY = [c1.y, c1OH.y];
        c1.y = c2y - 40; c1OH.y = c2y - 80;
        const same = g.lookupCompoundName(mol);
        assert(same !== 'β-D-フルクトフラノース' && same !== 'α-D-フルクトフラノース',
            '面を描き分けていないフラノースが α/β に一致してしまう: ' + same);
        c1.y = keepY[0]; c1OH.y = keepY[1];

        // (8) 否定対照その3: C3-OH だけ上→下にすると別の糖になり、どのフラノースにも一致しない
        const c3OH = mol.getNeighbors(ring[2].id).map(n => n.atom).find(a => a.element === 'O' && a.y < ring[2].y);
        assert(c3OH, 'C3 の -OH が見つからない');
        c3OH.y = ring[2].y + 42;
        const other = g.lookupCompoundName(mol);
        assert(other !== 'β-D-フルクトフラノース' && other !== 'α-D-フルクトフラノース',
            'C3-OH を反転してもフルクトフラノースのままになる: ' + other);
        c3OH.y = ring[2].y - 42;
        assert(g.lookupCompoundName(mol) === 'β-D-フルクトフラノース', 'C3-OH を戻して β に復帰しない');

        // (9) 無回帰: ピラノースのモジュールと糖の命名は従来どおり
        g.userMolecule = new W.Molecule();
        g.placeModule('haworth-pyranose', 400, 300, null);
        assert(g.userMolecule.atoms.length === 6 && g.userMolecule.bonds.length === 6,
            'ピラノースモジュールの配置が無回帰でない');
        const glc = g.createTargetFromData({
            target: W.COMPOUNDS.find(x => x.name === 'β-D-グルコース（β-D-グルコピラノース）').target });
        assert(g.lookupCompoundName(glc) === 'β-D-グルコース（β-D-グルコピラノース）',
            'β-D-グルコピラノースの命名が無回帰でない');

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('ST8: 立体を名前に反映するトグル＋鎖状⇄環状の平衡（P12-7 M2e / M2d）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        const build = (name) => {
            const e = W.COMPOUNDS.find(x => x.name === name);
            assert(e, `${name} が compounds.json に無い`);
            const m = new W.Molecule();
            const ids = e.target.atoms.map(a => m.addAtom(a.element, a.x, a.y).id);
            e.target.bonds.forEach(b => m.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
            return m;
        };

        // 既定は OFF（2026-08-02 ユーザー判断。Gemini レビュー項目22）。
        // 直交で描いただけの初学者に「D-アラニン」を見せないため。
        // localStorage に保存が無い状態の既定値そのものを、ここで固定する
        // 出荷時の既定 ＝ マークアップに checked が無いこと（実行時の値は localStorage が上書きする）
        assert(c.D.getElementById('check-read-stereo').getAttribute('checked') === null,
            '「立体を名前に反映する」が既定 ON のまま（マークアップに checked が残っている）');

        // --- トグル ON: 立体が名前に出る ---
        g.setReadStereo(true);
        assert(g.lookupCompoundName(build('β-D-グルコース（β-D-グルコピラノース）')) === 'β-D-グルコース（β-D-グルコピラノース）', 'ON で β が出ない');
        // アラニンを軸配置（NH2 を左）で描くと L-アラニン
        const alanine = (nx) => {
            const m = new W.Molecule();
            const c2 = m.addAtom('C', 400, 300);
            const co = m.addAtom('C', 400, 258), o1 = m.addAtom('O', 400, 216), o2 = m.addAtom('O', 442, 258);
            const me = m.addAtom('C', 400, 342), n = m.addAtom('N', nx, 300);
            m.addBond(c2.id, co.id, 1); m.addBond(co.id, o1.id, 2); m.addBond(co.id, o2.id, 1);
            m.addBond(c2.id, me.id, 1); m.addBond(c2.id, n.id, 1);
            return m;
        };
        assert(g.lookupCompoundName(alanine(358)) === 'L-アラニン', 'ON で L-アラニンにならない');
        assert(g.lookupCompoundName(alanine(442)) === 'D-アラニン', 'ON で D-アラニンにならない');

        // --- トグル OFF: 立体を読まず総称名に落ちる ---
        g.setReadStereo(false);
        assert(g.lookupCompoundName(alanine(358)) === 'アラニン', `OFF で総称にならない（${g.lookupCompoundName(alanine(358))}）`);
        assert(g.lookupCompoundName(alanine(442)) === 'アラニン', 'OFF で D/L が残る');
        assert(W.localStorage.getItem('chemAssembler.readStereo') === '0', 'OFF 設定が保存されない');
        g.setReadStereo(true);
        assert(g.lookupCompoundName(alanine(358)) === 'L-アラニン', 'ON に戻して立体が復活しない');

        // --- 鎖状⇄環状の平衡（変旋光の道筋） ---
        const ruleById = id => W.REACTION_RULES.find(r => r.id === id);
        // β → 開環 → 鎖状
        let m = build('β-D-グルコース（β-D-グルコピラノース）');
        g.userMolecule = m; g.updateDrawing();
        let rule = ruleById('open_glucopyranose');
        let sites = rule.detect(g.userMolecule);
        assert(sites.length === 1, 'β から開環が検出されない');
        rule.apply(g, sites[0]); g.updateDrawing();
        assert(g.lookupCompoundName(g.userMolecule) === 'D-グルコース（鎖状）', '開環で鎖状にならない');
        // 鎖状 → 環化 → α（β とは別物）
        rule = ruleById('cyclize_glucose_alpha');
        sites = rule.detect(g.userMolecule);
        assert(sites.length === 1, '鎖状から環化(α)が検出されない');
        rule.apply(g, sites[0]); g.updateDrawing();
        assert(g.lookupCompoundName(g.userMolecule) === 'α-D-グルコース（α-D-グルコピラノース）', '環化でαにならない');
        // 環化(β)も同様に効く
        m = build('D-グルコース（鎖状）');
        g.userMolecule = m; g.updateDrawing();
        rule = ruleById('cyclize_glucose_beta');
        rule.apply(g, rule.detect(g.userMolecule)[0]); g.updateDrawing();
        assert(g.lookupCompoundName(g.userMolecule) === 'β-D-グルコース（β-D-グルコピラノース）', '環化でβにならない');
        // グルコース以外（乳酸）では環化ルールは出ない
        const lac = build('乳酸');
        assert(ruleById('cyclize_glucose_beta').detect(lac).length === 0, '無関係な分子で環化が検出される');

        // --- 2段階モーフィング（変化を目で追えるように。P12-7 M2f） ---
        const rx = W.reactor;
        assert(ruleById('open_glucopyranose').morphStages === 'bondsFirst', '開環が bondsFirst でない');
        assert(ruleById('cyclize_glucose_beta').morphStages === 'moveFirst', '環化が moveFirst でない');
        const snap = mm => ({
            atoms: mm.atoms.map(a => ({ id: a.id, element: a.element, x: a.x, y: a.y })),
            bonds: mm.bonds.map(b => ({ atomId1: b.atomId1, atomId2: b.atomId2, type: b.type }))
        });
        const ringM = build('β-D-グルコース（β-D-グルコピラノース）');
        const beforeSnap = snap(ringM);
        g.userMolecule = ringM; g.updateDrawing();
        const orule = ruleById('open_glucopyranose');
        orule.apply(g, orule.detect(g.userMolecule)[0]);
        const afterSnap = snap(g.userMolecule);
        // bondsFirst の中間: 結合は反応後・座標は反応前（＝環の配置のまま開いた状態）
        const midB = rx.buildMidSnapshot(beforeSnap, afterSnap, 'bondsFirst');
        assert(midB.bonds.length === afterSnap.bonds.length, '中間(bondsFirst)の結合が反応後と一致しない');
        const posSame = midB.atoms.every(a => {
            const b0 = beforeSnap.atoms.find(x => x.id === a.id);
            return b0 && Math.abs(a.x - b0.x) < 0.01 && Math.abs(a.y - b0.y) < 0.01;
        });
        assert(posSame, '中間(bondsFirst)で原子が動いてしまっている');
        // moveFirst の中間: 座標は反応後・結合は反応前（＝折りたたんだだけで環は未結合）
        const midM = rx.buildMidSnapshot(beforeSnap, afterSnap, 'moveFirst');
        assert(midM.bonds.length === beforeSnap.bonds.length, '中間(moveFirst)の結合が反応前と一致しない');
        assert(midM.atoms.every(a => {
            const af = afterSnap.atoms.find(x => x.id === a.id);
            return !af || (Math.abs(a.x - af.x) < 0.01 && Math.abs(a.y - af.y) < 0.01);
        }), '中間(moveFirst)で座標が反応後になっていない');
        // 中間状態は自動水素を計算して描く（「開いた瞬間」の水素の数・位置が正しく見える）。
        // 環化・開環は異性化なので総数は変わらないが、**どの原子に付くか**が変わる
        //（環内酸素は H を持たない → 開環すると C5 の -OH になって H が1個付く。
        //  逆にアノマーの -OH は C=O になって H が外れる）
        const hSig = mol => JSON.stringify(
            Object.entries(mol.calculateHydrogens().reduce((acc, h) => {
                acc[h.parentId] = (acc[h.parentId] || 0) + 1;
                return acc;
            }, {})).sort()
        );
        const midMol = rx.molFromSnapshot(midB);
        const beforeMol = rx.molFromSnapshot(beforeSnap);
        const afterMol = rx.molFromSnapshot(afterSnap);
        assert(midMol.calculateHydrogens().length === afterMol.calculateHydrogens().length,
            '中間状態の水素数が開環後と一致しない');
        assert(hSig(midMol) === hSig(afterMol), '中間状態の水素の付き方が開環後と一致しない');
        assert(hSig(midMol) !== hSig(beforeMol), '開環で水素の付き方が変わっていない');

        // 中間停止からの操作は、実時間のアニメーション完了を待たずに検証する
        //（rAF はタブの状態で走らないことがあり、待つとテストが止まるため。
        //  停止状態を直接組み立てて、そこからの振る舞いだけを見る）
        const maxDist = (A, B) => {
            let mx = 0;
            A.forEach(a => {
                const b = B.find(x => x.id === a.id);
                if (b) mx = Math.max(mx, Math.hypot(a.x - b.x, a.y - b.y));
            });
            return mx;
        };
        const makePause = (midSnap, afterSnap2) => {
            rx._morphing = true;
            rx._morphSkip = false;
            rx._morphPause = { mid: midSnap, after: afterSnap2, gen: rx._morphGen, highlight: () => {} };
        };

        // (1) 中間停止中のクリックは「スキップ」ではなく「第2段階へ進む」として消費される
        g.userMolecule = build('β-D-グルコース（β-D-グルコピラノース）'); g.updateDrawing();
        makePause(midB, afterSnap);
        assert(rx.skipMorph() === true, '中間停止中のクリックが消費されない');
        assert(!rx._morphPause, 'クリックで停止状態が解除されない');
        rx.finalizeMorph();

        // (2) 停止中に次の反応を実行したら、**画面に見えている中間の配置**から変化が始まる
        //     （内部で確定済みの整列後の座標から始まると、見えている図と繋がらない）
        const ringMol = build('β-D-グルコース（β-D-グルコピラノース）');
        const ringPos = ringMol.atoms.map(a => ({ id: a.id, x: a.x, y: a.y }));
        g.userMolecule = ringMol; g.updateDrawing();
        const beforeSnap2 = snap(ringMol); // 環の配置（この分子の原子IDで）
        const orule3 = ruleById('open_glucopyranose');
        orule3.apply(g, orule3.detect(g.userMolecule)[0]); // 開環（データは整列後に確定）
        g.updateDrawing();
        const afterSnap2 = snap(g.userMolecule);
        assert(maxDist(g.userMolecule.atoms, ringPos) > 100, '開環後の内部座標が整列後になっていない');
        // 「環の配置のまま開いた図」で停止している状態を作る（同じ分子の原子IDで作ること）
        makePause(rx.buildMidSnapshot(beforeSnap2, afterSnap2, 'bondsFirst'), afterSnap2);
        const crule = ruleById('cyclize_glucose_beta');
        const csites = crule.detect(g.userMolecule);
        assert(csites.length === 1, '停止中に環化が検出されない');
        rx.execute(crule, csites[0]); // execute の冒頭で adoptPausedLayout が働く
        assert(maxDist(rx.lastReaction.before.atoms, ringPos) < 1,
            '環化が見えている中間の配置から始まっていない');
        rx.finalizeMorph();
        assert(g.lookupCompoundName(g.userMolecule) === 'β-D-グルコース（β-D-グルコピラノース）', '停止中からの環化でβに戻らない');

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('ST9: 疑似3D回転ビューア（P12-7 M3・描いた立体との一致／鏡像モード）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const sv = W.stereoView;
        assert(sv, 'stereoView が初期化されていない');
        assert(typeof W.tetrahedralDirs === 'function' && typeof W.parityFromDirs === 'function',
            'tetrahedralDirs / parityFromDirs が公開されていない');

        // フィッシャー投影の乳酸 HOOC-CHOH-CH3（中心=C2）。ohDx>0 で OH 右・<0 で左。
        // ohDy を与えると斜め＝立体未指定になる。
        const buildLactate = (ohDx, ohDy) => {
            const m = new W.Molecule();
            const c1 = m.addAtom('C', 400, 258); // COOH の C（sp2）
            const c2 = m.addAtom('C', 400, 300); // 不斉中心
            const c3 = m.addAtom('C', 400, 342); // CH3
            const od = m.addAtom('O', 400, 216);
            const os = m.addAtom('O', 442, 258);
            const oh = m.addAtom('O', 400 + ohDx, 300 + (ohDy || 0));
            m.addBond(c1.id, c2.id, 1); m.addBond(c2.id, c3.id, 1);
            m.addBond(c1.id, od.id, 2); m.addBond(c1.id, os.id, 1);
            m.addBond(c2.id, oh.id, 1);
            return { m, center: c2.id };
        };
        // UI 経由で 3D ビューを開く（btn-stereo → 中心をクリック → 3Dタブ）
        const open3d = (mol, centerId) => {
            c.game.userMolecule = mol;
            c.game.updateDrawing();
            // 立体表示ボタンは中心を自動で選んで開くので、狙った中心へは
            // 「別の炭素を選ぶ」から切り替える（P12-8 で入り口を変更）
            D.getElementById('btn-stereo').click();
            D.getElementById('btn-stereo-pick').click();
            const a = mol.atoms.find(x => x.id === centerId);
            c.clickAt(a.x, a.y);
            assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体モーダルが開かない');
            D.getElementById('btn-stereo-tab-3d').click();
            assert(!D.getElementById('stereo-pane-3d').classList.contains('hidden'), '3Dペインが表示されない');
            assert(D.getElementById('stereo-pane-wedge').classList.contains('hidden'), 'くさび図ペインが隠れない');
            sv.setAutoRotate(false); // 検証中は自動回転を止める（角度を明示制御）
        };
        const wedgeLabels = () => [...D.querySelectorAll('#stereo-svg text')].map(t => t.textContent);

        // (a) 描いた立体（OH 右）と 3D 配置のパリティが一致する
        const d = buildLactate(42);
        const pD = W.readAtomParityFromFischer(d.m)[d.center];
        assert(pD === 1 || pD === -1, `乳酸のパリティが読めない（${pD}）`);
        open3d(d.m, d.center);
        assert(sv._parity === pD, `ビューが読み取りパリティを持っていない（${sv._parity} vs ${pD}）`);
        assert(W.parityFromDirs(sv._dirs) === pD, '3D配置のパリティが描いた立体と一致しない');
        assert(W.parityFromDirs(sv._drawn.left) === pD, '描画に使われた配置のパリティが一致しない');
        assert(sv._drawn.right === null, '鏡像モードでないのに2枚目が描かれている');
        assert(D.querySelectorAll('#stereo-3d-svg circle').length === 1 &&
               D.querySelectorAll('#stereo-3d-svg ellipse').length === 4, '中心＋置換基4個が描かれない');
        assert(D.getElementById('stereo-caption').textContent.includes('あなたが描いた立体を反映しています'),
            '立体が読めたのに「一例」注記のままになっている');
        assert(wedgeLabels().length === 5, 'くさび図（従来どおりの一例配置）が描かれていない');

        // (b) どの角度に回してもパリティは不変（回転＝行列式+1）
        [[0.7, 0.4], [2.1, -1.3], [-0.9, 3.0]].forEach(([yaw, pitch]) => {
            sv.rotateBy(yaw, pitch);
            assert(W.parityFromDirs(sv._drawn.left) === pD,
                `回転（${yaw},${pitch}）でパリティが変わった`);
        });
        assert(sv.angleX !== 0 || sv.angleY !== 0, '回転が角度に反映されていない');
        D.getElementById('btn-stereo-reset').click();
        assert(sv.angleX === 0 && sv.angleY === 0, '「正面に戻す」で角度がリセットされない');

        // (c) 鏡像モード: 左右のパリティが逆・図が2枚
        D.getElementById('btn-stereo-mirror').click();
        assert(sv.mirror, '鏡像モードにならない');
        assert(W.parityFromDirs(sv._drawn.left) === pD, '鏡像モードで元の分子のパリティが変わった');
        assert(W.parityFromDirs(sv._drawn.right) === -pD, '鏡像のパリティが反転していない');
        assert(D.querySelectorAll('#stereo-3d-svg circle').length === 2 &&
               D.querySelectorAll('#stereo-3d-svg ellipse').length === 8, '鏡像モードで2枚分描かれない');
        sv.rotateBy(1.1, 0.5); // 同じ操作で同時に回しても関係は保たれる
        assert(W.parityFromDirs(sv._drawn.left) === pD &&
               W.parityFromDirs(sv._drawn.right) === -pD, '同時回転でパリティ関係が崩れた');
        assert(D.getElementById('stereo-3d-note').textContent.includes('鏡像異性体'),
            '不斉中心で「重ね合わせられません」の説明が出ない');
        D.getElementById('btn-stereo-close').click();
        assert(sv._raf === null, 'モーダルを閉じても自動回転のループが止まっていない');

        // (d) 鏡像に描いた乳酸（OH 左）は 3D 配置も逆のパリティになる（＝別の分子として表示される）
        const l = buildLactate(-42);
        assert(W.readAtomParityFromFischer(l.m)[l.center] === -pD, 'OH 左でパリティが反転しない');
        open3d(l.m, l.center);
        assert(W.parityFromDirs(sv._dirs) === -pD, '鏡像に描いた分子の3D配置が反転していない');
        assert(W.parityFromDirs(sv._drawn.left) === -pD, '描画に使われた配置が反転していない');
        D.getElementById('btn-stereo-close').click();

        // (e) 立体未指定（OH を斜めに描く）ではその旨を明示し、嘘の立体を断定しない
        const off = buildLactate(30, -30);
        assert(W.readAtomParityFromFischer(off.m)[off.center] === undefined, '斜めなのに立体が読めている');
        open3d(off.m, off.center);
        assert(sv._parity === null, '立体未指定なのにパリティを持っている');
        assert(D.getElementById('stereo-3d-note').textContent.includes('立体が指定されていません'),
            '立体未指定の注意書きが出ない');
        assert(!D.getElementById('stereo-caption').textContent.includes('あなたが描いた立体を反映しています') &&
               D.getElementById('stereo-caption').textContent.includes('一例'),
            '立体未指定なのに「あなたが描いた立体」と断定している');
        assert(D.querySelectorAll('#stereo-3d-svg circle').length === 1 &&
               D.querySelectorAll('#stereo-3d-svg ellipse').length === 4, '立体未指定でも既定配置で描かれる');
        D.getElementById('btn-stereo-close').click();

        // (f) 不斉でない中心（メタン）: 鏡像は重なると説明する
        const me = new W.Molecule();
        const meC = me.addAtom('C', 400, 300);
        open3d(me, meC.id);
        assert(sv._dirs && sv._dirs.length === 4, '不斉でない中心で既定配置が作られない');
        D.getElementById('btn-stereo-mirror').click();
        assert(D.getElementById('stereo-3d-note').textContent.includes('不斉ではないので'),
            'メタンで「回すと重なります」の説明が出ない');
        D.getElementById('btn-stereo-mirror').click(); // 片付け（次回の既定に影響しないことの確認も兼ねる）
        assert(!sv.mirror, '鏡像モードを解除できない');

        // (g) 自動回転トグル: ON でループが回り、OFF で止まる
        sv.setAutoRotate(true);
        assert(sv._raf !== null, '自動回転 ON でループが始まらない');
        assert(D.getElementById('btn-stereo-spin').textContent.includes('止める'), 'ボタン表示が ON 状態にならない');
        sv.setAutoRotate(false);
        assert(sv._raf === null, '自動回転 OFF でループが止まらない');
        D.getElementById('btn-stereo-close').click();
        c.game.userMolecule = new W.Molecule();
        c.game.updateDrawing();
    });

    test('ST10: くさび図のフィッシャー準拠化＋結合を軸にした回転（P12-8）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const sv = W.stereoView;
        assert(sv, 'stereoView が初期化されていない');
        assert(typeof W.fischerSlots === 'function', 'fischerSlots が公開されていない');

        // ST9 と同じ乳酸 HOOC-CHOH-CH3（中心=C2）。ohDx>0 で OH 右・<0 で左・ohDy 付きで斜め
        const buildLactate = (ohDx, ohDy) => {
            const m = new W.Molecule();
            const c1 = m.addAtom('C', 400, 258);
            const c2 = m.addAtom('C', 400, 300);
            const c3 = m.addAtom('C', 400, 342);
            const od = m.addAtom('O', 400, 216);
            const os = m.addAtom('O', 442, 258);
            const oh = m.addAtom('O', 400 + ohDx, 300 + (ohDy || 0));
            m.addBond(c1.id, c2.id, 1); m.addBond(c2.id, c3.id, 1);
            m.addBond(c1.id, od.id, 2); m.addBond(c1.id, os.id, 1);
            m.addBond(c2.id, oh.id, 1);
            return { m, center: c2.id };
        };
        const openStereo = (mol, centerId) => {
            c.game.userMolecule = mol;
            c.game.updateDrawing();
            // 立体表示ボタンは中心を自動で選んで開くので、狙った中心へは
            // 「別の炭素を選ぶ」から切り替える（P12-8 で入り口を変更）
            D.getElementById('btn-stereo').click();
            D.getElementById('btn-stereo-pick').click();
            const a = mol.atoms.find(x => x.id === centerId);
            c.clickAt(a.x, a.y);
            assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体モーダルが開かない');
        };
        // くさび図のスロット別ラベル（data-slot 属性）と結合の描き方
        const slotLabel = (slot) => {
            const t = D.querySelector(`#stereo-svg text[data-slot="${slot}"]`);
            return t ? t.textContent : null;
        };
        const bondKind = (slot) => {
            const el = D.querySelector(`#stereo-svg [data-slot="${slot}"][data-bond]`);
            return el ? { kind: el.getAttribute('data-bond'), tag: el.tagName.toLowerCase() } : null;
        };

        // (a) 縦＝破線くさび（ハッシュ）・横＝塗りくさび、というフィッシャーの規約で描かれている
        const d = buildLactate(42);
        openStereo(d.m, d.center);
        ['up', 'down'].forEach(s => {
            const b = bondKind(s);
            assert(b && b.kind === 'hash' && b.tag === 'g', `${s} が破線くさび（ハッシュ）で描かれていない`);
        });
        ['left', 'right'].forEach(s => {
            const b = bondKind(s);
            assert(b && b.kind === 'wedge' && b.tag === 'polygon', `${s} が塗りくさびで描かれていない`);
        });
        assert(slotLabel('center') === 'C', '中心に C が描かれていない');

        // (b) 描いた向きのまま配置される（OH 右 → 右スロットが OH・左スロットが H）
        const slotsR = W.fischerSlots(d.m, d.center);
        assert(slotsR, '軸方向に描いた乳酸のスロットが読めない');
        assert(sv._slots && sv._slots.right === slotsR.right, 'ビューが fischerSlots の結果を保持していない');
        const rightR = slotLabel('right'), leftR = slotLabel('left');
        assert(rightR === 'OH', `OH を右に描いたのに右スロットが「${rightR}」`);
        assert(leftR === 'H', `OH を右に描いたのに左スロットが「${leftR}」`);
        const upR = slotLabel('up'), downR = slotLabel('down');
        const cap = D.getElementById('stereo-caption').textContent;
        assert(cap.includes('あなたが描いた向きのまま'), '描いた向きのままである旨の説明がない');
        assert(cap.includes('あなたが描いた立体を反映しています'), '立体が読めたのに反映の説明がない');
        D.getElementById('btn-stereo-close').click();

        // (c) 鏡像に描く（OH 左）と、くさび図の左右スロットの中身が入れ替わる
        const l = buildLactate(-42);
        openStereo(l.m, l.center);
        assert(slotLabel('right') === leftR && slotLabel('left') === rightR,
            `OH を左に描いても左右が入れ替わらない（右=${slotLabel('right')} / 左=${slotLabel('left')}）`);
        assert(slotLabel('up') === upR && slotLabel('down') === downR, '左右の描き分けで縦のスロットまで変わった');
        D.getElementById('btn-stereo-close').click();

        // (d) 斜め描き（立体未指定）は「一例」であることを明示し、嘘の立体を断定しない
        const off = buildLactate(30, -30);
        assert(W.fischerSlots(off.m, off.center) === null, '斜めなのにスロットが読めている');
        openStereo(off.m, off.center);
        assert(sv._slots === null, '立体未指定なのにスロットを持っている');
        const capOff = D.getElementById('stereo-caption').textContent;
        assert(capOff.includes('一例'), '立体未指定で「一例」の断り書きが出ない');
        assert(!capOff.includes('あなたが描いた立体を反映しています'),
            '立体未指定なのに「あなたが描いた立体」と断定している');
        assert(D.querySelectorAll('#stereo-svg polygon').length === 2, '一例表示でもフィッシャー様式で描かれる');
        D.getElementById('btn-stereo-close').click();

        // (e) 結合を軸にした回転: 軸上の置換基は不変・残り3つは動く・パリティも不変
        const d2 = buildLactate(42);
        const pD = W.readAtomParityFromFischer(d2.m)[d2.center];
        openStereo(d2.m, d2.center);
        D.getElementById('btn-stereo-tab-3d').click();
        sv.setAutoRotate(false);
        assert(D.getElementById('btn-stereo-axis-screen'), '回転軸「画面」のボタンがない');
        assert(D.querySelectorAll('#stereo-axis-row .stereo-axis-btn').length === 5,
            '回転軸のボタンが「画面」＋結合4本になっていない');
        assert(D.getElementById('btn-stereo-axis-screen').classList.contains('active'),
            '既定で「画面」基準になっていない');
        // 軸ボタンには置換基名が入る（分かりやすさのため）
        const axisBtnLabels = [...D.querySelectorAll('#stereo-axis-row .stereo-axis-btn')]
            .slice(1).map(b => b.textContent);
        assert(axisBtnLabels.includes('OH'), `軸ボタンに置換基名が出ていない（${axisBtnLabels.join(',')}）`);

        const ohIdx = axisBtnLabels.indexOf('OH'); // ボタン列の並びは _dirs の並びと一致
        assert(sv._dirs[ohIdx] && sv.labelOf(sv._dirs[ohIdx].ref) === 'OH', '軸ボタンの並びが _dirs と対応していない');
        D.getElementById('btn-stereo-axis-' + ohIdx).click();
        assert(sv.axisIndex === ohIdx, '軸ボタンで axisIndex が設定されない');
        assert(D.getElementById('btn-stereo-axis-' + ohIdx).classList.contains('active'), '選択中の軸が強調されない');
        // 強調色が実際に解決されること（未定義のCSS変数を使うと stroke:none になり線が消える）
        const strokes = [...D.querySelectorAll('#stereo-3d-svg line, #stereo-3d-svg ellipse, #stereo-3d-svg circle')]
            .map(el => W.getComputedStyle(el).stroke);
        assert(strokes.length > 0 && strokes.every(s => s && s !== 'none'),
            `3D図に色が解決されない要素がある（未定義のCSS変数？ ${strokes.join(' / ')}）`);

        const snap = () => sv._drawn.left.map(x => x.v.slice());
        const before = snap();
        sv.rotateBy(1.2, 0.4); // 横ドラッグ相当（軸モードでは結合まわりの回転になる）
        const after = snap();
        const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        assert(sv.axisAngle !== 0, '軸まわりの回転角が動いていない');
        assert(dist(before[ohIdx], after[ohIdx]) < 1e-9,
            `軸に選んだ結合（OH）の向きが回転で動いた（${dist(before[ohIdx], after[ohIdx])}）`);
        before.forEach((v, i) => {
            if (i === ohIdx) return;
            assert(dist(v, after[i]) > 0.1, `軸以外の置換基 #${i} が動いていない`);
        });
        assert(W.parityFromDirs(sv._drawn.left) === pD, '結合軸まわりの回転でパリティが変わった（＝別の分子になった）');
        assert(D.getElementById('stereo-3d-note').textContent.includes('回転では鏡像になりません'),
            '「結合を軸に回しても同じ分子」の説明が出ない');

        // (f) 鏡像モードでも軸上の置換基は固定され、鏡像関係（パリティ反転）は保たれる
        D.getElementById('btn-stereo-mirror').click();
        const mBefore = sv._drawn.right.map(x => x.v.slice());
        sv.rotateBy(0.9, 0);
        const mAfter = sv._drawn.right.map(x => x.v.slice());
        assert(dist(mBefore[ohIdx], mAfter[ohIdx]) < 1e-9, '鏡像側で軸上の置換基が動いた');
        assert(W.parityFromDirs(sv._drawn.left) === pD && W.parityFromDirs(sv._drawn.right) === -pD,
            '結合軸回転で鏡像関係が崩れた');
        D.getElementById('btn-stereo-mirror').click();

        // (g) 「画面」に戻すと従来どおりのドラッグ（角度が動く）に戻る
        D.getElementById('btn-stereo-axis-screen').click();
        assert(sv.axisIndex === null && sv.axisAngle === 0, '画面基準に戻らない');
        sv.rotateBy(0.5, 0.3);
        assert(sv.angleX !== 0 && sv.angleY !== 0, '画面基準でドラッグが角度に反映されない');
        D.getElementById('btn-stereo-reset').click();
        assert(sv.angleX === 0 && sv.angleY === 0, '「正面に戻す」で角度がリセットされない');
        D.getElementById('btn-stereo-close').click();
        c.game.userMolecule = new W.Molecule();
        c.game.updateDrawing();
    });

    test('ST11: くさび図のローテーション（パリティ保存）＋鏡像比較（P12-8）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const sv = W.stereoView;
        assert(sv, 'stereoView が初期化されていない');
        assert(typeof W.parityFromDirs === 'function' && typeof W.rootedFragmentCode === 'function',
            'parityFromDirs / rootedFragmentCode が公開されていない');

        const SLOTS = ['up', 'right', 'down', 'left'];
        // フィッシャー投影の規約どおりの3Dベクトル（縦=紙面の奥・横=紙面の手前）。
        // これでスロット割り当てのパリティ（手性）を stereo.js とは独立に計算し、
        // 並べ替えの前後で不変であることを機械検証する（誤って鏡像にすり替わっていないか）
        const DIRS = { up: [0, -1, -1], right: [1, 0, 1], down: [0, 1, -1], left: [-1, 0, 1] };
        const slotParity = (mol, centerId, slots) => W.parityFromDirs(SLOTS.map(k => ({
            ref: slots[k],
            code: slots[k] === 'H' ? 'H' : W.rootedFragmentCode(mol, slots[k], centerId),
            v: DIRS[k]
        })));
        const contents = (slots) => SLOTS.map(k => String(slots[k])).sort().join(',');

        // 乳酸 HOOC-CHOH-CH3（中心=C2・不斉）。ohDy を与えると斜め＝立体未指定
        const buildLactate = (ohDx, ohDy) => {
            const m = new W.Molecule();
            const c1 = m.addAtom('C', 400, 258);
            const c2 = m.addAtom('C', 400, 300);
            const c3 = m.addAtom('C', 400, 342);
            const od = m.addAtom('O', 400, 216);
            const os = m.addAtom('O', 442, 258);
            const oh = m.addAtom('O', 400 + ohDx, 300 + (ohDy || 0));
            m.addBond(c1.id, c2.id, 1); m.addBond(c2.id, c3.id, 1);
            m.addBond(c1.id, od.id, 2); m.addBond(c1.id, os.id, 1);
            m.addBond(c2.id, oh.id, 1);
            return { m, center: c2.id };
        };
        const openStereo = (mol, centerId) => {
            c.game.userMolecule = mol;
            c.game.updateDrawing();
            // 立体表示ボタンは中心を自動で選んで開くので、狙った中心へは
            // 「別の炭素を選ぶ」から切り替える（P12-8 で入り口を変更）
            D.getElementById('btn-stereo').click();
            D.getElementById('btn-stereo-pick').click();
            const a = mol.atoms.find(x => x.id === centerId);
            c.clickAt(a.x, a.y);
            assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体モーダルが開かない');
        };
        // くさび図のスロットをクリック（透明の当たり判定 rect を叩く）
        const clickSlot = (pane, slot) => {
            const hit = D.querySelector(`#stereo-svg [data-pane="${pane}"] rect[data-slot="${slot}"]`);
            assert(hit, `${pane} ペインの ${slot} にクリック領域がない`);
            hit.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
        };
        const paneLabel = (pane, slot) => {
            const t = D.querySelector(`#stereo-svg [data-pane="${pane}"] text[data-slot="${slot}"]`);
            return t ? t.textContent : null;
        };

        // (a) 4方向どれをクリックしても、その置換基が up に来る／パリティは不変
        const d = buildLactate(42);
        openStereo(d.m, d.center);
        const base = Object.assign({}, sv._viewSlots);
        assert(base && base.up && base.right, 'くさび図のスロット状態（_viewSlots）が初期化されていない');
        const p0 = slotParity(d.m, d.center, base);
        assert(p0 === 1 || p0 === -1, `初期配置のパリティが読めない（${p0}）`);
        const baseContents = contents(base);
        assert(D.getElementById('stereo-wedge-note').textContent.includes('クリック'),
            'クリックで並べ替えられることの案内がない');
        assert(D.querySelector('#stereo-svg .wedge-slot.clickable'),
            'クリックできる見た目（clickable クラス）が付いていない');

        SLOTS.forEach(target => {
            D.getElementById('btn-stereo-wedge-reset').click();
            const want = sv._viewSlots[target]; // 上に来るはずの置換基
            clickSlot('left', target);
            assert(sv._viewSlots.up === want,
                `${target} をクリックしてもその置換基が上に来ない`);
            assert(contents(sv._viewSlots) === baseContents,
                `${target} の並べ替えで置換基の顔ぶれが変わった`);
            assert(slotParity(d.m, d.center, sv._viewSlots) === p0,
                `${target} の並べ替えでパリティが変わった（＝表示中の分子が鏡像にすり替わっている）`);
            assert(sv.wedgeParity('left') === p0, `${target} の並べ替えで内部のパリティ判定が変わった`);
            assert(paneLabel('left', 'up') === sv.labelOf(want), `${target} の並べ替えが描画に反映されない`);
        });
        // 続けて何度並べ替えてもパリティは不変（偶置換の合成は偶置換）
        ['right', 'down', 'left', 'right', 'down'].forEach(s => {
            clickSlot('left', s);
            assert(slotParity(d.m, d.center, sv._viewSlots) === p0, `連続の並べ替え（${s}）でパリティが変わった`);
        });
        assert(D.getElementById('stereo-wedge-note').textContent.includes('この操作では分子は変わりません'),
            '並べ替え後に「分子は変わりません」の明示が出ない');

        // (b) 「元の並びに戻す」で描いたときの配置に戻る
        clickSlot('left', 'down');
        assert(sv._viewSlots.up !== base.up, '並べ替えが効いていない（前提が崩れている）');
        D.getElementById('btn-stereo-wedge-reset').click();
        assert(SLOTS.every(k => sv._viewSlots[k] === base[k]),
            `「元の並びに戻す」で元配置に戻らない（${SLOTS.map(k => k + '=' + sv._viewSlots[k]).join(' ')}）`);
        assert(paneLabel('left', 'right') === 'OH', '元に戻したときの描画が元配置になっていない');

        // (c) 鏡像ペイン: 左右のパリティが逆・2枚並ぶ・鏡像側でも並べ替えできる
        D.getElementById('btn-stereo-wedge-mirror').click();
        assert(sv.wedgeMirror, 'くさび図の鏡像モードにならない');
        assert(D.querySelectorAll('#stereo-svg [data-pane]').length === 2, 'くさび図が2枚並ばない');
        assert(D.querySelectorAll('#stereo-svg polygon').length === 4, '2枚分の塗りくさびが描かれない');
        assert(paneLabel('right', 'left') === paneLabel('left', 'right') &&
               paneLabel('right', 'right') === paneLabel('left', 'left'),
            '鏡像ペインで左右が入れ替わっていない');
        assert(slotParity(d.m, d.center, sv._viewSlots) === p0, '鏡像モードで元の分子のパリティが変わった');
        assert(slotParity(d.m, d.center, sv._mirrorSlots) === -p0, '鏡像のパリティが反転していない');
        const mNote = D.getElementById('stereo-wedge-note').textContent;
        assert(mNote.includes('1回の入れ替えで鏡像'), 'くさび図の鏡像の作り方（1回の入れ替え）の説明がない');
        assert(mNote.includes('鏡像の関係'), '不斉炭素で鏡像異性体である旨の説明が出ない');
        // 両方のペインを並べ替えても、左右のパリティ関係（逆のまま）は保たれる
        ['right', 'down', 'left'].forEach(s => {
            clickSlot('right', s);
            clickSlot('left', s);
            assert(slotParity(d.m, d.center, sv._viewSlots) === p0 &&
                   slotParity(d.m, d.center, sv._mirrorSlots) === -p0,
                `両ペインの並べ替え（${s}）で鏡像関係が崩れた`);
        });
        assert(sv.wedgeParity('right') === -sv.wedgeParity('left'), '内部のパリティ判定で鏡像関係が崩れた');
        D.getElementById('btn-stereo-wedge-mirror').click();
        assert(!sv.wedgeMirror && D.querySelectorAll('#stereo-svg [data-pane]').length === 1,
            'くさび図の鏡像モードを解除できない');
        D.getElementById('btn-stereo-close').click();

        // (d) 鏡像に描いた乳酸（OH 左）は、くさび図の初期配置のパリティも反転する
        const l = buildLactate(-42);
        openStereo(l.m, l.center);
        assert(slotParity(l.m, l.center, sv._viewSlots) === -p0,
            'OH を左に描いてもくさび図のパリティが反転しない');
        D.getElementById('btn-stereo-close').click();

        // (e) 不斉でない中心（2-プロパノール）では「並べ替えても同じ分子」と出し分ける
        const ip = new W.Molecule();
        const i1 = ip.addAtom('C', 400, 258);
        const i2 = ip.addAtom('C', 400, 300);
        const i3 = ip.addAtom('C', 400, 342);
        const io = ip.addAtom('O', 442, 300);
        ip.addBond(i1.id, i2.id, 1); ip.addBond(i2.id, i3.id, 1); ip.addBond(i2.id, io.id, 1);
        assert(!ip.isAsymmetricCarbon(i2.id), '2-プロパノールの中心が不斉扱いになっている（前提が崩れている）');
        openStereo(ip, i2.id);
        assert(sv._viewSlots, '不斉でない中心でもフィッシャーのスロットは読める想定');
        D.getElementById('btn-stereo-wedge-mirror').click();
        assert(D.getElementById('stereo-wedge-note').textContent.includes('不斉ではないので'),
            '不斉でない中心で「並べ替えても同じ分子です」の出し分けがない');
        D.getElementById('btn-stereo-close').click();

        // (f) 立体未指定（斜め描き）でも**仮の立体で操作できる**（項目23。2026-08-02 で方針変更）。
        // 以前はここで全ボタンを無効にしていたが、フィッシャーの作図規約を知らない初学者が
        // 立体学習の入口に入れなくなっていた。**仮であることを文で明示**したうえで解放する
        const off = buildLactate(30, -30);
        openStereo(off.m, off.center);
        assert(sv._viewSlots && sv._provisional === true, '立体未指定に仮の立体が当たっていない');
        assert(!D.getElementById('btn-stereo-wedge-mirror').disabled &&
               !D.getElementById('btn-stereo-wedge-reset').disabled,
            '立体未指定でくさび図の操作ボタンが無効のまま（項目23 の直しが効いていない）');
        const noteOff = D.getElementById('stereo-wedge-note').textContent;
        assert(noteOff.includes('仮の立体'), '「仮の立体」であることの断りが出ない');
        const upOff = paneLabel('left', 'up');
        clickSlot('left', 'down');
        assert(paneLabel('left', 'up') !== upOff, '仮の立体でも並べ替えられるはず');

        // (e) 上を固定して残り3つを巡回（P12-8 追加。R/S 学習の土台）
        //     3巡回は偶置換なのでパリティ不変＝分子は変わらない。cw/ccw どちらも可で、
        //     同じ向きに3回で元の並びに戻る（位数3）
        const dc = buildLactate(42);
        openStereo(dc.m, dc.center);
        const cyc0 = Object.assign({}, sv._viewSlots);
        const pc0 = slotParity(dc.m, dc.center, cyc0);
        const sameArrangement = (a, b) => SLOTS.every(k => a[k] === b[k]);
        ['cw', 'ccw'].forEach(dir => {
            let prev = Object.assign({}, sv._viewSlots);
            for (let i = 1; i <= 3; i++) {
                assert(sv.cycleWedge(dir) !== false, `${dir} の巡回が実行できない`);
                assert(sv._viewSlots.up === cyc0.up, `${dir} の巡回で上の枝が動いてしまった`);
                assert(contents(sv._viewSlots) === contents(cyc0), `${dir} の巡回で置換基の集合が変わった`);
                assert(slotParity(dc.m, dc.center, sv._viewSlots) === pc0,
                    `${dir} を${i}回で分子が変わってしまった（パリティ反転＝鏡像にすり替わり）`);
                if (i < 3) assert(!sameArrangement(sv._viewSlots, prev), `${dir} の巡回で並びが変わっていない`);
                prev = Object.assign({}, sv._viewSlots);
            }
            assert(sameArrangement(sv._viewSlots, cyc0), `${dir} を3回で元の並びに戻らない（3巡回の位数）`);
        });
        // cw と ccw は互いに逆（cw のあと ccw で元に戻る）
        sv.cycleWedge('cw');
        sv.cycleWedge('ccw');
        assert(sameArrangement(sv._viewSlots, cyc0), 'cw のあと ccw で元に戻らない');
        // 上の枝のクリックでも巡回する（クリック＝cw）
        const beforeClick = Object.assign({}, sv._viewSlots);
        clickSlot('left', 'up');
        assert(sv._viewSlots.up === beforeClick.up, '上をクリックしたら上の枝が動いた');
        assert(!sameArrangement(sv._viewSlots, beforeClick), '上をクリックしても巡回しない');
        assert(slotParity(dc.m, dc.center, sv._viewSlots) === pc0, '上クリックの巡回で分子が変わった');
        assert(D.getElementById('stereo-wedge-note').textContent.includes('R/S'),
            '巡回が R/S の考え方に繋がることの説明が出ない');

        // (f) 移動アニメの補間（純関数）と、回転方向の明示（弧矢印）。P12-8 ユーザー要望
        //     アニメ本体は rAF 依存でテスト環境では駒送りされないため、補間だけを決定的に検証する
        const SV = sv.constructor;
        assert(typeof SV.wedgeTweenOffset === 'function', 'wedgeTweenOffset（補間の純関数）が無い');
        const A = { lx: 96, ly: 5 }, B = { lx: 0, ly: 88 };
        const o0 = SV.wedgeTweenOffset(A, B, 0);
        const o1 = SV.wedgeTweenOffset(A, B, 1);
        const oM = SV.wedgeTweenOffset(A, B, 0.5);
        assert(Math.abs(o0.dx - (A.lx - B.lx)) < 0.01 && Math.abs(o0.dy - (A.ly - B.ly)) < 0.01,
            'アニメ開始時（e=0）に元のスロット位置から始まっていない');
        assert(Math.hypot(o1.dx, o1.dy) < 0.01, 'アニメ終了時（e=1）に最終位置へ収まっていない');
        const straightX = (A.lx - B.lx) * 0.5, straightY = (A.ly - B.ly) * 0.5;
        assert(Math.hypot(oM.dx - straightX, oM.dy - straightY) > 5,
            '中間で弧に膨らんでいない（直線移動だと中心を横切って見分けづらい）');
        // 回転方向の弧矢印: cw / ccw で向きが切り替わり、上へ持ってくる操作では消える
        sv.resetWedge();
        assert(!D.querySelector('#stereo-svg [data-cycle-arrow]'), 'リセット直後に方向矢印が残っている');
        sv.cycleWedge('cw');
        const arrowCw = D.querySelector('#stereo-svg [data-cycle-arrow]');
        assert(arrowCw && arrowCw.getAttribute('data-cycle-arrow') === 'cw', 'cw の方向矢印が出ない');
        assert((D.querySelector('#stereo-svg [data-cycle-arrow] text') || {}).textContent.includes('右回り'),
            '方向の説明（右回り）が出ない');
        sv.cycleWedge('ccw');
        assert(D.querySelector('#stereo-svg [data-cycle-arrow]').getAttribute('data-cycle-arrow') === 'ccw',
            'ccw の方向矢印に切り替わらない');
        clickSlot('left', 'down'); // 上へ持ってくる操作＝巡回ではない
        assert(!D.querySelector('#stereo-svg [data-cycle-arrow]'),
            '巡回でない並べ替えのあとも方向矢印が残っている');
        D.getElementById('btn-stereo-close').click();
        c.game.userMolecule = new W.Molecule();
        c.game.updateDrawing();
    });

    test('ST12: 鏡像ペアの配置モード切替（3Dの軸そろえ／くさび図の並びそろえ・P12-8）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const sv = W.stereoView;
        assert(sv, 'stereoView が初期化されていない');
        const SV = sv.constructor;
        const SLOTS = ['up', 'right', 'down', 'left'];
        // ST11 と同じ「stereo.js とは独立に」パリティを計算する道具（鏡像性の機械検証用）
        const DIRS = { up: [0, -1, -1], right: [1, 0, 1], down: [0, 1, -1], left: [-1, 0, 1] };
        const slotParity = (mol, centerId, slots) => W.parityFromDirs(SLOTS.map(k => ({
            ref: slots[k],
            code: slots[k] === 'H' ? 'H' : W.rootedFragmentCode(mol, slots[k], centerId),
            v: DIRS[k]
        })));
        const codeOf = (mol, centerId, ref) =>
            (ref === 'H' || ref === undefined || ref === null) ? 'H' : W.rootedFragmentCode(mol, ref, centerId);

        const buildLactate = (ohDx) => {
            const m = new W.Molecule();
            const c1 = m.addAtom('C', 400, 258);
            const c2 = m.addAtom('C', 400, 300);
            const c3 = m.addAtom('C', 400, 342);
            const od = m.addAtom('O', 400, 216);
            const os = m.addAtom('O', 442, 258);
            const oh = m.addAtom('O', 400 + ohDx, 300);
            m.addBond(c1.id, c2.id, 1); m.addBond(c2.id, c3.id, 1);
            m.addBond(c1.id, od.id, 2); m.addBond(c1.id, os.id, 1);
            m.addBond(c2.id, oh.id, 1);
            return { m, center: c2.id };
        };
        const openStereo = (mol, centerId) => {
            c.game.userMolecule = mol;
            c.game.updateDrawing();
            // 立体表示ボタンは中心を自動で選んで開くので、狙った中心へは
            // 「別の炭素を選ぶ」から切り替える（P12-8 で入り口を変更）
            D.getElementById('btn-stereo').click();
            D.getElementById('btn-stereo-pick').click();
            const a = mol.atoms.find(x => x.id === centerId);
            c.clickAt(a.x, a.y);
            assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体モーダルが開かない');
        };

        // ===== A. 3Dビュー: 鏡像ペインの構え方（鏡面対称／軸を揃える） =====
        const d = buildLactate(42);
        openStereo(d.m, d.center);
        D.getElementById('btn-stereo-tab-3d').click();
        sv.setAutoRotate(false); // rAF は待たない（この環境では大きく間引かれるため）

        const row = D.getElementById('stereo-mirror-layout-row');
        const btnSym = D.getElementById('btn-stereo-mirror-layout-symmetric');
        const btnAlign = D.getElementById('btn-stereo-mirror-layout-align');
        assert(row && btnSym && btnAlign, '3Dの鏡像配置モードのUIがない');
        assert(row.classList.contains('hidden'), '鏡像オフなのに配置モードの行が出ている');
        D.getElementById('btn-stereo-mirror').click();
        assert(sv.mirror && !row.classList.contains('hidden'), '鏡像モードで配置モードの行が出ない');
        assert(sv.mirrorLayout === 'symmetric' && btnSym.classList.contains('active'),
            '既定が「鏡面対称」になっていない');
        assert(btnAlign.disabled, '回転軸が画面基準なのに「軸を揃える」が選べてしまう');

        // 画面上の鏡像からのずれ（0 であるべき）。左ペインの最終ベクトルの x 反転と比べる
        const mirrorErr = () => {
            const L = sv._drawn.left, R = sv._drawn.right;
            let e = 0;
            L.forEach((l, i) => {
                e = Math.max(e, Math.abs(R[i].v[0] + l.v[0]),
                                Math.abs(R[i].v[1] - l.v[1]), Math.abs(R[i].v[2] - l.v[2]));
            });
            return e;
        };
        const pL = () => W.parityFromDirs(sv._drawn.left);
        const pR = () => W.parityFromDirs(sv._drawn.right);
        const p0 = pL();
        assert(p0 === 1 || p0 === -1, '3D表示のパリティが読めない（前提が崩れている）');

        // (a) 鏡面対称: どんな角度・軸・向きでも「左の x 反転」に厳密一致する（＝左右が同期して動く）。
        //     v191 は分子空間で鏡映してから同じ視点変換をかけていたため、鏡映と回転が可換でなく
        //     画面上の鏡像になっていなかった（ずれ 1.9 程度。オリジナル側が動かないように見える不具合）
        assert(mirrorErr() < 1e-9, `鏡面対称の初期状態が画面上の鏡像になっていない（ずれ ${mirrorErr()}）`);
        assert(pR() === -p0, '鏡面対称でパリティが反転していない');
        sv.rotateBy(0.7, 0.35);
        assert(mirrorErr() < 1e-9, `画面基準で回したあと鏡像がずれた（ずれ ${mirrorErr()}）`);
        assert(pL() === p0 && pR() === -p0, '画面基準の回転で鏡像関係が崩れた');

        // 軸ボタン（ラベルは置換基名）から OH を選ぶ
        const axisBtnLabels = [...D.querySelectorAll('#stereo-axis-row .stereo-axis-btn')]
            .slice(1).map(b => b.textContent);
        const ohIdx = axisBtnLabels.indexOf('OH');
        assert(ohIdx >= 0, `軸ボタンに OH がない（${axisBtnLabels.join(',')}）`);
        D.getElementById('btn-stereo-axis-' + ohIdx).click();
        assert(sv.axisIndex === ohIdx, '軸ボタンで軸が選ばれない');
        assert(!btnAlign.disabled, '結合を軸に選んでも「軸を揃える」が押せない');

        // 結合軸・軸の向き（facing）を変えても、鏡面対称は常に厳密な鏡像のまま
        ['auto', 'away', 'right', 'up', 'left'].forEach(f => {
            sv.setAxisFacing(f);
            sv.rotateBy(0.45, 0.2);
            assert(mirrorErr() < 1e-9, `軸の向き ${f} で鏡面対称が崩れた（ずれ ${mirrorErr()}）`);
            assert(pL() === p0 && pR() === -p0, `軸の向き ${f} で鏡像関係（パリティ反転）が崩れた`);
        });
        sv.setAxisFacing('auto');

        // (b) 「軸を揃える」: 鏡像側の軸が画面上でオリジナルの軸と一致する（＝同じ位置・同じ向き）
        btnAlign.click();
        assert(sv.mirrorLayout === 'align' && btnAlign.classList.contains('active'),
            '「軸を揃える」に切り替わらない');
        const axisGap = () => {
            const a = sv._drawn.left[ohIdx].v, b = sv._drawn.right[ohIdx].v;
            return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        };
        assert(axisGap() < 1e-6, `軸を揃えたのに鏡像側の軸が一致しない（ずれ ${axisGap()}）`);
        assert(pL() === p0 && pR() === -p0, '「軸を揃える」で鏡像であること（パリティ反転）が失われた');
        // 軸を揃えても「重なる」わけではない: 残り3つは一致しない＝非重ね合わせ
        const others = sv._drawn.left.map((l, i) => i).filter(i => i !== ohIdx);
        others.forEach(i => {
            const a = sv._drawn.left[i].v, b = sv._drawn.right[i].v;
            assert(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.1,
                `軸以外の置換基 #${i} が鏡像側と重なってしまった（鏡像異性体なら重ならないはず）`);
        });
        // 揃えたモードは「画面上の鏡像」ではない（2モードが実際に別物であることの確認）
        assert(mirrorErr() > 0.1, '「軸を揃える」なのに画面上の鏡像のままになっている');
        // 回しても軸は揃ったまま・鏡像のまま
        ['auto', 'away', 'right'].forEach(f => {
            sv.setAxisFacing(f);
            sv.rotateBy(0.6, 0);
            assert(axisGap() < 1e-6, `軸の向き ${f} で軸そろえが崩れた（ずれ ${axisGap()}）`);
            assert(pL() === p0 && pR() === -p0, `軸の向き ${f} で「軸を揃える」の鏡像性が崩れた`);
        });
        assert(D.getElementById('stereo-3d-note').textContent.includes('軸を揃える'),
            '「軸を揃える」の説明が出ない');

        // (c) 鏡面対称へ戻すと、また厳密な画面上の鏡像に戻る
        btnSym.click();
        assert(sv.mirrorLayout === 'symmetric' && mirrorErr() < 1e-9,
            `鏡面対称へ戻したのに鏡像になっていない（ずれ ${mirrorErr()}）`);
        // (d) 軸を「画面」に戻すと「軸を揃える」は意味を失うので鏡面対称へ戻す
        btnAlign.click();
        assert(sv.mirrorLayout === 'align', '軸そろえに戻せない（前提が崩れている）');
        D.getElementById('btn-stereo-axis-screen').click();
        assert(sv.mirrorLayout === 'symmetric' && btnAlign.disabled,
            '画面基準に戻しても「軸を揃える」が残っている');
        assert(mirrorErr() < 1e-9, '画面基準に戻したあと鏡像がずれた');
        D.getElementById('btn-stereo-mirror').click();
        assert(row.classList.contains('hidden'), '鏡像を消しても配置モードの行が残っている');
        D.getElementById('btn-stereo-close').click();

        // ===== B. くさび図: 鏡像ペインの並べ方（鏡面対称／並びを揃える） =====
        const w = buildLactate(42);
        const pW = slotParity(w.m, w.center, W.fischerSlots(w.m, w.center));
        openStereo(w.m, w.center);
        const wRow = D.getElementById('stereo-wedge-layout-row');
        const wSym = D.getElementById('btn-stereo-wedge-layout-symmetric');
        const wAlign = D.getElementById('btn-stereo-wedge-layout-align');
        assert(wRow && wSym && wAlign, 'くさび図の鏡像配置モードのUIがない');
        assert(wRow.classList.contains('hidden'), '鏡像オフなのにくさび図の配置モードの行が出ている');
        D.getElementById('btn-stereo-wedge-mirror').click();
        assert(!wRow.classList.contains('hidden'), 'くさび図の鏡像モードで配置モードの行が出ない');
        assert(sv.wedgeMirrorLayout === 'symmetric' && wSym.classList.contains('active'),
            'くさび図の既定が「鏡面対称」でない');
        assert(!D.querySelector('#stereo-svg [data-mismatch]'),
            '鏡面対称モードなのに食い違いのハイライトが出ている');

        // (e) 左ペインだけ並べ替えて左右をずらす → 「並びを揃える」で揃え直される
        const mismatchNow = () => sv.wedgeMismatchSlots();
        const clickSlot = (pane, slot) => {
            const hit = D.querySelector(`#stereo-svg [data-pane="${pane}"] rect[data-slot="${slot}"]`);
            assert(hit, `${pane} ペインの ${slot} にクリック領域がない`);
            hit.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
        };
        clickSlot('left', 'right'); // 鏡面対称モードでは左ペインだけ動く
        assert(mismatchNow().length === 4, `左だけ動かしたのに食い違いが4か所にならない（${mismatchNow().length}）`);
        const beforeL = slotParity(w.m, w.center, sv._viewSlots);
        const beforeR = slotParity(w.m, w.center, sv._mirrorSlots);
        wAlign.click();
        assert(sv.wedgeMirrorLayout === 'align' && wAlign.classList.contains('active'),
            'くさび図の「並びを揃える」に切り替わらない');
        // 並べ替えは偶置換だけ＝両ペインのパリティ（＝表示している分子）が切替の前後で不変
        assert(slotParity(w.m, w.center, sv._viewSlots) === beforeL &&
               slotParity(w.m, w.center, sv._mirrorSlots) === beforeR,
            'モード切替でパリティが変わった（偶置換以外の並べ替えを使っている）');
        assert(slotParity(w.m, w.center, sv._viewSlots) === pW &&
               slotParity(w.m, w.center, sv._mirrorSlots) === -pW,
            '「並びを揃える」で左右の鏡像関係（パリティが逆）が崩れた');

        // (f) 揃えきってもちょうど2か所（1回の入れ替えぶん）が必ず食い違い、ハイライトが出る
        const miss = mismatchNow();
        assert(miss.length === 2,
            `揃えたあとの食い違いが2か所でない（${miss.length}か所: ${miss.join(',')}）。` +
            '奇置換の不動点は最大2個なので、一致は最大2スロット＝食い違いは必ず2か所残る');
        assert(codeOf(w.m, w.center, sv._mirrorSlots[miss[0]]) === codeOf(w.m, w.center, sv._viewSlots[miss[1]]) &&
               codeOf(w.m, w.center, sv._mirrorSlots[miss[1]]) === codeOf(w.m, w.center, sv._viewSlots[miss[0]]),
            '残った食い違いが「2つの入れ替え」になっていない');
        miss.forEach(s => {
            assert(D.querySelector(`#stereo-svg [data-pane="left"] [data-mismatch="${s}"]`) &&
                   D.querySelector(`#stereo-svg [data-pane="right"] [data-mismatch="${s}"]`),
                `食い違ったスロット ${s} が左右のペインで枠囲みされていない`);
        });
        assert(D.querySelectorAll('#stereo-svg [data-mismatch]').length === 4,
            '食い違いのハイライトが2スロット×2ペインになっていない');
        const cap = D.querySelector('#stereo-svg [data-align-caption]');
        assert(cap && cap.getAttribute('data-align-caption') === 'mismatch' &&
               cap.textContent.includes('重ね合わせられません'),
            '「ここだけが違う＝重ね合わせられません」の明示が出ない');
        assert(D.getElementById('stereo-wedge-note').textContent.includes('偶置換'),
            '偶置換だけで揃えたことの説明が出ない');

        // (f2) 鏡像は「見た目が変わる入れ替え」を選ぶ（B-2。左右が同じ置換基だと
        //      左右入れ替えでは絵が1ミリも動かず、鏡に映した操作が画面から消える）
        {
            const codes = { up: 'OH', right: 'CH3', down: 'H', left: 'CH3' };
            const code = r => codes[r] || String(r);
            const slots = { up: 'up', right: 'right', down: 'down', left: 'left' };
            const mirrored = SV.mirrorSlots(slots, code);
            // 左右が同じ中身（CH3）なので、左右入れ替えでは見た目が変わらない
            const lr = SV.mirrorSlots(slots);
            assert(code(lr.left) === code(slots.left) && code(lr.right) === code(slots.right),
                'この検査の前提（左右が同じ置換基）が崩れている');
            assert(SLOTS.some(k => code(mirrored[k]) !== code(slots[k])),
                '左右が同じ置換基のとき、鏡像ペインの見た目が元と変わらないままになっている');
            // 転置1回であること（＝奇置換＝鏡像）は保つ
            assert(SLOTS.filter(k => mirrored[k] !== slots[k]).length === 2,
                '鏡像が入れ替え1回（転置）になっていない');
        }

        // (g) 総当たりの根拠: 許される並べ替え（偶置換）は12通りで、そのどれも
        //     オリジナルと完全一致しない（＝回転では重ね合わせられない）
        const evens = SV.evenArrangements(SV.mirrorSlots(sv._viewSlots));
        assert(evens.length === 12, `偶置換で到達できる配置が12通りでない（${evens.length}）`);
        evens.forEach((s, i) => {
            assert(slotParity(w.m, w.center, s) === -pW,
                `列挙した配置 #${i} のパリティが鏡像のものでない（奇置換が混ざっている）`);
            const same = SLOTS.filter(k => codeOf(w.m, w.center, s[k]) === codeOf(w.m, w.center, sv._viewSlots[k])).length;
            assert(same <= 2, `偶置換だけでオリジナルに ${same} スロット一致してしまった（最大2のはず）`);
        });

        // (h) 揃えたモードでは左右が連動して動き、食い違いは2か所のまま
        ['down', 'left', 'right'].forEach(s => {
            clickSlot('left', s);
            assert(mismatchNow().length === 2, `揃えたまま ${s} へ並べ替えたら食い違いが増えた`);
            assert(slotParity(w.m, w.center, sv._viewSlots) === pW &&
                   slotParity(w.m, w.center, sv._mirrorSlots) === -pW,
                `揃えたまま ${s} へ並べ替えたら鏡像関係が崩れた`);
        });
        clickSlot('right', 'down'); // 鏡像側をクリックしても両方が動く
        assert(mismatchNow().length === 2, '鏡像ペインの操作で食い違いが増えた');
        assert(sv.cycleWedge('cw') !== false, '揃えたモードで巡回できない');
        assert(mismatchNow().length === 2, '巡回で食い違いが増えた');
        assert(slotParity(w.m, w.center, sv._viewSlots) === pW &&
               slotParity(w.m, w.center, sv._mirrorSlots) === -pW, '巡回で鏡像関係が崩れた');
        D.getElementById('btn-stereo-wedge-reset').click();
        assert(mismatchNow().length === 2, '「元の並びに戻す」で揃えた関係が崩れた');

        // (i) 鏡面対称へ戻すとハイライトは消え、鏡像は左右入れ替えそのものに戻る
        wSym.click();
        assert(!D.querySelector('#stereo-svg [data-mismatch]') &&
               !D.querySelector('#stereo-svg [data-align-caption]'),
            '鏡面対称へ戻してもハイライト・注記が残っている');
        assert(SLOTS.every(k => sv._mirrorSlots[k] === SV.mirrorSlots(sv._viewSlots)[k]),
            '鏡面対称へ戻しても左右入れ替えの配置になっていない');
        assert(slotParity(w.m, w.center, sv._mirrorSlots) === -pW, '鏡面対称へ戻して鏡像でなくなった');
        D.getElementById('btn-stereo-close').click();

        // (j) 不斉でない中心（2-プロパノール）は、偶置換だけで鏡像とぴったり一致する
        //     ＝食い違いが残らない（「重ね合わせられる」＝鏡像異性体ではない、の裏づけ）
        const ip = new W.Molecule();
        const i1 = ip.addAtom('C', 400, 258);
        const i2 = ip.addAtom('C', 400, 300);
        const i3 = ip.addAtom('C', 400, 342);
        const io = ip.addAtom('O', 442, 300);
        ip.addBond(i1.id, i2.id, 1); ip.addBond(i2.id, i3.id, 1); ip.addBond(i2.id, io.id, 1);
        assert(!ip.isAsymmetricCarbon(i2.id), '2-プロパノールの中心が不斉扱い（前提が崩れている）');
        openStereo(ip, i2.id);
        D.getElementById('btn-stereo-wedge-mirror').click();
        D.getElementById('btn-stereo-wedge-layout-align').click();
        assert(sv.wedgeMismatchSlots().length === 0,
            '不斉でない中心なのに食い違いが残った（回転で重ね合わせられるはず）');
        assert(!D.querySelector('#stereo-svg [data-mismatch]'), '食い違いがないのに枠が出ている');
        const cap2 = D.querySelector('#stereo-svg [data-align-caption]');
        assert(cap2 && cap2.getAttribute('data-align-caption') === 'match',
            '「すべて一致＝重ね合わせられる」の明示が出ない');
        D.getElementById('btn-stereo-close').click();

        // (k) 立体未指定（斜め描き）では配置モードの行そのものを出さない
        const off = new W.Molecule();
        const o1 = off.addAtom('C', 400, 258);
        const o2 = off.addAtom('C', 400, 300);
        const o3 = off.addAtom('C', 400, 342);
        const oo = off.addAtom('O', 430, 270);
        const ocl = off.addAtom('Cl', 370, 330);
        off.addBond(o1.id, o2.id, 1); off.addBond(o2.id, o3.id, 1);
        off.addBond(o2.id, oo.id, 1); off.addBond(o2.id, ocl.id, 1);
        openStereo(off, o2.id);
        // 項目23（2026-08-02）以降、斜め描きでも**仮の立体**で操作できる。
        // ただし配置モードの行は「鏡像と並べている」ときだけ出る（仮かどうかとは別）
        assert(sv._provisional === true, '斜め描きに仮の立体が当たっていない');
        assert(!W.fischerSlots(off, o2.id), '斜め描きなのに図から読めている（前提が崩れている）');
        assert(D.getElementById('stereo-wedge-layout-row').classList.contains('hidden'),
            '鏡像と並べていないのに配置モードの行が出ている');
        D.getElementById('btn-stereo-close').click();
        c.game.userMolecule = new W.Molecule();
        c.game.updateDrawing();
    });


    test('ST13: 環の「横から見る」ビュー（平面近似・α/β の面が z に出る・P12-8）', async (c) => {
        c.reset();
        const W = c.W, D = c.D, g = c.game;
        const sv = W.stereoView;
        assert(sv, 'stereoView が初期化されていない');
        const tabRing = D.getElementById('btn-stereo-tab-ring');
        const paneRing = D.getElementById('stereo-pane-ring');
        assert(tabRing && paneRing, '環ビューのタブ・ペインがない');

        const molOf = (name) => {
            const e = W.COMPOUNDS.find(x => x.name === name);
            assert(e, name + ' が compounds.json に無い');
            return g.createTargetFromData({ target: e.target });
        };
        // モーダルを開いて環タブへ（環の炭素を1つクリックして開く）
        const openRing = (mol, centerId) => {
            g.userMolecule = mol;
            g.updateDrawing();
            // 立体表示ボタンは中心を自動で選んで開くので、狙った中心へは
            // 「別の炭素を選ぶ」から切り替える（P12-8 で入り口を変更）
            D.getElementById('btn-stereo').click();
            D.getElementById('btn-stereo-pick').click();
            const a = mol.atoms.find(x => x.id === centerId);
            c.clickAt(a.x, a.y);
            assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体モーダルが開かない');
            assert(!tabRing.disabled, '環を含む分子なのに環タブが無効になっている');
            tabRing.click();
            assert(sv.mode === 'ring' && !paneRing.classList.contains('hidden'), '環ペインが表示されない');
            assert(D.getElementById('stereo-pane-wedge').classList.contains('hidden') &&
                   D.getElementById('stereo-pane-3d').classList.contains('hidden'),
                '環ペインに切り替えても他のペインが残っている');
        };
        // アノマー位置＝環の酸素に隣接する環炭素についた OH
        const anomerNode = (m, mol) => {
            const ringO = m.cycle.filter(id => mol.atoms.find(a => a.id === id).element === 'O');
            assert(ringO.length === 1, `ピラノース環の酸素が1つでない（${ringO.length}）`);
            const nextTo = new Set(mol.getNeighbors(ringO[0]).map(n => n.atom.id));
            const hit = m.nodes.filter(n => n.kind === 'sub' && n.label === 'OH' && nextTo.has(n.hostId));
            assert(hit.length === 1, `アノマー位置のOHが1つに定まらない（${hit.length}）`);
            return hit[0];
        };
        const faces = (m) => m.nodes.filter(n => n.kind === 'sub').map(n => n.face);

        // ===== A. β-D-グルコピラノース: 環は z=0 の平面・環外置換基は z=±d =====
        const bMol = molOf('β-D-グルコース（β-D-グルコピラノース）');
        openRing(bMol, bMol.atoms[1].id); // atoms[1] = 環の C1（アノマー炭素）
        const bm = sv._ringModel;
        assert(bm, '環モデルが作られない');
        assert(bm.cycle.length === 6, `ピラノース環が6員環として拾えない（${bm.cycle.length}）`);
        assert(bm.depth > 0, '面の厚み（z のオフセット）が 0 になっている');
        const ringNodes = bm.nodes.filter(n => n.kind === 'ring');
        assert(ringNodes.length === 6, `環原子ノードが6個でない（${ringNodes.length}）`);
        assert(ringNodes.every(n => n.v[2] === 0), '環原子が z=0 の平面に乗っていない');
        // 環原子の x,y は描かれた2D座標そのまま（環の重心を原点にしただけ）
        assert(ringNodes.every(n => {
            const a = bMol.atoms.find(x => x.id === n.atomId);
            return Math.abs(n.v[0] - (a.x - bm.center.x)) < 1e-9 &&
                   Math.abs(n.v[1] - (a.y - bm.center.y)) < 1e-9;
        }), '環原子が「描かれた2D座標のまま」置かれていない');
        const subNodes = bm.nodes.filter(n => n.kind === 'sub');
        assert(subNodes.length === 5, `環外置換基が5個でない（${subNodes.length}）`);
        assert(subNodes.every(n => Math.abs(n.face) === 1 && Math.abs(n.v[2] - n.face * bm.depth) < 1e-9),
            '環外置換基が z=±d（面に応じた符号）に置かれていない');
        // β体のハース図どおり: 上 = C1のOH・C3のOH・CH₂OH の3個／下 = C2・C4 の2個
        assert(subNodes.filter(n => n.face === 1).length === 3 &&
               subNodes.filter(n => n.face === -1).length === 2,
            'β体の上下の内訳（上3・下2）が合わない: ' + subNodes.map(n => n.label + ':' + n.face).join(','));
        const bAnomer = anomerNode(bm, bMol);
        assert(bAnomer.face === 1 && bAnomer.v[2] > 0, 'β体のアノマー位置のOHが上（z>0）になっていない');

        // ===== B. カメラ: 真横で環が線に潰れる／ハース図の向きへ戻せる =====
        sv.setRingCamera('side');
        assert(Math.abs(sv.ringTilt - Math.PI / 2) < 1e-9 && sv.ringYaw === 0,
            '「⬡ 真横」で倒し角が90°にならない');
        const ringYs = () => sv._ringDrawn.filter(p => p.node.kind === 'ring').map(p => p.y);
        assert(sv._ringDrawn && ringYs().length === 6, '投影された環原子が6個でない');
        const spread90 = Math.max(...ringYs()) - Math.min(...ringYs());
        assert(spread90 < 0.5, `真横なのに環原子の投影 y が一直線に並ばない（幅 ${spread90.toFixed(2)}）`);
        // 上の面の置換基は画面の上（y が負）・下の面は下（y が正）へ突き出す
        const subDrawn = sv._ringDrawn.filter(p => p.node.kind === 'sub');
        assert(subDrawn.length === 5 &&
               subDrawn.every(p => (p.node.face === 1 ? p.y < -10 : p.y > 10)),
            '真横にしたとき、上の面の置換基が上・下の面の置換基が下へ突き出していない');
        // 0°（ハース図の向き）では環が広がる＝描いた図と同じ見え方
        D.getElementById('btn-stereo-ring-haworth').click();
        assert(sv.ringTilt === 0, '「⬔ ハース図の向き」で倒し角が0°にならない');
        const spread0 = Math.max(...ringYs()) - Math.min(...ringYs());
        assert(spread0 > 20, `ハース図の向きでも環が潰れている（幅 ${spread0.toFixed(2)}）`);
        // 0°の投影は「描いた2D座標を拡大しただけ」＝ハース図そのもの
        assert(sv._ringDrawn.filter(p => p.node.kind === 'ring').every(p => {
            const a = bMol.atoms.find(x => x.id === p.node.atomId);
            return Math.abs(p.x - (a.x - bm.center.x) * bm.scale) < 1e-6 &&
                   Math.abs(p.y - (a.y - bm.center.y) * bm.scale) < 1e-6;
        }), '倒し角0°の見え方が「描いたハース図そのもの」になっていない');
        // スライダーで連続的に動かせる
        const slider = D.getElementById('stereo-ring-tilt');
        assert(slider, 'カメラのスライダーがない');
        slider.value = '45';
        slider.dispatchEvent(new W.Event('input', { bubbles: true }));
        assert(Math.abs(sv.ringTilt - Math.PI / 4) < 1e-6, 'スライダーで倒し角が変わらない');
        assert(D.getElementById('stereo-ring-tilt-value').textContent === '45°', '倒し角の表示が更新されない');
        const spread45 = Math.max(...ringYs()) - Math.min(...ringYs());
        assert(spread45 > spread90 && spread45 < spread0, '倒し角45°の潰れ具合が0°と90°の間にない');
        D.getElementById('btn-stereo-ring-side').click();

        // ===== C. 平面近似であることの注記（必須）=====
        const caveat = D.getElementById('stereo-ring-caveat');
        assert(caveat && !caveat.classList.contains('hidden'), '平面近似の注記が表示されていない');
        ['環を平面とみなした模式図', 'いす形', 'アキシャル', 'エカトリアル'].forEach(k => {
            assert(caveat.textContent.includes(k), `平面近似の注記に「${k}」が無い`);
        });

        // ===== C-2. 縦軸まわりの回転（⟲⟳ボタン。ドラッグと同じ回転を刻む・P12-8）=====
        const yawVal = () => D.getElementById('stereo-ring-yaw-value').textContent;
        // 環の炭素は <g data-ring-node="ring"> の中の circle で描かれる。その cx を見え方の指紋にする
        const ringX = () => [...D.querySelectorAll('#stereo-ring-svg [data-ring-node="ring"] circle')]
            .map(e => Math.round(Number(e.getAttribute('cx')) * 100) / 100);
        D.getElementById('btn-stereo-ring-side').click(); // 真横・yaw 0 に戻す
        assert(yawVal() === '0°', `回転の初期表示が0°でない（${yawVal()}）`);
        const x0 = ringX();
        D.getElementById('btn-stereo-ring-yaw-cw').click();
        assert(yawVal() === '30°', `右へ1回で30°にならない（${yawVal()}）`);
        assert(JSON.stringify(ringX()) !== JSON.stringify(x0), '回しても環の見え方が変わらない');
        D.getElementById('btn-stereo-ring-yaw-ccw').click();
        assert(yawVal() === '0°', `左へ戻して0°にならない（${yawVal()}）`);
        assert(JSON.stringify(ringX()) === JSON.stringify(x0), '同じ角度に戻したのに見え方が一致しない');
        // 一周（12回×30°）で元に戻る＝角度の正規化が効いている
        for (let i = 0; i < 12; i++) D.getElementById('btn-stereo-ring-yaw-ccw').click();
        assert(yawVal() === '0°', `一周して0°に戻らない（${yawVal()}）`);
        // 立体の中身（面の符号）は見る向きを変えても不変
        assert(anomerNode(sv._ringModel, bMol).face === bAnomer.face, '回転で置換基の面が変わっている');
        D.getElementById('btn-stereo-ring-side').click();

        // ===== D. 暗黙Hの表示切替（置換基の反対の面に出る）=====
        const hNodes = bm.nodes.filter(n => n.kind === 'h');
        assert(hNodes.length === 5, `環炭素の暗黙Hが5個でない（${hNodes.length}）`);
        assert(hNodes.every(n => {
            const partner = bm.nodes.find(x => x.kind === 'sub' && x.hostId === n.hostId);
            return partner && n.face === -partner.face && Math.abs(n.v[2] + partner.v[2]) < 1e-9;
        }), '暗黙Hが置換基と反対の面に置かれていない');
        const hBtn = D.getElementById('btn-stereo-ring-h');
        const hDrawn = () => D.querySelectorAll('#stereo-ring-svg [data-ring-node="h"]').length;
        assert(hDrawn() === 0, '既定でHが描かれている');
        hBtn.click();
        assert(sv.ringShowH && hDrawn() === 5, 'H の表示切替が効かない');
        hBtn.click();
        assert(!sv.ringShowH && hDrawn() === 0, 'H を隠せない');
        assert(D.querySelectorAll('#stereo-ring-svg [data-ring-node="ring"]').length === 6 &&
               D.querySelectorAll('#stereo-ring-svg [data-ring-node="sub"]').length === 5 &&
               D.querySelector('#stereo-ring-svg [data-ring-plane]'),
            '環・置換基・環の面が描かれていない');
        D.getElementById('btn-stereo-close').click();

        // ===== E. α体ではアノマー位置の面（z の符号）だけが逆になる =====
        const aMol = molOf('α-D-グルコース（α-D-グルコピラノース）');
        openRing(aMol, aMol.atoms[1].id);
        const am = sv._ringModel;
        const aAnomer = anomerNode(am, aMol);
        assert(aAnomer.face === -1 && aAnomer.v[2] < 0, 'α体のアノマー位置のOHが下（z<0）になっていない');
        assert(aAnomer.face === -bAnomer.face && aAnomer.v[2] * bAnomer.v[2] < 0,
            'α と β でアノマー位置の置換基の z 符号が逆になっていない（描いた面が反映されていない）');
        const fa = faces(am), fb = faces(bm);
        assert(fa.length === fb.length, 'α/β で環外置換基の数が違う');
        const diff = fa.reduce((s, v, i) => s + (v === fb[i] ? 0 : 1), 0);
        assert(diff === 1, `α/β で面が違う置換基がちょうど1つ（アノマー）でない（${diff}箇所）`);
        // chemistry.js の環パリティ読み取りとも符号が連動していること（表示と判定のズレ防止）
        assert(W.readRingParityFromHaworth(aMol)[aAnomer.hostId] ===
               -W.readRingParityFromHaworth(bMol)[bAnomer.hostId],
            'chemistry.js が読む環パリティも α/β で逆になっていない（前提の確認）');
        // 真横にしたとき、アノマーOH が α では下・β では上に描かれる
        sv.setRingCamera('side');
        const aDrawnAnomer = sv._ringDrawn.find(p => p.node === aAnomer);
        assert(aDrawnAnomer && aDrawnAnomer.y > 10, 'α体のアノマーOHが真横で下に描かれていない');
        D.getElementById('btn-stereo-close').click();

        // ===== F. 環の無い分子ではタブが無効になり、理由が出る =====
        const chain = new W.Molecule();
        const k1 = chain.addAtom('C', 400, 300);
        const k2 = chain.addAtom('C', 442, 300);
        chain.addBond(k1.id, k2.id, 1);
        g.userMolecule = chain;
        g.updateDrawing();
        D.getElementById('btn-stereo').click();
        D.getElementById('btn-stereo-pick').click();
        c.clickAt(400, 300);
        assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体モーダルが開かない（鎖状）');
        assert(sv._ringModel === null, '環が無いのに環モデルが作られている');
        assert(tabRing.disabled, '環の無い分子で環タブが無効化されない');
        assert(tabRing.title.includes('環がない'), '無効化した環タブに理由（title）が無い');
        const hint = D.getElementById('stereo-ring-hint');
        assert(hint && !hint.classList.contains('hidden') && hint.textContent.includes('環がない'),
            '環が無い理由が画面に表示されない');
        sv.setMode('ring'); // 直接呼ばれてもくさび図に落ちる（環ビューは開かない）
        assert(sv.mode === 'wedge' && paneRing.classList.contains('hidden'),
            '環が無いのに環ビューが開けてしまう');
        // 既存タブへの無回帰（くさび図・3D の切り替えは従来どおり）
        D.getElementById('btn-stereo-tab-3d').click();
        assert(sv.mode === '3d' && !D.getElementById('stereo-pane-3d').classList.contains('hidden'),
            '環タブの追加で3Dタブが壊れている');
        D.getElementById('btn-stereo-tab-wedge').click();
        assert(sv.mode === 'wedge' && !D.getElementById('stereo-pane-wedge').classList.contains('hidden'),
            '環タブの追加でくさび図タブが壊れている');
        D.getElementById('btn-stereo-close').click();
        c.game.userMolecule = new W.Molecule();
        c.game.updateDrawing();
    });

    test('RX6: 代表分子で「出るべき反応／出てはいけない反応」（P12-8 反応判定の精査）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        // 教材としての正しさは「多くの反応を出す」ことではなく「**誤った反応を出さない**」こと。
        // 代表分子について、出るべき反応（must）と出てはいけない反応（never）を固定して回帰の網にする。
        // 判断できないもの（＝現行モデルの守備範囲外）は候補に出さない、が設計方針（DEVELOPMENT.md P12-8）。
        const cases = [
            // 単純なアルコール: 酸化と分子内脱水はどちらも教科書の定番
            { name: 'エタノール', must: ['oxidize_primary', 'dehydration_intra'], never: ['oxidize_secondary', 'oxidize_aldehyde'] },
            { name: '2-プロパノール', must: ['oxidize_secondary', 'dehydration_intra'], never: ['oxidize_primary'] },
            { name: '2-メチル-2-プロパノール', must: ['oxidize_tertiary_info'], never: ['oxidize_primary', 'oxidize_secondary'] },
            { name: 'シクロヘキサノール', must: ['oxidize_secondary', 'dehydration_intra'], never: ['oxidize_primary'] },
            // アルデヒド → カルボン酸まで。さらなる酸化や脱水は無い
            { name: 'アセトアルデヒド', must: ['oxidize_aldehyde'], never: ['dehydration_intra', 'oxidize_primary'] },
            // カルボン酸・ケトン単体では候補なし（エステル化は相手の分子が要る）
            { name: '酢酸', must: [], never: ['oxidize_aldehyde', 'dehydration_intra', 'esterification'] },
            { name: 'アセトン', must: [], never: ['oxidize_secondary', 'dehydration_intra'] },
            // 芳香族の置換
            { name: 'ベンゼン', must: ['aromatic_nitration', 'aromatic_halogenation'], never: ['dehydration_intra'] },
            { name: 'フェノール', must: ['aromatic_nitration'], never: ['dehydration_intra', 'oxidize_primary'] },
            // エステルの加水分解とけん化は生成物が違うので別ルール（A-1）。どちらも候補に出る。
            // 酸無水物は形が同じ（-CO-O-）だが別の反応なので混ぜない
            { name: '酢酸エチル', must: ['hydrolysis_ester', 'saponification'], never: ['dehydration_intra', 'hydrolysis_anhydride'] },
            { name: '無水酢酸', must: ['hydrolysis_anhydride'], never: ['hydrolysis_ester', 'saponification'] },
            { name: '無水フタル酸', must: ['hydrolysis_anhydride'], never: ['hydrolysis_ester', 'saponification'] },
            // 塩そのものにはエステルの反応を出さない（-COONa は -CO-O-C ではない）
            { name: '酢酸ナトリウム', must: [], never: ['hydrolysis_ester', 'saponification', 'esterification'] },
            // アセチル化はフェノールの -OH とアミンの -NH₂ に。**アミドの N には出さない**
            //（アセトアニリドはアニリンをアセチル化した生成物。さらにアセチル化はできない）
            { name: 'アニリン', must: ['acetylation_anhydride'], never: [] },
            { name: 'アセトアニリド', must: [], never: ['acetylation_anhydride'] },
            { name: '尿素', must: [], never: ['acetylation_anhydride'] },
            { name: 'アセトアミド', must: [], never: ['acetylation_anhydride'] },
            { name: 'ε-カプロラクタム', must: [], never: ['acetylation_anhydride'] },
            // パラセタモールはフェノールの -OH だけが対象（アミドの N は対象外）
            { name: 'パラセタモール', must: ['acetylation_anhydride'], never: [] },
            // 級数で分かれたアミン（§9.6-7）。**3級アミンは N に水素が無いのでアセチル化できない**
            { name: 'ジエチルアミン', must: ['acetylation_anhydride'], never: [] },
            { name: 'トリメチルアミン', must: [], never: ['acetylation_anhydride'] },
            { name: 'トリエチルアミン', must: [], never: ['acetylation_anhydride'] },
            // 多価アルコール・糖・α-ヒドロキシ酸に分子内脱水を出してはいけない
            // （高校では扱わないうえ、現行モデルでは正しい生成物を出せない）
            // 多価アルコール・糖ではアルコールの酸化も出さない（P12-8 第4弾）。
            // 高校では扱わないうえ、-OH を1つだけ選んで酸化する反応は実際には成立しない
            { name: 'エチレングリコール', must: [], never: ['dehydration_intra', 'oxidize_primary'] },
            { name: 'グリセリン', must: [], never: ['dehydration_intra', 'oxidize_primary', 'oxidize_secondary'] },
            // -OH が1つだけなら他の官能基があっても酸化は出す（乳酸 → ピルビン酸の骨格）
            { name: '乳酸', must: ['oxidize_secondary'], never: ['dehydration_intra'] },
            // 鎖状グルコースは -CHO が先に酸化される（＝還元性）。-OH の酸化は並べない
            { name: 'D-グルコース（鎖状）', must: ['oxidize_aldehyde', 'cyclize_glucose_alpha', 'cyclize_glucose_beta'],
              never: ['dehydration_intra', 'oxidize_primary', 'oxidize_secondary'] },
            { name: 'β-D-グルコース（β-D-グルコピラノース）', must: ['open_glucopyranose'], never: ['dehydration_intra'] }
        ];
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        cases.forEach(tc => {
            const entry = source.find(x => x.name === tc.name && x.target);
            assert(entry, `${tc.name} がライブラリに無い（テストの前提が崩れている）`);
            const mol = g.createTargetFromData({ target: entry.target });
            g.userMolecule = mol;
            g.updateDrawing();
            const fired = W.REACTION_RULES
                .filter(r => { try { return r.detect(mol).length > 0; } catch (e) { return false; } })
                .map(r => r.id);
            tc.must.forEach(id => {
                assert(fired.includes(id), `${tc.name}: 出るべき反応 ${id} が出ない（実際: ${fired.join(',') || 'なし'}）`);
            });
            tc.never.forEach(id => {
                assert(!fired.includes(id), `${tc.name}: 出てはいけない反応 ${id} が出ている（実際: ${fired.join(',')}）`);
            });
        });
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX8: 芳香族置換は「同じ生成物になる位置」をまとめる（P12-8 反応判定の精査）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        // ベンゼンの6箇所は化学的に等価で、置換すると同じ分子になる。6件並べても選択肢が
        // 増えるだけなので1件にまとめる。置換基があると等価性が崩れ、o/m/p のように
        // 意味のある通り数になる（これは残す）。判定は正準コード＝実アプリと同じ同一性。
        const cases = [
            { name: 'ベンゼン', expect: 1 },                 // 6箇所すべて等価
            { name: 'トルエン', expect: 3 },                 // o(2), m(2), p(1) の3通り
            { name: 'ナフタレン', expect: 2 },               // α位・β位の2通り
            { name: 'フェノール', expect: 3 },               // o, m, p
            { name: 'o-キシレン', expect: 2 },
            { name: 'm-キシレン', expect: 3 },
            { name: 'p-キシレン', expect: 1 },               // 4箇所すべて等価
            { name: 'ニトロベンゼン', expect: 3 },
            { name: 'p-ジニトロベンゼン', expect: 1 }
        ];
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        ['aromatic_nitration', 'aromatic_sulfonation', 'aromatic_halogenation'].forEach(ruleId => {
            const rule = W.REACTION_RULES.find(r => r.id === ruleId);
            assert(rule, `${ruleId} が無い`);
            cases.forEach(tc => {
                const entry = source.find(x => x.name === tc.name && x.target);
                assert(entry, `${tc.name} がライブラリに無い`);
                const mol = g.createTargetFromData({ target: entry.target });
                g.userMolecule = mol;
                g.updateDrawing();
                const n = rule.detect(mol).length;
                assert(n === tc.expect,
                    `${tc.name} の ${ruleId}: 候補が ${n} 箇所（化学的に区別できるのは ${tc.expect} 通り）`);
            });
        });
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('ST15: 立体異性体クイズ（同じ/鏡像/ジアステレオマーの3択・M2.5）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const q = W.stereoQuiz;
        assert(q, 'stereoQuiz が初期化されていない');
        q.build();
        assert(q.pool.length >= 20, `立体が読めるエントリが少なすぎる（${q.pool.length}）`);
        assert(q.pairs.length >= 10, `ライブラリ内の立体異性体ペアが少なすぎる（${q.pairs.length}）`);

        const rel = (nameA, nameB) => {
            const a = q.pool.find(x => x.name === nameA);
            const b = q.pool.find(x => x.name === nameB);
            assert(a && b, `${nameA} / ${nameB} がプールに無い`);
            return W.StereoQuiz.relationOf(a.mol, b.mol);
        };
        // 判定の正しさ（CIP を使わず立体コードの比較だけで出す）
        assert(rel('D-アラニン', 'L-アラニン') === 'enantiomer', 'D/L-アラニンが鏡像異性体と判定されない');
        assert(rel('D-乳酸', 'L-乳酸') === 'enantiomer', 'D/L-乳酸が鏡像異性体と判定されない');
        assert(rel('D-アラニン', 'D-アラニン') === 'same', '同じエントリが「同じ分子」と判定されない');
        // 糖のアノマー・エピマーはジアステレオマー（鏡像ではない）
        assert(rel('α-D-グルコース（α-D-グルコピラノース）', 'β-D-グルコース（β-D-グルコピラノース）') === 'diastereomer',
            'α/β アノマーがジアステレオマーと判定されない');
        assert(rel('β-D-グルコース（β-D-グルコピラノース）', 'β-D-ガラクトース（β-D-ガラクトピラノース）') === 'diastereomer',
            'グルコース/ガラクトースがジアステレオマーと判定されない');
        // シス/トランスもジアステレオマー（鏡像異性体ではない）
        assert(rel('シス-2-ブテン', 'トランス-2-ブテン') === 'diastereomer',
            'シス/トランスがジアステレオマーと判定されない');

        // フィッシャー投影の回転則: 180°=同じ分子 / 90°・270°=鏡像。
        // 規則を書き込んでいるのではなく、回した図から立体を読み直して出している
        const ala = q.pool.find(x => x.name === 'D-アラニン');
        const relTurn = (turns, mirror) => {
            const t = W.rotateTargetInPlane(ala.target, turns, mirror);
            return W.StereoQuiz.relationOf(ala.mol, c.game.createTargetFromData({ target: t }));
        };
        assert(relTurn(2, false) === 'same', 'フィッシャー投影の180°回転が「同じ分子」にならない');
        assert(relTurn(1, false) === 'enantiomer', 'フィッシャー投影の90°回転が「鏡像」にならない');
        assert(relTurn(3, false) === 'enantiomer', 'フィッシャー投影の270°回転が「鏡像」にならない');
        assert(relTurn(0, true) === 'enantiomer', '左右反転が「鏡像」にならない');
        // 不斉炭素を持たない分子は鏡に映しても同じ（鏡像異性体が存在しない）
        const cis = q.pool.find(x => x.name === 'シス-2-ブテン');
        const cisM = W.StereoQuiz.relationOf(cis.mol,
            c.game.createTargetFromData({ target: W.rotateTargetInPlane(cis.target, 0, true) }));
        assert(cisM === 'same', 'シス-2-ブテンは鏡に映しても同じ分子であるべき');

        // 出題は「図を回す」方式を**環（ハース投影）には使わない**。
        // ハースを紙面内で180°回すと規約上は面が逆＝鏡像を描いた図になってしまい、
        // 教科書で扱わない紛らわしい問題になるため
        // 出題範囲（P12-8。フィッシャーの90°回転は規約の理解が要るので発展扱い）
        const modeEl = D.getElementById('sq-mode');
        assert(modeEl, '出題範囲の選択が無い');
        modeEl.value = 'pair';   // 標準: 別々の化合物＋180°回転（同じ分子）だけ
        let ninety = 0;
        for (let i = 0; i < 40; i++) {
            q.nextQuestion();
            if (q.current.how === 'transform' && (q.current.turns % 2 === 1 || q.current.mirror)) ninety++;
        }
        assert(ninety === 0, `標準の範囲で90°回転・鏡映の問題が ${ninety} 件出ている`);
        modeEl.value = 'all';
        let ringTransform = 0, kinds = { same: 0, enantiomer: 0, diastereomer: 0 };
        for (let i = 0; i < 40; i++) {
            q.nextQuestion();
            assert(q.current, '出題できていない');
            kinds[q.current.rel]++;
            if (q.current.how === 'transform') {
                const e = q.pool.find(x => x.name === q.current.nameA);
                if (e && e.fromRing) ringTransform++;
            }
        }
        assert(ringTransform === 0, `環の分子を回した出題が ${ringTransform} 件出ている`);
        assert(kinds.same > 0 && kinds.enantiomer > 0 && kinds.diastereomer > 0,
            `3種類の関係が出題されない（${JSON.stringify(kinds)}）`);

        // 解答の流れ（正解を押すと成績が進み、解説が出る）
        q.score = { asked: 0, correct: 0 };
        q.nextQuestion();
        const key = q.current.rel;
        D.getElementById('btn-sq-' + key).click();
        assert(q.score.correct === 1 && q.score.asked === 1, `正解を押しても成績が進まない（${JSON.stringify(q.score)}）`);
        assert(D.getElementById('sq-result').textContent.includes('正解'), '解説が出ていない');
        assert(D.getElementById('btn-sq-same').disabled, '解答後もボタンが押せる');
        // 図が2つ描かれている
        assert(D.querySelectorAll('#sq-svg-a .quiz-atoms *').length > 0 &&
               D.querySelectorAll('#sq-svg-b .quiz-atoms *').length > 0, '2つの図が描かれていない');
        D.getElementById('btn-sq-close').click();
        assert(D.getElementById('stereo-quiz-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('ST27: 重ね合わせビュー（正準ラベリングで対応づけ・M2.5-A）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const q = W.stereoQuiz;
        assert(q, 'stereoQuiz が初期化されていない');
        q.build();
        const entry = (name) => {
            const e = q.pool.find(x => x.name === name);
            assert(e, `${name} がプールに無い`);
            return e;
        };
        const cmpOf = (molA, molB) => {
            const a = W.readStereoOf(molA);
            const b = W.readStereoOf(molB);
            assert(a && b, '立体が読めない');
            return W.stereoIsomorphismCompare(molA, a.stereo, molB, b.stereo);
        };

        // (1) 同じ分子（180°回転の図）: 全一致する対応が必ず見つかる
        const ala = entry('D-アラニン');
        const rot = c.game.createTargetFromData({ target: W.rotateTargetInPlane(ala.target, 2, false) });
        let cmp = cmpOf(ala.mol, rot);
        assert(cmp && cmp.total > 0 && cmp.matched === cmp.total,
            `180°回転の図と全一致にならない（${cmp && cmp.matched}/${cmp && cmp.total}）`);
        // 対応（同型写像）が全単射になっている
        const vals = Object.values(cmp.map);
        assert(new Set(vals).size === vals.length &&
               vals.length === ala.mol.atoms.filter(a => a.element !== 'H').length,
            '原子の対応が全単射になっていない');

        // (2) 鏡像異性体（D/L-アラニン）: 唯一の不斉炭素が食い違う
        cmp = cmpOf(ala.mol, entry('L-アラニン').mol);
        assert(cmp && cmp.centers.length === 1 && !cmp.centers[0].match,
            'D/L-アラニンで不斉炭素の食い違いが出ない');

        // (3) ジアステレオマー（C4エピマー）: 一部だけ食い違う
        cmp = cmpOf(entry('β-D-グルコース（β-D-グルコピラノース）').mol,
                    entry('β-D-ガラクトース（β-D-ガラクトピラノース）').mol);
        assert(cmp && cmp.matched > 0 && cmp.matched < cmp.total,
            `エピマーが「一部一致」にならない（${cmp && cmp.matched}/${cmp && cmp.total}）`);
        assert(cmp.centers.filter(x => !x.match).length === 1,
            'グルコース/ガラクトースの食い違いは1中心（C4）のはず');

        // (4) シス/トランス: 不斉炭素は無く、C=C の幾何だけが食い違う
        cmp = cmpOf(entry('シス-2-ブテン').mol, entry('トランス-2-ブテン').mol);
        assert(cmp && cmp.centers.length === 0 && cmp.geos.length === 1 && !cmp.geos[0].match,
            'シス/トランスで C=C の食い違いが出ない');

        // (5) つながり方が違う分子は対応づけできない（null）
        const etoh = (W.COMPOUNDS || []).find(x => x.name === 'エタノール' && x.target);
        if (etoh) {
            const em = c.game.createTargetFromData({ target: etoh.target });
            const ei = W.readStereoOf(em);
            assert(W.stereoIsomorphismCompare(ala.mol, W.readStereoOf(ala.mol).stereo,
                em, ei ? ei.stereo : {}) === null, '別の化合物どうしで対応づけできてしまう');
        }

        // (6) 判定との整合: 一致数を最大化しているので「全一致 ⇔ 同じ分子」が常に成り立つ
        const modeEl = D.getElementById('sq-mode');
        modeEl.value = 'all';
        for (let i = 0; i < 25; i++) {
            q.nextQuestion();
            assert(q.current, '出題できていない');
            const r = cmpOf(q.current.molA, q.current.molB);
            assert(r, '出題された組で対応づけできない');
            assert((r.matched === r.total) === (q.current.rel === 'same'),
                `全一致⇔同じ分子 が崩れた（rel=${q.current.rel} ${r.matched}/${r.total}）`);
        }
        modeEl.value = 'pair';

        // (7) UI: 解答すると「重ねて確かめる」が現れ、押すとゴーストと一致/不一致の印が描かれる
        q.nextQuestion();
        q.answer(q.current.rel);
        const btn = D.getElementById('btn-sq-overlay');
        assert(btn && !btn.classList.contains('hidden'), '解答後に重ね合わせボタンが出ない');
        const beforeVB = D.getElementById('sq-svg-a').getAttribute('viewBox');
        btn.click();
        assert(D.querySelector('#sq-svg-a .sq-overlay-ghost'), 'ゴーストが描かれない');
        const cmpUI = q.overlayCompare();
        assert(cmpUI, '表示中の図で対応づけできない');
        assert(D.querySelectorAll('#sq-svg-a .sq-overlay-marks circle').length === cmpUI.total,
            '一致/不一致の印の数が中心の数と合わない');
        assert(D.getElementById('sq-overlay-note').textContent.includes('平行移動'),
            '重ね合わせの説明が出ない');
        btn.click(); // 解除
        assert(!D.querySelector('#sq-svg-a .sq-overlay-ghost, #sq-svg-a .sq-overlay-marks'),
            '解除してもゴーストが残る');
        assert(D.getElementById('sq-svg-a').getAttribute('viewBox') === beforeVB,
            '解除しても図Aの表示範囲が戻らない');
        // 次の問題では消えて、ボタンも隠れる
        btn.click();
        q.nextQuestion();
        assert(btn.classList.contains('hidden'), '次の問題でボタンが隠れない');
        assert(!D.querySelector('#sq-svg-a .sq-overlay-ghost, #sq-svg-a .sq-overlay-marks'),
            '次の問題にゴーストが持ち越される');
        assert(D.getElementById('sq-svg-b').style.opacity === '', '次の問題でも図Bが薄いまま');
        D.getElementById('btn-sq-close').click();
    });

    test('ST28: フィッシャー投影の操作練習（偶置換のみ・M2.5-B）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const fp = W.fischerPractice;
        assert(fp, 'fischerPractice が初期化されていない');
        fp.build();
        assert(fp.pool.length >= 5, `対象分子が少なすぎる（${fp.pool.length}）`);
        const ala = fp.pool.find(x => x.name === 'D-アラニン');
        assert(ala, 'D-アラニンがプールに無い');
        const relTo = (t1, t2) => W.StereoQuiz.relationOf(
            c.game.createTargetFromData({ target: t1 }),
            c.game.createTargetFromData({ target: t2 }));

        // (1) 90°＋左右入れ替え＝同じ分子（90°単独は鏡像になるので、そのボタンはUIに無い）
        const r90 = W.fischerOpRotate90(c.game, ala.target, 'cw');
        assert(r90 && relTo(ala.target, r90) === 'same', '90°＋左右入れ替えで分子が変わった');
        assert(relTo(ala.target, W.rotateTargetInPlane(ala.target, 1, false)) === 'enantiomer',
            '（前提）90°単独回転は鏡像のはず');
        const r90b = W.fischerOpRotate90(c.game, ala.target, 'ccw');
        assert(r90b && relTo(ala.target, r90b) === 'same', '逆回りの90°＋入れ替えで分子が変わった');

        // (2) 180°回転＝同じ分子
        const r180 = W.fischerOpRotate180(c.game, ala.target);
        assert(r180 && relTo(ala.target, r180) === 'same', '180°回転で分子が変わった');

        // (3) 軸を固定した3巡回＝同じ分子。同じ巡回を3回続けると元の図に戻る（3巡回の位数）
        const centers = fp.readableCenters(ala.target);
        assert(centers.length === 1, `D-アラニンの中心が1つでない（${centers.length}）`);
        let t = W.fischerOpCycle(c.game, ala.target, centers[0], 'up', 'cw');
        assert(t && relTo(ala.target, t) === 'same', '3巡回で分子が変わった');
        assert(W.FischerPractice.drawingKey(t) !== W.FischerPractice.drawingKey(ala.target),
            '3巡回で図が変わっていない');
        t = W.fischerOpCycle(c.game, t, centers[0], 'up', 'cw');
        t = W.fischerOpCycle(c.game, t, centers[0], 'up', 'cw');
        assert(t && W.FischerPractice.drawingKey(t) === W.FischerPractice.drawingKey(ala.target),
            '同じ3巡回を3回続けても元の図に戻らない');

        // (4) 分子が変わってしまう操作は適用されない（安全網）。
        // 鎖の途中の中心で左右を軸にすると、骨格（別の不斉炭素を含む枝）を回すことになり、
        // 読み直した立体コードが変わるため null になる
        const glc = fp.pool.find(x => x.name === 'D-グルコース（鎖状）');
        if (glc) {
            const gc = fp.readableCenters(glc.target);
            if (gc.length >= 3) {
                const mid = gc[Math.floor(gc.length / 2)];
                assert(W.fischerOpCycle(c.game, glc.target, mid, 'left', 'cw') === null,
                    '骨格を壊す巡回が適用できてしまう');
            }
        }

        // (5) UI: 開いて操作しても左との関係は変わらない（不変量。毎回図から読み直して判定）
        fp.open();
        assert(!D.getElementById('fischer-practice-modal').classList.contains('hidden'), 'モーダルが開かない');
        assert(D.querySelectorAll('#fp-svg-a .quiz-atoms *').length > 0 &&
               D.querySelectorAll('#fp-svg-b .quiz-atoms *').length > 0, '2つの図が描かれていない');
        const rel0 = fp.currentRelation();
        assert(rel0 === 'same' || rel0 === 'enantiomer', `お題の関係が想定外（${rel0}）`);
        const opIds = ['btn-fp-rot180', 'btn-fp-rot90cw', 'btn-fp-rot90ccw'];
        for (let i = 0; i < 6; i++) {
            D.getElementById(opIds[i % opIds.length]).click();
            assert(fp.currentRelation() === rel0,
                `操作で分子が変わった（${rel0}→${fp.currentRelation()}）`);
        }
        assert(fp.moves > 0, '手数が数えられていない');
        // リセットで最初の図に戻る
        D.getElementById('btn-fp-reset').click();
        assert(W.FischerPractice.drawingKey(fp.current.targetB) === W.FischerPractice.drawingKey(fp.current.base),
            'リセットで最初の図に戻らない');

        // (6) お題: scramble（同じ分子）と mirror（鏡像）の両方が出て、図から読んだ関係と一致する
        const kinds = { scramble: 0, mirror: 0 };
        for (let i = 0; i < 30; i++) {
            fp.newQuestion();
            assert(fp.current, '出題できていない');
            kinds[fp.current.how]++;
            const rel = fp.currentRelation();
            assert(fp.current.how === 'mirror' ? rel === 'enantiomer' : rel === 'same',
                `お題の関係が想定と違う（how=${fp.current.how} rel=${rel}）`);
        }
        assert(kinds.scramble > 0 && kinds.mirror > 0, `お題が偏っている（${JSON.stringify(kinds)}）`);
        D.getElementById('btn-fp-close').click();
        assert(D.getElementById('fischer-practice-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('ST29: 立体タイムアタック（中心の反転で同じ分子を作る・M2.5-C）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const ta = W.timeAttack;
        assert(ta, 'timeAttack が初期化されていない');
        ta.build();
        const ala = ta.pool.find(x => x.name === 'D-アラニン');
        assert(ala, 'D-アラニンがプールに無い');
        const relTo = (t1, t2) => W.StereoQuiz.relationOf(
            c.game.createTargetFromData({ target: t1 }),
            c.game.createTargetFromData({ target: t2 }));

        // (1) 鏡＝奇置換。1中心の分子では鏡像になり、同じ鏡を2回で元の分子に戻る（鏡は自分自身が逆操作）
        const centers = ta.readableCenters(ala.target);
        const s1 = W.fischerOpSwap(c.game, ala.target, centers[0]);
        assert(s1 && relTo(ala.target, s1) === 'enantiomer', '枝の入れ替えが鏡像にならない');
        const s2 = W.fischerOpSwap(c.game, s1, centers[0]);
        assert(s2 && relTo(ala.target, s2) === 'same', '2回入れ替えても元の分子に戻らない');
        // つながり方（構成異性）は変わっていない
        assert(W.canonicalCode(c.game.createTargetFromData({ target: ala.target })) ===
               W.canonicalCode(c.game.createTargetFromData({ target: s1 })),
            '入れ替えでつながり方が変わった');

        // (1b) 操作は4種類（C-5c。2026-08-01 ユーザー確定）。
        // 縦軸の鏡（左右）と横軸の鏡（上下）は**別の図になるが同じ分子**＝鏡像は1つしかない
        const mv = W.fischerOpMirror(c.game, ala.target, centers[0], 'vertical');
        const mh = W.fischerOpMirror(c.game, ala.target, centers[0], 'horizontal');
        assert(mv && mh, '縦軸／横軸の鏡のどちらかが使えない');
        assert(relTo(ala.target, mv) === 'enantiomer' && relTo(ala.target, mh) === 'enantiomer',
            '鏡が鏡像にならない');
        assert(relTo(mv, mh) === 'same', '縦軸の鏡と横軸の鏡が別の分子になった（鏡像は1つのはず）');
        assert(W.FischerPractice.drawingKey(mv) !== W.FischerPractice.drawingKey(mh),
            '縦軸の鏡と横軸の鏡が同じ図になった（別の図で同じ分子、が見せどころ）');
        // 鏡は自分自身が逆操作（同じ軸で2回押すと図までぴったり戻る）
        ['vertical', 'horizontal'].forEach(axis => {
            const back = W.fischerOpMirror(c.game,
                W.fischerOpMirror(c.game, ala.target, centers[0], axis), centers[0], axis);
            assert(back && W.FischerPractice.drawingKey(back) === W.FischerPractice.drawingKey(ala.target),
                `${axis} の鏡を2回押しても元の図に戻らない`);
        });
        // **180°回転のボタンが要らない理由**: ↔ のあと ↕ がちょうど180°回転になる
        const both = W.fischerOpMirror(c.game, mv, centers[0], 'horizontal');
        assert(both && relTo(ala.target, both) === 'same', '鏡2回で元の分子に戻らない');
        assert(W.FischerPractice.drawingKey(both) ===
               W.FischerPractice.drawingKey(W.rotateTargetInPlane(ala.target, 2, false)),
            '縦軸の鏡→横軸の鏡が180°回転になっていない');
        // 回す（1つ固定して3つ送る）は互いに逆。⟳ のあと ⟲ で図までぴったり戻る。
        // **暗黙のHのスロットも固定軸に選べる**（十字の模型では4スロットに回転ボタンが並ぶ）
        // 原子IDは分子を作るたびに振り直される乱数なので、**同じ分子オブジェクトから**引く
        const alaMol = c.game.createTargetFromData({ target: ala.target });
        const slotsOfAla = W.fischerSlots(alaMol, alaMol.atoms[centers[0]].id);
        assert(slotsOfAla, 'D-アラニンのスロットが読めない');
        const hSlot = ['up', 'right', 'down', 'left'].find(k => slotsOfAla[k] === 'H');
        assert(hSlot, 'D-アラニンに暗黙のHのスロットが無い（前提が崩れている）');
        ['up', 'right', 'down', 'left'].forEach(slot => {
            const cw = W.fischerOpCycle(c.game, ala.target, centers[0], slot, 'cw');
            assert(cw, `${slot} を固定した回転ができない${slot === hSlot ? '（Hのスロット）' : ''}`);
            assert(relTo(ala.target, cw) === 'same', `${slot} を固定した回転で分子が変わった`);
            const back = W.fischerOpCycle(c.game, cw, centers[0], slot, 'ccw');
            assert(back && W.FischerPractice.drawingKey(back) === W.FischerPractice.drawingKey(ala.target),
                `${slot} で ⟳ の逆が ⟲ になっていない`);
        });

        // (2) 多中心: 1中心だけ反転するとジアステレオマー（鏡像ではない）
        const glc = ta.pool.find(x => x.name === 'D-グルコース（鎖状）');
        if (glc) {
            const gcs = ta.readableCenters(glc.target);
            if (gcs.length >= 2) {
                const g1 = W.fischerOpSwap(c.game, glc.target, gcs[1]);
                assert(g1 && relTo(glc.target, g1) === 'diastereomer',
                    '多中心で1中心だけの反転がジアステレオマーにならない');
            }
        }

        // (3) 出題: 開始時はお題と同じ分子ではなく、タイマーが動いている
        try { W.localStorage.removeItem('chemAssemblerTimeAttack'); } catch (e) {}
        const modeEl = D.getElementById('ta-mode');
        modeEl.value = '1'; // 入門（1中心）に固定して解の手順を機械的に決められるようにする
        ta.open();
        assert(!D.getElementById('time-attack-modal').classList.contains('hidden'), 'モーダルが開かない');
        assert(ta.current, '出題できていない');
        assert(ta.currentRelation() !== 'same', '開始時からお題と同じ分子になっている');
        assert(ta.timerId, 'タイマーが動いていない');
        assert(D.querySelectorAll('#ta-svg-a .quiz-atoms *').length > 0 &&
               D.querySelectorAll('#ta-svg-b .quiz-atoms *').length > 0, '2つの図が描かれていない');

        // (4) M2.5-A の対応づけで「立体が違う中心」を特定し、そこを鏡で反転させると完成する。
        // 回転（偶置換）を挟んでも判定は分子で行われるので完成が崩れないことも見る。
        // 十字の模型（C-5c）: 4スロット×2向きの回転ボタンと、外枠4辺の鏡ボタンだけを置く。
        // 90°回転・180°回転・軸選択つきの巡回ボタンは廃止した
        assert(!D.getElementById('btn-ta-rot90cw') && !D.getElementById('btn-ta-rot90ccw') &&
               !D.getElementById('btn-ta-rot180') && !D.getElementById('btn-ta-swap') &&
               !D.getElementById('btn-ta-cycle-cw') && !D.getElementById('btn-ta-cycle-ccw'),
            'タイムアタックに古い操作ボタン（90°/180°回転・⇄入れ替え・巡回）が残っている');
        ['up', 'right', 'down', 'left'].forEach(slot => ['cw', 'ccw'].forEach(dir => {
            assert(D.getElementById(`btn-ta-rot-${slot}-${dir}`),
                `十字の模型に btn-ta-rot-${slot}-${dir} が無い`);
        }));
        ['top', 'bottom', 'left', 'right'].forEach(edge => {
            assert(D.getElementById(`btn-ta-mirror-${edge}`), `外枠の鏡 btn-ta-mirror-${edge} が無い`);
        });
        // 十字に、選んでいる中心の4スロットのラベルが並ぶ（暗黙のHもスロットとして出る）
        assert(D.querySelectorAll('#ta-cross .cross-labels text').length === 5,
            '十字の模型に4スロット＋中心のラベルが出ていない');
        // 回転だけでは分子が変わらない（4スロットぶん押しても完成しない）
        ['up', 'right', 'down', 'left'].forEach(slot => {
            const b = D.getElementById(`btn-ta-rot-${slot}-cw`);
            if (!b.disabled) b.click();
            assert(ta.currentRelation() !== 'same', `${slot} を固定した回転だけで同じ分子になった`);
        });
        const molA = c.game.createTargetFromData({ target: ta.current.targetA });
        const molB = c.game.createTargetFromData({ target: ta.current.targetB });
        const cmp = W.stereoIsomorphismCompare(molA, W.readStereoOf(molA).stereo,
                                              molB, W.readStereoOf(molB).stereo);
        assert(cmp, '出題の組で対応づけできない');
        const wrongIdx = cmp.centers.filter(x => !x.match)
            .map(x => molB.atoms.findIndex(a => a.id === x.b))
            .filter(i => i >= 0);
        assert(wrongIdx.length > 0, '食い違う中心が無い（出題が壊れている）');
        wrongIdx.forEach(ci => {
            ta.selCenter = ci;
            // 左辺と右辺は同じ操作（縦軸の鏡）。使えないときだけ上辺（横軸の鏡）に回す
            const v = D.getElementById('btn-ta-mirror-left');
            ta.renderCross();
            (v.disabled ? D.getElementById('btn-ta-mirror-top') : v).click();
        });
        assert(ta.finished, '違う中心をすべて反転しても完成にならない');
        assert(!ta.timerId, '完成してもタイマーが止まらない');
        assert(D.getElementById('ta-status').textContent.includes('完成'), '完成の表示が出ない');
        const rec = JSON.parse(W.localStorage.getItem('chemAssemblerTimeAttack') || '{}');
        assert(rec[ta.current.entry.name] && rec[ta.current.entry.name].ms >= 0, '記録が保存されない');

        // (4b) 完成すると「実は最短は…」が出る（2026-08-01 ユーザー要望）。
        // 判定は分子なので、ふつうの最短は「立体が違う中心の数」＝回転は1手も要らない。
        // 探索（幅優先）がその手数を出し、自分の手数と並べて見せる
        assert(Array.isArray(ta.bestOps), '完成しても最短手順が求まっていない');
        assert(ta.bestOps.length === wrongIdx.length,
            `最短が ${ta.bestOps.length}手（食い違う中心 ${wrongIdx.length} 個ぶんを期待）`);
        assert(ta.bestOps.every(o => o.kind === 'mirror'),
            '最短手順に回転が混ざっている（回転は分子を変えないので最短には要らない）');
        assert(ta.mismatchCount() === wrongIdx.length,
            '食い違う中心の数（最短手数の下限）が対応づけと合っていない');
        assert(D.getElementById('ta-status').textContent.includes('最短は'), '最短手数の表示が出ない');
        assert(!D.getElementById('btn-ta-best').classList.contains('hidden'),
            '最短手順の再生ボタンが出ない');
        // 次のお題へ進むとしまわれる
        const keepCurrent = ta.current;
        ta.clearBestReplay();
        assert(ta.bestOps === null && D.getElementById('btn-ta-best').classList.contains('hidden'),
            '最短手順の再生がしまわれない');
        ta.current = keepCurrent;

        // (5) 完成後は操作できない（図が変わらない）
        const key = W.FischerPractice.drawingKey(ta.current.targetB);
        ta.applyCrossCycle('up', 'cw');
        ta.applyCrossMirror('vertical');
        assert(W.FischerPractice.drawingKey(ta.current.targetB) === key, '完成後も操作できてしまう');

        // (6) やり直しで図と手数が戻り、タイマーが再始動する
        D.getElementById('btn-ta-reset').click();
        assert(!ta.finished && ta.moves === 0 && ta.timerId, 'やり直しで仕切り直せない');
        assert(W.FischerPractice.drawingKey(ta.current.targetB) === W.FischerPractice.drawingKey(ta.current.base),
            'やり直しで最初の図に戻らない');
        // 本格（2中心以上）でも出題できて、開始時は同じ分子ではない
        modeEl.value = 'multi';
        ta.newQuestion();
        assert(ta.current && ta.readableCenters(ta.current.targetB).length >= 2, '本格の範囲で出題できない');
        assert(ta.currentRelation() !== 'same', '本格の出題が開始時から同じ分子になっている');

        // 上級は「中心を切り替えないと解けない」お題だけを出す（2026-08-01 ユーザー要望）。
        // 判定は最短手順の探索に任せ、**入れ替える中心が2種類以上**であることを確かめる
        modeEl.value = 'advanced';
        for (let i = 0; i < 5; i++) {
            ta.newQuestion();
            assert(ta.current, `上級で ${i + 1} 回目の出題ができない`);
            assert(ta.currentRelation() !== 'same', '上級の出題が開始時から同じ分子になっている');
            assert(ta.readableCenters(ta.current.targetB).length >= 2, '上級なのに中心が1つしかない');
            const ops = ta.shortestSolution();
            assert(ops, '上級の出題の最短手順が求まらない');
            const used = new Set(ops.filter(o => o.kind === 'mirror').map(o => o.center));
            assert(used.size >= 2,
                `上級なのに入れ替える中心が ${used.size} 種類（2種類以上を期待）`);
        }
        assert(D.getElementById('ta-task').textContent.includes('【上級】'), '上級の案内文が出ない');
        modeEl.value = '1';
        D.getElementById('btn-ta-close').click();
        assert(D.getElementById('time-attack-modal').classList.contains('hidden'), 'モーダルが閉じない');
        assert(!ta.timerId, '閉じてもタイマーが止まらない');
    });

    test('ST31: 記号パズル（模式模型・分子を使わない。ORDER 第2段）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const SP = W.SymbolPuzzle, sp = W.symbolPuzzle;
        assert(SP && sp, 'symbolPuzzle が初期化されていない');
        const goal = { up: 'A', right: 'B', down: 'C', left: 'D' };

        // (1) 並べ替えは24通りちょうど（＝出題ストックが尽きない、の根拠）
        const all = SP.allArrangements();
        assert(all.length === 24, `並べ替えが24通りでない（${all.length}）`);
        assert(new Set(all.map(SP.key)).size === 24, '並べ替えに重複がある');

        // (2) 回す＝偶置換（見本との関係が変わらない）／鏡＝奇置換（関係が入れ替わる）
        ['up', 'right', 'down', 'left'].forEach(slot => {
            ['cw', 'ccw'].forEach(dir => {
                const r = SP.cycle(goal, slot, dir);
                assert(SP.parity(r, goal) === 'even', `${slot}/${dir} の回転が偶置換になっていない`);
                assert(r[slot] === goal[slot], `${slot} を固定したのに ${slot} が動いた`);
                assert(SP.key(r) !== SP.key(goal), `${slot}/${dir} で並びが変わっていない`);
            });
        });
        ['vertical', 'horizontal'].forEach(axis => {
            const m = SP.mirror(goal, axis);
            assert(SP.parity(m, goal) === 'odd', `${axis} の鏡が奇置換になっていない`);
        });
        // 縦軸の鏡は左右だけ・横軸の鏡は上下だけを入れ替える
        const mv = SP.mirror(goal, 'vertical'), mh = SP.mirror(goal, 'horizontal');
        assert(mv.left === goal.right && mv.right === goal.left &&
               mv.up === goal.up && mv.down === goal.down, '縦軸の鏡が左右の入れ替えになっていない');
        assert(mh.up === goal.down && mh.down === goal.up &&
               mh.left === goal.left && mh.right === goal.right, '横軸の鏡が上下の入れ替えになっていない');

        // (3) 逆操作がすべて自明（C-5c のねらい）。
        // ⟳ の逆は ⟲／同じ回転3回で元に戻る／鏡は自分自身が逆／縦→横の鏡が180°回転
        ['up', 'right', 'down', 'left'].forEach(slot => {
            assert(SP.key(SP.cycle(SP.cycle(goal, slot, 'cw'), slot, 'ccw')) === SP.key(goal),
                `${slot}: ⟲ が ⟳ の逆になっていない`);
            let t = goal;
            for (let i = 0; i < 3; i++) t = SP.cycle(t, slot, 'cw');
            assert(SP.key(t) === SP.key(goal), `${slot}: 同じ回転3回で元に戻らない`);
        });
        ['vertical', 'horizontal'].forEach(axis => {
            assert(SP.key(SP.mirror(SP.mirror(goal, axis), axis)) === SP.key(goal),
                `${axis}: 鏡2回で元に戻らない`);
        });
        const both = SP.mirror(mv, 'horizontal');
        assert(both.up === goal.down && both.down === goal.up &&
               both.left === goal.right && both.right === goal.left,
            '縦軸の鏡→横軸の鏡が180°回転になっていない（180°ボタンを置かない根拠）');

        // (4) 24通りのどこからでも見本に届く（＝出題が詰まない）。最短は4手以内
        sp.goal = goal;
        let worst = 0;
        all.forEach(a => {
            const ops = sp.shortest(a);
            assert(ops, `${SP.key(a)} から見本に届かない`);
            worst = Math.max(worst, ops.length);
            // 求めた手順を実際になぞると見本に一致する（手順が絵空事でないことの確認）
            let t = a;
            ops.forEach(o => {
                t = o.kind === 'mirror' ? SP.mirror(t, o.axis) : SP.cycle(t, o.slot, o.dir);
            });
            assert(SP.key(t) === SP.key(goal), `${SP.key(a)} の最短手順をなぞっても見本にならない`);
        });
        assert(worst <= 4, `最短手数の最大が ${worst} 手（4手以内を期待）`);

        // (5) UI: 開いて操作でき、見本と同じ並びにすると完成する
        sp.open();
        assert(!D.getElementById('symbol-puzzle-modal').classList.contains('hidden'), 'モーダルが開かない');
        assert(D.querySelectorAll('#sp-goal .cross-labels text').length === 5, '見本の十字が描かれていない');
        assert(D.querySelectorAll('#sp-cross .cross-labels text').length === 5, '操作する十字が描かれていない');
        assert(SP.key(sp.slots) !== SP.key(sp.goal), '出題が最初から完成している');
        const plan = sp.shortest(sp.slots);
        assert(plan && plan.length, '出題の最短手順が求まらない');
        plan.forEach(o => {
            const id = o.kind === 'mirror'
                ? `btn-sp-mirror-${o.axis === 'vertical' ? 'left' : 'top'}`
                : `btn-sp-rot-${o.slot}-${o.dir}`;
            D.getElementById(id).click();
        });
        assert(sp.finished, '最短手順をボタンでなぞっても完成にならない');
        assert(sp.moves === plan.length, `手数が合わない（${sp.moves} / ${plan.length}）`);
        assert(D.getElementById('sp-status').textContent.includes('最短'), '最短手数の表示が出ない');
        // 完成後は操作できない（ボタンが無効になり、押しても並びが変わらない）
        assert(D.getElementById('btn-sp-rot-up-cw').disabled &&
               D.getElementById('btn-sp-mirror-left').disabled, '完成後もボタンが押せる');
        const done = SP.key(sp.slots);
        D.getElementById('btn-sp-rot-up-cw').click();
        assert(SP.key(sp.slots) === done, '完成後も並びが変わってしまう');

        // (6) 出題の指定が効く（回すだけで届く／鏡が要る）
        const modeEl = D.getElementById('sp-mode');
        [['same', 'even'], ['mirror', 'odd']].forEach(pair => {
            modeEl.value = pair[0];
            for (let i = 0; i < 8; i++) {
                sp.newQuestion();
                assert(SP.parity(sp.slots, sp.goal) === pair[1],
                    `出題「${pair[0]}」で ${pair[1]} でない並びが出た`);
            }
        });
        modeEl.value = 'all';
        // やり直しで最初の並びと手数に戻る
        sp.newQuestion();
        D.getElementById('btn-sp-mirror-top').click();
        D.getElementById('btn-sp-reset').click();
        assert(sp.moves === 0 && SP.key(sp.slots) === SP.key(sp.start), 'やり直しで最初に戻らない');
        D.getElementById('btn-sp-close').click();
        assert(D.getElementById('symbol-puzzle-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('ST32: 「同じ立体はどれ？」4択（記号・分子。ORDER 第3段）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const pk = W.choiceQuiz, SP = W.SymbolPuzzle;
        assert(pk, 'choiceQuiz が初期化されていない');
        const kindEl = D.getElementById('pk-kind');

        // (1) 記号の出題: 正解はちょうど1つ（偶置換）で、残り3つは鏡像（奇置換）
        kindEl.value = 'symbol';
        pk.open();
        assert(!D.getElementById('choice-quiz-modal').classList.contains('hidden'), 'モーダルが開かない');
        for (let i = 0; i < 12; i++) {
            pk.newQuestion();
            const q = pk.current;
            assert(q && q.options.length === 4, '選択肢が4つでない');
            const evens = q.options.filter(o => SP.parity(o, q.goal) === 'even');
            assert(evens.length === 1, `同じ立体の選択肢が ${evens.length} 個（1個を期待）`);
            assert(SP.parity(q.options[q.answer], q.goal) === 'even', '正解の位置が合っていない');
            assert(new Set(q.options.map(SP.key)).size === 4, '選択肢に同じ並びが混ざっている');
            assert(q.options.every(o => SP.key(o) !== SP.key(q.goal)), '見本そのものが選択肢に出ている');
            // 正解は「回すだけ」で見本に届く（＝同じ立体であることの実演）
            assert(pk.rotationRoute(q.options[q.answer], q.goal), '正解が回転だけで見本に届かない');
            assert(q.options.every((o, k) => k === q.answer || !pk.rotationRoute(o, q.goal)),
                '誤答が回転だけで見本に届いてしまう');
        }
        // 十字が5つのラベル（4スロット＋中心）で描かれ、選択肢にも出ている
        assert(D.querySelectorAll('#pk-goal .cross-labels text').length === 5, '見本の十字が描かれていない');
        for (let k = 0; k < 4; k++) {
            assert(D.querySelectorAll(`#pk-opt-${k} .cross-labels text`).length === 5,
                `選択肢 ${k + 1} の十字が描かれていない`);
        }

        // (2) 答えると正誤と解説が出て、成績が進む。二度押しは効かない
        let q = pk.current;
        const before = pk.score.asked;
        D.getElementById(`pk-cell-${q.answer}`).click();
        assert(pk.score.asked === before + 1 && pk.score.correct >= 1, '成績が進まない');
        assert(D.getElementById('pk-result').textContent.includes('正解'), '正誤の表示が出ない');
        assert(D.getElementById(`pk-cell-${q.answer}`).classList.contains('pk-cell-right'),
            '正解のマスが光らない');
        D.getElementById(`pk-cell-${(q.answer + 1) % 4}`).click();
        assert(pk.score.asked === before + 1, '答えたあとにもう一度答えられてしまう');
        // 誤答すると、選んだマスに×の印が付く
        pk.newQuestion();
        q = pk.current;
        const wrong = (q.answer + 1) % 4;
        D.getElementById(`pk-cell-${wrong}`).click();
        assert(D.getElementById(`pk-cell-${wrong}`).classList.contains('pk-cell-wrong'),
            '誤答のマスに印が付かない');
        assert(D.getElementById(`pk-cell-${q.answer}`).classList.contains('pk-cell-right'),
            '誤答のとき正解のマスが示されない');

        // (3) 分子の出題: 正解はちょうど1つで、残り3つは別の立体異性体
        kindEl.value = 'molecule';
        for (let i = 0; i < 6; i++) {
            pk.newQuestion();
            const mq = pk.current;
            assert(mq && mq.kind === 'molecule', `分子の出題ができない（${i + 1}回目）`);
            const rels = mq.options.map(o => pk.relTo(mq.goal, o));
            assert(rels.filter(r => r === 'same').length === 1,
                `同じ立体異性体の選択肢が ${rels.filter(r => r === 'same').length} 個（1個を期待）`);
            assert(rels[mq.answer] === 'same', '正解の位置が合っていない');
            assert(new Set(mq.options.map(W.FischerPractice.drawingKey)).size === 4,
                '選択肢に同じ図が混ざっている');
            // 選択肢が分子として描かれている（十字の絵は引っ込んでいる）
            assert(D.querySelectorAll('#pk-opt-0 .quiz-atoms *').length > 0, '選択肢に分子が描かれていない');
            assert(D.querySelector('#pk-opt-0 .pk-cross-art').style.display === 'none',
                '分子モードで十字の絵が残っている');
        }
        // 記号に戻すと十字の絵が復帰する（1つの SVG を使い回しているので、ここが崩れやすい）
        kindEl.value = 'symbol';
        pk.newQuestion();
        assert(D.querySelector('#pk-opt-0 .pk-cross-art').style.display !== 'none',
            '記号モードに戻しても十字の絵が出てこない');
        assert(D.querySelectorAll('#pk-opt-0 .quiz-atoms *').length === 0,
            '記号モードに分子の絵が残っている');
        assert(D.getElementById('pk-opt-0').getAttribute('viewBox') === '0 0 300 200',
            '記号モードで viewBox が戻っていない');
        D.getElementById('btn-pk-close').click();
        assert(D.getElementById('choice-quiz-modal').classList.contains('hidden'), 'モーダルが閉じない');
    });

    test('ST33: D/L を図から計算する（ORDER 第4段 4a。CIP は使わない）', async (c) => {
        c.reset();
        const W = c.W, D = c.D, g = c.game;
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []).filter(e => e.target);
        const dlOf = target => W.assignDLDescriptor(g.createTargetFromData({ target }));

        // (1) 名前に D-/L- が付いた化合物すべてで、**図から計算した文字が名前と一致する**。
        // これまでは名前を引いているだけで計算していなかった（発注書 4a）
        const named = source.filter(e => /^[DL]-/.test(e.name));
        assert(named.length >= 9, `D-/L- の付いた化合物が少なすぎる（${named.length}）`);
        named.forEach(e => {
            const r = dlOf(e.target);
            assert(r, `${e.name}: D/L を計算できない`);
            assert(r.letter === e.name[0],
                `${e.name}: 計算が ${r.letter} になった（名前と食い違う）`);
        });
        // 3系統がそろって出ている（アミノ酸・糖・α-ヒドロキシ酸）
        const kinds = new Set(named.map(e => dlOf(e.target).kind));
        ['amino', 'sugar', 'hydroxyacid'].forEach(k =>
            assert(kinds.has(k), `${k} の判定が1件も出ていない`));

        // (2) 鏡像にすると必ずもう一方の文字になる（定義の対称性）
        named.forEach(e => {
            // 原子IDは分子を作るたびに振り直される乱数なので、**同じ分子オブジェクトから**引く
            const mol = g.createTargetFromData({ target: e.target });
            const r = W.assignDLDescriptor(mol);
            const idx = mol.atoms.findIndex(a => a.id === r.centerId);
            // 縦軸の鏡が使えない図（グリセルアルデヒド）もあるので、横軸へ落ちる既存APIを使う
            const m = W.fischerOpSwap(g, e.target, idx);
            assert(m, `${e.name}: 基準の中心で鏡が使えない`);
            const r2 = dlOf(m);
            assert(r2 && r2.letter !== r.letter,
                `${e.name}: 鏡像にしても ${r2 ? r2.letter : 'null'} のまま`);
        });

        // (3) 断定しない場合をきちんと null にする（嘘をつかない）
        //   ・酒石酸 … 基準の候補が2つあり、最下位の選び方で答えが変わる
        //   ・エタノール … 不斉炭素が無い
        const tartaric = source.find(e => e.name === '酒石酸');
        if (tartaric) assert(dlOf(tartaric.target) === null, '酒石酸で D/L を断定してしまう');
        const etoh = source.find(e => e.name === 'エタノール');
        if (etoh) assert(dlOf(etoh.target) === null, '不斉炭素が無いのに D/L を返す');
        // エステルは鎖の頭にしない（油脂のモノグリセリドを糖のように読んで L体 と言い出さない）
        const mono = source.find(e => /モノステアリン酸グリセリド/.test(e.name));
        if (mono) assert(dlOf(mono.target) === null, 'モノグリセリドに D/L を付けてしまう');
        // 糖から作った酸は**最下位**で読む（α炭素で読むと D-グルコース由来なのに L になる）
        const gluconic = source.find(e => e.name === 'グルコン酸');
        if (gluconic) {
            const r = dlOf(gluconic.target);
            assert(r && r.letter === 'D', `グルコン酸が ${r ? r.letter : 'null'}（D を期待）`);
        }
        // 主鎖を横にした図（フィッシャー投影として読まない向き）は null
        const ala = source.find(e => e.name === 'D-アラニン');
        assert(ala, 'D-アラニンがライブラリに無い');
        assert(dlOf(W.rotateTargetInPlane(ala.target, 1, false)) === null,
            '主鎖が横向きの図でも D/L を読んでしまう');

        // (4) 4択の出題: 正解はちょうど1つ、選択肢は4つとも別の化合物
        const pk = W.choiceQuiz;
        const kindEl = D.getElementById('pk-kind');
        kindEl.value = 'dl';
        pk.open();
        for (let i = 0; i < 10; i++) {
            pk.newQuestion();
            const q = pk.current;
            assert(q && q.kind === 'dl', `D/L の出題ができない（${i + 1}回目）`);
            const letters = q.items.map(x => x.letter);
            assert(letters.filter(l => l === q.want).length === 1,
                `${q.want}体の選択肢が ${letters.filter(l => l === q.want).length} 個（1個を期待）`);
            assert(q.items[q.answer].letter === q.want, '正解の位置が合っていない');
            assert(new Set(q.items.map(x => x.base)).size === 4, '同じ化合物が選択肢に重複している');
            // 名前と文字が食い違わない（鏡像をその場で作ると「L-アラニン＝D体」のような
            // 矛盾した表示になる。多中心の糖では名乗れる名前にすらならない）
            q.items.forEach(x => {
                if (/^[DL]-/.test(x.name)) {
                    assert(x.name[0] === x.letter,
                        `${x.name} を ${x.letter}体 として出している（名前と食い違う）`);
                }
            });
            // 出題に使う図は、図から読み直しても同じ文字になる（180°回した図は入れない）
            q.options.forEach((t, k) => {
                const r = dlOf(t);
                assert(r && r.letter === q.items[k].letter && !r.flipped,
                    `選択肢 ${k + 1} の図が読み直せない（または180°回した図が混ざっている）`);
            });
        }
        // 見本のペインには分子ではなく「D体」「L体」の文字が出る
        const goalText = D.querySelector('#pk-goal .pk-goal-letter');
        assert(goalText && goalText.textContent === `${pk.current.want}体`, '見本に探す文字が出ていない');
        assert(D.querySelectorAll('#pk-goal .quiz-atoms *').length === 0, '見本に分子が描かれている');
        assert(D.querySelectorAll('#pk-opt-0 .quiz-atoms *').length > 0, '選択肢に分子が描かれていない');

        // (5) 答えると、規則を名指しした解説が出る
        const q = pk.current;
        D.getElementById(`pk-cell-${(q.answer + 1) % 4}`).click();
        const text = D.getElementById('pk-result').textContent;
        assert(text.includes(q.items[q.answer].name), '正解の化合物名が解説に出ない');
        assert(/-NH₂|-OH/.test(text), '基準の置換基が解説に出ない');
        assert(text.includes('右') || text.includes('左'), '右か左かが解説に出ない');
        kindEl.value = 'symbol';
        D.getElementById('btn-pk-close').click();
    });

    test('ST37: 長い鎖を畳んで描く（レビュー項目25・第1段）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const src = (W.COMPOUNDS || []).concat(W.STAGES || []).filter(e => e.target);
        const byName = n => (src.find(e => e.name === n) || {}).target;
        const width = t => Math.max(...t.atoms.map(a => a.x)) - Math.min(...t.atoms.map(a => a.x));

        // (1) 長い鎖は畳まれ、**図の幅も縮む**（ラベルに置き換えるだけでは縮まない、が要点）
        const st = byName('ステアリン酸');
        assert(st, 'ステアリン酸がライブラリに無い');
        const cs = W.condenseChainForDisplay(st);
        assert(cs, 'ステアリン酸が畳まれない');
        assert(cs.labels.length === 1 && cs.labels[0].text === '(CH₂)₁₆',
            `ラベルが (CH₂)₁₆ でない（${cs.labels.map(l => l.text).join(',')}）`);
        assert(cs.atoms.length < st.atoms.length, '原子が減っていない');
        assert(width(cs) < width(st) / 3, `幅が縮んでいない（${Math.round(width(st))}→${Math.round(width(cs))}）`);
        // 畳んだあとも図がつながっている（結合の添字が振り直されている）
        assert(cs.bonds.every(b => b.atom1Index < cs.atoms.length && b.atom2Index < cs.atoms.length),
            '畳んだあとの結合の添字が範囲外');

        // (2) 短い分子・環・不斉炭素を含む鎖は畳まない（立体を壊さないため）
        ['エタノール', '酢酸', 'ベンゼン', 'シクロヘキサン', 'D-乳酸', 'D-アラニン'].forEach(n => {
            const t = byName(n);
            if (t) assert(W.condenseChainForDisplay(t) === null, `${n} を畳んでしまう`);
        });
        // ライブラリの大半は今までどおり（畳むのは長い鎖を持つものだけ）
        const changed = src.filter(e => W.condenseChainForDisplay(e.target)).length;
        assert(changed > 0 && changed < src.length / 4,
            `畳む分子が多すぎる／少なすぎる（${changed} / ${src.length}）`);

        // (3) **「同じ化合物？」では畳まない**（主鎖を曲げて出題するので、曲げた側だけ
        // 畳まれず同じ分子の2枚が別物に見えてしまう）。既定は畳まない
        const svgId = 'quiz-svg-a';
        if (D.getElementById(svgId)) {
            W.renderMoleculeIntoSvg(c.game, svgId, st, false);
            assert(!D.querySelector(`#${svgId} .chain-condensed`),
                '「同じ化合物？」の図で鎖が畳まれている（出題の前提が壊れる）');
            W.renderMoleculeIntoSvg(c.game, svgId, st, false, true);
            assert(D.querySelector(`#${svgId} .chain-condensed`),
                '畳むよう頼んでもラベルが出ない');
        }
    });

    test('ST35: 「同じ？違う？」を連続で出してタイムを計る（発注書 第3段の残り）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const pk = W.choiceQuiz;
        assert(pk, 'choiceQuiz が初期化されていない');
        const kindEl = D.getElementById('pk-kind');
        assert([...kindEl.options].some(o => o.value === 'pair'),
            '出題に「同じ？違う？」が無い');
        kindEl.value = 'pair';
        pk.open();

        // (1) 出題の「同じ/違う」が**図から読み直した関係**と必ず一致する。両方が出る
        let same = 0, diff = 0;
        for (let i = 0; i < 16; i++) {
            pk.newQuestion();
            const q = pk.current;
            assert(q && q.kind === 'pair', `出題できない（${i + 1}回目）`);
            assert(q.options.length === 1, '「同じ？違う？」は図を1つだけ出す');
            const rel = pk.relTo(q.goal, q.options[0]);
            assert((rel === 'same') === q.isSame,
                `出題の答えが図と食い違う（rel=${rel} isSame=${q.isSame}）`);
            assert(q.isSame || rel === 'enantiomer' || rel === 'diastereomer',
                `「違う」の中身が立体異性体でない（${rel}）`);
            if (q.isSame) same++; else diff++;
        }
        assert(same > 0 && diff > 0, `出題が偏っている（同じ ${same} / 違う ${diff}）`);

        // (2) 画面: 図は1つだけ・2択のボタンが出る
        assert([1, 2, 3].every(n => D.getElementById(`pk-cell-${n}`).classList.contains('hidden')),
            '「同じ？違う？」で選択肢が4つとも出ている');
        assert(!D.getElementById('pk-pair-answer').classList.contains('hidden'),
            '2択のボタンが出ていない');
        assert(D.querySelectorAll('#pk-opt-0 .quiz-atoms *').length > 0, '比べる図が描かれていない');

        // (3) 正解・誤答で成績と連続数が動く。答えたあとは押せない
        pk.newQuestion();
        let q = pk.current;
        const asked0 = pk.score.asked;
        D.getElementById(q.isSame ? 'btn-pk-same' : 'btn-pk-diff').click();
        assert(pk.score.asked === asked0 + 1 && pk.streak >= 1, '正解しても成績・連続数が進まない');
        assert(D.getElementById('pk-result').textContent.includes('正解'), '正誤の表示が出ない');
        assert(D.getElementById('btn-pk-same').disabled && D.getElementById('btn-pk-diff').disabled,
            '答えたあとにもう一度答えられてしまう');
        assert(D.getElementById('pk-streak').textContent.includes('連続'), '連続数が出ない');
        pk.newQuestion();
        q = pk.current;
        D.getElementById(q.isSame ? 'btn-pk-diff' : 'btn-pk-same').click();
        assert(pk.streak === 0, '誤答で連続数が切れない');
        assert(D.getElementById('pk-result').textContent.includes('不正解'), '誤答の表示が出ない');

        // (4) ほかの出題に戻すと、4択のレイアウトへ戻る（1つのモーダルを使い回しているので崩れやすい）
        kindEl.value = 'molecule';
        pk.newQuestion();
        assert([1, 2, 3].every(n => !D.getElementById(`pk-cell-${n}`).classList.contains('hidden')),
            '4択に戻しても選択肢が隠れたまま');
        assert(D.getElementById('pk-pair-answer').classList.contains('hidden'),
            '4択に戻しても2択のボタンが残っている');
        assert(D.querySelector('#pk-cell-0 .pk-badge').textContent === '①',
            '4択に戻しても①の番号が戻らない');
        kindEl.value = 'symbol';
        D.getElementById('btn-pk-close').click();
    });

    test('ST39: クイズの出題を指定できる（ORDER の追加依頼。収録の撮り直しを無くす）', async (c) => {
        c.reset();
        const W = c.W, D = c.D;
        const q = W.quiz, sq = W.stereoQuiz;
        assert(q && typeof q.setForced === 'function', '「同じ化合物？」に出題の指定が無い');
        assert(sq && typeof sq.setForced === 'function', '立体異性体クイズに出題の指定が無い');

        // (1) 既定は指定なし＝今までどおり乱数（画面に何も足していないことの裏返し）
        assert(q.forced === null && sq.forced === null, '既定で出題が固定されている');
        assert(!D.getElementById('quiz-forced') && !D.getElementById('sq-forced'),
            '出題指定の UI が画面に足されている（入口は増やさない方針）');

        // (2) 「同じ化合物？」… 指定したとおりの答えだけが出る。
        // **判定は verifyMolecule（＝生成の狙いではなく実際の関係）**なので、
        // これが揃えば台本から答えを固定できる
        q.open();
        ['same', 'diff'].forEach(want => {
            q.setForced(want);
            assert(q.forced === want, `指定が入らない（${want}）`);
            for (let i = 0; i < 12; i++) {
                q.nextQuestion();
                assert(q.current, `指定 ${want} で出題できない（${i + 1}回目）`);
                assert(q.current.isSame === (want === 'same'),
                    `指定 ${want} なのに ${q.current.isSame ? '同じ' : '違う'} が出た（${i + 1}回目）`);
            }
        });
        // 解除すると両方が出る（固定したままにならない）
        q.setForced(null);
        assert(q.forced === null, '指定を解除できない');
        let same = 0, diff = 0;
        for (let i = 0; i < 40; i++) { q.nextQuestion(); q.current.isSame ? same++ : diff++; }
        assert(same > 0 && diff > 0, `解除後も片方しか出ない（同じ ${same} / 違う ${diff}）`);
        D.getElementById('btn-quiz-close').click();

        // (3) 立体異性体クイズ … 3種類とも指定できる。
        // 「発展」でないと鏡像・ジアステレオマーの出題が揃わないのでモードを上げる
        const mode = D.getElementById('sq-mode');
        const savedMode = mode ? mode.value : null;
        if (mode) mode.value = 'all';
        sq.open();
        ['same', 'enantiomer', 'diastereomer'].forEach(want => {
            sq.setForced(want);
            for (let i = 0; i < 6; i++) {
                sq.nextQuestion();
                assert(sq.current, `指定 ${want} で出題できない（${i + 1}回目）`);
                assert(sq.current.rel === want,
                    `指定 ${want} なのに ${sq.current.rel} が出た（${i + 1}回目）`);
            }
        });
        sq.setForced(null);
        assert(sq.forced === null, '立体クイズの指定を解除できない');
        if (mode && savedMode !== null) mode.value = savedMode;
        D.getElementById('btn-sq-close').click();

        // (4) 不正な値は受け付けない（台本の書き間違いを黙って通さない）
        q.setForced('まちがい');
        assert(q.forced === null, '知らない指定を受け付けてしまう');

        // (5) 台本のアクション `quizForce` から指定でき、**再生が終わると元に戻る**
        // （戻らないと、SNS デモを続けて再生する N2 で前の指定が次の台本に効く）
        const tp = W.tutorialPlayer;
        tp.tutorials.push({
            id: '__forceprobe__', title: 'probe',
            steps: [{ caption: 'x', actions: [{ type: 'quizForce', quiz: 'same', value: 'diff' }] }]
        });
        await tp.play('__forceprobe__', { fast: true });
        assert(!tp.lastError, `quizForce の台本が落ちた: ${tp.lastError && tp.lastError.message}`);
        assert(q.forced === null, '台本の指定が再生後も残っている');
        tp.tutorials = tp.tutorials.filter(t => t.id !== '__forceprobe__');
    });

    test('ST40: 立体を名前に出すのは縦置きの図だけ（レビュー項目21 の2点目）', async (c) => {
        c.reset();
        const W = c.W, g = c.game;
        const lib = g.getCompoundLibrary();
        const byName = n => lib.find(e => e.name === n);
        assert(typeof W.isFischerOriented === 'function', 'isFischerOriented が公開されていない');

        // (1) 向きの判定が、ライブラリの意図とぴったり二分される。
        // 縦＝立体を意図した登録（糖・D/L 付き）、横＝意図していない登録
        const 縦 = ['D-グルコース（鎖状）', 'D-グリセルアルデヒド', 'L-グリセルアルデヒド',
                    'D-アラニン', 'L-アラニン', 'D-乳酸', 'L-乳酸', 'グルコン酸'];
        const 横 = ['乳酸', 'セリン', 'システイン', 'バリン', 'リシン', '酒石酸',
                    '2-ブタノール', '3-メチルヘキサン'];
        縦.forEach(n => {
            const e = byName(n);
            assert(e && W.isFischerOriented(e.mol), `${n} が縦置きと判定されない`);
        });
        横.forEach(n => {
            const e = byName(n);
            assert(e && !W.isFischerOriented(e.mol), `${n} が縦置きと判定されている`);
        });
        // 十字を1つも持たない図は「制約なし」＝true（環だけの糖・立体なしの分子）
        const benzene = byName('ベンゼン');
        if (benzene) assert(W.isFischerOriented(benzene.mol), '十字の無い図が false になる');

        // (2) トグル ON でも、横置きの図には立体の接頭辞を付けない。
        // **v433 で乳酸の -OH を軸上に戻したときに出た「D-乳酸」を名乗る副作用がこれで消える**
        const saved = g.readStereo;
        g.setReadStereo(true);
        assert(g.lookupCompoundName(byName('乳酸').mol) === '乳酸',
            `横置きの乳酸が ${g.lookupCompoundName(byName('乳酸').mol)} を名乗る`);
        ['セリン', 'バリン', '酒石酸'].forEach(n => {
            assert(g.lookupCompoundName(byName(n).mol) === n, `${n} に立体の接頭辞が付く`);
        });
        // 縦置きの登録はこれまでどおり立体つきで名乗る（門番が効きすぎていない）
        [['D-乳酸', 'D-乳酸'], ['L-乳酸', 'L-乳酸'], ['D-アラニン', 'D-アラニン'],
         ['D-グルコース（鎖状）', 'D-グルコース（鎖状）'],
         ['α-D-グルコース（α-D-グルコピラノース）', 'α-D-グルコース（α-D-グルコピラノース）']]
            .forEach(([n, want]) => {
                assert(g.lookupCompoundName(byName(n).mol) === want,
                    `${n} が ${g.lookupCompoundName(byName(n).mol)} になる`);
            });
        // シス/トランス（結合の幾何）は向きに関係なく残る
        ['マレイン酸', 'フマル酸'].forEach(n => {
            assert(g.lookupCompoundName(byName(n).mol) === n, `${n} の幾何異性が消えた`);
        });
        g.setReadStereo(saved);

        // (3) **立体の読み取り自体には門番を掛けていない**。
        // 掛けるとパズルが壊れる: 3巡回で枝が動くと主鎖が横に来る図がふつうに現れ、
        // タイムアタックの出題の大半（実測 15問中12問）が横置きの分子から作られている
        横.forEach(n => {
            const e = byName(n);
            const ids = Object.keys(W.readAtomParityFromFischer(e.mol));
            assert(ids.length > 0, `${n} の立体が読めなくなっている（パズルが成立しない）`);
        });
        // 図から読んだ立体コードにもパリティが残る（同型判定・パズルの正誤は変わらない）。
        // **エントリ側の `stereoCode` を見てはいけない** … あれは JSON の `stereo` 指定から
        // 作るもので、素の乳酸のように立体を指定していない登録では最初から null。
        // ここで確かめたいのは「**図から**読める立体が消えていないこと」
        const lactic = byName('乳酸').mol;
        const drawn = W.canonicalStereoCode(lactic, {
            atomParity: { ...W.readAtomParityFromFischer(lactic), ...W.readRingParityFromHaworth(lactic) },
            bondGeo: W.readBondGeoFromCoords(lactic)
        });
        assert(/\|s/.test(drawn), `横置きの図から立体コードが消えた（${drawn}）`);
    });

    test('ST41: ハースの読みを「環外2本」へ広げても既存アルドースが1つも変わらない（§6-3）', async (c) => {
        c.reset();
        const W = c.W, g = c.game;
        // 添字キーに直して読む（**原子IDは乱数**なので順序にも値にも頼らない）
        const parOf = (nm, mutate) => {
            const e = W.COMPOUNDS.find(x => x.name === nm);
            assert(e, `${nm} が compounds.json に無い`);
            const mol = g.createTargetFromData({ target: e.target });
            if (mutate) mutate(mol);
            const p = W.readRingParityFromHaworth(mol);
            const out = {};
            Object.keys(p).forEach(id => { out[mol.atoms.findIndex(a => a.id === id)] = p[id]; });
            return out;
        };
        const show = o => Object.keys(o).map(Number).sort((a, b) => a - b)
            .map(k => `${k}:${o[k]}`).join(' ');
        // 座標を指定して原子を取る（図を変えたらこのテストも直す、が意図）
        const at = (mol, x, y) => {
            const a = mol.atoms.find(p => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5);
            assert(a, `(${x},${y}) に原子が無い`);
            return a;
        };

        // ---- (1) **これが最重要**: 環外1本の中心（アルドースのアノマー炭素・C2〜C5）の読みが
        //      1つも変わっていない。期待値をベタ書きで固定してあるので、拡張が既存へ漏れたら落ちる。
        //      添字は登録の atoms 順（ピラノースは 0=環O・1=C1・…・5=C5、二糖は 11=環O・12=C1'・…）
        const 既存 = [
            ['β-D-グルコース（β-D-グルコピラノース）', { 1: -1, 2: -1, 3: 1, 4: 1, 5: 1 }],
            ['α-D-グルコース（α-D-グルコピラノース）', { 1: 1, 2: -1, 3: 1, 4: 1, 5: 1 }],
            ['β-D-ガラクトース（β-D-ガラクトピラノース）', { 1: -1, 2: -1, 3: 1, 4: -1, 5: 1 }],
            ['α-D-ガラクトース（α-D-ガラクトピラノース）', { 1: 1, 2: -1, 3: 1, 4: -1, 5: 1 }],
            ['β-D-マンノース（β-D-マンノピラノース）', { 1: -1, 2: 1, 3: 1, 4: 1, 5: 1 }],
            ['α-D-マンノース（α-D-マンノピラノース）', { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }],
            ['マルトース（麦芽糖）', { 1: -1, 2: 1, 3: -1, 4: 1, 5: 1, 12: 1, 13: 1, 14: -1, 15: 1, 16: 1 }],
            ['セロビオース', { 1: 1, 2: 1, 3: -1, 4: 1, 5: 1, 12: -1, 13: 1, 14: -1, 15: 1, 16: 1 }],
            ['ラクトース（乳糖）', { 1: 1, 2: 1, 3: -1, 4: -1, 5: 1, 12: -1, 13: 1, 14: -1, 15: 1, 16: 1 }]
        ];
        既存.forEach(([nm, want]) => {
            const got = parOf(nm);
            assert(show(got) === show(want), `${nm} の環パリティが変わった（${show(got)}／期待 ${show(want)}）`);
        });
        // α と β は**アノマー炭素（添字1）1つだけ**が違う、という関係も崩れていない
        [['α-D-グルコース（α-D-グルコピラノース）', 'β-D-グルコース（β-D-グルコピラノース）'],
         ['α-D-ガラクトース（α-D-ガラクトピラノース）', 'β-D-ガラクトース（β-D-ガラクトピラノース）'],
         ['α-D-マンノース（α-D-マンノピラノース）', 'β-D-マンノース（β-D-マンノピラノース）']]
            .forEach(([a, b]) => {
                const pa = parOf(a), pb = parOf(b);
                const diff = Object.keys(pa).filter(k => pa[k] !== pb[k]);
                assert(diff.join() === '1', `${a} と ${b} の違いが添字1だけでない（${diff.join()}）`);
            });

        // ---- (2) 環外2本の中心（ケトースのアノマー炭素）が**読めるようになった**。
        //      拡張前はここが空で、α/β を区別する立体コードが作れなかった
        const fa = parOf('α-D-フルクトフラノース'), fb = parOf('β-D-フルクトフラノース');
        assert(Object.keys(fa).length === 4, `α の読めた中心が ${Object.keys(fa).length} 個（4個のはず）`);
        assert(fa[1] === -fb[1] && fa[1] !== undefined,
            `フルクトフラノースの C2 が α/β で逆になっていない（${fa[1]}／${fb[1]}）`);

        // ---- (3) **負の対照その1**: 環外2本を同じ面へ描くと、記述子を作らない（黙って片方を信じない）
        const 同面 = parOf('β-D-フルクトフラノース', mol => { at(mol, 470, 340).y = 272; });
        assert(同面[1] === undefined,
            `環外2本を同じ面に描いても C2 を読んでしまう（${同面[1]}）`);

        // ---- (4) **負の対照その2**: 2本の面を入れ替えると符号が逆になる
        //      ＝ 読みが座標で効いている裏取り（宣言だけで通っていない）
        const 入替 = parOf('β-D-フルクトフラノース', mol => {
            const oh = at(mol, 470, 264), c1 = at(mol, 470, 340), c1o = at(mol, 470, 378);
            oh.y = 340; c1.y = 264; c1o.y = 226;
        });
        assert(入替[1] === -fb[1], `2本を入れ替えても符号が変わらない（${入替[1]}／${fb[1]}）`);
        assert(入替[1] === fa[1], '入れ替えた図が α と同じ読みにならない');

        // ---- (5) 規約: 面は**優先順位の高い置換基（酸素側）**が決め、もう1本は必ず反対面。
        //      主置換基が縦から外れて読めないときだけ、劣位側（-CH₂OH）を反転して使う。
        //      スクロースのグリコシド酸素は縦から 29.5°（許容±25°の外）に描かれているので、
        //      **この抜け道が効いてはじめてフルクトース側の C2 が読める**
        const suc = parOf('スクロース（ショ糖）');
        assert(suc[13] !== undefined, 'スクロースのフルクトース側 C2（添字13）が読めない');
        // 環9中心ぶんの読みを丸ごと固定する。**この値は R/S に直して IUPAC 名と突き合わせてある**:
        //   グルコース側 = α-D-グルコピラノシル (2R,3R,4S,5S,6R)
        //   フルクトース側 = β-D-フルクトフラノシル (2S,3S,4S,5R)
        // （フルクトース環の C3・C4 は v710 まで裏返っていた。§6-3 を参照）
        assert(show(suc) === show({ 1: -1, 2: -1, 3: 1, 4: -1, 5: 1, 13: 1, 14: -1, 15: 1, 16: 1 }),
            `スクロースの環パリティが違う（${show(suc)}）`);
        // 劣位側も縦から外すと、両方読めなくなってスキップされる（抜け道が無条件ではない）
        const suc2 = parOf('スクロース（ショ糖）', mol => { at(mol, 540, 420).x = 580; });
        assert(suc2[13] === undefined, '環外2本とも縦から外れているのに C2 を読んでしまう');
        // 同じ図をフルクトフラノース単体で確かめる（斜めの -OH でも読め、読みは変わらない）
        const 斜め = parOf('β-D-フルクトフラノース', mol => { at(mol, 470, 264).x = 530; });
        assert(斜め[1] === fb[1],
            `-OH を斜めに描くと読みが変わる（${斜め[1]}／${fb[1]}）`);
    });

    test('ST36: R/S を図から判定する（ORDER 第4段 4b。CIP の順位づけ）', async (c) => {
        c.reset();
        const W = c.W, g = c.game;
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []).filter(e => e.target);
        const find = name => {
            const e = source.find(x => x.name === name);
            assert(e, `${name} がライブラリに無い`);
            return e;
        };
        // 図の上から順に記号を並べる（フィッシャー投影は C1 が上なので、これが番号順になる）
        const lettersOf = target => {
            const mol = g.createTargetFromData({ target });
            const rs = W.assignRSDescriptor(mol);
            if (!rs) return null;
            return Object.keys(rs)
                .map(id => ({ y: mol.atoms.find(a => a.id === id).y, letter: rs[id].letter }))
                .sort((p, q) => p.y - q.y).map(x => x.letter).join('');
        };
        // 中心の座標をキーにした記号の表（原子IDは作り直すたびに変わるので座標で照合する）
        const lettersByPos = target => {
            const mol = g.createTargetFromData({ target });
            const rs = W.assignRSDescriptor(mol) || {};
            const out = {};
            Object.keys(rs).forEach(id => {
                const a = mol.atoms.find(x => x.id === id);
                out[`${a.x},${a.y}`] = rs[id].letter;
            });
            return out;
        };

        // (1) 教科書で R/S が確定している化合物の期待値（上の中心から順に並べた文字列）
        const EXPECT = {
            'D-グリセルアルデヒド': 'R', 'L-グリセルアルデヒド': 'S',
            'D-アラニン': 'R', 'L-アラニン': 'S',
            'D-乳酸': 'R', 'L-乳酸': 'S',
            'D-グルコース（鎖状）': 'RSRR',   // (2R,3S,4R,5R)
            'D-ガラクトース（鎖状）': 'RSSR', // (2R,3S,4S,5R)
            'D-マンノース（鎖状）': 'SSRR',   // (2S,3S,4R,5R)
            'D-フルクトース（鎖状）': 'SRR',  // (3S,4R,5R)
            'グルコン酸': 'RSRR'              // D-グルコン酸 (2R,3S,4R,5R)
        };
        Object.keys(EXPECT).forEach(name => {
            const got = lettersOf(find(name).target);
            assert(got === EXPECT[name], `${name}: ${got} と読んだ（${EXPECT[name]} を期待）`);
        });
        // D/L と R/S は別の規則。名前が D でも一番上の中心は S になりうる（D-マンノース）
        assert(lettersOf(find('D-マンノース（鎖状）').target)[0] === 'S',
            'D体なら R という思い込みが混ざっている');

        // (2) 鏡像にすると、その中心だけが必ず反対の記号になる（化合物ごとの正解を知らずに検査できる不変量）
        ['D-グリセルアルデヒド', 'L-アラニン', 'D-乳酸', 'D-グルコース（鎖状）'].forEach(name => {
            const target = find(name).target;
            const before = lettersByPos(target);
            const mol = g.createTargetFromData({ target });
            const rs = W.assignRSDescriptor(mol);
            Object.keys(rs).forEach(id => {
                const a = mol.atoms.find(x => x.id === id);
                const key = `${a.x},${a.y}`;
                const m = W.fischerOpSwap(g, target, mol.atoms.findIndex(x => x.id === id));
                assert(m, `${name}: 中心(${key}) で鏡が使えない`);
                const after = lettersByPos(m);
                assert(after[key] && after[key] !== before[key],
                    `${name}: 中心(${key}) を反転しても ${after[key]} のまま`);
                // 触っていない中心は動かない（順位づけはつながり方だけで決まる＝規則1で閉じている）
                Object.keys(before).forEach(k => {
                    if (k === key) return;
                    assert(after[k] === before[k],
                        `${name}: 中心(${key}) を反転したら別の中心(${k}) まで変わった`);
                });
            });
        });

        // (3) 断定しない場合（設計書 4章）。嘘をつくくらいなら黙る
        //   ・主鎖を**横**に描いた普通の構造式は、投影の約束（縦=奥）で描かれていない。
        //     ここを通すと、立体を指定していない図に記号を付けてしまう
        ['アラニン', 'システイン', 'フェニルアラニン', '酒石酸'].forEach(name => {
            const e = source.find(x => x.name === name);
            if (e) assert(lettersOf(e.target) === null,
                `${name}: 投影として描かれていない図（主鎖が横）に R/S を付けている`);
        });
        //   ・90°回した図は縦横が入れ替わる＝もう投影として読めない
        assert(lettersOf(W.rotateTargetInPlane(find('D-アラニン').target, 1, false)) === null,
            '90°回した図でも R/S を読んでしまう');
        //   ・180°回した図は同じ分子。記号も変わらない
        assert(lettersOf(W.rotateTargetInPlane(find('D-アラニン').target, 2, false)) === 'R',
            '180°回しただけで R/S が変わる');
        //   ・環の中の中心はハースの担当（相互排他）
        assert(lettersOf(find('β-D-グルコース（β-D-グルコピラノース）').target) === null,
            '環の中の中心に R/S を付けている');
        //   ・不斉炭素が無い
        const etoh = source.find(x => x.name === 'エタノール');
        if (etoh) assert(lettersOf(etoh.target) === null, '不斉炭素が無いのに R/S を返す');

        // (4) 順位づけそのもの（cipRank）。座標に依らない純関数として単体で確かめる
        //   グリセルアルデヒドの中心: -OH > -CHO > -CH₂OH > H
        //   ＝ ①原子番号（O が C に勝つ）と ②重複原子（=O を2つに数えて -CHO が -CH₂OH に勝つ）
        {
            const mol = g.createTargetFromData({ target: find('D-グリセルアルデヒド').target });
            const centerId = mol.atoms.find(a => a.element === 'C' && mol.isAsymmetricCarbon(a.id)).id;
            const order = W.cipRank(mol, centerId);
            assert(order && order.length === 4, 'cipRank が順位を返さない');
            const at = ref => mol.atoms.find(a => a.id === ref);
            assert(at(order[0]).element === 'O', `1位が ${at(order[0]).element}（-OH を期待）`);
            assert(mol.getNeighbors(order[1]).some(n => n.type === 2 && n.atom.element === 'O'),
                '2位が -CHO でない（重複原子を数えていない）');
            assert(mol.getNeighbors(order[2]).every(n => n.type === 1),
                '3位が -CH₂OH でない');
            assert(order[3] === 'H', '4位が H でない');
        }
        //   同順位の掘り下げは**球ごと**に行う（1本目の枝を掘り切る実装だと逆が出る形で固定する）
        //   A = -CH(CH₂CH₂OH)(CH₃) ／ B = -CH(CH₂CH₂CH₃)(CH₂CH₃)
        //   第3球の4つ目で B の C が A の H に勝つ。掘り切ると A の第4球の O が先に効いて逆になる
        {
            const m = new W.Molecule();
            const C = (x, y) => m.addAtom('C', x, y);
            const center = C(0, 0), oh = m.addAtom('O', 0, -40);
            const a0 = C(40, 0), a1 = C(80, 0), a2 = C(120, 0), a3 = m.addAtom('O', 160, 0), a4 = C(40, 40);
            const b0 = C(-40, 0), b1 = C(-80, 0), b2 = C(-120, 0), b3 = C(-160, 0),
                  b4 = C(-40, 40), b5 = C(-40, 80);
            [[center, oh], [center, a0], [a0, a1], [a1, a2], [a2, a3], [a0, a4],
             [center, b0], [b0, b1], [b1, b2], [b2, b3], [b0, b4], [b4, b5]]
                .forEach(([p, q]) => m.addBond(p.id, q.id, 1));
            const order = W.cipRank(m, center.id);
            assert(order, '枝の順位が決まらない');
            assert(order[0] === oh.id, '-OH が1位でない');
            assert(order[1] === b0.id,
                '同順位の掘り下げが球ごとになっていない（1本目の枝を掘り切る比較になっている）');
            assert(order[3] === 'H', 'H が4位でない');
        }
        //   4つの置換基が区別できない中心は順位も付けない（断定しない）
        {
            const m = new W.Molecule();
            const c0 = m.addAtom('C', 0, 0);
            const arms = [[0, -40], [40, 0], [0, 40]].map(([x, y]) => m.addAtom('C', x, y));
            arms.forEach(a => m.addBond(c0.id, a.id, 1));
            assert(W.cipRank(m, c0.id) === null, '同じ枝が並んだ中心に順位を付けている');
        }

        // (5) 既存の同型判定に触っていない（R/S は呼び名だけで、同値関係には使わない）
        {
            const mol = g.createTargetFromData({ target: find('D-グルコース（鎖状）').target });
            const before = W.canonicalCode(mol);
            W.assignRSDescriptor(mol);
            assert(W.canonicalCode(mol) === before, 'R/S を読むと正準コードが変わる（副作用がある）');
        }
    });

    test('ST37: R・S を画面に出す（判定できない図では理由を出す・v570）', async (c) => {
        c.reset();
        const W = c.W, D = c.D, g = c.game;
        const sv = W.stereoView;
        assert(sv, 'stereoView が初期化されていない');
        const letterEl = D.getElementById('stereo-rs-letter');
        const whyEl = D.getElementById('stereo-rs-why');
        assert(letterEl && whyEl, 'R・S の表示欄が立体モーダルに無い');
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []).filter(e => e.target);
        // ライブラリの図をキャンバスに置いて、立体ビューを自動中心で開く
        const openLibrary = (name) => {
            const e = source.find(x => x.name === name);
            assert(e, `${name} がライブラリに無い`);
            g.userMolecule = new W.Molecule();
            const m = g.userMolecule;
            const ids = e.target.atoms.map(a => m.addAtom(a.element, a.x, a.y).id);
            e.target.bonds.forEach(b => m.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
            g.updateDrawing();
            D.getElementById('btn-stereo').click();
            return m;
        };
        // いま出している記号（無ければ null）。**判定結果と画面の一致**を見るための読み取り
        const shownLetter = () => {
            const m = /R・S:\s*\(([RS])\)/.exec(letterEl.textContent);
            return m ? m[1] : null;
        };

        // (1) 読める図（縦置きのフィッシャー投影）では記号と導出が出る
        {
            const m = openLibrary('D-乳酸');
            const rs = W.assignRSDescriptor(m);
            assert(rs && rs[sv.centerId], '（前提）D-乳酸の中心から R/S が読めない');
            assert(shownLetter() === rs[sv.centerId].letter,
                `画面の記号が判定と食い違う（画面=${shownLetter()} / 判定=${rs[sv.centerId].letter}）`);
            assert(rs[sv.centerId].letter === 'R', 'D-乳酸が (R) にならない（教科書の答えと違う）');
            // 導出（順位・最下位の位置・裏返したか）を添える。記号だけだと覚えるしかなくなる
            assert(/優先順位/.test(whyEl.textContent), '優先順位が示されていない');
            assert(/最下位/.test(whyEl.textContent), '最下位がどこにあるかが示されていない');
            assert(/時計回り/.test(whyEl.textContent), '残り3つの回り方が示されていない');
            // D・L も同じ中心について並べて出す（別の規約であることを見比べられるように）
            assert(/D・L:\s*D体/.test(letterEl.textContent),
                `D-乳酸の D・L が R・S と並んで出ていない（${letterEl.textContent}）`);
            // 並べ替え（偶置換）は分子を変えないので、記号も変わらない
            D.getElementById('btn-stereo-wedge-cw').click();
            assert(shownLetter() === 'R', '並べ替えただけで記号が変わった（偶置換は同じ分子）');
            D.getElementById('btn-stereo-close').click();
        }

        // (1b) **D・L は分子にひとつ、R・S は不斉炭素ごと**。D-グルコース（鎖状）の
        //      いちばん上の中心を見ているとき、その炭素で D・L を決めているわけではない。
        //      黙って D・L を消すと「出ないのは壊れているから」に見えるので、断りを出す
        {
            const m = openLibrary('D-グルコース（鎖状）');
            const dl = W.assignDLDescriptor(m);
            assert(dl && dl.letter === 'D', '（前提）D-グルコースが D体 と読めない');
            assert(dl.centerId !== sv.centerId,
                '（前提）D・L の基準炭素と、自動で選ばれた中心が同じになってしまった');
            assert(shownLetter() === 'R', 'D-グルコース C2 が (R) にならない');
            assert(!/D・L:/.test(letterEl.textContent),
                'ほかの炭素で決めた D・L を、この炭素のものとして並べている');
            assert(/この分子ぜんたいは D体/.test(whyEl.textContent),
                `分子ぜんたいの D・L の断りが出ていない（${whyEl.textContent}）`);
            D.getElementById('btn-stereo-close').click();
        }

        // (2) **システイン: L 体なのに (R)**。読み物 ⑤ が挙げている例外を、
        //     アプリ自身の判定で確かめる（ヘルプの主張がいつまでも本当であることの担保）。
        //     ライブラリのシステインは主鎖が横なので、ここでフィッシャー投影として組む
        {
            const m = new W.Molecule();
            const c2 = m.addAtom('C', 400, 300);       // α炭素
            const c1 = m.addAtom('C', 400, 258);       // -COOH（上＝C1側）
            const od = m.addAtom('O', 400, 216);
            const os = m.addAtom('O', 442, 258);
            const c3 = m.addAtom('C', 400, 342);       // -CH₂-（下）
            const s = m.addAtom('S', 400, 384);        // -SH
            const n = m.addAtom('N', 358, 300);        // -NH₂（左＝L体）
            m.addBond(c2.id, c1.id, 1); m.addBond(c1.id, od.id, 2); m.addBond(c1.id, os.id, 1);
            m.addBond(c2.id, c3.id, 1); m.addBond(c3.id, s.id, 1); m.addBond(c2.id, n.id, 1);
            assert(m.isAsymmetricCarbon(c2.id), '（前提）α炭素が不斉と判定されない');
            const dl = W.assignDLDescriptor(m);
            assert(dl && dl.letter === 'L' && dl.centerId === c2.id,
                `-NH₂ を左に描いたのに L 体にならない（${dl && dl.letter}）`);
            const rs = W.assignRSDescriptor(m);
            assert(rs && rs[c2.id], 'システインのフィッシャー投影から R/S が読めない');
            assert(rs[c2.id].letter === 'R',
                `L-システインが (${rs[c2.id].letter}) と出た（(R) が正しい。-CH₂SH の S(16) が` +
                ' -COOH の O(8) を上回り、2位と3位が入れ替わるため）');
            // 画面でも両方が並んで見える＝食い違いがその場で分かる
            g.userMolecule = m;
            g.updateDrawing();
            D.getElementById('btn-stereo').click();
            assert(sv.centerId === c2.id, 'α炭素が自動で中心に選ばれない');
            assert(shownLetter() === 'R' && /D・L:\s*L体/.test(letterEl.textContent),
                `L と (R) が並んで見えない（${letterEl.textContent}）`);
            D.getElementById('btn-stereo-close').click();
        }

        // (3) 判定しない図では**記号を出さず、理由を出す**。
        //     黙って空欄にすると「壊れている」に見えるので、理由は必ず入る
        const expectSilent = (label, expectWord) => {
            assert(shownLetter() === null,
                `${label}: 判定しない図に記号を出している（${letterEl.textContent}）`);
            assert(/判定していません/.test(letterEl.textContent),
                `${label}: 判定していないことが書かれていない`);
            assert(whyEl.textContent.length > 10,
                `${label}: 出せない理由が空欄のまま（＝壊れて見える）`);
            assert(new RegExp(expectWord).test(whyEl.textContent),
                `${label}: 理由が「${expectWord}」に触れていない（${whyEl.textContent}）`);
        };
        // 主鎖が横の普通の構造式（十字には見えるが、投影として描かれていない）
        {
            const m = openLibrary('乳酸');
            assert(W.assignRSDescriptor(m) === null, '（前提）横置きの乳酸から R/S が読めてしまう');
            expectSilent('横置きの乳酸', '主鎖');
            // 直し方（縦に描き直せば読める）まで書く
            assert(/縦/.test(whyEl.textContent), '横置きの図に対して直し方が示されていない');
            D.getElementById('btn-stereo-close').click();
        }
        // 環の中の中心（ハースの担当。相互排他）
        {
            openLibrary('β-D-グルコース（β-D-グルコピラノース）');
            expectSilent('環の中の中心', '環');
            D.getElementById('btn-stereo-close').click();
        }
        // 不斉でない中心
        {
            openLibrary('エタノール');
            expectSilent('エタノール', '不斉');
            D.getElementById('btn-stereo-close').click();
        }
        // 軸から外れた図（ST34 と同じ作り方で、中心の -OH だけ斜めへ逃がす）
        {
            const m = openLibrary('D-乳酸');
            const ctr = sv.centerId;
            const center = m.atoms.find(a => a.id === ctr);
            const oh = m.getNeighbors(ctr).find(x => x.atom.element === 'O');
            // 斜め45°＝どの軸からも 45° 外れる（読み取りの許容は ±25°）
            oh.atom.x = center.x + 30; oh.atom.y = center.y - 30;
            g.updateDrawing();
            D.getElementById('btn-stereo-close').click();
            D.getElementById('btn-stereo').click();
            expectSilent('軸から外れた図', '軸');
            D.getElementById('btn-stereo-close').click();
        }

        // (4) 中心を持たない「分子全体」表示では欄ごと隠す（中心の話なので）
        {
            openLibrary('ベンゼン');
            assert(sv.centerId === null, '（前提）ベンゼンで中心が選ばれてしまう');
            assert(D.getElementById('stereo-rs-row').classList.contains('hidden'),
                '中心が無いのに R・S の欄が出ている');
            D.getElementById('btn-stereo-close').click();
        }
    });

    test('ST34: 立体が読めない図でも立体ビューを操作できる（仮の立体＋確定。項目23）', async (c) => {
        c.reset();
        const W = c.W, D = c.D, g = c.game;
        const sv = W.stereoView;
        assert(sv, 'stereoView が初期化されていない');
        // 乳酸を置き、中心の -OH だけ軸から外して「立体が読めない図」を作る
        const build = () => {
            const e = W.COMPOUNDS.find(x => x.name === 'D-乳酸');
            g.userMolecule = new W.Molecule();
            const m = g.userMolecule;
            const ids = e.target.atoms.map(a => m.addAtom(a.element, a.x, a.y).id);
            e.target.bonds.forEach(b => m.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
            const ctr = m.atoms.find(a => a.element === 'C' && m.isAsymmetricCarbon(a.id));
            g.updateDrawing();
            return { m, ctr };
        };
        const sig = () => g.userMolecule.atoms
            .map(a => `${a.element}:${Math.round(a.x)},${Math.round(a.y)}`).sort().join('|');

        // (1) 読める図では従来どおり「描いたまま」。仮ではないので確定ボタンは出さない
        const ok = build();
        assert(W.fischerSlots(ok.m, ok.ctr.id), '（前提）D-乳酸の中心が読めない');
        sv.show(ok.ctr);
        assert(sv._provisional === false, '読める図なのに仮の立体になっている');
        assert(D.getElementById('btn-stereo-wedge-commit').classList.contains('hidden'),
            '読める図で「確定する」ボタンが出ている');

        // (2) 軸から外すと読めなくなる。**それでも操作は解放する**（項目23 の要点）
        const ng = build();
        const oh = ng.m.getNeighbors(ng.ctr.id).find(n => n.atom.element === 'O' &&
            ng.m.getNeighbors(n.atom.id).filter(k => k.atom.element !== 'H').length === 1);
        assert(oh, '中心の -OH が見つからない');
        oh.atom.x = ng.ctr.x + 30; oh.atom.y = ng.ctr.y - 30;
        g.updateDrawing();
        assert(!W.fischerSlots(ng.m, ng.ctr.id), '軸から外したのにまだ読めている');
        const before = sig();
        sv.show(ng.ctr);
        assert(sv._provisional === true, '読めない図に仮の立体が当たっていない');
        assert(sv._viewSlots && ['up', 'right', 'down', 'left'].every(k => sv._viewSlots[k]),
            '仮のスロットが4つそろっていない');
        assert(!D.getElementById('btn-stereo-wedge-mirror').disabled &&
               !D.getElementById('btn-stereo-wedge-cw').disabled &&
               !D.getElementById('btn-stereo-wedge-ccw').disabled &&
               !D.getElementById('btn-stereo-wedge-reset').disabled,
            '読めない図で操作ボタンが無効のまま（項目23 の直しが効いていない）');
        assert(D.getElementById('stereo-wedge-note').textContent.includes('仮の立体'),
            '「仮の立体」であることが文で示されていない');
        assert(!D.getElementById('btn-stereo-wedge-commit').classList.contains('hidden'),
            '「確定する」ボタンが出ていない');

        // (3) 確定すると図が十字に並び、以後は「描いた立体」として読める。↩ 戻すで戻せる
        const hist = g.history.length;
        D.getElementById('btn-stereo-wedge-commit').click();
        assert(sig() !== before, '確定してもキャンバスの図が変わっていない');
        assert(W.fischerSlots(g.userMolecule, sv.centerId), '確定したのに立体が読めない');
        assert(sv._provisional === false, '確定後も仮のままになっている');
        assert(D.getElementById('btn-stereo-wedge-commit').classList.contains('hidden'),
            '確定後も「確定する」ボタンが残っている');
        assert(g.history.length === hist + 1, '確定が履歴に積まれていない（↩ 戻すで戻せない）');
        g.undo();
        assert(sig() === before, '↩ 戻すで確定前の図に戻らない');
    });

    test('ST14: 分子全体の立体ビュー（正しい結合角・手性の一致・M4a）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, D = c.D;
        // 作図は直交格子（結合角90°）なので、その座標をそのまま立体にすると誤った模型になる。
        // buildMolecule3D は「つながり＋描いた立体」だけから正しい角度で組み直す。
        // ここでは (a) 幾何が正しいこと (b) 描いた手性と一致すること (c) 対象外を出さないこと を見る
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const molOf = (name) => {
            const e = source.find(x => x.name === name && x.target);
            assert(e, `${name} がライブラリに無い`);
            return g.createTargetFromData({ target: e.target });
        };
        const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const angleOf = (a, o, b) => {
            const u = [a[0] - o[0], a[1] - o[1], a[2] - o[2]];
            const v = [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
            const d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
            return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
        };

        // ===== A. 幾何: 結合長（重原子1・水素0.7）と結合角（109.5/120/180）=====
        ['エタノール', '酢酸', 'L-アラニン', '2-ブタノール', 'アセチレン（エチン）',
         'エチレン（エテン）', 'プロパン'].forEach(name => {
            const mol = molOf(name);
            const r = W.buildMolecule3D(mol);
            assert(r.ok, `${name}: 3Dを組めない（${r.reason}）`);
            const nb = new Map();
            r.bonds.forEach(b => {
                const isH = r.nodes[b.a].kind === 'h' || r.nodes[b.b].kind === 'h';
                const want = isH ? 0.7 : 1;
                const d = dist(r.nodes[b.a].v, r.nodes[b.b].v);
                assert(Math.abs(d - want) < 1e-6, `${name}: 結合長が ${want} でない（${d.toFixed(3)}）`);
                if (!nb.has(b.a)) nb.set(b.a, []);
                if (!nb.has(b.b)) nb.set(b.b, []);
                nb.get(b.a).push(b.b); nb.get(b.b).push(b.a);
            });
            nb.forEach((list, i) => {
                for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
                    const ang = angleOf(r.nodes[list[x]].v, r.nodes[i].v, r.nodes[list[y]].v);
                    assert([109.4712, 120, 180].some(t => Math.abs(ang - t) < 0.6),
                        `${name}: 結合角が想定外（${r.nodes[i].label} で ${ang.toFixed(1)}°）`);
                }
            });
            // 結合していない原子どうしが重なっていない
            const bonded = new Set(r.bonds.map(b => `${Math.min(b.a, b.b)}_${Math.max(b.a, b.b)}`));
            for (let i = 0; i < r.nodes.length; i++) for (let j = i + 1; j < r.nodes.length; j++) {
                if (bonded.has(`${i}_${j}`)) continue;
                assert(dist(r.nodes[i].v, r.nodes[j].v) >= 0.75,
                    `${name}: 原子が重なっている（${r.nodes[i].label}-${r.nodes[j].label}）`);
            }
        });

        // ===== B. 手性: 組んだ立体が「描いた図から読んだパリティ」と一致する =====
        // 回転だけで親に接いでいるので手性は保たれる、という設計の担保
        let checked = 0;
        ['L-アラニン', 'D-アラニン', '2-ブタノール', 'D-グルコース（鎖状）'].forEach(name => {
            const entry = source.find(x => x.name === name && x.target);
            if (!entry) return;
            const mol = molOf(name);
            const r = W.buildMolecule3D(mol);
            if (!r.ok) return; // 鎖状グルコースは対象外でもよい（Aで別途見ている）
            const par = Object.assign({}, W.readAtomParityFromFischer(mol), W.readRingParityFromHaworth(mol));
            Object.keys(par).forEach(id => {
                const ci = r.nodes.findIndex(n => n.atomId === id);
                if (ci < 0) return;
                const around = [];
                r.bonds.forEach(b => {
                    const o = b.a === ci ? b.b : b.b === ci ? b.a : null;
                    if (o === null) return;
                    const n = r.nodes[o];
                    around.push({
                        ref: n.atomId === null ? 'H' : n.atomId,
                        code: n.atomId === null ? 'H' : W.rootedFragmentCode(mol, n.atomId, id),
                        v: [n.v[0] - r.nodes[ci].v[0], n.v[1] - r.nodes[ci].v[1], n.v[2] - r.nodes[ci].v[2]]
                    });
                });
                if (around.length !== 4) return;
                checked++;
                assert(W.parityFromDirs(around) === par[id],
                    `${name}: 組んだ立体の手性が、描いた図から読んだ手性と違う`);
            });
        });
        assert(checked >= 2, `手性を照合できた不斉炭素が少なすぎる（${checked} 個）`);

        // ===== B2. C=C のシス/トランスが描いた図と一致する（M4b）=====
        ['シス-2-ブテン', 'トランス-2-ブテン'].forEach(name => {
            const entry = source.find(x => x.name === name && x.target);
            if (!entry) return;
            const mol = molOf(name);
            const r = W.buildMolecule3D(mol);
            assert(r.ok, `${name}: 3Dを組めない（${r.reason}）`);
            const geo = W.readBondGeoFromCoords(mol);
            let seen = 0;
            mol.bonds.forEach(bond => {
                const want = geo[`${bond.atomId1}_${bond.atomId2}`];
                const refs = W.bondGeoRefs(mol, bond);
                if (!want || !refs) return;
                const at = (aid) => r.nodes[r.nodes.findIndex(n => n.atomId === aid)].v;
                const [p1, p2, pa, pb] = [at(bond.atomId1), at(bond.atomId2), at(refs.refA), at(refs.refB)];
                const d = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
                const L = Math.hypot(...d);
                const u = d.map(v => v / L);
                const perp = (v) => { const k = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
                    return [v[0] - u[0] * k, v[1] - u[1] * k, v[2] - u[2] * k]; };
                const va = perp([pa[0] - p1[0], pa[1] - p1[1], pa[2] - p1[2]]);
                const vb = perp([pb[0] - p2[0], pb[1] - p2[1], pb[2] - p2[2]]);
                const got = (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]) > 0 ? 'syn' : 'anti';
                seen++;
                assert(got === want, `${name}: C=C の幾何が描いた図と違う（読み ${want} / 立体 ${got}）`);
            });
            assert(seen === 1, `${name}: 幾何を照合できる C=C が1本でない（${seen}）`);
        });

        // ===== B3. 環（M4c）: 平面・正多角形・置換基の面が描いた図と一致 =====
        ['シクロヘキサン', 'ベンゼン', 'β-D-グルコース（β-D-グルコピラノース）', 'α-D-グルコース（α-D-グルコピラノース）'].forEach(name => {
            const entry = source.find(x => x.name === name && x.target);
            if (!entry) return;
            const mol = molOf(name);
            const r = W.buildMolecule3D(mol);
            assert(r.ok, `${name}: 3Dを組めない（${r.reason}）`);
            const ring = W.ringAtomIds(mol);
            const ringNodes = r.nodes.filter(n => n.atomId !== null && ring.has(n.atomId));
            assert(ringNodes.length >= 5, `${name}: 環の原子が足りない（${ringNodes.length}）`);
            // 環は同一平面（全体を重心に寄せるので z=0 とは限らない。ばらつきで見る）
            const zs = ringNodes.map(n => n.v[2]);
            assert(Math.max(...zs) - Math.min(...zs) < 1e-9, `${name}: 環が平面に乗っていない`);
            // 単環は正多角形（結合長が揃う）。ハース図は潰して描くので組み直しが要る
            const rb = r.bonds.filter(b => r.nodes[b.a].atomId !== null && r.nodes[b.b].atomId !== null &&
                ring.has(r.nodes[b.a].atomId) && ring.has(r.nodes[b.b].atomId));
            rb.forEach(b => {
                const d = Math.hypot(...[0, 1, 2].map(i => r.nodes[b.a].v[i] - r.nodes[b.b].v[i]));
                assert(Math.abs(d - 1) < 0.01, `${name}: 環の結合長が揃っていない（${d.toFixed(3)}）`);
            });
        });
        // α/β はアノマー位置の -OH が逆の面に出る（描いた図の違いが立体に出ている）
        const anomerZ = (name) => {
            const mol = molOf(name);
            const r = W.buildMolecule3D(mol);
            assert(r.ok, `${name}: 3Dを組めない`);
            const ring = W.ringAtomIds(mol);
            // アノマー炭素 = 環内で環のOと隣り合い、環外に -OH を持つ炭素
            const ringO = mol.atoms.find(a => a.element === 'O' && ring.has(a.id));
            const c1 = mol.getNeighbors(ringO.id)
                .map(n => n.atom)
                .find(a => mol.getNeighbors(a.id).some(n => !ring.has(n.atom.id) && n.atom.element === 'O'));
            assert(c1, `${name}: アノマー炭素が見つからない`);
            const oh = mol.getNeighbors(c1.id).map(n => n.atom).find(a => !ring.has(a.id) && a.element === 'O');
            const nc = r.nodes.find(n => n.atomId === c1.id);
            const no = r.nodes.find(n => n.atomId === oh.id);
            return no.v[2] - nc.v[2];
        };
        const zb = anomerZ('β-D-グルコース（β-D-グルコピラノース）');
        const za = anomerZ('α-D-グルコース（α-D-グルコピラノース）');
        assert(zb * za < 0, `α/β でアノマー位置の -OH が逆の面になっていない（β=${zb.toFixed(2)} α=${za.toFixed(2)}）`);

        // ===== C. 判断できないものは出さない（誤った図を見せないことが最優先）=====
        {
            // シス/トランスを描き分けていない C=C は組まない
            const m = new W.Molecule();
            const a = m.addAtom('C', 300, 300), b = m.addAtom('C', 342, 300);
            const l = m.addAtom('C', 258, 300), rr = m.addAtom('C', 384, 300); // 一直線＝描き分けなし
            m.addBond(a.id, b.id, 2); m.addBond(a.id, l.id, 1); m.addBond(b.id, rr.id, 1);
            const res = W.buildMolecule3D(m);
            assert(!res.ok && res.reason.includes('シス/トランス'),
                `描き分けていない C=C を組んでしまった（${res.ok ? 'ok' : res.reason}）`);
        }

        // ===== D. UI: タブ・回転・H表示 =====
        g.userMolecule = molOf('L-アラニン');
        g.updateDrawing();
        D.getElementById('btn-stereo').click();
        const tab = D.getElementById('btn-stereo-tab-mol');
        assert(!tab.disabled, '非環分子で「分子全体」タブが無効になっている');
        tab.click();
        const sv = W.stereoView;
        sv.setMolSpin(false); // 自動回転はテストでは止める（rAF待ちを作らない）
        assert(sv.mode === 'mol' && !D.getElementById('stereo-pane-mol').classList.contains('hidden'),
            '「分子全体」ペインが表示されない');
        const atomsDrawn = D.querySelectorAll('#stereo-mol-svg [data-mol-node="atom"]').length;
        assert(atomsDrawn === 6, `重原子が6個描かれていない（${atomsDrawn}）`);
        const xs = () => [...D.querySelectorAll('#stereo-mol-svg [data-mol-node="atom"] circle')]
            .map(e => Math.round(Number(e.getAttribute('cx')) * 100) / 100);
        D.getElementById('btn-stereo-mol-reset').click();
        const x0 = xs();
        assert(D.getElementById('stereo-mol-yaw-value').textContent === '0°', '回転の初期表示が0°でない');
        D.getElementById('btn-stereo-mol-yaw-cw').click();
        assert(D.getElementById('stereo-mol-yaw-value').textContent === '30°', '右へ1回で30°にならない');
        assert(JSON.stringify(xs()) !== JSON.stringify(x0), '回しても見え方が変わらない');
        D.getElementById('btn-stereo-mol-yaw-ccw').click();
        assert(JSON.stringify(xs()) === JSON.stringify(x0), '同じ角度に戻したのに見え方が一致しない');
        const hBtn = D.getElementById('btn-stereo-mol-h');
        const hDrawn = () => D.querySelectorAll('#stereo-mol-svg [data-mol-node="h"]').length;
        assert(hDrawn() === 7, `既定でHが7個描かれていない（${hDrawn()}）`);
        hBtn.click();
        assert(hDrawn() === 0, 'H を隠せない');
        hBtn.click();
        assert(hDrawn() === 7, 'H を戻せない');
        // 環のある分子でも開ける（M4c）
        D.getElementById('btn-stereo-close').click();
        g.userMolecule = molOf('β-D-グルコース（β-D-グルコピラノース）');
        g.updateDrawing();
        D.getElementById('btn-stereo').click();
        assert(!tab.disabled, '環のある分子で「分子全体」タブが無効になっている（M4cで対応済み）');
        tab.click();
        sv.setMolSpin(false);
        assert(D.querySelectorAll('#stereo-mol-svg [data-mol-node="atom"]').length === 12,
            'グルコピラノースの重原子12個が描かれない');
        assert(D.getElementById('stereo-mol-note').textContent.includes('環は平面とみなし'),
            '環の平面近似の注記が出ていない');
        D.getElementById('btn-stereo-close').click();
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX13: 付加重合は同じ単量体2つを頭-尾で繋ぐ／縮合重合は説明を出す', async (c) => {
        const g = c.game, W = c.W;
        const setup = (names) => {
            c.reset();
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            names.forEach(n => g.summonMolecule(n));
        };
        const GRID = W.GRID_SIZE || 42; // 作図の格子（game.js）
        const poly = W.REACTION_RULES.find(r => r.id === 'addition_polymerization');
        const cond = W.REACTION_RULES.find(r => r.id === 'condensation_polymer_info');
        assert(poly && cond, '重合のルールが無い');
        assert(cond.info === true, '縮合重合のルールが説明（info）になっていない');

        // 同じ単量体2つのときだけ付加重合が出る
        setup(['エチレン（エテン）', 'エチレン（エテン）']);
        assert(poly.detect(g.userMolecule).length === 1, 'エチレン2分子で付加重合が検出されない');
        setup(['エチレン（エテン）', '塩化ビニル']);
        assert(poly.detect(g.userMolecule).length === 0, '別種の単量体で付加重合が検出された（共重合は範囲外）');
        setup(['ベンゼン', 'ベンゼン']);
        assert(poly.detect(g.userMolecule).length === 0, '芳香環で付加重合が検出された（環内は重合しない）');
        setup(['エチレン（エテン）']);
        assert(poly.detect(g.userMolecule).length === 0, '1分子だけで付加重合が検出された');

        // 並べた分だけまとめて繋ぐ（ユーザー要望「横一列に並べた状態から重合を見たい」）。
        // 5つ並べたら5単位ぶんの鎖になり、視野も鎖に合わせて広がる
        setup(['塩化ビニル', '塩化ビニル', '塩化ビニル', '塩化ビニル', '塩化ビニル']);
        const s5 = poly.detect(g.userMolecule);
        assert(s5.length === 1, `5分子で候補が ${s5.length} 件（まとめて1件を期待）`);
        assert(s5[0].length === 10, `候補が単量体5つ分になっていない（${s5[0].length}要素）`);
        W.reactor.execute(poly, s5[0]);
        g.updateDrawing();
        const chainXs = g.userMolecule.atoms.filter(a => a.element !== 'H').map(a => a.x);
        const vb5 = c.svg.viewBox.baseVal;
        assert(Math.min(...chainXs) >= vb5.x && Math.max(...chainXs) <= vb5.x + vb5.width,
            '重合後の鎖が視野からはみ出している（refit が効いていない）');
        assert(g.userMolecule.atoms.filter(a => a.element === 'R').length === 2,
            '5分子の重合でも R は両端の2個であること');
        assert(g.userMolecule.bonds.filter(b => b.type === 2).length === 0,
            '5分子の重合で二重結合が残っている');

        // 塩化ビニル2つ → R-CH2-CHCl-CH2-CHCl-R（頭-尾の並び。PVC の要点）
        setup(['塩化ビニル', '塩化ビニル']);
        const before = g.userMolecule.atoms.filter(a => a.element !== 'H').length;
        poly.apply(g, poly.detect(g.userMolecule)[0]);
        g.updateDrawing();
        const mol = g.userMolecule;
        assert(mol.atoms.every(a => W.isValencyValid(mol, a.id)), '重合後に価標が壊れた');
        assert(mol.bonds.filter(b => b.type === 2).length === 0, '二重結合が残っている（開いていない）');
        const rs = mol.atoms.filter(a => a.element === 'R');
        assert(rs.length === 2, `続きを示す R が ${rs.length} 個（両端の2個を期待）`);
        assert(mol.atoms.filter(a => a.element !== 'H').length === before + 2,
            '重原子の増減が R の2個ぶんと違う（付加重合では単量体の原子は出入りしない）');
        // R から主鎖を辿って -CH2-CHCl- のくり返しになっていること
        const first = mol.getNeighbors(rs[0].id).filter(n => n.atom.element === 'C')[0].atom;
        const seq = [];
        let prev = rs[0].id, cur = first.id;
        for (let k = 0; k < 8; k++) {
            const cl = mol.getNeighbors(cur).filter(n => n.atom.element === 'Cl').length;
            seq.push(cl > 0 ? 'CHCl' : 'CH2');
            const next = mol.getNeighbors(cur).filter(n => n.atom.element === 'C' && n.atom.id !== prev)[0];
            if (!next) break;
            prev = cur; cur = next.atom.id;
        }
        assert(seq.join('-') === 'CH2-CHCl-CH2-CHCl',
            `主鎖が頭-尾の並びでない（${seq.join('-')}。-CH2-CHCl- のくり返しを期待）`);

        // 共役ジエンは 1,4-付加重合（合成ゴム）。二重結合が両端から中央へ移るのが要点
        const dien = W.REACTION_RULES.find(r => r.id === 'diene_polymerization');
        assert(dien, '1,4-付加重合のルールが無い');
        // ルールの住み分け: 単官能ビニルは付加重合、共役ジエンは 1,4-付加重合（重複しない）
        setup(['塩化ビニル', '塩化ビニル']);
        assert(poly.detect(g.userMolecule).length === 1 && dien.detect(g.userMolecule).length === 0,
            '塩化ビニルで 1,4-付加重合が出た（共役ジエンではない）');
        setup(['1,3-ブタジエン', '1,3-ブタジエン']);
        assert(poly.detect(g.userMolecule).length === 0 && dien.detect(g.userMolecule).length === 1,
            'ブタジエンで付加重合と 1,4-付加重合の住み分けができていない');
        setup(['1,3-ブタジエン']);
        assert(dien.detect(g.userMolecule).length === 0, '1分子だけで 1,4-付加重合が検出された');

        // ブタジエン3つ → R-CH2-CH=CH-CH2-CH2-CH=CH-CH2-CH2-CH=CH-CH2-R
        setup(['1,3-ブタジエン', '1,3-ブタジエン', '1,3-ブタジエン']);
        dien.apply(g, dien.detect(g.userMolecule)[0]);
        g.updateDrawing();
        const dm = g.userMolecule;
        assert(dm.atoms.every(a => W.isValencyValid(dm, a.id)), '1,4-付加重合で価標が壊れた');
        assert(dm.bonds.filter(b => b.type === 2).length === 3,
            `二重結合が ${dm.bonds.filter(b => b.type === 2).length} 本（単量体の数と同じ3本を期待）`);
        const dr = dm.atoms.filter(a => a.element === 'R');
        assert(dr.length === 2, `R が ${dr.length} 個（両端の2個を期待）`);
        // 主鎖の結合次数を辿る: 各単位が -=- で、単位の間が - になる
        const bonds = [];
        let dp = dr[0].id, dc = dm.getNeighbors(dr[0].id).filter(x => x.atom.element === 'C')[0].atom.id;
        for (let k = 0; k < 20; k++) {
            const nx = dm.getNeighbors(dc).filter(x => x.atom.element === 'C' && x.atom.id !== dp)[0];
            if (!nx) break;
            bonds.push(dm.getBond(dc, nx.atom.id).type === 2 ? '=' : '-');
            dp = dc; dc = nx.atom.id;
        }
        assert(bonds.join('') === '-=---=---=-',
            `主鎖の結合が 1,4-付加重合の形でない（${bonds.join('')}。-=---=---=- を期待）`);
        // 生成物の二重結合は整形ツールでシス/トランスを指定できる（天然ゴムとグタペルカの描き分け）
        const dbl = dm.bonds.filter(b => b.type === 2);
        const subsOf = (id, other) => dm.getNeighbors(id)
            .filter(n => n.atom.id !== other && n.atom.element !== 'H').map(n => n.atom);
        dbl.forEach(b => g.reshapeDoubleBond(b, subsOf(b.atomId1, b.atomId2), subsOf(b.atomId2, b.atomId1)));
        g.updateDrawing();
        assert(Object.keys(W.readBondGeoFromCoords(g.userMolecule)).length >= 3,
            '整形しても生成物のシス/トランスが読めない（天然ゴムとグタペルカを描き分けられない）');
        assert(g.userMolecule.bonds.filter(b => b.type === 2).length === 3, '整形で結合が変わった');

        // 加硫: 硫黄が2本の鎖を架橋する。硫黄を増やすほど架橋が増え、二重結合を使い切る
        const vulc = W.REACTION_RULES.find(r => r.id === 'vulcanization');
        assert(vulc, '加硫のルールが無い');
        // 単量体やふつうのアルケンは加硫の対象にしない（重合の生成物＝両端に R がある分子のみ）
        setup(['イソプレン', 'イソプレン']);
        assert(vulc.detect(g.userMolecule).length === 0, '単量体が加硫の対象になった');
        // ゴムの鎖を2本つくって上下に並べる
        setup([]);
        for (let i = 0; i < 3; i++) g.summonMolecule('イソプレン');
        dien.apply(g, dien.detect(g.userMolecule)[0]);
        g.updateDrawing();
        g.moveComponentBy(g.collectComponent(g.userMolecule.atoms[0].id, null), 0, -168);
        for (let i = 0; i < 3; i++) g.summonMolecule('イソプレン');
        const ds = dien.detect(g.userMolecule);
        assert(ds.length === 1, '2本目の鎖がつくれない');
        dien.apply(g, ds[0]);
        g.updateDrawing();
        const two = g.splitMolecules();
        assert(two.length === 2, `鎖が ${two.length} 本（2本を期待）`);
        const pa = two[0].atoms.filter(x => x.element !== 'H');
        const pb = two[1].atoms.filter(x => x.element !== 'H');
        g.moveComponentBy(new Set(pb.map(x => x.id)),
            Math.round((Math.min(...pa.map(x => x.x)) - Math.min(...pb.map(x => x.x))) / GRID) * GRID,
            Math.round((Math.max(...pa.map(x => x.y)) + 2 * GRID - Math.min(...pb.map(x => x.y))) / GRID) * GRID);
        g.updateDrawing();

        const dblBefore = g.userMolecule.bonds.filter(b => b.type === 2).length;
        assert(dblBefore === 6, `鎖の二重結合が ${dblBefore} 本（3単位×2本＝6本を期待）`);
        let links = 0;
        for (let k = 0; k < 5; k++) {
            const sites = vulc.detect(g.userMolecule);
            if (!sites.length) break;
            vulc.apply(g, sites[0]);
            g.updateDrawing();
            links++;
            const m2 = g.userMolecule;
            assert(m2.atoms.every(a => W.isValencyValid(m2, a.id)), `${links}本目の架橋で価標が壊れた`);
            // 架橋の硫黄に自動水素が描かれてはいけない（v283 の価数修正が効いていること）
            const sh = m2.calculateHydrogens()
                .filter(h => (m2.atoms.find(a => a.id === h.parentId) || {}).element === 'S').length;
            assert(sh === 0, `架橋の硫黄に自動水素が ${sh} 個描かれた`);
            const s0 = m2.atoms.filter(a => a.element === 'S')[0];
            assert(m2.getNeighbors(s0.id).filter(n => n.atom.element === 'C').length === 2,
                '硫黄が2本の炭素を繋いでいない（架橋になっていない）');
        }
        assert(links === 3, `架橋できた本数が ${links}（二重結合6本を2本ずつ使って3本を期待）`);
        assert(g.userMolecule.bonds.filter(b => b.type === 2).length === 0,
            '架橋しきったのに二重結合が残っている');
        assert(g.splitMolecules().length === 1, '架橋したのに分子が分かれている');
        assert(vulc.detect(g.userMolecule).length === 0, '二重結合を使い切ったのに加硫の候補が出る');

        // 縮合重合になる組み合わせでは説明が出る（実際の連結は既存のエステル化で行う）
        setup(['テレフタル酸', 'エチレングリコール']);
        assert(cond.detect(g.userMolecule).length === 1, 'ポリエステルの組み合わせで説明が出ない');
        const r1 = cond.apply(g, cond.detect(g.userMolecule)[0]);
        assert(/エステル/.test(r1.caption) && /縮合重合/.test(r1.caption), '説明にエステル・縮合重合の語が無い');
        setup(['アジピン酸', 'ヘキサメチレンジアミン']);
        assert(cond.detect(g.userMolecule).length === 1, 'ポリアミドの組み合わせで説明が出ない');
        assert(/アミド/.test(cond.apply(g, cond.detect(g.userMolecule)[0]).caption),
            'ポリアミドなのに説明がアミドになっていない');
        // 1価どうしでは出ない（酢酸＋エタノールは普通のエステル化）
        setup(['酢酸', 'エタノール']);
        assert(cond.detect(g.userMolecule).length === 0, '1価どうしで縮合重合の説明が出た');

        // 説明ルールは**ユーザーが押す経路**（onRuleClick）でも落ちないこと。
        // 上の apply(g, site) 直呼びは game を渡してしまうため、onRuleClick が引数なしで
        // 呼んでいた不具合（縮合重合だけ game を要求する）を素通りさせていた（v331 監査で検出）
        setup(['テレフタル酸', 'エチレングリコール']);
        const infoRules = W.REACTION_RULES.filter(r => r.info);
        assert(infoRules.length > 0, '説明（info）ルールが1つも無い');
        const origToast = g.showToast;
        infoRules.forEach(r => {
            let shown = null;
            g.showToast = (msg) => { shown = msg; };
            try {
                W.reactor.onRuleClick(r, r.detect(g.userMolecule));
            } catch (e) {
                g.showToast = origToast;
                assert(false, `説明ルール ${r.id} をクリックすると落ちる: ${e.message}`);
            }
            g.showToast = origToast;
            assert(typeof shown === 'string' && shown.length > 0,
                `説明ルール ${r.id} をクリックしても解説が出ない`);
        });
    });

    test('RX10b: 反応の生成物が母体の刻みで置かれる（結合線が無関係な原子を貫通しない）', async (c) => {
        const g = c.game, W = c.W;
        // 名称ライブラリの分子は 80px 刻み、GRID_SIZE は 42px。生成物を 42px 固定で置くと
        // 新しい原子が既存の結合線の上に乗り、**構造式が別の物質に見える**
        // （酢酸エチルが酪酸に見えた。動画レーンからの報告 video-scripts/V18.md §3）
        const pierces = () => {
            const m = g.userMolecule;
            const hits = [];
            m.bonds.forEach(b => {
                const a1 = m.atoms.find(a => a.id === b.atomId1);
                const a2 = m.atoms.find(a => a.id === b.atomId2);
                if (!a1 || !a2) return;
                m.atoms.forEach(p => {
                    if (p.id === a1.id || p.id === a2.id || p.element === 'H') return;
                    const vx = a2.x - a1.x, vy = a2.y - a1.y, L2 = vx * vx + vy * vy;
                    if (!L2) return;
                    const t = ((p.x - a1.x) * vx + (p.y - a1.y) * vy) / L2;
                    if (t <= 0.02 || t >= 0.98) return; // 線分の内側だけを見る（端は結合相手）
                    const d = Math.hypot(a1.x + t * vx - p.x, a1.y + t * vy - p.y);
                    if (d < 10) hits.push(`${a1.element}-${a2.element} が ${p.element} を貫通（${d.toFixed(1)}px）`);
                });
            });
            return hits;
        };
        const bondLengths = () => g.userMolecule.bonds.map(b => {
            const a1 = g.userMolecule.atoms.find(a => a.id === b.atomId1);
            const a2 = g.userMolecule.atoms.find(a => a.id === b.atomId2);
            return Math.round(Math.hypot(a1.x - a2.x, a1.y - a2.y));
        });
        const fresh = (...names) => {
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            names.forEach(n => g.summonMolecule(n));
        };
        const ruleOf = id => W.REACTION_RULES.find(r => r.id === id);

        // (1) 報告そのもの: 酢酸＋エタノール → 酢酸エチル。母体は 80px なので生成物も 80px
        fresh('酢酸', 'エタノール');
        const est = ruleOf('esterification');
        const sites = est.detect(g.userMolecule);
        assert(sites.length === 1, `エステル化の候補が ${sites.length} 件`);
        W.reactor.execute(est, sites[0]);
        assert(pierces().length === 0, `酢酸エチル: ${pierces().join(' / ')}`);
        const lens = bondLengths();
        assert(lens.every(d => d === lens[0]),
            `生成物の結合長がそろっていない（${lens.join(',')}）＝母体と違う刻みで置かれている`);

        // (2) 同じ原因で壊れていた V6 の最後の画: エタノール →[O]→ アセトアルデヒド →[O]→ 酢酸
        fresh('エタノール');
        for (let k = 0; k < 2; k++) {
            const rule = W.REACTION_RULES.find(r =>
                !r.info && /酸化/.test(r.label || '') && r.detect(g.userMolecule).length);
            assert(rule, `${k + 1}段目の酸化が見つからない`);
            W.reactor.execute(rule, rule.detect(g.userMolecule)[0]);
            assert(pierces().length === 0, `酸化${k + 1}段目: ${pierces().join(' / ')}`);
        }
        assert(c.D.getElementById('compound-name').textContent.includes('酢酸'),
            '2段階の酸化で酢酸にならない');

        // (3) ライブラリ全件 × 全反応で貫通ゼロ（1件目の候補で実行）
        const bad = [];
        let tried = 0;
        (W.COMPOUNDS || []).forEach(entry => {
            W.REACTION_RULES.forEach(rule => {
                if (rule.info) return;
                g.userMolecule = new W.Molecule();
                try { g.summonMolecule(entry.name); } catch (e) { return; }
                let ss;
                try { ss = rule.detect(g.userMolecule); } catch (e) { return; }
                if (!ss || !ss.length) return;
                tried++;
                try { W.reactor.execute(rule, ss[0]); } catch (e) { return; }
                if (pierces().length) bad.push(`${entry.name} / ${rule.id}`);
            });
        });
        assert(tried > 100, `掃いた組合せが ${tried} 件しかない（試験の前提が崩れている）`);
        assert(bad.length === 0, `貫通した組合せ ${bad.length} 件: ${bad.slice(0, 5).join(' , ')}`);

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX11: 反応ルールが名前で引く登録エントリが実在する（改名で静かに壊れないため）', async (c) => {
        const W = c.W;
        // 「確実層」（グルコースの環化・開環）は compounds.json を**名前で引いて**正解を返す。
        // エントリ名は表示名なので変わりうる（実際 v224 の改名で開環が消え、RX6 が検出した）。
        // 参照する名前を reactor.js の REGISTERED_NAMES 1か所に集めたので、
        // ここで実在を確かめる。これで**改名した瞬間にこのテストが落ちる**
        assert(W.REGISTERED_NAMES, 'REGISTERED_NAMES が公開されていない');
        const names = Object.values(W.REGISTERED_NAMES);
        assert(names.length >= 3, `参照名が少なすぎる（${names.length}）`);
        names.forEach(n => {
            assert((W.COMPOUNDS || []).some(x => x.name === n),
                `reactor.js が参照する「${n}」が compounds.json に無い（改名したら reactor.js の REGISTERED_NAMES も直すこと）`);
        });
        // 参照名を使う反応が実際に動くことも確かめる（名前が合っていても中身がずれていないか）
        const src = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const molOf = (name) => {
            const e = src.find(x => x.name === name && x.target);
            assert(e, `${name} がライブラリに無い`);
            return c.game.createTargetFromData({ target: e.target });
        };
        const open = W.REACTION_RULES.find(r => r.id === 'open_glucopyranose');
        assert(open.detect(molOf(W.REGISTERED_NAMES.beta)).length === 1, 'β体から開環が検出されない');
        assert(open.detect(molOf(W.REGISTERED_NAMES.alpha)).length === 1, 'α体から開環が検出されない');
        const cyc = W.REACTION_RULES.find(r => r.id === 'cyclize_glucose_beta');
        assert(cyc.detect(molOf(W.REGISTERED_NAMES.chain)).length === 1, '鎖状から環化が検出されない');
    });

    test('RX12: 分子間脱水に機構アニメが繋がっている（ethanol_ether）', async (c) => {
        const W = c.W;
        // reactions.json に機構を足しても、reactor.js の mechanismId を書き忘れると
        // 「反応実行 → 機構を見る」の導線が繋がらず、機構ビューアの一覧からしか辿れなくなる。
        // 逆に機構側を消せば死にリンクになる。両方向をここで固定する
        const rule = W.REACTION_RULES.find(r => r.id === 'dehydration_inter');
        assert(rule && rule.mechanismId === 'ethanol_ether',
            `分子間脱水の mechanismId が ethanol_ether でない（${rule && rule.mechanismId}）`);
        const rx = (W.reactionPlayer.reactions || []).find(r => r.id === 'ethanol_ether');
        assert(rx, 'reactions.json に ethanol_ether が無い（死にリンク）');
        assert(rx.states.length === 4 && rx.steps.length === 3,
            `状態/手順の数が想定外（${rx.states.length}/${rx.steps.length}）`);
        // 2段目は「-OH₂⁺ が付いた炭素」への攻撃と、その C-O 結合の切断が同時に起きる。
        // 隣の炭素を攻撃していないことを、結合の添字で直接確かめる
        const st = rx.steps[1];
        const before = rx.states[st.from];
        const oxo = before.atoms.findIndex(a => a.element === 'O' && a.charge === 1);
        assert(oxo >= 0, 'オキソニウム酸素が見つからない');
        const cOfOxo = before.bonds
            .filter(b => b.atom1Index === oxo || b.atom2Index === oxo)
            .map(b => (b.atom1Index === oxo ? b.atom2Index : b.atom1Index))
            .find(i => before.atoms[i].element === 'C');
        assert(cOfOxo !== undefined, 'オキソニウム酸素に炭素が付いていない');
        const attack = st.arrows.find(a => a.target.type === 'atom' && a.target.index === cOfOxo);
        assert(attack, `攻撃先が -OH₂⁺ の付いた炭素（index ${cOfOxo}）でない`);
        assert(before.atoms[attack.source.index].element === 'O',
            '攻撃しているのが酸素の非共有電子対でない');
        const leave = st.arrows.find(a => a.source.type === 'bond' &&
            a.source.atoms.includes(oxo) && a.source.atoms.includes(cOfOxo));
        assert(leave && leave.target.type === 'atom' && leave.target.index === oxo,
            '切れる C-O 結合の電子対が酸素に渡っていない');
    });

    test('RX14: 1級アルコールの酸化に機構アニメが繋がっている（ethanol_oxidation）', async (c) => {
        const W = c.W;
        // RX12 と同じ主旨: ルール側の mechanismId と reactions.json 側の機構を両方向で固定する
        const rule = W.REACTION_RULES.find(r => r.id === 'oxidize_primary');
        assert(rule && rule.mechanismId === 'ethanol_oxidation',
            `酸化ルールの mechanismId が ethanol_oxidation でない（${rule && rule.mechanismId}）`);
        const rx = (W.reactionPlayer.reactions || []).find(r => r.id === 'ethanol_oxidation');
        assert(rx, 'reactions.json に ethanol_oxidation が無い（死にリンク）');
        assert(rx.states.length === 4 && rx.steps.length === 3,
            `状態/手順の数が想定外（${rx.states.length}/${rx.steps.length}）`);
        // 機構の要: 最終手順で「O–Cl エステルの α水素が引き抜かれ、C–H の電子対が C=O をつくる」。
        // 酸化＝脱水素の見せ場なので、矢印の指す先を添字で直接確かめる
        const st = rx.steps[2];
        const before = rx.states[st.from];
        const cl = before.atoms.findIndex(a => a.element === 'Cl');
        const oOfCl = before.bonds
            .filter(b => b.atom1Index === cl || b.atom2Index === cl)
            .map(b => (b.atom1Index === cl ? b.atom2Index : b.atom1Index))
            .find(i => before.atoms[i].element === 'O');
        assert(oOfCl !== undefined, 'O–Cl エステルの酸素が見つからない');
        const cOfO = before.bonds
            .filter(b => b.atom1Index === oOfCl || b.atom2Index === oOfCl)
            .map(b => (b.atom1Index === oOfCl ? b.atom2Index : b.atom1Index))
            .find(i => before.atoms[i].element === 'C');
        const pi = st.arrows.find(a => a.source.type === 'bond' && a.target.type === 'mid' &&
            a.target.atoms.includes(cOfO) && a.target.atoms.includes(oOfCl));
        assert(pi && before.atoms.filter((_, i) => pi.source.atoms.includes(i))
            .some(a => a.element === 'H'),
            'C–H の電子対が C=O（mid）に向かっていない');
        const leave = st.arrows.find(a => a.source.type === 'bond' &&
            a.source.atoms.includes(cl) && a.target.type === 'atom' && a.target.index === cl);
        assert(leave, 'O–Cl 結合の電子対が Cl に渡っていない');
        // 生成側の状態で C=O 二重結合ができ、Cl は負電荷の遊離イオンになっている
        const after = rx.states[st.to];
        assert(after.bonds.some(b => b.type === 2 &&
            [b.atom1Index, b.atom2Index].sort((x, y) => x - y).join('_') ===
            [cOfO, oOfCl].sort((x, y) => x - y).join('_')), '生成状態に C=O ができていない');
        const clAfter = after.atoms[cl];
        assert(clAfter.charge === -1 &&
            !after.bonds.some(b => b.atom1Index === cl || b.atom2Index === cl),
            'Cl⁻ が遊離していない');
    });

    test('RX15: 2級アルコールの酸化に機構アニメが繋がっている（propanol2_oxidation）', async (c) => {
        const W = c.W;
        // RX12/RX14 と同じ主旨の双方向固定。1級（RX14）と対になる2級版
        const rule = W.REACTION_RULES.find(r => r.id === 'oxidize_secondary');
        assert(rule && rule.mechanismId === 'propanol2_oxidation',
            `酸化ルールの mechanismId が propanol2_oxidation でない（${rule && rule.mechanismId}）`);
        const rx = (W.reactionPlayer.reactions || []).find(r => r.id === 'propanol2_oxidation');
        assert(rx, 'reactions.json に propanol2_oxidation が無い（死にリンク）');
        assert(rx.states.length === 4 && rx.steps.length === 3,
            `状態/手順の数が想定外（${rx.states.length}/${rx.steps.length}）`);
        // 出発物は2級アルコール（-OH の炭素に C×2・H×1）、生成状態はケトン
        // （C=O の炭素に水素が残らない）であることを添字で確かめる
        const st0 = rx.states[0];
        const nbrsOf = (state, i) => state.bonds
            .filter(b => b.atom1Index === i || b.atom2Index === i)
            .map(b => ({ j: b.atom1Index === i ? b.atom2Index : b.atom1Index, type: b.type }));
        const oIdx = st0.atoms.findIndex((a, i) => a.element === 'O' &&
            nbrsOf(st0, i).some(n => st0.atoms[n.j].element === 'C'));
        const cIdx = nbrsOf(st0, oIdx).map(n => n.j).find(i => st0.atoms[i].element === 'C');
        const st0Nbrs = nbrsOf(st0, cIdx).map(n => st0.atoms[n.j].element);
        assert(st0Nbrs.filter(e => e === 'C').length === 2 && st0Nbrs.filter(e => e === 'H').length === 1,
            `出発物が2級アルコールでない（中心炭素の隣接: ${st0Nbrs.join(',')}）`);
        const last = rx.states[rx.states.length - 1];
        const dbl = nbrsOf(last, cIdx).find(n => n.type === 2 && last.atoms[n.j].element === 'O');
        assert(dbl, '生成状態の中心炭素に C=O ができていない');
        assert(!nbrsOf(last, cIdx).some(n => last.atoms[n.j].element === 'H'),
            'ケトンの C=O 炭素に水素が残っている');
    });

    test('RX16: Undo・全消去で巻矢印が残らない（検品レビュー 16・17）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, D = c.D;
        const rp = W.reactionPlayer;
        const arrows = D.getElementById('arrows-group');

        // 作図してから機構を再生する ＝ Undo履歴があり、かつ巻矢印が出ている状態
        g.setMode('learn');
        const a1 = g.userMolecule.addAtom('C', 336, 294);
        const a2 = g.userMolecule.addAtom('C', 378, 294);
        g.userMolecule.addBond(a1.id, a2.id, 1);
        g.saveState();
        g.updateDrawing();

        rp.enter(0);
        assert(rp.active, '反応機構モードに入れない');
        assert(arrows.childElementCount > 0, '巻矢印が描かれていない（テストの前提が崩れている）');

        // 16: Undo すると機構モードが解けて矢印も消える
        g.undo();
        assert(!rp.active, 'Undo後も反応機構モードが残っている');
        assert(arrows.childElementCount === 0, 'Undo後も巻矢印が残っている');

        // 17: 全消去でも消える。原子が空でも矢印だけ浮くことがないよう掃除する
        rp.enter(0);
        assert(arrows.childElementCount > 0, '再入で巻矢印が出ない');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        D.getElementById('btn-clear-all').click();
        assert(!rp.active, '全消去後も反応機構モードが残っている');
        assert(arrows.childElementCount === 0, '全消去後も巻矢印が残っている');

        // 生成物予測モード中の Undo は正当な編集操作なので機構モードを解除しない
        rp.enter(0);
        rp.startPrediction();
        assert(rp.prediction, '生成物予測モードに入れない');
        g.undo();
        assert(rp.prediction && rp.active, 'Undoで生成物予測モードまで解除された');
        rp.endPrediction(false);
        rp.exit();
        c.reset();
    });

    test('RX10: 芳香環の配向性（o,p-配向 / m-配向）（P12-8 規則層）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, D = c.D;
        // 教科書の配向性: 環に電子を押し込む基（-OH・-NH₂・アルキル・ハロゲン）は
        // オルト・パラへ、環から電子を引く基（-NO₂・-COOH・-SO₃H）はメタへ次を入れる。
        // 判断できるのは「単環に置換基が1つだけ」のときに限る（重ね合わせは扱わない）。
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const molOf = (name) => {
            const e = source.find(x => x.name === name && x.target);
            assert(e, `${name} がライブラリに無い`);
            return g.createTargetFromData({ target: e.target });
        };
        const rule = W.REACTION_RULES.find(r => r.id === 'aromatic_nitration');
        const cases = [
            { name: 'トルエン', op: true },       // アルキル基 → o,p
            { name: 'フェノール', op: true },      // -OH → o,p
            { name: 'アニリン', op: true },        // -NH₂ → o,p
            { name: 'クロロベンゼン', op: true },   // ハロゲンは o,p（ただし反応は遅い）
            { name: 'ニトロベンゼン', op: false },  // -NO₂ → m
            { name: '安息香酸', op: false }        // -COOH → m
        ];
        cases.forEach(tc => {
            const mol = molOf(tc.name);
            const sites = rule.detect(mol);
            assert(sites.length === 3, `${tc.name}: 候補が o/m/p の3通りでない（${sites.length}）`);
            const roles = sites.map(s => W.aromaticSiteRole(mol, s[0]));
            assert(roles.every(r => r), `${tc.name}: 配向性を判断できていない`);
            const major = roles.filter(r => r.major).map(r => r.pos).sort().join(',');
            assert(major === (tc.op ? 'o,p' : 'm'),
                `${tc.name}: 主生成物の位置が「${major}」（期待 ${tc.op ? 'o,p' : 'm'}）`);
        });
        // 判断しない場合: 置換基なし（ベンゼン）・縮合環（ナフタレン）・置換基2つ（サリチル酸）
        [['ベンゼン', '置換基なし'], ['ナフタレン', '縮合環'], ['サリチル酸', '置換基2つ']].forEach(([name, why]) => {
            const mol = molOf(name);
            rule.detect(mol).forEach(s => {
                assert(W.aromaticSiteRole(mol, s[0]) === null,
                    `${name}（${why}）で配向を断定してしまっている`);
            });
        });
        // 電子を引く基が2つ以上ある環には「起こりにくい」注意を出す
        const info = W.REACTION_RULES.find(r => r.id === 'aromatic_deactivated_info');
        assert(info, 'aromatic_deactivated_info が無い');
        assert(info.detect(molOf('p-ジニトロベンゼン')).length === 1,
            'p-ジニトロベンゼンで不活性化の注意が出ない');
        assert(info.detect(molOf('トルエン')).length === 0, 'トルエンで不活性化の注意が出てしまう');
        assert(info.detect(molOf('ニトロベンゼン')).length === 0,
            'ニトロ基1つのニトロベンゼンで不活性化の注意が出てしまう');

        // 実行後の解説に配向性の判定が入る（主生成物か副生成物か）
        g.userMolecule = molOf('ニトロベンゼン');
        g.updateDrawing();
        const btn = [...D.querySelectorAll('#reaction-actions button')]
            .find(b => b.textContent.includes('ニトロ化'));
        assert(btn, 'ニトロ化のボタンが無い');
        btn.click();
        assert(W.reactor.picking, 'ニトロベンゼンで位置の選択モードにならない');
        // メタ位（主生成物）を選ぶ
        const sitesNow = W.reactor.picking.sites;
        const meta = sitesNow.find(s => (W.aromaticSiteRole(g.userMolecule, s[0]) || {}).pos === 'm');
        assert(meta, 'メタ位の候補が見つからない');
        const at = g.userMolecule.atoms.find(a => a.id === meta[0]);
        c.clickAt(at.x, at.y);
        const cap = D.getElementById('verify-result').textContent;
        assert(cap.includes('m-配向性'), `解説に m-配向性の説明が無い（${cap.slice(0, 80)}）`);
        assert(cap.includes('主生成物'), '解説に主生成物かどうかの判定が無い');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX9: 酸化の優先度は分子ごとに判定する（P12-8 反応判定の精査）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        // 「-CHO があればアルコールの酸化を出さない」「-OH が2つ以上なら出さない」は
        // **同じ分子（連結成分）の中だけ**で見なければならない。キャンバスに2分子を
        // 並べる練習（エステル化・分子間脱水）で、隣の分子のせいで反応が消えては困る。
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const put = (names) => {
            const mol = new W.Molecule();
            let shift = 0;
            names.forEach(name => {
                const entry = source.find(x => x.name === name && x.target);
                assert(entry, `${name} がライブラリに無い`);
                const part = g.createTargetFromData({ target: entry.target });
                const map = new Map();
                part.atoms.forEach(a => { map.set(a.id, mol.addAtom(a.element, a.x + shift, a.y).id); });
                part.bonds.forEach(b => mol.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type));
                shift += 400; // 十分離して別分子として置く
            });
            g.userMolecule = mol;
            g.updateDrawing();
            return mol;
        };
        const count = (mol, ruleId) => W.REACTION_RULES.find(r => r.id === ruleId).detect(mol).length;

        // エタノール1分子だけ → 1箇所
        assert(count(put(['エタノール']), 'oxidize_primary') === 1, 'エタノール単独で1級酸化が出ない');
        // エタノール2分子（分子間脱水の練習配置）→ それぞれ酸化できる。
        // -OH の総数が2でも、別の分子なら「多価アルコール」ではない
        const two = put(['エタノール', 'エタノール']);
        assert(count(two, 'oxidize_primary') === 2,
            `別分子のエタノール2つで1級酸化が ${count(two, 'oxidize_primary')} 箇所（2箇所であるべき）`);
        assert(count(two, 'dehydration_inter') === 1, '別分子のエタノール2つで分子間脱水が出ない');
        // アセトアルデヒド＋エタノール → 別分子なのでエタノールの酸化は残る
        const mixed = put(['アセトアルデヒド', 'エタノール']);
        assert(count(mixed, 'oxidize_aldehyde') === 1, 'アセトアルデヒドの酸化が出ない');
        assert(count(mixed, 'oxidize_primary') === 1,
            `別分子のアルデヒドでエタノールの酸化が消えている（${count(mixed, 'oxidize_primary')} 箇所）`);
        // 同じ分子に -CHO と -OH がある場合（鎖状グルコース）は -CHO だけ
        const glc = put(['D-グルコース（鎖状）']);
        assert(count(glc, 'oxidize_aldehyde') === 1, 'グルコースのアルデヒド酸化が出ない');
        assert(count(glc, 'oxidize_primary') === 0 && count(glc, 'oxidize_secondary') === 0,
            'グルコースでアルコールの酸化が並んでいる（-CHO の方が酸化されやすい）');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX7: 候補に出た反応は必ず実行できる（P12-8 反応判定の精査）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        // 「検出はするが実行すると失敗する」候補を出さないことの担保。
        // 芳香族置換は置換基を置く空間が要るため、まわりが混んでいると apply が例外を投げていた
        //（例: サリチル酸のニトロ化・スルホン化で1箇所）。detect 側で置けるかを試すようにした。
        // 酸無水物の加水分解（新ルール）も、候補に出たら必ず実行できることを確かめる
        const names = ['ベンゼン', 'トルエン', 'フェノール', 'サリチル酸', 'p-ジニトロベンゼン',
                       'クメン（イソプロピルベンゼン）', '無水酢酸', '無水フタル酸', 'パラセタモール'];
        const source = (W.COMPOUNDS || []).concat(W.STAGES || []);
        const snapshot = (mol) => JSON.stringify({
            atoms: mol.atoms.map(a => ({ ...a })),
            bonds: mol.bonds.map(b => ({ atomId1: b.atomId1, atomId2: b.atomId2, type: b.type }))
        });
        const restore = (mol, saved) => {
            const st = JSON.parse(saved);
            mol.atoms = st.atoms.map(a => Object.assign(new W.Atom(a.id, a.element, a.x, a.y, a.isLocked), a));
            mol.bonds = st.bonds.map(b => new W.Bond(b.atomId1, b.atomId2, b.type));
        };
        let checked = 0;
        names.forEach(name => {
            const entry = source.find(x => x.name === name && x.target);
            assert(entry, `${name} がライブラリに無い`);
            const mol = g.createTargetFromData({ target: entry.target });
            g.userMolecule = mol;
            g.updateDrawing();
            W.REACTION_RULES.forEach(rule => {
                let sites = [];
                try { sites = rule.detect(mol); } catch (e) { sites = []; }
                sites.forEach(site => {
                    const saved = snapshot(mol);
                    let failed = null;
                    try { rule.apply(g, site); } catch (e) { failed = e.message; }
                    restore(mol, saved);
                    checked++;
                    assert(!failed, `${name}: ${rule.id} が候補に出たのに実行できない（${failed}）`);
                });
            });
        });
        assert(checked > 30, `検査した候補が少なすぎる（${checked}件。テストが素通りしている可能性）`);
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX17: 反応させる分子は3つ以上選べて、候補が消えない（レビュー項目15）', async (c) => {
        c.reset();
        const g = c.game, W = c.W, D = c.D;
        g.setMode('free');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        // シュウ酸（2価カルボン酸）＋エタノール2分子でジエステルを作る道具立て。
        // 4つ目の酢酸は「選んでいない分子」＝絞り込みで消えるべき相手として置く
        ['シュウ酸', 'エタノール', 'エタノール', '酢酸'].forEach(n => g.summonMolecule(n));
        const parts = g.splitMolecules();
        assert(parts.length === 4, `分子が ${parts.length} 個（4個で始める前提が崩れている）`);
        const rep = parts.map(p => p.atoms[0]);
        // 呼び出し順にそのまま並ぶので、代表原子も シュウ酸/エタノール/エタノール/酢酸 の順
        const est = W.REACTION_RULES.find(r => r.id === 'esterification');

        // 絞り込み前: カルボキシ基3（シュウ酸2＋酢酸1）× アルコール2 = 6箇所
        assert(est.detect(g.userMolecule).length === 6,
            `絞り込み前のエステル化候補が ${est.detect(g.userMolecule).length} 件（6件の前提）`);

        // カードに出た「エステル化」ボタンの箇所数を読む（絞り込みは refresh が担当する）
        const shownSites = () => {
            W.reactor.refresh();
            const btn = [...D.getElementById('reaction-actions').querySelectorAll('button')]
                .find(b => b.textContent.startsWith('エステル化'));
            if (!btn) return 0;
            const m = btn.textContent.match(/（(\d+)箇所）/);
            return m ? Number(m[1]) : 1;
        };

        g.selectedMolecules = [];
        assert(shownSites() === 6, '選択なしで6箇所出ない');

        // 2つ選択（シュウ酸＋エタノール1つ）… カルボキシ基2 × そのアルコール1 = 2箇所
        g.selectedMolecules = [];
        g.toggleMoleculeSelection(rep[0]);
        g.toggleMoleculeSelection(rep[1]);
        assert(shownSites() === 2, `2つ選択で ${shownSites()} 箇所（2箇所の前提）`);

        // 3つ選択（シュウ酸＋エタノール2つ）… 2 × 2 = 4箇所。
        // **v439 はここが0件だった**（「すべての選択分子に跨る箇所だけ」＝3分子を跨ぐ
        // 反応は無いので全滅していた）
        g.toggleMoleculeSelection(rep[2]);
        assert(g.selectedMolecules.length === 3,
            `3つ目が選べていない（${g.selectedMolecules.length}件）`);
        assert(shownSites() === 4, `3つ選択で ${shownSites()} 箇所（4箇所の前提。0なら絞り込みが全滅している）`);

        // 選んでいない酢酸が絡む箇所は消えている
        const acetic = new Set(g.moleculeAtomIdsOf(rep[3].id));
        const sel = new Set();
        g.selectedMoleculeSets().forEach(s => s.forEach(id => sel.add(id)));
        assert([...acetic].every(id => !sel.has(id)), '酢酸が選択に混ざっている');

        // 4つ目まで選べる（油脂＝グリセリン＋脂肪酸3分子に届く上限）
        g.toggleMoleculeSelection(rep[3]);
        assert(g.selectedMolecules.length === 4, `4つ目が選べていない（${g.selectedMolecules.length}件）`);

        // 実際に2回エステル化してジエステルになる（同じ選択のまま続けられること）
        g.selectedMolecules = [];
        g.toggleMoleculeSelection(rep[0]);
        g.toggleMoleculeSelection(rep[1]);
        g.toggleMoleculeSelection(rep[2]);
        for (let k = 0; k < 2; k++) {
            const inSel = new Set();
            g.selectedMoleculeSets().forEach(s => s.forEach(id => inSel.add(id)));
            const ss = est.detect(g.userMolecule).filter(s => s.every(id => inSel.has(id)));
            assert(ss.length > 0, `${k + 1}回目のエステル化の候補が無い`);
            W.reactor.execute(est, ss[0]);
        }
        const esters = c.W.findFunctionalGroups(g.userMolecule).filter(x => x.type === 'ester');
        assert(esters.length === 2, `エステル結合が ${esters.length} 本（シュウ酸ジエチルなら2本）`);
        // 1つに繋がったあとも「2分子を選んでいる」ことにならない（同じ成分はまとめる）
        const sets = g.selectedMoleculeSets();
        const keys = new Set(sets.map(s => [...s].sort().join(',')));
        assert(keys.size === sets.length, '同じ分子を指す選択が重複して残っている');

        g.selectedMolecules = [];
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX18: 同じ反応を繰り返してエステルを2本・3本と増やせる（レビュー項目15）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        const est = W.REACTION_RULES.find(r => r.id === 'esterification');
        // 結合線が無関係な原子を貫通していないか（RX10b と同じ検査）
        const pierces = () => {
            const m = g.userMolecule;
            const hits = [];
            m.bonds.forEach(b => {
                const a1 = m.atoms.find(a => a.id === b.atomId1);
                const a2 = m.atoms.find(a => a.id === b.atomId2);
                if (!a1 || !a2) return;
                m.atoms.forEach(p => {
                    if (p.id === a1.id || p.id === a2.id || p.element === 'H') return;
                    const vx = a2.x - a1.x, vy = a2.y - a1.y, L2 = vx * vx + vy * vy;
                    if (!L2) return;
                    const t = ((p.x - a1.x) * vx + (p.y - a1.y) * vy) / L2;
                    if (t <= 0.02 || t >= 0.98) return;
                    const d = Math.hypot(a1.x + t * vx - p.x, a1.y + t * vy - p.y);
                    if (d < 10) hits.push(`${a1.element}-${a2.element} が ${p.element} を貫通（${d.toFixed(1)}px）`);
                });
            });
            return hits;
        };
        // n 回続けてエステル化する。候補は全部試し、1つでも通れば1回ぶんとする
        const run = (names, n) => {
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            names.forEach(x => g.summonMolecule(x));
            for (let k = 0; k < n; k++) {
                const sites = est.detect(g.userMolecule);
                let applied = false;
                for (const s of sites) {
                    g.saveState();
                    try { est.apply(g, s); applied = true; break; }
                    catch (e) {
                        const h = g.history.pop();
                        if (h) g.restoreState(JSON.parse(h));
                    }
                }
                g.updateDrawing();
                assert(applied,
                    `${names.join('＋')}: ${k + 1}回目のエステル化がどの箇所でも実行できない（候補 ${sites.length} 件）`);
            }
            return c.W.findFunctionalGroups(g.userMolecule).filter(x => x.type === 'ester').length;
        };

        // (1) 2価カルボン酸＋アルコール2分子 → ジエステル（レビューが名指しした形）
        assert(run(['シュウ酸', 'エタノール', 'エタノール'], 2) === 2, 'シュウ酸ジエチルにならない');
        assert(pierces().length === 0, `ジエステル: ${pierces().join(' / ')}`);

        // (2) 2価アルコール＋カルボン酸2分子（逆向きの2価）
        assert(run(['エチレングリコール', '酢酸', '酢酸'], 2) === 2, '二酢酸エチレンにならない');
        assert(pierces().length === 0, `2価アルコール側: ${pierces().join(' / ')}`);

        // (3) グリセリン＋酢酸3分子 → トリエステル（油脂と同じ形）。
        // **v439 では2回目が「生成物を配置する空間がありません」で必ず失敗していた**
        assert(run(['グリセリン', '酢酸', '酢酸', '酢酸'], 3) === 3, 'トリエステルにならない');
        assert(pierces().length === 0, `トリエステル: ${pierces().join(' / ')}`);
        // 刻みの違う分子（グリセリン 42px・酢酸 80px）をつないでも、生成物の結合長はそろう
        const prod = g.splitMolecules().find(p => p.atoms.length > 4);
        const ids = new Set(prod.atoms.map(a => a.id));
        const lens = g.userMolecule.bonds
            .filter(b => ids.has(b.atomId1) && ids.has(b.atomId2))
            .map(b => {
                const a1 = g.userMolecule.atoms.find(a => a.id === b.atomId1);
                const a2 = g.userMolecule.atoms.find(a => a.id === b.atomId2);
                return Math.round(Math.hypot(a1.x - a2.x, a1.y - a2.y));
            });
        assert(lens.every(d => d === lens[0]),
            `生成物の結合長がそろっていない（${[...new Set(lens)].join(',')}）＝刻みの違う分子が混ざったまま`);
        // 化学が合っていること: エステル3本・遊離の -OH と -COOH はゼロ
        const groups = c.W.findFunctionalGroups(g.userMolecule);
        assert(!groups.some(x => x.type === 'carboxyl'), 'カルボキシ基が残っている');
        assert(!groups.some(x => String(x.type).startsWith('alcohol')), 'アルコールの -OH が残っている');

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX19: 反応でできた副生成物が反応した場所のそばに残る（レビュー項目15）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        const est = W.REACTION_RULES.find(r => r.id === 'esterification');
        // v439 は「全原子の右端＋2マス」に水を置いていたので、反応を重ねるほど右へ伸び、
        // グリセリンの3本目では x=1360（そのときの視野は 238〜1312）＝**画面の外**に出ていた。
        // 反応のたびに視野を合わせ直すとキャンバスが跳ねるので、置き場の方を近くにした
        const check = (names, n) => {
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            names.forEach(x => g.summonMolecule(x));
            for (let k = 0; k < n; k++) {
                for (const s of est.detect(g.userMolecule)) {
                    g.saveState();
                    try { est.apply(g, s); break; }
                    catch (e) {
                        const h = g.history.pop();
                        if (h) g.restoreState(JSON.parse(h));
                    }
                }
                g.updateDrawing();
            }
            const m = g.userMolecule;
            const by = m.atoms.filter(a => a.fromReaction);
            const rest = m.atoms.filter(a => !a.fromReaction && a.element !== 'H');
            assert(by.length === n, `${names.join('＋')}: 副生成物が ${by.length} 個（${n} 個の想定）`);
            const x1 = Math.min(...rest.map(a => a.x)), x2 = Math.max(...rest.map(a => a.x));
            const y1 = Math.min(...rest.map(a => a.y)), y2 = Math.max(...rest.map(a => a.y));
            const G = W.bondStep(m);
            by.forEach(a => {
                const gap = Math.max(x1 - a.x, a.x - x2, y1 - a.y, a.y - y2, 0) / G;
                assert(gap <= 3,
                    `${names.join('＋')}: 副生成物が生成物から ${gap.toFixed(1)} マス離れている（3マス以内の想定）`);
            });
        };
        check(['酢酸', 'エタノール'], 1);
        check(['シュウ酸', 'エタノール', 'エタノール'], 2);
        check(['グリセリン', '酢酸', '酢酸', '酢酸'], 3);

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('RX20: ヨードホルム反応の陽性・陰性と生成物（CHI₃ ＋ カルボン酸のナトリウム塩）', async (c) => {
        c.reset();
        const g = c.game, W = c.W;
        const rule = W.REACTION_RULES.find(r => r.id === 'iodoform');
        assert(rule, 'ヨードホルム反応のルールが無い');
        const load = (name) => {
            g.setMode('free');
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.summonMolecule(name);
            return g.userMolecule;
        };

        // (1) 陽性 … CH₃-CO- か CH₃-CH(OH)- を持つもの。**箇所は1件にまとまる**
        //     （アセトンはメチルが2つあるが、どちらで切っても生成物が同じ）
        ['エタノール', '2-プロパノール', 'アセトアルデヒド', 'アセトン', '乳酸', '2-ペンタノン'].forEach(n => {
            const sites = rule.detect(load(n));
            assert(sites.length === 1, `${n} のヨードホルム反応の箇所が ${sites.length} 件（1件の想定）`);
        });

        // (2) 陰性 … **この反応は陰性の例と並べて初めて意味がある**ので、ここで固定する。
        //     1-プロパノールは隣が -CH₂- でメチルでない／メタノールは「隣のメチル」が無い／
        //     酢酸・酢酸エチル・酢酸ナトリウムはカルボニル炭素に単結合の O が付いた別の型
        ['1-プロパノール', 'メタノール', '酢酸', '酢酸エチル', '酢酸ナトリウム',
            'ホルムアルデヒド', '1-ブタノール', 'エチレングリコール', 'フェノール',
            'ジエチルエーテル'].forEach(n => {
            const sites = rule.detect(load(n));
            assert(sites.length === 0, `${n} が陽性になっている（${sites.length} 箇所）`);
        });

        // (3) 生成物 … CHI₃ と、炭素が1つ減ったカルボン酸のナトリウム塩に分かれる
        [['エタノール', 'ギ酸ナトリウム'],
            ['アセトアルデヒド', 'ギ酸ナトリウム'],
            ['2-プロパノール', '酢酸ナトリウム'],
            ['アセトン', '酢酸ナトリウム']].forEach(([from, saltName]) => {
            const mol = load(from);
            W.reactor.execute(rule, rule.detect(mol)[0]);
            const parts = g.splitMolecules();
            assert(parts.length === 2, `${from}: 生成物が ${parts.length} 個（CHI₃ と塩の2個の想定）`);
            const names = parts.map(p => g.lookupCompoundName(p)).sort();
            assert(names.includes('ヨードホルム（トリヨードメタン）'),
                `${from}: ヨードホルムができていない（${names.join(' / ')}）`);
            assert(names.includes(saltName),
                `${from}: ${saltName} ができていない（${names.join(' / ')}）`);
            // 価標が壊れていない・作図が潰れていない（監査のしきい値 24px）
            const m = g.userMolecule;
            assert(m.atoms.every(a => W.isValencyValid(m, a.id)), `${from}: 生成物の価標が不正`);
            const heavy = m.atoms.filter(a => a.element !== 'H');
            let minD = Infinity;
            for (let i = 0; i < heavy.length; i++) {
                for (let j = i + 1; j < heavy.length; j++) {
                    minD = Math.min(minD, Math.hypot(heavy[i].x - heavy[j].x, heavy[i].y - heavy[j].y));
                }
            }
            assert(minD >= 24, `${from}: 生成物の重原子が ${minD.toFixed(1)}px まで近い（24px 未満）`);
        });

        // (4) 生成した CHI₃ にもう一度この反応は起きない（連打で壊れない）
        assert(rule.detect(g.userMolecule).length === 0, '生成物にヨードホルム反応の箇所が残っている');

        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('ST38: 立体のみの書き出し練習 — 種類数・メソ/環対称の畳み込み・読めない図と構造変更の拒否', async (c) => {
        c.reset();
        const g = c.game, W = c.W, sp = W.stereoPractice;
        assert(sp, 'stereoPractice が初期化されていない');
        ['butene', 'lactic', 'tartaric', 'lactide'].forEach(k => {
            try { W.localStorage.removeItem('chemStereoPractice.' + k); } catch (e) { /* noop */ }
        });
        g.setMode('learn');

        // (1) 4題すべて準備でき、種類数が既知値（2ⁿ の畳み込み込み）と一致する
        const want = [2, 2, 3, 4];
        const prepared = sp.problems.map((p, i) => sp.prepare(i));
        prepared.forEach((d, i) => {
            assert(!d.disabled, `${sp.problems[i].label} が準備できない`);
            assert(d.variants.length === want[i],
                `${sp.problems[i].label} の立体異性体が ${d.variants.length} 種（期待 ${want[i]}）`);
        });
        assert(prepared[0].units.length === 1 && prepared[0].units[0].kind === 'geo',
            '2-ブテンの立体単位が C=C でない');
        assert(prepared[1].units.length === 1 && prepared[1].units[0].kind === 'fischer',
            '乳酸の立体単位が不斉炭素でない');
        assert(prepared[2].info.naive === 4 && prepared[2].info.folded,
            '酒石酸で 2²=4→3 の畳み込み（メソ体）が検出されない');
        assert(prepared[3].info.naive === 8 && prepared[3].info.folded,
            '環状エステルで 2³=8→4 の畳み込み（回転対称）が検出されない');

        // (2) 酒石酸: お題の図がキャンバスに置かれ、そのまま1種目として登録できる
        sp.start(2);
        assert(sp.active && sp.problem.total === 3, '酒石酸のセッションが始まらない');
        assert(g.userMolecule.atoms.length > 0 && W.canonicalCode(g.userMolecule) === sp.problem.code,
            'お題の図がキャンバスに置かれない');
        sp.register();
        assert(sp.entries.length === 1 && sp.entries[0].name === '酒石酸',
            `お題の図が登録できない／名称が付かない（${sp.entries[0] && sp.entries[0].name}）`);
        assert(g.userMolecule.atoms.length > 0, '登録後に図が消えている（この練習では図を残す）');

        // (3) どちらの中心を1つだけ反転しても同じ分子（メソ体）にまとまる
        const load = t => { g.userMolecule = g.createTargetFromData({ target: t }); g.updateDrawing(); };
        const d2 = prepared[2];
        assert(d2.units.length === 2 && d2.units.every(x => x.kind === 'fischer'),
            '酒石酸の単位が2つのフィッシャー中心でない');
        const fA = W.spApplyFlip(g, d2.target, d2.units[0]);
        const fB = W.spApplyFlip(g, d2.target, d2.units[1]);
        assert(fA && fB, '中心を1つ反転した図が作れない');
        load(fA); sp.register();
        assert(sp.entries.length === 2 && sp.uniqueCorrectCodes().size === 2, '1中心反転の図が登録できない');
        load(fB); sp.register();
        assert(sp.entries.length === 3 && sp.uniqueCorrectCodes().size === 2,
            'どちらの中心を反転しても同じ分子（メソ体）にまとまらない');

        // (4) 両中心の反転（鏡像）で3種そろい、クリア記録が残る
        const fAB = W.spApplyFlip(g, fA, d2.units[1]);
        assert(fAB, '2中心を反転した図が作れない');
        load(fAB); sp.register();
        assert(sp.uniqueCorrectCodes().size === 3, '3種目（鏡像）が登録できない');
        assert(W.localStorage.getItem('chemStereoPractice.tartaric') === '1', 'クリア記録が残らない');

        // (5) 読めない図（-OH を斜めへ）・つながり方を変えた図は理由を出して拒否する
        const before = sp.entries.length;
        const bad = JSON.parse(JSON.stringify(d2.target));
        bad.atoms[6].x = 352; bad.atoms[6].y = 266; // C2位の -OH を軸から外す（±25°の外）
        load(bad); sp.register();
        assert(sp.entries.length === before, '立体の読めない図が登録されてしまう');
        const alt = JSON.parse(JSON.stringify(d2.target));
        const b27 = alt.bonds.find(b => (b.atom1Index === 2 && b.atom2Index === 7) ||
                                        (b.atom1Index === 7 && b.atom2Index === 2));
        assert(b27, 'テスト前提（C3位の C-OH 結合）が見つからない');
        b27.atom1Index = 1; b27.atom2Index = 7; // -OH を隣の炭素へ付け替え（分子式は同じ・構造異性体）
        load(alt); sp.register();
        assert(sp.entries.length === before, 'つながり方の変わった図が登録されてしまう');

        // (6) 環状エステル: どの1中心を反転しても同じ分子（環の回転対称）・4種すべて登録できる
        sp.stop();
        sp.start(3);
        const d3 = prepared[3];
        assert(d3.units.length === 3 && d3.units.every(x => x.kind === 'ring'),
            '環状エステルの単位が3つの環中心でない');
        const singles = d3.units.map(u => W.spApplyFlip(g, d3.target, u));
        assert(singles.every(Boolean), '環中心を反転した図が作れない');
        const codeOf = t => W.readStereoOf(g.createTargetFromData({ target: t })).stereoCode;
        const sc = singles.map(codeOf);
        assert(sc[0] === sc[1] && sc[1] === sc[2],
            'どの1中心を反転しても同じ分子になるはず（環の3回回転対称）');
        d3.variants.forEach(v => { load(v.target); sp.register(); });
        assert(sp.uniqueCorrectCodes().size === 4, '環状エステルの4種がそろわない');
        assert(W.localStorage.getItem('chemStereoPractice.lactide') === '1', 'クリア記録が残らない');

        // (7) 答え合わせ: 鏡像の組の注記が出て、stop で閉じる
        sp.openReview('answer');
        const ov = c.D.getElementById('sp-review-overlay');
        assert(!ov.classList.contains('hidden'), '答え合わせオーバーレイが開かない');
        assert(/鏡像/.test(ov.textContent), '鏡像の組の注記が出ない');
        assert(/2ⁿ＝8/.test(ov.textContent.replace(/\s/g, '')) || /8 通り/.test(ov.textContent),
            '2ⁿ が崩れる理由の説明が出ない');
        sp.stop();
        assert(!sp.active && ov.classList.contains('hidden'), 'stop() で練習・オーバーレイが閉じない');
        g.setMode('puzzle');
    });

    test('CD1: キャンバスでも長い鎖を畳む（項目25 第2段。既存の「🔤 官能基をまとめる」に相乗り）', async (c) => {
        c.reset();
        const W = c.W, D = c.D, g = c.game;
        const btn = D.getElementById('btn-condense');
        assert(btn, '「🔤 官能基をまとめる」ボタンが無い');
        assert(typeof W.findCondensableChainRuns === 'function',
            'findCondensableChainRuns が公開されていない（quiz.js から切り出した検出）');
        const drawn = () => ({
            atoms: D.querySelectorAll('#atoms-group .svg-atom-node').length,
            labels: [...D.querySelectorAll('#atoms-group text')]
                .filter(t => /CH₂/.test(t.textContent)).map(t => t.textContent)
        });
        const startCondensed = g.condensedMode;
        if (startCondensed) btn.click();

        // (1) 長い鎖: 描く原子がごっそり減り、(CH₂)ₙ のラベルが1枚出る
        g.setMode('free');
        g.userMolecule = new W.Molecule(); g.updateDrawing();
        g.summonMolecule('ステアリン酸');
        const heavyBefore = g.userMolecule.atoms.length;
        const before = drawn();
        btn.click();
        const after = drawn();
        assert(after.labels.length === 1 && after.labels[0] === '(CH₂)₁₆',
            `ラベルが (CH₂)₁₆ にならない（${JSON.stringify(after.labels)}）`);
        assert(after.atoms < before.atoms / 4,
            `描く原子が十分に減っていない（${before.atoms} → ${after.atoms}）`);

        // (2) **作図データは1つも変わらない**（表示だけの切替）
        assert(g.userMolecule.atoms.length === heavyBefore, '畳んだら作図データの原子が変わった');
        assert(g.lookupCompoundName(g.userMolecule) === 'ステアリン酸', '畳んだら名前が変わった');

        // (3) 戻せる
        btn.click();
        const back = drawn();
        assert(back.atoms === before.atoms && back.labels.length === 0,
            `戻したのに元に戻らない（${JSON.stringify(back)}）`);

        // (4) 3個以上続くメチレン鎖を持たない分子は、鎖のラベルが出ない（官能基の縮約は従来どおり）
        g.userMolecule = new W.Molecule(); g.updateDrawing();
        g.summonMolecule('酢酸');
        btn.click();
        assert(drawn().labels.length === 0, '短い分子に (CH₂)ₙ のラベルが出た');
        btn.click();

        // (5) 環は畳まない（畳むとどこへ折り返すか決まらない）
        g.userMolecule = new W.Molecule(); g.updateDrawing();
        g.summonMolecule('シクロヘキサン');
        btn.click();
        assert(drawn().labels.length === 0, '環を畳んでしまった');
        btn.click();

        g.userMolecule = new W.Molecule(); g.updateDrawing();
        if (g.condensedMode !== startCondensed) btn.click();
    });

    test('TG1: お手本モーダル（図に合わせた枠・拡大・鎖の畳み。表示だけで判定は動かない・項目10）', async (c) => {
        c.reset();
        const W = c.W, D = c.D, g = c.game;
        const idx = W.STAGES.findIndex(s => s.name === 'ステアリン酸');
        assert(idx >= 0, 'ステアリン酸のステージが無い');
        const snapshot = JSON.stringify(W.STAGES.map(s => s.target));
        const vbOf = () => D.getElementById('target-svg').getAttribute('viewBox').split(' ').map(Number);
        const open = i => { g.loadStage(i); D.getElementById('btn-show-target').click(); };
        const close = () => D.getElementById('btn-close-target').click();

        // (1) どのステージでも、図が枠（viewBox）から1つもはみ出さない。
        // 以前は viewBox が 0 0 400 400 の固定で、ステアリン酸は 56 原子中 29 個が枠の外だった
        const outside = [];
        for (let i = 0; i < W.STAGES.length; i++) {
            open(i);
            const vb = vbOf();
            assert(vb.length === 4 && vb.every(n => isFinite(n)) && vb[2] > 0 && vb[3] > 0,
                `${W.STAGES[i].name}: viewBox が壊れている（${vb.join(' ')}）`);
            const circles = [...D.querySelectorAll('#target-atoms circle')];
            assert(circles.length > 0, `${W.STAGES[i].name}: お手本に原子が描かれていない`);
            const off = circles.some(el => {
                const x = +el.getAttribute('cx'), y = +el.getAttribute('cy'), r = +el.getAttribute('r');
                return x - r < vb[0] || x + r > vb[0] + vb[2] || y - r < vb[1] || y + r > vb[1] + vb[3];
            });
            if (off) outside.push(W.STAGES[i].name);
            close();
        }
        assert(outside.length === 0, `お手本が枠からはみ出す: ${outside.join(', ')}`);

        // (2) 鎖の畳みは**表示だけ**。ボタンで行き来しても元データは書き換わらない
        open(idx);
        const btn = D.getElementById('btn-target-condense');
        assert(!btn.classList.contains('hidden'), 'ステアリン酸で鎖の畳みボタンが出ていない');
        const drawn = () => ({
            atoms: D.querySelectorAll('#target-atoms circle').length,
            labels: D.querySelectorAll('#target-atoms .chain-condensed').length
        });
        if (!g.targetView.condense) btn.click();
        const folded = drawn();
        assert(folded.labels === 1, '(CH₂)ₙ のラベルが出ない');
        assert(!D.getElementById('target-condense-note').classList.contains('hidden'),
            '畳んでいるのに注記が出ない（正解構造を隠したまま黙っている）');
        btn.click();
        const full = drawn();
        assert(full.labels === 0 && full.atoms > folded.atoms,
            `畳みを解いても図が戻らない（${folded.atoms}→${full.atoms}）`);
        assert(JSON.stringify(W.STAGES.map(s => s.target)) === snapshot,
            'お手本を描いただけで STAGES のデータが書き換わった');

        // (3) 畳み方に関係なく判定は同じ。**畳んだ図は別の分子**なので、
        // もし判定の側に混ざれば必ず落ちる ＝ 表示専用に留めていることの担保
        [true, false].forEach(fold => {
            g.targetView.condense = fold;
            g.targetView.condenseChosen = true;
            g.renderTargetAnswer(true);
            assert(W.verifyMolecule(g.createTargetFromData(W.STAGES[idx]), g.createTargetFromData(W.STAGES[idx])),
                `畳み=${fold} で正解が正解でなくなった`);
        });
        const cs = W.condenseChainForDisplay(W.STAGES[idx].target);
        assert(cs && !W.verifyMolecule(g.createTargetFromData({ target: cs }), g.createTargetFromData(W.STAGES[idx])),
            '畳んだ図が元の分子と同じ扱いになっている（表示専用の前提が崩れている）');
        close();

        // (4) 拡大・縮小・全体表示
        open(idx);
        const base = vbOf();
        D.getElementById('btn-target-zoom-in').click();
        assert(g.targetView.zoom > 1 && vbOf()[2] < base[2], '＋ で拡大されない');
        assert(D.getElementById('target-zoom-label').textContent === `${Math.round(g.targetView.zoom * 100)}%`,
            '倍率の表示が実際とずれている');
        D.getElementById('btn-target-zoom-out').click();
        D.getElementById('btn-target-zoom-out').click();
        assert(g.targetView.zoom === 1, '縮小が 1 倍で止まらない（全体より小さく描いてしまう）');
        D.getElementById('btn-target-zoom-in').click();
        D.getElementById('btn-target-zoom-reset').click();
        assert(vbOf().join(' ') === base.join(' '), '⟲ で全体表示に戻らない');

        // (5) 拡大したまま端まで動かしても、図の外へ流れて見失わない
        g.targetView.zoom = 3;
        g.targetView.cx = 1e6;
        g.targetView.cy = -1e6;
        g.applyTargetView();
        const far = vbOf();
        assert(far[0] >= base[0] - 0.5 && far[0] + far[2] <= base[0] + base[2] + 0.5, '横に流れて図を見失う');
        assert(far[1] >= base[1] - 0.5 && far[1] + far[3] <= base[1] + base[3] + 0.5, '縦に流れて図を見失う');
        close();
    });

    /* ---- 押せるものの大きさ（docs/REVIEW_layout_devices.md 論点C） ----
       Apple の指針は 44pt・Google は 48dp。32px はその手前の最低ラインで、
       assembler では「⚗ この分子の反応」カードの導線が 31px・名称の入力欄が 27px・
       ヘッダーの❓が 29px と、そこにも届いていなかった（20端末すべてで検出）。
       tools/check-mobile.mjs と同じ物差しで、ここでも見張る
       （あちらは無人実行、こちらはコミット前の門番）。

       数え方も check-mobile.mjs に合わせる:
       **本文中のリンク（display:inline の a）は数えない**。行の一部であって押しボタンではなく、
       ここを拾うと「遊び方と操作方法」の解説だけで数百件になって使い物にならない。

       幅は2つ測る。**❓ヘルプは 900px 以上でだけ 29px だった**（≤899px には別の
       padding 指定がある）ので、スマホ幅だけ見ていると取り逃す。逆にカードの3本と
       入力欄はスマホ幅でも同じ大きさなので、狭いほうでも見ておく。 */
    test('TAP1: 押せるものが 32px 未満にならない（自由モード・幅1000px と 375px）', async (c) => {
        const { W, D } = c;
        const frame = W.frameElement;
        const savedWidth = frame.style.width;
        c.reset();
        // check-mobile.mjs は初期状態（＝🧪自由）を測っている。同じ画面をここでも測る
        c.game.setMode('free');
        await c.tick(60);

        const scan = () => {
            const bad = [];
            D.querySelectorAll('button, input, select, summary, a').forEach((e) => {
                const r = e.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) return;
                const cs = W.getComputedStyle(e);
                if (cs.visibility === 'hidden') return;
                if (e.tagName === 'A' && cs.display === 'inline') return;
                if (r.height < 32 || r.width < 24) {
                    bad.push((e.id ? '#' + e.id : e.tagName +
                        (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')) +
                        ' ' + Math.round(r.width) + '×' + Math.round(r.height));
                }
            });
            return bad;
        };

        try {
            // (1) 広い幅（ヘッダーの❓が痩せるのはこちら側）
            assert(W.innerWidth >= 900, `テスト用 iframe が狭く、900px 以上の検査が走らなかった（${W.innerWidth}px）`);
            const wide = scan();
            assert(!wide.length, `幅${W.innerWidth}px: 32px に届かない標的が ${wide.length} 件 — ` +
                [...new Set(wide)].slice(0, 8).join(' / '));

            // (2) スマホ幅（カードの3本と名称の入力欄はこちらでも同じ大きさ）
            frame.style.width = '375px';
            await c.tick(250);
            assert(W.innerWidth <= 400, `iframe が 375px に縮まらず、スマホ幅の検査が走らなかった（${W.innerWidth}px）`);
            const narrow = scan();
            assert(!narrow.length, `幅${W.innerWidth}px: 32px に届かない標的が ${narrow.length} 件 — ` +
                [...new Set(narrow)].slice(0, 8).join(' / '));
        } finally {
            frame.style.width = savedWidth;
            await c.tick(250);
        }
    });

    // ===== 入口（導線）の見直し・DESIGN_entry_points.md 案A =====

    test('EP1: 名称呼び出しは作業帯の 🧪 標準の面にある（A-4・項目19 → 第5段）', async (c) => {
        c.reset();
        const D = c.D, g = c.game;
        const input = D.getElementById('summon-input');
        assert(input, '名称呼び出しの入力欄が無い');
        // 置き場所（第5段）: 右パネルの「🔍 いま描いている分子」→ **作業帯の 🧪 標準の面**（§5-2 の 46）。
        // A-4 の主張（「⚗ この分子の反応」の底に埋めない ＝ これは反応ではなく**作図の道具**）はそのまま
        assert(D.getElementById('ws-free').contains(input),
            '名称呼び出しが 🧪 標準の面（#ws-free）に無い');
        assert(D.getElementById('work-strip').contains(input), '名称呼び出しが作業帯の外にある');

        // ⚠ **パズルでは出さなくなった**（第5段）。A-4 の副産物だった「パズルでも呼び出せる」は
        //    帯を薄く保つ代わりに手放した（§16-3 の「縦画面でキャンバスの 30% 以内」）。
        //    呼び出しそのものは標準モードで従来どおり効く
        g.setMode('puzzle');
        assert(input.offsetParent === null, 'パズルなのに名称呼び出しが帯に出ている');
        g.setMode('free');
        assert(input.offsetParent !== null, '標準（自由）で名称呼び出しが見えない');
        input.value = 'エタノール';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(g.userMolecule.atoms.some(a => a.element === 'O') &&
            g.userMolecule.atoms.filter(a => a.element === 'C').length === 2,
            '名称から分子を呼び出せない');
        assert(D.getElementById('compound-name').textContent.includes('エタノール'),
            '呼び出した分子の名前が「🔍 いま描いている分子」に出ない');

        // 「⚗ この分子の反応」の案内文が、移設後の場所（上）を指している（開発方針5章: 案内と実装の一致）
        g.setMode('free');
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        g.updateReactionCard();
        const props = D.getElementById('molecule-props').textContent;
        assert(!props.includes('下の検索'), `案内文が移設前の場所を指している: ${props}`);
        assert(props.includes('名称から分子を呼び出す'), `案内文が呼び出しの場所を指していない: ${props}`);

        g.setMode('free');
    });

    test('EP2: 遊び方と操作方法は畳んである（A-5・D5）', async (c) => {
        const D = c.D, g = c.game;
        const box = D.querySelector('.hint-box');
        assert(box, '操作説明の箱が無い');
        const det = box.closest('details');
        assert(det, '操作説明が details で包まれていない（A-5 が戻っている）');
        assert(!det.open, '操作説明の既定が開きっぱなし');
        // 中身は畳んだだけで消していない（R11 が読む li がそのまま残っている）
        assert(box.querySelectorAll('li').length >= 8, '畳むついでに説明の中身が減っている');
        assert(/遊び方と操作方法/.test(det.querySelector('summary').textContent),
            '把手に「遊び方と操作方法」が無い（何が畳まれているか分からない）');
        // v651（リボン統合 第2段）で置き場所が右パネル → Help モーダルに変わったので、
        // 「開いたら見える」を見るには先にモーダルを出す必要がある
        const modal = D.getElementById('tutorial-modal');
        assert(modal.contains(det), '遊び方が Help モーダルの外にある（第2段の移設が戻っている）');
        const wasHidden = modal.classList.contains('hidden');
        modal.classList.remove('hidden');
        try {
            // 閉じている間は中の項目が見えない（details は content-visibility で隠すので checkVisibility で見る）
            assert(!box.checkVisibility(), '畳んでいるのに説明が見えている');
            det.open = true;
            assert(box.checkVisibility(), '開いても説明が出ない');
        } finally {
            det.open = false;
            if (wasHidden) modal.classList.add('hidden');
        }

        // 3モードすべてで畳まれている（この箱はモードに関わらず同じ1枚）
        for (const m of ['puzzle', 'learn', 'free']) {
            g.setMode(m);
            assert(!det.open, `${m} で操作説明が開いている`);
        }
        g.setMode('free');
    });

    test('EP3: 🧊立体で見る・📚異性体を調べる がパズルでも使える（A-8・D4）', async (c) => {
        c.reset();
        const D = c.D, g = c.game;
        // 置き場所は **分子モーダル**（DESIGN_molecule_modal.md 第1段で #compound-info から移した）。
        // A-8 のねらい（モードの壁で調べる道具が使えない状態を無くす）は、モーダルが
        // モードに縛られないことで**そのまま保たれる**
        ['btn-isomers', 'btn-stereo'].forEach(id => {
            assert(D.getElementById('molecule-modal').contains(D.getElementById(id)),
                `${id} が #molecule-modal の外にある（分子モーダルへの集約が戻っている）`);
        });

        // パズルで組んだ分子を、モードを移らずにその場で調べられる（診断 D4）
        g.setMode('puzzle');
        const input = D.getElementById('summon-input');
        input.value = '乳酸';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        g.openMoleculeModal();
        assert(!D.getElementById('molecule-modal').classList.contains('hidden'),
            'パズルで分子モーダルが開かない');
        assert(D.getElementById('btn-stereo').offsetParent !== null, 'パズルで 🧊立体で見る が出ない');
        assert(D.getElementById('btn-isomers').offsetParent !== null, 'パズルで 📚異性体を調べる が出ない');
        D.getElementById('btn-stereo').click();
        assert(!D.getElementById('stereo-modal').classList.contains('hidden'),
            'パズルで立体ビューが開かない');
        D.getElementById('btn-stereo-close').click();

        // 判定は A-8 で一切変わらない（同じ分子・同じお題で今までどおり通る）
        const idx = c.W.STAGES.findIndex(s => s.name === '乳酸');
        if (idx >= 0) {
            g.loadStage(idx);
            const t = g.createTargetFromData(c.W.STAGES[idx]);
            assert(c.W.verifyMolecule(t, t), '調べる道具を移したら判定が壊れた');
        }
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        g.setMode('free');
    });

    test('EP4: 学習タブのクイズが3群に整理され、沈んでいた出題に入口がある（A-7・D3）', async (c) => {
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        g.setMode('learn');
        const acc = D.getElementById('learn-acc-quiz');
        // ⚠ demos-stereo.json（V15）が `#learn-acc-quiz>summary` で開く。群に割っても消さない
        assert(acc && acc.querySelector('summary'), '#learn-acc-quiz とその summary が消えている（V15 が壊れる）');
        const groups = [...acc.querySelectorAll('.quiz-group')];
        assert(groups.length === 3, `クイズの群が3つでない（${groups.length}）`);
        ['見比べる', '並べ替える', '数える'].forEach((name, i) => {
            assert(groups[i].querySelector('.quiz-group-head').textContent.includes(name),
                `${i + 1}群の見出しが「${name}」でない`);
        });
        // 元の8ボタンは1つも欠けず、すべてどれかの群に入っている（id 据え置き＝台本と既存テストが無傷）
        ['btn-quiz', 'btn-naming', 'btn-stereo-quiz', 'btn-choice-quiz', 'btn-count-quiz',
         'btn-fischer-practice', 'btn-time-attack', 'btn-symbol-puzzle'].forEach(id => {
            const el = D.getElementById(id);
            assert(el && el.closest('.quiz-group'), `${id} が群に入っていない`);
        });
        // 順路: 🔤 記号でパズル → ⏱ 立体タイムアタック（設計書 §2-6。項目24-3 の統合先の訂正）
        const g2 = groups[1];
        const order = [...g2.querySelectorAll('button')].map(b => b.id);
        assert(order.indexOf('btn-symbol-puzzle') < order.indexOf('btn-time-attack'),
            '②群で 🔤記号でパズル が ⏱タイムアタック より後ろにある（順路が逆）');
        assert([...g2.querySelectorAll('.quiz-flow')].length >= 1, '②群に順路の矢印が無い');

        // 沈んでいた出題（§2-5）に入口ができ、**指定どおりの出題で始まる**。
        // v441 の setForced と同じく、生成の狙いではなく**実際に出た問題**で確かめる
        acc.open = true;
        const cases = [
            { btn: 'btn-choice-quiz-dl', modal: 'choice-quiz-modal', close: 'btn-pk-close',
              check: () => W.choiceQuiz.current && W.choiceQuiz.current.kind === 'dl' },
            { btn: 'btn-choice-quiz-pair', modal: 'choice-quiz-modal', close: 'btn-pk-close',
              check: () => W.choiceQuiz.current && W.choiceQuiz.current.kind === 'pair' },
            { btn: 'btn-time-attack-advanced', modal: 'time-attack-modal', close: 'btn-ta-close',
              check: () => D.getElementById('ta-mode').value === 'advanced' &&
                           W.timeAttack.current && W.timeAttack.current.entry.centers >= 2 &&
                           /【上級】/.test(D.getElementById('ta-task').textContent) }
        ];
        for (const t of cases) {
            const b = D.getElementById(t.btn);
            assert(b && b.closest('.quiz-group'), `${t.btn} が群の中に無い`);
            b.click();
            assert(!D.getElementById(t.modal).classList.contains('hidden'),
                `${t.btn} でモーダルが開かない`);
            assert(t.check(), `${t.btn} が指定どおりの出題で始まっていない`);
            D.getElementById(t.close).click();
        }
        // 近道を使ったあとも、本体のボタンは選ばれている値で今までどおり開く
        D.getElementById('btn-choice-quiz').click();
        assert(!D.getElementById('choice-quiz-modal').classList.contains('hidden'),
            '本体の 🎯同じ立体はどれ？ が開かなくなった');
        D.getElementById('btn-pk-close').click();
        D.getElementById('pk-kind').value = 'symbol';
        D.getElementById('ta-mode').value = '1';
        acc.open = false;
        g.setMode('free');
    });

    test('EP5: 深いリンク ?open= が機能名どおりの画面に着地する（A-6・D3）', async (c) => {
        // **本物の URL で確かめる**（applyOpenParam を直に呼ぶだけでは、起動時に踏まれることも、
        // 前回のモードの復元より後であることも担保できない）。使い捨ての iframe を立てる
        const openApp = async (query) => {
            const f = document.createElement('iframe');
            f.style.cssText = 'position:absolute; left:-9999px; width:1000px; height:800px;';
            f.src = `index.html${query}`;
            document.body.appendChild(f);
            try {
                for (let i = 0; i < 300; i++) {
                    if (f.contentWindow && f.contentWindow.appReady) break;
                    await new Promise(r => setTimeout(r, 100));
                }
                assert(f.contentWindow && f.contentWindow.appReady, `${query} でアプリが起動しない`);
                await new Promise(r => setTimeout(r, 60)); // 開いた直後の描画を待つ
                return { W: f.contentWindow, D: f.contentDocument, kill: () => f.remove() };
            } catch (e) { f.remove(); throw e; }
        };
        const shown = (D, id) => !D.getElementById(id).classList.contains('hidden');

        // ハブが約束している行き先（機能名まで書いてあるのに全部トップに着地していた・§2-9）
        let a = await openApp('?open=naming');
        try {
            assert(a.W.game.currentMode === 'learn', '?open=naming で学習モードにならない');
            assert(a.D.getElementById('learn-acc-quiz').open, '?open=naming でクイズの箱が開かない');
            assert(shown(a.D, 'naming-modal'), '?open=naming で命名クイズが開かない');
        } finally { a.kill(); }

        a = await openApp('?open=mechanism');
        try {
            assert(a.W.game.currentMode === 'learn', '?open=mechanism で学習モードにならない');
            assert(a.D.getElementById('reaction-box').open, '?open=mechanism で反応機構ビューアが開かない');
        } finally { a.kill(); }

        // シリーズの指定（部分一致）。ハブの単元行と1対1に対応させるために要る
        a = await openApp('?open=puzzle&series=' + encodeURIComponent('ベンゼンとその同族体'));
        try {
            assert(a.W.game.currentMode === 'puzzle', '?open=puzzle でパズルモードにならない');
            assert(a.D.getElementById('select-series').value === 'ベンゼンとその同族体',
                'シリーズの指定が効いていない');
            assert(a.W.STAGES[+a.D.getElementById('select-stage').value].series === 'ベンゼンとその同族体',
                '問題の一覧が指定したシリーズに切り替わっていない');
        } finally { a.kill(); }

        // 分子を添えて調べる（open=stereo はキャンバスが空だと調べようがない）
        a = await openApp('?open=stereo&summon=' + encodeURIComponent('乳酸'));
        try {
            assert(a.W.game.userMolecule.atoms.length > 0, '?summon= で分子が出ない');
            assert(shown(a.D, 'stereo-modal'), '?open=stereo で立体ビューが開かない');
        } finally { a.kill(); }

        // ⚠ 収録の1手目を汚さない: ?rec= が付いていたら ?open= は無視する
        // （実在する台本を指すと本当に再生が始まってしまうので、id は存在しないものにする）
        a = await openApp('?open=naming&rec=__no_such_demo__');
        try {
            assert(!shown(a.D, 'naming-modal'), '?rec= があるのに ?open= が踏まれている（収録が1手ずれる）');
        } finally { a.kill(); }

        // 知らない名前・指定なしは今までどおり（前回のモードの復元だけが効く）
        a = await openApp('?open=' + encodeURIComponent('そんな画面はない'));
        try {
            assert(['puzzle', 'learn', 'free'].includes(a.W.game.currentMode),
                '知らない ?open= でモードが壊れた');
            assert([...a.D.querySelectorAll('.modal-overlay')].every(m => m.classList.contains('hidden')),
                '知らない ?open= で何かが開いた');
        } finally { a.kill(); }
    });

    test('N3: ?rec=live はクリーン画面のまま手動操作を受け付け、波紋が出る', async (c) => {
        // ライブ収録支援（rec.js・2026-08-04）。台本再生と違い完了シグナルが無いので、
        // 「playing のまま・操作ボタンが戻っている・pointerdown で波紋」を本物の URL で確かめる
        const f = document.createElement('iframe');
        f.style.cssText = 'position:absolute; left:-9999px; width:1000px; height:800px;';
        f.src = 'index.html?rec=live&se=0';
        document.body.appendChild(f);
        try {
            for (let i = 0; i < 300; i++) {
                if (f.contentWindow && f.contentWindow.appReady && f.contentWindow.__recState === 'playing') break;
                await new Promise(r => setTimeout(r, 100));
            }
            const W = f.contentWindow, D = f.contentDocument;
            assert(W && W.appReady, '?rec=live でアプリが起動しない');
            assert(W.__recState === 'playing', 'live モードが playing にならない（' + W.__recState + '）');
            assert(D.documentElement.classList.contains('recording') &&
                D.documentElement.classList.contains('rec-live'), 'live のクリーン画面クラスが立っていない');
            // 手動操作に要るボタンは隠さない（.recording は隠す・.rec-live が戻す）
            assert(W.getComputedStyle(D.getElementById('btn-clear-all')).display !== 'none',
                'live で全消去が隠れている（手で消せない）');
            // 台本再生は始まっていない（キャンバスは空のまま）
            assert(W.game.userMolecule.atoms.length === 0, 'live なのに何かが再生された');
            // pointerdown で波紋が1つ出て、勝手に消える
            D.body.dispatchEvent(new W.PointerEvent('pointerdown', { clientX: 500, clientY: 400, bubbles: true }));
            assert(D.querySelector('.rec-ripple'), 'タップ波紋が出ない');
            await new Promise(r => setTimeout(r, 700));
            assert(!D.querySelector('.rec-ripple'), 'タップ波紋が消えない（映像にゴミが残る）');
        } finally { f.remove(); }
    });

    test('EP6: ハブの単元リンクが chem 側の受け口とシリーズ名に一致する（A-6）', async (c) => {
        // ハブ（ルート index.html）は別ファイルなので、**リンク先の名前が実在するか**を
        // ここで突き合わせる。綴りを1文字変えただけで黙ってトップに着地する事故を止める
        const res = await fetch('../index.html', { cache: 'no-cache' });
        assert(res.ok, 'ハブ（ルート index.html）が読めない');
        const hub = new DOMParser().parseFromString(await res.text(), 'text/html');
        const links = [...hub.querySelectorAll('a[href*="/assembler/"]')];
        assert(links.length >= 7, `ハブの assembler へのリンクが減っている（${links.length}本）`);

        const deep = links.filter(a => a.href.includes('?'));
        assert(deep.length >= 6, `深いリンクになっている単元行が少ない（${deep.length}本）`);
        const knownSeries = new Set(c.W.STAGES.map(s => s.series));
        deep.forEach(a => {
            const q = new URLSearchParams(a.href.split('?')[1]);
            const name = q.get('open');
            assert(c.W.OPEN_TARGETS && name in c.W.OPEN_TARGETS,
                `ハブが知らない ?open=${name} を指している`);
            const series = q.get('series');
            if (series) {
                assert([...knownSeries].some(s => s.includes(series)),
                    `ハブの ?series=${series} に当たるシリーズがステージデータに無い`);
            }
        });
    });

    /* ===== 分子モーダル（DESIGN_molecule_modal.md 第1段） =====
       「この分子について」をまとめて開く面。入口は**キャンバスの見出し**のタップ（同書 §10-1）。
       第1段で入るのは 🔬 調べる（📚 異性体・🧊 立体）だけで、⚗ 反応と試薬は第2段以降。 */

    // キャンバスの見出し（チップ）の要素を取り出す。見出しは分子ごとに1つ
    const moleculeLabels = (D) => [...D.querySelectorAll('#atoms-group g')]
        .filter(g => g.querySelector('text') && /🔍/.test(g.textContent));

    test('MM1: キャンバスの見出しが分子モーダルの入口（1分子でも出る・パズルでも開く）', async (c) => {
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        g.setMode('free');
        const input = D.getElementById('summon-input');
        input.value = '乳酸';
        input.dispatchEvent(new W.Event('change', { bubbles: true }));
        await c.tick(30);

        // (1) **1分子でも見出しが出る**（同書 §10-2 の宿題への回答。出ないと入口が消える）
        let labels = moleculeLabels(D);
        assert(labels.length === 1, `1分子のとき見出しが ${labels.length} 個（1個であるべき）`);
        assert(/乳酸/.test(labels[0].textContent), `見出しに名前が出ない（${labels[0].textContent}）`);

        // (2) 押せる大きさ ＝ 画面上で 32px を割らない。SVG の中身は viewBox の縮尺で
        //     伸び縮みするので、**単位ではなく画面px で測る**（320px で 19px になっていた）
        const chip = labels[0].querySelector('rect');
        assert(chip, '見出しに当たり判定の枠が無い（ただの文字に戻っている）');
        const r = chip.getBoundingClientRect();
        assert(r.height >= 32, `見出しの的が ${Math.round(r.height)}px（32px 未満）`);

        // (3) **1マス下の格子点を覆っていない**（見出しを当たり判定にすると、そこに原子が
        //     置けなくなる。game.js に残っていた制約。半マス下げて避けている）
        const heavy = g.userMolecule.atoms.filter(a => a.element !== 'H');
        const gridY = Math.max(...heavy.map(a => a.y)) + W.GRID_SIZE;
        const top = +chip.getAttribute('y');
        assert(top > gridY, `見出しの枠（y=${Math.round(top)}）が1マス下の格子点（y=${gridY}）を覆っている`);

        // (4) タップで開く。開いた先は「その分子」
        labels[0].dispatchEvent(c.pe('pointerdown', c.toClient(0, 0)));
        const modal = D.getElementById('molecule-modal');
        assert(!modal.classList.contains('hidden'), 'キャンバスの見出しをタップしてもモーダルが開かない');
        assert(D.getElementById('mm-name').textContent.includes('乳酸'),
            `モーダルの見出しが乳酸でない（${D.getElementById('mm-name').textContent}）`);
        assert(D.getElementById('mm-formula').textContent === 'C₃H₆O₃',
            `分子式が違う（${D.getElementById('mm-formula').textContent}）`);
        // 調べる道具はこの中にある（EP3 と同じ契約。ここでは開いた状態で見えることを見る）
        ['btn-isomers', 'btn-stereo'].forEach(id => {
            const b = D.getElementById(id);
            assert(modal.contains(b), `${id} がモーダルの外にある`);
            assert(b.getBoundingClientRect().height >= 32,
                `${id} が ${Math.round(b.getBoundingClientRect().height)}px（32px 未満）`);
        });
        D.getElementById('btn-molecule-modal-close').click();
        assert(modal.classList.contains('hidden'), '閉じるボタンで閉じない');

        // (5) パズルでも同じ見出しから開ける（A-8 のねらいを引き継ぐ）
        g.setMode('puzzle');
        g.updateDrawing();
        labels = moleculeLabels(D);
        assert(labels.length === 1, 'パズルで見出しが出ない');
        labels[0].dispatchEvent(c.pe('pointerdown', c.toClient(0, 0)));
        assert(!modal.classList.contains('hidden'), 'パズルで見出しからモーダルが開かない');
        D.getElementById('btn-molecule-modal-close').click();

        // (6) 学習モードでは出さない（#compound-info・#mobile-name-chip と同じ扱い。
        //     書き出し練習の答えになるため）
        g.setMode('learn');
        g.updateDrawing();
        assert(moleculeLabels(D).length === 0, '学習モードで分子名の見出しが出ている（練習の答えになる）');

        // (7) タップに別の意味があるモード中は、見出しをただの文字に戻す
        g.setMode('free');
        g.reactionSelectMode = true;
        g.updateDrawing();
        const marked = moleculeLabels(D)[0];
        assert(marked && marked.querySelector('rect').getAttribute('pointer-events') === 'none',
            '分子を選ぶモード中も見出しが当たり判定を持っている（選択のタップを奪う）');
        g.reactionSelectMode = false;
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
        g.setMode('free');
    });

    test('MM1b: 琥珀の枠は自分で選ぶまで出ない（C-9・答えを指してしまう不具合）', async (c) => {
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        g.setMode('free');
        // 「◯◯はどれ？」と問う場面と同じ状況＝分子を2つ並べただけ（まだ何も選んでいない）
        ['マレイン酸', 'フマル酸'].forEach(n => {
            const input = D.getElementById('summon-input');
            input.value = n;
            input.dispatchEvent(new W.Event('change', { bubbles: true }));
        });
        assert(g.countMolecules() === 2, `2分子になっていない（${g.countMolecules()}）`);

        const framed = () => [...D.querySelectorAll('#chem-svg text')].some(t => t.textContent.includes('⚗'));
        const info0 = g.focusedMoleculeInfo(null);
        assert(info0 && info0.explicit === false, '選んでいないのに explicit が立っている');
        assert(!framed(), '誰も選んでいないのに「⚗ 分析中」の枠が出ている（答えを指してしまう）');
        // 右パネルの分類は従来どおり①を説明してよい（レビュー項目9）。**枠だけを止める**
        assert(info0.mark === '①', '既定の説明対象が①でなくなった');

        // 自分で選んだら出る
        const first = g.userMolecule.atoms.find(a => a.element !== 'H');
        g.setFocusedMolecule(first.id);
        assert(g.focusedMoleculeInfo(null).explicit === true, '選んだのに explicit が立たない');
        assert(framed(), '自分で選んでも枠が出ない');

        g.focusedMolecule = null;
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('MM2: 見出しで②を選ぶと、②の分子式で異性体が出る（調べる道具が分子を選べる）', async (c) => {
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        g.setMode('free');
        const input = D.getElementById('summon-input');
        // ① 酢酸（C₂H₄O₂）＋ ② エタノール（C₂H₆O）。**元は「分子が複数あります」で門前払いだった**
        ['酢酸', 'エタノール'].forEach(n => {
            input.value = n;
            input.dispatchEvent(new W.Event('change', { bubbles: true }));
        });
        assert(g.countMolecules() === 2, `2分子になっていない（${g.countMolecules()}）`);

        g.openMoleculeModal();
        const tabs = [...D.querySelectorAll('#mm-tabs button')];
        assert(tabs.length === 2, `見出しのタブが ${tabs.length} 個（2個を期待）`);
        assert(/②/.test(tabs[1].textContent) && /エタノール/.test(tabs[1].textContent),
            `②のタブがエタノールでない（${tabs[1].textContent}）`);

        // ②へ切り替える ＝ 分析対象も②になる（図の琥珀の枠と同じ分子を指す）
        tabs[1].click();
        assert(D.getElementById('mm-formula').textContent === 'C₂H₆O',
            `②に切り替えても分子式が変わらない（${D.getElementById('mm-formula').textContent}）`);
        assert(g.focusedMoleculeInfo(null).mark === '②', '分析対象が②になっていない');

        // ここで 📚 を押すと **②の分子式**で列挙される（キャンバス全体の C₄H₁₀O₃ ではない）
        D.getElementById('btn-isomers').click();
        assert(!D.getElementById('learn-modal').classList.contains('hidden'),
            '2分子あると異性体が開かない（門前払いが残っている）');
        assert(D.getElementById('learn-title').textContent.includes('C₂H₆O'),
            `②の分子式で列挙されていない（${D.getElementById('learn-title').textContent}）`);
        await c.tick(60);
        const body = D.getElementById('learn-body').textContent;
        assert(/エタノール/.test(body), `列挙の中身に②の分子が出ない（${body.slice(0, 80)}）`);
        D.getElementById('btn-learn-close').click();

        // 🧊 立体も同じ分子を見る（「分子全体」タブが②だけを組む）
        g.openMoleculeModal();
        D.getElementById('btn-stereo').click();
        const sv = W.stereoView;
        assert(sv._scope && sv._scope.atoms.filter(a => a.element !== 'H').length === 3,
            '立体ビューが②（重原子3個）以外を見ている');
        D.getElementById('btn-stereo-close').click();

        // ①へ戻すと元の分子式に戻る（切り替えが一方通行になっていない）
        g.openMoleculeModal();
        [...D.querySelectorAll('#mm-tabs button')][0].click();
        assert(D.getElementById('mm-formula').textContent === 'C₂H₄O₂',
            `①に戻せない（${D.getElementById('mm-formula').textContent}）`);
        D.getElementById('btn-molecule-modal-close').click();
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('MM3: モーダルから 🧊立体 を開くと分子モーダルは閉じている（重ねない）', async (c) => {
        c.reset();
        const D = c.D, g = c.game;
        g.setMode('free');
        const input = D.getElementById('summon-input');
        input.value = '乳酸';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        g.openMoleculeModal();
        assert(!D.getElementById('molecule-modal').classList.contains('hidden'), '分子モーダルが開かない');
        D.getElementById('btn-stereo').click();
        // 14枚すべて z-index:1000 なので、重ねると ✕ が2つ並び、後ろの方が上に来る（§5-5）
        assert(D.getElementById('molecule-modal').classList.contains('hidden'),
            '🧊立体を開いても分子モーダルが開いたまま（モーダルが2枚重なる）');
        assert(!D.getElementById('stereo-modal').classList.contains('hidden'), '立体ビューが開かない');
        D.getElementById('btn-stereo-close').click();
        g.userMolecule = new c.W.Molecule();
        g.updateDrawing();
    });

    test('MM4: #molecule-modal は #stereo-modal より DOM で前にある（z の後勝ちを構造で防ぐ）', async (c) => {
        const D = c.D;
        const mm = D.getElementById('molecule-modal');
        const sm = D.getElementById('stereo-modal');
        const lm = D.getElementById('learn-modal');
        assert(mm && sm && lm, 'モーダルのどれかが無い');
        // Node.DOCUMENT_POSITION_FOLLOWING = 4
        assert(mm.compareDocumentPosition(sm) & 4,
            '#molecule-modal が #stereo-modal より後ろにある（開いた立体が分子モーダルの裏に回る）');
        assert(mm.compareDocumentPosition(lm) & 4,
            '#molecule-modal が #learn-modal より後ろにある');
    });

    test('MM5: ⚗ 反応はモーダルの中にあり、押すと閉じてキャンバスへ返す（第2段）', async (c) => {
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        g.setMode('free');
        const modal = D.getElementById('molecule-modal');

        // (1) 移設の確認。4つとも id は据え置きのまま **場所だけ**が変わる（不変条件）
        ['molecule-props', 'btn-reaction-select', 'reaction-selection', 'reaction-actions'].forEach(id => {
            const el = D.getElementById(id);
            assert(el, `${id} が消えている（id は変えない・消さないが不変条件）`);
            assert(modal.contains(el), `${id} が #molecule-modal の外にある（第2段の移設が戻っている）`);
        });
        // 帯（🧪 標準の面）に残るのは件数を出す1ボタンだけ（§4-1。第5段で右パネルから移設）
        const inspect = D.getElementById('btn-molecule-modal');
        assert(inspect && D.getElementById('reaction-card').contains(inspect),
            '「🔬 この分子を調べる」が「⚗ この分子の反応」カードに無い');

        // (2) トルエンのニトロ化は**箇所の選択**（o/m/p）に入る反応。
        //     箇所選択のハイライトも、そのあとのモーフィングも**キャンバスの上**で起きるので、
        //     全画面のモーダルが乗ったままでは1つも見えない（§2-5）
        const input = D.getElementById('summon-input');
        input.value = 'トルエン';
        input.dispatchEvent(new W.Event('change', { bubbles: true }));
        inspect.click();
        assert(!modal.classList.contains('hidden'), '作業帯のボタンでモーダルが開かない');
        const btn = [...D.querySelectorAll('#reaction-actions button')]
            .find(b => b.textContent.includes('ニトロ化'));
        assert(btn, `モーダルの中にニトロ化のボタンが出ない（${
            [...D.querySelectorAll('#reaction-actions button')].map(b => b.textContent).join(' / ')}）`);
        btn.click();
        assert(modal.classList.contains('hidden'),
            '反応ボタンを押してもモーダルが開いたまま（箇所の選択もモーフィングも見えない）');
        assert(W.reactor.picking, '箇所の選択（picking）がキャンバスで始まっていない');
        // 実際に箇所を選んで最後まで通す（ここから先は入口に関係なく従来どおり）
        const site = W.reactor.picking.sites[0];
        const target = g.userMolecule.atoms.find(a => site.includes(a.id));
        c.clickAt(target.x, target.y);
        assert(!W.reactor.picking, '箇所を選んでも選択モードが解けない');
        assert(g.userMolecule.atoms.some(a => a.element === 'N'), 'ニトロ化が実行されていない');

        // (3) 🎯 反応させる分子を選ぶ も同じ（選ぶ相手はキャンバスにいる）
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        input.value = 'エタノール';
        input.dispatchEvent(new W.Event('change', { bubbles: true }));
        inspect.click();
        D.getElementById('btn-reaction-select').click();
        assert(modal.classList.contains('hidden'),
            '「🎯 反応させる分子を選ぶ」でモーダルが閉じない（選ぶ相手が見えない）');
        assert(g.reactionSelectMode, '選択モードに入っていない');
        D.getElementById('btn-reaction-select').click(); // 後片付け
        g.reactionSelectMode = false;
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('MM6: 入口が増えても中身は1つ（モーダル経由でも直接でも同じ正準コード）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const CC = W.canonicalCode;
        // エタノールを酸化してアセトアルデヒドにする道を2通りで通し、結果を突き合わせる。
        // `execute` から先は1行も触っていないことを、入口の数だけ確かめる
        //（DESIGN_reagent_palette.md RG4 と同じ考え方）
        const oxidize = (viaModal) => {
            c.reset();
            g.setMode('free');
            const input = D.getElementById('summon-input');
            input.value = 'エタノール';
            input.dispatchEvent(new W.Event('change', { bubbles: true }));
            if (viaModal) D.getElementById('btn-molecule-modal').click();
            const btn = [...D.querySelectorAll('#reaction-actions button')]
                .find(b => b.textContent.includes('アルデヒド'));
            assert(btn, `酸化のボタンが出ない（viaModal=${viaModal}）`);
            btn.click();
            assert(!W.reactor.picking, '1箇所しかない反応で箇所選択に入っている');
            return CC(g.userMolecule);
        };
        const direct = oxidize(false);
        const viaModal = oxidize(true);
        assert(direct === viaModal,
            `モーダル経由と直接で生成物が違う（${direct} / ${viaModal}）`);
        assert(D.getElementById('molecule-modal').classList.contains('hidden'),
            'モーダル経由の実行後にモーダルが残っている');
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    test('MM7: 反応ボタンの床（32px）と、右パネルに残した件数のライブ更新（§4-2・§6-2）', async (c) => {
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        g.setMode('free');
        const inspect = D.getElementById('btn-molecule-modal');
        const input = D.getElementById('summon-input');

        // (1) 何も無いときは「反応 —」（0件を数字で書かない）
        assert(/反応 —/.test(inspect.textContent),
            `空のキャンバスで件数が「—」でない（${inspect.textContent}）`);

        // (2) **「-OH を付けた瞬間に酸化ボタンが生える」気づきを件数の変化として残す**（§4-2）。
        //     メタン → エタノール で、ラベルの数字が増える。ラベルは常に実数と一致する
        const label = () => {
            const n = W.reactor.executableCount;
            assert(inspect.textContent.includes(n > 0 ? `反応 ${n}件` : '反応 —'),
                `件数がライブ更新されていない（${inspect.textContent} / 実際は ${n}件）`);
            return n;
        };
        input.value = 'メタン';
        input.dispatchEvent(new W.Event('change', { bubbles: true }));
        const n0 = label();
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        input.value = 'エタノール';
        input.dispatchEvent(new W.Event('change', { bubbles: true }));
        const n = label();
        assert(n > n0, `-OH が付いても件数が増えない（メタン ${n0}件 → エタノール ${n}件）`);

        // (3) 32px の床。`#reaction-card .view-btn` の指定は移設で外れるので、
        //     場所に依らない指定で敷き直してある（v523 と同じ轍を踏まない）
        inspect.click();
        const targets = [D.getElementById('btn-reaction-select'), inspect,
            ...D.querySelectorAll('#reaction-actions button')];
        targets.forEach(b => {
            const h = b.getBoundingClientRect().height;
            assert(h >= 32, `押しものが ${Math.round(h)}px（32px 未満）: ${b.textContent.slice(0, 20)}`);
        });
        D.getElementById('btn-molecule-modal-close').click();

        // (4) パズルでは ⚗ 反応の節を出さない（お題の判定中に分子を書き換えられては困る）
        g.setMode('puzzle');
        g.openMoleculeModal();
        assert(D.getElementById('mm-reaction').style.display === 'none',
            'パズルモードでもモーダルに ⚗ 反応が出ている');
        D.getElementById('btn-molecule-modal-close').click();
        g.setMode('free');
        g.openMoleculeModal();
        assert(D.getElementById('mm-reaction').style.display !== 'none',
            '自由モードで ⚗ 反応が出ない');
        D.getElementById('btn-molecule-modal-close').click();
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
    });

    /* ===== 試薬パレット 第1段（DESIGN_reagent_palette.md §5 第1段・瓶3本） =====
       置き場所は分子モーダルの「⚗ 反応」節の中（DESIGN_molecule_modal.md §6-1）。
       固定したいのは**「入口が2つでも中身は1つ」**（RG4）と、**空振りが履歴を汚さない**（RG3）の2つ。
       瓶は新しい化学も新しい実行経路も持たないので、ここが守られているかぎり
       瓶を増やしても既存の反応の挙動は変わらない。 */

    // モーダルを開いて、名前のついた分子を並べた状態にする（試薬テスト共通の下ごしらえ）
    function setupReagent(c, names) {
        const g = c.game;
        c.reset();
        g.setMode('free');
        g.userMolecule = new c.W.Molecule();
        names.forEach(n => g.summonMolecule(n));
        g.updateDrawing();
        g.openMoleculeModal();
        return g.userMolecule;
    }
    const bottle = (c, id) => c.D.querySelector(`#mm-reagents-grid [data-reagent="${id}"]`);
    const noteButtons = (c) => [...c.D.querySelectorAll('#mm-reagent-note button')];

    test('RG1: reagentId が REAGENTS に実在し・瓶の id は重複せず・死んだ瓶が無い（第3段）', async (c) => {
        const W = c.W;
        const REAGENTS = W.REAGENTS, RULES = W.REACTION_RULES, TESTS = W.DETECTION_TESTS;
        assert(Array.isArray(REAGENTS) && REAGENTS.length === 18,
            `REAGENTS が ${REAGENTS ? REAGENTS.length : 'なし'} 本（変えるもの13本＋調べるもの5本＝18本）`);
        assert(Array.isArray(TESTS) && TESTS.length === 5,
            `DETECTION_TESTS が ${TESTS ? TESTS.length : 'なし'} 件（第3段は5件）`);
        // (1) id の重複が無い（RX3 の mechanismId 検査と同じ機械検証）
        const ids = REAGENTS.map(r => r.id);
        assert(new Set(ids).size === ids.length, `REAGENTS の id が重複している: ${ids.join(', ')}`);
        // (2) 瓶の札に要るものが全部ある（欠けると空文字のボタンが並ぶ）
        REAGENTS.forEach(r => {
            ['id', 'name', 'formula', 'kind', 'acts'].forEach(k =>
                assert(r[k], `瓶 ${r.id || '(id無し)'} に ${k} が無い`));
        });
        // (3) ルール側・検出側の reagentId が実在する（死にリンク）
        const dead = [...RULES, ...TESTS].filter(r => r.reagentId && !ids.includes(r.reagentId));
        assert(dead.length === 0,
            `REAGENTS に無い reagentId: ${dead.map(r => `${r.id}→${r.reagentId}`).join(', ')}`);
        // (4) 逆向き。**押しても何にも繋がらない瓶**があってはいけない
        const used = new Set([...RULES, ...TESTS].map(r => r.reagentId).filter(Boolean));
        const orphan = ids.filter(id => !used.has(id));
        assert(orphan.length === 0, `どのルールにも検出にも使われていない瓶: ${orphan.join(', ')}`);
        // (4b) 変えるものと調べるものは**排他**。同じ瓶が両方に載ると
        //      「押すと反応が進むこともあるし進まないこともある」になる
        const byRule = new Set(RULES.map(r => r.reagentId).filter(Boolean));
        const byTest = new Set(TESTS.map(t => t.reagentId));
        const both = [...byRule].filter(id => byTest.has(id));
        assert(both.length === 0, `反応ルールと検出の両方に使われている瓶: ${both.join(', ')}`);
        REAGENTS.forEach(r => assert(r.kind === 'detect' ? byTest.has(r.id) : byRule.has(r.id),
            `瓶 ${r.id} の kind（${r.kind}）と実際の繋ぎ先が食い違っている`));
        // (5) 第2段で紐づくのは 22 件ちょうど（増減したら気づけるように数と顔ぶれを固定する）
        const linked = RULES.filter(r => r.reagentId).map(r => r.id).sort();
        const expected = [
            'add_br2', 'add_h2', 'add_hbr', 'add_water',
            'acetylation_anhydride', 'aromatic_deactivated_info', 'aromatic_halogenation',
            'aromatic_nitration', 'aromatic_sulfonation',
            'dehydration_inter', 'dehydration_intra',
            'esterification', 'esterification_phenol_info',
            'hydrolysis_anhydride', 'hydrolysis_ester', 'iodoform',
            'oxidize_aldehyde', 'oxidize_primary', 'oxidize_secondary', 'oxidize_tertiary_info',
            'saponification', 'vulcanization'].sort();
        assert(linked.length === 22, `瓶に紐づくルールが ${linked.length} 件（22件を期待）`);
        assert(linked.join(',') === expected.join(','),
            `瓶に紐づくルールが設計と違う\n  いま: ${linked.join(', ')}\n  設計: ${expected.join(', ')}`);
        // (6) condition を持つのは「温度でしか割れない」2件だけ（§2.4）
        const cond = RULES.filter(r => r.condition).map(r => r.id).sort();
        assert(cond.join(',') === 'dehydration_inter,dehydration_intra',
            `condition を持つルールが2件でない: ${cond.join(', ')}`);
        // (7) 瓶の札が18本とも描かれている（区分の見出しは札に数えない）
        const drawn = [...c.D.querySelectorAll('#mm-reagents-grid .rg-bottle')];
        assert(drawn.length === 18, `瓶の札が ${drawn.length} 個（18個を期待）`);
        assert(REAGENTS.filter(r => r.kind === 'transform').length === 13 &&
            REAGENTS.filter(r => r.kind === 'detect').length === 5,
            '瓶の区分の内訳が「変えるもの13本・調べるもの5本」でない');
        ids.forEach(id => assert(bottle(c, id), `瓶 ${id} の札が描かれていない`));
        // (8) kind は2値だけ。区分の見出しが kind ごとに1つ出ている（§3.2 の「変えるもの／調べるもの」）
        REAGENTS.forEach(r => assert(['transform', 'detect'].includes(r.kind),
            `瓶 ${r.id} の kind が ${r.kind}（transform / detect のどちらかであること）`));
        const kinds = [...new Set(REAGENTS.map(r => r.kind))];
        const heads = [...c.D.querySelectorAll('#mm-reagents-grid .rg-group')];
        assert(heads.length === kinds.length,
            `区分の見出しが ${heads.length} 個（kind の種類 ${kinds.length} 個と一致すること）`);
    });

    test('RG2: 濃硫酸は行き先が2つ出て、選んだ温度どおりの生成物になる（§2.4）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const CC = W.canonicalCode;
        // **同じ瓶で行き先が温度でしか割れない唯一の組み合わせ**（設計 §2.4）。
        // エタノール2分子で、160〜170℃ なら分子内脱水（エテン）・130〜140℃ なら
        // 分子間脱水（ジエチルエーテル）。どちらの detect も通るので選択面が出る
        setupReagent(c, ['エタノール', 'エタノール']);
        bottle(c, 'h2so4_conc').click();
        const choices = noteButtons(c).map(b => b.textContent);
        assert(choices.length === 2,
            `濃硫酸の行き先が ${choices.length} 通り（2通りを期待）: ${choices.join(' / ')}`);
        assert(choices.some(t => t.includes('160〜170')) && choices.some(t => t.includes('130〜140')),
            `条件の見出しが温度になっていない: ${choices.join(' / ')}`);
        // 条件を選ぶ前に閉じてしまうと選択肢が見えない（DESIGN_molecule_modal.md §5-3）
        assert(!D.getElementById('molecule-modal').classList.contains('hidden'),
            '条件を選ぶ画面が出たのにモーダルが閉じている');

        // 瓶から／自動案内から、同じ反応を通す。**入口が2つでも中身は1つ**（RG4 の考え方）
        const run = (via) => {
            setupReagent(c, ['エタノール', 'エタノール']);
            if (via.temp) {
                bottle(c, 'h2so4_conc').click();
                const b = noteButtons(c).find(x => x.textContent.includes(via.temp));
                assert(b, `条件 ${via.temp} のボタンが出ない`);
                b.click();
            } else {
                const b = [...D.querySelectorAll('#reaction-actions button')]
                    .find(x => x.textContent.includes(via.label));
                assert(b, `自動案内に「${via.label}」のボタンが出ない`);
                b.click();
            }
            // 分子内脱水は箇所が2つ（分子が2つあるから）。従来どおりキャンバスで選ばせる
            if (W.reactor.picking) {
                const site = W.reactor.picking.sites[0];
                const atom = g.userMolecule.atoms.find(a => site.includes(a.id));
                c.clickAt(atom.x, atom.y);
                assert(!W.reactor.picking, '箇所を選んでも選択モードが解けない');
            }
            return CC(g.userMolecule);
        };
        const mol = () => g.userMolecule;
        const hasAlkene = () => mol().bonds.some(b => b.type === 2 &&
            [b.atomId1, b.atomId2].every(id => (mol().atoms.find(a => a.id === id) || {}).element === 'C'));
        const hasEther = () => mol().atoms.some(a => a.element === 'O' &&
            mol().getNeighbors(a.id).filter(n => n.atom.element === 'C').length === 2);

        const hotBottle = run({ temp: '160〜170' });
        assert(hasAlkene(), '160〜170℃ を選んでも C=C（エテン）ができていない');
        const hotAuto = run({ label: '分子内脱水' });
        assert(hotBottle === hotAuto,
            `160〜170℃ の生成物が入口で違う\n  瓶: ${hotBottle}\n  自動案内: ${hotAuto}`);

        const warmBottle = run({ temp: '130〜140' });
        assert(hasEther(), '130〜140℃ を選んでも C-O-C（ジエチルエーテル）ができていない');
        const warmAuto = run({ label: '分子間脱水' });
        assert(warmBottle === warmAuto,
            `130〜140℃ の生成物が入口で違う\n  瓶: ${warmBottle}\n  自動案内: ${warmAuto}`);

        assert(hotBottle !== warmBottle, '温度を選び分けても生成物が同じ正準コードになっている');
        c.reset();
    });

    test('RG3: 効かない瓶は説明だけを返し、分子も履歴も1つも変えない（§4.3）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const CC = W.canonicalCode;
        // 「エタンに臭素水を入れても脱色しない」＝ **効かないこと自体が教材**（設計 §1.2・§4.2③）
        setupReagent(c, ['エタン']);
        const before = CC(g.userMolecule);
        const beforeAtoms = g.userMolecule.atoms.length;
        const beforeHistory = g.history.length;
        bottle(c, 'br2_water').click();
        assert(CC(g.userMolecule) === before,
            `空振りなのに分子が変わった\n  前: ${before}\n  後: ${CC(g.userMolecule)}`);
        assert(g.userMolecule.atoms.length === beforeAtoms, '空振りなのに原子数が変わった');
        assert(g.history.length === beforeHistory,
            `空振りなのに Undo 履歴が ${beforeHistory} → ${g.history.length} に伸びた`);
        // 叱らずに「効くのはこれ」を返す（§4.2 ②③）
        const note = D.getElementById('mm-reagent-note').textContent;
        assert(note.includes('C=C'), `臭素水の空振りに「効く相手」の説明が無い: ${note.slice(0, 60)}`);
        assert(!/間違い|誤り/.test(note), `空振りの説明が叱っている: ${note.slice(0, 60)}`);

        // 相手の分子を足せば通る失敗は、**呼び出しボタン**で次の一手になる（§4.2 ①）。
        // 酢酸に濃硫酸 ＝ エステル化の相手のアルコールが無い
        setupReagent(c, ['酢酸']);
        bottle(c, 'h2so4_conc').click();
        const hints = noteButtons(c).map(b => b.textContent);
        assert(hints.length > 0 && hints.some(t => t.includes('呼び出す')),
            `相手が足りない失敗で呼び出し案内が出ない: ${
                D.getElementById('mm-reagent-note').textContent.slice(0, 80)}`);
        c.reset();
    });

    test('RG4: 瓶から出せる反応は自動案内の部分集合（入口が2つでも中身は1つ）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const lib = new Set(g.getCompoundLibrary().map(e => e.name));
        const names = ['エタノール', 'エタン', '2-プロパノール', 'アセトアルデヒド',
            'ベンゼン', 'トルエン', '酢酸', 'フェノール', 'エチレングリコール', '2-ブタノール']
            .filter(n => lib.has(n));
        assert(names.length >= 6, `代表分子がライブラリに ${names.length} 件しか無い`);
        names.forEach(name => {
            setupReagent(c, [name]);
            // 自動案内に出ているボタンの見出し（rule.label ＋「（N箇所）」）
            const shown = [...D.querySelectorAll('#reaction-actions button')].map(b => b.textContent);
            W.REAGENTS.forEach(rg => {
                W.reactor.reagentHits(rg).forEach(hit => {
                    assert(shown.some(t => t.startsWith(hit.rule.label)),
                        `${name}: 瓶「${rg.name}」からだけ出せる反応がある（${hit.rule.id}）\n` +
                        `  自動案内: ${shown.join(' / ') || '（なし）'}`);
                });
            });
        });
        // 具体の1本で、**生成物の正準コードまで**一致することを見る（⊆ だけでは中身が同じと言えない）
        const CC = W.canonicalCode;
        assert(lib.has('エチレン（エテン）'), 'ライブラリに「エチレン（エテン）」が無い');
        const addBr2 = (viaBottle) => {
            setupReagent(c, ['エチレン（エテン）']);
            if (viaBottle) bottle(c, 'br2_water').click();
            else {
                const b = [...D.querySelectorAll('#reaction-actions button')]
                    .find(x => x.textContent.includes('Br₂'));
                assert(b, '自動案内に臭素水の付加が出ない');
                b.click();
            }
            assert(!W.reactor.picking, '1箇所しかない反応で箇所選択に入っている');
            return CC(g.userMolecule);
        };
        const viaAuto = addBr2(false);
        const viaBottle = addBr2(true);
        assert(viaAuto === viaBottle,
            `瓶と自動案内で生成物が違う\n  自動案内: ${viaAuto}\n  瓶: ${viaBottle}`);
        c.reset();
    });

    test('MM8: 効かない瓶を押しても分子は1原子も変わらず、モーダルも閉じない（§5-3）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const modal = D.getElementById('molecule-modal');
        // 効く瓶（反応が進む）は閉じる・効かない瓶（説明だけ）は開いたまま。
        // 閉じてしまうと「効きません」の説明が出た瞬間に消える（DESIGN_molecule_modal.md §5-3）
        setupReagent(c, ['エタン']);
        const before = W.canonicalCode(g.userMolecule);
        ['br2_water', 'oxidant', 'h2so4_conc'].forEach(id => {
            bottle(c, id).click();
            assert(!modal.classList.contains('hidden'),
                `効かない瓶「${id}」を押したらモーダルが閉じた（説明が読めない）`);
            assert(W.canonicalCode(g.userMolecule) === before,
                `効かない瓶「${id}」で分子が変わった`);
            assert(D.getElementById('mm-reagent-note').textContent.trim().length > 0,
                `効かない瓶「${id}」を押しても何も返らない（詰まりになる）`);
        });
        // 効く瓶は従来どおり閉じてキャンバスへ返す（箇所選択・モーフィングがそこで起きる）
        setupReagent(c, ['エタノール']);
        bottle(c, 'oxidant').click();
        assert(modal.classList.contains('hidden'),
            '反応が進む瓶を押してもモーダルが開いたまま（モーフィングも前後比較も見えない）');
        assert(g.userMolecule.atoms.some(a => a.element === 'O' &&
            g.userMolecule.getNeighbors(a.id).some(n => n.type === 2)),
            '酸化剤の瓶からアルデヒドができていない');
        c.reset();
    });

    /* ===== 試薬パレット 第2段（DESIGN_reagent_palette.md §5 第2段・変えるもの13本） ===== */

    test('RG5: 瓶を持たない「実行できるルール」は環化3件と重合2件だけ（§5 第2段）', async (c) => {
        const W = c.W;
        const RULES = W.REACTION_RULES;
        // 数え方を関数にして、**同じ数え方を否定対照にも掛ける**（空振りの緑を避ける）
        const unlinked = (rules) => rules.filter(r => !r.info && !r.reagentId).map(r => r.id).sort();
        // 試薬なしで起こるもの ＝ 糖の環化・開環（分子内の平衡）と、
        // 「並べた単量体をまとめる」操作でしかない重合2件（§3.1 の「入れないもの」）
        const expected = ['addition_polymerization', 'cyclize_glucose_alpha', 'cyclize_glucose_beta',
            'diene_polymerization', 'open_glucopyranose'].sort();
        const now = unlinked(RULES);
        assert(now.length === 5, `瓶を持たない実行ルールが ${now.length} 件（5件を期待）: ${now.join(', ')}`);
        assert(now.join(',') === expected.join(','),
            `瓶の割り当て漏れ、または新しい反応に瓶が付いていない\n  いま: ${now.join(', ')}\n  設計: ${expected.join(', ')}`);
        // 解説専用（info）で瓶を持たないのは縮合重合の案内1件だけ
        const infoUnlinked = RULES.filter(r => r.info && !r.reagentId).map(r => r.id).sort();
        assert(infoUnlinked.join(',') === 'condensation_polymer_info',
            `瓶を持たない info ルールが想定外: ${infoUnlinked.join(', ') || '（なし）'}`);
        // **否定対照**: reagentId を1つ外した写しでは、同じ数え方が必ずそれを拾う。
        // 拾えないなら数え方が壊れていて、上の合格は空振りの緑
        const broken = RULES.map(r => (r.id === 'add_br2' ? { ...r, reagentId: undefined } : r));
        assert(unlinked(broken).includes('add_br2'),
            '否定対照が働いていない: reagentId を外しても未割り当てとして数えられない');
    });

    test('RG6: 代表分子で「瓶から出せる反応 ＝ 自動案内のうち瓶を持つ反応」（入口が2つでも中身は1つ）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const lib = new Set(g.getCompoundLibrary().map(e => e.name));
        const names = ['エタノール', '2-プロパノール', 'アセトアルデヒド', '酢酸エチル', 'ベンゼン',
            'トルエン', 'フェノール', 'アニリン', '無水酢酸', 'エチレン（エテン）',
            'アセトン', '2-メチル-2-プロパノール'].filter(n => lib.has(n));
        assert(names.length >= 10, `代表分子がライブラリに ${names.length} 件しか無い（10件以上を期待）`);
        const diff = (a, b) => [...a].filter(x => !b.has(x));
        let totalHits = 0;
        names.forEach(name => {
            setupReagent(c, [name]);
            const shown = [...D.querySelectorAll('#reaction-actions button')].map(b => b.textContent);
            // 自動案内に出ているもののうち、瓶を持つルール
            const auto = new Set(W.REACTION_RULES
                .filter(r => r.reagentId && shown.some(t => t.startsWith(r.label)))
                .map(r => r.id));
            // 瓶から辿り着けるルール
            const viaBottle = new Set();
            W.REAGENTS.forEach(rg => W.reactor.reagentHits(rg).forEach(h => viaBottle.add(h.rule.id)));
            totalHits += viaBottle.size;
            assert(diff(viaBottle, auto).length === 0,
                `${name}: 瓶からだけ出せる反応がある → ${diff(viaBottle, auto).join(', ')}\n` +
                `  自動案内: ${[...auto].join(', ') || '（なし）'}`);
            assert(diff(auto, viaBottle).length === 0,
                `${name}: 自動案内にあるのに瓶から出せない反応がある → ${diff(auto, viaBottle).join(', ')}\n` +
                `  瓶経由: ${[...viaBottle].join(', ') || '（なし）'}`);
        });
        // **空振りの緑を避ける**: そもそも一致を見る材料があったのかを数で主張する
        assert(totalHits >= 12,
            `代表分子ぜんぶで瓶から出せた反応が ${totalHits} 件しかない（12件以上あって初めて一致に意味がある）`);
        // **否定対照**: 片方から1件抜いた集合は、同じ比較で必ず食い違いとして出る
        setupReagent(c, ['エタノール']);
        const real = new Set();
        W.REAGENTS.forEach(rg => W.reactor.reagentHits(rg).forEach(h => real.add(h.rule.id)));
        assert(real.size > 0, 'エタノールで瓶から出せる反応が0件（否定対照の材料が無い）');
        const short = new Set([...real].slice(1));
        assert(diff(real, short).length === 1,
            '否定対照が働いていない: 1件抜いた集合を比べても食い違いが出ない');
        c.reset();
    });

    test('RG10: 新しい6本の瓶で、生成物が自動案内と同じ正準コードになる（RG4 の考え方を第2段へ）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const CC = W.canonicalCode;
        const lib = new Set(g.getCompoundLibrary().map(e => e.name));
        // [瓶, 基質, 自動案内のボタンに出る文字]
        const cases = [
            ['h2so4_dil', '酢酸エチル', '加水分解（エステル'],
            ['naoh_aq', '酢酸エチル', 'けん化'],
            ['mixed_acid', 'ベンゼン', 'ニトロ化'],
            ['acetic_anhydride', 'フェノール', 'アセチル化'],
            ['i2_naoh', 'アセトン', 'ヨードホルム'],
            ['h2_ni', 'エチレン（エテン）', 'H₂']
        ].filter(([, name]) => lib.has(name));
        assert(cases.length === 6, `代表の基質がライブラリに ${cases.length} 件しか無い（6件を期待）`);
        const run = (name, viaBottle, bottleId, label) => {
            setupReagent(c, [name]);
            const before = CC(g.userMolecule);
            if (viaBottle) bottle(c, bottleId).click();
            else {
                const b = [...D.querySelectorAll('#reaction-actions button')]
                    .find(x => x.textContent.includes(label));
                assert(b, `${name}: 自動案内に「${label}」のボタンが出ない`);
                b.click();
            }
            if (W.reactor.picking) {
                const site = W.reactor.picking.sites[0];
                const atom = g.userMolecule.atoms.find(a => site.includes(a.id));
                c.clickAt(atom.x, atom.y);
            }
            const after = CC(g.userMolecule);
            assert(after !== before, `${name} × ${bottleId}: 反応が進んでいない（正準コードが同じ）`);
            return after;
        };
        let ran = 0;
        cases.forEach(([bottleId, name, label]) => {
            const viaBottle = run(name, true, bottleId, label);
            const viaAuto = run(name, false, bottleId, label);
            assert(viaBottle === viaAuto,
                `${name} × ${bottleId}: 入口で生成物が違う\n  瓶: ${viaBottle}\n  自動案内: ${viaAuto}`);
            ran++;
        });
        assert(ran === 6, `比べられた組み合わせが ${ran} 件（6件を期待）`);
        // **否定対照**: 別の瓶（けん化 ↔ 加水分解）は生成物が違う。
        // 同じコードが返るなら、この検査は何も見分けていない
        const salt = run('酢酸エチル', true, 'naoh_aq', 'けん化');
        const acid = run('酢酸エチル', true, 'h2so4_dil', '加水分解（エステル');
        assert(salt !== acid,
            '否定対照が働いていない: けん化と加水分解の生成物が同じ正準コードになっている');
        c.reset();
    });

    test('RG11: 瓶から引いた解説は瓶の節に残る（トーストに逃がさない・§7.5 の未決の決着）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const lib = new Set(g.getCompoundLibrary().map(e => e.name));
        assert(lib.has('2-メチル-2-プロパノール'), 'ライブラリに「2-メチル-2-プロパノール」が無い');
        const modal = D.getElementById('molecule-modal');
        const noteEl = D.getElementById('mm-reagent-note');
        const toast = D.getElementById('canvas-toast');
        // 3級アルコール × 酸化剤 ＝ oxidize_tertiary_info が1件だけ当たる（§4.2 ③・§7.5）
        setupReagent(c, ['2-メチル-2-プロパノール']);
        const before = W.canonicalCode(g.userMolecule);
        const beforeHistory = g.history.length;
        // トーストに書かれたかどうかを見分けるため、押す前に目印を置く
        toast.textContent = 'RG11-MARK';
        bottle(c, 'oxidant').click();
        assert(noteEl.textContent.includes('酸化されにくい'),
            `3級アルコールの解説が瓶の節に出ていない: ${noteEl.textContent.slice(0, 60) || '（空）'}`);
        assert(toast.textContent === 'RG11-MARK',
            `瓶から引いた解説がトーストへ流れている（2か所に割れる）: ${toast.textContent.slice(0, 60)}`);
        assert(!modal.classList.contains('hidden'), '解説だけなのにモーダルが閉じた');
        assert(W.canonicalCode(g.userMolecule) === before, '解説だけなのに分子が変わった');
        assert(g.history.length === beforeHistory,
            `解説だけなのに Undo 履歴が ${beforeHistory} → ${g.history.length} に伸びた`);
        // **否定対照**: 目印の見張りが本当に効くか。自動案内側の同じボタンは
        // 従来どおりトーストに出るので、目印は必ず上書きされる
        toast.textContent = 'RG11-MARK';
        const info = [...D.querySelectorAll('#reaction-actions button')]
            .find(b => b.textContent.includes('3級アルコール'));
        assert(info, '自動案内に「⚠ 酸化（3級アルコール）」のボタンが出ていない');
        info.click();
        assert(toast.textContent !== 'RG11-MARK',
            '否定対照が働いていない: 自動案内の解説でも目印が残る（トーストを見張れていない）');
        c.reset();
    });

    /* ===== 試薬パレット 第3段（DESIGN_reagent_palette.md §5 第3段・調べるもの5本） ===== */

    test('RG7: 呈色・検出の陽性/陰性が構造どおりに出る（§5 第3段）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const lib = new Set(g.getCompoundLibrary().map(e => e.name));
        const noteEl = D.getElementById('mm-reagent-note');
        // [瓶, 分子, 期待, なぜその組み合わせを見るのか]
        const cases = [
            ['ag_ammonia', 'アセトアルデヒド', true, '-CHO がある'],
            ['ag_ammonia', 'アセトン', false, 'ケトンは同じ C=O でも還元性が無い'],
            ['ag_ammonia', 'α-D-グルコース（α-D-グルコピラノース）', true, '環状でもヘミアセタール＝還元糖'],
            ['fehling', 'アセトアルデヒド', true, '銀鏡と同じ根拠で陽性'],
            ['fehling', 'アセトン', false, '銀鏡と同じ根拠で陰性'],
            ['fecl3', 'フェノール', true, '環に直結した -OH'],
            ['fecl3', 'エタノール', false, '鎖の -OH では呈色しない'],
            ['fecl3', 'ベンジルアルコール', false, '環はあるが -OH は鎖の側'],
            ['ninhydrin', 'アラニン', true, '-NH₂ と -COOH が同じ分子にある'],
            ['ninhydrin', '酢酸', false, '-COOH だけ'],
            ['ninhydrin', 'アニリン', false, '-NH₂ だけ'],
            ['nahco3', '酢酸', true, 'カルボン酸は炭酸より強い酸'],
            ['nahco3', 'フェノール', false, 'フェノールは炭酸より弱い酸']
        ].filter(([, name]) => lib.has(name));
        assert(cases.length >= 12, `代表分子がライブラリに揃っていない（${cases.length} 件）`);
        let pos = 0, neg = 0;
        cases.forEach(([id, name, want, why]) => {
            setupReagent(c, [name]);
            bottle(c, id).click();
            const text = noteEl.textContent;
            assert(text.includes(want ? '陽性' : '陰性'),
                `${name} × ${id} は${want ? '陽性' : '陰性'}のはず（${why}）: ${text.slice(0, 70)}`);
            if (want) pos++; else neg++;
        });
        // **空振りの緑を避ける**: 陽性・陰性の両方をちゃんと数えたことを主張する
        assert(pos >= 5 && neg >= 6, `陽性 ${pos} 件・陰性 ${neg} 件（陽性5件以上・陰性6件以上を期待）`);
        // **否定対照**: 酢酸とアニリンを**並べて置いても**ニンヒドリンは陰性。
        // 分子をまたいで -NH₂ と -COOH を合算していたらここで赤くなる（§7.7 と同じ落とし穴）
        if (lib.has('酢酸') && lib.has('アニリン')) {
            setupReagent(c, ['酢酸', 'アニリン']);
            bottle(c, 'ninhydrin').click();
            assert(noteEl.textContent.includes('陰性'),
                '否定対照: 酢酸とアニリンを並べただけでニンヒドリンが陽性になっている（分子をまたいで数えている）');
        }
        c.reset();
    });

    test('RG8: 調べる瓶はどれを掛けても分子も履歴も1つも変えない（総当たり・§2.5）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        const CC = W.canonicalCode;
        const lib = new Set(g.getCompoundLibrary().map(e => e.name));
        const detectBottles = W.REAGENTS.filter(r => r.kind === 'detect');
        assert(detectBottles.length === 5, `調べる瓶が ${detectBottles.length} 本（5本を期待）`);
        const names = ['アセトアルデヒド', 'アセトン', 'フェノール', 'エタノール', 'アラニン', '酢酸',
            'α-D-グルコース（α-D-グルコピラノース）'].filter(n => lib.has(n));
        assert(names.length >= 6, `代表分子がライブラリに ${names.length} 件しか無い`);
        const modal = D.getElementById('molecule-modal');
        let checked = 0;
        names.forEach(name => {
            setupReagent(c, [name]);
            const before = CC(g.userMolecule);
            const beforeAtoms = g.userMolecule.atoms.length;
            const beforeHistory = g.history.length;
            detectBottles.forEach(rg => {
                bottle(c, rg.id).click();
                assert(CC(g.userMolecule) === before,
                    `${name} × ${rg.name}: 検出なのに分子が変わった\n  前: ${before}\n  後: ${CC(g.userMolecule)}`);
                assert(g.userMolecule.atoms.length === beforeAtoms,
                    `${name} × ${rg.name}: 検出なのに原子数が変わった`);
                assert(g.history.length === beforeHistory,
                    `${name} × ${rg.name}: 検出なのに Undo 履歴が ${beforeHistory} → ${g.history.length} に伸びた`);
                assert(!modal.classList.contains('hidden'),
                    `${name} × ${rg.name}: 検出でモーダルが閉じた（陽性/陰性の文が読めない）`);
                assert(D.getElementById('mm-reagent-note').textContent.trim().length > 0,
                    `${name} × ${rg.name}: 押しても何も返らない`);
                checked++;
            });
        });
        // **空振りの緑を避ける**: 総当たりの回数が期待どおりであることまで見る
        assert(checked === names.length * 5,
            `総当たりが ${checked} 通り（${names.length} 分子 × 5本 ＝ ${names.length * 5} 通りを期待）`);
        // **否定対照**: 同じ数え方で「変えるもの」を押すと必ず変わる。
        // 変わらないなら、この検査は何も見ていない
        setupReagent(c, ['エタノール']);
        const before = CC(g.userMolecule);
        bottle(c, 'oxidant').click();
        assert(CC(g.userMolecule) !== before,
            '否定対照が働いていない: 変えるものの瓶を押しても正準コードが動かない');
        c.reset();
    });

    test('MM9: 320px でモーダルが横にあふれず、32px 未満のタップ標的が0件（瓶18本）', async (c) => {
        const D = c.D, W = c.W, g = c.game;
        // iframe の幅を 320px に縮めて、瓶18本を並べた状態のモーダルを測る
        const el = W.frameElement;
        assert(el, 'テスト用 iframe が取れない（幅を変えられない）');
        const w0 = el.style.width;
        el.style.width = '320px';
        await c.tick(250);
        setupReagent(c, ['エタノール']);
        await c.tick(150);
        const content = D.querySelector('#molecule-modal .modal-content');
        const grid = D.getElementById('mm-reagents-grid');
        const bottles = [...grid.querySelectorAll('.rg-bottle')];
        const report = [];
        try {
            assert(W.innerWidth <= 360, `iframe が 320px に縮んでいない（${W.innerWidth}px）`);
            assert(bottles.length === 18, `320px で瓶が ${bottles.length} 本しか描かれていない`);
            // (1) 横あふれ 0 件（モーダル・格子・body のどれでも）
            [['modal-content', content], ['rg-grid', grid], ['body', D.body]].forEach(([n, e]) => {
                if (e.scrollWidth > e.clientWidth + 1) report.push(`${n}: ${e.scrollWidth}>${e.clientWidth}`);
            });
            assert(report.length === 0, `320px で横にあふれている: ${report.join(' / ')}`);
            // (2) 32px 未満のタップ標的 0 件（瓶は 44px の床。§7.4）
            const small = [...D.querySelectorAll('#molecule-modal button')]
                .filter(b => b.offsetParent !== null)
                .map(b => ({ b, h: b.getBoundingClientRect().height }))
                .filter(x => x.h > 0 && x.h < 32);
            assert(small.length === 0,
                `32px 未満の標的が ${small.length} 件: ${small.map(x => `${x.b.id || x.b.className}=${Math.round(x.h)}`).join(', ')}`);
            // (3) 瓶そのものは 44px 以上（**空振りの緑を避ける**: 数えた対象があったことを主張）
            const heights = bottles.map(b => b.getBoundingClientRect().height);
            assert(Math.min(...heights) >= 44,
                `瓶の最小の高さが ${Math.min(...heights).toFixed(1)}px（44px 以上を期待）`);
            assert(bottles.every(b => b.getBoundingClientRect().width >= 60),
                '320px で瓶の幅が 60px を割っている（2列に収まっていない可能性）');
            // (4) **否定対照**: 同じ数え方で、わざと広げた格子は必ずあふれる
            const wasMin = grid.style.gridTemplateColumns;
            grid.style.gridTemplateColumns = 'repeat(18, 200px)';
            await c.tick(60);
            assert(grid.scrollWidth > grid.clientWidth + 1,
                '否定対照が働いていない: 18列×200px にしても横あふれとして数えられない');
            grid.style.gridTemplateColumns = wasMin;
        } finally {
            el.style.width = w0;
            await c.tick(250);
            c.reset();
        }
    });

    /* ===== detect が数える単位（DESIGN_reagent_palette.md §7.7・第2段の申し送り） =====
       第1段の最大の落とし穴は「`detect` が見ている範囲がキャンバス全体か1分子かは
       ルールごとにばらばら」だったこと（同書 §7.1）。第2段で12本に広げる前に27件を1件ずつ
       確かめ、**芳香族の2件**が全体数えのまま残っていた。ここで固定する。

       ⚠ **空振りの緑を避ける作り**: 件数を期待値と突き合わせ（「無い」ではなく「N件」）、
       **否定対照**として v779 と同じ全体数えを再現した式が**赤くなる**ことまで見る。 */
    test('RG9: 芳香族の detect は分子ごとに数える（同じ分子を並べても消えない・合算しない）', async (c) => {
        const W = c.W, g = c.game;
        const lib = new Set(g.getCompoundLibrary().map(e => e.name));
        ['ベンゼン', 'トルエン', 'ニトロベンゼン', 'ベンゼンスルホン酸', '2,4-ジニトロフェノール']
            .forEach(n => assert(lib.has(n), `ライブラリに「${n}」が無い`));
        const rule = id => W.REACTION_RULES.find(r => r.id === id);
        const n = id => rule(id).detect(g.userMolecule).length;

        // (1) 同じ分子を2つ並べたら、置換できる箇所も2つ（v779 は等価クラスの鍵が
        //     キャンバス全体の正準コードだったので **1件**に潰れていた）
        setupReagent(c, ['ベンゼン']);
        assert(n('aromatic_nitration') === 1, `ベンゼン1個のニトロ化が ${n('aromatic_nitration')} 件（1件を期待）`);
        setupReagent(c, ['ベンゼン', 'ベンゼン']);
        ['aromatic_nitration', 'aromatic_sulfonation', 'aromatic_halogenation'].forEach(id =>
            assert(n(id) === 2, `ベンゼン2個の ${id} が ${n(id)} 件（2件を期待）`));
        // 2件が**別の分子**に1つずつ載っていること（同じ環に2件出ているのでは意味が違う）
        const mol = g.userMolecule;
        const sites = rule('aromatic_nitration').detect(mol).map(s => s[0]);
        const comps = sites.map(id => [...W.componentOf(mol, id)].sort().join(','));
        assert(new Set(comps).size === 2, '置換の候補2件が同じ分子に載っている（別の分子に1つずつを期待）');

        // (1b) 形が違えば v779 でも壊れていなかった（回帰の範囲を固定する）
        setupReagent(c, ['ベンゼン', 'トルエン']);
        assert(n('aromatic_nitration') === 4,
            `ベンゼン＋トルエンのニトロ化が ${n('aromatic_nitration')} 件（ベンゼン1＋トルエン o/m/p の4件を期待）`);

        // (1c) **否定対照**: v779 と同じ「キャンバス全体で等価クラスを取る」数え方を再現すると、
        //      ベンゼン2個は1件に潰れる。潰れなければ数え方そのものが壊れている
        setupReagent(c, ['ベンゼン', 'ベンゼン']);
        const wholeCanvasClasses = (m) => {
            const ids = new Set();
            const keys = W.findAromaticBondKeys(m);
            m.bonds.forEach(b => {
                const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
                if (keys.has(k)) { ids.add(b.atomId1); ids.add(b.atomId2); }
            });
            const seen = new Set();
            [...ids].forEach(id => {
                const probe = new W.Molecule();
                const map = new Map();
                m.atoms.forEach(a => map.set(a.id, probe.addAtom(a.element, a.x, a.y).id));
                m.bonds.forEach(b => {
                    if (map.has(b.atomId1) && map.has(b.atomId2)) {
                        probe.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
                    }
                });
                const marker = probe.addAtom('Cl', 0, 0);
                probe.addBond(map.get(id), marker.id, 1);
                seen.add(W.canonicalCode(probe));
            });
            return seen.size;
        };
        assert(wholeCanvasClasses(g.userMolecule) === 1,
            `否定対照が働いていない: 全体数えでベンゼン2個が ${wholeCanvasClasses(g.userMolecule)} クラス（1クラスに潰れるはず）`);

        // (2) 電子を引く基は**その環**で数える。1つずつしか持たない分子を並べても合算しない
        setupReagent(c, ['ニトロベンゼン']);
        assert(n('aromatic_deactivated_info') === 0, '単独のニトロベンゼンで「置換が起こりにくい環」が出ている');
        setupReagent(c, ['ニトロベンゼン', 'ニトロベンゼン']);
        assert(n('aromatic_deactivated_info') === 0,
            `ニトロベンゼン2個で「置換が起こりにくい環」が ${n('aromatic_deactivated_info')} 件（0件を期待。環ごとには -NO₂ が1つずつ）`);
        setupReagent(c, ['ニトロベンゼン', 'ベンゼンスルホン酸']);
        assert(n('aromatic_deactivated_info') === 0,
            'ニトロベンゼン＋ベンゼンスルホン酸で「置換が起こりにくい環」が出ている（別の分子の基を合算している）');
        // (2b) **否定対照**: 本当に2つ持つ環では出る（0を返しているだけの実装なら赤くなる）
        setupReagent(c, ['2,4-ジニトロフェノール']);
        assert(n('aromatic_deactivated_info') === 1,
            `2,4-ジニトロフェノールで「置換が起こりにくい環」が ${n('aromatic_deactivated_info')} 件（1件を期待）`);
        c.reset();
    });

    /* ===== 見出しの重なり回避（DESIGN_molecule_modal.md §12・v730。ユーザー指摘） =====
       見出し（🔍 ① 乳酸）には衝突回避が1つも無く、(1) 見出しどうし (2) 見出しと他の分子の図
       の2種類が重なっていた。段送り（1マスの整数倍だけ縦に動かす）で解いている。

       ⚠ **空振りの緑を避けるための作り**:
       - 重なりの件数を**数えて期待値と突き合わせる**（「無い」ではなく「0件」を主張する）
       - 各テストに**否定対照**を置く。`game.labelCollisionAvoid = false` で段送りを止めると
         同じ数え方が**赤くなる**ことまで見る。数え方が壊れて 0 を返しているなら、
         この否定対照が落ちて気づける
       - 重なり判定はアプリと**同じ関数**（`window.rectsOverlap` など）を使う。
         テストが別の式で数えると「アプリは避けたつもり・テストは別の物差し」ですれ違う */

    // 名前で分子を呼び出し、各分子の左上を指定の位置へ動かす（配置を作るヘルパー）。
    // ⚠ `splitMolecules()` は**複製**を返すので、id を借りて本体の原子を動かす
    const layoutMolecules = (c, names, offsets) => {
        const g = c.game, D = c.D, W = c.W;
        g.userMolecule = new W.Molecule();
        g.updateDrawing();
        const input = D.getElementById('summon-input');
        names.forEach(n => {
            input.value = n;
            input.dispatchEvent(new W.Event('change', { bubbles: true }));
        });
        g.splitMolecules().forEach((p, i) => {
            const o = offsets[i]; if (!o) return;
            const ids = new Set(p.atoms.map(a => a.id));
            const real = g.userMolecule.atoms.filter(a => ids.has(a.id));
            const ax = Math.min(...real.map(a => a.x)), ay = Math.min(...real.map(a => a.y));
            real.forEach(a => { a.x += o[0] - ax; a.y += o[1] - ay; });
        });
        g.updateDrawing();
    };

    // いま描かれている見出しの矩形と、他の分子の絵との重なりを**数える**（アプリと同じ判定関数）
    const countLabelOverlaps = (c) => {
        const g = c.game, W = c.W;
        const rects = g._labelRects || [];
        const mol = g.userMolecule;
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        const hyd = mol.calculateHydrogens();
        let chipChip = 0, chipInk = 0, gridRows = 0;
        for (let i = 0; i < rects.length; i++)
            for (let j = i + 1; j < rects.length; j++)
                if (W.rectsOverlap(rects[i], rects[j])) chipChip++;
        rects.forEach(lr => {
            mol.atoms.forEach(a => {
                if (lr.ids.has(a.id)) return;
                if (W.circleHitsRect({ x: a.x, y: a.y, r: 13 }, lr)) chipInk++;
            });
            mol.bonds.forEach(b => {
                const a1 = byId.get(b.atomId1), a2 = byId.get(b.atomId2);
                if (!a1 || !a2 || lr.ids.has(a1.id)) return;
                if (W.segmentHitsRect({ x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y, half: 5 }, lr)) chipInk++;
            });
            hyd.forEach(hh => {
                if (lr.ids.has(hh.parentId)) return;
                if (W.circleHitsRect({ x: hh.x, y: hh.y, r: 9 }, lr)) chipInk++;
            });
            // 「格子点を覆っていないか」。その分子の下端を基準に格子行を数える。
            // ⚠ **走査範囲は枠の位置から決める**。「上下8マス」のような固定窓にすると、
            //   遠くへ段送りされた枠だけ窓から外れて件数が減り、**避けたおかげで減った**ように見える
            //   （実発生: 素 8 → 段送り後 7。中身は窓の外にもう1行あった）
            const ys = mol.atoms.filter(a => lr.ids.has(a.id) && a.element !== 'H').map(a => a.y);
            const base = Math.max(...ys);
            const G = c.W.GRID_SIZE;
            const k0 = Math.floor((lr.y - base) / G) - 1, k1 = Math.ceil((lr.y + lr.h - base) / G) + 1;
            for (let k = k0; k <= k1; k++) {
                const gy = base + k * G;
                if (gy > lr.y && gy < lr.y + lr.h) gridRows++;
            }
        });
        return { chipChip, chipInk, gridRows, count: rects.length };
    };

    // 段送りを止めた素の状態で数え直す（否定対照）。数え終わったら必ず元へ戻す
    const countWithoutAvoidance = (c) => {
        const g = c.game;
        g.labelCollisionAvoid = false;
        g.updateDrawing();
        const n = countLabelOverlaps(c);
        g.labelCollisionAvoid = true;
        g.updateDrawing();
        return n;
    };

    const clearCanvas = (c) => {
        c.game.labelCollisionAvoid = true;
        c.game.userMolecule = new c.W.Molecule();
        c.game.updateDrawing();
    };

    test('ML1: 横に並べた2分子の見出しが食い合わない（否定対照つき）', async (c) => {
        c.reset();
        const g = c.game;
        g.setMode('free');
        // 見出しは分子より横に長い（グリセリンは幅84単位・見出しは135単位）ので、
        // 1マス空けて隣に置くと**既定の位置では必ず重なる**配置になる
        layoutMolecules(c, ['グリセリン', 'グリセリン'], [[210, 294], [336, 294]]);
        const before = countWithoutAvoidance(c);
        assert(before.count === 2, `見出しが ${before.count} 個（2個の配置を作ったつもり）`);
        // 否定対照: 避けを切ると**確かに重なる**。ここが 0 なら数え方が壊れている
        assert(before.chipChip >= 1,
            `否定対照が空振り: 段送りを止めても見出しどうしの重なりが ${before.chipChip} 件`);

        const after = countLabelOverlaps(c);
        assert(after.count === 2, `見出しが ${after.count} 個（2個であるべき）`);
        assert(after.chipChip === 0, `見出しどうしが ${after.chipChip} 件重なっている`);
        assert(after.chipInk === 0, `見出しが他の分子の絵と ${after.chipInk} 件重なっている`);
        // 段送りは**縦だけ**。横位置（分子の真下）は動かさない ＝ どの分子の名前かの手がかりを守る
        const off = g._labelRects.map(r => r.x);
        g.labelCollisionAvoid = false; g.updateDrawing();
        const homeX = g._labelRects.map(r => r.x);
        g.labelCollisionAvoid = true; g.updateDrawing();
        off.forEach((x, i) => assert(near(x, homeX[i], 0.6),
            `見出しが横へずれている（${homeX[i]} → ${x}）。段送りは縦だけの約束`));
        clearCanvas(c);
    });

    test('ML2: 上下に並べたとき、上の分子の見出しが下の分子の絵に乗らない（否定対照つき）', async (c) => {
        c.reset();
        const g = c.game;
        g.setMode('free');
        // 乳酸（y 168..210）の1マス強下 ＝ 既定の見出しの位置に、エタノールの原子が来る配置
        layoutMolecules(c, ['乳酸', 'エタノール'], [[252, 168], [252, 294]]);
        const before = countWithoutAvoidance(c);
        assert(before.count === 2, `見出しが ${before.count} 個（2個の配置を作ったつもり）`);
        // 否定対照: 避けを切ると**確かに図の上に乗る**
        assert(before.chipInk >= 1,
            `否定対照が空振り: 段送りを止めても図との重なりが ${before.chipInk} 件`);

        const after = countLabelOverlaps(c);
        assert(after.chipInk === 0, `見出しが他の分子の絵と ${after.chipInk} 件重なっている`);
        assert(after.chipChip === 0, `見出しどうしが ${after.chipChip} 件重なっている`);
        // 逃げ先は「分子の上」。下へ送り続けると下の分子より下まで行ってしまう（§12-2）
        const top = g._labelRects.find(r => {
            const ys = g.userMolecule.atoms.filter(a => r.ids.has(a.id) && a.element !== 'H').map(a => a.y);
            return Math.max(...ys) < 250; // 上に置いた乳酸
        });
        assert(top, '上の分子の見出しが見つからない');
        assert(top.y < 168, `上の分子の見出しが分子の上へ回っていない（y=${Math.round(top.y)}）`);
        clearCanvas(c);
    });

    test('ML3: どの配置でも的は32px以上・格子点の覆い方は段送りで変わらない', async (c) => {
        c.reset();
        const g = c.game, D = c.D;
        g.setMode('free');
        const cases = [
            { names: ['グリセリン', 'グリセリン'], offsets: [[210, 294], [336, 294]] },
            { names: ['乳酸', 'エタノール'], offsets: [[252, 168], [252, 294]] },
            { names: ['酢酸', 'エタノール', '乳酸'], offsets: [[168, 210], [378, 210], [252, 336]] },
            { names: ['酢酸', 'エタノール', '乳酸', 'グリセリン'],
              offsets: [[168, 168], [378, 168], [168, 336], [378, 336]] }
        ];
        let checked = 0;
        for (const cs of cases) {
            layoutMolecules(c, cs.names, cs.offsets);
            // (1) 押せる大きさ ＝ **画面px**で 32px を割らない（単位で見ると実機だけ小さくなる。§11-1）
            const chips = [...D.querySelectorAll('#atoms-group g')]
                .filter(el => el.querySelector('text') && /🔍/.test(el.textContent));
            assert(chips.length === cs.names.length,
                `見出しが ${chips.length} 個（${cs.names.length} 個であるべき）`);
            chips.forEach(el => {
                const h = el.querySelector('rect').getBoundingClientRect().height;
                assert(h >= 32, `見出しの的が ${Math.round(h)}px（32px 未満）: ${el.textContent.trim()}`);
                checked++;
            });
            // (2) 重なりは 0 件
            const after = countLabelOverlaps(c);
            assert(after.chipChip === 0 && after.chipInk === 0,
                `重なりが残っている（見出しどうし ${after.chipChip} / 図と ${after.chipInk}）`);
            // (3) **格子点の覆い方が段送りで変わらない**。送り幅を1マスの整数倍に限っている
            //     ので、格子との位置関係は平行移動でそのまま保たれる（§12-3）。
            //     ⚠ 縮小表示では枠の高さ（34×倍率）が1マス（42）を超えるため、既定の位置でも
            //     格子行を跨ぐ。そこを「0件」と書くと縮小表示で落ちるので、**素の状態と同数**で見る
            const before = countWithoutAvoidance(c);
            assert(after.gridRows === before.gridRows,
                `段送りで格子点の覆い方が変わった（素 ${before.gridRows} → 段送り後 ${after.gridRows}）`);
        }
        assert(checked === 11, `的を測った見出しが ${checked} 個（11個であるべき）`);
        clearCanvas(c);
    });

    /* ===== リボン統合 第1段（DESIGN_ribbon_consolidation.md §9 第1段） =====
       「リボンをタイルにする。中身は1つも動かさない。」
       固定したいのは2つだけ ——「全端末で全部が器の中に入る」と「タップ標的の床を割らない」。
       ⚠ 共有の iframe（c.W）は幅を変えると後続テストに響くので、**使い捨ての iframe** を開く
         （N3 と同じ作法）。既存テストは「≥900px」を暗黙の前提にしているため、共有の器は触らない。 */

    // 指定の大きさで使い捨ての本体を開き、fn に (W, D) を渡す
    async function withViewport(w, h, fn) {
        const f = document.createElement('iframe');
        f.style.cssText = `position:absolute; left:-9999px; top:0; width:${w}px; height:${h}px; border:0;`;
        f.src = 'index.html?se=0';
        document.body.appendChild(f);
        try {
            for (let i = 0; i < 300; i++) {
                if (f.contentWindow && f.contentWindow.appReady) break;
                await new Promise(r => setTimeout(r, 100));
            }
            assert(f.contentWindow && f.contentWindow.appReady, `${w}×${h} でアプリが起動しない`);
            await new Promise(r => setTimeout(r, 250)); // レイアウトの落ち着き待ち
            return await fn(f.contentWindow, f.contentDocument, `${w}×${h}`);
        } finally { f.remove(); }
    }

    // リボンの中で「実際に流れている」タイルだけを拾う（縦画面の ☰ は position:fixed の浮動ボタン）
    function ribbonTiles(W, D) {
        const hdr = D.querySelector('.canvas-header');
        return [...hdr.children].filter(el => {
            if (el.tagName !== 'BUTTON') return false;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return false;
            return ['static', 'relative'].includes(W.getComputedStyle(el).position);
        });
    }

    test('RB1: リボンのタイルが 320px縦・568×320横・900px PC のすべてで器の中に収まる', async (c) => {
        // 旧リボンは PC で flex-wrap:nowrap のまま**黙って縮んで**いた（900px で幅33px・
        // 中身が高さ40pxの枠から溢れる）。scrollWidth === clientWidth のままなので
        // 「あふれ」を見る検査では捕まらない ＝ 位置で確かめるしかない
        for (const [w, h] of [[320, 568], [568, 320], [900, 700]]) {
            await withViewport(w, h, (W, D, name) => {
                const hdr = D.querySelector('.canvas-header');
                const box = hdr.getBoundingClientRect();
                const tiles = ribbonTiles(W, D);
                assert(tiles.length >= 5, `${name}: リボンのタイルが ${tiles.length} 個しか見えない`);
                tiles.forEach(el => {
                    const r = el.getBoundingClientRect();
                    assert(r.top >= box.top - 1 && r.bottom <= box.bottom + 1 &&
                           r.left >= box.left - 1 && r.right <= box.right + 1,
                        `${name}: ${el.id} が器からはみ出している（タイル ${Math.round(r.left)},${Math.round(r.top)} ` +
                        `${Math.round(r.width)}×${Math.round(r.height)} / 器 ${Math.round(box.left)},${Math.round(box.top)} ` +
                        `${Math.round(box.width)}×${Math.round(box.height)}）`);
                    // 中身（アイコン＋短ラベル）が 52px から切れていないこと
                    assert(el.scrollWidth <= el.clientWidth + 1,
                        `${name}: ${el.id} のラベルが切れている（${el.scrollWidth} > ${el.clientWidth}）`);
                });
                // 本体そのものが横に伸びていないこと
                assert(D.documentElement.scrollWidth <= D.documentElement.clientWidth + 1,
                    `${name}: リボンのせいで本体が横スクロールしている`);
            });
        }
    });

    test('RB2: リボンのタイルが 32px の床を割らない（52×46 が全端末で同じ）', async (c) => {
        for (const [w, h] of [[320, 568], [568, 320], [900, 700], [1280, 800]]) {
            await withViewport(w, h, (W, D, name) => {
                const tiles = ribbonTiles(W, D);
                tiles.forEach(el => {
                    const r = el.getBoundingClientRect();
                    assert(r.height >= 32 && r.width >= 32,
                        `${name}: ${el.id} が ${Math.round(r.width)}×${Math.round(r.height)}（32px の床を割っている）`);
                    assert(Math.abs(r.width - 52) < 1.5 && Math.abs(r.height - 46) < 1.5,
                        `${name}: ${el.id} が 52×46 でない（${Math.round(r.width)}×${Math.round(r.height)}）` +
                        ' ＝ 端末ごとに大きさが変わると 9 枠の勘定が崩れる');
                });
            });
        }
    });

    test('RB3: ⤓ JSON は Help モーダルの中にあり、座標表示は要素を残したまま隠れている', async (c) => {
        const D = c.D, W = c.W;
        // ① ⤓ JSON（制作用）は Help モーダルへ（§12 ユーザー決定①）。id は据え置き＝ハンドラも台本も無傷
        const exp = D.getElementById('btn-export-json');
        assert(exp, '⤓ JSON のボタンが消えている');
        assert(D.getElementById('tutorial-modal').contains(exp),
            '⤓ JSON が Help モーダル（#tutorial-modal）の中に無い');
        assert(!D.querySelector('.canvas-header').contains(exp), '⤓ JSON がリボンに残っている');

        // ② 座標表示は消したが、要素は残す（id を消さない不変条件）
        const coord = D.getElementById('coord-display');
        assert(coord, '#coord-display の要素ごと消されている');
        assert(W.getComputedStyle(coord).display === 'none', '座標表示が見えている');

        // ③ 🔤 官能基をまとめる は**分子モーダルの中**（§12 ユーザー決定③・第4段で回収）。
        //    リボンの枠を1つ空けるための移設で、id は据え置き ＝ tutorials.json の
        //    #btn-condense は無傷。ラベルの入れ替えは textContent の経路に落ちる
        const cond = D.getElementById('btn-condense');
        assert(cond, '🔤 官能基をまとめる のボタンが消えている');
        assert(D.getElementById('molecule-modal').contains(cond),
            '🔤 官能基をまとめる が分子モーダルの中に無い');
        assert(!D.querySelector('.canvas-header').contains(cond),
            '🔤 官能基をまとめる がリボンに残っている（枠が空かない）');
        assert(!cond.querySelector('.tile-icon') && !cond.querySelector('.tile-label'),
            'タイルでなくなったのに .tile-icon / .tile-label の span が残っている');
        const condLabel = cond.textContent;
        cond.click();
        assert(cond.textContent !== condLabel && /結合/.test(cond.textContent),
            `🔤 を押してもラベルが「結合をすべて表示」に変わらない（${cond.textContent}）`);
        cond.click();
        assert(cond.textContent === condLabel,
            `もう一度押してもラベルが戻らない（${cond.textContent}）`);

        // ④ リボンのタイルは アイコン＋短ラベル の2段のまま（🔤 が抜けても崩れていない）
        const tile = D.getElementById('btn-reset-view');
        assert(tile.querySelector('.tile-icon') && tile.querySelector('.tile-label'),
            'リボンのタイルが アイコン＋短ラベル の2段になっていない');
    });

    test('RB4: ❓ヘルプはリボンの中にあり、押すと Help モーダルが開く（遊び方も同じ1枚）', async (c) => {
        const D = c.D, W = c.W;
        const help = D.getElementById('btn-help');
        assert(help, '❓ヘルプのボタンが消えている');
        // ① 置き場所（第2段・§3-2 の 9枠目）。ヘッダーではなくリボン
        const hdr = D.querySelector('.canvas-header');
        assert(hdr.contains(help), '❓ヘルプがリボン（.canvas-header）の中に無い');
        assert(!D.querySelector('header').contains(help), '❓ヘルプがヘッダーに残っている');
        // ② 他の8枠と同じタイルの形（アイコン＋短ラベルの2段・52×46）。
        //    ヘッダーにいたころは PC で 29px と 32px の床を割っていた
        assert(help.querySelector('.tile-icon') && help.querySelector('.tile-label'),
            '❓ヘルプがタイル（アイコン＋短ラベル）になっていない');
        const r = help.getBoundingClientRect();
        assert(r.height >= 32, `❓ヘルプが ${Math.round(r.width)}×${Math.round(r.height)}（32px の床を割っている）`);

        // ③ 押すと Help モーダルが開く（配線は tutorial.js が id で結んでいる）
        const modal = D.getElementById('tutorial-modal');
        assert(modal.classList.contains('hidden'), '最初から Help モーダルが開いている');
        help.click();
        assert(!modal.classList.contains('hidden'), '❓ヘルプを押しても Help モーダルが開かない');
        // ④ 遊び方（.hint-box）と ⤓ JSON が同じ1枚に入っている（§5-5 の統合）
        assert(modal.contains(D.getElementById('hint-details')), '遊び方が Help モーダルの中に無い');
        assert(modal.contains(D.getElementById('btn-export-json')), '⤓ JSON が Help モーダルの中に無い');
        // ⑤ 開いた枠が縦にあふれない（遊び方は 320px 幅で約 1800px ある）
        const content = modal.querySelector('.modal-content');
        assert(W.getComputedStyle(content).overflowY === 'auto',
            'Help モーダルの枠が縦スクロールしない（遊び方を開くと枠からあふれる）');
        D.getElementById('btn-tutorial-close').click();
        assert(modal.classList.contains('hidden'), 'Help モーダルが閉じない');
    });

    test('RB5: 反応機構の再生中、ステップ送りが作業帯に出ていて巻矢印がキャンバスに見える', async (c) => {
        // **この段でいちばん価値のある1件**（DESIGN_ribbon_consolidation.md 第3段）。
        // 巻矢印は本体 SVG の #arrows-group に描かれるので、操作を全画面のモーダルや
        // 画面外のシートに置くと「押す場所」と「見る場所」が同時に見られない。
        // ＝ 操作がキャンバスの上（作業帯）にあり、矢印が出ていることを同時に確かめる
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        const rp = W.reactionPlayer;
        const strip = D.getElementById('work-strip');
        const pane = D.getElementById('ws-reaction');
        assert(strip && pane, '作業帯（#work-strip / #ws-reaction）が無い');
        // 何もしていないときは帯ごと畳まれている ＝ キャンバスが丸ごと見える。
        // ⚠ **居場所を先に宣言する** —— 帯は「作業を始めたか」だけでなく**モードでも**出る:
        //    パズル＝お題ストリップ（第4段）・標準＝🧪 名称呼び出し（第5段）。
        //    「何もしていない」が素で成り立つのは**学習モードだけ**になった
        g.setMode('learn');
        assert(strip.classList.contains('hidden'), '学習で何もしていないのに作業帯が出ている');

        // **人と同じ道で入る**: 📚 タイル → ⚗️ 反応機構ビューア → 機構モード ON。
        // 直に rp.enter() を呼ぶと「Study が閉じる」配線を素通りしてしまう
        D.querySelector('.canvas-header .mode-tab[data-mode="learn"]').click();
        const study = D.getElementById('study-modal');
        assert(!study.classList.contains('hidden'), '📚 タイルで Study モーダルが開かない');
        D.getElementById('reaction-box').open = true;
        const chk = rp.checkMode;
        chk.checked = true;
        chk.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        try {
            assert(rp.active, '機構モードのスイッチで再生が始まらない');
            assert(!strip.classList.contains('hidden') && !pane.classList.contains('hidden'),
                '反応機構モードに入っても作業帯が出ない');
            // ⓪ **再生中に Study モーダルが被っていない**（この段の核心。§6-2 の「バトンを渡す」）
            assert(study.classList.contains('hidden'),
                '再生が始まっても Study モーダルがキャンバスを覆ったまま');
            // ① ステップ送りの4つが作業帯の中にある（＝右パネルの details の中ではない）
            ['btn-rx-restart', 'btn-rx-prev', 'btn-rx-play', 'btn-rx-next'].forEach(id => {
                const b = D.getElementById(id);
                assert(b, `${id} が消えている`);
                assert(strip.contains(b), `${id} が作業帯の外にある`);
                const r = b.getBoundingClientRect();
                assert(r.width > 0 && r.height > 0, `${id} が見えていない`);
                assert(r.height >= 32, `${id} が ${Math.round(r.width)}×${Math.round(r.height)}（32px の床を割っている）`);
            });
            // ② 帯はキャンバス（#svg-wrapper）の中にあり、下端に貼り付いている
            const wrap = D.getElementById('svg-wrapper');
            assert(wrap.contains(strip), '作業帯がキャンバスの外にある');
            const sr = strip.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
            assert(Math.abs(sr.bottom - wr.bottom) < 2, '作業帯がキャンバスの下端に貼り付いていない');
            // ③ 帯が覆うのはキャンバスの一部だけ（全面オーバーレイになっていない）
            assert(sr.height < wr.height * 0.5,
                `作業帯がキャンバスの半分以上を覆っている（${Math.round(sr.height)}/${Math.round(wr.height)}px）`);
            // ④ 押す場所と見る場所が同時にある: 巻矢印が本体 SVG に出ている
            assert(D.getElementById('arrows-group').children.length > 0,
                '巻矢印が #arrows-group に出ていない');
            // ⑤ 作業帯のボタンで実際にステップが進み、説明も帯の中で書き換わる
            D.getElementById('btn-rx-next').click();
            const cap = D.getElementById('reaction-caption');
            assert(strip.contains(cap), '説明（#reaction-caption）が作業帯の外にある');
            assert(cap.textContent.length > 0, 'ステップを進めても説明が出ない');
        } finally {
            D.getElementById('reaction-box').open = false;
            rp.exit();
            g.setMode('free');
        }
        // ⑥ 抜けたら ⚗ の面は畳む。⚠ 帯そのものは標準（自由）では 🧪 の面が出るので残る（第5段）。
        //    学習に居れば帯ごと畳まれる ＝「何もしていなければキャンバスが丸ごと見える」は生きている
        assert(pane.classList.contains('hidden'), '反応機構モードを抜けても ⚗ の面が残る');
        g.setMode('learn');
        assert(strip.classList.contains('hidden'), '学習で何もしていないのに作業帯が残る');
        g.setMode('free');
    });

    test('RB6: 📚 学習タイルはリボンの中にあり、押すと learn モードになって Study が開く', async (c) => {
        c.reset();
        const D = c.D, g = c.game;
        const tile = D.querySelector('.canvas-header .mode-tab[data-mode="learn"]');
        assert(tile, '📚 学習タイルがリボン（.canvas-header）の中に無い');
        // ⚠ タブは**移設**であって複製ではない（複製すると .active が2箇所で点き、
        //    台本の `.mode-tab[data-mode="learn"]` がどちらを指すか DOM 順まかせになる）
        assert(D.querySelectorAll('.mode-tab[data-mode="learn"]').length === 1,
            '📚 学習タブが2つある（リボンへ移設したのに複製が残っている）');
        // 他の8枠と同じタイル（32px の床。§15-3 の落とし穴① ＝ 古い id 指定が勝つ事故の再発防止）
        const r = tile.getBoundingClientRect();
        assert(r.width >= 32 && r.height >= 32,
            `📚 タイルが ${Math.round(r.width)}×${Math.round(r.height)}（32px の床を割っている）`);
        assert(tile.querySelector('.tile-icon') && tile.querySelector('.tile-label'),
            '📚 タイルがアイコン＋短ラベルの2段になっていない');

        const study = D.getElementById('study-modal');
        assert(study && study.classList.contains('hidden'), '最初から Study モーダルが開いている');
        g.setMode('free');
        tile.click();
        try {
            assert(g.currentMode === 'learn', '📚 タイルで learn モードにならない');
            assert(!study.classList.contains('hidden'), '📚 タイルで Study モーダルが開かない');
            assert(tile.classList.contains('active'), '学習中なのに 📚 タイルが点灯しない');
            // メニューの中身は右パネルから**そのまま**移ってきている（id・内部構造は無改変）
            ['learn-acc-quiz', 'learn-acc-practice', 'reaction-box'].forEach(id => {
                assert(study.contains(D.getElementById(id)), `${id} が Study モーダルの中に無い`);
            });
            // 枠は縦スクロール（3つ全開で 320px 幅では 4.5画面ある・§6-1）
            assert(c.W.getComputedStyle(study.querySelector('.modal-content')).overflowY === 'auto',
                'Study モーダルの枠が縦スクロールしない');
            // 「閉じる」で閉じられる（抜け方・§13）
            D.getElementById('btn-study-close').click();
            assert(study.classList.contains('hidden'), '「閉じる」で Study モーダルが閉じない');
        } finally {
            g.setMode('free');
        }
        assert(study.classList.contains('hidden'), '学習を離れても Study モーダルが残る');
    });

    test('RB7: Study からクイズを開くと Study 自身は閉じている（重ねない）', async (c) => {
        // molecule_modal §5-5 の「重ねない」を Study にも適用（§6-2）。
        // 14枚とも z-index:1000 なので、開いたままだと ✕ が2つ並び、
        // DOM 順しだいでは**クイズが Study の裏に回る**
        c.reset();
        const D = c.D, g = c.game;
        const study = D.getElementById('study-modal');
        const cases = [
            { btn: 'btn-quiz', modal: 'quiz-modal', close: 'btn-quiz-close' },
            { btn: 'btn-naming', modal: 'naming-modal', close: 'btn-naming-close' },
            { btn: 'btn-count-quiz', modal: 'count-quiz-modal', close: 'btn-cq-close' }
        ];
        try {
            for (const t of cases) {
                D.querySelector('.canvas-header .mode-tab[data-mode="learn"]').click();
                assert(!study.classList.contains('hidden'), `${t.btn} の前に Study が開いていない`);
                D.getElementById('learn-acc-quiz').open = true;
                D.getElementById(t.btn).click();
                assert(!D.getElementById(t.modal).classList.contains('hidden'),
                    `${t.btn} で ${t.modal} が開かない`);
                assert(study.classList.contains('hidden'),
                    `${t.btn} を押しても Study モーダルが開いたまま（重なっている）`);
                D.getElementById(t.close).click();
            }
        } finally {
            D.getElementById('learn-acc-quiz').open = false;
            [...D.querySelectorAll('.modal-overlay')].forEach(m => m.classList.add('hidden'));
            g.setMode('free');
        }
    });

    test('RB8: 書き出し練習の進捗と操作が作業帯に出て、作図を変えると「いま:」が書き換わる', async (c) => {
        // `learn.js` の onDrawingChange が**帯に**生きている証明（第3段 その3）。
        // 進捗が見えるのがモーダルの中だけだと、キャンバスで手を動かしている間は
        // 「あと何個か」も「いま描いているものが何か」も見えない
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        const ip = W.isomerPractice;
        const strip = D.getElementById('work-strip');
        const pane = D.getElementById('ws-practice');
        assert(strip && pane, '作業帯の練習面（#ws-practice）が無い');
        assert(pane.classList.contains('hidden'), '練習していないのに練習面が出ている');

        g.setMode('learn');
        ip.start(0);   // C4H10（ブタン・イソブタンの2種）
        try {
            assert(ip.active, '異性体の書き出し練習が始まらない');
            assert(!strip.classList.contains('hidden') && !pane.classList.contains('hidden'),
                '練習を始めても作業帯の練習面が出ない');
            // ① 進捗（n/全 m）が帯に出る
            const prog = D.getElementById('ws-practice-progress');
            assert(strip.contains(prog) && /^0\/\d+$/.test(prog.textContent),
                `進捗が「0/総数」になっていない（${prog.textContent}）`);
            // ② 押しもの3つが 32px の床を満たす（§2-5 の敷き直し）
            const btns = [...D.querySelectorAll('#ws-practice-actions button')];
            assert(btns.length === 3, `作業帯の押しものが3つでない（${btns.length}）`);
            btns.forEach(b => {
                const r = b.getBoundingClientRect();
                assert(r.width > 0 && r.height >= 32,
                    `${b.textContent} が ${Math.round(r.width)}×${Math.round(r.height)}（32px の床を割っている）`);
            });
            // ③ **作図を変えると帯の「いま:」が書き換わる**（onDrawingChange が生きている）
            const live = D.getElementById('ws-practice-live');
            const before = live.textContent;
            const m = g.userMolecule;
            const a = [m.addAtom('C', 336, 294), m.addAtom('C', 378, 294),
                       m.addAtom('C', 420, 294), m.addAtom('C', 462, 294)];
            m.addBond(a[0].id, a[1].id, 1);
            m.addBond(a[1].id, a[2].id, 1);
            m.addBond(a[2].id, a[3].id, 1);
            g.updateDrawing();
            assert(live.textContent !== before, '作図を変えても帯の「いま:」が変わらない');
            assert(/ブタン/.test(live.textContent),
                `帯にいま描いている分子の名前が出ない（${live.textContent}）`);
            // ④ 登録すると進捗が進む（帯のボタンが本物の register を呼んでいる）
            btns.find(b => b.textContent.includes('登録')).click();
            assert(D.getElementById('ws-practice-progress').textContent.startsWith('1/'),
                '帯の「＋登録」で進捗が進まない');
            // ⑤ お題を選ぶ部分は**モーダル側に残す**（帯に持ち込まない・§9 の第3段）
            assert(D.getElementById('study-modal').contains(D.getElementById('ip-body')),
                'お題選び（#ip-body）が Study モーダルの中に無い');
        } finally {
            ip.stop();
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.setMode('free');
        }
        // ⑥ やめたら**練習の面**は畳む。⚠ 帯そのものは標準（自由）では 🧪 の面が出るので
        //    畳まれない（第5段）。学習に居れば帯ごと畳まれることも続けて見る
        assert(pane.classList.contains('hidden'), '練習をやめても練習面が残る');
        g.setMode('learn');
        assert(strip.classList.contains('hidden'), '学習に戻っても作業帯が残る');
        g.setMode('free');
        assert(!strip.classList.contains('hidden') &&
               !D.getElementById('ws-free').classList.contains('hidden'),
            '標準に戻ったのに 🧪 の面が出ない');
    });

    // ===== ZD. 原子の完全重複（0.0px）を作る経路を塞ぐ（v736。夜間監査 mix=2 で発現） =====
    //
    // 監査の生データでは C と O と O が (430.521, 281.47677262853927) に **15桁一致**で
    // 重なっていた。座標がずれたのではなく **同じ値を代入していた**。入口は
    // 「原子1個の移動ドラッグを離した瞬間」で、`getSnappedCoords` が失敗時に返す x/y
    // （noSpace のときは**吸着元の原子そのものの座標**、ベンゼンのガイド点のときは
    // すでに別の原子が座っている点）をそのまま代入していた。
    // 新規配置・モジュール配置・分子ごとの移動は同じ規則で弾いていたのに、
    // ここだけが素通しだった。

    /** 分子内の重原子どうしの最短距離（自動水素は描画時に決まるので数えない） */
    const minHeavyGap = (mol) => {
        const a = mol.atoms.filter(z => z.element !== 'H');
        let min = Infinity, pair = null;
        for (let i = 0; i < a.length; i++) {
            for (let j = i + 1; j < a.length; j++) {
                const d = Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
                if (d < min) { min = d; pair = `${a[i].element}-${a[j].element}`; }
            }
        }
        return { min, pair };
    };

    /**
     * 再現の下ごしらえ:
     *   ①ベンゼン環を置く（環原子は「素の原子で移動ドラッグができる」唯一の存在。
     *     鎖の原子は同元素タップ＝削除・異元素タップ＝置換に取られるため）
     *   ②上下左右がすべて塞がれた中央炭素を作る
     *     → その点での `getSnappedCoords` は候補方向ゼロ＝ noSpace になり、
     *       **中央炭素そのものの座標**を x/y に載せて返す
     * 戻り値は「ドラッグする環原子」と「落とす先」。
     */
    const setupZeroDistanceTrap = (c) => {
        c.reset();
        const g = c.game, W = c.W;
        g.userMolecule = new W.Molecule();
        g.history = []; g.redoStack = [];
        g.selectedTool = 'select'; g.selectedModule = null; g.selectedAtomType = 'C';
        g.placeModule('benzene', 700, 500, null);
        const m = g.userMolecule;
        const ring = m.atoms.filter(a => a.benzeneCenter);
        const c2 = m.addAtom('C', 420, 294);
        const c1 = m.addAtom('C', 378, 294);
        const c3 = m.addAtom('C', 462, 294);
        m.addBond(c1.id, c2.id, 1);
        m.addBond(c2.id, c3.id, 1);
        m.addAtom('O', 420, 252);   // 上を塞ぐ（結合はしていない別の分子）
        m.addAtom('O', 420, 336);   // 下を塞ぐ
        g.updateDrawing();
        return { g, W, drag: ring[0], target: { x: 420, y: 294 } };
    };

    const dragAtomTo = (c, atom, to) => {
        c.svg.dispatchEvent(c.pe('pointerdown', c.toClient(atom.x, atom.y)));
        c.svg.dispatchEvent(c.pe('pointermove', c.toClient(to.x, to.y)));
        c.W.dispatchEvent(c.pe('pointerup', c.toClient(to.x, to.y)));
    };

    test('ZD1: 原子の移動ドラッグは「置けない位置」へ落とせない（0.0px の完全重複を作らない）', async (c) => {
        const { g, drag, target } = setupZeroDistanceTrap(c);
        // 前提の確認: この点の吸着結果は noSpace で、x/y は**中央炭素と同じ値**
        const snap = g.getSnappedCoords(c.toClient(target.x, target.y));
        assert(snap.noSpace === true, 'この配置で noSpace にならない（前提が崩れている）');
        assert(snap.x === target.x && snap.y === target.y,
            `noSpace の x/y が吸着元の座標でない（${snap.x},${snap.y}）＝ 罠の形が変わった`);

        const before = { x: drag.x, y: drag.y };
        dragAtomTo(c, drag, target);
        await c.tick(20);

        const gap = minHeavyGap(g.userMolecule);
        assert(gap.min > 0, `原子が完全に重なった（${gap.pair} が 0.0px）`);
        // 症状を後から散らすのではなく「置かない」こと。掴んだ原子は元の位置に残る
        assert(drag.x === before.x && drag.y === before.y,
            `置けない位置なのに原子が動いた（${drag.x},${drag.y}）`);
        // 分子ごとの移動（moveComponentBy）と同じしきい値まで守れているか
        assert(gap.min >= c.W.GRID_SIZE * 0.65 - 0.001,
            `重原子どうしが ${gap.min.toFixed(1)}px まで寄った（27.3px 以上を期待）`);
    });

    test('ZD2: 否定対照 —— 落下先の間隔チェックを外すと ZD1 の 0.0px が必ず戻る', async (c) => {
        const { g, drag, target } = setupZeroDistanceTrap(c);
        const orig = g.canDropAtomAt;
        assert(typeof orig === 'function', 'canDropAtomAt が無い（直しが入っていない）');
        // ここが空振り防止の要。**判定を無効化したら赤くなる**ことを確かめて、
        // ZD1 の緑が「検査が何も見ていないだけ」ではないことを保証する
        g.canDropAtomAt = () => true;
        try {
            dragAtomTo(c, drag, target);
            await c.tick(20);
            const gap = minHeavyGap(g.userMolecule);
            assert(gap.min === 0,
                `判定を外しても重複しない（最短 ${gap.min.toFixed(3)}px）＝ ZD1 は空振りの緑`);
            assert(drag.x === target.x && drag.y === target.y,
                '判定を外しても原子が落とし先へ動かない＝ 再現経路が変わっている');
        } finally {
            g.canDropAtomAt = orig;
            g.userMolecule = new c.W.Molecule();
            g.updateDrawing();
        }
    });

    /* ===== リボン統合 第4段（§9 第4段・§7） =====
       この段の核心はただ1つ ——「**解いて → 開いて → 押す**」にしないこと。
       パズルの筋書きは「お題を読む → キャンバスで組む → 判定を押す」で、
       お題は組んでいるあいだずっと見えていなければならない（§7-1）。
       RB9 がそれを3つの画面幅で機械に見張らせる。 */

    test('RB9: パズル中、Puzzle モーダルを閉じたままお題名・分子式・構造判定が見えている', async (c) => {
        // §7 の核心。ここが崩れたら案A（お題ストリップ）を選んだ意味が無くなる
        for (const [w, h] of [[320, 568], [375, 812], [1280, 800]]) {
            await withViewport(w, h, (W, D, name) => {
                const g = W.game;
                g.setMode('puzzle');
                const modal = D.getElementById('puzzle-modal');
                assert(modal, `${name}: #puzzle-modal が無い`);
                // ① モーダルは閉じている（setMode は開けない ＝ 開くのは人がタイルを押したときだけ）
                assert(modal.classList.contains('hidden'),
                    `${name}: パズルに入っただけで Puzzle モーダルが開いている`);
                // ② それでも お題名・分子式・構造判定・お手本 が見えている
                const strip = D.getElementById('work-strip');
                assert(strip && !strip.classList.contains('hidden'), `${name}: 作業帯が出ていない`);
                ['target-name', 'target-formula', 'btn-verify', 'btn-show-target'].forEach(id => {
                    const el = D.getElementById(id);
                    assert(el, `${name}: #${id} が消えている（id を消さない不変条件）`);
                    assert(strip.contains(el), `${name}: #${id} が作業帯のお題ストリップの外にある`);
                    const r = el.getBoundingClientRect();
                    assert(r.width > 0 && r.height > 0,
                        `${name}: #${id} が見えていない（${Math.round(r.width)}×${Math.round(r.height)}）`);
                });
                // ③ 押しものは 32px の床を守る（§2-5）
                ['btn-verify', 'btn-show-target', 'ws-target-head'].forEach(id => {
                    const r = D.getElementById(id).getBoundingClientRect();
                    assert(r.height >= 32,
                        `${name}: #${id} が ${Math.round(r.width)}×${Math.round(r.height)}（32px の床を割っている）`);
                });
                // ④ 帯はキャンバスの下端に貼り付き、半分以上は覆わない（§16-3 の新しい上限）
                const wrap = D.getElementById('svg-wrapper').getBoundingClientRect();
                const sb = strip.getBoundingClientRect();
                assert(Math.abs(sb.bottom - wrap.bottom) <= 2,
                    `${name}: お題ストリップがキャンバス下端に貼り付いていない`);
                assert(sb.height < wrap.height / 2,
                    `${name}: お題ストリップがキャンバスの半分以上（${Math.round(sb.height)}/${Math.round(wrap.height)}）を覆っている`);
                // ⑤ 説明文は**帯に入れない**（48px の1段に入らない・§7-4）。読みたい人はモーダルで
                const desc = D.getElementById('target-desc');
                assert(desc && modal.contains(desc), `${name}: #target-desc が Puzzle モーダルの中に無い`);
                assert(!strip.contains(desc), `${name}: 説明文が帯に入っている（帯が厚くなる）`);
                // ⑥ 見出しをタップすると Puzzle モーダルが開く ＝ 説明へ**1手で**戻れる
                D.getElementById('ws-target-head').click();
                assert(!modal.classList.contains('hidden'),
                    `${name}: お題ストリップの見出しをタップしても Puzzle モーダルが開かない`);
                D.getElementById('btn-puzzle-close').click();
                assert(modal.classList.contains('hidden'), `${name}: 「閉じる」で Puzzle モーダルが閉じない`);
                // ⑦ 本体が横に伸びていない
                assert(D.documentElement.scrollWidth <= D.documentElement.clientWidth + 1,
                    `${name}: お題ストリップのせいで本体が横スクロールしている`);
            });
        }
    });

    test('RB10: 作業帯の「構造判定」を押すと、いままでと同じ判定結果が出る', async (c) => {
        // **判定ロジックは1行も変えていない**（第4段の不変条件）。変えたのは押す場所だけ。
        // ⚠ #verify-result は verifyCurrentStructure が直接書き、#canvas-toast は showToast の
        //    行き先。**2つの sink の契約はどちらも移設前のまま**であることを両方見る
        c.reset();
        const D = c.D, W = c.W, g = c.game;
        const saved = g.currentStageIndex;
        const btn = D.getElementById('btn-verify');
        assert(D.getElementById('work-strip').contains(btn), '構造判定が作業帯に無い');
        assert(g.btnVerify === btn, 'game.btnVerify が移設後のボタンを指していない');
        const vr = D.getElementById('verify-result');
        const toast = D.getElementById('canvas-toast');
        const wait = () => new Promise(r => setTimeout(r, 1100));  // 判定は 800ms の演出後
        try {
            g.setMode('puzzle');
            const idx = W.STAGES.findIndex(s => s.name === '水');
            assert(idx >= 0, '「水」のステージが無い');
            g.loadStage(idx);

            // ① 不一致 … 空のキャンバスで押す
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            btn.click();
            await wait();
            assert(!vr.classList.contains('hidden') && vr.className.includes('error'),
                `不一致なのに #verify-result が error にならない（${vr.className}）`);
            assert(/不一致/.test(vr.textContent), `不一致の文面が出ない（${vr.textContent}）`);

            // ② 正解 … お題どおり組んで押す（同じボタン・同じ判定）
            g.selectedAtomType = 'O';
            c.clickAt(400, 300);
            btn.click();
            await wait();
            assert(vr.className.includes('success'),
                `正解なのに #verify-result が success にならない（${vr.className}）`);
            assert(/正解/.test(vr.textContent), `正解の文面が出ない（${vr.textContent}）`);
            // ⚠ 勝利モーダルは判定（800ms）の**さらに 1200ms 後**に出る（showWinModal の演出）
            await new Promise(r => setTimeout(r, 1400));
            assert(!D.getElementById('win-modal').classList.contains('hidden'),
                '正解しても #win-modal が出ない（お題の連続プレイの道が塞がる）');
            // ⚠ 連続プレイは #win-modal の「次のステージへ」で行う ＝
            //    問題を替えるのに Puzzle モーダルを開き直す必要はない（§9 第4段の注）
            assert(D.getElementById('btn-next-stage'), '「次のステージへ」が無い');
            D.getElementById('win-modal').classList.add('hidden');

            // ③ もう一方の sink（#canvas-toast）も従来どおり。showToast は両方へ書く
            g.showToast('RB10 の確認', 1500, 'success');
            assert(toast.textContent === 'RB10 の確認' && !toast.className.includes('hidden'),
                'キャンバス内トーストが出ない');
            assert(vr.textContent === 'RB10 の確認', '#verify-result にトーストが出ない');
        } finally {
            [...D.querySelectorAll('.modal-overlay')].forEach(m => m.classList.add('hidden'));
            g.userMolecule = new W.Molecule();
            g.updateDrawing();
            g.loadStage(saved);
            g.setMode('free');
        }
    });

    test('RB11: 化合物名チップが PC でも出る（`.mobile-only` を外した）', async (c) => {
        // §5-2 の 41。名前・分子式は右パネルの「🔍 いま描いている分子」にしか無く、
        // PC でも視線がキャンバスから離れていた。右パネルは第5段で消えるので、
        // ここが名前の**常設の置き場所**になる
        const chip = c.D.getElementById('mobile-name-chip');
        assert(chip, '化合物名チップが無い');
        assert(!chip.classList.contains('mobile-only'),
            'チップに .mobile-only が残っている（PC で出ない）');
        // 共有の iframe は幅が広い（＝ PC レイアウト）。ここで出ることが「PC でも出る」の証明
        c.reset();
        c.game.setMode('free');
        c.game.summonMolecule('エタノール');
        assert(c.W.getComputedStyle(chip).display !== 'none', 'PC でチップが display:none');
        assert(chip.getClientRects().length > 0, 'PC でチップの矩形が出ない');
        assert(/エタノール/.test(chip.textContent) && /C₂H₆O/.test(chip.textContent),
            `PC のチップに名称と分子式が出ない（${chip.textContent}）`);
        // 帯とぶつからない（--work-strip-h ぶん上へ逃げる）。パズルではお題ストリップが出る
        c.game.setMode('puzzle');
        const strip = c.D.getElementById('work-strip').getBoundingClientRect();
        const cr = chip.getBoundingClientRect();
        assert(cr.bottom <= strip.top + 1,
            `チップ（下端 ${Math.round(cr.bottom)}）がお題ストリップ（上端 ${Math.round(strip.top)}）に重なる`);
        c.game.userMolecule = new c.W.Molecule();
        c.game.updateDrawing();
        c.game.setMode('free');
    });

    test('RB12: 🧩 パズルタイルはリボンの中にあり、押すと Puzzle モーダルが開く（重複なし）', async (c) => {
        c.reset();
        const D = c.D, g = c.game;
        const tile = D.querySelector('.canvas-header .mode-tab[data-mode="puzzle"]');
        assert(tile, '🧩 パズルタイルがリボン（.canvas-header）の中に無い');
        // **移設**であって複製ではない（複製すると .active が2箇所で点き、
        // 台本の `.mode-tab[data-mode="puzzle"]` がどちらを指すか DOM 順まかせになる）
        assert(D.querySelectorAll('.mode-tab[data-mode="puzzle"]').length === 1,
            '🧩 パズルタブが2つある（リボンへ移設したのに複製が残っている）');
        assert(tile.querySelector('.tile-icon') && tile.querySelector('.tile-label'),
            '🧩 タイルがアイコン＋短ラベルの2段になっていない');
        const r = tile.getBoundingClientRect();
        assert(r.width >= 32 && r.height >= 32,
            `🧩 タイルが ${Math.round(r.width)}×${Math.round(r.height)}（32px の床を割っている）`);

        const modal = D.getElementById('puzzle-modal');
        g.setMode('free');
        assert(modal.classList.contains('hidden'), '最初から Puzzle モーダルが開いている');
        try {
            tile.click();
            assert(g.currentMode === 'puzzle', '🧩 タイルで puzzle モードにならない');
            assert(!modal.classList.contains('hidden'), '🧩 タイルで Puzzle モーダルが開かない');
            assert(tile.classList.contains('active'), 'パズル中なのに 🧩 タイルが点灯しない');
            // 中身は右パネルから**そのまま**移ってきている（id・内部構造は無改変）
            ['select-series', 'select-stage', 'target-desc', 'puzzle-howto', 'btn-give-up',
             'check-judge-asymmetric', 'check-read-stereo', 'btn-back-to-free'].forEach(id => {
                assert(modal.contains(D.getElementById(id)), `${id} が Puzzle モーダルの中に無い`);
            });
            // 枠は縦スクロール（320px 幅で 894px ある）
            assert(c.W.getComputedStyle(modal.querySelector('.modal-content')).overflowY === 'auto',
                'Puzzle モーダルの枠が縦スクロールしない');
            // ⚠ 判定オプションのスイッチは**押しても閉じない**（2つ続けて切りたい設定）
            const sw = D.getElementById('check-judge-asymmetric');
            const savedJA = sw.checked;
            sw.checked = !savedJA;
            sw.dispatchEvent(new c.W.Event('change', { bubbles: true }));
            assert(!modal.classList.contains('hidden'),
                '判定オプションを切り替えただけで Puzzle モーダルが閉じる');
            sw.checked = savedJA;
            sw.dispatchEvent(new c.W.Event('change', { bubbles: true }));
            // お題（select）を替えたら**閉じてキャンバスへ返す**（Study と同じ作法）
            const ss = D.getElementById('select-stage');
            const opts = [...ss.options];
            if (opts.length > 1) {
                ss.value = opts[1].value;
                ss.dispatchEvent(new c.W.Event('change', { bubbles: true }));
                assert(modal.classList.contains('hidden'),
                    'お題を選んでも Puzzle モーダルが閉じない（キャンバスが見えない）');
            }
        } finally {
            [...D.querySelectorAll('.modal-overlay')].forEach(m => m.classList.add('hidden'));
            g.loadStage(0);
            g.setMode('free');
        }
        assert(modal.classList.contains('hidden'), 'パズルを離れても Puzzle モーダルが残る');
    });

    test('RB13: 右パネルとシートの一式が DOM に無い（否定対照つき・第5段）', async (c) => {
        c.reset();
        const D = c.D, W = c.W;
        // ⚠ **空振りの緑を避ける**。「無い」を主張するテストは、セレクタの綴りを間違えても
        //    常に null で通ってしまう。**同じ数え方**で「消していないものは見つかる」ことも見る
        const removed = ['right-panel', 'mobile-sheet-toggle', 'sheet-close', 'sheet-backdrop'];
        const kept = ['work-strip', 'ws-free', 'ws-puzzle', 'summon-input', 'reaction-card',
            'btn-molecule-modal', 'compound-info', 'compound-name', 'compound-formula',
            'verify-result', 'mode-tabs', 'mobile-name-chip', 'canvas-toast', 'btn-verify'];
        const goneCount = removed.filter(id => D.getElementById(id) === null).length;
        const keptCount = kept.filter(id => D.getElementById(id) !== null).length;
        assert(goneCount === removed.length,
            `消したはずの器が残っている: ${removed.filter(id => D.getElementById(id)).join(' / ')}`);
        assert(keptCount === kept.length,
            `否定対照が壊れている（消していない器が見つからない）: ${
                kept.filter(id => !D.getElementById(id)).join(' / ')}` +
            ' ＝ このテストは「無いこと」を主張できていない');

        // `body.sheet-open` の層そのものが消えている（クラスも、それを見る CSS 規則も）
        assert(!W.document.body.classList.contains('sheet-open'), 'body に sheet-open が付いたまま');
        let sheetRules = 0, stripRules = 0;
        for (const sheet of D.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
            // ⚠ **`r.cssRules` の有無で「入れ子かどうか」を決めない。** CSS Nesting 対応後の
            //    Chrome では**ふつうの style rule も空の cssRules を持つ**ので、それで振り分けると
            //    本体の規則を1つも数えないまま「0件」になる（＝ 空振りの緑になりかけた実例）
            const walk = (list) => {
                for (const r of list) {
                    const sel = r.selectorText || '';
                    if (sel) {
                        if (/sheet-open|#right-panel|#mobile-sheet-toggle|#sheet-close|#sheet-backdrop/.test(sel)) sheetRules++;
                        if (/\.work-strip/.test(sel)) stripRules++;  // 否定対照: 走査そのものは効いている
                    }
                    if (r.cssRules && r.cssRules.length) walk(r.cssRules);
                }
            };
            walk(rules);
        }
        assert(stripRules > 0, 'CSSOM の走査が空振りしている（.work-strip の規則すら見つからない）');
        assert(sheetRules === 0, `シート/右パネル向けの CSS 規則が ${sheetRules} 件残っている`);

        // 移設先: 右パネルにあった最後の2つは作業帯の 🧪 の面にいる
        const wsFree = D.getElementById('ws-free');
        assert(wsFree.contains(D.getElementById('summon-input')) &&
               wsFree.contains(D.getElementById('btn-molecule-modal')),
            '名称呼び出し／🔬 調べる が 🧪 標準の面に移っていない');
    });

    test('RB14: setMode の3値が変わらず、知らない値は free に落ちる（game.js の契約）', async (c) => {
        c.reset();
        const D = c.D, g = c.game;
        const saved = g.currentMode;
        try {
            // (1) 3値はすべて受け付けられ、リボンのタイルが1つだけ点く
            for (const m of ['puzzle', 'learn', 'free']) {
                g.setMode(m);
                assert(g.currentMode === m, `setMode('${m}') が効かない`);
                const on = [...D.querySelectorAll('.mode-tab')].filter(t => t.classList.contains('active'));
                assert(on.length === 1 && on[0].dataset.mode === m,
                    `${m} で点灯しているタイルが ${on.map(t => t.dataset.mode).join(',') || 'なし'}`);
            }
            // (2) 知らない値は**標準の free**（DESIGN_entry_points.md §8b）
            for (const bad of ['そんなモードは無い', '', null, undefined, 'FREE', 0]) {
                g.setMode(bad);
                assert(g.currentMode === 'free', `${JSON.stringify(bad)} が ${g.currentMode} へ落ちる`);
            }
            // (3) §8-3 —— セレクタから `#right-panel` を外したので、**右パネルの外でも**出し分けが効く。
            //     `#compound-info`（data-modes="puzzle free"）が唯一の相手（RB13 と Q1 で数えている）
            const ci = D.getElementById('compound-info');
            assert(!D.getElementById('right-panel'), '前提が崩れている（右パネルがまだある）');
            g.setMode('learn');
            assert(ci.style.display === 'none', '学習で data-modes の出し分けが効いていない');
            for (const m of ['puzzle', 'free']) {
                g.setMode(m);
                assert(ci.style.display !== 'none', `${m} で data-modes の要素が隠れたまま`);
            }
            // (4) 作業帯の面もモードで入れ替わる（🧩 は puzzle・🧪 は free・learn では帯ごと畳む）
            const strip = D.getElementById('work-strip');
            g.setMode('free');
            assert(!D.getElementById('ws-free').classList.contains('hidden') &&
                   D.getElementById('ws-puzzle').classList.contains('hidden'),
                '標準で 🧪 の面が出ていない（または 🧩 が出たまま）');
            g.setMode('puzzle');
            assert(!D.getElementById('ws-puzzle').classList.contains('hidden') &&
                   D.getElementById('ws-free').classList.contains('hidden'),
                'パズルで 🧩 の面が出ていない（または 🧪 が出たまま）');
            g.setMode('learn');
            assert(strip.classList.contains('hidden'), '学習で作業帯が畳まれない');
        } finally {
            g.setMode(saved);
        }
    });

    test('RB15: 320px 縦・568×320 横で本体が横に伸びず、32px 未満の標的が0件', async (c) => {
        // `tools/check-mobile.mjs` と同じ観点を回帰テストにも置く（molecule_modal MM9 と同じ考え方）。
        // 右パネルが消えて**画面の中身が全部見える場所へ出た**ので、床を割る余地が増えている
        for (const [w, h] of [[320, 568], [568, 320]]) {
            await withViewport(w, h, (W, D, name) => {
                for (const mode of ['free', 'puzzle', 'learn']) {
                    W.game.setMode(mode);
                    const small = [], seen = [];
                    D.querySelectorAll('button, input, select, a, summary, [role=button]').forEach(el => {
                        const r = el.getBoundingClientRect();
                        if (r.width < 1 || r.height < 1) return;          // 隠れているものは対象外
                        const cs = W.getComputedStyle(el);
                        if (cs.visibility === 'hidden' || cs.display === 'none') return;
                        seen.push(el);
                        if (r.height < 32 || r.width < 32) {
                            small.push(`${el.id || el.className || el.tagName}:${
                                Math.round(r.width)}×${Math.round(r.height)}`);
                        }
                    });
                    // 否定対照: そもそも数えられているか（0個なら「小さいものが0件」は無意味）
                    assert(seen.length >= 10,
                        `${name}/${mode}: 見えている押しものが ${seen.length} 個しか無い（走査が空振り）`);
                    assert(small.length === 0,
                        `${name}/${mode}: 32px 未満の標的 ${small.length} 件 —— ${small.join(' ')}`);
                    assert(D.documentElement.scrollWidth <= D.documentElement.clientWidth + 1,
                        `${name}/${mode}: 本体が横スクロールしている（${
                            D.documentElement.scrollWidth} > ${D.documentElement.clientWidth}）`);
                }
                W.game.setMode('free');
            });
        }
    });

    test('RB16: 名称呼び出しが作業帯にあり、台本と同じ道で分子が出る（summon 23箇所の証明）', async (c) => {
        c.reset();
        const D = c.D, g = c.game, W = c.W;
        g.setMode('free');
        const input = D.getElementById('summon-input');
        const strip = D.getElementById('work-strip');
        assert(input && strip.contains(input), '名称呼び出しが作業帯の中に無い');
        assert(D.getElementById('ws-free').contains(input), '名称呼び出しが 🧪 標準の面に無い');
        // ① **矩形が出る**こと。これが「モーダルに入れない」理由そのもの ——
        //    `tutorial.js` の summon にはガードが無く、矩形 0 だとカーソルが (0,0) へ飛ぶ
        const r = input.getBoundingClientRect();
        assert(r.width > 0 && r.height >= 32,
            `名称呼び出しが ${Math.round(r.width)}×${Math.round(r.height)}（矩形が出ない／32px の床を割る）`);
        // ② 候補（datalist）が作られている ＝ 移設で setupSummonUI の配線が切れていない
        assert(D.getElementById('summon-list').options.length > 50,
            `候補が ${D.getElementById('summon-list').options.length} 件しか無い（datalist の配線が切れている）`);
        // ③ 台本と**同じ道**（tutorialPlayer の summon アクション）で呼び出せる
        const p = W.tutorialPlayer;
        await p.doAction({ type: 'summon', name: '酢酸' }, true);
        assert(g.userMolecule.atoms.filter(a => a.element === 'C').length === 2 &&
               g.userMolecule.atoms.filter(a => a.element === 'O').length === 2,
            `台本の summon で酢酸が出ない（C${g.userMolecule.atoms.filter(a => a.element === 'C').length}` +
            ` O${g.userMolecule.atoms.filter(a => a.element === 'O').length}）`);
        assert(D.getElementById('mobile-name-chip').textContent.includes('酢酸'),
            '呼び出した分子の名前がチップに出ない');
        // ④ 呼び出し後、入力欄は空に戻る（続けて別の分子を呼べる）
        assert(input.value === '', `呼び出した後も入力欄に "${input.value}" が残っている`);
        c.reset();
    });

    test('RB17: 化合物名チップは右パネルの表示を読み返さずに自分で組み立てる（第5段の下ごしらえ）', async (c) => {
        // §17-6 が「第5段の唯一の実装上の罠」として申し送った箇所。
        // v748 までは chip.textContent を `#compound-name` / `#compound-formula` の
        // **textContent から**作っていたので、右パネルを消した瞬間にチップが黙って空になる。
        c.reset();
        const D = c.D, g = c.game;
        g.setMode('free');
        g.summonMolecule('エタノール');
        const chip = D.getElementById('mobile-name-chip');
        assert(/エタノール/.test(chip.textContent) && /C₂H₆O/.test(chip.textContent),
            `チップに名称と分子式が出ない（${chip.textContent}）`);
        // ① 文字列は game 側が持っている（表示先ではなくモデルが正）
        assert(g.compoundLabel && g.compoundLabel.name.includes('エタノール') &&
               g.compoundLabel.formula === 'C₂H₆O',
            `game.compoundLabel が組み立てられていない（${JSON.stringify(g.compoundLabel)}）`);
        // ② **右パネルの表示を壊してもチップは壊れない** ＝ 読み返していない証明。
        //    右パネルが DOM から消えたときに起きることを、消す前にここで再現する
        const nameEl = D.getElementById('compound-name');
        const formulaEl = D.getElementById('compound-formula');
        const savedName = nameEl ? nameEl.textContent : null;
        const savedFormula = formulaEl ? formulaEl.textContent : null;
        try {
            if (nameEl) nameEl.textContent = '';
            if (formulaEl) formulaEl.textContent = '';
            g.syncMobileNameChip();
            assert(/エタノール/.test(chip.textContent) && /C₂H₆O/.test(chip.textContent),
                `右パネルの表示を空にしただけでチップが壊れた（${chip.textContent}）` +
                ' ＝ まだ textContent を読み返している');
        } finally {
            if (nameEl) nameEl.textContent = savedName;
            if (formulaEl) formulaEl.textContent = savedFormula;
        }
        // ③ 否定対照 —— モデル側を書き換えれば、チップは**ちゃんと追随する**
        //    （②が「何を渡しても同じ文字が出る」ことで通っているのではない）
        const savedLabel = g.compoundLabel;
        try {
            g.compoundLabel = { name: 'RB17 の対照', formula: 'C₉H₉' };
            g.syncMobileNameChip();
            assert(chip.textContent.includes('RB17 の対照') && chip.textContent.includes('C₉H₉'),
                `モデルを書き換えてもチップが追随しない（${chip.textContent}）`);
        } finally {
            g.compoundLabel = savedLabel;
        }
        // ④ 右パネルの控えは、updateCompoundInfo が今までどおり書く（台本の ?rec= が読む）
        g.updateCompoundInfo();
        if (nameEl) assert(nameEl.textContent.includes('エタノール'),
            `#compound-name が更新されない（${nameEl.textContent}）`);
        if (formulaEl) assert(formulaEl.textContent === 'C₂H₆O',
            `#compound-formula が更新されない（${formulaEl.textContent}）`);
        c.reset();
    });

    // ===== 実行ハーネス =====

    async function run() {
        const summary = document.getElementById('summary');
        const list = document.getElementById('results');
        const frame = document.getElementById('app-frame');

        // iframe内のアプリ初期化の完了を待つ（appReady = 全データロード済み。
        // game/reactionPlayerの存在だけではreactions.jsonのロード完了前に走り出す競合があった）
        summary.textContent = 'アプリの初期化を待機中...';
        for (let i = 0; i < 200; i++) {
            if (frame.contentWindow && frame.contentWindow.appReady) break;
            await new Promise(r => setTimeout(r, 100));
        }
        if (!frame.contentWindow || !frame.contentWindow.appReady) {
            summary.className = 'fail';
            summary.textContent = '❌ アプリが初期化されません（ローカルサーバー経由で開いていますか？）';
            return;
        }

        const ctx = makeCtx(frame);
        let passed = 0;
        for (const t of tests) {
            const li = document.createElement('li');
            li.textContent = t.name;
            try {
                await t.fn(ctx);
                li.className = 'pass';
                passed++;
            } catch (e) {
                li.className = 'fail';
                const detail = document.createElement('span');
                detail.className = 'detail';
                detail.textContent = e.message;
                li.appendChild(detail);
            }
            list.appendChild(li);
            summary.textContent = `実行中... ${list.children.length}/${tests.length}`;
        }
        ctx.reset();
        const ok = passed === tests.length;
        summary.className = ok ? 'pass' : 'fail';
        summary.textContent = ok
            ? `✅ 全 ${tests.length} テスト合格`
            : `❌ ${tests.length - passed} 件失敗（${passed}/${tests.length} 合格）`;
    }

    window.addEventListener('load', run);
})();
