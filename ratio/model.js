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

  // 列の並びは常に【左＝与えられた量／右＝問われる量】。
  // こうすると たて矢印は ↓、よこ矢印は → の一方向だけになり、答えは必ず右下に来る。
  // （矢印の向きが問題ごとに変わると読みにくい、というのが理由）

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
    C6H12O6: { name: 'グルコース',         formula: 'C<sub>6</sub>H<sub>12</sub>O<sub>6</sub>', M: '180', particle: '分子' },
    // 以下は反応の量的関係（M3）で使う物質
    CaCl2:   { name: '塩化カルシウム',     formula: 'CaCl<sub>2</sub>', M: '111' },
    Al2SO43: { name: '硫酸アルミニウム',   formula: 'Al<sub>2</sub>(SO<sub>4</sub>)<sub>3</sub>', M: '342' }
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
  var SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
              '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
  function subs(s) {
    return String(s).split('').map(function (c) { return SUB[c] || c; }).join('');
  }

  // HTML の <sup>/<sub> を Unicode の上付き・下付きに直す。
  // **SVG の <text> は <sup> を描画しない**（未知要素の中身は表示されない）ので、
  // 図の中でラベルを出すときは必ずこれを通す。
  function plainLabel(html) {
    return String(html)
      .replace(/<sup>([^<]*)<\/sup>/g, function (m, t) { return sup(t); })
      .replace(/<sub>([^<]*)<\/sub>/g, function (m, t) { return subs(t); })
      .replace(/<[^>]+>/g, '');
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
    // 左＝与えられた量、右＝問われる量。未知は必ず右下に来る
    var cols = [spec.given.q, spec.asked];
    var target = [spec.given.v, null];

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

  // 分数が理解の助けになるのは**分母が小さいとき**だけ。
  // 112/5 のような分数は、22.4 という小数で見たほうが楽（分母が 10ⁿ の場合も同様）。
  var NICE_DENOMS = [2, 3, 4, 5, 6, 8];
  function isNiceFraction(f) {
    return f.n !== null && f.d > 1 &&
           NICE_DENOMS.indexOf(f.d) >= 0 && Math.abs(f.n) <= 20;
  }

  // 短い小数で書けるならその文字列を返す（22.4・0.3・0.025 など）。無理なら null
  function shortDecimal(v) {
    if (!(Math.abs(v) >= 0.001 && Math.abs(v) < 10000)) return null;
    for (var k = 0; k <= 3; k++) {
      var pow = Math.pow(10, k);
      var r = Math.round(v * pow) / pow;
      if (Math.abs(r - v) < 1e-12) return fmt(r);
    }
    return null;
  }

  // 倍率をどう書くのが読みやすいか。'int' 整数 / 'frac' 分数 / 'dec' 小数
  function factorForm(f) {
    if (f.d === 1) return { kind: 'int', text: numText(f.n) };
    if (isNiceFraction(f)) return { kind: 'frac', text: f.n + '/' + f.d, n: f.n, d: f.d };
    var dec = shortDecimal(f.value);
    if (dec) return { kind: 'dec', text: dec };
    if (f.n !== null) return { kind: 'frac', text: f.n + '/' + f.d, n: f.n, d: f.d };
    return { kind: 'dec', text: numText(f.value) };
  }

  function factorText(f) { return '×' + factorForm(f).text; }

  // 倍率の扱いやすさ。小さいほど楽。
  //   0 … 一桁の整数倍（即答できる）
  //   1 … 2桁までの整数倍・分母の小さい分数・単位分数
  //   2 … 短い小数ならかけられる（22.4 倍・0.3 倍など）
  //   3 … つらい（1/18・6.0×10²³ 倍など）
  function effort(f) {
    if (f.n !== null && f.d === 1) {
      if (Math.abs(f.n) <= 12) return 0;
      if (Math.abs(f.n) <= 100) return 1;
    }
    if (isNiceFraction(f)) return 1;
    if (f.n === 1 && f.d <= 10) return 1;
    if (shortDecimal(f.value) !== null) return 2;
    return 3;
  }

  function isEasy(f) { return effort(f) <= 1; }

  // どちら向きに比をとるのが楽か。'v' たて / 'h' よこ / 'either' 大差なし
  function recommend(p) {
    var ev = effort(factorV(p)), eh = effort(factorH(p));
    if (ev === eh) return 'either';
    return ev < eh ? 'v' : 'h';
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
  // 値・桁の採点の本体。比例式（grade）と天秤（gradeBalance）で共有する。
  // flipped に値を渡すと、その値に一致したとき 'flip' を返す。
  function gradeValue(exact, need, input, sigStr, flipped) {
    var v = parseFloat(input);
    if (!isFinite(v)) return { status: 'wrong' };
    if (!nearVal(v, exact, need)) {
      var isFlip = flipped !== undefined && flipped !== null && nearVal(v, flipped, need);
      return { status: isFlip ? 'flip' : 'wrong' };
    }
    var s = sigStr === undefined ? input : sigStr;
    if (!sigFigOk(need, s)) {
      var r = sigFigRange(s);
      return { status: 'sigfig', need: need, got: r ? r.max : null };
    }
    return { status: 'ok' };
  }

  // 指数表記は仮数を 1 以上 10 未満で書く。
  // 12×10²³ は値としては 1.2×10²⁴ と同じなので、値だけ見ていると通ってしまう。
  function sciNormalized(mantissa) {
    var m = parseFloat(mantissa);
    return isFinite(m) && Math.abs(m) >= 1 && Math.abs(m) < 10;
  }

  // 粒子の数を答える問題＝指数表記。値が合っていても書き方（仮数の範囲）を見る。
  // 判定は問題の側で決める（sigStr が渡されたかどうかで判断すると、
  // 通常の問題に仮数として答えを渡したときに誤って sciform になる）。
  function grade(p, input, sigStr) {
    var g = gradeValue(solve(p), p.sigfigs, input, sigStr, flippedAnswer(p));
    if (unknownQuantity(p) === 'count' && sigStr !== undefined &&
        g.status !== 'wrong' && g.status !== 'flip' && !sciNormalized(sigStr)) {
      return { status: 'sciform', mantissa: sigStr };
    }
    return g;
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

  // ================================================================
  // 天秤（加重平均）— 平均原子量・平均分子量
  // レンズが違う: 比例式の表ではなく【数直線と支点】で見る。
  // 核心は **腕の長さの比 ＝ 個数の逆比**（軽いほうが多ければ支点は軽いほうに寄る）。
  // ================================================================

  // kind 'average' … 存在比が与えられ、平均を求める
  // kind 'ratio'   … 平均が与えられ、存在比を求める（腕の長さを読む）
  var BALANCE = [
    {
      // amountUnit: 皿の数字に付ける単位。存在比は % を付けて原子量と区別する
      id: 'b1', kind: 'average', sig: 3, quantity: '原子量', amountUnit: '%',
      title: '塩素には <sup>35</sup>Cl と <sup>37</sup>Cl があり、存在比は 75.0% と 25.0% である。塩素の平均原子量を求めよ',
      hint: '平均は2つの間の「個数で決まる位置」に来る。多いほうに引き寄せられる',
      items: [{ label: '<sup>35</sup>Cl', value: '35.0', amount: 75.0 },
              { label: '<sup>37</sup>Cl', value: '37.0', amount: 25.0 }]
    },
    {
      id: 'b2', kind: 'ratio', sig: 2, quantity: '原子量',
      title: '塩素の平均原子量は 35.5 である。<sup>35</sup>Cl と <sup>37</sup>Cl の存在比を最も簡単な整数比で求めよ',
      hint: '支点からの距離（腕の長さ）の比が、個数の比の逆になる',
      items: [{ label: '<sup>35</sup>Cl', value: '35.0' },
              { label: '<sup>37</sup>Cl', value: '37.0' }],
      average: '35.5'
    },
    {
      id: 'b3', kind: 'average', sig: 3, quantity: '原子量', amountUnit: '%',
      title: '銅には <sup>63</sup>Cu と <sup>65</sup>Cu があり、存在比は 69.2% と 30.8% である。銅の平均原子量を求めよ',
      hint: '軽いほうが多いので、平均は 63 寄りになるはず',
      items: [{ label: '<sup>63</sup>Cu', value: '63.0', amount: 69.2 },
              { label: '<sup>65</sup>Cu', value: '65.0', amount: 30.8 }]
    },
    {
      id: 'b4', kind: 'average', sig: 3, quantity: '原子量', amountUnit: '%',
      title: 'ホウ素には <sup>10</sup>B と <sup>11</sup>B があり、存在比は 19.9% と 80.1% である。ホウ素の平均原子量を求めよ',
      hint: '重いほうが多いので、平均は 11 寄りになるはず',
      items: [{ label: '<sup>10</sup>B', value: '10.0', amount: 19.9 },
              { label: '<sup>11</sup>B', value: '11.0', amount: 80.1 }]
    },
    {
      id: 'b5', kind: 'average', sig: 3, quantity: '分子量',
      title: '窒素 N<sub>2</sub> と酸素 O<sub>2</sub> を体積比 4 : 1 で混ぜた気体（空気）の平均分子量を求めよ',
      hint: '同温・同圧では体積比 ＝ 個数の比（アボガドロの法則）',
      items: [{ label: 'N<sub>2</sub>', value: '28.0', amount: 4 },
              { label: 'O<sub>2</sub>', value: '32.0', amount: 1 }]
    },
    {
      id: 'b6', kind: 'ratio', sig: 2, quantity: '分子量',
      title: '窒素 N<sub>2</sub> と酸素 O<sub>2</sub> の混合気体の平均分子量は 28.8 である。体積比を最も簡単な整数比で求めよ',
      hint: '腕の長さは 28.8−28.0 と 32.0−28.8。その比の逆が体積比',
      items: [{ label: 'N<sub>2</sub>', value: '28.0' },
              { label: 'O<sub>2</sub>', value: '32.0' }],
      average: '28.8'
    },
    {
      id: 'b7', kind: 'average', sig: 2, quantity: '分子量',
      title: '水素 H<sub>2</sub> とヘリウム He を体積比 1 : 1 で混ぜた気体の平均分子量を求めよ',
      hint: '同じ数ずつなら、支点はちょうど真ん中に来る',
      items: [{ label: 'H<sub>2</sub>', value: '2.0', amount: 1 },
              { label: 'He', value: '4.0', amount: 1 }]
    },
    {
      id: 'b8', kind: 'ratio', sig: 2, quantity: '分子量',
      title: '一酸化炭素 CO と二酸化炭素 CO<sub>2</sub> の混合気体の平均分子量は 32.0 である。体積比を最も簡単な整数比で求めよ',
      hint: '腕の長さは 32.0−28.0 と 44.0−32.0',
      items: [{ label: 'CO', value: '28.0' },
              { label: 'CO<sub>2</sub>', value: '44.0' }],
      average: '32.0'
    }
  ];

  // 加重平均。Σ(値×個数) ÷ Σ個数
  function weightedAverage(items) {
    var num = 0, den = 0;
    items.forEach(function (it) {
      num += val(it.value) * it.amount;
      den += it.amount;
    });
    return num / den;
  }

  function balAverage(p) {
    return p.kind === 'ratio' ? val(p.average) : weightedAverage(p.items);
  }

  // 支点からの距離（腕の長さ）。左＝平均−軽いほう、右＝重いほう−平均
  function balArms(p, avg) {
    var a = avg === undefined ? balAverage(p) : avg;
    return [a - val(p.items[0].value), val(p.items[1].value) - a];
  }

  // 整数比を約分する（分点 3/8 なら 3 : 5 のように）
  function simplifyRatio(a, b) {
    function gcd(x, y) { return y === 0 ? x : gcd(y, x % y); }
    var g = gcd(Math.abs(Math.round(a)), Math.abs(Math.round(b))) || 1;
    return { n: Math.round(a) / g, d: Math.round(b) / g };
  }

  // 腕の長さの比（内分比）。「35 と 37 の間を 1:3 に内分する点」の 1:3 がこれ
  function balArmRatio(p) {
    var arms = balArms(p);
    if (arms[1] === 0) return null;
    var r = ratio(arms[0] / arms[1]);
    return r ? { n: r.n, d: r.d } : null;
  }

  // 区間を何等分すれば支点が目盛りにちょうど乗るか（2〜20）。乗らなければ null。
  // b3・b4 のような存在比（69.2% 等）は 250〜1000 等分が必要になるので null を返す。
  function divisionsFor(p) {
    var lo = val(p.items[0].value), hi = val(p.items[1].value);
    var arm = balArms(p)[0];
    for (var n = 2; n <= 20; n++) {
      var step = (hi - lo) / n;
      var k = arm / step;
      if (Math.abs(k - Math.round(k)) < 1e-9) return n;
    }
    return null;
  }

  // 個数の比（item0 : item1）＝ 腕の長さの逆比。最も簡単な整数比で返す
  function balRatio(p) {
    var arms = balArms(p);
    if (arms[0] === 0) return null;
    var r = ratio(arms[1] / arms[0]);
    return r ? { n: r.n, d: r.d } : null;
  }

  // 学習者が入れた整数比が正しいか（3:1 でも 6:2 でも 75:25 でも通す）
  function checkBalRatio(p, n, m) {
    var nn = parseFloat(n), mm = parseFloat(m);
    if (!isFinite(nn) || !isFinite(mm) || nn <= 0 || mm <= 0) return false;
    var t = balRatio(p);
    if (!t) return false;
    return Math.abs(nn / mm - t.n / t.d) <= Math.max(1e-9, (t.n / t.d) * 0.005);
  }

  // 平均の採点（比例式側と同じ3値。桁の指導も同じ規則で行う）。
  // 「重いほうと軽いほうを取り違えた位置」を flip として拾い、名指しで指摘する。
  function gradeBalance(p, input) {
    var avg = balAverage(p);
    var mirrored = val(p.items[0].value) + val(p.items[1].value) - avg;
    return gradeValue(avg, p.sig, input, undefined,
                      Math.abs(mirrored - avg) < 1e-12 ? null : mirrored);
  }

  // ================================================================
  // 反応の量的関係（M3）— 3行表と過不足
  // 比例式の核【同じ倍率】をそのまま反応式へ広げる:
  //   係数の行 ＝ 基準。実際に反応した量 ＝ 係数 × 倍率 x
  //   x ＝ 反応が何 mol 分進んだか（＝反応の「回数」）
  // **過不足は倍率の比べっこ**。反応物ごとに「自分だけならどこまで進めるか」
  // （mol ÷ 係数）を出し、**一番小さいところで反応は止まる**。それが限定反応物。
  // **係数は与えられたものとして扱う**（係数を決めるのは ion-equation の担当）。
  // ================================================================

  // eq … 反応式の各項（product: true が右辺）。係数は与えられたもの
  // given … 反応前の量。書かれていない反応物は「十分にある」（過不足の対象外）
  //         文字列なら mol。{ v, q } なら q の単位で与える（'mass'・'volume'）
  // askedOf … 'used' 反応に使われた量／'made' 生成した量／'left' 反応後に残った量
  // askedUnit … 答えの単位（省略で mol）。mol 以外なら最後に単位を戻す段が付く
  // steps … in: mol にそろえる／limit: 限定反応物を選ばせる／x: 倍率を入れさせる／
  //         out: 単位を戻す（表の mol は自分で計算させる）
  var REACTIONS = [
    // --- ①導入：倍率が見えている（同じ倍率が全部の物質にはたらくことに集中させる） ---
    { id: 'r1', sig: 2, steps: {},
      eq: [{ sub: 'H2', coef: 2 }, { sub: 'O2', coef: 1 }, { sub: 'H2O', coef: 2, product: true }],
      given: { O2: '0.20' }, asked: 'H2', askedOf: 'used' },
    // --- ②倍率を自分で見つける ---
    { id: 'r2', sig: 2, steps: { x: true },
      eq: [{ sub: 'CH4', coef: 1 }, { sub: 'O2', coef: 2 },
           { sub: 'CO2', coef: 1, product: true }, { sub: 'H2O', coef: 2, product: true }],
      given: { CH4: '0.50' }, asked: 'H2O', askedOf: 'made' },
    { id: 'r3', sig: 2, steps: { x: true },
      eq: [{ sub: 'Al', coef: 2 }, { sub: 'H2SO4', coef: 3 },
           { sub: 'Al2SO43', coef: 1, product: true }, { sub: 'H2', coef: 3, product: true }],
      given: { Al: '0.40' }, asked: 'H2', askedOf: 'made' },
    // --- ③過不足：まず「ちょうど反応」（どちらも余らない場合）を見せる ---
    { id: 'r4', sig: 2, steps: { limit: true, x: true },
      eq: [{ sub: 'NaOH', coef: 1 }, { sub: 'HCl', coef: 1 },
           { sub: 'NaCl', coef: 1, product: true }, { sub: 'H2O', coef: 1, product: true }],
      given: { NaOH: '0.20', HCl: '0.20' }, asked: 'NaCl', askedOf: 'made' },
    // --- ④過不足：係数が 2:1 なので「多いほうが余る」とは限らないことを見せる ---
    { id: 'r5', sig: 2, steps: { limit: true, x: true },
      eq: [{ sub: 'H2', coef: 2 }, { sub: 'O2', coef: 1 }, { sub: 'H2O', coef: 2, product: true }],
      given: { H2: '0.30', O2: '0.10' }, asked: 'H2O', askedOf: 'made' },
    { id: 'r6', sig: 2, steps: { limit: true, x: true },
      eq: [{ sub: 'N2', coef: 1 }, { sub: 'H2', coef: 3 }, { sub: 'NH3', coef: 2, product: true }],
      given: { N2: '0.20', H2: '0.30' }, asked: 'NH3', askedOf: 'made' },
    { id: 'r7', sig: 2, steps: { limit: true, x: true },
      eq: [{ sub: 'CaCO3', coef: 1 }, { sub: 'HCl', coef: 2 },
           { sub: 'CaCl2', coef: 1, product: true }, { sub: 'H2O', coef: 1, product: true },
           { sub: 'CO2', coef: 1, product: true }],
      given: { CaCO3: '0.10', HCl: '0.30' }, asked: 'CO2', askedOf: 'made' },
    // --- ⑤余る量を問う（反応後 ＝ 反応前 − 変化量 を使わせる） ---
    { id: 'r8', sig: 2, steps: { limit: true, x: true },
      eq: [{ sub: 'CH4', coef: 1 }, { sub: 'O2', coef: 2 },
           { sub: 'CO2', coef: 1, product: true }, { sub: 'H2O', coef: 2, product: true }],
      given: { CH4: '0.30', O2: '0.40' }, asked: 'CH4', askedOf: 'left' },
    // --- ⑥ g・L で与える／答える（入試の標準形。mol にそろえる段が前後に付く） ---
    { id: 'r9', sig: 2, steps: { in: true, x: true },
      eq: [{ sub: 'CaCO3', coef: 1 }, { sub: 'HCl', coef: 2 },
           { sub: 'CaCl2', coef: 1, product: true }, { sub: 'H2O', coef: 1, product: true },
           { sub: 'CO2', coef: 1, product: true }],
      given: { CaCO3: { v: '25', q: 'mass' } }, asked: 'CO2', askedOf: 'made' },
    { id: 'r10', sig: 2, steps: { x: true, out: true },
      eq: [{ sub: 'CH4', coef: 1 }, { sub: 'O2', coef: 2 },
           { sub: 'CO2', coef: 1, product: true }, { sub: 'H2O', coef: 2, product: true }],
      given: { CH4: '0.50' }, asked: 'H2O', askedOf: 'made', askedUnit: 'mass' },
    { id: 'r11', sig: 3, steps: { x: true, out: true },
      eq: [{ sub: 'N2', coef: 1 }, { sub: 'H2', coef: 3 }, { sub: 'NH3', coef: 2, product: true }],
      given: { N2: '0.250' }, asked: 'NH3', askedOf: 'made', askedUnit: 'volume' },
    // 質量 → mol → 係数の比 → 質量。3段そろった基本形
    { id: 'r12', sig: 2, steps: { in: true, x: true, out: true },
      eq: [{ sub: 'C', coef: 1 }, { sub: 'O2', coef: 1 }, { sub: 'CO2', coef: 1, product: true }],
      given: { C: { v: '6.0', q: 'mass' } }, asked: 'CO2', askedOf: 'made', askedUnit: 'mass' },
    // 過不足も込みの総合問題（両方とも質量で与える）
    { id: 'r13', sig: 2, steps: { in: true, limit: true, x: true, out: true },
      eq: [{ sub: 'H2', coef: 2 }, { sub: 'O2', coef: 1 }, { sub: 'H2O', coef: 2, product: true }],
      given: { H2: { v: '0.60', q: 'mass' }, O2: { v: '3.2', q: 'mass' } },
      asked: 'H2O', askedOf: 'made', askedUnit: 'mass' },
    { id: 'r14', sig: 3, steps: { in: true, limit: true, x: true, out: true },
      eq: [{ sub: 'N2', coef: 1 }, { sub: 'H2', coef: 3 }, { sub: 'NH3', coef: 2, product: true }],
      given: { N2: { v: '4.48', q: 'volume' }, H2: { v: '6.72', q: 'volume' } },
      asked: 'NH3', askedOf: 'made', askedUnit: 'volume' }
  ];

  // 与えられた量の指定。文字列で書いた場合は mol
  function givenSpec(p, key) {
    var g = p.given[key];
    return (g && typeof g === 'object') ? g : { v: g, q: 'mole' };
  }
  // 「1 mol あたりの値」で割れば mol になる（比例式モードと同じ換算）
  function toMol(key, q, v) {
    return val(v) / val(perMol(SUBSTANCES[key], q));
  }
  // mol にそろえる段が要る物質（g や L で与えられたもの）
  function convTargets(p) {
    return Object.keys(p.given).filter(function (k) {
      return givenSpec(p, k).q !== 'mole';
    });
  }
  function askedUnit(p) { return p.askedUnit || 'mole'; }
  // 答えの単位を戻す段が要るか
  function hasOut(p) { return askedUnit(p) !== 'mole'; }
  function inAskedUnit(p, molVal) {
    if (molVal === null || molVal === undefined) return null;
    return molVal * val(perMol(SUBSTANCES[p.asked], askedUnit(p)));
  }

  function termOf(p, key) {
    for (var i = 0; i < p.eq.length; i++) if (p.eq[i].sub === key) return p.eq[i];
    return null;
  }
  function reactants(p) {
    return p.eq.filter(function (t) { return !t.product; });
  }
  function products(p) {
    return p.eq.filter(function (t) { return t.product; });
  }

  // 反応前の量（**常に mol**）。生成物は最初 0、given に無い反応物は「十分量」（null）。
  // g や L で与えられた問題は、ここで mol にそろえた値を返す。
  function beforeOf(p, key) {
    if (p.given[key] !== undefined) {
      var g = givenSpec(p, key);
      return toMol(key, g.q, g.v);
    }
    var t = termOf(p, key);
    return t && t.product ? 0 : null;
  }

  // 反応物ごとの候補倍率 ＝ mol ÷ 係数。
  // 「その物質だけを見たら反応は何 mol 分進められるか」。過不足の判断はこれの比べっこ。
  function candidates(p) {
    return reactants(p).map(function (t) {
      var b = beforeOf(p, t.sub);
      return { sub: t.sub, coef: t.coef, before: b,
               quotient: b === null ? null : b / t.coef };
    });
  }

  function knownCandidates(p) {
    return candidates(p).filter(function (c) { return c.quotient !== null; });
  }

  // 反応がどこまで進むか ＝ 候補倍率の最小値（一番先に足りなくなるところで止まる）
  function progress(p) {
    return Math.min.apply(null, knownCandidates(p).map(function (c) { return c.quotient; }));
  }

  // 限定反応物。ちょうど反応（同時に無くなる）なら複数返る
  function limiting(p) {
    var x = progress(p);
    return knownCandidates(p).filter(function (c) {
      return Math.abs(c.quotient - x) <= 1e-12 * Math.max(1, Math.abs(x));
    }).map(function (c) { return c.sub; });
  }

  // 過不足を考える問題か（量が与えられた反応物が2つ以上ある）
  function isExcess(p) { return knownCandidates(p).length >= 2; }
  // ちょうど反応（与えられた反応物がすべて同時に無くなる）
  function isExact(p) { return isExcess(p) && limiting(p).length === knownCandidates(p).length; }
  // 余る（限定でない）反応物
  function excessSubs(p) {
    var lim = limiting(p);
    return knownCandidates(p).map(function (c) { return c.sub; })
      .filter(function (s) { return lim.indexOf(s) < 0; });
  }

  // 変化量（符号つき。反応物は減り、生成物は増える）
  function changeOf(p, key, x) {
    var t = termOf(p, key);
    var xx = x === undefined ? progress(p) : x;
    return (t.product ? 1 : -1) * t.coef * xx;
  }

  // 反応後の量。十分量の反応物は分からないので null
  function afterOf(p, key, x) {
    var t = termOf(p, key), b = beforeOf(p, key);
    if (b === null) return null;
    return b + changeOf(p, key, x);
  }

  // 倍率 x で計算したときの答え。誤答の再現（限定反応物の取り違え）にも使う
  function answerAt(p, x) {
    var t = termOf(p, p.asked);
    if (p.askedOf === 'left') return afterOf(p, p.asked, x);
    return t.coef * x;
  }

  // 表の中の答え（mol）。表は最後まで mol で通す
  function molAnswer(p) { return answerAt(p, progress(p)); }
  // 問われている単位での答え（g・L なら最後に単位を戻したもの）
  function stoichAnswer(p) { return inAskedUnit(p, molAnswer(p)); }

  // 係数を逆さまに使ってしまった値（比例式側の flippedAnswer と同じ思想）
  function flippedStoich(p) {
    if (p.askedOf === 'left') return null;
    var lt = termOf(p, limiting(p)[0]), at = termOf(p, p.asked);
    if (!lt || !at || lt.coef === at.coef) return null;
    var v = beforeOf(p, lt.sub) * lt.coef / at.coef;
    return Math.abs(v - molAnswer(p)) < 1e-12 ? null : inAskedUnit(p, v);
  }

  // 限定反応物を取り違えた（余るほうの倍率で計算した）値。
  // これを名指しで拾うのが過不足の学習の要。
  function wrongLimitAnswer(p) {
    if (!isExcess(p) || isExact(p)) return null;
    var qs = knownCandidates(p).map(function (c) { return c.quotient; });
    var other = Math.max.apply(null, qs);
    var v = answerAt(p, other);
    return v === null || Math.abs(v - molAnswer(p)) < 1e-12 ? null : inAskedUnit(p, v);
  }

  // 反応式の文字列（'2H₂ + O₂ → 2H₂O'）。係数1は書かない
  function eqText(p) {
    var l = [], r = [];
    p.eq.forEach(function (t) {
      var s = (t.coef === 1 ? '' : t.coef) + SUBSTANCES[t.sub].formula;
      (t.product ? r : l).push(s);
    });
    return l.join(' ＋ ') + ' → ' + r.join(' ＋ ');
  }

  function subjectOf(key) {
    var s = SUBSTANCES[key];
    return s.name + ' ' + s.formula;
  }

  function givenText(p) {
    return Object.keys(p.given).map(function (k) {
      var g = givenSpec(p, k);
      return subjectOf(k) + ' ' + disp(g.v) + ' ' + QUANTITIES[g.q].unit;
    }).join(' と ');
  }

  // 量が与えられていない反応物（＝十分にある）。問われている物質は除く。
  // 表では「十分量」と書かれるので、問題文でも何と反応させたのかを明示する
  function enoughSubs(p) {
    return reactants(p).filter(function (t) {
      return p.given[t.sub] === undefined && t.sub !== p.asked;
    }).map(function (t) { return t.sub; });
  }

  function makeStoichTitle(p) {
    var pre = (askedUnit(p) === 'volume' ||
               convTargets(p).some(function (k) { return givenSpec(p, k).q === 'volume'; }))
      ? '標準状態で、' : '';
    var u = QUANTITIES[askedUnit(p)].unit;
    var enough = enoughSubs(p);
    var withText = enough.length
      ? ' を十分量の ' + enough.map(subjectOf).join(' と ') + ' と反応させた。'
      : ' を反応させた。';
    if (p.askedOf === 'used') {
      return pre + givenText(p) + ' をすべて反応させるのに必要な ' + subjectOf(p.asked) +
             ' は何 ' + u + ' か';
    }
    if (p.askedOf === 'left') {
      return pre + givenText(p) + withText + '反応後に残る ' + subjectOf(p.asked) +
             ' は何 ' + u + ' か';
    }
    return pre + givenText(p) + withText + '生成する ' + subjectOf(p.asked) +
           ' は何 ' + u + ' か';
  }

  function makeStoichHint(p) {
    var base = '係数の比 ' + p.eq.map(function (t) { return t.coef; }).join(' : ') +
               ' が、反応する mol の比。';
    // 係数の比が使えるのは mol だけ。g や L は先に mol へそろえる必要がある
    if (convTargets(p).length || hasOut(p)) {
      return base + '<b>比べられるのは mol だけ</b>なので、まず mol にそろえる';
    }
    return isExcess(p)
      ? base + '<b>先に足りなくなるほう</b>で反応は止まる（同時に無くなることもある）'
      : base + '同じ倍率がすべての物質にはたらく';
  }

  // 「1 mol あたり」の言い方（変換の根拠として示す）
  function perMolText(key, q) {
    if (q === 'volume') {
      return '標準状態では、気体 1 mol の体積は ' + disp(MOLAR_VOLUME) + ' L';
    }
    return SUBSTANCES[key].formula + ' 1 mol ＝ ' +
           disp(perMol(SUBSTANCES[key], q)) + ' ' + QUANTITIES[q].unit;
  }

  // 学習者が入れた「mol にそろえた値」が正しいか
  function checkConv(p, key, input) {
    var v = parseFloat(input), t = beforeOf(p, key);
    return isFinite(v) && Math.abs(v - t) <= Math.max(1e-12, Math.abs(t) * 0.005);
  }
  // 表の中の答え（mol）が正しいか
  function checkMol(p, input) {
    var v = parseFloat(input), t = molAnswer(p);
    return isFinite(v) && Math.abs(v - t) <= Math.max(1e-12, Math.abs(t) * 0.005);
  }

  // 表に書く値。有効数字をそろえて '0.10' のように書く（0 はそのまま '0'）
  function stoichDisp(v, sig) {
    if (v === null || v === undefined) return null;
    if (Math.abs(v) < 1e-12) return '0';
    return toSig(v, sig);
  }

  function checkProgress(p, input) {
    var v = parseFloat(input), x = progress(p);
    return isFinite(v) && Math.abs(v - x) <= Math.max(1e-12, Math.abs(x) * 0.005);
  }

  // 「どちらも同時に無くなる（ちょうど反応）」の選択肢。
  // これが無いと、ちょうど反応の問題は**先に足りなくなるほうが存在しない**のに
  // 片方を選ばせることになり、問いとして成立しない。
  var LIMIT_BOTH = 'both';
  function checkLimiting(p, key) {
    if (key === LIMIT_BOTH) return isExact(p);
    return !isExact(p) && limiting(p).indexOf(key) >= 0;
  }
  // 正解の選択肢（ちょうど反応なら 'both'）
  function limitAnswer(p) { return isExact(p) ? LIMIT_BOTH : limiting(p)[0]; }

  // 採点。値・桁は比例式側と共通（gradeValue）。
  // 'limit' … 限定反応物を取り違えた（余るほうで計算した）→ これを名指しで指導する
  function gradeStoich(p, input) {
    var exact = stoichAnswer(p), v = parseFloat(input);
    if (isFinite(v) && !nearVal(v, exact, p.sig)) {
      var w = wrongLimitAnswer(p);
      if (w !== null && nearVal(v, w, p.sig)) {
        return { status: 'limit', used: w, limiting: limiting(p)[0], excess: excessSubs(p)[0] };
      }
    }
    return gradeValue(exact, p.sig, input, undefined, flippedStoich(p));
  }

  REACTIONS.forEach(function (p) {
    p.title = makeStoichTitle(p);
    p.hint = makeStoichHint(p);
    p.eqText = eqText(p);
    p.ansDisp = toSig(stoichAnswer(p), p.sig);
  });

  var PROBLEMS = SPECS.map(buildProblem);
  BALANCE.forEach(function (p) { p.ansDisp = toSig(balAverage(p), p.sig); });

  global.ChemRatio = {
    QUANTITIES: QUANTITIES,
    SUBSTANCES: SUBSTANCES,
    SPECS: SPECS,
    PROBLEMS: PROBLEMS,
    MOLAR_VOLUME: MOLAR_VOLUME,
    AVOGADRO: AVOGADRO,
    val: val, disp: disp, fmt: fmt, sup: sup, subs: subs, sci: sci,
    plainLabel: plainLabel, numText: numText, toSig: toSig,
    shortDecimal: shortDecimal,
    isNiceFraction: isNiceFraction,
    factorForm: factorForm,
    effort: effort,
    sciNormalized: sciNormalized,
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
    gradeValue: gradeValue,
    grade: grade,
    BALANCE: BALANCE,
    weightedAverage: weightedAverage,
    balAverage: balAverage,
    balArms: balArms,
    balArmRatio: balArmRatio,
    divisionsFor: divisionsFor,
    simplifyRatio: simplifyRatio,
    balRatio: balRatio,
    checkBalRatio: checkBalRatio,
    gradeBalance: gradeBalance,
    mismatch: mismatch,
    fractionTable: fractionTable,
    REACTIONS: REACTIONS,
    termOf: termOf,
    reactants: reactants,
    products: products,
    beforeOf: beforeOf,
    candidates: candidates,
    knownCandidates: knownCandidates,
    progress: progress,
    limiting: limiting,
    isExcess: isExcess,
    isExact: isExact,
    excessSubs: excessSubs,
    changeOf: changeOf,
    afterOf: afterOf,
    answerAt: answerAt,
    givenSpec: givenSpec,
    toMol: toMol,
    convTargets: convTargets,
    askedUnit: askedUnit,
    hasOut: hasOut,
    inAskedUnit: inAskedUnit,
    perMolText: perMolText,
    checkConv: checkConv,
    checkMol: checkMol,
    molAnswer: molAnswer,
    stoichAnswer: stoichAnswer,
    flippedStoich: flippedStoich,
    wrongLimitAnswer: wrongLimitAnswer,
    eqText: eqText,
    subjectOf: subjectOf,
    stoichDisp: stoichDisp,
    checkProgress: checkProgress,
    LIMIT_BOTH: LIMIT_BOTH,
    checkLimiting: checkLimiting,
    limitAnswer: limitAnswer,
    gradeStoich: gradeStoich
  };
})(typeof window !== 'undefined' ? window : this);
