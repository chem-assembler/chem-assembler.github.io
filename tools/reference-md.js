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

    /* ページの前書き。**JSON のキーの並びはここが決める**（.md に書く順は自由）。 */
    var PAGE_KEYS = ['id', 'unit', 'unitLabel', 'group', 'title', 'codes', 'source', 'singleSource', 'why'];
    var PAGE_LIST_KEYS = ['codes', 'source'];      // `key:` ＋ `  - 値` で書く
    var PAGE_BOOL_KEYS = ['singleSource'];

    /* `:::` の囲み。**`learn.js` の `renderBlock` が実際に描ける4種だけ**。
       ⚠ 5つ目を足すときは learn.js と**両方**直す（`REF17` が突き合わせて赤くする）。
       order … JSON のキーの並び / req … 必須 / list … 配列でもよい / prose … 本文の記法が効く */
    var BLOCK_SPECS = {
        stageTable: { order: ['variant', 'series', 'source', 'caption'], req: ['series', 'source', 'caption'], list: ['series'], prose: ['caption'] },
        mechanismTable: { order: ['source', 'caption'], req: ['source', 'caption'], list: [], prose: ['caption'] },
        dehydrationTable: { order: ['source', 'caption'], req: ['source', 'caption'], list: [], prose: ['caption'] },
        example: { order: ['stageId', 'lead', 'note'], req: ['stageId', 'lead', 'note'], list: [], prose: ['lead', 'note'] }
    };
    var KINDS = Object.keys(BLOCK_SPECS);

    /* 前書きのうち「読者に見える文字列」ではないもの ＝ 記法を通さず、素のままであること
       （`unitLabel` / `group` / `title` は `textContent` と `escapeRefText` で出るので、
         ここにタグを書くとタグが**そのまま画面に出る**。だから素であることを機械で見る） */
    var PAGE_PLAIN_KEYS = ['id', 'unit', 'unitLabel', 'group', 'title', 'why'];

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
            if (!Object.prototype.hasOwnProperty.call(fm, k)) fail(where, '前書きに「' + k + '」がありません');
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
        spec.order.forEach(function (k) {
            if (!Object.prototype.hasOwnProperty.call(kv, k)) {
                if (spec.req.indexOf(k) >= 0) fail(where, ':::' + kind + ' に「' + k + '」がありません');
                return;
            }
            var v = kv[k];
            if (Array.isArray(v)) {
                if (spec.list.indexOf(k) < 0) fail(where, ':::' + kind + ' の「' + k + '」は1行の値です');
                block[k] = v.map(function (s) { return plain(s, where + ' の ' + k); });
            } else {
                block[k] = spec.prose.indexOf(k) >= 0 ? inline(v, where + ' の ' + k) : plain(v, where + ' の ' + k);
            }
        });
        Object.keys(kv).forEach(function (k) {
            if (spec.order.indexOf(k) < 0) fail(where, ':::' + kind + ' に知らないキー「' + k + '」があります（書けるのは ' + spec.order.join(' / ') + '）');
        });
        return block;
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
            var head = PAGE_KEYS.filter(function (k) { return k !== 'why'; })
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
        BLOCK_SPECS: BLOCK_SPECS,
        KINDS: KINDS,
        parsePage: parsePage,
        serialize: serialize,
        expectedLineCount: expectedLineCount,
        normalize: normalize
    };
});
