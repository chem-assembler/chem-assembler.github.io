// 比例式でみる化学計算 — モデル（DOM非依存の純粋ロジック）
// 比例式は 2列×2行 の表として持つ。
//   列 = 量の種類（質量・物質量・体積・粒子の数）
//   行 = 上が「基準」（1 mol あたり等）、下が「知りたい量」
// 解き方は「内項の積＝外項の積」ではなく【倍率が同じ】。倍率は2方向にとれる:
//   たて（factorV）= 行から行へ。よこ（factorH）= 列から列へ。
// どちらが楽かは問題によって変わるので両方を持ち、recommend() で推す。
(function (global) {
  'use strict';

  var QUANTITIES = {
    mass:   { key: 'mass',   label: '質量',     unit: 'g'   },
    mole:   { key: 'mole',   label: '物質量',   unit: 'mol' },
    volume: { key: 'volume', label: '体積',     unit: 'L'   },
    count:  { key: 'count',  label: '粒子の数', unit: '個'  }
  };

  // steps: 学習者にやらせる段階（省略した項目は最初から見せる＝足場）
  //   unit   … 答えの単位を4択で選ぶ
  //   factor … 倍率を自分で分数で入れる（正しく入ると もう一方の矢印に自動で入る）
  // sigfigs: 解答に要求する有効数字の桁数。問題文に明示し、桁が違えば指導する。
  var PROBLEMS = [
    {
      id: 'q1', steps: {}, sigfigs: 2,
      title: '水 H<sub>2</sub>O 9.0 g は何 mol か',
      hint: '水 H<sub>2</sub>O 1 mol の質量は 18 g',
      cols: ['mass', 'mole'],
      base: [18, 1],
      target: ['9.0', null],
      ansDisp: '0.50'
    },
    {
      id: 'q2', steps: {}, sigfigs: 2,
      title: '二酸化炭素 CO<sub>2</sub> 0.25 mol は何 g か',
      hint: '二酸化炭素 CO<sub>2</sub> 1 mol の質量は 44 g',
      cols: ['mass', 'mole'],
      base: [44, 1],
      target: [null, '0.25'],
      ansDisp: '11'
    },
    {
      id: 'q3', steps: { unit: true }, sigfigs: 2,
      title: '標準状態で酸素 O<sub>2</sub> 5.6 L は何 mol か',
      hint: '標準状態では、気体 1 mol の体積は種類によらず 22.4 L',
      cols: ['volume', 'mole'],
      base: ['22.4', 1],
      target: ['5.6', null],
      ansDisp: '0.25',
      choices: ['mole', 'volume', 'mass', 'count']
    },
    {
      id: 'q4', steps: { unit: true }, sigfigs: 2,
      title: '炭素 C 3.0 mol は何 g か',
      hint: '炭素 C 1 mol の質量は 12 g',
      cols: ['mass', 'mole'],
      base: [12, 1],
      target: [null, '3.0'],
      ansDisp: '36',
      choices: ['volume', 'mass', 'count', 'mole']
    },
    {
      id: 'q5', steps: { factor: true }, sigfigs: 2,
      title: '水酸化ナトリウム NaOH 20 g は何 mol か',
      hint: 'NaOH 1 mol の質量は 40 g',
      cols: ['mass', 'mole'],
      base: [40, 1],
      target: ['20', null],
      ansDisp: '0.50'
    },
    {
      // 粒子の数。倍率方式の利点が最も出る問題（6.0×10²³ に 1/2 をかけて終わり）
      id: 'q6', steps: { unit: true, factor: true }, sigfigs: 2,
      title: '水 H<sub>2</sub>O 0.50 mol の中に、水分子は何個あるか',
      hint: 'どんな物質でも 1 mol は 6.0×10<sup>23</sup> 個（アボガドロ数）',
      cols: ['mole', 'count'],
      base: [1, '6.0e23'],
      target: ['0.50', null],
      ansDisp: '3.0e23',
      choices: ['mass', 'count', 'volume', 'mole']
    }
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
    return '×' + fmt(Math.round(f.value * 1e4) / 1e4);
  }

  // 暗算で扱える倍率か（整数倍・単位分数・分母が小さい分数）
  function isEasy(f) {
    if (f.n === null) return false;
    if (f.d === 1) return Math.abs(f.n) <= 50;
    if (f.n === 1) return f.d <= 10;
    return f.d <= 4;
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

  function nearVal(a, b) {
    return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.005);
  }

  // 値だけの判定（互換用）
  function check(p, input) {
    var v = parseFloat(input);
    return isFinite(v) && nearVal(v, solve(p));
  }

  // 総合採点。sigStr は有効数字を数える文字列（指数表記のときは仮数だけ）
  //   'ok'     … 値も桁も正しい
  //   'sigfig' … 値は正しいが有効数字の桁が違う → 指導する
  //   'flip'   … 倍率を逆さまに使った
  //   'wrong'  … それ以外
  function grade(p, input, sigStr) {
    var v = parseFloat(input);
    if (!isFinite(v)) return { status: 'wrong' };
    if (!nearVal(v, solve(p))) {
      return { status: nearVal(v, flippedAnswer(p)) ? 'flip' : 'wrong' };
    }
    if (!sigFigOk(p.sigfigs, sigStr === undefined ? input : sigStr)) {
      var r = sigFigRange(sigStr === undefined ? input : sigStr);
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

  global.ChemRatio = {
    QUANTITIES: QUANTITIES,
    PROBLEMS: PROBLEMS,
    val: val, disp: disp, fmt: fmt, sup: sup, sci: sci, numText: numText,
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
