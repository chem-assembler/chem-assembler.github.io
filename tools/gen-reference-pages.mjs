/**
 * 参考書の**面A**（`/reference/` の公開ページ）を生成する。
 *
 *   node tools/gen-reference-pages.mjs                  … :8486 のアプリを使って生成
 *   node tools/gen-reference-pages.mjs --port=8123      … 別のポート
 *   node tools/gen-reference-pages.mjs --check          … 出力が最新かだけ見る（書き換えない）
 *
 * ★★ **正は `reference-src/<id>.md`**（`DESIGN_reference_book.md` §16）。
 *    このページ群は**生成物**で、手で直しても次の生成で上書きされる（`REF18` が先に赤くする）。
 *
 * ★★ **なぜアプリを走らせて作るか**（設計書 §17-3・前のレーンからの申し送り）:
 *    `:::stageTable` などの囲みは「**どの表か**」しか言っておらず、**行は `learn.js` が
 *    `stages.json` / `reactions.json` / 列挙器から その場で組む**。
 *    ここに2本目の実装を書くと、`stages.json` を直したとき**面Aだけ古くなる**。
 *    ⚠ **だからこのファイルは表の行を1行も作らない** —— ヘッドレスで本体を動かし、
 *    `ReferenceBook.renderBlock` が返した DOM をそのまま焼く（`gen-isomer-pages.mjs` と同じ手）。
 *
 * ⚠ **読むファイルは4つだけ**: `reference-src/*.md`（本文の正）・`reference-src/ORDER.txt`（並び）・
 *    `assembler/style.css`（見た目を**切り出す**）・`qa/index.html`（計測スニペットを**切り出す**）。
 *    ★ `stages.json` も `reactions.json` も `compounds.json` も**開かない** ＝
 *      表を組む知識がこのファイルに1つも無いことが、依存の一覧から読める。
 *
 * **出力は自己完結**（CSS もインライン）。`?v=` 規約は「外部アセットを読むページ」の話なので
 * 対象外 ＝ 版を上げ忘れて古い実体が配られる事故が起きない（`/isomers/` と同じ）。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'reference-src');
const OUT = path.join(ROOT, 'reference');
const ORIGIN = 'https://chem.schoollenz.com';
const RM = require('./reference-md.js');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const PORT = (args.find(a => a.startsWith('--port=')) || '--port=8486').split('=')[1];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* URL に載せる `&`（HTML 属性なので実体参照にする） */
const amp = (s) => String(s).replace(/&/g, '&amp;');

/* ============================================================================
 * 原稿を読む（★ 並びを決めるのは ORDER.txt だけ ＝ 面Aは順を発明しない・R-3）
 * ========================================================================== */
function readPages() {
    const ids = RM.normalize(readFileSync(path.join(SRC, 'ORDER.txt'), 'utf8')).split('\n')
        .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    if (!ids.length) throw new Error('reference-src/ORDER.txt が空です');
    const files = readdirSync(SRC).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    const missing = ids.filter(id => files.indexOf(id) < 0);
    const extra = files.filter(id => ids.indexOf(id) < 0);
    if (missing.length) throw new Error(`ORDER.txt にあるのに原稿が無い: ${missing.join(', ')}`);
    if (extra.length) throw new Error(`原稿があるのに ORDER.txt に無い: ${extra.join(', ')}`);
    const pages = ids.map(id => RM.parsePage(readFileSync(path.join(SRC, id + '.md'), 'utf8'), `reference-src/${id}.md`));
    /* ⚠ **1つのコードが2ページに出てこないこと**（設計書 §17-5）。
       ★ アプリの埋め込みは `?open=reference&code=<先頭コード>` で、
         **どのページを開くかを決めるのは `ReferenceBook.pageByCode`**（1か所）。
         同じコードが2ページに在ると、先頭コードが自分のページへ戻らなくなる。 */
    const owner = new Map();
    pages.forEach(p => (p.codes || []).forEach(c => {
        if (owner.has(c)) throw new Error(`知識コード「${c}」が ${owner.get(c)} と ${p.id} の両方に在ります`
            + '（アプリの埋め込みは先頭コードでページを引くので、重なると別のページへ着地します）');
        owner.set(c, p.id);
    }));
    return pages;
}

