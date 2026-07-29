/**
 * 録画モードの自動収録（P13-3 / 設計: DESIGN_recording_mode.md §5）
 *
 * アプリを縦型ビューポートで開き、?rec= のデモが完走するまでを動画に収める。
 * 画面録画をユーザーが手で回す必要がなくなる。
 *
 * 使い方（リポジトリルートで）:
 *   node tools/record/record.mjs --demo=intro-draw --speed=1.1
 *   node tools/record/record.mjs --demo=intro-draw --format=wide --caption=0
 *
 * 主なオプション（既定値は下の ARGS 参照）:
 *   --demo    デモID（demos.json / tutorials.json の id）
 *   --format  short（1080x1920・既定）/ wide（1920x1080）
 *   --speed   再生速度倍率
 *   --caption 1（既定）/ 0（テロップを焼かない。後編集する場合）
 *   --cursor  touch（既定）/ mouse / none
 *   --base    収録対象のURL基点（既定: http://localhost:8125/assembler/）
 *   --out     出力先ディレクトリ（既定: video-scripts/out）
 *
 * 事前に静的サーバーが必要:
 *   python -m http.server 8125     （リポジトリルートで）
 *
 * 出力: <out>/<demo>-<format>.webm
 *   Playwright の録画は webm。mp4 化と音声合成は mux.mjs で行う。
 */
import { chromium } from 'playwright';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ARGS = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k, v = '1'] = a.slice(2).split('='); return [k, v]; })
);

const demo = ARGS.demo || 'intro-draw';
const format = ARGS.format === 'wide' ? 'wide' : 'short';
const speed = ARGS.speed || '1';
const caption = ARGS.caption ?? '1';
const cursor = ARGS.cursor || 'touch';
const base = ARGS.base || 'http://localhost:8125/assembler/';
const outDir = ARGS.out || path.join('video-scripts', 'out');

/**
 * 収録サイズの決め方（2026-07-29 に実収録で判明した2つの制約）:
 *  1. **viewport を 1080 幅にすると、アプリのモバイル判定（max-width:899px）を超えて
 *     デスクトップの3カラムのまま縦に潰れる**。short では 899px 未満に収める必要がある
 *  2. **Playwright の録画は CSS ピクセル基準**。deviceScaleFactor を上げても録画解像度は
 *     上がらず、recordVideo.size を viewport より大きくしても余白が入るだけで拡大されない
 * → short は「899px 未満で最大」の 810x1440（9:16）で撮り、
 *   最終的な 1080x1920 への拡大は mux.mjs（ffmpeg・lanczos）で行う。
 */
const size = format === 'short' ? { width: 810, height: 1440 } : { width: 1920, height: 1080 };
const viewport = size;
const dsf = 1;

const url = `${base}?rec=${encodeURIComponent(demo)}&format=${format}` +
            `&speed=${speed}&caption=${caption}&cursor=${cursor}&delay=1200`;

const tmpDir = path.join(outDir, '.tmp');
await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });

console.log(`[record] ${url}`);
console.log(`[record] viewport ${viewport.width}x${viewport.height} @${dsf}x → ${size.width}x${size.height}`);

// 効果音を置く位置の基準。context 作成＝録画開始とみなす（多少のずれは SE では問題にならない）
const recordStart = Date.now();
const browser = await chromium.launch();
const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dsf,
    recordVideo: { dir: tmpDir, size },
    // ショートはスマホで見る想定。タッチ環境として扱わせる（UIがモバイル配置になる）
    hasTouch: format === 'short',
    isMobile: format === 'short',
});
const page = await context.newPage();

const logs = [];
page.on('console', m => { if (m.text().startsWith('[rec]')) logs.push(m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded' });

// 完了シグナル（rec.js が window.__recState を loading→playing→done と進める）を待つ
await page.waitForFunction(
    () => window.__recState === 'done' || window.__recState === 'error',
    null, { timeout: 180000 }
);
const state = await page.evaluate(() => window.__recState);
const result = await page.evaluate(() => ({
    formula: window.game ? window.game.computeMolecularFormula() : null,
    name: (document.getElementById('compound-name') || {}).textContent || '',
    events: window.__recEvents || [],
}));

// 最終フレームを少し残す（切れ際が唐突にならないように）
await page.waitForTimeout(1200);

await context.close();   // ここで動画ファイルが確定する
await browser.close();

const files = (await readdir(tmpDir)).filter(f => f.endsWith('.webm'));
if (!files.length) {
    console.error('[record] 動画ファイルが生成されなかった');
    process.exit(1);
}
const dest = path.join(outDir, `${demo}-${format}.webm`);
await rm(dest, { force: true });
await rename(path.join(tmpDir, files[0]), dest);
await rm(tmpDir, { recursive: true, force: true });

// 効果音を置くための操作タイミング（秒）を書き出す。mux.mjs の --events で使う
const events = (result.events || []).map(e => ({
    at: +((e.t - recordStart) / 1000).toFixed(2),
    type: e.type,
}));
const evPath = path.join(outDir, `${demo}-${format}.events.json`);
await writeFile(evPath, JSON.stringify(events, null, 1), 'utf8');

console.log(`[record] state=${state} ${logs.join(' / ')}`);
console.log(`[record] 結末: ${result.formula} ${result.name}`);
console.log(`[record] 操作 ${events.length} 件 → ${evPath}`);
console.log(`[record] 出力: ${dest}`);
if (state !== 'done') process.exit(2);
