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
 * 与えられた原子どうしの最短距離（重原子だけ／結合の有無は問わない）。
 * 相似伸縮で図が潰れないかを見るために使う（v480）。自動水素は描画時に決まるので数えない。
 */
function minGapAmong(atoms) {
    const heavy = atoms.filter(a => a.element !== 'H');
    let min = Infinity;
    for (let i = 0; i < heavy.length; i++) {
        for (let j = i + 1; j < heavy.length; j++) {
            const d = Math.hypot(heavy[i].x - heavy[j].x, heavy[i].y - heavy[j].y);
            if (d < min) min = d;
        }
    }
    return min;
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
    // ignoreIds（脱離して水になる -OH など）は**動かす側にあっても**衝突判定から外す。
    // 外さないと、その原子が相手の位置に重なるという理由で置ける向きが消える
    // （アルコールを先に選んで酸側を動かす場合。C-1）
    const movingAtoms = [...moving]
        .filter(id => !ignore.has(id))
        .map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
    if (!movingAtoms.length) return null;
    const moveG = bondStep(mol, attachId);
    let scaleF = (moveG > 1 && Math.abs(moveG - G) > 1) ? G / moveG : 1;
    /*
     * **縮めてよいのは、動かす側が一つの刻みで描かれているときだけ**（v480）。
     *
     * `moveG` は attachId の**まわりの**結合の中央値なので、動かす分子の刻みが
     * 途中で変わっていると当てにならない。呼び出した酢酸（80px）の端に手で炭素を
     * 足す（42px）と、moveG=80・G=42 で 0.525 倍が全体に掛かり、**もともと 42px
     * だった結合が 22px に潰れる**。監査 v446 の C-C 22.1px×10・22.0px×5・
     * C-Br 17.5px×3（35px の結合を 0.5 倍）はすべてこれ。
     *
     * v434 の `_minHeavyGap` と同じ形の門番を置く: **伸縮で詰まるときだけ**やめる。
     * 元から一様な分子（呼び出したままの酢酸など）は 80→42 でも最短間隔が 42px
     * 残るので従来どおり縮み、レーンJ（油脂・ジエステル）の到達点は変わらない。
     */
    if (scaleF < 1 && minGapAmong(movingAtoms) * scaleF < MIN_CLEARANCE) scaleF = 1;
    const sx = attach.x, sy = attach.y; // 伸縮の中心は結合をつくる原子（そこは動かない）
    const scaled = (a) => scaleF === 1
        ? { x: a.x, y: a.y }
        : { x: sx + (a.x - sx) * scaleF, y: sy + (a.y - sy) * scaleF };
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

// 点と線分の距離（退避先が既存の結合線の上に乗っていないかを見るために使う）は
// **game.js の `pointSegmentDistance` に一本化した**。
// ここには同名で引数の形が違う実装があり、classic script のトップレベル宣言どうしで
// `window` の同じ名前を取り合っていた（あとから読まれるこちらが勝ち、game.js 側の
// 呼び出しが黙って NaN になっていた）。同じ計算を2度書かない。

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
 * その炭素が「糖の環のアノマー炭素」なら、環の原子IDの並びを返す（違えば null）。
 * P12-8 の穴埋め（2026-08-07・グリコシド結合の加水分解）。
 *
 * 条件は4つ:
 *   ① 環に属し、環内の酸素とも結合している（＝アセタール／ケタールの炭素）
 *   ② 環が5員 or 6員（フラノース／ピラノース）
 *   ③ 環の中の酸素はちょうど1個で、残りはすべて炭素
 *   ④ 環の炭素のうち2個以上に -OH が付いている（ふつうの環状エーテルと糖を分ける）
 *
 * ⚠ **見るのは1つの環の近所だけ**。キャンバス全体の正準コードは数えない
 * （試薬パレット §8.1 で3件出た「全体数え」の轍を踏まないため）。
 */
function sugarRingOf(mol, cId, ringIds) {
    const c = mol.atoms.find(a => a.id === cId);
    if (!c || c.element !== 'C' || !ringIds.has(cId)) return null;
    const ringO = mol.getNeighbors(cId)
        .find(n => n.atom.element === 'O' && n.type === 1 && ringIds.has(n.atom.id));
    if (!ringO) return null;
    // cId → 環内酸素の「直通の結合を使わない」最短路 ＝ その2原子を含む環そのもの
    const prev = new Map([[cId, null]]);
    const queue = [cId];
    let hit = false;
    while (queue.length && !hit) {
        const id = queue.shift();
        for (const n of mol.getNeighbors(id)) {
            if (!ringIds.has(n.atom.id) || prev.has(n.atom.id)) continue;
            if (id === cId && n.atom.id === ringO.atom.id) continue; // 直通は使わない
            prev.set(n.atom.id, id);
            if (n.atom.id === ringO.atom.id) { hit = true; break; }
            queue.push(n.atom.id);
        }
    }
    if (!hit) return null;
    const ring = [];
    for (let id = ringO.atom.id; id !== null && id !== undefined; id = prev.get(id)) ring.push(id);
    if (ring.length !== 5 && ring.length !== 6) return null;
    const elems = ring.map(id => (mol.atoms.find(a => a.id === id) || {}).element);
    if (elems.filter(e => e === 'O').length !== 1 ||
        elems.filter(e => e === 'C').length !== ring.length - 1) return null;
    const inRing = new Set(ring);
    const withOH = ring.filter(id => {
        const a = mol.atoms.find(x => x.id === id);
        if (!a || a.element !== 'C') return false;
        return mol.getNeighbors(id).some(n => n.atom.element === 'O' && n.type === 1 &&
            !inRing.has(n.atom.id) &&
            mol.getNeighbors(n.atom.id).filter(x => x.atom.element !== 'H').length === 1);
    }).length;
    return withOH >= 2 ? ring : null;
}

/**
 * グリコシド結合（単糖どうしをつなぐ -O-）を探す。返り値は
 * [切るアノマー炭素, 架橋の酸素, 相手の炭素]。
 *
 * 二糖の -O- は「環でない酸素が炭素2つに挟まれた形」＝ ふつうのエーテルと同じなので、
 * **少なくとも片方がアノマー炭素であること**で糖に絞る（`sugarRingOf`）。
 * スクロースのように両方がアノマー（グルコースの C1 とフルクトースの C2）のときは
 * **座標で決める**（原子IDは乱数なので順序に頼らない）。
 * どちらを切っても相手側の酸素が -OH になり、生成物の2分子は同じなので化学は変わらない。
 */
function glycosidicLinkages(mol) {
    const ringIds = ringAtomIdsOf(mol);
    const out = [];
    mol.atoms.forEach(o => {
        if (o.element !== 'O' || ringIds.has(o.id)) return;
        const nb = mol.getNeighbors(o.id).filter(n => n.atom.element !== 'H');
        if (nb.length !== 2 || nb.some(n => n.atom.element !== 'C' || n.type !== 1)) return;
        const anomeric = nb.filter(n => sugarRingOf(mol, n.atom.id, ringIds))
            .map(n => n.atom)
            .sort((p, q) => (p.x - q.x) || (p.y - q.y) || (p.id < q.id ? -1 : 1));
        if (!anomeric.length) return;
        const a = anomeric[0];
        const other = nb.find(n => n.atom.id !== a.id).atom;
        out.push([a.id, o.id, other.id]);
    });
    return out;
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
// アミンは級数ごとに型が分かれている（§9.6-7。1級 amine1 ／ 2級 amine2 ／ 3級 amine3）。
// **反応で使うのは「N に水素が残る」1級・2級だけ**——アセチル化もアミド化も N の水素を
// 1本使うので、3級アミンは対象にならない
const AMINE_NH_TYPES = ['amine1', 'amine2'];

/**
 * 新しい原子を atomId の隣（1グリッドの直交方向）に置ける空き位置を返す。なければ null。
 *
 * **直交の4方向しか使わないのは意図された仕様**（手書き感覚のコンセプト。CLAUDE.md）。
 * ただし**既にある枝の正反対に置くと、鎖の延長線上に伸びて1本の棒に見える**。
 * 酸化でアルデヒドを作ると `CH₃—CH=O` が一直線になり、
 * **どこが C=O なのか図から読めなくなる**（検品レビュー C-7・V6 がこれで撮れずに保留していた）。
 *
 * そこで**向きの優先順だけを変える**——直交は保ったまま、
 * **一直線になる向きを最後に回す**。空きが1つしか無ければ従来どおりそこに置くので、
 * 「置けたはずのものが置けなくなる」ことは起きない。
 */
function freeSpotAround(mol, atomId, reserved = []) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a) return null;
    const G = bondStep(mol, atomId);
    const MIN_CLEARANCE = G * 0.65;
    // 既にぶら下がっている重原子の向き（単位ベクトル）。H は図に出ても骨格ではないので見ない
    const taken = mol.getNeighbors(atomId)
        .filter(n => n.atom.element !== 'H')
        .map(n => ({ dx: n.atom.x - a.x, dy: n.atom.y - a.y }))
        .map(v => ({ v, len: Math.hypot(v.dx, v.dy) }))
        .filter(o => o.len > 1e-6)
        .map(o => ({ x: o.v.dx / o.len, y: o.v.dy / o.len }));
    // cos ≒ -1 ＝ 既存の枝と正反対 ＝ 一直線。それを後ろへ送る（sort は安定なので同点は元の順）
    const dirs = [0, -Math.PI / 2, Math.PI / 2, Math.PI]
        .map(ang => ({
            ang,
            straight: taken.some(t => t.x * Math.cos(ang) + t.y * Math.sin(ang) < -0.99) ? 1 : 0
        }))
        .sort((p, q) => p.straight - q.straight)
        .map(o => o.ang);
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

/**
 * C=O にした酸素が炭素鎖と一直線に並んでいたら、直交の空いた向きへ折る（検品レビュー C-7）。
 *
 * **酸化は酸素を置き直さない**——`-OH` の結合を二重にするだけなので、
 * 元のアルコールが `C—C—OH` と横一列に描かれていると、そのまま `C—C=O` の一直線になる。
 * 二重線が鎖の延長線上に伸びるので、**どこが C=O なのか図から読めない**
 * （V6「アルコールを酸化する」がこれで撮れずに保留していた）。
 *
 * **動かすのは酸素の座標だけ**でトポロジーには触らない。
 * 逃げ場が無ければ何もしない ＝ **図を壊してまで折らない**。
 */
function bendCarbonyl(mol, cId, oId) {
    const c = mol.atoms.find(a => a.id === cId);
    const o = mol.atoms.find(a => a.id === oId);
    if (!c || !o) return;
    const dirOf = a => {
        const dx = a.x - c.x, dy = a.y - c.y, len = Math.hypot(dx, dy);
        return len > 1e-6 ? { x: dx / len, y: dy / len } : null;
    };
    const od = dirOf(o);
    if (!od) return;
    // 同じ炭素の別の重原子と正反対（cos ≒ -1）に並んでいるか
    const straight = mol.getNeighbors(cId)
        .filter(n => n.atom.id !== oId && n.atom.element !== 'H')
        .some(n => {
            const d = dirOf(n.atom);
            return d && d.x * od.x + d.y * od.y < -0.99;
        });
    if (!straight) return;
    const spot = freeSpotAround(mol, cId);
    if (!spot) return;
    o.x = spot.x;
    o.y = spot.y;
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
 *
 * ⚠ **数える単位は「その分子」**（試薬パレット第2段の detect 監査。
 * `DESIGN_reagent_palette.md` §7.7）。v779 まではキャンバス全体の複製に目印を付けていたため、
 * **同じ分子が2つ並ぶと2つめが丸ごと消えた**:
 *   - ベンゼン2個 → 置換できる箇所が **1件**（実測。2件であるべき）
 *   - しかも `siteFilter()` で2つめだけを選ぶと、生き残った箇所が1つめの側なので
 *     **候補が0になり、混酸の瓶を押しても「効きません」が返る**
 * ベンゼン＋トルエンのように形が違えば起きない（実測4件）ので、**同じ分子を並べたときだけ
 * 静かに壊れる**。連結成分だけを複製し、成分の同一性をキーに混ぜて分ける。
 */
function aromaticSiteClass(mol, siteId) {
    const comp = componentOf(mol, siteId);
    const probe = new Molecule();
    const map = new Map();
    mol.atoms.forEach(a => {
        if (comp.has(a.id)) map.set(a.id, probe.addAtom(a.element, a.x, a.y).id);
    });
    mol.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) probe.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
    });
    const marker = probe.addAtom('Cl', 0, 0); // 目印（種類は何でもよい。位置の等価性だけを見る）
    probe.addBond(map.get(siteId), marker.id, 1);
    // 別の分子の等価な位置どうしを1つにまとめない（成分の同一性を前に置く）
    return [...comp].sort().join(',') + '#' + canonicalCode(probe);
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
 * §9.6-7 の直しで **findFunctionalGroups 自身がアミドの N をアミンから外した**ので、
 * ここは二重の防波堤。反応ルールを読むときに条件が見えるように残してある。
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
    if (a.element === 'Cl' || a.element === 'Br' || a.element === 'I') return { kind: 'op', label: 'ハロゲン', slow: true };
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

// ---- 活性化された環の臭素化（フェノール・アニリン ＋ 臭素水） ----
//
// ⚠ **教材として逆を教えていた穴**（qa レーンの283項目棚卸しで発覚・2026-08-06）。
// v815 までは `br2_water` に付加（`add_br2`）しか紐づいておらず、フェノールに臭素水を
// 掛けると空振りの `miss`「ベンゼン環は付加ではなく置換なので、この条件では脱色しません」が
// 返っていた。**教科書の必修事項（2,4,6-トリブロモフェノールの白色沈殿）と正反対**。

/** キャンバス上の芳香環に属する原子のIDの集合。同じ数え方が3箇所に散っていたのでここに1つ置く */
function aromaticAtomSet(mol) {
    const keys = findAromaticBondKeys(mol);
    const ids = new Set();
    mol.bonds.forEach(b => {
        const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        if (keys.has(k)) { ids.add(b.atomId1); ids.add(b.atomId2); }
    });
    return ids;
}

/**
 * 環炭素 ringId についているのが「触媒なしの置換を通すほど強く活性化する基」か。
 * 通すのは **-OH（フェノール）と -NH₂（アニリン）の2つだけ**。
 *
 * -OR（アニソール）・-NHCOR（アセトアニリド）も理屈の上では活性化基だが、
 * 高校で臭素水の白色沈殿として教わるのはフェノールとアニリンの2つで、
 * それ以外は**どこまで置換が進むかを高校の範囲では決められない**（判断できないものは出さない・
 * DEVELOPMENT.md 4章）。そこで「環外の重原子がちょうど1つ ＝ 裸の -OH / -NH₂」まで絞る。
 */
function activatingSubstituent(mol, ringId, aromatic = null) {
    const ring = aromatic || aromaticAtomSet(mol);
    const sub = mol.getNeighbors(ringId)
        .find(n => n.atom.element !== 'H' && !ring.has(n.atom.id));
    if (!sub || sub.type !== 1) return null;
    const a = sub.atom;
    // 環の外の重原子がちょうど1つ ＝ その先に炭素鎖もアシル基もぶら下がっていない
    if (mol.getNeighbors(a.id).filter(n => n.atom.element !== 'H').length !== 1) return null;
    if (a.element === 'O' && mol.getFreeValency(a.id) >= 1) {
        return { name: 'フェノール', group: 'フェノール性の -OH' };
    }
    if (a.element === 'N' && mol.getFreeValency(a.id) >= 2) {
        return { name: 'アニリン', group: 'アミノ基 -NH₂' };
    }
    return null;
}

/**
 * 臭素水がそのまま（鉄触媒なし・常温で）置換する箇所を返す。
 * 返り値は `[アンカーの環炭素, オルト, オルト, パラ]` の4つ組で、**1分子につき1件**。
 *
 * ⚠ **数える単位は「その分子」**（`DESIGN_reagent_palette.md` §7.7・§8.1 の申し送り）。
 * 芳香環の下ごしらえは過去に2度「キャンバス全体で数えていて、同じ分子を2つ並べると
 * 1件に潰れる」壊れ方をしている。ここでは `componentOf` で連結成分を切り出してから
 * 環の大きさ・置換基の数を数えるので、フェノールを2つ並べれば2件返る。
 *
 * 一置換体（2,4,6 が3つとも空いている形）だけを対象にする。o-クレゾールのように
 * 空きが足りない環では**どこまで入るかを高校の範囲では決められない**ので候補に出さない。
 */
function activatedRingBrominationSites(mol) {
    const aromatic = aromaticAtomSet(mol);
    if (aromatic.size === 0) return [];
    const sites = [];
    const seen = new Set();
    [...aromatic].forEach(id => {
        if (seen.has(id)) return;
        const comp = componentOf(mol, id);
        comp.forEach(x => seen.add(x));
        const ring = [...aromatic].filter(a => comp.has(a));
        if (ring.length !== 6) return; // 単環のベンゼン環だけ（縮合環は配向が重なる）
        const ringSet = new Set(ring);
        const substituted = ring.filter(a => mol.getNeighbors(a)
            .some(n => n.atom.element !== 'H' && !ringSet.has(n.atom.id)));
        if (substituted.length !== 1) return;
        const anchor = substituted[0];
        if (!activatingSubstituent(mol, anchor, aromatic)) return;
        // 環を一周して anchor からの距離を測る（1=オルト・3=パラ）
        const dist = new Map([[anchor, 0]]);
        const queue = [anchor];
        while (queue.length) {
            const cur = queue.shift();
            mol.getNeighbors(cur).forEach(n => {
                if (!ringSet.has(n.atom.id) || dist.has(n.atom.id)) return;
                dist.set(n.atom.id, dist.get(cur) + 1);
                queue.push(n.atom.id);
            });
        }
        // **並びは座標で決める**（C-2b。原子IDは乱数なので走査順に頼らない）
        const byCoord = (list) => list
            .map(x => mol.atoms.find(a => a.id === x))
            .filter(Boolean)
            .sort((p, q) => (q.x - p.x) || (p.y - q.y) || (p.id < q.id ? -1 : 1))
            .map(a => a.id);
        const ortho = byCoord(ring.filter(a => dist.get(a) === 1));
        const para = ring.filter(a => dist.get(a) === 3);
        if (ortho.length !== 2 || para.length !== 1) return;
        const targets = [...ortho, para[0]];
        // 3つとも臭素を置ける環でなければ出さない（「検出はするが実行すると失敗する」候補を作らない）
        if (!targets.every(t => mol.getFreeValency(t) >= 1 && attachGroup(mol, t, 'Br', true))) return;
        sites.push([anchor, ...targets]);
    });
    return sites;
}

/* ---- 酸化剤 [O] の残り2つ（側鎖酸化・酸化開裂）。qa の棚卸しで空いていた穴 ----
 *
 * v816 まで `oxidant` は **1級・2級アルコールとアルデヒドにしか作用しなかった**ので、
 * 高校の必修である「トルエン → 安息香酸」と「アルケンの酸化開裂（構造決定の主役）」が
 * 画面のどこからも出せなかった。
 *
 * ⚠ **どこで切ったかは `DESIGN_reaction_execution.md` §10.3・§10.4 に書いた。**
 * 酸化開裂は条件で生成物が変わる（ケトン／アルデヒド／カルボン酸／CO₂）ので、
 * **酸性の強い酸化剤（KMnO₄・K₂Cr₂O₇）1本ぶんに行き先を固定できる形**だけを実行し、
 * 残りは `oxidation_out_of_scope_info` が「ここでは図を変えない」と説明する。
 */

