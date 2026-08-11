// 確度の付いた項目（clue 単元）を、根拠つきの一覧にして CERTAINTY_LEDGER.md に書き出す。
//
//   node qa/tools/gen_certainty_ledger.js          … 差分があるかだけ見る
//   node qa/tools/gen_certainty_ledger.js --write  … 書き出す
//
// ⚠ **手で書かない。** questions.json の certainty / basis が正で、この表はその写し。
// 一覧を手書きにすると、項目を足したときに片方だけ直って**書いてあることと配るものがずれる**。
// ずれていないかは qa/test.html が見る（`確度: 台帳が questions.json と一致している`）。
//
// なぜ一覧が要るか（ユーザー指摘・2026-08-12）:
// 「たぶん」「ほぼ確実」は**どこで破れるかを言えて初めて使ってよい**。
// 項目ごとの supplement には学習者向けの言い方しか書けないので、
// 作問側が見る根拠は別に集めておく。
'use strict';
var fs = require('fs');
var path = require('path');

var QA = path.resolve(__dirname, '..');
var OUT = path.join(QA, 'CERTAINTY_LEDGER.md');
var qa = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));

var ORDER = ['たぶん', 'ほぼ確実', '確実'];   // 危ないものから上に置く
var items = qa.patterns.filter(function (p) { return p.certainty; });
items.sort(function (a, b) {
    var d = ORDER.indexOf(a.certainty) - ORDER.indexOf(b.certainty);
    return d || a.code.localeCompare(b.code);
});

function cell(s) { return String(s || '').replace(/\|/g, '\\|'); }

var out = [];
out.push('# 確度の付いた項目の一覧（根拠つき）');
out.push('');
out.push('`clue` 単元（手がかりから物質に当たりを付ける）の全項目を、**危ないものから順に**並べたもの。');
out.push('確度の定義は [TAXONOMY.md §2.8](TAXONOMY.md)、教科書の単純化そのものの目録は');
out.push('[KNOWLEDGE_CAVEATS.md](KNOWLEDGE_CAVEATS.md) が持つ（あちらは知識の正しさ、こちらは当て方の効き）。');
out.push('');
out.push('⚠ **このファイルは `qa/tools/gen_certainty_ledger.js` が生成する。** 手で直さない。');
out.push('直すのは `questions.json` の `certainty` / `basis` のほうで、ずれると回帰テストが鳴る。');
out.push('');
out.push('⚠ **「たぶん」「ほぼ確実」は、どこで破れるかを言えて初めて使ってよい。**');
out.push('破れる条件が書けない当て方は、項目にしない。');
out.push('');

ORDER.forEach(function (level) {
    var rows = items.filter(function (p) { return p.certainty === level; });
    if (!rows.length) return;
    var def = (qa.meta.certainty || {})[level] || '';
    out.push('## ' + level + '（' + rows.length + '件）');
    out.push('');
    out.push('> ' + def);
    out.push('');
    out.push('| コード | 何から何を当てるか | そう言える根拠 / どこで破れるか |');
    out.push('|---|---|---|');
    rows.forEach(function (p) {
        out.push('| `' + p.code + '` | ' + cell(p.knowledge) + ' | ' + cell(p.basis) + ' |');
    });
    out.push('');
});

out.push('---');
out.push('');
out.push('生成元: `qa/questions.json`（' + items.length + '件）／ 生成器: `qa/tools/gen_certainty_ledger.js`');
out.push('');

var text = out.join('\n');
var now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (now === text) { console.log('変わりなし（' + items.length + '件）'); process.exit(0); }
if (!process.argv.includes('--write')) {
    console.log('差分あり（' + items.length + '件）。--write で書き出す');
    process.exit(1);
}
fs.writeFileSync(OUT, text);
console.log('→ ' + OUT + '（' + items.length + '件）');
