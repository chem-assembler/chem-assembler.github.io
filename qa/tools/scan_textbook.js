#!/usr/bin/env node
/**
 * 教科書の PDF から「本文にあるか・発展欄にあるか」を数える。
 *
 *   node qa/tools/scan_textbook.js                       … 既定のフォルダを見る
 *   node qa/tools/scan_textbook.js "D:/別の/教科書"       … 場所を指定
 *
 * 出力は `qa/data/textbook_scope.md`（発展欄の一覧 ＋ 語ごとの本文/発展の別）。
 *
 * ## なぜ要るか
 *
 * `KNOWLEDGE_CAVEATS.md` は「教科書が扱わないこと」を集めた台帳だが、**扱わないの中身が3通り**ある:
 *
 *   1. 本文にある            … どの生徒も習っている。前提にしてよい
 *   2. 発展欄（PLUS）にある  … 載ってはいるが本文ではない。読んだ生徒と読んでいない生徒がいる
 *   3. どこにも無い          … この教科書には無い（他社の本文にある可能性は残る）
 *
 * この3つは **Lv を決める材料の1つ**（2026-08-08 ユーザー決定）。
 * ⚠ **Lv に直結させない。** 「リード文で与えられるか・前提にされるか」は大学と問題で変わるので、
 * 出題のされ方は**問題の属性であって知識項目の属性ではない**（KNOWLEDGE_CAVEATS J-1 の訂正）。
 * ⚠ **公平性の観点では使わない。** 教科書に無くても入試には出るので、
 * 「習っていない生徒に不公平だから出題しない」という判断はこのアプリではしない。
 *
 * ## 限界（読む人が知っておくべきこと）
 *
 * - **手元にあるのは1社・新課程（R5）だけ。** だから
 *   **「本文にある」は強く言えるが、「無い」は言い切れない**（他社の本文にある可能性が残る）
 * - 発展欄の切り出しは**見出しからの行数で近似**している。PDF のテキスト抽出は段組みが崩れるので、
 *   境界は厳密ではない。**数えた結果は当たりであって証明ではない**
 * - 改訂前の教科書は手元に無い。旧課程との差は web の資料に頼る（§J の対応表）
 */
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var QA = path.resolve(__dirname, '..');
var BOOKS = process.argv[2] || 'C:/Users/maequ/マイドライブ/化学/教科書';

// 発展・コラムの見出し（この教科書は PLUS を使う。他社なら足す）
var ADV_HEAD = /^\s*(PLUS|発展|参考)\b/;
// 章・節の見出し（発展欄の終わりの目印）
var SEC_HEAD = /^\s*(\d+編|第\d+|\d+章|\d+節)/;
var ADV_SPAN = 60;   // 見出しから最大何行を発展欄とみなすか（近似）

// 調べる語。**目録と一問一答で争点になっているものだけ**を並べる。
// 「全部の語を機械で拾う」のは意味がない（本文語のほとんどは当然本文にある）
var PROBES = [
  // 官能基・異性体の呼び名（新旧が混ざりやすい）
  'ホルミル基', 'アルデヒド基', 'カルボニル基', 'ケトン基',
  'ヒドロキシ基', 'ヒドロキシル基', 'カルボキシ基', 'カルボキシル基', 'スルホ基', 'スルホン基',
  '鏡像異性体', '光学異性体',
  // 受験でよく使うが本文かどうかが怪しいもの
  '不飽和度', '配向性', 'ケト形', 'エノール形', 'ヘミアセタール', 'ひずみ',
  '核磁気共鳴', '赤外', '旋光', '双性イオン', '等電点',
  // 新課程で変わった語（無機・理論だが目録の G・H 章で扱う）
  '貴ガス', '希ガス', 'アルカリ土類金属', '遷移元素', '凝華', '昇華'
];

// ---- テキストを取り出す ----
if (!fs.existsSync(BOOKS)) {
  console.error('教科書のフォルダが無い: ' + BOOKS);
  process.exit(1);
}
var pdfs = fs.readdirSync(BOOKS).filter(function (f) { return /\.pdf$/i.test(f); }).sort();
if (!pdfs.length) { console.error('PDF が無い: ' + BOOKS); process.exit(1); }

var tmp = path.join(require('os').tmpdir(), 'qa-textbook-scan');
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });

var lines = [];      // { text, book, adv }
pdfs.forEach(function (f) {
  var out = path.join(tmp, f.replace(/\.pdf$/i, '.txt'));
  if (!fs.existsSync(out)) {
    try { cp.execFileSync('pdftotext', ['-enc', 'UTF-8', path.join(BOOKS, f), out], { stdio: 'ignore' }); }
    catch (e) { console.error('pdftotext が使えない: ' + e.message); process.exit(1); }
  }
  var text = fs.readFileSync(out, 'utf8').split(/\r?\n/);
  var advLeft = 0;
  text.forEach(function (L) {
    if (ADV_HEAD.test(L)) advLeft = ADV_SPAN;
    else if (SEC_HEAD.test(L)) advLeft = 0;
    else if (advLeft > 0) advLeft--;
    lines.push({ text: L, book: f, adv: ADV_HEAD.test(L) || advLeft > 0 });
  });
});

