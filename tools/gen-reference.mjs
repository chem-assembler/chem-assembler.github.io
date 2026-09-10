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

const ARGS = process.argv.slice(2);
const CHECK = ARGS.includes('--check');
/* ★★ 表記を揃えて**原稿を書き戻す**（REFBOOK_STYLE.md §3）。⚠ 揃えた所は1件ずつ画面に出す。
   `node tools/gen-reference.mjs --tidy [ページのid …]` … id を書けばその原稿だけ */
const TIDY = ARGS.includes('--tidy');
const TIDY_ONLY = ARGS.filter(a => !a.startsWith('--'));
const RT = require('./reference-tidy.js');

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

/* ★★ 図のファイル（`reference-img/`）を見る（設計書 §20-10）。⚠⚠ **ここでしか見られない** ——
 *   `:::link` の行き先と同じで、**ディレクトリを読めるのは node 側だけ**（§16-5 の役割分担）。
 *   ブラウザ側の `REF19` ④ は「本文が名指しした図が HTTP で取れるか」を見る ＝ 向きが逆。
 *
 * ★ 見るのは3つ:
 *   ① 名指しした図が `reference-img/` に在る（★ `REF19` ④ より**早く**止まる。生成の前）
 *   ② ⚠⚠ **どのページからも参照されていない図が残っていない** —— 実際に1枚あった
 *      （`alkane-formula-derivation.png`。焼いたのに本文から名指ししないまま置かれていた）。
 *      ⚠ **図は一度置くと履歴に残る**（§19-4）ので、使わないものが黙って増えるのがいちばん困る。
 *   ③ ★★ **平たすぎる図が無い** —— 本文の幅に入れたときの高さが床を下回らないこと。
 *
 * ⚠⚠ ③ の 10:1 は「measured されて決まった値」ではない（§12-5 の戒め）。**線の引き方はこう**:
 *   ・実際に読めなかったのが **14:1**（連続置換の帯・572px 幅で高さ 41px。橙の添え字が 7px 相当）
 *   ・割ったあとに残ったいちばん平たい図が **7.7:1**（同・74px）
 *   ★ ＝ **落としたものより上、残したものより下**に引いた1本。図が増えたら引き直してよい。
 */
const IMG_DIR = path.join(ROOT, 'reference-img');
const BODY_WIDTH = 572;   // 面A（/reference/<id>/）の本文の幅。面B（資料ペイン）はもっと狭い
const MAX_ASPECT = 10;    // 幅 ÷ 高さ。10:1 ＝ 572px 幅で高さ 57px