/* ============================================================================
 * 見た目を `assembler/style.css` から**切り出す**（★ 書き写さない）
 *
 * ⚠ 焼いた HTML の class は `learn.js` が付けたもの。**規則を書き写すと、learn.js が
 *   class を足したときに面Aだけ地の色のまま残る**（`gen-isomer-pages.mjs` が計測スニペットを
 *   `qa/index.html` から切り出しているのと同じ理由）。
 * ========================================================================== */

/* 資料ペインの**枠**の規則（見出し・タブ・閉じる・索引ボタン）は面Aには要らない。
   ★ ここに挙げたものを `learn.js` がブロックの中で使い始めたら、下の照合が赤くなる */
const PANE_CHROME = ['.ref-head', '.ref-tabs', '.ref-tab', '.ref-title', '.ref-close', '.ref-body', '.ref-index-btn'];

/** style.css を「深さ0の規則」に割る（`@media` などの at-規則は丸ごと捨てる ＝ ペイン幅の話） */
function topLevelRules(css) {
    const rules = [];
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf('{', i);
        if (open < 0) break;
        let depth = 1, j = open + 1;
        while (j < css.length && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            j++;
        }
        const selector = css.slice(i, open);
        rules.push({ selector: selector.replace(/\/\*[\s\S]*?\*\//g, '').trim(), text: css.slice(i, j) });
        i = j;
    }
    return rules;
}

function refCss(cssText, usedClasses) {
    /* ⚠ **改行を LF にそろえる** —— assembler/style.css は CRLF なので、
       そのまま埋めると出力に CR が混ざり、`--check` の突き合わせ（LF に正規化して読む）と食い違う */
    cssText = String(cssText).replace(/\r\n/g, '\n');
    const rules = topLevelRules(cssText).filter(r => r.selector && !r.selector.startsWith('@'));
    const mine = rules.filter(r => /\.ref-/.test(r.selector) && !PANE_CHROME.some(c => r.selector.includes(c + ' ') || r.selector.includes(c + '.') || r.selector.includes(c + ',') || r.selector.trim().endsWith(c) || r.selector.includes(c + '{')));
    const dropped = rules.filter(r => /\.ref-/.test(r.selector) && mine.indexOf(r) < 0);

    /* ★★ **落とした規則が、焼いた HTML の class に当たっていないこと。**
       ⚠ 当たっていたら「アプリでは効いている見た目が、面Aだけ抜けている」状態なので止める。 */
    dropped.forEach(r => {
        [...r.selector.matchAll(/\.(ref-[A-Za-z0-9_-]+)/g)].forEach(m => {
            if (usedClasses.has(m[1])) {
                throw new Error(`assembler/style.css の「${r.selector.trim()}」は面Aで使う class「${m[1]}」に当たりますが、`
                    + '枠の規則として落としています（tools/gen-reference-pages.mjs の PANE_CHROME を見直すこと）');
            }
        });
    });

    /* ★ 焼いた HTML の `ref-` の class は、1つ残らず規則を持っていること
       （learn.js が class を足したら気づく。持たない class は**アプリでも無地**なので在ってはならない） */
    const covered = new Set();
    mine.forEach(r => [...r.selector.matchAll(/\.(ref-[A-Za-z0-9_-]+)/g)].forEach(m => covered.add(m[1])));
    const bare = [...usedClasses].filter(c => !covered.has(c)).sort();
    if (bare.length) {
        throw new Error(`焼いた HTML に、assembler/style.css に規則の無い class があります: ${bare.join(', ')}`
            + '（learn.js が class を足したなら style.css にも規則が要ります）');
    }
    const body = mine.map(r => r.text.trim()).join('\n');
    return rootVarsFor(cssText, body) + '\n' + body;
}

/* ★★ **色も書き写さない。** 切り出した規則が使っている `var(--…)` を、
 *    `assembler/style.css` の `:root` から**そのまま持ってくる**（依存も追う）。
 *
 * ⚠ **これが無かったときに実際に起きたこと**: `.ref-table` の
 *   `border: 1px solid var(--border-color)` の変数が面Aで未定義になり、
 *   **宣言ごと無効になって表の罫線が1本も出なかった**（画面は「それらしく」見えるので気づきにくい）。
 * ★ 見つからない変数はその場で赤（無言で無効になるより、止まったほうがよい）。
 */
function rootVarsFor(cssText, usedCss) {
    const m = cssText.match(/^:root\s*\{([\s\S]*?)\n\}/m);
    if (!m) throw new Error('assembler/style.css に :root の定義が見つからない（形が変わった？）');
    const defs = new Map();
    m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';').forEach(line => {
        const d = line.match(/^\s*(--[A-Za-z0-9_-]+)\s*:\s*([\s\S]+)$/);
        if (d) defs.set(d[1], d[2].trim());
    });
    /* ⚠ **`var(--x, 予備)` は要求しない** —— 予備が書いてあるものは、定義が無くても
       宣言ごと無効にはならない（実際 `--color-bg` は :root に無いまま予備で使われている）。
       ★ 求めるのは**予備の無い `var(--x)`** だけ ＝ 落ちると黙って効かなくなるもの。 */
    const refs = (text) => [...text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g)]
        .filter(x => x[2] === ')').map(x => x[1]);
    const want = new Set(), queue = refs(usedCss);
    while (queue.length) {
        const name = queue.shift();
        if (want.has(name)) continue;
        if (!defs.has(name)) throw new Error(`assembler/style.css の :root に「${name}」が無い`
            + '（予備の無い var() は、定義が無いと宣言ごと無言で無効になります）');
        want.add(name);
        refs(defs.get(name)).forEach(n => queue.push(n));
    }
    return ':root{' + [...want].sort().map(n => n + ':' + defs.get(n)).join(';') + '}';
}

