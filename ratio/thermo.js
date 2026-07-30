// 比例式でみる化学計算 — エネルギーでみる熱化学（M5）
// レンズは【エネルギー図の高さ】。このアプリの通し筋である「何かが同じ」を、
// ここでは **どの経路を通っても高さの差は同じ**（ヘスの法則）が担う。
//   ΔH ＝ （到達点の高さ）−（出発点の高さ）／逆向きにたどれば符号が反転する
// 学習の流れ: 与えられた式から各準位を図に置く（steps.levels）→ 問われた矢印の
//              高さの差を読む。**準位が置けた時点で答えは図から読める**のが要点。
(function () {
  'use strict';

  var M = window.ChemRatio;
  var H = M.THERMO;

  // エネルギー図。**帯を分けて重なりを防ぐ**（他モードと同じ流儀）:
  //   縦軸 60 ／ 準位の線 90〜380（ラベルは線のすぐ上）／ 高さの値 386〜
  var AX = 60, LX0 = 90, LX1 = 380, VX = 386;
  var TOP = 52, BOT = 182;        // 準位の線を置く範囲
  var ARR_X0 = 116, ARR_GAP = 56; // 矢印を横に並べる位置

  var state = {
    idx: 0,
    lv: {}, lvLocked: {},   // 各準位の高さ（学習者が図に置く）
    input: '',              // 答え（ΔH）
    solved: {}
  };

  var el = {};
  ['stageNav', 'qTitle', 'qHint', 'givenBox', 'chart', 'levelRows', 'answerArea',
   'checkBtn', 'nextBtn', 'msg']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  function problem() { return H[state.idx]; }
  function needLevels(p) { return !!(p.steps && p.steps.levels); }
  function placeKeys(p) { return M.thermoPlaceLevels(p); }
  // 準位が全部置けたか（足場を外していない問題では最初から置いてある）
  function levelsOk(p) {
    if (!needLevels(p)) return true;
    return placeKeys(p).every(function (k) { return !!state.lvLocked[k]; });
  }
  // その準位を図に描けるか（基準は常に描く）
  function lvShown(p, key) {
    return key === p.levels[0].key || !needLevels(p) || !!state.lvLocked[key];
  }
  function answerReady(p) { return levelsOk(p); }
  function solvedNow(p) { return !!state.solved[p.id]; }

  function labelOf(p, key) {
    for (var i = 0; i < p.levels.length; i++) {
      if (p.levels[i].key === key) return p.levels[i].label;
    }
    return key;
  }

  function renderNav() {
    el.stageNav.innerHTML = '';
    H.forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = String(i + 1);
      if (i === state.idx) b.className = 'active';
      else if (state.solved[p.id]) b.className = 'cleared';
      b.onclick = function () { setProblem(i); };
      el.stageNav.appendChild(b);
    });
  }

  // 与えられた熱化学方程式。これが図を組み立てる材料になる
  function renderGiven() {
    var p = problem();
    el.givenBox.innerHTML = '<div class="givenHead">与えられた式</div>' +
      p.given.map(function (g) {
        return '<div class="givenEq"><span class="geq">' + g.eq + '</span>' +
          '<span class="gdh">ΔH ＝ ' + M.dhText(M.val(g.dh)) + ' kJ</span></div>';
      }).join('');
  }

  // ---- エネルギー図 ----
  // 準位ごとの y 座標。基本は高さに比例させるが、**近すぎる準位は引き離す**。
  // 黒鉛とダイヤモンド（差 2 kJ に対して全体 396 kJ）のように、比例のままだと
  // 2本が重なって見えず「図で分かる」という利点が消えるため。
  // 縮尺を崩したときは squeezed を立てて、図にそう書く（黙って崩さない）。
  var MIN_GAP = 26;
  function layout(p, hs, keys) {
    var vals = keys.map(function (k) { return hs[k]; });
    var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    // 高い順に並べて、上から最小間隔を確保していく
    var sorted = keys.slice().sort(function (a, b) { return hs[b] - hs[a]; });
    var y = {}, squeezed = false, prev = null;
    sorted.forEach(function (k) {
      var ideal = TOP + (hi - hs[k]) / (hi - lo) * (BOT - TOP);
      if (prev !== null && ideal - y[prev] < MIN_GAP) {
        y[k] = y[prev] + MIN_GAP;
        squeezed = true;
      } else {
        y[k] = ideal;
      }
      prev = k;
    });
    return { y: y, squeezed: squeezed };
  }

  function renderChart() {
    var p = problem();
    var hs = M.thermoHeights(p);
    var shownKeys = p.levels.filter(function (l) { return lvShown(p, l.key); })
                            .map(function (l) { return l.key; });
    var lay = layout(p, hs, shownKeys);
    function y(key) { return lay.y[key]; }

    var s = [];
    // 縦軸（上向き＝エネルギーが高い）
    s.push('<line class="axis" x1="' + AX + '" y1="' + (BOT + 12) + '" x2="' + AX +
           '" y2="' + (TOP - 24) + '"/>');
    s.push('<polygon class="axisHead" points="' + AX + ',' + (TOP - 32) + ' ' +
           (AX - 5) + ',' + (TOP - 22) + ' ' + (AX + 5) + ',' + (TOP - 22) + '"/>');
    s.push('<text class="axisLab" x="' + (AX + 8) + '" y="' + (TOP - 26) +
           '">エネルギーが高い</text>');

    // 準位の線。ラベルは線のすぐ上、高さの値は右端
    p.levels.forEach(function (l) {
      if (!lvShown(p, l.key)) return;
      var ly = y(l.key);
      var isRef = l.key === p.levels[0].key;
      s.push('<line class="lvLine' + (isRef ? ' ref' : '') + '" x1="' + LX0 + '" y1="' + ly +
             '" x2="' + LX1 + '" y2="' + ly + '"/>');
      s.push('<text class="lvLab" x="' + LX0 + '" y="' + (ly - 5) + '">' +
             M.plainLabel(l.label) + '</text>');
      s.push('<text class="lvVal' + (isRef ? ' ref' : '') + '" x="' + VX + '" y="' +
             (ly + 4) + '">' + M.dhText(hs[l.key]) + '</text>');
    });

    // 矢印。to の側に矢じりを付けるので、向きがそのまま符号の意味になる
    var arrows = p.given.map(function (g) {
      return { from: g.from, to: g.to, dh: M.val(g.dh), asked: false };
    });
    arrows.push({ from: p.asked.from, to: p.asked.to, dh: M.thermoSolve(p), asked: true });

    arrows.forEach(function (a, i) {
      if (!lvShown(p, a.from) || !lvShown(p, a.to)) return;
      var ax = ARR_X0 + i * ARR_GAP;
      var y0 = y(a.from), y1 = y(a.to);
      var down = y1 > y0;
      var cls = a.asked ? 'arrAsk' : 'arr';
      s.push('<line class="' + cls + '" x1="' + ax + '" y1="' + y0 + '" x2="' + ax +
             '" y2="' + (y1 + (down ? -8 : 8)) + '"/>');
      s.push('<polygon class="' + cls + 'Head" points="' + ax + ',' + y1 + ' ' +
             (ax - 5) + ',' + (y1 + (down ? -9 : 9)) + ' ' + (ax + 5) + ',' +
             (y1 + (down ? -9 : 9)) + '"/>');
      // 答えの矢印は、答えるまで値を出さない（図が答えを先に言わないように）
      var text = a.asked && !solvedNow(p) ? '?' : M.dhText(a.dh);
      s.push('<text class="' + cls + 'Lab" x="' + (ax + 6) + '" y="' +
             ((y0 + y1) / 2 + 4) + '">' + text + '</text>');
    });

    // 縮尺を崩したなら黙っていない（差の大きさを誤読させないため）
    if (lay.squeezed) {
      s.push('<text class="scaleNote" x="' + LX0 + '" y="' + (BOT + 24) + '">' +
             '※ 差が小さい準位は見やすさのため離して描いています（縮尺は正確ではない）</text>');
    }
    el.chart.setAttribute('viewBox', '0 0 500 ' + (lay.squeezed ? 214 : 200));
    el.chart.innerHTML = s.join('');
  }

  // ---- 準位を図に置く段 ----
  function renderLevelRows() {
    var p = problem();
    el.levelRows.innerHTML = '';
    if (!needLevels(p)) return;

    placeKeys(p).forEach(function (k) {
      var basis = M.thermoBasis(p, k);
      var locked = !!state.lvLocked[k];
      var row = document.createElement('div');
      row.className = 'convRow' + (locked ? ' locked' : '');
      row.innerHTML = '<span class="convStep">準位を置く</span>' +
        '<span class="convFrom">' + labelOf(p, k) + '</span>' +
        '<span class="convArrow">→</span>';

      if (locked) {
        var b = document.createElement('span');
        b.className = 'convVal';
        b.textContent = M.dhText(M.thermoHeights(p)[k]);
        row.appendChild(b);
      } else {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'num convBox';
        inp.id = 'lv-' + k;
        inp.inputMode = 'text';
        inp.value = state.lv[k] || '';
        inp.placeholder = '±?';
        inp.oninput = function () { state.lv[k] = inp.value; tryLockLevel(k); };
        inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
        row.appendChild(inp);
      }
      var u = document.createElement('span');
      u.className = 'convUnit';
      u.textContent = 'kJ';
      row.appendChild(u);
      var why = document.createElement('span');
      why.className = 'convWhy';
      why.innerHTML = basis ? basis.eq + '（' + M.dhText(M.val(basis.dh)) + '）' : '';
      row.appendChild(why);
      el.levelRows.appendChild(row);
    });
  }

  // 正しく置けたら、その準位が図に現れる
  function tryLockLevel(key) {
    var p = problem();
    if (!M.checkLevel(p, key, state.lv[key] || '')) return;
    state.lvLocked[key] = true;
    renderLevelRows();
    renderChart();
    renderAnswer();
    if (levelsOk(p)) {
      var focusEl = document.getElementById('answer');
      if (focusEl) focusEl.focus();
      el.msg.innerHTML = '<span class="ok">図ができました</span>' +
        '<span class="lead">あとは<b>高さの差</b>を読むだけ。' +
        '下がれば −、上がれば ＋。</span>';
    } else {
      el.msg.innerHTML = '<span class="ok">その高さで合っています</span>' +
        '<span class="lead">残りの準位も置いてみよう。</span>';
    }
  }

  function renderAnswer() {
    var p = problem();
    el.answerArea.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'ansRow';
    row.innerHTML = '<span class="ansLabel">ΔH ＝ </span>';

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'num';
    inp.id = 'answer';
    inp.inputMode = 'text';
    inp.value = state.input;
    inp.placeholder = '±?';
    if (!answerReady(p)) { inp.disabled = true; inp.placeholder = '…'; }
    inp.oninput = function () { state.input = inp.value; };
    inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
    row.appendChild(inp);

    var u = document.createElement('span');
    u.className = 'ansUnit';
    u.textContent = 'kJ';
    row.appendChild(u);
    var note = document.createElement('span');
    note.className = 'ansNote';
    note.textContent = '符号（＋ / −）も必要';
    row.appendChild(note);
    el.answerArea.appendChild(row);
  }

  function setProblem(i) {
    state.idx = i;
    state.lv = {}; state.lvLocked = {};
    state.input = '';
    var p = problem();
    el.qTitle.innerHTML = '問' + (i + 1) + '　' + p.title +
      '<span class="sig">有効数字' + p.sig + '桁で答えよ</span>';
    el.qHint.innerHTML = '💡 ' + p.hint;
    el.nextBtn.hidden = true;
    renderNav();
    renderGiven();
    renderChart();
    renderLevelRows();
    renderAnswer();
    el.msg.innerHTML = '<span class="lead">' + (needLevels(p)
      ? 'まず、与えられた式から<b>それぞれの準位の高さ</b>を図に置こう。'
      : '図の<b>高さの差</b>を読もう。矢印の向きで符号が決まる。') + '</span>';
  }

  function check() {
    var p = problem();
    el.msg.innerHTML = '';

    if (needLevels(p) && !levelsOk(p)) {
      var k = placeKeys(p).filter(function (q) { return !state.lvLocked[q]; })[0];
      var basis = M.thermoBasis(p, k);
      el.msg.innerHTML = '<span class="ng">まだ図が組み立っていません</span>' +
        '<span class="why">' + M.plainLabel(labelOf(p, k)) + ' の高さは「' + basis.eq +
        '　ΔH ＝ ' + M.dhText(M.val(basis.dh)) + '」から決まります。' +
        (basis.to === k
          ? '出発点の高さに ΔH を<b>足す</b>と着きます。'
          : '到達点の高さから ΔH を<b>引く</b>と戻れます（逆向きなので符号が反転）。') +
        '</span>';
      return;
    }
    if (state.input.trim() === '') {
      el.msg.innerHTML = '<span class="ng">数を入れてみよう（符号も）</span>';
      return;
    }

    var g = M.gradeThermo(p, state.input);

    if (g.status === 'ok') {
      state.solved[p.id] = true;
      renderNav();
      renderChart();
      el.msg.innerHTML = '<span class="ok">正解！　高さの差がそのまま ΔH</span>' +
        '<span class="work">' + explain(p) + '</span>';
      el.nextBtn.hidden = (state.idx >= H.length - 1);
      return;
    }

    if (g.status === 'sign') {
      var up = M.thermoSolve(p) > 0;
      el.msg.innerHTML = '<span class="ng">符号が逆です</span>' +
        '<span class="why">' + M.plainLabel(labelOf(p, p.asked.from)) + ' から ' +
        M.plainLabel(labelOf(p, p.asked.to)) + ' へは図の上で<b>' +
        (up ? '上がります' : '下がります') + '</b>。' +
        (up ? '上がるので ＋（吸熱）' : '下がるので −（発熱）') +
        'です。ΔH ＝ 到達点 − 出発点 の順を守ろう。</span>';
      return;
    }

    if (g.status === 'addsub') {
      el.msg.innerHTML = '<span class="ng">足してしまっています</span>' +
        '<span class="why">ΔH は高さの<b>差</b>なので、' +
        '到達点の高さ <b>−</b> 出発点の高さ で求めます。</span>';
      return;
    }

    if (g.status === 'sigfig') {
      el.msg.innerHTML = '<span class="ng">値は合っています。書き方を直そう</span>' +
        '<span class="why">この問題は<b>有効数字' + g.need + '桁</b>で答えます。' +
        '<b>' + M.dhText(M.thermoSolve(p)) + '</b> と書きます' +
        (g.got ? '（いまの答えは' + g.got + '桁）' : '') + '。</span>';
      return;
    }

    var hs = M.thermoHeights(p);
    el.msg.innerHTML = '<span class="ng">ちがうみたい</span>' +
      '<span class="why">' + M.plainLabel(labelOf(p, p.asked.to)) + ' は <b>' +
      M.dhText(hs[p.asked.to]) + '</b>、' + M.plainLabel(labelOf(p, p.asked.from)) +
      ' は <b>' + M.dhText(hs[p.asked.from]) + '</b>。この差を取ろう。</span>';
  }

  // 解説。高さ → 差 → 符号の意味。最後に「経路を変えても同じ」を確かめる
  function explain(p) {
    var hs = M.thermoHeights(p);
    var a = hs[p.asked.from], b = hs[p.asked.to];
    var d = M.thermoSolve(p);
    var lines = [];

    lines.push('出発点 ' + M.plainLabel(labelOf(p, p.asked.from)) + ' の高さは <b>' +
      M.dhText(a) + '</b>、到達点 ' + M.plainLabel(labelOf(p, p.asked.to)) +
      ' の高さは <b>' + M.dhText(b) + '</b>。');
    lines.push('ΔH ＝ ' + M.dhText(b) + ' −（' + M.dhText(a) + '）＝ <b>' +
      M.dhText(d) + ' kJ</b>。');
    lines.push(d < 0
      ? '下がったので <b>−（発熱）</b>。まわりに熱を出す。'
      : '上がったので <b>＋（吸熱）</b>。まわりから熱をもらう。');
    lines.push('<span class="alt">逆向き（' +
      M.plainLabel(labelOf(p, p.asked.to)) + ' → ' +
      M.plainLabel(labelOf(p, p.asked.from)) + '）なら ' +
      M.dhText(-d) + ' kJ。符号が反転するだけ</span>');
    return lines.join('<br>');
  }

  el.checkBtn.onclick = check;
  el.nextBtn.onclick = function () {
    if (state.idx < H.length - 1) setProblem(state.idx + 1);
  };

  setProblem(0);

  // テスト・デバッグ用
  window.ChemThermoApp = {
    state: state,
    setProblem: setProblem,
    typeLevel: function (key, v) {
      state.lv[key] = String(v);
      var inp = document.getElementById('lv-' + key);
      if (inp) inp.value = state.lv[key];
      tryLockLevel(key);
    },
    placeAll: function () {
      var p = problem();
      placeKeys(p).forEach(function (k) {
        state.lv[k] = String(M.thermoHeights(p)[k]);
        tryLockLevel(k);
      });
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