// ---- 発展欄の見出しを集める ----
var advHeads = lines.filter(function (l) { return ADV_HEAD.test(l.text) && l.text.trim().length > 6; })
  .map(function (l) { return { head: l.text.trim(), book: l.book }; });

// ---- 語ごとに本文/発展を数える ----
// ⚠ **併記形を別に数える。** この教科書は改訂で変わった語を「貴ガス（希ガス）」のように
// **新（旧）の形で併記する**。数だけ見ると旧用語が本文にあるように読めてしまうが、
// 実際は「新しい語を教えつつ、旧い語も見せている」状態 ＝ **生徒は両方を見ている**。
// 括弧の中に居るかどうかで分ける。
var rows = PROBES.map(function (w) {
  var body = 0, adv = 0, paren = 0;
  var re = new RegExp('[（(]\\s*' + w + '\\s*[）)]');
  lines.forEach(function (l) {
    var n = (l.text.match(new RegExp(w, 'g')) || []).length;
    if (!n) return;
    if (re.test(l.text)) paren++;
    if (l.adv) adv += n; else body += n;
  });
  var scope = body > 0 ? '本文' : (adv > 0 ? '発展のみ' : '見あたらない');
  if (paren > 0 && paren >= body + adv - paren) scope += '（併記が主）';
  return { w: w, body: body, adv: adv, paren: paren, scope: scope };
});

// ---- 書き出す ----
var md = [];
md.push('# 教科書での扱い（本文か・発展欄か）');
md.push('');
md.push('`node qa/tools/scan_textbook.js` が生成する。**手で編集しない。**');
md.push('');
md.push('材料: `' + BOOKS + '` の PDF ' + pdfs.length + '冊（' + pdfs.join(' / ') + '）。');
md.push('');
md.push('> ⚠ **1社・新課程（R5）だけ**を見ている。だから**「本文にある」は強く言えるが、');
md.push('> 「無い」は言い切れない**（他社の本文にある可能性が残る）。');
md.push('> 発展欄の切り出しは見出しからの行数による近似で、境界は厳密ではない。');
md.push('');
md.push('## 何に使うか');
md.push('');
md.push('**Lv を決める材料の1つ**にする（公平性の判断には使わない ——');
md.push('教科書に無くても入試には出るので、「習っていないから出題しない」はこのアプリの方針ではない）。');
md.push('');
md.push('| 扱い | 中身 |');
md.push('|---|---|');
md.push('| **本文** | どの生徒も習っている |');
md.push('| **発展のみ** | 載ってはいるが本文ではない。読んだ生徒と読んでいない生徒がいる |');
md.push('| **見あたらない** | この教科書には無い（他社の本文にある可能性は残る） |');
md.push('');
md.push('⚠ **Lv には直結させない**（KNOWLEDGE_CAVEATS J-1・2026-08-08 訂正）。');
md.push('scope は Lv を決める材料の1つで、主根拠はセミナーの実測（DESIGN_difficulty_frequency.md §3-2）。');
md.push('また「リード文で与えられるか・前提にされるか」は**大学と問題によって変わる**ので、');
md.push('**出題のされ方は問題の属性であって知識項目の属性ではない**（入試問題DB側に持たせる）。');
md.push('');
md.push('scope が効くのは **収録の優先度**（発展欄は入試で差がつく）と、**書き方**');
md.push('（見あたらないものは暗記させるより「与えられたとき何が言えるか」を問う）と、');
md.push('**目録の言い方**（「範囲外」と書けるのは見あたらないものだけ）。');
md.push('');
md.push('## 語ごとの扱い');
md.push('');
md.push('| 語 | 扱い | 本文 | 発展欄 | うち併記形 |');
md.push('|---|---|--:|--:|--:|');
rows.forEach(function (r) {
  md.push('| ' + r.w + ' | ' + r.scope + ' | ' + r.body + ' | ' + r.adv + ' | ' + r.paren + ' |');
});
md.push('');
md.push('## 発展欄（' + advHeads.length + '件）—— これが「発展の在庫」');
md.push('');
md.push('本文ではないが教科書に載っているもの。**Lv3 の基準になり、収録の優先度も高い**');
md.push('（入試で差がつくところなので）。');
md.push('');
advHeads.forEach(function (h) { md.push('- ' + h.head + '  <sub>' + h.book + '</sub>'); });
md.push('');

fs.writeFileSync(path.join(QA, 'data', 'textbook_scope.md'), md.join('\n') + '\n', 'utf8');

console.log('教科書 ' + pdfs.length + '冊 / 行 ' + lines.length + ' を見た');
console.log('発展欄の見出し ' + advHeads.length + '件');
console.log('');
console.log('語              扱い                  本文  発展  併記');
rows.forEach(function (r) {
  console.log('  ' + r.w.padEnd(16) + r.scope.padEnd(22) + String(r.body).padStart(4) + String(r.adv).padStart(6) + String(r.paren).padStart(6));
});
console.log('');
console.log('→ qa/data/textbook_scope.md に書き出した');