/* 計測スニペットは実物から切り出す（`gen-isomer-pages.mjs` と同じ。書き写すと片方だけ古くなる） */
function analyticsSnippet() {
    const src = readFileSync(path.join(ROOT, 'qa', 'index.html'), 'utf8');
    const m = src.match(/<!-- Google tag \(gtag\.js\)[\s\S]*?gtag\('config', 'G-403BPCLQ0D'\);\s*<\/script>/);
    if (!m) throw new Error('qa/index.html から計測スニペットを切り出せない（形が変わった？）');
    return m[0].replace(/\r\n/g, '\n');
}

/* ============================================================================
 * ページの器（★ 自己完結。外部アセットは読まない）
 * ========================================================================== */
const SHELL_CSS = `
/* ★ この5つは面Aの器だけの色（表と例題の色は assembler/style.css の :root から
   切り出したものが下に続く ＝ アプリと同じ色で出る） */
:root{--bg:#0a0c10;--panel:#0f141c;--line:rgba(255,255,255,.10);--fg:#f5f6fa;--dim:#a0a8c0;--accent:#00f2fe}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"Noto Sans JP",system-ui,sans-serif;line-height:1.8}
.wrap{max-width:860px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line);padding:10px 0;font-size:13px}
header a{color:var(--dim);text-decoration:none}
header a:hover{color:var(--accent)}
h1{font-size:clamp(21px,4.6vw,31px);margin:26px 0 10px;line-height:1.45}
h2{font-size:17px;margin:36px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:15px;margin:26px 0 8px;color:var(--dim)}
.lede{color:var(--dim);margin:0 0 20px;font-size:15px}
.unit-label{display:inline-block;font-size:12px;color:var(--dim);border:1px solid var(--line);
border-radius:999px;padding:2px 11px;margin:0 6px 6px 0}
/* 索引 */
.idx{list-style:none;padding:0;margin:0 0 26px;display:grid;gap:12px}
.idx li{background:var(--panel);border:1px solid var(--line);border-radius:12px}
.idx a{display:block;padding:14px 16px;text-decoration:none;color:var(--fg)}
.idx a:hover{border-color:var(--accent)}
.idx b{display:block;font-size:16px;margin-bottom:5px}
.idx span{display:block;font-size:13px;color:var(--dim);line-height:1.7}
/* 本文（表と例題の規則は assembler/style.css から切り出したものが下に続く） */
.ref-scope{font-size:15.5px}
.ref-scope .ref-p{font-size:15.5px;line-height:1.95}
/* ⚠ 表は**器の幅いっぱいに引き伸ばさない**（ペインは 340px なので 100% でよいが、
   860px の読み物では「C の数」の列が 250px になって数字と名称が離れる） */
.ref-scope .ref-table{font-size:14px;width:auto}
.ref-scope .ref-mech-table,.ref-scope .ref-map-table{font-size:14px}
.ref-scope .ref-cap{font-size:13px;margin-bottom:8px}
.ref-scope .ref-table-wrap{margin-bottom:26px}
.ref-scope .ref-example{font-size:14.5px}
.ref-scope .ref-example h4{font-size:15px}
.ref-scope .ref-note{font-size:13px}
.ref-scope a.ref-try,.ref-scope a.ref-mech-play{display:inline-block;text-decoration:none}
/* 埋め込み（★ 押してから読み込む。置いただけで相手の page_view が飛ばないように） */
.embed{margin:26px 0;padding:18px;background:var(--panel);border:1px solid var(--accent);border-radius:12px}
.embed b{display:block;font-size:15px;margin-bottom:4px}
.embed p{margin:0;color:var(--dim);font-size:13.5px}
.embed button{margin-top:12px;background:var(--accent);color:#06202a;font-weight:700;font-size:14px;
border:0;padding:11px 20px;border-radius:8px;cursor:pointer;font-family:inherit}
.embed button:hover{filter:brightness(1.1)}
.embed iframe{width:100%;height:640px;border:1px solid var(--line);border-radius:10px;margin-top:12px;background:#fff}
.embed .alt{display:inline-block;margin-top:10px;margin-left:14px;color:var(--accent);font-size:13px}
/* ★★ 2カラム（設計書 §19-1・ユーザー承認）——「検索から飛んできたけど自分が欲しい情報が
   どこにあるかわからない」を避けるための目次。⚠ **狭い面では上の折りたたみに落とす**（同じ markup）。
   ⚠ markup は learn.js の renderToc が組んだもの ＝ 面A側に2本目の目次を持たない（§19-6） */
.ref-layout{display:block}
.ref-toc{margin:22px 0 8px}
.ref-toc details{background:var(--panel);border:1px solid var(--line);border-radius:12px}
.ref-toc summary{padding:11px 14px;font-size:13.5px;color:var(--dim);cursor:pointer}
.ref-toc ul{list-style:none;margin:0;padding:0 14px 12px}
.ref-toc li{margin:0 0 7px}
.ref-toc a{font-size:13.5px;color:var(--fg);text-decoration:none;line-height:1.6}
.ref-toc a:hover{color:var(--accent)}
.ref-toc a[aria-current="true"]{color:var(--accent);font-weight:700}
@media (min-width:1000px){
  .ref-layout{display:grid;grid-template-columns:224px minmax(0,1fr);gap:32px;align-items:start}
  .ref-toc{position:sticky;top:14px;margin:26px 0 0}
  .ref-toc summary{display:none}
  .ref-toc details{background:none;border:0;border-left:1px solid var(--line);border-radius:0}
  .ref-toc ul{padding:0 0 0 14px}
}
/* 節。★ 追従ヘッダーは無いが、アンカーで着地したとき見出しが窓の上端に貼り付かないよう余白を置く */
.ref-scope .ref-sec{scroll-margin-top:18px;margin:38px 0 12px}
.ref-scope .ref-sec-h{font-size:19px;color:var(--fg);padding-bottom:8px}
.ref-scope .ref-sec-lead{font-size:14px;color:var(--dim)}
.ref-scope .ref-list{font-size:15px}
.ref-scope .ref-figure{margin:0 0 22px}
.ref-scope .ref-figure-cap{font-size:13px}
.ref-scope .ref-rx{margin:0 0 22px;padding:14px 16px}
.ref-scope .ref-rx-eq{font-size:16.5px}
.ref-scope .ref-hand-table{font-size:14px}
.ref-scope .ref-callout{margin:0 0 22px;padding:12px 16px}
.ref-scope .ref-callout-text{font-size:14.5px}
/* 用語の索引（★ 機械で組む・§19-7） */
.terms{list-style:none;padding:0;margin:0 0 26px}
.terms li{border-bottom:1px solid var(--line);padding:9px 2px;font-size:14.5px}
.terms a{color:var(--fg);text-decoration:none}
.terms a:hover{color:var(--accent)}
.terms span{display:block;font-size:12.5px;color:var(--dim);margin-top:2px}
/* 前後・索引へ */
nav.seq{display:flex;flex-wrap:wrap;gap:14px;margin:34px 0;font-size:14px}
nav.seq a{color:var(--accent);text-decoration:none}
footer{border-top:1px solid var(--line);margin-top:36px;padding:16px 0 44px;color:var(--dim);font-size:12px}
footer a{color:inherit}
`.trim();

