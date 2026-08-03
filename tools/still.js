/**
 * 告知用の静止画を撮る。
 *
 *   node tools/still.js <URL> --out=<png> [--size=1200x675] [--wait=1500] [--dark]
 *   node tools/still.js /ratio/ --out=out.png              … 先頭が / ならローカルサーバ
 *
 * X の画像は **16:9（1200x675）** が既定。タイムラインで切られずに全体が見える比率。
 * Instagram に流すなら `--size=1080x1080`。
 *
 * **アプリの実画面を撮る**のが趣旨なので、加工はしない。
 * 構図を変えたいときは URL のクエリか、撮ったあとの切り抜きで調整する。
 */
const path = require('path');
const { chromium } = (() => {
    try { return require('playwright'); } catch (e) { /* 下で探す */ }
    try { return require(path.join(__dirname, 'record', 'node_modules', 'playwright')); }
    catch (e) {
        console.error('playwright が見つかりません。`cd tools/record && npm install` を実行してください');
        process.exit(1);
    }
})();

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const opt = k => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const out = opt('out');
if (!target || !out) {
    console.error('使い方: node tools/still.js <URL または /パス> --out=<png> [--size=1200x675] [--wait=1500]');
    process.exit(1);
}
const [w, h] = (opt('size') || '1200x675').split('x').map(Number);
const wait = Number(opt('wait') || 1500);
const base = opt('base') || 'http://localhost:8123';
const url = /^https?:/.test(target) ? target : base.replace(/\/$/, '') + target;

(async () => {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    try {
        await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
        console.error(`開けません: ${url}\n${e.message}`);
        await b.close();
        process.exit(1);
    }
    const scroll = Number(opt('scroll') || 0);
    if (scroll) { await p.evaluate(y => window.scrollTo(0, y), scroll); await p.waitForTimeout(400); }
    await p.waitForTimeout(wait);
    await p.screenshot({ path: out });
    console.log(`[still] ${url}\n        → ${out}（${w}x${h} @2x）`);
    await b.close();
})();
