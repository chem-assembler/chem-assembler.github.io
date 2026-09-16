#!/usr/bin/env node
/**
 * セミナーの実測から `questions.json` の `difficulty` を補正する。
 *
 *   node qa/tools/apply_seminar_levels.js           … 変更案を出す（書き込みなし）
 *   node qa/tools/apply_seminar_levels.js --write    … questions.json を書き換える
 *
 * ## なぜ要るか（DESIGN_difficulty_frequency.md §3-5）
 *
 * Lv に**起草順の水増し**があった。平均 Lv が「実際の難しさ」ではなく「いつ書いたか」と
 * 相関し、後から量産した単元が重くなっていた。セミナーの実測で食い違いを見ると:
 *
 *   下げ候補 40件 : 上げ候補 4件 ＝ **10 : 1**
 *
 * **雑音なら上下が釣り合う。10:1 の偏りは偏り（水増し）の印。**
 *
 * ## 単元まるごとの一律オフセットにはしない
 *
 * §3-5 では「単元ごとの一括補正」と書いたが、**項目ごとの実測があるのだから項目ごとに直す**。
 * 一律に引くと、正しく Lv3 な項目まで動く。
 *
 * ## 動かす向きと行き先
 *
 * | 実測 | 現行 | 変更後 | 根拠 |
 * |---|---|---|---|
 * | 基本（例題・問題）に出る | Lv3・Lv4 | **Lv2** | 出題は上限を語る（§3-2）。基本に出る＝Lv≤2 |
 * | 発展にしか出ない（プロセスにも出ない） | Lv1・Lv2 | **Lv3** | 基本に一度も出ない＝Lv≥3（弱い信号） |
 * | 未測定 | — | **動かさない** | 根拠が無い。同じ水増しを持つ可能性は高いが推測で動かさない |
 *
 * **Lv1 には落とさない。** セミナーは基本例題と基本問題を区別できない（§3-3 b）ので
 * 「Lv1 か 2 か」は決められない。Lv1「生存」は真に落とせない最低限に取っておく。
 *
 * ## 限界（読む人が知っておくべきこと）
 *
 * 対応づけは**多対多**なので、「基本問題に出た」は
 * **その問題が基本だった**ことしか言わない —— 6コードにまたがる問題の1つなら、
 * その知識自体が基本とは限らない。だから **1件ずつ人が見る**前提で表を出す。
 * `またがり` 欄が小さい（2〜3）ほど信号が強い。
 *
 * ## ⚠ ユーザーの上書きは動かさない（2026-09-17）
 *
 * 規則は `level_rules.js` の `seminarRule`、上書きは `data/level_matrix.jsonl` の `override` 欄。
 * 上書きのある項目は、規則が何と言っても上書きの値のまま（`finalLv` の関所）。
 * 否定対照は `QA_LEVEL_MATRIX=<上書きを消した写し> node qa/tools/apply_seminar_levels.js`。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var QA = path.resolve(__dirname, '..');

var qa = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));
var known = {};
qa.patterns.forEach(function (p) { known[p.code] = p; });

// ---- セミナーの実測を集める ----
// ⚠ 材料は **qa/data/ ではなくリポジトリの外**（公開しないため。source_paths.js に理由）
// ⚠ プロセスも読む（2026-09-17）。読まないと「プロセスに出るが問題では発展にだけ出る」項目を
//   Lv1 → 3 に上げる案を出す（level_rules.js の seminarRule に理由）
var SRC = require('./source_paths');
var RULES = require('./level_rules');
var MATRIX = require('./level_matrix');
var seenMap = MATRIX.readSeminarFlags();
if (!seenMap) { console.log('セミナーの対応表がまだ無い。\n' + SRC.missingMessage()); process.exit(0); }

// ★ ユーザーの上書き（data/level_matrix.jsonl の override 欄）。**上書きのある項目は動かさない**
var overrides = MATRIX.readOverrides();

// ---- 変更案 ----
var down = [], up = [], kept = [];
Array.from(seenMap.keys()).sort().forEach(function (c) {
  var p = known[c];
  if (!p) return;                          // verify_seminar_map.js が鳴らす
  var lv = p.difficulty || 1;
  var s = seenMap.get(c);
  var machine = RULES.seminarRule(lv, s.seminarMap, s.process);
  var to = RULES.finalLv(machine, overrides.get(c));
  if (machine !== lv && to !== machine) {
    kept.push({ code: c, from: lv, machine: machine, to: to, o: overrides.get(c) });
  }
  if (to === lv) return;
  if (to < lv) down.push({ code: c, from: lv, to: to, span: s.span, where: s.whereText, unit: p.unit });
  else up.push({ code: c, from: lv, to: to, span: null, where: s.whereText, unit: p.unit });
});

function show(title, rows) {
  console.log('\n' + title + '（' + rows.length + '件）');
  if (!rows.length) return;
  console.log('  Lv        またがり  単元        コード                              セミナーでの登場');
  rows.sort(function (a, b) { return (a.span || 9) - (b.span || 9); }).forEach(function (r) {
    console.log('  ' + (r.from + '→' + r.to).padEnd(9) +
      String(r.span === null ? '-' : r.span).padStart(5) + '     ' +
      r.unit.padEnd(10) + r.code.padEnd(36) + r.where);
  });
}
show('▼ 下げ（基本に出るのに Lv3以上）', down);
show('▲ 上げ（発展にしか出ないのに Lv2以下）', up);

console.log('\n■ ユーザーの上書きで据え置き（' + kept.length + '件・data/level_matrix.jsonl の override）');
kept.forEach(function (k) {
  console.log('  Lv' + k.from + '（規則なら ' + k.machine + '）  ' + k.code.padEnd(36) +
    k.o.date + ' ' + k.o.reason);
});

// 単元ごとの平均 Lv がどう動くか（水増しが取れたかを見る）
var before = {}, after = {};
qa.patterns.forEach(function (p) {
  var u = before[p.unit] || (before[p.unit] = { s: 0, n: 0 });
  u.s += (p.difficulty || 1); u.n++;
});
var newLv = {};
down.concat(up).forEach(function (r) { newLv[r.code] = r.to; });
qa.patterns.forEach(function (p) {
  var u = after[p.unit] || (after[p.unit] = { s: 0, n: 0 });
  u.s += (newLv[p.code] || p.difficulty || 1); u.n++;
});
console.log('\n単元ごとの平均 Lv（水増しが取れたか）');
Object.keys(before).forEach(function (k) {
  var b = (before[k].s / before[k].n), a = (after[k].s / after[k].n);
  console.log('  ' + k.padEnd(10) + b.toFixed(2) + ' → ' + a.toFixed(2) +
    (Math.abs(a - b) > 0.005 ? '  (' + (a - b > 0 ? '+' : '') + (a - b).toFixed(2) + ')' : ''));
});

console.log('\n合計 ' + (down.length + up.length) + ' 件（下げ ' + down.length + ' / 上げ ' + up.length + '）' +
  '。**未測定の項目は動かさない**（根拠が無い）');

if (process.argv.indexOf('--write') >= 0) {
  qa.patterns.forEach(function (p) {
    if (newLv[p.code]) p.difficulty = newLv[p.code];
  });
  fs.writeFileSync(path.join(QA, 'questions.json'), JSON.stringify(qa, null, 2) + '\n', 'utf8');
  console.log('\n→ qa/questions.json の difficulty を書き換えた');
} else {
  console.log('\n（--write を付けると questions.json を書き換える）');
}
