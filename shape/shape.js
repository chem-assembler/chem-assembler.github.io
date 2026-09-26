/* shape.js — 電子対でみる分子のかたち（shape）の画面。M1: 原子を置く・タップで結合・電子式⇄構造式・判定・お題。
   設計の正は DESIGN_bond_app.md。化学の判断は model.js（window.ChemShape.model）だけが持つ。
   ここが持つのは「見た目」: 原子の位置・4つの側（スロット）・描画・タップ。
   ⚠ グローバルは window.ChemShape の1つだけ（IIFE・§2）。 */
(function () {
  'use strict';
  var CS = window.ChemShape = window.ChemShape || {};
  var M = CS.model;

  /* ================================================================
     参考書のページに埋め込まれたとき（?embed=1）・参考書から来たときの戻り道。
     写した元: ion-equation/header-ui.js 14〜60行（§4-4。ion のファイルは読まない ＝ 依存を作らない）。
     ① `<html class="embed">` と `<base target="_top">` は index.html の head の同期な1行が持つ。
     ここが持つのは ②（高さを親に知らせる）と ③（「← 参考書へ戻る」の帯を作らない）。
     ⚠ embed=1 が無ければ挙動を1バイトも変えない。
     ================================================================ */
  var embedded = false;
  try { embedded = new URLSearchParams(location.search).get('embed') === '1'; } catch (e) { /* 何もしない */ }

  /* ② 高さを親に知らせる。約束: 子 → 親 { type: 'slz-embed', v: 1, h: <整数 px> } を location.origin 宛てに。
     ⚠ 前と同じ h は送らない（発振の見張り）。⚠ 測るのは documentElement の外枠の高さ（scrollHeight は使わない） */
  if (embedded && window.parent !== window && typeof ResizeObserver === 'function') {
    var sentH = -1;
    var tell = function () {
      var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (h === sentH || !(h > 0)) return;
      sentH = h;
      try { parent.postMessage({ type: 'slz-embed', v: 1, h: h }, location.origin); } catch (e) { /* 送れなくても本体は動かす */ }
    };
    try {
      new ResizeObserver(tell).observe(document.documentElement);
      tell();
    } catch (e) { /* 観測できない環境では高さを送らないだけ */ }
  }

  /* ③ 参考書から来たときの戻り道（from=reference&page=<id>）。embed=1 のときは作らない */
  try {
    var qp = new URLSearchParams(location.search);
    var head = document.querySelector('header');
    if (!embedded && qp.get('from') === 'reference' && head && !document.querySelector('.refBack')) {
      var page = qp.get('page') || '';
      var band = document.createElement('div');
      band.className = 'refBack';
      var a = document.createElement('a');
      a.className = 'refBackLink';
      a.href = '../reference/' + (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page) ? page + '/' : '');
      a.target = '_top';
      a.textContent = '← 参考書へ戻る';
      band.appendChild(a);
      head.after(band);
    }
  } catch (e) { /* 戻り道が作れなくても本体は動かす */ }

  /* ================================================================
     見た目の定数
     ================================================================ */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var VIEW_W = 400, VIEW_H = 300;
  var L = 60;              // 結合した2原子の中心の距離（viewBox 単位）
  var HIT = 28;            // 原子の的の半径（viewBox 単位）。下で「CSS 22px 以上」も保証する（直径 44px）
  var TAP_SLOP = 8;        // 指がこれ以上動いたらタップではなく移動（client px・DESIGN_hit_areas.md §8-3）
  var MARGIN = 22;         // 原子を台の端から離す量
  // 側の番号: 0 上・1 右・2 下・3 左
  var DIRS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  // 電子式の点の置き方（教科書・参考書の表と同じ: NH₃ の N は右・下・左に不対電子、上に非共有電子対）
  var PAIR_ORDER = [0, 3, 2, 1];
  var SINGLE_ORDER = [1, 2, 3, 0];

  /* ================================================================
     状態
     sides[id] は原子ごとの4つの枠（スロット）。中身は null・'u'（不対電子）・'p'（非共有電子対）・{ b: 相手の id }。
     ★ 電子式の赤い点と構造式の手（赤い線の端）は、この同じ枠の2つの見え方（§3-1: 入力は1系統）。
     ================================================================ */
  var st = {
    mol: M.create(), pos: {}, sides: {},
    history: [], mode: 'dot', check: false, sel: null,
    targets: [], taskIdx: 0, free: false, notice: null, ready: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var svg = $('board');

  /* ---- 座標変換（CLAUDE.md の約束: getScreenCTM 必須）----
     写した元: assembler/game.js `clientToSvg`（1725行）・`svgUnitsPerPixel`（1732行） */
  function clientToSvg(clientX, clientY) {
    var ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  }
  function svgUnitsPerPixel() {
    var ctm = svg.getScreenCTM();
    if (!ctm) return 1;
    return 1 / ctm.a; // meet 指定では縦横同一スケールのため a のみで足りる
  }
  function svgToClient(x, y) {
    var ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(x, y).matrixTransform(ctm);
  }

  /* ================================================================
     枠（スロット）の割り当て
     ================================================================ */
  function initialSides(el) {
    var e = M.ELEMENTS[el];
    var s = [null, null, null, null];
    for (var i = 0; i < e.lp; i++) s[PAIR_ORDER[i]] = 'p';
    var n = e.un;
    SINGLE_ORDER.forEach(function (k) { if (n > 0 && s[k] === null) { s[k] = 'u'; n--; } });
    return s;
  }

  function sideToward(from, to) {
    var dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 1 : 3;
    return dy < 0 ? 0 : 2;
  }
  // 角度の近い順の4つの側（結合の向きが格子からずれたときの逃げ道）
  function sidesByAngle(from, to) {
    var ang = Math.atan2(to.y - from.y, to.x - from.x);
    var base = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]; // 上・右・下・左
    return [0, 1, 2, 3].sort(function (a, b) {
      var da = Math.abs(Math.atan2(Math.sin(ang - base[a]), Math.cos(ang - base[a])));
      var db = Math.abs(Math.atan2(Math.sin(ang - base[b]), Math.cos(ang - base[b])));
      return da - db;
    });
  }

  /* 結合の向き（位置から）に結合の枠を置き、残りの枠に非共有電子対と不対電子を詰め直す。
     前の置き場所をなるべく保つ（点が跳ねないように）。
     ⚠ M1 の9元素は「まとまり ≤ 4」なので4つの枠に必ず収まる。手が5本・6本（M4）は放射状に置く（§3-5） */
  function assignSides(id) {
    var A = M.atomOf(st.mol, id);
    var prev = st.sides[id] || initialSides(A.el);
    var s = [null, null, null, null];
    M.bondsOf(st.mol, id).forEach(function (b) {
      var p = b.a === id ? b.b : b.a;
      var order = sidesByAngle(st.pos[id], st.pos[p]);
      for (var i = 0; i < 4; i++) if (s[order[i]] === null) { s[order[i]] = { b: p }; break; }
    });
    var lp = A.lp, un = A.un;
    if (un === 0 && lp > 0) {
      // 手を使い切った原子は、非共有電子対を結合の反対側から置く（HCN の N は右に「:」＝ 教科書の書き方）
      var vx = 0, vy = 0;
      for (var q = 0; q < 4; q++) if (s[q] !== null) { vx += DIRS[q].x; vy += DIRS[q].y; }
      PAIR_ORDER.filter(function (k3) { return s[k3] === null; })
        .sort(function (p1, p2) { return (DIRS[p1].x * vx + DIRS[p1].y * vy) - (DIRS[p2].x * vx + DIRS[p2].y * vy); })
        .forEach(function (k3) { if (lp > 0) { s[k3] = 'p'; lp--; } });
    }
    for (var k = 0; k < 4; k++) {
      if (s[k] !== null) continue;
      if (prev[k] === 'p' && lp > 0) { s[k] = 'p'; lp--; }
      else if (prev[k] === 'u' && un > 0) { s[k] = 'u'; un--; }
    }
    PAIR_ORDER.forEach(function (k2) { if (lp > 0 && s[k2] === null) { s[k2] = 'p'; lp--; } });
    SINGLE_ORDER.forEach(function (k2) { if (un > 0 && s[k2] === null) { s[k2] = 'u'; un--; } });
    st.sides[id] = s;
  }

  function unpairedSides(id) {
    var s = st.sides[id] || [];
    var out = [];
    for (var k = 0; k < 4; k++) if (s[k] === 'u') out.push(k);
    return out;
  }
  // タップした側に不対電子があればそれ、1か所しか無ければそれ、無ければ近い側
  function pickUnpairedSide(id, side) {
    var us = unpairedSides(id);
    if (!us.length) return null;
    if (us.length === 1) return us[0];
    if (side !== null && us.indexOf(side) >= 0) return side;
    if (side === null) return us[0];
    var dist = function (k) { var d = Math.abs(k - side) % 4; return Math.min(d, 4 - d); };
    return us.slice().sort(function (a, b) { return dist(a) - dist(b); })[0];
  }

  /* ================================================================
     置き直し（§3-5・見た目だけ）: 結合のたびに分子全体を組み直す（中心 → 上下左右 → その先）
     ================================================================ */
  function degree(id) { return M.bondsOf(st.mol, id).length; }

  function relayout(anyId) {
    var comp = M.componentOf(st.mol, anyId);
    if (comp.length > 1) {
      var root = comp.slice().sort(function (a, b) {
        var ha = M.atomOf(st.mol, a).el === 'H' ? 1 : 0, hb = M.atomOf(st.mol, b).el === 'H' ? 1 : 0;
        return (degree(b) - degree(a)) || (ha - hb) || (a - b);
      })[0];
      var anchor = st.pos[root];
      var g = {}; g[root] = { x: 0, y: 0 };
      var occ = new Set(['0,0']);
      var inDir = {}; inDir[root] = null;
      var queue = [root];
      while (queue.length) {
        var u = queue.shift();
        var used = new Set();
        var bs = M.bondsOf(st.mol, u);
        bs.forEach(function (b) {
          var v = b.a === u ? b.b : b.a;
          if (g[v]) used.add(sideToward(g[u], g[v]));
        });
        bs.slice().sort(function (p, q) { return (p.a + p.b) - (q.a + q.b); }).forEach(function (b) {
          var v = b.a === u ? b.b : b.a;
          if (g[v]) return;
          var cands = [];
          if (b.hint) {
            if (b.hint.from === u) cands.push(b.hint.side);
            else if (b.hint.from === v) cands.push((b.hint.side + 2) % 4);
          }
          if (inDir[u] !== null) cands.push(inDir[u]); // まっすぐ先へ
          cands.push(1, 2, 3, 0);
          var pick = null;
          for (var i = 0; i < cands.length && pick === null; i++) {
            var d = cands[i];
            if (used.has(d)) continue;
            if (occ.has((g[u].x + DIRS[d].x) + ',' + (g[u].y + DIRS[d].y))) continue;
            pick = d;
          }
          if (pick === null) for (var j = 0; j < 4 && pick === null; j++) if (!used.has(j)) pick = j;
          if (pick === null) pick = 1;
          used.add(pick);
          g[v] = { x: g[u].x + DIRS[pick].x, y: g[u].y + DIRS[pick].y };
          occ.add(g[v].x + ',' + g[v].y);
          inDir[v] = pick;
          queue.push(v);
        });
      }
      comp.forEach(function (id) {
        if (g[id]) st.pos[id] = { x: anchor.x + g[id].x * L, y: anchor.y + g[id].y * L };
      });
      // 台の上がこの分子だけになったら、台の真ん中へ寄せる（お題を組み終えた姿を見やすく）
      if (comp.length === st.mol.atoms.length) centerComponent(comp);
      clampComponent(comp);
      pushOthersAway(comp);
    }
    comp.forEach(assignSides);
  }

  function centerComponent(comp) {
    var xs = comp.map(function (id) { return st.pos[id].x; }), ys = comp.map(function (id) { return st.pos[id].y; });
    var dx = VIEW_W / 2 - (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
    var dy = VIEW_H / 2 - (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
    comp.forEach(function (id) { st.pos[id] = { x: st.pos[id].x + dx, y: st.pos[id].y + dy }; });
  }

  function clampComponent(comp) {
    var xs = comp.map(function (id) { return st.pos[id].x; }), ys = comp.map(function (id) { return st.pos[id].y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var dx = 0, dy = 0;
    if (maxX > VIEW_W - MARGIN) dx = VIEW_W - MARGIN - maxX;
    if (minX + dx < MARGIN) dx = MARGIN - minX;
    if (maxY > VIEW_H - MARGIN) dy = VIEW_H - MARGIN - maxY;
    if (minY + dy < MARGIN) dy = MARGIN - minY;
    if (dx || dy) comp.forEach(function (id) { st.pos[id] = { x: st.pos[id].x + dx, y: st.pos[id].y + dy }; });
  }

  function minDistTo(p, ids) {
    var best = Infinity;
    ids.forEach(function (id) {
      var q = st.pos[id];
      var d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) best = d;
    });
    return best;
  }

  // 組み直した分子に重なったほかの分子を、近くの空いている所へ動かす
  function pushOthersAway(comp) {
    var inComp = new Set(comp);
    var done = new Set();
    st.mol.atoms.forEach(function (a) {
      if (inComp.has(a.id) || done.has(a.id)) return;
      var other = M.componentOf(st.mol, a.id);
      other.forEach(function (id) { done.add(id); });
      var fixed = st.mol.atoms.map(function (x) { return x.id; }).filter(function (id) { return other.indexOf(id) < 0; });
      var clash = other.some(function (id) { return minDistTo(st.pos[id], comp) < L * 0.9; });
      if (!clash) return;
      moveToFree(other, fixed);
    });
  }

  function moveToFree(ids, fixed) {
    var ref = st.pos[ids[0]];
    var rel = ids.map(function (id) { return { id: id, x: st.pos[id].x - ref.x, y: st.pos[id].y - ref.y }; });
    var best = null, bestD = Infinity;
    for (var y = MARGIN; y <= VIEW_H - MARGIN; y += 10) {
      for (var x = MARGIN; x <= VIEW_W - MARGIN; x += 10) {
        var okAll = rel.every(function (r) {
          var p = { x: x + r.x, y: y + r.y };
          if (p.x < MARGIN || p.x > VIEW_W - MARGIN || p.y < MARGIN || p.y > VIEW_H - MARGIN) return false;
          return minDistTo(p, fixed) >= L;
        });
        if (!okAll) continue;
        var d = Math.hypot(x - ref.x, y - ref.y);
        if (d < bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    if (!best) return;
    rel.forEach(function (r) { st.pos[r.id] = { x: best.x + r.x, y: best.y + r.y }; });
  }

  function freeSpot() {
    var ids = st.mol.atoms.map(function (a) { return a.id; });
    var best = { x: VIEW_W / 2, y: VIEW_H / 2 }, bestD = -1;
    for (var y = 50; y <= VIEW_H - 40; y += 20) {
      for (var x = 40; x <= VIEW_W - 40; x += 20) {
        var d = ids.length ? minDistTo({ x: x, y: y }, ids) : Infinity;
        if (d >= L * 1.5) return { x: x, y: y };
        if (d > bestD) { bestD = d; best = { x: x, y: y }; }
      }
    }
    return best;
  }

  /* ================================================================
     操作
     ================================================================ */
  function snapshot() {
    return {
      mol: M.clone(st.mol),
      pos: JSON.parse(JSON.stringify(st.pos)),
      sides: JSON.parse(JSON.stringify(st.sides))
    };
  }
  function pushHistory() {
    st.history.push(snapshot());
    if (st.history.length > 100) st.history.shift();
  }

  function placeAtom(el, p) {
    var at = p || freeSpot(); // 置く前に場所を決める（置いた後だと位置の無い原子を数えてしまう）
    var id = M.addAtom(st.mol, el);
    st.pos[id] = at;
    st.sides[id] = initialSides(el);
    return id;
  }

  function addFromPalette(el) {
    pushHistory();
    st.sel = null;
    placeAtom(el);
    st.notice = null;
    update();
  }

  // お題の原子を並べて置く（結合はしない）
  function setupBoard() {
    st.mol = M.create(); st.pos = {}; st.sides = {}; st.sel = null; st.history = []; st.notice = null;
    if (!st.free && st.targets[st.taskIdx]) {
      var els = st.targets[st.taskIdx].atoms;
      var cols = Math.min(els.length, 3), rows = Math.ceil(els.length / 3);
      els.forEach(function (el, i) {
        var c = i % 3, r = Math.floor(i / 3);
        placeAtom(el, { x: VIEW_W * (c + 1) / (cols + 1), y: VIEW_H * (r + 1) / (rows + 1) });
      });
    }
    update();
  }

  function say(text, kind) { st.notice = { text: text, kind: kind || 'warn' }; }

  function tapAtom(id, side) {
    var A = M.atomOf(st.mol, id);
    st.notice = null;
    if (!st.sel) {
      if (A.un < 1) { say('この原子には不対電子がありません'); update(); return; }
      st.sel = { id: id, side: pickUnpairedSide(id, side) };
      say('相手の原子をタップしよう', 'info');
      update();
      return;
    }
    if (st.sel.id === id) {
      var s2 = pickUnpairedSide(id, side);
      if (s2 === st.sel.side) st.sel = null;
      else { st.sel.side = s2; say('相手の原子をタップしよう', 'info'); }
      update();
      return;
    }
    // ここからは A ＝ 2つめにタップした相手
    if (A.un < 1) { say('この原子には不対電子がありません'); update(); return; }
    var c = M.canBond(st.mol, st.sel.id, id);
    if (!c.ok) {
      say(c.reason === 'max-order' ? '三重結合より多くはつくれません' : 'ここは結合できません');
      update();
      return;
    }
    // 相手に不対電子が1か所しか無ければ原子ごとのタップでよい（側を選ばせない・§3-2）
    var sB = pickUnpairedSide(id, side);
    var a = st.sel.id, sA = st.sel.side;
    pushHistory();
    M.bond(st.mol, a, id, { from: a, side: sA });
    st.sides[a][sA] = null;
    st.sides[id][sB] = null;
    st.sel = null;
    relayout(a);
    update();
  }

  function undo() {
    var h = st.history.pop();
    if (!h) return;
    st.mol = h.mol; st.pos = h.pos; st.sides = h.sides; st.sel = null; st.notice = null;
    update();
  }

  /* ---- タップと移動（pointer events）---- */
  var drag = null;

  function hitAtom(p) {
    var r = Math.max(HIT, 22 * svgUnitsPerPixel());
    var best = null, bestD = Infinity;
    st.mol.atoms.forEach(function (a) {
      var q = st.pos[a.id];
      var d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d <= r && d < bestD) { bestD = d; best = a.id; }
    });
    return best;
  }
  // 原子の中心からの角度で、どの側（扇形）かを決める（§3-2）。中心の近くは「側なし」
  function sideAt(id, p) {
    var q = st.pos[id];
    if (Math.hypot(p.x - q.x, p.y - q.y) < 4) return null;
    return sideToward(q, p);
  }

  svg.addEventListener('pointerdown', function (e) {
    var p = clientToSvg(e.clientX, e.clientY);
    if (!p) return;
    var id = hitAtom(p);
    drag = { id: id, cx: e.clientX, cy: e.clientY, p0: p, moved: false, orig: null, pid: e.pointerId };
    if (id !== null) {
      var comp = M.componentOf(st.mol, id);
      drag.orig = comp.map(function (k) { return { id: k, x: st.pos[k].x, y: st.pos[k].y }; });
    }
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベントなど。無くても動く */ }
    e.preventDefault();
  });

  svg.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < TAP_SLOP) return;
    drag.moved = true;
    if (!drag.orig) return;
    var p = clientToSvg(e.clientX, e.clientY);
    if (!p) return;
    var dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    drag.orig.forEach(function (o) { st.pos[o.id] = { x: o.x + dx, y: o.y + dy }; });
    render();
  });

  function endPointer(e, cancelled) {
    if (!drag) return;
    var d = drag;
    drag = null;
    try { svg.releasePointerCapture(d.pid); } catch (err) { /* noop */ }
    if (cancelled) return;
    if (d.moved) {
      if (d.orig) {
        clampComponent(d.orig.map(function (o) { return o.id; }));
        render();
      }
      return;
    }
    var p = clientToSvg(e.clientX, e.clientY) || d.p0;
    if (d.id === null) {
      if (st.sel) { st.sel = null; st.notice = null; update(); }
      return;
    }
    tapAtom(d.id, sideAt(d.id, p));
  }
  svg.addEventListener('pointerup', function (e) { endPointer(e, false); });
  svg.addEventListener('pointercancel', function (e) { endPointer(e, true); });

  /* ================================================================
     判定の文（先生の声掛け・1行）
     ================================================================ */
  function currentTarget() { return st.free ? null : (st.targets[st.taskIdx] || null); }

  function evaluate() {
    var t = currentTarget();
    var j = M.judge(st.mol, t ? { allowedUnpaired: t.allowedUnpaired } : null);
    var res = { complete: j.complete, leftover: j.leftover, match: null, text: '', kind: '' };
    if (t) {
      var r = M.checkTarget(st.mol, t);
      res.match = r.match;
      if (r.match) { res.text = '完成！ ' + t.formula + '（' + t.name + '）ができた'; res.kind = 'done'; }
      else if (j.complete && !r.sameFormula) { res.text = '完成。でも原子の数がお題とちがいます'; res.kind = 'warn'; }
      else if (j.complete) { res.text = '完成。でもつなぎ方がお題とちがいます'; res.kind = 'warn'; }
    } else if (j.complete) {
      res.text = '完成！ 不対電子が1つも残っていない'; res.kind = 'done';
    }
    if (!res.text) {
      if (j.empty) res.text = '下の原子をタップして置こう';
      else if (!st.mol.bonds.length) res.text = '赤い点をタップして、相手の原子をタップしよう';
      else { res.text = '手が余っています（不対電子 ' + j.leftover + ' 個）'; res.kind = 'warn'; }
    }
    return res;
  }

  function update() {
    var ev = evaluate();
    st.last = ev;
    if (ev.complete && !st.wasComplete) st.check = true; // 完成したら数を確かめる（参考書の確かめの図と同じ）
    st.wasComplete = ev.complete;
    var msg = $('msg');
    var n = st.notice;
    msg.textContent = n ? n.text : ev.text;
    msg.className = 'msg' + ((n ? n.kind : ev.kind) ? ' ' + (n ? n.kind : ev.kind) : '');
    render();
    renderBars();
  }

  /* ================================================================
     描画
     ================================================================ */
  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function dot(g, x, y, cls) { el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.4, 'class': cls }, g); }

  function sideOffset(sym, k) {
    var wide = sym.length > 1;
    var ox = wide ? 19 : 14, oy = 15;
    return { x: DIRS[k].x * ox, y: DIRS[k].y * oy };
  }

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var gChk = el('g', { 'class': 'layer-check' }, svg);
    var gSel = el('g', { 'class': 'layer-sel' }, svg);
    var gBond = el('g', { 'class': 'layer-bond' }, svg);
    var gAtom = el('g', { 'class': 'layer-atom' }, svg);

    // 確かめ（丸で囲んで数える）
    if (st.check) {
      st.mol.atoms.forEach(function (a) {
        var p = st.pos[a.id], t = M.tag(st.mol, a.id);
        el('circle', { cx: p.x, cy: p.y, r: L / 2 + 5, 'class': 'chk' }, gChk);
        var tx = el('text', { x: p.x + 24, y: p.y - 22, 'class': 'chkNum' + (t.label ? ' ok' : ''), 'data-id': a.id }, gChk);
        tx.textContent = String(t.count);
      });
    }

    // 選んだ側の扇形
    if (st.sel && st.sel.side !== null) {
      var sp = st.pos[st.sel.id], k = st.sel.side;
      var mid = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][k];
      var R = HIT + 4, a0 = mid - Math.PI / 4, a1 = mid + Math.PI / 4;
      el('path', {
        d: 'M' + sp.x + ' ' + sp.y + ' L' + (sp.x + R * Math.cos(a0)).toFixed(1) + ' ' + (sp.y + R * Math.sin(a0)).toFixed(1) +
          ' A' + R + ' ' + R + ' 0 0 1 ' + (sp.x + R * Math.cos(a1)).toFixed(1) + ' ' + (sp.y + R * Math.sin(a1)).toFixed(1) + ' Z',
        'class': 'selWedge'
      }, gSel);
    }

    // 共有電子対（電子式）／結合の線（構造式）
    st.mol.bonds.forEach(function (b) {
      var pa = st.pos[b.a], pb = st.pos[b.b];
      var dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
      if (st.mode === 'dot') {
        var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        for (var i = 0; i < b.order; i++) {
          var off = (i - (b.order - 1) / 2) * 8.5;
          var cx = mx + ux * off, cy = my + uy * off;
          dot(gBond, cx + nx * 4.6, cy + ny * 4.6, 'e-sh');
          dot(gBond, cx - nx * 4.6, cy - ny * 4.6, 'e-sh');
        }
      } else {
        var cut = 14;
        var offs = b.order === 1 ? [0] : b.order === 2 ? [-3.5, 3.5] : [-5.5, 0, 5.5];
        offs.forEach(function (o) {
          el('line', {
            x1: (pa.x + ux * cut + nx * o).toFixed(1), y1: (pa.y + uy * cut + ny * o).toFixed(1),
            x2: (pb.x - ux * cut + nx * o).toFixed(1), y2: (pb.y - uy * cut + ny * o).toFixed(1),
            'class': 'bond'
          }, gBond);
        });
      }
    });

    // 原子（元素記号＋枠の中身）
    st.mol.atoms.forEach(function (a) {
      var p = st.pos[a.id];
      var g = el('g', { 'class': 'atom', 'data-id': a.id, 'data-el': a.el }, gAtom);
      var t = el('text', { x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': 'sym' }, g);
      t.textContent = a.el;
      var s = st.sides[a.id] || [];
      for (var k2 = 0; k2 < 4; k2++) {
        var c = s[k2];
        if (c !== 'u' && c !== 'p') continue;
        var o = sideOffset(a.el, k2);
        var qx = p.x + o.x, qy = p.y + o.y;
        if (st.mode === 'dot') {
          if (c === 'u') dot(g, qx, qy, 'e-un');
          else {
            var px = -DIRS[k2].y * 4.6, py = DIRS[k2].x * 4.6;
            dot(g, qx + px, qy + py, 'e-lp');
            dot(g, qx - px, qy - py, 'e-lp');
          }
        } else if (c === 'u') {
          // 構造式では不対電子を「手」（赤い線の端）で描く。非共有電子対は構造式では書かない
          var w = a.el.length > 1 ? 16 : 12;
          el('line', {
            x1: p.x + DIRS[k2].x * w, y1: p.y + DIRS[k2].y * 12,
            x2: p.x + DIRS[k2].x * (w + 10), y2: p.y + DIRS[k2].y * 22, 'class': 'hand'
          }, g);
        }
      }
    });
  }

  function renderBars() {
    var t = currentTarget();
    $('taskMode').className = st.free ? '' : 'on';
    $('freeMode').className = st.free ? 'on' : '';
    $('taskLabel').textContent = t ? t.formula + '（' + t.name + '）をつくろう' : '原子を置いて組もう';
    $('prevTask').disabled = st.free || st.taskIdx <= 0;
    $('nextTask').disabled = st.free || st.taskIdx >= st.targets.length - 1;
    $('dotMode').className = st.mode === 'dot' ? 'on' : '';
    $('lineMode').className = st.mode === 'line' ? 'on' : '';
    $('checkBtn').className = st.check ? 'on' : '';
    $('undoBtn').disabled = !st.history.length;
  }

  /* ================================================================
     起動
     ================================================================ */
  function buildPalette() {
    var pal = $('palette');
    M.ELEMENT_ORDER.forEach(function (sym) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = sym;
      b.setAttribute('data-el', sym);
      b.setAttribute('aria-label', sym + ' を置く');
      b.addEventListener('click', function () { addFromPalette(sym); });
      pal.appendChild(b);
    });
  }

  function bindBars() {
    $('taskMode').addEventListener('click', function () { if (st.free) { st.free = false; setupBoard(); } });
    $('freeMode').addEventListener('click', function () { if (!st.free) { st.free = true; setupBoard(); } });
    $('prevTask').addEventListener('click', function () { if (st.taskIdx > 0) { st.taskIdx--; setupBoard(); } });
    $('nextTask').addEventListener('click', function () { if (st.taskIdx < st.targets.length - 1) { st.taskIdx++; setupBoard(); } });
    $('dotMode').addEventListener('click', function () { st.mode = 'dot'; update(); });
    $('lineMode').addEventListener('click', function () { st.mode = 'line'; update(); });
    $('checkBtn').addEventListener('click', function () { st.check = !st.check; update(); });
    $('undoBtn').addEventListener('click', undo);
    $('resetBtn').addEventListener('click', setupBoard);
  }

  // 自分の ?v= を molecules.json にも付ける（版の出どころを index.html の1か所にする。
  // JS の中に番号を書くと verify-release.js の死角になる ＝ qa/app.js で踏んだ事故）
  function ownVersion() {
    var cur = document.currentScript && document.currentScript.src;
    var m = cur && /[?&]v=(\d+)/.exec(cur);
    return m ? m[1] : String(Date.now());
  }
  var VER = ownVersion();

  function start(list) {
    st.targets = M.prepareTargets(list);
    var q = new URLSearchParams(location.search);
    var mode = q.get('mode');
    if (mode === 'line' || mode === 'dot') st.mode = mode;
    var m = q.get('m');
    if (m) {
      var idx = -1;
      st.targets.forEach(function (t, i) { if (t.id === m) idx = i; });
      if (idx >= 0) st.taskIdx = idx;
    }
    buildPalette();
    bindBars();
    setupBoard();
    if (m && st.targets[st.taskIdx].id !== m) { say('そのお題はまだありません'); update(); }
    st.ready = true;
  }

  fetch('molecules.json?v=' + VER)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(start)
    .catch(function (e) {
      $('msg').textContent = 'お題を読み込めませんでした';
      $('msg').className = 'msg warn';
      if (window.console) console.error(e);
    });

  /* ---- テストの入口（test.html が使う。画面の操作はしない）---- */
  CS.app = {
    state: function () { return st; },
    svg: svg,
    // 原子の中心（side を渡すとその側の扇形の中の点）を client 座標で返す
    clientOf: function (id, side) {
      var p = st.pos[id];
      if (!p) return null;
      var q = side === undefined || side === null ? p : { x: p.x + DIRS[side].x * 18, y: p.y + DIRS[side].y * 18 };
      return svgToClient(q.x, q.y);
    },
    idsOf: function (elSym) { return st.mol.atoms.filter(function (a) { return a.el === elSym; }).map(function (a) { return a.id; }); }
  };
})();
