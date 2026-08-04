// 比例式でみる化学計算 — 入口（モード選択）
// 5モードに増えて「自分に必要なものが分からない」状態になったので、
// /ratio/ を教科書の**単元**で並べた入口にした。
// **問題数はモデルから数える**（手書きすると増減のたびにズレる）。
//
// 課程（化学基礎／化学）は v19 では札（表示）だけだったが、v30 で**絞り込み**に格上げした。
// - **アプリは分割しない。見え方だけ分ける**（モードもページも増やさない）
// - 課程の所属は**この UNITS の `course` から引く**。対応表を別に作らない
//   （2か所に持つと必ずずれる。札と絞り込みが同じ1つの値を見ているのが要）
// - **「すべて」を必ず用意する**（絞り込みが外せないと詰む）。知らない値も 'all' に倒す
// - 選んだ課程は progress.js が localStorage に持つ（次に開いたときも同じ見え方）
(function () {
  'use strict';

  var M = window.ChemRatio;

  var P = window.ChemRatioProgress;

  // 単元 → モード。course は 'basic'（化学基礎）/ 'adv'（化学）
  // key は進捗の保存に使うモードid（progress.js の MODES と同じ綴り）
  var UNITS = [
    {
      unit: '物質量（mol）と濃度',
      modes: [
        { href: 'proportion.html', key: 'proportion', icon: '⚖️',
          name: '比例式で解く mol 計算',
          rule: '倍率が同じ',
          what: '質量・体積・粒子の数・mol を行き来する。<b>すべての計算の土台</b>',
          count: function () { return M.PROBLEMS.length; }, course: 'basic' },
        { href: 'balance.html', key: 'balance', icon: '♎',
          name: '天秤でみる平均',
          rule: '腕の長さの比 ＝ 個数の逆比',
          what: '平均原子量・平均分子量を<b>数直線と支点</b>で見る',
          count: function () { return M.BALANCE.length; }, course: 'basic' }
      ]
    },
    {
      unit: '化学反応の量的関係',
      modes: [
        { href: 'stoich.html', key: 'stoich', icon: '🧮',
          name: '反応の量的関係',
          rule: '変化量 ＝ 係数 × 倍率',
          what: '3行表で解く。<b>過不足</b>は「もし使い切るなら？」で納得する',
          count: function () { return M.REACTIONS.length; }, course: 'basic' }
      ]
    },
    {
      unit: '酸と塩基・中和',
      modes: [
        { href: 'titration.html', key: 'titration', icon: '🧪',
          name: '中和滴定',
          rule: 'H⁺ の数 ＝ OH⁻ の数',
          what: '公式を暗記せず、<b>ブロックのつり合い</b>で立式する',
          count: function () { return M.TITRATIONS.length; }, course: 'basic' }
      ]
    },
    {
      unit: '化学反応とエネルギー',
      modes: [
        { href: 'thermo.html', key: 'thermo', icon: '📈',
          name: 'エネルギーでみる熱化学',
          rule: 'どの経路でも高さの差は同じ',
          what: 'エネルギー図の<b>高さ</b>を読む。ヘスの法則・結合エネルギー',
          count: function () { return M.THERMO.length; }, course: 'adv' }
      ]
    }
  ];

  var COURSE = {
    all:   { label: 'すべて',   cls: 'all' },
    basic: { label: '化学基礎', cls: 'basic' },
    adv:   { label: '化学',     cls: 'adv' }
  };
  // 絞り込みの並び。**「すべて」を先頭に置く**（外し方が最初に目に入る）
  var COURSE_ORDER = ['all', 'basic', 'adv'];

  // いま選ばれている課程。localStorage が使えない環境でも**その回のあいだは効く**ように
  // ページ内変数を正にし、保存は「できたらする」に留める（progress.js と同じ流儀）
  var course = P.readCourse();

  function allModes() {
    return UNITS.reduce(function (acc, u) { return acc.concat(u.modes); }, []);
  }

  function inCourse(m, c) { return c === 'all' || m.course === c; }

  function modesOf(c) {
    return allModes().filter(function (m) { return inCourse(m, c); });
  }

  // 課程ごとの集計（「化学基礎の範囲 12/54」）。**分母はモデルから数え、
  // 分子は localStorage から数える**。どちらも手書きしない
  function tally(c) {
    return modesOf(c).reduce(function (t, m) {
      t.done += Object.keys(P.read(m.key)).length;
      t.total += m.count();
      return t;
    }, { done: 0, total: 0 });
  }

  function setCourse(c) {
    if (!COURSE[c]) return;
    course = c;
    P.writeCourse(c);     // 保存できなくても落とさない（上の course が正）
    render();
  }

  function render() {
    renderCourseBar();
    renderUnits();
    renderProgress();
  }

  // 課程でしぼる帯。**札を絞り込みに格上げした本体**。
  // ボタンに課程ごとの進捗を添えているので、選ぶ前から「自分の範囲がどこまで進んだか」が見える
  function renderCourseBar() {
    var host = document.getElementById('courseBar');
    if (!host) return;
    host.innerHTML = '<span class="cbLabel">課程でしぼる</span>' +
      COURSE_ORDER.map(function (c) {
        var t = tally(c);
        return '<button type="button" class="cbBtn ' + COURSE[c].cls + '"' +
          ' data-course="' + c + '"' +
          ' aria-pressed="' + (c === course ? 'true' : 'false') + '">' +
          COURSE[c].label +
          '<small class="cbCount">' + t.done + '/' + t.total + '</small></button>';
      }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.cbBtn'), function (b) {
      b.onclick = function () { setCourse(b.getAttribute('data-course')); };
    });
  }

  function renderUnits() {
    var host = document.getElementById('units');
    host.innerHTML = UNITS.map(function (u) {
      var shown = u.modes.filter(function (m) { return inCourse(m, course); });
      // 中身が消えた単元は見出しごと出さない（空の見出しだけが並ぶのを防ぐ）
      if (!shown.length) return '';
      var cards = shown.map(function (m) {
        var c = COURSE[m.course];
        // クリア済みの数は localStorage から数える（次に来たときに続きが分かる）
        var done = Object.keys(P.read(m.key)).length;
        return '<a class="modeCard" href="' + m.href + '">' +
          '<span class="cardIcon" aria-hidden="true">' + m.icon + '</span>' +
          '<span class="cardBody">' +
            '<span class="cardName">' + m.name +
              '<span class="cardCourse ' + c.cls + '">' + c.label + '</span></span>' +
            '<span class="cardRule">' + m.rule + '</span>' +
            '<span class="cardWhat">' + m.what + '</span>' +
          '</span>' +
          '<span class="cardCount">' + m.count() + '<small>問</small>' +
            (done ? '<small class="cardDone">✓ ' + done + '</small>' : '') +
          '</span>' +
          '</a>';
      }).join('');
      return '<section class="unitBlock"><h2 class="unitName">' + u.unit + '</h2>' +
             cards + '</section>';
    }).join('');

    // **隠したことを黙っていない**。カードが消えたのを不具合と思わせないため、
    // 何をいくつ隠しているかと、戻し方を書く
    var hidden = allModes().length - modesOf(course).length;
    if (hidden) {
      host.innerHTML += '<p class="filterNote">' + COURSE[course].label +
        'の範囲だけを表示しています（' + hidden + 'つのモードを隠しています）。' +
        '<b>すべて</b>を選ぶと全部出ます。</p>';
    }
  }

  // 進捗の合計と、消す手段。**確認は window.confirm を使わず画面内で2段**にする
  // （モーダルは回帰テストの iframe を止めてしまうし、押し間違いも取り返せる）
  //
  // 合計は**いま選んでいる課程の範囲**で出す（絞り込んだのに分母が 60 のままだと
  // 「自分の範囲がどこまで終わったか」が読めない）。
  function renderProgress() {
    var host = document.getElementById('progressBox');
    if (!host) return;
    var t = tally(course);
    var done = t.done, total = t.total;
    var label = course === 'all' ? '解いた問題' : COURSE[course].label + 'の範囲';
    host.innerHTML =
      '<span class="prgText">' + label + ' <b>' + done + '</b> / ' + total + '</span>' +
      // 消す手段の有無は**全モードの合計**で決める（絞り込んだ範囲が 0 のときに
      // リセットが消えると、他の範囲の記録を消す手段がなくなる）
      (P.total() ? '<button type="button" id="prgReset">進捗をリセット</button>' : '') +
      (P.available() ? '' :
        '<span class="prgWarn">この環境では進捗を保存できません（プライベートモード等）</span>');

    var btn = document.getElementById('prgReset');
    if (!btn) return;
    btn.onclick = function () {
      host.innerHTML = '<span class="prgText">全モードの進捗を消します。よろしいですか？</span>' +
        '<button type="button" id="prgYes" class="danger">消す</button>' +
        '<button type="button" id="prgNo">やめる</button>';
      document.getElementById('prgYes').onclick = function () { P.clearAll(); render(); };
      document.getElementById('prgNo').onclick = function () { renderProgress(); };
    };
  }

  // テスト・デバッグ用（**render の前に公開する**。カードの生成で例外が出ても
  // 「入口が読み込めていない」ことが分かるようにしておく）
  window.ChemRatioPortal = {
    UNITS: UNITS,
    render: render,
    // 課程フィルタ（回帰テストが絞り込みを駆動するための入口）。
    // **hrefs / keys は絞り込みの影響を受けない** — 「全モードが載っているか」
    // 「nav.js の一覧と一致するか」の検査は、見え方ではなく持ち物を見るものなので
    setCourse: setCourse,
    course: function () { return course; },
    tally: tally,
    // 入口に並べたリンク先（全モードが載っているかの検査に使う）
    hrefs: function () {
      return allModes().map(function (m) { return m.href; });
    },
    keys: function () {
      return allModes().map(function (m) { return m.key; });
    }
  };

  render();
})();
