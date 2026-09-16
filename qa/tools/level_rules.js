/**
 * Lv（difficulty）を決める規則と、ユーザーの上書きを守る関所。
 *
 * node（qa/tools/*.js）とブラウザ（qa/test.html）の両方から読む。
 * ブラウザでは `window.LevelRules` になる。
 *
 * ## なぜ1か所に集めるか（2026-09-17）
 *
 * Lv を書き換える道具が2つある:
 *   - `apply_seminar_levels.js` … §3-2 の片側の論法（基本に出る → Lv≤2 ／ 発展にだけ出る → Lv≥3）
 *   - `build_evidence.js`       … §7-2 の表（教科書 × セミナー）の許容区間に挟む
 * どちらも**いまの Lv を見て、外れていたら動かす**。
 * ユーザーが根拠を読んで決めた Lv（例: ピクリン酸 3→2）を**機械が黙って元に戻す**ので、
 * 上書きは `data/level_matrix.jsonl` の `override` 欄に書き、**道具は必ずこの関所を通す**。
 *
 * ★ 関所は `finalLv(machine, override)` 1つだけ。上書きがあれば上書きの値、無ければ機械の値。
 * ★ 否定対照: 上書きを消す（または `QA_LEVEL_MATRIX` で上書きの無い表を指す）と、道具は機械の値に戻す。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LevelRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- §7-2 の表を「片側の論法が許す範囲」まで広げたもの（build_evidence.js から移した）----
  // ⚠ **表の単一値をそのまま当てない。** §7-2 は表のすぐ下で
  //   「**片側の論法は §3-2 のまま維持する（強い信号だけを採る）**」と書いている。
  //   表の単一値には、片側の論法が支持しない動きが混じっている（2026-08-13 に実測）:
  //     ・「本文×基本 ＝ 2」… 片側は「基本に出る → **Lv ≤ 2**」なので **1 も許される**。
  //       単一値のままだと、いま Lv1 の5件（alkane-names・ketone-def・saccharide-def ほか）を
  //       **根拠なく2へ押し上げる**
  //     ・「発展欄×未登場 ＝ 4」… 片側では発展欄は「Lv ≥ 2」の**弱い**信号、未登場は
  //       「**何も言えない**」。この2つから 4 は出てこない。単一値のままだと Lv3 の6件
  //       （orientation・keto-enol ほか）を最難へ押し上げる
  //   そこで**両側の許容区間の共通部分**を採り、**いまの値がその中にあれば動かさない**。
  //   ＝ 強い信号が強いるときだけ動く。§3-5 の轍（先に表を作って外した）を繰り返さないため。
  //   ⚠ 「本文×未登場」だけは §7-2 の ※ に実測の根拠（セミナーは要項の表を問題にしない）が
  //   あるので、片側の共通部分 [1,3] ではなく設計書どおり [1,2] を使う。
  var TABLE = {
    '本文':       { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 3], '未登場': [1, 2] },
    '発展欄':     { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 4], '未登場': [2, 4] },
    '見あたらない': { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 4], '未登場': [1, 4] }
  };
  // 教科書の判定が弱い（matchLen < 12）ときは表を使わず、セミナー側の片側の論法だけで挟む
  var SEMINAR_ONLY = { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 4], '未登場': [1, 4] };

  /** §7-2: 教科書 × セミナーの許容区間 [下限, 上限] */
  function tableRange(textbook, weak, seminar) {
    var sem = seminar || '未登場';
    if (weak) return SEMINAR_ONLY[sem];
    return (TABLE[textbook] || TABLE['見あたらない'])[sem];
  }

  /** いまの Lv が区間の中なら動かさない。外なら近いほうの端へ */
  function clamp(lv, range) {
    return lv < range[0] ? range[0] : (lv > range[1] ? range[1] : lv);
  }

  /**
   * §3-2: apply_seminar_levels.js の規則。
   * `seminarMap` は**セミナーの問題（基本例題〜発展問題）だけ**で見た区分:
   *   '基本' … 基本例題・基本問題に1度でも出る
   *   '発展' … 発展にしか出ない
   *   'なし' … 問題には出ない
   * `process` はプロセス（要項のまとめ）に出るか。
   *
   * | 実測 | 現行 | 変更後 |
   * |---|---|---|
   * | 基本に出る | Lv3・Lv4 | Lv2 |
   * | 発展にしか出ない（プロセスにも出ない） | Lv1・Lv2 | Lv3 |
   * | それ以外 | — | 動かさない |
   *
   * ⚠ **プロセスに出る項目は「発展にしか出ない」に数えない**（2026-09-17）。
   *   この道具はプロセスが届く前（第1段）に書かれ、`seminar_map` だけを見ていた。
   *   そのため「プロセスに出る（§7-2 で Lv1 の強い信号）が、問題では発展にだけ出る」2件
   *   （org.alcohol.ethanol-prep・org.poly.urea-melamine-alkyd）を **Lv1 → 3 に上げる案**を出していた。
   *   --write すると build_evidence.js（プロセス → Lv1）と正面から食い違う。
   */
  function seminarRule(lv, seminarMap, process) {
    if (seminarMap === '基本' && lv >= 3) return 2;
    if (seminarMap === '発展' && !process && lv <= 2) return 3;
    return lv;
  }

  /** ★ 関所。上書きがあれば上書きの値、無ければ機械の値 */
  function finalLv(machine, override) {
    return override && typeof override.lv === 'number' ? override.lv : machine;
  }

  return {
    TABLE: TABLE,
    SEMINAR_ONLY: SEMINAR_ONLY,
    tableRange: tableRange,
    clamp: clamp,
    seminarRule: seminarRule,
    finalLv: finalLv
  };
});
