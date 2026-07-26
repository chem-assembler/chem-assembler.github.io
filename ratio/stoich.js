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
    limitPick: null,   // えらんだ限定反応物
    x: '',             // 倍率の入力
    xLocked: false,    // 倍率が正しく入り、変化量の行が埋まった
    input: '',         // 答え
    solved: {}
  };

  var el = {};
  ['stageNav', 'qTitle', 'qHint', 'eqBox', 'barsWrap', 'bars', 'limitBar',
   'board', 'checkBtn', 'nextBtn', 'msg']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  function problem() { return R[state.idx]; }
  function needLimit(p) { return !!(p.steps && p.steps.limit); }
  function needX(p) { return !!(p.steps && p.steps.x); }
  // 限定反応物を選ぶ段階が済んだか（ちょうど反応ならどちらでも正しい）
  function limitOk(p) {
    return !needLimit(p) || (!!state.limitPick && M.checkLimiting(p, state.limitPick));
  }
  function xOk(p) { return !needX(p) || state.xLocked; }
  function answerReady(p) { return limitOk(p) && xOk(p); }
  // 問われているセルがどの行にあるか。使われた量は変化量の行、それ以外は反応後の行
  function askedRow(p) { return p.askedOf === 'used' ? 'change' : 'after'; }

  function formula(key) { return M.SUBSTANCES[key].formula; }

  // 倍率・候補倍率の表示。問題の桁にそろえる（0.15・0.10）。
  // 倍率は答えではなく計算の途中の値なので、割り切れないときは
  // 丸めた値を断定せずに桁を足して … を付ける（分数と小数の対照表と同じ流儀）。
  function xText(p, v) {
    if (Math.abs(v) < 1e-12) return '0';
    var s = M.toSig(v, p.sig);
    return Math.abs(parseFloat(s) - v) <= Math.abs(v) * 1e-9
      ? s : M.toSig(v, p.sig + 2) + '…';
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

  // ---- 過不足の図：mol ÷ 係数 の棒くらべ ----
  function renderBars() {
    var p = problem();
    if (!M.isExcess(p)) { el.barsWrap.hidden = true; el.bars.innerHTML = ''; return; }
    el.barsWrap.hidden = false;

    var cs = M.knownCandidates(p);
    var lim = M.limiting(p);
    var maxQ = Math.max.apply(null, cs.map(function (c) { return c.quotient; }));
    var x = M.progress(p);
    var s = [];

    cs.forEach(function (c, i) {
      var y = ROW_Y + i * ROW_GAP;
      var isLim = lim.indexOf(c.sub) >= 0;
      // ラベル: 何 mol を係数で割るのか（式そのものを見せる）
      s.push('<text class="barLab" x="' + LX + '" y="' + (y + 13) + '">' +
             M.plainLabel(formula(c.sub)) + ' ' + M.disp(p.given[c.sub]) +
             '÷' + c.coef + '</text>');
      s.push('<rect class="barRest" x="' + BX0 + '" y="' + y + '" width="' +
             (BW * c.quotient / maxQ) + '" height="' + ROW_H + '" rx="3"/>');
      s.push('<rect class="barUsed' + (isLim ? ' lim' : '') + '" x="' + BX0 + '" y="' + y +
             '" width="' + (BW * x / maxQ) + '" height="' + ROW_H + '" rx="3"/>');
      s.push('<text class="barVal' + (isLim ? ' lim' : '') + '" x="' + VX + '" y="' +
             (y + 13) + '">＝' + xText(p, c.quotient) + '</text>');
    });

    // 反応が止まる位置。棒の下端より下にラベルを置く（文字と棒を重ねない）
    var bottom = ROW_Y + (cs.length - 1) * ROW_GAP + ROW_H;
    var sx = BX0 + BW * x / maxQ;
    s.push('<line class="stopLine" x1="' + sx + '" y1="' + (ROW_Y - 10) + '" x2="' + sx +
           '" y2="' + (bottom + 8) + '"/>');
    var tx = Math.max(BX0 + 46, Math.min(454, sx));
    s.push('<text class="stopLab" x="' + tx + '" y="' + NOTE_Y + '">' +
           (M.isExact(p) ? 'どちらも同時に無くなる（ちょうど反応）'
                         : 'ここで止まる（' + xText(p, x) + ' mol 分）') + '</text>');

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
    renderLimitBar();
    renderBoard();
    if (M.checkLimiting(p, key)) {
      el.msg.innerHTML = '<span class="ok">そのとおり</span>' +
        '<span class="lead">' + (M.isExact(p)
          ? 'この問題は<b>ちょうど反応</b>（どちらも余らない）。倍率を入れよう。'
          : formula(key) + ' が先に無くなるので、そこで反応は止まる。倍率を入れよう。') +
        '</span>';
      var xi = document.getElementById('xIn');
      if (xi) xi.focus();
    } else {
      var c = M.knownCandidates(p).filter(function (q) { return q.sub === key; })[0];
      el.msg.innerHTML = '<span class="ng">' + M.plainLabel(formula(key)) +
        ' はまだ余ります</span>' +
        '<span class="why"><b>mol ÷ 係数</b>を比べよう。' + M.plainLabel(formula(key)) +
        ' は ' + M.disp(p.given[key]) + '÷' + c.coef + ' ＝ ' +
        xText(p, c.quotient) + ' 回分まで進められます。もう一方はもっと少ない。</span>';
    }
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
    note.textContent = '単位はすべて mol';
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
        cell.innerHTML = formula(c.term.sub);
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
      if (!limitOk(p)) { inp.disabled = true; inp.placeholder = '…'; }
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
    if (state.x === '' || !limitOk(p)) return;
    if (!M.checkProgress(p, state.x)) return;
    state.xLocked = true;
    renderBoard();
    var focusEl = document.getElementById('answer');
    if (focusEl) focusEl.focus();
    el.msg.innerHTML = '<span class="ok">その倍率で合っています</span>' +
      '<span class="lead">同じ倍率が<b>すべての物質</b>にはたらいて、変化量が決まりました。' +
      '問われているところを計算しよう。</span>';
  }

  function dataCell(p, kind, t) {
    var td = document.createElement('td');
    td.className = 'sc ' + (t.product ? 'prod' : 'react') + ' r-' + kind;
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
  // 学習者は「使われた量」をそのまま正の数で入れられるようにする
  function answerCell(p, td, inChangeRow) {
    td.classList.add('unknown');
    if (!answerReady(p)) td.classList.add('waiting');
    if (inChangeRow) {
      var sign = document.createElement('span');
      sign.className = 'sign';
      sign.textContent = '−';
      td.appendChild(sign);
    }
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'num';
    inp.id = 'answer';
    inp.inputMode = 'decimal';
    inp.value = state.input;
    inp.placeholder = '?';
    if (!answerReady(p)) { inp.disabled = true; inp.placeholder = '…'; }
    inp.oninput = function () { state.input = inp.value; };
    inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
    td.appendChild(inp);
    return td;
  }

  function signed(v, sig) {
    if (Math.abs(v) < 1e-12) return '0';
    return (v < 0 ? '−' : '＋') + M.stoichDisp(Math.abs(v), sig);
  }

  function setProblem(i) {
    state.idx = i;
    state.limitPick = null;
    state.x = ''; state.xLocked = false; state.input = '';
    var p = problem();
    el.qTitle.innerHTML = '問' + (i + 1) + '　' + p.title +
      '<span class="sig">有効数字' + p.sig + '桁で答えよ</span>';
    el.qHint.innerHTML = '💡 ' + p.hint;
    el.nextBtn.hidden = true;
    renderNav();
    renderEqBox();
    renderBars();
    renderBoard();
    el.msg.innerHTML = '<span class="lead">' + leadText(p) + '</span>';
  }

  function leadText(p) {
    if (needLimit(p)) return 'まず <b>mol ÷ 係数</b> を比べて、<b>先に足りなくなるほう</b>をえらぼう。';
    if (needX(p)) return '与えられた量と係数から、反応が<b>何 mol 分進むか</b>を入れてみよう。';
    return '変化量は<b>係数 × 倍率</b>。同じ倍率が全部の物質にはたらく。';
  }

  function check() {
    var p = problem();
    el.msg.innerHTML = '';

    if (needLimit(p) && !limitOk(p)) {
      el.msg.innerHTML = '<span class="ng">先に足りなくなるほうをえらんでみよう</span>' +
        '<span class="why"><b>mol ÷ 係数</b>を出して比べます。小さいほうで反応は止まります。</span>';
      return;
    }
    if (needX(p) && !state.xLocked) {
      var c = M.knownCandidates(p).filter(function (q) {
        return q.sub === M.limiting(p)[0];
      })[0];
      el.msg.innerHTML = '<span class="ng">倍率がまだ合っていません</span>' +
        '<span class="why">' + M.plainLabel(formula(c.sub)) + ' は ' +
        M.disp(p.given[c.sub]) + ' mol あって係数は ' + c.coef + '。' +
        '<b>' + M.disp(p.given[c.sub]) + ' ÷ ' + c.coef + '</b> が倍率です。</span>';
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

    el.msg.innerHTML = '<span class="ng">ちがうみたい</span>' +
      '<span class="why">倍率は <b>' + xText(p, M.progress(p)) +
      '</b>。変化量は<b>係数 × 倍率</b>なので、' + M.plainLabel(formula(p.asked)) +
      ' は ' + M.termOf(p, p.asked).coef + ' × ' + xText(p, M.progress(p)) +
      ' を使います。</span>';
  }

  function coefLine(p) {
    return '係数の比は ' + p.eq.map(function (t) { return t.coef; }).join(' : ') + '。';
  }

  // 候補倍率を並べて「小さいほうで止まる」を式で見せる
  function candidateText(p) {
    var parts = M.knownCandidates(p).map(function (c) {
      return M.plainLabel(formula(c.sub)) + ' ' + M.disp(p.given[c.sub]) + '÷' + c.coef +
             ' ＝ ' + xText(p, c.quotient);
    });
    return '（' + parts.join('、') + ' → 小さいほうの <b>' +
           xText(p, M.progress(p)) + '</b> で止まる）';
  }

  // 解説。倍率の出どころ → 全物質への波及 → 余り → 丸める前の値
  function explain(p) {
    var x = M.progress(p);
    var at = M.termOf(p, p.asked);
    var lines = [coefLine(p)];

    if (M.isExcess(p)) {
      lines.push(M.isExact(p)
        ? 'どちらも ' + xText(p, x) + ' 回分ちょうどなので、<b>ちょうど反応</b>して両方とも残らない。'
        : candidateText(p).replace(/^（|）$/g, '') + '。');
    } else {
      var c = M.knownCandidates(p)[0];
      lines.push(M.plainLabel(formula(c.sub)) + ' ' + M.disp(p.given[c.sub]) +
        ' mol ÷ 係数 ' + c.coef + ' ＝ 倍率 <b>' + xText(p, x) + '</b>。');
    }

    lines.push('倍率が決まれば、変化量は<b>係数 × ' + xText(p, x) + '</b>。');

    if (p.askedOf === 'left') {
      lines.push(M.plainLabel(formula(p.asked)) + ' は ' +
        M.stoichDisp(M.beforeOf(p, p.asked), p.sig) + ' − ' + at.coef + '×' +
        xText(p, x) + ' ＝ <b>' + M.disp(p.ansDisp) + ' mol</b> 残る。');
    } else {
      lines.push(M.plainLabel(formula(p.asked)) + ' は ' + at.coef + '×' +
        xText(p, x) + ' ＝ <b>' + M.disp(p.ansDisp) + ' mol</b>。');
      var rest = M.excessSubs(p).filter(function (s) { return s !== p.asked; });
      rest.forEach(function (s) {
        lines.push('<span class="alt">' + M.plainLabel(formula(s)) + ' は ' +
          M.stoichDisp(M.afterOf(p, s), p.sig) + ' mol 余る（' +
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

  setProblem(0);

  // テスト・デバッグ用
  window.ChemStoichApp = {
    state: state,
    setProblem: setProblem,
    pickLimit: pickLimit,
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
    check: check,
    msgText: function () { return el.msg.textContent; }
  };
})();
