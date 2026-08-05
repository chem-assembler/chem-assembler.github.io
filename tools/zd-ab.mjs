/**
 * 監査ファズを**同じ種の集合**で流し、0.0px と自動水素の重なりを数える（v736 の前後比較用）。
 *   node tools/zd-ab.mjs <port> <iterations> [opsCount] [baseSeed]
 * baseSeed を固定するため Date.now を差し替えてから開始ボタンを押す。
 */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/maequ/マイドライブ/Antigravity/OrganicChemistryPuzzle/tools/record/package.json');
const { chromium } = require('playwright');

const port = process.argv[2] || '8148';
const iterations = Number(process.argv[3] || 500);
const ops = Number(process.argv[4] || 80);
const baseSeed = Number(process.argv[5] || 3473418000) >>> 0;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/assembler/audit.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
    const f = document.getElementById('audit-frame');
    return f && f.contentWindow && f.contentWindow.appReady;
}, null, { timeout: 60000 });

await page.evaluate(([it, op, seed]) => {
    document.getElementById('mode-library').checked = false;
    document.getElementById('mode-fuzz').checked = true;
    document.getElementById('fuzz-iterations').value = String(it);
    document.getElementById('fuzz-ops').value = String(op);
    Date.now = () => seed;              // baseSeed を固定（両版で同じ種の集合になる）
    document.getElementById('btn-start').click();
}, [iterations, ops, baseSeed]);

await page.waitForFunction(() => {
    const r = window.auditReport && window.auditReport();
    return r && r.finishedAt;
}, null, { timeout: 3 * 60 * 60 * 1000, polling: 5000 });

const out = await page.evaluate(() => {
    const r = window.auditReport();
    const dist = {};
    let zero = 0, h115 = 0;
    r.records.forEach(rec => (rec.issues || []).forEach(is => {
        const m = String(is).match(/([0-9.]+)px$/);
        if (!m) return;
        const px = m[1];
        const key = (/自動水素/.test(is) ? 'H ' : '重原子 ') + px;
        dist[key] = (dist[key] || 0) + 1;
        if (/原子の重なり/.test(is) && +px === 0) zero++;
        if (/自動水素/.test(is) && px === '11.5') h115++;
    }));
    return { version: r.appVersion, counts: r.counts, summary: r.summary,
             zeroPx: zero, hydrogen115: h115,
             dist: Object.fromEntries(Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 14)) };
});
console.log(`port=${port} iterations=${iterations} ops=${ops} baseSeed=${baseSeed}`);
console.log(JSON.stringify(out, null, 1));
await browser.close();
