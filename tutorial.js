/**
 * アニメーション付きチュートリアル（P9-6 M1 / 設計: DESIGN_tutorial.md）
 * 実キャンバス上でゴーストカーソルが操作を再現し、字幕で解説する。
 * 実イベント（PointerEvent）で本物のアプリを駆動するため、画面に起きることは
 * 本番の操作結果そのもの。再生前の作図は退避し、終了・中断時に完全復元する。
 */

class TutorialPlayer {
    constructor(game) {
        this.game = game;
        this.tutorials = [];
        this.running = false;
        this.aborted = false;
        this.lastResult = null; // 直近デモの最終状態（回帰テスト用）
        // デバイス自動判定（タッチパネルは pointer: coarse）。FAQ内のセレクタで手動切替可
        this.device = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 'touch' : 'mouse';

        this.modal = document.getElementById('tutorial-modal');
        this.listEl = document.getElementById('tutorial-list');
        this.searchEl = document.getElementById('tutorial-search');
        this.deviceEl = document.getElementById('tutorial-device');

        const help = document.getElementById('btn-help');
        if (help) help.addEventListener('click', () => this.openModal());
        const close = document.getElementById('btn-tutorial-close');
        if (close) close.addEventListener('click', () => this.modal.classList.add('hidden'));
        if (this.searchEl) this.searchEl.addEventListener('input', () => this.renderList());
        if (this.deviceEl) {
            this.deviceEl.value = this.device;
            this.deviceEl.addEventListener('change', () => { this.device = this.deviceEl.value; });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.running) this.aborted = true;
        });

        this.load();
    }

    async load() {
        try {
            const res = await fetch(new URL('tutorials.json', window.location.href).href);
            this.tutorials = await res.json();
            this.renderList();
        } catch (e) {
            console.error('tutorials.json のロードに失敗:', e);
        }
    }

    openModal() {
        this.renderList();
        this.modal.classList.remove('hidden');
    }

    renderList() {
        if (!this.listEl) return;
        const q = (this.searchEl ? this.searchEl.value : '').trim();
        this.listEl.innerHTML = '';
        this.tutorials
            .filter(t => !q || t.title.includes(q) || t.summary.includes(q) ||
                         (t.keywords || []).some(k => k.includes(q)))
            .forEach(t => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; align-items:center; gap:10px; background:rgba(255,255,255,0.05); border-radius:8px; padding:9px 12px;';
                const info = document.createElement('div');
                info.style.cssText = 'flex:1; text-align:left;';
                info.innerHTML = `<div style="font-size:13.5px; color:#fff;">${t.title}</div>` +
                                 `<div style="font-size:11.5px; color:var(--text-secondary);">${t.summary}</div>`;
                const btn = document.createElement('button');
                btn.className = 'view-btn';
                btn.style.cssText = 'white-space:nowrap; padding:7px 12px;';
                btn.textContent = '▶ デモを見る';
                btn.addEventListener('click', () => {
                    this.modal.classList.add('hidden');
                    this.play(t.id);
                });
                row.appendChild(info);
                row.appendChild(btn);
                this.listEl.appendChild(row);
            });
        if (this.listEl.children.length === 0) {
            this.listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">該当するチュートリアルがありません。</div>';
        }
    }

    // ---------- 再生 ----------

    async play(id, opts = {}) {
        if (this.running) return;
        const t = this.tutorials.find(x => x.id === id);
        if (!t) return;
        const g = this.game;
        this.running = true;
        this.aborted = false;

        if (window.reactionPlayer && window.reactionPlayer.active) window.reactionPlayer.exit();

        // 作図・履歴・選択状態を退避（終了/中断時に完全復元する）
        const saved = {
            state: g.serializeState(),
            history: [...g.history],
            redo: [...g.redoStack],
            atomType: g.selectedAtomType
        };
        this.buildOverlay();
        try {
            g.userMolecule = new Molecule();
            g.updateDrawing();
            g.fitCanvasToTarget();
            for (const step of t.steps) {
                if (this.aborted) break;
                this.setCaption(this.resolveCaption(step.caption));
                for (const a of step.actions) {
                    if (this.aborted) break;
                    await this.doAction(a, opts.fast);
                }
                if (!opts.fast && !this.aborted) await this.sleep(1100); // 字幕を読む時間
            }
            this.lastResult = {
                formula: g.computeMolecularFormula(),
                name: (document.getElementById('compound-name') || {}).textContent || ''
            };
        } catch (e) {
            console.error('チュートリアル再生エラー:', e);
            g.showToast('デモの再生に失敗しました: ' + e.message);
        } finally {
            // 完全復元（デモ中の操作が積んだ履歴も巻き戻す）
            g.history = saved.history;
            g.redoStack = saved.redo;
            g.restoreState(JSON.parse(saved.state));
            g.fitCanvasToTarget();
            const ab = document.querySelector(`.atom-btn[data-atom="${saved.atomType}"]`);
            if (ab) ab.click();
            g.selectedModule = null;
            document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
            this.teardownOverlay();
            this.running = false;
        }
    }

    resolveCaption(c) {
        if (typeof c === 'string') return c;
        return c[this.device] || c.mouse || Object.values(c)[0] || '';
    }

    // ---------- アクション実行 ----------

    svgPoint(x, y) {
        const p = new DOMPoint(x, y).matrixTransform(this.game.svg.getScreenCTM());
        return { clientX: p.x, clientY: p.y };
    }

    pe(type, cl) {
        return new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
            button: type === 'pointermove' ? -1 : 0, clientX: cl.clientX, clientY: cl.clientY
        });
    }

    // 線分との距離で最寄りの結合ヒットラインを探す（SVG論理座標）
    findHitbox(x, y) {
        let best = null;
        let bd = 14;
        document.querySelectorAll('.svg-bond-hitbox').forEach(h => {
            const x1 = +h.getAttribute('x1'), y1 = +h.getAttribute('y1');
            const x2 = +h.getAttribute('x2'), y2 = +h.getAttribute('y2');
            const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
            let tt = L2 ? ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / L2 : 0;
            tt = Math.max(0, Math.min(1, tt));
            const d = Math.hypot(x - (x1 + tt * (x2 - x1)), y - (y1 + tt * (y2 - y1)));
            if (d < bd) { bd = d; best = h; }
        });
        return best;
    }

    async doAction(a, fast) {
        const g = this.game;
        const svg = g.svg;
        switch (a.type) {
            case 'wait':
                await this.sleep(fast ? 10 : a.ms);
                break;
            case 'undo':
                g.undo();
                await this.sleep(fast ? 15 : 500);
                break;
            case 'button': {
                const el = document.querySelector(a.selector);
                if (!el) throw new Error('ボタンが見つかりません: ' + a.selector);
                const r = el.getBoundingClientRect();
                await this.moveCursor({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, fast);
                this.pulse();
                el.click();
                await this.sleep(fast ? 15 : 450);
                break;
            }
            case 'click': {
                const cl = this.svgPoint(a.x, a.y);
                await this.moveCursor(cl, fast);
                this.pulse();
                svg.dispatchEvent(this.pe('pointerdown', cl));
                window.dispatchEvent(this.pe('pointerup', cl));
                await this.sleep(fast ? 15 : 500);
                break;
            }
            case 'hover': {
                const cl = this.svgPoint(a.x, a.y);
                await this.moveCursor(cl, fast);
                svg.dispatchEvent(this.pe('pointermove', cl));
                await this.sleep(fast ? 15 : 300);
                break;
            }
            case 'clickBond':
            case 'cutBond': {
                const hit = this.findHitbox(a.x, a.y);
                if (!hit) throw new Error('結合が見つかりません');
                const cl = this.svgPoint(a.x, a.y);
                await this.moveCursor(cl, fast);
                this.pulse();
                if (a.type === 'clickBond') {
                    hit.dispatchEvent(this.pe('pointerdown', cl));
                    window.dispatchEvent(this.pe('pointerup', cl));
                    hit.dispatchEvent(new MouseEvent('click', {
                        bubbles: true, cancelable: true, clientX: cl.clientX, clientY: cl.clientY
                    }));
                } else {
                    hit.dispatchEvent(new MouseEvent('contextmenu', {
                        bubbles: true, cancelable: true, clientX: cl.clientX, clientY: cl.clientY
                    }));
                }
                await this.sleep(fast ? 15 : 550);
                break;
            }
            case 'drag': {
                const from = this.svgPoint(a.from.x, a.from.y);
                const to = this.svgPoint(a.to.x, a.to.y);
                const target = a.onBond ? this.findHitbox(a.from.x, a.from.y) : svg;
                if (!target) throw new Error('ドラッグ対象が見つかりません');
                await this.moveCursor(from, fast);
                this.pulse();
                target.dispatchEvent(this.pe('pointerdown', from));
                const N = fast ? 2 : 6;
                for (let i = 1; i <= N; i++) {
                    const cl = {
                        clientX: from.clientX + (to.clientX - from.clientX) * i / N,
                        clientY: from.clientY + (to.clientY - from.clientY) * i / N
                    };
                    await this.moveCursor(cl, fast, 60);
                    svg.dispatchEvent(this.pe('pointermove', cl));
                }
                window.dispatchEvent(this.pe('pointerup', to));
                await this.sleep(fast ? 15 : 450);
                break;
            }
            default:
                throw new Error('未知のアクション: ' + a.type);
        }
    }

    // ---------- ゴーストカーソル・字幕・オーバーレイ ----------

    buildOverlay() {
        const ov = document.createElement('div');
        ov.id = 'tutorial-overlay';
        ov.style.cssText = 'position:fixed; inset:0; z-index:3000; background:rgba(0,0,0,0.06); cursor:default;';
        // デモ中の誤操作を防ぐ全画面ブロック。プログラムから発行するイベントは影響を受けない
        const cursor = document.createElement('div');
        cursor.id = 'tutorial-cursor';
        cursor.style.cssText =
            'position:fixed; width:22px; height:22px; border-radius:50%; pointer-events:none;' +
            'background:rgba(0,242,254,0.35); border:2px solid var(--color-cyan, #00f2fe);' +
            'box-shadow:0 0 14px rgba(0,242,254,0.8); transform:translate(-50%,-50%);' +
            'left:50%; top:50%; transition:left 0.35s ease, top 0.35s ease; z-index:3002;';
        if (this.device === 'touch') {
            cursor.style.width = '34px';
            cursor.style.height = '34px';
        }
        const caption = document.createElement('div');
        caption.id = 'tutorial-caption';
        caption.style.cssText =
            'position:fixed; left:50%; bottom:26px; transform:translateX(-50%); max-width:680px; width:calc(100% - 40px);' +
            'background:rgba(10,16,30,0.94); border:1px solid var(--color-cyan, #00f2fe); border-radius:10px;' +
            'padding:11px 16px; font-size:13.5px; line-height:1.6; color:#eef2fa; z-index:3003; text-align:left;';
        const stop = document.createElement('button');
        stop.id = 'tutorial-stop';
        stop.textContent = '✕ デモを終了（Esc）';
        stop.style.cssText =
            'position:fixed; top:14px; right:16px; z-index:3003; padding:7px 14px; border-radius:8px;' +
            'border:1px solid rgba(255,255,255,0.4); background:rgba(10,16,30,0.9); color:#fff; cursor:pointer; font-size:12.5px;';
        stop.addEventListener('click', () => { this.aborted = true; });
        ov.appendChild(cursor);
        ov.appendChild(caption);
        ov.appendChild(stop);
        document.body.appendChild(ov);
        this.cursorEl = cursor;
        this.captionEl = caption;
    }

    teardownOverlay() {
        const ov = document.getElementById('tutorial-overlay');
        if (ov) ov.remove();
        this.cursorEl = null;
        this.captionEl = null;
    }

    setCaption(text) {
        if (this.captionEl) this.captionEl.textContent = text;
    }

    pulse() {
        if (!this.cursorEl) return;
        this.cursorEl.animate(
            [{ boxShadow: '0 0 0 0 rgba(0,242,254,0.9)' }, { boxShadow: '0 0 0 26px rgba(0,242,254,0)' }],
            { duration: 450 });
    }

    async moveCursor(cl, fast, durationMs = 350) {
        if (!this.cursorEl) return;
        if (fast) this.cursorEl.style.transition = 'none';
        else this.cursorEl.style.transition = `left ${durationMs}ms ease, top ${durationMs}ms ease`;
        this.cursorEl.style.left = cl.clientX + 'px';
        this.cursorEl.style.top = cl.clientY + 'px';
        await this.sleep(fast ? 5 : durationMs + 40);
    }

    sleep(ms) {
        // 中断（✕/Esc）に即応できるよう小刻みに待つ
        return new Promise(resolve => {
            const start = performance.now();
            const tick = () => {
                if (this.aborted || performance.now() - start >= ms) resolve();
                else setTimeout(tick, Math.min(50, ms));
            };
            tick();
        });
    }
}
