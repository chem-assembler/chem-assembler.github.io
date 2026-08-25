/**
 * タイムアタックの「1問にかかる時間」を**実測**する（2026-08-25・ユーザー決定
 * 「60秒がそもそも長いので初期時間を削る。ただしクイズの種類によって妥当な時間は異なる」）
 *
 *   node tools/quiz-time-census.mjs http://127.0.0.1:8231/assembler/
 *
 * ⚠ **Browser ペインでは測れない。** 非表示のペインは Chrome の intensive throttling で
 *   `setTimeout` が秒単位に落ちるので、**時間の実測がまるごと嘘になる**
 *   （実測: 1.2秒間隔のはずが 3問で 33秒かかった）。ここは run-tests.mjs と同じ
 *   ヘッドレス Playwright を使う ＝ 節流と無縁。
 *
 * 測るのは2つ:
 *   ① **1問あたりの読む量**（クイズの種類ごと）——
 *      図の枚数・図の中の原子ラベル/線の本数・選択肢の数・読む文字数。
 *      ⚠ 人の解答時間そのものは測れない（記録が残っていない）。ここが測るのは
 *      **「同じ60秒が妥当なはずがない」の根拠になる負荷の差**で、秒はここから導く。
 *   ② **タイムアタックが終わるかどうか**——実機のタイムアタックを一定の速さで
 *      正解し続け、残り時間が増えるか減るかを見る。加算に上限が無いことの実測。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv.slice(2).find(a => !a.startsWith('--')) ||
    'http://127.0.0.1:8231/assembler/';
const require = createRequire(path.join(here, 'record', 'package.json'));
const playwright = require('playwright');

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.quiz && window.namingQuiz && window.STAGES, null,
    { timeout: 60000, polling: 200 });

// ===== ① 1問あたりの読む量 =====
const load = await page.evaluate(() => {
    const figStats = (ids) => {
        let figs = 0, glyphs = 0, lines = 0;
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
            if (!svg || svg.querySelectorAll('line,path,text').length === 0) return;
            figs++;
            glyphs += svg.querySelectorAll('text').length;
            lines += svg.querySelectorAll('line,path').length;
        });
        return { figs, glyphs, lines };
    };
    const run = (name, open, next, ids, choiceSel, taskSel, N) => {
        try { open(); } catch (e) { return { name, error: 'open: ' + e.message }; }
        const acc = { figs: 0, glyphs: 0, lines: 0, choices: 0, chars: 0 };
        let n = 0;
        const t0 = performance.now();
        for (let i = 0; i < N; i++) {
            try { next(); } catch (e) { continue; }
            const s = figStats(ids);
            if (!s.figs) continue;
            acc.figs += s.figs; acc.glyphs += s.glyphs; acc.lines += s.lines;
            acc.choices += choiceSel ? document.querySelectorAll(choiceSel).length : 0;
            const task = taskSel ? (document.querySelector(taskSel) || { textContent: '' }).textContent : '';
            let ct = '';
            if (choiceSel) document.querySelectorAll(choiceSel).forEach(b => { ct += b.textContent; });
            acc.chars += task.length + ct.length;
            n++;
        }
        const ms = (performance.now() - t0) / Math.max(1, n);
        return { name, n, figs: +(acc.figs / n).toFixed(1), glyphs: +(acc.glyphs / n).toFixed(1),
                 lines: +(acc.lines / n).toFixed(1), choices: +(acc.choices / n).toFixed(1),
                 chars: Math.round(acc.chars / n), genMs: +ms.toFixed(1) };
    };
    const out = [];
    out.push(run('同じ化合物はどれ？（4択・⏱あり）', () => window.quiz.open(), () => window.quiz.nextQuestion(),
        ['quiz-svg-a', 'quiz-cell-0', 'quiz-cell-1', 'quiz-cell-2', 'quiz-cell-3'],
        '#quiz-options .pk-cell', '#quiz-premise', 60));
    document.getElementById('btn-quiz-close').click();
    out.push(run('命名クイズ（4択）', () => window.namingQuiz.open(), () => window.namingQuiz.nextQuestion(),
        ['naming-svg'], '#naming-choices button', null, 60));
    document.getElementById('btn-naming-close').click();
    out.push(run('立体異性体は何種類？（数える）', () => document.getElementById('btn-count-quiz').click(),
        () => window.countQuiz.nextQuestion(), ['cq-svg'], '#cq-choices button', '#cq-question', 30));
    const c2 = document.getElementById('btn-cq-close'); if (c2) c2.click();
    out.push(run('立体異性体クイズ（2枚をくらべる）', () => document.getElementById('btn-stereo-quiz').click(),
        () => window.stereoQuiz.nextQuestion(), ['sq-svg-a', 'sq-svg-b'], null, '#sq-question', 30));
    const c3 = document.getElementById('btn-sq-close'); if (c3) c3.click();
    return out;
});

const w = (s, n) => {
    const width = (t) => [...String(t)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
    let o = String(s);
    while (width(o) < n) o += ' ';
    return o;
};
console.log('=== ① 1問あたりの読む量（実測・クイズごとに 30〜60 問を生成して平均） ===');
console.log('⚠ 人の解答時間そのものは測れない（記録が残っていない）。ここは負荷の差を出す。\n');
console.log('  ' + w('クイズ', 36) + w('図', 6) + w('原子ラベル', 12) + w('線', 8) + w('選択肢', 8) + w('文字数', 8) + '生成ms');
console.log('  ' + '-'.repeat(90));
load.forEach(r => {
    if (r.error) { console.log('  ' + w(r.name, 36) + '（測れず: ' + r.error + '）'); return; }
    console.log('  ' + w(r.name, 36) + w(r.figs, 6) + w(r.glyphs, 12) + w(r.lines, 8) +
        w(r.choices, 8) + w(r.chars, 8) + r.genMs);
});
const heaviest = load.filter(r => !r.error).reduce((a, b) => (a.glyphs > b.glyphs ? a : b));
const lightest = load.filter(r => !r.error).reduce((a, b) => (a.glyphs < b.glyphs ? a : b));
console.log(`\n  いちばん重い「${heaviest.name}」と いちばん軽い「${lightest.name}」で ` +
    `原子ラベルの数が ${(heaviest.glyphs / lightest.glyphs).toFixed(1)} 倍 ／ ` +
    `図の枚数が ${(heaviest.figs / lightest.figs).toFixed(1)} 倍 ／ ` +
    `読む文字数が ${(heaviest.chars / Math.max(1, lightest.chars)).toFixed(1)} 倍。`);

// ===== ② タイムアタックは終わるか =====
console.log('\n=== ② タイムアタックは終わるか（実機を実際に走らせた実測） ===');
const consts = await page.evaluate(() => ({
    limit: window.QUIZ_TA_LIMIT_MS, bonus: window.QUIZ_TA_BONUS_MS,
    label: document.getElementById('btn-quiz-timeattack').textContent.trim()
}));
console.log(`  いまの設定: 初期 ${consts.limit / 1000} 秒 ／ 正解ごとに ＋${consts.bonus / 1000} 秒 ／ 加算の上限なし`);
console.log(`  ボタンの表示: 「${consts.label}」`);

for (const think of [1200, 1800, 2400, 3000]) {
    const r = await page.evaluate(async ({ think, max }) => {
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        const q = window.quiz;
        q.open();
        q.startTimeAttack();
        const started = q.ta.endsAt;
        let n = 0;
        while (q.ta && n < max) {
            await sleep(think);
            if (!q.ta) break;
            const idx = (q.current && typeof q.current.answer === 'number') ? q.current.answer : -1;
            if (idx < 0) break;
            q.answerChoice(idx);
            n++;
            await sleep(950);   // 正解の送り（900ms）を待つ
        }
        const alive = !!q.ta;
        const left = alive ? q.ta.endsAt - Date.now() : 0;
        const grew = alive ? q.ta.endsAt - started : null;
        const correct = q.ta ? q.ta.correct : null;
        if (q.ta) q.stopTimeAttack(false);
        return { alive, left, grew, n, correct };
    }, { think, max: 25 });
    const per = (think + 950) / 1000;
    console.log(`  考え ${(think / 1000).toFixed(1)}秒（1問 ${per.toFixed(2)}秒）… ` +
        (r.alive
            ? `25問答えても終わらない。残り ${(r.left / 1000).toFixed(1)}秒（開始時より ${(r.grew / 1000).toFixed(1)}秒 増えた）`
            : `${r.n}問で終了`) + `／正解 ${r.correct}`);
}
console.log('\n  ⚠ 正解1問あたりの収支 ＝ ＋3.0秒（加算） −（考えた時間 ＋ 0.9秒の送り）。');
console.log('    考えた時間が 2.1 秒を切ると収支が黒字になり、**時間は永久に増える**（加算にも総時間にも上限が無いため）。');

await browser.close();
process.exit(0);
