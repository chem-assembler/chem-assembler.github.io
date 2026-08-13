#!/usr/bin/env node
/**
 * 教科書での扱い（本文／発展欄／見あたらない）を**知識項目ごとに**判定する。
 *
 *   node qa/tools/scan_textbook_by_item.js                  … 既定のフォルダを見る
 *   node qa/tools/scan_textbook_by_item.js "D:/別の/教科書"  … 場所を指定
 *
 * 出力は `qa/data/textbook_by_item.jsonl`（1行1項目）。
 *
 * ## なぜ要るか
 *
 * `DESIGN_difficulty_frequency.md` §7-2 で **`difficulty` は「教科書での扱い × セミナーでの扱い」**
 * で決めることになった。ところが既存の `scan_textbook.js` は**語ごと**の表しか出さないので、
 * **316項目それぞれに印が無い**。そこを埋めるのがこの道具（§7-5 の3つ目）。
 *
 * ## どう判定するか —— 語を切り出すのをやめた
 *
 * 最初は「項目の答えから代表語を抽出して教科書で探す」形を試したが、**使えなかった**:
 *
 *   - 語の切り出しが壊れる（「アンモニア性硝酸銀水溶液」から `性硝酸銀水溶` のような断片が出た）
 *   - 固有性で並べると珍しすぎる語が上に来る（銀鏡反応の項目で `器壁` が代表になった）
 *
 * そこで**語を作るのをやめ、項目の文と教科書の文の最長一致を直接探す**形にした。
 * 切り出しを要しないので壊れず、「**この表現が教科書にある**」という直接の証拠になる。
 *
 * ## 判定が当たっている根拠
 *
 * 通読（`REVIEW_CRITERIA.md`）で**人が読んで「教科書では発展欄で扱われる」と書き込んだ2件**を、
 * この道具も独立に発展欄と判定した:
 *
 *   - `org.ali.alkane-branch-bp`（枝分かれと沸点 ← PLUS 分子の形と沸点）
 *   - `org.aro.orientation`（配向性 ← PLUS 芳香族化合物の置換基の配向性）
 *
 * ## 限界（読む人が知っておくべきこと）
 *
 * - **1社・新課程（R5）だけ。** 「本文にある」は強く言えるが「無い」は言い切れない
 * - **発展欄の切り出しは見出しからの行数による近似**（`scan_textbook.js` と同じ）。
 *   だから**発展欄と判定したものは全部一覧に出す**（少数なので人が確かめられる）
 * - **一致が短いと当たらない。** 12字未満の一致は `weak: true` を付ける ——
 *   実際に `org.ali.alkyne-functional`（三重結合＝本文の内容）が
 *   8字の一致だけで発展欄と判定される誤りが出た
 * - ⚠ **一致した教科書の文字列は出力しない**（著作物なので）。出すのは
 *   **項目側のどこが一致したか**（位置と長さ）と、本文／発展欄での一致回数だけ
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var QA = path.resolve(__dirname, '..');
var BOOKS = process.argv[2] || 'C:/Users/maequ/マイドライブ/化学/教科書';

// 発展欄の見出しと、その終わりの目印。**`scan_textbook.js` と同じ**にしておく
// （2つの道具が違う切り方をすると、どちらの数字が正か分からなくなる）
var ADV_HEAD = /^\s*(PLUS|発展|参考)\b/;
var SEC_HEAD = /^\s*(\d+編|第\d+|\d+章|\d+節)/;
var ADV_SPAN = 60;

var N = 8;          // 索引に使う n-gram の長さ
var WEAK_LEN = 12;  // これ未満の一致は信頼度が低い（上のコメントの誤判定が根拠）

/**
 * **発展欄にある項目は人が確定させている。** `KNOWLEDGE_CAVEATS.md` の J-8 が
 * 教科書の発展欄48件（うち有機14件）を全項目と1件ずつ照合した結果で、
 * **機械判定より確実**なのでこちらを正とする。
 *
 * なぜ人手を優先するか: 機械は**発展欄を見逃す**。答え合わせで
 * `org.fat.iodine-value`（ヨウ素価）と `org.ali.silver-acetylide`（銀アセチリド）を
 * 本文と誤判定した —— 主題の語（「ヨウ素価」）は発展欄にあるのに、
 * 答えに含まれる一般的な語（「脂肪油」「乾性油」）が本文にあるので負ける。
 * **どの語が主題かは機械では決められない**（この道具で3回確かめた）。
 *
 * だから役割を分ける:
 *   - **発展欄** … この表（人手・確実）
 *   - **本文 / 見あたらない** … 機械判定（発展欄との区別が要らないぶん当たりやすい）
 *
 * 機械が発展欄と判定したのにこの表に無いものは、**表の見落ち候補**として報告する。
 */
