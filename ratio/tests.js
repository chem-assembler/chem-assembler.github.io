// 比例式でみる化学計算 — 回帰テスト（モデル＋iframe UI駆動）
(function () {
  'use strict';

  var M = window.ChemRatio;
  var pass = 0, fail = 0;
  var out = document.getElementById('results');
  var uiOut = document.getElementById('uiresults');

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

  ok('列の並びは mol が右（mass, mole）',
    M.orderCols('mole', 'mass').join() === 'mass,mole');
  ok('列の並びは mol が右（count, mole）',
    M.orderCols('mole', 'count').join() === 'count,mole');
  ok('列の並びは mass が左（volume, mass）',
    M.orderCols('volume', 'mass').join() === 'mass,volume');

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
  ok('q1 は右列（物質量）が未知', M.unknownIndex(byId('q1')) === 1);
  ok('q2 は左列（質量）が未知', M.unknownIndex(byId('q2')) === 0);
  ok('q1 の未知の量は mole', M.unknownQuantity(byId('q1')) === 'mole');
  ok('q2 の未知の量は mass', M.unknownQuantity(byId('q2')) === 'mass');

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

  section('モデル：どちら向きが楽かの判定');
  ok('q1 は たて が楽（よこは 1/18）', M.recommend(byId('q1')) === 'v');
  ok('q2 は どちらでも大差ない（1/4 と ×44）', M.recommend(byId('q2')) === 'either');
  ok('q3 は たて が楽', M.recommend(byId('q3')) === 'v');
  ok('q4 は どちらでも大差ない（×3 と ×12）', M.recommend(byId('q4')) === 'either');
  ok('q5 は たて が楽（よこは 1/40）', M.recommend(byId('q5')) === 'v');
  ok('q6 は たて が楽（よこは 6.0×10²³ 倍）', M.recommend(byId('q6')) === 'v');
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

  section('モデル：数値の表示');
  ok('18 → "18"', M.fmt(18) === '18');
  ok('null → ""', M.fmt(null) === '');
  ok('文字列 "9.0" は末尾の0を保つ', M.disp('9.0') === '9.0');
  ok('文字列 "9.0" は計算では 9', M.val('9.0') === 9);
  ok('"6.0e23" → 6.0×10²³', M.disp('6.0e23') === '6.0×10²³');
  ok('sci が仮数と指数に分解', M.sci('6.0e23').m === '6.0' && M.sci('6.0e23').e === '23');
  ok('通常の数は sci で null', M.sci('18') === null);
  ok('大きい整数倍は指数表記になる', M.numText(6e23).indexOf('×10') > 0);

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

    finish();
  }

  function finish() {
    var total = document.getElementById('total');
    total.textContent = fail === 0
      ? 'ALL PASS (' + pass + ')'
      : fail + ' FAILED / ' + (pass + fail);
    total.className = fail === 0 ? 'pass' : 'fail';
  }

  var frame = document.getElementById('app');
  if (frame.contentWindow && frame.contentWindow.ChemRatioApp) runUI(frame.contentWindow);
  else frame.onload = function () { runUI(frame.contentWindow); };
})();