function page({ title, desc, canonical, crumb, body, css }) {
    return `<!doctype html>
<html lang="ja">
<head>
${analyticsSnippet()}

<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- AI 学習・生成への利用を拒否する意思表示（ルートの robots.txt と対） -->
<meta name="robots" content="noai, noimageai">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="SchoolLenz">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ORIGIN}/brand/og-chem.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>${SHELL_CSS}
${css}</style>
</head>
<body>
<header><div class="wrap">${crumb}</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">表は<a href="/assembler/">パズルでみる有機化学</a>が出題データからその場で組んだものです。
Schoollenz ／ 化学レンズ　·　<a href="/privacy.html">プライバシーポリシー</a></div></footer>
</body>
</html>
`;
}

/* ★ 埋め込みは**押してから読み込む**（設計書 §17-4）。
   ⚠ 置いただけだと `/qa/` `/assembler/` が自分で `page_view` を送るので、
      **開いてもいない一問一答が、参考書を開いた回数だけ数えられる**。 */
const EMBED_JS = `<script>
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('button[data-embed]') : null;
  if (!b) return;
  var f = document.createElement('iframe');
  f.src = b.getAttribute('data-embed');
  f.setAttribute('loading', 'lazy');
  f.setAttribute('title', b.getAttribute('data-embed-title') || '');
  b.parentNode.appendChild(f);
  b.remove();
});
</script>`;

