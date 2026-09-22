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
 * | （既定）`paper` | ★★ **原稿の図は既定で紙の図の型**（v1562・ユーザー「参考書の図は焼き直してよいです」＝ 見本 paper4 の見た目で決定）。教科書の比の文字・環は登録の座標・−NO₂/−SO₃H は文字・−COOH/−CHO は線。⚠ 原稿の `gen:` に `paper` を書かなくても効く（校正中の原稿を1文字も変えずに焼き直すため）。`--src=` の1枚焼きは今までどおり `paper` を書いたときだけ |
 * | `circle`        | 紙の図の型をやめて、アプリの丸の図で焼く（v1562 までの見た目）。⚠ `numbered` は紙の図の型と組めないので、書かなくても丸の図になる |
 * | `haworth`       | ★ **糖をハース式で描く**（v1549）。登録の座標（名前から呼び出したときの形）をそのまま描く ＝ **1位の −OH の上下（α/β）が図に出る**。⚠ 登録済みの名前だけ・糖の環（`haworthSugarCycles`）が無ければ赤。中身は `learn.js` の `ipHaworthFigure` |
 *
 * ★★ **図に印を重ねる**（v1609・I-0082・`DESIGN_figure_marks.md` 段1）—— `:::figure` に `mark:` を1行1つ:
 *
 *      :::figure
 *      src: disaccharide-glycosidic-bond.png
 *      gen: name=マルトース（麦芽糖） haworth
 *      mark: kind=囲む at=グリコシド結合 label=グリコシド結合
 *      :::
 *
 *   | | 意味 |
 *   |---|---|
 *   | `kind=` | `囲む`（破線の楕円）／`枠`（破線の四角）／`文字`（短い文字を置く）。★ 段1 はこの3つだけ |
 *   | `at=`   | **どこに**。化学の言葉が主（`不斉炭素`・`グリコシド結合`・`カルボキシ基`…）、位置番号が補助（`C1-OH`・`環C2`・`C3-C4`） |
 *   | `label=`| 添える文字（`kind=文字` では必須）。⚠ **置き場所は作図器が計算する**（原稿に座標は書かせない） |
 *   | `count=`| 期待する個数。★ 合わなければ赤 ＝ **数が変わったことに気づける** |
 *   | `color=`| 既定は紫 `#6a1b9a`。⚠ 色だけに意味を持たせない |
 *
 *   ⚠⚠ **`at=` が0個に当たったら赤で止まる**（印の無い図が黙って焼けるのを防ぐ・設計 §3）。
 *   ⚠ 当てるのも描くのも **アプリの `assembler/quiz.js`**（`figureMarkHits` / `drawFigureMarks`）。
 *     この道具は `mark:` を**読んで渡すだけ**。★ 当て方は**実装済みの判定をそのまま読む**（新しい化学判定を書かない）
 *
 * ★ **原稿に書かずに1枚だけ焼く**（v1549。原稿の校正中に新しい図を用意する口）:
 *
 *      node tools/gen-figure.mjs --port=8811 --src=saccharide-alpha-glucose-haworth.png --gen="name=α-D-グルコース（α-D-グルコピラノース） haworth"
 *
 *   ⚠ `--src=` と `--gen=` は必ず組で書く。原稿の図（`gen:` のある `:::figure`）には触らない
 *
 * ★ **塩（成分が2つ以上の登録）も焼ける**（v1549）。粒（Na⁺・Cl⁻）は `layoutMolecule` /
 *   `renderStandardFigure` が反対の電荷の原子の近くへ置く（`chemistry.js` の `layoutDetachedComponents`）
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
/* 原稿に書かずに1枚だけ焼く口（`--src=` と `--gen=` の組） */
const ONE_SRC = (args.find(a => a.startsWith('--src=')) || '').slice('--src='.length);
const ONE_GEN = (args.find(a => a.startsWith('--gen=')) || '').slice('--gen='.length);
/* ⚠ 1枚焼きの置き先。`reference-img/` に原稿から名指しされない図を置くと `gen-reference.mjs` が
   「参照されていない図」で止まるので、差し替えを決めるまでは外に置けるようにする */
const OUT_DIR = (args.find(a => a.startsWith('--out=')) || '').slice('--out='.length);
/* 紙の図の型で「まとめる／線で描く」を上書きできる原子団（quiz.js の PAPER_GROUP_KEY と同じ綴り） */
const PAPER_GROUP_KEYS = ['COOH', 'CHO', 'NO2', 'SO3H'];
/* ★ `expand=` だけに書ける `H` ＝「水素をまとめず、1つずつ原子として描く」（v1608）。
   ⚠ `condense=H` は書けない ―― 水素をまとめるのは紙の図の既定なので、指定する意味が無い */
const PAPER_EXPAND_KEYS = [...PAPER_GROUP_KEYS, 'H'];

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
 *   572 × 46（結合1本の単位）÷ 400 ＝ **結合 約66px** —— これが本の中の結合の長さ。
 * ⚠ 400単位より広い分子（長い鎖）はそのまま縮む ＝ 天井ではなく床。 */
