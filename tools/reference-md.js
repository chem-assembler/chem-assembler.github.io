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
          **検索結果に出る文を機械が勝手に決めると、ユーザーが校正できない**（§16 の目的と逆向き）。 */
    var PAGE_OPTIONAL_KEYS = ['video'];
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
    var TONES = ['caution', 'memorize', 'skip'];
    var BLOCK_SPECS = {
        /* 節の見出し。`anchor` が `id="ref-sec-<anchor>"` になり、目次と用語の索引の行き先になる。
           ⚠ `lead`（この節で分かること）は**必須** —— 検索から着地した人が最初に読む1行なので、
              「見出しだけ在って何の節か分からない」を作らない（設計書 §19-1） */
        section: { order: ['anchor', 'title', 'lead', 'terms'], req: ['anchor', 'title', 'lead'], list: ['terms'], prose: ['lead'] },
        /* 箇条書き。`ordered: true` で番号つき（素材の「手順 S1〜Sn」用） */
        list: { order: ['ordered', 'items'], req: ['items'], list: ['items'], prose: ['items'], bool: ['ordered'] },
        /* 図。⚠ `src` は **`reference-img/` の中のファイル名だけ**（パスも .. も書けない）。
           `/reference-img/` を付けるのは learn.js の1か所（面A・面Bで同じ URL になる） */
        figure: { order: ['src', 'alt', 'caption'], req: ['src', 'alt', 'caption'], list: [], prose: ['caption'] },
        /* ★★ 化学反応式。**文字だけで組む**（画像に頼らない・設計書 §19-5）。
           `over` / `under` は矢印の上下に出る条件（試薬・温度・触媒） */
        reaction: { order: ['left', 'over', 'under', 'right', 'level', 'note'], req: ['left', 'right', 'level'], list: [], prose: ['note'], enum: { level: LEVELS } },
        /* 手で書く表（機械が行を作れないもの）。セルは ` | ` で切る */
        table: { order: ['caption', 'head', 'rows'], req: ['head', 'rows'], list: ['head', 'rows'], prose: ['caption', 'head', 'rows'] },
        /* 注意の囲み。⚠ `tone` は3つだけ（勘違いしやすい／丸暗記でよい／覚えなくてよい） */
        callout: { order: ['tone', 'text'], req: ['tone', 'text'], list: [], prose: ['text'], enum: { tone: TONES } },

        stageTable: { order: ['variant', 'series', 'source', 'caption'], req: ['series', 'source', 'caption'], list: ['series'], prose: ['caption'] },
        mechanismTable: { order: ['source', 'caption'], req: ['source', 'caption'], list: [], prose: ['caption'] },
        dehydrationTable: { order: ['source', 'caption'], req: ['source', 'caption'], list: [], prose: ['caption'] },
        example: { order: ['stageId', 'lead', 'note'], req: ['stageId', 'lead', 'note'], list: [], prose: ['lead', 'note'] }
    };
    var KINDS = Object.keys(BLOCK_SPECS);

    /* 図のファイル名。⚠ **名前だけ**（`/` も `..` も許さない）。置き場所を .md 側から動かせない形にする */
    var FIGURE_SRC_RE = /^[a-z0-9][a-z0-9-]*\.png$/;
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

    function fail(where, msg) { throw new Error(where + ': ' + msg); }

    /* 本文の記法 → HTML。**変換したあとに `* ~ < > &` が残っていたら赤**
       ＝ `**` の閉じ忘れも、うっかりの生 HTML も、ここで止まる。 */
    function inline(s, where) {
        var h = String(s)
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
            .replace(/~([^~]+)~/g, '<sub>$1</sub>');
        var bare = h.replace(/<\/?b>/g, '').replace(/<\/?sub>/g, '');
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

    /* 「キー: 値」だけの小さな文法。**前書きと `:::` の中で同じものを使う**（覚えることを1つにする）:
         key: 値
         key: true / false
         key:
           - 値
           - 値 */
    function parseKV(lines, where) {
        var out = {}, order = [], i = 0;
        while (i < lines.length) {
            var line = lines[i];
            if (line.trim() === '') { i++; continue; }
            var m = /^([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(line);
            if (!m) fail(where, '「キー: 値」の形でない行があります\n    → ' + line.slice(0, 60));
            var key = m[1], val = m[2].trim();
            if (Object.prototype.hasOwnProperty.call(out, key)) fail(where, 'キー「' + key + '」が2回出てきます');
            if (val === '') {
                var items = [];
                i++;
                while (i < lines.length && /^\s*-\s+\S/.test(lines[i])) {
                    items.push(lines[i].replace(/^\s*-\s+/, '').trim());
                    i++;
                }
                if (!items.length) fail(where, '「' + key + ':」の後に値も「- 」の行もありません');
                out[key] = items;
            } else {
                out[key] = val;
                i++;
            }
            order.push(key);
        }
        return { map: out, order: order };
    }

    /* ===== ページ1枚を読む ===================================================== */

    /**
     * `reference-src/<id>.md` の中身 → ページのオブジェクト（キーの並びは PAGE_KEYS のとおり）。
     * @param {string} text  ファイルの中身（改行は CRLF / LF どちらでもよい）
     * @param {string} where エラーに出す名前（ふつうはファイル名）
     */
    function parsePage(text, where) {
        where = where || '(reference-src)';
        var lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
        if (lines[0] !== '---') fail(where, '1行目が「---」ではありません（前書きが要ります）');
        var end = -1;
        for (var i = 1; i < lines.length; i++) if (lines[i] === '---') { end = i; break; }
        if (end < 0) fail(where, '前書きの終わりの「---」がありません');

        var fm = parseKV(lines.slice(1, end), where + ' の前書き').map;
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

        page.blocks = parseBody(lines.slice(end + 1), where);
        return page;
    }

    /* 本文 ＝ 空行で区切られたかたまり。かたまりは「1行の段落」か「::: の囲み」のどちらか */
    function parseBody(lines, where) {
        var blocks = [], chunk = [];
        var flush = function () {
            if (!chunk.length) return;
            blocks.push(parseChunk(chunk, where));
            chunk = [];
        };
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '') { if (chunk.length && !isOpenFence(chunk)) flush(); else if (chunk.length) chunk.push(lines[i]); continue; }
            chunk.push(lines[i]);
        }
        flush();
        if (!blocks.length) fail(where, '本文が空です');
        return blocks;
    }

    /* `:::` を開いたまま閉じていないかたまりか（囲みの中の空行を段落の切れ目と誤らないため） */
    function isOpenFence(chunk) {
        if (!/^:::/.test(chunk[0])) return false;
        for (var i = 1; i < chunk.length; i++) if (chunk[i].trim() === ':::') return false;
        return true;
    }

    function parseChunk(chunk, where) {
        if (/^:::/.test(chunk[0])) {
            var m = /^:::([A-Za-z][A-Za-z0-9]*)\s*$/.exec(chunk[0]);
            if (!m) fail(where, '囲みの1行目は「:::種類」だけを書きます\n    → ' + chunk[0].slice(0, 60));
            var kind = m[1], close = -1;
            for (var i = 1; i < chunk.length; i++) if (chunk[i].trim() === ':::') { close = i; break; }
            if (close < 0) fail(where, ':::' + kind + ' の囲みが「:::」で閉じていません');
            for (var j = close + 1; j < chunk.length; j++) {
                if (chunk[j].trim() !== '') fail(where, ':::' + kind + ' の囲みの後には空行が要ります\n    → ' + chunk[j].slice(0, 60));
            }
            return buildBlock(kind, chunk.slice(1, close), where);
        }
        if (chunk.length > 1) {
            fail(where, '段落のあいだには空行が要ります（1段落 = 1行。段落の途中で改行しない）'
                + '\n    → ' + chunk[0].slice(0, 40) + ' ／ ' + chunk[1].slice(0, 40));
        }
        return { kind: 'text', text: inline(chunk[0].trim(), where + ' の段落') };
    }

    function buildBlock(kind, inner, where) {
        var spec = BLOCK_SPECS[kind];
        if (!spec) fail(where, '「:::' + kind + '」は描けない種類です（書けるのは ' + KINDS.join(' / ') + '）');
        var kv = parseKV(inner, where + ' の :::' + kind).map;
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
            var conv = spec.prose.indexOf(k) >= 0 ? inline : plain;
            if (Array.isArray(v)) {
                if (spec.list.indexOf(k) < 0) fail(where, ':::' + kind + ' の「' + k + '」は1行の値です');
                block[k] = v.map(function (s) { return conv(s, at); });
            } else if (bools.indexOf(k) >= 0) {
                if (v !== 'true' && v !== 'false') fail(where, ':::' + kind + ' の「' + k + '」は true か false です（いまは「' + v + '」）');
                block[k] = (v === 'true');
            } else if (enums[k]) {
                /* ⚠ **綴り違いを黙って通さない。** `★★` や `Caution` はここで止まる ——
                   通すと「印が付いているのに何も出ない」ページが混ざる */
                if (enums[k].indexOf(v) < 0) fail(where, ':::' + kind + ' の「' + k + '」は ' + enums[k].join(' / ') + ' のどれかです（いまは「' + v + '」）');
                block[k] = v;
            } else {
                if (spec.list.indexOf(k) >= 0) fail(where, ':::' + kind + ' の「' + k + '」は「  - 値」の並びで書きます（1件でも）');
                block[k] = conv(v, at);
            }
        });
        Object.keys(kv).forEach(function (k) {
            if (spec.order.indexOf(k) < 0) fail(where, ':::' + kind + ' に知らないキー「' + k + '」があります（書けるのは ' + spec.order.join(' / ') + '）');
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
            if (!FIGURE_SRC_RE.test(b.src)) {
                fail(where, ':::figure の src は reference-img/ の中のファイル名だけを書きます'
                    + '（英小文字・数字・ハイフン ＋ .png。パスや .. は書けません。いまは「' + b.src + '」）');
            }
            /* ⚠ `alt` は**画像が出ない人が読む文**。空でも「図」でもなく、中身を言うこと */
            if (b.alt.length < 6) fail(where, ':::figure の alt（画像が出ないときに読まれる文）が短すぎます: 「' + b.alt + '」');
        }
        if (b.kind === 'table') {
            /* ⚠ 列の数がそろっていない表は、画面では「1列ずれた表」として**それらしく出てしまう** */
            var n = b.head.length;
            if (n < 2) fail(where, ':::table の head は2列以上です');
            b.rows.forEach(function (row, i) {
                var cells = row.split(CELL_SEP);
                if (cells.length !== n) {
                    fail(where, ':::table の ' + (i + 1) + ' 行目のセルが ' + cells.length + ' 個で、head の ' + n + ' 列と違います'
                        + '（セルは「 | 」で区切ります）\n    → ' + row.slice(0, 80));
                }
            });
        }
        if (b.kind === 'list' && !b.items.length) fail(where, ':::list の items が空です');
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
        CELL_SEP: CELL_SEP,
        FIGURE_DIR: '/reference-img/',
        parsePage: parsePage,
        serialize: serialize,
        expectedLineCount: expectedLineCount,
        normalize: normalize
    };
});
