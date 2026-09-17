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
  // ---- 根拠1つずつから出る Lv（2026-09-17・ユーザー決定「根拠ごとのレベルも記録しておいてください」）----
  // 出典は DESIGN_difficulty_frequency.md §7-2 の「片側の論法」の表（§3-2 を引き継いだもの）。
  // **区間 [下限, 上限]** で持つ。片側の論法は「Lv ≤ 2」「Lv ≥ 3」のように片側しか言わないので、
  // 1つの値にすると根拠が言っていないことまで言ったことになる（§3-3 (a) の轍）。
  //   [1, 4] ＝ 規則はあるが「何も言えない」（例: セミナー未登場・教科書に見あたらない）
  //   null   ＝ **規則なし**（文書に Lv への変換の規則が無い。推測で埋めない）
  //
  // | 根拠 | 区分 → 言えること | 強さ |
  // |---|---|---|
  // | 教科書 | 本文 → Lv ≤ 3 | 強い |
  // |        | 発展欄 → Lv ≥ 2 | 弱い |
  // |        | 見あたらない → 何も言えない（1社しか見ていない） | — |
  // | セミナー | プロセス → Lv1 | 強い |
  // |          | 基本 → Lv ≤ 2 | 強い |
  // |          | 発展（にだけ出る） → Lv ≥ 3 | 弱い |
  // |          | 未登場 → 何も言えない | — |
  // | 入試 | **規則なし** | — |
  var BY_TEXTBOOK = { '本文': [1, 3], '発展欄': [2, 4], '見あたらない': [1, 4] };
  var BY_SEMINAR = { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 4], '未登場': [1, 4] };
  // ⚠ 教科書の判定が弱い（一致が12字未満・`textbookWeak`）ときは、教科書から Lv を出さない（[1, 4]）。
  //   §7-2 の表も弱い判定では教科書を使わずセミナー側だけで挟んでいる（下の SEMINAR_ONLY）ので、それに合わせる。
  //   §8-1「一致の長さが確度そのもの」（ヨウ素価は主題が発展欄なのに、一致が短く本文と判定された）
  var NOTHING = [1, 4];
  // ⚠ **入試（`evidence.exam` の ①解答になった回数・②手筋に使われた数）は Lv の規則が無い。**
  //   §7-2「決め手は教科書での扱い × セミナーでの扱い。**出題頻度はここに混ぜない**」、
  //   §7-3「入試は軸2 `priority`（出題での効き）の材料。**閾値は先に決めない**」。
  //   だから入試から見た Lv は null（規則なし）で持ち、回数だけを並べる。
  var BY_EXAM = null;

  // 教科書の判定が弱い（matchLen < 12）ときは表を使わず、セミナー側の片側の論法だけで挟む
  // （＝ セミナーから見た Lv そのもの）
  var SEMINAR_ONLY = BY_SEMINAR;

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

  /**
   * 根拠1つずつから出る Lv の区間。`evidence`（questions.json）の形をそのまま受ける。
   * 戻り値: { textbook: [lo, hi], seminar: [lo, hi], exam: null（規則なし） }
   */
  function evidenceLv(ev) {
    var e = ev || {};
    return {
      textbook: e.textbookWeak === true ? NOTHING : (BY_TEXTBOOK[e.textbook] || NOTHING),
      seminar: BY_SEMINAR[e.seminar || '未登場'] || NOTHING,
      exam: BY_EXAM
    };
  }

  /**
   * 根拠の区間から見て、いまの Lv がどちらへ押されているか。
   *   'up' … Lv が区間の下限より低い（この根拠は Lv を押し上げている）
   *   'down' … Lv が区間の上限より高い（押し下げている）
   *   '' … 区間の中（または規則なし）
   */
  function push(lv, range) {
    if (!range) return '';
    return lv < range[0] ? 'up' : (lv > range[1] ? 'down' : '');
  }

  /**
   * §7-2 の区間（tableRange）は、ほとんどの欄で「教科書の区間 ∩ セミナーの区間」になる。
   * ならない欄は3つだけで、どれも設計書に理由がある（テストがこの3つに固定している）:
   *   本文×未登場   … 共通部分 [1,3] ではなく [1,2]（§7-2 の ※: セミナーは要項の表を問題にしない）
   *   発展欄×プロセス … 共通部分が空（Lv≥2 と Lv1）。強い信号（プロセス）を採って [1,1]
   *   発展欄×基本   … 共通部分 [2,2] ではなく [1,2]。弱い信号（発展欄 Lv≥2）より強い信号（基本 Lv≤2）を採る
   */
  var NOT_INTERSECTION = ['本文×未登場', '発展欄×プロセス', '発展欄×基本'];

  /**
   * 入試で手筋として使われた問題の数（build_evidence.js の evidence.exam.asTool と同じ数え方:
   * `data/exam_usage.jsonl` の1行の problems のうち、via に「手筋」を含むもの）。
   * 表の `asToolNow`（evidence が古いときの今の値）を、生成器とテストが同じ数え方で出すために置く
   */
  function asToolOf(problems) {
    return (problems || []).filter(function (p) { return (p.via || []).indexOf('手筋') >= 0; }).length;
  }

  /** ★ 関所。上書きがあれば上書きの値、無ければ機械の値 */
  function finalLv(machine, override) {
    return override && typeof override.lv === 'number' ? override.lv : machine;
  }

  return {
    TABLE: TABLE,
    SEMINAR_ONLY: SEMINAR_ONLY,
    BY_TEXTBOOK: BY_TEXTBOOK,
    BY_SEMINAR: BY_SEMINAR,
    BY_EXAM: BY_EXAM,
    NOT_INTERSECTION: NOT_INTERSECTION,
    evidenceLv: evidenceLv,
    push: push,
    asToolOf: asToolOf,
    tableRange: tableRange,
    clamp: clamp,
    seminarRule: seminarRule,
    finalLv: finalLv
  };
});
