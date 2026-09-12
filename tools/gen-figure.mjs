/**
 * 参考書の図を**アプリの描画で焼く**（`reference-img/<名前>.png`）。
 *
 *   node tools/gen-figure.mjs                   … :8486 のアプリを使って焼く
 *   node tools/gen-figure.mjs --port=8123       … 別のポート
 *   node tools/gen-figure.mjs --check           … 焼かずに「図が在るか」だけ見る（ブラウザ不要）
 *   node tools/gen-figure.mjs alkane-naming     … そのページの図だけ焼く
 *
 * ★★ **新しい作図コードを書かない。**描いているのは `assembler/learn.js` の
 *    `IsomerPractice.prototype.renderStandardFigure`（＝ 書き出し練習の答え合わせに出るのと
 *    同じ図）で、このファイルは **分子を渡して screenshot を撮るだけ**。
 *    ⚠ ここに2本目の作図を書くと、アプリの図と参考書の図が別々に育つ。
 *
 * ★★ **指定は原稿（`reference-src/<id>.md`）が持つ** —— `:::figure` に `gen:` を1行足す:
 *
 *      :::figure
 *      src: alkane-naming-example-chain.png     ← 焼き先（今までどおり）
 *      gen: name=2,3-ジメチルペンタン numbered   ← ★ これが「どう描くか」
 *      alt: …
 *      caption: …
 *      :::
 *
 *    ⚠ `gen:` が無い図（スライドから切った既存56枚）は**この道具が一切触らない**。
 *
 * **`gen:` に書けること**（空白区切り。順番は問わない）
 *
 * | | 意味 |
 * |---|---|
 * | `name=<名前>`   | ★ **必須。**この図が何の分子かを名乗る |
 * | `formula=<分子式>` | 名前が `stages.json` / `compounds.json` に無いとき。**その式の構造異性体を全部作って、`iupacName` が `name=` と同じ名前を返すものを選ぶ**（⚠ 重原子8個まで） |
 * | `chain=<数> subs=<位置-基,…>` | ⚠ 重原子9個以上のアルカンだけ。主鎖の炭素数と側鎖（`2-メチル,3-エチル`）から骨格を組む。**組んだあと `iupacName` で `name=` と照合する**（違えば赤） |
 * | `numbered`      | 主鎖にオレンジの帯と `C₁ C₂ …` の番号を重ねる（アプリの `🔢` と同じもの） |
 * | `plain`         | ⚠ **位置番号を消す。**アプリの標準の図は素の `1 2 3 …` を主鎖の下に振るので、番号の話をする前のページでは邪魔になる（消すのは番号の文字だけで、形は触らない） |
 *
 * ★ **どの道で作っても、最後に `iupacName` で名前を突き合わせる。**
 *   ＝ **原稿に書いた名前と違う分子が図になることがない。**
 *
 * ⚠ **紙の色で焼く。**アプリは暗い地なので、そのまま焼くと明るい面A（`/reference/<id>/`）で
 *   線が消える。★ 色だけ読み替えて（`PAPER_CSS`）、**形は1ピクセルも触らない**。
 *   `.ref-figure-img` は面Aでも面Bでも白い下敷きを敷く（`LIGHT_KEEP` に理由が書いてある）ので、
 *   白地で焼けば**両面とも同じに読める**。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
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

/* 焼く大きさ。★ 既存56枚（幅 1150px 前後）に合わせる ＝ 本文の幅 572px の2倍。
   ⚠ 縦長の分子で高さが伸びすぎないように、天井も持つ */
const OUT_W = 1150;
const MAX_H = 760;
/* ★★ **本のどのページでも結合の長さを同じにする**ための最小の横幅（分子の座標系の単位）。
 *
 * ⚠ `.ref-figure-img` は `width:100%` なので、**図は必ず本文の幅（572px）まで引き伸ばされる**。
 *   ＝ プロパン（横 152単位）をそのまま焼くと、結合1本が 173px で描かれ、
 *   ヘキサン（横 290単位・91px）の2倍の太さの図が同じページに並ぶ。
 * ★ だから**足りないぶんは左右に余白を足して**、どの図も同じ横幅から始める。
 *   572 × 46（結合1本の単位）÷ 480 ＝ **結合 約55px** —— これが本の中の結合の長さ。
 * ⚠ 480単位より広い分子（長い鎖）はそのまま縮む ＝ 天井ではなく床。 */
const FIT_W = 480;
/* ⚠ `gen-reference.mjs` の `MAX_ASPECT`（10:1）に**余裕を持って**収まること。
   ★ ここで止めれば、焼いてから生成で止まるより1手早い */