/* ★ 目次の器（§19-6）。⚠ **中身は `learn.js` の `renderToc` が組んだもの**で、ここは2つだけやる:
 *   ① 広い画面では `<details>` を開く（閉じていると中身が描かれないので、追従の目次にならない）
 *   ② いま読んでいる節を光らせる
 * ⚠ どちらも**見え方**の話。★ 目次の行そのものは1行もここで作らない。 */
const TOC_JS = `<script>
(function () {
  var d = document.querySelector('.ref-toc details');
  if (!d) return;
  var wide = window.matchMedia('(min-width: 1000px)');
  var sync = function () { if (wide.matches) d.open = true; };
  sync();
  if (wide.addEventListener) wide.addEventListener('change', sync);
  var links = {};
  [].forEach.call(d.querySelectorAll('a[href^="#"]'), function (a) { links[a.getAttribute('href').slice(1)] = a; });
  var secs = [].filter.call(document.querySelectorAll('.ref-scope [id]'), function (s) { return links[s.id]; });
  if (!secs.length || !window.IntersectionObserver) return;
  var seen = {};
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { seen[e.target.id] = e.isIntersecting; });
    var cur = null;
    secs.forEach(function (s) { if (seen[s.id] && !cur) cur = s.id; });
    for (var k in links) links[k].setAttribute('aria-current', k === cur ? 'true' : 'false');
  }, { rootMargin: '0px 0px -70% 0px' });
  secs.forEach(function (s) { io.observe(s); });
})();
</script>`;

function embedBox(label, lead, src, alt) {
    return `<div class="embed"><b>${esc(label)}</b><p>${esc(lead)}</p>`
        + `<button type="button" data-embed="${amp(src)}" data-embed-title="${esc(label)}">${esc(label)}</button>`
        + (alt ? `<a class="alt" href="${amp(src)}" target="_blank" rel="noopener">別のタブで開く</a>` : '')
        + '</div>';
}

/* ============================================================================
 * 1ページ
 * ========================================================================== */
