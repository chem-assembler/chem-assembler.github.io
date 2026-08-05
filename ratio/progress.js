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

  // 課程フィルタで選んだ課程（入口の絞り込み）。**進捗ではなく設定**だが、
  // localStorage に触るのはこのファイルだけ、という約束なのでここに置く。
  // 'all'（すべて）/ 'basic'（化学基礎）/ 'adv'（化学）の3値だけを受け付ける。
  var COURSE_KEY = 'chemRatio.course';
  var COURSES = ['all', 'basic', 'adv'];

  function keyOf(mode) { return PREFIX + mode; }

  // モードごとの問題台帳（model.js のリスト名）。読むときに**現存する問題の id との
  // 積集合**を取る（外部レビュー P-6）。将来 id を改名すると古い保存が残り、
  // 「解いた問題 61 / 60」のような分母を超える表示になり得るため。
  // model.js（ChemRatio）は純粋データなので、progress.js から読んでも
  // 「localStorage に触るのは progress.js だけ」という役割分担は崩れない。
  var LISTS = { proportion: 'PROBLEMS', balance: 'BALANCE', stoich: 'REACTIONS',
                titration: 'TITRATIONS', thermo: 'THERMO' };

  // 現存する問題 id の集合。model.js が読み込まれていなければ null（＝素通し。
  // 台帳が引けないときに全消し側へ倒すと、読み込み順の事故が進捗の喪失になる）
  function validIds(mode) {
    var M = typeof window !== 'undefined' && window.ChemRatio;
    var list = M && M[LISTS[mode]];
    if (!list) return null;
    var set = {};
    list.forEach(function (p) { set[p.id] = true; });
    return set;
  }

  function read(mode) {
    var out = {};
    try {
      var raw = localStorage.getItem(keyOf(mode));
      if (!raw) return out;
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return out;
      var valid = validIds(mode);
      list.forEach(function (id) {
        if (typeof id === 'string' && (!valid || valid[id])) out[id] = true;
      });
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

  // ---- 課程の選択（入口の絞り込み）----
  // **知らない値は 'all' に倒す**。絞り込みが外せない状態で詰むのがいちばん怖いので、
  // 壊れた値・古い綴りが残っていても「すべて表示」に戻る側へ倒しておく。
  function readCourse() {
    try {
      var v = localStorage.getItem(COURSE_KEY);
      return COURSES.indexOf(v) >= 0 ? v : 'all';
    } catch (e) {
      return 'all';
    }
  }

  function writeCourse(c) {
    if (COURSES.indexOf(c) < 0) return false;
    try {
      localStorage.setItem(COURSE_KEY, c);
      return true;
    } catch (e) {
      return false;   // private モード等。呼ぶ側はページ内変数でその回だけ保つ
    }
  }

  function clearCourse() {
    try { localStorage.removeItem(COURSE_KEY); } catch (e) { /* noop */ }
  }

  window.ChemRatioProgress = {
    MODES: MODES,
    key: keyOf,
    open: open,
    read: read,
    clear: clear,
    // **「進捗をリセット」で課程の選択までは消さない**。消したのは解いた記録であって、
    // 「自分は化学基礎の範囲だけ見たい」という設定はそのまま続くのが自然
    clearAll: function () { MODES.forEach(clear); },
    COURSES: COURSES,
    courseKey: COURSE_KEY,
    readCourse: readCourse,
    writeCourse: writeCourse,
    clearCourse: clearCourse,
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
