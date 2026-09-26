/* tests.js — 電子対でみる分子のかたち（shape）の回帰テスト。
   - モデルのテスト（runModelTests）は node だけでも走る:  node shape/tests.js
   - test.html では、モデルのテストのあとに iframe で画面を駆動する（DESIGN_bond_app.md §6 の 1〜4・6・7・8。6 は M2）
   完了の合図は #total に「ALL PASS (n)」／「N FAILED / M」、失敗は div.case.fail（tools/run-tests.mjs が読む形・ratio と同じ）。
   ⚠ グローバルを作らない（ブラウザでは IIFE の中だけで閉じる）。 */
(function () {
  'use strict';

  /* ================================================================
     モデル（node でもブラウザでも同じもの）
     ================================================================ */
  function runModelTests(M, molecules, ok, section) {
    section = section || function () {};

    function build(atoms, bonds) {
      var s = M.create();
      var ids = atoms.map(function (el) { return M.addAtom(s, el); });
      var bad = [];
      bonds.forEach(function (t) {
        for (var o = 0; o < t[2]; o++) { var r = M.bond(s, ids[t[0]], ids[t[1]]); if (!r.ok) bad.push(r.reason); }
      });
      return { s: s, ids: ids, bad: bad };
    }
    // 決まった種の並べ替え（置く順・結合する順を変える）
    function shuffled(arr, seed) {
      var a = arr.slice(), x = seed;
      for (var i = a.length - 1; i > 0; i--) {
        x = (x * 1103515245 + 12345) % 2147483648;
        var j = x % (i + 1);
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
    function permutedBuild(spec, seed) {
      var n = spec.atoms.length;
      var perm = shuffled(Array.from({ length: n }, function (_, i) { return i; }), seed); // 新しい位置 → 元の番号
      var inv = []; perm.forEach(function (orig, k) { inv[orig] = k; });
      var atoms = perm.map(function (orig) { return spec.atoms[orig]; });
      var bonds = shuffled(spec.bonds, seed + 7).map(function (t) {
        return (seed % 2) ? [inv[t[1]], inv[t[0]], t[2]] : [inv[t[0]], inv[t[1]], t[2]];
      });
      return build(atoms, bonds);
    }

    var T = M.prepareTargets(molecules);
    var byId = {}; T.forEach(function (t) { byId[t.id] = t; });

    section('モデル: 元素の表（式で出す・§4-2）');
    var expect = { H: [1, 0], B: [3, 0], C: [4, 0], N: [3, 1], O: [2, 2], F: [1, 3], P: [3, 1], S: [2, 2], Cl: [1, 3] };
    ok('置ける元素は H・B・C・N・O・F・P・S・Cl の9つ', M.ELEMENT_ORDER.join(',') === 'H,B,C,N,O,F,P,S,Cl');
    Object.keys(expect).forEach(function (el) {
      var e = M.ELEMENTS[el];
      ok(el + ': 不対電子 ' + expect[el][0] + '・非共有電子対 ' + expect[el][1], e.un === expect[el][0] && e.lp === expect[el][1]);
    });
    ok('取りうる手の数: S は 2・4・6、P は 3・5、B は 3', M.ELEMENTS.S.hands.join() === '2,4,6' &&
      M.ELEMENTS.P.hands.join() === '3,5' && M.ELEMENTS.B.hands.join() === '3');

    section('モデル: 1 結合（不対電子どうし）');
    (function () {
      var s = M.create(), o = M.addAtom(s, 'O'), h = M.addAtom(s, 'H');
      var before = M.bondOrderSum(s, o);
      var r = M.bond(s, o, h);
      ok('O と H が結合できる', r.ok && r.order === 1);
      ok('共有電子対が1組増える', M.bondOrderSum(s, o) === before + 1 && s.bonds.length === 1);
      ok('両原子の不対電子が1つずつ減る（O 2→1・H 1→0）', M.atomOf(s, o).un === 1 && M.atomOf(s, h).un === 0);
      ok('非共有電子対は変わらない（O は2組のまま）', M.atomOf(s, o).lp === 2);
      var h2 = M.addAtom(s, 'H');
      ok('⚠ 否定対照: 不対電子の無い H（結合ずみ）とは結合できない', !M.canBond(s, h, h2).ok && M.canBond(s, h, h2).reason === 'no-unpaired');
      ok('⚠ 否定対照: 自分自身とは結合できない', !M.canBond(s, o, o).ok);
    })();
    (function () {
      var n = build(['N', 'N'], [[0, 1, 3]]);
      ok('N₂: 三重結合ができ、両方の不対電子が0', !n.bad.length && n.s.bonds[0].order === 3 && M.unpairedTotal(n.s) === 0);
      var c = build(['C', 'C'], [[0, 1, 3]]);
      var r = M.canBond(c.s, c.ids[0], c.ids[1]);
      ok('⚠ 否定対照: 三重結合より多くはつくれない（C≡C に不対電子が残っていても）', !r.ok && r.reason === 'max-order');
    })();

    section('モデル: 2 完成の判定（不対電子ゼロ・§3-3）');
    (function () {
      var s = M.create(), o = M.addAtom(s, 'O'), h1 = M.addAtom(s, 'H'), h2 = M.addAtom(s, 'H');
      M.bond(s, o, h1);
      var j = M.judge(s);
      ok('H₂O の O に H を1つ → 未完成（手が余っている・不対電子 2）', !j.complete && j.leftover === 2);
      M.bond(s, o, h2);
      j = M.judge(s);
      ok('H を2つ → 完成（不対電子 0）', j.complete && j.leftover === 0);
      ok('空のキャンバスは完成ではない', !M.judge(M.create()).complete && M.judge(M.create()).empty);
    })();
    (function () {
      // 例外の入口（NO・NO₂ のため・§8）: 残ってよい不対電子の数を渡せる
      var no = build(['N', 'O'], [[0, 1, 2]]);
      ok('N=O は不対電子が1つ残る ＝ ふつうは未完成', !M.judge(no.s).complete && M.judge(no.s).leftover === 1);
      ok('お題の例外（allowedUnpaired: 1）なら同じ判定の関数で完成になる', M.judge(no.s, { allowedUnpaired: 1 }).complete);
      var fake = M.prepareTargets([{ id: 'NOx', formula: 'NO', name: 't', atoms: ['N', 'O'], bonds: [[0, 1, 2]], allowedUnpaired: 1 }])[0];
      ok('お題の照合（checkTarget）も例外を通す', M.checkTarget(no.s, fake).match);
      ok('⚠ 否定対照: 例外は数が合うときだけ（allowedUnpaired: 2 では未完成）', !M.judge(no.s, { allowedUnpaired: 2 }).complete);
    })();

    section('モデル: 確かめの札（電子の数・§3-3）');
    (function () {
      var w = build(['O', 'H', 'H'], [[0, 1, 1], [0, 2, 1]]);
      var tO = M.tag(w.s, w.ids[0]), tH = M.tag(w.s, w.ids[1]);
      ok('H₂O の O は 8個「オクテット」', tO.count === 8 && tO.label === 'オクテット');
      ok('H₂O の H は 2個「安定」', tH.count === 2 && tH.label === '安定');
      var b = build(['B', 'H', 'H', 'H'], [[0, 1, 1], [0, 2, 1], [0, 3, 1]]);
      var tB = M.tag(b.s, b.ids[0]);
      ok('B に H を3つ → 不対電子は0で完成、B は 6個「電子不足（発展）」', M.judge(b.s).complete && tB.count === 6 && tB.label === '電子不足（発展）');
      var half = build(['O', 'H'], [[0, 1, 1]]);
      ok('⚠ 不対電子が残る原子には札を付けない（途中の数を電子不足と言わない）', M.tag(half.s, half.ids[0]).label === null);
    })();

    section('モデル: ほどく（公開②のための形・UI はまだ無い）');
    (function () {
      var s = M.create();
      var ids = {}; ['N', 'O', 'F', 'Cl', 'C', 'B', 'H', 'P', 'S'].forEach(function (el) { ids[el] = M.addAtom(s, el); });
      ok('⚠ 否定対照: N・O・F・Cl・C・B・H はほどけない', ['N', 'O', 'F', 'Cl', 'C', 'B', 'H'].every(function (el) { return !M.canUnfold(s, ids[el]); }));
      ok('P は1回だけほどける（3→5）', M.unfold(s, ids.P) && M.atomOf(s, ids.P).un === 5 && !M.canUnfold(s, ids.P));
      ok('S は2回までほどける（2→4→6）', M.unfold(s, ids.S) && M.unfold(s, ids.S) && M.atomOf(s, ids.S).un === 6 && !M.canUnfold(s, ids.S));
      var p = M.create(), P = M.addAtom(p, 'P'); M.unfold(p, P);
      for (var i = 0; i < 5; i++) { var c = M.addAtom(p, 'Cl'); M.bond(p, P, c); }
      var tP = M.tag(p, P);
      ok('PCl₅: P を1組ほどいて完成・10個「超原子価（発展）」', M.judge(p).complete && tP.count === 10 && tP.label === '超原子価（発展）');
    })();

    section('モデル: 3 お題（molecules.json・§6）');
    var must = ['H2', 'HCl', 'H2O', 'NH3', 'CH4', 'CO2', 'N2', 'HCN', 'C2H4', 'H2O2', 'H2S', 'PH3', 'HCHO'];
    ok('最低限のお題（12件＋M2 の HCHO）がそろっている', must.every(function (id) { return !!byId[id]; }));
    ok('お題の id は重ならない', new Set(T.map(function (t) { return t.id; })).size === T.length);
    T.forEach(function (t) {
      var b = M.fromSpec(molecules.filter(function (x) { return x.id === t.id; })[0]);
      var inv = b.state.atoms.every(function (a) {
        var n = M.electronCount(b.state, a.id);
        return a.el === 'H' ? n === 2 : n === 8;
      });
      ok(t.id + ': 表どおりに組めて完成し、自分のコードと一致（H は2個・他は8個）',
        !t.errors.length && M.judge(b.state).complete && M.checkTarget(b.state, t).match && inv);
    });
    ok('お題のコードはすべて互いに違う', new Set(T.map(function (t) { return t.code; })).size === T.length);

    (function () {
      var co2 = build(['C', 'O', 'O'], [[0, 1, 1], [0, 2, 1]]);
      var r = M.checkTarget(co2.s, byId.CO2);
      ok('⚠ 否定対照: CO₂ を単結合で組む → C と O に不対電子が残り未完成・お題と不一致',
        !r.complete && r.leftover === 4 && !r.match && M.atomOf(co2.s, co2.ids[0]).un === 2);
      var hnc = build(['H', 'N', 'C'], [[0, 1, 1], [1, 2, 2]]);
      ok('⚠ 否定対照: HNC（H−N=C）は HCN と化学式が同じでも一致しない',
        M.sameCounts(M.formulaCounts(hnc.s), byId.HCN.counts) && M.code(hnc.s) !== byId.HCN.code && !M.checkTarget(hnc.s, byId.HCN).match);
      var r3 = M.canBond(hnc.s, hnc.ids[1], hnc.ids[2]);
      ok('⚠ HNC の N≡C は不対電子が足りずつくれない', !r3.ok && r3.reason === 'no-unpaired');
      var empty = M.create();
      ok('⚠ 否定対照: 空のキャンバスは H₂ と一致しない（コードも違う）',
        !M.checkTarget(empty, byId.H2).match && M.code(empty) !== byId.H2.code && M.code(empty) === 'q0:');
      var two = build(['H', 'H', 'H', 'H'], [[0, 1, 1], [2, 3, 1]]);
      ok('⚠ 否定対照: H₂ が2つ（完成）は H₂ のお題と一致しない', M.judge(two.s).complete && !M.checkTarget(two.s, byId.H2).match);
      var sep = build(['O', 'H', 'H'], []);
      ok('⚠ 否定対照: H₂O の原子を置いただけでは一致しない', !M.checkTarget(sep.s, byId.H2O).match);
    })();

    section('モデル: 4 正準コード（置く順・結合する順によらない）');
    (function () {
      var a = build(['H', 'O', 'H'], [[1, 0, 1], [1, 2, 1]]);
      var b = build(['O', 'H', 'H'], [[0, 1, 1], [0, 2, 1]]);
      ok('H₂O を H→O→H と O→H→H で置いても同じコード', M.code(a.s) === M.code(b.s) && M.code(a.s) === byId.H2O.code);
      var allSame = true, where = '';
      molecules.forEach(function (spec) {
        for (var seed = 1; seed <= 6; seed++) {
          var p = permutedBuild(spec, seed * 31 + spec.atoms.length);
          if (p.bad.length || M.code(p.s) !== byId[spec.id].code) { allSame = false; where = spec.id + '#' + seed; }
        }
      });
      ok('お題' + molecules.length + '件 × 並べ替え6通りで、すべて同じコード' + (where ? '（' + where + ' で違う）' : ''), allSame);
      ok('コードは H も頂点にしている（H₂ のコードに H が2つ出る）', (byId.H2.code.match(/H\|/g) || []).length === 2);
      var ch = M.clone(b.s);
      ok('clone したものも同じコード（元と独立）', M.code(ch) === M.code(b.s) && ch.atoms[0] !== b.s.atoms[0]);
    })();

    section('モデル: 6 形を見る（中心 → まとまり → 配置 → 形・§3-4）');
    var shp = function (id, center) { return M.moleculeShape(M.fromSpec(molecules.filter(function (x) { return x.id === id; })[0]).state, center); };
    var elOf = function (id, r) { var b = M.fromSpec(molecules.filter(function (x) { return x.id === id; })[0]).state; return M.atomOf(b, r.center).el; };
    [
      ['CO2', 'C', 2, '直線', '直線形'],
      ['HCN', 'C', 2, '直線', '直線形'],
      ['H2O', 'O', 4, '正四面体', '折れ線形'],
      ['H2S', 'S', 4, '正四面体', '折れ線形'],
      ['NH3', 'N', 4, '正四面体', '三角錐形'],
      ['PH3', 'P', 4, '正四面体', '三角錐形'],
      ['CH4', 'C', 4, '正四面体', '正四面体形'],
      ['HCHO', 'C', 3, '平面正三角形', '平面正三角形'],
      ['C2H4', 'C', 3, '平面正三角形', '平面正三角形'],
      ['H2O2', 'O', 4, '正四面体', '折れ線形']
    ].forEach(function (t) {
      var r = shp(t[0]);
      ok(t[0] + ': 中心 ' + t[1] + ' → まとまり ' + t[2] + ' → ' + t[3] + 'の配置 → ' + t[4],
        !!r && elOf(t[0], r) === t[1] && r.domains === t[2] && r.arrangement === t[3] && r.shape === t[4] && !r.advanced);
    });
    ['H2', 'HCl', 'Cl2', 'O2', 'N2'].forEach(function (id) {
      var r = shp(id);
      ok(id + ': 原子が2個 → 数えずに「直線形」（中心もまとまりも無い）', !!r && r.twoAtoms && r.shape === '直線形' && r.center === null && r.domains === null);
    });
    ok('⚠ 否定対照: NH₃ の形は「正四面体形」ではない（配置と形の名前が別）', shp('NH3').shape !== '正四面体形' && shp('NH3').arrangement === '正四面体');
    ok('⚠ 否定対照: H₂O は原子が3個・結合2本でも「直線形」ではない（非共有電子対2組を数える）', shp('H2O').shape !== '直線形' && shp('H2O').domains === 4);
    ok('⚠ 否定対照: CO₂ の二重結合は2組と数えない（まとまり 2）', shp('CO2').domains === 2);
    (function () {
      var half = build(['O', 'H', 'H'], [[0, 1, 1]]);
      ok('⚠ 否定対照: 未完成の分子は形を出さない', M.moleculeShape(half.s) === null && M.shapeAt(half.s, half.ids[0]) === null);
      var two = build(['H', 'H', 'H', 'H'], [[0, 1, 1], [2, 3, 1]]);
      ok('⚠ 否定対照: 2つに分かれた分子は形を出さない', M.moleculeShape(two.s) === null);
    })();

    section('モデル: 6 中心は自動で決める（ユーザー決定）');
    (function () {
      var c = function (id) { var b = M.fromSpec(molecules.filter(function (x) { return x.id === id; })[0]).state; return { s: b, c: M.shapeCenters(b) }; };
      ok('NH₃・CH₄・HCHO・CO₂・HCN は中心の候補が1つ', ['NH3', 'CH4', 'HCHO', 'CO2', 'HCN'].every(function (id) { return c(id).c.length === 1; }));
      var e = c('C2H4');
      ok('C₂H₄ は候補が2つ（どちらも C）', e.c.length === 2 && e.c.every(function (id) { return M.atomOf(e.s, id).el === 'C'; }));
      var p = c('H2O2');
      ok('H₂O₂ は候補が2つ（どちらも O）', p.c.length === 2 && p.c.every(function (id) { return M.atomOf(p.s, id).el === 'O'; }));
      ok('中心を切り替えると、もう一方の C を中心に数える', M.moleculeShape(e.s, e.c[1]).center === e.c[1] && M.moleculeShape(e.s, e.c[1]).shape === '平面正三角形');
      ok('⚠ 候補に無い原子（H）を中心に指定しても候補の先頭に戻る', M.moleculeShape(e.s, M.atomOf(e.s, 3).id).center === e.c[0]);
      ok('原子が2個の分子は候補を出さない', c('N2').c.length === 0);
    })();

    section('モデル: 6 理想の向き（3D の座標）');
    (function () {
      var allUnit = [2, 3, 4, 5, 6].every(function (n) {
        return M.idealVectors(n).every(function (v) { return Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-9; });
      });
      ok('理想の向きはすべて単位ベクトル（2〜6）', allUnit);
      var pairs = function (vs) { var a = []; for (var i = 0; i < vs.length; i++) for (var j = i + 1; j < vs.length; j++) a.push(M.angleDeg(vs[i], vs[j])); return a; };
      ok('4: どの2本も 109.47°', pairs(M.idealVectors(4)).every(function (x) { return Math.abs(x - 109.47) < 0.01; }));
      ok('3: どの2本も 120°・同じ平面（z = 0）', pairs(M.idealVectors(3)).every(function (x) { return Math.abs(x - 120) < 1e-6; }) &&
        M.idealVectors(3).every(function (v) { return v[2] === 0; }));
      ok('2: 180°', Math.abs(M.angleDeg(M.idealVectors(2)[0], M.idealVectors(2)[1]) - 180) < 1e-6);
      var hcho = M.fromSpec(molecules.filter(function (x) { return x.id === 'HCHO'; })[0]).state;
      var g = M.shapeGeometry(hcho, M.shapeCenters(hcho)[0]);
      ok('HCHO: 二重結合の O が上（先に置く）・3本とも結合', g.length === 3 && g[0].kind === 'bond' && g[0].el === 'O' && g[0].v[1] === -1);
      var nh3 = M.fromSpec(molecules.filter(function (x) { return x.id === 'NH3'; })[0]).state;
      var gn = M.shapeGeometry(nh3, M.shapeCenters(nh3)[0]);
      ok('NH₃: 非共有電子対1つ（上）＋結合3本', gn.filter(function (x) { return x.kind === 'lp'; }).length === 1 && gn[0].kind === 'lp' && gn[0].v[1] === -1 &&
        gn.filter(function (x) { return x.kind === 'bond'; }).length === 3);
    })();
  }

  /* ================================================================
     node で走らせたとき: モデルのテストだけ
     ================================================================ */
  if (typeof module === 'object' && module.exports) {
    module.exports = { runModelTests: runModelTests };
    if (typeof require === 'function' && require.main === module) {
      var path = require('path'), fs = require('fs');
      var M = require(path.join(__dirname, 'model.js'));
      var mols = JSON.parse(fs.readFileSync(path.join(__dirname, 'molecules.json'), 'utf8'));
      var pass = 0, fail = 0;
      runModelTests(M, mols, function (name, cond) {
        if (cond) pass++; else { fail++; console.log('✘ ' + name); }
      }, function (t) { console.log('— ' + t); });
      console.log(fail === 0 ? 'ALL PASS (' + pass + ')' : fail + ' FAILED / ' + (pass + fail));
      process.exitCode = fail === 0 ? 0 : 1;
    }
    return;
  }

  /* ================================================================
     ブラウザ（test.html）
     ================================================================ */
  var pass = 0, fail = 0;
  var out = document.getElementById('results');
  function section(title) {
    var h = document.createElement('h3');
    h.textContent = title;
    out.appendChild(h);
  }
  function ok(name, cond) {
    var d = document.createElement('div');
    d.className = 'case ' + (cond ? 'pass' : 'fail');
    d.textContent = (cond ? '✔ ' : '✘ ') + name;
    out.appendChild(d);
    if (cond) pass++; else fail++;
  }
  function finish() {
    var total = document.getElementById('total');
    total.textContent = fail === 0 ? 'ALL PASS (' + pass + ')' : fail + ' FAILED / ' + (pass + fail);
    total.className = fail === 0 ? 'pass' : 'fail';
  }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var VER = (function () {
    var cur = document.currentScript && document.currentScript.src;
    var m = cur && /[?&]v=(\d+)/.exec(cur);
    return m ? m[1] : String(Date.now());
  })();

  // 使い捨ての iframe を開き、アプリが立ち上がるまで待つ
  function openApp(src, w, h) {
    return new Promise(function (resolve) {
      var f = document.createElement('iframe');
      f.style.cssText = 'position:absolute; left:-9999px; top:0; width:' + (w || 720) + 'px; height:' + (h || 800) + 'px; border:0;';
      f.src = src;
      document.body.appendChild(f);
      var t0 = Date.now();
      (function poll() {
        var win = f.contentWindow;
        var ready = false;
        try { ready = !!(win && win.ChemShape && win.ChemShape.app && win.ChemShape.app.state().ready); } catch (e) { /* 読み込み中 */ }
        if (ready) return resolve({ f: f, win: win, doc: win.document, app: win.ChemShape.app });
        if (Date.now() - t0 > 10000) return resolve({ f: f, win: null });
        setTimeout(poll, 30);
      })();
    });
  }
  function ptr(A, type, pt) {
    A.app.svg.dispatchEvent(new A.win.PointerEvent(type, {
      clientX: pt.x, clientY: pt.y, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true
    }));
  }
  function tap(A, id, side) {
    var pt = A.app.clientOf(id, side);
    ptr(A, 'pointerdown', pt);
    ptr(A, 'pointerup', pt);
  }
  function msg(A) { return A.doc.getElementById('msg').textContent; }
  function st(A) { return A.app.state(); }
  function bondOrder(A, x, y) {
    var b = A.win.ChemShape.model.bondBetween(st(A).mol, x, y);
    return b ? b.order : 0;
  }

  async function runUITests() {
    section('画面: 起動');
    var A = await openApp('index.html');
    ok('アプリが立ち上がる', !!A.win);
    if (!A.win) return;
    var pal = [].map.call(A.doc.querySelectorAll('#palette button'), function (b) { return b.textContent; });
    ok('原子のパレットは9つ（H・B・C・N・O・F・P・S・Cl）', pal.join(',') === 'H,B,C,N,O,F,P,S,Cl');
    ok('既定はお題 H₂ で、H が2つ置いてある', A.doc.getElementById('taskLabel').textContent.indexOf('H₂') === 0 && A.app.idsOf('H').length === 2);
    ok('電子式が既定（赤い点 2・H の不対電子）', A.doc.getElementById('dotMode').className === 'on' && A.doc.querySelectorAll('#board .e-un').length === 2);
    ok('はじめの声かけが1行で出る', /赤い点をタップ/.test(msg(A)));
    // パレットから置く
    A.doc.querySelector('#palette button[data-el="O"]').click();
    ok('パレットの O を押すと O が置かれ、赤 2・青 4 の点が増える',
      A.app.idsOf('O').length === 1 && A.doc.querySelectorAll('#board .e-un').length === 4 && A.doc.querySelectorAll('#board .e-lp').length === 4);
    A.doc.getElementById('undoBtn').click();
    ok('戻すで O が消える', A.app.idsOf('O').length === 0);
    A.f.remove();

    section('画面: 1・2 タップで結合し、完成を判定する（H₂O）');
    A = await openApp('index.html?m=H2O');
    var O = A.app.idsOf('O')[0], H = A.app.idsOf('H');
    tap(A, O, 1);
    ok('O の右の扇形をタップ → その側の不対電子が選ばれる', st(A).sel && st(A).sel.id === O && st(A).slots[O][st(A).sel.slot].ang === 0 &&
      !!A.doc.querySelector('#board .selWedge'));
    ok('声かけ「相手の原子をタップしよう」', /相手の原子/.test(msg(A)));
    tap(A, H[0]);
    ok('相手の H（不対電子1か所）は原子ごとのタップで結合できる', bondOrder(A, O, H[0]) === 1 && !st(A).sel);
    ok('共有電子対の黒い点が2個（1組）', A.doc.querySelectorAll('#board .e-sh').length === 2);
    var d = Math.hypot(st(A).pos[O].x - st(A).pos[H[0]].x, st(A).pos[O].y - st(A).pos[H[0]].y);
    ok('結合した H は O の隣へ置き直される（選んだ右の側）', Math.abs(d - 60) < 1 && st(A).pos[H[0]].x > st(A).pos[O].x);
    ok('未完成: 「手が余っています（不対電子 2 個）」（O に1・まだの H に1）', /手が余っています（不対電子 2 個）/.test(msg(A)));
    tap(A, O, 2); tap(A, H[1]);
    ok('完成: 「完成！ H₂O（水）ができた」', /完成！ H₂O（水）ができた/.test(msg(A)) && st(A).last.match === true);
    ok('電子式: 赤 0・青 4（O の非共有電子対2組）・黒 4', A.doc.querySelectorAll('#board .e-un').length === 0 &&
      A.doc.querySelectorAll('#board .e-lp').length === 4 && A.doc.querySelectorAll('#board .e-sh').length === 4);
    var num = A.doc.querySelector('#board .chkNum[data-id="' + O + '"]');
    ok('完成すると「確かめ」が出て、O は 8', A.doc.getElementById('checkBtn').className === 'on' && num && num.textContent === '8');
    A.doc.getElementById('undoBtn').click();
    ok('戻すで結合が1つ前にもどり、未完成に戻る', st(A).mol.bonds.length === 1 && /手が余っています/.test(msg(A)));
    A.f.remove();

    section('画面: 二重結合・三重結合（CO₂・N₂）と否定対照');
    A = await openApp('index.html?m=CO2');
    var C = A.app.idsOf('C')[0], Os = A.app.idsOf('O');
    tap(A, C, 1); tap(A, Os[0]);
    tap(A, C, 3); tap(A, Os[1]);
    ok('⚠ 否定対照: 単結合2本では未完成（手が余っています・不対電子 4 個）・お題と不一致',
      /手が余っています（不対電子 4 個）/.test(msg(A)) && st(A).last.match === false);
    tap(A, C); tap(A, Os[0]);
    ok('同じ2原子にもう一度 → 二重結合', bondOrder(A, C, Os[0]) === 2);
    tap(A, C); tap(A, Os[1]);
    ok('CO₂ 完成: O=C=O でお題と一致', bondOrder(A, C, Os[1]) === 2 && /完成！ CO₂/.test(msg(A)));
    var tagO = A.doc.querySelector('#board .chkNum[data-id="' + Os[0] + '"]'), tagC = A.doc.querySelector('#board .chkNum[data-id="' + C + '"]');
    ok('確かめ: C も O も 8', tagO && tagO.textContent === '8' && tagC && tagC.textContent === '8');
    A.doc.getElementById('lineMode').click();
    ok('構造式に切り替えると線が4本（二重結合2つ）・点は消える', A.doc.querySelectorAll('#board line.bond').length === 4 &&
      A.doc.querySelectorAll('#board circle.e-sh').length === 0);
    tap(A, C);
    ok('⚠ 不対電子の無い原子をタップ → 「この原子には不対電子がありません」', /不対電子がありません/.test(msg(A)) && !st(A).sel);
    A.f.remove();

    A = await openApp('index.html?m=N2');
    var N = A.app.idsOf('N');
    for (var i = 0; i < 3; i++) { tap(A, N[0]); tap(A, N[1]); }
    ok('N₂: 3回つなぐと三重結合で完成', bondOrder(A, N[0], N[1]) === 3 && /完成！ N₂/.test(msg(A)));
    A.f.remove();

    A = await openApp('index.html?m=C2H4');
    var Cs = A.app.idsOf('C');
    for (i = 0; i < 3; i++) { tap(A, Cs[0]); tap(A, Cs[1]); }
    ok('⚠ 否定対照: C≡C のあと4回目は「三重結合より多くはつくれません」', (function () {
      tap(A, Cs[0]); tap(A, Cs[1]);
      return bondOrder(A, Cs[0], Cs[1]) === 3 && /三重結合より多く/.test(msg(A));
    })());
    A.f.remove();

    section('画面: 電子式 ⇄ 構造式（同じ枠の2つの見え方・§3-1）');
    A = await openApp('index.html?m=NH3&mode=line');
    ok('?mode=line で構造式から始まる', A.doc.getElementById('lineMode').className === 'on');
    var hands = A.doc.querySelectorAll('#board line.hand').length;
    var un = st(A).mol.atoms.reduce(function (t, a) { return t + a.un; }, 0);
    ok('構造式の赤い手の数 ＝ 不対電子の数（N 3＋H 3 ＝ 6）', hands === 6 && un === 6);
    A.doc.getElementById('dotMode').click();
    ok('電子式に戻すと赤い点が同じ数（6）・青は N の1組', A.doc.querySelectorAll('#board .e-un').length === 6 &&
      A.doc.querySelectorAll('#board .e-lp').length === 2);
    var Nn = A.app.idsOf('N')[0];
    A.doc.getElementById('lineMode').click();
    tap(A, Nn, 1); tap(A, A.app.idsOf('H')[0]);
    ok('構造式のままでも同じタップで結合できる（入力は1系統）', st(A).mol.bonds.length === 1 && A.doc.querySelectorAll('#board line.bond').length === 1);
    A.f.remove();

    section('画面: タップと移動（8px・§3-2）');
    A = await openApp('index.html?m=H2', 375, 700);
    var h = A.app.idsOf('H');
    var p0 = A.app.clientOf(h[0]);
    var x0 = st(A).pos[h[0]].x;
    ptr(A, 'pointerdown', p0);
    ptr(A, 'pointermove', { x: p0.x + 30, y: p0.y });
    ptr(A, 'pointerup', { x: p0.x + 30, y: p0.y });
    ok('指が 30px 動いたら移動（選ばない）', !st(A).sel && st(A).pos[h[0]].x > x0 + 20);
    var p1 = A.app.clientOf(h[0]);
    ptr(A, 'pointerdown', p1);
    ptr(A, 'pointermove', { x: p1.x + 5, y: p1.y });
    ptr(A, 'pointerup', { x: p1.x + 5, y: p1.y });
    ok('5px の指ぶれはタップ（選ぶ）', !!st(A).sel && st(A).sel.id === h[0]);
    ptr(A, 'pointerdown', { x: 2, y: 2 }); ptr(A, 'pointerup', { x: 2, y: 2 });
    var b = A.app.svg.getBoundingClientRect();
    ptr(A, 'pointerdown', { x: b.left + 4, y: b.bottom - 4 }); ptr(A, 'pointerup', { x: b.left + 4, y: b.bottom - 4 });
    ok('何も無い所をタップすると選びが消える', !st(A).sel);
    // 的の大きさ: 375px 幅でも原子の中心から 20px 離れた所で当たる（直径 44px 以上）
    var c0 = A.app.clientOf(h[1]);
    ptr(A, 'pointerdown', { x: c0.x, y: c0.y + 20 }); ptr(A, 'pointerup', { x: c0.x, y: c0.y + 20 });
    ok('375px 幅: 原子の中心から 20px 下でも当たる（的は直径 44px 以上）', !!st(A).sel && st(A).sel.id === h[1]);
    A.f.remove();

    A = await openApp('index.html?m=NOPE');
    ok('⚠ 知らない ?m= は最初のお題で開き「そのお題はまだありません」', /まだありません/.test(msg(A)) && st(A).taskIdx === 0);
    A.f.remove();

    await runEmbedTests();
    await runShapeUITests();
    await runWidthTests();
  }

  /* ---- M2: 並べ方と形を見る ---- */
  function q(A, sel) { return A.app.shapeSvg.querySelector(sel); }
  function qa(A, sel) { return A.app.shapeSvg.querySelectorAll(sel); }
  function near(a, b, tol) { return Math.abs(a - b) < (tol || 1); }
  function anglesAround(A, c) {
    var s = st(A), M2 = A.win.ChemShape.model;
    var nb = M2.bondsOf(s.mol, c).map(function (b) { return b.a === c ? b.b : b.a; });
    var out = [];
    for (var i = 0; i < nb.length; i++) for (var j = i + 1; j < nb.length; j++) out.push(Math.round(A.app.angleAt(c, nb[i], nb[j])));
    return out.sort(function (x, y) { return x - y; });
  }

  async function runShapeUITests() {
    section('画面: 並べ方（結合角をできるだけ反映・ユーザー決定 2026-09-26）');
    var A = await openApp('index.html?m=H2O');
    var O = A.app.idsOf('O')[0], H = A.app.idsOf('H');
    ok('⚠ 否定対照: 未完成のうちは「形」を押せない', A.doc.getElementById('shapeViewBtn').disabled);
    tap(A, O, 1); tap(A, H[0]); tap(A, O, 2); tap(A, H[1]);
    var hoh = A.app.angleAt(O, H[0], H[1]);
    ok('H₂O: H−O−H は L 字（90°・まとまり4は十字）', near(hoh, 90));
    ok('⚠ 否定対照: H₂O を一直線（180°）に並べない', Math.abs(hoh - 180) > 30);
    var sl = st(A).slots[O];
    var angs = sl.map(function (x) { return x.ang; });
    var spread = true;
    for (var i = 0; i < angs.length; i++) for (var j = i + 1; j < angs.length; j++) {
      var d = Math.abs(((angs[i] - angs[j]) % 360 + 540) % 360 - 180);
      if (d < 89) spread = false;
    }
    ok('O の非共有電子対2組は空いた向き（4つの枠が十字で重ならない）', sl.length === 4 && spread &&
      sl.filter(function (x) { return x.k === 'p'; }).length === 2);
    var ids = st(A).mol.atoms.map(function (a) { return a.id; });
    var xs = ids.map(function (k) { return st(A).pos[k].x; }), ys = ids.map(function (k) { return st(A).pos[k].y; });
    ok('組み終えた分子は台の中央（上下も左右も）', near((Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, 200) &&
      near((Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2, 150));
    ok('完成すると「形」が押せる', !A.doc.getElementById('shapeViewBtn').disabled);
    A.doc.getElementById('shapeViewBtn').click();
    ok('「形」を押すと、台と同じ場所に形の画面が出る', st(A).view === 'shape' && A.app.svg.style.display === 'none' && A.app.shapeSvg.style.display === '');
    ok('形の画面: H₂O は「正四面体の配置 → 折れ線形」', q(A, '.arr').textContent === '正四面体の配置' && q(A, '.shp').textContent === '折れ線形');
    var hShape = A.app.shapeSvg.getBoundingClientRect().height;
    A.doc.getElementById('buildView').click();
    var hBoard = A.app.svg.getBoundingClientRect().height;
    ok('「組む」に戻れて、台と形の画面は同じ高さ（' + Math.round(hBoard) + 'px）', st(A).view === 'build' && hBoard > 100 && near(hShape, hBoard));
    A.f.remove();

    var cases = [
      ['H2O', 'O', [90], 'L 字（どちらの H も同じ向きを望んでも 180° にしない）'],
      ['H2S', 'S', [90], 'L 字'],
      ['NH3', 'N', [90, 90, 180], 'T 字（十字の3本）'],
      ['CH4', 'C', [90, 90, 90, 90, 180, 180], '十字 ✜'],
      ['CO2', 'C', [180], '一直線'],
      ['HCHO', 'C', [120, 120, 120], '120°'],
      ['C2H4', 'C', [120, 120, 120], '120°']
    ];
    for (var c = 0; c < cases.length; c++) {
      var t = cases[c];
      A = await openApp('index.html?m=' + t[0] + '&view=shape');
      var ctr = st(A).shape.center;
      var got = anglesAround(A, ctr);
      ok(t[0] + ': 中心 ' + t[1] + ' のまわりは' + t[3] + '（' + got.join('・') + '）',
        A.win.ChemShape.model.atomOf(st(A).mol, ctr).el === t[1] && got.join() === t[2].join());
      if (t[0] === 'C2H4') {
        var cs = A.app.idsOf('C'), other = cs[0] === ctr ? cs[1] : cs[0];
        ok('⚠ 否定対照: C₂H₄ の C を十字（90°）で並べない・もう一方の C も 120°',
          anglesAround(A, ctr).indexOf(90) < 0 && anglesAround(A, other).join() === '120,120,120');
      }
      A.f.remove();
    }
    A = await openApp('index.html?m=H2O2&view=shape');
    var Os = A.app.idsOf('O');
    ok('H₂O₂: どちらの O も十字（H−O−O は 90°）', anglesAround(A, Os[0]).join() === '90' && anglesAround(A, Os[1]).join() === '90');
    A.f.remove();

    section('画面: 形を見る（中心 → まとまり → 配置 → 形・§6 の 6）');
    var S = [
      ['CO2', 2, '直線', '直線形', 0, '180°'],
      ['H2O', 4, '正四面体', '折れ線形', 2, null],
      ['NH3', 4, '正四面体', '三角錐形', 1, null],
      ['CH4', 4, '正四面体', '正四面体形', 0, '109.5°'],
      ['HCHO', 3, '平面正三角形', '平面正三角形', 0, '120°']
    ];
    for (c = 0; c < S.length; c++) {
      var e = S[c];
      A = await openApp('index.html?m=' + e[0] + '&view=shape');
      A.app.stopSpin();
      var dom = q(A, '.dom'), lab = q(A, '.angLabel');
      ok(e[0] + ': まとまり ' + e[1] + ' → 「' + e[2] + 'の配置」と「' + e[3] + '」を別々に出す',
        st(A).view === 'shape' && !!dom && dom.textContent.indexOf('まとまり ' + e[1] + ' 組') >= 0 &&
        q(A, '.arr').textContent === e[2] + 'の配置' && q(A, '.shp').textContent === e[3]);
      ok(e[0] + ': 非共有電子対のふくらみ ' + e[4] + ' つ（模式図と立体の両方）・立体の結合相手 ' + (st(A).shape.bonded) + ' つ',
        qa(A, '.pane2d .lobe').length === e[4] && qa(A, '.pane3d .lobe').length === e[4] && qa(A, '.pane3d .ball').length === st(A).shape.bonded);
      if (e[5]) ok(e[0] + ': 結合角 ' + e[5] + ' を書く', !!lab && lab.textContent === e[5]);
      else ok('⚠ ' + e[0] + ': 非共有電子対があるので 109.5° を書かず「少し狭い」と文で言う', !lab && /109\.5° より少し狭い/.test(msg(A)));
      ok(e[0] + ': 中心の候補は1つ ＝ 切り替えのボタンは出さない', A.doc.getElementById('centerBtn').style.visibility === 'hidden');
      A.f.remove();
    }
    A = await openApp('index.html?m=H2&view=shape');
    ok('H₂: 原子が2個 → 数えずに「直線形」（まとまりは出さない）', st(A).view === 'shape' && q(A, '.shp').textContent === '直線形' &&
      !q(A, '.dom') && /原子が2個/.test(A.app.shapeSvg.textContent) && qa(A, '.pane3d .ball').length === 2);
    A.f.remove();

    section('画面: 中心は自動・候補が2つなら切り替え（ユーザー決定）');
    A = await openApp('index.html?m=C2H4&view=shape');
    var cb = A.doc.getElementById('centerBtn');
    var c0 = st(A).shape.center;
    ok('C₂H₄: 「もう一方の中心」が出る', cb.style.display === '' && cb.style.visibility === '');
    cb.click();
    ok('押すと、もう一方の C を中心に数える（平面正三角形のまま）', st(A).shape.center !== c0 &&
      A.win.ChemShape.model.atomOf(st(A).mol, st(A).shape.center).el === 'C' && q(A, '.shp').textContent === '平面正三角形');
    cb.click();
    ok('もう一度押すと最初の C に戻る', st(A).shape.center === c0);
    A.app.stopSpin();
    var r0 = st(A).rotY;
    var box = A.app.shapeSvg.getBoundingClientRect();
    var p0 = { x: box.left + box.width * 0.75, y: box.top + box.height * 0.6 };
    A.app.shapeSvg.dispatchEvent(new A.win.PointerEvent('pointerdown', { clientX: p0.x, clientY: p0.y, pointerId: 2, bubbles: true }));
    A.app.shapeSvg.dispatchEvent(new A.win.PointerEvent('pointermove', { clientX: p0.x + 40, clientY: p0.y, pointerId: 2, bubbles: true }));
    A.app.shapeSvg.dispatchEvent(new A.win.PointerEvent('pointerup', { clientX: p0.x + 40, clientY: p0.y, pointerId: 2, bubbles: true }));
    ok('立体はドラッグで回る', st(A).rotY > r0 + 0.2);
    ok('形の画面では原子のパレットは隠れる（場所は残す）', A.doc.getElementById('palette').style.visibility === 'hidden');
    A.f.remove();
    A = await openApp('index.html?m=H2O2&view=shape');
    ok('H₂O₂: 中心の候補は O が2つ（切り替えが出る）', st(A).shape.candidates.length === 2 && A.doc.getElementById('centerBtn').style.visibility === '');
    A.f.remove();
  }

  /* ---- 7 埋め込み（ion-equation/tests.js の REF7〜REF10 を写した）---- */
  async function runEmbedTests() {
    section('画面: 7 参考書への埋め込み（embed=1）');
    var heights = [];
    var onMsg = function (e) { if (e.data && e.data.type === 'slz-embed') heights.push({ src: e.source, data: e.data }); };
    window.addEventListener('message', onMsg);
    var mine = function (win) { return heights.filter(function (g) { return g.src === win; }); };
    try {
      var A = await openApp('index.html?m=H2O&embed=1&from=reference&page=covalent-bond', 375, 700);
      var d = A.doc, cs = function (x) { return A.win.getComputedStyle(x).display; };
      ok('embed=1: <html class="embed"> が付く', d.documentElement.classList.contains('embed'));
      var base = d.head.querySelector('base');
      ok('embed=1: <base target="_top">（href は付けない）', !!base && base.target === '_top' && !base.hasAttribute('href'));
      ok('embed=1: ヘッダーとフッターが見えない', cs(d.querySelector('header')) === 'none' && cs(d.querySelector('footer')) === 'none');
      ok('embed=1: from=reference でも「参考書へ戻る」の帯を作らない', !d.querySelector('.refBack'));
      var dummy = d.createElement('div'); dummy.className = 'refBack'; d.body.appendChild(dummy);
      ok('embed=1: 帯が万一出ても CSS で消える', cs(dummy) === 'none');
      dummy.remove();
      for (var i = 0; i < 60 && !mine(A.win).length; i++) await wait(50);
      var first = mine(A.win)[0];
      ok('embed=1: 高さの message が親に届く（{type, v:1, h}）', !!first && first.data.v === 1 && Number.isInteger(first.data.h) &&
        first.data.h > 0 && Object.keys(first.data).sort().join(',') === 'h,type,v');
      await wait(1000);
      var n = mine(A.win).length;
      await wait(600);
      var after = mine(A.win).map(function (g) { return g.data.h; });
      ok('embed=1: 1秒で止まり、同じ高さを2度送らない（発振しない）', after.length === n && new Set(after).size === after.length);
      // 操作しても（原子が増えても）高さは台の大きさで決まるので発振しない
      A.doc.querySelector('#palette button[data-el="C"]').click();
      await wait(400);
      var after2 = mine(A.win).map(function (g) { return g.data.h; });
      ok('embed=1: 原子を置いても高さが行ったり来たりしない', new Set(after2).size === after2.length);
      var hashes = [].map.call(d.querySelectorAll('a[href^="#"]'), function (a) { return a.getAttribute('href'); });
      ok('embed=1: ページ内リンク（a[href^="#"]）が無い', hashes.length === 0);
      var srcs = [].map.call(d.querySelectorAll('script[src]'), function (s) { return s.getAttribute('src'); })
        .filter(function (s) { return !/^(https?:)?\/\//.test(s); });
      var clean = srcs.length >= 2;
      for (var k = 0; k < srcs.length; k++) {
        var code = await (await fetch(srcs[k], { cache: 'no-store' })).text();
        if (/location\s*\.\s*href\s*=[^=]/.test(code) || /location\s*\.\s*(assign|replace)\s*\(/.test(code) || /window\s*\.\s*location\s*=[^=]/.test(code)) clean = false;
      }
      ok('embed=1: 読む js に location.href= などの遷移が無い（' + srcs.length + ' 本を見た）', clean);
      A.f.remove();

      // 形の画面（立体が自動で回り続ける）でも高さは止まる。組む ⇄ 形 を切り替えても高さが行ったり来たりしない
      var Sh = await openApp('index.html?m=NH3&view=shape&embed=1', 375, 700);
      for (i = 0; i < 60 && !mine(Sh.win).length; i++) await wait(50);
      await wait(900);
      var ns = mine(Sh.win).length;
      await wait(700);
      ok('embed=1・形の画面: 立体が回っていても高さの message が止まる', ns >= 1 && mine(Sh.win).length === ns && st(Sh).view === 'shape');
      Sh.doc.getElementById('buildView').click(); await wait(300);
      Sh.doc.getElementById('shapeViewBtn').click(); await wait(300);
      var hs2 = mine(Sh.win).map(function (g) { return g.data.h; });
      ok('embed=1: 組む ⇄ 形 を切り替えても同じ高さを2度送らない（' + hs2.join('→') + '）', new Set(hs2).size === hs2.length);
      Sh.f.remove();

      // 否定対照: embed が無ければ看板は在り・帯は出て・高さは送らない
      var B = await openApp('index.html?m=H2O&from=reference&page=covalent-bond', 375, 700);
      var bd = B.doc;
      ok('⚠ 否定対照: embed 無しなら class も <base> も無い', !bd.documentElement.classList.contains('embed') && !bd.head.querySelector('base'));
      ok('⚠ 否定対照: embed 無しならヘッダーが見える', B.win.getComputedStyle(bd.querySelector('header')).display !== 'none');
      var link = bd.querySelector('.refBack .refBackLink');
      ok('⚠ 否定対照: embed 無しで from=reference なら帯が出て参考書のページへ戻る',
        !!link && link.textContent === '← 参考書へ戻る' && /\/reference\/covalent-bond\/$/.test(new URL(link.href).pathname) && link.target === '_top');
      await wait(800);
      ok('⚠ 否定対照: embed 無しなら高さを送らない', mine(B.win).length === 0);
      B.f.remove();
    } finally {
      window.removeEventListener('message', onMsg);
    }
  }

  /* ---- 8 375px 幅・html/body の高さ ---- */
  var BAD_HEIGHT = /(^|[;{\s])(min-|max-)?height\s*:[^;}]*(\d(vh|dvh|svh|lvh)|%)/;
  var HTML_BODY = /(^|[\s,>+~])(html|body)(?![\w-])/;
  function badHtmlBodyHeights(css) {
    var out = [];
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    var re = /([^{}]+)\{([^{}]*)\}/g, m;
    while ((m = re.exec(css))) {
      var sel = m[1].trim();
      if (HTML_BODY.test(sel) && BAD_HEIGHT.test(m[2])) out.push(sel);
    }
    return out;
  }
  async function runWidthTests() {
    section('画面: 8 375px 幅・html/body の高さ');
    var sizes = ['index.html?m=C2H4', 'index.html?m=C2H4&embed=1', 'index.html?m=NH3&view=shape'];
    for (var i = 0; i < sizes.length; i++) {
      var A = await openApp(sizes[i], 375, 700);
      var de = A.doc.documentElement;
      ok('375px: 横スクロールが出ない（' + sizes[i] + '・' + de.scrollWidth + 'px）', de.scrollWidth <= 376);
      // 原子を並べ終えた盤でも（C₂H₄ を完成させて）はみ出さない
      if (i === 0) {
        var C = A.app.idsOf('C'), H = A.app.idsOf('H');
        tap(A, C[0]); tap(A, C[1]); tap(A, C[0]); tap(A, C[1]);
        H.forEach(function (h, k) { tap(A, C[k < 2 ? 0 : 1]); tap(A, h); });
        ok('375px: C₂H₄ を組み終えても横にはみ出さない・完成', de.scrollWidth <= 376 && /完成！ C₂H₄/.test(A.doc.getElementById('msg').textContent));
        var inside = A.app.state().mol.atoms.every(function (a) {
          var p = A.app.state().pos[a.id];
          return p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 300;
        });
        ok('置き直した原子はすべて台の中', inside);
        ok('html/body に style 属性の高さが無い', !BAD_HEIGHT.test(de.getAttribute('style') || '') && !BAD_HEIGHT.test(A.doc.body.getAttribute('style') || ''));
      }
      A.f.remove();
    }
    var css = await (await fetch('style.css?v=' + VER, { cache: 'no-store' })).text();
    var bad = badHtmlBodyHeights(css);
    ok('style.css: html/body に vh・% の高さが無い' + (bad.length ? '（' + bad.join(' / ') + '）' : ''), bad.length === 0);
    ok('⚠ 否定対照: 検査は「body { min-height: 100vh }」「html, body { height: 100% }」を見つける',
      badHtmlBodyHeights('body { min-height: 100vh; }').length === 1 && badHtmlBodyHeights('html, body { height: 100%; }').length === 1 &&
      badHtmlBodyHeights('.body-x { height: 100%; } main { height: 50vh; }').length === 0);
  }

  (async function main() {
    try {
      var mols = await (await fetch('molecules.json?v=' + VER, { cache: 'no-store' })).json();
      runModelTests(window.ChemShape.model, mols, ok, section);
      await runUITests();
    } catch (e) {
      ok('テストが例外で止まらない: ' + (e && e.stack || e), false);
    }
    finish();
  })();
})();