function referencePage(p, blocksHtml, tocHtml, prev, next) {
    const utm = `&utm_source=reference&utm_medium=internal&utm_campaign=${p.id}`;
    const crumb = `<a href="/">化学レンズ</a> ／ <a href="/assembler/">パズルでみる有機化学</a> ／ <a href="/reference/">参考書</a>`;

    /* ★ 動画は `video:` が在るページだけ。⚠ 無ければ**枠そのものを出さない**（`REF18` ⑤） */
    const video = p.video
        ? `<h2>解説動画</h2>\n` + embedBox('▶ 解説動画を見る', 'このページの表の読み方を、操作しながら順に説明します。',
            `https://www.youtube-nocookie.com/embed/${p.video}`, true)
        : '';

    const qaSrc = `/qa/?codes=${p.codes.map(encodeURIComponent).join(',')}&mode=choice&from=reference`;
    const appSrc = `/assembler/?open=reference&code=${encodeURIComponent(p.codes[0])}`;

    const body = `<h1>${esc(p.title)}</h1>
<p class="lede">${esc(p.summary)}</p>
<div><span class="unit-label">${esc(p.unitLabel)}</span><span class="unit-label">${esc(p.group)}</span></div>
${video}
<div class="ref-layout">
${tocHtml || ''}
<div class="ref-scope">
${blocksHtml.join('\n')}
</div>
</div>

<h2>解けるか試す</h2>
${embedBox(`▶ 一問一答で解く（${p.codes.length}問・測定モード）`,
        'このページが扱う知識項目を、複数選択で採点します。読んだその場で、覚えたかではなく解けるかを確かめられます。', qaSrc, true)}

<h2>読みながら組む</h2>
${embedBox('▶ アプリの中で開く', 'このページを資料ペインに開いた状態のアプリです。左で表を読みながら、右で分子を組めます。', appSrc, true)}

<nav class="seq">${prev ? `<a href="/reference/${prev.id}/">← ${esc(prev.title)}</a>` : ''}
<a href="/reference/">参考書の目次</a>
<a href="/reference/terms/">用語から引く</a>
${next ? `<a href="/reference/${next.id}/">${esc(next.title)} →</a>` : ''}</nav>
${EMBED_JS}
${tocHtml ? TOC_JS : ''}`;

    return { crumb, body, utm };
}

/* ============================================================================
 * ★★ 用語の索引（設計書 §19-7）
 *
 * ★ ユーザーの要件は「**ページを増やさずに、節へ引けること**」——
 *   「マルコフニコフ則」「ヨードホルム反応」で調べに来た人を、ページの真ん中へ着地させる。
 *
 * ⚠ **手で並べない。** 見出し語の出どころは2つだけで、どちらも `:::section` の中にある:
 *   ① 節の `title`（全部・自動）
 *   ② 節の `terms:`（任意の並び。★ **索引という別の台帳を作らない** ＝ 節に書く）
 *
 * ⚠ `qa/questions.json` の316コードからは引いていない —— **用語の欄が無い**ため（§19-7）。
 * ⚠ 並びは `localeCompare('ja')`。**読みを持っていないので漢字はコードポイント順**に落ちる。
 * ========================================================================== */
function collectTerms(pages) {
    const rows = [];
    pages.forEach(p => (p.blocks || []).forEach(b => {
        if (b.kind !== 'section') return;
        const where = { pageId: p.id, pageTitle: p.title, group: p.group, anchor: b.anchor, section: b.title };
        rows.push({ term: b.title, ...where });
        (b.terms || []).forEach(t => rows.push({ term: t, ...where }));
    }));
    rows.sort((a, b) => a.term.localeCompare(b.term, 'ja') || a.pageId.localeCompare(b.pageId));
    return rows;
}

function termsPage(pages) {
    const rows = collectTerms(pages);
    const body = `<h1>用語から引く</h1>
<p class="lede">参考書のどのページのどの節に、その言葉が出てくるか。
節の見出しと、節が扱う用語から<b>機械で作った索引</b>です（${rows.length}件）。
押すとページの途中 —— その言葉を説明している節 —— に直接着地します。</p>
<ul class="terms">${rows.map(r =>
        `<li><a href="/reference/${r.pageId}/#ref-sec-${r.anchor}">${esc(r.term)}`
        + `<span>${esc(r.pageTitle)} ／ ${esc(r.section)}</span></a></li>`).join('\n')}</ul>
<nav class="seq"><a href="/reference/">参考書の目次</a></nav>`;
    return page({
        title: '用語から引く ｜ 化学の参考書',
        desc: `有機化学の用語から、参考書の該当する節へ直接飛べる索引（${rows.length}件）。`
            + '節の見出しと各節が扱う用語から機械で作っています。',
        canonical: `${ORIGIN}/reference/terms/`,
        crumb: '<a href="/">化学レンズ</a> ／ <a href="/assembler/">パズルでみる有機化学</a> ／ <a href="/reference/">参考書</a> ／ 用語',
        body, css: '',
    });
}

