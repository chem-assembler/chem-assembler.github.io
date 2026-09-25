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

/* ===== 加水分解は水を使う（v1584・発注書 G。V134 のユーザー指摘）=====
 *
 * ⚠ **脱水で出た水が、加水分解のあとも画面に残っていた**
 *   （フタル酸 →〔酸無水物〕→ 無水フタル酸＋水 →〔加水分解〕→ フタル酸 ＋ **水** ）。
 *   結末の表示も「① フタル酸 ＋ ② 水」で、**反応式の収支と画面が食い違う**。
 * ★ 加水分解は水を**使う**側なので、画面の水を1分子引き取って消す。
 * ⚠ **消すのは「結合を1本も持たない酸素」だけ**（＝ 自動水素で H₂O と描かれているもの）。
 *   結合を持つ酸素はどこかの分子の一部なので触らない。
 * ★ 近い水から取る ＝ さっき自分が出した水が、そのまま戻ったように見える。
 *
 * @returns 引き取った水の原子（無ければ null）
 */
function takeWaterFromCanvas(mol, nearId) {
    const near = mol.atoms.find(a => a.id === nearId);
    const waters = mol.atoms.filter(a => a.element === 'O' &&
        !mol.bonds.some(b => b.atomId1 === a.id || b.atomId2 === a.id));
    if (!waters.length) return null;
    // 反応で出た水を先に取る（人が置いた酸素より、さっき出た水を戻すほうが筋が読める）
    const pick = waters.filter(a => a.fromReaction);
    const pool = pick.length ? pick : waters;
    let best = pool[0];
    if (near) pool.forEach(a => {
        if (Math.hypot(a.x - near.x, a.y - near.y) < Math.hypot(best.x - near.x, best.y - near.y)) best = a;
    });
    const i = mol.atoms.indexOf(best);
    if (i >= 0) mol.atoms.splice(i, 1);
    return best;
}

/* ===== 環をつくる前の姿を控える／戻す（v1584・発注書 G）=====
 *
 * ⚠ **加水分解で戻ったフタル酸の -COOH の向きが、最初に置いたフタル酸と違っていた**
 *   （ユーザー実機報告・V134）。**同じ分子に戻ったのに見た目が変わる**ので、
 *   「元に戻った」が画から読めない。
 * ★ 原因は**脱水の側**にある: 五角形／六角形に置き直すときに -COOH まわりを動かしていて、
 *   加水分解で環を開いても**動かした座標のまま**だった。
 * ★ 直し方は「戻すときの作図をやり直す」ではなく、**行きで控えて帰りで戻す**。
 *   座標は見た目専用（CLAUDE.md）なので、控えを持っても化学は1つも変わらない。
 * ⚠ 戻した先に別の原子が居たら**戻さない**（あとから描き足した図の上に重ねない）。 */
const PRE_RING_XY = 'preRingXY';   // その原子が環になる前に居た場所
const OH_HOME_XY = 'ohHomeXY';     // そのアシル炭素の -OH がどこに付いていたか

/** 脱水の直前に控える。`ids` は座標を動かしうる原子、`ohOf` は 炭素id → その -OH の原子 */
function rememberPreRing(mol, ids, ohOf) {
    ids.forEach(id => {
        const a = mol.atoms.find(x => x.id === id);
        if (a) a[PRE_RING_XY] = { x: a.x, y: a.y };
    });
    Object.entries(ohOf).forEach(([cId, oh]) => {
        const c = mol.atoms.find(x => x.id === cId);
        if (c && oh) c[OH_HOME_XY] = { x: oh.x, y: oh.y };
    });
}

/**
 * 加水分解のあとに元の姿へ戻す。控えを持っている原子だけが動く
 * （＝ ライブラリから呼び出した無水フタル酸には控えが無いので、今までどおりの図になる）。
 * @returns 戻したなら true
 */
function restorePreRing(mol, ids, extraMoving = []) {
    // ⚠ `ids` は呼び出し側で重ねて渡される（環＋成分＋印）ので**必ず重複を落とす** ——
    //   同じ原子を2度なぞると、1度目で控えを消したあと2度目が undefined を読む（実測）
    const kept = [...new Set(ids)].map(id => mol.atoms.find(a => a.id === id))
        .filter(a => a && a[PRE_RING_XY]);
    if (!kept.length) return false;
    /* ⚠ **呼び出し側がこのあと置き直す原子は「邪魔者」に数えない。**
     *   加水分解で生えた -OH の酸素は、まさに戻し先（もとの -OH の場所）の上に立っている
     *   ので、数えると必ずぶつかって**一度も戻せなくなる**（実測でここに落ちた）。 */
    const moving = new Set(kept.map(a => a.id).concat(extraMoving));
    const others = mol.atoms.filter(a => a.element !== 'H' && !moving.has(a.id));
    // 戻り先が空いているか（あとから描き足した図の上に重ねない）
    const clash = kept.some(a => others.some(o =>
        Math.hypot(o.x - a[PRE_RING_XY].x, o.y - a[PRE_RING_XY].y) < GRID_SIZE * 0.6));
    if (clash) return false;
    kept.forEach(a => { a.x = a[PRE_RING_XY].x; a.y = a[PRE_RING_XY].y; delete a[PRE_RING_XY]; });
    return true;
}

/* ⚠ -OH の酸素を引くのは **既にある `hydroxylOxygenOf`**（3200行台）を使う。
 *   ⚠⚠ ここで同じ名前の関数をもう1つ書いたら、**後ろの宣言が黙って勝って**
 *   「原子を返すつもりが id が返る」壊れ方をした（実測。図はそのままで例外も出ない）。 */

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
// 酸無水物（-CO-O-CO-）は同じ -CO-O- の形をしているが、加水分解は起こっても
// 「エステルの加水分解・けん化」ではないので専用ルール（hydrolysis_anhydride）に任せる。
// ⚠ v1592 で **findFunctionalGroups 自身が anhydride を別の型で返すようになった**ので、
//   下の isAnhydrideLinkage の filter はもう素通りする。`isAmideNitrogen` と同じ二重の防波堤として
//   残してある（反応ルールを読むときに「酸無水物は入らない」が条件として見えるように）
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
        copyAtomMarks(na, a);   // 面マークと電荷（I-3）
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
 * ★★ **アシル-酸素開裂の共通部分**（v1490・CV1）。
 * C-O 結合を切り、**O は切り離される側に残ってそのまま -OH になり**、C の側には
 * 水から来た -OH を新しく生やす。エステルの加水分解・けん化・酸無水物の加水分解・
 * グリコシド結合の加水分解が、**同じ十数行を4か所に別々に持っていた**ので1つにした。
 *
 * ★ **この関数のいちばんの仕事は `changed`（オレンジの破線を出す原子）を返すこと。**
 * ⚠ 切る反応は **2つの分子**を作るのに、印の列挙は呼び出し側の記憶に任されていた
 *   （`reactor.js` の `changed:` は 34か所あって書き方がばらばら）。その結果、
 *   **エステルの加水分解・けん化・酸無水物の加水分解の3つで `oId` が落ちていた**
 *   ＝ 酢酸エチルを加水分解すると**酢酸だけが光ってエタノールが光らない**
 *   （ユーザー実機報告・V125 の完成品・2026-08-28）。
 *   ⚠ 同じ形の `hydrolysis_glycoside` は `oId` を入れてあった ＝ **うっかりではなく
 *   「列挙を人に任せる設計」の問題**。次に切る反応を足す人が忘れられない形にするのが直し。
 * ★ 悉皆の見張りは **`CV1`**（反応で分子が分かれたら、分かれたどちらにも印が付く）。
 *
 * opts.dir  … 生やす -OH の向き（ハース図の α/β を保つため。糖のときだけ渡す）
 * opts.onCut … 結合を切った直後・引き離す前に呼ぶ（糖が「紙を回し始める位置」を控える口）
 */
function cleaveAcylOxygen(mol, cId, oId, opts = {}) {
    mol.removeBond(cId, oId);
    if (opts.onCut) opts.onCut();
    const rest = [...componentOf(mol, oId)];
    if (!rest.includes(cId)) {
        // 環（ラクトン・環状酸無水物）でなければ別の分子として引き離す
        const sep = separateComponent(mol, rest);
        if (sep) translateAtoms(mol, rest, sep.dx, sep.dy);
    }
    const spot = freeSpotAround(mol, cId, [], opts.dir);
    if (!spot) throw noRoom('生成物を配置する空間がありません');
    const o = mol.addAtom('O', spot.x, spot.y);
    mol.addBond(cId, o.id, 1);
    // ★ 酸の側（cId と生えた o）だけでなく、**切り離される側へ行く oId** も必ず入れる
    return { o, spot, changed: [cId, o.id, oId] };
}

/**
 * エステルの C-O 結合を切る（アシル-酸素開裂）。O はアルコール側に残る。
 * asSalt=false … 切った先に -OH を付けてカルボン酸にする（加水分解）
 * asSalt=true  … -COO⁻ ＋ Na⁺ にしてカルボン酸の塩にする（けん化）
 */
function cleaveEster(game, site, asSalt) {
    const [cId, , oId] = site;
    const mol = game.userMolecule;
    const { o, spot, changed } = cleaveAcylOxygen(mol, cId, oId);
    if (!asSalt) {
        return {
            caption: 'エステルが加水分解されて、カルボン酸とアルコールに分かれました。' +
                     '酸を触媒に使うこの反応は平衡なので、逆のエステル化も同時に起こります。',
            changed
        };
    }
    // 塩にする: 生えた -OH を -COO⁻ にして、相方の Na⁺ を粒で置く。
    // Na の置き場が無いときは酸のままにせず、ここで止める（中途半端な図を残さないため）
    const na = ionizeSalt(mol, o.id);
    if (!na) throw noRoom('ナトリウムイオンを置く空間がありません');
    return {
        caption: 'けん化が起こりました。水酸化ナトリウムを使うので、できるのはカルボン酸ではなく' +
                 '**カルボン酸のナトリウム塩**です（油脂なら脂肪酸ナトリウム＝セッケンそのもの）。' +
                 '塩になると逆のエステル化が起こらないため、反応は完全に進みます。',
        changed: [...changed, na.id]
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
 * ★★ 対イオンの粒（**結合を持たない**電荷つき原子）を、相方の原子のそばに置く（I-3・D-I5）。
 *
 * ⚠⚠ **線で結ばない。** N-Cl と線1本で書くと分子式が C₆H₆ClN ＝
 *   **N-クロロアニリンという別の分子の図**になる（DESIGN_ion_layer.md §3-1 の実測）。
 *   粒は `MONATOMIC_ION_ELEMENTS` で価標 0 なので、自動水素も生えず結合も持てない。
 * ★ 置き場は**2マス離す**。1マスだと -NH₃⁺ の自動水素（H が3つ）と重なって読めない
 *   ——登録済みの `aniline-hydrochloride` も N から2マスの位置に Cl⁻ を持っている。
 *   ⚠ 2マス先が塞がっていたら1マスに落とす（置けたはずのものを置けなくしない）。
 * 置き場がまったく無ければ null（呼び出し側が `noRoom` を投げる ＝ 図を壊さない）。
 */
function placeCounterIon(mol, nearId, element, charge) {
    const near = mol.atoms.find(a => a.id === nearId);
    const spot = near ? freeSpotAround(mol, nearId) : null;
    if (!spot) return null;
    const G = bondStep(mol, nearId);
    const far = { x: near.x + (spot.x - near.x) * 2, y: near.y + (spot.y - near.y) * 2 };
    const clear = (p) => !mol.atoms.some(o => o.element !== 'H' &&
        Math.hypot(o.x - p.x, o.y - p.y) < G * 0.65);
    const at = clear(far) ? far : spot;
    const ion = mol.addAtom(element, at.x, at.y);
    ion.charge = charge;
    return ion;
}

/**
 * ★ その原子と同じ成分に居る、結合を持たない対イオンの粒（電荷の符号で選ぶ）。
 * ⚠ 連結成分では**別の成分**なので、探すのは分子全体から「いちばん近いもの」——
 *   同じ塩が2つ並んでいても、それぞれの粒が自分の相方に付く
 *   （`game.js` の `attachCounterIons` と**同じ決め方**。見せ方と外し方で規則を割らない）。
 */
function nearestCounterIon(mol, atomId, sign) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a) return null;
    const bonded = new Set();
    mol.bonds.forEach(b => { bonded.add(b.atomId1); bonded.add(b.atomId2); });
    return mol.atoms
        .filter(x => !bonded.has(x.id) && Math.sign(x.charge || 0) === sign)
        .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0] || null;
}

/* ===== 分液の水層で、対イオンの粒を「自分の相方のそば」に保つ（v1569・発注書 C）=====
 *
 * ★★ **塩はもう電離した形で描いている**（v1538）。直すのは**粒の置き場**だけ。
 *   実測（v1567・V141 の手4／V143 の手3）: 安息香酸ナトリウムの Na⁺ は O⁻ の右2マスに置かれ、
 *   あとからフェノールが隣で -O⁻ になると、**その Na⁺ はフェノキシドの O⁻ のほうが近い**。
 *   相方は距離で組む（`saltMetalPairs`・`attachCounterIons`）ので、
 *   ① 図では Na⁺ がどちらの塩のものか読めない
 *   ② CO₂ を吹き込むと**安息香酸側の Na⁺ が外され**、フェノキシド側の Na⁺ が
 *      安息香酸イオンから 227px 離れて残る（V143 の手4）
 *   —— 分子式・名前・層は合っているので、他の検査は全部通っていた。
 *
 * ★ 決め方: 反応の**前**に「どの粒が誰の相方か」を控え（その時点では紛れていない）、
 *   反応で増えた粒は「その反応で電荷が付いた原子」の相方として足す。
 *   反応と層の移動のあと、**水層の粒が紛れていたら**（自分の相方より近い逆符号の原子がある／
 *   よその成分の原子のほうが近い）相方のまわりの格子点へ置き直す。
 * ⚠ **紛れていない粒は1 px も動かさない**（単独の塩・アニリン塩酸塩の見た目は今までどおり）。
 * ⚠ **場面の境界は `applyToMixture`**（分液の面を開いて瓶を押したとき）。反応の一覧・
 *   名前から呼び出した塩・参考書の図は通らない。有機層（印の無い成分）の粒も動かさない。
 * ⚠ 座標は見た目専用（CLAUDE.md）＝ 結合・電荷・正準コードには触らない。
 */
function counterIonOwners(mol) {
    const owners = new Map();   // 粒の id → 相方の原子の id
    if (typeof saltMetalPairs === 'function') {
        saltMetalPairs(mol).forEach((m, oId) => owners.set(m.id, oId));
    }
    // 陰イオンの粒（Cl⁻ など）は -NH₃⁺ などの陽イオン側と1対1で組む（近い順）
    const bonded = new Set();
    mol.bonds.forEach(b => { bonded.add(b.atomId1); bonded.add(b.atomId2); });
    const anions = mol.atoms.filter(x => !bonded.has(x.id) && x.charge < 0);
    const cations = mol.atoms.filter(x => bonded.has(x.id) && x.charge > 0);
    const cand = [];
    anions.forEach(ion => cations.forEach(c => cand.push({ ion, c, d: Math.hypot(ion.x - c.x, ion.y - c.y) })));
    cand.sort((p, q) => (p.d - q.d) || (p.ion.x - q.ion.x) || (p.ion.y - q.ion.y));
    const usedC = new Set();
    cand.forEach(({ ion, c }) => {
        if (owners.has(ion.id) || usedC.has(c.id)) return;
        owners.set(ion.id, c.id); usedC.add(c.id);
    });
    return owners;
}

/** 反応で増えた粒を、その反応で電荷が付いた（符号が逆の）原子の相方として控えに足す */
function adoptNewCounterIons(mol, owners, beforeIds, beforeCharge) {
    const bonded = new Set();
    mol.bonds.forEach(b => { bonded.add(b.atomId1); bonded.add(b.atomId2); });
    const fresh = mol.atoms.filter(a => !beforeIds.has(a.id) && !bonded.has(a.id) && a.charge);
    const charged = mol.atoms.filter(a => bonded.has(a.id) && a.charge &&
        (beforeCharge.get(a.id) || 0) !== a.charge);
    const added = [];
    fresh.forEach(ion => {
        const mate = charged
            .filter(a => Math.sign(a.charge) === -Math.sign(ion.charge) && ![...owners.values()].includes(a.id))
            .sort((p, q) => Math.hypot(p.x - ion.x, p.y - ion.y) - Math.hypot(q.x - ion.x, q.y - ion.y))[0];
        if (mate) { owners.set(ion.id, mate.id); added.push(ion.id); }
    });
    // 消えた粒は控えから外す（遊離で粒が取れた）
    [...owners.keys()].forEach(id => { if (!mol.atoms.some(a => a.id === id)) owners.delete(id); });
    return added;
}

/**
 * 粒がその位置で「自分の相方のもの」と読めるか。
 * ① 逆符号の電荷をもつ（結合のある）原子のうち、相方がはっきりいちばん近い
 * ② よその成分の原子より、自分の成分の原子のほうがはっきり近い（`attachCounterIons` が同じ成分に付ける）
 * ③ ほかの原子と重ならない
 */
function counterIonReadsClearly(mol, ionId, mateId, at = null) {
    const ion = mol.atoms.find(a => a.id === ionId);
    const mate = mol.atoms.find(a => a.id === mateId);
    if (!ion || !mate) return true;
    const p = at || ion;
    const G = bondStep(mol, mateId);
    const d = (x) => Math.hypot(x.x - p.x, x.y - p.y);
    const dMate = d(mate);
    const bonded = new Set();
    mol.bonds.forEach(b => { bonded.add(b.atomId1); bonded.add(b.atomId2); });
    if (mol.atoms.some(x => x.id !== ionId && x.element !== 'H' && d(x) < G * 0.65)) return false;
    if (mol.atoms.some(x => x.id !== mateId && bonded.has(x.id) &&
        Math.sign(x.charge || 0) === -Math.sign(ion.charge) && d(x) < dMate + G * 0.3)) return false;
    // 相方の連結成分（粒は結合を持たないので、ここには入らない）
    const mine = new Set([mateId]);
    const stack = [mateId];
    while (stack.length) {
        const id = stack.pop();
        mol.getNeighbors(id).forEach(n => { if (!mine.has(n.atom.id)) { mine.add(n.atom.id); stack.push(n.atom.id); } });
    }
    const nearMine = Math.min(...mol.atoms.filter(x => mine.has(x.id)).map(d));
    const foreign = mol.atoms.filter(x => !mine.has(x.id) && x.id !== ionId && bonded.has(x.id));
    if (foreign.length && Math.min(...foreign.map(d)) < nearMine + G * 0.1) return false;
    return true;
}

/**
 * 水層（`phase === 'aq'`）の粒のうち、紛れているものだけを相方のそばへ置き直す。
 * `extraIds` は「まだ印は無いが、これから水層へ行く」粒（同じ反応で増えたもの）。
 * 置き場は相方から格子の2マス → 1マス → 斜めの順。どこも紛れるなら動かさない。
 */
function tidyAqueousCounterIons(mol, owners, extraIds = []) {
    const extra = new Set(extraIds);
    const G = typeof GRID_SIZE === 'number' ? GRID_SIZE : 42;
    const steps = [[2, 0], [-2, 0], [0, -2], [0, 2], [1, 0], [-1, 0], [0, -1], [0, 1],
        [2, -1], [-2, -1], [2, 1], [-2, 1], [1, -2], [-1, -2], [1, 2], [-1, 2],
        [1, -1], [-1, -1], [1, 1], [-1, 1], [2, -2], [-2, -2], [2, 2], [-2, 2]];
    const moved = [];
    owners.forEach((mateId, ionId) => {
        const ion = mol.atoms.find(a => a.id === ionId);
        const mate = mol.atoms.find(a => a.id === mateId);
        if (!ion || !mate) return;
        if (!(mate.phase === 'aq' || extra.has(ionId))) return;   // 有機層の塩は触らない
        if (counterIonReadsClearly(mol, ionId, mateId)) return;
        for (const [sx, sy] of steps) {
            const at = { x: mate.x + sx * G, y: mate.y + sy * G };
            if (!counterIonReadsClearly(mol, ionId, mateId, at)) continue;
            ion.x = at.x; ion.y = at.y;
            moved.push(ionId);
            return;
        }
    });
    return moved;
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
        if (comp.has(a.id)) map.set(a.id, copyAtomMarks(probe.addAtom(a.element, a.x, a.y), a).id);
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
 * ★ カルボキシ基のナトリウム塩 -COO⁻ Na⁺ を取り付ける（コルベ・シュミット反応・I-2）。
 *
 * ⚠ `attachGroup` の `kind` に足さなかった理由: あちらは「アンカー1つ ＋ その枝」の形しか
 *   置けない（枝はアンカーに直結する）。-COO⁻ は **C → O の2段 ＋ 離れた Na⁺ の粒**なので入らない。
 * ★ 形は `attachAcetyl`（C → =O ＋ CH₃）と同じ流儀で、**かたまりごと重ならない向きを探す**。
 * `dryRun=true` なら置かずに「置けるか」だけ返す（検出段階で実行できない候補を出さないため）。
 */
function attachCarboxylate(mol, targetId, dryRun = false) {
    const MIN_CLEARANCE = bondStep(mol, targetId) * 0.65;
    for (const spot of outwardCandidates(mol, targetId)) {
        const cos = Math.cos(spot.angle), sin = Math.sin(spot.angle);
        const oDouble = { x: spot.x + spot.step * Math.cos(spot.angle + Math.PI / 2),
                          y: spot.y + spot.step * Math.sin(spot.angle + Math.PI / 2) };
        const oSingle = { x: spot.x + spot.step * cos, y: spot.y + spot.step * sin };
        const na = { x: spot.x + spot.step * 2 * cos, y: spot.y + spot.step * 2 * sin };
        const points = [{ x: spot.x, y: spot.y }, oDouble, oSingle, na];
        const hitsExisting = points.some(p => mol.atoms.some(o =>
            o.id !== targetId && o.element !== 'H' && Math.hypot(o.x - p.x, o.y - p.y) < MIN_CLEARANCE));
        const hitsSelf = points.some((p, i) => points.some((q, j) =>
            j > i && Math.hypot(p.x - q.x, p.y - q.y) < MIN_CLEARANCE));
        if (hitsExisting || hitsSelf) continue;
        if (dryRun) return true;
        const cAcid = mol.addAtom('C', spot.x, spot.y);
        mol.addBond(targetId, cAcid.id, 1);
        const oD = mol.addAtom('O', oDouble.x, oDouble.y);
        mol.addBond(cAcid.id, oD.id, 2);
        const oS = mol.addAtom('O', oSingle.x, oSingle.y);
        mol.addBond(cAcid.id, oS.id, 1);
        // ★ 塩は電離した形（v1538）。O に -1 を入れ、Na⁺ は**線で結ばず粒で**置く
        oS.charge = -1;
        const naAtom = mol.addAtom('Na', na.x, na.y);
        naAtom.charge = 1;
        return [cAcid.id, oD.id, oS.id, naAtom.id];
    }
    if (dryRun) return false;
    throw noRoom('カルボキシ基のナトリウム塩を置く空間がありません');
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
 * **単独のベンゼン環**（縮合していない6員の芳香環）を、環の原子IDの配列で返す。
 *
 * ★ 数え方は `findAromaticBondKeys` の**結合**から成分に組み直す
 * （6員閉路の列挙を2つ持たないため）。**原子6個・結合6本ちょうど**の成分だけを通すので、
 * ⚠ **ナフタレンのような縮合環は落ちる**（原子10・結合11）。ビフェニルは2つ返る。
 *
 * ⚠ **なぜ縮合環を落とすか**: ナフタレンに水素を1つの環だけ付加した形（テトラリン）は
 * 教科書が扱わないうえ、登録も無い。★ アプリが名前を言い切れないものを作らない。
 */
function isolatedBenzeneRings(mol) {
    const keys = findAromaticBondKeys(mol);
    const bonds = mol.bonds.filter(b => keys.has(
        b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`));
    const adj = new Map();
    bonds.forEach(b => {
        if (!adj.has(b.atomId1)) adj.set(b.atomId1, []);
        if (!adj.has(b.atomId2)) adj.set(b.atomId2, []);
        adj.get(b.atomId1).push(b.atomId2);
        adj.get(b.atomId2).push(b.atomId1);
    });
    const seen = new Set(), out = [];
    for (const startId of adj.keys()) {
        if (seen.has(startId)) continue;
        const ids = new Set([startId]), stack = [startId];
        seen.add(startId);
        while (stack.length) {
            const x = stack.pop();
            (adj.get(x) || []).forEach(y => {
                if (seen.has(y)) return;
                seen.add(y); ids.add(y); stack.push(y);
            });
        }
        const inside = bonds.filter(b => ids.has(b.atomId1) && ids.has(b.atomId2));
        if (ids.size === 6 && inside.length === 6) out.push([...ids]);
    }
    return out;
}

/**
 * フェノールの工業的製法2本のための、置き換わる基を探す（v1511）。
 *
 * ★ どちらも **芳香環についた基が -O⁻ Na⁺ に置き換わる**という同じ形なので、
 *   探すところと置き換えるところを1つにまとめる（同じ判定を2つ書かない）。
 *
 *   kind === 'sulfonate' … アルカリ融解。**-SO₃Na（ナトリウム塩）だけ**を探す
 *   kind === 'chloro'    … クロロベンゼンの加水分解。**芳香環に直結した -Cl**
 *
 * ⚠⚠ **アルカリ融解の相手を「ベンゼンスルホン酸」ではなく「その*ナトリウム塩*」にした**
 *   のは、教科書がそう書くから（ベンゼンスルホン酸ナトリウムを NaOH と融解する）。
 *   ★ 副産物として、**既存の緑を1つも触らずに済む**:
 *   ベンゼンスルホン酸に NaOH を掛けたときに通るのは今までどおり中和（`neutralize_naoh`）
 *   1本だけなので、**条件を選ぶ画面が新たに出てしまう人がいない**（実測で確かめた）。
 *   ＝ 道すじは 濃硫酸 → 中和 → 融解 → 弱酸の遊離 の4手で、どの手も教科書の1段に対応する。
 *
 * ⚠⚠ **一置換のベンゼン環だけ**（`isolatedBenzeneRings` ＝ 縮合していない6員の芳香環で、
 *   環の外に出ている重原子がその基1つだけ）。★ **実測で決めた** ——
 *   広く「芳香環についた -Cl なら何でも」にすると **32 分子・33 通りのうち 32 通りが
 *   「（未登録）」**（o-クロロトルエン・p-クロロフェノール …）で、名前が出るのは
 *   クロロベンゼンの1件だけだった。-SO₃Na 側も 2 分子中 1 件が未登録
 *   （アルキルベンゼンスルホン酸ナトリウム ＝ 洗剤。これを融解させる場面は教科書に無い）。
 *   ★ 絞ると **どちらも 1 分子・1 通り・未登録 0 件**になる。
 *   ⚠ 教科書もこの2本を「**クロロベンゼン**の加水分解」「**ベンゼンスルホン酸ナトリウム**の
 *   アルカリ融解」と、物質を名指しで呼んでいる。
 * ★ 副産物として、**既存の画面が1つも変わらない** —— 絞る前は
 *   o/m/p-クロロベンゼンスルホン酸の3件で NaOH の行き先が 1 → 2 通りに増えていた（実測）。
 *
 * 返す site は `[環の炭素, 外れる基の起点（S または Cl）]`。
 */
function phenoxidePrecursorSites(mol, kind) {
    const sites = [];
    isolatedBenzeneRings(mol).forEach(ring => {
        const ringSet = new Set(ring);
        // 環の外に出ている重原子（＝置換基の起点）を集める
        const subs = [];
        ring.forEach(cId => {
            mol.getNeighbors(cId).forEach(n => {
                if (n.atom.element === 'H' || ringSet.has(n.atom.id)) return;
                subs.push({ cId, id: n.atom.id, element: n.atom.element, type: n.type });
            });
        });
        // ⚠ **一置換体だけ**（下の注記）。二置換体や縮合環はここへ来ない
        if (subs.length !== 1) return;
        const sub = subs[0];
        if (sub.type !== 1) return;
        if (kind === 'chloro') {
            if (sub.element === 'Cl') sites.push([sub.cId, sub.id]);
            return;
        }
        // -SO₃⁻ Na⁺ … S に酸素が3つ、そのうち1つが相方の金属イオンを持っている（＝ 酸ではなく塩）。
        // ⚠ v1538 で塩を電離形にしたので、金属は結合をたどっても出てこない（`saltCounterMetal`）
        if (sub.element !== 'S') return;
        const around = mol.getNeighbors(sub.id).filter(x => x.atom.id !== sub.cId);
        if (around.length !== 3 || !around.every(x => x.atom.element === 'O')) return;
        if (!around.some(x => saltCounterMetal(mol, x.atom.id))) return;
        sites.push([sub.cId, sub.id]);
    });
    return sites;
}

/** 芳香環の炭素についた基（起点 leaveId から先）を外し、代わりに -O⁻ Na⁺ を付ける。 */
function replaceWithPhenoxide(mol, cId, leaveId) {
    // 外す基の原子を集める（起点から、環へ戻らずに辿れる範囲）
    const drop = new Set([leaveId]);
    const stack = [leaveId];
    while (stack.length) {
        const x = stack.pop();
        mol.getNeighbors(x).forEach(n => {
            if (n.atom.id === cId || drop.has(n.atom.id)) return;
            drop.add(n.atom.id);
            stack.push(n.atom.id);
        });
    }
    /* ⚠⚠ 外す基が塩（-SO₃⁻ Na⁺）なら、**相方の金属イオンも一緒に外す**（v1538）。
     *   粒は結合を持たないので、上の「結合をたどる」では拾えない ——
     *   置き去りにすると Na⁺ が2つ残った図（実測: ベンゼンスルホン酸ナトリウムの
     *   アルカリ融解が「ナトリウムフェノキシド ＋ （該当なし）」になった）。 */
    [...drop].forEach(id => {
        const a = mol.atoms.find(x => x.id === id);
        if (!a || !(a.charge < 0)) return;
        const metal = saltCounterMetal(mol, id);
        if (metal) drop.add(metal.id);
    });
    drop.forEach(id => mol.removeAtom(id));
    // 空いたところへ -O⁻ ＋ Na⁺（塩は電離した形で書く ＝ v1538 の流儀）
    const added = attachGroup(mol, cId, 'O');
    if (!added) throw noRoom('-O⁻ を置く空間がありません');
    const oId = added[0];
    const na = ionizeSalt(mol, oId);
    if (!na) throw noRoom('ナトリウムイオンを置く空間がありません');
    return [cId, oId, na.id];
}

/**
 * アルカンの水素を1つ塩素に置き換えられる炭素を返す（ラジカル置換・光。v1511）。
 *
 * ⚠⚠ **ユーザーの指摘そのもの**（2026-09-03）:
 *   「アルカン全般に Cl2との置換反応がリストされていないと思います」。
 *   実測でも、メタン・プロパン・シクロヘキサン・クロロメタンのどれでも
 *   **53本の反応が1本も出なかった**（塩素の反応は `aromatic_halogenation` だけで、
 *   あれは鉄触媒による**環**の置換）。
 *
 * ★ **対象は「鎖状の飽和炭化水素（と、その塩素化物）」**。門番は名前ではなく構造で立てる:
 *   ① その成分の重原子が **C と Cl だけ**（O・N・S が混ざるものは扱わない）
 *   ② その成分の結合が**すべて単結合**（＝ C=C・C≡C・芳香環はここへ来ない）
 *   ③ その成分が**木**（結合の数 ＝ 原子の数 − 1）＝ 環を含まない
 *
 * ⚠⚠ ③（環を落とす）は**実測で決めた**。シクロアルカンも化学としては同じ置換が起こるが、
 *   ③を外した写しで数えると **環を含む飽和炭化水素 29 件・1置換の生成物 93 通りのうち
 *   名前が付いたのは 2 件だけ**（クロロシクロペンタン・クロロシクロヘキサン ＝ たまたま
 *   登録済み）で、**残り 91 通りが「（未登録）」**だった。
 *   ★ 鎖状のほうは逆に **38 件・120 通りの全部に名前が付く**（実測。`iupacName` が
 *   1,2-ジクロロプロパン のように系統名で言い切る）。
 *   ⚠ 教科書がアルカンの光置換を書くのもメタンなど鎖式で、シクロアルカンでは書かない。
 *   ★ 直すなら `iupacName` が環の置換体を名乗れるようにするのが先で、そちらが済んだら
 *     この門番③を外すだけで広がる（**登録で埋めない** —— 系統名で出るものは登録しない約束）。
 *
 * ★ **同じ生成物になる位置はまとめる**（`aromaticSites` と同じ考え方・同じ道具）。
 *   エタンの2つの炭素はどちらを置換してもクロロエタンなので**1件**にする ——
 *   まとめないと「押しても同じ答えにしかならない箇所選び」が出る。
 *   プロパンは 1位・2位 の**2件**（1-クロロプロパン ／ 2-クロロプロパン）＝
 *   ここで初めて箇所選びに意味が出る。
 *   ⚠ `aromaticSiteClass` は名前こそ芳香族だが、中身は「位相だけの複製に目印を付けて
 *   正準コードを取る」＝ 置換位置一般の等価判定で、成分の同一性もキーに混ぜてある
 *   （同じ分子を2つ並べたとき2つめが消えない）。**同じ判定を2つ書かない。**
 */
function alkaneSubstitutionSites(mol) {
    const sites = [];
    const seenComp = new Set();
    mol.atoms.forEach(a => {
        if (a.element !== 'C' || seenComp.has(a.id)) return;
        const comp = componentOf(mol, a.id);
        comp.forEach(id => seenComp.add(id));
        const atoms = [...comp].map(id => mol.atoms.find(x => x.id === id)).filter(Boolean);
        // ① 重原子は C と Cl だけ
        if (!atoms.every(x => x.element === 'C' || x.element === 'Cl')) return;
        const bonds = mol.bonds.filter(b => comp.has(b.atomId1) && comp.has(b.atomId2));
        // ② すべて単結合
        if (!bonds.every(b => b.type === 1)) return;
        // ③ 木（環を含まない）
        if (bonds.length !== atoms.length - 1) return;
        const seenClass = new Set();
        atoms
            .filter(x => x.element === 'C' && mol.getFreeValency(x.id) >= 1)
            // 置く空間が無い位置は候補に出さない（`aromaticSites` と同じ約束）
            .filter(x => attachGroup(mol, x.id, 'Cl', true))
            .forEach(x => {
                const key = aromaticSiteClass(mol, x.id);
                if (seenClass.has(key)) return;
                seenClass.add(key);
                sites.push([x.id]);
            });
    });
    return sites;
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
 * ワッカー法の適用箇所 `[酸素がつく炭素, 相方の炭素]`（v1541）。
 *
 * ⚠⚠ **もとは `ethyleneUnits`（＝ エチレンだけ）だった。** 参考書は
 *   **2CH₂=CH-CH₃ ＋ O₂ → 2CH₃COCH₃**（プロペンからアセトン）も書いているのに、
 *   実測でプロペンには1件も出なかった。
 *
 * ★ **広げるのはプロペンまで**（炭素3個の末端アルケン）。教科書・参考書が書いているのは
 *   この2つだけで、それ以上に広げると画面が「教科書に載っていないこと」を言い出す。
 * ★ **酸素がつくのは置換基の多いほうの炭素**（マルコフニコフ則）——
 *   だからエチレンだけがアルデヒド（アセトアルデヒド）で、
 *   プロペン以降はケトン（アセトン）になる。ここが問われる。
 */
function wackerUnits(mol) {
    const seen = new Set();
    const out = [];
    mol.atoms.forEach(a => {
        if (a.element !== 'C' || seen.has(a.id)) return;
        const comp = [...componentOf(mol, a.id)]
            .filter(id => (mol.atoms.find(x => x.id === id) || {}).element !== 'H');
        comp.forEach(id => seen.add(id));
        if (comp.length < 2 || comp.length > 3) return;      // エチレンとプロペンだけ
        if (!comp.every(id => (mol.atoms.find(x => x.id === id) || {}).element === 'C')) return;
        const pair = [];
        comp.forEach(id => comp.forEach(jd => {
            if (id >= jd) return;
            const b = mol.getBond(id, jd);
            if (b && b.type === 2) pair.push([id, jd]);
        }));
        if (pair.length !== 1) return;                       // C=C はちょうど1本
        const [p, q] = pair[0];
        // 置換基の多いほう（＝ マルコフニコフ則で酸素がつく側）を先に置く。
        // ⚠ エチレンは左右が同点 —— v1590 までは同点を `p`（＝ 原子IDの小さいほう）に倒していて、
        //   原子IDは乱数なので**酸素の付く炭素が呼ぶたびに入れ替わっていた**（DT1）。
        //   付加と同じ `markovnikovCarbon` を通して、同点は座標で決める
        const first = markovnikovCarbon(mol, p, q);
        out.push(first === p ? [p, q] : [q, p]);
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
        if (comp.has(a.id) && !drop.has(a.id)) map.set(a.id, copyAtomMarks(probe.addAtom(a.element, a.x, a.y), a).id);
    });
    mol.bonds.forEach(b => {
        if (map.has(b.atomId1) && map.has(b.atomId2)) probe.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
    });
    const c = map.get(benzylId);
    probe.addBond(c, probe.addAtom('O', 0, 0).id, 2);
    probe.addBond(c, probe.addAtom('O', 0, 0).id, 1);
    return [...comp].sort().join(',') + '#' + canonicalCode(probe);
}

/** 箇所（原子IDの並び）を引き比べるための鍵。IDは乱数なので**並べ替えてから**繋ぐ（v1589・§13.8） */
function siteKey(site) {
    return (Array.isArray(site) ? site.filter(x => typeof x === 'string') : []).sort().join('|');
}

/**
 * `info` ルールの `apply(game, sites)` が「**札に残った箇所だけ**」を語るための共通の門（v1589・§13.8）。
 * `sites` は `refresh()` / `reagentHits()` が `siteAllowed` で絞ったあとの並び。
 * 渡されなかったとき（古い呼び方・空）は全件を返す ＝ 従来どおり分子全体で文面を作る。
 * ⚠ 絞った結果が0件になるときも全件に戻す（文面が「何もありません」に痩せるより、従来の文面のほうがまし）
 */
function pickShownSites(all, sites, keyOf) {
    if (!Array.isArray(sites) || !sites.length) return all;
    const shown = new Set(sites.map(siteKey));
    const picked = all.filter(x => shown.has(siteKey(keyOf(x))));
    return picked.length ? picked : all;
}

/**
 * 酸化剤では**図を変えない**と決めた形の一覧と、その理由の種別。
 * 文面を作るときは分子をもう一度見る（`apply` は書き換えを持たないので毎回引き直してよい）。
 * ここは `{ sites, kinds, kindOf }` を返す。
 *
 * ⚠ **種別は箇所ごとに引けるようにしてある**（`kindOf`・v1589・§13.8）。
 *   札が「いま見ている分子」で絞られるので、`kinds` を全体から作ると
 *   **札は A の分子で出たのに文面は B の話も含む**になる。`apply` は渡された箇所だけを引く
 */
function oxidationOutOfScope(mol) {
    const sites = [];
    const kinds = new Set();
    const kindOf = new Map();
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
        sites.push(s); kinds.add(cls); kindOf.set(siteKey(s), cls);
    });
    return { sites, kinds, kindOf };
}

/* ==========================================================================
 * ナフタレンの空気酸化 → 無水フタル酸（v1541・参考書 aromatic.md の式1本）
 *
 * ⚠⚠ **参考書の式は係数がずれている**: `C₁₀H₈ ＋ 4.5O₂ → 無水フタル酸 ＋ 2CO₂ ＋ H₂O`。
 *   H が 8 ＝ 4（無水フタル酸）＋ 2（H₂O 1個）で合わない。**正しくは 2H₂O**
 *   （O も 9 ＝ 3 ＋ 4 ＋ 2 で合う）。★ アプリは正しい係数で描き、原稿は直さない（別の便）。
 *
 * ★ **門番は「炭素10個が全部芳香族で、結合11本・縮合部2個」＝ ナフタレンそのもの**。
 *   置換ナフタレン（2-メチルナフタレン・ナフトール）へ広げない —— どちらの環が壊れるかを
 *   アプリが決めることになり、参考書が書いていない判断になる。
 * ========================================================================== */
function naphthaleneUnits(mol) {
    const arom = aromaticAtomSet(mol);
    const seen = new Set();
    const out = [];
    mol.atoms.forEach(a => {
        if (seen.has(a.id) || a.element === 'H') return;
        const ids = [...componentOf(mol, a.id)];
        ids.forEach(id => seen.add(id));
        const heavy = ids.map(id => mol.atoms.find(x => x.id === id)).filter(x => x && x.element !== 'H');
        if (heavy.length !== 10) return;
        if (heavy.some(x => x.element !== 'C' || x.charge || !arom.has(x.id))) return;
        const set = new Set(heavy.map(x => x.id));
        if (mol.bonds.filter(b => set.has(b.atomId1) && set.has(b.atomId2)).length !== 11) return;
        const fused = heavy.filter(x => mol.getNeighbors(x.id).filter(n => set.has(n.atom.id)).length === 3);
        if (fused.length !== 2 || !mol.getBond(fused[0].id, fused[1].id)) return;
        out.push(heavy.map(x => x.id));
    });
    return out;
}

/**
 * 原子ごとの「隣の重原子 id と結合次数」の署名（CV4 の物差しと同じ取り方）。
 * ★ **印（changed）を人が並べず、実際に変わった原子から決める**ために使う ——
 *   環を組み直すと残る環のケクレ構造も入れ替わるので、手で数えると渡し落とす。
 */
function heavyBondSignature(mol, ids) {
    const sig = new Map();
    ids.forEach(id => {
        if (!mol.atoms.some(a => a.id === id)) return;
        sig.set(id, mol.getNeighbors(id).filter(n => n.atom.element !== 'H')
            .map(n => `${n.atom.id}:${n.type}`).sort().join(','));
    });
    return sig;
}

/* ==========================================================================
 * 完全燃焼（v1541・参考書の式3本 ＝ メタン・エタノール・ベンゼン）
 *
 * ⚠⚠ **アプリには燃焼のルールが1本も無かった。** 元素分析の節が立っているのに、
 *   そこに書かれている式を画面で起こす手段が無かった（v1540 の実測で発見）。
 *
 * ★ **なぜ「図を変える」ほうにしたか**（`_info` の案内で済ませなかった理由）:
 *   燃焼は実際に起きる反応で、しかも**炭素骨格が跡形もなくなる**のがこの反応の要点。
 *   「C は全部 CO₂ へ・H は全部 H₂O へ」が図で見えることが、元素分析（燃やして
 *   CO₂ と H₂O の質量から組成を出す）の理屈そのものになる。
 *
 * ⚠ **門番は「C・H・O だけ」**。窒素・硫黄・ハロゲンを含むものを通すと、
 *   この画面が扱わない生成物（NO₂・SO₂・HCl…）を黙って省いた式になる。
 *   ★ 電荷を持つ粒（塩）と `R`（重合鎖の端）も落とす —— どちらも
 *   **「分子1個ぶんの式」が決まらない**（DESIGN_reaction_execution.md の
 *   「係数を書くなら分子が1個ぶんに決まっていること」）。
 * ========================================================================== */

// その連結成分が完全燃焼の式を書ける相手か（書けるなら組成を返す。書けなければ null）
function combustionComposition(mol, ids) {
    let c = 0, h = 0, o = 0;
    for (const id of ids) {
        const a = mol.atoms.find(x => x.id === id);
        if (!a) return null;
        if (a.charge) return null;                 // 塩の粒（分子1個ぶんが決まらない）
        if (a.element === 'H') { h++; continue; }
        if (a.element === 'C') c++;
        else if (a.element === 'O') o++;
        else return null;                          // N・S・ハロゲン・R・金属
        h += mol.getFreeValency(id);               // 自動補完の水素
    }
    if (c < 1 || h % 2 !== 0) return null;
    return { c, h, o, co2: c, h2o: h / 2, o2: c + h / 4 - o / 2 };
}

// 完全燃焼できる分子（連結成分）の一覧。site は成分の原子IDをそのまま並べたもの
function combustibleComponents(mol) {
    const seen = new Set();
    const sites = [];
    mol.atoms.forEach(a => {
        if (seen.has(a.id)) return;
        const ids = [...componentOf(mol, a.id)];
        ids.forEach(id => seen.add(id));
        if (combustionComposition(mol, ids)) sites.push(ids);
    });
    return sites;
}

/**
 * 生成物（CO₂ と H₂O）を置く場所を決める。
 *
 * ★ **元の分子が居た場所を中心に格子で並べる**（`parkAsWater` と同じ考え方＝近くに置く）。
 *   遠くに飛ばすと「この分子が燃えてこうなった」が読めない。
 * ⚠ **他の分子に重ねない** —— 近い順に候補をずらして、空いている場所を探す。
 * 返り値: [{x, y}]（前から CO₂ のぶん・続いて H₂O のぶん）。置けなければ null
 */
function combustionProductSpots(mol, ids, count) {
    const own = new Set(ids);
    const heavy = ids.map(id => mol.atoms.find(a => a.id === id)).filter(a => a && a.element !== 'H');
    if (!heavy.length) return null;
    const G = bondStep(mol, heavy[0].id);
    const cx = heavy.reduce((s, a) => s + a.x, 0) / heavy.length;
    const cy = heavy.reduce((s, a) => s + a.y, 0) / heavy.length;
    const others = mol.atoms.filter(a => !own.has(a.id) && a.element !== 'H');
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = G * 3.6, cellH = G * 2;          // CO₂ は横に3原子ぶん（O=C=O）
    const layout = (ox, oy) => {
        const spots = [];
        for (let i = 0; i < count; i++) {
            const r = Math.floor(i / cols), k = i % cols;
            spots.push({
                x: cx + ox + (k - (cols - 1) / 2) * cellW,
                y: cy + oy + (r - (rows - 1) / 2) * cellH
            });
        }
        return spots;
    };
    const clear = spots => spots.every(p =>
        others.every(a => Math.hypot(a.x - p.x, a.y - p.y) >= G * 1.6 &&
            Math.hypot(a.x - (p.x - G), a.y - p.y) >= G * 1.6 &&
            Math.hypot(a.x - (p.x + G), a.y - p.y) >= G * 1.6));
    const cands = [{ x: 0, y: 0, d: 0 }];
    for (let i = -6; i <= 6; i++) {
        for (let j = -6; j <= 6; j++) {
            const d = Math.hypot(i, j);
            if (d < 1 || d > 6) continue;
            cands.push({ x: i * cellW, y: j * cellH, d });
        }
    }
    cands.sort((p, q) => p.d - q.d);
    for (const cand of cands) {
        const spots = layout(cand.x, cand.y);
        if (clear(spots)) return spots;
    }
    return null;
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
 * ★ 分子内脱水で閉じる**五員環を正五角形に置く**（v1566・DESIGN_structure_render.md「5員は正五角形」）。
 *
 * ⚠ 以前は架橋の O を `anhydrideBridgeSpot` で「空いている所」に置くだけで、カルボニル炭素は
 *   カルボン酸のときの位置のままだった。フタル酸（-COOH が右上・右下）では2つのカルボニル炭素が
 *   縦に一直線に並ぶので、O がその中点に落ちて**内角 120・60・180・60・120°**につぶれていた
 *   （動画 V134 の場面で実測）。直鎖に描いたコハク酸は 18・180° まで崩れていた。
 *
 * 置き方: 経路の内側の辺（path[1]-path[2]。フタル酸ならベンゼン環と共有する辺、マレイン酸なら C=C）は
 *   **動かさず**、その辺の上に正五角形を立てる。動かすのはカルボニル炭素2つ・架橋の O・=O だけ。
 *   =O は五角形の中心から外向きに出す（登録の無水フタル酸と同じ形）。
 * ⚠ 見た目だけ。結合は `apply` が作る ＝ 正準コードは変わらない。
 * @returns Map<原子id, {x,y}> または null（五員環でない・置くと他の原子に重なる）
 */
function anhydridePentagonPlacement(mol, cand, ohA, ohB) {
    const path = cand && cand.path;
    if (!path || path.length !== 4) return null;
    const at = id => mol.atoms.find(x => x.id === id);
    const [cA, p1, p2, cB] = path.map(at);
    if (!cA || !p1 || !p2 || !cB) return null;
    const s = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (s < 1e-6) return null;
    const ex = (p2.x - p1.x) / s, ey = (p2.y - p1.y) / s;
    const nx = -ey, ny = ex;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const carbonylO = c => mol.bonds
        .filter(b => b.type === 2 && (b.atomId1 === c.id || b.atomId2 === c.id))
        .map(b => at(b.atomId1 === c.id ? b.atomId2 : b.atomId1))
        .filter(o => o && o.element === 'O' && o.id !== ohA && o.id !== ohB);
    const exo = [[cA, carbonylO(cA)], [cB, carbonylO(cB)]];
    // どちら側に立てるか: カルボニル炭素のある側。辺と一直線（直鎖）なら =O のある側
    const side = (pts) => pts.reduce((acc, p) => acc + (p.x - mx) * nx + (p.y - my) * ny, 0);
    const sgn = v => (Math.abs(v) < s * 1e-3 ? 0 : Math.sign(v));
    let sign = sgn(side([cA, cB]));
    if (!sign) sign = sgn(side(exo.flatMap(([, os]) => os)));
    const signs = sign ? [sign, -sign] : [1, -1];
    const moving = new Set([cA.id, cB.id, ohA, ohB, ...exo.flatMap(([, os]) => os.map(o => o.id))]);
    const others = mol.atoms.filter(x => x.element !== 'H' && !moving.has(x.id));
    const G = bondStep(mol, p1.id);
    const clear = G * 0.6;
    const apothem = s / (2 * Math.tan(Math.PI / 5));
    for (const sg of signs) {
        const cx = mx + nx * sg * apothem, cy = my + ny * sg * apothem;
        const rot = (p, t) => {
            const dx = p.x - cx, dy = p.y - cy, c = Math.cos(t), sn = Math.sin(t);
            return { x: cx + dx * c - dy * sn, y: cy + dx * sn + dy * c };
        };
        // p1 を回して p2 に重なる向き（±72°）で、p2 → cB → O → cA と進む
        let t = 2 * Math.PI / 5;
        const q = rot(p1, t);
        if (Math.hypot(q.x - p2.x, q.y - p2.y) > s * 0.05) t = -t;
        const nB = rot(p2, t), nO = rot(nB, t), nA = rot(nO, t);
        const place = new Map([[cB.id, nB], [ohA, nO], [cA.id, nA]]);
        exo.forEach(([c, os]) => {
            const np = place.get(c.id);
            const ux = np.x - cx, uy = np.y - cy, L = Math.hypot(ux, uy) || 1;
            // 長さは結合の標準（カルボン酸の図の =O は 60px のことがあるが、登録の無水フタル酸は約 42px）
            os.forEach(o => place.set(o.id, { x: np.x + ux / L * G, y: np.y + uy / L * G }));
        });
        if ([...place.values()].every(p => others.every(o => Math.hypot(o.x - p.x, o.y - p.y) > clear))) {
            return place;
        }
    }
    return null;
}

/**
 * ★ 分子内脱水で閉じる**六員環を正六角形に置く**（v1574・DESIGN_structure_render.md「6員は頂点が上下・左右が縦の辺」）。
 *
 * ⚠ v1566 の総当たりで、グルタル酸 → 無水グルタル酸が**内角 139・21・180・180・180・21°**につぶれていた。
 *   直鎖のまま O だけ（あるいはカルボニル炭素だけ）を動かしても正六角形にはならない ＝ **鎖の CH₂ も動かす**。
 *
 * 置き方: 経路のまん中の原子（path[2]。グルタル酸なら 3 位の CH₂）だけを**動かさず**、それを頂点にした
 *   頂点が上下の正六角形を立てる。まん中の原子の向かい（para）が架橋の O になる。
 *   立てる側は、カルボニル炭素のある側。一直線（直鎖）なら =O のある側（五員環と同じ決め方）。
 *   動かす原子: 環の残り4つ（p1・p3・カルボニル炭素2つ）・架橋の O・=O、
 *   **p1・p3 に付いた枝**（根を環の中心から外向きに置き直し、その先は根と同じだけずらす）。
 *   ⚠ 動かした原子が1つでも、動かさない原子（ほかの分子も含む）の 0.6 マス以内に入れば、
 *     もう片側を試し、それでも駄目なら null（呼ぶ側が今までどおり O だけ動かす）。
 * ⚠ 見た目だけ。結合は `apply` が作る ＝ 正準コードは変わらない。
 * @returns Map<原子id, {x,y}> または null（六員環でない・置くと重なる）
 */
function anhydrideHexagonPlacement(mol, cand, ohA, ohB) {
    const path = cand && cand.path;
    if (!path || path.length !== 5) return null;
    const at = id => mol.atoms.find(x => x.id === id);
    const [cA, p1, p2, p3, cB] = path.map(at);
    if (!cA || !p1 || !p2 || !p3 || !cB) return null;
    const G = bondStep(mol, p2.id);
    const carbonylO = c => mol.bonds
        .filter(b => b.type === 2 && (b.atomId1 === c.id || b.atomId2 === c.id))
        .map(b => at(b.atomId1 === c.id ? b.atomId2 : b.atomId1))
        .filter(o => o && o.element === 'O' && o.id !== ohA && o.id !== ohB);
    const exo = [[cA, carbonylO(cA)], [cB, carbonylO(cB)]];
    const ringIds = new Set([cA.id, p1.id, p2.id, p3.id, cB.id, ohA]);
    // p1・p3 の枝（環の外の重原子と、その先）
    const branches = [p1, p3].map(r => mol.getNeighbors(r.id)
        .map(n => n.atom).filter(a => a.element !== 'H' && !ringIds.has(a.id))
        .map(root => {
            const ids = [root.id], seen = new Set([r.id, root.id]);
            let loop = false;
            for (let i = 0; i < ids.length && !loop; i++) {
                mol.getNeighbors(ids[i]).forEach(n => {
                    if (n.atom.element === 'H' || seen.has(n.atom.id)) return;
                    if (ringIds.has(n.atom.id)) { loop = true; return; }   // 環へ戻る枝（橋かけ）は扱わない
                    seen.add(n.atom.id); ids.push(n.atom.id);
                });
            }
            return loop ? null : { r, root, ids };
        }));
    if (branches.some(list => list.some(b => !b))) return null;
    const moving = new Set([cA.id, p1.id, p3.id, cB.id, ohA, ohB,
        ...exo.flatMap(([, os]) => os.map(o => o.id)), ...branches.flat().flatMap(b => b.ids)]);
    const others = mol.atoms.filter(x => x.element !== 'H' && !moving.has(x.id) && x.id !== p2.id);
    // 立てる側（上下）: カルボニル炭素・p1・p3 の重心が p2 のどちら側か。一直線なら =O の側
    const sgn = v => (Math.abs(v) < G * 0.05 ? 0 : Math.sign(v));
    let sign = sgn([cA, p1, p3, cB].reduce((s, a) => s + a.y - p2.y, 0));
    if (!sign) sign = sgn(exo.flatMap(([, os]) => os).reduce((s, o) => s + o.y - p2.y, 0));
    const signs = sign ? [sign, -sign] : [-1, 1];
    // p1 は今いる左右の側に残す（鏡に映した図にしない）
    const p1Right = p1.x - p2.x > 0 || (p1.x === p2.x && p3.x < p2.x);
    const clear = G * 0.6;
    for (const sg of signs) {
        // sg = −1 ＝ 環は p2 の上（p2 が下の頂点）、+1 ＝ 環は p2 の下（p2 が上の頂点）
        const cx = p2.x, cy = p2.y + sg * G;
        const vtx = deg => ({ x: cx + G * Math.cos(deg * Math.PI / 180), y: cy + G * Math.sin(deg * Math.PI / 180) });
        const top = sg > 0;   // p2 が上の頂点（−90°）
        const a0 = top ? -90 : 90;
        // 右回り（画面で時計回り）に p2 → 右の隣 → 右の2つ先 → O → …
        const step = top ? 60 : -60;
        const right1 = vtx(a0 + step), right2 = vtx(a0 + 2 * step), oPos = vtx(a0 + 3 * step),
            left2 = vtx(a0 + 4 * step), left1 = vtx(a0 + 5 * step);
        const [n1, nA, nB, n3] = p1Right ? [right1, right2, left2, left1] : [left1, left2, right2, right1];
        const place = new Map([[p1.id, n1], [cA.id, nA], [ohA, oPos], [cB.id, nB], [p3.id, n3]]);
        const outward = (np, len) => {
            const ux = np.x - cx, uy = np.y - cy, L = Math.hypot(ux, uy) || 1;
            return { x: np.x + ux / L * len, y: np.y + uy / L * len };
        };
        exo.forEach(([c, os]) => os.forEach(o => place.set(o.id, outward(place.get(c.id), G))));
        branches.flat().forEach(b => {
            const np = place.get(b.r.id);
            const len = Math.hypot(b.root.x - b.r.x, b.root.y - b.r.y) || G;
            const q = outward(np, len);
            const dx = q.x - b.root.x, dy = q.y - b.root.y;
            b.ids.forEach(id => { const a = at(id); place.set(id, { x: a.x + dx, y: a.y + dy }); });
        });
        const pts = [...place.values()];
        const okOthers = pts.every(p => others.every(o => Math.hypot(o.x - p.x, o.y - p.y) > clear));
        const okSelf = pts.every((p, i) => pts.every((q, j) => j <= i || Math.hypot(p.x - q.x, p.y - q.y) > clear));
        if (okOthers && okSelf) return place;
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

/** 強酸で弱酸に戻せる塩（-COO⁻ / -O⁻ / -SO₃⁻ ＋ Na⁺・K⁺ の粒）。返り値は `[金属のID, 酸素のID]` */
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

/**
 * ★ **炭酸より強い酸だけ**（カルボン酸・スルホン酸）を集める（DESIGN_ion_layer.md I-1）。
 *
 * ⚠ **フェノールを外すのがこの関数の全部**。酸の強さは
 *   **カルボン酸 > 炭酸 > フェノール** なので、NaHCO₃ から CO₂ を追い出せるのは
 *   炭酸より強い側だけ ＝ **分液でカルボン酸とフェノールを分ける手**そのもの。
 * ★ 判定は `acidKindOf` に任せる（酸の種類を見分ける規則を2か所に書かない）。
 */
function strongerThanCarbonicAcidSites(mol) {
    return neutralizableAcidSites(mol)
        .filter(([oId, anchorId]) => acidKindOf(mol, oId, anchorId).name !== 'フェノール');
}

/**
 * ★ 塩基性のアミンの N を集める（`amine_hcl` / `amine_liberate_naoh`。I-1）。
 *
 * ⚠ **アミドの N は除く**（隣のカルボニルに電子を引かれていて塩基性を示さない）。
 *   除き方は `amidation` の detect と同じ `isAmideNitrogen` ＝ 規則を2か所に書かない。
 * ★ 3級アミンも含める —— N に水素が残っているかは**縮合**の条件であって、
 *   塩をつくる（N の非共有電子対が H⁺ を受け取る）ことの条件ではない。
 */
function basicAmineNitrogens(mol) {
    return findFunctionalGroups(mol)
        .filter(g => ['amine1', 'amine2', 'amine3'].includes(g.type) &&
            !isAmideNitrogen(mol, g.atomIds[0]))
        .map(g => [g.atomIds[0]]);
}

/**
 * ★★ **アンモニウム塩**の N を集める（`amine_liberate_naoh` の入口。I-3）。
 *
 * ⚠⚠ **v1517 まではここが「層の印」だった**（`phase === 'aq'`）。電荷が入って
 *   `amine_hcl` が本物の塩を描くようになったので、**入口を図そのものに引き直した**
 *   ＝ 印を付けずに呼び出した「アニリン塩酸塩」にも NaOH が効く
 *   （設計書 §13-6 の申し送り。印は見せ方であって化学ではない）。
 *
 * ⚠⚠ **双性イオンは入らない。** 見分けるのは**成分の正味の電荷**:
 *   アニリン塩酸塩の陽イオン側は +1（相方の Cl⁻ は結合を持たない別成分）だが、
 *   双性イオンは -NH₃⁺ と -COO⁻ が同じ成分の中にあるので **0**。
 *   ★ 双性イオンに NaOH をかけると -COO⁻ を持つ**陰イオン**になる ＝ 別の反応なので、
 *     ここで一緒に拾わない（設計書 §13-6 の「両性」の申し送り）。
 * ⚠ 電荷の無い N は `findFunctionalGroups` がアミンの枝へ回すので、そもそも来ない。
 */
function ammoniumSaltNitrogens(mol) {
    return findFunctionalGroups(mol)
        .filter(g => g.type === 'ammonium')
        .filter(g => {
            const ids = componentOf(mol, g.atomIds[0]);
            return mol.atoms.reduce((s, a) => s + (ids.has(a.id) ? (a.charge || 0) : 0), 0) > 0;
        })
        .map(g => [g.atomIds[0]]);
}

/**
 * ★★ **ジアゾ化できる N** を集める（`diazotization` の入口。DESIGN_ion_layer.md I-4）。
 *
 * ⚠ **芳香環に直結した1級アミンだけ**。教科書がジアゾ化を扱うのはここだけで、
 *   脂肪族の1級アミンから作ったジアゾニウムは**その場で分解してしまう**ため
 *   （＝ 塩として取り出せない）、画面に出すと「取り出せるもの」に見えてしまう。
 *   ★ `reduce_nitro` が「芳香環に直結した -NO₂ だけ」に絞ったのと**同じ線**（§4-1）。
 * ⚠ アミド N は除く（`basicAmineNitrogens` と同じ門番）。
 */
function aromaticPrimaryAmineNitrogens(mol) {
    const arom = aromaticAtomSet(mol);
    return findFunctionalGroups(mol)
        .filter(g => g.type === 'amine1' && !isAmideNitrogen(mol, g.atomIds[0]))
        .filter(g => mol.getNeighbors(g.atomIds[0])
            .some(n => n.atom.element === 'C' && arom.has(n.atom.id)))
        .map(g => [g.atomIds[0]]);
}

/**
 * ★★ **ジアゾニウム塩**の箇所を集める（加熱分解とカップリングの入口。I-4）。
 *
 * 返すのは `[環につながっている N⁺, 末端の N]`。
 * ★ **どちらの N が ＋ か**は `findFunctionalGroups` の `diazonium` が既に決めている
 *   （`atomIds[0]` が電荷を持つほう ＝ 環側）。**ここで数え直さない**
 *   ＝「どの N が ＋ か」の定義を2か所に置かない。
 * ⚠ `ammoniumSaltNitrogens` と同じく、**成分の正味の電荷が ＋** のものだけ
 *   （相方の Cl⁻ は結合を持たない別成分なので +1 になる）。
 */
function diazoniumSites(mol) {
    return findFunctionalGroups(mol)
        .filter(g => g.type === 'diazonium')
        .filter(g => {
            const ids = componentOf(mol, g.atomIds[0]);
            return mol.atoms.reduce((s, a) => s + (ids.has(a.id) ? (a.charge || 0) : 0), 0) > 0;
        })
        .map(g => [g.atomIds[0], g.atomIds[1]]);
}

/**
 * ★★ 酸に戻せる塩（-COO⁻ / -O⁻ / -SO₃⁻ ＋ 金属イオンの粒）を集める。
 *   返すのは今までどおり `[金属id, 酸素id]`（`phenoxideSaltSites` 以下の読み手は変えない）。
 *
 * ⚠ v1538 まで「金属から結合を1本たどる」実装だった。塩を電離した形へそろえた
 *   （`saltCounterMetal`）ので、たどる線が無くなり、**陰イオンの側から相方を探す**。
 */
function liberatableSaltSites(mol) {
    const sites = [];
    mol.atoms.forEach(o => {
        if (o.element !== 'O' || !(o.charge < 0)) return;
        // その酸素の向こうが C か S ＝ カルボン酸塩・フェノキシド・スルホン酸塩
        const beyond = mol.getNeighbors(o.id).filter(n => n.atom.element !== 'H');
        if (beyond.length !== 1 || !['C', 'S'].includes(beyond[0].atom.element)) return;
        const metal = saltCounterMetal(mol, o.id);
        if (metal) sites.push([metal.id, o.id]);
    });
    return sites;
}

/**
 * ★★ 酸性の -OH（もしくは -O⁻）を**塩にする**（v1538。中和・金属Na・けん化などの出口ただ1つ）。
 *
 * 酸素に -1 を入れ、**結合を持たない金属イオンの粒**を相方として置く（`placeCounterIon`）。
 * ⚠ **線で結ばない** —— -O-Na と書くと共有結合の図になる（Cl⁻ を線で結ぶと
 *   N-クロロアニリンになるのと同じ理屈）。イオン結合は線では書かない。
 * 置き場がまったく無ければ null（呼び出し側が `noRoom` を投げる ＝ 図を壊さない）。
 */
function ionizeSalt(mol, oId, element = 'Na') {
    const o = mol.atoms.find(a => a.id === oId);
    if (!o) return null;
    const before = o.charge;
    o.charge = -1;                       // 先に -1 を入れて価標を 1 にする（自動水素を消す）
    const ion = placeCounterIon(mol, oId, element, 1);
    if (!ion) { if (before === undefined) delete o.charge; else o.charge = before; return null; }
    return ion;
}

/**
 * ★★ 塩から金属イオンを外して酸に戻す（v1538。遊離のルール4本が通る出口ただ1つ）。
 * 粒を消し、酸素の -1 を落とす ＝ 空いた価標に自動水素が入って -OH に戻る。
 */
function freeSaltAcid(mol, metalId, oId) {
    mol.removeAtom(metalId);
    const o = mol.atoms.find(a => a.id === oId);
    if (o) delete o.charge;
}

/**
 * ★★ **フェノキシド（芳香環に直結した -O⁻ Na⁺ / K⁺）の塩だけ**を集める
 *   （DESIGN_ion_layer.md I-2・`liberate_co2` / `kolbe_schmidt` の入口）。
 *
 * ⚠⚠ **`acidKindOf` で絞ってはいけない**（設計書 §5-2 は「`acidKindOf` の分岐を再利用」と
 *   書いているが、実測すると**成り立たない**）。`acidKindOf` の最後は「それ以外はフェノール」で、
 *   **ナトリウムエトキシド（鎖の -ONa）も『フェノール』を返す**。
 *   ＝ そのまま流用すると CO₂ がアルコキシドにも効き、しかも画面に
 *   「弱いほうの酸（フェノール）が遊離して…」と**嘘の名前**が出る。
 * ★ だから見るのは**環そのもの** —— O の向こうの炭素が芳香環に属するか（`aromaticAtomSet`）。
 *   カルボン酸塩は「向こうの C」がカルボニル炭素で環に属さないので落ち、
 *   スルホン酸塩は向こうが S なので落ちる ＝ **炭酸より弱い酸の塩だけ**が残る。
 */
function phenoxideSaltSites(mol) {
    const arom = aromaticAtomSet(mol);
    return liberatableSaltSites(mol).filter(([metalId, oId]) => {
        const beyond = mol.getNeighbors(oId)
            .find(n => n.atom.element !== 'H' && n.atom.id !== metalId);
        return !!beyond && beyond.atom.element === 'C' && arom.has(beyond.atom.id);
    });
}

/**
 * ★★ コルベ・シュミット反応の箇所（DESIGN_ion_layer.md I-2・系統樹の「12本の足りない辺」#8）。
 *
 * ナトリウムフェノキシド ＋ CO₂ →（高温・高圧）→ **サリチル酸ナトリウム**。
 * 返すのは `[金属id, フェノキシドのOid, オルト位の環炭素id]`。
 *
 * ⚠ **オルト位に限る**（教科書がそう書く。実際に o 体が主生成物になるのは
 *   Na⁺ が -O⁻ と CO₂ を隣り合わせに掴むため）。⚠ **パラ位は出さない** ——
 *   高校では扱わないうえ、両方出すと「どちらでもよい」と読まれる。
 * ★ オルトが2つあるときは**座標で1つに決める**（原子IDは乱数。C-2b の作法）。
 *   フェノールの2つのオルトは等価なので、化学的にはどちらでも同じ。
 */
function kolbeSchmidtSites(mol) {
    const arom = aromaticAtomSet(mol);
    const out = [];
    phenoxideSaltSites(mol).forEach(([metalId, oId]) => {
        const anchor = mol.getNeighbors(oId)
            .find(n => n.atom.element !== 'H' && n.atom.id !== metalId);
        if (!anchor) return;
        const ortho = mol.getNeighbors(anchor.atom.id)
            .filter(n => arom.has(n.atom.id) && n.atom.element === 'C')
            .map(n => n.atom)
            .filter(a => mol.getFreeValency(a.id) >= 1)
            .filter(a => attachCarboxylate(mol, a.id, true))
            .sort((p, q) => (q.x - p.x) || (p.y - q.y) || (p.id < q.id ? -1 : 1));
        if (ortho.length) out.push([metalId, oId, ortho[0].id]);
    });
    return out;
}

/**
 * ★★ ジアゾカップリングの箇所（DESIGN_ion_layer.md I-4・既存機構 `diazo_coupling`）。
 *
 * ジアゾニウム塩 ＋ ナトリウムフェノキシド → **p-ヒドロキシアゾベンゼン**（橙赤色のアゾ染料）。
 * 返すのは `[環側のN⁺, 末端のN, 金属id, フェノキシドのOid, パラ位の環炭素id]`。
 *
 * ⚠ **パラ位に限る**（機構データの desc がそう書いている:「フェノキシドの O⁻ が
 *   電子を環に押し出すため、攻撃は O の対角（パラ位）の炭素から起こります」）。
 *   ★ `kolbeSchmidtSites` が**オルトに限る**のとちょうど裏返しで、
 *   どちらも「教科書がそう書く1つだけを出す」——両方出すと「どちらでもよい」と読まれる。
 * ⚠ **別の分子どうしでなければ出さない**（`componentOf` で見る）。
 */
function diazoCouplingSites(mol) {
    const arom = aromaticAtomSet(mol);
    const out = [];
    const diazo = diazoniumSites(mol);
    if (!diazo.length) return out;
    phenoxideSaltSites(mol).forEach(([metalId, oId]) => {
        const anchor = mol.getNeighbors(oId)
            .find(n => n.atom.element !== 'H' && n.atom.id !== metalId);
        if (!anchor) return;
        const ringSet = new Set([...componentOf(mol, anchor.atom.id)]
            .filter(id => arom.has(id)));
        // 環を一周して -O⁻ の付け根からの距離を測る（1=オルト・3=パラ）
        const dist = new Map([[anchor.atom.id, 0]]);
        const queue = [anchor.atom.id];
        while (queue.length) {
            const cur = queue.shift();
            mol.getNeighbors(cur).forEach(n => {
                if (!ringSet.has(n.atom.id) || dist.has(n.atom.id)) return;
                dist.set(n.atom.id, dist.get(cur) + 1);
                queue.push(n.atom.id);
            });
        }
        const para = [...dist.keys()].filter(id => dist.get(id) === 3);
        if (para.length !== 1) return;                       // ⚠ 六員環でなければ出さない
        const paraId = para[0];
        if (mol.getFreeValency(paraId) < 1) return;          // パラ位が塞がっていたら出さない
        const phenoxide = componentOf(mol, oId);
        diazo.forEach(([nId, n2Id]) => {
            if (phenoxide.has(nId)) return;                  // ⚠ 別分子どうしのみ
            out.push([nId, n2Id, metalId, oId, paraId]);
        });
    });
    return out;
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

/**
 * 多重結合（非芳香族の C=C / C≡C）の一覧を [id1, id2] の配列で返す。
 *
 * ⚠ **並びは座標で決める**（v1591・claude/festive-gauss-213324 の取り込み直し）。
 * `findFunctionalGroups` が返す `atomIds` は `Bond` の並び ＝ **原子IDの小さい順**で、
 * その原子IDは乱数なので **同じ分子に同じ反応を2回起こすと [id1, id2] が入れ替わる**。
 * 受け取る側はこの並びを「どちらを先に見るか」に使っているため、
 * 生成物の**座標**（ときには生成物そのもの）が呼ぶたびに変わっていた:
 *   - `oxidative_cleavage` … `roles` の最後の側を下へ逃がす
 *     ＝ **切れた2つのどちらが降りるか**が毎回変わる
 *   - `addAcrossMultipleBond` … 左右が同点のときに `id1` 側へ置換基を付ける
 *     （同点の扱いは `markovnikovCarbon` 側でも座標で決めているが、**入口でも揃えておく**。
 *     `site` を手で組んで渡す道が増えても、ここを通れば並びが決まる）
 * 左上（x → y の順）を先にする。**トポロジーは1文字も変えない**ので、
 * どちらを先に返すかは図の再現性だけの問題。回帰テストは tests.js の DT1。
 */
function multipleBondSites(mol) {
    return findFunctionalGroups(mol)
        .filter(g => g.type === 'cc_double' || g.type === 'cc_triple')
        .map(g => orderByPosition(mol, g.atomIds));
}

/**
 * 2原子の組 `[id1, id2]` を**座標で並べ直す**（左 → 上 の順。座標まで同じならIDを最後の手段に）。
 * 原子IDは乱数なので、ID順に頼ると同じ操作の結果が毎回変わる（CLAUDE.md「原子IDに順序を頼らない」）。
 */
function orderByPosition(mol, ids) {
    const a = mol.atoms.find(x => x.id === ids[0]);
    const b = mol.atoms.find(x => x.id === ids[1]);
    if (!a || !b) return ids;
    const first = (a.x !== b.x) ? (a.x < b.x) : (a.y !== b.y) ? (a.y < b.y) : (a.id < b.id);
    return first ? [a.id, b.id] : [b.id, a.id];
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
/**
 * ★ 加硫の1本目で、相手の鎖のどの C=C に橋を架けるかを**鎖がそろって重なる**ものに選び直す（I-0077・2026-09-23）。
 *
 * **症状**（v1623 の実測）: 2本の鎖を左右に並べると、いちばん近い組は「左の鎖の右端 × 右の鎖の左端」。
 *   `stackChainsForBridge` はその2つだけを縦にそろえるので、鎖は2単位ずれて重なり、
 *   **2本目・3本目の橋がどれも長い斜め線**になっていた（C…C 348〜557px ＝ 縦の橋の 1.4〜2.2倍）。
 * ★ 選び直すのは**相手の鎖の側だけ**（`ca`・`ca2` は選んだまま）。鎖の R は「この先も同じ単位が続く」
 *   印なので、相手の鎖のどの単位の C=C も化学としては同じ ＝ どれに架けても同じ加硫ゴムになる。
 * ⚠ **1本目だけ**（すでに1分子なら null。動かすと架けた橋が伸びる）。
 * ⚠ 数えるのは「寄せたあと x がそろう C=C の組」の数。元の組より多いときだけ選び直す（同点なら選んだまま）。
 * @returns { cb, cb2 } または null
 */
function inRegisterPartner(mol, caId, ca2Id, cbId, cb2Id) {
    const compB = componentOf(mol, cbId);
    if (compB.has(caId)) return null;
    const compA = componentOf(mol, caId);
    const G = bondStep(mol);
    if (!(G > 1)) return null;
    const at = new Map(mol.atoms.map(a => [a.id, a]));
    const mids = (comp) => mol.bonds
        .filter(b => b.type === 2 && comp.has(b.atomId1) && comp.has(b.atomId2))
        .map(b => (at.get(b.atomId1).x + at.get(b.atomId2).x) / 2);
    const xa = mids(compA), xb = mids(compB);
    const ca = at.get(caId);
    const score = (p) => {
        // ⚠ 格子への丸めは入れない（鎖が格子から外れて置かれていると、丸めの分だけ全部の組がずれて数えられない）
        const dx = ca.x - at.get(p.cb).x;
        return xa.filter(x => xb.some(y => Math.abs(x - (y + dx)) < G * 0.35)).length;
    };
    /* 候補は相手の鎖の C=C 全部（`vulcanizablePairs` は**いまの配置で**硫黄の席が空く組しか返さないので、
     * 寄せる前の横並びでは遠い単位が候補に入らない）。向きは ca→ca2 と同じ向きになる端を cb にする */
    const ca2 = at.get(ca2Id);
    const sgn = Math.sign(ca2.x - ca.x);
    const cands = mol.bonds
        .filter(b => b.type === 2 && compB.has(b.atomId1) && compB.has(b.atomId2) &&
            at.get(b.atomId1).element === 'C' && at.get(b.atomId2).element === 'C')
        .map(b => {
            const [p, q] = [at.get(b.atomId1), at.get(b.atomId2)];
            return Math.sign(q.x - p.x) === sgn ? { cb: p.id, cb2: q.id } : { cb: q.id, cb2: p.id };
        });
    const same = (p) => new Set([p.cb, p.cb2, cbId, cb2Id]).size === 2;
    const orig = cands.find(same);
    let best = orig || null, bestScore = orig ? score(orig) : -1;
    cands.forEach(p => { const s = score(p); if (s > bestScore) { best = p; bestScore = s; } });
    if (!best || best === orig || same(best)) return null;
    return { cb: best.cb, cb2: best.cb2 };
}

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
    // ★ ただし**もう橋の位置に並んでいる置き方があれば、それを先に**（I-0149・v1664）。
    //   加硫の相手を呼んだ時点で「反応後の位置」に置いてあるので、ここで下 → 上 の順に試すと、
    //   相手の側から見た組（ca が相手の鎖）で**元の鎖を反対側へ動かしてしまう**
    const tries = [];
    for (const k of [1, 2]) for (const sign of [1, -1]) {
        const still = Math.abs(Math.round(ca.x / G) * G - cb.x) < 1e-6 &&
            Math.abs(Math.round(ca.y / G) * G + sign * 3 * k * G - cb.y) < 1e-6;
        tries.push({ k, sign, still });
    }
    tries.sort((a, b) => (b.still ? 1 : 0) - (a.still ? 1 : 0));
    for (const { k, sign } of tries) {
        {
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

/* ==========================================================================
 * 共重合（v1541・ユーザー決定 2026-09-12）
 *
 * > **共重合の反応全体を見たほうがよいと思います。**
 * > **選択した分子、反応のために召喚した分子はすべてつながるようにすべきだと考えます。**
 *
 * ⚠⚠ **直す前の挙動**: スチレン2個＋ブタジエン2個を並べて付加重合を押すと、
 *   エラーにもならず**スチレンだけが繋がってブタジエンが残った**（黙って別物ができる）。
 *   原因は `addition_polymerization` の `detect` が正準コードでグループ分けし、
 *   「同じ単量体が2つ以上」のグループだけを site にしていたこと。
 *
 * ★ **直す向きは「赤で止める」ではない**（ユーザー明言）。
 *   **並んでいる単量体を全部つなぐ札を出す**。
 *
 * ⚠ **決めたことと理由**:
 *   ① **並びは「画面に並べた順」**（交互でもブロックでもない）。
 *      - 実際の共重合の並び（交互・ランダム・ブロック）は条件で変わり、**一通りに決まらない**。
 *        どれか1つを勝手に選ぶと、画面が言えないことを言うことになる。
 *      - 既存の重合3本が全部「並べた順」なので、流儀を1つに保てる。
 *      - ★ **ユーザーが並べ替えれば思いどおりの並びになる** ＝ 決めるのを人に返せる。
 *   ② **画面では「交互共重合体ができます」と断定しない**（ユーザー指示）。
 *      caption は「並べた順につないだ」と、実際は一通りに決まらないことだけを言う。
 *   ③ **SBR の実在の比（スチレン1：ブタジエン3 など）に寄せない。**
 *      ⚠ 寄せるには根拠が要るが、**教科書も参考書も比を書いていない**（用途で変わる）。
 *      ＝ 比は**並べた個数がそのまま**になる。
 *   ④ **加硫と噛み合う**: ジエンの単位は 1,4-付加で中央に C=C が残るので、
 *      できた共重合体はそのまま `vulcanization` の相手になる（SBR → 加硫ゴム）。
 *
 * ⚠ **homopolymer の3本は今までどおり**。単一種のときは既存の札が出る
 *   （この札は「2種類以上あるとき」しか出ない）＝ 既存の見え方を1つも変えない。
 * ========================================================================== */

/**
 * 共重合につなげる単位を集める。返り値は
 *   ビニル系 … { kind:'vinyl', key, head, tail, comp, code, x, y }
 *   共役ジエン … { kind:'diene', key, d:{c1..c4}, comp, code, x, y }
 * ⚠ **同じ分子から2通り拾わない**: 共役ジエンは C=C を2本持つので
 *   `vinylBonds` 側の「1分子に C=C が1本だけ」の門番で自動的に外れる。
 */
function copolymerUnits(mol) {
    const units = [];
    const vinyls = vinylBonds(mol);
    vinyls.forEach(v => {
        const comp = componentOf(mol, v.head);
        if (vinyls.filter(w => comp.has(w.head)).length !== 1) return;
        units.push({ kind: 'vinyl', key: v.head, head: v.head, tail: v.tail, comp });
    });
    conjugatedDienes(mol).forEach(d => {
        units.push({ kind: 'diene', key: d.c1, d, comp: componentOf(mol, d.c1) });
    });
    units.forEach(u => {
        const heavy = [...u.comp].map(id => mol.atoms.find(a => a.id === id))
            .filter(a => a && a.element !== 'H');
        u.x = heavy.reduce((s, a) => s + a.x, 0) / (heavy.length || 1);
        u.y = heavy.reduce((s, a) => s + a.y, 0) / (heavy.length || 1);
        u.code = componentCode(mol, u.key);
        /* 鎖に入る側（in）と出る側（out）、それぞれの1つ内側（`inBack`／`back`）。
         * ★ 内側の原子は**鎖が伸びる向き**を決めるのに要る（`chainDirection`・§14）。 */
        if (u.kind === 'vinyl') { u.in = u.tail; u.inBack = u.head; u.out = u.head; u.back = u.tail; }
        else { u.in = u.d.c1; u.inBack = u.d.c2; u.out = u.d.c4; u.back = u.d.c3; }
    });
    return units;
}

/**
 * 「この鎖に入らなかった単量体」を数えて一言にする（v1541）。
 *
 * ⚠⚠ **ユーザー実機報告の芯**: スチレン2個＋ブタジエン2個で付加重合を押すと
 *   **スチレンだけが繋がってブタジエンが黙って残った**。⛔ 赤で止めるのは違う
 *   （2種類を別々に重合したい人もいる）ので、**残ったことをその場で言い、
 *   全部つなぐ札の名前を教える**。
 * ⚠ **反応を起こす前に呼ぶこと**（起こしたあとでは、使った単量体の C=C が
 *   もう無いので「残り」と区別できない）。
 */
function leftoverMonomerNote(mol, siteIds) {
    const used = new Set(siteIds);
    const all = copolymerUnits(mol);
    const rest = all.filter(u => !used.has(u.key) && !used.has(u.in) && !used.has(u.out));
    if (!rest.length) return '';
    const mixed = new Set(all.map(u => u.code)).size >= 2;
    return `\n⚠ **この鎖に入らなかった単量体が ${rest.length} 個、画面に残っています。**` +
        (mixed
            ? '並べたものを全部つないで1本の鎖にするなら、' +
              '「共重合（並べた単量体をすべてつなぐ）」のほうを選んでください。'
            : 'つなぎたいときは、もう一度この反応を実行してください。');
}

/** 画面に並べた順（長いほうの軸で左→右／上→下）に単位を並べ替える */
function sortCopolymerUnits(units) {
    const xs = units.map(u => u.x), ys = units.map(u => u.y);
    const spread = v => Math.max(...v) - Math.min(...v);
    const byX = spread(xs) >= spread(ys);
    return units.slice().sort((p, q) => (byX ? p.x - q.x : p.y - q.y));
}

/** その原子を含む分子（連結成分）の正準コード。同じ単量体かの判定に使う */
function componentCode(mol, atomId) {
    const ids = componentOf(mol, atomId);
    const sub = new Molecule();
    const map = new Map();
    mol.atoms.filter(a => ids.has(a.id)).forEach(a => {
        map.set(a.id, copyAtomMarks(sub.addAtom(a.element, a.x, a.y), a).id);
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
 * `startId` から先の枝（`cId` を通らない側）の原子IDを返す（v1593・§30）。
 * 枝が主鎖の炭素へ**2か所でつながっている**（＝ C=C を含む環）なら null。
 * 剛体で回すと環が壊れるので、そういう枝は触らない。
 */
function branchBeyond(mol, startId, cId, chainIds) {
    const seen = new Set([startId]);
    const out = [startId];
    const stack = [startId];
    while (stack.length) {
        const id = stack.pop();
        for (const n of mol.getNeighbors(id)) {
            if (chainIds.has(n.atom.id)) {
                if (id === startId && n.atom.id === cId) continue; // 付け根そのもの
                return null;
            }
            if (seen.has(n.atom.id)) continue;
            seen.add(n.atom.id);
            stack.push(n.atom.id);
            out.push(n.atom.id);
        }
    }
    return out;
}

/**
 * 倒したあとの図が読めるか（重原子が詰まっていないか・結合線が原子を貫通しないか）。
 * 物差しは game.js の `reshapeVinylAngles` と同じで、**倒したせいで詰まったときだけ**だめとする
 * （元から詰まっている図は倒す前も後も同じなので、こちらの責任ではない）。
 */
function foldedLayoutOk(mol, ids, gapBefore) {
    const heavy = [...ids].map(id => mol.atoms.find(a => a.id === id))
        .filter(a => a && a.element !== 'H');
    if (heavy.length < 2) return true;
    const gap = minGapAmong(heavy);
    if (gap < bondStep(mol, heavy[0].id) * 0.65 && gap < gapBefore - 1e-6) return false;
    const byId = new Map(heavy.map(a => [a.id, a]));
    return !mol.bonds.some(b => {
        const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
        if (!p || !q) return false;
        return heavy.some(a => a.id !== p.id && a.id !== q.id &&
            pointSegmentDistance(a, p, q) < SHOVE_LINE_CLEARANCE);
    });
}

/**
 * 開いた C=C の炭素にぶら下がる枝を、**主鎖に垂直な向き**へ倒す（v1593・§30）。
 *
 * 付加重合が「生成物を配置する空間がありません」で止まる分子（スチレン・酢酸ビニル・
 * メタクリル酸メチル…）は、置換基が**鎖の伸びる先に描かれている**のが原因。
 * 呼び出したスチレンはベンゼン環が head 炭素の真横（＝次の単量体を置く位置）にあり、
 * どの向き・どの回転でも自分の環と当たる（環があるので `canSpin90` の 90° 回転も使えない）。
 *
 * ★ **`uprightChainSubstituent`（2026-08-26・§18-1）との違い**（ユーザー決定 2026-09-19）:
 *   あちらは**すべての単量体の置換基を上下交互に立てる**ので、置換基が道を塞いでいない
 *   塩化ビニルの -Cl まで縦に倒れ、酢酸ビニルのアセトキシ基も上下交互・中の結合が斜めになっていた。
 *   付加重合はこちらに切り替え、「そのまま」→「同じ側（真下）」→「1つおき」の順に試して
 *   **最初に主鎖が一直線になった形**を採る（`addition_polymerization` の注記）。
 *   ⚠ 共重合（`copolymerization`）は `uprightChainSubstituent` のままだが、
 *     **側は交互ではなく全部が真下**（v1606・I-0053・ユーザー決定「他と揃えて↓でよいです」）。
 *     ＝ 出てくる図の向きは付加重合とそろう。仕組みを1本化するかは別の話として残っている。
 *
 * ⚠ **CLAUDE.md の作図例外（±120°）とはぶつからない。** あの例外は「名称から呼び出した
 * 分子の、環に含まれない **C=C** まわり」の話で、二重結合が平面だから 120° に開く。
 * 付加重合は**その二重結合を単結合に開くのが本体**なので、開いた時点で炭素は sp3 になり
 * 例外の対象から外れる ―― つまりここでやるのは**直交作図へ戻す**ことであって、
 * 例外を1つ増やすことではない。垂直に倒した形は登録済みの
 * `polyvinyl-alcohol`（主鎖 y=300 の一直線に -OH が y=342 ＝真下）そのもの。
 *
 * 動かすのは枝の**角度だけ**で、`c-枝` の結合長も枝の中の距離も1つも変えない
 * （回転と平行移動だけの剛体移動）。座標は見た目専用なので判定には影響しない。
 * 枝が2本ある 1,1-二置換（メタクリル酸メチル）は上下へ振り分ける。
 *
 * 倒せたら true。3本以上ぶら下がる炭素と、環が主鎖へ回り込む枝は触らない。
 */
function foldPendantsPerpendicular(mol, cId, chainIds, perp) {
    const c = mol.atoms.find(a => a.id === cId);
    if (!c) return false;
    const subs = mol.getNeighbors(cId)
        .filter(n => n.atom.element !== 'H' && !chainIds.has(n.atom.id))
        .map(n => n.atom);
    if (!subs.length || subs.length > 2) return false;
    // どちらの枝を優先の側（下）に置くか。**座標で決める**
    // （原子IDは乱数なので順序に頼らない ―― `acetyleneUnits` と同じ約束）
    const along = (a, d) => d.x * (a.x - c.x) + d.y * (a.y - c.y);
    subs.sort((p, q) => along(q, perp) - along(p, perp));
    const sides = [perp, { x: -perp.x, y: -perp.y }];
    const ringIds = typeof ringAtomIds === 'function' ? ringAtomIds(mol) : new Set();
    let moved = false;
    subs.forEach((s, i) => {
        const branch = branchBeyond(mol, s.id, cId, chainIds);
        if (!branch) return;
        const dir = sides[i];
        const len = Math.hypot(s.x - c.x, s.y - c.y) || bondStep(mol, cId);
        /*
         * 枝を回す量は「枝が伸びていく向き」を垂直に合わせる角度。伸びていく向きは
         * **付け根の先の重心**で見る（環のように次の1本が2方向へ分かれる枝でも決まる）。
         * さらに **90°の倍数へ丸める**: 枝の中は直交で描かれているので、
         * 半端な角度で回すと枝の中の直角がすべて斜めになる
         * （酢酸ビニルのアセトキシ基で実測。-30° で回すと -O-C(-O)-C が 30° 傾いた）。
         */
        const rest = branch.filter(id => id !== s.id)
            .map(id => mol.atoms.find(a => a.id === id))
            .filter(a => a && a.element !== 'H');
        const out = rest.length
            ? { x: rest.reduce((t, a) => t + a.x, 0) / rest.length - s.x,
                y: rest.reduce((t, a) => t + a.y, 0) / rest.length - s.y }
            : { x: s.x - c.x, y: s.y - c.y };
        /*
         * ⚠ **環を含む枝だけは丸めない**（v1593 の取り込み直しで足した）。環は付け根の結合の
         *   延長上に中心が来る**放射状**で描かれている（§18-1 原因1）ので、`c-枝` の結合を
         *   ちょうど垂直にする角度で回せば放射状のまま立つ。90°へ丸めるとスチレンの環が
         *   30° ずれ、**六角形の辺の途中から主鎖へ結合が出ているように見えた**（実測）。
         *   環の辺は元から斜めなので、丸めで守るべき直角がそもそも無い。
         */
        const hasRing = branch.some(id => ringIds.has(id));
        const step = Math.PI / 2;
        let rot = hasRing
            ? Math.atan2(dir.y, dir.x) - Math.atan2(s.y - c.y, s.x - c.x)
            : Math.round((Math.atan2(dir.y, dir.x) - Math.atan2(out.y, out.x)) / step) * step;
        /* ★ ニトリル（枝の付け根から三重結合が1本だけ出る −C≡N）は、**C≡N を主鎖に平行**に寝かせる
         *   （I-0132・2026-09-24 ユーザー「ポリアクリロニトリル：C≡N を炭素鎖に平行に」。形は
         *   「CH から下へ価標、C≡N は横向き」＝ 教科書の −CH(−C≡N)− の書き方）。
         *   付け根の結合 c−C は上のとおり主鎖に垂直、その先の ≡N は主鎖の向き（読む向きの右）へ */
        const tripleTail = !hasRing && rest.length === 1 && (() => {
            const b = mol.getBond(s.id, rest[0].id);
            return !!(b && b.type === 3);
        })();
        if (tripleTail) {
            let t = { x: -dir.y, y: dir.x };
            if (t.x < -1e-9 || (Math.abs(t.x) < 1e-9 && t.y < 0)) t = { x: -t.x, y: -t.y };
            rot = Math.atan2(t.y, t.x) - Math.atan2(out.y, out.x);
        }
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const nx = c.x + len * dir.x, ny = c.y + len * dir.y;
        const sx = s.x, sy = s.y;
        branch.forEach(id => {
            const a = mol.atoms.find(x => x.id === id);
            if (!a) return;
            const rx = a.x - sx, ry = a.y - sy;
            a.x = nx + rx * cos - ry * sin;
            a.y = ny + rx * sin + ry * cos;
        });
        moved = true;
    });
    return moved;
}

/**
 * 開いた単量体を頭-尾の順に繋いで1本の鎖にする（`addition_polymerization` の本体・v1593・§30）。
 *
 * `fold` は置換基の倒し方:
 *   - `'none'` … 触らない（呼び出したときの ±120° のまま。**これを最初に試す**ので、
 *     置換基が道を塞いでいない分子（塩化ビニル・アクリロニトリル…）はこの形で出る）
 *   - `'same'` … すべて同じ側（下）へ倒す。登録済み `polyvinyl-alcohol` と同じ形
 *   - `'alternate'` … 1つおきに反対側へ倒す。**ベンゼン環のように太い置換基**では
 *     同じ側に並べると隣どうしが 14.8px まで詰まる（実測。単位の間隔 84px に対し
 *     縦に倒した環の幅が 69.2px）ので、上下へ振り分けないと置けない
 *
 * 途中で置けなくなったら**座標も足した結合も元へ戻して** null を返す。
 * 呼び出し側が次の手を試すので、**この関数が失敗しても分子は1つも変わらない**。
 */
function linkVinylUnits(mol, units, fold) {
    const snap = mol.atoms.map(a => ({ a, x: a.x, y: a.y }));
    const added = [];
    // 足した結合を先に外してから座標を戻す（順番を逆にすると removeBond が見つけられない）
    const undo = () => {
        added.forEach(([p, q]) => mol.removeBond(p, q));
        snap.forEach(s => { s.a.x = s.x; s.a.y = s.y; });
    };
    const dir = chainDirection(mol, units[0].tail, units[0].head);
    let folded = false;
    if (fold !== 'none' && dir) {
        // 主鎖に垂直な2方向。横向きの鎖なら「下」を先に使う
        // （登録済み `polyvinyl-alcohol` は主鎖 y=300 に対して -OH が y=342 ＝真下）
        const perps = Math.abs(dir.x) >= Math.abs(dir.y)
            ? [{ x: 0, y: 1 }, { x: 0, y: -1 }]
            : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
        units.forEach((u, i) => {
            const ids = componentOf(mol, u.head);
            const before = mol.atoms.filter(a => ids.has(a.id)).map(a => ({ a, x: a.x, y: a.y }));
            const gapBefore = minGapAmong(before.map(b => b.a).filter(a => a.element !== 'H'));
            const side = perps[(fold === 'alternate' && i % 2) ? 1 : 0];
            const chainIds = new Set([u.head, u.tail]);
            const hit = [u.head, u.tail]
                .map(cId => foldPendantsPerpendicular(mol, cId, chainIds, side))
                .some(Boolean);
            // 倒したせいで図が読めなくなるなら、その単量体だけ元へ戻す
            if (!hit) return;
            if (foldedLayoutOk(mol, ids, gapBefore)) folded = true;
            else before.forEach(b => { b.a.x = b.x; b.a.y = b.y; });
        });
    }
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
        if (!plan) { undo(); return null; }
        applyAttachment(mol, movingIds, plan);
        mol.addBond(linkFrom, u.tail, 1);
        added.push([linkFrom, u.tail]);
        changed.push(linkFrom, u.tail);
        linkBack = u.tail;
        linkFrom = u.head; // 次はこの単量体の頭に繋ぐ
    }
    return { changed, linkFrom, linkBack, folded, undo };
}

/**
 * できた主鎖（tail₀-head₀-tail₁-head₁-…）が一直線か（v1593・§30）。
 * §14 の PM3 と同じ主張を、R を付ける前の段階で**倒し方を選ぶために**使う。
 * 「隣どうしの差がすべて同じベクトル」＝ 折れ0・ばらつき0・刻み一定 を一度に見ている。
 */
function mainChainStraight(mol, units) {
    const pts = units.flatMap(u => [u.tail, u.head])
        .map(id => mol.atoms.find(a => a.id === id));
    if (pts.some(p => !p) || pts.length < 3) return true;
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    return pts.every((p, i) => i === 0 ||
        (Math.abs(p.x - pts[i - 1].x - dx) < 1 && Math.abs(p.y - pts[i - 1].y - dy) < 1));
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
/* ============================================================================
 * ★★ 1,4-付加重合でできた鎖を **シス形／トランス形に描き分ける**（v1587・発注書 L）
 *
 * ユーザー判断（2026-09-17）「イソプレンであれば、**②を基本、ただし比較のために③**」＝
 *   **シス形を既定**（天然ゴム ＝ シス-1,4-ポリイソプレン）にし、
 *   **比較のためにトランス形（グタペルカ）へ切り替えられる**ようにする。
 *
 * ⚠⚠ **v1586 まで、できる鎖は必ずトランス形だった**（実測。鎖の C=C 2か所とも
 *   主鎖が反対側）。「ゴムが弾むようになるまで」（V130）の題と真逆の図で、
 *   画面は天然ゴムではなく**グタペルカ**を描いていた。
 *
 * ★★ **なぜ「その場で裏返す」ではなく「鎖を引き直す」のか**（実測してこちらにした）:
 *   いまの図は C=C が 60° の斜めで、主鎖の C1・C4 はどちらも水平に出ている。
 *   この向きだと **C1 も C4 も 120° の空き2か所のうち片方しか選べず、
 *   どう入れ替えてもトランスにしかならない**（もう片方は鎖が自分の上に折り返す）。
 *   ＝ シスにするには **C=C を水平に置き直す**しかない。
 *
 * ★ 引き直す形（S ＝ 結合1本・DX/DY ＝ 120° の刻み）:
 *   - **C=C は水平**（C2 → C3 が +S）
 *   - シス … C1 は C2 の左下・C4 は C3 の右下 ＝ **主鎖が同じ側** → 鎖は水平のまま山形に折れる
 *   - トランス … C4 だけ右上 ＝ **主鎖が反対側** → 鎖は階段状にまっすぐ伸びる
 *   どちらも教科書の図の形で、「シスは折れ、トランスはまっすぐ」がそのまま画になる。
 *
 * ⚠ **座標しか動かさない**（CLAUDE.md「検証はトポロジーのみ」）。結合・元素・電荷は無傷。
 * ========================================================================== */

/** 鎖の両端の R をたどって主鎖の原子列を返す（R … R）。線形の鎖でなければ null */
function polymerBackbonePath(mol, seedId) {
    const comp = componentOf(mol, seedId);
    const rs = [...comp].map(id => mol.atoms.find(a => a.id === id))
        .filter(a => a && a.element === 'R');
    if (rs.length !== 2) return null;
    // R → R の道を1本だけ探す（枝に入っても行き止まりで戻る）
    const goal = rs[1].id;
    const path = [];
    const seen = new Set();
    const walk = (id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        path.push(id);
        if (id === goal) return true;
        for (const n of mol.getNeighbors(id)) {
            if (n.atom.element === 'H') continue;
            if (walk(n.atom.id)) return true;
        }
        path.pop();
        return false;
    };
    return walk(rs[0].id) ? path : null;
}

/** その鎖の C=C が主鎖から見てシス形（主鎖が同じ側）か。1つも無ければ null */
function dieneChainIsCis(mol, path) {
    const at = id => mol.atoms.find(a => a.id === id);
    for (let i = 1; i + 2 < path.length; i++) {
        const b = mol.getBond(path[i], path[i + 1]);
        if (!b || b.type !== 2) continue;
        const c2 = at(path[i]), c3 = at(path[i + 1]), c1 = at(path[i - 1]), c4 = at(path[i + 2]);
        if (!c1 || !c2 || !c3 || !c4) continue;
        const ax = c3.x - c2.x, ay = c3.y - c2.y;
        const side = (p, o) => Math.sign(ax * (p.y - o.y) - ay * (p.x - o.x));
        const s1 = side(c1, c2), s4 = side(c4, c3);
        if (!s1 || !s4) continue;
        return s1 === s4;
    }
    return null;
}

/**
 * 主鎖を引き直して、C=C をすべてシス形（`cis`）またはトランス形にする。
 * ⚠ **置けなければ1原子も動かさない**（呼び出し側は今までどおりの図になるだけ）。
 * @returns 引き直したら true
 */
function layoutDieneChain(mol, path, cis) {
    const S = GRID_SIZE, DX = S / 2, DY = S * Math.sqrt(3) / 2;
    const at = id => mol.atoms.find(a => a.id === id);
    const inPath = new Set(path);
    // 主鎖から下がる枝（H 以外）。枝の中身は形を保ったまま、付け根の移動ぶんだけ運ぶ
    const branchOf = new Map();
    path.forEach(id => {
        const subs = mol.getNeighbors(id).map(n => n.atom)
            .filter(a => a.element !== 'H' && !inPath.has(a.id));
        if (subs.length) branchOf.set(id, subs);
    });
    /* 進む向きを1本ずつ決める。⚠ **C=C は必ず水平**にし、その前後を 120° で受ける
     *   ＝ シス／トランスの違いは「C=C の次の一歩を下げるか上げるか」だけになる。 */
    const steps = [];
    for (let i = 0; i + 1 < path.length; i++) {
        const b = mol.getBond(path[i], path[i + 1]);
        const prevWasDouble = i > 0 && (mol.getBond(path[i - 1], path[i]) || {}).type === 2;
        if (b && b.type === 2) steps.push({ x: S, y: 0 });                    // C=C は水平
        else if (i + 2 < path.length && (mol.getBond(path[i + 1], path[i + 2]) || {}).type === 2)
            steps.push({ x: DX, y: -DY });                                    // C=C へ入る一歩（上げる）
        else if (prevWasDouble) steps.push({ x: DX, y: cis ? DY : -DY });     // ★ ここだけがシス／トランス
        else steps.push({ x: S, y: 0 });                                      // つなぎ目（水平）
    }
    // 新しい座標を先に全部作る（置けるか確かめてから当てる）
    const start = at(path[0]);
    if (!start) return false;
    const pos = new Map([[path[0], { x: start.x, y: start.y }]]);
    steps.forEach((d, i) => {
        const p = pos.get(path[i]);
        pos.set(path[i + 1], { x: p.x + d.x, y: p.y + d.y });
    });
    // sp2 炭素の1原子の枝（メチル・塩素）は、主鎖の反対側の 120° の席に置く
    const slot = new Map();
    for (let i = 1; i + 1 < path.length; i++) {
        const b2 = mol.getBond(path[i], path[i + 1]), b0 = mol.getBond(path[i - 1], path[i]);
        const isSp2 = (b2 && b2.type === 2) || (b0 && b0.type === 2);
        const subs = branchOf.get(path[i]);
        if (!isSp2 || !subs || subs.length !== 1 || mol.getNeighbors(subs[0].id)
            .filter(n => n.atom.element !== 'H').length !== 1) continue;
        const me = pos.get(path[i]);
        const other = (b2 && b2.type === 2) ? pos.get(path[i - 1]) : pos.get(path[i + 1]);
        // 主鎖の相手（other）の鏡 ＝ C=C 軸をはさんで反対側の席
        const axis = (b2 && b2.type === 2) ? pos.get(path[i + 1]) : pos.get(path[i - 1]);
        const ux = (axis.x - me.x) / (Math.hypot(axis.x - me.x, axis.y - me.y) || 1);
        const uy = (axis.y - me.y) / (Math.hypot(axis.x - me.x, axis.y - me.y) || 1);
        const wx = other.x - me.x, wy = other.y - me.y;
        const dot = wx * ux + wy * uy;
        slot.set(subs[0].id, { x: me.x + ux * dot - (wx - ux * dot), y: me.y + uy * dot - (wy - uy * dot) });
    }
    // 鎖の外の原子とぶつからない高さを探す（見つからなければ何もしない）
    const movingIds = new Set([...path, ...[...branchOf.values()].flat().map(a => a.id)]);
    const outside = mol.atoms.filter(a => a.element !== 'H' && !movingIds.has(a.id));
    const MIN = S * 0.65;
    const spots = () => {
        const list = [...pos.entries()].map(([id, p]) => p);
        slot.forEach(p => list.push(p));
        branchOf.forEach((subs, id) => subs.forEach(s => {
            if (slot.has(s.id)) return;
            const d = { x: pos.get(id).x - at(id).x, y: pos.get(id).y - at(id).y };
            list.push({ x: s.x + d.x, y: s.y + d.y });
        }));
        return list;
    };
    let shift = 0;
    for (let k = 0; k <= 12; k++) {
        shift = k * 3 * S;
        const ok = spots().every(p =>
            outside.every(o => Math.hypot(o.x - p.x, o.y - (p.y + shift)) >= MIN));
        if (ok) break;
        if (k === 12) return false;
    }
    // ここから実際に動かす
    branchOf.forEach((subs, id) => {
        const d = { x: pos.get(id).x - at(id).x, y: pos.get(id).y + shift - at(id).y };
        subs.forEach(s => {
            if (slot.has(s.id)) return;
            [...componentOfBlocked(mol, s.id, path)].forEach(bid => {
                const a = at(bid); if (a) { a.x += d.x; a.y += d.y; }
            });
        });
    });
    path.forEach(id => { const a = at(id); const p = pos.get(id); a.x = p.x; a.y = p.y + shift; });
    slot.forEach((p, id) => { const a = at(id); if (a) { a.x = p.x; a.y = p.y + shift; } });
    return true;
}

/** `from` から届く原子（`blocked` は越えない） */
function componentOfBlocked(mol, from, blocked) {
    const stop = new Set(blocked);
    const seen = new Set([from]);
    const st = [from];
    while (st.length) {
        const id = st.pop();
        mol.getNeighbors(id).forEach(n => {
            if (stop.has(n.atom.id) || seen.has(n.atom.id)) return;
            seen.add(n.atom.id); st.push(n.atom.id);
        });
    }
    return seen;
}

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
/**
 * ★ エテン（エチレン）1分子を探す（v1541）。`acetyleneUnits` の C=C 版。
 *
 * ⚠ **門番はあちらと同じ「分子全体が C=C の2原子だけ」**にした。参考書（`alkene.md`）が
 * 付加の式を書いているのは **エテンだけ**で、「エテンへの付加反応の式は、どれも書けるように
 * してください」と名指ししている。★ 一般のアルケンへ広げる根拠が本文に無いので広げない
 * （広げると、-COOH と C=C を同じ分子に持つアクリル酸などで「どちらが先か」を
 *  自分で決めることになる ＝ 参考書に無い判断をアプリが勝手にする）。
 *
 * 返り値は {left, right}。**左右は座標で決める**（理由は `acetyleneUnits` と同じ）。
 */
function etheneUnits(mol) {
    return doubleOrTripleUnits(mol, 2);
}

function acetyleneUnits(mol) {
    return doubleOrTripleUnits(mol, 3);
}

/** `acetyleneUnits` / `etheneUnits` の共通部分（数え方を2つに増やさないため1か所に置く） */
function doubleOrTripleUnits(mol, wantType) {
    const out = [];
    mol.bonds.forEach(b => {
        if (b.type !== wantType) return;
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

/* ==========================================================================
 * 脱ハロゲン化水素・アルキンの三量化・小さい環の開裂（v1541・参考書の式3本）
 * ========================================================================== */

// ⚠ **F は意図して入れていない**（2026-09-22・I-0014）。C–F からの −HF 脱離は高校の教科書に無く、
//   足すと「1-フルオロプロパン → プロペン」という習わない札がアプリに出る。
//   ここに載せないことで、**F を含む分子はこの下の門番（炭化水素とハロゲンだけ）で丸ごと落ちる**
//   ＝ 安全側に倒れる。`ringDirector`（配向性の解説）に F を足さないのも同じ理由で、
//   あちらは知らない元素だと null を返す＝黙るだけで誤った解説は出ない
const RX_HALOGENS = ['Cl', 'Br', 'I'];

/**
 * 脱ハロゲン化水素（−HX）ができる箇所 `[X のついた C, 水素のある隣の C, X]`。
 *
 * ⚠⚠ 参考書の **1,2-ジクロロエタン → 塩化ビニル**（PVC の原料を作る道）が
 *   アプリで起こせなかった（v1540 の実測）。
 * ★ 門番は「**その分子が炭化水素とハロゲンだけ**でできていること」。
 *   -OH や -COOH が混ざるものは別の反応（脱水・エステル化）が先に来るので扱わない。
 * ⚠ **同じ生成物になる向きは畳む** —— 1,2-ジクロロエタンは左右どちらの Cl を抜いても
 *   塩化ビニルになるので、札が2枚出ると「違うものが2つできる」と読める。
 *   畳み方は `sideChainOxidationSites` と同じ手口（**生成物の正準コード**で数える）。
 */
function dehydrohalogenationSites(mol) {
    const cands = [];
    const seen = new Set();
    const posOf = id => mol.atoms.find(x => x.id === id);
    /* ⚠⚠ **芳香環の炭素は外す**（実測で踏んだ）。クロロベンゼンで札が出て、
     *   環の中に4本目の二重結合が入った**実在しない分子**ができていた。
     *   ★ 芳香族の C-Cl は切れにくく、教科書は高温高圧の加水分解
     *     （`hydrolysis_chlorobenzene`）でしか扱わない。 */
    const aromatic = aromaticAtomSet(mol);
    mol.bonds.forEach(bond => {
        if (bond.type !== 1) return;
        if (aromatic.has(bond.atomId1) || aromatic.has(bond.atomId2)) return;
        const pair = [mol.atoms.find(x => x.id === bond.atomId1),
            mol.atoms.find(x => x.id === bond.atomId2)];
        if (pair.some(a => !a || a.element !== 'C')) return;
        [[0, 1], [1, 0]].forEach(([i, j]) => {
            const ca = pair[i], cb = pair[j];
            if (mol.getFreeValency(cb.id) < 1) return;          // 抜ける水素が無い
            // 同じ炭素にハロゲンが2つ以上（1,1-ジクロロ…）なら、どれを抜くかも座標で決める
            const hal = mol.getNeighbors(ca.id)
                .filter(n => n.type === 1 && RX_HALOGENS.includes(n.atom.element))
                .sort((p, q) => (p.atom.x - q.atom.x) || (p.atom.y - q.atom.y))[0];
            if (!hal) return;
            const comp = componentOf(mol, ca.id);
            if (mol.atoms.some(x => comp.has(x.id) && x.element !== 'C' && x.element !== 'H' &&
                !RX_HALOGENS.includes(x.element))) return;
            // 「できる分子」を位相だけ組んで正準コードで畳む（同じ分子の中の等価な向きだけ）
            const ids = [...comp].filter(id => id !== hal.atom.id);
            const { mol: sub, map } = subMolecule(mol, ids);
            const nb = sub.getBond(map.get(ca.id), map.get(cb.id));
            if (!nb) return;
            nb.type = 2;
            const key = [...comp].sort().join(',') + '|' + canonicalCode(sub);
            cands.push({ key, site: [ca.id, cb.id, hal.atom.id] });
        });
    });
    /* ⚠⚠ **畳む前に座標で並べる**（v1591・DT1）。`Bond` は端点を**原子IDの小さい順**に
     *   持つので、上の `[[0, 1], [1, 0]]` はどちらの向きが先に来るかが**原子IDの乱数で決まる**。
     *   そのまま「先に来たほうを残す」と、1,2-ジクロロエタンで**どちらの Cl が抜けるか**
     *   （＝ 生成物の図）が呼ぶたびに入れ替わっていた（1,2-ジブロモエタン・
     *   ヘキサクロロシクロヘキサンも同じ）。残す1件は「X の付いた炭素 → 相手の炭素 → X」の
     *   座標の順（左 → 上）で決める（CLAUDE.md「原子IDに順序を頼らない」）。 */
    const cmp = (p, q) => (p.x - q.x) || (p.y - q.y);
    cands.sort((u, v) => {
        for (let k = 0; k < 3; k++) {
            const d = cmp(posOf(u.site[k]), posOf(v.site[k]));
            if (d) return d;
        }
        return 0;
    });
    const out = [];
    cands.forEach(({ key, site }) => {
        if (seen.has(key)) return;
        seen.add(key);
        out.push(site);
    });
    return out;
}

/**
 * 小さい環（三員環の炭素環）を開いて付加できる箇所 `[環の炭素A, 環の炭素B]`。
 *
 * ★ **対象はシクロプロパンだけ**（重原子が炭素3個の環）。教科書が「環に**ひずみ**があるので
 *   小さい環は付加で開く」と書いているのはこの形で、置換基の付いた三員環まで広げると
 *   **どの辺が切れるか**が一意に決まらない（できる分子も名前が付かない）。
 * ⚠ どの辺を切っても同じものができるので、返すのは **1件だけ**。
 */
function strainedRingSites(mol) {
    const out = [];
    const seen = new Set();
    mol.atoms.forEach(a => {
        if (a.element !== 'C' || seen.has(a.id)) return;
        const comp = [...componentOf(mol, a.id)];
        comp.forEach(id => seen.add(id));
        const heavy = comp.map(id => mol.atoms.find(x => x.id === id))
            .filter(x => x && x.element !== 'H');
        if (heavy.length !== 3 || !heavy.every(x => x.element === 'C')) return;
        // 3本とも単結合で環になっていること
        const ring = [];
        for (let i = 0; i < 3; i++) {
            for (let j = i + 1; j < 3; j++) {
                const b = mol.getBond(heavy[i].id, heavy[j].id);
                if (b) ring.push(b);
            }
        }
        if (ring.length !== 3 || ring.some(b => b.type !== 1)) return;
        out.push([ring[0].atomId1, ring[0].atomId2]);
    });
    return out;
}

/**
 * **AB型の単量体**（1分子の中に -COOH と -OH を1つずつ持つ ＝ ヒドロキシ酸）が
 * 2個以上並んでいるかを見る（v1541）。返り値は左から並べた単位の配列（無ければ null）。
 *
 * ⚠⚠ **参考書の「n 乳酸 → ポリ乳酸」がここで落ちていた。** 既存の
 *   `condensationPolymerUnits` は「2価の酸 ＋ 2価のアルコール」という**対**しか見ないので、
 *   1分子で両方を持つ単量体は実測で0件だった。
 *
 * ★ **アミノ酸（-COOH ＋ -NH₂）は入れない。** 教科書はアミノ酸の縮合を
 *   「ペプチド結合を1本ずつ作る」形で教えており、その道は `amidation` に既にある。
 *   ここで一気に繋ぐ札を足すと、同じことをする入口が2つになる。
 *   ⚠ ヒドロキシ酸のほうは**どこにも道が無かった**ので足す。
 */
function hydroxyAcidUnits(mol) {
    const groups = findFunctionalGroups(mol);
    const seen = new Set();
    const units = [];
    mol.atoms.forEach(a => {
        if (seen.has(a.id)) return;
        const ids = componentOf(mol, a.id);
        ids.forEach(i => seen.add(i));
        const heavy = [...ids].map(i => mol.atoms.find(x => x.id === i))
            .filter(x => x && x.element !== 'H');
        if (heavy.length < 3) return;
        const mine = groups.filter(g => ids.has(g.atomIds[0]));
        const cx = mine.filter(g => g.type === 'carboxyl');
        const al = mine.filter(g => ALCOHOL_TYPES.includes(g.type));
        // ⚠ **ちょうど1つずつ**。2つ以上あるものは既存の「2価の単量体」の担当
        if (cx.length !== 1 || al.length !== 1) return;
        // ⚠ ほかの反応性の基（アミン・フェノール・アルデヒド…）が混ざるものは扱わない
        if (mine.length !== 2) return;
        units.push({
            ids, acid: { c: cx[0].atomIds[0], oh: cx[0].atomIds[2] }, other: { x: al[0].atomIds[0] },
            code: componentCode(mol, heavy[0].id),
            x: Math.min(...heavy.map(h => h.x))
        });
    });
    if (units.length < 2) return null;
    // **同じ単量体だけ**（既存の縮合重合と同じ約束。違う種類の混合は共重合の話）
    const same = units.filter(u => u.code === units[0].code);
    if (same.length < 2) return null;
    return same.sort((p, q) => p.x - q.x);
}

/**
 * マルコフニコフ則で「置換基（X・OH・O）が付く側」の炭素を返す（`id1` / `id2` のどちらか）。
 *
 * ⚠ **数えるのは置換基であって炭素ではない**（v1591・claude/festive-gauss-213324 の取り込み直し）。
 * v1590 まではここが `element === 'C'` で**炭素だけ**を数えていたため、
 * ビニル位にヘテロ原子が付いた分子で左右が同点になり、**行き先が決まっていなかった**:
 *   - 塩化ビニル ＋ HCl … 1,1-ジクロロエタン と 1,2-ジクロロエタン が**呼ぶたびに入れ替わる**
 *     （同点のときは `site` の並び ＝ 原子IDの順で決まり、原子IDは乱数のため）
 *   - 同じ形の 酢酸ビニル・ビニルアルコール・メチルビニルエーテル も同様
 * 画面に出す文（「X は置換基の多い炭素へ」）はもともと置換基と書いてあり、
 * **文のほうが正しくてコードが炭素に狭めていた**。C=C の炭素は σ 結合が3本なので
 * 「置換基の数」と「水素の数」は裏返しの関係にあり、教科書の言い方
 * （H はすでに H の多い炭素へ）とも一致する。
 *
 * 同点（エチレン・2-ブテン・2-ヘキセンのように左右が本当に対等）のときは
 * **座標で決める**（`orderByPosition`。左上を先に採る）。回帰テストは tests.js の MK1・DT1。
 */
function markovnikovCarbon(mol, id1, id2) {
    const subs = (id, other) => mol.getNeighbors(id)
        .filter(n => n.atom.element !== 'H' && n.atom.id !== other).length;
    const n1 = subs(id1, id2), n2 = subs(id2, id1);
    if (n1 !== n2) return n1 > n2 ? id1 : id2;
    return orderByPosition(mol, [id1, id2])[0];
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
        cX = markovnikovCarbon(mol, id1, id2);
        cY = cX === id1 ? id2 : id1;
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
 * ② 環状の糖のアノマー炭素（ヘミアセタール／ヘミケタール）… 水の中で開環して
 *    カルボニル基を出すので還元性を示す。「環の酸素」と「環の外の -OH」が
 *    同じ炭素についている形で見分ける。
 *    グリコシド結合（スクロース側）の酸素は重原子の隣が2つあるので外れる ＝ 非還元糖。
 *    ⚠ **この②は「隣に水素があるか」を要求していない**ので、ケトースの環状形
 *    （α/β-D-フルクトフラノース ＝ ヘミケタール）も前から陽性で拾えている（実測・v1511）。
 * ★ ③ **α-ヒドロキシケトン**（カルボニル炭素の隣の炭素に -OH）… 塩基性の条件で
 *    **エンジオールを経てアルデヒドへ移る**ので還元性を示す。**鎖状のフルクトースが代表**で、
 *    「ケトースなのに還元糖」の理由がこれ（教科書もフェーリング液で陽性として扱う）。
 *
 * ⚠⚠ ③ の門番は **「α炭素に水素が残っている」の1つだけ**（自由価標が1以上）。
 *   エンジオールは α位の水素がエノール化して初めてできるので、これが化学そのものの条件になる。
 *   ★ この1つで **α-ケト酸**（ピルビン酸・オキサロ酢酸・α-ケトグルタル酸・2-オキソ酪酸の4件）が
 *   ちょうど落ちる —— あれは隣の -OH が **カルボキシ基の -OH** で、その炭素は
 *   C・=O・-OH で価標を使い切っていて水素が無い。
 *   ⚠ **はじめは「α炭素が sp3」の門番も並べていたが、外した。** 実測すると
 *   **ライブラリ1,000件超のどれでも結果が1件も変わらず**（陽性 111 件のまま）、
 *   ⚠ **否定対照が赤くならなかった**（KT を3件とも通した）＝ 効いていない門番だった。
 *   ★ 効かない門番を残すと「対照が対照になっていない」ことに気づけなくなる。
 *
 * ⚠ **糖を名指ししない**（この関数はもともと「判定を構造から引く」で通している）。
 *   ③ で新しく陽性になるのは実測で5件 —— D-フルクトース（鎖状）・ヒドロキシアセトン・
 *   ジヒドロキシアセトン・2-ヒドロキシシクロペンタノン・2-ヒドロキシシクロヘキサノン。
 *   後ろ2つ（アシロイン）も実際にフェーリング液を還元するので、広がりすぎではない。
 */
function reducingCarbonylAtoms(mol) {
    const ids = [];
    const groups = findFunctionalGroups(mol);
    groups
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
    // ③ α-ヒドロキシケトン（ケトースが還元糖になる理由）
    groups.filter(g => g.type === 'ketone').forEach(g => {
        const [cId, oId] = g.atomIds;
        mol.getNeighbors(cId)
            .filter(n => n.type === 1 && n.atom.element === 'C')
            .forEach(n => {
                const alpha = n.atom.id;
                if (mol.getFreeValency(alpha) < 1) return; // α位に水素が無い ＝ エンジオールにならない
                const oh = mol.getNeighbors(alpha).find(x => x.type === 1 && x.atom.element === 'O' &&
                    mol.getNeighbors(x.atom.id).filter(y => y.atom.element !== 'H').length === 1);
                if (oh) ids.push(cId, oId, alpha, oh.atom.id);
            });
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
    /* ★ 塩酸だけは仕事が3つになる（DESIGN_ion_layer.md I-1・D-I4「瓶を足さず相乗り」）:
     *   付加（C=C・C≡C）／弱酸の遊離（入試の遊離 45件がこれ）／アミンの塩（水層へ・46件）。
     *   ⚠ **瓶は1本も増えていない**。増えたのは、この瓶に繋がるルールのほう。 */
    acts: h.key === 'hcl'
        ? 'C=C や C≡C の不飽和結合と、カルボン酸・フェノール・スルホン酸のナトリウム塩（弱酸の遊離）と、アミン（塩になって水層へ移ります）です'
        : 'C=C や C≡C の不飽和結合です',
    miss: '左右非対称なアルケンでは「H はすでに H の多い炭素へ」付きます（マルコフニコフ則）。' +
        'ハロゲン化水素はどれも同じ規則に従うので、瓶を変えても付く位置は変わりません。' +
        (h.key === 'hcl'
            ? '塩酸は弱酸の遊離（塩からもとの酸を追い出す）とアミンの塩づくりにも使いますが、' +
              'いまの分子には塩もアミンもありません。'
            : '')
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

/* ===== ルール → 層の対応表（DESIGN_ion_layer.md I-1・§4-5 #3）=====
 *
 * ★★ **表はここ1つ。** 反応の `apply` に層の分岐を1行も入れない
 *   ——「どの層へ移るか」は反応の中身ではなく**分液という見方**の話なので、
 *   `usually`（ふつうはこの試薬）と同じく `apply` の外で足す（§12-1 の約束と同じ流儀）。
 * ⚠ ここに載っていない反応は層を動かさない ＝ **中性の成分は残る**（これが分液の芯）。
 * ★ `note` は見出しに添える一言。⚠ **v1517 まで `amine_hcl` は `salt-not-drawn`**
 *   （「塩の形はまだ描きません」）だったが、I-3 で本物の塩を描くようになったので
 *   **その断りは嘘になった**。いまは「塩になって水層へ」と、起きたことをそのまま言う。 */
const RULE_PHASE = {
    neutralize_naoh: { phase: 'aq', note: '' },
    neutralize_nahco3: { phase: 'aq', note: '' },
    amine_hcl: { phase: 'aq', note: 'salt' },
    liberate_weak_acid: { phase: 'ether', note: '' },
    // ★ I-2: CO₂ で戻せるのはフェノールだけ。行き先は強酸の遊離と同じ有機層
    liberate_co2: { phase: 'ether', note: '' },
    amine_liberate_naoh: { phase: 'ether', note: '' }
};

/* 分液の面で出す試薬 ＝ **上の表に載っている反応が使う試薬だけ**（I-0032・v1604）。
 *
 * ★ ユーザーの指摘（2026-09-21）:「分液モード時、使える試薬がどれかわかりにくい。
 *   通常の実験モードと異なり、使える試薬は限定させた方がよい（総当たりで調べることが
 *   無意味なため）」。分液の漏斗の中で意味があるのは**層を動かす操作**だけで、
 *   27本を総当たりしても「効きません」が26回返るだけ ＝ 何も学べない時間になる。
 * ⚠ **実験モードでは今までどおり27本全部出す。**「効かない瓶も押せて理由が返る」は
 *   実験モードの良さ（ユーザーの言葉）なので、絞るのは分液の面を開いているあいだだけ。
 * ★★ **5本を定数で書き写さない。** どの瓶を出すかは「層を動かす反応があるか」で決まり、
 *   その表は `RULE_PHASE` ここ1つ（§4-5 #3 の約束）。表に1行足したら出る瓶も自然に増える
 *   ——「使える試薬の一覧」を別に持つと、**表を増やしたのに瓶が出ない**形で静かに壊れる。 */
function phaseReagentIds() {
    const ids = new Set();
    Object.keys(RULE_PHASE).forEach(ruleId => {
        const rule = REACTION_RULES.find(r => r.id === ruleId);
        ruleReagentIds(rule).forEach(id => ids.add(id));
    });
    return ids;
}
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
        // ⚠ v1541 でアミド結合（ペプチド結合）の加水分解を足したので、ここにも書き足す（規約1-2）
        acts: 'エステルと酸無水物とアミド結合（ペプチド結合）と二糖のグリコシド結合（加熱すると水が入って切れます）と、カルボン酸・フェノール・スルホン酸のナトリウム塩（弱酸の遊離）です',
        miss: '同じエステルでも、NaOH で切ると出てくるのはカルボン酸ではなく**その塩**です（けん化）。酸で切るこちらは平衡なので、逆のエステル化も同時に起こります。' +
            'また、強い酸は弱い酸をその塩から追い出します（弱酸の遊離）が、遊離させる相手の塩がいまの分子にはありません。' +
            '単糖（グルコースなど）は、これ以上切れる -O- のつながりを持たないので加水分解されません。切れるのは単糖どうしをつないだ二糖・多糖のグリコシド結合です。'
    },
    {
        /* ★★ 二酸化炭素の瓶（DESIGN_ion_layer.md I-2・v1514）。
         *   ⚠⚠ **瓶が1本増える**（24 → 25本）。
         *
         * ★ **希硫酸の隣に置く**（酸化剤2本・NaOH aq と Na を隣に置いたのと同じ理由）。
         *   同じ「弱酸の遊離」でも、**希硫酸・塩酸は全部の塩から酸を追い出すのに、
         *   CO₂ はフェノキシドからしか追い出せない** —— 酸の強さの序列
         *   （カルボン酸 > 炭酸 > フェノール）が**瓶の棚で読める**位置。
         *
         * ⚠ **既存の瓶に相乗りできないか**（`DESIGN_reagent_palette.md` §10.5 規約1）を先に見た:
         *   - `nahco3`（炭酸水素ナトリウム）… ⚠ **名前が嘘になる。** 入試の本文は
         *     「二酸化炭素を吹き込む」で、NaHCO₃ 水溶液を加える操作ではない。
         *     しかも NaHCO₃ は**逆向き**（酸を塩にする側）に既に使われている
         *   - `h2so4_dil`/`hcl` … ⚠ こちらも名前が嘘になるうえ、**効く相手が違う**のが
         *     この瓶の全部（強酸は全部の塩に効く／CO₂ はフェノキシドだけ）
         *   ★ ＝ 規約1の③「既存のどの瓶の名前でも嘘になる」に当たるので1本足す。
         *
         * ⚠ **区分割り（§10.5 規約2）はしない。** `o2_pdcl2` の注記が
         *   「CO₂ の瓶を足すときに区分割りを決めること」と申し送っているが、
         *   ★ **`cl2_light`（v1511）が既に区分を割らずに 24本目を足している**（前例）。
         *   ⚠ そして区分の切り方は「高校化学をどう教えるか」の判断で、
         *   **反応レーンが片手間に決める話ではない**（規約2 自身がそう書いている）。
         *   ★ 判断を統合側へ送る: **25本目でも割っていない。割るなら別レーンで。**
         *
         * ★ 入試64件のうち CO₂ 吹き込みは **7件**（慶大2019・鹿児島大2019・上智大2020・
         *   信州大2020・青山学院大2021・大阪府大2021・福島大2022）＝ **51 → 58件**。 */
        id: 'co2',
        name: '二酸化炭素',
        formula: 'CO₂',
        kind: 'transform',
        acts: 'ナトリウムフェノキシドのような、環に直結した -O⁻ の塩です' +
            '（水に吹き込むとフェノールが遊離し、高温・高圧では環にカルボキシ基が入ります）',
        miss: '二酸化炭素は水に溶けて炭酸になりますが、**炭酸はカルボン酸より弱い酸**なので、' +
            'カルボン酸のナトリウム塩からカルボン酸を追い出すことはできません。' +
            '追い出せるのは炭酸より弱い酸 —— つまり**フェノール**だけです' +
            '（酸の強さは カルボン酸 > 炭酸 > フェノール）。' +
            'カルボン酸の塩から酸に戻したいときは、希硫酸か塩酸を使ってください。'
    },
    {
        /* ★★ 亜硝酸ナトリウム＋塩酸の瓶（DESIGN_ion_layer.md I-4・ジアゾ化）。
         *   ⚠⚠ **瓶が1本増える**（25 → 26本）。
         *
         * ⚠ **既存の瓶に相乗りできないか**（`DESIGN_reagent_palette.md` §10.5 規約1）を先に見た:
         *   - `hcl`（塩化水素・塩酸）… ⚠ **効く相手が正反対になる。** 塩酸だけを
         *     アニリンにかけたらできるのは**アニリン塩酸塩**（`amine_hcl`）で、
         *     ジアゾニウムではない。同じ瓶に両方を載せると、**塩酸を選んだのに
         *     ジアゾ化の選択肢が出る**＝ 画面が「塩酸でジアゾ化できる」と言うことになる
         *   - `nahco3`・`naoh_aq` … 亜硝酸とは別の試薬。名前が嘘になる
         *   ★ ＝ 規約1の③「既存のどの瓶の名前でも嘘になる」に当たるので1本足す。
         *
         * ★ **塩酸（`hcl`）の隣ではなく、CO₂ の隣（＝ 芳香族の窒素まわりの入口）に置く。**
         *   ⚠ ここは「亜硝酸を**その場で作って使う**」試薬で、瓶の名前がそのまま
         *   実験操作（NaNO₂ 水溶液に塩酸を加える）になっている。
         *
         * ⚠⚠ **条件（5℃以下・氷冷）は `condition` の2択にしない。**
         *   ★ `condition` を使うのは「**2つの条件が同時に通る分子がある**」ときだけ
         *     （v1511 の前例。エタノールの分子内脱水／分子間脱水がそれ）。
         *   ジアゾ化は5℃以下でしか意味を持たない（温めると次の
         *   `diazonium_decompose` が起こってしまう）ので、**選ばせる二択がない**。
         *   ★ 代わりに **`label` と caption で「氷冷しながら」と言う**。
         *
         * ⚠ **区分割り（§10.5 規約2）はしない** —— `co2`（25本目）と同じ判断。
         *   26本目でも割っていない。割るなら別レーンで。 */
        id: 'nano2_hcl',
        name: '亜硝酸ナトリウム＋塩酸',
        formula: 'NaNO₂ + HCl',
        kind: 'transform',
        acts: 'アニリンのように、ベンゼン環に直結した -NH₂ です' +
            '（**5℃以下に氷冷しながら**加えると、ジアゾニウム塩ができます）',
        miss: '亜硝酸と塩酸から生じる試薬は、**芳香族の1級アミン**をジアゾニウム塩に変えます。' +
            'いまの分子には、ベンゼン環に直結したアミノ基がありません。' +
            'なお**脂肪族の1級アミン**でも同じ反応自体は起こりますが、' +
            'できたジアゾニウムがその場で分解して窒素を出してしまうため、' +
            '塩として取り出すことはできません（だから教科書は芳香族だけを扱います）。'
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
        // ⚠ v1511 まではここに「このアプリでは鉄触媒による環の置換だけを扱います」と書いてあった。
        //   ★ アルカンの光置換を入れた（隣の瓶）ので、**その文はもう嘘**。行き先を指す文に替える
        miss: 'アルカンの水素とも置換しますが、そちらは鉄触媒ではなく**光**が要ります（ラジカル置換）。隣の「塩素・光」の瓶を使ってください。'
    },
    {
        /* ★ アルカンの光置換の瓶（v1511・ユーザー指摘「アルカン全般に Cl2との置換反応が
         *   リストされていない」）。
         *
         * ⚠⚠ **瓶を1本増やした**（23 → 24本）。★ **`cl2_fe` に相乗りさせなかった**理由:
         *   - この瓶は**条件そのもの**を名乗っている（鉄触媒 ／ 光）。この app は
         *     「水素・Ni」「水・酸触媒」「酸素・PdCl₂/CuCl₂」のように**試薬＋条件**を
         *     瓶の名前に載せる流儀で、そこへ素直に並ぶ
         *   - ★ **隣に並べると画面で比べられる**（酸化剤2本・NaOH aq と Na を隣に置いたのと同じ理由）。
         *     同じ Cl₂ でも行き先が違う、が瓶の棚で読める
         *   - ⚠ `condition`（同じ瓶で2択を訊く仕組み）は**使えない**。実測すると
         *     ベンゼンでは環の置換だけ・アルカンでは光の置換だけが通り、**2つが同時に通る分子が
         *     いまの在庫に1つも無い**（芳香環と鎖の -CH₃ を併せ持つトルエンは、下の
         *     `chlorinate_alkane` の門番①②で落ちる）＝ 2択の画面が出る場面が存在しない。
         *     ★ 条件は `label` と caption で言う。
         *   ⚠ 代償は「在庫の数を固定した検査」5か所（RG1 の3か所・MM9・qa の KNOWN_BOTTLES）。 */
        id: 'cl2_light',
        name: '塩素・光',
        formula: 'Cl₂',
        kind: 'transform',
        /* ⚠ **v1541 で3つに増えた**（もとはアルカンの置換だけ）。規約1-2 のとおり、
         *   ルールを足したら瓶の `acts`・`miss` も書き足す ——
         *   もとの `miss` は「C=C をもつ分子では付加が起こるのでこの瓶では扱いません」と
         *   書いてあり、付加を足したいま**そのままでは嘘になる**。 */
        acts: 'アルカン（鎖状の飽和炭化水素）の水素（光を当てると1つずつ塩素に置き換わります）と、' +
            'C=C・C≡C（付加）と、ベンゼン環（光を当てると 3Cl₂ が付加します）です',
        miss: 'アルカンは反応しにくい炭化水素ですが、光を当てると塩素と**置換**反応を起こします（付加ではありません）。' +
            '同じ塩素でも、C=C や C≡C があるとそちらへの**付加**が先に起こります。' +
            'ベンゼン環は光を当てると 3Cl₂ が付加してヘキサクロロシクロヘキサンになり、' +
            '鉄を触媒にすると付加ではなく**置換**（クロロベンゼン）になります ＝ 「塩素・鉄触媒」の瓶です。'
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
        // ⚠ v1541 でプロペン（→ アセトン）まで広げたので書き直した（規約1-2）
        acts: 'エチレン（→ アセトアルデヒド）とプロペン（→ アセトン）です',
        miss: 'この瓶はエチレンからアセトアルデヒドを、プロペンからアセトンを作る工業的製法のためのものです。' +
            '教科書と参考書が式を書いているのはこの2つだけなので、ほかの分子では何も起こしません。' +
            '同じ反応なのに行き先が変わるのは、**酸素が置換基の多いほうの炭素につく**ためです' +
            '（エチレンはアルデヒド・プロペンはケトン）。'
    },
    {
        /* ★★ 燃焼の瓶（v1541）。⚠ **瓶が1本増える**（25 → 26本）。
         *
         * ⚠ **既存の瓶に相乗りできないか**（`DESIGN_reagent_palette.md` §10.5 規約1）を先に見た:
         *   - `o2_pdcl2`（酸素・PdCl₂/CuCl₂）… ⚠ **名前が嘘になる。** あちらは
         *     ワッカー法の触媒つきの瓶で、「触媒を入れずに火をつける」ことを名乗れない。
         *     しかも**効く相手が正反対**（あちらはエチレンだけ／こちらは炭素を持つもの全部）
         *   - 酸化剤（KMnO₄・K₂Cr₂O₇）… ⚠ 燃焼は酸化剤の水溶液でやる操作ではない
         *   ★ ＝ 規約1の③「既存のどの瓶の名前でも嘘になる」に当たるので1本足す。
         *
         * ⚠ **区分割りはしない**（`cl2_light`（24本目）・`co2`（25本目）と同じ扱い）。
         *   区分の切り方は「高校化学をどう教えるか」の判断で、反応レーンが決める話ではない。
         *
         * ★ **なぜ要るか**: 参考書の式で「燃焼」は3本（メタン・エタノール・ベンゼンの完全燃焼）
         *   あるのに、**アプリには燃焼のルールが1本も無かった**（v1540 の実測）。
         *   元素分析の節が立っているのに、その式を画面で起こせなかった。 */
        id: 'o2_flame',
        name: '酸素（点火）',
        formula: 'O₂',
        kind: 'transform',
        acts: '炭素と水素（と酸素）だけでできた分子です。完全燃焼して二酸化炭素と水になります',
        miss: '燃やせるのは C・H・O だけでできた分子です。' +
            '窒素・硫黄・ハロゲンを含むものは、この画面では扱わない生成物（NO₂・SO₂・HCl など）ができるので断ります。' +
            'また、塩や重合でできた鎖（両端の R）のように「分子1個ぶんの式」が決まらないものも燃やせません。'
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
        acts: '-CHO をもつアルデヒドと還元糖（フルクトースのようなケトースを含む）です'
    },
    {
        id: 'fehling',
        name: 'フェーリング液',
        formula: 'Cu²⁺',
        kind: 'detect',
        acts: '-CHO をもつアルデヒドと還元糖（フルクトースのようなケトースを含む）です'
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
        positive: '銀が析出して、試験管の内側が鏡のようになります（銀鏡反応）。還元性を示すのは -CHO をもつアルデヒドと還元糖で、-CHO 自身は酸化されてカルボン酸（の塩）に変わります。フルクトースのような**ケトース**も、カルボニル基の隣の炭素に -OH があるため、塩基性の条件でアルデヒドに移り変わって還元性を示します。',
        negative: 'この分子に還元性を示す構造はありません。ケトンは同じカルボニル基 C=O を持ちますが、カルボニル炭素に水素が無いので酸化されず、銀鏡反応を示しません。「同じ C=O でも、そのままで還元性を示すのは -CHO」がこの試薬の要点です。ただし**カルボニル基の隣の炭素に -OH をもつケトンは例外**で、フルクトースのようなケトースが還元糖に数えられるのはこのためです（アセトンのようなふつうのケトンは陰性のままです）。'
    },
    {
        id: 'fehling',
        reagentId: 'fehling',
        detect: reducingCarbonylAtoms,
        positive: '赤色の沈殿 Cu₂O（酸化銅(I)）ができます。フェーリング液の青い Cu²⁺ が還元されて Cu⁺ になった色です。銀鏡反応と同じく -CHO（還元糖を含む）の検出に使います。フルクトースのような**ケトース**も、塩基性のフェーリング液の中でアルデヒドに移り変わるため陽性になります。',
        negative: 'この分子に還元性を示す構造はありません。フェーリング液を還元するのは -CHO をもつものと、**カルボニル基の隣の炭素に -OH をもつケトン**（フルクトースのようなケトース）で、アセトンのようなふつうのケトンやカルボン酸は還元しません。'
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
         * 出さない側に、理由だけは返す）。文面は分子をもう一度見て作る。 */
        id: 'oxidation_out_of_scope_info',
        reagentId: OXIDANT_REAGENT_IDS,
        label: '⚠ 酸化（ここでは図を変えない範囲）',
        info: true,
        detect(mol) { return oxidationOutOfScope(mol).sites; },
        /* ⚠ **札に残った箇所だけを語る**（v1589・§13.8）。`sites` は絞ったあとの並びで、
         * ここだけ全体を数え直すと「札は見ている分子で出たのに、文面は隣の分子の話も含む」になる */
        apply(game, sites) {
            const { sites: all, kindOf } = oxidationOutOfScope(game.userMolecule);
            const kinds = new Set(pickShownSites(all, sites, x => x).map(s => kindOf.get(siteKey(s))));
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
            // ★ -OH が C=O になった酸素も「変わった原子」＝ 印に入れる（v1500・CV4）
            let oxidizedO = null;
            if (!wasCarbonyl) {
                const oh = mol.getNeighbors(kId).find(n =>
                    n.type === 1 && n.atom.element === 'O' &&
                    mol.getNeighbors(n.atom.id).filter(x => x.atom.element !== 'H').length === 1);
                if (!oh) throw new Error('酸化する -OH が見つかりません');
                mol.getBond(kId, oh.atom.id).type = 2;
                bendCarbonyl(mol, kId, oh.atom.id); // 鎖と一直線なら折る（C-7）
                oxidizedO = oh.atom.id;
            }
            const oSpot = freeSpotAround(mol, kId);
            if (!oSpot) throw noRoom('-COO⁻ を置く空間がありません');
            const o = mol.addAtom('O', oSpot.x, oSpot.y);
            mol.addBond(kId, o.id, 1);
            const na = ionizeSalt(mol, o.id);
            if (!na) throw noRoom('ナトリウムイオンを置く空間がありません');
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
                changed: [mId, kId, ...added, o.id, na.id, ...(oxidizedO ? [oxidizedO] : [])]
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
            // ⚠ **反応を起こす前に数える**（起こしたあとでは「残り」と区別できない）
            const leftover = leftoverMonomerNote(mol, site);
            // 二重結合を単結合に開く（これが付加重合の本体）
            units.forEach(u => {
                const b = mol.getBond(u.head, u.tail);
                if (!b) throw new Error('二重結合が見つかりません');
                b.type = 1;
            });
            /* 頭（置換基の多い炭素）に次の単量体の尾（少ない炭素）を繋ぐと、
             * 教科書どおりの「頭-尾（head-to-tail）」の並びになる。
             *
             * ★ **置換基の倒し方は「そのまま」→「同じ側（真下）」→「1つおき」の順に試し、
             *   最初に主鎖が一直線になった形を採る**（v1593・§30。ユーザー決定 2026-09-19）。
             *   - 置換基が道を塞いでいない分子（塩化ビニル・アクリロニトリル…）は
             *     **「そのまま」が勝つ** ＝ -Cl は呼び出したときの 120° のまま
             *   - 酢酸ビニル・アクリル酸などは**全部真下**へそろい、アセトキシ基の中も直交のまま
             *     （登録済み `polyvinyl-alcohol` の -OH が全部真下なのと同じ形）
             *   - スチレンのように太い置換基だけが**上下交互**になる（同じ側だと隣の環と 14.8px）
             *   採る基準を「置けた」ではなく「**一直線になった**」にしてあるのは、置けるだけの
             *   倒し方が §14 の目的（鎖をまっすぐ見せる）を満たさないことがあるため。
             *   一直線がどれも作れないときだけ、最初に置けた倒し方へ戻す。
             * ★★ 2026-09-24 **順を「同じ側（真下）」→「1つおき」→「そのまま」に変えた**（I-0128・ユーザー
             *   「付加重合で呼び出す分子の置換基の向きが斜めになったり、垂直になったりする、垂直に揃えたい」）。
             *   前の順では塩化ビニル・アクリロニトリルだけ「そのまま」（120° の斜め）が勝ち、酢酸ビニルなどは
             *   真下になって、同じ付加重合で向きが割れていた。「そのまま」は、垂直のどちらも一直線にできない
             *   ときの最後の手にする
             * ⚠ 以前は全単量体を `uprightChainSubstituent` で上下交互に立てていた（§18-1）。
             *   共重合はまだそちらを使っている。 */
            let built = null, fallback = null;
            for (const fold of ['same', 'alternate', 'none']) {
                const r = linkVinylUnits(mol, units, fold);
                if (!r) continue;
                if (mainChainStraight(mol, units)) { built = r; break; }
                if (!fallback) fallback = fold;
                r.undo();
            }
            if (!built && fallback) built = linkVinylUnits(mol, units, fallback);
            if (!built) throw noRoom('生成物を配置する空間がありません');
            const { changed, linkFrom, linkBack } = built;
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
                    '鎖が画面に収まるよう表示を引きました。ホイールやピンチで拡大すると、繋がり目を1つずつ確かめられます。' +
                    leftover,
                changed: [...new Set([...changed, ...endIds])],
                refit: true // 伸びた鎖の全体が見えるように視野を合わせる
            };
        }
    },
    {
        /* ★★ 脱ハロゲン化水素（v1541・参考書の式1本）。
         * 門番と畳み方は `dehydrohalogenationSites` の注記。
         *
         * ⚠ **瓶は持たせない。** 教科書はここで試薬を名指しせず、工業的には
         *   「加熱して熱分解」、実験室では「水酸化ナトリウムの**アルコール溶液**」と
         *   条件のほうが分かれる。⚠ `naoh_aq`（水溶液）に相乗りさせると
         *   **瓶の名前が嘘になる**（水溶液では置換のほうが起こる）ので、
         *   `amidation`・`dehydration_anhydride` と同じく札だけにする（§4-1）。
         *
         * ★ 抜けたハロゲンは**消さずに脇へ置く**（`parkAsWater` と同じ扱い）——
         *   結合を失った Cl は自動水素で **HCl** として描かれるので、
         *   「ハロゲン化水素がとれる」が画面にそのまま出る。 */
        id: 'dehydrohalogenation',
        label: '脱ハロゲン化水素（−HX）→ アルケン',
        detect: (mol) => dehydrohalogenationSites(mol),
        apply(game, site) {
            const mol = game.userMolecule;
            const [ca, cb, halId] = site;
            const bond = mol.getBond(ca, cb);
            if (!bond) throw new Error('C-C 結合が見つかりません');
            const el = (mol.atoms.find(a => a.id === halId) || {}).element;
            const hx = { Cl: '塩化水素 HCl', Br: '臭化水素 HBr', I: 'ヨウ化水素 HI' }[el] ||
                'ハロゲン化水素';
            mol.removeBond(ca, halId);
            bond.type = 2;
            parkAsWater(mol, halId);   // 結合を失ったハロゲンは自動水素で HX として描かれる
            return {
                caption: `ハロゲンと、隣の炭素についていた水素がいっしょにとれて、` +
                    `**${hx}** が外れました（脱離反応）。残った2つの炭素のあいだに二重結合ができます。` +
                    '1,2-ジクロロエタンからこの反応で塩化ビニルを作り、それを付加重合したものが' +
                    'ポリ塩化ビニル（PVC）です。' +
                    '⚠ **付加の逆向き**にあたる反応で、アルコールの分子内脱水（−H₂O）と' +
                    '「隣り合う2つの炭素から、となりどうしの原子が1組とれて C=C ができる」形は同じです。',
                changed: [ca, cb]
            };
        }
    },
    {
        /* ★★ 小さい環の開裂付加（v1541・参考書の式1本 ＝ シクロプロパン ＋ Br₂）。
         * 門番は `strainedRingSites`（重原子が炭素3個の環だけ）。
         *
         * ★ **瓶は `br2_water`**（付加と同じ瓶）。同じ臭素水が、
         *   ふつうのシクロアルカンには効かず**三員環だけ開く**ところがこの反応の見どころ。 */
        id: 'ring_opening_addition',
        reagentId: 'br2_water',
        label: '開環付加: Br₂（三員環のひずみ）→ 1,3-ジブロモプロパン',
        detect: (mol) => strainedRingSites(mol),
        apply(game, site) {
            const mol = game.userMolecule;
            const [ca, cb] = site;
            // ★ 先に2つとも置けるか試す（途中で場所が尽きて半端な図にしない）
            if (!attachGroup(mol, ca, 'Br', true) || !attachGroup(mol, cb, 'Br', true)) {
                throw noRoom('臭素を置く空間がありません');
            }
            mol.removeBond(ca, cb);
            const added = [...attachGroup(mol, ca, 'Br'), ...attachGroup(mol, cb, 'Br')];
            // 登録の図（1,3-ジブロモプロパン）へ写して鎖をまっすぐにする
            game.redrawProductsAsStandalone({ only: [...componentOf(mol, ca)] });
            return {
                caption: 'シクロプロパンの環が開いて、両端に臭素が付きました（開環付加）。' +
                    '⚠ ふつうのシクロアルカン（シクロヘキサンなど）は**置換**しか起こさないのに、' +
                    '**三員環は付加で開きます** —— 炭素の結合角が 60° まで押し曲げられていて' +
                    '（本来は 109.5°）、環に**ひずみ**があるためです。' +
                    'だからシクロプロパンは臭素水を脱色し、' +
                    '「臭素水の脱色 ＝ 不飽和結合」という覚え方の例外になります。',
                changed: [ca, cb, ...added],
                refit: true
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
        /* ★★ アセチレンの三量化（v1541・参考書の式1本 ＝ 3C₂H₂ → C₆H₆）。
         *
         * ⚠⚠ `alkyne_polymerization`（鎖のポリアセチレン）は前からあったが、
         *   **環になる道**が無かった（v1540 の実測）。★ 同じ材料が条件で
         *   「鎖」と「環（ベンゼン）」に分かれるのが、この一組の見どころ。
         *
         * ★ **ちょうど3分子のときだけ出す。** 4分子以上並んでいるときに
         *   「3つだけ選んで環にする」と、残りをどうするかが画面から読めない
         *   （鎖のほうは何個でも繋がるので、そちらへ譲る）。
         * ⚠ **瓶は持たせない** —— 教科書は「赤熱した鉄に触れさせる」と
         *   **装置と温度**を書き、試薬を名指ししない（§4-1）。
         * ⚠ **キャンバス全体が対象**（重合3本と同じ理由）。 */
        id: 'alkyne_trimerization',
        wholeCanvas: true,
        label: '三量化（アセチレンを3分子並べて）→ ベンゼン',
        detect(mol) {
            const units = acetyleneUnits(mol);
            if (units.length !== 3) return [];
            units.sort((p, q) => p.x - q.x);
            return [units.flatMap(u => [u.left, u.right])];
        },
        apply(game, site) {
            const mol = game.userMolecule;
            if (site.length !== 6) throw new Error('アセチレンが3分子必要です');
            const atoms = site.map(id => mol.atoms.find(a => a.id === id));
            if (atoms.some(a => !a)) throw new Error('原子が見つかりません');
            const own = new Set(site);
            /* ★ 環の座標は**登録のベンゼンと同じ形**（半径 40・60°刻み）。
             *   ⚠ 手で作図するときの直交の規約は変えていない ——
             *   ここは「反応で置く生成物」なので、登録の図に合わせるのが筋（§14 と同じ考え方）。 */
            const R = 40, S = 34.64;
            const off = [[R, 0], [R / 2, S], [-R / 2, S], [-R, 0], [-R / 2, -S], [R / 2, -S]];
            const cx = atoms.reduce((s, a) => s + a.x, 0) / 6;
            const cy = atoms.reduce((s, a) => s + a.y, 0) / 6;
            const others = mol.atoms.filter(a => !own.has(a.id) && a.element !== 'H');
            const G = bondStep(mol, site[0]);
            const fits = (dx, dy) => off.every(([ox, oy]) =>
                others.every(o => Math.hypot(o.x - (cx + dx + ox), o.y - (cy + dy + oy)) >= G * 1.2));
            let put = null;
            const cands = [{ x: 0, y: 0, d: 0 }];
            for (let i = -5; i <= 5; i++) {
                for (let j = -5; j <= 5; j++) {
                    const d = Math.hypot(i, j);
                    if (d >= 1 && d <= 5) cands.push({ x: i * 2 * R, y: j * 2 * R, d });
                }
            }
            cands.sort((p, q) => p.d - q.d);
            for (const cand of cands) { if (fits(cand.x, cand.y)) { put = cand; break; } }
            if (!put) throw noRoom('ベンゼン環を置く空間がありません');
            atoms.forEach((a, i) => { a.x = cx + put.x + off[i][0]; a.y = cy + put.y + off[i][1]; });
            // 三重結合が二重結合になり、空いた手で隣の分子とつながる ＝ 原子は1つも出入りしない
            for (let i = 0; i < 6; i += 2) {
                const b = mol.getBond(site[i], site[i + 1]);
                if (!b || b.type !== 3) throw new Error('三重結合が見つかりません');
                b.type = 2;
            }
            mol.addBond(site[1], site[2], 1);
            mol.addBond(site[3], site[4], 1);
            mol.addBond(site[5], site[0], 1);
            return {
                caption: 'アセチレン3分子が環になって、ベンゼンができました（3C₂H₂ → C₆H₆）。' +
                    '**赤熱した鉄**に触れさせると起こります。' +
                    '⚠ 原子は1つも出入りしません —— 三重結合が二重結合になり、' +
                    '空いた手で隣の分子とつながって6員環が閉じるだけです。' +
                    '★ 同じアセチレンでも、条件が違えば**鎖**のポリアセチレンになります' +
                    '（並べて「付加重合」を選ぶとそちらが見られます）。' +
                    '環が閉じると6個の電子が環全体に広がり、二重結合が3本あるのに' +
                    '付加しにくい（＝ 芳香族の）性質が現れます。',
                changed: [...site],
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
            // ⚠ **反応を起こす前に数える**（v1541。理由は `leftoverMonomerNote` の注記）
            const leftover = leftoverMonomerNote(mol, site);
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
            /* ★★ **中央へ移った二重結合の両端（C2・C3）にも印を付ける**（v1500・CV4）。
             * ⚠ caption 自身が「二重結合は両端から中央へ移っています。ここが付加重合との違い」と
             *   言っている**当の原子**に印が無かった ＝ 教材の要点が画面で光っていなかった。 */
            const changed = units.flatMap(u => [u.c2, u.c3]);
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
            /* ★★ できた鎖を**シス形**に引き直す（v1587・発注書 L）。
             * ⚠ v1586 まではここで何もせず、できる鎖は必ずトランス形（＝ グタペルカ）だった。
             * ⚠ 置けなければ1原子も動かない ＝ 今までどおりの図になるだけ。 */
            const path = polymerBackbonePath(mol, units[0].c2);
            const laidOut = path ? layoutDieneChain(mol, path, true) : false;
            const n = units.length;
            return {
                caption: `共役ジエン ${n} 個が 1,4-付加重合しました。両端（1位と4位）の炭素で繋がり、` +
                    `二重結合は両端から中央へ移っています。ここが付加重合との違いで、` +
                    `できた鎖に二重結合が残るため、硫黄で架橋できます（加硫）。` +
                    (laidOut
                        ? `図は**シス形**で描いてあります。天然ゴムはイソプレンがシス形に繋がったもので、` +
                          `二重結合のところで鎖が折れ曲がるので、鎖が丸まって、引くと伸び、離すと戻ります。` +
                          `同じつなぎ方でもトランス形になるとグタペルカという硬い樹脂で、鎖がまっすぐ並んで弾みません。` +
                          `見くらべたいときは「シス形 ⇄ トランス形を入れ替える」を押してください。`
                        : `天然ゴムはイソプレンがシス形に繋がったもので、同じ形でトランスに繋がるとグタペルカという硬い樹脂になります。` +
                          `いまの図は場所が足りずシス形に引き直せませんでした。左の「⇄ シス/トランス整形」で` +
                          `中央の二重結合をタップすると、シス（天然ゴム）とトランス（グタペルカ）を描き分けられます。`) +
                    `両端の R は「この先も続く」印です。ホイールやピンチで拡大すると、中央に移った二重結合を1つずつ確かめられます。` +
                    leftover,
                changed: [...new Set([...changed, ...endIds])],
                refit: true
            };
        }
    },
    {
        /* ★★ シス形 ⇄ トランス形の入れ替え（v1587・発注書 L）。
         * ユーザー判断（2026-09-17）「イソプレンであれば、**②を基本、ただし比較のために③**」の③。
         *
         * ★ **なぜ反応の一覧に置くのか**: シスとトランスは別の物質（天然ゴムとグタペルカ）で、
         *   「同じ分子式・同じつなぎ方なのに、幾何がちがうだけで別の材料になる」ことを
         *   見くらべるのがこの回（V130）の芯。**押すと図が変わる**ものは一覧に並べる約束にそろえる。
         * ⚠ **座標しか変えない**ので、正準コード・分子式・↩ は素通りする。
         * ⚠ 硫黄の橋が架かったあとは出さない（架橋した網目を引き直すと、橋が伸びて別の絵になる）。 */
        id: 'diene_cis_trans',
        /* ⚠ **`wholeCanvas` は付けない。** 付けてよいのは「並べた単量体を横につないでいく」
         *   重合だけ（PM10 がそこを見張っている）。こちらは**いま見ている1本の鎖**を
         *   引き直すだけなので、絞り込みは今までどおり `focus` に任せる。 */
        label: 'シス形 ⇄ トランス形を入れ替える（天然ゴム ⇄ グタペルカ）',
        detect(mol) {
            const seen = new Set();
            const out = [];
            mol.atoms.forEach(a => {
                if (a.element !== 'R' || seen.has(a.id)) return;
                const comp = componentOf(mol, a.id);
                comp.forEach(id => seen.add(id));
                if ([...comp].some(id => (mol.atoms.find(x => x.id === id) || {}).element === 'S')) return;
                const path = polymerBackbonePath(mol, a.id);
                if (!path) return;
                // 主鎖に C=C が1本でもあること（＝ 1,4-付加重合でできた鎖）
                const has = path.some((id, i) => i + 1 < path.length &&
                    (mol.getBond(id, path[i + 1]) || {}).type === 2);
                if (has && dieneChainIsCis(mol, path) !== null) out.push(path.slice());
            });
            return out;
        },
        apply(game, site) {
            const mol = game.userMolecule;
            // site は主鎖の原子列そのもの。座標が動いていても id で引き直せる
            const path = site.filter(id => mol.atoms.some(a => a.id === id));
            if (path.length !== site.length) throw new Error('鎖の形が変わっています');
            const wasCis = dieneChainIsCis(mol, path);
            if (!layoutDieneChain(mol, path, !wasCis)) {
                throw noRoom('鎖を引き直す空間がありません');
            }
            const nowCis = !wasCis;
            return {
                caption: nowCis
                    ? 'シス形（天然ゴム）にしました。二重結合のところで鎖が折れ曲がるので、' +
                      '鎖は丸まります。引くと伸び、離すと戻る —— これがゴムの弾性です。' +
                      'つなぎ方も分子式も、トランス形とまったく同じです。'
                    : 'トランス形（グタペルカ）にしました。鎖がまっすぐ並ぶので、' +
                      '結晶のように固まって硬くなり、弾みません。' +
                      'つなぎ方も分子式もシス形と同じで、違うのは二重結合のまわりの向きだけです。',
                /* ⚠ **印（オレンジの破線）は付けない。** 印は「結合が変わった原子」の合図で、
                 *   ここは結合を1本も変えていない（動かしたのは座標だけ）。CV4 の物差しとも合う。 */
                changed: [],
                refit: true
            };
        }
    },
    {
        /* ★★ 共重合（v1541）。設計の判断と理由は `copolymerUnits` の上の注記にまとめてある。
         * ⚠ **2種類以上あるときだけ出る**（単一種は既存の3本に譲る ＝ 札が二重にならない）。 */
        id: 'copolymerization',
        wholeCanvas: true,
        label: '共重合（並べた単量体をすべてつなぐ）→ 2種類以上が1本の鎖に',
        detect(mol) {
            const units = copolymerUnits(mol);
            if (units.length < 2) return [];
            if (new Set(units.map(u => u.code)).size < 2) return [];
            return [sortCopolymerUnits(units).map(u => u.key)];
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const all = copolymerUnits(mol);
            const units = site.map(key => all.find(u => u.key === key));
            if (units.some(u => !u)) throw new Error('単量体が見つかりません');
            if (units.length < 2) throw new Error('単量体が2つ以上必要です');
            const changed = [];
            /* ---- ① それぞれの単量体を「鎖の1単位」に開く。
             *   ⚠ **開き方は種類ごとに違う**（ここが共重合の要点）:
             *     ビニル系 … C=C が単結合になる（原子は出入りしない）
             *     共役ジエン … 両端が単結合になり、**中央に二重結合が移る**（1,4-付加）
             *   ★ ジエンの側に C=C が残るので、できた鎖はそのまま加硫できる。 */
            units.forEach(u => {
                if (u.kind === 'vinyl') {
                    const b = mol.getBond(u.head, u.tail);
                    if (!b) throw new Error('二重結合が見つかりません');
                    b.type = 1;
                } else {
                    const b12 = mol.getBond(u.d.c1, u.d.c2);
                    const b23 = mol.getBond(u.d.c2, u.d.c3);
                    const b34 = mol.getBond(u.d.c3, u.d.c4);
                    if (!b12 || !b23 || !b34) throw new Error('共役ジエンの結合が見つかりません');
                    b12.type = 1; b34.type = 1; b23.type = 2;
                    changed.push(u.d.c2, u.d.c3);   // 中央へ移った二重結合（CV4）
                }
            });
            /* 頭の置換基を主鎖と直交する向きへ立て直す（ビニル系だけ）。
             * ★ **全部を同じ側（真下）へ出す**（ユーザー決定 2026-09-22・I-0053「他と揃えて↓でよいです」）。
             *   ⚠ **`side=-1` が下**（実測。`a1 = atan2(ux*side, -uy*side)` を読んで +1 が下だと
             *     思ったが、RXF25 で測ったら +1 はフェニル基が主鎖の **51.7〜88.1px 上**に出た。
             *     座標の向きはコードを読んで決めず、必ず測る）。
             *   ⚠ v1605 までは `i % 2 ? -1 : 1` で単量体ごとに上下交互だった。
             *   付加重合は v1593 で「そのまま → 同じ側（真下） → 1つおき」の順に試す形へ移り、
             *   登録済みの `polyvinyl-alcohol`（主鎖 y=300 に -OH が y=342 ＝真下）に揃えている。
             *   共重合だけが交互のまま取り残されていた。 */
            units.forEach(u => {
                if (u.kind === 'vinyl') uprightChainSubstituent(mol, u.head, u.tail, -1);
            });
            // ---- ② 並べた順につなぐ（まだ繋いでいない単量体は鎖の続き扱い＝§14）
            const pending = new Set();
            units.slice(1).forEach(u => u.comp.forEach(id => pending.add(id)));
            let linkFrom = units[0].out;
            let linkBack = units[0].back;
            for (let i = 1; i < units.length; i++) {
                const u = units[i];
                const movingIds = [...componentOf(mol, u.in)];
                movingIds.forEach(id => pending.delete(id));
                const plan = planAttachment(mol, linkFrom, u.in, movingIds, [...pending],
                    chainDirection(mol, linkBack, linkFrom));
                if (!plan) throw noRoom('生成物を配置する空間がありません');
                applyAttachment(mol, movingIds, plan);
                mol.addBond(linkFrom, u.in, 1);
                changed.push(linkFrom, u.in);
                linkBack = u.back;
                linkFrom = u.out;
            }
            const endIds = attachREnds(mol, [
                [units[0].in, chainDirection(mol, units[0].inBack, units[0].in)],
                [linkFrom, chainDirection(mol, linkBack, linkFrom)]
            ]);
            // ---- ③ 何が何個つながったかを数える（比を作らず、並べた個数をそのまま言う）
            const kinds = new Map();
            units.forEach(u => kinds.set(u.code, (kinds.get(u.code) || 0) + 1));
            const n = units.length;
            return {
                /* ⚠⚠ **「交互共重合体ができます」と断定しない**（ユーザー指示 2026-09-12）。
                 *   どの並びを選んでも本当にそうとは限らないので、画面が言えるのは
                 *   **「いま並べた順につないだ」**ことだけ。 */
                caption: `${kinds.size} 種類の単量体 ${n} 個が**共重合**しました。` +
                    '2種類以上の単量体をいっしょに重合させることを共重合といい、' +
                    'できた高分子（共重合体）は、どちらか一方だけの高分子とは違う性質になります。' +
                    'スチレンと 1,3-ブタジエンの共重合体が SBR（スチレン-ブタジエンゴム）で、' +
                    'ゴムの中で最も多く作られている合成ゴムです。' +
                    '\n⚠ **つないだ順は、いま画面に並べた順そのものです。** ' +
                    '実際の共重合では単量体がどの順に並ぶかは条件で決まり、' +
                    '交互・ランダム・ブロックとさまざまで**一通りには決まりません**。' +
                    '並べ替えてからもう一度実行すれば、別の並びの鎖ができます。' +
                    '単量体の数の比も、いま並べた個数がそのまま出ているだけです' +
                    '（実際の比は用途によって変えます）。' +
                    (units.some(u => u.kind === 'diene')
                        ? '\n★ 共役ジエンの単位では二重結合が中央へ移って鎖に残るので、' +
                          'この鎖はそのまま硫黄で架橋できます（加硫）。'
                        : '') +
                    '両端の R は「この先も続く」印です。',
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
            // ★ 1本目は相手の鎖の C=C を「鎖がそろって重なる」ものに選び直す（I-0077・`inRegisterPartner` の注記）
            //   `reactor._inRegister = false` で今までどおり（否定対照）
            const R0 = (typeof window !== 'undefined') ? window.reactor : null;
            const reg = (R0 && R0._inRegister === false) ? null : inRegisterPartner(mol, ca, ca2, cb, cb2);
            const [pb, pb2] = reg ? [reg.cb, reg.cb2] : [cb, cb2];
            let [useB, useB2] = [pb, pb2];
            // 選び直した相手で寄せられなければ、選んだ組のまま今までどおり寄せる
            if (!stackChainsForBridge(mol, ca, pb) && reg) { useB = cb; useB2 = cb2; stackChainsForBridge(mol, ca, cb); }
            // detect が返した組をそのまま使う（置ける位置は detect 側で確かめてある）
            // ⚠ 選び直した組は、`vulcanizablePairs` が逆の向き（相手の鎖の側を ca）で返すことがあるので、4原子の集合で引き当てる
            const sameSet = (p, ids) => { const k = new Set([p.ca, p.ca2, p.cb, p.cb2]); return ids.every(id => k.has(id)); };
            const findBest = () => vulcanizablePairs(mol).find(p => sameSet(p, [ca, ca2, useB, useB2])) ||
                vulcanizablePairs(mol).find(p => p.ca === ca && p.ca2 === ca2 && p.cb === cb && p.cb2 === cb2);
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
                /* ★ 印は**二重結合が単結合になった両端**（`ca`／`ca2`・`cb`／`cb2`）と硫黄2個。
                 * ⚠ v1500 まで相方（`ca2`・`cb2`）が落ちていた —— 同じ「多重結合を1本減らす」
                 *   `addAcrossMultipleBond` は両端を入れているのに、加硫だけ流儀が違った（CV4）。 */
                changed: [a1, best.ca2, b1, best.cb2, s1.id, s2.id],
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
                /* ⚠ 印は**結合が変わった原子だけ**（v1500・CV4）。`cA`・`cB` は -OH を
                 * ぶら下げていた主鎖の炭素で、結合は1本も変わっていないので入れない
                 * （同じ六員環の `cMid` に印が無いのと揃う。v1480 で外した `anchor` と同じ形）。 */
                changed.push(g.oA, g.oB, g.hc);
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
        label: '縮合重合（単量体を並べて）→ ポリエステル／ポリアミド',
        detect(mol) {
            const u = condensationPolymerUnits(mol);
            if (!u) {
                /* ★ **AB型（ヒドロキシ酸）**（v1541）。1分子が -COOH と -OH を1つずつ持つので、
                 *   鎖は A-A-A-A と同じ単位が続く。⓵ 参考書の「n 乳酸 → ポリ乳酸」がこれ。
                 *   ⚠ 結合の作り方は対の場合と1つも違わない（`apply` は 3つ組しか見ない）。 */
                const ab = hydroxyAcidUnits(mol);
                if (!ab) return [];
                const site = [];
                for (let i = 0; i + 1 < ab.length; i++) {
                    site.push(ab[i].acid.c, ab[i].acid.oh, ab[i + 1].other.x);
                }
                return [site];
            }
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
            /* ★ **AB型（ヒドロキシ酸）かどうかを先に見る**（v1541）。
             *   AB型では「i 番目の相手（-OH）」と「i+1 番目の酸（-COOH）」が**同じ分子**にある。
             *   ⚠ 対（2価の酸 ＋ 2価のアルコール）では必ず別の分子なので、これで見分けられる。 */
            const ab = hydroxyAcidUnits(mol);
            const isAB = !!ab && ab.some(u => u.acid.c === links[0].c);
            if (!isAB && links.length < 3) throw new Error('単量体が2組（4分子）以上必要です');
            if (links.length < 1) throw new Error('単量体が2個以上必要です');
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
            const n = isAB ? links.length + 1 : (links.length + 1) / 2;
            return {
                caption: (isAB
                    ? `1分子の中に -COOH と -OH を1つずつ持つ単量体（ヒドロキシ酸）${n} 個が縮合重合して、`
                    : `2価カルボン酸 ${n} 個と2価${amide ? 'アミン' : 'アルコール'} ${n} 個が縮合重合して、`) +
                    `${amide ? 'アミド' : 'エステル'}結合が ${links.length} か所できました。` +
                    `つなぐたびに水が1分子とれるのが「縮合」で、原子が1つも出入りしない付加重合との違いです` +
                    `（画面に出ている水 ${links.length + 1} 分子がその証拠です）。` +
                    (isAB
                        ? '⚠ **単量体が1種類でも縮合重合はできます** —— 1分子の中に -COOH と -OH の'
                          + '両方があるので、隣の分子の -OH と自分の -COOH でつながっていけるためです。'
                          + '乳酸からできるのがポリ乳酸で、土の中の微生物に分解される'
                          + '生分解性のポリエステルとして使われます。'
                        : amide
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
        /* ★★ 塩素の付加（v1541）。
         * ⚠⚠ **参考書は「アルケンは臭素 Br₂ や塩素 Cl₂ とすみやかに反応します」と
         *   書いているのに、アプリは塩素の付加を持っていなかった**（v1540 の実測）。
         *   塩素の瓶は2本とも**置換**（`cl2_light` がアルカン・`cl2_fe` が芳香環）で、
         *   `cl2_light` の `miss` は「C=C をもつ分子では付加が起こるのでこの瓶では扱いません」と
         *   **自分で断っていた** ＝ 教科書が並べて書いている2つのうち片方だけが無かった。
         *
         * ⚠ **瓶は増やさない**（`DESIGN_reagent_palette.md` §10.5 規約1）。
         *   ★ `cl2_light`（塩素・光）に**付ける**: 中身は Cl₂ そのもので、
         *     光があっても C=C への付加は起こる（むしろ置換より速い）。
         *   ⚠ 規約1-2 のとおり、瓶の `acts` と `miss` を書き換えてある
         *     （「この瓶では扱いません」が嘘になるため）。
         *
         * ★ ここが `add_br2` と対になることで、同じ瓶の中で
         *   **アルカン＝置換／アルケン＝付加**が並んで見える。 */
        id: 'add_cl2',
        label: '付加: Cl₂（塩素の付加）',
        reagentId: 'cl2_light',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, 'Cl', 'Cl',
                '塩素 Cl₂ が付加しました。C=C や C≡C は臭素とも塩素ともすみやかに反応します。' +
                'アルカンでは置換（水素が1つずつ置き換わる）しか起こらないのに、' +
                '不飽和結合があると**付加のほうが先に起こる**のがこの2つの違いです。' +
                'エチレンから 1,2-ジクロロエタンを作り、そこから塩化水素をとると塩化ビニルになります' +
                '（ポリ塩化ビニルの原料）。');
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
        /* ★ アセチレン ＋ 酢酸 → 酢酸ビニル
         * （`DESIGN_organic_tree.md` §2-3 (b) の**新規の穴**・v1501）。
         * ⚠ **§10.11 の全数突き合わせに入っていなかった辺**。数え直すと
         *   `酢酸ビニル` が 43/563 大問（うち `アセチレン` と同じ大問に出るのが 19 件）。
         *
         * ★ **教科書 本文 p.31**（数研 R5化学Vol.2-5編）の1文がこれを含む3つを並べて書いている:
         *   「アセチレンに触媒を用いて塩化水素 HCl，シアン化水素 HCN，酢酸 CH₃COOH を
         *    付加すると，それぞれ塩化ビニル，アクリロニトリル，酢酸ビニルを生じる。
         *    また，これらの化合物はいずれもビニル基をもち，付加重合して高分子化合物を生じる」
         *   ★ **3つのうち塩化ビニルは既に通る**（`add_hcl` がアセチレンに効く・実測）。
         *   ⚠ **アクリロニトリルは HCN の瓶が要る**ので、この版では足していない（報告に回す）。
         *
         * ⚠ **触媒の名前は書かれていない**（「触媒を用いて」だけ）ので瓶は足さない。
         *   ★ 相手の酢酸は `PARTNER_CANDIDATES` に**もう入っている**ので、
         *   アセチレンの分子モーダルに「＋ 酢酸 を呼び出す」の札が自動で出る。
         *
         * ★ **図の意味**: 三重結合が二重結合になり、酢酸の -OH の酸素がそのまま橋になる。
         *   **水は1分子も出ない**（縮合ではなく付加）—— ここがエステル化との違いで、
         *   だから「ビニルアルコールのエステル」に見えるのに、
         *   ビニルアルコールからは作れない（不安定ですぐアセトアルデヒドになる）。 */
        /* ★★ v1541: **エテンにも効くようにした**（参考書 `alkene.md` の
         *   `CH₂=CH₂ ＋ CH₃COOH → CH₃COOC₂H₅`。実測でエチレンに0件だった）。
         * ⚠ **行き先が三重と二重で違う**のが、この1本を2本に分けなかった理由:
         *     C≡C → C=C … 酢酸**ビニル**（ビニル基が残る ＝ 付加重合の単量体になる）
         *     C=C  → C-C … 酢酸**エチル**（ふつうのエステル。もう重合しない）
         *   ★ **同じ「酢酸の付加」なのに、開く前の結合が1本違うだけで行き先が変わる** ——
         *     ここを1つの札で並べて見せられるのが、分けないことの取り柄。
         * ⚠ id は変えていない（`audit.js` とテスト4本が文字で引いている）。 */
        id: 'add_carboxylic_acid_alkyne',
        label: '付加: 酢酸（アセチレン → 酢酸ビニル／エテン → 酢酸エチル）',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②多重結合が開いてつながる
        detect(mol) {
            /* ★ **アセチレン1分子の集め方は `acetyleneUnits` を借りる**（付加重合と同じもの）。
             * ⚠ **同じ名前の関数を自分で書きかけて実際に踏んだ** —— 後ろの宣言が勝つので
             *   静かに上書きされ、`detect` が `{left, right}` を配列として分解しようとして落ちた。
             *   ★ 数え方が2つになる事故でもあるので、借りるのが正しい。
             * ★ あちらの門番（分子全体が C≡C の2原子 ＝ アセチレンだけ）がそのまま要る ——
             *   教科書がこの付加を書いているのはアセチレンについてだけ（5編 p.31）。 */
            const units = [...acetyleneUnits(mol), ...etheneUnits(mol)];
            if (!units.length) return [];
            /* ⚠⚠ **酸の側にも門番が要る**（v1508 の定期レビュー。もとは -COOH さえあれば
             *   何でも通っていた）。★ **実測で決めた** —— 酸を16種そろえて走らせると、
             *   **名前が付く生成物は酢酸の1つだけ**で、残り15種は全部「（ライブラリに該当なし）」
             *   （ギ酸・プロピオン酸・安息香酸・乳酸・サリチル酸・グリシン・アジピン酸・
             *    シュウ酸・マレイン酸・フタル酸・酪酸・アクリル酸・クロロ酢酸・
             *    ステアリン酸・テレフタル酸。二酸は2箇所も出る）。
             *   ⚠ グリシン（-NH₂）・乳酸／サリチル酸（-OH）はそもそも**そちらが先に反応する**。
             *   ★ **教科書（5編 p.31）は酢酸を名指し**しており、広げる根拠が入試にも無い。
             *   → **酢酸1つに絞る**。門番は名前ではなく構造で立てる:
             *      「-COOH を持つ分子の重原子がちょうど4個」＝ CH₃COOH ただ1つ
             *      （HCOOCH₃ のような形はエステルなので carboxyl が立たない）。 */
            const carboxyls = findFunctionalGroups(mol).filter(g => g.type === 'carboxyl')
                .filter(cx => {
                    const comp = componentOf(mol, cx.atomIds[0]);
                    const heavy = mol.atoms.filter(a => comp.has(a.id) && a.element !== 'H');
                    if (heavy.length !== 4) return false;               // 酢酸の重原子は C,C,O,O
                    // 残る1個が -COOH の炭素についた炭素（＝メチル基）であること
                    return mol.getNeighbors(cx.atomIds[0]).some(n => n.atom.element === 'C');
                });
            const sites = [];
            units.forEach(u => {
                const comp = componentOf(mol, u.left);
                carboxyls.forEach(cx => {
                    if (comp.has(cx.atomIds[0])) return;   // 別分子どうしのみ
                    // [アセチレンの C（酸素がつく側）, もう一方の C, 酸の -OH の O, 酸の C]
                    sites.push([u.left, u.right, cx.atomIds[2], cx.atomIds[0]]);
                });
            });
            return sites;
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const [c1, c2, oId] = site;
            const bond = mol.getBond(c1, c2);
            if (!bond || (bond.type !== 3 && bond.type !== 2)) {
                throw new Error('アセチレンの C≡C・エテンの C=C が見つかりません');
            }
            const wasTriple = bond.type === 3;
            const acidIds = [...componentOf(mol, oId)];
            // ⚠ **置き場を先に確かめる**（途中で失敗して多重結合だけ開いた形を残さない）
            const plan = planAttachment(mol, c1, oId, acidIds);
            if (!plan) throw noRoom('生成物を配置する空間がありません');
            bond.type = wasTriple ? 2 : 1;       // 1本ほどけるだけ（付加。水は出ない）
            applyAttachment(mol, acidIds, plan);
            mol.addBond(c1, oId, 1);
            return {
                caption: (wasTriple
                    ? 'アセチレンに酢酸が付加して、酢酸ビニル CH₂=CH-O-CO-CH₃ ができました（触媒を用いる）。' +
                      '三重結合が二重結合になり、酢酸の -OH の**酸素がそのまま橋**になります。'
                    : 'エテンに酢酸が付加して、酢酸エチル CH₃COOC₂H₅ ができました。' +
                      '二重結合が単結合になり、酢酸の -OH の**酸素がそのまま橋**になります。' +
                      '酢酸は「電離する H」と「残りの原子団 -OCOCH₃」に分かれて、' +
                      '**二重結合の両側の炭素に1つずつ**入りました。') +
                    '⚠ **水は1分子も出ません** —— これは縮合（エステル化）ではなく**付加**です。' +
                    (wasTriple
                        ? '\n同じようにアセチレンに塩化水素を付加すると塩化ビニル、' +
                          'シアン化水素を付加するとアクリロニトリルができます。' +
                          'どれもビニル基 CH₂=CH- をもち、付加重合して高分子になります' +
                          '（酢酸ビニル → ポリ酢酸ビニル → けん化してポリビニルアルコール → ビニロン）。' +
                          '\n★ できた分子は「ビニルアルコールのエステル」の形をしていますが、' +
                          'ビニルアルコールからは作れません（不安定で、すぐアセトアルデヒドに変わるためです）。' +
                          '\n⚠ **同じ酢酸でも、相手がエテンだと行き先が変わります** —— ' +
                          'エテンに付加させると二重結合が単結合になりきってしまうので、' +
                          '酢酸ビニルではなく**酢酸エチル**ができ、もう付加重合はできません。'
                        : '\n⚠ **同じ酢酸でも、相手がアセチレンだと行き先が変わります** —— ' +
                          '三重結合は1本ほどけても二重結合が残るので、' +
                          '酢酸エチルではなく**酢酸ビニル**ができ、そのまま付加重合の単量体になります。' +
                          '\n★ 酢酸エチルはエステルなので、ここから加水分解すれば酢酸とエタノールに戻せます。'),
                changed: [c1, c2, oId]
            };
        }
    },
    {
        /* ★ ベンゼン ＋ プロペン → クメン（クメン法の1段目）
         * （§10.11-D #4・入試49件／`DESIGN_organic_tree.md` §2-3 (b)・v1501）。
         * ★ **12本のうち入試件数がいちばん大きい辺**（`クメン` で 49/563 大問）。
         *
         * ★ **教科書 本文 p.181**（数研 R5化学Vol.2-5編）:
         *   「クメン法では，まず，触媒を用いてベンゼンとプロペン（プロピレン）から
         *    クメンをつくる。これを酸素で酸化したのち，硫酸で分解すると，
         *    フェノールとアセトンが得られる」
         *   ⚠ **触媒の名前は書かれていない**（「触媒を用いて」だけ）ので、
         *   **瓶は足さず・caption でも試薬を名乗らない**（§4-1 の線）。
         *   相手のプロペンは**キャンバスに呼び出す**（アセタール化と同じ形）。
         *
         * ⚠⚠ **足すのは3段のうち1段目だけ。** 2段目の中間体（クメンヒドロペルオキシド）は
         *   **-O-O-（過酸化物）**で、いまのモデルは価標として持てない（§10.11-D #4）。
         *   ★ **caption が残り2段を言葉で書く**（黙って半分だけ実装しない）。
         *
         * 門番:
         *   ① 相手は**プロペン1分子**に絞る（重原子3個・全部C・C=C がその分子に1つだけ）。
         *      ⚠ アレン CH₂=C=CH₂ も重原子3個の炭化水素なので、**C=C の本数**で落とす。
         *   ② 環の側は**炭化水素の芳香環**だけ。フリーデル・クラフツのアルキル化は
         *      ニトロベンゼンのような強い電子求引基のついた環では進まないし、
         *      フェノール・アニリンでも教科書は扱わない。
         *   ③ 環につくのは**置換基の多い側の炭素**（`vinylBonds` の head）＝ マルコフニコフ則。
         *      だから CH₃-CH₂-CH₂- ではなく **(CH₃)₂CH-** が生えて、イソプロピルベンゼンになる。 */
        id: 'alkylate_arene_propene',
        label: 'アルキル化: ベンゼン＋プロペン → クメン（クメン法の1段目）',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②環と炭素がつながる
        detect(mol) {
            // ① プロペン1分子ぶんの C=C を集める
            const vinyls = vinylBonds(mol);
            const units = [];
            vinyls.forEach(({ head, tail }) => {
                const comp = componentOf(mol, head);
                const heavy = [...comp].map(id => mol.atoms.find(a => a.id === id))
                    .filter(a => a && a.element !== 'H');
                if (heavy.length !== 3 || heavy.some(a => a.element !== 'C')) return;
                // ⚠ アレン（C=C が2本）を落とす。プロペンは1本
                if (vinyls.filter(v => comp.has(v.head)).length !== 1) return;
                units.push({ head, tail, comp });
            });
            if (!units.length) return [];
            /* ③ ⚠⚠ **環の側にふつうの C=C / C≡C があったら出さない**（v1508。§10.14-G）。
             *   ★ **根拠は「教科書に無い」ではなく反応の仕組み** —— アルケンを使う
             *   フリーデル・クラフツのアルキル化は、**アルケンをプロトン化して
             *   カルボカチオンを作る**ところから始まる（＝ 強い酸が要る）。
             *   ⚠ スチレンの側鎖はその条件で**ベンジル位カチオン**になる ——
             *   系の中でいちばん安定なカチオンで、プロペンからできるイソプロピルカチオンより
             *   安定なので、**先に反応するのは環ではなく側鎖の C=C** である
             *   （実際、スチレンはルイス酸／プロトン酸でカチオン重合する）。
             *   ★ **環がアルキル化される絵を見せるのは、順序を取り違えさせる。**
             *   ⚠ 同じ理由でフェニルアセチレン（C≡C）も落ちる。
             *   ★ この門番は `hydrogenate_benzene_ring` の②と**同じ考え方・同じ範囲の見方**
             *   （その分子だけを見る）にそろえてある。 */
            const multiples = multipleBondSites(mol);
            // ② 炭化水素の芳香環の、置換できる位置（等価な位置は `aromaticSites` がまとめる）
            const sites = [];
            aromaticSites(mol, null).forEach(([ringId]) => {
                const ringComp = componentOf(mol, ringId);
                const hetero = [...ringComp].some(id => {
                    const a = mol.atoms.find(x => x.id === id);
                    return a && a.element !== 'C' && a.element !== 'H';
                });
                if (hetero) return;
                if (multiples.some(ids => ids.some(id => ringComp.has(id)))) return;  // ③
                units.forEach(u => {
                    if (ringComp.has(u.head)) return;   // 別分子どうしのみ
                    sites.push([ringId, u.head, u.tail]);
                });
            });
            return sites;
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const [ringId, headId, tailId] = site;
            const bond = mol.getBond(headId, tailId);
            if (!bond || bond.type !== 2) throw new Error('プロペンの C=C が見つかりません');
            // 配向性は**書き換える前の環**で判断する（既存の芳香族置換4本と同じ約束）。
            // ベンゼンは6頂点が等価なので空文字。トルエンなどでは o/p の説明が付く
            const note = orientationNote(mol, ringId);
            const movingIds = [...componentOf(mol, headId)];
            // ⚠ **置き場を先に確かめる**（途中で失敗して C=C だけ開いた形を残さない）
            const plan = planAttachment(mol, ringId, headId, movingIds);
            if (!plan) throw noRoom('生成物を配置する空間がありません');
            bond.type = 1;                       // 二重結合が開く（付加であって置換ではない）
            applyAttachment(mol, movingIds, plan);
            mol.addBond(ringId, headId, 1);
            return {
                caption: 'ベンゼンにプロペンが付加して、クメン（イソプロピルベンゼン）ができました' +
                    '（触媒を用いる）。C=C が開いて、**置換基の多いほうの炭素**が環につくので、' +
                    'プロピル基 CH₃CH₂CH₂- ではなく**イソプロピル基 (CH₃)₂CH-** が生えます' +
                    '（マルコフニコフ則と同じ向きです）。' +
                    '\n★ これは**クメン法の1段目**です。フェノールの工業的製法で、続きは' +
                    '②クメンを空気（酸素）で酸化してクメンヒドロペルオキシドにし、' +
                    '③硫酸で分解すると**フェノールとアセトンが同時に**得られます。' +
                    '⚠ ②③はこのアプリでは実行できません —— 中間体が -O-O- という結合をもち、' +
                    'いまの図の描き方では表せないためです。' + note,
                changed: [ringId, headId, tailId]
            };
        }
    },
    {
        /* ★ ベンゼン環の水素化 → シクロヘキサン環
         * （§10.11-D #9・入試35件／`DESIGN_organic_tree.md` §2-3 (b)・v1501）。
         * ★ **教科書 本文 p.177**（Pt/Ni を触媒に 3H₂）。ベンゼンもシクロヘキサンも登録済み。
         *
         * ⚠⚠ **「ベンゼンは付加しにくい」を壊さないための門番が2つ要る**
         *   （§10.11-F 次点が名指しした注意そのもの）:
         *
         *   ① **炭化水素だけからなる分子**に絞る。★ いちばん効くのは
         *      **ニトロベンゼンが落ちること** —— この瓶（h2_ni）には `reduce_nitro` が
         *      相乗りしていて、その caption が「⚠ このときベンゼン環は水素化されません」と
         *      書いている。★ 環の水素化を同じ瓶から同時に出すと、**画面が自分の説明と食い違う**。
         *      フェノール・アニリンも同じ理由でここには来ない。
         *
         *   ② **ふつうの多重結合（C=C・C≡C）が分子に無いこと**。★ スチレンに H₂ を当てれば
         *      **先に側鎖のビニル基が水素化される**（環はずっと付加しにくい）ので、
         *      両方を同時に札として出すと**順序を取り違えさせる**。
         *      ⚠ 側鎖を先に水素化してエチルベンゼンにすれば、そこで環の札が出る
         *      ＝ 教科書どおりの順序が画面の操作の順序になる。
         *
         * ★ **図の書き換えはいちばん軽い**——原子を1つも足さず・1つも消さない。
         *   環の6本を単結合にすると、自動水素が CH₂ を6つ描く。 */
        id: 'hydrogenate_benzene_ring',
        reagentId: 'h2_ni',
        label: '付加: H₂ ×3 → ベンゼン環がシクロヘキサン環になる',
        /* ⚠⚠ **門番は「その分子（連結成分）」だけを見る**（v1508 の定期レビューで直した）。
         *   ★ もとは `mol.atoms.some(…)` / `multipleBondSites(mol).length` と
         *   **キャンバス全体**を見ていたので、**ベンゼンの隣に別の分子が浮いているだけで
         *   札が消えていた**（実機で確認: ベンゼン＋エタノール／ベンゼン＋水／
         *   ベンゼン＋シクロヘキセン）。⚠ そのとき瓶は「ふつうの条件では進みません」と
         *   **化学として間違った説明**を出す。
         *   ⚠⚠ 系統樹は全体を1キャンバスに描くので、これは例外ではなく常態だった。
         *   ★ **絞り込みの線（①②）は1つも変えていない** —— 変えたのは「どの範囲を見るか」だけ。
         *   実測でもナフタレンは 0・スチレンは側鎖→環の順のまま（TR3・TR4）。 */
        detect(mol) {
            const multiples = multipleBondSites(mol);
            return isolatedBenzeneRings(mol).filter(ring => {
                const comp = componentOf(mol, ring[0]);
                // ① **その分子が**炭化水素だけからできていること
                //    （ニトロベンゼンは落ちる ＝ 同じ瓶の `reduce_nitro` の説明と食い違わない）
                if (mol.atoms.some(a => comp.has(a.id) &&
                    a.element !== 'C' && a.element !== 'H')) return false;
                // ② **その分子に**ふつうの C=C / C≡C が残っていないこと（残っていればそちらが先）
                if (multiples.some(ids => ids.some(id => comp.has(id)))) return false;
                return true;
            });
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const ring = new Set(site);
            const inside = mol.bonds.filter(b => ring.has(b.atomId1) && ring.has(b.atomId2));
            if (inside.length !== 6) throw new Error('ベンゼン環の6本が見つかりません');
            inside.forEach(b => { b.type = 1; });   // 原子は足さない。自動水素が CH₂ を描く
            return {
                caption: 'ベンゼン環に水素が付加して、シクロヘキサン環になりました' +
                    '（C₆H₆ ＋ 3H₂ → C₆H₁₂）。ニッケルや白金を触媒に、**高温・高圧**で反応させます。' +
                    '⚠ ベンゼン環はふつうの二重結合とは違って**付加しにくい** —— ' +
                    '6個の電子が環全体に広がって安定している（芳香族性）ためで、' +
                    'だからベンゼンは臭素水を脱色せず、置換のほうが起こります。' +
                    'ここは「起こらない」のではなく「特別な条件が要る」反応です。' +
                    '\n⚠ 側鎖に二重結合があるとき（スチレンなど）は、**そちらが先に**水素化されます。' +
                    '先に側鎖を水素化してから、もう一度この反応を見てください。',
                changed: site
            };
        }
    },
    {
        /* ★★ ベンゼン ＋ 3Cl₂ → ヘキサクロロシクロヘキサン（v1541・参考書の式1本）。
         * ⓵ **生成物 `hexachlorocyclohexane` は登録済み**で、そこへ行く手段だけが無かった。
         *
         * ★ **門番は `hydrogenate_benzene_ring` と同じ形**（同じ「環への付加」なので、
         *   線を2通り持たない）—— ①その分子が炭化水素だけ ②ふつうの C=C/C≡C が残っていない。
         * ★ **一気に3つ付ける**のは省略ではなく教科書どおり（`bromination_activated_ring` と
         *   同じ考え方）。途中の一付加体・二付加体は取り出せない。
         * ⚠ **鉄触媒の置換（`aromatic_halogenation`）と同じ瓶にしない** ——
         *   条件で行き先が正反対に分かれるのがこの反応の要点で、
         *   瓶の名前（光／鉄触媒）がその条件そのものになっている。 */
        id: 'add_cl2_benzene_ring',
        reagentId: 'cl2_light',
        label: '付加: Cl₂ ×3（光）→ ベンゼン環がヘキサクロロシクロヘキサンになる',
        detect(mol) {
            const multiples = multipleBondSites(mol);
            return isolatedBenzeneRings(mol).filter(ring => {
                const comp = componentOf(mol, ring[0]);
                if (mol.atoms.some(a => comp.has(a.id) &&
                    a.element !== 'C' && a.element !== 'H')) return false;
                if (multiples.some(ids => ids.some(id => comp.has(id)))) return false;
                // 置換基のある環（トルエンなど）は、6個の塩素を置く場所が足りない
                return ring.every(id => mol.getNeighbors(id)
                    .filter(n => n.atom.element !== 'H' && ring.includes(n.atom.id)).length === 2 &&
                    mol.getFreeValency(id) >= 1);
            });
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const ring = new Set(site);
            const inside = mol.bonds.filter(b => ring.has(b.atomId1) && ring.has(b.atomId2));
            if (inside.length !== 6) throw new Error('ベンゼン環の6本が見つかりません');
            // ★ **先に塩素の置き場を全部ためす**（途中で場所が尽きて半端な図にしない）
            if (!site.every(id => attachGroup(mol, id, 'Cl', true))) {
                throw noRoom('環のまわりに塩素6個を置く空間がありません');
            }
            inside.forEach(b => { b.type = 1; });   // 環の6本が単結合になる ＝ 芳香族性が消える
            const added = [];
            site.forEach(id => { added.push(...attachGroup(mol, id, 'Cl')); });
            return {
                caption: 'ベンゼン環に塩素が付加して、ヘキサクロロシクロヘキサンになりました' +
                    '（C₆H₆ ＋ 3Cl₂ → C₆H₆Cl₆）。**紫外線を当てる**のが条件です。' +
                    '⚠ 同じ塩素でも、**鉄（塩化鉄(III)）を触媒にすると置換**が起こって' +
                    'クロロベンゼン C₆H₅Cl になります —— 条件だけで行き先が付加と置換に分かれる、' +
                    'ベンゼンの性質がいちばんよく出る一組です。' +
                    '付加すると環の二重結合がすべて無くなるので、できるのは芳香族ではなく' +
                    'シクロヘキサン環の化合物です。',
                changed: [...site, ...added],
                refit: true
            };
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
        // ⚠ v1541 でプロペン → アセトンまで広げたので、札の名前も書き直した
        label: 'ワッカー法（エチレン → アセトアルデヒド／プロペン → アセトン）',
        detect(mol) { return wackerUnits(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const [c1, c2] = site;
            const spot = freeSpotAround(mol, c1);
            if (!spot) throw noRoom('カルボニルの酸素を置く空間がありません');
            const bond = mol.getBond(c1, c2);
            if (!bond || bond.type !== 2) throw new Error('C=C が見つかりません');
            // 酸素がつく側に炭素の隣がいくつあるか ＝ できるのがアルデヒドかケトンかの分かれ目
            const branched = mol.getNeighbors(c1).filter(n => n.atom.element !== 'H').length >= 2;
            bond.type = 1;
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(c1, o.id, 2);
            bendCarbonyl(mol, c1, o.id);
            return {
                caption: (branched
                    ? 'プロペンが酸化されてアセトンになりました。'
                    : 'エチレンが酸化されてアセトアルデヒドになりました。') +
                    '塩化パラジウム(II) と塩化銅(II) を触媒に、酸素で酸化します。' +
                    '**炭素の数は変わらず**、C=C の片方が C=O に変わるだけです' +
                    '（切れて減る酸化開裂との違いはここです）。' +
                    '⚠ **酸素がつくのは置換基の多いほうの炭素**（マルコフニコフ則）なので、' +
                    'エチレンからはアルデヒド（アセトアルデヒド）ができるのに、' +
                    'プロペンからはケトン（アセトン）ができます —— ' +
                    '同じ反応なのに行き先が変わるのはこのためです。' +
                    'どちらも工業的製法で、教科書に式が載っています' +
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
         *   「スズ＋塩酸 → アニリン塩酸塩 → NaOH で遊離」の**2段**で書く。
         *   ⚠⚠ **v1517 まで、塩の段は「イオンだから描けない」（§10.6 の壁）が理由で
         *     caption の言葉だけで補っていた。その壁はもう無い**（電荷が入り、
         *     `amine_hcl` が本物のアニリン塩酸塩を描く）。
         *   ★ それでもこの反応を1段のままにするのは**別の理由** ——
         *     還元は H₂ ＋ 触媒でも起こり、そちらには塩の段が無いから
         *     （§10.3-b「1段で行き先へ」）。⚠ 教科書の2段を**画面でたどれる**ことは
         *     caption で案内する（できたアニリンに塩化水素の瓶をかければ実際に描ける）。
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
                    'その**塩の段は、できたアニリンに塩化水素（塩酸）の瓶をかけると実際に描けます**' +
                    '（-NH₃⁺ と Cl⁻ の形。水酸化ナトリウムでまたここへ戻ります）。' +
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
                // マルコフニコフ則。**`addAcrossMultipleBond` と同じ関数を通す**
                // （v1590 まではここに同じ式が書き写してあり、置換基でなく炭素を数える誤りも二重にあった）
                const cX = markovnikovCarbon(mol, id1, id2);
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
        /* ★ アルカンの塩素化（光によるラジカル置換・v1511）。
         *
         * ⚠⚠ **ユーザーの指摘**（2026-09-03）「アルカン全般に Cl2との置換反応がリストされて
         *   いないと思います」。実測でも、メタン・エタン・プロパン・シクロヘキサン・
         *   クロロメタンのどれでも **53本の反応が1本も出なかった**。
         *
         * ★★ **混合物になることを、操作で見せる。**
         *   実際の光塩素化は ① どの水素が置き換わるかを選べず ② 1つで止まらない、の2つの意味で
         *   混合物になる。⚠ このアプリは「1つの決まった生成物」を返す作りなので、どちらも
         *   **画面の断り書きだけ**にすると「ここでは 2-クロロプロパンができるのだ」と読まれる。
         *   そこで:
         *   - ① は **箇所選び**にした（`detect` が置換位置ごとに1件返す）。プロパンなら
         *     1位・2位 の2件が光り、押したほうができる ＝ **選べてしまう**という手ざわりが、
         *     「実際は選べない」の caption と噛み合う（けん化・二糖の縮合と同じ仕組み）
         *   - ② は **段数を止めない**。押すたびに Cl が1つ増え、メタンなら
         *     クロロメタン → ジクロロメタン → クロロホルム → 四塩化炭素 まで行く
         *     （教科書がそこまで書く並びで、実測で **4段とも名前が付く**）
         *   ★ caption は毎回「実際には混ざる」を言う。⚠ 1回目だけ言うのでは足りない ——
         *     多置換のほうは2回目以降に起こる話なので、そこで消えると読み落とす。
         *
         * ★ 対象範囲は `alkaneSubstitutionSites` の門番3つ（C と Cl だけ・全部単結合・木）。
         *   **枝分かれは入れ、環は落とした**（理由は同関数の注記＝生成物の名前の実測）。
         *
         * ⚠ **瓶は `cl2_light`（新設）。`cl2_fe` に相乗りさせていない**（瓶の注記を見ること）。 */
        id: 'chlorinate_alkane',
        /* ★ 機構データ `methane_chlorination` は `reactions.json` に**前からあった**のに、
         *   ここから名指ししていなかったので巻矢印で見られなかった（v1541 の実測で発見）。
         *   ⛔ 新しい機構データは1件も書いていない ＝ 1行つないだだけ（13 → 14本）。 */
        mechanismId: 'methane_chlorination',
        reagentId: 'cl2_light',
        label: 'アルカンの置換（Cl₂・光）→ 塩化アルキル',
        detect: (mol) => alkaneSubstitutionSites(mol),
        apply(game, site) {
            const mol = game.userMolecule;
            const cId = site[0];
            const added = attachGroup(mol, cId, 'Cl');
            // **何段目か**を数えて言う（1つで止まらないことを、その分子の実物で言うため）
            const comp = componentOf(mol, cId);
            const chlorines = [...comp]
                .map(id => mol.atoms.find(a => a.id === id))
                .filter(a => a && a.element === 'Cl').length;
            const carbons = [...comp]
                .map(id => mol.atoms.find(a => a.id === id))
                .filter(a => a && a.element === 'C');
            const restHydrogen = carbons.some(a => mol.getFreeValency(a.id) >= 1);
            return {
                caption: 'アルカンの水素が1つ塩素に置き換わりました（置換反応）。' +
                    '光（紫外線）が Cl₂ を塩素原子に分け、それが水素を引き抜いて進むラジカル置換で、' +
                    '同時に塩化水素 HCl ができます。**付加ではなく置換**になるのは、' +
                    'アルカンに付加できる多重結合が無いからです。' +
                    `いまこの分子には塩素が ${chlorines} 個ついています。` +
                    (restHydrogen
                        ? '⚠ **実際には1つでは止まりません。** 置き換わる水素を選ぶこともできないので、' +
                          '置換の数も位置も違うものが**混ざって**できます。' +
                          'もう一度この瓶を押すと、次の置換に進めます。'
                        : '⚠ **水素がすべて塩素に置き換わりました。** 実際の反応では、' +
                          'ここまで進む前の段階のものも混ざって残っています。') +
                    '⚠ このアプリは1回の操作で1つの生成物を描くので、' +
                    '**画面に出ているのは混合物の中の1つ**だと思って見てください。',
                changed: [cId, ...added]
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
        /* ★ 分子間脱水（カルボン酸2分子）→ 酸無水物（`DESIGN_organic_tree.md` §2-3 (b)・v1501）。
         *
         * ⚠⚠ **これは「片道」を閉じる修正である。** `hydrolysis_anhydride`（無水酢酸 ＋ 水 →
         *   酢酸2分子）は前からあったのに、**行きが無かった** ——
         *   `dehydration_inter` は `ALCOHOL_TYPES` しか見ないので酢酸2分子では 0 件
         *   （実測。系統樹レーンの §2-3 (b) が名指しした穴）。
         *   ★ `dehydration_anhydride`（分子内・v1472）が閉じたのは**環になる二酸の側だけ**で、
         *   **教科書がいちばん先に書く 酢酸 → 無水酢酸 は、まだどこからも作れなかった。**
         *
         * ★ **`apply` はエステル化・アミド化と 1 か所も違わない。**
         *   カルボン酸 A の -OH がとれ、相手 B の -OH の酸素が架橋になる
         *   ＝ `applyAcidCondensation` の site の形（[酸のC, 抜ける-OHのO, 相手の重原子]）に
         *   そのまま乗る（相手の重原子が「アルコールの O」ではなく「もう1つのカルボン酸の O」）。
         *   ⚠ **写さない**（写すと片方だけ直る）。
         *
         * ⚠ **-COOH を1つだけ持つ分子どうしに絞る。** 二酸（フタル酸・マレイン酸）では
         *   **分子内脱水のほうが起こる**（`dehydration_anhydride`。5・6員環）ので、
         *   ここで分子間もぶつけると「教科書が書いていない高分子（ポリ酸無水物）」への道を
         *   画面に出すことになる。★ 門番は名前ではなく**構造**（-COOH の数）で立てる。
         *
         * ⚠ **瓶は足していない。** `dehydration_anhydride`（分子内）と同じ理由 ——
         *   教科書は「加熱すると」「脱水すると」としか書かず、試薬を名指ししない（§4-1 の線）。 */
        id: 'dehydration_anhydride_inter',
        label: '分子間脱水（カルボン酸2分子, -H₂O） → 酸無水物',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②水がとれて -CO-O-CO- でつながる
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            const carboxyls = groups.filter(g => g.type === 'carboxyl');
            /* ⚠⚠ **-OH や -NH₂ を持つ酸を通してはいけない**（v1508 の定期レビューが実機で発見）。
             *   もとの門番は「-COOH が1つ」しか見ていなかったので、次の相手で札が出ていた:
             *     グリシン×2 … ★ **教科書はここをペプチド結合として教える**
             *     酢酸＋グリシン／アラニン … -NH₂ があるのでアミド化が先
             *     酢酸＋乳酸 … -OH があるのでエステル化が先
             *     酢酸＋サリチル酸 … ⚠⚠ 実験モードの課題 `eq-salicylic-aspirin` の
             *                       分子モーダルに誤った相手札が出ていた（アセチル化が先）
             *   ★ 門番は名前ではなく**構造**で立てる ＝「先に反応する基を持たない酸だけ」。 */
            const BLOCKING = new Set([...ALCOHOL_TYPES, 'phenol', 'enol',
                'amine1', 'amine2', 'amine3']);
            /* ⚠ **ギ酸だけは別の判断が要る。** 無水ギ酸は単離できず（脱水すると CO になる）、
             *   ★ この「単離できない」は**構造からは読めない**。
             *   書ける門番は「-COOH の炭素に炭素が隣り合うこと」という構造の形になるが、
             *   ⚠ **その形にした理由は構造ではない**ので、ここに理由を残しておく。
             *   （この門番が落とすのはギ酸ただ1つ。シュウ酸などの二酸は上の -COOH の数で先に落ちる） */
            const hasCarbonNeighbour = (cId) =>
                mol.getNeighbors(cId).some(n => n.atom.element === 'C');
            const lone = carboxyls.filter(cx => {
                const comp = componentOf(mol, cx.atomIds[0]);
                // 「その分子がもつ -COOH は1つだけか」（二酸は分子内脱水へ譲る）
                if (carboxyls.filter(o => comp.has(o.atomIds[0])).length !== 1) return false;
                // その分子に「先に反応する基」（-OH・フェノール・-NH₂）が無いこと
                if (groups.some(g => BLOCKING.has(g.type) &&
                    g.atomIds.some(id => comp.has(id)))) return false;
                // ギ酸を外す（上の理由）
                return hasCarbonNeighbour(cx.atomIds[0]);
            });
            const sites = [];
            for (let i = 0; i < lone.length; i++) {
                for (let j = i + 1; j < lone.length; j++) {
                    const a = lone[i], b = lone[j];
                    if (componentOf(mol, a.atomIds[0]).has(b.atomIds[0])) continue; // 別分子どうしのみ
                    /* ⚠ **向きは1通りでよい**。A の -OH が水になって B の -OH の酸素が架橋になる形も、
                     * その逆も、できあがる -CO-O-CO- はまったく同じ分子である（実測で正準コードが一致）。
                     * 2通り出すと、押しても同じものができる札が2枚並ぶだけになる。 */
                    sites.push([a.atomIds[0], a.atomIds[2], b.atomIds[2]]);
                }
            }
            return sites;
        },
        apply(game, site) {
            const changed = applyAcidCondensation(game.userMolecule, site);
            return {
                caption: 'カルボン酸2分子から水がとれて、酸無水物 -CO-O-CO- ができました（加熱・脱水）。' +
                    '酢酸2分子からは無水酢酸ができます。' +
                    'エステル化と同じ「-OH と -H がとれて水」ですが、相手が**アルコールではなくもう1つのカルボン酸**なので、' +
                    '2つのカルボニルが1つの酸素をはさむ形になります。' +
                    'できた酸無水物はカルボン酸より反応性が高く、アセチル化の試薬として使えます' +
                    '（アニリン → アセトアニリド、サリチル酸 → アセチルサリチル酸）。' +
                    '⚠ 逆に水を加えると、もとのカルボン酸2分子に戻ります。',
                changed
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
            // ★ 五員環は正五角形（v1566）・六員環は正六角形（v1574）に置く。置けないとき（重なる）は今までどおり O だけ動かす
            const pentagon = anhydridePentagonPlacement(mol, cand, ohA, ohB) ||
                anhydrideHexagonPlacement(mol, cand, ohA, ohB);
            /* ★ **環にする前の姿をここで控える**（発注書 G）。控えるのは
             *   「動かしうる原子ぜんぶ」＝ 五角形／六角形の置き直しが触る範囲より広く取る
             *   （環になる経路・2つのアシル炭素・その酸素）。加水分解が帰り道でここへ戻す。 */
            rememberPreRing(mol,
                [...cand.path, ohA, ohB,
                    ...mol.bonds.filter(b => b.atomId1 === cA || b.atomId2 === cA ||
                                             b.atomId1 === cB || b.atomId2 === cB)
                        .flatMap(b => [b.atomId1, b.atomId2])],
                { [cA]: mol.atoms.find(a => a.id === ohA), [cB]: mol.atoms.find(a => a.id === ohB) });
            // 片方の -OH の O を架橋にし、もう片方の -OH は水として出す
            mol.removeBond(cB, ohB);
            if (pentagon) {
                pentagon.forEach((p, id) => {
                    const a = mol.atoms.find(x => x.id === id);
                    if (a) { a.x = p.x; a.y = p.y; }
                });
            } else {
                const o = mol.atoms.find(x => x.id === ohA);
                o.x = spot.x; o.y = spot.y;
            }
            // ⚠ 水は形を決めたあとで逃がす（先に逃がすと、動かした五角形の上に水が残りうる）
            parkAsWater(mol, ohB);
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
        /* ⚠ **札に残った箇所だけを語る**（v1589・§13.8。`oxidation_out_of_scope_info` と同じ）。
         * フマル酸（反対側）と描き分け前のブテン二酸（読めない）を並べたとき、
         * 見ている側の段落だけを出す */
        apply(game, sites) {
            const cands = anhydrideDehydrationCandidates(game.userMolecule).filter(c => c.geo !== 'ok');
            const kinds = new Set(pickShownSites(cands, sites, c => c.site).map(c => c.geo));
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
        // ⚠ v1592 で `findFunctionalGroups` が `anhydride` を返すようになった。
        //   以前は「ester のうち向かい側もカルボニルのもの」を拾い、**2つのカルボニルから
        //   同じ酸素が2回見える**ので酸素ごとに畳んでいた。いまは検出側が中央の O ごとに
        //   1件返すので、畳む必要が無い（atomIds の先頭3つの並びは ester と同じままなので
        //   下の apply の `const [cId, , oId] = site` はそのまま効く）
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'anhydride')
                .map(g => g.atomIds);
        },
        apply(game, site) {
            const [cId, , oId] = site;
            const mol = game.userMolecule;
            const ring = ringAtomIdsOf(mol).has(oId); // 環状の酸無水物（無水フタル酸など）
            // ★ 切り方も印の列挙も `cleaveAcylOxygen` に任せる（同書 CV1）。
            //   ⚠ ここは `changed: [cId, o.id]` と書いてあり、**切り離される側の酢酸が光らなかった**
            /* ★ 環の中の原子ぜんぶを先に控えておく（発注書 G）。切ったあとで引くと、
             *   すでに別の分子に分かれていて片方しか拾えない。 */
            const ringIds = ring ? [...ringAtomIdsOf(mol)] : [];
            const near = [...componentOf(mol, cId)];
            const { changed } = cleaveAcylOxygen(mol, cId, oId);
            /* ★★ 加水分解は水を**使う**（発注書 G）。画面に浮いている水を1分子引き取る
             *   ＝「① フタル酸 ＋ ② 水」で終わらない。 */
            takeWaterFromCanvas(mol, cId);
            /* ★★ 環をつくる前の姿へ戻す（発注書 G）。⚠ **控えを持つ原子だけ**が動くので、
             *   ライブラリから呼び出した無水フタル酸はいままでどおりの図になる。
             *   戻したあと、2つの -COOH の酸素を「もとの -OH が付いていた場所」へ置き直す
             *   ＝ 架橋だった O と、いま生えた O のどちらが来ても同じ絵になる。 */
            const homes = mol.atoms.filter(a => a[OH_HOME_XY])
                .map(c => ({ c, oh: mol.atoms.find(x => x.id === hydroxylOxygenOf(mol, c.id)) }))
                .filter(x => x.oh);
            const back = restorePreRing(mol, ringIds.concat(near, changed),
                homes.map(x => x.oh.id));
            if (back) {
                homes.forEach(({ c, oh }) => {
                    oh.x = c[OH_HOME_XY].x; oh.y = c[OH_HOME_XY].y;
                    delete c[OH_HOME_XY];
                });
            }
            return {
                caption: '酸無水物が加水分解されました（-CO-O-CO- + H₂O → -COOH が2つ）。' +
                    (ring
                        ? '環状の酸無水物なので、環が開いて1つの分子に2つのカルボキシ基ができます（無水フタル酸 → フタル酸）。'
                        : '無水酢酸なら酢酸2分子になります。') +
                    'エステルの加水分解と形は似ていますが、酸無水物はカルボン酸より反応性が高く、水と容易に反応します（アセチル化の試薬に使えるのはこのためです）。この反応は「けん化」とは呼びません。',
                changed
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
        /* ★★ アミド結合の加水分解（v1541・参考書の式1本＝ポリペプチドの加水分解）。
         *
         * ⚠⚠ **アミド結合を切るルールが1本も無かった。** `amidation`（作る側）と
         *   `acetylation_anhydride` は前からあるのに**帰りが無い片道**で、
         *   実測でジペプチド・アセトアニリド・ナイロン66 のどれにも0件だった（v1540）。
         *   ★ 1本足すと、参考書の「ポリペプチドの加水分解」だけでなく
         *     アセトアニリド・ナイロンにも同じ札が出る。
         *
         * ★ **切り方は `cleaveAcylOxygen` に任せる**（CV1 の約束＝切る反応の印を1か所で決める）。
         *   ⚠ 名前は「Oxygen」だが、やっているのは「アシル基から相手の重原子を外して
         *   -OH を生やす」ことで、相手が O でも N でも1行も違わない。
         *
         * ★ **環状アミド（ラクタム）も通す。** カプロラクタム ＋ H₂O →
         *   6-アミノヘキサン酸は、ナイロン6 の話でそのまま出てくる。
         *   `cleaveAcylOxygen` が「切っても分子が分かれない」場合を既に扱っている。
         *
         * ⚠ **瓶は増やさない** —— エステルの加水分解と同じ希硫酸（`h2so4_dil`）。
         *   規約1-2 のとおり瓶の `acts`・`miss` も書き足してある。 */
        id: 'hydrolysis_amide',
        reagentId: 'h2so4_dil',
        label: '加水分解（アミド結合 + H₂O, 酸を触媒に加熱）',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'amide')
                /* ⚠ **尿素型（同じカルボニル炭素に N が2つ）は落とす**（実測で入っていた）。
                 *   切ると**カルバミン酸 H₂N-COOH** ができるが、これは単離できず
                 *   ただちに CO₂ ＋ NH₃ に分かれる ＝ 画面に描くと嘘の図になる。
                 *   ★ 尿素そのものは「尿素樹脂の材料」として登録してあるので、
                 *     ここを開けておくと必ず踏む。 */
                .filter(g => mol.getNeighbors(g.atomIds[0])
                    .filter(n => n.atom.element === 'N').length === 1)
                .map(g => g.atomIds); // [カルボニルC, =O, N]
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const [cId, , nId] = site;
            const { changed } = cleaveAcylOxygen(mol, cId, nId);
            const stillOne = componentOf(mol, cId).has(nId); // 環だった（分子が分かれていない）
            return {
                caption: 'アミド結合が加水分解されて、カルボン酸とアミンに分かれました。' +
                    '水が1分子入って、C 側が -COOH に、N 側が -NH- に戻ります（アミド化の逆）。' +
                    (stillOne
                        ? '⚠ もとが**環状のアミド（ラクタム）**だったので、環が開いただけで分子の数は増えません。' +
                          'カプロラクタムを開くと 6-アミノヘキサン酸になり、これがナイロン6 の繰り返し単位です。'
                        : '') +
                    'タンパク質を塩酸と煮ると、ペプチド結合がここで切れてアミノ酸に分かれます' +
                    '（ポリペプチドの加水分解）。ナイロンのアミド結合・アセトアニリドのアミド結合も同じ形なので、' +
                    'まったく同じ切れ方をします。' +
                    '⚠ アミド結合はエステル結合より切れにくいので、酸（か塩基）を加えて**長く加熱**します。' +
                    '体の中では、その仕事を消化酵素（ペプチダーゼ）がしています。',
                changed,
                refit: true
            };
        }
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
            /* ★ 切る・引き離す・-OH を生やす・印を数えるは `cleaveAcylOxygen` に束ねた（CV1）。
             *   ⚠ ここだけは**切った直後・引き離す前**に座標を控える必要があるので `onCut` で受ける。
             *   ⚠ 置く向きは `haworthCleaveDirection` が決める ＝ もとの α/β を保つ。 */
            let arcFrom = null;
            const { o, changed } = cleaveAcylOxygen(mol, cId, oId, {
                dir,
                /* ★ **紙を回し始める位置**（`DESIGN_sugar.md` §4-9f）。
                 * ⚠ すぐあとの引き離し（`separateComponent`）は相手を**真下へ 2 マス**動かす ——
                 *   これを回し始めの位置にすると「回す前にもう下へ落ちている」＝
                 *   ユーザー報告の**「分子全体が↓にスライドする」がここで作られる**。
                 * ⚠ 引き離しそのものは**外さない**（描き直しが効かない糖のときの受け皿）。
                 *   効いたときだけ、この位置から回した結果で置き直す。 */
                onCut: () => { arcFrom = mol.atoms.map(a => ({ id: a.id, x: a.x, y: a.y })); }
            });
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
                changed,
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
            const na = ionizeSalt(mol, oId);
            if (!na) throw noRoom('ナトリウムイオンを置く空間がありません');
            return {
                caption: `${kind.name}が水酸化ナトリウムと中和して、ナトリウム塩になりました。` +
                    '酸性の -OH の水素が取れて **-O⁻** になり、Na⁺ と塩をつくります。' +
                    '⚠ **Na⁺ は線で結ばずに粒として描いています** —— ' +
                    'イオンどうしが引き合っているだけの結びつき（イオン結合）を線では書きません。' +
                    '塩になると水に溶けやすくなります。' + kind.rank +
                    'できた塩に強い酸（希硫酸・塩酸）を加えると、もとの酸が遊離して戻ってきます。',
                changed: [oId, na.id]
            };
        }
    },
    {
        /* ★ 中和（酸 ＋ NaHCO₃ → 塩 ＋ CO₂）。DESIGN_ion_layer.md I-1。
         *
         * ⚠⚠ **フェノールには効かない**のが要点。酸の強さは
         *   **カルボン酸 > 炭酸 > フェノール** なので、NaHCO₃ から CO₂ を追い出せるのは
         *   炭酸より強い酸だけ ＝ **分液でカルボン酸とフェノールを分ける手**そのもの。
         *   `neutralize_naoh` と detect を共有しないのはここだけの理由で、
         *   判定は `acidKindOf`（既存）に任せてある（`strongerThanCarbonicAcidSites`）。
         * ★ 入試64件のうち NaHCO₃ が出るのは 41件（1手目だけでも 15件）。
         *   ⚠ **順序は固定しない**（教科書順「塩酸→NaHCO₃→NaOH」は 3件だけ。D-I10）。
         * ⚠ **発生する CO₂ は描かない**（`neutralize_naoh` が水を描かないのと同じ流儀。
         *   画面の分子に無い分子は描かず、文面で言う）。
         * ★ 同じ瓶に「調べるもの」の NaHCO₃（CO₂ が出る／出ない）が既に居る。
         *   ⚠ 押したときに走るのは**今までどおり検出のほう**で、この反応が出るのは
         *   **反応の一覧**と**分液の混合物**から（`onReagentClick` を1行も変えていない）。 */
        id: 'neutralize_nahco3',
        reagentId: 'nahco3',
        label: '中和（酸 + NaHCO₃, CO₂ 発生）→ ナトリウム塩',
        detect(mol) { return strongerThanCarbonicAcidSites(mol); },
        apply(game, site) {
            const [oId, anchorId] = site;
            const mol = game.userMolecule;
            const kind = acidKindOf(mol, oId, anchorId);
            const na = ionizeSalt(mol, oId);
            if (!na) throw noRoom('ナトリウムイオンを置く空間がありません');
            return {
                caption: `${kind.name}が炭酸水素ナトリウムと中和して、ナトリウム塩になりました` +
                    '（二酸化炭素 CO₂ が発生します。図には描いていません）。' +
                    '炭酸より強い酸だけが NaHCO₃ から CO₂ を追い出せるので、' +
                    '**この反応が起こること自体が「炭酸より強い酸」の証拠**です。' +
                    '酸性の -OH の水素が取れて **-O⁻** になり、Na⁺ と塩をつくります' +
                    '（⚠ **Na⁺ は線で結ばずに粒**。イオン結合は線では書きません）。' +
                    '塩になると水に溶けやすくなります。' + kind.rank,
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
         * ★ 塩・アルコキシドは**電離した形**（-O⁻ ＋ Na⁺ の粒）で書く（v1538）。
         * 中和と同じ形にそろえてある ＝ 同じ物質を2通りに描かない。 */
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
            // ⚠ `acidKindOf` は -OH のうちに読む（-O⁻ にすると空き価標が変わる）
            const kind = isAlcohol ? null : acidKindOf(mol, oId, anchorId);
            const na = ionizeSalt(mol, oId);
            if (!na) throw noRoom('ナトリウムイオンを置く空間がありません');
            const salt = '（できたものは **-O⁻ と Na⁺** のイオン結合で、' +
                'イオンどうしが引き合っているだけなので線では結びません。図では Na⁺ を粒で描いています。）';
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
        /* ★ フェノールの工業的製法 その1: アルカリ融解（v1511・入試 11 大問）。
         *   ベンゼンスルホン酸ナトリウム ＋ NaOH →（高温で融解）→ ナトリウムフェノキシド。
         *
         * ⚠ **瓶は足していない。** `naoh_aq` に相乗りする（発注の実測どおり）。
         *   ★ ⚠ ただし NaOH aq の瓶に「固体の NaOH と融解させる」反応をぶら下げているので、
         *   **条件は label と caption で必ず言う**（水溶液のままでは起こらない）。
         * ⚠ **`condition`（同じ瓶の2択）は使っていない。** 実測で、この反応が通る分子
         *   （-SO₃Na をもつもの）では `naoh_aq` の他のルールが1本も通らない
         *   ＝ 2択の画面が出る場面が無く、`condition` を付けても見えないまま
         *   `RG1 (6)` の「condition は4件ちょうど」だけが動く。
         *
         * ★ 系統樹の上でここが埋まると、ベンゼン →(濃硫酸) ベンゼンスルホン酸 →(NaOH) その塩
         *   →(融解) フェノキシド →(希硫酸・弱酸の遊離) フェノール が**4手ぜんぶつながる**。 */
        id: 'alkali_fusion',
        reagentId: 'naoh_aq',
        label: 'フェノールの製法: アルカリ融解（固体の NaOH と高温で融解）',
        detect: (mol) => phenoxidePrecursorSites(mol, 'sulfonate'),
        apply(game, site) {
            const mol = game.userMolecule;
            const changed = replaceWithPhenoxide(mol, site[0], site[1]);
            return {
                caption: 'スルホ基のナトリウム塩 -SO₃⁻ が -O⁻ に置き換わり、' +
                    'ナトリウムフェノキシドができました（アルカリ融解）。' +
                    '⚠ **水溶液では起こりません** —— 固体の水酸化ナトリウムと混ぜて' +
                    '**高温で融解**させる、という激しい条件が要ります。' +
                    '同時に亜硫酸ナトリウム Na₂SO₃ ができますが、この画面には描いていません。' +
                    'フェノールの工業的製法の1つで、ここに希硫酸を加えると' +
                    '弱酸の遊離でフェノールが取り出せます。' +
                    'ベンゼンから見ると スルホン化 → 中和 → アルカリ融解 → 弱酸の遊離 の4段です。',
                changed
            };
        }
    },
    {
        /* ★ フェノールの工業的製法 その2: クロロベンゼンの加水分解（v1511・入試 9 大問）。
         *   クロロベンゼン ＋ NaOH 水溶液 →（高温・高圧）→ ナトリウムフェノキシド ＋ NaCl。
         *
         * ⚠ **条件が上の1本と違う**（あちらは固体の NaOH と融解、こちらは水溶液で高温・高圧）。
         *   ★ 同じ瓶にぶら下がるので、**label で条件まで言い切る**（`aromatic_halogenation` が
         *   「（Cl₂・鉄触媒）」と書いているのと同じ流儀）。
         * ⚠ **芳香環に直結した -Cl だけ**を見る。鎖についた -Cl（アルカンの塩素化でできるもの）は
         *   高校ではここに入れない ——「ハロゲンは環に付いていると外れにくく、強い条件が要る」
         *   という話そのものが、この反応の見どころだから。 */
        id: 'hydrolysis_chlorobenzene',
        reagentId: 'naoh_aq',
        label: 'フェノールの製法: クロロベンゼンの加水分解（NaOH aq・高温高圧）',
        detect: (mol) => phenoxidePrecursorSites(mol, 'chloro'),
        apply(game, site) {
            const mol = game.userMolecule;
            const changed = replaceWithPhenoxide(mol, site[0], site[1]);
            return {
                caption: '環についた塩素が -O⁻ Na⁺ に置き換わり、ナトリウムフェノキシドができました。' +
                    '⚠ **常温の水酸化ナトリウム水溶液では起こりません** —— ' +
                    '**高温・高圧**（およそ 300℃・200気圧）という条件が要ります。' +
                    '環に直結したハロゲンは、鎖についたハロゲンより格段に外れにくいからです。' +
                    '同時に塩化ナトリウム NaCl ができますが、この画面には描いていません。' +
                    'これもフェノールの工業的製法の1つで、希硫酸を加えると' +
                    '弱酸の遊離でフェノールが取り出せます。',
                changed
            };
        }
    },
    {
        /* 弱酸の遊離（塩 ＋ 強酸 → もとの酸）。上の中和のちょうど逆向きで、
         * **けん化やヨードホルム反応の生成物（-COONa）からも引ける**。 */
        id: 'liberate_weak_acid',
        /* ★★ **塩酸でも引けるようにする**（DESIGN_ion_layer.md I-1・§1 #3）。
         * ⚠ v1506 まで瓶は希硫酸1本だけだった。⚠ **入試64件で遊離に使う試薬は
         *   塩酸 45件・硫酸 14件・CO₂ 7件** ＝ **いちばん多い塩酸で引けなかった**。
         * ★ `reagentId` は配列を受ける（v1428）ので、**瓶を1本も足さずに**直せる
         *   （`DESIGN_reagent_palette.md` §10.5「瓶を足す前に既存の瓶に付けられないかを見る」）。 */
        reagentId: ['h2so4_dil', 'hcl'],
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
            freeSaltAcid(mol, metalId, oId); // 粒が消えて -O⁻ の電荷も落ち、自動水素が -OH を描く
            return {
                caption: `より強い酸を加えたので、弱いほうの酸（${kind.name}）が遊離してもとの形に戻りました` +
                    `（-O⁻ ${symbol}⁺ → -OH）。` +
                    '「強い酸は弱い酸をその塩から追い出す」という弱酸の遊離です。' +
                    '希硫酸や塩酸は硫酸イオン・塩化物イオンとして塩の側に残ります。' + kind.rank +
                    'けん化でできたカルボン酸の塩（セッケンを含む）も、この操作で酸に戻せます。',
                changed: [oId]
            };
        }
    },
    {
        /* ★★ コルベ・シュミット反応（DESIGN_ion_layer.md I-2・DESIGN_organic_tree.md
         *   「12本の足りない辺」#8・入試 32件）。
         *   ナトリウムフェノキシド ＋ CO₂ →（高温・高圧）→ サリチル酸ナトリウム。
         *
         * ★ **瓶が無いことだけが理由で見送られていた辺**で、その瓶がこの段で揃った。
         *   ⚠ 生成物に名前が付くことを先に実測した（`サリチル酸ナトリウム` は登録済み・
         *   `compounds.json` の `sodium-salicylate`。（未登録）は0件）。
         *
         * ⚠⚠ **`harsh: true` が要る理由**（この段で新しく足した唯一の仕掛け）:
         *   この反応は **同じ瓶・同じ基質**（ナトリウムフェノキシド）で `liberate_co2` と
         *   ぶつかる。⚠ **分液漏斗の中は水溶液・常温**なので、そこで起こるのは遊離のほうだけ。
         *   ★ `applyToMixture` は「1成分につき最初に当たった1本」を走らせるので、
         *     **宣言の順に頼ると黙って入れ替わる**。だから
         *     ① この反応を**わざと `liberate_co2` より前に宣言**し
         *     ② `harsh` を見て `applyToMixture` が飛ばす
         *     ＝ **順ではなく印が効いていること**が否定対照で確かめられる形にした。
         *   ⚠ 瓶から押したときは今までどおり2択が出る（`renderConditionChoice` の
         *     「できることが 2 通りあります」）。`condition` は付けない ——
         *     v1511 の `alkali_fusion` / `hydrolysis_chlorobenzene` と同じで、
         *     **条件は `label` と caption で言う**（2択の見出しに「条件で変わります」と
         *     書くのは `condition` を持つ瓶だけ、という区別を崩さないため）。
         *
         * ⚠ **オルト位だけ**（`kolbeSchmidtSites` の注記）。⚠ 層の対応表には載せない
         *   （分液の操作ではないので層を動かさない）。 */
        id: 'kolbe_schmidt',
        reagentId: 'co2',
        harsh: true,
        label: 'コルベ・シュミット反応（フェノキシド + CO₂・高温高圧）→ サリチル酸ナトリウム',
        detect(mol) { return kolbeSchmidtSites(mol); },
        apply(game, site) {
            const [metalId, oId, orthoId] = site;
            const mol = game.userMolecule;
            const added = attachCarboxylate(mol, orthoId);   // 先に置く（置けなければ何も壊さず throw）
            freeSaltAcid(mol, metalId, oId);                  // -O⁻ Na⁺ → -OH（自動水素が描く）
            return {
                caption: 'ナトリウムフェノキシドに二酸化炭素が反応して、' +
                    '**サリチル酸ナトリウム**ができました（コルベ・シュミット反応）。' +
                    '⚠ **常温で吹き込んでも起こりません** —— ' +
                    '**高温・高圧**（およそ 125℃・5気圧）という条件が要ります。' +
                    '常温で吹き込むだけなら、フェノールが遊離して戻るだけです（隣の行き先）。' +
                    '入るのは -O⁻ の**となり（オルト位）**です。' +
                    'ナトリウムイオンが -O⁻ と二酸化炭素を隣り合わせにつかまえるためで、' +
                    'できたサリチル酸ナトリウムは -O⁻ が -OH に変わり、' +
                    'オルト位に -COO⁻ Na⁺ がついた形になります。' +
                    'ここに希硫酸や塩酸を加えると弱酸の遊離でサリチル酸が取り出せ、' +
                    'サリチル酸は無水酢酸でアセチルサリチル酸（アスピリン）に、' +
                    'メタノールでサリチル酸メチル（消炎剤）になります。',
                changed: [oId, orthoId, ...added]
            };
        }
    },
    {
        /* ★★ 弱酸の遊離 その2: **CO₂ を吹き込む**（DESIGN_ion_layer.md I-2・v1514）。
         *
         * ⚠⚠ **上の `liberate_weak_acid` と同じ形にできない**のがこの反応の全部。
         *   強酸（希硫酸・塩酸）は**どの塩からも**もとの酸を追い出せるが、
         *   CO₂（＝ 水に溶けて炭酸）が追い出せるのは**炭酸より弱い酸だけ** ＝ フェノールだけ。
         *   ★ **`neutralize_nahco3` のちょうど裏返し**: あちらは「炭酸より強い側」を塩にし、
         *     こちらは「炭酸より弱い側」を塩から戻す。同じ序列を2方向から見せている。
         *
         * ⚠ 入口は `phenoxideSaltSites`（**環に直結した -ONa だけ**）。
         *   ⚠⚠ 設計書 §5-2 は「`acidKindOf` の分岐を再利用」と書いていたが、**実測で使えない**
         *   （`acidKindOf` はナトリウムエトキシドにも『フェノール』を返す。同関数の注記）。
         *
         * ★ 入試64件のうち CO₂ 吹き込みは 7件。⚠ **順序は固定しない**（D-I10）。
         * ⚠ **できる炭酸水素ナトリウム NaHCO₃ は描かない**（`neutralize_naoh` が水を描かない
         *   のと同じ流儀。画面の分子に無い分子は描かず、文面で言う）。 */
        id: 'liberate_co2',
        reagentId: 'co2',
        label: '弱酸の遊離（フェノキシド + CO₂ を吹き込む）→ フェノール',
        detect(mol) { return phenoxideSaltSites(mol); },
        apply(game, site) {
            const [metalId, oId] = site;
            const mol = game.userMolecule;
            const metal = mol.atoms.find(a => a.id === metalId);
            const symbol = metal ? metal.element : 'Na';
            freeSaltAcid(mol, metalId, oId); // 粒が消えて -O⁻ の電荷も落ち、自動水素が -OH を描く
            return {
                caption: '二酸化炭素を吹き込んだので、フェノールが遊離してもとの形に戻りました' +
                    `（-O⁻ ${symbol}⁺ → -OH）。` +
                    '水に溶けた二酸化炭素は炭酸 H₂CO₃ になり、これが' +
                    '**フェノールより強い酸**なのでフェノールを塩から追い出します' +
                    '（同時に炭酸水素ナトリウム NaHCO₃ ができますが、図には描いていません）。' +
                    '⚠ **カルボン酸のナトリウム塩は、これでは戻せません** —— ' +
                    '酸の強さは **カルボン酸 > 炭酸 > フェノール** で、' +
                    '炭酸はカルボン酸より弱いからです。' +
                    'この違いを使うと、いちど両方を水層へ移してから' +
                    '**フェノールだけを有機層へ戻す**ことができます。',
                changed: [oId]
            };
        }
    },
    {
        /* ★★ アミン ＋ 塩酸 → 塩（水層へ）。DESIGN_ion_layer.md I-1 → **I-3 で本物の塩に**。
         *
         * ⚠⚠ **v1517 まで「構造を1原子も変えない」反応だった**（層の印だけを付け、
         *   画面で「塩の形はまだ描きません」と断っていた。D-I3）。
         *   ★ **電荷が入った（I-3）ので、その「まだ」を果たすのがこのルール**:
         *     N に +1（`chargedValency` で価標4本 ＝ 自動水素が -NH₃⁺ を描く）と
         *     **結合を持たない Cl⁻ の粒**（`placeCounterIon`）を置く。
         *   ⚠ **線で結ばない** —— N-Cl と書くと分子式 C₆H₆ClN ＝ N-クロロアニリンという
         *     別の分子の図になる（設計書 §3-1 の実測）。粒のままなら C₆H₈ClN で
         *     **登録済みのアニリン塩酸塩と正準コードが一致する**（SEP4 が実測で押さえる）。
         * ★ 入試64件のうち **アミンが水層へ移るのは 46件**（設計書 §4-2）。
         * ⚠ **detect に層の印は要らなくなった** —— 塩になった N は
         *   `findFunctionalGroups` の `ammonium` へ回り、アミンの枝から抜けるので、
         *   同じ瓶を二度押しても二度は効かない（ION3 が押さえている）。 */
        id: 'amine_hcl',
        reagentId: 'hcl',
        label: '塩をつくる（アミン + 塩酸）→ 水層へ',
        detect(mol) { return basicAmineNitrogens(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const nId = site[0];
            const n = mol.atoms.find(a => a.id === nId);
            if (!n) throw new Error('アミンの N が見つかりません');
            // 先に粒を置く（置けなければ何も壊さずに throw ＝ kolbe_schmidt と同じ順）
            const cl = placeCounterIon(mol, nId, 'Cl', -1);
            if (!cl) throw noRoom('塩化物イオンを置く空間がありません');
            n.charge = 1;   // N⁺ は価標4本 ＝ 自動水素が H を1つ増やして -NH₃⁺ になる
            return {
                caption: 'アミンは塩基なので、塩酸と塩をつくって水に溶けます（水層へ移りました）。' +
                    'N の非共有電子対が H⁺ を受け取って **-NH₃⁺** になり、' +
                    '塩化物イオン Cl⁻ と塩をつくります（アニリンなら**アニリン塩酸塩** C₆H₅NH₃Cl）。' +
                    '⚠ **Cl⁻ は線で結ばずに粒として描いています** —— ' +
                    'N と Cl を線1本で結ぶと N-クロロアニリンという別の分子の図になるためで、' +
                    'イオンどうしが引き合っているだけの結びつき（イオン結合）を線では書きません。' +
                    'この性質で、中性の物質やフェノール類から分けられます。' +
                    'なお、この塩に水酸化ナトリウムを加えるともとのアミンが遊離して有機層へ戻ります。',
                changed: [nId, cl.id]
            };
        }
    },
    {
        /* ★★ ジアゾ化（DESIGN_ion_layer.md I-4）。アニリン ＋ NaNO₂/HCl（氷冷）
         *   → **塩化ベンゼンジアゾニウム**。
         *
         * ★★ **ユーザーが名指しした学習上の要点**（2026-09-06）:
         *   「ベンゼンジアゾニウムでは、**どの N 原子の形式電荷が ＋ なのか**を
         *    表示することに学習上の意義があります」
         *   ＝ **＋ が付くのは環に直結したほうの N**（末端ではない）。
         *   ⚠ この置き方は `findFunctionalGroups` の `diazonium` の読み方
         *   （`atomIds[0]` が電荷を持つほう）と**同じ向き**でなければならない
         *   —— 逆に置くと、次に `diazoniumSites` が引けなくなる（DZ2 が見張る）。
         *
         * ★ 形: C-N⁺≡N。N⁺ は `chargedValency` で価標 4 本なので
         *   「環へ1本 ＋ 三重結合3本」でちょうど埋まり、**自動水素は生えない**。
         *   末端 N は中性で3本 ＝ こちらも空き 0。
         * ⚠ **Cl⁻ は粒として置く**（`placeCounterIon`。D-I5・`amine_hcl` と同じ流儀）。
         *   線で結ぶと N-Cl ＝ 別の分子の図になる。
         * ⚠ 機構ビューアの `aniline_diazotization` は Cl⁻ を省いているが、
         *   **こちらは描く**（分子式が教科書の C₆H₅N₂Cl と一致するため。§5-1 の前例どおり
         *   「粒を描くか省くかは物質ごとに選べる」）。
         *
         * ⚠ **氷冷（5℃以下）は `condition` の二択にしない**（瓶の注記に理由）。
         *   `label` と caption で言う。 */
        id: 'diazotization',
        reagentId: 'nano2_hcl',
        mechanismId: 'aniline_diazotization',
        label: 'ジアゾ化（芳香族アミン + NaNO₂/HCl・氷冷 5℃以下）→ ジアゾニウム塩',
        detect(mol) { return aromaticPrimaryAmineNitrogens(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const nId = site[0];
            const n = mol.atoms.find(a => a.id === nId);
            if (!n) throw new Error('芳香族アミンの N が見つかりません');
            // ★ 末端の N は **C→N の向きにまっすぐ**伸ばす（-N≡N は直線）。
            //   向きを指定しないと `freeSpotAround` は一直線の位置を後ろへ送るので折れる
            const ring = mol.getNeighbors(nId).find(x => x.atom.element === 'C');
            const prefer = ring ? Math.atan2(n.y - ring.atom.y, n.x - ring.atom.x) : null;
            const spot = freeSpotAround(mol, nId, [], prefer);
            if (!spot) throw noRoom('末端の窒素を置く空間がありません');
            // ⚠ **置き場を2つとも先に確かめる**（途中で失敗して N⁺ だけの図を残さない）
            const n2 = mol.addAtom('N', spot.x, spot.y);
            const cl = placeCounterIon(mol, nId, 'Cl', -1);
            if (!cl) { mol.removeAtom(n2.id); throw noRoom('塩化物イオンを置く空間がありません'); }
            mol.addBond(nId, n2.id, 3);
            n.charge = 1;   // ★ ＋ は**環側**の N（学習上の要点）
            return {
                caption: 'アニリンのような**芳香族の1級アミン**に、亜硝酸ナトリウムと塩酸を' +
                    '**氷冷しながら（5℃以下）**加えると、**ジアゾニウム塩**ができます（ジアゾ化）。' +
                    '-NH₂ の N がそのまま残り、そこへ窒素がもう1つ結びついて **-N≡N** になります。' +
                    '⚠ **＋ の電荷を持つのは、ベンゼン環に直結したほうの N** です' +
                    '（末端の N ではありません）—— 図の印を見てください。' +
                    'できたものは**塩化ベンゼンジアゾニウム** C₆H₅N₂Cl で、' +
                    'Cl⁻ は線で結ばずに粒として描いています（イオン結合は線で書きません）。' +
                    '⚠ **5℃以下に保つのが要点**です。温めるとこのジアゾニウム塩は' +
                    '分解して窒素を発生し、フェノールに変わってしまいます。' +
                    'なお**脂肪族の1級アミン**では、できたジアゾニウムがその場で分解するため' +
                    '塩として取り出せません（だからこの反応は芳香族だけで扱います）。',
                changed: [nId, n2.id, cl.id]
            };
        }
    },
    {
        /* ★★ ジアゾニウム塩の加熱分解（I-4）。ジアゾニウム塩 ＋ 水 → **フェノール ＋ N₂ ＋ HCl**。
         *
         * ⚠⚠ **瓶を持たせない**（RG5 の名簿に載る）。★ 理由は
         *   `dehydration_anhydride`・`ring_opening_polymerization` と**同じ** ——
         *   教科書がここで名指しするのは試薬ではなく**操作（温める）**だからで、
         *   「水の瓶」を作ると**5℃以下でも水はある**という事実と画面が食い違う
         *   （ジアゾ化はもともと水溶液で行う）。★ 分かれ目は温度であって試薬ではない。
         *   ⚠ 資料に無い試薬を名乗らせない（§4-1）。
         *
         * ★ これが `diazotization` の caption で言った「温めると壊れる」の**実物**。
         *   氷冷が要点であることが、2本のルールの対で画面に出る。
         *
         * ⚠ 図としては「-N₂⁺ が -OH に置き換わる」。⚠ 抜けた N₂ と、対イオンから
         *   できる HCl は**描かない**（気体・水に溶けたものは今までどおり図に出さない流儀）。 */
        id: 'diazonium_decompose',
        label: '加熱（ジアゾニウム塩 + 水）→ フェノール（N₂ が発生）',
        detect(mol) { return diazoniumSites(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const [nId, n2Id] = site;
            const n = mol.atoms.find(a => a.id === nId);
            const ring = n && mol.getNeighbors(nId).find(x => x.atom.element === 'C');
            if (!ring) throw new Error('ジアゾニオ基が環につながっていません');
            const ringId = ring.atom.id;
            const ion = nearestCounterIon(mol, nId, -1);
            const symbol = ion ? ion.element : null;
            // ★ -OH は**抜けた N の位置**に置く（置き場を探す必要がない ＝ 空間で失敗しない）
            const { x, y } = n;
            mol.removeAtom(n2Id);
            mol.removeAtom(nId);
            if (ion) mol.removeAtom(ion.id);
            const o = mol.addAtom('O', x, y);
            mol.addBond(ringId, o.id, 1);   // 酸素に結合手が1つ空き、自動水素が -OH を描く
            return {
                caption: 'ジアゾニウム塩の水溶液を**温める**と分解して、' +
                    '**窒素 N₂ が発生**し、**フェノール**ができます（-N₂⁺ → **-OH**）。' +
                    '⚠ これが、ジアゾ化を **5℃以下に氷冷しながら**行う理由です —— ' +
                    '温度が上がると、せっかくできたジアゾニウム塩がこうして壊れてしまいます。' +
                    '窒素が抜けていくので、この反応は逆向きには戻りません' +
                    '（発生する N₂ は図に描いていません' +
                    (symbol ? `。対イオンの ${symbol}⁻ は塩化水素になって水に溶けるので、` +
                        'こちらも図から外しました' : '') + '）。',
                changed: [ringId, o.id]
            };
        }
    },
    {
        /* ★★ ジアゾカップリング（I-4）。ジアゾニウム塩 ＋ ナトリウムフェノキシド
         *   → **p-ヒドロキシアゾベンゼン**（橙赤色。アゾ染料の代表例）。
         *
         * ★ **既存の機構ビューア `diazo_coupling` に `mechanismId` でつなぐ**
         *   （設計書 §5-2 の I-4 の指定どおり）。巻矢印はもう描いてある。
         * ⚠ **瓶を持たせない**（相手はキャンバスに呼び出す。`alkylate_arene_propene`・
         *   `acetalization_pva` と同じ形）。★ フェノキシドは
         *   「フェノールを NaOH 水溶液に溶かしたもの」＝ **画面で作れる**
         *   （フェノール ＋ NaOH → ナトリウムフェノキシド）。
         *
         * ⚠ **パラ位に限る**（機構データの desc がそう書く）。`kolbe_schmidt` が
         *   オルトに限るのとちょうど裏返し。
         * ⚠ Na⁺ と Cl⁻ は NaCl になって水に残るので、どちらも図から外す。
         * ★ N≡N は **N=N になる**（三重 → 二重）。⚠ 電荷はここで消える
         *   —— アゾ化合物は中性で、これが「色が着く」形。 */
        id: 'diazo_coupling',
        mechanismId: 'diazo_coupling',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②環と窒素がつながる
        label: 'ジアゾカップリング（ジアゾニウム塩 + ナトリウムフェノキシド）→ アゾ染料',
        detect(mol) { return diazoCouplingSites(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const [nId, n2Id, metalId, oId, paraId] = site;
            const n = mol.atoms.find(a => a.id === nId);
            const bond = mol.getBond(nId, n2Id);
            if (!n || !bond || bond.type !== 3) throw new Error('ジアゾニオ基が見つかりません');
            /* ⚠⚠ **置き場を先に確かめる**（途中で失敗して「Na だけ外れた図」を残さない）。
             *   Na は動かす側にいるが、このあと外れるので衝突判定から除く（ignoreIds）。 */
            const movingIds = [...componentOf(mol, oId)].filter(id => id !== metalId);
            const plan = planAttachment(mol, n2Id, paraId, movingIds, [metalId]);
            if (!plan) throw noRoom('生成物を配置する空間がありません');
            const ion = nearestCounterIon(mol, nId, -1);
            const symbol = ion ? ion.element : null;
            const metal = mol.atoms.find(a => a.id === metalId);
            const metalSymbol = metal ? metal.element : 'Na';
            if (ion) mol.removeAtom(ion.id);
            freeSaltAcid(mol, metalId, oId);   // 粒が消えて -O⁻ の電荷も落ち、自動水素が -OH を描く
            applyAttachment(mol, movingIds, plan);
            mol.addBond(n2Id, paraId, 1);
            bond.type = 2;             // N≡N → N=N
            delete n.charge;           // ★ アゾ化合物は中性（＋ はここで消える）
            return {
                caption: '氷冷したジアゾニウム塩の水溶液に**ナトリウムフェノキシド**を加えると、' +
                    '**橙赤色**の **p-ヒドロキシアゾベンゼン**ができました（ジアゾカップリング）。' +
                    'アゾ染料をつくる代表的な反応です。' +
                    '⚠ 結びつくのは **-O⁻ の対角（パラ位）の炭素**です —— ' +
                    'O⁻ が電子を環に押し出すので、その位置がいちばん反応しやすくなります。' +
                    '⚠ **N≡N が N=N（アゾ基）に変わり、＋ の電荷は消えます** —— ' +
                    'この長くつながった二重結合の並びが色のもとです。' +
                    `外れた ${metalSymbol}⁺ と ${symbol || 'Cl'}⁻ は塩（${metalSymbol}${symbol || 'Cl'}）` +
                    'になって水に残るので、図から外しました。',
                changed: [nId, n2Id, paraId, oId]
            };
        }
    },
    {
        /* ★ アミンの塩 ＋ NaOH → アミンが遊離して有機層へ（I-1 → I-3）。上のちょうど逆向き。
         * ⚠⚠ **入口を層の印から図そのものへ引き直した**（`ammoniumSaltNitrogens`）。
         *   ＝ 分液の面を開かずに「アニリン塩酸塩」を呼び出しただけでも NaOH が効く。
         * ⚠ **双性イオンには効かない**（成分の正味の電荷が 0。同関数の注記・否定対照 SEP4）。 */
        id: 'amine_liberate_naoh',
        reagentId: 'naoh_aq',
        label: 'アミンの遊離（塩 + NaOH）→ 有機層へ',
        detect(mol) { return ammoniumSaltNitrogens(mol); },
        apply(game, site) {
            const mol = game.userMolecule;
            const nId = site[0];
            const n = mol.atoms.find(a => a.id === nId);
            if (!n) throw new Error('アンモニウム型の N が見つかりません');
            const ion = nearestCounterIon(mol, nId, -1);   // 相方の粒（Cl⁻ など）
            const symbol = ion ? ion.element : null;
            if (ion) mol.removeAtom(ion.id);
            delete n.charge;   // N が中性に戻り、自動水素が H を1つ減らして -NH₂ を描く
            return {
                caption: '水酸化ナトリウムを加えたので、アミンの塩から**もとのアミンが遊離**して' +
                    '有機層（エーテル層）へ戻りました（-NH₃⁺ → **-NH₂**）。' +
                    '「強い塩基は弱い塩基をその塩から追い出す」——弱酸の遊離とちょうど対になる操作です。' +
                    (symbol ? `対イオンの ${symbol}⁻ は、ナトリウムイオンと塩（この場合は Na${symbol}）` +
                        'になって水層に残るので、図から外しました。' : '') +
                    'できた水も図には描いていません。',
                changed: [nId]
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
        label: '環化 → β-D-グルコース',
        morphStages: 'moveFirst', // ①環の形に折りたたむ → ②結合ができて環が閉じる
        detect(mol) { return detectGlucoseChain(mol); },
        apply(game, site) { return applyCyclize(game, site, REGISTERED_NAMES.beta); }
    },
    {
        id: 'cyclize_glucose_alpha',
        label: '環化 → α-D-グルコース',
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
    },
    {
        /* ★ ナトリウムフェノキシド ＋ ヨードメタン → アニソール ＋ NaI（v1541・参考書 aromatic.md の式1本）。
         *   参考書: `C₆H₅ONa ＋ CH₃I → C₆H₅OCH₃ ＋ NaI`（発展。★「呈色しなくなる」「分子量が14増える」の2点で十分、と書く）。
         * ★ **門番（相手）: ヨードメタン1分子だけ**（重原子が C と I の2個・単結合）。参考書が名指しするのは CH₃I だけで、
         *   ヨードエタン・クロロメタンへ広げる根拠が本文に無い。
         * ★ **門番（フェノキシドの側）: `phenoxideSaltSites`**（芳香環に直結した -O⁻ と金属の粒）。
         *   ⚠ ナトリウムエトキシド（鎖の -O⁻）・カルボン酸塩・スルホン酸塩はそこで落ちる。
         * ⚠ Na⁺ と I⁻ は NaI になって水に残るので、どちらも図から外す（`diazo_coupling` と同じ扱い）。
         * ⚠ **瓶は持たせない** —— 相手は試薬ではなく**分子**で、CH₃ の炭素がそのまま生成物に入る
         *   （アセタール化のホルムアルデヒドと同じ理由）。入口は `PARTNER_CANDIDATES` の札。
         * ⚠ 札の名前に「酸化」「H₂O」「H₂」を書かない（燃焼の札の注記を見ること）。 */
        id: 'williamson_ether',
        morphStages: 'joinFirst', // ①2分子が並ぶ → ②O と CH₃ がつながる
        label: 'エーテル化: ナトリウムフェノキシド ＋ ヨードメタン → アニソール',
        detect(mol) {
            const phen = phenoxideSaltSites(mol);
            if (!phen.length) return [];
            const methyls = [];
            mol.atoms.forEach(a => {
                if (a.element !== 'I' || a.charge) return;
                const heavy = [...componentOf(mol, a.id)]
                    .map(id => mol.atoms.find(x => x.id === id))
                    .filter(x => x && x.element !== 'H');
                if (heavy.length !== 2) return;
                const c = heavy.find(x => x.element === 'C');
                const b = c && mol.getBond(a.id, c.id);
                if (!c || c.charge || !b || b.type !== 1) return;
                methyls.push([c.id, a.id]);
            });
            const out = [];
            phen.forEach(([metalId, oId]) => {
                const own = componentOf(mol, oId);
                methyls.forEach(([cId, iId]) => {
                    if (!own.has(cId)) out.push([oId, cId, metalId, iId]);   // 別分子どうしのみ
                });
            });
            return out;
        },
        apply(game, site) {
            const mol = game.userMolecule;
            const [oId, cId, metalId, iId] = site;
            const o = mol.atoms.find(a => a.id === oId);
            if (!o || !(o.charge < 0)) throw new Error('フェノキシドの -O⁻ が見つかりません');
            // ⚠ **置き場を先に確かめる**（途中で失敗して「I だけ外れた図」を残さない）。
            //    外れる I と Na は衝突判定から除く
            const moving = [...componentOf(mol, cId)].filter(id => id !== iId);
            const plan = planAttachment(mol, oId, cId, moving, [iId, metalId]);
            if (!plan) throw noRoom('生成物を配置する空間がありません');
            mol.removeAtom(iId);
            freeSaltAcid(mol, metalId, oId);     // 粒が消え、-O⁻ の電荷も落ちる
            applyAttachment(mol, moving, plan);
            mol.addBond(oId, cId, 1);
            return {
                caption: 'ナトリウムフェノキシドにヨードメタン CH₃I を作用させると、' +
                    '**アニソール（メトキシベンゼン）C₆H₅OCH₃** ができました。' +
                    '-O⁻ が CH₃ の炭素と結びつき、ヨウ素が I⁻ として外れます。' +
                    '外れた Na⁺ と I⁻ は塩（NaI）になって水に残るので、図から外しました。' +
                    '\n★ フェノールの -OH の H が CH₃ に置き換わった形なので、' +
                    '**塩化鉄(III) 水溶液を加えても呈色しなくなり**、' +
                    'フェノールと比べて**分子量が 14 増えます**（H 1個ぶんが CH₃ 1個ぶんになる）。',
                changed: [oId, cId]
            };
        }
    },
    {
        /* ★ ナフタレンの空気酸化 → 無水フタル酸（v1541・参考書 aromatic.md）。
         * 門番と係数のずれは `naphthaleneUnits` の注記。
         * ★ **原子を作り直さず、壊れる環の炭素を使い回す**: 残る環の隣にあった2個が
         *   カルボニル炭素になり、奥の2個が CO₂ として出ていく ＝ 前後比較で
         *   「どの炭素がどこへ行ったか」が追える。
         * ⚠ **置き場は先に全部確かめる**（途中で失敗して環だけ壊れた図を残さない）。
         * ⚠ 札の名前に「酸化」「H₂O」を書かない（燃焼の札の注記と同じ事故 ＝ 文字で引くテストに当たる）。 */
        id: 'naphthalene_air_oxidation',
        label: 'ナフタレン → 無水フタル酸（V₂O₅・空気）',
        detect: (mol) => naphthaleneUnits(mol),
        apply(game, site) {
            const mol = game.userMolecule;
            const set = new Set(site);
            const at = id => mol.atoms.find(a => a.id === id);
            const ringNbr = id => mol.getNeighbors(id).filter(n => set.has(n.atom.id)).map(n => n.atom.id);
            const fused = site.filter(id => ringNbr(id).length === 3);
            if (fused.length !== 2) throw new Error('ナフタレンの縮合部が見つかりません');
            const [fa, fb] = fused;
            // 縮合部を通らずにたどると、それぞれの環が「4原子の道」になる（fa の隣 → … → fb の隣）
            const walk = (start) => {
                const path = [start];
                let prev = fa, cur = start;
                for (;;) {
                    const next = ringNbr(cur).find(x => x !== prev && !fused.includes(x));
                    if (!next) break;
                    path.push(next); prev = cur; cur = next;
                }
                return path;
            };
            const rings = ringNbr(fa).filter(x => x !== fb).map(walk);
            if (rings.length !== 2 || rings.some(r => r.length !== 4)) throw new Error('ナフタレンの環が見つかりません');
            const cen = r => ({ x: r.reduce((s, id) => s + at(id).x, 0) / 4, y: r.reduce((s, id) => s + at(id).y, 0) / 4 });
            // 壊すのは右の環（同じなら下）。⚠ **座標で決める**（原子IDは乱数）。化学的には等価
            rings.sort((p, q) => (cen(p).x - cen(q).x) || (cen(p).y - cen(q).y));
            const [keep, gone] = rings;
            const [k1, k2, k3, k4] = keep;
            const [p1, q1, q2, p2] = gone;      // p1 は fa の隣・p2 は fb の隣
            const before = heavyBondSignature(mol, site);

            // ---- 五員環（fa・p1・O・p2・fb）の座標 ＝ 縮合の結合を底辺にした正五角形
            const A = at(fa), B = at(fb);
            const L = Math.hypot(B.x - A.x, B.y - A.y) || bondStep(mol, fa);
            const ex = (B.x - A.x) / L, ey = (B.y - A.y) / L;
            const gc = cen(gone), mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
            let ux = -ey, uy = ex;
            if ((gc.x - mx) * ux + (gc.y - my) * uy < 0) { ux = -ux; uy = -uy; }
            const c108 = Math.cos(108 * Math.PI / 180), s108 = Math.sin(108 * Math.PI / 180);
            const P1 = { x: A.x + L * (ex * c108 + ux * s108), y: A.y + L * (ey * c108 + uy * s108) };
            const P2 = { x: B.x + L * (-ex * c108 + ux * s108), y: B.y + L * (-ey * c108 + uy * s108) };
            const hgt = L * Math.sqrt(5 + 2 * Math.sqrt(5)) / 2;
            const OB = { x: mx + ux * hgt, y: my + uy * hgt };
            const pc = { x: (A.x + B.x + P1.x + P2.x + OB.x) / 5, y: (A.y + B.y + P1.y + P2.y + OB.y) / 5 };
            const outward = P => {
                const dx = P.x - pc.x, dy = P.y - pc.y, d = Math.hypot(dx, dy) || 1;
                return { x: P.x + L * dx / d, y: P.y + L * dy / d };
            };
            const OC1 = outward(P1), OC2 = outward(P2);
            const others = mol.atoms.filter(a => !set.has(a.id) && a.element !== 'H');
            if ([P1, P2, OB, OC1, OC2].some(p => others.some(o => Math.hypot(o.x - p.x, o.y - p.y) < L * 0.8))) {
                throw noRoom('無水フタル酸を置く空間がありません');
            }
            // ---- 仮置きして CO₂ と H₂O の置き場を探す（見つからなければ元に戻して断る）
            const saved = [p1, p2].map(id => ({ id, x: at(id).x, y: at(id).y }));
            Object.assign(at(p1), { x: P1.x, y: P1.y });
            Object.assign(at(p2), { x: P2.x, y: P2.y });
            const ob = mol.addAtom('O', OB.x, OB.y);
            const oc1 = mol.addAtom('O', OC1.x, OC1.y);
            const oc2 = mol.addAtom('O', OC2.x, OC2.y);
            const spots = combustionProductSpots(mol, [q1, q2], 4);
            if (!spots) {
                [ob, oc1, oc2].forEach(o => mol.removeAtom(o.id));
                saved.forEach(s => Object.assign(at(s.id), { x: s.x, y: s.y }));
                throw noRoom('生成物を置く空間がありません');
            }
            // ---- ここから先は戻らない: 残る環のケクレ構造を組み直し、壊れる環を開く
            const setType = (x, y, t) => {
                const b = mol.getBond(x, y);
                if (!b) throw new Error('環の結合が見つかりません');
                b.type = t;
            };
            setType(fa, fb, 2); setType(fa, k1, 1); setType(k1, k2, 2);
            setType(k2, k3, 1); setType(k3, k4, 2); setType(k4, fb, 1);
            setType(fa, p1, 1); setType(fb, p2, 1);
            mol.removeAtom(q1);
            mol.removeAtom(q2);
            mol.addBond(p1, ob.id, 1);
            mol.addBond(p2, ob.id, 1);
            mol.addBond(p1, oc1.id, 2);
            mol.addBond(p2, oc2.id, 2);
            const G = bondStep(mol, fa);
            const made = [ob.id, oc1.id, oc2.id];
            for (let i = 0; i < 2; i++) {
                const p = spots[i];
                const c = mol.addAtom('C', p.x, p.y);
                const oL = mol.addAtom('O', p.x - G, p.y);
                const oR = mol.addAtom('O', p.x + G, p.y);
                mol.addBond(oL.id, c.id, 2);
                mol.addBond(c.id, oR.id, 2);
                made.push(c.id, oL.id, oR.id);      // ⚠ CO₂ に fromReaction は付けない（燃焼と同じ理由）
            }
            for (let i = 2; i < 4; i++) {
                const o = mol.addAtom('O', spots[i].x, spots[i].y);
                o.fromReaction = true;              // 自動水素で H₂O として描かれる
                made.push(o.id);
            }
            const after = heavyBondSignature(mol, site);
            const moved = site.filter(id => after.has(id) && after.get(id) !== before.get(id));
            return {
                caption: 'ナフタレンを、酸化バナジウム(V) **V₂O₅** を触媒にして空気中の酸素で酸化すると、' +
                    '**片方の環が壊れて**無水フタル酸ができました。' +
                    '**2C₁₀H₈ ＋ 9O₂ → 2C₈H₄O₃ ＋ 4CO₂ ＋ 4H₂O** です' +
                    '（図に出ているのは**1分子ぶん**で、CO₂ が 2 個・H₂O が 2 個です）。' +
                    '壊れた環の炭素4個のうち、残った環の隣にあった2個は **C=O** になって酸素でつながり' +
                    '（酸無水物の五員環）、奥の2個は二酸化炭素になって出ていきます。' +
                    '★ 同じ無水フタル酸は、o-キシレンを酸化してできるフタル酸を加熱しても得られます' +
                    '（隣り合った2つの -COOH が分子内で脱水する）。',
                changed: [...moved, ...made],
                refit: true
            };
        }
    },
    {
        /* ★★ 完全燃焼（v1541）。参考書の式3本（メタン・エタノール・ベンゼン）を1本で埋める。
         * 門番と置き場の理屈は `combustionComposition` / `combustionProductSpots` の注記。
         *
         * ★ **係数つきの式を caption に必ず出す。** 図（CO₂ が何個・H₂O が何個）と
         *   式の係数が**同じ数**であることが、この反応を画面でやる意味そのもの
         *   —— 元素分析はこの数を使って組成を逆算する。 */
        id: 'combustion',
        reagentId: 'o2_flame',
        /* ⚠ **札の名前に生成物を書かない。** 反応の一覧からボタンを**文字で**引いている
         *   テストが4本あり、書き方を変えるたびに別のテストへ当たった（`→ CO₂ ＋ H₂O` は
         *   L4・L6 の「H₂O」と RG10 の「H₂」に・`→ 二酸化炭素と水` は L6・RG14 の「**酸化**」に）。★ 生成物は caption が係数つきの式で言うので、札は条件だけを名乗ればよい。⚠ 一覧の並びも**この1本を末尾に置いた** ——
         *   有機化合物はたいてい燃えるので、前のほうに置くと
         *   **どの分子でも燃焼が先頭に並ぶ**（見たい反応が下へ押し出される）。 */
        label: '完全燃焼（O₂・点火）',
        detect: (mol) => combustibleComponents(mol),
        apply(game, site) {
            const mol = game.userMolecule;
            const comp = combustionComposition(mol, site);
            if (!comp) throw new Error('燃焼の式が書けない分子です');
            const spots = combustionProductSpots(mol, site, comp.co2 + comp.h2o);
            if (!spots) throw noRoom('生成物を置く空間がありません');
            const G = bondStep(mol, site[0]);
            // 燃えた分子は跡形もなくなる ＝ もとの原子はすべて消える
            site.forEach(id => mol.removeAtom(id));
            const changed = [];
            for (let i = 0; i < comp.co2; i++) {
                const p = spots[i];
                const c = mol.addAtom('C', p.x, p.y);
                const oL = mol.addAtom('O', p.x - G, p.y);
                const oR = mol.addAtom('O', p.x + G, p.y);
                mol.addBond(oL.id, c.id, 2);
                mol.addBond(c.id, oR.id, 2);
                /* ⚠ **CO₂ には `fromReaction` を付けない。** この印は `parkAsWater` が
                 *   置いた「脱離した水」を表すもので、CV1/CV4 の物差しは
                 *   **その印の付いた成分を検査から外す**（印は変化点を指すもので
                 *   生成物の目録ではない、という約束）。CO₂ は燃焼の主生成物なので、
                 *   外してしまうと「変化が1つも起きなかった反応」に化ける。 */
                [c, oL, oR].forEach(a => { changed.push(a.id); });
            }
            for (let i = 0; i < comp.h2o; i++) {
                const p = spots[comp.co2 + i];
                const o = mol.addAtom('O', p.x, p.y);
                o.fromReaction = true;          // 自動水素で H₂O として描かれる
                changed.push(o.id);
            }
            // ---- 係数を整数にそろえた式を作る（O₂ が半整数になるときだけ全体を2倍する）
            const k = Number.isInteger(comp.o2) ? 1 : 2;
            const sub = n => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
            const co = n => (n === 1 ? '' : String(n));
            const fuel = 'C' + (comp.c > 1 ? sub(comp.c) : '') +
                'H' + (comp.h > 1 ? sub(comp.h) : '') +
                (comp.o ? 'O' + (comp.o > 1 ? sub(comp.o) : '') : '');
            const eq = `${co(k)}${fuel} ＋ ${co(comp.o2 * k)}O₂ → ` +
                `${co(comp.co2 * k)}CO₂ ＋ ${co(comp.h2o * k)}H₂O`;
            return {
                caption: `完全燃焼しました。**${eq}** です。` +
                    `炭素は1個残らず二酸化炭素に、水素は1個残らず水になります` +
                    `（図に出ているのは**1分子ぶん**で、CO₂ が ${comp.co2} 個・H₂O が ${comp.h2o} 個です）。` +
                    (k === 2
                        ? `⚠ この分子は O₂ の係数が分数になるので、**式全体を2倍**して整数にそろえてあります。` +
                          `式の ${comp.co2 * 2}CO₂・${comp.h2o * 2}H₂O が図の2倍になっているのはそのためです。`
                        : '') +
                    (comp.o ? `もとの分子が持っていた酸素 ${comp.o} 個も生成物の側に入るので、` +
                        `必要な O₂ はそのぶん少なくなります。` : '') +
                    'この「C の数 ＝ CO₂ の数」「H の数 ＝ H₂O の数の2倍」という対応が元素分析の土台で、' +
                    '燃やして出てきた CO₂ と H₂O の質量から、もとの分子の C と H の数を逆算します。',
                changed,
                refit: true
            };
        }
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
/* ★ v1541: ヨードメタンを足した（`williamson_ether` の入口）。ナトリウムフェノキシドを見ているとき
 *   「＋ ヨードメタン を呼び出す → アニソール」の札が立つ。⚠ ほかの分子では札は出ない
 *   （`findPartnerHints` が実際に並べて `detect` を回すので、フェノキシド以外では箇所が出ない。
 *    ライブラリ全 1,163 件に並べて確かめた）。
 * ⚠⚠ **ここは登録名と1文字違わず一致させること。** `findPartnerHints` は
 *   `library.find(e => e.name === name)` で**完全一致**で引くので、別名（括弧の前だけ）では
 *   **黙って候補から落ちる**（エラーも出ない）。v1541 で `'ヨードメタン'` と書いて実際に踏んだ
 *   （RXF23 が「札が出ない」で赤）。 */
const PARTNER_CANDIDATES = ['エタノール', 'メタノール', '酢酸', 'グリセリン', 'フェノール', 'ホルムアルデヒド',
    'ヨードメタン（ヨウ化メチル）'];

/* 相手を呼び出す札の目印（v1420 → v1664・I-0150）。**セレクタは1か所** —— テストと実装が同じものを見る。
 * ⚠ v1663 までは「相手の分子が要る反応」の `<details>` に**畳んで別に**並べていた。これは試薬パレットが
 *   あった頃の、モーダルの高さを抑えるための対策の名残。ユーザー（2026-09-25）:「他の分子を呼び出すか
 *   どうかより、反応の仕組みの方が重要。付加反応なら塩素付加と酢酸付加に本質的な違いはない」
 *   ⇒ いまは畳まず、反応の一覧の中に**反応ルールの並び順**で混ぜて置く（呼び出さない反応と区別しない） */
const PARTNER_HINTS_SEL = '#reaction-actions button[data-partner]';

/**
 * 反応の一覧を割る2つの節の見出し（v1423・DESIGN_reaction_execution.md §12）。
 *
 * 軸は「**1つ前の物質を変化させたという文脈の続きかどうか**」（ユーザーの言葉・2026-08-20）。
 * ⚠ 「分子を変えるか変えないか」で割ってはいけない —— それだと
 *   「↩ 反応前に戻す」（分子を変える）だけが振り返りの側から出ていってしまう。
 *
 * 文言は**1か所**（テストと実装が同じものを見る。PARTNER_HINTS_SEL と同じ約束）。
 */
const RX_SECTION_NEXT = 'この分子にできること';
const RX_SECTION_LAST = 'いま起きた反応';
const RX_UNDO_POINTER = '↩ 反応前に戻す は画面下の帯にあります（この画面を閉じても押せます）。';

/* ==========================================================================
 * ★ **簡易版であることを、その場で言う**（v1540）。
 *
 * ⓵ ユーザーの決め:「**嘘でいいので、結合が切れて、別な原子と手を結びなおすようにしますか、
 *   ただし本当は…というスタンスで、反応機構を用意する**」
 *
 * ⚠⚠ **だから文言は2種類に分ける。** 実測すると、反応ルール **64本のうち機構を持つのは13本だけ**。
 *   機構の無い 51本で「本当は違う」とだけ言うと、**行き先の無い約束**になる
 *   ＝「では本当はどうなのか」を確かめる先が画面のどこにも無い。
 * ⚠ 文は**先生の声掛け**にする。⛔ 実装の経緯や機能の説明は書かない。
 * ========================================================================== */
const RX_MORPH_NOTE = 'アニメーションは、どの手が切れてどの手とつながるかだけを見せた図です。';
const RX_MORPH_NOTE_MECH = RX_MORPH_NOTE +
    '本当はどう動くのか、下の「⚗ この反応の機構を見る」で見てみよう。';

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
    ['dehydration_anhydride', 'hydrolysis_anhydride'],
    /* ★ 分子間脱水 ⇄ 酸無水物の加水分解（v1501）。⚠ **表の並びに意味がある** ——
     * `reverseRuleIdOf` は最初に当たった組を返すので、`hydrolysis_anhydride` の帰りは
     * 上の行の `dehydration_anhydride`（分子内）のまま変わらない。
     * ★ ここで足しているのは**行きの側だけ**（酢酸2分子 → 無水酢酸 のあとに
     * 「🔁 逆向きの反応をする」が出る）。⚠ 無水物から戻るときに分子内・分子間の
     * どちらを名乗るかは**図を見ないと決められない**（環状なら分子内）ので、
     * 帰り側の宣言は増やさない。 */
    ['dehydration_anhydride_inter', 'hydrolysis_anhydride']
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
        copyAtomMarks(na, a);   // 電荷（I-3）を落とさない
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
    /* ★ いまのキャンバスで、もう2分子にまたがる箇所がある反応は、呼ぶ札を出さない（I-0130）。
     *   相手がすでに居るのに札を押すと、2つ目の相手を呼んでしまう（重合・縮合重合・加硫の入口は元から同じ見張りを持つ）。
     *   その反応は反応の一覧からそのまま押せる */
    const comp = new Map();
    (() => {
        const adj = new Map(mol.atoms.map(a => [a.id, []]));
        mol.bonds.forEach(b => { if (adj.has(b.atomId1) && adj.has(b.atomId2)) { adj.get(b.atomId1).push(b.atomId2); adj.get(b.atomId2).push(b.atomId1); } });
        let k = 0;
        mol.atoms.forEach(a => {
            if (comp.has(a.id)) return;
            const st = [a.id]; comp.set(a.id, k);
            while (st.length) { const c = st.pop(); adj.get(c).forEach(n => { if (!comp.has(n)) { comp.set(n, k); st.push(n); } }); }
            k++;
        });
    })();
    const alreadyCross = new Map();
    const canAlready = (rule) => {
        if (alreadyCross.has(rule.id)) return alreadyCross.get(rule.id);
        let v = false;
        try {
            v = (rule.detect(mol) || []).some(sv => Array.isArray(sv) &&
                new Set(sv.filter(id => comp.has(id)).map(id => comp.get(id))).size >= 2 &&
                (!baseIds || sv.some(id => baseIds.has(id))));
        } catch (e) { v = false; }
        alreadyCross.set(rule.id, v);
        return v;
    };
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
            if (canAlready(rule)) { seenRules.add(rule.id); return; }
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
    findAddCoPolymerHints(game, baseIds, ruleIds, seenRules, hits);
    findVulcanizePartnerHints(game, baseIds, ruleIds, seenRules, hits);
    return hits;
}

/* ==========================================================================
 * ★ 加硫の入口（I-0076・2026-09-23）。ユーザーの報告「重合したあと加硫が出ない。理由も見えない」。
 *
 * 加硫は**2本の鎖のあいだ**に橋を架ける（`vulcanizablePairs` の注記）ので、鎖が1本だけでは
 * 箇所が0 ＝ 反応の一覧に出ない。理由は硫黄の瓶の `miss` にしか書いていなかった。
 * ★ ここでは縮合重合の入口（`findCoPolymerHints`）と同じ3点セットに乗せて、
 *   「もう1本鎖を呼び出す → 加硫」の札を出す。呼ぶ名前は `ポリ○○`（`buildPolymerByName`
 *   が単量体3個を 1,4-付加重合して作る。I-0075）。
 * ⚠ 呼ぶ鎖は、いまの鎖と**同じ高分子**を優先する（正準コードで一致を見る）。
 *   一致しなければ Cl を含むならポリクロロプレン、それ以外はポリイソプレン（天然ゴム）。
 * ⚠ 出るかどうかを決めるのは `vulcanization.detect`（化学の判定）で、名前ではない。
 * ========================================================================== */
/* ★ 付加の共重合（SBR・NBR）の入口（I-0135・2026-09-25）。参考書の「アプリで試す」がスチレン（またはアクリロニトリル）を
 *   呼んだところから、相手の 1,3-ブタジエンを呼んで共重合まで届くようにする。
 *   ⚠ 形は縮合重合の入口（findCoPolymerHints）と同じ: **組の表は探す範囲だけ**で、出すかどうかは
 *   `copolymerization.detect`（2種類以上の単量体が並んでいるか）が決める。相手は1つ呼ぶだけ（1：1 で2種類がそろう）。
 *   ⚠ 組にしてあるのは順番のため。1,3-ブタジエンから見ると相手が2つあり、表の先の組（スチレン ＝ SBR）が出る。
 *   NBR の入口はアクリロニトリルから（参考書の app: は summon=アクリロニトリル）。 */
const ADD_COPOLYMER_RULE = 'copolymerization';
const ADD_COPOLYMER_PAIRS = [
    ['スチレン', '1,3-ブタジエン'],        // スチレン-ブタジエンゴム（SBR）
    ['アクリロニトリル', '1,3-ブタジエン']  // アクリロニトリル-ブタジエンゴム（NBR）
];

function findAddCoPolymerHints(game, baseIds, ruleIds, seenRules, hits) {
    if (seenRules.has(ADD_COPOLYMER_RULE)) return;
    if (ruleIds && !ruleIds.includes(ADD_COPOLYMER_RULE)) return;
    const rule = REACTION_RULES.find(r => r.id === ADD_COPOLYMER_RULE);
    if (!rule || rule.info) return;
    const mol = game.userMolecule;
    const base = new Molecule();
    copyMoleculeInto(base, mol, baseIds, 0);
    const selfName = game.lookupCompoundName ? game.lookupCompoundName(base) : null;
    if (!selfName) return;
    // ⚠ もう2種類並べてある人には出さない（押せる状態なのに「呼びなさい」は案内ではない）
    try { if (rule.detect(mol).length > 0) return; } catch (e) { return; }
    const library = game.getCompoundLibrary() || [];
    const names = ADD_COPOLYMER_PAIRS.filter(p => p.includes(selfName)).map(p => p.find(n => n !== selfName));
    for (const name of names) {
        const entry = library.find(e => e.name === name);
        if (!entry) continue;
        // 試算は実際に呼び出されるもの（ライブラリの分子）を、summonMolecule と同じ「右へ2マス」に置いて組む
        const trial = new Molecule();
        const mine = copyMoleculeInto(trial, mol, baseIds, 0);
        const theirs = new Set();
        const maxX = Math.max(...trial.atoms.map(a => a.x), 0);
        const minX = Math.min(...entry.mol.atoms.map(a => a.x), 0);
        copyMoleculeInto(trial, entry.mol, null, maxX - minX + 84).forEach(id => theirs.add(id));
        let sites = [];
        try { sites = rule.detect(trial) || []; } catch (e) { continue; }
        const crossing = sites.filter(st => Array.isArray(st) && st.some(x => mine.has(x)) && st.some(x => theirs.has(x)));
        if (!crossing.length) continue;
        seenRules.add(ADD_COPOLYMER_RULE);
        hits.push({ name, label: rule.label, ruleId: ADD_COPOLYMER_RULE, siteCount: crossing.length });
        return; // 1つの反応につき候補は1つまで（findPartnerHints の約束）
    }
}

const VULCANIZE_RULE = 'vulcanization';
const VULCANIZE_PARTNERS = ['ポリイソプレン', 'ポリブタジエン', 'ポリクロロプレン'];

function findVulcanizePartnerHints(game, baseIds, ruleIds, seenRules, hits) {
    if (seenRules.has(VULCANIZE_RULE)) return;
    if (ruleIds && !ruleIds.includes(VULCANIZE_RULE)) return;
    const rule = REACTION_RULES.find(r => r.id === VULCANIZE_RULE);
    if (!rule || rule.info) return;
    const mol = game.userMolecule;
    // もう押せる人には出さない（§15 と同じ約束）
    try { if (rule.detect(mol).length > 0) return; } catch (e) { return; }
    const base = new Molecule();
    copyMoleculeInto(base, mol, baseIds, 0);
    // 鎖（両端の R）に C=C が残っているときだけ ＝ 単量体やふつうのアルケンには出さない
    if (!base.atoms.some(a => a.element === 'R')) return;
    if (!base.bonds.some(b => b.type === 2)) return;
    let order = VULCANIZE_PARTNERS.slice();
    const code = canonicalCode(base);
    const built = new Map();
    const build = (n) => {
        // 登録済み（v1627・I-0120）ならライブラリの図、無ければ単量体から作る
        if (!built.has(n)) built.set(n, game.resolveCompound(n) ||
            (typeof game.buildPolymerByName === 'function' ? game.buildPolymerByName(n) : null));
        return built.get(n);
    };
    const same = order.find(n => { const b = build(n); return b && canonicalCode(b.mol) === code; });
    const fallback = base.atoms.some(a => a.element === 'Cl') ? 'ポリクロロプレン' : 'ポリイソプレン';
    order = [...new Set([same, fallback].filter(Boolean))];
    for (const name of order) {
        const entry = build(name);
        if (!entry) continue;
        const trial = new Molecule();
        const mine = copyMoleculeInto(trial, mol, baseIds, 0);
        const maxX = Math.max(...trial.atoms.map(a => a.x), 0);
        const minX = Math.min(...entry.mol.atoms.map(a => a.x), 0);
        const theirs = copyMoleculeInto(trial, entry.mol, null, maxX - minX + 84);
        let sites = [];
        try { sites = rule.detect(trial) || []; } catch (e) { continue; }
        const crossing = sites.filter(s => Array.isArray(s) &&
            s.some(x => mine.has(x)) && s.some(x => theirs.has(x)));
        if (!crossing.length) continue;
        seenRules.add(VULCANIZE_RULE);
        hits.push({ name, label: rule.label, ruleId: VULCANIZE_RULE, siteCount: crossing.length });
        return; // 1つの反応につき候補は1つまで
    }
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
/* ★ 2026-09-01（v1491）に `ring_opening_polymerization`（ε-カプロラクタム → ナイロン6）を追加。
 *   ⚠ **ここに入れてよい形である**ことを確かめてから足した ―― 相手は「自分と同じ分子」で、
 *   別の単量体も水も要らない（§21-3 (b)「入口は SELF_PARTNER_RULES に1行足すだけ」）。 */
// ★ alkyne_trimerization（アセチレン3分子 → ベンゼン）も「自分をあと2つ呼ぶ」で届く（2026-09-24・参考書の『アプリで試す』のため・I-0126）
const SELF_PARTNER_RULES = ['addition_polymerization', 'alkyne_polymerization', 'alkyne_trimerization', 'diene_polymerization',
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
    beta: 'β-D-グルコース',
    alpha: 'α-D-グルコース'
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
    const ids = t.atoms.map(a => copyAtomMarks(ref.addAtom(a.element, a.x, a.y), a).id);
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

/* ==========================================================================
 * ★★ 握手のつなぎ替え（v1540・ユーザー発注 2026-09-12）
 *
 * **ユーザーの言葉**（そのまま）:
 * > **価標を中心で割り、切れた手を旋回させて別な原子の手とつなぐ**
 * > **握手していた → 離した → べつな人と握手した**
 *
 * ★★ **この描き方の芯**: **価標を中点で割ると、半分ずつが「その原子の手」になる。**
 *   → **どの瞬間も、原子の手の数＝原子価が変わらない。**
 *   ⛔ 手が宙に浮いた別物になったり、結合本数が一瞬おかしくなったりしない。
 *   ⚠ **手は必ずどちらかの原子に生えたまま**（`handshakeHandsAt` がその1点を担保し、
 *     テスト RX4b がすべての t で数える）。
 *
 * ⓵ **以前のやり方**（v1539 まで）: 切れる結合を `1−t` でフェードアウトし、
 *   できる結合を `t` でフェードインしていた ＝ **結合ごと消えて別の場所に現れる**ので、
 *   どこが切れてどこがつながったのかが読めなかった（ユーザー申し立て）。
 *
 * ★ **三段の割り方**（下の窓は 0→1 の進み具合。実測して決めた。DESIGN_reaction_execution.md §28-4）:
 *   ① 握手していた   0.00–0.14 … 反応前のまま静止
 *   ② 離した         0.14–0.42 … 価標が中点で割れ、半分ずつがそれぞれの原子に残って縮む
 *      （宙）        0.42–0.48 … ⚠ **どこにも向いていない時間。短く。**
 *      ⓘ 長いほど分かりやすいが、長いほど「切れてから漂ってつながる」という誤解が強くなる。
 *        その誤解は置換の立体反転やマルコフニコフ則を説明できなくするので、あとで剥がすのが高い。
 *   ③ 旋回           0.48–0.86 … 手が別の原子の方へ回る（原子の移動もここ）
 *      握手した      0.86–1.00 … 半分どうしが伸びて合流する
 * ========================================================================== */
const HS_HOLD_END  = 0.14;
const HS_PART_END  = 0.42;
const HS_FLOAT_END = 0.48;
const HS_SWING_END = 0.86;
/** 反応の再生時間（ms）。⚠ 3段に割ったので v1539 の 800ms では①②が読めない（実測） */
const HS_DURATION  = 1500;
/** 結合の変化を含まない段（並ぶだけ・折りたたむだけ）は今までどおりの尺で動かす */
const HS_PLAIN_DURATION = 800;
/** 再生の終わりに、写しにだけ置いた副生成物が薄れる尺（v1556） */
const RX_FADE_MS = 500;
/** 同じ相手・副生成物がこの数以上なら1つだけ描いて「×n」を添える（v1560） */
const RX_FOLD_MIN = 3;
/** ★ 反応の前の置き直し（相手が現れる・反応する H が大きな丸になる・環が回る）の尺と、そのあとの一呼吸（v1556） */
const RX_PRE_MS = 500;
const RX_HOLD_MS = 350;
/** 反応のあと、大きくした H が元の大きさに戻り、副生成物が薄れる尺 */
const RX_POST_MS = 500;
/** 大きくした H を親から離して置く長さ（丸の半径 10 どうしが重ならない。標準の結合は 42） */
const RX_BIG_H_LEN = 28;
/* ★ 環を回すとき、相手の置き場が避ける「掃いた跡」を何コマぶん見るか（v1584・`planEquation` ④）。
 * ⚠ 回す角は π/3（60°）の倍数なので 6 コマ ＝ 10° ごと。★ 半径 10 の丸が 10° で進む長さは
 *   環の外側（中心から 70 ほど）でも 12px ほど ＝ 丸1つぶんより細かい ＝ すり抜けが起きない。 */
const RX_SWEEP_STEPS = 6;
/* ★ 反応する H の道筋を曲げる幅の候補と、選ぶときに見るコマ数（v1556。物差しは v1584 で実物に替えた）。
 * ⚠ **小さいほうから試して、重なりが 0 になった時点で止める**（いちばん小さい曲げを選ぶ）。 */
const RX_BEND_AMPS = [20, -20, 32, -32, 44, -44, 56, -56, 70, -70];
/* ★ 粗い候補で 0 にならなかったときだけ見る、細かい足し引き（`RX_BEND_MAX` を超えては曲げない） */
const RX_BEND_FINE = [6, -6, 12, -12, 18, -18, 26, -26];
const RX_BEND_MAX = 96;
/* ⚠⚠ **見張り（`RXH1` の `bigHydrogenOverlaps(plan, 120)`）と同じ刻み**にする ——
 *   0〜3 を 120 で割ると 0.025 刻みなので、1〜2 の1段は **40**。
 *   ⓵ 実測: 24（＝ 0.042 刻み）だと **T=1.65 の1コマだけの重なりを飛び越して**しまい、
 *      「探索は 0 と答えたのに見張りは 1 と数える」が3件（フェノールの臭素化・メタンの塩素化・ジアゾ化）。
 *   ⚠ 細かくすればよいわけでもない（60 にするとジアゾ化が 2 に増える）—— **同じ刻みが最良**。 */
const RX_BEND_SAMPLES = 40;
/* ★ 曲げを選び直す周回の数。⚠ 相手はほかの反応する H の手でもあるので、1周では最善にならない */
const RX_BEND_PASSES = 2;
/* ★ 原子の丸に食い込む重なりは、手の線に丸がかかるより重く数える（曲げを選ぶときだけの重み） */
const RX_BEND_ATOM_COST = 4;
/* ★ 離したときに手が引く長さ（座標の単位。標準の結合は 40）。
 * ⚠ **割合で引かない**（実測）—— 原子の丸で両端 10 ずつ隠れるので、40 の結合で目に見える線は
 *   半分あたり 10 しかない。6割も引くと**線が消えて印の丸だけ**になり、「手」に見えなくなった。
 * ⚠ 0 にはしない ＝ 手は必ず残る（消えたら「価標が半分ずつ残る」という芯が崩れる）。 */
const HS_PULL = 5;
/** 原子ラベルを避ける縮み（game.renderBond の offsetStart と同じ値。ずらすと線が丸にめり込む） */
const HS_INSET = 10;
/** 離しても必ず残す、目に見える手の長さ */
const HS_MIN_HAND = 4;
/** 多重結合の平行線の位置と太さ（⚠ game.renderBond と同じ値。変えるとモーフィングだけ線がずれる） */
const HS_LANE_OFF = { 1: [0], 2: [-5, 5], 3: [-6.5, 0, 6.5] };
const HS_LANE_W   = { 1: [3], 2: [2.5, 2.5], 3: [1.8, 2.5, 1.8] };
/** 地の線の色（game.renderBond の strokeColor と同じ） */
const HS_INK  = [255, 255, 255, 0.4];
/* ★ **新しい色を作らない。**前後比較（`renderCompare`）で色の約束はもう決まっている:
 *   切れた側＝オレンジ（--neon-orange）／できた側＝シアン（--neon-blue）。
 *   ⚠ 離れた手の先をオレンジ、握手した所をシアンにすると、
 *     「🔍 反応の前後を見る」を開いたときの図と**同じ色が同じ意味**になる。 */
const HS_ORANGE = [255, 165, 2, 0.95];   // --neon-orange #ffa502
const HS_CYAN   = [0, 242, 254, 0.95];   // --neon-blue   #00f2fe

const hsClamp = v => Math.max(0, Math.min(1, v));
const hsSmooth = v => v * v * (3 - 2 * v);
/** a→b の窓で 0→1 になめらかに進む */
const hsEase = (t, a, b) => hsSmooth(hsClamp((t - a) / (b - a)));
const hsLerp = (a, b, u) => a + (b - a) * u;
/** 角度の補間は必ず近い方まわり（⚠ 素の線形補間だと 350°→10° で長い方を1周する） */
const hsLerpAngle = (a, b, u) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * u;
};
const hsAngleGap = (a, b) => Math.abs(hsLerpAngle(a, b, 1) - a);
const hsMix = (c1, c2, u) => [
    hsLerp(c1[0], c2[0], u), hsLerp(c1[1], c2[1], u),
    hsLerp(c1[2], c2[2], u), hsLerp(c1[3], c2[3], u)];
const hsRgba = c =>
    `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(c[3] * 1000) / 1000})`;

/* ==========================================================================
 * ★★ 反応の相手をキャンバスに呼ぶ（v1553・ユーザー仕様 2026-09-14）
 *
 * > **置換反応では、Cl2を召喚するようにする**
 * > **急に出現する原子がないか調べれば、同様の事例を探せるはずです。
 * >   現状では急に原子が入れ替わったようにしか見えないのが問題です**
 *
 * ⚠ **直す前**: `apply` は付く原子（Cl・Br・O・NO₂…）を**何も無い所に**足していた。
 *   握手のつなぎ替えは「反応前にいた原子の手」しか旋回させられないので、
 *   付く原子はフェードインで湧いて出た（実測: 全 74 本を回して `computeDiff().addedAtoms` を数えた）。
 *
 * ★ **やり方（見た目だけ）**: `apply` が足した原子を**そのまま相手の分子の一員として**
 *   反応前の図（`before` の写し）に置く ＝ 付く原子の id は前後で同じなので、
 *   その原子の手が「相手の分子の中の結合」から「基質との結合」へ旋回する。
 *   相手の分子で余る原子（Cl₂ の片方・HNO₃ の -OH）は**本当にキャンバスへ残す**（`fromReaction`）
 *   ＝ 自動水素で HCl・H₂O として描かれる（反応式の右辺の副生成物）。
 * ⛔ `apply`・`detect`・正準コードの判定は1行も変えていない（足した原子の結合は `apply` のまま）。
 *
 * 形は4つ:
 *   'X2-sub'  … X₂ → R-X ＋ HX（付いた X 1個ごとに相方の X を1個残す）
 *   'X2-add'  … X₂ → 付加（付いた X を2個ずつ X-X に組む。余りなし）
 *   'as-is'   … HX・H₂O（付いた重原子1個がそのまま相手の分子。余りなし）
 *   'plus-OH' … HNO₃・H₂SO₄（付いた基の中心に -OH を1本足して相手にする。-OH は H₂O として残る）
 * ========================================================================== */
const PARTNER_SUMMON = {
    chlorinate_alkane: 'X2-sub',
    aromatic_halogenation: 'X2-sub',
    bromination_activated_ring: 'X2-sub',
    add_cl2: 'X2-add',
    add_br2: 'X2-add',
    ring_opening_addition: 'X2-add',
    add_cl2_benzene_ring: 'X2-add',
    add_hcl: 'as-is',
    add_hbr: 'as-is',
    add_hi: 'as-is',
    add_water: 'as-is',
    hydrolysis_ester: 'as-is',
    hydrolysis_anhydride: 'as-is',
    hydrolysis_amide: 'as-is',
    hydrolysis_glycoside: 'as-is',
    aromatic_nitration: 'plus-OH',
    aromatic_sulfonation: 'plus-OH'
};

/**
 * `apply` のあとに呼ぶ。`before`（反応前の写し）へ相手の分子を足し、余る原子を `mol` に残す。
 * @returns 足したかどうか（false ＝ 今までどおりの見え方）
 */
function summonReactionPartner(ruleId, before, mol) {
    const shape = PARTNER_SUMMON[ruleId];
    if (!shape) return false;
    const G = (typeof GRID_SIZE !== 'undefined') ? GRID_SIZE : 42;
    const LIMIT = (typeof CANVAS_LIMIT !== 'undefined') ? CANVAS_LIMIT : 5000;
    const had = new Set(before.atoms.map(a => a.id));
    const added = mol.atoms.filter(a => !had.has(a.id) && a.element !== 'H');
    if (!added.length) return false;
    const addedIds = new Set(added.map(a => a.id));
    const inner = mol.bonds.filter(b => addedIds.has(b.atomId1) && addedIds.has(b.atomId2));
    // 付いた原子を「基」ごとに分ける（付いた原子どうしの結合でつながったもの）。根 ＝ 基質とつながる原子
    const groups = [];
    const seen = new Set();
    added.forEach(a => {
        if (seen.has(a.id)) return;
        const ids = [a.id]; seen.add(a.id);
        for (let i = 0; i < ids.length; i++) {
            inner.forEach(b => {
                const o = b.atomId1 === ids[i] ? b.atomId2 : b.atomId2 === ids[i] ? b.atomId1 : null;
                if (o && !seen.has(o)) { seen.add(o); ids.push(o); }
            });
        }
        const atoms = ids.map(id => mol.atoms.find(x => x.id === id));
        const root = atoms.find(x => mol.bonds.some(b =>
            (b.atomId1 === x.id && had.has(b.atomId2)) || (b.atomId2 === x.id && had.has(b.atomId1)))) || atoms[0];
        groups.push({ atoms, root });
    });
    if (shape === 'X2-add' && added.length % 2 !== 0) return false;
    if (shape !== 'plus-OH' && groups.some(gr => gr.atoms.length !== 1)) return false;

    // 置き場所: 反応前・反応後どちらの図よりも右（重ならない）。高さは付いた先の平均
    const heavyAll = before.atoms.concat(mol.atoms).filter(a => a.element !== 'H');
    let cx = Math.round((Math.max(...heavyAll.map(a => a.x)) + G * 3) / G) * G;
    const anchorsY = added.map(a => a.y);
    const y0 = Math.round(anchorsY.reduce((s, v) => s + v, 0) / anchorsY.length / G) * G;
    const atomsOut = [], bondsOut = [], leftovers = [];
    const put = (a, x, y) => atomsOut.push({ id: a.id, element: a.element, x, y, charge: a.charge || 0 });
    const leave = (element, x, y, partnerId) => leftovers.push({ element, x, y, partnerId });

    if (shape === 'X2-add') {
        for (let i = 0; i < added.length; i += 2) {
            put(added[i], cx, y0); put(added[i + 1], cx + G, y0);
            bondsOut.push({ atomId1: added[i].id, atomId2: added[i + 1].id, type: 1 });
            cx += G * 3;
        }
    } else if (shape === 'X2-sub') {
        /* ★ 相手（X−X）は**付いた X の外側**に置く（v1556・ユーザー指示「反応相手のCl2などが近づくスペースも必要です」）。
         *   付いた X は `apply` が空いた向き（`freeSpotAround`）に置いている ＝ その向きの延長に X−X を並べると、
         *   相手は空いた側から近づき、HX になる X（遠い方）にいちばん近い H が「離れる手」に選ばれる。
         * ⚠ 並べる場所が他の原子に近すぎれば遠くへずらし、それでも無理なら今までどおり右に置く。
         *   `window.PARTNER_LOCAL = false` で今までの置き方に戻る（否定対照） */
        const local = typeof window === 'undefined' || window.PARTNER_LOCAL !== false;
        const others = heavyAll.slice();
        const segsAll = [];
        [before, { atoms: mol.atoms, bonds: mol.bonds }].forEach(s => {
            const pos = new Map(s.atoms.filter(a => a.element !== 'H').map(a => [a.id, a]));
            s.bonds.forEach(b => { const p = pos.get(b.atomId1), q = pos.get(b.atomId2); if (p && q) segsAll.push([p, q]); });
        });
        // ★ 水素の位置も避ける（v1556。反応する H は大きな丸になって伸びる）
        const hPts = [before, mol].flatMap(s => {
            const m = new Molecule();
            s.atoms.filter(a => a.element !== 'H').forEach(a => m.atoms.push(copyAtomMarks(new Atom(a.id, a.element, a.x, a.y), a)));
            s.bonds.forEach(b => { if (m.atoms.some(x => x.id === b.atomId1) && m.atoms.some(x => x.id === b.atomId2)) m.bonds.push(new Bond(b.atomId1, b.atomId2, b.type)); });
            return m.calculateHydrogens();
        });
        const clear = p => others.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= G * 1.25) &&
            hPts.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= G * 1.1) &&
            segsAll.every(([a, b]) => pointSegmentDistance(p, a, b) >= G * 0.75);
        groups.forEach(gr => {
            const nb = mol.bonds.map(b => (b.atomId1 === gr.root.id ? b.atomId2 : b.atomId2 === gr.root.id ? b.atomId1 : null))
                .find(id => id && had.has(id));
            const s = nb && mol.atoms.find(a => a.id === nb);
            let spot = null;
            if (local && s) {
                const L = Math.hypot(gr.root.x - s.x, gr.root.y - s.y) || 1;
                const ux = (gr.root.x - s.x) / L, uy = (gr.root.y - s.y) / L;
                for (let k = 2; k <= 6 && !spot; k += 0.5) {
                    const a = { x: s.x + ux * G * k, y: s.y + uy * G * k };
                    const b = { x: s.x + ux * G * (k + 1), y: s.y + uy * G * (k + 1) };
                    if (clear(a) && clear(b)) spot = { a, b };
                }
            }
            if (spot) {
                put(gr.root, spot.a.x, spot.a.y);
                leave(gr.root.element, spot.b.x, spot.b.y, gr.root.id);
                others.push(spot.a, spot.b);
                segsAll.push([spot.a, spot.b]);
            } else {
                put(gr.root, cx, y0);
                leave(gr.root.element, cx + G, y0, gr.root.id);
                cx += G * 3;
            }
        });
    } else if (shape === 'as-is') {
        groups.forEach(gr => { put(gr.root, cx, y0); cx += G * 2; });
    } else {
        groups.forEach(gr => {
            cx += G;
            const dx = cx - gr.root.x, dy = y0 - gr.root.y;
            const moved = gr.atoms.map(a => ({ a, x: a.x + dx, y: a.y + dy }));
            moved.forEach(m => put(m.a, m.x, m.y));
            inner.filter(b => gr.atoms.some(a => a.id === b.atomId1))
                .forEach(b => bondsOut.push({ atomId1: b.atomId1, atomId2: b.atomId2, type: b.type }));
            // -OH は根から空いている向きへ1本（基の原子と 0.65 マス以内に重ねない）
            const dirs = [[0, G], [0, -G], [G, 0], [-G, 0]];
            const free = dirs.find(([ox, oy]) => moved.every(m =>
                Math.hypot(m.x - (cx + ox), m.y - (y0 + oy)) >= G * 0.65)) || dirs[0];
            leave('O', cx + free[0], y0 + free[1], gr.root.id);
            cx += G * 3;
        });
    }
    const all = atomsOut.concat(leftovers);
    if (all.some(p => Math.abs(p.x) > LIMIT || Math.abs(p.y) > LIMIT)) return null;

    /* ★★ v1560: 余り（HCl・H₂O）は**キャンバスに残さず、再生の写しにだけ置いて薄れさせる**
     *   （ユーザー「副生成物は薄れて消える形にそろえ」。v1556 の 26 本と同じ形）。
     *   ⚠ v1553 は `before` と `mol` を書き換えていた。いまは**どちらも触らず**写しを返す
     *   ＝ キャンバス・判定・Undo・lastReaction.before は apply のまま */
    const animBefore = { atoms: before.atoms.map(a => ({ ...a })), bonds: before.bonds.map(b => ({ ...b })) };
    const animAfter = {
        atoms: mol.atoms.map(a => ({ id: a.id, element: a.element, x: a.x, y: a.y, charge: a.charge || 0 })),
        bonds: mol.bonds.map(b => ({ atomId1: b.atomId1, atomId2: b.atomId2, type: b.type }))
    };
    atomsOut.forEach(p => animBefore.atoms.push(p));
    bondsOut.forEach(b => animBefore.bonds.push(b));
    const transient = [];
    leftovers.forEach((l, k) => {
        const id = `rxsum_${k}`;
        animBefore.atoms.push({ id, element: l.element, x: l.x, y: l.y, charge: 0 });
        animBefore.bonds.push({ atomId1: l.partnerId, atomId2: id, type: 1 });
        animAfter.atoms.push({ id, element: l.element, x: l.x, y: l.y, charge: 0 });   // 自動水素で HCl・H₂O
        transient.push(id);
        /* ★ HNO₃ の -OH の H は**写しに明示で置く**。N に単結合の O が2つ付くと、自動水素は
         *   ニトロ基の O⁻ として読んで H を生やさない（実測: HNO₃ が H 無しで描かれ、
         *   反応後の H₂O の H が1つ急に出た）。`withMorphHydrogens` が明示の H も自動水素と同じに扱う */
        const root = atomsOut.find(p => p.id === l.partnerId);
        if (shape === 'plus-OH' && root && root.element === 'N') {
            const L = Math.hypot(l.x - root.x, l.y - root.y) || 1;
            animBefore.atoms.push({ id: `summonH_${id}`, element: 'H',
                x: l.x + 16 * (l.x - root.x) / L, y: l.y + 16 * (l.y - root.y) / L, charge: 0 });
            animBefore.bonds.push({ atomId1: id, atomId2: `summonH_${id}`, type: 1 });
        }
    });
    return { before: animBefore, after: animAfter, transient, renames: new Map(), counts: null, hGap: 0,
        foldedPartnerIds: [], foldedByproductIds: [], foldedH: 0 };
}

/* ==========================================================================
 * ★★ 反応式ぶんの相手と副生成物を**アニメの写しにだけ**置く（v1556・ユーザー決定 2026-09-15）
 *
 * > 「O、Naはその案で」（酸化剤は仮の [O] を呼んで握手させる。NaOH のように粒で出せるものは分子として呼ぶ）
 * > 「ジアゾ化、アセチル化もそれぞれ、NaNO2、無水酢酸 を呼び出せば解決する気がします」
 * > 「燃焼は仮のO または O2 で」
 *
 * ⚠ **v1553 の表（`PARTNER_SUMMON`）とは置き場所が違う**:
 *   あちらは相手を `lastReaction.before` に足し、余りを本当にキャンバスへ残す（HCl・H₂O）。
 *   こちらは**再生の写し（`lastReaction.anim`）にだけ**相手と副生成物を置き、
 *   副生成物は再生の終わりに**薄れて消える**（`transient`）。
 *   ★ 理由: この表の反応の caption は、副生成物（NaCl・N₂・CO₂・水）を
 *     「図には描いていません」「図から外しました」と言っている。
 *     ⚠ 粒（Na⁺・Cl⁻）を本当に残すと、次の反応の `nearestCounterIon`・`saltMetalPairs` が
 *     それを相方として掴む（見せ方のために化学の判定を変えることになる）。
 *   ＝ **キャンバスに残る分子・判定・Undo・前後比較の図は1つも変わらない**。変わるのは再生だけ。
 *
 * ★ 係数は**表に書かない**。反応ごとに「呼べる分子」「出ていく分子」の種類だけを書き、
 *   **数は原子の収支から解く**（`solveEquation`）。同じルールでも題材で係数が変わるため
 *   （ヨードホルム: エタノールは I₂ 4・NaOH 6、アセトンは I₂ 3・NaOH 4）。
 * ⚠ `apply`・`detect` は1行も変えていない。例外は `reuse` の id の付け替えだけで、
 *   これは「消えた C と湧いた C を同じ原子として見せる」ための**名前の付け替え**
 *   （元素・結合・電荷は変えない ＝ 正準コードは同じ。RXP3 が否定対照つきで見る）。
 * ========================================================================== */
/* 分子の型。座標はマス（GRID）単位。[元素, x, y, 電荷, 印] 。
 * 印 bare … 自動水素を生やさない（[O] は水ではない・Na は金属・Na₂SO₃ の S は空き価標が残る）
 * 印 label … 再生の中で原子の文字をこれに差し替える */
const RX_SPECIES = {
    '[O]': { atoms: [['O', 0, 0, 0, { bare: true, label: '[O]' }]], bonds: [] },
    O2: { atoms: [['O', 0, 0], ['O', 1, 0]], bonds: [[0, 1, 2]] },
    H2O: { atoms: [['O', 0, 0]], bonds: [] },
    I2: { atoms: [['I', 0, 0], ['I', 1, 0]], bonds: [[0, 1, 1]] },
    HCl: { atoms: [['Cl', 0, 0]], bonds: [] },
    /* ★ Na⁺ は OH⁻ の **O 側**に置く（v1560・ユーザー「NaOHについては、Na に OH-のO側がつくほうがよい」）。
     *   結合の無い O⁻ の自動水素は右（0°）に生えるので、Na⁺ を左に置くと「Na ··· O−H」の順になる */
    NaOH: { atoms: [['O', 0, 0, -1], ['Na', -1, 0, 1]], bonds: [] },
    NaNO2: { atoms: [['O', 0, 0], ['N', 1, 0], ['O', 2, 0, -1], ['Na', 3, 0, 1]], bonds: [[0, 1, 2], [1, 2, 1]] },
    NaHCO3: { atoms: [['C', 0, 0], ['O', 0, -1], ['O', -1, 0], ['O', 1, 0, -1], ['Na', 2, 0, 1]],
        bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]] },
    CO2: { atoms: [['O', -1, 0], ['C', 0, 0], ['O', 1, 0]], bonds: [[0, 1, 2], [1, 2, 2]] },
    N2: { atoms: [['N', 0, 0], ['N', 1, 0]], bonds: [[0, 1, 3]] },
    NaCl: { atoms: [['Na', 0, 0, 1], ['Cl', 1, 0, -1]], bonds: [] },
    NaI: { atoms: [['Na', 0, 0, 1], ['I', 1, 0, -1]], bonds: [] },
    KCl: { atoms: [['K', 0, 0, 1], ['Cl', 1, 0, -1]], bonds: [] },
    Na2SO3: { atoms: [['S', 0, 0, 0, { bare: true }], ['O', 0, -1], ['O', -1, 0, -1], ['O', 1, 0, -1],
        ['Na', -2, 0, 1], ['Na', 2, 0, 1]], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]] },
    Na: { atoms: [['Na', 0, 0, 0, { bare: true }]], bonds: [] },
    // ½H₂ ＝ 1分子ぶんの反応で出る水素は原子1個ぶん。明示の H を1つ置いて、再生の終わりに薄れさせる
    H: { atoms: [['H', 0, 0]], bonds: [] },
    /* ★ H₂（v1574・ニトロ基の還元の相手）。重原子が無いので**明示の H 2つを H−H でつなぐ**。
     *   ⚠ 名前の登録（`summonMolecule`）はできない（v1556 の報告）＝ 写しにだけ置く。
     *   間隔は `withMorphHydrogens` ③ が呼ぶ H₂ と同じ 0.7 マス */
    H2: { atoms: [['H', 0, 0], ['H', 0.7, 0]], bonds: [[0, 1, 1]] },
    /* ★ 硫黄 S（v1579・加硫の相手）。**原子1個ずつ**呼ぶ（S₈ の環にはしない。理由は `PARTNER_EQUATIONS.vulcanization`）。
     *   ⚠ `bare` … 結合の無い S に自動水素が2本生えると H₂S に見える */
    S: { atoms: [['S', 0, 0, 0, { bare: true }]], bonds: [] },
    CH3COOH: { atoms: [['C', 0, 0], ['C', 1, 0], ['O', 1, -1], ['O', 2, 0]], bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1]] },
    Ac2O: { atoms: [['C', 0, 0], ['C', 1, 0], ['O', 1, -1], ['O', 2, 0], ['C', 3, 0], ['O', 3, -1], ['C', 4, 0]],
        bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1], [3, 4, 1], [4, 5, 2], [4, 6, 1]] }
};

/* 反応ごとの「呼べる分子（partners）」と「出ていく分子（byproducts）」。
 *   reuse … 消えた原子と湧いた原子を同じ原子として見せる元素（燃焼の C・コルベ・シュミットの Na⁺）
 *   cost  … 種類ごとの重み（燃焼の [O] は O₂ で割り切れないときの端数だけに使いたい）
 *   maxPartners … 呼ぶ分子の数の上限（画面が埋まらないように） */
const PARTNER_EQUATIONS = {
    oxidize_primary: { partners: ['[O]'], byproducts: ['H2O'] },
    oxidize_primary_vigorous: { partners: ['[O]'], byproducts: ['H2O'] },
    oxidize_secondary: { partners: ['[O]'], byproducts: ['H2O'] },
    oxidize_aldehyde: { partners: ['[O]'], byproducts: ['H2O'] },
    // 側鎖が長い・末端が =CH₂ のときは CO₂ まで出ていくので [O] が多く要る（エチルベンゼン 6・1-ブテン 5）
    oxidize_side_chain: { partners: ['[O]'], byproducts: ['H2O', 'CO2'], maxPartners: 8 },
    oxidative_cleavage: { partners: ['[O]'], byproducts: ['H2O', 'CO2'], maxPartners: 8 },
    wacker_oxidation: { partners: ['[O]'], byproducts: [] },
    naphthalene_air_oxidation: { partners: ['O2', '[O]'], byproducts: [], reuse: ['C'], cost: { '[O]': 5 }, maxPartners: 6 },
    combustion: { partners: ['O2', '[O]'], byproducts: [], reuse: ['C', 'O'], cost: { '[O]': 5 }, maxPartners: 16 },
    iodoform: { partners: ['I2', 'NaOH'], byproducts: ['NaI', 'H2O'], maxPartners: 10 },
    neutralize_naoh: { partners: ['NaOH'], byproducts: ['H2O'] },
    neutralize_nahco3: { partners: ['NaHCO3'], byproducts: ['H2O', 'CO2'] },
    react_sodium: { partners: ['Na'], byproducts: ['H'] },
    alkali_fusion: { partners: ['NaOH'], byproducts: ['Na2SO3', 'H2O'] },
    hydrolysis_chlorobenzene: { partners: ['NaOH'], byproducts: ['NaCl', 'H2O'] },
    // 塩はナトリウム塩もカリウム塩もある（酢酸カリウム）。どちらが合うかは収支が選ぶ
    liberate_weak_acid: { partners: ['HCl'], byproducts: ['NaCl', 'KCl'] },
    kolbe_schmidt: { partners: ['CO2'], byproducts: [], reuse: ['Na'] },
    liberate_co2: { partners: ['CO2', 'H2O'], byproducts: ['NaHCO3'] },
    amine_hcl: { partners: ['HCl'], byproducts: [] },
    // ⚠ ジアゾ化は NaNO₂ だけでは収支が合わない（O が2つ余り、H が足りない）＝ **HCl も呼ぶ**
    diazotization: { partners: ['NaNO2', 'HCl'], byproducts: ['NaCl', 'H2O'] },
    diazonium_decompose: { partners: ['H2O'], byproducts: ['N2', 'HCl'] },
    diazo_coupling: { partners: [], byproducts: ['NaCl'] },
    amine_liberate_naoh: { partners: ['NaOH'], byproducts: ['NaCl', 'H2O'] },
    saponification: { partners: ['NaOH'], byproducts: [] },
    williamson_ether: { partners: [], byproducts: ['NaI'] },
    acetylation_anhydride: { partners: ['Ac2O'], byproducts: ['CH3COOH'] },
    /* ★ ニトロ基の還元（v1574・ユーザー決定 2026-09-17「7.進める」）。
     *   瓶は `h2_ni`（水素＋触媒）なので、呼ぶ相手は **H₂**。教科書の実験室の製法（Sn＋HCl）は
     *   caption が言葉で案内している（還元剤を瓶の中身に合わせる ＝ 画面と瓶が食い違わない）。
     *   収支は C₆H₅NO₂ ＋ 3H₂ → C₆H₅NH₂ ＋ 2H₂O（係数は `solveEquation` が解く）。
     *   ⚠ H₂ は「×n」にまとめない（`RX_NO_FOLD`）。3つが N・O・O の別々の原子へ H を渡す */
    reduce_nitro: { partners: ['H2'], byproducts: ['H2O'] },
    /* ★ 加硫（v1579・ユーザー決定 2026-09-17「7.直す」）。v1577 の走査で**急に出る原子が残った最後の1本**
     *   （橋の S が2つ、何も無い所から湧いていた）。瓶は `sulfur` なので、呼ぶ相手は**硫黄 S を原子で2つ**。
     *   ★ S₈ にしない理由: 橋に入るのは2つだけなので、S₈ を呼ぶと**残り6つの行き場**が要る。
     *     S₆ として薄れさせると「S₈ が S₂ と S₆ に割れる」という無い反応を見せ、
     *     全部を橋に入れると図の「代表としてジ（-S-S-）」と食い違う。
     *     高校の反応式は単体の硫黄を **S** と書く（Fe ＋ S → FeS）ので、原子2つがいちばん誤解が少ない。
     *   ⚠ **前後比較の反応式の行は出さない**（`equationRow: false`）。基質はゴムの鎖で、式にすると
     *     C₁₀H₁₆R₂ のように **R が化学式に入る**（重合の端の R を式に並べないのと同じ理由・v1574）。
     *     前後比較の図は他の相手と同じく「前 ＝ 鎖＋呼んだ S」になる。
     *   ⚠ H は合わない（hGap 2）。`apply` は二重結合の相方の炭素に H を1つずつ足す。
     *   ⚠⚠ **v1585 まで、その H を `withMorphHydrogens` ③ が「名前の無い H₂」として呼んでいた**
     *     （動画レーン V130・ユーザー指摘）。**実際の加硫で H₂ は出入りしない**ので、
     *     v1586 で `RX_NO_MORPH_H2` に入れて③を通さないことにした。いまは炭素のそばで
     *     静かに現れるだけ（④）＝ ゴムの鎖がもともと持っている手の描き方の話に戻した。
     *     **生成物は1原子も変わっていない**（変えたのは再生の見せ方だけ） */
    vulcanization: { partners: ['S'], byproducts: [], equationRow: false }
};

/* 「×n」にまとめない相手（v1574）。1個ずつ基質の決まった原子と握手するもの。
 *   [O] … 酸化される原子へ1つずつ／H2 … ニトロ基の還元で N・O・O へ別々に H を渡す
 *   （まとめると、描かなかった H₂ の H が `withMorphHydrogens` ③ で名無しの H₂ として湧き、札と数が食い違う） */
const RX_NO_FOLD = new Set(['[O]', 'H2']);

/* ★★ **余った手を H₂ として呼ばない反応**（v1586・発注書 K。ユーザー指摘 V130）。
 *
 * ⚠ `withMorphHydrogens` ③ は「反応後に増えた自動水素」が2つ余ると、
 *   出どころとして **H₂ を1分子** 写しに置く。ふつうはそれで正しい（ニトロ基の還元）が、
 *   **加硫では嘘になる** —— 実際の加硫で H₂ は出入りしない。
 * ★ 加硫の図は C=C に硫黄が付く形なので、二重結合の相方の炭素に H が1つずつ増える。
 *   その H は**ゴムの鎖がもともと持っている手の描き方**の話で、反応式に出る分子ではない。
 *   ＝ ④ に落として、炭素のそばで静かに現れるだけにする。
 * ⚠ **生成物は1原子も変わらない**（変わるのは再生の見せ方だけ）。 */
const RX_NO_MORPH_H2 = new Set(['vulcanization']);

/** 分子の型1つを、元素ごとの数（H は自動水素と明示の H の合計）にする */
function rxSpeciesCount(name) {
    const sp = RX_SPECIES[name];
    const m = new Molecule();
    const ids = sp.atoms.map(([el, x, y, ch]) => {
        const a = m.addAtom(el, x * 42, y * 42);
        if (ch) a.charge = ch;
        return a.id;
    });
    sp.bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
    const bare = new Set(sp.atoms.map((s, i) => (s[4] && s[4].bare ? ids[i] : null)).filter(Boolean));
    const count = {};
    sp.atoms.forEach(([el]) => { count[el] = (count[el] || 0) + 1; });
    const autoH = m.atoms.filter(a => a.element !== 'H').length
        ? m.calculateHydrogens().filter(h => !bare.has(h.parentId)).length : 0;
    count.H = (count.H || 0) + autoH;
    return count;
}

/**
 * 係数を解く。`need[E]` ＝ 反応式の左辺に足りない数（湧いた − 消えた）。
 * 相手 m 個ぶんを足し、副生成物 k 個ぶんを引いて、重原子は**ぴったり0**、
 * H は差がいちばん小さく、分子の数（重みつき）がいちばん少ない組を返す。
 * @returns { counts: {名前: 個数}, hGap } または null（重原子が合わない）
 */
function solveEquation(eq, need) {
    const names = [...eq.partners, ...eq.byproducts];
    const comp = names.map(rxSpeciesCount);
    const sign = names.map((n, i) => (i < eq.partners.length ? 1 : -1));
    const elements = new Set(Object.keys(need));
    comp.forEach(c => Object.keys(c).forEach(e => elements.add(e)));
    const els = [...elements];
    const maxP = eq.maxPartners || 4;
    const cost = n => (eq.cost && eq.cost[n]) || 1;
    let best = null;
    const m = new Array(names.length).fill(0);
    const rec = (i, partnersUsed) => {
        if (i === names.length) {
            let hGap = 0;
            for (const e of els) {
                let s = 0;
                names.forEach((n, k) => { s += sign[k] * m[k] * (comp[k][e] || 0); });
                const gap = s - (need[e] || 0);
                if (e === 'H') hGap = Math.abs(gap);
                else if (gap !== 0) return;
            }
            const total = names.reduce((s, n, k) => s + m[k] * cost(n), 0);
            if (!best || hGap < best.hGap || (hGap === best.hGap && total < best.total)) {
                best = { hGap, total, counts: Object.fromEntries(names.map((n, k) => [n, m[k]])) };
            }
            return;
        }
        const isPartner = i < eq.partners.length;
        const lim = isPartner ? maxP - partnersUsed : 10;
        for (let v = 0; v <= lim; v++) {
            m[i] = v;
            rec(i + 1, partnersUsed + (isPartner ? v : 0));
        }
        m[i] = 0;
    };
    rec(0, 0);
    return best;
}

/** ★ 道筋の曲げ（v1556）。bend: Map(id → {nx, ny, amp})。進み e で横へ amp·sin(πe) ずらす（始点と終点はずらさない） */
function rxBendOffset(bend, id, e) {
    const b = bend && bend.get(id);
    if (!b || !b.amp) return { x: 0, y: 0 };
    const k = b.amp * Math.sin(Math.PI * Math.max(0, Math.min(1, e)));
    return { x: b.nx * k, y: b.ny * k };
}

/** 原子の id を付け替える（結合の端点の並び atomId1 < atomId2 も直す） */
function renameAtomId(mol, from, to) {
    const a = mol.atoms.find(x => x.id === from);
    if (!a || mol.atoms.some(x => x.id === to)) return false;
    a.id = to;
    mol.bonds.forEach(b => {
        if (b.atomId1 === from) b.atomId1 = to;
        if (b.atomId2 === from) b.atomId2 = to;
        if (b.atomId1 > b.atomId2) { const t = b.atomId1; b.atomId1 = b.atomId2; b.atomId2 = t; }
    });
    return true;
}

/**
 * 連結した原子のかたまり（comp: id の配列・edges: [id, id]）を、型の空き枠に**結合を保つように**割り当てる。
 * ⚠ 無水酢酸の片方のアセチル基が生成物のアセチル基になる、のように「つながりごと」渡したいので、
 *   元素だけで決めずに、保たれる結合の数がいちばん多い割り当てを総当たりで選ぶ（かたまりは小さい）。
 * @returns { inst, map: Map(id → 枠の添字) } または null
 */
function rxEmbed(comp, edges, elementOf, instances) {
    let best = null;
    instances.forEach((inst, ii) => {
        const free = inst.slots.map((s, k) => (s.id === null ? k : -1)).filter(k => k >= 0);
        const bonded = (p, q) => inst.bonds.some(([i, j]) => (i === p && j === q) || (i === q && j === p));
        const map = new Map();
        const used = new Set();
        let budget = 20000;
        const dfs = (k) => {
            if (--budget < 0) return;
            if (k === comp.length) {
                const score = edges.filter(([x, y]) => bonded(map.get(x), map.get(y))).length;
                if (!best || score > best.score) best = { score, inst: ii, map: new Map(map) };
                return;
            }
            const id = comp[k];
            free.forEach(slot => {
                if (used.has(slot) || inst.slots[slot].el !== elementOf(id)) return;
                used.add(slot); map.set(id, slot);
                dfs(k + 1);
                used.delete(slot); map.delete(id);
            });
        };
        dfs(0);
    });
    if (best || instances.length < 2) return best;
    /* ★ 1つの型に収まらないかたまりは、型をまたいで割り当てる（v1556）。
     *   例: NaHCO₃ の C・O・O・O⁻ は CO₂ と H₂O に分かれる／ヨードホルムで余った I−I は NaI 2つに分かれる。
     *   ⚠ 保たれる結合の数は「同じ型の中の結合」だけで数える（型をまたぐ結合はもともと切れる） */
    const pool = { slots: [], bonds: [], owner: [] };
    instances.forEach((inst, ii) => {
        const base = pool.slots.length;
        inst.slots.forEach((s, k) => { pool.slots.push(s); pool.owner.push([ii, k]); });
        inst.bonds.forEach(([i, j, t]) => pool.bonds.push([base + i, base + j, t]));
    });
    const hit = rxEmbed(comp, edges, elementOf, [pool]);
    if (!hit) return null;
    return { score: hit.score, pooled: true, map: hit.map, owner: pool.owner };
}

/** `rxEmbed` の結果を型の枠に書き込む（型をまたいだ割り当てにも対応） */
function rxAssign(hit, instances, idOf = id => id) {
    hit.map.forEach((slot, id) => {
        const [ii, k] = hit.pooled ? hit.owner[slot] : [hit.inst, slot];
        instances[ii].slots[k].id = idOf(id);
    });
}

/** id の集合を、edges でつながったかたまりに分ける（大きい順） */
function rxComponents(ids, edges) {
    const adj = new Map(ids.map(id => [id, []]));
    edges.forEach(([a, b]) => { if (adj.has(a) && adj.has(b)) { adj.get(a).push(b); adj.get(b).push(a); } });
    const seen = new Set(), out = [];
    ids.forEach(id => {
        if (seen.has(id)) return;
        const comp = [id]; seen.add(id);
        for (let i = 0; i < comp.length; i++) adj.get(comp[i]).forEach(n => { if (!seen.has(n)) { seen.add(n); comp.push(n); } });
        out.push({ comp, edges: edges.filter(([a, b]) => comp.includes(a) && comp.includes(b)) });
    });
    return out.sort((p, q) => q.comp.length - p.comp.length);
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
        // ★ **瓶の面は1つだけ**（v1522・D-E2 の決着。ユーザー決定 2026-09-07
        //   「試薬パレットは移動したので、分子の詳細モーダルからは削除してよいのでは？」）。
        //   v1494〜v1521 は分子モーダル（`#mm-reagents-grid`）と実験タブの**2か所**に出していた。
        //   ⚠ **消したのは面であって瓶ではない**（`REAGENTS` は1行も変えていない）。
        //   ★ 理由: 瓶は「キャンバスの分子にかける」道具なのに、全画面のモーダルが分子を隠す。
        //     `DESIGN_experiment_mode.md` §5-3 がフロート案を退けたのと**同じ理由**が
        //     モーダルにも当てはまっていた。
        //   ⚠ **配列のまま残す**（要素1つでも）。第2の面を足したくなったらここに1語足すだけで、
        //     `renderReagents` の書き方（1つの `REAGENTS` から1つの関数で描く）は変わらない
        this.reagentGridIds = ['exp-reagents-grid'];
        this.renderReagents();
        // ↩ 反応前に戻す（v1409）。帯（#ws-free）の中に置いた1つだけの出口
        this.undoBtn = document.getElementById('btn-rx-undo');
        if (this.undoBtn) this.undoBtn.addEventListener('click', () => this.undoLastReaction());
        // ▶ 反応をもう一度見る（v1568）。⚠ 出し入れは `syncUndoButton()` の中で ↩ と同じ条件でそろえる
        this._replay = null;
        this.replayCard = document.getElementById('reaction-card');
        this.replayControls = document.getElementById('rx-replay-controls');
        const rb = id => document.getElementById(id);
        this.replayBtns = {
            restart: rb('btn-rx-replay-restart'), prev: rb('btn-rx-replay-prev'),
            play: rb('btn-rx-replay-play'), next: rb('btn-rx-replay-next'), exit: rb('btn-rx-replay-exit')
        };
        const on = (b, fn) => { if (b) b.addEventListener('click', fn); };
        on(this.replayBtns.play, () => this.replayPlay());
        on(this.replayBtns.prev, () => this.replayStep(-1));
        on(this.replayBtns.next, () => this.replayStep(1));
        on(this.replayBtns.restart, () => this.replayRestart());
        on(this.replayBtns.exit, () => this.replayExit());
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
        g.showToast(rx.summoned
            ? `呼び出した「${rx.summoned}」ごと、反応の前に戻しました（この操作も ↩ 戻す で取り消せます）。`
            : '反応の前に戻しました（この操作も ↩ 戻す で取り消せます）。', 4000, 'success');
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
        // ▶ もう一度見る（v1568）も**同じ条件・同じ呼ばれ方**でそろえる ＝ 呼び出し元（refresh・機構ビューア・
        //   game.updateDrawing の早期 return）を増やさずに、↩ と ▶ が食い違う瞬間を作らない
        this.syncReplayControls();
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
        // ★ 札は反応ルールの並び順で1列に並べる（I-0150）。相手を呼び出す札も同じ列に混ぜるので、
        //   いったん { order, el } で集めてから並べて積む
        const items = [];
        REACTION_RULES.forEach((rule, order) => {
            let sites = [];
            try {
                sites = rule.detect(mol);
            } catch (e) {
                console.error('反応ルール検出エラー:', rule.id, e);
                return;
            }
            // ⚠ `selSets.length &&` の門番は外した（v1429）。選択が無いときも
            //    「いま見ている分子」で絞る ＝ 判定は `siteAllowed` ただ1つに任せる
            // ⚠ `!rule.info` の除け口も外した（v1589・§13.8）。解説カードだけ素通しにすると
            //    「1-ブタノールを見ているのに ⚠ 酸化（3級アルコール）が出る」＝ 隣の分子の
            //    解説が混ざる。箇所を持たない情報カードは `siteAllowed` 自身が通す
            //    （`if (!ids.length) return true;`）ので、ここに例外は要らない
            sites = sites.filter(s => siteAllowed(s, rule));
            if (sites.length === 0) return;
            if (!rule.info) executable++;
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px;';
            btn.textContent = rule.label + (sites.length > 1 && !rule.info ? `（${sites.length}箇所）` : '');
            // `?reagent=<ルールid>` から名指しできるようにする（瓶を持たないルールが5件ある）
            btn.dataset.rule = rule.id;
            btn.addEventListener('click', () => this.onRuleClick(rule, sites));
            items.push({ order, el: btn });
        });

        this.executableCount = executable;
        // 相手の分子が要る反応への道は**いつでも出す**（v1420・ユーザー申し立て
        // 「作成済みの分子しか選べない」）。押せる反応が0件のときしか出していなかったので、
        // エタノールのように単独で4件できる分子だと**エステル化へ進む道が一覧に生えなかった**。
        // ⚠ **上位N件で切らない**（切った分が黙って消える）。
        // ★ v1664（I-0150）: 畳まず、同じ反応ルールの札のすぐ後ろに置く（呼び出すかどうかで分けない）
        //
        // ⚠ **見えているときだけ数える。** 案内の総当たり（候補5件 × 全ルールの detect）は
        //   実測で 20〜30ms かかり、`refresh()` は**作図のたび**に走る（ふだんの再描画は 6〜7ms）。
        //   この案内が出るのは分子モーダルの中だけなので、開いているときに限る
        //   （開いた瞬間にも `openMoleculeModal` が refresh を呼び直す）
        // ⚠ 試算の土台も同じ `scope`（v1429）。ここを全体のままにすると、
        //    「ブタン酸を見ているのに、隣のケトンに相手を足す案内」が生えて同じ混ざり方が残る
        if (this.partnerHintsVisible()) {
            this.partnerHintItems(scope, executable > 0).forEach(it => items.push(it));
        }
        items.sort((a, b) => a.order - b.order).forEach(it => nextSec.appendChild(it.el));
        // ⚠ 目印を付け直す前に**節を DOM へ挿す**。`markSelectedReagent()` は
        //   `#reaction-actions [data-rule]` を引くので、繋いでいない節の中の札は見えない
        this.actionsEl.appendChild(nextSec);
        // 描き直したら `?reagent=` の目印を付け直す（付けっぱなしにも消えっぱなしにもしない）
        if (this.selectedReagentId || this.selectedRuleId) this.markSelectedReagent();

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
            /* ★ **見せた図が簡易版であることを、その場で言う**（v1540）。
             * ⚠ 機構の在る反応だけが「本当はどう動くか」を約束できる（`RX_MORPH_NOTE_MECH`）。 */
            const note = document.createElement('div');
            note.className = 'rx-morph-note';
            note.style.cssText = 'font-size:11px; line-height:1.6; color:var(--text-secondary);';
            note.textContent = this.lastReaction.mechanismId ? RX_MORPH_NOTE_MECH : RX_MORPH_NOTE;
            lastSec.appendChild(note);
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
     * ★ **押した瓶の答えを、どこへ返すか**（v1494・DESIGN_experiment_mode.md 第1段）。
     *
     * ⚠ **返す先は「いま人が見ている面」**でなければならない。空振りの説明も条件の2択も、
     *   押した瓶のすぐ下に出て・読み終わるまで残るのが約束（`RG3` / `RG11` / `MM8`）で、
     *   裏の面へ返すと**押したのに何も起きていないように見える**。
     *
     * ★ **v1522 から返し先は1つ**（`#exp-reagent-note`）。分子モーダルの瓶の節を消したので、
     *   「瓶を押せる面」も1つしかない ＝ 振り分けるものが無くなった（D-E2 の決着）。
     * ⚠ v1494〜v1521 は「モーダルが開いていればモーダル側・そうでなければ実験タブ側」と
     *   **押した面を見て振り分けていた**。面が2つあるあいだは必要な振り分けだったが、
     *   1つになった以上は残しておくと**存在しない DOM を指す分岐**が残るだけになる。
     */
    get reagentNoteEl() {
        return document.getElementById('exp-reagent-note');
    }

    /**
     * 瓶の札を組み立てる（起動時に一度だけ）。**どの瓶も常に押せる**ので作図では組み直さない。
     *
     * 区分の見出し（変えるもの／調べるもの）は**格子の中に全幅の1行として**入れる（同書 §3.2）。
     * 格子を2つに割らないのは、320px で列数が変わったときに区分ごとに折り返しがずれると
     * 「同じ大きさの札が並ぶ」という読み方が崩れるから。
     *
     * ★ **描き先は `reagentGridIds`**（v1522 からは左パレットの「🧪 実験」タブ1つ）。
     *   1つの関数・1つの `REAGENTS` から描くので、面を増やしても瓶の札を書き写さずに済む
     */
    renderReagents() {
        (this.reagentGridIds || ['exp-reagents-grid'])
            .forEach(id => this.renderReagentsInto(document.getElementById(id)));
        // 絞り込みで札を組み直すと、選んでいた瓶の印が消える（押した瓶が分かるようにする）
        this.markSelectedReagent();
    }

    /**
     * いま棚に出す瓶（I-0032・v1604）。
     *
     * ★ **分液の面を開いているあいだだけ絞る**（`phaseReagentIds` ＝ `RULE_PHASE` から導く）。
     *   ⚠ 絞り方は**この1か所だけ**に置く ＝ 「出す瓶」と「押したときの振る舞い」
     *   （`onReagentClick` の混合物への適用）が別の条件で判断されることを避ける。
     * ⚠ 分液でないときは `REAGENTS` をそのまま返す（27本・実験モードは今までどおり）。
     */
    reagentsForPalette() {
        if (!this.game || !this.game.separationActive) return REAGENTS;
        const allow = phaseReagentIds();
        return REAGENTS.filter(rg => allow.has(rg.id));
    }

    renderReagentsInto(el) {
        if (!el) return;
        el.innerHTML = '';
        let kind = null;
        const sep = !!(this.game && this.game.separationActive);
        this.reagentsForPalette().forEach((rg, i) => {
            /* 見出しは**中身に合う言葉**にする。
             * ★ 分液では**区分を割らない**（見出しは1つ）。棚に並ぶ瓶はどれも層を動かすもので、
             *   ⚠ NaHCO₃ は実験の棚では『調べるもの』（泡で -COOH を見る瓶）だが、
             *   漏斗の中では塩にして水層へ落とす瓶として働く（`onReagentClick` が混合物へ回す）。
             *   同じ瓶を2つの見出しで呼ぶと、**いまどちらの読みの話か**が画面から消える。 */
            if (sep ? i === 0 : rg.kind !== kind) {
                kind = rg.kind;
                const h = document.createElement('div');
                h.className = 'rg-group';
                h.dataset.kind = sep ? 'phase' : kind;
                h.textContent = sep
                    ? '層を移すもの —— 酸と塩基で、水層と有機層を行き来させよう'
                    : (kind === 'detect' ? '調べるもの（構造は変わりません）' : '変えるもの');
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
        /* ★ **選んだものが見える面を開く**（v1522・D-E2 の決着で面が2つに分かれた）。
         *   v1521 まで「瓶と自動案内はどちらも分子モーダルの中」だったので無条件に開いていたが、
         *   ⚠ 瓶は左パレットの「🧪 実験」タブへ移った ＝ モーダルを開くと**印を付けた瓶を
         *     自分で隠す**ことになる（`?reagent=br2_water` が黙って空振りに見える）。
         *   - ルールを名指しされた（`?reagent=open_glucopyranose` のような瓶を持たないルール）
         *     … 自動案内のボタン列は分子モーダルの中なので、従来どおり開く
         *   - 瓶を名指しされた … 実験パレットへ持ち替える（🧪自由 のときだけ。
         *     パズル・学習ではタブそのものが出ないので、触らずに従来の道へ落とす） */
        if (ruleId || !bottle) {
            this.game.openMoleculeModal();
        } else if (this.game.currentMode === 'free' && this.game.setPalette) {
            this.game.setPalette('exp');
        } else {
            this.game.openMoleculeModal();
        }
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
            // `refresh()` と同じ（v1589・§13.8）。解説カードも絞る ＝ 瓶から引いた解説が
            // 隣の分子のものにならない。箇所を持たない情報カードは `siteAllowed` が通す
            sites = sites.filter(s => siteAllowed(s, rule));
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

    /**
     * ★★ 混合物に瓶をかける（DESIGN_ion_layer.md I-1・§4-5 #2）。
     *
     * ⚠⚠ **`wholeCanvas`（重合）とは別物。** あちらは `detect` が**1回で全体を見る**
     *   （並べた単量体をまとめて1つの鎖にする）。こちらは
     *   **成分ごとに既存の `detect` を回すだけ**で、反応ルールを1行も書き換えない。
     *
     * ★ **箇所選択は出さない**（§4-5 #2）。混合物では「どれに効くか」が問いなので、
     *   効いた成分だけが動けばよい —— どの -COOH かを選ばせるのはこの面の問いではない。
     * ★ **試薬の順は固定しない**（D-I10）。押した順に効くだけで、
     *   **順序の正解は出さない**（D-I15。教科書順は入試64件中3件しかない）。
     * ⚠ **1回の押しで Undo は1段**（`saveState` は先頭で1回だけ）。
     *   前後比較は出さない（1つの反応ではないので「反応の前後」と名乗れない）。
     */
    applyToMixture(reagent) {
        const g = this.game;
        /* ⚠⚠ **`harsh` の反応は分液漏斗の中では走らせない**（I-2）。
         *   漏斗の中は**水溶液・常温**で、高温高圧を要る反応（コルベ・シュミット）は起こらない。
         *   ★ ここを抜くと、CO₂ を吹き込んだときにフェノールが遊離せず
         *     **サリチル酸ナトリウムに化ける**（否定対照 SEP8 がそれを見る）。 */
        const rules = REACTION_RULES.filter(r =>
            ruleUsesReagent(r, reagent.id) && !r.info && !r.harsh);
        if (!rules.length) { this.explainReagentMiss(reagent); return; }
        // 成分の顔ぶれは**先に**取る（apply が図を書き換えるので、途中で数え直さない）
        const parts = g.splitMolecules()
            .filter(p => p.atoms.some(a => a.element !== 'H'))
            .map(p => ({
                ids: p.atoms.map(a => a.id),
                name: g.lookupCompoundName(p) || g.computeMolecularFormula(p)
            }));
        if (!parts.length) { this.explainReagentMiss(reagent); return; }
        this.clearReagentNote();
        g.saveState();
        const hits = [], misses = [], captions = [];
        let applied = 0;
        parts.forEach(part => {
            const mine = new Set(part.ids);
            for (const rule of rules) {
                let sites = [];
                // ⚠ **成分ごとに detect を回し直す**（前の成分の apply で図が変わっているため）
                try { sites = rule.detect(g.userMolecule) || []; } catch (e) {
                    console.error('反応ルール検出エラー:', rule.id, e); continue;
                }
                // その成分の原子を含む箇所だけ（他の成分に跨る箇所＝分子間反応はここでは採らない）
                /* ⚠⚠ **その成分の原子だけでできている箇所**に限る。ここを
                 *   「最初に見つかった箇所」にすると、**別の成分の箇所を横取りして
                 *   効いた成分の名前がずれる**（否定対照 SEP2-② が実際にこれを捕まえる。
                 *   ⚠ 図の見た目は同じになるので、名前で引かないと空振りする）。
                 *   ★ 他の成分に跨る箇所（分子間のエステル化など）もここで落ちる。 */
                const site = sites.find(s => Array.isArray(s) &&
                    s.filter(x => typeof x === 'string').length > 0 &&
                    s.filter(x => typeof x === 'string').every(x => mine.has(x)));
                if (!site) continue;
                try {
                    /* ★ 反応の**前**に粒の相方を控える（v1569・`tidyAqueousCounterIons` の注記）。
                     *   反応のあとで距離から組み直すと、隣にできた塩の粒と取り違える */
                    const mol0 = g.userMolecule;
                    const owners = counterIonOwners(mol0);
                    const beforeIds = new Set(mol0.atoms.map(a => a.id));
                    const beforeCharge = new Map(mol0.atoms.map(a => [a.id, a.charge || 0]));
                    const res = rule.apply(g, site);
                    applied++;
                    hits.push(part.name);
                    if (res && res.caption) captions.push(`${part.name}: ${res.caption}`);
                    const toAq = RULE_PHASE[rule.id] && RULE_PHASE[rule.id].phase === 'aq';
                    const fresh = adoptNewCounterIons(g.userMolecule, owners, beforeIds, beforeCharge);
                    // 層の印を付ける前に置き直す（`splitMolecules` が粒を近い成分に付けるため）
                    tidyAqueousCounterIons(g.userMolecule, owners, toAq ? fresh : []);
                    this.assignPhaseFor(rule, site, part.ids);
                    // 水層へ降ろしたあとにもう一度（平行移動で隣の塩と近づくことがある）
                    tidyAqueousCounterIons(g.userMolecule, owners);
                } catch (e) {
                    console.error('反応実行エラー:', rule.id, e);
                    misses.push(`${part.name}（置く場所が足りませんでした）`);
                }
                return;   // 1成分につき1つの反応まで（同じ瓶で二度は効かせない）
            }
            misses.push(part.name);
        });
        if (!applied) { g.history.pop(); this.explainReagentMiss(reagent); return { hits, misses }; }
        /* ★ 水層の帯に「いま何を入れた層か」を出す（発注書 H）。
         * ⚠ **効いたときだけ**書き換える —— 空振りは履歴も戻す（すぐ上）ので、
         *   ここで字だけ変えると ↩ の戻り先と食い違う。
         * ⚠ 字を作るのは `separationReagentLabel`（game.js）ただ1つ ＝ 瓶と食い違わない。 */
        if (typeof separationReagentLabel === 'function') {
            g.aqReagentLabel = separationReagentLabel(reagent);
        }
        this.discardLastReaction();   // 「反応の前後」は1つの反応の話。混合物では名乗らない
        g.updateDrawing();
        if (g.fitSeparationView) g.fitSeparationView();
        this.reportMixture(reagent, hits, misses, captions);
        /* ★ **効いた／効かないを名前で返す**（D-I15。順序の正解は出さない）。
         * ⚠ 検査は**数ではなく名前**を見る —— 数だけだと「別の成分の箇所を横取りした」
         *   壊れ方が図の上では同じに見えて通ってしまう（SEP2-② の実測）。 */
        return { hits, misses };
    }

    /** ルール → 層の対応表を引いて、その成分に層の印を付ける（表は `RULE_PHASE` ただ1つ） */
    assignPhaseFor(rule, site, partIds) {
        const g = this.game;
        const to = RULE_PHASE[rule.id];
        // ⚠ **表に載っていない反応はここで返る**（＝ 既存の反応の道は1行も変わらない）
        if (!to || !g.setPartPhase || !Array.isArray(site)) return;
        /* 反応のあとに**その成分が誰なのか**を引き直す ——「塩ができた」で原子が増え、
         * 「遊離した」で金属が消えるので、反応前の id の並びをそのまま使えない。
         * ⚠ 生き残っている id を1つ拾って連結成分をたどる（原子IDの順序には頼らない）。 */
        const alive = partIds.concat(site.filter(x => typeof x === 'string'))
            .find(id => g.userMolecule.atoms.some(a => a.id === id));
        if (!alive) return;
        /* ⚠⚠ **成分は「見せ方の単位」で取る**（`splitMolecules` ＝ 対イオンの粒を相方に
         *   付けたもの。I-3 の `attachCounterIons`）。連結成分（`moleculeAtomIdsOf`）で取ると、
         *   アニリン塩酸塩に印を付けたとき **Cl⁻ の粒だけが有機層に取り残される**
         *   （粒は結合を持たないので連結成分に入らない。否定対照 SEP4）。 */
        const part = (g.splitMolecules ? g.splitMolecules() : [])
            .find(p => p.atoms.some(a => a.id === alive));
        const ids = part ? part.atoms.map(a => a.id) : [...g.moleculeAtomIdsOf(alive)];
        g.setPartPhase(ids, to.phase, to.note);
    }

    /**
     * 混合物にかけた結果の返し方。
     * ★ **効いた／効かないだけ返す**（D-I15）。⚠ 順序の正解も、次に何を入れるべきかも言わない。
     */
    reportMixture(reagent, hits, misses, captions) {
        const note = this.reagentNoteEl;
        const head = `${reagent.name}（${reagent.formula}）を混合物にかけました。` +
            `効いたのは ${hits.length} 成分（${hits.join('・')}）` +
            (misses.length ? `／効かなかったのは ${misses.length} 成分（${misses.join('・')}）` : '') + '。';
        this.game.showToast(head, 6000, 'success');
        if (!note) return;
        note.innerHTML = '';
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        setEmphasisText(p, head + (captions.length ? '\n' + captions.join('\n') : ''));
        p.style.whiteSpace = 'pre-line';
        note.appendChild(p);
    }

    onReagentClick(reagent) {
        // ★ 分液の面を開いているあいだは、瓶は**キャンバスの全成分に順に**かかる（I-1・§4-5 #2）
        if (this.game.separationActive && REACTION_RULES.some(r => ruleUsesReagent(r, reagent.id) && !r.info)) {
            this.applyToMixture(reagent);
            return;
        }
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
     * 空振り（0件）の説明は瓶の節（`#exp-reagent-note`）に残る ——「効かない」という同じ答えが
     * 2か所に割れていた。瓶から来た答えは**押した瓶のすぐ下に、消えずに**返すのが正しい
     * （自動案内の ⚠ ボタンは押すとモーダルを閉じてキャンバスへ返る流れなので、
     * そちらは従来どおりトーストのまま）。
     */
    runReagentHit(hit, reagent) {
        // 「選べるが、いまは材料が足りない」条件（v1424）。**押しても何も起きない、にしない**
        if (!hit.sites) { this.explainConditionMiss(hit.rule, reagent); return; }
        this.clearReagentNote();
        if (hit.rule.info) { this.showReagentInfo(hit.rule, hit.sites); return; }
        if (this.game.closeMoleculeModal) this.game.closeMoleculeModal();
        // ⚠ **押した瓶を持って行く**（v1428）。「効くが、ふつうはそちらを使わない」を
        //   結果に添えられるのは、どの瓶から来たかを知っているここから先だけ。
        //   反応カードから来た場合は `undefined` ＝ 添えない（試薬を選んでいないのだから言う相手がいない）
        this.onRuleClick(hit.rule, hit.sites, reagent);
    }

    // `info` ルールの解説を瓶の節に出す。**分子は1原子も変わらず・Undo も積まない**
    // （`apply` を呼ぶが、`info` ルールの `apply` は文を返すだけで書き換えない）
    // `sites` は `reagentHits()` が絞ったあとの並び（v1589・§13.8。反応カードと同じものを渡す）
    showReagentInfo(rule, sites) {
        const note = this.reagentNoteEl;
        if (!note) return;
        note.innerHTML = '';
        const p = document.createElement('div');
        p.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
        // `**…**` は太字にして出す（v1467・game.js の `setEmphasisText`）
        setEmphasisText(p, rule.apply(this.game, sites).caption);
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

    /* 相手を呼び出す札を、反応の一覧に混ぜる形（{ order, el }）で返す（I-0150・v1664）。
     * order は反応ルールの並び順 ＋ 0.5 ＝ **同じルールの（呼び出さない）札のすぐ後ろ**に入る。
     * ⚠ **1件も落とさない**（上位N件で切らない・畳まない）。 */
    partnerHintItems(baseIds, hasExecutable) {
        const hints = this.cachedPartnerHints(baseIds);
        if (hints.length === 0) {
            // 押せる反応が並んでいる画面では**何も出さない** —— 「できる反応が登録されていません」は
            // 手が止まった人への断り文なので、押せる反応がある画面に出すと嘘になる
            if (hasExecutable) return [];
            const note = document.createElement('div');
            note.style.cssText = 'font-size:11.5px; line-height:1.5; color:var(--text-secondary);';
            note.textContent = 'いまの分子でできる反応は登録されていません。' +
                '原子や結合を足すか、別の分子を呼び出してみてください。';
            return [{ order: Infinity, el: note }];
        }
        const orderOf = new Map(REACTION_RULES.map((r, i) => [r.id, i]));
        return hints.map(h => ({
            order: (orderOf.has(h.ruleId) ? orderOf.get(h.ruleId) : REACTION_RULES.length) + 0.5,
            el: this.makePartnerHintButton(h),
        }));
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
        // ★ 見た目は呼び出さない札と同じ（I-0150・v1664）。呼び出すことは札の文言「＋ ○○ を呼び出す」が言う
        btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px;';
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
    /**
     * 呼んだ相手（`added`）を、反応する原子が元の分子の側を向くように置き直す（I-0131）。
     * 横の向きだけを見る: 相手の中で反応する原子が、相手の重心から見て元の分子と**反対の側**に
     * あれば、相手を左右に鏡映する（上下は保つ）。立体（ハース・フィッシャーの印）を持つ相手は
     * 鏡映すると別の立体になるので、代わりに重心のまわりに 180° 回す（`settleInPlace` と同じ決め）。
     * ⚠ 座標だけを動かす（結合は触らない）。動かすのは相手だけ ＝ 元の分子は1原子も動かない
     */
    facePartner(site, added) {
        const g = this.game;
        if (!Array.isArray(site) || !added || !added.size) return false;
        const mol = g.userMolecule;
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        const theirs = mol.atoms.filter(a => added.has(a.id));
        const hitTheirs = site.filter(id => added.has(id)).map(id => byId.get(id)).filter(Boolean);
        const hitMine = site.filter(id => !added.has(id)).map(id => byId.get(id)).filter(Boolean);
        if (!theirs.length || !hitTheirs.length || !hitMine.length) return false;
        const mx = arr => arr.reduce((t, a) => t + a.x, 0) / arr.length;
        const my = arr => arr.reduce((t, a) => t + a.y, 0) / arr.length;
        const cx = mx(theirs), cy = my(theirs);
        const toward = mx(hitMine) - cx;          // 元の分子の反応する原子は、相手の重心から見てどちら側か
        const facing = mx(hitTheirs) - cx;        // 相手の反応する原子は、どちら側か
        if (Math.abs(facing) < 1 || toward * facing > 0) return false;   // もう向いている（または真ん中）
        const chiral = theirs.some(a => a.haworthFace === 1 || a.haworthFace === -1) ||
            (typeof readAtomParityFromFischer === 'function' && (() => {
                const sub = new Molecule();
                const idMap = new Map();
                theirs.forEach(a => { const n = sub.addAtom(a.element, a.x, a.y); idMap.set(a.id, n.id); });
                mol.bonds.forEach(b => {
                    if (idMap.has(b.atomId1) && idMap.has(b.atomId2)) sub.addBond(idMap.get(b.atomId1), idMap.get(b.atomId2), b.type);
                });
                return Object.keys(readAtomParityFromFischer(sub) || {}).length > 0;
            })());
        theirs.forEach(a => {
            a.x = 2 * cx - a.x;
            if (chiral) a.y = 2 * cy - a.y;
        });
        return true;
    }

    /* 加硫の相手（呼んだ鎖 `added`）を、元の鎖の C=C の真下に「＝」でそろえて置く（I-0149）。
     * site は加硫の箇所 [ca, ca2, cb, cb2]。どちらの組が呼んだ鎖の側かは added で見分け、
     * **元の鎖の C=C を錨にして呼んだ鎖を動かす**（`stackChainsForBridge` は cb の側の鎖を動かす）。
     * 鎖がそろって重なる相手の C=C を選ぶのは加硫の1本目と同じ（`inRegisterPartner`）。 */
    stackPartnerForBridge(site, added) {
        const mol = this.game.userMolecule;
        if (!Array.isArray(site) || site.length < 4) return false;
        const [a, a2, b, b2] = site;
        const mineFirst = added.has(b) && !added.has(a);
        if (!mineFirst && !(added.has(a) && !added.has(b))) return false;
        const [ca, ca2, cb, cb2] = mineFirst ? [a, a2, b, b2] : [b, b2, a, a2];
        const reg = inRegisterPartner(mol, ca, ca2, cb, cb2);
        return stackChainsForBridge(mol, ca, reg ? reg.cb : cb) || (reg ? stackChainsForBridge(mol, ca, cb) : false);
    }

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
        /* ★ 呼ぶ前のキャンバスの控え（I-0130・2026-09-24 ユーザー「反応前に戻したときに呼び出し分子が消えない、
         *   再度反応させると新たに分子を召喚して反応させる ／ ここを可逆的にしたい」）。
         *   「↩ 反応前に戻す」は**呼ぶ前**まで戻す ＝ 呼んだ相手も一緒に消える（execute が `_pendingSummon` を読む）。
         *   ⚠ 控えは呼んだ直後の形（トポロジー）と組で持ち、実行の時点でキャンバスがその形のときだけ使う
         *   （箇所選びの途中でほかの操作をしてから別の反応をしたときに、古い控えへ戻さない） */
        const preSummonState = g.serializeState();
        this._pendingSummon = null;
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
        let cross = sites.filter(s => Array.isArray(s) &&
            s.some(id => added.has(id)) && s.some(id => !added.has(id)));
        if (cross.length === 0) {
            return this.stopPartnerHint(h, 'detect',
                `「${h.name}」は置けましたが、2分子にまたがる ${h.label} の箇所が見つかりませんでした。` +
                '反応は実行していません。');
        }
        /* ★ 加硫の相手の鎖は、**呼んだ時点で反応後の位置**（元の鎖の真下）に置く（I-0149・2026-09-25
         *   ユーザー「最初から反応後の位置に呼び出すべき。加硫操作の時に移動させるとわかりづらい」）。
         *   動かすのは呼んだ鎖だけ（元の鎖は1原子も動かない）。置き直したら箇所を数え直す */
        if (rule.id === VULCANIZE_RULE && this.stackPartnerForBridge(cross[0], added)) {
            try { sites = rule.detect(g.userMolecule) || []; } catch (e) { sites = []; }
            cross = sites.filter(s => Array.isArray(s) &&
                s.some(id => added.has(id)) && s.some(id => !added.has(id)));
            /* 選ばせるのは**真下にそろった組だけ**（斜めの組を選ぶと、加硫の1本目で相手の鎖を横へ寄せ直す
             * ＝ また動く）。鎖の R は「同じ単位が続く」印なので、どの単位に架けても同じ加硫ゴムになる */
            const byId = new Map(g.userMolecule.atoms.map(a => [a.id, a]));
            const G = bondStep(g.userMolecule);
            const upright = cross.filter(s => Math.abs(byId.get(s[0]).x - byId.get(s[2]).x) < G * 0.35);
            if (upright.length) {
                const keep = new Set(upright);
                sites = sites.filter(s => !cross.includes(s) || keep.has(s));
                cross = upright;
            }
            if (cross.length === 0) {
                return this.stopPartnerHint(h, 'detect',
                    `「${h.name}」を鎖の下に置きましたが、${h.label} の箇所が見つかりませんでした。反応は実行していません。`);
            }
        }
        /* ★ 相手を「反応する側が向き合う」向きに置く（I-0131・2026-09-24 ユーザー「エタノールの分子間脱水：
         *   召喚する分子を、ヒドロキシ基同士が隣接する向きに」「反応による分子の移動は最小になるように」）。
         *   2分子の反応だけ（重合など並べた単量体をつなぐ反応は、向きをそろえて並べるので触らない） */
        // ⚠ 加硫は上で真下にそろえて置いたので向きは変えない（鏡映すると「＝」の重なりが崩れる）
        if (!rule.wholeCanvas && times === 1 && !(h.selfCount > 0) && rule.id !== VULCANIZE_RULE) this.facePartner(cross[0], added);
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
        this._pendingSummon = {
            state: preSummonState,
            key: this.topologyKey(this.snapshotMolecule(g.userMolecule)),
            name: h.name
        };
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
                if (ids.has(a.id)) map.set(a.id, copyAtomMarks(part.addAtom(a.element, a.x, a.y), a).id);
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
            // ⚠ **絞ったあとの箇所を渡す**（v1589・§13.8）。札を「いま見ている分子」で
            //   絞っても、文面が全体を数え直していたら混ざりは残る
            this.game.showToast(rule.apply(this.game, sites).caption, 6000, 'success');
            return;
        }
        this.narrow(rule, sites, reagent);
    }

    /**
     * 「**効くが、ふつうはそちらを使わない**」ときに結果へ添える一言（同書 §12-3・v1428）。
     *
     * ⚠ **`miss` とは別の棚**。`miss` は「効かない」で、瓶の節（`#exp-reagent-note`）に
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
        // ★ 画面に出ている反応前の図そのもの（v1556）。`before` はこのあと相手を足されるので、再生の最初のコマはこちらから始める
        const beforeReal = this.snapshotMolecule(g.userMolecule);
        // ★ 「↩ 反応前に戻す」用の**完全な**控え（v1409）。
        //   `before` は前後比較の絵を描くための抜き書き（id・元素・座標・電荷）で、
        //   ロック・不斉マーク・ベンゼンの中心角など**描き戻しに要る属性を持たない**。
        //   戻すのは `serializeState()`（Undo が使っているものと同じ全部入り）で行う
        let beforeState = g.serializeState();
        /* ★ 相手を呼んでから実行した反応は、「↩ 反応前に戻す」で**呼ぶ前**まで戻す（I-0130）。
         *   控えを使うのは、キャンバスが呼んだ直後と同じ形のときだけ（`runPartnerHint` の注記） */
        const pending = this._pendingSummon;
        this._pendingSummon = null;
        const summoned = !!(pending && pending.key === this.topologyKey(before));
        if (summoned) beforeState = pending.state;
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
        // ★ 並べた単量体をつなぐ反応は、生成物を単量体が並んでいた場所へ戻す（I-0077・`settleInPlace` の注記）
        if (rule.wholeCanvas) this.settleInPlace(before, g.userMolecule);
        /* 「効くが、ふつうはそちらを使わない」の一言を**結果に添える**（v1428・同書 §12-3）。
         * ⚠ `apply` の外で足す ——「どの瓶から来たか」は反応の中身ではないので、
         *   `apply` に瓶ごとの分岐を1つも入れないまま言える（§12-1 の約束）。 */
        const note = this.usuallyNote(rule, reagent);
        if (note) result = { ...result, caption: `${result.caption}\n${note}` };
        /* ★ 層の割り当ても `apply` の外で足す（DESIGN_ion_layer.md §4-5 #3）。
         * ⚠ **`applyToMixture` と同じ関数**を通す ＝ 表（`RULE_PHASE`）を2か所で読まない。
         *   ここが無いと、反応カードから中和したときだけ層が動かない（入口で結果が割れる）。 */
        this.assignPhaseFor(rule, site, []);
        /* ★ 相手の分子（Cl₂・HNO₃・H₂O など）を反応前の図に置き、余りを HCl・H₂O として残す（v1553）。
         *   見た目だけ ＝ 生成物の結合は `apply` が作ったまま。呼べたら視野を合わせ直す（右に置くので） */
        /* ★ 相手を呼んで並べる反応では、置換基が反応する芳香環を回して**反応する置換基を右上（相手の側）**へ向ける（v1556）。
         *   反応前の写し（before）と生成物（キャンバス）を同じだけ回す ＝ 生成物も右上のまま残る。
         *   ⚠ 相手を置く前に回す（相手の置き場は回したあとの図で決める） */
        const rotation = this.turnRingForReaction(rule, before, g.userMolecule, result);
        let anim = summonReactionPartner(rule.id, before, g.userMolecule);
        if (anim) {
            result = { ...result, refit: true };
        } else {
            /* ★ 反応式ぶんの相手（[O]・NaOH・NaNO₂・無水酢酸・I₂・O₂ など）と副生成物を再生の写しにだけ置く（v1556）。
             *   `reuse` で付け替えた id は `changed`（ハイライト）にも写す */
            // ⚠ 回した角を渡す（相手の置き場は「回し終わった図」だけでなく**掃いた跡**も避ける・v1584）
            anim = this.planEquation(rule.id, before, g.userMolecule, result, rotation);
            if (anim && anim.renames.size && Array.isArray(result.changed)) {
                result = { ...result, changed: result.changed.map(id => anim.renames.get(id) || id) };
            }
        }
        // ★ 重合の鎖の端の R（v1574）。相手の表に載らない反応だけ（表の反応は R を付けない）
        if (!anim) anim = this.planChainEnds(before, g.userMolecule);
        // 直近反応を記録（前後比較・機構ジャンプ・モーフィングで共用）
        this.lastReaction = {
            ruleId: rule.id,
            mechanismId: rule.mechanismId || null,
            label: rule.label,
            before,
            beforeState,
            summoned: summoned ? pending.name : null,   // 呼んだ相手の名前（戻すと相手ごと消える・I-0130）
            after: this.snapshotMolecule(g.userMolecule),
            anim,   // 再生の写し（相手と副生成物つき）。無い反応は null
            beforeReal,   // 画面に出ていた反応前の図（相手を足す前・環を回す前）
            rotation,     // 環を回したとき { ids, cx, cy, theta }。回していなければ null
            /* ▶ もう一度見る（v1568）ための材料。**再生の道を選ぶのに要るものだけ**を控える
             *   （`animateExecution` が `result` から読んでいるもの）。見直しは写しで描くので、キャンバスには触らない */
            replaySrc: {
                morphStages: rule.morphStages || null,
                changed: Array.isArray(result.changed) ? result.changed.slice() : null,
                morphSequence: Array.isArray(result.morphSequence) && result.morphSequence.length ? result.morphSequence : null,
                haworth: this.haworthFlipShots(result).length ? result.haworthRedraws : null
            }
        };
        this._replay = null;   // 前の反応の見直しの段取りは捨てる（次に ▶ を押したときに組み直す）
        this.clearDeadEnd(); // 反応が通ったら、前に出した「ここで止まりました」は用済み（v1420）
        this.clearNoRoom();  // 同じ理由で「置く場所がない」の札も下ろす（v1466）
        if (this._compareOpen) this.closeCompare(); // 前の比較が開いていれば閉じる（次の反応で上書き）
        /* ★ 最初の再生を「見直し」（▶ もう一度見る・v1568）の再生で流す（I-0129・2026-09-24 ユーザー
         *   「反応をコマ送りで再生・巻き戻しできるように」「反応実行したら最初からボタンが出る、最初は自動再生がよい」）。
         *   見直しの再生は 🔄 ⏮ ▶ ⏭ やめる の行を出したまま流れる ＝ 最初の1回から止める・戻す・送るができる。
         *   ⚠ 2段階で**わざと止まる**反応（bondsFirst・moveFirst ＝ 「続きを見る」で進める）は、止まり方が違うので
         *     今までの再生のまま。動きを減らす設定・rAF の無い環境も今までどおり（結果だけ確定） */
        if (this.autoReplayOnExecute !== false && !this._reducedMotion() && typeof requestAnimationFrame === 'function' &&
            !['bondsFirst', 'moveFirst'].includes(rule.morphStages) && this.playExecutionAsReplay(result)) return;
        // 生成物データは確定済み。前→後をモーフィングで見せ、完了後に通常描画＋変化箇所ハイライト
        this.animateExecution(before, this.lastReaction.after, result, rule.morphStages || null, anim,
            { beforeReal, rotation: this.lastReaction.rotation });
    }

    /**
     * 反応の最初の再生を、見直しの再生（`replayPlay`）で流す（I-0129）。
     * `animateExecution` の頭と同じく、生成物を確定表示・視野合わせ・結果の一言を先に済ませてから流す。
     * 終わりの描き戻しと変化箇所のハイライトは `closeReplay` が行う（見直しの終わりと同じ）。
     * 見直しが組めない反応（段取りが無い）では false を返し、呼び手が今までの再生に回す
     */
    playExecutionAsReplay(result) {
        const g = this.game;
        if (!this.canReplay()) return false;
        g.updateDrawing();
        if (result.refit && typeof g.fitCanvasToMolecule === 'function') g.fitCanvasToMolecule(g.userMolecule);
        const r = this.ensureReplay();
        if (!r || !r.tl || !(r.tl.end > 0)) return false;
        g.showToast(result.caption, 6500, 'success');
        return this.replayPlay() !== false;
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
            return { atoms, bonds: after.bonds.map(b => ({ ...b })), labels: after.labels || [] };
        }
        const atoms = before.atoms.map(a => {
            const af = afterById.get(a.id);
            return af ? { ...a, x: af.x, y: af.y } : { ...a };
        });
        return { atoms, bonds: before.bonds.map(b => ({ ...b })), labels: before.labels || [] };
    }

    // スナップショットから一時的な Molecule を作る（中間状態の自動水素を計算するため）
    molFromSnapshot(snap) {
        const m = new Molecule();
        snap.atoms.forEach(a => m.atoms.push(copyAtomMarks(new Atom(a.id, a.element, a.x, a.y), a)));
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
        const tm = this.morphTiming(p.mid, p.after, HS_PLAIN_DURATION);
        animateFramesLoop(
            tm.dur,
            t => { if (this._morphGen === gen) this.renderMorphFrame(p.mid, p.after, tm.warp(t)); },
            () => this._morphSkip || this._morphGen !== gen
        ).then(() => {
            if (this._morphGen !== gen) return;
            this._morphing = false;
            this.game.updateDrawing();
            p.highlight();
        });
        return true;
    }

    /**
     * ★ その段の**尺と時間の進め方**を決める。
     * - 結合が変わる段 … 握手のつなぎ替えを3段（握手していた→離した→握手した）で見せるので
     *   **尺を伸ばし**、時間は**素のまま**渡す（easing は段ごとに `handshakeHandsAt` が持っている）。
     * - 変わらない段（並ぶだけ・折りたたむだけ） … v1539 までと同じ尺・同じ smoothstep。
     */
    morphTiming(before, after, base) {
        const smoothstep = t => t * t * (3 - 2 * t);
        if (!before || !after || !this.handshakeHasChange(before, after)) {
            return { dur: base, warp: smoothstep };
        }
        return { dur: Math.round(base * HS_DURATION / HS_PLAIN_DURATION), warp: t => t };
    }

    /**
     * ★★ 自動水素を**アニメの写しにだけ**本物の H として置く（v1553・ユーザー指摘
     *   「急に原子が入れ替わったようにしか見えない」の残り ＝ C の H が消え、HCl の H が急に出ていた）。
     *
     * 反応前後の図それぞれで `calculateHydrogens()` を回し、H に id を振って前後を突き合わせる:
     *   ① 同じ原子に前後とも付いている H … 向きの近いものどうしを同じ id に（その場に残る・向きだけ変わる）
     *   ② 前だけにある H（離れる手）と後だけにある H（握手する手）… 近いものどうしを同じ id に
     *      ＝ C−H の H が離れて Cl と握手し直し、HCl になる
     *   ③ 後だけにある H が余ったら、2個ずつ **H₂ として反応前の図の右に置く**（水素の付加）
     *   ④ それでも余った H は今までどおりフェードで出入りする（相手の分子を呼んでいない反応）
     * ⚠ `lastReaction` にも `userMolecule` にも H は入れない（前後比較の図・判定・Undo は1つも変わらない）。
     * @returns { before, after, lost, gained } — lost/gained は④で残った本数
     */
    /**
     * ★★ 反応のときに芳香環を回し、反応する置換基を右上へ向ける（v1556・ユーザー決定 2026-09-15
     *   「②反応時に回すようにしましょう。どのみち、反応分子の召喚、整列などで反応前の分子の移動はあります」）。
     *
     * 教科書の本文の反応式では、置換基1つの芳香族でも置換基を**右上**に置く（フェノール → ナトリウムフェノキシド、
     * ニトロベンゼン → アニリン、ジアゾ化。5編 p.179〜201 で約30個）。表・地図・単独の図では真上。
     *
     * 回す／回さないの境界:
     *   ○ 置換基が1つだけの単独のベンゼン環で、**反応するのがその置換基**
     *     （置換基の根元の原子が変わる：-OH の中和・-NH₂ のジアゾ化・側鎖の酸化）
     *     または**置換基が入れ替わる**（環の根元の炭素だけが変わる：クロロベンゼンの加水分解・ジアゾニウムの分解）
     *   × 環そのものが反応する（ニトロ化・臭素化・コルベ・シュミットのオルト位）… 置換基は真上のまま
     *   × 反応するのが側鎖の先（根元の原子が変わらない）… 回さない
     *   × 置換基が2つ以上（サリチル酸・フタル酸の仲間）… 登録の形（右上・右下）を崩さない
     *   × 相手を呼ばない反応・回す角度が 60° の倍数でない（環の頂点が上下でなくなる）・回すと他の分子に重なる
     * ⚠ 見た目だけ（座標の剛体回転）。結合・元素・電荷は触らない ＝ 正準コードは同じ。`_ringTurn = false` で回さない
     * @returns { ids, cx, cy, theta } または null
     */
    turnRingForReaction(rule, before, mol, result) {
        if (this._ringTurn === false) return null;
        const eq = PARTNER_EQUATIONS[rule.id];
        if (!PARTNER_SUMMON[rule.id] && !(eq && eq.partners.length)) return null;
        const changed = new Set((result && result.changed) || []);
        if (!changed.size) return null;
        const G = (typeof GRID_SIZE !== 'undefined') ? GRID_SIZE : 42;
        const bm = this.molFromSnapshot(before);
        let plan = null;
        for (const ring of isolatedBenzeneRings(bm)) {
            const inRing = new Set(ring);
            const subs = [];
            ring.forEach(c => bm.getNeighbors(c).forEach(n => {
                if (!inRing.has(n.atom.id) && n.atom.element !== 'H') subs.push({ c, r: n.atom.id });
            }));
            if (subs.length !== 1) continue;
            const { c, r } = subs[0];
            const ringChanged = ring.filter(id => changed.has(id));
            if (ringChanged.some(id => id !== c)) continue;           // 環そのものが反応する
            /* 置換基の官能基が反応するか ＝ 変わった原子が**環から2結合以内**（根元の原子か、その隣）。
             *   -OH・-NH₂ は根元、-COOH・-SO₃H の O は根元の隣。3結合以上先（2-フェニルエタノールの -OH）は「側鎖の先」 */
            const near = new Set([r]);
            bm.getNeighbors(r).forEach(n => { if (n.atom.id !== c && n.atom.element !== 'H') near.add(n.atom.id); });
            if (![...near].some(id => changed.has(id)) && !ringChanged.length) continue;
            const C = bm.atoms.find(a => a.id === c), R = bm.atoms.find(a => a.id === r);
            let theta = -Math.PI / 6 - Math.atan2(R.y - C.y, R.x - C.x);
            while (theta > Math.PI) theta -= 2 * Math.PI;
            while (theta < -Math.PI) theta += 2 * Math.PI;
            const step = Math.PI / 3;
            if (Math.abs(theta) < 0.05 || Math.abs(theta - Math.round(theta / step) * step) > 0.05) continue;
            const cx = ring.reduce((s, id) => s + bm.atoms.find(a => a.id === id).x, 0) / 6;
            const cy = ring.reduce((s, id) => s + bm.atoms.find(a => a.id === id).y, 0) / 6;
            plan = { c, theta: Math.round(theta / step) * step, cx, cy };
            break;
        }
        if (!plan) return null;
        // 回す原子: 反応前・反応後それぞれの分子と、そのそばの対イオンの粒
        const withIons = (m) => {
            if (!m.atoms.some(a => a.id === plan.c)) return new Set();
            const comp = componentOf(m, plan.c);
            const bonded = new Set();
            m.bonds.forEach(b => { bonded.add(b.atomId1); bonded.add(b.atomId2); });
            const compAtoms = m.atoms.filter(a => comp.has(a.id));
            /* ⚠ 対イオンの粒は `placeCounterIon` が空き位置の**2倍の遠さ**（約 84px）に置く。
             *   1.6 マスで拾うと Cl⁻ を置き去りにし、回した -N≡N が Cl⁻ に 31px まで近づいて回すのをやめていた
             *   （実測: アニリンのジアゾ化）。2.2 マスまで拾う */
            m.atoms.forEach(a => {
                if (bonded.has(a.id) || !a.charge) return;
                if (compAtoms.some(x => Math.hypot(x.x - a.x, x.y - a.y) <= G * 2.2)) comp.add(a.id);
            });
            return comp;
        };
        const ids = new Set([...withIons(bm), ...withIons(mol)]);
        const cs = Math.cos(plan.theta), sn = Math.sin(plan.theta);
        const turn = p => {
            const dx = p.x - plan.cx, dy = p.y - plan.cy;
            return { x: plan.cx + dx * cs - dy * sn, y: plan.cy + dx * sn + dy * cs };
        };
        // 回したあとに他の原子へ近づきすぎないか（反応前・反応後の両方で）
        const ok = [before.atoms, mol.atoms].every(list => {
            const moved = list.filter(a => ids.has(a.id) && a.element !== 'H').map(turn);
            const rest = list.filter(a => !ids.has(a.id) && a.element !== 'H');
            return moved.every(p => rest.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= G * 0.9));
        });
        if (!ok) return null;
        [before.atoms, mol.atoms].forEach(list => list.forEach(a => {
            if (!ids.has(a.id)) return;
            const p = turn(a);
            a.x = p.x; a.y = p.y;
        }));
        return { ids: [...ids], cx: plan.cx, cy: plan.cy, theta: plan.theta };
    }

    /**
     * ★★ 反応式ぶんの相手と副生成物を、再生の写しにだけ置く（v1556・`PARTNER_EQUATIONS` の注記）。
     * `apply` のあとに呼ぶ。`reuse` の付け替えだけは `mol` の id を書き換える（元素・結合・電荷は触らない）。
     * @returns { before, after, transient, renames, counts, hGap } または null（表に無い／収支が合わない ＝ 今までどおり）
     */
    /**
     * ★★ 並べた単量体をつないだ生成物を、**単量体が並んでいた場所へ戻す**（I-0077・2026-09-23）。
     *
     * ユーザーの原則「反応の前後の変化は、できるだけ結合のみの最小限にする」。
     * **症状**（v1622 の実測・3個並べて重合）: イソプレンは左の単量体が右端へ行き（並びが左右反転）、
     *   鎖全体が最大 826px 右へずれた。エチレン・スチレンも左の単量体が右へ 84〜270px 寄った。
     *   ⚠ 原因は各 `apply` が**1個目の単量体を起点に鎖を伸ばす**（`planAttachment`・`linkVinylUnits`・
     *   `layoutDieneChain`）ことで、伸びる向きが単量体の頭尾で決まり、画面の並びを見ていないこと。
     * ★ 直し方: `apply` の中身（鎖の形・置換基の倒し方・シス形）には1つも触らず、できた生成物を
     *   **剛体として**動かす ＝ 「そのまま」「左右の鏡映」「180° 回転」＋平行移動のうち、**各単量体の重心が
     *   反応前の重心にいちばん近くなるもの**を採る（最小二乗）。
     *   - 鏡映は左右だけ（上下を返すと PM15 の「置換基は真下」が上になる）。E/Z は鏡映で変わらない
     *   - ⚠ フィッシャー投影やハース環の立体を持つ分子は**鏡映しない**（座標から読む立体が反転する）。
     *     その代わりに **180° 回転**を試す（回転は立体を保つ）。スチレンの CH は座標から読むと
     *     不斉中心になるので、SBR（共重合）はこちらで並びが戻る
     *   - 平行移動は1原子が格子に乗るように丸める
     *   - 動かした先で**ほかの分子に重なるなら動かさない**（今までどおりの図になるだけ）
     * `_settleInPlace = false` で今までどおり（否定対照）。
     * @returns 動かしたら { shape: 'none'|'mirror'|'rotate', dx, dy }、動かさなければ null
     */
    settleInPlace(before, mol) {
        if (this._settleInPlace === false) return null;
        const G = (typeof GRID_SIZE !== 'undefined') ? GRID_SIZE : 42;
        // 反応前の成分（＝ 並べた単量体1個ずつ）
        const parent = new Map(before.atoms.map(a => [a.id, a.id]));
        const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
        before.bonds.forEach(b => {
            if (!parent.has(b.atomId1) || !parent.has(b.atomId2)) return;
            const r1 = find(b.atomId1), r2 = find(b.atomId2);
            if (r1 !== r2) parent.set(r1, r2);
        });
        const bPos = new Map(before.atoms.map(a => [a.id, a]));
        const atomById = new Map(mol.atoms.map(a => [a.id, a]));
        const done = new Set();
        let moved = null;
        mol.atoms.forEach(start => {
            if (done.has(start.id)) return;
            const comp = componentOf(mol, start.id);
            comp.forEach(id => done.add(id));
            // 反応前の成分ごとに、前と後の重心を集める
            const units = new Map();
            comp.forEach(id => {
                const b = bPos.get(id);
                if (!b) return;
                const a = atomById.get(id);
                const k = find(id);
                if (!units.has(k)) units.set(k, { bx: 0, by: 0, ax: 0, ay: 0, n: 0 });
                const u = units.get(k);
                u.bx += b.x; u.by += b.y; u.ax += a.x; u.ay += a.y; u.n++;
            });
            if (units.size < 2) return; // 2個以上がつながった生成物だけ
            const P = [], Q = [];
            units.forEach(u => { P.push([u.bx / u.n, u.by / u.n]); Q.push([u.ax / u.n, u.ay / u.n]); });
            const atoms = [...comp].map(id => atomById.get(id));
            const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
            const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
            const sub = new Molecule();
            const idMap = new Map();
            atoms.forEach(a => { const na = sub.addAtom(a.element, a.x, a.y); copyAtomMarks(na, a); idMap.set(a.id, na.id); });
            mol.bonds.forEach(b => {
                if (idMap.has(b.atomId1) && idMap.has(b.atomId2)) sub.addBond(idMap.get(b.atomId1), idMap.get(b.atomId2), b.type);
            });
            const chiral = atoms.some(a => a.haworthFace === 1 || a.haworthFace === -1) ||
                (typeof readAtomParityFromFischer === 'function' && Object.keys(readAtomParityFromFischer(sub) || {}).length > 0);
            const mean = (arr) => [arr.reduce((s, p) => s + p[0], 0) / arr.length, arr.reduce((s, p) => s + p[1], 0) / arr.length];
            // 形の変え方: そのまま／左右の鏡映／180° 回転（回転は立体を保つので、鏡映できない分子の代わり）
            const shapes = {
                none: (x, y) => [x, y],
                mirror: (x, y) => [2 * cx - x, y],
                rotate: (x, y) => [2 * cx - x, 2 * cy - y]
            };
            const plan = (kind) => {
                const Qm = Q.map(([x, y]) => shapes[kind](x, y));
                const mp = mean(P), mq = mean(Qm);
                const t = [mp[0] - mq[0], mp[1] - mq[1]];
                const cost = Qm.reduce((s, q, i) => s + (q[0] + t[0] - P[i][0]) ** 2 + (q[1] + t[1] - P[i][1]) ** 2, 0);
                return { kind, t, cost };
            };
            let best = plan('none');
            // 鏡映を先に試す（上下を保つ ＝ PM15 の「置換基は真下」が崩れない）。回転は鏡映できないときだけ
            for (const kind of chiral ? ['rotate'] : ['mirror', 'rotate']) {
                const m = plan(kind);
                if (m.cost < best.cost * 0.8 && (best.kind === 'none' || m.cost < best.cost)) { best = m; break; }
            }
            // 格子に乗せる（最初の原子を基準に平行移動を丸める）
            const ref = atoms[0];
            const [r0x, r0y] = shapes[best.kind](ref.x, ref.y);
            const rx = r0x + best.t[0], ry = r0y + best.t[1];
            best.t[0] += Math.round(rx / G) * G - rx;
            best.t[1] += Math.round(ry / G) * G - ry;
            const to = (a) => { const [x, y] = shapes[best.kind](a.x, a.y); return [x + best.t[0], y + best.t[1]]; };
            const shift = atoms.reduce((m, a) => { const [x, y] = to(a); return Math.max(m, Math.hypot(x - a.x, y - a.y)); }, 0);
            if (shift < 1) return;
            // 動かした先でほかの分子に重なるなら動かさない
            const others = mol.atoms.filter(a => !comp.has(a.id));
            const clash = atoms.some(a => {
                const [x, y] = to(a);
                return others.some(o => Math.hypot(o.x - x, o.y - y) < G * 0.75);
            });
            if (clash) return;
            atoms.forEach(a => { const [x, y] = to(a); a.x = x; a.y = y; });
            moved = { shape: best.kind, dx: Math.round(best.t[0]), dy: Math.round(best.t[1]) };
        });
        return moved;
    }

    /**
     * ★★ 重合の鎖の端の R を、反応前の図に「鎖の続き」として置く（v1574・ユーザー決定 2026-09-17「7.進める」）。
     *
     * **症状**: 付加重合・ジエン・ポリアセチレン・共重合・開環重合・縮合重合で、`apply` が鎖の両端に付ける
     *   R（「この先も同じ単位が続く」印）が、再生の途中で**何も無い所から急に出ていた**。
     *
     * ★ **選んだ形: R を反応前の図に、つながる端のそばへ離して置き、再生の握手で結合させる**。
     *   R が表すのは**となりに続く単量体（鎖のほかの部分）**。二重結合（開環重合ならアミド結合）が開いて
     *   となりとつながる、という重合の中身は端でも中でも同じなので、「端の炭素が R と新しく手をつなぐ」は
     *   化学としてそのまま正しい。
     *   ⚠ **採らなかった形**: R を最初から端に付けて薄く出しておく。反応前の単量体に R が付いている図になり、
     *     「単量体がもう鎖の一部だった」と読めてしまう（エチレンの図が R−CH₂−CH₂ に見える）。
     *
     * ⚠ **再生の写しにだけ置く**（`playbackOnly`）。キャンバス・生成物・正準コードは `apply` のまま。
     *   ⚠ 前後比較は今までどおり `lastReaction.before/after`（反応式の行も出さない）——
     *   R は反応式の物質ではないので、左辺に「2R」と並べると誤解になる。
     * ⚠ R には水素を生やさない（`bare`。1価なので、生やすと R−H に見える）。
     * `_chainEndSummon = false` で今までどおり（否定対照）。
     * @returns 再生の写し、または null（新しく出る R が無い）
     */
    planChainEnds(before, mol) {
        if (this._chainEndSummon === false) return null;
        const G = (typeof GRID_SIZE !== 'undefined') ? GRID_SIZE : 42;
        const bPos = new Map(before.atoms.map(a => [a.id, a]));
        const rs = mol.atoms.filter(a => a.element === 'R' && !bPos.has(a.id));
        if (!rs.length) return null;
        const occ = before.atoms.filter(a => a.element !== 'H');
        const segs = before.bonds.map(b => [bPos.get(b.atomId1), bPos.get(b.atomId2)]).filter(([p, q]) => p && q);
        const hs = this.molFromSnapshot(before).calculateHydrogens();
        const placed = [];
        const ends = [];
        for (const r of rs) {
            const nb = mol.getNeighbors(r.id).map(n => n.atom).find(a => bPos.has(a.id));
            if (!nb) return null;
            const cb = bPos.get(nb.id);
            const L = Math.hypot(r.x - nb.x, r.y - nb.y) || 1;
            const ux = (r.x - nb.x) / L, uy = (r.y - nb.y) / L;
            const clear = p => occ.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= G * 1.1) &&
                hs.every(h => Math.hypot(h.x - p.x, h.y - p.y) >= G * 0.8) &&
                placed.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= G * 1.1) &&
                segs.every(([p1, p2]) => pointSegmentDistance(p, p1, p2) >= G * 0.6);
            // 鎖の延長（向きそのまま）を遠くまで先に試し、ふさがっていれば向きを振る ＝ R が鎖の軸の上に来やすい
            let spot = null;
            for (const deg of [0, 30, -30, 60, -60, 90, -90]) {
                for (const k of [1.75, 2.25, 2.75, 3.5]) {
                    const th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
                    const p = { x: cb.x + (ux * c - uy * s) * G * k, y: cb.y + (ux * s + uy * c) * G * k };
                    if (clear(p)) { spot = p; break; }
                }
                if (spot) break;
            }
            if (!spot) spot = { x: cb.x + ux * G * 1.75, y: cb.y + uy * G * 1.75 };
            placed.push(spot);
            ends.push({ id: r.id, element: 'R', x: spot.x, y: spot.y, charge: 0, bare: true });
        }
        const animBefore = { atoms: before.atoms.map(a => ({ ...a })).concat(ends), bonds: before.bonds.map(b => ({ ...b })) };
        return {
            before: animBefore, after: this.snapshotMolecule(mol),
            transient: [], renames: new Map(), counts: null, hGap: 0,
            foldedPartnerIds: [], foldedByproductIds: [], foldedH: 0,
            playbackOnly: true
        };
    }

    planEquation(ruleId, before, mol, result, rotation) {
        const eq = PARTNER_EQUATIONS[ruleId];
        if (!eq) return null;
        const G = (typeof GRID_SIZE !== 'undefined') ? GRID_SIZE : 42;
        const heavy = a => a.element !== 'H';
        const bIds = new Set(before.atoms.map(a => a.id));
        const mIds = new Set(mol.atoms.map(a => a.id));
        const P0 = mol.atoms.filter(a => heavy(a) && !bIds.has(a.id));
        const X0 = before.atoms.filter(a => heavy(a) && !mIds.has(a.id));
        // ① 付け替え（消えた原子と湧いた原子を同じ原子として見せる）。近いものどうし・座標で順を決める
        const pairs = [];
        (eq.reuse || []).forEach(el => {
            const cand = [];
            P0.filter(a => a.element === el).forEach(p => X0.filter(a => a.element === el)
                .forEach(x => cand.push({ p, x, d: Math.hypot(p.x - x.x, p.y - x.y) })));
            cand.sort((u, v) => u.d - v.d || u.p.x - v.p.x || u.p.y - v.p.y || u.x.x - v.x.x || u.x.y - v.x.y);
            const up = new Set(), ux = new Set();
            cand.forEach(({ p, x }) => {
                if (up.has(p.id) || ux.has(x.id)) return;
                up.add(p.id); ux.add(x.id);
                pairs.push({ from: p.id, to: x.id });
            });
        });
        const pairedP = new Set(pairs.map(q => q.from)), pairedX = new Set(pairs.map(q => q.to));
        const pops = P0.filter(a => !pairedP.has(a.id));
        const gones = X0.filter(a => !pairedX.has(a.id));
        const need = {};
        pops.forEach(a => { need[a.element] = (need[a.element] || 0) + 1; });
        gones.forEach(a => { need[a.element] = (need[a.element] || 0) - 1; });
        need.H = mol.calculateHydrogens().length - this.molFromSnapshot(before).calculateHydrogens().length;
        if (!pops.length && !gones.length && !need.H && !pairs.length) return null;
        const sol = solveEquation(eq, need);
        if (!sol) return null;

        // ② 型を個数ぶん並べ、湧いた原子を相手の枠へ（つながりごと）
        const mk = (name) => ({
            name,
            slots: RX_SPECIES[name].atoms.map(([el, dx, dy, ch, mark]) => ({
                el, dx, dy, charge: ch || 0, bare: !!(mark && mark.bare), label: (mark && mark.label) || null, id: null })),
            bonds: RX_SPECIES[name].bonds.map(b => b.slice())
        });
        const partners = [], byproducts = [];
        eq.partners.forEach(n => { for (let i = 0; i < sol.counts[n]; i++) partners.push(mk(n)); });
        eq.byproducts.forEach(n => { for (let i = 0; i < sol.counts[n]; i++) byproducts.push(mk(n)); });
        const molEl = new Map(mol.atoms.map(a => [a.id, a.element]));
        const molEdges = mol.bonds.map(b => [b.atomId1, b.atomId2]);
        for (const { comp, edges } of rxComponents(pops.map(a => a.id), molEdges)) {
            const hit = rxEmbed(comp, edges, id => molEl.get(id), partners);
            if (!hit) return null;
            rxAssign(hit, partners);
        }
        // ③ 相手の余った枠と、消えた原子を、副生成物の枠へ（つながりごと）
        let seq = 0;
        const fresh = () => `rxeq_${seq++}`;
        const srcEl = new Map();
        const srcEdges = [];
        gones.forEach(a => srcEl.set(a.id, a.element));
        before.bonds.forEach(b => {
            if (srcEl.has(b.atomId1) && srcEl.has(b.atomId2)) srcEdges.push([b.atomId1, b.atomId2]);
        });
        partners.forEach(inst => {
            inst.slots.forEach(s => { if (s.id === null) { s.id = fresh(); s.fresh = true; if (s.el !== 'H') srcEl.set(s.id, s.el); } });
            inst.bonds.forEach(([i, j]) => {
                if (inst.slots[i].fresh && inst.slots[j].fresh) srcEdges.push([inst.slots[i].id, inst.slots[j].id]);
            });
        });
        // 明示の H の枠（½H₂）は水素の突き合わせ（withMorphHydrogens）が埋める
        byproducts.forEach(inst => inst.slots.forEach(s => { if (s.el === 'H') s.id = fresh(); }));
        for (const { comp, edges } of rxComponents([...srcEl.keys()], srcEdges)) {
            const hit = rxEmbed(comp, edges, id => srcEl.get(id), byproducts);
            if (!hit) return null;
            rxAssign(hit, byproducts);
        }
        if (byproducts.some(inst => inst.slots.some(s => s.id === null))) return null;

        /* ★★ 係数の大きい相手・副生成物は**1つだけ描いて「×n」の札を添える**（v1560・ユーザー「それでやってみましょう」）。
         *   境界: 同じ種類が **3個以上**（RX_FOLD_MIN）のときだけまとめる。
         *   ⚠ **まとめない**: 仮の [O]（1個ずつ基質の決まった原子と握手する）・v1553 の `PARTNER_SUMMON`
         *     （Br₂×3・Cl₂×3 は基質の別々の位置と握手する ＝ まとめると原子が急に出るのが戻る）・2個まで（見える）。
         *   ⚠ まとめたぶんの握手は見えない ＝ 急に出る／消える原子が出る。**どの原子がそうなるかを記録する**:
         *     foldedPartnerIds … まとめて描かなかった相手の原子（生成物に入るものは急に出る）
         *     foldedByproductIds … まとめて描かなかった副生成物の原子（基質から出ていくものは急に消える）
         *   RXP3・RXN1 は、急に出る／消える原子がこの記録の中に収まることを見る（外に1つでもあれば赤）。
         *   `_foldCopies = false` でまとめない（否定対照） */
        const foldedPartnerIds = [], foldedByproductIds = [];
        let foldedH = 0;
        const foldCopies = (list, visible, sink) => {
            const byName = new Map();
            list.forEach(inst => { if (!byName.has(inst.name)) byName.set(inst.name, []); byName.get(inst.name).push(inst); });
            byName.forEach((insts, name) => {
                if (this._foldCopies === false || insts.length < RX_FOLD_MIN || RX_NO_FOLD.has(name)) return;
                const rep = insts.slice().sort((a, b) => visible(b) - visible(a))[0];
                rep.mult = insts.length;
                insts.forEach(inst => {
                    if (inst === rep) return;
                    inst.folded = true;
                    inst.slots.forEach(s => sink.push(s.id));
                    foldedH += rxSpeciesCount(name).H;
                });
            });
            for (let i = list.length - 1; i >= 0; i--) if (list[i].folded) list.splice(i, 1);
        };
        // 描く1つは、生成物と握手する原子（湧いた原子）をいちばん多く持つもの
        foldCopies(partners, inst => inst.slots.filter(s => !s.fresh).length, foldedPartnerIds);
        const foldedP = new Set(foldedPartnerIds);
        const goneIds = new Set(gones.map(a => a.id));
        // 副生成物は、描いた相手・基質から来る原子をいちばん多く持つもの
        foldCopies(byproducts, inst => inst.slots.filter(s => goneIds.has(s.id) ||
            (s.id && !foldedP.has(s.id) && String(s.id).startsWith('rxeq_'))).length, foldedByproductIds);

        // ④ 置き場: 反応する場所のそばの空いた所（反応前・反応後どちらの図とも重ならない）
        const bPos = new Map(before.atoms.map(a => [a.id, a]));
        const mPos = new Map(mol.atoms.map(a => [a.id, a]));
        const occA = [], occS = [];
        const occupy = (atoms, bonds) => {
            const pos = new Map(atoms.filter(heavy).map(a => [a.id, a]));
            pos.forEach(p => occA.push(p));
            bonds.forEach(b => { const p = pos.get(b.atomId1), q = pos.get(b.atomId2); if (p && q) occS.push([p, q]); });
        };
        occupy(before.atoms, before.bonds);
        occupy(mol.atoms, mol.bonds);
        /* ★★ 環を**回している途中**の位置も避ける（v1584・ニトロ基の還元で実測）。
         *
         * ⚠⚠ 回すのは相手を置く**前**（`execute`）なので、`before` / `mol` は**回し終わった図**。
         *   ⛔ 終わりの図だけで空きを探すと、**回っている最中に置換基が相手の上を通る** ——
         *   ⓵ 実測: ニトロベンゼンの還元（環を 60° 回す）で、呼んだ H₂ の H の丸に
         *      ニトロ基の O とその手が **5 コマ**重なった（`bigHydrogenOverlaps`・T=0.50〜0.55）。
         *   ⚠ `buildPlayback` の「道筋を曲げる」（`_bendAvoid`）は**握手の段（T=1→2）だけ**で、
         *      置き直しの段（T=0→1・回すのはここ）には掛かっていない ＝ あちらでは直せない。
         * ★ だから**置き場のほうで**避ける ——
         *   終わりの位置から角を**戻しながら**数コマぶんの位置と手を占有に足す ＝ 掃いた跡ごと空けさせる。
         * ⚠ `_sweepAvoid = false` で今までどおり（否定対照）。 */
        if (rotation && rotation.theta && this._sweepAvoid !== false) {
            const back = (p, th) => {
                const co = Math.cos(th), si = Math.sin(th);
                const dx = p.x - rotation.cx, dy = p.y - rotation.cy;
                return { x: rotation.cx + dx * co - dy * si, y: rotation.cy + dx * si + dy * co };
            };
            const turning = new Set(rotation.ids || []);
            [before, mol].forEach(snap => {
                const movers = snap.atoms.filter(a => heavy(a) && turning.has(a.id));
                if (!movers.length) return;
                for (let k = 1; k < RX_SWEEP_STEPS; k++) {
                    const at = new Map(movers.map(a => [a.id, back(a, -rotation.theta * k / RX_SWEEP_STEPS)]));
                    at.forEach(p => occA.push(p));
                    snap.bonds.forEach(b => {
                        const p = at.get(b.atomId1), q = at.get(b.atomId2);
                        if (p && q) occS.push([p, q]);
                    });
                }
            });
        }
        /* ★ 水素の位置も避ける（v1556）。反応する H は大きな丸になって 28px まで伸びるので、
         *   相手が H のすぐ外に居ると丸どうしが重なる */
        const occH = this.molFromSnapshot(before).calculateHydrogens().concat(mol.calculateHydrogens());
        const centroid = pts => pts.length
            ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } : null;
        const changed = (result && result.changed) || [];
        const center = centroid(changed.map(id => bPos.get(id)).filter(Boolean)) ||
            centroid(changed.map(id => mPos.get(id)).filter(Boolean)) ||
            centroid(before.atoms.filter(heavy));
        const place = (inst, anchor) => {
            const offs = inst.slots.map(s => ({ x: s.dx * G, y: s.dy * G }));
            const c0 = centroid(offs);
            let heavySlots = inst.slots.map((s, k) => (s.el === 'H' ? -1 : k)).filter(k => k >= 0);
            /* ★ 重原子の無い相手（H₂・v1574）は H の枠を重原子と同じに避けさせる。
             *   空のままだと当たり判定が素通りし、分子の真上に置かれる */
            if (!heavySlots.length) heavySlots = inst.slots.map((s, k) => k);
            let found = null;
            const step = G / 2;
            for (let r = 0; r <= 24 && !found; r++) {
                let bestD = Infinity;
                for (let i = -r; i <= r; i++) {
                    for (let j = -r; j <= r; j++) {
                        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
                        const px = anchor.x + i * step - c0.x, py = anchor.y + j * step - c0.y;
                        const pts = offs.map(o => ({ x: px + o.x, y: py + o.y }));
                        const ok = heavySlots.every(k => occA.every(q => Math.hypot(q.x - pts[k].x, q.y - pts[k].y) >= G * 1.25) &&
                                occH.every(q => Math.hypot(q.x - pts[k].x, q.y - pts[k].y) >= G * 1.1) &&
                                occS.every(([a, b]) => pointSegmentDistance(pts[k], a, b) >= G * 0.75)) &&
                            inst.bonds.every(([a, b]) => occA.every(q => pointSegmentDistance(q, pts[a], pts[b]) >= G * 0.75));
                        const d = Math.hypot(i, j);
                        if (ok && d < bestD) { bestD = d; found = pts; }
                    }
                }
            }
            if (!found) {
                const maxX = Math.max(...occA.map(p => p.x));
                found = offs.map(o => ({ x: maxX + G * 3 + o.x - c0.x, y: anchor.y + o.y - c0.y }));
            }
            inst.slots.forEach((s, k) => { s.x = found[k].x; s.y = found[k].y; });
            heavySlots.forEach(k => occA.push(found[k]));
            inst.bonds.forEach(([a, b]) => occS.push([found[a], found[b]]));
        };
        partners.forEach(inst => {
            const own = inst.slots.filter(s => !s.fresh).map(s => mPos.get(s.id)).filter(Boolean);
            place(inst, centroid(own) || center);
        });
        const slotPos = new Map();
        partners.forEach(inst => inst.slots.forEach(s => slotPos.set(s.id, s)));
        byproducts.forEach(inst => {
            const src = inst.slots.map(s => slotPos.get(s.id) || bPos.get(s.id)).filter(Boolean);
            place(inst, centroid(src) || center);
        });

        // ⑤ ここで初めて mol を触る（付け替えだけ）。途中で null を返した回は何も変えていない
        const renames = new Map();
        pairs.forEach(({ from, to }) => { if (renameAtomId(mol, from, to)) renames.set(from, to); });
        const snapAtom = (s) => Object.assign({ id: s.id, element: s.el, x: s.x, y: s.y, charge: s.charge },
            s.bare ? { bare: true } : {}, s.label ? { label: s.label } : {});
        const put = (snap, list) => list.forEach(inst => {
            inst.slots.forEach(s => snap.atoms.push(snapAtom(s)));
            inst.bonds.forEach(([i, j, t]) => snap.bonds.push({ atomId1: inst.slots[i].id, atomId2: inst.slots[j].id, type: t }));
        });
        const animBefore = { atoms: before.atoms.map(a => ({ ...a })), bonds: before.bonds.map(b => ({ ...b })) };
        put(animBefore, partners);
        const animAfter = this.snapshotMolecule(mol);
        put(animAfter, byproducts);
        // 「×n」の札: 描いた1つの右上。原子に結びつけておく（再生で原子と一緒に動く）
        const labelOf = inst => {
            const heavySlot = inst.slots.find(s => s.el !== 'H') || inst.slots[0];
            const maxX = Math.max(...inst.slots.map(s => s.x)), minY = Math.min(...inst.slots.map(s => s.y));
            return { id: heavySlot.id, dx: maxX - heavySlot.x + 18, dy: minY - heavySlot.y - 14, text: `×${inst.mult}` };
        };
        animBefore.labels = partners.filter(i => i.mult).map(labelOf);
        animAfter.labels = byproducts.filter(i => i.mult).map(labelOf);
        return {
            before: animBefore, after: animAfter,
            transient: byproducts.flatMap(inst => inst.slots.map(s => s.id)),
            renames, counts: sol.counts, hGap: sol.hGap,
            foldedPartnerIds, foldedByproductIds, foldedH
        };
    }

    withMorphHydrogens(before, after) {
        const G = (typeof GRID_SIZE !== 'undefined') ? GRID_SIZE : 42;
        /* 写しに**明示の H**（`summonReactionPartner` が HNO₃ に置く H）があれば、それも水素の一覧に入れ、
         * 図からは外す ＝ 自動水素と同じ突き合わせに乗る。
         * ★ 結合の無い明示の H（v1556・½H₂ の副生成物）は親なしの手として扱う */
        const splitH = snap => {
            const hs = snap.atoms.filter(a => a.element === 'H');
            if (!hs.length) return { snap, explicit: [] };
            const hid = new Set(hs.map(a => a.id));
            /* ★ H−H（写しに置いた H₂・v1574）は**親なしの手**にし、相方を覚えておく。
             *   親を相方の H にすると、その H は図から外すので結合の端点が宙に浮く。
             *   H₂ の結合は、両方に新しい id が付いたあとで結び直す（下の ⑤） */
            const byId = new Map();
            const explicit = hs.map(a => {
                const b = snap.bonds.find(x => x.atomId1 === a.id || x.atomId2 === a.id);
                const other = b ? (b.atomId1 === a.id ? b.atomId2 : b.atomId1) : null;
                const e = { parentId: other && !hid.has(other) ? other : null, x: a.x, y: a.y, mateId: other && hid.has(other) ? other : null };
                byId.set(a.id, e);
                return e;
            });
            explicit.forEach(e => { if (e.mateId) { e.mate = byId.get(e.mateId); delete e.mateId; } else delete e.mateId; });
            return { snap: { atoms: snap.atoms.filter(a => !hid.has(a.id)),
                bonds: snap.bonds.filter(b => !hid.has(b.atomId1) && !hid.has(b.atomId2)) }, explicit };
        };
        const labB = before.labels || [], labA = after.labels || [];
        const sb = splitH(before), sa = splitH(after);
        before = sb.snap; after = sa.snap;
        /* ★ `bare` の原子（仮の [O]・金属の Na）には自動水素を生やさない（v1556） */
        const hsOf = (snap, extra) => {
            const bare = new Set(snap.atoms.filter(a => a.bare).map(a => a.id));
            return this.molFromSnapshot(snap).calculateHydrogens().filter(h => !bare.has(h.parentId)).concat(extra);
        };
        const bpos = new Map(before.atoms.map(a => [a.id, a]));
        const apos = new Map(after.atoms.map(a => [a.id, a]));
        const groupOf = list => {
            const m = new Map();
            list.forEach(h => { if (!m.has(h.parentId)) m.set(h.parentId, []); m.get(h.parentId).push(h); });
            return m;
        };
        const gb = groupOf(hsOf(before, sb.explicit)), ga = groupOf(hsOf(after, sa.explicit));
        const ang = (p, h) => Math.atan2(h.y - p.y, h.x - p.x);
        let seq = 0;
        const nid = () => `morphH_${seq++}`;
        const B = [], A = [], lost = [], gained = [];
        /* ★★ **反応する H は図の位置で選ぶ**（v1556・ユーザー指示 2026-09-15
         * 「分子内脱水では…構造式の位置関係によって、OHと反応させられる（同じ側の）H原子は限定されます」
         * 「置換反応では、反応するH原子を選ぶ余地があります。反応相手のCl2などが近づくスペースも必要です」）。
         *   H を失う原子の H のうち、**H を受け取る原子（水になる O・HCl になる Cl）の反応前の位置にいちばん近い H**
         *   を「離れる手」に先に決める。残りの H は今までどおり向きの近いものどうしで組む。
         * ⚠ 選べるのは**同じ原子に付いた H の中だけ**（どの炭素から抜けるかは `apply` が決めている）
         *   ＝ 生成物・正準コードは変わらない。`_hChoice = false` で今までの選び方に戻る（否定対照） */
        const gainPts = [];
        new Set([...gb.keys(), ...ga.keys()]).forEach(pid => {
            if ((ga.get(pid) || []).length > (gb.get(pid) || []).length && bpos.has(pid)) {
                gainPts.push({ pid, p: bpos.get(pid) });
            }
        });
        // ⚠ 親の走査順は id の並びで固定する（Map の挿入順＝原子の並びに頼ると、同じ反応で組み方が揺れる）
        [...new Set([...gb.keys(), ...ga.keys()])].sort().forEach(pid => {
            const lb = gb.get(pid) || [], la = ga.get(pid) || [];
            const ui = new Set(), uj = new Set();
            if (bpos.has(pid) && apos.has(pid)) {
                const dropSet = new Set();
                const pts = gainPts.filter(q => q.pid !== pid);
                if (lb.length > la.length && pts.length && this._hChoice !== false) {
                    const near = h => Math.min(...pts.map(q => Math.hypot(h.x - q.p.x, h.y - q.p.y)));
                    lb.map((h, i) => i)
                        .sort((i, j) => near(lb[i]) - near(lb[j]) || lb[i].x - lb[j].x || lb[i].y - lb[j].y)
                        .slice(0, lb.length - la.length)
                        .forEach(i => dropSet.add(i));
                }
                const cand = [];
                lb.forEach((h, i) => { if (!dropSet.has(i)) la.forEach((k, j) => cand.push({
                    i, j, d: hsAngleGap(ang(bpos.get(pid), h), ang(apos.get(pid), k)) })); });
                cand.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j);
                cand.forEach(c => {
                    if (ui.has(c.i) || uj.has(c.j)) return;
                    ui.add(c.i); uj.add(c.j);
                    const id = nid();
                    B.push({ id, h: lb[c.i], p: pid });
                    A.push({ id, h: la[c.j], p: pid });
                });
            }
            lb.forEach((h, i) => { if (!ui.has(i)) lost.push({ h, p: pid }); });
            la.forEach((h, j) => { if (!uj.has(j)) gained.push({ h, p: pid }); });
        });
        // ② 離れる手と握手する手を、近いものどうしで組む
        const cand = [];
        lost.forEach((L, i) => gained.forEach((K, j) => cand.push({
            i, j, d: Math.hypot(L.h.x - K.h.x, L.h.y - K.h.y) })));
        cand.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j);
        const usedL = new Set(), usedG = new Set();
        const lg = [];
        cand.forEach(c => {
            if (usedL.has(c.i) || usedG.has(c.j)) return;
            usedL.add(c.i); usedG.add(c.j);
            lg.push([c.i, c.j]);
        });
        /* ★★ **交差をほどく**（2-opt・v1584）。⚠ 上の組み方は「近いものから順に取る」だけなので、
         *   ⛔ **合計がいちばん短い組み方にならないことがある** ——
         *   ⓵ 実測（ニトロベンゼンの還元）: N に付く2つの H を 59＋116 で組んでいたが、
         *      入れ替えると 70＋84。★ 長いほうの H が **N を突き抜けて反対側へ回り込んで**いた
         *      （`bigHydrogenOverlaps` で N の丸の中に入るコマが出る）。
         * ★ 2つの組を入れ替えて合計が短くなるなら入れ替える ＝ **交差している組は必ずほどける**
         *   （交差する2線分は、つなぎ替えると必ず合計が短くなる）。
         * ⚠ `_hSwap = false` で今までどおり（否定対照）。⚠ 順は `cand` の並びで固定 ＝ 結果は毎回同じ。 */
        if (this._hSwap !== false && lg.length > 1) {
            const dLG = (i, j) => Math.hypot(lost[i].h.x - gained[j].h.x, lost[i].h.y - gained[j].h.y);
            for (let pass = 0; pass < lg.length; pass++) {
                let moved = false;
                for (let u = 0; u < lg.length; u++) {
                    for (let v = u + 1; v < lg.length; v++) {
                        const [i1, j1] = lg[u], [i2, j2] = lg[v];
                        if (dLG(i1, j2) + dLG(i2, j1) < dLG(i1, j1) + dLG(i2, j2) - 0.01) {
                            lg[u] = [i1, j2]; lg[v] = [i2, j1]; moved = true;
                        }
                    }
                }
                if (!moved) break;
            }
        }
        lg.forEach(([i, j]) => {
            const id = nid();
            B.push({ id, h: lost[i].h, p: lost[i].p });
            A.push({ id, h: gained[j].h, p: gained[j].p });
        });
        const restL = lost.filter((L, i) => !usedL.has(i));
        let restG = gained.filter((K, j) => !usedG.has(j));
        // ③ 余った「握手する手」は H₂ として呼ぶ（2個ずつ）
        // ⚠ ただし `RX_NO_MORPH_H2` の反応は呼ばない（発注書 K。加硫で H₂ は出入りしない）
        const extraBonds = [];
        const noH2 = RX_NO_MORPH_H2.has(this.lastReaction && this.lastReaction.ruleId);
        if (restG.length >= 2 && !noH2) {
            const heavy = before.atoms.concat(after.atoms);
            let cx = Math.round((Math.max(...heavy.map(a => a.x)) + G * 3) / G) * G;
            const y0 = Math.round(restG.reduce((s, K) => s + K.h.y, 0) / restG.length / G) * G;
            /* ★ H₂ は**受け取る原子のそば**の空いた所に置く（v1556）。右の端に置くと、H が分子の上を
             *   横切って飛んでくる（実測: ベンゼン環の水素化で H の丸が 42 コマ重なった）。
             *   置けなければ今までどおり右に置く */
            const segs = [];
            [before, after].forEach(s => {
                const pos = new Map(s.atoms.map(a => [a.id, a]));
                s.bonds.forEach(b => { const p = pos.get(b.atomId1), q = pos.get(b.atomId2); if (p && q) segs.push([p, q]); });
            });
            const placed = [];
            const spotNear = (c) => {
                for (let r = 1; r <= 16; r++) {
                    let best = null, bestD = Infinity;
                    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
                        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
                        const p1 = { x: c.x + i * G / 2 - G * 0.35, y: c.y + j * G / 2 };
                        const p2 = { x: p1.x + G * 0.7, y: p1.y };
                        const ok = [p1, p2].every(p => heavy.concat(placed).every(o => Math.hypot(o.x - p.x, o.y - p.y) >= G * 1.1) &&
                            segs.every(([a, b]) => pointSegmentDistance(p, a, b) >= G * 0.7));
                        const d = Math.hypot(i, j);
                        if (ok && d < bestD) { bestD = d; best = [p1, p2]; }
                    }
                    if (best) return best;
                }
                return null;
            };
            for (let k = 0; k + 1 < restG.length; k += 2) {
                const ids = [nid(), nid()];
                const c = { x: (restG[k].h.x + restG[k + 1].h.x) / 2, y: (restG[k].h.y + restG[k + 1].h.y) / 2 };
                const near = spotNear(c);
                const spots = near || [{ x: cx, y: y0 }, { x: cx + G, y: y0 }];
                if (near) placed.push(...near); else cx += G * 3;
                [0, 1].forEach(n => {
                    B.push({ id: ids[n], h: spots[n], p: null });
                    A.push({ id: ids[n], h: restG[k + n].h, p: restG[k + n].p });
                });
                extraBonds.push({ atomId1: ids[0], atomId2: ids[1], type: 1 });
            }
            restG = restG.length % 2 ? [restG[restG.length - 1]] : [];
        }
        // ④ 残りは片側だけに置く（今までどおりフェード）
        restL.forEach(L => B.push({ id: nid(), h: L.h, p: L.p }));
        restG.forEach(K => A.push({ id: nid(), h: K.h, p: K.p }));
        // ⑤ 写しに置いた H₂ の H−H を、付いた id どうしで結び直す（v1574）
        const matesOf = (list, bonds) => {
            const idOf = new Map(list.map(e => [e.h, e.id]));
            list.forEach(e => {
                if (!e.h.mate || !idOf.has(e.h.mate)) return;
                const other = idOf.get(e.h.mate);
                if (e.id < other) bonds.push({ atomId1: e.id, atomId2: other, type: 1 });
            });
        };
        matesOf(B, extraBonds);
        const extraAfter = [];
        matesOf(A, extraAfter);
        const build = (snap, list, bonds) => ({
            atoms: snap.atoms.concat(list.map(e => ({ id: e.id, element: 'H', x: e.h.x, y: e.h.y, charge: 0 }))),
            bonds: snap.bonds.concat(list.filter(e => e.p).map(e => ({ atomId1: e.p, atomId2: e.id, type: 1 })), bonds)
        });
        return {
            // ★ 「×n」の札（v1560）は写しから写しへ引き継ぐ
            before: Object.assign(build(before, B, extraBonds), { labels: labB }),
            after: Object.assign(build(after, A, extraAfter), { labels: labA }),
            lost: restL.length, gained: restG.length
        };
    }

    /**
     * ★ 再生の終わりに、写しにだけ置いた副生成物（NaCl・N₂・½H₂ など）を薄れさせる（v1556）。
     * ⚠ キャンバスには最初から居ない ＝ ここで消えても判定・Undo は何も変わらない。
     *   副生成物に付いた水素（写しの H）と、親の無い H（½H₂）も一緒に薄れる。
     */
    fadeOutTransient(snap, transientIds, gen) {
        const gone = new Set(transientIds || []);
        if (!gone.size) return Promise.resolve();
        const bondedTo = new Map();
        snap.bonds.forEach(b => {
            bondedTo.set(b.atomId1, (bondedTo.get(b.atomId1) || []).concat(b.atomId2));
            bondedTo.set(b.atomId2, (bondedTo.get(b.atomId2) || []).concat(b.atomId1));
        });
        snap.atoms.forEach(a => {
            if (a.element !== 'H') return;
            const nb = bondedTo.get(a.id) || [];
            if (!nb.length || nb.some(id => gone.has(id))) gone.add(a.id);
        });
        const settled = {
            atoms: snap.atoms.filter(a => !gone.has(a.id)),
            bonds: snap.bonds.filter(b => !gone.has(b.atomId1) && !gone.has(b.atomId2))
        };
        const still = new Map();   // ⚠ 位置は動かさない（override を渡すと握手の描き方に入らず、線は薄れるだけ）
        return animateFramesLoop(RX_FADE_MS,
            t => { if (this._morphGen === gen) this.renderMorphFrame(snap, settled, t, still); },
            () => this._morphSkip || this._morphGen !== gen);
    }

    /* ==========================================================================
     * ★★ 再生の段取り（v1556）
     *   ① 置き直し（T 0→1）… 画面の図から、相手が現れ・反応する H が大きな丸になって結合の向きへ伸び・環が回る
     *      → 一呼吸（T=1 のまま）
     *   ② 握手のつなぎ替え（T 1→2）… 今までと同じ（2分子が並ぶ反応は 1→1.5 並ぶ・1.5→2 結合）
     *   ③ 片付け（T 2→3）… 大きくした H が元に戻り、写しにだけ置いた副生成物が薄れる
     * ユーザー指示: 「反応するH原子を先に重原子と同じようなグラフィックに変えてから反応させるのがよい」
     *   「隣の分子や、分子内の他の原子と干渉する可能性があるのでその対策が必要」
     * ⚠ 見た目だけ。`lastReaction` の before/after・キャンバス・判定には触らない。
     * ========================================================================== */

    /** 副生成物（transient）と、それに付いた H・親の無い H を外した写し */
    settleSnapshot(snap, transientIds) {
        const gone = new Set(transientIds || []);
        const nb = new Map();
        snap.bonds.forEach(b => {
            nb.set(b.atomId1, (nb.get(b.atomId1) || []).concat(b.atomId2));
            nb.set(b.atomId2, (nb.get(b.atomId2) || []).concat(b.atomId1));
        });
        snap.atoms.forEach(a => {
            if (a.element !== 'H') return;
            const list = nb.get(a.id) || [];
            if (!list.length || list.some(id => gone.has(id))) gone.add(a.id);
        });
        return {
            atoms: snap.atoms.filter(a => !gone.has(a.id)),
            bonds: snap.bonds.filter(b => !gone.has(b.atomId1) && !gone.has(b.atomId2)),
            labels: (snap.labels || []).filter(l => !gone.has(l.id))
        };
    }

    /**
     * 再生の段取りを組む（DOM 非依存）。`L` は `{ before, after, anim, beforeReal, rotation }`。
     * @returns plan または null（新しく見せるものが無い ＝ 今までどおりの再生）
     */
    buildPlayback(L, morphStages = null) {
        if (!L || !L.before || !L.after) return null;
        if (morphStages && morphStages !== 'joinFirst') return null;
        const src = L.anim || L;
        const hx = this.withMorphHydrogens(src.before, src.after);
        const real = L.beforeReal || L.before;
        const rot = L.rotation || null;
        const isH = a => a.element === 'H';
        const parentMap = snap => {
            const hs = new Set(snap.atoms.filter(isH).map(a => a.id));
            const m = new Map();
            snap.bonds.forEach(b => {
                if (hs.has(b.atomId1)) m.set(b.atomId1, b.atomId2);
                else if (hs.has(b.atomId2)) m.set(b.atomId2, b.atomId1);
            });
            return m;
        };
        const pB = parentMap(hx.before), pA = parentMap(hx.after);
        const inA = new Set(hx.after.atoms.map(a => a.id));
        // 反応する H ＝ 反応の前と後で付いている原子が変わる H（前後どちらにも居るもの）
        const reacting = hx.before.atoms
            .filter(a => isH(a) && inA.has(a.id) && (pB.get(a.id) || null) !== (pA.get(a.id) || null))
            .map(a => a.id).sort();
        const realIds = new Set(real.atoms.map(a => a.id));
        const partnerIds = hx.before.atoms.filter(a => !isH(a) && !realIds.has(a.id)).map(a => a.id);
        const transient = (L.anim && L.anim.transient) || [];
        if (!reacting.length && !partnerIds.length && !transient.length && !rot) return null;

        // ---- 反応する H を大きな丸にして、結合の向きへ伸ばす（込み合っていれば空いた向きへ回す・最後は控えめに）
        const enlarge = (snap, parents) => {
            const out = { atoms: snap.atoms.map(a => ({ ...a })), bonds: snap.bonds, labels: snap.labels || [] };
            const pos = new Map(out.atoms.map(a => [a.id, a]));
            const scale = new Map();
            const clash = (p, r, selfId, parentId) => {
                for (const o of out.atoms) {
                    if (o.id === selfId || o.id === parentId) continue;
                    const ro = isH(o) ? 6 + 4 * (scale.get(o.id) || 0) : 10;
                    if (Math.hypot(o.x - p.x, o.y - p.y) < r + ro + 2) return true;
                }
                for (const b of out.bonds) {
                    if (b.atomId1 === selfId || b.atomId2 === selfId) continue;
                    const q1 = pos.get(b.atomId1), q2 = pos.get(b.atomId2);
                    if (q1 && q2 && pointSegmentDistance(p, q1, q2) < r + 2) return true;
                }
                return false;
            };
            reacting.forEach(id => {
                const h = pos.get(id);
                if (!h) return;
                const p = pos.get(parents.get(id));
                if (!p) { scale.set(id, 1); return; }
                const a0 = Math.atan2(h.y - p.y, h.x - p.x);
                const base = isH(p) ? RX_BIG_H_LEN - 4 : RX_BIG_H_LEN;
                const tries = this._bigHAvoid === false ? [[1, 0]] :
                    [1, 0.7].flatMap(s => [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90].map(dd => [s, dd]));
                let hit = null;
                for (const [s, dd] of tries) {
                    const a = a0 + dd * Math.PI / 180;
                    const len = base - (1 - s) * 10;
                    const q = { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len };
                    if (this._bigHAvoid === false || !clash(q, 6 + 4 * s, id, p.id)) { hit = { q, s, dd }; break; }
                }
                if (!hit) hit = { q: { x: p.x + Math.cos(a0) * (base - 5), y: p.y + Math.sin(a0) * (base - 5) }, s: 0.5, dd: 0 };
                h.x = hit.q.x; h.y = hit.q.y;
                scale.set(id, hit.s);
                // 込み合っていて向きを回した／小さくした H の記録（実測の報告用）
                if (hit.s < 1 || hit.dd) adjusted.push({ id, parent: p.id, turn: hit.dd || 0, scale: hit.s });
            });
            return { snap: out, scale, adjusted };
        };
        const adjusted = [];
        const E1 = enlarge(hx.before, pB), E2 = enlarge(hx.after, pA);

        // ---- 画面に出ている反応前の図（相手なし・H は画面と同じ位置・環は回す前）
        const rotIds = new Set(rot ? rot.ids : []);
        const turn = (p, th) => {
            const c = Math.cos(th), s = Math.sin(th), dx = p.x - rot.cx, dy = p.y - rot.cy;
            return { x: rot.cx + dx * c - dy * s, y: rot.cy + dx * s + dy * c };
        };
        const realPos = new Map(real.atoms.map(a => [a.id, a]));
        const realH = new Map();
        this.molFromSnapshot(real).calculateHydrogens().forEach(h => {
            if (!realH.has(h.parentId)) realH.set(h.parentId, []);
            realH.get(h.parentId).push(h);
        });
        const S0atoms = [];
        const byParent = new Map();
        hx.before.atoms.forEach(a => {
            if (!isH(a)) { if (realIds.has(a.id)) S0atoms.push({ ...a, x: realPos.get(a.id).x, y: realPos.get(a.id).y }); return; }
            const pid = pB.get(a.id);
            if (!pid || !realIds.has(pid)) return;
            if (!byParent.has(pid)) byParent.set(pid, []);
            byParent.get(pid).push(a);
        });
        byParent.forEach((hs, pid) => {
            const P1 = hx.before.atoms.find(x => x.id === pid), P0 = realPos.get(pid);
            const offs = (realH.get(pid) || []).map(h => ({ h, a: Math.atan2(h.y - P0.y, h.x - P0.x) }));
            const th = rot && rotIds.has(pid) ? rot.theta : 0;
            const cand = [];
            hs.forEach((h, i) => offs.forEach((o, j) => cand.push({
                i, j, d: hsAngleGap(Math.atan2(h.y - P1.y, h.x - P1.x) - th, o.a) })));
            cand.sort((u, v) => u.d - v.d || u.i - v.i || u.j - v.j);
            const ui = new Set(), uj = new Set();
            cand.forEach(c => {
                if (ui.has(c.i) || uj.has(c.j)) return;
                ui.add(c.i); uj.add(c.j);
                S0atoms.push({ ...hs[c.i], x: offs[c.j].h.x, y: offs[c.j].h.y });
            });
            hs.forEach((h, i) => { if (!ui.has(i)) S0atoms.push({ ...h, x: P0.x + (h.x - P1.x), y: P0.y + (h.y - P1.y) }); });
        });
        const S0ids = new Set(S0atoms.map(a => a.id));
        const S0 = { atoms: S0atoms, bonds: hx.before.bonds.filter(b => S0ids.has(b.atomId1) && S0ids.has(b.atomId2)) };
        const turning = new Set(S0atoms.filter(a => rotIds.has(a.id) || (isH(a) && rotIds.has(pB.get(a.id)))).map(a => a.id));
        const A2 = this.settleSnapshot(hx.after, transient);

        /* ---- ★ 反応する H の道筋を曲げる（v1556・ユーザー指示「干渉する可能性があるのでその対策が必要」）。
         *   置換では、離れる H と入ってくる X が**同じ線の上ですれ違う**（C−H … X−X が一直線）。
         *   道筋を横へ amp·sin(πe) だけずらし、途中のどのコマでもほかの原子の丸・結合の線に重ならない
         *   いちばん小さい曲げを選ぶ。`_bendAvoid = false` で曲げない（否定対照） */
        const P0 = new Map(E1.snap.atoms.map(a => [a.id, a])), P1 = new Map(E2.snap.atoms.map(a => [a.id, a]));
        const bend = new Map();
        const hParents = new Map(reacting.map(id => [id, new Set([pB.get(id), pA.get(id)].filter(Boolean))]));
        const plan = {
            bend, hParents,
            S0, S1: E1.snap, A1: E2.snap, A2,
            scaleS1: E1.scale, scaleA1: E2.scale,
            mid: morphStages === 'joinFirst' ? this.buildMidSnapshot(E1.snap, E2.snap, 'moveFirst') : null,
            rot, turning, turn, reacting, partnerIds, transient, adjusted
        };
        if (this._bendAvoid !== false) {
            /* ★★ **物差しは再生の実物**（v1584）。⚠ もとは「真っ直ぐ動く」と仮定した近似で数えていたが、
             *   握手の段は**浮かせて振る**（`hsEase` / `handshakeHandsAt`）ので**実際の形と食い違い**、
             *   ⓵ ニトロ基の還元では近似が 0 と答えた曲げで **実測 5 コマ**重なっていた。
             *   ★ `bigHydrogenOverlaps` を握手の段だけ・この H だけに絞って呼ぶ ＝
             *     **見張りと同じ物差しで選ぶ**（決めごとを2か所に持たない）。
             * ⚠⚠ **2周する**（`RX_BEND_PASSES`）—— 相手は**ほかの反応する H の手**でもあるので、
             *   1周目に決めた曲げは、あとの H が曲がったあとには最善でなくなる。
             *   ⓵ ニトロ基の還元は H が6つ（N へ2つ・O へ4つ）同じ方から来るので、
             *     1周では 4 コマ残り、2周目で 0 になった。★ 途中で 0 になれば打ち切る。 */
            const sides = new Map();
            reacting.forEach(id => {
                const a = P0.get(id), b = P1.get(id);
                const len = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
                if (len >= 1) sides.set(id, { nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len });
            });
            /* ⚠ **重なりの重さは同じではない。**★ ほかの**原子の丸**に食い込むほうが、
             *   手の線に丸がかかるより目に付く（線は細く、掛かっても字の上を横切らない）。
             *   ⓵ 実測: 重みを付けないと、同じ「1コマ」でも **O に 1.7px まで食い込む**曲げが
             *     選ばれることがあった（手の線に 4px かかるだけの曲げと同点になるため）。 */
            const hits = id => this.bigHydrogenOverlaps(plan, RX_BEND_SAMPLES, { T0: 1, T1: 2, only: id })
                .reduce((s, o) => s + (o.bond ? 1 : RX_BEND_ATOM_COST), 0);
            for (let pass = 0; pass < RX_BEND_PASSES; pass++) {
                let left = 0;
                sides.forEach(({ nx, ny }, id) => {
                    const cost = amp => {
                        if (amp) bend.set(id, { nx, ny, amp }); else bend.delete(id);
                        return hits(id);
                    };
                    let best = { amp: 0, c: cost(0) };
                    if (best.c) {
                        for (const amp of RX_BEND_AMPS) {
                            const c = cost(amp);
                            if (c < best.c) best = { amp, c };
                            if (!c) break;
                        }
                    }
                    /* ★ 粗い候補で 0 にならなかったときだけ、**いちばん良かった幅のまわりを細かく**見る
                     *   （v1584）。⚠ 0 になった回はここへ来ない ＝ **今までどおり「いちばん小さい曲げ」**。
                     *   ⓵ 実測: ジアゾ化は粗い10通りでは最小が 1 コマ（手の線に 0.5px）だったが、
                     *      細かく見ると 0 になる幅がある（重なりは幅に対して滑らかに変わらない）。 */
                    if (best.c) {
                        for (const d of RX_BEND_FINE) {
                            const amp = best.amp + d;
                            if (!amp || Math.abs(amp) > RX_BEND_MAX) continue;
                            const c = cost(amp);
                            if (c < best.c) best = { amp, c };
                            if (!c) break;
                        }
                    }
                    cost(best.amp);
                    left += best.c;
                });
                if (!left) break;
            }
        }
        return plan;
    }

    /** 時刻 T（0〜3）の段と、その段で描く前後・進み・位置の差し替え・H の大きさ */
    playbackLeg(plan, T) {
        const clamp = v => Math.max(0, Math.min(1, v));
        if (T <= 1) {
            const u = clamp(T);
            const to = new Map(plan.S1.atoms.map(a => [a.id, a]));
            const override = new Map();
            plan.S0.atoms.forEach(a => {
                const q = to.get(a.id) || a;
                if (plan.rot && plan.turning.has(a.id)) {
                    const r = plan.turn(a, plan.rot.theta * u), rEnd = plan.turn(a, plan.rot.theta);
                    override.set(a.id, { x: r.x + (q.x - rEnd.x) * u, y: r.y + (q.y - rEnd.y) * u });
                } else {
                    override.set(a.id, { x: a.x + (q.x - a.x) * u, y: a.y + (q.y - a.y) * u });
                }
            });
            const scale = new Map([...plan.scaleS1].map(([id, s]) => [id, s * u]));
            return { from: plan.S0, to: plan.S1, t: u, override, scale };
        }
        if (T <= 2) {
            const t = clamp(T - 1);
            const ids = new Set([...plan.scaleS1.keys(), ...plan.scaleA1.keys()]);
            const scale = new Map([...ids].map(id => [id, hsLerp(plan.scaleS1.get(id) || 0, plan.scaleA1.get(id) || 0, t)]));
            if (plan.mid) {
                return t <= 0.5
                    ? { from: plan.S1, to: plan.mid, t: t * 2, override: undefined, scale, bend: plan.bend }
                    : { from: plan.mid, to: plan.A1, t: (t - 0.5) * 2, override: undefined, scale };
            }
            return { from: plan.S1, to: plan.A1, t, override: undefined, scale, bend: plan.bend };
        }
        const u = clamp(T - 2);
        const to = new Map(plan.A2.atoms.map(a => [a.id, a]));
        const override = new Map();
        plan.A1.atoms.forEach(a => {
            const q = to.get(a.id) || a;
            override.set(a.id, { x: a.x + (q.x - a.x) * u, y: a.y + (q.y - a.y) * u });
        });
        const scale = new Map([...plan.scaleA1].map(([id, s]) => [id, s * (1 - u)]));
        return { from: plan.A1, to: plan.A2, t: u, override, scale };
    }

    renderPlaybackAt(plan, T) {
        const leg = this.playbackLeg(plan, T);
        this.renderMorphFrame(leg.from, leg.to, leg.t, leg.override, leg.scale, leg.bend);
    }

    /** 時刻 T のコマの形（原子の位置・大きさ・線分と、その線分がどの原子の手か）。重なりの実測に使う */
    playbackGeometryAt(plan, T) {
        const leg = this.playbackLeg(plan, T);
        const frame = this.interpolateMorph(leg.from, leg.to, leg.t, leg.override, leg.bend);
        const atoms = frame.atoms.map(a => ({ ...a, scale: leg.scale.get(a.id) || 0 }));
        const pos = new Map(atoms.map(a => [a.id, a]));
        const segs = [];
        const useHS = leg.t > 0 && leg.t < 1 && !leg.override && this.handshakeHasChange(leg.from, leg.to);
        if (useHS) {
            this.handshakeHandsAt(leg.from, leg.to, leg.t, leg.bend).forEach(h => {
                if (h.alpha <= 0.3 || h.len <= HS_INSET + 0.01) return;
                segs.push({ x1: h.x1, y1: h.y1, x2: h.x2, y2: h.y2, ids: [h.atomId, h.fromOther, h.toOther].filter(Boolean) });
            });
        } else {
            const key = b => (b.atomId1 < b.atomId2 ? `${b.atomId1}|${b.atomId2}` : `${b.atomId2}|${b.atomId1}`);
            const fb = new Map(leg.from.bonds.map(b => [key(b), b])), tb = new Map(leg.to.bonds.map(b => [key(b), b]));
            new Set([...fb.keys(), ...tb.keys()]).forEach(k => {
                const b = fb.get(k) || tb.get(k);
                const alpha = fb.has(k) && tb.has(k) ? 1 : (fb.has(k) ? 1 - leg.t : leg.t);
                const p = pos.get(b.atomId1), q = pos.get(b.atomId2);
                if (!p || !q || alpha <= 0.3) return;
                segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, ids: [b.atomId1, b.atomId2] });
            });
        }
        return { atoms, segs };
    }

    /**
     * ★ 大きくした H が、ほかの原子の丸・ほかの結合の線に重なったコマを数える（v1556）。
     * 大きくした H ＝ 大きさ 0.5 以上。見えない（薄い 0.3 以下の）原子・線は数えない。
     * その H 自身の手（H から伸びる手・H へ伸びてくる手）は数えない。
     */
    bigHydrogenOverlaps(plan, samples = 90, opts) {
        /* ★ `opts` は**段取りを選ぶときに自分で使う**ための絞り（v1584）:
         *   `T0` / `T1` … 見る段（既定は 0〜3 の全部）／`only` … この id の H だけ見る。
         * ⚠ 絞りを足しただけで**数え方は1つ**（見張りと、曲げを選ぶ側が同じ物差しを使う）。 */
        const T0 = opts && opts.T0 !== undefined ? opts.T0 : 0;
        const T1 = opts && opts.T1 !== undefined ? opts.T1 : 3;
        const only = (opts && opts.only) || null;
        const out = [];
        for (let i = 0; i <= samples; i++) {
            const T = T0 + (T1 - T0) * i / samples;
            const { atoms, segs } = this.playbackGeometryAt(plan, T);
            atoms.forEach(h => {
                if (only && h.id !== only) return;
                if (h.element !== 'H' || h.scale < 0.5 || h.opacity < 0.3) return;
                const r = 6 + 4 * h.scale;
                const own = (plan.hParents && plan.hParents.get(h.id)) || new Set();
                atoms.forEach(o => {
                    if (o.id === h.id || o.opacity < 0.3) return;
                    const ro = o.element === 'H' ? 6 + 4 * (o.scale || 0) : 10;
                    const d = Math.hypot(o.x - h.x, o.y - h.y);
                    /* ⚠ その H が手でつながっている原子（反応前・反応後の相手）とは丸どうしが触れてよい。
                     *   ただし**中心が相手の丸の中に入る**（すり抜ける）のは重なりに数える */
                    const lim = own.has(o.id) ? Math.max(r, ro) : r + ro - 1;
                    if (d < lim) out.push({ T, h: h.id, with: o.id, element: o.element, d: Math.round(d * 10) / 10 });
                });
                segs.forEach(s => {
                    if (s.ids.includes(h.id)) return;
                    const d = pointSegmentDistance(h, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
                    if (d < r - 1) out.push({ T, h: h.id, bond: s.ids.join('-'), d: Math.round(d * 10) / 10 });
                });
            });
        }
        return out;
    }

    /** 段取りどおりに再生する */
    runPlayback(plan, highlight) {
        const g = this.game;
        const gen = ++this._morphGen;
        this._morphing = true;
        this._morphSkip = false;
        const stop = () => this._morphSkip || this._morphGen !== gen;
        const smooth = t => t * t * (3 - 2 * t);
        const legs = [
            { T0: 0, T1: 1, dur: RX_PRE_MS, warp: smooth },
            { T0: 1, T1: 1, dur: RX_HOLD_MS, warp: t => t }
        ];
        if (plan.mid) {
            const t1 = this.morphTiming(plan.S1, plan.mid, 450), t2 = this.morphTiming(plan.mid, plan.A1, 400);
            legs.push({ T0: 1, T1: 1.5, dur: t1.dur, warp: t1.warp }, { T0: 1.5, T1: 2, dur: t2.dur, warp: t2.warp });
        } else {
            const tm = this.morphTiming(plan.S1, plan.A1, HS_PLAIN_DURATION);
            legs.push({ T0: 1, T1: 2, dur: tm.dur, warp: tm.warp });
        }
        legs.push({ T0: 2, T1: 3, dur: RX_POST_MS, warp: smooth });
        this.renderPlaybackAt(plan, 0);
        let chain = Promise.resolve();
        legs.forEach(leg => {
            chain = chain.then(() => {
                if (stop()) return null;
                return animateFramesLoop(leg.dur,
                    t => { if (this._morphGen === gen) this.renderPlaybackAt(plan, leg.T0 + (leg.T1 - leg.T0) * leg.warp(t)); },
                    stop);
            });
        });
        chain.then(() => {
            if (this._morphGen !== gen) return;
            this._morphing = false;
            g.updateDrawing();
            highlight();
        });
    }

    /* ==========================================================================
     * ★★ 反応をもう一度見る（v1568・ユーザー要望 2026-09-15）
     * > 「分子を反応させたとき、反応前にもどす、があるのはよいのですが、反応をもう一度見たいです。
     * >   反応機構と同じように、再生、コマ送りなどのボタンが欲しいです。」
     *
     * ★ **写しで描く**。描く関数は反応を実行したときの再生と同じもの（`renderPlaybackAt`・
     *   `renderMorphFrame`・紙のフリップ）で、段の組み方も `animateExecution` と同じ順に選ぶ。
     *   ⚠ `userMolecule`・履歴・`lastReaction` には触らない（RRP1 が正準コード・原子数・履歴で見張る）。
     * ★ **止まれる段**（コマ送りの行き先）… 意味のある区切りだけ:
     *   before 反応前 → summon 相手が現れ、反応する H が大きくなる（環を回すのもここ）
     *   → align 2分子が並ぶ（並ぶ反応だけ） → part 手が離れる → join 握手し直す
     *   → fade 副生成物が薄れる（無ければ settle ＝ H が元の大きさに戻る）
     *   ⚠ 「相手が現れる」と「H が大きくなる」は実行時の再生で**同じ 0.5 秒に同時に**起きるので1段にした。
     * ========================================================================== */

    /** 見直しの段取り（コマの並び `segs` と止まれる段 `stops`）を組む。DOM は触らない */
    buildReplayTimeline(L) {
        if (!L || !L.before || !L.after || !L.replaySrc) return null;
        const src = L.replaySrc;
        const segs = [];
        const stops = [{ p: 0, key: 'before' }];
        const smooth = t => t * t * (3 - 2 * t);
        // 補間の段を1つ足す。結合が変わる段は「手が離れた」（HS_PART_END）でも止まれる
        const pushMorph = (from, to, base, key, drawAt) => {
            const tm = this.morphTiming(from, to, base);
            const k = segs.length;
            const draw = drawAt || (u => this.renderMorphFrame(from, to, u));
            segs.push({ dur: tm.dur, draw: t => draw(tm.warp(t)) });
            if (this.handshakeHasChange(from, to)) stops.push({ p: k + HS_PART_END, key: 'part' });
            stops.push({ p: k + 1, key });
        };
        if (src.haworth) {
            const legs = this.haworthFlipLegs(this.haworthFlipShots({ haworthRedraws: src.haworth }));
            legs.forEach((leg, k) => {
                const t0 = k / legs.length, span = 1 / legs.length;
                segs.push({
                    dur: leg.kind === 'turn' ? 900 : 350,
                    draw: t => {
                        const e = smooth(t), map = this.haworthFlipPosAt(leg, e);
                        this.renderMorphFrame(L.before, L.after, Math.min(1, t0 + span * e), map);
                        if (leg.kind === 'turn') this.renderFlipAxis(leg.step, [...map.values()]);
                    }
                });
                stops.push({ p: segs.length, key: leg.kind });
            });
        } else if (src.morphSequence) {
            const shots = [L.before, ...src.morphSequence];
            for (let k = 0; k + 1 < shots.length; k++) {
                const mid = this.buildMidSnapshot(shots[k], shots[k + 1], 'moveFirst');
                pushMorph(shots[k], mid, 450, 'align');
                pushMorph(mid, shots[k + 1], 400, 'join');
            }
        } else {
            this.buildReplayMorphSegs(L, src.morphStages || null, segs, stops, pushMorph, smooth);
        }
        if (!segs.length) return null;
        const end = segs.length;
        if (!stops.some(s => Math.abs(s.p - end) < 1e-6)) stops.push({ p: end, key: 'after' });
        stops.sort((a, b) => a.p - b.p);
        return { segs, stops, end };
    }

    /** 見直せるか ＝ ↩ 反応前に戻す と同じ条件（直近の反応の結果がいまキャンバスに載っている） */
    canReplay() {
        const L = this.lastReaction;
        if (!L || !L.replaySrc || !L.after) return false;
        if (window.reactionPlayer && window.reactionPlayer.ownsCanvas && window.reactionPlayer.ownsCanvas()) return false;
        return this.topologyKey(this.snapshotMolecule(this.game.userMolecule)) === this.topologyKey(L.after);
    }

    /** 段取りは ▶ を押したときに1回だけ組む（⚠ refresh は作図のたびに走るので、そこでは組まない） */
    ensureReplay() {
        // ⚠ 門番は**段取りを持っていても毎回**見る（描き足したあとに、組んであった段取りで写しを出さない。RRP1 否定対照②が実測で捕まえた）
        if (!this.canReplay()) return null;
        if (this._replay && this._replay.L === this.lastReaction) return this._replay;
        const tl = this.buildReplayTimeline(this.lastReaction);
        if (!tl) return null;
        this._replay = { L: this.lastReaction, tl, pos: tl.end, playing: false, open: false, gen: -1 };
        return this._replay;
    }

    /** いまキャンバスに見直しの写しが出ているか（別の描画に持っていかれたら false） */
    replayFrameShown() {
        const r = this._replay;
        return !!(r && r.open && r.gen === this._morphGen && this._morphing);
    }

    drawReplayAt(r, p) {
        const segs = r.tl.segs;
        let k = Math.floor(p + 1e-9), t = p - k;
        if (k >= segs.length) { k = segs.length - 1; t = 1; }
        else if (k > 0 && t < 1e-9) { k -= 1; t = 1; }   // 段の境目は「前の段の終わり」を描く
        segs[k].draw(Math.max(0, Math.min(1, t)));
    }

    openReplay(r) {
        const g = this.game;
        if (g.iupacNumbering && g.setIupacNumbering) g.setIupacNumbering(false);   // 番号の絵は写しと合わない
        if (g.clearUIOverlay) g.clearUIOverlay();   // 反応のハイライトの輪を写しの上に残さない
        const hadPause = !!this._morphPause;
        this._morphPause = null;
        r.open = true;
        r.gen = ++this._morphGen;   // 実行時の再生が走っていれば止める
        this._morphing = true;      // 写しを出しているあいだはキャンバスのタップで作図しない（タップ ＝ 見直しを終える）
        this._morphSkip = false;
        if (hadPause && g.syncCanvasModeBadge) g.syncCanvasModeBadge();
    }

    closeReplay(r, redraw = true) {
        r.open = false;
        r.playing = false;
        r.pos = r.tl.end;
        if (this._morphGen === r.gen) { this._morphing = false; this._morphSkip = false; }
        if (redraw) {
            this.game.updateDrawing();   // 本物の分子（反応のあと）に戻す。中で syncReplayControls が走る
            const ids = r.L.replaySrc.changed;
            if (ids) this.game.highlightAtoms(ids.map(id => this.game.userMolecule.atoms.find(a => a.id === id)).filter(Boolean));
        }
        this.syncReplayControls();
    }

    /** ▶／⏸。写しが出ていなければ最初から、止めていればその続きから、終わりまで流す */
    replayPlay() {
        const r = this.ensureReplay();
        if (!r) return false;
        if (this.replayFrameShown() && r.playing) {   // ⏸ 一時停止（写しはそのコマのまま）
            r.playing = false;
            this.syncReplayControls();
            return true;
        }
        if (!this.replayFrameShown()) { r.pos = 0; this.openReplay(r); }
        else if (r.pos >= r.tl.end - 1e-6) r.pos = 0;
        r.playing = true;
        const gen = r.gen;
        let last = null;
        const tick = now => {
            if (this._morphGen !== gen || !r.playing || !r.open) return;
            if (last === null) last = now;
            let dt = Math.min(200, Math.max(0, now - last));
            last = now;
            while (dt > 0 && r.pos < r.tl.end) {
                const k = Math.min(Math.floor(r.pos + 1e-9), r.tl.segs.length - 1);
                const dur = Math.max(1, r.tl.segs[k].dur);
                const rest = (k + 1 - r.pos) * dur;
                if (dt >= rest) { r.pos = k + 1; dt -= rest; } else { r.pos += dt / dur; dt = 0; }
            }
            if (r.pos >= r.tl.end) { this.closeReplay(r); return; }
            this.drawReplayAt(r, r.pos);
            requestAnimationFrame(tick);
        };
        this.drawReplayAt(r, r.pos);
        this.syncReplayControls();
        if (typeof requestAnimationFrame !== 'function') { this.closeReplay(r); return true; }
        requestAnimationFrame(tick);
        return true;
    }

    /** ⏮／⏭ コマ送り。止まれる段（`tl.stops`）の前／次へ。最後の段まで進んだら見直しを終える */
    replayStep(dir) {
        const r = this.ensureReplay();
        if (!r) return false;
        const shown = this.replayFrameShown();
        const pos = shown ? r.pos : r.tl.end;
        const eps = 1e-6;
        const to = dir > 0 ? r.tl.stops.find(s => s.p > pos + eps)
            : [...r.tl.stops].reverse().find(s => s.p < pos - eps);
        if (!to) return false;
        r.playing = false;
        if (!shown) this.openReplay(r);
        r.pos = to.p;
        if (r.pos >= r.tl.end - eps) { this.closeReplay(r); return true; }
        this.drawReplayAt(r, r.pos);
        this.syncReplayControls();
        return true;
    }

    /** 🔄 最初から（反応前のコマで止める） */
    replayRestart() {
        const r = this.ensureReplay();
        if (!r) return false;
        r.playing = false;
        if (!this.replayFrameShown()) this.openReplay(r);
        r.pos = 0;
        this.drawReplayAt(r, 0);
        this.syncReplayControls();
        return true;
    }

    /** やめる（反応のあとの図に戻る） */
    replayExit() {
        const r = this._replay;
        if (!r || !this.replayFrameShown()) return false;
        this.closeReplay(r);
        return true;
    }

    /** いまの見直しの様子（テストと報告の口） */
    replayState() {
        const r = this._replay, shown = this.replayFrameShown();
        const at = r && shown ? r.tl.stops.find(s => Math.abs(s.p - r.pos) < 1e-6) : null;
        return {
            can: this.canReplay(), shown, playing: !!(r && shown && r.playing),
            pos: r ? r.pos : null, end: r ? r.tl.end : null,
            stage: at ? at.key : null, stops: r ? r.tl.stops.map(s => s.key) : null
        };
    }

    /** ▶ と見直しの操作の出し入れ。`syncUndoButton()` から呼ばれる */
    syncReplayControls() {
        const r = this._replay;
        const shown = this.replayFrameShown();
        if (r && r.open && !shown) { r.open = false; r.playing = false; r.pos = r.tl.end; }   // 別の描画に持っていかれた
        if (shown && !this.canReplay()) {
            // 写しを出しているあいだに分子が変わった（リボンの ↩ 戻す・全消去など）＝ 見直す相手がもう無い
            r.open = false; r.playing = false;
            this._morphGen++; this._morphing = false; this._morphSkip = false;
        }
        const open = this.replayFrameShown();
        const can = !open && this.canReplay();
        /* ★ v1665（2026-09-25 ユーザー「反応後にコマ送りボタンが消えるのがやりづらい」）:
         *   再生が終わっても**コマ送りの操作（🔄 ⏮ ▶ ⏭）は出したまま**にする。v1664 までは終わると
         *   「▶ もう一度見る」1つに畳んでいた。見直していないあいだは ↩ 反応前に戻す と並べ、
         *   「やめる」だけ隠す（止めるものが無い）。⏮ を押すとその場で1段戻って見直しに入る。
         *   ⚠ 「▶ もう一度見る」の札（#btn-rx-replay）は無くした（操作の ▶ と同じことをするので2つ出さない） */
        if (this.replayControls) this.replayControls.classList.toggle('hidden', !open && !can);
        if (this.replayCard) this.replayCard.classList.toggle('rx-replaying', open);
        const b = this.replayBtns;
        if (b && b.exit) b.exit.classList.toggle('hidden', !open);
        if (b && b.play) {
            b.play.textContent = open && r.playing ? '⏸' : '▶';
            // ⚠ 流しているあいだは位置がコマごとに進む（ここは再描画のたびには呼ばれない）＝ 押せるままにする
            // ⚠ 見直していないとき（can）は反応のあとの図 ＝ 最後の段にいる: ⏮ は押せる・⏭ は押せない
            if (b.prev) b.prev.disabled = open ? (!r.playing && r.pos <= 1e-6) : !can;
            if (b.next) b.next.disabled = open ? (!r.playing && r.pos >= r.tl.end - 1e-6) : true;
            if (b.restart) b.restart.disabled = !open && !can;
        }
        return open;
    }

    /** 見直しの段（紙のフリップ・1組ずつ以外）。⚠ 道の選び方は `animateExecution` と同じ順 */
    buildReplayMorphSegs(L, ms, segs, stops, pushMorph, smooth) {
        const plan = (!ms || ms === 'joinFirst') ? this.buildPlayback(L, ms) : null;
        if (plan) {
            segs.push({ dur: RX_PRE_MS, draw: t => this.renderPlaybackAt(plan, smooth(t)) });
            if (plan.partnerIds.length || plan.reacting.length || plan.rot) stops.push({ p: 1, key: 'summon' });
            segs.push({ dur: RX_HOLD_MS, draw: () => this.renderPlaybackAt(plan, 1) });   // 一呼吸（止まる段にはしない）
            if (plan.mid) {
                pushMorph(plan.S1, plan.mid, 450, 'align', u => this.renderPlaybackAt(plan, 1 + 0.5 * u));
                pushMorph(plan.mid, plan.A1, 400, 'join', u => this.renderPlaybackAt(plan, 1.5 + 0.5 * u));
            } else {
                pushMorph(plan.S1, plan.A1, HS_PLAIN_DURATION, 'join', u => this.renderPlaybackAt(plan, 1 + u));
            }
            segs.push({ dur: RX_POST_MS, draw: t => this.renderPlaybackAt(plan, 2 + smooth(t)) });
            stops.push({ p: segs.length, key: plan.transient.length ? 'fade' : 'settle' });
            return;
        }
        let b = L.before, a = L.after;
        const transient = (L.anim && L.anim.transient) || [];
        if (!ms || ms === 'joinFirst') {
            if (L.anim) { b = L.anim.before; a = L.anim.after; }
            const hx = this.withMorphHydrogens(b, a);
            b = hx.before; a = hx.after;
        }
        if (ms === 'joinFirst') {
            const mid = this.buildMidSnapshot(b, a, 'moveFirst');
            pushMorph(b, mid, 450, 'align');
            pushMorph(mid, a, 400, 'join');
        } else if (ms) {
            // 環化・開環（bondsFirst／moveFirst）。実行時はここでタップ待ちに止まる ＝ 見直しでは止まれる段にする
            const mid = this.buildMidSnapshot(b, a, ms);
            pushMorph(b, mid, 700, 'mid');
            pushMorph(mid, a, HS_PLAIN_DURATION, 'join');
        } else {
            pushMorph(b, a, HS_PLAIN_DURATION, 'join');
        }
        if (transient.length && (!ms || ms === 'joinFirst')) {
            const settled = this.settleSnapshot(a, transient), still = new Map();
            segs.push({ dur: RX_FADE_MS, draw: t => this.renderMorphFrame(a, settled, t, still) });
            stops.push({ p: segs.length, key: 'fade' });
        }
    }

    animateExecution(before, after, result, morphStages = null, anim = null, extra = {}) {
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
        /* ★ 自動水素をアニメの写しにだけ本物の H として置く（v1553・`withMorphHydrogens`）。
         *   ⚠ 途中で止める2段階（bondsFirst／moveFirst）は、止まった図を `renderStaticSnapshotWithHydrogens` が
         *   自分で水素を計算して描くので、ここでは足さない（二重に置かない） */
        const transient = anim ? anim.transient : null;
        if (!morphStages || morphStages === 'joinFirst') {
            /* ★ 置き直し → 一呼吸 → 握手 → 片付け の段取り（v1556・`buildPlayback`）。
             *   新しく見せるもの（相手・反応する H・環の回転・副生成物）が無い反応は下の今までどおりの再生 */
            const plan = this.buildPlayback({ before, after, anim, beforeReal: extra.beforeReal, rotation: extra.rotation }, morphStages);
            if (plan) { this.runPlayback(plan, highlight); return; }
            // ★ 反応式ぶんの相手と副生成物を置いた写し（v1556・`planEquation`）
            if (anim) { before = anim.before; after = anim.after; }
            const hx = this.withMorphHydrogens(before, after);
            before = hx.before;
            after = hx.after;
        }
        // モーフィングは表示のみの上書き。世代トークンで多重・中断を安全に扱う
        const gen = ++this._morphGen;
        this._morphing = true;
        this._morphSkip = false;
        this.renderMorphFrame(before, after, 0); // 先に反応前を描き、生成物→反応物のちらつきを防ぐ
        // 変化が大きい反応（環化・開環）は2段階に分けて見せる。前半＝最小限の変化（結合だけ／配置だけ）、
        // 後半＝残りの変化。中間で少し止めて、どこが変わったか目で追えるようにする（P12-7 M2f）
        // 2つの分子が結びつく反応は「①並ぶ → ②結合ができる」の2段で見せる（C-1。2026-08-01 ユーザー要望
        // 「2つの分子が整列して反応する」）。環化・開環の2段と違い**クリック待ちを挟まない**ので、
        // 収録やデモの流れは止まらない。第1段では結合をつないだまま原子だけが動くため、
        // 脱離する -OH の結合が伸びていき、第2段で切れて水になるのが目で追える
        if (morphStages === 'joinFirst') {
            const joinMid = this.buildMidSnapshot(before, after, 'moveFirst');
            const stop = () => this._morphSkip || this._morphGen !== gen;
            const t1 = this.morphTiming(before, joinMid, 450);
            const t2 = this.morphTiming(joinMid, after, 400);
            animateFramesLoop(t1.dur,
                t => { if (this._morphGen === gen) this.renderMorphFrame(before, joinMid, t1.warp(t)); },
                stop
            ).then(() => {
                if (this._morphGen !== gen) return null;
                if (this._morphSkip) return null;
                return animateFramesLoop(t2.dur,
                    t => { if (this._morphGen === gen) this.renderMorphFrame(joinMid, after, t2.warp(t)); },
                    stop);
            }).then(() => {
                if (this._morphGen !== gen) return null;
                return this.fadeOutTransient(after, transient, gen);
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
            const tm1 = this.morphTiming(before, mid, 700);
            animateFramesLoop(
                tm1.dur,
                t => { if (this._morphGen === gen) this.renderMorphFrame(before, mid, tm1.warp(t)); },
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
        const tmain = this.morphTiming(before, after, HS_PLAIN_DURATION);
        animateFramesLoop(
            tmain.dur,
            t => { if (this._morphGen === gen) this.renderMorphFrame(before, after, tmain.warp(t)); },
            () => this._morphSkip || this._morphGen !== gen
        ).then(() => {
            if (this._morphGen !== gen) return null;
            return this.fadeOutTransient(after, transient, gen);
        }).then(() => {
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
        const stop = () => this._morphSkip || this._morphGen !== gen;
        const shots = [before, ...stages];
        this.renderMorphFrame(shots[0], shots[1], 0);  // 先に反応前を描く（ちらつき防止）
        const run = (k) => {
            if (this._morphGen !== gen || this._morphSkip || k + 1 >= shots.length) {
                return Promise.resolve(null);
            }
            const from = shots[k], to = shots[k + 1];
            const mid = this.buildMidSnapshot(from, to, 'moveFirst');
            const s1 = this.morphTiming(from, mid, 450);
            const s2 = this.morphTiming(mid, to, 400);
            return animateFramesLoop(s1.dur,
                t => { if (this._morphGen === gen) this.renderMorphFrame(from, mid, s1.warp(t)); },
                stop
            ).then(() => {
                if (this._morphGen !== gen || this._morphSkip) return null;
                return animateFramesLoop(s2.dur,
                    t => { if (this._morphGen === gen) this.renderMorphFrame(mid, to, s2.warp(t)); },
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

    /** 紙のフリップの段: 各断片の回転を順に並べ、最後に「寄せる」を1段（再生と ▶ もう一度見る の共用） */
    haworthFlipLegs(shots) {
        const legs = [];
        shots.forEach(shot => {
            shot.flip.steps.forEach((step, i) => legs.push({ kind: 'turn', shot, step, i }));
            legs.push({ kind: 'slide', shot });
        });
        return legs;
    }

    /** 紙のフリップの段 `leg` の進み `t`（0〜1）での原子の位置 */
    haworthFlipPosAt(leg, t) {
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
        // 段の組み立て: 各断片の回転を順に並べ、最後に「寄せる」を1段（▶ もう一度見る と共用・v1568）
        const legs = this.haworthFlipLegs(shots);
        const posAt = (leg, t) => this.haworthFlipPosAt(leg, t);
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

    /* ======================================================================
     * ★★ 握手のつなぎ替え —— 設計図（DOM非依存の純関数）
     *
     * **1本の価標を中点で割り、半分ずつを「その原子の手」として持つ。**
     * 手は `{ atomId, from, to }` の3つ組だけでできている:
     *   - `from` … 反応前にどの原子のどの線につながっていたか（無ければ「何も無い所から伸びる手」）
     *   - `to`   … 反応後にどの原子のどの線につながるか（無ければ「つなぐ相手がいないまま消える手」）
     * ⚠ `atomId` は最初から最後まで変わらない ＝ **手はその原子から離れない。**
     * ⚠ 手の一覧は t に依らない ＝ **本数はどの瞬間も同じ。**
     * ====================================================================== */
    handshakePlan(before, after) {
        if (this._hsFrom === before && this._hsTo === after && this._hsPlan) return this._hsPlan;
        const bpos = new Map(before.atoms.map(a => [a.id, a]));
        const apos = new Map(after.atoms.map(a => [a.id, a]));
        const ang = (p, q) => Math.atan2(q.y - p.y, q.x - p.x);
        const keyOf = b => b.atomId1 < b.atomId2
            ? `${b.atomId1}\u0000${b.atomId2}` : `${b.atomId2}\u0000${b.atomId1}`;
        const bB = new Map(), aB = new Map();
        before.bonds.forEach(b => { if (bpos.has(b.atomId1) && bpos.has(b.atomId2)) bB.set(keyOf(b), b); });
        after.bonds.forEach(b => { if (apos.has(b.atomId1) && apos.has(b.atomId2)) aB.set(keyOf(b), b); });

        const pairs = [];
        new Set([...bB.keys(), ...aB.keys()]).forEach(k => {
            const fb = bB.get(k), tb = aB.get(k), ref = fb || tb;
            pairs.push({ k, id1: ref.atomId1, id2: ref.atomId2, n0: fb ? fb.type : 0, n1: tb ? tb.type : 0 });
        });
        pairs.sort((p, q) => (p.k < q.k ? -1 : p.k > q.k ? 1 : 0)); // ⚠ 手の順番を Set の走査順に頼らない

        /* ★ **二重結合のどちらの線が離れるか**を決めるための材料。
         *   原子ごとに「新しくできる結合の向き」と「切れる結合の向き」を集めておく。 */
        const push = (m, id, v) => { if (!m.has(id)) m.set(id, []); m.get(id).push(v); };
        const gainedDirs = new Map(), lostDirs = new Map();
        pairs.forEach(p => {
            if (p.n1 > p.n0 && apos.has(p.id1) && apos.has(p.id2)) {
                push(gainedDirs, p.id1, ang(apos.get(p.id1), apos.get(p.id2)));
                push(gainedDirs, p.id2, ang(apos.get(p.id2), apos.get(p.id1)));
            }
            if (p.n0 > p.n1 && bpos.has(p.id1) && bpos.has(p.id2)) {
                push(lostDirs, p.id1, ang(bpos.get(p.id1), bpos.get(p.id2)));
                push(lostDirs, p.id2, ang(bpos.get(p.id2), bpos.get(p.id1)));
            }
        });
        /* ★★ **決めごと**: 離れるのは「**新しい手が伸びていく側にある線**」。
         *   ⓘ エテン＋Br₂ なら Br は2つとも同じ側に付くので、その側の線が割れる
         *     ＝ 旋回がいちばん短くて済み、手が原子や他の線を横切らない。
         *   ⚠ 目印になる向きが1つも無いとき（水素化のように相手が自動水素で図に無いとき）は
         *     ＋側と決め打つ ＝ **同じ反応はいつも同じ線が割れる**（見るたびに違うと読めない）。 */
        const sideOf = (p, dirs) => {
            const P1 = bpos.get(p.id1) || apos.get(p.id1), P2 = bpos.get(p.id2) || apos.get(p.id2);
            if (!P1 || !P2) return 1;
            const L = Math.hypot(P2.x - P1.x, P2.y - P1.y) || 1;
            const nx = -(P2.y - P1.y) / L, ny = (P2.x - P1.x) / L; // ＋オフセットが向く向き
            let s = 0;
            [p.id1, p.id2].forEach(id =>
                (dirs.get(id) || []).forEach(a => { s += Math.cos(a) * nx + Math.sin(a) * ny; }));
            return s >= 0 ? 1 : -1;
        };
        const pickLanes = (offs, count, side) => {
            const idx = offs.map((o, i) => i)
                .sort((a, b) => (offs[b] * side) - (offs[a] * side) || a - b);
            return new Set(idx.slice(0, count));
        };

        const hands = [];
        let laneSeq = 0;
        pairs.forEach(p => {
            const k = Math.min(p.n0, p.n1);
            const off0 = HS_LANE_OFF[p.n0] || [], w0 = HS_LANE_W[p.n0] || [];
            const off1 = HS_LANE_OFF[p.n1] || [], w1 = HS_LANE_W[p.n1] || [];
            const broken = pickLanes(off0, p.n0 - k, sideOf(p, gainedDirs));
            const formed = pickLanes(off1, p.n1 - k, sideOf(p, lostDirs));
            const keptB = off0.map((o, i) => i).filter(i => !broken.has(i));
            const keptA = off1.map((o, i) => i).filter(i => !formed.has(i));
            /* 半分ずつの記述。`off` は**その原子から見た**符号にする
             * （相手側は法線が反転するので符号も反転する ＝ 世界座標では同じ側に乗る） */
            const side1 = self => (self === p.id1 ? 1 : -1);
            const end = (laneId, self, other, off, w, atAfter) => ({
                laneId, other, off: off * side1(self), w, atAfter
            });
            const lane = (i, j) => {
                const id = `L${laneSeq++}`;
                const f = i === null ? null : { i, off: off0[i], w: w0[i] };
                const g = j === null ? null : { j, off: off1[j], w: w1[j] };
                [p.id1, p.id2].forEach(self => {
                    const other = self === p.id1 ? p.id2 : p.id1;
                    hands.push({
                        atomId: self,
                        holds: !!(f && g), // ⚠ 保たれる線は最後まで握ったまま（離さない）
                        from: f ? end(id, self, other, f.off, f.w, false) : null,
                        to: g ? end(id, self, other, g.off, g.w, true) : null
                    });
                });
            };
            keptB.forEach((i, n) => lane(i, keptA[n]));                 // 保つ線
            [...broken].sort((a, b) => a - b).forEach(i => lane(i, null)); // 割れる線
            [...formed].sort((a, b) => a - b).forEach(j => lane(null, j)); // できる線
        });

        /* ★★ **手の対応づけ**（設計の芯）。原子ごとに「失った手」と「得た手」を突き合わせ、
         *   **同じ1本の手**として扱う ＝ それが旋回する手になる。
         * ⚠ **決めごと: 角度がいちばん近いものどうしを組む**（小さい方から順に確定する）。
         *   ⓘ 理由 ——「同じ手が向きを変えた」と読ませたいので、**回り幅が小さいほどよい**。
         *     順番で組むと、手が原子を突き抜けたり互いに交差したりして
         *     「別の手にすり替わった」ように見える。 */
        const byAtom = new Map();
        hands.forEach(h => { if (!byAtom.has(h.atomId)) byAtom.set(h.atomId, []); byAtom.get(h.atomId).push(h); });
        const angOf = (self, other, atAfter) => {
            const P = (atAfter ? apos : bpos).get(self), Q = (atAfter ? apos : bpos).get(other);
            return P && Q ? ang(P, Q) : 0;
        };
        byAtom.forEach((list, self) => {
            const losts = list.filter(h => h.from && !h.to);
            const gains = list.filter(h => !h.from && h.to);
            if (!losts.length || !gains.length) return;
            const cand = [];
            losts.forEach((L, li) => gains.forEach((G, gi) => cand.push({
                li, gi, d: hsAngleGap(angOf(self, L.from.other, false), angOf(self, G.to.other, true))
            })));
            cand.sort((a, b) => a.d - b.d || a.li - b.li || a.gi - b.gi);
            const usedL = new Set(), usedG = new Set();
            cand.forEach(c => {
                if (usedL.has(c.li) || usedG.has(c.gi)) return;
                usedL.add(c.li); usedG.add(c.gi);
                losts[c.li].to = gains[c.gi].to;   // 失った手が、得た手の行き先へ旋回する
                gains[c.gi].merged = true;
            });
        });
        const plan = { hands: hands.filter(h => !h.merged), pairs };
        this._hsFrom = before; this._hsTo = after; this._hsPlan = plan;
        return plan;
    }

    /** before→after に「結合の変わり目」があるか（無い段は今までどおりの動かし方でよい）。
     * ⚠ 4重以上の価標は平行線の置き方を知らない ＝ **その回は丸ごと v1539 の描き方に落とす**
     *   （半分に割れないレーンを混ぜると、そこだけ線が消える） */
    handshakeHasChange(before, after) {
        const pairs = this.handshakePlan(before, after).pairs;
        if (pairs.some(p => p.n0 > 3 || p.n1 > 3)) return false;
        return pairs.some(p => p.n0 !== p.n1);
    }

    /**
     * ★★ 時刻 t（0→1）の手の一覧。⚠ **返す手の本数と `atomId` は t に依らない。**
     * 各手は `{ atomId, ax, ay, angle, len, off, ... }` と、実際に描く線分 `x1,y1 → x2,y2`。
     * `x1,y1` は必ずその原子の縁（＝ 根元は原子から離れない）。
     */
    handshakeHandsAt(before, after, t, bend) {
        const plan = this.handshakePlan(before, after);
        const tt = hsClamp(t);
        const posT = hsEase(tt, HS_FLOAT_END, HS_SWING_END);
        const partT = hsEase(tt, HS_HOLD_END, HS_PART_END);
        const swingT = posT;
        const joinT = hsEase(tt, HS_SWING_END, 1);
        const openT = partT * (1 - joinT); // 1 ＝ 完全に離している
        const bpos = new Map(before.atoms.map(a => [a.id, a]));
        const apos = new Map(after.atoms.map(a => [a.id, a]));
        const at = id => {
            const b = bpos.get(id), a = apos.get(id);
            if (b && a) {
                const o = rxBendOffset(bend, id, posT);
                return { x: hsLerp(b.x, a.x, posT) + o.x, y: hsLerp(b.y, a.y, posT) + o.y };
            }
            return b || a || null;
        };
        const pos = new Map();
        new Set([...bpos.keys(), ...apos.keys()]).forEach(id => pos.set(id, at(id)));
        const out = [];
        plan.hands.forEach((h, i) => {
            const P = pos.get(h.atomId);
            if (!P) return;
            const Qf = h.from ? pos.get(h.from.other) : null;
            const Qt = h.to ? pos.get(h.to.other) : null;
            const geo = (Q) => Q
                ? { a: Math.atan2(Q.y - P.y, Q.x - P.x), half: Math.hypot(Q.x - P.x, Q.y - P.y) / 2 }
                : null;
            const gf = geo(Qf), gt = geo(Qt);
            // 片側しか無い手は「長さ0の手」を相手に見立てる ＝ 生える／消える が同じ式で書ける
            const aFrom = gf ? gf.a : (gt ? gt.a : 0);
            const aTo = gt ? gt.a : aFrom;
            const hFrom = gf ? gf.half : HS_INSET;
            const hTo = gt ? gt.half : HS_INSET;
            const angle = hsLerpAngle(aFrom, aTo, swingT);
            const base = hsLerp(hFrom, hTo, swingT);
            const open = h.holds ? 0 : openT;
            // 離したときに残す長さ。⚠ 原子の縁（HS_INSET）より必ず長い ＝ 手が消えてなくならない
            const free = Math.max(HS_INSET + HS_MIN_HAND, base - HS_PULL);
            const len = Math.max(HS_INSET, hsLerp(base, free, open));
            /* ⚠ オフセットは**旋回で**動かす（離すときには動かさない）。
             *   離した瞬間に中央へ寄せると、二重結合のどちらの線が割れたのかが見えなくなる（実測）。 */
            const off = hsLerp(h.from ? h.from.off : 0, h.to ? h.to.off : 0, swingT);
            const w = hsLerp(h.from ? h.from.w : (h.to ? h.to.w : 3), h.to ? h.to.w : (h.from ? h.from.w : 3), swingT);
            // 生える手は旋回のあいだに現れ、相手のいない手は旋回のあいだに消える
            const alpha = !h.from ? swingT : (!h.to ? 1 - swingT : 1);
            const ux = Math.cos(angle), uy = Math.sin(angle);
            const nx = -uy, ny = ux;
            out.push({
                index: i, atomId: h.atomId, holds: !!h.holds,
                fromOther: h.from ? h.from.other : null, toOther: h.to ? h.to.other : null,
                laneFrom: h.from ? h.from.laneId : null, laneTo: h.to ? h.to.laneId : null,
                ax: P.x, ay: P.y, angle, len, off, width: w, alpha,
                open, joinT, swingT, newborn: !h.from, orphan: !h.to,
                x1: P.x + ux * HS_INSET + nx * off, y1: P.y + uy * HS_INSET + ny * off,
                x2: P.x + ux * len + nx * off, y2: P.y + uy * len + ny * off
            });
        });
        return out;
    }

    /**
     * 手の一覧を「描く線分」に畳む。握ったまま（＝ 中点で割れていない）の2本は
     * **1本の線に戻してから描く**（半分ずつ描くと中点に継ぎ目が見えるため）。
     * 色は前後比較と同じ約束 —— 離れた手＝オレンジ、握手した所＝シアン。
     */
    handshakeSegments(before, after, t, atomAlpha, bend) {
        const hands = this.handshakeHandsAt(before, after, t, bend);
        const segs = [], marks = [];
        /* ★ **まだ握っている2本は1本に戻してから描く。**
         * ⚠ 半分ずつ描くと**中点に継ぎ目の点が出る**（実測: ①の静止中、二重結合の割れる側の
         *   まん中に薄い丸が見えていた ＝ 丸い線端どうしが重なっていた）。
         *   ⓘ「握手していた」の段は反応前の図そのものでなければならないので、ここは1本に戻す。 */
        const mergeKey = h => (h.open <= 1e-6 && h.laneFrom) ? h.laneFrom : null;
        const joinable = new Map();
        hands.forEach(h => {
            const k = mergeKey(h);
            if (!k) return;
            if (!joinable.has(k)) joinable.set(k, []);
            joinable.get(k).push(h);
        });
        const done = new Set();
        const tint = (h) => {
            const hot = h.newborn ? HS_CYAN : HS_ORANGE;
            if (h.joinT <= 0) return hsMix(HS_INK, hot, h.open);
            const met = hsMix(hot, HS_CYAN, Math.min(1, h.joinT * 2.5)); // 触れた瞬間シアンへ
            return hsMix(met, HS_INK, hsClamp((h.joinT - 0.5) / 0.5));   // 握り終えたら地の色へ
        };
        hands.forEach(h => {
            const fade = (atomAlpha && atomAlpha.get(h.atomId) !== undefined) ? atomAlpha.get(h.atomId) : 1;
            const alpha = Math.min(h.alpha, fade);
            if (alpha <= 0.001 || h.len <= HS_INSET + 0.01) return;
            const k = mergeKey(h);
            if (k && joinable.get(k) && joinable.get(k).length === 2) {
                if (done.has(k)) return;
                done.add(k);
                const o = joinable.get(k).find(x => x !== h) || h;
                segs.push({ x1: h.x1, y1: h.y1, x2: o.x1, y2: o.y1, width: h.width,
                    stroke: hsRgba(HS_INK), opacity: Math.min(alpha,
                        (atomAlpha && atomAlpha.get(o.atomId) !== undefined) ? atomAlpha.get(o.atomId) : 1) });
                return;
            }
            const col = tint(h);
            segs.push({ x1: h.x1, y1: h.y1, x2: h.x2, y2: h.y2, width: h.width,
                stroke: hsRgba(col), opacity: alpha });
            /* ★ **切れた手の先の印**（ユーザー「マーカーをつけてもよいかもしれません」）。
             *   ⚠ 線と同じ色にする ＝ 新しい色を1つも増やさない。 */
            if (h.open > 0.12) {
                marks.push({ x: h.x2, y: h.y2, r: 2.6,
                    fill: hsRgba([col[0], col[1], col[2], 1]), opacity: alpha * Math.min(1, h.open * 1.6) });
            }
        });
        return { segs, marks };
    }

    // before/after を t(0→1) で補間した描画データを返す純関数。原子はID対応で照合し、
    // 共通原子は座標を線形補間、脱離原子はフェードアウト、付加原子はフェードイン、
    // 結合は **握手のつなぎ替え**（価標を中点で割って旋回させる）で表す（DOM非依存＝テスト可能）。
    // ⚠ t=0 と t=1 では**まるごとの結合**を返す（＝ 反応前後の図そのもの。RX4 が見ている）。
    interpolateMorph(before, after, t, override, bend) {
        /* ★ **握手のつなぎ替えを使う条件**: 端点（t=0 / t=1）でないこと・結合が変わること・
         *   `override`（紙のフリップ）でないこと。⚠ どれかを外れたら v1539 までの描き方に落ちる
         *   ＝ 並ぶだけの段や糖のフリップの見え方は1ドットも変えていない。 */
        const useHS = t > 0 && t < 1 && !override && this.handshakeHasChange(before, after);
        const ease = useHS ? hsEase(t, HS_FLOAT_END, HS_SWING_END) : t;
        const lerp = (a, b) => a + (b - a) * ease;
        const clamp = o => Math.max(0, Math.min(1, o));
        const afterById = new Map(after.atoms.map(a => [a.id, a]));
        const beforeById = new Map(before.atoms.map(a => [a.id, a]));
        const atoms = [];
        before.atoms.forEach(a => {
            const af = afterById.get(a.id);
            // ★ 反応する H の道筋を横へ曲げる（v1556・`buildPlayback` の bend。相手の原子とすれ違うときに重ならない）
            const o = rxBendOffset(bend, a.id, ease);
            if (af) atoms.push({ id: a.id, element: a.element, x: lerp(a.x, af.x) + o.x, y: lerp(a.y, af.y) + o.y, opacity: 1 });
            else atoms.push({ id: a.id, element: a.element, x: a.x, y: a.y, opacity: clamp(1 - ease) }); // 脱離
        });
        after.atoms.forEach(a => {
            if (!beforeById.has(a.id)) atoms.push({ id: a.id, element: a.element, x: a.x, y: a.y, opacity: clamp(ease) }); // 付加
        });
        if (useHS) {
            const alphaById = new Map(atoms.map(a => [a.id, a.opacity]));
            const { segs, marks } = this.handshakeSegments(before, after, t, alphaById, bend);
            return { atoms, bonds: [], lanes: segs, marks };
        }
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
        return { atoms, bonds, lanes: [], marks: [] };
    }

    // 補間1フレームを実キャンバス（atomsGroup/bondsGroup）に描く。自動水素は省略（完了時に通常描画で出る）
    renderMorphFrame(before, after, t, override, scale, bend) {
        const g = this.game;
        g.atomsGroup.innerHTML = '';
        g.bondsGroup.innerHTML = '';
        const frame = this.interpolateMorph(before, after, t, override, bend);
        const NS = 'http://www.w3.org/2000/svg';
        (frame.lanes || []).forEach(s => {
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', s.x1); line.setAttribute('y1', s.y1);
            line.setAttribute('x2', s.x2); line.setAttribute('y2', s.y2);
            line.setAttribute('stroke', s.stroke);
            line.setAttribute('stroke-width', String(s.width));
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('opacity', String(s.opacity));
            line.setAttribute('class', 'svg-bond-ink');
            line.setAttribute('pointer-events', 'none');
            g.bondsGroup.appendChild(line);
        });
        (frame.marks || []).forEach(m => {
            const dot = document.createElementNS(NS, 'circle');
            dot.setAttribute('cx', m.x); dot.setAttribute('cy', m.y);
            dot.setAttribute('r', String(m.r));
            dot.setAttribute('fill', m.fill);
            dot.setAttribute('opacity', String(m.opacity));
            dot.setAttribute('pointer-events', 'none');
            g.bondsGroup.appendChild(dot);
        });
        frame.bonds.forEach(bd => {
            const start = g.bondsGroup.childElementCount;
            g.renderBond(bd.x1, bd.y1, bd.x2, bd.y2, bd.type, false);
            for (let i = start; i < g.bondsGroup.children.length; i++) {
                g.bondsGroup.children[i].setAttribute('opacity', String(bd.opacity));
            }
        });
        /* ★ 仮の [O] は札を「[O]」にする（v1556）。⚠ 旋回が始まるまで（握手し直したあとは本物の O） */
        const labels = new Map(before.atoms.filter(x => x.label).map(x => [x.id, x.label]));
        /* ★ 「×n」の札（v1560）。相手の札は握手が始まると薄れ、副生成物の札は握手のあとに現れる */
        const lt = (override || !this.handshakeHasChange(before, after)) ? t : hsEase(t, HS_FLOAT_END, HS_SWING_END);
        const drawMult = (snap, op) => (snap.labels || []).forEach(l => {
            const a = frame.atoms.find(x => x.id === l.id);
            const o = Math.min(op, a ? a.opacity : 0);
            if (!a || o <= 0.01) return;
            const txt = document.createElementNS(NS, 'text');
            txt.setAttribute('x', a.x + l.dx); txt.setAttribute('y', a.y + l.dy);
            txt.setAttribute('fill', '#ffd166');
            txt.setAttribute('font-size', '14');
            txt.setAttribute('font-weight', 'bold');
            txt.setAttribute('opacity', String(o));
            txt.setAttribute('class', 'rx-mult');
            txt.setAttribute('data-mult', l.text);
            txt.setAttribute('pointer-events', 'none');
            txt.textContent = l.text;
            g.atomsGroup.appendChild(txt);
        });
        if (before !== after) { drawMult(before, 1 - lt); drawMult(after, lt); } else drawMult(before, 1);
        frame.atoms.forEach(a => {
            const start = g.atomsGroup.childElementCount;
            g.renderAtom(`morph_${a.id}`, a.element, a.x, a.y, false);
            const lab = labels.get(a.id);
            // ★ 反応する H は重原子と同じ大きさの丸にする（v1556・大きさ 0→1 で H の丸 6 → 重原子の丸 10）
            const s = scale && a.element === 'H' ? (scale.get(a.id) || 0) : 0;
            for (let i = start; i < g.atomsGroup.children.length; i++) {
                const node = g.atomsGroup.children[i];
                node.setAttribute('opacity', String(a.opacity));
                if (s > 0) {
                    const circle = node.querySelector('circle'), txt = node.querySelector('text');
                    if (circle) circle.setAttribute('r', String(6 + 4 * s));
                    if (txt) { txt.style.fontSize = `${6.5 + 2.5 * s}px`; txt.setAttribute('y', String(a.y + 2 + s)); }
                    node.setAttribute('data-big-h', s.toFixed(2));
                }
                if (lab && (override || t < HS_FLOAT_END)) {
                    const txt = node.querySelector('text');
                    if (txt) { txt.textContent = lab; node.setAttribute('data-label', lab); }
                }
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
        this._replay = null;   // 見直す反応が無くなった（▶ は syncUndoButton が下ろす）
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
        /* ★★ 相手を呼んだ反応は、前後比較も**反応式の左辺と右辺**にそろえる（v1560・ユーザー
         *   「反応の前後を見る、では反応式の左辺と右辺が対応している状態にしてください」）。
         *   前 ＝ 基質＋呼んだ相手すべて／後 ＝ 生成物＋副生成物すべて（まとめたものは「×n」の札）。 */
        // ⚠ 鎖の端の R だけを置いた写し（`playbackOnly`・v1574）は再生専用。前後比較は今までどおり
        const eqAnim = rx.anim && !rx.anim.playbackOnly ? rx.anim : null;
        const src = eqAnim || rx;
        const diff = this.computeDiff(src.before, src.after);
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
        /* ★ 分子が多くて横に長いときは**上下に並べる**（v1560）。図は枠に収まるように縮む（viewBox）ので、
         *   横長の図を半分の幅に入れると字が読めないほど小さくなる。縦横比 2.2 を超えたら1列 */
        const aspect = s => {
            const xs = s.atoms.map(a => a.x), ys = s.atoms.map(a => a.y);
            return xs.length ? (Math.max(...xs) - Math.min(...xs) + 60) / (Math.max(...ys) - Math.min(...ys) + 60) : 1;
        };
        const stacked = Math.max(aspect(src.before), aspect(src.after)) > 2.2;
        const grid = document.createElement('div');
        grid.id = 'rx-cmp-grid';
        grid.setAttribute('data-layout', stacked ? 'stacked' : 'side');
        grid.style.cssText = `display:grid; grid-template-columns:${stacked ? '1fr' : '1fr 1fr'}; gap:12px; margin-bottom:10px;`;
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
        makeFig('反応前', src.before, {
            atoms: diff.removedAtoms.map(a => ({ x: a.x, y: a.y, color: ORANGE })),
            bonds: diff.lostBonds.map(b => ({ ...b, color: ORANGE, dashed: true }))
        }, ORANGE);
        makeFig('反応後', src.after, {
            atoms: diff.addedAtoms.map(a => ({ x: a.x, y: a.y, color: GREEN })),
            bonds: diff.gainedBonds.map(b => ({ ...b, color: CYAN, dashed: false }))
        }, CYAN);
        ov.appendChild(grid);
        // ★ 並んでいる物質と係数を反応式の形で1行（v1560）。caption の式と同じ数になる
        // ⚠ `equationRow: false`（加硫・v1579）は図だけそろえて式の行は出さない（基質の式に R が入るため）
        if (eqAnim && (PARTNER_EQUATIONS[rx.ruleId] || {}).equationRow !== false) {
            const eqEl = document.createElement('div');
            eqEl.id = 'rx-cmp-eq';
            eqEl.style.cssText = 'font-size:14px; color:#fff; text-align:center; margin:-2px 0 10px; letter-spacing:0.02em;';
            eqEl.textContent = this.equationText(rx.anim, rx.ruleId);
            ov.appendChild(eqEl);
        }

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
    /**
     * 写しの図を物質ごとに分け、係数つきの化学式の並びにする（v1560・前後比較の反応式）。
     * 対イオンの粒は相方に付ける（`game.attachCounterIons`）。「×n」の札は係数に入れる。
     */
    equationSide(snap) {
        const g = this.game;
        const m = this.molFromSnapshot(snap);
        const bare = new Set(snap.atoms.filter(a => a.bare).map(a => a.id));
        const mult = new Map((snap.labels || []).map(l => [l.id, parseInt(String(l.text).replace('×', ''), 10) || 1]));
        const hs = m.calculateHydrogens().filter(h => !bare.has(h.parentId));
        const seen = new Set();
        let parts = [];
        m.atoms.forEach(a => {
            if (seen.has(a.id)) return;
            const ids = new Set([a.id]), st = [a.id];
            seen.add(a.id);
            while (st.length) {
                const id = st.pop();
                m.getNeighbors(id).forEach(n => { if (!ids.has(n.atom.id)) { ids.add(n.atom.id); seen.add(n.atom.id); st.push(n.atom.id); } });
            }
            const p = new Molecule();
            m.atoms.filter(x => ids.has(x.id)).forEach(x => p.atoms.push(x));
            m.bonds.filter(b => ids.has(b.atomId1) && ids.has(b.atomId2)).forEach(b => p.bonds.push(b));
            parts.push(p);
        });
        if (typeof g.attachCounterIons === 'function') parts = g.attachCounterIons(parts);
        /* ⚠ 粒どうしの塩（NaCl・NaI・KCl）は相方の分子が無いので attachCounterIons では組まれない。
         *   残った1原子の陽イオンと陰イオンを、近いものどうしで1つにする（実測: NaI が「5Na ＋ I」と出た） */
        const lone = sign => parts.filter(p => p.atoms.length === 1 && p.bonds.length === 0 && Math.sign(p.atoms[0].charge || 0) === sign);
        const cats = lone(1), ans = lone(-1);
        const pairsIon = [];
        cats.forEach(cp => ans.forEach(ap => pairsIon.push({ cp, ap, d: Math.hypot(cp.atoms[0].x - ap.atoms[0].x, cp.atoms[0].y - ap.atoms[0].y) })));
        pairsIon.sort((p, q) => p.d - q.d);
        const usedIon = new Set();
        pairsIon.forEach(({ cp, ap }) => {
            if (usedIon.has(cp) || usedIon.has(ap)) return;
            usedIon.add(cp); usedIon.add(ap);
            cp.atoms.push(...ap.atoms);
            parts = parts.filter(p => p !== ap);
        });
        const sub = n => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        // 無機物は教科書の書き方にする（Hill 順だと NaOH が HNaO になる）
        const INORGANIC = { HNaO: 'NaOH', ClNa: 'NaCl', INa: 'NaI', 'CHNaO₃': 'NaHCO₃', 'NNaO₂': 'NaNO₂',
            'Na₂O₃S': 'Na₂SO₃', ClK: 'KCl', ClH: 'HCl', BrH: 'HBr', HI: 'HI', 'HNO₃': 'HNO₃', 'H₂O₄S': 'H₂SO₄' };
        const items = [];
        parts.forEach(p => {
            const ids = new Set(p.atoms.map(a => a.id));
            const cnt = {};
            p.atoms.forEach(a => { cnt[a.element] = (cnt[a.element] || 0) + 1; });
            const h = hs.filter(x => ids.has(x.parentId)).length;
            if (h) cnt.H = (cnt.H || 0) + h;
            let f;
            if (p.atoms.length === 1 && bare.has(p.atoms[0].id) && p.atoms[0].element === 'O') f = '[O]';
            else {
                const keys = Object.keys(cnt);
                const order = cnt.C ? ['C', 'H', ...keys.filter(k => k !== 'C' && k !== 'H').sort()] : keys.sort();
                f = order.filter(k => cnt[k]).map(k => k + (cnt[k] > 1 ? sub(cnt[k]) : '')).join('');
                f = INORGANIC[f] || f;
            }
            const k = Math.max(1, ...p.atoms.map(a => mult.get(a.id) || 1));
            const hit = items.find(x => x.f === f);
            if (hit) hit.n += k; else items.push({ f, n: k });
        });
        return items;
    }

    /** 前後比較に出す反応式。空気・O₂ で燃やす反応は [O] を ½O₂ に数え、分数になれば全体を2倍する（caption と同じ約束） */
    equationText(anim, ruleId) {
        let L = this.equationSide(anim.before);
        const R = this.equationSide(anim.after);
        const eq = PARTNER_EQUATIONS[ruleId];
        if (eq && eq.partners.includes('O2')) {
            const o = L.find(x => x.f === '[O]');
            if (o) {
                L = L.filter(x => x !== o);
                const o2 = L.find(x => x.f === 'O₂');
                if (o2) o2.n += o.n / 2; else L.push({ f: 'O₂', n: o.n / 2 });
            }
        }
        const k = [...L, ...R].some(x => !Number.isInteger(x.n)) ? 2 : 1;
        const fmt = list => list.map(x => `${x.n * k === 1 ? '' : x.n * k}${x.f}`).join(' ＋ ');
        return `${fmt(L)} → ${fmt(R)}`;
    }

    renderCompareFigure(svgId, snapshot, marks) {
        renderMoleculeIntoSvg(this.game, svgId, this.snapshotToTarget(snapshot));
        const svg = document.getElementById(svgId);
        if (!svg) return;
        const NS = 'http://www.w3.org/2000/svg';
        /* ★ 写しにだけ居る「bare」の原子（仮の [O]・金属の Na・Na₂SO₃ の S）は、この図の描き方だと
         *   自動水素が生えて水や NaH に見える。生えた H を消し、[O] の札を戻す（v1560） */
        (snapshot.atoms || []).filter(a => a.bare).forEach(a => {
            [...svg.querySelectorAll('.quiz-atoms text')].forEach(t => {
                const tx = +t.getAttribute('x'), ty = +t.getAttribute('y');
                if (t.textContent === 'H' && Math.hypot(tx - a.x, ty - a.y) < 26) {
                    const prev = t.previousElementSibling;
                    if (prev && prev.tagName === 'circle') prev.remove();
                    t.remove();
                }
                if (a.label && t.textContent === a.element && Math.abs(tx - a.x) < 3 && Math.abs(ty - a.y) < 6) t.textContent = a.label;
            });
            [...svg.querySelectorAll('.quiz-bonds line')].forEach(l => {
                const x1 = +l.getAttribute('x1'), y1 = +l.getAttribute('y1'), x2 = +l.getAttribute('x2'), y2 = +l.getAttribute('y2');
                if (Math.hypot(x2 - x1, y2 - y1) < 22 && pointSegmentDistance(a, { x: x1, y: y1 }, { x: x2, y: y2 }) < 14) l.remove();
            });
        });
        // 「×n」の札
        (snapshot.labels || []).forEach(lb => {
            const a = snapshot.atoms.find(x => x.id === lb.id);
            if (!a) return;
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', a.x + lb.dx); t.setAttribute('y', a.y + lb.dy);
            t.setAttribute('fill', '#ffd166'); t.setAttribute('font-size', '16'); t.setAttribute('font-weight', 'bold');
            t.setAttribute('class', 'rx-mult'); t.setAttribute('data-mult', lb.text);
            t.textContent = lb.text;
            svg.appendChild(t);
        });
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
    /* ★ 還元性の判定は**ここが唯一の正**（v1511）。⚠ 絞り込みモードの札「銀鏡反応を示した」は
     *   `narrowing.js` が `groups(m).includes('aldehyde')` で別に判定していて、
     *   **環状糖もフルクトースも全部 陰性**になる（統合セッションの実測）＝ 判定が2か所にある。
     *   ★ こちらから呼べるように出しておく（乗り換えは narrowing.js 側の仕事）。 */
    window.reducingCarbonylAtoms = reducingCarbonylAtoms;
    window.RULE_PHASE = RULE_PHASE;             // ルール → 層の対応表（SEP 群が読む）
    // 分液の棚に出す瓶（SEP11 が「表から導いているか」を読む・I-0032）
    window.phaseReagentIds = phaseReagentIds;
    // 水層の粒が相方のそばで読めるか（SEP9 が読む・v1569）
    window.counterIonOwners = counterIonOwners;
    window.counterIonReadsClearly = counterIonReadsClearly;
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
    // ★ 単独のベンゼン環（縮合していない6員の芳香環）。TR4 が
    //   「材料が無いから0件、ではない」を示すのに読む
    window.isolatedBenzeneRings = isolatedBenzeneRings;
    window.PARTNER_CANDIDATES = PARTNER_CANDIDATES;
    window.SELF_PARTNER_RULES = SELF_PARTNER_RULES; // PM5・PM6（1分子からの重合の入口）が読む
    window.SELF_PARTNER_UNITS = SELF_PARTNER_UNITS;
    window.PARTNER_HINTS_SEL = PARTNER_HINTS_SEL;
    window.findPartnerHints = findPartnerHints; // RX35（位置に依らないことの実測）が読む
    window.RX_SECTION_NEXT = RX_SECTION_NEXT;   // RX40（節の見出し）が読む
    window.RX_SECTION_LAST = RX_SECTION_LAST;
    window.RX_UNDO_POINTER = RX_UNDO_POINTER;
    window.RX_SCOPE_NOTE = RX_SCOPE_NOTE;       // RX43（「いま見ている分子」の断り）が読む
    window.RX_MORPH_NOTE = RX_MORPH_NOTE;       // RX4c（簡易版の但し書き）が読む
    window.RX_MORPH_NOTE_MECH = RX_MORPH_NOTE_MECH;
    window.HS_PHASES = {                        // RX4b（握手のつなぎ替え）が読む
        holdEnd: HS_HOLD_END, partEnd: HS_PART_END, floatEnd: HS_FLOAT_END,
        swingEnd: HS_SWING_END, duration: HS_DURATION, inset: HS_INSET
    };
    window.PARTNER_SUMMON = PARTNER_SUMMON;     // RXP1・RXP2（相手の分子を呼ぶ）が読む
    window.PARTNER_EQUATIONS = PARTNER_EQUATIONS; // RXP3〜（反応式ぶんの相手と副生成物・v1556）が読む
    window.isolatedBenzeneRings = isolatedBenzeneRings; // RXR1（反応のときに環を回す）が読む
    window.RX_SPECIES = RX_SPECIES;
    window.RX_NO_FOLD = RX_NO_FOLD;             // RXP4（H₂ を「×n」にまとめない）の否定対照が読む
    window.RX_NO_MORPH_H2 = RX_NO_MORPH_H2;     // RXP6（加硫で H₂ を呼ばない・発注書 K）の否定対照が読む
    window.NoRoomError = NoRoomError;           // RS1〜RS4（場所不足の出口）が読む
    window.noRoom = noRoom;
}
