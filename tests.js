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

        // 同じ化合物？クイズ: シリーズ絞り込みで出題が範囲内に限定される
        const seriesOf = new Map(quiz.library.map(e => [e.name, e.series]));
        quiz.open();
        quiz.seriesEl.value = '飽和炭化水素';
        quiz.computePools();
        for (let k = 0; k < 15; k++) {
            quiz.nextQuestion();
            assert(seriesOf.get(quiz.current.nameA) === '飽和炭化水素' &&
                   seriesOf.get(quiz.current.nameB) === '飽和炭化水素',
                `絞り込み外の出題: ${quiz.current.nameA} / ${quiz.current.nameB}`);
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
        nq.seriesEl.value = '有名な慣用名（芳香族）';
        nq.computePool();
        for (let k = 0; k < 10; k++) {
            nq.nextQuestion();
            assert(nq.current.entry.series === '有名な慣用名（芳香族）',
                `絞り込み外の出題: ${nq.current.entry.name}`);
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

    test('G3: 任意員環はprompt無しのモーダル選択で配置（7員環・キャンセル）', async (c) => {
        c.reset();
        c.game.selectedTool = 'select';
        c.game.selectedModule = 'n-ring';
        c.clickAt(400, 300);
        assert(!c.D.getElementById('nring-modal').classList.contains('hidden'), '員数モーダルが開かない');
        const btn7 = [...c.D.getElementById('nring-choices').children].find(b => b.textContent === '7員環');
        btn7.click();
        assert(c.game.userMolecule.atoms.length === 7 && c.game.userMolecule.bonds.length === 7,
            `7員環が作られない（原子${c.game.userMolecule.atoms.length}・結合${c.game.userMolecule.bonds.length}）`);
        // キャンセル経路: 何も追加されない
        c.game.selectedModule = 'n-ring';
        c.clickAt(400, 300);
        c.D.getElementById('btn-nring-cancel').click();
        assert(c.game.userMolecule.atoms.length === 7, 'キャンセルしたのに原子が増えた');
        assert(c.D.getElementById('nring-modal').classList.contains('hidden'), 'モーダルが閉じない');
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

        // 選択モード → 不斉炭素C2をクリック → モーダルにくさび図と説明
        c.D.getElementById('btn-stereo').click();
        assert(sv.picking, '選択モードにならない');
        c.clickAt(337, 300);
        assert(!sv.picking, '選択モードが解除されない');
        assert(!c.D.getElementById('stereo-modal').classList.contains('hidden'), 'モーダルが開かない');
        const cap = c.D.getElementById('stereo-caption').textContent;
        assert(cap.includes('109.5'), '結合角109.5°の説明がない');
        assert(cap.includes('不斉炭素です'), '不斉炭素の説明がない');
        assert(c.D.querySelectorAll('#stereo-svg text').length >= 5, 'くさび図のラベルが不足'); // 中心C+置換基4
        assert(c.D.querySelectorAll('#stereo-svg polygon').length === 1, '手前くさびが描かれない');
        c.D.getElementById('btn-stereo-close').click();
        assert(c.D.getElementById('stereo-modal').classList.contains('hidden'), 'モーダルが閉じない');

        // 非sp3（ベンゼン環の炭素）は拒否してトースト表示、モーダルは開かない
        c.game.userMolecule = new c.W.Molecule();
        c.game.placeModule('benzene', 400, 300, null);
        c.game.updateDrawing();
        c.D.getElementById('btn-stereo').click();
        const ring0 = c.game.userMolecule.atoms[0];
        c.clickAt(ring0.x, ring0.y);
        assert(c.D.getElementById('stereo-modal').classList.contains('hidden'), '非sp3でモーダルが開いた');
        assert(c.D.getElementById('verify-result').textContent.includes('sp3'), '拒否トーストが出ない');
        assert(!sv.picking, '拒否後に選択モードが解除されない');

        // メタン（不斉でない）: 同一置換基の説明
        c.game.userMolecule = new c.W.Molecule();
        c.game.userMolecule.addAtom('C', 400, 300);
        c.game.updateDrawing();
        c.D.getElementById('btn-stereo').click();
        c.clickAt(400, 300);
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
        // 環炭素が6箇所とも候補になるため、ハイライト後に1つクリックして確定する
        const substitute = (kw) => {
            clickRule(kw);
            assert(c.W.reactor.picking, '置換位置の選択モードにならない');
            const ring = g.userMolecule.atoms.find(a =>
                a.element === 'C' && g.userMolecule.getFreeValency(a.id) >= 1);
            c.clickAt(ring.x, ring.y);
            assert(!c.W.reactor.picking, '選択モードが解除されない');
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
        m.atoms.forEach(a => assert(m.getUsedValency(a.id) <= (c.W.VALENCIES[a.element] || 0),
            `${a.element}の価標超過`));
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

    // ===== N. チュートリアル（P9-6） =====

    test('N1: チュートリアル（FAQ・検索・3パート高速再生・完全復元）', async (c) => {
        c.reset();
        const g = c.game;
        const tp = c.W.tutorialPlayer;
        assert(tp, 'tutorialPlayer が初期化されていない');
        for (let i = 0; i < 30 && tp.tutorials.length === 0; i++) await c.tick(100);
        assert(tp.tutorials.length >= 12, `チュートリアル項目が${tp.tutorials.length}件（12以上を期待）`);
        assert(tp.tutorials.filter(t => t.answer).length >= 3, 'FAQ（テキスト項目）が3件以上ない');

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
        assert(wrapperHidden('learn') && wrapperHidden('free'), 'パズルで学習/自由が隠れていない');
        assert([...D.querySelectorAll('.mode-tab')].find(t => t.classList.contains('active')).dataset.mode === 'puzzle',
            'アクティブタブがpuzzleでない');

        g.setMode('learn');
        assert(rendered('#btn-quiz') && rendered('#reaction-box'), '学習でクイズ/機構が出ない');
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
