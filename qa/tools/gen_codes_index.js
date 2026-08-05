// 知識項目コードの一覧（283項目）を Markdown で書き出す。
//
// **外部に対応づけを頼むときの受け渡し物**。問題集の難易度区分や入試の出題頻度を
// 誰か（人でも Gemini でも）に対応づけてもらうには、まず「何に対応づけるのか」の
// 一覧が要る。コードは一度振ったら変えない主キーなので、対応表をコードで書いておけば
// 作問側が問いを書き直しても表は壊れない（DESIGN_difficulty_frequency.md §4）。
//
// 使い方: node qa/tools/gen_codes_index.js --write
'use strict';
var fs = require('fs');
var path = require('path');

var QA = path.resolve(__dirname, '..');
var d = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));

var L = [];
L.push('# 知識項目コード一覧（' + d.patterns.length + '項目・突き合わせ用）');
L.push('');
L.push('`qa/questions.json` から機械生成（`node qa/tools/gen_codes_index.js --write`）。**手で編集しない。**');
L.push('');
L.push('外部に問題集や入試問題との対応づけを頼むとき、この一覧を渡す。');
L.push('コードは**一度振ったら変えない主キー**なので、対応表をコードで書けば作問側の書き直しに影響されない。');
L.push('');
L.push('Lv は現在の割り当て（1 生存 / 2 標準 / 3 受験標準 / 4 難関）。');
L.push('**これ自体が検証の対象**なので、対応づけの根拠にはしない（`DESIGN_difficulty_frequency.md` §3-2）。');
L.push('');

d.units.forEach(function (u) {
  var ps = d.patterns.filter(function (p) { return p.unit === u.id; });
  L.push('## ' + u.name + '（`' + u.id + '`・' + ps.length + '項目）');
  L.push('');
  L.push('| コード | Lv | 小項目 | 知識 |');
  L.push('|---|:--:|---|---|');
  ps.forEach(function (p) {
    var k = String(p.knowledge || '').replace(/\|/g, '\\|');
    if (k.length > 96) k = k.slice(0, 96) + '…';
    L.push('| `' + p.code + '` | ' + p.difficulty + ' | ' + (p.group || '') + ' | ' + k + ' |');
  });
  L.push('');
});

var out = L.join('\n') + '\n';
if (process.argv.indexOf('--write') >= 0) {
  fs.mkdirSync(path.join(QA, 'data'), { recursive: true });
  fs.writeFileSync(path.join(QA, 'data', 'codes_index.md'), out, 'utf8');
  console.log('→ qa/data/codes_index.md（' + d.patterns.length + '項目 / ' + L.length + '行）');
} else {
  console.log('全 ' + d.patterns.length + ' 項目 / ' + L.length + ' 行（--write で書き出す）');
}
