// 比例式でみる化学計算 — 中和滴定（M4）
// 核心は **H⁺ と OH⁻ が結びついて過不足なく消える**こと。
// 数えるのは粒ではなく「出せる H⁺ / OH⁻ の数」なので、価数 n をかけた
// **ブロックの長さ**でつり合いを見る（H₂SO₄ は1粒で2ブロック）。
// 公式 c₁V₁n₁ ＝ c₂V₂n₂ は正解後のまとめに置く（先に出すと代入作業になる）。
// 学習の流れ: 既知側の H⁺（OH⁻）の量を出す（steps.equiv）→ つり合いで同じ量が
//              相手側に移る（自動）→ 未知の体積または濃度を求める
(function () {
  'use strict';

  var M = window.ChemRatio;
  var T = M.TITRATIONS;

  // ブロックの図。**帯を分けて重なりを防ぐ**（天秤・棒くらべと同じ流儀）:
  //   ラベル列 6〜145 ／ ブロック 150〜410 ／ 値 416〜 ／ 注記はブロックより下
  var LX = 6, BX0 = 150, BW = 260, VX = 416;
  var ROW_Y = 30, ROW_H = 26, ROW_GAP = 46;

  var state = {
    idx: 0,
    equiv: '', equivLocked: false,   // 既知側の H⁺ / OH⁻ の物質量
    input: '',                       // 答え（体積 mL または 濃度 mol/L）
    solved: {}
  };

  var el = {};
  ['stageNav', 'qTitle', 'qHint', 'blocks', 'equivRow', 'answerArea',
   'checkBtn', 'nextBtn', 'msg']
    .forEach(function (id) { el[id] = document.getElementById(id); });

  function problem() { return T[state.idx]; }
  function needEquiv(p) { return !!(p.steps && p.steps.equiv); }
  // つり合いの量が確定したか（足場を外していない問題では最初から見えている）
  function equivOk(p) { return !needEquiv(p) || state.equivLocked; }
  function answerReady(p) { return equivOk(p); }

  function formula(key) { return M.SUBSTANCES[key].formula; }
  function unknownSide(p) { return M.titUnknownSide(p); }
  function knownSide(p) { return M.titKnownSide(p); }
  // 答えの単位（体積を問うなら mL、濃度を問うなら mol/L）
  function ansUnit(p) { return M.titField(p) === 'v' ? 'mL' : 'mol/L'; }

  function renderNav() {
    el.stageNav.innerHTML = '';
    T.forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = String(i + 1);
      if (i === state.idx) b.className = 'active';
      else if (state.solved[p.id]) b.className = 'cleared';
      b.onclick = function () { setProblem(i); };
      el.stageNav.appendChild(b);
    });
  }

  // ---- つり合いの図。価数のぶんだけブロックが分かれる ----
  function renderBlocks() {
    var p = problem();
    var un = unknownSide(p), kn = knownSide(p);
    var eq = M.titBalance(p);
    var s = [];

    ['acid', 'base'].forEach(function (side, i) {
      var y = ROW_Y + i * ROW_GAP;
      var sd = p[side];
      var isUnknown = (side === un);
      // つり合いが決まる前は、未知側の長さも決まっていない（点線の枠だけ）
      var known = !isUnknown || equivOk(p);
      s.push(sideLabel(p, side, sd, y, isUnknown));
      if (!known) {
        s.push('<rect class="blkGhost" x="' + BX0 + '" y="' + y + '" width="' + BW +
               '" height="' + ROW_H + '" rx="4"/>');
        s.push('<text class="blkQ" x="' + (BX0 + BW / 2) + '" y="' + (y + 18) + '">?</text>');
        return;
      }
      // ブロックは n 個。1個 ＝ その物質 1 mol 分（＝ 価数で分かれて見える）
      var w = BW / sd.n;
      for (var k = 0; k < sd.n; k++) {
        s.push('<rect class="blk ' + side + '" x="' + (BX0 + k * w) + '" y="' + y +
               '" width="' + w + '" height="' + ROW_H + '" rx="4"/>');
      }
      s.push('<text class="blkVal ' + side + '" x="' + VX + '" y="' + (y + 18) + '">' +
             M.titIon(side) + ' ' + M.stoichDisp(eq, p.sig) + '</text>');
    });

    // つり合いの記号（左右のブロックが同じ長さであることを言葉にする）
    var midY = ROW_Y + ROW_H + (ROW_GAP - ROW_H) / 2 + 4;
    s.push('<text class="blkEq" x="' + (BX0 + BW / 2) + '" y="' + midY + '">＝</text>');
    var bottom = ROW_Y + ROW_GAP + ROW_H;
    s.push('<text class="blkNote" x="250" y="' + (bottom + 22) + '">' +
           'つり合う条件：H⁺ の物質量 ＝ OH⁻ の物質量</text>');
    el.blocks.setAttribute('viewBox', '0 0 500 ' + (bottom + 34));
    el.blocks.innerHTML = s.join('');
  }

  // 左のラベル。濃度 × 体積 と 価数を、その場で読めるように並べる
  function sideLabel(p, side, sd, y, isUnknown) {
    var f = M.titField(p);
    var c = sd.c === null ? (isUnknown && state.solved[p.id] ? M.disp(p.ansDisp) : '?')
                          : M.disp(sd.c);
    var v = sd.v === null ? (isUnknown && state.solved[p.id] ? M.disp(p.ansDisp) : '?')
                          : M.disp(sd.v);
    return '<text class="blkLab" x="' + LX + '" y="' + (y + 11) + '">' +
             (side === 'acid' ? '酸　' : '塩基') + ' ' + M.plainLabel(formula(sd.sub)) +
           '</text>' +
           '<text class="blkSub" x="' + LX + '" y="' + (y + 24) + '">' +
             c + ' mol/L × ' + v + ' mL　価数 ' + sd.n +
           '</text>';
  }

  // ---- 既知側の H⁺ / OH⁻ の量を出す段 ----
  function renderEquivRow() {
    var p = problem();
    var kn = knownSide(p), sd = p[kn];
    el.equivRow.innerHTML = '';

    var row = document.createElement('div');
    row.className = 'convRow' + (equivOk(p) ? ' locked' : '');
    row.innerHTML = '<span class="convStep">' + M.titIon(kn) + ' の物質量を出す</span>' +
      '<span class="convFrom">' + M.disp(sd.c) + ' × ' + M.disp(sd.v) + '/1000 × ' +
      sd.n + '</span><span class="convArrow">→</span>';

    if (equivOk(p)) {
      var b = document.createElement('span');
      b.className = 'convVal';
      b.textContent = M.stoichDisp(M.titBalance(p), p.sig);
      row.appendChild(b);
    } else {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'num convBox';
      inp.id = 'equivIn';
      inp.inputMode = 'decimal';
      inp.value = state.equiv;
      inp.placeholder = '?';
      inp.oninput = function () { state.equiv = inp.value; tryLockEquiv(); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') check(); };
      row.appendChild(inp);
    }
    var u = document.createElement('span');
    u.className = 'convUnit';
    u.textContent = 'mol';
    row.appendChild(u);
    var why = document.createElement('span');
    why.className = 'convWhy';
    why.innerHTML = '濃度 × 体積(L) × 価数';
    row.appendChild(why);
    el.equivRow.appendChild(row);
  }

  // 正しく入ると「同じ量が相手側にも入る」（つり合いの体験）
  function tryLockEquiv() {
    var p = problem();
    if (state.equiv === '' || !M.checkEquiv(p, state.equiv)) return;
    state.equivLocked = true;
    renderEquivRow();
    renderBlocks();
    renderAnswer();
    var focusEl = document.getElementById('answer');
    if (focusEl) focusEl.focus();
    el.msg.innerHTML = '<span class="ok">その量で合っています</span>' +
      '<span class="lead">同じ量の <b>' + M.titIon(unknownSide(p)) +
      '</b> が必要だと決まりました。あとは' +
      (M.titField(p) === 'v' ? '体積' : '濃度') + 'を求めよう。</span>';
  }

  function renderAnswer() {
    var p = problem();
    var un = unknownSide(p), sd = p[un];
    el.answerArea.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'ansRow';
    row.innerHTML = '<span class="ansLabel">' + formula(sd.sub) + '水溶液の' +
      (M.titField(p) === 'v' ? '体積' : '濃度') + ' ＝ </span>';

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
    row.appendChild(inp);

    var u = document.createElement('span');
    u.className = 'ansUnit';
    u.textContent = ansUnit(p);
    row.appendChild(u);
    el.answerArea.appendChild(row);
  }

  function setProblem(i) {
    state.idx = i;
    state.equiv = ''; state.equivLocked = false;
    state.input = '';
    var p = problem();
    el.qTitle.innerHTML = '問' + (i + 1) + '　' + p.title +
      '<span class="sig">有効数字' + p.sig + '桁で答えよ</span>';
    el.qHint.innerHTML = '💡 ' + p.hint;
    el.nextBtn.hidden = true;
    renderNav();
    renderBlocks();
    renderEquivRow();
    renderAnswer();
    el.msg.innerHTML = '<span class="lead">' + (needEquiv(p)
      ? 'まず、量が分かっている側が出せる <b>' + M.titIon(knownSide(p)) +
        ' の物質量</b>を求めよう。'
      : '左右のブロックが同じ長さになる' +
        (M.titField(p) === 'v' ? '体積' : '濃度') + 'を求めよう。') + '</span>';
  }

  function check() {
    var p = problem();
    el.msg.innerHTML = '';

    if (needEquiv(p) && !state.equivLocked) {
      var kn = knownSide(p), sd = p[kn];
      el.msg.innerHTML = '<span class="ng">' + M.titIon(kn) +
        ' の物質量がまだ合っていません</span>' +
        '<span class="why">物質量は <b>濃度 × 体積</b>。体積は mL なので <b>1000 で割る</b>。' +
        'さらに1粒から ' + M.titIon(kn) + ' が ' + sd.n + ' 個出るので <b>' + sd.n +
        ' 倍</b>します。' + M.disp(sd.c) + ' × ' + M.disp(sd.v) + '/1000 × ' + sd.n +
        ' を計算しよう。</span>';
      return;
    }
    if (state.input.trim() === '') {
      el.msg.innerHTML = '<span class="ng">数を入れてみよう</span>';
      return;
    }

    var g = M.gradeTitration(p, state.input);

    if (g.status === 'ok') {
      state.solved[p.id] = true;
      renderNav();
      renderBlocks();
      el.msg.innerHTML = '<span class="ok">正解！　H⁺ と OH⁻ がちょうど同じ数</span>' +
        '<span class="work">' + explain(p) + '</span>';
      el.nextBtn.hidden = (state.idx >= T.length - 1);
      return;
    }

    if (g.status === 'valence') {
      var big = p.acid.n > 1 ? 'acid' : 'base';
      el.msg.innerHTML = '<span class="ng">価数を数えていません</span>' +
        '<span class="why">' + M.plainLabel(formula(p[big].sub)) + ' は1粒から ' +
        M.titIon(big) + ' を <b>' + p[big].n + ' 個</b>出します。' +
        '数えるのは<b>粒の数ではなく ' + M.titIon(big) + ' の数</b>なので、' +
        '物質量に <b>' + p[big].n + '</b> をかけます。</span>';
      return;
    }

    if (g.status === 'unit') {
      el.msg.innerHTML = '<span class="ng">mL と L を直し忘れています</span>' +
        '<span class="why">濃度は <b>mol/L</b> なので、体積は <b>L</b> にそろえます' +
        '（mL は 1000 で割る）。1000 倍・1000 分の1 だけずれています。</span>';
      return;
    }

    if (g.status === 'sigfig') {
      el.msg.innerHTML = '<span class="ng">値は合っています。書き方を直そう</span>' +
        '<span class="why">この問題は<b>有効数字' + g.need + '桁</b>で答えます。' +
        '<b>' + M.disp(p.ansDisp) + '</b> と書きます' +
        (g.got ? '（いまの答えは' + g.got + '桁）' : '') + '。</span>';
      return;
    }

    el.msg.innerHTML = '<span class="ng">ちがうみたい</span>' +
      '<span class="why">つり合う量は <b>' + M.stoichDisp(M.titBalance(p), p.sig) +
      ' mol</b>。' + M.plainLabel(formula(p[unknownSide(p)].sub)) + ' はこれを出すのに' +
      (M.titField(p) === 'v' ? '何 mL 必要か' : 'どれだけ濃ければよいか') +
      'を考えよう。</span>';
  }

  // 解説。つり合い → 未知側の物質量 → 答え → 最後にまとめの公式
  function explain(p) {
    var kn = knownSide(p), un = unknownSide(p);
    var ks = p[kn], us = p[un];
    var eq = M.titBalance(p);
    var amt = eq / us.n;
    var lines = [];

    lines.push(M.plainLabel(formula(ks.sub)) + ' が出す ' + M.titIon(kn) + ' は ' +
      M.disp(ks.c) + ' × ' + M.disp(ks.v) + '/1000 × ' + ks.n + ' ＝ <b>' +
      M.stoichDisp(eq, p.sig) + ' mol</b>。');
    lines.push('つり合うので ' + M.titIon(un) + ' も <b>' + M.stoichDisp(eq, p.sig) +
      ' mol</b> 必要。');
    lines.push(M.plainLabel(formula(us.sub)) + ' は1粒から ' + us.n + ' 個出すので、' +
      '物質量は ' + M.stoichDisp(eq, p.sig) + ' ÷ ' + us.n + ' ＝ <b>' +
      M.stoichDisp(amt, p.sig) + ' mol</b>。');
    if (M.titField(p) === 'v') {
      var litre = amt / M.val(us.c);
      lines.push('濃度 ' + M.disp(us.c) + ' mol/L なので、体積は ' +
        M.stoichDisp(amt, p.sig) + ' ÷ ' + M.disp(us.c) + ' ＝ ' +
        M.stoichDisp(litre, p.sig) + ' L ＝ <b>' + M.disp(p.ansDisp) + ' mL</b>。');
    } else {
      var vl = M.val(us.v) / 1000;
      lines.push('体積 ' + M.disp(us.v) + ' mL ＝ ' + M.stoichDisp(vl, p.sig) +
        ' L なので、濃度は ' + M.stoichDisp(amt, p.sig) + ' ÷ ' + M.stoichDisp(vl, p.sig) +
        ' ＝ <b>' + M.disp(p.ansDisp) + ' mol/L</b>。');
    }
    // まとめの公式は最後に置く（先に出すと代入作業になる）
    lines.push('<span class="alt">まとめると <b>c₁V₁n₁ ＝ c₂V₂n₂</b>' +
      '（酸の H⁺ ＝ 塩基の OH⁻）。上でやったことをそのまま式にしただけ</span>');
    return lines.join('<br>');
  }

  el.checkBtn.onclick = check;
  el.nextBtn.onclick = function () {
    if (state.idx < T.length - 1) setProblem(state.idx + 1);
  };

  setProblem(0);

  // テスト・デバッグ用
  window.ChemTitrationApp = {
    state: state,
    setProblem: setProblem,
    typeEquiv: function (v) {
      state.equiv = String(v);
      var inp = document.getElementById('equivIn');
      if (inp) inp.value = state.equiv;
      tryLockEquiv();
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