var ADV_BY_HAND = {
  'org.anal.equivalent-h': '核磁気共鳴法による構造式の決定',
  'org.ali.alkane-branch-bp': '分子の形と沸点',
  'org.ali.cyclo-strain': 'シクロアルカンのひずみ',
  'org.ali.keto-enol': 'エノール形とケト形',
  'org.ali.unsaturation': '炭化水素の分子式と構造（不飽和度）',
  'org.carbonyl.maleic-fumaric': 'マレイン酸とフマル酸の融点',
  'org.fat.saponification-value': '油脂のけん化価とヨウ素価',
  'org.fat.iodine-value': '油脂のけん化価とヨウ素価',
  'org.aro.orientation': '芳香族化合物の置換基の配向性',
  'org.bio.amino-acid-polyprotic': 'グルタミン酸とリシンの電離平衡'
};

// ---- 教科書のテキストを用意する（`scan_textbook.js` と同じ置き場を共用する）----
var tmp = path.join(os.tmpdir(), 'qa-textbook-scan');
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
if (!fs.existsSync(BOOKS)) {
  console.error('教科書のフォルダが無い: ' + BOOKS);
  process.exit(1);
}
var pdfs = fs.readdirSync(BOOKS).filter(function (f) { return /\.pdf$/i.test(f); }).sort();
if (!pdfs.length) { console.error('PDF が無い: ' + BOOKS); process.exit(1); }

// 化学式の書き方をそろえる。**下付き文字が最大の落とし穴**だった ——
// 一問一答は Unicode の下付き（CₙH₂ₙ）で書くが、PDF から取れるのは通常の数字（CnH2n）。
// そろえないと「CₙH₂ₙ」しか答えに無い項目が**一致0字**になる（実際そうなった）。
var SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', 'ₙ': 'n', 'ₘ': 'm' };
function norm(s) {
  return String(s || '')
    .replace(/[₀-₉ₙₘ]/g, function (c) { return SUB[c] || c; })
    .replace(/[−–—]/g, '-')       // 全角・半角のダッシュ類
    .replace(/[（）]/g, function (c) { return c === '（' ? '(' : ')'; })
    .replace(/[\s\u3000]/g, '');  // 空白は落とす（PDF の段組み崩れを吸収）
}

var TB = '';        // 教科書の全文（空白を落として連結）
var advAt = [];     // 文字位置 → 発展欄か（1/0）
pdfs.forEach(function (f) {
  var out = path.join(tmp, f.replace(/\.pdf$/i, '.txt'));
  if (!fs.existsSync(out)) {
    try { cp.execFileSync('pdftotext', ['-enc', 'UTF-8', path.join(BOOKS, f), out], { stdio: 'ignore' }); }
    catch (e) { console.error('pdftotext が使えない: ' + e.message); process.exit(1); }
  }
  var advLeft = 0;
  var parts = [];
  fs.readFileSync(out, 'utf8').split(/\r?\n/).forEach(function (L) {
    if (ADV_HEAD.test(L)) advLeft = ADV_SPAN;
    else if (SEC_HEAD.test(L)) advLeft = 0;
    else if (advLeft > 0) advLeft--;
    var adv = (ADV_HEAD.test(L) || advLeft > 0) ? 1 : 0;
    var t = norm(L);
    parts.push(t);
    for (var i = 0; i < t.length; i++) advAt.push(adv);
  });
  TB += parts.join('');
});

