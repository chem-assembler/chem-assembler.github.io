// 一問一答が「指したい分子・反応」と、assembler の在庫を突き合わせたレポートを作る。
//
// **assembler レーンへの受け渡し物**（qa/data/assembler_library_audit.md）。
// 棚卸し表を触ったら回し直す。生成物なので .md を手で編集しない。
//
// 何を見ているか:
//   分子 … summon / reaction が指す分子 × getCompoundLibrary()（stages.json ＋ compounds.json）
//   反応 … reaction が指す試薬 id の需要と、**反応が無くて none にした項目**の一覧
//          （後者が試薬パレットの優先度の材料になる。指す項目数がそのまま需要）
//
// 使い方: node qa/tools/audit_library.js            … 標準出力に要約
//         node qa/tools/audit_library.js --write     … qa/data/assembler_library_audit.md を書く
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var QA = path.join(ROOT, 'qa');

var rows = fs.readFileSync(path.join(QA, 'data', 'assembler_links.jsonl'), 'utf8')
  .split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });
var qa = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));
var unitOf = {}, lvOf = {};
qa.patterns.forEach(function (p) { unitOf[p.code] = p.unit; lvOf[p.code] = p.difficulty; });

function load(file, key) {
  var j = JSON.parse(fs.readFileSync(path.join(ROOT, 'assembler', file), 'utf8'));
  return Array.isArray(j) ? j : (j[key] || []);
}
var arrS = load('stages.json', 'stages');
var arrC = load('compounds.json', 'compounds');
var libExact = {}, srcOf = {};
arrS.forEach(function (c) { if (c && c.name) { libExact[c.name] = c; srcOf[c.name] = 'stages'; } });
arrC.forEach(function (c) {
  if (!c || !c.name) return;
  libExact[c.name] = c;
  srcOf[c.name] = srcOf[c.name] ? '**stages と compounds の両方**' : 'compounds';
});
var libNames = Object.keys(libExact);

// ---- 分子の照合 ------------------------------------------------------
// 修飾語を落とした比較キー。「鎖状グルコース」と「D-グルコース（鎖状）」は語順が違うので
// 素の部分一致では当たらない。★ここを甘くすると「あるのに登録要望として送る」事故になる
function norm(s) {
  return String(s)
    .replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
    .replace(/^[DLdl]-/, '').replace(/[αβ]-/g, '').replace(/[DLdl]-/g, '')
    .replace(/鎖状|環状|開環|直鎖/g, '')
    .replace(/[-‐−\s・,，]/g, '').trim();
}
var normLib = {};
libNames.forEach(function (L) { (normLib[norm(L)] = normLib[norm(L)] || []).push(L); });

var wanted = {};
rows.forEach(function (o) {
  if ((o.kind === 'summon' || o.kind === 'reaction') && o.name) {
    (wanted[o.name] = wanted[o.name] || []).push(o.code);
  }
});
var names = Object.keys(wanted).sort();

var hit = [], alias = [], near = [], miss = [];
names.forEach(function (n) {
  if (libExact[n]) { hit.push(n); return; }
  var byAlias = libNames.filter(function (L) { return L.indexOf(n + '（') === 0; });
  if (byAlias.length) { alias.push({ name: n, cand: byAlias, codes: wanted[n] }); return; }
  var cand = [];
  (normLib[norm(n)] || []).concat(libNames.filter(function (L) { return L.indexOf(n) >= 0; }))
    .forEach(function (L) { if (cand.indexOf(L) < 0) cand.push(L); });
  if (cand.length) near.push({ name: n, cand: cand.slice(0, 5), codes: wanted[n] });
  else miss.push({ name: n, codes: wanted[n] });
});
var noFormula = hit.filter(function (n) { return !libExact[n].formula; });

// ライブラリ内の同名重複（ID を振るときに「どちらが正か」を決める必要が出る）
var dupNames = libNames.filter(function (n) { return /両方/.test(srcOf[n] || ''); });

// ---- 反応の需要 ------------------------------------------------------
var reagentDemand = {};
rows.forEach(function (o) {
  if (o.kind !== 'reaction') return;
  (reagentDemand[o.reagent] = reagentDemand[o.reagent] || []).push(o.code);
});
var mechDemand = {};
rows.forEach(function (o) {
  if (o.kind !== 'mechanism') return;
  (mechDemand[o.id] = mechDemand[o.id] || []).push(o.code);
});
// **反応が無くて none にした項目** ＝ 収録されたら拾い直せる項目。これが優先度の材料
var wantReaction = rows.filter(function (o) {
  if (o.kind !== 'none') return false;
  return /reactor|試薬|反応が|対応する反応/.test((o.why || '') + (o.note || ''));
});

