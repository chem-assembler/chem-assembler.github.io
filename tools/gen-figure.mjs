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
 * | `fischer=<R/S>` | ★ **フィッシャー投影で描く**（v1617・I-0104）。不斉炭素の R・S を**上から**並べて書く（`fischer=RR`・メソ体は `fischer=RS`）。登録の図をアプリのフィッシャーの操作（`fischerOpRotate90/180` で縦に起こし、`fischerOpMirror` で左右を入れ替える ＝ 練習・タイムアタックと同じ関数）で作り、`assignRSDescriptor` の読みが一致する図を選ぶ。酸化された端（COOH・CHO）が上。不斉炭素の H だけを線で描く（十字の4本目）。⚠ 登録済みの名前だけ・紙の図の型だけ。作れなければ赤（作れた読みを並べて出す）。⚠ **D/L はアプリが酒石酸で断定しない**（`assignDLDescriptor`）ので、原稿は R・S で指す |
 * | `units=1` | ★ **高分子の図を繰り返し単位1つぶんにする**（v1619・I-0040）。登録は両端が R の鎖（例: ナイロン66 は単位3つぶん）。R から R への主鎖で「元素と枝」の並びが繰り返す**いちばん短い周期**を見つけ、1周期ぶんだけ残して両端を R にする（座標は登録のまま）。周期が見つからなければ赤。`ch2n` と組むと教科書の繰り返し単位の形（R−NH−(CH₂)₆−NH−CO−(CH₂)₄−CO−R）になる。⚠ 登録済みの名前だけ・紙の図の型だけ |
 * | `ch2n` | ★ **長い鎖を「(CH₂)ₙ」にまとめて描く**（v1619・I-0040 ユーザー決定「A」）。畳む条件はクイズの図と同じ `findCondensableChainRuns`（両端に鎖でない原子・3個以上・一直線）。鎖を1個の原子に置き換え、その文字を「(CH₂)ₙ」にするので、価標は文字の縁で止まる。ステアリン酸・セッケン・ナイロン66・ナイロン6 のような横に長すぎる図に使う。⚠ 紙の図の型だけ（circle・numbered・haworth・fischer・stereo とは組めない） |
 * | `vinyl` | ★ **環に含まれない C=C のまわりを ±120° に開いて描く**（v1618・I-0112）。アプリが名前から呼び出したときの整形（C-4・`game.reshapeDoubleBond`）を、渡す前の座標に当てるだけ。登録が横一直線の 1-ブテンのような分子を、教科書の形（二重結合の平面が見える形）で描く。⚠ **C=C の幾何（シス・トランス）が変わったら赤**（整形が立体を書き換えてはいけない）。紙の図の型だけ |
 * | `flip=v` / `flip=h` | ★ **登録の図を裏返して描く**（v1618・I-0112）。`v` は上下・`h` は左右。紙の図の型が登録の座標をそのまま使うので、渡す前に座標を裏返すだけ（⚠ 作図は書かない）。同じ分子を2通りに描いて「裏返すと重なる」を見せる図（1-ブテンのエチル基が上か下か）に使う。⚠ 紙の図の型だけ（circle・numbered・haworth・fischer・stereo とは組めない） |
 * | `stereo=wedge` / `stereo=mirror` | ★ **くさび図**（v1617・I-0104）。**アプリの「🧊 立体で見る」の絵そのもの**（`stereo.js` の StereoView。縦＝奥の破線のくさび・横＝手前のくさび）を写して撮る。`mirror` は「🪞 鏡像と並べる」を押した状態（まん中の破線が鏡）。消すのは画面用の見出し（「あなたの分子」「🪞 鏡像」）だけ。⚠ 中心の炭素の上下左右は**登録の図の並びのまま** ＝ 主鎖を縦に描いた登録（`D-乳酸`）を名指すと COOH が上になる（横に描いた `乳酸` は OH が上）。登録の図が十字として読めない（立体ビューの並びが仮になる）ときは赤。`name=` とだけ組める（`mark:`・2行目の `gen:` も不可） |
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
 *   | `kind=` | `囲む`（破線の楕円）／`枠`（破線の四角）／`文字`（短い文字を置く）。★ 段1 はこの3つだけ。
 *              ＋ `対称面`（v1617）… at= の**2か所**の真ん中を直角に横切る破線（`mark: kind=対称面 at=3:不斉炭素 count=2 label=対称面`）。
 *              ⚠ 描いた図がその線で折り返し対称でなければ赤（メソ体でない図に引けない） |
 *   | `at=`   | **どこに**。化学の言葉が主（`不斉炭素`・`グリコシド結合`・`カルボキシ基`…）、位置番号が補助（`C1-OH`・`環C2`・`C3-C4`） |
 *   | `label=`| 添える文字（`kind=文字` では必須）。⚠ **置き場所は作図器が計算する**（原稿に座標は書かせない） |
 *   | `count=`| 期待する個数。★ 合わなければ赤 ＝ **数が変わったことに気づける** |
 *   | `color=`| 既定は紫 `#6a1b9a`。⚠ 色だけに意味を持たせない |
 *
 *   ⚠⚠ **`at=` が0個に当たったら赤で止まる**（印の無い図が黙って焼けるのを防ぐ・設計 §3）。
 *   ⚠ 当てるのも描くのも **アプリの `assembler/quiz.js`**（`figureMarkHits` / `drawFigureMarks`）。
 *     この道具は `mark:` を**読んで渡すだけ**。★ 当て方は**実装済みの判定をそのまま読む**（新しい化学判定を書かない）
 *
 * ★★ **1枚に分子を複数並べる**（v1610・`DESIGN_figure_marks.md` 段2）—— `gen:` を複数行（1行 ＝ 1分子・横一列）:
 *
 *      :::figure
 *      src: benzene-kekule-resonance.png
 *      gen: name=ベンゼン plain kekule=1
 *      gen: name=ベンゼン plain kekule=2
 *      between: kind=両矢印 label=実際はこの中間
 *      :::
 *
 *   | | 意味 |
 *   |---|---|
 *   | `between:` | 分子と分子の間を結ぶ。`kind=` は `両矢印`・`矢印`・`破線`。`at=1 to=2`（分子だけ ＝ すき間に引く）か
 *                  `at=1:ニトロ基 to=2:フェノール性ヒドロキシ基`（場所まで ＝ その2か所を結ぶ）。`矢印`・`破線` は `to=` 必須。
 *                  `両矢印` は分子が2つだけなら `at=`/`to=` を省ける。既定の色は墨（化学の記号そのものなので） |
 *   | `kekule=`  | `1` ＝ 登録の並び・`2` ＝ ベンゼン環の単結合と二重結合を入れ替えたもの（孤立したベンゼン環だけ） |
 *   | `mark:`    | 分子が2つ以上なら `at=2:ニトロ基` のように**何番目の分子か**を付ける。`破線`・`矢印`（1つの分子の中の2か所・`to=` 必須）も書ける |
 *
 *   ⚠ 並べるのも線を引くのも **アプリの `composeFigureRow`**（`assembler/quiz.js`）。この道具は1分子ずつ描かせて渡すだけ。
 *   ⚠ 大きさは**そろえ直さない**（どの分子も同じ座標の単位 ＝ 結合の長さは1分子の図と同じ）。原稿に座標は書かせない
 *
 * ★ **原稿に書かずに1枚だけ焼く**（v1549。原稿の校正中に新しい図を用意する口）:
 *
 *      node tools/gen-figure.mjs --port=8811 --src=saccharide-alpha-glucose-haworth.png --gen="name=α-D-グルコース haworth"
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
/* 公開ページの本文の幅（図はこの幅いっぱいに出る）。字の大きさの見積もり（minText）に使う */
const BODY_W = 680;
/* 図の中の字の床（最終的な見た目・パソコン幅）。下回ったら黄で申し送る（2026-09-24） */
const MIN_TEXT = Number((process.argv.find(a => a.startsWith('--min-text=')) || '').split('=')[1] || 14);
/* ⚠ `gen-reference.mjs` の `MAX_ASPECT`（10:1）に**余裕を持って**収まること。
   ★ ここで止めれば、焼いてから生成で止まるより1手早い */
