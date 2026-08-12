/**
 * 分子式ごとの「異性体は何種類か」ページを生成する（検索チャネルの第1弾）。
 *
 *   node tools/gen-isomer-pages.mjs                     … :8201 のアプリを使って生成
 *   node tools/gen-isomer-pages.mjs --port=8123         … 別のポート
 *   node tools/gen-isomer-pages.mjs --check             … 出力が最新かだけ見る（書き換えない）
 *
 * **なぜアプリを走らせて作るか**: 異性体の顔ぶれと構造式は、アプリの列挙エンジン
 * （chemistry.js の enumerateConstitutionalIsomers）と描画（renderMoleculeIntoSvg）が正。
 * ページ側に同じ知識を書き写すと、**エンジンを直したときにページだけ古くなる**。
 * ここではヘッドレスで本体を動かし、出てきた SVG をそのまま焼く。
 *
 * **出力は自己完結**（CSS もインライン）。CLAUDE.md の `?v=` 規約は
 * 「外部アセットを読むページ」の話なので、読むものが無いこのページ群は対象外
 * ＝ 版を上げ忘れて古い実体が配られる事故が起きない。
 *
 * 計測スニペットは **qa/index.html から実物を切り出して**埋める。書き写すと
 * localhost 除外を直したときにここだけ取り残される（2026-08-12 に実際にやった事故の型）。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'isomers');
const ORIGIN = 'https://chem.schoollenz.com';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const PORT = (args.find(a => a.startsWith('--port=')) || '--port=8201').split('=')[1];

/* 収録する分子式。**高校で実際に数えさせるものだけ**を手で選ぶ。
   923件の化合物から機械的に広げると、検索需要の無い薄いページが大量にでき、
   「誘導ページ」として site 全体の評価を落とすほうが先に効く。

   **選ぶ条件（下の 分類外 の門番と対）**: 列挙結果が全部、高校の分類（アルコール・
   エーテル・アルケン…）に収まること。たとえば C4H8O2 は列挙すると in-scope だけで44種
   （不飽和のアルコールなどを含む）になり、教科書の答え（エステル4・カルボン酸2）と
   食い違う。**数として正しくても、生徒が探している答えと違うページは害になる。**
   なので「分類外が1つでも出る式は載せない」を機械の条件にしてある。 */
const FORMULAS = [
    // アルカン（炭素の数で骨格だけを数える。異性体の入口）
    { f: 'C4H10', why: 'いちばん小さい異性体。直鎖と枝つきの2つだけ' },
    { f: 'C5H12', why: 'アルカンの異性体の入口。まずこれを手で3つ書けるようにする' },
    { f: 'C6H14', why: '枝の本数と付ける位置で分けると、抜けも重複もなく数えられる' },
    { f: 'C7H16', why: '主鎖の長さで場合分けするのがコツ。主鎖5に出るエチル基が見落としどころ' },
    // アルコールとエーテル（酸素を鎖の中に入れる発想が要る）
    { f: 'C2H6O', why: 'エタノールとジメチルエーテル。同じ分子式で別の物質の最小例' },
    { f: 'C3H8O', why: 'アルコールだけ数えると2つで止まる。3つ目は酸素を鎖の中に入れたエーテル' },
    { f: 'C4H10O', why: 'アルコールとエーテルが混ざる。分類ごとに数えるのがコツ' },
    { f: 'C5H12O', why: '数が一気に増える。アルコール8種とエーテル6種に分けて数える' },
    // 不飽和・環（水素が2つ減る＝二重結合1つか環1つ、が要点）
    { f: 'C4H8', why: '鎖だけ数えて3つで止まるのが定番の失点。環でも水素は2つ減る' },
    { f: 'C5H10', why: 'アルケン5種と環5種。二重結合と環が同じ働きをすることが見える' },
    { f: 'C6H12', why: '25種類。ここまで来ると手では数えきれないので、分類して数える練習に' },
    // アミン（窒素）
    { f: 'C3H9N', why: '第一級・第二級・第三級の見分け。N に付いている炭素の数で決まる' },
    { f: 'C4H11N', why: '8種類。N のまわりを見て3つの級に振り分けてから数える' },
];

/* C7H16 は既定（60万）だと打ち切られる。生成は無人で回すものなので、
   UI の応答性のための上限より緩く取ってよい（実測 C7H16 で 2.3 秒） */
const NODE_LIMIT = 60000000;

const SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
const pretty = (f) => f.replace(/\d/g, (d) => SUB[d]);
const slug = (f) => f.toLowerCase();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 計測スニペットを実物から切り出す（書き写さない。上のコメントの理由） */
function analyticsSnippet() {
    const src = readFileSync(path.join(ROOT, 'qa', 'index.html'), 'utf8');
    const m = src.match(/<!-- Google tag \(gtag\.js\)[\s\S]*?gtag\('config', 'G-403BPCLQ0D'\);\s*<\/script>/);
    if (!m) throw new Error('qa/index.html から計測スニペットを切り出せない（形が変わった？）');
    return m[0];
}

const CSS = `
:root{--bg:#0a0c10;--panel:#0f141c;--line:rgba(255,255,255,.10);--fg:#f5f6fa;--dim:#a0a8c0;--accent:#00f2fe;
--color-c:#bdc3c7;--color-o:#ff4757;--color-n:#3e81f7;--color-cl:#2ecc71;--color-s:#f1c40f;--color-br:#a85d00;--color-h:#718093}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"Noto Sans JP",system-ui,sans-serif;line-height:1.7}
.wrap{max-width:900px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line);padding:10px 0;font-size:13px}
header a{color:var(--dim);text-decoration:none}
header a:hover{color:var(--accent)}
h1{font-size:clamp(20px,4.5vw,30px);margin:24px 0 8px;line-height:1.4}
h2{font-size:17px;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.lede{color:var(--dim);margin:0 0 8px}
.mols{list-style:none;padding:0;margin:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.mols li{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center}
.mols svg{width:100%;height:130px;display:block}
.svg-atom-text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;user-select:none}
.nm{font-size:13px;margin:6px 0 0;word-break:break-all}
.nm.none{color:var(--dim)}
.cta{margin:32px 0;padding:18px;background:var(--panel);border:1px solid var(--accent);border-radius:12px}
.cta a{display:inline-block;margin-top:10px;background:var(--accent);color:#06202a;font-weight:700;
padding:11px 20px;border-radius:8px;text-decoration:none}
details{margin:20px 0;color:var(--dim);font-size:14px}
summary{cursor:pointer}
nav.more{margin:28px 0;font-size:14px}
nav.more a{color:var(--accent);text-decoration:none;margin-right:14px;white-space:nowrap}
footer{border-top:1px solid var(--line);margin-top:32px;padding:16px 0 40px;color:var(--dim);font-size:12px}
footer a{color:inherit}
`.trim();

