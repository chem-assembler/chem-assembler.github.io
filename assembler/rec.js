/**
 * 録画モード（P13-1 / 設計: DESIGN_recording_mode.md）
 * URL パラメータ ?rec=<demo-id> があるときだけ動く、SNS素材収録用の自動再生層。
 * パラメータが無ければ何もしない（通常利用・回帰テスト・夜間監査に影響ゼロ）。
 * 再生エンジンは新設せず、チュートリアル（TutorialPlayer）をそのまま駆動する。
 *
 * パラメータ（レンズ共通規約）:
 *   rec     デモID（demos.json または tutorials.json の id） 必須
 *   format  wide | short（short=縦型9:16向けのSNS字幕）      既定 wide
 *   speed   再生速度倍率（0.25〜4）                          既定 1
 *   cursor  mouse | touch | none                             既定 touch（SNS視聴者はスマホ想定）
 *   caption 1 | 0（字幕の表示）                              既定 1
 *   delay   ロード完了から再生開始までの猶予 ms              既定 1000
 *
 * デモの探索順: demos.json（SNS専用台本・P13-2）→ tutorials.json。
 * demos.json のエントリは tutorials.json と同スキーマ＋任意の
 *   state       serializeState 形式の開始状態（空キャンバスでなく途中から演技を始める）
 *   readStereo  true で「立体（D/L・α/β）を名前に反映する」を ON にしてから始める
 *               （既定 OFF。立体シリーズは ON でないと名称チップが「ほか3種 のどれか」になる）
 *
 * 進行状態は window.__recState（loading → playing → done / error）で外部の
 * 収録ツール（Playwright 等）に通知する。あわせて console にも [rec] を出す。
 */
