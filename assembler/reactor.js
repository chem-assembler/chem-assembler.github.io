/**
 * 反応実行エンジン（P9-1 M2 / 設計: DESIGN_reaction_execution.md）
 * 「⚗ この分子の反応」カードに、いま描かれている分子へ適用できる反応を列挙し、
 * 選ぶと分子グラフを書き換えて生成物へ変化させる。実行は通常の編集と同じく
 * saveState を積むので Undo/Redo がそのまま効く。名称判定カードが答え合わせを兼ねる。
 */

// ---- 共通ヘルパー ----

// 指定原子が属する連結成分（分子）の原子IDの集合
function componentOf(mol, atomId) {
    const seen = new Set([atomId]);
    const stack = [atomId];
    while (stack.length) {
        const id = stack.pop();
        mol.getNeighbors(id).forEach(n => {
            if (!seen.has(n.atom.id)) {
                seen.add(n.atom.id);
                stack.push(n.atom.id);
            }
        });
    }
    return seen;
}

/**
 * その分子が**実際に描かれている**結合の長さ（＝作図の刻み）を返す。
 *
 * 名称ライブラリ（compounds.json）の分子は 80px 刻みで登録されているのに対し、
 * GRID_SIZE は 42px。生成物を 42px 固定で置くと母体の刻みとずれ、原子が既存の
 * 結合線の上に乗って**結合線が無関係な原子を貫通する**（酢酸＋エタノール →
 * 酢酸エチルが酪酸に見える。動画レーンからの報告 video-scripts/V18.md §3）。
 *
 * 起点の原子が持つ結合を優先し（局所の刻みに合わせるのが見た目に効く）、
 * 無ければ分子全体、それも無ければ GRID_SIZE。外れ値に強いよう中央値を使う。
 */
function bondStep(mol, atomId = null) {
    const lens = [];
    const push = (b) => {
        const a1 = mol.atoms.find(a => a.id === b.atomId1);
        const a2 = mol.atoms.find(a => a.id === b.atomId2);
        if (!a1 || !a2 || a1.element === 'H' || a2.element === 'H') return;
        const d = Math.hypot(a1.x - a2.x, a1.y - a2.y);
        if (d > 1) lens.push(d);
    };
    if (atomId !== null) {
        mol.bonds.filter(b => b.atomId1 === atomId || b.atomId2 === atomId).forEach(push);
    }
    if (lens.length === 0) mol.bonds.forEach(push);
    if (lens.length === 0) return GRID_SIZE;
    lens.sort((a, b) => a - b);
    return lens[Math.floor(lens.length / 2)];
}

/**
 * 脱離した酸素を分子の外へ退避させる。結合を失ったOは自動水素で水 H₂O として描かれる
 * （反応機構データと同じ「原子は消さない」原則）。
 *
 * **とれた場所の近くから外へ向かって空きを探す**（レビュー項目15）。
 * 以前は「全原子の右端＋2マス」に置いていたので、反応を重ねるほど水が右へ右へと伸び、
 * 3回目には x=1360（そのときの視野は 238〜1312）＝**画面の外**へ出ていた。
 * 反応のたびに視野を合わせ直すとキャンバスが跳ねるので、置き場の方を近くにする。
 * どの反応で出た水かも読めるようになる。
 */
function parkAsWater(mol, oId) {
    const o = mol.atoms.find(a => a.id === oId);
    const others = mol.atoms.filter(a => a.id !== oId && a.element !== 'H');
    if (!o || others.length === 0) return;
    const G = bondStep(mol);
    const KEEP = G * 1.5;  // 別の分子として読める間隔
    const bonds = mol.bonds
        .filter(b => b.atomId1 !== oId && b.atomId2 !== oId)
        .map(b => [mol.atoms.find(a => a.id === b.atomId1), mol.atoms.find(a => a.id === b.atomId2)])
        .filter(([a, b]) => a && b);
    const cands = [];
    for (let i = -8; i <= 8; i++) {
        for (let j = -8; j <= 8; j++) {
            const d = Math.hypot(i, j);
            if (d < 1.5 || d > 8) continue;
            cands.push({ x: o.x + i * G, y: o.y + j * G, d });
        }
    }
    cands.sort((p, q) => p.d - q.d);
    // 原子から離れているだけでは足りない。伸ばした結合の上に乗ると構造式が別物に見えるので、
    // 結合線からの距離も見る（RX10b の貫通検査と同じ話）
    const spot = cands.find(p =>
        others.every(a => Math.hypot(a.x - p.x, a.y - p.y) >= KEEP) &&
        bonds.every(([a, b]) => pointSegmentDistance(p, a, b) >= G * 0.5));
    if (!spot) return; // 置き場が無ければその場に残す（画面外へ飛ばすよりまし）
    o.x = spot.x;
    o.y = spot.y;
    // 反応で生じた副生成物であることを覚えておく（P12-8。ユーザー指摘）。
    // キャンバス上の①②③の見出しは、作図中に置きかけた孤立原子を拾わないよう
    // 重原子2個以上に絞っているが、水のような**反応でできた1原子の分子は出したい**
    o.fromReaction = true;
}

// planAttachment 用: 動かす原子の集合（脱離する原子は含めない）
function movingSetOf(moving, ignore) {
    return [...moving].filter(id => !ignore.has(id));
}

/**
 * 動かす側を 90°/270° 回してよいか（レビュー項目15）。
 *
 * **鏡映は入れない**（v347。不斉炭素が黙って鏡像異性体に化ける）が、
 * **回転そのものは立体を変えない**。90°で変わるのは図の「読み方の約束」の方で、
 * 対象は2つだけ:
 *   - フィッシャー投影（縦＝奥・横＝手前）… 不斉炭素を持つ図
 *   - ハース投影（環は横置き）… 環と面マーク
 * なので**不斉炭素も面マークも環も持たない分子**に限って 90° を許す。
 * 脂肪酸やアセチル基がここに入るので、グリセリンの2本目・3本目のエステル化で
 * 「縦向きに立てて置く」候補が使えるようになる（横向きのままだと隣の枝とかみ合って置けない）。
 */
function canSpin90(mol, ids) {
    const set = new Set(ids);
    const atoms = [...set].map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
    if (!atoms.length) return false;
    if (atoms.some(a => a.haworthFace || a.isAsymmetricMarked || a.benzeneCenter)) return false;
    const bonds = mol.bonds.filter(b => set.has(b.atomId1) && set.has(b.atomId2));
    if (bonds.length >= atoms.length) return false; // 環を含む（ハース投影・芳香環の向きを崩さない）
    return !atoms.some(a => a.element === 'C' && mol.isAsymmetricCarbon(a.id));
}

/**
 * 相手分子（movingIds）を動かして、attachId の原子を anchorId の隣
 * （1グリッドの直交方向）へ置くための変換を求める。見つからなければ null。
 *
 * 平行移動だけでは**式の並びと画面の並びが一致しない**。エステル化がその典型で、
 * エタノールは C-C-O と O が右端に描かれているため、そのまま右へ寄せると
 * エチル基が左へ折り返し、生成物がコの字になる（2026-08-01 の検品指摘 C-2。
 * CH₃COOH + HOCH₂CH₃ → CH₃COOCH₂CH₃ と読める並びにしたい）。
 *
 * そこで **180°回転させた向きも候補に入れる**。反転（鏡映）は入れない:
 * 立体は図の座標から読むので、鏡映すると不斉炭素が黙って鏡像異性体に化ける。
 * 180°回転はフィッシャー投影でも偶置換＝分子を変えないので安全。
 * **90°回転は `canSpin90` が許した分子だけ**（不斉炭素も面マークも環も無いもの）。
 *
 * 返り値の { dx, dy, rot, scale, shove } は applyAttachment に渡す。
 */
function planAttachment(mol, anchorId, attachId, movingIds, ignoreIds = []) {
    const anchor = mol.atoms.find(a => a.id === anchorId);
    const attach = mol.atoms.find(a => a.id === attachId);
    if (!anchor || !attach) return null;
    const moving = new Set(movingIds);
    const ignore = new Set(ignoreIds);
    const statics = mol.atoms.filter(a => !moving.has(a.id) && !ignore.has(a.id) && a.element !== 'H');
    const G = bondStep(mol, anchorId); // 母体の刻みに合わせる（42px 固定だと結合線が原子を貫通する）
    const MIN_CLEARANCE = G * 0.65;
    const dirs = [0, -Math.PI / 2, Math.PI / 2, Math.PI]; // 右・上・下・左
    /*
     * **生成物は1つの刻みで描く**（レビュー項目15）。名称ライブラリの分子は
     * エントリごとに刻みが違う（グリセリンは 42px、酢酸は 80px）。刻みの違うまま
     * つなぐと、42px 間隔の枝のあいだへ 80px 幅のアセチル基を差し込むことになり、
     * 結合線が隣の炭素をちょうど貫通する（実測 0.0px）。3本目のアセチル化に至っては
     * どの向きにも置けない。
     *
     * そこで動かす側を**母体の刻みへ相似に伸縮**してからつなぐ。相似変換なので
     * 結合角も形も変わらず、一様な正の倍率だから鏡像になることもない
     * （フィッシャー投影の読みも変わらない）。座標は見た目専用なので化学に影響しない。
     */
    const moveG = bondStep(mol, attachId);
    const scaleF = (moveG > 1 && Math.abs(moveG - G) > 1) ? G / moveG : 1;
    const sx = attach.x, sy = attach.y; // 伸縮の中心は結合をつくる原子（そこは動かない）
    const scaled = (a) => scaleF === 1
        ? { x: a.x, y: a.y }
        : { x: sx + (a.x - sx) * scaleF, y: sy + (a.y - sy) * scaleF };
    // ignoreIds（脱離して水になる -OH など）は**動かす側にあっても**衝突判定から外す。
    // 外さないと、その原子が相手の位置に重なるという理由で置ける向きが消える
    // （アルコールを先に選んで酸側を動かす場合。C-1）
    const movingAtoms = [...moving]
        .filter(id => !ignore.has(id))
        .map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
    if (!movingAtoms.length) return null;
    // 以降の当たり判定はすべて**伸縮後**の座標で行う
    const basePos = new Map(movingAtoms.map(a => [a.id, scaled(a)]));
    const cx = [...basePos.values()].reduce((s, p) => s + p.x, 0) / basePos.size;
    const cy = [...basePos.values()].reduce((s, p) => s + p.y, 0) / basePos.size;
    // 回転後の座標（中心は動かす側の重心）。0°/180° は常に使える
    const spun = (p, rot) => {
        if (rot === 180) return { x: 2 * cx - p.x, y: 2 * cy - p.y };
        if (rot === 90) return { x: cx - (p.y - cy), y: cy + (p.x - cx) };
        if (rot === 270) return { x: cx + (p.y - cy), y: cy - (p.x - cx) };
        return { x: p.x, y: p.y };
    };
    // 90°回転は「図の読みが変わらない分子」に限って最後の手段として使う（下の canSpin90）
    const spins = canSpin90(mol, movingSetOf(moving, ignore)) ? [0, 180, 90, 270] : [0, 180];
    // 反応に関わる分子（動かさない側）と、それ以外の**傍観分子**を分ける（レビュー項目15）。
    // 置ける向きは「4方向 × 180°回転」の8通りしかないので、キャンバスに他の分子が
    // 残っているだけで全滅しうる。実測ではグリセリン＋酢酸3分子のエステル化で
    // 候補4件のうち3件が「配置する空間がありません」になっていた
    const core = componentOf(mol, anchorId);
    const movingSet = new Set(movingAtoms.map(a => a.id));
    const innerBonds = mol.bonds.filter(b => movingSet.has(b.atomId1) && movingSet.has(b.atomId2));
    // 向きは「そのまま」を先に試す。折り返してしまうときだけ 180°回転を使う。
    // strict のときは**結合線が無関係な原子を貫通しない**ことまで見る（原子どうしの間隔だけ
    // だと、動かした分子の線が相手の原子の上を通って構造式が別物に見える）
    const search = (skipBystanders, strict) => {
        const blockers = skipBystanders ? statics.filter(a => core.has(a.id)) : statics;
        const blockerIds = new Set(blockers.map(a => a.id));
        const blockerBonds = !strict ? [] : mol.bonds
            .filter(b => blockerIds.has(b.atomId1) && blockerIds.has(b.atomId2))
            .map(b => [mol.atoms.find(a => a.id === b.atomId1), mol.atoms.find(a => a.id === b.atomId2)]);
        for (const ang of dirs) {
            const tx = anchor.x + G * Math.cos(ang);
            const ty = anchor.y + G * Math.sin(ang);
            for (const rot of spins) {
                const at = spun(basePos.get(attachId) || { x: sx, y: sy }, rot);
                const dx = tx - at.x;
                const dy = ty - at.y;
                const moved = new Map([...basePos].map(([id, p0]) => {
                    const p = spun(p0, rot);
                    return [id, { x: p.x + dx, y: p.y + dy }];
                }));
                const pts = [...moved.values()];
                let ok = pts.every(p =>
                    blockers.every(s => Math.hypot(s.x - p.x, s.y - p.y) >= MIN_CLEARANCE));
                if (ok && strict) {
                    ok = pts.every(p => blockerBonds.every(s =>
                            pointSegmentDistance(p, s[0], s[1]) >= SHOVE_LINE_CLEARANCE)) &&
                        !innerBonds.some(b => {
                            const s = moved.get(b.atomId1), e = moved.get(b.atomId2);
                            return blockers.some(q => pointSegmentDistance(q, s, e) < SHOVE_LINE_CLEARANCE);
                        });
                }
                if (ok) return { dx, dy, rot, cx, cy, scale: { f: scaleF, sx, sy } };
            }
        }
        return null;
    };
    // 「線も貫通しない置き方」→「反応に関わらない分子をどかせば置ける」→
    // 「線の貫通には目をつぶる（従来の判定）」の順に探す。
    // **反応に関わらない分子はどかしてよい**——座標は見た目専用なので化学は変わらない。
    // 動かす側の選び方（＝式の左右。v347／C-2）はここでは変えない
    for (const strict of [true, false]) {
        const plan = search(false, strict);
        if (plan) return plan;
        const relaxed = search(true, strict);
        if (!relaxed) continue;
        const placed = new Map();
        statics.filter(a => core.has(a.id)).forEach(a => placed.set(a.id, { x: a.x, y: a.y }));
        basePos.forEach((p0, id) => {
            const p = spun(p0, relaxed.rot);
            placed.set(id, { x: p.x + relaxed.dx, y: p.y + relaxed.dy });
        });
        const bystanderIds = statics.filter(a => !core.has(a.id)).map(a => a.id);
        const shove = planShoveAside(mol, placed, bystanderIds, MIN_CLEARANCE);
        if (shove) {
            relaxed.shove = shove;
            return relaxed;
        }
    }
    return null;
}

// 点と線分の距離（退避先が既存の結合線の上に乗っていないかを見るために使う）
function pointSegmentDistance(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const L2 = vx * vx + vy * vy;
    if (!L2) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}

// 退避先が結合線の上に乗ると構造式が別物に見える（RX10b の貫通検査と同じ話）。
// 検査のしきい値 10px に余裕を足した値を使う
const SHOVE_LINE_CLEARANCE = 14;
// 逃がす向き。まっすぐな4方向を先に見て、だめなら斜めへ（図が散らからない順）
const SHOVE_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * 反応に関わらない分子（傍観分子）を、生成物の置き場から外へ逃がす移動量を求める（レビュー項目15）。
 *
 * `placed` は「動かせない原子」の**反応後**の座標（id → {x,y}）。
 * 逃がした分子もここへ積んでいくので、退避先どうしが重なることもない。
 * 返り値は `[{ ids, dx, dy }]`。逃がしきれない分子が1つでもあれば null
 * （＝この配置は採らない。中途半端に散らかった図を残さない）。
 */
function planShoveAside(mol, placed, bystanderIds, clearance) {
    const limit = typeof CANVAS_LIMIT !== 'undefined' ? CANVAS_LIMIT : 5000;
    const pool = new Set(bystanderIds);
    const shoves = [];
    const settled = new Set();
    // 「置いた原子」と「置いた結合線」を持ち回る。原子どうしだけを見ていると、
    // 逃がした分子が長い結合線のまん中に乗って構造式が読めなくなる
    const segmentsOf = () => mol.bonds
        .filter(b => placed.has(b.atomId1) && placed.has(b.atomId2))
        .map(b => [placed.get(b.atomId1), placed.get(b.atomId2)]);
    for (const seed of bystanderIds) {
        if (settled.has(seed)) continue;
        const ids = [...componentOf(mol, seed)].filter(x => pool.has(x));
        ids.forEach(x => settled.add(x));
        const atoms = ids.map(x => mol.atoms.find(a => a.id === x)).filter(Boolean);
        if (!atoms.length) continue;
        const inner = mol.bonds.filter(b => ids.includes(b.atomId1) && ids.includes(b.atomId2));
        const fits = (dx, dy) => {
            const pts = [...placed.values()];
            const segs = segmentsOf();
            const moved = new Map(atoms.map(a => [a.id, { x: a.x + dx, y: a.y + dy }]));
            for (const p of moved.values()) {
                if (Math.abs(p.x) > limit || Math.abs(p.y) > limit) return false;
                if (pts.some(q => Math.hypot(q.x - p.x, q.y - p.y) < clearance)) return false;
                if (segs.some(s => pointSegmentDistance(p, s[0], s[1]) < SHOVE_LINE_CLEARANCE)) return false;
            }
            // 逃がした分子の結合線が、置いてある原子を貫通しないことも見る
            return !inner.some(b => {
                const s = moved.get(b.atomId1), e = moved.get(b.atomId2);
                return pts.some(q => pointSegmentDistance(q, s, e) < SHOVE_LINE_CLEARANCE);
            });
        };
        const keep = (dx, dy) => {
            atoms.forEach(a => placed.set(a.id, { x: a.x + dx, y: a.y + dy }));
            if (dx || dy) shoves.push({ ids, dx, dy });
        };
        if (fits(0, 0)) { keep(0, 0); continue; }
        const G = bondStep(mol, ids[0]);
        let done = false;
        for (let r = 1; r <= 12 && !done; r++) {
            for (const [ux, uy] of SHOVE_DIRS) {
                if (fits(ux * r * G, uy * r * G)) { keep(ux * r * G, uy * r * G); done = true; break; }
            }
        }
        if (!done) return null;
    }
    return shoves;
}