/* ★ 索引は `unit` → `group` の2階層（R-3）。⚠ **並びは ORDER.txt のまま**（順を発明しない） */
function indexPage(pages) {
    const units = [];
    pages.forEach(p => {
        let u = units.find(x => x.unit === p.unit);
        if (!u) { u = { unit: p.unit, label: p.unitLabel, groups: [] }; units.push(u); }
        let g = u.groups.find(x => x.name === p.group);
        if (!g) { g = { name: p.group, pages: [] }; u.groups.push(g); }
        g.pages.push(p);
    });
    const body = `<h1>化学の参考書 — 表で読む有機化学</h1>
<p class="lede">1つの分子を見ているだけでは規則にならないことを、<b>並べて</b>読むページです。
どの表もアプリの出題データからその場で組んだもので、抜けも重複もありません。
読んだあとは、同じ画面で一問一答を解いたり、分子を組んだりできます。</p>
<nav class="seq"><a href="/reference/terms/">用語から引く（マルコフニコフ則・置換反応…）</a></nav>
${units.map(u => `<h2>${esc(u.label)}</h2>\n` + u.groups.map(g =>
        `<h3>${esc(g.name)}</h3>\n<ul class="idx">` + g.pages.map(p =>
            `<li><a href="/reference/${p.id}/"><b>${esc(p.title)}</b><span>${esc(p.summary)}</span></a></li>`
        ).join('') + '</ul>').join('\n')).join('\n')}`;
    return page({
        title: '化学の参考書 — 表で読む有機化学 ｜ 化学レンズ',
        desc: '有機化学を「1分子では見えない規則」の側から読む参考書。表はすべてアプリが出題データから数え上げたもので、読んだその場で一問一答を解き、分子を組んで確かめられます。',
        canonical: `${ORIGIN}/reference/`,
        crumb: '<a href="/">化学レンズ</a> ／ <a href="/assembler/">パズルでみる有機化学</a> ／ 参考書',
        body,
        css: '',
    });
}

/* ============================================================================
 * ここから収集（★ ヘッドレスで本体を動かす）
 * ========================================================================== */
const pages = readPages();

const pwRequire = createRequire(path.join(HERE, 'record', 'package.json'));
const { chromium } = pwRequire('playwright');
const browser = await chromium.launch();
const pg = await browser.newPage();
const base = `http://localhost:${PORT}`;
try {
    await pg.goto(`${base}/assembler/`, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(
        () => window.referenceBook && window.STAGES && window.STAGES.length
            && window.reactionPlayer && Array.isArray(window.reactionPlayer.reactions) && window.reactionPlayer.reactions.length,
        null, { timeout: 30000 });
} catch (e) {
    console.error(`❌ ${base}/assembler/ を開けません（表を組むのは learn.js なので、本体が要ります）。`);
    console.error('   リポジトリのルートを配信するローカルサーバーを立ててから実行してください');
    await browser.close();
    process.exit(1);
}

const baked = [];
for (const p of pages) {
    const r = await pg.evaluate((page) => {
        const book = window.referenceBook;
        const out = [];
        const classes = new Set();
        const leftovers = [];
        for (const b of page.blocks) {
            const el = book.renderBlock(b);
            if (!el) return { error: `描けないブロック「${b.kind}」` };
            /* ★ 押しもの → リンク。**静的なページに、押しても何も起きないボタンを残さない** */
            el.querySelectorAll('button').forEach((btn) => {
                const a = document.createElement('a');
                a.className = btn.className;
                if (btn.classList.contains('ref-mech-play') && btn.dataset.rxId) {
                    a.href = '/assembler/?open=mechanism&id=' + encodeURIComponent(btn.dataset.rxId)
                        + '&utm_source=reference&utm_medium=internal&utm_campaign=' + page.id;
                } else if (btn.classList.contains('ref-try')) {
                    /* ⚠ ステージを名指しする受け口は無いので、**そのページの面B**へ渡す
                       （着いた先に同じ「▶ 組んでみる」が在り、そこで採点まで進める） */
                    a.href = '/assembler/?open=reference&code=' + encodeURIComponent(page.codes[0])
                        + '&utm_source=reference&utm_medium=internal&utm_campaign=' + page.id;
                } else {
                    leftovers.push(btn.className || '(class なし)');
                    return;
                }
                if (btn.title) a.title = btn.title;
                a.textContent = btn.textContent;
                btn.parentNode.replaceChild(a, btn);
            });
            el.querySelectorAll('[class]').forEach((n) => {
                String(n.className).split(/\s+/).forEach((c) => { if (c.indexOf('ref-') === 0) classes.add(c); });
            });
            if (el.className) String(el.className).split(/\s+/).forEach((c) => { if (c.indexOf('ref-') === 0) classes.add(c); });
            out.push(el.outerHTML);
        }
        /* ★★ 目次も **アプリに組ませる**（`renderToc`）。⚠ ここで組むと、`:::section` を足したとき
           面Aの目次だけ古くなる（表を2か所で組まないのと同じ理由・設計書 §19-6）。 */
        const toc = book.renderToc(page);
        if (toc) {
            toc.querySelectorAll('[class]').forEach((n) => {
                String(n.className).split(/\s+/).forEach((c) => { if (c.indexOf('ref-') === 0) classes.add(c); });
            });
            String(toc.className).split(/\s+/).forEach((c) => { if (c.indexOf('ref-') === 0) classes.add(c); });
        }
        return { html: out, toc: toc ? toc.outerHTML : '', classes: [...classes], leftovers };
    }, p);

    if (r.error) { console.error(`❌ ${p.id}: ${r.error}`); await browser.close(); process.exit(1); }
    if (r.leftovers.length) {
        console.error(`❌ ${p.id}: リンクに置き換えられない押しものが残りました（${r.leftovers.join(', ')}）。`);
        console.error('   静的なページでは押しても何も起きません。gen-reference-pages.mjs の変換を足してください');
        await browser.close();
        process.exit(1);
    }
    if (/<button/i.test(r.html.join(''))) {
        console.error(`❌ ${p.id}: 焼いた HTML に <button> が残っています`);
        await browser.close();
        process.exit(1);
    }
    baked.push({ p, html: r.html, toc: r.toc, classes: r.classes });
    console.log(`  ${p.id.padEnd(22)} ${r.html.length} ブロック / class ${r.classes.length} 種`
        + (r.toc ? ` / 目次 ${(r.toc.match(/<li>/g) || []).length} 節` : ''));
}
await browser.close();

/* ---------------- 書き出し ---------------- */

const usedClasses = new Set(baked.flatMap(b => b.classes));
let CSS;
try {
    CSS = refCss(readFileSync(path.join(ROOT, 'assembler', 'style.css'), 'utf8'), usedClasses);
} catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
}

