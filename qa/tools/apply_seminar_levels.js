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
 * | 発展にしか出ない | Lv1・Lv2 | **Lv3** | 基本に一度も出ない＝Lv≥3（弱い信号） |
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
 */
'use strict';

var fs = require('fs');
var path = require('path');

var QA = path.resolve(__dirname, '..');
var LEVELS = ['基本例題', '基本問題', '発展例題', '発展問題'];
var BASIC = { '基本例題': 1, '基本問題': 1 };

var qa = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));
var known = {};
qa.patterns.forEach(function (p) { known[p.code] = p; });

// ---- セミナーの実測を集める ----
// ⚠ 材料は **qa/data/ ではなくリポジトリの外**（公開しないため。source_paths.js に理由）
var SRC = require('./source_paths');
var files = SRC.list(/^seminar_map_ch\d+\.jsonl$/);
if (!files.length) { console.log('セミナーの対応表がまだ無い。\n' + SRC.missingMessage()); process.exit(0); }

var seen = {};   // code -> { basic, adv, span（またがりの最小値）, where }
files.forEach(function (f) {
  fs.readFileSync(SRC.at(f), 'utf8').split(/\r?\n/)
    .filter(function (l) { return l.trim(); }).map(JSON.parse)
    .forEach(function (o) {
      (o.codes || []).forEach(function (c) {
        var s = seen[c] || (seen[c] = { basic: false, adv: false, span: 99, where: {} });
        s.where[o.level] = true;
        if (BASIC[o.level]) {
          s.basic = true;
          // 基本での「またがり」だけを見る（下げの根拠になるのは基本側の出題）
          if (o.codes.length < s.span) s.span = o.codes.length;
        } else s.adv = true;
      });
    });
});

// ---- 変更案 ----
var down = [], up = [];
Object.keys(seen).sort().forEach(function (c) {
  var p = known[c];
  if (!p) return;                          // verify_seminar_map.js が鳴らす
  var lv = p.difficulty || 1;
  var s = seen[c];
  var where = LEVELS.filter(function (L) { return s.where[L]; }).join('+');
  if (s.basic && lv >= 3) {
    down.push({ code: c, from: lv, to: 2, span: s.span, where: where, unit: p.unit });
  } else if (!s.basic && s.adv && lv <= 2) {
    up.push({ code: c, from: lv, to: 3, span: null, where: where, unit: p.unit });
  }
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
