/* model.js — 電子対でみる分子のかたち（コード名 shape）の化学モデル。
   DOM に依存しない純粋ロジック。ブラウザでは window.ChemShape.model、node では module.exports。
   設計の正は DESIGN_bond_app.md（§3-3・§4-1・§4-2）。

   ★ 写した元（§4-1）:
     - wlRefine          … assembler/chemistry.js の `wlRefine`（2342行）をそのまま写した
     - canonicalRowsCore … assembler/chemistry.js の `canonicalRowsCore`（2366行）から、
                           forcedFirst / collect（根付きコード・自己同型の収集）を除いて写した
     ⚠ chemistry.js は**読まない**（§4-1: H を落とす・価標1つのモデル・assembler の毎日の版上げに結合する）。
     ⚠ 写した2関数は「一般のラベル付きグラフの正準化」で、化学を知らない。ここでは **H も頂点にして**呼ぶ。
     ⚠ wlRefine の反復回数を減らす「最適化」をしてはいけない（写した元 2336行の注意。番号の付き直しが
        打ち切る位置で変わり、コードが丸ごと変わる）。

   モデルの形（§4-2。M2〜M5 が乗る形にしてある）:
     原子 { id, el, un（不対電子）, lp（非共有電子対）, unfold（ほどいた数）, vacancy（受け手の空き）, charge（パーツの電荷） }
     結合 { a, b, order（次数）, dative（配位結合か・M3 で使う。判定とコードでは区別しない）, hint（見た目の向き・判定に使わない） }
     電荷はイオン全体で持つ（＝パーツの電荷の和）。原子ごとの形式電荷は持たない。 */
