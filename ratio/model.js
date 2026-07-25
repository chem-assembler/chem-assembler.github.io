// 比例式でみる化学計算 — モデル（DOM非依存の純粋ロジック）
// 比例式は 2列×2行 の表として持つ。
//   列 = 量の種類（質量・物質量・体積・粒子の数）
//   行 = 上が「基準」（1 mol あたり）、下が「知りたい量」
// 解き方は「内項の積＝外項の積」ではなく【倍率が同じ】。倍率は2方向にとれる:
//   たて（factorV）= 行から行へ。よこ（factorH）= 列から列へ。
// どちらが楽かは問題によって変わるので両方を持ち、recommend() で推す。
//
// 問題は SPECS（物質＋与えられた量＋問われる量）から buildProblem() で生成する。
// 基準の行は「1 mol あたりの値」なので、分子量さえあれば機械的に決まる。
(function (global) {
  'use strict';

  var QUANTITIES = {
    mass:   { key: 'mass',   label: '質量',     unit: 'g'   },
    mole:   { key: 'mole',   label: '物質量',   unit: 'mol' },
    volume: { key: 'volume', label: '体積',     unit: 'L'   },
    count:  { key: 'count',  label: '粒子の数', unit: '個'  }
  };

  // 表の列の並び順（mol を右端に置くと「基準の軸」に見える）
  var COL_ORDER = ['mass', 'volume', 'count', 'mole'];

  // 単位の4択に出す候補（全4種。位置は問題ごとに回す）
  var ALL_QUANTITIES = ['mass', 'mole', 'volume', 'count'];

  // 標準状態の気体1 mol の体積・アボガドロ数。基準の行はこれらと分子量から作る。
  var MOLAR_VOLUME = '22.4';
  var AVOGADRO = '6.0e23';

  // 分子量・式量は**文字列**で持つ（'2.0' の末尾の 0 を表示で保つため）
  var SUBSTANCES = {
    H2O:     { name: '水',                 formula: 'H<sub>2</sub>O',  M: '18',   particle: '分子' },
    CO2:     { name: '二酸化炭素',         formula: 'CO<sub>2</sub>',  M: '44',   particle: '分子', gas: true },
    O2:      { name: '酸素',               formula: 'O<sub>2</sub>',   M: '32',   particle: '分子', gas: true },
    N2:      { name: '窒素',               formula: 'N<sub>2</sub>',   M: '28',   particle: '分子', gas: true },
    H2:      { name: '水素',               formula: 'H<sub>2</sub>',   M: '2.0',  particle: '分子', gas: true },
    NH3:     { name: 'アンモニア',         formula: 'NH<sub>3</sub>',  M: '17',   particle: '分子', gas: true },
    CH4:     { name: 'メタン',             formula: 'CH<sub>4</sub>',  M: '16',   particle: '分子', gas: true },
    HCl:     { name: '塩化水素',           formula: 'HCl',             M: '36.5', particle: '分子', gas: true },
    H2SO4:   { name: '硫酸',               formula: 'H<sub>2</sub>SO<sub>4</sub>', M: '98' },
    NaOH:    { name: '水酸化ナトリウム',   formula: 'NaOH',            M: '40'  },
    NaCl:    { name: '塩化ナトリウム',     formula: 'NaCl',            M: '58.5' },
    NaHCO3:  { name: '炭酸水素ナトリウム', formula: 'NaHCO<sub>3</sub>', M: '84' },
    CaCO3:   { name: '炭酸カルシウム',     formula: 'CaCO<sub>3</sub>', M: '100' },
    CaO:     { name: '酸化カルシウム',     formula: 'CaO',             M: '56'  },
    CuSO4:   { name: '硫酸銅(II)',         formula: 'CuSO<sub>4</sub>', M: '160' },
    C:       { name: '炭素',               formula: 'C',               M: '12'  },
    Cu:      { name: '銅',                 formula: 'Cu',              M: '64'  },
    Al:      { name: 'アルミニウム',       formula: 'Al',              M: '27'  },
    Fe:      { name: '鉄',                 formula: 'Fe',              M: '56'  },
    C6H12O6: { name: 'グルコース',         formula: 'C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>', M: '180', particle: '分子' }
  };

  // 問題の仕様。steps は学習者にやらせる段階（省略した段階は最初から見せる＝足場）
  //   unit   … 答えの単位を4択で選ぶ
  //   factor … 倍率を自分で分数で入れる（正しく入ると もう一方の矢印に自動で入る）
  // sig は解答に要求する有効数字の桁数（問題文に明示し、桁が違えば指導する）
  var SPECS = [
    // --- ①導入：倍率も単位も見えている ---
    { id: 'q1',  sub: 'H2O',     given: { q: 'mass',   v: '9.0'  }, asked: 'mole',   steps: {}, sig: 2 },
    { id: 'q2',  sub: 'CO2',     given: { q: 'mole',   v: '0.25' }, asked: 'mass',   steps: {}, sig: 2 },
    // --- ①'：単位をえらぶ ---
    { id: 'q3',  sub: 'O2',      given: { q: 'volume', v: '5.6'  }, asked: 'mole',   steps: { unit: true }, sig: 2 },
    { id: 'q4',  sub: 'C',       given: { q: 'mole',   v: '3.0'  }, asked: 'mass',   steps: { unit: true }, sig: 2 },
    // --- ②：倍率を自分で探す ---
    { id: 'q5',  sub: 'NaOH',    given: { q: 'mass',   v: '20'   }, asked: 'mole',   steps: { factor: true }, sig: 2 },
    { id: 'q6',  sub: 'H2O',     given: { q: 'mole',   v: '0.50' }, asked: 'count',  steps: { unit: true, factor: true }, sig: 2 },
    // --- M1.5：同じ型で問題数を増やす ---
    { id: 'q7',  sub: 'CaCO3',   given: { q: 'mass',   v: '25'   }, asked: 'mole',   steps: {}, sig: 2 },
    { id: 'q8',  sub: 'NaCl',    given: { q: 'mass',   v: '11.7' }, asked: 'mole',   steps: { unit: true }, sig: 3 },
    // よこの倍率（×44）のほうが楽な問題。推奨が 'h' になる
    { id: 'q9',  sub: 'CO2',     given: { q: 'mole',   v: '0.30' }, asked: 'mass',   steps: { unit: true }, sig: 2 },
    { id: 'q10', sub: 'O2',      given: { q: 'mole',   v: '3.0'  }, asked: 'volume', steps: {}, sig: 2 },
    // 質量↔体積（mol を経由せず、基準の行が 44 g : 22.4 L になる）
    { id: 'q11', sub: 'CO2',     given: { q: 'mass',   v: '11'   }, asked: 'volume', steps: { unit: true }, sig: 2 },
    // 質量↔粒子の数（指数が上がる: 6.0×10²³ × 2 = 1.2×10²⁴）
    { id: 'q12', sub: 'H2O',     given: { q: 'mass',   v: '36'   }, asked: 'count',  steps: { factor: true }, sig: 2 },
    { id: 'q13', sub: 'C6H12O6', given: { q: 'mass',   v: '90'   }, asked: 'mole',   steps: { factor: true }, sig: 2 },
    { id: 'q14', sub: 'Cu',      given: { q: 'mole',   v: '0.25' }, asked: 'mass',   steps: { unit: true }, sig: 2 },
    { id: 'q15', sub: 'Al',      given: { q: 'mass',   v: '5.4'  }, asked: 'mole',   steps: { factor: true }, sig: 2 },
    { id: 'q16', sub: 'N2',      given: { q: 'volume', v: '11.2' }, asked: 'mole',   steps: { unit: true, factor: true }, sig: 3 },
    // 粒子の数が与えられ、質量を問う（指数の入力ではなく指数の読み取り）
    { id: 'q17', sub: 'H2O',     given: { q: 'count',  v: '3.0e23' }, asked: 'mass', steps: { unit: true, factor: true }, sig: 2 },
    { id: 'q18', sub: 'HCl',     given: { q: 'mass',   v: '7.3'  }, asked: 'mole',   steps: { factor: true }, sig: 2 },
    { id: 'q19', sub: 'NaHCO3',  given: { q: 'mole',   v: '0.50' }, asked: 'mass',   steps: { unit: true, factor: true }, sig: 2 },
    { id: 'q20', sub: 'Fe',      given: { q: 'mass',   v: '14'   }, asked: 'mole',   steps: { unit: true, factor: true }, sig: 2 }
  ];

  // ---- 数値と表示 ----

  // 値は数値でも文字列でもよい。文字列で書いた場合は有効数字の表記
  // （'9.0' や '22.4'）をそのまま表示に使う。計算には val() で数値化して使う。
  function val(v) { return typeof v === 'number' ? v : parseFloat(v); }

  function fmt(n) {
    if (n === null || n === undefined) return '';
    return Math.abs(n) < 1e-4 && n !== 0
      ? n.toExponential(2)
      : String(Math.round(n * 1e6) / 1e6);
  }

  // 指数表記を Unicode 上付き文字で作る（'6.0e23' → '6.0×10²³'）。
  // model.js を DOM 非依存に保つため、markup ではなく文字で表す。
  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
              '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function sup(s) {
    return String(s).split('').map(function (c) { return SUP[c] || c; }).join('');
  }
  function sci(v) {
    var m = /^([0-9.]+)e([+-]?\d+)$/i.exec(String(v));
    return m ? { m: m[1], e: String(parseInt(m[2], 10)) } : null;
  }
  function disp(v) {
    var s = sci(v);
    if (s) return s.m + '×10' + sup(s.e);
    return typeof v === 'string' ? v : fmt(v);
  }
  // 大きい/小さい数は指数表記にして読めるようにする
  function numText(n) {
    if (n !== 0 && (Math.abs(n) >= 1e4 || Math.abs(n) < 1e-3)) {
      var m = /^(-?[\d.]+)e([+-]\d+)$/.exec(n.toExponential(1));
      return m ? m[1] + '×10' + sup(String(parseInt(m[2], 10))) : String(n);
    }
    return fmt(n);
  }

  // 指定の有効数字で書いた文字列にする（'0.50'・'13'・'3.0e23'）。
  // ansDisp を手書きせず、答えの表記をここで機械的に決める。
  function toSig(v, n) {
    var s = v.toPrecision(n);
    var m = /^(-?[\d.]+)e([+-]\d+)$/.exec(s);
    return m ? m[1] + 'e' + parseInt(m[2], 10) : s;
  }

  // ---- 問題の生成 ----

  function orderCols(a, b) {
    return COL_ORDER.indexOf(a) <= COL_ORDER.indexOf(b) ? [a, b] : [b, a];
  }

  // 基準の行 ＝ 「1 mol あたりの値」。分子量と定数から機械的に決まる。
  function perMol(sub, q) {
    if (q === 'mole') return 1;
    if (q === 'mass') return sub.M;
    if (q === 'volume') return MOLAR_VOLUME;
    return AVOGADRO;
  }

  // 単位の4択。全4種を出し、正解の位置が問題ごとに変わるように回す。
  function makeChoices(ordinal) {
    var r = ordinal % ALL_QUANTITIES.length;
    return ALL_QUANTITIES.slice(r).concat(ALL_QUANTITIES.slice(0, r));
  }

  function makeTitle(sub, given, asked) {
    var pre = (given.q === 'volume' || asked === 'volume') ? '標準状態で' : '';
    var subj = sub.name + ' ' + sub.formula;
    var part = sub.particle || '粒子';
    if (given.q === 'count') {
      return pre + subj + ' の' + part + ' ' + disp(given.v) + ' 個は何 ' +
             QUANTITIES[asked].unit + ' か';
    }
    if (asked === 'count') {
      return pre + subj + ' ' + disp(given.v) + ' ' + QUANTITIES[given.q].unit +
             ' の中に、' + part + 'は何個あるか';
    }
    return pre + subj + ' ' + disp(given.v) + ' ' + QUANTITIES[given.q].unit +
           ' は何 ' + QUANTITIES[asked].unit + ' か';
  }

  // 基準の行が何を意味するかを言葉にする（列の組み合わせで決まる）
  function makeHint(sub, cols) {
    var has = function (q) { return cols.indexOf(q) >= 0; };
    var part = sub.particle || '粒子';
    if (has('mass') && has('mole')) {
      return sub.name + ' ' + sub.formula + ' 1 mol の質量は ' + disp(sub.M) + ' g';
    }
    if (has('volume') && has('mole')) {
      return '標準状態では、気体 1 mol の体積は種類によらず ' + disp(MOLAR_VOLUME) + ' L';
    }
    if (has('count') && has('mole')) {
      return 'どんな物質でも 1 mol は 6.0×10<sup>23</sup> 個（アボガドロ数）';
    }
    if (has('mass') && has('volume')) {
      return '標準状態で ' + sub.formula + ' 1 mol は ' + disp(sub.M) + ' g、体積は ' +
             disp(MOLAR_VOLUME) + ' L';
    }
    if (has('mass') && has('count')) {
      return sub.formula + ' 1 mol は ' + disp(sub.M) + ' g で、その中に' + part +
             'が 6.0×10<sup>23</sup> 個';
    }
    return '標準状態で気体 1 mol は ' + disp(MOLAR_VOLUME) +
           ' L で、その中に' + part + 'が 6.0×10<sup>23</sup> 個';
  }

  function buildProblem(spec, ordinal) {
    var sub = SUBSTANCES[spec.sub];
    var cols = orderCols(spec.given.q, spec.asked);
    var gi = cols.indexOf(spec.given.q);
    var target = [null, null];
    target[gi] = spec.given.v;

    var p = {
      id: spec.id,
      sub: spec.sub,
      steps: spec.steps || {},
      sigfigs: spec.sig,
      title: makeTitle(sub, spec.given, spec.asked),
      hint: makeHint(sub, cols),
      cols: cols,
      base: [perMol(sub, cols[0]), perMol(sub, cols[1])],
      target: target
    };
    if (p.steps.unit) p.choices = makeChoices(ordinal);
    // 答えの表記は分子量から機械的に決める（手書きしない）
    p.ansDisp = spec.ansDisp || toSig(solve(p), spec.sig);
    return p;
  }

  // ---- 比例式の構造 ----

  function unknownIndex(p) { return p.target[0] === null ? 0 : 1; }
  function unknownQuantity(p) { return p.cols[unknownIndex(p)]; }

  function solve(p) {
    var u = unknownIndex(p), k = 1 - u;
    return val(p.base[u]) * val(p.target[k]) / val(p.base[k]);
  }

  // 倍率を逆さまに使ってしまった場合の値
  function flippedAnswer(p) {
    var u = unknownIndex(p), k = 1 - u;
    return val(p.base[k]) * val(p.target[k]) / val(p.base[u]);
  }

  // ---- 倍率（たて・よこ） ----

  // 小さな分数への近似（1/2・1/4・3 など）。きれいに乗らなければ null
  function ratio(v) {
    for (var d = 1; d <= 1000; d++) {
      var n = v * d;
      // 分子が 0 に丸まるのは「小さすぎて分数にならない」ということ。
      // これを拾うと 18/(6.0×10²³) が「×0」＝整数倍と誤判定される。
      if (Math.round(n) === 0) continue;
      if (Math.abs(n - Math.round(n)) < 1e-9 * Math.max(1, Math.abs(n))) {
        return { n: Math.round(n), d: d };
      }
    }
    return null;
  }

  function frac(v) {
    var r = ratio(v);
    return { value: v, n: r ? r.n : null, d: r ? r.d : null };
  }

  // たて＝基準の行から知りたい量の行へ。両方の列で同じ倍率になる。
  function factorV(p) {
    var k = 1 - unknownIndex(p);
    return frac(val(p.target[k]) / val(p.base[k]));
  }

  // よこ＝既知の列から未知の列へ。基準の行でも知りたい量の行でも同じ倍率になる。
  function factorH(p) {
    var u = unknownIndex(p), k = 1 - u;
    return frac(val(p.base[u]) / val(p.base[k]));
  }

  function factorOf(p, orient) {
    return orient === 'h' ? factorH(p) : factorV(p);
  }

  function factorText(f) {
    if (f.d === 1) return '×' + numText(f.n);
    if (f.n !== null) return '×' + f.n + '/' + f.d;
    return '×' + numText(f.value);
  }

  // 暗算で扱える倍率か（整数倍・単位分数・分母も分子も小さい分数）
  function isEasy(f) {
    if (f.n === null) return false;
    if (f.d === 1) return Math.abs(f.n) <= 50;
    if (f.n === 1) return f.d <= 10;
    return f.d <= 4 && Math.abs(f.n) <= 20;
  }

  // どちら向きに比をとるのが楽か。'v' たて / 'h' よこ / 'either' 大差なし
  function recommend(p) {
    var v = factorV(p), h = factorH(p);
    var ev = isEasy(v), eh = isEasy(h);
    if (ev && eh) return 'either';
    if (ev) return 'v';
    if (eh) return 'h';
    return (v.d || 9999) <= (h.d || 9999) ? 'v' : 'h';
  }

  // 学習者が入れた倍率が正しいか（分子・分母で受け取る）
  function checkFactor(p, orient, n, d) {
    var nn = parseFloat(n), dd = parseFloat(d);
    if (!isFinite(nn) || !isFinite(dd) || dd === 0) return false;
    var f = factorOf(p, orient);
    return Math.abs(nn / dd - f.value) <= Math.max(1e-12, Math.abs(f.value) * 0.005);
  }

  // ---- 有効数字 ----

  // 文字列の有効数字の桁数。小数点なしの末尾の 0 は曖昧なので範囲で返す
  // （'20' は 1〜2桁のどちらとも解釈できる）。
  function sigFigRange(s) {
    var t = String(s).trim().replace(/^[+-]/, '');
    var m = /^([0-9]*)(?:\.([0-9]*))?(?:e[+-]?\d+)?$/i.exec(t);
    if (!m || (m[1] === '' && m[2] === undefined)) return null;
    var hasDot = m[2] !== undefined;
    var digits = ((m[1] || '') + (m[2] || '')).replace(/^0+/, '');
    if (digits === '') return { min: 1, max: 1 };
    if (hasDot) return { min: digits.length, max: digits.length };
    var trimmed = digits.replace(/0+$/, '');
    return { min: Math.max(1, trimmed.length), max: digits.length };
  }

  function sigFigOk(need, s) {
    if (!need) return true;
    var r = sigFigRange(s);
    return !!r && r.min <= need && need <= r.max;
  }

  // ---- 採点 ----

  // 許容幅は**要求された有効数字の桁から**決める。
  // 13.2 を2桁で答えると 13 になるが、相対0.5%では弾いてしまう（誤差1.5%）。
  // 桁の最終位の半分（0.51 単位）を許容すれば、正しく丸めた答えだけが通る。
  function tolerance(exact, need) {
    if (!need) return Math.max(1e-9, Math.abs(exact) * 0.005);
    var step = Math.pow(10, Math.floor(Math.log10(Math.abs(exact))) - need + 1);
    return step * 0.51;
  }

  function nearVal(a, b, need) {
    return Math.abs(a - b) <= tolerance(b, need);
  }

  // 値だけの判定（互換用）
  function check(p, input) {
    var v = parseFloat(input);
    return isFinite(v) && nearVal(v, solve(p), p.sigfigs);
  }

  // 総合採点。sigStr は有効数字を数える文字列（指数表記のときは仮数だけ）
  //   'ok'     … 値も桁も正しい
  //   'sigfig' … 値は正しいが有効数字の桁が違う → 指導する
  //   'flip'   … 倍率を逆さまに使った
  //   'wrong'  … それ以外
  function grade(p, input, sigStr) {
    var v = parseFloat(input);
    if (!isFinite(v)) return { status: 'wrong' };
    if (!nearVal(v, solve(p), p.sigfigs)) {
      return { status: nearVal(v, flippedAnswer(p), p.sigfigs) ? 'flip' : 'wrong' };
    }
    var s = sigStr === undefined ? input : sigStr;
    if (!sigFigOk(p.sigfigs, s)) {
      var r = sigFigRange(s);
      return { status: 'sigfig', need: p.sigfigs, got: r ? r.max : null };
    }
    return { status: 'ok' };
  }

  // 単位の選択ミス＝「同じ列に違う種類の量」を並べたということ。
  // ここを言葉にするのがこのアプリの主目的なので、モデル側で説明文まで作る。
  function mismatch(p, chosen) {
    var correct = unknownQuantity(p);
    if (chosen === correct) return null;
    var c = QUANTITIES[correct], w = QUANTITIES[chosen];
    return {
      chosen: chosen,
      correct: correct,
      text: c.unit + ' と ' + w.unit + ' を比べています。' +
            'たての列には同じ種類の量（' + c.label + ' = ' + c.unit + '）が来ます。'
    };
  }

  // ---- 分数と小数の対照表（計算が苦手な人向け。採点時に添える） ----

  var COMMON_FRACTIONS = [
    { n: 1, d: 10 }, { n: 1, d: 8 }, { n: 1, d: 5 }, { n: 1, d: 4 },
    { n: 1, d: 3 },  { n: 1, d: 2 }, { n: 2, d: 3 }, { n: 3, d: 4 },
    { n: 4, d: 5 },  { n: 3, d: 2 }, { n: 2, d: 1 }, { n: 3, d: 1 }
  ];

  function fracDec(n, d) {
    var v = n / d;
    var rounded = Math.round(v * 1000) / 1000;
    return Math.abs(v - rounded) < 1e-9 ? fmt(rounded) : v.toFixed(3) + '…';
  }

  // その問題で使う倍率（たて・よこ）に used 印を付けた対照表を返す
  function fractionTable(p) {
    var used = [factorV(p), factorH(p)].filter(function (f) {
      return f.n !== null && isEasy(f);
    });
    function isUsed(n, d) {
      return used.some(function (f) { return f.n === n && f.d === d; });
    }
    var list = COMMON_FRACTIONS.map(function (f) {
      return { n: f.n, d: f.d, dec: fracDec(f.n, f.d), used: isUsed(f.n, f.d) };
    });
    used.forEach(function (f) {
      var exists = list.some(function (x) { return x.n === f.n && x.d === f.d; });
      if (!exists) list.push({ n: f.n, d: f.d, dec: fracDec(f.n, f.d), used: true });
    });
    list.sort(function (a, b) { return a.n / a.d - b.n / b.d; });
    return list;
  }

  var PROBLEMS = SPECS.map(buildProblem);

  global.ChemRatio = {
    QUANTITIES: QUANTITIES,
    SUBSTANCES: SUBSTANCES,
    SPECS: SPECS,
    PROBLEMS: PROBLEMS,
    MOLAR_VOLUME: MOLAR_VOLUME,
    AVOGADRO: AVOGADRO,
    val: val, disp: disp, fmt: fmt, sup: sup, sci: sci, numText: numText, toSig: toSig,
    orderCols: orderCols,
    perMol: perMol,
    buildProblem: buildProblem,
    unknownIndex: unknownIndex,
    unknownQuantity: unknownQuantity,
    solve: solve,
    flippedAnswer: flippedAnswer,
    ratio: ratio,
    factorV: factorV,
    factorH: factorH,
    factorOf: factorOf,
    factorText: factorText,
    isEasy: isEasy,
    recommend: recommend,
    checkFactor: checkFactor,
    sigFigRange: sigFigRange,
    sigFigOk: sigFigOk,
    check: check,
    grade: grade,
    mismatch: mismatch,
    fractionTable: fractionTable
  };
})(typeof window !== 'undefined' ? window : this);