// エステル結合の箇所を返す（加水分解とけん化で共用）。
// 酸無水物（-CO-O-CO-）は同じ -CO-O- の形なので ester として拾われるが、
// 加水分解は起こっても「エステルの加水分解・けん化」ではないので専用ルールに任せる
function detectEsterLinkages(mol) {
    return findFunctionalGroups(mol)
        .filter(g => g.type === 'ester')
        .filter(g => !isAnhydrideLinkage(mol, g.atomIds[2], g.atomIds[0]))
        .map(g => g.atomIds); // [カルボニルC, =O, -O-]
}

/**
 * エステルの C-O 結合を切る（アシル-酸素開裂）。O はアルコール側に残る。
 * asSalt=false … 切った先に -OH を付けてカルボン酸にする（加水分解）
 * asSalt=true  … -O-Na を付けてカルボン酸の塩にする（けん化）
 */
function cleaveEster(game, site, asSalt) {
    const [cId, , oId] = site;
    const mol = game.userMolecule;
    mol.removeBond(cId, oId);
    const alcIds = [...componentOf(mol, oId)];
    if (!alcIds.includes(cId)) {
        // 環状エステル（ラクトン）でなければアルコール分子として引き離す
        const sep = separateComponent(mol, alcIds);
        if (sep) translateAtoms(mol, alcIds, sep.dx, sep.dy);
    }
    const spot = freeSpotAround(mol, cId);
    if (!spot) throw new Error('生成物を配置する空間がありません。結合を伸ばして空間を作ってから実行してください');
    const o = mol.addAtom('O', spot.x, spot.y);
    mol.addBond(cId, o.id, 1);
    if (!asSalt) {
        return {
            caption: 'エステルが加水分解されて、カルボン酸とアルコールに分かれました。' +
                     '酸を触媒に使うこの反応は平衡なので、逆のエステル化も同時に起こります。',
            changed: [cId, o.id]
        };
    }
    // 塩にする: 生えた -OH の O にさらに Na を付ける（-COONa）。
    // Na の置き場が無いときは酸のままにせず、ここで止める（中途半端な図を残さないため）
    const naSpot = freeSpotAround(mol, o.id, [{ x: spot.x, y: spot.y }]);
    if (!naSpot) throw new Error('ナトリウムを置く空間がありません。分子を離してから実行してください');
    const na = mol.addAtom('Na', naSpot.x, naSpot.y);
    mol.addBond(o.id, na.id, 1);
    return {
        caption: 'けん化が起こりました。水酸化ナトリウムを使うので、できるのはカルボン酸ではなく' +
                 '**カルボン酸のナトリウム塩**です（油脂なら脂肪酸ナトリウム＝セッケンそのもの）。' +
                 '塩になると逆のエステル化が起こらないため、反応は完全に進みます。',
        changed: [cId, o.id, na.id]
    };
}

/**
 * 反応させる分子を2つ選んでいるとき、**先に選んだ方（式の左）を動かさない**ようにするための判定
 * （C-1。2026-08-01 ユーザー要望「選んだ分子が左」）。
 * ids に先に選んだ分子の代表原子が入っていれば true ＝ そちらは動かさず、相手を動かす。
 * 動かす側を入れ替えるだけで、できる結合は同じなので化学は変わらない。
 */
function firstSelectedIsIn(ids) {
    const g = typeof window !== 'undefined' ? window.game : null;
    const sel = g && g.selectedMolecules;
    if (!sel || sel.length < 2) return false;
    return [...ids].includes(sel[0]);
}

// planAttachment が返した変換を実際に当てる（相似の伸縮 → 180°回転 → 平行移動の順）
function applyAttachment(mol, ids, plan) {
    ids.forEach(id => {
        const a = mol.atoms.find(x => x.id === id);
        if (!a) return;
        // 母体と刻みが違うときの伸縮（レビュー項目15）。相似なので形も結合角も変わらない
        if (plan.scale && plan.scale.f !== 1) {
            a.x = plan.scale.sx + (a.x - plan.scale.sx) * plan.scale.f;
            a.y = plan.scale.sy + (a.y - plan.scale.sy) * plan.scale.f;
        }
        if (plan.rot) {
            const dx0 = a.x - plan.cx, dy0 = a.y - plan.cy;
            if (plan.rot === 180) { a.x = plan.cx - dx0; a.y = plan.cy - dy0; }
            else if (plan.rot === 90) { a.x = plan.cx - dy0; a.y = plan.cy + dx0; }
            else if (plan.rot === 270) { a.x = plan.cx + dy0; a.y = plan.cy - dx0; }
        }
        a.x += plan.dx;
        a.y += plan.dy;
    });
    // 場所を空けるために外へ逃がす傍観分子（レビュー項目15）。
    // 反応に関わらない別の分子なので、動かしても結合・元素・判定には影響しない
    if (plan.shove) plan.shove.forEach(s => translateAtoms(mol, s.ids, s.dx, s.dy));
}

function translateAtoms(mol, ids, dx, dy) {
    ids.forEach(id => {
        const a = mol.atoms.find(x => x.id === id);
        if (a) {
            a.x += dx;
            a.y += dy;
        }
    });
}

const ALCOHOL_TYPES = ['alcohol0', 'alcohol1', 'alcohol2', 'alcohol3'];

// 新しい原子を atomId の隣（1グリッドの直交方向）に置ける空き位置を返す。なければ null
function freeSpotAround(mol, atomId, reserved = []) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a) return null;
    const G = bondStep(mol, atomId);
    const MIN_CLEARANCE = G * 0.65;
    const dirs = [0, -Math.PI / 2, Math.PI / 2, Math.PI];
    for (const ang of dirs) {
        const x = a.x + G * Math.cos(ang);
        const y = a.y + G * Math.sin(ang);
        if (mol.atoms.some(o => o.id !== atomId && o.element !== 'H' &&
            Math.hypot(o.x - x, o.y - y) < MIN_CLEARANCE)) continue;
        if (reserved.some(p => Math.hypot(p.x - x, p.y - y) < MIN_CLEARANCE)) continue;
        return { x, y };
    }
    return null;
}

// 切り離された分子（movingIds）を他の原子と重ならない位置まで引き離す移動量を返す
function separateComponent(mol, movingIds) {
    const moving = new Set(movingIds);
    const statics = mol.atoms.filter(a => !moving.has(a.id) && a.element !== 'H');
    if (statics.length === 0) return { dx: 0, dy: 0 };
    const G = bondStep(mol, movingIds[0]);
    const offsets = [[0, 2 * G], [2 * G, 0], [0, -2 * G], [-2 * G, 0],
                     [0, 3 * G], [3 * G, 0], [2 * G, 2 * G], [-2 * G, 2 * G]];
    for (const [dx, dy] of offsets) {
        const ok = movingIds.every(id => {
            const a = mol.atoms.find(x => x.id === id);
            if (!a) return true;
            return statics.every(s => Math.hypot(s.x - (a.x + dx), s.y - (a.y + dy)) >= G * 0.65);
        });
        if (ok) return { dx, dy };
    }
    return null;
}

// 芳香環の置換可能な炭素（空き価標のある環炭素）を [id] の配列で返す
/**
 * 芳香環の「置換して同じ生成物になる位置」を1つのクラスにまとめるためのキーを返す（P12-8）。
 * 位相だけの複製を作り、その位置に目印の原子を付けて正準コードを取る。
 * 正準コードは座標を見ないので、これが一致する位置は**置換すると同じ分子になる**＝等価。
 * 例: ベンゼンの6箇所は全て同じキー（1クラス）／トルエンは o・m・p の3クラス／
 *     ナフタレンは α・β の2クラスになる。
 */
function aromaticSiteClass(mol, siteId) {
    const probe = new Molecule();
    const map = new Map();
    mol.atoms.forEach(a => { map.set(a.id, probe.addAtom(a.element, a.x, a.y).id); });
    mol.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) probe.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
    });
    const marker = probe.addAtom('Cl', 0, 0); // 目印（種類は何でもよい。位置の等価性だけを見る）
    probe.addBond(map.get(siteId), marker.id, 1);
    return canonicalCode(probe);
}

function aromaticSites(mol, kind) {
    const keys = findAromaticBondKeys(mol);
    const ids = new Set();
    mol.bonds.forEach(b => {
        const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        if (keys.has(k)) {
            ids.add(b.atomId1);
            ids.add(b.atomId2);
        }
    });
    // **候補の順は座標で決める**（C-2b。2026-08-01・動画レーンの実測）。
    // 原子IDは乱数で、addBond が端点をIDで正規化するため、`mol.bonds` の走査順に頼ると
    // `b.atomId1` がどちらの頂点になるかが呼び出しのたびに変わり、**同じ手順でも
    // 置換基の生える向きが揺れる**（ニトロ化 6:4／スルホン化 6:4／塩素化 8:2 で実測）。
    // 化学的にはベンゼンの6頂点は等価なのでどれでも正しいが、収録のたびに構図が動くと
    // デモの `frame` に cx/cy を書けない。**右まわり優先（x が大きい、同じなら上）**にするのは、
    // ライブラリの一置換体（ヒドロキノン等）が右の頂点から置換基を伸ばしているのに合わせるため
    const ordered = [...ids]
        .map(id => mol.atoms.find(a => a.id === id))
        .filter(Boolean)
        .sort((p, q) => (q.x - p.x) || (p.y - q.y) || (p.id < q.id ? -1 : 1))
        .map(a => a.id);
    // 価標が空いていても、その置換基を置く空間が無ければ**候補に出さない**
    // （P12-8。「検出はするが実行すると失敗する」候補をユーザーに見せないため）
    const placeable = ordered
        .filter(id => mol.getFreeValency(id) >= 1)
        .filter(id => !kind || attachGroup(mol, id, kind, true));
    // **置換して同じ生成物になる位置はまとめる**（P12-8）。ベンゼンの6箇所は等価なので
    // 6件並べても選択肢が増えるだけで、化学的には1通り。トルエンなら o/m/p の3通りに減る
    const seen = new Set();
    const unique = [];
    placeable.forEach(id => {
        const key = aromaticSiteClass(mol, id);
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(id);
    });
    return unique.map(id => [id]);
}

// 環の外向き（結合済みの隣接原子と反対方向）に伸ばせる位置の候補を返す。
// 直交に限らず環の角度に沿った方向も試すため、六角形の頂点からでも自然に外へ伸ばせる
function outwardCandidates(mol, atomId) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a) return [];
    const G = bondStep(mol, atomId);
    const MIN_CLEARANCE = G * 0.65;
    const nb = mol.getNeighbors(atomId).filter(n => n.atom.element !== 'H');
    let base = 0;
    if (nb.length > 0) {
        let sx = 0, sy = 0;
        nb.forEach(n => {
            const t = Math.atan2(n.atom.y - a.y, n.atom.x - a.x);
            sx += Math.cos(t);
            sy += Math.sin(t);
        });
        base = Math.atan2(-sy, -sx);
    }
    const angles = [base, base + Math.PI / 6, base - Math.PI / 6,
                    base + Math.PI / 3, base - Math.PI / 3, base + Math.PI / 2, base - Math.PI / 2];
    const out = [];
    angles.forEach(ang => {
        const x = a.x + G * Math.cos(ang);
        const y = a.y + G * Math.sin(ang);
        if (mol.atoms.some(o => o.id !== atomId && o.element !== 'H' &&
            Math.hypot(o.x - x, o.y - y) < MIN_CLEARANCE)) return;
        // step も返す: 枝（ニトロのOなど）を同じ刻みで置くために呼び出し側が使う
        out.push({ x, y, angle: ang, step: G });
    });
    return out;
}

// 置換基（ニトロ基・スルホ基・ハロゲン）を指定原子に取り付ける。追加した原子IDを返す。
// 置換基を「かたまり」として扱い、酸素まで含めて重ならない向きを探す
// （ニトロ基の酸素どうしが4pxまで接近する不具合の修正。P9-5監査で発見）
/**
 * 芳香環などに置換基を付ける。dryRun=true なら**実際には付けず、置ける場所があるかだけ**を返す
 * （P12-8 反応判定の精査。検出段階で「実行できない候補」を出さないために使う）。
 */
function attachGroup(mol, cId, kind, dryRun = false) {
    const MIN_CLEARANCE = bondStep(mol, cId) * 0.65;
    const anchorElement = kind === 'nitro' ? 'N' : (kind === 'sulfo' ? 'S' : kind);
    // アンカー（N/S/ハロゲン）から見た枝の配置。ニトロは N(=O)(-O) の電荷分離形、
    // スルホ基 -SO₃H は S を6価として扱う（開発方針 4章-2 / 硫黄の扱い）
    const branchesOf = (angle) => {
        if (kind === 'nitro') {
            return [{ element: 'O', angle: angle + Math.PI / 2, type: 2 },
                    { element: 'O', angle: angle - Math.PI / 2, type: 1 }];
        }
        if (kind === 'sulfo') {
            return [{ element: 'O', angle: angle + Math.PI / 2, type: 2 },
                    { element: 'O', angle: angle - Math.PI / 2, type: 2 },
                    { element: 'O', angle: angle, type: 1 }];
        }
        return [];
    };

    for (const spot of outwardCandidates(mol, cId)) {
        const branches = branchesOf(spot.angle).map(b => ({
            ...b,
            x: spot.x + spot.step * Math.cos(b.angle),
            y: spot.y + spot.step * Math.sin(b.angle)
        }));
        const points = [{ x: spot.x, y: spot.y }, ...branches];
        const hitsExisting = points.some(p => mol.atoms.some(o =>
            o.id !== cId && o.element !== 'H' && Math.hypot(o.x - p.x, o.y - p.y) < MIN_CLEARANCE));
        const hitsSelf = points.some((p, i) => points.some((q, j) =>
            j > i && Math.hypot(p.x - q.x, p.y - q.y) < MIN_CLEARANCE));
        if (hitsExisting || hitsSelf) continue;
        if (dryRun) return true; // 置ける場所が見つかった（実際には置かない）

        const anchor = mol.addAtom(anchorElement, spot.x, spot.y);
        mol.addBond(cId, anchor.id, 1);
        const added = [anchor.id];
        branches.forEach(b => {
            const atom = mol.addAtom(b.element, b.x, b.y);
            mol.addBond(anchor.id, atom.id, b.type);
            added.push(atom.id);
        });
        return added;
    }
    if (dryRun) return false; // 置ける場所が無い
    throw new Error('置換基を置く空間がありません。まわりを空けてから実行してください');
}

// アセチル基 CH₃CO- を指定原子（フェノールのO・アミンのN）に取り付ける（P9-1検収フォロー）。
// 置換基をかたまりとして扱い、カルボニルOとメチルCまで含めて重ならない向きを探す
function attachAcetyl(mol, targetId) {
    const MIN_CLEARANCE = bondStep(mol, targetId) * 0.65;
    for (const spot of outwardCandidates(mol, targetId)) {
        const branches = [
            { element: 'O', type: 2,
              x: spot.x + spot.step * Math.cos(spot.angle + Math.PI / 2),
              y: spot.y + spot.step * Math.sin(spot.angle + Math.PI / 2) },
            { element: 'C', type: 1,
              x: spot.x + spot.step * Math.cos(spot.angle),
              y: spot.y + spot.step * Math.sin(spot.angle) }
        ];
        const points = [{ x: spot.x, y: spot.y }, ...branches];
        const hitsExisting = points.some(p => mol.atoms.some(o =>
            o.id !== targetId && o.element !== 'H' && Math.hypot(o.x - p.x, o.y - p.y) < MIN_CLEARANCE));
        const hitsSelf = points.some((p, i) => points.some((q, j) =>
            j > i && Math.hypot(p.x - q.x, p.y - q.y) < MIN_CLEARANCE));
        if (hitsExisting || hitsSelf) continue;
        const cAcyl = mol.addAtom('C', spot.x, spot.y);
        mol.addBond(targetId, cAcyl.id, 1);
        const added = [cAcyl.id];
        branches.forEach(b => {
            const atom = mol.addAtom(b.element, b.x, b.y);
            mol.addBond(cAcyl.id, atom.id, b.type);
            added.push(atom.id);
        });
        return added;
    }
    throw new Error('アセチル基を置く空間がありません。まわりを空けてから実行してください');
}

/**
 * このアルコール性 -OH の酸化を候補に出してよいか（P12-8 反応判定の精査 第4弾）。
 *
 * 同じ分子に酸化されやすさの違う官能基があると、酸化の候補が同時に並んでしまい
 * 「どれを選んでもよい」という誤解を与える（例: 鎖状グルコースで「アルデヒドへ」
 * 「ケトンへ」「カルボン酸へ」の3種が同時に出ていた）。高校化学が扱う線引きに
 * 合わせて、次の場合はアルコールの酸化を出さない。
 *   ① 同じ分子に -CHO がある … -CHO の方が酸化されやすく、先にこちらが反応する。
 *      糖が還元性を示す（フェーリング液を還元する）のはこの構造によるもの
 *   ② アルコール性 -OH が2つ以上ある … 多価アルコール・糖の酸化は扱わない
 *      （分子内脱水と同じ線引き。DEVELOPMENT.md P12-8）
 * 1級と2級のあいだには序列を置かない（高校では順序を扱わず、実際にも同程度）。
 * 判定は「連結成分ごと」に行う。キャンバスに2分子を並べているとき、隣の分子の
 * 官能基でこちらの反応が消えてしまってはいけない（エステル化・分子間脱水の練習）
 */
