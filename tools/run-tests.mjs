/**
 * 各アプリの test.html を**ヘッドレス Playwright** で回す（assembler / ratio / ion / muki 対応）。
 *
 *   node tools/run-tests.mjs                                        … 既定（:8134 の assembler）
 *   node tools/run-tests.mjs http://localhost:8123/ratio/test.html  … 別のページ
 *   node tools/run-tests.mjs --only=NW30,RX                         … 一部だけ（assembler のみ）
 *
 * ⚠ `--only=` は**否定対照を素早く見るための道具**で、門番には使えない。
 *   絞ったときは全部通っても**終了コード 3**を返す（0 ＝「コミットして良い」を絞り込みで
 *   名乗らせない）。無指定はいままでどおり全件・全合格で 0。
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
const args = process.argv.slice(2);
// `--timings[=N]` … 遅いテストを上位 N 件（既定20）並べる。全走が門番の上限に
// 近づいたとき「どれが遅いか」を推測でなく実測で出すための足場（assembler のみ対応）
const timingArg = args.find(a => a.startsWith('--timings'));
const timingTop = timingArg ? (parseInt(timingArg.split('=')[1], 10) || 20) : 0;
let target = args.find(a => !a.startsWith('--')) || 'http://localhost:8134/assembler/test.html';
// `--only=NW30,RX` … test.html の `?only=` に渡して一部だけ流す（tests.js 側が絞る）
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').slice('--only='.length);
if (onlyArg) {
    target += (target.includes('?') ? '&' : '?') + 'only=' + encodeURIComponent(onlyArg);
}
// `--engine=webkit` … WebKit（Safari と同じ系統のエンジン）で回す。
// iOS Safari そのものではないので「通ったから iPhone で安心」とは言えないが、
// **エンジンの違いで壊れる類**（getScreenCTM の値・100dvh・-webkit- 接頭辞）は拾える。
// 既定は chromium。webkit を使うには一度だけ `npx playwright install webkit` が要る。
const engineArg = (args.find(a => a.startsWith('--engine=')) || '').split('=')[1] || 'chromium';

const require = createRequire(path.join(here, 'record', 'package.json'));
const playwright = require('playwright');
const engine = playwright[engineArg];
if (!engine) {
    console.error(`知らないエンジン: ${engineArg}（chromium / webkit / firefox）`);
    process.exit(1);
}

let browser;
try {
    browser = await engine.launch();
} catch (e) {
    // 本体が未インストールのときは「何をすれば良いか」を出す（黙って落ちない）
    console.error(`${engineArg} を起動できません: ${String(e.message).split('\n')[0]}`);
    if (/Executable doesn't exist/.test(e.message)) {
        console.error(`  → cd tools/record && npx playwright install ${engineArg}`);
    }
    process.exit(1);
}
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
// ⚠ 上限は**全走の実測に対して2倍以上**を保つこと。assembler は
//    2026-08-17 に 459件/378秒 → 2026-08-18 に 482件/501秒 と伸びており、
//    600000（10分）では 84% まで来ていた。ここを食い潰すと、門番が
//    「テストが落ちた」ではなく「タイムアウトで落ちた」という**読みにくい形**で壊れる。
//    残りが3割を切ったら、上限を上げるか重いテストを削るかを判断する。
await page.waitForFunction(doneText, null, { timeout: 1500000, polling: 2000 });

const summary = await page.evaluate(doneText);
// 失敗の中身。assembler は #results li.fail、ratio / ion / muki は div.case.fail
const fails = await page.$$eval('#results li.fail, .case.fail',
    els => els.map(e => e.textContent.trim()));
// 合否は一覧の有無ではなく完了表示から決める（一覧の書式が変わっても門番が黙らないように）
const okRun = /✅|ALL PASS/.test(summary) && !/[❌]|FAILED/.test(summary);
// ★ **通ったテストが自分で書いた注記**（見張った本数など）は、緑でも読めるところに出す。
//   ⚠ 悉皆の検査は「対象を絞って全部通った」がいちばん悪い形なので、
//   ヘッドレスの門番でも「N 本中 M 本を見張った」が目に入るようにしておく（CV1）。
const notes = await page.$$eval('#results li.pass span.detail',
    els => els.map(e => e.textContent.trim()).filter(t => t && !/^⏱/.test(t)));
console.log(`所要 ${Math.round((Date.now() - t0) / 1000)} 秒（エンジン: ${engineArg}）`);
console.log(summary);
if (notes.length) {
    console.log('--- テストが測った数 ---');
    notes.forEach(n => console.log('  ' + n.slice(0, 300)));
}
if (timingTop) {
    const timings = await page.evaluate(() => window.testTimings || null);
    if (!timings) {
        console.log('（このページはテストごとの計測に未対応）');
    } else {
        const sorted = [...timings].sort((a, b) => b.ms - a.ms);
        const sum = timings.reduce((s, t) => s + t.ms, 0);
        console.log(`--- 遅い順 上位 ${Math.min(timingTop, sorted.length)} 件 / 全 ${timings.length} 件・合計 ${(sum / 1000).toFixed(1)} 秒 ---`);
        sorted.slice(0, timingTop).forEach((t, i) => {
            const pct = (t.ms / sum * 100).toFixed(1);
            console.log(`  ${String(i + 1).padStart(2)}. ${(t.ms / 1000).toFixed(1)}秒 (${pct}%) ${t.name}`);
        });
    }
}
if (fails.length) {
    console.log('--- 失敗 ---');
    fails.forEach(f => console.log('  ' + f.slice(0, 300)));
}
// 絞って走ったなら、通っても 0 を返さない（`&& git commit` の類に繋いだとき、
// 一部だけの緑がコミットの許可に化けるのを防ぐ）。URL に ?only= が無くても
// **ページ自身が絞り込みだと言っている**ことを見る ＝ 判定の根拠を1本にする
const filtered = /絞り込み/.test(summary);
await browser.close();
if (filtered) {
    console.log('⚠ これは絞り込み実行です。全テスト合格ではないので、終了コード 3 を返します');
    console.log('  （コミット前の確認は --only= を外して全件流すこと）');
    process.exit(3);
}
process.exit(okRun && fails.length === 0 ? 0 : 1);
