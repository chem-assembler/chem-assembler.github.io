/**
 * ★★ 原稿（`reference-src/*.md`）の**表記を機械で揃える**（REFBOOK_STYLE.md §3）。
 *
 * 発端はユーザーの申し立て:
 *   > **全角半角とか、書式の統一とかもこちらではやりづらいです**
 *
 * ★ **手で揃えさせない。** ②の原稿は「書式は気にしない」で書いてよい約束（§1）なので、
 *   ③で機械が揃える。⚠⚠ **黙って揃えない** —— 直した所は1件ずつ数え上げて返し、
 *   呼び手（`gen-reference.mjs --tidy`）が画面に出す（§1「勝手に揃えたものは見せる」）。
 *
 * ⚠⚠ **ここでやってよいのは「元に戻せる表記の直し」だけ。**
 *   ⛔ **意味を決める直しはしない** —— 素の1行を見出しに格上げする（§20-8）、
 *      段落を割る、言い回しを変える、は**書いた人にしか決められない**。
 *   ★ 迷ったら「同じ文を2人が別々に直したとき、同じ結果になるか」で判じる。
 *
 * ⚠ **`//` の著者メモの中は触らない**（メモは原稿ではなく注文）。
 * ⚠ **前書き（`---` の囲み）の中も触る** —— `summary` や `title` にも全角数字は混ざる。
 *   ただし `id` / `codes` / `source` の行は**識別子**なので触らない。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ReferenceTidy = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* 触らない前書きのキー（識別子・機械が引く値） */
    var FRONT_KEEP = /^\s*(id|codes|source|video|unit)\s*:/;
    /* 囲みの中の、触らない行（表の出どころ・図のファイル名・リンクの行き先・ステージ id） */
    var FENCE_KEEP = /^\s*(source|src|promptSrc|answerSrc|stageId|to|open|formula|anchor|align|variant|series)\s*:/;

    var SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

    /* ★ 揃えるもの。⚠ **1つずつ名前を持たせる**（報告の欄に出る名前がそのままここに在る） */
    var RULES = [
        {
            name: '全角の英数字を半角に',
            apply: function (s) {
                return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
                    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
                });
            }
        },
        {
            name: '読点・句点を「、」「。」に',
            apply: function (s) { return s.replace(/，/g, '、').replace(/．/g, '。'); }
        },
        {
            name: '番号のあとに空白を入れる',
            /* `3.側鎖が` → `3. 側鎖が`。⚠ 小数（`2.5`）に当たらないよう、次が数字なら触らない */
            apply: function (s) { return s.replace(/^(\s*)(\d+)\.(?=[^\s\d])/, '$1$2. '); }
        },
        {
            name: '結合の線を「−」（U+2212）に',
            /* ⚠ **原子・原子団に付く手だけ。** 名称のハイフン（`2-メチルブタン`・`-ane`・`sec-ブチル`）は
               次が大文字の元素記号でないので当たらない ＝ **触らない**のが仕様。 */
            apply: function (s) {
                return s.replace(/-(?=[A-Z][a-z]?(?:[0-9₀-₉]|[A-Z]|\b|-))/g, '−')
                    .replace(/([A-Z][a-z]?[0-9₀-₉]*)-(?=[\s。、）)」]|$)/g, '$1−');
            }
        },
        {
            name: '分子式の数字を下付きに',
            /* ⚠⚠ **当てる範囲を絞る。** 元素記号が2つ以上並ぶ token（`CH4`・`C2H6O`・`H2SO4`）と、
               手が付いた原子団（`−NO2`・`−SO3H`）だけ。
               ★ `C1〜C10`・`C5 からは`・`s4`・`2-メチル` のような**1つだけの token には当てない**
                 —— 既存の本文がそう書いており、直すと「表記を揃えた」ではなく「本文を変えた」になる。
               ⚠ 一般式（`C~n~H~2n+2~`）は `~` で囲まれているので、この規則の前に伏せる。 */
            apply: function (s) {
                return s.replace(/(^|[\s（(「『、。−\-＋+])((?:[A-Z][a-z]?[0-9]*){2,})(?![a-zA-Z0-9])/g,
                    function (all, lead, tok) {
                        if (!/[0-9]/.test(tok)) return all;
                        return lead + tok.replace(/[0-9]/g, function (d) { return SUB[d]; });
                    });
            }
        },
        {
            name: '行末の余分な空白を落とす',
            apply: function (s) { return s.replace(/[ \t　]+$/, ''); }
        }
    ];

    /* 一般式の `~…~` と著者メモ `//…` を伏せて、規則が当たらないようにする */
    function shield(line) {
        var kept = [];
        var masked = line.replace(/~[^~]+~|\/\/.*$/g, function (m) {
            kept.push(m);
            return '' + (kept.length - 1) + '';
        });
        return {
            masked: masked,
            unshield: function (s) {
                return s.replace(/(\d+)/g, function (all, i) { return kept[+i]; });
            }
        };
    }

    /**
     * 原稿1枚を揃える。
     * @returns {{text:string, changes:Array<{line:number, rule:string, before:string, after:string}>}}
     */
    function tidy(text) {
        var eol = /\r\n/.test(text) ? '\r\n' : '\n';
        var lines = String(text).replace(/\r\n/g, '\n').split('\n');
        var changes = [];
        var inFront = false, frontDone = false, fenceDepth = 0;

        var out = lines.map(function (line, i) {
            if (i === 0 && line.trim() === '---') { inFront = true; return line; }
            if (inFront && line.trim() === '---') { inFront = false; frontDone = true; return line; }
            if (!inFront && frontDone) {
                if (/^:::/.test(line)) fenceDepth = /:::\s*$/.test(line.replace(/^:::[A-Za-z0-9]*/, '')) ? 0 : 1;
                else if (line.trim() === ':::') fenceDepth = 0;
            }
            if (inFront && FRONT_KEEP.test(line)) return line;
            if (fenceDepth && FENCE_KEEP.test(line)) return line;

            var sh = shield(line);
            var cur = sh.masked;
            RULES.forEach(function (r) {
                var next = r.apply(cur);
                if (next === cur) return;
                changes.push({ line: i + 1, rule: r.name, before: sh.unshield(cur), after: sh.unshield(next) });
                cur = next;
            });
            return sh.unshield(cur);
        });

        /* ★ 番号のずれ（`1. 1. 3.` → `1. 2. 3.`）。⚠ **段落として並んだ番号だけ**を見る ——
           ひとつながりの走り（あいだに在ってよいのは空行と字下げの補足だけ）で振り直す。 */
        renumber(out, changes);

        return { text: out.join(eol), changes: changes };
    }

    /* 番号つきの段落の走りを見つけて連番に直す */
    function renumber(lines, changes) {
        var run = [];
        var flush = function () {
            if (run.length >= 2) {
                run.forEach(function (r, k) {
                    if (r.num === k + 1) return;
                    var before = lines[r.i];
                    lines[r.i] = before.replace(/^(\s*)\d+\./, '$1' + (k + 1) + '.');
                    changes.push({ line: r.i + 1, rule: '番号のずれを連番に', before: before, after: lines[r.i] });
                });
            }
            run = [];
        };
        for (var i = 0; i < lines.length; i++) {
            var s = lines[i];
            if (s.trim() === '') continue;                       // 空行はまたぐ
            var m = /^(\s*)(\d+)\.\s/.exec(s);
            if (m) { run.push({ i: i, num: +m[2] }); continue; }
            if (/^[ \t　]/.test(s) && run.length) continue;      // 字下げの補足はまたぐ
            flush();
        }
        flush();
    }

    return { tidy: tidy, RULES: RULES };
}));