function alcoholOxidationAllowed(mol, groups, alcOId) {
    const comp = componentOf(mol, alcOId);
    if (groups.some(g => g.type === 'aldehyde' && comp.has(g.atomIds[0]))) return false;
    const alcohols = groups.filter(g => ALCOHOL_TYPES.includes(g.type) && comp.has(g.atomIds[0]));
    return alcohols.length < 2;
}

/**
 * この窒素はアミド（-CO-N<）の N か（P12-8 反応判定の精査）。
 * アミドの N は、隣のカルボニルに電子を引かれて求核性を失っているため、
 * アミンと同じようには反応しない（無水酢酸によるアセチル化は進まない）。
 * findFunctionalGroups は「単結合だけで水素が残る N」を一律に amino とするので、
 * 反応ルール側でこの区別をつける。
 */
/**
 * エステル結合の -O-（oId）が、酸無水物 -CO-O-CO- の酸素か（P12-8）。
 * カルボニル炭素 cId の向かい側にもカルボニル炭素があれば酸無水物。
 * 形は -CO-O- で同じだが、加水分解の呼び方（けん化ではない）も生成物も違うので分けて扱う。
 */
function isAnhydrideLinkage(mol, oId, cId) {
    const other = mol.getNeighbors(oId)
        .find(n => n.atom.element === 'C' && n.atom.id !== cId);
    if (!other) return false;
    return mol.getNeighbors(other.atom.id).some(m => m.atom.element === 'O' && m.type === 2);
}

function isAmideNitrogen(mol, nId) {
    return mol.getNeighbors(nId).some(n =>
        n.atom.element === 'C' && n.type === 1 &&
        mol.getNeighbors(n.atom.id).some(m => m.atom.element === 'O' && m.type === 2));
}

// ---- 芳香環の配向性（P12-8 規則層。教科書の「o,p-配向性／m-配向性」）----
// 環についている基が、次の置換基をどこに入れるかを決める。
//   o,p-配向（環に電子を押し込む基）… -OH・-OR・-NH₂・-NHCOR・アルキル基・ハロゲン
//   m-配向（環から電子を引く基）    … -NO₂・-SO₃H・-COOH・-COOR・-CHO・-CO-・-C≡N
// ハロゲンは「o,p-配向だが反応は遅い」という例外で、高校でもそう教える。

/** 環の原子 ringId についた環外の基が o,p-配向か m-配向か。基が無ければ null */
function ringDirector(mol, ringId, aromatic) {
    const sub = mol.getNeighbors(ringId)
        .find(n => n.atom.element !== 'H' && !aromatic.has(n.atom.id));
    if (!sub) return null;
    const a = sub.atom;
    if (a.element === 'Cl' || a.element === 'Br') return { kind: 'op', label: 'ハロゲン', slow: true };
    if (a.element === 'O') return { kind: 'op', label: '-OH / -OR' };
    if (a.element === 'S') return { kind: 'm', label: '-SO₃H' };
    if (a.element === 'N') {
        // ニトロ基の N は O と二重結合を2本持つ（このアプリの表現では価標4）
        const os = mol.getNeighbors(a.id).filter(n => n.atom.element === 'O');
        if (os.length >= 2) return { kind: 'm', label: '-NO₂' };
        return { kind: 'op', label: '-NH₂ / -NHCOR' };
    }
    if (a.element === 'C') {
        // 環につく炭素が二重・三重結合を持つ（-COOH・-CHO・-CO-・-C≡N）なら電子を引く
        const multi = mol.getNeighbors(a.id).some(n => n.type >= 2 && n.atom.id !== ringId);
        return multi ? { kind: 'm', label: '-COOH / -CHO / -CO- / -C≡N' }
                     : { kind: 'op', label: 'アルキル基' };
    }
    return null;
}

/**
 * 置換位置 siteId が「主生成物になる位置か」を返す（P12-8）。
 * 判断できるのは**単環に置換基が1つだけ**の場合に限る。
 * 置換基が2つ以上ある環・縮合環（ナフタレン）は配向の重ね合わせになるので何も言わない。
 * 返り値 { major, pos:'o'|'m'|'p', director } または null（判断しない）
 */
function aromaticSiteRole(mol, siteId) {
    const keys = findAromaticBondKeys(mol);
    const aromatic = new Set();
    mol.bonds.forEach(b => {
        const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        if (keys.has(k)) { aromatic.add(b.atomId1); aromatic.add(b.atomId2); }
    });
    if (!aromatic.has(siteId)) return null;
    // 単環（芳香環の原子がちょうど6個）に限る
    if (aromatic.size !== 6) return null;
    const substituted = [...aromatic].filter(id => ringDirector(mol, id, aromatic));
    if (substituted.length !== 1) return null;
    const anchor = substituted[0];
    const director = ringDirector(mol, anchor, aromatic);
    // 環を一周して anchor から siteId までの距離を測る（1=オルト・2=メタ・3=パラ）
    const dist = new Map([[anchor, 0]]);
    const queue = [anchor];
    while (queue.length) {
        const id = queue.shift();
        mol.getNeighbors(id).forEach(n => {
            if (!aromatic.has(n.atom.id) || dist.has(n.atom.id)) return;
            dist.set(n.atom.id, dist.get(id) + 1);
            queue.push(n.atom.id);
        });
    }
    const d = dist.get(siteId);
    const pos = d === 1 ? 'o' : d === 2 ? 'm' : d === 3 ? 'p' : null;
    if (!pos) return null;
    const major = director.kind === 'op' ? (pos === 'o' || pos === 'p') : (pos === 'm');
    return { major, pos, director };
}

// 置換を実行したあとに添える配向性の解説。判断できないときは空文字
function orientationNote(mol, siteId) {
    const r = aromaticSiteRole(mol, siteId);
    if (!r) return '';
    const posName = { o: 'オルト位', m: 'メタ位', p: 'パラ位' }[r.pos];
    const head = r.director.kind === 'op'
        ? `この環にはすでに ${r.director.label}（環に電子を押し込む基）がついているので、次の置換基は「オルト位」と「パラ位」に入りやすくなります（o,p-配向性）。`
        : `この環にはすでに ${r.director.label}（環から電子を引く基）がついているので、次の置換基は「メタ位」に入りやすくなります（m-配向性）。`;
    const judge = r.major
        ? `いま選んだのは${posName}なので、これが主生成物です。`
        : `いま選んだのは${posName}で、実際にはでき方の少ない副生成物にあたります。`;
    const slow = r.director.slow
        ? 'なお、ハロゲンは o,p-配向でありながら反応自体は遅くする、という例外的な基です。' : '';
    return '\n' + head + judge + slow;
}

// 多重結合（非芳香族の C=C / C≡C）の一覧を [id1, id2] の配列で返す
function multipleBondSites(mol) {
    return findFunctionalGroups(mol)
        .filter(g => g.type === 'cc_double' || g.type === 'cc_triple')
        .map(g => g.atomIds);
}

// ===== 重合の下ごしらえ（P12-8。ユーザー要望「重合反応も実装したい」） =====

/**
 * ビニル系の C=C（環でない・芳香族でない）を集める。
 * head = 置換基の多い炭素 / tail = 少ない炭素。
 * 「head に相手の tail を繋ぐ」と教科書どおりの頭-尾（head-to-tail）の並びになる
 * （ポリ塩化ビニルが -[CH₂-CHCl]ₙ- になるのはこの並びのため）
 */
function vinylBonds(mol) {
    const ringIds = typeof ringAtomIds === 'function' ? ringAtomIds(mol) : new Set();
    const aromatic = typeof findAromaticBondKeys === 'function' ? findAromaticBondKeys(mol) : new Set();
    const out = [];
    mol.bonds.forEach(b => {
        if (b.type !== 2) return;
        const a1 = mol.atoms.find(a => a.id === b.atomId1);
        const a2 = mol.atoms.find(a => a.id === b.atomId2);
        if (!a1 || !a2 || a1.element !== 'C' || a2.element !== 'C') return;
        if (ringIds.has(a1.id) || ringIds.has(a2.id)) return; // 環内は重合しない
        const key = a1.id < a2.id ? `${a1.id}_${a2.id}` : `${a2.id}_${a1.id}`;
        if (aromatic.has(key)) return;
        const heavyN = (id, other) => mol.getNeighbors(id)
            .filter(n => n.atom.element !== 'H' && n.atom.id !== other).length;
        const n1 = heavyN(a1.id, a2.id), n2 = heavyN(a2.id, a1.id);
        // 置換基の数で頭を決める（頭-尾でつなぐため）。**同数のときは座標で決める**（C-2b）:
        // 原子IDは乱数で addBond が端点をIDで正規化するので、a1 を頭にすると
        // 対称な C=C（ブタジエンの内側など）で頭と尾が呼び出しのたびに入れ替わり、
        // 重合の架橋が本来3本つながるところ2本で止まることがあった（RX13 が散発的に落ちる）
        let head;
        if (n1 !== n2) head = n1 > n2 ? a1.id : a2.id;
        else head = (a1.x - a2.x) || (a1.y - a2.y) ? ((a1.x < a2.x || (a1.x === a2.x && a1.y < a2.y)) ? a1.id : a2.id)
                                                   : (a1.id < a2.id ? a1.id : a2.id);
        const tail = head === a1.id ? a2.id : a1.id;
        out.push({ head, tail });
    });
    return out;
}

/**
 * 共役ジエン（C1=C2−C3=C4）を探す。1,4-付加重合（合成ゴム）の対象。
 * 分子内に C=C がちょうど2本あり、それが単結合1本を挟んで並んでいるものだけを返す
 * （どこを開くかが一意に決まる形に限る）。返り値は {c1, c2, c3, c4}
 */
function conjugatedDienes(mol) {
    const out = [];
    const seenComp = new Set();
    const vinyls = vinylBonds(mol);
    vinyls.forEach(v => {
        const comp = componentOf(mol, v.head);
        const key = [...comp].sort().join(',');
        if (seenComp.has(key)) return;
        const inComp = vinyls.filter(w => comp.has(w.head));
        if (inComp.length !== 2) return;
        const [a, b] = inComp;
        // a の端と b の端が単結合でつながっているか（=共役）。つながる組を探す
        const ends = [[a.head, a.tail], [a.tail, a.head]];
        for (const [aOut, aIn] of ends) {
            for (const [bIn, bOut] of [[b.head, b.tail], [b.tail, b.head]]) {
                const link = mol.getBond(aIn, bIn);
                if (!link || link.type !== 1) continue;
                seenComp.add(key);
                out.push({ c1: aOut, c2: aIn, c3: bIn, c4: bOut });
                return;
            }
        }
    });
    return out;
}

/**
 * 加硫できる鎖を探す（P12-8。ユーザー要望）。
 * 「R で端を止めた鎖」＝重合でできた高分子で、環でない C=C が残っているもの。
 * ゴムに二重結合が残るのは 1,4-付加重合の結果で、そこに硫黄が結びつく。
 * 鎖ごとに1組（先に見つかった C=C）を返す。
 */
function vulcanizablePairs(mol) {
    // 重合の生成物（両端に R がある分子）に限る。単量体やふつうのアルケンは加硫の対象にしない
    const inPolymer = new Set();
    const seen = new Set();
    mol.atoms.forEach(a => {
        if (seen.has(a.id)) return;
        const comp = componentOf(mol, a.id);
        comp.forEach(id => seen.add(id));
        const hasR = [...comp].some(id => {
            const x = mol.atoms.find(t => t.id === id);
            return x && x.element === 'R';
        });
        if (hasR) comp.forEach(id => inPolymer.add(id));
    });
    const vinyls = vinylBonds(mol).filter(v => inPolymer.has(v.head));
    const out = [];
    const G = bondStep(mol);
    const MIN_CLEARANCE = G * 0.65;
    for (let i = 0; i < vinyls.length; i++) {
        for (let j = i + 1; j < vinyls.length; j++) {
            // 二重結合の両端どちらでも架橋しうるので4通り見る
            [[vinyls[i].head, vinyls[i].tail], [vinyls[i].tail, vinyls[i].head]].forEach(([ca, ca2]) => {
                [[vinyls[j].head, vinyls[j].tail], [vinyls[j].tail, vinyls[j].head]].forEach(([cb, cb2]) => {
                    const A = mol.atoms.find(x => x.id === ca), B = mol.atoms.find(x => x.id === cb);
                    if (!A || !B) return;
                    const sx = Math.round((A.x + B.x) / 2 / G) * G;
                    const sy = Math.round((A.y + B.y) / 2 / G) * G;
                    // 硫黄を置ける空きがあること。**同じ鎖の隣どうしはここで落ちる**
                    // （中点が鎖の内部に来るため）＝小さな環ができるのを防いでいる
                    if (mol.atoms.some(o => o.element !== 'H' &&
                        Math.hypot(o.x - sx, o.y - sy) < MIN_CLEARANCE)) return;
                    out.push({ ca, ca2, cb, cb2, sx, sy, d: Math.hypot(A.x - B.x, A.y - B.y) });
                });
            });
        }
    }
    // 近い組から順に（教科書の図のように短い橋をかける）
    out.sort((p, q) => p.d - q.d);
    return out;
}

/** その原子を含む分子（連結成分）の正準コード。同じ単量体かの判定に使う */
function componentCode(mol, atomId) {
    const ids = componentOf(mol, atomId);
    const sub = new Molecule();
    const map = new Map();
    mol.atoms.filter(a => ids.has(a.id)).forEach(a => {
        map.set(a.id, sub.addAtom(a.element, a.x, a.y).id);
    });
    mol.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) {
            sub.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
        }
    });
    return canonicalCode(sub);
}

/**
 * 「この先も同じ単位が続く」印として R（価標1の擬似元素）を付ける。
 * 空いている直交方向のうち、他の原子と近づかない位置を選ぶ。置けなければ null
 */
function attachR(mol, atomId) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a || mol.getFreeValency(atomId) < 1) return null;
    const G = bondStep(mol, atomId);
    const MIN_CLEARANCE = G * 0.65;
    const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -Math.PI / 4,
                  3 * Math.PI / 4, -3 * Math.PI / 4];
    for (const ang of dirs) {
        const x = Math.round(a.x + G * Math.cos(ang));
        const y = Math.round(a.y + G * Math.sin(ang));
        if (mol.atoms.some(o => o.element !== 'H' && Math.hypot(o.x - x, o.y - y) < MIN_CLEARANCE)) continue;
        const r = mol.addAtom('R', x, y);
        mol.addBond(atomId, r.id, 1);
        return r.id;
    }
    return null;
}

/**
 * 縮合重合になる組み合わせ（2価カルボン酸 ＋ 2価アルコール or 2価アミン）を探す。
 * 見つからなければ null。実際の連結は既存の「エステル化」「アセチル化」で1段ずつ行う
 */
function condensationPolymerPartners(mol) {
    const groups = findFunctionalGroups(mol);
    const comps = [];
    const seen = new Set();
    mol.atoms.forEach(a => {
        if (seen.has(a.id)) return;
        const ids = componentOf(mol, a.id);
        ids.forEach(i => seen.add(i));
        comps.push(ids);
    });
    const countIn = (ids, types) => groups.filter(g =>
        types.includes(g.type) && g.atomIds.some(i => ids.has(i))).length;
    const diacid = comps.find(ids => countIn(ids, ['carboxyl']) >= 2);
    if (!diacid) return null;
    const diol = comps.find(ids => ids !== diacid && countIn(ids, ALCOHOL_TYPES) >= 2);
    if (diol) return { acidId: [...diacid][0], otherId: [...diol][0], kind: 'alcohol' };
    const diamine = comps.find(ids => ids !== diacid && countIn(ids, ['amino']) >= 2);
    if (diamine) return { acidId: [...diacid][0], otherId: [...diamine][0], kind: 'amine' };
    return null;
}

// 多重結合への付加の共通処理。elemA/elemB は付加する元素（null は水素＝自動水素に任せる）。
// 片側だけに置換基が付く場合（HX・H₂O）はマルコフニコフ則で置換基の多い炭素側に付ける
function addAcrossMultipleBond(game, site, elemA, elemB, caption) {
    const mol = game.userMolecule;
    const [id1, id2] = site;
    const bond = mol.getBond(id1, id2);
    if (!bond || bond.type < 2) throw new Error('多重結合が見つかりません');

    let cX = id1, cY = id2;
    if (elemA && !elemB) {
        const subs = (id, other) => mol.getNeighbors(id)
            .filter(n => n.atom.element === 'C' && n.atom.id !== other).length;
        if (subs(id2, id1) > subs(id1, id2)) {
            cX = id2;
            cY = id1;
        }
    }

    bond.type -= 1;
    const added = [];
    const reserved = [];
    [[cX, elemA], [cY, elemB]].forEach(([cid, el]) => {
        if (!el) return; // 水素は明示原子にせず自動水素に任せる
        const spot = freeSpotAround(mol, cid, reserved);
        if (!spot) throw new Error('付加する原子を置く空間がありません。結合を伸ばして空間を作ってから実行してください');
        reserved.push(spot);
        const atom = mol.addAtom(el, spot.x, spot.y);
        mol.addBond(cid, atom.id, 1);
        added.push(atom.id);
    });
    return { caption, changed: [id1, id2, ...added] };
}