/**
 * この C=C を酸化開裂の対象にしてよいか。返り値は
 * `'ok'`（実行する）／`'terminal'`／`'ring'`／`'triple'`／`'hetero'`（いずれも扱わない）。
 *
 * - `terminal` … 端が =CH₂。酸化されると **CO₂ と水**になって出ていく。有機の図に残らないものを
 *   キャンバスに置くと、以後その CO₂ が反応の相手として数えられてしまう
 * - `ring` … 環の中の C=C。シクロヘキセン → アジピン酸は正しいが、環が開く形は
 *   「切ったのに1分子のまま」で前後比較の読み方が変わる。別項目として立てる
 * - `triple` … C≡C の開裂。高校では扱いが安定しない
 * - `hetero` … 炭素と水素だけでできていない分子。他の官能基との**酸化されやすさの順序**を
 *   高校の範囲では決められない（アルコールの酸化に置いた線引きと同じ考え方）
 */
function alkeneCleavageClass(mol, site) {
    const [id1, id2] = site;
    const bond = mol.getBond(id1, id2);
    if (!bond) return null;
    if (bond.type !== 2) return 'triple';
    const rings = ringAtomIdsOf(mol);
    if (rings.has(id1) || rings.has(id2)) return 'ring';
    // 分子（連結成分）が炭素と水素だけでできていること
    const comp = componentOf(mol, id1);
    if (![...comp].every(id => {
        const a = mol.atoms.find(x => x.id === id);
        return a && (a.element === 'C' || a.element === 'H');
    })) return 'hetero';
    const others = (id, other) => mol.getNeighbors(id)
        .filter(n => n.atom.element !== 'H' && n.atom.id !== other);
    const a = others(id1, id2), b = others(id2, id1);
    if (a.length === 0 || b.length === 0) return 'terminal';
    if (a.length > 2 || b.length > 2) return 'hetero';
    if (![...a, ...b].every(n => n.type === 1)) return 'hetero'; // 共役の内側は行き先が割れる
    return 'ok';
}

/** 酸化開裂を実行できる C=C の一覧（`[id1, id2]` の配列） */
function oxidativeCleavageSites(mol) {
    return multipleBondSites(mol).filter(s => alkeneCleavageClass(mol, s) === 'ok');
}

/**
 * 芳香環の側鎖酸化（トルエン → 安息香酸）の適用箇所 `[メチル炭素, 環炭素]`。
 *
 * **環に直結した -CH₃ だけ**を対象にする。炭素2個以上の側鎖でも生成物は安息香酸だが、
 * 切れて出ていく側の行き先（CO₂・カルボン酸）が条件で変わるので図にしない（§10.3）。
 *
 * ⚠ 環に -OH / -NH₂ が付いた分子（フェノール類・芳香族アミン）は**環そのものが
 * 酸化されて壊れる**ので候補に出さない。側鎖だけを残した生成物は書けない。
 */
