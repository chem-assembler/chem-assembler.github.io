/**
 * 反応実行エンジン（P9-1 M2 / 設計: DESIGN_reaction_execution.md）
 * 「⚗ この分子の反応」カードに、いま描かれている分子へ適用できる反応を列挙し、
 * 選ぶと分子グラフを書き換えて生成物へ変化させる。実行は通常の編集と同じく
 * saveState を積むので Undo/Redo がそのまま効く。名称判定カードが答え合わせを兼ねる。
 */

// ---- 共通ヘルパー ----

/**
 * ★ 「置く場所が無い」で断ったことを、**文言ではなく型で**伝えるための例外（v1466）。
 *
 * **なぜ要るか**（ユーザー決定 2026-08-26・案「い」）: 場所不足の断り文は 28 箇所あり、
 * どれも「分子を離してから実行してください」等と案内していたが、**離す手段は
 * `Shift＋ドラッグ` しか無い**（判定は `game.js` の `shiftKey` 1か所）。
 * ⚠ **タブレット・スマホには Shift キーが無いので、案内どおりのことができない。**
 * そこで断ったときに「🧹 分子を並べ直す」の札を出す（`Reactor.showNoRoom`）が、
 * **どの失敗が場所不足か**を `e.message` の文字列で判定するのは脆い
 * （文言を1文字直したら札が出なくなる ＝ 静かに元の行き止まりへ戻る）。
 *
 * ⚠ **場所不足以外に使わないこと。** 「多重結合が見つかりません」のような
 * 前提が崩れている失敗まで含めると、並べ直しても直らないものに札を出すことになる
 * （＝「押しても何も変わらない」＝ 潰したはずの行き止まりの作り直し）。
 *
 * 検査は RS1（`reactor.js` の中に「空間がありません」を素の `new Error` で投げる行が
 * 1つも無いこと）。否定対照は「1箇所を `new Error` に戻すと RS1 が赤」。
 */
class NoRoomError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NoRoomError';
        this.noRoom = true;   // instanceof が跨がない場面（iframe 越しのテスト）でも読める印
    }
}

// 場所不足で断る。`throw noRoom('…')` と書くだけで上の印が付く
function noRoom(message) { return new NoRoomError(message); }

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
 *
 * ⚠ **この門番は残す**（2026-08-21 に洗い直した結果・DESIGN_sugar.md §4-6）。
 * 禁じている理由は「回すと立体が変わるから」ではなく **「図の読みの約束が変わるから」**である。
 * ハース図で 90° 回すと置換基が横を向き、`readRingParityFromHaworth` の
 * 「環炭素の真上・真下（±25°）に描いてあれば面が読める」が成り立たなくなる ＝ **読めなくなる**。
 * ⚠ **「上下と向きをセットで回せば大丈夫」は 90° 回転には効かない。**
 *
 * ⚠ **ただし例外がちょうど1つある: 上下反転（裏返す）。**
 * 裏返したハース図は**やはりハース図**なので読みの約束が壊れない。
 * `chemistry.js` の `canFlipHaworth` / `flipHaworth` がそれで、環をもつ糖16件で
 * 立体コードが 16/16 同一（回帰テスト SG1）。⚠ **環の独楽回転**（`spinHaworthRing`）も同じ扱いで、
 * こちらは図をアフィン変換で回すのではなく**環の席をずらして置き直す**ので置換基が縦のまま残る。
 * ⚠ **鏡映は入れない**（別の化合物になる）。
 * つなぐ側（単糖⇄二糖）の配置でこの2つを使うのは DESIGN_sugar.md の段5。**この関数は変えない。**
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
 *
 * `prefer`（{x, y}・v1436・§14）を渡すと、**その向きを最初に試す**。重合が
 * 「鎖をまっすぐ1歩伸ばす」ことを言うために要る ―― 既定の順（右・上・下・左）は
 * 右が塞がっていると上へ逃げるので、鎖が階段状に折れていた。置けなければ
 * 従来の順へ落ちるだけなので、**置ける場所は1つも減らない**。
 */
function planAttachment(mol, anchorId, attachId, movingIds, ignoreIds = [], prefer = null) {
    const anchor = mol.atoms.find(a => a.id === anchorId);
    const attach = mol.atoms.find(a => a.id === attachId);
    if (!anchor || !attach) return null;
    const moving = new Set(movingIds);
    const ignore = new Set(ignoreIds);
    const statics = mol.atoms.filter(a => !moving.has(a.id) && !ignore.has(a.id) && a.element !== 'H');
    const G = bondStep(mol, anchorId); // 母体の刻みに合わせる（42px 固定だと結合線が原子を貫通する）
    const MIN_CLEARANCE = G * 0.65;
    let dirs = [0, -Math.PI / 2, Math.PI / 2, Math.PI]; // 右・上・下・左
    if (prefer) {                                       // 鎖の続きの向きを先に試す（v1436・§14）
        const first = Math.atan2(prefer.y, prefer.x);
        dirs = [first, ...dirs.filter(d => Math.abs(d - first) > 1e-6)];
    }
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
 * グリコシド結合を切ったアノマー炭素に入る -OH を、**上下のどちら**に置くかを返す
 * （ラジアン。決められなければ null ＝ `freeSpotAround` の既定の順序にまかせる）。
 *
 * ⚠ **ハース投影では、環外に出る置換基の「縦位置」が α/β を決める**
 * （`readRingParityFromHaworth`。縦から ±25° 以内でないと面が読めない ——
 * `DESIGN_stereochemistry.md` §12.1 が意識して開けた、座標を見る唯一の穴）。
 * `freeSpotAround` はこの約束を知らないので**真横（縦から 90°）に置く**。
 * その結果、切った中心だけが面を失い、**二糖4件中3件で生成物の片方が名無しになっていた**
 * （`DESIGN_sugar.md` §4-2 の実測。マルトース・セロビオース・ラクトース）。
 *
 * **どちら側かは切る前の橋の酸素が決める。** 加水分解はアノマー炭素の立体を変えない
 * （※ 実際には水中で変旋光が起きて α/β が混ざるが、それは図の話ではなく caption で断る）ので、
 * **橋の -O- が出ていた側にそのまま -OH を置く**のが元の面を保つ唯一の置き方である。
 *
 * ⚠ **角度が読めるかどうかでは決めない。** スクロースの橋は縦から 29.5°（±25° の外）だが、
 * 「上下どちらの側か」は符号だけで決まるので、読めない図からでも保存できる。
 */
function haworthCleaveDirection(mol, cId, oId) {
    const c = mol.atoms.find(a => a.id === cId);
    const o = mol.atoms.find(a => a.id === oId);
    if (!c || !o) return null;
    // ハース投影として読まれるのは環の炭素だけ。鎖の途中なら従来どおり
    if (!sugarRingOf(mol, cId, ringAtomIdsOf(mol))) return null;
    const dy = o.y - c.y;
    if (Math.abs(dy) < 1e-6) return null; // ちょうど真横 ＝ もとから面が無い
    return dy < 0 ? -Math.PI / 2 : Math.PI / 2; // 画面座標は下が正
}

/* ==========================================================================
 * 糖どうしの縮合（グリコシド結合を作る）—— `DESIGN_sugar.md` §4-8 / §4-8c
 *
 * ★ **なぜ `dehydration_inter`（分子間脱水 → エーテル）と別のルールなのか**
 *   α-D-グルコースを2つ並べて分子間脱水を押すと、札は「**エーテル（25箇所）**」の1枚だけで、
 *   25箇所のうち**名前を言い切れる生成物は0件**（実測 §4-8c）。⚠ ユーザーの言う
 *   「反応可能な官能基が多く、学習者が戸惑う」の実体がこれ。
 *   教科書はこの -O- を**グリコシド結合**と呼び分けているので、札も分ける。
 *
 * ★ **候補の絞り方は「規則を手で書かない」**（発注）。
 *   どの -OH につないでよいかを表に書くのではなく、**つないでみて名前が引けるか**で決める
 *   （`registeredProductName`）。⚠ **二糖を登録に足せば、その日から候補になる**。
 *
 * ⚠ **絞るのは糖どうしのときだけ。** 全体に効かせると
 *   **糖 ＋ アルコール（配糖体の向き）が 5→0 で黙って消える**（§4-8c (d) の実測）。
 * ========================================================================== */

// ハース図で「縦」と読める範囲（`_haworthFaceOf` と同じ ±25°）。
// これを外れて描かれた -OH は、その中心の α/β を図が言っていない
const HAWORTH_VERTICAL_TAN = Math.tan(25 * Math.PI / 180);

/* 橋の酸素の置き場所。**登録の二糖4件の実測値**（§4-8c）——
 * マルトース・セロビオース・ラクトースは両側とも (±42, ±114)、スクロースは (42,114)/(-42,124)。
 * 縦から 20.2° ＝ ±25° の内側なので、**両側の環の面が読める**（読めた中心 10/10）。
 * ⚠ ここを縦 0° にすると環が真上と真下に積み上がり、**教科書の「環を真横に並べる」図から外れる**
 *   （発注の芯 ＝ 紙面での構造式）。 */
const GLYCOSIDE_BRIDGE_DX = 42;
const GLYCOSIDE_BRIDGE_DY = 114;

/**
 * ★★ 糖どうしの縮合に添える断り（`DESIGN_sugar.md` §4-8b (c)(d)・§4-8c）。
 *
 * ⚠ **どこまでが教科書の記述で、どこからがこの教材が足す説明かを分ける**
 *   （`qa/KNOWLEDGE_CAVEATS.md` の型）。だから見出しの一言から始める。
 *
 * 中身の裏取り（`scan/` 11本・104ページ全数 ＋ 出典。§4-8b）:
 *   - 教科書の「2分子の単糖から水1分子がとれて二糖になる」は**組成の勘定としては正しい**が
 *     機構ではない。`scan/` の糖教材の記述は **100%「割る（加水分解）」方向**で、
 *     「脱水縮合してグリコシド結合を作る」と書いたページは1つも無い
 *   - 実験室では位置も α/β も選べず**アノマー混合物**になる（保護基・活性化系が要る）
 *   - ★ **生体のスクロース合成は加水分解の逆ではない** ——
 *     UDP-グルコース（活性化された糖）からのグリコシル転移で、いったんリン酸エステルになる
 *
 * ⚠ **「⇄（平衡）」とは書かない。** 水の中では加水分解の側が自発的で、
 *   両向きが見られることと反応が可逆であることは別（§4-8b (d) 問い①）。
 */
const RX_GLYCOSIDE_CAVEAT =
    'ここから先は、教科書には書かれていない断りです。' +
    '「-OH どうしから水がとれて二糖になる」は、原子の数を合わせた言い方です。' +
    '実験室でただ酸を加えても、どの -OH がつながるかも α か β かも選べず、いろいろな形が混ざります。' +
    '生体では酵素が1つに決めていますが、その作り方は加水分解の逆をたどるものではなく、' +
    '活性化された糖から渡す別の道すじです。' +
    'この画面が見せているのは、できあがりの形どうしの対応であって、' +
    '実験室で同じようにつながるという意味ではありません。';

/**
 * 糖の環の炭素に付いた**遊離の -OH** を `{ oId, face }` で返す（無ければ null）。
 * `face` は画面座標の符号（+1 ＝ 下に描かれている・-1 ＝ 上）。
 *
 * ⚠ **縦から ±25° の外に描かれた -OH は返さない。**
 *   その中心は `readRingParityFromHaworth` が面を読めない ＝ **図が α/β を言っていない**ので、
 *   つないだ先で「どの二糖か」も決まらない（名前が「〜のどれか」になる）。
 */
function haworthFreeOhOf(mol, cId) {
    const c = mol.atoms.find(a => a.id === cId);
    if (!c || c.element !== 'C') return null;
    const hit = mol.getNeighbors(cId).find(n => n.atom.element === 'O' && n.type === 1 &&
        mol.getNeighbors(n.atom.id).filter(x => x.atom.element !== 'H').length === 1);
    if (!hit) return null;
    const dx = hit.atom.x - c.x, dy = hit.atom.y - c.y;
    if (Math.abs(dy) < 1e-6) return null;                        // 真横 ＝ もとから面が無い
    if (Math.abs(dx) > Math.abs(dy) * HAWORTH_VERTICAL_TAN) return null; // 斜め ＝ 読めない
    return { oId: hit.atom.id, face: dy > 0 ? 1 : -1 };
}

/** 連結成分の一部（ids）だけを写した新しい Molecule。⚠ **面マークも写す**（落とすと鏡像に化ける） */
function subMolecule(mol, ids) {
    const want = new Set(ids);
    const out = new Molecule();
    const map = new Map();
    mol.atoms.forEach(a => {
        if (!want.has(a.id)) return;
        const na = out.addAtom(a.element, a.x, a.y);
        if (a.haworthFace === 1 || a.haworthFace === -1) na.haworthFace = a.haworthFace;
        map.set(a.id, na.id);
    });
    mol.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) out.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
    });
    return { mol: out, map };
}

/**
 * ★★ **候補を絞る物差し。手で書いた規則はここに1つも無い。**
 *
 * `game.lookupCompoundName` に聞いて、返ってきた名前が**名称ライブラリに実在する名前**なら
 * その名前を、そうでなければ null を返す。
 *
 * ⚠ **文言を書き写して照合しない。** 「〜ほか N 種 のどれか（立体で決まります）」のような
 *   **言い切っていない**返しは、ライブラリの名前と一致しないので**名前の一覧に当てるだけで落ちる**
 *   （＝ 断り文の言い回しを直しても、この関数は壊れない）。
 * ⚠ `iupacName` の系統名（登録の無いエーテル等）も同じ理由で落ちる。
 *
 * ⚠⚠ **名前が一致しただけでは足りない**（2026-08-26 の実測で見つけた穴。§4-8d）。
 *   `lookupCompoundName` は「立体を名前に反映する」が OFF で図から立体が読み切れないとき、
 *   **立体の印を外した総称**を返す。ふつうは「α-D-グルコース」→「D-グルコース」のように
 *   別の文字列になるが、**スクロースのように名前に α/β が付かない登録では、
 *   総称と立体つきの名前が同じ文字列になる**。その結果、実測で
 *   **β-D-グルコース ＋ β-D-フルクトフラノース**（本物のスクロースは α-D-グルコース側）が
 *   「スクロース（ショ糖）」を名乗って候補に残っていた（3組で発生）。
 *   ★ だから**登録の立体コードとも一致すること**まで見る。
 *   ＝ ここで「登録済みの化合物のみ」（ユーザーの言い方）と「言い切れる名前だけ」が
 *      **はじめて同じ1つの物差しになる**。
 */
function registeredProductName(part) {
    const g = (typeof window !== 'undefined' && window.reactor && window.reactor.game) ||
        (typeof window !== 'undefined' ? window.game : null);
    if (!g || !g.lookupCompoundName || !g.getCompoundLibrary) return null;
    let name = null;
    try { name = g.lookupCompoundName(part); } catch (e) { return null; }
    if (!name) return null;
    try {
        const entries = g.getCompoundLibrary().filter(e => e.name === name);
        if (!entries.length) return null;
        const code = canonicalCode(part);
        // ⚠ 立体コードの組み立ては `getCompoundLibrary` と同じ材料で（環の面＋結合の幾何）
        const stereo = canonicalStereoCode(part, {
            atomParity: readRingParityFromHaworth(part),
            bondGeo: readBondGeoFromCoords(part)
        });
        // 立体の指定を持たない登録（総称）はそのまま通す ＝ 既存の照合の約束を変えない
        return entries.some(e => e.code === code && (!e.stereoCode || e.stereoCode === stereo))
            ? name : null;
    } catch (e) { return null; }
}

/**
 * 糖どうしの縮合を当てる（`detect` の下見と `apply` の本番で**同じ関数**を使う）。
 * site は `[供与側の -OH の O, 供与側のアノマー炭素, 受け側の -OH の O, 受け側の環炭素]`。
 * 置けたら true、置けなければ false（分子は触らない）。
 *
 * ★ **置き方は「平行移動 ＋ 必要なら反転」**（§4-8）。⚠ `planAttachment` は使わない ——
 *   あれは相手を**分子ごと回して**寄せるので、**動かされた側のアノマー炭素の -O- が縦から外れ、
 *   面が1つ読めなくなる**（実測: 読めた中心が 10 → 9。§4-8c (a) がこのレーンで特定した穴）。
 *
 * ★ **反転は v1450/v1454 で入った ⇅ の道具（`flipHaworth` ＋ `canFlipHaworth`）を借りる。**
 *   ⚠ 新しい反転を書かない。分子まるごとの上下フリップなので軸は既定（重心）でよい（§4-10）。
 *   反転が要るのは**2つの -OH が反対の面を向いているとき**だけ:
 *     α-D-グルコース … C1 も C4 も下 → **反転なし**（→ マルトース）
 *     β-D-グルコース … C1 は上・C4 は下 → **相手を1回反転**（→ セロビオース）
 *   ＝ `DESIGN_sugar.md` §3-2 の表がそのまま出てくる。
 */
function applyGlycosidicCondensation(mol, site) {
    const [oDId, cDId, oAId, cAId] = site;
    const oD = mol.atoms.find(a => a.id === oDId);
    const cD = mol.atoms.find(a => a.id === cDId);
    const oA = mol.atoms.find(a => a.id === oAId);
    const cA = mol.atoms.find(a => a.id === cAId);
    if (!oD || !cD || !oA || !cA) return false;
    const faceD = oD.y > cD.y ? 1 : -1;
    let faceA = oA.y > cA.y ? 1 : -1;
    const acceptorIds = [...componentOf(mol, cAId)];
    if (acceptorIds.includes(cDId)) return false; // 同じ分子の中では起こさない（分子間脱水と同じ粒度）
    let flipped = false;
    if (faceA !== faceD) {
        // ⚠ 裏返すと鏡像の図になる分子は断る（門番はフリップの札と同じ `canFlipHaworth`）
        if (!canFlipHaworth(mol, acceptorIds)) return false;
        if (!flipHaworth(mol, acceptorIds)) return false;
        faceA = -faceA;
        flipped = true;
    }
    // 相手をどちら側へ置くか ＝ 供与側の環から見て**アノマー炭素が外を向いている側**。
    // ⚠ 原子IDの順序は見ない（IDは乱数。座標だけで決める）
    const ringIds = ringAtomIdsOf(mol);
    const donorRing = sugarRingOf(mol, cDId, ringIds) || [];
    const ringCx = donorRing.length
        ? donorRing.reduce((t, id) => t + (mol.atoms.find(a => a.id === id) || cD).x, 0) / donorRing.length
        : cD.x;
    const s = cD.x < ringCx ? -1 : 1;
    // 橋の酸素と受け側の炭素を、登録の二糖と同じ形（±42, ±114）に置く
    const newO = { x: cD.x + GLYCOSIDE_BRIDGE_DX * s, y: cD.y + GLYCOSIDE_BRIDGE_DY * faceD };
    const newCA = { x: newO.x + GLYCOSIDE_BRIDGE_DX * s, y: newO.y - GLYCOSIDE_BRIDGE_DY * faceD };
    translateAtoms(mol, acceptorIds, newCA.x - cA.x, newCA.y - cA.y);
    mol.removeBond(oAId, cAId);
    oD.x = newO.x;
    oD.y = newO.y;
    mol.addBond(oDId, cAId, 1);
    parkAsWater(mol, oAId);
    // 3つめの分子がキャンバスに居ると重なることがある。⚠ **逃がすのは平行移動だけ**（図は変えない）
    const productIds = [...componentOf(mol, cDId)];
    if (componentOverlaps(mol, productIds)) {
        const sep = separateComponent(mol, productIds);
        if (sep) translateAtoms(mol, productIds, sep.dx, sep.dy);
    }
    return { flipped };
}

/* 下見（`detect` のたびに 8 通りをつなぎ直して名前を引く）の結果を覚えておく。
 * ⚠ `refresh()` は**作図のたび**に走るので、同じ図で数え直さない。
 * 鍵は原子の位置と結合（座標を動かすと図の読みが変わるので、座標も鍵に入れる） */
let _glycoCondCache = { key: null, sites: [] };

function glycosidicCondensationSites(mol) {
    // ハース図として読める糖の環が2つ以上（＝別々の分子に1つずつ）なければ、そもそも出番が無い
    let cycles;
    try { cycles = haworthSugarCycles(mol); } catch (e) { return []; }
    if (cycles.length < 2) return [];
    const key = mol.atoms.map(a => `${a.id}${a.element}${Math.round(a.x)},${Math.round(a.y)},${a.haworthFace || 0}`)
        .sort().join('|') + '#' +
        mol.bonds.map(b => (b.atomId1 < b.atomId2 ? b.atomId1 + '-' + b.atomId2 : b.atomId2 + '-' + b.atomId1) + ':' + b.type)
            .sort().join('|');
    if (_glycoCondCache.key === key) return _glycoCondCache.sites;

    const ringIds = ringAtomIdsOf(mol);
    const sugarRingAtoms = new Set();
    cycles.forEach(c => c.forEach(id => sugarRingAtoms.add(id)));
    const donors = [], acceptors = [];
    mol.atoms.forEach(c => {
        if (c.element !== 'C' || !sugarRingAtoms.has(c.id)) return;
        const oh = haworthFreeOhOf(mol, c.id);
        if (!oh) return;
        // ⚠ **受け側は環の炭素に限る**（環の外の -OH（C6 の CH₂OH など）は面を持たないので、
        //   「面を保って置く」という置き方が定義できない）。教科書に名前の出る二糖5つは
        //   すべて環の炭素どうしなので、これで1つも作れなくならない（§4-8b (e)）
        acceptors.push({ cId: c.id, ...oh });
        // ⚠ **供与側はアノマー炭素に限る**（`sugarRingOf` が返すのは環の O に隣り合う炭素だけ）。
        //   これは切る側（`glycosidicLinkages`）が要求している条件そのもので、
        //   ここを緩めると**つないだのに切り戻せない図**ができる（実測 16/25）
        if (sugarRingOf(mol, c.id, ringIds)) donors.push({ cId: c.id, ...oh });
    });
    const out = [];
    donors.forEach(d => {
        acceptors.forEach(a => {
            if (a.cId === d.cId) return;
            const raw = [d.oId, d.cId, a.oId, a.cId];
            const { mol: probe, map } = subMolecule(mol, mol.atoms.map(x => x.id));
            const trial = raw.map(id => map.get(id));
            if (trial.some(id => id === undefined)) return;
            if (!applyGlycosidicCondensation(probe, trial)) return;
            const part = subMolecule(probe, [...componentOf(probe, trial[1])]).mol;
            const name = registeredProductName(part);
            if (!name) return;                       // ★ 物差しはこの1行だけ
            if (out.some(o => o.name === name)) return; // 同じ二糖になる組は1つにまとめる
            out.push({ site: raw, name });
        });
    });
    // 名前の順で並べる（原子IDの乱数に依存しない並び）
    out.sort((p, q) => (p.name < q.name ? -1 : p.name > q.name ? 1 : 0));
    const sites = out.map(o => {
        const arr = o.site.slice();
        arr.productName = o.name;
        return arr;
    });
    _glycoCondCache = { key, sites };
    return sites;
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
    if (!spot) throw noRoom('生成物を配置する空間がありません');
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
    if (!naSpot) throw noRoom('ナトリウムを置く空間がありません');
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

/**
 * カルボン酸の -OH と、相手（アルコールの -OH ／ アミンの -NH）の H がとれて縮合する。
 * `site` は `[カルボン酸の C, 抜ける -OH の O, 相手の重原子（O または N）]`。
 *
 * ★ **エステル化とアミド化で、原子の動かし方は 1 か所も違わない**（水の抜き方も同じ）。
 * 違うのは `detect` が相手に何を許すかと、`caption` の言葉だけなので、
 * **ここを 2 本に写さない**（写すと片方だけ直る事故が起きる）。
 *
 * どちらの分子を動かすかは 3 段で決める（レビュー項目15）:
 *  ① 分子を選んでいるなら、**先に選んだ方（式の左）は動かさない**（C-1）
 *  ② 選んでいなければ**小さい方**を動かす。酢酸(4原子)＋エタノール(3原子) では
 *     従来どおりアルコール側が動くので、CH₃COOH + HOCH₂CH₃ の並びは変わらない
 *     （v347／C-2）。向きが入れ替わるのは、油脂のように**大きな多価アルコールへ
 *     酸を1本ずつ足していく**場合だけ。大きい方を動かすと置き場が見つからず、
 *     グリセリンの2本目・3本目のエステル化が「配置する空間がありません」で止まっていた
 *  ③ 決めた向きで置けなければ、反対向きも試す。できる結合は同じなので化学は変わらない
 */
function applyAcidCondensation(mol, site) {
    const [cId, ohOId, partnerId] = site;
    const partnerIds = [...componentOf(mol, partnerId)];
    const acidIds = [...componentOf(mol, cId)];
    const preferAcidMoves = firstSelectedIsIn(partnerIds) ||
        (!firstSelectedIsIn(acidIds) && acidIds.length < partnerIds.length);
    let plan = null;
    let swap = false;
    for (const tryAcid of (preferAcidMoves ? [true, false] : [false, true])) {
        plan = tryAcid
            ? planAttachment(mol, partnerId, cId, acidIds, [ohOId])
            : planAttachment(mol, cId, partnerId, partnerIds, [ohOId]);
        if (plan) { swap = tryAcid; break; }
    }
    if (!plan) throw noRoom('生成物を配置する空間がありません');
    mol.removeBond(cId, ohOId);
    applyAttachment(mol, swap ? acidIds : partnerIds, plan);
    mol.addBond(cId, partnerId, 1);
    parkAsWater(mol, ohOId);
    return [cId, partnerId];
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
 *
 * `prefer`（ラジアン。省略可）を渡すと、**その向きだけをいちばん先に試す**。
 * ハース投影の環に付ける -OH のように「縦に置かないと図の意味が変わる」ときに使う
 * （`haworthCleaveDirection`。⚠ **既定の順序は 1つも変えない** ＝ 他の反応の見た目は動かない）。
 */
function freeSpotAround(mol, atomId, reserved = [], prefer = null) {
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
            // 呼び出し側が向きを指定したら、それが最優先（指定が無ければ全員 1 で従来どおり）
            pref: (prefer !== null && Math.cos(ang - prefer) > 0.99) ? 0 : 1,
            straight: taken.some(t => t.x * Math.cos(ang) + t.y * Math.sin(ang) < -0.99) ? 1 : 0
        }))
        .sort((p, q) => (p.pref - q.pref) || (p.straight - q.straight))
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
 *
 * ⚠ **逃がした先もやはり一直線なら、動かさない**（v1455・C-7 の実測で見つけた1件）。
 * 直交の空きが2つとも別々の隣と一直線になる形（例: トレオニンの2級酸化。
 * -OH が右のメチルと一直線 → 折ると今度は上の主鎖と一直線）では、
 * どちらに置いても読みは同じで、**動かすと反応前の図との対応だけが崩れる**。
 * ＝ 得が無いときは元の図を保つ（発注の芯「反応の前後で形が対応する」）。
 */