// ---- 反応ルール（detect は適用箇所の配列を返す。apply は分子を書き換える） ----
const REACTION_RULES = [
    {
        id: 'oxidize_primary',
        mechanismId: 'ethanol_oxidation',
        label: '酸化 [O] → アルデヒド',
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            return groups
                .filter(g => g.type === 'alcohol1' || g.type === 'alcohol0')
                .filter(g => mol.getFreeValency(g.atomIds[1]) >= 1)
                .filter(g => alcoholOxidationAllowed(mol, groups, g.atomIds[0]))
                .map(g => g.atomIds); // [OのID, CのID]
        },
        apply(game, site) {
            const [oId, cId] = site;
            game.userMolecule.getBond(oId, cId).type = 2;
            return {
                caption: '酸化されてアルデヒドになりました（R-CH₂-OH + [O] → R-CHO + H₂O）。アルデヒドはさらに酸化されるとカルボン酸になります。銀鏡反応・フェーリング液の還元を示すのはこの構造です。',
                changed: [oId, cId]
            };
        }
    },
    {
        id: 'oxidize_secondary',
        mechanismId: 'propanol2_oxidation',
        label: '酸化 [O] → ケトン',
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            return groups
                .filter(g => g.type === 'alcohol2')
                .filter(g => mol.getFreeValency(g.atomIds[1]) >= 1)
                .filter(g => alcoholOxidationAllowed(mol, groups, g.atomIds[0]))
                .map(g => g.atomIds);
        },
        apply(game, site) {
            const [oId, cId] = site;
            game.userMolecule.getBond(oId, cId).type = 2;
            return {
                caption: '2級アルコールが酸化されてケトンになりました（R-CH(OH)-R\' + [O] → R-CO-R\' + H₂O）。ケトンはアルデヒドと違い、それ以上酸化されにくい構造です。',
                changed: [oId, cId]
            };
        }
    },
    {
        id: 'oxidize_aldehyde',
        label: '酸化 [O] → カルボン酸',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'aldehyde')
                .filter(g => mol.getFreeValency(g.atomIds[0]) >= 1)
                .map(g => g.atomIds); // [カルボニルC, =O]
        },
        apply(game, site) {
            const cId = site[0];
            const mol = game.userMolecule;
            // -OH が同居しているか（＝アルコールの酸化を隠した分子か）は書き換える前に調べる。
            // O を足すとカルボキシ基になり、官能基の並びが変わってしまう
            const comp = componentOf(mol, cId);
            const withAlcohol = findFunctionalGroups(mol)
                .some(g => ALCOHOL_TYPES.includes(g.type) && comp.has(g.atomIds[0]));
            // 空き位置を確認して -OH の O を追加する。方向を計算するだけでは、
            // その位置に既存原子があると完全に重なってしまう（P9-5監査で発見）
            const spot = freeSpotAround(mol, cId);
            if (!spot) throw new Error('-OH を置く空間がありません。まわりを空けてから実行してください');
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(cId, o.id, 1);
            return {
                caption: 'アルデヒドが酸化されてカルボン酸になりました（R-CHO + [O] → R-COOH）。1級アルコールから2段階の酸化で到達する終点です。' +
                    (withAlcohol ? 'この分子には -OH もありますが、-CHO の方が酸化されやすいため先にこちらが反応します（糖が還元性を示すのはこの構造によるものです）。' : ''),
                changed: [cId, o.id]
            };
        }
    },
    {
        id: 'oxidize_tertiary_info',
        label: '⚠ 酸化（3級アルコール）',
        info: true,
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'alcohol3')
                .map(g => g.atomIds);
        },
        apply() {
            return {
                caption: '3級アルコールは、-OH のついた炭素に水素がないため酸化されにくい構造です（級の判定: OHのつく炭素に結合する炭素の数 = 3）。'
            };
        }
    },
    {
        id: 'dehydration_intra',
        mechanismId: 'ethanol_e1',
        label: '分子内脱水（-H₂O） → アルケン',
        detect(mol) {
            const sites = [];
            // 適用条件（P12-8 反応判定の精査）: 高校で扱う分子内脱水は
            // 「アルコール（-OH がひとつだけ）」に限られる。糖・多価アルコール・
            // α-ヒドロキシ酸などに適用すると、教科書では扱わない生成物を提示してしまうため、
            // **他の官能基を持つ分子や -OH が複数ある分子では候補に出さない**（＝判断できないものは出さない）
            const groups = findFunctionalGroups(mol);
            const alcohols = groups.filter(g => ['alcohol1', 'alcohol2', 'alcohol3'].includes(g.type));
            if (alcohols.length !== 1) return sites; // 多価アルコール・糖は対象外
            const blocking = groups.filter(g =>
                !['alcohol1', 'alcohol2', 'alcohol3'].includes(g.type) && g.type !== 'aromatic');
            if (blocking.length > 0) return sites; // カルボニル・カルボキシ・エステル・エーテル等があれば対象外
            alcohols
                .forEach(g => {
                    const [oId, aId] = g.atomIds;
                    const alpha = mol.atoms.find(a => a.id === aId);
                    const aNb = mol.getNeighbors(aId).filter(n => n.atom.element !== 'H');
                    if (aNb.some(n => n.type >= 2)) return; // α炭素に多重結合がある場合は対象外
                    // β候補: αに単結合した炭素で、Hがあり多重結合を持たないもの
                    const betas = aNb.filter(n =>
                        n.atom.element === 'C' && n.type === 1 &&
                        mol.getFreeValency(n.atom.id) >= 1 &&
                        !mol.getNeighbors(n.atom.id).some(x => x.type >= 2));
                    if (betas.length === 0) return;
                    // ザイツェフ則: 結合する炭素が多い（＝Hが少ない）β側を主生成物として選ぶ
                    betas.sort((p, q) =>
                        mol.getNeighbors(q.atom.id).filter(x => x.atom.element === 'C').length -
                        mol.getNeighbors(p.atom.id).filter(x => x.atom.element === 'C').length);
                    sites.push([oId, aId, betas[0].atom.id]);
                });
            return sites;
        },
        apply(game, site) {
            const [oId, aId, bId] = site;
            const mol = game.userMolecule;
            mol.removeBond(oId, aId);
            mol.getBond(aId, bId).type = 2;
            // 脱離した水（O + 自動H×2）は分子の外側へ平行移動して残す
            parkAsWater(mol, oId);
            return {
                caption: '分子内脱水で C=C 二重結合ができ、水 H₂O が脱離しました（濃硫酸・約160〜170℃の条件に相当）。β炭素が複数あるときは、Hの少ない炭素側から抜ける主生成物を表示しています（ザイツェフ則）。',
                changed: [aId, bId]
            };
        }
    },
    {
        id: 'esterification',
        mechanismId: 'esterification',
        label: 'エステル化（カルボン酸＋アルコール, -H₂O）',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②水がとれて -COO- ができる
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            const carboxyls = groups.filter(g => g.type === 'carboxyl');
            // フェノールは対象外: カルボン酸との直接エステル化は進みにくく、
            // 教科書では無水酢酸によるアセチル化で扱う（P9-1検収での化学的修正）
            const alcohols = groups.filter(g => ALCOHOL_TYPES.includes(g.type));
            const sites = [];
            carboxyls.forEach(cx => {
                const comp = componentOf(mol, cx.atomIds[0]);
                alcohols.forEach(al => {
                    if (comp.has(al.atomIds[0])) return; // 分子間反応のみ（分子内エステル化は対象外）
                    sites.push([cx.atomIds[0], cx.atomIds[2], al.atomIds[0], al.atomIds[1]]);
                });
            });
            return sites;
        },
        apply(game, site) {
            const [cId, ohOId, alcOId] = site;
            const mol = game.userMolecule;
            const alcIds = [...componentOf(mol, alcOId)];
            const acidIds = [...componentOf(mol, cId)];
            /*
             * どちらの分子を動かすか。3段で決める（レビュー項目15）:
             *
             * ① 分子を選んでいるなら、**先に選んだ方（式の左）は動かさない**（C-1）
             * ② 選んでいなければ**小さい方**を動かす。酢酸(4原子)＋エタノール(3原子) では
             *    従来どおりアルコール側が動くので、CH₃COOH + HOCH₂CH₃ の並びは変わらない
             *    （v347／C-2）。向きが入れ替わるのは、油脂のように**大きな多価アルコールへ
             *    酸を1本ずつ足していく**場合だけ。大きい方を動かすと置き場が見つからず、
             *    グリセリンの2本目・3本目のエステル化が「配置する空間がありません」で
             *    止まっていた
             * ③ 決めた向きで置けなければ、反対向きも試す。できる結合は同じなので化学は変わらない
             */
            const preferAcidMoves = firstSelectedIsIn(alcIds) ||
                (!firstSelectedIsIn(acidIds) && acidIds.length < alcIds.length);
            let plan = null;
            let swap = false;
            for (const tryAcid of (preferAcidMoves ? [true, false] : [false, true])) {
                plan = tryAcid
                    ? planAttachment(mol, alcOId, cId, acidIds, [ohOId])
                    : planAttachment(mol, cId, alcOId, alcIds, [ohOId]);
                if (plan) { swap = tryAcid; break; }
            }
            const movingIds = swap ? acidIds : alcIds;
            if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
            mol.removeBond(cId, ohOId);
            applyAttachment(mol, movingIds, plan);
            mol.addBond(cId, alcOId, 1);
            parkAsWater(mol, ohOId);
            return {
                caption: 'エステル化（縮合）が起こりました。カルボン酸の -OH とアルコールの -H がとれて水になり、エステル結合 -COO- ができます（濃硫酸を触媒に加熱）。同位体で調べると、水の酸素はカルボン酸側から来ることが分かっています。',
                changed: [cId, alcOId]
            };
        }
    },
    {
        id: 'esterification_phenol_info',
        label: '⚠ エステル化（フェノールは進行しにくい）',
        info: true,
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            const carboxyls = groups.filter(g => g.type === 'carboxyl');
            const phenols = groups.filter(g => g.type === 'phenol');
            const sites = [];
            carboxyls.forEach(cx => {
                const comp = componentOf(mol, cx.atomIds[0]);
                phenols.forEach(ph => {
                    if (!comp.has(ph.atomIds[0])) sites.push([cx.atomIds[0], ph.atomIds[0]]);
                });
            });
            return sites;
        },
        apply() {
            return {
                caption: 'フェノールとカルボン酸のエステル化は原理的には可能ですが、フェノールの-OHはベンゼン環との共役で反応性が低く、平衡も生成物側に偏りにくいため、ほとんど進行しません。実際には、カルボン酸より反応性の高い無水酢酸 (CH₃CO)₂O を使ってエステル化します（アセチル化）。下の「アセチル化」ボタンで実行できます。'
            };
        }
    },
    {
        id: 'acetylation_anhydride',
        label: 'アセチル化（無水酢酸 (CH₃CO)₂O）',
        detect(mol) {
            // 対象はフェノールの-OHとアミンの-NH₂（教科書の定番: フェノール→酢酸フェニル、
            // アニリン→アセトアニリド、サリチル酸→アセチルサリチル酸）。
            // **アミドの N は除く**（P12-8 反応判定の精査）: findFunctionalGroups は
            // 「単結合だけで水素が残る N」を一律に amino としているため、アミドの N も
            // 拾ってしまい、アセトアニリド（アニリンをアセチル化した生成物）を
            // さらにアセチル化できてしまっていた
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'phenol' ||
                    (g.type === 'amino' && !isAmideNitrogen(mol, g.atomIds[0])))
                .map(g => [g.atomIds[0]]);
        },
        apply(game, site) {
            const added = attachAcetyl(game.userMolecule, site[0]);
            return {
                caption: '無水酢酸によるアセチル化で、-OH / -NH₂ の水素がアセチル基 CH₃CO- に置き換わりました（副生成物は酢酸）。無水酢酸はカルボン酸より反応性が高いため、直接エステル化が進みにくいフェノールもエステルにできます。アニリンからはアセトアニリド（解熱剤）、サリチル酸からはアセチルサリチル酸（アスピリン）が得られます。',
                changed: [site[0], ...added]
            };
        }
    },
    {
        id: 'dehydration_inter',
        mechanismId: 'ethanol_ether',
        label: '分子間脱水（アルコール2分子, -H₂O） → エーテル',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②水がとれて -O- でつながる
        detect(mol) {
            const alcohols = findFunctionalGroups(mol).filter(g => ALCOHOL_TYPES.includes(g.type));
            const sites = [];
            for (let i = 0; i < alcohols.length; i++) {
                for (let j = i + 1; j < alcohols.length; j++) {
                    const a = alcohols[i];
                    const b = alcohols[j];
                    if (componentOf(mol, a.atomIds[0]).has(b.atomIds[0])) continue; // 別分子どうしのみ
                    sites.push([a.atomIds[0], a.atomIds[1], b.atomIds[0], b.atomIds[1]]);
                }
            }
            return sites;
        },
        apply(game, site) {
            const [oAId, , oBId, cBId] = site;
            const mol = game.userMolecule;
            // B分子のうち、脱離するOを除いた部分を移動させてAのOに結合する
            const movingIds = [...componentOf(mol, cBId)].filter(id => id !== oBId);
            const plan = planAttachment(mol, oAId, cBId, movingIds, [oBId]);
            if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
            mol.removeBond(oBId, cBId);
            applyAttachment(mol, movingIds, plan);
            mol.addBond(oAId, cBId, 1);
            parkAsWater(mol, oBId);
            return {
                caption: '分子間脱水（縮合）でエーテル結合 C-O-C ができました。アルコール2分子から水1分子がとれる反応です（エタノールでは約130〜140℃。より高温の160〜170℃では分子内脱水が優先してアルケンになります）。',
                changed: [oAId, cBId]
            };
        }
    },
    {
        id: 'addition_polymerization',
        label: '付加重合（並べた単量体をまとめて）→ 高分子の繰り返し単位',
        // 同じ単量体が2つ以上あれば、**並んでいる全部を一度に繋ぐ**（P12-8。ユーザー要望
        // 「横一列に単量体を並べた状態から重合するところを見たい」）。
        // 共重合（別の単量体どうし）は高校範囲外なので扱わない
        detect(mol) {
            const groups = new Map(); // 正準コード → [{head, tail, x}]
            vinylBonds(mol).forEach(v => {
                // 1分子に C=C が2本以上あるもの（ブタジエン等）は、どちらを開くかが一意でないので除く
                const compIds = componentOf(mol, v.head);
                if (vinylBonds(mol).filter(w => compIds.has(w.head)).length !== 1) return;
                const code = componentCode(mol, v.head);
                const a = mol.atoms.find(x => x.id === v.head);
                if (!groups.has(code)) groups.set(code, []);
                groups.get(code).push({ head: v.head, tail: v.tail, x: a ? a.x : 0 });
            });
            const sites = [];
            groups.forEach(list => {
                if (list.length < 2) return;
                // 左から右へ並べた順に繋ぐ（画面の並びと繋がる順を一致させる）
                list.sort((p, q) => p.x - q.x);
                sites.push(list.flatMap(v => [v.head, v.tail]));
            });
            return sites;
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const units = [];
            for (let i = 0; i < site.length; i += 2) units.push({ head: site[i], tail: site[i + 1] });
            if (units.length < 2) throw new Error('単量体が2つ以上必要です');
            // 二重結合を単結合に開く（これが付加重合の本体）
            units.forEach(u => {
                const b = mol.getBond(u.head, u.tail);
                if (!b) throw new Error('二重結合が見つかりません');
                b.type = 1;
            });
            // 頭（置換基の多い炭素）に次の単量体の尾（少ない炭素）を繋ぐと、
            // 教科書どおりの「頭-尾（head-to-tail）」の並びになる
            const changed = [];
            let linkFrom = units[0].head;
            for (let i = 1; i < units.length; i++) {
                const u = units[i];
                const movingIds = [...componentOf(mol, u.head)];
                const plan = planAttachment(mol, linkFrom, u.tail, movingIds, []);
                if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
                applyAttachment(mol, movingIds, plan);
                mol.addBond(linkFrom, u.tail, 1);
                changed.push(linkFrom, u.tail);
                linkFrom = u.head; // 次はこの単量体の頭に繋ぐ
            }
            // 両端に R を付けて「ここから先も同じ単位が続く」ことを示す。
            // R は価標1の擬似元素で、アルキル基練習でも使っている既存の表記
            const rIds = [attachR(mol, units[0].tail), attachR(mol, linkFrom)].filter(Boolean);
            const n = units.length;
            return {
                caption: `単量体 ${n} 個が付加重合しました。二重結合が開いて次々に繋がり、繰り返し単位が ${n} 個ぶん並んでいます。` +
                    '両端の R は「この先も同じ単位が続く」という印です（教科書では −[ ]ₙ− の角括弧で書きます）。' +
                    '付加重合では原子が1つも出入りしません（脱水などの副生成物が出ない）ので、' +
                    '単量体の分子式を n 倍したものが高分子の組成になります。' +
                    '鎖が画面に収まるよう表示を引きました。ホイールやピンチで拡大すると、繋がり目を1つずつ確かめられます。',
                changed: [...new Set([...changed, ...rIds])],
                refit: true // 伸びた鎖の全体が見えるように視野を合わせる
            };
        }
    },
    {
        id: 'diene_polymerization',
        label: '1,4-付加重合（共役ジエンを並べて）→ 合成ゴム',
        // 共役ジエン（C1=C2-C3=C4）が同じもの2つ以上。1,3-ブタジエン・イソプレン・クロロプレン
        detect(mol) {
            const groups = new Map();
            conjugatedDienes(mol).forEach(d => {
                const code = componentCode(mol, d.c1);
                const a = mol.atoms.find(x => x.id === d.c1);
                if (!groups.has(code)) groups.set(code, []);
                groups.get(code).push({ d, x: a ? a.x : 0 });
            });
            const sites = [];
            groups.forEach(list => {
                if (list.length < 2) return;
                list.sort((p, q) => p.x - q.x);
                sites.push(list.flatMap(v => [v.d.c1, v.d.c2, v.d.c3, v.d.c4]));
            });
            return sites;
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const units = [];
            for (let i = 0; i < site.length; i += 4) {
                units.push({ c1: site[i], c2: site[i + 1], c3: site[i + 2], c4: site[i + 3] });
            }
            if (units.length < 2) throw new Error('共役ジエンが2つ以上必要です');
            // 1,4-付加重合の本体: 両端の二重結合を開き、**中央に新しい二重結合ができる**。
            // これが「二重結合が移動する」という要点で、ゴムの弾性・加硫の土台になる
            units.forEach(u => {
                const b12 = mol.getBond(u.c1, u.c2), b34 = mol.getBond(u.c3, u.c4);
                const b23 = mol.getBond(u.c2, u.c3);
                if (!b12 || !b34 || !b23) throw new Error('共役ジエンの結合が見つかりません');
                b12.type = 1;
                b34.type = 1;
                b23.type = 2; // 中央へ移った二重結合
            });
            // 端（C4）に次の単量体の端（C1）を繋ぐ＝1位と4位で繋がるので「1,4-付加」
            const changed = [];
            let linkFrom = units[0].c4;
            for (let i = 1; i < units.length; i++) {
                const u = units[i];
                const movingIds = [...componentOf(mol, u.c1)];
                const plan = planAttachment(mol, linkFrom, u.c1, movingIds, []);
                if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
                applyAttachment(mol, movingIds, plan);
                mol.addBond(linkFrom, u.c1, 1);
                changed.push(linkFrom, u.c1);
                linkFrom = u.c4;
            }
            const rIds = [attachR(mol, units[0].c1), attachR(mol, linkFrom)].filter(Boolean);
            const n = units.length;
            return {
                caption: `共役ジエン ${n} 個が 1,4-付加重合しました。両端（1位と4位）の炭素で繋がり、` +
                    `二重結合は両端から中央へ移っています。ここが付加重合との違いで、` +
                    `できた鎖に二重結合が残るため、硫黄で架橋できます（加硫）。` +
                    `天然ゴムはイソプレンがシス形に繋がったもので、同じ形でトランスに繋がるとグタペルカという硬い樹脂になります。` +
                    `いまの図は直交作図なのでシス・トランスを示していません。左の「⇄ シス/トランス整形」で` +
                    `中央の二重結合をタップすると、シス（天然ゴム）とトランス（グタペルカ）を描き分けられます。` +
                    `両端の R は「この先も続く」印です。ホイールやピンチで拡大すると、中央に移った二重結合を1つずつ確かめられます。`,
                changed: [...new Set([...changed, ...rIds])],
                refit: true
            };
        }
    },
    {
        id: 'vulcanization',
        label: '加硫（硫黄で鎖を架橋する）→ 弾性ゴム',
        // 重合でできた鎖（両端に R）の C=C どうしを架橋する。
        // **1本目の架橋で2本の鎖が1分子になっても、続けて架橋できる**必要がある
        // （加硫は同じ鎖の間に何本も橋をかけ、硫黄を増やすとエボナイトになる）。
        // そこで「鎖が2本以上」ではなく「架橋できる C=C の組があるか」で判定する
        detect(mol) {
            const pairs = vulcanizablePairs(mol);
            return pairs.map(p => [p.ca, p.ca2, p.cb, p.cb2]);
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const [ca, ca2, cb, cb2] = site;
            // detect が返した組をそのまま使う（置ける位置は detect 側で確かめてある）
            const best = vulcanizablePairs(mol)
                .find(p => p.ca === ca && p.ca2 === ca2 && p.cb === cb && p.cb2 === cb2);
            if (!best) {
                throw new Error('鎖の間に硫黄を置く空間がありません。2本の鎖を1マスあけて並べてから実行してください');
            }
            const ab = mol.getBond(best.ca, best.ca2), bb = mol.getBond(best.cb, best.cb2);
            if (!ab || !bb || ab.type !== 2 || bb.type !== 2) throw new Error('二重結合が残っていません');
            // 硫黄が二重結合の炭素に付く＝二重結合が単結合になり、そこに架橋ができる。
            // 硫黄は S=O を持たないので2価として扱われ、余分な水素は描かれない（v283）
            ab.type = 1;
            bb.type = 1;
            const s = mol.addAtom('S', best.sx, best.sy);
            mol.addBond(best.ca, s.id, 1);
            mol.addBond(best.cb, s.id, 1);
            const a1 = best.ca, b1 = best.cb;
            return {
                caption: '加硫が1か所進みました。硫黄が2本の鎖のあいだに入って架橋（橋かけ）しています。' +
                    'ゴムに二重結合が残っているのは 1,4-付加重合の結果で、そこに硫黄が結びつきます。' +
                    '架橋ができると鎖どうしがずれにくくなり、伸ばしても元に戻る弾性ゴムになります。' +
                    '硫黄を多く加えて架橋を増やすと、硬くて弾性のないエボナイトになります。' +
                    'もう一度押すと別の場所も架橋できます。',
                changed: [a1, b1, s.id],
                refit: true
            };
        }
    },
    {
        id: 'condensation_polymer_info',
        label: '⚠ 縮合重合になる組み合わせ',
        info: true,
        // 2価カルボン酸と2価アルコール／2価アミンが揃っているとき。実際の連結は
        // 既存の「エステル化」「アセチル化」で1段ずつ進められるので、ここでは説明だけ出す
        detect(mol) {
            const partners = condensationPolymerPartners(mol);
            return partners ? [[partners.acidId, partners.otherId]] : [];
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const info = condensationPolymerPartners(mol);
            const kind = info && info.kind === 'amine' ? 'アミド' : 'エステル';
            return {
                caption: `2つずつ反応できる基を持った分子が揃っています。これは縮合重合（${kind}結合をくり返しつくる）の組み合わせです。` +
                    `付加重合と違い、つなぐたびに水がとれます（だから「縮合」）。` +
                    `実際に1段つなぐには「エステル化」や「アセチル化」を使ってください。` +
                    `両端にまだ反応できる基が残るので、そこにさらに単量体をつなぐと鎖が伸びていきます。`,
                changed: []
            };
        }
    },
    {
        id: 'add_br2',
        mechanismId: 'ethene_br2',
        label: '付加: Br₂（臭素水の脱色）',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, 'Br', 'Br',
                '臭素 Br₂ が付加しました。赤褐色の臭素水が脱色されるこの反応は、C=C や C≡C（不飽和結合）の検出に使われます。');
        }
    },
    {
        id: 'add_h2',
        label: '付加: H₂（水素化・Ni触媒）',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, null, null,
                '水素 H₂ が付加しました（ニッケルや白金を触媒に加熱）。不飽和結合が減って飽和に近づきます。植物油に水素を付加して固める硬化油（マーガリンの原料）はこの反応の応用です。');
        }
    },
    {
        id: 'add_hbr',
        label: '付加: HBr（マルコフニコフ則）',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, 'Br', null,
                '臭化水素 HBr が付加しました。左右非対称なアルケンでは「H はすでに H の多い炭素へ、X は置換基の多い炭素へ」付く主生成物を示しています（マルコフニコフ則）。');
        }
    },
    {
        id: 'add_water',
        mechanismId: 'ethene_h2o',
        label: '付加: H₂O（酸触媒・水和）',
        detect: multipleBondSites,
        apply(game, site) {
            const mol = game.userMolecule;
            const bond = mol.getBond(site[0], site[1]);
            if (bond && bond.type === 3) {
                // アルキンの水和: エノール（C=C-OH）は不安定なので、教科書どおり
                // ケト・エノール互変異性でケト形（C=O）を直接生成する
                // （アセチレン→アセトアルデヒド、プロピン→アセトン）
                const [id1, id2] = site;
                const subs = (id, other) => mol.getNeighbors(id)
                    .filter(n => n.atom.element === 'C' && n.atom.id !== other).length;
                const cX = subs(id2, id1) > subs(id1, id2) ? id2 : id1; // マルコフニコフ則
                const spot = freeSpotAround(mol, cX);
                if (!spot) throw new Error('生成物を配置する空間がありません。まわりを空けてから実行してください');
                bond.type = 1;
                const o = mol.addAtom('O', spot.x, spot.y);
                mol.addBond(cX, o.id, 2);
                return {
                    caption: '三重結合に水が付加しました。まず不安定なエノール（C=C-OH）ができますが、ただちにケト形（C=O）へ変化します（ケト・エノール互変異性）。アセチレンからはアセトアルデヒドが得られます（かつてのアセトアルデヒド工業的製法）。',
                    changed: [id1, id2, o.id]
                };
            }
            return addAcrossMultipleBond(game, site, 'O', null,
                '水 H₂O が付加してアルコールになりました（リン酸などの酸触媒）。エテンからエタノールを作る工業的製法がこの反応です。非対称アルケンではマルコフニコフ則に従う主生成物を示しています。');
        }
    },
    {
        // 環から電子を引く基が2つ以上あると、求電子置換は非常に起こりにくくなる。
        // 候補は残す（実行はできる）が、そのままだと「ふつうに進む反応」に見えるので注意を出す
        id: 'aromatic_deactivated_info',
        label: '⚠ 置換が起こりにくい環',
        info: true,
        detect(mol) {
            const keys = findAromaticBondKeys(mol);
            const aromatic = new Set();
            mol.bonds.forEach(b => {
                const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
                if (keys.has(k)) { aromatic.add(b.atomId1); aromatic.add(b.atomId2); }
            });
            if (aromatic.size === 0) return [];
            const pulling = [...aromatic]
                .map(id => ringDirector(mol, id, aromatic))
                .filter(d => d && d.kind === 'm');
            if (pulling.length < 2) return [];
            // 置換できる場所が残っているときだけ注意する意味がある
            return aromaticSites(mol, 'nitro').length > 0 ? [[...aromatic][0]] : [];
        },
        apply() {
            return {
                caption: 'この環には、電子を引く基（-NO₂・-SO₃H・-COOH など）が2つ以上ついています。' +
                    '環の電子が少なくなっているため、求電子置換（ニトロ化・スルホン化・ハロゲン化）は' +
                    '非常に進みにくくなります（トリニトロトルエンのように、強い条件でようやく進みます）。' +
                    'このアプリでは操作として実行できますが、実際には激しい条件が要ることを覚えておいてください。'
            };
        }
    },
    {
        id: 'aromatic_nitration',
        mechanismId: 'benzene_nitration',
        label: '芳香族置換: ニトロ化（濃硝酸＋濃硫酸）',
        detect: (mol) => aromaticSites(mol, 'nitro'),
        apply(game, site) {
            // 配向性は書き換える前の環で判断する（自分が足した基を数えないため）
            const note = orientationNote(game.userMolecule, site[0]);
            const added = attachGroup(game.userMolecule, site[0], 'nitro');
            return {
                caption: 'ベンゼン環がニトロ化されました。濃硝酸と濃硫酸の混酸から生じたニトロニウムイオン NO₂⁺ が環を攻撃する求電子置換反応です。付加ではなく置換になるのは、芳香族性を保つ方が安定なためです。' + note,
                changed: [site[0], ...added]
            };
        }
    },
    {
        id: 'aromatic_sulfonation',
        mechanismId: 'benzene_sulfonation',
        label: '芳香族置換: スルホン化（濃硫酸）',
        detect: (mol) => aromaticSites(mol, 'sulfo'),
        apply(game, site) {
            const note = orientationNote(game.userMolecule, site[0]);
            const added = attachGroup(game.userMolecule, site[0], 'sulfo');
            return {
                caption: 'ベンゼン環がスルホン化され、スルホ基 -SO₃H が付きました（濃硫酸と加熱）。生成物のベンゼンスルホン酸は強酸で、水に溶けやすくなります。' + note,
                changed: [site[0], ...added]
            };
        }
    },
    {
        id: 'aromatic_halogenation',
        mechanismId: 'benzene_chlorination',
        label: '芳香族置換: 塩素化（Cl₂・鉄触媒）',
        detect: (mol) => aromaticSites(mol, 'Cl'),
        apply(game, site) {
            const note = orientationNote(game.userMolecule, site[0]);
            const added = attachGroup(game.userMolecule, site[0], 'Cl');
            return {
                caption: 'ベンゼン環が塩素化されました（鉄または塩化鉄(III)を触媒に Cl₂ と反応）。触媒が Cl-Cl 結合を分極させ、塩素が求電子剤として働きます。同時に塩化水素 HCl が発生します。' + note,
                changed: [site[0], ...added]
            };
        }
    },
    {
        // 酸無水物の加水分解（P12-8）。形は -CO-O- でエステルと同じだが、別の反応。
        // 無水酢酸＋水→酢酸2分子、無水フタル酸＋水→フタル酸。けん化とは呼ばない
        id: 'hydrolysis_anhydride',
        label: '加水分解（酸無水物 + H₂O） → カルボン酸',
        detect(mol) {
            const seen = new Set();
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'ester' && isAnhydrideLinkage(mol, g.atomIds[2], g.atomIds[0]))
                // -CO-O-CO- は2つのカルボニルから同じ酸素が見えるので、酸素ごとに1件へまとめる
                .filter(g => { if (seen.has(g.atomIds[2])) return false; seen.add(g.atomIds[2]); return true; })
                .map(g => g.atomIds);
        },
        apply(game, site) {
            const [cId, , oId] = site;
            const mol = game.userMolecule;
            const ring = ringAtomIdsOf(mol).has(oId); // 環状の酸無水物（無水フタル酸など）
            mol.removeBond(cId, oId);
            const part = [...componentOf(mol, oId)];
            if (!part.includes(cId)) {
                const sep = separateComponent(mol, part);
                if (sep) translateAtoms(mol, part, sep.dx, sep.dy);
            }
            const spot = freeSpotAround(mol, cId);
            if (!spot) throw new Error('生成物を配置する空間がありません。結合を伸ばして空間を作ってから実行してください');
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(cId, o.id, 1);
            return {
                caption: '酸無水物が加水分解されました（-CO-O-CO- + H₂O → -COOH が2つ）。' +
                    (ring
                        ? '環状の酸無水物なので、環が開いて1つの分子に2つのカルボキシ基ができます（無水フタル酸 → フタル酸）。'
                        : '無水酢酸なら酢酸2分子になります。') +
                    'エステルの加水分解と形は似ていますが、酸無水物はカルボン酸より反応性が高く、水と容易に反応します（アセチル化の試薬に使えるのはこのためです）。この反応は「けん化」とは呼びません。',
                changed: [cId, o.id]
            };
        }
    },
    {
        id: 'hydrolysis_ester',
        label: '加水分解（エステル + H₂O, 酸を触媒に加熱）',
        detect(mol) { return detectEsterLinkages(mol); },
        apply(game, site) { return cleaveEster(game, site, false); }
    },

    // けん化は加水分解と**生成物が違う**。NaOH を使うので、できるのは
    // カルボン酸ではなく**カルボン酸のナトリウム塩**（油脂なら脂肪酸ナトリウム＝石けんそのもの）。
    // 塩になると逆のエステル化が起こらないので反応は完全に進む。
    // 2026-08-01 の検品レビュー A-1。それまでは1つのルールが「けん化・加水分解」を名乗りながら
    // 酸のままのカルボン酸を出しており、V19 のナレーションと食い違っていた
    {
        id: 'saponification',
        mechanismId: 'saponification',
        label: 'けん化（エステル + NaOH, 加熱）→ カルボン酸の塩',
        detect(mol) { return detectEsterLinkages(mol); },
        apply(game, site) { return cleaveEster(game, site, true); }
    },

    // ===== 鎖状⇄環状の平衡（グルコースの環化・開環／変旋光。P12-7 M2d） =====
    // 糖の環化は「C5 の -OH 酸素が C1 のカルボニル炭素を攻撃して環を閉じる」分子内反応。
    // 立体は自分で導出せず、**登録済みエントリ（鎖状・α/β ピラノース）の座標を対応表で移す**。
    // 対応表は Node で検証済み（環化結果の立体コードが登録 α/β と完全一致）。
    // 対象はグルコースに限定する（他のアルドースはフィッシャー⇄ハースの面対応が別で、
    // 誤った立体を生む危険があるため。将来エントリを揃えてから拡張する）。
    {
        id: 'cyclize_glucose_beta',
        label: '環化 → β-D-グルコース（β-D-グルコピラノース）',
        morphStages: 'moveFirst', // ①環の形に折りたたむ → ②結合ができて環が閉じる
        detect(mol) { return detectGlucoseChain(mol); },
        apply(game, site) { return applyCyclize(game, site, REGISTERED_NAMES.beta); }
    },
    {
        id: 'cyclize_glucose_alpha',
        label: '環化 → α-D-グルコース（α-D-グルコピラノース）',
        morphStages: 'moveFirst', // ①環の形に折りたたむ → ②結合ができて環が閉じる
        detect(mol) { return detectGlucoseChain(mol); },
        apply(game, site) { return applyCyclize(game, site, REGISTERED_NAMES.alpha); }
    },
    {
        id: 'open_glucopyranose',
        label: '開環 → 鎖状の D-グルコース',
        morphStages: 'bondsFirst', // ①環の配置のまま開く → ②鎖状に整列する
        detect(mol) { return detectGlucopyranose(mol); },
        apply(game, site) { return applyOpenRing(game, site); }
    }
];