(function () {
    /**
     * デモ台本のファイル一覧（2026-08-01 分割）。
     * **シリーズ（動画レーン）ごとに1ファイル**にしてある。SNS動画を複数レーンで並行制作すると、
     * 1つの demos.json に全レーンが末尾追記して毎回コンフリクトするため。
     * レーンは自分のファイルだけを触る＝この配列を編集するのは新しいレーンを作るときだけ。
     * 未作成のファイルがあってもよい（404 は無視して続行する）。
     * demos.json は分割前からある共有ぶん（V1/V2 など、どのシリーズにも属さない回）。
     */
    const DEMO_FILES = [
        'demos.json',
        'demos-isomer.json',    // 異性体シリーズ
        'demos-fg.json',        // 官能基シリーズ
        'demos-reaction.json',  // 反応シリーズ
        'demos-stereo.json',    // 立体シリーズ
        'demos-longform.json',  // 機能解説ロング（L1〜。SNS_LONG_PLAN.md）
        'demos-quiz.json',      // クイズ型と絞り込み（T1〜。出題範囲を変えるだけで量産できる型）
        'demos-build.json',     // 化合物作ってみた（V68〜。自由モードで有名化合物をゼロから組む）
    ];

    /**
     * 全ファイルのデモ台本を1つの配列にして返す（id が重複したら先勝ち）。
     * 回帰テスト（tests.js の N2）も同じ経路を使うので、**?rec= が無くても定義する**
     * ＝ この関数定義は下の早期 return より前に置くこと。
     */
    window.loadAllDemos = async function () {
        const all = [];
        for (const f of DEMO_FILES) {
            try {
                const res = await fetch(new URL(f, window.location.href).href, { cache: 'no-cache' });
                if (!res.ok) continue; // まだ作られていないレーンのファイル
                const list = await res.json();
                list.forEach(d => { if (!all.some(x => x.id === d.id)) all.push(d); });
            } catch (e) {
                console.warn('[rec] ' + f + ' のロードに失敗（このファイルは飛ばして続行）:', e);
            }
        }
        return all;
    };

    const params = new URLSearchParams(window.location.search);
    const demoId = params.get('rec');
    if (!demoId) return;

    window.__recState = 'loading';
    // 操作の発生時刻を記録する（収録ツールが効果音を置く位置に使う。P13-3）。
    // 壁時計（Date.now）で持ち、収録開始時刻との差分から動画内の位置を求める
    window.__recEvents = [];
    window.__recOnAction = (type) => window.__recEvents.push({ t: Date.now(), type });

    /**
     * ⚠ **綴りを間違えたパラメータを黙って既定へ落とさない**（vNNNN）。
     * `?rec=` の**知らない id** は前から `__recState='error'` で止まるが、
     * **見た目のつまみ（format / cursor / caption / speed）は黙って既定に落ちていた**
     * ＝ `?cursor=touchh` で撮ると「指カーソルのつもりが矢印」の素材が黙って上がる。
     * ★ ここは**止めない**（絵は撮れているので、止めるとかえって損をする）。
     *   警告だけ出して既定で続ける ＝ 収録ツールのログに残り、後から気づける。
     * ⚠ **パラメータが無いのは「指定していない」だけ**なので何も言わない
     *   （前方互換の黙りはそちら側）。
     */
    const warnParam = (key, allowed) => {
        const v = params.get(key);
        if (v !== null && v !== '' && !allowed.includes(v)) {
            console.warn(`[rec] ?${key}=${v} は知らない値です（使えるのは ${allowed.join(' / ')}）。既定で続けます。`);
        }
        return v;
    };
    // クリーン画面はスクリプト評価の時点で立てる（ヘッダー等の映り込みを防ぐ）
    document.documentElement.classList.add('recording');
    if (warnParam('format', ['wide', 'short']) === 'short') document.documentElement.classList.add('rec-short');
    const cursor = warnParam('cursor', ['mouse', 'touch', 'none']) || 'touch';
    if (cursor === 'none') document.documentElement.classList.add('rec-no-cursor');
    if (warnParam('caption', ['0', '1']) === '0') document.documentElement.classList.add('rec-no-caption');

    /**
     * ライブ収録支援（?rec=live・2026-08-04）。**人がその場で操作し、収録は OBS 等の外部ツール**。
     * 台本再生はせず、録画モードの見た目（クリーン画面）に加えて
     *   - タップ波紋（視聴者がどこを押したか追える。ゴーストカーソルの実弾版）
     *   - 任意のタップ音（&se=1。OBS がデスクトップ音声ごと録るので SE が同期済みで焼ける）
     * だけを提供する。実カーソルが主役なのでゴーストカーソルは出さない。
     * 録画の停止も人が行うため完了シグナルは出さず、__recState は 'playing' のまま。
     */
    if (demoId === 'live') {
        // 手動操作に要るボタン（全消去・官能基まとめ）をクリーン画面から戻す（style.css の .rec-live）
        document.documentElement.classList.add('rec-live');
        const seOn = params.get('se') === '1';
        let audioCtx = null;
        const tapSe = () => {
            try {
                // 波紋と同時に鳴らす短いタップ音。外部アセットに依存しないよう WebAudio で合成する
                audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
                const t0 = audioCtx.currentTime;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, t0);
                osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.08);
                gain.gain.setValueAtTime(0.22, t0);
                gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(t0);
                osc.stop(t0 + 0.1);
            } catch (e) { /* 音が出なくても収録は止めない */ }
        };
        document.addEventListener('pointerdown', (e) => {
            window.__recOnAction('tap');
            const ripple = document.createElement('div');
            ripple.className = 'rec-ripple';
            ripple.style.left = e.clientX + 'px';
            ripple.style.top = e.clientY + 'px';
            document.body.appendChild(ripple);
            setTimeout(() => ripple.remove(), 500);
            if (seOn) tapSe();
        }, true);
        (async () => {
            while (!window.appReady) await new Promise(r => setTimeout(r, 100));
            window.__recState = 'playing';
            console.log('[rec] live mode: 手動操作の収録支援（波紋' + (seOn ? '＋タップ音' : '') + '）');
        })();
        return;
    }

    // ⚠ 数のつまみも同じ（`?speed=x2` は数として読めず、黙って等速で撮れてしまう）
    const warnNumber = (key, raw, used) => {
        const v = params.get(key);
        if (v !== null && v !== '' && (!isFinite(raw) || raw !== used)) {
            console.warn(`[rec] ?${key}=${v} は使えないか範囲外です。${used} で続けます。`);
        }
    };
    const rawSpeed = parseFloat(params.get('speed'));
    const speed = Math.max(0.25, Math.min(4, rawSpeed || 1));
    warnNumber('speed', rawSpeed, speed);
    const rawDelay = parseInt(params.get('delay'), 10);
    const delay = Math.max(0, rawDelay || 1000);
    warnNumber('delay', rawDelay, delay);

    async function start() {
        // アプリ本体（appReady）とチュートリアルデータ（fire-and-forget ロード）の両方を待つ
        while (!(window.appReady && window.tutorialPlayer && window.tutorialPlayer.tutorials.length)) {
            await new Promise(r => setTimeout(r, 100));
        }
        const player = window.tutorialPlayer;
        // SNS専用台本（demos*.json）を再生リストへ合流させる。無くても既存チュートリアルで動く
        try {
            const demos = await window.loadAllDemos();
            demos.forEach(d => {
                if (!player.tutorials.some(x => x.id === d.id)) player.tutorials.push(d);
            });
        } catch (e) {
            console.warn('[rec] デモ台本のロードに失敗（tutorials.json のみで続行）:', e);
        }
        const t = player.tutorials.find(x => x.id === demoId && x.steps);
        if (!t) {
            console.error('[rec] demo not found: ' + demoId);
            window.__recState = 'error';
            return;
        }
        if (cursor === 'mouse' || cursor === 'touch') player.device = cursor;
        player.speedScale = speed;
        /**
         * **収録の頭はお題・設定シートを閉じた状態から始める**（2026-08-03）。
         * 縦型は既定でシートが開いており、最初の操作が右パネルのボタンだと
         * **冒頭 0.8秒が「設定パネルの文字びっしり」の絵**になる。
         * Shorts は最初の1秒で判断されるうえ、**カバー画像の候補もそこ**なので致命的だった
         * （V31 で実際に発生。V32・V33 も同型）。
         * `--trim` を手で指定して逃げると収録ごとのぶれに追随できないので、
         * **開始状態そのものを直す**。シートを使うデモは自分で開けばよい（`toggle` がある）。
         */
        document.body.classList.remove('sheet-open');
        /**
         * **台本が要る表示設定は、演技が始まる前に入れる**（2026-08-04）。
         *
         * 「立体（D/L・α/β）を名前に反映する」は **2026-08-02 から既定 OFF**
         * （初学者が直交で描いただけで「D-アラニン」と出て迷うため）。
         * ところが立体シリーズの回は、この設定が OFF だと名称チップが題材を指さない。
         * V50 は「D-乳酸」ではなく「乳酸」になる。
         * ⚠ **V12（変旋光）の理由は 2026-08-22 に変わった。** ハース環として描かれた図は
         * OFF でも α/β まで言い切るようになった（`lookupCompoundName` の「(1) 図から立体が
         * 決まっているか」）ので、**環の α/β-D-グルコピラノースは宣言が無くても読める**。
         * **それでも宣言は要る** —— この回は途中で**鎖状**（フィッシャー投影）を経由し、
         * そこは OFF だと「ガラクトース（鎖状）／グルコース（鎖状）ほか1種 のどれか」になる。
         * ＝ **落とすと回の真ん中だけが読めない絵になる**（頭とお尻は読める）。
         *
         * `toggle` アクションで台本から押すことはできるが、**演技が始まってからでは
         * 冒頭 1秒が誤った名前の絵になる**（頭出しは最初の操作に合わせるため）。
         * だから**台本の宣言**（`"readStereo": true`）として持ち、開始状態と同じ扱いにする。
         */
        if (t.readStereo && window.game && typeof window.game.setReadStereo === 'function') {
            window.game.setReadStereo(true);
        }
        await new Promise(r => setTimeout(r, delay));
        window.__recState = 'playing';
        console.log('[rec] playing ' + demoId);
        try {
            await player.play(demoId, { keepResult: true, initialState: t.state });
            window.__recState = 'done';
            console.log('[rec] done ' + demoId);
        } catch (e) {
            console.error('[rec] error:', e);
            window.__recState = 'error';
        } finally {
            player.speedScale = 1;
        }
    }
    start();
})();
