#!/usr/bin/env node
/**
 * 「問い＋選択肢1個」の組を書き出す（REVIEW_CRITERIA.md C17・2026-09-15）。
 *
 *   node qa/tools/pair_review.js                          … 全 choice の組を標準出力へ
 *   node qa/tools/pair_review.js --unit sugar             … 単元で絞る（カンマ区切りで複数可）
 *   node qa/tools/pair_review.js --code org.bio.invert    … コードの前方一致で絞る（カンマ区切りで複数可）
 *   node qa/tools/pair_review.js --flagged                … 機械の検査（tests.js）に引っかかった組だけ
 *   node qa/tools/pair_review.js --unit sugar --out x.md  … ファイルに書き出す
 *   node qa/tools/pair_review.js --count                  … 単元ごとの組の数だけ
 *
 * ## なぜ要るか
 *
 * 選択肢は画面で**毎回並べ替えられ**、学習者は「問い＋その肢」を1つずつ真偽判定する。
 * ところが作問は**選択肢を並びごと読んで**書くので、
 * 「この混合物を転化糖という」（混合物は別の肢）や「生成物はどちらも…」（2つは別の肢）のように、
 * **並びの中でしか意味が決まらない肢**ができる。並びを見ている限り、書いた人には見えない。
 * → **組を1件ずつ切り離して**、並びを見ずに読める形にするのがこの道具の仕事。
 *
 * ## 読み方（C17 の4観点）
 *
 * その組だけを読んで ① 何を問われているか分かる ② 肢が問いへの答えの形になっている
 * ③ ほかの肢を見ないと意味が決まらない語が無い ④ いつ・どの段階・どの物質の話か分かる。
 * **一度に大量に読まない**（単元ごとに `--unit` で切る）。
 *
 * ## 機械の印
 *
 * 行頭の `⚑` は tests.js の `pairContextHits`（指示語・「〜ときについて」「〜ときの話として」）が拾ったもの。
 * `⚑済` は PAIR_CONTEXT_KNOWN で名指しされている既知の件。
 * **印が無いことは「読めた」ことではない** —— 軸のずれ・段階の抜けは機械に見えない。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var QA = path.resolve(__dirname, '..');
var D = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));
var T = require(path.join(QA, 'tests.js'));

function arg(name) {
  var i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function list(s) { return s ? s.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null; }

var units = list(arg('--unit'));
var codes = list(arg('--code'));
var flaggedOnly = process.argv.indexOf('--flagged') >= 0;
var out = arg('--out');

var hits = {};
T.pairContextHits(D.patterns).forEach(function (h) { (hits[h.key] = hits[h.key] || []).push(h.why); });

var targets = D.patterns.filter(function (p) {
  if (units && units.indexOf(p.unit) < 0) return false;
  if (codes && !codes.some(function (c) { return p.code.indexOf(c) === 0; })) return false;
  return true;
});

if (process.argv.indexOf('--count') >= 0) {
  var cnt = {};
  targets.forEach(function (p) {
    p.variants.filter(function (v) { return v.mode === 'choice'; }).forEach(function (v) {
      cnt[p.unit] = (cnt[p.unit] || 0) + v.options.length;
    });
  });
  Object.keys(cnt).forEach(function (u) { console.log(u + '\t' + cnt[u]); });
  process.exit(0);
}

function mark(key) {
  if (!hits[key]) return '';
  return (T.PAIR_CONTEXT_KNOWN[key] ? '⚑済 ' : '⚑ ') + hits[key].join('／') + '\n';
}

var lines = [];
var nPairs = 0;
targets.forEach(function (p) {
  p.variants.filter(function (v) { return v.mode === 'choice'; }).forEach(function (v) {
    var block = [];
    v.options.forEach(function (o, i) {
      var key = p.code + '#' + i;
      if (flaggedOnly && !hits[key] && !hits[p.code + '#q']) return;
      var ok = v.correct.indexOf(i) >= 0 ? '○' : '×';
      block.push(mark(key) + '[' + p.code + ' #' + i + ' ' + ok + '] ' + v.q + ' ／ ' + o);
      nPairs++;
    });
    if (!block.length) return;
    var qm = mark(p.code + '#q');
    lines.push('## ' + p.code + '（' + p.unit + '）' + (qm ? '\n' + qm.trim() : ''));
    lines.push(block.join('\n'));
    lines.push('');
  });
});
lines.push('（組 ' + nPairs + ' 件）');

var text = lines.join('\n') + '\n';
if (out) {
  fs.writeFileSync(out, text, 'utf8');
  console.log('→ ' + out + ' に ' + nPairs + ' 組を書き出した');
} else {
  process.stdout.write(text);
}