function sideChainOxidationSites(mol) {
    const aromatic = aromaticAtomSet(mol);
    if (aromatic.size === 0) return [];
    const found = [];
    aromatic.forEach(ringId => {
        const comp = componentOf(mol, ringId);
        if ([...aromatic].some(a => comp.has(a) && activatingSubstituent(mol, a, aromatic))) return;
        mol.getNeighbors(ringId).forEach(n => {
            if (aromatic.has(n.atom.id) || n.atom.element !== 'C' || n.type !== 1) return;
            if (!isMethylCarbon(mol, n.atom.id)) return;
            found.push([n.atom.id, ringId]);
        });
    });
    // **並びは座標で決める**（C-2b。原子IDは乱数なので走査順に頼らない）
    const ordered = found
        .map(s => ({ s, a: mol.atoms.find(x => x.id === s[0]) }))
        .filter(x => x.a)
        .sort((p, q) => (q.a.x - p.a.x) || (p.a.y - q.a.y) || (p.s[0] < q.s[0] ? -1 : 1))
        .map(x => x.s);
    // **同じ生成物になる位置はまとめる**（RX8 と同じ考え方）。p-キシレンの2つの -CH₃ は等価
    const seen = new Set();
    return ordered.filter(s => {
        const key = sideChainProductKey(mol, s[0]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 「そのメチルを -COOH に変えたら何になるか」を正準コードで表した鍵。
 * `aromaticSiteClass` と同じ手口で、**位相だけの複製に生成物を作って**比べる。
 * 座標は見ないので、等価な位置は必ず同じ鍵になる。成分の同一性を前に置いて、
 * **別の分子の等価な位置どうしを1つにまとめない**（第2段の落とし穴）。
 */
function sideChainProductKey(mol, methylId) {
    const comp = componentOf(mol, methylId);
    const probe = new Molecule();
    const map = new Map();
    mol.atoms.forEach(a => {
        if (comp.has(a.id)) map.set(a.id, probe.addAtom(a.element, a.x, a.y).id);
    });
    mol.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) probe.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
    });
    const c = map.get(methylId);
    probe.addBond(c, probe.addAtom('O', 0, 0).id, 2);
    probe.addBond(c, probe.addAtom('O', 0, 0).id, 1);
    return [...comp].sort().join(',') + '#' + canonicalCode(probe);
}

/**
 * 酸化剤では**図を変えない**と決めた形の一覧と、その理由の種別。
 * `info` ルールは箇所を受け取らない（`onRuleClick` が `apply(game)` を引数なしで呼ぶ）ので、
 * 文面を作るときは分子をもう一度見る。ここは `{ sites, kinds }` の両方を返す。
 */
function oxidationOutOfScope(mol) {
    const sites = [];
    const kinds = new Set();
    multipleBondSites(mol).forEach(s => {
        const cls = alkeneCleavageClass(mol, s);
        if (cls === 'terminal' || cls === 'ring') { sites.push(s); kinds.add(cls); }
    });
    // 環に直結した炭化水素の側鎖で、-CH₃ ではないもの（エチルベンゼン・クメン・スチレン）
    const aromatic = aromaticAtomSet(mol);
    aromatic.forEach(ringId => {
        const comp = componentOf(mol, ringId);
        if ([...aromatic].some(a => comp.has(a) && activatingSubstituent(mol, a, aromatic))) return;
        mol.getNeighbors(ringId).forEach(n => {
            if (aromatic.has(n.atom.id) || n.atom.element !== 'C' || n.type !== 1) return;
            if (isMethylCarbon(mol, n.atom.id)) return;
            if (mol.getFreeValency(n.atom.id) < 1) return; // ベンジル位に水素が無ければ酸化されない
            // 側鎖が炭素と水素だけでできていること（-CHO・-CH₂OH は既存のルールが扱う）
            if (mol.getNeighbors(n.atom.id).some(m => m.atom.element !== 'C' && m.atom.element !== 'H')) return;
            sites.push([n.atom.id, ringId]);
            kinds.add('chain');
        });
    });
    return { sites, kinds };
}

/* ---- 酸と塩の行き来（qa の棚卸しで**いちばん大きかった穴・7項目**） ----
 *
 * このアプリは電荷をモデルに持たず、**塩は「線1本の共有結合」として書く**流儀
 * （`DESIGN_compound_coverage.md` §6-2・v353 決定）。その流儀の塩がすでに16件登録されているので、
 * **反応を足すだけで生成物の正準コードの一致まで確かめられる**。
 *
 * 対象は「-O-H ⇄ -O-Na」の付け外しだけ。カルボン酸・フェノール・スルホン酸の3つは
 * どれも「酸性の -OH」を持つので、**1つのルールの3つの入口**として書く（§10.6）。
 */

/** NaOH で塩にできる「酸性の -OH」。返り値は `[酸素のID, 付け根のID]` */
function neutralizableAcidSites(mol) {
    const sites = [];
    findFunctionalGroups(mol).forEach(g => {
        if (g.type === 'carboxyl') sites.push([g.atomIds[2], g.atomIds[0]]);
        else if (g.type === 'phenol') sites.push([g.atomIds[0], g.atomIds[1]]);
        else if (g.type === 'sulfo') sites.push([g.atomIds[3], g.atomIds[0]]);
    });
    // 置き場が無い箇所は候補に出さない（「検出はするが実行すると失敗する」を作らない）
    return sites.filter(([oId]) => mol.getFreeValency(oId) >= 1 && freeSpotAround(mol, oId));
}

/** 強酸で弱酸に戻せる塩（-COONa / -ONa / -SO₃Na と K 体）。返り値は `[金属のID, 酸素のID]` */
/**
 * 金属ナトリウムと反応する -OH を集める（P12-8 の穴埋め・2026-08-07。qa の棚卸しで2件）。
 *
 * 中和（`neutralizableAcidSites`）が**酸性の -OH だけ**を見るのに対し、金属ナトリウムは
 * **中性のアルコールの -OH とも反応して水素を出す**。ここが qa `org.alcohol.na` の要点
 * （そして `org.alcohol.ether-props` の「エーテルは反応しない」の相方）なので、
 * アルコールを足したうえで酸性の -OH も合わせる（付くのは同じ Na で、生成物も同じ）。
 *
 * エノールは対象外（互変異性でケト形に移る不安定な形なので、他のアルコール反応でも外している）。
 * エーテルは -OH を持たないので、そもそも `findFunctionalGroups` の alcohol に入らない。
 */
function sodiumReactiveSites(mol) {
    const sites = findFunctionalGroups(mol)
        .filter(g => ALCOHOL_TYPES.includes(g.type))
        .map(g => [g.atomIds[0], g.atomIds[1]])
        .concat(neutralizableAcidSites(mol));
    // 置き場が無い箇所は候補に出さない（「検出はするが実行すると失敗する」を作らない）
    const seen = new Set();
    return sites.filter(([oId]) => {
        if (seen.has(oId)) return false;
        seen.add(oId);
        return mol.getFreeValency(oId) >= 1 && freeSpotAround(mol, oId);
    });
}

function liberatableSaltSites(mol) {
    const sites = [];
    mol.atoms.forEach(a => {
        if (a.element !== 'Na' && a.element !== 'K') return;
        const nb = mol.getNeighbors(a.id).filter(n => n.atom.element !== 'H');
        if (nb.length !== 1 || nb[0].atom.element !== 'O' || nb[0].type !== 1) return;
        const o = nb[0].atom;
        // その酸素の向こうが C か S ＝ カルボン酸塩・フェノキシド・スルホン酸塩
        const beyond = mol.getNeighbors(o.id)
            .filter(n => n.atom.element !== 'H' && n.atom.id !== a.id);
        if (beyond.length !== 1 || !['C', 'S'].includes(beyond[0].atom.element)) return;
        sites.push([a.id, o.id]);
    });
    return sites;
}

/** その「酸性の -OH（もしくは -O-金属）」がどの酸のものか。文面の出し分けにだけ使う */
function acidKindOf(mol, oId, anchorId) {
    const anchor = mol.atoms.find(x => x.id === anchorId);
    if (!anchor) return { name: '酸', rank: '' };
    if (anchor.element === 'S') {
        return { name: 'スルホン酸', rank: 'スルホン酸は硫酸に近い強い酸です。' };
    }
    if (mol.getNeighbors(anchor.id).some(n => n.type === 2 && n.atom.element === 'O')) {
        return {
            name: 'カルボン酸',
            rank: '酸の強さは **カルボン酸 > 炭酸 > フェノール** の順なので、カルボン酸は炭酸水素ナトリウムとも反応して CO₂ を出します。'
        };
    }
    return {
        name: 'フェノール',
        rank: 'フェノールは**炭酸より弱い酸**なので、水酸化ナトリウムとは塩をつくりますが、炭酸水素ナトリウムとは反応しません（CO₂ が出ない）。ここがカルボン酸との見分け方です。'
    };
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
 * アセチレン（HC≡CH）の分子だけを集める。付加重合するとポリアセチレンになる。
 *
 * **置換基のあるアルキンは対象にしない**（P12-8 の穴埋め・2026-08-07）。理由は2つ:
 *   ① 高校で扱う「アルキンの付加重合」はアセチレン → ポリアセチレン（導電性高分子）だけ
 *   ② 1-アルキンを重合させると頭-尾の並びが問題になるが、その並びは教科書に無い。
 *      ビニル系（`vinylBonds`）のように置換基の数で頭を決める根拠が立たない
 * したがって「分子全体が C≡C の2原子だけ」＝アセチレンに限る。
 *
 * 返り値は {left, right}。**左右は座標で決める**（原子IDは乱数なので順序に頼らない。
 * `vinylBonds` が対称な C=C で頭尾が入れ替わって RX13 を落とした事故と同じ罠）
 */
function acetyleneUnits(mol) {
    const out = [];
    mol.bonds.forEach(b => {
        if (b.type !== 3) return;
        const a1 = mol.atoms.find(a => a.id === b.atomId1);
        const a2 = mol.atoms.find(a => a.id === b.atomId2);
        if (!a1 || !a2 || a1.element !== 'C' || a2.element !== 'C') return;
        // **1分子だけを見る**: この結合が属する連結成分の重原子が2個 ＝ アセチレン
        const heavy = [...componentOf(mol, a1.id)]
            .map(id => mol.atoms.find(a => a.id === id))
            .filter(a => a && a.element !== 'H');
        if (heavy.length !== 2) return;
        const first = (a1.x !== a2.x || a1.y !== a2.y)
            ? ((a1.x < a2.x || (a1.x === a2.x && a1.y < a2.y)) ? a1 : a2)
            : (a1.id < a2.id ? a1 : a2);
        const second = first.id === a1.id ? a2 : a1;
        out.push({ left: first.id, right: second.id, x: first.x });
    });
    return out;
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
    const diamine = comps.find(ids => ids !== diacid && countIn(ids, AMINE_NH_TYPES) >= 2);
    if (diamine) return { acidId: [...diacid][0], otherId: [...diamine][0], kind: 'amine' };
    return null;
}

/**
 * 縮合重合できるだけの単量体がそろっているかを見る（P12-8 の穴埋め・2026-08-07）。
 * 2価カルボン酸 n 個 ＋ 2価アルコール（or 2価アミン）n 個。**n ≧ 2 でなければ null**
 * ——— n = 1 はふつうのエステル化／アミド化なので `condensation_polymer_info` の担当。
 *
 * **共重合は扱わない**（高校範囲外）ので、酸どうし・相手どうしは同じ単量体に限る
 * （`addition_polymerization` が正準コードで単量体をそろえているのと同じ約束）。
 *
 * ⚠ **数える単位は1分子**。官能基は `findFunctionalGroups` がキャンバス全体を返すので、
 * 代表原子がどの連結成分に属すかで振り分けてから数える（§8.1 の「全体数え」を踏まない）。
 * 単量体が同じかどうかも `componentCode`（成分だけを複製してから正準コード）で見る。
 */
function condensationPolymerUnits(mol) {
    const groups = findFunctionalGroups(mol);
    const comps = [];
    const seen = new Set();
    mol.atoms.forEach(a => {
        if (seen.has(a.id)) return;
        const ids = componentOf(mol, a.id);
        ids.forEach(i => seen.add(i));
        const heavy = [...ids].map(i => mol.atoms.find(x => x.id === i))
            .filter(x => x && x.element !== 'H');
        if (heavy.length < 2) return; // 反応で出た水などは単量体に数えない
        comps.push({ ids, rep: heavy[0].id, x: Math.min(...heavy.map(x => x.x)) });
    });
    // 「その基の代表原子がこの成分にあるか」で1分子ごとに割り、**左の基から使う**
    // （画面の並びと繋がる順を合わせる。座標で決めるので原子IDの順序に頼らない）
    const pick = (c, types) => groups
        .filter(g => types.includes(g.type) && c.ids.has(g.atomIds[0]))
        .sort((p, q) => {
            const A = mol.atoms.find(x => x.id === p.atomIds[0]);
            const B = mol.atoms.find(x => x.id === q.atomIds[0]);
            return (A.x - B.x) || (A.y - B.y);
        });
    const acids = [], partners = [];
    comps.forEach(c => {
        const cx = pick(c, ['carboxyl']);
        if (cx.length >= 2) {
            acids.push({ ...c, links: cx.slice(0, 2).map(g => ({ c: g.atomIds[0], oh: g.atomIds[2] })) });
            return;
        }
        const al = pick(c, ALCOHOL_TYPES);
        if (al.length >= 2) {
            partners.push({ ...c, kind: 'alcohol', links: al.slice(0, 2).map(g => ({ x: g.atomIds[0] })) });
            return;
        }
        const am = pick(c, AMINE_NH_TYPES).filter(g => !isAmideNitrogen(mol, g.atomIds[0]));
        if (am.length >= 2) {
            partners.push({ ...c, kind: 'amine', links: am.slice(0, 2).map(g => ({ x: g.atomIds[0] })) });
        }
    });
    if (acids.length < 2 || partners.length < 2) return null;
    const sameAs = (list, head) => {
        const code = componentCode(mol, head.rep);
        return list.filter(u => componentCode(mol, u.rep) === code);
    };
    const kind = partners[0].kind;
    const ps = sameAs(partners.filter(p => p.kind === kind), partners[0]);
    const as = sameAs(acids, acids[0]);
    const n = Math.min(as.length, ps.length);
    if (n < 2) return null;
    const byX = (p, q) => p.x - q.x;
    return { acids: as.sort(byX).slice(0, n), partners: ps.sort(byX).slice(0, n), kind };
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

// ---- ヨードホルム反応（高校で必ず出る識別反応。2026-08-04 ヨウ素レーン） ----

// 「メチル基 -CH₃」か。重原子の隣がちょうど1つで、空き価標が3（＝水素3本）であること。
// -CH₂- や -CH< を取り違えないよう、隣の数だけでなく水素の数まで見る
function isMethylCarbon(mol, id) {
    const a = mol.atoms.find(x => x.id === id);
    if (!a || a.element !== 'C') return false;
    const nb = mol.getNeighbors(id).filter(n => n.atom.element !== 'H');
    return nb.length === 1 && nb[0].type === 1 && mol.getFreeValency(id) === 3;
}

/**
 * ヨードホルム反応の適用箇所 `[メチル炭素のID, 隣の炭素のID]` を返す。
 *
 * 陽性なのは **CH₃-CO-（メチルケトンとアセトアルデヒド）** と **CH₃-CH(OH)-** の2つだけ。
 * 後者は反応の中でいったん酸化されて前者になるので、-OH の付いた炭素に水素が
 * 残っていること（＝酸化できること）まで見る。
 *
 * **陰性の例と並べて初めて意味がある反応**なので、外れるものを列挙しておく:
 * 1-プロパノール（隣が -CH₂- でメチルでない）／メタノール（メチル自身に -OH が付いており
 * 「隣のメチル」が無い）／酢酸・酢酸エチル・酢酸ナトリウム（カルボニル炭素に単結合の O が
 * 付いた形は `findFunctionalGroups` が carboxyl / ester / carboxylate と別の型で返すので
 * ケトン・アルデヒドに入らない）／3級アルコール（-OH の炭素に水素が無く酸化できない）。
 *
 * 同じ隣接炭素にメチルが2つ付く場合（アセトン）は**どちらで切っても生成物が同じ**なので
 * 1件にまとめる。どちらを採るかは**座標で決める**（原子IDは乱数で走査順が揺れるため。
 * DEVELOPMENT.md「このセッションで分かった落とし穴」）
 */
function detectIodoform(mol) {
    const groups = findFunctionalGroups(mol);
    const anchors = new Map(); // 隣の炭素ID -> メチル炭素IDの配列
    const add = (kId, mId) => {
        if (!anchors.has(kId)) anchors.set(kId, []);
        anchors.get(kId).push(mId);
    };
    const methylNeighbors = (cId) => mol.getNeighbors(cId)
        .filter(n => n.type === 1 && isMethylCarbon(mol, n.atom.id));
    // CH₃-CO-（メチルケトン・アセトアルデヒド）
    groups.filter(g => g.type === 'ketone' || g.type === 'aldehyde').forEach(g => {
        methylNeighbors(g.atomIds[0]).forEach(n => add(g.atomIds[0], n.atom.id));
    });
    // CH₃-CH(OH)-（-OH の付いた炭素に水素が残っているもの）
    groups.filter(g => ALCOHOL_TYPES.includes(g.type)).forEach(g => {
        const cId = g.atomIds[1];
        if (mol.getFreeValency(cId) < 1) return; // 3級アルコール＝酸化できないので陰性
        methylNeighbors(cId).forEach(n => add(cId, n.atom.id));
    });
    const sites = [];
    anchors.forEach((methyls, kId) => {
        const pick = methyls
            .map(id => mol.atoms.find(a => a.id === id))
            .sort((p, q) => p.x - q.x || p.y - q.y)[0];
        if (pick) sites.push([pick.id, kId]);
    });
    return sites;
}

/**
 * 切り離したメチル炭素を、**ヨウ素3本を置ける場所**まで動かして、その3点を返す。
 * `parkAsWater` と同じ「近い順に格子点を見る」やり方だが、置くのは1原子ではなく
 * CHI₃ なので、中心だけでなく**直交4方向の点まで**空きを確かめる
 * （3本がヨウ素・残る1方向が自動水素の置き場になる）。置けなければ null。
 * 返す順は上・左・右 ＝ 登録エントリ「ヨードホルム（トリヨードメタン）」と同じ形になる
 */
function freeSpotsForIodoform(mol, cId) {
    const c = mol.atoms.find(a => a.id === cId);
    if (!c) return null;
    const G = bondStep(mol);
    const KEEP = G * 1.2;
    const others = mol.atoms.filter(a => a.id !== cId && a.element !== 'H');
    const bonds = mol.bonds
        .filter(b => b.atomId1 !== cId && b.atomId2 !== cId)
        .map(b => [mol.atoms.find(a => a.id === b.atomId1), mol.atoms.find(a => a.id === b.atomId2)])
        .filter(([a, b]) => a && b);
    const free = (p) => others.every(a => Math.hypot(a.x - p.x, a.y - p.y) >= KEEP) &&
                        bonds.every(([a, b]) => pointSegmentDistance(p, a, b) >= G * 0.5);
    const cands = [];
    for (let i = -8; i <= 8; i++) {
        for (let j = -8; j <= 8; j++) {
            const d = Math.hypot(i, j);
            if (d < 2.5 || d > 8) continue; // 中心を2マス半以上離す（別の分子として読める間隔）
            cands.push({ x: c.x + i * G, y: c.y + j * G, d });
        }
    }
    cands.sort((p, q) => p.d - q.d);
    const dirs = [[0, -1], [-1, 0], [1, 0], [0, 1]]; // 上・左・右・下
    for (const p of cands) {
        if (!free(p)) continue;
        const around = dirs.map(([dx, dy]) => ({ x: p.x + dx * G, y: p.y + dy * G }));
        if (!around.every(free)) continue;
        c.x = p.x;
        c.y = p.y;
        return around.slice(0, 3); // 下の1方向は自動水素に残す
    }
    return null;
}

/* ---- 呈色・検出の下ごしらえ（DESIGN_reagent_palette.md 第3段） ----
 * どちらも**その分子だけ**を見る（第2段の detect 監査・§7.7）。 */

/**
 * 還元性を示す炭素（銀鏡反応・フェーリング液が陽性になる根拠）を返す。
 *
 * ① -CHO（アルデヒド）… カルボニル炭素に水素が残っているので酸化されうる
 * ② 環状の糖のアノマー炭素（ヘミアセタール）… 水の中で開環して -CHO を出すので還元性を示す。
 *    「環の酸素」と「環の外の -OH」が同じ炭素についている形で見分ける。
 *    グリコシド結合（スクロース側）の酸素は重原子の隣が2つあるので外れる ＝ 非還元糖
 */
function reducingCarbonylAtoms(mol) {
    const ids = [];
    findFunctionalGroups(mol)
        .filter(g => g.type === 'aldehyde')
        .forEach(g => ids.push(...g.atomIds));
    const ring = ringAtomIdsOf(mol);
    mol.atoms.forEach(a => {
        if (a.element !== 'C' || !ring.has(a.id)) return;
        const nb = mol.getNeighbors(a.id).filter(n => n.type === 1 && n.atom.element === 'O');
        const ringO = nb.find(n => ring.has(n.atom.id));
        const hydroxyl = nb.find(n => !ring.has(n.atom.id) &&
            mol.getNeighbors(n.atom.id).filter(x => x.atom.element !== 'H').length === 1);
        if (ringO && hydroxyl) ids.push(a.id, hydroxyl.atom.id);
    });
    return [...new Set(ids)];
}

/**
 * アミノ酸の窒素（ニンヒドリンが陽性になる根拠）を返す。
 * **-NH₂ と -COOH が同じ連結成分にあること**まで見る ——
 * 酢酸とアニリンを隣に並べただけで陽性になっては、検出法の意味がなくなる。
 */
function aminoAcidNitrogens(mol) {
    const groups = findFunctionalGroups(mol);
    const acids = groups.filter(g => g.type === 'carboxyl' || g.type === 'carboxylate');
    if (acids.length === 0) return [];
    return groups
        .filter(g => AMINE_NH_TYPES.includes(g.type) && !isAmideNitrogen(mol, g.atomIds[0]))
        .filter(g => {
            const comp = componentOf(mol, g.atomIds[0]);
            return acids.some(cx => comp.has(cx.atomIds[0]));
        })
        .map(g => g.atomIds[0]);
}

/* ---- 試薬瓶（DESIGN_reagent_palette.md 第2段・変えるもの13本 ／ 第3段・調べるもの5本） ----
 *
 * 自動案内（`refresh()`）が「分子 → できる反応」を引くのに対して、瓶は
 * 「**試薬 → 起こること**」を逆から引く。**新しい化学は1つも持たない** ——
 * 瓶が押されたら、その `id` を `reagentId` に持つルールの `detect` を**実際に回す**だけ。
 * 判定を試薬側に書き写さないので、反応を1つ足せば自動案内にも瓶にも同時に出る（同書 §1.1）。
 *
 * ⚠ **瓶はグレーアウトしない**（同書 §1.2）。効かない組み合わせを選べることが手動実験の価値で、
 * 「エタンに臭素水を入れても脱色しない」という体験がそのまま検出法の理解になる。
 * 空振りのときの応答は `explainReagentMiss()`（同書 §4）。
 *
 * | フィールド | 用途 |
 * |---|---|
 * | `acts` | 空振りのときに返す「この試薬が効くのは〜です」（同書 §4.2 ②）。**瓶ごとに1つ**でよく、ルール9件それぞれに書き写さない ——「どの官能基に効くか」は瓶の性質でルールの性質ではないから |
 * | `miss` | **効かないこと自体が教材**になる組み合わせの一言（同書 §4.2 ③）。構造を見て出し分けないので、瓶ごとの固定文にとどめる |
 *
 * 並びは `kind` の順（`transform` → `detect`）にそのまま出る（同書 §3.2 の
 * 「変えるもの／調べるもの」の2区分）。**この配列の順が画面の順**なので、
 * 教科書で並んで出るもの（酸化剤・濃硫酸・希硫酸…）を近くに置く。
 */
/* ---- H–X 付加は「1つの規則の枝」（v818・qa の棚卸し③） ----
 *
 * v817 までは瓶もルールも **HBr の1本だけ**だった。そのため
 * 「HCl の付加でポリ塩化ビニルの原料（塩化ビニル）ができる」を問う項目を画面で追うと、
 * **マルコフニコフ則は正しいのに生成物が臭化物になる**（ラベルとずれる）。
 *
 * ⚠ **`apply` を複製しない。** ハロゲンの種類だけが違い、規則（マルコフニコフ則）も
 * 適用箇所（`multipleBondSites`）も同じなので、**表を1つ置いて瓶とルールの両方を生成する**。
 * こうしておくと、付加の規則を直したときに3本ぶん同時に直る ——
 * 3つ書き写すと、片方だけ直った状態を回帰テストでも見つけにくい。
 */
const HYDROGEN_HALIDES = [
    {
        key: 'hbr', element: 'Br', name: '臭化水素', formula: 'HBr',
        note: 'エチレンからは臭化エチル（ブロモエタン）ができます。'
    },
    {
        key: 'hcl', element: 'Cl', name: '塩化水素', formula: 'HCl',
        note: 'アセチレンに付加すると**塩化ビニル**ができ、これを付加重合するとポリ塩化ビニル（PVC）になります。'
    },
    {
        key: 'hi', element: 'I', name: 'ヨウ化水素', formula: 'HI',
        note: 'ハロゲン化水素の付加のしやすさは HI > HBr > HCl の順で、どれも同じマルコフニコフ則に従います。'
    }
];

// 瓶（`REAGENTS` に展開）とルール（`REACTION_RULES` に展開）を**同じ表から**作る
const HYDROGEN_HALIDE_REAGENTS = HYDROGEN_HALIDES.map(h => ({
    id: h.key,
    name: h.name,
    formula: h.formula,
    kind: 'transform',
    acts: 'C=C や C≡C の不飽和結合です',
    miss: '左右非対称なアルケンでは「H はすでに H の多い炭素へ」付きます（マルコフニコフ則）。' +
        'ハロゲン化水素はどれも同じ規則に従うので、瓶を変えても付く位置は変わりません。'
}));

// ⚠ `id` は **`add_hbr` を含めて従来どおり**（`add_hbr` / `add_hcl` / `add_hi`）。
// 既存の回帰テスト・台本・デモがこの id を名指ししているので、揃え直すために改名しない
const HYDROGEN_HALIDE_RULES = HYDROGEN_HALIDES.map(h => ({
    id: `add_${h.key}`,
    reagentId: h.key,
    label: `付加: ${h.formula}（マルコフニコフ則）`,
    // **detect も apply も枝ごとに書かない**。違うのは付ける元素だけ
    detect: multipleBondSites,
    apply(game, site) {
        return addAcrossMultipleBond(game, site, h.element, null,
            `${h.name} ${h.formula} が付加しました。` +
            '左右非対称なアルケンでは「H はすでに H の多い炭素へ、X は置換基の多い炭素へ」付く主生成物を示しています（マルコフニコフ則）。' +
            h.note);
    }
}));

const REAGENTS = [
    {
        id: 'br2_water',
        name: '臭素水',
        formula: 'Br₂',
        kind: 'transform',
        acts: 'C=C や C≡C の不飽和結合と、フェノール・アニリンのように活性化されたベンゼン環です',
        // ⚠ **ここは一般論と例外を書き分ける**（2026-08-06。qa の棚卸しで「逆を教えている」と指摘された箇所）。
        // v815 までは「ベンゼン環は付加ではなく置換なので、この条件では脱色しません」とだけ書いてあり、
        // フェノールに臭素水を掛けた人に**教科書と正反対の答え**を返していた。
        // ① ベンゼン環一般の話（触媒が要る＝この条件では進まない）と
        // ② 活性化された環の話（フェノール・アニリンは触媒なしで進む）を分けて書く。
        // ②は `bromination_activated_ring` として実装済みなので、**この文が出るのは①のときだけ**
        miss: '赤褐色が消えないこと自体が「不飽和結合が無い」ことの証拠で、これが臭素水による検出法です。' +
            'ベンゼンやトルエンのようなふつうの芳香族は、付加ではなく置換で反応するうえ、その置換にも鉄などの触媒が要るので、この条件では脱色しません。' +
            'ただし**フェノールとアニリンは例外**です。環に電子を押し込む基（-OH・-NH₂）がついていて環が活性化されているため、触媒なし・常温でも置換が進み、2,4,6-トリブロモ体の白色沈殿ができます。'
    },
    {
        id: 'oxidant',
        name: '酸化剤',
        // KMnO₄/H⁺ でも K₂Cr₂O₇/H⁺ でも高校で扱う生成物は同じなので**瓶は1本にまとめる**
        // （同書 §2.3。2本に分けると「どちらの瓶を押したか」で apply に分岐が入ってしまう）
        formula: '[O]',
        kind: 'transform',
        acts: '1級・2級アルコールと、アルデヒドです',
        miss: 'ケトンやカルボン酸は、これ以上は酸化されにくい構造です。'
    },
    {
        id: 'h2so4_conc',
        name: '濃硫酸',
        formula: 'H₂SO₄',
        kind: 'transform',
        acts: 'アルコール（脱水）・カルボン酸とアルコール（エステル化の触媒）・ベンゼン環（スルホン化）です',
        miss: '加熱の温度で行き先が変わるので、効くときは条件を選ぶ画面が出ます。'
    },
    {
        id: 'h2so4_dil',
        name: '希硫酸',
        formula: 'H₂SO₄ aq',
        kind: 'transform',
        acts: 'エステルと酸無水物と二糖のグリコシド結合（加熱すると水が入って切れます）と、カルボン酸・フェノール・スルホン酸のナトリウム塩（弱酸の遊離）です',
        miss: '同じエステルでも、NaOH で切ると出てくるのはカルボン酸ではなく**その塩**です（けん化）。酸で切るこちらは平衡なので、逆のエステル化も同時に起こります。' +
            'また、強い酸は弱い酸をその塩から追い出します（弱酸の遊離）が、遊離させる相手の塩がいまの分子にはありません。' +
            '単糖（グルコースなど）は、これ以上切れる -O- のつながりを持たないので加水分解されません。切れるのは単糖どうしをつないだ二糖・多糖のグリコシド結合です。'
    },
    {
        id: 'naoh_aq',
        name: '水酸化ナトリウム',
        formula: 'NaOH aq',
        kind: 'transform',
        acts: 'エステル（油脂を含む・けん化）と、酸性の -OH をもつもの（カルボン酸・フェノール・スルホン酸）です',
        // ⚠ 陰性で説明できることを書く（同書 §9.2）。「アルコールの -OH は中和されない」は
        // 否定形の知識項目そのもので、陽性の絵より先に効く
        miss: 'けん化でできるのはカルボン酸の塩なので、逆のエステル化が起こらず反応は完全に進みます。酸で切る加水分解とはここが違います。' +
            'なお、**アルコールの -OH は中和されません**（中性なので塩をつくらない）。同じ -OH でも、カルボン酸・フェノールの -OH だけが酸性です。'
    },
    {
        /* 金属ナトリウム（試薬パレット §3.1 の13番目・§5 第4段で最初から予定されていた瓶）。
         * **水酸化ナトリウム水溶液の隣に置く**: 同じ -OH でも、中性のアルコールは NaOH とは
         * 中和しないのに Na とは反応して水素を出す —— この対比が qa の `org.alcohol.na` と
         * `org.alcohol.ether-props` の要点で、瓶が並んでいないと画面で比べられない。
         * ⚠ これで「変えるもの」は 16本・全体で 21本になる（試薬パレット §10.2 の申し送り）。 */
        id: 'sodium_metal',
        name: '金属ナトリウム',
        formula: 'Na',
        kind: 'transform',
        acts: 'アルコールの -OH です（水素が発生してナトリウムアルコキシドになります）。フェノールやカルボン酸の酸性の -OH でも同じように水素が出ます',
        miss: 'エーテルは -OH を持たないのでナトリウムと反応しません。同じ分子式 C₂H₆O でも、エタノールは水素を出し、ジメチルエーテルは出しません —— これがアルコールとエーテルの見分け方です。' +
            'また、アルコールは中性なので**水酸化ナトリウム水溶液とは中和しません**。「ナトリウム」と付いていても、金属ナトリウムとは結果が違います。'
    },
    {
        id: 'h2_ni',
        name: '水素・Ni',
        formula: 'H₂',
        kind: 'transform',
        acts: 'C=C や C≡C の不飽和結合です（ニッケルや白金を触媒に加熱）',
        miss: 'ベンゼン環も高温・高圧なら付加しますが、ふつうの条件では進みません（芳香族性を保つ方が安定なため）。'
    },
    // ハロゲン化水素は3本まとめて（上の表から生成）。**瓶の並びはここに入る**
    ...HYDROGEN_HALIDE_REAGENTS,
    {
        id: 'h2o_acid',
        name: '水・酸触媒',
        formula: 'H₂O',
        kind: 'transform',
        acts: 'C=C や C≡C の不飽和結合です（リン酸などの酸が触媒）',
        miss: 'アルケンに水が付加するとアルコールになります。逆向きが濃硫酸による脱水で、同じ2つの物質を行き来しています。'
    },
    {
        id: 'cl2_fe',
        name: '塩素・鉄触媒',
        formula: 'Cl₂',
        kind: 'transform',
        acts: 'ベンゼン環です（鉄を触媒に置換）',
        miss: '光を当てるとアルカンの水素とも置換しますが（ラジカル置換）、このアプリでは鉄触媒による環の置換だけを扱います。'
    },
    {
        id: 'mixed_acid',
        name: '混酸',
        formula: 'HNO₃/H₂SO₄',
        kind: 'transform',
        acts: 'ベンゼン環です（ニトロ化）',
        miss: '環に電子を引く基（-NO₂・-SO₃H・-COOH）が増えるほど、次の置換は進みにくくなります。'
    },
    {
        id: 'acetic_anhydride',
        name: '無水酢酸',
        formula: '(CH₃CO)₂O',
        kind: 'transform',
        acts: 'フェノール性の -OH と、アミノ基 -NH₂ です（アセチル化）',
        miss: 'カルボン酸より反応性が高いので、直接エステル化が進みにくいフェノールもエステルにできます。アミドの N は電子を引かれていて反応しません。'
    },
    {
        id: 'sulfur',
        name: '硫黄',
        formula: 'S',
        kind: 'transform',
        acts: '重合でできたゴムの鎖に残っている C=C です（加硫）',
        miss: '単量体やふつうのアルケンは加硫の相手にしません。先に 1,4-付加重合で鎖を作ってください。'
    },
    {
        // ⚠ **設計 §2.5 は「第3段までは構造を変えない」としていたが、`iodoform` は
        //    その後（2026-08-04 ヨウ素レーン）に CHI₃ とカルボン酸塩まで作る反応として
        //    実装済み**。したがってこの瓶は「調べるもの」ではなく**変えるもの**に置く
        //    （§7.8 に書き戻した）。黄色沈殿の確認という主眼は caption が担っている
        id: 'i2_naoh',
        name: 'ヨウ素・NaOH',
        formula: 'I₂/NaOH',
        kind: 'transform',
        acts: 'CH₃-CO- か CH₃-CH(OH)- の形です（ヨードホルム反応）',
        miss: '1-プロパノールやメタノールは陰性です。「CH₃ がカルボニル（か -OH のついた炭素）に直接ついているか」だけが決め手なので、陰性の例と並べて初めて識別に使えます。'
    },

    /* ---- 調べるもの（第3段・5本）。**構造を変えない** ----
     * 呈色・検出は `REACTION_RULES` に混ぜない（同書 §2.5）。混ぜると `apply` が
     * 「何もしない」ものになり、`saveState()` が空の履歴を積む・前後比較が
     * 「変化なし」の2枚を出す、という壊れ方をする。実体は下の `DETECTION_TESTS`。
     *
     * ⚠ **NaHCO₃ を入れるかの保留（§3.1・§6）はここで決着 ＝ 入れる。** 理由は2つ:
     *   ① §4.2 ③ の6組の最後の1つ「NaHCO₃ × フェノール（CO₂ が出ない）」が、
     *      この瓶が無いと画面のどこからも出せない
     *   ② ヨードホルムが「変えるもの」へ移った（上）ので、調べるものはちょうど5本になる
     */
    {
        id: 'ag_ammonia',
        name: 'アンモニア性硝酸銀',
        formula: 'AgNO₃/NH₃',
        kind: 'detect',
        acts: '-CHO をもつアルデヒドと還元糖です'
    },
    {
        id: 'fehling',
        name: 'フェーリング液',
        formula: 'Cu²⁺',
        kind: 'detect',
        acts: '-CHO をもつアルデヒドと還元糖です'
    },
    {
        id: 'fecl3',
        name: '塩化鉄(III)',
        formula: 'FeCl₃',
        kind: 'detect',
        acts: '環に直結した -OH（フェノール性ヒドロキシ基）です'
    },
    {
        id: 'ninhydrin',
        name: 'ニンヒドリン',
        formula: 'C₉H₆O₄',
        kind: 'detect',
        acts: 'アミノ酸（同じ分子に -NH₂ と -COOH をもつもの）です'
    },
    {
        id: 'nahco3',
        name: '炭酸水素ナトリウム',
        formula: 'NaHCO₃',
        kind: 'detect',
        acts: 'カルボン酸 -COOH です（炭酸より強い酸）'
    }
];

/* ---- 呈色・検出（DESIGN_reagent_palette.md §2.5・第3段の5本） ----
 *
 * **構造を変えないので `apply` を持たない。** 返すのは「陽性の根拠になった原子」だけで、
 * 陽性/陰性はその配列が空かどうかで決まる（判定を2か所に書かない）。
 *
 * ⚠ **どの detect も「その分子」だけを見る**（第2段の申し送り・§7.7）。
 * ニンヒドリンだけが -NH₂ と -COOH の同居を見るので、`componentOf` で
 * **同じ連結成分にあること**まで確かめる（隣に酢酸を置いただけでアニリンが
 * アミノ酸になってしまわないように）。
 */
const DETECTION_TESTS = [
    {
        id: 'tollens',
        reagentId: 'ag_ammonia',
        detect: reducingCarbonylAtoms,
        positive: '銀が析出して、試験管の内側が鏡のようになります（銀鏡反応）。還元性を示すのは -CHO をもつアルデヒドと還元糖で、-CHO 自身は酸化されてカルボン酸（の塩）に変わります。',
        negative: 'この分子に還元性の -CHO はありません。ケトンは同じカルボニル基 C=O を持ちますが、カルボニル炭素に水素が無いので酸化されず、銀鏡反応を示しません。「同じ C=O でも還元性があるのは -CHO だけ」がこの試薬の要点です。'
    },
    {
        id: 'fehling',
        reagentId: 'fehling',
        detect: reducingCarbonylAtoms,
        positive: '赤色の沈殿 Cu₂O（酸化銅(I)）ができます。フェーリング液の青い Cu²⁺ が還元されて Cu⁺ になった色です。銀鏡反応と同じく -CHO（還元糖を含む）の検出に使います。',
        negative: 'この分子に還元性の -CHO はありません。フェーリング液を還元するのは -CHO をもつものだけで、ケトンやカルボン酸は還元しません。'
    },
    {
        id: 'fecl3',
        reagentId: 'fecl3',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'phenol')
                .flatMap(g => g.atomIds);
        },
        positive: '紫〜青紫に呈色します。フェノール類の検出法で、鉄(III)イオンとフェノール性の -OH がつくる錯イオンの色です。',
        negative: '呈色しません。塩化鉄(III) で紫になるのは**ベンゼン環に直接ついた -OH（フェノール性）**だけで、鎖についたアルコールの -OH では呈色しません。ベンジルアルコールのように「環はあるが -OH は鎖の側」という分子が陰性になるのが、この試薬の見どころです。'
    },
    {
        id: 'ninhydrin',
        reagentId: 'ninhydrin',
        detect: aminoAcidNitrogens,
        positive: '紫色に呈色します。アミノ酸の検出法で、指紋の検出にも使われます。',
        negative: '呈色しません。ニンヒドリンが反応するのはアミノ酸、つまり**同じ分子の中に -NH₂ と -COOH の両方がある**ものです。酢酸（-COOH だけ）もアニリン（-NH₂ だけ）も陰性で、2つを並べて置いても陽性にはなりません。'
    },
    {
        id: 'nahco3',
        reagentId: 'nahco3',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'carboxyl')
                .map(g => g.atomIds[0]);
        },
        positive: '気体（二酸化炭素 CO₂）が発生します。炭酸より強い酸だけが炭酸水素ナトリウムから CO₂ を追い出せるので、これは -COOH をもつカルボン酸であることの証拠になります。',
        negative: 'CO₂ は発生しません。フェノールも酸性を示しますが**炭酸より弱い酸**なので、炭酸水素ナトリウムとは反応しません。カルボン酸とフェノールを見分ける定番の方法がこれです。'
    }
];

