/**
 * 立体対照ビュー（P7-5-M1 / 設計: DESIGN_3d_correspondence.md）
 * 選択した sp3 炭素を中心に、教科書のくさび形表記（wedge-dash）で
 * 「作図は90°だが実際は正四面体（約109.5°）」であることを対照提示する。
 * パズルの作図・判定には一切影響しない別枠表示。
 *
 * P12-7 M3（DESIGN_stereochemistry.md）: 疑似3D回転ビューアを併設。
 * chemistry.js の tetrahedralDirs / parityFromDirs（Fable 実装のコア）を呼び、
 * ユーザーが実際に描いた立体（フィッシャー投影・ハース環）と一致する3D配置を回して見せる。
 * 依存ライブラリなし（自前の回転行列＋弱い透視投影＋画家のアルゴリズム）。
 *
 * P12-8: くさび図をフィッシャー投影の規約（縦=紙面の奥・横=紙面の手前）に作り直し、
 * chemistry.js の fischerSlots が読めた配置をそのまま描く（従来の独自形は左右が正反対で
 * 4方向が同一平面に乗り、手性を表現できなかった）。あわせて3Dビューに「回転軸」を追加し、
 * 中心炭素から各置換基へ伸びる結合を軸にした回転（ロドリゲスの回転公式）を選べるようにした。
 */

// 置換基の表示ラベル（単原子なら OH / NH2 / CH3 形式、枝なら組成式）
function substituentLabel(mol, rootId, centerId) {
    const root = mol.atoms.find(a => a.id === rootId);
    const beyond = mol.getNeighbors(rootId)
        .filter(n => n.atom.id !== centerId && n.atom.element !== 'H');
    if (beyond.length === 0) {
        const h = mol.getFreeValency(rootId);
        const sub = (n) => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        return root.element + (h > 0 ? 'H' + (h > 1 ? sub(h) : '') : '');
    }
    // よく出る官能基は組成式ではなく慣用の書き方にする（P12-8。ユーザー要望:
    // 原子を組み立てて作った -COOH が "CHO₂" と出ていた）
    const conventional = conventionalGroupLabel(mol, rootId, centerId);
    if (conventional) return conventional;
    return fragmentFormula(mol, rootId, centerId);
}

/**
 * 置換基が定番の官能基なら慣用表記（-COOH・-CHO・-CH₂OH・-C≡N など）を返す。
 * 当てはまらなければ null（呼び出し側が組成式にフォールバックする）。
 * 表示専用の処理で、判定・立体コードには一切影響しない。
 */
function conventionalGroupLabel(mol, rootId, centerId) {
    const root = mol.atoms.find(a => a.id === rootId);
    if (!root || root.element !== 'C') return null;
    const nbrs = mol.getNeighbors(rootId).filter(n => n.atom.id !== centerId);
    const heavy = nbrs.filter(n => n.atom.element !== 'H');
    const oDouble = heavy.filter(n => n.type === 2 && n.atom.element === 'O');
    const oSingle = heavy.filter(n => n.type === 1 && n.atom.element === 'O');
    const nTriple = heavy.filter(n => n.type === 3 && n.atom.element === 'N');
    const isTerminal = a => mol.getNeighbors(a.id).filter(x => x.atom.id !== rootId && x.atom.element !== 'H').length === 0;

    // -COOH（カルボキシ基）: =O ひとつと -OH ひとつ
    if (heavy.length === 2 && oDouble.length === 1 && oSingle.length === 1 &&
        isTerminal(oSingle[0].atom) && mol.getFreeValency(oSingle[0].atom.id) === 1) {
        return 'COOH';
    }
    // -CHO（アルデヒド）: =O のみで、根の炭素に水素が1つ
    if (heavy.length === 1 && oDouble.length === 1 && mol.getFreeValency(rootId) === 1) {
        return 'CHO';
    }
    // -CH₂OH（ヒドロキシメチル）: -OH のみで、根の炭素に水素が2つ
    if (heavy.length === 1 && oSingle.length === 1 && mol.getFreeValency(rootId) === 2 &&
        isTerminal(oSingle[0].atom) && mol.getFreeValency(oSingle[0].atom.id) === 1) {
        return 'CH₂OH';
    }
    // -C≡N（ニトリル）
    if (heavy.length === 1 && nTriple.length === 1 && isTerminal(nTriple[0].atom)) {
        return 'C≡N';
    }
    return null;
}

// 疑似3D表示のパラメータ（SVG座標系。x=右・y=下・z=手前が正。chemistry.js の面の向きと同じ）
// 結合を軸に回すとき、他の3置換基が中心原子の丸と重なって「その場で回っている」ように
// 見えて分かりにくかったため、**幾何（109.5°）は変えずに**中心を小さく・結合を長くして
// 円すいの動きを見えやすくした（P12-8。傘を閉じる＝角度を変える案は正しさを損なうので不採用）
const STEREO3D_BOND = 78;    // 結合の長さ
const STEREO3D_PERSP = 340;  // 弱い透視投影の視点距離（大きいほど正射影に近い）
const STEREO3D_HUB = 13;     // 中心炭素の円の半径
// 回転軸を選んだときの見下ろし角（P12-8）。0 だと軸以外の2つが真上に重なって見えるので少し傾ける
const STEREO3D_AXIS_TILT = -0.42;
// 回転軸を画面上のどの向きに構えるか（P12-8。SVG座標系: x=右・y=下・z=手前が正）。
// 'away'（奥）は軸を視線方向に置く＝**ニューマン投影に近い見え方**で、
// 残り3つが 120° 間隔に開いて回る向きが読める（R/S の考え方に直結）
const STEREO3D_AXIS_FACING = {
    up: [0, -1, 0],
    away: [0, 0, -1],
    right: [1, 0, 0],
    left: [-1, 0, 0]
};

// フィッシャー投影の各スロットが指す3D方向（縦=紙面の奥・横=紙面の手前。SVG座標系で z+ が手前）。
// この4本は同一平面に乗らないので、スロット割り当てだけで手性（パリティ）が決まる。
// くさび図の並べ替えが「パリティを保つ操作」であることの根拠であり、テストの機械検証にも使う（P12-8）。
const FISCHER_SLOT_DIRS = {
    up: [0, -1, -1], right: [1, 0, 1], down: [0, 1, -1], left: [-1, 0, 1]
};
// 上を固定して残り3つが回るときの軌跡（P12-8。ユーザー要望「軌跡を円弧の投影に近づける」）。
// right/down/left の3スロットは、この楕円上でちょうど120°間隔に並ぶ（実測: 119.5/120.0/120.5°）。
// これは十字の配置が「上の結合を軸とする円すいの投影」であることの現れで、
// 角度を±120°動かせば**本物の円運動の投影＝楕円弧**の軌跡になる（直線移動より実際の動きに近い）
const WEDGE_ARC = { cx: -0.7, cy: 32.7, rx: 110.9, ry: 55.3 };
// スロットの日本語名（説明文で「どこが食い違っているか」を言葉でも示すため。P12-8）
const WEDGE_SLOT_JA = { up: '上', right: '右', down: '下', left: '左' };
// くさび図のクリック判定領域（スロットごと。互いに重ならない矩形 [x, y, w, h]）
const WEDGE_SLOT_LAYOUT = {
    up: { lx: 0, ly: -78, hit: [-38, -104, 76, 90] },
    down: { lx: 0, ly: 88, hit: [-38, 14, 76, 90] },
    right: { lx: 96, ly: 5, hit: [42, -24, 94, 48] },
    left: { lx: -98, ly: 5, hit: [-136, -24, 94, 48] }
};