// ---- 相手の分子が要る反応の案内（レビュー項目14） ----

/**
 * 「酢酸だけを作ると可能な反応が出ず、案内も無い」への対処。
 *
 * 足りないのは**相手の分子**であって、その分子が反応しないわけではない。
 * どの相手を呼べばどの反応ができるかは、ルールごとに書き写すのではなく
 * **実際に相手を足した分子でルールの detect を回して確かめる**（＝ルールの定義とずれない。
 * 反応を足したときに案内だけ古くなる、という壊れ方をしない）。
 *
 * 候補は「名称から呼び出す」で実際に呼べるものだけにする（案内をそのまま実行できるように）。
 */
const PARTNER_CANDIDATES = ['エタノール', 'メタノール', '酢酸', 'グリセリン', 'フェノール'];

// mol の一部（ids が null なら全部）を dest へ複製する。x を dx ずらして置く。
// 返り値は dest 側で新しく作られた原子IDの集合
function copyMoleculeInto(dest, src, ids, dx) {
    const map = new Map();
    const added = new Set();
    src.atoms.forEach(a => {
        if (ids && !ids.has(a.id)) return;
        const na = dest.addAtom(a.element, a.x + dx, a.y);
        map.set(a.id, na.id);
        added.add(na.id);
    });
    src.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) {
            dest.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
        }
    });
    return added;
}

