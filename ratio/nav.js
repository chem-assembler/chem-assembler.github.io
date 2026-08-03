// 比例式でみる化学計算 — ヘッダーの導線（モード間の行き来）
//
// 各モードのヘッダーは「← モードを選ぶ」1本だけで、別のモードへ移るには
// 毎回入口に戻る必要があった（外部レビュー項目6）。そこでヘッダーに
// **ほかのモードへ直接飛べる切り替え**を足す。
//
// **横に5本並べる案は採らない**。5モードを横に並べるとヘッダーが伸び、
// 375px で高さを食う（レスポンシブ対応＝レビュー項目8 が台無しになる）。
// **閉じている間は高さが増えない `<details>`** にして、開いたときだけ
// ヘッダーの下に重ねて出す（絶対配置なのでレイアウトを押し広げない）。
//
// モードの一覧をここに持つのは、5ページに同じ HTML を書くと必ずずれるため。
// 入口（portal.js）の一覧と食い違わないことは回帰テストで固定する。
(function () {
  'use strict';

  // 入口（portal.js）に載っている5モード。名前も入口のカードと同じにする
  var MODES = [
    { href: 'proportion.html', icon: '⚖️', name: '比例式で解く mol 計算' },
    { href: 'balance.html',    icon: '♎',  name: '天秤でみる平均' },
    { href: 'stoich.html',     icon: '🧮', name: '反応の量的関係' },
    { href: 'titration.html',  icon: '🧪', name: '中和滴定' },
    { href: 'thermo.html',     icon: '📈', name: 'エネルギーでみる熱化学' }
  ];

  function fileName() {
    var m = location.pathname.split('/').pop();
    return m === '' ? 'index.html' : m;
  }

  function build() {
    var header = document.querySelector('header');
    if (!header) return null;
    var here = fileName();
    // 入口（index.html）は、それ自体がモードを選ぶ画面なので出さない
    if (!MODES.some(function (m) { return m.href === here; })) return null;

    var det = document.createElement('details');
    det.className = 'modeJump';

    var sum = document.createElement('summary');
    sum.textContent = 'ほかのモード';
    sum.setAttribute('aria-label', 'ほかのモードへ移る');
    det.appendChild(sum);

    var list = document.createElement('div');
    list.className = 'modeJumpList';
    MODES.forEach(function (m) {
      var a = document.createElement('a');
      a.href = m.href;
      a.innerHTML = '<span class="mjIcon" aria-hidden="true">' + m.icon + '</span>' +
                    '<span class="mjName"></span>';
      a.querySelector('.mjName').textContent = m.name;
      if (m.href === here) a.setAttribute('aria-current', 'page');
      list.appendChild(a);
    });
    det.appendChild(list);
    // 導線は3本まとめて折り返させたい（1本だけ上の行に残るとヘッダーが厚くなる）。
    // 箱があればその中へ、無ければ従来どおりヘッダー直下へ置く
    (header.querySelector('.headLinks') || header).appendChild(det);

    // 外側をタップしたら閉じる（開きっぱなしだと下の問題が押せない）
    document.addEventListener('click', function (e) {
      if (det.open && !det.contains(e.target)) det.open = false;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && det.open) det.open = false;
    });
    return det;
  }

  // テスト・デバッグ用（**build の前に公開する**。組み立てで例外が出ても
  // 「導線が読み込めていない」ことが分かるようにしておく）
  window.ChemRatioNav = {
    MODES: MODES,
    hrefs: function () { return MODES.map(function (m) { return m.href; }); },
    here: fileName
  };

  build();
})();
