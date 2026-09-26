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

    function build(atoms, bonds, unfold) {
      var s = M.create();
      var ids = atoms.map(function (el) { return M.addAtom(s, el); });
      var bad = [];
      (unfold || []).forEach(function (k) { if (!M.unfold(s, ids[k])) bad.push('unfold'); });
      bonds.forEach(function (t) {
        if (t[3] === 'dative') { var d = M.donate(s, ids[t[0]], ids[t[1]]); if (!d.ok) bad.push(d.reason); return; }
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
        if (t[3] === 'dative') return [inv[t[0]], inv[t[1]], t[2], 'dative']; // 配位結合は与える側・受け手の向きを変えない
        return (seed % 2) ? [inv[t[1]], inv[t[0]], t[2]] : [inv[t[0]], inv[t[1]], t[2]];
      });
      return build(atoms, bonds, (spec.unfold || []).map(function (k) { return inv[k]; }));
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

    section('モデル: ほどく（公開②・手の数の表）');
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
    // 公開②のお題だけは中心の電子の数が 8 でない（B 6・P 10・S 12）。ほかの原子は H 2・他 8
    var CENTER_COUNT = { BF3: ['B', 6], PCl5: ['P', 10], SF6: ['S', 12] };
    T.forEach(function (t) {
      var b = M.fromSpec(molecules.filter(function (x) { return x.id === t.id; })[0]);
      var cc = CENTER_COUNT[t.id];
      var inv = b.state.atoms.every(function (a) {
        var n = M.electronCount(b.state, a.id);
        if (cc && a.el === cc[0]) return n === cc[1];
        if (M.isMetal(a)) return M.tag(b.state, a.id).kind === 'metal'; // M5: 金属イオンは電子を数えない（札も付けない）
        return a.el === 'H' ? n === 2 : n === 8;
      });
      ok(t.id + ': 表どおりに組めて完成し、自分のコードと一致（' + (cc ? cc[0] + ' は' + cc[1] + '個・' : '') + (t.complex ? '金属イオンは数えない・' : '') + 'H は2個・他は8個）',
        !t.errors.length && M.judge(b.state).complete && M.checkTarget(b.state, t).match && inv);
    });
    ok('「発展」の札はオクテットに収まらないお題（BF₃・PCl₅・SF₆）と錯イオン（公開③）だけ', T.filter(function (t) { return t.advanced; }).map(function (t) { return t.id; }).join() === 'BF3,PCl5,SF6,ag-nh3-2,cu-nh3-4,zn-nh3-4,zn-oh-4,fe-cn-6');
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

    section('モデル: 5 配位結合（H⁺ ＝ 電子 0・空き1・§3-2・§4-2）');
    (function () {
      var n = build(['N', 'H', 'H', 'H'], [[0, 1, 1], [0, 2, 1], [0, 3, 1]]);
      var N = n.ids[0], s = n.s;
      var hp = M.addAtom(s, 'H+');
      var HP = M.atomOf(s, hp);
      ok('H⁺ は電子 0（不対電子 0・非共有電子対 0）・空き1・電荷 +1', HP.un === 0 && HP.lp === 0 && HP.vacancy === 1 && HP.charge === 1 && M.electronCount(s, hp) === 0);
      var before = M.moleculeShape(s);
      ok('配位する前: NH₃（＋ひとりの H⁺）は三角錐形', !!before && before.shape === '三角錐形' && before.domains === 4);
      var h0 = M.addAtom(s, 'H');
      ok('⚠ 否定対照: H⁺ は不対電子の相手にならない（H・N の不対電子とは結合できない）',
        !M.canBond(s, h0, hp).ok && M.canBond(s, h0, hp).reason === 'no-unpaired');
      s.atoms = s.atoms.filter(function (a) { return a.id !== h0; });
      var r = M.donate(s, N, hp);
      var b = M.bondBetween(s, N, hp);
      ok('NH₃ の N の非共有電子対 → H⁺ で配位結合（次数1）', r.ok && !!b && b.order === 1 && b.dative === true);
      ok('NH₄⁺: 電荷 +1・N の結合4本・N は 8個・H⁺ だった H は 2個', M.charge(s) === 1 && M.bondsOf(s, N).length === 4 &&
        M.electronCount(s, N) === 8 && M.electronCount(s, hp) === 2 && M.atomOf(s, N).lp === 0);
      ok('NH₄⁺ は完成（不対電子 0）・お題の NH₄⁺ と一致', M.judge(s).complete && M.checkTarget(s, byId['NH4+']).match);
      var after = M.moleculeShape(s);
      ok('配位した後: NH₄⁺ は正四面体形（手が1本増えて形が変わる）', after.shape === '正四面体形' && after.domains === 4 && after.lone === 0);
      ok('できた結合はふつうの結合と区別しない（4つの H が同じクラス ＝ H が4行とも同じラベル）',
        (M.code(s).match(/H\|0\|0\[c(\d+)\]/g) || []).filter(function (x, i, arr) { return x === arr[0]; }).length === 4);
      var n2 = build(['N', 'H', 'H', 'H'], [[0, 1, 1], [0, 2, 1], [0, 3, 1]]);
      var N2 = M.addAtom(s, 'N'); // 別の N（非共有電子対1組）を足して同じ H⁺ に2つ目を試す
      ok('⚠ 否定対照: H⁺ に2つ目は配位できない（空きは1つ）', !M.donate(s, N2, hp).ok && M.canDonate(s, N2, hp).reason === 'no-vacancy');
      ok('⚠ 否定対照: NH₄⁺ の N にはもう非共有電子対が無い', M.canDonate(s, N, M.addAtom(s, 'H+')).reason === 'no-pair');
      ok('⚠ 否定対照: 空きの無い原子（ふつうの H）には配位できない', M.canDonate(n2.s, n2.ids[0], n2.ids[1]).reason === 'no-vacancy');
    })();
    (function () {
      var w = build(['O', 'H', 'H', 'H+'], [[0, 1, 1], [0, 2, 1], [0, 3, 1, 'dative']]);
      var sh = M.moleculeShape(w.s);
      ok('H₂O＋H⁺ → H₃O⁺: 電荷 +1・O の結合3本・非共有電子対1組・8個・三角錐形', !w.bad.length && M.charge(w.s) === 1 &&
        M.bondsOf(w.s, w.ids[0]).length === 3 && M.atomOf(w.s, w.ids[0]).lp === 1 && M.electronCount(w.s, w.ids[0]) === 8 &&
        sh.shape === '三角錐形' && M.checkTarget(w.s, byId['H3O+']).match);
      var w0 = build(['O', 'H', 'H'], [[0, 1, 1], [0, 2, 1]]);
      ok('配位する前の H₂O は折れ線形', M.moleculeShape(w0.s).shape === '折れ線形');
      ok('⚠ 否定対照: NH₄⁺ と H₃O⁺ のコードは電荷を頭に持つ（q1:）・NH₃ とは違う', /^q1:/.test(byId['NH4+'].code) && byId['NH4+'].code !== byId.NH3.code);
      var loose = build(['N', 'H', 'H', 'H', 'H+'], [[0, 1, 1], [0, 2, 1], [0, 3, 1]]);
      var r = M.checkTarget(loose.s, byId['NH4+']);
      ok('⚠ 否定対照: NH₃ と H⁺ を並べただけでは NH₄⁺ と一致しない（空きが残っている）', !r.match && r.openVacancy === 1 && r.sameFormula);
    })();

    section('モデル: 公開② 電子不足・超原子価（§6・M4）');
    (function () {
      var sh = function (id) { return M.moleculeShape(M.fromSpec(molecules.filter(function (x) { return x.id === id; })[0]).state); };
      var bf = build(['B', 'F', 'F', 'F'], [[0, 1, 1], [0, 2, 1], [0, 3, 1]]);
      var tB = M.tag(bf.s, bf.ids[0]), sB = M.moleculeShape(bf.s);
      ok('BF₃: 不対電子 0 で完成・B は 6個「電子不足（発展）」・お題と一致', !bf.bad.length && M.judge(bf.s).complete &&
        tB.count === 6 && tB.kind === 'deficient' && tB.label === '電子不足（発展）' && M.checkTarget(bf.s, byId.BF3).match);
      ok('BF₃: まとまり 3 → 平面正三角形の配置 → 平面正三角形', sB.domains === 3 && sB.arrangement === '平面正三角形' && sB.shape === '平面正三角形' && sB.lone === 0);
      ok('⚠ BF₃ の F は 8個（オクテット）＝ 電子不足は B だけ', [1, 2, 3].every(function (k) { return M.tag(bf.s, bf.ids[k]).label === 'オクテット'; }));

      // PCl₅: ほどかないと P の手は3本 ＝ Cl が2つ余る
      var p3 = build(['P', 'Cl', 'Cl', 'Cl', 'Cl', 'Cl'], [[0, 1, 1], [0, 2, 1], [0, 3, 1]]);
      var r4 = M.canBond(p3.s, p3.ids[0], p3.ids[4]);
      ok('⚠ 否定対照: P をほどかないと4本目の Cl はつながらない（不対電子が無い）・未完成', !r4.ok && r4.reason === 'no-unpaired' &&
        !M.judge(p3.s).complete && M.judge(p3.s).leftover === 2 && !M.checkTarget(p3.s, byId.PCl5).match);
      ok('P をほどく: 非共有電子対 1→0・不対電子 0→2・手の数 3→5', M.unfold(p3.s, p3.ids[0]) && M.atomOf(p3.s, p3.ids[0]).lp === 0 &&
        M.atomOf(p3.s, p3.ids[0]).un === 2 && M.handsOf(p3.s, p3.ids[0]) === 5);
      M.bond(p3.s, p3.ids[0], p3.ids[4]); M.bond(p3.s, p3.ids[0], p3.ids[5]);
      var tP = M.tag(p3.s, p3.ids[0]);
      ok('PCl₅: 3本つないでからほどいても完成・P は 10個「超原子価（発展）」・お題と一致（ほどく順によらない）', M.judge(p3.s).complete &&
        tP.count === 10 && tP.kind === 'hyper' && M.checkTarget(p3.s, byId.PCl5).match);
      var sP = sh('PCl5');
      ok('PCl₅: まとまり 5 → 三方両錐の配置 → 三方両錐形（発展）', sP.domains === 5 && sP.arrangement === '三方両錐' && sP.shape === '三方両錐形' && sP.advanced && sP.lone === 0);

      // SF₆: 2組ほどく
      var s1 = build(['S', 'F', 'F', 'F', 'F', 'F', 'F'], [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]], [0]);
      ok('⚠ 否定対照: S を1組だけほどくと手は4本 ＝ 5本目の F はつながらない', !M.canBond(s1.s, s1.ids[0], s1.ids[5]).ok && M.handsOf(s1.s, s1.ids[0]) === 4);
      ok('S はもう1組ほどける（4→6）', M.canUnfold(s1.s, s1.ids[0]) && M.unfold(s1.s, s1.ids[0]) && M.handsOf(s1.s, s1.ids[0]) === 6);
      M.bond(s1.s, s1.ids[0], s1.ids[5]); M.bond(s1.s, s1.ids[0], s1.ids[6]);
      var tS = M.tag(s1.s, s1.ids[0]);
      ok('SF₆: 2組ほどいて完成・S は 12個「超原子価（発展）」・お題と一致', M.judge(s1.s).complete && tS.count === 12 && tS.kind === 'hyper' &&
        M.checkTarget(s1.s, byId.SF6).match && M.atomOf(s1.s, s1.ids[0]).unfold === 2);
      var sS = sh('SF6');
      ok('SF₆: まとまり 6 → 正八面体の配置 → 正八面体形（発展）', sS.domains === 6 && sS.arrangement === '正八面体' && sS.shape === '正八面体形' && sS.advanced);
      ok('⚠ SF₆ の S はもうほどけない（6 の先は無い）', !M.canUnfold(s1.s, s1.ids[0]));

      // 否定対照: N・O はほどけない（分子の中でも）
      var nh3 = M.fromSpec(molecules.filter(function (x) { return x.id === 'NH3'; })[0]).state;
      var h2o = M.fromSpec(molecules.filter(function (x) { return x.id === 'H2O'; })[0]).state;
      var nId = nh3.atoms.filter(function (a) { return a.el === 'N'; })[0].id, oId = h2o.atoms.filter(function (a) { return a.el === 'O'; })[0].id;
      ok('⚠ 否定対照: NH₃ の N・H₂O の O はほどけない（unfold しても何も変わらない）', !M.canUnfold(nh3, nId) && !M.unfold(nh3, nId) &&
        M.atomOf(nh3, nId).lp === 1 && !M.canUnfold(h2o, oId) && !M.unfold(h2o, oId) && M.atomOf(h2o, oId).lp === 2);
      ok('⚠ 否定対照: ほどいた P の分子（PCl₅）と、ほどかない形は別のコード（ラベルにほどいた数）', byId.PCl5.code.indexOf('P|0|1') >= 0);

      // 理想の向き（5・6）
      var pr = function (vs) { var a = []; for (var i = 0; i < vs.length; i++) for (var j = i + 1; j < vs.length; j++) a.push(Math.round(M.angleDeg(vs[i], vs[j]))); return a.sort(function (x, y) { return x - y; }); };
      ok('5（三方両錐）: 90° が6組・120° が3組・180° が1組', pr(M.idealVectors(5)).join() === '90,90,90,90,90,90,120,120,120,180');
      ok('6（正八面体）: 90° が12組・180° が3組', pr(M.idealVectors(6)).join() === '90,90,90,90,90,90,90,90,90,90,90,90,180,180,180');
      // ⚠ 超原子価に sp³d・sp³d² を付けない（§0・§3-7）。モデルのどこにも軌道の名前を持たない
      var src = JSON.stringify(Object.keys(M)) + JSON.stringify(M.SHAPE_NAME) + JSON.stringify(M.ARRANGEMENT);
      ok('⚠ モデルは超原子価に sp³d・sp³d² の札を持たない', !/sp3d|sp³d/.test(src));
    })();

    section('モデル: M6 結合角の縮み（§3-6・数値は教科書の実測値）');
    (function () {
      var withAngle = T.filter(function (t) { return t.bondAngle !== null; }).map(function (t) { return t.id + ':' + t.bondAngle; }).sort().join();
      ok('実測値（bondAngle）を持つのは CH₄ 109.5・NH₃ 106.7・H₂O 104.5 の3つだけ', withAngle === 'CH4:109.5,H2O:104.5,NH3:106.7');
      ok('⚠ H₃O⁺・PH₃・H₂S は数値を持たない（教科書に値が無い）', ['H3O+', 'PH3', 'H2S'].every(function (id) { return byId[id].bondAngle === null; }));
      var geo = function (id) {
        var s = M.fromSpec(molecules.filter(function (x) { return x.id === id; })[0]).state;
        return M.shapeGeometry(s, M.shapeCenters(s)[0]);
      };
      var bondPairs = function (items) {
        var b = items.filter(function (x) { return x.kind === 'bond'; }), out = [];
        for (var i = 0; i < b.length; i++) for (var j = i + 1; j < b.length; j++) out.push(M.angleDeg(b[i].v, b[j].v));
        return out;
      };
      var lpSame = function (a, b) {
        var la = a.filter(function (x) { return x.kind === 'lp'; }), lb = b.filter(function (x) { return x.kind === 'lp'; });
        return la.length === lb.length && la.every(function (x, i) { return x.v.join() === lb[i].v.join(); });
      };
      [['NH3', 106.7, 3], ['H2O', 104.5, 1]].forEach(function (c) {
        var g0 = geo(c[0]), g1 = M.squeezeGeometry(g0, byId[c[0]].bondAngle, 1);
        var ps = bondPairs(g1);
        ok(c[0] + ': アニメの終点の結合角が ' + c[1] + '°（' + c[2] + '組とも・' + ps.map(function (x) { return x.toFixed(2); }).join('・') + '）',
          ps.length === c[2] && ps.every(function (x) { return Math.abs(x - c[1]) < 0.01; }));
        ok(c[0] + ': 始点（t=0）は理想の 109.47°', bondPairs(M.squeezeGeometry(g0, c[1], 0)).every(function (x) { return Math.abs(x - 109.47) < 0.01; }));
        ok('⚠ ' + c[0] + ': 非共有電子対の向きは動かさない', lpSame(g0, g1) && lpSame(g0, M.squeezeGeometry(g0, c[1], 0.5)));
        var a25 = bondPairs(M.squeezeGeometry(g0, c[1], 0.25))[0], a50 = bondPairs(M.squeezeGeometry(g0, c[1], 0.5))[0], a75 = bondPairs(M.squeezeGeometry(g0, c[1], 0.75))[0];
        ok(c[0] + ': 途中は 109.5° から少しずつ狭くなる（戻らない）', 109.47 > a25 && a25 > a50 && a50 > a75 && a75 > c[1] - 1e-9);
        ok(c[0] + ': 結合の向きは単位ベクトルのまま', g1.every(function (x) { return Math.abs(Math.hypot(x.v[0], x.v[1], x.v[2]) - 1) < 1e-9; }));
        ok('⚠ ' + c[0] + ': 元の並び（shapeGeometry の結果）を書き換えない', bondPairs(g0).every(function (x) { return Math.abs(x - 109.47) < 0.01; }));
      });
      var gc = geo('CH4'), gc1 = M.squeezeGeometry(gc, byId.CH4.bondAngle, 1);
      ok('⚠ 対照: CH₄ は非共有電子対が無いので動かない（6組とも 109.47°・向きも同じ）', bondPairs(gc1).every(function (x) { return Math.abs(x - 109.47) < 0.01; }) &&
        gc1.every(function (x, i) { return x.v.join() === gc[i].v.join(); }));
      var n1 = bondPairs(M.squeezeGeometry(geo('NH3'), 106.7, 1))[0], w1 = bondPairs(M.squeezeGeometry(geo('H2O'), 104.5, 1))[0];
      ok('非共有電子対が多いほど狭い: CH₄ ＞ NH₃ ＞ H₂O', 109.47 > n1 && n1 > w1);
      ok('⚠ 終点の角は引数（データ）で決まる ＝ 模型は角度を計算しない（100° を渡せば 100°）',
        Math.abs(bondPairs(M.squeezeGeometry(geo('NH3'), 100, 1))[0] - 100) < 0.01);
    })();

    /* ---- 公開③（M5）: 錯イオン（§4-2・§6）---- */
    section('モデル: 公開③ 錯イオン（金属イオンの表・出来合いの配位子・電荷は和）');
    (function () {
      var spec = function (id) { return molecules.filter(function (x) { return x.id === id; })[0]; };
      var st5 = function (id) { return M.fromSpec(spec(id)).state; };
      var tb = M.METAL_ORDER.map(function (k) { var m = M.METALS[k]; return k + ':' + m.cn + ':' + m.shape; }).join();
      ok('金属イオンの表（§4-2）: Ag⁺ 2 直線形・Cu²⁺ 4 正方形・Zn²⁺ 4 正四面体形・Fe³⁺ 6 正八面体形',
        tb === 'Ag+:2:直線形,Cu2+:4:正方形,Zn2+:4:正四面体形,Fe3+:6:正八面体形');
      var s0 = M.create(), cu = M.addAtom(s0, 'Cu2+'), CU = M.atomOf(s0, cu);
      ok('Cu²⁺ は電子 0（不対電子・非共有電子対なし）・空き4（配位数）・電荷 +2', CU.un === 0 && CU.lp === 0 && CU.vacancy === 4 && CU.charge === 2 && M.isMetal(CU));
      var h0 = M.addAtom(s0, 'H');
      ok('⚠ 否定対照: 金属イオンは不対電子の相手にならない', !M.canBond(s0, h0, cu).ok);

      // 出来合いの配位子（ユーザー決定: パーツで置く）
      var p = M.create(), n = M.addAtom(p, 'NH3');
      ok('NH₃ のパーツ: N＋H 3つが組んである・N は非共有電子対1組・8個・完成', p.atoms.length === 4 && M.bondsOf(p, n).length === 3 &&
        M.atomOf(p, n).lp === 1 && M.electronCount(p, n) === 8 && M.judge(p).complete && M.charge(p) === 0);
      var q = M.create(), c = M.addAtom(q, 'CN-'), nN = q.atoms.filter(function (a) { return a.el === 'N'; })[0].id;
      ok('CN⁻ のパーツ: C≡N・C と N に非共有電子対1組ずつ・どちらも8個・電荷 −1', M.bondBetween(q, c, nN).order === 3 && M.atomOf(q, c).el === 'C' &&
        M.atomOf(q, c).lp === 1 && M.atomOf(q, nN).lp === 1 && M.electronCount(q, c) === 8 && M.electronCount(q, nN) === 8 && M.charge(q) === -1 && M.judge(q).complete);
      var o = M.create(), oh = M.addAtom(o, 'OH-');
      ok('OH⁻ のパーツ: O は非共有電子対3組・8個・電荷 −1', M.atomOf(o, oh).lp === 3 && M.electronCount(o, oh) === 8 && M.charge(o) === -1);
      var fe0 = M.addAtom(q, 'Fe3+');
      ok('⚠ 否定対照: CN⁻ の N の非共有電子対では配位しない（C で配位する）', M.canDonate(q, nN, fe0).reason === 'not-donor' && M.canDonate(q, c, fe0).ok);

      // [Cu(NH₃)₄]²⁺ ＝ 正方形（正四面体ではない）
      var cuS = st5('cu-nh3-4'), shCu = M.moleculeShape(cuS), cuId = cuS.atoms.filter(M.isMetal)[0].id;
      ok('[Cu(NH₃)₄]²⁺: 電荷 +2（2 ＋ 0×4）・配位数4・完成', M.charge(cuS) === 2 && M.bondsOf(cuS, cuId).length === 4 && M.judge(cuS).complete && M.openVacancy(cuS) === 0);
      ok('⚠⚠ [Cu(NH₃)₄]²⁺ の形は正方形（正四面体ではない）', !!shCu && shCu.complex && shCu.shape === '正方形' && shCu.shape !== '正四面体形');
      ok('⚠ 錯イオンは VSEPR を通さない（まとまりの数も配置の名前も持たない）', shCu.domains === null && shCu.arrangement === null && shCu.center === cuId);
      var gCu = M.shapeGeometry(cuS, cuId), prs = [];
      for (var i = 0; i < gCu.length; i++) for (var j = i + 1; j < gCu.length; j++) prs.push(Math.round(M.angleDeg(gCu[i].v, gCu[j].v)));
      ok('正方形の向き: 4本とも同じ平面（z = 0）・90° が4組・180° が2組', gCu.length === 4 && gCu.every(function (x) { return x.v[2] === 0; }) &&
        prs.sort(function (a, b) { return a - b; }).join() === '90,90,90,90,180,180');
      ok('立体の配位子の記号は「NH₃」（出来合いのパーツの名前）', gCu.every(function (x) { return x.el === 'NH₃' && x.kind === 'bond'; }));

      var agS = st5('ag-nh3-2'), shAg = M.moleculeShape(agS);
      ok('[Ag(NH₃)₂]⁺: 電荷 +1・直線形・中心は Ag（N の結合相手 4 のほうが多くても）', M.charge(agS) === 1 && shAg.shape === '直線形' &&
        M.atomOf(agS, shAg.center).el === 'Ag' && shAg.candidates.length === 1);
      var znS = st5('zn-nh3-4'), shZn = M.moleculeShape(znS);
      ok('[Zn(NH₃)₄]²⁺: 電荷 +2・正四面体形（同じ配位数4でも Cu と形が違う＝イオンごとの表）', M.charge(znS) === 2 && shZn.shape === '正四面体形' &&
        shCu.coordination === shZn.coordination && M.code(znS) !== M.code(cuS));
      var feS = st5('fe-cn-6'), shFe = M.moleculeShape(feS);
      ok('[Fe(CN)₆]³⁻: 電荷 −3（3 ＋ (−1)×6）・配位数6・正八面体形', M.charge(feS) === -3 && shFe.coordination === 6 && shFe.shape === '正八面体形');
      ok('[Zn(OH)₄]²⁻: 電荷 −2（2 ＋ (−1)×4）・正四面体形', M.charge(st5('zn-oh-4')) === -2 && M.moleculeShape(st5('zn-oh-4')).shape === '正四面体形');
      ok('錯イオンの金属イオンに電子の数の札を付けない（オクテット・電子不足と読ませない）', M.tag(cuS, cuId).kind === 'metal' && M.tag(cuS, cuId).label === null);

      // 配位数を超えては配位できない（否定対照）
      var extra = M.addAtom(cuS, 'NH3');
      ok('⚠ 否定対照: [Cu(NH₃)₄]²⁺ に5つ目の NH₃ は配位できない（配位数4）', M.canDonate(cuS, extra, cuId).reason === 'no-vacancy' && !M.donate(cuS, extra, cuId).ok &&
        M.bondsOf(cuS, cuId).length === 4);
      var ag3 = st5('ag-nh3-2'), agId = ag3.atoms.filter(M.isMetal)[0].id, n3 = M.addAtom(ag3, 'NH3');
      ok('⚠ 否定対照: [Ag(NH₃)₂]⁺ に3つ目は配位できない（配位数2）', !M.donate(ag3, n3, agId).ok);
      // 途中（配位数に届いていない）は形を出さない・お題と一致しない
      var part = M.create(), cu2 = M.addAtom(part, 'Cu2+');
      for (var k = 0; k < 3; k++) M.donate(part, M.addAtom(part, 'NH3'), cu2);
      ok('⚠ NH₃ が3つだけ: 空きが1つ残り、形は出さず、お題と一致しない', M.openVacancy(part) === 1 && M.moleculeShape(part) === null &&
        !M.checkTarget(part, byId['cu-nh3-4']).match);
      M.donate(part, M.addAtom(part, 'NH3'), cu2);
      ok('4つ目を配位すると一致・正方形', M.checkTarget(part, byId['cu-nh3-4']).match && M.moleculeShape(part).shape === '正方形');

      // ⚠⚠ NH₂−Ag と NH₃→Ag のコードが違う（§4-1 ① の再発防止）
      var a1 = M.create(), ag1 = M.addAtom(a1, 'Ag+'), nA = M.addAtom(a1, 'NH3');
      M.donate(a1, nA, ag1);
      // NH₂−Ag: N の不対電子1つと Ag がつながった形を手で作る（アプリの操作では作れない ＝ 型としての比較）
      var a2 = M.create(), ag2 = M.addAtom(a2, 'Ag+'), nB = M.addAtom(a2, 'N'), hb1 = M.addAtom(a2, 'H'), hb2 = M.addAtom(a2, 'H');
      M.bond(a2, nB, hb1); M.bond(a2, nB, hb2);
      M.atomOf(a2, nB).un--; a2.bonds.push({ a: nB, b: ag2, order: 1, dative: false, hint: null });
      ok('⚠⚠ NH₂−Ag と NH₃→Ag のコードが違う（H も頂点・非共有電子対の数もラベル）', M.code(a1) !== M.code(a2));
      // 対照: H を落として空き価標で見る（assembler の canonicalCode の見方）と、2つは見分けられない ＝ この検査は事故を捕まえられる
      var heavy = function (s) {
        return s.atoms.filter(function (a) { return a.el !== 'H'; }).map(function (a) {
          var used = M.bondsOf(s, a.id).filter(function (b) { return M.atomOf(s, b.a === a.id ? b.b : b.a).el !== 'H'; }).length;
          return a.el + ':' + used;
        }).sort().join();
      };
      ok('対照: H を落とした重原子だけの見方では NH₂−Ag と NH₃→Ag が同じになる（§4-1 ① の事故の形）', heavy(a1) === heavy(a2));
      // 自分で組んだ NH₃ でも、出来合いの NH₃ でも同じ錯イオン
      var self = M.create(), cu3 = M.addAtom(self, 'Cu2+');
      for (var m = 0; m < 4; m++) {
        var nn = M.addAtom(self, 'N');
        for (var h = 0; h < 3; h++) M.bond(self, nn, M.addAtom(self, 'H'));
        M.donate(self, nn, cu3);
      }
      ok('自分で組んだ NH₃ ×4 でも [Cu(NH₃)₄]²⁺ と一致（配位子の作り方によらない）', M.checkTarget(self, byId['cu-nh3-4']).match);
      ok('配位結合はふつうの結合と区別しない（Cu−N は次数1）', M.bondsOf(cuS, cuId).every(function (b) { return b.order === 1; }));
      // ⚠ 錯イオンに dsp²・d²sp³ を付けない（§0・§3-7）
      var src5 = JSON.stringify(M.METALS) + JSON.stringify(M.LIGANDS) + JSON.stringify(shCu) + JSON.stringify(shFe);
      ok('⚠ モデルは錯イオンに dsp²・d²sp³ の札を持たない', !/dsp|d²sp|d2sp|sp³d|sp3d/.test(src5));
      // 速さ: 錯イオンのコードは一瞬で出る（H 12個の並べ替えを探索しない）
      var t0 = Date.now();
      for (var r = 0; r < 20; r++) M.code(st5('cu-nh3-4'));
      ok('[Cu(NH₃)₄]²⁺ のコードを20回計算して 1 秒未満（' + (Date.now() - t0) + 'ms）', Date.now() - t0 < 1000);
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
    ok('パレットは9元素（H・B・C・N・O・F・P・S・Cl）＋ H⁺', pal.join(',') === 'H,B,C,N,O,F,P,S,Cl,H⁺');
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
    await runDativeUITests();
    await runAdvancedUITests();
    await runSqueezeUITests();
    await runComplexUITests();
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

  /* ---- M3: 配位結合（§6 の 5）---- */
  function slotOfKind(A, id, kind) {
    var sl = st(A).slots[id];
    for (var k = 0; k < sl.length; k++) if (sl[k].k === kind) return sl[k].ang;
    return null;
  }
  function tapAng(A, id, ang) {
    var pt = A.app.clientAtAng(id, ang);
    ptr(A, 'pointerdown', pt); ptr(A, 'pointerup', pt);
  }

  async function runDativeUITests() {
    section('画面: 5 配位結合（NH₃＋H⁺ → NH₄⁺・H₂O＋H⁺ → H₃O⁺）');
    var A = await openApp('index.html?m=NH4%2B');
    ok('?m=NH4%2B で NH₄⁺ のお題が開く（見出しに電荷）', A.doc.getElementById('taskLabel').textContent.indexOf('NH₄⁺（アンモニウムイオン）') === 0);
    var N = A.app.idsOf('N')[0], H = A.app.idsOf('H');
    var HP = st(A).mol.atoms.filter(function (a) { return a.part === 'H+'; })[0].id;
    var hs = H.filter(function (x) { return x !== HP; });
    ok('H⁺ は「H⁺」と書いて置かれる', !!A.doc.querySelector('#board .atom[data-id="' + HP + '"] .sym.part') &&
      A.doc.querySelector('#board .atom[data-id="' + HP + '"] .sym').textContent === 'H⁺');
    tap(A, HP);
    ok('⚠ H⁺ を先にタップしても選べない（電子をもたない）', !st(A).sel && /H⁺ は電子をもたない/.test(msg(A)));
    tapAng(A, N, slotOfKind(A, N, 'u')); tap(A, HP);
    ok('⚠ 否定対照: N の不対電子（赤）から H⁺ へはつながらない', st(A).mol.bonds.length === 0 && /H⁺ には青い対/.test(msg(A)));
    st(A).sel = null;
    hs.forEach(function (h) { tapAng(A, N, slotOfKind(A, N, 'u')); tap(A, h); }); // 赤い点をねらってタップ（H⁺ があると青も選べるので）
    ok('NH₃ まで組むと「H⁺ に青い対をわたそう」', st(A).mol.bonds.length === 3 && /H⁺ に青い対/.test(msg(A)) && st(A).last.match === false);
    ok('配位する前でも「形」が押せる（ひとりの H⁺ は形に入れない）', !A.doc.getElementById('shapeViewBtn').disabled);
    A.doc.getElementById('shapeViewBtn').click();
    A.app.stopSpin();
    ok('配位する前: NH₃ は「正四面体の配置 → 三角錐形」・「H⁺ にわたすと形が変わる」', A.app.shapeSvg.querySelector('.shp').textContent === '三角錐形' &&
      /形が変わる/.test(msg(A)));
    A.doc.getElementById('buildView').click();
    var lpAng = slotOfKind(A, N, 'p');
    tapAng(A, N, lpAng);
    ok('受け手が台にあると、N の青い対（非共有電子対）を選べる', !!st(A).sel && st(A).slots[N][st(A).sel.slot].k === 'p' && /わたす相手/.test(msg(A)));
    tap(A, HP);
    var b = A.win.ChemShape.model.bondBetween(st(A).mol, N, HP);
    ok('青い対 → H⁺ で配位結合ができる（次数1）', !!b && b.order === 1 && b.dative === true);
    ok('NH₄⁺: 電荷 +1・N の結合4本・N は 8個', A.win.ChemShape.model.charge(st(A).mol) === 1 &&
      A.win.ChemShape.model.bondsOf(st(A).mol, N).length === 4 && A.win.ChemShape.model.electronCount(st(A).mol, N) === 8);
    ok('完成: 「完成！ NH₄⁺（アンモニウムイオン）ができた」', /完成！ NH₄⁺（アンモニウムイオン）ができた/.test(msg(A)) && st(A).last.match === true);
    ok('イオンを [ ] でくくり、右上に「+」', !!A.doc.querySelector('#board .ionBracket') && A.doc.querySelector('#board .ionCharge').textContent === '+');
    var fresh = A.doc.querySelectorAll('#board .layer-bond circle.e-co');
    ok('できた直後は、その対だけ青（2個）・ほかの共有電子対は黒（6個）', fresh.length === 2 && A.doc.querySelectorAll('#board .layer-bond circle.e-sh').length === 6);
    await wait(700);
    ok('⚠ 0.7秒ではまだ青', A.doc.querySelectorAll('#board .layer-bond circle.e-co').length === 2);
    await wait(1600);
    var all = A.doc.querySelectorAll('#board .layer-bond circle');
    var black = [].every.call(all, function (c) { return A.win.getComputedStyle(c).fill === 'rgb(34, 34, 34)'; });
    ok('2秒後には黒（ふつうの共有電子対と区別がつかない・8個とも同じ色）', all.length === 8 &&
      A.doc.querySelectorAll('#board .layer-bond circle.e-co').length === 0 && black);
    A.doc.getElementById('shapeViewBtn').click();
    A.app.stopSpin();
    ok('配位した後: NH₄⁺ は「正四面体の配置 → 正四面体形」（手が1本増えて形が変わる）', A.app.shapeSvg.querySelector('.shp').textContent === '正四面体形' &&
      A.app.shapeSvg.querySelector('.arr').textContent === '正四面体の配置');
    A.f.remove();

    A = await openApp('index.html?m=NH4+');
    ok('?m=NH4+（「+」が空白に読まれる形）でも NH₄⁺ が開く', A.doc.getElementById('taskLabel').textContent.indexOf('NH₄⁺') === 0 && !/まだありません/.test(msg(A)));
    A.f.remove();

    A = await openApp('index.html?m=H3O%2B&view=shape');
    A.app.stopSpin();
    ok('H₃O⁺: 形の画面は「正四面体の配置 → 三角錐形」・電荷 +1', A.app.shapeSvg.querySelector('.shp').textContent === '三角錐形' &&
      A.win.ChemShape.model.charge(st(A).mol) === 1 && st(A).shape.domains === 4);
    A.doc.getElementById('buildView').click();
    ok('H₃O⁺ を組んだ姿: 完成・お題と一致・青の対は残っていない', /完成！ H₃O⁺/.test(msg(A)) && A.doc.querySelectorAll('#board circle.e-co').length === 0);
    A.f.remove();

    section('画面: 5 配位結合の否定対照');
    A = await openApp('index.html?m=H2O');
    var O = A.app.idsOf('O')[0];
    tapAng(A, O, slotOfKind(A, O, 'p'));
    ok('⚠ 受け手が台に無いときは、青い対のあたりをタップしても赤（不対電子）が選ばれる', !!st(A).sel && st(A).slots[O][st(A).sel.slot].k === 'u');
    st(A).sel = null;
    A.doc.querySelector('#palette button[data-el="H+"]').click();
    var hp = st(A).mol.atoms.filter(function (a) { return a.part === 'H+'; })[0].id;
    var Hs = A.app.idsOf('H').filter(function (x) { return x !== hp; });
    tapAng(A, O, slotOfKind(A, O, 'p')); tap(A, Hs[0]);
    ok('⚠ 青い対はふつうの H（空きが無い）にはわたせない', st(A).mol.bonds.length === 0 && /H⁺ にわたそう/.test(msg(A)));
    st(A).sel = null;
    Hs.forEach(function (h) { tapAng(A, O, slotOfKind(A, O, 'u')); tap(A, h); });
    tapAng(A, O, slotOfKind(A, O, 'p')); tap(A, hp);
    ok('H₂O ＋ H⁺ も配位できる（H₂O のお題とはちがう）', A.win.ChemShape.model.charge(st(A).mol) === 1 && st(A).mol.bonds.length === 3 && st(A).last.match === false);
    A.doc.querySelector('#palette button[data-el="N"]').click();
    var n2 = A.app.idsOf('N')[0];
    tapAng(A, n2, slotOfKind(A, n2, 'p') === null ? 0 : slotOfKind(A, n2, 'p'));
    tap(A, hp);
    ok('⚠ 否定対照: H⁺ に2つ目は配位できない（空きは1つ）', A.win.ChemShape.model.bondsOf(st(A).mol, hp).length === 1);
    A.f.remove();
  }

  /* ---- 公開②（M4）: 電子不足・超原子価（§6）---- */
  function vis(A, id) { var e = A.doc.getElementById(id); return e.style.display !== 'none' && A.win.getComputedStyle(e).display !== 'none'; }
  function atomG(A, id) { return A.doc.querySelector('#board .atom[data-id="' + id + '"]'); }
  function tagText(A) { return [].map.call(A.doc.querySelectorAll('#board .chkTag'), function (t) { return t.textContent; }).join(' / '); }

  async function runAdvancedUITests() {
    section('画面: 公開② 超原子価（PCl₅ ＝ P を1組ほどく）');
    var A = await openApp('index.html?m=PCl5');
    var M2 = A.win.ChemShape.model;
    var tl = A.doc.getElementById('taskLabel');
    ok('?m=PCl5 でお題が開き、見出しの後ろに「発展」の札', tl.textContent.indexOf('PCl₅（五塩化リン）') === 0 && !!tl.querySelector('.advBadge') &&
      tl.querySelector('.advBadge').textContent === '発展');
    ok('PCl₅ は構造式が既定（教科書は電子式を描かない・§3-5）', A.doc.getElementById('lineMode').className === 'on' && st(A).mode === 'line');
    var P = A.app.idsOf('P')[0], Cl = A.app.idsOf('Cl');
    ok('構造式でも P の「ほどける」青い対だけは出る（2個）・Cl の非共有電子対は出ない',
      atomG(A, P).querySelectorAll('.e-lp').length === 2 && Cl.every(function (c) { return atomG(A, c).querySelectorAll('.e-lp').length === 0; }));
    ok('はじめの声かけ: 「P の青い対をタップして「ほどく」」', /P の青い対をタップして「ほどく」/.test(msg(A)));
    ok('⚠ 何も選んでいないときは「ほどく」を出さない', !vis(A, 'unfoldBtn'));
    tapAng(A, P, slotOfKind(A, P, 'p'));
    ok('P の青い対をタップ → 対が選ばれ「ほどく」が出る', !!st(A).sel && st(A).slots[P][st(A).sel.slot].k === 'p' && vis(A, 'unfoldBtn') &&
      /「ほどく」を押すと/.test(msg(A)));
    var sub = A.doc.querySelector('.subBar').getBoundingClientRect().height;
    A.doc.getElementById('unfoldBtn').click();
    var Pa = M2.atomOf(st(A).mol, P);
    ok('「ほどく」→ P の非共有電子対 0・不対電子 5（赤い手 5本）', Pa.lp === 0 && Pa.un === 5 && Pa.unfold === 1 &&
      atomG(A, P).querySelectorAll('line.hand').length === 5 && atomG(A, P).querySelectorAll('.e-lp').length === 0);
    var angs = st(A).slots[P].map(function (x) { return x.ang; }).sort(function (a, b) { return a - b; });
    var gaps = angs.map(function (a, i) { return i ? a - angs[i - 1] : a + 360 - angs[angs.length - 1]; });
    ok('手が5本の P は放射状（72° おき）に置く（§3-5）', angs.length === 5 && gaps.every(function (g) { return Math.abs(g - 72) < 0.5; }));
    ok('声かけ「P の手が 5 本になった（オクテットを超える・発展）」・選びは消え「ほどく」も消える', /P の手が 5 本になった（オクテットを超える・発展）/.test(msg(A)) &&
      !st(A).sel && !vis(A, 'unfoldBtn'));
    ok('⚠ もうほどけない（P の手は 5 まで）: P をタップしても青い対は無い', (function () { tap(A, P); var r = st(A).sel && st(A).slots[P][st(A).sel.slot].k; st(A).sel = null; return r === 'u'; })());
    Cl.forEach(function (c) { tap(A, P); tap(A, c); });
    ok('Cl を5つつなぐと「完成！ PCl₅（五塩化リン）ができた」', /完成！ PCl₅（五塩化リン）ができた/.test(msg(A)) && st(A).last.match === true &&
      M2.bondsOf(st(A).mol, P).length === 5);
    ok('確かめ: P は 10・札「P は 10 個・超原子価（発展）」', A.doc.querySelector('#board .chkNum[data-id="' + P + '"]').textContent === '10' &&
      tagText(A) === 'P は 10 個・超原子価（発展）');
    ok('⚠ Cl には札を付けない（オクテット）・札は1行だけ', A.doc.querySelectorAll('#board .chkTag').length === 1);
    var inside = st(A).mol.atoms.every(function (a) { var p = st(A).pos[a.id]; return p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 300; });
    ok('5本の Cl は台の中に収まる', inside);
    A.doc.getElementById('shapeViewBtn').click();
    A.app.stopSpin();
    ok('形: 「中心 P・電子のまとまり 5 組」「三方両錐の配置 → 三方両錐形（発展）」', /中心 P・電子のまとまり 5 組/.test(A.app.shapeSvg.querySelector('.dom').textContent) &&
      A.app.shapeSvg.querySelector('.arr').textContent === '三方両錐の配置' && A.app.shapeSvg.querySelector('.shp').textContent === '三方両錐形（発展）');
    ok('形: 立体の Cl は 5つ・非共有電子対のふくらみは無い', qa(A, '.pane3d .ball').length === 5 && qa(A, '.lobe').length === 0);
    ok('⚠ 画面のどこにも sp³d・sp³d² が出ない（§0: 超原子価に付けない）', !/sp3d|sp³d/.test(A.doc.body.textContent + A.app.shapeSvg.textContent));
    A.doc.getElementById('buildView').click();
    A.f.remove();

    A = await openApp('index.html?m=PCl5');
    M2 = A.win.ChemShape.model;
    P = A.app.idsOf('P')[0]; Cl = A.app.idsOf('Cl');
    for (var k = 0; k < 3; k++) { tapAng(A, P, slotOfKind(A, P, 'u')); tap(A, Cl[k]); }
    ok('ほどく前に3本つなぐと「P の手が足りない。青い対を「ほどく」と2本増える」', /P の手が足りない。青い対を「ほどく」と2本増える/.test(msg(A)));
    tap(A, P);
    ok('手の無い P をタップすると青い対が選ばれる（原子ごとのタップでよい）', !!st(A).sel && st(A).slots[P][st(A).sel.slot].k === 'p' && vis(A, 'unfoldBtn'));
    A.doc.getElementById('unfoldBtn').click();
    ok('3本つないだあとでもほどける（手 2本が増える）', M2.atomOf(st(A).mol, P).un === 2 && st(A).slots[P].length === 5);
    tap(A, P); tap(A, Cl[3]); tap(A, P); tap(A, Cl[4]);
    ok('残りの Cl 2つで完成（ほどく順によらない）', st(A).last.match === true);
    A.doc.getElementById('undoBtn').click(); A.doc.getElementById('undoBtn').click(); A.doc.getElementById('undoBtn').click();
    ok('「戻す」でほどく前に戻る（P の手は3本・青い対1組）', M2.atomOf(st(A).mol, P).lp === 1 && M2.atomOf(st(A).mol, P).unfold === 0);
    A.f.remove();

    section('画面: 公開② 超原子価（SF₆ ＝ S を2組ほどく）');
    A = await openApp('index.html?m=SF6');
    M2 = A.win.ChemShape.model;
    var S = A.app.idsOf('S')[0], F = A.app.idsOf('F');
    tapAng(A, S, slotOfKind(A, S, 'p')); A.doc.getElementById('unfoldBtn').click();
    ok('1組ほどくと S の手は 4本', M2.handsOf(st(A).mol, S) === 4 && /S の手が 4 本/.test(msg(A)));
    tapAng(A, S, slotOfKind(A, S, 'p'));
    ok('S はもう1組ほどける（「ほどく」がまた出る）', vis(A, 'unfoldBtn'));
    A.doc.getElementById('unfoldBtn').click();
    ok('2組ほどくと S の手は 6本（赤い手 6本・60° おき）', M2.handsOf(st(A).mol, S) === 6 && atomG(A, S).querySelectorAll('line.hand').length === 6 &&
      st(A).slots[S].length === 6);
    F.forEach(function (f) { tap(A, S); tap(A, f); });
    ok('F を6つつなぐと「完成！ SF₆（六フッ化硫黄）ができた」・S は 12「超原子価（発展）」', /完成！ SF₆（六フッ化硫黄）ができた/.test(msg(A)) &&
      A.doc.querySelector('#board .chkNum[data-id="' + S + '"]').textContent === '12' && tagText(A) === 'S は 12 個・超原子価（発展）');
    A.f.remove();
    A = await openApp('index.html?m=SF6&view=shape');
    A.app.stopSpin();
    ok('SF₆ を形から: 「まとまり 6 組」「正八面体の配置 → 正八面体形（発展）」・F 6つ', /まとまり 6 組/.test(A.app.shapeSvg.querySelector('.dom').textContent) &&
      A.app.shapeSvg.querySelector('.arr').textContent === '正八面体の配置' && A.app.shapeSvg.querySelector('.shp').textContent === '正八面体形（発展）' &&
      qa(A, '.pane3d .ball').length === 6);
    var al = A.app.shapeSvg.querySelector('.angLabel');
    ok('SF₆: 模式図の角は 90°（十字の 180° の組を選ばない）', !!al && al.textContent === '90°');
    ok('⚠ SF₆ の画面にも sp³d² が出ない', !/sp3d|sp³d/.test(A.app.shapeSvg.textContent + msg(A)));
    A.f.remove();

    section('画面: 公開② 電子不足（BF₃）');
    A = await openApp('index.html?m=BF3');
    M2 = A.win.ChemShape.model;
    var B = A.app.idsOf('B')[0]; F = A.app.idsOf('F');
    ok('BF₃: 「発展」の札・電子式が既定', !!A.doc.querySelector('#taskLabel .advBadge') && st(A).mode === 'dot');
    F.forEach(function (f, i) { tapAng(A, B, [0, 180, 90][i]); tap(A, f); });
    ok('F を3つつなぐと「完成！ BF₃（三フッ化ホウ素）ができた」（B は 6個でも完成・不対電子 0）', /完成！ BF₃（三フッ化ホウ素）ができた/.test(msg(A)) &&
      st(A).last.match === true && M2.electronCount(st(A).mol, B) === 6);
    ok('確かめ: B は 6・札「B は 6 個・電子不足（発展）」', A.doc.querySelector('#board .chkNum[data-id="' + B + '"]').textContent === '6' &&
      tagText(A) === 'B は 6 個・電子不足（発展）');
    ok('BF₃ の B は3まとまり ＝ 台の上でも 120°', anglesAround(A, B).join() === '120,120,120');
    A.doc.getElementById('shapeViewBtn').click();
    A.app.stopSpin();
    ok('形: 「まとまり 3 組」「平面正三角形の配置 → 平面正三角形」・角 120°', /まとまり 3 組/.test(A.app.shapeSvg.querySelector('.dom').textContent) &&
      A.app.shapeSvg.querySelector('.shp').textContent === '平面正三角形' && A.app.shapeSvg.querySelector('.angLabel').textContent === '120°');
    A.f.remove();

    section('画面: 公開② の否定対照（N・O はほどけない・公開①のお題では出さない）');
    A = await openApp('index.html?m=NH3');
    var N = A.app.idsOf('N')[0];
    tapAng(A, N, slotOfKind(A, N, 'p'));
    ok('⚠ NH₃ の N の青い対のあたりをタップ → 赤が選ばれ、「ほどく」は出ない', !!st(A).sel && st(A).slots[N][st(A).sel.slot].k === 'u' && !vis(A, 'unfoldBtn'));
    A.f.remove();
    A = await openApp('index.html?m=H2S');
    var Sx = A.app.idsOf('S')[0];
    tapAng(A, Sx, slotOfKind(A, Sx, 'p'));
    ok('⚠ 公開①のお題（H₂S）では S の青い対を触っても「ほどく」を出さない（赤が選ばれる）', !!st(A).sel && st(A).slots[Sx][st(A).sel.slot].k === 'u' && !vis(A, 'unfoldBtn'));
    A.f.remove();
    A = await openApp('index.html');
    A.doc.getElementById('freeMode').click();
    ['N', 'O', 'P', 'H+'].forEach(function (e) { A.doc.querySelector('#palette button[data-el="' + e + '"]').click(); });
    var Nf = A.app.idsOf('N')[0], Of = A.app.idsOf('O')[0], Pf = A.app.idsOf('P')[0];
    tapAng(A, Nf, slotOfKind(A, Nf, 'p'));
    ok('⚠ 自由・H⁺ あり: N の青い対は選べる（配位のため）が「ほどく」は出ない', !!st(A).sel && st(A).slots[Nf][st(A).sel.slot].k === 'p' && !vis(A, 'unfoldBtn'));
    A.doc.getElementById('unfoldBtn').click();
    ok('⚠ 隠れた「ほどく」を押しても N は変わらない（非共有電子対 1）', A.win.ChemShape.model.atomOf(st(A).mol, Nf).lp === 1);
    st(A).sel = null;
    tapAng(A, Of, slotOfKind(A, Of, 'p'));
    ok('⚠ 自由: O の青い対でも「ほどく」は出ない', !!st(A).sel && st(A).slots[Of][st(A).sel.slot].k === 'p' && !vis(A, 'unfoldBtn'));
    st(A).sel = null;
    tapAng(A, Pf, slotOfKind(A, Pf, 'p'));
    ok('自由: P の青い対なら「ほどく」が出る（H⁺ があれば「H⁺ をタップ」も言う）', vis(A, 'unfoldBtn') && /「ほどく」を押すか/.test(msg(A)));
    A.f.remove();

    section('画面: 公開② 375px 幅');
    A = await openApp('index.html?m=PCl5', 375, 700);
    P = A.app.idsOf('P')[0];
    var h0 = A.doc.querySelector('.subBar').getBoundingClientRect().height;
    tapAng(A, P, slotOfKind(A, P, 'p'));
    var h1 = A.doc.querySelector('.subBar').getBoundingClientRect().height;
    ok('375px: 「ほどく」が出ても下の段は1行のまま（' + Math.round(h0) + '→' + Math.round(h1) + 'px）', vis(A, 'unfoldBtn') && near(h0, h1));
    A.doc.getElementById('unfoldBtn').click();
    A.app.idsOf('Cl').forEach(function (c) { tap(A, P); tap(A, c); });
    ok('375px: PCl₅ を組み終えても横スクロールが出ない・完成（' + A.doc.documentElement.scrollWidth + 'px）',
      A.doc.documentElement.scrollWidth <= 376 && st(A).last.match === true);
    var tb = A.doc.querySelector('.taskBar'), nb = A.doc.getElementById('nextTask');
    ok('375px: 「発展」の札がついても ◀ お題 ▶ は1行（▶ が次の行へ落ちない）', Math.abs(nb.getBoundingClientRect().top - A.doc.getElementById('prevTask').getBoundingClientRect().top) < 2 &&
      tb.getBoundingClientRect().right <= 376);
    A.f.remove();
    A = await openApp('index.html?m=SF6&view=shape', 375, 700);
    ok('375px: SF₆ の形の画面で横スクロールが出ない', A.doc.documentElement.scrollWidth <= 376);
    A.f.remove();
  }

  /* ---- M6: 結合角の縮み（§3-6・§6）---- */
  async function squeezeDone(A) {
    for (var i = 0; i < 100 && (A.app.squeezing() || st(A).sq.t < 1); i++) await wait(40);
  }
  function bondAngles(A) {
    var M2 = A.win.ChemShape.model, b = A.app.shapeItems().filter(function (x) { return x.kind === 'bond'; }), out = [];
    for (var i = 0; i < b.length; i++) for (var j = i + 1; j < b.length; j++) out.push(M2.angleDeg(b[i].v, b[j].v));
    return out;
  }
  function lpVecs(A) { return A.app.shapeItems().filter(function (x) { return x.kind === 'lp'; }).map(function (x) { return x.v.map(function (n) { return n.toFixed(9); }).join(); }).join('|'); }
  // 模式図の紙面の2本（H−X−H）の角を、描いた字の位置から測る
  function drawnAngle(A) {
    var hs = qa(A, '.pane2d .sqAtom'), c = q(A, '.pane2d .center');
    if (hs.length !== 2 || !c) return null;
    var cx = +c.getAttribute('x'), cy = +c.getAttribute('y');
    var a = [].map.call(hs, function (h) { return Math.atan2(+h.getAttribute('y') - cy, +h.getAttribute('x') - cx); });
    var d = Math.abs(a[0] - a[1]) * 180 / Math.PI;
    return d > 180 ? 360 - d : d;
  }
  function lobeRx(A) { var l = q(A, '.pane3d .lobe'); return l ? +l.getAttribute('rx') : 0; }

  async function runSqueezeUITests() {
    section('画面: M6 結合角の縮み（NH₃ ＝ 109.5° → 106.7°）');
    var A = await openApp('index.html?m=NH3&view=shape');
    A.app.stopSpin();
    var sb = A.doc.getElementById('squeezeBtn');
    ok('NH₃ の形の画面に「反発で縮める」と、見比べる CH₄・NH₃・H₂O（NH₃ が選ばれている）', vis(A, 'squeezeBtn') && sb.textContent === '反発で縮める' &&
      vis(A, 'cmpSeg') && A.doc.querySelector('#cmpSeg button.on').getAttribute('data-m') === 'NH3');
    ok('押す前は M2 のまま（数値を書かず「109.5° より少し狭い」）', !q(A, '.sqLabel') && !q(A, '.angLabel') && /109\.5° より少し狭い/.test(msg(A)));
    var lp0 = lpVecs(A), rx0 = lobeRx(A);
    sb.click();
    await wait(150);
    ok('押した直後はアニメの途中 ＝ 数値はまだ出さない（途中の角を数え上げない）', A.app.squeezing() && st(A).sq.t < 1 && !q(A, '.sqLabel'));
    await squeezeDone(A);
    var an = bondAngles(A);
    ok('アニメの終点: 立体の H−N−H が3組とも 106.7°（' + an.map(function (x) { return x.toFixed(2); }).join('・') + '）',
      an.length === 3 && an.every(function (x) { return Math.abs(x - 106.7) < 0.01; }));
    var dA = drawnAngle(A);
    ok('模式図の紙面の2本も 106.7°（立体と同じ角・' + (dA && dA.toFixed(2)) + '°）', dA !== null && Math.abs(dA - 106.7) < 0.05);
    ok('模式図に角の弧と「106.7°」', !!q(A, '.pane2d .sqArc') && q(A, '.sqLabel').textContent === '106.7°');
    ok('画面に「数値は教科書の実測値」と書く（模型が計算した値ではない）', /数値は教科書の実測値/.test(q(A, '.sqCap').textContent));
    ok('⚠ 非共有電子対の向きは動かない', lpVecs(A) === lp0 && lp0.length > 0);
    ok('非共有電子対のふくらみは縮めるあいだに膨らむ（' + rx0 + '→' + lobeRx(A) + '）', lobeRx(A) > rx0 * 1.2);
    ok('理想の 109.5° の位置を薄い破線で残す（模式図2本・立体3本）', qa(A, '.pane2d .ghost').length === 2 && qa(A, '.pane3d .ghost').length === 3);
    ok('声かけ「非共有電子対が結合を押しのけ、少し狭くなる」・ボタンは「もとに戻す」', /押しのけ、少し狭くなる/.test(msg(A)) && sb.textContent === 'もとに戻す');
    ok('⚠ 画面のどこにも「計算」と言わない・軌道の言葉（sp³）を出さない', !/計算|sp³|sp3/.test(A.app.shapeSvg.textContent + msg(A)));
    // 並べ替え: H₂O へ（縮めた状態のまま切り替えると、もう一度縮める）
    A.doc.querySelector('#cmpSeg button[data-m="H2O"]').click();
    ok('見比べる H₂O を押すと H₂O の形の画面へ（縮めた状態を保ってもう一度縮める）', st(A).view === 'shape' && st(A).sqInfo.id === 'H2O' && st(A).sq.on);
    await squeezeDone(A);
    var aw = bondAngles(A);
    ok('H₂O: 終点の H−O−H が 104.5°・数値「104.5°」', aw.length === 1 && Math.abs(aw[0] - 104.5) < 0.01 && q(A, '.sqLabel').textContent === '104.5°' &&
      Math.abs(drawnAngle(A) - 104.5) < 0.05);
    ok('H₂O: 非共有電子対は2組とも動かない・声かけ「2組で、さらに狭くなる」', lpVecs(A) === lpVecs({ app: { shapeItems: function () {
      var M2 = A.win.ChemShape.model; return M2.shapeGeometry(st(A).mol, st(A).shape.center); } } }) && /2組で、さらに狭くなる/.test(msg(A)));
    A.doc.querySelector('#cmpSeg button[data-m="CH4"]').click();
    await squeezeDone(A);
    var ac = bondAngles(A);
    ok('⚠ 対照: CH₄ は動かない（6組とも 109.47°）・数値は「109.5°」・破線を出さない', ac.length === 6 && ac.every(function (x) { return Math.abs(x - 109.47) < 0.01; }) &&
      q(A, '.sqLabel').textContent === '109.5°' && qa(A, '.ghost').length === 0 && /109\.5° のまま/.test(msg(A)));
    ok('並べると CH₄ 109.5 ＞ NH₃ 106.7 ＞ H₂O 104.5（非共有電子対が多いほど狭い）', 109.5 > 106.7 && Math.max.apply(null, ac) > an[0] && an[0] > aw[0]);
    A.doc.getElementById('squeezeBtn').click();
    ok('「もとに戻す」で M2 の模式図に戻る（縮めた図・数値・破線が消える）', !st(A).sq.on && st(A).sq.t === 0 && !q(A, '.sqLabel') && qa(A, '.ghost').length === 0 &&
      A.doc.getElementById('squeezeBtn').textContent === '反発で縮める');
    A.doc.getElementById('buildView').click();
    ok('「組む」に戻るとボタンは消え、縮めた状態も捨てる', !vis(A, 'squeezeBtn') && !vis(A, 'cmpSeg') && !st(A).sq.on);
    A.f.remove();

    section('画面: M6 の否定対照（実測値の無い分子には数値を出さない）');
    var none = ['H3O%2B', 'PH3', 'H2S', 'H2O2', 'HCHO'];
    for (var i = 0; i < none.length; i++) {
      A = await openApp('index.html?m=' + none[i] + '&view=shape');
      A.app.stopSpin();
      ok('⚠ ' + decodeURIComponent(none[i]) + ': 「反発で縮める」も見比べる3つも出さない・角度の数値を作らない', st(A).view === 'shape' && !vis(A, 'squeezeBtn') &&
        !vis(A, 'cmpSeg') && !q(A, '.sqLabel') && !/10[0-8]\.\d°/.test(A.app.shapeSvg.textContent));
      if (i < 3) ok('⚠ ' + decodeURIComponent(none[i]) + ': 文だけで「109.5° より少し狭い」', /109\.5° より少し狭い/.test(msg(A)));
      A.f.remove();
    }

    section('画面: M6 の 375px・埋め込み');
    A = await openApp('index.html?m=NH3&view=shape', 375, 700);
    A.app.stopSpin();
    var sub = A.doc.querySelector('.subBar');
    var btns = [A.doc.getElementById('squeezeBtn')].concat([].slice.call(A.doc.querySelectorAll('#cmpSeg button')));
    ok('375px: 「反発で縮める」と CH₄・NH₃・H₂O が1行に並ぶ', btns.every(function (b) { return Math.abs(b.getBoundingClientRect().top - btns[0].getBoundingClientRect().top) < 2; }) &&
      sub.getBoundingClientRect().height < 45);
    A.doc.getElementById('squeezeBtn').click();
    await squeezeDone(A);
    ok('375px: 縮めた画面でも横スクロールが出ない（' + A.doc.documentElement.scrollWidth + 'px）・声かけは1行', A.doc.documentElement.scrollWidth <= 376 &&
      A.doc.getElementById('msg').getBoundingClientRect().height < 30);
    A.f.remove();
    A = await openApp('index.html?m=NH3&view=shape&embed=1', 375, 700);
    A.app.stopSpin();
    var h0 = A.doc.documentElement.getBoundingClientRect().height;
    A.doc.getElementById('squeezeBtn').click();
    await squeezeDone(A);
    var h1 = A.doc.documentElement.getBoundingClientRect().height;
    A.doc.getElementById('buildView').click();
    var h2 = A.doc.documentElement.getBoundingClientRect().height;
    ok('embed=1: 縮めても・組むへ戻っても高さが変わらない（' + [h0, h1, h2].map(Math.round).join('→') + '）', near(h0, h1) && near(h0, h2));
    A.f.remove();
  }

  /* ---- 公開③（M5）: 錯イオン（§4-2・§6）---- */
  function metalId(A) { return st(A).mol.atoms.filter(function (a) { return A.win.ChemShape.model.isMetal(a); })[0].id; }
  function textsOf(A, sel) { return [].map.call(A.doc.querySelectorAll(sel), function (t) { return t.textContent; }); }

  async function runComplexUITests() {
    section('画面: 公開③ 錯イオン（[Cu(NH₃)₄]²⁺ ＝ 青い対 → Cu²⁺・形は正方形）');
    var A = await openApp('index.html?m=cu-nh3-4');
    var M2 = A.win.ChemShape.model;
    var tl = A.doc.getElementById('taskLabel');
    ok('?m=cu-nh3-4 でお題が開き、見出しの後ろに「発展」の札', tl.textContent.indexOf('[Cu(NH₃)₄]²⁺（テトラアンミン銅(Ⅱ)イオン）') === 0 && !!tl.querySelector('.advBadge'));
    ok('2段目のパレット: 金属イオン4種と出来合いの配位子4種', vis(A, 'palette2') &&
      textsOf(A, '#palette2 button').join(',') === 'Ag⁺,Cu²⁺,Zn²⁺,Fe³⁺,NH₃,H₂O,OH⁻,CN⁻');
    var cu = metalId(A), Ns = A.app.idsOf('N');
    ok('盤: Cu²⁺ が1つ（「Cu²⁺」と書く）・NH₃ のパーツが4つ（組んだ姿: N 4・H 12・N の結合3本ずつ）',
      atomG(A, cu).querySelector('.sym').textContent === 'Cu²⁺' && Ns.length === 4 && A.app.idsOf('H').length === 12 &&
      Ns.every(function (n) { return M2.bondsOf(st(A).mol, n).length === 3; }));
    ok('盤は広く取る（viewBox 560×420・同じ 4:3）', A.app.svg.getAttribute('viewBox') === '0 0 560 420');
    ok('はじめの声かけ「配位子の青い対を Cu²⁺ にわたそう（あと 4 か所）」・確かめの丸はまだ出さない',
      msg(A) === '配位子の青い対を Cu²⁺ にわたそう（あと 4 か所）' && !st(A).check && A.doc.getElementById('shapeViewBtn').disabled);
    tap(A, cu);
    ok('⚠ Cu²⁺ を先にタップしても選べない（受け取る側）', !st(A).sel && /Cu²⁺ は受け取る側/.test(msg(A)));
    tap(A, Ns[0]);
    ok('NH₃ の N をタップ → 青い対（非共有電子対）が選ばれる・「わたす相手（Cu²⁺）」', !!st(A).sel && st(A).slots[Ns[0]][st(A).sel.slot].k === 'p' &&
      /わたす相手（Cu²⁺）/.test(msg(A)));
    tap(A, cu);
    var b = M2.bondBetween(st(A).mol, Ns[0], cu);
    ok('青い対 → Cu²⁺ で配位結合（次数1）・あと 3 か所', !!b && b.order === 1 && b.dative === true && /あと 3 か所/.test(msg(A)) &&
      M2.atomOf(st(A).mol, cu).vacancy === 3);
    ok('できた直後は、その対だけ青（2個）', A.doc.querySelectorAll('#board .layer-bond circle.e-co').length === 2);
    ok('配位数に届いていないあいだは「形」を押せない', A.doc.getElementById('shapeViewBtn').disabled);
    Ns.slice(1).forEach(function (n) { tap(A, n); tap(A, cu); });
    ok('4つ配位すると「完成！ [Cu(NH₃)₄]²⁺ ができた」（名前は見出しにあるので化学式だけ・375px で1行）', msg(A) === '完成！ [Cu(NH₃)₄]²⁺ ができた' &&
      st(A).last.match === true && M2.bondsOf(st(A).mol, cu).length === 4);
    ok('電荷は和: 全体を [ ] でくくり右上に「2+」（Cu²⁺ ＋ NH₃ 0×4）', M2.charge(st(A).mol) === 2 && textsOf(A, '#board .ionCharge').join() === '2+' &&
      A.doc.querySelectorAll('#board .ionBracket').length === 1);
    ok('確かめ: N は 8・H は 2・金属イオンには数を付けない', !A.doc.querySelector('#board .chkNum[data-id="' + cu + '"]') &&
      Ns.every(function (n) { return A.doc.querySelector('#board .chkNum[data-id="' + n + '"]').textContent === '8'; }) &&
      A.doc.querySelectorAll('#board .chkTag').length === 0);
    await wait(2300);
    var all = A.doc.querySelectorAll('#board .layer-bond circle');
    ok('2秒後には配位でできた対もすべて黒（M3 と同じ・ふつうの共有電子対と区別がつかない）', A.doc.querySelectorAll('#board circle.e-co').length === 0 &&
      [].every.call(all, function (c) { return A.win.getComputedStyle(c).fill === 'rgb(34, 34, 34)'; }));
    // 配位数を超えては配位できない（否定対照）
    A.doc.querySelector('#palette2 button[data-el="NH3"]').click();
    var n5 = A.app.idsOf('N').filter(function (n) { return Ns.indexOf(n) < 0; })[0];
    tap(A, n5);
    ok('⚠ 否定対照: 5つ目の NH₃ は選べない・「Cu²⁺ の配位数は 4。もうつながらない」', !st(A).sel && msg(A) === 'Cu²⁺ の配位数は 4。もうつながらない');
    st(A).sel = { id: n5, slot: pairSlotIdx(A, n5) }; tap(A, cu);
    ok('⚠ 否定対照: 青い対を選んだことにしても Cu²⁺ には5本目がつながらない', M2.bondsOf(st(A).mol, cu).length === 4 && /配位数は 4/.test(msg(A)));
    A.doc.getElementById('undoBtn').click();
    ok('戻すで5つ目の NH₃ が消え、完成に戻る（盤は広いまま）', A.app.idsOf('N').length === 4 && st(A).last.match === true &&
      A.app.svg.getAttribute('viewBox') === '0 0 560 420');
    A.doc.getElementById('shapeViewBtn').click();
    A.app.stopSpin();
    var sv = A.app.shapeSvg;
    ok('形: 見出し「中心 Cu²⁺・配位数 4」「正方形（発展）」', sv.querySelector('.dom').textContent === '中心 Cu²⁺・配位数 4' &&
      sv.querySelector('.shp').textContent === '正方形（発展）');
    ok('⚠⚠ [Cu(NH₃)₄]²⁺ を正四面体と言わない', !/正四面体/.test(sv.textContent + msg(A)));
    ok('⚠ 錯イオンでは「電子のまとまり」「〜の配置」を出さない（VSEPR を通さない）', !sv.querySelector('.arr') && !/まとまり|配置/.test(sv.textContent));
    ok('1行で「形は電子対の反発でなく、イオンごとに決まる」', msg(A) === '形は電子対の反発でなく、イオンごとに決まる');
    var it4 = A.app.shapeItems();
    ok('立体: 配位子 NH₃ が4つ・4本とも同じ平面（z = 0）・非共有電子対のふくらみは無い', qa(A, '.pane3d .ball').length === 4 &&
      textsOf(A, '#shapeView .pane3d .sym.lig').join() === 'NH₃,NH₃,NH₃,NH₃' && it4.every(function (x) { return x.v[2] === 0; }) && qa(A, '.lobe').length === 0);
    ok('模式図: 紙面の十字（くさび・破線なし）・NH₃ が4つ', qa(A, '.pane2d .wedge').length === 0 && qa(A, '.pane2d .hash').length === 0 &&
      textsOf(A, '#shapeView .pane2d .sym.lig').length === 4);
    ok('⚠ 錯イオンに dsp²・d²sp³ を付けない（画面のどこにも出ない）', !/dsp|d²sp|d2sp|sp³|sp3/.test(A.doc.body.textContent + sv.textContent));
    ok('⚠ 錯イオンの形の画面に「反発で縮める」「もう一方の中心」を出さない', !vis(A, 'squeezeBtn') && !vis(A, 'cmpSeg') &&
      A.doc.getElementById('centerBtn').style.visibility === 'hidden');
    A.f.remove();

    section('画面: 公開③ 形は金属イオンの表で引く（Ag⁺ 直線・Zn²⁺ 正四面体・Fe³⁺ 正八面体）');
    var cases = [['ag-nh3-2', '直線形', 2, 1, 'NH₃'], ['zn-nh3-4', '正四面体形', 4, 2, 'NH₃'], ['zn-oh-4', '正四面体形', 4, -2, 'OH⁻'], ['fe-cn-6', '正八面体形', 6, -3, 'CN⁻']];
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      A = await openApp('index.html?m=' + c[0] + '&view=shape');
      A.app.stopSpin();
      sv = A.app.shapeSvg;
      ok(c[0] + ': ' + c[1] + '（発展）・配位数 ' + c[2] + '・電荷 ' + c[3] + '・立体の配位子「' + c[4] + '」' + c[2] + 'つ',
        st(A).view === 'shape' && sv.querySelector('.shp').textContent === c[1] + '（発展）' && /配位数 /.test(sv.querySelector('.dom').textContent) &&
        sv.querySelector('.dom').textContent.indexOf('配位数 ' + c[2]) > 0 && A.win.ChemShape.model.charge(st(A).mol) === c[3] &&
        qa(A, '.pane3d .ball').length === c[2] && textsOf(A, '#shapeView .pane3d .sym.lig').every(function (t) { return t === c[4]; }) &&
        msg(A) === '形は電子対の反発でなく、イオンごとに決まる');
      if (c[0] === 'zn-nh3-4') {
        ok('⚠ 同じ配位数4でも Zn²⁺ は正四面体（くさびと破線）・Cu²⁺ は正方形（イオンごとに決まる）', qa(A, '.pane2d .wedge').length === 1 && qa(A, '.pane2d .hash').length > 0);
      }
      if (c[0] === 'ag-nh3-2') {
        ok('⚠ [Ag(NH₃)₂]⁺ の中心は Ag（N ではない）', /中心 Ag⁺/.test(sv.querySelector('.dom').textContent));
      }
      A.doc.getElementById('buildView').click();
      ok(c[0] + ': 組んだ姿は完成・お題と一致・全体の電荷を右上に（' + textsOf(A, '#board .ionCharge').join() + '）', st(A).last.match === true &&
        textsOf(A, '#board .ionCharge').join() === ({ 1: '+', 2: '2+', '-2': '2−', '-3': '3−' })[c[3]]);
      A.f.remove();
    }

    section('画面: 公開③ CN⁻ は C で配位する・構造式でも配位できる');
    A = await openApp('index.html?m=fe-cn-6');
    M2 = A.win.ChemShape.model;
    var fe = metalId(A);
    var cnN = A.app.idsOf('N')[0];
    ok('CN⁻ のパーツは [ ] と「−」つき（6つ）', textsOf(A, '#board .ionCharge').filter(function (t) { return t === '−'; }).length === 6);
    tap(A, cnN);
    ok('⚠ CN⁻ の N をタップしても選べない（「CN⁻ は C の青い対でつなごう」）', !st(A).sel && msg(A) === 'CN⁻ は C の青い対でつなごう');
    var cs = A.app.idsOf('C');
    cs.forEach(function (x) { tap(A, x); tap(A, fe); });
    ok('C の青い対を6つ Fe³⁺ にわたすと完成（電荷 3 − 6 ＝ −3）', st(A).last.match === true && M2.charge(st(A).mol) === -3 &&
      /完成！ \[Fe\(CN\)₆\]³⁻/.test(msg(A)));
    var inside = st(A).mol.atoms.every(function (a) { var p = st(A).pos[a.id]; return p.x >= 0 && p.x <= 560 && p.y >= 0 && p.y <= 420; });
    ok('配位子6つの錯イオンも盤の中に収まる', inside);
    A.f.remove();
    A = await openApp('index.html?m=cu-nh3-4&mode=line');
    Ns = A.app.idsOf('N'); cu = metalId(A);
    ok('構造式: 空きのある金属イオンがあれば、配位できる青い対を出す（N 4つ × 2個）・H の手は出ない',
      A.doc.querySelectorAll('#board .e-lp').length === 8 && A.doc.querySelectorAll('#board line.hand').length === 0);
    Ns.forEach(function (n) { tap(A, n); tap(A, cu); });
    ok('構造式でも組めて完成・青い対は残らない（配位し終えたら構造式は線だけ）', st(A).last.match === true && A.doc.querySelectorAll('#board .e-lp').length === 0);
    A.f.remove();

    section('画面: 公開③ 自由（自分で組んだ NH₃ も配位できる）と、公開①②の画面を変えない');
    A = await openApp('index.html');
    ok('⚠ 公開①のお題（H₂）では2段目のパレットを出さない', !vis(A, 'palette2') && A.app.svg.getAttribute('viewBox') === '0 0 400 300');
    A.doc.getElementById('freeMode').click();
    ok('自由では2段目のパレットを出す', vis(A, 'palette2'));
    A.doc.querySelector('#palette2 button[data-el="Ag+"]').click();
    ok('金属イオンを置くと盤が広くなる', A.app.svg.getAttribute('viewBox') === '0 0 560 420');
    A.doc.querySelector('#palette button[data-el="N"]').click();
    ['H', 'H', 'H'].forEach(function () { A.doc.querySelector('#palette button[data-el="H"]').click(); });
    var nF = A.app.idsOf('N')[0], ag = metalId(A);
    A.app.idsOf('H').forEach(function (h) { tapAng(A, nF, slotOfKind(A, nF, 'u')); tap(A, h); });
    tapAng(A, nF, slotOfKind(A, nF, 'p')); tap(A, ag);
    ok('自分で組んだ NH₃ の青い対 → Ag⁺ で配位（あと 1 か所）', !!A.win.ChemShape.model.bondBetween(st(A).mol, nF, ag) && /Ag⁺ にわたそう（あと 1 か所）/.test(msg(A)));
    for (var u = 0; u < 20 && st(A).history.length; u++) A.doc.getElementById('undoBtn').click();
    ok('戻して金属イオンが消えると、盤はもとの広さ（400×300）', st(A).mol.atoms.length === 0 && A.app.svg.getAttribute('viewBox') === '0 0 400 300');
    A.f.remove();

    section('画面: 公開③ 375px・1280px・埋め込み');
    A = await openApp('index.html?m=cu-nh3-4', 375, 700);
    cu = metalId(A);
    var p2 = [].slice.call(A.doc.querySelectorAll('#palette2 button'));
    ok('375px: 2段目のパレットは1行（8つが同じ高さ）', p2.every(function (x) { return Math.abs(x.getBoundingClientRect().top - p2[0].getBoundingClientRect().top) < 2; }));
    A.app.idsOf('N').forEach(function (n) { tap(A, n); tap(A, cu); });
    ok('375px: [Cu(NH₃)₄]²⁺ を組み終えても横スクロールが出ない・完成（' + A.doc.documentElement.scrollWidth + 'px）',
      A.doc.documentElement.scrollWidth <= 376 && st(A).last.match === true);
    A.doc.getElementById('shapeViewBtn').click();
    A.app.stopSpin();
    ok('375px: 形の画面で横スクロールが出ない・声かけは1行', A.doc.documentElement.scrollWidth <= 376 && A.doc.getElementById('msg').getBoundingClientRect().height < 30);
    A.f.remove();
    A = await openApp('index.html?m=fe-cn-6&view=shape', 375, 700);
    ok('375px: [Fe(CN)₆]³⁻ の形の画面で横スクロールが出ない', A.doc.documentElement.scrollWidth <= 376);
    A.f.remove();
    A = await openApp('index.html?m=cu-nh3-4', 1280, 800);
    ok('1280px: 錯イオンの盤で横スクロールが出ない（' + A.doc.documentElement.scrollWidth + 'px）', A.doc.documentElement.scrollWidth <= 1280);
    A.f.remove();
    A = await openApp('index.html?m=cu-nh3-4&view=shape&embed=1', 375, 700);
    A.app.stopSpin();
    var h0 = A.doc.documentElement.getBoundingClientRect().height;
    A.doc.getElementById('buildView').click();
    var h1 = A.doc.documentElement.getBoundingClientRect().height;
    A.doc.getElementById('shapeViewBtn').click();
    var h2 = A.doc.documentElement.getBoundingClientRect().height;
    ok('embed=1（complex-ion に埋める形）: 形 ⇄ 組む で高さが変わらない（' + [h0, h1, h2].map(Math.round).join('→') + '）', near(h0, h1) && near(h0, h2) && st(A).view === 'shape');
    A.f.remove();
  }
  function pairSlotIdx(A, id) { var sl = st(A).slots[id]; for (var k = 0; k < sl.length; k++) if (sl[k].k === 'p') return k; return null; }

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

  /* ---- 参考書から来るリンク（公開①・2026-09-26・DESIGN_bond_app.md §5-2）----
     参考書（../assembler/reference.json）の `:::link app: shape id: …` が、実在するお題を指しているか。
     CLAUDE.md「横断の整合性検査は、両方のデータが揃う側に置く」—— 参考書はこちらのお題を持たない。
     ⚠ 受け口の名前はここに1本の表で持つ（ion の refReceiversIon・ratio の refReceivers と同じ型）。
       tools/reference-md.js の APP_TARGETS に足した `shape` の写し。embeddable も写す */
  function refReceivers(mols) {
    return { 'shape': { ids: new Set(mols.map(function (m) { return m.id; })), embeddable: true } };
  }
  function refLinkProblems(pages, recv) {
    var out = [], seen = 0;
    function walk(o, page) {
      if (Array.isArray(o)) { o.forEach(function (x) { walk(x, page); }); return; }
      if (!o || typeof o !== 'object') return;
      if (o.kind === 'link' && typeof o.app === 'string' && (o.app === 'shape' || o.app.indexOf('shape/') === 0)) {
        seen++;
        var id = o.id == null ? '' : String(o.id);
        var where = page + ' → ' + o.app + (id ? ' ' + id : '');
        if (!(o.app in recv)) out.push(where + '（受け口の表に無い名前）');
        else if (!id) out.push(where + '（id が無い）');
        else if (!recv[o.app].ids.has(id)) out.push(where + '（お題が実在しない）');
        if (o.embed && !(o.app in recv && recv[o.app].embeddable)) out.push(where + '（埋め込めない受け口に embed: true）');
      }
      Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k], page); });
    }
    (pages || []).forEach(function (p) { walk(p.blocks || [], p.id || '?'); });
    return { problems: out, seen: seen };
  }
  async function runRefLinkTests(mols) {
    section('参考書から来るリンク');
    var recv = refReceivers(mols);
    ok('REF1: 受け口の表が空でない（H2O・NH4+ が引ける）', recv.shape.ids.has('H2O') && recv.shape.ids.has('NH4+'));
    var g = refLinkProblems([{ id: 'p', blocks: [
      { kind: 'link', app: 'shape', id: 'NH4+', embed: true, text: 'x' },
      { kind: 'link', app: 'ion-equation/redox', id: 'no-such', text: 'よそのアプリは見ない' },
      { kind: 'link', to: 'alcohol', text: '参考書の中のリンクは見ない' }
    ] }], recv);
    var b = refLinkProblems([{ id: 'p', blocks: [
      { kind: 'link', app: 'shape', id: 'XeF4', text: 'x' },
      { kind: 'link', app: 'shape', text: 'x' },
      { kind: 'link', app: 'shape/nosuch', id: 'H2O', text: 'x' }
    ] }], recv);
    ok('REF2: ⚠ 否定対照 — 在るお題は通し、無いお題・id なし・知らない受け口は赤にする',
      g.problems.length === 0 && g.seen === 1 && b.problems.length === 3);
    try {
      var res = await fetch('../assembler/reference.json', { cache: 'no-store' });
      var pages = await res.json();
      var r = refLinkProblems(pages, recv);
      ok('REF3: 参考書の shape 宛てのリンクがすべて実在するお題を指す（' + r.seen + '本' +
        (r.problems.length ? '・' + r.problems.join(' / ') : '') + '）',
        Array.isArray(pages) && pages.length > 10 && r.problems.length === 0);
    } catch (e) {
      ok('REF3: ../assembler/reference.json を読める（' + e + '）', false);
    }
  }

  (async function main() {
    try {
      var mols = await (await fetch('molecules.json?v=' + VER, { cache: 'no-store' })).json();
      runModelTests(window.ChemShape.model, mols, ok, section);
      await runUITests();
      await runRefLinkTests(mols);
    } catch (e) {
      ok('テストが例外で止まらない: ' + (e && e.stack || e), false);
    }
    finish();
  })();
})();