const ASPECT_WARN = 9;

/* ★★ 紙の色（⚠ 形は触らない・色だけ）。
   ・原子の丸は地を白に（アプリは `#0f141c` を属性で直に書いている）
   ・結合線は `rgba(255,255,255,…)` を属性で直に書いているので `!important` で読み替える
   ・`_iupacLiftBondInk` が帯の上で結合線を白く塗り直すので、そこも同じ口で押さえる
   ・元素の色は色相を残して明度だけ落とす（面Aの読み替え LIGHT_CSS と同じ考え方）
   ・くさび図（`stereo=`・`svg.figbake-stereo`）は立体ビューが属性で直に書く白（文字 #f5f6fa・くさび・破線のくさび）を墨へ、
     鏡の破線（シアン）を灰へ。字は紙の図の字（svg-paper-label）と同じ書体に（⚠ 位置・大きさ・形は触らない） */
const PAPER_CSS = `
#figbake{
  background:#fff; padding:0; margin:0; position:fixed; left:0; top:0; z-index:99999;
  --color-c:#333a45; --color-o:#b52d20; --color-n:#2456b8; --color-cl:#1e7a45;
  --color-s:#7d6200; --color-br:#8a4b00; --color-h:#6b7482; --color-f:#1d7a6e; --color-si:#4f7a1e;
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
#figbake svg.figbake-stereo text{ fill:#1c222d !important; font-family: "Helvetica Neue", Arial, sans-serif; }
#figbake svg.figbake-stereo polygon{ fill:#1c222d !important; }
#figbake svg.figbake-stereo g[data-bond="hash"] line{ stroke:#1c222d !important; }
#figbake svg.figbake-stereo > line{ stroke:#6b7482 !important; }
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
            const where = `reference-src/${id}.md`;
            /* ★★ 段2: `gen:` は何行でも（1行 ＝ 1分子・横一列）。⚠ 1行なら reference-md.js が文字列のまま返す */
            const gens = Array.isArray(b.gen) ? b.gen : [b.gen];
            const specs = gens.map(gt => parseGen(gt, where));
            // ★ 原稿の図は既定で紙の図の型（v1562）。⚠ numbered（主鎖の帯と C₁ の添え字）は丸の図の上で合わせてあるので丸の図のまま
            specs.forEach(spec => { if (!spec.circle && !spec.numbered && !spec.paper) { spec.paper = true; spec.paperByDefault = true; } });
            /* ★★ 図に重ねる印（v1609・`mark:`・DESIGN_figure_marks.md 段1）。
               ⚠ 読むだけ —— **描くのはアプリ**（`assembler/quiz.js` の `drawFigureMarks`）。
                 ここに作図を書くと、アプリの図と参考書の図が別々に育つ（この道具の冒頭の但し書き）。
               ⚠ 書式の検査は `reference-md.js` の `parseMark`（node もブラウザも同じ1本）。
               ★ 段2: `at=2:ニトロ基` の `2:` で**どの分子の印か**を振り分ける（書かなければ 1 番目 ＝ 1分子の図） */
            specs.forEach(spec => { spec.marks = []; });
            (b.mark || []).forEach(s => {
                const mk = RM.parseMark(s, where);
                const k = (mk.part || 1) - 1;
                if (!specs[k]) throw new Error(`${where} の ${b.src}: mark の at=${mk.at} は ${k + 1} 番目の分子を指していますが、gen: は ${specs.length} 行です`);
                const strip = (v) => (v == null ? v : String(v).replace(/^\d{1,2}:/, ''));
                specs[k].marks.push(Object.assign({}, mk, { at: strip(mk.at), to: strip(mk.to) }));
            });
            specs.forEach(spec => {
                /* ⚠ くさび図（stereo=）はアプリの立体ビューの絵を写すだけ ＝ 印も横並びもまだ載せられない（載せる口は紙の図の型にある） */
                if (spec.stereo && (spec.marks.length || specs.length > 1)) {
                    throw new Error(`${where} の ${b.src}: gen の stereo= の図には mark: も2行目の gen: も書けません（1行だけで書きます）`);
                }
                if (spec.marks.length && !spec.paper) {
                    throw new Error(`${where} の ${b.src}: mark: は紙の図にだけ重ねられます`
                        + '（gen に circle / numbered を書いた図には、まだ印を付けられません）');
                }
            });
            /* ★★ 段2: 分子と分子の間（`between:`）。⚠ 読むだけ —— 並べるのも線を引くのも**アプリ**（`composeFigureRow`） */
            const between = (b.between || []).map(s => RM.parseBetween(s, where));
            if (specs.length > 1) {
                specs.forEach((spec, i) => {
                    if (!spec.paper) {
                        throw new Error(`${where} の ${b.src}: 分子を並べる図は紙の図の型だけで描けます（${i + 1} 番目の gen: に circle / numbered があります）`);
                    }
                    spec.figurePart = true;
                    spec.anchors = [];
                });
                // 場所まで指す between の端は、その分子を描くときに当てておく（0個なら赤）
                between.forEach(bw => [bw.from, bw.dest].forEach(r => {
                    if (!r || r.place === null) return;
                    if (!specs[r.n - 1]) throw new Error(`${where} の ${b.src}: between が ${r.n} 番目の分子を指していますが、gen: は ${specs.length} 行です`);
                    if (!specs[r.n - 1].anchors.includes(r.place)) specs[r.n - 1].anchors.push(r.place);
                }));
            } else if (between.length) {
                throw new Error(`${where} の ${b.src}: between: は gen: を2行以上書いた図にだけ書けます`);
            }
            jobs.push({ id, src: b.src, gen: gens.join(' ＋ '), spec: specs[0], parts: specs.length > 1 ? specs : null, between });
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
        if (tok === 'vinyl') { spec.vinyl = true; return; }
        if (tok === 'ch2n') { spec.ch2n = true; return; }
        if (tok === 'units=1') { spec.units = 1; return; }
        /* ★ ケクレ式2つを描き分ける（段2・設計 §5）。1 ＝ 登録の並び・2 ＝ 環の単結合と二重結合を入れ替えたもの */
        const kk = /^kekule=(.*)$/.exec(tok);
        if (kk) {
            if (kk[1] !== '1' && kk[1] !== '2') throw new Error(`${where}: gen の kekule= は 1 か 2 です（いまは「${kk[1]}」）`);
            spec.kekule = kk[1];
            return;
        }
        const g = /^(condense|expand)=(.+)$/.exec(tok);
        if (g) {
            const keys = g[2].split(',').map(s => s.trim()).filter(Boolean);
            const ok = g[1] === 'expand' ? PAPER_EXPAND_KEYS : PAPER_GROUP_KEYS;
            const bad = keys.filter(k => !ok.includes(k));
            if (bad.length) throw new Error(`${where}: gen の ${g[1]}= に知らない原子団「${bad.join(',')}」があります（書けるのは ${ok.join(' / ')}）`);
            spec[g[1]] = keys;
            return;
        }
        /* ★ 立体の図（v1617・I-0104）。`stereo=` はアプリの「🧊 立体で見る」のくさび図・`fischer=` はフィッシャー投影 */
        const st = /^stereo=(.*)$/.exec(tok);
        if (st) {
            if (st[1] !== 'wedge' && st[1] !== 'mirror') throw new Error(`${where}: gen の stereo= は wedge か mirror です（いまは「${st[1]}」）`);
            spec.stereo = st[1];
            return;
        }
        /* ★ 裏返し（v1618・I-0112） */
        const fl = /^flip=(.*)$/.exec(tok);
        if (fl) {
            if (fl[1] !== 'v' && fl[1] !== 'h') throw new Error(`${where}: gen の flip= は v（上下）か h（左右）です（いまは「${fl[1]}」）`);
            spec.flip = fl[1];
            return;
        }
        const fi = /^fischer=(.*)$/.exec(tok);
        if (fi) {
            if (!/^[RS]{1,4}$/.test(fi[1])) throw new Error(`${where}: gen の fischer= は不斉炭素の R・S を上から並べて書きます（例 fischer=RR。いまは「${fi[1]}」）`);
            spec.fischer = fi[1];
            return;
        }
        const m = /^(name|formula|chain|subs)=(.+)$/.exec(tok);
        if (!m) throw new Error(`${where}: :::figure の gen に読めない語「${tok}」があります`
            + '（書けるのは name= / formula= / chain= / subs= / numbered / plain / haworth / paper / circle / condense= / expand= / kekule= / stereo= / fischer= / flip= / vinyl / ch2n / units=1）');
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
    if (spec.kekule && (spec.circle || spec.numbered)) throw new Error(`${where}: gen の kekule= は紙の図の型でだけ描けます（circle / numbered とは組めない）`);
    if (spec.stereo) {
        /* くさび図はアプリの立体ビューの絵をそのまま写すので、紙の図の型の上書き（原子団・番号・印）は効かない */
        const extra = ['formula', 'chain', 'numbered', 'plain', 'haworth', 'circle', 'kekule', 'condense', 'expand', 'fischer'].filter(k => spec[k]);
        if (extra.length) throw new Error(`${where}: gen の stereo= は name= とだけ組めます（${extra.join(' / ')} は書けない）`);
    }
    if (spec.units && (spec.circle || spec.numbered || spec.haworth || spec.fischer || spec.stereo || spec.formula || spec.chain)) throw new Error(`${where}: gen の units=1 は登録済みの名前と紙の図の型でだけ使えます`);
    if (spec.ch2n && (spec.circle || spec.numbered || spec.haworth || spec.fischer || spec.stereo)) throw new Error(`${where}: gen の ch2n は紙の図の型でだけ描けます（circle / numbered / haworth / fischer= / stereo= とは組めない）`);
    if (spec.vinyl && (spec.circle || spec.numbered || spec.haworth || spec.fischer || spec.stereo)) throw new Error(`${where}: gen の vinyl は紙の図の型でだけ描けます（circle / numbered / haworth / fischer= / stereo= とは組めない）`);
    if (spec.flip && (spec.circle || spec.numbered || spec.haworth || spec.fischer || spec.stereo)) throw new Error(`${where}: gen の flip= は紙の図の型でだけ描けます（circle / numbered / haworth / fischer= / stereo= とは組めない）`);
    if (spec.fischer && (spec.formula || spec.chain)) throw new Error(`${where}: gen の fischer= は登録済みの名前だけで使えます（formula= / chain= は組めない）`);
    if (spec.fischer && (spec.circle || spec.numbered || spec.haworth || spec.kekule)) throw new Error(`${where}: gen の fischer= は紙の図の型でだけ描けます（circle / numbered / haworth / kekule とは組めない）`);
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
    /* ★ 分子を決める道（①）を**ページに1つだけ**置く（段2: 1枚に分子を複数並べる図が、1分子ずつ同じ道を通るように）。
       ⚠ 中身は v1609 までの ① そのまま（場所を関数へ移しただけ） */
    await pg.evaluate(() => {
        window.__figResolve = (spec) => {
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

            /* ★ フィッシャー投影（v1617・I-0104）: 登録の図を**アプリのフィッシャーの操作**で縦に起こし、
               不斉炭素ごとに左右を入れ替えた図のうち、R・S の読み（上から）が `fischer=` と同じものを選ぶ。
               ⚠ 作図はここに書かない —— 回すのは `fischerOpRotate90/180`・入れ替えは `fischerOpMirror`（quiz.js・
                 フィッシャーの練習とタイムアタックが使う操作）、読むのは `assignRSDescriptor`（chemistry.js）。
                 どちらも**描いた図から読み直して**確かめる関数なので、選んだ図が名乗りと食い違うことはない */
            if (spec.fischer) {
                if (!entry) return { error: `fischer= は登録済みの名前だけで使えます（「${spec.name}」は登録にありません）` };
                if (typeof fischerOpMirror !== 'function' || typeof assignRSDescriptor !== 'function') {
                    return { error: 'アプリに fischerOpMirror / assignRSDescriptor がありません（古い版を配信している）' };
                }
                const base = entry.target;
                const orients = [base, fischerOpRotate90(g, base, 'cw'), fischerOpRotate180(g, base), fischerOpRotate90(g, base, 'ccw')].filter(Boolean);
                const readRS = (t) => {
                    const m = g.createTargetFromData({ target: t });
                    const rs = assignRSDescriptor(m);
                    const centers = Object.keys(readAtomParityFromFischer(m));
                    if (!rs || !centers.length || centers.some(id => !rs[id])) return null;
                    const top = centers.map(id => m.atoms.find(a => a.id === id)).sort((p, q) => p.y - q.y);
                    return { m, letters: top.map(a => rs[a.id].letter).join('') };
                };
                const seen = [];
                let best = null;
                orients.forEach(t0 => {
                    const m0 = g.createTargetFromData({ target: t0 });
                    const idx = Object.keys(readAtomParityFromFischer(m0)).map(id => m0.atoms.findIndex(a => a.id === id)).filter(i => i >= 0);
                    for (let mask = 0; mask < (1 << idx.length); mask++) {
                        let t = t0;
                        for (let k = 0; k < idx.length && t; k++) if (mask & (1 << k)) t = fischerOpMirror(g, t, idx[k], 'vertical');
                        if (!t) continue;
                        const r = readRS(t);
                        if (!r) continue;               // 主鎖が横 ＝ フィッシャー投影として読めない向き
                        if (!seen.includes(r.letters)) seen.push(r.letters);
                        if (r.letters !== spec.fischer) continue;
                        /* ★ 向きの候補が2つ（上下の入れ替え）残るときは、**酸化された端（C=O・C−O の多い炭素）を上**にする
                           ＝ 教科書の約束（COOH・CHO を上）。同点なら先に見つけたもの */
                        const topC = r.m.atoms.filter(a => a.element === 'C').sort((p, q) => p.y - q.y)[0];
                        const score = topC ? r.m.getNeighbors(topC.id).filter(n => n.atom.element === 'O').length : 0;
                        if (!best || score > best.score) best = { t, m: r.m, score };
                    }
                });
                if (!best) {
                    return { error: `「${spec.name}」をフィッシャー投影にして fischer=${spec.fischer} と読める図がありません`
                        + `（アプリの操作で作れた読みは ${seen.length ? seen.join(' / ') : '無し'}）` };
                }
                mol = best.m;
                const info = readStereoOf(mol);
                const meso = !!info && info.centers > 1 && info.stereoCode === info.mirrorCode;
                via += `・フィッシャー投影（上から ${spec.fischer.split('').join(',')}${meso ? '・メソ体' : ''}）`;
            }

            /* ★★ **名前で突き合わせる**（登録済みの1件は名前そのもので引いているので除く）。
               ⚠ これが無いと「原稿の名前と違う分子の図」が黙って焼ける */
            if (!entry) {
                const got = window.iupacName(mol);
                if (got !== spec.name) return { error: `組んだ分子の名前が「${got}」で、gen の name=「${spec.name}」と違います` };
            }
            /* ★ 裏返し（v1618・I-0112）: 紙の図の型は登録の座標をそのまま使う（learn.js の renderStandardFigure の
               ipCoordsUsable の道）ので、渡す前に座標を裏返すだけ。⚠ 作図はここに書かない */
            /* ★ 繰り返し単位1つぶん（v1619・I-0040）。⚠ 作図はしない —— 登録の原子と座標から1周期を切り出すだけ */
            if (spec.units) {
                const Rs = mol.atoms.filter(a => a.element === 'R');
                if (Rs.length !== 2) return { error: `units=1: 「${spec.name}」の両端が R の鎖として読めません（R が ${Rs.length} 個）` };
                const nb = id => mol.getNeighbors(id).map(x => x.atom);
                // R から R への主鎖（幅優先で最短の道）
                const prev = new Map([[Rs[0].id, null]]);
                const q = [Rs[0].id];
                while (q.length) { const c = q.shift(); if (c === Rs[1].id) break; nb(c).forEach(x => { if (!prev.has(x.id)) { prev.set(x.id, c); q.push(x.id); } }); }
                if (!prev.has(Rs[1].id)) return { error: `units=1: 「${spec.name}」の R と R がつながっていません` };
                const path = [];
                for (let c = Rs[1].id; c; c = prev.get(c)) path.unshift(c);
                const onPath = new Set(path);
                const bondType = (p, q2) => (mol.bonds.find(b => (b.atomId1 === p && b.atomId2 === q2) || (b.atomId1 === q2 && b.atomId2 === p)) || {}).type;
                const inner = path.slice(1, -1);
                const sig = inner.map((id, i) => {
                    const a = mol.atoms.find(x => x.id === id);
                    const side = nb(id).filter(x => !onPath.has(x.id)).map(x => x.element + bondType(id, x.id)).sort().join(',');
                    const next = bondType(id, path[i + 2]);   // 主鎖の次（端は R への結合）
                    return a.element + '[' + side + ']' + next;
                });
                let per = 0;
                for (let p2 = 1; p2 < sig.length; p2++) {
                    if (sig.length % p2) continue;
                    if (sig.every((x, i) => i + p2 >= sig.length || x === sig[i + p2])) { per = p2; break; }
                }
                if (!per || per === sig.length) return { error: `units=1: 「${spec.name}」の主鎖に繰り返しが見つかりません` };
                // 1周期ぶん（inner[0..per-1]）とその枝を残し、両端に R
                const keepIds = new Set([Rs[0].id]);
                inner.slice(0, per).forEach(id => { keepIds.add(id); nb(id).filter(x => !onPath.has(x.id)).forEach(x => keepIds.add(x.id)); });
                const tail = mol.atoms.find(x => x.id === inner[per]);   // 次の単位の先頭の位置に R を置く
                const keep = mol.atoms.filter(a => keepIds.has(a.id));
                const idx = new Map(keep.map((a, i) => [a.id, i]));
                const tAtoms = keep.map(a => ({ element: a.element, x: a.x, y: a.y }));
                tAtoms.push({ element: 'R', x: tail.x, y: tail.y });
                const tBonds = mol.bonds.filter(b => idx.has(b.atomId1) && idx.has(b.atomId2))
                    .map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }));
                tBonds.push({ atom1Index: idx.get(inner[per - 1]), atom2Index: tAtoms.length - 1, type: bondType(inner[per - 1], inner[per]) || 1 });
                mol = g.createTargetFromData({ target: { atoms: tAtoms, bonds: tBonds } });
                via += `・繰り返し単位1つ（主鎖 ${per} 原子）`;
            }
            if (spec.vinyl) {
                if (typeof g.reshapeDoubleBond !== 'function') return { error: 'アプリに game.reshapeDoubleBond がありません（古い版を配信している）' };
                const geo0 = typeof readBondGeoFromCoords === 'function' ? JSON.stringify(readBondGeoFromCoords(mol)) : null;
                const inRing = (typeof ringAtomIdsOf === 'function') ? ringAtomIdsOf(mol) : new Set();
                const saved = g.userMolecule;
                g.userMolecule = mol;   // reshapeDoubleBond は userMolecule を見る（quiz.js の reshapeGeometryForDisplay と同じ借り方）
                let n = 0;
                try {
                    mol.bonds.filter(b => b.type === 2).forEach(b => {
                        const a1 = mol.atoms.find(a => a.id === b.atomId1), a2 = mol.atoms.find(a => a.id === b.atomId2);
                        if (a1.element !== 'C' || a2.element !== 'C' || (inRing.has(a1.id) && inRing.has(a2.id))) return;
                        const subs = (id, other) => mol.getNeighbors(id).filter(x => x.atom.id !== other && x.atom.element !== 'H').map(x => x.atom);
                        g.reshapeDoubleBond(b, subs(b.atomId1, b.atomId2), subs(b.atomId2, b.atomId1));
                        n++;
                    });
                } finally { g.userMolecule = saved; }
                if (!n) return { error: `vinyl: 「${spec.name}」に環の外の C=C がありません` };
                if (geo0 !== null && JSON.stringify(readBondGeoFromCoords(mol)) !== geo0) return { error: `vinyl: 整形で「${spec.name}」のシス・トランスが変わりました（整形は立体を書き換えてはいけない）` };
                mol._ipFixedLayout = false;
                via += '・C=C を ±120° に';
            }
            if (spec.flip) {
                mol.atoms.forEach(a => { if (spec.flip === 'v') a.y = -a.y; else a.x = -a.x; });
                via += spec.flip === 'v' ? '・上下を裏返し' : '・左右を裏返し';
            }
            return { mol, via };
        };
    });
    for (const job of jobs) {
        const bakeOne = (spec, parts, between) => pg.evaluate(({ spec, parts, between, OUT_W, MAX_H, FIT_W, BODY_W }) => {
            const g = window.game;
            /* ── ② アプリの描画をそのまま呼ぶ（★ ここに作図を書かない）──────────── */
            document.getElementById('figbake')?.remove();
            const box = document.createElement('div');
            box.id = 'figbake';
            const NS = 'http://www.w3.org/2000/svg';
            const makeSvg = (id) => {
                const s = document.createElementNS(NS, 'svg');
                s.id = id;
                ['quiz-bonds', 'quiz-atoms'].forEach(c => {
                    const gg = document.createElementNS(NS, 'g');
                    gg.setAttribute('class', c);
                    s.appendChild(gg);
                });
                box.appendChild(s);
                return s;
            };
            document.body.appendChild(box);
            /* 1分子を1つの svg へ描く（★ 書き出し練習の答え合わせに出るのと**同じ関数**。`this` は `game` を持つ物だけでよい）。
               ⚠ 印（`marks`）・between の端（`anchors`）が1つも当たらなければ**ここで投げる** ＝ 印の無い図を焼かない（設計 §3）。
               ★ 投げたものは `error` にして返す（呼び手が赤で止める。焼き上がりは1枚も出ない） */
            const drawOne = (sp, svgEl, where) => {
                const res = window.__figResolve(sp);
                if (res.error) return { error: where + res.error };
                if (sp.kekule && !sp.paper) return { error: where + 'kekule= は紙の図の型でだけ描けます（--src= の1枚焼きでは paper を書きます）' };
                try {
                    IsomerPractice.prototype.renderStandardFigure.call({ game: g }, svgEl.id, res.mol, !!sp.numbered,
                        Object.assign({ paper: !!sp.paper, condense: sp.condense || [], expand: sp.expand || [], marks: sp.marks || [] },
                            sp.kekule ? { kekule: sp.kekule } : {},
                            sp.fischer ? { fischer: true } : {},
                            sp.ch2n ? { ch2n: true } : {},
                            sp.figurePart ? { figurePart: true, anchors: sp.anchors || [] } : {}));
                } catch (e) {
                    return { error: where + ((e && e.message) || String(e)) };
                }
                /* ★ 素の位置番号（`1 2 3 …`）だけを消す。⚠ 元素記号（`.svg-atom-text`）は残す
                   ＝ 形にも結合にも触っていない（描いたあとで文字を1種類だけ取り去るだけ） */
                if (sp.plain) {
                    svgEl.querySelectorAll('.quiz-atoms > text:not(.svg-atom-text)').forEach(t => t.remove());
                }
                return res;
            };
            /* ★★ くさび図（`stereo=`・v1617・I-0104）= **アプリの「🧊 立体で見る」の絵そのもの**（`assembler/stereo.js` の StereoView）。
               ・分子を立体ビューに渡して開き（`openAuto`。★ 立体ビューはキャンバスの分子を見るので、
                 `reshapeGeometryForDisplay` と同じく `game.userMolecule` を一時だけ差し替える）、
                 `mirror` なら「🪞 鏡像と並べる」（`setWedgeMirror`）を押した状態にする
               ・描き上がった `#stereo-svg` を写して撮る。⚠ 作図はしない。消すのは画面用の見出し
                 （「あなたの分子」「🪞 鏡像」）と、透明の当たり判定だけ
               ・色は PAPER_CSS の `svg.figbake-stereo` の段が紙の色へ読み替える（アプリの画面は変わらない） */
            const drawStereo = (sp) => {
                const res = window.__figResolve(sp);
                if (res.error) return { error: res.error };
                const sv = window.stereoView;
                if (!sv || typeof sv.openAuto !== 'function' || typeof sv.setWedgeMirror !== 'function') {
                    return { error: 'アプリに stereoView（🧊 立体で見る）がありません' };
                }
                const saved = g.userMolecule;
                g.userMolecule = res.mol;
                let copy = null, err = null;
                try {
                    sv.openAuto(res.mol);
                    if (!sv.centerId || !sv._viewSlots) err = `「${sp.name}」に、くさび図を描ける sp3 炭素がありません`;
                    else if (sp.stereo === 'mirror' && !sv._isAsym) err = `「${sp.name}」の中心の炭素は不斉炭素原子ではありません（鏡像と並べても同じ分子）`;
                    else if (sv._provisional) err = `「${sp.name}」の登録の図はフィッシャー投影として読めないので、くさび図の並びが仮になります（D-/L- の付いた登録を使ってください）`;
                    else {
                        sv.setMode('wedge');
                        if (sp.stereo === 'mirror') sv.setWedgeMirror(true);
                        if (sp.stereo === 'mirror' && !sv.wedgeMirror) err = '「🪞 鏡像と並べる」が効きませんでした';
                        else copy = document.getElementById('stereo-svg').cloneNode(true);
                    }
                } catch (e) {
                    err = (e && e.message) || String(e);
                } finally {
                    try { sv.close(); } catch (e) { /* 閉じられなくても焼くのは写し */ }
                    g.userMolecule = saved;
                }
                if (err) return { error: err };
                copy.id = 'figbake-svg';
                copy.setAttribute('class', 'figbake-stereo');
                copy.removeAttribute('width'); copy.removeAttribute('height'); copy.removeAttribute('style');   // 画面の暗い台紙（index.html の style 属性）
                copy.querySelectorAll('[data-slot="title"], [data-hit]').forEach(n => n.remove());
                copy.querySelectorAll('.clickable').forEach(n => n.classList.remove('clickable'));
                box.appendChild(copy);
                /* 見出しを消したぶん上が空くので、描いたものの外枠で viewBox を詰める（⚠ 形には触らない） */
                const bb = copy.getBBox();
                const pad = 14;
                copy.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
                return { svg: copy, mol: res.mol, via: res.via + (sp.stereo === 'mirror' ? '・くさび図と鏡像' : '・くさび図') };
            };
            let svg, mol, via;
            if (!parts && spec.stereo) {
                const r0 = drawStereo(spec);
                if (r0.error) return { error: r0.error };
                svg = r0.svg; mol = r0.mol; via = r0.via;
            } else if (!parts) {
                svg = makeSvg('figbake-svg');
                const r1 = drawOne(spec, svg, '');
                if (r1.error) return { error: r1.error };
                mol = r1.mol; via = r1.via;
            } else {
                /* ★★ 段2: 1分子ずつ描いてから、アプリの `composeFigureRow` が横一列に並べて between を引く */
                if (typeof composeFigureRow !== 'function') return { error: 'アプリに composeFigureRow がありません（v1610 より古い版を配信している）' };
                const subs = [], vias = [];
                let atoms = 0;
                for (let i = 0; i < parts.length; i++) {
                    const s = makeSvg('figbake-part-' + (i + 1));
                    const ri = drawOne(parts[i], s, `${i + 1} 番目の gen:（${parts[i].name}）: `);
                    if (ri.error) return { error: ri.error };
                    subs.push(s); vias.push(ri.via); atoms += ri.mol.atoms.length;
                }
                svg = document.createElementNS(NS, 'svg');
                svg.id = 'figbake-svg';
                box.appendChild(svg);
                try {
                    composeFigureRow(svg, subs, between);
                } catch (e) {
                    return { error: (e && e.message) || String(e) };
                }
                subs.forEach(s => s.remove());
                mol = { atoms: { length: atoms } }; via = vias.join(' ＋ ');
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
            const nMarks = (parts || [spec]).reduce((s, sp) => s + (sp.marks || []).length, 0) + (between || []).length;
            /* ★ 最終的な見た目の字の大きさ（2026-09-24 ユーザー「図表の最低フォントサイズを上げてください（最終的な見た目）」）。
               図は公開ページで本文の幅 BODY_W（680px）いっぱいに出るので、SVG の字 f は f × BODY_W ÷ viewBox の幅 に見える。
               ⚠ 位置番号など消す字（plain）は数えない。いちばん小さい字（下付き・印の文字を含む）を返す */
            let minFont = Infinity;
            svg.querySelectorAll('text, tspan').forEach(t => {
                if (!t.textContent.trim()) return;
                const f = parseFloat(getComputedStyle(t).fontSize);
                if (f > 0 && f < minFont) minFont = f;
            });
            const minText = isFinite(minFont) ? minFont * BODY_W / vb[2] : null;
            return { ok: true, via, w, h, aspect: vb[2] / vb[3], atoms: mol.atoms.length, marks: nMarks, markWarn, minText };
        }, { spec, parts: parts || null, between: between || [], OUT_W, MAX_H, FIT_W, BODY_W });
        let r = await bakeOne(job.spec, job.parts, job.between);
        /* ★ 紙の図の型は字の長さぶん価標を伸ばすので、長い鎖（ステアリン酸 C₁₈）は横に伸びて床 9:1 を超える（v1562 実測 10.1:1）。
           ⚠ 鎖を (CH₂)₁₆ に畳むかはユーザーの判断待ちなので、ここでは決めない ——
           **原稿の既定で紙の図になっている図だけ**、平たすぎたら丸の図（v1562 までの見た目）で焼き直して、そのことを出力に書く。
           `paper` を明示した図（--src= の1枚焼き）は今までどおり赤で止める */
        /* ⚠ 印のある図は**丸の図へ落とさない** —— 落とすと印が黙って消える（印は紙の図にだけ描く）。
           平たすぎれば下の床（ASPECT_WARN）で赤に止まる ＝ 気づける */
        if (!r.error && r.aspect > ASPECT_WARN && job.spec.paperByDefault && !(job.spec.marks || []).length && !job.parts) {
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
            + `  ← ${job.parts ? job.parts.map(p => p.name).join(' ＋ ') : job.spec.name}${job.spec.numbered ? '（番号つき）' : ''}  [${r.via}]`
            + (r.marks ? `  ＋印 ${r.marks} 本` : '')
            + (r.minText ? `  字 ${r.minText.toFixed(1)}px${r.minText < MIN_TEXT ? ' ⚠床' + MIN_TEXT + '未満' : ''}` : '')
            + (r.fellBack ? `  ⚠ ${r.fellBack}` : (job.spec.stereo ? '  （立体ビューのくさび図）' : job.spec.paper ? '  （紙の図）' : '  （丸の図）')));
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
