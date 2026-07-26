// 比例式でみる化学計算 — UI（プロトタイプ）
// 解き方は【倍率が同じ】。倍率は たて（行→行）にも よこ（列→列）にもとれるので両対応し、
// 楽な向きを推す。学習の流れ:
//   ①単位をえらぶ（steps.unit）→ ②既知の値から倍率を自分で探す（steps.factor）
//   → 正しければ もう一方の矢印に自動で入る → ③答えを計算
// 有効数字は問題文で指定し、解答に必須。桁が違えば「値は合っている」と伝えて書き方を指導する。
(function () {
  'use strict';

  var M = window.ChemRatio;
  var Q = M.QUANTITIES;

  var state = {
    idx: 0,
    orient: 'v',      // 'v' たて / 'h' よこ
    picked: null,     // steps.unit で選んだ量
    fn: '', fd: '',   // 学習者が入れた倍率（分子・分母）
    locked: false,    // 倍率が正しく入り、もう一方へ転記された
    input: '',        // 答え（指数表記のときは仮数）
    exp: '',          // 答えの指数
    solved: {}
  };

  var el = {};
  ['stageNav', 'qTitle', 'qHint', 'orientBar', 'board', 'eqLine',
   'checkBtn', 'nextBtn', 'msg'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  function problem() { return M.PROBLEMS[state.idx]; }
  function needUnit(p) { return !!(p.steps && p.steps.unit); }
  function needFactor(p) { return !!(p.steps && p.steps.factor); }
  function shownQuantity(p) { return needUnit(p) ? state.picked : M.unknownQuantity(p); }
  function isSci(p) { return M.unknownQuantity(p) === 'count'; }
  function factor(p) { return M.factorOf(p, state.orient); }

  // 倍率の入力が要る問題では、倍率が確定するまで答えを入れさせない
  function answerReady(p) { return !needFactor(p) || state.locked; }

  function inputValue(p) {
    if (!isSci(p)) return state.input;
    if (state.input === '' || state.exp === '') return '';
    return state.input + 'e' + state.exp;
  }
  function inputDisp(p) {
    if (inputValue(p) === '') return '';
    return isSci(p) ? state.input + '×10' + M.sup(state.exp) : state.input;
  }

  function renderNav() {
    el.stageNav.innerHTML = '';
    M.PROBLEMS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = String(i + 1);
      if (i === state.idx) b.className = 'active';
      else if (state.solved[p.id]) b.className = 'cleared';
      b.onclick = function () { setProblem(i); };
      el.stageNav.appendChild(b);
    });
  }

  // ---- 比をとる向きの切り替え ----
  function renderOrientBar() {
    var p = problem();
    var rec = M.recommend(p);
    var recText = rec === 'either' ? 'この問題は どちらでも大差ない'
      : rec === 'v' ? 'この問題は たて が楽' : 'この問題は よこ が楽';

    el.orientBar.innerHTML = '';
    [['v', 'たてで解く'], ['h', 'よこで解く']].forEach(function (o) {
      var b = document.createElement('button');
      b.textContent = o[1];
      b.dataset.orient = o[0];
      b.className = (state.orient === o[0] ? 'on' : '') +
                    ((rec === o[0] || rec === 'either') ? ' rec' : '');
      b.onclick = function () { setOrient(o[0]); };
      el.orientBar.appendChild(b);
    });
    var tag = document.createElement('span');
    tag.className = 'recTag';
    tag.textContent = recText;
    el.orientBar.appendChild(tag);
  }

  function setOrient(o) {
    state.orient = o;
    state.fn = ''; state.fd = ''; state.locked = false;   // 倍率は向きで変わる
    renderOrientBar();
    renderBoard();
    el.msg.innerHTML = '';
  }

  // ---- 表（2列×2行＋たて矢印＋よこ矢印） ----
  function renderBoard() {
    var p = problem();
    var u = M.unknownIndex(p), k = 1 - u;

    var tbl = document.createElement('table');
    tbl.className = 'ratio orient-' + state.orient;
    tbl.appendChild(valueRow(p, '基準', p.base, 0, u));
    tbl.appendChild(arrowRowV(p, u, k));
    tbl.appendChild(valueRow(p, '知りたい量', p.target, 1, u));

    el.board.innerHTML = '';
    el.board.appendChild(tbl);
    renderEqLine();
  }

  // 値の行。列の間に「よこ矢印」のセルを挟む。
  function valueRow(p, head, values, ri, u) {
    var tr = document.createElement('tr');
    var th = document.createElement('th');
    th.textContent = head;
    tr.appendChild(th);

    tr.appendChild(valueCell(p, values, ri, 0, u));
    tr.appendChild(arrowCellH(p, ri));
    tr.appendChild(valueCell(p, values, ri, 1, u));
    return tr;
  }

  function valueCell(p, values, ri, ci, u) {
    var td = document.createElement('td');
    td.className = 'cell';
    td.dataset.col = String(ci);
    td.dataset.row = String(ri);

    if (ri === 1 && ci === u) {
      var q = shownQuantity(p);
      td.classList.add('unknown');
      if (q) td.classList.add('q-' + q);
      if (!answerReady(p)) td.classList.add('waiting');
      td.appendChild(numberInput('answer', 'input', '?', answerReady(p)));
      if (isSci(p)) {
        var x10 = document.createElement('span');
        x10.className = 'unit';
        x10.textContent = '×10';
        td.appendChild(x10);
        td.appendChild(numberInput('answerExp', 'exp', '23', answerReady(p), 'expBox'));
      }
      td.appendChild(unitPart(p, q));
    } else {
      td.classList.add('q-' + p.cols[ci]);
      td.innerHTML = '<span class="num">' + M.disp(values[ci]) + '</span>' +
                     '<span class="unit">' + Q[p.cols[ci]].unit + '</span>';
    }
    return td;
  }

  // たて矢印の行（列ごとに1つ＋よこ矢印列のすき間）
  function arrowRowV(p, u, k) {
    var tr = document.createElement('tr');
    tr.className = 'arrowRow';
    tr.appendChild(document.createElement('th'));
    tr.appendChild(arrowCellV(p, 0, u, k));
    var gap = document.createElement('td');
    gap.className = 'gap';
    tr.appendChild(gap);
    tr.appendChild(arrowCellV(p, 1, u, k));
    return tr;
  }

  // たて矢印: 既知の列（k）が倍率の出どころ、未知の列（u）が受け取り先
  function arrowCellV(p, ci, u, k) {
    var td = document.createElement('td');
    td.className = 'arrow arrowV' + (state.orient === 'v' ? ' active' : ' dim');
    td.dataset.col = String(ci);
    td.appendChild(arrowBody(p, '↓', state.orient === 'v', ci === k));
    return td;
  }

  // よこ矢印: 基準の行（0）が倍率の出どころ、知りたい量の行（1）が受け取り先。
  // 未知は必ず右の列なので、矢印は常に → で読める（向きが問題ごとに変わらない）
  function arrowCellH(p, ri) {
    var td = document.createElement('td');
    td.className = 'arrow arrowH' + (state.orient === 'h' ? ' active' : ' dim');
    td.dataset.row = String(ri);
    td.appendChild(arrowBody(p, '→', state.orient === 'h', ri === 0));
    return td;
  }

  // 矢印1本の中身。active かつ出どころ側なら倍率（表示 or 入力）、
  // active かつ受け取り側なら「同じ倍率」の空欄。
  function arrowBody(p, glyph, active, isSource) {
    var wrap = document.createElement('span');
    wrap.className = 'arrowBody';
    var ar = document.createElement('span');
    ar.className = 'ar';
    ar.textContent = glyph;
    wrap.appendChild(ar);
    if (!active) return wrap;

    var f = document.createElement('span');
    f.className = 'f ' + (isSource ? 'known' : 'carried');
    if (isSource) {
      if (needFactor(p) && !state.locked) {
        f.classList.add('editable');
        f.appendChild(factorInputs());
      } else {
        f.innerHTML = factorHTML(p);
      }
    } else {
      f.innerHTML = state.locked ? factorHTML(p) : '<span class="qmark">同じ倍率</span>';
      if (state.locked) f.classList.add('landed');
    }
    wrap.appendChild(f);
    return wrap;
  }

  // 倍率の表示。分母の小さい分数は縦分数で見せるが、112/5 のような分数は
  // 小数（22.4）のほうが楽なので、モデルの判断（factorForm）に従う。
  function factorHTML(p) {
    var form = M.factorForm(factor(p));
    if (form.kind === 'frac') {
      return '×<span class="frac"><span class="n">' + form.n + '</span>' +
             '<span class="d">' + form.d + '</span></span>';
    }
    return '×' + form.text;
  }

  // 倍率の入力（分子／分母）。正しく入った瞬間に もう一方へ転記する。
  function factorInputs() {
    var wrap = document.createElement('span');
    wrap.className = 'facIn';
    wrap.appendChild(document.createTextNode('×'));
    var fr = document.createElement('span');
    fr.className = 'frac';
    fr.appendChild(facBox('facN', 'fn'));
    fr.appendChild(facBox('facD', 'fd'));
    wrap.appendChild(fr);
    return wrap;
  }

  function facBox(id, key) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'facBox ' + (key === 'fn' ? 'n' : 'd');
    inp.id = id;
    inp.inputMode = 'decimal';
    inp.value = state[key];
    inp.placeholder = key === 'fn' ? '□' : '□';
    inp.oninput = function () { state[key] = inp.value; tryLockFactor(); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
    return inp;
  }

  // 「自動でもう一方の倍率が入力される」体験の実装
  function tryLockFactor() {
    var p = problem();
    if (state.fn === '' || state.fd === '') return;
    if (!M.checkFactor(p, state.orient, state.fn, state.fd)) return;
    state.locked = true;
    renderBoard();
    var focusEl = document.getElementById('answer');
    if (focusEl) focusEl.focus();
    el.msg.innerHTML = '<span class="ok">その倍率で合っています</span>' +
      '<span class="lead">同じ倍率がもう一方にも入りました。答えを計算しよう。</span>';
  }

  function numberInput(id, key, placeholder, enabled, cls) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'num' + (cls ? ' ' + cls : '');
    inp.id = id;
    inp.inputMode = 'decimal';
    inp.value = state[key];
    inp.placeholder = placeholder;
    if (!enabled) { inp.disabled = true; inp.placeholder = '…'; }
    inp.oninput = function () { state[key] = inp.value; renderEqLine(); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
    return inp;
  }

  function unitPart(p, q) {
    if (!needUnit(p)) {
      var s = document.createElement('span');
      s.className = 'unit';
      s.textContent = Q[M.unknownQuantity(p)].unit;
      return s;
    }
    var wrap = document.createElement('span');
    wrap.className = 'unitPick';
    p.choices.forEach(function (key) {
      var b = document.createElement('button');
      b.textContent = Q[key].unit;
      b.dataset.q = key;
      if (state.picked === key) b.className = 'picked';
      b.onclick = function () { pickUnit(key); };
      wrap.appendChild(b);
    });
    return wrap;
  }

  // 横に読む形（比例式の一行）
  function renderEqLine() {
    var p = problem();
    var u = M.unknownIndex(p);
    var q = shownQuantity(p);

    function term(value, quantity, unknown) {
      var num = unknown
        ? '<span class="x">' + (inputDisp(p) !== '' ? inputDisp(p) : '▢') + '</span>'
        : M.disp(value);
      var unit = quantity ? '<span class="u">' + Q[quantity].unit + '</span>'
                          : '<span class="u">▢</span>';
      return num + ' ' + unit;
    }
    el.eqLine.innerHTML =
      term(p.base[0], p.cols[0], false) + ' : ' + term(p.base[1], p.cols[1], false) +
      ' ＝ ' +
      term(p.target[0], u === 0 ? q : p.cols[0], u === 0) + ' : ' +
      term(p.target[1], u === 1 ? q : p.cols[1], u === 1);
  }

  function clearMarks() {
    el.msg.innerHTML = '';
    var tbl = el.board.querySelector('table');
    if (!tbl) return;
    tbl.classList.remove('solved');
    Array.prototype.forEach.call(tbl.querySelectorAll('td.cell'), function (td) {
      td.classList.remove('hl-bad', 'mismatch');
    });
  }

  function setProblem(i) {
    state.idx = i;
    state.picked = null;
    state.fn = ''; state.fd = ''; state.locked = false;
    state.input = ''; state.exp = '';
    var p = problem();
    var rec = M.recommend(p);
    state.orient = rec === 'h' ? 'h' : 'v';

    el.qTitle.innerHTML = '問' + (i + 1) + '　' + p.title +
      (p.sigfigs ? '<span class="sig">有効数字' + p.sigfigs + '桁で答えよ</span>' : '');
    el.qHint.innerHTML = '💡 ' + p.hint;
    el.nextBtn.hidden = true;
    renderNav();
    renderOrientBar();
    renderBoard();
    el.msg.innerHTML = '<span class="lead">' + leadText(p) + '</span>';
  }

  function leadText(p) {
    if (needUnit(p)) return 'まず、答えの<b>単位</b>をえらぼう。';
    if (needFactor(p)) return '既知の2つの値から<b>倍率</b>を見つけて、分数で入れてみよう。';
    return '矢印に書いてある<b>倍率</b>を、もう一方にも同じように使おう。';
  }

  function pickUnit(key) {
    state.picked = key;
    clearMarks();
    renderBoard();
  }

  function showMismatch(mm) {
    var p = problem();
    var u = M.unknownIndex(p);
    var tbl = el.board.querySelector('table');
    [tbl.querySelector('td.cell[data-row="1"][data-col="' + u + '"]'),
     tbl.querySelector('td.cell[data-row="0"][data-col="' + u + '"]')].forEach(function (td) {
      if (td) { td.classList.add('hl-bad'); td.classList.add('mismatch'); }
    });
    el.msg.innerHTML = '<span class="ng">たての列がそろっていません</span>' +
      '<span class="why">' + mm.text + '</span>' + fracTableHTML(p);
  }

  // 採点時に添える分数⇔小数の対照表（計算が苦手な人向け）
  function fracTableHTML(p) {
    var rows = M.fractionTable(p).map(function (f) {
      return '<span class="ft' + (f.used ? ' used' : '') + '">' +
        f.n + '/' + f.d + ' = ' + f.dec + '</span>';
    }).join('');
    return '<div class="fracTable"><div class="ftHead">分数と小数の対照</div>' + rows + '</div>';
  }

  function check() {
    var p = problem();
    clearMarks();

    if (needUnit(p) && !state.picked) {
      el.msg.innerHTML = '<span class="ng">まず単位をえらぼう</span>';
      return;
    }
    if (needUnit(p)) {
      var mm = M.mismatch(p, state.picked);
      if (mm) { showMismatch(mm); return; }
    }
    if (needFactor(p) && !state.locked) {
      var f = factor(p);
      el.msg.innerHTML = '<span class="ng">倍率がまだ合っていません</span>' +
        '<span class="why">' + (state.orient === 'v'
          ? M.disp(p.base[1 - M.unknownIndex(p)]) + ' から ' +
            M.disp(p.target[1 - M.unknownIndex(p)]) + ' へ何倍か'
          : '基準の行 ' + M.disp(p.base[1 - M.unknownIndex(p)]) + ' から ' +
            M.disp(p.base[M.unknownIndex(p)]) + ' へ何倍か') +
        'を分数で考えよう。</span>' + fracTableHTML(p);
      return;
    }

    var raw = inputValue(p);
    if (raw.trim() === '') {
      el.msg.innerHTML = '<span class="ng">' +
        (isSci(p) ? '数と指数の両方を入れてみよう' : '数を入れてみよう') + '</span>';
      return;
    }

    var g = M.grade(p, raw, isSci(p) ? state.input : undefined);

    if (g.status === 'ok') {
      state.solved[p.id] = true;
      el.board.querySelector('table').classList.add('solved');
      if (!needFactor(p)) { state.locked = true; renderBoard(); }
      el.msg.innerHTML = '<span class="ok">正解！　同じ倍率が両方にはたらいている</span>' +
        '<span class="work">' + workText(p) + '</span>' + fracTableHTML(p);
      el.nextBtn.hidden = (state.idx >= M.PROBLEMS.length - 1);
      renderNav();
      return;
    }

    // 12×10²³ は値としては正しいが、指数表記の書き方が正しくない
    if (g.status === 'sciform') {
      el.msg.innerHTML = '<span class="ng">値は合っています。指数の書き方を直そう</span>' +
        '<span class="why">指数表記は <b>1 以上 10 未満</b>の数 ×10<sup>n</sup> で書きます。' +
        '<b>' + g.mantissa + '×10' + M.sup(state.exp) + '</b> ではなく <b>' +
        M.disp(p.ansDisp) + '</b> と書きます。</span>' + fracTableHTML(p);
      return;
    }

    if (g.status === 'sigfig') {
      // 値は合っている。書き方だけを直させる（これが有効数字の指導）
      el.msg.innerHTML = '<span class="ng">値は合っています。書き方を直そう</span>' +
        '<span class="why">この問題は<b>有効数字' + g.need + '桁</b>で答えます。' +
        '<b>' + M.disp(p.ansDisp) + '</b> と書きます' +
        (g.got ? '（いまの答えは' + g.got + '桁）' : '') + '。</span>' + fracTableHTML(p);
      return;
    }

    if (g.status === 'flip') {
      var fv = factor(p);
      el.msg.innerHTML = '<span class="ng">倍率が逆さまになっています</span>' +
        '<span class="why">' + M.factorText(fv) + ' をかけるところです。' +
        '分子と分母を入れかえてしまったようです。</span>' + fracTableHTML(p);
      return;
    }

    el.msg.innerHTML = '<span class="ng">ちがうみたい</span>' +
      '<span class="why">倍率は <b>' + M.factorText(factor(p)) +
      '</b>。これを ' + M.disp(sourceValue(p)) + ' ' + Q[sourceQuantity(p)].unit +
      ' にかけてみよう。</span>' + fracTableHTML(p);
  }

  // 答えを出すためにどの値へ倍率をかけるか（向きで変わる）
  function sourceValue(p) {
    var u = M.unknownIndex(p), k = 1 - u;
    return state.orient === 'v' ? p.base[u] : p.target[k];
  }
  function sourceQuantity(p) {
    var u = M.unknownIndex(p), k = 1 - u;
    return state.orient === 'v' ? p.cols[u] : p.cols[k];
  }

  function workText(p) {
    var u = M.unknownIndex(p), k = 1 - u;
    var ft = M.factorText(factor(p));
    var ans = (p.ansDisp ? M.disp(p.ansDisp) : M.fmt(M.solve(p))) + ' ' + Q[p.cols[u]].unit;
    if (state.orient === 'v') {
      return M.disp(p.base[k]) + ' ' + Q[p.cols[k]].unit + ' → ' +
        M.disp(p.target[k]) + ' ' + Q[p.cols[k]].unit + ' は ' + ft + '。' +
        'たてに同じ倍率だから　' + M.disp(p.base[u]) + ' ' + Q[p.cols[u]].unit +
        ' ' + ft + ' ＝ ' + ans;
    }
    return '基準の行で ' + M.disp(p.base[k]) + ' ' + Q[p.cols[k]].unit + ' → ' +
      M.disp(p.base[u]) + ' ' + Q[p.cols[u]].unit + ' は ' + ft + '。' +
      'よこに同じ倍率だから　' + M.disp(p.target[k]) + ' ' + Q[p.cols[k]].unit +
      ' ' + ft + ' ＝ ' + ans;
  }

  el.checkBtn.onclick = check;
  el.nextBtn.onclick = function () {
    if (state.idx < M.PROBLEMS.length - 1) setProblem(state.idx + 1);
  };

  setProblem(0);

  // テスト・デバッグ用
  window.ChemRatioApp = {
    state: state,
    setProblem: setProblem,
    setOrient: setOrient,
    pickUnit: pickUnit,
    typeFactor: function (n, d) {
      state.fn = String(n); state.fd = String(d);
      var a = document.getElementById('facN'), b = document.getElementById('facD');
      if (a) a.value = state.fn;
      if (b) b.value = state.fd;
      tryLockFactor();
    },
    type: function (v) {
      state.input = String(v);
      var inp = document.getElementById('answer');
      if (inp) inp.value = state.input;
      renderEqLine();
    },
    typeExp: function (v) {
      state.exp = String(v);
      var inp = document.getElementById('answerExp');
      if (inp) inp.value = state.exp;
      renderEqLine();
    },
    check: check,
    msgText: function () { return el.msg.textContent; }
  };
})();
