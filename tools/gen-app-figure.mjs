/**
 * 参考書の図を**自分たちのアプリの画面から切り取って**焼く（`reference-img/<ページid>-app-<中身>.png`）。
 *
 *   node tools/gen-app-figure.mjs --port=8961          … 原稿の shot: を全部撮る
 *   node tools/gen-app-figure.mjs --port=8961 halogen  … そのページの図だけ
 *   node tools/gen-app-figure.mjs --check              … 撮らずに「図が在るか」だけ見る（ブラウザ不要）
 *
 * ★★ 発端はユーザー「画像はアプリからの切り取りも使えるはず」（2026-09-19）。
 *    設計は ref-inorg-design §5-2b と発注書のひな形 §4-2（2枚で手順を確かめた）。設計書 §31-4。
 *
 * ★★ **指定は原稿（`reference-src/<id>.md`）が持つ** —— `:::figure` に `shot:` を1行足す:
 *
 *      :::figure
 *      src: electrolysis-basics-app-nacl.png
 *      shot: url=/ion-equation/electrolysis.html?s=e3 sel=#cellSvg wait=800 状態=開いたまま
 *      alt: …
 *      caption: …
 *      :::
 *
 * | | 意味 |
 * |---|---|
 * | `url=`   | ★ 必須。ルートからのパス（`/ion-equation/` `/muki/` `/ratio/` `/assembler/`）。`slz_internal=1` はここで足す（GA4 に数えない） |
 * | `sel=`   | ★ 必須。撮る要素の CSS セレクタ。⚠ **画面全体は撮らない**（ヘッダーの版番号が写り、版が上がるたびに古く見える） |
 * | `wait=`  | 開いてから撮るまでの待ち（ミリ秒・既定 800）。アニメが止まるまで |
 * | `scale=` | 1（既定）か 2（細かい図だけ） |
 * | `状態=`  | 撮る人の覚え書き（何をしてから撮ったか）。⚠ 道具は読むだけで何もしない |
 *
 * ⚠ **状態を URL で1つに決められる画面だけ**を撮る。ion-equation は `?rxn=` `?s=` `?q=` `?sp=` で決まる。
 *   ⚠ muki の tree / separation / snake は開くたびに抽選（引数の受け口が無い）＝ 撮り直すと別の図になる。
 *     この道具は同じ URL を2回撮って**1バイトでも違えば赤**にする（抽選の画面を黙って焼かない）。
 * ⚠ `gen-figure.mjs`（原稿の `gen:` から分子の図を焼く）とは別物。同じ図に両方は書けない（書式が赤にする）。
 * ★ 色はアプリのまま（muki は暗い地・ion は明るい地）。面Aの `.ref-figure-img` は白い下敷きを敷く。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'reference-src');
const IMG = path.join(ROOT, 'reference-img');
const RM = require('./reference-md.js');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const PORT = (args.find(a => a.startsWith('--port=')) || '--port=8486').split('=')[1];
const ONLY = args.filter(a => !a.startsWith('--'));
const VIEW_W = 1200;          // 幅は 1200px 以下（発注書のひな形 §4-2 ⑥）
const WARN_BYTES = 100 * 1024; // 1枚 100KB を超えたら切り直しを促す（止めない）

function collect() {
    const ids = RM.normalize(readFileSync(path.join(SRC, 'ORDER.txt'), 'utf8')).split('\n')
        .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    const jobs = [];
    ids.forEach(id => {
        if (ONLY.length && !ONLY.includes(id)) return;
        const where = `reference-src/${id}.md`;
        const page = RM.parsePage(readFileSync(path.join(SRC, id + '.md'), 'utf8'), where, { pages: ids });
        (page.blocks || []).forEach(b => {
            if (b.kind !== 'figure' || !b.shot) return;
            /* ★ 名前の頭はページ id（`<ページid>-app-<中身>.png`）。書式は -app- だけ見る（ページ id を知らない） */
            if (b.src.indexOf(id + '-app-') !== 0) {
                throw new Error(`${where}: shot: で撮る図の src は「${id}-app-<中身>.png」にします（いまは「${b.src}」）`);
            }
            jobs.push({ id, src: b.src, shot: RM.parseShot(b.shot, where) });
        });
    });
    return jobs;
}

