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
 * demos.json のエントリは tutorials.json と同スキーマ＋任意の `state`
 * （serializeState 形式の開始状態。空キャンバスでなく途中から演技を始める）
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

    // クリーン画面はスクリプト評価の時点で立てる（ヘッダー等の映り込みを防ぐ）
    document.documentElement.classList.add('recording');
    if (params.get('format') === 'short') document.documentElement.classList.add('rec-short');
    const cursor = params.get('cursor') || 'touch';
    if (cursor === 'none') document.documentElement.classList.add('rec-no-cursor');
    if (params.get('caption') === '0') document.documentElement.classList.add('rec-no-caption');

    const speed = Math.max(0.25, Math.min(4, parseFloat(params.get('speed')) || 1));
    const delay = Math.max(0, parseInt(params.get('delay'), 10) || 1000);

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
