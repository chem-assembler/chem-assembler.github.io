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
            if (W.reactionPlayer && W.reactionPlayer.active) W.reactionPlayer.exit();
            g.loadStage(0);
            g.selectedTool = 'select';
            g.selectedAtomType = 'C';
            g.asymmetricMode = false;
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
        c.game.placeModule('cyclohexane', 400, 300, null);
        c.clickAt(400, 216);
        const s1 = c.game.userMolecule.atoms[6];
        assert(s1 && near(s1.x, 400) && near(s1.y, 216), '1本目が二等分線上に配置されない');
    });

    test('D5: 側鎖2本目は±30°振り分け・枝が平行移動で追随・Undo一括', async (c) => {
        c.reset();
        c.game.placeModule('cyclohexane', 400, 300, null);
        const v0 = c.game.userMolecule.atoms.find(a => near(a.x, 400, 1) && near(a.y, 258, 1));
        c.clickAt(400, 216); // S1
        const s1 = c.game.userMolecule.atoms[6];
        c.clickAt(400, 174); // S2（S1の枝）
        const s2 = c.game.userMolecule.atoms[7];
        c.clickAt(426, 246); // 2本目（-60°側）
        const newAtom = c.game.userMolecule.atoms[8];
        assert(newAtom && near(newAtom.x, 421) && near(newAtom.y, 221.6), '新原子が-60°側に配置されない');
        assert(near(s1.x, 379) && near(s1.y, 221.6), '既存側鎖が-120°側へ振り分けられない');
        assert(near(s2.x - s1.x, 0, 1) && near(s2.y - s1.y, -42, 1), '枝の相対位置が崩れた');
        assert(c.game.userMolecule.getBond(v0.id, s1.id) && c.game.userMolecule.getBond(v0.id, newAtom.id),
            '振り分けで結合が壊れた');
        c.game.undo();
        assert(near(c.game.userMolecule.atoms[6].x, 400, 1) && c.game.userMolecule.atoms.length === 8,
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

        // 未収録構造（オキシラン: C-C-O 三員環）→ 該当なし＋分子式は表示
        c.game.userMolecule = new c.W.Molecule();
        const a1 = c.game.userMolecule.addAtom('C', 380, 300);
        const a2 = c.game.userMolecule.addAtom('C', 422, 300);
        const a3 = c.game.userMolecule.addAtom('O', 400, 264);
        c.game.userMolecule.addBond(a1.id, a2.id, 1);
        c.game.userMolecule.addBond(a2.id, a3.id, 1);
        c.game.userMolecule.addBond(a3.id, a1.id, 1);
        c.game.updateDrawing();
        assert(nameEl() === '（ライブラリに該当なし）', `未収録構造が「${nameEl()}」と判定`);
        assert(formulaEl() === 'C₂H₄O', `オキシランの分子式が「${formulaEl()}」`);
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

    // ===== 実行ハーネス =====

    async function run() {
        const summary = document.getElementById('summary');
        const list = document.getElementById('results');
        const frame = document.getElementById('app-frame');

        // iframe内のアプリ初期化（game / reactionPlayer）を待つ
        summary.textContent = 'アプリの初期化を待機中...';
        for (let i = 0; i < 200; i++) {
            if (frame.contentWindow && frame.contentWindow.game && frame.contentWindow.reactionPlayer) break;
            await new Promise(r => setTimeout(r, 100));
        }
        if (!frame.contentWindow || !frame.contentWindow.game) {
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