function bendCarbonyl(mol, cId, oId) {
    const c = mol.atoms.find(a => a.id === cId);
    const o = mol.atoms.find(a => a.id === oId);
    if (!c || !o) return;
    const dirOf = a => {
        const dx = a.x - c.x, dy = a.y - c.y, len = Math.hypot(dx, dy);
        return len > 1e-6 ? { x: dx / len, y: dy / len } : null;
    };
    // その向きに =O を置くと、同じ炭素の別の重原子と正反対（cos ≒ -1）＝ 一直線になるか
    const straightAt = dir => dir && mol.getNeighbors(cId)
        .filter(n => n.atom.id !== oId && n.atom.element !== 'H')
        .some(n => {
            const d = dirOf(n.atom);
            return d && d.x * dir.x + d.y * dir.y < -0.99;
        });
    const od = dirOf(o);
    if (!od) return;
    if (!straightAt(od)) return;
    const spot = freeSpotAround(mol, cId);
    if (!spot) return;
    // 逃がした先も一直線なら得が無い（＝元の図のままにする）
    const len = Math.hypot(spot.x - c.x, spot.y - c.y);
    if (len < 1e-6) return;
    if (straightAt({ x: (spot.x - c.x) / len, y: (spot.y - c.y) / len })) return;
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

/**
 * その成分（movingIds）が、ほかの原子と重なっているか。
 * ⚠ **物差しは `separateComponent` と同じ**（升目の 0.65 倍）。別々に持つと
 *   「重なっていると言われたのに逃がす先が見つからない」が起こる。
 * ⚠ `separateComponent` は**必ず動かす向き**を返す（0 は返さない）ので、
 *   逃がす前にここで聞かないと、重なっていない図まで飛ぶ。
 */
function componentOverlaps(mol, movingIds) {
    const moving = new Set(movingIds);
    const statics = mol.atoms.filter(a => !moving.has(a.id) && a.element !== 'H');
    if (!statics.length || !movingIds.length) return false;
    const G = bondStep(mol, movingIds[0]);
    return movingIds.some(id => {
        const a = mol.atoms.find(x => x.id === id);
        if (!a || a.element === 'H') return false;
        return statics.some(s => Math.hypot(s.x - a.x, s.y - a.y) < G * 0.65);
    });
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
    throw noRoom('置換基を置く空間がありません');
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
    throw noRoom('アセチル基を置く空間がありません');
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
 * `'ok'`／`'ring'`／`'terminal'`（どれも実行する）／`'gone'`／`'triple'`／`'hetero'`（扱わない）。
 *
 * - `ring` … 環の中の C=C。**実行する**（§10.3-d の実測 ＋ §10.11-F の1位・2026-08-27 ユーザー決定）。
 *   環が開いて**1分子のまま**両端に官能基が付くので、`apply` は caption を言い分ける
 * - `terminal` … 端が =CH₂。**実行する**（§10.3-e ②・2026-08-27 ユーザー決定）。
 *   =CH₂ の側はギ酸を経て CO₂ と水になるので**図には残さない**（§10.3-b の原則）。
 *   ⚠ caption で**試薬を名指しし**、**ギ酸を経ること**を書かないと嘘になる（§10.3-e ②の推奨）
 * - `gone` … 両端とも =CH₂（＝ エチレンだけ）。切ると**分子が丸ごと消える**ので実行しない。
 *   ⚠ そもそも硫酸酸性 KMnO₄ で切った答えは資料のどこにも無く、
 *   **教科書も入試も「赤紫色が消える」で止めている**（§10.3-f）。案内で同じところに止める
 * - `triple` … C≡C の開裂。高校では扱いが安定しない
 * - `hetero` … 炭素と水素だけでできていない分子。他の官能基との**酸化されやすさの順序**を
 *   高校の範囲では決められない（アルコールの酸化に置いた線引きと同じ考え方）。
 *   ⚠ **環の中の C=C にも同じ門番が当たる**（2-シクロヘキセン-1-オンなど）——
 *   環かどうかより先に「炭化水素か」を見るようにした。鎖の `hetero` と扱いをそろえる
 */
function alkeneCleavageClass(mol, site) {
    const [id1, id2] = site;
    const bond = mol.getBond(id1, id2);
    if (!bond) return null;
    if (bond.type !== 2) return 'triple';
    // 分子（連結成分）が炭素と水素だけでできていること
    const comp = componentOf(mol, id1);
    if (![...comp].every(id => {
        const a = mol.atoms.find(x => x.id === id);
        return a && (a.element === 'C' || a.element === 'H');
    })) return 'hetero';
    const rings = ringAtomIdsOf(mol);
    const inRing = rings.has(id1) || rings.has(id2);
    const others = (id, other) => mol.getNeighbors(id)
        .filter(n => n.atom.element !== 'H' && n.atom.id !== other);
    const a = others(id1, id2), b = others(id2, id1);
    // 環の中では端（炭素0個）は起こらないので、以下は鎖の話
    if (a.length === 0 && b.length === 0) return 'gone';     // エチレンだけ
    if (a.length === 0 || b.length === 0) {
        const rest = a.length === 0 ? b : a;
        if (rest.length > 2) return 'hetero';
        // ⚠ **残る側が二重結合でつながっていたら行き先が割れる**（アレン）。
        //    ここを見ないと C に =O と =C が同時に付いて価標が5本になる
        if (!rest.every(n => n.type === 1)) return 'hetero';
        return 'terminal';
    }
    if (a.length > 2 || b.length > 2) return 'hetero';
    if (![...a, ...b].every(n => n.type === 1)) return 'hetero'; // 共役の内側は行き先が割れる
    return inRing ? 'ring' : 'ok';
}

/**
 * キャンバスの中のエチレン（C₂H₄）＝ **重原子が炭素2個だけで、C=C でつながった連結成分**。
 * 返り値は `[C, C]` の配列。⚠ ワッカー法が**エチレンだけ**を相手にするための門番。
 */
function ethyleneUnits(mol) {
    const seen = new Set();
    const out = [];
    mol.atoms.forEach(a => {
        if (a.element !== 'C' || seen.has(a.id)) return;
        const comp = [...componentOf(mol, a.id)]
            .filter(id => (mol.atoms.find(x => x.id === id) || {}).element !== 'H');
        comp.forEach(id => seen.add(id));
        if (comp.length !== 2) return;
        if (!comp.every(id => (mol.atoms.find(x => x.id === id) || {}).element === 'C')) return;
        const bond = mol.getBond(comp[0], comp[1]);
        if (!bond || bond.type !== 2) return;
        out.push([comp[0], comp[1]]);
    });
    return out;
}

/** 酸化開裂を実行できる C=C の一覧（`[id1, id2]` の配列） */
function oxidativeCleavageSites(mol) {
    return multipleBondSites(mol)
        .filter(s => ['ok', 'ring', 'terminal'].includes(alkeneCleavageClass(mol, s)));
}

/**
 * ベンジル位の炭素 `benzylId` から環の外へぶら下がる枝（**ベンジル炭素を含む**）を返す。
 * 側鎖として切り出せない形は `null`。
 *
 * ⚠ **「切り出せる」の中身が、側鎖酸化を炭素2個以上へ広げられるかの全部**（§10.3 決着）。
 * 落とすのは2つだけ:
 *  - **枝が環に届く**（ジフェニルメタン・テトラリン・アントラセン・インドール・
 *    シクロヘキシルベンゼン）… 出ていく側にもう1つ環がある、あるいは縮環していて
 *    そもそも「ぶら下がった枝」ではない。「残りは CO₂ などになって出ていく」が事実に反する。
 *    ⚠ 芳香環かどうかは見ない —— **芳香環は環の部分集合**なので、
 *    `ringAtomIdsOf` ひとつで足りる（門番を2つ置くと、片方を壊してもテストが赤くならない）
 *  - **枝が炭素と水素だけでできていない**（フェニルアラニン・フェニル酢酸・ケイ皮酸）…
 *    他の官能基との**酸化されやすさの順序**を高校の範囲で決められない
 *    （酸化開裂の `hetero` に置いた線引きと同じ）
 */
function benzylSideChain(mol, benzylId, ringId, rings) {
    const branch = new Set([benzylId]);
    const stack = [benzylId];
    while (stack.length) {
        const id = stack.pop();
        for (const n of mol.getNeighbors(id)) {
            const a = n.atom;
            if (a.id === ringId || branch.has(a.id)) continue;
            if (rings.has(a.id)) return null;
            if (a.element !== 'C' && a.element !== 'H') return null;
            branch.add(a.id);
            stack.push(a.id);
        }
    }
    return branch;
}

/**
 * 側鎖酸化の適用箇所の候補（等価なものをまとめる前）。
 * 返り値は `{ site: [ベンジル炭素, 環炭素], branch: 枝の原子ID集合 }` の配列。
 *
 * **環に直結していてベンジル位に水素がある炭化水素の側鎖**が対象。
 * 炭素1個（-CH₃・トルエン）でも炭素2個以上（エチルベンゼン・クメン・スチレン）でも
 * **生成物は環に直結した炭素だけが残った芳香族カルボン酸**で同じ（§10.3 決着・2026-08-26）。
 *
 * ⚠ 環に -OH / -NH₂ が付いた分子（フェノール類・芳香族アミン）は**環そのものが
 * 酸化されて壊れる**ので候補に出さない。側鎖だけを残した生成物は書けない。
 * ⚠ ベンジル位に水素が無ければ酸化されない（`tert`-ブチルベンゼン）。
 */
function sideChainOxidationCandidates(mol) {
    const aromatic = aromaticAtomSet(mol);
    if (aromatic.size === 0) return [];
    const rings = ringAtomIdsOf(mol);
    const found = [];
    aromatic.forEach(ringId => {
        const comp = componentOf(mol, ringId);
        if ([...aromatic].some(a => comp.has(a) && activatingSubstituent(mol, a, aromatic))) return;
        mol.getNeighbors(ringId).forEach(n => {
            if (aromatic.has(n.atom.id) || n.atom.element !== 'C' || n.type !== 1) return;
            if (mol.getFreeValency(n.atom.id) < 1) return; // ベンジル位に水素が無ければ酸化されない
            const branch = benzylSideChain(mol, n.atom.id, ringId, rings);
            if (!branch) return;
            found.push({ site: [n.atom.id, ringId], branch });
        });
    });
    // **並びは座標で決める**（C-2b。原子IDは乱数なので走査順に頼らない）
    return found
        .map(c => ({ c, a: mol.atoms.find(x => x.id === c.site[0]) }))
        .filter(x => x.a)
        .sort((p, q) => (q.a.x - p.a.x) || (p.a.y - q.a.y) || (p.c.site[0] < q.c.site[0] ? -1 : 1))
        .map(x => x.c);
}

/**
 * 芳香環の側鎖酸化（トルエン → 安息香酸／エチルベンゼン → 安息香酸）の
 * 適用箇所 `[ベンジル炭素, 環炭素]`。
 */
function sideChainOxidationSites(mol) {
    // **同じ生成物になる位置はまとめる**（RX8 と同じ考え方）。p-キシレンの2つの -CH₃ は等価
    const seen = new Set();
    return sideChainOxidationCandidates(mol).filter(c => {
        const key = sideChainProductKey(mol, c.site[0], c.branch);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map(c => c.site);
}

/**
 * 「その側鎖を -COOH に変えたら何になるか」を正準コードで表した鍵。
 * `aromaticSiteClass` と同じ手口で、**位相だけの複製に生成物を作って**比べる。
 * 座標は見ないので、等価な位置は必ず同じ鍵になる。成分の同一性を前に置いて、
 * **別の分子の等価な位置どうしを1つにまとめない**（第2段の落とし穴）。
 *
 * ⚠ 炭素2個以上の側鎖は**切り落としてから**鍵を作る。そうしないと
 * p-ジエチルベンゼンの2つのエチル基（どちらも 4-エチル安息香酸になる）が別物に見える。
 */
function sideChainProductKey(mol, benzylId, branch) {
    const comp = componentOf(mol, benzylId);
    const drop = new Set([...branch].filter(id => id !== benzylId));
    const probe = new Molecule();
    const map = new Map();
    mol.atoms.forEach(a => {
        if (comp.has(a.id) && !drop.has(a.id)) map.set(a.id, probe.addAtom(a.element, a.x, a.y).id);
    });
    mol.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) probe.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
    });
    const c = map.get(benzylId);
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
    // **側鎖酸化で図が変わる範囲の C=C は案内から外す**（§10.3 決着）。
    // スチレンの C=C は「末端だから切らない」ではなく、側鎖ごと酸化されて安息香酸になる ——
    // 実行できるボタンの横に「ここでは変えません」を並べると、どちらが起きるのか読めない
    const consumed = new Set();
    sideChainOxidationCandidates(mol).forEach(c => c.branch.forEach(id => consumed.add(id)));
    // ⚠ `ring` と `terminal` は **v1472 で実行へ移った**（§10.3-d／§10.3-e）ので案内から外れ、
    //    残るのは `gone`（両端とも =CH₂ ＝ **エチレンだけ**）1種類になった
    multipleBondSites(mol).forEach(s => {
        const cls = alkeneCleavageClass(mol, s);
        if (cls !== 'gone') return;
        if (s.every(id => consumed.has(id))) return;
        sites.push(s); kinds.add(cls);
    });
    return { sites, kinds };
}

/* ==========================================================================
 * 分子内脱水 → 酸無水物（§10.11-D #3・入試 563大問中53件・教科書 本文 p.184／p.157）
 *
 * ⚠ **逆の `hydrolysis_anhydride` だけが有る片道だった**（§10.11-E が名指しした形の穴）。
 * ★ 台帳が「側鎖酸化と続けて効く形が定番」と書いており、
 *   **o-キシレン → フタル酸（1段目・実装済み）→ 無水フタル酸（2段目・ここ）** がつながる。
 *
 * ★ **線の引き方**（判断できないものは出さない・DEVELOPMENT.md 4章）:
 *  - **できる環は5員・6員だけ**。2つのカルボキシ炭素をつなぐ骨格の最短経路が
 *    4原子（→5員）か5原子（→6員）のときだけ。⚠ シュウ酸（4員）・アジピン酸（7員）は外れる
 *  - **経路が環の中を通るなら、隣り合っている（オルト）ときだけ**。
 *    ⚠ これが無いと **イソフタル酸（メタ）が6員として通ってしまう**（実際には環にならない）
 *  - **カルボキシ基以外の官能基を持つ分子は扱わない**（`dehydration_intra` と同じ線）。
 *    ⚠ リンゴ酸・酒石酸・グルタミン酸のように、高校で行き先を決められないものを外す
 *  - ★ **C=C をまたぐときはシス形だけ**。⚠ **マレイン酸はなるが、フマル酸はならない** ——
 *    入試がいちばん問うのはここなので、`anti`（トランス）と「図から読めない」は
 *    実行せず `dehydration_anhydride_info` が理由を返す
 * ========================================================================== */

/** cA から cB への骨格の最短経路（`skipIds` は通らない）。[cA, …, cB]。届かなければ null */
function carboxylSkeletonPath(mol, cA, cB, skipIds) {
    const skip = new Set(skipIds);
    const prev = new Map([[cA, null]]);
    const queue = [cA];
    while (queue.length) {
        const id = queue.shift();
        if (id === cB) break;
        for (const n of mol.getNeighbors(id)) {
            if (n.atom.element === 'H' || skip.has(n.atom.id) || prev.has(n.atom.id)) continue;
            prev.set(n.atom.id, id);
            queue.push(n.atom.id);
        }
    }
    if (!prev.has(cB)) return null;
    const path = [];
    for (let id = cB; id != null; id = prev.get(id)) path.push(id);
    return path.reverse();
}

/**
 * 二重結合 p=q をはさんで、置換基 sp と sq が同じ側か。
 * `'syn'`（シス）／`'anti'`（トランス）／`null`（図が直線で読み取れない）。
 * ⚠ 座標は原則「見た目専用」だが、**C=C まわりの幾何だけは 2D 構造式が幾何異性を伝える
 *   標準的な手段**なので例外的に読む（chemistry.js `getDoubleBondGeometry` と同じ約束）。
 */
function doubleBondSideClass(mol, p, q, sp, sq) {
    const at = id => mol.atoms.find(x => x.id === id);
    const a = at(p), b = at(q), u = at(sp), v = at(sq);
    if (!a || !b || !u || !v) return null;
    const ax = b.x - a.x, ay = b.y - a.y;
    const axisLen = Math.hypot(ax, ay) || 1;
    const sideOf = (pt, origin) => {
        const sx = pt.x - origin.x, sy = pt.y - origin.y;
        const cross = ax * sy - ay * sx;
        const norm = cross / (axisLen * (Math.hypot(sx, sy) || 1));
        if (Math.abs(norm) < 0.1) return 0; // 直線描画（幾何が未確定）
        return Math.sign(cross);
    };
    const sa = sideOf(u, a), sb = sideOf(v, b);
    if (sa === 0 || sb === 0) return null;
    return sa === sb ? 'syn' : 'anti';
}

/** 架橋の O を置く場所。ring を素直に描ける点が無ければ null */
function anhydrideBridgeSpot(mol, cA, cB, path, ignoreIds) {
    const at = id => mol.atoms.find(x => x.id === id);
    const a = at(cA), b = at(cB);
    if (!a || !b) return null;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const half = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    const G = bondStep(mol, cA);
    // 経路の内側（両端を除く）の重心から離れる向きへ逃がす。重心が中点と重なる
    // （直鎖の二酸を一直線に描いた場合）ときは、軸の左右を空いているほうから試す
    const inner = path.slice(1, -1).map(at).filter(Boolean);
    let ux = 0, uy = 0;
    if (inner.length) {
        const cx = inner.reduce((s, p) => s + p.x, 0) / inner.length;
        const cy = inner.reduce((s, p) => s + p.y, 0) / inner.length;
        ux = mx - cx; uy = my - cy;
    }
    if (Math.hypot(ux, uy) < 1e-6) { ux = -(b.y - a.y); uy = b.x - a.x; } // 軸の法線
    const L = Math.hypot(ux, uy) || 1;
    ux /= L; uy /= L;
    // 正五角形に近い距離をまず狙い、詰まっていれば外へ広げる
    const base = Math.sqrt(Math.max(0, (G * 0.75) * (G * 0.75) - half * half));
    const cand = [];
    [base, G * 0.5, G * 0.75, G].forEach(d => {
        cand.push({ x: mx + ux * d, y: my + uy * d });
        if (d > 1e-6) cand.push({ x: mx - ux * d, y: my - uy * d });
    });
    const skip = new Set([cA, cB, ...ignoreIds]);
    const others = mol.atoms.filter(x => x.element !== 'H' && !skip.has(x.id));
    const clear = G * 0.6;
    for (const p of cand) {
        if (others.every(o => Math.hypot(o.x - p.x, o.y - p.y) > clear)) return p;
    }
    return null;
}

/**
 * 分子内脱水で酸無水物にできるカルボキシ基の組。
 * 返り値は `{ site: [cA, ohA, cB, ohB], geo }`。`geo` は `'ok'`（実行できる）／
 * `'anti'`（トランス。フマル酸）／`'unknown'`（図からシス/トランスが読めない）。
 */
function anhydrideDehydrationCandidates(mol) {
    const groups = findFunctionalGroups(mol);
    const carboxyls = groups.filter(g => g.type === 'carboxyl');
    const rings = ringAtomIdsOf(mol);
    const out = [];
    for (let i = 0; i < carboxyls.length; i++) {
        for (let j = i + 1; j < carboxyls.length; j++) {
            const A = carboxyls[i], B = carboxyls[j];
            const comp = componentOf(mol, A.atomIds[0]);
            if (!comp.has(B.atomIds[0])) continue;        // 分子内だけ
            // **カルボキシ基以外の官能基を持つ分子は扱わない**（行き先を決められない）。
            // ⚠ 骨格そのもの（芳香環・C=C）は官能基として数えない ——
            //    **マレイン酸の C=C を外すと、いちばん出る例が落ちる**。
            //    C=C の向きは下の `geo` が別に見る（シスだけ通す）
            const SKELETON = ['carboxyl', 'aromatic', 'cc_double'];
            const others = groups.filter(g => !SKELETON.includes(g.type) &&
                g.atomIds.some(id => comp.has(id)));
            if (others.length) continue;
            const oxy = [A.atomIds[1], A.atomIds[2], B.atomIds[1], B.atomIds[2]];
            const path = carboxylSkeletonPath(mol, A.atomIds[0], B.atomIds[0], oxy);
            if (!path || path.length < 4 || path.length > 5) continue;  // 5員・6員だけ
            const innerIds = path.slice(1, -1);
            // 経路が環の中を通るなら、隣り合っている（オルト）ときだけ
            if (innerIds.some(id => rings.has(id)) && path.length !== 4) continue;
            // C=C をまたぐなら**シス形だけ**（マレイン酸 ○ ／ フマル酸 ×）
            let geo = 'ok';
            for (let k = 0; k + 1 < path.length; k++) {
                const bond = mol.getBond(path[k], path[k + 1]);
                if (!bond || bond.type !== 2) continue;
                if (rings.has(path[k]) && rings.has(path[k + 1])) continue; // 環の中は回れない＝常にシス
                const cls = doubleBondSideClass(mol, path[k], path[k + 1], path[k - 1], path[k + 2]);
                geo = cls === 'syn' ? geo : (cls === 'anti' ? 'anti' : 'unknown');
                break;
            }
            out.push({
                site: [A.atomIds[0], A.atomIds[2], B.atomIds[0], B.atomIds[2]],
                path, geo
            });
        }
    }
    return out;
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
 * 付加重合の下ごしらえ: **頭の置換基を、主鎖と直交する向きへ立て直す**
 * （2026-08-26。スチレン3個以上が「配置する空間がありません」で必ず落ちていた件）。
 *
 * **なぜ要るか（実測）**: 鎖は R-tail₀-head₀-tail₁-… と繋がるので、次の単量体は
 * **頭の、尾と反対側**へ来る。呼び出した単量体は C=C まわりが ±120° に開いた形なので、
 * 頭の置換基は**鎖の伸びる向きから 60° しか離れていない**。単量体1つぶんの刻みは
 * 主鎖2結合ぶん＝84px しかないので、スチレンでは
 * **隣の単量体のベンゼン環どうしが 4.0px まで重なって置けなくなっていた**（実測）。
 *
 * ⚠ **二重結合が開いた時点で頭の炭素は sp3 になる**ので、±120° に開いておく理由はそこで消える。
 * 教科書の −[CH₂−CH(C₆H₅)]ₙ− も −[CH₂−CHCl]ₙ− も置換基を**主鎖と直交**に描く。
 *
 * ⚠ 置換基が2本以上ある頭（メタクリル酸メチル等）は**触らない** ―― どちらを回すかが一意でない。
 * ⚠ 回した結果、**分子の中で新たに詰まる**なら座標を戻す（`reshapeVinylAngles` と同じ約束）。
 * @param side +1 / -1 … 直交のどちら側へ出すか。単量体ごとに交互にすると教科書の図になる
 * @returns 回したら true
 */
function uprightChainSubstituent(mol, headId, tailId, side) {
    const head = mol.atoms.find(a => a.id === headId);
    const tail = mol.atoms.find(a => a.id === tailId);
    if (!head || !tail) return false;
    const subs = mol.getNeighbors(headId)
        .filter(n => n.atom.id !== tailId && n.atom.element !== 'H').map(n => n.atom);
    if (subs.length !== 1) return false;
    const G = bondStep(mol, headId);
    const MIN_CLEARANCE = G * 0.65;
    const L = Math.hypot(head.x - tail.x, head.y - tail.y) || 1;
    const ux = (head.x - tail.x) / L, uy = (head.y - tail.y) / L;
    const tx = head.x + ux * G, ty = head.y + uy * G;   // 次の単量体の尾が来る場所
    // ⚠ 見るのは**この単量体の中だけ**。ほかの単量体はこの後どうせ動かして繋ぐので、
    //    そこに居ることを理由に枝を回すと、塞がっていないのに図が変わる
    const comp = componentOf(mol, headId);
    const others = mol.atoms.filter(a => a.element !== 'H' && comp.has(a.id) &&
        a.id !== headId && a.id !== tailId);
    const clear = () => others.every(a => Math.hypot(a.x - tx, a.y - ty) >= MIN_CLEARANCE);
    // 枝（環も含めてまるごと）を、頭を軸に「主鎖と直交」へ回す
    const branch = [];
    {
        const seen = new Set([headId, tailId, subs[0].id]);
        const st = [subs[0].id];
        while (st.length) {
            const cur = st.pop();
            branch.push(cur);
            mol.getNeighbors(cur).forEach(n => {
                if (!seen.has(n.atom.id)) { seen.add(n.atom.id); st.push(n.atom.id); }
            });
        }
    }
    const saved = branch.map(id => { const a = mol.atoms.find(x => x.id === id); return { a, x: a.x, y: a.y }; });
    const a0 = Math.atan2(subs[0].y - head.y, subs[0].x - head.x);
    const a1 = Math.atan2(ux * side, -uy * side);       // 軸を ±90° 回した向き
    const ang = a1 - a0, c = Math.cos(ang), s = Math.sin(ang);
    saved.forEach(({ a, x, y }) => {
        const dx = x - head.x, dy = y - head.y;
        a.x = head.x + dx * c - dy * s;
        a.y = head.y + dx * s + dy * c;
    });
    // 回した結果、道が開いていて**分子の中で新たに詰まっていない**ことまで見て採用する
    const heavy = mol.atoms.filter(a => a.element !== 'H' && comp.has(a.id));
    const inBranch = new Set(branch);
    const squeezed = heavy.some(a => inBranch.has(a.id) && heavy.some(b =>
        b.id !== a.id && !inBranch.has(b.id) && Math.hypot(a.x - b.x, a.y - b.y) < MIN_CLEARANCE));
    if (!clear() || squeezed) {
        saved.forEach(({ a, x, y }) => { a.x = x; a.y = y; });
        return false;
    }
    return true;
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
    /* ★ **架橋は「別の鎖どうし」に限る**（2026-08-26。動画レーンの実測報告 §4-1）。
     * イソプレン×4 を1本の鎖に重合してから加硫を押すと、**同じ鎖の中で橋が架かって
     * ループになっていた**（実測: 返っていた3組すべてが同一成分。別の鎖どうしは0組）。
     * 硫黄は入るので分子式は増えるが、**「2本のゴムの鎖を橋でつなぐ」という加硫の絵にならない**。
     * 加硫の要点は鎖どうしを結んで三次元の網目を作ることなので、分子内のループは
     * 教材としてむしろ誤解のもと ―― 鎖が1本しか無いときは**ボタンを出さない**。
     * ⚠ 下の「中点に空きがあるか」は隣り合う C=C を落とすだけで、
     *   **鎖の端と端のように離れた同一鎖の組は素通りしていた**（それがこの症状の正体）。
     * ⚠ 押す手がかりは硫黄の瓶の `miss`（「鎖をもう1本作ってください」）が担う。
     *
     * ⚠ **「別の鎖」は連結成分では測れない**。1本目の架橋で2本の鎖は1分子になるが、
     *   加硫は続けて何本も橋を架けられる必要がある（硫黄を増やすとエボナイト）。
     *   そこで**硫黄を取り除いたときの成分**＝架橋する前の鎖を「鎖の身元」にする。 */
    const chainOf = (startId) => {                      // S を通らない連結成分
        const seen = new Set([startId]);
        const st = [startId];
        while (st.length) {
            const cur = st.pop();
            mol.getNeighbors(cur).forEach(n => {
                if (n.atom.element === 'S' || seen.has(n.atom.id)) return;
                seen.add(n.atom.id); st.push(n.atom.id);
            });
        }
        return seen;
    };
    const compKey = new Map();
    vinyls.forEach(v => {
        if (compKey.has(v.head)) return;
        const chain = chainOf(v.head);
        const key = [...chain].sort().join(',');
        vinyls.forEach(w => { if (chain.has(w.head)) compKey.set(w.head, key); });
    });
    const G = bondStep(mol);
    const MIN_CLEARANCE = G * 0.65;
    for (let i = 0; i < vinyls.length; i++) {
        for (let j = i + 1; j < vinyls.length; j++) {
            // **別の鎖どうし**のときだけ橋を架ける（上の注記）
            if (compKey.get(vinyls[i].head) === compKey.get(vinyls[j].head)) continue;
            /* 二重結合の両端どちらでも架橋しうるので4通り見るが、**返すのは1本だけ**
             * （v1467・DESIGN_reaction_execution.md §20）。4通りは「硫黄がどちらの炭素に
             * 付くか」が違うだけで、**site の4原子はまったく同じ**になる。同じ4原子の組を
             * 複数返すと、`Reactor.narrow` が「候補を分けている原子」を見つけられず
             * **箇所選びが永久に終わらない**（実測: 7候補 → クリック → 3候補 → 以下同じ）。
             * どちらの炭素に付くかは化学的に等価（どちらでも二重結合が単結合に移るだけ）
             * なので、**短い橋になるほう**を選んで1件にまとめる ―― 教科書の図に近く、
             * 「（N箇所）」の N も実際に選べる橋の本数と一致する。 */
            let best = null;
            [[vinyls[i].head, vinyls[i].tail], [vinyls[i].tail, vinyls[i].head]].forEach(([ca, ca2]) => {
                [[vinyls[j].head, vinyls[j].tail], [vinyls[j].tail, vinyls[j].head]].forEach(([cb, cb2]) => {
                    const A = mol.atoms.find(x => x.id === ca), B = mol.atoms.find(x => x.id === cb);
                    if (!A || !B) return;
                    /* ★ 橋は **-S-S-（硫黄2個）**（v1487・2026-08-31。ユーザーの指示）。
                     * 硫黄1個のときは席が1つ（中点）で済んだが、C-S-S-C は**結合3本**なので
                     * 席は **1/3 と 2/3 の点**の2つになる（中点は S-S 結合の真ん中で、原子は来ない）。 */
                    const seat = (t) => ({
                        x: Math.round((A.x + (B.x - A.x) * t) / G) * G,
                        y: Math.round((A.y + (B.y - A.y) * t) / G) * G
                    });
                    const s1 = seat(1 / 3), s2 = seat(2 / 3);
                    // ⚠ 近すぎる組は 1/3 と 2/3 が同じ格子点へ丸まる（足場が刻みの2本ぶんだと
                    //    0.67G と 1.33G がどちらも 1G になる）＝ 硫黄2個を置く場所が無い
                    if (Math.hypot(s1.x - s2.x, s1.y - s2.y) < MIN_CLEARANCE) return;
                    // 硫黄を置ける空きが**2席とも**あること。**同じ鎖の隣どうしはここで落ちる**
                    // （席が鎖の内部に来るため）＝小さな環ができるのを防いでいる
                    if (mol.atoms.some(o => o.element !== 'H' &&
                        (Math.hypot(o.x - s1.x, o.y - s1.y) < MIN_CLEARANCE ||
                            Math.hypot(o.x - s2.x, o.y - s2.y) < MIN_CLEARANCE))) return;
                    const cand = {
                        ca, ca2, cb, cb2,
                        s1x: s1.x, s1y: s1.y, s2x: s2.x, s2y: s2.y,
                        d: Math.hypot(A.x - B.x, A.y - B.y)
                    };
                    if (!best || cand.d < best.d) best = cand;
                });
            });
            if (best) out.push(best);
        }
    }
    // 近い組から順に（教科書の図のように短い橋をかける）
    out.sort((p, q) => p.d - q.d);
    return out;
}

/* ==========================================================================
 * ★★ ビニロン（PVA のアセタール化）—— `DESIGN_reaction_execution.md` §21-4 (e) の1本目
 *
 * **教科書**（数研『R5化学Vol.2』6編 p.254 式(5)(3)）:
 *   - ★ **PVA を3ユニットぶん実際に描く**（端は短い破線2本＋実線・`n` も角括弧も無し）
 *   - **隣り合う2つの -OH が O-CH₂-O の六員環アセタールになり、3つ目の -OH は残る**
 *   - ⚠ **割合の但し書きは本文にも脚注にも無い**。章末 p.268 問5(5) が同じ3ユニット構造を
 *     `[ ]ₙ` で囲んで質量計算をさせる ＝ **教科書は 2/3 を暗黙の理想化として固定している**
 *
 * ★ **1タップで 2/3 まで進めて終わり**（ユーザー判断 D-P5・2026-08-31）。
 * ⚠ **繰り返し押せる形にしない** —— 3ユニットずつ区切って先頭2つを橋渡しするので、
 *   押したあとに残る -OH は**どれも隣に相手がいない** ＝ `detect` が自然に空になる。
 *
 * ★ **橋の炭素はキャンバスのホルムアルデヒドから持ってくる**（瓶を増やさない）。
 *   HCHO の C が -CH₂- になり、**O は水になって離れる** ＝ 画面に出る水1分子が
 *   「アセタール化で水がとれた」証拠になる。⚠ 入口は `PARTNER_CANDIDATES` に
 *   `ホルムアルデヒド` を1行足すだけで立つ（`findPartnerHints` が試算して札を出す）。
 * ========================================================================== */

/** その炭素にぶら下がっている -OH の酸素 id（無ければ null）。エーテルの O は拾わない */
function hydroxylOxygenOf(mol, cId) {
    const a = mol.atoms.find(x => x.id === cId);
    if (!a || a.element !== 'C') return null;
    const hit = mol.getNeighbors(cId).find(n => {
        if (n.atom.element !== 'O') return null;
        const b = mol.getBond(cId, n.atom.id);
        if (!b || b.type !== 1) return false;
        // 重原子の隣が1つだけ ＝ まだ -OH（アセタール化すると2つになるので、ここで落ちる）
        return mol.getNeighbors(n.atom.id).filter(m => m.atom.element !== 'H').length === 1;
    });
    return hit ? hit.atom.id : null;
}

/** キャンバスにあるホルムアルデヒド（C=O の2原子だけの分子）を集める */
function formaldehydeMolecules(mol) {
    const out = [];
    const seen = new Set();
    mol.atoms.forEach(a => {
        if (a.element !== 'C' || seen.has(a.id)) return;
        const comp = componentOf(mol, a.id);
        comp.forEach(id => seen.add(id));
        const heavy = [...comp].map(id => mol.atoms.find(t => t.id === id))
            .filter(x => x && x.element !== 'H');
        if (heavy.length !== 2) return;
        const c = heavy.find(x => x.element === 'C');
        const o = heavy.find(x => x.element === 'O');
        if (!c || !o) return;
        const b = mol.getBond(c.id, o.id);
        if (!b || b.type !== 2) return;
        out.push({ c: c.id, o: o.id, x: c.x, y: c.y });
    });
    return out;
}

/**
 * アセタール化できる「隣り合う -OH の組」を鎖ごとに返す。
 *
 * 返り値は `[{ chain, groups: [{ oA, cA, oB, cB, cMid, hc, ho }] }]`。
 * ★ **鎖は R で端を止めたもの（重合の生成物）に限る**
 *   —— `vulcanizablePairs` の `inPolymer`（2070〜2085行）と同じ絞り方。
 *   単量体のジオール（エチレングリコール）にまでアセタールを架けない。
 * ★ **3ユニットずつ区切り、各区切りの先頭2つだけを組にする** ＝ 教科書の 2/3。
 * ⚠ **六員環になる並びだけ**（主鎖で炭素1つを挟む ＝ 主鎖の添字の差がちょうど2）。
 * ⚠ **橋にする HCHO が組の数だけ要る**（足りなければ何も返さない ＝ 半端に架けない）。
 */
function acetalizableDiols(mol) {
    const at = id => mol.atoms.find(x => x.id === id);
    const hchos = formaldehydeMolecules(mol);
    if (!hchos.length) return [];
    const out = [];
    const seen = new Set();
    mol.atoms.forEach(a => {
        if (a.element === 'H' || seen.has(a.id)) return;
        const comp = componentOf(mol, a.id);
        comp.forEach(id => seen.add(id));
        const rs = [...comp].filter(id => (at(id) || {}).element === 'R');
        if (rs.length !== 2) return;                     // 両端を R で止めた鎖だけ
        const path = carboxylSkeletonPath(mol, rs[0], rs[1], []);
        if (!path || path.length < 5) return;
        const idx = new Map(path.map((id, i) => [id, i]));
        // 主鎖の並び順に -OH 付きの炭素を拾う（原子IDの順には頼らない）
        const units = [];
        path.forEach(cid => { const o = hydroxylOxygenOf(mol, cid); if (o) units.push({ c: cid, o }); });
        const groups = [];
        for (let i = 0; i + 3 <= units.length; i += 3) {
            const A = units[i], B = units[i + 1];
            if (idx.get(B.c) - idx.get(A.c) !== 2) continue;   // 六員環にならない並びは組にしない
            const cMid = path[idx.get(A.c) + 1];
            groups.push({ oA: A.o, cA: A.c, oB: B.o, cB: B.c, cMid });
        }
        if (!groups.length) return;
        if (groups.length > hchos.length) return;        // ⚠ 半端に架けない（全部そろって初めて出す）
        // 橋にする HCHO を組ごとに1つずつ、近いものから割り当てる（使い回さない）
        const free = hchos.slice();
        groups.forEach(g => {
            const a1 = at(g.oA), b1 = at(g.oB);
            const mx = (a1.x + b1.x) / 2, my = (a1.y + b1.y) / 2;
            let bi = 0;
            free.forEach((h, k) => {
                if (Math.hypot(h.x - mx, h.y - my) < Math.hypot(free[bi].x - mx, free[bi].y - my)) bi = k;
            });
            const h = free.splice(bi, 1)[0];
            g.hc = h.c; g.ho = h.o;
        });
        out.push({ chain: comp, groups });
    });
    return out;
}

/**
 * アセタールの橋（-CH₂-）を置く場所。置けなければ null。
 *
 * 置き場は `anhydrideBridgeSpot`（1753行）と同じ考えで、
 * **環の内側（-OH をぶら下げている主鎖）の重心と反対向き**へ逃がす。
 *
 * ⚠⚠ **中点をそのまま使わない**（2026-08-31・実測して差し替えた）。PVA を素直に描くと
 * -OH の O は主鎖の真下に 42px 間隔で並ぶので、中点は格子点に落ちて
 * **六員環が 2×3 の長方形**にきれいに収まる —— が、**そこは主鎖の -CH₂- の
 * 自動水素が下向きに出る場所**で、橋の -CH₂- の自動水素と 11.5px まで近づく
 * （`tools/verify-compounds.js` の警告・実画面でも H の丸が重なって見えた）。
 * ★ **主鎖から結合1本ぶん離した位置を先に試す** ＝ 教科書 p.254 の絵と同じ
 * 「環が主鎖からぶら下がる」形になり、H も散る。
 */
function acetalBridgeSpot(mol, oAId, oBId, innerIds, ignoreIds) {
    const at = id => mol.atoms.find(x => x.id === id);
    const a = at(oAId), b = at(oBId);
    if (!a || !b) return null;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const G = bondStep(mol, oAId);
    const inner = (innerIds || []).map(at).filter(Boolean);
    let ux = 0, uy = 0;
    if (inner.length) {
        const cx = inner.reduce((s, p) => s + p.x, 0) / inner.length;
        const cy = inner.reduce((s, p) => s + p.y, 0) / inner.length;
        ux = mx - cx; uy = my - cy;
    }
    if (Math.hypot(ux, uy) < 1e-6) { ux = -(b.y - a.y); uy = b.x - a.x; }  // 軸の法線
    const L = Math.hypot(ux, uy) || 1;
    ux /= L; uy /= L;
    const cand = [];
    [G, G * 0.75, G * 0.5, 0].forEach(d => {
        cand.push({ x: mx + ux * d, y: my + uy * d });
        if (d > 1e-6) cand.push({ x: mx - ux * d, y: my - uy * d });
    });
    const skip = new Set([oAId, oBId, ...(ignoreIds || [])]);
    const others = mol.atoms.filter(x => x.element !== 'H' && !skip.has(x.id));
    const clear = G * 0.6;
    for (const p of cand) {
        if (others.every(o => Math.hypot(o.x - p.x, o.y - p.y) > clear)) return p;
    }
    return null;
}

/**
 * いまの分子を1コマ写す（`Reactor.snapshotMolecule` と同じ形）。
 * ★ 反応の途中経過を**1組ずつ順に見せる**ために `apply` が使う（`morphSequence`）。
 */
function snapshotFrame(mol) {
    return {
        atoms: mol.atoms.map(a => ({ id: a.id, element: a.element, x: a.x, y: a.y, charge: a.charge || 0 })),
        bonds: mol.bonds.map(b => ({ atomId1: b.atomId1, atomId2: b.atomId2, type: b.type }))
    };
}

/* ==========================================================================
 * ★★ 開環重合（ε-カプロラクタム → ナイロン6）—— `DESIGN_reaction_execution.md`
 *     §21-4 (e) の2本目（入試 44件）
 *
 * **教科書**（数研『R5化学Vol.2』6編 p.251 式(2)）:
 *   - 単量体は**横長の「潰した環」**（左端の頂点に H₂C・上枝 -CH₂-CH₂-NH・
 *     下枝 -CH₂-CH₂-C=O・右端で NH と C=O を縦1本線で閉環）
 *   - 重合体は `-[N(H)-(CH₂)₅-C(=O)]-ₙ`。★ **副生成物なし**
 *   - ⭐ **直前の式(1) がナイロン66**（`n+n → [ ]ₙ + 2n H₂O`）で、
 *     **脱水の有無を並べて比較できる配置**になっている
 *     → ★ **その対比は caption で言う**（画面に2つの式を並べる仕掛けは足さない）
 *
 * ⚠⚠ **ここが 4本のうち唯一「新しい作図routine」を要る1本**（P-c）。
 * §21-1 (f) の実測: 環を開いても**座標は七角形の弧のまま**で、
 * `planAttachment` の 4方向 × 4回転 = **16通りすべてで置けない**
 * （最良 17.5px／要求 25.5px）。⚠ **傍観分子をどかす道も効かない**
 * （邪魔者そのものが相手の環 ＝ `bystanderIds` が空になる）。
 * ★ したがって **`planAttachment` を呼ばず、ほどいた鎖を一直線に描き直す**。
 * ========================================================================== */

/**
 * ラクタム（環の中に -CO-NH- を持つ環状アミド）の単量体を、**同じものどうしまとめて**返す。
 *
 * 返り値は `[[{ n, c, o, ring, comp, x }, …], …]`（2個以上そろった組だけ）。
 * ★ **絞り方は「環 ＋ カルボニルの O だけ」**——
 *   ⚠ 置換基のあるラクタムは扱わない（開いた先の鎖の描き方が一意に決まらない）。
 *   ⚠ アセトアニリド（環の**外**のアミド）は環に N が無いので落ちる。
 *   ⚠ 環に N が2つ以上あるもの（ピペラジンジオン等）も落とす（どこで開くかが決まらない）。
 * ★ **並べる順は画面の並び**（コンポーネントの左端の x）。既存の重合3本と同じ約束。
 */
function lactamUnits(mol) {
    const ring = ringAtomIdsOf(mol);
    const at = id => mol.atoms.find(x => x.id === id);
    const groups = new Map();
    const seen = new Set();
    mol.atoms.forEach(a => {
        if (a.element === 'H' || seen.has(a.id)) return;
        const comp = componentOf(mol, a.id);
        comp.forEach(id => seen.add(id));
        const heavy = [...comp].map(at).filter(x => x && x.element !== 'H');
        // 環の外にある重原子は「カルボニルの O」1つだけ
        const outside = heavy.filter(x => !ring.has(x.id));
        if (outside.length !== 1 || outside[0].element !== 'O') return;
        const o = outside[0];
        const ob = mol.getNeighbors(o.id).filter(n => n.atom.element !== 'H');
        if (ob.length !== 1 || ob[0].type !== 2 || ob[0].atom.element !== 'C') return;
        const cId = ob[0].atom.id;                       // カルボニル炭素（環の中）
        if (!ring.has(cId)) return;
        const inRing = heavy.filter(x => ring.has(x.id));
        if (inRing.length < 5) return;                   // 4員環以下は高校で扱わない
        if (inRing.some(x => x.element !== 'C' && x.element !== 'N')) return;
        const ns = inRing.filter(x => x.element === 'N');
        if (ns.length !== 1) return;
        const nId = ns[0].id;
        const amide = mol.getBond(nId, cId);
        if (!amide || amide.type !== 1) return;          // N と C=O が環の中で直に結合
        // ⚠ 環に多重結合が残っていない（素直な飽和ラクタムだけ）
        const ids = new Set(inRing.map(x => x.id));
        if (mol.bonds.some(b => ids.has(b.atomId1) && ids.has(b.atomId2) && b.type !== 1)) return;
        const code = componentCode(mol, a.id);
        if (!groups.has(code)) groups.set(code, []);
        groups.get(code).push({
            n: nId, c: cId, o: o.id, comp,
            x: Math.min(...heavy.map(p => p.x))
        });
    });
    const out = [];
    groups.forEach(list => {
        if (list.length < 2) return;
        list.sort((p, q) => p.x - q.x);                  // 画面の並びのまま繋ぐ
        out.push(list);
    });
    return out;
}

/**
 * ★★ **P-c: 開いた環を、一直線の鎖に描き直す。**
 *
 * `backbone`（主鎖の原子 id を繋がる順に並べたもの）を刻み `G` の横一列に置き、
 * `pendants`（主鎖の原子 id → その上にぶら下げる原子 id）を**真上**へ置く
 * （＝ ナイロン66・PET の登録図とまったく同じ描き方。=O が y-G の一列に並ぶ）。
 *
 * ⚠ **置き場は探す**。関わらない分子（水・別の化合物）と重ならない縦位置を、
 *   もとの高さから上下へ1刻みずつ広げて探す。見つからなければ null を返す
 *   （呼ぶ側が `noRoom` に落とす）。
 *
 * @returns `{ x0, y0 }`（左端の主鎖原子の座標）または null
 */
function straightChainSpot(mol, backbone, pendants, G) {
    const at = id => mol.atoms.find(x => x.id === id);
    const own = new Set(backbone);
    pendants.forEach((list) => list.forEach(id => own.add(id)));
    const others = mol.atoms.filter(x => x.element !== 'H' && !own.has(x.id));
    const pts = backbone.map(at).filter(Boolean);
    const x0 = Math.round(Math.min(...pts.map(p => p.x)));
    const baseY = Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length);
    const clear = G * 0.65;
    // もとの高さ → 下へ1刻み → 上へ1刻み …（8刻みまで）
    const offsets = [0];
    for (let k = 1; k <= 8; k++) offsets.push(k * G, -k * G);
    for (const dy of offsets) {
        const y0 = baseY + dy;
        const spots = [];
        backbone.forEach((id, i) => {
            spots.push({ x: x0 + i * G, y: y0 });
            (pendants.get(id) || []).forEach(() => spots.push({ x: x0 + i * G, y: y0 - G }));
        });
        // ⚠ 両端に付く R のぶんも先に見ておく（後から置けないと端だけ印が欠ける）
        spots.push({ x: x0 - G, y: y0 }, { x: x0 + backbone.length * G, y: y0 });
        if (spots.every(s => others.every(o => Math.hypot(o.x - s.x, o.y - s.y) > clear))) {
            return { x0, y0 };
        }
    }
    return null;
}

/**
 * 加硫の1本目の橋を架ける前に、**相手の鎖を真下（または真上）へ寄せて「＝」に並べる**
 * （v1484・2026-08-31。動画レーン V130 の収録映像から出た要望2件）。
 *
 * ★ **なぜ要るか（実測。推測ではない）** —— 台本どおり
 * 「イソプレン×2 → 1,4-付加重合 → イソプレン×2 → 1,4-付加重合 → 加硫」を回すと、
 * 2本の鎖は **x=[232..568] と x=[610..946]・y は 67px 重なる**、つまり
 * **左右に一直線に並ぶ**。まとめた y の標準偏差は 39.7px ＝ 結合1本ぶんしかない。
 * すると橋の足場になる C=C どうしが **357px（結合の 8.5本ぶん）**離れ、
 * 硫黄はその中点に落ちるので **S-C の結合線が 167〜190px（刻みの 4.5倍）**になる。
 * その線は水平に伸びるので、
 *   - **鎖の主鎖の炭素の上を通る**（実測 0.0〜0.3px ＝ 完全に重なる）
 *   - **両端の R をかすめる**（実測 2.1px・2.7px。単量体を変えても 0.6〜3.3px）
 * ＝ 画では **「S が鎖の途中に埋まっていて、R から生えている」**ように読める。
 * ⚠ **S が R に結合したことは一度も無い**（5通り・橋10本で 0本。§20-5 の否定対照に追加）。
 * 起きていたのは**線が R の上を通る**ことで、直すべきは箇所選びではなく**置き場所**だった。
 *
 * ★ **教科書の描き方**（数研『R5化学Vol.2』6編）:
 *   - **p.260 式(11)「架橋構造のポリスチレン」** … 主鎖を**上下2段の横並び**に描き、
 *     架橋（p-ジビニルベンゼン由来の環）を**その間に縦に**渡す。⚠ 端は `R` ではなく素の「—」で、
 *     **橋は必ず鎖の途中から出ている**
 *   - **p.263 図22「硫黄による架橋構造」** … 波線の鎖を層に重ね、`-S-S-` を**隣り合う鎖のあいだに短く**渡す
 * ＝ どちらも「**2本を上下に置いて、その間に短い橋**」。この関数はその形に寄せる。
 *
 * ⚠ **`planAttachment` には触らない**（他の46本の反応が全部使う共通の道具で、
 * しかも「結合1本ぶんの距離に置く」ためのもの。加硫は**間に硫黄2個を挟む＝3本ぶん**離す）。
 * 加硫だけの置き方をここに1つ足す。
 *
 * ⚠ **動かすのは剛体平行移動だけ**（回転も伸縮も鏡映もしない）＝ 幾何は変わらないので
 * 「整形で幾何が変わるなら座標を戻す」の約束を満たす。
 * ⚠ **すでに橋が架かって1分子になっているときは動かさない**（動かすと1本目の橋が伸びる）。
 * ⚠ **置けなければ座標を1つも変えずに false を返す** ＝ 今までの絵に戻るだけ。
 *
 * 行き先の決め方: 硫黄2個の席 s1・s2 を「ca の真下（真上）に **1歩・2歩** 進んだ格子点」に取り、
 * cb を **3歩目の格子点**へ運ぶ。こうすると `vulcanizablePairs` が硫黄を置く
 * `round(1/3 の点/G)*G`・`round(2/3 の点/G)*G` が s1・s2 そのものになるので、
 * **C—S—S—C が一直線**になる（席を格子へ丸めた分だけ橋が折れる、という副作用が出ない）。
 * ⚠ **硫黄1個だった v1484 までは 2歩**（中点1つ）。**v1487 で 3歩**になった ―― 実際の架橋は
 * モノ／ジ／ポリスルフィドとさまざまで、その代表としてジ（-S-S-）を描くことにしたため。
 */
function stackChainsForBridge(mol, caId, cbId) {
    const ca = mol.atoms.find(a => a.id === caId);
    const cb = mol.atoms.find(a => a.id === cbId);
    if (!ca || !cb) return false;
    const moving = componentOf(mol, cbId);
    if (moving.has(caId)) return false;              // もう1分子＝動かすと架けた橋が壊れる
    const G = bondStep(mol);
    if (!(G > 1)) return false;
    const MIN_CLEARANCE = G * 0.65;
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    const movingAll = mol.atoms.filter(a => moving.has(a.id));
    const movingHeavy = heavy.filter(a => moving.has(a.id));
    const staticHeavy = heavy.filter(a => !moving.has(a.id));
    if (!movingHeavy.length || !staticHeavy.length) return false;
    const movingIds = new Set(movingAll.map(a => a.id));
    const innerBonds = mol.bonds.filter(b => movingIds.has(b.atomId1) && movingIds.has(b.atomId2));
    const staticBonds = mol.bonds.filter(b => !movingIds.has(b.atomId1) && !movingIds.has(b.atomId2));
    const pos = new Map(mol.atoms.map(a => [a.id, { x: a.x, y: a.y }]));
    // 下 → 上 の順。近い段（1歩）から試し、だめなら1段外へ
    for (const k of [1, 2]) {
        for (const sign of [1, -1]) {
            /* ★ 硫黄2個ぶん離す（v1487）。C-S-S-C は**結合3本**なので、ca と cb は
             * **刻みの 3k 倍**だけ離れる（硫黄1個だった v1484 までは 2k 倍）。
             * 席 s1・s2 を「ca の真下（真上）に並ぶ**格子点**」に取り、cb をその先の格子点へ運ぶと、
             * `vulcanizablePairs` が丸める 1/3・2/3 の点が s1・s2 そのものになり、
             * **C-S-S-C が一直線**になる（丸めた分だけ橋が折れる、という副作用が出ない）。 */
            const mx = Math.round(ca.x / G) * G;
            const by = Math.round(ca.y / G) * G;
            const s1 = { x: mx, y: by + sign * k * G };
            const s2 = { x: mx, y: by + sign * 2 * k * G };
            const dx = mx - cb.x;
            const dy = (by + sign * 3 * k * G) - cb.y;
            const at = (a) => ({ x: a.x + dx, y: a.y + dy });
            // ① 原子どうしが詰まらない ② 硫黄の席（s1・s2）が**2つとも**空いている
            const okAtoms = movingHeavy.every(a => {
                const p = at(a);
                return staticHeavy.every(s => Math.hypot(s.x - p.x, s.y - p.y) >= MIN_CLEARANCE);
            });
            if (!okAtoms) continue;
            const spotFree = [s1, s2].every(m =>
                staticHeavy.every(s => Math.hypot(s.x - m.x, s.y - m.y) >= MIN_CLEARANCE) &&
                movingHeavy.every(a => { const p = at(a); return Math.hypot(p.x - m.x, p.y - m.y) >= MIN_CLEARANCE; }));
            if (!spotFree) continue;
            // ③ 結合線が相手の原子を貫通しない（線が原子の上を通ると構造式が別物に見える）
            const pierce = innerBonds.some(b => {
                const s = at(pos.get(b.atomId1)), e = at(pos.get(b.atomId2));
                return staticHeavy.some(q => pointSegmentDistance(q, s, e) < SHOVE_LINE_CLEARANCE);
            }) || staticBonds.some(b => {
                const s = pos.get(b.atomId1), e = pos.get(b.atomId2);
                return movingHeavy.some(q => pointSegmentDistance(at(q), s, e) < SHOVE_LINE_CLEARANCE);
            });
            if (pierce) continue;
            movingAll.forEach(a => { a.x += dx; a.y += dy; });
            return true;
        }
    }
    return false;
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
 * 鎖が伸びる向きを直交4方向に丸めて返す（v1436・DESIGN_reaction_execution.md §14）。
 * `backId`（主鎖の1つ内側）→ `fromId`（いまの端）の向き。返り値は {x, y}（±1 と 0）。
 *
 * **重合の生成物を一直線にするためだけの道具**で、手で描いた分子には触れない。
 * 斜めに描かれていても長いほうの軸へ丸めるので、返るのは必ず直交の向き
 * （直交作図の規約はそのまま＝ CLAUDE.md の例外を増やさない）。
 */
function chainDirection(mol, backId, fromId) {
    const a = mol.atoms.find(x => x.id === backId);
    const b = mol.atoms.find(x => x.id === fromId);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return null;
    return Math.abs(dx) >= Math.abs(dy)
        ? { x: dx > 0 ? 1 : -1, y: 0 }
        : { x: 0, y: dy > 0 ? 1 : -1 };
}

/**
 * 「この先も同じ単位が続く」印として R（価標1の擬似元素）を付ける。
 * 空いている直交方向のうち、他の原子と近づかない位置を選ぶ。置けなければ null
 *
 * `prefer`（{x, y}）を渡すとその向きを**最初に**試す（v1436・§14）。R は
 * 「この先も鎖が続く」印なので、鎖の続きの位置に出ないと端だけ折れ曲がって見える
 * （実測: ポリ塩化ビニル・ポリアセチレンは本体が一直線でも端の R だけ 90° 折れていた）。
 * 置けなければ従来の順へ落ちるだけなので、置ける場所が減ることはない。
 */
function attachR(mol, atomId, prefer) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a || mol.getFreeValency(atomId) < 1) return null;
    const G = bondStep(mol, atomId);
    const MIN_CLEARANCE = G * 0.65;
    const base = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -Math.PI / 4,
                  3 * Math.PI / 4, -3 * Math.PI / 4];
    const dirs = prefer ? [Math.atan2(prefer.y, prefer.x), ...base] : base;
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
 * 鎖の両端に R を付け、**R と「R を付けた原子」の両方**の id を返す（v1481・動画レーン §9）。
 *
 * ⚠⚠ **`attachR` を直に呼ばないこと。** 直に呼ぶと返るのは R の id だけなので、
 * `changed` に R しか入らない ＝ **R が生えている端の炭素にだけ印が付かない**。
 * ユーザーが V120 の完成品で見つけた症状がこれ:
 *   > **「両端のC原子のみマーカーなし。Rの関係かもしれないが、実際には差が無いのですべてマーカーすべき」**
 *
 * ★ 端の原子も中の原子と同じだけ変わっている —— 付加重合なら二重結合が開いて結合が1本増え、
 *   縮合重合なら **-OH が落ちて R に置き換わっている**（むしろ変化は大きい）。
 * ⚠ **位置が鎖の両端＝いちばん目が行く所**なので、「端だけ何か違う」と読めて
 *   R の意味（この先も続く）と混ざる。
 *
 * ⚠ **重合4種が同じ抜け方をしていた**（付加・ポリアセチレン・ジエン・縮合）。
 * ★ 1か所ずつ手で足すと**次に重合を1種類足した人がまた忘れる**ので、ここで束ねる。
 *
 * @param ends `[原子id, 向きの好み]` の配列
 * @returns 付けた R と、その付け先の原子 id（R が置けなかった端も、原子のほうは必ず返す）
 */