/** PNG の IHDR から幅と高さを取る。⚠ 画像ライブラリを足さない（16バイト読むだけで済む） */
function pngSize(file) {
    const b = readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;   // PNG でなければ測らない
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* ★★ 図を名指しできる欄の台帳。⚠ **`:::figure` の `src` だけではない** ——
 *   `:::exercise`（例題・設計書 §22）は**問い側と解答側**の2つに図を置ける。
 * ⚠⚠ 新しい器に図の欄を足したら、**ここにも足す**。足し忘れると
 *   「どのページからも参照されていない図」で生成が止まる（＝ 黙っては壊れないが、
 *   その図を消すまで生成が通らない）。★ `REF23` がこの台帳と原稿の食い違いを見張る。 */
const FIGURE_KEYS = { figure: ['src'], exercise: ['promptSrc', 'answerSrc'] };

function checkFigures(pages) {
    const used = new Map();   // ファイル名 → { ページ, 器の名前 }
    pages.forEach(p => (p.blocks || []).forEach(b => {
        (FIGURE_KEYS[b.kind] || []).forEach(k => {
            if (b[k] && !used.has(b[k])) used.set(b[k], { id: p.id, kind: b.kind });
        });
    }));
    const onDisk = existsSync(IMG_DIR) ? readdirSync(IMG_DIR).filter(f => !f.startsWith('.')) : [];

    [...used.keys()].forEach(src => {
        if (onDisk.indexOf(src) < 0) {
            throw new Error(`reference-src/${used.get(src).id}.md: :::${used.get(src).kind} の「${src}」が reference-img/ にありません\n`
                + `   いま在る図: ${onDisk.length ? onDisk.join(' / ') : '(なし)'}\n`
                + '   ★ 綴りが合っているなら、その図をまだ焼いていません（reference-img/ に置いてください）');
        }
    });

    const orphans = onDisk.filter(f => !used.has(f));
    if (orphans.length) {
        throw new Error(`reference-img/ に、どのページからも参照されていない図が ${orphans.length} 枚あります → ${orphans.join(' / ')}\n`
            + '   ★ 直し方は2通り: 使うなら本文で名指しします'
            + `（${Object.entries(FIGURE_KEYS).map(([k, v]) => ':::' + k + ' の ' + v.join(' / ')).join('、')}）。`
            + '使わないなら消してください\n'
            + '   ⚠ 図は一度置くと履歴に残るので、使わないものを置いたままにしません');
    }

    onDisk.forEach(f => {
        const size = pngSize(path.join(IMG_DIR, f));
        if (!size || !size.h) return;                       // PNG 以外は測らない
        const aspect = size.w / size.h;
        if (aspect <= MAX_ASPECT) return;
        const shown = Math.round(BODY_WIDTH * size.h / size.w);
        throw new Error(`reference-img/${f} が平たすぎます（${size.w}x${size.h} ＝ ${aspect.toFixed(1)}:1）\n`
            + `   本文の幅 ${BODY_WIDTH}px に入れると高さ ${shown}px にしかならず、図に添えた小さい字が読めません\n`
            + `   ★ 直し方: スライドの横一列をそのまま帯で切らずに、2枚以上に割って焼き直してください`
            + `（床は ${MAX_ASPECT}:1 ＝ 高さ ${Math.round(BODY_WIDTH / MAX_ASPECT)}px）`);
    });
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

/* ★★ 表記を揃えて原稿を書き戻す（REFBOOK_STYLE.md §3）。
 *
 * ⚠⚠ **黙って揃えない。** 直した所を**1件ずつ**（ファイル・行・規則・前・後）出す ——
 *   §1 の「勝手に揃えたものは、必ず一覧で見せる」がこの道具の存在理由そのもの。
 * ⚠ 揃えるのは**元に戻せる表記**だけ（`tools/reference-tidy.js` の頭に線が書いてある）。
 * ★ 生成（`reference.json`）はしない —— 揃えてから、あらためて生成し直す。
 */
function runTidy() {
    const files = readdirSync(SRC).filter(f => f.endsWith('.md'))
        .filter(f => !TIDY_ONLY.length || TIDY_ONLY.includes(f.replace(/\.md$/, '')));
    if (!files.length) {
        console.log('❌ 揃える原稿がありません（reference-src/ に .md が無いか、指定した id が違う）');
        process.exit(1);
    }
    let total = 0;
    files.forEach(f => {
        const p = path.join(SRC, f);
        const res = RT.tidy(readFileSync(p, 'utf8'));
        if (!res.changes.length) return;
        total += res.changes.length;
        writeFileSync(p, res.text, 'utf8');
        console.log(`\n📄 reference-src/${f} … ${res.changes.length} か所`);
        res.changes.forEach(c => {
            console.log(`   ${c.line}行  [${c.rule}]`);
            console.log(`      前: ${c.before.trim().slice(0, 100)}`);
            console.log(`      後: ${c.after.trim().slice(0, 100)}`);
        });
    });
    console.log(total
        ? `\n✅ ${files.length} 枚を見て ${total} か所そろえました（★ この一覧が「勝手に揃えたもの」の全部です）`
        : `✅ ${files.length} 枚とも、そろえる所はありませんでした`);
    console.log('   ⚠ 揃えたあとは `node tools/gen-reference.mjs` で生成し直してください');
    process.exit(0);
}

function main() {
    if (TIDY) runTidy();
    let pages;
    try {
        pages = buildPages();
        checkLinks(pages, readPlanned());
        checkFigures(pages);
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