// ---- n-gram の索引。**すべての出現位置**を持つ ----
// 最初の1つだけを持つ形にしたら、たまたま発展欄に当たった項目が
// 「発展欄」と誤判定された（`org.ali.alkyne-functional`）。本文にも出るのだから、
// 全位置を見て「本文に1回でもあれば本文」と決める（`scan_textbook.js` と同じ考え方）。
var idx = new Map();
for (var i = 0; i + N <= TB.length; i++) {
  var g = TB.substr(i, N);
  var a = idx.get(g);
  if (a) a.push(i); else idx.set(g, [i]);
}

// ---- 項目ごとに最長一致を探す ----
var D = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));

// 一致した部分が**化学の内容を持っているか**。
//
// これが無いと**設問の定型句で一致してしまう**。実際に起きた ——
// 「正しいものをすべて選べ。」（12字）が教科書の章末問題にもあるため、
// **clue 単元（手筋から起こした新設で教科書に対応する記述が無い）まで「本文」と判定された**。
// 一致の長さだけでは、内容の一致と言い回しの一致を区別できない。
function hasChemistry(s) {
  if (/[ァ-ヶー]{3,}/.test(s)) return true;                       // カタカナの化学用語
  if (/[A-Z][a-z]?\d|[A-Z]{1,2}[=≡-][A-Z]/.test(s)) return true;   // 化学式・結合の書き方
  if (/(基|結合|異性体|重合|反応|価|飽和|酸化|還元|水素|炭素|酸素|窒素)/.test(s)) return true;
  return false;
}

function scan(src) {
  var s = norm(src);
  var best = 0, hits = [];
  for (var i = 0; i + N <= s.length; i++) {
    var ps = idx.get(s.substr(i, N));
    if (!ps) continue;
    for (var k = 0; k < ps.length; k++) {
      var p = ps[k], a = i, b = i + N, pa = p, pb = p + N;
      while (a > 0 && pa > 0 && s.charAt(a - 1) === TB.charAt(pa - 1)) { a--; pa--; }
      while (b < s.length && pb < TB.length && s.charAt(b) === TB.charAt(pb)) { b++; pb++; }
      var L = b - a;
      if (!hasChemistry(s.substr(a, L))) continue;   // 言い回しだけの一致は捨てる
      if (L > best) { best = L; hits = [{ pos: pa, at: a }]; }
      else if (L === best && best > 0) hits.push({ pos: pa, at: a });
    }
  }
  return { len: best, hits: hits };
}

