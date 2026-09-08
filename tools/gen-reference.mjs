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

    return ids.map(id => {
        const page = RM.parsePage(readFileSync(path.join(SRC, id + '.md'), 'utf8'), `reference-src/${id}.md`);
        if (page.id !== id) throw new Error(`reference-src/${id}.md: 前書きの id が「${page.id}」でファイル名と違います`);
        return page;
    });
}

function main() {
    let pages;
    try {
        pages = buildPages();
    } catch (e) {
        console.log('❌ ' + e.message);
        process.exit(1);
    }
    const text = RM.serialize(pages);

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