const FIT_W = 400;
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
#figbake text.svg-paper-label{ fill:#1c222d !important; font-family: "Helvetica Neue", Arial, sans-serif; }
#figbake text.svg-charge{ fill:#1c222d !important; }
#figbake .svg-paper-wedge{ fill:#1c222d !important; }
#figbake line.svg-bond-ink.svg-paper-line{ stroke:#1c222d !important; }
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
            const spec = parseGen(b.gen, `reference-src/${id}.md`);
            // ★ 原稿の図は既定で紙の図の型（v1562）。⚠ numbered（主鎖の帯と C₁ の添え字）は丸の図の上で合わせてあるので丸の図のまま
            if (!spec.circle && !spec.numbered && !spec.paper) { spec.paper = true; spec.paperByDefault = true; }
            /* ★★ 図に重ねる印（v1609・`mark:`・DESIGN_figure_marks.md 段1）。
               ⚠ 読むだけ —— **描くのはアプリ**（`assembler/quiz.js` の `drawFigureMarks`）。
                 ここに作図を書くと、アプリの図と参考書の図が別々に育つ（この道具の冒頭の但し書き）。
               ⚠ 書式の検査は `reference-md.js` の `parseMark`（node もブラウザも同じ1本） */
            spec.marks = (b.mark || []).map(s => RM.parseMark(s, `reference-src/${id}.md`));
            if (spec.marks.length && !spec.paper) {
                throw new Error(`reference-src/${id}.md の ${b.src}: mark: は紙の図にだけ重ねられます`
                    + '（gen に circle / numbered を書いた図には、まだ印を付けられません）');
            }
            jobs.push({ id, src: b.src, gen: b.gen, spec });
        });
    });
    return jobs;
}

