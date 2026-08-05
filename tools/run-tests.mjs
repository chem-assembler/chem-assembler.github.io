/**
 * 各アプリの test.html を**ヘッドレス Playwright** で回す（assembler / ratio / ion / muki 対応）。
 *
 *   node tools/run-tests.mjs                                        … 既定（:8134 の assembler）
 *   node tools/run-tests.mjs http://localhost:8123/ratio/test.html  … 別のページ
 *
 * **なぜ要るか**: Claude の Browser ペインは非表示のとき `document.hidden === true` になり、
 * 5分ほどで Chrome の **intensive throttling** が効いて `setTimeout` が分単位に落ちる。
 * すると待ちの多いテスト（例: EP5 の深いリンクは使い捨て iframe の起動を待つ）が
 * **止まったように見える** —— コードは正常なのに 185/187 から動かなくなる。
 * ここは節流と無縁で、187件が2分ほどで完走する。
 *
 * 配信サーバーは**自分で立てない**（`preview_start` で立てたものを使う）。
 * playwright は `tools/record/` のものを借りるので追加インストールは要らない。
 *
 * 終了コード: 全合格なら 0、1件でも失敗すれば 1（コミット前の門番に使える）。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || 'http://localhost:8134/assembler/test.html';

const require = createRequire(path.join(here, 'record', 'package.json'));
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage();
const t0 = Date.now();
await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });

// 完了の合図はアプリごとに違う（B-8: #summary 固定だと ratio が完走できず必ず10分待ちになる）。
//   assembler … #summary に ✅ / ❌
//   ratio・muki … #total に「ALL PASS (n)」/「N FAILED / M」
//   ion       … #total に「TOTAL: ALL PASS」/「TOTAL: FAIL」
// どれかが出たら完了とみなす。重いテスト中はページが数十秒無応答になるので
// polling は粗く、timeout は長めに取る
const doneText = () => {
    const s = document.getElementById('summary');
    if (s && /[✅❌]/.test(s.textContent)) return s.textContent.trim();
    const t = document.getElementById('total');
    if (t && /(ALL PASS|FAIL)/.test(t.textContent)) return t.textContent.trim();
    return null;
};
await page.waitForFunction(doneText, null, { timeout: 600000, polling: 2000 });

const summary = await page.evaluate(doneText);
// 失敗の中身。assembler は #results li.fail、ratio / ion / muki は div.case.fail
const fails = await page.$$eval('#results li.fail, .case.fail',
    els => els.map(e => e.textContent.trim()));
// 合否は一覧の有無ではなく完了表示から決める（一覧の書式が変わっても門番が黙らないように）
const okRun = /✅|ALL PASS/.test(summary) && !/[❌]|FAILED/.test(summary);
console.log(`所要 ${Math.round((Date.now() - t0) / 1000)} 秒`);
console.log(summary);
if (fails.length) {
    console.log('--- 失敗 ---');
    fails.forEach(f => console.log('  ' + f.slice(0, 300)));
}
await browser.close();
process.exit(okRun && fails.length === 0 ? 0 : 1);