var rows = [];
D.patterns.forEach(function (p) {
  // 照合するのは**答え・選択肢・補足**。
  // ⚠ **設問文（q）は使わない。** q は問いの形（「〜は？」「〜をすべて選べ。」）で、
  // 教科書の記述とは文体が違う。それどころか**定型句が教科書の章末問題と一致して**、
  // 内容が無関係な項目まで「本文」と判定させていた（上の `hasChemistry` のコメント）。
  // 内容を持つのは答え・選択肢・補足のほう。
  var best = { len: 0, hits: [], from: null, text: '' };
  (p.variants || []).forEach(function (v) {
    var fields = [['a', v.a], ['supplement', v.supplement]];
    (v.options || []).forEach(function (o, i) { fields.push(['肢' + i, o]); });
    fields.forEach(function (pair) {
      if (!pair[1]) return;
      var r = scan(pair[1]);
      if (r.len > best.len) best = { len: r.len, hits: r.hits, from: v.mode + '.' + pair[0], text: String(pair[1]) };
    });
  });

  var body = 0, adv = 0;
  best.hits.forEach(function (h) { if (advAt[h.pos]) adv++; else body++; });
  var weak = best.len < WEAK_LEN;
  // 「発展欄」は**強い一致のときだけ**言う（片側の論法・§7-2 と同じ）。
  // 弱い一致で発展欄と言わせたら `org.ali.formula-alkene`（アルケンの一般式 CnH2n ＝ 本文の内容）が
  // 9字の一致だけで発展欄と判定され、しかも人手の表 J-8 に無いので「見落ち候補」に出た。
  // 教科書の97%が本文なので、判断がつかないときは本文に寄せるほうが当たる。
  var scope = best.len < N ? '見あたらない'
    : (body > 0 ? '本文' : (weak ? '本文' : '発展欄'));
  var by = '最長一致';
  var machineSaidAdv = (scope === '発展欄');

  // **人手の表が最優先**（J-8）。機械の判定を上書きする
  if (ADV_BY_HAND[p.code]) {
    scope = '発展欄';
    by = 'J-8（人手・' + ADV_BY_HAND[p.code] + '）';
    weak = false;
  }

  // 文の照合で**何も当たらなかった**項目を、語の出現で測り直す。
  // 「定義・分類・一般式」の型で、答えが「CnH2n」や「炭素間二重結合C=C」しかないので、
  // 教科書の言い回しと合わない。カタカナ列と接尾が明確な漢字語は境界がはっきりしていて、
  // 切り出しが壊れない（語の抽出をやめた理由は漢字とひらがなの境界だった）。
  //
  // ⚠ **文の一致がある項目には救済を掛けない。** 掛けたら
  // `org.fat.iodine-value`（ヨウ素価）が**発展欄 → 本文に化けた** ——
  // 主題は発展欄にある「ヨウ素価」なのに、答えに含まれる一般的な語（「油脂」）が
  // 本文にあるので本文と判定された。**語の出現は主題を見ていない**ので、
  // 文が当たっているならそちらのほうが主題に近い。
  if (scope === '見あたらない') {
    // ここでは **q も使う**。文の一致では q を外したが（定型句が誤一致するため）、
    // **カタカナ語を拾うぶんには q が要る** ——「アルカンの一般式は？」のように
    // **主題の語は設問文にしかない**項目があり、答えは「CnH2n+2」だけだったりする。
    // 「正しいものをすべて選べ。」にカタカナは無いので、定型句の害はここには及ばない。
    var kata = {};
    (p.variants || []).forEach(function (v) {
      [v.q, v.a].concat(v.options || []).forEach(function (t) {
        var s = norm(t);
        (s.match(/[ァ-ヶー]{4,}/g) || []).forEach(function (w) { kata[w] = 1; });
        // **漢字の複合語も拾う。** カタカナだけだと「ヨウ素価」「組成式」「氷酢酸」を
        // 持つ項目が救えなかった（カタカナ列が「ヨウ」の2字しかない、など）。
        // ⚠ 拾うのは**接尾が明確なものだけ**。漢字語を自由に切り出すと断片が出る
        //（前に「性硝酸銀水溶」のような壊れた語が出て、この方式を捨てた経緯がある）。
        (s.match(/[一-龥]{1,5}(式|価|体|性|点|数|法|糖|油|酸|基)/g) || []).forEach(function (w) {
          // 「水素」「炭素」のような**どの項目にも出る語**は判定力が無いので使わない
          if (/^(水素|炭素|酸素|窒素|元素|同素|色素)$/.test(w)) return;
          if (w.length >= 2) kata[w] = 1;
        });
      });
    });
    var kBody = 0, kAdv = 0, used = [];
    Object.keys(kata).forEach(function (w) {
      var at = TB.indexOf(w), seen = false;
      while (at >= 0) {
        seen = true;
        if (advAt[at]) kAdv++; else kBody++;
        at = TB.indexOf(w, at + 1);
      }
      if (seen) used.push(w);
    });
    if (used.length) {
      scope = kBody > 0 ? '本文' : '発展欄';
      by = 'カタカナ語（' + used.slice(0, 3).join('・') + '）';
      weak = false;                 // 語の出現で決まったので、短い一致の弱さは消える
      body = kBody; adv = kAdv;
    }
  }

  var row = {
    code: p.code,
    unit: p.unit,
    difficulty: p.difficulty,
    scope: scope,
    matchLen: best.len,
    body: body,
    adv: adv,
    from: best.from,
    by: by
  };
  if (weak) row.weak = true;   // どちらの方法でも決まらなかった
  // 機械は発展欄と言ったが人手の表に無い ＝ **表の見落ち候補**（相互検算）
  if (machineSaidAdv && !ADV_BY_HAND[p.code]) row.advCandidate = true;
  // ⚠ 一致した**教科書の**文字列は出さない（著作物）。出すのは**項目側**の該当部分だけ。
  // これは自分たちが書いた文章なので、人が検算するのに使える。
  if (best.len) {
    var at = best.hits.length ? best.hits[0].at : 0;
    row.ourText = norm(best.text).substr(at, best.len);
  }
  rows.push(row);
});

