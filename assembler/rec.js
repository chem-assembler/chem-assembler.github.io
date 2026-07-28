/**
 * 録画モード（P13-1 / 設計: DESIGN_recording_mode.md）
 * URL パラメータ ?rec=<demo-id> があるときだけ動く、SNS素材収録用の自動再生層。
 * パラメータが無ければ何もしない（通常利用・回帰テスト・夜間監査に影響ゼロ）。
 * 再生エンジンは新設せず、チュートリアル（TutorialPlayer）をそのまま駆動する。
 *
 * パラメータ（レンズ共通規約）:
 *   rec     デモID（tutorials.json の id）        必須
 *   speed   再生速度倍率（0.25〜4）               既定 1
 *   cursor  mouse | touch | none                  既定 touch（SNS視聴者はスマホ想定）
 *   caption 1 | 0（字幕の表示）                   既定 1
 *   delay   ロード完了から再生開始までの猶予 ms   既定 1000
 *
 * 進行状態は window.__recState（loading → playing → done / error）で外部の
 * 収録ツール（Playwright 等）に通知する。あわせて console にも [rec] を出す。
 */
(function () {
    const params = new URLSearchParams(window.location.search);
    const demoId = params.get('rec');
    if (!demoId) return;

    window.__recState = 'loading';

    // クリーン画面はスクリプト評価の時点で立てる（ヘッダー等の映り込みを防ぐ）
    document.documentElement.classList.add('recording');
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
            await player.play(demoId, { keepResult: true });
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
