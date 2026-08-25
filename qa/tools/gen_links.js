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
function entries(file, key) {
  var j = JSON.parse(fs.readFileSync(path.join(ROOT, 'assembler', file), 'utf8'));
  return (Array.isArray(j) ? j : (j[key] || [])).filter(function (x) { return x && x.name; });
}
var lib = {};
var idByName = {};   // 表示名 → 不変 ID（compounds.json のみ。stages はまだ ID を持たない）
entries('stages.json', 'stages').concat(entries('compounds.json', 'compounds'))
  .forEach(function (x) { lib[x.name] = true; if (x.id) idByName[x.name] = x.id; });

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

// `?open=isomer&formula=` で**実際に開くと確かめた**分子式。
//
// ⚠ **重原子の数で判定してはいけない。** 費用を決めているのは重原子の数ではなく
// **不飽和度**で、`C6H6` は重原子6個（assembler の上限内）なのに 2.8秒固まったうえ
// 217種 > 上限20種で断られる。`C8H18` は重原子8個でも 0.2秒/18種で通る
// （assembler レーンの実測・DEVELOPMENT.md §7-1d）。
// つまり「重原子6個まで」という上限は必要条件でしかなく、**開くかどうかの予測には使えない**。
//
// 開かない式を渡すと**トーストも出ずに何も起きない**（実機で確認: `isomerPractice.active` が
// false のまま）ので、死んだ入口を配らないよう**実機で開いた式だけを載せる**。
// 増やすときは必ず実機で確かめてからここに足す（推測で足すと押しても無反応の入口になる）。
var ISOMER_VERIFIED = {
  C4H10: '全2種', C5H12: '全3種', C4H8: '全5種', C3H8O: '全3種', C3H6O: '全9種',
  C2H4O2: '全10種（2026-08-12 実機で確認）'
};

// `open` の行き先のうち、**キャンバスの分子を見る画面**（＝分子を添えないと空振りする）。
//
// ⚠ 2026-08-21 実測: `?open=stereo` だけで飛ばすと、assembler は `btn-stereo` を押して
//   `openAuto(null)` に入り、キャンバスが空なので
//   「立体を見られる sp3炭素がありません」の**トーストが数秒出て終わる**。
//   モーダルは開かず、来た道の帯も `miss` にならない（`miss` の条件は `?summon=` が
//   付いていること ＝ 分子を頼んでいないので「出せなかった」とも言えない）。
//   **画面には何も残らない**ので、押した人には壊れているようにしか見えない。
//   `naming` / `countquiz` / `fischer` / `practice` は自前で出題するので分子は要らない。
var OPEN_NEEDS_MOLECULE = { stereo: 1, isomer: 1 };

// 今すぐ繋がるか。繋がらない理由はどれも assembler 側の整備待ち
function resolve(o) {
  if (!o || o.kind === 'none') return { on: false, why: 'none（見せないと決めた）' };
  // `practice` も分子を添えられる（`?open=stereo&summon=<id>` は assembler が受ける。
  // summon は `open` より先に処理されるので、ボタンを押す時点で分子が載っている）
  if (o.kind === 'practice' && OPEN_NEEDS_MOLECULE[o.open] && !o.name) {
    return { on: false, why: 'open=' + o.open + ' はキャンバスの分子を見る画面なのに代表分子（name）が無い' };
  }
  if (o.kind === 'summon' || o.kind === 'reaction' || (o.kind === 'practice' && o.name)) {
    var r = resolveName(o.name);
    if (!r) return { on: false, why: 'ライブラリに「' + o.name + '」が無い' };
    o._libName = r;
    o._id = idByName[r] || null;   // stages 由来の19種はまだ ID を持たない
  }
  if (o.kind === 'isomer' && !ISOMER_VERIFIED[o.formula]) {
    return { on: false, why: '?open=isomer&formula=' + o.formula + ' が実機で開くか未確認' };
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
  // **`?summon=` には ID を渡す**（2026-08-06・assembler が889件に不変 ID を振った）。
  // ID は変わらないので、相手が表示名を直しても入口が死なない。
  // ただし **stages.json 由来の19種はまだ ID を持たない**（エチレン・酢酸・フェノールなど53項目）。
  // そこは解決後のライブラリ表記を渡す ＝ 相手の別名解決に載る形にしておく。
  // ID が全件に入ったら、この分岐から name 側を落とすだけで済む
  if (o._id) link.summon = o._id;
  else if (o._libName) link.name = o._libName;
  // `scope` / `field` … クイズの出題範囲（2026-08-22・assembler v1449 の受け口⑥）。
  // 値は向こうの語彙（`basic|named|all` と分野名）で、こちらは運ぶだけ。
  // `group` … 官能基・骨格の軸（2026-08-25・assembler の E1）。**分野では絞れないもの**
  //   （エステルは脂肪族と芳香族にまたがる）のためにある。値は向こうの語彙（`ester` など）。
  // ⚠ **`link.group` と、項目そのものの `p.group`（習得マップの群）は別物**。
  //   入れ子が違うので衝突はしないが、読むときに取り違えないこと
  ['formula', 'id', 'reagent', 'open', 'scope', 'field', 'group']
    .forEach(function (k) { if (o[k]) link[k] = o[k]; });
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
