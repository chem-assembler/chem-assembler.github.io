/**
 * 参考書の本文を `reference-src/*.md` から `assembler/reference.json` へ生成する。
 *
 *   node tools/gen-reference.mjs            … 生成する（書き換える）
 *   node tools/gen-reference.mjs --check    … 書き換えずに「最新か」だけ見る（ずれていれば終了コード1）
 *
 * ★★ **正は `reference-src/<id>.md`。`assembler/reference.json` は生成物。**
 *    設計は `DESIGN_reference_book.md` §16。書式の実装は `tools/reference-md.js`（node と
 *    ブラウザで共有。ブラウザ側は `REF17` が同じ物差しで見る）。
 *
 * ⚠ **ディレクトリを読めるのは node 側だけ**なので、
 *    「原稿を足したのに `ORDER.txt` に書いていない」「原稿が余っている」を捕まえるのはここの仕事。
 *    ★ だから `tools/verify-release.js` の規則10 から `--check` を呼んでいる（コミット前の儀式に乗る）。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'reference-src');
const OUT = path.join(ROOT, 'assembler', 'reference.json');
const RM = require('./reference-md.js');

const CHECK = process.argv.slice(2).includes('--check');

/** 原稿を読んで並べる。★ 並び（＝索引に出る順）を決めるのは ORDER.txt だけ */
function buildPages() {
    const orderFile = path.join(SRC, 'ORDER.txt');
    if (!existsSync(orderFile)) throw new Error('reference-src/ORDER.txt がありません');
    const ids = RM.normalize(readFileSync(orderFile, 'utf8')).split('\n')
        .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    if (!ids.length) throw new Error('reference-src/ORDER.txt が空です');

    const files = readdirSync(SRC).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    const missing = ids.filter(id => files.indexOf(id) < 0);
    const extra = files.filter(id => ids.indexOf(id) < 0);
    if (missing.length) throw new Error(`ORDER.txt にあるのに原稿が無い: ${missing.join(', ')}（reference-src/<id>.md を置いてください）`);
    if (extra.length) throw new Error(`原稿があるのに ORDER.txt に無い: ${extra.join(', ')}（索引に出る順は ORDER.txt が決めます。1行足してください）`);
    if (new Set(ids).size !== ids.length) throw new Error('ORDER.txt に同じ id が2回あります');

    /* ★ `opts.pages` ＝ **いま在るページの id の全部**（＝ ORDER.txt そのもの）。
       `:::link` の行き先が在るかを、**読むときに**決めて `soon` として焼き込むために渡す（§20-7）。 */
    return ids.map(id => {
        const page = RM.parsePage(readFileSync(path.join(SRC, id + '.md'), 'utf8'), `reference-src/${id}.md`, { pages: ids });
        if (page.id !== id) throw new Error(`reference-src/${id}.md: 前書きの id が「${page.id}」でファイル名と違います`);
        return page;
    });
}

/** ★ まだ書いていないページのうち、本文からリンクしてよいもの（`PLANNED.txt`・設計書 §20-7）。
 *  返すのは `Map<id, 表示名>`。⚠ ファイルが無くてもよい（リンクを1本も張っていない間は要らない）。 */
function readPlanned() {
    const f = path.join(SRC, 'PLANNED.txt');
    const out = new Map();
    if (!existsSync(f)) return out;
    RM.normalize(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        const s = line.trim();
        if (!s || s.startsWith('#')) return;
        const m = /^([a-z0-9][a-z0-9-]*)\s+(\S.*)$/.exec(s);
        if (!m) throw new Error(`reference-src/PLANNED.txt:${i + 1} は「id␣␣表示名」の形で書きます → ${s}`);
        if (out.has(m[1])) throw new Error(`reference-src/PLANNED.txt: 「${m[1]}」が2回あります`);
        out.set(m[1], m[2].trim());
    });
    return out;
}

