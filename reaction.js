/**
 * Reaction Mechanism Viewer for Chem-Assembler（設計: DESIGN_reaction_mechanism.md）
 * 反応機構モードの状態表示・巻矢印描画・ステップ送りを制御します。
 * 反応モードでは自動水素補完を使わず、states に明示された原子のみを描画します（設計 3.3）。
 */

class ReactionPlayer {
    constructor(game) {
        this.game = game;
        this.reactions = [];
        this.active = false;
        this.currentReaction = null;
        // 表示ビュー: 0..steps.length-1 は「from状態＋巻矢印」、steps.length は最終状態（矢印なし）
        this.view = 0;

        this.arrowsGroup = document.getElementById('arrows-group');
        this.box = document.getElementById('reaction-box');
        this.checkMode = document.getElementById('check-reaction-mode');
        this.selectEl = document.getElementById('select-reaction');
        this.captionEl = document.getElementById('reaction-caption');
        this.stepLabelEl = document.getElementById('reaction-step-label');
        this.btnPrev = document.getElementById('btn-rx-prev');
        this.btnNext = document.getElementById('btn-rx-next');
        this.btnRestart = document.getElementById('btn-rx-restart');

        this.initEvents();
    }

    async load() {
        try {
            const url = new URL('reactions.json', window.location.href).href;
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.reactions = await response.json();
            this.populateSelect();
        } catch (e) {
            console.error('reactions.json のロードに失敗:', e);
            if (this.box) this.box.style.display = 'none'; // データがなければビューアごと隠す
        }
    }