function attachREnds(mol, ends) {
    const out = [];
    ends.forEach(([atomId, prefer]) => {
        // ⚠ R が置けなくても原子のほうは必ず入れる（結合の変化は既に起きている）
        out.push(atomId);
        const r = attachR(mol, atomId, prefer);
        if (r) out.push(r);
    });
    return out;
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
        if (!spot) throw noRoom('付加する原子を置く空間がありません');
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
 * ⚠ ルール側の `reagentId` は**文字列でも文字列の配列でもよい**（v1428・同書 §12）。
 * 同じ反応が複数の瓶からできることがあるため（KMnO₄ と K₂Cr₂O₇ はどちらも同じものを酸化する）。
 * **比較は必ず `ruleUsesReagent()` を通す** —— `rule.reagentId === reagent.id` と直に書くと、
 * 配列の側が黙って1本ぶんも当たらなくなる（瓶が死に、空振りの説明だけが返る）。
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
/* `?reagent=` の古い id → いまの瓶（v1428）。
 * 瓶を割ったり改名したりしたら**ここに1行足す**（外に出たリンクを空振りにしない）。
 * ⚠ 画面にもデータにも影響しない。効くのは URL の解決だけ。 */
const REAGENT_ALIASES = { oxidant: 'kmno4' };

// ルールが繋がっている瓶の id を配列で返す（`reagentId` は文字列でも配列でもよい・v1428）
function ruleReagentIds(rule) {
    if (!rule || !rule.reagentId) return [];
    return Array.isArray(rule.reagentId) ? rule.reagentId : [rule.reagentId];
}
// このルールはこの瓶から起こせるか。**reagentId の比較はすべてここを通す**
function ruleUsesReagent(rule, reagentId) {
    return ruleReagentIds(rule).includes(reagentId);
}

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

/* 酸化剤の瓶は **KMnO₄ と K₂Cr₂O₇ の2本**（DESIGN_reagent_palette.md §12・v1428）。
 *
 * ⚠ **なぜ分けたか** … 瓶の役割は「**試薬名を知る**」ことだから（ユーザー・2026-08-20）。
 *   「単に酸化反応を見るなら試薬ではなく、酸化反応から」＝ `[O]` が居るべき場所は
 *   **反応カードのほう**で、`oxidize_primary` の `label`（`酸化 [O] → アルデヒド`）はそのまま残す。
 *   瓶が `[O]` を名乗っていたことが、2つの入口（瓶／反応カード）の役割を混ぜていた。
 *
 * ⚠ **行き先を決めているのは試薬名ではなく条件**（§12-2）。K₂Cr₂O₇ でも激しく酸化すれば
 *   カルボン酸まで行くし、入試は「穏やかに酸化した／激しく酸化した」と問題文に明示する。
 *   だから**どちらの瓶にも同じルールをぶら下げ**、1級アルコールでは §11 の `condition` で訊く。
 *   瓶ごとに違うのは「ふつうどちらを使うか」（`usually`）だけ ＝ `apply` に分岐は1つも入らない。
 */
const OXIDANT_REAGENT_IDS = ['kmno4', 'k2cr2o7'];
// 2本に共通の説明（どちらも同じものに効く。違うのは強さの既定と、ふつうどちらを使うか）
const OXIDANT_ACTS = '1級・2級アルコールとアルデヒド、芳香族の側鎖（環に直結した -CH₃）、' +
    '炭化水素の C=C（酸化開裂）です';
const OXIDANT_MISS = 'ケトンやカルボン酸は、これ以上は酸化されにくい構造です。' +
    '酸化剤の瓶が2本あるのは行き先が違うからではなく、**試薬の名前を覚えるため**です。' +
    '同じものに効き、1級アルコールでは「穏やかに／激しく」を選ぶ画面が出ます。';

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
    /* 酸化剤は2本。**並べて置く**（同じものに効き、違うのは名前と「ふつうどちら」だけ ——
     * 隣り合っていないと画面で比べられない）。v1426 まではここに `oxidant`（`[O]`）1本だった */
    {
        id: 'kmno4',
        name: '過マンガン酸カリウム',
        formula: 'KMnO₄',
        kind: 'transform',
        acts: OXIDANT_ACTS,
        miss: OXIDANT_MISS
    },
    {
        id: 'k2cr2o7',
        name: '二クロム酸カリウム',
        formula: 'K₂Cr₂O₇',
        kind: 'transform',
        acts: OXIDANT_ACTS,
        miss: OXIDANT_MISS
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
        acts: 'C=C や C≡C の不飽和結合（ニッケルや白金を触媒に加熱）と、芳香環についたニトロ基（還元されてアミノ基になります）です',
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
        /* ★ ワッカー法の瓶（§10.11-D #27・§10.3-f C-3・v1472）。
         * ⚠ **瓶が1本増える**（22 → 23本）。§10.9 は「足すなら先に区分をもう一段割る」と
         *   申し送っているが、★ **区分を割らずに1本だけ足す**ほうを選んだ:
         *   - 区分割りは試薬パレット側の設計（`DESIGN_reagent_palette.md`）で、
         *     反応レーンが片手間に決める話ではない
         *   - ⚠ この瓶は**エチレン専用**で、他の分子では必ず空振りする ＝ 区分が増える
         *     たぐいの瓶ではない（既存の「変えるもの」の末尾に並ぶだけ）
         * ★ 申し送り: CO₂ の瓶（§10.9）を足すときは、**そこで区分割りを決めること**。 */
        id: 'o2_pdcl2',
        name: '酸素・PdCl₂/CuCl₂',
        formula: 'O₂',
        kind: 'transform',
        acts: 'エチレンです（酸化されてアセトアルデヒドになります）',
        miss: 'この瓶はエチレンからアセトアルデヒドを作る工業的製法のためのものです。' +
            '高校で扱うのはエチレンの場合だけなので、ほかの分子では何も起こしません。'
    },
    {
        id: 'sulfur',
        name: '硫黄',
        formula: 'S',
        kind: 'transform',
        acts: '重合でできたゴムの鎖に残っている C=C です（加硫）',
        // ⚠ **「鎖が1本しかない」も空振りの理由になる**（2026-08-26）。加硫は
        //    2本の鎖のあいだに橋を架ける反応なので、1本の鎖の中でループを作らせない
        //    （`vulcanizablePairs` の注記）。押した人が次に何をすればよいかをここで言う
        miss: '単量体やふつうのアルケンは加硫の相手にしません。先に 1,4-付加重合で鎖を作ってください。' +
            '鎖が1本だけのときも架橋できません（加硫は**2本の鎖のあいだ**に硫黄の橋を架ける反応です）。' +
            'もう一度 単量体を並べて 1,4-付加重合し、鎖を2本にしてから硫黄を加えてください。'
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
        // ⚠ **反応カードの表記は `[O]` のまま**（§12-1）。瓶が試薬名を担うようになったぶん、
        //    「反応そのものを見る」入口である反応カードには `[O]` を残す
        label: '酸化 [O] → アルデヒド',
        reagentId: OXIDANT_REAGENT_IDS,
        // 1級アルコールの行き先は**条件**で割れる（§12-2）。§11 の仕組みをそのまま使う
        condition: {
            key: 'mild', label: '穏やかに酸化',
            needs: '-OH のついた炭素に水素が残っている1級アルコール（R-CH₂-OH）が要ります'
        },
        // 「効くが、ふつうはそちらを使わない」を言う欄（§12-3）。**`miss`（効かない）とは別の棚**
        usually: {
            reagentId: 'k2cr2o7',
            note: '一般的には、アルデヒドで止めたいときは二クロム酸カリウムのような穏やかな酸化剤を使います。' +
                '過マンガン酸カリウムは酸化力が強く、そのままにするとカルボン酸まで進んでしまうためです。'
        },
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
                caption: '酸化されてアルデヒドになりました（R-CH₂-OH + [O] → R-CHO + H₂O）。アルデヒドはさらに酸化されるとカルボン酸になります。銀鏡反応・フェーリング液の還元を示すのはこの構造です。' +
                    '入試では「穏やかに酸化した」と問題文に書かれ、ここで止めることを指示されます。',
                changed: [oId, cId]
            };
        }
    },
    {
        /* 1級アルコールを**一気に**カルボン酸まで（§12-2・v1428）。
         *
         * ⚠ これは「新しい化学」ではなく、**いままで画面に出せていなかった分かれ道**である。
         *   `oxidize_primary`（→ アルデヒド）と `oxidize_aldehyde`（アルデヒド → カルボン酸）は
         *   前からあったが、**エタノールに酸化剤を掛けた人には後者の detect が通らない**ので、
         *   「激しく酸化するとどうなるか」を選ぶ道が無かった（§11 の濃硫酸とまったく同じ形の穴）。
         *
         * `detect` は `oxidize_primary` と同じ場所を返すが、**空きを1つ多く要求する**
         * （C=O にしたうえで -OH をもう1本生やすため）。 */
        id: 'oxidize_primary_vigorous',
        // ⚠ **`oxidize_aldehyde` の見出し（`酸化 [O] → カルボン酸`）を頭に含めない。**
        //    RG4 / RG6 は「自動案内の見出しで始まるか」で瓶と自動案内を突き合わせるので、
        //    片方がもう片方の接頭辞になると**別の反応どうしが同じものに見える**（実測で RG6 が落ちた）
        label: '酸化 [O] → 一気にカルボン酸まで（1級アルコール）',
        reagentId: OXIDANT_REAGENT_IDS,
        condition: {
            key: 'vigorous', label: '激しく酸化',
            needs: '-OH のついた炭素に水素が2つ残っている1級アルコール（R-CH₂-OH）が要ります' +
                '（アルデヒドから先へ進めるだけなら「酸化 [O] → カルボン酸」がそのまま使えます）'
        },
        usually: {
            reagentId: 'kmno4',
            note: '一般的には、カルボン酸まで進めたいときは過マンガン酸カリウムを使います。' +
                '二クロム酸カリウムでも激しく酸化すれば同じところまで行きますが、' +
                '酸化力が強いほうが途中のアルデヒドで止まらずに進みきるためです。'
        },
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            return groups
                .filter(g => g.type === 'alcohol1' || g.type === 'alcohol0')
                // C=O にしてさらに -OH を付けるので、空き価標が2つ要る
                .filter(g => mol.getFreeValency(g.atomIds[1]) >= 2)
                .filter(g => alcoholOxidationAllowed(mol, groups, g.atomIds[0]))
                .map(g => g.atomIds); // [OのID, CのID]
        },
        apply(game, site) {
            const [oId, cId] = site;
            const mol = game.userMolecule;
            // 置き場を**先に**確かめる（途中で失敗して C=O だけの中途半端な形を残さない）
            const spot = freeSpotAround(mol, cId);
            if (!spot) throw noRoom('-OH を置く空間がありません');
            mol.getBond(oId, cId).type = 2;
            bendCarbonyl(mol, cId, oId);
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(cId, o.id, 1);
            return {
                caption: '1級アルコールが一気に酸化されてカルボン酸になりました' +
                    '（R-CH₂-OH + 2[O] → R-COOH + H₂O）。' +
                    '途中でアルデヒド R-CHO を通りますが、酸化剤が残っているとそこでは止まりません。' +
                    '入試では「激しく酸化した」と問題文に書かれ、この終点まで進めることを指示されます。',
                changed: [oId, cId, o.id]
            };
        }
    },
    {
        id: 'oxidize_secondary',
        mechanismId: 'propanol2_oxidation',
        label: '酸化 [O] → ケトン',
        reagentId: OXIDANT_REAGENT_IDS,
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
        reagentId: OXIDANT_REAGENT_IDS,
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
            if (!spot) throw noRoom('-OH を置く空間がありません');
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
        reagentId: OXIDANT_REAGENT_IDS,
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
         * 対象は**環に直結していてベンジル位に水素がある炭化水素の側鎖**（§10.3）。
         * ⚠ 炭素2個以上の側鎖も**図を変える**（2026-08-26 ユーザー決定）。
         *   切れて出ていく側は図に描かず、`caption` で補う。 */
        id: 'oxidize_side_chain',
        reagentId: OXIDANT_REAGENT_IDS,
        label: '酸化 [O] → 側鎖酸化（芳香族カルボン酸）',
        /* ⚠ **調べた結果、クロム酸系でも側鎖は酸化されて安息香酸になる**（§12-3）。
         *   だから「反応しない」も「ここでは決めていない」も事実に反する ——
         *   **実際に進む反応なら図は変える**。そのうえで「ふつうはこちら」を理由つきで添える。 */
        usually: {
            reagentId: 'kmno4',
            note: '一般的にはこの反応には過マンガン酸カリウムを使います。' +
                'クロム酸系でも進みますが、過マンガン酸カリウムのほうが酸化力が強く、' +
                'メチル基をカルボキシ基まで確実に酸化しきれるためです。'
        },
        detect(mol) { return sideChainOxidationSites(mol); },
        apply(game, site) {
            const [mId, ringId] = site;
            const mol = game.userMolecule;
            // 切り落とす側鎖は**書き換える前**に決める（原子を消したあとでは枝をたどれない）
            const branch = benzylSideChain(mol, mId, ringId, ringAtomIdsOf(mol));
            if (!branch) throw new Error('側鎖を切り出せません');
            const drop = [...branch].filter(id => id !== mId);
            drop.forEach(id => mol.removeAtom(id));
            // **置き場は2つとも先に確かめる**（途中で失敗して -CHO のまま残さない）。
            // 側鎖を落としたあとに探すので、いま側鎖があった場所も空きとして使える
            const s1 = freeSpotAround(mol, mId);
            const s2 = s1 ? freeSpotAround(mol, mId, [s1]) : null;
            if (!s1 || !s2) throw noRoom('-COOH を置く空間がありません');
            const o1 = mol.addAtom('O', s1.x, s1.y);
            mol.addBond(mId, o1.id, 2);
            const o2 = mol.addAtom('O', s2.x, s2.y);
            mol.addBond(mId, o2.id, 1);
            return {
                caption: '側鎖が酸化されて、環に直結した炭素がカルボキシ基になりました（トルエン → 安息香酸）。' +
                    '強い酸化剤（過マンガン酸カリウムなど）を熱して働かせると、ベンゼン環は壊れずに' +
                    '**側鎖だけ**が酸化されます。環が安定（芳香族性）なのに対し、環のとなりの炭素は' +
                    '酸化を受けやすいためです。o-キシレンのようにメチルが2つあれば、2回くり返して' +
                    'フタル酸まで進められます（p-キシレンから作るテレフタル酸は PET の原料）。' +
                    (drop.length ? '\n側鎖が炭素2つ以上（エチルベンゼン・クメン・スチレンなど）でも、' +
                        '残るのは**環に直結した炭素だけ**なので、できるのは同じ安息香酸です。' +
                        '切れて出ていった残りの炭素は、条件によって二酸化炭素などになります。' +
                        'ここでは**図に残していません**。' : ''),
                changed: [mId, o1.id, o2.id]
            };
        }
    },
    {
        /* アルケンの酸化開裂 ＝ **構造決定の主役**（qa の需要は1項目だが単元そのもの）。
         * 生成物は「もとの C=C の炭素についていた炭素の数」だけで決まる:
         *   炭素2つ（R₂C=）→ ケトン ／ 炭素1つ（RCH=）→ カルボン酸
         * ★ 炭素0（=CH₂）は**ギ酸を経て CO₂**。v1472 から**図から消して実行する**
         *   （§10.3-b の原則）。⚠ **両端とも炭素0のエチレンだけ**は実行せず、
         *   `oxidation_out_of_scope_info` が案内を返す（§10.3-f）。 */
        id: 'oxidative_cleavage',
        reagentId: OXIDANT_REAGENT_IDS,
        label: '酸化 [O] → 酸化開裂（C=C を切る）',
        usually: {
            reagentId: 'kmno4',
            note: '一般的にはこの反応には硫酸酸性の過マンガン酸カリウムを使います。' +
                '二重結合を切るには強い酸化剤が要り、クロム酸系ではここまで進みにくいためです。'
        },
        detect(mol) { return oxidativeCleavageSites(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const [id1, id2] = site;
            const bond = mol.getBond(id1, id2);
            if (!bond || bond.type !== 2) throw new Error('切る C=C が見つかりません');
            // 環の中か・端が =CH₂ かは**切る前**に見る（切ったあとは形が変わる）
            const cls = alkeneCleavageClass(mol, site);
            const inRing = cls === 'ring';
            // 行き先は**切る前**に決める（切ったあとでは「もとの相手」が分からなくなる）
            const carbons = (id, other) => mol.getNeighbors(id)
                .filter(n => n.atom.element === 'C' && n.atom.id !== other).length;
            let roles = [[id1, carbons(id1, id2)], [id2, carbons(id2, id1)]];
            /* ★ 末端（=CH₂）の側は、ギ酸を経て CO₂ と水になって出ていく。
             * §10.3-b の原則（**残るものを描き、出ていくものは文で補う**）どおり
             * **原子を消して図に残さない**。⚠ 置くと以後その CO₂ が反応の相手に数えられる。 */
            const dropped = cls === 'terminal' ? roles.filter(([, n]) => n === 0).map(r => r[0]) : [];
            if (dropped.length) roles = roles.filter(([, n]) => n > 0);
            mol.removeBond(id1, id2);
            dropped.forEach(id => mol.removeAtom(id));
            const part = [...componentOf(mol, roles[roles.length - 1][0])];
            if (!dropped.length && !part.includes(id1)) {
                const sep = separateComponent(mol, part);
                if (sep) translateAtoms(mol, part, sep.dx, sep.dy);
            }
            const changed = dropped.length ? [roles[0][0]] : [id1, id2];
            roles.forEach(([cid, nC]) => {
                const s1 = freeSpotAround(mol, cid);
                const s2 = nC === 1 ? freeSpotAround(mol, cid, s1 ? [s1] : []) : null;
                if (!s1 || (nC === 1 && !s2)) {
                    throw noRoom('生成物を置く空間がありません');
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
            const rule = '行き先は**その炭素についていた炭素の数**だけで決まります: ' +
                '炭素が2つ（R₂C=）ならケトン、炭素が1つ（RCH=）ならアルデヒドを経てカルボン酸まで進みます。';
            // ★ 環を切ったときは**分子が2つに分かれない**。数を言う言い方（「2つになりました」）は
            //    そのままでは嘘になるので、言い分ける（§10.3-d／§10.3-e ①）
            if (inRing) {
                const ends = names[0] === names[1]
                    ? (names[0] === 'カルボン酸' ? '両端にカルボキシ基をもつ' : '両端がケトンの')
                    : '片方の端がカルボキシ基、もう片方がケトンの';
                return {
                    caption: `環が開いて、${ends}**1つの分子**になりました（酸化開裂）。` +
                        '鎖状のアルケンと違って**分子は2つに分かれません**。' +
                        'このため「切ったのに1分子で出てくる」ことが、もとが環だった印になります' +
                        '（シクロヘキセン → アジピン酸）。' + rule +
                        '⚠ 教科書の本文には出ませんが、傍用問題集と入試では構造決定の定番です。',
                    changed,
                    refit: true
                };
            }
            /* ★ 末端の C=C（§10.3-e ②）。⚠ **文面を2か所直さないと嘘になる**:
             *  ① **試薬を名指しする** —— 書かずに「CO₂ になります」とだけ言うと、
             *     入試で多数派のオゾン分解の答え（HCHO・分子として残る）と食い違う
             *  ② **ギ酸を経ることを書く** —— セミナーの答えはギ酸で止まっている（p.362）ので、
             *     「必ず消える」と書くと傍用問題集の答えと食い違う */
            if (dropped.length) {
                return {
                    caption: `末端の C=C が切れて、${names[0]}になりました（酸化開裂）。` +
                        '**硫酸酸性の過マンガン酸カリウムでは**、=CH₂ の側は' +
                        '**まずギ酸 HCOOH になり**、さらに酸化されて二酸化炭素 CO₂ と水まで進みます。' +
                        '図に残らないので**描いていません**。' +
                        '⚠ 同じ「切る」でも**オゾン分解（O₃ → Zn）ならホルムアルデヒド HCHO で止まり**、' +
                        '分子として残ります。試薬で答えが変わるところです。' + rule,
                    changed,
                    refit: true
                };
            }
            return {
                caption: `C=C が切れて、${both}になりました（酸化開裂）。` +
                    '硫酸酸性の過マンガン酸カリウムのような強い酸化剤を使うと、二重結合のところで炭素鎖が切れます。' +
                    rule +
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
        reagentId: OXIDANT_REAGENT_IDS,
        label: '⚠ 酸化（ここでは図を変えない範囲）',
        info: true,
        detect(mol) { return oxidationOutOfScope(mol).sites; },
        apply(game) {
            const kinds = oxidationOutOfScope(game.userMolecule).kinds;
            const parts = [];
            /* ★ **エチレンだけ**（両端が =CH₂）。文面はユーザー承認済み（2026-08-27）。
             * ⚠ **詳しい経路（グリコール → シュウ酸）は書かない。**
             * ★ 要点は「教科書も入試もここで止めている」を、消極的な断りではなく
             *   **止まる理由**として書くこと（§10.3-f C-1）。 */
            if (kinds.has('gone')) {
                parts.push('エチレンは、二酸化炭素 CO₂ と水になります。' +
                    '炭素が2つとも出ていってしまうので、図に残る分子がありません。' +
                    '教科書も入試も、エチレンについては「赤紫色が消える」までしか扱いません。');
            }
            return {
                caption: (parts.join('\n') || 'この分子で酸化剤が働く形は、いまは図にしていません。') +
                    '\n酸化剤で図が変わるのは、1級・2級アルコール／アルデヒド／芳香環の側鎖／' +
                    '炭化水素の C=C（酸化開裂）の4つです。'
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
            if (!spots) throw noRoom('ヨードホルムを置く空間がありません');
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
            if (!oSpot) throw noRoom('-COONa を置く空間がありません');
            const o = mol.addAtom('O', oSpot.x, oSpot.y);
            mol.addBond(kId, o.id, 1);
            const naSpot = freeSpotAround(mol, o.id, [oSpot]);
            if (!naSpot) throw noRoom('ナトリウムを置く空間がありません');
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
            const changed = applyAcidCondensation(game.userMolecule, site);
            return {
                caption: 'エステル化（縮合）が起こりました。カルボン酸の -OH とアルコールの -H がとれて水になり、エステル結合 -COO- ができます（濃硫酸を触媒に加熱）。同位体で調べると、水の酸素はカルボン酸側から来ることが分かっています。',
                changed
            };
        }
    },
    {
        /* ★ 単発のアミド化（§10.11-D #13・§10.11-F の5位・2026-08-27 ユーザー決定）。
         *
         * ⚠ **これまでアミド結合は「縮合重合」の中でしか作れず、単量体が4分子要った**
         * （`condensation_polymerization` は `links.length < 3` で2組以上を求める）。
         * そのため **酢酸 ＋ アニリン → アセトアニリド** が作れず、
         * 「無水酢酸からは作れるのに、カルボン酸からは作れない」片道になっていた。
         *
         * ⚠ **瓶は足していない。**直接アミド化に当てる高校教材の試薬が無い
         * （教科書はアミドの加水分解の**逆**として書くだけで、触媒を名指ししない）ので、
         * `condensation_polymerization` と同じく**瓶を持たないルール**にする。
         * `apply` はエステル化と 1 か所も違わないので `applyAcidCondensation` を共有する。 */
        id: 'amidation',
        label: 'アミド化（カルボン酸＋アミン, -H₂O）',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②水がとれて -CO-NH- ができる
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            const carboxyls = groups.filter(g => g.type === 'carboxyl');
            // N に水素が残る1級・2級だけ（3級は H が無いので縮合できない）。
            // **アミドの N は除く**（隣のカルボニルに電子を引かれて求核性を失っている）
            const amines = groups.filter(g => AMINE_NH_TYPES.includes(g.type) &&
                !isAmideNitrogen(mol, g.atomIds[0]));
            const sites = [];
            carboxyls.forEach(cx => {
                const comp = componentOf(mol, cx.atomIds[0]);
                amines.forEach(am => {
                    if (comp.has(am.atomIds[0])) return; // 分子間反応のみ（ラクタムは対象外）
                    sites.push([cx.atomIds[0], cx.atomIds[2], am.atomIds[0]]);
                });
            });
            return sites;
        },
        apply(game, site) {
            const changed = applyAcidCondensation(game.userMolecule, site);
            return {
                caption: 'アミド化（縮合）が起こりました。カルボン酸の -OH とアミンの -H がとれて水になり、' +
                    'アミド結合 -CO-NH- ができます（加熱）。' +
                    'このつながり方は、タンパク質のペプチド結合・ナイロンのアミド結合と同じものです。' +
                    '⚠ 実際の合成では、カルボン酸より反応性の高い無水酢酸を使うほうがふつうです' +
                    '（アニリン → アセトアニリドは「アセチル化」の瓶からも作れます）。',
                changed
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
            /* ★ **糖どうしのときだけ、この札は身を引く**（`condensation_glycoside` へ渡す。§4-8c (e)）。
             * 教科書はその -O- を「エーテル」ではなく**グリコシド結合**と呼び分けているし、
             * α-D-グルコース2つでは 25箇所 出て**名前を言い切れる生成物が0件**だった（実測）。
             * ⚠ **アルコール一般の分子間脱水は1件も変えない。** 身を引く条件は
             *   「**両方**がハース図として読める糖の分子」——
             *   糖 ＋ エタノール（配糖体の向き。5箇所）は**そのまま残る**。 */
            const sugarAtoms = new Set();
            try {
                haworthSugarCycles(mol).forEach(c => {
                    if (c.length) componentOf(mol, c[0]).forEach(id => sugarAtoms.add(id));
                });
            } catch (e) { /* 糖として読めなければ従来どおり全部エーテル */ }
            const sites = [];
            for (let i = 0; i < alcohols.length; i++) {
                for (let j = i + 1; j < alcohols.length; j++) {
                    const a = alcohols[i];
                    const b = alcohols[j];
                    if (componentOf(mol, a.atomIds[0]).has(b.atomIds[0])) continue; // 別分子どうしのみ
                    if (sugarAtoms.has(a.atomIds[0]) && sugarAtoms.has(b.atomIds[0])) continue; // 糖どうしは譲る
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
            if (!plan) throw noRoom('生成物を配置する空間がありません');
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
        /* 糖どうしの縮合（単糖2つ → 二糖）。`DESIGN_sugar.md` §4-8 / §4-8c。
         * ⚠ **試薬の瓶は持たせない。** 「濃硫酸を加えるとこうつながる」は正しくない
         *   （どの -OH につながるかも α/β も選べず混ざる）ので、瓶からの入口は作らない。
         *   ⚠ この判断は §8-③ の推奨（h2so4_conc に相乗り）と違う ——
         *      **下の caption が「実験室で同じようにつながるわけではない」と断っている**ので、
         *      瓶を押すと出てくる形にすると画面が自分の断り文と食い違う。 */
        id: 'condensation_glycoside',
        label: '縮合（単糖2分子, -H₂O）→ グリコシド結合で二糖',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②水がとれて -O- でつながる
        /* ★ **消えない断り**（`caveat`）。字幕（`showToast`）は 6.5 秒で消えるので、
         * **教科書の外の話は「いま起きた反応」の節に置いて残す**。
         * ⚠ 文は1か所（`RX_GLYCOSIDE_CAVEAT`）——字幕と節で食い違わせない。 */
        caveat: RX_GLYCOSIDE_CAVEAT,
        detect(mol) { return glycosidicCondensationSites(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const done = applyGlycosidicCondensation(mol, site);
            if (!done) throw noRoom('この向きにはつなげません');
            /* ★★ **できた二糖を「その二糖を単独で描くときの図」に直す**（v1477・ユーザー実機報告
             * 「スクロース 加水分解 → フルクトースを選択して逆向きの反応をする で
             *  フルクトースがグルコースに重なった」）。
             *
             * ★ **測ったこと**（:9137・実アプリ。物差しは「結合していない重原子どうしの距離」）:
             *   スクロース … 重なる組 **2件・最短 17.2px**（原子の丸は半径 10px ＝ 図として触れている）
             *   マルトース／セロビオース／ラクトース … 0件（最短 46〜63px）
             *   登録のスクロースの図 … 0件（最短 46.1px）
             *   ⚠ **加水分解を経なくても同じ**（呼び出した単糖2つを素直に縮合しても 2件・17.2px）
             *   ＝ **v1476 の 180° 回転が戻っていないのではなく、縮合の置き方そのもの**。
             *
             * ★ **原因**: `applyGlycosidicCondensation` は相手を**平行移動だけ**で寄せる
             *   （§4-8。回すと面が読めなくなるため）。置き場所は**供与側の環**から決めるので、
             *   **受け側の接続炭素が自分の図のどちら端にあるか**は見ていない。
             *   実測: グルコースの C1 は図の**右端**（local 200/200）・フルクトースの C2 も
             *   図の**右端**（local 140/140）＝ 右端どうしを向かい合わせに置くので、
             *   受け側の体が供与側へ折り返す。マルトース等は受け側の C4 が**左端**なので起きない。
             *   ⚠ 登録のスクロースの図では、フルクトースの C2 が**左端**に来る描き方をしている
             *   （＝ ⇄ を1回かけた図。`haworthFlipStepsToStandalone` の実測 0.91px）。
             *
             * ★ **直し方**: 新しい作図ルーチンを書かず、**加水分解が使っているのと同じ道具**を
             *   逆向きに使う ＝ できた二糖を登録の図へ写す。行き先は
             *   `registeredProductName` が既に「言い切れる1件」に絞ってあるので、
             *   ここで引ける相手は必ず居る（引けなければ `[]` が返って**今までどおり**）。
             * ⚠ **`only` を必ず渡す**（キャンバスの他の分子には1ピクセルも触れない）。
             * ⚠ **名前で分岐しない**（スクロース名指しのハードコードを置かない）。 */
            game.redrawProductsAsStandalone({
                only: [...componentOf(mol, site[1])],
                // 重なりの物差しと逃がし方は加水分解と同じものを渡す（別々に持つと片方だけ直る）
                overlaps: componentOverlaps,
                escape: (m, ids) => componentOverlaps(m, ids) ? separateComponent(m, ids) : null
            });
            const name = site.productName || (registeredProductName(
                subMolecule(mol, [...componentOf(mol, site[1])]).mol) || '');
            return {
                caption:
                    // ---- ここまでが教科書の記述（`qa/KNOWLEDGE_CAVEATS.md` の型で分ける）----
                    // ⚠ 括弧を入れ子にしない（名前自体に括弧が入っている ＝「（マルトース（麦芽糖））」）
                    'グリコシド結合ができて、単糖2分子が' +
                    (name ? `二糖 ${name} ` : '二糖') +
                    'になりました。C₆H₁₂O₆ ×2 → C₁₂H₂₂O₁₁ ＋ H₂O です。' +
                    'つないだのは片方の「1位」——環の酸素のとなりにある特別な -OH（ヘミアセタール性 -OH）で、' +
                    '水の中で環が開いたり閉じたりするのはここです。' +
                    '教科書に名前の出る二糖（マルトース・セロビオース・ラクトース・スクロース）は、' +
                    'どれも 1位 を使ってつながっています。' +
                    // ---- ここから先はこの教材が足す説明。**節にも残る**（`caveat`）----
                    RX_GLYCOSIDE_CAVEAT +
                    (done.flipped
                        ? 'なお、2つの -OH が反対の面を向いていたので、つなぐ相手を上下に裏返してから並べました。' +
                          '裏返しても分子そのものは同じで、名前も変わりません。'
                        : ''),
                changed: [site[0], site[1], site[3]],
                refit: true
            };
        }
    },
    {
        id: 'addition_polymerization',
        // ★ **キャンバス全体が対象**（`siteFilter` の注記）。「並べた単量体をまとめて」
        //    繋ぐ反応なので、いま見ている分子で絞ると**2本目の鎖が作れなくなる**
        wholeCanvas: true,
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
                const t = mol.atoms.find(x => x.id === v.tail);
                if (!a || !t) return;
                if (!groups.has(code)) groups.set(code, []);
                groups.get(code).push({
                    head: v.head, tail: v.tail,
                    hx: a.x, hy: a.y, tx: t.x, ty: t.y
                });
            });
            const sites = [];
            groups.forEach(list => {
                if (list.length < 2) return;
                /* 並べた順に繋ぐ（画面の並びと繋がる順を一致させる）。
                 * ★ **並べ替えの向きは「鎖が伸びる向き」に合わせる**（v1436・§14）。
                 *   鎖は R-tail₀-head₀-tail₁-head₁-… と繋がるので、単量体の中の
                 *   **tail → head** がそのまま鎖の伸びる向きになる。
                 *   エチレンのように左右が同じ単量体では `vinylBonds` の頭尾が
                 *   「x の小さいほうが head」に決まるため、左から右の順に繋ぐと
                 *   鎖は並びと**逆向き**に伸びようとし、右隣が塞がっているぶん
                 *   階段状に折れていた（ユーザー実機報告 2026-08-21。実測で
                 *   エチレン3個 → 90° の折れが5か所・y のばらつき 84px）。
                 *   向きがそろわない（手で描いて左右ばらばら）ときは合計が 0 に近づくので、
                 *   従来どおり x の昇順へ落ちる。 */
                const sum = list.reduce((s, v) => ({ x: s.x + (v.hx - v.tx), y: s.y + (v.hy - v.ty) }),
                    { x: 0, y: 0 });
                const key = Math.abs(sum.x) >= Math.abs(sum.y)
                    ? (v => (sum.x < 0 ? -v.hx : v.hx))
                    : (v => (sum.y < 0 ? -v.hy : v.hy));
                list.sort((p, q) => key(p) - key(q));
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
            // 頭の置換基を主鎖と直交する向きへ立て直す（`uprightChainSubstituent`）。
            // **単量体ごとに交互の側へ出す** ―― 同じ側にそろえると、隣の枝どうしが
            // 84px 間隔でぶつかって置けなくなる（スチレンで実測。環の幅が 69px ある）
            units.forEach((u, i) => uprightChainSubstituent(mol, u.head, u.tail, i % 2 ? -1 : 1));
            // 頭（置換基の多い炭素）に次の単量体の尾（少ない炭素）を繋ぐと、
            // 教科書どおりの「頭-尾（head-to-tail）」の並びになる
            const changed = [];
            // ★ **まだ繋いでいない単量体は「邪魔者」ではなく、この鎖の続き**（v1436・§14）。
            //   当たり判定から外さないと、横に並んだ次の単量体を避けて上下へ逃げ、
            //   鎖が階段状に折れる。避けた相手はこの後どうせ動かして繋ぐので、
            //   最後の1個を置くときには全員が鎖の上に乗っていて、重なりは残らない
            const pending = new Set();
            units.slice(1).forEach(u => componentOf(mol, u.head).forEach(id => pending.add(id)));
            let linkFrom = units[0].head;
            let linkBack = units[0].tail; // 主鎖の1つ内側（＝鎖が伸びる向きを決める）
            for (let i = 1; i < units.length; i++) {
                const u = units[i];
                const movingIds = [...componentOf(mol, u.head)];
                movingIds.forEach(id => pending.delete(id));
                const plan = planAttachment(mol, linkFrom, u.tail, movingIds, [...pending],
                    chainDirection(mol, linkBack, linkFrom));
                if (!plan) throw noRoom('生成物を配置する空間がありません');
                applyAttachment(mol, movingIds, plan);
                mol.addBond(linkFrom, u.tail, 1);
                changed.push(linkFrom, u.tail);
                linkBack = u.tail;
                linkFrom = u.head; // 次はこの単量体の頭に繋ぐ
            }
            // 両端に R を付けて「ここから先も同じ単位が続く」ことを示す。
            // R は価標1の擬似元素で、アルキル基練習でも使っている既存の表記。
            // 向きは**鎖をそのまま1歩伸ばした先**（v1436・§14）
            const endIds = attachREnds(mol, [
                [units[0].tail, chainDirection(mol, units[0].head, units[0].tail)],
                [linkFrom, chainDirection(mol, linkBack, linkFrom)]
            ]);
            const n = units.length;
            return {
                caption: `単量体 ${n} 個が付加重合しました。二重結合が開いて次々に繋がり、繰り返し単位が ${n} 個ぶん並んでいます。` +
                    '両端の R は「この先も同じ単位が続く」という印です（教科書では −[ ]ₙ− の角括弧で書きます）。' +
                    '付加重合では原子が1つも出入りしません（脱水などの副生成物が出ない）ので、' +
                    '単量体の分子式を n 倍したものが高分子の組成になります。' +
                    '鎖が画面に収まるよう表示を引きました。ホイールやピンチで拡大すると、繋がり目を1つずつ確かめられます。',
                changed: [...new Set([...changed, ...endIds])],
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
        // ★ **キャンバス全体が対象**（`siteFilter` の注記）。「並べた単量体をまとめて」
        //    繋ぐ反応なので、いま見ている分子で絞ると**2本目の鎖が作れなくなる**
        wholeCanvas: true,
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
            // 繋ぐ前の単量体は鎖の続き（v1436・§14。付加重合と同じ約束）
            const pending = new Set();
            units.slice(1).forEach(u => componentOf(mol, u.left).forEach(id => pending.add(id)));
            let linkFrom = units[0].right;
            let linkBack = units[0].left;
            for (let i = 1; i < units.length; i++) {
                const u = units[i];
                const movingIds = [...componentOf(mol, u.left)];
                movingIds.forEach(id => pending.delete(id));
                const plan = planAttachment(mol, linkFrom, u.left, movingIds, [...pending],
                    chainDirection(mol, linkBack, linkFrom));
                if (!plan) throw noRoom('生成物を配置する空間がありません');
                applyAttachment(mol, movingIds, plan);
                mol.addBond(linkFrom, u.left, 1);
                changed.push(linkFrom, u.left);
                linkBack = u.left;
                linkFrom = u.right;
            }
            const endIds = attachREnds(mol, [
                [units[0].left, chainDirection(mol, units[0].right, units[0].left)],
                [linkFrom, chainDirection(mol, linkBack, linkFrom)]
            ]);
            const n = units.length;
            return {
                caption: `アセチレン ${n} 個が付加重合してポリアセチレンになりました。` +
                    '三重結合が1本ぶん開いて隣の分子とつながるので、**鎖には二重結合が残ります**' +
                    '（エチレンの付加重合ではすべて単結合になるのと対照的です）。' +
                    '単結合と二重結合が交互に並ぶこの形を共役といい、電子が鎖に沿って動けるため、' +
                    'ヨウ素などを加えると金属に近い電気伝導性を示します（導電性高分子）。' +
                    '両端の R は「この先も同じ単位が続く」という印です。',
                changed: [...new Set([...changed, ...endIds])],
                refit: true
            };
        }
    },
    {
        id: 'diene_polymerization',
        // ★ **キャンバス全体が対象**（`siteFilter` の注記）。「並べた単量体をまとめて」
        //    繋ぐ反応なので、いま見ている分子で絞ると**2本目の鎖が作れなくなる**
        wholeCanvas: true,
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
            // 繋ぐ前の単量体は鎖の続き（v1436・§14。付加重合と同じ約束）
            const pending = new Set();
            units.slice(1).forEach(u => componentOf(mol, u.c1).forEach(id => pending.add(id)));
            let linkFrom = units[0].c4;
            let linkBack = units[0].c3;
            for (let i = 1; i < units.length; i++) {
                const u = units[i];
                const movingIds = [...componentOf(mol, u.c1)];
                movingIds.forEach(id => pending.delete(id));
                const plan = planAttachment(mol, linkFrom, u.c1, movingIds, [...pending],
                    chainDirection(mol, linkBack, linkFrom));
                if (!plan) throw noRoom('生成物を配置する空間がありません');
                applyAttachment(mol, movingIds, plan);
                mol.addBond(linkFrom, u.c1, 1);
                changed.push(linkFrom, u.c1);
                linkBack = u.c3;
                linkFrom = u.c4;
            }
            const endIds = attachREnds(mol, [
                [units[0].c1, chainDirection(mol, units[0].c2, units[0].c1)],
                [linkFrom, chainDirection(mol, linkBack, linkFrom)]
            ]);
            const n = units.length;
            return {
                caption: `共役ジエン ${n} 個が 1,4-付加重合しました。両端（1位と4位）の炭素で繋がり、` +
                    `二重結合は両端から中央へ移っています。ここが付加重合との違いで、` +
                    `できた鎖に二重結合が残るため、硫黄で架橋できます（加硫）。` +
                    `天然ゴムはイソプレンがシス形に繋がったもので、同じ形でトランスに繋がるとグタペルカという硬い樹脂になります。` +
                    `いまの図は直交作図なのでシス・トランスを示していません。左の「⇄ シス/トランス整形」で` +
                    `中央の二重結合をタップすると、シス（天然ゴム）とトランス（グタペルカ）を描き分けられます。` +
                    `両端の R は「この先も続く」印です。ホイールやピンチで拡大すると、中央に移った二重結合を1つずつ確かめられます。`,
                changed: [...new Set([...changed, ...endIds])],
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
            /* ★ 1本目の橋を架ける前に、**相手の鎖を真下（真上）へ寄せて「＝」に並べる**
             * （v1484。動画レーン V130 の要望。理由と実測は `stackChainsForBridge` の注記）。
             * ⚠ 置けなければ座標は1つも動かず、今までどおりの絵になるだけ。
             * ⚠ 寄せると座標が変わるので、**硫黄の席は寄せたあとに取り直す**。 */
            const before = new Map(mol.atoms.map(a => [a.id, { x: a.x, y: a.y }]));
            stackChainsForBridge(mol, ca, cb);
            // detect が返した組をそのまま使う（置ける位置は detect 側で確かめてある）
            const findBest = () => vulcanizablePairs(mol)
                .find(p => p.ca === ca && p.ca2 === ca2 && p.cb === cb && p.cb2 === cb2);
            let best = findBest();
            if (!best) {
                // 寄せたせいで席が無くなることは（①②③の検査があるので）無いはずだが、
                // 起きたときに黙って断らない ―― **元の座標へ戻して**もう一度だけ探す
                mol.atoms.forEach(a => { const p = before.get(a.id); if (p) { a.x = p.x; a.y = p.y; } });
                best = findBest();
            }
            if (!best) {
                throw noRoom('鎖の間に硫黄を置く空間がありません');
            }
            const ab = mol.getBond(best.ca, best.ca2), bb = mol.getBond(best.cb, best.cb2);
            if (!ab || !bb || ab.type !== 2 || bb.type !== 2) throw new Error('二重結合が残っていません');
            /* 硫黄が二重結合の炭素に付く＝二重結合が単結合になり、そこに架橋ができる。
             * 硫黄は S=O を持たないので2価として扱われ、余分な水素は描かれない（v283）。
             * ★ 橋は **-S-S-（硫黄2個・ジスルフィド）**（v1487）。理由は caption と
             *   DESIGN_reaction_execution.md §20-6 —— 実際の架橋はモノ／ジ／ポリと
             *   さまざまで、その代表としてジを描く。 */
            ab.type = 1;
            bb.type = 1;
            const s1 = mol.addAtom('S', best.s1x, best.s1y);
            const s2 = mol.addAtom('S', best.s2x, best.s2y);
            mol.addBond(best.ca, s1.id, 1);
            mol.addBond(s1.id, s2.id, 1);
            mol.addBond(best.cb, s2.id, 1);
            const a1 = best.ca, b1 = best.cb;
            return {
                /* ⚠ **画面に「教科書ではこう描く」とは書かない**（DEVELOPMENT.md「『教科書に載っているか』の
                 * 扱い方」3。架橋の描き方に正解は無いので、根拠づけると唯一の書き方だと誤解させる）。
                 * ★ 出すのは**化学の中身**＝「実際はモノ・ジ・ポリとさまざま、図は代表してジ」。
                 * ⚠ 足すぶん、二重結合の由来の一文を短くして総量を増やしすぎない（説明の削減・v1471）。 */
                caption: '加硫が1か所進みました。硫黄が2本の鎖のあいだに入って架橋（橋かけ）しています。' +
                    '硫黄は 1,4-付加重合で残った二重結合に結びつきます。' +
                    '架橋ができると鎖どうしがずれにくくなり、伸ばしても元に戻る弾性ゴムになります。' +
                    '架橋の硫黄はモノ（1個）・ジ（2個）・ポリ（多数）とさまざまで、この図は代表としてジ（-S-S-）です。' +
                    '硫黄を多く加えて架橋を増やすと、硬くて弾性のないエボナイトになります。' +
                    'もう一度押すと別の場所も架橋できます。',
                changed: [a1, b1, s1.id, s2.id],
                refit: true
            };
        }
    },
    {
        /* ★★ ビニロン（PVA のアセタール化・§21-4 (e) の1本目・入試34件）。
         * 詳しい理由と教科書の読みは `acetalizableDiols`（2154行〜）の注記に書いた。
         *
         * ⚠ **瓶は増やさない**。橋の -CH₂- は**キャンバスに呼び出した HCHO の炭素**で、
         *   その O は水になって離れる ＝ 「つなぐたびに水がとれる」が画面で見える。
         * ⚠ **`wholeCanvas` は付けない**（加硫と同じ）—— 箇所が PVA と HCHO に
         *   またがるので、どちらを見ていても `focus` に必ず当たる。 */
        id: 'acetalization_pva',
        label: 'アセタール化（ホルムアルデヒドで -OH を橋かけ）→ ビニロン',
        detect(mol) {
            return acetalizableDiols(mol).map(ch => {
                const site = [];
                ch.groups.forEach(g => site.push(g.oA, g.oB, g.hc));
                return site;
            });
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const at = id => mol.atoms.find(x => x.id === id);
            // detect が返した組を引き当てる（原子IDの並びで照合。座標は動いているかもしれない）
            const want = new Set();
            for (let i = 0; i < site.length; i += 3) want.add(`${site[i]}\0${site[i + 1]}\0${site[i + 2]}`);
            const chain = acetalizableDiols(mol).find(ch =>
                ch.groups.length === want.size &&
                ch.groups.every(g => want.has(`${g.oA}\0${g.oB}\0${g.hc}`)));
            if (!chain) throw new Error('アセタール化できる -OH の組が見つかりません');
            const stages = [];
            const changed = [];
            chain.groups.forEach(g => {
                const spot = acetalBridgeSpot(mol, g.oA, g.oB, [g.cA, g.cMid, g.cB], [g.hc, g.ho]);
                if (!spot) throw noRoom('アセタールの環を描く空間がありません');
                const c = at(g.hc);
                mol.removeBond(g.hc, g.ho);   // HCHO の C=O を切る ＝ O は水になって離れる
                c.x = Math.round(spot.x);
                c.y = Math.round(spot.y);
                mol.addBond(g.oA, g.hc, 1);
                mol.addBond(g.oB, g.hc, 1);
                parkAsWater(mol, g.ho);
                changed.push(g.oA, g.oB, g.hc, g.cA, g.cB);
                // ★ **1組できるごとに1コマ写す** ＝ 隣どうしが組むところを順に見せる
                stages.push(snapshotFrame(mol));
            });
            const n = chain.groups.length;
            const left = [...chain.chain].filter(id => hydroxylOxygenOf(mol, id)).length;
            return {
                caption: `ポリビニルアルコールの -OH がホルムアルデヒドとアセタール化して、` +
                    `隣り合う -OH 2つが O-CH₂-O の六員環になりました（${n} か所・残った -OH は ${left} 個）。` +
                    '教科書はこの反応を「3つのうち2つ ＝ -OH の 2/3 がアセタール化する」形で描いていて、' +
                    '残った -OH が水になじむので、ビニロンは合成繊維では珍しく吸湿性を持ちます。' +
                    `つなぐたびに水が1分子とれます（画面の水 ${n} 分子がその証拠です）。`,
                changed,
                morphSequence: stages,
                refit: true
            };
        }
    },
    {
        /* ★★ 開環重合（ε-カプロラクタム → ナイロン6・§21-4 (e) の2本目・入試44件）。
         * 詳しい理由と教科書の読みは `lactamUnits`（2333行〜）の注記に書いた。
         *
         * ⚠ **瓶は増やさない**。教科書は触媒を名指ししない（p.251 は「水を少量加えて加熱」）。
         * ★ **キャンバス全体が対象**（既存の重合3本と同じ）。
         * ⚠ **`planAttachment` を1度も呼ばない** —— 環の弧のまま繋ごうとすると
         *   16通り全滅することが実測で分かっている（§21-1 (f)）。ほどいて直線に描き直す。 */
        id: 'ring_opening_polymerization',
        wholeCanvas: true,
        label: '開環重合（環状アミドの環が開いてつながる）→ ナイロン6',
        detect(mol) {
            return lactamUnits(mol).map(list => list.flatMap(u => [u.n, u.c]));
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const at = id => mol.atoms.find(x => x.id === id);
            const units = [];
            for (let i = 0; i < site.length; i += 2) units.push({ n: site[i], c: site[i + 1] });
            if (units.length < 2) throw new Error('単量体が2つ以上必要です');
            const G = bondStep(mol, units[0].n);
            /* ---- ① 環を開く（アミド結合 N-C(=O) を1本切るだけ。⚠ 原子は出入りしない） ----
             * ★ 切ってから N → C の道を取ると、**環を回ったほうの並び**（＝ ほどいた鎖）が出る。
             *   切る前に取ると最短経路 ＝ 切ろうとしているアミド結合そのものになってしまう。 */
            units.forEach(u => {
                if (!mol.getBond(u.n, u.c)) throw new Error('アミド結合が見つかりません');
                mol.removeBond(u.n, u.c);
                u.path = carboxylSkeletonPath(mol, u.n, u.c, []);
                if (!u.path || u.path.length < 5) throw new Error('環をほどけませんでした');
            });
            // ---- ② 全部つないだ姿の主鎖を作る（N → …CH₂… → C=O → 次の N → …） ----
            const backbone = units.flatMap(u => u.path);
            const pendants = new Map();
            units.forEach(u => {
                const o = mol.getNeighbors(u.c).find(n => n.atom.element === 'O' && n.type === 2);
                if (o) pendants.set(u.c, [o.atom.id]);
            });
            // ---- ③ ★★ P-c: 一直線に描き直す（環の弧のままでは置けない） ----
            const spot = straightChainSpot(mol, backbone, pendants, G);
            if (!spot) throw noRoom('つながった鎖を置く空間がありません');
            backbone.forEach((id, i) => {
                const a = at(id);
                a.x = spot.x0 + i * G;
                a.y = spot.y0;
                (pendants.get(id) || []).forEach(oid => {
                    const p = at(oid);
                    if (p) { p.x = a.x; p.y = a.y - G; }   // =O は真上（ナイロン66 の図と同じ）
                });
            });
            // ---- ④ 開いた端どうしをつなぐ（★ 水は1分子も出ない） ----
            const changed = [];
            for (let i = 1; i < units.length; i++) {
                mol.addBond(units[i - 1].c, units[i].n, 1);
                changed.push(units[i - 1].c, units[i].n);
            }
            const endIds = attachREnds(mol, [
                [units[0].n, { x: -1, y: 0 }],
                [units[units.length - 1].c, { x: 1, y: 0 }]
            ]);
            const n = units.length;
            const ringSize = units[0].path.length;
            return {
                caption: `環状アミド ${n} 個が開環重合しました。環の中の -CO-NH- が1か所ずつ切れて、` +
                    `切り口どうしが次々につながっています（${ringSize} 員環 → 繰り返し単位 ${n} 個）。` +
                    '⚠ **水は1分子も出ません**。ここが縮合重合との違いで、' +
                    'ナイロン66 は2種類の単量体（アジピン酸＋ヘキサメチレンジアミン）から' +
                    '水がとれてつながる縮合重合、ナイロン6 は1種類の環が開いてつながる開環重合です。' +
                    '作り方は違いますが、どちらもアミド結合 -CO-NH- でつながったナイロンです。' +
                    '両端の R は「この先も同じ単位が続く」という印です（教科書では −[ ]ₙ− の角括弧で書きます）。' +
                    '環の弧のままでは繋げないので、ほどいた鎖をまっすぐに描き直しました。',
                changed: [...new Set([...changed, ...endIds])],
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
        // ★ **キャンバス全体が対象**（`siteFilter` の注記）。付加重合の3本と同じ理由で、
        //    いま見ている分子で絞ると**2本目の鎖が作れなくなる**。
        //    ⚠ v1465 はここを付け忘れていた（付加の3本にだけ付けた）。
        //    **4分子ちょうどでは出ない穴**——箇所が4分子ぜんぶを含むので focus に必ず当たる。
        //    出るのは「1本目を作ったあと、単量体を並べ直して2本目」のとき（PM13 で再現）
        wholeCanvas: true,
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
            // 繋ぐ前の単量体は鎖の続き（v1436・§14。付加重合と同じ約束）。
            // 単量体が長いぶんこの効きは大きく、外さないと相手を避けて 90° 立ってしまう
            const pending = new Set();
            links.forEach(({ c, x }) => {
                componentOf(mol, c).forEach(id => pending.add(id));
                componentOf(mol, x).forEach(id => pending.add(id));
            });
            // 鎖の端から見た「続きの向き」＝ 1つ内側の炭素から端へ向かう向き
            const outward = (id, exceptId) => {
                const back = mol.getNeighbors(id)
                    .find(n => n.atom.element === 'C' && n.atom.id !== exceptId);
                return back ? chainDirection(mol, back.atom.id, id) : null;
            };
            links.forEach(({ c, oh, x }) => {
                // すでに鎖になっている側を動かさず、新しい単量体の方を寄せる
                const anchorIsAcid = chainIds.has(c);
                const anchor = anchorIsAcid ? c : x;
                const attach = anchorIsAcid ? x : c;
                const movingIds = [...componentOf(mol, attach)];
                chainIds.forEach(id => pending.delete(id));
                movingIds.forEach(id => pending.delete(id));
                const plan = planAttachment(mol, anchor, attach, movingIds, [oh, ...pending],
                    outward(anchor, attach));
                if (!plan) throw noRoom('生成物を配置する空間がありません');
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
            const endIds = attachREnds(mol, [
                [endAcid.atomIds[0], outward(endAcid.atomIds[0])],
                [endOther.atomIds[0], outward(endOther.atomIds[0])]
            ]);
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
                changed: [...new Set([...changed, ...endIds])],
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
                    `実際に1段つなぐには「${kind}化」や「アセチル化」を使ってください。` +
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
                // ⚠ `anchor` を入れない（v1480・動画レーン実測 §8）。`anchor` は detect が
                // 「環の外に重原子を1つ持つ炭素」として選んだ**目印**で、`apply` はこの原子に
                // 一切触らない。印の意味は「何が変わったか」なので、ここに「なぜ起きたか」の
                // 原子が混ざると、フェノールで **-OH の付け根（C1・置換されない）にも印が付く**。
                // ★ o,p-配向性は「オルト2つとパラ1つ ＝ 3か所」という**数の話**なので、
                //   4つ目の印があると「4か所変わった」と読めて話がぼやける。アニリンも同じルール。
                changed: [...targets, ...added]
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
    {
        /* ★ ワッカー法（§10.11-D #27・§10.3-f C-3・v1472。ユーザーが「足す」と決めていた）。
         * ★ **教科書 本文 p.150 に式がある**（p.282 に再掲）・入試12〜13件。
         * ⚠ ただし**教科書に「ワッカー法」という名前は無い**（参考書が名づけている）ので、
         *   caption でそのことを断る（§4-1）。
         * ★ 図は素直 —— **炭素2個のまま残り、分子が消えない**（酸化開裂との違い）。
         * ⚠ **対象はエチレンだけ**。末端アルケン一般でも似た反応は進むが、
         *   教科書・入試が扱うのはエチレンの場合だけ（§4-1 の線）。 */
        id: 'wacker_oxidation',
        reagentId: 'o2_pdcl2',
        label: 'ワッカー法（エチレン → アセトアルデヒド）',
        detect(mol) { return ethyleneUnits(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const [c1, c2] = site;
            const spot = freeSpotAround(mol, c1);
            if (!spot) throw noRoom('カルボニルの酸素を置く空間がありません');
            const bond = mol.getBond(c1, c2);
            if (!bond || bond.type !== 2) throw new Error('エチレンの C=C が見つかりません');
            bond.type = 1;
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(c1, o.id, 2);
            bendCarbonyl(mol, c1, o.id);
            return {
                caption: 'エチレンが酸化されてアセトアルデヒドになりました。' +
                    '塩化パラジウム(II) と塩化銅(II) を触媒に、酸素で酸化します。' +
                    '**炭素は2個のまま残り**、C=C の片方が C=O に変わるだけです' +
                    '（切れて減る酸化開裂との違いはここです）。' +
                    'アセトアルデヒドの工業的製法で、教科書には式が載っています' +
                    '（「ワッカー法」という呼び名は参考書のものです）。',
                changed: [c1, c2, o.id]
            };
        }
    },
    {
        /* ★ ニトロ化合物の還元 → 芳香族アミン（§10.11-D #5・§10.11-F の3位・v1472）。
         * ★ **教科書 本文 p.188**・入試47件（⚠ 上限値）・ニトロベンゼンもアニリンも登録済み。
         *
         * ★ **1段で直接アミンにする**（§10.3-b の原則）。教科書は
         *   「スズ＋塩酸 → アニリン塩酸塩 → NaOH で遊離」の**2段**で書くが、
         *   塩の段はイオン（§10.6 の壁）。⚠ **塩の段は caption で補う**。
         *
         * ⚠ **対象は芳香環に直結した -NO₂ だけ**。ニトロアルカンの還元も化学としては
         *   起こるが、教科書が扱うのは芳香族だけ（§4-1 の線）。
         *
         * ★ **瓶は増やしていない**。教科書が工業的製法として名指しする **H₂ ＋ 触媒**に
         *   相乗りする。⚠ そのため「H₂/Ni を作用させても**ベンゼン環は水素化されず、
         *   ニトロ基だけが還元される**」が画面でそのまま起こる ＝ 入試の頻出点と一致する。 */
        id: 'reduce_nitro',
        reagentId: 'h2_ni',
        label: '還元: -NO₂ → -NH₂（芳香族アミン）',
        detect(mol) {
            const arom = aromaticAtomSet(mol);
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'nitro')
                .filter(g => mol.getNeighbors(g.atomIds[0])
                    .some(n => n.atom.element === 'C' && arom.has(n.atom.id)))
                .map(g => [g.atomIds[0]]);
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const nId = site[0];
            const oIds = mol.getNeighbors(nId)
                .filter(n => n.atom.element === 'O').map(n => n.atom.id);
            if (oIds.length !== 2) throw new Error('ニトロ基の酸素が見つかりません');
            oIds.forEach(id => mol.removeAtom(id));  // O が2つ外れ、自動水素が -NH₂ を描く
            return {
                caption: 'ニトロ基が還元されてアミノ基になりました（ニトロベンゼン → アニリン）。' +
                    '実験室では**スズ Sn と濃塩酸**を使い、いったん**アニリン塩酸塩**（塩）ができます。' +
                    'これに水酸化ナトリウム水溶液を加えると、弱塩基のアニリンが遊離します。' +
                    'ここでは塩の段をとばして、遊離したアミンを直接描いています。' +
                    '工業的には水素と触媒で還元します。' +
                    '⚠ このとき**ベンゼン環は水素化されません** —— 環は安定（芳香族性）で、' +
                    'ニトロ基のほうがずっと還元されやすいためです。',
                changed: [nId]
            };
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
                if (!spot) throw noRoom('生成物を配置する空間がありません');
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
        /* ★ 分子内脱水 → 酸無水物（§10.11-D #3・§10.11-F の2位・v1472）。
         * ⚠ **瓶は足していない**。教科書は「加熱すると」としか書かず試薬を名指ししない
         * （フタル酸 p.184・マレイン酸 p.157）ので、瓶を持たないルールにする（§4-1 の線）。 */
        id: 'dehydration_anhydride',
        label: '分子内脱水（-H₂O） → 酸無水物',
        detect(mol) {
            return anhydrideDehydrationCandidates(mol)
                .filter(c => c.geo === 'ok' &&
                    anhydrideBridgeSpot(mol, c.site[0], c.site[2], c.path, [c.site[1], c.site[3]]))
                .map(c => c.site);
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const [cA, ohA, cB, ohB] = site;
            const cand = anhydrideDehydrationCandidates(mol)
                .find(c => c.site[0] === cA && c.site[2] === cB);
            const spot = cand && anhydrideBridgeSpot(mol, cA, cB, cand.path, [ohA, ohB]);
            if (!spot) throw noRoom('環をつくる空間がありません');
            const ring = cand.path.length + 1; // 架橋の O を足した環の大きさ
            // 片方の -OH の O を架橋にし、もう片方の -OH は水として出す
            mol.removeBond(cB, ohB);
            parkAsWater(mol, ohB);
            const o = mol.atoms.find(x => x.id === ohA);
            o.x = spot.x; o.y = spot.y;
            mol.addBond(ohA, cB, 1);
            return {
                caption: `2つのカルボキシ基から水がとれて、${ring}員環の酸無水物 -CO-O-CO- ができました（加熱）。` +
                    'エステル化と同じ「-OH と -H がとれて水」ですが、相手が**同じ分子のもう1つの -COOH** なので環になります。' +
                    'フタル酸 → 無水フタル酸、マレイン酸 → 無水マレイン酸がその例です。' +
                    '⚠ 隣り合っていないと環が大きくなりすぎて起こりません' +
                    '（テレフタル酸は酸無水物になりません）。',
                changed: [cA, ohA, cB],
                refit: true
            };
        }
    },
    {
        /* ⚠ **できない側を黙って消さない**（§9.2「陰性で説明できることを書く」）。
         * ★ フマル酸（トランス）が無水物にならないことは、入試がいちばん問う点。 */
        id: 'dehydration_anhydride_info',
        label: '⚠ 分子内脱水 → 酸無水物（この形では起こらない）',
        info: true,
        detect(mol) {
            return anhydrideDehydrationCandidates(mol)
                .filter(c => c.geo !== 'ok').map(c => c.site);
        },
        apply(game) {
            const kinds = new Set(anhydrideDehydrationCandidates(game.userMolecule)
                .filter(c => c.geo !== 'ok').map(c => c.geo));
            const parts = [];
            if (kinds.has('anti')) {
                parts.push('2つのカルボキシ基が**二重結合をはさんで反対側（トランス形）**にあります。' +
                    '向かい合っていないので、そのままでは環になりません。' +
                    'マレイン酸（シス形）は加熱すると容易に無水マレイン酸になりますが、' +
                    'フマル酸（トランス形）はなりません —— これが2つを見分ける決め手です。');
            }
            if (kinds.has('unknown')) {
                parts.push('二重結合のまわりが直線に描かれていて、**シスかトランスか図から読み取れません**。' +
                    '左の「⇄ シス/トランス整形」で描き分けてから、もう一度見てください。');
            }
            // ⚠ 箇所が0件でも押されうる（`onRuleClick` は detect の結果をそのまま渡す）ので、
            //    **必ず何か返す**（RX13 が「押しても解説が出ない」を見張っている）
            return {
                caption: parts.join('\n') ||
                    'この分子には、2つのカルボキシ基から水がとれて環になる並びがありません' +
                    '（5員環か6員環になる位置に -COOH が2つ要ります）。'
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
            if (!spot) throw noRoom('生成物を配置する空間がありません');
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
            // ⚠ **切る前に**橋の酸素がどちらの面に出ていたかを読む（引き離すと座標が動く）
            const dir = haworthCleaveDirection(mol, cId, oId);
            mol.removeBond(cId, oId);
            /* ★ **紙を回し始める位置**（`DESIGN_sugar.md` §4-9f）。
             * ⚠ すぐ下の引き離し（`separateComponent`）は相手を**真下へ 2 マス**動かす ——
             *   これを回し始めの位置にすると「回す前にもう下へ落ちている」＝
             *   ユーザー報告の**「分子全体が↓にスライドする」がここで作られる**。
             * ⚠ 引き離しそのものは**外さない**（描き直しが効かない糖のときの受け皿）。
             *   効いたときだけ、この位置から回した結果で置き直す。 */
            const arcFrom = mol.atoms.map(a => ({ id: a.id, x: a.x, y: a.y }));
            // 相手の単糖を引き離す（架橋酸素はそちらに残る ＝ そのまま -OH になる）
            const rest = [...componentOf(mol, oId)];
            if (!rest.includes(cId)) {
                const sep = separateComponent(mol, rest);
                if (sep) translateAtoms(mol, rest, sep.dx, sep.dy);
            }
            // 切った側には水から -OH が入る（自動水素が H を描く）。
            // ⚠ 置く向きは `haworthCleaveDirection` が決める ＝ もとの α/β を保つ
            const spot = freeSpotAround(mol, cId, [], dir);
            if (!spot) throw noRoom('生成物を配置する空間がありません');
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(cId, o.id, 1);
            /* ★ **切る前の図と切ったあとの図を対応させる**（段4-c）。
             * ユーザーの言葉（2026-08-22 ／ 検収条件は 2026-08-24）:
             *   **「フリップするのは加水分解前後の分子の形に対応するためです」**
             *   「教科書通りのスクロースの図が、加水分解すると**フルクトース部分が反転し**、
             *     教科書通りのグルコースとフルクトースの図になる」
             *   **「スクロースの加水分解は、反応前後の分子の表示が、どちらも教科書の図になるように」**
             *
             * 二糖の中では、片方の環は**相手とつながる都合で**単独のときと違う形に描かれている。
             * 切って1分子になった瞬間その理由は消えるので、**切り離された単糖を
             * 「その分子を単独で描くときの図」で描き直す** ＝ 前後の図が同じものを指していると読める。
             * ⚠ **v1447 は「たどる向き」だけを直していた。足りなかった**（`DESIGN_sugar.md` §1-2b 帰結2）。
             *   向きをそろえても**環の O の位置まではそろわない**ので「上下逆に見える」が残る。
             *   **図そのものを写す**と、検収条件（前後とも教科書の図）を構成的に満たせる。
             * ⚠ **位置は保つ**（重心を合わせる平行移動だけ。重なったら `separateComponent` で逃がす）。
             * ⚠ **分子の名前で分岐していない。** 名前は裏返しても絶対に変わらないので、
             *   名前で見ると「対応がずれている」ことに永久に気づけない（前のレーンがそれで外した）。
             * ⚠ **加水分解のときだけ呼ぶ**（作図のたびに呼ぶと、前後の対応と無関係に図を描き直す）。 */
            const redraws = game.redrawProductsAsStandalone({
                /* ★ **描き直す相手はこの加水分解で切り離された2つだけ**（ユーザー報告 2026-08-26
                 *   「となりの別分子もフリップする」）。⚠ これを渡さないと
                 *   `redrawProductsAsStandalone` は**キャンバス上の全分子**を回るので、
                 *   ユーザーが ⇅／⇄／⟳ で裏返して置いておいた別の糖まで
                 *   「単独で描くときの図」に戻ってしまう（実測: となりの β-D-グルコースが
                 *   最大 229px 動き、断り文にも切ってもいない分子の名前が出た）。
                 * ⚠ **原子IDは乱数**なので、切ったあとの連結成分から取る（順序に頼らない）。 */
                only: [...componentOf(mol, cId), ...componentOf(mol, oId)],
                /* ★ **できた単糖2つを横一列にそろえる**（v1453・`DESIGN_sugar.md` §4-9d）。
                 * ユーザー（2026-08-25・v1452 の実機確認後）:
                 *   **「加水分解後に、フルクトース分子がグルコース分子の横に並ぶ方がよいです」**
                 * 上の `separateComponent(rest)` は相手を**真下へ 2 マス**逃がすので、
                 * 描き直し（重心を保つ）を通しても生成物は斜め下に落ちたまま ＝ 横に並ばない。
                 * ⚠ そろえるのは**平行移動だけ**（図の中身は教科書のまま）。
                 * ⚠ **ここだけで頼む。** `alignRow` は既定 false なので、
                 *   一般の反応配置には影響しない。 */
                alignRow: true,
                /* ★★ **動かさない側 ＝ 切られた側**（`DESIGN_sugar.md` §4-9e）。
                 * ユーザー（2026-08-26・v1461〜v1466 の実機確認後）:
                 *   **「加水分解時に分子全体が↓にスライドするのをなくしたい」**
                 *   **「グルコースは固定、フルクトースが回転して真横→に移動し、
                 *     加水分解後の糖は2つ横に並ぶ」**
                 *   **「フルクトースは横回転と同時に↓に平行移動している、↓移動が不要」**
                 * ⚠ v1453 は「2断片の**中間**」を基準にしていたので**両方が縦に動き**、
                 *   画面ぜんたいが下へ滑って見えた。★ 基準を**切られた側**に置くと、
                 *   固定側は1pxも動かず、フリップする側は**横へ逃げるだけ**になる。
                 * ⚠ **切られた側 ＝ `cId` の連結成分**（引き離されるのは `oId` 側 ＝ `rest`）。 */
                anchor: [...componentOf(mol, cId)],
                /* ★★ **置き場所は「紙を 180° 回した結果」で決める**（`DESIGN_sugar.md` §4-9f）。
                 * ユーザー: **「すべての原子が紙面の右辺を軸に 180度回転する軌跡を通ればよい」**
                 *   **「フルクトースであれば、1,2 の炭素は大きな半径で移動し、5,6 は小さな半径で移動する」**
                 * ＝ 右へ／下へのずれは**こちらが与える値ではなく、回転から出てくる値**。 */
                arc: true,
                arcFrom,
                /* ★ 置き場所を決めるときに数えない原子（§4-9f）:
                 *   ① いま生やした -OH（切る前は存在しない）
                 *   ② 橋だった -O-（環から 121px 離れた橋の位置に描かれている。ふつうの枝は 38px）
                 * ⚠ 混ぜると、**切られる側でも重心が 43px ぶん引っぱられて固定側が動く**。 */
                fitIgnore: [o.id, oId],
                // 並べるときの重なりの物差し。⚠ **下の `escape` と同じものを渡す**
                //   （別々に持つと、並べた図を逃がす側が真下へ 2 マス飛ばす）
                overlaps: componentOverlaps,
                // 逃がし方は反応実行モードのもの（`separateComponent`）に倣う。
                // ⚠ **重なっているときだけ**動かす（`separateComponent` は必ず動かす向きを返すので、
                //   無条件に当てると重なっていない図まで飛ぶ）
                escape: (mol, ids) => componentOverlaps(mol, ids) ? separateComponent(mol, ids) : null
            });
            const drawn = [...new Set(redraws.filter(r => r.reshaped).map(r => r.name).filter(Boolean))];
            // ⚠ 画面に内部の言葉（「登録」＝ compounds.json の話）を出さない（v1447 の前科）
            const redrawNote = drawn.length
                ? `なお、切り離してできた${drawn.join('と')}は、二糖の中でつながっていたときの形のまま残っていたので、` +
                  '単独の分子として描くときの図に直しました。' +
                  '描き方が変わっても分子そのものは同じで、名前も変わりません。'
                : '';
            return {
                // ⚠ 描き直した記録は**呼び出し側へ返す**（あとで前後の対応をアニメーションにする人の材料）。
                //   `before` / `after` の座標が**同じ順序・同じ長さ**で入っているので、そのまま補間できる
                haworthRedraws: redraws,
                caption: 'グリコシド結合が加水分解されて、二糖が単糖2分子に分かれました。' +
                    '単糖どうしが縮合して -O- でつながったのが二糖なので、これはちょうどその逆向きです' +
                    '（C₁₂H₂₂O₁₁ ＋ H₂O → C₆H₁₂O₆ ×2）。' +
                    'マルトースはグルコース2分子に、ラクトースはグルコースとガラクトースに、' +
                    'スクロースはグルコースとフルクトースに分かれます。' +
                    'スクロースの加水分解でできる等量の混合物はとくに転化糖と呼ばれ、' +
                    'スクロース自身は還元性を示さないのに、加水分解すると還元性が現れます' +
                    '（両方のアノマー炭素がグリコシド結合に使われていたのが、切れて開環できるようになるため）。' +
                    '希硫酸のかわりに酵素（マルターゼ・ラクターゼ・インベルターゼ）でも同じ反応が進みます。' +
                    // ⚠ 図は α か β のどちらか1つに決めないと描けない（`haworthCleaveDirection`）。
                    //   決めたことを黙っていると「加水分解でこの形になる」と読まれるので、そう書く
                    'なお、切れてできた単糖は水の中で環が開いたり閉じたりして α形 と β形 が入れ替わっています（変旋光）。' +
                    'この図では、切る前にグリコシド結合が出ていた側に -OH を描いて片方の形だけを示しています。' +
                    redrawNote,
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
            if (!spot) throw noRoom('ナトリウムを置く空間がありません');
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
            if (!spot) throw noRoom('ナトリウムを置く空間がありません');
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
/* ⚠ **`ホルムアルデヒド` は §21-4 (e) の1本目（ビニロン）の入口**（2026-08-31）。
 * PVA を呼び出して見ているとき「＋ ホルムアルデヒド を呼び出す → アセタール化」の札が立つ。
 * ★ 札は名前の一致では出ない —— `findPartnerHints` が**実際に並べて `detect` を回し**、
 *   箇所が2分子にまたがったときだけ出す（＝ 相手を足しても何も起きない分子では出ない）。 */
const PARTNER_CANDIDATES = ['エタノール', 'メタノール', '酢酸', 'グリセリン', 'フェノール', 'ホルムアルデヒド'];

// 畳んだ見出しの札と id（v1420）。**文言と id は1か所**——テストと実装が同じものを見る
const PARTNER_HINTS_ID = 'partner-hints';
// ⚠ 「もう1つ」とは書かない（v1437・§15）。重合は**同じ単量体をもう2つ**要るので、
//    数を決め打つと札の中身（「＋ エチレン をもう2つ呼び出す」）と食い違う
const PARTNER_HINTS_SUMMARY = '相手の分子が要る反応';

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

/* ==========================================================================
 * ★★ 行きと帰りの対（`DESIGN_sugar.md` §4-8b (d) 問い①）
 *
 * ユーザーの決めた設計:
 *   「多くの高校生の学習者にとっては、**特定の反応のみ可逆的に見られる**のが最もわかりやすい」
 *
 * ★ **行き来できるかどうかは「直前に何をしたか」では決めない。ここに書いてあるかどうかで決める。**
 *   ⚠ これなら**不可逆な反応が可逆に見えることは原理的に起きない** ——
 *     アルコールの酸化のあとにこの案内が出ることは、表に無い以上ありえない。
 * ⚠ **切り替えスイッチは作らない**（化学の真偽を切り替える口になる）。
 *
 * ⚠ **ここに足すのは「教科書が両方向を書いている」対だけ。**
 *   - エステル化 ⇄ エステルの加水分解 …… 教科書が可逆反応として矢印を両方に引く定番
 *   - 糖の縮合 ⇄ 二糖の加水分解 …… 教科書は「2分子の単糖から水1分子がとれて二糖になる」と
 *     書き、加水分解も書く。⚠ **ただし縮合の側は組成の勘定**（`DESIGN_sugar.md` §4-8b の S-1）。
 *     だから下の案内文は「⇄ 平衡です」とは言わず、**両方の向きが見られる**とだけ言う。
 * ⚠ **アルコールの酸化などは足さない**（教科書が逆を書いていない）。
 *
 * ⚠⚠ **「↩ 反応前に戻す」（操作の取り消し）と混ぜない。**
 *   あちらは**押した手を無かったことにする**もので、水も消える。
 *   こちらは**もう1回反応させる**もので、水を加えて分ける ＝ 分子の数も増える。
 *   画面の言葉（`RX_REVERSE_*`）でその違いを言い切る。
 * ========================================================================== */
const REVERSIBLE_REACTION_PAIRS = [
    ['esterification', 'hydrolysis_ester'],
    ['condensation_glycoside', 'hydrolysis_glycoside'],
    /* ★ 分子内脱水 ⇄ 酸無水物の加水分解（v1472）。
     * ⚠ 教科書は**両方向とも本文に書いている**（フタル酸 → 無水フタル酸 p.184 ／
     * 無水物 ＋ 水 → カルボン酸）。★ §10.11-E が「戻す方だけ有る片道」と名指しした穴。 */
    ['dehydration_anhydride', 'hydrolysis_anhydride']
];

/** その反応の「帰り」にあたる反応の id（宣言が無ければ null）。⚠ 対は両向きに引ける */
function reverseRuleIdOf(ruleId) {
    for (const [a, b] of REVERSIBLE_REACTION_PAIRS) {
        if (ruleId === a) return b;
        if (ruleId === b) return a;
    }
    return null;
}

// 行きと帰りの案内の文言（**1か所**。テストと実装が同じものを見る）
// ⚠ 括弧を入れ子にしない（帰りの反応の名前自体に括弧が入っている。矢印でつなぐ）
const RX_REVERSE_LABEL = back => `🔁 逆向きの反応をする → ${back}`;
// ⚠ 内部の言葉（ルールid・「宣言」・「可逆」）を出さない。**何が起きるか**だけを書く
const RX_REVERSE_NOTE =
    'これは操作の取り消しではありません。もう一度反応させて、水を加えて元の分子に分けます' +
    '（↩ 反応前に戻す は、押した手そのものを無かったことにします）。';
// 帰りの反応が「いまはできない」ときの断り。⚠ **黙って出さないをしない**（v1434 の流儀）
const RX_REVERSE_MISSING = back =>
    `この反応には逆向きの反応（${back}）がありますが、いまの図では出せません` +
    '（できた分子がキャンバスに残っていて、必要な試薬の条件がそろっているときに出ます）。';


/**
 * 「いま見ている分子で絞っています」の断り（v1429）。
 *
 * ⚠ **黙って減らさない。** 隣の分子の反応を落とすだけだと
 * 「この分子には反応が無い」と読まれる。何で絞ったか・どうすれば隣を見られるかまで言う
 * （出口を名指しする点は RX39・`RX_UNDO_POINTER` と同じ約束）。
 *
 * ⚠ **1文にする。** この文の真上には既に「見出しの名前」「タブ」「分析中: ① 〜」と
 * 同じ分子名が3回出ている（375px の実測）。「いま見ているのは〜です」を独立した文にすると
 * 4回目の名乗りが1行まるごと増えるので、名前は絞り込みの説明の中に埋める。
 */
const RX_SCOPE_NOTE = name =>
    `いま見ている「${name}」が関わる反応だけを出しています` +
    '（ほかの分子の反応は、上のタブか図の分子名から切り替えると出ます）。';

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
    findSelfPartnerHints(game, baseIds, ruleIds, seenRules, hits);
    findCoPolymerHints(game, baseIds, ruleIds, seenRules, hits);
    return hits;
}

/* ==========================================================================
 * ★★ 縮合重合の入口（v1477・ユーザー要望 2026-08-28
 *    「ヘキサメチレンジアミン 可能な反応に 66ナイロンの合成が欲しい」）
 *
 * ★ **測ったこと**（:9137・ヘキサメチレンジアミンを1つだけ呼んだ画面）:
 *   できる反応 …… **アセチル化 1件だけ**
 *   相手が要る反応 … **酢酸 → アミド化 1件だけ**
 *   ＝ ナイロン66 はどこにも出ていない。理由は
 *   `condensationPolymerUnits` が **2価カルボン酸2個 ＋ 2価アミン2個（合計4分子）**を要求し、
 *   説明だけの `condensation_polymer_info` も **1個ずつ揃っているとき**にしか出ないため
 *   ＝ **1分子だけの人には、出ない理由すら画面に無い**。
 *
 * ★ **どちらを選んだか**: 「候補に出さないのが正しい」ではなく **出す** を選んだ。
 *   ① §15（v1437）で **1分子からでも重合へ行ける入口**を作ると既に決めている。
 *      付加重合だけ入口があって縮合重合に無いのは、決めの取りこぼし。
 *   ② ⚠ 実測で **呼び出すだけで最後まで通る**ことを確かめた ——
 *      ヘキサメチレンジアミン ＋ アジピン酸2つ ＋ 自分をもう1つ ＝ 4分子で
 *      `condensation_polymerization.detect` が **1箇所**返し、実行して 34原子の
 *      ポリアミドができた（`MAX_REACTION_SELECTION` は 4 ＝ ちょうど全部選べる）。
 *   ③ 説明だけ足す案（`condensation_polymer_info` を1分子でも出す）も測ったが、
 *      **押しても何も起きない札が1枚増えるだけ**で、ユーザーの要望
 *      （「可能な反応に 66ナイロンの合成が欲しい」）に応えていない。
 *
 * ⚠ **`SELF_PARTNER_RULES` には入れない**（あちらは「自分をもう何個か」だけの形）。
 *   ここは **相手を2つ ＋ 自分をもう1つ** ＝ 呼ぶ相手が2種類あるので、別の finder にする。
 * ⚠ **この表は「探す範囲」でしかない。** 出るかどうかを決めるのは
 *   `condensation_polymerization.detect`（＝ 化学の判定）で、名前の一致ではない
 *   （`PARTNER_CANDIDATES` とまったく同じ約束。そちらも名前の一覧）。
 * ⚠ **組にしてあるのは順番のため。** 一覧を平らな名前の並びにすると、
 *   アジピン酸に**エチレングリコール**が先に当たってしまう（化学としては正しい
 *   ポリエステルだが、教科書がアジピン酸の相手として書くのはヘキサメチレンジアミン）。
 *   ★ 組にしておくと、4つの単量体それぞれから**教科書が名前を付けている高分子**へ着く
 *   （`condensation_polymerization` の caption も、この2つだけを名指ししている）。
 * ⚠ **限界を隠さない**: 表に無い2価単量体（自分で描いた別のジアミンなど）では札が出ない。
 *   ライブラリ全体（900件超）から相手を探すこともできるが、
 *   **相手が複数見つかったときにどれを勧めるかを決める根拠が無い**ので採らなかった。
 * ========================================================================== */
const COPOLYMER_RULE = 'condensation_polymerization';
const COPOLYMER_PAIRS = [
    ['アジピン酸', 'ヘキサメチレンジアミン'],  // ナイロン66（ポリアミド）
    ['テレフタル酸', 'エチレングリコール']      // PET（ポリエステル）
];

function findCoPolymerHints(game, baseIds, ruleIds, seenRules, hits) {
    if (seenRules.has(COPOLYMER_RULE)) return;
    if (ruleIds && !ruleIds.includes(COPOLYMER_RULE)) return;
    const rule = REACTION_RULES.find(r => r.id === COPOLYMER_RULE);
    if (!rule || rule.info) return;
    const mol = game.userMolecule;
    // 呼べるのは**名前で引ける分子**だけ（自分をもう1つ呼ぶので、自分の名前も要る）
    const base = new Molecule();
    copyMoleculeInto(base, mol, baseIds, 0);
    const selfName = game.lookupCompoundName ? game.lookupCompoundName(base) : null;
    if (!selfName) return;
    const library = game.getCompoundLibrary() || [];
    const selfEntry = library.find(e => e.name === selfName);
    if (!selfEntry) return;
    // ⚠ **もう並べてある人には出さない**（§15 と同じ約束。押せる状態なのに「呼びなさい」は案内ではない）
    try { if (rule.detect(mol).length > 0) return; } catch (e) { return; }
    // 自分が入っている組の**相手側**だけを試す（組にしてある理由は上の注）
    const names = COPOLYMER_PAIRS
        .filter(pair => pair.includes(selfName))
        .map(pair => pair.find(n => n !== selfName));
    for (const name of names) {
        if (!name || name === selfName) continue;
        const entry = library.find(e => e.name === name);
        if (!entry) continue;
        /* 試算は**実際に呼び出されるもの**（ライブラリの分子）で、**呼び出す順のまま**組む。
         * ⚠ 順は 相手2つ → 自分1つ。`summonMolecule` は右へ横一線に並べ、
         *   `condensationPolymerUnits` は x で並べて 酸→相手→酸→相手 の鎖にするので、
         *   ここで順を変えると試算と本番がずれる */
        const trial = new Molecule();
        const mine = copyMoleculeInto(trial, mol, baseIds, 0);
        const theirs = new Set();
        const place = (src) => {
            const maxX = Math.max(...trial.atoms.map(a => a.x), 0);
            const minX = Math.min(...src.atoms.map(a => a.x), 0);
            copyMoleculeInto(trial, src, null, maxX - minX + 84).forEach(id => theirs.add(id));
        };
        place(entry.mol);
        place(entry.mol);
        place(selfEntry.mol);
        let sites = [];
        try { sites = rule.detect(trial) || []; } catch (e) { continue; }
        // 「呼び出したからできた」＝ 箇所が元の分子と呼び出した側の両方にまたがるものだけ
        const crossing = sites.filter(s => Array.isArray(s) &&
            s.some(x => mine.has(x)) && s.some(x => theirs.has(x)));
        if (!crossing.length) continue;
        seenRules.add(COPOLYMER_RULE);
        hits.push({
            name, label: rule.label, ruleId: COPOLYMER_RULE, siteCount: crossing.length,
            count: 2,              // 呼び出す相手の個数
            selfName, selfCount: 1 // ＋ 自分をもう何個（鎖にするには2組 ＝ 合計4分子）
        });
        return; // 1つの反応につき候補は1つまで（`findPartnerHints` の約束）
    }
}

/**
 * **相手が「自分と同じ分子」の反応**（重合）を、単量体を1つしか作っていない人にも見せる
 * （v1437・DESIGN_reaction_execution.md §15。ユーザー要望「１分子でも重合を出せるようにしたい
 * → 複数分子を横一線に並べ反応させる」）。
 *
 * ⚠ **既存の重合ルールは1文字も変えない。** `detect` の
 * `if (list.length < 2) return;`（＝ 同じ単量体が2つ以上並んでいるときだけ）は
 * 「横一列に単量体を並べた状態から重合するところを見たい」という過去のユーザー要望の実装で、
 * そこは**そのまま**。足すのは1分子の人のための**入口**だけ ―― v1424（濃硫酸の 130〜140℃）と
 * まったく同じ形で、`findPartnerHints` / `makePartnerHintButton` / `runPartnerHint` の
 * 3点セットをそのまま使う（新しい導線は作らない）。
 *
 * `PARTNER_CANDIDATES` の総当たりでは拾えない ―― あちらは
 * 「**別の化合物を1つ**足したら通るか」しか試さないため。
 */
// 同じ単量体を何個も並べて起こす重合（＝相手が自分自身の反応）。
// **縮合重合は入れない**: 相手が別の2価単量体で、しかも2組（4分子）要る ＝
// 「自分をもう何個か」では説明が付かない（`condensation_polymer_info` が説明を持っている）
/* ★ 2026-09-01（v1488）に `ring_opening_polymerization`（ε-カプロラクタム → ナイロン6）を追加。
 *   ⚠ **ここに入れてよい形である**ことを確かめてから足した ―― 相手は「自分と同じ分子」で、
 *   別の単量体も水も要らない（§21-3 (b)「入口は SELF_PARTNER_RULES に1行足すだけ」）。 */
const SELF_PARTNER_RULES = ['addition_polymerization', 'alkyne_polymerization', 'diene_polymerization',
    'ring_opening_polymerization'];
/**
 * 呼び出して並べる単量体の数（自分を含む）。**3 にした根拠**（v1437・§15.1 に実測）:
 *   ① このアプリ自身の高分子の図が「**3単位＋両端 R**」の規約（LB23）。実際
 *      アセチレンは3個のときだけ生成物が「ポリアセチレン」と名乗る（2個・4個は名乗らない）
 *   ② 2個では「くり返し」と「二量体」の区別が付かない。3個で初めて -A-A-A- と読める
 *   ③ `MAX_REACTION_SELECTION` が 4 ＝ 呼んだあと**全部を選べる上限**（5個だと
 *      `siteFilter()` の「箇所は選んだ分子の中に収まること」を満たせず、押せなくなる）
 *   ④ 重い順の心配は無い（実測: 3個の重合は 0.4ms・鎖の幅 294px・375px 幅でも
 *      結合1本 29px ＝ `SUMMON_MIN_BOND_PX` 24px を上回る）
 */
const SELF_PARTNER_UNITS = 3;

function findSelfPartnerHints(game, baseIds, ruleIds, seenRules, hits) {
    const mol = game.userMolecule;
    if (ruleIds && !SELF_PARTNER_RULES.some(id => ruleIds.includes(id))) return;
    // 呼び出せるのは**名前で引ける分子**だけ（`summonMolecule` が名前しか受け取らない）。
    // 土台（いま見ている分子）を切り出して名乗らせる
    const base = new Molecule();
    copyMoleculeInto(base, mol, baseIds, 0);
    const name = game.lookupCompoundName ? game.lookupCompoundName(base) : null;
    if (!name) return;
    const entry = (game.getCompoundLibrary() || []).find(e => e.name === name);
    if (!entry) return;
    // 試算は**実際に呼び出されるもの**（ライブラリの分子）で組む。
    // 置く間隔は `summonMolecule` と同じ「右へ2マス」に合わせる
    const trial = new Molecule();
    const mine = copyMoleculeInto(trial, mol, baseIds, 0);
    const theirs = new Set();
    const minX = Math.min(...entry.mol.atoms.map(a => a.x), 0);
    for (let k = 1; k < SELF_PARTNER_UNITS; k++) {
        const maxX = Math.max(...trial.atoms.map(a => a.x), 0);
        copyMoleculeInto(trial, entry.mol, null, maxX - minX + 84).forEach(id => theirs.add(id));
    }
    SELF_PARTNER_RULES.forEach(id => {
        if (seenRules.has(id)) return;
        if (ruleIds && !ruleIds.includes(id)) return;
        const rule = REACTION_RULES.find(r => r.id === id);
        if (!rule || rule.info) return;
        let sites = [];
        try {
            sites = rule.detect(trial);
        } catch (e) {
            return; // 案内のための試算なので、落ちたルールは黙って飛ばす
        }
        // 「同じ分子を足したからできた」＝ 箇所が呼び出した側にまたがっているものだけ
        const crossing = sites.filter(s => Array.isArray(s) &&
            s.some(x => mine.has(x)) && s.some(x => theirs.has(x)));
        if (!crossing.length) return;
        // ⚠ **もう並べてある人には出さない。** すでにその反応が押せる状態なのに
        //    「さらに2つ呼びなさい」と言うのは案内ではない（既存の要望どおり、
        //    自分で並べた人はそのまま重合できる）
        try {
            if (rule.detect(mol).length > 0) return;
        } catch (e) { /* 実物で落ちるなら案内も出さない側に倒す */ return; }
        seenRules.add(id);
        hits.push({
            name, label: rule.label, ruleId: id, siteCount: crossing.length,
            count: SELF_PARTNER_UNITS - 1 // 呼び出す個数（自分は既にある）
        });
    });
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
        // 🧹 分子を並べ直す（v1466）。場所不足で断ったときだけ同じ帯に出る出口
        this.lastNoRoom = null;   // { message } ＝ いま断られている理由（テストと報告の口）
        this.spreadBtn = document.getElementById('btn-rx-spread');
        if (this.spreadBtn) this.spreadBtn.addEventListener('click', () => this.spreadMolecules());
        this.syncSpreadButton();
    }

    /**
     * ★ 場所不足で断ったことを画面に出す（v1466・ユーザー決定 2026-08-26 の案「い」）。
     *
     * **なぜ**: 断り文は 25 か所あり、11 か所が「分子を離してから実行してください」と
     * 案内していた。⚠ **離す手段は `Shift＋ドラッグ` しかない**（判定は `game.js` の
     * `shiftKey` 1か所）ので、**Shift キーの無いタブレット・スマホでは案内どおりのことが
     * できない** ＝ 断り文が行き止まりになっていた。押せる出口を1つ足す。
     *
     * ⚠ **来る道は型で決める**（`e.noRoom`）。`e.message` を読んで「空間」の字を探す作りに
     *   すると、文言を1文字直しただけで札が出なくなる（静かに元の行き止まりへ戻る）。
     * ⚠ **理由は捨てない**。「どこに置けなかったか」（-OH／ナトリウム／生成物…）は
     *   人が次の手を決める材料なので、そのまま前半に残して出口の案内だけを足す。
     */
    showNoRoom(message) {
        this.lastNoRoom = { message };
        this.syncSpreadButton();
        this.game.showToast(
            `${message}。下の「🧹 分子を並べ直す」を押すと、分子どうしの間隔を空けます。`, 8000);
    }

    // 断りが解けた（反応が通った／反応前に戻した／キャンバスが空になった）ときに札を下ろす
    clearNoRoom() {
        this.lastNoRoom = null;
        this.syncSpreadButton();
    }

    syncSpreadButton() {
        if (!this.spreadBtn) return false;
        const show = !!this.lastNoRoom;
        this.spreadBtn.classList.toggle('hidden', !show);
        return show;
    }

    /**
     * ★ 「🧹 分子を並べ直す」を押したとき（v1466）。
     *
     * **実体は `game.tidyAnswerSlots()`** —— 異性体練習の「🧹 並べ直す」（W4・
     * `DESIGN_isomer_practice.md` §12-5）と**まったく同じ道具**を借りる。新しく書かない理由:
     *   - 成分ごとの**剛体平行移動だけ**（移動量は格子の整数倍・回転を混ぜない）と決まっており、
     *     「整形で幾何が変わるなら座標を戻す」「シス/トランスが未確定の図は整形しない」を
     *     すでに満たしている（検査は IW7）
     *   - 落下先の判定が `MIN_COMPONENT_CLEARANCE` ＝ Shift＋ドラッグ（`canMoveComponentBy`）と
     *     同じしきい値 ＝ 0.0px の完全重複を作る経路を増やさない
     *   - **`saveState()` を自分で積む** ＝ ↩ 戻す で1手で取り消せる（勝手に動いたと感じた人の逃げ道）
     *
     * ⚠ **並べ直したあと、反応を自動で実行し直さない。** 案「あ」（アプリが並べ直して再試行）を
     *   採らなかった理由がそれ ＝ ユーザーの操作を上書きしない。「もう一度お試しください」で止める。
     * ⚠ **入らなかったときは正直に言う。** 黙って何も起きないのがいちばん悪い（元の症状そのもの）。
     *   次の手は**タッチでも実際にできること**だけを挙げる:
     *     ・要らない分子を消す（消しゴム）
     *     ・結合線をドラッグして結合を伸ばす（`beginBondStretch`。`shiftKey` を見ないのでタッチで効く）
     *   ⚠ 「画面を広くする」は**書かない** —— 置き場所はモデル座標で決まるので、
     *      拡大率を変えても空きは1pxも増えない（できないことを案内しない）。
     */
    spreadMolecules() {
        const g = this.game;
        const r = g.tidyAnswerSlots();   // 中で saveState() を積む ＝ ↩ で戻せる
        const CANT = '要らない分子を消すか、結合線をドラッグして結合を伸ばすと空きます。';
        if (r.moved > 0) {
            this.clearNoRoom();   // 図が動いた ＝ さっきの断りはもう古い
            g.showToast(`分子 ${r.total}個を ${r.cols}×${r.rows} に並べ直しました。` +
                'もう一度お試しください（↩ 戻す で元に戻せます）。', 8000, 'success');
            return r;
        }
        // ここから先は**動かせなかった**場合。札は出したままにする
        // （分子を1つ消したあとに押せば通ることがあるため）
        if (r.reason === 'empty') g.showToast('キャンバスに分子がありません。', 6000);
        else if (r.reason === 'alreadyTidy')
            g.showToast(`分子はすでに離れていて、並べ直しても場所が足りませんでした。${CANT}`, 8000);
        else g.showToast(`並べ直しても場所が足りませんでした。${CANT}`, 8000);
        return r;
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
        this.clearNoRoom();          // 反応前へ戻す ＝ さっきの断りの前提ごと消える（v1466）
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
     *   0個 … **いま見ている分子**（分子モーダルが指す1分子）が関わる箇所だけ（v1429・下記）
     *   1個 … その分子の原子を含む箇所（相手はキャンバスの誰でもよい）
     *   2個以上 … 箇所が選択の中で完結し、かつ**2つ以上の選択分子に跨る**こと
     *
     * 「**すべての**選択分子に跨る」は2分子専用の条件で、3つ選んだ瞬間に
     * 2分子反応が全滅する（1回の反応が跨れるのは常に2分子だから）。
     * 油脂やジエステルは同じ反応を2〜3回繰り返して作るので、
     * 3分子以上を選んだままでも候補が出続けないと途中で手が止まる（レビュー項目15）。
     *
     * ★ **0個のときの既定を変えた**（v1429・ユーザーの実機報告 2026-08-20）:
     *   「ブタン酸とエチルメチルケトンを2つ並べた状態で、**ブタン酸の反応を見ると
     *     ヨードホルム反応が表示され、ボタンを押すとケトンが反応します**」。
     *   ここが `return true`（素通し）だったので、キャンバス全部の反応が混ざっていた。
     *   ⚠ 「🎯 反応させる分子を選ぶ」の選択と**分子モーダルで見ている分子は別物**で、
     *      モーダルを開いただけでは `selectedMoleculeSets()` は空のままだった。
     *   ⚠ 絞るのは「**見ている分子が1原子も関わらない**箇所」だけ ——
     *      エステル化のように2分子に跨る箇所は、見ている分子が片側なら残す
     *      （消すと v1420 の「相手を呼び出す → 反応」の導線が死ぬ）。
     *   ⚠ 選択があるときは**選択が勝つ**（既存の振る舞いは1行も変えない）。
     *
     * ⚠ **自動案内（`refresh()`）と試薬の瓶（`reagentHits()`）と呈色（`runDetection()`）が
     * 同じこの関数を使う。** 絞り込みを2か所に書くと、瓶からだけ出せる反応が生まれて
     * 「入口が2つでも中身は1つ」（DESIGN_reagent_palette.md RG4）が静かに破れる。
     * 返す `scope` は「反応に関われる原子の範囲」（null ＝ 全部）で、
     * 相手の呼び出しの試算（`findPartnerHints` の `baseIds`）もこれを見る
     */
    siteFilter() {
        const g = this.game;
        const selSets = g.selectedMoleculeSets ? g.selectedMoleculeSets() : [];
        const allSel = new Set();
        selSets.forEach(s => s.forEach(id => allSel.add(id)));
        // 何も選んでいないときの既定 ＝ いま見ている分子（2分子以上あるときだけ働く）
        const focus = (!selSets.length && g.moleculeModalAtomIds) ? g.moleculeModalAtomIds() : null;
        const scope = selSets.length ? allSel : focus;
        const atomAllowed = id => !scope || scope.has(id);
        /* ⚠ **第2引数は「ルール」**。`sites.filter(siteAllowed)` と書くと filter が第2引数に
         *   **添字**を渡してしまうので、呼ぶ側は必ず `sites.filter(s => siteAllowed(s, rule))` と書く。 */
        const siteAllowed = (site, rule) => {
            const ids = Array.isArray(site) ? site.filter(x => typeof x === 'string') : [];
            if (!ids.length) return true; // 箇所を持たない情報カードなどは絞らない
            if (!selSets.length) {
                /* ★ **「並べた単量体をまとめて」の反応はキャンバス全体が対象**（2026-08-26）。
                 * 動画レーンの実測: イソプレン×2 を重合してできた鎖 ① を見たまま
                 * イソプレン×2 を足して重合しようとすると、**ボタンが一覧から消えていた**。
                 * 箇所（②③ の8原子）に ① の原子が1つも無いのでここで落ちていた（実測 false）。
                 * `detect` 自体は正しく1件返しており、`apply` を直接呼べば成功する ＝
                 * **落としていたのはこの絞り込みだけ**。
                 * ⚠ v1429 の事故（ブタン酸を見ているのにケトンのヨードホルムが押せる）とは形が違う:
                 *   重合のラベルは「**並べた単量体をまとめて**」で、押した結果は必ずラベルどおり
                 *   ＝ 見ていない分子が黙って別の反応をするわけではない。
                 * ⚠ **選択があるときは今までどおり選択が勝つ**（この分岐は選択が無いときだけ）。 */
                if (rule && rule.wholeCanvas) return true;
                return !focus || ids.some(id => focus.has(id));
            }
            if (selSets.length === 1) return ids.some(id => allSel.has(id));
            if (!ids.every(id => allSel.has(id))) return false;
            return selSets.filter(s => ids.some(id => s.has(id))).length >= 2;
        };
        return { selSets, allSel, focus, scope, atomAllowed, siteAllowed };
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
            this.clearNoRoom();  // 分子が1つも無いなら「並べ直す」も用が無い（v1466）
            return;
        }

        const { selSets, focus, scope, siteAllowed } = this.siteFilter();
        this.renderSelectionNote(selSets, focus);

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
            // ⚠ `selSets.length &&` の門番は外した（v1429）。選択が無いときも
            //    「いま見ている分子」で絞る ＝ 判定は `siteAllowed` ただ1つに任せる
            if (!rule.info) sites = sites.filter(s => siteAllowed(s, rule));
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
        // ⚠ 試算の土台も同じ `scope`（v1429）。ここを全体のままにすると、
        //    「ブタン酸を見ているのに、隣のケトンに相手を足す案内」が生えて同じ混ざり方が残る
        if (this.partnerHintsVisible()) {
            this.renderPartnerHints(scope, executable > 0, nextSec);
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
            // ★ **行きと帰りの対**（`REVERSIBLE_REACTION_PAIRS`）。⚠ 出るかどうかは
            //    **表に書いてあるかどうか**だけで決まる ＝ 酸化のあとにここが生えることはない
            this.renderReverseCard(lastSec, mol, siteAllowed);
            /* ★ **教科書の外の話は消えないところに置く**（`rule.caveat`）。
             * 字幕（`showToast`）は 6.5 秒で消えるので、断りが字幕だけだと
             * **読み終わる前に消える**（`RX_GLYCOSIDE_CAVEAT` は 200字ある）。
             * ⚠ ここに出すのは `caveat` を持つ反応だけ ＝ 一般の反応の見え方は変えない。 */
            const lastRule = REACTION_RULES.find(r => r.id === this.lastReaction.ruleId);
            if (lastRule && lastRule.caveat) {
                const cv = document.createElement('div');
                cv.className = 'rx-caveat';
                cv.style.cssText = 'font-size:11px; line-height:1.6; color:var(--text-secondary); ' +
                    'border-left:2px solid var(--text-secondary); padding-left:6px;';
                // `**…**` は太字にして出す（v1467・game.js の `setEmphasisText`）。
                // いまの `caveat` に `**` は無いが、**同じ書き手の同じ種類の文言**なので
                // 出口だけ先に揃えておく（次に書かれたときに記号が漏れない）
                setEmphasisText(cv, lastRule.caveat);
                lastSec.appendChild(cv);
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
     * ★ 「いま起きた反応」の節に、**行きに対する帰り**の札を出す（`REVERSIBLE_REACTION_PAIRS`）。
     *
     * ★ **出す/出さないの判定は「対が宣言されているか」ただ1つ。**
     *   ⚠ 「直前に何をしたか」で可逆かどうかを決めない ——
     *     それだと**不可逆な反応も、直前にやったというだけで可逆に見えてしまう**。
     *     宣言に無い反応（アルコールの酸化など）は、何をした直後でもここに生えない。
     *
     * ⚠ **「↩ 反応前に戻す」と混ぜない。** 見た目も文言も別にする:
     *   - 帰りの札は**この節の中**（＝ 直近の反応という文脈の続き）／取り消しは**帯**
     *   - 帰りは「もう一度反応させて、水を加えて分ける」／取り消しは「押した手を無かったことにする」
     *   - ⚠ 帰りを押すと**反応が1つ積まれる**（この節の見出しが帰りの反応の名前に変わる）。
     *     取り消しはキャンバスを反応前へ戻し、この節ごと消える。
     *
     * ⚠ **押せないときも黙らない**（v1434「黙って減らさない」）。
     *   帰りの反応が宣言されているのに、いまの図では `detect` が0件のときは、
     *   札のかわりに一言だけ出す（`RX_REVERSE_MISSING`）。
     */
    renderReverseCard(sec, mol, siteAllowed) {
        const backId = reverseRuleIdOf(this.lastReaction.ruleId);
        if (!backId) return;
        const back = REACTION_RULES.find(r => r.id === backId);
        if (!back) return;
        let sites = [];
        try { sites = (back.detect(mol) || []).filter(s => siteAllowed(s, back)); } catch (e) { sites = []; }
        const note = document.createElement('div');
        note.style.cssText = 'font-size:11px; line-height:1.5; color:var(--text-secondary);';
        if (!sites.length) {
            note.className = 'rx-reverse-missing';
            note.textContent = RX_REVERSE_MISSING(back.label);
            sec.appendChild(note);
            return;
        }
        const btn = document.createElement('button');
        btn.className = 'view-btn rx-reverse-btn';
        btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px;';
        btn.dataset.reverseRule = back.id;
        btn.textContent = RX_REVERSE_LABEL(back.label) +
            (sites.length > 1 ? `（${sites.length}箇所）` : '');
        btn.addEventListener('click', () => this.onRuleClick(back, sites));
        sec.appendChild(btn);
        note.className = 'rx-reverse-note';
        note.textContent = RX_REVERSE_NOTE;
        sec.appendChild(note);
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
     *
     * ⚠ v1428 で瓶 `oxidant` を KMnO₄ / K₂Cr₂O₇ の2本に割ったので、**古い id は別名で受ける**
     *   （`REAGENT_ALIASES`）。外に出た `?reagent=oxidant` のリンクを黙って空振りにしないため。
     *   ルールが複数の瓶に繋がっているときは**先頭の瓶**に落とす（画面のどこかは必ず指す）。
     */
    selectReagent(key) {
        const q = String(key == null ? '' : key).trim();
        if (!q) return null;
        const canon = REAGENT_ALIASES[q] || q;
        let bottle = REAGENTS.find(r => r.id === canon) || null;
        let ruleId = null;
        if (bottle) {
            ruleId = null;
        } else {
            const rule = REACTION_RULES.find(r => r.id === canon);
            if (!rule) return null;                    // 知らない id ＝ 何もしない
            ruleId = rule.id;
            const first = ruleReagentIds(rule)[0];
            if (first) bottle = REAGENTS.find(r => r.id === first) || null;
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
        const { siteAllowed } = this.siteFilter();
        const hits = [];
        REACTION_RULES.forEach(rule => {
            if (!ruleUsesReagent(rule, reagent.id)) return;
            let sites = [];
            try {
                sites = rule.detect(mol);
            } catch (e) {
                console.error('反応ルール検出エラー:', rule.id, e);
                return;
            }
            if (!rule.info) sites = sites.filter(s => siteAllowed(s, rule));
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
     * ⚠ **瓶を名指ししない。** 判定は `condition` というデータの有無だけを見る。
     *    v1424 では濃硫酸（温度）にしか付いていなかったが、v1428 で酸化剤2本の
     *    「穏やかに／激しく」がそのまま乗った ——**この関数は1行も変えていない**（同書 §12-2）。
     */
    reagentOptions(reagent, hits) {
        if (!hits.some(h => h.rule.condition)) return hits;
        const byId = new Map(hits.map(h => [h.rule.id, h]));
        // 条件どうしは**隣り合わせて**並べる（間に条件なしの行き先が挟まると、
        // 「温度で割れている2つ」という読み方が崩れる）。それぞれの中では宣言順
        const conditioned = [], plain = [];
        REACTION_RULES.forEach(rule => {
            if (!ruleUsesReagent(rule, reagent.id)) return;
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
        if (options.length === 1) { this.runReagentHit(options[0], reagent); return; }
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
        const { atomAllowed } = this.siteFilter();
        const test = tests[0];
        let ids = [];
        try {
            ids = test.detect(mol) || [];
        } catch (e) {
            console.error('検出ルール検出エラー:', test.id, e);
        }
        // ⚠ 呈色も同じ絞り込みを通す（v1429）。通さないと「ケトンを見ているのに、
        //    隣に置いたカルボン酸のせいで NaHCO₃ が陽性」になる（反応の混ざり方と同根）
        ids = ids.filter(atomAllowed);
        const positive = ids.length > 0;
        const head = document.createElement('div');
        head.style.cssText = 'font-size:12px; font-weight:bold; ' +
            `color:var(--${positive ? 'neon-green' : 'text-secondary'});`;
        head.textContent = `${reagent.name}（${reagent.formula}）: ${positive ? '陽性' : '陰性'}`;
        note.appendChild(head);
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        // `**…**` は太字にして出す（v1467・game.js の `setEmphasisText`）
        setEmphasisText(p, (positive ? test.positive : test.negative) +
            '（この試薬は構造を変えません。図はそのままです）');
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
    runReagentHit(hit, reagent) {
        // 「選べるが、いまは材料が足りない」条件（v1424）。**押しても何も起きない、にしない**
        if (!hit.sites) { this.explainConditionMiss(hit.rule, reagent); return; }
        this.clearReagentNote();
        if (hit.rule.info) { this.showReagentInfo(hit.rule); return; }
        if (this.game.closeMoleculeModal) this.game.closeMoleculeModal();
        // ⚠ **押した瓶を持って行く**（v1428）。「効くが、ふつうはそちらを使わない」を
        //   結果に添えられるのは、どの瓶から来たかを知っているここから先だけ。
        //   反応カードから来た場合は `undefined` ＝ 添えない（試薬を選んでいないのだから言う相手がいない）
        this.onRuleClick(hit.rule, hit.sites, reagent);
    }

    // `info` ルールの解説を瓶の節に出す。**分子は1原子も変わらず・Undo も積まない**
    // （`apply` を呼ぶが、`info` ルールの `apply` は文を返すだけで書き換えない）
    showReagentInfo(rule) {
        const note = this.reagentNoteEl;
        if (!note) return;
        note.innerHTML = '';
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        // `**…**` は太字にして出す（v1467・game.js の `setEmphasisText`）
        setEmphasisText(p, rule.apply(this.game).caption);
        note.appendChild(p);
    }

    /**
     * 同じ瓶で行き先が2つ以上あるとき、条件を並べて選ばせる（同書 §2.4）。
     * 温度という概念はコードに持たない ——「同じ `reagentId` の行き先を
     * `condition.label`（無ければ `label`）で並べる」という**一般の選択UI**でしかない。
     * 要るのは濃硫酸の 160〜170℃／130〜140℃ と、酸化剤2本の 穏やかに／激しく（v1428）。
     *
     * ⚠ 並べるのは `reagentOptions()` が作った一覧で、**いま通っていない条件も混ざる**
     *   （`sites === null`。v1424・同書 §11）。通っていないものは
     *   「押せるが何も起きない」にせず、押すと `explainConditionMiss()` が足りないものを言う。
     *
     * ⚠ **「ふつうはこちら」は瓶で変わる**（v1428・同書 §12-2）。行き先を決めるのは条件で、
     *   試薬名が決めるのは**既定の強さ**だけ ——「KMnO₄ ならカルボン酸／K₂Cr₂O₇ ならアルデヒド」と
     *   覚えると、条件が明示されたときに読み違える。**印を付けるだけで、押せる選択肢は同じ。**
     *   判定は `rule.usually.reagentId` というデータどうしの比較で、瓶を名指ししない。
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
            // 「この試薬ならふつうこちら」の印（v1428）。**押せる選択肢は両方とも同じ**
            const usual = hit.rule.usually && hit.rule.usually.reagentId === reagent.id;
            if (usual && hit.sites) {
                b.dataset.condUsual = '1';
                b.style.cssText += ' border-color:var(--neon-green); color:var(--neon-green);';
            }
            b.textContent = (hit.rule.condition ? `${hit.rule.condition.label} → ` : '') +
                hit.rule.label +
                (!hit.sites ? '（いまの分子では条件が足りません）'
                    : (hit.sites.length > 1 && !hit.rule.info ? `（${hit.sites.length}箇所）` : '')) +
                (usual && hit.sites ? `（${reagent.name}ではふつうこちら）` : '');
            b.addEventListener('click', () => this.runReagentHit(hit, reagent));
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
    explainConditionMiss(rule, pressed) {
        const note = this.reagentNoteEl;
        if (!note) return;
        // ⚠ **押された瓶を優先する**（v1428）。1つのルールが複数の瓶にぶら下がるようになったので、
        //   ルールから瓶を引き直すと**押していないほうの一覧**を出し直してしまう
        const reagent = pressed || REAGENTS.find(r => ruleUsesReagent(rule, r.id));
        // 選び直せるように一覧ごと出し直す（説明で一覧が消えると、もう片方の温度へ戻れない）
        if (reagent) this.renderConditionChoice(reagent, this.reagentOptions(reagent, this.reagentHits(reagent)));
        else note.innerHTML = '';
        const cond = rule.condition || {};
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary); margin-top:6px;';
        const { scope } = this.siteFilter();
        const hints = this.cachedPartnerHints(scope, [rule.id]);
        p.textContent = `${cond.label || rule.label} を選びました。この条件で「${rule.label}」を起こすには、` +
            `${cond.needs || 'いまの分子には足りないものがあります'}。`;
        note.appendChild(p);
        if (hints.length > 0) {
            const q = document.createElement('div');
            q.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
            q.textContent = '相手を呼び出すとできます:';
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
        // ⚠ 両方の直しを合わせる（統合・2026-08-20）: 瓶の照合は ruleUsesReagent
        //    （v1428 で reagentId が配列になった）／土台は scope（v1429 で見ている分子に絞った）
        const ruleIds = REACTION_RULES.filter(r => ruleUsesReagent(r, reagent.id)).map(r => r.id);
        const { scope } = this.siteFilter();
        const hints = this.cachedPartnerHints(scope, ruleIds);
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        if (hints.length > 0) {
            p.textContent = `${reagent.name}（${reagent.formula}）は、いまの分子だけでは効きません。` +
                '相手を呼び出すとできます:';
            note.appendChild(p);
            // ★ 札の作り方も押したときの動きも**反応カードと同じ1つ**を使う（v1420）。
            //   ここだけ「呼び出して終わり」に戻ると、同じ文言の札が入口によって別の動きをする
            hints.forEach(h => note.appendChild(this.makePartnerHintButton(h)));
            return;
        }
        // `**…**` は太字にして出す（v1467・game.js の `setEmphasisText`）。`miss` の文言に多い
        setEmphasisText(p, `${reagent.name}（${reagent.formula}）が効くのは、${reagent.acts}。` +
            'いまの分子にはどれもありません。' + (reagent.miss || ''));
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
            ? '下の反応には相手の分子が要ります。押すと呼び出して、そこまで進めます:'
            : 'この分子だけではできる反応がありません。' +
              '下の反応には相手の分子が要ります。押すと呼び出して、そこまで進めます:';
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
        // 相手が**自分と同じ分子**のとき（重合）は、いくつ呼ぶのかを札に書く（v1437・§15）
        const times = Math.max(1, h.count || 1);
        if (times > 1) btn.dataset.count = String(times);
        /* 縮合重合は**相手2つ ＋ 自分をもう1つ**（v1477・§縮合重合の入口）。
         * ⚠ 呼ぶものが2種類あるので、札にも2種類とも書く ——「アジピン酸を2つ呼ぶ」だけだと
         *   なぜ4分子になるのかが読めない */
        const selfTimes = Math.max(0, h.selfCount || 0);
        if (selfTimes > 0) { btn.dataset.self = h.selfName || ''; btn.dataset.selfCount = String(selfTimes); }
        const call = selfTimes > 0
            ? `${h.name} を${times}つ と ${h.selfName} をもう${selfTimes}つ呼び出す`
            : times > 1 ? `${h.name} をもう${times}つ呼び出す` : `${h.name} を呼び出す`;
        const total = times + selfTimes;
        const pick = total > 1 ? `${total + 1}つ` : '2つ';
        btn.textContent = `＋ ${call} → ${h.label}${many}`;
        // 呼ぶものが2種類あるときは、説明でも2種類とも名指しする（札と食い違わせない）
        const 呼ぶ = selfTimes > 0 ? `${h.name} と ${h.selfName}` : h.name;
        btn.title = many
            ? `${呼ぶ} を呼び出し、${pick}を選んでから「${h.label}」の箇所を選びます`
            : `${呼ぶ} を呼び出し、${pick}を選んで「${h.label}」まで実行します`;
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
        // ① 相手を呼ぶ。**戻り値を見る** —— 名前が引けない／キャンバスの端まで並んだ、で false が返る。
        //    ⚠ 重合は相手が「自分と同じ分子」で、しかも**複数個**要る（v1437・§15）。
        //      `summonMolecule` は右へ横一線に並べるので、繰り返し単位がそのまま並ぶ
        const beforeIds = new Set(g.userMolecule.atoms.map(a => a.id));
        const times = Math.max(1, h.count || 1);
        for (let k = 0; k < times; k++) {
            if (!g.summonMolecule(h.name)) {
                return this.stopPartnerHint(h, 'summon',
                    `「${h.name}」を呼び出せませんでした（上の説明を見てください）。反応は実行していません。`);
            }
        }
        /* ★ 縮合重合は**自分ももう1つ**要る（v1477・§縮合重合の入口）。
         * ⚠ 呼ぶ順は 相手 → 自分。`summonMolecule` は右へ横一線に並べ、
         *   `condensationPolymerUnits` は x で並べて 酸→相手→酸→相手 の鎖にするので、
         *   `findCoPolymerHints` の試算と同じ順に置く。 */
        for (let k = 0; k < Math.max(0, h.selfCount || 0); k++) {
            if (!g.summonMolecule(h.selfName)) {
                return this.stopPartnerHint(h, 'summon',
                    `「${h.selfName}」を呼び出せませんでした（上の説明を見てください）。反応は実行していません。`);
            }
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
                `「${h.name}」は置けましたが、${times + Math.max(0, h.selfCount || 0) + 1}つを選んでも ` +
                `${h.label} が押せる状態になりませんでした。` +
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
     *
     * ⚠ **相手が1分子とは限らない**（v1437・§15）。重合は同じ単量体を
     * `SELF_PARTNER_UNITS` 個並べるので、呼び出した側が2つになる。
     * `siteFilter()` は「2つ以上選んだら箇所は選んだ分子の中に収まること」を要求するので、
     * **並べた全部を選ぶ**必要がある（3個 ≤ `MAX_REACTION_SELECTION` の4個）。
     * 上限に当たったら削るのは元からあった側（従来と同じ）。
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
        const keep = theirs.slice(0, Math.max(1, max - 1));
        g.selectedMolecules = mine.slice(0, Math.max(1, max - keep.length)).concat(keep);
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
    renderSelectionNote(selSets, focus) {
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
            } else if (focus) {
                // ★ 「いま見ている分子」で絞っていることを言う（v1429）。
                //   ⚠ 名前は `moleculeModalPart()` から引く ＝ 見出し（#mm-name）と必ず同じ分子。
                //     `focus` が立つのは2分子以上あるときだけなので、
                //     1分子の画面に文が生えることはない（従来どおり無言）
                const part = this.game.moleculeModalPart();
                const name = (part && (this.game.lookupCompoundName(part) ||
                    this.game.computeMolecularFormula(part))) || 'この分子';
                el.textContent = RX_SCOPE_NOTE(name);
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

    /**
     * `reagent` は**瓶から来たときだけ**渡る（反応カードから来たら `undefined`）。
     * 使い道は `usuallyNote()` の一言だけで、反応そのものには一切影響しない（同書 §12-3）。
     */
    onRuleClick(rule, sites, reagent) {
        if (rule.info) {
            // 解説のみ（実行なし・Undo履歴も積まない）。
            // 引数なしで呼ぶと、分子を見て文面を作る info ルール（縮合重合）が game を受け取れず
            // 落ちてトーストごと出なくなる（v331 の夜間監査で検出）。実行系と同じ引数で渡す
            this.game.showToast(rule.apply(this.game).caption, 6000, 'success');
            return;
        }
        this.narrow(rule, sites, reagent);
    }

    /**
     * 「**効くが、ふつうはそちらを使わない**」ときに結果へ添える一言（同書 §12-3・v1428）。
     *
     * ⚠ **`miss` とは別の棚**。`miss` は「効かない」で、瓶の節（`#mm-reagent-note`）に
     *   反応が起きなかったときだけ出る。こちらは**図が変わったうえで**トーストの結果に続けて出る。
     *   場所も言い方も別にしておかないと、「進まない」と「ふつうは使わない」が混ざって読まれる。
     *
     * ⚠ 主語は**「一般的には」**（＝実験室でもそうである化学の話）で始める。
     *   出題の作法の話は「入試では」で書き、こちらには混ぜない（§12-3 の3項）。
     */
    usuallyNote(rule, reagent) {
        const u = rule && rule.usually;
        if (!u || !reagent) return '';          // 反応カードから来たら言う相手がいない
        if (u.reagentId === reagent.id) return '';  // ふつうの組み合わせなら黙っている
        return u.note || '';
    }

    // 適用箇所が複数あるときは、候補を分けている原子だけをハイライトしてクリックで絞り込む。
    // 1クリックで決まらない場合（カルボン酸×アルコールの組み合わせなど）は繰り返し絞り込む
    narrow(rule, sites, reagent) {
        if (sites.length === 1) {
            this.execute(rule, sites[0], reagent);
            return;
        }
        const ids = new Set();
        sites.forEach(s => s.forEach(id => ids.add(id)));
        const distinguishing = [...ids].filter(id => !sites.every(s => s.includes(id)));
        /* ★ **安全弁**（v1467・§20）。残った候補の原子の集合が全部同じだと、どの原子を
         *   押しても候補は1件に絞れない ―― 以前はここで全原子をハイライトして選ばせ直して
         *   いたので、押す → 同じ候補に戻る → 押す …… と**箇所選びが永久に終わらなかった**
         *   （実測: 加硫で 7候補 → 3候補 → 3候補 → 3候補。硫黄は1つも入らない）。
         *   分けられないということは**どれを選んでも同じ4原子が反応する**ということなので、
         *   先頭（＝ルールが「いちばん良い」と並べた1件）をそのまま実行する。
         *   ⚠ 加硫は `vulcanizablePairs` 側でも同一の組を1件にまとめてある（§20）。
         *      ここは**他のルールが同じ轍を踏まないための止め**で、通常は素通りする。 */
        if (!distinguishing.length) {
            this.execute(rule, sites[0], reagent);
            return;
        }
        // 図の形も覚えておく（v1420）。再描画が来たときに「まだ同じ図か」を見て、
        // 同じなら選ばせ続ける（`syncPicking`）。
        // 押した瓶も一緒に持っておく（箇所選びを挟んでも「ふつうはこちら」の一言が消えない）
        this.picking = { rule, sites, reagent, topo: this.topologyKey(this.snapshotMolecule(this.game.userMolecule)) };
        const atoms = distinguishing
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
        const { rule, sites, reagent } = this.picking;
        this.picking = null;
        this.game.clearUIOverlay();
        if (atom) {
            const matched = sites.filter(s => s.includes(atom.id));
            if (matched.length === 1) {
                this.execute(rule, matched[0], reagent);
                return true;
            }
            if (matched.length > 1) {
                this.narrow(rule, matched, reagent); // まだ決まらないので再度選ばせる
                return true;
            }
        }
        this.game.showToast('適用箇所の選択を解除しました。');
        return true;
    }

    execute(rule, site, reagent) {
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
            // ★ 場所不足だけは出口を添える（v1466）。**判定は型（`e.noRoom`）で行う**——
            //   `e.message` の字を読む作りにすると、文言を1文字直した日に静かに札が出なくなる
            if (e && e.noRoom) this.showNoRoom(e.message);
            else g.showToast('この反応は実行できませんでした: ' + e.message);
            return;
        }
        /* 「効くが、ふつうはそちらを使わない」の一言を**結果に添える**（v1428・同書 §12-3）。
         * ⚠ `apply` の外で足す ——「どの瓶から来たか」は反応の中身ではないので、
         *   `apply` に瓶ごとの分岐を1つも入れないまま言える（§12-1 の約束）。 */
        const note = this.usuallyNote(rule, reagent);
        if (note) result = { ...result, caption: `${result.caption}\n${note}` };
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
        this.clearNoRoom();  // 同じ理由で「置く場所がない」の札も下ろす（v1466）
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

    /**
     * ★ いま2段階モーフィングの①で止まっているか（止まっていれば説明の材料を返す）。
     * キャンバスの常設バッジ（`game.canvasModeBadgeSpec`）が読む（v1454）。
     * ⚠ **文言はここに持たない** —— 画面に出す言葉はバッジ側（game.js）の1か所にまとめる。
     */
    morphPauseInfo() {
        const p = this._morphPause;
        return p ? { stages: p.stages || null, now: p.now || '', next: p.next || '' } : null;
    }

    // 中間で止めた2段階モーフィングの続き（第2段階）を再生する。クリックで呼ばれる
    advanceMorph() {
        const p = this._morphPause;
        if (!p) return false;
        this._morphPause = null;
        // ★ 止まっている印はここで消す（下の `updateDrawing()` は 800ms の再生が
        //   終わってからなので、それを待つとバッジだけ 0.8秒 遅れて残る）
        this.game.syncCanvasModeBadge();
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
        /* ★★ 紙のフリップ（`DESIGN_sugar.md` §4-9f）。⚠ **直線補間ではなく 180° の回転**で見せる。
         *   ここで返ると、下のふつうのモーフィングは走らない（＝ 二糖の加水分解だけの経路）。 */
        if (this.haworthFlipShots(result).length) {
            this.animateHaworthFlip(before, after, result, highlight);
            return;
        }
        /* ★★ **1組ずつ順に見せる**（v1488・ユーザー判断 D-P5）。
         * ⚠ ビニロンのアセタール化は**1タップで 2/3 まで進めて終わり**にしたので、
         *   「押すたびに1組」で得られるはずだった「隣どうしが組むところが1組ずつ見える」を
         *   ここで拾う ―― `apply` が**1組できるごとに写したコマ**（`morphSequence`）を
         *   順につなぎ、各段はさらに「①寄る → ②結合ができる」の2つに割る
         *   （`joinFirst` とまったく同じ割り方。⚠ 2つの操作を1回の補間に混ぜない）。
         * ⚠ **組が1つのときは今までどおり**（段が1つ ＝ 既存の見え方と同じ）。 */
        if (Array.isArray(result.morphSequence) && result.morphSequence.length) {
            this.animateMorphSequence(before, result.morphSequence, highlight);
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
                const next = morphStages === 'bondsFirst' ? '鎖状に整列します' : '結合ができて環が閉じます';
                const now = morphStages === 'bondsFirst' ? '環の形のまま結合が切れた' : '環の形に折りたたんだ';
                this._morphPause = { mid, after, gen, highlight, stages: morphStages, next, now };
                this.renderStaticSnapshotWithHydrogens(mid);
                g.showToast(`①第1段階（${now}状態）で止めています。ここで水素の数と位置も確認できます。画面をクリックすると②${next}。`, 9000);
                // ★ **止まっていることを画面に残す**（v1454・ユーザー申し立て「環になっていない」）。
                //   ⚠ トーストは 9秒で消えるが、止まった図はそのまま残る ＝ 消えたあとの画面は
                //   「環が閉じていない図」に「β-D-グルコピラノース」という名前が付いた絵になり、
                //   **なぜそう見えるのかがどこにも書いていない**（実測。§12-4）。
                //   バッジは `updateDrawing()` の先頭でそろえるが、止まっているあいだは
                //   その `updateDrawing()` を通らない描き方（`renderStaticSnapshotWithHydrogens`）を
                //   しているので、ここで1回そろえる
                g.syncCanvasModeBadge();
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

    /* ==========================================================================
     * ★★ 紙のフリップのアニメーション（`DESIGN_sugar.md` §4-9f・ユーザー発注 2026-08-26）
     *
     * **ユーザーの言葉**（そのまま）:
     * > **理想は、紙のフリップを再現する軌跡を演算して原子を移動すること
     * >   （移動中も糖の構造が変形しない）**
     * > **すべての原子が紙面の右辺を軸に 180度回転する軌跡を通ればよい**
     * > **フルクトースであれば、1,2 の炭素は大きな半径で移動し、5,6 は小さな半径で移動する**
     * > **回転するときに軸をマーカーで表示するとより3Dアニメっぽくなり、わかりやすくなるかも**
     *
     * ⚠ **v1467 までは始点→終点の直線補間**だった ＝ 原子が近道を通るので、途中の形は
     *   どの瞬間も本物ではない。★ ここは**軸まわりの剛体回転**を1コマずつ解く。
     * ★ **z（キャンバス平面からの高さ）は `haworthFlipFrame` が返すコマの中だけの使い捨ての値**で、
     *   `Molecule` には1つも入らない（`CLAUDE.md`「検証はトポロジーのみ・座標は見た目専用」）。
     * ⚠ **途中のコマで結合や原子を足し引きしない**（動くのは座標だけ）。
     * ========================================================================== */

    /**
     * ★★ **途中経過を1組ずつ順に見せる**（v1488・ビニロンのアセタール化）。
     *
     * `apply` が「1組できるごとに写したコマ」を `morphSequence` で渡す。ここでは
     * **前 → コマ1 → コマ2 → …** を順につなぎ、**各段をさらに「①寄る → ②結合ができる」**
     * の2つに割って再生する（割り方は `joinFirst` と同じ `buildMidSnapshot('moveFirst')`）。
     *
     * ⚠ **2つの操作を1回の補間に混ぜない**（`animateHaworthFlip` と同じ約束）。
     * ⚠ 最後のコマは `after` そのものなので、ここでは `after` を別に受け取らない。
     * ⚠ 組が1つのときは段も1つ ＝ **今までの見え方と同じ**（新しい経路を増やしただけ）。
     */
    animateMorphSequence(before, stages, highlight) {
        const g = this.game;
        const gen = ++this._morphGen;
        this._morphing = true;
        this._morphSkip = false;
        const smoothstep = t => t * t * (3 - 2 * t);
        const stop = () => this._morphSkip || this._morphGen !== gen;
        const shots = [before, ...stages];
        this.renderMorphFrame(shots[0], shots[1], 0);  // 先に反応前を描く（ちらつき防止）
        const run = (k) => {
            if (this._morphGen !== gen || this._morphSkip || k + 1 >= shots.length) {
                return Promise.resolve(null);
            }
            const from = shots[k], to = shots[k + 1];
            const mid = this.buildMidSnapshot(from, to, 'moveFirst');
            return animateFramesLoop(450,
                t => { if (this._morphGen === gen) this.renderMorphFrame(from, mid, smoothstep(t)); },
                stop
            ).then(() => {
                if (this._morphGen !== gen || this._morphSkip) return null;
                return animateFramesLoop(400,
                    t => { if (this._morphGen === gen) this.renderMorphFrame(mid, to, smoothstep(t)); },
                    stop);
            }).then(() => run(k + 1));
        };
        run(0).then(() => {
            if (this._morphGen !== gen) return;
            this._morphing = false;
            g.updateDrawing();   // 自動水素を含む最終分子を描き直す
            highlight();
        });
    }

    /** 回す断片の一覧（回さない分子なら空配列） */
    haworthFlipShots(result) {
        return (result && result.haworthRedraws || [])
            .filter(r => r.flip && r.flip.steps && r.flip.steps.length && r.flip.start && r.flip.end);
    }

    /** 回転の軸を破線で描く（⚠ 結合の線と読み違えられないよう、色も破線も別にする） */
    renderFlipAxis(step, pts) {
        const g = this.game;
        if (!g.bondsGroup || !pts.length) return;
        const pad = 60;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        if (step.kind === 'leftright') {
            const ys = pts.map(p => p.y);
            line.setAttribute('x1', step.axis); line.setAttribute('x2', step.axis);
            line.setAttribute('y1', Math.min(...ys) - pad); line.setAttribute('y2', Math.max(...ys) + pad);
        } else {
            const xs = pts.map(p => p.x);
            line.setAttribute('y1', step.axis); line.setAttribute('y2', step.axis);
            line.setAttribute('x1', Math.min(...xs) - pad); line.setAttribute('x2', Math.max(...xs) + pad);
        }
        line.setAttribute('stroke', '#ffd166');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '10 8');
        line.setAttribute('opacity', '0.85');
        line.setAttribute('data-flip-axis', step.kind);   // ⚠ 回し終えたら1つも残らないこと（FA1）
        g.bondsGroup.appendChild(line);
    }

    /**
     * 回す → （2手目があればもう一度回す）→ 寄せる、の順で再生する。
     * ⚠ **2つの操作を1回の補間に混ぜない**（ユーザー「操作ごとにアニメーションを段階で行う」）。
     */
    animateHaworthFlip(before, after, result, highlight) {
        const g = this.game;
        const shots = this.haworthFlipShots(result);
        const gen = ++this._morphGen;
        this._morphing = true;
        this._morphSkip = false;
        const smoothstep = t => t * t * (3 - 2 * t);
        const stop = () => this._morphSkip || this._morphGen !== gen;
        // 段の組み立て: 各断片の回転を順に並べ、最後に「寄せる」を1段
        const legs = [];
        shots.forEach(shot => {
            shot.flip.steps.forEach((step, i) => legs.push({ kind: 'turn', shot, step, i }));
            legs.push({ kind: 'slide', shot });
        });
        const posAt = (leg, t) => {
            const map = new Map();
            if (leg.kind === 'turn') {
                // ★ 剛体の 180° 回転。⚠ 直線補間ではない ＝ 軌跡は弧になる
                haworthFlipFrame(leg.step.hinge, Math.PI * t).forEach(p => map.set(p.id, p));
            } else {
                // 寄せる（平行移動だけ）。⚠ ここだけは直線でよい —— 形はもう変わらない
                const to = new Map(leg.shot.after.map(p => [p.id, p]));
                leg.shot.flip.end.forEach(p => {
                    const q = to.get(p.id) || p;
                    map.set(p.id, { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
                });
            }
            return map;
        };
        const run = (k) => {
            if (this._morphGen !== gen) return Promise.resolve(null);
            if (k >= legs.length || this._morphSkip) return Promise.resolve(null);
            const leg = legs[k];
            const dur = leg.kind === 'turn' ? 900 : 350;
            // 断り: 全体の進み具合（結合の消え方・新しい -OH の出方に使う）
            const t0 = k / legs.length, span = 1 / legs.length;
            return animateFramesLoop(dur, t => {
                if (this._morphGen !== gen) return;
                const e = smoothstep(t);
                const map = posAt(leg, e);
                this.renderMorphFrame(before, after, Math.min(1, t0 + span * e), map);
                if (leg.kind === 'turn') this.renderFlipAxis(leg.step, [...map.values()]);
            }, stop).then(() => run(k + 1));
        };
        this.renderMorphFrame(before, after, 0, posAt(legs[0], 0));
        run(0).then(() => {
            if (this._morphGen !== gen) return;
            this._morphing = false;
            g.updateDrawing();   // ⚠ ここで軸のマーカーも消える（bondsGroup が描き直される）
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
    interpolateMorph(before, after, t, override) {
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
        /* ★ `override` … その原子だけ位置を差し替える（`DESIGN_sugar.md` §4-9f の紙の回転）。
         * ⚠ **結合の端点を組む前に当てる**（あとから当てると線だけ取り残される）。 */
        if (override) atoms.forEach(a => {
            const p = override.get(a.id);
            if (p) { a.x = p.x; a.y = p.y; }
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
    renderMorphFrame(before, after, t, override) {
        const g = this.game;
        g.atomsGroup.innerHTML = '';
        g.bondsGroup.innerHTML = '';
        const frame = this.interpolateMorph(before, after, t, override);
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
        /* ★ **次数も一緒に返す**（v1477・ユーザー実機報告「二重結合のうち一本が切れて、
         *   新たな結合が生じる様子をわかりやすくしたい」）。
         *   `from`/`to` があると、`renderCompareFigure` が
         *     2 → 1（**線1本ぶんだけ**切れた）と 1 → 0（結合ごと切れた）を描き分けられる。
         *   ⚠ 差分の求め方そのものは1行も変えていない（返す情報が増えただけ）。 */
        const lostBonds = [];   // 消えた・次数が下がった結合 → 反応前の図
        beforeB.forEach((b, k) => {
            const to = typeAt(afterB, k);
            if (b.type > to) { const s = seg(before, b); if (s) lostBonds.push({ ...s, from: b.type, to }); }
        });
        const gainedBonds = []; // 生成した・次数が上がった結合 → 反応後の図
        afterB.forEach((b, k) => {
            const from = typeAt(beforeB, k);
            if (b.type > from) { const s = seg(after, b); if (s) gainedBonds.push({ ...s, from, to: b.type }); }
        });
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
        /* 凡例（v1477・ユーザー実機報告「レジェンドの『オレンジ』や『シアン』は色なので、
         * 文字で説明する必要がない」）。
         * ★ **色の見本は残し、色の名前だけ落とす** ＝ 見本を見れば分かることを字で言わない。
         * ★ かわりに、字でしか言えないこと（**線1本ぶんの印**の意味）を1行足す。 */
        const legend = document.createElement('div');
        legend.id = 'rx-cmp-legend';
        legend.style.cssText = 'font-size:11px; color:var(--text-secondary); line-height:1.7; margin-bottom:10px;';
        const swatch = (color, text) =>
            `<span class="rx-legend-item"><span class="rx-legend-swatch" aria-hidden="true" ` +
            `style="display:inline-block; width:22px; height:5px; border-radius:3px; ` +
            `vertical-align:middle; margin-right:4px; background:${color};"></span>${text}</span>`;
        legend.innerHTML =
            swatch('var(--neon-orange)', '切れた結合・脱離した原子（反応前）') + '　' +
            swatch('var(--neon-blue)', 'できた結合') + '　' +
            swatch('var(--neon-green)', '付加した原子（反応後）') +
            '<br><span class="rx-legend-half">二重結合の**片方の線だけ**に印が付いているときは、' +
            'その**1本ぶん**が切れた（できた）という意味です。</span>';
        // `**…**` は太字にして出す（v1467・game.js の `setEmphasisText` と同じ見た目にそろえる）
        const halfEl = legend.querySelector('.rx-legend-half');
        if (halfEl && typeof setEmphasisText === 'function') setEmphasisText(halfEl, halfEl.textContent);
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
    /* ===== 差分の印の描き方（v1477・ユーザー実機報告 2026-08-28） =====
     *
     * **ユーザーの言葉**:
     * > **イソプレンの付加重合 二重結合のうち一本が切れて、新たな結合が生じる様子を
     * >   わかりやすくしたい**
     * > **反応の前後を見比べる、で、オレンジのマーカーが太く、裏が二重結合になっている
     * >   ところがわかりづらい**
     *
     * ★ **測ったこと**（:9137・イソプレン3個の 1,4-付加重合の前後比較）:
     *   二重結合 … 平行な2本・線幅 **2.2px**・間隔 **5px** ＝ 横幅 **7.2px**
     *   印 …………… 線幅 **7px**・不透明度 **0.9**・**いちばん最後に append** ＝ 結合線の**上**
     *   ＝ **二重結合の横幅の 97% を、9割の濃さで塗りつぶしていた**（だから裏が読めない）。
     *
     * ★ **どう直したか（案を2つ測って選んだ）**:
     *   **案A（採った）** … ① 印を結合線の**下**に敷く（蛍光ペン）＋
     *     ② 次数が下がっただけの結合（2→1）は**消える1本の位置**（垂直 ±2.5px の片側）に細く引く
     *     ＝「二重結合のうち一本が切れる」がそのまま図になる。手数 **約25行**。
     *     レイアウト・図の大きさ・台本には1つも触らない。
     *   **案B（採らなかった）** … 段を分けて3コマ（反応前 → 切れた瞬間 → 反応後）にする。
     *     ⚠ 中間の実体が `lastReaction` に無いので**保存から作る**必要があり、
     *       2列 → 3列でコマ幅が **213px → 約 140px**（実測 445px の枠から算出）。
     *       ★ **「見やすくする」ための変更で図が小さくなる**ので採らなかった。手数 80行以上。
     *
     * ⚠ **色そのものは変えていない**（オレンジ＝切れた／シアン＝できた／緑＝付加した原子）。
     *   変えたのは**重ね順・太さ・濃さ**と、**1本ぶんかどうかの描き分け**だけ。 */
    renderCompareFigure(svgId, snapshot, marks) {
        renderMoleculeIntoSvg(this.game, svgId, this.snapshotToTarget(snapshot));
        const svg = document.getElementById(svgId);
        if (!svg) return;
        const NS = 'http://www.w3.org/2000/svg';
        const hi = document.createElementNS(NS, 'g');
        hi.setAttribute('class', 'rx-diff-layer');
        (marks.bonds || []).forEach(bm => {
            /* ★ 「二重結合の1本ぶんだけ」か「結合まるごと」かで引き方を変える。
             * `to > 0` ＝ 結合は残る（次数だけ 2 → 1）＝ **消える／できる線は1本**なので、
             * `renderTargetBond` が2本を置く位置（垂直 ±2.5px）の**片側**に細く引く。
             * ⚠ 2.5 は `renderTargetBond` の二重結合の実体（`nx = -uy * 2.5`）と同じ値。
             *   ここを勝手な数にすると、印が線の上に乗らずに横へずれる。 */
            /* ⚠ 「1本ぶん」＝ **前も後も結合はある**（次数だけ変わった）とき。
             *   どちらか片方が 0 なら結合そのものが消えた／生えたので、まるごとの印にする
             *   （`to > 0` だけで見ると、新しくできた単結合 0→1 まで「1本ぶん」に化ける・実測） */
            const half = bm.from > 0 && bm.to > 0;
            const dx = bm.x2 - bm.x1, dy = bm.y2 - bm.y1;
            const len = Math.hypot(dx, dy) || 1;
            const ox = half ? (-dy / len) * 2.5 : 0;
            const oy = half ? (dx / len) * 2.5 : 0;
            // ⚠ 端は結合線と同じだけ縮める（`renderTargetBond` の offsetStart/End ＝ 10px）。
            //   縮めないと印が原子の中心まで伸び、線1本の印が原子の丸から食み出す
            const tx = (dx / len) * 10, ty = (dy / len) * 10;
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', bm.x1 + ox + tx); line.setAttribute('y1', bm.y1 + oy + ty);
            line.setAttribute('x2', bm.x2 + ox - tx); line.setAttribute('y2', bm.y2 + oy - ty);
            line.setAttribute('stroke', bm.color);
            // 線の下に敷くので、細く・濃く。まるごとの印は蛍光ペンの幅（結合線がその上に乗る）
            line.setAttribute('stroke-width', half ? '5' : '9');
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('opacity', half ? '0.95' : '0.45');
            line.setAttribute('class', 'rx-diff-mark' + (half ? ' rx-diff-half' : ''));
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
        /* ★★ **結合線より下に敷く**（v1477）。ここが `svg.appendChild(hi)` だったので、
         *   7px の印が 7.2px の二重結合をまるごと覆っていた。
         *   ⚠ 原子の丸（`.quiz-atoms`）よりも下 ＝ 原子名も印に隠れない。 */
        svg.insertBefore(hi, svg.firstChild);
    }
}

// テスト（test.html）・コンソールデバッグ用にグローバル公開する。
// const はトップレベルでも window のプロパティにならないため明示が必要（chemistry.js と同じ流儀）。
if (typeof window !== 'undefined') {
    window.REACTION_RULES = REACTION_RULES;
    window.REAGENTS = REAGENTS;                 // 試薬瓶（RG1 の死にリンク検査が読む）
    window.DETECTION_TESTS = DETECTION_TESTS;   // 呈色・検出（RG7・RG8 が読む）
    // `reagentId` が文字列でも配列でもよいことを、テスト側も同じ関数で読む（v1428）
    window.ruleReagentIds = ruleReagentIds;
    window.ruleUsesReagent = ruleUsesReagent;
    window.REGISTERED_NAMES = REGISTERED_NAMES;
    // 行きと帰りの対（GC5 が「宣言した2組だけ」を検査する）
    window.REVERSIBLE_REACTION_PAIRS = REVERSIBLE_REACTION_PAIRS;
    window.reverseRuleIdOf = reverseRuleIdOf;
    window.aromaticSiteRole = aromaticSiteRole; // 配向性（テスト・検証ツール用）
    window.bondStep = bondStep;                 // その分子の作図の刻み（RX19 の距離判定で使う）
    window.acetalizableDiols = acetalizableDiols; // PY5〜PY8（ビニロン）が読む
    window.lactamUnits = lactamUnits;             // PY10〜PY13（開環重合）が読む
    window.PARTNER_CANDIDATES = PARTNER_CANDIDATES;
    window.SELF_PARTNER_RULES = SELF_PARTNER_RULES; // PM5・PM6（1分子からの重合の入口）が読む
    window.SELF_PARTNER_UNITS = SELF_PARTNER_UNITS;
    window.PARTNER_HINTS_ID = PARTNER_HINTS_ID;
    window.PARTNER_HINTS_SUMMARY = PARTNER_HINTS_SUMMARY;
    window.findPartnerHints = findPartnerHints; // RX35（位置に依らないことの実測）が読む
    window.RX_SECTION_NEXT = RX_SECTION_NEXT;   // RX40（節の見出し）が読む
    window.RX_SECTION_LAST = RX_SECTION_LAST;
    window.RX_UNDO_POINTER = RX_UNDO_POINTER;
    window.RX_SCOPE_NOTE = RX_SCOPE_NOTE;       // RX43（「いま見ている分子」の断り）が読む
    window.NoRoomError = NoRoomError;           // RS1〜RS4（場所不足の出口）が読む
    window.noRoom = noRoom;
}
