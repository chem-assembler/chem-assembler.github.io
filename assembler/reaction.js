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
        this.btnPredict = document.getElementById('btn-rx-predict');
        this.btnJudge = document.getElementById('btn-rx-judge');
        this.btnCancelPredict = document.getElementById('btn-rx-cancel-predict');
        this.btnExit = document.getElementById('btn-rx-exit'); // 帯の出口（v1399・DESIGN_reaction_mechanism.md §10）

        // 再生アニメーションの状態
        this.animating = false;
        this.stopRequested = false;

        // 生成物予測モード（M4）: パズルUIで主生成物を組み立てて判定する
        this.prediction = false;

        // ===== キャンバスの持ち主（v1374・DESIGN_reaction_mechanism.md §7） =====
        // ビューアが開いているあいだ、キャンバス（userMolecule と履歴と視野）はビューアのもの。
        // 入るときに人の作業を退避し、出るときに戻す。**予測モードの退避もこの1組に統合した**
        // （退避場所が1つしかないので、入れ子で二重に退避すると人の答案が消える）
        this.canvasBorrowed = false;
        this.savedPuzzleMolecule = null; // 借りているあいだ預かるパズルの作業分子
        this.savedHistory = null;        // 「元に戻す」履歴（見ただけで練習の履歴を失わせない）
        this.savedRedoStack = null;
        this.savedViewBox = null;        // 借りる前の視野（戻したとき答案が画面外に居ないように）
        this.borrowedMolecule = null;    // 借りているあいだキャンバスに置いた空の分子（同一性の目印）

        this.initEvents();
    }

    // 反応モード中にパズル編集をブロックするか（予測モード中は編集を許可する）
    blocksEditing() {
        return this.active && !this.prediction;
    }

    /**
     * いまキャンバス（SVG の絵）の持ち主がビューアか。
     * 編集をブロックする条件とわざと同じにしてある ＝ **描けないなら、その絵はビューアのもの**。
     * `game.updateDrawing()` はこれを見て、自分の分子ではなく反応の絵を描き直す。
     */
    ownsCanvas() {
        return this.active && !this.prediction;
    }

    /**
     * キャンバスを借りる（＝人の作業を退避して空にする）。**何度呼んでも1回しか借りない。**
     * `enter` → `startPrediction` の入れ子で二重に退避すると、2度目が「空の分子」を
     * 上書き保存して答案が消える（退避場所は1本しかない）。
     */
    borrowCanvas() {
        if (this.canvasBorrowed) return;
        this.canvasBorrowed = true;
        this.savedPuzzleMolecule = this.game.userMolecule;
        this.savedHistory = this.game.history;
        this.savedRedoStack = this.game.redoStack;
        this.savedViewBox = this.game.svg ? this.game.svg.getAttribute('viewBox') : null;
        this.borrowedMolecule = new Molecule();
        this.game.userMolecule = this.borrowedMolecule;
        this.game.history = [];
        this.game.redoStack = [];
    }

    /**
     * キャンバスを返す（＝退避した作業を戻す）。借りていなければ何もしない。
     *
     * ⚠ **借りているあいだに別の作業がキャンバスを取っていたら、そちらを優先する。**
     * 書き出し練習は「分子を空にする → 帯を出す」の順で始まるので、帯を見て
     * ビューアが出るときには既に新しい分子が載っている。ここで無条件に戻すと、
     * 始まったばかりの練習に前の絵が甦る。目印は**分子オブジェクトの同一性**
     * （借りたときに置いた空の分子がまだ載っているか）。
     */
    returnCanvas() {
        if (!this.canvasBorrowed) return;
        this.canvasBorrowed = false;
        const stillOurs = (this.game.userMolecule === this.borrowedMolecule);
        if (stillOurs) {
            this.game.userMolecule = this.savedPuzzleMolecule || new Molecule();
            this.game.history = this.savedHistory || [];
            this.game.redoStack = this.savedRedoStack || [];
            if (this.savedViewBox && this.game.svg) this.game.svg.setAttribute('viewBox', this.savedViewBox);
        }
        this.savedPuzzleMolecule = null;
        this.savedHistory = null;
        this.savedRedoStack = null;
        this.savedViewBox = null;
        this.borrowedMolecule = null;
        return stillOurs;
    }

    /**
     * 持ち主として絵を描き直す（`game.updateDrawing()` から呼ばれる）。
     * スクロール・パン・ズームは `updateDrawing()` を呼ぶので、ここが無いと
     * **反応の絵が消えて自分の分子（＝借りている空の分子）で塗り替えられる**。
     * 再生中はフレームの途中なので触らない。
     */
    redrawOwned() {
        if (!this.ownsCanvas() || !this.currentReaction || this.animating) return;
        this.goto(this.view);
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
        /**
         * ★ 一覧から反応を選んだら、それだけで始まる（発注書B・案1・v1379）。
         *
         * 以前はここに `if (this.active)` があり、**チェックが入るまで change を捨てていた**。
         * ところがすぐ下の案内文は「反応を選ぶと、ステップ送り（⏮ ▶ ⏭）はキャンバスの下に出ます」
         * と書いてあり、**選んでも何も起きない ＝ 壊れて見える**。実測（v1376）でも
         * 選んだだけでは `active=false` / 帯 `#ws-reaction` は隠れたままだった。
         *
         * `enter()` が `checkMode.checked = true` を立てるので、**スイッチの表示は自動で追従する**
         *（状態が2つに割れない）。チェックを外して止める出口は今までどおり残す。
         * `borrowCanvas()` は冪等なので、ここが新しい入口になっても退避は二重にならない
         *（`openById` が前から同じことをしている経路）。
         */
        this.selectEl.addEventListener('change', (e) => {
            this.enter(parseInt(e.target.value) || 0);
        });
        this.btnPrev.addEventListener('click', () => { if (!this.animating && !this.prediction) this.goto(this.view - 1); });
        this.btnNext.addEventListener('click', () => { if (!this.animating && !this.prediction) this.goto(this.view + 1); });
        // ↻ 最初から = **視野も最初から**（追加②の「規定値に戻す」明示の手段）。
        // 手順送り（⏮ ⏭）は視野を尊重するので、戻したい人はここを押す
        this.btnRestart.addEventListener('click', () => { if (!this.animating && !this.prediction) { this.fitToReaction(); this.goto(0); } });
        this.btnPlay.addEventListener('click', () => this.play());
        this.btnPredict.addEventListener('click', () => this.startPrediction());
        this.btnJudge.addEventListener('click', () => this.judgePrediction());
        this.btnCancelPredict.addEventListener('click', () => this.endPrediction(false));

        /**
         * ★ 帯からビューアを終える（v1399・DESIGN_reaction_mechanism.md §10）。
         *
         * **症状**: 出口が「📚 を開き直して『反応機構モード』のチェックを外す」しか無かった。
         * 帯にあるのは送り戻しだけなので、**見ている画面から抜ける道が1つも無い**
         *（v1392 で直した「学習の出口」と同じ系統）。
         *
         * ⚠ **別経路を作らない。** 既存の出口（チェックを外す・`setMode` が learn を離れる・
         *    `setWorkPane` が別の面を出す）と同じ `exit()` に合流させる ＝ 退避した答案を返す
         *    後始末が1か所にまとまったままになる。チェックの表示も `exit()` が下ろす
         *   （状態が2つに割れない・発注書 §B の受け入れ条件）。
         * ⚠ **終わったあとのモードはここで決めない。** `game.setupLearnExit()`（v1392）が
         *    「クリックの後始末が済んだ時点で学習の面が画面に1つも無ければ 🧪自由 へ」を
         *    見ているので、帯から終えた人はそのまま自由モードへ出る ＝ 答案が戻ったキャンバスを
         *    すぐ描き足せる。ここに `setMode` を書くと**同じ判断が2か所**になる。
         */
        if (this.btnExit) this.btnExit.addEventListener('click', () => this.exit());

        /**
         * ★ 別の学習を始めたらビューアは終わる（追加①）。
         *
         * モードタブ（🧪自由・🧩パズル）は `setMode` が `exit()` を呼ぶので抜けていたが、
         * **📚 学習の中で隣へ移る経路には出口が無かった** —— クイズを開いても
         * 書き出し練習を始めても `active` のままで、`blocksEditing()` が true のまま残る。
         * とくに書き出し練習は**始まったのに1画も描けない**（キャンバスが死んで見える）。
         *
         * 出口を**📚 のボタン1か所**にまとめる: `#study-body` の中のボタンが押されたら、
         * それが `#reaction-box`（ビューア自身の操作）でない限りキャンバスを返す。
         * アコーディオンの `summary` は「見出しを開くだけ」なので対象にしない。
         *
         * ⚠ **capture で聞く。** 相手の開始処理より先に返さないと、
         * 練習が空にしたキャンバスへ前の答案を戻してしまう
         * （順序が逆でも `returnCanvas` の同一性チェックが止めるが、二重に守る）。
         */
        const studyBody = document.getElementById('study-body');
        if (studyBody) {
            studyBody.addEventListener('click', (e) => {
                if (!this.active) return;
                const btn = e.target && e.target.closest ? e.target.closest('button') : null;
                if (!btn || btn.closest('#reaction-box')) return;
                this.exit();
            }, true);
        }
    }

    /**
     * 受け口④ `?open=mechanism&id=<機構id>`（DEVELOPMENT.md §7-1）。
     * 登録済み14件のうち1つを **`reactions.json` の `id`** で選んで開く。
     * 知らない id は**黙って無視**して false を返す（前方互換。箱は開いたままにする）。
     * 選択欄も同時に合わせる ＝ 開いた後に人が前後の機構へ移れる。
     */
    openById(id) {
        const q = String(id == null ? '' : id).trim();
        if (!q) return false;
        const index = this.reactions.findIndex(r => r.id === q);
        if (index < 0) return false;
        if (this.selectEl) this.selectEl.value = String(index);
        this.enter(index);
        return true;
    }

    // 反応機構モードに入る
    enter(reactionIndex) {
        if (!this.reactions.length) return;
        if (this.prediction) this.endPrediction(false);
        this.currentReaction = this.reactions[reactionIndex] || this.reactions[0];
        this.active = true;
        this.checkMode.checked = true;
        // ★ キャンバスをビューアのものにする（人の作業は退避。反応を選び直しても借り直さない）。
        //   ここが無いと、自分の分子が userMolecule に残ったまま反応の絵が描かれ、
        //   次に updateDrawing() が走った瞬間（スクロール・パン・ズーム）に混ざる
        this.borrowCanvas();
        // ★ 「🎯 反応させる分子を選ぶ」が残っていたら下ろす（v1403）。
        //   ビューアは `currentMode` を変えないので（自由モードから一覧を選んだだけで始まる・v1379）、
        //   `setMode` に置いた出口はこの経路に**届かない**。残ったまま 🎯 予測 へ入ると、
        //   `blocksEditing()` が false でも `handleMouseDown` の選択分岐が先に食って**1原子も置けない**
        if (this.game.deactivateReactionSelectMode) this.game.deactivateReactionSelectMode();
        // ステップ送りはキャンバスの上の作業帯に出す（DESIGN_ribbon_consolidation.md 第3段）。
        // 巻矢印は本体 SVG に描くので、操作をシートの中に置いておくと
        // 「開いて押す → 閉じて見る」の往復になっていた
        this.game.setWorkPane('ws-reaction', true);
        this.game.clearUIOverlay();
        this.fitToReaction();
        this.goto(0);
    }

    // パズルモードへ戻る
    exit() {
        this.stopRequested = true; // 再生中なら中断
        if (this.prediction) this.endPrediction(false);
        this.active = false;
        this.checkMode.checked = false;
        this.clearArrows();
        this.captionEl.textContent = '';
        this.stepLabelEl.textContent = '';
        this.game.setWorkPane('ws-reaction', false);
        // ★ キャンバスを返す（退避した答案・履歴・視野を戻す）。
        //   視野は**借りる前のもの**へ戻す ＝ 書き出し練習の答案が画面外に取り残されない。
        //   借りていなかった／別の作業に取られていたときだけ、従来どおりお題に合わせる
        const restored = this.returnCanvas();
        if (!restored) this.game.fitCanvasToTarget();
        this.game.updateDrawing();
    }

    // パズル側の操作（Undo / Redo / 全消去）から反応モードを解除する（検品レビュー 16・17）。
    // exit() と違い「解除すべきものが無ければ何もしない」ので、通常の編集で
    // 視野（fitCanvasToTarget）やキャプションを勝手に触らない。
    // 戻り値: 実際に解除・掃除したら true。
    deactivate() {
        // 生成物予測モード中の編集は正当なので解除しない（矢印もすでに消えている）
        if (this.prediction) return false;
        if (this.active) {
            this.exit();
            return true;
        }
        // モードは切れているのに矢印だけ残っている場合の掃除
        if (this.arrowsGroup && this.arrowsGroup.firstChild) {
            this.clearArrows();
            return true;
        }
        return false;
    }

    // 指定ビューを表示（0..steps.length）
    goto(view) {
        const steps = this.currentReaction.steps;
        this.view = Math.max(0, Math.min(steps.length, view));
        this.arrowsGroup.style.opacity = ''; // 遷移アニメで下げた透明度をリセット

        if (this.view < steps.length) {
            const step = steps[this.view];
            this.ensureVisible(this.currentReaction.states[step.from]);
            this.renderState(this.currentReaction.states[step.from]);
            this.renderArrows(step);
            this.captionEl.textContent = step.caption || '';
            this.stepLabelEl.textContent = `ステップ ${this.view + 1} / ${steps.length}`;
        } else {
            // 最終状態（矢印なし）
            const lastStep = steps[steps.length - 1];
            this.ensureVisible(this.currentReaction.states[lastStep.to]);
            this.renderState(this.currentReaction.states[lastStep.to]);
            this.clearArrows();
            this.captionEl.textContent = '反応完了。生成物の構造を確認しましょう。';
            this.stepLabelEl.textContent = `完了 (${steps.length} ステップ)`;
        }

        this.setControlsEnabled(!this.animating);
    }

    /**
     * 見失ったときだけ視野を反応へ戻す（追加②）。
     *
     * スクロールすると SVG の viewBox が動き、反応の絵はキャンバスの上の
     * 決まった座標に描かれるので**画面の外へ出たきり戻らない**（手順送りも ↻ も
     * 視野を触っていなかった）。
     *
     * ⚠ **毎回無条件に `fitToReaction()` を呼ばない。** 拡大して巻矢印の根元を
     * 見ている人の視野を、手順を送るたびに奪ってしまう。
     * 「1原子も視野に入っていない ＝ もう自分では戻せない」ときだけ助ける。
     * 自分の意思で戻したい人には ↻（最初から）が明示の手段として用意してある。
     */
    ensureVisible(state) {
        if (!state || !state.atoms || !this.game.svg) return false;
        const vb = (this.game.svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (vb.length !== 4 || vb.some(n => !isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
            this.fitToReaction();
            return true;
        }
        const [x, y, w, h] = vb;
        const inView = state.atoms.some(a => a.x >= x && a.x <= x + w && a.y >= y && a.y <= y + h);
        if (inView) return false;
        this.fitToReaction();
        return true;
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
        if (!this.currentReaction || !this.active || this.prediction) return;
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

    // duration(ms) かけて onFrame(t: 0→1) を呼ぶ。再生中断は stopRequested を見る。
    // 共通ドライバ animateFramesLoop に委譲（reactor.js のモーフィングと共用。P12-5 第2弾）
    animateFrames(duration, onFrame) {
        return animateFramesLoop(duration, onFrame, () => this.stopRequested);
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

    // ===== 生成物予測モード（M4） =====

    // 予測モード開始: キャンバスを空にしてパズルUIで主生成物を組み立てさせる
    startPrediction() {
        if (!this.active || this.animating || this.prediction) return;
        this.prediction = true;

        // 組み立て用にキャンバスを空にする。**退避は enter() で済んでいる**
        // （borrowCanvas は2度目を無視する）ので、ここでは載せ替えるだけ。
        // 載せ替えたぶん「持ち主の目印」も更新する ＝ 予測を作った分子を
        // 「別の作業に取られた」と誤認しない
        this.borrowCanvas();
        this.borrowedMolecule = new Molecule();
        this.game.userMolecule = this.borrowedMolecule;
        this.game.history = [];
        this.game.redoStack = [];
        this.clearArrows();
        this.game.updateDrawing();

        this.captionEl.textContent = 'この反応の主生成物（有機化合物）を組み立てて「予測を判定」を押しましょう。副生成物（水・HClなど）は不要です。';
        this.stepLabelEl.textContent = '🎯 生成物予測モード';
        this.btnPredict.classList.add('hidden');
        this.btnJudge.classList.remove('hidden');
        this.btnCancelPredict.classList.remove('hidden');
        // 帯の出口は 🎯 予測 と入れ替わりで引っ込む（v1399）。
        // 予測中は隣に「やめる（予測をやめる）」が出るので、**同じ札が2つ並ばない**ようにする。
        // ビューアごと出たい人は、予測をやめてからもう一度押せばよい（枠も増えない）
        if (this.btnExit) this.btnExit.classList.add('hidden');
        this.setControlsEnabled(false);
        this.fitToReaction(); // 反応と同じ視野のまま組み立てさせる
    }

    // 予測の判定: 最終状態の主生成物（最大の重原子連結成分）と比較する
    judgePrediction() {
        if (!this.prediction) return;
        const target = this.buildMainProductTarget();
        const correct = verifyMolecule(this.game.userMolecule, target);

        const resultDiv = document.getElementById('verify-result');
        if (resultDiv) {
            resultDiv.textContent = correct
                ? '正解です！反応の主生成物を正しく予測できました！'
                : '不一致です。反応をもう一度再生して、結合の組み換えを確認してみましょう。';
            resultDiv.className = correct ? 'result-message success' : 'result-message error';
            resultDiv.classList.remove('hidden');
            setTimeout(() => resultDiv.classList.add('hidden'), 4000);
        }
        if (correct) {
            // 正解したら答え（最終状態）を表示して予測モードを終える
            this.endPrediction(true);
        }
    }

    // 予測モード終了。showAnswer=true なら最終状態を表示する
    endPrediction(showAnswer) {
        if (!this.prediction) return;
        this.prediction = false;

        // ⚠ ここでパズル分子を戻さない。**キャンバスの持ち主はビューアのまま**で、
        //   人の答案は exit() が返すまで退避したままにする（退避場所は1本なので、
        //   ここで戻すと exit() のときに戻すものが無くなる）。予測の作りかけだけ捨てる
        this.borrowedMolecule = new Molecule();
        this.game.userMolecule = this.borrowedMolecule;
        this.game.history = [];
        this.game.redoStack = [];
        this.game.clearUIOverlay();

        this.btnPredict.classList.remove('hidden');
        this.btnJudge.classList.add('hidden');
        this.btnCancelPredict.classList.add('hidden');
        if (this.btnExit) this.btnExit.classList.remove('hidden'); // 🎯 予測 と一緒に戻す（v1399）

        if (this.active) {
            this.fitToReaction();
            this.goto(showAnswer ? this.currentReaction.steps.length : this.view);
        }
    }

    // 最終状態から「主生成物」の検証用分子を構築する。
    // 明示水素は取り除き（自動水素の価標検証と整合させるため）、
    // 最大の重原子連結成分＝主生成物だけを残す。
    buildMainProductTarget() {
        const states = this.currentReaction.states;
        const state = states[states.length - 1];
        const m = new Molecule();
        const added = state.atoms.map(a => m.addAtom(a.element, a.x, a.y));
        state.bonds.forEach(b => m.addBond(added[b.atom1Index].id, added[b.atom2Index].id, b.type));

        // 明示水素を除去（除去後は空き価標が自動水素として扱われる）
        added.forEach((atom, i) => {
            if (state.atoms[i].element === 'H') m.removeAtom(atom.id);
        });

        // 連結成分に分解し、最大成分（主生成物）以外を除去
        const components = [];
        const seen = new Set();
        m.atoms.forEach(a => {
            if (seen.has(a.id)) return;
            const comp = [];
            const stack = [a.id];
            while (stack.length) {
                const id = stack.pop();
                if (seen.has(id)) continue;
                seen.add(id);
                comp.push(id);
                m.getNeighbors(id).forEach(n => { if (!seen.has(n.atom.id)) stack.push(n.atom.id); });
            }
            components.push(comp);
        });
        components.sort((a, b) => b.length - a.length);
        components.slice(1).forEach(comp => comp.forEach(id => m.removeAtom(id)));
        return m;
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

// フレーム駆動の共通ヘルパー（反応機構の状態遷移アニメと reactor.js のモーフィングで共用。P12-5 第2弾）。
// duration(ms) かけて onFrame(t: 0→1) を呼ぶ。isCancelled() が true を返したフレームで即座に解決する。
// タブが非表示のとき requestAnimationFrame は停止するため setTimeout にフォールバックする
// （再生中にタブを切り替えても固まらないようにするため）。
function animateFramesLoop(duration, onFrame, isCancelled) {
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
            if (isCancelled && isCancelled()) { resolve(); return; }
            const t = Math.min(1, (now - start) / duration);
            onFrame(t);
            if (t < 1) schedule(tick);
            else resolve();
        };
        schedule(tick);
    });
}

if (typeof window !== 'undefined') {
    window.animateFramesLoop = animateFramesLoop;
}