/* ★★ `:::link` の行き先を見る（設計書 §20-7）。⚠⚠ **ここでしか見られない** ——
 *   書式（`tools/reference-md.js`）は node とブラウザで共有していてディレクトリを読めない。
 *
 * ★ 見るのは3つ:
 *   ① `to:` が **在るページか、PLANNED.txt に登録されたページ**（＝ 綴り違いをその場で止める）
 *   ② ⚠ **PLANNED.txt に、もう書けているページが残っていない**（消し忘れ ＝ 計画が嘘になる）
 *   ③ `open:` は形だけ（⚠ **`OPEN_TARGETS` に実在するか**は `game.js` を読める `REF21` の仕事）
 */
function checkLinks(pages, planned) {
    const live = new Set(pages.map(p => p.id));
    [...planned.keys()].forEach(id => {
        if (live.has(id)) {
            throw new Error(`reference-src/PLANNED.txt: 「${id}」はもう書けています（reference-src/${id}.md）。`
                + 'この行を消してください（「まだ無いページ」の表なので、書けたものが残っていると計画が嘘になります）');
        }
    });
    pages.forEach(p => (p.blocks || []).forEach(b => {
        if (b.kind !== 'link' || !b.to) return;
        if (live.has(b.to) || planned.has(b.to)) return;
        throw new Error(`reference-src/${p.id}.md: :::link の行き先「${b.to}」がありません\n`
            + `   いま在るページ: ${[...live].join(' / ')}\n`
            + `   まだ無いがリンクしてよいページ: ${planned.size ? [...planned.keys()].join(' / ') : '(なし)'}\n`
            + '   ★ 綴りが合っているなら、reference-src/PLANNED.txt に1行足してください（「id␣␣表示名」）');
    }));
}

/* ★★ 著者メモ（`//` で始まる行）を数えて見せる（設計書 §20-2）。
 *
 * ⚠ **黙って捨てないための口。** メモは画面に出さないので、出さないことと消えたことが
 *   ユーザーから区別できない ＝ **数と場所を毎回言う**。
 * ★ 生成は止めない（メモは「まだ片付いていない注文」であって、書式の誤りではない）。
 */
function reportMemos(pages) {
    const all = [];
    pages.forEach(p => (p.memos || []).forEach(m => all.push({ id: p.id, ...m })));
    if (!all.length) return;
    console.log(`📝 まだ片付いていない著者メモ ${all.length} 件（画面には出しません）`);
    all.forEach(m => console.log(`   reference-src/${m.id}.md:${m.line}  ${m.text}`));
}

function main() {
    let pages;
    try {
        pages = buildPages();
        checkLinks(pages, readPlanned());
    } catch (e) {
        console.log('❌ ' + e.message);
        process.exit(1);
    }
    const text = RM.serialize(pages);
    reportMemos(pages);

    const now = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
    const same = now !== null && RM.normalize(now) === RM.normalize(text);

    if (CHECK) {
        if (same) {
            console.log(`✅ assembler/reference.json は reference-src/ と一致しています（${pages.length}ページ / ${RM.expectedLineCount(pages)}行）`);
            process.exit(0);
        }
        console.log('❌ assembler/reference.json が reference-src/*.md から生成したものと違います');
        console.log('   ★ reference.json は**生成物**です。原稿（reference-src/<id>.md）を直してから');
        console.log('     `node tools/gen-reference.mjs` を走らせてください');
        if (now !== null) {
            const a = RM.normalize(now).split('\n'), b = RM.normalize(text).split('\n');
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
                if (a[i] !== b[i]) {
                    console.log(`   最初に食い違う行: ${i + 1}`);
                    console.log(`     いまのファイル: ${(a[i] || '(行が無い)').slice(0, 160)}`);
                    console.log(`     原稿から生成  : ${(b[i] || '(行が無い)').slice(0, 160)}`);
                    break;
                }
            }
        }
        process.exit(1);
    }

    if (same) {
        console.log(`変更なし（${pages.length}ページ / ${RM.expectedLineCount(pages)}行）`);
        process.exit(0);
    }
    writeFileSync(OUT, text, 'utf8');
    const nb = pages.reduce((n, p) => n + p.blocks.length, 0);
    console.log(`✅ assembler/reference.json を生成しました（${pages.length}ページ / ${nb}ブロック / ${RM.expectedLineCount(pages)}行）`);
    pages.forEach(p => console.log(`   ${p.id}  ${p.title}（${p.blocks.length}ブロック）`));
}

main();
