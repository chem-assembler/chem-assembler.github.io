/**
 * 端末エミュレーションでの表示検査（Node で実行。ブラウザの手動操作は不要）
 *
 *   node tools/check-mobile.mjs                  … 全アプリ・4端末
 *   node tools/check-mobile.mjs ratio            … アプリを1つに絞る
 *   node tools/check-mobile.mjs --shots out/     … スクリーンショットも保存する
 *
 * Playwright の端末プロファイル（画面幅・DPR・タッチ・モバイルUA）で各ページを開いて測る。
 * 依存は tools/record/ の Playwright を借りる（追加インストール不要）。
 * 配信サーバーは自分で立てて自分で止めるので、事前準備は要らない。
 *
 * なぜこれが要るか:
 *   Claude のブラウザペインは、非表示のとき `document.hidden === true` になり
 *   **描画のライフサイクルごと止まる**。resize も ResizeObserver も
 *   requestAnimationFrame も配られないため、「画面幅を変えたときの追随」を
 *   あの環境では検証できない（無関係な要素を JS で 100px→250px に変えても
 *   ResizeObserver の callback が0回、で確認済み）。
 *   ここは実際に描画が回るので、その手の検証ができる。
 *
 * 検査項目:
 *   1. ページ本体が横スクロールしないか（scrollWidth > clientWidth）
 *   2. はみ出している要素が、**横スクロールできる枠の中にあるか**
 *      枠の外＝黙って切り落とされている、または本体を押し広げている ＝ 不合格。
 *      帯（ステージ選択・3行表・単元表）のように、枠の中で送るのは設計どおりなので合格
 *   3. ヘッダーが画面の高さをどれだけ占めるか（20%を超えたら警告）
 *   4. JS のエラーが出ていないか
 *
 * 終了コード 0 = 合格、1 = 問題あり
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'tools/record/'));
let playwright;
try {
    playwright = require('playwright');
} catch (e) {
    console.error('Playwright が見つかりません。tools/record で `npm install` を1度だけ実行してください。');
    process.exit(1);
}
const { chromium, devices } = playwright;

// --- 引数 ---
const args = process.argv.slice(2);
let shotsDir = null;
const shotIdx = args.indexOf('--shots');
if (shotIdx >= 0) { shotsDir = args[shotIdx + 1] || 'shots'; args.splice(shotIdx, 2); }
const only = args[0] || null;

const DEVICES = ['iPhone SE', 'iPhone 13', 'iPad (gen 7)', 'iPad Pro 11'];
const PAGES = [
    ['hub', '/'],
    ['ion-equation', '/ion-equation/'],
    ['ion-equation', '/ion-equation/redox.html'],
    ['ion-equation', '/ion-equation/condition.html'],
    ['ion-equation', '/ion-equation/library.html'],
    ['ion-equation', '/ion-equation/portal.html'],
    ['ratio', '/ratio/'],
    ['ratio', '/ratio/proportion.html'],
    ['ratio', '/ratio/stoich.html'],
    ['ratio', '/ratio/titration.html'],
    ['ratio', '/ratio/thermo.html'],
    ['ratio', '/ratio/balance.html'],
    ['muki', '/muki/'],
    ['qa', '/qa/'],
    ['assembler', '/assembler/'],
];
const pages = PAGES.filter(([app]) => !only || app === only);
if (!pages.length) {
    console.error(`アプリ「${only}」に対応するページがありません。指定できるのは: ${[...new Set(PAGES.map(p => p[0]))].join(' / ')}`);
    process.exit(1);
}

// --- ページの中で走る測定 ---
function measure() {
    const de = document.documentElement;
    // はみ出している要素を集め、横に送れる祖先があるかを見る
    const escaped = [];   // 送れる枠の外にはみ出している＝問題
    const inBand = [];    // 枠の中で送っている＝設計どおり
    document.querySelectorAll('body *').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.right <= de.clientWidth + 1) return;
        let scroller = null;
        for (let n = e.parentElement; n && n !== de; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth) { scroller = n; break; }
            if (ox === 'hidden' && n.scrollWidth > n.clientWidth) break; // 黙って切られている
        }
        const label = (e.id ? '#' + e.id : e.tagName +
            (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')) +
            ' right=' + Math.round(r.right);
        (scroller ? inBand : escaped).push(label);
    });
    const header = document.querySelector('header') || document.getElementById('header');
    return {
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        dpr: window.devicePixelRatio, touch: 'ontouchstart' in window, hidden: document.hidden,
        headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
        winH: window.innerHeight,
        escaped: escaped.slice(0, 8), escapedCount: escaped.length, inBandCount: inBand.length,
    };
}

// --- 配信サーバー（自分で立てて自分で止める） ---
const freePort = () => new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const port = await freePort();
const server = spawn('python', ['-m', 'http.server', String(port)], { cwd: ROOT, stdio: 'ignore' });
const BASE = `http://localhost:${port}`;
const stop = () => { try { server.kill(); } catch (e) { /* noop */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 700));

if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const problems = [];
const warnings = [];
const browser = await chromium.launch();

for (const devName of DEVICES) {
    const ctx = await browser.newContext({ ...devices[devName] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
    for (const [app, url] of pages) {
        const where = `${devName} ${url}`;
        try {
            await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 20000 });
            await page.waitForTimeout(250);
            const m = await page.evaluate(measure);
            if (shotsDir) {
                await page.screenshot({
                    path: path.join(shotsDir, `${url.replace(/[^\w]+/g, '_')}__${devName.replace(/[^\w]+/g, '-')}.png`),
                });
            }
            if (m.scrollW > m.clientW) {
                problems.push(`${where}: ページ本体が横スクロールします（${m.scrollW} > ${m.clientW}）`);
            }
            if (m.escapedCount) {
                problems.push(`${where}: 横に送れる枠の外にはみ出している要素が ${m.escapedCount} 件 — ${m.escaped.join(' / ')}`);
            }
            if (m.headerH != null && m.headerH / m.winH > 0.20) {
                warnings.push(`${where}: ヘッダーが画面の ${Math.round(m.headerH / m.winH * 100)}%（${m.headerH}px / ${m.winH}px）`);
            }
            if (errors.length) {
                problems.push(`${where}: JS エラー — ${errors.splice(0).join(' / ')}`);
            }
        } catch (e) {
            problems.push(`${where}: 開けません — ${String(e).slice(0, 140)}`);
        }
    }
    await ctx.close();
}
await browser.close();
stop();

console.log(`検査したページ: ${pages.length} 件 × 端末 ${DEVICES.length} 種（${DEVICES.join(' / ')}）`);
if (shotsDir) console.log(`スクリーンショット: ${path.resolve(shotsDir)}`);
if (warnings.length) {
    console.log(`\n△ 警告 ${warnings.length} 件（不合格ではない）:`);
    warnings.forEach((w) => console.log('  - ' + w));
}
if (problems.length) {
    console.log(`\n❌ ${problems.length} 件の問題:`);
    problems.forEach((p) => console.log('  - ' + p));
    process.exit(1);
}
console.log('\n✅ 不合格の問題はありません');
