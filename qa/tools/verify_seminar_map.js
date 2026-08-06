#!/usr/bin/env node
/**
 * qa/data/seminar_map_chNN.jsonl の機械検査と、現行 difficulty との食い違い一覧。
 *
 *   node qa/tools/verify_seminar_map.js
 *
 * DESIGN_difficulty_frequency.md §5 第1段の 3.（食い違いを一覧にする）を担う道具。
 * 章ファイルは glob で拾うので、章が増えても手を入れなくてよい
 * （逆に「新しい章を検査対象に入れ忘れる」事故が起きない。ここが tests.js より確かな点）。
 *
 * 検査は2段。
 *   ハード（落とす）… JSON として読めない／コードが実在しない／level が語彙外／
 *                      問題番号の重複／同一行内のコード重複／chapter がファイル名と不一致
 *   ソフト（報告のみ）… 現行 Lv とセミナー由来の期待値の食い違い。
 *                      これは「直すべき誤り」ではなく**レビューの入口**なので落とさない。
 *
 * ## 判定の向き（21章の実データで初期案を作り直した・2026-08-06）
 *
 * §3-2 の初期案は4区分を Lv1〜4 に一列に並べていたが、**両側検定にすると壊れる**。
 * 「基本問題に出た」から Lv2 だとは言えない ＝ Lv1 の基礎事実は基本にも発展にも出る。
 * 出題は**上限しか語らない**（「遅くともこの区分までに要る知識」）。
 *
 * さらに **例題／問題の別は難易度ではなく役割の別**（解法提示か演習か）だった。
 * 21章で初出区分ごとに現行 Lv を集計すると、基本例題 {Lv1:3, Lv2:5, Lv3:1} と
 * 基本問題 {Lv1:5, Lv2:13, Lv3:1, Lv4:1} がほぼ同じ分布になる。
 * とくに「基本例題44」は7コードにまたがる総まとめ例題で、Lv1（生存）ではありえない。
 * → **セミナーの解像度は 基本／発展 の2値**として扱う（未決事項2 の答え）。
 *
 * したがって:
 *   基本（例題・問題）に出る          → Lv ≤ 2 を期待（強い信号）。Lv3/4 なら **下げ候補**
 *   基本に一度も出ず発展にだけ出る    → Lv ≥ 3 を期待（弱い信号）。Lv1/2 なら **上げ候補**
 *   未登場                            → **判断材料にしない**（下の注記）
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DATA = path.join(ROOT, 'data');
var LEVELS = ['基本例題', '基本問題', '発展例題', '発展問題'];
var BASIC = { '基本例題': 1, '基本問題': 1 };

var hard = [];
function fail(msg) { hard.push(msg); }

// ---- 知識項目コードの台帳 ----
var Q = JSON.parse(fs.readFileSync(path.join(ROOT, 'questions.json'), 'utf8'));
var known = {};
Q.patterns.forEach(function (p) { known[p.code] = p; });

// ---- 章ファイルを集める ----
var files = fs.readdirSync(DATA)
  .filter(function (f) { return /^seminar_map_ch\d+\.jsonl$/.test(f); })
  .sort();

if (files.length === 0) {
  console.log('seminar_map_chNN.jsonl が qa/data/ に1つもない。まだ着手前。');
  process.exit(0);
}

var rows = [];
files.forEach(function (f) {
  var chFromName = Number(f.match(/ch(\d+)/)[1]);
  var text = fs.readFileSync(path.join(DATA, f), 'utf8');
  var seenItem = {};
  text.split(/\r?\n/).forEach(function (line, i) {
    if (!line.trim()) return;
    var o;
    try { o = JSON.parse(line); }
    catch (e) { fail(f + ':' + (i + 1) + ' JSON として読めない: ' + e.message); return; }

    if (LEVELS.indexOf(o.level) < 0) fail(f + ' 問' + o.item + ': level が語彙外「' + o.level + '」');
    if (o.chapter !== chFromName) fail(f + ' 問' + o.item + ': chapter=' + o.chapter + ' がファイル名(ch' + chFromName + ')と違う');

    var key = String(o.item);
    if (seenItem[key]) fail(f + ': 問題番号 ' + key + ' が重複');
    seenItem[key] = true;

    var inRow = {};
    (o.codes || []).forEach(function (c) {
      if (!known[c]) fail(f + ' 問' + o.item + ': 実在しないコード ' + c);
      if (inRow[c]) fail(f + ' 問' + o.item + ': 同一行内でコード重複 ' + c);
      inRow[c] = true;
    });
    rows.push(o);
  });
});

// ---- 集計: コードごとに「基本に出たか」「発展に出たか」 ----
var seen = {};   // code -> { basic: bool, adv: bool, at: {level: true} }
rows.forEach(function (o) {
  (o.codes || []).forEach(function (c) {
    var s = seen[c] || (seen[c] = { basic: false, adv: false, at: {} });
    s.at[o.level] = true;
    if (BASIC[o.level]) s.basic = true; else s.adv = true;
  });
});

var chapters = files.map(function (f) { return Number(f.match(/ch(\d+)/)[1]); });
console.log('章 ' + chapters.join(', ') + ' ／ ' + rows.length + '問 ／ 参照コード ' + Object.keys(seen).length + '種');
console.log('ハードエラー ' + hard.length + '件');
hard.forEach(function (m) { console.log('  x ' + m); });

// ---- ソフト: 食い違い一覧 ----
var down = [], up = [];
Object.keys(seen).sort().forEach(function (c) {
  if (!known[c]) return;                   // ハード側で既に報告済み
  var lv = known[c].difficulty || 1;
  var s = seen[c];
  var where = Object.keys(s.at).join('+');
  if (s.basic && lv >= 3) down.push('  Lv' + lv + ' → 1〜2?  ' + c + '（' + where + '）');
  if (!s.basic && s.adv && lv <= 2) up.push('  Lv' + lv + ' → 3〜4?  ' + c + '（' + where + '）');
});

var n = Object.keys(seen).length;
console.log('\n--- 基本に出るのに Lv3以上（下げ候補 ' + down.length + '件）---');
down.forEach(function (s) { console.log(s); });
console.log('--- 発展にしか出ないのに Lv2以下（上げ候補 ' + up.length + '件）---');
up.forEach(function (s) { console.log(s); });
console.log('  食い違い ' + (down.length + up.length) + ' / ' + n + '種 = ' +
  Math.round((down.length + up.length) / n * 100) + '%');

// ---- ソフト: 未登場 ----
// **未登場は Lv4 の証拠にならない。** セミナーは要項（まとめ）に書いた事実を問題にしないので、
// Lv1 の基礎事実がそのまま落ちる（21章では Lv1 の18項目中10項目が未登場だった）。
// 「傍用にすら無い」と「要項にあるが問題にならない」の区別には入試側のデータが要る。
var covered = Object.keys(seen);
var unseen = Q.patterns.filter(function (p) { return covered.indexOf(p.code) < 0; });
var byLv = {};
unseen.forEach(function (p) { var lv = p.difficulty || 1; byLv[lv] = (byLv[lv] || 0) + 1; });
console.log('\n--- 未登場 ' + unseen.length + ' / ' + Q.patterns.length + ' 項目（Lv別 ' + JSON.stringify(byLv) + '）');
console.log('    ※未登場は Lv4 の根拠にならない（要項に書いてあり問題にならない基礎事実が落ちる）。');
console.log('    ※8章そろうまで一覧の意味が確定しない（命名・異性体は20章に集まる）。');

process.exit(hard.length ? 1 : 0);