    populateSelect() {
        this.selectEl.innerHTML = '';
        this.reactions.forEach((r, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${r.series}: ${r.name}`;
            this.selectEl.appendChild(opt);
        });
    }

    initEvents() {
        this.checkMode.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.enter(parseInt(this.selectEl.value) || 0);
            } else {
                this.exit();
            }
        });
        this.selectEl.addEventListener('change', (e) => {
            if (this.active) this.enter(parseInt(e.target.value));
        });
        this.btnPrev.addEventListener('click', () => this.goto(this.view - 1));
        this.btnNext.addEventListener('click', () => this.goto(this.view + 1));
        this.btnRestart.addEventListener('click', () => this.goto(0));
    }

    // 反応機構モードに入る
    enter(reactionIndex) {
        if (!this.reactions.length) return;
        this.currentReaction = this.reactions[reactionIndex] || this.reactions[0];
        this.active = true;
        this.checkMode.checked = true;
        this.game.clearUIOverlay();
        this.fitToReaction();
        this.goto(0);
    }

    // パズルモードへ戻る
    exit() {
        this.active = false;
        this.checkMode.checked = false;
        this.clearArrows();
        this.captionEl.textContent = '';
        this.stepLabelEl.textContent = '';
        this.game.fitCanvasToTarget();
        this.game.updateDrawing();
    }

    // 指定ビューを表示（0..steps.length）
    goto(view) {
        const steps = this.currentReaction.steps;
        this.view = Math.max(0, Math.min(steps.length, view));

        if (this.view < steps.length) {
            const step = steps[this.view];
            this.renderState(this.currentReaction.states[step.from]);
            this.renderArrows(step);
            this.captionEl.textContent = step.caption || '';
            this.stepLabelEl.textContent = `ステップ ${this.view + 1} / ${steps.length}`;
        } else {
            // 最終状態（矢印なし）
            const lastStep = steps[steps.length - 1];
            this.renderState(this.currentReaction.states[lastStep.to]);
            this.clearArrows();
            this.captionEl.textContent = '反応完了。生成物の構造を確認しましょう。';
            this.stepLabelEl.textContent = `完了 (${steps.length} ステップ)`;
        }

        this.btnPrev.disabled = (this.view === 0);
        this.btnNext.disabled = (this.view === steps.length);
    }

    // 分子状態を静的に描画（自動水素なし・明示原子のみ。既存のrenderAtom/renderBondを流用）
    renderState(state) {
        this.game.atomsGroup.innerHTML = '';
        this.game.bondsGroup.innerHTML = '';
        this.clearArrows();

        // 結合
        state.bonds.forEach(b => {
            const a1 = state.atoms[b.atom1Index];
            const a2 = state.atoms[b.atom2Index];
            if (!a1 || !a2) return;
            const isH = (a1.element === 'H' || a2.element === 'H');
            this.game.renderBond(a1.x, a1.y, a2.x, a2.y, b.type, isH);
        });

        // 原子（電荷付き）
        state.atoms.forEach((a, i) => {
            this.game.renderAtom(`rx_${i}`, a.element, a.x, a.y, false);
            if (a.charge) {
                this.renderCharge(a);
            }
        });
    }

    // 形式電荷 (+/−) を原子ラベルの右上に描画
    renderCharge(atom) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', atom.x + 9);
        text.setAttribute('y', atom.y - 5);
        text.setAttribute('class', 'svg-charge');
        text.style.fontSize = '11px';
        text.textContent = atom.charge > 0 ? '+' : '−';
        this.game.atomsGroup.appendChild(text);
    }

    clearArrows() {
        this.arrowsGroup.innerHTML = '';
    }

    // ステップの巻矢印を静的に描画
    renderArrows(step) {
        this.clearArrows();
        const state = this.currentReaction.states[step.from];
        step.arrows.forEach(arrow => {
            const p1 = this.resolvePoint(state, arrow.source);
            const p2 = this.resolvePoint(state, arrow.target);
            if (!p1 || !p2) return;
            this.drawCurvedArrow(p1, p2, arrow.style || 'pair', arrow.curvature);
        });
    }

    // arrow の source/target 指定を座標に解決する（bond=中点 / atom=原子位置）
    resolvePoint(state, ref) {
        if (ref.type === 'bond') {
            const a1 = state.atoms[ref.atoms[0]];
            const a2 = state.atoms[ref.atoms[1]];
            if (!a1 || !a2) return null;
            return { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
        }
        const a = state.atoms[ref.index];
        return a ? { x: a.x, y: a.y } : null;
    }

    // 2点間の巻矢印（2次ベジェ）を描画。curvature は法線方向のふくらみ(px、符号で向き)
    drawCurvedArrow(p1, p2, style, curvature = 30) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const cx = (p1.x + p2.x) / 2 + nx * curvature;
        const cy = (p1.y + p2.y) / 2 + ny * curvature;

        // 終点は原子円と重ならないよう、制御点方向から 13px 手前で止める
        const ex = p2.x + (cx - p2.x) / Math.hypot(cx - p2.x, cy - p2.y) * 13;
        const ey = p2.y + (cy - p2.y) / Math.hypot(cx - p2.x, cy - p2.y) * 13;
        // 始点も 6px だけ浮かせる
        const sx = p1.x + (cx - p1.x) / Math.hypot(cx - p1.x, cy - p1.y) * 6;
        const sy = p1.y + (cy - p1.y) / Math.hypot(cx - p1.x, cy - p1.y) * 6;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#ff2a85');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-linecap', 'round');
        // pair=電子対（両羽の矢尻） / single=単電子（片羽の矢尻）
        path.setAttribute('marker-end', style === 'single' ? 'url(#arrow-head-single)' : 'url(#arrow-head-pair)');
        path.setAttribute('class', 'svg-reaction-arrow');
        this.arrowsGroup.appendChild(path);
    }

    // 全状態の原子を含む境界にキャンバスをフィットさせる
    fitToReaction() {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        this.currentReaction.states.forEach(state => {
            state.atoms.forEach(a => {
                minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
                minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
            });
        });
        const W = maxX - minX, H = maxY - minY;
        let viewW = Math.max(360, W + 200);
        let viewH = Math.max(270, H + 160);
        if (viewW / viewH > 4 / 3) { viewH = viewW * 3 / 4; } else { viewW = viewH * 4 / 3; }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        this.game.svg.setAttribute('viewBox', `${cx - viewW / 2} ${cy - viewH / 2} ${viewW} ${viewH}`);
    }
}