(function () {
  'use strict';

  /* ---- 元素の表（§4-2）----
     手で埋めるのは「価電子」と「取りうる手の数」だけ。不対電子と非共有電子対は下の式で出す。 */
  var VALENCE = { H: 1, B: 3, C: 4, N: 5, O: 6, F: 7, P: 5, S: 6, Cl: 7 };
  var HANDS = { H: [1], B: [3], C: [4], N: [3], O: [2], F: [1], P: [3, 5], S: [2, 4, 6], Cl: [1] };
  var ORDER = ['H', 'B', 'C', 'N', 'O', 'F', 'P', 'S', 'Cl'];

  // 既定の不対電子 ＝ 8 − 価電子（H は 1、B は 3 ＝ 価電子が4以下なら価電子そのもの）
  function defaultUnpaired(v) { return v <= 4 ? v : 8 - v; }
  // 非共有電子対 ＝ (価電子 − 不対電子) / 2
  function defaultPairs(v) { return (v - defaultUnpaired(v)) / 2; }

  var ELEMENTS = {};
  ORDER.forEach(function (el) {
    var v = VALENCE[el];
    ELEMENTS[el] = { el: el, valence: v, hands: HANDS[el].slice(), un: defaultUnpaired(v), lp: defaultPairs(v) };
  });

  /* ---- 状態 ---- */
  function create() { return { atoms: [], bonds: [], nextId: 1 }; }

  function clone(s) {
    return {
      atoms: s.atoms.map(function (a) { return Object.assign({}, a); }),
      bonds: s.bonds.map(function (b) { return Object.assign({}, b, { hint: b.hint ? Object.assign({}, b.hint) : null }); }),
      nextId: s.nextId
    };
  }

  function atomOf(s, id) {
    for (var i = 0; i < s.atoms.length; i++) if (s.atoms[i].id === id) return s.atoms[i];
    return null;
  }

  function bondBetween(s, a, b) {
    for (var i = 0; i < s.bonds.length; i++) {
      var x = s.bonds[i];
      if ((x.a === a && x.b === b) || (x.a === b && x.b === a)) return x;
    }
    return null;
  }

  function bondsOf(s, id) { return s.bonds.filter(function (b) { return b.a === id || b.b === id; }); }

  /* ---- パーツ（受け手・M3）----
     H⁺ は「電子 0・空き1」。不対電子を持たないので、ふつうの結合（不対電子どうし）の相手にならない。
     結合ができたら、ほかの H と区別しない（el は 'H'・コードのラベルも同じ）。電荷は置いたパーツの電荷の和で、イオン全体で持つ。
     金属イオン（M5）はここに足す（空き ＝ 配位数）。 */
  var PARTS = {
    'H+': { el: 'H', un: 0, lp: 0, vacancy: 1, charge: 1, label: 'H⁺' }
  };
  var PART_ORDER = ['H+'];

  function addAtom(s, el) {
    var pt = PARTS[el];
    if (pt) {
      var ap = { id: s.nextId++, el: pt.el, un: pt.un, lp: pt.lp, unfold: 0, vacancy: pt.vacancy, charge: pt.charge, part: el };
      s.atoms.push(ap);
      return ap.id;
    }
    var e = ELEMENTS[el];
    if (!e) throw new Error('置けない元素: ' + el);
    var a = { id: s.nextId++, el: el, un: e.un, lp: e.lp, unfold: 0, vacancy: 0, charge: 0 };
    s.atoms.push(a);
    return a.id;
  }

  /* ---- 結合（不対電子どうし・§3-2）----
     両方の原子から不対電子を1個ずつ出し合って、共有電子対を1組つくる。
     同じ2原子にもう一度 → 二重、さらにもう一度 → 三重。
     ⚠ 受け手（vacancy）は不対電子を持たないので、ここでは相手にならない（配位結合は M3 の別の入口）。 */
  var MAX_ORDER = 3;

  function canBond(s, a, b) {
    if (a === b) return { ok: false, reason: 'same' };
    var A = atomOf(s, a), B = atomOf(s, b);
    if (!A || !B) return { ok: false, reason: 'missing' };
    if (A.un < 1 || B.un < 1) return { ok: false, reason: 'no-unpaired' };
    var x = bondBetween(s, a, b);
    if (x && x.order >= MAX_ORDER) return { ok: false, reason: 'max-order' };
    return { ok: true, order: x ? x.order + 1 : 1 };
  }

  // hint は見た目の向き（a から見てどの側に b を置くか）。判定・コードには使わない
  function bond(s, a, b, hint) {
    var c = canBond(s, a, b);
    if (!c.ok) return c;
    var A = atomOf(s, a), B = atomOf(s, b);
    A.un--; B.un--;
    var x = bondBetween(s, a, b);
    if (x) x.order++;
    else s.bonds.push({ a: a, b: b, order: 1, dative: false, hint: hint || null });
    return { ok: true, order: c.order };
  }

  /* ---- 配位結合（M3・§3-2・§4-2）----
     与える側の非共有電子対1組 → 受け手（空きのある原子）との結合1本（次数1）。
     できた結合は、判定でも正準コードでも**ふつうの共有結合と区別しない**（dative は「どうできたか」の記録だけ。
     画面が「できた直後は青 → 2秒で黒」に使う）。
     ⚠ 受け手の空きは1つの結合で1つ埋まる（H⁺ に2つ目は配位できない）。すでに結合している相手には配位しない。 */
  function canDonate(s, donor, acceptor) {
    if (donor === acceptor) return { ok: false, reason: 'same' };
    var D = atomOf(s, donor), A = atomOf(s, acceptor);
    if (!D || !A) return { ok: false, reason: 'missing' };
    if (D.lp < 1) return { ok: false, reason: 'no-pair' };
    if (!(A.vacancy > 0)) return { ok: false, reason: 'no-vacancy' };
    if (bondBetween(s, donor, acceptor)) return { ok: false, reason: 'bonded' };
    return { ok: true };
  }
  function donate(s, donor, acceptor, hint) {
    var c = canDonate(s, donor, acceptor);
    if (!c.ok) return c;
    atomOf(s, donor).lp--;
    atomOf(s, acceptor).vacancy--;
    s.bonds.push({ a: donor, b: acceptor, order: 1, dative: true, donor: donor, hint: hint || null });
    return { ok: true, order: 1 };
  }
  function openVacancy(s) { return s.atoms.reduce(function (t, a) { return t + (a.vacancy || 0); }, 0); }

  /* ---- 「ほどく」（公開②・M4。UI はまだ無い）----
     非共有電子対1組 → 不対電子2個。「既定 + 2×ほどいた数」が取りうる手の数に入るときだけ。 */
  function canUnfold(s, id) {
    var A = atomOf(s, id);
    if (!A || A.lp < 1) return false;
    var e = ELEMENTS[A.el];
    return e.hands.indexOf(e.un + 2 * (A.unfold + 1)) >= 0;
  }
  function unfold(s, id) {
    if (!canUnfold(s, id)) return false;
    var A = atomOf(s, id);
    A.lp--; A.un += 2; A.unfold++;
    return true;
  }

  /* ---- 数える ---- */
  function bondOrderSum(s, id) {
    return bondsOf(s, id).reduce(function (t, b) { return t + b.order; }, 0);
  }

  // 原子のまわりの電子の数 ＝ 2×結合の次数の和 ＋ 2×非共有電子対 ＋ 不対電子（§4-2）
  function electronCount(s, id) {
    var A = atomOf(s, id);
    return 2 * bondOrderSum(s, id) + 2 * A.lp + A.un;
  }

  /* 「確かめ」の札（§3-3）。完成の条件ではない（完成は judge が決める）。
     不対電子が残っている原子には札を付けない（途中の数を「電子不足」と言うと誤る） */
  function tag(s, id) {
    var A = atomOf(s, id);
    var n = electronCount(s, id);
    if (A.un > 0) return { count: n, kind: 'open', label: null };
    if (A.el === 'H') return n === 2 ? { count: n, kind: 'stable', label: '安定' } : { count: n, kind: 'other', label: null };
    if (n === 8) return { count: n, kind: 'octet', label: 'オクテット' };
    if (n < 8) return { count: n, kind: 'deficient', label: '電子不足（発展）' };
    return { count: n, kind: 'hyper', label: '超原子価（発展）' };
  }

  function unpairedTotal(s) { return s.atoms.reduce(function (t, a) { return t + a.un; }, 0); }
  function charge(s) { return s.atoms.reduce(function (t, a) { return t + (a.charge || 0); }, 0); }

  /* ---- 完成の判定（§3-3）★ ここが唯一の入口 ----
     完成 ＝ 不対電子が「残ってよい数」だけ残っている（ふつうは 0）。
     ⚠ 「全原子 8個」で判定しない（BF₃・PCl₅ が入る公開②で作り直すことになる）。
     opts.allowedUnpaired … お題ごとの例外（NO・NO₂ など不対電子が残るのが正しい分子。§8）。
                            molecules.json の `allowedUnpaired` からここへ渡す。 */
  function judge(s, opts) {
    var allowed = (opts && opts.allowedUnpaired) || 0;
    var left = unpairedTotal(s);
    return {
      empty: s.atoms.length === 0,
      leftover: left,
      allowedUnpaired: allowed,
      complete: s.atoms.length > 0 && left === allowed
    };
  }

  /* ---- 正準化（assembler/chemistry.js から写した2関数・§4-1）---- */

  // 写した元: assembler/chemistry.js `wlRefine`（2342行）。中身は変えていない
  function wlRefine(n, adj, labels) {
    var cls = labels.map(function (l) { return l; });
    for (var iter = 0; iter < n; iter++) {
      var sigs = cls.map(function (cv, i) {
        return cv + '|' + adj[i].map(function (e) { return e.t + ':' + cls[e.j]; }).sort().join(',');
      });
      var uniq = Array.from(new Set(sigs)).sort();
      var renum = new Map(uniq.map(function (sg, k) { return [sg, 'c' + k]; }));
      cls = sigs.map(function (sg) { return renum.get(sg); });
    }
    return cls;
  }

  // 写した元: assembler/chemistry.js `canonicalRowsCore`（2366行）。
  // forcedFirst・collect の2引数（根付きコード・自己同型の収集）は shape では使わないので除いた。探索そのものは同じ
  function canonicalRowsCore(n, adj, labels) {
    if (n === 0) return [];
    var cls = wlRefine(n, adj, labels);
    var placedPos = new Array(n).fill(-1);
    var rows = [];
    var bestRows = null;
    var rowStringFor = function (i) {
      var edges = adj[i]
        .filter(function (e) { return placedPos[e.j] >= 0; })
        .map(function (e) { return placedPos[e.j] + e.t; })
        .sort()
        .join('.');
      return labels[i] + '[' + cls[i] + '](' + edges + ')';
    };
    var cmpRows = function (a, b) {
      var len = Math.min(a.length, b.length);
      for (var i = 0; i < len; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
      }
      return a.length - b.length;
    };
    var search = function () {
      var k = rows.length;
      if (k === n) {
        if (bestRows === null || cmpRows(rows, bestRows) < 0) bestRows = rows.slice();
        return;
      }
      var minRow = null;
      var cands = [];
      for (var i = 0; i < n; i++) {
        if (placedPos[i] >= 0) continue;
        var r = rowStringFor(i);
        if (minRow === null || r < minRow) { minRow = r; cands = [i]; }
        else if (r === minRow) cands.push(i);
      }
      cands.forEach(function (i) {
        placedPos[i] = k;
        rows.push(minRow);
        search();
        rows.pop();
        placedPos[i] = -1;
      });
    };
    search();
    return bestRows || [];
  }

  /* 正準コード（お題の照合・§4-2）。
     頂点 ＝ H も含む全原子。ラベル ＝ `元素|非共有電子対の数|ほどいた数`。辺 ＝ 結合次数（配位結合も次数で・区別しない）。
     頭に電荷（イオン全体）を付ける。空のキャンバスは 'q0:' ＝ どの分子とも一致しない。 */
  function code(s) {
    var idx = new Map();
    s.atoms.forEach(function (a, i) { idx.set(a.id, i); });
    var n = s.atoms.length;
    var adj = s.atoms.map(function () { return []; });
    s.bonds.forEach(function (b) {
      var i = idx.get(b.a), j = idx.get(b.b);
      adj[i].push({ j: j, t: String(b.order) });
      adj[j].push({ j: i, t: String(b.order) });
    });
    var labels = s.atoms.map(function (a) { return a.el + '|' + a.lp + '|' + a.unfold; });
    return 'q' + charge(s) + ':' + canonicalRowsCore(n, adj, labels).join(';');
  }

  /* ---- 連結成分（見た目の置き直しで使う）---- */
  function componentOf(s, id) {
    var seen = new Set([id]);
    var stack = [id];
    while (stack.length) {
      var u = stack.pop();
      bondsOf(s, u).forEach(function (b) {
        var v = b.a === u ? b.b : b.a;
        if (!seen.has(v)) { seen.add(v); stack.push(v); }
      });
    }
    return Array.from(seen);
  }

  /* ---- 化学式（元素ごとの数）---- */
  function formulaCounts(s) {
    var c = {};
    s.atoms.forEach(function (a) { c[a.el] = (c[a.el] || 0) + 1; });
    return c;
  }
  function sameCounts(p, q) {
    var ks = Object.keys(p).concat(Object.keys(q));
    return ks.every(function (k) { return (p[k] || 0) === (q[k] || 0); });
  }

  /* ---- お題（molecules.json の1件）----
     データは「原子と結合の表」。コードは人が書かず、ここで組んでから計算する。
     組むときも bond() を通す ＝ データの誤り（手の数を超える結合）は ok:false で出る。 */
  function fromSpec(spec) {
    var s = create();
    var ids = spec.atoms.map(function (el) { return addAtom(s, el); });
    var errors = [];
    (spec.unfold || []).forEach(function (k) { if (!unfold(s, ids[k])) errors.push('unfold ' + k); });
    // 結合の表の1行は [i, j, 次数] 。4つめが 'dative' なら i の非共有電子対を j（受け手）へ（配位結合）
    spec.bonds.forEach(function (t) {
      if (t[3] === 'dative') {
        var d = donate(s, ids[t[0]], ids[t[1]]);
        if (!d.ok) errors.push(t.join('-') + ':' + d.reason);
        return;
      }
      for (var o = 0; o < t[2]; o++) {
        var r = bond(s, ids[t[0]], ids[t[1]]);
        if (!r.ok) errors.push(t.join('-') + ':' + r.reason);
      }
    });
    return { state: s, errors: errors };
  }

  function prepareTargets(list) {
    return list.map(function (spec) {
      var built = fromSpec(spec);
      return {
        id: spec.id, formula: spec.formula, name: spec.name,
        atoms: spec.atoms.slice(), bonds: spec.bonds.map(function (t) { return t.slice(); }),
        allowedUnpaired: spec.allowedUnpaired || 0,
        code: code(built.state), counts: formulaCounts(built.state), charge: charge(built.state), errors: built.errors
      };
    });
  }

  /* 盤面をお題と照べる。判定は judge を通す（完成の条件はここで作り直さない） */
  function checkTarget(s, target) {
    var j = judge(s, { allowedUnpaired: target.allowedUnpaired });
    // 化学式は元素の数と電荷の両方で見る（NH₄⁺ は N1・H4・電荷 +1）
    var sameFormula = sameCounts(formulaCounts(s), target.counts) && charge(s) === (target.charge || 0);
    return {
      complete: j.complete, leftover: j.leftover, sameFormula: sameFormula, openVacancy: openVacancy(s),
      match: j.complete && sameFormula && code(s) === target.code
    };
  }

  /* ================================================================
     形を見る（M2・§3-4・§4-2）
     中心 → 電子のまとまりの数 → 電子対の配置 → 分子の形。配置と形は**別々の名前**で出す
     （1段に潰すと NH₃ を「正四面体」と覚える事故になる）。
     ⚠ 錯イオン（M5）は金属イオンの表で引く ＝ ここ（まとまりの数）を通さない。金属イオンが入る段でここに分岐を足す。
     ================================================================ */
  var ARRANGEMENT = {
    2: { name: '直線', angle: '180°' },
    3: { name: '平面正三角形', angle: '120°' },
    4: { name: '正四面体', angle: '109.5°' },
    5: { name: '三方両錐', angle: null, advanced: true },
    6: { name: '正八面体', angle: '90°', advanced: true }
  };
  // [まとまり, 非共有電子対] → 形の名前。表に無い組（5・6 まとまりで非共有電子対あり など）は扱わない（§8）
  var SHAPE_NAME = {
    '2,0': { name: '直線形' },
    '3,0': { name: '平面正三角形' },
    '3,1': { name: '折れ線形', advanced: true },
    '4,0': { name: '正四面体形' },
    '4,1': { name: '三角錐形' },
    '4,2': { name: '折れ線形' },
    '5,0': { name: '三方両錐形', advanced: true },
    '6,0': { name: '正八面体形', advanced: true }
  };

  // 電子のまとまり ＝ 結合している相手の数（単・二重・三重はどれも1）＋ 非共有電子対
  function domains(s, id) {
    var A = atomOf(s, id);
    return bondsOf(s, id).length + A.lp;
  }

  function shapeAt(s, id) {
    var A = atomOf(s, id);
    if (!A || A.un > 0) return null; // 手が余っている原子の形は数えない（完成してから）
    var n = domains(s, id), lone = A.lp;
    var arr = ARRANGEMENT[n] || null;
    var sh = SHAPE_NAME[n + ',' + lone] || null;
    return {
      center: id, el: A.el, domains: n, bonded: bondsOf(s, id).length, lone: lone,
      arrangement: arr ? arr.name : null, idealAngle: arr ? arr.angle : null,
      shape: sh ? sh.name : null, supported: !!sh,
      advanced: !!((arr && arr.advanced) || (sh && sh.advanced))
    };
  }

  /* 中心の候補（ユーザー決定 2026-09-26: 中心は自動で決める）。
     結合相手のいちばん多い原子。同じ数が2つ以上なら全部を返す（C₂H₄・H₂O₂ など。画面は切り替えのボタンを出す）。
     並びは H 以外を先・id の小さい順。原子が2個以下なら空（数えずに「直線」） */
  function shapeCenters(s) {
    if (s.atoms.length <= 2) return [];
    var deg = function (id) { return bondsOf(s, id).length; };
    var max = 0;
    s.atoms.forEach(function (a) { max = Math.max(max, deg(a.id)); });
    return s.atoms.filter(function (a) { return deg(a.id) === max; })
      .sort(function (a, b) { return ((a.el === 'H') - (b.el === 'H')) || (a.id - b.id); })
      .map(function (a) { return a.id; });
  }

  /* 分子の形。完成して1つにつながった分子だけ（それ以外は null）。
     centerId が候補にあればそれを中心に、無ければ候補の先頭 */
  function moleculeShape(s0, centerId) {
    // まだ配位していない受け手（ひとりの H⁺）は形に入れない ＝ 配位する前の NH₃（三角錐形）と後の NH₄⁺（正四面体形）を見比べられる
    var s = { atoms: s0.atoms.filter(function (a) { return !(a.vacancy > 0 && !bondsOf(s0, a.id).length); }), bonds: s0.bonds };
    if (!judge(s).complete || !s.atoms.length) return null;
    if (componentOf(s, s.atoms[0].id).length !== s.atoms.length) return null;
    if (s.atoms.length === 2) {
      return { twoAtoms: true, center: null, domains: null, arrangement: null, shape: '直線形', supported: true, advanced: false };
    }
    if (s.atoms.length === 1) return null;
    var cands = shapeCenters(s);
    var c = cands.indexOf(centerId) >= 0 ? centerId : cands[0];
    var r = shapeAt(s, c);
    r.candidates = cands;
    return r;
  }

  /* 形の 3D 座標: まとまりの数ごとの理想の単位ベクトル（§4-2）。
     座標は画面と同じ向き（x 右・y 下・z 手前）。教科書の模式図がそのまま描けるように置いてある:
       4 … 上1本・左下（紙面）・右下の手前（くさび）・右下の奥（破線）＝ (±1,±1,±1)/√3 の交互と同じ正四面体を回したもの
       3 … 紙面の 120°（上・右下・左下）／2 … 左右／5 … 軸2＋赤道3（72°ではなく 120°）／6 … ±x・±y・±z */
  var R8 = Math.sqrt(8) / 3;
  var IDEAL = {
    1: [[1, 0, 0]],
    2: [[1, 0, 0], [-1, 0, 0]],
    3: [[0, -1, 0], [Math.sqrt(3) / 2, 0.5, 0], [-Math.sqrt(3) / 2, 0.5, 0]],
    4: [[0, -1, 0], [-R8, 1 / 3, 0], [R8 / 2, 1 / 3, R8 * Math.sqrt(3) / 2], [R8 / 2, 1 / 3, -R8 * Math.sqrt(3) / 2]],
    5: [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-0.5, 0, Math.sqrt(3) / 2], [-0.5, 0, -Math.sqrt(3) / 2]],
    6: [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]
  };
  // 非共有電子対を先に置く向きの順（NH₃ は上・H₂O は上と奥 ＝ 結合が紙面と手前に残って形が読める）
  var LP_ORDER = { 1: [0], 2: [0, 1], 3: [0, 1, 2], 4: [0, 3, 2, 1], 5: [2, 3, 4, 0, 1], 6: [0, 1, 2, 3, 4, 5] };
  function idealVectors(n) { return (IDEAL[n] || []).map(function (v) { return v.slice(); }); }

  /* 中心のまわりの 3D の並び: [{ kind: 'lp' }｜{ kind: 'bond', partner, order, el }, v ]。
     結合は「次数の大きい順・H 以外を先」に、非共有電子対の残りの向きへ置く（HCHO の O は上） */
  function shapeGeometry(s, center) {
    var A = atomOf(s, center);
    var n = domains(s, center);
    var vecs = idealVectors(n);
    var used = new Array(vecs.length).fill(false);
    var items = [];
    var order = LP_ORDER[n] || [];
    for (var i = 0; i < A.lp && i < order.length; i++) {
      used[order[i]] = true;
      items.push({ kind: 'lp', v: vecs[order[i]] });
    }
    var bs = bondsOf(s, center).map(function (b) {
      var p = b.a === center ? b.b : b.a;
      return { partner: p, order: b.order, el: atomOf(s, p).el };
    }).sort(function (x, y) { return (y.order - x.order) || ((x.el === 'H') - (y.el === 'H')) || (x.partner - y.partner); });
    bs.forEach(function (b) {
      for (var k = 0; k < vecs.length; k++) {
        if (!used[k]) { used[k] = true; items.push({ kind: 'bond', partner: b.partner, order: b.order, el: b.el, v: vecs[k] }); return; }
      }
    });
    return items;
  }

  function angleDeg(u, v) {
    var d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    var nu = Math.hypot(u[0], u[1], u[2]), nv = Math.hypot(v[0], v[1], v[2]);
    return Math.acos(Math.max(-1, Math.min(1, d / (nu * nv)))) * 180 / Math.PI;
  }

  var api = {
    ELEMENTS: ELEMENTS, ELEMENT_ORDER: ORDER, MAX_ORDER: MAX_ORDER,
    create: create, clone: clone, atomOf: atomOf, bondBetween: bondBetween, bondsOf: bondsOf,
    addAtom: addAtom, canBond: canBond, bond: bond, canUnfold: canUnfold, unfold: unfold,
    bondOrderSum: bondOrderSum, electronCount: electronCount, tag: tag,
    unpairedTotal: unpairedTotal, charge: charge, judge: judge,
    wlRefine: wlRefine, canonicalRowsCore: canonicalRowsCore, code: code,
    componentOf: componentOf, formulaCounts: formulaCounts, sameCounts: sameCounts,
    fromSpec: fromSpec, prepareTargets: prepareTargets, checkTarget: checkTarget,
    PARTS: PARTS, PART_ORDER: PART_ORDER, canDonate: canDonate, donate: donate, openVacancy: openVacancy,
    ARRANGEMENT: ARRANGEMENT, SHAPE_NAME: SHAPE_NAME,
    domains: domains, shapeAt: shapeAt, shapeCenters: shapeCenters, moleculeShape: moleculeShape,
    idealVectors: idealVectors, shapeGeometry: shapeGeometry, angleDeg: angleDeg
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.ChemShape = window.ChemShape || {};
    window.ChemShape.model = api;
  }
})();