const ASPECT_WARN = 9;

/* ★★ 紙の色（⚠ 形は触らない・色だけ）。
   ・原子の丸は地を白に（アプリは `#0f141c` を属性で直に書いている）
   ・結合線は `rgba(255,255,255,…)` を属性で直に書いているので `!important` で読み替える
   ・`_iupacLiftBondInk` が帯の上で結合線を白く塗り直すので、そこも同じ口で押さえる
   ・元素の色は色相を残して明度だけ落とす（面Aの読み替え LIGHT_CSS と同じ考え方） */
const PAPER_CSS = `
#figbake{
  background:#fff; padding:0; margin:0; position:fixed; left:0; top:0; z-index:99999;
  --color-c:#333a45; --color-o:#b52d20; --color-n:#2456b8; --color-cl:#1e7a45;
  --color-s:#7d6200; --color-br:#8a4b00; --color-h:#6b7482; --color-f:#1d7a6e;
  --color-cyan:#0d6c78; --neon-orange:#b4680a; --neon-pink:#a3246a;
}
#figbake svg{ display:block; background:#fff; }
#figbake circle{ fill:#fff !important; }
#figbake line{ stroke: rgba(40,48,60,0.24) !important; }
#figbake line.svg-bond-ink{ stroke: rgba(28,34,45,0.92) !important; }
#figbake line.iupac-band{ stroke: #b4680a !important; opacity:0.34 !important; }
#figbake text.iupac-group-name{ stroke: rgba(255,255,255,0.95) !important; }
`;

/* ============================================================================
 * 原稿から「焼く図」を集める（★ 台帳は原稿1つ ＝ 指定と図が離れない）
 * ========================================================================== */
function collect() {
    const ids = RM.normalize(readFileSync(path.join(SRC, 'ORDER.txt'), 'utf8')).split('\n')
        .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    const jobs = [];
    ids.forEach(id => {
        if (ONLY.length && !ONLY.includes(id)) return;
        const page = RM.parsePage(readFileSync(path.join(SRC, id + '.md'), 'utf8'), `reference-src/${id}.md`, { pages: ids });
        (page.blocks || []).forEach(b => {
            if (b.kind !== 'figure' || !b.gen) return;
            jobs.push({ id, src: b.src, gen: b.gen, spec: parseGen(b.gen, `reference-src/${id}.md`) });
        });
    });
    return jobs;
}

/** `gen:` の1行を読む。⚠ 知らない語は**黙って捨てない**（綴り違いが図の取り違えになる） */
function parseGen(text, where) {
    const spec = { numbered: false, plain: false };
    String(text).trim().split(/\s+/).filter(Boolean).forEach(tok => {
        if (tok === 'numbered') { spec.numbered = true; return; }
        if (tok === 'plain') { spec.plain = true; return; }
        const m = /^(name|formula|chain|subs)=(.+)$/.exec(tok);
        if (!m) throw new Error(`${where}: :::figure の gen に読めない語「${tok}」があります`
            + '（書けるのは name= / formula= / chain= / subs= / numbered / plain）');
        spec[m[1]] = m[2];
    });
    if (!spec.name) throw new Error(`${where}: :::figure の gen に name= がありません（図が何の分子かを名乗ってください）`);
    if (spec.chain && !spec.subs) throw new Error(`${where}: gen の chain= には subs= を添えます`);
    if (spec.subs && !spec.chain) throw new Error(`${where}: gen の subs= には chain= を添えます`);
    if (spec.numbered && spec.plain) throw new Error(`${where}: gen の numbered と plain は同時に書けません`);
    return spec;
}

/* ============================================================================
 * 焼く
 * ========================================================================== */
