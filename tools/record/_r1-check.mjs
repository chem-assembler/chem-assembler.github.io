// R1 台本の主張を実機で照合する（L2 の「台本と実際が違う」事故を繰り返さないため）
import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:8137/assembler/?open=reference&code=org.ali.alkane-names', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const before = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ref-table tr, .ref-body table tr')]
        .map(tr => [...tr.querySelectorAll('th,td')].map(c => c.innerText.trim()).join(' | '))
        .filter(Boolean);
    const btn = [...document.querySelectorAll('button, a')].find(b => /組んでみる/.test(b.innerText));
    const pane = document.querySelector('#reference-pane, .ref-pane');
    return {
        表の行数: rows.length,
        表: rows,
        例題ボタン: btn ? btn.innerText.replace(/\s+/g, ' ').trim() : null,
        ペイン幅: pane ? Math.round(pane.getBoundingClientRect().width) : null,
        お題: (document.getElementById('stage-title') || {}).textContent || '(なし)',
    };
});
console.log('■ 押す前');
console.log('  表の行数:', before.表の行数);
for (const r of before.表) console.log('   ', r);
console.log('  例題ボタン:', JSON.stringify(before.例題ボタン));
console.log('  ペイン幅:', before.ペイン幅, '/ お題:', before.お題.slice(0, 40));

await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, a')].find(x => /組んでみる/.test(x.innerText));
    if (b) b.click();
});
await page.waitForTimeout(2500);

const after = await page.evaluate(() => {
    const pane = document.querySelector('#reference-pane, .ref-pane');
    const w = pane ? Math.round(pane.getBoundingClientRect().width) : null;
    return {
        ペイン幅: w,
        資料は閉じたか: !w,
        お題: (document.getElementById('stage-title') || {}).textContent || '(なし)',
        モード: (document.querySelector('.mode-tab.active') || {}).textContent || '?',
        本文: (document.getElementById('stage-desc') || {}).textContent || '',
    };
});
console.log('■ ▶ を押した後');
console.log('  ペイン幅:', after.ペイン幅, '→ 資料は閉じたか:', after.資料は閉じたか ? 'はい' : 'いいえ（開いたまま）');
console.log('  お題:', after.お題.slice(0, 60));
console.log('  モード:', after.モード.trim(), '/ 説明:', after.本文.slice(0, 60));
await browser.close();
