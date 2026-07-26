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
        this.setupHoverChips();
    }

    // 主要ボタンを800msホバーすると「▶デモを見る」チップを出す（P9-6 M2）。
    // 邪魔にならないよう、すぐ離せば何も出ない。タッチ環境ではホバーが無いため自然に無効
    setupHoverChips() {
        const chip = document.createElement('button');
        chip.id = 'tutorial-chip';
        chip.className = 'view-btn';
        chip.style.cssText = 'position:fixed; z-index:2500; display:none; font-size:11.5px; padding:4px 10px;' +
            'border:1px solid var(--color-cyan, #00f2fe); background:rgba(10,16,30,0.96); color:#7fe8ef; cursor:pointer;';
        chip.textContent = '▶ デモを見る';
        document.body.appendChild(chip);
        this.chipEl = chip;
        let timer = null;
        let chipId = null;
        const hide = () => {
            clearTimeout(timer);
            if (!chip.matches(':hover')) chip.style.display = 'none';
        };
        chip.addEventListener('click', () => {
            chip.style.display = 'none';
            if (chipId) this.play(chipId);
        });
        document.querySelectorAll('[data-tutorial]').forEach(el => {
            el.addEventListener('pointerenter', (e) => {
                if (e.pointerType === 'touch' || this.running) return;
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const r = el.getBoundingClientRect();
                    chipId = el.dataset.tutorial;
                    chip.style.display = 'block';
                    chip.style.left = Math.min(r.right + 8, window.innerWidth - 130) + 'px';
                    chip.style.top = (r.top - 2) + 'px';
                }, 800);
            });
            el.addEventListener('pointerleave', () => setTimeout(hide, 120));
        });
    }

    async load() {
        try {
            // 他のデータ（stages.json 等）と同じくキャッシュ再検証を強制する。
            // 付けないと更新後も古い内容が最大10分使われる（GitHub Pagesはmax-age=600）
            const res = await fetch(new URL('tutorials.json', window.location.href).href, { cache: 'no-cache' });
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
                         (t.answer || '').includes(q) ||
                         (t.keywords || []).some(k => k.includes(q)))
            .forEach(t => {
                const row = document.createElement('div');
                row.style.cssText = 'background:rgba(255,255,255,0.05); border-radius:8px; padding:9px 12px;';
                const head = document.createElement('div');
                head.style.cssText = 'display:flex; align-items:center; gap:10px;';
                const info = document.createElement('div');
                info.style.cssText = 'flex:1; text-align:left;';
                info.innerHTML = `<div style="font-size:13.5px; color:#fff;">${t.title}</div>` +
                                 `<div style="font-size:11.5px; color:var(--text-secondary);">${t.summary}</div>`;
                head.appendChild(info);

                const btn = document.createElement('button');
                btn.className = 'view-btn';
                btn.style.cssText = 'white-space:nowrap; padding:7px 12px;';
                if (t.answer) {
                    // 操作デモを持たない「よくある質問」項目。開閉で答えを表示する（P9-6 M3）
                    const ans = document.createElement('div');
                    ans.style.cssText = 'display:none; font-size:12px; line-height:1.7; color:var(--text-primary);' +
                        'text-align:left; margin-top:8px; white-space:pre-line; border-top:1px solid rgba(255,255,255,0.12); padding-top:7px;';
                    ans.textContent = t.answer;
                    btn.textContent = '答えを見る';
                    btn.addEventListener('click', () => {
                        const open = ans.style.display === 'block';
                        ans.style.display = open ? 'none' : 'block';
                        btn.textContent = open ? '答えを見る' : '閉じる';
                    });
                    head.appendChild(btn);
                    row.appendChild(head);
                    row.appendChild(ans);
                } else {
                    btn.textContent = '▶ デモを見る';
                    btn.addEventListener('click', () => {
                        this.modal.classList.add('hidden');
                        this.play(t.id);
                    });
                    head.appendChild(btn);
                    row.appendChild(head);
                }
                this.listEl.appendChild(row);
            });
        if (this.listEl.children.length === 0) {
            this.listEl.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">該当する項目がありません。</div>';
        }
    }

    // ---------- 再生 ----------

    async play(id, opts = {}) {
        if (this.running) return;
        const t = this.tutorials.find(x => x.id === id);
        if (!t || !t.steps) return; // 「よくある質問」項目は操作デモを持たない
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
            // 反応機構モードやモーダルを開いたままにしない
            if (window.reactionPlayer && window.reactionPlayer.active) window.reactionPlayer.exit();
            // デモ中に開いたモバイルの右パネルシートも閉じる（P11-M3）
            document.body.classList.remove('sheet-open');
            document.querySelectorAll('.modal-overlay').forEach(m => {
                if (m.id !== 'tutorial-modal') m.classList.add('hidden');
            });
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

    // ---------- モバイルのシート連動（P11-M3） ----------
    // スマホでは右パネルがシート/ドロワーになるため、デモが右パネル内の要素を
    // 操作する前にシートを開き、キャンバス操作の前に閉じる。PC（≥900px）では何もしない。

    isMobileLayout() {
        return window.matchMedia('(max-width: 899px)').matches;
    }

    async setSheetOpen(open, fast) {
        if (!this.isMobileLayout()) return;
        if (document.body.classList.contains('sheet-open') === open) return;
        document.body.classList.toggle('sheet-open', open);
        await this.sleep(fast ? 0 : 350); // 開閉アニメ（0.25s）の完了を待つ
    }

    // 対象要素が右パネル内ならシートを開き、それ以外（キャンバス・左パレット等）なら閉じる
    async syncSheetFor(el, fast) {
        const inSheet = !!(el && el.closest && el.closest('#right-panel'));
        await this.setSheetOpen(inSheet, fast);
    }

    async doAction(a, fast) {
        const g = this.game;
        const svg = g.svg;
        // キャンバス上で行うアクションの前はシートを閉じる（描画が見えるように）
        if (['click', 'hover', 'clickBond', 'cutBond', 'wheel', 'pan', 'drag'].includes(a.type)) {
            await this.setSheetOpen(false, fast);
        }
        switch (a.type) {
            case 'wait':
                await this.sleep(fast ? 0 : a.ms);
                break;
            case 'undo':
                g.undo();
                await this.sleep(fast ? 0 : 500);
                break;
            case 'button': {
                const el = document.querySelector(a.selector);
                if (!el) throw new Error('ボタンが見つかりません: ' + a.selector);
                await this.syncSheetFor(el, fast);
                const r = el.getBoundingClientRect();
                // モバイルでは一部ボタンを非表示にしている（P11-M2b）。
                // 隠れたボタン（rect=0）はカーソル演出を省いてクリックだけ実行する
                if (r.width > 0 && r.height > 0) {
                    await this.moveCursor({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, fast);
                    this.pulse();
                }
                el.click();
                await this.sleep(fast ? 0 : 450);
                break;
            }
            case 'click': {
                const cl = this.svgPoint(a.x, a.y);
                await this.moveCursor(cl, fast);
                this.pulse();
                svg.dispatchEvent(this.pe('pointerdown', cl));
                window.dispatchEvent(this.pe('pointerup', cl));
                await this.sleep(fast ? 0 : 500);
                break;
            }
            case 'hover': {
                const cl = this.svgPoint(a.x, a.y);
                await this.moveCursor(cl, fast);
                svg.dispatchEvent(this.pe('pointermove', cl));
                await this.sleep(fast ? 0 : 300);
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
                await this.sleep(fast ? 0 : 550);
                break;
            }
            case 'toggle': {
                // チェックボックス（反応機構モードの切替など）を操作する
                const el = document.querySelector(a.selector);
                if (!el) throw new Error('要素が見つかりません: ' + a.selector);
                await this.syncSheetFor(el, fast);
                const r = el.getBoundingClientRect();
                const label = el.closest('label') || el.parentElement;
                const lr = (r.width > 0 ? r : (label ? label.getBoundingClientRect() : r));
                await this.moveCursor({ clientX: lr.left + lr.width / 2, clientY: lr.top + lr.height / 2 }, fast);
                this.pulse();
                el.checked = (a.checked !== undefined) ? a.checked : !el.checked;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                await this.sleep(fast ? 0 : 700);
                break;
            }
            case 'select': {
                // ドロップダウンから項目を選ぶ
                const el = document.querySelector(a.selector);
                if (!el) throw new Error('要素が見つかりません: ' + a.selector);
                await this.syncSheetFor(el, fast);
                const r = el.getBoundingClientRect();
                await this.moveCursor({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, fast);
                this.pulse();
                const opt = [...el.options].find(o => o.textContent.includes(a.contains));
                if (!opt) throw new Error('選択肢が見つかりません: ' + a.contains);
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                await this.sleep(fast ? 0 : 700);
                break;
            }
            case 'summon': {
                // 名称から分子を呼び出す（反応デモの準備）
                const input = document.getElementById('summon-input');
                await this.syncSheetFor(input, fast);
                const r = input.getBoundingClientRect();
                await this.moveCursor({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, fast);
                this.pulse();
                input.value = a.name;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                await this.sleep(fast ? 0 : 600);
                break;
            }
            case 'reactionButton': {
                const btn = [...document.querySelectorAll('#reaction-actions button')]
                    .find(b => b.textContent.includes(a.contains));
                if (!btn) throw new Error('反応ボタンが見つかりません: ' + a.contains);
                await this.syncSheetFor(btn, fast);
                const r = btn.getBoundingClientRect();
                await this.moveCursor({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, fast);
                this.pulse();
                btn.click();
                // 適用箇所の選択待ちになったら、候補の原子をクリックして確定する
                if (window.reactor && window.reactor.picking) {
                    const sites = window.reactor.picking.sites;
                    const target = g.userMolecule.atoms.find(at => sites.some(s => s.includes(at.id)));
                    if (target) {
                        // 適用箇所はキャンバス上なので、シートを閉じてから指す
                        await this.setSheetOpen(false, fast);
                        const cl = this.svgPoint(target.x, target.y);
                        await this.moveCursor(cl, fast);
                        this.pulse();
                        svg.dispatchEvent(this.pe('pointerdown', cl));
                        window.dispatchEvent(this.pe('pointerup', cl));
                    }
                }
                await this.sleep(fast ? 0 : 700);
                break;
            }
            case 'wheel': {
                const cl = this.svgPoint(a.x, a.y);
                await this.moveCursor(cl, fast);
                for (let i = 0; i < (fast ? 1 : 5); i++) {
                    svg.dispatchEvent(new WheelEvent('wheel', {
                        bubbles: true, cancelable: true, ctrlKey: !!a.ctrl,
                        deltaY: a.deltaY, clientX: cl.clientX, clientY: cl.clientY
                    }));
                    await this.sleep(fast ? 0 : 90);
                }
                await this.sleep(fast ? 0 : 400);
                break;
            }
            case 'pan': {
                // 右ボタンドラッグによるパン（2本指スクロール相当）
                const from = this.svgPoint(a.from.x, a.from.y);
                const to = this.svgPoint(a.to.x, a.to.y);
                await this.moveCursor(from, fast);
                this.pulse();
                svg.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
                    button: 2, clientX: from.clientX, clientY: from.clientY
                }));
                const N = fast ? 2 : 5;
                for (let i = 1; i <= N; i++) {
                    const cl = {
                        clientX: from.clientX + (to.clientX - from.clientX) * i / N,
                        clientY: from.clientY + (to.clientY - from.clientY) * i / N
                    };
                    await this.moveCursor(cl, fast, 70);
                    svg.dispatchEvent(this.pe('pointermove', cl));
                }
                window.dispatchEvent(new PointerEvent('pointerup', {
                    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
                    button: 2, clientX: to.clientX, clientY: to.clientY
                }));
                await this.sleep(fast ? 0 : 450);
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
                await this.sleep(fast ? 0 : 450);
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
        await this.sleep(fast ? 0 : durationMs + 40);
    }

    sleep(ms) {
        // 高速モード（回帰テスト）はタイマーを使わずマイクロタスクで進める。
        // バックグラウンドのタブではタイマーが最大1秒程度に抑制されるため、
        // 待機のたびに数百ミリ秒〜1秒を消費してテストが極端に遅くなる（P9-6 M2で判明）
        if (ms <= 0) return Promise.resolve();
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