class StereoView {
    constructor(game) {
        this.game = game;
        this.picking = false; // 対象炭素の選択待ち状態
        this.modal = document.getElementById('stereo-modal');
        this.svg = document.getElementById('stereo-svg');
        this.captionEl = document.getElementById('stereo-caption');

        // P12-7 M3: 疑似3D回転ビューア
        this.titleEl = document.getElementById('stereo-title');
        this.svg3d = document.getElementById('stereo-3d-svg');
        this.noteEl = document.getElementById('stereo-3d-note');
        this.paneWedge = document.getElementById('stereo-pane-wedge');
        this.pane3d = document.getElementById('stereo-pane-3d');
        this.tabWedge = document.getElementById('btn-stereo-tab-wedge');
        this.tab3d = document.getElementById('btn-stereo-tab-3d');
        this.spinBtn = document.getElementById('btn-stereo-spin');
        this.mirrorBtn = document.getElementById('btn-stereo-mirror');
        this.axisRow = document.getElementById('stereo-axis-row'); // P12-8: 回転軸の切り替え

        // P12-8: くさび図のローテーション（クリックした枝を上へ）＋鏡像比較
        this.wedgeMirrorBtn = document.getElementById('btn-stereo-wedge-mirror');
        this.wedgeResetBtn = document.getElementById('btn-stereo-wedge-reset');
        this.wedgeNoteEl = document.getElementById('stereo-wedge-note');
        this.wedgeMirror = false;    // くさび図を鏡像と並べているか
        // P12-8: 鏡像ペインの並べ方（'symmetric' = 鏡に映したまま／'align' = 偶置換だけで極力そろえる）
        this.wedgeMirrorLayout = 'symmetric';
        this.wedgeLayoutRow = document.getElementById('stereo-wedge-layout-row');
        this.wedgeLayoutBtnSym = document.getElementById('btn-stereo-wedge-layout-symmetric');
        this.wedgeLayoutBtnAlign = document.getElementById('btn-stereo-wedge-layout-align');
        this._viewSlots = null;      // 今表示しているスロット割り当て（ref。読めない中心は null）
        this._mirrorSlots = null;    // 鏡像ペインのスロット割り当て
        this._fallbackLabels = null; // スロットが読めないときの「一例」配置のラベル
        this._wedgeMoved = false;    // 一度でも並べ替えたか（説明の出し分け）
        this._wedgeCycled = false;   // 上を固定した巡回を使ったか（同上）

        this.mode = 'wedge';   // 'wedge' | '3d'
        this.mirror = false;   // 鏡像と並べるモード
        // P12-8: 3Dビューの鏡像ペインの構え方
        //   'symmetric' … 本当の鏡像配置のまま（「鏡に映すとこうなる」）
        //   'align'     … 鏡像側の回転軸をオリジナルと同じ画面上の向きに合わせる
        //                 （軸を揃えても残り3つが重ならない＝非重ね合わせが直接見える）
        this.mirrorLayout = 'symmetric';
        this.mirrorLayoutRow = document.getElementById('stereo-mirror-layout-row');
        this.mirrorLayoutBtnSym = document.getElementById('btn-stereo-mirror-layout-symmetric');
        this.mirrorLayoutBtnAlign = document.getElementById('btn-stereo-mirror-layout-align');
        this.angleX = 0;       // X軸まわり（上下の傾き）
        this.angleY = 0;       // Y軸まわり（左右の回転）
        this.axisIndex = null; // 回転軸に選んだ結合（_dirs の添字。null = 画面基準）
        this.axisAngle = 0;    // 選んだ結合まわりの回転角
        this.axisFacing = 'auto'; // 軸を画面上のどの向きに構えるか（P12-8）
        this._alignM = null;      // 向きを合わせる回転行列（axisFacing が auto 以外のとき）
        this._wedgeAnimGen = 0;   // くさび図の移動アニメの世代（連打時に追い越すため）
        this._lastCycleDir = null; // 直近の巡回方向（'cw'|'ccw'）。回転方向の矢印表示に使う
        this.autoRotate = !StereoView.prefersReducedMotion();
        this._raf = null;
        this._drag = null;
        this._dirs = null;     // 基準の方向ベクトル [{ref, code, v}]（テストが参照する内部状態）
        this._drawn = null;    // 実際に描いた回転後のベクトル { left, right }（同上）
        this._parity = null;   // 描かれた立体から読めたパリティ（読めなければ null）
        this._slots = null;    // フィッシャー投影として読めたスロット（読めなければ null）
        this._isAsym = false;

        document.getElementById('btn-stereo').addEventListener('click', () => this.togglePicking());
        document.getElementById('btn-stereo-close').addEventListener('click', () => this.close());
        // 枠外（オーバーレイ部分）のクリックでも閉じる（P12-8。ユーザー要望）。
        // 中身のクリックで閉じないよう、イベントの発生元がオーバーレイ自身のときだけ閉じる
        this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
        this.tabWedge.addEventListener('click', () => this.setMode('wedge'));
        this.tab3d.addEventListener('click', () => this.setMode('3d'));
        this.spinBtn.addEventListener('click', () => this.setAutoRotate(!this.autoRotate));
        this.mirrorBtn.addEventListener('click', () => this.setMirror(!this.mirror));
        this.wedgeCwBtn = document.getElementById('btn-stereo-wedge-cw');
        this.wedgeCcwBtn = document.getElementById('btn-stereo-wedge-ccw');
        if (this.wedgeCwBtn) this.wedgeCwBtn.addEventListener('click', () => this.cycleWedge('cw'));
        if (this.wedgeCcwBtn) this.wedgeCcwBtn.addEventListener('click', () => this.cycleWedge('ccw'));
        if (this.wedgeMirrorBtn) this.wedgeMirrorBtn.addEventListener('click', () => this.setWedgeMirror(!this.wedgeMirror));
        if (this.wedgeResetBtn) this.wedgeResetBtn.addEventListener('click', () => this.resetWedge());
        // P12-8: 鏡像ペインの配置モード切替（くさび図・3D）
        if (this.wedgeLayoutBtnSym) this.wedgeLayoutBtnSym.addEventListener('click', () => this.setWedgeMirrorLayout('symmetric'));
        if (this.wedgeLayoutBtnAlign) this.wedgeLayoutBtnAlign.addEventListener('click', () => this.setWedgeMirrorLayout('align'));
        if (this.mirrorLayoutBtnSym) this.mirrorLayoutBtnSym.addEventListener('click', () => this.setMirrorLayout('symmetric'));
        if (this.mirrorLayoutBtnAlign) this.mirrorLayoutBtnAlign.addEventListener('click', () => this.setMirrorLayout('align'));
        this.svg.addEventListener('click', (e) => this.handleWedgeClick(e));
        document.getElementById('btn-stereo-reset').addEventListener('click', () => this.resetAngles());
        this.svg3d.addEventListener('dblclick', () => this.resetAngles());
        // 画面幅が変わったら（回転・リサイズ）レイアウトを組み直す（P12-8。縦横で配置が変わるため）
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (this.modal.classList.contains('hidden')) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.renderWedgeAll();
                this.render3D();
            }, 150);
        });
        this.bindDrag();
        this.updateSpinButton();
    }

    /**
     * スマホ縦画面など横幅の狭い環境か（P12-8）。鏡像2ペインを横並びにすると各ペインが
     * 小さくなりすぎるため、この場合は上下に積むレイアウトへ切り替える
     */
    static isNarrowLayout() {
        return typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 760;
    }

    static prefersReducedMotion() {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    togglePicking() {
        this.picking = !this.picking;
        if (this.picking) {
            this.game.showToast('立体表示したい sp3炭素（すべて単結合の炭素）をキャンバスでクリックしてください。', 4000, 'success');
        } else {
            this.game.showToast('立体表示の選択を解除しました。', 1500, 'success');
        }
    }

    // キャンバスのクリック時に game 側から呼ばれる。選択モード中なら true を返して通常編集を止める
    handlePick(atom) {
        if (!this.picking) return false;
        this.picking = false;
        if (!atom || !this.game.userMolecule.isSp3Carbon(atom.id)) {
            this.game.showToast('sp3炭素（すべて単結合の炭素）を選んでください。二重・三重結合を持つ炭素や他の元素は対象外です。');
            return true;
        }
        this.show(atom);
        return true;
    }

    close() {
        this.stopSpin();
        this.modal.classList.add('hidden');
    }

    show(atom) {
        const mol = this.game.userMolecule;
        this.mol = mol;
        this.centerId = atom.id;
        const labels = [];
        mol.getNeighbors(atom.id)
            .filter(n => n.atom.element !== 'H')
            .forEach(n => labels.push(substituentLabel(mol, n.atom.id, atom.id)));
        for (let i = 0; i < mol.getFreeValency(atom.id); i++) {
            labels.push('H');
        }

        // 描かれた立体を読む（フィッシャー投影＝非環／ハース環＝環。両者は相互排他）
        const parities = Object.assign({}, readAtomParityFromFischer(mol), readRingParityFromHaworth(mol));
        const p = parities[atom.id];
        this._parity = (p === 1 || p === -1) ? p : null;
        this._isAsym = mol.isAsymmetricCarbon(atom.id);
        // 不斉中心なら「読めた立体に一致する」正四面体配置。不斉でなければ既定配置（手性は名乗らない）
        this._tetra = tetrahedralDirs(mol, atom.id, this._parity);
        this._dirs = this._tetra || this.defaultDirs(mol, atom.id);

        // くさび図はフィッシャー投影の規約（縦=紙面の奥・横=紙面の手前）で描く（P12-8）。
        // この向きなら4方向は同一平面に乗らないため、くさび図でも手性を表現できる。
        // fischerSlots が読めたら「ユーザーが描いた配置そのまま」を描く。読めない中心
        // （軸から外れた作図・環の中の炭素）は従来どおり一例として描き、その旨を明示する。
        const slots = (typeof fischerSlots === 'function') ? fischerSlots(mol, atom.id) : null;
        this._slots = slots;
        // くさび図の並べ替え状態を初期化（毎回「描いたまま」から始める）
        this.wedgeMirror = false;
        this.wedgeMirrorLayout = 'symmetric';
        this._wedgeMoved = false;
        this._wedgeCycled = false;
        this._lastCycleDir = null;
        this._mirrorSlots = null;
        if (slots) {
            this._viewSlots = Object.assign({}, slots);
            this._fallbackLabels = null;
        } else {
            this._viewSlots = null;
            const sorted = [...labels].sort((a, b) => b.length - a.length || a.localeCompare(b));
            this._fallbackLabels = { up: sorted[0], down: sorted[1], right: sorted[2], left: sorted[3] };
        }
        this.renderWedgeAll();

        // 教育文言と不斉判定の連携
        let stereoText;
        if (this._isAsym) {
            stereoText = `この炭素は不斉炭素です。4つの置換基（${labels.join('、')}）がすべて異なるため、鏡に映した分子とは重ね合わせられません（鏡像異性体が存在します）。`;
        } else {
            const seen = new Set();
            const dup = labels.find(l => seen.size === seen.add(l).size) ||
                        labels.find((l, i) => labels.indexOf(l) !== i);
            stereoText = `同じ置換基（${dup ?? labels[0]}）が複数あるため、この炭素は不斉炭素ではありません。`;
        }
        let originNote;
        if (slots) {
            originNote = '※あなたが描いた向きのまま、縦を奥・横を手前として並べています。';
            if (this._parity) originNote += 'くさび図・3Dビューとも、あなたが描いた立体を反映しています。';
            else if (!this._isAsym) originNote += 'この炭素は不斉ではないので、どう並べても同じ分子です。';
        } else if (StereoView.isRingAtom(mol, atom.id)) {
            originNote = '※環の中の炭素なので、くさび図の並びは一例です（フィッシャー投影としては読みません）。' +
                         '環の立体は「⬍ α/β 面マーク」と「🧊 3Dで回す」で確認できます。';
        } else {
            originNote = '※この描き方では立体が指定されていません（並びは一例です）。' +
                         '置換基をフィッシャー投影の軸方向（縦・横）に描くと、くさび図もその向きになります。';
        }
        this.captionEl.textContent =
            'くさび図はフィッシャー投影の規約で描いています。縦（上・下）は紙面の奥＝ハッシュ（刻み線）、横（左・右）は紙面の手前＝▶（黒いくさび）への結合です。\n' +
            '作図では90°の直交で描いていますが、実際のsp3炭素の結合角は約109.5°で、4つの置換基は正四面体の頂点方向に伸びています。\n' +
            stereoText + '\n' +
            originNote;

        // 3Dビューは毎回リセット（正面・鏡像オフ・回転軸は画面基準）してから開く
        this.mirror = false;
        this.mirrorLayout = 'symmetric';
        this.angleX = 0;
        this.angleY = 0;
        this.axisIndex = null;
        this.axisAngle = 0;
        this.updateMirrorButton();
        this.buildAxisButtons();
        this.setMode('wedge');
        this.render3D();
        this.modal.classList.remove('hidden');
    }

    // 表示ラベル（ref は置換基の atomId または 'H'）
    labelOf(ref) {
        return ref === 'H' ? 'H' : substituentLabel(this.mol, ref, this.centerId);
    }

    // 不斉でない中心（メタン等）の既定の正四面体配置。手性は意味を持たない
    defaultDirs(mol, atomId) {
        const refs = mol.getNeighbors(atomId)
            .filter(n => n.atom.element !== 'H')
            .map(n => n.atom.id);
        for (let i = 0; i < mol.getFreeValency(atomId); i++) refs.push('H');
        if (refs.length !== 4) return null;
        const items = refs.map(ref => ({
            ref,
            code: ref === 'H' ? 'H' : rootedFragmentCode(mol, ref, atomId)
        }));
        items.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
        const V = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
        const norm = v => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; };
        return items.map((it, i) => ({ ref: it.ref, code: it.code, v: norm(V[i]) }));
    }

    // ===== くさび図（P12-8: フィッシャー投影の規約＋ローテーション／鏡像比較） =====

    /**
     * フィッシャー投影で「許される」並べ替え（P12-8）。
     * key に指定したスロットの中身が up に来るように、スロットの中身を動かした新しい割り当てを返す。
     *   up   : 何もしない（恒等）
     *   down : 180°回転 = (up down)(left right) … 転置2回＝偶置換
     *   right: left を固定した3巡回 up→down→right→up … 偶置換
     *   left : right を固定した3巡回 up→down→left→up … 偶置換
     * すべて偶置換なので parityFromDirs（＝手性）は不変＝表示中の分子は変わらない。
     * 逆に、90°回転や2つの入れ替え（奇置換）は鏡像異性体にすり替わるので絶対に使わない。
     */
    static rotateSlotsTo(slots, key) {
        const s = slots;
        if (key === 'down') return { up: s.down, right: s.left, down: s.up, left: s.right };
        if (key === 'right') return { up: s.right, right: s.down, down: s.up, left: s.left };
        if (key === 'left') return { up: s.left, right: s.right, down: s.up, left: s.down };
        return { up: s.up, right: s.right, down: s.down, left: s.left };
    }

    /**
     * 上の枝を固定したまま、残りの3つ（右・下・左）を巡回させる（P12-8。ユーザー要望）。
     * 3巡回は偶置換なので**パリティは不変＝分子は変わらない**。
     * dir='cw'（右回り）: right→down→left→right ／ dir='ccw'（左回り）はその逆。
     * どちらも偶置換なので両方向とも化学的に正しい（3回続けると元の並びに戻る）。
     * 「固定した1つ以外の3つの巡回順（＝手性）は変わらない」ことを体感させるのが目的で、
     * R/S 判定（最下位を奥に置いて残り3つの回る向きを読む）の考え方に直結する。
     */
    static cycleOthers(slots, dir) {
        const s = slots;
        if (dir === 'ccw') return { up: s.up, right: s.down, down: s.left, left: s.right };
        return { up: s.up, right: s.left, down: s.right, left: s.down }; // cw
    }

    // 鏡像: 左右スロットの入れ替え（転置1回＝奇置換）→ パリティが反転する＝別の分子（鏡像異性体）
    static mirrorSlots(slots) {
        return { up: slots.up, right: slots.left, down: slots.down, left: slots.right };
    }

    /**
     * 「許される並べ替え」だけで到達できる配置をすべて列挙する（P12-8）。
     * 生成元は rotateSlotsTo（180°回転・1つを固定した3巡回）と cycleOthers（上を固定した3巡回）だけ、
     * すなわち**偶置換のみ**なので、ここに現れる配置はすべて元と同じ分子（パリティ不変）。
     * 置換基がすべて異なれば 12 通り（＝4文字の偶置換 A4 の位数）になる。
     * 「どれだけ回しても鏡像には一致しない」ことを総当たりで示すための土台。
     */
    static evenArrangements(slots) {
        const K = ['up', 'right', 'down', 'left'];
        const key = s => K.map(k => String(s[k])).join('|');
        const out = [Object.assign({}, slots)];
        const seen = new Set([key(slots)]);
        for (let i = 0; i < out.length; i++) {
            const cur = out[i];
            const next = [
                StereoView.rotateSlotsTo(cur, 'down'),
                StereoView.rotateSlotsTo(cur, 'right'),
                StereoView.rotateSlotsTo(cur, 'left'),
                StereoView.cycleOthers(cur, 'cw'),
                StereoView.cycleOthers(cur, 'ccw')
            ];
            next.forEach(s => {
                const k = key(s);
                if (!seen.has(k)) { seen.add(k); out.push(s); }
            });
        }
        return out;
    }

    /**
     * slots を（偶置換だけで）target にできるだけ近づけた配置を返す（P12-8）。
     * idOf は「同じ中身とみなす鍵」（既定は ref そのもの。呼び出し側は正準コードを渡して
     * 化学的に等価な枝＝同じ、として比べる）。
     * slots が target の鏡像（奇置換ぶん違う）なら、一致するスロットは最大でも2つにしかならない
     * （奇置換の不動点は転置の2個が最大・4巡回は0個）。この「必ず残る食い違い」が
     * 「鏡像異性体は回転では重ね合わせられない」ことの証拠になる。
     */
    static bestAlignedArrangement(slots, target, idOf) {
        const K = ['up', 'right', 'down', 'left'];
        const id = idOf || (r => String(r));
        const all = StereoView.evenArrangements(slots);
        let best = all[0], bestScore = -1;
        all.forEach(s => {
            const n = K.filter(k => id(s[k]) === id(target[k])).length;
            // 同点なら「上（基準として読みやすい位置）が一致するもの」を選ぶ
            const score = n * 10 + (id(s.up) === id(target.up) ? 1 : 0);
            if (score > bestScore) { bestScore = score; best = s; }
        });
        return best;
    }

    // スロットの中身を「化学的に等価かどうか」で比べるための鍵（同じ枝は同じコードになる）
    slotCode(ref) {
        if (ref === 'H' || ref === undefined || ref === null) return 'H';
        return typeof rootedFragmentCode === 'function'
            ? rootedFragmentCode(this.mol, ref, this.centerId) : String(ref);
    }

    // 鏡像ペインを「並びを揃える」モードで作る（偶置換だけで viewSlots に最接近させる）
    alignedMirrorFor(viewSlots) {
        const base = StereoView.mirrorSlots(viewSlots);
        return StereoView.bestAlignedArrangement(base, viewSlots, r => this.slotCode(r));
    }

    // 現在の左右のくさび図で中身が食い違っているスロット（不斉中心なら必ず2つ残る）
    wedgeMismatchSlots() {
        if (!this._viewSlots || !this._mirrorSlots) return [];
        return ['up', 'right', 'down', 'left']
            .filter(k => this.slotCode(this._mirrorSlots[k]) !== this.slotCode(this._viewSlots[k]));
    }

    // 「並びを揃える」モードで鏡像を表示中か（このとき操作は両ペインへ同じように掛ける）
    isWedgeAligned() {
        return this.wedgeMirror && !!this._mirrorSlots && this.wedgeMirrorLayout === 'align';
    }

    /** 鏡像ペインの並べ方を切り替える（P12-8。'symmetric' | 'align'） */
    setWedgeMirrorLayout(mode) {
        this.wedgeMirrorLayout = mode === 'align' ? 'align' : 'symmetric';
        if (this._viewSlots && this.wedgeMirror) {
            // どちらのモードでも鏡像（＝奇置換ぶん違う配置）であることは変えない。
            // symmetric は左右入れ替えそのもの、align はそれを偶置換で揃え直しただけ
            this._mirrorSlots = this.wedgeMirrorLayout === 'align'
                ? this.alignedMirrorFor(this._viewSlots)
                : StereoView.mirrorSlots(this._viewSlots);
        }
        this._lastCycleDir = null;
        this.renderWedgeAll();
    }

    // スロット割り当てを parityFromDirs に渡せる形（{ref, code, v}）にする。
    // v はフィッシャー規約の3D方向。並べ替えの正しさ（パリティ不変）の機械検証に使う
    slotDirs(slots) {
        if (!slots || !this.mol) return null;
        return ['up', 'right', 'down', 'left'].map(k => ({
            ref: slots[k],
            code: slots[k] === 'H' ? 'H' : rootedFragmentCode(this.mol, slots[k], this.centerId),
            v: FISCHER_SLOT_DIRS[k]
        }));
    }

    // 表示中のくさび図のパリティ（which: 'left'=あなたの分子 / 'right'=鏡像）
    wedgeParity(which) {
        const dirs = this.slotDirs(which === 'right' ? this._mirrorSlots : this._viewSlots);
        return dirs && typeof parityFromDirs === 'function' ? parityFromDirs(dirs) : null;
    }

    // くさび図のクリック: その置換基が上に来るように並べ替える（パリティを保つ偶置換のみ）
    handleWedgeClick(e) {
        if (!this._viewSlots) return; // 立体未指定・環中心では並べ替えない
        const el = e.target && e.target.closest ? e.target.closest('[data-slot]') : null;
        if (!el) return;
        const slot = el.getAttribute('data-slot');
        if (!slot || !WEDGE_SLOT_LAYOUT[slot]) return;
        const paneEl = el.closest('[data-pane]');
        const pane = paneEl ? paneEl.getAttribute('data-pane') : 'left';
        if (slot === 'up') {
            // 上はすでに上にあるので、代わりに**上を固定して残りの3つを巡回**させる（P12-8）。
            // これも偶置換なので分子は変わらず、「固定した1つ以外の巡回順は変わらない」＝
            // R/S の考え方（最下位を奥にして残り3つの回る向きを読む）の土台になる
            // 「並びを揃える」モードでは両ペインを揃えたまま動かす
            this.cycleWedge('cw', this.isWedgeAligned() ? undefined : pane);
            return;
        }
        this.rotateWedge(pane, slot);
    }

    rotateWedge(pane, slot) {
        if (!this._viewSlots || !WEDGE_SLOT_LAYOUT[slot]) return false;
        const target = pane === 'right' ? this._mirrorSlots : this._viewSlots;
        if (!target) return false;
        // 「並びを揃える」モードでは、同じ**位置の**並べ替え（rotateSlotsTo は key だけで決まる
        // 位置の置換）を両ペインに掛ける。一致しているスロットの組はそのまま保たれるので、
        // 揃えた関係（＝食い違いが2か所だけ）を崩さずに回せる
        const both = this.isWedgeAligned();
        const beforeLeft = Object.assign({}, this._viewSlots);
        const beforeRight = this._mirrorSlots ? Object.assign({}, this._mirrorSlots) : null;
        if (both || pane !== 'right') this._viewSlots = StereoView.rotateSlotsTo(this._viewSlots, slot);
        if ((both || pane === 'right') && this._mirrorSlots) {
            this._mirrorSlots = StereoView.rotateSlotsTo(this._mirrorSlots, slot);
        }
        this._wedgeMoved = true;
        this._lastCycleDir = null; // 「上へ持ってくる」操作は巡回ではないので方向表示は消す
        // どの枝がどこへ動いたかをアニメーションで見せる（両ペインを1回のループで同時に動かす）
        const plans = [];
        if (both || pane !== 'right') plans.push({ pane: 'left', from: beforeLeft, to: this._viewSlots });
        if ((both || pane === 'right') && beforeRight && this._mirrorSlots) {
            plans.push({ pane: 'right', from: beforeRight, to: this._mirrorSlots });
        }
        this.animateWedgeMove(plans);
        return true;
    }

    /**
     * 上の枝を固定して残りの3つを巡回させる（P12-8。ユーザー要望）。
     * pane を省略すると両方のペイン（自分と鏡像）に同じ向きの巡回を適用する。
     * cw / ccw どちらも偶置換なので分子は変わらない（3回で元に戻る）。
     */
    cycleWedge(dir, pane) {
        if (!this._viewSlots) return false;
        if (this.isWedgeAligned()) pane = undefined; // 揃えたまま動かす（両ペインに同じ巡回）
        const beforeLeft = Object.assign({}, this._viewSlots);
        const beforeRight = this._mirrorSlots ? Object.assign({}, this._mirrorSlots) : null;
        if (!pane || pane === 'left') this._viewSlots = StereoView.cycleOthers(this._viewSlots, dir);
        if ((!pane || pane === 'right') && this._mirrorSlots) {
            this._mirrorSlots = StereoView.cycleOthers(this._mirrorSlots, dir);
        }
        this._wedgeMoved = true;
        this._wedgeCycled = true;
        this._lastCycleDir = dir; // 回転方向の明示（弧矢印）に使う
        // 移動をアニメーションで見せる（どれがどこへ動いたかを追えるように）
        const cyclePlans = [];
        if (!pane || pane === 'left') cyclePlans.push({ pane: 'left', from: beforeLeft, to: this._viewSlots });
        if ((!pane || pane === 'right') && beforeRight && this._mirrorSlots) {
            cyclePlans.push({ pane: 'right', from: beforeRight, to: this._mirrorSlots });
        }
        this.animateWedgeMove(cyclePlans);
        return true;
    }

    // 「⟲ 元の並びに戻す」: 描いたときの並び（fischerSlots の結果）に戻す
    resetWedge() {
        if (!this._slots) return;
        this._viewSlots = Object.assign({}, this._slots);
        this._mirrorSlots = this.wedgeMirrorLayout === 'align'
            ? this.alignedMirrorFor(this._viewSlots)
            : StereoView.mirrorSlots(this._slots);
        this._wedgeMoved = false;
        this._wedgeCycled = false;
        this._lastCycleDir = null;
        this.renderWedgeAll();
    }

    setWedgeMirror(on) {
        if (!this._viewSlots) { this.wedgeMirror = false; this.renderWedgeAll(); return; }
        this.wedgeMirror = !!on;
        if (this.wedgeMirror) {
            if (this.wedgeMirrorLayout === 'align') {
                this._mirrorSlots = this.alignedMirrorFor(this._viewSlots);
            } else if (!this._mirrorSlots) {
                this._mirrorSlots = StereoView.mirrorSlots(this._viewSlots);
            }
        }
        this.renderWedgeAll();
    }

    // くさび図全体を描く（鏡像モードなら「あなたの分子」と「🪞 鏡像」を左右に並べる）
    /**
     * 並べ替えアニメの補間（純関数。P12-8）。スロット a から b へ動く途中 e∈[0,1] の、
     * **最終位置 b からのずれ**を返す（要素は b に描かれているので、それをずらして途中を表す）。
     * 直線だと中心を横切って見分けづらいため、進行方向に垂直へ膨らませて弧にする。
     * e=0 で a の位置、e=1 でずれ0（＝b の位置）。rAF に依存せず検証できるよう切り出してある。
     */
    static wedgeTweenOffset(a, b, e, fromSlot, toSlot) {
        // right/down/left どうしの移動は「上の結合を軸にした円すいの回転」なので、
        // その投影＝楕円弧に沿って動かす（P12-8。直線だと実際の動きから離れて見える）
        const arc = StereoView.wedgeArcPath(fromSlot, toSlot, e);
        if (arc) {
            // 端点は必ずスロット位置に一致させる（楕円は近似なので、ずれを線形に打ち消す）
            const p0 = StereoView.wedgeArcPath(fromSlot, toSlot, 0);
            const p1 = StereoView.wedgeArcPath(fromSlot, toSlot, 1);
            const x = arc.x + (1 - e) * (a.lx - p0.x) + e * (b.lx - p1.x);
            const y = arc.y + (1 - e) * (a.ly - p0.y) + e * (b.ly - p1.y);
            return { dx: x - b.lx, dy: y - b.ly };
        }
        // 上との出入り（クリックで上へ持ってくる操作）は円すいの回転ではないので、
        // 進行方向に垂直へ膨らませた弧で見せる
        const dx = b.lx - a.lx, dy = b.ly - a.ly;
        const len = Math.hypot(dx, dy) || 1;
        const bulge = Math.sin(Math.PI * e) * 20;
        const x = a.lx + dx * e + (-dy / len) * bulge;
        const y = a.ly + dy * e + (dx / len) * bulge;
        return { dx: x - b.lx, dy: y - b.ly };
    }

    /** スロットの楕円上の角度（ラジアン）。right/down/left のみ。上は軸なので対象外 */
    static wedgeArcAngle(slot) {
        const lay = WEDGE_SLOT_LAYOUT[slot];
        if (!lay || slot === 'up') return null;
        return Math.atan2((lay.ly - WEDGE_ARC.cy) / WEDGE_ARC.ry, (lay.lx - WEDGE_ARC.cx) / WEDGE_ARC.rx);
    }

    /**
     * from → to の楕円弧上の点（e∈[0,1]）。3スロットは120°間隔なので、
     * 近いほうの回り（±120°）でつなぐ＝実際の円すい回転と同じ向きになる。
     * 上が絡む移動は null（円すいの回転ではないため）。
     */
    static wedgeArcPath(fromSlot, toSlot, e) {
        const a0 = StereoView.wedgeArcAngle(fromSlot);
        const a1 = StereoView.wedgeArcAngle(toSlot);
        if (a0 === null || a1 === null) return null;
        let d = a1 - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const th = a0 + d * e;
        return {
            x: WEDGE_ARC.cx + WEDGE_ARC.rx * Math.cos(th),
            y: WEDGE_ARC.cy + WEDGE_ARC.ry * Math.sin(th)
        };
    }

    /**
     * 並べ替えを**アニメーションで見せる**（P12-8。ユーザー要望「変化が分かりづらい」）。
     * 各置換基のラベルが「元のスロット → 新しいスロット」へ弧を描いて移動するのを見せてから、
     * 通常の描画に戻す。表示だけの演出で、スロットの中身（＝分子）は呼び出し前に確定している。
     * prefers-reduced-motion の環境ではアニメを省いて即座に描き直す。
     * dir を渡すと回転方向（cw/ccw）の弧矢印も一緒に出す。
     */
    animateWedgeMove(plans) {
        this.renderWedgeAll();
        if (StereoView.prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return;
        // 鏡像と並べているときは**両ペインを同時に**動かす（P12-8。ユーザー要望）。
        // 以前はペインごとに呼んでいたため、内側の renderWedgeAll が DOM を作り直して
        // 先に始めたアニメが宙に浮き、片方しか動かなかった
        const els = [];
        (plans || []).forEach(plan => {
            if (!plan || !plan.from || !plan.to) return;
            const paneEl = this.svg.querySelector(`[data-pane="${plan.pane}"]`);
            if (!paneEl) return;
            const fromOf = {};
            ['up', 'right', 'down', 'left'].forEach(k => { fromOf[String(plan.from[k])] = k; });
            ['up', 'right', 'down', 'left'].forEach(k => {
                const src = fromOf[String(plan.to[k])];
                if (!src || src === k) return;
                const el = paneEl.querySelector(`text[data-slot="${k}"]`);
                if (el) els.push({ el, a: WEDGE_SLOT_LAYOUT[src], b: WEDGE_SLOT_LAYOUT[k], from: src, to: k });
            });
        });
        if (!els.length) return;
        const gen = ++this._wedgeAnimGen;
        const dur = 420;
        const start = performance.now();
        const step = (now) => {
            if (this._wedgeAnimGen !== gen) return; // 次の操作に追い越された
            const t = Math.min(1, (now - start) / dur);
            const e = t * t * (3 - 2 * t); // smoothstep
            els.forEach(({ el, a, b, from, to }) => {
                const o = StereoView.wedgeTweenOffset(a, b, e, from, to);
                el.setAttribute('transform', `translate(${o.dx}, ${o.dy})`);
                el.setAttribute('opacity', String(0.55 + 0.45 * e));
            });
            if (t < 1) requestAnimationFrame(step);
            else els.forEach(({ el }) => { el.removeAttribute('transform'); el.removeAttribute('opacity'); });
        };
        requestAnimationFrame(step);
    }

    /**
     * 現在の回転方向（右回り／左回り）を弧矢印で示す（P12-8。ユーザー要望「回転方向を明示したい」）。
     * 上の枝は固定なので、弧は残り3つが通る右・下・左の側だけを回る形にする。
     */
    drawCycleArrow(paneCx, dir, paneCy = 0) {
        const NS = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('data-cycle-arrow', dir);
        g.setAttribute('pointer-events', 'none');
        // 3つの移動それぞれの軌跡に沿って矢印を出す（P12-8。ユーザー要望「3か所表示」）。
        // 軌跡は移動アニメと同じ楕円弧なので、実際に動く道筋の上に矢印が乗る
        const order = dir === 'cw' ? [['right', 'down'], ['down', 'left'], ['left', 'right']]
                                   : [['down', 'right'], ['left', 'down'], ['right', 'left']];
        order.forEach(([from, to]) => {
            // 弧の中ほど（15%〜75%）だけを描いて、ラベルと重ならないようにする
            const pts = [];
            for (let i = 0; i <= 10; i++) {
                const e = 0.15 + (0.75 - 0.15) * (i / 10);
                const pt = StereoView.wedgeArcPath(from, to, e);
                if (pt) pts.push([paneCx + pt.x, paneCy + pt.y]);
            }
            if (pts.length < 2) return;
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', 'M ' + pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L '));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'var(--neon-purple)');
            path.setAttribute('stroke-width', '2.5');
            path.setAttribute('stroke-dasharray', '6 4');
            path.setAttribute('opacity', '0.9');
            path.setAttribute('data-arc', from + '-' + to);
            g.appendChild(path);
            // 矢尻は弧の終端で、進行方向（接線）を向ける
            const last = pts[pts.length - 1], prev = pts[pts.length - 2];
            const deg = Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180 / Math.PI;
            const head = document.createElementNS(NS, 'path');
            head.setAttribute('d', 'M 0 0 L -10 4.5 L -10 -4.5 Z');
            head.setAttribute('fill', 'var(--neon-purple)');
            head.setAttribute('transform', 'translate(' + last[0].toFixed(1) + ', ' + last[1].toFixed(1) + ') rotate(' + deg.toFixed(1) + ')');
            g.appendChild(head);
        });
        const cap = document.createElementNS(NS, 'text');
        cap.setAttribute('x', paneCx);
        cap.setAttribute('y', paneCy + 126);
        cap.setAttribute('text-anchor', 'middle');
        cap.setAttribute('fill', 'var(--neon-purple)');
        cap.setAttribute('font-size', '11');
        cap.textContent = dir === 'cw' ? '↻ 右回りに移動しました' : '↺ 左回りに移動しました';
        g.appendChild(cap);
        this.svg.appendChild(g);
    }

    renderWedgeAll() {
        const NS = 'http://www.w3.org/2000/svg';
        this.svg.innerHTML = '';
        const two = this.wedgeMirror && !!this._viewSlots && !!this._mirrorSlots;
        // 2ペインのときは viewBox が倍幅になるぶん SVG の実寸も広げる（P12-8。ユーザー指摘:
        // 鏡像と並べると縮小されて読みづらい）。max-width:100% があるので、画面が狭ければ
        // 自動的に収まる範囲まで縮む＝従来より小さくなることはない
        // スマホ縦画面では横並びだと各ペインが小さくなるので**上下に積む**（P12-8。ユーザー指摘）
        const stacked = two && StereoView.isNarrowLayout();
        if (stacked) {
            this.svg.setAttribute('viewBox', '-165 -300 330 600');
            this.svg.setAttribute('width', 330);
            this.svg.setAttribute('height', 600);
        } else {
            this.svg.setAttribute('viewBox', two ? '-306 -142 612 292' : '-165 -150 330 300');
            this.svg.setAttribute('width', two ? 612 : 330);
            this.svg.setAttribute('height', two ? 292 : 300);
        }
        const interactive = !!this._viewSlots;
        const labelsOf = (slots) => ({
            up: this.labelOf(slots.up), right: this.labelOf(slots.right),
            down: this.labelOf(slots.down), left: this.labelOf(slots.left)
        });
        // 「並びを揃える」モードでは、揃えきれずに残った食い違いを枠で示す（P12-8）
        const aligned = two && this.wedgeMirrorLayout === 'align';
        const mismatch = aligned ? this.wedgeMismatchSlots() : [];
        if (two) {
            const ox = stacked ? 0 : -158, ox2 = stacked ? 0 : 158;
            const oy = stacked ? -150 : 0, oy2 = stacked ? 150 : 0;
            this.drawWedgePane(labelsOf(this._viewSlots), ox, 'left', 'あなたの分子', interactive, mismatch, oy);
            this.drawWedgePane(labelsOf(this._mirrorSlots), ox2, 'right', '🪞 鏡像', interactive, mismatch, oy2);
            if (aligned) {
                const cap = document.createElementNS(NS, 'text');
                cap.setAttribute('x', 0);
                cap.setAttribute('y', stacked ? 292 : 142);
                cap.setAttribute('text-anchor', 'middle');
                cap.setAttribute('font-size', '11.5');
                cap.setAttribute('data-align-caption', mismatch.length ? 'mismatch' : 'match');
                cap.setAttribute('fill', mismatch.length ? 'var(--neon-orange)' : 'var(--neon-green)');
                cap.textContent = mismatch.length
                    ? `⚠ 枠の${mismatch.length}か所だけが違います＝重ね合わせられません`
                    : '✔ すべて一致しました＝回転だけで重ね合わせられます';
                this.svg.appendChild(cap);
            }
            const sep = document.createElementNS(NS, 'line');
            // 積んだときは横線で仕切る
            sep.setAttribute('x1', stacked ? -150 : 0); sep.setAttribute('y1', stacked ? 0 : -128);
            sep.setAttribute('x2', stacked ? 150 : 0); sep.setAttribute('y2', stacked ? 0 : 128);
            sep.setAttribute('stroke', 'rgba(0,242,254,0.35)');
            sep.setAttribute('stroke-width', 1.5);
            sep.setAttribute('stroke-dasharray', '5 5');
            this.svg.appendChild(sep);
        } else {
            this.drawWedgePane(this._viewSlots ? labelsOf(this._viewSlots) : this._fallbackLabels,
                0, 'left', null, interactive, []);
        }
        // 現在の回転方向を明示する（P12-8。ユーザー要望）。直近に巡回した向きを弧矢印で示す
        if (this._lastCycleDir && this._viewSlots) {
            this.drawCycleArrow(two && !stacked ? -158 : 0, this._lastCycleDir, stacked ? -150 : 0);
            if (two) this.drawCycleArrow(stacked ? 0 : 158, this._lastCycleDir, stacked ? 150 : 0);
        }
        this.updateWedgeButtons();
        this.updateWedgeNote();
    }

    // 1枚分のくさび図。中心C から4方向へ結合を描く。
    // 縦（上・下）＝紙面の奥 → 破線くさび（ハッシュ）／横（左・右）＝紙面の手前 → 塗りくさび（▶）。
    // labels は { up, right, down, left } の表示ラベル。
    // 検証しやすいよう、ペインに data-pane、各結合・ラベル・当たり判定に data-slot / data-bond を付ける。
    drawWedgePane(labels, ox, pane, title, interactive, mismatch, oy = 0) {
        const NS = 'http://www.w3.org/2000/svg';
        const root = document.createElementNS(NS, 'g');
        root.setAttribute('data-pane', pane);
        // oy はスマホ縦画面で2ペインを上下に積むときに使う（P12-8）
        root.setAttribute('transform', `translate(${ox},${oy})`);
        this.svg.appendChild(root);

        const text = (parent, x, y, str, slot, size = 15, color = '#f5f6fa') => {
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', x); t.setAttribute('y', y);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'svg-atom-text');
            t.setAttribute('fill', color);
            t.setAttribute('data-slot', slot);
            t.style.fontSize = size + 'px';
            t.textContent = str;
            parent.appendChild(t);
        };
        // 塗りくさび（手前）: 中心側が細く、置換基側が広い三角形
        const wedge = (parent, slot, sx) => {
            const p = document.createElementNS(NS, 'polygon');
            p.setAttribute('points', `${16 * sx},0 ${66 * sx},-9 ${66 * sx},9`);
            p.setAttribute('fill', 'rgba(255,255,255,0.85)');
            p.setAttribute('data-slot', slot);
            p.setAttribute('data-bond', 'wedge');
            parent.appendChild(p);
        };
        // 破線くさび＝ハッシュ（奥）: 中心に近いほど短い刻み線を並べる
        const hash = (parent, slot, sy) => {
            const g = document.createElementNS(NS, 'g');
            g.setAttribute('data-slot', slot);
            g.setAttribute('data-bond', 'hash');
            for (let i = 0; i < 6; i++) {
                const y = (20 + i * 9) * sy;
                const h = 3.5 + i * 1.4;
                const l = document.createElementNS(NS, 'line');
                l.setAttribute('x1', -h); l.setAttribute('y1', y);
                l.setAttribute('x2', h); l.setAttribute('y2', y);
                l.setAttribute('stroke', 'rgba(255,255,255,0.75)');
                l.setAttribute('stroke-width', 2.2);
                l.setAttribute('stroke-linecap', 'round');
                g.appendChild(l);
            }
            parent.appendChild(g);
        };

        ['up', 'down', 'right', 'left'].forEach(slot => {
            const lay = WEDGE_SLOT_LAYOUT[slot];
            const g = document.createElementNS(NS, 'g');
            g.setAttribute('class', 'wedge-slot' + (interactive ? ' clickable' : ''));
            g.setAttribute('data-slot-group', slot);
            root.appendChild(g);
            if (slot === 'up') hash(g, 'up', -1);
            else if (slot === 'down') hash(g, 'down', 1);
            else wedge(g, slot, slot === 'right' ? 1 : -1);
            text(g, lay.lx, lay.ly, labels[slot], slot);
            // 透明の当たり判定（細い結合・短いラベルでも掴めるように）
            const r = document.createElementNS(NS, 'rect');
            r.setAttribute('x', lay.hit[0]); r.setAttribute('y', lay.hit[1]);
            r.setAttribute('width', lay.hit[2]); r.setAttribute('height', lay.hit[3]);
            r.setAttribute('fill', 'transparent');
            r.setAttribute('data-slot', slot);
            r.setAttribute('data-hit', '1');
            g.appendChild(r);
        });

        text(root, 0, 5, 'C', 'center', 17, 'var(--color-c)');
        if (title) text(root, 0, -120, title, 'title', 13, 'var(--text-secondary)');

        // 「並びを揃える」モードで揃えきれなかったスロットを枠で囲む（P12-8）。
        // 左右どちらのペインにも同じ位置に出して、見比べる場所をはっきりさせる
        (mismatch || []).forEach(slot => {
            const lay = WEDGE_SLOT_LAYOUT[slot];
            if (!lay) return;
            const box = document.createElementNS(NS, 'rect');
            box.setAttribute('x', lay.hit[0] + 4); box.setAttribute('y', lay.hit[1] + 4);
            box.setAttribute('width', lay.hit[2] - 8); box.setAttribute('height', lay.hit[3] - 8);
            box.setAttribute('rx', 9);
            box.setAttribute('fill', 'none');
            box.setAttribute('stroke', 'var(--neon-orange)');
            box.setAttribute('stroke-width', 2);
            box.setAttribute('stroke-dasharray', '7 5');
            box.setAttribute('pointer-events', 'none');
            box.setAttribute('data-mismatch', slot);
            root.appendChild(box);
        });
    }

    updateWedgeButtons() {
        const usable = !!this._viewSlots;
        if (this.wedgeMirrorBtn) {
            this.wedgeMirrorBtn.textContent = this.wedgeMirror ? '🪞 鏡像を消す' : '🪞 鏡像と並べる';
            this.wedgeMirrorBtn.disabled = !usable;
        }
        if (this.wedgeResetBtn) this.wedgeResetBtn.disabled = !usable;
        // 巡回も並べ替えと同じく、立体が読めた中心でのみ使える
        if (this.wedgeCwBtn) this.wedgeCwBtn.disabled = !usable;
        if (this.wedgeCcwBtn) this.wedgeCcwBtn.disabled = !usable;
        // 鏡像の並べ方（鏡面対称／並びを揃える）は鏡像と並べているときだけ意味がある（P12-8）
        if (this.wedgeLayoutRow) {
            this.wedgeLayoutRow.classList.toggle('hidden', !(usable && this.wedgeMirror));
        }
        if (this.wedgeLayoutBtnSym) {
            this.wedgeLayoutBtnSym.classList.toggle('active', this.wedgeMirrorLayout !== 'align');
        }
        if (this.wedgeLayoutBtnAlign) {
            this.wedgeLayoutBtnAlign.classList.toggle('active', this.wedgeMirrorLayout === 'align');
        }
    }

    updateWedgeNote() {
        if (!this.wedgeNoteEl) return;
        const parts = [];
        if (!this._viewSlots) {
            parts.push('この描き方では立体が指定されていないため、並べ替え・鏡像比較はできません（上の並びは一例です）。' +
                       '置換基をフィッシャー投影の軸方向（縦・横）に描くと使えるようになります。');
        } else {
            parts.push('置換基（文字・結合）をクリックすると、その置換基が上に来るように並べ替えます。' +
                       '上の枝をクリック（または「↻ 残り3つを回す」）すると、上を固定したまま残りの3つが入れ替わります。');
            if (this._wedgeCycled) {
                parts.push('上の1つを固定して残り3つを回しても分子は変わりません（3つの巡回＝入れ替え2回分）。' +
                           '3回続けると元の並びに戻ります。右回り・左回りのどちらも同じ分子のままです。' +
                           'この「固定した1つ以外の回る向きは変わらない」という性質が、R/S（最も優先順位の低い基を' +
                           '奥に置いて、残り3つの回る向きを読む）の考え方の土台になります。');
            }
            if (this._wedgeMoved) {
                parts.push('この操作では分子は変わりません（フィッシャー投影で許される動かし方です）。' +
                           '180°回転や「1つを固定した3つの巡回」は入れ替え2回分にあたるので、鏡像にはなりません。');
            }
            if (this.wedgeMirror) {
                parts.push('左右を入れ替えると鏡像異性体になります（くさび図では1回の入れ替えで鏡像）。上下の入れ替えだけでも鏡像です。');
                parts.push(this._isAsym
                    ? '左右の図は鏡像の関係です。許される並べ替えをどう重ねても重ね合わせられません（＝鏡像異性体）。'
                    : 'この炭素は不斉ではないので、並べ替えても同じ分子です。');
                // P12-8: 鏡像ペインの並べ方（鏡面対称／並びを揃える）の解説
                if (this.wedgeMirrorLayout === 'align') {
                    const miss = this.wedgeMismatchSlots();
                    const total = StereoView.evenArrangements(StereoView.mirrorSlots(this._viewSlots)).length;
                    parts.push(`「並びを揃える」: 許される並べ替え（偶置換）${total}通りをすべて試して、` +
                               'いちばんオリジナルに近づく並びにしてあります。');
                    parts.push(miss.length
                        ? `それでもオレンジの枠の${miss.length}か所（${miss.map(k => WEDGE_SLOT_JA[k]).join('と')}）だけは` +
                          '入れ替わったまま残ります。この食い違いは1回の入れ替え（奇置換）ぶんで、' +
                          '偶置換をどう重ねても消せません＝回転では重ね合わせられない、が目で見えます。'
                        : 'この炭素では食い違いが残らず、すべて一致しました＝鏡像と回転だけで重ね合わせられます（不斉ではありません）。');
                    parts.push('このモードでは、どちらの図を動かしても両方が同じように動きます（揃えた関係を保ったまま回せます）。');
                } else {
                    parts.push('「鏡面対称」: 鏡に映したままの配置です（左右が入れ替わって見えます）。' +
                               '「並びを揃える」に切り替えると、許される並べ替えだけでオリジナルにできるだけ近づけ、' +
                               'それでも残る食い違いを枠で示します。');
                }
            }
        }
        this.wedgeNoteEl.textContent = parts.join('\n');
    }

    // 中心の隣接どうしが中心を経由せずに繋がっていれば環内の原子（案内文言の出し分け用）
    static isRingAtom(mol, atomId) {
        const nbrs = mol.getNeighbors(atomId).map(n => n.atom.id);
        for (let i = 0; i < nbrs.length; i++) {
            for (let j = i + 1; j < nbrs.length; j++) {
                const seen = new Set([atomId]);
                const stack = [nbrs[i]];
                while (stack.length) {
                    const cur = stack.pop();
                    if (cur === nbrs[j]) return true;
                    if (seen.has(cur)) continue;
                    seen.add(cur);
                    mol.getNeighbors(cur).forEach(n => { if (!seen.has(n.atom.id)) stack.push(n.atom.id); });
                }
            }
        }
        return false;
    }

    // ===== 疑似3D回転ビューア（P12-7 M3） =====

    setMode(mode) {
        this.mode = mode;
        const on3d = mode === '3d';
        this.paneWedge.classList.toggle('hidden', on3d);
        this.pane3d.classList.toggle('hidden', !on3d);
        this.tabWedge.classList.toggle('active', !on3d);
        this.tab3d.classList.toggle('active', on3d);
        if (this.titleEl) {
            this.titleEl.textContent = on3d ? '🧊 実際の立体構造（3Dで回す）' : '🧊 実際の立体構造（くさび形表記）';
        }
        if (on3d) {
            this.render3D();
            this.startSpin();
        } else {
            this.stopSpin();
        }
    }

    setMirror(on) {
        this.mirror = !!on;
        this.updateMirrorButton();
        this.render3D();
    }

    /**
     * 3Dビューの鏡像ペインの構え方を切り替える（P12-8。'symmetric' | 'align'）。
     * どちらのモードでも「鏡像であること」（parityFromDirs が左右で逆）は変えない。
     * align は鏡像側に**回転（行列式 +1）だけ**を追加で掛けるので、手性は不変。
     */
    setMirrorLayout(mode) {
        this.mirrorLayout = mode === 'align' ? 'align' : 'symmetric';
        this.updateMirrorButton();
        this.render3D();
    }

    // 鏡像側の軸をオリジナルの軸に重ねる回転行列（align モードかつ結合を軸に選んでいるときだけ）。
    // 鏡像の基準ベクトルは x 反転なので、軸も x 反転した axM をオリジナルの ax へ合わせる
    mirrorAlignMatrix() {
        if (this.mirrorLayout !== 'align') return null;
        const ax = this.axisVector();
        if (!ax) return null; // 画面基準では「揃えるべき軸」がない
        return StereoView.alignRotation([-ax[0], ax[1], ax[2]], ax);
    }

    updateMirrorButton() {
        if (this.mirrorBtn) this.mirrorBtn.textContent = this.mirror ? '🪞 鏡像を消す' : '🪞 鏡像と並べる';
        // 配置モードの切り替えは鏡像と並べているときだけ出す。
        // 「軸を揃える」は回転軸に結合を選んでいるときにだけ意味があるので、それ以外では無効化
        if (this.mirrorLayoutRow) this.mirrorLayoutRow.classList.toggle('hidden', !this.mirror);
        const onAxis = this.axisIndex !== null;
        if (this.mirrorLayoutBtnSym) {
            this.mirrorLayoutBtnSym.classList.toggle('active', this.mirrorLayout !== 'align');
        }
        if (this.mirrorLayoutBtnAlign) {
            this.mirrorLayoutBtnAlign.classList.toggle('active', this.mirrorLayout === 'align' && onAxis);
            this.mirrorLayoutBtnAlign.disabled = !onAxis;
            this.mirrorLayoutBtnAlign.style.opacity = onAxis ? '' : '0.45';
        }
    }

    setAutoRotate(on) {
        this.autoRotate = !!on;
        this.updateSpinButton();
        if (this.autoRotate) this.startSpin(); else this.stopSpin();
    }

    updateSpinButton() {
        if (this.spinBtn) this.spinBtn.textContent = this.autoRotate ? '⏸ 自動回転を止める' : '▶ 自動回転';
    }

    // ===== 回転軸の切り替え（P12-8） =====

    // 回転軸に選んだ結合の方向ベクトル（画面基準なら null）
    axisVector() {
        if (this.axisIndex === null || !this._dirs || !this._dirs[this.axisIndex]) return null;
        return this._dirs[this.axisIndex].v;
    }

    // index: _dirs の添字（その置換基への結合が軸）、null なら画面基準に戻す
    setAxis(index) {
        this.axisIndex = (index === null || index === undefined) ? null : index;
        // 「軸を揃える」は結合を軸に選んでいるときだけ意味を持つので、画面基準に戻したら鏡面対称へ戻す
        if (this.axisIndex === null) this.mirrorLayout = 'symmetric';
        this.axisAngle = 0;
        this.faceAxis();
        this.updateAxisButtons();
        this.updateMirrorButton(); // 「軸を揃える」の使える／使えないが軸の有無で変わる
        this.render3D();
        this.startSpin();
    }

    buildAxisButtons() {
        const row = this.axisRow;
        if (!row) return;
        row.innerHTML = '';
        const cap = document.createElement('span');
        cap.textContent = '回転軸:';
        row.appendChild(cap);
        const mk = (label, index, id) => {
            const b = document.createElement('button');
            b.className = 'view-btn stereo-axis-btn';
            b.style.cssText = 'margin:0; font-size:11px; padding:4px 9px;';
            b.textContent = label;
            b.id = id;
            b.dataset.axisIndex = (index === null ? '' : String(index));
            b.addEventListener('click', () => this.setAxis(index));
            row.appendChild(b);
        };
        mk('画面', null, 'btn-stereo-axis-screen');
        (this._dirs || []).forEach((d, i) => mk(this.labelOf(d.ref), i, 'btn-stereo-axis-' + i));

        // 軸を画面上のどの向きに構えるか（P12-8。ユーザー要望）。
        // 「奥」はニューマン投影に近い見え方で、残り3つの回る向きが読める
        const wrap = document.createElement('span');
        wrap.id = 'stereo-facing-row';
        wrap.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-left:10px;';
        const cap2 = document.createElement('span');
        cap2.textContent = '軸の向き:';
        wrap.appendChild(cap2);
        const FACINGS = [
            ['自動', 'auto', '軸を画面と平行に構えて少し見下ろします'],
            ['奥', 'away', '軸を視線の方向（奥）に向けます。ニューマン投影に近い見え方で、残り3つの回る向きが読めます'],
            ['上', 'up', '軸を画面の上に向けます'],
            ['右', 'right', '軸を画面の右に向けます'],
            ['左', 'left', '軸を画面の左に向けます']
        ];
        FACINGS.forEach(([label, key, title]) => {
            const b = document.createElement('button');
            b.className = 'view-btn stereo-facing-btn';
            b.style.cssText = 'margin:0; font-size:11px; padding:4px 9px;';
            b.textContent = label;
            b.id = 'btn-stereo-facing-' + key;
            b.dataset.facing = key;
            b.title = title;
            b.addEventListener('click', () => this.setAxisFacing(key));
            wrap.appendChild(b);
        });
        row.appendChild(wrap);
        this.updateAxisButtons();
    }

    updateAxisButtons() {
        if (!this.axisRow) return;
        const cur = this.axisIndex === null ? '' : String(this.axisIndex);
        this.axisRow.querySelectorAll('.stereo-axis-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.axisIndex === cur);
        });
        // 軸の向きは「結合を軸に選んでいるとき」だけ意味があるので、画面基準では無効化する
        const onAxis = this.axisIndex !== null;
        this.axisRow.querySelectorAll('.stereo-facing-btn').forEach(b => {
            b.classList.toggle('active', onAxis && b.dataset.facing === this.axisFacing);
            b.disabled = !onAxis;
            b.style.opacity = onAxis ? '' : '0.45';
        });
    }

    // ロドリゲスの回転公式（単位ベクトル k のまわりに角 th だけ v を回す）。k が null なら素通し
    static spinAround(v, k, th) {
        if (!k) return v;
        const L = Math.hypot(k[0], k[1], k[2]);
        if (L < 1e-9) return v;
        const u = [k[0] / L, k[1] / L, k[2] / L];
        const c = Math.cos(th), s = Math.sin(th);
        const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        return [
            v[0] * c + cr[0] * s + u[0] * dot * (1 - c),
            v[1] * c + cr[1] * s + u[1] * dot * (1 - c),
            v[2] * c + cr[2] * s + u[2] * dot * (1 - c)
        ];
    }

    // 軸を横から見る向きに構え直す（軸を選んでいなければ正面に戻す）
    faceAxis() {
        const a = this.axisVector();
        this._alignM = null;
        if (!a) {
            this.angleX = 0;
            this.angleY = 0;
            return;
        }
        // 軸の向きを指定しているときは、その向きへ合わせ込む（P12-8。ユーザー要望）。
        // 'away'（奥）はニューマン投影に近い見え方で、残り3つの回る向きが読める＝R/S の考え方に直結
        const target = STEREO3D_AXIS_FACING[this.axisFacing];
        if (target) {
            this._alignM = StereoView.alignRotation(a, target);
            this.angleX = 0;
            this.angleY = 0;
            this.pickAxisPhase(a);
            return;
        }
        // 'auto': まず軸を画面に平行（z=0）にし、そのうえで少し見下ろす。
        // 傾けないと軸以外の2つが同じ位置に投影されて重なってしまう
        this.angleY = Math.atan2(a[2], a[0]);
        this.angleX = STEREO3D_AXIS_TILT;
        this.pickAxisPhase(a);
    }

    // 軸以外の3つが中心の円に隠れない位相から始める（真正面／真後ろを向くと見えなくなる）
    pickAxisPhase(a) {
        if (!this._dirs) return;
        let best = 0, bestScore = -Infinity;
        for (let i = 0; i < 24; i++) {
            const th = i * Math.PI / 12;
            let score = Infinity;
            this._dirs.forEach((d, j) => {
                if (j === this.axisIndex) return;
                const v = this.rotate(StereoView.spinAround(d.v, a, th));
                score = Math.min(score, Math.hypot(v[0], v[1]));
            });
            if (score > bestScore) { bestScore = score; best = th; }
        }
        this.axisAngle = best;
    }

    /** 回転軸を画面上のどの向きに構えるかを切り替える（P12-8。'auto'|'up'|'away'|'right'|'left'） */
    setAxisFacing(facing) {
        this.axisFacing = STEREO3D_AXIS_FACING[facing] || facing === 'auto' ? facing : 'auto';
        this.faceAxis();
        this.updateAxisButtons();
        this.render3D();
    }

    resetAngles() {
        this.axisAngle = 0;
        this.faceAxis();
        this.render3D();
    }

    startSpin() {
        if (this._raf !== null || !this.autoRotate || this.mode !== '3d') return;
        let last = null;
        const step = (t) => {
            if (last === null) last = t;
            const dt = Math.min(50, t - last);
            last = t;
            // 軸を選んでいればその結合まわり、そうでなければ画面のY軸まわりに回す（約40°/秒）
            if (this.axisVector()) this.axisAngle += dt * 0.0007;
            else this.angleY += dt * 0.0007;
            this.render3D();
            this._raf = requestAnimationFrame(step);
        };
        this._raf = requestAnimationFrame(step);
    }

    stopSpin() {
        if (this._raf !== null) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
    }

    // ドラッグ（マウス・タッチ共通）で回す。慣性なし
    bindDrag() {
        const svg = this.svg3d;
        if (!svg) return;
        svg.addEventListener('pointerdown', (e) => {
            this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
            this.stopSpin(); // 掴んでいる間は自動回転を止める
            svg.style.cursor = 'grabbing';
            try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 非対応環境では無視 */ }
            e.preventDefault();
        });
        svg.addEventListener('pointermove', (e) => {
            if (!this._drag || this._drag.id !== e.pointerId) return;
            const dx = e.clientX - this._drag.x;
            const dy = e.clientY - this._drag.y;
            this._drag.x = e.clientX;
            this._drag.y = e.clientY;
            this.rotateBy(dx * 0.01, dy * 0.01);
            e.preventDefault();
        });
        const end = () => {
            if (!this._drag) return;
            this._drag = null;
            svg.style.cursor = 'grab';
            this.startSpin(); // 離したら自動回転を再開（OFFなら何もしない）
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
    }

    rotateBy(dYaw, dPitch) {
        if (this.axisVector()) {
            this.axisAngle += dYaw; // 軸を選んでいるときは横方向のドラッグ＝その結合まわりの回転
        } else {
            this.angleY += dYaw;
            this.angleX -= dPitch; // 下へドラッグ＝手前の置換基が下がる
        }
        this.render3D();
    }

    // Y軸→X軸の順に回す（回転なので行列式は +1 のまま＝パリティ不変）
    /**
     * ロドリゲスの回転行列（軸 k・角 th）。軸の向きを画面上の指定方向へ合わせるのに使う（P12-8）
     */
    static rodriguesMatrix(k, th) {
        const c = Math.cos(th), s = Math.sin(th), C = 1 - c;
        const [x, y, z] = k;
        return [
            [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
            [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
            [z * x * C - y * s, z * y * C + x * s, c + z * z * C]
        ];
    }

    /**
     * ベクトル a を画面上の向き t に重ねる回転行列を返す（P12-8。回転軸の向きの調整）。
     * オイラー角（Y→X）だけでは任意の向きに合わせられない（右・左に向けられない）ため、
     * 軸の向きを指定したときは行列で合わせる。
     */
    static alignRotation(a, t) {
        const dot = a[0] * t[0] + a[1] * t[1] + a[2] * t[2];
        const cr = [a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]];
        const s = Math.hypot(cr[0], cr[1], cr[2]);
        if (s < 1e-9) {
            if (dot > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // すでに同じ向き
            // 正反対: 適当な垂直軸まわりに180°回す
            const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
            const c2 = [a[1] * p[2] - a[2] * p[1], a[2] * p[0] - a[0] * p[2], a[0] * p[1] - a[1] * p[0]];
            const n = Math.hypot(c2[0], c2[1], c2[2]) || 1;
            return StereoView.rodriguesMatrix([c2[0] / n, c2[1] / n, c2[2] / n], Math.PI);
        }
        return StereoView.rodriguesMatrix([cr[0] / s, cr[1] / s, cr[2] / s], Math.atan2(s, dot));
    }

    /** 3x3 行列をベクトルに掛ける（P12-8。鏡像側の軸合わせで使う） */
    static applyMatrix(m, v) {
        return [
            m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
        ];
    }

    rotate(v) {
        // 軸の向きを指定しているときは合わせ込みの行列を使う（オイラー角では表せない向きがあるため）
        if (this._alignM) {
            const m = this._alignM;
            return [
                m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
                m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
                m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
            ];
        }
        const cx = Math.cos(this.angleX), sx = Math.sin(this.angleX);
        const cy = Math.cos(this.angleY), sy = Math.sin(this.angleY);
        const x1 = v[0] * cy + v[2] * sy;
        const y1 = v[1];
        const z1 = -v[0] * sy + v[2] * cy;
        return [x1, y1 * cx - z1 * sx, y1 * sx + z1 * cx];
    }

    render3D() {
        const svg = this.svg3d;
        if (!svg) return;
        svg.innerHTML = '';
        if (!this._dirs) { this._drawn = null; return; }
        // 選んだ結合まわりに回してから画面の回転をかける（どちらも回転なのでパリティは不変）
        const ax = this.axisVector();
        const turn = (v) => this.rotate(StereoView.spinAround(v, ax, this.axisAngle));
        const left = this._dirs.map((d, i) => ({ ref: d.ref, code: d.code, idx: i, v: turn(d.v) }));
        // 鏡像ペインの作り方は2モード（P12-8）。どちらでも parityFromDirs は左右で逆＝鏡像のまま。
        //  'symmetric'（既定）… **画面空間で**鏡映する。左ペインの最終ベクトル（視点変換まで済んだもの）
        //     の x を反転するだけなので、どんな回転・軸・向きでも常に厳密な鏡像になり、
        //     左右が完全に同期して動く。
        //     （分子空間で鏡映してから同じ視点変換をかける方法は、鏡映 M と回転 R が可換でない
        //       ＝ M·R(a,θ) = R(Ma,−θ)·M ため、画面上の鏡像にならず左右の動きがずれる。v191 の不具合）
        //  'align'（軸を揃える）… 分子空間で鏡映して**別の分子**にしたうえで、鏡像側の軸を
        //     オリジナルの軸へ重ねる回転を先に掛け、そのあとオリジナルと同じ軸・同じ角・同じ視点変換を
        //     掛ける。軸が画面上の同じ位置・向きに来るので「軸を揃えても残り3つは重ならない」＝
        //     非重ね合わせが直接見える（左右は鏡像の見た目にはならない。それが狙い）
        let right = null;
        if (this.mirror) {
            const alignM = this.mirrorAlignMatrix();
            if (alignM) {
                right = this._dirs.map((d, i) => ({
                    ref: d.ref, code: d.code, idx: i,
                    v: this.rotate(StereoView.spinAround(
                        StereoView.applyMatrix(alignM, [-d.v[0], d.v[1], d.v[2]]), ax, this.axisAngle))
                }));
            } else {
                right = left.map(d => ({
                    ref: d.ref, code: d.code, idx: d.idx, v: [-d.v[0], d.v[1], d.v[2]]
                }));
            }
        }
        this._drawn = { left, right };

        // 鏡像と並べるときは SVG の実寸も広げる（縮小されて読みづらくならないように。P12-8）
        const stacked3d = this.mirror && StereoView.isNarrowLayout();
        if (stacked3d) {
            // 縦画面では鏡像を下に積む（横並びだと小さくなりすぎるため。P12-8）
            svg.setAttribute('viewBox', '-120 -228 240 456');
            svg.setAttribute('width', 240);
            svg.setAttribute('height', 456);
        } else {
            svg.setAttribute('viewBox', this.mirror ? '-240 -114 480 228' : '-120 -114 240 228');
            svg.setAttribute('width', this.mirror ? 480 : 330);
            svg.setAttribute('height', this.mirror ? 228 : 240);
        }
        if (right) {
            this.drawPane(left, stacked3d ? 0 : -120, 'あなたの分子', stacked3d ? -114 : 0);
            this.drawPane(right, stacked3d ? 0 : 120, '🪞 鏡像', stacked3d ? 114 : 0);
            const NS = 'http://www.w3.org/2000/svg';
            const sep = document.createElementNS(NS, 'line');
            sep.setAttribute('x1', stacked3d ? -104 : 0); sep.setAttribute('y1', stacked3d ? 0 : -104);
            sep.setAttribute('x2', stacked3d ? 104 : 0); sep.setAttribute('y2', stacked3d ? 0 : 104);
            sep.setAttribute('stroke', 'rgba(0,242,254,0.35)');
            sep.setAttribute('stroke-width', 1.5);
            sep.setAttribute('stroke-dasharray', '5 5');
            svg.appendChild(sep);
        } else {
            this.drawPane(left, 0, null);
        }
        this.updateNote();
    }

    // 1枚分の疑似3D図。奥から順に描く（画家のアルゴリズム）＋奥ほど小さく・暗く
    drawPane(dirs, ox, title, oy = 0) {
        const items = dirs.map(d => {
            const k = STEREO3D_PERSP / (STEREO3D_PERSP - d.v[2] * STEREO3D_BOND); // 手前(z+)ほど大きい
            return {
                ref: d.ref, z: d.v[2], k, axis: d.idx === this.axisIndex,
                x: ox + d.v[0] * STEREO3D_BOND * k,
                y: oy + d.v[1] * STEREO3D_BOND * k
            };
        });
        items.push({ center: true, z: 0, k: 1, x: ox, y: 0 });
        items.sort((a, b) => a.z - b.z);
        items.forEach(it => {
            const g = this.svgGroup(0.45 + 0.55 * (it.z + 1) / 2); // 奥ほど暗い
            if (it.center) {
                this.circle(g, it.x, it.y, STEREO3D_HUB, 'var(--color-c)', 3);
                this.text(g, it.x, it.y + 6, 'C', 17, 'var(--color-c)');
                return;
            }
            const label = this.labelOf(it.ref);
            // 回転軸に選んだ結合は色を変えて強調する（P12-8。--neon-blue が水色の定義済み変数）
            const color = it.axis ? 'var(--neon-blue)' : StereoView.colorOf(label);
            const len = Math.hypot(it.x - ox, it.y);
            const t = len > 1 ? Math.min(0.9, STEREO3D_HUB / len) : 0; // 中心の円のふちから結合線を引く
            this.line(g, ox + (it.x - ox) * t, it.y * t, it.x, it.y, (it.axis ? 4.6 : 2.6) * it.k, color);
            // ラベルが長い置換基（CH₃・CHO₂ など）は横長の楕円にして文字がはみ出さないようにする
            this.ellipse(g, it.x, it.y, (11 + 4.6 * label.length) * it.k, 15 * it.k, color, (it.axis ? 3.4 : 2.2) * it.k);
            this.text(g, it.x, it.y + 4.5 * it.k, label, 12.5 * it.k, color);
        });
        if (title) this.text(this.svg3d, ox, -92, title, 13, 'var(--text-secondary)');
    }

    updateNote() {
        if (!this.noteEl) return;
        const parts = [];
        if (this._parity) {
            parts.push('あなたが描いた立体をそのまま3Dにしています。ドラッグ（スワイプ）で好きな向きに回せます。');
        } else {
            parts.push('この描き方では立体が指定されていません（フィッシャー投影の軸方向に描くか、ハース環の上下に置くと指定できます）。' +
                       '下の図は正四面体の一例で、鏡像のどちらであるかは決めていません。');
        }
        if (this.axisVector()) {
            const name = this.labelOf(this._dirs[this.axisIndex].ref);
            parts.push(`「${name}」への結合を軸に回しています（水色の結合）。軸の上の置換基は動かず、残り3つが円すいをえがきます。` +
                       '結合を軸に回しても同じ分子です（回転では鏡像になりません）。');
        }
        if (this.mirror) {
            parts.push(this._isAsym
                ? '左右は鏡像の関係です。同じように回転させても重ね合わせられません（＝鏡像異性体）。'
                : 'この炭素は不斉ではないので、回すと重なります（左右は同じ分子です）。');
            // P12-8: 鏡像ペインの構え方の解説
            if (this.mirrorLayout === 'align' && this.axisVector()) {
                const name = this.labelOf(this._dirs[this.axisIndex].ref);
                parts.push(`「軸を揃える」: 鏡像側にも回転だけを加えて、「${name}」への軸を左と同じ向きに構えています。` +
                           '軸の上の置換基はぴったり重なりますが、残り3つは回る向きが左右で逆なので、' +
                           'どれだけ回しても重なりません。これが「鏡像異性体は回転では重ね合わせられない」ことの意味です。');
            } else {
                parts.push('「鏡面対称」: 右は左を画面の左右で鏡に映したままの配置です。' +
                           'どちらを回しても左右がぴったり同じように動きます（常に厳密な鏡像）。' +
                           '回転軸に結合を選んで「軸を揃える」にすると、鏡像側の軸を左と同じ向きに構え直して、' +
                           '「軸を揃えても重ならない」ことを確かめられます。');
            }
        }
        this.noteEl.textContent = parts.join('\n');
    }

    // ===== SVG 小道具 =====

    static colorOf(label) {
        const el = /^(Cl|Br)/.test(label) ? label.slice(0, 2) : label.slice(0, 1);
        const map = { C: '--color-c', O: '--color-o', N: '--color-n', H: '--color-h',
                      S: '--color-s', Cl: '--color-cl', Br: '--color-br' };
        return `var(${map[el] || '--color-c'})`;
    }

    svgGroup(opacity) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('opacity', Math.max(0.3, Math.min(1, opacity)).toFixed(3));
        this.svg3d.appendChild(g);
        return g;
    }

    line(parent, x1, y1, x2, y2, w, color) {
        const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('x1', x1.toFixed(2)); l.setAttribute('y1', y1.toFixed(2));
        l.setAttribute('x2', x2.toFixed(2)); l.setAttribute('y2', y2.toFixed(2));
        l.setAttribute('stroke', color);
        l.setAttribute('stroke-width', w.toFixed(2));
        l.setAttribute('stroke-linecap', 'round');
        parent.appendChild(l);
    }

    ellipse(parent, cx, cy, rx, ry, color, w) {
        const e = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        e.setAttribute('cx', cx.toFixed(2)); e.setAttribute('cy', cy.toFixed(2));
        e.setAttribute('rx', rx.toFixed(2)); e.setAttribute('ry', ry.toFixed(2));
        e.setAttribute('fill', 'rgba(15,20,28,0.94)');
        e.setAttribute('stroke', color);
        e.setAttribute('stroke-width', w.toFixed(2));
        parent.appendChild(e);
    }

    circle(parent, cx, cy, r, color, w) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', cx.toFixed(2)); c.setAttribute('cy', cy.toFixed(2));
        c.setAttribute('r', r.toFixed(2));
        c.setAttribute('fill', 'rgba(15,20,28,0.94)');
        c.setAttribute('stroke', color);
        c.setAttribute('stroke-width', w.toFixed(2));
        parent.appendChild(c);
    }

    text(parent, x, y, str, size, color) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x.toFixed(2)); t.setAttribute('y', y.toFixed(2));
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'svg-atom-text');
        t.setAttribute('fill', color);
        t.style.fontSize = size.toFixed(1) + 'px';
        t.textContent = str;
        parent.appendChild(t);
    }
}