function page({ title, desc, canonical, body }) {
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
<style>${CSS}</style>
</head>
<body>
<header><div class="wrap"><a href="/">化学レンズ</a> ／ <a href="/assembler/">パズルでみる有機化学</a> ／ <a href="/isomers/">異性体の数</a></div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">構造式は<a href="/assembler/">パズルでみる有機化学</a>の列挙エンジンが描いています。
Schoollenz ／ 化学レンズ　·　<a href="/privacy.html">プライバシーポリシー</a></div></footer>
</body>
</html>
`;
}

function formulaPage(rec, all) {
    const { f, why, groups, outside, total } = rec;
    const P = pretty(f);
    const cats = groups.map(g => `${g.label} ${g.items.length}種類`).join('・');
    const cards = (items) => '<ul class="mols">' + items.map(it =>
        `<li>${it.svg}<p class="nm${it.name ? '' : ' none'}">${esc(it.name || '（名称の登録なし）')}</p></li>`
    ).join('') + '</ul>';

    const others = all.filter(o => o.f !== f)
        .map(o => `<a href="/isomers/${slug(o.f)}/">${pretty(o.f)}（${o.total}種類）</a>`).join('');

    const body = `<h1>${P} の異性体は${total}種類</h1>
<p class="lede">${esc(why)}。${cats ? `内訳は${esc(cats)}。` : ''}</p>
<p class="lede">下の構造式は、すべて<b>アプリの列挙エンジンが実際に数え上げたもの</b>です（数え落としも重複もありません）。</p>
${groups.map(g => `<h2>${esc(g.label)}（${g.items.length}種類）</h2>\n${cards(g.items)}`).join('\n')}
${groups.some(g => g.label.includes('アルケン')) ? `<details open><summary><b>シス・トランスを数えるとさらに増えます</b></summary>
<p>ここで数えているのは<b>構造異性体</b>（原子のつながり方が違うもの）だけです。
二重結合はまわりが回転できないので、同じつながり方でも置換基の向きでシス形とトランス形に分かれます。
問題文が「立体異性体を含めて」と言っているときは、そのぶんを足してください。</p></details>` : ''}
<div class="cta">
  <b>自分で書き出せるか試す</b>
  <p class="lede">アプリが ${P} の異性体を1つずつ判定します。数えるだけでなく、実際に構造式を書いて確かめられます。無料・登録不要。</p>
  <a href="/assembler/?open=isomer&amp;formula=${f}&amp;utm_source=isomers&amp;utm_medium=internal&amp;utm_campaign=${slug(f)}">${P} の書き出しを始める</a>
</div>
${others ? `<nav class="more"><b>ほかの分子式</b>　${others}</nav>` : ''}`;

    return page({
        title: `${P} の異性体は${total}種類 — パズルでみる有機化学`,
        desc: `${P}（分子式）の構造異性体${total}種類を、構造式つきで全部並べました。${cats ? `内訳は${cats}。` : ''}自分で書き出して確かめられる無料アプリつき。`,
        canonical: `${ORIGIN}/isomers/${slug(f)}/`,
        body,
    });
}

function indexPage(all) {
    const rows = all.map(o =>
        `<li><a href="/isomers/${slug(o.f)}/"><b>${pretty(o.f)}</b> — ${o.total}種類</a><p class="nm none">${esc(o.why)}</p></li>`
    ).join('');
    return page({
        title: '分子式から異性体の数を調べる — パズルでみる有機化学',
        desc: '高校化学で数えさせられる分子式について、構造異性体を構造式つきで全部並べています。自分で書き出して確かめられる無料アプリつき。',
        canonical: `${ORIGIN}/isomers/`,
        body: `<h1>分子式から異性体の数を調べる</h1>
<p class="lede">数だけでなく<b>構造式を全部</b>並べています。並んでいるのは暗記用の一覧ではなく、
アプリが実際に列挙した結果です。同じことを自分の手でできるか、そのまま試せます。</p>
<ul class="mols" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${rows}</ul>`,
    });
}

/* ---------------- ここから収集 ---------------- */

const require = createRequire(path.join(HERE, 'record', 'package.json'));
const { chromium } = require('playwright');

const browser = await chromium.launch();
const p = await browser.newPage();
const base = `http://localhost:${PORT}`;
try {
    await p.goto(`${base}/assembler/`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.game && window.isomerPractice, null, { timeout: 30000 });
} catch (e) {
    console.error(`❌ ${base}/assembler/ を開けません。ローカルサーバーを立ててから実行してください`);
    await browser.close();
    process.exit(1);
}

const collected = [];
for (const spec of FORMULAS) {
    const r = await p.evaluate(([f, limit]) => {
        const parsed = window.isomerPractice.parseFormula(f);
        if (!parsed) return { error: '分子式を解釈できない' };
        const out = window.enumerateConstitutionalIsomers(parsed.heavy, parsed.h, limit);
        if (out.overflow) return { error: '列挙が打ち切られた（重原子が多すぎる）' };

        const NS = 'http://www.w3.org/2000/svg';
        let svg = document.getElementById('__gen');
        if (!svg) {
            svg = document.createElementNS(NS, 'svg');
            svg.id = '__gen';
            svg.setAttribute('xmlns', NS);
            for (const cls of ['quiz-bonds', 'quiz-atoms']) {
                const g = document.createElementNS(NS, 'g');
                g.setAttribute('class', cls);
                svg.appendChild(g);
            }
            document.body.appendChild(svg);
        }

        const groups = [];
        const outside = [];
        out.isomers.forEach((iso) => {
            window.layoutMolecule(iso);
            const idx = new Map(iso.atoms.map((a, i) => [a.id, i]));
            window.renderMoleculeIntoSvg(window.game, '__gen', {
                atoms: iso.atoms.map(a => ({ element: a.element, x: a.x, y: a.y })),
                bonds: iso.bonds.map(b => ({
                    atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type,
                })),
            }, false, false);
            /* **出力を正規化する。** 原子IDは乱数で、`addBond` が端点をIDで並べ替えるため、
               同じ分子でも実行のたびに結合線の始点と終点が入れかわる（見た目は同じ）。
               そのままだと生成し直すたびに git の差分が出て、本当の変化が埋もれる。
                 ① 線の端点を座標で並べる（線分に向きは無いので描画は変わらない）
                 ② 座標を小数2桁に丸める（1.2246467991473533e-15 のような 0 の表現ゆれを消す） */
            const r2 = (v) => { const n = Number(v); return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : v; };
            svg.querySelectorAll('*').forEach((el) => {
                ['x', 'y', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'width', 'height'].forEach((a) => {
                    if (el.hasAttribute(a)) el.setAttribute(a, r2(el.getAttribute(a)));
                });
            });
            svg.querySelectorAll('line').forEach((ln) => {
                const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => Number(ln.getAttribute(a)));
                if (x1 > x2 || (x1 === x2 && y1 > y2)) {
                    ln.setAttribute('x1', x2); ln.setAttribute('y1', y2);
                    ln.setAttribute('x2', x1); ln.setAttribute('y2', y1);
                }
            });
            /* ③ 線そのものの並び順もそろえる。**二重結合は平行な2本**で描かれ、
               どちら側へずらした線を先に出すかが原子の順（＝乱数のID）で変わる。
               太さも色も同じ線どうしなので、並べ替えても絵は1ピクセルも変わらない。 */
            const bonds = svg.querySelector('.quiz-bonds');
            const key = (el) => ['x1', 'y1', 'x2', 'y2'].map(a => Number(el.getAttribute(a) || 0).toFixed(2).padStart(10)).join();
            [...bonds.children].sort((a, z) => key(a) < key(z) ? -1 : key(a) > key(z) ? 1 : 0)
                .forEach(el => bonds.appendChild(el));
            const vb = svg.getAttribute('viewBox');
            if (vb) svg.setAttribute('viewBox', vb.split(/\s+/).map(r2).join(' '));

            // id は使い回しなので外す（ページに同じ id が並ばないように）
            const item = { name: window.game.lookupCompoundName(iso) || null, svg: svg.outerHTML.replace(' id="__gen"', '') };
            const cls = classifyMolecule(iso);
            if (cls.scope === 'outside') { outside.push(item); return; }
            let g = groups.find(x => x.label === cls.label);
            if (!g) { g = { label: cls.label, items: [] }; groups.push(g); }
            g.items.push(item);
        });
        // 多い分類から出す（C₄H₁₀O ならアルコール4種が先・エーテル3種が後）。
        // 列挙の出現順のままだと、なじみの薄い分類が先頭に来ることがある
        groups.sort((a, b) => b.items.length - a.items.length);
        return { groups, outside, total: groups.reduce((s, g) => s + g.items.length, 0) };
    }, [spec.f, NODE_LIMIT]);

    if (r.error) { console.error(`❌ ${spec.f}: ${r.error}`); await browser.close(); process.exit(1); }
    /* **分類外が出る式は載せない**（FORMULAS のコメントの理由）。ここで止めるのは、
       「数としては正しいが教科書の答えと食い違うページ」を無自覚に公開しないため。 */
    if (r.outside.length) {
        console.error(`❌ ${spec.f}: 高校の分類に入らない構造が ${r.outside.length} 件出ました。`);
        console.error('   この式は載せません（教科書の答えと食い違うページになるため）。FORMULAS から外してください');
        await browser.close();
        process.exit(1);
    }
    collected.push({ ...spec, ...r });
    console.log(`  ${pretty(spec.f).padEnd(10)} ${String(r.total).padStart(3)}種類  (${r.groups.map(g => g.label + g.items.length).join(' / ')}${r.outside.length ? ` ＋分類外${r.outside.length}` : ''})`);
}
await browser.close();

