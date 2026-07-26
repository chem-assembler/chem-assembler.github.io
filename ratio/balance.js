// 比例式でみる化学計算 — 天秤（加重平均）モード
// 平均原子量・平均分子量を【数直線と支点】で見る。
// 核心は **腕の長さの比 ＝ 個数の逆比**。多いほうに支点が寄る。
(function () {
  'use strict';

  var M = window.ChemRatio;
  var B = M.BALANCE;

  // 数直線の描画範囲（SVG 座標）
  var X0 = 90, X1 = 410, BEAM_Y = 128, PAN_Y = 66;

  var state = {
    idx: 0,
    input: '',       // 平均（kind: average）
    rn: '', rm: '',  // 整数比（kind: ratio）
    div: 0,          // 区間の分割数（0 = 分割しない）
    solved: {}
  };

  var el = {};
  ['stageNav', 'qTitle', 'qHint', 'divBar', 'beam', 'answerArea', 'checkBtn', 'nextBtn', 'msg']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  function problem() { return B[state.idx]; }
  function isAvg(p) { return p.kind === 'average'; }

  function xOf(p, v) {
    var lo = M.val(p.items[0].value), hi = M.val(p.items[1].value);
    return X0 + (X1 - X0) * (v - lo) / (hi - lo);
  }

  // 支点を描くべきか。平均を問う問題では答えが出るまで描かない（位置＝答えなので）
  function fulcrumValue(p) {
    if (!isAvg(p)) return M.balAverage(p);
    return state.solved[p.id] ? M.balAverage(p) : null;
  }

  // 支点のラベル。**与えられた平均は丸めてはいけない**（35.5 を2桁で丸めて 36 と
  // 表示する不具合があった）。問われている場合だけ有効数字の表記を使う。
  function fulcrumLabel(p) {
    return isAvg(p) ? M.disp(p.ansDisp) : M.disp(p.average);
  }

  // 皿に書く個数。存在比なら % を付けて原子量と区別する
  function amountText(p, n) {
    if (n === null) return '?';
    return M.fmt(n) + (isAvg(p) && p.amountUnit ? p.amountUnit : '');
  }

  function amounts(p) {
    if (isAvg(p)) return [p.items[0].amount, p.items[1].amount];
    if (!state.solved[p.id]) return null;
    var r = M.balRatio(p);
    return r ? [r.n, r.d] : null;
  }

  function renderNav() {
    el.stageNav.innerHTML = '';
    B.forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = String(i + 1);
      if (i === state.idx) b.className = 'active';
      else if (state.solved[p.id]) b.className = 'cleared';
      b.onclick = function () { setProblem(i); };
      el.stageNav.appendChild(b);
    });
  }

  // ---- 区間の分割数（目盛りを入れて内分点を見つけやすくする） ----
  function renderDivBar() {
    var p = problem();
    var fit = M.divisionsFor(p);
    el.divBar.innerHTML = '';

    var label = document.createElement('span');
    label.className = 'divLabel';
    label.textContent = '区間を等分する：';
    el.divBar.appendChild(label);

    [0, 2, 3, 4, 5, 8, 10].forEach(function (n) {
      var b = document.createElement('button');
      b.textContent = n === 0 ? 'なし' : n + '等分';
      b.dataset.div = String(n);
      b.className = (state.div === n ? 'on' : '') + (n !== 0 && n === fit ? ' fit' : '');
      b.onclick = function () { state.div = n; renderDivBar(); renderBeam(); };
      el.divBar.appendChild(b);
    });

    var tag = document.createElement('span');
    tag.className = 'divTag';
    tag.textContent = fit
      ? (fit <= 10 ? fit + '等分すると支点が目盛りに乗る' : '')
      : 'この問題は簡単な等分では目盛りに乗らない';
    el.divBar.appendChild(tag);
  }

  function renderBeam() {
    var p = problem();
    var lo = p.items[0], hi = p.items[1];
    var fx = fulcrumValue(p);
    var amt = amounts(p);
    var s = [];

    s.push('<line class="beam" x1="' + X0 + '" y1="' + BEAM_Y + '" x2="' + X1 +
           '" y2="' + BEAM_Y + '"/>');

    // 等分の目盛り
    if (state.div >= 2) {
      for (var i = 1; i < state.div; i++) {
        var tx = X0 + (X1 - X0) * i / state.div;
        var tv = M.val(lo.value) + (M.val(hi.value) - M.val(lo.value)) * i / state.div;
        s.push('<line class="tick" x1="' + tx + '" y1="' + (BEAM_Y - 7) + '" x2="' + tx +
               '" y2="' + (BEAM_Y + 7) + '"/>');
        s.push('<text class="tickVal" x="' + tx + '" y="' + (BEAM_Y + 20) + '">' +
               M.fmt(Math.round(tv * 1000) / 1000) + '</text>');
      }
    }

    // 両端の値と皿
    [lo, hi].forEach(function (it, i) {
      var x = i === 0 ? X0 : X1;
      s.push('<line class="stem" x1="' + x + '" y1="' + BEAM_Y + '" x2="' + x +
             '" y2="' + (PAN_Y + 22) + '"/>');
      s.push('<text class="val" x="' + x + '" y="' + (BEAM_Y + 34) + '">' +
             M.disp(it.value) + '</text>');
      s.push('<text class="lab" x="' + x + '" y="' + (BEAM_Y + 50) + '">' + it.label + '</text>');
      var n = amt ? amt[i] : null;
      var w = n === null ? 30 : Math.max(24, Math.min(70, 24 + 46 * n / (amt[0] + amt[1])));
      s.push('<rect class="pan' + (n === null ? ' unknown' : '') + '" x="' + (x - w / 2) +
             '" y="' + PAN_Y + '" width="' + w + '" height="22" rx="4"/>');
      s.push('<text class="amt" x="' + x + '" y="' + (PAN_Y + 16) + '">' +
             amountText(p, n) + '</text>');
    });

    // 支点と腕の長さ
    if (fx !== null) {
      var x = xOf(p, fx);
      var arms = M.balArms(p, fx);
      s.push('<polygon class="fulcrum" points="' + x + ',' + (BEAM_Y - 2) + ' ' +
             (x - 11) + ',' + (BEAM_Y + 20) + ' ' + (x + 11) + ',' + (BEAM_Y + 20) + '"/>');
      s.push('<text class="avg" x="' + x + '" y="' + (BEAM_Y - 34) + '">' +
             fulcrumLabel(p) + '</text>');
      [[X0, x, arms[0], 0], [x, X1, arms[1], 1]].forEach(function (a) {
        var mid = (a[0] + a[1]) / 2;
        s.push('<line class="arm arm' + a[3] + '" x1="' + a[0] + '" y1="' + (BEAM_Y - 20) +
               '" x2="' + a[1] + '" y2="' + (BEAM_Y - 20) + '"/>');
        s.push('<text class="armLab arm' + a[3] + '" x="' + mid + '" y="' + (BEAM_Y - 25) +
               '">' + M.fmt(Math.round(a[2] * 1000) / 1000) + '</text>');
      });
    }

    el.beam.innerHTML = s.join('');
  }

  function renderAnswer() {
    var p = problem();
    el.answerArea.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'ansRow';

    if (isAvg(p)) {
      row.innerHTML = '<span class="ansLabel">平均' + p.quantity + ' ＝ </span>';
      row.appendChild(mkInput('answer', 'input', '?'));
      el.answerArea.appendChild(row);
      return;
    }
    row.innerHTML = '<span class="ansLabel">' + p.items[0].label + ' : ' +
                    p.items[1].label + ' ＝ </span>';
    row.appendChild(mkInput('ansN', 'rn', '□'));
    var colon = document.createElement('span');
    colon.className = 'colon';
    colon.textContent = ' : ';
    row.appendChild(colon);
    row.appendChild(mkInput('ansM', 'rm', '□'));
    el.answerArea.appendChild(row);
  }

  function mkInput(id, key, ph) {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'num';
    inp.id = id;
    inp.inputMode = 'decimal';
    inp.value = state[key];
    inp.placeholder = ph;
    inp.oninput = function () { state[key] = inp.value; };
    inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
    return inp;
  }

  function setProblem(i) {
    state.idx = i;
    state.input = ''; state.rn = ''; state.rm = ''; state.div = 0;
    var p = problem();
    el.qTitle.innerHTML = '問' + (i + 1) + '　' + p.title +
      (isAvg(p) ? '<span class="sig">有効数字' + p.sig + '桁で答えよ</span>' : '');
    el.qHint.innerHTML = '💡 ' + p.hint;
    el.nextBtn.hidden = true;
    renderNav();
    renderDivBar();
    renderBeam();
    renderAnswer();
    el.msg.innerHTML = '<span class="lead">' + (isAvg(p)
      ? '個数が多いほうに支点が寄る。どのあたりに来るか考えてみよう。'
      : '腕の長さを比べよう。<b>長いほうが少なく、短いほうが多い</b>。') + '</span>';
  }

  function check() {
    var p = problem();
    el.msg.innerHTML = '';

    if (isAvg(p)) {
      if (state.input.trim() === '') {
        el.msg.innerHTML = '<span class="ng">数を入れてみよう</span>';
        return;
      }
      var g = M.gradeBalance(p, state.input);
      if (g.status === 'ok') return succeed(p);
      if (g.status === 'sigfig') {
        el.msg.innerHTML = '<span class="ng">値は合っています。書き方を直そう</span>' +
          '<span class="why">この問題は<b>有効数字' + g.need + '桁</b>で答えます。' +
          '<b>' + M.disp(p.ansDisp) + '</b> と書きます' +
          (g.got ? '（いまの答えは' + g.got + '桁）' : '') + '。</span>';
        return;
      }
      if (g.status === 'flip') {
        el.msg.innerHTML = '<span class="ng">多いほうと少ないほうが逆です</span>' +
          '<span class="why">' + heavierIsMore(p) + '</span>';
        return;
      }
      el.msg.innerHTML = '<span class="ng">ちがうみたい</span>' +
        '<span class="why">答えは必ず ' + M.disp(p.items[0].value) + ' と ' +
        M.disp(p.items[1].value) + ' の<b>あいだ</b>に来ます。' + heavierIsMore(p) + '</span>';
      return;
    }

    if (state.rn.trim() === '' || state.rm.trim() === '') {
      el.msg.innerHTML = '<span class="ng">比の2つの数を入れてみよう</span>';
      return;
    }
    if (M.checkBalRatio(p, state.rn, state.rm)) return succeed(p);
    var arms = M.balArms(p);
    el.msg.innerHTML = '<span class="ng">ちがうみたい</span>' +
      '<span class="why">腕の長さは <b>' + f3(arms[0]) + '</b> と <b>' + f3(arms[1]) +
      '</b>。個数の比はこの<b>逆</b>になります（腕が短いほうが多い）。</span>';
  }

  function f3(x) { return M.fmt(Math.round(x * 1000) / 1000); }

  function heavierIsMore(p) {
    var avg = M.balAverage(p);
    var mid = (M.val(p.items[0].value) + M.val(p.items[1].value)) / 2;
    if (Math.abs(avg - mid) < 1e-12) return '同じ数ずつなので、支点はちょうど真ん中に来ます。';
    var nearer = avg < mid ? p.items[0] : p.items[1];
    return nearer.label + ' のほうが多いので、支点は ' + M.disp(nearer.value) + ' 側に寄ります。';
  }

  // 解説。丸める前の値・内分の比・天秤を使わない別解まで載せる
  function explain(p) {
    var arms = M.balArms(p);
    var ar = M.balArmRatio(p);          // 内分比（腕の長さの比）
    var r = M.balRatio(p);              // 個数の比（その逆）
    var lo = M.disp(p.items[0].value), hi = M.disp(p.items[1].value);
    var lines = [];

    lines.push('腕の長さは <b>' + f3(arms[0]) + ' : ' + f3(arms[1]) + '</b>' +
      (ar ? '（＝ <b>' + ar.n + ' : ' + ar.d + '</b>）' : '') + '。');
    lines.push('つまり平均は ' + lo + ' と ' + hi + ' の間を <b>' +
      (ar ? ar.n + ' : ' + ar.d : f3(arms[0]) + ' : ' + f3(arms[1])) +
      '</b> に<b>内分する点</b>。');
    lines.push('個数の比はその<b>逆</b>で <b>' + (r ? r.n + ' : ' + r.d : '—') + '</b>' +
      (isAvg(p) && p.amountUnit === '%' ? '（＝ ' + M.fmt(p.items[0].amount) + '% と ' +
        M.fmt(p.items[1].amount) + '%）' : '') + '。腕が短いほうが多い。');

    var exact = M.balAverage(p);
    if (isAvg(p)) {
      var rounded = M.disp(p.ansDisp);
      if (M.fmt(exact) !== rounded) {
        lines.push('丸める前の値は <b>' + M.fmt(exact) + '</b>。有効数字' + p.sig +
                   '桁にして <b>' + rounded + '</b>。');
      }
      lines.push('<span class="alt">別解（天秤を使わない）：' + altAverage(p) + '</span>');
    } else {
      lines.push('<span class="alt">別解（方程式）：' + altEquation(p) + '</span>');
    }
    return lines.join('<br>');
  }

  // 定義どおりの加重平均の式
  function altAverage(p) {
    var a = p.items[0], b = p.items[1];
    var exact = M.fmt(M.balAverage(p));
    if (p.amountUnit === '%') {
      return M.disp(a.value) + '×' + M.fmt(a.amount / 100) + ' ＋ ' +
             M.disp(b.value) + '×' + M.fmt(b.amount / 100) + ' ＝ ' + exact;
    }
    var sum = a.amount + b.amount;
    return '（' + M.disp(a.value) + '×' + M.fmt(a.amount) + ' ＋ ' +
           M.disp(b.value) + '×' + M.fmt(b.amount) + '）÷ ' + M.fmt(sum) + ' ＝ ' + exact;
  }

  // 割合を x とおいて解く式
  function altEquation(p) {
    var a = p.items[0], b = p.items[1], r = M.balRatio(p);
    var x = r ? r.n / (r.n + r.d) : null;
    return M.disp(a.value) + 'x ＋ ' + M.disp(b.value) + '(1−x) ＝ ' + M.disp(p.average) +
           '　→　x ＝ ' + (x === null ? '—' : M.fmt(Math.round(x * 1000) / 1000)) +
           (r ? '　→　' + r.n + ' : ' + r.d : '');
  }

  function succeed(p) {
    state.solved[p.id] = true;
    renderNav();
    renderBeam();
    el.msg.innerHTML = '<span class="ok">正解！</span>' +
      '<span class="work">' + explain(p) + '</span>';
    el.nextBtn.hidden = (state.idx >= B.length - 1);
  }

  el.checkBtn.onclick = check;
  el.nextBtn.onclick = function () {
    if (state.idx < B.length - 1) setProblem(state.idx + 1);
  };

  setProblem(0);

  // テスト・デバッグ用
  window.ChemBalanceApp = {
    state: state,
    setProblem: setProblem,
    setDiv: function (n) { state.div = n; renderDivBar(); renderBeam(); },
    type: function (v) {
      state.input = String(v);
      var i = document.getElementById('answer');
      if (i) i.value = state.input;
    },
    typeRatio: function (n, m) {
      state.rn = String(n); state.rm = String(m);
      var a = document.getElementById('ansN'), b = document.getElementById('ansM');
      if (a) a.value = state.rn;
      if (b) b.value = state.rm;
    },
    check: check,
    msgText: function () { return el.msg.textContent; }
  };
})();
