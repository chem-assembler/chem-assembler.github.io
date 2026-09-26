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

  function addAtom(s, el) {
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
    spec.bonds.forEach(function (t) {
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
        code: code(built.state), counts: formulaCounts(built.state), errors: built.errors
      };
    });
  }

  /* 盤面をお題と照べる。判定は judge を通す（完成の条件はここで作り直さない） */
  function checkTarget(s, target) {
    var j = judge(s, { allowedUnpaired: target.allowedUnpaired });
    var sameFormula = sameCounts(formulaCounts(s), target.counts);
    return {
      complete: j.complete, leftover: j.leftover, sameFormula: sameFormula,
      match: j.complete && sameFormula && code(s) === target.code
    };
  }

  var api = {
    ELEMENTS: ELEMENTS, ELEMENT_ORDER: ORDER, MAX_ORDER: MAX_ORDER,
    create: create, clone: clone, atomOf: atomOf, bondBetween: bondBetween, bondsOf: bondsOf,
    addAtom: addAtom, canBond: canBond, bond: bond, canUnfold: canUnfold, unfold: unfold,
    bondOrderSum: bondOrderSum, electronCount: electronCount, tag: tag,
    unpairedTotal: unpairedTotal, charge: charge, judge: judge,
    wlRefine: wlRefine, canonicalRowsCore: canonicalRowsCore, code: code,
    componentOf: componentOf, formulaCounts: formulaCounts, sameCounts: sameCounts,
    fromSpec: fromSpec, prepareTargets: prepareTargets, checkTarget: checkTarget
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.ChemShape = window.ChemShape || {};
    window.ChemShape.model = api;
  }
})();
