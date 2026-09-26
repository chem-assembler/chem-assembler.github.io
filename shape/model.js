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
     金属イオン（M5）もここに乗る（空き ＝ 配位数・metal の印）。 */
  var PARTS = {
    'H+': { el: 'H', un: 0, lp: 0, vacancy: 1, charge: 1, label: 'H⁺' }
  };
  var PART_ORDER = ['H+'];

  /* ---- 金属イオン（公開③・M5・§4-2 の表）----
     ⚠⚠ 錯イオンの形は**この表で引く**。電子対の反発（まとまりの数）からは出さない（§3-4）。
        まとまりで数えると [Cu(NH₃)₄]²⁺ が正四面体になる ＝ 化学の誤り（数研 化学基礎 p.38 図18・参考書 complex-ion の表）。
     ⚠ 金属イオンの電子（d 電子）は数えない。受け手としての「空き」（＝ 配位数）だけを持つ。
     ⚠ 錯イオンに dsp²・d²sp³ の混成を付けない（§0・§3-7。高校の範囲外・参考書 complex-ion の決めと同じ）。
     Fe²⁺（[Fe(CN)₆]⁴⁻）は表にあるが、お題は Fe³⁺ の1つにした（§3-1 のパレットの4種）。足すときはこの表に1行 */
  var METALS = {
    'Ag+': { el: 'Ag', charge: 1, cn: 2, shape: '直線形', label: 'Ag⁺' },
    'Cu2+': { el: 'Cu', charge: 2, cn: 4, shape: '正方形', label: 'Cu²⁺' },
    'Zn2+': { el: 'Zn', charge: 2, cn: 4, shape: '正四面体形', label: 'Zn²⁺' },
    'Fe3+': { el: 'Fe', charge: 3, cn: 6, shape: '正八面体形', label: 'Fe³⁺' }
  };
  var METAL_ORDER = ['Ag+', 'Cu2+', 'Zn2+', 'Fe3+'];
  METAL_ORDER.forEach(function (k) {
    var m = METALS[k];
    PARTS[k] = { el: m.el, un: 0, lp: 0, vacancy: m.cn, charge: m.charge, label: m.label, metal: true };
  });

  /* ---- 出来合いの配位子（公開③・M5・§4-2・ユーザー決定 2026-09-26）----
     原子と結合の表で持ち、置くときに bond() で組む（組んだ後の電子の数はふつうの分子と同じに数える）。
     陰イオンは「その原子に電子を1個足す」: 組んだあとに不対電子を1個足し、2個そろえば非共有電子対にする
     （OH⁻ の O は非共有電子対3組・CN⁻ の C は1組）。電荷は -1 をその原子に置く（イオン全体の電荷は和で出す）。
     donor … 配位する原子（atoms の添字）。⚠ CN⁻ は C で配位する（N の非共有電子対は配位させない ＝ nd の印）。
     Cl⁻ は置かない: パレットに Cl⁻ があると [CuCl₄]²⁻ が組め、表の「Cu²⁺ は正方形」が当たらない（実際は正四面体に近い）ため */
  var LIGANDS = {
    'NH3': { label: 'NH₃', atoms: ['N', 'H', 'H', 'H'], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]], donor: 0 },
    'H2O': { label: 'H₂O', atoms: ['O', 'H', 'H'], bonds: [[0, 1, 1], [0, 2, 1]], donor: 0 },
    'OH-': { label: 'OH⁻', atoms: ['O', 'H'], bonds: [[0, 1, 1]], donor: 0, anion: 0 },
    'CN-': { label: 'CN⁻', atoms: ['C', 'N'], bonds: [[0, 1, 3]], donor: 0, anion: 0, noDonor: [1] }
  };
  var LIGAND_ORDER = ['NH3', 'H2O', 'OH-', 'CN-'];

  function isMetal(a) { return !!(a && a.part && PARTS[a.part] && PARTS[a.part].metal); }

  // 配位子のパーツを組む。返すのは配位する原子（donor）の id。パーツの原子には lig（パーツの名前）と grp（同じパーツの印）を付ける
  function addLigand(s, key) {
    var L = LIGANDS[key];
    var grp = s.nextId;
    var ids = L.atoms.map(function (el) { return addAtom(s, el); });
    L.bonds.forEach(function (t) { for (var o = 0; o < t[2]; o++) bond(s, ids[t[0]], ids[t[1]]); });
    if (typeof L.anion === 'number') {
      var X = atomOf(s, ids[L.anion]);
      X.un += 1; X.lp += Math.floor(X.un / 2); X.un = X.un % 2; X.charge = -1;
    }
    (L.noDonor || []).forEach(function (k) { atomOf(s, ids[k]).nd = true; });
    ids.forEach(function (id) { var a = atomOf(s, id); a.lig = key; a.grp = grp; });
    return ids[L.donor];
  }

  function addAtom(s, el) {
    if (LIGANDS[el]) return addLigand(s, el);
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
    if (D.nd) return { ok: false, reason: 'not-donor' }; // CN⁻ の N（配位するのは C・M5）
    // ⚠ 配位数を超えては配位できない（金属イオンの空き ＝ 配位数。H⁺ は1）
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

  /* ---- 「ほどく」（公開②・M4・§3-2・§4-2）----
     非共有電子対1組 → 不対電子2個。「既定 + 2×ほどいた数」が取りうる手の数に入るときだけ（P: 3→5、S: 2→4→6）。
     N・O・F・Cl・C・B・H はほどけない（手の数の表に次の数が無い）。
     ⚠ 超原子価に sp³d・sp³d² を付けない（§0・§3-7）。ここは電子の数だけを扱う。 */
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
    // 金属イオン（M5）は電子の数を数えない（d 電子を数えないモデル。「8個」と出すとオクテットと読まれる）
    if (isMetal(A)) return { count: null, kind: 'metal', label: null };
    if (A.un > 0) return { count: n, kind: 'open', label: null };
    if (A.el === 'H') return n === 2 ? { count: n, kind: 'stable', label: '安定' } : { count: n, kind: 'other', label: null };
    if (n === 8) return { count: n, kind: 'octet', label: 'オクテット' };
    if (n < 8) return { count: n, kind: 'deficient', label: '電子不足（発展）' };
    return { count: n, kind: 'hyper', label: '超原子価（発展）' };
  }

  // 盤の上でほどいた数の合計（お題の「ほどく数」と比べて声かけに使う）
  function unfoldTotal(s) { return s.atoms.reduce(function (t, a) { return t + (a.unfold || 0); }, 0); }
  // 手の数（既定の不対電子 ＋ 2×ほどいた数）。受け手のパーツ（H⁺）は 0
  function handsOf(s, id) {
    var A = atomOf(s, id);
    return (A && !A.part && ELEMENTS[A.el]) ? ELEMENTS[A.el].un + 2 * A.unfold : 0;
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
    /* 錯イオン（M5・金属イオンを含む盤）だけ、ラベルに2つを足す（写した2関数は触らない）。
       なぜ: [Cu(NH₃)₄]²⁺ は H が12個・どれも同じラベルで、探索（canonicalRowsCore）は「まだどこにもつながっていない H」から
       並べ始める ＝ 12! 通りを試して止まらない（2026-09-26 に node で踏んだ）。
       ① 重原子を先に並べる（頭に a・H は z）→ H はつながった重原子の位置で見分けられる
       ② 同じ重原子にぶら下がる H（末端）に 1・2・3 の番号 → 兄弟の H どうしの入れ替え（3! 通り）を探索しない。
          兄弟の末端 H は入れ替えても同じグラフ（自己同型）なので、番号の振り方でコードは変わらない
       どちらも「グラフだけで決まる」規則 ＝ 同じ分子なら同じコード・違う分子なら違うコードのまま。
       ⚠ 金属イオンが無い盤のコードは1文字も変えない（公開①②のお題とテストはそのまま） */
    if (s.atoms.some(isMetal)) {
      var leafNo = {};
      labels = s.atoms.map(function (a, i) {
        if (a.el !== 'H') return 'a' + labels[i];
        var bs = bondsOf(s, a.id);
        if (bs.length === 1) {
          var p = bs[0].a === a.id ? bs[0].b : bs[0].a;
          if (atomOf(s, p).el !== 'H') { leafNo[p] = (leafNo[p] || 0) + 1; return 'z' + labels[i] + '#' + leafNo[p]; }
        }
        return 'z' + labels[i];
      });
    }
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
  // atoms の1件がパーツの名前（配位子）なら、返す id はその配位する原子（bonds の添字はこれを指す）
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
        // 公開②: ほどく原子の番号（atoms の添字・同じ番号を2回で2組）・「発展」の札・既定の書き方（PCl₅・SF₆ は構造式）
        unfold: (spec.unfold || []).slice(), advanced: !!spec.advanced, mode: spec.mode || null,
        // M6: 教科書の実測の結合角（CH₄・NH₃・H₂O だけ。値の無いお題は null ＝ 数値を出さない）
        bondAngle: typeof spec.bondAngle === 'number' ? spec.bondAngle : null,
        // M5: 錯イオンのお題（金属イオンを含む）。atoms の1件は「原子」か「パーツの名前」（NH3・CN- ＝ 出来合いの配位子・Cu2+ など）
        complex: spec.atoms.some(function (k) { return !!METALS[k]; }),
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
     ⚠ 錯イオン（M5）は金属イオンの表（METALS）で引く ＝ ここ（まとまりの数）を通さない。分岐は shapeAt の頭（complexShapeAt）。
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

  /* 錯イオンの形（M5）: 中心の金属イオンの表で引く。⚠ まとまりの数（domains）も配置の名前も**出さない**（VSEPR を通さない）。
     配位数が表の数に届いていない（あと何か所か空いている）ときは形を出さない（null） */
  function complexShapeAt(s, id) {
    var A = atomOf(s, id);
    var m = METALS[A.part];
    var n = bondsOf(s, id).length;
    if (!m || A.vacancy > 0 || n !== m.cn) return null;
    return {
      center: id, el: A.el, complex: true, ion: m.label, coordination: n,
      domains: null, bonded: n, lone: 0, arrangement: null, idealAngle: null,
      shape: m.shape, supported: true, advanced: true
    };
  }

  function shapeAt(s, id) {
    var A = atomOf(s, id);
    if (A && isMetal(A)) return complexShapeAt(s, id);
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
    // 錯イオン（M5）: 中心は金属イオンだけ（[Ag(NH₃)₂]⁺ は N の結合相手 4 のほうが Ag の 2 より多いが、形を見るのは Ag）
    var metals = s.atoms.filter(function (a) { return isMetal(a) && deg(a.id) > 0; });
    if (metals.length) return metals.sort(function (a, b) { return a.id - b.id; }).map(function (a) { return a.id; });
    var max = 0;
    s.atoms.forEach(function (a) { max = Math.max(max, deg(a.id)); });
    return s.atoms.filter(function (a) { return deg(a.id) === max; })
      .sort(function (a, b) { return ((a.el === 'H') - (b.el === 'H')) || (a.id - b.id); })
      .map(function (a) { return a.id; });
  }

  /* 分子の形。完成して1つにつながった分子だけ（それ以外は null）。
     centerId が候補にあればそれを中心に、無ければ候補の先頭 */
  // 形を見る分子: まだ配位していない受け手（ひとりの H⁺）を除いたもの
  function shapeState(s0) {
    return { atoms: s0.atoms.filter(function (a) { return !(a.vacancy > 0 && !bondsOf(s0, a.id).length); }), bonds: s0.bonds };
  }

  function moleculeShape(s0, centerId) {
    // まだ配位していない受け手（ひとりの H⁺）は形に入れない ＝ 配位する前の NH₃（三角錐形）と後の NH₄⁺（正四面体形）を見比べられる
    var s = shapeState(s0);
    if (!judge(s).complete || !s.atoms.length) return null;
    if (componentOf(s, s.atoms[0].id).length !== s.atoms.length) return null;
    if (s.atoms.length === 2) {
      return { twoAtoms: true, center: null, domains: null, arrangement: null, shape: '直線形', supported: true, advanced: false };
    }
    if (s.atoms.length === 1) return null;
    var cands = shapeCenters(s);
    var c = cands.indexOf(centerId) >= 0 ? centerId : cands[0];
    var r = shapeAt(s, c);
    if (!r) return null; // 配位数に届いていない錯イオン（M5）
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
  /* 錯イオンの形の向き（M5）: 表の形の名前から引く（まとまりの数は使わない）。
     正方形は紙面の十字（z = 0 ＝ 4本とも同じ平面）。正四面体・正八面体・直線は分子と同じ理想の向き */
  var COMPLEX_VECS = {
    '直線形': IDEAL[2],
    '正方形': [[1, 0, 0], [0, -1, 0], [-1, 0, 0], [0, 1, 0]],
    '正四面体形': IDEAL[4],
    '正八面体形': IDEAL[6]
  };
  /* 配位子の名前（形の画面の記号）。出来合いのパーツならその名前、自分で組んだ NH₃・H₂O なら数えて出す */
  function ligandLabel(s, donor, metal) {
    var D = atomOf(s, donor);
    if (D.lig && LIGANDS[D.lig]) return LIGANDS[D.lig].label;
    var nb = bondsOf(s, donor).map(function (b) { return b.a === donor ? b.b : b.a; }).filter(function (k) { return k !== metal; });
    var h = nb.filter(function (k) { return atomOf(s, k).el === 'H'; }).length;
    var sub = ['', '', '₂', '₃', '₄'];
    if (nb.length !== h) return D.el;
    if (D.el === 'O' && h === 2) return 'H₂O';
    return D.el + (h ? 'H' + sub[h] : '');
  }
  function complexGeometry(s, center) {
    var sh = complexShapeAt(s, center);
    var vecs = sh ? COMPLEX_VECS[sh.shape] : null;
    if (!vecs) return [];
    return bondsOf(s, center).map(function (b) { return b.a === center ? b.b : b.a; }).sort(function (x, y) { return x - y; })
      .map(function (p, k) { return { kind: 'bond', partner: p, order: 1, el: ligandLabel(s, p, center), ligand: true, v: vecs[k].slice() }; });
  }

  function shapeGeometry(s, center) {
    var A = atomOf(s, center);
    if (isMetal(A)) return complexGeometry(s, center);
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

  /* ---- 結合角の縮み（M6・§3-6）----
     理想の正四面体（109.47°）から、**与えられた角**（教科書の実測値）まで、結合の向きだけを補間する。
     ⚠ この関数は角度を「計算して出す」ものではない。終点の角は引数でもらう（molecules.json の bondAngle
        ＝ 数研 化学基礎 2編 PLUS の実測値: CH₄ 109.5°・NH₃ 106.7°・H₂O 104.5°）。反発の強さから角度は出さない
     ⚠ 非共有電子対の向きは動かさない。非共有電子対が無ければ（CH₄）何も動かさない（対照）
     しくみ: 軸 a ＝ 非共有電子対の向きの和の反対。各結合を「軸からの傾き α」と「軸のまわりの向き e」に分け、
     e はそのまま・α だけを変える。結合が軸のまわりに等間隔（NH₃ は 120°・H₂O は 180°）なので、
     2本の結合の角 θ と α は cosθ = cos²α + sin²α·cosφ（φ ＝ 360°/結合の数）で結ばれる */
  function squeezeGeometry(items, targetDeg, t) {
    var copy = items.map(function (it) { return Object.assign({}, it, { v: it.v.slice() }); });
    var lps = copy.filter(function (it) { return it.kind === 'lp'; });
    var bs = copy.filter(function (it) { return it.kind === 'bond'; });
    if (!lps.length || bs.length < 2 || typeof targetDeg !== 'number' || !(t > 0)) return copy;
    var a = [0, 0, 0];
    lps.forEach(function (it) { a[0] -= it.v[0]; a[1] -= it.v[1]; a[2] -= it.v[2]; });
    var na = Math.hypot(a[0], a[1], a[2]);
    if (na < 1e-9) return copy;
    a = [a[0] / na, a[1] / na, a[2] / na];
    var theta0 = angleDeg(bs[0].v, bs[1].v);
    var theta = (theta0 + (targetDeg - theta0) * Math.min(1, t)) * Math.PI / 180;
    var cphi = Math.cos(2 * Math.PI / bs.length);
    var c2 = (Math.cos(theta) - cphi) / (1 - cphi);
    var ca = Math.sqrt(Math.max(0, Math.min(1, c2))), sa = Math.sqrt(1 - ca * ca);
    bs.forEach(function (it) {
      var v = it.v, c = v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
      var p = [v[0] - c * a[0], v[1] - c * a[1], v[2] - c * a[2]], np = Math.hypot(p[0], p[1], p[2]) || 1;
      it.v = [ca * a[0] + sa * p[0] / np, ca * a[1] + sa * p[1] / np, ca * a[2] + sa * p[2] / np];
    });
    return copy;
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
    unpairedTotal: unpairedTotal, unfoldTotal: unfoldTotal, handsOf: handsOf, charge: charge, judge: judge,
    wlRefine: wlRefine, canonicalRowsCore: canonicalRowsCore, code: code,
    componentOf: componentOf, formulaCounts: formulaCounts, sameCounts: sameCounts,
    fromSpec: fromSpec, prepareTargets: prepareTargets, checkTarget: checkTarget,
    PARTS: PARTS, PART_ORDER: PART_ORDER, canDonate: canDonate, donate: donate, openVacancy: openVacancy,
    ARRANGEMENT: ARRANGEMENT, SHAPE_NAME: SHAPE_NAME,
    domains: domains, shapeAt: shapeAt, shapeCenters: shapeCenters, moleculeShape: moleculeShape,
    idealVectors: idealVectors, shapeGeometry: shapeGeometry, angleDeg: angleDeg,
    shapeState: shapeState, squeezeGeometry: squeezeGeometry,
    METALS: METALS, METAL_ORDER: METAL_ORDER, LIGANDS: LIGANDS, LIGAND_ORDER: LIGAND_ORDER,
    isMetal: isMetal, addLigand: addLigand, complexShapeAt: complexShapeAt, ligandLabel: ligandLabel, COMPLEX_VECS: COMPLEX_VECS
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.ChemShape = window.ChemShape || {};
    window.ChemShape.model = api;
  }
})();
