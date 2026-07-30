// 比例式でみる化学計算 — 反応の量的関係（M3）
// 比例式モードの【倍率が同じ】をそのまま反応式に広げたモード。
//   係数の行が基準 → 実際に反応した量は「係数 × 倍率 x」
//   x ＝ 反応が何 mol 分進んだか。同じ x が全部の物質にはたらく。
// 過不足は【倍率の比べっこ】。mol ÷ 係数 が一番小さいところで反応は止まる。
// 学習の流れ: 限定反応物をえらぶ（steps.limit）→ 倍率 x を入れる（steps.x）
//              → 変化量の行が自動で埋まる → 問われているセルを計算する
(function () {
  'use strict';

  var M = window.ChemRatio;
  var R = M.REACTIONS;

  // 過不足の図（横棒）。**帯を分けて重なりを防ぐ**（天秤で踏んだ落とし穴と同じ）:
  //   ラベル列 6〜135 ／ 棒 140〜390 ／ 値 396〜 ／ 注記は棒より下
  var LX = 6, BX0 = 140, BW = 250, VX = 396;
  var ROW_Y = 22, ROW_H = 18, ROW_GAP = 34;
  var NOTE_Y = 104;

  var state = {
    idx: 0,
    conv: {}, convLocked: {},   // ① mol にそろえる（g・L で与えられた物質ごと）
    limitPick: null,            // ② えらんだ限定反応物
    x: '',                      // ③ 倍率の入力
    xLocked: false,             // 倍率が正しく入り、変化量の行が埋まった
    tableInput: '', tableLocked: false,  // ④ 表の中の答え（mol）
    input: '',                  // ⑤ 答え（単位を戻したもの。mol の問題ではこれだけ）
    solved: {}
  };

  var el = {};
  ['stageNav', 'qTitle', 'qHint', 'eqBox', 'convIn', 'barsWrap', 'barsHead', 'bars',
   'limitBar', 'board', 'convOut', 'checkBtn', 'nextBtn', 'msg']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  function problem() { return R[state.idx]; }
  function needIn(p) { return !!(p.steps && p.steps.in); }
  function needLimit(p) { return !!(p.steps && p.steps.limit); }
  function needX(p) { return !!(p.steps && p.steps.x); }
  // g・L を mol にそろえる段が済んだか。**比べられるのは mol だけ**なので最初に来る
  function inOk(p) {
    if (!needIn(p)) return true;
    return M.convTargets(p).every(function (k) { return !!state.convLocked[k]; });
  }
  // 限定反応物を選ぶ段階が済んだか（ちょうど反応ならどちらでも正しい）
  function limitOk(p) {
    return !needLimit(p) || (!!state.limitPick && M.checkLimiting(p, state.limitPick));
  }
  function xOk(p) { return !needX(p) || state.xLocked; }
  // 表の中の答え（mol）まで進んだか。単位を戻す段がない問題では表のセルが解答そのもの
  function tableOk(p) { return !M.hasOut(p) || state.tableLocked; }
  function tableReady(p) { return inOk(p) && limitOk(p) && xOk(p); }
  function answerReady(p) { return tableReady(p) && tableOk(p); }
  // 問われているセルがどの行にあるか。使われた量は変化量の行、それ以外は反応後の行
  function askedRow(p) { return p.askedOf === 'used' ? 'change' : 'after'; }

  function formula(key) { return M.SUBSTANCES[key].formula; }

  // 表の中で使っている単位。**mol を使わなくてよいときは使わない**方針なので、
  // 気体同士の反応では 'L' になる。画面の文言は必ずここを通す（mol を決め打ちしない）
  function unitText(p) { return M.QUANTITIES[M.workUnit(p)].unit; }
  // 候補倍率の言い方（「mol ÷ 係数」または「L ÷ 係数」）
  function divLabel(p) { return unitText(p) + ' ÷ 係数'; }

  // 気体でない物質を L で数えている列への注記。
  // 量をそろえるための仮想の値であって、実際にその体積になるわけではない。
  function virtualNote(p) {
    var vs = M.virtualSubs(p);
    if (!vs.length) return '';
    return '<span class="vnote">※ ' +
      vs.map(function (k) { return M.plainLabel(formula(k)); }).join('・') +
      ' は気体ではないので、この L は<b>量をそろえるための仮想の値</b>' +
      '（実際に ' + M.disp(M.MOLAR_VOLUME) + ' L にはならない）</span>';
  }

  // 倍率・候補倍率の表示。問題の桁にそろえる（0.15・0.10）。
  // 倍率は答えではなく計算の途中の値なので、割り切れないときは
  // 丸めた値を断定せずに桁を足して … を付ける（分数と小数の対照表と同じ流儀）。
  function xText(p, v) {
    if (Math.abs(v) < 1e-12) return '0';
    var s = M.toSig(v, p.sig);
    return Math.abs(parseFloat(s) - v) <= Math.abs(v) * 1e-9
      ? s : M.toSig(v, p.sig + 2) + '…';
  }

  // 候補倍率の式（mol ÷ 係数）。**必ず mol の値で書く**。
  // 与えられた量そのもの（g・L）で書くと係数で割る意味が消えるうえ、
  // given が { v, q } のときに値を直接読むと NaN になる。
  function quotText(p, c) {
    return M.stoichDisp(c.before, p.sig) + '÷' + c.coef;
  }

  function renderNav() {
    el.stageNav.innerHTML = '';
    R.forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = String(i + 1);
      if (i === state.idx) b.className = 'active';
      else if (state.solved[p.id]) b.className = 'cleared';
      b.onclick = function () { setProblem(i); };
      el.stageNav.appendChild(b);
    });
  }

  // 反応式は**与えられたもの**として示す（係数を決めるのは ion-equation の担当）
  function renderEqBox() {
    var p = problem();
    el.eqBox.innerHTML = '<span class="eqLabel">反応式</span>' +
      '<span class="eq">' + p.eqText + '</span>' +
      '<span class="eqTag">係数は与えられている</span>';
  }

  // ---- ① mol にそろえる（入口の変換）----
  // 係数の比が使えるのは mol だけ。g や L はここで mol に直してから表に入れる。
  function renderConvIn() {
    var p = problem();
    var keys = M.convTargets(p);
    el.convIn.innerHTML = '';
    if (!keys.length) return;

    keys.forEach(function (k) {
      var g = M.givenSpec(p, k);
      el.convIn.appendChild(convRow({
        step: 'まず mol にそろえる',
        from: formula(k) + ' ' + M.disp(g.v) + ' ' + M.QUANTITIES[g.q].unit,
        why: M.perMolText(k, g.q),
        unit: 'mol',
        locked: !needIn(p) || !!state.convLocked[k],
        value: (!needIn(p) || state.convLocked[k])
          ? M.stoichDisp(M.beforeOf(p, k), p.sig) : state.conv[k] || '',
        id: 'conv-' + k,
        enabled: true,
        oninput: function (v) { state.conv[k] = v; tryLockConv(k); }
      }));
    });
  }

  // ---- ⑤ 単位を戻す（出口の変換）----
  function renderConvOut() {
    var p = problem();
    el.convOut.innerHTML = '';
    if (!M.hasOut(p)) return;
    var u = M.askedUnit(p);
    el.convOut.appendChild(convRow({
      step: '答えの単位に戻す',
      from: formula(p.asked) + ' ' +
        (state.tableLocked ? M.stoichDisp(M.tableAnswer(p), p.sig) : '?') + ' mol',
      why: M.perMolText(p.asked, u),
      unit: M.QUANTITIES[u].unit,
      locked: false,
      value: state.input,
      id: 'answer',
      enabled: answerReady(p),
      oninput: function (v) { state.input = v; }
    }));
  }

  function convRow(o) {
    var row = document.createElement('div');
    row.className = 'convRow' + (o.locked ? ' locked' : '');
    row.innerHTML = '<span class="convStep">' + o.step + '</span>' +
      '<span class="convFrom">' + o.from + '</span>' +
      '<span class="convArrow">→</span>';

    if (o.locked) {
      var b = document.createElement('span');
      b.className = 'convVal';
      b.textContent = o.value;
      row.appendChild(b);
    } else {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'num convBox';
      inp.id = o.id;
      inp.inputMode = 'decimal';
      inp.value = o.value;
      inp.placeholder = o.enabled ? '?' : '…';
      if (!o.enabled) inp.disabled = true;
      inp.oninput = function () { o.oninput(inp.value); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
      row.appendChild(inp);
    }

    var u = document.createElement('span');
    u.className = 'convUnit';
    u.textContent = o.unit;
    row.appendChild(u);
    var why = document.createElement('span');
    why.className = 'convWhy';
    why.innerHTML = o.why;
    row.appendChild(why);
    return row;
  }

  // 変換が正しく入ったら、その値が表の「反応前」に入る
  function tryLockConv(key) {
    var p = problem();
    if (!M.checkConv(p, key, state.conv[key])) return;
    state.convLocked[key] = true;
    renderConvIn();
    renderBars();
    renderBoard();
    if (inOk(p)) {
      el.msg.innerHTML = '<span class="ok">mol にそろいました</span>' +
        '<span class="lead">ここから先は<b>係数の比</b>がそのまま使えます。</span>';
      var next = document.getElementById('xIn');
      if (next && !next.disabled) next.focus();
    }
  }

  // ---- 過不足の図：mol ÷ 係数 の棒くらべ ----
  function renderBars() {
    var p = problem();
    if (!M.isExcess(p)) { el.barsWrap.hidden = true; el.bars.innerHTML = ''; return; }
    el.barsHead.innerHTML = 'どこまで進めるか（<b>' + divLabel(p) + '</b>）を比べる';
    // mol にそろう前に候補倍率を見せると、変換の答えが分かってしまう
    if (!inOk(p)) {
      el.barsWrap.hidden = false;
      el.bars.innerHTML = '<text class="stopLab" x="250" y="40">' +
        'まず mol にそろえよう（比べられるのは mol だけ）</text>';
      el.limitBar.innerHTML = '';
      return;
    }
    el.barsWrap.hidden = false;

    var cs = M.knownCandidates(p);
    var lim = M.limiting(p);
    var maxQ = Math.max.apply(null, cs.map(function (c) { return c.quotient; }));
    var x = M.progress(p);
    var s = [];

    // えらばせる問題では、えらぶまで「使われる分」を塗らない（塗り＝答えになるため）
    var reveal = !needLimit(p) || limitOk(p);
    cs.forEach(function (c, i) {
      var y = ROW_Y + i * ROW_GAP;
      var isLim = reveal && lim.indexOf(c.sub) >= 0;
      // ラベル: 何 mol を係数で割るのか（式そのものを見せる）
      s.push('<text class="barLab" x="' + LX + '" y="' + (y + 13) + '">' +
             M.plainLabel(formula(c.sub)) + ' ' + quotText(p, c) + '</text>');
      s.push('<rect class="barRest" x="' + BX0 + '" y="' + y + '" width="' +
             (BW * c.quotient / maxQ) + '" height="' + ROW_H + '" rx="3"/>');
      if (reveal) {
        s.push('<rect class="barUsed' + (isLim ? ' lim' : '') + '" x="' + BX0 + '" y="' + y +
               '" width="' + (BW * x / maxQ) + '" height="' + ROW_H + '" rx="3"/>');
      }
      s.push('<text class="barVal' + (isLim ? ' lim' : '') + '" x="' + VX + '" y="' +
             (y + 13) + '">＝' + xText(p, c.quotient) + '</text>');
    });

    // 反応が止まる位置。棒の下端より下にラベルを置く（文字と棒を重ねない）。
    // **えらばせる問題では、えらぶまで描かない**（止まる位置＝答えそのものなので、
    // 先に描くと「棒の長さを比べる」という肝心の作業が消える）
    var bottom = ROW_Y + (cs.length - 1) * ROW_GAP + ROW_H;
    if (needLimit(p) && !limitOk(p)) {
      s.push('<text class="stopHint" x="250" y="' + NOTE_Y + '">' +
             '棒の長さを比べよう（短いほうが先に無くなる）</text>');
      el.bars.innerHTML = s.join('');
      renderLimitBar();
      return;
    }
    var sx = BX0 + BW * x / maxQ;
    s.push('<line class="stopLine" x1="' + sx + '" y1="' + (ROW_Y - 10) + '" x2="' + sx +
           '" y2="' + (bottom + 8) + '"/>');
    var tx = Math.max(BX0 + 46, Math.min(454, sx));
    s.push('<text class="stopLab" x="' + tx + '" y="' + NOTE_Y + '">' +
           (M.isExact(p) ? 'どちらも同時に無くなる（ちょうど反応）'
                         : 'ここで止まる（' + xText(p, x) + ' ' + unitText(p) + ' 分）') + '</text>');

    el.bars.innerHTML = s.join('');
    renderLimitBar();
  }

  // 限定反応物をえらぶ（過不足の問題だけ）。えらんでから倍率に進む
  function renderLimitBar() {
    var p = problem();
    el.limitBar.innerHTML = '';
    if (!needLimit(p)) return;

    var label = document.createElement('span');
    label.className = 'limLabel';
    label.textContent = '先に足りなくなるのは：';
    el.limitBar.appendChild(label);

    // 選択肢は反応物だけ。**ちょうど反応の問題ではこの段を出さない**ので、
    // 「先に足りなくなるほう」は必ず1つ存在する（データ側の約束）
    M.knownCandidates(p).forEach(function (c) {
      var b = document.createElement('button');
      b.innerHTML = formula(c.sub);
      b.dataset.sub = c.sub;
      if (state.limitPick === c.sub) {
        b.className = M.checkLimiting(p, c.sub) ? 'picked' : 'picked bad';
      }
      b.onclick = function () { pickLimit(c.sub); };
      el.limitBar.appendChild(b);
    });
  }

  function pickLimit(key) {
    var p = problem();
    state.limitPick = key;
    state.x = ''; state.xLocked = false; state.input = '';
    state.tableInput = ''; state.tableLocked = false;
    renderLimitBar();
    renderBars();
    renderBoard();
    renderConvOut();

    if (M.checkLimiting(p, key)) {
      el.msg.innerHTML = '<span class="ok">そのとおり</span>' +
        '<span class="lead">' + formula(key) +
        ' が先に無くなるので、そこで反応は止まる。倍率を入れよう。</span>';
      var xi = document.getElementById('xIn');
      if (xi) xi.focus();
      return;
    }

    var c = M.knownCandidates(p).filter(function (q) { return q.sub === key; })[0];
    el.msg.innerHTML = '<span class="ng">' + M.plainLabel(formula(key)) +
      ' はまだ余ります</span>' +
      '<span class="why"><b>' + divLabel(p) + '</b>を比べよう。' + M.plainLabel(formula(key)) +
      ' は ' + quotText(p, c) + ' ＝ ' +
      xText(p, c.quotient) + ' 回分まで進められます。もう一方はもっと少ない。</span>';
  }

  // ---- 3行表（係数・反応前・変化量・反応後） ----
  function renderBoard() {
    var p = problem();
    var tbl = document.createElement('table');
    tbl.className = 'stoich';
    tbl.appendChild(headRow(p));
    tbl.appendChild(dataRow(p, 'coef'));
    tbl.appendChild(dataRow(p, 'before'));
    tbl.appendChild(dataRow(p, 'change'));
    tbl.appendChild(dataRow(p, 'after'));

    el.board.innerHTML = '';
    el.board.appendChild(tbl);
    var note = document.createElement('div');
    note.className = 'unitNote';
    note.innerHTML = '単位はすべて ' + unitText(p) + virtualNote(p);
    el.board.appendChild(note);
  }

  // 列の間に ＋ と → を挟むので、表そのものが反応式として読める
  function eachColumn(p, fn) {
    var cells = [];
    p.eq.forEach(function (t, i) {
      if (i > 0) {
        var prev = p.eq[i - 1];
        cells.push({ sep: (!prev.product && t.product) ? '→' : '＋' });
      }
      cells.push({ term: t });
    });
    return cells.map(fn);
  }

  function headRow(p) {
    var tr = document.createElement('tr');
    tr.className = 'row-head';
    var th = document.createElement('th');
    th.className = 'rowHead';
    tr.appendChild(th);
    eachColumn(p, function (c) {
      var cell = document.createElement(c.sep ? 'td' : 'th');
      if (c.sep) { cell.className = 'sep'; cell.textContent = c.sep; }
      else {
        cell.className = 'colHead ' + (c.term.product ? 'prod' : 'react');
        // 気体でない物質を L で数えている列には ※ を付ける（下に注記を出す）
        var mark = M.isVirtual(p, c.term.sub) ? '<span class="vmark">※</span>' : '';
        if (mark) cell.className += ' virtual';
        cell.innerHTML = formula(c.term.sub) + mark;
      }
      return cell;
    }).forEach(function (cell) { tr.appendChild(cell); });
    return tr;
  }

  function dataRow(p, kind) {
    var tr = document.createElement('tr');
    tr.className = 'row-' + kind;
    tr.appendChild(rowHead(p, kind));
    eachColumn(p, function (c) {
      if (c.sep) {
        var sep = document.createElement('td');
        sep.className = 'sep';
        return sep;
      }
      return dataCell(p, kind, c.term);
    }).forEach(function (cell) { tr.appendChild(cell); });
    return tr;
  }

  var ROW_LABEL = { coef: '係数（比）', before: '反応前', change: '変化量', after: '反応後' };

  function rowHead(p, kind) {
    var th = document.createElement('th');
    th.className = 'rowHead';
    th.textContent = ROW_LABEL[kind];
    // 変化量 ＝ 係数 × 倍率。倍率のバッジをこの行の見出しに置く
    // （比例式モードで矢印に倍率を載せているのと同じ位置づけ）
    if (kind === 'change') th.appendChild(xBadge(p));
    return th;
  }

  function xBadge(p) {
    var wrap = document.createElement('span');
    wrap.className = 'xBadge';
    if (needX(p) && !state.xLocked) {
      wrap.classList.add('editable');
      wrap.appendChild(document.createTextNode('係数×'));
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'xBox';
      inp.id = 'xIn';
      inp.inputMode = 'decimal';
      inp.value = state.x;
      inp.placeholder = '□';
      // mol にそろい、限定反応物が決まってから倍率に進む
      if (!inOk(p) || !limitOk(p)) { inp.disabled = true; inp.placeholder = '…'; }
      inp.oninput = function () { state.x = inp.value; tryLockX(); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
      wrap.appendChild(inp);
    } else {
      wrap.classList.add('locked');
      wrap.textContent = '係数×' + xText(p, M.progress(p));
    }
    return wrap;
  }

  // 「倍率が正しく入ると変化量の行が一斉に埋まる」体験の実装
  function tryLockX() {
    var p = problem();
    if (state.x === '' || !inOk(p) || !limitOk(p)) return;
    if (!M.checkProgress(p, state.x)) return;
    state.xLocked = true;
    renderBoard();
    renderConvOut();
    var focusEl = document.getElementById(M.hasOut(p) ? 'tableAns' : 'answer');
    if (focusEl) focusEl.focus();
    el.msg.innerHTML = '<span class="ok">その倍率で合っています</span>' +
      '<span class="lead">同じ倍率が<b>すべての物質</b>にはたらいて、変化量が決まりました。' +
      '問われているところを計算しよう。</span>';
  }

  function dataCell(p, kind, t) {
    var td = document.createElement('td');
    td.className = 'sc ' + (t.product ? 'prod' : 'react') + ' r-' + kind;
    if (M.isVirtual(p, t.sub)) td.className += ' virtual';
    td.dataset.sub = t.sub;
    td.dataset.row = kind;

    var lim = M.limiting(p);
    if (kind === 'coef') {
      td.classList.add('coef');
      td.textContent = t.coef;
      return td;
    }
    if (kind === 'before') {
      var b = M.beforeOf(p, t.sub);
      if (M.isExcess(p) && !t.product && lim.indexOf(t.sub) >= 0 && limitOk(p)) {
        td.classList.add('limited');
      }
      // mol にそろえる前は空けておく（変換の答えを先に見せない）
      if (needIn(p) && !state.convLocked[t.sub] && M.convTargets(p).indexOf(t.sub) >= 0) {
        td.classList.add('waiting');
        td.textContent = '?';
        return td;
      }
      td.innerHTML = b === null ? '<span class="enough">十分量</span>'
                                : M.stoichDisp(b, p.sig);
      return td;
    }
    if (kind === 'change') {
      if (askedRow(p) === 'change' && t.sub === p.asked) return answerCell(p, td, true);
      if (!xOk(p)) { td.classList.add('waiting'); td.textContent = '?'; return td; }
      td.innerHTML = signed(M.changeOf(p, t.sub), p.sig);
      return td;
    }
    // 反応後
    if (askedRow(p) === 'after' && t.sub === p.asked) return answerCell(p, td, false);
    if (M.beforeOf(p, t.sub) === null) { td.classList.add('waiting'); td.textContent = '—'; return td; }
    if (!xOk(p)) { td.classList.add('waiting'); td.textContent = '?'; return td; }
    var a = M.afterOf(p, t.sub);
    td.innerHTML = M.stoichDisp(a, p.sig);
    if (Math.abs(a) < 1e-12) td.classList.add('gone');
    else if (!t.product && M.isExcess(p)) td.classList.add('rest');
    return td;
  }

  // 答えのセル。変化量の行にあるときは符号（−）を外に出し、
  // 学習者は「使われた量」をそのまま正の数で入れられるようにする。
  // 単位を戻す段がある問題では、このセルは **mol の途中の値**（正しく入ると出口が開く）。
  function answerCell(p, td, inChangeRow) {
    var isFinal = !M.hasOut(p);
    var ready = isFinal ? answerReady(p) : tableReady(p);
    td.classList.add('unknown');
    if (!ready) td.classList.add('waiting');
    if (!isFinal && state.tableLocked) td.classList.add('landed');
    if (inChangeRow) {
      var sign = document.createElement('span');
      sign.className = 'sign';
      sign.textContent = '−';
      td.appendChild(sign);
    }
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'num';
    inp.id = isFinal ? 'answer' : 'tableAns';
    inp.inputMode = 'decimal';
    inp.value = isFinal ? state.input : state.tableInput;
    inp.placeholder = '?';
    if (!ready) { inp.disabled = true; inp.placeholder = '…'; }
    inp.oninput = function () {
      if (isFinal) { state.input = inp.value; return; }
      state.tableInput = inp.value;
      tryLockMol();
    };
    inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
    td.appendChild(inp);
    return td;
  }

  // 表の中の mol が合ったら、単位を戻す段が開く
  function tryLockMol() {
    var p = problem();
    if (state.tableLocked || !M.checkTable(p, state.tableInput)) return;
    state.tableLocked = true;
    renderBoard();
    renderConvOut();
    var focusEl = document.getElementById('answer');
    if (focusEl) focusEl.focus();
    el.msg.innerHTML = '<span class="ok">mol の値は合っています</span>' +
      '<span class="lead">あとは<b>答えの単位に戻す</b>だけ。</span>';
  }

  function signed(v, sig) {
    if (Math.abs(v) < 1e-12) return '0';
    return (v < 0 ? '−' : '＋') + M.stoichDisp(Math.abs(v), sig);
  }

  function setProblem(i) {
    state.idx = i;
    state.conv = {}; state.convLocked = {};
    state.limitPick = null;
    state.x = ''; state.xLocked = false;
    state.tableInput = ''; state.tableLocked = false;
    state.input = '';
    var p = problem();
    el.qTitle.innerHTML = '問' + (i + 1) + '　' + p.title +
      '<span class="sig">有効数字' + p.sig + '桁で答えよ</span>';
    el.qHint.innerHTML = '💡 ' + p.hint;
    el.nextBtn.hidden = true;
    renderNav();
    renderEqBox();
    renderConvIn();
    renderBars();
    renderBoard();
    renderConvOut();
    el.msg.innerHTML = '<span class="lead">' + leadText(p) + '</span>';
  }

  function leadText(p) {
    if (needIn(p)) return '係数の比が使えるのは mol だけ。まず <b>mol にそろえよう</b>。';
    if (needLimit(p)) return 'まず <b>' + divLabel(p) + '</b> を比べて、<b>先に足りなくなるほう</b>をえらぼう。';
    if (needX(p)) return '与えられた量と係数から、反応が<b>どこまで進むか</b>（倍率）を入れてみよう。';
    return '変化量は<b>係数 × 倍率</b>。同じ倍率が全部の物質にはたらく。';
  }

  function check() {
    var p = problem();
    el.msg.innerHTML = '';

    if (needIn(p) && !inOk(p)) {
      var k = M.convTargets(p).filter(function (q) { return !state.convLocked[q]; })[0];
      var gs = M.givenSpec(p, k);
      el.msg.innerHTML = '<span class="ng">まだ mol にそろっていません</span>' +
        '<span class="why">係数の比が使えるのは <b>mol</b> だけです。' +
        M.perMolText(k, gs.q) + ' なので、' + M.plainLabel(formula(k)) + ' ' +
        M.disp(gs.v) + ' ' + M.QUANTITIES[gs.q].unit + ' ÷ ' +
        M.disp(M.perMol(M.SUBSTANCES[k], gs.q)) + ' を計算します。</span>';
      return;
    }
    if (needLimit(p) && !limitOk(p)) {
      el.msg.innerHTML = '<span class="ng">先に足りなくなるほうをえらんでみよう</span>' +
        '<span class="why"><b>' + divLabel(p) + '</b>を出して比べます。小さいほうで反応は止まります。</span>';
      return;
    }
    if (needX(p) && !state.xLocked) {
      var c = M.knownCandidates(p).filter(function (q) {
        return q.sub === M.limiting(p)[0];
      })[0];
      el.msg.innerHTML = '<span class="ng">倍率がまだ合っていません</span>' +
        '<span class="why">' + M.plainLabel(formula(c.sub)) + ' は ' +
        M.stoichDisp(c.before, p.sig) + ' ' + unitText(p) + ' あって係数は ' + c.coef + '。' +
        '<b>' + quotText(p, c) + '</b> が倍率です。</span>';
      return;
    }
    if (M.hasOut(p) && !state.tableLocked) {
      el.msg.innerHTML = '<span class="ng">表の ' + unitText(p) + ' がまだ合っていません</span>' +
        '<span class="why">' + M.plainLabel(formula(p.asked)) + ' の量は<b>係数 × 倍率</b>で、' +
        M.termOf(p, p.asked).coef + ' × ' + xText(p, M.progress(p)) +
        ' です。単位を戻すのはそのあと。</span>';
      return;
    }
    if (state.input.trim() === '') {
      el.msg.innerHTML = '<span class="ng">数を入れてみよう</span>';
      return;
    }

    var g = M.gradeStoich(p, state.input);

    if (g.status === 'ok') {
      state.solved[p.id] = true;
      el.board.querySelector('table').classList.add('solved');
      if (!needX(p)) state.xLocked = true;
      renderNav();
      el.msg.innerHTML = '<span class="ok">正解！　同じ倍率が全部の物質にはたらいている</span>' +
        '<span class="work">' + explain(p) + '</span>';
      el.nextBtn.hidden = (state.idx >= R.length - 1);
      return;
    }

    if (g.status === 'limit') {
      el.msg.innerHTML = '<span class="ng">余るほうで計算しています</span>' +
        '<span class="why">' + M.plainLabel(formula(g.excess)) +
        ' は使いきれずに<b>余ります</b>。反応は ' + M.plainLabel(formula(g.limiting)) +
        ' が無くなったところで止まるので、倍率は<b>小さいほう</b>を使います。' +
        candidateText(p) + '</span>';
      return;
    }

    if (g.status === 'sigfig') {
      el.msg.innerHTML = '<span class="ng">値は合っています。書き方を直そう</span>' +
        '<span class="why">この問題は<b>有効数字' + g.need + '桁</b>で答えます。' +
        '<b>' + M.disp(p.ansDisp) + '</b> と書きます' +
        (g.got ? '（いまの答えは' + g.got + '桁）' : '') + '。</span>';
      return;
    }

    if (g.status === 'flip') {
      el.msg.innerHTML = '<span class="ng">係数が逆さまになっています</span>' +
        '<span class="why">係数は<b>かける</b>数です。' + coefLine(p) +
        '　倍率 ' + xText(p, M.progress(p)) + ' に ' +
        M.termOf(p, p.asked).coef + ' をかけます。</span>';
      return;
    }

    // ここまで来て違うなら、mol は合っていて単位を戻すところで間違えている
    if (M.hasOut(p)) {
      var au = M.askedUnit(p);
      el.msg.innerHTML = '<span class="ng">mol は合っています。単位を戻すところです</span>' +
        '<span class="why">' + M.perMolText(p.asked, au) + ' なので、' +
        M.stoichDisp(M.tableAnswer(p), p.sig) + ' × ' +
        M.disp(M.perMol(M.SUBSTANCES[p.asked], au)) + ' を計算します。</span>';
      return;
    }

    el.msg.innerHTML = '<span class="ng">ちがうみたい</span>' +
      '<span class="why">倍率は <b>' + xText(p, M.progress(p)) +
      '</b>。変化量は<b>係数 × 倍率</b>なので、' + M.plainLabel(formula(p.asked)) +
      ' は ' + M.termOf(p, p.asked).coef + ' × ' + xText(p, M.progress(p)) +
      ' を使います。</span>';
  }

  function coefLine(p) {
    return '係数の比は ' + p.eq.map(function (t) { return t.coef; }).join(' : ') + '。';
  }

  // 候補倍率を並べるだけ（どちらで止まるかは言わない）。
  // まだ答えさせている途中で使うので、結論は含めない
  function quotListText(p) {
    return M.knownCandidates(p).map(function (c) {
      return M.plainLabel(formula(c.sub)) + ' ' + quotText(p, c) +
             ' ＝ ' + xText(p, c.quotient);
    }).join('、');
  }

  // 候補倍率を並べて「小さいほうで止まる」を式で見せる（採点後・解説で使う）
  function candidateText(p) {
    return '（' + quotListText(p) + ' → 小さいほうの <b>' +
           xText(p, M.progress(p)) + '</b> で止まる）';
  }

  // 解説。倍率の出どころ → 全物質への波及 → 余り → 丸める前の値
  function explain(p) {
    var x = M.progress(p);
    var at = M.termOf(p, p.asked);
    var lines = [];

    // ① mol にそろえる（係数の比が使えるのは mol だけ、という順序を毎回なぞる）
    M.convTargets(p).forEach(function (k) {
      var g = M.givenSpec(p, k);
      lines.push(M.plainLabel(formula(k)) + ' ' + M.disp(g.v) + ' ' +
        M.QUANTITIES[g.q].unit + ' ÷ ' + M.disp(M.perMol(M.SUBSTANCES[k], g.q)) +
        ' ＝ <b>' + M.stoichDisp(M.beforeOf(p, k), p.sig) + ' mol</b>。');
    });
    lines.push(coefLine(p));

    if (M.isExcess(p)) {
      lines.push(M.isExact(p)
        ? 'どちらも ' + xText(p, x) + ' 回分ちょうどなので、<b>ちょうど反応</b>して両方とも残らない。'
        : candidateText(p).replace(/^（|）$/g, '') + '。');
    } else {
      var c = M.knownCandidates(p)[0];
      lines.push(M.plainLabel(formula(c.sub)) + ' ' + M.stoichDisp(c.before, p.sig) +
        ' ' + unitText(p) + ' ÷ 係数 ' + c.coef + ' ＝ 倍率 <b>' + xText(p, x) + '</b>。');
    }

    lines.push('倍率が決まれば、変化量は<b>係数 × ' + xText(p, x) + '</b>。');

    if (p.askedOf === 'left') {
      lines.push(M.plainLabel(formula(p.asked)) + ' は ' +
        M.stoichDisp(M.beforeOf(p, p.asked), p.sig) + ' − ' + at.coef + '×' +
        xText(p, x) + ' ＝ <b>' + M.disp(p.ansDisp) + ' ' + unitText(p) + '</b> 残る。');
    } else {
      var tblTxt = M.stoichDisp(M.tableAnswer(p), p.sig);
      lines.push(M.plainLabel(formula(p.asked)) + ' は ' + at.coef + '×' +
        xText(p, x) + ' ＝ <b>' + tblTxt + ' ' + unitText(p) + '</b>。');
      if (M.hasOut(p)) {
        var au = M.askedUnit(p);
        lines.push('単位を戻して ' + tblTxt + ' × ' +
          M.disp(M.perMol(M.SUBSTANCES[p.asked], au)) + ' ＝ <b>' +
          M.disp(p.ansDisp) + ' ' + M.QUANTITIES[au].unit + '</b>。');
      }
      var rest = M.excessSubs(p).filter(function (s) { return s !== p.asked; });
      rest.forEach(function (s) {
        lines.push('<span class="alt">' + M.plainLabel(formula(s)) + ' は ' +
          M.stoichDisp(M.afterOf(p, s), p.sig) + ' ' + unitText(p) + ' 余る（' +
          M.stoichDisp(M.beforeOf(p, s), p.sig) + ' − ' + M.termOf(p, s).coef + '×' +
          xText(p, x) + '）</span>');
      });
    }

    // 丸める前の値は**数値で**比べる（0.09999… と 0.10 のような表記差で出さない）
    var exact = M.stoichAnswer(p);
    if (Math.abs(exact - parseFloat(p.ansDisp)) > Math.abs(exact) * 1e-9) {
      lines.push('丸める前の値は <b>' + M.fmt(exact) + '</b>。有効数字' + p.sig +
                 '桁にして <b>' + M.disp(p.ansDisp) + '</b>。');
    }
    return lines.join('<br>');
  }

  el.checkBtn.onclick = check;
  el.nextBtn.onclick = function () {
    if (state.idx < R.length - 1) setProblem(state.idx + 1);
  };

  /* 反応インデックス（ion-equation の library.html）からのディープリンク。
     stoich.html?r=<反応ID> で、その反応の問題を開く。
     同じ反応式の問題が複数あるときは最初のもの（導入用）を開く。 */
  var linked = new URLSearchParams(location.search).get('r');
  var start = 0;
  if (linked) {
    var i = R.findIndex(function (p) { return p.id === linked; });
    if (i >= 0) start = i;
  }
  setProblem(start);

  // テスト・デバッグ用
  window.ChemStoichApp = {
    state: state,
    setProblem: setProblem,
    pickLimit: pickLimit,
    typeConv: function (key, v) {
      state.conv[key] = String(v);
      var inp = document.getElementById('conv-' + key);
      if (inp) inp.value = state.conv[key];
      tryLockConv(key);
    },
    typeTable: function (v) {
      state.tableInput = String(v);
      var inp = document.getElementById('tableAns');
      if (inp) inp.value = state.tableInput;
      tryLockMol();
    },
    typeX: function (v) {
      state.x = String(v);
      var inp = document.getElementById('xIn');
      if (inp) inp.value = state.x;
      tryLockX();
    },
    type: function (v) {
      state.input = String(v);
      var inp = document.getElementById('answer');
      if (inp) inp.value = state.input;
    },
    // 段階を全部とばして最終解答だけ入れる（テストの下ごしらえ用）
    solveSteps: function () {
      var p = problem();
      M.convTargets(p).forEach(function (k) {
        state.conv[k] = M.stoichDisp(M.beforeOf(p, k), p.sig);
        tryLockConv(k);
      });
      if (needLimit(p)) pickLimit(M.limitAnswer(p));
      if (needX(p)) { state.x = xText(p, M.progress(p)); tryLockX(); }
      if (M.hasOut(p)) { state.tableInput = M.stoichDisp(M.tableAnswer(p), p.sig); tryLockMol(); }
    },
    check: check,
    msgText: function () { return el.msg.textContent; }
  };
})();