/* ---------------- 書き出し ---------------- */

const files = new Map();
files.set(path.join(OUT, 'index.html'), indexPage(collected));
collected.forEach(rec => files.set(path.join(OUT, slug(rec.f), 'index.html'), formulaPage(rec, collected)));

if (CHECK) {
    let bad = 0;
    for (const [file, want] of files) {
        const got = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
        if (got !== want) { console.error('❌ 古い/無い: ' + path.relative(ROOT, file)); bad++; }
    }
    const known = new Set([...files.keys()].map(f => path.relative(ROOT, f).replace(/\\/g, '/')));
    if (existsSync(OUT)) {
        readdirSync(OUT, { withFileTypes: true }).forEach(d => {
            const rel = `isomers/${d.name}` + (d.isDirectory() ? '/index.html' : '');
            if (!known.has(rel)) { console.error('❌ 余分: ' + rel + '（FORMULAS から消した？）'); bad++; }
        });
    }
    if (bad) { console.error('\n`node tools/gen-isomer-pages.mjs` で作り直してください'); process.exit(1); }
    console.log(`✅ ${files.size} ページとも最新です`);
    process.exit(0);
}

for (const [file, html] of files) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, html, 'utf8');
}
console.log(`\n✅ ${files.size} ページを書き出しました（isomers/）`);
console.log('   sitemap も作り直してください: node tools/gen-sitemap.js');
