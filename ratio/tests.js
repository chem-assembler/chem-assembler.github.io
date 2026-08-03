// 比例式でみる化学計算 — 回帰テスト（モデル＋iframe UI駆動）
(function () {
  'use strict';

  var M = window.ChemRatio;
  var PRG = window.ChemRatioProgress;
  var pass = 0, fail = 0;
  var out = document.getElementById('results');
  var uiOut = document.getElementById('uiresults');

  // UI テストは実際に問題を解くので、進捗（localStorage）に書き込んでしまう。
  // test.html は本番と同じオリジンなので、**回帰テストを走らせたら学習者の進捗が
  // 書き換わり、逆に残っていた進捗でテストが落ちる**（q1 を解いた人の環境では
  // 「桁ちがいでは正解にならない」が state.solved.q1 を見て失敗する）。
  // 控えを取って消すのは **iframe が読み込まれる前**でなければ意味がないので、
  // test.html の <head> でやっている（window.__prgBackup）。ここは戻すだけ。
  function restoreProgress() {
    var snap = window.__prgBackup || {};
    PRG.MODES.forEach(function (m) {
      try {
        if (snap[m] === null || snap[m] === undefined) localStorage.removeItem(PRG.key(m));
        else localStorage.setItem(PRG.key(m), snap[m]);
      } catch (e) { /* private モード等。戻せなくても落とさない */ }
    });
  }

  function section(title, target) {
    var h = document.createElement('h2');
    h.textContent = title;
    (target || out).appendChild(h);
  }

  function ok(name, cond, target) {
    var d = document.createElement('div');
    d.className = 'case ' + (cond ? 'pass' : 'fail');
    d.textContent = (cond ? '✔ ' : '✘ ') + name;
    (target || out).appendChild(d);
    if (cond) pass++; else fail++;
  }

  function near(a, b) { return Math.abs(a - b) < 1e-6; }
  function nearRel(a, b) { return Math.abs(a - b) <= Math.abs(b) * 1e-6; }

  function byId(id) {
    for (var i = 0; i < M.PROBLEMS.length; i++) if (M.PROBLEMS[i].id === id) return M.PROBLEMS[i];
    return null;
  }

  // ---- 問題の生成（SPECS → PROBLEMS） ----
  section('モデル：物質データと問題の生成');
  ok('問題は20問ある', M.PROBLEMS.length === 20);
  ok('SPECS と PROBLEMS の数が一致', M.SPECS.length === M.PROBLEMS.length);
  ok('SPECS の参照する物質がすべて存在する', M.SPECS.every(function (s) {
    return !!M.SUBSTANCES[s.sub];
  }));
  ok('分子量はすべて文字列（末尾の0を保つため）', Object.keys(M.SUBSTANCES).every(function (k) {
    return typeof M.SUBSTANCES[k].M === 'string';
  }));
  ok('H2 の分子量は "2.0"（末尾の0が消えない）', M.disp(M.SUBSTANCES.H2.M) === '2.0');
  ok('id に重複がない', new Set(M.PROBLEMS.map(function (p) { return p.id; })).size === 20);

  // 列は【左＝与えられた量／右＝問われる量】。矢印が常に → と ↓ になる
  ok('列は左が与えられた量・右が問われる量', M.PROBLEMS.every(function (p, i) {
    return p.cols[0] === M.SPECS[i].given.q && p.cols[1] === M.SPECS[i].asked;
  }));
  ok('未知は必ず右の列', M.PROBLEMS.every(function (p) {
    return M.unknownIndex(p) === 1;
  }));
  ok('与えられた値は必ず左下', M.PROBLEMS.every(function (p, i) {
    return p.target[0] === M.SPECS[i].given.v && p.target[1] === null;
  }));

  ok('1 mol あたり: 質量は分子量', M.perMol(M.SUBSTANCES.H2O, 'mass') === '18');
  ok('1 mol あたり: 物質量は 1', M.perMol(M.SUBSTANCES.H2O, 'mole') === 1);
  ok('1 mol あたり: 体積は 22.4 L', M.perMol(M.SUBSTANCES.O2, 'volume') === '22.4');
  ok('1 mol あたり: 粒子は 6.0×10²³ 個', M.perMol(M.SUBSTANCES.H2O, 'count') === '6.0e23');
  ok('基準の行はすべて 1 mol あたりの値', M.PROBLEMS.every(function (p) {
    var sub = M.SUBSTANCES[p.sub];
    return p.base[0] === M.perMol(sub, p.cols[0]) && p.base[1] === M.perMol(sub, p.cols[1]);
  }));

  ok('問題文が生成される（q1）',
    byId('q1').title === '水 H<sub>2</sub>O 9.0 g は何 mol か');
  ok('気体の体積には「標準状態で」が付く（q3）',
    byId('q3').title.indexOf('標準状態で') === 0);
  ok('粒子の数を問う文になる（q6）', byId('q6').title.indexOf('分子は何個あるか') > 0);
  ok('粒子の数が与えられる文になる（q17）',
    byId('q17').title.indexOf('分子 3.0×10²³ 個') > 0);
  ok('ヒントが生成される（q1）',
    byId('q1').hint === '水 H<sub>2</sub>O 1 mol の質量は 18 g');
  ok('質量↔体積のヒントは両方に触れる（q11）',
    byId('q11').hint.indexOf('44') > 0 && byId('q11').hint.indexOf('22.4') > 0);
  ok('全問に問題文とヒントがある', M.PROBLEMS.every(function (p) {
    return !!p.title && !!p.hint;
  }));

  section('モデル：答えの表記を有効数字から機械的に決める');
  ok('toSig(0.5, 2) は "0.50"', M.toSig(0.5, 2) === '0.50');
  ok('toSig(0.2, 3) は "0.200"', M.toSig(0.2, 3) === '0.200');
  ok('toSig(13.2, 2) は "13"', M.toSig(13.2, 2) === '13');
  ok('toSig(9, 2) は "9.0"', M.toSig(9, 2) === '9.0');
  ok('toSig(3e23, 2) は "3.0e23"', M.toSig(3e23, 2) === '3.0e23');
  ok('toSig(1.2e24, 2) は "1.2e24"', M.toSig(1.2e24, 2) === '1.2e24');

  // ---- 比例式を解く ----
  section('モデル：20問すべての答え');
  var EXPECTED = {
    q1: [0.5, '0.50'],      q2: [11, '11'],        q3: [0.25, '0.25'],
    q4: [36, '36'],         q5: [0.5, '0.50'],     q6: [3.0e23, '3.0e23'],
    q7: [0.25, '0.25'],     q8: [0.2, '0.200'],    q9: [13.2, '13'],
    q10: [67.2, '67'],      q11: [5.6, '5.6'],     q12: [1.2e24, '1.2e24'],
    q13: [0.5, '0.50'],     q14: [16, '16'],       q15: [0.2, '0.20'],
    q16: [0.5, '0.500'],    q17: [9, '9.0'],       q18: [0.2, '0.20'],
    q19: [42, '42'],        q20: [0.25, '0.25']
  };
  Object.keys(EXPECTED).forEach(function (id) {
    var p = byId(id), e = EXPECTED[id];
    ok(id + ' の値は ' + e[0], !!p && nearRel(M.solve(p), e[0]));
    ok(id + ' の表記は ' + M.disp(e[1]), !!p && p.ansDisp === e[1]);
  });
  ok('全問の答えの表記が要求桁を満たす', M.PROBLEMS.every(function (p) {
    var s = M.sci(p.ansDisp);
    return M.sigFigOk(p.sigfigs, s ? s.m : p.ansDisp);
  }));
  // 模範解答を入力したら必ず ok になること（丸めた答えが弾かれないことの保証）
  ok('全問で 模範解答を入力すると正解になる', M.PROBLEMS.every(function (p) {
    var s = M.sci(p.ansDisp);
    return M.grade(p, p.ansDisp, s ? s.m : p.ansDisp).status === 'ok';
  }));
  ok('q9 は丸めた 13 が正解（13.2 を2桁に）', M.grade(byId('q9'), '13').status === 'ok');
  ok('q9 で 14 は誤り（丸めの範囲外）', M.grade(byId('q9'), '14').status === 'wrong');
  ok('q9 で 13.2 は桁指導（3桁書いている）',
    M.grade(byId('q9'), '13.2').status === 'sigfig');
  ok('q10 は丸めた 67 が正解（67.2 を2桁に）', M.grade(byId('q10'), '67').status === 'ok');
  ok('許容幅は桁が増えるほど狭くなる',
    M.grade(byId('q16'), '0.505').status === 'wrong' &&
    M.grade(byId('q16'), '0.500').status === 'ok');

  section('モデル：未知の位置');
  ok('q1 の未知の量は mole', M.unknownQuantity(byId('q1')) === 'mole');
  ok('q2 の未知の量は mass', M.unknownQuantity(byId('q2')) === 'mass');
  ok('q2 の列は mole が左・mass が右', byId('q2').cols.join() === 'mole,mass');
  ok('q6 の列は mole が左・count が右', byId('q6').cols.join() === 'mole,count');
  ok('q17 の列は count が左・mass が右', byId('q17').cols.join() === 'count,mass');

  // ---- 倍率（たて・よこ） ----
  section('モデル：たての倍率（行→行）');
  ok('q1 は ×1/2', M.factorText(M.factorV(byId('q1'))) === '×1/2');
  ok('q3 は ×1/4', M.factorText(M.factorV(byId('q3'))) === '×1/4');
  ok('q4 は ×3（整数倍）', M.factorText(M.factorV(byId('q4'))) === '×3');
  ok('q6 は ×1/2', M.factorText(M.factorV(byId('q6'))) === '×1/2');
  ok('全問で 基準×たての倍率 が答えと一致', M.PROBLEMS.every(function (p) {
    var u = M.unknownIndex(p);
    return nearRel(M.val(p.base[u]) * M.factorV(p).value, M.solve(p));
  }));

  section('モデル：よこの倍率（列→列）');
  ok('q1 は ×1/18', M.factorText(M.factorH(byId('q1'))) === '×1/18');
  ok('q2 は ×44（整数倍）', M.factorText(M.factorH(byId('q2'))) === '×44');
  ok('q4 は ×12（整数倍）', M.factorText(M.factorH(byId('q4'))) === '×12');
  ok('全問で 既知の値×よこの倍率 が答えと一致', M.PROBLEMS.every(function (p) {
    var k = 1 - M.unknownIndex(p);
    return nearRel(M.val(p.target[k]) * M.factorH(p).value, M.solve(p));
  }));
  ok('たてとよこの倍率は別の値（q1）',
    !near(M.factorV(byId('q1')).value, M.factorH(byId('q1')).value));

  section('モデル：倍率の書き方（分数か小数か）');
  ok('1/2 は分数で書く', M.factorForm({ value: 0.5, n: 1, d: 2 }).kind === 'frac');
  ok('3/4 は分数で書く', M.factorForm({ value: 0.75, n: 3, d: 4 }).kind === 'frac');
  ok('112/5 は小数 22.4 で書く（分数だと読めない）', (function () {
    var f = M.factorForm({ value: 22.4, n: 112, d: 5 });
    return f.kind === 'dec' && f.text === '22.4';
  })());
  ok('3/10 は小数 0.3 で書く（分母が 10ⁿ）', (function () {
    var f = M.factorForm({ value: 0.3, n: 3, d: 10 });
    return f.kind === 'dec' && f.text === '0.3';
  })());
  ok('1/18 は小数にできないので分数のまま',
    M.factorForm({ value: 1 / 18, n: 1, d: 18 }).kind === 'frac');
  ok('整数倍は整数で書く', M.factorForm({ value: 44, n: 44, d: 1 }).kind === 'int');
  ok('短い小数の判定: 22.4 → "22.4"', M.shortDecimal(22.4) === '22.4');
  ok('短い小数の判定: 1/18 は null', M.shortDecimal(1 / 18) === null);
  ok('短い小数の判定: 6.0×10²³ は大きすぎて null', M.shortDecimal(6e23) === null);

  section('モデル：倍率の扱いやすさ（effort）');
  ok('×3 は即答（0）', M.effort({ value: 3, n: 3, d: 1 }) === 0);
  ok('×44 は簡単（1）', M.effort({ value: 44, n: 44, d: 1 }) === 1);
  ok('×1/2 は簡単（1）', M.effort({ value: 0.5, n: 1, d: 2 }) === 1);
  ok('×22.4 は小数ならできる（2）', M.effort({ value: 22.4, n: 112, d: 5 }) === 2);
  ok('×1/18 はつらい（3）', M.effort({ value: 1 / 18, n: 1, d: 18 }) === 3);
  ok('×6.0×10²³ はつらい（3）', M.effort({ value: 6e23, n: 6e23, d: 1 }) === 3);

  section('モデル：どちら向きが楽かの判定');
  ok('q1 は たて が楽（よこは 1/18）', M.recommend(byId('q1')) === 'v');
  ok('q2 は どちらでも大差ない（1/4 と ×44）', M.recommend(byId('q2')) === 'either');
  ok('q3 は たて が楽', M.recommend(byId('q3')) === 'v');
  ok('q4 は どちらでも大差ない（×3 と ×12）', M.recommend(byId('q4')) === 'either');
  ok('q5 は たて が楽（よこは 1/40）', M.recommend(byId('q5')) === 'v');
  ok('q6 は たて が楽（よこは 6.0×10²³ 倍）', M.recommend(byId('q6')) === 'v');
  ok('q10 は たて ×3 が楽（よこは ×22.4）', M.recommend(byId('q10')) === 'v');
  ok('q10 のよこは ×22.4 と小数で書かれる',
    M.factorText(M.factorH(byId('q10'))) === '×22.4');
  ok('q14 は どちらでも大差ない（1/4 と ×64）', M.recommend(byId('q14')) === 'either');
  // よこが楽な問題（たてが ×3/10 で扱いにくく、よこは ×44 で済む）
  ok('q9 は よこ が楽', M.recommend(byId('q9')) === 'h');
  ok('q9 のよこの倍率は ×44', M.factorText(M.factorH(byId('q9'))) === '×44');
  ok('q9 のたての倍率 3/10 は暗算しにくい', !M.isEasy(M.factorV(byId('q9'))));
  ok('推奨は必ず v / h / either のどれか', M.PROBLEMS.every(function (p) {
    return ['v', 'h', 'either'].indexOf(M.recommend(p)) >= 0;
  }));
  ok('よこが楽な問題が少なくとも1問ある', M.PROBLEMS.some(function (p) {
    return M.recommend(p) === 'h';
  }));
  ok('×1/2 は暗算できる倍率', M.isEasy(M.factorV(byId('q1'))));
  ok('×1/18 は暗算しにくい倍率', !M.isEasy(M.factorH(byId('q1'))));
  ok('×117/2（=58.5）は暗算しにくい', !M.isEasy({ value: 58.5, n: 117, d: 2 }));
  ok('×3/4 は暗算できる', M.isEasy({ value: 0.75, n: 3, d: 4 }));

  section('モデル：極小の倍率を整数倍と誤判定しない');
  ok('18/(6.0×10²³) は分数にならない（null）', M.ratio(18 / 6.0e23) === null);
  ok('q17 のよこの倍率は暗算できない', !M.isEasy(M.factorH(byId('q17'))));
  ok('q17 は たて が楽（よこは 3.0×10⁻²³ 倍）', M.recommend(byId('q17')) === 'v');
  ok('極小の倍率は指数表記で示される',
    M.factorText(M.factorH(byId('q17'))).indexOf('×10⁻²³') > 0);

  section('モデル：倍率の入力判定');
  ok('q1 たて に 1/2 は正しい', M.checkFactor(byId('q1'), 'v', '1', '2'));
  ok('q1 たて に 2/1 は誤り', !M.checkFactor(byId('q1'), 'v', '2', '1'));
  ok('q1 よこ に 1/18 は正しい', M.checkFactor(byId('q1'), 'h', '1', '18'));
  ok('q1 よこ に 1/2 は誤り（向きが違う）', !M.checkFactor(byId('q1'), 'h', '1', '2'));
  ok('分母 0 は誤り', !M.checkFactor(byId('q1'), 'v', '1', '0'));
  ok('空欄は誤り', !M.checkFactor(byId('q1'), 'v', '', '2'));
  ok('約分していない 2/4 も正しい', M.checkFactor(byId('q1'), 'v', '2', '4'));
  ok('小数 0.5/1 も正しい', M.checkFactor(byId('q1'), 'v', '0.5', '1'));

  // ---- 有効数字 ----
  section('モデル：有効数字の桁数');
  ok('"0.50" は2桁', M.sigFigRange('0.50').min === 2 && M.sigFigRange('0.50').max === 2);
  ok('"0.5" は1桁', M.sigFigRange('0.5').max === 1);
  ok('"11" は2桁', M.sigFigRange('11').min === 2);
  ok('"3.0" は2桁', M.sigFigRange('3.0').min === 2);
  ok('"0.25" は2桁', M.sigFigRange('0.25').min === 2);
  ok('"20" は1〜2桁の曖昧（範囲で返す）',
    M.sigFigRange('20').min === 1 && M.sigFigRange('20').max === 2);
  ok('2桁要求に "0.50" は合格', M.sigFigOk(2, '0.50'));
  ok('2桁要求に "0.5" は不合格', !M.sigFigOk(2, '0.5'));
  ok('2桁要求に "20"（曖昧）は合格', M.sigFigOk(2, '20'));
  ok('全問に有効数字の指定がある', M.PROBLEMS.every(function (p) { return !!p.sigfigs; }));
  ok('3桁を要求する問題がある（末尾の0を書かせる）', M.PROBLEMS.some(function (p) {
    return p.sigfigs === 3;
  }));
  ok('q8 は 0.2 では桁不足', M.grade(byId('q8'), '0.2').status === 'sigfig');
  ok('q8 は 0.200 で正解', M.grade(byId('q8'), '0.200').status === 'ok');
  ok('q16 は 0.50 では桁不足', M.grade(byId('q16'), '0.50').status === 'sigfig');
  ok('q16 は 0.500 で正解', M.grade(byId('q16'), '0.500').status === 'ok');

  section('モデル：採点（値・桁・倍率の逆さま）');
  ok('0.50 は ok', M.grade(byId('q1'), '0.50').status === 'ok');
  ok('0.5 は sigfig（値は合っている）', M.grade(byId('q1'), '0.5').status === 'sigfig');
  ok('sigfig のとき要求桁が返る', M.grade(byId('q1'), '0.5').need === 2);
  ok('162 は flip（倍率が逆さま）', M.grade(byId('q1'), '162').status === 'flip');
  ok('7 は wrong', M.grade(byId('q1'), '7').status === 'wrong');
  ok('文字列は wrong', M.grade(byId('q1'), 'abc').status === 'wrong');
  ok('q6 は仮数の桁で判定する（3.0 → ok）',
    M.grade(byId('q6'), '3.0e23', '3.0').status === 'ok');
  ok('q6 で仮数 3 は sigfig', M.grade(byId('q6'), '3e23', '3').status === 'sigfig');

  // 12×10²³ は 1.2×10²⁴ と同じ値なので、値だけ見ていると通ってしまう
  section('モデル：指数表記の書き方（仮数は 1〜10）');
  ok('仮数 1.2 は正規形', M.sciNormalized('1.2'));
  ok('仮数 12 は正規形でない', !M.sciNormalized('12'));
  ok('仮数 0.12 は正規形でない', !M.sciNormalized('0.12'));
  ok('q12 は 1.2×10²⁴ で正解', M.grade(byId('q12'), '1.2e24', '1.2').status === 'ok');
  ok('q12 の 12×10²³ は sciform（値は正しいが書き方が誤り）',
    M.grade(byId('q12'), '12e23', '12').status === 'sciform');
  ok('q12 の 0.12×10²⁵ も sciform',
    M.grade(byId('q12'), '0.12e25', '0.12').status === 'sciform');
  ok('sciform には入力した仮数が入る',
    M.grade(byId('q12'), '12e23', '12').mantissa === '12');
  ok('値が違えば sciform より wrong が優先',
    M.grade(byId('q12'), '99e23', '99').status === 'wrong');

  // ---- 単位ミスマッチ ----
  section('モデル：単位ミスマッチの説明文');
  ok('正しい単位ならミスマッチなし', M.mismatch(byId('q3'), 'mole') === null);
  var mmV = M.mismatch(byId('q3'), 'volume');
  ok('mol の欄に L を選ぶとミスマッチ', mmV !== null);
  ok('説明文が両方の単位を名指しする',
    mmV && mmV.text.indexOf('mol') >= 0 && mmV.text.indexOf('L') >= 0);
  ok('説明文が「たての列」に言及する', mmV && mmV.text.indexOf('たての列') >= 0);
  ok('g の欄に 個 を選ぶとミスマッチ',
    (M.mismatch(byId('q4'), 'count') || {}).text.indexOf('個') >= 0);

  // ---- 分数⇔小数の対照表 ----
  section('モデル：分数と小数の対照表');
  var ft1 = M.fractionTable(byId('q1'));
  ok('対照表が10行以上ある', ft1.length >= 10);
  ok('1/2 の小数が 0.5', ft1.some(function (f) {
    return f.n === 1 && f.d === 2 && f.dec === '0.5';
  }));
  ok('1/3 は割り切れないので … 付き', ft1.some(function (f) {
    return f.n === 1 && f.d === 3 && f.dec.indexOf('…') > 0;
  }));
  ok('q1 で使う 1/2 に used 印が付く', ft1.some(function (f) {
    return f.n === 1 && f.d === 2 && f.used;
  }));
  ok('q1 で使わない 1/5 には印が付かない', ft1.some(function (f) {
    return f.n === 1 && f.d === 5 && !f.used;
  }));
  ok('q4 は よこの ×12 も used になる', M.fractionTable(byId('q4')).some(function (f) {
    return f.n === 12 && f.d === 1 && f.used;
  }));
  ok('対照表は値の小さい順に並ぶ', ft1.every(function (f, i) {
    return i === 0 || ft1[i - 1].n / ft1[i - 1].d <= f.n / f.d;
  }));

  // ---- データの健全性 ----
  section('モデル：問題データの健全性');
  ok('全問で未知はちょうど1つ', M.PROBLEMS.every(function (p) {
    return (p.target[0] === null ? 1 : 0) + (p.target[1] === null ? 1 : 0) === 1;
  }));
  ok('基準の行に null はない', M.PROBLEMS.every(function (p) {
    return p.base[0] !== null && p.base[1] !== null;
  }));
  ok('列の量は2種類とも既知の定義', M.PROBLEMS.every(function (p) {
    return M.QUANTITIES[p.cols[0]] && M.QUANTITIES[p.cols[1]] && p.cols[0] !== p.cols[1];
  }));
  ok('steps.unit の問題は choices を4つ持つ', M.PROBLEMS.every(function (p) {
    return !(p.steps && p.steps.unit) || (p.choices && p.choices.length === 4);
  }));
  ok('choices に正解の量が含まれる', M.PROBLEMS.every(function (p) {
    return !(p.steps && p.steps.unit) || p.choices.indexOf(M.unknownQuantity(p)) >= 0;
  }));
  ok('choices に重複がない', M.PROBLEMS.every(function (p) {
    return !(p.steps && p.steps.unit) || new Set(p.choices).size === 4;
  }));
  ok('全問の答えが有限の正数', M.PROBLEMS.every(function (p) {
    var v = M.solve(p);
    return isFinite(v) && v > 0;
  }));
  ok('全問で逆さまの値が正解と別の値', M.PROBLEMS.every(function (p) {
    return !nearRel(M.flippedAnswer(p), M.solve(p));
  }));
  ok('全問で少なくとも片方の向きが暗算できる', M.PROBLEMS.every(function (p) {
    return M.isEasy(M.factorV(p)) || M.isEasy(M.factorH(p));
  }));
  ok('全問で推奨された向きの倍率が暗算できる', M.PROBLEMS.every(function (p) {
    var r = M.recommend(p);
    return r === 'either' || M.isEasy(M.factorOf(p, r));
  }));
  ok('4つの量すべてが問題に登場する', ['mass', 'mole', 'volume', 'count'].every(function (q) {
    return M.PROBLEMS.some(function (p) { return p.cols.indexOf(q) >= 0; });
  }));
  ok('4つの量すべてが「問われる量」になる', ['mass', 'mole', 'volume', 'count'].every(function (q) {
    return M.PROBLEMS.some(function (p) { return M.unknownQuantity(p) === q; });
  }));
  ok('足場の3段階がすべて登場する',
    M.PROBLEMS.some(function (p) { return !p.steps.unit && !p.steps.factor; }) &&
    M.PROBLEMS.some(function (p) { return p.steps.unit && !p.steps.factor; }) &&
    M.PROBLEMS.some(function (p) { return p.steps.factor; }));
  ok('単位の4択は正解の位置が固定されていない', (function () {
    var pos = M.PROBLEMS.filter(function (p) { return p.choices; })
      .map(function (p) { return p.choices.indexOf(M.unknownQuantity(p)); });
    return new Set(pos).size > 1;
  })());

  // SVG の <text> は <sup> を描画しないので Unicode に直す必要がある
  section('モデル：SVG 用のラベル変換');
  ok('<sup>35</sup>Cl → ³⁵Cl', M.plainLabel('<sup>35</sup>Cl') === '³⁵Cl');
  ok('N<sub>2</sub> → N₂', M.plainLabel('N<sub>2</sub>') === 'N₂');
  ok('CO<sub>2</sub> → CO₂', M.plainLabel('CO<sub>2</sub>') === 'CO₂');
  ok('タグのない文字列はそのまま', M.plainLabel('He') === 'He');
  ok('天秤の全ラベルがタグを含まない形に変換できる', M.BALANCE.every(function (p) {
    return p.items.every(function (it) {
      return M.plainLabel(it.label).indexOf('<') < 0;
    });
  }));

  section('モデル：数値の表示');
  ok('18 → "18"', M.fmt(18) === '18');
  ok('null → ""', M.fmt(null) === '');
  ok('文字列 "9.0" は末尾の0を保つ', M.disp('9.0') === '9.0');
  ok('文字列 "9.0" は計算では 9', M.val('9.0') === 9);
  ok('"6.0e23" → 6.0×10²³', M.disp('6.0e23') === '6.0×10²³');
  ok('sci が仮数と指数に分解', M.sci('6.0e23').m === '6.0' && M.sci('6.0e23').e === '23');
  ok('通常の数は sci で null', M.sci('18') === null);
  ok('大きい整数倍は指数表記になる', M.numText(6e23).indexOf('×10') > 0);

  // ---- 天秤（加重平均） ----
  function balById(id) {
    for (var i = 0; i < M.BALANCE.length; i++) if (M.BALANCE[i].id === id) return M.BALANCE[i];
    return null;
  }

  section('モデル：天秤の加重平均');
  ok('天秤の問題は8問ある', M.BALANCE.length === 8);
  ok('b1 塩素の平均原子量は 35.5', near(M.balAverage(balById('b1')), 35.5));
  ok('b3 銅の平均原子量は 63.616', near(M.balAverage(balById('b3')), 63.616));
  ok('b4 ホウ素の平均原子量は 10.801', near(M.balAverage(balById('b4')), 10.801));
  ok('b5 空気の平均分子量は 28.8', near(M.balAverage(balById('b5')), 28.8));
  ok('b7 1:1 なら真ん中の 3.0', near(M.balAverage(balById('b7')), 3.0));
  ok('平均は必ず2つの値のあいだに来る', M.BALANCE.every(function (p) {
    var a = M.balAverage(p);
    return a >= M.val(p.items[0].value) && a <= M.val(p.items[1].value);
  }));
  ok('答えの表記が桁を満たす', M.BALANCE.every(function (p) {
    return !p.ansDisp || M.sigFigOk(p.sig, p.ansDisp);
  }));
  ok('b1 の表記は 35.5（3桁）', balById('b1').ansDisp === '35.5');
  ok('b3 の表記は 63.6（3桁に丸める）', balById('b3').ansDisp === '63.6');

  section('モデル：内分比と区間の等分');
  ok('b1 の内分比は 1 : 3（35 と 37 の間を 1:3）',
    M.balArmRatio(balById('b1')).n === 1 && M.balArmRatio(balById('b1')).d === 3);
  ok('内分比と個数の比は互いに逆', M.BALANCE.every(function (p) {
    var a = M.balArmRatio(p), r = M.balRatio(p);
    return !a || !r || (a.n === r.d && a.d === r.n);
  }));
  ok('b1 は 4等分で支点が目盛りに乗る', M.divisionsFor(balById('b1')) === 4);
  ok('b5 空気は 5等分', M.divisionsFor(balById('b5')) === 5);
  ok('b7 1:1 は 2等分', M.divisionsFor(balById('b7')) === 2);
  ok('b8 は 4等分', M.divisionsFor(balById('b8')) === 4);
  ok('b3 は簡単な等分では乗らない（null）', M.divisionsFor(balById('b3')) === null);
  ok('b4 も乗らない（1000等分が必要）', M.divisionsFor(balById('b4')) === null);

  section('モデル：腕の長さと個数の逆比');
  ok('b1 の腕は 0.5 と 1.5', (function () {
    var a = M.balArms(balById('b1'));
    return near(a[0], 0.5) && near(a[1], 1.5);
  })());
  ok('b2 塩素の存在比は 3 : 1',
    M.balRatio(balById('b2')).n === 3 && M.balRatio(balById('b2')).d === 1);
  ok('b6 空気の体積比は 4 : 1',
    M.balRatio(balById('b6')).n === 4 && M.balRatio(balById('b6')).d === 1);
  ok('b8 CO : CO2 は 3 : 1',
    M.balRatio(balById('b8')).n === 3 && M.balRatio(balById('b8')).d === 1);
  ok('腕が短いほうが個数が多い（b2）', (function () {
    var p = balById('b2'), a = M.balArms(p), r = M.balRatio(p);
    return (a[0] < a[1]) === (r.n > r.d);
  })());
  ok('個数の比から平均を作ると元に戻る（b2）', (function () {
    var p = balById('b2'), r = M.balRatio(p);
    var items = [{ value: p.items[0].value, amount: r.n }, { value: p.items[1].value, amount: r.d }];
    return near(M.weightedAverage(items), M.val(p.average));
  })());

  section('モデル：比の入力判定');
  ok('b2 に 3:1 は正しい', M.checkBalRatio(balById('b2'), '3', '1'));
  ok('b2 に 6:2 も正しい（約分前）', M.checkBalRatio(balById('b2'), '6', '2'));
  ok('b2 に 75:25 も正しい（％のまま）', M.checkBalRatio(balById('b2'), '75', '25'));
  ok('b2 に 1:3 は誤り（逆）', !M.checkBalRatio(balById('b2'), '1', '3'));
  ok('0 を含む比は誤り', !M.checkBalRatio(balById('b2'), '3', '0'));
  ok('空欄は誤り', !M.checkBalRatio(balById('b2'), '', '1'));

  section('モデル：天秤の採点');
  ok('b1 は 35.5 で正解', M.gradeBalance(balById('b1'), '35.5').status === 'ok');
  ok('b1 は 35.50 は桁指導（4桁）', M.gradeBalance(balById('b1'), '35.50').status === 'sigfig');
  ok('b3 は丸めた 63.6 で正解', M.gradeBalance(balById('b3'), '63.6').status === 'ok');
  ok('b3 は 63.616 は桁指導', M.gradeBalance(balById('b3'), '63.616').status === 'sigfig');
  // 多い少ないを取り違えた位置（真ん中を挟んで反対側）を名指しする
  ok('b3 で 64.4 は「逆」と判定', M.gradeBalance(balById('b3'), '64.4').status === 'flip');
  ok('b1 で 36.5 は「逆」と判定', M.gradeBalance(balById('b1'), '36.5').status === 'flip');
  ok('範囲外の 40 は wrong', M.gradeBalance(balById('b1'), '40').status === 'wrong');
  ok('b7 は 1:1 なので逆位置がなく flip にならない',
    M.gradeBalance(balById('b7'), '2.5').status === 'wrong');
  ok('全問で模範解答が正解になる', M.BALANCE.filter(function (p) {
    return p.kind === 'average';
  }).every(function (p) {
    return M.gradeBalance(p, p.ansDisp).status === 'ok';
  }));

  // ---- 反応の量的関係（M3）----
  var R = M.REACTIONS;
  function rById(id) {
    for (var i = 0; i < R.length; i++) if (R[i].id === id) return R[i];
    return null;
  }

  section('モデル：反応データの健全性');
  ok('反応の問題は18問ある', R.length === 18);
  ok('id に重複がない', new Set(R.map(function (p) { return p.id; })).size === 18);
  ok('参照する物質がすべて存在する', R.every(function (p) {
    return p.eq.every(function (t) { return !!M.SUBSTANCES[t.sub]; });
  }));
  // 「係数は与えられたものとして扱い、係数を求めさせる問題は作らない」（ion-equation との棲み分け）
  ok('すべての項に係数が与えられている', R.every(function (p) {
    return p.eq.every(function (t) { return typeof t.coef === 'number' && t.coef >= 1; });
  }));
  ok('どの問題にも反応物と生成物がある', R.every(function (p) {
    return M.reactants(p).length >= 1 && M.products(p).length >= 1;
  }));
  ok('問われる物質は反応式に含まれる', R.every(function (p) {
    return !!M.termOf(p, p.asked);
  }));
  ok('与えられた量はすべて反応物', R.every(function (p) {
    return Object.keys(p.given).every(function (k) {
      var t = M.termOf(p, k);
      return t && !t.product;
    });
  }));
  ok('問題文が与えられた量から作られる',
    rById('r1').title.indexOf('0.20 mol') > 0);
  ok('反応式の文字列が作られる（係数1は書かない）',
    rById('r1').eqText.indexOf('→') > 0 &&
    rById('r1').eqText.indexOf('2H<sub>2</sub>O') > 0);
  ok('答えの表記は有効数字から機械的に決まる', R.every(function (p) {
    return p.ansDisp === M.toSig(M.stoichAnswer(p), p.sig);
  }));

  section('モデル：反応前の量（十分量と生成物）');
  ok('生成物の反応前は 0', M.beforeOf(rById('r1'), 'H2O') === 0);
  ok('given に無い反応物は十分量（null）', M.beforeOf(rById('r1'), 'H2') === null);
  ok('given がある反応物はその値', M.beforeOf(rById('r1'), 'O2') === 0.2);
  ok('十分量の反応物は反応後も分からない', M.afterOf(rById('r1'), 'H2') === null);

  section('モデル：倍率（反応が何 mol 分進むか）');
  ok('r1 の倍率は 0.20（0.20 ÷ 係数1）', near(M.progress(rById('r1')), 0.20));
  ok('r2 の倍率は 0.50', near(M.progress(rById('r2')), 0.50));
  ok('r3 の倍率は 0.20（0.40 ÷ 係数2）', near(M.progress(rById('r3')), 0.20));
  ok('変化量は 係数 × 倍率（反応物は負）',
    near(M.changeOf(rById('r1'), 'H2'), -0.40));
  ok('変化量は 係数 × 倍率（生成物は正）',
    near(M.changeOf(rById('r1'), 'H2O'), 0.40));
  ok('反応後 ＝ 反応前 ＋ 変化量',
    near(M.afterOf(rById('r5'), 'H2'), 0.10));
  ok('限定反応物は反応後に 0 になる',
    near(M.afterOf(rById('r5'), 'O2'), 0));

  section('モデル：過不足（候補倍率の比べっこ）');
  ok('候補倍率は mol ÷ 係数', (function () {
    var cs = M.candidates(rById('r5'));
    return near(cs[0].quotient, 0.15) && near(cs[1].quotient, 0.10);
  })());
  ok('r5 は O2 が先に足りなくなる',
    M.limiting(rById('r5')).join() === 'O2');
  ok('多いほうが余るとは限らない（H2 0.30 のほうが多いが余る）',
    M.excessSubs(rById('r5')).join() === 'H2');
  ok('r6 は H2 が限定反応物（0.30 ÷ 3 ＝ 0.10）',
    M.limiting(rById('r6')).join() === 'H2');
  ok('r7 は CaCO3 が限定反応物',
    M.limiting(rById('r7')).join() === 'CaCO3');
  ok('r8 は O2 が限定反応物', M.limiting(rById('r8')).join() === 'O2');
  ok('r4 はちょうど反応（両方が同時に無くなる）', M.isExact(rById('r4')));
  ok('r5 はちょうど反応ではない', !M.isExact(rById('r5')));
  ok('量が1つだけの問題は過不足を考えない', !M.isExcess(rById('r1')));
  ok('ちょうど反応では限定反応物が2つ返る', M.limiting(rById('r4')).length === 2);
  ok('余るほうを選ぶと不正解', !M.checkLimiting(rById('r5'), 'H2'));
  ok('先に無くなるほうを選ぶと正解', M.checkLimiting(rById('r5'), 'O2'));
  ok('正解の選択肢を返せる', M.limitAnswer(rById('r5')) === 'O2');

  // ちょうど反応は「先に足りなくなるほう」が**存在しない**ので、
  // 限定反応物をえらばせる問いを作ってはいけない（そういう問題は見せるだけにする）。
  // これはデータ側の約束なのでここで固定する
  ok('ちょうど反応の問題に「えらばせる段」を付けない', R.every(function (p) {
    return !(p.steps.limit && M.isExact(p));
  }));
  ok('えらばせる問題には必ず限定反応物が1つある', R.every(function (p) {
    return !p.steps.limit || M.limiting(p).length === 1;
  }));
  ok('えらばせる問題では正解の選択肢が実際に正解になる', R.every(function (p) {
    return !p.steps.limit || M.checkLimiting(p, M.limitAnswer(p));
  }));
  ok('ちょうど反応ではどちらを選んでも正解にしない',
    !M.checkLimiting(rById('r4'), 'NaOH') && !M.checkLimiting(rById('r4'), 'HCl'));

  // ---- 仮説テスト「もし◯◯を使い切るなら？」----
  // 「量 ÷ 係数 の小さいほう」は結論だけで、なぜそう計算するのかが見えない。
  // 使い切ると仮定して、もう一方が足りるかを確かめる道筋を用意する
  section('モデル：仮説テスト（もし◯◯を使い切るなら？）');
  ok('N2 を使い切る仮定では H2 が 0.60 必要（＝3倍）', (function () {
    var h = M.hypothesis(rById('r6'), 'N2');
    var h2 = h.items.filter(function (i) { return i.sub === 'H2'; })[0];
    return near(h.x, 0.20) && near(h2.need, 0.60) && near(h2.held, 0.30);
  })());
  ok('その仮定は H2 が 0.30 足りないので成り立たない', (function () {
    var h = M.hypothesis(rById('r6'), 'N2');
    var h2 = h.items.filter(function (i) { return i.sub === 'H2'; })[0];
    return !h.feasible && near(h2.gap, 0.30);
  })());
  ok('H2 を使い切る仮定では N2 が 0.10 必要（＝1/3倍）', (function () {
    var h = M.hypothesis(rById('r6'), 'H2');
    var n2 = h.items.filter(function (i) { return i.sub === 'N2'; })[0];
    return near(h.x, 0.10) && near(n2.need, 0.10);
  })());
  ok('その仮定は成り立ち、N2 が 0.10 余る', (function () {
    var h = M.hypothesis(rById('r6'), 'H2');
    var n2 = h.items.filter(function (i) { return i.sub === 'N2'; })[0];
    return h.feasible && near(n2.gap, -0.10);
  })());
  ok('使い切ると仮定した物質は必ず「ちょうど」になる', (function () {
    var h = M.hypothesis(rById('r6'), 'H2');
    return near(h.items.filter(function (i) { return i.sub === 'H2'; })[0].gap, 0);
  })());
  ok('成り立つ仮定の倍率は反応が進む量と一致する',
    near(M.feasibleHypothesis(rById('r6')).x, M.progress(rById('r6'))));
  // 直感の道筋と公式が同じ結論に着くことを固定する（これが両者をつなぐ保証）
  ok('成り立つ仮定の物質＝限定反応物（えらばせる全問で一致）', R.every(function (p) {
    if (!p.steps.limit) return true;
    var h = M.feasibleHypothesis(p);
    return !!h && h.sub === M.limitAnswer(p);
  }));
  ok('成り立たない仮定はちょうど1つある（過不足のある問題）', R.every(function (p) {
    if (!p.steps.limit) return true;
    var bad = M.knownCandidates(p).filter(function (c) {
      return !M.hypothesis(p, c.sub).feasible;
    });
    return bad.length === 1;
  }));
  ok('L のままでも仮説テストが成り立つ（r18）', (function () {
    var h = M.hypothesis(rById('r18'), 'CH4');
    var o2 = h.items.filter(function (i) { return i.sub === 'O2'; })[0];
    return !h.feasible && near(o2.need, 4.0) && near(o2.gap, 1.0) &&
           M.feasibleHypothesis(rById('r18')).sub === 'O2';
  })());
  ok('ちょうど反応ではどちらの仮定も成り立つ', (function () {
    var p = rById('r4');
    return M.hypothesis(p, 'NaOH').feasible && M.hypothesis(p, 'HCl').feasible;
  })());

  section('モデル：反応の答え');
  ok('r1 必要な H2 は 0.40 mol', near(M.stoichAnswer(rById('r1')), 0.40));
  ok('r2 生成する H2O は 1.0 mol', near(M.stoichAnswer(rById('r2')), 1.0));
  ok('r3 生成する H2 は 0.60 mol', near(M.stoichAnswer(rById('r3')), 0.60));
  ok('r4 生成する NaCl は 0.20 mol', near(M.stoichAnswer(rById('r4')), 0.20));
  ok('r5 生成する H2O は 0.20 mol', near(M.stoichAnswer(rById('r5')), 0.20));
  ok('r6 生成する NH3 は 0.20 mol', near(M.stoichAnswer(rById('r6')), 0.20));
  ok('r7 生成する CO2 は 0.10 mol', near(M.stoichAnswer(rById('r7')), 0.10));
  ok('r8 残る CH4 は 0.10 mol', near(M.stoichAnswer(rById('r8')), 0.10));

  section('モデル：反応の典型的な誤り');
  ok('r1 係数を逆さまに使うと 0.10', near(M.flippedStoich(rById('r1')), 0.10));
  ok('r2 係数を逆さまに使うと 0.25', near(M.flippedStoich(rById('r2')), 0.25));
  ok('係数が同じなら逆さまの誤りは存在しない', M.flippedStoich(rById('r4')) === null);
  ok('余るほうで計算すると r5 は 0.30', near(M.wrongLimitAnswer(rById('r5')), 0.30));
  ok('余るほうで計算すると r7 は 0.15', near(M.wrongLimitAnswer(rById('r7')), 0.15));
  ok('ちょうど反応には取り違えの誤答がない',
    M.wrongLimitAnswer(rById('r4')) === null);
  ok('過不足のない問題には取り違えの誤答がない',
    M.wrongLimitAnswer(rById('r1')) === null);

  section('モデル：反応の採点');
  ok('全問で模範解答が正解になる', R.every(function (p) {
    return M.gradeStoich(p, p.ansDisp).status === 'ok';
  }));
  ok('桁が違えば sigfig（値は合っている）',
    M.gradeStoich(rById('r1'), '0.4').status === 'sigfig');
  ok('係数を逆さまに使うと flip',
    M.gradeStoich(rById('r1'), '0.10').status === 'flip');
  ok('余るほうで計算すると limit',
    M.gradeStoich(rById('r5'), '0.30').status === 'limit');
  ok('limit は取り違えた物質を名指しする', (function () {
    var g = M.gradeStoich(rById('r5'), '0.30');
    return g.excess === 'H2' && g.limiting === 'O2';
  })());
  ok('でたらめな値は wrong',
    M.gradeStoich(rById('r5'), '7').status === 'wrong');
  ok('倍率の入力判定（正しい倍率）', M.checkProgress(rById('r5'), '0.10'));
  ok('倍率の入力判定（余るほうの倍率は不正解）', !M.checkProgress(rById('r5'), '0.15'));
  ok('表示は有効数字をそろえる（0 はそのまま）',
    M.stoichDisp(0.1, 2) === '0.10' && M.stoichDisp(0, 2) === '0');

  // ---- g・L で与える／答える（mol にそろえる段が前後に付く）----
  section('モデル：mol にそろえる（入口の変換）');
  ok('mol で与えた問題には変換の段がない', M.convTargets(rById('r5')).length === 0);
  ok('質量で与えた問題は変換が要る', M.convTargets(rById('r9')).join() === 'CaCO3');
  ok('両方を質量で与えた問題は変換が2つ',
    M.convTargets(rById('r13')).join() === 'H2,O2');
  ok('質量 25 g は 0.25 mol になる（÷100）',
    near(M.beforeOf(rById('r9'), 'CaCO3'), 0.25));
  ok('質量 0.60 g の H2 は 0.30 mol（÷2.0）',
    near(M.beforeOf(rById('r13'), 'H2'), 0.30));
  ok('体積 11.2 L は 0.50 mol（÷22.4）',
    near(M.beforeOf(rById('r16'), 'CH4'), 0.50));
  ok('変換の入力判定（正しい値）', M.checkConv(rById('r9'), 'CaCO3', '0.25'));
  ok('変換の入力判定（g のまま入れたら不正解）',
    !M.checkConv(rById('r9'), 'CaCO3', '25'));
  ok('変換の根拠を言葉にする',
    M.perMolText('CaCO3', 'mass').indexOf('1 mol ＝ 100 g') > 0);
  ok('体積の根拠は物質によらない',
    M.perMolText('N2', 'volume').indexOf('22.4 L') > 0);

  section('モデル：単位を戻す（出口の変換）');
  ok('mol で答える問題には出口がない', !M.hasOut(rById('r5')));
  ok('g で答える問題には出口がある', M.hasOut(rById('r10')));
  ok('r10 の表の中の答えは 1.0 mol', near(M.tableAnswer(rById('r10')), 1.0));
  ok('r10 の解答は 18 g（1.0 mol × 18）', near(M.stoichAnswer(rById('r10')), 18));
  ok('r11 の解答は 11.2 L（0.500 mol × 22.4）',
    near(M.stoichAnswer(rById('r11')), 11.2));
  ok('r12 は 6.0 g → 0.50 mol → 22 g', (function () {
    var p = rById('r12');
    return near(M.beforeOf(p, 'C'), 0.50) && near(M.tableAnswer(p), 0.50) &&
           near(M.stoichAnswer(p), 22);
  })());
  ok('r13 は 0.30/0.10 mol → 0.20 mol → 3.6 g', (function () {
    var p = rById('r13');
    return near(M.progress(p), 0.10) && near(M.tableAnswer(p), 0.20) &&
           near(M.stoichAnswer(p), 3.6);
  })());
  ok('r13 は O2 が限定反応物（質量では H2 のほうが軽い）',
    M.limiting(rById('r13')).join() === 'O2');
  ok('r16 は 11.2 L → 0.50 mol → 18 g', (function () {
    var p = rById('r16');
    return near(M.progress(p), 0.50) && near(M.tableAnswer(p), 1.0) &&
           near(M.stoichAnswer(p), 18);
  })());
  ok('表の中の答え（mol）の入力判定', M.checkTable(rById('r10'), '1.0'));
  ok('単位を戻した値を mol 欄に入れても通らない', !M.checkTable(rById('r10'), '18'));
  // 誤答の再現も**答えの単位**でなければ採点が噛み合わない
  ok('係数を逆さまに使った誤答も g に直して比べる',
    near(M.flippedStoich(rById('r10')), 0.25 * 18));
  ok('限定反応物を取り違えた誤答も g に直して比べる',
    near(M.wrongLimitAnswer(rById('r13')), 0.30 * 18));
  ok('g で答える問題も模範解答で正解になる', R.filter(M.hasOut).every(function (p) {
    return M.gradeStoich(p, p.ansDisp).status === 'ok';
  }));
  ok('g で答える問題で取り違え誤答が limit になる',
    M.gradeStoich(rById('r13'), '5.4').status === 'limit');

  // ---- 【mol を使わなくてよいときは使わない】 ----
  // 係数の比をその単位のまま使えるのは、その量が物質によらず mol に比例するときだけ
  section('モデル：mol を経由しない条件');
  ok('体積は係数の比に乗る（やりとりする物質が気体なら）',
    M.coefProportional(rById('r15'), 'volume'));
  ok('粒子の数はどの物質でも係数の比に乗る',
    M.coefProportional(rById('r15'), 'count'));
  // 気体かどうかを問うのは**量をやりとりする物質だけ**。
  // メタンの燃焼で水が生じても、水の量を問わないなら L で通せる
  ok('量をやりとりするのは与えられた物質と問われる物質',
    M.measuredSubs(rById('r17')).sort().join() === 'CH4,O2');
  ok('水が生じる式でも、水の量を問わないなら L が使える',
    M.coefProportional(rById('r17'), 'volume') &&
    M.workUnit(rById('r17')) === 'volume');
  ok('水の量そのものを問うときは L が使えない',
    !M.coefProportional(rById('r16'), 'volume') &&
    M.workUnit(rById('r16')) === 'mole');
  ok('L で通すとき、気体でない物質の値は仮想値として印を付ける',
    M.isVirtual(rById('r17'), 'H2O') && M.virtualSubs(rById('r17')).join() === 'H2O');
  ok('気体の列には仮想の印を付けない',
    !M.isVirtual(rById('r17'), 'CO2') && !M.isVirtual(rById('r17'), 'CH4'));
  ok('mol で計算する問題には仮想値がない',
    M.virtualSubs(rById('r16')).length === 0 &&
    M.virtualSubs(rById('r13')).length === 0);
  ok('r17 は CH4 2.0 L に必要な O2 が 4.0 L', (function () {
    var p = rById('r17');
    return near(M.progress(p), 2.0) && near(M.stoichAnswer(p), 4.0);
  })());
  ok('r17 の水の変化量は仮想の 4.0 L（2×2.0）',
    near(M.changeOf(rById('r17'), 'H2O'), 4.0));
  ok('r18 は 2.0/3.0 L → CO2 1.5 L（O2 が限定）', (function () {
    var p = rById('r18');
    return M.limiting(p).join() === 'O2' && near(M.progress(p), 1.5) &&
           near(M.stoichAnswer(p), 1.5) && near(M.afterOf(p, 'CH4'), 0.5);
  })());
  // ここが方針の核心。分子量が物質ごとに違うので g では絶対に比べられない
  ok('質量は係数の比に乗らない（分子量が物質ごとに違う）',
    !M.coefProportional(rById('r13'), 'mass') &&
    !M.coefProportional(rById('r15'), 'mass'));

  ok('気体同士で L → L なら L のまま計算する',
    M.workUnit(rById('r14')) === 'volume' && M.workUnit(rById('r15')) === 'volume');
  ok('L のまま計算するなら換算の段は前後どちらも要らない',
    M.convTargets(rById('r15')).length === 0 && !M.hasOut(rById('r15')));
  ok('g → g は必ず mol を経由する',
    M.workUnit(rById('r13')) === 'mole');
  ok('単位が混ざる（L → g）ときも mol を経由する',
    M.workUnit(rById('r16')) === 'mole' &&
    M.convTargets(rById('r16')).join() === 'CH4' && M.hasOut(rById('r16')));
  ok('mol で与えて L で答えるときは mol で計算して最後に戻す',
    M.workUnit(rById('r11')) === 'mole' && M.hasOut(rById('r11')));

  ok('r14 は 3.0 L → HCl 6.0 L（22.4 を使わない）', (function () {
    var p = rById('r14');
    return near(M.beforeOf(p, 'H2'), 3.0) && near(M.progress(p), 3.0) &&
           near(M.tableAnswer(p), 6.0) && near(M.stoichAnswer(p), 6.0) &&
           p.ansDisp === '6.0';
  })());
  ok('r15 は 2.0/3.0 L → NH3 2.0 L', (function () {
    var p = rById('r15');
    return near(M.progress(p), 1.0) && near(M.stoichAnswer(p), 2.0);
  })());
  ok('r15 は H2 が限定反応物（2.0÷1 と 3.0÷3 を比べる）',
    M.limiting(rById('r15')).join() === 'H2');
  ok('r15 では N2 が 1.0 L 余る', near(M.afterOf(rById('r15'), 'N2'), 1.0));
  ok('L のままでも取り違え誤答を拾える',
    near(M.wrongLimitAnswer(rById('r15')), 4.0) &&
    M.gradeStoich(rById('r15'), '4.0').status === 'limit');
  ok('ヒントがアボガドロの法則を根拠に出す',
    rById('r15').hint.indexOf('アボガドロの法則') > 0 &&
    rById('r15').hint.indexOf('mol に直さなくてよい') > 0);
  ok('mol を経由する問題のヒントは「mol にそろえる」のまま',
    rById('r13').hint.indexOf('mol だけ') > 0);
  // 単位が違えば同じ数値でも別の答え。全問で模範解答が通ることを確認する
  ok('全18問で模範解答が正解になる', R.every(function (p) {
    return M.gradeStoich(p, p.ansDisp).status === 'ok';
  }));

  section('モデル：問題文と誘導（単位が入る）');
  ok('問題文に与えられた単位が出る', rById('r9').title.indexOf('25 g') > 0);
  ok('問題文に問われる単位が出る', rById('r10').title.indexOf('何 g か') > 0);
  ok('体積が絡むと標準状態を前置する',
    rById('r11').title.indexOf('標準状態で') === 0 &&
    rById('r14').title.indexOf('標準状態で') === 0 &&
    rById('r16').title.indexOf('標準状態で') === 0);
  ok('mol だけの問題には標準状態を前置しない',
    rById('r5').title.indexOf('標準状態') < 0);
  // 表に「十分量」と出るのに問題文が何と反応させたか書いていない、という不備があった
  ok('量を指定しない反応物は「十分量の◯◯と」と書く',
    rById('r10').title.indexOf('十分量の 酸素') > 0);
  ok('過不足の問題には十分量の記述が付かない',
    rById('r5').title.indexOf('十分量') < 0);
  ok('問われている物質を十分量とは書かない',
    rById('r1').title.indexOf('十分量') < 0);
  ok('変換が要る問題のヒントは「mol にそろえる」を言う',
    rById('r9').hint.indexOf('mol にそろえる') > 0);
  ok('mol だけの過不足はヒントで「先に足りなくなるほう」を言う',
    rById('r5').hint.indexOf('先に足りなくなるほう') > 0);
  // 問わないことをヒントで言わない（ちょうど反応は先に無くなるほうが存在しない）
  ok('ちょうど反応のヒントは「先に足りなくなるほう」と言わない',
    rById('r4').hint.indexOf('先に足りなくなる') < 0 &&
    rById('r4').hint.indexOf('どちらも余らず') > 0);

  // ---- 中和滴定（M4）----
  var TT = M.TITRATIONS;
  function tById(id) {
    for (var i = 0; i < TT.length; i++) if (TT[i].id === id) return TT[i];
    return null;
  }

  section('モデル：滴定データの健全性');
  ok('滴定の問題は8問ある', TT.length === 8);
  ok('id に重複がない', new Set(TT.map(function (p) { return p.id; })).size === 8);
  ok('参照する物質がすべて存在する', TT.every(function (p) {
    return !!M.SUBSTANCES[p.acid.sub] && !!M.SUBSTANCES[p.base.sub];
  }));
  ok('価数は1以上の整数', TT.every(function (p) {
    return p.acid.n >= 1 && p.base.n >= 1 &&
           p.acid.n === Math.round(p.acid.n) && p.base.n === Math.round(p.base.n);
  }));
  // 未知はちょうど1つ。2つあると解けず、0だと問いにならない
  ok('未知はちょうど1つ', TT.every(function (p) {
    var nulls = [p.acid.c, p.acid.v, p.base.c, p.base.v].filter(function (x) {
      return x === null;
    });
    return nulls.length === 1;
  }));
  ok('asked が実際に未知の側・項目を指している', TT.every(function (p) {
    return p[M.titUnknownSide(p)][M.titField(p)] === null;
  }));
  ok('既知側は濃度も体積もそろっている', TT.every(function (p) {
    var k = p[M.titKnownSide(p)];
    return k.c !== null && k.v !== null;
  }));
  ok('答えの表記は有効数字から機械的に決まる', TT.every(function (p) {
    return p.ansDisp === M.toSig(M.titSolve(p), p.sig);
  }));

  section('モデル：H⁺ と OH⁻ のつり合い');
  // 体積は mL なので 1000 で割る。ここを忘れるのがつまずきの定番
  ok('物質量は 濃度 × 体積(L)', near(M.titAmount(tById('t1').acid), 0.0010));
  ok('出せる H⁺ は 価数 × 物質量（1価）',
    near(M.titEquiv(tById('t1').acid), 0.0010));
  ok('H2SO4 は同じ mol でも H⁺ が2倍', (function () {
    var a = tById('t4').acid;
    return near(M.titAmount(a), 0.0010) && near(M.titEquiv(a), 0.0020);
  })());
  ok('つり合う量は既知側から決まる', near(M.titBalance(tById('t4')), 0.0020));
  ok('酸を問う問題では塩基側から決まる',
    near(M.titBalance(tById('t7')), 0.0020));
  ok('酸と塩基の出せる数は必ず等しい（模範解答を入れたとき）', TT.every(function (p) {
    var f = M.titFilled(p), un = M.titUnknownSide(p);
    var a = un === 'acid' ? f : p.acid, b = un === 'base' ? f : p.base;
    return Math.abs(M.titEquiv(a) - M.titEquiv(b)) <= M.titEquiv(a) * 0.005;
  }));
  ok('出すイオンの名前は側で決まる',
    M.titIon('acid') === 'H⁺' && M.titIon('base') === 'OH⁻');

  section('モデル：滴定の答え');
  ok('t1 同濃度・同価数なら同じ体積', near(M.titSolve(tById('t1')), 10.0));
  ok('t2 濃度が2倍なら体積は半分', near(M.titSolve(tById('t2')), 10.0));
  ok('t3 濃度を問う（0.15 mol/L）', near(M.titSolve(tById('t3')), 0.15));
  // 価数2が効く核心。1価として解くと 10.0 になってしまう
  ok('t4 H2SO4 は2価なので体積は2倍の 20.0 mL',
    near(M.titSolve(tById('t4')), 20.0));
  ok('t5 は 12.5 mL', near(M.titSolve(tById('t5')), 12.5));
  ok('t6 H2SO4 の濃度は 0.10 mol/L', near(M.titSolve(tById('t6')), 0.10));
  ok('t7 塩基が2価。必要な酸は 10.0 mL', near(M.titSolve(tById('t7')), 10.0));
  ok('t8 弱酸でもつり合いは同じ（0.0860 mol/L）',
    near(M.titSolve(tById('t8')), 0.0860));

  section('モデル：滴定の典型的な誤り');
  ok('価数を無視すると t4 は 10.0 になる',
    near(M.titIgnoreValence(tById('t4')), 10.0));
  ok('価数を無視すると t6 は 0.20 になる',
    near(M.titIgnoreValence(tById('t6')), 0.20));
  ok('両方1価の問題には価数の誤りがない',
    M.titIgnoreValence(tById('t1')) === null &&
    M.titIgnoreValence(tById('t3')) === null);
  ok('全問で模範解答が正解になる', TT.every(function (p) {
    return M.gradeTitration(p, p.ansDisp).status === 'ok';
  }));
  ok('価数の取り違えは valence として拾う',
    M.gradeTitration(tById('t4'), '10.0').status === 'valence');
  ok('mL と L の直し忘れは unit として拾う',
    M.gradeTitration(tById('t3'), '150').status === 'unit' &&
    M.gradeTitration(tById('t1'), '0.0100').status === 'unit');
  ok('桁が違えば sigfig（値は合っている）',
    M.gradeTitration(tById('t1'), '10').status === 'sigfig');
  ok('でたらめな値は wrong',
    M.gradeTitration(tById('t1'), '7.3').status === 'wrong');
  ok('つり合いの入力判定', M.checkEquiv(tById('t4'), '0.0020') &&
    !M.checkEquiv(tById('t4'), '0.0010'));

  section('モデル：滴定の問題文と誘導');
  ok('体積を問う問題文は「何 mL か」で終わる',
    /何 mL か$/.test(tById('t4').title));
  ok('濃度を問う問題文は「何 mol\\/L か」で終わる',
    /何 mol\/L か$/.test(tById('t3').title));
  ok('濃度が未知の側は問題文で「濃度不明」と書かない（問われる側なので）',
    tById('t3').title.indexOf('濃度不明') < 0);
  ok('ヒントが「H⁺ と OH⁻ が同じ数」を言う', TT.every(function (p) {
    return p.hint.indexOf('同じ数') > 0;
  }));
  ok('価数が効く問題は「2個出す」と補足する',
    tById('t4').hint.indexOf('2個') > 0);
  ok('弱酸の問題は「強い酸か弱い酸かは関係ない」と言う',
    tById('t8').hint.indexOf('関係ない') > 0);

  // ---- 熱化学（M5）----
  var TH = M.THERMO;
  function hById(id) {
    for (var i = 0; i < TH.length; i++) if (TH[i].id === id) return TH[i];
    return null;
  }

  section('モデル：熱化学データの健全性');
  ok('熱化学の問題は6問ある', TH.length === 6);
  ok('id に重複がない', new Set(TH.map(function (p) { return p.id; })).size === 6);
  ok('矢印の両端はすべて宣言された準位', TH.every(function (p) {
    var keys = p.levels.map(function (l) { return l.key; });
    return p.given.concat([p.asked]).every(function (g) {
      return keys.indexOf(g.from) >= 0 && keys.indexOf(g.to) >= 0;
    });
  }));
  // 与えられた矢印だけで全準位の高さが決まらないと問題が解けない
  ok('与えられた式だけで全準位の高さが決まる', TH.every(function (p) {
    var h = M.thermoHeights(p);
    return p.levels.every(function (l) { return h[l.key] !== undefined; });
  }));
  ok('基準（先頭の準位）は必ず 0', TH.every(function (p) {
    return M.thermoHeights(p)[p.levels[0].key] === 0;
  }));
  ok('問われている矢印は与えられた矢印と重複しない', TH.every(function (p) {
    return !p.given.some(function (g) {
      return g.from === p.asked.from && g.to === p.asked.to;
    });
  }));
  ok('答えの表記は有効数字から機械的に決まる', TH.every(function (p) {
    return p.ansDisp === M.toSig(M.thermoSolve(p), p.sig);
  }));
  ok('問題文は問われている式から作られる',
    hById('h2').title.indexOf('C(固) ＋ ½O₂(気) → CO(気)') === 0);

  section('モデル：高さの差が ΔH');
  ok('h1 逆向きにたどると符号が反転する（＋394）',
    near(M.thermoSolve(hById('h1')), 394));
  // ヘスの法則。直接測れない CO の生成熱が回り道から出る
  ok('h2 ヘスの法則で CO の生成熱 −111', (function () {
    var h = M.thermoHeights(hById('h2'));
    return near(h.c, -394) && near(h.b, -111) && near(M.thermoSolve(hById('h2')), -111);
  })());
  ok('h3 生成熱からメタンの燃焼熱 −891',
    near(M.thermoSolve(hById('h3')), -891));
  ok('h4 結合エネルギーから反応熱 −185', (function () {
    var h = M.thermoHeights(hById('h4'));
    return near(h.atom, 679) && near(h.b, -185) &&
           near(M.thermoSolve(hById('h4')), -185);
  })());
  ok('h5 反応熱から結合エネルギー ＋864',
    near(M.thermoSolve(hById('h5')), 864));
  ok('h6 黒鉛→ダイヤモンドは ＋2（ダイヤのほうが高い）',
    near(M.thermoSolve(hById('h6')), 2));
  // 結合エネルギーの問題では反応物を基準にする（教科書の図と同じ向き）
  ok('結合エネルギーの問題は反応物が基準で原子が上に来る', (function () {
    var h = M.thermoHeights(hById('h4'));
    return h.a === 0 && h.atom > 0 && h.b < 0;
  })());
  ok('学習者が置く準位は基準以外のすべて', TH.every(function (p) {
    return M.thermoPlaceLevels(p).length === p.levels.length - 1;
  }));
  ok('置く根拠になる式が引ける',
    M.thermoBasis(hById('h2'), 'b').dh === '-283');

  section('モデル：熱化学の典型的な誤り');
  ok('符号を逆にした答えを拾える',
    near(M.thermoSignFlip(hById('h2')), 111));
  ok('引くところを足した答えを拾える（h3）',
    near(M.thermoAddSlip(hById('h3')), -1041));
  ok('出発点が基準（0）なら足し引きの誤りは起きない',
    M.thermoAddSlip(hById('h2')) === null &&
    M.thermoAddSlip(hById('h6')) === null);
  ok('全問で模範解答が正解になる', TH.every(function (p) {
    return M.gradeThermo(p, p.ansDisp).status === 'ok';
  }));
  ok('符号だけ逆なら sign', M.gradeThermo(hById('h2'), '111').status === 'sign');
  ok('足してしまったら addsub',
    M.gradeThermo(hById('h3'), '-1041').status === 'addsub');
  ok('桁が違えば sigfig',
    M.gradeThermo(hById('h3'), '-891.0').status === 'sigfig');
  ok('でたらめな値は wrong', M.gradeThermo(hById('h2'), '7').status === 'wrong');
  // 表示は − （U+2212）を使うので、それを打ち返されても読めなければならない
  ok('表示用のマイナス（−）で入力しても正解になる',
    M.gradeThermo(hById('h2'), '−111').status === 'ok');
  ok('全角の＋を付けても正解になる',
    M.gradeThermo(hById('h1'), '＋394').status === 'ok');
  ok('準位の入力判定（表示用マイナスも通る）',
    M.checkLevel(hById('h2'), 'c', '-394') &&
    M.checkLevel(hById('h2'), 'c', '−394') &&
    !M.checkLevel(hById('h2'), 'c', '394'));
  ok('ΔH の表記は符号を必ず付ける',
    M.dhText(-394) === '−394' && M.dhText(394) === '＋394' && M.dhText(0) === '0');

  // 入口が数える対象がモデルに実在するか（M.TITRATION と綴って白画面になった）
  section('モデル：入口が参照するデータが実在する');
  ok('モードごとの問題データがすべて配列として公開されている',
    ['PROBLEMS', 'BALANCE', 'REACTIONS', 'TITRATIONS', 'THERMO'].every(function (k) {
      return Array.isArray(M[k]) && M[k].length > 0;
    }));

  // ---- 進捗の保存（レビュー項目9）----
  // クリアの印がページ内変数にしか無く、再読込で消えていた。
  // 保存の実装は progress.js の1か所だけ、というのもここで固定する。
  section('モデル：進捗の保存（localStorage）');
  ok('キーは chemRatio.cleared.<モードid>',
    PRG.key('stoich') === 'chemRatio.cleared.stoich');
  ok('5モードぶんのモードidを持つ', PRG.MODES.length === 5 &&
    ['proportion', 'balance', 'stoich', 'titration', 'thermo']
      .every(function (m) { return PRG.MODES.indexOf(m) >= 0; }));
  ok('記録した問題は、開き直しても残っている', (function () {
    PRG.clear('stoich');
    var s = PRG.open('stoich');
    s.mark('r1'); s.mark('r5');
    var again = PRG.open('stoich');     // 読み直し ＝ 再読込と同じ
    return again.solved.r1 === true && again.solved.r5 === true && again.count() === 2;
  })());
  ok('同じ問題を2回記録しても増えない', (function () {
    PRG.clear('titration');
    var s = PRG.open('titration');
    return s.mark('t1') === true && s.mark('t1') === false && s.count() === 1;
  })());
  ok('モードごとに別々に持つ（キーが衝突しない）', (function () {
    PRG.clear('thermo'); PRG.clear('balance');
    PRG.open('thermo').mark('h1');
    return PRG.read('thermo').h1 === true && PRG.read('balance').h1 !== true;
  })());
  ok('モードごとのリセットで消える', (function () {
    PRG.open('balance').mark('b1');
    PRG.clear('balance');
    return PRG.open('balance').count() === 0;
  })());
  ok('全モードのリセットで全部消える', (function () {
    PRG.MODES.forEach(function (m) { PRG.open(m).mark('x1'); });
    PRG.clearAll();
    return PRG.total() === 0;
  })());
  ok('壊れた値が入っていても落ちない', (function () {
    try { localStorage.setItem(PRG.key('stoich'), '{壊れている'); } catch (e) { return true; }
    var r = PRG.read('stoich');
    PRG.clear('stoich');
    return Object.keys(r).length === 0;
  })());
  PRG.clearAll();   // ここまでの試し書きを iframe に持ち込まない

  // ---- 入口（モード選択）----
  // モードが5つに増えて「自分に必要なものが分からない」状態になったので /ratio/ を入口にした。
  // 入口とモードの対応が崩れるのがいちばん怖いので、ここは機械で押さえる。
  function runPortalUI() {
    var win = document.getElementById('appPortal').contentWindow;
    var P = win.ChemRatioPortal, doc = win.document;

    section('UI：入口（モード選択）', uiOut);
    if (!P) { ok('入口が読み込めた', false, uiOut); return; }
    ok('入口が読み込めた', true, uiOut);

    ok('単元が4つ並ぶ', doc.querySelectorAll('.unitBlock').length === 4, uiOut);
    ok('モードのカードが5枚ある', doc.querySelectorAll('.modeCard').length === 5, uiOut);
    ok('単元の見出しに教科書の単元名が出る', (function () {
      var names = Array.prototype.map.call(doc.querySelectorAll('.unitName'),
        function (h) { return h.textContent; });
      return names.indexOf('化学反応の量的関係') >= 0 &&
             names.indexOf('酸と塩基・中和') >= 0;
    })(), uiOut);

    // 5つのモードすべてが入口から行けること（増やしたのに載せ忘れる事故を防ぐ）
    var MODES = ['proportion.html', 'balance.html', 'stoich.html',
                 'titration.html', 'thermo.html'];
    ok('5つのモードすべてが入口に載っている', (function () {
      var hrefs = P.hrefs();
      return MODES.every(function (m) { return hrefs.indexOf(m) >= 0; }) &&
             hrefs.length === MODES.length;
    })(), uiOut);
    ok('カードの href が実際にそのページを指している', (function () {
      var hrefs = Array.prototype.map.call(doc.querySelectorAll('.modeCard'),
        function (a) { return a.getAttribute('href'); });
      return MODES.every(function (m) { return hrefs.indexOf(m) >= 0; });
    })(), uiOut);

    // 問題数は手書きせずモデルから数える（増減のたびにズレるのを防ぐ）
    ok('問題数がモデルの数と一致する', (function () {
      var byHref = {};
      Array.prototype.forEach.call(doc.querySelectorAll('.modeCard'), function (a) {
        byHref[a.getAttribute('href')] =
          parseInt(a.querySelector('.cardCount').textContent, 10);
      });
      return byHref['proportion.html'] === M.PROBLEMS.length &&
             byHref['balance.html'] === M.BALANCE.length &&
             byHref['stoich.html'] === M.REACTIONS.length &&
             byHref['titration.html'] === M.TITRATIONS.length &&
             byHref['thermo.html'] === M.THERMO.length;
    })(), uiOut);
    ok('合計問題数が表示と一致する', (function () {
      var sum = Array.prototype.reduce.call(doc.querySelectorAll('.cardCount'),
        function (a, e) { return a + parseInt(e.textContent, 10); }, 0);
      return sum === M.PROBLEMS.length + M.BALANCE.length + M.REACTIONS.length +
                    M.TITRATIONS.length + M.THERMO.length;
    })(), uiOut);

    ok('各カードに「同じもの」のルールが書かれている', (function () {
      var rules = Array.prototype.map.call(doc.querySelectorAll('.cardRule'),
        function (e) { return e.textContent; });
      return rules.length === 5 &&
             rules.some(function (r) { return r.indexOf('倍率が同じ') >= 0; }) &&
             rules.some(function (r) { return r.indexOf('H⁺ の数 ＝ OH⁻ の数') >= 0; }) &&
             rules.some(function (r) { return r.indexOf('高さの差は同じ') >= 0; });
    })(), uiOut);
    ok('課程の札が出る（化学基礎4・化学1）', (function () {
      return doc.querySelectorAll('.cardCourse.basic').length === 4 &&
             doc.querySelectorAll('.cardCourse.adv').length === 1;
    })(), uiOut);
    ok('入口には問題を解く要素を置かない',
      doc.getElementById('stageNav') === null &&
      doc.getElementById('checkBtn') === null, uiOut);

    // どのモードからも入口に戻れること
    ok('全モードのヘッダーに入口へ戻るリンクがある', (function () {
      return ['app', 'appBalance', 'appStoich', 'appTitration', 'appThermo']
        .every(function (id) {
          var d = document.getElementById(id).contentDocument;
          var a = d.querySelector('header .modeLink.home');
          return !!a && a.getAttribute('href') === 'index.html';
        });
    })(), uiOut);
    // 別アプリ（ion-equation の反応インデックス）からの横断が片道だと
    // 辞書引きの流れがここで途切れる。?r= で来たときだけ戻り道を出す
    ok('通常のモード表示では「索引へ戻る」を出さない', (function () {
      var d = document.getElementById('appStoich').contentDocument;
      var box = d.getElementById('fromBox');
      return !!box && box.hidden === true;
    })(), uiOut);
    ok('横断の入口（?r=）が全モードの中で stoich だけにある', (function () {
      // 反応式を持つのは量的関係モードだけなので、ここが受け口
      return typeof document.getElementById('appStoich')
        .contentWindow.ChemStoichApp === 'object';
    })(), uiOut);

    // ---- ハブ（化学レンズ）へ戻れること（レビュー項目7）----
    // ratio からハブにも他アプリにも出られず、辞書引きの流れがここで途切れていた。
    // **足すのはハブへの1本だけ**（共通ブランドバーはアプリ全体の入口見直しに合流させる）
    section('UI：ハブ（化学レンズ）へ戻る', uiOut);
    var ALL_FRAMES = ['appPortal', 'app', 'appBalance', 'appStoich',
                      'appTitration', 'appThermo'];
    ok('入口と全モードのヘッダーにハブへの戻りがある', ALL_FRAMES.every(function (id) {
      var a = document.getElementById(id).contentDocument
        .querySelector('header .modeLink.hub');
      return !!a && a.getAttribute('href') === '../index.html';
    }), uiOut);
    ok('ハブへの戻りがヘッダーの先頭のリンク', ALL_FRAMES.every(function (id) {
      var links = document.getElementById(id).contentDocument
        .querySelectorAll('header .modeLink');
      return links.length >= 1 && links[0].classList.contains('hub');
    }), uiOut);
    ok('文言は「🏠 化学レンズ」でそろっている', ALL_FRAMES.every(function (id) {
      return document.getElementById(id).contentDocument
        .querySelector('header .modeLink.hub').textContent.trim() === '🏠 化学レンズ';
    }), uiOut);
    ok('入口へ戻る道はモードだけに残す（入口自身には出さない）', (function () {
      return doc.querySelector('header .modeLink.home') === null &&
        ['app', 'appBalance', 'appStoich', 'appTitration', 'appThermo']
          .every(function (id) {
            return !!document.getElementById(id).contentDocument
              .querySelector('header .modeLink.home');
          });
    })(), uiOut);

    // ---- ヘッダーからほかのモードへ移れること（レビュー項目6）----
    // 入口に戻らないと別のモードへ行けなかった。ヘッダーに切り替えを足したが、
    // **横に5本並べるとヘッダーが伸びて 375px の本文を圧迫する**ので
    // 閉じている間は高さが増えない <details> にしてある。そこも機械で押さえる。
    var MODE_FRAMES = ['app', 'appBalance', 'appStoich', 'appTitration', 'appThermo'];
    section('UI：ヘッダーからモードを切り替える', uiOut);
    ok('全モードのヘッダーに切り替えがある', MODE_FRAMES.every(function (id) {
      return !!document.getElementById(id).contentDocument
        .querySelector('header details.modeJump');
    }), uiOut);
    ok('切り替えは既定で閉じている（ヘッダーの高さを増やさない）',
      MODE_FRAMES.every(function (id) {
        return document.getElementById(id).contentDocument
          .querySelector('header details.modeJump').open === false;
      }), uiOut);
    ok('開くと5モードすべてへ行ける', MODE_FRAMES.every(function (id) {
      var d = document.getElementById(id).contentDocument;
      var hrefs = Array.prototype.map.call(
        d.querySelectorAll('.modeJumpList a'), function (a) {
          return a.getAttribute('href');
        });
      return hrefs.length === MODES.length &&
        MODES.every(function (m) { return hrefs.indexOf(m) >= 0; });
    }), uiOut);
    ok('いま開いているモードに印が付く', MODE_FRAMES.every(function (id) {
      var f = document.getElementById(id);
      var here = f.getAttribute('src').split('?')[0];
      var cur = f.contentDocument.querySelectorAll('.modeJumpList a[aria-current="page"]');
      return cur.length === 1 && cur[0].getAttribute('href') === here;
    }), uiOut);
    // 一覧が2か所（入口と切り替え）にあると必ずずれる。ここで食い違いを検出する
    ok('切り替えの一覧が入口の一覧と一致する', MODE_FRAMES.every(function (id) {
      var N = document.getElementById(id).contentWindow.ChemRatioNav;
      if (!N) return false;
      var a = N.hrefs().slice().sort().join(',');
      return a === P.hrefs().slice().sort().join(',');
    }), uiOut);
    ok('切り替えのモード名が入口のカードの名前と一致する', (function () {
      var doc0 = document.getElementById('appPortal').contentDocument;
      var byHref = {};
      Array.prototype.forEach.call(doc0.querySelectorAll('.modeCard'), function (a) {
        // カード名には課程の札が入っているので、その札の文字を除いて比べる
        var name = a.querySelector('.cardName').cloneNode(true);
        var tag = name.querySelector('.cardCourse');
        if (tag) tag.remove();
        byHref[a.getAttribute('href')] = name.textContent.trim();
      });
      var N = document.getElementById('app').contentWindow.ChemRatioNav;
      return N.MODES.every(function (m) { return byHref[m.href] === m.name; });
    })(), uiOut);
    ok('入口には切り替えを出さない（入口そのものがモード選択なので）',
      doc.querySelector('header details.modeJump') === null, uiOut);

    section('UI：アプリ横断（反応インデックスからの往復）', uiOut);
    // 「係数は与えられている」への答えを、隣のアプリへの道として添える。
    // 行き先は ion の索引に固定する（どのページで遊べるかは ion の振り分けなので、
    // ratio がそれを複製すると相手が収録先を変えたとき黙って壊れる）
    ok('全問に「なぜこの係数？」の道がある', (function () {
      var w = document.getElementById('appStoich').contentWindow;
      var d = document.getElementById('appStoich').contentDocument;
      for (var i = 0; i < M.REACTIONS.length; i++) {
        w.ChemStoichApp.setProblem(i);
        var a = d.querySelector('#eqBox .eqAsk');
        if (!a || a.getAttribute('href') !==
            '../ion-equation/library.html?from=' + M.REACTIONS[i].id) return false;
      }
      return true;
    })(), uiOut);
    ok('行き先は索引で、ページの振り分けを ratio 側に持たない', (function () {
      var d = document.getElementById('appStoich').contentDocument;
      var h = d.querySelector('#eqBox .eqAsk').getAttribute('href');
      return h.indexOf('library.html?from=') > 0 &&
             h.indexOf('redox.html') < 0 && h.indexOf('rxn=') < 0;
    })(), uiOut);
    document.getElementById('appStoich').contentWindow.ChemStoichApp.setProblem(4);

    // ion-equation の反応インデックスは ../ratio/stoich.html?r=<id> で送ってくる
    ok('?r= で指定された問題が開く', (function () {
      var w = document.getElementById('appLinked').contentWindow;
      return w.ChemStoichApp.state.idx === 13 &&
        w.document.getElementById('qTitle').textContent.indexOf('問14') === 0;
    })(), uiOut);
    ok('横断で来たときは「索引へ戻る」が出る', (function () {
      var d = document.getElementById('appLinked').contentDocument;
      var box = d.getElementById('fromBox');
      return !!box && box.hidden === false &&
        box.textContent.indexOf('反応インデックス') > 0;
    })(), uiOut);
    ok('戻り先が ion-equation の索引を指している', (function () {
      var d = document.getElementById('appLinked').contentDocument;
      var a = d.querySelector('#fromBox .fromBack');
      return !!a && a.getAttribute('href') === '../ion-equation/library.html';
    })(), uiOut);
    // 横断の戻りは #fromBox にだけ出す。ヘッダーに足すと「来た道」と
    // 「いつもの導線」が混ざり、どのページでも同じ並びに見えなくなる
    ok('戻り道はヘッダーに足さない（ヘッダーはハブと入口の2本のまま）', (function () {
      var d = document.getElementById('appLinked').contentDocument;
      var hrefs = Array.prototype.map.call(d.querySelectorAll('header .modeLink'),
        function (a) { return a.getAttribute('href'); });
      return hrefs.length === 2 &&
        hrefs[0] === '../index.html' && hrefs[1] === 'index.html' &&
        !hrefs.some(function (h) { return h.indexOf('ion-equation') >= 0; });
    })(), uiOut);
    // 存在しない id で来ても、問1 を出すだけで戻り道は出さない（当たっていないので）
    ok('存在しない id では問1にフォールバックする', (function () {
      var w = document.getElementById('appBadLink').contentWindow;
      return w.ChemStoichApp.state.idx === 0;
    })(), uiOut);
    ok('存在しない id では戻り道を出さない', (function () {
      var d = document.getElementById('appBadLink').contentDocument;
      return d.getElementById('fromBox').hidden === true;
    })(), uiOut);

    // ヘッダーに横並びで出してよいのは「ハブへ」「入口へ」の2本まで。
    // モードの行き来は畳んだ切り替え（details）でやる ＝ 375px でヘッダーを伸ばさない
    ok('モードのヘッダーの横並びは2本まで（ハブ・入口）', (function () {
      return ['app', 'appBalance', 'appStoich', 'appTitration', 'appThermo']
        .every(function (id) {
          var d = document.getElementById(id).contentDocument;
          return d.querySelectorAll('header .modeLink').length === 2;
        });
    })(), uiOut);
    ok('モードへのリンクをヘッダーに直接並べない（畳んだ中だけ）', (function () {
      return ['app', 'appBalance', 'appStoich', 'appTitration', 'appThermo']
        .every(function (id) {
          var d = document.getElementById(id).contentDocument;
          return Array.prototype.every.call(
            d.querySelectorAll('header .modeLink'), function (a) {
              return MODES.indexOf(a.getAttribute('href')) < 0;
            });
        });
    })(), uiOut);

    // ---- 進捗が次に開いたときも残ること（レビュー項目9）----
    // ここまでの UI テストで5モードとも1問以上を正解しているので、
    // その結果が localStorage に届いているかを実物で見る。
    section('UI：進捗が次に開いたときも残る', uiOut);
    var MODE_STATE = [
      ['proportion', 'app', 'ChemRatioApp'],
      ['balance', 'appBalance', 'ChemBalanceApp'],
      ['stoich', 'appStoich', 'ChemStoichApp'],
      ['titration', 'appTitration', 'ChemTitrationApp'],
      ['thermo', 'appThermo', 'ChemThermoApp']
    ];
    ok('5モードとも、解いた問題が保存されている', MODE_STATE.every(function (t) {
      var ids = Object.keys(
        document.getElementById(t[1]).contentWindow[t[2]].state.solved);
      if (ids.length === 0) return false;
      var saved = PRG.read(t[0]);
      return ids.every(function (id) { return saved[id] === true; });
    }), uiOut);
    ok('開き直しても読み戻される（再読込と同じ経路）', MODE_STATE.every(function (t) {
      var w = document.getElementById(t[1]).contentWindow;
      var ids = Object.keys(w[t[2]].state.solved);
      var fresh = w.ChemRatioProgress.open(t[0]).solved;
      return ids.every(function (id) { return fresh[id] === true; });
    }), uiOut);
    ok('保存された数だけクリアの印が付く', MODE_STATE.every(function (t) {
      var d = document.getElementById(t[1]).contentDocument;
      var marks = d.querySelectorAll('#stageNav button.cleared').length;
      var solved = Object.keys(PRG.read(t[0])).length;
      // いま開いている問題は active になり cleared にならないので、その1つだけ差が出る
      return marks === solved || marks === solved - 1;
    }), uiOut);
    ok('入口に進捗の合計とカードのクリア数が出る', (function () {
      var w = document.getElementById('appPortal').contentWindow;
      var d = w.document;
      w.ChemRatioPortal.render();     // 進捗が増えたあとに描き直す
      var box = d.getElementById('progressBox');
      return !!box && box.textContent.indexOf('解いた問題') >= 0 &&
        box.querySelector('.prgText b').textContent === String(PRG.total()) &&
        d.querySelectorAll('.modeCard .cardDone').length === 5;
    })(), uiOut);
    // 消す手段が無いと詰む。確認は window.confirm ではなく画面内で2段にしてある
    // （モーダルは iframe のテストを止めるし、押し間違いも取り返せる）
    ok('入口の「進捗をリセット」は、やめれば消えない', (function () {
      var d = document.getElementById('appPortal').contentDocument;
      var btn = d.getElementById('prgReset');
      if (!btn) return false;
      btn.click();
      if (!d.getElementById('prgYes') || !d.getElementById('prgNo')) return false;
      d.getElementById('prgNo').click();
      return PRG.total() > 0 && !!d.getElementById('prgReset');
    })(), uiOut);
    ok('入口の「進捗をリセット」で全モードの進捗が消える', (function () {
      var d = document.getElementById('appPortal').contentDocument;
      d.getElementById('prgReset').click();
      d.getElementById('prgYes').click();
      return PRG.total() === 0 &&
        d.querySelectorAll('.modeCard .cardDone').length === 0 &&
        d.getElementById('prgReset') === null;
    })(), uiOut);
  }

  // ---- UI（iframe を駆動） ----
  function runUI(win) {
    var A = win.ChemRatioApp;
    var doc = win.document;
    section('UI：導入段階（倍率が見えている・数値だけ入力）', uiOut);
    if (!A) { ok('アプリが読み込めた', false, uiOut); return finish(); }
    ok('アプリが読み込めた', true, uiOut);

    A.setProblem(0);
    ok('問1が表示される', doc.getElementById('qTitle').textContent.indexOf('問1') === 0, uiOut);
    ok('問題文に有効数字の指定が出る',
      doc.getElementById('qTitle').textContent.indexOf('有効数字2桁') > 0, uiOut);
    ok('単位の4択は出ない', doc.querySelectorAll('.unitPick').length === 0, uiOut);
    ok('倍率の入力欄は出ない（最初から見えている）',
      doc.querySelectorAll('input.facBox').length === 0, uiOut);
    ok('たての矢印に倍率 1/2 が出ている',
      doc.querySelector('td.arrowV.active .f.known').textContent.replace(/\s/g, '') === '×12',
      uiOut);
    ok('よこの矢印は薄く表示される', doc.querySelectorAll('td.arrowH.dim').length === 2, uiOut);
    ok('よこの矢印は必ず → （左が既知・右が未知）', (function () {
      var ars = doc.querySelectorAll('td.arrowH .ar');
      return ars.length === 2 &&
        Array.prototype.every.call(ars, function (e) { return e.textContent === '→'; });
    })(), uiOut);
    ok('たての矢印は ↓', doc.querySelector('td.arrowV .ar').textContent === '↓', uiOut);
    ok('推奨が「たてが楽」と出る',
      doc.getElementById('orientBar').textContent.indexOf('たて が楽') >= 0, uiOut);

    A.check();
    ok('空欄で「たしかめる」→ 数を入れる促し', A.msgText().indexOf('数を入れて') >= 0, uiOut);

    A.type('0.5');
    A.check();
    ok('0.5 は「値は合っています」と桁を指導',
      A.msgText().indexOf('値は合っています') >= 0, uiOut);
    ok('指導文に正しい書き方 0.50 が示される', A.msgText().indexOf('0.50') >= 0, uiOut);
    ok('桁ちがいでは正解にならない', !!A.state.solved.q1 === false, uiOut);

    A.type('162');
    A.check();
    ok('162 は倍率が逆さまと指摘', A.msgText().indexOf('逆さま') >= 0, uiOut);

    A.type('0.50');
    A.check();
    ok('0.50 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('計算過程が倍率方式で書かれる', A.msgText().indexOf('同じ倍率だから') >= 0, uiOut);
    ok('正解時に倍率が もう一方へ運ばれる',
      doc.querySelector('td.arrowV.active .f.carried.landed') !== null, uiOut);
    ok('採点時に分数の対照表が出る', doc.querySelectorAll('.fracTable .ft').length >= 10, uiOut);
    ok('対照表で 1/2 が強調される',
      Array.prototype.some.call(doc.querySelectorAll('.fracTable .ft.used'), function (e) {
        return e.textContent.indexOf('1/2') === 0;
      }), uiOut);

    section('UI：よこで解く（向きの切り替え）', uiOut);
    A.setProblem(1);
    ok('問2は「どちらでも大差ない」と出る',
      doc.getElementById('orientBar').textContent.indexOf('どちらでも') >= 0, uiOut);
    A.setOrient('h');
    ok('よこに切り替えるとよこ矢印が active',
      doc.querySelectorAll('td.arrowH.active').length === 2, uiOut);
    ok('よこ矢印の倍率が ×44', doc.querySelector('td.arrowH.active .f.known')
      .textContent.replace(/\s/g, '') === '×44', uiOut);
    ok('未知が左でも矢印は → のまま（q2 は mass が未知）', (function () {
      var ars = doc.querySelectorAll('td.arrowH .ar');
      return Array.prototype.every.call(ars, function (e) { return e.textContent === '→'; });
    })(), uiOut);
    A.type('11');
    A.check();
    ok('よこ向きでも 11 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('計算過程が「よこに同じ倍率」になる',
      A.msgText().indexOf('よこに同じ倍率') >= 0, uiOut);

    section('UI：よこが楽な問題は最初からよこで開く', uiOut);
    A.setProblem(8);   // q9 CO2 0.30 mol → g
    ok('q9 は よこモードで開く', A.state.orient === 'h', uiOut);
    ok('推奨バッジが「よこ が楽」',
      doc.getElementById('orientBar').textContent.indexOf('よこ が楽') >= 0, uiOut);
    ok('基準の行の矢印に ×44 が出る',
      doc.querySelector('td.arrowH.active .f.known').textContent.replace(/\s/g, '') === '×44',
      uiOut);
    A.pickUnit('mass');
    A.type('13');
    A.check();
    ok('13 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('計算過程が「よこに同じ倍率」', A.msgText().indexOf('よこに同じ倍率') >= 0, uiOut);

    section('UI：ナビゲーションと問題数', uiOut);
    ok('ステージボタンが20個ある',
      doc.querySelectorAll('#stageNav button').length === 20, uiOut);
    ok('クリアした問題に印が付く',
      doc.querySelectorAll('#stageNav button.cleared').length >= 1, uiOut);

    section('UI：単位をえらぶ段階', uiOut);
    A.setProblem(2);
    ok('問3で単位の4択が出る', doc.querySelectorAll('.unitPick button').length === 4, uiOut);
    A.type('0.25');
    A.check();
    ok('単位未選択だと先に進めない', A.msgText().indexOf('単位をえらぼう') >= 0, uiOut);
    A.pickUnit('volume');
    A.check();
    ok('L を選ぶと列の不一致を指摘', A.msgText().indexOf('そろっていません') >= 0, uiOut);
    ok('不一致の2セルが赤くなる', doc.querySelectorAll('td.cell.hl-bad').length === 2, uiOut);
    A.pickUnit('mole');
    A.type('0.25');
    A.check();
    ok('mol を選び 0.25 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('正解後に赤いセルが消える', doc.querySelectorAll('td.cell.hl-bad').length === 0, uiOut);

    section('UI：倍率を自分で探す段階', uiOut);
    A.setProblem(4);
    ok('問5で倍率の入力欄（分子・分母）が出る',
      doc.querySelectorAll('input.facBox').length === 2, uiOut);
    ok('倍率が入るまで答えの入力は無効', doc.getElementById('answer').disabled === true, uiOut);
    A.check();
    ok('倍率が空だと促される', A.msgText().indexOf('倍率がまだ') >= 0, uiOut);

    A.typeFactor(2, 1);
    ok('誤った倍率ではロックされない', A.state.locked === false, uiOut);
    ok('誤った倍率のままでは答えを入れられない',
      doc.getElementById('answer').disabled === true, uiOut);

    A.typeFactor(1, 2);
    ok('正しい倍率でロックされる', A.state.locked === true, uiOut);
    ok('ロック時にもう一方の矢印へ自動で入る',
      doc.querySelector('.f.carried.landed') !== null, uiOut);
    ok('ロック後は答えを入力できる', doc.getElementById('answer').disabled === false, uiOut);
    ok('倍率が合ったことを伝える', A.msgText().indexOf('その倍率で合っています') >= 0, uiOut);

    A.type('0.50');
    A.check();
    ok('答え 0.50 で正解', A.msgText().indexOf('正解') >= 0, uiOut);

    section('UI：粒子の数（指数入力・全段階）', uiOut);
    A.setProblem(5);
    ok('問6で単位4択と倍率入力の両方が出る',
      doc.querySelectorAll('.unitPick button').length === 4 &&
      doc.querySelectorAll('input.facBox').length === 2, uiOut);
    ok('基準セルに 6.0×10²³ が表示される',
      doc.getElementById('board').textContent.indexOf('6.0×10²³') >= 0, uiOut);
    A.pickUnit('count');
    A.typeFactor(1, 2);
    ok('倍率 1/2 でロックされる', A.state.locked === true, uiOut);
    ok('仮数と指数の2枠が使える',
      !!doc.getElementById('answer') && !!doc.getElementById('answerExp'), uiOut);
    A.type('3.0');
    A.check();
    ok('指数が空だと両方の入力を促す', A.msgText().indexOf('指数') >= 0, uiOut);
    A.typeExp('23');
    A.check();
    ok('3.0×10²³ で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('計算過程に 6.0×10²³ と ×1/2 が出る',
      A.msgText().indexOf('6.0×10²³') >= 0 && A.msgText().indexOf('×1/2') >= 0, uiOut);
    A.type('3');
    A.check();
    ok('仮数 3 は桁の指導になる', A.msgText().indexOf('値は合っています') >= 0, uiOut);

    section('UI：指数表記の書き方（12×10²³ を弾く）', uiOut);
    A.setProblem(11);   // q12 水 36 g → 1.2×10²⁴ 個（倍率 ×2 を先に入れる）
    A.typeFactor(2, 1);
    ok('q12 の倍率 ×2 でロックされる', A.state.locked === true, uiOut);
    A.type('12'); A.typeExp('23');
    A.check();
    ok('12×10²³ は指数の書き方を指導される',
      A.msgText().indexOf('指数の書き方') >= 0, uiOut);
    ok('指導文が正しい表記 1.2×10²⁴ を示す',
      A.msgText().indexOf('1.2×10²⁴') >= 0, uiOut);
    ok('この段階ではクリアにならない', !A.state.solved.q12, uiOut);
    A.type('1.2'); A.typeExp('24');
    A.check();
    ok('1.2×10²⁴ で正解', A.msgText().indexOf('正解') >= 0, uiOut);

    runBalanceUI();
  }

  function runBalanceUI() {
    var frame2 = document.getElementById('appBalance');
    var win = frame2.contentWindow;
    var A = win.ChemBalanceApp, doc = win.document;

    section('UI：天秤モード（平均を求める）', uiOut);
    if (!A) { ok('天秤モードが読み込めた', false, uiOut); return finish(); }
    ok('天秤モードが読み込めた', true, uiOut);

    A.setProblem(0);   // b1 塩素の平均原子量
    ok('問1が表示される', doc.getElementById('qTitle').textContent.indexOf('問1') === 0, uiOut);
    ok('有効数字の指定が出る',
      doc.getElementById('qTitle').textContent.indexOf('有効数字3桁') > 0, uiOut);
    ok('両端の値 35.0 と 37.0 が描かれる', (function () {
      var t = doc.getElementById('beam').textContent;
      return t.indexOf('35.0') >= 0 && t.indexOf('37.0') >= 0;
    })(), uiOut);
    ok('存在比は % を付けて原子量と区別する', (function () {
      var t = doc.getElementById('beam').textContent;
      return t.indexOf('75%') >= 0 && t.indexOf('25%') >= 0;
    })(), uiOut);
    ok('答える前は支点が描かれない',
      doc.querySelector('#beam .fulcrum') === null, uiOut);
    ok('多い側の皿のほうが大きい', (function () {
      var pans = doc.querySelectorAll('#beam .pan');
      return parseFloat(pans[0].getAttribute('width')) >
             parseFloat(pans[1].getAttribute('width'));
    })(), uiOut);

    A.check();
    ok('空欄では促される', A.msgText().indexOf('数を入れて') >= 0, uiOut);

    A.type('36.5');
    A.check();
    ok('36.5 は「多い少ないが逆」と指摘', A.msgText().indexOf('逆です') >= 0, uiOut);
    ok('指摘が寄る側を名指しする', A.msgText().indexOf('側に寄ります') > 0, uiOut);

    A.type('35.50');
    A.check();
    ok('35.50 は桁の指導', A.msgText().indexOf('値は合っています') >= 0, uiOut);

    A.type('35.5');
    A.check();
    ok('35.5 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('正解後に支点が描かれる', doc.querySelector('#beam .fulcrum') !== null, uiOut);
    ok('腕の長さ 0.5 と 1.5 が描かれる', (function () {
      var labs = doc.querySelectorAll('#beam .armLab');
      return labs.length === 2 && labs[0].textContent === '0.5' && labs[1].textContent === '1.5';
    })(), uiOut);
    ok('解説が「腕が短いほうが多い」と言う',
      A.msgText().indexOf('腕が短いほうが多い') > 0, uiOut);
    ok('解説が内分の言葉を使う', A.msgText().indexOf('内分する点') > 0, uiOut);
    ok('解説が内分比 1 : 3 を示す', A.msgText().indexOf('1 : 3') > 0, uiOut);
    ok('解説が個数の比 3 : 1 と % を併記', A.msgText().indexOf('75% と 25%') > 0, uiOut);
    ok('解説に天秤を使わない別解が載る', A.msgText().indexOf('別解') > 0, uiOut);
    ok('別解が定義どおりの式になっている',
      A.msgText().indexOf('35.0×0.75') > 0, uiOut);
    ok('支点は軽いほう寄りにある', (function () {
      var fx = parseFloat(doc.querySelector('#beam .fulcrum').getAttribute('points').split(',')[0]);
      return fx < (90 + 410) / 2;
    })(), uiOut);

    section('UI：丸める前の値と等分の目盛り', uiOut);
    A.setProblem(2);   // b3 銅 63.616 → 63.6
    A.type('63.6');
    A.check();
    ok('b3 は 63.6 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('丸める前の 63.616 が解説に出る', A.msgText().indexOf('63.616') > 0, uiOut);
    ok('別解の式が存在比の小数で書かれる', A.msgText().indexOf('0.692') > 0, uiOut);
    ok('b3 は等分では乗らないと表示される',
      doc.getElementById('divBar').textContent.indexOf('乗らない') >= 0, uiOut);

    A.setProblem(0);   // b1 は 4等分で乗る
    ok('b1 は「4等分すると乗る」と案内される',
      doc.getElementById('divBar').textContent.indexOf('4等分すると') >= 0, uiOut);
    ok('4等分ボタンに印が付く', doc.querySelector('#divBar button.fit') !== null, uiOut);
    ok('分割前は目盛りがない', doc.querySelectorAll('#beam .tick').length === 0, uiOut);
    A.setDiv(4);
    ok('4等分すると内側に目盛りが3本出る',
      doc.querySelectorAll('#beam .tick').length === 3, uiOut);
    ok('目盛りの値 35.5 が描かれる',
      doc.getElementById('beam').textContent.indexOf('35.5') >= 0, uiOut);

    section('UI：分点を選ぶ', uiOut);
    ok('分点はクリックできる（当たり判定が3つ）',
      doc.querySelectorAll('#beam .tickHit').length === 3, uiOut);
    A.pickTick(1);
    ok('選ぶと仮の支点（点線）が出る',
      doc.querySelector('#beam .fulcrum.provisional') !== null, uiOut);
    ok('選んだ目盛りが強調される', doc.querySelectorAll('#beam .tick.sel').length === 1, uiOut);
    ok('選んだ点の内分比 1 : 3 が示される',
      doc.getElementById('pickNote').textContent.indexOf('1 : 3') > 0, uiOut);
    ok('平均を問う問題では解答欄に値が入る', A.state.input === '35.5', uiOut);
    A.pickTick(2);
    ok('別の分点を選び直せる（2 : 2 → 1 : 1）',
      doc.getElementById('pickNote').textContent.indexOf('1 : 1') > 0, uiOut);
    ok('選び直すと解答欄も変わる', A.state.input === '36.0', uiOut);
    A.pickTick(2);
    ok('同じ点をもう一度押すと選択が外れる', A.state.pick === null, uiOut);
    ok('外すと仮の支点が消える',
      doc.querySelector('#beam .fulcrum.provisional') === null, uiOut);

    A.pickTick(1);
    A.check();
    ok('選んだ点 35.5 でそのまま正解できる', A.msgText().indexOf('正解') >= 0, uiOut);

    section('UI：支点が数字に重ならない', uiOut);
    // 見積もりではなく実測（getBBox）で重なりを判定する。
    // 142 では文字が 125 から描かれ、支点（〜128）と 3px 重なっていた。
    function boxOf(sel) {
      var e = doc.querySelector(sel);
      return e ? e.getBBox() : null;
    }
    ok('支点が端の数値と重ならない', (function () {
      var f = boxOf('#beam .fulcrum:not(.provisional)'), v = boxOf('#beam text.val');
      return f && v && f.y + f.height <= v.y;
    })(), uiOut);
    ok('支点が目盛りの数値と重ならない', (function () {
      var f = boxOf('#beam .fulcrum:not(.provisional)'), t = boxOf('#beam text.tickVal');
      return f && t && f.y + f.height <= t.y;
    })(), uiOut);
    ok('支点の値が数直線・皿と重ならない', (function () {
      var a = boxOf('#beam .avg'), pan = boxOf('#beam .pan');
      var beamY = parseFloat(doc.querySelector('#beam .beam').getAttribute('y1'));
      return a && pan && a.y >= pan.y + pan.height && a.y + a.height <= beamY;
    })(), uiOut);
    ok('ラベルが実際に描画されている（<sup> は SVG で描かれない）', (function () {
      var l = boxOf('#beam text.lab');
      return l && l.height > 0 &&
        doc.querySelector('#beam text.lab').textContent === '³⁵Cl';
    })(), uiOut);
    ok('数値とラベルが重ならない', (function () {
      var v = boxOf('#beam text.val'), l = boxOf('#beam text.lab');
      return v && l && v.y + v.height <= l.y;
    })(), uiOut);
    ok('腕の寸法線がラベルと重ならない', (function () {
      var l = boxOf('#beam text.lab'), a = boxOf('#beam text.armLab');
      return l && a && l.y + l.height <= a.y;
    })(), uiOut);
    ok('図が viewBox に収まっている', (function () {
      var vb = doc.getElementById('beam').getAttribute('viewBox').split(' ');
      var all = doc.querySelectorAll('#beam > *');
      return Array.prototype.every.call(all, function (e) {
        var b = e.getBBox();
        return b.y >= -1 && b.y + b.height <= parseFloat(vb[3]) + 1;
      });
    })(), uiOut);
    ok('目盛りの数値と端の数値が同じ高さに並ぶ', (function () {
      var t = doc.querySelector('#beam text.tickVal'), v = doc.querySelector('#beam text.val');
      return t.getAttribute('y') === v.getAttribute('y');
    })(), uiOut);
    ok('腕の寸法線はラベルより下にある', (function () {
      var arm = parseFloat(doc.querySelector('#beam .arm').getAttribute('y1'));
      var lab = parseFloat(doc.querySelector('#beam text.lab').getAttribute('y'));
      return arm > lab;
    })(), uiOut);
    ok('支点の値は数直線の上に描かれる', (function () {
      var avg = parseFloat(doc.querySelector('#beam .avg').getAttribute('y'));
      var beamY = parseFloat(doc.querySelector('#beam .beam').getAttribute('y1'));
      return avg < beamY;
    })(), uiOut);
    A.setDiv(0);

    section('UI：天秤モード（存在比を求める）', uiOut);
    A.setProblem(1);   // b2 平均から存在比
    ok('比の入力欄が2つ出る',
      !!doc.getElementById('ansN') && !!doc.getElementById('ansM'), uiOut);
    ok('平均が与えられているので支点は最初から描かれる',
      doc.querySelector('#beam .fulcrum') !== null, uiOut);
    // 与えられた平均 35.5 を有効数字2桁で丸めて 36 と描く不具合があった
    ok('与えられた平均は丸めずに 35.5 と描かれる',
      doc.querySelector('#beam .avg').textContent === '35.5', uiOut);
    ok('36 とは描かれない',
      doc.querySelector('#beam .avg').textContent !== '36', uiOut);
    ok('個数は未知なので皿が点線', doc.querySelectorAll('#beam .pan.unknown').length === 2, uiOut);

    A.typeRatio(1, 3);
    A.check();
    ok('1:3（逆）は誤りで腕の長さを示す', A.msgText().indexOf('腕の長さ') >= 0, uiOut);

    A.typeRatio(3, 1);
    A.check();
    ok('3:1 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('正解後に皿の点線が消える',
      doc.querySelectorAll('#beam .pan.unknown').length === 0, uiOut);
    ok('比を問う問題では別解が方程式になる',
      A.msgText().indexOf('35.0x') > 0 && A.msgText().indexOf('(1−x)') > 0, uiOut);
    ok('方程式の別解が x = 0.75 を示す', A.msgText().indexOf('0.75') > 0, uiOut);
    ok('比を問う問題の皿に % は付かない',
      doc.getElementById('beam').textContent.indexOf('%') < 0, uiOut);

    A.setProblem(5);   // b6 空気の体積比
    A.typeRatio(4, 1);
    A.check();
    ok('空気は 4 : 1 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('ステージボタンが8個ある',
      doc.querySelectorAll('#stageNav button').length === 8, uiOut);

    runStoichUI();
  }

  // ---- 反応の量的関係モード（3つ目の iframe）----
  function runStoichUI() {
    var win = document.getElementById('appStoich').contentWindow;
    var A = win.ChemStoichApp, doc = win.document;

    section('UI：反応の量的関係（導入・倍率が見えている）', uiOut);
    if (!A) { ok('反応モードが読み込めた', false, uiOut); return finish(); }
    ok('反応モードが読み込めた', true, uiOut);

    A.setProblem(0);   // r1 O2 0.20 mol と反応する H2
    ok('問1が表示される', doc.getElementById('qTitle').textContent.indexOf('問1') === 0, uiOut);
    ok('有効数字の指定が出る',
      doc.getElementById('qTitle').textContent.indexOf('有効数字2桁') > 0, uiOut);
    ok('反応式が与えられたものとして示される', (function () {
      var t = doc.getElementById('eqBox').textContent;
      return t.indexOf('→') > 0 && t.indexOf('係数は与えられている') > 0;
    })(), uiOut);
    ok('表が4行（係数・反応前・変化量・反応後）ある', (function () {
      return !!doc.querySelector('table.stoich tr.row-coef') &&
             !!doc.querySelector('table.stoich tr.row-before') &&
             !!doc.querySelector('table.stoich tr.row-change') &&
             !!doc.querySelector('table.stoich tr.row-after');
    })(), uiOut);
    ok('係数の行に 2・1・2 が並ぶ', (function () {
      var tds = doc.querySelectorAll('tr.row-coef td.sc');
      return tds.length === 3 && tds[0].textContent === '2' &&
             tds[1].textContent === '1' && tds[2].textContent === '2';
    })(), uiOut);
    ok('表の列の間に ＋ と → が入る（表が反応式として読める）', (function () {
      var seps = doc.querySelectorAll('tr.row-head td.sep');
      return seps.length === 2 && seps[0].textContent === '＋' && seps[1].textContent === '→';
    })(), uiOut);
    ok('十分量の反応物は「十分量」と書かれる',
      doc.querySelector('tr.row-before').textContent.indexOf('十分量') >= 0, uiOut);
    ok('過不足のない問題では棒くらべの図を出さない',
      doc.getElementById('barsWrap').hidden === true, uiOut);
    ok('倍率が見えている段階では入力欄でなくバッジ',
      doc.querySelector('.xBadge.locked') !== null &&
      doc.getElementById('xIn') === null, uiOut);
    ok('答えは変化量の行にあり、符号は外に出ている', (function () {
      var td = doc.querySelector('tr.row-change td.sc.unknown');
      return td && td.querySelector('.sign') && td.querySelector('.sign').textContent === '−';
    })(), uiOut);
    ok('答えの入力は最初から有効（段階がない問題）',
      doc.getElementById('answer').disabled === false, uiOut);

    A.check();
    ok('空欄では促される', A.msgText().indexOf('数を入れて') >= 0, uiOut);

    A.type('0.10');
    A.check();
    ok('係数を逆さまに使うと指摘される',
      A.msgText().indexOf('係数が逆さま') >= 0, uiOut);

    A.type('0.4');
    A.check();
    ok('0.4 は桁の指導（値は合っている）',
      A.msgText().indexOf('値は合っています') >= 0, uiOut);

    A.type('0.40');
    A.check();
    ok('0.40 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が係数の比を示す', A.msgText().indexOf('係数の比') >= 0, uiOut);
    ok('解説が倍率の出どころを示す', A.msgText().indexOf('倍率') > 0, uiOut);

    section('UI：過不足（棒くらべと限定反応物）', uiOut);
    A.setProblem(4);   // r5 H2 0.30 / O2 0.10
    ok('過不足の問題では棒くらべの図が出る',
      doc.getElementById('barsWrap').hidden === false, uiOut);
    ok('まずは「持っている量」だけを見せる',
      doc.getElementById('barsHead').textContent === '持っている量' &&
      doc.querySelectorAll('#bars .barHeld').length === 2, uiOut);
    // 公式（量 ÷ 係数）を先に見せると「なぜそう計算するのか」が消えるので出さない
    ok('えらぶ前は 量 ÷ 係数 の値を出さない', (function () {
      var t = doc.getElementById('bars').textContent;
      return t.indexOf('0.15') < 0 && t.indexOf('÷') < 0;
    })(), uiOut);
    ok('所持量は H2 のほうが多い（多い＝安全ではないと後で崩す）', (function () {
      var held = doc.querySelectorAll('#bars .barHeld');
      return parseFloat(held[1].getAttribute('width')) <
             parseFloat(held[0].getAttribute('width'));
    })(), uiOut);
    ok('えらぶボタンは反応物の数だけ出る（2つ）',
      doc.querySelectorAll('#limitBar button').length === 2, uiOut);
    ok('えらぶ前は止まる位置を描かない（答えそのものなので）',
      doc.querySelector('#bars .stopLine') === null &&
      doc.querySelectorAll('#bars .barUsed').length === 0, uiOut);
    ok('「多いほうが余るとは限らない」と促す',
      doc.getElementById('bars').textContent.indexOf('多いほうが余るとは限らない') >= 0, uiOut);
    ok('仮定して試すボタンが2つ出る',
      doc.querySelectorAll('#hypoBar button').length === 2, uiOut);
    ok('えらぶ前は倍率の入力が無効',
      doc.getElementById('xIn').disabled === true, uiOut);
    ok('えらぶ前は答えの入力も無効',
      doc.getElementById('answer').disabled === true, uiOut);
    ok('倍率が決まる前の変化量は ?',
      doc.querySelector('tr.row-change td.sc.waiting') !== null, uiOut);

    section('UI：仮説テスト（もし◯◯を使い切るなら？）', uiOut);
    A.pickHypo('H2');
    ok('仮定を選ぶと見出しが「もし H2 を使い切るなら」になる',
      doc.getElementById('barsHead').textContent.indexOf('を使い切るなら') > 0, uiOut);
    ok('必要量の棒と所持量の縦線が出る',
      doc.querySelectorAll('#bars .barNeed').length === 2 &&
      doc.querySelectorAll('#bars .heldMark').length === 2, uiOut);
    ok('足りない分が赤で描かれる',
      doc.querySelectorAll('#bars .barOver').length === 1, uiOut);
    ok('図が「この仮定は無理」と判定する', (function () {
      var v = doc.querySelector('#bars .verdict');
      return v && v.classList.contains('ng') && v.textContent.indexOf('この仮定は無理') >= 0;
    })(), uiOut);
    ok('メッセージが必要量と所持量を並べて示す', (function () {
      var t = A.msgText();
      return t.indexOf('この仮定は無理') >= 0 && t.indexOf('0.15') > 0 &&
             t.indexOf('足りない') > 0;
    })(), uiOut);
    ok('この段階でも限定反応物の答えは確定していない',
      A.state.limitPick === null, uiOut);

    A.pickHypo('O2');
    ok('もう一方の仮定に切り替えられる', A.state.hypo === 'O2', uiOut);
    ok('成り立つ仮定では余りが緑で描かれる',
      doc.querySelectorAll('#bars .barSpare').length === 1 &&
      doc.querySelectorAll('#bars .barOver').length === 0, uiOut);
    ok('図が「この仮定でいける」と判定する', (function () {
      var v = doc.querySelector('#bars .verdict');
      return v && v.classList.contains('ok') && v.textContent.indexOf('いける') > 0;
    })(), uiOut);
    ok('メッセージが「先に無くなるのは O2」まで言う',
      A.msgText().indexOf('先に無くなるのは') > 0, uiOut);
    ok('仮定を試しても止まる位置は描かれない（答えはまだ自分で選ぶ）',
      doc.querySelector('#bars .stopLine') === null, uiOut);
    A.pickHypo('O2');
    ok('同じ仮定をもう一度押すと外れて所持量の図に戻る',
      A.state.hypo === null &&
      doc.getElementById('barsHead').textContent === '持っている量', uiOut);

    section('UI：過不足（限定反応物をえらぶ）', uiOut);
    A.pickLimit('H2');
    ok('余るほうをえらぶと「まだ余ります」', A.msgText().indexOf('余ります') > 0, uiOut);
    ok('誤りの指摘が mol ÷ 係数 の式を出す',
      A.msgText().indexOf('0.30÷2') > 0, uiOut);
    ok('誤ったままでは倍率の入力は無効',
      doc.getElementById('xIn').disabled === true, uiOut);
    ok('誤ったままでは止まる位置も出ない',
      doc.querySelector('#bars .stopLine') === null, uiOut);

    // えらび直させる途中なので、どちらで止まるかまでは言わない
    ok('誤りの指摘は答え（どちらで止まるか）を明かさない',
      A.msgText().indexOf('で止まる') < 0, uiOut);

    A.pickLimit('O2');
    ok('正しくえらぶと肯定される', A.msgText().indexOf('そのとおり') >= 0, uiOut);
    ok('えらぶと倍率の入力が有効になる',
      doc.getElementById('xIn').disabled === false, uiOut);
    ok('えらぶと「ここで止まる」の線と注記が出る',
      doc.querySelector('#bars .stopLine') !== null &&
      doc.getElementById('bars').textContent.indexOf('ここで止まる') > 0, uiOut);
    ok('えらぶと限定反応物の棒に印が付く',
      doc.querySelectorAll('#bars .barUsed.lim').length === 1, uiOut);
    ok('反応前の行で限定反応物に印が付く',
      doc.querySelectorAll('tr.row-before td.sc.limited').length === 1, uiOut);

    A.typeX('0.15');
    ok('余るほうの倍率では確定しない', A.state.xLocked === false, uiOut);
    ok('確定するまで答えの入力は無効',
      doc.getElementById('answer').disabled === true, uiOut);

    A.typeX('0.10');
    ok('正しい倍率で確定する', A.state.xLocked === true, uiOut);
    ok('確定すると変化量の行が一斉に埋まる', (function () {
      var tds = doc.querySelectorAll('tr.row-change td.sc');
      return tds.length === 3 && tds[0].textContent === '−0.20' &&
             tds[1].textContent === '−0.10' && tds[2].textContent === '＋0.20';
    })(), uiOut);
    ok('確定すると答えの入力が有効になる',
      doc.getElementById('answer').disabled === false, uiOut);
    ok('限定反応物の反応後は 0 と表示される',
      doc.querySelector('tr.row-after td.sc.gone') !== null, uiOut);

    A.type('0.30');
    A.check();
    ok('余るほうで計算すると名指しで指摘される',
      A.msgText().indexOf('余るほうで計算') >= 0, uiOut);
    ok('指摘が候補倍率を並べて見せる',
      A.msgText().indexOf('0.30÷2') > 0 && A.msgText().indexOf('0.10÷1') > 0, uiOut);

    A.type('0.20');
    A.check();
    ok('0.20 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が余る量まで述べる', A.msgText().indexOf('余る') > 0, uiOut);

    section('UI：ちょうど反応と「残る量」を問う問題', uiOut);
    A.setProblem(3);   // r4 NaOH 0.20 / HCl 0.20（ちょうど反応）
    ok('ちょうど反応では両方の棒が同じ長さ', (function () {
      var rests = doc.querySelectorAll('#bars .barRest');
      return rests[0].getAttribute('width') === rests[1].getAttribute('width');
    })(), uiOut);
    // 「先に足りなくなるほう」が存在しないので、えらばせる段そのものを出さない。
    // ちょうど反応は**見せる**問題にする（v13。v12 では選択肢を足して凌いでいた）
    ok('ちょうど反応では限定反応物をえらばせない',
      doc.querySelectorAll('#limitBar button').length === 0, uiOut);
    ok('図が「ちょうど反応」と教える',
      doc.getElementById('bars').textContent.indexOf('ちょうど反応') > 0, uiOut);
    ok('えらぶ段がないので倍率の入力は最初から有効',
      doc.getElementById('xIn').disabled === false, uiOut);
    A.typeX('0.20');
    A.type('0.20');
    A.check();
    ok('r4 は 0.20 で正解', A.msgText().indexOf('正解') >= 0, uiOut);

    A.setProblem(7);   // r8 残る CH4 を問う
    ok('答えのセルは反応後の行にある',
      doc.querySelector('tr.row-after td.sc.unknown') !== null, uiOut);
    ok('残る量を問う問題では符号を外に出さない',
      doc.querySelector('tr.row-after td.sc.unknown .sign') === null, uiOut);
    A.pickLimit('O2');
    A.typeX('0.20');
    A.type('0');
    A.check();
    ok('0（使いきったと考えた答え）は取り違えとして拾う',
      A.msgText().indexOf('余るほうで計算') >= 0, uiOut);
    A.type('0.10');
    A.check();
    ok('r8 は 0.10 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が引き算の式を見せる', A.msgText().indexOf('0.30 − 1×0.20') > 0, uiOut);
    ok('ステージボタンが18個ある',
      doc.querySelectorAll('#stageNav button').length === 18, uiOut);

    section('UI：mol にそろえる段（g で与える）', uiOut);
    A.setProblem(8);   // r9 CaCO3 25 g → CO2 何 mol
    ok('変換の帯が1つ出る', doc.querySelectorAll('#convIn .convRow').length === 1, uiOut);
    ok('変換の帯に与えられた質量が出る',
      doc.querySelector('#convIn .convFrom').textContent.indexOf('25 g') > 0, uiOut);
    ok('変換の根拠（1 mol ＝ 100 g）が添えられる',
      doc.querySelector('#convIn .convWhy').textContent.indexOf('100 g') > 0, uiOut);
    ok('mol にそろえる前は反応前の行が空いている',
      doc.querySelector('tr.row-before td.sc.waiting') !== null, uiOut);
    ok('mol にそろえる前は倍率の入力が無効',
      doc.getElementById('xIn').disabled === true, uiOut);
    ok('出口の変換はない（mol で答える問題）',
      doc.querySelectorAll('#convOut .convRow').length === 0, uiOut);

    A.check();
    ok('そろえる前に確かめると mol にそろえるよう促す',
      A.msgText().indexOf('mol にそろって') >= 0, uiOut);
    ok('促しが割り算の式を出す', A.msgText().indexOf('25 g ÷ 100') > 0, uiOut);

    A.typeConv('CaCO3', '25');
    ok('g のままでは確定しない', A.state.convLocked.CaCO3 !== true, uiOut);
    A.typeConv('CaCO3', '0.25');
    ok('0.25 mol で確定する', A.state.convLocked.CaCO3 === true, uiOut);
    ok('確定すると帯が済んだ表示になる',
      doc.querySelector('#convIn .convRow.locked') !== null, uiOut);
    ok('確定すると反応前の行に値が入る',
      doc.querySelector('tr.row-before td.sc').textContent === '0.25', uiOut);
    ok('確定すると倍率の入力が有効になる',
      doc.getElementById('xIn').disabled === false, uiOut);

    A.typeX('0.25');
    A.type('0.25');
    A.check();
    ok('r9 は 0.25 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が mol にそろえる式から始まる',
      A.msgText().indexOf('25 g ÷ 100 ＝ 0.25 mol') > 0, uiOut);

    section('UI：単位を戻す段（g で答える）', uiOut);
    A.setProblem(9);   // r10 CH4 0.50 mol → H2O 何 g
    ok('入口の変換はない（mol で与える問題）',
      doc.querySelectorAll('#convIn .convRow').length === 0, uiOut);
    ok('出口の変換が1つ出る', doc.querySelectorAll('#convOut .convRow').length === 1, uiOut);
    ok('出口の単位は g', doc.querySelector('#convOut .convUnit').textContent === 'g', uiOut);
    ok('表のセルは mol の途中の値（id が tableAns）',
      doc.getElementById('tableAns') !== null && doc.getElementById('answer') !== null, uiOut);
    ok('倍率の前は mol のセルが無効',
      doc.getElementById('tableAns').disabled === true, uiOut);
    ok('mol が合う前は出口が無効',
      doc.getElementById('answer').disabled === true, uiOut);
    ok('mol が合う前は出口に ? が出る',
      doc.querySelector('#convOut .convFrom').textContent.indexOf('?') > 0, uiOut);

    A.typeX('0.50');
    ok('倍率が入ると mol のセルが有効になる',
      doc.getElementById('tableAns').disabled === false, uiOut);
    A.check();
    ok('mol が空のままだと表の mol を促す',
      A.msgText().indexOf('表の mol') >= 0, uiOut);

    A.typeTable('18');
    ok('g の値を mol 欄に入れても確定しない', A.state.tableLocked !== true, uiOut);
    A.typeTable('1.0');
    ok('1.0 mol で確定する', A.state.tableLocked === true, uiOut);
    ok('確定すると表のセルが確定表示になる',
      doc.querySelector('td.sc.unknown.landed') !== null, uiOut);
    ok('確定すると出口に mol の値が出る',
      doc.querySelector('#convOut .convFrom').textContent.indexOf('1.0 mol') > 0, uiOut);
    ok('確定すると出口が有効になる',
      doc.getElementById('answer').disabled === false, uiOut);

    A.type('1.0');
    A.check();
    ok('mol の値をそのまま答えると単位を戻すよう促す',
      A.msgText().indexOf('単位を戻す') > 0, uiOut);
    A.type('18');
    A.check();
    ok('r10 は 18 g で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が単位を戻す式を見せる',
      A.msgText().indexOf('1.0 × 18 ＝ 18 g') > 0, uiOut);

    section('UI：3段そろった総合問題（g → mol → 係数の比 → g）', uiOut);
    A.setProblem(12);  // r13 H2 0.60 g / O2 3.2 g → H2O 何 g（過不足つき）
    ok('変換の帯が2つ出る', doc.querySelectorAll('#convIn .convRow').length === 2, uiOut);
    ok('そろえる前は棒くらべを見せない（変換の答えが分かってしまう）',
      doc.getElementById('bars').textContent.indexOf('まず mol にそろえよう') >= 0, uiOut);
    ok('そろえる前は限定反応物のボタンを出さない',
      doc.querySelectorAll('#limitBar button').length === 0, uiOut);
    A.typeConv('H2', '0.30');
    ok('片方だけでは棒くらべが出ない',
      doc.querySelectorAll('#bars .barHeld').length === 0, uiOut);
    A.typeConv('O2', '0.10');
    ok('両方そろうと棒くらべが出る',
      doc.querySelectorAll('#bars .barHeld').length === 2, uiOut);
    ok('両方そろうと限定反応物のボタンが出る',
      doc.querySelectorAll('#limitBar button').length === 2, uiOut);
    A.pickLimit('O2');
    A.typeX('0.10');
    A.typeTable('0.20');
    A.type('5.4');
    A.check();
    ok('余るほうで計算した 5.4 g は取り違えとして拾う',
      A.msgText().indexOf('余るほうで計算') >= 0, uiOut);
    A.type('3.6');
    A.check();
    ok('r13 は 3.6 g で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が3段すべてを述べる', (function () {
      var t = A.msgText();
      return t.indexOf('0.60 g ÷ 2.0') > 0 && t.indexOf('小さいほう') > 0 &&
             t.indexOf('単位を戻して') > 0;
    })(), uiOut);
    ok('解説が余る量も述べる', A.msgText().indexOf('余る') > 0, uiOut);
    // 候補倍率を「与えられた量そのもの（g）」で書こうとして NaN を出す不具合があった。
    // mol ÷ 係数 は**必ず mol の値**で書く
    ok('g で与えた問題でも候補倍率が mol で書かれる', (function () {
      var t = A.msgText();
      return t.indexOf('0.30÷2') > 0 && t.indexOf('0.10÷1') > 0;
    })(), uiOut);
    ok('画面のどこにも NaN が出ない', (function () {
      return ['#msg', '#bars', '#board', '#convIn', '#convOut'].every(function (sel) {
        return doc.querySelector(sel).textContent.indexOf('NaN') < 0;
      });
    })(), uiOut);

    A.setProblem(15);  // r16 L で与えて g で答える（単位が混ざるので mol を経由する）
    ok('L → g は mol を経由する（帯が前後に出る）',
      doc.querySelectorAll('#convIn .convRow').length === 1 &&
      doc.querySelectorAll('#convOut .convRow').length === 1, uiOut);
    ok('体積の根拠は「気体 1 mol ＝ 22.4 L」',
      doc.querySelector('#convIn .convWhy').textContent.indexOf('22.4 L') > 0, uiOut);
    ok('L → g も同じ流れで解ける', (function () {
      A.solveSteps();
      A.type('18');
      A.check();
      return A.msgText().indexOf('正解') >= 0;
    })(), uiOut);

    section('UI：mol を使わなくてよいときは使わない', uiOut);
    A.setProblem(13);  // r14 気体同士（H2 ＋ Cl2 → 2HCl）。L のまま計算する
    ok('気体同士なら換算の帯が前後どちらも出ない',
      doc.querySelectorAll('#convIn .convRow').length === 0 &&
      doc.querySelectorAll('#convOut .convRow').length === 0, uiOut);
    ok('表の単位が L と書かれる',
      doc.querySelector('.unitNote').textContent === '単位はすべて L', uiOut);
    ok('ヒントがアボガドロの法則を根拠に出す',
      doc.getElementById('qHint').textContent.indexOf('アボガドロの法則') > 0, uiOut);
    ok('ヒントが「mol に直さなくてよい」と言う',
      doc.getElementById('qHint').textContent.indexOf('mol に直さなくてよい') > 0, uiOut);
    ok('表のセルが解答そのものになる（途中の mol を挟まない）',
      doc.getElementById('answer') !== null &&
      doc.getElementById('tableAns') === null, uiOut);
    A.typeX('3.0');
    A.type('6.0');
    A.check();
    ok('r14 は 6.0 L で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説に 22.4 が出てこない（mol を経由していない）',
      A.msgText().indexOf('22.4') < 0, uiOut);
    ok('解説が L で書かれる', A.msgText().indexOf('6.0 L') > 0, uiOut);

    A.setProblem(14);  // r15 気体同士の過不足（N2 2.0 L ＋ H2 3.0 L）
    A.pickLimit('N2');
    ok('L のままでも余るほうの指摘が出る', A.msgText().indexOf('余ります') > 0, uiOut);
    ok('その指摘が L ÷ 係数 で書かれる', A.msgText().indexOf('2.0÷1') > 0, uiOut);
    A.pickLimit('H2');
    ok('まとめの見出しが「L ÷ 係数」になる',
      doc.getElementById('barsHead').textContent.indexOf('L ÷ 係数') > 0, uiOut);
    A.typeX('1.0');
    ok('L のまま倍率が確定する', A.state.xLocked === true, uiOut);
    ok('変化量の行も L で埋まる', (function () {
      var tds = doc.querySelectorAll('tr.row-change td.sc');
      return tds[0].textContent === '−1.0' && tds[1].textContent === '−3.0' &&
             tds[2].textContent === '＋2.0';
    })(), uiOut);
    A.type('4.0');
    A.check();
    ok('余るほうで計算した 4.0 L は取り違えとして拾う',
      A.msgText().indexOf('余るほうで計算') >= 0, uiOut);
    A.type('2.0');
    A.check();
    ok('r15 は 2.0 L で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が「N2 は 1.0 L 余る」と述べる',
      A.msgText().indexOf('1.0 L 余る') > 0, uiOut);

    section('UI：気体でない物質の L は仮想値としてマークする', uiOut);
    A.setProblem(16);  // r17 メタンの燃焼。水の量は問わないので L で通す
    ok('水が生じる式でも L で計算する',
      doc.querySelector('.unitNote').textContent.indexOf('単位はすべて L') === 0, uiOut);
    ok('水の列だけに ※ が付く', (function () {
      var marks = doc.querySelectorAll('table.stoich th.colHead .vmark');
      return marks.length === 1 &&
        doc.querySelector('table.stoich th.colHead.virtual').textContent.indexOf('H') === 0;
    })(), uiOut);
    ok('水の列のセルが仮想値の見た目になる',
      doc.querySelectorAll('table.stoich td.sc.virtual[data-sub="H2O"]').length === 4, uiOut);
    ok('気体の列には ※ を付けない',
      doc.querySelectorAll('td.sc.virtual[data-sub="CO2"]').length === 0, uiOut);
    ok('注記が仮想の値だと明言する', (function () {
      var t = doc.querySelector('.unitNote .vnote').textContent;
      return t.indexOf('気体ではない') > 0 && t.indexOf('仮想の値') > 0 &&
             t.indexOf('22.4 L にはならない') > 0;
    })(), uiOut);
    A.typeX('2.0');
    A.type('4.0');
    A.check();
    ok('r17 は 4.0 L で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('水の変化量も L で埋まる（仮想値）',
      doc.querySelector('tr.row-change td.sc[data-sub="H2O"]').textContent === '＋4.0', uiOut);

    A.setProblem(17);  // r18 メタンの燃焼で過不足（CH4 2.0 L ＋ O2 3.0 L）
    A.pickLimit('O2');
    A.typeX('1.5');
    A.type('1.5');
    A.check();
    ok('r18 は 1.5 L で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が「CH4 は 0.50 L 余る」と述べる（有効数字2桁）',
      A.msgText().indexOf('0.50 L 余る') > 0, uiOut);
    ok('過不足の問題でも水の列に ※ が付く',
      doc.querySelectorAll('table.stoich th.colHead .vmark').length === 1, uiOut);

    A.setProblem(15);  // r16 水の量そのものを問うので L は使えない
    ok('水の量を問うときは mol に戻る',
      doc.querySelector('.unitNote').textContent.indexOf('単位はすべて mol') === 0, uiOut);
    ok('mol で計算するときは ※ を出さない',
      doc.querySelectorAll('table.stoich .vmark').length === 0 &&
      doc.querySelector('.unitNote .vnote') === null, uiOut);

    section('UI：棒くらべの図が重ならない', uiOut);
    A.setProblem(4);
    A.pickLimit('O2');   // えらぶまで止まる位置は描かれない
    function sbox(sel, i) {
      var e = doc.querySelectorAll(sel)[i || 0];
      return e ? e.getBBox() : null;
    }
    ok('ラベルが実際に描画されている（<sub> は SVG で描かれない）', (function () {
      var b = sbox('#bars .barLab');
      return b && b.height > 0 &&
        doc.querySelector('#bars .barLab').textContent.indexOf('H₂') === 0;
    })(), uiOut);
    ok('ラベルと棒が重ならない', (function () {
      var l = sbox('#bars .barLab'), r = sbox('#bars .barRest');
      return l && r && l.x + l.width <= r.x;
    })(), uiOut);
    ok('棒と右の値が重ならない', (function () {
      var r = sbox('#bars .barRest'), v = sbox('#bars .barVal');
      return r && v && r.x + r.width <= v.x;
    })(), uiOut);
    ok('注記が棒より下にある', (function () {
      var r = sbox('#bars .barRest', 1), s = sbox('#bars .stopLab');
      return r && s && r.y + r.height <= s.y;
    })(), uiOut);
    ok('図が viewBox に収まっている', (function () {
      var vb = doc.getElementById('bars').getAttribute('viewBox').split(' ');
      return Array.prototype.every.call(doc.querySelectorAll('#bars > *'), function (e) {
        var b = e.getBBox();
        return b.y >= -1 && b.y + b.height <= parseFloat(vb[3]) + 1 &&
               b.x >= -1 && b.x + b.width <= parseFloat(vb[2]) + 1;
      });
    })(), uiOut);

    // 仮説テストの図は行が増える（凡例と判定を下に足す）ので、そこも実測する
    A.setProblem(4);
    A.pickHypo('H2');
    ok('仮説の図：ラベルと棒が重ならない', (function () {
      var l = sbox('#bars .barLab'), b = sbox('#bars .barNeed');
      return l && b && l.x + l.width <= b.x;
    })(), uiOut);
    ok('仮説の図：棒と右の判定文が重ならない', (function () {
      var b = sbox('#bars .barNeed'), v = sbox('#bars text.barVal');
      return b && v && b.x + b.width <= v.x;
    })(), uiOut);
    ok('仮説の図：凡例が棒より下にある', (function () {
      var b = sbox('#bars .barNeed', 1), g = sbox('#bars .barLegend');
      return b && g && b.y + b.height <= g.y;
    })(), uiOut);
    ok('仮説の図：判定が凡例より下にある', (function () {
      var g = sbox('#bars .barLegend'), v = sbox('#bars .verdict');
      return g && v && g.y + g.height <= v.y;
    })(), uiOut);
    ok('仮説の図も viewBox に収まっている', (function () {
      var vb = doc.getElementById('bars').getAttribute('viewBox').split(' ');
      return Array.prototype.every.call(doc.querySelectorAll('#bars > *'), function (e) {
        var b = e.getBBox();
        return b.y >= -1 && b.y + b.height <= parseFloat(vb[3]) + 1 &&
               b.x >= -1 && b.x + b.width <= parseFloat(vb[2]) + 1;
      });
    })(), uiOut);
    ok('所持量の縦線が棒の帯からはみ出さない', (function () {
      var m = sbox('#bars .heldMark'), b = sbox('#bars .barNeed');
      return m && b && m.y <= b.y && m.y + m.height >= b.y + b.height;
    })(), uiOut);

    runTitrationUI();
  }

  // ---- 中和滴定モード（4つ目の iframe）----
  function runTitrationUI() {
    var win = document.getElementById('appTitration').contentWindow;
    var A = win.ChemTitrationApp, doc = win.document;

    section('UI：中和滴定（導入・つり合いが見えている）', uiOut);
    if (!A) { ok('滴定モードが読み込めた', false, uiOut); return finish(); }
    ok('滴定モードが読み込めた', true, uiOut);

    A.setProblem(0);   // t1 HCl 0.10 10.0 mL / NaOH 0.10 ? mL
    ok('問1が表示される', doc.getElementById('qTitle').textContent.indexOf('問1') === 0, uiOut);
    ok('有効数字の指定が出る',
      doc.getElementById('qTitle').textContent.indexOf('有効数字3桁') > 0, uiOut);
    ok('酸と塩基の2行が描かれる', (function () {
      var t = doc.getElementById('blocks').textContent;
      return t.indexOf('酸') >= 0 && t.indexOf('塩基') > 0;
    })(), uiOut);
    ok('図が濃度・体積・価数を並べて見せる',
      doc.getElementById('blocks').textContent.indexOf('0.10 mol/L × 10.0 mL') > 0, uiOut);
    ok('つり合いの条件が図に書かれる',
      doc.getElementById('blocks').textContent.indexOf('H⁺ の物質量 ＝ OH⁻ の物質量') > 0,
      uiOut);
    ok('導入では つり合いの量が最初から見えている',
      doc.getElementById('equivIn') === null &&
      doc.querySelector('#equivRow .convVal').textContent === '0.00100', uiOut);
    ok('答えの単位は mL', doc.querySelector('.ansUnit').textContent === 'mL', uiOut);

    A.check();
    ok('空欄では促される', A.msgText().indexOf('数を入れて') >= 0, uiOut);
    A.type('10.0');
    A.check();
    ok('10.0 mL で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説がつり合いの式を見せる',
      A.msgText().indexOf('0.10 × 10.0/1000 × 1') > 0, uiOut);
    // 公式は最後のまとめとして出す（先に出すと代入作業になる）
    ok('解説の最後に公式がまとめとして出る',
      A.msgText().indexOf('c₁V₁n₁ ＝ c₂V₂n₂') > 0, uiOut);

    section('UI：価数を数える（H2SO4 は1粒で H⁺ 2個）', uiOut);
    A.setProblem(3);   // t4 H2SO4 0.10 10.0 mL / NaOH 0.10 ? mL → 20.0
    ok('つり合いの量を自分で出す段が出る',
      doc.getElementById('equivIn') !== null, uiOut);
    ok('つり合う前は答えの入力が無効',
      doc.getElementById('answer').disabled === true, uiOut);
    ok('つり合う前は未知側のブロックが点線の枠',
      doc.querySelector('#blocks .blkGhost') !== null &&
      doc.querySelector('#blocks .blkQ') !== null, uiOut);
    ok('ヒントが「H⁺ を2個出す」と補足する',
      doc.getElementById('qHint').textContent.indexOf('2個') > 0, uiOut);

    A.check();
    ok('つり合いが空だと 1000 で割ることを促す',
      A.msgText().indexOf('1000 で割る') > 0, uiOut);
    A.typeEquiv('0.0010');
    ok('価数をかけ忘れた量では確定しない', A.state.equivLocked === false, uiOut);
    A.typeEquiv('0.0020');
    ok('0.0020 mol で確定する', A.state.equivLocked === true, uiOut);
    ok('確定すると答えの入力が有効になる',
      doc.getElementById('answer').disabled === false, uiOut);
    ok('確定すると未知側のブロックも描かれる',
      doc.querySelector('#blocks .blkGhost') === null &&
      doc.querySelectorAll('#blocks .blk.base').length === 1, uiOut);
    // 価数のぶんだけブロックが分かれるのが図の要点
    ok('酸のブロックは価数2なので2つに分かれる',
      doc.querySelectorAll('#blocks .blk.acid').length === 2, uiOut);
    ok('左右のブロックの全長が等しい（つり合っている）', (function () {
      var a = doc.querySelectorAll('#blocks .blk.acid');
      var b = doc.querySelectorAll('#blocks .blk.base');
      function total(list) {
        return Array.prototype.reduce.call(list, function (s, e) {
          return s + parseFloat(e.getAttribute('width'));
        }, 0);
      }
      return Math.abs(total(a) - total(b)) < 0.5;
    })(), uiOut);

    A.type('10.0');
    A.check();
    ok('価数を無視した 10.0 は名指しで指摘される',
      A.msgText().indexOf('価数を数えていません') >= 0, uiOut);
    ok('その指摘が「H⁺ を 2 個出す」と言う',
      A.msgText().indexOf('2 個</b>出します') > 0 ||
      A.msgText().indexOf('2 個出します') > 0, uiOut);
    A.type('20.0');
    A.check();
    ok('20.0 mL で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が「÷ 価数」の段を見せる',
      A.msgText().indexOf('÷ 1 ＝') > 0, uiOut);

    section('UI：濃度を問う／mL と L の直し忘れ', uiOut);
    A.setProblem(2);   // t3 HCl 濃度未知 → 0.15 mol/L
    ok('答えの単位は mol/L',
      doc.querySelector('.ansUnit').textContent === 'mol/L', uiOut);
    A.typeEquiv('0.0015');
    A.type('150');
    A.check();
    ok('1000 倍の答えは「mL と L を直し忘れ」と指摘される',
      A.msgText().indexOf('直し忘れ') > 0, uiOut);
    A.type('0.15');
    A.check();
    ok('0.15 mol/L で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が L に直した体積を見せる',
      A.msgText().indexOf('0.0100 L') > 0 || A.msgText().indexOf('mL ＝') > 0, uiOut);

    section('UI：塩基が2価（問われるのが酸の側）', uiOut);
    A.setProblem(6);   // t7 Ca(OH)2 0.10 10.0 mL / HCl 0.20 ? mL → 10.0
    ok('塩基のブロックが2つに分かれる（先に確定させる）', (function () {
      A.typeEquiv('0.0020');
      return doc.querySelectorAll('#blocks .blk.base').length === 2;
    })(), uiOut);
    ok('酸のブロックは1つ',
      doc.querySelectorAll('#blocks .blk.acid').length === 1, uiOut);
    A.type('10.0');
    A.check();
    ok('t7 は 10.0 mL で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('ステージボタンが8個ある',
      doc.querySelectorAll('#stageNav button').length === 8, uiOut);

    section('UI：滴定の図が重ならない', uiOut);
    A.setProblem(3);
    A.typeEquiv('0.0020');
    function tbox(sel, i) {
      var e = doc.querySelectorAll(sel)[i || 0];
      return e ? e.getBBox() : null;
    }
    ok('ラベルが実際に描画されている（<sub> は SVG で描かれない）', (function () {
      var l = tbox('#blocks .blkLab');
      return l && l.height > 0 &&
        doc.querySelector('#blocks .blkLab').textContent.indexOf('H₂SO₄') > 0;
    })(), uiOut);
    ok('ラベルとブロックが重ならない', (function () {
      var l = tbox('#blocks .blkLab'), b = tbox('#blocks .blk.acid');
      return l && b && l.x + l.width <= b.x;
    })(), uiOut);
    ok('2行目のラベルも1行目のブロックと重ならない', (function () {
      var s = tbox('#blocks .blkSub', 1), b = tbox('#blocks .blk.acid');
      return s && b && s.y >= b.y + b.height;
    })(), uiOut);
    ok('ブロックと右の値が重ならない', (function () {
      var b = tbox('#blocks .blk.acid', 1), v = tbox('#blocks .blkVal');
      return b && v && b.x + b.width <= v.x;
    })(), uiOut);
    ok('注記がブロックより下にある', (function () {
      var b = tbox('#blocks .blk.base'), n = tbox('#blocks .blkNote');
      return b && n && b.y + b.height <= n.y;
    })(), uiOut);
    ok('図が viewBox に収まっている', (function () {
      var vb = doc.getElementById('blocks').getAttribute('viewBox').split(' ');
      return Array.prototype.every.call(doc.querySelectorAll('#blocks > *'), function (e) {
        var b = e.getBBox();
        return b.y >= -1 && b.y + b.height <= parseFloat(vb[3]) + 1 &&
               b.x >= -1 && b.x + b.width <= parseFloat(vb[2]) + 1;
      });
    })(), uiOut);

    runThermoUI();
  }

  // ---- 熱化学モード（5つ目の iframe）----
  function runThermoUI() {
    var win = document.getElementById('appThermo').contentWindow;
    var A = win.ChemThermoApp, doc = win.document;

    section('UI：熱化学（符号は向きで決まる）', uiOut);
    if (!A) { ok('熱化学モードが読み込めた', false, uiOut); return finish(); }
    ok('熱化学モードが読み込めた', true, uiOut);

    A.setProblem(0);   // h1 CO2 → C + O2（逆向き）→ ＋394
    ok('問1が表示される', doc.getElementById('qTitle').textContent.indexOf('問1') === 0, uiOut);
    ok('与えられた式が示される',
      doc.getElementById('givenBox').textContent.indexOf('ΔH ＝ −394 kJ') > 0, uiOut);
    ok('縦軸に「エネルギーが高い」と出る',
      doc.getElementById('chart').textContent.indexOf('エネルギーが高い') >= 0, uiOut);
    ok('準位が2本描かれる',
      doc.querySelectorAll('#chart .lvLine').length === 2, uiOut);
    ok('基準の準位は 0 と表示される',
      doc.querySelector('#chart text.lvVal.ref').textContent === '0', uiOut);
    ok('答えの矢印は赤の点線で、答えるまで ? のまま',
      doc.querySelector('#chart .arrAsk') !== null &&
      doc.querySelector('#chart .arrAskLab').textContent === '?', uiOut);
    ok('高い準位のほうが図の上にある', (function () {
      var lines = doc.querySelectorAll('#chart .lvLine');
      // 基準（0）が CO2（−394）より上に来ているか
      var refY = parseFloat(doc.querySelector('#chart .lvLine.ref').getAttribute('y1'));
      var other = Array.prototype.filter.call(lines, function (l) {
        return !l.classList.contains('ref');
      })[0];
      return refY < parseFloat(other.getAttribute('y1'));
    })(), uiOut);
    ok('答えの単位は kJ で、符号が必要だと明示する',
      doc.querySelector('.ansUnit').textContent === 'kJ' &&
      doc.querySelector('.ansNote').textContent.indexOf('符号') >= 0, uiOut);

    A.check();
    ok('空欄では符号も含めて促される', A.msgText().indexOf('符号') > 0, uiOut);
    A.type('-394');
    A.check();
    ok('符号が逆なら名指しで指摘される', A.msgText().indexOf('符号が逆') >= 0, uiOut);
    ok('その指摘が図の上下で説明する',
      A.msgText().indexOf('上がります') > 0 || A.msgText().indexOf('下がります') > 0, uiOut);
    A.type('394');
    A.check();
    ok('394 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('正解すると答えの矢印に値が入る',
      doc.querySelector('#chart .arrAskLab').textContent === '＋394', uiOut);
    ok('解説が逆向きの符号反転にも触れる',
      A.msgText().indexOf('符号が反転') > 0, uiOut);

    section('UI：ヘスの法則（図を組み立てる）', uiOut);
    A.setProblem(1);   // h2 CO の生成熱 −111
    ok('準位を置く行が2つ出る',
      doc.querySelectorAll('#levelRows .convRow').length === 2, uiOut);
    ok('置く前は基準の準位だけが描かれる',
      doc.querySelectorAll('#chart .lvLine').length === 1, uiOut);
    ok('置く前は答えの入力が無効',
      doc.getElementById('answer').disabled === true, uiOut);
    ok('置く根拠の式が添えられる',
      doc.querySelectorAll('#levelRows .convWhy')[1].textContent.indexOf('−283') > 0, uiOut);

    A.check();
    ok('置く前に確かめると図の組み立てを促す',
      A.msgText().indexOf('図が組み立っていません') >= 0, uiOut);
    A.typeLevel('c', '394');
    ok('符号を間違えた高さでは確定しない', A.state.lvLocked.c !== true, uiOut);
    A.typeLevel('c', '-394');
    ok('−394 で確定する', A.state.lvLocked.c === true, uiOut);
    ok('確定すると準位が図に増える',
      doc.querySelectorAll('#chart .lvLine').length === 2, uiOut);
    ok('片方だけでは答えの入力はまだ無効',
      doc.getElementById('answer').disabled === true, uiOut);
    // CO の準位は CO2 から逆向きにたどる（符号が反転する）ので、ここが山
    A.typeLevel('b', '-111');
    ok('CO の準位 −111 で確定する', A.state.lvLocked.b === true, uiOut);
    ok('図ができたと伝える', A.msgText().indexOf('図ができました') >= 0, uiOut);
    ok('準位が3本そろう',
      doc.querySelectorAll('#chart .lvLine').length === 3, uiOut);
    ok('与えられた矢印が2本描かれる',
      doc.querySelectorAll('#chart .arr').length === 2, uiOut);
    ok('答えの入力が有効になる',
      doc.getElementById('answer').disabled === false, uiOut);

    A.type('-111');
    A.check();
    ok('−111 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が高さの差の式を見せる',
      A.msgText().indexOf('−111 −（0）') > 0, uiOut);
    ok('解説が発熱だと述べる', A.msgText().indexOf('発熱') > 0, uiOut);

    section('UI：結合エネルギー（原子が上に来る）', uiOut);
    A.setProblem(3);   // h4 H2 + Cl2 → 2HCl（−185）
    ok('ヒントが「結合を切るときは ＋」と言う',
      doc.getElementById('qHint').textContent.indexOf('結合を切るときは ＋') > 0, uiOut);
    A.placeAll();
    ok('原子の準位が反応物より上にある', (function () {
      var vals = Array.prototype.map.call(doc.querySelectorAll('#chart .lvVal'),
        function (t) { return t.textContent; });
      return vals.indexOf('＋679') >= 0 && vals.indexOf('−185') >= 0;
    })(), uiOut);
    A.type('-185');
    A.check();
    ok('h4 は −185 で正解', A.msgText().indexOf('正解') >= 0, uiOut);

    A.setProblem(2);   // h3 メタンの燃焼熱（足し引きの誤りを拾う）
    A.placeAll();
    A.type('-1041');
    A.check();
    ok('足してしまった答えを名指しで指摘する',
      A.msgText().indexOf('足してしまって') >= 0, uiOut);
    A.type('-891');
    A.check();
    ok('h3 は −891 で正解', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('ステージボタンが6個ある',
      doc.querySelectorAll('#stageNav button').length === 6, uiOut);

    section('UI：エネルギー図が重ならない', uiOut);
    A.setProblem(1);
    A.placeAll();
    function hbox(sel, i) {
      var e = doc.querySelectorAll(sel)[i || 0];
      return e ? e.getBBox() : null;
    }
    ok('準位のラベルが実際に描画されている', (function () {
      var l = hbox('#chart .lvLab');
      return l && l.height > 0 &&
        doc.querySelector('#chart .lvLab').textContent.indexOf('O₂') > 0;
    })(), uiOut);
    ok('準位のラベルが線より上にある', (function () {
      var l = hbox('#chart .lvLab');
      var ly = parseFloat(doc.querySelector('#chart .lvLine').getAttribute('y1'));
      return l && l.y + l.height <= ly + 1;
    })(), uiOut);
    ok('準位の線と右の値が重ならない', (function () {
      var v = hbox('#chart .lvVal');
      return v && v.x >= 380;
    })(), uiOut);
    ok('縦軸と準位の線が重ならない', (function () {
      var a = hbox('#chart .axis');
      return a && a.x + a.width <= 90;
    })(), uiOut);
    ok('矢印のラベルが縦軸より右にある', (function () {
      var l = hbox('#chart .arrLab');
      return l && l.x > 60;
    })(), uiOut);
    ok('図が viewBox に収まっている', (function () {
      var vb = doc.getElementById('chart').getAttribute('viewBox').split(' ');
      return Array.prototype.every.call(doc.querySelectorAll('#chart > *'), function (e) {
        var b = e.getBBox();
        return b.y >= -1 && b.y + b.height <= parseFloat(vb[3]) + 1 &&
               b.x >= -1 && b.x + b.width <= parseFloat(vb[2]) + 1;
      });
    })(), uiOut);
    ok('準位の線どうしが十分に離れている', (function () {
      var ys = Array.prototype.map.call(doc.querySelectorAll('#chart .lvLine'),
        function (l) { return parseFloat(l.getAttribute('y1')); }).sort(function (a, b) {
        return a - b;
      });
      for (var i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] < 25) return false;
      return true;
    })(), uiOut);
    ok('比例で描けているときは縮尺の注記を出さない',
      doc.querySelector('#chart .scaleNote') === null, uiOut);

    // 黒鉛とダイヤモンドは差 2 kJ に対して全体 396 kJ。比例のままだと2本が重なる
    section('UI：差が小さい準位を引き離す（縮尺を崩したら明示する）', uiOut);
    A.setProblem(5);
    A.placeAll();
    ok('差 2 kJ の2本も重ならずに描かれる', (function () {
      var ys = Array.prototype.map.call(doc.querySelectorAll('#chart .lvLine'),
        function (l) { return parseFloat(l.getAttribute('y1')); }).sort(function (a, b) {
        return a - b;
      });
      return ys.length === 3 && ys[1] - ys[0] >= 25;
    })(), uiOut);
    ok('縮尺を崩したことを図に書く（黙って崩さない）', (function () {
      var n = doc.querySelector('#chart .scaleNote');
      return n && n.textContent.indexOf('縮尺は正確ではない') > 0;
    })(), uiOut);
    ok('ダイヤモンドのほうが上に描かれる', (function () {
      var lines = doc.querySelectorAll('#chart .lvLine');
      var refY = parseFloat(doc.querySelector('#chart .lvLine.ref').getAttribute('y1'));
      var ys = Array.prototype.map.call(lines, function (l) {
        return parseFloat(l.getAttribute('y1'));
      });
      return Math.min.apply(null, ys) < refY;
    })(), uiOut);
    A.type('2');
    A.check();
    ok('h6 は 2 で正解（＋2）', A.msgText().indexOf('正解') >= 0, uiOut);
    ok('解説が吸熱だと述べる', A.msgText().indexOf('吸熱') > 0, uiOut);

    runPortalUI();
    runTapTargets();
    finish();
  }

  // ================================================================
  // タップ標的の下限（32px）
  // ----------------------------------------------------------------
  // いちばん押される導線（ヘッダーの3本）が 24〜26px しかなく、全端末で
  // 警告になっていた（docs/REVIEW_layout_devices.md の警告C）。Apple の指針は
  // 44pt・Google は 48dp だが、まずその手前の **32px を下限**として固定する。
  // 字の大きさや余白をいじった拍子に戻るのを、ここで機械に見張らせる。
  //
  // 高さだけを見るのは、幅は文字数で自然に足りるのに対し、**縮むのはいつも縦**
  // だから（padding を詰めた結果 24px になっていた）。
  //
  // **例外は input.facBox（倍率の分子・分母）だけ**。2つで1つの分数なので、
  // それぞれ 32px にすると分数が 64px を超えて表が崩れる。上下あわせて 44px の
  // 標的として扱う（v23 からの判断を引き継ぐ）。
  // ================================================================
  var TAP_MIN = 32;

  // 押す物だけを拾う。本文中のリンク（display:inline の a）は行の一部であって
  // 押しボタンではないので数えない（tools/check-mobile.mjs と同じ線引き）
  function tooSmallTargets(doc) {
    var bad = [];
    Array.prototype.forEach.call(
      doc.querySelectorAll('button, input, select, summary, a'), function (e) {
        var r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;            // 出ていない
        var cs = doc.defaultView.getComputedStyle(e);
        if (cs.visibility === 'hidden') return;
        if (e.tagName === 'A' && cs.display === 'inline') return;
        if (e.classList.contains('facBox')) return;          // 上の例外
        if (r.height < TAP_MIN) {
          bad.push((e.id ? '#' + e.id : e.tagName +
            (typeof e.className === 'string' && e.className
              ? '.' + e.className.split(' ')[0] : '')) +
            ' ' + Math.round(r.width) + '×' + Math.round(r.height));
        }
      });
    return bad;
  }

  // 該当する要素すべての最小の高さ。1つも出ていなければ -1（＝呼ぶ側で不合格にする）。
  // **出ていない物は数えない**（[hidden] の「次へ」は高さ0で、押せないのだから
  // 標的の大きさを問う相手ではない）
  function minTapH(doc, sel) {
    var m = Infinity;
    Array.prototype.forEach.call(doc.querySelectorAll(sel), function (e) {
      var r = e.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return;
      m = Math.min(m, r.height);
    });
    return m === Infinity ? -1 : m;
  }

  function runTapTargets() {
    section('UI：タップ標的の下限（32px）', uiOut);
    var ALL_F = ['appPortal', 'app', 'appBalance', 'appStoich', 'appTitration', 'appThermo'];
    var MODE_F = ['app', 'appBalance', 'appStoich', 'appTitration', 'appThermo'];
    function d(id) { return document.getElementById(id).contentDocument; }

    // ここが 24px だったのが今回の発端。入口と5モードの全ページで見る
    ok('ヘッダーのハブ／入口へのリンクが 32px 以上', ALL_F.every(function (id) {
      return minTapH(d(id), 'header .modeLink') >= TAP_MIN;
    }), uiOut);
    ok('ヘッダーのモード切り替えが 32px 以上', MODE_F.every(function (id) {
      return minTapH(d(id), 'header .modeJump > summary') >= TAP_MIN;
    }), uiOut);
    ok('切り替えを開いた中のモード一覧が 32px 以上', MODE_F.every(function (id) {
      var det = d(id).querySelector('header details.modeJump');
      det.open = true;                  // 閉じたままだと高さ0で測れない
      var h = minTapH(d(id), '.modeJumpList a');
      det.open = false;                 // 既定は閉じている。測ったら必ず戻す
      return h >= TAP_MIN;
    }), uiOut);
    ok('「考え方」の開閉が 32px 以上', ALL_F.every(function (id) {
      return minTapH(d(id), 'details.howto > summary') >= TAP_MIN;
    }), uiOut);
    ok('問題を選ぶ丸が 32px 以上', MODE_F.every(function (id) {
      return minTapH(d(id), '#stageNav button') >= TAP_MIN;
    }), uiOut);
    ok('たしかめる／次へのボタンが 32px 以上', MODE_F.every(function (id) {
      return minTapH(d(id), '.actions button') >= TAP_MIN;
    }), uiOut);
    // 入力欄も指で押す物なので、ボタンと同じ扱いにする
    ok('答えの入力欄が 32px 以上', MODE_F.every(function (id) {
      var h = minTapH(d(id),
        '.ansRow input.num, td.cell input.num, table.stoich td.sc input.num');
      return h >= TAP_MIN;
    }), uiOut);
    ok('区間を等分するボタンが 32px 以上',
      minTapH(d('appBalance'), '#divBar button') >= TAP_MIN, uiOut);
    // アプリ横断の道（行きと戻り）。ここが押しにくいと辞書引きの流れが切れる
    ok('隣のアプリへの道（なぜこの係数？）が 32px 以上',
      minTapH(d('appStoich'), '#eqBox .eqAsk') >= TAP_MIN, uiOut);
    ok('横断で来たときの戻り道が 32px 以上',
      minTapH(d('appLinked'), '#fromBox .fromBack') >= TAP_MIN, uiOut);

    // 段階の足場（単位の4択・向きの切り替え）は問題を選ばないと出ない
    var A = document.getElementById('app').contentWindow.ChemRatioApp;
    A.setProblem(2);   // 問3 ＝ 単位の4択が出る
    ok('単位の4択が 32px 以上',
      minTapH(d('app'), '.unitPick button') >= TAP_MIN, uiOut);
    ok('比をとる向きの切り替えが 32px 以上',
      minTapH(d('app'), '#orientBar button') >= TAP_MIN, uiOut);

    // 一掃。ここに引っかかったら「小さくてよい理由」を書いたうえで
    // 上の例外に足すか、素直に大きくすること
    ok('入口と5モードに 32px 未満の押す物が残っていない', ALL_F.every(function (id) {
      var bad = tooSmallTargets(d(id));
      if (bad.length && window.console) {
        console.warn(id + ' に小さい標的: ' + bad.join(' / '));
      }
      return bad.length === 0;
    }), uiOut);
  }

  function finish() {
    restoreProgress();   // テストで解いた分を学習者の進捗に混ぜない
    var total = document.getElementById('total');
    total.textContent = fail === 0
      ? 'ALL PASS (' + pass + ')'
      : fail + ' FAILED / ' + (pass + fail);
    total.className = fail === 0 ? 'pass' : 'fail';
  }

  // 6つの iframe（入口＋5モード）がそろってから UI テストを始める
  function whenReady(frame, prop, cb) {
    if (frame.contentWindow && frame.contentWindow[prop]) cb();
    else frame.addEventListener('load', cb);
  }
  var pending = 8;
  function ready() { if (--pending === 0) runUI(document.getElementById('app').contentWindow); }
  whenReady(document.getElementById('app'), 'ChemRatioApp', ready);
  whenReady(document.getElementById('appBalance'), 'ChemBalanceApp', ready);
  whenReady(document.getElementById('appStoich'), 'ChemStoichApp', ready);
  whenReady(document.getElementById('appTitration'), 'ChemTitrationApp', ready);
  whenReady(document.getElementById('appThermo'), 'ChemThermoApp', ready);
  whenReady(document.getElementById('appPortal'), 'ChemRatioPortal', ready);
  whenReady(document.getElementById('appLinked'), 'ChemStoichApp', ready);
  whenReady(document.getElementById('appBadLink'), 'ChemStoichApp', ready);
})();
