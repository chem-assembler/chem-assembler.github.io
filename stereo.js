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

// フィッシャー投影の各スロットが指す3D方向（縦=紙面の奥・横=紙面の手前。SVG座標系で z+ が手前）。
// この4本は同一平面に乗らないので、スロット割り当てだけで手性（パリティ）が決まる。
// くさび図の並べ替えが「パリティを保つ操作」であることの根拠であり、テストの機械検証にも使う（P12-8）。
const FISCHER_SLOT_DIRS = {
    up: [0, -1, -1], right: [1, 0, 1], down: [0, 1, -1], left: [-1, 0, 1]
};
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
        this._viewSlots = null;      // 今表示しているスロット割り当て（ref。読めない中心は null）
        this._mirrorSlots = null;    // 鏡像ペインのスロット割り当て
        this._fallbackLabels = null; // スロットが読めないときの「一例」配置のラベル
        this._wedgeMoved = false;    // 一度でも並べ替えたか（説明の出し分け）

        this.mode = 'wedge';   // 'wedge' | '3d'
        this.mirror = false;   // 鏡像と並べるモード
        this.angleX = 0;       // X軸まわり（上下の傾き）
        this.angleY = 0;       // Y軸まわり（左右の回転）
        this.axisIndex = null; // 回転軸に選んだ結合（_dirs の添字。null = 画面基準）
        this.axisAngle = 0;    // 選んだ結合まわりの回転角
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
        this.tabWedge.addEventListener('click', () => this.setMode('wedge'));
        this.tab3d.addEventListener('click', () => this.setMode('3d'));
        this.spinBtn.addEventListener('click', () => this.setAutoRotate(!this.autoRotate));
        this.mirrorBtn.addEventListener('click', () => this.setMirror(!this.mirror));
        if (this.wedgeMirrorBtn) this.wedgeMirrorBtn.addEventListener('click', () => this.setWedgeMirror(!this.wedgeMirror));
        if (this.wedgeResetBtn) this.wedgeResetBtn.addEventListener('click', () => this.resetWedge());
        this.svg.addEventListener('click', (e) => this.handleWedgeClick(e));
        document.getElementById('btn-stereo-reset').addEventListener('click', () => this.resetAngles());
        this.svg3d.addEventListener('dblclick', () => this.resetAngles());
        this.bindDrag();
        this.updateSpinButton();
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
        this._wedgeMoved = false;
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

    // 鏡像: 左右スロットの入れ替え（転置1回＝奇置換）→ パリティが反転する＝別の分子（鏡像異性体）
    static mirrorSlots(slots) {
        return { up: slots.up, right: slots.left, down: slots.down, left: slots.right };
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
        if (!slot || !WEDGE_SLOT_LAYOUT[slot] || slot === 'up') return; // 上をクリック＝すでに上
        const paneEl = el.closest('[data-pane]');
        this.rotateWedge(paneEl ? paneEl.getAttribute('data-pane') : 'left', slot);
    }

    rotateWedge(pane, slot) {
        if (!this._viewSlots || !WEDGE_SLOT_LAYOUT[slot]) return false;
        if (pane === 'right') {
            if (!this._mirrorSlots) return false;
            this._mirrorSlots = StereoView.rotateSlotsTo(this._mirrorSlots, slot);
        } else {
            this._viewSlots = StereoView.rotateSlotsTo(this._viewSlots, slot);
        }
        this._wedgeMoved = true;
        this.renderWedgeAll();
        return true;
    }

    // 「⟲ 元の並びに戻す」: 描いたときの並び（fischerSlots の結果）に戻す
    resetWedge() {
        if (!this._slots) return;
        this._viewSlots = Object.assign({}, this._slots);
        this._mirrorSlots = StereoView.mirrorSlots(this._slots);
        this._wedgeMoved = false;
        this.renderWedgeAll();
    }

    setWedgeMirror(on) {
        if (!this._viewSlots) { this.wedgeMirror = false; this.renderWedgeAll(); return; }
        this.wedgeMirror = !!on;
        if (this.wedgeMirror && !this._mirrorSlots) {
            this._mirrorSlots = StereoView.mirrorSlots(this._viewSlots);
        }
        this.renderWedgeAll();
    }

    // くさび図全体を描く（鏡像モードなら「あなたの分子」と「🪞 鏡像」を左右に並べる）
    renderWedgeAll() {
        const NS = 'http://www.w3.org/2000/svg';
        this.svg.innerHTML = '';
        const two = this.wedgeMirror && !!this._viewSlots && !!this._mirrorSlots;
        this.svg.setAttribute('viewBox', two ? '-306 -142 612 292' : '-165 -150 330 300');
        const interactive = !!this._viewSlots;
        const labelsOf = (slots) => ({
            up: this.labelOf(slots.up), right: this.labelOf(slots.right),
            down: this.labelOf(slots.down), left: this.labelOf(slots.left)
        });
        if (two) {
            this.drawWedgePane(labelsOf(this._viewSlots), -158, 'left', 'あなたの分子', interactive);
            this.drawWedgePane(labelsOf(this._mirrorSlots), 158, 'right', '🪞 鏡像', interactive);
            const sep = document.createElementNS(NS, 'line');
            sep.setAttribute('x1', 0); sep.setAttribute('y1', -128);
            sep.setAttribute('x2', 0); sep.setAttribute('y2', 128);
            sep.setAttribute('stroke', 'rgba(0,242,254,0.35)');
            sep.setAttribute('stroke-width', 1.5);
            sep.setAttribute('stroke-dasharray', '5 5');
            this.svg.appendChild(sep);
        } else {
            this.drawWedgePane(this._viewSlots ? labelsOf(this._viewSlots) : this._fallbackLabels,
                0, 'left', null, interactive);
        }
        this.updateWedgeButtons();
        this.updateWedgeNote();
    }

    // 1枚分のくさび図。中心C から4方向へ結合を描く。
    // 縦（上・下）＝紙面の奥 → 破線くさび（ハッシュ）／横（左・右）＝紙面の手前 → 塗りくさび（▶）。
    // labels は { up, right, down, left } の表示ラベル。
    // 検証しやすいよう、ペインに data-pane、各結合・ラベル・当たり判定に data-slot / data-bond を付ける。
    drawWedgePane(labels, ox, pane, title, interactive) {
        const NS = 'http://www.w3.org/2000/svg';
        const root = document.createElementNS(NS, 'g');
        root.setAttribute('data-pane', pane);
        root.setAttribute('transform', `translate(${ox},0)`);
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
    }

    updateWedgeButtons() {
        const usable = !!this._viewSlots;
        if (this.wedgeMirrorBtn) {
            this.wedgeMirrorBtn.textContent = this.wedgeMirror ? '🪞 鏡像を消す' : '🪞 鏡像と並べる';
            this.wedgeMirrorBtn.disabled = !usable;
        }
        if (this.wedgeResetBtn) this.wedgeResetBtn.disabled = !usable;
    }

    updateWedgeNote() {
        if (!this.wedgeNoteEl) return;
        const parts = [];
        if (!this._viewSlots) {
            parts.push('この描き方では立体が指定されていないため、並べ替え・鏡像比較はできません（上の並びは一例です）。' +
                       '置換基をフィッシャー投影の軸方向（縦・横）に描くと使えるようになります。');
        } else {
            parts.push('置換基（文字・結合）をクリックすると、その置換基が上に来るように並べ替えます。');
            if (this._wedgeMoved) {
                parts.push('この操作では分子は変わりません（フィッシャー投影で許される動かし方です）。' +
                           '180°回転や「1つを固定した3つの巡回」は入れ替え2回分にあたるので、鏡像にはなりません。');
            }
            if (this.wedgeMirror) {
                parts.push('左右を入れ替えると鏡像異性体になります（くさび図では1回の入れ替えで鏡像）。上下の入れ替えだけでも鏡像です。');
                parts.push(this._isAsym
                    ? '左右の図は鏡像の関係です。許される並べ替えをどう重ねても重ね合わせられません（＝鏡像異性体）。'
                    : 'この炭素は不斉ではないので、並べ替えても同じ分子です。');
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

    updateMirrorButton() {
        if (this.mirrorBtn) this.mirrorBtn.textContent = this.mirror ? '🪞 鏡像を消す' : '🪞 鏡像と並べる';
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
        this.axisAngle = 0;
        this.faceAxis();
        this.updateAxisButtons();
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
        this.updateAxisButtons();
    }

    updateAxisButtons() {
        if (!this.axisRow) return;
        const cur = this.axisIndex === null ? '' : String(this.axisIndex);
        this.axisRow.querySelectorAll('.stereo-axis-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.axisIndex === cur);
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
        if (!a) {
            this.angleX = 0;
            this.angleY = 0;
            return;
        }
        // まず軸を画面に平行（z=0）にし、そのうえで少し見下ろす。
        // 傾けないと軸以外の2つが同じ位置に投影されて重なってしまう
        this.angleY = Math.atan2(a[2], a[0]);
        this.angleX = STEREO3D_AXIS_TILT;
        // 軸以外の3つが中心の円に隠れない位相から始める（真正面／真後ろを向くと見えなくなる）
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
    rotate(v) {
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
        // 鏡像は x を反転してから同じ回転をかける（parityFromDirs が反転する＝別の分子）。
        // 軸も鏡映しておかないと、鏡像側で軸上の置換基が固定されない
        const axM = ax ? [-ax[0], ax[1], ax[2]] : null;
        const right = this.mirror
            ? this._dirs.map((d, i) => ({
                ref: d.ref, code: d.code, idx: i,
                v: this.rotate(StereoView.spinAround([-d.v[0], d.v[1], d.v[2]], axM, this.axisAngle))
            }))
            : null;
        this._drawn = { left, right };

        svg.setAttribute('viewBox', this.mirror ? '-240 -114 480 228' : '-120 -114 240 228');
        if (right) {
            this.drawPane(left, -120, 'あなたの分子');
            this.drawPane(right, 120, '🪞 鏡像');
            const NS = 'http://www.w3.org/2000/svg';
            const sep = document.createElementNS(NS, 'line');
            sep.setAttribute('x1', 0); sep.setAttribute('y1', -104);
            sep.setAttribute('x2', 0); sep.setAttribute('y2', 104);
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
    drawPane(dirs, ox, title) {
        const items = dirs.map(d => {
            const k = STEREO3D_PERSP / (STEREO3D_PERSP - d.v[2] * STEREO3D_BOND); // 手前(z+)ほど大きい
            return {
                ref: d.ref, z: d.v[2], k, axis: d.idx === this.axisIndex,
                x: ox + d.v[0] * STEREO3D_BOND * k,
                y: d.v[1] * STEREO3D_BOND * k
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