// 「この相手を呼び出すとこの反応ができる」の一覧を返す（1つの反応につき候補は1つまで）
function findPartnerHints(game, baseIds) {
    const mol = game.userMolecule;
    const heavy = mol.atoms.filter(a => a.element !== 'H' && (!baseIds || baseIds.has(a.id)));
    if (heavy.length === 0 || heavy.length > 30) return []; // 大きな分子では総当たりが重い
    const library = game.getCompoundLibrary();
    const hits = [];
    const seenRules = new Set();
    PARTNER_CANDIDATES.forEach(name => {
        const entry = library.find(e => e.name === name);
        if (!entry) return;
        const trial = new Molecule();
        const mine = copyMoleculeInto(trial, mol, baseIds, 0);
        const maxX = Math.max(...trial.atoms.map(a => a.x), 0);
        const minX = Math.min(...entry.mol.atoms.map(a => a.x), 0);
        const theirs = copyMoleculeInto(trial, entry.mol, null, maxX - minX + 400);
        REACTION_RULES.forEach(rule => {
            if (rule.info || seenRules.has(rule.id)) return;
            let sites = [];
            try {
                sites = rule.detect(trial);
            } catch (e) {
                return; // 案内のための試算なので、落ちたルールは黙って飛ばす
            }
            // 「相手を足したからできた」＝ 箇所が2分子にまたがっているものだけを拾う
            const crosses = sites.some(s => Array.isArray(s) &&
                s.some(id => mine.has(id)) && s.some(id => theirs.has(id)));
            if (!crosses) return;
            seenRules.add(rule.id);
            hits.push({ name, label: rule.label });
        });
    });
    return hits;
}

// 「確実層」が compounds.json を**名前で引く**ときのキー（P12-7 M2d）。
// 名前はデータ側の表示名なので変わりうる。散らばっていると改名で静かに壊れるため
// ここ1か所に集め、**実在することをテスト RX11 で確かめる**（mechanismId の死にリンク検査と同じ考え方）
const REGISTERED_NAMES = {
    chain: 'D-グルコース（鎖状）',
    beta: 'β-D-グルコース（β-D-グルコピラノース）',
    alpha: 'α-D-グルコース（α-D-グルコピラノース）'
};

// ---- 鎖状⇄環状の共通処理（P12-7 M2d） ----

// 登録エントリ（compounds.json）の target を名前で引く
function registeredTarget(name) {
    const list = (typeof COMPOUNDS !== 'undefined' && COMPOUNDS) || (typeof window !== 'undefined' && window.COMPOUNDS) || [];
    const e = list.find(c => c.name === name);
    return e ? e.target : null;
}

