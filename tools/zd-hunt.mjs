/**
 * 0.0px の完全重複（原子が同じ座標に置かれる）の発生源を探す診断ドライバ（v736）。
 *
 *   node tools/zd-hunt.mjs <baseSeed> <count> [opsCount] [audit.html の URL]
 *
 * **なぜ要るか**: 夜間監査の記録は「反復が終わったあとの分子」しか見ないので、
 * 重なりを**どの操作が作ったか**が分からない。ここは audit.js の `auditTrace` で
 * 1操作ごとに割り込み、0px の組が増えた瞬間の操作名を出す。
 * v736 の原因（原子の移動ドラッグが「置けない位置」へ落としていた）は、
 * これで 1種目にして `stretch` の中で起きていると分かった
 * （＝ 実際には結合の判定線の下にあった原子を掴んだ移動ドラッグだった）。
 *
 * 注意: 再現は完全ではない（モーフィングと rAF が絡む。audit.js の auditRerun の注記参照）。
 * 1回で出なくても直った証拠にはならないので、**件数は必ず同じ種の集合で前後比較する**。
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire('C:/Users/maequ/マイドライブ/Antigravity/OrganicChemistryPuzzle/tools/record/package.json');
const { chromium } = require('playwright');

const base = Number(process.argv[2] || 3473418623) >>> 0;
const count = Number(process.argv[3] || 1);
const ops = Number(process.argv[4] || 80);
const url = process.argv[5] || 'http://localhost:8148/assembler/audit.html';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (/ZDHIT|ZDERR/.test(m.text())) console.log(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => {
    const f = document.getElementById('audit-frame');
    return f && f.contentWindow && f.contentWindow.appReady;
}, null, { timeout: 60000 });

const results = [];
for (let i = 0; i < count; i++) {
    const seed = (base + i) >>> 0;
    const r = await page.evaluate(async ([seed, ops]) => {
        const hits = [];
        let prevZero = 0;
        const zeros = (g) => {
            const a = g.userMolecule.atoms;
            const out = [];
            for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
                if (Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) < 1e-9) out.push([a[i], a[j]]);
            }
            return out;
        };
        const { ops: log } = await window.auditTrace(seed, ops, (k, opDesc, g) => {
            const z = zeros(g);
            if (z.length > prevZero) {
                hits.push({
                    k, op: opDesc, n: z.length,
                    pairs: z.slice(0, 3).map(([p, q]) => `${p.element}@${p.x},${p.y} = ${q.element}`)
                });
            }
            prevZero = z.length;
        });
        return { hits, tail: log.slice(-3), finalZero: prevZero };
    }, [seed, ops]);
    if (r.hits.length) {
        console.log(`seed=${seed} 0px発生 ${r.hits.length}回`);
        r.hits.forEach(h => console.log(`   op#${h.k} [${h.op}] -> ${h.n}組  ${h.pairs.join(' | ')}`));
        results.push({ seed, hits: r.hits });
    }
}
console.log(`--- ${count}種中 ${results.length}種で 0.0px 発生`);
const byOp = {};
results.forEach(r => r.hits.forEach(h => {
    const kind = String(h.op).split(' ')[0];
    byOp[kind] = (byOp[kind] || 0) + 1;
}));
console.log('発生させた操作の内訳:', JSON.stringify(byOp));
await browser.close();
