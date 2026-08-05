// questions.json の link を data/assembler_links.jsonl から生成する。
//
// 棚卸しの正は **data/assembler_links.jsonl（283行・全項目）** で、questions.json には
// **今すぐ繋がるものだけ**を書く。理由は2つ:
//   1. `kind: "none"` の 139件は理由の文章を持つ。配信データに載せても画面に出ないので重い
//   2. 指す先がライブラリに無い summon を書くと、押しても「見つからない」トーストで終わる
//      ＝ 死んだ入口を配ることになる
// 「検討済みか未検討か」を数える役目は jsonl 側が持つ（DESIGN_assembler_bridge.md §4）。
//
// 使い方: node qa/tools/gen_links.js          … 何が繋がるかを表示（書き込みなし）
//         node qa/tools/gen_links.js --write  … questions.json を書き換える
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var QA = path.join(ROOT, 'qa');

var qa = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));
var links = fs.readFileSync(path.join(QA, 'data', 'assembler_links.jsonl'), 'utf8')
  .split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });

// summon が引ける母集団 = getCompoundLibrary() ＝ stages.json ＋ compounds.json（game.js:2187）
function names(file, key) {
  var j = JSON.parse(fs.readFileSync(path.join(ROOT, 'assembler', file), 'utf8'));
  var a = Array.isArray(j) ? j : (j[key] || []);
  return a.map(function (x) { return x && x.name; }).filter(Boolean);
}
var lib = {};
names('stages.json', 'stages').concat(names('compounds.json', 'compounds'))
  .forEach(function (n) { lib[n] = true; });

var byCode = {};
links.forEach(function (o) { byCode[o.code] = o; });

// ---- 名称の解決 ------------------------------------------------------
// **jsonl は「指したい分子」を素直な日本語名で持ち、assembler の現在の表記への変換は
// ここでだけ行う。** こうすると、相手が表記を変えても直すのは1箇所で済み、
// ID が入ったら「名前 → ID」に差し替えるだけで jsonl は1行も変わらない。
//
// 手で決めた対応（どの立体・どの状態を指したいかは qa 側の判断）。
// 機械に推測させると別の異性体を指しうるので表にする
var BY_HAND = {
  '鎖状グルコース':   'D-グルコース（鎖状）',
  'α-グルコース':     'α-D-グルコース（α-D-グルコピラノース）',
  '鎖状フルクトース': 'D-フルクトース（鎖状）'
};
var libNames = Object.keys(lib);
var resolveWarn = [];
function resolveName(n) {
  if (lib[n]) return n;
  if (BY_HAND[n]) {
    if (lib[BY_HAND[n]]) return BY_HAND[n];
    resolveWarn.push('手表の行き先「' + BY_HAND[n] + '」がライブラリに無い（相手が表記を変えた？）');
    return null;
  }
  // 「エチレン」→「エチレン（エテン）」型。別名を抱き込んだ表記に完全一致が阻まれているだけ。
  // 一意に決まるときだけ採る（複数当たるなら推測しない）
  var cand = libNames.filter(function (L) { return L.indexOf(n + '（') === 0; });
  if (cand.length === 1) return cand[0];
  if (cand.length > 1) resolveWarn.push('「' + n + '」の別名候補が複数: ' + cand.join(' / '));
  return null;
}

// 今すぐ繋がるか。繋がらない理由は3種あり、どれも assembler 側の整備待ち
function resolve(o) {
  if (!o || o.kind === 'none') return { on: false, why: 'none（見せないと決めた）' };
  if (o.kind === 'summon' || o.kind === 'reaction') {
    var r = resolveName(o.name);
    if (!r) return { on: false, why: 'ライブラリに「' + o.name + '」が無い' };
    o._libName = r;
  }
  if (o.kind === 'isomer') {
    // ?open=isomer は分子式の受け口が未整備。キャンバスが空のまま開くと調べようがない
    return { on: false, why: '?open=isomer&formula= の受け口が未整備' };
  }
  return { on: true };
}

// URL は app.js の linkHtml() が kind から組む。ここでクエリを持たせると
// 同じ規約が2箇所に散り、片方だけ直したときに黙ってずれる
var on = 0, off = {};
qa.patterns.forEach(function (p) {
  var o = byCode[p.code];
  if (!o) { console.log('! ' + p.code + ': 棚卸しに行が無い'); return; }
  var r = resolve(o);
  if (!r.on) {
    delete p.link;
    off[r.why] = (off[r.why] || 0) + 1;
    return;
  }
  var link = { kind: o.kind, label: o.label };
  // name は**解決後のライブラリ表記**を入れる（実際に URL に載る文字列と一致させる。
  // これで test.html の「link.name がライブラリに実在するか」が意味を持つ）。
  // 「指したい分子」の素直な名前は jsonl 側が持っている
  if (o._libName) link.name = o._libName;
  ['formula', 'id', 'reagent', 'open'].forEach(function (k) { if (o[k]) link[k] = o[k]; });
  p.link = link;
  on++;
});

var byKind = {};
qa.patterns.forEach(function (p) { if (p.link) byKind[p.link.kind] = (byKind[p.link.kind] || 0) + 1; });

console.log('繋いだ: ' + on + ' / ' + qa.patterns.length + ' 項目');
Object.keys(byKind).sort().forEach(function (k) { console.log('  ' + k.padEnd(10) + byKind[k]); });
var renamed = links.filter(function (o) { return o._libName && o._libName !== o.name; });
if (renamed.length) {
  console.log('\n表記を解決した（jsonl の名前 → ライブラリの表記）:');
  var uniq = {};
  renamed.forEach(function (o) { uniq[o.name] = o._libName; });
  Object.keys(uniq).forEach(function (n) { console.log('  ' + n + ' → ' + uniq[n]); });
}
if (resolveWarn.length) {
  console.log('\n! 解決できなかった:');
  resolveWarn.filter(function (m, i, a) { return a.indexOf(m) === i; })
    .forEach(function (m) { console.log('  ! ' + m); });
}
console.log('\n繋がなかった理由:');
Object.keys(off).sort(function (a, b) { return off[b] - off[a]; })
  .forEach(function (w) { console.log('  ' + String(off[w]).padStart(4) + '  ' + w); });

if (process.argv.indexOf('--write') >= 0) {
  fs.writeFileSync(path.join(QA, 'questions.json'), JSON.stringify(qa, null, 2) + '\n', 'utf8');
  console.log('\n→ qa/questions.json を書き換えた');
} else {
  console.log('\n（--write を付けると questions.json を書き換える）');
}