// ---- 書き出す ----
var readme = {
  _readme: '知識項目ごとの「教科書での扱い」。node qa/tools/scan_textbook_by_item.js が生成。'
    + '判定は「項目の文（設問・答え・選択肢・補足）と教科書の文の最長一致」を探し、'
    + 'その一致が本文にあれば 本文、発展欄にしか無ければ 発展欄、'
    + N + '字の一致すら無ければ 見あたらない としたもの。'
    + 'matchLen が ' + WEAK_LEN + '字未満のものは weak: true（当てにならない）。'
    + 'ourText は**こちらが書いた文**の一致部分で、教科書の文字列は含まない。'
    + '⚠ 1社・新課程（R5）だけを見ているので「本文にある」は強く言えるが「無い」は言い切れない。'
    + '発展欄の切り出しは見出しからの行数による近似（scan_textbook.js と同じ）。'
};
var outFile = path.join(QA, 'data', 'textbook_by_item.jsonl');
fs.writeFileSync(outFile,
  [JSON.stringify(readme)].concat(rows.map(function (r) { return JSON.stringify(r); })).join('\r\n') + '\r\n',
  'utf8');

// ---- 画面に出す ----
var byScope = {};
rows.forEach(function (r) { byScope[r.scope] = (byScope[r.scope] || 0) + 1; });
console.log('教科書での扱い（項目ごと）: ' + rows.length + '項目');
console.log('  教科書テキスト ' + TB.length + '字 / 発展欄とみなした割合 '
  + (advAt.reduce(function (a, b) { return a + b; }, 0) / advAt.length * 100).toFixed(1) + '%');
console.log('  判定: ' + JSON.stringify(byScope));
var weak = rows.filter(function (r) { return r.weak; });
console.log('  ⚠ 一致が' + WEAK_LEN + '字未満（当てにならない）: ' + weak.length + '件');
console.log('');

// 発展欄は少数なので**全部出す**。人手の表（J-8）が正で、機械は検算に使う
console.log('■ 発展欄（' + (byScope['発展欄'] || 0) + '件・出典は J-8 の人手照合）');
rows.filter(function (r) { return r.scope === '発展欄'; }).forEach(function (r) {
  // 機械も同じ結論に達したかを併記する。一致していれば判定の裏付けになる
  var agree = r.adv > 0 && r.body === 0 ? '  ✅機械も発展欄' : (r.matchLen ? '  （機械は本文寄り: 本文' + r.body + '／発展' + r.adv + '）' : '');
  console.log('    Lv' + r.difficulty + ' ' + r.code + agree);
});
var cand = rows.filter(function (r) { return r.advCandidate; });
if (cand.length) {
  console.log('');
  console.log('■ ⚠ 機械が発展欄と判定したが J-8 の表に無い（表の見落ち候補・' + cand.length + '件）');
  cand.forEach(function (r) {
    console.log('    Lv' + r.difficulty + ' ' + r.code + '  一致' + r.matchLen + '字'
      + (r.weak ? '（弱い＝当てにならない）' : '') + '  発展' + r.adv + '件');
  });
}
console.log('');
console.log('■ 見あたらないと判定（' + (byScope['見あたらない'] || 0) + '件）');
rows.filter(function (r) { return r.scope === '見あたらない'; }).forEach(function (r) {
  console.log('    Lv' + r.difficulty + ' ' + r.code);
});
if (weak.length) {
  console.log('');
  console.log('■ 一致が弱い（' + weak.length + '件・判定を信用しない）');
  weak.forEach(function (r) { console.log('    ' + r.code + '  ' + r.scope + '  一致' + r.matchLen + '字'); });
}
console.log('');
console.log('書き出した: ' + path.relative(process.cwd(), outFile));
