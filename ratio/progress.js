// 比例式でみる化学計算 — 進捗（クリアした問題）の保存
//
// クリアの印（#stageNav の緑のボタン）は各モードの `state.solved` にしか無く、
// 再読込で消えていた（外部レビュー項目9）。`DESIGN_ratio.md` の「課程フィルタ」も
// **進捗の保存が前提**なので、その土台をここに置く。
//
// **保存の実装はこの1か所だけ**にする（5モードに同じコードを5回書かない）。
// 各モードは `open(<モードid>)` で自分の入れ物を受け取り、
//   - `store.solved` … これまでにクリアした問題の集合（`{id: true}`）
//   - `store.mark(id)` … クリアを記録して保存する
// だけを使う。model.js は DOM 非依存のままにしたいので、
// localStorage に触るのはこのファイル（と各モードの UI）に閉じる。
//
// localStorage は private モードなどで例外を投げることがあるので、
// **読み書きは必ず try/catch で囲む**（このリポジトリの既存コードと同じ流儀）。
// 保存できない環境でも、その回のあいだは印が出る（ページ内変数としては動く）。
(function () {
  'use strict';

  var PREFIX = 'chemRatio.cleared.';
  // 入口（portal.js / nav.js）の並び順と同じ。key はモードid、値は表示用の名前
  var MODES = ['proportion', 'balance', 'stoich', 'titration', 'thermo'];

  function keyOf(mode) { return PREFIX + mode; }

  function read(mode) {
    var out = {};
    try {
      var raw = localStorage.getItem(keyOf(mode));
      if (!raw) return out;
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return out;
      list.forEach(function (id) { if (typeof id === 'string') out[id] = true; });
    } catch (e) {
      // 壊れた値・private モード等。読めなければ「まだ何も解いていない」とみなす
    }
    return out;
  }

  function write(mode, solved) {
    try {
      localStorage.setItem(keyOf(mode), JSON.stringify(Object.keys(solved)));
      return true;
    } catch (e) {
      return false;   // 保存できなくても落とさない（その回のあいだは印が出る）
    }
  }

  function open(mode) {
    var solved = read(mode);
    return {
      mode: mode,
      solved: solved,
      mark: function (id) {
        if (solved[id]) return false;
        solved[id] = true;
        write(mode, solved);
        return true;
      },
      count: function () { return Object.keys(solved).length; }
    };
  }

  function clear(mode) {
    try { localStorage.removeItem(keyOf(mode)); } catch (e) { /* noop */ }
  }

  window.ChemRatioProgress = {
    MODES: MODES,
    key: keyOf,
    open: open,
    read: read,
    clear: clear,
    clearAll: function () { MODES.forEach(clear); },
    total: function () {
      return MODES.reduce(function (n, m) {
        return n + Object.keys(read(m)).length;
      }, 0);
    },
    // 保存が使える環境かどうか（入口で「保存できません」と出すために使う）
    available: function () {
      try {
        localStorage.setItem(PREFIX + '__probe', '1');
        localStorage.removeItem(PREFIX + '__probe');
        return true;
      } catch (e) {
        return false;
      }
    }
  };
})();
