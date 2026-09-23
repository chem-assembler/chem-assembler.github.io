/**
 * 参考書の本文（reference-src/*.md）の書式 —— parser と serializer。
 *
 * ★★ **正は `reference-src/<id>.md`。`assembler/reference.json` はここから生成する生成物。**
 *    設計は `DESIGN_reference_book.md` §16。発端はユーザーの申し立て
 *    「json だとこちらで校正ができないので、校正手順を考えてください」。
 *
 * ⚠ **このファイルは node とブラウザの両方から読まれる**:
 *    - `tools/gen-reference.mjs`（生成）と `tools/verify-release.js`（規則10）… `require`
 *    - `assembler/test.html` の `REF17` … `<script src="../tools/reference-md.js?v=NN">`
 *    ★ **書式の実装を1本にしておくため**。2本あると、生成器とテストが別々の書式を信じて
 *      「緑なのに壊れている」が作れる。
 *
 * ⚠ **ES5 の範囲で書く**（`assembler/` の他のファイルと同じ。ブラウザから素の script で読むため）。
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReferenceMd = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ===== 書式の定義（ここが唯一の台帳） ===================================== */

    /* ページの前書き。**JSON のキーの並びはここが決める**（.md に書く順は自由）。
       ★ `summary` / `video` は面A（`/reference/` の公開ページ・§17）のために足したもの。 */
    var PAGE_KEYS = ['id', 'unit', 'unitLabel', 'group', 'title', 'summary', 'codes', 'source', 'singleSource', 'video', 'why'];
    var PAGE_LIST_KEYS = ['codes', 'source'];      // `key:` ＋ `  - 値` で書く
    var PAGE_BOOL_KEYS = ['singleSource'];

    /* ⚠ **任意でよいのは「まだ実体が無いもの」だけ**（設計書 §17-2）。
       `video` … 解説動画は 2026-09-08 時点で **0本**。⚠ 値は **YouTube の動画ID**
                 （`video-scripts/` の台本 id ではない —— 埋め込むには配信先の id が要るので、
                   台本 id を許すと「埋め込めない値が書式上は通る」ことになる）。
       ⚠ `summary` は**必須**にした。5枚とも いま書けるし、
          **検索結果に出る文を機械が勝手に決めると、ユーザーが校正できない**（§16 の目的と逆向き）。
       ★★ `codes` … **単元をまたぐ横断のページは、知識項目をひとつも抱えない**（設計書 §26）。
          官能基の一覧は「−OH はアルコール、−CHO はアルデヒド」と**行き先を指すページ**で、
          −OH の性質そのものはアルコールのページが持つ ＝ 知識項目はそちらに属する。
          ⚠ **空の配列は書かない**（`codes:` と書いて中身が無い形は上の `parseKV` が弾く）——
            **キーごと書かない**。面Aは「キーが在るか」だけで枠を出すかを決めるので、
            空配列を許すと「一問一答の箱は出るが 0問」という第3の状態ができる。 */
    var PAGE_OPTIONAL_KEYS = ['video', 'codes'];
    var VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

    /* `:::` の囲み。**`learn.js` の `renderBlock` が実際に描ける種類だけ**。
       ⚠ 足すときは learn.js と**両方**直す（`REF17` ③ が突き合わせて赤くする）。
       order … JSON のキーの並び / req … 必須 / list … 配列でもよい / prose … 本文の記法が効く
       bool … true / false だけ（`ordered`） / enum … 決まった語だけ（`level` / `tone`）

       ★ 上の6つは 2026-09-09（設計書 §19）に足したもの。**発端はユーザーの申し立て**
         「参考書の中身は全面的に修正したい／化学学習者が参照する参考書になっていない」——
         ⚠ それまで書けたのは**段落と、機械が組む4つの表／例題だけ**で、
         **見出し・箇条書き・図・化学反応式・手で書く表が1つも書けなかった。** */
    var LEVELS = ['★★★', '★★☆', '★☆☆'];
    /* ⚠ `note`（補足）は **型を書かない `::: … :::` の行き先**（§20-4）。
       ★ ユーザーは「ちょっと囲みたい」だけのことがあり、そのたびに tone を選ばせない。 */
    var TONES = ['caution', 'memorize', 'skip', 'note'];
    /* ★★ 発展の印（設計書 §23・REFBOOK_STYLE §10）。**節と小見出しに `advanced: true` を足す**。
       ⚠⚠ **意味は「範囲の外」だけ。重要度も暗記の要否も言わない** ——
         覚える範囲の線引きは今までどおり**本文の文**が持つ（REFBOOK_STYLE §8-5・本人の最大の特徴）。
       ★ だから `:::reaction` の `level`（重要度）とも喧嘩しない ＝ **同じことを2か所で決めない**。
       ⚠ 語尾に「（発展）」と書くやり方は**受けない**（下の checkBlock が直し方まで言って止める）。
         ★ 理由は2つ: ① 目次に出るのは節の `title` なので、語尾に書くと目次の文字まで変わる
         ② 同じことを2通りで書けると、どちらが正かが原稿ごとに割れる（`align` の3語と同じ理由）。 */
    /* ★ 穴あきテンプレート `○○` に付く class。⚠ **learn.js は class 名を持たない**
       （器は書式の側が焼き込む1か所だけ）。見た目は style.css / LIGHT_CSS が持つ。 */
    var BLANK_CLASS = 'ref-blank';
    /* ★ ぶら下げの補足の印（設計書 §23-3）。**行頭の全角スペース1つ**。
       ⚠ ユーザーが書いた字下げそのものなので、原稿を見たときに見た目が変わらない。 */
    var HANG_MARK = '　';
    var ADVANCED_WORD = '発展';
    var ADVANCED_SUFFIX_RE = /[（(]\s*発展\s*[)）]\s*$/;
    /* ★★ 語尾の「（発展）」は**受け取って `advanced: true` に直す**（黙って捨てない・§20 の思想）。
       ⚠ ユーザーは実際にそう書いた（`## 枝分かれすると沸点が下がる（発展）`）ので、
         赤にするのではなく**同じ意味の1つの形へ寄せる** —— 保存される形は `advanced` の1つだけ。
       ★ 直したことは `--tidy` の一覧に出る（勝手に揃えたものは見せる・§1）。 */
    function foldAdvanced(title) {
        if (!ADVANCED_SUFFIX_RE.test(title)) return null;
        return String(title).replace(ADVANCED_SUFFIX_RE, '').replace(/\s+$/, '');
    }
    /* ★ 表の列ごとの寄せ（§20-9）。⚠ **綴りは1組だけ**（日本語の「右」も受けると、
       同じことを2通りで書ける ＝ どちらが正かが原稿ごとに割れる）。★ 赤が3語を必ず並べる。 */
    var ALIGNS = ['left', 'center', 'right'];
    /* 型を書かなかった囲みの既定。⚠ **2か所に書かない**（learn.js は tone の語だけを持つ） */
    var DEFAULT_FENCE = { kind: 'callout', tone: 'note' };

    /* ★★ 区分（有機・無機・理論）—— 索引の1段目（設計書 §31-1・2026-09-19 便0a）。
       ⚠⚠ **前書きに新しいキーを足さない**（校正中の有機46枚の原稿を1文字も触らないため）。
       ★ 区分は `unit` の頭から引く: `inorg.*` → 無機、`theo.*` → 理論、それ以外（有機の
         `alcohol` `aliphatic` のような素の名前）→ 有機。**対応表はここの1本だけ**。
       ⚠ 点を含む `unit` で頭が知らない語なら赤（`calc.ratio` のような綴りを黙って有機にしない）。
       ★ 並びはこの配列の順（有機 → 無機 → 理論・ユーザー決定 2026-09-10）。 */
    var DIVISIONS = [
        { key: 'org', label: '有機' },
        { key: 'inorg', label: '無機' },
        { key: 'theo', label: '理論' }
    ];
    function divisionOf(unit) {
        var u = String(unit || '');
        var dot = u.indexOf('.');
        if (dot < 0) return 'org';
        var head = u.slice(0, dot);
        for (var i = 0; i < DIVISIONS.length; i++) if (DIVISIONS[i].key === head) return head;
        return null;
    }
    function divisionLabel(key) {
        for (var i = 0; i < DIVISIONS.length; i++) if (DIVISIONS[i].key === key) return DIVISIONS[i].label;
        return null;
    }

    /* ★★ 反応式の矢印（設計書 §31-2）。**既定は →**（書かなければ今までどおり）。
       ⚠ 可逆は `arrow: ⇄`。⛔ `left` / `right` に ⇄ を書く逃げ道は作らない（式が崩れる）——
         下の checkBlock が直し方まで言って止める。 */
    var ARROWS = ['→', '⇄'];

    /* ★★ アプリへの「試す」リンクの**受け口の台帳**（設計書 §31-3・ref-inorg-design §6-1）。
       ⚠⚠ **URL の形を原稿に書かせない**（`open:` と同じ「新しい URL を発明しない」）。
         原稿は `app: ion-equation/redox` と `id: rs1` の2つだけを書き、URL はここで組む。
       ★ 1行 ＝ 名前 → { path（ルート絶対）, param（引数の名前。`#` は URL の # の後ろ・null は引数なし）}。
       ⚠ **行き先を足すのは、受け口が実在してから**（受け側のコードの場所は設計メモ §6-1 の表）。
       ⚠ **id が相手のデータに実在するかは、ここでは見ない** —— 受け口の持ち主のアプリの
         test.html が `reference.json` を読んで見る（CLAUDE.md「横断の整合性検査は両方のデータが揃う側に置く」）。 */
    /* ⚠⚠ **名前は受け側（便0b）の表とそろえてある**: ion-equation/tests.js の `refReceiversIon`・
         ratio/tests.js・muki/tests.js の `refReceivers`。足す・消すときは**3つの表も同時に**。
         ★ ただし各表が持つのは**自分のアプリの名前だけ**（自分宛てのリンクしか見ない）＝ `ratio/*` を足したら ratio/tests.js の表に足す。
       ⚠ id の要否も受け側に合わせる —— 引数を取る受け口は **id が必須**（無いと受け側の検査が赤）。
         省略してよいのは `opt: true` の1つだけ（muki/akinator の ?deck= ＝ 既定のデッキ）。
       ★ `ion-equation` と `ion-equation/index`、`muki` と `muki/index` は同じもの（受け側の表にどちらも在る） */
    var APP_TARGETS = {
        'ion-equation': { path: '/ion-equation/', param: 'rxn' },
        'ion-equation/index': { path: '/ion-equation/', param: 'rxn' },
        'ion-equation/redox': { path: '/ion-equation/redox.html', param: 'rxn' },
        'ion-equation/oxidation': { path: '/ion-equation/oxidation.html', param: 'sp' },
        /* ★★ `embeddable: true` ＝ **参考書のページの中に iframe で置いてよい受け口**
             （DESIGN_reference_centric.md §2-4・段1）。⚠ **受け側（ion-equation/tests.js の
             `refReceiversIon`）の `embeddable` の写し**で、3表同時の既存規約に4つめとして乗る。
           ⚠ 足してよいのは、子が `embed=1` の3点（看板を隠す・高さを送る・帯を作らない）を
             実装している受け口だけ。それ以外に `embed: true` を書いたら赤にする（下の checkBlock）。 */
        'ion-equation/halfreaction': { path: '/ion-equation/halfreaction.html', param: 'q', embeddable: true },
        'ion-equation/halflist': { path: '/ion-equation/halflist.html', param: null, embeddable: true },
        'ion-equation/battery': { path: '/ion-equation/battery.html', param: 's' },
        'ion-equation/electrolysis': { path: '/ion-equation/electrolysis.html', param: 's' },
        'ion-equation/condition': { path: '/ion-equation/condition.html', param: 's' },
        'ion-equation/portal': { path: '/ion-equation/portal.html', param: '#' },
        'muki': { path: '/muki/', param: 'open' },
        'muki/index': { path: '/muki/', param: 'open' },
        'muki/separation': { path: '/muki/separation.html', param: null },
        'muki/tree': { path: '/muki/tree.html', param: null },
        'muki/snake': { path: '/muki/snake.html', param: null },
        'muki/akinator': { path: '/muki/akinator.html', param: 'deck', opt: true },
        'ratio/stoich': { path: '/ratio/stoich.html', param: 'r' },
        'ratio/titration': { path: '/ratio/titration.html', param: null },
        /* ★ 理論の便0（2026-09-19・ref-theory-design §6-1）: 3つとも引数を取らない（開くと最初の問題） */
        'ratio/proportion': { path: '/ratio/proportion.html', param: null },
        'ratio/balance': { path: '/ratio/balance.html', param: null },
        /* ★ thermo は 2026-09-20 に `?h=` を足した（h1〜h6。参考書が問を名指しでき、図の撮影も URL だけで決まる） */
        'ratio/thermo': { path: '/ratio/thermo.html', param: 'h', opt: true }
    };
    /* 受け口へ渡す id の綴り。⚠ `MnO4-`（化学式）・`MnO4_red,Fe2_ox`（半反応式の列）・`u-gas` を受ける */
    var APP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.,+-]*$/;
    /* ★ 戻り道（CLAUDE.md「アプリ横断のリンクは往復にする」）。**自分が誰かだけ**送る ——
       どこへ戻すか（`/reference/<page>/`）は受け側の帯が決める。 */
    var APP_FROM = 'from=reference';

    /** `app:` と `id:` から href を組む（ルート絶対）。pageId は戻り道のため。
     *  ★ `embed` が真なら **`embed=1` を足すだけ**（DESIGN_reference_centric.md §2-4 (1)）——
     *    ⛔ 埋め込み専用の引数は作らない。⛔ `?v=` も付けない（§2-6）。
     *  ⚠ 素の href（`embed` なし）は**残す** —— 面Bのリンクと「▶ 大きな画面で開く」がそれを使う。 */
    function appHref(app, id, pageId, embed) {
        var t = APP_TARGETS[app];
        var from = (embed ? 'embed=1&' : '') + APP_FROM + (pageId ? '&page=' + encodeURIComponent(pageId) : '');
        if (t.param === '#') return t.path + '?' + from + (id ? '#' + id : '');
        return t.path + '?' + (id ? t.param + '=' + encodeURIComponent(id).replace(/%2C/g, ',') + '&' : '') + from;
    }

    /* ★★ アプリの画面の切り取り（`:::figure` の `shot:`・設計書 §31-4）。
       `shot: url=/ion-equation/electrolysis.html?s=e3 sel=#cell-svg wait=800 scale=1 状態=…`
       ⚠ 焼くのは `tools/gen-app-figure.mjs`（`gen:` の `gen-figure.mjs` とは別物・同じ図に両方は書けない）。
       ★ `状態=` は**撮る人のための覚え書き**（何をしてから撮ったか）で、道具は読むだけで何もしない。
       ⚠ `sel=` には空白を含むセレクタも書ける（次の `キー=` の手前までが値）。 */
    var SHOT_KEYS = ['url', 'sel', 'wait', 'scale', 'act', '状態'];
    /* `act=` は「撮る前に1手だけ呼ぶ」—— アプリ自身のデバッグ用の口（window.Chem…App.…）だけ。
       ★ なぜ要るか: 熟化学の問2〜4 は学習者が準位を置いてから図ができるので、
       開いた直後を撮ると土台しか写らない（2026-09-20 実測）。
       ⚠ 条件: `window.<アプリの口>.<関数>(引数)` の1文だけ（空白なし）。
       同じ URL ・同じ act で 2 回撮って 1 バイトでも違えば赤なのは変わらない（抽選の画面を黙って焼かない）。 */
    var SHOT_ACT_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+\([^()\s]*\)$/;
    var SHOT_URL_RE = /^\/(ion-equation|muki|ratio|assembler)\/[^\s]*$/;
    function parseShot(text, where) {
        var s = String(text).trim();
        var re = /(^|\s)(url|sel|wait|scale|act|状態)=/g, cuts = [], m;
        while ((m = re.exec(s))) cuts.push({ key: m[2], at: m.index + m[1].length, from: m.index + m[0].length });
        if (!cuts.length || cuts[0].at !== 0) {
            fail(where, ':::figure の shot は「url=… sel=…」の形で書きます（いまは「' + s.slice(0, 60) + '」）'
                + '\n    ★ 書けるのは ' + SHOT_KEYS.map(function (k) { return k + '='; }).join(' / '));
        }
        var out = {};
        cuts.forEach(function (c, i) {
            if (Object.prototype.hasOwnProperty.call(out, c.key)) fail(where, ':::figure の shot に「' + c.key + '=」が2回あります');
            out[c.key] = s.slice(c.from, i + 1 < cuts.length ? cuts[i + 1].at : s.length).trim();
        });
        if (!out.url || !SHOT_URL_RE.test(out.url)) {
            fail(where, ':::figure の shot の url= は自分たちのアプリのパスをルートから書きます'
                + '（/ion-equation/ /muki/ /ratio/ /assembler/ のどれかで始まる・空白なし。いまは「' + (out.url || '') + '」）');
        }
        if (!out.sel) fail(where, ':::figure の shot に sel=（撮る要素の CSS セレクタ）がありません（⚠ 画面全体は撮らない）');
        if (out.wait !== undefined && !/^\d{1,5}$/.test(out.wait)) fail(where, ':::figure の shot の wait= はミリ秒の整数です（いまは「' + out.wait + '」）');
        if (out.scale !== undefined && out.scale !== '1' && out.scale !== '2') fail(where, ':::figure の shot の scale= は 1 か 2 です（いまは「' + out.scale + '」）');
        if (out.act !== undefined && !SHOT_ACT_RE.test(out.act)) {
            fail(where, ':::figure の shot の act= は「ChemThermoApp.placeAll()」のような1文だけです'
                + '（アプリのデバッグ用の口を1つ呼ぶ・空白なし。いまは「' + out.act + '」）');
        }
        return out;
    }

    /* ★★ 図に重ねる印（`:::figure` の `mark:`・DESIGN_figure_marks.md §4・段1）。
         mark: kind=囲む at=グリコシド結合 label=グリコシド結合 count=1
       ⚠ **1行に1つ・何本でも書ける**（下の `multi` のキー）。★ 描くのは**アプリの SVG**
         （`assembler/quiz.js` の `drawPaperMolecule`）で、この道具は**読んで渡すだけ** ——
         作図を2本にしないための決まり（設計 §1・I-0081）。
       ★ `at=` は**化学の言葉で指す**のが主（`不斉炭素`・`グリコシド結合`・`カルボキシ基`）、
         位置番号（`C1-OH`・`環C2`・`C3-C4`）が補助（設計 §3）。⚠ **原稿に座標は書かせない** ——
         囲みの大きさも `label=` の置き場所も作図器が計算する（設計 §4）。
       ⚠ `at=` が0個に当たったら**焼くときに赤**（設計 §3）。`count=` は期待する個数で、
         合わなければ赤 ＝ **数が変わったことに気づける**。 */
    var MARK_KEYS = ['kind', 'at', 'to', 'label', 'count', 'color', 'kinds'];
    /* 段1 の3つ ＋ 段2 の `破線`・`矢印`（**1つの分子の中**の2か所を結ぶ。分子内の水素結合など）。
       ⚠ 分子と分子の**間**を結ぶのは `mark:` ではなく `between:`（下の parseBetween・設計 §5） */
    /* ＋ `対称面`（v1617・I-0104）… at= の2か所の真ん中を直角に横切る破線（メソ体）。⚠ 図が折り返し対称でなければ焼くときに赤 */
    var MARK_KINDS = ['囲む', '枠', '文字', '破線', '矢印', '対称面'];
    /* `to=`（もう一方の端）が要る印 */
    var MARK_LINK_KINDS = ['破線', '矢印'];
    var MARK_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    /* 「キー=値 キー=値 …」を切る（`mark:` と `between:` で同じ1本）。⚠ 値に空白を含んでよい（次の `キー=` の手前まで） */
    function cutKeyVals(text, keys, what, where) {
        var s = String(text).trim();
        var re = new RegExp('(^|\\s)(' + keys.join('|') + ')=', 'g'), cuts = [], m;
        while ((m = re.exec(s))) cuts.push({ key: m[2], at: m.index + m[1].length, from: m.index + m[0].length });
        if (!cuts.length || cuts[0].at !== 0) {
            fail(where, ':::figure の ' + what + ' は「kind=… at=…」の形で書きます（いまは「' + s.slice(0, 60) + '」）'
                + '\n    ★ 書けるのは ' + keys.map(function (k) { return k + '='; }).join(' / '));
        }
        var out = {};
        cuts.forEach(function (c, i) {
            if (Object.prototype.hasOwnProperty.call(out, c.key)) fail(where, ':::figure の ' + what + ' に「' + c.key + '=」が2回あります');
            out[c.key] = s.slice(c.from, i + 1 < cuts.length ? cuts[i + 1].at : s.length).trim();
        });
        return out;
    }
    /* ★ 何番目の分子か（`2:ニトロ基`・`2`）を切り出す（設計 §5）。`n` は数・`place` は無ければ null。
       ⚠ `1:` の後ろが空（`at=1:`）は書き損じなので赤 */
    function splitFigureRef(v, what, where) {
        var m = /^(\d{1,2}):(.*)$/.exec(v);
        if (m) {
            if (!m[2].trim()) fail(where, ':::figure の ' + what + ' の「' + v + '」は「' + m[1] + ':」の後ろが空です（場所を書くか、「' + m[1] + '」だけにします）');
            return { n: parseInt(m[1], 10), place: m[2].trim() };
        }
        if (/^\d{1,2}$/.test(v)) return { n: parseInt(v, 10), place: null };
        return { n: null, place: v };
    }
    function checkColor(out, what, where) {
        if (out.color !== undefined && !MARK_COLOR_RE.test(out.color)) {
            fail(where, ':::figure の ' + what + ' の color= は #6a1b9a の形で書きます（いまは「' + out.color + '」）'
                + '\n    ⚠ 色だけに意味を持たせないこと（形か文字でも分かるように・設計 §4）');
        }
    }
    function parseMark(text, where) {
        var out = cutKeyVals(text, MARK_KEYS, 'mark', where);
        /* ⚠ 綴り違いを黙って無視しない（設計 §6）—— 通すと「印の指定が在るのに何も出ない図」ができる */
        if (MARK_KINDS.indexOf(out.kind) < 0) {
            fail(where, ':::figure の mark の kind= は ' + MARK_KINDS.join(' / ') + ' のどれかです（いまは「' + (out.kind || '') + '」）'
                + '\n    ★ 分子と分子の間を結ぶのは mark: ではなく between: です（DESIGN_figure_marks.md §5）');
        }
        if (!out.at) fail(where, ':::figure の mark に at=（どこに付けるか）がありません'
            + '\n    ★ 化学の言葉で指します（at=不斉炭素 / at=グリコシド結合 / at=カルボキシ基）。位置番号（at=C1-OH / at=環C2）は補助です');
        // ⚠ at=環の水素の種類 は当たりごとに文字（a・b・c）を作図器が付けるので、label= は要らない（2026-09-24）
        if (out.kind === '文字' && !out.label && !/(^|:)環の水素の種類$/.test(String(out.at || '').trim())) {
            fail(where, ':::figure の mark に kind=文字 と書いたら label=（置く文字）が要ります');
        }
        /* ★ 段2: `破線`・`矢印` は2か所を結ぶので `to=` が要る（設計 §6）。⚠ 他の印に `to=` は書けない（黙って捨てない） */
        if (MARK_LINK_KINDS.indexOf(out.kind) >= 0 && !out.to) {
            fail(where, ':::figure の mark に kind=' + out.kind + ' と書いたら to=（もう一方の端）が要ります'
                + '\n    ★ 例: mark: kind=破線 at=フェノール性ヒドロキシ基 to=ニトロ基');
        }
        if (MARK_LINK_KINDS.indexOf(out.kind) < 0 && out.to !== undefined) {
            fail(where, ':::figure の mark の to= は kind=' + MARK_LINK_KINDS.join(' / ') + ' にだけ書けます（いまは kind=' + out.kind + '）');
        }
        /* ★ 分子を複数並べた図では `at=2:ニトロ基` のように何番目かを付ける（数え合わせは checkBlock が gen: の数と突き合わせる）。
           ⚠ 印は**1つの分子の中**のものなので、`at=` と `to=` は同じ分子でなければならない */
        var a = splitFigureRef(out.at, 'mark の at=', where);
        if (a.place === null) fail(where, ':::figure の mark の at=「' + out.at + '」に場所がありません（「' + a.n + ':カルボキシ基」のように書きます）');
        out.part = a.n;
        if (out.to !== undefined) {
            var t = splitFigureRef(out.to, 'mark の to=', where);
            if (t.place === null) fail(where, ':::figure の mark の to=「' + out.to + '」に場所がありません');
            if (t.n !== a.n) {
                fail(where, ':::figure の mark の at=「' + out.at + '」と to=「' + out.to + '」が別の分子を指しています'
                    + '\n    ★ 分子と分子の間を結ぶのは between: です（mark: は1つの分子の中の印）');
            }
        }
        if (out.count !== undefined && !/^\d{1,3}$/.test(out.count)) {
            fail(where, ':::figure の mark の count= は個数（整数）です（いまは「' + out.count + '」）');
        }
        checkColor(out, 'mark', where);
        return out;
    }

    /* ★★ 分子と分子の間を結ぶもの（`:::figure` の `between:`・DESIGN_figure_marks.md §5・段2）。
         gen: name=ベンゼン plain kekule=1
         gen: name=ベンゼン plain kekule=2
         between: kind=両矢印 label=実際はこの中間
       ⚠ **1行に1つ・何本でも書ける**（`mark:` と同じ `multi` のキー）。★ 描くのは**アプリの SVG**
         （`assembler/quiz.js` の `composeFigureRow`）で、この道具は読んで渡すだけ。
       ★ `at=` / `to=` は **何番目の分子か**（`1`・`2`）か、**その分子のどこか**（`1:フェノール性ヒドロキシ基`）。
         場所の指し方は `mark:` と同じ（化学の言葉が主・位置番号が補助）。
         ・分子だけ（`at=1 to=2`）… 2つの分子の**間のすき間**に矢印・破線を引く（共鳴・反応の矢印）
         ・場所まで（`at=1:… to=2:…`）… その2か所を結ぶ（2分子の水素結合）
       ⚠ `kind=矢印`・`破線` は `to=` が要る（向き・もう一方の端）。`両矢印` は向きが無いので、
         **分子が2つだけなら** `at=` / `to=` を省ける（1 と 2 の間）。 */
    var BETWEEN_KEYS = ['kind', 'at', 'to', 'label', 'color'];
    var BETWEEN_KINDS = ['両矢印', '矢印', '破線'];
    function parseBetween(text, where) {
        var out = cutKeyVals(text, BETWEEN_KEYS, 'between', where);
        if (BETWEEN_KINDS.indexOf(out.kind) < 0) {
            fail(where, ':::figure の between の kind= は ' + BETWEEN_KINDS.join(' / ') + ' のどれかです（いまは「' + (out.kind || '') + '」）');
        }
        if (out.kind !== '両矢印' && !out.to) {
            fail(where, ':::figure の between に kind=' + out.kind + ' と書いたら to=（' + (out.kind === '矢印' ? '矢印の向かう先' : 'もう一方の端')
                + '）が要ります\n    ★ 例: between: kind=' + out.kind + ' at=1 to=2（分子の間）／at=1:ニトロ基 to=2:フェノール性ヒドロキシ基（その2か所）');
        }
        if (!!out.at !== !!out.to) {
            fail(where, ':::figure の between の at= と to= は組で書きます（いまは ' + (out.at ? 'at=' : 'to=') + ' だけ）');
        }
        if (out.at) {
            var a = splitFigureRef(out.at, 'between の at=', where), t = splitFigureRef(out.to, 'between の to=', where);
            if (a.n === null || t.n === null) {
                fail(where, ':::figure の between の at= / to= には何番目の分子かを書きます（at=1 to=2 / at=1:ニトロ基 to=2:ヒドロキシ基。いまは at=' + out.at + ' to=' + out.to + '）');
            }
            if ((a.place === null) !== (t.place === null)) {
                fail(where, ':::figure の between の at= と to= は「分子だけ」か「場所まで」かをそろえます（いまは at=' + out.at + ' to=' + out.to + '）');
            }
            if (a.n === t.n) {
                fail(where, ':::figure の between の at= と to= が同じ分子（' + a.n + '）です'
                    + '\n    ★ 1つの分子の中の2か所を結ぶなら mark: kind=' + (out.kind === '両矢印' ? '矢印' : out.kind) + ' at=… to=… です');
            }
            out.from = a; out.dest = t;
        } else {
            out.from = null; out.dest = null;
        }
        checkColor(out, 'between', where);
        return out;
    }

    /* ★★ グループ台帳（`qa/GROUPS.tsv`・設計書 §31-5・ref-inorg-design §1-3 の案C）。
       ⚠ **置き場所は qa**（コードの持ち主は qa）。ここは読み方だけを持つ（node とブラウザで1本）。
       1行 ＝ `domain.unit ␉ unitLabel ␉ group ␉ ページid ␉ 並び ␉ 課程`。`#` の行と空行は読み飛ばす。
       ★ 6列目 `課程`（2026-09-19 理論の便0・ref-theory-design §1-4）は `basic`（化学基礎）／`adv`（化学）。
         ratio の portal.js の course と同じ綴り。⚠ 5列の行（課程を書いていない）と空欄は「未設定」として通す。 */
    var COURSES = ['basic', 'adv'];
    function parseGroups(text) {
        var rows = [];
        normalize(text).split('\n').forEach(function (line, i) {
            if (!line.trim() || /^\s*#/.test(line)) return;
            var c = line.split('\t');
            var where = 'qa/GROUPS.tsv:' + (i + 1);
            if (c.length !== 5 && c.length !== 6) fail(where, '列が ' + c.length + ' 個です（unit ␉ unitLabel ␉ group ␉ ページid ␉ 並び ␉ 課程 の5列か6列。区切りはタブ）');
            var r = { unit: c[0].trim(), unitLabel: c[1].trim(), group: c[2].trim(), page: c[3].trim(), order: c[4].trim(), course: c.length === 6 ? c[5].trim() : '' };
            if (r.course && COURSES.indexOf(r.course) < 0) fail(where, '課程は ' + COURSES.join(' / ') + ' のどれかです（空欄は未設定。いまは「' + r.course + '」）');
            if (!/^(inorg|theo|calc|org)\.[a-z0-9-]+$/.test(r.unit)) fail(where, 'unit は「domain.unit」の形です（いまは「' + r.unit + '」）');
            if (!/^[a-z0-9][a-z0-9-]*$/.test(r.page)) fail(where, 'ページid は英小文字・数字・ハイフンです（いまは「' + r.page + '」）');
            if (!/^\d{2,3}$/.test(r.order)) fail(where, '並びは2〜3桁の数です（いまは「' + r.order + '」）');
            if (!r.unitLabel || !r.group) fail(where, 'unitLabel と group は空にできません');
            rows.push(r);
        });
        var seen = {};
        rows.forEach(function (r) {
            ['page', 'group', 'order'].forEach(function (k) {
                var key = k + ':' + (k === 'group' ? r.unit + '/' : '') + r[k];
                if (seen[key]) fail('qa/GROUPS.tsv', '「' + r[k] + '」が2回あります（' + k + ' は1行に1つ・1グループ＝1ページ）');
                seen[key] = true;
            });
        });
        return rows;
    }

    /* ★★ 目次（`reference-src/TOC.txt`・2026-09-23）—— 教科書の章立てで 科目 → 編 → 節 → ページ。
       1行 ＝ `科目 ␉ 編 ␉ 節 ␉ ページ（空白区切り）`。ページの頭の `+` は再掲（本体は別の節）。
       ⚠ 読むだけ。「本体がちょうど1回」「ORDER.txt と同じ順」は gen-reference.mjs が見る
         （ディレクトリを読めるのはあちらだけ）。ブラウザ（assembler の検査）でも同じ関数で読む */
    var COURSE_LABELS = { basic: '化学基礎', adv: '化学' };
    function parseToc(text) {
        var rows = [];
        normalize(text).split('\n').forEach(function (line, i) {
            if (!line.trim() || /^\s*#/.test(line)) return;
            var c = line.split('\t');
            var where = 'reference-src/TOC.txt:' + (i + 1);
            if (c.length !== 4) fail(where, '列が ' + c.length + ' 個です（科目 ␉ 編 ␉ 節 ␉ ページ の4列。区切りはタブ）');
            var r = { course: c[0].trim(), part: c[1].trim(), section: c[2].trim(), pages: [] };
            if (!COURSE_LABELS[r.course]) fail(where, '科目は basic（化学基礎）か adv（化学）です（いまは「' + r.course + '」）');
            if (!r.part || !r.section) fail(where, '編と節は空にできません');
            c[3].trim().split(/\s+/).forEach(function (tok) {
                var ref = tok.charAt(0) === '+';
                var id = ref ? tok.slice(1) : tok;
                if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(where, 'ページid は英小文字・数字・ハイフンです（いまは「' + tok + '」）');
                r.pages.push({ id: id, ref: ref });
            });
            rows.push(r);
        });
        if (!rows.length) fail('reference-src/TOC.txt', '目次が空です');
        return rows;
    }
    /* 本体（`+` の付かないページ）を上から読んだ順 ＝ ORDER.txt と同じでなければならない順 */
    function tocOrder(rows) {
        var out = [];
        rows.forEach(function (r) { r.pages.forEach(function (p) { if (!p.ref) out.push(p.id); }); });
        return out;
    }
    /* ページ id → 本体のある行（科目・編・節）。パンくずと面Aのページの見出しに使う */
    function tocHome(rows) {
        var m = {};
        rows.forEach(function (r) { r.pages.forEach(function (p) { if (!p.ref) m[p.id] = r; }); });
        return m;
    }
    var BLOCK_SPECS = {
        /* 節の見出し。`anchor` が `id="ref-sec-<anchor>"` になり、目次と用語の索引の行き先になる。
           ⚠ `lead`（この節で分かること）は**必須** —— 検索から着地した人が最初に読む1行なので、
              「見出しだけ在って何の節か分からない」を作らない（設計書 §19-1） */
        /* ★ `course: adv`（v1622・2026-09-23 ユーザー「化学」の札を新設）＝ **化学（科目）の範囲**の節。化学基礎だけの人は読み飛ばせる。
           ⚠ `advanced`（高校の範囲の外）とは別の印。⛔ 混ぜない（化学の範囲は高校の範囲の中） */
        section: { order: ['anchor', 'title', 'advanced', 'course', 'lead', 'terms'], req: ['anchor', 'title', 'lead'], list: ['terms'], prose: ['lead'], bool: ['advanced'], enum: { course: ['adv'] } },
        /* ★ 節の下の小見出し（§20-5）。**本文では `## タイトル` と書ける**（`:::heading` と同じもの）。
           ⚠ **アンカーは持たない** —— 綴りは `#ref-sec-<anchor>` の1つだけ、という §19-2 の決めを
              増やさないため。★ だから**目次（`renderToc`）にも出さない**（目次の行き先は節だけ）。 */
        heading: { order: ['title', 'advanced', 'course'], req: ['title'], list: [], prose: ['title'], bool: ['advanced'], enum: { course: ['adv'] } },
        /* 箇条書き。`ordered: true` で番号つき（素材の「手順 S1〜Sn」用） */
        list: { order: ['ordered', 'items'], req: ['items'], list: ['items'], listOnly: ['items'], prose: ['items'], bool: ['ordered'], hang: ['items'] },
        /* 図。⚠ `src` は **`reference-img/` の中のファイル名だけ**（パスも .. も書けない）。
           `/reference-img/` を付けるのは learn.js の1か所（面A・面Bで同じ URL になる）。
           ★★ `gen` は **その図をアプリの描画で焼くための指定**（`tools/gen-figure.mjs`）。
              ⚠ 任意 —— スライドから切った図には無い。★ 書いてあれば「この図は何の分子か」を
                原稿が名乗っていることになり、焼くたびに `iupacName` で突き合わせられる
                ＝ `:::table` の `source`（行がどこから来たか）と同じ役目。 */
        /* ★★ `shot` は **アプリの画面を切り取って焼くための指定**（`tools/gen-app-figure.mjs`・§31-4）。
           ⚠ `raw` ＝ 記法も「使えない文字」の検査も通さない（URL の `&`・セレクタの `>` を書くため）。
             ★ 画面には出さない欄なので、素通ししても本文に生の記号は出ない。 */
        /* ★★ `svg:` （2026-09-21）—— **図の正を文字（SVG のソース）で持つ**。
           ★ なぜ: スライドに無い図（装置の絵・模式図・グラフ）が 30枚 ほど残るが、作図器は分子しか描けない。
             画像を直接置くと**差分が読めず、直しもできない**。SVG なら文字なので、
             レーンも描けるし、後から 1 行直せる。**PNG は生成物**（`tools/gen-svg-figure.mjs`）。
           ⚠ `svg:` は `reference-svg/` の中の**ファイル名だけ**。`src` はその名の `.png`。 */
        /* ★★ `mark:` は**図に重ねる印**（DESIGN_figure_marks.md・段1）。⚠ `multi` ＝ **同じキーを何行でも書ける**
           （印は1枚の図に何本でも付く）。`raw` ＝ 記法を通さない（`at=` の綴りをそのまま作図器へ渡す）。
           ⚠ `mark:` は `gen:` と組でしか書けない（印だけの図はありえない・下の checkBlock）。 */
        /* ★★ 段2（DESIGN_figure_marks.md §5）: **`gen:` も何行でも**（1行 ＝ 1分子・横一列）・分子の間を結ぶ `between:`。
           ⚠ `gen:` は**1行なら今までどおり文字列**（`oneScalar`）＝ 既存の図の reference.json は1文字も変わらない。
             2行以上のときだけ並びになる */
        /* ★★ 出典の4欄（2026-09-24・ユーザー「出典表示つきで置いてください」）。**他人の写真**（Wikimedia Commons の
           CC BY-SA など）を置くときだけ書く。`credit`（撮影者・入手元）・`creditUrl`（元のページ）・`license`（名前）・
           `licenseUrl`（ライセンスの本文）。⚠ 4つそろえて書く（1つでも欠けると表示の条件を満たさない）。
           ★ 図の下に「写真: <credit> ／ <license>」をリンクつきで出す（learn.js の renderFigure ＝ 面A・面B 共通）。
           ⚠ URL は `raw`（記法も文字の検査も通さない）。画面には textContent と href でしか出さない */
        figure: { order: ['src', 'gen', 'shot', 'svg', 'mark', 'between', 'alt', 'caption', 'credit', 'creditUrl', 'license', 'licenseUrl'], req: ['src', 'alt', 'caption'], list: [], multi: ['gen', 'mark', 'between'], oneScalar: ['gen'], prose: ['caption'], raw: ['shot', 'mark', 'between', 'creditUrl', 'licenseUrl'] },
        /* ★★ 化学反応式。**文字だけで組む**（画像に頼らない・設計書 §19-5）。
           `over` / `under` は矢印の上下に出る条件（試薬・温度・触媒）。
           ★ `arrow` は矢印そのもの（§31-2）。**書かなければ →**（有機46枚は1文字も変わらない） */
        reaction: { order: ['left', 'over', 'under', 'arrow', 'right', 'level', 'note'], req: ['left', 'right', 'level'], list: [], prose: ['note'], enum: { level: LEVELS, arrow: ARROWS } },
        /* ★★ 手で書く表（機械が行を作れないもの）。セルは ` | ` で切る。
           ⚠⚠ **`source` は必須。** `REF5` は「行データの欄（`rows` ほか）を持たない」を
              **著作権の守り**として掛けている（手打ちの表が構造上存在できなければ転写事故は起きない）。
           ★ ここだけ穴を開けるので、**代わりに「その行がどこから来たか」を書かせる** ——
             書けないなら、それはどこかから持ってきている（前書きの `why` と同じ考え・§1-2）。 */
        /* ★ `align` は**列ごとの寄せ**（§20-9）。⚠ セルと同じ ` | ` で区切って**1行**で書く
           ＝ head と縦に見比べられる。書かなければ今までどおりの見え方（既定を .md 側に写さない）。 */
        table: { order: ['caption', 'source', 'head', 'align', 'rows'], req: ['source', 'head', 'rows'], list: ['head', 'rows'], listOnly: ['head', 'rows'], prose: ['caption', 'head', 'rows'] },
        /* 注意の囲み。⚠ `tone` は3つだけ（勘違いしやすい／丸暗記でよい／覚えなくてよい） */
        callout: { order: ['tone', 'text'], req: ['tone', 'text'], list: [], prose: ['text'], enum: { tone: TONES } },
        /* ★★ よくある誤解（2026-09-12・ユーザー承認）。発端はユーザーの申し立て
           「common mistakes のようなコーナーがあってもよいかもしれません／
             あとで抽出して一覧にすると価値があると思います」。

           ⚠⚠ **`advanced: true`（発展の印）と役が違う。⛔ 混ぜない。**
             発展 ＝ **範囲の外**（高校の教科書の本文に無い）。
             誤解 ＝ **範囲の内で、多くの人が間違える**。★ だから誤解の囲みは畳まない
             （畳むと、いちばん読ませたい人が開かない）。

           ⚠⚠ **`:::callout` の `tone: caution`（⚠ 勘違いしやすい）とも役が違う。**
             あちらは**注意を1つ言う**器で、文が1本しかない ＝ **何が正しいかしか書けない。**
             ★ こちらは **誤り と 正しい形を並べて置く**器で、欄が2つあることが本体
             （`wrong` を書かずに済ませられない ＝ **誤解のほうを言葉にさせる**）。

           ★ 欄は3つ:
             `wrong` … ⚠ **よくある誤り**（生徒が実際にそう思っている文をそのまま書く）
             `right` … ★ **正しい形**
             `why`   … ⓵ なぜそう間違えるか／どう見分けるか（任意）
           ⚠⚠ **画面では `wrong` を本文と同じ字で出さない**（`learn.js` の `renderMistake`）——
             ✗ の札と、沈めた色と、取り消し線で「これは誤り」が一瞬で分かること。
             ★ **それがこの囲みを作る理由そのもの**（同じ字で並べると、どちらが正か読まないと分からない）。

           ★★ **出どころ（どのページのどこか）は原稿に書かせない。**
             ⚠ ページ id はファイル名、場所は直前の見出し（`:::section` の `anchor`、
               節を持たない短いページなら `## …` の題）＝ **もう分かっている。**
             書かせると同じことを2か所に持つことになり、節を動かしたときに黙って古くなる。
             ★ 代わりに `gen-reference.mjs` が「`:::mistake` は見出しの下にあること」を見て、
               走るたびに **ページ／見出しつきの一覧**を出す（＝ 抽出できる形であることが毎回確かめられる）。 */
        mistake: { order: ['wrong', 'right', 'why'], req: ['wrong', 'right'], list: [], prose: ['wrong', 'right', 'why'] },

        /* ★★ ページどうし・ページからアプリへのリンク（設計書 §20-7）。
           ⚠⚠ **行き先が「まだ無いページ」でもよい**のがこの器の急所 ——
              52ページの計画のうち書けているのは6枚で、本文はもう書けていないページを名指ししたがる。
           ★ 書けるのは2通りで、**どちらか片方だけ**（`checkBlock` が見る）:
             `to:`   … 参考書のページ id。**実在すればリンク、まだ無ければ「準備中」**
                       （⚠ 決めるのは `learn.js` が持っているページ一覧 ＝ ページを書いた日に
                         黙って生きる。`.md` 側に「準備中」と書かせない）
             `open:` … アプリの行き先。⚠⚠ **新しい URL の形を発明しない** ——
                       値は `game.js` の `OPEN_TARGETS` の名前そのもの（`REF21` が突き合わせる）。
                       `formula:` は受け口② `?open=isomer&formula=` のためだけの添えもの。
             ★★ `cls:` … **分子式だけでなく「分類」でも絞る回**へ飛ばすための添えもの（§25）。
                       ⚠⚠ **式を変えても届かない回がある**から要る —— 実測で
                       **C₄H₈O₂ の構造異性体は122種**（C₃H₆O₂ でも34種）で、
                       書き出し練習の上限20種を超えるので `formula:` だけでは画面が断る。
                       ★ アプリにはもともと「分子式と分類で絞る回」が15件あり、
                       その中に **C₄H₈O₂（エステル）4種**が居る ＝ **行き先はもう在った。**
                       ⚠ 綴りは **`learn.js` の `fgPresets[].cls` そのもの**（ketone / aldehyde /
                       ester / acid）。名前を2つにしないため、原稿も URL も同じ `cls` を使う。
           ⚠ **行き先が実在するかはここでは見ない**（このファイルは node とブラウザで共有していて、
              ディレクトリも `game.js` も読めない）。★ 見るのは `gen-reference.mjs` と `REF21`。 */
        /* ★★ `app:` … **ほかのアプリの受け口**へ（§31-3・2026-09-19 便0a）。値は上の `APP_TARGETS` の名前だけ。
                       `id:` はその受け口に渡す1つの値（`rxn=` `s=` `q=` `sp=` `r=` `deck=` や `#` の後ろ）。
           ⚠ `href` は**書く欄ではない**（`soon` と同じく読むときに焼き込む。原稿に書いたら「知らないキー」）。 */
        /* ★★ `embed: true` … **そのページの中で開く**（iframe・DESIGN_reference_centric.md §2-4・段1）。
                       押すまで iframe を作らないのは面Aの生成器の仕事で、ここは「埋めてよい相手か」だけを見る。
           ⚠ 付けてよいのは `app:` の行き先が `embeddable` の受け口のときだけ（それ以外は赤）。
           ⚠ `embedHref` も**書く欄ではない**（`href` と同じく読むときに焼き込む）。 */
        link: { order: ['to', 'open', 'formula', 'cls', 'app', 'id', 'embed', 'text'], req: ['text'], list: [], prose: ['text'], bool: ['embed'] },

        stageTable: { order: ['variant', 'series', 'source', 'caption'], req: ['series', 'source', 'caption'], list: ['series'], prose: ['caption'] },
        mechanismTable: { order: ['source', 'caption'], req: ['source', 'caption'], list: [], prose: ['caption'] },
        dehydrationTable: { order: ['source', 'caption'], req: ['source', 'caption'], list: [], prose: ['caption'] },
        example: { order: ['stageId', 'lead', 'note'], req: ['stageId', 'lead', 'note'], list: [], prose: ['lead', 'note'] },

        /* ★★ 例題 —— **読者が自分で解く**もの（2026-09-10・設計書 §22）。発端はユーザーの申し立て
           「例題も用意する必要があります／qa とは別に例題を用意したい／スライドの練習問題などが使えます」。

           ⚠⚠ **`:::example` と役が違う。** あちらは「▶ 組んでみる」＝ **既存のパズルのお題を開く器**で、
              採点も正誤もクリアの記録も `stages.json` の `target` 照合が受け持つ（learn.js の `renderExample`）。
              ★ こちらは **紙に書いて、あとから解答を開いて見比べる** ＝ 判定を1つも持たない。
           ★ **綴りを `exercise` にした理由**（設計書 §22-2）:
             ① `example` とキーが1つも重ならない（あちら stageId / lead / note）＝
                取り違えたら「知らないキー」でその場で赤くなり、下の CONFUSABLE が相手の名前まで言う。
             ② `practice` は §19-11 が「**有料の練習問題の層**」に予約している名前なので使わない
                （こちらは参考書の中＝無料の層）。

           ⚠⚠ **`source` は必須。** `:::table` に穴を開けたときと同じ理由 ——
              `REF5` の守りの本体は「行を手で書くな」ではなく「**出どころの言えない行を書くな**」（§19-10）。
           ⚠ **`source` は画面に出さない**（`:::table` の `source` と同じ。画面に出典を書かない・
              REFBOOK_STYLE §2-6）。★ 原稿の中の欄。

           ★ 図は問い側（`promptSrc`）と解答側（`answerSrc`）の両方に置ける ——
             「構造式を書け」は解答が図、「命名せよ」は問いが図で、**素材に両方がある**。 */
        exercise: {
            order: ['source', 'prompt', 'promptSrc', 'promptAlt', 'answer', 'answerSrc', 'answerAlt'],
            req: ['source', 'prompt', 'answer'], list: [], prose: ['prompt', 'answer']
        }
    };
    var KINDS = Object.keys(BLOCK_SPECS);

    /* ★ 取り違えやすい組。⚠ **綴りが似ている**（`:::example` ／ `:::exercise`）ので、
       **相手のキーを書いたら、その場で相手の名前と役を言う** —— 黙って片方に寄せない。 */
    var CONFUSABLE = {
        example: { pair: 'exercise', role: '読者が自分で解く例題（解答は開いて見る）' },
        exercise: { pair: 'example', role: 'パズルのお題を開いて「▶ 組んでみる」例題' }
    };

    /* 相手のキーを書いていたら、**相手の名前と役まで**言う一文（そうでなければ空）。
       ⚠⚠ **知らないキーで止まる場所は2つある**（行を読む `kvLineFail` と、読み終えたあとの照合）。
         ★ 実測: `stageId` を `:::exercise` に書くと**先に `kvLineFail` が止める**ので、
           照合の側にだけ添えていたこの一文は**一度も出ていなかった**（REF23 の否定対照で判明）。
         ⚠ だから**一文は1か所で作り、両方から呼ぶ。** */
    function confusableHint(kind, key) {
        var c = kind && CONFUSABLE[kind];
        if (!c || BLOCK_SPECS[c.pair].order.indexOf(key) < 0) return '';
        return '\n    ★ 「' + key + '」は :::' + c.pair + ' のキーです（' + CONFUSABLE[c.pair].role + '）。'
            + 'この囲みを :::' + c.pair + ' に書き替えるか、'
            + 'キーを ' + BLOCK_SPECS[kind].order.join(' / ') + ' から選んでください';
    }

    /* 図のファイル名。⚠ **名前だけ**（`/` も `..` も許さない）。置き場所を .md 側から動かせない形にする */
    var FIGURE_SRC_RE = /^[a-z0-9][a-z0-9-]*\.png$/;
    /* 出典つきの写真（他人の写真を加工せずに置く）だけ .jpg を許す（2026-09-24） */
    var FIGURE_PHOTO_RE = /^[a-z0-9][a-z0-9-]*\.jpg$/;
    /* 出典の license に書ける名前（綴りを1つに決める） */
    var FIGURE_LICENSES = ['CC BY-SA 3.0', 'CC BY-SA 4.0', 'CC BY 3.0', 'CC BY 4.0', 'CC0', 'パブリックドメイン'];
    /* 図のソース（SVG）のファイル名。置き場所は `reference-svg/` 固定（src と同じ理由） */
    var FIGURE_SVG_RE = /^[a-z0-9][a-z0-9-]*\.svg$/;
    /* 節のアンカー。⚠ URL の `#` の後ろに出るので、英小文字・数字・ハイフンだけ */
    var ANCHOR_RE = /^[a-z0-9][a-z0-9-]*$/;
    /* 手で書く表のセルの区切り */
    var CELL_SEP = '|';

    /* 前書きのうち「読者に見える文字列」ではないもの ＝ 記法を通さず、素のままであること
       （`unitLabel` / `group` / `title` は `textContent` と `escapeRefText` で出るので、
         ここにタグを書くとタグが**そのまま画面に出る**。だから素であることを機械で見る） */
    var PAGE_PLAIN_KEYS = ['id', 'unit', 'unitLabel', 'group', 'title', 'summary', 'video', 'why'];

    /* ⚠ **エスケープ記法は用意していない**（§16-2(2)）。
       本文に出せない ASCII はこの5文字だけで、全角の `＊` と波ダッシュ `〜`（U+301C）は今までどおり使える。
       要るようになったら **まず設計書に書いてから** ここを足す。 */
    var FORBIDDEN = /[<>&*~]/;

    /* ===== 小道具 ============================================================= */

    /* ★★ いま在るページの id の一覧（`parsePage` の `opts.pages`）。設計書 §20-7。
     *
     * ⚠⚠ **なぜ「描くとき」ではなく「読むとき」に決めるのか。**
     *   ★ 面Aの生成器は `ReferenceBook` を**ページを読み込まずに**使って焼く
     *     （`renderBlock` を呼ぶだけで `load()` は通らない）ので、**描く側は
     *     「そのページが在るか」を知らない** —— 実測で、在るページ宛のリンクが
     *     焼いたものだけ「準備中」になった（`REF18` が捕まえた）。
     *   ★★ だから **`soon`（まだ無い）を生成物に焼き込み**、`renderBlock` は
     *     ブロックだけを見て描ける純粋な関数に保つ。
     * ⚠ 一覧を渡さずに `to:` のリンクを読むと**その場で赤**（黙って全部「準備中」にしない）。 */
    var CTX = null;
    var CTX_PAGE = null;

    function fail(where, msg) { throw new Error(where + ': ' + msg); }

    /* 本文の記法 → HTML。**変換したあとに `* ~ < > &` が残っていたら赤**
       ＝ `**` の閉じ忘れも、うっかりの生 HTML も、ここで止まる。 */
    function inline(s, where) {
        var h = String(s)
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
            .replace(/~([^~]+)~/g, '<sub>$1</sub>')
            /* ★★ 穴あきテンプレートの `○○`（設計書 §23-2・REFBOOK_STYLE §11）。
               ⚠⚠ **新しい記法を作っていない** —— ユーザーが②稿で自分から6回書いた形
                 （「主鎖の炭素数が4なら『○○ブタン』」）を、**そのまま器にした**。
               ★ 覚えることが増えず、原稿の見た目も変わらない（§20 の思想）。
               ⚠ **文字は残す**（下線だけの空欄にしない）—— 「まるまるブタン」と声に出せること、
                 検索に「○○ブタン」でかかること、字数を暗示しないこと、の3つが理由（§23-2）。 */
            .replace(/○{2,}/g, function (m) { return '<span class="' + BLANK_CLASS + '">' + m + '</span>'; });
        var bare = h.replace(/<\/?b>/g, '').replace(/<\/?sub>/g, '')
            .replace(new RegExp('<span class="' + BLANK_CLASS + '">|<\\/span>', 'g'), '');
        if (FORBIDDEN.test(bare)) {
            fail(where, '本文に使えない文字が残っています「' + bare.match(FORBIDDEN)[0] + '」'
                + '（強調は ** で挟む・下付きは ~ で挟む。生の HTML と、素の * ~ < > & は書けません）'
                + '\n    → ' + String(s).slice(0, 60));
        }
        return h;
    }

    /* 記法を通さない欄。素であることだけ見る */
    function plain(s, where) {
        if (FORBIDDEN.test(s)) {
            fail(where, '使えない文字「' + s.match(FORBIDDEN)[0] + '」があります（この欄に記法は書けません）'
                + '\n    → ' + String(s).slice(0, 60));
        }
        return s;
    }

    /* ★★ 1行に詰めて書かれたキーを切り分ける（§20-3）。
     *
     * ⚠ **切れ目にしてよいのは「その囲みで書けるキー」＋「まだ出ていない」ものだけ。**
     *   ★ 知らない語（`slides:` `s4:`）も、2回目の語も、**値の一部として素通しする** ——
     *     そうしないと `title: 反応の見分けかた: 3つの型` のような値で切れてしまう。
     * ⚠ キーと認めるのは `キー:` の直後が **空白か行末**のときだけ（`stages:アルカン` は切らない）。
     *
     * 返り値 `{ lead, parts }` … `lead` は最初のキーより前にある文字（ふつうは空）。
     */
    function splitPacked(text, allowed, used, multi) {
        var re = /(^|\s)([A-Za-z][A-Za-z0-9]*):(?=\s|$)/g;
        var cuts = [], m;
        while ((m = re.exec(text))) {
            var key = m[2];
            /* ★ `multi` のキー（`:::figure` の `mark`）だけは2回目以降も切れ目にする ＝ 何行でも書ける */
            if (allowed.indexOf(key) < 0 || (used[key] && (multi || []).indexOf(key) < 0)) continue;
            used[key] = true;
            var at = m.index + m[1].length;
            cuts.push({ key: key, at: at, from: at + key.length + 1 });
        }
        return {
            lead: (cuts.length ? text.slice(0, cuts[0].at) : text).trim(),
            parts: cuts.map(function (c, k) {
                return { key: c.key, value: text.slice(c.from, k + 1 < cuts.length ? cuts[k + 1].at : text.length).trim() };
            })
        };
    }

    /* 「キー: 値」の形でない行を、**直し方まで**言って止める（§20-6） */
    function kvLineFail(where, line, allowed, used, kind) {
        var m = /^\s*([A-Za-z][A-Za-z0-9]*):/.exec(line);
        if (m && used[m[1]]) {
            fail(where, 'キー「' + m[1] + '」が2回出てきます（同じ囲みの中で1回だけ書きます）\n    → ' + line.trim().slice(0, 60));
        }
        if (m) {
            fail(where, '知らないキー「' + m[1] + '」があります（ここに書けるのは ' + allowed.join(' / ') + '）'
                + confusableHint(kind, m[1])
                + '\n    → ' + line.trim().slice(0, 60));
        }
        fail(where, '「キー: 値」の形でない行があります'
            + '\n    → ' + line.trim().slice(0, 60)
            + '\n    ★ 直し方: 行のあたまに「' + allowed[0] + ': 」のようにキーを書きます。'
            + '並びを書くなら次の行から「- 値」を1行ずつ。'
            + '\n      （囲みの外に書きたい文なら、囲み（:::）の前か後ろの空行のあとに置きます）');
    }

    /* 「キー: 値」だけの小さな文法。**前書きと `:::` の中で同じものを使う**（覚えることを1つにする）:
         key: 値
         key: true / false
         key:
         - 値                ← ★ 字下げは要らない（2字下げでもよい）。★ 空行が挟まってもよい
         - 値
       ★ **1行に詰めて書いてもよい**（`anchor: formula title: 一般式`）。切れ目の決め方は splitPacked。 */
    function parseKV(lines, where, allowed, kind, hang, multi) {
        var out = {}, order = [], used = {}, curList = null;
        var isMulti = function (key) { return (multi || []).indexOf(key) >= 0; };
        var put = function (key, val) {
            order.push(key);
            /* ★ 何行でも書けるキー（`mark`）は**書いた順に溜める**。⚠ 1行に1つ（値の無い形は書けない） */
            if (isMulti(key)) {
                if (val === '') {
                    fail(where, '「' + key + ':」の後に値がありません'
                        + '\n    ★ 直し方: 「' + key + ': kind=… at=…」のように1行で書きます（何行でも書けます）');
                }
                if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = [];
                out[key].push(val);
                curList = null;
                return;
            }
            if (val === '') { out[key] = []; curList = key; }
            else { out[key] = val; curList = null; }
        };
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.trim() === '') continue;               // ★ 空行は読み飛ばす（並びの前後に入ってよい）
            var im = /^\s*-\s+(\S[\s\S]*)$/.exec(line);
            var seg;
            if (im) {
                if (!curList) {
                    fail(where, '「- 」で始まる行の前に、それが何の並びかを言うキーがありません'
                        + '\n    → ' + line.trim().slice(0, 60)
                        + '\n    ★ 直し方: 並びの前の行に「' + allowed[0] + ':」のようにキーだけを書きます');
                }
                seg = splitPacked(im[1], allowed, used, multi);
                if (seg.lead) out[curList].push(seg.lead);
                else if (!seg.parts.length) fail(where, '「- 」だけの行があります');
            } else if (curList && (hang || []).indexOf(curList) >= 0
                && /^[ \t　]/.test(line) && out[curList].length) {
                /* ★★ ぶら下げの補足（設計書 §23-3・REFBOOK_STYLE §2-3）。
                   ⚠⚠ **ユーザーは全角スペースで字下げして書く** —— ②稿の命名の手順が実際にそうで、
                     その行は「1つ前の段の下にぶら下がる補足」だった（穴あきテンプレートの置き場所）。
                   ★ **記法を増やさず、字下げをそのまま受ける。** 印は行頭の全角スペース1つに正規化して
                     持ち回り、描くときに**1つ前の項目の中**へ入れる（番号は増えない）。
                   ⚠ 受けるのは `hang` に挙げた並びだけ（`terms` や `rows` の字下げは今までどおり赤）。 */
                out[curList].push(HANG_MARK + line.trim());
                continue;
            } else {
                seg = splitPacked(line.trim(), allowed, used, multi);
                if (!seg.parts.length || seg.lead) kvLineFail(where, line, allowed, used, kind);
            }
            seg.parts.forEach(function (p) { put(p.key, p.value); });
        }
        order.forEach(function (k) {
            if (Array.isArray(out[k]) && !out[k].length) {
                fail(where, '「' + k + ':」の後に値がありません'
                    + '\n    ★ 直し方: 1行の値なら「' + k + ': ここに値」、'
                    + '並びなら次の行から「- 値」を1行ずつ書きます');
            }
        });
        return { map: out, order: order };
    }

    /* ===== ページ1枚を読む ===================================================== */

    /**
     * `reference-src/<id>.md` の中身 → ページのオブジェクト（キーの並びは PAGE_KEYS のとおり）。
     * @param {string} text  ファイルの中身（改行は CRLF / LF どちらでもよい）
     * @param {string} where エラーに出す名前（ふつうはファイル名）
     */
    function parsePage(text, where, opts) {
        where = where || '(reference-src)';
        CTX = (opts && opts.pages) ? opts.pages.slice() : null;
        var raw = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
        /* ★★ 著者メモ（`//` から行末まで）を先に抜く。⚠ **画面には出さないが、捨てもしない** ——
           `page.memos` に行番号ごと残し、生成器が「まだ片付いていないメモが N 件」と数えて出す（§20-2）。
           ⚠ `serialize` は PAGE_KEYS しか書かないので、**reference.json には入らない**。 */
        var memos = [];
        /* ⚠ `//` の直前は「行の先頭」か「`:` と `/` 以外の1字」。**句点の直後（`〜です。//メモ`）もメモ**
           （v1546。以前は直前が空白のときだけで、`。//` が本文に素通りしていた）。
           ⚠ `://`（URL）はメモにしない。⓵ 否定の後読み `(?<!…)` を使わないのは、test.html 以外の古いブラウザで
           ファイルごと構文エラーにしないため。直前の1字は m[1] に取り、本文側に残す。 */
        var lines = raw.map(function (line, n) {
            var m = /(^|[^:\/])\/\/(.*)$/.exec(line);
            if (!m) return line;
            var body = m[2].trim();
            if (body) memos.push({ line: n + 1, text: body });
            return line.slice(0, m.index + m[1].length).replace(/\s+$/, '');
        });
        if (lines[0] !== '---') fail(where, '1行目が「---」ではありません（前書きが要ります）');
        var end = -1;
        for (var i = 1; i < lines.length; i++) if (lines[i] === '---') { end = i; break; }
        if (end < 0) fail(where, '前書きの終わりの「---」がありません');

        var fm = parseKV(lines.slice(1, end), where + ' の前書き', PAGE_KEYS).map;
        var page = {};
        PAGE_KEYS.forEach(function (k) {
            if (!Object.prototype.hasOwnProperty.call(fm, k)) {
                /* ★ 任意のキーは**書かなければキーごと出さない**（`null` や空文字を置かない）——
                   面Aは「キーが在るか」だけで枠を出すかを決めるので、
                   空文字が入ると「枠は出すが中身が空」という第3の状態ができてしまう */
                if (PAGE_OPTIONAL_KEYS.indexOf(k) >= 0) return;
                fail(where, '前書きに「' + k + '」がありません');
            }
            var v = fm[k];
            if (PAGE_LIST_KEYS.indexOf(k) >= 0) {
                if (!Array.isArray(v)) fail(where, '前書きの「' + k + '」は「  - 値」の並びで書きます（1件でも）');
                page[k] = v.map(function (s) { return plain(s, where + ' の ' + k); });
            } else if (PAGE_BOOL_KEYS.indexOf(k) >= 0) {
                if (v !== 'true' && v !== 'false') fail(where, '前書きの「' + k + '」は true か false です（いまは「' + v + '」）');
                page[k] = (v === 'true');
            } else {
                if (Array.isArray(v)) fail(where, '前書きの「' + k + '」は1行の値です（「- 」の並びにしない）');
                page[k] = PAGE_PLAIN_KEYS.indexOf(k) >= 0 ? plain(v, where + ' の ' + k) : inline(v, where + ' の ' + k);
            }
        });
        Object.keys(fm).forEach(function (k) {
            if (PAGE_KEYS.indexOf(k) < 0) fail(where, '前書きに知らないキー「' + k + '」があります（書けるのは ' + PAGE_KEYS.join(' / ') + '）');
        });
        if (!/^[a-z0-9][a-z0-9-]*$/.test(page.id)) fail(where, 'id は英小文字・数字・ハイフンで書きます（いまは「' + page.id + '」）');
        /* ★ 区分（§31-1）。⚠ 頭の語が知らないものは赤 —— 黙って有機の索引に混ぜない */
        if (!divisionOf(page.unit)) {
            fail(where, 'unit「' + page.unit + '」の区分が読めません（点の前は '
                + DIVISIONS.map(function (d) { return d.key; }).join(' / ') + ' のどれか。有機は点を付けない素の名前でもよい）');
        }
        if (page.why.length < 20) fail(where, 'why（この表を作った理由）が短すぎます。書けないなら、その表はどこかから持ってきています（設計書 §1-2）');
        /* ★ `summary` は **検索結果に出る文**（`<meta name="description">`・索引のカード・OGP）。
           ⚠ 長さを見るのは体裁のためではない —— 短すぎると何のページか伝わらず、
              長すぎると**途中で切られて意味が変わる**（検索結果は 120 字前後で切られる）。 */
        if (page.summary.length < 30 || page.summary.length > 140) {
            fail(where, 'summary（検索結果に出る1〜2文）は 30〜140 字で書きます（いまは ' + page.summary.length + ' 字）'
                + '\n    → ' + page.summary.slice(0, 60));
        }
        if (Object.prototype.hasOwnProperty.call(page, 'video') && !VIDEO_ID_RE.test(page.video)) {
            fail(where, 'video は YouTube の動画ID を書きます（英数字と - _ だけ。いまは「' + page.video + '」）');
        }

        /* ★ いま読んでいるページの id。`app:` のリンクに戻り道（`&page=`）を焼き込むため（§31-3） */
        CTX_PAGE = page.id;
        page.blocks = parseBody(lines.slice(end + 1), where, end + 1);
        CTX_PAGE = null;
        /* ⚠ **JSON には出さない**（`serialize` は PAGE_KEYS ＋ why ＋ blocks しか書かない）。
           ★ 生成器と `REF20` が「書いたメモが消えていないこと」をここから数える */
        page.memos = memos;
        return page;
    }

    /* 本文 ＝ 空行で区切られたかたまり。かたまりは「1行の段落」か「::: の囲み」のどちらか
     *
     * ★★ **赤に行番号を付ける**（§20-11）。⚠ **`offset` は本文の1行目がファイルの何行目か。**
     *   ⚠⚠ 原稿は 300 行あるので、「どこが悪いか」だけ言われても**探すのはユーザーの仕事**になる。
     *   ★ 著者メモの報告（`reference-src/alkane.md:169`）と**同じ書き方**にそろえた。 */
    function parseBody(lines, where, offset) {
        var blocks = [], chunk = [], at = 0;
        var flush = function () {
            if (!chunk.length) return;
            blocks.push(parseChunk(chunk, where + ':' + ((offset || 0) + at + 1)));
            chunk = [];
        };
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '') { if (chunk.length && !isOpenFence(chunk)) flush(); else if (chunk.length) chunk.push(lines[i]); continue; }
            if (!chunk.length) at = i;
            chunk.push(lines[i]);
        }
        flush();
        if (!blocks.length) fail(where, '本文が空です');
        return blocks;
    }

    /* 囲みの終わりの印。★ **`:::` だけの行**でも、**行末に付いた `:::`** でもよい（§20-3） */
    function fenceCloses(line) { return line.trim() === ':::' || /:::\s*$/.test(line); }

    /* 1行目の `:::種類` を剥がして、囲みの中身の行だけにする。
       ★ 1行目の残りは「中身の1行目」として扱う ＝ **キーを詰めて書いてよい**。 */
    function fenceBody(chunk) {
        return [String(chunk[0]).replace(/^:::([A-Za-z][A-Za-z0-9]*)?[ \t]*/, '')].concat(chunk.slice(1));
    }

    /* `:::` を開いたまま閉じていないかたまりか（囲みの中の空行を段落の切れ目と誤らないため）。
       ⚠ **1行の中で開いて閉じる囲み**（`::: …文… :::`）を「開きっぱなし」と読まないこと ——
          読むと、そこから下の本文がぜんぶ囲みに吸い込まれる。 */
    function isOpenFence(chunk) {
        if (!/^:::/.test(chunk[0])) return false;
        var body = fenceBody(chunk);
        for (var i = 0; i < body.length; i++) if (fenceCloses(body[i])) return false;
        return true;
    }

    function parseChunk(chunk, where) {
        if (/^:::/.test(chunk[0])) return parseFence(chunk, where);
        /* ★ 小見出し（§20-5）。⚠ `#` 1つは書けない —— ページの題は前書きの `title:` が持つ */
        var hm = /^\s*(#+)\s+(\S[\s\S]*)$/.exec(chunk[0]);
        if (hm) {
            if (chunk.length > 1) fail(where, '小見出しは1行で書きます\n    → ' + chunk[0].slice(0, 60));
            if (hm[1] === '#') {
                fail(where, 'ページの題は前書きの「title:」が持つので、本文に「# 」は書けません'
                    + '\n    → ' + chunk[0].slice(0, 60)
                    + '\n    ★ 直し方: 節にするなら :::section、節の下の小見出しなら「## 」を使います');
            }
            var ht = hm[2].trim(), hadv = foldAdvanced(ht);
            if (hadv !== null) ht = hadv;
            var hb = { kind: 'heading', title: inline(ht, where + ' の小見出し') };
            if (hadv !== null) hb.advanced = true;
            return hb;
        }
        if (chunk.length > 1) {
            fail(where, '段落のあいだには空行が要ります（1段落 = 1行。段落の途中で改行しない）'
                + '\n    → ' + chunk[0].slice(0, 40) + ' ／ ' + chunk[1].slice(0, 40));
        }
        var text = inline(chunk[0].trim(), where + ' の段落');
        /* ★★ 見出しのつもりで書いた素の1行を、**黙って段落にしない**（設計書 §20-8）。
         *
         * ⚠⚠ 実際に起きた —— ユーザーが `アルカンの常温での状態` と1行だけ書き、
         *   それが**本文の段落として画面に出た**（赤にならないので気づけない）。
         * ★ 線は**実測で引いた**: 6ページ 45 段落のうち、句点を1つも持たないものは
         *   **その1行だけ**で、次に短い段落は 55 字。⚠ だから 30 字で切っても
         *   ふつうの段落には当たらない（当たったら句点を1つ足せば通る）。
         * ★ ⚠ **拾って勝手に見出しにしない** —— どちらのつもりだったかは書いた人しか知らない。
         *   **読める言葉で断って、直し方を2通り見せる。** */
        var bare = text.replace(/<\/?(b|sub)>/g, '');
        if (bare.length <= 30 && !/[。！？]/.test(bare)) {
            fail(where, '句点で終わらない短い1行があります（見出しのつもりですか？）'
                + '\n    → ' + bare
                + '\n    ★ 直し方は2通り: 見出しにするなら行のあたまに「## 」を付けます。'
                + '\n      本文の段落のつもりなら、文として書いて「。」で終えてください。'
                + '\n      （節の見出しにするなら :::section。そちらは目次に出ます）');
        }
        return { kind: 'text', text: text };
    }

    /* `:::` の囲み1つ。★ 受ける形は3つ:
         :::種類            … 次の行から「キー: 値」、`:::` で閉じる
         :::種類 キー: 値 キー: 値 [:::]   … ★ 1行に詰めて書く（§20-3）
         ::: 囲みたい文 :::  … ★ **型を書かない**（既定の見せ方＝補足の囲み・§20-4）           */
    function parseFence(chunk, where) {
        var kindM = /^:::([A-Za-z][A-Za-z0-9]*)?/.exec(chunk[0]);
        var kind = kindM[1] || null;
        var body = fenceBody(chunk), inner = [], closed = false, i = 0;
        for (; i < body.length; i++) {
            if (body[i].trim() === ':::') { i++; closed = true; break; }
            if (/:::\s*$/.test(body[i])) { inner.push(body[i].replace(/:::\s*$/, '')); i++; closed = true; break; }
            inner.push(body[i]);
        }
        if (!closed) {
            fail(where, ':::' + (kind || '') + ' の囲みが「:::」で閉じていません'
                + '\n    ★ 直し方: 囲みの終わりに「:::」だけの行を置くか、同じ行の末尾に「:::」を書きます');
        }
        for (; i < body.length; i++) {
            if (body[i].trim() !== '') fail(where, '囲みの後には空行が要ります\n    → ' + body[i].slice(0, 60));
        }
        if (kind) return buildBlock(kind, inner, where);

        /* ★ 型の無い囲み。**中身は自由文**（「ちょっと囲みたい」だけ、を受ける） */
        var txt = inner.map(function (s) { return s.trim(); }).filter(function (s) { return s; });
        if (!txt.length) fail(where, '「:::」だけの囲みに中身がありません（囲みたい文を同じ行に書きます）');
        if (txt.length > 1) {
            fail(where, '型を書かない「:::」の囲みに書けるのは1つの文だけです（いまは ' + txt.length + ' 行）'
                + '\n    ★ 直し方: 文を1つにするか、種類を書きます（例: :::callout tone: caution text: …）');
        }
        var b = { kind: DEFAULT_FENCE.kind, tone: DEFAULT_FENCE.tone, text: inline(txt[0], where + ' の ::: の囲み') };
        checkBlock(b, where);
        return b;
    }

    function buildBlock(kind, inner, where) {
        var spec = BLOCK_SPECS[kind];
        if (!spec) fail(where, '「:::' + kind + '」は描けない種類です（書けるのは ' + KINDS.join(' / ') + '）');
        var kv = parseKV(inner, where + ' の :::' + kind, spec.order, kind, spec.hang, spec.multi).map;
        /* ★ 題の語尾の「（発展）」を印へ寄せる（節と小見出しだけ）。⚠ 両方書いてあっても矛盾しない */
        if ((kind === 'section' || kind === 'heading') && typeof kv.title === 'string') {
            var folded = foldAdvanced(kv.title);
            if (folded !== null) { kv.title = folded; kv.advanced = 'true'; }
        }
        var block = { kind: kind };
        var enums = spec.enum || {}, bools = spec.bool || [];
        spec.order.forEach(function (k) {
            if (!Object.prototype.hasOwnProperty.call(kv, k)) {
                if (spec.req.indexOf(k) >= 0) fail(where, ':::' + kind + ' に「' + k + '」がありません');
                return;
            }
            var v = kv[k], at = where + ' の ' + k;
            /* ★ 記法を通すかどうかは `prose` で決まる。**配列の要素にも通す** ——
               通さないと `items:` と `rows:` の中で強調も下付きも書けない（設計書 §19-3 ②） */
            var conv = (spec.raw || []).indexOf(k) >= 0 ? function (s) { return s; }
                : spec.prose.indexOf(k) >= 0 ? inline : plain;
            if (Array.isArray(v)) {
                /* ★ `multi` のキー（`mark`）は「1行1つを何行でも」＝ 並びとして持つ（`- 値` の list とは書き方が違う） */
                if (spec.list.indexOf(k) < 0 && (spec.multi || []).indexOf(k) < 0) fail(where, ':::' + kind + ' の「' + k + '」は1行の値です');
                block[k] = v.map(function (s) { return conv(s, at); });
                /* ★ 1行なら文字列のまま（`:::figure` の `gen`）＝ 1分子の図は段2の前と同じ形 */
                if ((spec.oneScalar || []).indexOf(k) >= 0 && block[k].length === 1) block[k] = block[k][0];
            } else if (bools.indexOf(k) >= 0) {
                if (v !== 'true' && v !== 'false') fail(where, ':::' + kind + ' の「' + k + '」は true か false です（いまは「' + v + '」）');
                block[k] = (v === 'true');
            } else if (enums[k]) {
                /* ⚠ **綴り違いを黙って通さない。** `★★` や `Caution` はここで止まる ——
                   通すと「印が付いているのに何も出ない」ページが混ざる */
                if (enums[k].indexOf(v) < 0) fail(where, ':::' + kind + ' の「' + k + '」は ' + enums[k].join(' / ') + ' のどれかです（いまは「' + v + '」）');
                block[k] = v;
            } else {
                /* ⚠ `series` のように **1行でも並びでもよい**キーがある（既存の3ページがそう書いている）ので、
                   「並びでしか書けない」は `listOnly` に挙げたものだけに掛ける */
                if ((spec.listOnly || []).indexOf(k) >= 0) fail(where, ':::' + kind + ' の「' + k + '」は「  - 値」の並びで書きます（1件でも）');
                block[k] = conv(v, at);
            }
        });
        Object.keys(kv).forEach(function (k) {
            if (spec.order.indexOf(k) >= 0) return;
            /* ★ `:::example` ↔ `:::exercise` の取り違えは、**相手の名前と役まで言う**（§22-2）。
               ⚠ 一文は `confusableHint` の1か所で作る（行を読む側 `kvLineFail` と同じもの） */
            fail(where, ':::' + kind + ' に知らないキー「' + k + '」があります（書けるのは ' + spec.order.join(' / ') + '）'
                + confusableHint(kind, k));
        });
        checkBlock(block, where);
        return block;
    }

    /* 種類ごとの決めごと（形が通ったあとに見るもの） */
    function checkBlock(b, where) {
        if (b.kind === 'section') {
            if (!ANCHOR_RE.test(b.anchor)) {
                fail(where, ':::section の anchor は英小文字・数字・ハイフンで書きます（URL の # の後ろに出ます。いまは「' + b.anchor + '」）');
            }
        }
        if (b.kind === 'figure') {
            /* ⚠ **パスを書かせない。** 置き場所（reference-img/）を .md 側から動かせると、
               面Aと面Bで別の場所を指す図ができる（設計書 §19-4） */
            /* ★ 出典の4欄（他人の写真）。4つそろっているか・URL は https か・ライセンスは知っている名前か */
            var CREDIT_KEYS = ['credit', 'creditUrl', 'license', 'licenseUrl'];
            var hasCredit = CREDIT_KEYS.filter(function (k) { return Object.prototype.hasOwnProperty.call(b, k); });
            if (hasCredit.length && hasCredit.length < CREDIT_KEYS.length) {
                fail(where, ':::figure の出典は ' + CREDIT_KEYS.join(' / ') + ' の4つをそろえて書きます（いまは ' + hasCredit.join(' / ') + ' だけ）'
                    + '\n    ★ 直し方: 作者（credit）・元のページ（creditUrl）・ライセンスの名前（license）・ライセンスの本文（licenseUrl）を全部書きます。どれかが欠けると表示の条件を満たしません');
            }
            if (hasCredit.length) {
                ['creditUrl', 'licenseUrl'].forEach(function (k) {
                    if (!/^https:\/\/[^\s<>"]+$/.test(b[k])) {
                        fail(where, ':::figure の ' + k + ' は https:// で始まる URL を1つだけ書きます（いまは「' + b[k] + '」）'
                            + '\n    ★ 直し方: http:// なら https:// に直し、空白や説明の文を URL の後ろに付けません');
                    }
                });
                if (FIGURE_LICENSES.indexOf(b.license) < 0) {
                    fail(where, ':::figure の license は ' + FIGURE_LICENSES.join(' / ') + ' のどれかです（いまは「' + b.license + '」）'
                        + '\n    ★ 直し方: 上の名前の綴りのとおりに書きます。⚠ 名前を1つに決めておかないと、同じライセンスが違う綴りで並びます');
                }
            }
            /* ⚠ .jpg は**出典つきの写真だけ**（元のファイルを加工せずに置くため。変換も加工にあたりうる） */
            if (!(FIGURE_SRC_RE.test(b.src) || (hasCredit.length && FIGURE_PHOTO_RE.test(b.src)))) {
                fail(where, ':::figure の src は reference-img/ の中のファイル名だけを書きます'
                    + '（英小文字・数字・ハイフン ＋ .png。出典の4欄を書いた写真だけ .jpg も可。パスや .. は書けません。いまは「' + b.src + '」）');
            }
            /* ⚠ `alt` は**画像が出ない人が読む文**。空でも「図」でもなく、中身を言うこと */
            if (b.alt.length < 6) {
                fail(where, ':::figure の alt（画像が出ないときに読まれる文）が短すぎます: 「' + b.alt + '」'
                    + '\n    ★ 直し方: 「図」ではなく、何が描いてあるかを1文で書きます'
                    + '（例: メタンの正四面体構造。手前の結合をくさび、奥の結合を破線で描いた図）'
                    + '\n    ⚠ caption と同じ文にしないこと（caption は図の外に出るので、読み上げが二重になります）');
            }
            /* ★★ SVG のソースから焼く図（2026-09-21） */
            if (Object.prototype.hasOwnProperty.call(b, 'svg')) {
                if (Object.prototype.hasOwnProperty.call(b, 'gen') || Object.prototype.hasOwnProperty.call(b, 'shot')) {
                    fail(where, ':::figure に svg: と gen:/shot: の両方があります'
                        + '    ★ 1枚の図の焼き方は1つだけです');
                }
                if (!FIGURE_SVG_RE.test(b.svg)) {
                    fail(where, ':::figure の svg: は reference-svg/ の中のファイル名だけを書きます'
                        + '（英小文字・数字・ハイフン ＋ .svg。いまは「' + b.svg + '」）');
                }
                if (b.src !== b.svg.replace(/\.svg$/, '.png')) {
                    fail(where, ':::figure の src は svg: と同じ名の .png にします'
                        + '（svg: ' + b.svg + ' なら src: ' + b.svg.replace(/\.svg$/, '.png') + '。いまは「' + b.src + '」）'
                        + '    ★ 名前をそろえると、焼き直しのときにどの PNG がどのソースから来たかを名前だけで追えます');
                }
            }
            /* ★★ 図に重ねる印（DESIGN_figure_marks.md 段1）。
               ⚠ **`gen:` の無い図には書けない** —— 印だけの図はありえないし、スライドから切った画像に
                 「印を付けたつもり」の行が残ると、**印の無い図が黙って配られる**（設計 §1 の事故そのもの）。 */
            if (Object.prototype.hasOwnProperty.call(b, 'mark')) {
                if (!Object.prototype.hasOwnProperty.call(b, 'gen')) {
                    fail(where, ':::figure に mark: がありますが gen: がありません'
                        + '\n    ★ 印は作図器で焼く図（gen:）にだけ重ねられます（スライドから切った画像・svg: の図には付けられません）');
                }
                b.mark.forEach(function (s) { parseMark(s, where); });
            }
            /* ★★ 分子を複数並べる図（段2・設計 §5）。⚠ 数え合わせはここで ＝ **焼く前に**（gen-reference も gen-figure も）赤 */
            var nGen = Array.isArray(b.gen) ? b.gen.length : (Object.prototype.hasOwnProperty.call(b, 'gen') ? 1 : 0);
            var outOfRange = function (n, what) {
                if (n !== null && (n < 1 || n > nGen)) {
                    fail(where, ':::figure の ' + what + ' が ' + n + ' 番目の分子を指していますが、gen: は ' + nGen + ' 行（分子 ' + nGen + ' つ）です'
                        + '\n    ★ 何番目かは gen: を書いた順に 1・2・… と数えます');
                }
            };
            (b.mark || []).forEach(function (s) {
                var mk = parseMark(s, where);
                /* ⚠ 分子が2つ以上なら、印がどの分子のものかを必ず書く（黙って1番目に付けない） */
                if (nGen >= 2 && mk.part === null) {
                    fail(where, ':::figure に分子が ' + nGen + ' つあるので、mark の at= に何番目の分子かを付けます（いまは at=' + mk.at + '）'
                        + '\n    ★ 例: at=1:' + mk.at);
                }
                outOfRange(mk.part, 'mark の at=「' + mk.at + '」');
            });
            if (Object.prototype.hasOwnProperty.call(b, 'between')) {
                if (nGen < 2) {
                    fail(where, ':::figure に between: がありますが、gen: が ' + nGen + ' 行です'
                        + '\n    ★ between: は分子と分子の間を結ぶもの。gen: を2行以上（1行 ＝ 1分子）書きます'
                        + '\n    ★ 1つの分子の中の2か所を結ぶなら mark: kind=破線（または 矢印） at=… to=… です');
                }
                b.between.forEach(function (s) {
                    var bw = parseBetween(s, where);
                    if (!bw.from) {
                        if (nGen !== 2) {
                            fail(where, ':::figure の between: kind=' + bw.kind + ' に at= / to= がありません。分子が ' + nGen + ' つあるので、どの間かを書きます'
                                + '\n    ★ 例: between: kind=' + bw.kind + ' at=1 to=2');
                        }
                        return;
                    }
                    outOfRange(bw.from.n, 'between の at=「' + bw.at + '」');
                    outOfRange(bw.dest.n, 'between の to=「' + bw.to + '」');
                    /* ⚠ 分子だけを指す矢印は**すき間**に引く ＝ 隣どうしでないと間の分子を貫く */
                    if (bw.from.place === null && Math.abs(bw.from.n - bw.dest.n) !== 1) {
                        fail(where, ':::figure の between: at=' + bw.at + ' to=' + bw.to + ' は隣どうしの分子ではありません'
                            + '（間の分子を貫いてしまいます。横一列の隣どうしだけ結べます）');
                    }
                });
            }
            /* ★★ アプリの画面の切り取り（§31-4） */
            if (Object.prototype.hasOwnProperty.call(b, 'shot')) {
                if (Object.prototype.hasOwnProperty.call(b, 'gen')) {
                    fail(where, ':::figure に gen:（分子を焼く）と shot:（アプリの画面を切り取る）の両方があります'
                        + '\n    ★ 1枚の図の焼き方は1つだけです。どちらかを消してください');
                }
                parseShot(b.shot, where);
                /* ⚠ 名前でスライド由来・作図器由来と見分ける（`<ページid>-app-<中身>.png`） */
                if (b.src.indexOf('-app-') < 0) {
                    fail(where, ':::figure の shot: で撮る図の src は「<ページid>-app-<中身>.png」の名前にします（いまは「' + b.src + '」）'
                        + '\n    ★ -app- が入っていれば、スライドから切った図・分子を焼いた図と名前で見分けられます');
                }
            }
        }
        if (b.kind === 'reaction') {
            /* ⛔ 可逆の矢印を式の中に書く逃げ道を作らない（§31-2） */
            ['left', 'right', 'over', 'under'].forEach(function (k) {
                if (b[k] && /[⇄⇌⇆]/.test(b[k])) {
                    fail(where, ':::reaction の ' + k + ' に可逆の矢印があります「' + b[k].slice(0, 40) + '」'
                        + '\n    ★ 直し方: 式を left と right に分けて、矢印は「arrow: ⇄」の1行で書きます');
                }
            });
        }
        if (b.kind === 'table') {
            /* ⚠ 行の出どころ。★ 短い語（「スライド」）で済ませられないよう長さを見る */
            if (b.source.length < 8) {
                fail(where, ':::table の source（この行がどこから来たか）が短すぎます: 「' + b.source + '」'
                    + '\n    ★ 手で書く表はここだけ REF5 の「行データを持たない」の外に出るので、出どころを必ず書きます');
            }
            /* ⚠ 列の数がそろっていない表は、画面では「1列ずれた表」として**それらしく出てしまう** */
            var n = b.head.length;
            if (n < 2) fail(where, ':::table の head は2列以上です');
            /* ★ 列ごとの寄せ（§20-9）。⚠ **head と同じ数だけ**書く ——
               足りない・多いのを黙って詰めると、**1列ずれた寄せ**として それらしく出てしまう */
            if (Object.prototype.hasOwnProperty.call(b, 'align')) {
                var cols = b.align.split(CELL_SEP).map(function (s) { return s.trim(); });
                if (cols.length !== n) {
                    fail(where, ':::table の align が ' + cols.length + ' 個で、head の ' + n + ' 列と違います'
                        + '（セルと同じ「 | 」で区切って、列の数だけ書きます）\n    → ' + b.align);
                }
                cols.forEach(function (v) {
                    if (ALIGNS.indexOf(v) < 0) {
                        fail(where, ':::table の align に書けるのは ' + ALIGNS.join(' / ') + ' です（いまは「' + v + '」）'
                            + '\n    → ' + b.align);
                    }
                });
            }
            b.rows.forEach(function (row, i) {
                var cells = row.split(CELL_SEP);
                if (cells.length !== n) {
                    fail(where, ':::table の ' + (i + 1) + ' 行目のセルが ' + cells.length + ' 個で、head の ' + n + ' 列と違います'
                        + '（セルは「 | 」で区切ります）\n    → ' + row.slice(0, 80));
                }
            });
        }
        if (b.kind === 'list' && !b.items.length) fail(where, ':::list の items が空です');
        if (b.kind === 'mistake') {
            var plain = function (s) { return String(s).replace(/<\/?(b|sub)>/g, '').trim(); };
            /* ⚠ 「誤り」だけ・「正しい形」だけでは囲みにならない。★ 短い語で済ませられないよう長さを見る */
            if (plain(b.wrong).length < 6) {
                fail(where, ':::mistake の wrong（よくある誤り）が短すぎます: 「' + b.wrong + '」'
                    + '\n    ★ 生徒が実際にそう思っている文をそのまま書きます'
                    + '（例: 第3級アルコールは酸化されないから、脱水もできない）');
            }
            if (plain(b.right).length < 6) {
                fail(where, ':::mistake の right（正しい形）が短すぎます: 「' + b.right + '」');
            }
            /* ⚠⚠ **同じ文を2つ並べない。** 誤りと正しい形が同じなら、囲みが何も言っていない */
            if (plain(b.wrong) === plain(b.right)) {
                fail(where, ':::mistake の wrong と right が同じ文です'
                    + '\n    ★ この囲みは「誤り」と「正しい形」を**並べて置く**ためのものです'
                    + '（1つのことを言うだけなら :::callout の tone: caution を使います）');
            }
            /* ⚠⚠ **発展の印と役が違う**（範囲の外／範囲の内）。⛔ 混ぜない、を機械で言う。
               ★ 「発展」と書いてある誤解は、たいてい `advanced: true` を付けたい節の話 */
            if (plain(b.wrong).indexOf(ADVANCED_WORD) >= 0 || plain(b.right).indexOf(ADVANCED_WORD) >= 0) {
                fail(where, ':::mistake の中に「' + ADVANCED_WORD + '」と書いてあります'
                    + '\n    ⚠ 発展（＝ 高校の教科書の本文の外側）と、よくある誤解（＝ 範囲の内で間違えやすい）は役が違います'
                    + '\n    ★ 範囲の外の話なら、その節に advanced: true を付けてください');
            }
        }
        if (b.kind === 'exercise') {
            /* ⚠⚠ **出どころ。**`:::table` の `source` と同じ扱い（§19-10 の「出どころの言えない行を書くな」）。
               ★ 短い語（「スライド」）で済ませられないよう長さを見る。⚠ 画面には出さない欄。 */
            if (b.source.length < 8) {
                fail(where, ':::exercise の source（この問いがどこから来たか）が短すぎます: 「' + b.source + '」'
                    + '\n    ★ どのスライドの何番の練習かまで書きます'
                    + '（例: slides:有機の基本2-3「アルカンの命名法」練習1(1)）'
                    + '\n    ⚠ この欄は画面には出しません（画面に出典は書かない）');
            }
            var bare = function (s) { return String(s).replace(/<\/?(b|sub)>/g, ''); };
            if (bare(b.prompt).length < 6) fail(where, ':::exercise の prompt（問題文）が短すぎます: 「' + b.prompt + '」');
            if (bare(b.answer).length < 4) fail(where, ':::exercise の answer（解答）が短すぎます: 「' + b.answer + '」');
            /* ★ 図は問い側と解答側の2つ。⚠ **`…Src` と `…Alt` は必ず対で書く** ——
               片方だけだと「画像が出ないと何も読めない図」か「使われない alt」になる。 */
            [['promptSrc', 'promptAlt', '問い'], ['answerSrc', 'answerAlt', '解答']].forEach(function (p) {
                var hasSrc = Object.prototype.hasOwnProperty.call(b, p[0]);
                var hasAlt = Object.prototype.hasOwnProperty.call(b, p[1]);
                if (hasSrc !== hasAlt) {
                    fail(where, ':::exercise の ' + p[2] + 'の図は「' + p[0] + '」と「' + p[1] + '」を対で書きます'
                        + '（いまは ' + (hasSrc ? p[0] : p[1]) + ' だけ）'
                        + '\n    ★ ' + p[1] + ' は画像が出ない人が読む文です');
                }
                if (!hasSrc) return;
                if (!FIGURE_SRC_RE.test(b[p[0]])) {
                    fail(where, ':::exercise の ' + p[0] + ' は reference-img/ の中のファイル名だけを書きます'
                        + '（英小文字・数字・ハイフン ＋ .png。パスや .. は書けません。いまは「' + b[p[0]] + '」）');
                }
                if (b[p[1]].length < 6) {
                    fail(where, ':::exercise の ' + p[1] + '（画像が出ないときに読まれる文）が短すぎます: 「' + b[p[1]] + '」'
                        + '\n    ★ 直し方: 「図」ではなく、何が描いてあるかを1文で書きます'
                        + '（例: 2,3-ジメチルブタンの構造式。主鎖の炭素に1から4の番号を振った図）');
                }
            });
            /* ⚠⚠ **解答が問いの中に混ざっていないこと。** 解答は開いて見るものなので、
               問題文に答えを書いてしまうと、器の意味が無くなる（ページを開いた瞬間に見える）。 */
            if (bare(b.answer).length >= 4 && bare(b.prompt).indexOf(bare(b.answer)) >= 0) {
                fail(where, ':::exercise の prompt（問題文）の中に answer（解答）がそのまま入っています'
                    + '\n    ★ 解答は「解答を見る」を押して初めて出るものなので、問題文には書きません');
            }
        }
        if (b.kind === 'link') {
            /* ⚠ **どちらか片方だけ。** 両方書くと「ページへ飛ぶのかアプリへ飛ぶのか」が
               リンク1本で2通りになり、画面では**片方が黙って無視される**形で出る */
            var has = ['to', 'open', 'app'].filter(function (k) { return Object.prototype.hasOwnProperty.call(b, k); });
            if (has.length !== 1) {
                fail(where, ':::link は「to:（参考書のページ id）」「open:（パズルでみる有機化学の行き先）」'
                    + '「app:（ほかのアプリの受け口）」の'
                    + (has.length ? 'どれか1つだけを書きます（いまは ' + has.join(' と ') + ' があります）' : 'どれかが要ります')
                    + '\n    ★ 直し方: 参考書の別のページへ飛ぶなら「to: alkane-naming」、'
                    + '有機のアプリで試させるなら「open: isomer」、'
                    + 'ほかのアプリなら「app: ion-equation/redox」と「id: rs1」のように書きます');
            }
            /* ★★ ほかのアプリの受け口（§31-3）。⚠ 名前は台帳（APP_TARGETS）にあるものだけ */
            if (Object.prototype.hasOwnProperty.call(b, 'id') && !b.app) {
                fail(where, ':::link の id は app: と一緒に書きます（受け口に渡す値です）');
            }
            if (b.app) {
                var tgt = Object.prototype.hasOwnProperty.call(APP_TARGETS, b.app) ? APP_TARGETS[b.app] : null;
                if (!tgt) {
                    fail(where, ':::link の app「' + b.app + '」は受け口の台帳にありません'
                        + '\n    ★ 書けるのは ' + Object.keys(APP_TARGETS).join(' / ')
                        + '\n    ⚠ URL は書きません。新しい受け口が要るなら、先に受け側のアプリに作ってから tools/reference-md.js の APP_TARGETS に足します');
                }
                if (!Object.prototype.hasOwnProperty.call(b, 'id') && tgt.param && !tgt.opt) {
                    fail(where, ':::link の app「' + b.app + '」には id: が要ります（受け口に渡す値。'
                        + (tgt.param === '#' ? 'URL の # の後ろ' : '?' + tgt.param + '=') + ' に入ります）');
                }
                if (Object.prototype.hasOwnProperty.call(b, 'id')) {
                    if (!tgt.param) {
                        fail(where, ':::link の app「' + b.app + '」は引数を受けないページです（id: を消してください）');
                    }
                    if (!APP_ID_RE.test(b.id)) {
                        fail(where, ':::link の id は受け口に渡す値です（英数字と _ . , + - だけ。いまは「' + b.id + '」）');
                    }
                }
                b.href = appHref(b.app, b.id, CTX_PAGE);
            }
            /* ★★ 埋め込み（`embed: true`・DESIGN_reference_centric.md §2-4）。
               ⚠⚠ **相手が `embed=1` を知らないと、参考書の中に看板と帯がもう1枚出る**（しかも
                 中のリンクは iframe の中で開く）＝ 埋めてよい受け口は台帳が名指しする。 */
            if (Object.prototype.hasOwnProperty.call(b, 'embed')) {
                if (b.embed !== true) {
                    fail(where, ':::link の embed は true のときだけ書きます（埋め込まないなら embed: の行ごと消します）');
                }
                if (!b.app) {
                    fail(where, ':::link の embed: true は app:（ほかのアプリの受け口）と一緒に書きます'
                        + '\n    ★ 参考書のページ（to:）や有機のアプリ（open:）は、そのページの中には埋め込めません');
                }
                if (!tgt || !tgt.embeddable) {
                    fail(where, ':::link の app「' + b.app + '」は、ページの中に埋め込める受け口ではありません'
                        + '\n    ★ 埋め込めるのは ' + Object.keys(APP_TARGETS).filter(function (k) { return APP_TARGETS[k].embeddable; }).join(' / ')
                        + '\n    ⚠ 埋め込む相手には「看板を隠す・高さを親に送る・戻る帯を作らない」（embed=1）が要ります。'
                        + '先に受け側のアプリに作ってから、APP_TARGETS に embeddable: true を足します');
                }
                /* ★ 焼き込むのは**素の href に `embed=1` を足しただけ**のもの（§2-4 (1)）。
                   ⚠ `href`（素のまま）も残す —— 部品の下の「▶ 大きな画面で開く」がそれを使う。 */
                b.embedHref = appHref(b.app, b.id, CTX_PAGE, true);
            }
            if (b.to && !ANCHOR_RE.test(b.to)) {
                fail(where, ':::link の to は参考書のページ id です（英小文字・数字・ハイフン。いまは「' + b.to + '」）');
            }
            if (b.open && !ANCHOR_RE.test(b.open)) {
                fail(where, ':::link の open はアプリの行き先の名前です（英小文字・数字。いまは「' + b.open + '」）');
            }
            if (Object.prototype.hasOwnProperty.call(b, 'formula')) {
                if (!b.open) fail(where, ':::link の formula は open: と一緒に書きます（受け口 ?open=isomer&formula= のためのものです）');
                /* ⚠ 下付きの Unicode（C₅H₁₂）は受け口が読めない —— `startFromFormula` は素の ASCII */
                if (!/^[A-Za-z0-9]+$/.test(b.formula)) {
                    fail(where, ':::link の formula は素の英数字で書きます（C5H12。下付きの C₅H₁₂ はアプリが読めません。いまは「' + b.formula + '」）');
                }
            }
            /* ★★ 分類で絞る回（§25）。⚠ **`formula` と対で書く** ——
               分類だけでは何の式を書き出すのかが決まらず、受け口が何もできない。
               ⚠ **どの分類が在るかはここでは見ない**（`open:` と同じ理由で `learn.js` が読めない）。
                 ★ 綴り違いを止めるのは `REF21` ＝ **その分類でその式の練習が実際に始まること**を確かめる。 */
            if (Object.prototype.hasOwnProperty.call(b, 'cls')) {
                if (!b.formula) {
                    fail(where, ':::link の cls（書き出しの分類）は formula: と一緒に書きます'
                        + '\n    ★ 直し方: 「open: isomer」「formula: C4H8O2」「cls: ester」の3つをそろえて書きます'
                        + '（分類だけでは、何の分子式を書き出す回なのかが決まりません）');
                }
                if (!ANCHOR_RE.test(b.cls)) {
                    fail(where, ':::link の cls は書き出し練習の分類の名前です（英小文字・数字。いまは「' + b.cls + '」）');
                }
            }
            /* ★★ まだ書いていないページ宛か（＝ 押せない「準備中」にするか）を**ここで決めて焼き込む**。
               ⚠ `soon` は**書く欄ではない**（`spec.order` に無いので、原稿に書いたら「知らないキー」で赤）。
               ★ ページを1枚書いて生成し直せば、そのページ宛の `soon` は自動で消える ＝ 黙って生きる。 */
            if (b.to) {
                if (!CTX) {
                    fail(where, ':::link の行き先を判定できません（parsePage に、いま在るページの一覧 opts.pages が渡っていない）'
                        + '\n    ★ 渡さないと在るページ宛まで「準備中」になるので、黙って続けません');
                }
                if (CTX.indexOf(b.to) < 0) b.soon = true;
            }
            /* ⚠ `text` は**押す文そのもの**。「こちら」だけのリンクを作らせない
               （読み上げでも検索でも、行き先が分からない文になる） */
            if (b.text.replace(/<\/?(b|sub)>/g, '').length < 6) {
                fail(where, ':::link の text（押す文）が短すぎます: 「' + b.text + '」'
                    + '\n    ★ 何のページ／何の練習へ行くのかが、その文だけで分かるように書きます');
            }
        }
    }

    /* ===== 書き出し =========================================================== */

    /**
     * ページの配列 → `assembler/reference.json` の中身（**1ブロック = 1行**）。
     *
     * ⚠ **`JSON.stringify(pages, null, 2)` は使わない。** 狙いは1つだけ ——
     *    **`git diff` を人が読める大きさに保つこと**（移行前は1ページ＝1行で、
     *    1文字直すと 2,048 字の行が丸ごと差分になった）。
     * ★ 生成物なので `compounds.json` の「1行1件」規約からは外れる。
     *    形が守られていることは `REF5`（行数）と `REF17`（生成し直して1バイト一致）が見る。
     */
    function serialize(pages) {
        var out = ['['];
        pages.forEach(function (p, pi) {
            // ★ 書かれなかった任意のキーは**キーごと出さない**（parsePage の注記どおり）
            var head = PAGE_KEYS.filter(function (k) { return k !== 'why' && Object.prototype.hasOwnProperty.call(p, k); })
                .map(function (k) { return JSON.stringify(k) + ':' + JSON.stringify(p[k]); }).join(',');
            out.push('{' + head + ',');
            out.push('"why":' + JSON.stringify(p.why) + ',');
            out.push('"blocks":[');
            (p.blocks || []).forEach(function (b, bi) {
                out.push(JSON.stringify(b) + (bi < p.blocks.length - 1 ? ',' : ''));
            });
            out.push(']}' + (pi < pages.length - 1 ? ',' : ''));
        });
        out.push(']');
        return out.join('\r\n') + '\r\n';
    }

    /* `REF5` が「書き戻されていないか」を見るための期待行数（2 + Σ(4 + ブロック数)） */
    function expectedLineCount(pages) {
        var n = 2;
        pages.forEach(function (p) { n += 4 + ((p.blocks || []).length); });
        return n;
    }

    /* 改行の別は見ない（作業ツリーが CRLF か LF かは core.autocrlf しだいで、書式の話ではない） */
    function normalize(text) { return String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'); }

    return {
        PAGE_KEYS: PAGE_KEYS,
        PAGE_OPTIONAL_KEYS: PAGE_OPTIONAL_KEYS,
        BLOCK_SPECS: BLOCK_SPECS,
        KINDS: KINDS,
        LEVELS: LEVELS,
        TONES: TONES,
        ALIGNS: ALIGNS,
        ADVANCED_WORD: ADVANCED_WORD,
        BLANK_CLASS: BLANK_CLASS,
        HANG_MARK: HANG_MARK,
        DEFAULT_FENCE: DEFAULT_FENCE,
        CELL_SEP: CELL_SEP,
        FIGURE_DIR: '/reference-img/',
        DIVISIONS: DIVISIONS,
        divisionOf: divisionOf,
        divisionLabel: divisionLabel,
        ARROWS: ARROWS,
        APP_TARGETS: APP_TARGETS,
        appHref: appHref,
        SHOT_KEYS: SHOT_KEYS,
        parseShot: parseShot,
        MARK_KEYS: MARK_KEYS,
        MARK_KINDS: MARK_KINDS,
        parseMark: parseMark,
        BETWEEN_KINDS: BETWEEN_KINDS,
        parseBetween: parseBetween,
        parseGroups: parseGroups,
        COURSE_LABELS: COURSE_LABELS,
        parseToc: parseToc,
        tocOrder: tocOrder,
        tocHome: tocHome,
        parsePage: parsePage,
        serialize: serialize,
        expectedLineCount: expectedLineCount,
        normalize: normalize
    };
});