async function bake(jobs) {
    const pwRequire = createRequire(path.join(HERE, 'record', 'package.json'));
    const { chromium } = pwRequire('playwright');
    const browser = await chromium.launch();
    const pg = await browser.newPage({ deviceScaleFactor: 2 });
    const base = `http://localhost:${PORT}`;
    try {
        await pg.goto(`${base}/assembler/`, { waitUntil: 'domcontentloaded' });
        await pg.waitForFunction(
            () => window.game && typeof window.game.createTargetFromData === 'function'
                && window.STAGES && window.STAGES.length && window.COMPOUNDS && window.COMPOUNDS.length
                && typeof IsomerPractice !== 'undefined',
            null, { timeout: 30000 });
    } catch (e) {
        console.error(`❌ ${base}/assembler/ を開けません（図を描くのはアプリなので、本体が要ります）。`);
        console.error('   リポジトリのルートを配信するローカルサーバーを立ててから実行してください');
        await browser.close();
        process.exit(1);
    }
    await pg.addStyleTag({ content: PAPER_CSS });

    if (!existsSync(IMG)) mkdirSync(IMG, { recursive: true });
    const done = [];
    for (const job of jobs) {
        const r = await pg.evaluate(({ spec, OUT_W, MAX_H, FIT_W }) => {
            /* ── ① 分子を決める（★ 道は3つ。どれも最後に名前で照合する）──────────── */
            const g = window.game;
            const lib = (window.COMPOUNDS || []).concat(window.STAGES || []);
            const ALKYL = { 'メチル': 1, 'エチル': 2, 'プロピル': 3, 'ブチル': 4 };
            let mol = null, via = '';

            const entry = lib.find(e => e.name === spec.name && e.target);
            if (entry) { mol = g.createTargetFromData({ target: entry.target }); via = '登録済み'; }

            if (!mol && spec.formula) {
                const m = /^((?:[A-Z][a-z]?\d*)+)$/.exec(spec.formula);
                if (!m) return { error: `formula=${spec.formula} が分子式に見えません` };
                const heavy = [];
                let h = 0;
                [...spec.formula.matchAll(/([A-Z][a-z]?)(\d*)/g)].forEach(([, el, n]) => {
                    const c = n ? parseInt(n, 10) : 1;
                    if (el === 'H') h += c; else for (let i = 0; i < c; i++) heavy.push(el);
                });
                const { isomers, overflow } = window.enumerateConstitutionalIsomers(heavy, h);
                if (overflow) return { error: `formula=${spec.formula} は列挙器の上限（重原子8個）を超えています。chain= / subs= で骨格を書いてください` };
                const hit = isomers.find(iso => window.iupacName(iso) === spec.name);
                if (!hit) return { error: `formula=${spec.formula} の構造異性体 ${isomers.length} 種に「${spec.name}」がありません` };
                mol = hit; via = `${spec.formula} の列挙（${isomers.length}種）`;
            }

            if (!mol && spec.chain) {
                const n = parseInt(spec.chain, 10);
                if (!(n >= 1 && n <= 20)) return { error: `chain=${spec.chain} が主鎖の炭素数に見えません` };
                const X = 46, Y = 42;
                const atoms = [], bonds = [];
                for (let i = 0; i < n; i++) atoms.push({ element: 'C', x: 120 + i * X, y: 240 });
                for (let i = 0; i + 1 < n; i++) bonds.push({ atom1Index: i, atom2Index: i + 1, type: 1 });
                const subs = spec.subs.split(',').map(s => s.trim()).filter(Boolean);
                for (let si = 0; si < subs.length; si++) {
                    const sm = /^(\d+)-(.+)$/.exec(subs[si]);
                    if (!sm) return { error: `subs の「${subs[si]}」は「位置-基」の形で書きます（例 2-メチル）` };
                    const pos = parseInt(sm[1], 10), len = ALKYL[sm[2]];
                    if (!len) return { error: `subs の基「${sm[2]}」を知りません（${Object.keys(ALKYL).join(' / ')}）` };
                    if (!(pos >= 1 && pos <= n)) return { error: `subs の位置 ${pos} が主鎖（1〜${n}）の外です` };
                    let prev = pos - 1;
                    const dir = si % 2 ? 1 : -1;
                    for (let k = 0; k < len; k++) {
                        atoms.push({ element: 'C', x: 120 + (pos - 1) * X + (si % 2 ? 14 : -14) * k, y: 240 + dir * Y * (k + 1) });
                        bonds.push({ atom1Index: prev, atom2Index: atoms.length - 1, type: 1 });
                        prev = atoms.length - 1;
                    }
                }
                mol = g.createTargetFromData({ target: { atoms, bonds } });
                via = `骨格（主鎖${n}・${subs.join('／')}）`;
            }

            if (!mol) return { error: `「${spec.name}」が stages.json / compounds.json にありません。formula= か chain=/subs= を添えてください` };

            /* ★★ **名前で突き合わせる**（登録済みの1件は名前そのもので引いているので除く）。
               ⚠ これが無いと「原稿の名前と違う分子の図」が黙って焼ける */
            if (!entry) {
                const got = window.iupacName(mol);
                if (got !== spec.name) return { error: `組んだ分子の名前が「${got}」で、gen の name=「${spec.name}」と違います` };
            }

            /* ── ② アプリの描画をそのまま呼ぶ（★ ここに作図を書かない）──────────── */
            document.getElementById('figbake')?.remove();
            const box = document.createElement('div');
            box.id = 'figbake';
            const NS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(NS, 'svg');
            svg.id = 'figbake-svg';
            ['quiz-bonds', 'quiz-atoms'].forEach(c => {
                const gg = document.createElementNS(NS, 'g');
                gg.setAttribute('class', c);
                svg.appendChild(gg);
            });
            box.appendChild(svg);
            document.body.appendChild(box);
            /* ★ 書き出し練習の答え合わせに出るのと**同じ関数**。`this` は `game` を持つ物だけでよい */
            IsomerPractice.prototype.renderStandardFigure.call({ game: g }, svg.id, mol, !!spec.numbered);
            /* ★ 素の位置番号（`1 2 3 …`）だけを消す。⚠ 元素記号（`.svg-atom-text`）は残す
               ＝ 形にも結合にも触っていない（描いたあとで文字を1種類だけ取り去るだけ） */
            if (spec.plain) {
                svg.querySelectorAll('.quiz-atoms > text:not(.svg-atom-text)').forEach(t => t.remove());
            }

            /* ── ③ 大きさを決める（viewBox は renderMoleculeIntoSvg が付けている）──── */
            const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
            if (vb.length !== 4 || !vb[2] || !vb[3]) return { error: 'viewBox が取れませんでした' };
            /* ★ 狭い分子は左右に余白を足して、どの図も同じ横幅から始める（結合の長さをそろえる） */
            if (vb[2] < FIT_W) { vb[0] -= (FIT_W - vb[2]) / 2; vb[2] = FIT_W; svg.setAttribute('viewBox', vb.join(' ')); }
            let w = OUT_W, h = Math.round(OUT_W * vb[3] / vb[2]);
            if (h > MAX_H) { h = MAX_H; w = Math.round(MAX_H * vb[2] / vb[3]); }
            svg.style.width = (w / 2) + 'px';
            svg.style.height = (h / 2) + 'px';
            return { ok: true, via, w, h, aspect: vb[2] / vb[3], atoms: mol.atoms.length };
        }, { spec: job.spec, OUT_W, MAX_H, FIT_W });

        if (r.error) {
            console.error(`❌ reference-src/${job.id}.md の ${job.src}: ${r.error}`);
            await browser.close();
            process.exit(1);
        }
        if (r.aspect > ASPECT_WARN) {
            console.error(`❌ ${job.src} が平たすぎます（${r.aspect.toFixed(1)}:1）。`
                + `本文の幅では小さい字が読めません（床は ${ASPECT_WARN}:1）`);
            await browser.close();
            process.exit(1);
        }
        const el = await pg.$('#figbake-svg');
        const buf = await el.screenshot({ type: 'png' });
        writeFileSync(path.join(IMG, job.src), buf);
        done.push({ ...job, ...r, bytes: buf.length });
        console.log(`   ✅ ${job.src}  ${r.w}x${r.h}  ${(buf.length / 1024).toFixed(0)}KB`
            + `  ← ${job.spec.name}${job.spec.numbered ? '（番号つき）' : ''}  [${r.via}]`);
    }
    await browser.close();
    return done;
}

async function main() {
    let jobs;
    try { jobs = collect(); }
    catch (e) { console.log('❌ ' + e.message); process.exit(1); }

    if (!jobs.length) {
        console.log('焼く図はありません（:::figure に gen: を書いた図が対象です）');
        process.exit(0);
    }
    if (CHECK) {
        const missing = jobs.filter(j => !existsSync(path.join(IMG, j.src)));
        jobs.forEach(j => console.log(`   ${existsSync(path.join(IMG, j.src)) ? '✅' : '❌'} ${j.src}  ← ${j.gen}`));
        if (missing.length) {
            console.log(`❌ ${missing.length} 枚がまだ焼けていません（node tools/gen-figure.mjs --port=<ポート>）`);
            process.exit(1);
        }
        console.log(`✅ アプリで焼く図 ${jobs.length} 枚は、すべて reference-img/ に在ります`);
        process.exit(0);
    }
    console.log(`アプリの描画で ${jobs.length} 枚を焼きます（:${PORT}）`);
    const done = await bake(jobs);
    console.log(`✅ ${done.length} 枚を reference-img/ に焼きました`);
    console.log('   ⚠ 焼いたあとは `node tools/gen-reference.mjs` と `gen-reference-pages.mjs` を走らせてください');
}

await main();
