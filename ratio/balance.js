// 比例式でみる化学計算 — 天秤（加重平均）モード
// 平均原子量・平均分子量を【数直線と支点】で見る。
// 核心は **腕の長さの比 ＝ 個数の逆比**。多いほうに支点が寄る。
(function () {
  'use strict';

  var M = window.ChemRatio;
  var B = M.BALANCE;

  // 数直線の描画範囲（SVG 座標）
  var X0 = 90, X1 = 410, BEAM_Y = 118, PAN_Y = 60;

  var state = {
    idx: 0,
    input: '',       // 平均（kind: average）
    rn: '', rm: '',  // 整数比（kind: ratio）
    solved: {}
  };

  var el = {};
  ['stageNav', 'qTitle', 'qHint', 'beam', 'answerArea', 'checkBtn', 'nextBtn', 'msg']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  function problem() { return B[state.idx]; }
  function isAvg(p) { return p.kind === 'average'; }

  // 値 → SVG の x 座標（両端の値が X0 / X1 に来るように線形写像）
  function xOf(p, v) {
    var lo = M.val(p.items[0].value), hi = M.val(p.items[1].value);
    return X0 + (X1 - X0) * (v - lo) / (hi - lo);
  }

  // いま支点を描くべき位置。まだ答えが出ていない段階では描かない
  function fulcrumValue(p) {
    if (!isAvg(p)) return M.balAverage(p);          // 平均は最初から与えられている
    return state.solved[p.id] ? M.balAverage(p) : null;
  }

  // 個数の比（表示用）。kind:'average' は問題が持っている。kind:'ratio' は答え。
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

  function esc(s) { return s; }   // ラベルは自前のデータなのでそのまま使う

  function renderBeam() {
    var p = problem();
    var lo = p.items[0], hi = p.items[1];
    var fx = fulcrumValue(p);
    var amt = amounts(p);
    var s = [];

    // 目盛りの棒
    s.push('<line class="beam" x1="' + X0 + '" y1="' + BEAM_Y + '" x2="' + X1 +
           '" y2="' + BEAM_Y + '"/>');

    // 両端の値と皿
    [lo, hi].forEach(function (it, i) {
      var x = i === 0 ? X0 : X1;
      s.push('<line class="stem" x1="' + x + '" y1="' + BEAM_Y + '" x2="' + x +
             '" y2="' + (PAN_Y + 22) + '"/>');
      s.push('<text class="val" x="' + x + '" y="' + (BEAM_Y + 24) + '">' +
             M.disp(it.value) + '</text>');
      s.push('<text class="lab" x="' + x + '" y="' + (BEAM_Y + 42) + '">' + esc(it.label) + '</text>');
      // 皿（個数が分かっているときだけ大きさを変える）
      var n = amt ? amt[i] : null;
      var w = n === null ? 26 : Math.max(20, Math.min(64, 20 + 44 * n / (amt[0] + amt[1])));
      s.push('<rect class="pan' + (n === null ? ' unknown' : '') + '" x="' + (x - w / 2) +
             '" y="' + PAN_Y + '" width="' + w + '" height="22" rx="4"/>');
      s.push('<text class="amt" x="' + x + '" y="' + (PAN_Y + 16) + '">' +
             (n === null ? '?' : M.fmt(n)) + '</text>');
    });

    // 支点と腕の長さ
    if (fx !== null) {
      var x = xOf(p, fx);
      var arms = M.balArms(p, fx);
      s.push('<polygon class="fulcrum" points="' + x + ',' + (BEAM_Y - 2) + ' ' +
             (x - 11) + ',' + (BEAM_Y + 20) + ' ' + (x + 11) + ',' + (BEAM_Y + 20) + '"/>');
      s.push('<text class="avg" x="' + x + '" y="' + (BEAM_Y - 10) + '">' +
             M.toSig(fx, p.sig) + '</text>');
      // 腕（支点から両端へ）。長さの比が個数の逆比であることを見せる
      [[X0, x, arms[0], 0], [x, X1, arms[1], 1]].forEach(function (a) {
        var mid = (a[0] + a[1]) / 2;
        s.push('<line class="arm arm' + a[3] + '" x1="' + a[0] + '" y1="' + (BEAM_Y - 26) +
               '" x2="' + a[1] + '" y2="' + (BEAM_Y - 26) + '"/>');
        s.push('<text class="armLab arm' + a[3] + '" x="' + mid + '" y="' + (BEAM_Y - 32) +
               '">' + M.fmt(Math.round(a[2] * 1000) / 1000) + '</text>');
      });
    }

    el.beam.innerHTML = s.join('');
  }

  function renderAnswer() {
    var p = problem();
    el.answerArea.innerHTML = '';
    if (isAvg(p)) {
      var wrap = document.createElement('div');
      wrap.className = 'ansRow';
      wrap.innerHTML = '<span class="ansLabel">平均' + p.quantity + ' ＝ </span>';
      var inp = mkInput('answer', 'input', '?');
      wrap.appendChild(inp);
      el.answerArea.appendChild(wrap);
      return;
    }
    var row = document.createElement('div');
    row.className = 'ansRow';
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
    state.input = ''; state.rn = ''; state.rm = '';
    var p = problem();
    el.qTitle.innerHTML = '問' + (i + 1) + '　' + p.title +
      (isAvg(p) ? '<span class="sig">有効数字' + p.sig + '桁で答えよ</span>' : '');
    el.qHint.innerHTML = '💡 ' + p.hint;
    el.nextBtn.hidden = true;
    renderNav();
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
      '<span class="why">腕の長さは <b>' + M.fmt(Math.round(arms[0] * 1000) / 1000) +
      '</b> と <b>' + M.fmt(Math.round(arms[1] * 1000) / 1000) +
      '</b>。個数の比はこの<b>逆</b>になります（腕が短いほうが多い）。</span>';
  }

  // どちらが多いかを言葉にする（支点がどちらに寄るかの根拠）
  function heavierIsMore(p) {
    var avg = M.balAverage(p);
    var mid = (M.val(p.items[0].value) + M.val(p.items[1].value)) / 2;
    if (Math.abs(avg - mid) < 1e-12) return '同じ数ずつなので、支点はちょうど真ん中に来ます。';
    var nearer = avg < mid ? p.items[0] : p.items[1];
    return nearer.label + ' のほうが多いので、支点は ' + M.disp(nearer.value) + ' 側に寄ります。';
  }

  function succeed(p) {
    state.solved[p.id] = true;
    renderNav();
    renderBeam();
    var arms = M.balArms(p);
    var r = M.balRatio(p);
    var f = function (x) { return M.fmt(Math.round(x * 1000) / 1000); };
    el.msg.innerHTML = '<span class="ok">正解！</span>' +
      '<span class="work">腕の長さは ' + f(arms[0]) + ' : ' + f(arms[1]) +
      '　→　個数の比はその逆で ' + (r ? r.n + ' : ' + r.d : '—') + '。' +
      '<b>腕が短いほうが多い</b>。</span>';
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
