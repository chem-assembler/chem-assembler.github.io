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
    return fragmentFormula(mol, rootId, centerId);
}

// 疑似3D表示のパラメータ（SVG座標系。x=右・y=下・z=手前が正。chemistry.js の面の向きと同じ）
const STEREO3D_BOND = 62;    // 結合の長さ
const STEREO3D_PERSP = 340;  // 弱い透視投影の視点距離（大きいほど正射影に近い）
const STEREO3D_HUB = 21;     // 中心炭素の円の半径

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

        this.mode = 'wedge';   // 'wedge' | '3d'
        this.mirror = false;   // 鏡像と並べるモード
        this.angleX = 0;       // X軸まわり（上下の傾き）
        this.angleY = 0;       // Y軸まわり（左右の回転）
        this.autoRotate = !StereoView.prefersReducedMotion();
        this._raf = null;
        this._drag = null;
        this._dirs = null;     // 基準の方向ベクトル [{ref, code, v}]（テストが参照する内部状態）
        this._drawn = null;    // 実際に描いた回転後のベクトル { left, right }（同上）
        this._parity = null;   // 描かれた立体から読めたパリティ（読めなければ null）
        this._isAsym = false;

        document.getElementById('btn-stereo').addEventListener('click', () => this.togglePicking());
        document.getElementById('btn-stereo-close').addEventListener('click', () => this.close());
        this.tabWedge.addEventListener('click', () => this.setMode('wedge'));
        this.tab3d.addEventListener('click', () => this.setMode('3d'));
        this.spinBtn.addEventListener('click', () => this.setAutoRotate(!this.autoRotate));
        this.mirrorBtn.addEventListener('click', () => this.setMirror(!this.mirror));
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

        // 大きい置換基から [上（紙面内）, 下（紙面内）, 右（手前くさび）, 左（奥・破線）] に配置（表示は一例）。
        // この4方向は「上下が紙面内・左右が手前と奥で正反対」なので、実は正四面体ではなく
        // 平面配置（行列式=0）になり、手性を担えない。したがってくさび図は読み取った立体を
        // 反映させず従来どおり一例のまま描き、描いた立体は3Dビュー側で示す（P12-7 M3）。
        const sorted = [...labels].sort((a, b) => b.length - a.length || a.localeCompare(b));
        this.renderWedge(sorted[0], sorted[1], sorted[2], sorted[3]);

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
        const originNote = this._parity
            ? '※「🧊 3Dで回す」の立体配置は、あなたが描いた立体を反映しています（くさび図のほうは、どの置換基を手前に描くかの一例です）。'
            : '※どの置換基を手前に描くかは一例です（回して描いても同じ分子です）。';
        this.captionEl.textContent =
            '作図では90°の直交で描いていますが、実際のsp3炭素の結合角は約109.5°で、4つの置換基は正四面体の頂点方向に伸びています。\n' +
            '実線は紙面内、▶（黒いくさび）は紙面の手前、ハッシュ（刻み線）は紙面の奥への結合を表します。\n' +
            stereoText + '\n' +
            originNote;

        // 3Dビューは毎回リセット（正面・鏡像オフ）してから開く
        this.mirror = false;
        this.angleX = 0;
        this.angleY = 0;
        this.updateMirrorButton();
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

    // ===== くさび図 =====

    // くさび形表記のSVGを描く（中心C、上下=紙面内、右=手前くさび、左=奥ハッシュ）
    renderWedge(upLabel, downLabel, frontLabel, backLabel) {
        const NS = 'http://www.w3.org/2000/svg';
        this.svg.innerHTML = '';
        const add = (el) => this.svg.appendChild(el);
        const line = (x1, y1, x2, y2, w = 2.5) => {
            const l = document.createElementNS(NS, 'line');
            l.setAttribute('x1', x1); l.setAttribute('y1', y1);
            l.setAttribute('x2', x2); l.setAttribute('y2', y2);
            l.setAttribute('stroke', 'rgba(255,255,255,0.75)');
            l.setAttribute('stroke-width', w);
            l.setAttribute('stroke-linecap', 'round');
            add(l);
        };
        const text = (x, y, str, size = 15, color = '#f5f6fa') => {
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', x); t.setAttribute('y', y);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'svg-atom-text');
            t.setAttribute('fill', color);
            t.style.fontSize = size + 'px';
            t.textContent = str;
            add(t);
        };

        // 紙面内の結合（上・下）
        line(0, -18, 0, -66);
        line(0, 18, 0, 66);
        // 手前（右）: 黒塗りくさび
        const wedge = document.createElementNS(NS, 'polygon');
        wedge.setAttribute('points', '16,0 66,-9 66,9');
        wedge.setAttribute('fill', 'rgba(255,255,255,0.85)');
        add(wedge);
        // 奥（左）: ハッシュ（中心に近いほど短い刻み線）
        for (let i = 0; i < 6; i++) {
            const x = -20 - i * 9;
            const h = 3.5 + i * 1.4;
            line(x, -h, x, h, 2.2);
        }

        // 中心炭素と置換基ラベル
        text(0, 5, 'C', 17, 'var(--color-c)');
        text(0, -78, upLabel);
        text(0, 88, downLabel);
        text(96, 5, frontLabel);
        text(-98, 5, backLabel);
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

    resetAngles() {
        this.angleX = 0;
        this.angleY = 0;
        this.render3D();
    }

    startSpin() {
        if (this._raf !== null || !this.autoRotate || this.mode !== '3d') return;
        let last = null;
        const step = (t) => {
            if (last === null) last = t;
            const dt = Math.min(50, t - last);
            last = t;
            this.angleY += dt * 0.0007; // 約40°/秒
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
        this.angleY += dYaw;
        this.angleX -= dPitch; // 下へドラッグ＝手前の置換基が下がる
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
        const turn = (v) => this.rotate(v);
        const left = this._dirs.map(d => ({ ref: d.ref, code: d.code, v: turn(d.v) }));
        // 鏡像は x を反転してから同じ回転をかける（parityFromDirs が反転する＝別の分子）
        const right = this.mirror
            ? this._dirs.map(d => ({ ref: d.ref, code: d.code, v: turn([-d.v[0], d.v[1], d.v[2]]) }))
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
                ref: d.ref, z: d.v[2], k,
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
            const color = StereoView.colorOf(label);
            const len = Math.hypot(it.x - ox, it.y);
            const t = len > 1 ? Math.min(0.9, STEREO3D_HUB / len) : 0; // 中心の円のふちから結合線を引く
            this.line(g, ox + (it.x - ox) * t, it.y * t, it.x, it.y, 2.6 * it.k, color);
            // ラベルが長い置換基（CH₃・CHO₂ など）は横長の楕円にして文字がはみ出さないようにする
            this.ellipse(g, it.x, it.y, (11 + 4.6 * label.length) * it.k, 15 * it.k, color, 2.2 * it.k);
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