const files = new Map();
files.set(path.join(OUT, 'index.html'), indexPage(pages));
files.set(path.join(OUT, 'terms', 'index.html'), termsPage(pages));
baked.forEach(({ p, html, toc }, i) => {
    const { crumb, body } = referencePage(p, html, toc, pages[i - 1] || null, pages[i + 1] || null);
    files.set(path.join(OUT, p.id, 'index.html'), page({
        title: `${p.title} ｜ 化学の参考書`,
        desc: p.summary,
        canonical: `${ORIGIN}/reference/${p.id}/`,
        crumb, body, css: CSS,
    }));
});

if (CHECK) {
    let bad = 0;
    for (const [file, want] of files) {
        const got = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
        if (got !== want) { console.error('❌ 古い/無い: ' + path.relative(ROOT, file).replace(/\\/g, '/')); bad++; }
    }
    const known = new Set([...files.keys()].map(f => path.relative(ROOT, f).replace(/\\/g, '/')));
    if (existsSync(OUT)) {
        readdirSync(OUT, { withFileTypes: true }).forEach(d => {
            const rel = `reference/${d.name}` + (d.isDirectory() ? '/index.html' : '');
            if (!known.has(rel)) { console.error('❌ 余分: ' + rel + '（ORDER.txt から消した？）'); bad++; }
        });
    }
    if (bad) { console.error('\n`node tools/gen-reference-pages.mjs` で作り直してください'); process.exit(1); }
    console.log(`✅ ${files.size} ページとも原稿（reference-src/）から生成したものと一致しています`);
    process.exit(0);
}

/* ⚠ ORDER.txt から消えたページのディレクトリは**残さない**（消したはずのページが配られ続ける） */
if (existsSync(OUT)) {
    const known = new Set([...files.keys()].map(f => path.relative(ROOT, f).replace(/\\/g, '/')));
    readdirSync(OUT, { withFileTypes: true }).forEach(d => {
        const rel = `reference/${d.name}` + (d.isDirectory() ? '/index.html' : '');
        if (!known.has(rel)) {
            rmSync(path.join(OUT, d.name), { recursive: true, force: true });
            console.log('   （消した）' + rel);
        }
    });
}
for (const [file, html] of files) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, html, 'utf8');
}
console.log(`\n✅ ${files.size} ページを書き出しました（reference/）`);
console.log('   sitemap も作り直してください: node tools/gen-sitemap.js');