// ---- 出力 ------------------------------------------------------------
function md() {
  var L = [];
  L.push('# 一問一答が指したいもの × assembler の在庫');
  L.push('');
  L.push('`qa/data/assembler_links.jsonl`（283項目の棚卸し）が指す**分子**と**反応**を、');
  L.push('assembler の在庫と突き合わせた結果。**生成物なので手で編集しない**');
  L.push('（`node qa/tools/audit_library.js --write` が作る）。');
  L.push('');
  L.push('---');
  L.push('');
  L.push('# 第1部: 分子');
  L.push('');
  L.push('照合先は **`getCompoundLibrary()`（`stages.json` ＋ `compounds.json`）**。');
  L.push('`summonMolecule` はこの結合済みの集合を名前の完全一致で引くので、');
  L.push('**`compounds.json` だけを見ると stages にしか無いものが「無い」に誤って落ちる**。');
  L.push('');
  L.push('- ライブラリの母集団: **' + libNames.length + ' 種**（compounds ' + arrC.length + ' / stages ' + arrS.length + '。重複を除いた固有名）');
  L.push('- qa が指したい分子: **' + names.length + ' 種**');
  L.push('');
  L.push('| 分類 | 件数 | 意味 |');
  L.push('|---|--:|---|');
  L.push('| ① 完全一致 | ' + hit.length + ' | 今すぐ `?summon=` で引ける |');
  L.push('| ② `〜（別名）` 型 | ' + alias.length + ' | 別名に阻まれているだけ。**登録すると重複を作る** |');
  L.push('| ③ 修飾つきしか無い | ' + near.length + ' | どれを指すかは qa 側が決める |');
  L.push('| ④ 影も形も無い | ' + miss.length + ' | **登録要望** |');
  L.push('');
  L.push('> ②と③を④に混ぜて渡すと「あるのに登録してくれ」と言うことになる。');
  L.push('> 実際にエチレン・プロペン・アセチレンは `stages.json` にあり、**素の名前で引けないだけ**だった。');
  L.push('');
  function tbl(title, list, note) {
    if (!list.length) return;
    L.push('## ' + title);
    L.push('');
    if (note) { L.push(note); L.push(''); }
    L.push('| 指したい分子 | ライブラリの実体 | 指す知識項目 |');
    L.push('|---|---|---|');
    list.forEach(function (x) {
      L.push('| ' + x.name + ' | ' + x.cand.map(function (c) {
        return '`' + c + '`' + (srcOf[c] ? '<br><sub>' + srcOf[c] + '</sub>' : '');
      }).join('<br>') + ' | ' + x.codes.map(function (c) { return '`' + c + '`'; }).join('<br>') + ' |');
    });
    L.push('');
  }
  tbl('② `〜（別名）` 型 —— 別名で引けるようにすれば済む', alias,
    '**登録は不要。** `（…）` の中の別名を抱き込んだ表記に完全一致が阻まれているだけ。\n' +
    'qa 側は `gen_links.js` が機械で解決して繋いである（一意に決まるときだけ）。ID が入れば根本的に解決する。');
  tbl('③ 修飾つきしか無い —— どれを指すかは qa 側が決めた', near,
    '**ライブラリへの追加は不要。** どの立体・どの状態を指したいかは項目ごとに違うので、\n' +
    '`gen_links.js` の手表で項目単位に振り分けてある（鎖状か環状かで見せたいものが違う）。');
  if (miss.length) {
    L.push('## ④ 影も形も無い —— 登録要望');
    L.push('');
    L.push('**指す知識項目の数がそのまま優先度**（多く指されている分子から埋めると効く）。');
    L.push('');
    L.push('| 分子 | 指す項目数 | 単元 | 指す知識項目 |');
    L.push('|---|--:|---|---|');
    miss.slice().sort(function (a, b) { return b.codes.length - a.codes.length; }).forEach(function (x) {
      var us = {};
      x.codes.forEach(function (c) { us[unitOf[c]] = 1; });
      L.push('| **' + x.name + '** | ' + x.codes.length + ' | ' + Object.keys(us).join(' ') + ' | ' +
        x.codes.map(function (c) { return '`' + c + '`（Lv' + lvOf[c] + '）'; }).join('<br>') + ' |');
    });
    L.push('');
  }
  L.push('## ① 完全一致（' + hit.length + ' 種）');
  L.push('');
  L.push(hit.slice().sort().map(function (n) { return n + '（' + wanted[n].length + '）'; }).join(' / '));
  L.push('');
  if (noFormula.length) {
    L.push('## 指す先に `formula` が無い');
    L.push('');
    L.push(noFormula.map(function (n) { return '`' + n + '`'; }).join(' / ') +
      ' —— 分子式を読む処理を入れると `undefined` を踏む。qa の test.html が既知の集合として見ている。');
    L.push('');
  }
  if (dupNames.length) {
    L.push('## ライブラリ内の同名重複（ID を振るときに「どちらが正か」を決める必要がある）');
    L.push('');
    L.push('`getCompoundLibrary()` は stages と compounds を並べるので、同名エントリが2つ立つ。');
    L.push('`find` は先頭に当たるので実害は出ていないが、ID 付与では通れない。');
    L.push('');
    dupNames.forEach(function (n) { L.push('- `' + n + '`'); });
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('# 第2部: 反応（試薬パレットの優先度の材料）');
  L.push('');
  L.push('## いま指している試薬（reactor の31種のうち使われているもの）');
  L.push('');
  L.push('| 試薬 id | 指す項目数 | 指す知識項目 |');
  L.push('|---|--:|---|');
  Object.keys(reagentDemand).sort(function (a, b) { return reagentDemand[b].length - reagentDemand[a].length; })
    .forEach(function (r) {
      L.push('| `' + r + '` | ' + reagentDemand[r].length + ' | ' +
        reagentDemand[r].map(function (c) { return '`' + c + '`'; }).join(' ') + ' |');
    });
  L.push('');
  L.push('## いま指している機構（14件のうち使われているもの）');
  L.push('');
  L.push('| 機構 id | 指す項目数 | 指す知識項目 |');
  L.push('|---|--:|---|');
  Object.keys(mechDemand).sort(function (a, b) { return mechDemand[b].length - mechDemand[a].length; })
    .forEach(function (r) {
      L.push('| `' + r + '` | ' + mechDemand[r].length + ' | ' +
        mechDemand[r].map(function (c) { return '`' + c + '`'; }).join(' ') + ' |');
    });
  L.push('');
  L.push('## ★反応が無くて `none` にした項目（' + wantReaction.length + ' 件）');
  L.push('');
  L.push('**これが試薬を足すときの需要**。収録されたら `none` から拾い直せる項目で、');
  L.push('`why` に「何が無いのか」が書いてある。単元と Lv を添えたので、');
  L.push('**どの反応を足すと何項目が繋がるか**が読める。');
  L.push('');
  L.push('| 知識項目 | 単元 | Lv | 何が無いと書いてあるか |');
  L.push('|---|---|--:|---|');
  wantReaction.slice().sort(function (a, b) {
    return (unitOf[a.code] || '').localeCompare(unitOf[b.code] || '') || a.code.localeCompare(b.code);
  }).forEach(function (o) {
    L.push('| `' + o.code + '` | ' + unitOf[o.code] + ' | ' + lvOf[o.code] + ' | ' +
      String(o.why).replace(/\|/g, '\\|') + (o.note ? '<br><sub>' + String(o.note).replace(/\|/g, '\\|') + '</sub>' : '') + ' |');
  });
  L.push('');
  return L.join('\n') + '\n';
}

console.log('分子: 母集団 ' + libNames.length + ' / 指したい ' + names.length +
  '（① ' + hit.length + ' ② ' + alias.length + ' ③ ' + near.length + ' ④ ' + miss.length + '）');
console.log('反応: 試薬 ' + Object.keys(reagentDemand).length + ' 種 / 機構 ' + Object.keys(mechDemand).length + ' 種');
console.log('★反応が無くて none にした項目: ' + wantReaction.length + ' 件');
if (dupNames.length) console.log('ライブラリ内の同名重複: ' + dupNames.length + ' 件 → ' + dupNames.join(' / '));
if (noFormula.length) console.log('formula が無い指し先: ' + noFormula.join(' / '));

if (process.argv.indexOf('--write') >= 0) {
  fs.writeFileSync(path.join(QA, 'data', 'assembler_library_audit.md'), md(), 'utf8');
  console.log('→ qa/data/assembler_library_audit.md を書いた');
}