async function shoot(jobs) {
    const pwRequire = createRequire(path.join(HERE, 'record', 'package.json'));
    const { chromium } = pwRequire('playwright');
    const browser = await chromium.launch();
    const base = `http://localhost:${PORT}`;
    const done = [];
    try {
        for (const job of jobs) {
            const s = job.shot;
            const scale = Number(s.scale || 1);
            const url = base + s.url + (s.url.includes('?') ? '&' : '?') + 'slz_internal=1';
            const once = async () => {
                const pg = await browser.newPage({ viewport: { width: VIEW_W, height: 900 }, deviceScaleFactor: scale });
                try {
                    const res = await pg.goto(url, { waitUntil: 'networkidle' });
                    if (!res || !res.ok()) throw new Error(`${s.url} が開けません（HTTP ${res && res.status()}）`);
                    await pg.waitForTimeout(Number(s.wait || 800));
                    const loc = pg.locator(s.sel);
                    const n = await loc.count();
                    if (n !== 1) throw new Error(`sel=${s.sel} に当たる要素が ${n} 個です（1つに絞ってください）`);
                    return await loc.screenshot({ type: 'png', animations: 'disabled' });
                } finally { await pg.close(); }
            };
            let a, b;
            try { a = await once(); b = await once(); }
            catch (e) { throw new Error(`reference-src/${job.id}.md の ${job.src}: ${e.message}`); }
            /* ⚠ 抽選の画面を黙って焼かない（muki の tree / separation / snake など） */
            if (Buffer.compare(a, b) !== 0) {
                throw new Error(`reference-src/${job.id}.md の ${job.src}: 同じ URL を2回撮ったら違う図になりました`
                    + '（開くたびに抽選する画面か、アニメが止まっていない）。wait= を延ばすか、状態を URL で決められる画面を選んでください');
            }
            const w = a.readUInt32BE(16) / scale, h = a.readUInt32BE(20) / scale;
            if (!existsSync(IMG)) mkdirSync(IMG, { recursive: true });
            writeFileSync(path.join(IMG, job.src), a);
            done.push(job);
            console.log(`   ✅ ${job.src}  ${w}x${h}（×${scale}）  ${(a.length / 1024).toFixed(0)}KB  ← ${s.url} ${s.sel}`
                + (a.length > WARN_BYTES ? '  ⚠ 100KB を超えています（要素を絞るか scale=1 に）' : ''));
        }
    } finally {
        await browser.close();
    }
    return done;
}

async function main() {
    let jobs;
    try { jobs = collect(); }
    catch (e) { console.log('❌ ' + e.message); process.exit(1); }
    if (!jobs.length) {
        console.log('撮る図はありません（:::figure に shot: を書いた図が対象です）');
        process.exit(0);
    }
    if (CHECK) {
        const missing = jobs.filter(j => !existsSync(path.join(IMG, j.src)));
        jobs.forEach(j => console.log(`   ${existsSync(path.join(IMG, j.src)) ? '✅' : '❌'} ${j.src}  ← ${j.shot.url} ${j.shot.sel}`));
        if (missing.length) {
            console.log(`❌ ${missing.length} 枚がまだ撮れていません（node tools/gen-app-figure.mjs --port=<ポート>）`);
            process.exit(1);
        }
        console.log(`✅ アプリの画面から撮る図 ${jobs.length} 枚は、すべて reference-img/ に在ります`);
        process.exit(0);
    }
    console.log(`アプリの画面から ${jobs.length} 枚を撮ります（:${PORT}）`);
    try {
        const done = await shoot(jobs);
        console.log(`✅ ${done.length} 枚を reference-img/ に焼きました`);
        console.log('   ⚠ 焼いたあとは `node tools/gen-reference.mjs` と `gen-reference-pages.mjs` を走らせてください');
    } catch (e) {
        console.log('❌ ' + e.message);
        process.exit(1);
    }
}

await main();