/** `gen:` の1行を読む。⚠ 知らない語は**黙って捨てない**（綴り違いが図の取り違えになる） */
function parseGen(text, where) {
    const spec = { numbered: false, plain: false, haworth: false };
    String(text).trim().split(/\s+/).filter(Boolean).forEach(tok => {
        if (tok === 'numbered') { spec.numbered = true; return; }
        if (tok === 'plain') { spec.plain = true; return; }
        if (tok === 'haworth') { spec.haworth = true; return; }
        if (tok === 'paper') { spec.paper = true; return; }
        if (tok === 'circle') { spec.circle = true; return; }
        const g = /^(condense|expand)=(.+)$/.exec(tok);
        if (g) {
            const keys = g[2].split(',').map(s => s.trim()).filter(Boolean);
            const ok = g[1] === 'expand' ? PAPER_EXPAND_KEYS : PAPER_GROUP_KEYS;
            const bad = keys.filter(k => !ok.includes(k));
            if (bad.length) throw new Error(`${where}: gen の ${g[1]}= に知らない原子団「${bad.join(',')}」があります（書けるのは ${ok.join(' / ')}）`);
            spec[g[1]] = keys;
            return;
        }
        const m = /^(name|formula|chain|subs)=(.+)$/.exec(tok);
        if (!m) throw new Error(`${where}: :::figure の gen に読めない語「${tok}」があります`
            + '（書けるのは name= / formula= / chain= / subs= / numbered / plain / haworth / paper / circle / condense= / expand=）');
        spec[m[1]] = m[2];
    });
    if (!spec.name) throw new Error(`${where}: :::figure の gen に name= がありません（図が何の分子かを名乗ってください）`);
    if (spec.chain && !spec.subs) throw new Error(`${where}: gen の chain= には subs= を添えます`);
    if (spec.subs && !spec.chain) throw new Error(`${where}: gen の subs= には chain= を添えます`);
    if (spec.numbered && spec.plain) throw new Error(`${where}: gen の numbered と plain は同時に書けません`);
    if ((spec.condense || spec.expand) && !spec.paper) throw new Error(`${where}: gen の condense= / expand= は paper と組で書きます（丸の図には原子団のまとめが無い）`);
    if (spec.condense && spec.expand && spec.condense.some(k => spec.expand.includes(k))) throw new Error(`${where}: gen の condense= と expand= に同じ原子団が入っています`);
    if (spec.paper && spec.numbered) throw new Error(`${where}: gen の paper に numbered はまだ付けられません（主鎖の帯は丸の図の上で合わせてある）`);
    if (spec.haworth && spec.numbered) throw new Error(`${where}: gen の haworth に numbered は付けられません（主鎖の帯はハース環に出せない）`);
    if (spec.haworth && (spec.formula || spec.chain)) throw new Error(`${where}: gen の haworth は登録済みの名前だけで使えます（formula= / chain= は組めない）`);
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
        const bakeOne = (spec) => pg.evaluate(({ spec, OUT_W, MAX_H, FIT_W }) => {
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

            /* ★ ハース式: 登録の座標のまま描かせる（⚠ 作図はここに書かない。中身は learn.js の ipHaworthFigure） */
            if (spec.haworth) {
                if (!entry) return { error: `haworth は登録済みの名前だけで使えます（「${spec.name}」は登録にありません）` };
                if (typeof ipHaworthFigure !== 'function') return { error: 'アプリに ipHaworthFigure がありません（v1549 より古い版を配信している）' };
                if (!ipHaworthFigure(mol)) return { error: `「${spec.name}」にハース式として読む糖の環がありません（haworthSugarCycles が空）` };
                via += '・ハース式';
            }

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
            /* ⚠ 印（`marks`）が1つも当たらなければ**ここで投げる** ＝ 印の無い図を焼かない（設計 §3）。
               ★ 投げたものは `error` にして返す（呼び手が赤で止める。焼き上がりは1枚も出ない） */
            try {
                IsomerPractice.prototype.renderStandardFigure.call({ game: g }, svg.id, mol, !!spec.numbered,
                    { paper: !!spec.paper, condense: spec.condense || [], expand: spec.expand || [], marks: spec.marks || [] });
            } catch (e) {
                return { error: (e && e.message) || String(e) };
            }
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
            const markWarn = svg.dataset.markWarn ? JSON.parse(svg.dataset.markWarn) : [];
            return { ok: true, via, w, h, aspect: vb[2] / vb[3], atoms: mol.atoms.length, marks: (spec.marks || []).length, markWarn };
        }, { spec, OUT_W, MAX_H, FIT_W });
        let r = await bakeOne(job.spec);
        /* ★ 紙の図の型は字の長さぶん価標を伸ばすので、長い鎖（ステアリン酸 C₁₈）は横に伸びて床 9:1 を超える（v1562 実測 10.1:1）。
           ⚠ 鎖を (CH₂)₁₆ に畳むかはユーザーの判断待ちなので、ここでは決めない ——
           **原稿の既定で紙の図になっている図だけ**、平たすぎたら丸の図（v1562 までの見た目）で焼き直して、そのことを出力に書く。
           `paper` を明示した図（--src= の1枚焼き）は今までどおり赤で止める */
        /* ⚠ 印のある図は**丸の図へ落とさない** —— 落とすと印が黙って消える（印は紙の図にだけ描く）。
           平たすぎれば下の床（ASPECT_WARN）で赤に止まる ＝ 気づける */
        if (!r.error && r.aspect > ASPECT_WARN && job.spec.paperByDefault && !(job.spec.marks || []).length) {
            const flat = r.aspect;
            r = await bakeOne(Object.assign({}, job.spec, { paper: false, condense: undefined, expand: undefined }));
            if (!r.error) r.fellBack = `紙の図は ${flat.toFixed(1)}:1 で平たすぎるので丸の図`;
        }

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
        const outDir = OUT_DIR || IMG;
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        writeFileSync(path.join(outDir, job.src), buf);
        done.push({ ...job, ...r, bytes: buf.length });
        console.log(`   ✅ ${job.src}  ${r.w}x${r.h}  ${(buf.length / 1024).toFixed(0)}KB`
            + `  ← ${job.spec.name}${job.spec.numbered ? '（番号つき）' : ''}  [${r.via}]`
            + (r.marks ? `  ＋印 ${r.marks} 本` : '')
            + (r.fellBack ? `  ⚠ ${r.fellBack}` : (job.spec.paper ? '  （紙の図）' : '  （丸の図）')));
        // ⚠ 黄（設計 §6）: 焼いた絵を人が見る前に、重なりだけは言っておく
        (r.markWarn || []).forEach(w => console.log(`      ⚠ ${w}`));
    }
    await browser.close();
    return done;
}

async function main() {
    let jobs;
    if (!!ONE_SRC !== !!ONE_GEN) { console.log('❌ --src= と --gen= は組で書きます'); process.exit(1); }
    if (OUT_DIR && !ONE_SRC) { console.log('❌ --out= は --src= / --gen= の1枚焼きでだけ使えます（原稿の図は reference-img/ へ焼く）'); process.exit(1); }
    if (ONE_SRC) {
        if (CHECK) { console.log('❌ --check は原稿の図だけを見ます（--src= とは組めません）'); process.exit(1); }
        if (!/^[a-z0-9][a-z0-9-]*\.png$/.test(ONE_SRC)) { console.log(`❌ --src=${ONE_SRC} は「英小文字・数字・ハイフン.png」の名前にします`); process.exit(1); }
        try { jobs = [{ id: '(--src 指定)', src: ONE_SRC, gen: ONE_GEN, spec: parseGen(ONE_GEN, '--gen') }]; }
        catch (e) { console.log('❌ ' + e.message); process.exit(1); }
    } else {
        try { jobs = collect(); }
        catch (e) { console.log('❌ ' + e.message); process.exit(1); }
    }

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
