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
    /* ⚠ `note`（補足）は **型を書かない `::: … :::` の行き先**（§20-4）。
       ★ ユーザーは「ちょっと囲みたい」だけのことがあり、そのたびに tone を選ばせない。 */
    var TONES = ['caution', 'memorize', 'skip', 'note'];
    /* 型を書かなかった囲みの既定。⚠ **2か所に書かない**（learn.js は tone の語だけを持つ） */
    var DEFAULT_FENCE = { kind: 'callout', tone: 'note' };
    var BLOCK_SPECS = {
        /* 節の見出し。`anchor` が `id="ref-sec-<anchor>"` になり、目次と用語の索引の行き先になる。
           ⚠ `lead`（この節で分かること）は**必須** —— 検索から着地した人が最初に読む1行なので、
              「見出しだけ在って何の節か分からない」を作らない（設計書 §19-1） */
        section: { order: ['anchor', 'title', 'lead', 'terms'], req: ['anchor', 'title', 'lead'], list: ['terms'], prose: ['lead'] },
        /* ★ 節の下の小見出し（§20-5）。**本文では `## タイトル` と書ける**（`:::heading` と同じもの）。
           ⚠ **アンカーは持たない** —— 綴りは `#ref-sec-<anchor>` の1つだけ、という §19-2 の決めを
              増やさないため。★ だから**目次（`renderToc`）にも出さない**（目次の行き先は節だけ）。 */
        heading: { order: ['title'], req: ['title'], list: [], prose: ['title'] },
        /* 箇条書き。`ordered: true` で番号つき（素材の「手順 S1〜Sn」用） */
        list: { order: ['ordered', 'items'], req: ['items'], list: ['items'], listOnly: ['items'], prose: ['items'], bool: ['ordered'] },
        /* 図。⚠ `src` は **`reference-img/` の中のファイル名だけ**（パスも .. も書けない）。
           `/reference-img/` を付けるのは learn.js の1か所（面A・面Bで同じ URL になる） */
        figure: { order: ['src', 'alt', 'caption'], req: ['src', 'alt', 'caption'], list: [], prose: ['caption'] },
        /* ★★ 化学反応式。**文字だけで組む**（画像に頼らない・設計書 §19-5）。
           `over` / `under` は矢印の上下に出る条件（試薬・温度・触媒） */
        reaction: { order: ['left', 'over', 'under', 'right', 'level', 'note'], req: ['left', 'right', 'level'], list: [], prose: ['note'], enum: { level: LEVELS } },
        /* ★★ 手で書く表（機械が行を作れないもの）。セルは ` | ` で切る。
           ⚠⚠ **`source` は必須。** `REF5` は「行データの欄（`rows` ほか）を持たない」を
              **著作権の守り**として掛けている（手打ちの表が構造上存在できなければ転写事故は起きない）。
           ★ ここだけ穴を開けるので、**代わりに「その行がどこから来たか」を書かせる** ——
             書けないなら、それはどこかから持ってきている（前書きの `why` と同じ考え・§1-2）。 */
        table: { order: ['caption', 'source', 'head', 'rows'], req: ['source', 'head', 'rows'], list: ['head', 'rows'], listOnly: ['head', 'rows'], prose: ['caption', 'head', 'rows'] },
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

    /* ★★ 1行に詰めて書かれたキーを切り分ける（§20-3）。
     *
     * ⚠ **切れ目にしてよいのは「その囲みで書けるキー」＋「まだ出ていない」ものだけ。**
     *   ★ 知らない語（`slides:` `s4:`）も、2回目の語も、**値の一部として素通しする** ——
     *     そうしないと `title: 反応の見分けかた: 3つの型` のような値で切れてしまう。
     * ⚠ キーと認めるのは `キー:` の直後が **空白か行末**のときだけ（`stages:アルカン` は切らない）。
     *
     * 返り値 `{ lead, parts }` … `lead` は最初のキーより前にある文字（ふつうは空）。
     */
    function splitPacked(text, allowed, used) {
        var re = /(^|\s)([A-Za-z][A-Za-z0-9]*):(?=\s|$)/g;
        var cuts = [], m;
        while ((m = re.exec(text))) {
            var key = m[2];
            if (allowed.indexOf(key) < 0 || used[key]) continue;
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
    function kvLineFail(where, line, allowed, used) {
        var m = /^\s*([A-Za-z][A-Za-z0-9]*):/.exec(line);
        if (m && used[m[1]]) {
            fail(where, 'キー「' + m[1] + '」が2回出てきます（同じ囲みの中で1回だけ書きます）\n    → ' + line.trim().slice(0, 60));
        }
        if (m) {
            fail(where, '知らないキー「' + m[1] + '」があります（ここに書けるのは ' + allowed.join(' / ') + '）'
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
    function parseKV(lines, where, allowed) {
        var out = {}, order = [], used = {}, curList = null;
        var put = function (key, val) {
            order.push(key);
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
                seg = splitPacked(im[1], allowed, used);
                if (seg.lead) out[curList].push(seg.lead);
                else if (!seg.parts.length) fail(where, '「- 」だけの行があります');
            } else {
                seg = splitPacked(line.trim(), allowed, used);
                if (!seg.parts.length || seg.lead) kvLineFail(where, line, allowed, used);
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
    function parsePage(text, where) {
        where = where || '(reference-src)';
        var raw = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
        /* ★★ 著者メモ（`//` から行末まで）を先に抜く。⚠ **画面には出さないが、捨てもしない** ——
           `page.memos` に行番号ごと残し、生成器が「まだ片付いていないメモが N 件」と数えて出す（§20-2）。
           ⚠ `serialize` は PAGE_KEYS しか書かないので、**reference.json には入らない**。 */
        var memos = [];
        var lines = raw.map(function (line, n) {
            var m = /(^|\s)\/\/(.*)$/.exec(line);
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
        /* ⚠ **JSON には出さない**（`serialize` は PAGE_KEYS ＋ why ＋ blocks しか書かない）。
           ★ 生成器と `REF20` が「書いたメモが消えていないこと」をここから数える */
        page.memos = memos;
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
            return { kind: 'heading', title: inline(hm[2].trim(), where + ' の小見出し') };
        }
        if (chunk.length > 1) {
            fail(where, '段落のあいだには空行が要ります（1段落 = 1行。段落の途中で改行しない）'
                + '\n    → ' + chunk[0].slice(0, 40) + ' ／ ' + chunk[1].slice(0, 40));
        }
        return { kind: 'text', text: inline(chunk[0].trim(), where + ' の段落') };
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
        var kv = parseKV(inner, where + ' の :::' + kind, spec.order).map;
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
                /* ⚠ `series` のように **1行でも並びでもよい**キーがある（既存の3ページがそう書いている）ので、
                   「並びでしか書けない」は `listOnly` に挙げたものだけに掛ける */
                if ((spec.listOnly || []).indexOf(k) >= 0) fail(where, ':::' + kind + ' の「' + k + '」は「  - 値」の並びで書きます（1件でも）');
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
            /* ⚠ 行の出どころ。★ 短い語（「スライド」）で済ませられないよう長さを見る */
            if (b.source.length < 8) {
                fail(where, ':::table の source（この行がどこから来たか）が短すぎます: 「' + b.source + '」'
                    + '\n    ★ 手で書く表はここだけ REF5 の「行データを持たない」の外に出るので、出どころを必ず書きます');
            }
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
        DEFAULT_FENCE: DEFAULT_FENCE,
        CELL_SEP: CELL_SEP,
        FIGURE_DIR: '/reference-img/',
        parsePage: parsePage,
        serialize: serialize,
        expectedLineCount: expectedLineCount,
        normalize: normalize
    };
});