// ---- 反応ルール（detect は適用箇所の配列を返す。apply は分子を書き換える） ----
const REACTION_RULES = [
    {
        id: 'oxidize_primary',
        mechanismId: 'ethanol_oxidation',
        label: '酸化 [O] → アルデヒド',
        reagentId: 'oxidant',
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
            bendCarbonyl(game.userMolecule, cId, oId); // 鎖と一直線なら折る（C-7）
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
        reagentId: 'oxidant',
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
            bendCarbonyl(game.userMolecule, cId, oId); // 鎖と一直線なら折る（C-7）
            return {
                caption: '2級アルコールが酸化されてケトンになりました（R-CH(OH)-R\' + [O] → R-CO-R\' + H₂O）。ケトンはアルデヒドと違い、それ以上酸化されにくい構造です。',
                changed: [oId, cId]
            };
        }
    },
    {
        id: 'oxidize_aldehyde',
        label: '酸化 [O] → カルボン酸',
        reagentId: 'oxidant',
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
        // 「効かないこと自体が教材」（同書 §4.2 ③）が**既存の info ルールでそのまま賄える**唯一の例。
        // 瓶に紐づけておくと、[O] を3級アルコールに掛けたときに解説だけが返る（分子は変わらない）
        reagentId: 'oxidant',
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
        /* トルエン → 安息香酸（高校の必修）。v816 まで酸化剤は
         * 1級・2級アルコールとアルデヒドにしか作用しなかったので、画面から出せなかった。
         * 対象は**環に直結した -CH₃ だけ**（切り出す範囲の根拠は §10.3）。 */
        id: 'oxidize_side_chain',
        reagentId: 'oxidant',
        label: '酸化 [O] → 側鎖酸化（芳香族カルボン酸）',
        detect(mol) { return sideChainOxidationSites(mol); },
        apply(game, site) {
            const [mId] = site;
            const mol = game.userMolecule;
            // **置き場は2つとも先に確かめる**（途中で失敗して -CHO のまま残さない）
            const s1 = freeSpotAround(mol, mId);
            const s2 = s1 ? freeSpotAround(mol, mId, [s1]) : null;
            if (!s1 || !s2) throw new Error('-COOH を置く空間がありません。まわりを空けてから実行してください');
            const o1 = mol.addAtom('O', s1.x, s1.y);
            mol.addBond(mId, o1.id, 2);
            const o2 = mol.addAtom('O', s2.x, s2.y);
            mol.addBond(mId, o2.id, 1);
            return {
                caption: '側鎖のメチル基が酸化されてカルボキシ基になりました（トルエン → 安息香酸）。' +
                    '強い酸化剤（過マンガン酸カリウムなど）を熱して働かせると、ベンゼン環は壊れずに' +
                    '**側鎖だけ**が酸化されます。環が安定（芳香族性）なのに対し、環のとなりの炭素は' +
                    '酸化を受けやすいためです。o-キシレンのようにメチルが2つあれば、2回くり返して' +
                    'フタル酸まで進められます（p-キシレンから作るテレフタル酸は PET の原料）。' +
                    '側鎖が炭素2つ以上でも、残るのは環に直結した炭素だけで同じ安息香酸になります。',
                changed: [mId, o1.id, o2.id]
            };
        }
    },
    {
        /* アルケンの酸化開裂 ＝ **構造決定の主役**（qa の需要は1項目だが単元そのもの）。
         * 生成物は「もとの C=C の炭素についていた炭素の数」だけで決まる:
         *   炭素2つ（R₂C=）→ ケトン ／ 炭素1つ（RCH=）→ カルボン酸
         * 炭素0（=CH₂）は CO₂ になるので扱わない（`oxidation_out_of_scope_info`）。 */
        id: 'oxidative_cleavage',
        reagentId: 'oxidant',
        label: '酸化 [O] → 酸化開裂（C=C を切る）',
        detect(mol) { return oxidativeCleavageSites(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const [id1, id2] = site;
            const bond = mol.getBond(id1, id2);
            if (!bond || bond.type !== 2) throw new Error('切る C=C が見つかりません');
            // 行き先は**切る前**に決める（切ったあとでは「もとの相手」が分からなくなる）
            const carbons = (id, other) => mol.getNeighbors(id)
                .filter(n => n.atom.element === 'C' && n.atom.id !== other).length;
            const roles = [[id1, carbons(id1, id2)], [id2, carbons(id2, id1)]];
            mol.removeBond(id1, id2);
            const part = [...componentOf(mol, id2)];
            if (!part.includes(id1)) {
                const sep = separateComponent(mol, part);
                if (sep) translateAtoms(mol, part, sep.dx, sep.dy);
            }
            const changed = [id1, id2];
            roles.forEach(([cid, nC]) => {
                const s1 = freeSpotAround(mol, cid);
                const s2 = nC === 1 ? freeSpotAround(mol, cid, s1 ? [s1] : []) : null;
                if (!s1 || (nC === 1 && !s2)) {
                    throw new Error('生成物を置く空間がありません。分子を離してから実行してください');
                }
                const o1 = mol.addAtom('O', s1.x, s1.y);
                mol.addBond(cid, o1.id, 2);
                changed.push(o1.id);
                if (nC === 1) { // 水素が1つ残っていた炭素は、アルデヒドを経てカルボン酸まで進む
                    const o2 = mol.addAtom('O', s2.x, s2.y);
                    mol.addBond(cid, o2.id, 1);
                    changed.push(o2.id);
                }
            });
            const names = roles.map(([, nC]) => (nC === 1 ? 'カルボン酸' : 'ケトン'));
            const both = names[0] === names[1] ? `${names[0]}が2つ` : `${names[0]}と${names[1]}`;
            return {
                caption: `C=C が切れて、${both}になりました（酸化開裂）。` +
                    '硫酸酸性の過マンガン酸カリウムのような強い酸化剤を使うと、二重結合のところで炭素鎖が切れます。' +
                    '行き先は**その炭素についていた炭素の数**だけで決まります: ' +
                    '炭素が2つ（R₂C=）ならケトン、炭素が1つ（RCH=）ならアルデヒドを経てカルボン酸まで進みます。' +
                    'この反応は、できた化合物から**もとの二重結合の位置を逆算する**ために使います（構造決定）。' +
                    'できた分子は重なりを避けて離してあります。',
                changed,
                refit: true
            };
        }
    },
    {
        /* §10.3・§10.4 の線引きを**画面から見えるようにする** info（「判断できないものは出さない」の
         * 出さない側に、理由だけは返す）。箇所は受け取らないので文面は分子をもう一度見て作る。 */
        id: 'oxidation_out_of_scope_info',
        reagentId: 'oxidant',
        label: '⚠ 酸化（ここでは図を変えない範囲）',
        info: true,
        detect(mol) { return oxidationOutOfScope(mol).sites; },
        apply(game) {
            const kinds = oxidationOutOfScope(game.userMolecule).kinds;
            const parts = [];
            if (kinds.has('terminal')) {
                parts.push('**末端の C=C（=CH₂ の側）**は、酸化開裂すると二酸化炭素 CO₂ と水になって出ていきます。' +
                    '残る骨格のほうはカルボン酸（またはケトン）になります。' +
                    '図に残らないものを置くと以後の反応の相手として数えられてしまうので、ここでは切りません。');
            }
            if (kinds.has('ring')) {
                parts.push('**環の中の C=C** を切ると環が開いて、両端にカルボキシ基をもつ1つの分子になります' +
                    '（シクロヘキセン → アジピン酸。ナイロン66 の原料です）。' +
                    'いまは「切ったのに1分子のまま」を図で扱えないので、ここでは変えません。');
            }
            if (kinds.has('chain')) {
                parts.push('**炭素2つ以上の側鎖**（エチルベンゼン・クメン・スチレンなど）も、' +
                    '強い酸化剤で酸化すると環に直結した炭素だけが残って**安息香酸**になります。' +
                    'ただし切れて出ていく側の行き先が条件で変わるので、ここでは図を変えません。' +
                    '側鎖が -CH₃ のとき（トルエン・キシレン）は実際に安息香酸・フタル酸まで進められます。');
            }
            return {
                caption: (parts.join('\n') || 'この分子で酸化剤が働く形は、いまは図にしていません。') +
                    '\n酸化剤で図が変わるのは、1級・2級アルコール／アルデヒド／環に直結した -CH₃／' +
                    '炭化水素の非末端 C=C の4つです。'
            };
        }
    },
    {
        // 生成物が2つに分かれる（CHI₃ ＋ カルボン酸のナトリウム塩）。塩は -COO-Na を
        // 線1本で書く既存の流儀に乗せる（v353・イオンはモデルに持ち込まない）
        id: 'iodoform',
        reagentId: 'i2_naoh',
        label: 'ヨードホルム反応（I₂ + NaOH）→ CHI₃（黄色沈殿）',
        detect(mol) { return detectIodoform(mol); },
        apply(game, site) {
            const [mId, kId] = site;
            const mol = game.userMolecule;
            // 種別は書き換える前に読む（=O を持っていればメチルケトン・アルデヒド側）
            const wasCarbonyl = mol.getNeighbors(kId).some(n => n.type === 2 && n.atom.element === 'O');
            mol.removeBond(mId, kId);
            // ① メチル基だった炭素を引き離して CHI₃ にする
            const spots = freeSpotsForIodoform(mol, mId);
            if (!spots) throw new Error('ヨードホルムを置く空間がありません。分子を離してから実行してください');
            const added = spots.map(p => {
                const i = mol.addAtom('I', p.x, p.y);
                mol.addBond(mId, i.id, 1);
                return i.id;
            });
            // ② 残った側は炭素が1つ減った**カルボン酸のナトリウム塩**。
            //    CH₃CH(OH)- のときは、-OH がまず酸化されて C=O になってから切れる
            if (!wasCarbonyl) {
                const oh = mol.getNeighbors(kId).find(n =>
                    n.type === 1 && n.atom.element === 'O' &&
                    mol.getNeighbors(n.atom.id).filter(x => x.atom.element !== 'H').length === 1);
                if (!oh) throw new Error('酸化する -OH が見つかりません');
                mol.getBond(kId, oh.atom.id).type = 2;
                bendCarbonyl(mol, kId, oh.atom.id); // 鎖と一直線なら折る（C-7）
            }
            const oSpot = freeSpotAround(mol, kId);
            if (!oSpot) throw new Error('-COONa を置く空間がありません。まわりを空けてから実行してください');
            const o = mol.addAtom('O', oSpot.x, oSpot.y);
            mol.addBond(kId, o.id, 1);
            const naSpot = freeSpotAround(mol, o.id, [oSpot]);
            if (!naSpot) throw new Error('ナトリウムを置く空間がありません。分子を離してから実行してください');
            const na = mol.addAtom('Na', naSpot.x, naSpot.y);
            mol.addBond(o.id, na.id, 1);
            return {
                caption: 'ヨードホルム反応が起こりました。ヨウ素 I₂ と水酸化ナトリウム水溶液を加えると、' +
                    '**黄色の沈殿 CHI₃（ヨードホルム）** ができます。特有のにおいがあり、目で見て分かるので物質の識別に使います。' +
                    (wasCarbonyl
                        ? 'この分子は CH₃-CO- を持っています。'
                        : 'この分子は CH₃-CH(OH)- を持っています。-OH のついた炭素がまず酸化されて CH₃-CO- になり、そこから反応が進みます。') +
                    'CH₃ が付いていた側は炭素が1つ減り、カルボン酸のナトリウム塩として残ります（NaOH を使うので酸ではなく塩で出ます）。' +
                    '陽性なのは CH₃-CO- か CH₃-CH(OH)- を持つものだけです: ' +
                    'エタノール・2-プロパノール・アセトアルデヒド・アセトン・乳酸は陽性、' +
                    '**1-プロパノールとメタノールは陰性**（CH₃-CH(OH)- の形になっていない）。',
                changed: [mId, kId, ...added, o.id, na.id]
            };
        }
    },
    {
        id: 'dehydration_intra',
        mechanismId: 'ethanol_e1',
        label: '分子内脱水（-H₂O） → アルケン',
        reagentId: 'h2so4_conc',
        // **同じ瓶で行き先が温度でしか割れない唯一の組み合わせ**（同書 §2.4）。
        // 分岐の実体は「別ルールとして書いてある」ことがすでに担っているので、
        // ここに足すのは**選ばせる画面に出す1行の見出し**だけ。温度という概念はコードに入れない
        //
        // `needs` は**この条件を選んだのに材料が足りなかったとき**に返す1行（同書 §11）。
        // 条件は「結果に書くもの」ではなく「選ぶもの」なので、通っていない条件も選択肢に出る
        // ＝ 選ばれた以上「何が足りないか」を必ず言う（押せるのに何も起きない、をなくす）
        condition: {
            key: 'hot', label: '約160〜170℃（高温）',
            needs: '-OH を1つだけ持つアルコールが1分子要ります' +
                '（多価アルコールや、他の官能基をあわせ持つ分子は高校では扱いません）'
        },
        detect(mol) {
            const sites = [];
            // 適用条件（P12-8 反応判定の精査）: 高校で扱う分子内脱水は
            // 「アルコール（-OH がひとつだけ）」に限られる。糖・多価アルコール・
            // α-ヒドロキシ酸などに適用すると、教科書では扱わない生成物を提示してしまうため、
            // **他の官能基を持つ分子や -OH が複数ある分子では候補に出さない**（＝判断できないものは出さない）
            //
            // ⚠ この2つの条件は**その分子の中だけ**を数える（v702 で修正）。
            // `mol` はキャンバス全体（分子が何個あっても1つの Molecule）なので、
            // 全体で数えると**隣に置いただけの無関係な分子が判定を殺す**:
            //   - エタノールを2つ並べると「-OH が2つある」ことになって分子内脱水が消える
            //   - エタノール＋アセトンでも「カルボニルがある」ことになって消える
            // どちらも、それぞれのエタノールは 160〜170℃ でふつうに脱水する。
            // 「-OH がひとつだけ」は**多価アルコール・糖を外す**ための条件であって、
            // 隣に何が置いてあるかの話ではない。dehydration_inter が `componentOf` で
            // 「別分子どうしのみ」を見ているのと同じ粒度に揃える。
            // これを直すまで**濃硫酸の2択（分子内／分子間）が原理的に出せなかった**
            // （intra は「-OH が1つ」・inter は「別分子に2つ」を要求するので排他だった）
            const groups = findFunctionalGroups(mol);
            const alcohols = groups.filter(g => ['alcohol1', 'alcohol2', 'alcohol3'].includes(g.type));
            const others = groups.filter(g =>
                !['alcohol1', 'alcohol2', 'alcohol3'].includes(g.type) && g.type !== 'aromatic');
            const inComp = (comp, g) => g.atomIds.some(id => comp.has(id));
            alcohols
                .forEach(g => {
                    const [oId, aId] = g.atomIds;
                    const comp = componentOf(mol, oId);
                    // 多価アルコール・糖は対象外（**この分子の中の** -OH の数で判断する）
                    if (alcohols.filter(h => inComp(comp, h)).length !== 1) return;
                    // カルボニル・カルボキシ・エステル・エーテル等が**この分子にある**なら対象外
                    if (others.some(h => inComp(comp, h))) return;
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
        reagentId: 'h2so4_conc', // 濃硫酸は触媒。行き先は detect（相手にカルボン酸が要る）が割る

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
        reagentId: 'h2so4_conc',
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
        reagentId: 'acetic_anhydride',
        label: 'アセチル化（無水酢酸 (CH₃CO)₂O）',
        detect(mol) {
            // 対象はフェノールの-OHとアミンの-NH₂（教科書の定番: フェノール→酢酸フェニル、
            // アニリン→アセトアニリド、サリチル酸→アセチルサリチル酸）。
            // **アミドの N は除く**（P12-8 反応判定の精査）: 以前は findFunctionalGroups が
            // 「単結合だけで水素が残る N」を一律に amino としていたため、アミドの N も
            // 拾ってしまい、アセトアニリド（アニリンをアセチル化した生成物）を
            // さらにアセチル化できてしまっていた。**§9.6-7 の直しで chemistry.js 側が
            // アミドの N をアミンから外した**ので isAmideNitrogen は二重の防波堤だが、
            // 反応の側でも条件を読めるようにここに残す。
            // 3級アミン（amine3）は N に水素が無いのでそもそもアセチル化できない
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'phenol' ||
                    (AMINE_NH_TYPES.includes(g.type) && !isAmideNitrogen(mol, g.atomIds[0])))
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
        reagentId: 'h2so4_conc',
        condition: {
            key: 'warm', label: '約130〜140℃（低温）',
            needs: 'アルコールが2分子要ります（同じ分子の中の -OH どうしでは起こりません）'
        },
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
        /* アセチレンの付加重合（P12-8 の穴埋め・2026-08-07）。
         * ポリアセチレンの図は登録済み（compounds.json `polyacetylene`）なのに、
         * 反応実行モードからそこへ到達する手段が無かった。
         * `addition_polymerization` は `vinylBonds`（type===2）しか見ないので三重結合は素通りする。
         * ビニル系に三重結合を混ぜると `conjugatedDienes` と `vulcanizablePairs` まで
         * 巻き添えになるので、**別のルールとして立てる**。 */
        id: 'alkyne_polymerization',
        label: '付加重合（アセチレンを並べて）→ ポリアセチレン',
        detect(mol) {
            const units = acetyleneUnits(mol);
            if (units.length < 2) return [];
            units.sort((p, q) => p.x - q.x); // 左から右へ並べた順に繋ぐ（画面の並びと一致させる）
            return [units.flatMap(u => [u.left, u.right])];
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const units = [];
            for (let i = 0; i < site.length; i += 2) units.push({ left: site[i], right: site[i + 1] });
            if (units.length < 2) throw new Error('アセチレンが2分子以上必要です');
            // 三重結合を二重結合に開く（開いた1本ぶんが隣の単位との結合になる）。
            // 付加重合なので原子は1つも出入りしない ＝ 生成物は (CH=CH)ₙ
            units.forEach(u => {
                const b = mol.getBond(u.left, u.right);
                if (!b || b.type !== 3) throw new Error('三重結合が見つかりません');
                b.type = 2;
            });
            const changed = [];
            let linkFrom = units[0].right;
            for (let i = 1; i < units.length; i++) {
                const u = units[i];
                const movingIds = [...componentOf(mol, u.left)];
                const plan = planAttachment(mol, linkFrom, u.left, movingIds, []);
                if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
                applyAttachment(mol, movingIds, plan);
                mol.addBond(linkFrom, u.left, 1);
                changed.push(linkFrom, u.left);
                linkFrom = u.right;
            }
            const rIds = [attachR(mol, units[0].left), attachR(mol, linkFrom)].filter(Boolean);
            const n = units.length;
            return {
                caption: `アセチレン ${n} 個が付加重合してポリアセチレンになりました。` +
                    '三重結合が1本ぶん開いて隣の分子とつながるので、**鎖には二重結合が残ります**' +
                    '（エチレンの付加重合ではすべて単結合になるのと対照的です）。' +
                    '単結合と二重結合が交互に並ぶこの形を共役といい、電子が鎖に沿って動けるため、' +
                    'ヨウ素などを加えると金属に近い電気伝導性を示します（導電性高分子）。' +
                    '両端の R は「この先も同じ単位が続く」という印です。',
                changed: [...new Set([...changed, ...rIds])],
                refit: true
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
        reagentId: 'sulfur',
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
        /* 縮合重合（P12-8 の穴埋め・2026-08-07）。ナイロン66 の図は登録済みなのに、
         * 反応実行モードからそこへ至る手段が無かった（下の `condensation_polymer_info` は
         * 説明を返すだけで、実際の連結は「エステル化を1段ずつ」に任せていた）。
         * 単量体を 2組（4分子）以上並べたときだけ出る ＝ 1対1 のときは従来どおり説明だけ。 */
        id: 'condensation_polymerization',
        label: '縮合重合（2価の単量体を並べて）→ ポリエステル／ポリアミド',
        detect(mol) {
            const u = condensationPolymerUnits(mol);
            if (!u) return [];
            // 鎖の並びは 酸 → 相手 → 酸 → 相手 …（交互）。i 番目と i+1 番目を
            // 「右の基」と「左の基」で繋ぐと、画面の並びのまま鎖になる
            const chain = [];
            for (let i = 0; i < u.acids.length; i++) { chain.push(u.acids[i]); chain.push(u.partners[i]); }
            const site = [];
            for (let i = 0; i + 1 < chain.length; i++) {
                const a = chain[i].links[1], b = chain[i + 1].links[0];
                const acid = a.c !== undefined ? a : b;     // 酸側は {c, oh}、相手側は {x}
                const other = acid === a ? b : a;
                site.push(acid.c, acid.oh, other.x);        // 3つ組で1本の結合を表す
            }
            return [site];
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const links = [];
            for (let i = 0; i < site.length; i += 3) {
                links.push({ c: site[i], oh: site[i + 1], x: site[i + 2] });
            }
            if (links.length < 3) throw new Error('単量体が2組（4分子）以上必要です');
            const changed = [];
            let chainIds = componentOf(mol, links[0].c);
            links.forEach(({ c, oh, x }) => {
                // すでに鎖になっている側を動かさず、新しい単量体の方を寄せる
                const anchorIsAcid = chainIds.has(c);
                const anchor = anchorIsAcid ? c : x;
                const attach = anchorIsAcid ? x : c;
                const movingIds = [...componentOf(mol, attach)];
                const plan = planAttachment(mol, anchor, attach, movingIds, [oh]);
                if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
                mol.removeBond(c, oh);
                applyAttachment(mol, movingIds, plan);
                mol.addBond(c, x, 1);
                parkAsWater(mol, oh); // つなぐたびに水が1分子とれる ＝ これが「縮合」
                changed.push(c, x);
                chainIds = componentOf(mol, c);
            });
            // 鎖の両端に R（この先も同じ単位が続く印）。残っている -COOH は -OH を落として
            // -CO-R にする ＝ 次に来るのはアミン／アルコールなので、そこでも水がとれる
            const chain = componentOf(mol, links[0].c);
            const ends = findFunctionalGroups(mol).filter(g => chain.has(g.atomIds[0]));
            const endAcid = ends.find(g => g.type === 'carboxyl');
            const endOther = ends.find(g => ALCOHOL_TYPES.includes(g.type) ||
                (AMINE_NH_TYPES.includes(g.type) && !isAmideNitrogen(mol, g.atomIds[0])));
            if (!endAcid || !endOther) throw new Error('鎖の端が見つかりません');
            mol.removeBond(endAcid.atomIds[0], endAcid.atomIds[2]);
            parkAsWater(mol, endAcid.atomIds[2]);
            const rIds = [attachR(mol, endAcid.atomIds[0]), attachR(mol, endOther.atomIds[0])]
                .filter(Boolean);
            const amide = AMINE_NH_TYPES.includes(endOther.type);
            const n = (links.length + 1) / 2;
            return {
                caption: `2価カルボン酸 ${n} 個と2価${amide ? 'アミン' : 'アルコール'} ${n} 個が縮合重合して、` +
                    `${amide ? 'アミド' : 'エステル'}結合が ${links.length} か所できました。` +
                    `つなぐたびに水が1分子とれるのが「縮合」で、原子が1つも出入りしない付加重合との違いです` +
                    `（画面に出ている水 ${links.length + 1} 分子がその証拠です）。` +
                    (amide
                        ? 'アジピン酸とヘキサメチレンジアミンからできるのがナイロン66（ポリアミド）で、'
                          + 'アミド結合 -CO-NH- はタンパク質のペプチド結合と同じつながり方です。'
                        : 'テレフタル酸とエチレングリコールからできるのがポリエチレンテレフタラート'
                          + '（PET・ポリエステル）で、エステル結合 -CO-O- でつながっています。') +
                    '両端の R は「この先も同じ単位が続く」という印です' +
                    '（教科書では −[ ]ₙ− の角括弧で書きます）。',
                changed: [...new Set([...changed, ...rIds])],
                refit: true
            };
        }
    },
    {
        id: 'condensation_polymer_info',
        label: '⚠ 縮合重合になる組み合わせ',
        info: true,
        // 2価カルボン酸と2価アルコール／2価アミンが**1つずつ**のとき。実際の連結は
        // 既存の「エステル化」「アセチル化」で1段ずつ進められるので、ここでは説明だけ出す。
        // ⚠ 単量体が2組そろっていれば上の `condensation_polymerization` が実行できるので、
        //    そのときは説明を出さない（同じことを2つのボタンで言わない）
        detect(mol) {
            if (condensationPolymerUnits(mol)) return [];
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
                    `両端にまだ反応できる基が残るので、そこにさらに単量体をつなぐと鎖が伸びていきます。` +
                    `**同じ組み合わせをもう1組ずつ（合計4分子）並べると「縮合重合」が選べる**ようになり、鎖をまとめて作れます。`,
                changed: []
            };
        }
    },
    {
        id: 'add_br2',
        mechanismId: 'ethene_br2',
        label: '付加: Br₂（臭素水の脱色）',
        reagentId: 'br2_water', // 行き先が1つ・条件なし ＝ 瓶から `narrow()` へ最短で合流する

        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, 'Br', 'Br',
                '臭素 Br₂ が付加しました。赤褐色の臭素水が脱色されるこの反応は、C=C や C≡C（不飽和結合）の検出に使われます。');
        }
    },
    {
        /* ⚠ **教材として逆を教えていた穴の埋め合わせ**（2026-08-06・qa の283項目棚卸し）。
         * 「臭素水 ＝ 不飽和結合の検出」で止めると、フェノール・アニリンの白色沈殿という
         * 高校の必修事項がアプリのどこからも出せない。付加（`add_br2`）と同じ瓶に置換を並べ、
         * **同じ試薬でも相手によって付加と置換に分かれる**ことをその場で見せる。
         *
         * 一気に3置換するのは省略ではなく**教科書どおり**。一置換体・二置換体は取り出せず、
         * 2,4,6-トリブロモ体まで進んで水に溶けにくい白色沈殿として落ちる。
         * したがって「1箇所ずつ3回押す」形にはしない（途中の図は実在しない中間体になる）。 */
        id: 'bromination_activated_ring',
        reagentId: 'br2_water',
        label: '芳香族置換: 臭素水（触媒なし）→ 2,4,6-トリブロモ体（白色沈殿）',
        detect: activatedRingBrominationSites,
        apply(game, site) {
            const mol = game.userMolecule;
            const [anchor, ...targets] = site;
            const kind = activatingSubstituent(mol, anchor);
            const added = [];
            targets.forEach(t => { added.push(...attachGroup(mol, t, 'Br')); });
            const what = kind
                ? `${kind.name}は${kind.group}が環に電子を押し込むので、`
                : 'この環は電子を押し込む基がついていて活性化されているので、';
            return {
                caption: '臭素水を加えただけで置換が進み、オルト位2つとパラ位に臭素が入りました（2,4,6-トリブロモ体）。' +
                    'ベンゼンを臭素化するには鉄（塩化鉄(III)）の触媒が要りますが、' + what +
                    '触媒なし・常温でここまで一気に進みます。' +
                    '生成物は水に溶けにくく、**白色の沈殿**として出るので目で見て分かります（フェノール・アニリンの検出）。' +
                    '「臭素水の脱色 ＝ 不飽和結合」という覚え方はふつうのベンゼン環には当てはまりますが、この2つは例外です。' +
                    'なお -OH や -NH₂ は o,p-配向性の基なので、入るのはオルト位2つとパラ位の合計3箇所になります。',
                changed: [anchor, ...targets, ...added]
            };
        }
    },
    {
        id: 'add_h2',
        reagentId: 'h2_ni',
        label: '付加: H₂（水素化・Ni触媒）',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, null, null,
                '水素 H₂ が付加しました（ニッケルや白金を触媒に加熱）。不飽和結合が減って飽和に近づきます。植物油に水素を付加して固める硬化油（マーガリンの原料）はこの反応の応用です。');
        }
    },
    // H–X 付加は HBr・HCl・HI の3本。**`HYDROGEN_HALIDES` の表から生成する**ので、
    // 規則（マルコフニコフ則）も適用箇所も1か所にしかない（§10.5）
    ...HYDROGEN_HALIDE_RULES,
    {
        id: 'add_water',
        reagentId: 'h2o_acid',
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
        reagentId: 'mixed_acid',
        label: '⚠ 置換が起こりにくい環',
        info: true,
        // ⚠ **電子を引く基は「その環」で数える**（試薬パレット第2段の detect 監査・§7.7）。
        // v779 まではキャンバス全体の芳香族原子を1つの集合にまとめて数えていたため、
        // **1個ずつしか持たない分子を2つ並べただけで警告が出た**（実測）:
        //   ニトロベンゼン2個 → 1件／ニトロベンゼン＋ベンゼンスルホン酸 → 1件
        //   （どちらの環も -NO₂ / -SO₃H は1つなので、本来は0件）
        // 単独のニトロベンゼンでは 0 件で正しかったので、**並べたときだけ**静かに嘘をついていた。
        detect(mol) {
            const keys = findAromaticBondKeys(mol);
            const aromatic = new Set();
            mol.bonds.forEach(b => {
                const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
                if (keys.has(k)) { aromatic.add(b.atomId1); aromatic.add(b.atomId2); }
            });
            if (aromatic.size === 0) return [];
            const nitroSites = aromaticSites(mol, 'nitro');
            const sites = [];
            const seen = new Set();
            [...aromatic].forEach(id => {
                if (seen.has(id)) return;
                const comp = componentOf(mol, id);
                comp.forEach(x => seen.add(x));
                const ringSet = new Set([...aromatic].filter(a => comp.has(a)));
                const pulling = [...ringSet]
                    .map(a => ringDirector(mol, a, ringSet))
                    .filter(d => d && d.kind === 'm');
                if (pulling.length < 2) return;
                // 置換できる場所が**その分子に**残っているときだけ注意する意味がある
                if (!nitroSites.some(s => comp.has(s[0]))) return;
                // 候補の代表は座標で決める（原子IDは乱数なので走査順に頼らない）
                const rep = [...ringSet]
                    .map(a => mol.atoms.find(x => x.id === a))
                    .filter(Boolean)
                    .sort((p, q) => (q.x - p.x) || (p.y - q.y))[0];
                if (rep) sites.push([rep.id]);
            });
            return sites;
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
        reagentId: 'mixed_acid',
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
        reagentId: 'h2so4_conc', // 基質が芳香環かどうかは detect が割る（条件は要らない）

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
        reagentId: 'cl2_fe',
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
        reagentId: 'h2so4_dil',
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
        reagentId: 'h2so4_dil',
        label: '加水分解（エステル + H₂O, 酸を触媒に加熱）',
        detect(mol) { return detectEsterLinkages(mol); },
        apply(game, site) { return cleaveEster(game, site, false); }
    },
    {
        /* グリコシド結合の加水分解（P12-8 の穴埋め・2026-08-07。qa の棚卸しで2件）。
         * 二糖（マルトース・スクロース・ラクトース・セロビオース）の図は登録済みなのに、
         * そこから単糖へ戻す手段が無かった。切るのは「アノマー炭素と架橋酸素」の間で、
         * 酸素は相手側に残って -OH になる（＝ 縮合してできた -O- を水で開く逆向き）。 */
        id: 'hydrolysis_glycoside',
        reagentId: 'h2so4_dil',
        label: '加水分解（二糖 + H₂O, 酸を触媒に加熱）→ 単糖2つ',
        detect(mol) { return glycosidicLinkages(mol); },
        apply(game, site) {
            const [cId, oId] = site;
            const mol = game.userMolecule;
            mol.removeBond(cId, oId);
            // 相手の単糖を引き離す（架橋酸素はそちらに残る ＝ そのまま -OH になる）
            const rest = [...componentOf(mol, oId)];
            if (!rest.includes(cId)) {
                const sep = separateComponent(mol, rest);
                if (sep) translateAtoms(mol, rest, sep.dx, sep.dy);
            }
            // 切った側には水から -OH が入る（自動水素が H を描く）
            const spot = freeSpotAround(mol, cId);
            if (!spot) throw new Error('生成物を配置する空間がありません。結合を伸ばして空間を作ってから実行してください');
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(cId, o.id, 1);
            return {
                caption: 'グリコシド結合が加水分解されて、二糖が単糖2分子に分かれました。' +
                    '単糖どうしが縮合して -O- でつながったのが二糖なので、これはちょうどその逆向きです' +
                    '（C₁₂H₂₂O₁₁ ＋ H₂O → C₆H₁₂O₆ ×2）。' +
                    'マルトースはグルコース2分子に、ラクトースはグルコースとガラクトースに、' +
                    'スクロースはグルコースとフルクトースに分かれます。' +
                    'スクロースの加水分解でできる等量の混合物はとくに転化糖と呼ばれ、' +
                    'スクロース自身は還元性を示さないのに、加水分解すると還元性が現れます' +
                    '（両方のアノマー炭素がグリコシド結合に使われていたのが、切れて開環できるようになるため）。' +
                    '希硫酸のかわりに酵素（マルターゼ・ラクターゼ・インベルターゼ）でも同じ反応が進みます。',
                changed: [cId, o.id, oId],
                refit: true
            };
        }
    },

    {
        /* 中和（酸 ＋ NaOH → 塩）。qa の棚卸しで**いちばん大きかった穴（7項目）**の入口。
         * カルボン酸・フェノール・スルホン酸は「酸性の -OH」を持つ点で同じなので、
         * 3つの入口を1つのルールにまとめる（§10.6）。生成物は登録済みの塩と一致する。 */
        id: 'neutralize_naoh',
        reagentId: 'naoh_aq',
        label: '中和（酸 + NaOH）→ ナトリウム塩',
        detect(mol) { return neutralizableAcidSites(mol); },
        apply(game, site) {
            const [oId, anchorId] = site;
            const mol = game.userMolecule;
            const kind = acidKindOf(mol, oId, anchorId);
            const spot = freeSpotAround(mol, oId);
            if (!spot) throw new Error('ナトリウムを置く空間がありません。まわりを空けてから実行してください');
            const na = mol.addAtom('Na', spot.x, spot.y);
            mol.addBond(oId, na.id, 1);
            return {
                caption: `${kind.name}が水酸化ナトリウムと中和して、ナトリウム塩になりました。` +
                    '酸性の -OH の水素が Na に置き換わった形です。' +
                    '（このアプリは電荷を持たないので、塩は線1本の共有結合として書いています。' +
                    '実際は -O⁻ と Na⁺ のイオン結合です。）' +
                    '塩になると水に溶けやすくなります。' + kind.rank +
                    'できた塩に強い酸（希硫酸・塩酸）を加えると、もとの酸が遊離して戻ってきます。',
                changed: [oId, na.id]
            };
        }
    },
    {
        /* 金属ナトリウムとの反応（P12-8 の穴埋め・2026-08-07。qa の棚卸しで2件）。
         *
         * **発生する H₂ は描かない。** とれる水素はもともと自動水素（明示原子ではない）なので、
         * Na が付いた時点で自動的に消える —— 上の `neutralize_naoh` が水を描かないのと同じ流儀で、
         * 「画面の分子に無い分子は描かない」を守っている（文面で H₂ の発生を言う）。
         *
         * 塩・アルコキシドは線1本の共有結合として書く（v353・DESIGN_compound_coverage.md §6-2）。
         * したがって**電荷モデルは要らない** —— 中和と同じ形なので新しい概念を持ち込まない。 */
        id: 'react_sodium',
        reagentId: 'sodium_metal',
        label: 'ナトリウムとの反応（-OH + Na, H₂ 発生）',
        detect(mol) { return sodiumReactiveSites(mol); },
        apply(game, site) {
            const [oId, anchorId] = site;
            const mol = game.userMolecule;
            // アルコールか酸性の -OH かは**その酸素1つを見て**決める（全体を数えない）
            const isAlcohol = findFunctionalGroups(mol)
                .some(g => ALCOHOL_TYPES.includes(g.type) && g.atomIds[0] === oId);
            const spot = freeSpotAround(mol, oId);
            if (!spot) throw new Error('ナトリウムを置く空間がありません。まわりを空けてから実行してください');
            const na = mol.addAtom('Na', spot.x, spot.y);
            mol.addBond(oId, na.id, 1);
            const kind = isAlcohol ? null : acidKindOf(mol, oId, anchorId);
            const salt = '（このアプリは電荷を持たないので、線1本の共有結合として書いています。' +
                '実際は -O⁻ と Na⁺ のイオン結合です。）';
            return {
                caption: (isAlcohol
                    ? 'アルコールの -OH の水素がナトリウムに置き換わり、水素が発生しました' +
                      '（2R-OH ＋ 2Na → 2R-ONa ＋ H₂）。できたのはナトリウムアルコキシドです' +
                      '（エタノールからならナトリウムエトキシド）。' + salt +
                      '**エーテルは -OH を持たないので反応しません。** 同じ分子式 C₂H₆O でも、' +
                      'エタノールは水素を出しジメチルエーテルは出さない —— これがアルコールとエーテルの見分け方です。' +
                      'なお、アルコールは中性なので**水酸化ナトリウム水溶液とは中和しません**。' +
                      '同じ -OH でも、酸性なのはカルボン酸とフェノールだけです。'
                    : `${kind.name}の -OH の水素がナトリウムに置き換わり、水素が発生しました` +
                      `（2R-OH ＋ 2Na → 2R-ONa ＋ H₂）。できたのは${kind.name}のナトリウム塩で、` +
                      '水酸化ナトリウムで中和したときと同じものです。' + salt +
                      '金属ナトリウムは酸性の -OH でも中性のアルコールの -OH でも水素を出すので、' +
                      'これだけでは酸の強さは分かりません。' + kind.rank) +
                    'できた塩・アルコキシドに強い酸（希硫酸）を加えると、もとの形に戻せます（弱酸の遊離）。',
                changed: [oId, na.id]
            };
        }
    },
    {
        /* 弱酸の遊離（塩 ＋ 強酸 → もとの酸）。上の中和のちょうど逆向きで、
         * **けん化やヨードホルム反応の生成物（-COONa）からも引ける**。 */
        id: 'liberate_weak_acid',
        reagentId: 'h2so4_dil',
        label: '弱酸の遊離（塩 + 強酸）→ もとの酸',
        detect(mol) { return liberatableSaltSites(mol); },
        apply(game, site) {
            const [metalId, oId] = site;
            const mol = game.userMolecule;
            const metal = mol.atoms.find(a => a.id === metalId);
            const anchor = mol.getNeighbors(oId)
                .find(n => n.atom.element !== 'H' && n.atom.id !== metalId);
            const kind = anchor ? acidKindOf(mol, oId, anchor.atom.id) : { name: '酸', rank: '' };
            const symbol = metal ? metal.element : 'Na';
            mol.removeAtom(metalId); // 金属が外れると酸素に結合手が1つ空き、自動水素が -OH を描く
            return {
                caption: `より強い酸を加えたので、弱いほうの酸（${kind.name}）が遊離してもとの形に戻りました` +
                    `（-O${symbol} → -OH）。` +
                    '「強い酸は弱い酸をその塩から追い出す」という弱酸の遊離です。' +
                    '希硫酸や塩酸は硫酸イオン・塩化物イオンとして塩の側に残ります。' + kind.rank +
                    'けん化でできたカルボン酸の塩（セッケンを含む）も、この操作で酸に戻せます。',
                changed: [oId]
            };
        }
    },
    // けん化は加水分解と**生成物が違う**。NaOH を使うので、できるのは
    // カルボン酸ではなく**カルボン酸のナトリウム塩**（油脂なら脂肪酸ナトリウム＝石けんそのもの）。
    // 塩になると逆のエステル化が起こらないので反応は完全に進む。
    // 2026-08-01 の検品レビュー A-1。それまでは1つのルールが「けん化・加水分解」を名乗りながら
    // 酸のままのカルボン酸を出しており、V19 のナレーションと食い違っていた
    {
        id: 'saponification',
        reagentId: 'naoh_aq',
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

// 畳んだ見出しの札と id（v1420）。**文言と id は1か所**——テストと実装が同じものを見る
const PARTNER_HINTS_ID = 'partner-hints';
const PARTNER_HINTS_SUMMARY = 'もう1つ分子が要る反応';

/**
 * 反応の一覧を割る2つの節の見出し（v1423・DESIGN_reaction_execution.md §12）。
 *
 * 軸は「**1つ前の物質を変化させたという文脈の続きかどうか**」（ユーザーの言葉・2026-08-20）。
 * ⚠ 「分子を変えるか変えないか」で割ってはいけない —— それだと
 *   「↩ 反応前に戻す」（分子を変える）だけが振り返りの側から出ていってしまう。
 *
 * 文言は**1か所**（テストと実装が同じものを見る。PARTNER_HINTS_SUMMARY と同じ約束）。
 */
const RX_SECTION_NEXT = 'この分子にできること';
const RX_SECTION_LAST = 'いま起きた反応';
const RX_UNDO_POINTER = '↩ 反応前に戻す は画面下の帯にあります（この画面を閉じても押せます）。';

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

/**
 * 「この相手を呼び出すとこの反応ができる」の一覧を返す（1つの反応につき候補は1つまで）。
 *
 * `ruleIds` を渡すとその集合だけを見る（省略時は従来どおり全ルール）。
 * 試薬パレットの空振り（同書 §4.1）が使う ——「濃硫酸を掛けたが、エステル化の相手の
 * カルボン酸が無い」を**その瓶の話として**返すため。既存の呼び出し（自動案内）は引数なしのまま。
 */
function findPartnerHints(game, baseIds, ruleIds) {
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
            if (ruleIds && !ruleIds.includes(rule.id)) return;
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
            // ★ **箇所の数もここで数えて札に書く**（v1420）。押す前に
            //   「すぐ実行される」のか「箇所を選ぶことになる」のかが分かるようにするため。
            //   数えるのは**2分子にまたがる箇所だけ**＝ 呼び出した後に
            //   「両方を選ぶ」で絞り込んだときに残るものと同じ（`siteFilter()` の2分子条件）
            const crossCount = sites.filter(s => Array.isArray(s) &&
                s.some(id => mine.has(id)) && s.some(id => theirs.has(id))).length;
            hits.push({ name, label: rule.label, ruleId: rule.id, siteCount: crossCount });
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
        // いま押して進められる反応の数（⚠ の解説カード・相手の呼び出し案内は数えない）。
        // 右パネルに1つだけ残した「🔬 この分子を調べる（反応 N件）」がこれを読む
        // （DESIGN_molecule_modal.md §4-2。ボタン列がモーダルへ移っても「数が増えた」だけは見える）
        this.executableCount = 0;
        // 直近反応のスナップショット（前後比較・機構ジャンプ用。P12-5 第1弾）。
        // { ruleId, mechanismId, label, before, after }。before/after はキャンバス全体の
        // 独立コピー（原子ID付き）。直近1件のみ保持し、次の反応で上書き。
        // ⚠ 破棄するのは**文脈そのものが終わったとき**だけ（全消去・「↩ 反応前に戻す」）。
        //    **モード離脱では破棄しない**（v1423・§12。機構を見にいくのは文脈の続き）
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
        // 試薬パレット（DESIGN_reagent_palette.md 第1段）。瓶の札と、瓶を押した結果を返す欄。
        // 瓶は3本とも**いつでも押せる**ので、作図のたびに組み直す必要がない ＝ ここで一度だけ描く
        this.reagentsEl = document.getElementById('mm-reagents-grid');
        this.reagentNoteEl = document.getElementById('mm-reagent-note');
        this.renderReagents();
        // ↩ 反応前に戻す（v1409）。帯（#ws-free）の中に置いた1つだけの出口
        this.undoBtn = document.getElementById('btn-rx-undo');
        if (this.undoBtn) this.undoBtn.addEventListener('click', () => this.undoLastReaction());
        this.syncUndoButton();
    }

    /**
     * ↩ 反応前に戻す（v1409・ユーザー申し立て「反応させた場合、もとの分子に戻るにはどうする？」）。
     *
     * **症状**: 反応を実行すると分子モーダルは閉じ、画面に残るのは帯（`#ws-free`）と
     * 変わった分子だけ。戻る手段はリボンの汎用の「↩ 戻す」しかなく、
     * **いま起きた反応と結びついて見えない** ＝ 反応に入ると出られない一連の申し立ての1つ。
     *
     * 戻すのは `beforeState`（`serializeState()` の全部入り）で、前後比較用の
     * `before`（抜き書き）ではない —— あちらはロック・不斉マーク・ベンゼンの中心角を
     * 持たないので、描き戻すと**印だけ落ちた図**になる。
     *
     * ⚠ **戻す操作自体も履歴に積む**（`saveState()`）＝ 押し間違えた人が ↩ 戻す で
     *    反応後の図へ帰れる。取り消しの取り消しが効かない出口を作らない。
     * ⚠ **記録は捨てる**。キャンバスが反応前に戻った以上「直近の反応」はもう無い ＝
     *    前後比較・機構ジャンプも一緒に引っ込む（全消去と同じ `discardLastReaction()`）。
     */
    undoLastReaction() {
        const rx = this.lastReaction;
        if (!rx || !rx.beforeState) return false;
        const g = this.game;
        g.saveState();
        this.discardLastReaction(); // 記録を捨ててから戻す（restoreState → refresh が札を下ろす）
        this._morphGen++;   // 走行中のモーフィングを無効化（戻した図を上書きさせない）
        this._morphing = false;
        this._morphPause = null;
        g.restoreState(JSON.parse(rx.beforeState));
        g.showToast('反応の前に戻しました（この操作も ↩ 戻す で取り消せます）。', 4000, 'success');
        return true;
    }

    /**
     * 「↩ 反応前に戻す」を出すかどうか。**直近の反応の結果がいまキャンバスに載っているあいだだけ**出す。
     *
     * ⚠ 記録があるだけで出さない。反応のあとに描き足した人／リボンの ↩ 戻す で既に
     *   戻した人にまで出すと、押した瞬間に**その後の作図が黙って消える**（戻し先は
     *   反応前なので）。キャンバスが `after` と同じ形をしているかで決める
     *  （見るのはトポロジーだけ ＝ ドラッグで座標が動いただけでは引っ込めない）。
     */
    syncUndoButton() {
        if (!this.undoBtn) return false;
        const show = !!(this.lastReaction && this.lastReaction.beforeState &&
            this.topologyKey(this.snapshotMolecule(this.game.userMolecule)) ===
            this.topologyKey(this.lastReaction.after));
        this.undoBtn.classList.toggle('hidden', !show);
        return show;
    }

    // スナップショットのトポロジーだけを表す文字列（座標は見ない＝見た目専用の原則どおり）
    topologyKey(sn) {
        if (!sn) return '';
        return sn.atoms.map(a => a.id + ':' + a.element).sort().join(',') + '#' +
            sn.bonds.map(b => [b.atomId1, b.atomId2].sort().join('-') + ':' + b.type).sort().join(',');
    }

    /**
     * 分子を選んでいるときの「その分子が関わる反応」への絞り込み（C-1。2026-08-01 ユーザー要望）。
     * 判定は箇所（site）の原子がどの分子に属するかだけを見るので、ルールごとの知識が要らない。
     *
     *   0個 … 絞らない
     *   1個 … その分子の原子を含む箇所（相手はキャンバスの誰でもよい）
     *   2個以上 … 箇所が選択の中で完結し、かつ**2つ以上の選択分子に跨る**こと
     *
     * 「**すべての**選択分子に跨る」は2分子専用の条件で、3つ選んだ瞬間に
     * 2分子反応が全滅する（1回の反応が跨れるのは常に2分子だから）。
     * 油脂やジエステルは同じ反応を2〜3回繰り返して作るので、
     * 3分子以上を選んだままでも候補が出続けないと途中で手が止まる（レビュー項目15）。
     *
     * ⚠ **自動案内（`refresh()`）と試薬の瓶（`reagentHits()`）が同じこの関数を使う。**
     * 絞り込みを2か所に書くと、瓶からだけ出せる反応が生まれて
     * 「入口が2つでも中身は1つ」（DESIGN_reagent_palette.md RG4）が静かに破れる
     */
    siteFilter() {
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
        return { selSets, allSel, siteAllowed };
    }

    // 「⚗ この分子の反応」カードのボタン列を再構築する（updateDrawing のたびに呼ばれる）
    refresh() {
        // 途中で return する道が3本あるので、件数は**先に 0 へ落としてから**数え直す
        // （落とし忘れると「反応が消えたのに件数だけ残る」になる）
        this.executableCount = 0;
        // 分子が変わったら、前に瓶を押して出た答え（条件の選択肢・空振りの説明）は古い。
        // **早期 return より前**で消す ＝ 全消去した画面に前の分子の説明が残らない
        this.clearReagentNote();
        // 「↩ 反応前に戻す」の出し入れ（v1409）。**早期 return より前**に置く ——
        // 下の3本の return はどれも「反応の一覧は組まない」だけで、
        // 帯の札を出しっぱなしにしてよい理由にはならない（全消去した画面・機構ビューア中に残る）
        // 戻り値は「いま帯に札が出ているか」＝ 節②の案内が**実在する出口**を指しているかの根拠（v1423）
        const undoShown = this.syncUndoButton();
        if (!this.actionsEl) return;
        this.actionsEl.innerHTML = '';
        this.syncPicking();
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return;
        const mol = this.game.userMolecule;
        if (mol.atoms.filter(a => a.element !== 'H').length === 0) {
            // 全消去したら前後比較の記録・モーフィング再生は破棄する（設計 8.1）。
            // 呼び出し元 updateDrawing が空画面を描いた後なので、世代を進めて走行中ループを無効化する
            this._morphGen++;
            this._morphing = false;
            this._morphSkip = false;
            this.discardLastReaction();
            return;
        }

        const { selSets, allSel, siteAllowed } = this.siteFilter();
        this.renderSelectionNote(selSets);

        // 節①「この分子にできること」＝ **これから起こす反応**（反応カード・相手の呼び出しの案内）。
        // 中身が1つも無ければ見出しごと出さない（下の `children.length > 1` で判定）
        const nextSec = this.makeReactionSection(RX_SECTION_NEXT);

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
            // `?reagent=<ルールid>` から名指しできるようにする（瓶を持たないルールが5件ある）
            btn.dataset.rule = rule.id;
            btn.addEventListener('click', () => this.onRuleClick(rule, sites));
            nextSec.appendChild(btn);
        });

        this.executableCount = executable;
        // ⚠ 目印を付け直す前に**節を DOM へ挿す**。`markSelectedReagent()` は
        //   `#reaction-actions [data-rule]` を引くので、繋いでいない節の中の札は見えない
        this.actionsEl.appendChild(nextSec);
        // 描き直したら `?reagent=` の目印を付け直す（付けっぱなしにも消えっぱなしにもしない）
        if (this.selectedReagentId || this.selectedRuleId) this.markSelectedReagent();

        // 相手の分子が要る反応への道は**いつでも出す**（v1420・ユーザー申し立て
        // 「作成済みの分子しか選べない」）。押せる反応が0件のときしか出していなかったので、
        // エタノールのように単独で4件できる分子だと**エステル化へ進む道が一覧に生えなかった**。
        // ⚠ **上位N件で切らない**（切った分が黙って消える）。長さは「畳む」ことで抑える ——
        //   押せる反応があるときだけ畳んだ見出しの下に入れる（0件のときは開いて出す）
        //
        // ⚠ **見えているときだけ数える。** 案内の総当たり（候補5件 × 全ルールの detect）は
        //   実測で 20〜30ms かかり、`refresh()` は**作図のたび**に走る（ふだんの再描画は 6〜7ms）。
        //   「0件のときだけ」だった頃はめったに走らなかったが、常に出すようにした v1420 で
        //   **1原子置くたびに5倍**になった。この案内が出るのは分子モーダルの中だけなので、
        //   開いているときに限る（開いた瞬間にも `openMoleculeModal` が refresh を呼び直す）
        if (this.partnerHintsVisible()) {
            this.renderPartnerHints(allSel.size ? allSel : null, executable > 0, nextSec);
        }
        // 見出しだけになったら節ごと下ろす（空の見出しは「ここに何か出るはず」と読ませてしまう）
        if (nextSec.children.length <= 1) nextSec.remove();

        // 節②「いま起きた反応（〜）」＝ **直近の反応という1つの文脈**（v1423・§12）。
        // 反応カード（＝次の反応）とは別のまとまりなので、見出しで割ってから積む
        if (this.lastReaction) {
            const lastSec = this.makeReactionSection(
                `${RX_SECTION_LAST}（${this.lastReaction.label}）`);
            const cmp = document.createElement('button');
            cmp.className = 'view-btn';
            cmp.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
                'border-color:var(--neon-blue); color:var(--neon-blue);';
            cmp.textContent = `🔍 反応の前後を見る（${this.lastReaction.label}）`;
            cmp.addEventListener('click', () => this.openCompare());
            lastSec.appendChild(cmp);
            // 機構が登録されている反応なら、機構ビューアへジャンプするボタンも出す
            if (this.lastReaction.mechanismId) {
                lastSec.appendChild(this.makeMechanismButton());
            }
            // ⚠ 「↩ 反応前に戻す」は**帯（`#ws-free`）にある1つだけ**（v1409）。
            //    ここに2つめのボタンを置かない —— 同じ出口が2か所にあると、
            //    モーダルを閉じても押せるという v1409 の要点がぼやける。
            //    節の中からは**在り処を指すだけ**にし、しかも
            //    **実際に札が出ているときだけ**言う（無い出口を名指ししない・RX39 と同じ約束）
            if (undoShown) {
                const p = document.createElement('div');
                p.className = 'rx-undo-pointer';
                p.style.cssText = 'font-size:11px; line-height:1.5; color:var(--text-secondary);';
                p.textContent = RX_UNDO_POINTER;
                lastSec.appendChild(p);
            }
            this.actionsEl.appendChild(lastSec);
        }
    }

    /**
     * 反応の一覧を割る節の器（v1423・ユーザーの実機レビュー 2026-08-20）。
     *
     * ユーザーの言葉: 「試薬を作用させた後、**反応の前後を見る** / **この反応の機構を見る** が、
     * 生成物に対するボタンの下に区別なく並んでいるのがわかりづらい」。
     *
     * ⚠ 割る軸は「**分子を変えるか変えないか**」ではない（ユーザー本人の言い直し）——
     *   それだと「↩ 反応前に戻す」だけが反対側へ行ってしまう。軸は
     *   **1つ前の物質を変化させたという文脈の続きかどうか**。
     */
    makeReactionSection(title) {
        const sec = document.createElement('div');
        sec.className = 'rx-section';
        sec.style.cssText = 'display:flex; flex-direction:column; gap:5px;';
        const head = document.createElement('div');
        head.className = 'rx-section-head';
        head.style.cssText = 'font-size:11.5px; font-weight:600; color:var(--text-secondary); ' +
            'border-bottom:1px solid var(--border-color); padding-bottom:3px;';
        head.textContent = title;
        sec.appendChild(head);
        return sec;
    }

    /**
     * 案内の総当たり（候補5件 × 全ルールの detect）は分子が大きいと数十msかかる。
     * `refresh()` は作図のたびに走るので、**結合のつながりが変わったときだけ**計算し直す。
     * 座標だけが動く操作（ドラッグ・パン）ではキーが変わらないため、そのまま使い回せる
     * （ルールの detect はトポロジーだけを見ているので、座標で結果は変わらない）
     */
    cachedPartnerHints(baseIds, ruleIds) {
        const mol = this.game.userMolecule;
        // ⚠ ルールの絞り込み（＝どの瓶か）もキーに混ぜる。混ぜ忘れると
        // 「濃硫酸の空振り」で作った案内が、次に押した臭素水の答えとして返る
        const key = (baseIds ? [...baseIds].sort().join(',') : 'all') + '#' +
            (ruleIds ? [...ruleIds].sort().join('|') : 'all') + '#' +
            mol.atoms.map(a => `${a.id}:${a.element}`).sort().join(',') + '#' +
            mol.bonds.map(b => `${b.atomId1}-${b.atomId2}:${b.type}`).sort().join(',');
        if (this._hintCache && this._hintCache.key === key) return this._hintCache.hints;
        const hints = findPartnerHints(this.game, baseIds, ruleIds);
        this._hintCache = { key, hints };
        return hints;
    }

    /* ===== 試薬パレット 第1段（DESIGN_reagent_palette.md §5） =====
       「試薬を選んでから分子に掛ける」手動実験。自動案内（refresh）の**逆向き**の引き方で、
       新しい化学も新しい実行経路も1つも持たない。瓶 → detect → 0個/1個/2個以上 の
       振り分けだけを足し、`execute` から先は既存のまま（同書 §2.4）。 */

    /**
     * 瓶の札を組み立てる（起動時に一度だけ）。**どの瓶も常に押せる**ので作図では組み直さない。
     *
     * 区分の見出し（変えるもの／調べるもの）は**格子の中に全幅の1行として**入れる（同書 §3.2）。
     * 格子を2つに割らないのは、320px で列数が変わったときに区分ごとに折り返しがずれると
     * 「同じ大きさの札が並ぶ」という読み方が崩れるから。
     */
    renderReagents() {
        const el = this.reagentsEl;
        if (!el) return;
        el.innerHTML = '';
        let kind = null;
        REAGENTS.forEach(rg => {
            if (rg.kind !== kind) {
                kind = rg.kind;
                const h = document.createElement('div');
                h.className = 'rg-group';
                h.dataset.kind = kind;
                h.textContent = kind === 'detect'
                    ? '調べるもの（構造は変わりません）'
                    : '変えるもの';
                el.appendChild(h);
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'rg-bottle';
            b.dataset.reagent = rg.id;
            b.title = `${rg.name}（${rg.formula}）が効くのは、${rg.acts}`;
            const name = document.createElement('span');
            name.className = 'rg-name';
            name.textContent = rg.name;
            const formula = document.createElement('span');
            formula.className = 'rg-formula';
            formula.textContent = rg.formula;
            b.appendChild(name);
            b.appendChild(formula);
            b.addEventListener('click', () => this.onReagentClick(rg));
            el.appendChild(b);
        });
    }

    clearReagentNote() {
        if (this.reagentNoteEl) this.reagentNoteEl.innerHTML = '';
    }

    /**
     * URL の `?reagent=` から「試薬を選んだ状態」にする（DEVELOPMENT.md §7-1）
     *
     * ⚠ **id が2層ある。** 画面でユーザーが押すのは**瓶**（`br2_water`・`oxidant` …）だが、
     * 内部の実行単位は**反応ルール**（`add_br2`・`oxidize_primary`・`open_glucopyranose` …）で、
     * **瓶を持たないルールが5件ある**（環化3・重合2）。qa（一問一答）はまさにそこを指していて、
     * グルコースの還元性を見せる導線が「α形 ＋ `open_glucopyranose`」（環を開いてホルミル基を出す）。
     * 瓶の id だけにするとこの導線が張れず、ルールの id だけにすると
     * **画面で押すもの（瓶）と URL の語彙がずれる**。だから**両方受ける**。
     *
     * 解決の順序は「**瓶 → ルール**」＝ 画面に見えるものを優先する。
     * 2つの id 空間が衝突していないことは RG-ID1 が数で固定している。
     * 知らない id は**黙って無視**する（前方互換。エラーで止めない）。
     */
    selectReagent(key) {
        const q = String(key == null ? '' : key).trim();
        if (!q) return null;
        let bottle = REAGENTS.find(r => r.id === q) || null;
        let ruleId = null;
        if (bottle) {
            ruleId = null;
        } else {
            const rule = REACTION_RULES.find(r => r.id === q);
            if (!rule) return null;                    // 知らない id ＝ 何もしない
            ruleId = rule.id;
            if (rule.reagentId) bottle = REAGENTS.find(r => r.id === rule.reagentId) || null;
        }
        this.selectedReagentId = bottle ? bottle.id : null;
        this.selectedRuleId = ruleId;
        // 瓶と自動案内はどちらも分子モーダルの中にある。開かないと「選ばれた」が見えない
        this.game.openMoleculeModal();
        this.markSelectedReagent();
        return { reagentId: this.selectedReagentId, ruleId: this.selectedRuleId };
    }

    /**
     * 選ばれた瓶・ルールに目印を付ける。**style.css には触らない**（別レーンの持ち物になりうる）ので
     * 枠線だけをその場で当てる。`refresh()` で描き直されたら付け直す
     */
    markSelectedReagent() {
        const mark = (el, on) => {
            if (!el) return;
            el.classList.toggle('rx-picked', on);
            el.style.outline = on ? '2px solid var(--neon-orange, #ffa502)' : '';
            el.style.outlineOffset = on ? '1px' : '';
        };
        document.querySelectorAll('.rg-bottle').forEach(b =>
            mark(b, !!this.selectedReagentId && b.dataset.reagent === this.selectedReagentId));
        document.querySelectorAll('[data-rule]').forEach(b =>
            mark(b, !!this.selectedRuleId && b.dataset.rule === this.selectedRuleId));
        const picked = this.selectedRuleId
            ? document.querySelector(`[data-rule="${this.selectedRuleId}"]`)
            : (this.selectedReagentId
                ? document.querySelector(`.rg-bottle[data-reagent="${this.selectedReagentId}"]`)
                : null);
        if (picked && picked.scrollIntoView) picked.scrollIntoView({ block: 'nearest' });
    }

    /**
     * この瓶で「いま起こせること」を集める。
     * **`detect` を実際に回す**ので、どの官能基に効くかという判定を試薬側に1つも書き写さない
     * （同書 §1.1。反応を1つ足せば自動案内にも瓶にも同時に出る）。
     * 絞り込みは `siteFilter()` を自動案内と共有する ＝ 瓶が独自の反応を持てない構造にする。
     */
    reagentHits(reagent) {
        const mol = this.game.userMolecule;
        const { selSets, siteAllowed } = this.siteFilter();
        const hits = [];
        REACTION_RULES.forEach(rule => {
            if (rule.reagentId !== reagent.id) return;
            let sites = [];
            try {
                sites = rule.detect(mol);
            } catch (e) {
                console.error('反応ルール検出エラー:', rule.id, e);
                return;
            }
            if (selSets.length && !rule.info) sites = sites.filter(siteAllowed);
            if (sites.length === 0) return;
            hits.push({ rule, sites });
        });
        return hits;
    }

    /**
     * 瓶を押したときに**並べる選択肢**（v1424・同書 §11）。
     *
     * `reagentHits()` が「いま通っているもの」だけを返すのに対し、ここは
     * **同じ瓶の `condition` 付きルールを、いま通っていなくても選択肢として足す**。
     *
     * ⚠ 足すのは「その瓶の条件付きルールが**1つでも通っている**」ときだけ。
     *    通っているものが1つも無い瓶では温度の話がそもそも始まっていないので、
     *    従来どおり（0件なら空振りの説明・1件ならそのまま実行）に落ちる。
     *    ＝ 条件が**割れ目に片足でも掛かっている**ときに、割れ目の全部を見せる。
     *
     * ⚠ **瓶を名指ししない。** 条件付きルールが2本ぶら下がる瓶がいまは濃硫酸しか無いだけで、
     *    判定は `condition` というデータの有無だけを見る（別の瓶に条件が付けば同じように効く）。
     */
    reagentOptions(reagent, hits) {
        if (!hits.some(h => h.rule.condition)) return hits;
        const byId = new Map(hits.map(h => [h.rule.id, h]));
        // 条件どうしは**隣り合わせて**並べる（間に条件なしの行き先が挟まると、
        // 「温度で割れている2つ」という読み方が崩れる）。それぞれの中では宣言順
        const conditioned = [], plain = [];
        REACTION_RULES.forEach(rule => {
            if (rule.reagentId !== reagent.id) return;
            if (rule.condition) {
                // `sites: null` ＝「選べるが、いまは材料が足りない」。押すと何が足りないかを返す
                conditioned.push(byId.get(rule.id) || { rule, sites: null });
            } else if (byId.has(rule.id)) {
                plain.push(byId.get(rule.id));
            }
        });
        return conditioned.concat(plain);
    }

    onReagentClick(reagent) {
        // 呈色・検出の瓶（第3段）は反応ルールを持たない。**構造を変えず、陽性/陰性を返すだけ**
        const tests = DETECTION_TESTS.filter(t => t.reagentId === reagent.id);
        if (tests.length) { this.runDetection(reagent, tests); return; }
        const options = this.reagentOptions(reagent, this.reagentHits(reagent));
        if (options.length === 0) { this.explainReagentMiss(reagent); return; }
        // 1件しか無いのは「条件を持たない瓶」か「条件付きが1本だけの瓶」＝ 従来どおり即実行。
        // 条件を足したときは必ず2件以上になる（通ったもの1件＋通っていないもの1件以上）ので、
        // **行き先が1つに見えても温度を訊く**という今回の目的はここで満たされる
        if (options.length === 1) { this.runReagentHit(options[0]); return; }
        this.renderConditionChoice(reagent, options);
    }

    /**
     * 呈色・検出（同書 §2.5・第3段）。**分子は1原子も変わらず、Undo 履歴も積まない。**
     * `saveState()` も `execute()` も通らないので、そもそも積みようがない構造にしてある。
     *
     * 絞り込みは変えるものと同じ `siteFilter()` を使う（判定を2か所に書かない）。
     * 検出は箇所の組ではなく**根拠になった原子の並び**を返すので、選択があるときは
     * その中の原子だけを数える。
     *
     * ⚠ モーダルは**開いたまま**。構造が変わらないのだからキャンバスへ返す理由がなく、
     * 陽性/陰性の文はここで読み切れないと意味がない（§4.3・MM8 と同じ不変条件）。
     */
    runDetection(reagent, tests) {
        const note = this.reagentNoteEl;
        if (!note) return;
        note.innerHTML = '';
        const mol = this.game.userMolecule;
        const { selSets, allSel } = this.siteFilter();
        const test = tests[0];
        let ids = [];
        try {
            ids = test.detect(mol) || [];
        } catch (e) {
            console.error('検出ルール検出エラー:', test.id, e);
        }
        if (selSets.length) ids = ids.filter(id => allSel.has(id));
        const positive = ids.length > 0;
        const head = document.createElement('div');
        head.style.cssText = 'font-size:12px; font-weight:bold; ' +
            `color:var(--${positive ? 'neon-green' : 'text-secondary'});`;
        head.textContent = `${reagent.name}（${reagent.formula}）: ${positive ? '陽性' : '陰性'}`;
        note.appendChild(head);
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        p.textContent = (positive ? test.positive : test.negative) +
            '（この試薬は構造を変えません。図はそのままです）';
        note.appendChild(p);
        // どこが効いたのかを図の上でも示す。**モーダルを閉じたときに残っている**ので、
        // 閉じてから「この輪のところ」と確かめられる
        if (positive && this.game.highlightAtoms) {
            this.game.highlightAtoms(mol.atoms.filter(a => ids.includes(a.id)));
        }
    }

    /**
     * 瓶から選ばれた1件を実行する。**ここから先は自動案内とまったく同じ経路**
     * （`onRuleClick` → `narrow` → `execute`）なので、Undo・前後比較・機構ジャンプ・
     * モーフィングは何も足さずに効く。
     *
     * ⚠ 閉じるのは**反応が進むときだけ**。箇所の選択・モーフィング・前後比較はキャンバスの上で
     * 起きるので全画面のモーダルが乗っていては見えない（DESIGN_molecule_modal.md §2-5）が、
     * 解説だけの `info` は分子を1原子も変えないので**閉じる理由がない**（同 §5-3）。
     *
     * ⚠ **`info` の解説は瓶の節に返す**（同書 §7.5 の未決に対する第2段の決定）。
     * v703 では `onRuleClick` に渡していたので**トーストで数秒だけ出て消えていた**が、
     * 空振り（0件）の説明は `#mm-reagent-note` に残る ——「効かない」という同じ答えが
     * 2か所に割れていた。瓶から来た答えは**押した瓶のすぐ下に、消えずに**返すのが正しい
     * （自動案内の ⚠ ボタンは押すとモーダルを閉じてキャンバスへ返る流れなので、
     * そちらは従来どおりトーストのまま）。
     */
    runReagentHit(hit) {
        // 「選べるが、いまは材料が足りない」条件（v1424）。**押しても何も起きない、にしない**
        if (!hit.sites) { this.explainConditionMiss(hit.rule); return; }
        this.clearReagentNote();
        if (hit.rule.info) { this.showReagentInfo(hit.rule); return; }
        if (this.game.closeMoleculeModal) this.game.closeMoleculeModal();
        this.onRuleClick(hit.rule, hit.sites);
    }

    // `info` ルールの解説を瓶の節に出す。**分子は1原子も変わらず・Undo も積まない**
    // （`apply` を呼ぶが、`info` ルールの `apply` は文を返すだけで書き換えない）
    showReagentInfo(rule) {
        const note = this.reagentNoteEl;
        if (!note) return;
        note.innerHTML = '';
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        p.textContent = rule.apply(this.game).caption;
        note.appendChild(p);
    }

    /**
     * 同じ瓶で行き先が2つ以上あるとき、条件を並べて選ばせる（同書 §2.4）。
     * 温度という概念はコードに持たない ——「同じ `reagentId` の行き先を
     * `condition.label`（無ければ `label`）で並べる」という**一般の選択UI**でしかない。
     * 実質これが要るのは濃硫酸の 160〜170℃／130〜140℃ だけ。
     *
     * ⚠ 並べるのは `reagentOptions()` が作った一覧で、**いま通っていない条件も混ざる**
     *   （`sites === null`。v1424・同書 §11）。通っていないものは
     *   「押せるが何も起きない」にせず、押すと `explainConditionMiss()` が足りないものを言う。
     */
    renderConditionChoice(reagent, options) {
        const note = this.reagentNoteEl;
        if (!note) return;
        note.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--neon-blue);';
        // 条件が絡まない2択（同じ瓶で基質が割る類）に「条件で変わります」と書くと嘘になる
        head.textContent = options.some(h => h.rule.condition)
            ? `${reagent.name}（${reagent.formula}）は条件で行き先が変わります。` +
              `${options.length} 通りから選んでください:`
            : `${reagent.name}（${reagent.formula}）でできることが ${options.length} 通りあります。選んでください:`;
        note.appendChild(head);
        options.forEach(hit => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            b.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px;';
            b.dataset.cond = hit.rule.id;
            // 「いまは材料が足りない」ことは**押す前から**分かるようにしておく（隠して押させない）。
            // それでも押せるのは、選んだ結果として「何が足りないか」を知るのが学習になるから
            if (!hit.sites) {
                b.dataset.condMiss = '1';
                b.style.cssText += ' border-color:var(--text-secondary); color:var(--text-secondary);';
            }
            b.textContent = (hit.rule.condition ? `${hit.rule.condition.label} → ` : '') +
                hit.rule.label +
                (!hit.sites ? '（いまの分子では条件が足りません）'
                    : (hit.sites.length > 1 && !hit.rule.info ? `（${hit.sites.length}箇所）` : ''));
            b.addEventListener('click', () => this.runReagentHit(hit));
            note.appendChild(b);
        });
    }

    /**
     * 通っていない条件を選んだときの応答（v1424・同書 §11）。
     *
     * **条件は結果に書くものではなく選ぶもの**にした以上、選ばれた条件は必ず答えを返す:
     *   ① 相手の分子を足せば通る … 呼び出しの札（`makePartnerHintButton`。押すと呼んで・選んで・実行まで）
     *   ② 相手を足しても通らない … `condition.needs`（何が足りないか）
     * どちらの場合も**一覧を出し直してから**下に足すので、そのまま別の条件を選び直せる。
     *
     * ⚠ 案内の仕組みは v1420 の `findPartnerHints` / `makePartnerHintButton` / `runPartnerHint`
     *   をそのまま使う（新しい導線を作らない）。違うのは**呼ばれる場所**だけ ——
     *   従来は「実行できる反応が0件のとき」だったが、ここは「条件を選んだ結果として足りないと分かる」。
     */
    explainConditionMiss(rule) {
        const note = this.reagentNoteEl;
        if (!note) return;
        const reagent = REAGENTS.find(r => r.id === rule.reagentId);
        // 選び直せるように一覧ごと出し直す（説明で一覧が消えると、もう片方の温度へ戻れない）
        if (reagent) this.renderConditionChoice(reagent, this.reagentOptions(reagent, this.reagentHits(reagent)));
        else note.innerHTML = '';
        const cond = rule.condition || {};
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary); margin-top:6px;';
        const { allSel } = this.siteFilter();
        const hints = this.cachedPartnerHints(allSel.size ? allSel : null, [rule.id]);
        p.textContent = `${cond.label || rule.label} を選びました。この条件で「${rule.label}」を起こすには、` +
            `${cond.needs || 'いまの分子には足りないものがあります'}。`;
        note.appendChild(p);
        if (hints.length > 0) {
            const q = document.createElement('div');
            q.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
            q.textContent = '相手をもう1つ呼び出すとできます:';
            note.appendChild(q);
            hints.forEach(h => note.appendChild(this.makePartnerHintButton(h)));
        }
    }

    /**
     * 空振りのときの応答（同書 §4.2）。**叱らない** ——「間違いです」ではなく「効くのはこれ」を返す。
     * 上から順に当たったところで止める:
     *   ① 相手の分子を足せば通る … 呼び出しボタン（v422 と同じ緑。そのまま次の一手になる）
     *   ② 相手を足しても通らない … 瓶の `acts`（「この試薬が効くのは〜です」）
     *   ③ 効かないこと自体が教材 … 瓶の `miss`（②に続けて出す）
     * **分子は1原子も変わらず、モーダルも閉じない**（同書 §4.3・MM8）。
     */
    explainReagentMiss(reagent) {
        const note = this.reagentNoteEl;
        if (!note) return;
        note.innerHTML = '';
        const ruleIds = REACTION_RULES.filter(r => r.reagentId === reagent.id).map(r => r.id);
        const { allSel } = this.siteFilter();
        const hints = this.cachedPartnerHints(allSel.size ? allSel : null, ruleIds);
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        if (hints.length > 0) {
            p.textContent = `${reagent.name}（${reagent.formula}）は、いまの分子だけでは効きません。` +
                '相手をもう1つ呼び出すとできます:';
            note.appendChild(p);
            // ★ 札の作り方も押したときの動きも**反応カードと同じ1つ**を使う（v1420）。
            //   ここだけ「呼び出して終わり」に戻ると、同じ文言の札が入口によって別の動きをする
            hints.forEach(h => note.appendChild(this.makePartnerHintButton(h)));
            return;
        }
        p.textContent = `${reagent.name}（${reagent.formula}）が効くのは、${reagent.acts}。` +
            'いまの分子にはどれもありません。' + (reagent.miss || '');
        note.appendChild(p);
    }

    /**
     * 「可能な反応がない」で止まったときに、**足りないもの**と**次の一手**を出す（レビュー項目14）。
     *
     * 酢酸だけを作ってもボタンが1つも出ないのは、酢酸が反応しないからではなく
     * エステル化の相手（アルコール）がキャンバスに無いから。呼び出す相手の名前を
     * そのままボタンにして、「名称から分子を呼び出す」につなぐ。
     */
    // 相手の呼び出しの案内が実際に読まれる状態か（＝分子モーダルが開いているか）。
    // 総当たりが重いので、**見えないときは数えない**（v1420）
    partnerHintsVisible() {
        const m = document.getElementById('molecule-modal');
        return !!m && !m.classList.contains('hidden');
    }

    // ⚠ `host` は積み先（v1423）。既定は `#reaction-actions` のままだが、`refresh()` からは
    //    節①「この分子にできること」の器を渡す ——「相手を呼び出す → 反応」は**これから起こす反応**で、
    //    直近の反応をふり返る節②とは別のまとまり
    renderPartnerHints(baseIds, collapsed, host) {
        const dest = host || this.actionsEl;
        const hints = this.cachedPartnerHints(baseIds);
        if (hints.length === 0) {
            // 畳む側（押せる反応がある）では**何も出さない** —— 「できる反応が登録されていません」は
            // 手が止まった人への断り文なので、押せる反応が並んでいる画面に出すと嘘になる
            if (collapsed) return;
            const note = document.createElement('div');
            note.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
            note.textContent = 'いまの分子でできる反応は登録されていません。' +
                '原子や結合を足すか、別の分子を呼び出してみてください。';
            dest.appendChild(note);
            return;
        }
        // 一覧が長くならないように畳む。**中身は1件も落とさない**（畳むか、全部出すかの二択）
        const box = document.createElement('details');
        box.id = PARTNER_HINTS_ID;
        box.style.cssText = 'font-size:11.5px; line-height:1.5;';
        if (!collapsed) box.open = true;
        const head = document.createElement('summary');
        head.style.cssText = 'cursor:pointer; color:var(--neon-green); padding:4px 0;';
        head.textContent = `${PARTNER_HINTS_SUMMARY}（${hints.length}件）`;
        box.appendChild(head);
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        note.textContent = collapsed
            ? '下の反応にはもう1つ分子が要ります。押すと相手を呼び出して、そこまで進めます:'
            : 'この分子だけではできる反応がありません。' +
              '下の反応にはもう1つ分子が要ります。押すと相手を呼び出して、そこまで進めます:';
        box.appendChild(note);
        const list = document.createElement('div');
        list.style.cssText = 'display:flex; flex-direction:column; gap:5px; margin-top:5px;';
        hints.forEach(h => list.appendChild(this.makePartnerHintButton(h)));
        box.appendChild(list);
        dest.appendChild(box);
    }

    /**
     * 「＋ 酢酸 を呼び出す → エステル化」の札（v1420）。
     *
     * **札に箇所の数を書く。** 「→ アセチル化」とだけ書いて途中で止まると
     * 約束を破ったように見えるので、押す前にどちらになるかを札で言っておく:
     *   1箇所   … `＋ 酢酸 を呼び出す → エステル化`（押すと実行まで進む）
     *   2箇所〜 … `＋ グリセリン を呼び出す → エステル化（3箇所から選ぶ）`（押すと箇所選びに入る）
     *
     * 反応カードの一覧と試薬の空振り（`explainReagentMiss`）が**同じこの1つ**を使う
     * ＝ 入口が2つでも約束と動きは1つ（DESIGN_reagent_palette.md RG4 と同じ考え方）。
     */
    makePartnerHintButton(h) {
        const btn = document.createElement('button');
        btn.className = 'view-btn';
        btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
            'border-color:var(--neon-green); color:var(--neon-green);';
        btn.dataset.partner = h.name;
        if (h.ruleId) btn.dataset.rule = h.ruleId;
        const many = h.siteCount > 1 ? `（${h.siteCount}箇所から選ぶ）` : '';
        btn.textContent = `＋ ${h.name} を呼び出す → ${h.label}${many}`;
        btn.title = many
            ? `${h.name} を呼び出し、2つを選んでから「${h.label}」の箇所を選びます`
            : `${h.name} を呼び出し、2つを選んで「${h.label}」まで実行します`;
        btn.addEventListener('click', () => this.runPartnerHint(h));
        return btn;
    }

    /**
     * 札の約束を果たす（v1420）。**押したら、書いてあるところまで連れて行く。**
     *
     * v1409 まではここが `summonMolecule` を呼ぶだけで、モーダルも閉じず・選択もせず・
     * 実行もしなかった。実際にエステル化するにはそこから7手（モーダルを閉じる →
     * 2つ並んだのを確認 → 反応させる・調べるを開き直す → 選ぶモードを押す →
     * 2つタップ → ようやく押せる）かかっていた。
     *
     * ⚠ **段ごとに確かめて止める。**「エステル化されたつもりで何も起きていない」が最悪の結末なので、
     *    ①呼べたか ②箇所が本当に生えたか ③絞り込んだ後も押せるか を**実測してから**実行する:
     *
     *   呼び出せなかった               → そこで止めて理由を言う（反応は実行しない）
     *   呼び出せたが押せるようにならない → 選ぶところまでで止めて言う
     *   両方通った                     → 1箇所なら実行・2箇所以上なら箇所選びへ（どちらもモーダルを閉じる）
     *
     * ⚠ **どちらでもモーダルは閉じる。** 箇所選びは**キャンバスをクリックする**操作なので
     *    モーダルが開いていたら選べない。実行後も `↩ 反応前に戻す` が帯（`#ws-free`）にあり、
     *    モーダルが開いていると裏に隠れて「簡単に戻せる」が成り立たない。
     */
    runPartnerHint(h) {
        const g = this.game;
        this.clearDeadEnd();
        const rule = REACTION_RULES.find(r => r.id === h.ruleId);
        if (!rule) {
            return this.stopPartnerHint(h, 'rule', `「${h.label}」の反応ルールが見つかりませんでした。`);
        }
        // ① 相手を呼ぶ。**戻り値を見る** —— 名前が引けない／キャンバスの端まで並んだ、で false が返る
        const beforeIds = new Set(g.userMolecule.atoms.map(a => a.id));
        if (!g.summonMolecule(h.name)) {
            return this.stopPartnerHint(h, 'summon',
                `「${h.name}」を呼び出せませんでした（上の説明を見てください）。反応は実行していません。`);
        }
        const added = new Set(g.userMolecule.atoms.filter(a => !beforeIds.has(a.id)).map(a => a.id));
        if (added.size === 0) {
            return this.stopPartnerHint(h, 'summon',
                `「${h.name}」がキャンバスに載りませんでした。反応は実行していません。`);
        }
        // ② 箇所が本当に生えたか（試作品ではなく**いま置いた実物**で確かめる）
        let sites = [];
        try {
            sites = rule.detect(g.userMolecule) || [];
        } catch (e) {
            return this.stopPartnerHint(h, 'detect',
                `「${h.name}」は置けましたが、${h.label} の判定でエラーが出ました（${e.message}）。`);
        }
        const cross = sites.filter(s => Array.isArray(s) &&
            s.some(id => added.has(id)) && s.some(id => !added.has(id)));
        if (cross.length === 0) {
            return this.stopPartnerHint(h, 'detect',
                `「${h.name}」は置けましたが、2分子にまたがる ${h.label} の箇所が見つかりませんでした。` +
                '反応は実行していません。');
        }
        // ③ 両方を選ぶ → **その状態で本当に押せるか**を絞り込みそのもので確かめる
        this.selectPartnerPair(cross, added);
        const { siteAllowed } = this.siteFilter();
        const allowed = sites.filter(s => Array.isArray(s) && siteAllowed(s));
        if (allowed.length === 0) {
            return this.stopPartnerHint(h, 'select',
                `「${h.name}」は置けましたが、2つを選んでも ${h.label} が押せる状態になりませんでした。` +
                '反応は実行していません。');
        }
        // ④ ここまで通ったときだけ進む。**どちらでもモーダルは閉じる**
        if (g.closeMoleculeModal) g.closeMoleculeModal();
        g.updateDrawing(); // 選択枠（青の破線＋番号）を出してから動く
        if (allowed.length === 1) {
            this.execute(rule, allowed[0]);
        } else {
            this.narrow(rule, allowed); // ハイライトを出して箇所選びで止まる
        }
        return true;
    }

    /**
     * 呼び出した相手と、その相手と組む分子を選ぶ（v1420）。
     * 式の左右は問わない（ユーザー確認済み）ので、**先に元からあった側**を左に置く。
     * 相手は必ず1分子なので、上限に当たったら削るのは元からあった側。
     */
    selectPartnerPair(crossSites, added) {
        const g = this.game;
        const max = (typeof MAX_REACTION_SELECTION !== 'undefined') ? MAX_REACTION_SELECTION : 4;
        const covered = [];
        const mine = [], theirs = [];
        crossSites.forEach(s => s.forEach(id => {
            if (covered.some(c => c.has(id))) return;
            covered.push(g.moleculeAtomIdsOf(id));
            (added.has(id) ? theirs : mine).push(id);
        }));
        g.selectedMolecules = mine.slice(0, Math.max(1, max - 1)).concat(theirs.slice(0, 1));
    }

    /**
     * 途中で止まったことを**黙らずに**言う（v1420）。トーストは数秒で消えるので、
     * 反応カードにも残す（v1420 でここに「うまくいかない、と知らせる」が入る）。
     * 戻り値は false ＝ 呼び元はそのまま return できる。
     */
    stopPartnerHint(h, stage, message) {
        this.game.showToast(message, 8000);
        this.showDeadEnd({
            where: 'partner-hint',
            stage,
            tried: `＋ ${h.name} を呼び出す → ${h.label}`,
            ruleId: h.ruleId || '',
            detail: message
        });
        return false;
    }

    /**
     * 行き止まりの掲示板（`#rx-deadend`）。
     * **中身の作り方は `deadend.js`（`DeadEnd`）が持つ**（v1420）——「行き止まりで黙る」は
     * ここ以外でも起きるので、報告の仕組みは反応の外に置いて使い回せる形にしてある。
     * ⚠ 読み込まれていない場合でも**理由だけは出す**（報告が無いより黙るほうが悪い）。
     */
    showDeadEnd(info) {
        this.lastDeadEnd = info; // どこで止まったかを1か所に残す（テストと報告の口）
        const el = document.getElementById('rx-deadend');
        if (!el) return;
        el.innerHTML = '';
        el.classList.remove('hidden');
        if (window.DeadEnd && window.DeadEnd.attach) {
            window.DeadEnd.attach(el, info, this.game);
            return;
        }
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--neon-pink);';
        p.textContent = info.detail;
        el.appendChild(p);
    }

    clearDeadEnd() {
        this.lastDeadEnd = null;
        const el = document.getElementById('rx-deadend');
        if (!el) return;
        el.innerHTML = '';
        el.classList.add('hidden');
    }

    // 選択中の分子を反応カードに文で出す（C-1）。式の並びを先に見せてから反応を選ばせる
    renderSelectionNote(selSets) {
        const el = document.getElementById('reaction-selection');
        if (!el) return;
        if (!selSets.length) {
            // ★ 選ぶモードに入ったのに何も選べていない人を置き去りにしない（v1409）。
            //   ここはモーダルを開き直したときに読まれる面 —— タップした瞬間はトーストが同じ文を出す。
            //   ⚠ モードに入っていないときは今までどおり無言（ふだんの画面に文が生えない）
            if (this.game.reactionSelectMode) {
                el.textContent = (this.game.canvasMoleculeCount() < 2)
                    ? REACTION_SELECT_LONELY_HINT
                    : 'キャンバスの分子をタップすると選べます（先に選んだ方が式の左）。' +
                      'やめるときは、この「🎯 反応させる分子を選ぶ」をもう一度押すと作図に戻ります。';
            } else {
                el.textContent = '';
            }
            return;
        }
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
        // ⚠ `setMode('learn')` は**記録を捨てない**（v1423）。機構を見にいくのは
        //    「直近の反応」という文脈の**続き**なので、戻ってくれば前後比較も
        //    「↩ 反応前に戻す」もそのまま使える（`reaction.js` の `exit()` が
        //    `returnCanvas()` → `updateDrawing()` を通り、`syncUndoButton()` が札を出し直す）
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
        // 図の形も覚えておく（v1420）。再描画が来たときに「まだ同じ図か」を見て、
        // 同じなら選ばせ続ける（`syncPicking`）
        this.picking = { rule, sites, topo: this.topologyKey(this.snapshotMolecule(this.game.userMolecule)) };
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

    /**
     * 箇所選びの途中に来た再描画の扱い（v1420）。
     *
     * ⚠ **無条件に捨ててはいけない。** ハイライト（`uiGroup` の橙の破線）は `updateDrawing()` では
     * 消えないので、`picking` だけ捨てると**丸が付いたままクリックだけが効かない**画面ができる
     * （タップは作図に落ちるので、選ぶつもりで原子を置くことになる）。
     *
     * 実発生: 「＋ 酢酸 を呼び出す → エステル化（3箇所から選ぶ）」で相手を呼ぶと
     * `fitCanvasToMolecule` が拡大率を変え、その `scheduleLabelResync` の rAF が
     * **箇所選びに入った直後に**再描画を投げる ＝ 1フレームで選べなくなっていた。
     *
     * 図（トポロジー）が変わっていなければ選ばせ続け、変わっていれば
     * **ハイライトごと**下ろす（見た目と状態を食い違わせない）。
     */
    syncPicking() {
        if (!this.picking) return;
        const now = this.topologyKey(this.snapshotMolecule(this.game.userMolecule));
        if (this.picking.topo && this.picking.topo === now) return;
        this.picking = null;
        this.game.clearUIOverlay();
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
        // ★ 「↩ 反応前に戻す」用の**完全な**控え（v1409）。
        //   `before` は前後比較の絵を描くための抜き書き（id・元素・座標・電荷）で、
        //   ロック・不斉マーク・ベンゼンの中心角など**描き戻しに要る属性を持たない**。
        //   戻すのは `serializeState()`（Undo が使っているものと同じ全部入り）で行う
        const beforeState = g.serializeState();
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
            beforeState,
            after: this.snapshotMolecule(g.userMolecule)
        };
        this.clearDeadEnd(); // 反応が通ったら、前に出した「ここで止まりました」は用済み（v1420）
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
    // 原子IDは "atom_xxxx" のような文字列なので、キーは区切りに \0 を使い、結合はオブジェクトごと保持する
    computeDiff(before, after) {
        const beforeIds = new Set(before.atoms.map(a => a.id));
        const afterIds = new Set(after.atoms.map(a => a.id));
        const heavy = a => a.element !== 'H';
        const removedAtoms = before.atoms.filter(a => !afterIds.has(a.id) && heavy(a)); // 脱離
        const addedAtoms = after.atoms.filter(a => !beforeIds.has(a.id) && heavy(a));    // 付加
        const key = b => b.atomId1 < b.atomId2 ? `${b.atomId1}\0${b.atomId2}` : `${b.atomId2}\0${b.atomId1}`;
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

    /**
     * 記録ごと破棄する（v1423 で `exitCompare()` から改名・DESIGN_reaction_execution.md §12）。
     *
     * ⚠ **呼んでよいのは「直近の反応という文脈そのものが終わった」ときだけ**:
     *   - 全消去（`refresh()` が空のキャンバスを見たとき）… 変化させた元の物質が画面から消えた
     *   - 「↩ 反応前に戻す」… キャンバスが反応前に戻った以上、直近の反応はもう無い
     *
     * ⚠ **モード離脱では呼ばない。** かつて `setMode()` の掃除がこれを呼んでいたため、
     *   「⚗ この反応の機構を見る」（`setMode('learn')` を通る）へ進んだだけで
     *   **記録が捨てられ、戻ってきても「↩ 反応前に戻す」が二度と出なかった**
     *   ——「機構を見た」は文脈の**続き**であって、終わりではない。
     *   分子そのものは `reaction.js` の `borrowCanvas()` / `returnCanvas()` が退避・復帰しており、
     *   捨てられていたのは記録（`beforeState` という文字列）だけだった。
     *   モード離脱で要るのは**閉じること**だけなので `closeCompare()` を呼ぶ（v1423）。
     *   帰ってきた図が本当に `after` と同じかは `syncUndoButton()` の門番が見る。
     */
    discardLastReaction() {
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
    window.REAGENTS = REAGENTS;                 // 試薬瓶（RG1 の死にリンク検査が読む）
    window.DETECTION_TESTS = DETECTION_TESTS;   // 呈色・検出（RG7・RG8 が読む）
    window.REGISTERED_NAMES = REGISTERED_NAMES;
    window.aromaticSiteRole = aromaticSiteRole; // 配向性（テスト・検証ツール用）
    window.bondStep = bondStep;                 // その分子の作図の刻み（RX19 の距離判定で使う）
    window.PARTNER_CANDIDATES = PARTNER_CANDIDATES;
    window.PARTNER_HINTS_ID = PARTNER_HINTS_ID;
    window.PARTNER_HINTS_SUMMARY = PARTNER_HINTS_SUMMARY;
    window.findPartnerHints = findPartnerHints; // RX35（位置に依らないことの実測）が読む
    window.RX_SECTION_NEXT = RX_SECTION_NEXT;   // RX40（節の見出し）が読む
    window.RX_SECTION_LAST = RX_SECTION_LAST;
    window.RX_UNDO_POINTER = RX_UNDO_POINTER;
}
