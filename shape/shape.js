/* shape.js — 電子対でみる分子のかたち（shape）の画面。M1: 原子を置く・タップで結合・電子式⇄構造式・判定・お題。M2: 形を見る（中心 → まとまり → 配置 → 形・2D と 3D）。
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
  // 結合していない原子の4つの側（電子式の書き方）: 0 上・1 右・2 下・3 左 の角度（度・画面の向き＝ y 下）
  var SIDE_ANG = [-90, 0, 90, 180];
  // 電子式の点の置き方（教科書・参考書の表と同じ: NH₃ の N は右・下・左に不対電子、上に非共有電子対）
  var PAIR_ORDER = [0, 3, 2, 1];
  var SINGLE_ORDER = [1, 2, 3, 0];

  /* ================================================================
     状態
     slots[id] は原子ごとの枠（スロット）の並び: [{ ang: 向き（度）, k: null｜'u'（不対電子）｜'p'（非共有電子対）｜{ b: 相手の id } }]。
     ★ 電子式の赤い点と構造式の手（赤い線の端）は、この同じ枠の2つの見え方（§3-1: 入力は1系統）。
     ★ 結合した原子の枠は「電子のまとまり」の数で開く（ユーザー決定 2026-09-26「結合角をできるだけ反映。
        正四面体の場合は直交 ✜」）: 4つ → 十字・3つ → 120°・2つ → 一直線。非共有電子対は空いた向きに置く。
        まとまりの数え方は model.js の domains と同じ（結合相手＋非共有電子対。組む途中は不対電子も1つずつ数える）
     ================================================================ */
  var st = {
    mol: M.create(), pos: {}, slots: {},
    history: [], mode: 'dot', check: false, sel: null,
    targets: [], taskIdx: 0, free: false, notice: null, ready: false,
    view: 'build', centerId: null, rotY: 0.55, rotX: -0.35
  };

  var $ = function (id) { return document.getElementById(id); };
  var svg = $('board');
  var svgShape = $('shapeView');

  /* ---- 座標変換（CLAUDE.md の約束: getScreenCTM 必須）----
     写した元: assembler/game.js `clientToSvg`（1725行）・`svgUnitsPerPixel`（1732行） */
  function clientToSvg(clientX, clientY, el) {
    var ctm = (el || svg).getScreenCTM();
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

  /* ---- 角度の道具（度）---- */
  function norm(a) { a = a % 360; if (a > 180) a -= 360; if (a <= -180) a += 360; return a; }
  function angDist(a, b) { return Math.abs(norm(a - b)); }
  function dirOf(a) { var r = a * Math.PI / 180; return { x: Math.cos(r), y: Math.sin(r) }; }
  function angTo(from, to) { return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI; }
  function snap90(a) { return norm(Math.round(a / 90) * 90); }

  /* ================================================================
     枠（スロット）の割り当て
     ================================================================ */
  // 結合していない原子: 上下左右の4か所（原子の電子式の書き方）
  function looseSlots(id) {
    var A = M.atomOf(st.mol, id);
    var s = SIDE_ANG.map(function (a) { return { ang: a, k: null }; });
    var lp = A.lp, un = A.un;
    PAIR_ORDER.forEach(function (k) { if (lp > 0) { s[k].k = 'p'; lp--; } });
    SINGLE_ORDER.forEach(function (k) { if (un > 0 && s[k].k === null) { s[k].k = 'u'; un--; } });
    return s;
  }

  // 組む途中の「まとまり」: 結合相手 ＋ 非共有電子対 ＋ 不対電子（1個ずつ）
  function groups(id) {
    var A = M.atomOf(st.mol, id);
    return M.bondsOf(st.mol, id).length + A.lp + A.un;
  }
  function openSlots(n, back) {
    var out = [];
    for (var k = 0; k < n; k++) out.push({ ang: norm(back + k * 360 / n), k: null });
    return out;
  }

  function unpairedSlots(id) {
    var s = st.slots[id] || [];
    var out = [];
    for (var k = 0; k < s.length; k++) if (s[k].k === 'u') out.push(k);
    return out;
  }
  // タップした向きに近い不対電子（1か所しか無ければそれ・§3-2）。ang が null（中心）なら最初のもの
  function pickUnpaired(id, ang) {
    var us = unpairedSlots(id);
    if (!us.length) return null;
    if (us.length === 1 || ang === null) return us[0];
    var s = st.slots[id];
    return us.slice().sort(function (a, b) { return angDist(s[a].ang, ang) - angDist(s[b].ang, ang); })[0];
  }

  /* ================================================================
     置き直し（§3-5・見た目だけ）: 結合のたびに分子全体を組み直す（中心 → 枠の向き → その先）
     ================================================================ */
  function degree(id) { return M.bondsOf(st.mol, id).length; }
  function other(b, u) { return b.a === u ? b.b : b.a; }
  function prioBonds(u) {
    return M.bondsOf(st.mol, u).slice().sort(function (p, q) {
      var ep = M.atomOf(st.mol, other(p, u)).el === 'H' ? 1 : 0, eq = M.atomOf(st.mol, other(q, u)).el === 'H' ? 1 : 0;
      return (q.order - p.order) || (ep - eq) || (other(p, u) - other(q, u));
    });
  }
  // タップで選んだ向き（hint）から、u から見た相手の向き
  function desired(b, u) {
    if (!b.hint) return null;
    if (b.hint.from === u) return b.hint.ang;
    if (b.hint.from === other(b, u)) return norm(b.hint.ang + 180);
    return null;
  }

  function relayout(anyId) {
    var comp = M.componentOf(st.mol, anyId);
    if (comp.length === 1) { st.slots[anyId] = looseSlots(anyId); return; }
    var root = comp.slice().sort(function (a, b) {
      var ha = M.atomOf(st.mol, a).el === 'H' ? 1 : 0, hb = M.atomOf(st.mol, b).el === 'H' ? 1 : 0;
      return (degree(b) - degree(a)) || (ha - hb) || (a - b);
    })[0];
    var rel = {}; rel[root] = { x: 0, y: 0 };
    var slots = {};
    var rb = prioBonds(root);
    var d0 = rb.length ? desired(rb[0], root) : null;
    slots[root] = openSlots(groups(root), d0 === null ? 0 : snap90(d0)); // 中心の十字・一直線は縦横にそろえる
    var inAng = {};
    var queue = [root];
    var placedList = [root];
    while (queue.length) {
      var u = queue.shift();
      prioBonds(u).forEach(function (b) {
        var v = other(b, u);
        if (rel[v]) return;
        var want = desired(b, u);
        if (want === null) want = inAng[u] !== undefined ? inAng[u] : null; // 指定が無ければまっすぐ先へ
        var free = [];
        slots[u].forEach(function (sl, k) { if (sl.k === null) free.push(k); });
        if (!free.length) { slots[u].push({ ang: norm((inAng[u] || 0) + 45), k: null }); free = [slots[u].length - 1]; }
        // まとまり4（正四面体）の原子の2本目の結合は、1本目の反対（180°）に置かない（H₂O・H₂O₂ は L 字 ＝ 109.5° を 90° で見せる）
        var bondAngs = slots[u].filter(function (sl) { return sl.k && typeof sl.k === 'object'; }).map(function (sl) { return sl.ang; });
        var opp = function (k) {
          return (slots[u].length === 4 && bondAngs.length === 1 && angDist(slots[u][k].ang, bondAngs[0]) > 135) ? 1 : 0;
        };
        free.sort(function (p, q) {
          return (opp(p) - opp(q)) || (want === null ? 0 : angDist(slots[u][p].ang, want) - angDist(slots[u][q].ang, want));
        });
        // 分子の中の原子に重なる向きは避ける（避けられないときだけ重ねる）
        var pick = free[0];
        for (var i = 0; i < free.length; i++) {
          var dd = dirOf(slots[u][free[i]].ang);
          var tp = { x: rel[u].x + dd.x * L, y: rel[u].y + dd.y * L };
          var clash = placedList.some(function (w) { return Math.hypot(rel[w].x - tp.x, rel[w].y - tp.y) < L * 0.6; });
          if (!clash) { pick = free[i]; break; }
        }
        var ang = slots[u][pick].ang;
        slots[u][pick].k = { b: v };
        var d = dirOf(ang);
        rel[v] = { x: rel[u].x + d.x * L, y: rel[u].y + d.y * L };
        inAng[v] = ang;
        slots[v] = openSlots(groups(v), norm(ang + 180));
        slots[v][0].k = { b: u };
        placedList.push(v);
        queue.push(v);
      });
    }
    // 環を閉じる結合（木の外の辺）: 相手の向きにいちばん近い空き枠へ
    comp.forEach(function (u) {
      M.bondsOf(st.mol, u).forEach(function (b) {
        var v = other(b, u);
        if (slots[u].some(function (sl) { return sl.k && sl.k.b === v; })) return;
        var a = angTo(rel[u], rel[v]);
        var free = [];
        slots[u].forEach(function (sl, k) { if (sl.k === null) free.push(k); });
        if (free.length) {
          free.sort(function (p, q) { return angDist(slots[u][p].ang, a) - angDist(slots[u][q].ang, a); });
          slots[u][free[0]].ang = a;
          slots[u][free[0]].k = { b: v };
        } else slots[u].push({ ang: a, k: { b: v } });
      });
    });
    // 非共有電子対と不対電子を空いた枠へ。非共有電子対は結合の反対側から（HCN の N は右に「:」）
    comp.forEach(function (u) {
      var A = M.atomOf(st.mol, u);
      var vx = 0, vy = 0;
      slots[u].forEach(function (sl) { if (sl.k) { var d = dirOf(sl.ang); vx += d.x; vy += d.y; } });
      var free = [];
      slots[u].forEach(function (sl, k) { if (sl.k === null) free.push(k); });
      free.sort(function (p, q) {
        var dp = dirOf(slots[u][p].ang), dq = dirOf(slots[u][q].ang);
        return (dp.x * vx + dp.y * vy) - (dq.x * vx + dq.y * vy);
      });
      var lp = A.lp, un = A.un;
      free.forEach(function (k) {
        if (lp > 0) { slots[u][k].k = 'p'; lp--; }
        else if (un > 0) { slots[u][k].k = 'u'; un--; }
      });
    });
    comp.forEach(function (id) { st.slots[id] = slots[id]; st.pos[id] = { x: rel[id].x, y: rel[id].y }; });
    centerComponent(comp); // 組んでいる分子を台の中央へ（ユーザー指摘: 分子が下に寄っていた）
    clampComponent(comp);
    pushOthersAway(comp);
  }

  function bbox(ids) {
    var xs = ids.map(function (id) { return st.pos[id].x; }), ys = ids.map(function (id) { return st.pos[id].y; });
    return { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs), minY: Math.min.apply(null, ys), maxY: Math.max.apply(null, ys) };
  }
  function shiftIds(ids, dx, dy) { ids.forEach(function (id) { st.pos[id] = { x: st.pos[id].x + dx, y: st.pos[id].y + dy }; }); }

  function centerComponent(comp) {
    var b = bbox(comp);
    shiftIds(comp, VIEW_W / 2 - (b.minX + b.maxX) / 2, VIEW_H / 2 - (b.minY + b.maxY) / 2);
  }

  function clampComponent(comp) {
    var b = bbox(comp);
    var dx = 0, dy = 0;
    if (b.maxX > VIEW_W - MARGIN) dx = VIEW_W - MARGIN - b.maxX;
    if (b.minX + dx < MARGIN) dx = MARGIN - b.minX;
    if (b.maxY > VIEW_H - MARGIN) dy = VIEW_H - MARGIN - b.maxY;
    if (b.minY + dy < MARGIN) dy = MARGIN - b.minY;
    if (dx || dy) shiftIds(comp, dx, dy);
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
      var oth = M.componentOf(st.mol, a.id);
      oth.forEach(function (id) { done.add(id); });
      var fixed = st.mol.atoms.map(function (x) { return x.id; }).filter(function (id) { return oth.indexOf(id) < 0; });
      var clash = oth.some(function (id) { return minDistTo(st.pos[id], comp) < L * 0.9; });
      if (clash) moveToFree(oth, fixed);
    });
  }

  function moveToFree(ids, fixed) {
    var ref = st.pos[ids[0]];
    var rl = ids.map(function (id) { return { id: id, x: st.pos[id].x - ref.x, y: st.pos[id].y - ref.y }; });
    var best = null, bestD = Infinity;
    for (var y = MARGIN; y <= VIEW_H - MARGIN; y += 10) {
      for (var x = MARGIN; x <= VIEW_W - MARGIN; x += 10) {
        var okAll = rl.every(function (r) {
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
    rl.forEach(function (r) { st.pos[r.id] = { x: best.x + r.x, y: best.y + r.y }; });
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
      slots: JSON.parse(JSON.stringify(st.slots))
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
    st.slots[id] = looseSlots(id);
    return id;
  }

  function addFromPalette(el) {
    if (st.view !== 'build') return;
    pushHistory();
    st.sel = null;
    placeAtom(el);
    st.notice = null;
    update();
  }

  // お題の原子を並べて置く（結合はしない）。台の真ん中を中心に並べる
  function setupBoard() {
    st.mol = M.create(); st.pos = {}; st.slots = {}; st.sel = null; st.history = []; st.notice = null;
    st.view = 'build'; st.centerId = null; st.wasComplete = false; st.check = false;
    if (!st.free && st.targets[st.taskIdx]) {
      var els = st.targets[st.taskIdx].atoms;
      var cols = Math.min(els.length, 3), rows = Math.ceil(els.length / 3);
      els.forEach(function (el, i) {
        var c = i % 3, r = Math.floor(i / 3);
        placeAtom(el, { x: VIEW_W / 2 + (c - (cols - 1) / 2) * 110, y: VIEW_H / 2 + (r - (rows - 1) / 2) * 100 });
      });
    }
    update();
  }

  function say(text, kind) { st.notice = { text: text, kind: kind || 'warn' }; }

  // 不対電子どうしで結合し、分子を組み直す（タップとお題の自動組み立ての共通の入口）
  function bondAtoms(a, sA, b) {
    var hint = (sA !== null && st.slots[a][sA]) ? { from: a, ang: st.slots[a][sA].ang } : null;
    var r = M.bond(st.mol, a, b, hint);
    if (r.ok) relayout(a);
    return r;
  }

  function tapAtom(id, ang) {
    var A = M.atomOf(st.mol, id);
    st.notice = null;
    if (!st.sel) {
      if (A.un < 1) { say('この原子には不対電子がありません'); update(); return; }
      st.sel = { id: id, slot: pickUnpaired(id, ang) };
      say('相手の原子をタップしよう', 'info');
      update();
      return;
    }
    if (st.sel.id === id) {
      var s2 = pickUnpaired(id, ang);
      if (s2 === st.sel.slot) st.sel = null;
      else { st.sel.slot = s2; say('相手の原子をタップしよう', 'info'); }
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
    var a = st.sel.id, sA = st.sel.slot;
    pushHistory();
    st.sel = null;
    bondAtoms(a, sA, id);
    update();
  }

  // お題をそのまま組む（?view=shape で形の画面から始めるとき）
  function assembleTarget() {
    var t = st.targets[st.taskIdx];
    if (!t) return;
    var ids = st.mol.atoms.map(function (x) { return x.id; });
    t.bonds.forEach(function (bd) {
      for (var o = 0; o < bd[2]; o++) bondAtoms(ids[bd[0]], pickUnpaired(ids[bd[0]], 0), ids[bd[1]]); // 右向きから（C=C・O=C=O を横に）
    });
  }

  function undo() {
    var h = st.history.pop();
    if (!h) return;
    st.mol = h.mol; st.pos = h.pos; st.slots = h.slots; st.sel = null; st.notice = null;
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
  // 原子の中心からの向き（度）。的は原子のまわりの扇形（§3-2）。中心の近くは「向きなし」
  function angAt(id, p) {
    var q = st.pos[id];
    if (Math.hypot(p.x - q.x, p.y - q.y) < 4) return null;
    return angTo(q, p);
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
    tapAtom(d.id, angAt(d.id, p));
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

  // 形の画面の1行（配置と形の名前は SVG の中に別々に出す。ここは理由の1行）
  function shapeLine(sh) {
    if (sh.twoAtoms) return '原子が2個の分子は、いつも直線';
    if (!sh.supported) return 'この形はここでは扱いません';
    if (sh.lone === 0) return '非共有電子対が無いので、配置どおりの形';
    if (sh.domains === 4) return '結合角は 109.5° より少し狭い';
    if (sh.domains === 3) return '結合角は 120° より少し狭い';
    return '非共有電子対は形の名前に数えない';
  }

  function update() {
    var ev = evaluate();
    st.last = ev;
    if (ev.complete && !st.wasComplete) st.check = true; // 完成したら数を確かめる（参考書の確かめの図と同じ）
    st.wasComplete = ev.complete;
    st.shape = M.moleculeShape(st.mol, st.centerId);
    if (st.view === 'shape' && !st.shape) st.view = 'build';
    var msg = $('msg');
    var text, kind;
    if (st.view === 'shape') { text = shapeLine(st.shape); kind = 'info'; }
    else { var n = st.notice; text = n ? n.text : ev.text; kind = n ? n.kind : ev.kind; }
    msg.textContent = text;
    msg.className = 'msg' + (kind ? ' ' + kind : '');
    if (st.view === 'shape') renderShape(); else render();
    renderBars();
    spinControl();
  }

  /* ================================================================
     描画（組む台）
     ================================================================ */
  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, cls, extra) {
    var a = { x: x, y: y, 'class': cls, 'text-anchor': 'middle', 'dominant-baseline': 'central' };
    for (var k in (extra || {})) a[k] = extra[k];
    var t = el('text', a, parent);
    t.textContent = s;
    return t;
  }
  function dot(g, x, y, cls) { el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.4, 'class': cls }, g); }

  // 元素記号のまわりの点の位置（2文字の記号は横に広げる）
  function slotPoint(p, sym, ang) {
    var d = dirOf(ang);
    var rx = sym.length > 1 ? 19 : 14, ry = 15;
    return { x: p.x + d.x * rx, y: p.y + d.y * ry, d: d };
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

    // 選んだ枠の扇形
    if (st.sel && st.sel.slot !== null && st.slots[st.sel.id]) {
      var sp = st.pos[st.sel.id], sls = st.slots[st.sel.id];
      var mid = sls[st.sel.slot].ang * Math.PI / 180;
      var half = Math.min(45, 180 / Math.max(sls.length, 1)) * Math.PI / 180;
      var R = HIT + 4, a0 = mid - half, a1 = mid + half;
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
      txt(g, p.x, p.y, a.el, 'sym');
      (st.slots[a.id] || []).forEach(function (sl) {
        if (sl.k !== 'u' && sl.k !== 'p') return;
        var q = slotPoint(p, a.el, sl.ang);
        if (st.mode === 'dot') {
          if (sl.k === 'u') dot(g, q.x, q.y, 'e-un');
          else {
            var px = -q.d.y * 4.6, py = q.d.x * 4.6;
            dot(g, q.x + px, q.y + py, 'e-lp');
            dot(g, q.x - px, q.y - py, 'e-lp');
          }
        } else if (sl.k === 'u') {
          // 構造式では不対電子を「手」（赤い線の端）で描く。非共有電子対は構造式では書かない
          var q2 = slotPoint(p, a.el, sl.ang);
          el('line', {
            x1: (p.x + (q2.x - p.x) * 0.8).toFixed(1), y1: (p.y + (q2.y - p.y) * 0.8).toFixed(1),
            x2: (p.x + (q2.x - p.x) * 1.5).toFixed(1), y2: (p.y + (q2.y - p.y) * 1.5).toFixed(1), 'class': 'hand'
          }, g);
        }
      });
    });
  }

  /* ================================================================
     形を見る（M2・§3-4・§4-3）: 2D の模式図（左）と 3D（右・回せる）
     3D は SVG の投影。写した元: assembler/stereo.js の `StereoView.rotateYX`（2457行）と
     `drawPane`（2574行）の投影（k = PERSP / (PERSP − z·BOND)・z でソート・奥ほど暗い 0.45 + 0.55·(z+1)/2）、
     `bindDrag`（2269行）の「掴んだら止め・離したら自動回転を再開」。three.js は使わない（§4-3 の決定）。
     ⚠ SVG は台と同じ固定の viewBox・同じ高さ（中身で高さを決めさせない＝埋め込みの高さ通知が発振しない）
     ================================================================ */
  var P2 = { x: 100, y: 178 }, P3 = { x: 300, y: 178 };
  var B2 = 60, B3 = 62, PERSP = 300, HUB = 15;

  // 写した元: assembler/stereo.js `StereoView.rotateYX`（2457行）。中身は変えていない
  function rotateYX(v, angleY, angleX) {
    var cx = Math.cos(angleX), sx = Math.sin(angleX);
    var cy = Math.cos(angleY), sy = Math.sin(angleY);
    var x1 = v[0] * cy + v[2] * sy;
    var y1 = v[1];
    var z1 = -v[0] * sy + v[2] * cy;
    return [x1, y1 * cx - z1 * sx, y1 * sx + z1 * cx];
  }

  function shapeItems() {
    var sh = st.shape;
    if (!sh) return [];
    if (sh.twoAtoms) {
      var b = st.mol.bonds[0];
      return [
        { kind: 'atom', el: M.atomOf(st.mol, b.a).el, v: [-0.5, 0, 0] },
        { kind: 'atom', el: M.atomOf(st.mol, b.b).el, v: [0.5, 0, 0], order: b.order }
      ];
    }
    return M.shapeGeometry(st.mol, sh.center);
  }

  function lobe(g, cx, cy, vx, vy, scale, cls) {
    var len = Math.hypot(vx, vy);
    var ang = Math.atan2(vy, vx) * 180 / Math.PI;
    var rx = (8 + 15 * len) * scale, ry = 11 * scale;
    var mx = cx + vx * 0.5 * B2 * scale, my = cy + vy * 0.5 * B2 * scale;
    var gg = el('g', { transform: 'rotate(' + ang.toFixed(1) + ' ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ')', 'class': cls }, g);
    el('ellipse', { cx: mx.toFixed(1), cy: my.toFixed(1), rx: rx.toFixed(1), ry: ry.toFixed(1), 'class': 'lobe' }, gg);
    dot(gg, mx, my - 4, 'e-lp');
    dot(gg, mx, my + 4, 'e-lp');
  }

  function bondLines(g, x1, y1, x2, y2, order, width, cls) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var offs = order === 2 ? [-3.2, 3.2] : order === 3 ? [-5, 0, 5] : [0];
    offs.forEach(function (o) {
      el('line', { x1: (x1 + nx * o).toFixed(1), y1: (y1 + ny * o).toFixed(1), x2: (x2 + nx * o).toFixed(1), y2: (y2 + ny * o).toFixed(1),
        'class': cls || 'bond', 'stroke-width': width }, g);
    });
  }

  /* 模式図の上での向き。紙面の結合（z≈0）はそのまま。手前・奥の結合は、正射影だと同じ点に重なる
     （正四面体の右下の2本）ので、教科書の書き方の位置へ開く: 手前（くさび）は右下・奥（破線）は右 */
  function disp2D(v, n) {
    if (Math.abs(v[2]) < 0.3) return [v[0], v[1]];
    if (n === 4) return v[2] > 0 ? [0.42, 0.78] : [0.95, -0.02];
    return [v[0] + 0.35 * v[2], v[1] + 0.45 * v[2]]; // 5・6 まとまり（M4）は斜めの投影
  }

  function render2D(g) {
    var sh = st.shape, items = shapeItems();
    if (sh.twoAtoms) {
      var a = items[0], b = items[1];
      bondLines(g, P2.x - 30 + 13, P2.y, P2.x + 30 - 13, P2.y, b.order, 2.4);
      txt(g, P2.x - 30, P2.y, a.el, 'sym s2');
      txt(g, P2.x + 30, P2.y, b.el, 'sym s2');
      return;
    }
    var bonds2 = [];
    items.forEach(function (it) {
      var dv = disp2D(it.v, items.length), v = [dv[0], dv[1], it.v[2]], ex = P2.x + v[0] * B2, ey = P2.y + v[1] * B2;
      if (it.kind === 'lp') { lobe(g, P2.x, P2.y, v[0], v[1], 1, 'lp2d' + (v[2] < -0.3 ? ' back' : '')); return; }
      var sx = P2.x + v[0] * 14, sy = P2.y + v[1] * 14, tx = P2.x + v[0] * (B2 - 12), ty = P2.y + v[1] * (B2 - 12);
      if (v[2] > 0.3) {
        // 手前へ出る結合は塗ったくさび
        var nx = -(ty - sy), ny = tx - sx, nl = Math.hypot(nx, ny) || 1;
        nx = nx / nl * 5; ny = ny / nl * 5;
        el('path', { d: 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' L' + (tx + nx).toFixed(1) + ' ' + (ty + ny).toFixed(1) +
          ' L' + (tx - nx).toFixed(1) + ' ' + (ty - ny).toFixed(1) + ' Z', 'class': 'wedge' }, g);
      } else if (v[2] < -0.3) {
        // 奥へ向かう結合は破線のくさび
        for (var i = 1; i <= 6; i++) {
          var f = i / 6, cx = sx + (tx - sx) * f, cy = sy + (ty - sy) * f;
          var px = -(ty - sy), py = tx - sx, pl = Math.hypot(px, py) || 1, w = 5 * f;
          el('line', { x1: (cx + px / pl * w).toFixed(1), y1: (cy + py / pl * w).toFixed(1), x2: (cx - px / pl * w).toFixed(1), y2: (cy - py / pl * w).toFixed(1), 'class': 'hash' }, g);
        }
      } else {
        bondLines(g, sx, sy, tx, ty, it.order, 2.4);
        bonds2.push(it);
      }
      txt(g, ex, ey, it.el, 'sym s2');
    });
    txt(g, P2.x, P2.y, M.atomOf(st.mol, sh.center).el, 'sym s2 center');
    // 結合角: 非共有電子対が無いときだけ、表の理想の角を紙面の2本のあいだに書く（あるときは文で「少し狭い」）
    if (sh.lone === 0 && sh.idealAngle && bonds2.length >= 2) {
      var a1 = Math.atan2(bonds2[0].v[1], bonds2[0].v[0]), a2 = Math.atan2(bonds2[1].v[1], bonds2[1].v[0]);
      var d = Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1));
      var r = 24, mid = a1 + d / 2;
      if (Math.abs(Math.abs(d) - Math.PI) < 1e-6) { d = Math.PI; mid = a1 + Math.PI / 2; } // 180° は下側に弧
      el('path', { d: 'M' + (P2.x + r * Math.cos(a1)).toFixed(1) + ' ' + (P2.y + r * Math.sin(a1)).toFixed(1) +
        ' A' + r + ' ' + r + ' 0 0 ' + (d > 0 ? 1 : 0) + ' ' + (P2.x + r * Math.cos(a1 + d)).toFixed(1) + ' ' + (P2.y + r * Math.sin(a1 + d)).toFixed(1),
        'class': 'arc' }, g);
      txt(g, P2.x + 44 * Math.cos(mid), P2.y + 44 * Math.sin(mid), sh.idealAngle, 'angLabel');
    }
  }

  function render3D() {
    var g = $('shape3d');
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    var sh = st.shape;
    if (!sh) return;
    var list = shapeItems().map(function (it) {
      var v = rotateYX(it.v, st.rotY, st.rotX);
      var k = PERSP / (PERSP - v[2] * B3); // 手前（z+）ほど大きい
      return { it: it, v: v, z: v[2], k: k, x: P3.x + v[0] * B3 * k, y: P3.y + v[1] * B3 * k };
    });
    if (!sh.twoAtoms) list.push({ center: true, z: 0, k: 1, x: P3.x, y: P3.y });
    list.sort(function (a, b) { return a.z - b.z; });
    if (sh.twoAtoms) {
      var gb = el('g', {}, g);
      bondLines(gb, list[0].x, list[0].y, list[1].x, list[1].y, list[0].it.order || list[1].it.order, 2.6, 'bond3');
    }
    list.forEach(function (o) {
      var gg = el('g', { opacity: (0.45 + 0.55 * (o.z + 1) / 2).toFixed(2) }, g); // 奥ほど暗い
      if (o.center) {
        el('circle', { cx: o.x, cy: o.y, r: HUB, 'class': 'hub' }, gg);
        txt(gg, o.x, o.y, M.atomOf(st.mol, sh.center).el, 'sym s3');
        return;
      }
      if (o.it.kind === 'lp') { lobe(gg, P3.x, P3.y, o.v[0] * o.k * B3 / B2, o.v[1] * o.k * B3 / B2, 1, 'lp3d'); return; }
      if (!sh.twoAtoms) {
        var len = Math.hypot(o.x - P3.x, o.y - P3.y), t = len > 1 ? Math.min(0.9, HUB / len) : 0; // 中心の円のふちから引く
        bondLines(gg, P3.x + (o.x - P3.x) * t, P3.y + (o.y - P3.y) * t, o.x, o.y, o.it.order, (2.6 * o.k).toFixed(2), 'bond3');
      }
      el('circle', { cx: o.x.toFixed(1), cy: o.y.toFixed(1), r: (12 * o.k).toFixed(1), 'class': 'ball' }, gg);
      txt(gg, o.x, o.y, o.it.el, 'sym s3', { style: 'font-size:' + (15 * o.k).toFixed(1) + 'px' });
    });
  }

  function renderShape() {
    while (svgShape.firstChild) svgShape.removeChild(svgShape.firstChild);
    var sh = st.shape;
    if (!sh) return;
    var head = el('g', { 'class': 'shapeHead' }, svgShape);
    if (sh.twoAtoms) {
      txt(head, 200, 24, '原子が2個だけの分子', 'hd1');
      txt(head, 200, 52, '直線形', 'hd2 shp');
    } else {
      txt(head, 200, 24, '中心 ' + sh.el + '・電子のまとまり ' + sh.domains + ' 組', 'hd1 dom');
      var arr = el('text', { x: 200, y: 52, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': 'hd2' }, head);
      var t1 = document.createElementNS(SVGNS, 'tspan'); t1.setAttribute('class', 'arr'); t1.textContent = (sh.arrangement || '？') + 'の配置';
      var t2 = document.createElementNS(SVGNS, 'tspan'); t2.textContent = ' → ';
      var t3 = document.createElementNS(SVGNS, 'tspan'); t3.setAttribute('class', 'shp');
      t3.textContent = (sh.shape || 'この形は扱わない') + (sh.advanced ? '（発展）' : '');
      arr.appendChild(t1); arr.appendChild(t2); arr.appendChild(t3);
    }
    render2D(el('g', { 'class': 'pane2d' }, svgShape));
    el('g', { id: 'shape3d', 'class': 'pane3d' }, svgShape);
    render3D();
    txt(svgShape, P2.x, 286, '模式図', 'cap');
    txt(svgShape, P3.x, 286, '立体（ドラッグで回る）', 'cap');
  }

  /* ---- 3D の回転（自動回転とドラッグ）---- */
  var raf = null, spinLast = null, drag3 = null;
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* noop */ }
  function spinControl() {
    var want = st.view === 'shape' && !reduceMotion && !drag3 && !st.noSpin;
    if (want && raf === null) {
      spinLast = null;
      var step = function (t) {
        if (spinLast === null) spinLast = t;
        var dt = Math.min(50, t - spinLast);
        spinLast = t;
        st.rotY += dt * 0.0007; // 約40°/秒（stereo.js と同じ）
        render3D();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    } else if (!want && raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }
  svgShape.addEventListener('pointerdown', function (e) {
    drag3 = { p: clientToSvg(e.clientX, e.clientY, svgShape), pid: e.pointerId };
    spinControl();
    try { svgShape.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    e.preventDefault();
  });
  svgShape.addEventListener('pointermove', function (e) {
    if (!drag3) return;
    var now = clientToSvg(e.clientX, e.clientY, svgShape);
    if (!now || !drag3.p) return;
    st.rotY += (now.x - drag3.p.x) / B3;
    st.rotX -= (now.y - drag3.p.y) / B3; // 下へドラッグ＝手前が下がる
    drag3.p = now;
    render3D();
  });
  function end3(e) {
    if (!drag3) return;
    try { svgShape.releasePointerCapture(drag3.pid); } catch (err) { /* noop */ }
    drag3 = null;
    spinControl(); // 離したら自動回転を再開
  }
  svgShape.addEventListener('pointerup', end3);
  svgShape.addEventListener('pointercancel', end3);

  function setView(v) {
    if (v === 'shape' && !M.moleculeShape(st.mol, st.centerId)) return;
    st.view = v;
    st.sel = null;
    update();
  }

  function renderBars() {
    var t = currentTarget();
    var shapeMode = st.view === 'shape';
    $('taskMode').className = st.free ? '' : 'on';
    $('freeMode').className = st.free ? 'on' : '';
    $('taskLabel').textContent = t ? t.formula + '（' + t.name + '）をつくろう' : '原子を置いて組もう';
    $('prevTask').disabled = st.free || st.taskIdx <= 0;
    $('nextTask').disabled = st.free || st.taskIdx >= st.targets.length - 1;
    $('buildView').className = shapeMode ? '' : 'on';
    $('shapeViewBtn').className = shapeMode ? 'on' : '';
    $('shapeViewBtn').disabled = !st.shape;
    $('dotMode').className = st.mode === 'dot' ? 'on' : '';
    $('lineMode').className = st.mode === 'line' ? 'on' : '';
    $('dotMode').disabled = $('lineMode').disabled = shapeMode;
    $('checkBtn').className = st.check ? 'on' : '';
    $('checkBtn').disabled = shapeMode;
    $('undoBtn').disabled = !st.history.length;
    // 形の画面では、台と同じ場所に形を出す（高さは同じ）。台の道具は隠す（場所は残す）
    svg.style.display = shapeMode ? 'none' : '';
    svgShape.style.display = shapeMode ? '' : 'none';
    $('palette').style.visibility = shapeMode ? 'hidden' : '';
    $('undoBtn').style.display = $('resetBtn').style.display = shapeMode ? 'none' : '';
    var cb = $('centerBtn');
    cb.style.display = shapeMode ? '' : 'none';
    cb.style.visibility = (shapeMode && st.shape && st.shape.candidates && st.shape.candidates.length > 1) ? '' : 'hidden';
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
    $('buildView').addEventListener('click', function () { setView('build'); });
    $('shapeViewBtn').addEventListener('click', function () { setView('shape'); });
    $('dotMode').addEventListener('click', function () { st.mode = 'dot'; update(); });
    $('lineMode').addEventListener('click', function () { st.mode = 'line'; update(); });
    $('checkBtn').addEventListener('click', function () { st.check = !st.check; update(); });
    $('undoBtn').addEventListener('click', undo);
    $('resetBtn').addEventListener('click', setupBoard);
    // 中心の候補が2つ以上ある分子（C₂H₄・H₂O₂ など）だけ、もう一方の中心へ切り替える（ユーザー決定）
    $('centerBtn').addEventListener('click', function () {
      var c = st.shape && st.shape.candidates;
      if (!c || c.length < 2) return;
      st.centerId = c[(c.indexOf(st.shape.center) + 1) % c.length];
      update();
    });
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
    var found = !m || st.targets[st.taskIdx].id === m;
    if (!found) { say('そのお題はまだありません'); update(); }
    // &view=shape … お題を組んだ姿で、形の画面から始める（§5-1。素の URL でも同じに効く）
    if (found && m && q.get('view') === 'shape') {
      assembleTarget();
      st.history = [];
      setView('shape');
    }
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
    shapeSvg: svgShape,
    // 原子の中心（side 0 上・1 右・2 下・3 左 を渡すとその向きの扇形の中の点）を client 座標で返す
    clientOf: function (id, side) {
      var p = st.pos[id];
      if (!p) return null;
      var q = side === undefined || side === null ? p : { x: p.x + dirOf(SIDE_ANG[side]).x * 18, y: p.y + dirOf(SIDE_ANG[side]).y * 18 };
      return svgToClient(q.x, q.y);
    },
    idsOf: function (elSym) { return st.mol.atoms.filter(function (a) { return a.el === elSym; }).map(function (a) { return a.id; }); },
    // 2つの結合の間の角（度・台の上の見た目）
    angleAt: function (center, p, q) {
      var a = angTo(st.pos[center], st.pos[p]), b = angTo(st.pos[center], st.pos[q]);
      return angDist(a, b);
    },
    stopSpin: function () { st.noSpin = true; spinControl(); }
  };
})();
