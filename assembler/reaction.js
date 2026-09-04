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
        /* ⚠⚠ **v1513 で 📚 学習の ⚗️ 反応機構ビューアの札を撤去した**
           （ユーザー決定 2026-09-03「消す方がすっきりすると思います」。機構は 📖 資料の4枚目へ）。
           ★ **この3つ（箱・スイッチ・一覧）は DOM から消えたので、いつも null になる。**
             使う側はすべて null を見て素通りする ＝ 再生器そのものは1行も変えていない。
           ⚠ **`this.selectEl`（選択の実体）だけは残っている**（`#ws-reaction` の中へ移した）——
             `?open=mechanism&id=` も 📖 資料の ▶ も `pick()`/`openById()` からここへ合流する。
           ★ 一覧の描画（`populateList` / `syncList` / `promptPick`）は**そのまま残してある** ——
             どれも `listEl` を見て素通りするので害が無く、消すと「一覧をどう組んでいたか」の
             記録（v1439 の押しもの化・v1466 の促し）まで消える。 */
        this.box = document.getElementById('reaction-box');            // ⚠ v1513 以降つねに null
        this.checkMode = document.getElementById('check-reaction-mode'); // ⚠ 同上
        this.selectEl = document.getElementById('select-reaction');    // ★ 残っている（帯の中）
        this.listEl = document.getElementById('reaction-list');        // ⚠ v1513 以降つねに null
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
        // いま出している練習問題（`reactions.json` の `practice`）と、その正解の集合（v1466）
        this.practice = null;
        this.practiceTargets = [];

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
        this.populateList();
    }

    /**
     * ★ 人が押す一覧を作る（v1439・ユーザー実機報告「反応の種類が選べない、すぐ選択される」）。
     *
     * **症状の正体**: 一覧が `<select>` だった。`<select>` の `change` は
     * 「選び終えた」ではなく**「値が動いた」**で飛ぶ ―― 閉じた select の上下キー、
     * iOS のホイールピッカーの回転が、そのまま `enter()`（＝キャンバスを取り上げて
     * メニューを閉じる）まで走る。実測（:8240・Playwright・chromium）:
     * ```
     * ② select にフォーカス     active=false           （まだ何も選んでいない）
     * ③ ↓ を1回押した           active=true / methane_chlorination / メニュー閉じる / 焦点=BODY
     * ④⑤ ↓ をさらに13回         何も起きない（焦点が無い）＝ **2件目より先へ1件も進めない**
     * ```
     * v1379 で「一覧から選ぶだけで始まる」を繋いだこと自体は正しく、
     * **`<select>` に載せたことだけが行き過ぎ**だった（＝「選ぶ前に始まる」）。
     *
     * ⚠ **見た目の仕掛けは増やさない。** クイズの群（`.quiz-group` / `.quiz-group-head` /
     *   `.secondary-btn`）をそのまま借りる。ユーザーの言葉どおり「反応の**種類**」で束ねる
     *  （14件を8つの系列に分ける ＝ 何があるのかが畳まずに読める）。
     */
    populateList() {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';
        const btnStyle = 'background:var(--color-bg); border:1px solid var(--neon-purple); ' +
            'color:#e0b0ff; cursor:pointer; text-align:left;';
        // 系列は**最初に出てきた順**でまとめる（reactions.json の並びは系列順ではない）
        const series = [];
        this.reactions.forEach(r => { if (!series.includes(r.series)) series.push(r.series); });
        series.forEach(name => {
            const members = this.reactions
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.series === name);
            const group = document.createElement('div');
            group.className = 'quiz-group';
            const head = document.createElement('div');
            head.className = 'quiz-group-head';
            head.textContent = name;
            const count = document.createElement('span');
            count.textContent = `${members.length}件`;
            head.appendChild(count);
            group.appendChild(head);
            members.forEach(({ r, i }) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'secondary-btn';
                b.style.cssText = btnStyle;
                b.dataset.rxIndex = String(i);
                b.dataset.rxId = r.id;
                b.textContent = r.name;
                b.addEventListener('click', () => this.pick(i));
                group.appendChild(b);
            });
            this.listEl.appendChild(group);
        });
        this.syncList();
    }

    /**
     * 一覧の1件を**確定する**（押しものから呼ばれる唯一の口）。
     * ⚠ 直に `enter()` を呼ばず、**`#select-reaction` の値を決めて `change` を撃つ**。
     *   `?open=mechanism&id=` も回帰テスト（RX24）もこの1本に合流していて、
     *   入口が増えても「選ばれているのはどれか」を持つ場所は1つのまま。
     */
    pick(index) {
        if (this.animating) return;
        this.selectEl.value = String(index);
        this.selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /** いま選ばれている1件に印を付ける（選択の実体は `#select-reaction` のまま） */
    syncList() {
        if (!this.listEl) return;
        const cur = String(this.selectEl.value);
        this.listEl.querySelectorAll('button[data-rx-index]').forEach(b => {
            const on = this.active && b.dataset.rxIndex === cur;
            b.setAttribute('aria-current', on ? 'true' : 'false');
            b.style.boxShadow = on ? 'inset 0 0 0 2px var(--neon-blue)' : '';
        });
    }

    /**
     * ★ 一覧へ促す（v1466・ユーザー実機報告「反応機構ビューアを選択すると、反応の選択をすっとばす」）。
     *
     * スイッチを入れただけの人に**14件の一覧があること**を見せる。案内は一覧の直前に置く
     *（`#reaction-list` の中の先頭）＝ 押す先の真上に出るので、読んでから目を落とせば札がある。
     * ⚠ 器は reaction.js が作る（`index.html` に新しい id を足さない）。
     */
    promptPick() {
        if (!this.listEl) return;
        if (this.box) this.box.open = true; // 畳んだまま促しても札が見えない
        let hint = this.listEl.querySelector('#rx-pick-hint');
        if (!hint) {
            hint = document.createElement('p');
            hint.id = 'rx-pick-hint';
            hint.setAttribute('role', 'status');
            hint.style.cssText = 'margin:0 0 6px; font-size:11.5px; line-height:1.5; ' +
                'color:#ffd0e6; border:1px solid var(--neon-pink, #ff2a85); border-radius:6px; padding:6px 8px;';
            this.listEl.insertBefore(hint, this.listEl.firstChild);
        }
        hint.textContent = 'まず、下の一覧から反応を選んでください（選んだ時点で始まります）。上のスイッチは、始めた反応を終えるためのものです。';
        hint.classList.remove('hidden');
        if (hint.scrollIntoView) hint.scrollIntoView({ block: 'nearest' });
    }

    /** 一覧の促しを下ろす（反応が決まったら役目は終わり） */
    clearPickPrompt() {
        const hint = this.listEl && this.listEl.querySelector('#rx-pick-hint');
        if (hint) hint.classList.add('hidden');
    }

    initEvents() {
        /**
         * ★ **スイッチは入口ではない**（v1466・ユーザー実機報告「反応の選択をすっとばす」）。
         *
         * **実測した症状**（:8221・Playwright chromium。📚 学習 → ⚗️ 見出し → スイッチ）:
         * ```
         * ② ⚗️ 見出しを押す   active=false / 一覧=見える（14件）
         * ③ スイッチを押す     active=true / cur=ethene_br2 / 帯=出る / メニュー=閉じる
         *                     ＝ **一覧を1件も選ばせないまま先頭の反応が始まる**
         * ```
         * 原因は `enter(parseInt(this.selectEl.value) || 0)` ―― `#select-reaction` の値は
         * 初期状態でも `"0"`（＝ 1件目）なので、**何も選んでいない人の代わりに先頭を選んでいた**。
         * しかもスイッチは一覧より**上**にあり、押すと `enter()` が Study を閉じる（§11）ので、
         * **一覧が存在することにすら気づけない**。
         *
         * ⚠ 「1件しか無いから飛ばしている」のではない（実測で一覧は 14件そろっている）。
         *    **選択を代行していた**のが誤り。§9〜§11 で入口は「一覧から選ぶ」1本に定めてあり、
         *    §9 の「出口はスイッチのまま」は v1399（§10）で取り下げ済み ＝
         *    **スイッチに残っている役目は「終える」だけ**。
         *
         * ⚠ **`enter()` の `checkMode.checked = true` は `change` を撃たない**（プログラムからの
         *    代入はイベントを起こさない）ので、表示の追従（§9）は今までどおり通る。
         *    それでも `this.active` を先に見て素通りさせる ＝ 将来 `dispatchEvent` で
         *    追従させる書き方に変わっても、ここが反応を選び直さない。
         */
        if (this.checkMode) this.checkMode.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (this.active) return; // enter() が立てた表示の追従。始め直さない
                e.target.checked = false; // 「入っている」と見せない（状態を2つに割らない）
                this.promptPick();
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
                /* ⚠ v1513 以前は「ただし `#reaction-box`（ビューア自身の一覧）は除く」という
                   但し書きがここに在った。**その箱ごと撤去した**ので、いま `#study-body` の中に
                   ビューアの持ちものは1つも無い ＝ 例外なしで返してよい。
                   ★ 📖 資料の ▶ は `#ref-body`（資料ペイン＝ `#study-body` の外）なので、
                     ここには届かない ＝ 機構から機構へ移るときにビューアが終わってしまうことはない。 */
                if (!btn) return;
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
        const index = this.reactions[reactionIndex] ? reactionIndex : 0;
        this.currentReaction = this.reactions[index];
        this.active = true;
        if (this.checkMode) this.checkMode.checked = true;
        this.clearPickPrompt(); // 選べたのだから促しは役目を終える（v1466）
        this.syncPredictButton();
        // 選択の実体（`#select-reaction`）と一覧の印を、どの入口から来ても合わせる
        this.selectEl.value = String(index);
        this.syncList();
        // ★ キャンバスをビューアのものにする（人の作業は退避。反応を選び直しても借り直さない）。
        //   ここが無いと、自分の分子が userMolecule に残ったまま反応の絵が描かれ、
        //   次に updateDrawing() が走った瞬間（スクロール・パン・ズーム）に混ざる
        this.borrowCanvas();
        // ★ 「🎯 反応させる分子を選ぶ」が残っていたら下ろす（v1409）。
        //   ビューアは `currentMode` を変えないので（自由モードから一覧を選んだだけで始まる・v1379）、
        //   `setMode` に置いた出口はこの経路に**届かない**。残ったまま 🎯 予測 へ入ると、
        //   `blocksEditing()` が false でも `handleMouseDown` の選択分岐が先に食って**1原子も置けない**
        if (this.game.deactivateReactionSelectMode) this.game.deactivateReactionSelectMode();
        // ★ 帯の「↩ 反応前に戻す」を引っ込める（v1409）。`#ws-free` は自由モードのあいだ
        //   出たままなので、ビューアを開くと**2枚の帯が並び、札も画面に残る** ——
        //   指す先（自分の分子）は退避されて見えていないのに押せてしまう。
        //   ⚠ ここで呼ぶ必要がある: `enter()` は `updateDrawing()` を通らない
        //     （`goto()` が反応の絵を直接描く）ので、描き直し側の手当てだけでは届かない
        if (window.reactor && window.reactor.syncUndoButton) window.reactor.syncUndoButton();
        // ステップ送りはキャンバスの上の作業帯に出す（DESIGN_ribbon_consolidation.md 第3段）。
        // 巻矢印は本体 SVG に描くので、操作をシートの中に置いておくと
        // 「開いて押す → 閉じて見る」の往復になっていた
        this.game.setWorkPane('ws-reaction', true);
        // ★ キャンバスを取り上げた以上、それを覆っているメニューは自分で下げる（v1439）。
        //   Study の handoff（`setupStudyModal`）は「この一押しでキャンバスの側が動いたか」で
        //   決めるようになったので、**同じ反応をもう一度選び直した**ときだけ何も動かず残ってしまう。
        //   持ち主がはっきりしている経路は、持ち主が言うのがいちばん確か
        if (this.game.setStudyOpen) this.game.setStudyOpen(false);
        this.game.clearUIOverlay();
        this.fitToReaction();
        this.goto(0);
    }

    // パズルモードへ戻る
    exit() {
        this.stopRequested = true; // 再生中なら中断
        if (this.prediction) this.endPrediction(false);
        this.active = false;
        if (this.checkMode) this.checkMode.checked = false;
        this.syncList();
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
        // 再生中は一覧も押せなくする（select と同じ約束を押しもの側にも掛ける・v1439）
        if (this.listEl) {
            this.listEl.querySelectorAll('button[data-rx-index]')
                .forEach(b => { b.disabled = !enabled; });
        }
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

    // ===== 生成物予測モード（M4 → v1466 で「別の分子で」に作り直し） =====

    /**
     * ★ 出題は「**同じ反応を、別の分子に起こしたらどうなるか**」（v1466・ユーザー実機報告）。
     *
     * **なぜ作り直したか**: それまでの予測は「いま見た代表例の主生成物を組み立てよ」だった。
     * 人は直前にその反応を最後まで**再生して答えを見ている**（`goto(steps.length)` が
     * 生成物を描く）ので、**さっき見せた答えをもう一度聞いている** ＝ 問いとして成立していない。
     *
     * `reactions.json` の `practice` が出題の中身:
     * ```json
     * "practice": { "rule": "add_br2", "substrate": ["プロペン（プロピレン）"] }
     * ```
     * - `substrate` … キャンバスに置く**別の分子**（`compounds.json` / `stages.json` の名前）
     * - `rule` … `reactor.js` の `REACTION_RULES` の id。**正解はここを実際に走らせて出す**
     *   ＝ 生成物の構造を手で書き写さない（書き写すと、反応ルールを直したとき静かにずれる）
     * - `answers` … ルールが無い機構用の逃げ道（ライブラリの**名前**で正解を書く）
     *
     * ⚠ **`practice` を持たない機構は 🎯 予測を出さない。** 出せば「見た答えの復唱」に戻る。
     */
    practiceSpec() {
        const p = this.currentReaction && this.currentReaction.practice;
        return (p && (p.rule || (p.answers && p.answers.length))) ? p : null;
    }

    /**
     * ★ 🎯 予測は「練習問題を持つ機構」だけに出す（v1466）。
     *
     * `practice` の無い機構（ラジカル置換・ジアゾ化・カップリング。**どれも `reactor.js` に
     * 反応ルールが無く、別の分子を当てられない**）で出すと、
     * **直前に再生して見た代表例の答えをもう一度聞く**だけになる ＝ 問いとして成立しない。
     * 押せない札を出しておくより、**出さない**方が正直。
     */
    syncPredictButton() {
        if (!this.btnPredict) return;
        this.btnPredict.classList.toggle('hidden', !this.practiceSpec());
    }

    /** ライブラリ（stages.json ＋ compounds.json）から名前で1件引く */
    libraryEntry(name) {
        const src = (typeof STAGES !== 'undefined' ? STAGES : [])
            .concat(typeof COMPOUNDS !== 'undefined' ? COMPOUNDS : []);
        return src.find(e => e && e.name === name && e.target) || null;
    }

    /** 名前の並びから、キャンバスに置く分子を1つ作る（2分子はタテに離して置く） */
    buildFromNames(names) {
        const m = new Molecule();
        let dy = 0;
        for (const name of names) {
            const e = this.libraryEntry(name);
            if (!e) return null;
            const src = this.game.createTargetFromData({ target: e.target });
            const map = new Map();
            src.atoms.forEach(a => map.set(a.id, m.addAtom(a.element, a.x, a.y + dy).id));
            src.bonds.forEach(b => m.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type));
            dy += 260; // 相手の分子と重ならない間隔（エステル化は2分子を並べる）
        }
        return m;
    }

    /** 分子の「最大の重原子連結成分」だけを取り出した新しい分子（＝主生成物の物差し） */
    mainComponent(mol) {
        const heavy = mol.atoms.filter(a => a.element !== 'H');
        const seen = new Set();
        const comps = [];
        heavy.forEach(a => {
            if (seen.has(a.id)) return;
            const comp = [];
            const stack = [a.id];
            while (stack.length) {
                const id = stack.pop();
                if (seen.has(id)) continue;
                seen.add(id);
                comp.push(id);
                mol.getNeighbors(id).forEach(n => {
                    if (n.atom.element !== 'H' && !seen.has(n.atom.id)) stack.push(n.atom.id);
                });
            }
            comps.push(comp);
        });
        comps.sort((a, b) => b.length - a.length);
        const keep = new Set(comps[0] || []);
        const out = new Molecule();
        const map = new Map();
        mol.atoms.forEach(a => { if (keep.has(a.id)) map.set(a.id, out.addAtom(a.element, a.x, a.y).id); });
        mol.bonds.forEach(b => {
            if (map.has(b.atomId1) && map.has(b.atomId2)) out.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
        });
        return out;
    }

    /**
     * 出題の**正解の集合**を作る。返すのは分子の配列（どれか1つに合えば正解）。
     *
     * ⚠ **集合であることが要る。** トルエンのニトロ化は o と p の2通りがどちらも主生成物で、
     *   1つだけを正解にすると**正しい答えが不正解になる**。
     * ⚠ **メタは入れない。** `aromaticSiteRole()`（reactor.js・RX10 が見張っている規則層）が
     *   `major` を教えてくれるので、**判断できるときは主生成物の位置だけ**を正解にする
     *  （ベンゼンのように置換基が無い環では `null` が返るので、そのときは全箇所が正解）。
     */
    practiceAnswers(spec) {
        // (a) 名前で書かれた正解（反応ルールを持たない機構の逃げ道）
        if (!spec.rule) {
            return (spec.answers || []).map(n => {
                const m = this.buildFromNames([n]);
                return m ? this.mainComponent(m) : null;
            }).filter(Boolean);
        }
        // (b) 反応ルールを実際に走らせて出す（構造を手で書き写さない）
        const rules = (typeof REACTION_RULES !== 'undefined') ? REACTION_RULES : [];
        const rule = rules.find(r => r.id === spec.rule);
        if (!rule) return [];
        const g = this.game;
        const saved = { m: g.userMolecule, h: g.history, r: g.redoStack };
        const out = [];
        try {
            // 主生成物の位置だけに絞る（芳香族置換の配向性。判断できないときは全部）
            const majors = (mol, sites) => {
                if (typeof aromaticSiteRole !== 'function') return sites;
                const roles = sites.map(s => {
                    try { return Array.isArray(s) ? aromaticSiteRole(mol, s[0]) : null; } catch (e) { return null; }
                });
                if (!roles.every(r => r)) return sites; // 1つでも判断できなければ絞らない
                const only = sites.filter((s, i) => roles[i].major);
                return only.length ? only : sites;
            };
            const probe0 = this.buildFromNames(spec.substrate || []);
            if (!probe0) return [];
            let count = 0;
            try { count = majors(probe0, rule.detect(probe0, g) || []).length; } catch (e) { return []; }
            for (let i = 0; i < count; i++) {
                // 箇所ごとに**まっさらな基質**から作り直す（apply は分子を書き換える）
                const probe = this.buildFromNames(spec.substrate || []);
                if (!probe) break;
                g.userMolecule = probe;
                g.history = [];
                g.redoStack = [];
                let sites = [];
                try { sites = majors(probe, rule.detect(probe, g) || []); } catch (e) { break; }
                if (!sites[i]) continue;
                try { rule.apply(g, sites[i]); } catch (e) { continue; }
                out.push(this.mainComponent(g.userMolecule));
            }
        } finally {
            g.userMolecule = saved.m;
            g.history = saved.h;
            g.redoStack = saved.r;
        }
        return out;
    }

    /**
     * 予測モード開始。
     *
     * ★ **反応する分子はキャンバスに出す**（v1466・ユーザー指示「反応する分子はキャンバスに表示する」）。
     *   それまでは**キャンバスを空にして**組み立てさせていたので、
     *   **何から何への予測かが画面から消えていた**（v1409 で案内文に名前を足したのはその手当てだったが、
     *   言葉で名乗るのと図が出ているのは別のこと）。
     *   いまは別の分子をそのまま置き、**その図を描き変えて**生成物にしてもらう。
     */
    startPrediction() {
        if (!this.active || this.animating || this.prediction) return;
        const spec = this.practiceSpec();
        this.practice = spec;
        this.practiceTargets = spec ? this.practiceAnswers(spec) : [];
        // 正解が1つも作れなかったら出題しない（黙って「常に不正解」にしない）
        if (spec && !this.practiceTargets.length) {
            this.game.showToast('この反応の練習問題を用意できませんでした（データを確認してください）', 4000, 'error');
            this.practice = null;
            return;
        }
        this.prediction = true;

        // 組み立て用にキャンバスを載せ替える。**退避は enter() で済んでいる**
        // （borrowCanvas は2度目を無視する）ので、ここでは載せ替えるだけ。
        // 載せ替えたぶん「持ち主の目印」も更新する ＝ 予測を作った分子を
        // 「別の作業に取られた」と誤認しない
        this.borrowCanvas();
        this.borrowedMolecule = (spec && this.buildFromNames(spec.substrate || [])) || new Molecule();
        this.game.userMolecule = this.borrowedMolecule;
        this.game.history = [];
        this.game.redoStack = [];
        this.clearArrows();
        this.game.updateDrawing();

        this.renderPredictionCaption();
        this.stepLabelEl.textContent = '🎯 生成物予測モード';
        this.btnPredict.classList.add('hidden');
        this.btnJudge.classList.remove('hidden');
        this.btnCancelPredict.classList.remove('hidden');
        // 帯の出口は 🎯 予測 と入れ替わりで引っ込む（v1399）。
        // 予測中は隣に「やめる（予測をやめる）」が出るので、**同じ札が2つ並ばない**ようにする。
        // ビューアごと出たい人は、予測をやめてからもう一度押せばよい（枠も増えない）
        if (this.btnExit) this.btnExit.classList.add('hidden');
        this.setControlsEnabled(false);
        // ★ 視野は**置いた分子**に合わせる（v1466）。`fitToReaction()` は代表例の全状態に
        //   合わせるので、別の分子を置いたときに画面の外や端に寄る
        if (spec) this.fitToMolecule(this.borrowedMolecule);
        else this.fitToReaction();
    }

    /** 分子が収まる視野にする（予測で置いた基質を画面いっぱいに見せる） */
    fitToMolecule(mol) {
        const atoms = mol && mol.atoms.length ? mol.atoms : null;
        if (!atoms || !this.game.svg) { this.fitToReaction(); return; }
        const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        // 描き足すぶんの余白を大きめに取る（生成物は元より大きくなる）
        let viewW = Math.max(420, (maxX - minX) + 320);
        let viewH = Math.max(315, (maxY - minY) + 260);
        if (viewW / viewH > 4 / 3) { viewH = viewW * 3 / 4; } else { viewW = viewH * 4 / 3; }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        this.game.svg.setAttribute('viewBox', `${cx - viewW / 2} ${cy - viewH / 2} ${viewW} ${viewH}`);
    }

    /**
     * 予測モードの案内文（v1409・ユーザー申し立て「何に対する（反応物は何？）予想なのかが不明瞭」）。
     *
     * **症状**: 予測に入るとキャンバスが空になるので、**何から何への予測かが画面から消える**。
     * 案内は「この反応の主生成物を…」と書いてあるが、その「この反応」を指すものが
     * どこにも残っていない（一覧は `#study-body` の中で、モーダルは閉じている）。
     *
     * ⚠ **帯の高さは増やさない。** 反応名は `#reaction-step-label` ではなく
     *    **案内文の先頭**へ入れる —— あちらは `white-space:nowrap; flex:0 0 auto` なので、
     *    長い名前（「酢酸とエタノールのエステル化」）を入れると 199px を占め、
     *    案内文が 136px まで潰れる（実測）。案内文は `max-height:2.9em` で頭打ちの
     *    伸び縮みする側なので、名前を先頭に置けば**必ず最初に読める**まま高さが動かない。
     */
    renderPredictionCaption() {
        const el = this.captionEl;
        el.textContent = '';
        const subject = document.createElement('strong');
        subject.className = 'rx-predict-subject';
        subject.textContent = '【' + this.predictionSubject() + '】';
        el.appendChild(subject);
        /* ★ 「同じ反応を、別の分子に起こしたら」（v1466）。⚠ **お題（反応名）は先頭のまま**
           ―― 案内文は `max-height:2.9em` で頭打ちなので、名前を先頭に置けば必ず最初に読める。
           別の分子の名前はそのすぐ後ろ ＝ 「何を」「どうする」の順で1行に収まる。 */
        const spec = this.practice;
        if (spec) {
            const names = (spec.substrate || []).join(' ＋ ');
            el.appendChild(document.createTextNode(
                `と同じ反応を、キャンバスの ${names} に起こすと？ ` +
                'この図を描き変えて主生成物にし、「判定」を押しましょう。' +
                '副生成物（水・HClなど）は残しても構いません。'));
        } else {
            el.appendChild(document.createTextNode(
                'の主生成物（有機化合物）を組み立てて「判定」を押しましょう。副生成物（水・HClなど）は不要です。'));
        }
        el.scrollTop = 0; // 頭出し（前のステップの説明でスクロールしていても名前から読ませる）
    }

    /**
     * 予測の「お題」として見せる反応の名前。
     *
     * ⚠ **末尾の「（…生成）」は落とす。** `reactions.json` の `name` は14件中6件が
     *    「エタノールの分子内脱水（**エテン生成**）」のように**答えそのもの**を抱えている。
     *    そのまま出すと、予測のお題が答えを配ることになる。
     * ⚠ 落とすのは「生成」で終わる括弧だけ ＝「（酸触媒）」「（ラジカル置換）」
     *   「（塩基による加水分解）」は残す（どれも条件・分類で、答えではない）。
     *    語尾で見分ける規則は将来のデータで破れうるので、**RX32 が全件を機械で見張る**
     *   （主生成物の化合物名がお題に混ざっていたら赤くなる）。
     */
    predictionSubject() {
        const raw = (this.currentReaction && this.currentReaction.name) || '';
        const trimmed = raw.replace(/(?:\s*[（(][^（()）]*生成[）)])+\s*$/, '').trim();
        return trimmed || raw;
    }

    /**
     * 予測の判定: 最終状態の主生成物（最大の重原子連結成分）と比較する。
     *
     * ★ **結果は `game.showToast()` で出す**（v1466・ユーザー実機報告
     *   「生成物予測　判定が機能してない可能性」）。
     *
     * **実測した症状**（:8221・Playwright）: **判定そのものは 14件すべてで正しく働いていた**
     *（正解を入れれば success・メタン1個を入れれば error・空でも error）。
     * 壊れていたのは**結果の出し先**で、ここだけが `#verify-result` に直に書いていた ――
     * あれは第5段で `#panel-legacy`（`aria-hidden`）の中の**隠しの互換の器**になっており、
     * 実測の矩形は **1280x900 でも 390x844 でも `0,0 26x626`**（左上の 26px 幅の縦帯）。
     * ＝ **押しても何も出ないように見える**。
     *
     * ⚠ **自前で `#verify-result` を触らない。** `showToast()` はキャンバス内の字幕
     *  （`#canvas-toast`・§2-7 で主役）と互換の器の**両方**へ書き、消すタイマーも1本で持つ。
     *   ここで直接書くと、字幕に出ないうえに `_toastTimer` と競って消し合う。
     */
    judgePrediction() {
        if (!this.prediction) return;
        /* ★ 出題が「別の分子」のときは、その正解の**集合**と突き合わせる（v1466）。
           ⚠ **人の側も「最大の重原子連結成分」で見る。** 基質をキャンバスに置いた以上、
             とれた水や HCl が図に残るのが自然で、丸ごと比べると正しい答えが不正解になる
             （案内文も「副生成物は残しても構いません」と言っている）。 */
        const targets = (this.practice && this.practiceTargets && this.practiceTargets.length)
            ? this.practiceTargets
            : [this.buildMainProductTarget()];
        const mine = this.practice ? this.mainComponent(this.game.userMolecule) : this.game.userMolecule;
        const correct = targets.some(t => verifyMolecule(mine, t));

        this.game.showToast(
            correct
                ? '正解です！反応の主生成物を正しく予測できました！'
                : '不一致です。反応をもう一度再生して、結合の組み換えを確認してみましょう。',
            4000,
            correct ? 'success' : 'error');
        if (correct) {
            // 正解したら答え（最終状態）を表示して予測モードを終える
            this.endPrediction(true);
        }
    }

    // 予測モード終了。showAnswer=true なら最終状態を表示する
    endPrediction(showAnswer) {
        if (!this.prediction) return;
        this.prediction = false;
        this.practice = null;
        this.practiceTargets = [];

        // ⚠ ここでパズル分子を戻さない。**キャンバスの持ち主はビューアのまま**で、
        //   人の答案は exit() が返すまで退避したままにする（退避場所は1本なので、
        //   ここで戻すと exit() のときに戻すものが無くなる）。予測の作りかけだけ捨てる
        this.borrowedMolecule = new Molecule();
        this.game.userMolecule = this.borrowedMolecule;
        this.game.history = [];
        this.game.redoStack = [];
        this.game.clearUIOverlay();

        this.syncPredictButton(); // 練習問題を持たない機構では 🎯 予測 を出さない（v1466）
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
