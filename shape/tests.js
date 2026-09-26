/* tests.js — 電子対でみる分子のかたち（shape）の回帰テスト。
   - モデルのテスト（runModelTests）は node だけでも走る:  node shape/tests.js
   - test.html では、モデルのテストのあとに iframe で画面を駆動する（DESIGN_bond_app.md §6 の 1〜4・7・8）
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
    var must = ['H2', 'HCl', 'H2O', 'NH3', 'CH4', 'CO2', 'N2', 'HCN', 'C2H4', 'H2O2', 'H2S', 'PH3'];
    ok('最低限のお題12件がそろっている', must.every(function (id) { return !!byId[id]; }));
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
      ok('お題14件 × 並べ替え6通りで、すべて同じコード' + (where ? '（' + where + ' で違う）' : ''), allSame);
      ok('コードは H も頂点にしている（H₂ のコードに H が2つ出る）', (byId.H2.code.match(/H\|/g) || []).length === 2);
      var ch = M.clone(b.s);
      ok('clone したものも同じコード（元と独立）', M.code(ch) === M.code(b.s) && ch.atoms[0] !== b.s.atoms[0]);
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
    ok('O の右の扇形をタップ → その側の不対電子が選ばれる', st(A).sel && st(A).sel.id === O && st(A).sel.side === 1 &&
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
    await runWidthTests();
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
    var sizes = ['index.html?m=C2H4', 'index.html?m=C2H4&embed=1'];
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
