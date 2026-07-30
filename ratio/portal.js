// 比例式でみる化学計算 — 入口（モード選択）
// 5モードに増えて「自分に必要なものが分からない」状態になったので、
// /ratio/ を教科書の**単元**で並べた入口にした。
// **問題数はモデルから数える**（手書きすると増減のたびにズレる）。
// 課程（化学基礎／化学）はラベルとして出すだけ。絞り込みは課程フィルタで別途やる。
(function () {
  'use strict';

  var M = window.ChemRatio;

  // 単元 → モード。course は 'basic'（化学基礎）/ 'adv'（化学）
  var UNITS = [
    {
      unit: '物質量（mol）と濃度',
      modes: [
        { href: 'proportion.html', icon: '⚖️', name: '比例式で解く mol 計算',
          rule: '倍率が同じ',
          what: '質量・体積・粒子の数・mol を行き来する。<b>すべての計算の土台</b>',
          count: function () { return M.PROBLEMS.length; }, course: 'basic' },
        { href: 'balance.html', icon: '♎', name: '天秤でみる平均',
          rule: '腕の長さの比 ＝ 個数の逆比',
          what: '平均原子量・平均分子量を<b>数直線と支点</b>で見る',
          count: function () { return M.BALANCE.length; }, course: 'basic' }
      ]
    },
    {
      unit: '化学反応の量的関係',
      modes: [
        { href: 'stoich.html', icon: '🧮', name: '反応の量的関係',
          rule: '変化量 ＝ 係数 × 倍率',
          what: '3行表で解く。<b>過不足</b>は「もし使い切るなら？」で納得する',
          count: function () { return M.REACTIONS.length; }, course: 'basic' }
      ]
    },
    {
      unit: '酸と塩基・中和',
      modes: [
        { href: 'titration.html', icon: '🧪', name: '中和滴定',
          rule: 'H⁺ の数 ＝ OH⁻ の数',
          what: '公式を暗記せず、<b>ブロックのつり合い</b>で立式する',
          count: function () { return M.TITRATIONS.length; }, course: 'basic' }
      ]
    },
    {
      unit: '化学反応とエネルギー',
      modes: [
        { href: 'thermo.html', icon: '📈', name: 'エネルギーでみる熱化学',
          rule: 'どの経路でも高さの差は同じ',
          what: 'エネルギー図の<b>高さ</b>を読む。ヘスの法則・結合エネルギー',
          count: function () { return M.THERMO.length; }, course: 'adv' }
      ]
    }
  ];

  var COURSE = {
    basic: { label: '化学基礎', cls: 'basic' },
    adv:   { label: '化学',     cls: 'adv' }
  };

  function render() {
    var host = document.getElementById('units');
    host.innerHTML = UNITS.map(function (u) {
      var cards = u.modes.map(function (m) {
        var c = COURSE[m.course];
        return '<a class="modeCard" href="' + m.href + '">' +
          '<span class="cardIcon" aria-hidden="true">' + m.icon + '</span>' +
          '<span class="cardBody">' +
            '<span class="cardName">' + m.name +
              '<span class="cardCourse ' + c.cls + '">' + c.label + '</span></span>' +
            '<span class="cardRule">' + m.rule + '</span>' +
            '<span class="cardWhat">' + m.what + '</span>' +
          '</span>' +
          '<span class="cardCount">' + m.count() + '<small>問</small></span>' +
          '</a>';
      }).join('');
      return '<section class="unitBlock"><h2 class="unitName">' + u.unit + '</h2>' +
             cards + '</section>';
    }).join('');
  }

  // テスト・デバッグ用（**render の前に公開する**。カードの生成で例外が出ても
  // 「入口が読み込めていない」ことが分かるようにしておく）
  window.ChemRatioPortal = {
    UNITS: UNITS,
    // 入口に並べたリンク先（全モードが載っているかの検査に使う）
    hrefs: function () {
      return UNITS.reduce(function (acc, u) {
        return acc.concat(u.modes.map(function (m) { return m.href; }));
      }, []);
    }
  };

  render();
})();
