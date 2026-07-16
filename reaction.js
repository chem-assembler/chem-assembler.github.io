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
        this.btnPlay = document.getElementById('btn-rx-play');

        // 再生アニメーションの状態
        this.animating = false;
        this.stopRequested = false;

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
        this.btnPrev.addEventListener('click', () => { if (!this.animating) this.goto(this.view - 1); });
        this.btnNext.addEventListener('click', () => { if (!this.animating) this.goto(this.view + 1); });
        this.btnRestart.addEventListener('click', () => { if (!this.animating) this.goto(0); });
        this.btnPlay.addEventListener('click', () => this.play());
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
        this.stopRequested = true; // 再生中なら中断
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
        this.arrowsGroup.style.opacity = ''; // 遷移アニメで下げた透明度をリセット

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

        this.setControlsEnabled(!this.animating);
    }

    // ステップ操作ボタンの有効/無効を一括制御（再生中は無効化）
    setControlsEnabled(enabled) {
        const steps = this.currentReaction ? this.currentReaction.steps : [];
        this.btnPrev.disabled = !enabled || this.view === 0;
        this.btnNext.disabled = !enabled || this.view === steps.length;
        this.btnRestart.disabled = !enabled;
        this.selectEl.disabled = !enabled;
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

        // 原子（電荷・ラジカル付き）
        state.atoms.forEach((a, i) => {
            this.game.renderAtom(`rx_${i}`, a.element, a.x, a.y, false);
            if (a.charge) this.renderCharge(a);
            if (a.radical) this.renderRadical(a);
        });
    }

    // 不対電子（ラジカル）の点を原子ラベルの右上に描画
    renderRadical(atom) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', atom.x + 9);
        dot.setAttribute('cy', atom.y - 8);
        dot.setAttribute('r', '2.2');
        dot.setAttribute('class', 'svg-radical-dot');
        this.game.atomsGroup.appendChild(dot);
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

    // arrow の source/target 指定を座標に解決する
    // bond=既存結合の中点 / atom=原子位置 / mid=2原子間の中点（これから生成する結合を指すのに使う）
    resolvePoint(state, ref) {
        if (ref.type === 'bond' || ref.type === 'mid') {
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

    // ▶/⏸: 現在のビューから最後まで通し再生する（再生中に押すと一時停止）
    async play() {
        if (this.animating) {
            this.stopRequested = true;
            return;
        }
        if (!this.currentReaction || !this.active) return;
        const steps = this.currentReaction.steps;
        if (this.view >= steps.length) this.view = 0; // 完了状態からは最初に戻って再生

        this.animating = true;
        this.stopRequested = false;
        this.btnPlay.textContent = '⏸';

        while (this.view < steps.length && !this.stopRequested) {
            const step = steps[this.view];
            this.goto(this.view); // from状態＋矢印を静的表示
            this.setControlsEnabled(false);
            await this.animateArrows(800);   // フェーズ1: 巻矢印が描かれる
            if (this.stopRequested) break;
            await this.animateTransition(step, 1000); // フェーズ2: 状態遷移
            this.view++;
        }

        this.animating = false;
        this.btnPlay.textContent = '▶';
        if (this.active) this.goto(this.view); // 停止位置のビューを静的表示に整える
    }

    // 巻矢印が「描かれていく」アニメーション（stroke-dashoffset方式）
    animateArrows(duration) {
        const paths = [...this.arrowsGroup.querySelectorAll('path')];
        const lengths = paths.map(p => p.getTotalLength());
        paths.forEach((p, i) => {
            p.style.strokeDasharray = lengths[i];
            p.style.strokeDashoffset = lengths[i];
        });
        return this.animateFrames(duration, t => {
            paths.forEach((p, i) => {
                p.style.strokeDashoffset = lengths[i] * (1 - t);
            });
        });
    }

    // from状態→to状態への遷移（原子座標は線形補間、結合はクロスフェード、矢印はフェードアウト）
    animateTransition(step, duration) {
        const from = this.currentReaction.states[step.from];
        const to = this.currentReaction.states[step.to];
        return this.animateFrames(duration, t => {
            const e = t * t * (3 - 2 * t); // smoothstepイージング
            this.arrowsGroup.style.opacity = String(1 - e);
            this.renderInterpolated(from, to, e);
        });
    }

    // duration(ms) かけて onFrame(t: 0→1) を呼ぶ。
    // タブが非表示のときは requestAnimationFrame が停止するため setTimeout にフォールバックする
    // （再生中にタブを切り替えても固まらないようにするため）。
    animateFrames(duration, onFrame) {
        return new Promise(resolve => {
            const start = performance.now();
            const schedule = (fn) => {
                if (document.hidden) {
                    setTimeout(() => fn(performance.now()), 33);
                } else {
                    requestAnimationFrame(fn);
                }
            };
            const tick = (now) => {
                if (this.stopRequested) { resolve(); return; }
                const t = Math.min(1, (now - start) / duration);
                onFrame(t);
                if (t < 1) schedule(tick);
                else resolve();
            };
            schedule(tick);
        });
    }

    // 補間フレームの描画
    renderInterpolated(from, to, t) {
        this.game.atomsGroup.innerHTML = '';
        this.game.bondsGroup.innerHTML = '';

        const lerp = (a, b) => a + (b - a) * t;
        const pos = (i) => ({
            x: lerp(from.atoms[i].x, to.atoms[i].x),
            y: lerp(from.atoms[i].y, to.atoms[i].y)
        });
        const keyOf = (b) => `${Math.min(b.atom1Index, b.atom2Index)}_${Math.max(b.atom1Index, b.atom2Index)}`;
        const fromBonds = new Map(from.bonds.map(b => [keyOf(b), b]));
        const toBonds = new Map(to.bonds.map(b => [keyOf(b), b]));
        const allKeys = new Set([...fromBonds.keys(), ...toBonds.keys()]);

        allKeys.forEach(k => {
            const fb = fromBonds.get(k);
            const tb = toBonds.get(k);
            const b = fb || tb;
            const p1 = pos(b.atom1Index);
            const p2 = pos(b.atom2Index);
            const isH = from.atoms[b.atom1Index].element === 'H' || from.atoms[b.atom2Index].element === 'H';
            if (fb && tb) {
                if (fb.type === tb.type) {
                    this.drawBondFaded(p1, p2, fb.type, isH, 1);
                } else {
                    // 結合次数の変化はクロスフェード（例: C=C → C-C）
                    this.drawBondFaded(p1, p2, fb.type, isH, 1 - t);
                    this.drawBondFaded(p1, p2, tb.type, isH, t);
                }
            } else if (fb) {
                this.drawBondFaded(p1, p2, fb.type, isH, 1 - t); // 切れる結合はフェードアウト
            } else {
                this.drawBondFaded(p1, p2, tb.type, isH, t);     // 生じる結合はフェードイン
            }
        });

        from.atoms.forEach((a, i) => {
            const p = pos(i);
            this.game.renderAtom(`rx_${i}`, a.element, p.x, p.y, false);
            // 電荷・ラジカルは遷移の前半はfrom側、後半はto側を表示する
            const src = (t < 0.5 ? from.atoms[i] : to.atoms[i]);
            if (src.charge) this.renderCharge({ x: p.x, y: p.y, charge: src.charge });
            if (src.radical) this.renderRadical({ x: p.x, y: p.y });
        });
    }

    // renderBondを流用しつつ、その呼び出しで追加された線へ透明度を適用する
    drawBondFaded(p1, p2, type, isH, opacity) {
        const before = this.game.bondsGroup.childElementCount;
        this.game.renderBond(p1.x, p1.y, p2.x, p2.y, type, isH);
        const children = this.game.bondsGroup.children;
        for (let i = before; i < children.length; i++) {
            children[i].setAttribute('opacity', String(Math.max(0, Math.min(1, opacity))));
        }
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
