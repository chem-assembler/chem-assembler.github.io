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
        this.speedScale = 1; // 再生速度倍率。録画モード（rec.js / P13-1）が ?speed= で上書きする

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
        // 失敗を外から見えるようにする（再生は例外を握りつぶすので、これが無いと
        // 台本の陳腐化をテストで検出できない。2026-08-02）。
        // **早期 return より前で消すこと** … 後ろに置くと、再生されなかった回で
        // 前回の失敗が残り、無関係な台本の失敗として報告される
        this.lastError = null;
        if (this.running) return;
        const t = this.tutorials.find(x => x.id === id);
        if (!t || !t.steps) return; // 「よくある質問」項目は操作デモを持たない
        const g = this.game;
        this.running = true;
        this.aborted = false;

        if (window.reactionPlayer && window.reactionPlayer.active) window.reactionPlayer.exit();

        // 作図・履歴・選択状態を退避（終了/中断時に完全復元する）。
        // クイズの出題指定（`quizForce`）も退避する ＝ **台本の指定が次の台本へ漏れない**。
        // 漏れると、SNS デモを続けて再生する回帰テスト（N2）で前の指定が効いてしまう
        const saved = {
            state: g.serializeState(),
            history: [...g.history],
            redo: [...g.redoStack],
            atomType: g.selectedAtomType,
            forcedQuiz: window.quiz ? window.quiz.forced : undefined,
            forcedStereoQuiz: window.stereoQuiz ? window.stereoQuiz.forced : undefined
        };
        /**
         * **この再生ぶんの基準速度**（2026-08-11）。`speed` アクションはこれに掛け算する
         * ので、`?speed=` を変えても「ここは他より速い」という台本の意図が保たれる。
         * 再生の終わりに戻すため、**続けて再生しても前の台本の早送りが漏れない**
         * （SNS デモを続けて回す回帰テスト N2 が踏む）。
         */
        this.baseSpeedScale = this.speedScale || 1;
        this.buildOverlay();
        try {
            if (opts.initialState) {
                // 録画モード（P13-2）: 台本指定の開始状態から演技を始める（demos.json の state）
                g.restoreState(typeof opts.initialState === 'string'
                    ? JSON.parse(opts.initialState) : opts.initialState);
            } else {
                g.userMolecule = new Molecule();
                g.updateDrawing();
            }
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
            this.lastError = e;
            console.error('チュートリアル再生エラー:', e);
            g.showToast('デモの再生に失敗しました: ' + e.message);
        } finally {
            // 早送り（`speed` アクション）を基準速度へ戻す。**これを忘れると次の台本が
            // 前の台本の速度で走る**（N2 は SNS デモを続けて再生するので必ず踏む）
            this.speedScale = this.baseSpeedScale;
            // 出題の指定は keepResult の有無によらず戻す。**録画の最終フレームには
            // 影響しない**（次の問題を作らないため）一方、続けて再生すると次の台本に漏れる
            if (window.quiz && saved.forcedQuiz !== undefined) window.quiz.forced = saved.forcedQuiz;
            if (window.stereoQuiz && saved.forcedStereoQuiz !== undefined) {
                window.stereoQuiz.forced = saved.forcedStereoQuiz;
            }
            if (opts.keepResult) {
                // 録画モード（P13-1）: 最終フレームに結果を残すため、復元も後片付けもしない
                this.teardownOverlay();
                this.running = false;
            } else {
                // 反応機構モードやモーダルを開いたままにしない
                if (window.reactionPlayer && window.reactionPlayer.active) window.reactionPlayer.exit();
                // 右パネルのシートを閉じる後片付けは**要らなくなった**（第5段で右パネルごと消えた）
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
    /**
     * ⚠ **第5段で右パネルが消えたので、ここは「常に何もしない」に落ちる。**
     *
     * スマホでは右パネルがシート/ドロワーになっていたため、デモが右パネル内の要素を
     * 操作する前にシートを開き、キャンバス操作の前に閉じていた（P11-M3）。
     * 開く相手も、`body.sheet-open` を見る CSS も無くなった。
     *
     * **メソッドは消さずに残す**（DESIGN_ribbon_consolidation.md 第5段）。
     * 呼び出し元は `doAction` と `summon` ＝ `?rec=` の無人再生が必ず通る道で、
     * ここを消して呼び出し側も全部直すのは、この段でいちばん触りたくない場所への手入れになる。
     * 無害化して置いておけば、台本49本の再生経路は1行も変わらない。
     */

    isMobileLayout() {
        return window.matchMedia('(max-width: 899px)').matches;
    }

    async setSheetOpen(open, fast) {
        if (open) return;               // 開く相手（右パネル）はもう無い
        if (!this.isMobileLayout()) return;
        if (!document.body.classList.contains('sheet-open')) return;
        document.body.classList.remove('sheet-open');
        await this.sleep(fast ? 0 : 350);
    }

    // 対象要素はもうシートの中に入らない ＝ 常に「開かない」
    async syncSheetFor(el, fast) {
        await this.setSheetOpen(false, fast);
    }

    /**
     * **見えないボタンのためにシートを開かない**（2026-08-04・v502）。
     *
     * 隠れた要素（モードで `display:none` にした帯・閉じた `<details>` の中）は
     * 矩形が 0 なので、もともと**カーソル演出を省いてクリックだけ実行**している。
     * ところがシートの開閉だけは要素の位置と無関係に走っていたため、
     * **見せる相手がいないのにシートが開き、冒頭 0.6秒が「設定パネルの文字びっしり」の絵**になっていた。
     * SNS の縦動画は最初の1秒で判断され、カバー画像の候補もそこなので、これは致命的だった
     * （V15・V52 で実際に発生。学習タブとアコーディオンを踏まずにクイズを直接開く入り方は、
     * 手数は減っていたのにシートだけは開いていた）。
     *
     * **閉じるほうは従来どおり**にする（隠れていても、キャンバスを見せる場面では閉じたい）。
     * 開かない条件は「右パネルの中にあって、かつ矩形が 0」＝ **開いても見えない場合だけ**。
     * シートが横に逃げているだけの要素（`translateY(105%)`）は矩形を持つので影響しない。
     *
     * ⚠ **第5段（右パネル撤去）でこの手当ては役目を終えた。** 右パネルが無いので
     * `closest('#right-panel')` は常に null ＝ 判定するまでもなく「開かない」。
     * `syncSheetFor` と同じ理由で**メソッドは残す**（呼び出し元は `?rec=` の再生経路）。
     */
    async syncSheetForButton(el, fast) {
        await this.syncSheetFor(el, fast);
    }

    async doAction(a, fast) {
        const g = this.game;
        const svg = g.svg;
        // 録画モード（P13-3）が効果音の位置を拾うためのフック。通常利用では未定義で何もしない
        if (window.__recOnAction) window.__recOnAction(a.type);
        // キャンバス上で行うアクションの前はシートを閉じる（描画が見えるように）
        if (['click', 'hover', 'clickBond', 'cutBond', 'wheel', 'pan', 'drag', 'frame'].includes(a.type)) {
            await this.setSheetOpen(false, fast);
        }
        switch (a.type) {
            case 'wait':
                await this.sleep(fast ? 0 : a.ms);
                break;
            case 'speed': {
                /**
                 * **途中から早送りする**（2026-08-11。「化合物作ってみた」の大きい分子用）。
                 *
                 * `?speed=` は収録ぜんぶに掛かる1つの値なので、**同じ回の中で
                 * 「ここだけ速く」ができなかった**。重原子が20個を超える分子は、
                 * 手順が同じ作業（メチル基を何本も置く・鎖を伸ばす）で尺を食う。
                 * そこだけ速めれば、話の芯に使える時間を削らずに済む。
                 *
                 * `value` は**基準速度の何倍か**（掛け算）。`?speed=2` の収録で
                 * `{"type":"speed","value":2}` を置くと、そこから実速度は4倍になる。
                 * こう決めたのは、**収録の速度を変えても台本の意図（ここは他より速い）が
                 * 保たれる**ようにするため。`value` を省くか 1 にすると基準へ戻る。
                 *
                 * ⚠ **`wait` も同じだけ割られる**。早送りの区間で「静止させたい秒数」を
                 * 保ちたければ、その `wait` を倍率ぶん大きく書く。
                 * 画面には何も起きないので、カーソルもパルスも動かさない。
                 */
                this.speedScale = (this.baseSpeedScale || 1) * (Number(a.value) || 1);
                break;
            }
            case 'undo':
                g.undo();
                await this.sleep(fast ? 0 : 500);
                break;
            case 'button': {
                // `contains` を添えると、selector に当たるものの中から**文言で1つ選ぶ**。
                // id の無いボタンが並ぶ画面（絞り込みモードの実験カード 35枚など）で、
                // :nth-child に頼ると並びが変わった瞬間に別のカードを押してしまうため。
                const el = a.contains
                    ? [...document.querySelectorAll(a.selector)].find(b => b.textContent.includes(a.contains))
                    : document.querySelector(a.selector);
                if (!el) throw new Error('ボタンが見つかりません: ' + a.selector
                    + (a.contains ? `（"${a.contains}" を含むもの）` : ''));
                await this.syncSheetForButton(el, fast);
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
            case 'quizForce': {
                // クイズの出題を指定する（ORDER_stereo_puzzle.md の追加依頼・2026-08-03）。
                // **クイズを開くより前の手順に置くこと**（開いた時点で1問目が出るため）。
                // `quiz` は 'same'（🎓 同じ化合物？）か 'stereo'（立体異性体クイズ）、
                // `value` は前者が 'same'/'diff'、後者が 'same'/'enantiomer'/'diastereomer'。
                // 画面には何も起きないので、カーソルもパルスも動かさない
                // 2026-08-09: **名前で出題そのものを指定する**口を足した。
                // `value` の代わりに `name`（命名クイズ）／`pair`（同じ？違う？）を渡す。
                // 範囲を絞っても出題は抽選のままなので、ナレーションが範囲に踏み込んだ話を
                // すると想定外の分子が出た瞬間に嘘になる（V63 で置換基のないナフタレンが出た）。
                if (a.name || a.pair) {
                    const q = a.quiz === 'same' ? window.quiz : window.namingQuiz;
                    if (!q) throw new Error('出題を指定できるクイズがありません: ' + a.quiz);
                    if (a.pair) {
                        if (typeof q.setForcedPair !== 'function') {
                            throw new Error('ペア指定に対応していません: ' + a.quiz);
                        }
                        q.setForcedPair(a.pair[0], a.pair[1]);
                    } else {
                        if (typeof q.setForced !== 'function') {
                            throw new Error('名前指定に対応していません: ' + a.quiz);
                        }
                        q.setForced(a.name);
                    }
                    break;
                }
                const owner = a.quiz === 'stereo' ? window.stereoQuiz : window.quiz;
                if (!owner || typeof owner.setForced !== 'function') {
                    throw new Error('出題を指定できるクイズがありません: ' + a.quiz);
                }
                owner.setForced(a.value);
                if (owner.forced !== a.value) {
                    throw new Error('出題の指定が受け付けられません: ' + a.value);
                }
                break;
            }
            case 'quizAnswer': {
                // **正解の選択肢を押す**（2026-08-09）。出題が乱数のクイズを撮り直しなしで収録するため。
                // `quizForce` は出題そのものを指定するが、命名クイズ・総数当てには
                // 指定の口が無く（問題は毎回ライブラリから抽選される）、
                // そちらは「何が出ても正解を押す」ほうが台本を書ける。
                //
                // **答えを外す回を撮りたいときは使わない**（誤答は文言で普通に押せる）。
                const kind = a.quiz || 'naming';
                const owner = kind === 'count' ? window.countQuiz : window.namingQuiz;
                if (!owner || !owner.current) throw new Error('出題中のクイズがありません: ' + kind);
                // 正解の文言は、命名は化合物名・総数当ては「N 種類」
                const want = kind === 'count'
                    ? String(owner.current.count)
                    : owner.current.entry.name;
                const box = document.getElementById(kind === 'count' ? 'cq-choices' : 'naming-choices');
                const btn = [...box.querySelectorAll('button')].find(b => kind === 'count'
                    ? b.textContent.replace(/[^\d]/g, '') === want
                    : b.textContent === want);
                if (!btn) throw new Error('正解の選択肢が見つかりません: ' + want);
                const rb = btn.getBoundingClientRect();
                if (rb.width > 0) {
                    await this.moveCursor({ clientX: rb.left + rb.width / 2, clientY: rb.top + rb.height / 2 }, fast);
                    this.pulse();
                }
                btn.click();
                await this.sleep(fast ? 0 : 450);
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
            case 'frame': {
                // 構図づくり（SNS収録用・DESIGN_recording_mode.md §3）。指定した論理座標を
                // 中心に viewBox を張り直し、被写体を画面中央へ・任意の大きさで見せる。
                // ホイールの積み上げと違って一発で決まるので、収録のたびに構図が揺れない。
                // 高さは fitCanvasToMolecule と同じ 4:3 で決める（アプリの視野の慣習）。
                const bounds = g.userMolecule.atoms.length
                    ? g.calculateTargetBounds(g.userMolecule) : null;
                const box = svg.viewBox.baseVal;
                const cx = (a.cx !== undefined) ? a.cx
                    : (bounds ? (bounds.minX + bounds.maxX) / 2 : box.x + box.width / 2);
                const cy = (a.cy !== undefined) ? a.cy
                    : (bounds ? (bounds.minY + bounds.maxY) / 2 : box.y + box.height / 2);
                const w = a.width || box.width;
                const h = w * 3 / 4;
                svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
                await this.sleep(fast ? 0 : 250);
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
        durationMs = durationMs / (this.speedScale || 1);
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
        ms = ms / (this.speedScale || 1);
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
