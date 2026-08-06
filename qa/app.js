
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
    ['view-home', 'view-map', 'view-study', 'view-result'].forEach(function (v) {
      $(v).classList.toggle('hidden', v !== viewId);
    });
    window.scrollTo(0, 0);
  }

  // 定着とみなす box 値。**ホームの単元カードと習得マップで同じ基準を使う**
  // （別々に書くと「単元カードでは定着なのにマップでは学習中」というずれが出る）。
  //
  // ⚠ TAXONOMY §4 は「定着の認定は測定モード(choice)での正解で行う」を本則としているが、
  // エンジンは flip/choice を区別せず box だけで判定している（mode 別記録は未実装）。
  // マップにその旨を明記して、実態より進んで見せないようにしている。
  var MASTER_BOX = 4;
  function stateOf(code) {
    var r = rec(code);
    if (r.seen === 0) return 'new';
    return r.box >= MASTER_BOX ? 'done' : 'wip';
  }
  var STATE_NAME = { new: '未着手', wip: '学習中', done: '定着' };
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
      var mastered = ps.filter(function (p) { return stateOf(p.code) === 'done'; }).length;
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

  // ---------- 習得マップ（単元 × 難易度） ----------
  // TAXONOMY §4: 網羅（存在する項目）と習得（できた項目）を**同時に**見せる。
  // 単元カードの進捗バーは「定着率」しか出せないので、
  // 「どの難易度帯が手つかずか」が見えない。それを埋めるのがこの画面。
  var mapSel = null;   // 選択中のマス { unitId, lv }

  function bucket(unitId, lv) {
    return patternsOf(unitId).filter(function (p) { return (p.difficulty || 1) === lv; });
  }

  function tallyHtml(ps) {
    var n = { new: 0, wip: 0, done: 0 };
    ps.forEach(function (p) { n[stateOf(p.code)]++; });
    // 幅は件数比。0件の帯は出さない（1px の線が残ると読み違える）
    var seg = ['done', 'wip', 'new'].filter(function (k) { return n[k]; }).map(function (k) {
      return '<span class="sg ' + k + '" style="flex:' + n[k] + '"></span>';
    }).join('');
    return { html: '<div class="stack">' + seg + '</div>', n: n };
  }

  function renderMap() {
    var host = $('map-host');
    var all = DATA.patterns;
    var t = tallyHtml(all);

    var html = '<div class="map-sum">' +
      '<h2>習得マップ</h2>' +
      '<p class="sub">縦が単元、横が難易度。マスの点1つが知識項目1つ。' +
      '<b>色が付いていない点</b>がまだ触っていない知識。</p>' +
      t.html +
      '<div class="legend">' +
        '<span><i class="dot done"></i>定着 <b>' + t.n.done + '</b></span>' +
        '<span><i class="dot wip"></i>学習中 <b>' + t.n.wip + '</b></span>' +
        '<span><i class="dot new"></i>未着手 <b>' + t.n.new + '</b></span>' +
        '<span class="tot">全 <b>' + all.length + '</b> 項目</span>' +
      '</div></div>';

    // グリッド本体。横に4列あるので、狭い画面では内側だけ横スクロールさせる
    html += '<div class="map-scroll"><div class="grid">';
    html += '<div class="gh"></div>';
    [1, 2, 3, 4].forEach(function (lv) {
      html += '<div class="gh lv' + lv + '">Lv' + lv + '<span>' + DIFF_NAMES[lv] + '</span></div>';
    });
    DATA.units.forEach(function (u) {
      html += '<div class="gr">' + esc(u.name) + '</div>';
      [1, 2, 3, 4].forEach(function (lv) {
        var ps = bucket(u.id, lv);
        if (!ps.length) {
          html += '<div class="gc empty" aria-hidden="true"></div>';
          return;
        }
        var sel = mapSel && mapSel.unitId === u.id && mapSel.lv === lv;
        var dots = ps.map(function (p) {
          return '<i class="dot ' + stateOf(p.code) + '"></i>';
        }).join('');
        html += '<button class="gc' + (sel ? ' is-sel' : '') + '"' +
          ' data-unit="' + u.id + '" data-lv="' + lv + '"' +
          ' aria-label="' + esc(u.name) + ' Lv' + lv + '・' + ps.length + '項目">' +
          '<span class="dots">' + dots + '</span>' +
          '<span class="gc-n">' + ps.length + '</span></button>';
      });
    });
    html += '</div></div>';

    html += '<p class="map-note">定着は「同じ項目に続けて正解した回数」で判定している。' +
      '<b>暗記モードの自己採点も数えている</b>ので、厳密な到達度は測定モードで確かめてほしい。</p>';

    html += '<div id="map-detail"></div>';
    host.innerHTML = html;

    Array.prototype.forEach.call(host.querySelectorAll('.gc[data-unit]'), function (b) {
      b.addEventListener('click', function () {
        var uid = b.getAttribute('data-unit'), lv = Number(b.getAttribute('data-lv'));
        // 同じマスを押したら閉じる（開いたままだと、どこを見ているか分からなくなる）
        mapSel = (mapSel && mapSel.unitId === uid && mapSel.lv === lv) ? null : { unitId: uid, lv: lv };
        renderMap();
        if (mapSel) $('map-detail').scrollIntoView({ block: 'nearest' });
      });
    });

    if (mapSel) renderMapDetail();
  }

  function renderMapDetail() {
    var u = DATA.units.filter(function (x) { return x.id === mapSel.unitId; })[0];
    var ps = bucket(mapSel.unitId, mapSel.lv);
    var t = tallyHtml(ps);

    var rows = ps.map(function (p) {
      var st = stateOf(p.code);
      return '<li class="mi ' + st + '"><i class="dot ' + st + '"></i>' +
        '<span class="mi-k">' + esc(p.knowledge || p.code) + '</span>' +
        '<span class="mi-s">' + STATE_NAME[st] + '</span></li>';
    }).join('');

    $('map-detail').innerHTML = '<div class="detail">' +
      '<h3>' + esc(u.name) + '<span class="chip d' + mapSel.lv + '">Lv' + mapSel.lv +
        '・' + DIFF_NAMES[mapSel.lv] + '</span></h3>' +
      '<p class="sub">' + ps.length + ' 項目 — 定着 ' + t.n.done +
        ' / 学習中 ' + t.n.wip + ' / 未着手 ' + t.n.new + '</p>' +
      '<div class="u-actions">' +
        '<button class="btn primary" id="btn-map-flip">この帯を暗記する</button>' +
        '<button class="btn ghost" id="btn-map-choice">この帯を測定する</button>' +
      '</div>' +
      '<ul class="mi-list">' + rows + '</ul>' +
      '</div>';

    // この帯だけを出題する（scope='lv'）。単元まるごとより狭いので、
    // 「Lv3 だけ詰める」のような使い方ができる
    $('btn-map-flip').addEventListener('click', function () {
      startSession(mapSel.unitId, 'flip', 'lv', mapSel.lv);
    });
    $('btn-map-choice').addEventListener('click', function () {
      startSession(mapSel.unitId, 'choice', 'lv', mapSel.lv);
    });
  }

  // ---------- セッション ----------
  // 出題の優先度。小さいほど先に出す。
  // 誤答した項目は box=1 に落ちるが、未着手は box=0 なので、box をそのまま順位に使うと
  // 「間違えた項目が、まだ一度も見ていない全項目より後回し」になってしまう。
  // 項目数の多い単元（脂肪族66項目）では次の10問に入らず、復習が数十項目ぶん遅れる。
  // 間違えたものをすぐ繰り返すのが間隔反復の要なので、誤答経験のある項目を最優先にする。
  function priority(r) {
    if (r.seen > 0 && r.box <= 1) return -1;   // 直近で間違えた項目
    return r.box;                               // 0=未着手 → 定着度の低い順
  }

  // scope: 'daily'（先頭10問）/ 'lv'（習得マップのマス1つ＝難易度を絞って全部）/ その他（単元まるごと）
  function startSession(unitId, mode, scope, lv) {
    // 先に混ぜてから並べ替える。同じ優先度・同じ最終出題時刻（未着手は last=0 で全部同じ）の
    // 項目がデータの並び順で固定されると、毎回おなじ先頭10問ばかり出てしまうため。
    var ps = shuffle(patternsOf(unitId));
    if (scope === 'lv') ps = ps.filter(function (p) { return (p.difficulty || 1) === lv; });
    ps.sort(function (a, b) {
      var ra = rec(a.code), rb = rec(b.code);
      var pa = priority(ra), pb = priority(rb);
      if (pa !== pb) return pa - pb;
      return ra.last - rb.last;   // 同順位なら久しく見ていないものから
    });
    if (scope === 'daily') ps = ps.slice(0, Math.min(DAILY_N, ps.length));

    var queue = ps.map(function (p) { return { pattern: p, variant: pickVariant(p, mode) }; });
    // 同 box 帯のなかでの並びは軽くシャッフル
    queue = shuffle(queue);

    session = { unitId: unitId, mode: mode, scope: scope, lv: lv, queue: queue, idx: 0, right: 0, wrong: 0 };
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
  //
  // **kind によって渡すものが変わる**（DESIGN_assembler_bridge.md §3）。
  // link は data/assembler_links.jsonl から qa/tools/gen_links.js が生成しており、
  // ここに来るのは「今すぐ繋がる」と判定されたものだけ。
  // 未知のパラメータは assembler 側が無視するので、受け口が後から出来ても壊れない
  // `?summon=` に渡すもの。**ID があれば ID**（不変なので相手が表示名を直しても死なない）、
  // 無ければ生成時にライブラリの表記へ解決済みの名前。
  // `stages.json` 由来の19種だけがまだ ID を持たない（2026-08-06）。
  // assembler は id と名称のどちらも受けるので、混在していても問題ない
  function summonKey(link) { return link.summon || link.name; }

  function linkQuery(link) {
    switch (link.kind) {
      case 'summon':    return { open: 'free', summon: summonKey(link) };
      case 'reaction':  return { open: 'free', summon: summonKey(link), reagent: link.reagent };
      case 'mechanism': return { open: 'mechanism', id: link.id };
      case 'practice':  return { open: link.open };
      case 'isomer':    return { open: 'isomer', formula: link.formula };
    }
    return {};
  }
  function linkHtml(pattern) {
    if (!pattern.link || pattern.link.kind === 'none') return '';
    var url = '../assembler/?from=qa&code=' + encodeURIComponent(pattern.code);
    var q = linkQuery(pattern.link);
    Object.keys(q).forEach(function (k) {
      if (q[k]) url += '&' + k + '=' + encodeURIComponent(q[k]);
    });
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
  // 演習から戻る先は「来た道」。習得マップのマスから始めた回はマップへ返す
  // （単元一覧へ飛ばすと、いま埋めていた帯を見失う）
  function goBack() {
    if (session && session.scope === 'lv') { renderMap(); show('view-map'); return; }
    renderHome(); show('view-home');
  }
  $('btn-quit').addEventListener('click', goBack);
  $('btn-home').addEventListener('click', goBack);
  $('btn-again').addEventListener('click', function () {
    startSession(session.unitId, session.mode, session.scope, session.lv);
  });
  $('btn-map').addEventListener('click', function () { renderMap(); show('view-map'); });
  $('btn-map-back').addEventListener('click', function () { renderHome(); show('view-home'); });

  // 報告ボタン（report.js）へ渡す文脈：いま表示中の問題コードを自動取得
  window.__reportContext = function () {
    var locus = '(単元一覧)';
    var studyVisible = !$('view-study').classList.contains('hidden');
    var resultVisible = !$('view-result').classList.contains('hidden');
    var mapVisible = !$('view-map').classList.contains('hidden');
    if (studyVisible && session && session.queue[session.idx]) {
      var it = session.queue[session.idx];
      locus = it.pattern.code + '（' + it.variant.mode + '）';
    } else if (resultVisible) {
      locus = '(結果画面)';
    } else if (mapVisible) {
      locus = mapSel ? '(習得マップ ' + mapSel.unitId + ' Lv' + mapSel.lv + ')' : '(習得マップ)';
    }
    // 版はヘッダー表示から読む（固定値だと、どの版への報告か判別できない）
    var vEl = document.querySelector('.version');
    return {
      page: '一問一答 (qa)',
      locus: locus,
      version: (vEl && vEl.textContent.trim()) || '(不明)'
    };
  };

  // テスト用の露出（qa/tests.js が出題順の規則を検査する）。UI からは使わない。
  window.QaEngine = { priority: priority };

  fetch('questions.json?v=38')
    .then(function (r) { if (!r.ok) throw new Error('load failed: ' + r.status); return r.json(); })
    .then(function (json) { DATA = json; renderHome(); })
    .catch(function (err) {
      $('unit-list').innerHTML = '<div class="unit"><h2>読み込みに失敗しました</h2><p class="u-sum">' +
        esc(err.message) + '</p></div>';
    });
})();
