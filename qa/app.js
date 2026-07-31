
/**
 * 学習の手ごたえを GA4 へ送る（SNS_PLAN.md の北極星「SNS経由の週間アクティブ利用」）。
 * 送るのは行為の種類だけで、**個人を特定する情報は一切送らない**（privacy.html の記載どおり）。
 * gtag が無い環境（回帰テスト・file:// 直開き）では何もしない。
 */
function slTrack(name, params) {
    try {
        if (window.gtag) window.gtag('event', name, params || {});
    } catch (e) { /* 計測の失敗でアプリを止めない */ }
}
/* 一問一答（化学レンズ） — 知識項目ベースの二面構成エンジン
 * mode=flip   : めくり式（暗記・自己採点 ○×）
 * mode=choice : 複数選択（測定・客観採点。correct集合と完全一致で正解＝勘で当たらない）
 * 進捗は知識項目(pattern)単位で localStorage に保存（暗記/測定で共有）。
 * DOM非依存の純ロジックは極力分離。座標変換等は無し（テキストUIのみ）。
 */
(function () {
  'use strict';

  var STORE_KEY = 'slz-qa-v1';
  var DAILY_N = 10;
  var MAX_BOX = 5;

  var DATA = null;
  var progress = loadProgress();
  var session = null; // { unitId, mode, scope, queue:[{pattern,variant}], idx, right, wrong }

  var $ = function (id) { return document.getElementById(id); };

  // ---------- 進捗の保存 ----------
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {}
  }
  function rec(pid) {
    if (!progress[pid]) progress[pid] = { box: 0, right: 0, wrong: 0, seen: 0, last: 0 };
    return progress[pid];
  }
  function markResult(pid, ok) {
    var r = rec(pid);
    r.seen++;
    r.last = Date.now();
    if (ok) { r.right++; r.box = Math.min(MAX_BOX, r.box + 1); }
    else { r.wrong++; r.box = 1; }
    saveProgress();
  }

  // ---------- ユーティリティ ----------
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function patternsOf(unitId) {
    return DATA.patterns.filter(function (p) { return p.unit === unitId; });
  }
  function pickVariant(pattern, mode) {
    var vs = pattern.variants.filter(function (v) { return v.mode === mode; });
    if (!vs.length) vs = pattern.variants;
    return vs[Math.floor(Math.random() * vs.length)];
  }
  function show(viewId) {
    ['view-home', 'view-study', 'view-result'].forEach(function (v) {
      $(v).classList.toggle('hidden', v !== viewId);
    });
    window.scrollTo(0, 0);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- ホーム ----------
  function renderHome() {
    var host = $('unit-list');
    host.innerHTML = '';
    DATA.units.forEach(function (u) {
      var ps = patternsOf(u.id);
      var total = ps.length;
      var mastered = ps.filter(function (p) { return rec(p.code).box >= 4; }).length;
      var started = ps.filter(function (p) { return rec(p.code).seen > 0; }).length;
      var pct = total ? Math.round((mastered / total) * 100) : 0;

      var el = document.createElement('div');
      el.className = 'unit';
      el.innerHTML =
        '<h2>' + esc(u.name) + '</h2>' +
        '<p class="u-sum">' + esc(u.summary || '') + '</p>' +
        '<div class="meter"><span style="width:' + pct + '%"></span></div>' +
        '<div class="u-stat">' +
          '<span>知識項目 <b>' + total + '</b></span>' +
          '<span>着手 <b>' + started + '</b></span>' +
          '<span>定着 <b>' + mastered + '</b></span>' +
        '</div>' +
        '<div class="u-actions">' +
          '<button class="btn primary" data-unit="' + u.id + '" data-mode="flip">暗記モード（めくり）</button>' +
          '<button class="btn ghost" data-unit="' + u.id + '" data-mode="choice">測定モード（複数選択）</button>' +
        '</div>';
      host.appendChild(el);
    });

    Array.prototype.forEach.call(host.querySelectorAll('button[data-unit]'), function (b) {
      b.addEventListener('click', function () {
        startSession(b.getAttribute('data-unit'), b.getAttribute('data-mode'), 'daily');
      });
    });
  }

  // ---------- セッション ----------
  function startSession(unitId, mode, scope) {
    var ps = patternsOf(unitId);
    // 出題順：定着度(box)の低いもの・久しく見ていないものを優先（簡易間隔反復）
    ps.sort(function (a, b) {
      var ra = rec(a.code), rb = rec(b.code);
      if (ra.box !== rb.box) return ra.box - rb.box;
      return ra.last - rb.last;
    });
    if (scope === 'daily') ps = ps.slice(0, Math.min(DAILY_N, ps.length));

    var queue = ps.map(function (p) { return { pattern: p, variant: pickVariant(p, mode) }; });
    // 同 box 帯のなかでの並びは軽くシャッフル
    queue = shuffle(queue);

    session = { unitId: unitId, mode: mode, scope: scope, queue: queue, idx: 0, right: 0, wrong: 0 };
    show('view-study');
    renderStudy();
  }

  function renderStudy() {
    var s = session;
    if (s.idx >= s.queue.length) { renderResult(); return; }
    var item = s.queue[s.idx];
    $('q-of').textContent = (s.idx + 1) + ' / ' + s.queue.length;
    $('pbar-fill').style.width = Math.round((s.idx / s.queue.length) * 100) + '%';

    if (s.mode === 'flip') renderFlip(item);
    else renderChoice(item);
  }

  var DIFF_NAMES = { 1: '生存', 2: '標準', 3: '受験標準', 4: '難関' };
  function chipsHtml(pattern, variant) {
    var d = pattern.difficulty || 1;
    var chips = '<span class="chip d' + d + '">Lv' + d + '・' + (DIFF_NAMES[d] || '') + '</span>';
    if (pattern.group) chips += '<span class="chip">' + esc(pattern.group) + '</span>';
    (pattern.tags || []).filter(function (t) { return t !== pattern.group; }).slice(0, 3)
      .forEach(function (t) { chips += '<span class="chip">' + esc(t) + '</span>'; });
    return '<div class="chips">' + chips + '</div>';
  }
  // 飛び道具リンク（一問一答 → assembler、共有コードで双方向。前方互換のクエリ規約）
  function linkHtml(pattern) {
    if (!pattern.link) return '';
    var url = '../assembler/?from=qa&code=' + encodeURIComponent(pattern.code);
    if (pattern.link.build) url += '&build=' + encodeURIComponent(pattern.link.build);
    if (pattern.link.reagent) url += '&reagent=' + encodeURIComponent(pattern.link.reagent);
    return '<a class="a-link" href="' + esc(url) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      esc(pattern.link.label) + '</a>';
  }

  // ---- 暗記モード（めくり） ----
  function renderFlip(item) {
    var p = item.pattern, v = item.variant;
    var host = $('card-host');
    host.innerHTML =
      '<div class="card">' +
        chipsHtml(p, v) +
        '<p class="q-text">' + esc(v.q) + '</p>' +
        '<div id="flip-area">' +
          '<button class="btn primary" id="btn-reveal" style="margin-top:22px">答えを見る</button>' +
        '</div>' +
      '</div>';

    $('btn-reveal').addEventListener('click', function () {
      var fa = $('flip-area');
      fa.innerHTML =
        '<div class="answer">' +
          '<div class="a-label">こたえ</div>' +
          '<p class="a-text">' + esc(v.a) + '</p>' +
          (v.supplement ? '<p class="a-supp">' + esc(v.supplement) + '</p>' : '') +
          linkHtml(p) +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn again" id="btn-again-q">✗ あやしい</button>' +
          '<button class="btn good" id="btn-good-q">✓ わかった</button>' +
        '</div>';
      $('btn-good-q').addEventListener('click', function () { advance(p.code, true); });
      $('btn-again-q').addEventListener('click', function () { advance(p.code, false); });
    });
  }

  // ---- 測定モード（複数選択） ----
  function renderChoice(item) {
    var p = item.pattern, v = item.variant;
    var host = $('card-host');
    // 選択肢の表示順をランダム化（正解の位置の偏り・位置の丸暗記を防ぐ）。
    // value/data-i は元インデックスのまま持たせるので、採点ロジックは表示順に依存しない。
    var order = shuffle(v.options.map(function (_o, i) { return i; }));
    var opts = order.map(function (i) {
      return '<label class="opt" data-i="' + i + '">' +
        '<input type="checkbox" value="' + i + '"><span>' + esc(v.options[i]) + '</span></label>';
    }).join('');
    host.innerHTML =
      '<div class="card">' +
        chipsHtml(p, v) +
        '<p class="q-text">' + esc(v.q) + '</p>' +
        '<div class="opts" id="opts">' + opts + '</div>' +
        '<div id="choice-foot"><button class="btn primary" id="btn-grade" style="margin-top:18px" disabled>採点する</button></div>' +
      '</div>';

    var boxes = host.querySelectorAll('input[type=checkbox]');
    Array.prototype.forEach.call(boxes, function (b) {
      b.addEventListener('change', function () {
        var any = Array.prototype.some.call(boxes, function (x) { return x.checked; });
        $('btn-grade').disabled = !any;
      });
    });

    $('btn-grade').addEventListener('click', function () {
      gradeChoice(p, v, boxes);
    });
  }

  function gradeChoice(p, v, boxes) {
    var chosen = [];
    Array.prototype.forEach.call(boxes, function (b) { if (b.checked) chosen.push(+b.value); });
    var correct = v.correct.slice().sort(function (a, b) { return a - b; });
    var got = chosen.slice().sort(function (a, b) { return a - b; });
    var ok = correct.length === got.length && correct.every(function (x, i) { return x === got[i]; });
    slTrack('quiz_answer', { app: 'qa', quiz: 'choice', correct: ok });

    // 選択肢に正誤マークを付け、以後は操作不可に
    var labels = $('opts').querySelectorAll('.opt');
    Array.prototype.forEach.call(labels, function (lab) {
      var i = +lab.getAttribute('data-i');
      var isCorrect = v.correct.indexOf(i) !== -1;
      var isChosen = chosen.indexOf(i) !== -1;
      lab.classList.add('locked');
      if (isCorrect) lab.classList.add('is-correct');
      if (isChosen && !isCorrect) lab.classList.add('is-wrong');
      if (isCorrect && !isChosen) lab.classList.add('is-missed');
      var input = lab.querySelector('input'); if (input) input.disabled = true;
    });

    $('choice-foot').innerHTML =
      '<div class="answer">' +
        '<div class="a-label">' + (ok ? '正解' : '不正解') + '</div>' +
        '<p class="a-text" style="color:' + (ok ? 'var(--yuki)' : 'var(--bad)') + '">' +
          (ok ? 'すべて正しく選べました' : '正しい選択と一致しませんでした') + '</p>' +
        (v.supplement ? '<p class="a-supp">' + esc(v.supplement) + '</p>' : '') +
        linkHtml(p) +
      '</div>' +
      '<div class="actions"><button class="btn primary" id="btn-next" style="flex:1">つぎへ</button></div>';
    $('btn-next').addEventListener('click', function () { advance(p.code, ok); });
  }

  function advance(pid, ok) {
    markResult(pid, ok);
    if (ok) session.right++; else session.wrong++;
    session.idx++;
    renderStudy();
  }

  // ---------- 結果 ----------
  function renderResult() {
    var s = session;
    show('view-result');
    $('pbar-fill').style.width = '100%';
    $('score-ok').textContent = s.right;
    $('score-ng').textContent = s.wrong;
    if (s.mode === 'choice') {
      $('score-ok-label').textContent = '正解';
      $('score-ng-label').textContent = '不正解';
      $('result-sub').textContent = '測定モード — ' + s.right + ' / ' + s.queue.length + ' 項目に正解';
    } else {
      $('score-ok-label').textContent = 'わかった';
      $('score-ng-label').textContent = 'あやしい';
      $('result-sub').textContent = '暗記モード — ' + s.queue.length + ' 項目を復習';
    }
  }

  // ---------- 起動 ----------
  $('btn-quit').addEventListener('click', function () { renderHome(); show('view-home'); });
  $('btn-home').addEventListener('click', function () { renderHome(); show('view-home'); });
  $('btn-again').addEventListener('click', function () {
    startSession(session.unitId, session.mode, session.scope);
  });

  // 報告ボタン（report.js）へ渡す文脈：いま表示中の問題コードを自動取得
  window.__reportContext = function () {
    var locus = '(単元一覧)';
    var studyVisible = !$('view-study').classList.contains('hidden');
    var resultVisible = !$('view-result').classList.contains('hidden');
    if (studyVisible && session && session.queue[session.idx]) {
      var it = session.queue[session.idx];
      locus = it.pattern.code + '（' + it.variant.mode + '）';
    } else if (resultVisible) {
      locus = '(結果画面)';
    }
    return { page: '一問一答 (qa)', locus: locus, version: 'v1' };
  };

  fetch('questions.json?v=3')
    .then(function (r) { if (!r.ok) throw new Error('load failed: ' + r.status); return r.json(); })
    .then(function (json) { DATA = json; renderHome(); })
    .catch(function (err) {
      $('unit-list').innerHTML = '<div class="unit"><h2>読み込みに失敗しました</h2><p class="u-sum">' +
        esc(err.message) + '</p></div>';
    });
})();