// 分子が登録エントリ（名前）と同一物か、立体込みで判定する。
// 立体コードが一致＝同じ立体異性体（描いた向きの違いは正しく別物として扱われる）
function isRegisteredCompound(mol, name) {
    const t = registeredTarget(name);
    if (!t || typeof canonicalStereoCode !== 'function') return false;
    const ref = new Molecule();
    const ids = t.atoms.map(a => ref.addAtom(a.element, a.x, a.y).id);
    t.bonds.forEach(b => ref.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
    const code = m => canonicalStereoCode(m, {
        atomParity: { ...readAtomParityFromFischer(m), ...readRingParityFromHaworth(m) }
    });
    return canonicalCode(mol) === canonicalCode(ref) && code(mol) === code(ref);
}

// 鎖状 D-グルコースを検出し、[C1..C6, O(カルボニル), O2, O3, O4, O5, O6] の順にIDを返す。
// 順序は登録エントリ（compounds.json の D-グルコース（鎖状））の原子並びと同じ意味づけ。
function detectGlucoseChain(mol) {
    if (!isRegisteredCompound(mol, REGISTERED_NAMES.chain)) return [];
    // C1 = C=O を持つ炭素（アルデヒド）
    let c1 = null, oCarbonyl = null;
    mol.atoms.forEach(a => {
        if (a.element !== 'C') return;
        const dbl = mol.getNeighbors(a.id).find(n => n.type === 2 && n.atom.element === 'O');
        if (dbl) { c1 = a; oCarbonyl = dbl.atom; }
    });
    if (!c1) return [];
    // 炭素鎖を C1 から順にたどる
    const carbons = [c1];
    const seen = new Set([c1.id]);
    while (carbons.length < 6) {
        const last = carbons[carbons.length - 1];
        const next = mol.getNeighbors(last.id).find(n => n.atom.element === 'C' && !seen.has(n.atom.id));
        if (!next) return [];
        seen.add(next.atom.id);
        carbons.push(next.atom);
    }
    // 各炭素の -OH 酸素（C1 のカルボニル O は除く）
    const ohOf = c => {
        const n = mol.getNeighbors(c.id).find(x => x.atom.element === 'O' && x.type === 1);
        return n ? n.atom : null;
    };
    const ohs = carbons.slice(1).map(ohOf);
    if (ohs.some(o => !o)) return [];
    return [[...carbons.map(c => c.id), oCarbonyl.id, ...ohs.map(o => o.id)]];
}

// α/β-D-グルコピラノースを検出し、[C1..C6, O(アノマーOH), O2, O3, O4, O5(環内), O6] を返す
function detectGlucopyranose(mol) {
    const name = [REGISTERED_NAMES.beta, REGISTERED_NAMES.alpha].find(n => isRegisteredCompound(mol, n));
    if (!name) return [];
    const ringIds = ringAtomIdsOf(mol);
    const ringO = mol.atoms.find(a => a.element === 'O' && ringIds.has(a.id));
    if (!ringO) return [];
    // 環内酸素の隣の炭素2つ: C1 は環外に -OH（酸素）、C5 は環外に -CH2OH（炭素）
    const nbrs = mol.getNeighbors(ringO.id).filter(n => ringIds.has(n.atom.id) && n.atom.element === 'C');
    if (nbrs.length !== 2) return [];
    // 環外の隣接原子（指定元素）を返す。getNeighbors は {atom, type} を返すので atom を取り出す
    const exoOf = (c, el) => {
        const n = mol.getNeighbors(c.id).find(x => !ringIds.has(x.atom.id) && x.atom.element === el);
        return n ? n.atom : null;
    };
    let c1 = null, c5 = null, anomerO = null;
    nbrs.forEach(n => {
        const o = exoOf(n.atom, 'O');
        if (o) { c1 = n.atom; anomerO = o; } else if (exoOf(n.atom, 'C')) { c5 = n.atom; }
    });
    if (!c1 || !c5 || !anomerO) return [];
    // C1 から環をたどって C2,C3,C4,C5 の順に得る
    const carbons = [c1];
    const seen = new Set([c1.id, ringO.id]);
    while (carbons.length < 5) {
        const last = carbons[carbons.length - 1];
        const next = mol.getNeighbors(last.id).find(n => ringIds.has(n.atom.id) && n.atom.element === 'C' && !seen.has(n.atom.id));
        if (!next) return [];
        seen.add(next.atom.id);
        carbons.push(next.atom);
    }
    const c6 = exoOf(c5, 'C');
    if (!c6) return [];
    const o6 = mol.getNeighbors(c6.id).find(n => n.atom.element === 'O');
    if (!o6) return [];
    const ohs = carbons.slice(1, 4).map(c => {
        const o = mol.getNeighbors(c.id).find(n => !ringIds.has(n.atom.id) && n.atom.element === 'O');
        return o ? o.atom : null;
    });
    if (ohs.some(o => !o)) return [];
    return [[...carbons.map(c => c.id), c6.id, anomerO.id, ...ohs.map(o => o.id), ringO.id, o6.atom.id]];
}

// いずれかの環に属する原子ID集合（chemistry.js の環判定と同じ考え方）
function ringAtomIdsOf(mol) {
    const inRing = new Set();
    mol.bonds.forEach(bond => {
        const visited = new Set([bond.atomId1]);
        const stack = [bond.atomId1];
        while (stack.length) {
            const id = stack.pop();
            mol.bonds.forEach(b => {
                if (b === bond) return;
                const other = b.atomId1 === id ? b.atomId2 : b.atomId2 === id ? b.atomId1 : null;
                if (other && !visited.has(other)) { visited.add(other); stack.push(other); }
            });
        }
        if (visited.has(bond.atomId2)) { inRing.add(bond.atomId1); inRing.add(bond.atomId2); }
    });
    return inRing;
}

// site（鎖状の並び）を、登録された環エントリの座標へ移して環を閉じる。
// 鎖状 index → 環 index の対応（Node 検証済み）:
//   C1..C5 → 環 C1..C5 ／ C6 → 環の CH2OH 炭素 ／ カルボニルO → アノマーOH ／
//   C2..C4 の OH → 同左 ／ **C5 の OH 酸素 → 環内酸素** ／ C6 の OH → 同左
function applyCyclize(game, site, ringName) {
    const t = registeredTarget(ringName);
    if (!t) throw new Error('環状の登録データが見つかりません');
    const mol = game.userMolecule;
    const [c1, c2, c3, c4, c5, c6, oCarb, o2, o3, o4, o5, o6] = site;
    // site の並び（鎖状） → 登録環エントリの原子 index
    const RING_INDEX = [1, 2, 3, 4, 5, 10, 6, 7, 8, 9, 0, 11];
    const order = [c1, c2, c3, c4, c5, c6, oCarb, o2, o3, o4, o5, o6];
    // 現在の重心を保って配置する（描いた場所の近くに出す）
    const cur = order.map(id => mol.atoms.find(a => a.id === id));
    const cx = cur.reduce((s, a) => s + a.x, 0) / cur.length;
    const cy = cur.reduce((s, a) => s + a.y, 0) / cur.length;
    const tx = t.atoms.reduce((s, a) => s + a.x, 0) / t.atoms.length;
    const ty = t.atoms.reduce((s, a) => s + a.y, 0) / t.atoms.length;
    order.forEach((id, i) => {
        const a = mol.atoms.find(x => x.id === id);
        const ref = t.atoms[RING_INDEX[i]];
        a.x = ref.x - tx + cx;
        a.y = ref.y - ty + cy;
    });
    // 結合の書き換え: C1=O を単結合に（→ アノマーの -OH）、C5 の OH 酸素と C1 を結んで環を閉じる
    mol.getBond(c1, oCarb).type = 1;
    mol.addBond(o5, c1, 1);
    const isBeta = ringName.startsWith('β');
    return {
        caption: `鎖状のグルコースが環を閉じて${ringName}になりました。アニメーションは2段階です: ①まず鎖が環の形に折りたたまれ（C5 の -OH が C1 に近づく）、②そのあと結合ができて環が閉じます。C5 の -OH の酸素が C1（アルデヒドの炭素）を攻撃して結合し、C=O が -OH に変わります。このとき新しくできた C1 の -OH が環の上側を向くと β、下側を向くと α です（${isBeta ? 'β' : 'α'}）。水溶液中では鎖状を経由して α と β が行き来し、この平衡を変旋光といいます。「開環 → 鎖状の D-グルコース」でもとに戻せます。`,
        changed: [c1, oCarb, o5]
    };
}

// 環状（α/β）を開いて鎖状 D-グルコースに戻す（環化の逆）
function applyOpenRing(game, site) {
    const t = registeredTarget(REGISTERED_NAMES.chain);
    if (!t) throw new Error('鎖状の登録データが見つかりません');
    const mol = game.userMolecule;
    const [c1, c2, c3, c4, c5, c6, anomerO, o2, o3, o4, ringO, o6] = site;
    // 環の並び → 鎖状エントリの原子 index（applyCyclize の逆写像）
    const CHAIN_INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const order = [c1, c2, c3, c4, c5, c6, anomerO, o2, o3, o4, ringO, o6];
    const cur = order.map(id => mol.atoms.find(a => a.id === id));
    const cx = cur.reduce((s, a) => s + a.x, 0) / cur.length;
    const cy = cur.reduce((s, a) => s + a.y, 0) / cur.length;
    const tx = t.atoms.reduce((s, a) => s + a.x, 0) / t.atoms.length;
    const ty = t.atoms.reduce((s, a) => s + a.y, 0) / t.atoms.length;
    order.forEach((id, i) => {
        const a = mol.atoms.find(x => x.id === id);
        const ref = t.atoms[CHAIN_INDEX[i]];
        a.x = ref.x - tx + cx;
        a.y = ref.y - ty + cy;
    });
    // 環内酸素と C1 の結合を切り、アノマーの -OH を C=O に戻す
    mol.removeBond(ringO, c1);
    mol.getBond(c1, anomerO).type = 2;
    return {
        caption: '環が開いて鎖状の D-グルコースになりました。アニメーションは2段階です: ①まず環の配置のまま C1 と環内酸素の結合だけが切れ（教科書の「開いた瞬間」の形）、②そのあと鎖状の形に整列します。C1 の -OH が C=O（アルデヒド）に戻り、環内の酸素は C5 の -OH に戻ります。鎖状ではアルデヒド基が現れるため、銀鏡反応やフェーリング液の還元を示します（グルコースが還元糖である理由）。ここから「環化」を選ぶと α・β のどちらにもなれます。',
        changed: [c1, anomerO, ringO]
    };
}

class Reactor {
    constructor(game) {
        this.game = game;
        this.actionsEl = document.getElementById('reaction-actions');
        this.picking = null; // {rule, sites} 適用箇所の選択待ち
        // 直近反応のスナップショット（前後比較・機構ジャンプ用。P12-5 第1弾）。
        // { ruleId, mechanismId, label, before, after }。before/after はキャンバス全体の
        // 独立コピー（原子ID付き）。直近1件のみ保持し、次の反応で上書き・全消去/モード離脱で破棄
        this.lastReaction = null;
        this.compareOverlay = document.getElementById('rx-compare-overlay');
        this._compareScale = 'md';
        this._compareOpen = false;
        // 実行時モーフィング（P12-5 第2弾）。表示のみ・分子データには一切影響しない
        this._morphing = false;
        this._morphSkip = false;
        this._morphGen = 0;
        // 2段階モーフィングの中間で停止しているときの状態（P12-7 M2f）。
        // { mid, after, gen, highlight } を保持し、クリックで第2段階へ進む
        this._morphPause = null;
        // 「相手の分子が要る反応」の案内のキャッシュ（レビュー項目14）。{ key, hints }
        this._hintCache = null;
    }

    // 「⚗ この分子の反応」カードのボタン列を再構築する（updateDrawing のたびに呼ばれる）
    refresh() {
        if (!this.actionsEl) return;
        this.actionsEl.innerHTML = '';
        this.picking = null;
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return;
        const mol = this.game.userMolecule;
        if (mol.atoms.filter(a => a.element !== 'H').length === 0) {
            // 全消去したら前後比較の記録・モーフィング再生は破棄する（設計 8.1）。
            // 呼び出し元 updateDrawing が空画面を描いた後なので、世代を進めて走行中ループを無効化する
            this._morphGen++;
            this._morphing = false;
            this._morphSkip = false;
            this.exitCompare();
            return;
        }

        // 分子を選んでいるときは「その分子が関わる反応」だけに絞る（C-1。2026-08-01 ユーザー要望）。
        // 判定は箇所（site）の原子がどの分子に属するかだけを見るので、ルールごとの知識が要らない。
        //
        //   0個 … 絞らない
        //   1個 … その分子の原子を含む箇所（相手はキャンバスの誰でもよい）
        //   2個以上 … 箇所が選択の中で完結し、かつ**2つ以上の選択分子に跨る**こと
        //
        // 「**すべての**選択分子に跨る」は2分子専用の条件で、3つ選んだ瞬間に
        // 2分子反応が全滅する（1回の反応が跨れるのは常に2分子だから）。
        // 油脂やジエステルは同じ反応を2〜3回繰り返して作るので、
        // 3分子以上を選んだままでも候補が出続けないと途中で手が止まる（レビュー項目15）
        const selSets = this.game.selectedMoleculeSets ? this.game.selectedMoleculeSets() : [];
        const allSel = new Set();
        selSets.forEach(s => s.forEach(id => allSel.add(id)));
        const siteAllowed = site => {
            if (!selSets.length) return true;
            const ids = Array.isArray(site) ? site.filter(x => typeof x === 'string') : [];
            if (!ids.length) return true; // 箇所を持たない情報カードなどは絞らない
            if (selSets.length === 1) return ids.some(id => allSel.has(id));
            if (!ids.every(id => allSel.has(id))) return false;
            return selSets.filter(s => ids.some(id => s.has(id))).length >= 2;
        };
        this.renderSelectionNote(selSets);

        let executable = 0; // 実際に押して進められる反応の数（⚠ の解説カードは数えない）
        REACTION_RULES.forEach(rule => {
            let sites = [];
            try {
                sites = rule.detect(mol);
            } catch (e) {
                console.error('反応ルール検出エラー:', rule.id, e);
                return;
            }
            if (selSets.length && !rule.info) sites = sites.filter(siteAllowed);
            if (sites.length === 0) return;
            if (!rule.info) executable++;
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px;';
            btn.textContent = rule.label + (sites.length > 1 && !rule.info ? `（${sites.length}箇所）` : '');
            btn.addEventListener('click', () => this.onRuleClick(rule, sites));
            this.actionsEl.appendChild(btn);
        });

        // 押せる反応が1つも無いときは、そこで手が止まらないよう次の一手を案内する（項目14）
        if (executable === 0) this.renderPartnerHints(allSel.size ? allSel : null);

        // 直近反応があれば「前後を見る」ボタンを出す（P12-5 第1弾）
        if (this.lastReaction) {
            const cmp = document.createElement('button');
            cmp.className = 'view-btn';
            cmp.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
                'border-color:var(--neon-blue); color:var(--neon-blue);';
            cmp.textContent = `🔍 反応の前後を見る（${this.lastReaction.label}）`;
            cmp.addEventListener('click', () => this.openCompare());
            this.actionsEl.appendChild(cmp);
            // 機構が登録されている反応なら、機構ビューアへジャンプするボタンも出す
            if (this.lastReaction.mechanismId) {
                this.actionsEl.appendChild(this.makeMechanismButton());
            }
        }
    }

    /**
     * 案内の総当たり（候補5件 × 全ルールの detect）は分子が大きいと数十msかかる。
     * `refresh()` は作図のたびに走るので、**結合のつながりが変わったときだけ**計算し直す。
     * 座標だけが動く操作（ドラッグ・パン）ではキーが変わらないため、そのまま使い回せる
     * （ルールの detect はトポロジーだけを見ているので、座標で結果は変わらない）
     */
    cachedPartnerHints(baseIds) {
        const mol = this.game.userMolecule;
        const key = (baseIds ? [...baseIds].sort().join(',') : 'all') + '#' +
            mol.atoms.map(a => `${a.id}:${a.element}`).sort().join(',') + '#' +
            mol.bonds.map(b => `${b.atomId1}-${b.atomId2}:${b.type}`).sort().join(',');
        if (this._hintCache && this._hintCache.key === key) return this._hintCache.hints;
        const hints = findPartnerHints(this.game, baseIds);
        this._hintCache = { key, hints };
        return hints;
    }

    /**
     * 「可能な反応がない」で止まったときに、**足りないもの**と**次の一手**を出す（レビュー項目14）。
     *
     * 酢酸だけを作ってもボタンが1つも出ないのは、酢酸が反応しないからではなく
     * エステル化の相手（アルコール）がキャンバスに無いから。呼び出す相手の名前を
     * そのままボタンにして、「名称から分子を呼び出す」につなぐ。
     */
    renderPartnerHints(baseIds) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        const hints = this.cachedPartnerHints(baseIds);
        if (hints.length === 0) {
            note.textContent = 'いまの分子でできる反応は登録されていません。' +
                '原子や結合を足すか、別の分子を呼び出してみてください。';
            this.actionsEl.appendChild(note);
            return;
        }
        note.textContent = 'この分子だけではできる反応がありません。' +
            '下の反応にはもう1つ分子が要ります。相手を呼び出すとできます:';
        this.actionsEl.appendChild(note);
        hints.forEach(h => {
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
                'border-color:var(--neon-green); color:var(--neon-green);';
            btn.textContent = `＋ ${h.name} を呼び出す → ${h.label}`;
            btn.title = `${h.name} をキャンバスに置くと「${h.label}」が選べるようになります`;
            btn.addEventListener('click', () => {
                this.game.summonMolecule(h.name);
            });
            this.actionsEl.appendChild(btn);
        });
    }

    // 選択中の分子を反応カードに文で出す（C-1）。式の並びを先に見せてから反応を選ばせる
    renderSelectionNote(selSets) {
        const el = document.getElementById('reaction-selection');
        if (!el) return;
        if (!selSets.length) { el.textContent = ''; return; }
        const nameOf = ids => {
            const part = new Molecule();
            const map = new Map();
            this.game.userMolecule.atoms.forEach(a => {
                if (ids.has(a.id)) map.set(a.id, part.addAtom(a.element, a.x, a.y).id);
            });
            this.game.userMolecule.bonds.forEach(b => {
                if (map.has(b.atomId1) && map.has(b.atomId2)) {
                    part.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
                }
            });
            const hit = this.game.getCompoundLibrary()
                .find(e => canonicalCode(e.mol) === canonicalCode(part));
            return hit ? hit.name : '選んだ分子';
        };
        const names = selSets.map(nameOf);
        if (names.length === 1) {
            el.textContent = `選択中: ${names[0]}（この分子でできる反応だけを出しています）`;
            return;
        }
        // **「2 エタノール」とは書かない**（レビュー項目15）。化学の文脈では係数、
        // つまり「エタノール2分子」と読めてしまう。順番であることを「番目」で言い切る。
        // 丸数字も使わない（図の下の見出しが使う番号＝キャンバスの通し番号と意味が違う）
        el.textContent = '選択中（左から順）: ' +
            names.map((n, i) => `${i + 1}番目 ${n}`).join(' ＋ ') +
            '。同じ反応を続けて起こすときも、この絞り込みは効いたままです。';
    }

    // 「この反応の機構を見る（代表例）」ボタンを作る（反応カード・比較オーバーレイで共用）
    makeMechanismButton() {
        const mech = document.createElement('button');
        mech.className = 'view-btn';
        mech.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
            'border-color:var(--neon-pink); color:var(--neon-pink);';
        mech.textContent = '⚗ この反応の機構を見る（代表例）';
        mech.addEventListener('click', () => this.jumpToMechanism());
        return mech;
    }

    // 反応機構ビューア（学習モード）へ切り替えて、対応する機構を代表例の分子で再生する。
    // ユーザーの分子そのものではなく代表例で再生する旨を注記する（設計 8.1）
    jumpToMechanism() {
        const rx = this.lastReaction;
        const mechanismId = rx && rx.mechanismId;
        if (!mechanismId) return;
        const rp = window.reactionPlayer;
        if (!rp || !rp.reactions.length) {
            this.game.showToast('反応機構データが読み込まれていません。');
            return;
        }
        const idx = rp.reactions.findIndex(r => r.id === mechanismId);
        if (idx < 0) {
            this.game.showToast('対応する反応機構が見つかりませんでした。');
            return;
        }
        this.closeCompare();
        // setMode('learn') は exitCompare 経由で lastReaction を破棄するため、idx は先に確定済み
        this.game.setMode('learn');
        if (rp.selectEl) rp.selectEl.value = String(idx);
        rp.enter(idx);
        this.game.showToast('※ あなたの分子そのものではなく、代表例の分子で機構を再生します。', 6000, 'success');
    }

    onRuleClick(rule, sites) {
        if (rule.info) {
            // 解説のみ（実行なし・Undo履歴も積まない）。
            // 引数なしで呼ぶと、分子を見て文面を作る info ルール（縮合重合）が game を受け取れず
            // 落ちてトーストごと出なくなる（v331 の夜間監査で検出）。実行系と同じ引数で渡す
            this.game.showToast(rule.apply(this.game).caption, 6000, 'success');
            return;
        }
        this.narrow(rule, sites);
    }

    // 適用箇所が複数あるときは、候補を分けている原子だけをハイライトしてクリックで絞り込む。
    // 1クリックで決まらない場合（カルボン酸×アルコールの組み合わせなど）は繰り返し絞り込む
    narrow(rule, sites) {
        if (sites.length === 1) {
            this.execute(rule, sites[0]);
            return;
        }
        this.picking = { rule, sites };
        const ids = new Set();
        sites.forEach(s => s.forEach(id => ids.add(id)));
        const distinguishing = [...ids].filter(id => !sites.every(s => s.includes(id)));
        const pickIds = distinguishing.length ? distinguishing : [...ids];
        const atoms = pickIds
            .map(id => this.game.userMolecule.atoms.find(a => a.id === id))
            .filter(Boolean);
        this.game.highlightAtoms(atoms);
        this.game.showToast('反応させたい箇所（ハイライトした原子）をクリックしてください。', 5000, 'success');
    }

    // 適用箇所の選択モード中、キャンバスのクリックを消費する（game.handleMouseDown から呼ばれる）
    handlePick(atom) {
        if (!this.picking) return false;
        const { rule, sites } = this.picking;
        this.picking = null;
        this.game.clearUIOverlay();
        if (atom) {
            const matched = sites.filter(s => s.includes(atom.id));
            if (matched.length === 1) {
                this.execute(rule, matched[0]);
                return true;
            }
            if (matched.length > 1) {
                this.narrow(rule, matched); // まだ決まらないので再度選ばせる
                return true;
            }
        }
        this.game.showToast('適用箇所の選択を解除しました。');
        return true;
    }

    execute(rule, site) {
        const g = this.game;
        // 2段階モーフィングの中間で止まっている状態から次の反応を実行するときは、
        // **画面に見えている中間の配置**を実際の座標として引き継ぐ（P12-7 M2f）。
        // これをしないと、内部で確定済みの「整列後」の座標から変化が始まり、
        // 見えている図と繋がらない（開環で止めた図から環化すると飛んで見える）。
        // 座標だけの引き継ぎなので、結合・元素・判定には影響しない（座標は見た目専用）
        this.adoptPausedLayout();
        g.saveState();
        // 反応前のキャンバス全体を写す（差分ハイライトのため原子ID付き。apply が壊す前に取る）
        const before = this.snapshotMolecule(g.userMolecule);
        let result;
        try {
            result = rule.apply(g, site);
        } catch (e) {
            console.error('反応実行エラー:', rule.id, e);
            // 途中まで書き換えている可能性があるため、開始時の状態へ確実に戻す
            // （履歴を捨てるだけでは中途半端な分子が残ってしまう）
            const saved = g.history.pop();
            if (saved) g.restoreState(JSON.parse(saved));
            g.showToast('この反応は実行できませんでした: ' + e.message);
            return;
        }
        // 直近反応を記録（前後比較・機構ジャンプ・モーフィングで共用）
        this.lastReaction = {
            ruleId: rule.id,
            mechanismId: rule.mechanismId || null,
            label: rule.label,
            before,
            after: this.snapshotMolecule(g.userMolecule)
        };
        if (this._compareOpen) this.closeCompare(); // 前の比較が開いていれば閉じる（次の反応で上書き）
        // 生成物データは確定済み。前→後をモーフィングで見せ、完了後に通常描画＋変化箇所ハイライト
        this.animateExecution(before, this.lastReaction.after, result, rule.morphStages || null);
    }

    // ===== 実行時モーフィング（P12-5 第2弾。表示のみ・検証/Undo/監査には一切影響しない） =====

    // 反応適用後の見せ方。分子データは即確定させ（通常描画・カード更新・解説を同期で行う）、
    // その上で約0.8秒のモーフィング（前→後）を表示のみ重ねる。完了時に通常描画へ戻して自動水素を出す。
    // reduced-motion 環境や rAF が無い場合はアニメせず即確定（＝「検証はトポロジーのみ」に整合）
    // 中間スナップショットを作る（2段階モーフィング用。P12-7 M2f）。
    // 'bondsFirst': 結合だけ先に変え、原子は反応前の位置のまま（開環＝ほぼ環の配置のまま開く）
    // 'moveFirst' : 配置だけ先に動かし、結合は反応前のまま（環化＝先に環の形へ折りたたむ）
    buildMidSnapshot(before, after, mode) {
        const beforeById = new Map(before.atoms.map(a => [a.id, a]));
        const afterById = new Map(after.atoms.map(a => [a.id, a]));
        if (mode === 'bondsFirst') {
            const atoms = after.atoms.map(a => {
                const b = beforeById.get(a.id);
                return b ? { ...a, x: b.x, y: b.y } : { ...a };
            });
            return { atoms, bonds: after.bonds.map(b => ({ ...b })) };
        }
        const atoms = before.atoms.map(a => {
            const af = afterById.get(a.id);
            return af ? { ...a, x: af.x, y: af.y } : { ...a };
        });
        return { atoms, bonds: before.bonds.map(b => ({ ...b })) };
    }

    // スナップショットから一時的な Molecule を作る（中間状態の自動水素を計算するため）
    molFromSnapshot(snap) {
        const m = new Molecule();
        snap.atoms.forEach(a => m.atoms.push(new Atom(a.id, a.element, a.x, a.y)));
        snap.bonds.forEach(b => m.bonds.push(new Bond(b.atomId1, b.atomId2, b.type)));
        return m;
    }

    // 中間状態を静止画として描く。**自動水素も計算して描く**ので、
    // 「開いた瞬間」の水素の数・位置が正しく見える（P12-7 M2f。ユーザー要望）
    renderStaticSnapshotWithHydrogens(snap) {
        const g = this.game;
        g.atomsGroup.innerHTML = '';
        g.bondsGroup.innerHTML = '';
        const m = this.molFromSnapshot(snap);
        const hs = m.calculateHydrogens();
        hs.forEach(h => {
            const p = m.atoms.find(a => a.id === h.parentId);
            if (p) g.renderBond(p.x, p.y, h.x, h.y, 1, true);
        });
        m.bonds.forEach(b => {
            const a1 = m.atoms.find(a => a.id === b.atomId1);
            const a2 = m.atoms.find(a => a.id === b.atomId2);
            if (a1 && a2) g.renderBond(a1.x, a1.y, a2.x, a2.y, b.type, false);
        });
        hs.forEach((h, i) => g.renderAtom(`morphH_${i}`, 'H', h.x, h.y, false));
        m.atoms.forEach(a => g.renderAtom(`morph_${a.id}`, a.element, a.x, a.y, false));
    }

    // 2段階モーフィングの中間で止まっているとき、画面に見えている中間の配置を
    // 実際の分子の座標として引き継ぎ、停止状態を解除する（P12-7 M2f）。
    // 「見えている図から次の変化が始まる」ようにするための処理で、座標のみを触る。
    // 引き継がない場合は内部で確定済みの最終配置（例: 整列後の鎖状）から変化が始まってしまう。
    adoptPausedLayout() {
        const p = this._morphPause;
        if (!p) return false;
        this._morphPause = null;
        this._morphing = false;
        this._morphSkip = false;
        this._morphGen++; // 走行中のループがあれば無効化する
        const mol = this.game.userMolecule;
        p.mid.atoms.forEach(sa => {
            const a = mol.atoms.find(x => x.id === sa.id);
            if (a) { a.x = sa.x; a.y = sa.y; }
        });
        this.game.updateDrawing();
        return true;
    }

    // 中間で止めた2段階モーフィングの続き（第2段階）を再生する。クリックで呼ばれる
    advanceMorph() {
        const p = this._morphPause;
        if (!p) return false;
        this._morphPause = null;
        const gen = p.gen;
        if (this._morphGen !== gen) return false;
        const smoothstep = t => t * t * (3 - 2 * t);
        animateFramesLoop(
            800,
            t => { if (this._morphGen === gen) this.renderMorphFrame(p.mid, p.after, smoothstep(t)); },
            () => this._morphSkip || this._morphGen !== gen
        ).then(() => {
            if (this._morphGen !== gen) return;
            this._morphing = false;
            this.game.updateDrawing();
            p.highlight();
        });
        return true;
    }

    animateExecution(before, after, result, morphStages = null) {
        const g = this.game;
        // まず生成物を確定表示（判定・カード・名称は同期で最終状態に。テスト・監査に影響させない）
        g.updateDrawing();
        // 生成物が視野に収まらない反応（付加重合で鎖が伸びるなど）は視野を合わせ直す。
        // ルールが refit を返したときだけ効かせる＝他の反応の見え方は変えない（P12-8）
        if (result.refit && typeof g.fitCanvasToMolecule === 'function') {
            g.fitCanvasToMolecule(g.userMolecule);
        }
        g.showToast(result.caption, 6500, 'success');
        const highlight = () => {
            if (result.changed) {
                const atoms = result.changed
                    .map(id => g.userMolecule.atoms.find(a => a.id === id))
                    .filter(Boolean);
                g.highlightAtoms(atoms); // 変化した箇所をハイライトで示す
            }
        };
        if (this._reducedMotion() || typeof requestAnimationFrame !== 'function' || !before || !after) {
            highlight();
            return;
        }
        // モーフィングは表示のみの上書き。世代トークンで多重・中断を安全に扱う
        const gen = ++this._morphGen;
        this._morphing = true;
        this._morphSkip = false;
        this.renderMorphFrame(before, after, 0); // 先に反応前を描き、生成物→反応物のちらつきを防ぐ
        const smoothstep = t => t * t * (3 - 2 * t);
        // 変化が大きい反応（環化・開環）は2段階に分けて見せる。前半＝最小限の変化（結合だけ／配置だけ）、
        // 後半＝残りの変化。中間で少し止めて、どこが変わったか目で追えるようにする（P12-7 M2f）
        // 2つの分子が結びつく反応は「①並ぶ → ②結合ができる」の2段で見せる（C-1。2026-08-01 ユーザー要望
        // 「2つの分子が整列して反応する」）。環化・開環の2段と違い**クリック待ちを挟まない**ので、
        // 収録やデモの流れは止まらない。第1段では結合をつないだまま原子だけが動くため、
        // 脱離する -OH の結合が伸びていき、第2段で切れて水になるのが目で追える
        if (morphStages === 'joinFirst') {
            const joinMid = this.buildMidSnapshot(before, after, 'moveFirst');
            const stop = () => this._morphSkip || this._morphGen !== gen;
            animateFramesLoop(450,
                t => { if (this._morphGen === gen) this.renderMorphFrame(before, joinMid, smoothstep(t)); },
                stop
            ).then(() => {
                if (this._morphGen !== gen) return null;
                if (this._morphSkip) return null;
                return animateFramesLoop(400,
                    t => { if (this._morphGen === gen) this.renderMorphFrame(joinMid, after, smoothstep(t)); },
                    stop);
            }).then(() => {
                if (this._morphGen !== gen) return;
                this._morphing = false;
                g.updateDrawing();
                highlight();
            });
            return;
        }
        const mid = morphStages ? this.buildMidSnapshot(before, after, morphStages) : null;
        if (mid) {
            // 第1段階だけ再生し、**中間状態で止める**（自動水素つきで静止表示）。
            // 続きはユーザーのクリックで進める＝じっくり観察できる（P12-7 M2f。ユーザー要望）
            animateFramesLoop(
                700,
                t => { if (this._morphGen === gen) this.renderMorphFrame(before, mid, smoothstep(t)); },
                () => this._morphSkip || this._morphGen !== gen
            ).then(() => {
                if (this._morphGen !== gen) return;
                if (this._morphSkip) { // 途中でタップされたら最終状態へ
                    this._morphing = false;
                    g.updateDrawing();
                    highlight();
                    return;
                }
                this._morphPause = { mid, after, gen, highlight };
                this.renderStaticSnapshotWithHydrogens(mid);
                const next = morphStages === 'bondsFirst' ? '鎖状に整列します' : '結合ができて環が閉じます';
                g.showToast(`①第1段階（${morphStages === 'bondsFirst' ? '環の形のまま結合が切れた' : '環の形に折りたたんだ'}状態）で止めています。ここで水素の数と位置も確認できます。画面をクリックすると②${next}。`, 9000);
            });
            return;
        }
        animateFramesLoop(
            800,
            t => { if (this._morphGen === gen) this.renderMorphFrame(before, after, smoothstep(t)); },
            () => this._morphSkip || this._morphGen !== gen
        ).then(() => {
            if (this._morphGen !== gen) return; // 別の描画に上書きされた（多重反応・中断）
            this._morphing = false;
            g.updateDrawing(); // 自動水素を含む最終分子を描き直す
            highlight();
        });
    }

    _reducedMotion() {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // 進行中のモーフィングを即終了して最終描画へ戻す（世代を進めて走行中ループの完了処理を無効化）
    finalizeMorph() {
        if (!this._morphing) return;
        this._morphGen++;
        this._morphing = false;
        this._morphSkip = false;
        this._morphPause = null; // 2段階の途中で止めていた状態も破棄する
        this.game.updateDrawing();
    }

    // 再生中のキャンバス操作の窓口（game.handleMouseDown から呼ばれる）。
    // 再生中はモーフィングを即終了する。適用箇所の選択待ち（picking）中は操作を続行させ、
    // それ以外の通常タップは「スキップのみ」として true（＝イベント消費）を返す
    skipMorph() {
        if (!this._morphing) return false;
        const wasPicking = this.picking; // finalizeMorph の再描画で picking が消えるため退避・復元
        // 2段階の中間で止まっているときは「スキップ」ではなく第2段階へ進む（P12-7 M2f）
        if (this._morphPause) {
            this.advanceMorph();
            this.picking = wasPicking;
            return !wasPicking;
        }
        this.finalizeMorph();
        this.picking = wasPicking;
        return !wasPicking;
    }

    // before/after を t(0→1) で補間した描画データを返す純関数。原子はID対応で照合し、
    // 共通原子は座標を線形補間、脱離原子はフェードアウト、付加原子はフェードイン、
    // 結合は次数変化をクロスフェード・生成/消滅をフェードで表す（DOM非依存＝テスト可能）
    interpolateMorph(before, after, t) {
        const lerp = (a, b) => a + (b - a) * t;
        const clamp = o => Math.max(0, Math.min(1, o));
        const afterById = new Map(after.atoms.map(a => [a.id, a]));
        const beforeById = new Map(before.atoms.map(a => [a.id, a]));
        const atoms = [];
        before.atoms.forEach(a => {
            const af = afterById.get(a.id);
            if (af) atoms.push({ id: a.id, element: a.element, x: lerp(a.x, af.x), y: lerp(a.y, af.y), opacity: 1 });
            else atoms.push({ id: a.id, element: a.element, x: a.x, y: a.y, opacity: clamp(1 - t) }); // 脱離
        });
        after.atoms.forEach(a => {
            if (!beforeById.has(a.id)) atoms.push({ id: a.id, element: a.element, x: a.x, y: a.y, opacity: clamp(t) }); // 付加
        });
        const posById = new Map(atoms.map(a => [a.id, a]));
        const key = b => b.atomId1 < b.atomId2 ? `${b.atomId1} ${b.atomId2}` : `${b.atomId2} ${b.atomId1}`;
        const beforeB = new Map(before.bonds.map(b => [key(b), b]));
        const afterB = new Map(after.bonds.map(b => [key(b), b]));
        const bonds = [];
        new Set([...beforeB.keys(), ...afterB.keys()]).forEach(k => {
            const fb = beforeB.get(k), tb = afterB.get(k);
            const b = fb || tb;
            const p1 = posById.get(b.atomId1), p2 = posById.get(b.atomId2);
            if (!p1 || !p2) return;
            const push = (type, opacity) => bonds.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, type, opacity: clamp(opacity) });
            if (fb && tb) {
                if (fb.type === tb.type) push(fb.type, 1);
                else { push(fb.type, 1 - t); push(tb.type, t); } // 次数変化はクロスフェード
            } else if (fb) push(fb.type, 1 - t); // 切れる結合はフェードアウト
            else push(tb.type, t);               // 生じる結合はフェードイン
        });
        return { atoms, bonds };
    }

    // 補間1フレームを実キャンバス（atomsGroup/bondsGroup）に描く。自動水素は省略（完了時に通常描画で出る）
    renderMorphFrame(before, after, t) {
        const g = this.game;
        g.atomsGroup.innerHTML = '';
        g.bondsGroup.innerHTML = '';
        const frame = this.interpolateMorph(before, after, t);
        frame.bonds.forEach(bd => {
            const start = g.bondsGroup.childElementCount;
            g.renderBond(bd.x1, bd.y1, bd.x2, bd.y2, bd.type, false);
            for (let i = start; i < g.bondsGroup.children.length; i++) {
                g.bondsGroup.children[i].setAttribute('opacity', String(bd.opacity));
            }
        });
        frame.atoms.forEach(a => {
            const start = g.atomsGroup.childElementCount;
            g.renderAtom(`morph_${a.id}`, a.element, a.x, a.y, false);
            for (let i = start; i < g.atomsGroup.children.length; i++) {
                g.atomsGroup.children[i].setAttribute('opacity', String(a.opacity));
            }
        });
    }

    // ===== 反応の前後比較（P12-5 第1弾） =====

    // キャンバス全体を独立コピー（原子ID付き）で写す。自動水素は含めない（描画時に再計算される）
    snapshotMolecule(mol) {
        return {
            atoms: mol.atoms.map(a => ({ id: a.id, element: a.element, x: a.x, y: a.y, charge: a.charge || 0 })),
            bonds: mol.bonds.map(b => ({ atomId1: b.atomId1, atomId2: b.atomId2, type: b.type }))
        };
    }

    // スナップショット（ID基準）を target 形式（index基準）へ変換して既存の描画関数で描けるようにする
    snapshotToTarget(snapshot) {
        const idx = new Map(snapshot.atoms.map((a, i) => [a.id, i]));
        return {
            atoms: snapshot.atoms.map(a => ({ element: a.element, x: a.x, y: a.y, charge: a.charge })),
            bonds: snapshot.bonds.map(b => ({
                atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type
            }))
        };
    }

    // before/after の原子IDを突き合わせて差分を機械的に求める（reactor はIDを保持するので照合はID一致で取れる）。
    // 原子IDは "atom_xxxx" のような文字列なので、キーは区切りに   を使い、結合はオブジェクトごと保持する
    computeDiff(before, after) {
        const beforeIds = new Set(before.atoms.map(a => a.id));
        const afterIds = new Set(after.atoms.map(a => a.id));
        const heavy = a => a.element !== 'H';
        const removedAtoms = before.atoms.filter(a => !afterIds.has(a.id) && heavy(a)); // 脱離
        const addedAtoms = after.atoms.filter(a => !beforeIds.has(a.id) && heavy(a));    // 付加
        const key = b => b.atomId1 < b.atomId2 ? `${b.atomId1} ${b.atomId2}` : `${b.atomId2} ${b.atomId1}`;
        const mapOf = bonds => { const m = new Map(); bonds.forEach(b => m.set(key(b), b)); return m; };
        const beforeB = mapOf(before.bonds), afterB = mapOf(after.bonds);
        const typeAt = (m, k) => (m.has(k) ? m.get(k).type : 0);
        const seg = (snap, b) => {
            const a = snap.atoms.find(x => x.id === b.atomId1), c = snap.atoms.find(x => x.id === b.atomId2);
            return a && c ? { x1: a.x, y1: a.y, x2: c.x, y2: c.y } : null;
        };
        const lostBonds = [];   // 消えた・次数が下がった結合 → 反応前の図
        beforeB.forEach((b, k) => { if (b.type > typeAt(afterB, k)) { const s = seg(before, b); if (s) lostBonds.push(s); } });
        const gainedBonds = []; // 生成した・次数が上がった結合 → 反応後の図
        afterB.forEach((b, k) => { if (b.type > typeAt(beforeB, k)) { const s = seg(after, b); if (s) gainedBonds.push(s); } });
        return { removedAtoms, addedAtoms, lostBonds, gainedBonds };
    }

    openCompare() {
        if (!this.lastReaction || !this.compareOverlay) return;
        this._compareOpen = true;
        this.compareOverlay.classList.remove('hidden');
        this.compareOverlay.scrollTop = 0;
        this.renderCompare();
    }

    closeCompare() {
        if (this.compareOverlay) this.compareOverlay.classList.add('hidden');
        this._compareOpen = false;
    }

    // 記録ごと破棄（全消去・モード離脱時）。開いていれば閉じてから
    exitCompare() {
        this.closeCompare();
        this.lastReaction = null;
    }

    setCompareScale(scale) {
        this._compareScale = scale;
        this.renderCompare();
    }

    renderCompare() {
        const ov = this.compareOverlay;
        if (!ov || !this.lastReaction) return;
        const NS = 'http://www.w3.org/2000/svg';
        const SCALES = (typeof IP_REVIEW_SCALES !== 'undefined')
            ? IP_REVIEW_SCALES
            : { sm: { col: 118, h: 92 }, md: { col: 172, h: 128 }, lg: { col: 244, h: 182 } };
        const sc = SCALES[this._compareScale] || SCALES.md;
        const ORANGE = 'var(--neon-orange)', CYAN = 'var(--neon-blue)', GREEN = 'var(--neon-green)';
        const rx = this.lastReaction;
        const diff = this.computeDiff(rx.before, rx.after);
        ov.innerHTML = '';

        // ヘッダー: タイトル＋反応名 ＋ 図サイズ切替（小/中/大。IP_REVIEW_SCALES を共用）
        const headRow = document.createElement('div');
        headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap;';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:15px; color:#fff; font-weight:bold;';
        title.textContent = `反応の前後 — ${rx.label}`;
        headRow.appendChild(title);
        const sizeWrap = document.createElement('div');
        sizeWrap.style.cssText = 'display:flex; gap:4px; align-items:center;';
        const sizeLabel = document.createElement('span');
        sizeLabel.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        sizeLabel.textContent = '図の大きさ:';
        sizeWrap.appendChild(sizeLabel);
        [['sm', '小'], ['md', '中'], ['lg', '大']].forEach(([k, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            const on = this._compareScale === k;
            b.style.cssText = 'font-size:12px; padding:4px 10px;' +
                (on ? ' border-color:var(--neon-blue); color:var(--neon-blue);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => this.setCompareScale(k));
            sizeWrap.appendChild(b);
        });
        headRow.appendChild(sizeWrap);
        ov.appendChild(headRow);

        // 2図（反応前 / 反応後）を並置
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:10px;';
        const pending = [];
        const makeFig = (caption, snapshot, marks, accent) => {
            const cell = document.createElement('div');
            cell.style.cssText = 'background:rgba(10,14,24,0.85); border:1px solid rgba(255,255,255,0.14); ' +
                'border-radius:8px; padding:4px; text-align:center; cursor:pointer;';
            cell.title = 'クリックで描画に戻る';
            const cap = document.createElement('div');
            cap.style.cssText = `font-size:12px; font-weight:bold; margin-bottom:2px; color:${accent};`;
            cap.textContent = caption;
            cell.appendChild(cap);
            const svg = document.createElementNS(NS, 'svg');
            svg.id = 'rx-cmp-svg-' + (Reactor._seq = (Reactor._seq || 0) + 1);
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', String(Math.round(sc.h * 1.25)));
            const bg = document.createElementNS(NS, 'g'); bg.setAttribute('class', 'quiz-bonds');
            const ag = document.createElementNS(NS, 'g'); ag.setAttribute('class', 'quiz-atoms');
            svg.appendChild(bg); svg.appendChild(ag);
            cell.appendChild(svg);
            cell.addEventListener('click', () => this.closeCompare());
            pending.push({ id: svg.id, snapshot, marks });
            grid.appendChild(cell);
        };
        makeFig('反応前', rx.before, {
            atoms: diff.removedAtoms.map(a => ({ x: a.x, y: a.y, color: ORANGE })),
            bonds: diff.lostBonds.map(b => ({ ...b, color: ORANGE, dashed: true }))
        }, ORANGE);
        makeFig('反応後', rx.after, {
            atoms: diff.addedAtoms.map(a => ({ x: a.x, y: a.y, color: GREEN })),
            bonds: diff.gainedBonds.map(b => ({ ...b, color: CYAN, dashed: false }))
        }, CYAN);
        ov.appendChild(grid);

        // 凡例
        const legend = document.createElement('div');
        legend.style.cssText = 'font-size:11px; color:var(--text-secondary); line-height:1.7; margin-bottom:10px;';
        legend.innerHTML = '<span style="color:var(--neon-orange);">● オレンジ</span>＝切れた結合・脱離した原子（反応前）　' +
            '<span style="color:var(--neon-blue);">● シアン</span>＝できた結合、' +
            '<span style="color:var(--neon-green);">● 緑</span>＝付加した原子（反応後）';
        ov.appendChild(legend);

        // 機構が登録されている反応なら「機構を見る（代表例）」の注記と案内を添える
        if (rx.mechanismId) {
            const note = document.createElement('div');
            note.style.cssText = 'font-size:11px; color:var(--neon-pink); line-height:1.6; margin-bottom:10px;';
            note.textContent = '※「機構を見る」を押すと学習モードに切り替わり、あなたの分子そのものではなく代表例の分子で機構を再生します。';
            ov.appendChild(note);
        }

        // 操作ボタン（戻る／機構を見る）
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'position:sticky; bottom:0; display:flex; gap:8px; padding:8px 0 2px; background:linear-gradient(transparent, rgba(6,10,20,0.92) 35%);';
        const back = document.createElement('button');
        back.className = 'primary-btn';
        back.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px;';
        back.textContent = '← 描画に戻る';
        back.addEventListener('click', () => this.closeCompare());
        btnRow.appendChild(back);
        if (rx.mechanismId) {
            const mech = this.makeMechanismButton();
            mech.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px; text-align:center; ' +
                'border-color:var(--neon-pink); color:var(--neon-pink);';
            btnRow.appendChild(mech);
        }
        ov.appendChild(btnRow);

        // svg が DOM に入った後に描画（renderMoleculeIntoSvg は getElementById を使う）
        pending.forEach(p => this.renderCompareFigure(p.id, p.snapshot, p.marks));
    }

    // 1図を描き、その上に差分ハイライト（原子の枠・結合の強調）を重ねる。
    // viewBox 座標＝スナップショット座標なので、marks の x/y をそのまま使える
    renderCompareFigure(svgId, snapshot, marks) {
        renderMoleculeIntoSvg(this.game, svgId, this.snapshotToTarget(snapshot));
        const svg = document.getElementById(svgId);
        if (!svg) return;
        const NS = 'http://www.w3.org/2000/svg';
        const hi = document.createElementNS(NS, 'g');
        (marks.bonds || []).forEach(bm => {
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', bm.x1); line.setAttribute('y1', bm.y1);
            line.setAttribute('x2', bm.x2); line.setAttribute('y2', bm.y2);
            line.setAttribute('stroke', bm.color);
            line.setAttribute('stroke-width', '7');
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('opacity', bm.dashed ? '0.9' : '0.5');
            if (bm.dashed) line.setAttribute('stroke-dasharray', '3 8');
            line.setAttribute('class', 'rx-diff-mark');
            hi.appendChild(line);
        });
        (marks.atoms || []).forEach(am => {
            const c = document.createElementNS(NS, 'circle');
            c.setAttribute('cx', am.x); c.setAttribute('cy', am.y);
            c.setAttribute('r', '18');
            c.setAttribute('fill', 'none');
            c.setAttribute('stroke', am.color);
            c.setAttribute('stroke-width', '3');
            c.setAttribute('class', 'rx-diff-mark');
            hi.appendChild(c);
        });
        svg.appendChild(hi);
    }
}

// テスト（test.html）・コンソールデバッグ用にグローバル公開する。
// const はトップレベルでも window のプロパティにならないため明示が必要（chemistry.js と同じ流儀）。
if (typeof window !== 'undefined') {
    window.REACTION_RULES = REACTION_RULES;
    window.REGISTERED_NAMES = REGISTERED_NAMES;
    window.aromaticSiteRole = aromaticSiteRole; // 配向性（テスト・検証ツール用）
    window.bondStep = bondStep;                 // その分子の作図の刻み（RX19 の距離判定で使う）
}
