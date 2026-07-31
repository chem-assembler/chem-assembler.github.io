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
        assert(cap.includes('不斉炭素です'), '不斉炭素の説明がない');
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
        assert(cap2.includes('不斉炭素ではありません'), 'メタンで不斉否定の説明がない');
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

    test('R5: チュートリアルのシート連動（P11 M3）— 右パネル対象で開き・キャンバス操作で閉じる', async (c) => {
        c.reset();
        const p = c.W.tutorialPlayer;
        assert(p && typeof p.setSheetOpen === 'function' && typeof p.syncSheetFor === 'function',
            'シート連動APIがない');
        const orig = p.isMobileLayout;
        p.isMobileLayout = () => true; // モバイル判定を強制（iframeは広幅のため）
        try {
            c.W.document.body.classList.remove('sheet-open');
            // 右パネル内の要素を対象にすると開く
            await p.syncSheetFor(c.D.getElementById('mode-tabs'), true);
            assert(c.W.document.body.classList.contains('sheet-open'), '右パネル対象でシートが開かない');
            // キャンバス系アクション（hover）の前処理で閉じる
            await p.doAction({ type: 'hover', x: 400, y: 300 }, true);
            assert(!c.W.document.body.classList.contains('sheet-open'), 'キャンバス操作でシートが閉じない');
            // 右パネル外の要素（左パレット）を対象にした場合も閉じたまま
            await p.syncSheetFor(c.D.getElementById('btn-tool-bond'), true);
            assert(!c.W.document.body.classList.contains('sheet-open'), '左パレット対象でシートが開いた');
            // PC判定では何もしない
            p.isMobileLayout = () => false;
            await p.syncSheetFor(c.D.getElementById('mode-tabs'), true);
            assert(!c.W.document.body.classList.contains('sheet-open'), 'PCでシートが誤って開いた');
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
        clickRule('けん化');
        assert(g.countMolecules() === 2, `加水分解後が${g.countMolecules()}分子（2を期待）`);
        assert(nameShown().includes('酢酸') && nameShown().includes('エタノール'),
            `加水分解後が「${nameShown()}」`);
        const atoms = g.userMolecule.atoms;
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                assert(Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y) >= 24,
                    '加水分解で原子が重なった');
            }
        }
        g.undo();
        assert(nameShown().includes('酢酸エチル'), 'Undoでエステルに戻らない');

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

        // 複数分子のときは案内して開かない
        input.value = 'エタノール';
        input.dispatchEvent(new c.W.Event('change', { bubbles: true }));
        assert(g.countMolecules() === 2, '2分子にならない');
        c.D.getElementById('btn-isomers').click();
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

    test('N2: 録画モード用のSNSデモ（demos.json）が完走する（P13-2）', async (c) => {
        c.reset();
        const tp = c.W.tutorialPlayer;
        // rec.js は ?rec= のときだけ demos.json を合流させるので、テストでは自前で読む
        const res = await fetch('demos.json', { cache: 'no-cache' });
        assert(res.ok, 'demos.json が取得できない');
        const demos = await res.json();
        assert(demos.some(d => d.id === 'intro-draw'), 'intro-draw（V1台本）が登録されていない');
        demos.forEach(d => {
            if (!tp.tutorials.some(x => x.id === d.id)) tp.tutorials.push(d);
        });
        // 全SNSデモを高速再生し、座標の陳腐化を結末の分子で検出する（N1と同じ流儀）。
        // **結末を見る intro-draw は最後に回す**（demos.json の並び順に依存させない。
        // SNS動画が増えるたびに並び替えが要る作り方だと、追加のたびに落ちる）
        for (const d of demos.filter(d => d.id !== 'intro-draw')) {
            await tp.play(d.id, { fast: true, keepResult: true });
        }
        await tp.play('intro-draw', { fast: true, keepResult: true });
        // intro-draw の結末: フェノール（C₆H₆O）が画面に残っている（keepResult）
        assert(tp.lastResult && tp.lastResult.name.includes('フェノール'),
            `intro-drawの結末が「${tp.lastResult && tp.lastResult.name}」（フェノールを期待）`);
        assert(c.game.userMolecule.atoms.length > 0, 'keepResult なのに最終状態が画面に残っていない');
        assert(!c.D.getElementById('tutorial-overlay'), 'デモ終了後にオーバーレイが残っている');
        // 後片付け（keepResult は復元しないため、次のテストのために自前で消す）
        c.game.userMolecule = new c.W.Molecule();
        c.game.updateDrawing();
        tp.tutorials = tp.tutorials.filter(t => !demos.some(d => d.id === t.id));
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

    // ===== Q. モード切替（P10 M1） =====

    test('Q1: 3モードで右パネルの内容が正しく出し分けられる', async (c) => {
        c.reset();
        const g = c.game;
        const D = c.D;
        // 既定はパズル。localStorage汚染を避けるため最後にパズルへ戻す
        const rendered = (sel) => { const e = D.querySelector(sel); return !!(e && e.offsetParent !== null); };
        const wrapperHidden = (modes) => {
            const el = [...D.querySelectorAll('#right-panel [data-modes]')].find(w => w.dataset.modes === modes);
            return el && el.style.display === 'none';
        };
        assert(D.querySelectorAll('.mode-tab').length === 3, 'モードタブが3つない');

        g.setMode('puzzle');
        assert(g.currentMode === 'puzzle', 'モードがpuzzleにならない');
        assert(rendered('#btn-verify'), 'パズルで判定ボタンが出ない');
        // 項目21: 「何をするモードか」の常時案内がパズルモードに出る
        assert(rendered('#puzzle-howto') && /構造判定/.test(D.getElementById('puzzle-howto').textContent),
            'パズルで操作手順の案内が出ない');
        assert(wrapperHidden('learn') && wrapperHidden('free'), 'パズルで学習/自由が隠れていない');
        assert([...D.querySelectorAll('.mode-tab')].find(t => t.classList.contains('active')).dataset.mode === 'puzzle',
            'アクティブタブがpuzzleでない');

        g.setMode('learn');
        // 項目20: 学習タブはアコーディオン。入り口（summary）が見え、既定は折りたたみ、開くと中身が出る
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
        assert(wrapperHidden('puzzle') && wrapperHidden('free'), '学習でパズル/自由が隠れていない');
        // verify-result（トースト表示先）は全モードで存在し続ける
        assert(D.getElementById('verify-result'), '学習でverify-resultが消えた');

        g.setMode('free');
        assert(rendered('#reaction-card') && rendered('#compound-info'), '自由で反応カード/分子情報が出ない');
        assert(wrapperHidden('puzzle') && wrapperHidden('learn'), '自由でパズル/学習が隠れていない');

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

    test('R1: スマホ用シートの開閉配線とモバイル要素の存在（P11 M1）', async (c) => {
        c.reset();
        const D = c.D;
        // モバイル専用要素が存在する（表示はメディアクエリ依存なのでDOM存在を確認）
        assert(D.getElementById('mobile-sheet-toggle'), 'シート開閉トグルがない');
        assert(D.getElementById('sheet-close'), 'シート閉じるボタンがない');
        assert(D.getElementById('sheet-backdrop'), 'バックドロップがない');
        // .mobile-only クラスが付いている（PCでは display:none で隠れる）
        assert(D.getElementById('mobile-sheet-toggle').classList.contains('mobile-only'),
            'トグルに mobile-only クラスがない');

        // トグルで body.sheet-open が付き、閉じるとはずれる（viewport非依存のJS挙動）
        c.W.document.body.classList.remove('sheet-open');
        D.getElementById('mobile-sheet-toggle').click();
        assert(c.W.document.body.classList.contains('sheet-open'), 'トグルでシートが開かない');
        D.getElementById('sheet-close').click();
        assert(!c.W.document.body.classList.contains('sheet-open'), '閉じるでシートが閉じない');
        // バックドロップのタップでも閉じる
        D.getElementById('mobile-sheet-toggle').click();
        D.getElementById('sheet-backdrop').click();
        assert(!c.W.document.body.classList.contains('sheet-open'), 'バックドロップで閉じない');

        // モバイルCSSが読み込まれている（body.sheet-open で右パネルが translateY(0) になるルールがある）
        let hasRule = false;
        for (const sheet of D.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
            for (const r of rules) {
                if (r.type === 4 /* MEDIA_RULE */ && /max-width:\s*899px/.test(r.conditionText || '')) {
                    for (const rr of r.cssRules) {
                        if (rr.selectorText === 'body.sheet-open #right-panel') hasRule = true;
                    }
                }
            }
        }
        assert(hasRule, 'モバイル用のシート表示ルールが読み込まれていない');
    });

    test('R2: モバイル横レイアウトのCSSルール（P11 M2・向き別メディアクエリ）', async (c) => {
        const D = c.D;
        // 縦（portrait）と横（landscape）のブロックがそれぞれ存在し、
        // 右パネルの開閉ルール（縦=translateY / 横=translateX）が定義されている。
        // iframe のビューポートに依存しない CSSOM 検査。
        let portraitSheet = false, landscapeDrawer = false, landscapeLeftCol = false;
        for (const sheet of D.styleSheets) {
            let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
            for (const r of rules) {
                if (r.type !== 4 /* MEDIA_RULE */) continue;
                const cond = r.conditionText || '';
                if (!/max-width:\s*899px/.test(cond)) continue;
                const isPortrait = /orientation:\s*portrait/.test(cond);
                const isLandscape = /orientation:\s*landscape/.test(cond);
                for (const rr of r.cssRules) {
                    if (rr.selectorText === 'body.sheet-open #right-panel') {
                        if (isPortrait && /translateY\(0/.test(rr.style.transform)) portraitSheet = true;
                        if (isLandscape && /translateX\(0/.test(rr.style.transform)) landscapeDrawer = true;
                    }
                    if (isLandscape && rr.selectorText === '#left-panel' && rr.style.width) {
                        landscapeLeftCol = true;
                    }
                }
            }
        }
        assert(portraitSheet, '縦向きの下シート表示ルールがない');
        assert(landscapeDrawer, '横向きの右ドロワー表示ルールがない');
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
            .map(t => t.textContent).filter(s => /^[①-⑳]/.test(s));

        // 1分子では出さない（右パネルとモバイルのチップで足りており、図を邪魔するだけ）
        setup(1);
        assert(canvasLabels().length === 0, '1分子なのに図に見出しが出ている');
        assert(!/^[①-⑳]/.test(D.getElementById('compound-name').textContent),
            '1分子なのに右パネルに番号が付いている');

        // 2分子で図と右パネルの両方に同じ番号が出る
        setup(2);
        const labels = canvasLabels();
        assert(typeof W.moleculeMark === 'function', 'moleculeMark が公開されていない');
        assert(labels.length === 2, `図の見出しが ${labels.length} 個（2個を期待）`);
        assert(labels.some(s => s.startsWith('①')) && labels.some(s => s.startsWith('②')),
            `見出しの番号が①②になっていない（${labels.join(' / ')}）`);
        labels.forEach(s => assert(!/^[ABC]\b/.test(s), '元素記号とぶつかる A/B/C を使っている'));
        const panel = D.getElementById('compound-name').textContent;
        assert(/①/.test(panel) && /②/.test(panel), `右パネルに番号が反映されていない（${panel}）`);
        // 図の見出しは各分子の下にある
        const parts = g.splitMolecules();
        parts.forEach((p, i) => {
            const maxY = Math.max(...p.atoms.filter(a => a.element !== 'H').map(a => a.y));
            const t = [...c.svg.querySelectorAll('text')].find(x => x.textContent.startsWith(W.moleculeMark(i)));
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
        const D = c.D;
        // 横向きブロックに: header絶対配置・ロゴ非表示・canvas-header絶対配置・座標表示非表示
        let headerAbs = false, logoHidden = false, ribbonAbs = false, coordHidden = false;
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
                    if (rr.selectorText === '#coord-display' && rr.style.display === 'none') coordHidden = true;
                }
            }
        }
        assert(headerAbs, '横向きでヘッダーがオーバーレイ化されていない');
        assert(logoHidden, '横向きでロゴが非表示になっていない');
        assert(ribbonAbs, '横向きでキャンバスリボンがオーバーレイ化されていない');
        assert(coordHidden, '横向きで座標表示が非表示になっていない');
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

        // --- トグル ON（既定）: 立体が名前に出る ---
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

        // (f) 立体未指定（斜め描き）ではローテーション・鏡像比較を行わない
        const off = buildLactate(30, -30);
        openStereo(off.m, off.center);
        assert(sv._viewSlots === null, '立体未指定なのに並べ替え状態を持っている');
        assert(D.getElementById('btn-stereo-wedge-mirror').disabled &&
               D.getElementById('btn-stereo-wedge-reset').disabled,
            '立体未指定でくさび図の操作ボタンが無効化されない');
        assert(!D.querySelector('#stereo-svg .wedge-slot.clickable'),
            '立体未指定なのにクリックできる見た目になっている');
        const noteOff = D.getElementById('stereo-wedge-note').textContent;
        assert(noteOff.includes('並べ替え') && noteOff.includes('立体が指定されていない'),
            '立体未指定で操作できない理由の説明が出ない');
        const upOff = paneLabel('left', 'up');
        clickSlot('left', 'down');
        assert(paneLabel('left', 'up') === upOff, '立体未指定なのに並べ替わってしまった');

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
        assert(sv._viewSlots === null, '斜め描きなのにスロットが読めている（前提が崩れている）');
        assert(D.getElementById('stereo-wedge-layout-row').classList.contains('hidden'),
            '立体未指定なのに配置モードの行が出ている');
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
            // エステルの加水分解。酸無水物は形が同じ（-CO-O-）だが別の反応なので混ぜない
            { name: '酢酸エチル', must: ['hydrolysis_ester'], never: ['dehydration_intra', 'hydrolysis_anhydride'] },
            { name: '無水酢酸', must: ['hydrolysis_anhydride'], never: ['hydrolysis_ester'] },
            { name: '無水フタル酸', must: ['hydrolysis_anhydride'], never: ['hydrolysis_ester'] },
            // アセチル化はフェノールの -OH とアミンの -NH₂ に。**アミドの N には出さない**
            //（アセトアニリドはアニリンをアセチル化した生成物。さらにアセチル化はできない）
            { name: 'アニリン', must: ['acetylation_anhydride'], never: [] },
            { name: 'アセトアニリド', must: [], never: ['acetylation_anhydride'] },
            { name: '尿素', must: [], never: ['acetylation_anhydride'] },
            { name: 'アセトアミド', must: [], never: ['acetylation_anhydride'] },
            { name: 'ε-カプロラクタム', must: [], never: ['acetylation_anhydride'] },
            // パラセタモールはフェノールの -OH だけが対象（アミドの N は対象外）
            { name: 'パラセタモール', must: ['acetylation_anhydride'], never: [] },
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
