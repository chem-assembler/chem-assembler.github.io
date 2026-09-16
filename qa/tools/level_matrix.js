/**
 * Lv の根拠の表（`qa/data/level_matrix.jsonl`）を読む・材料を集める（node 専用）。
 *
 * - `MATRIX_PATH` … 表の場所。環境変数 `QA_LEVEL_MATRIX` で差し替えられる
 *   （否定対照: 上書きを消した写しを指して、道具が機械の値に戻すことを確かめる）
 * - `readOverrides()` … code → override（{ lv, from, date, reason, ref }）
 * - `readSeminarFlags()` … code → { seminarMap: '基本'|'発展'|'なし', process: bool, span, where }
 *   ★ 材料は**リポジトリの外**（source_paths.js）。表に載せるのは区分の語だけ
 *
 * 規則そのものは `level_rules.js`（ブラウザのテストと共有するため分けた）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = require('./source_paths');

const QA = path.resolve(__dirname, '..');
const MATRIX_PATH = process.env.QA_LEVEL_MATRIX || path.join(QA, 'data', 'level_matrix.jsonl');

const parseJsonl = (text) => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));

/** 表の全行（無ければ空配列） */
function readMatrix(file) {
  const f = file || MATRIX_PATH;
  if (!fs.existsSync(f)) return [];
  return parseJsonl(fs.readFileSync(f, 'utf8'));
}

/** code → override。上書きの無い行は入れない */
function readOverrides(file) {
  const map = new Map();
  readMatrix(file).forEach((r) => { if (r.override) map.set(r.code, r.override); });
  return map;
}

const LEVELS = ['基本例題', '基本問題', '発展例題', '発展問題'];
const BASIC = { '基本例題': 1, '基本問題': 1 };

/**
 * セミナーの問題とプロセスから、項目ごとの区分を集める。
 * 材料が無ければ null（呼ぶ側が SRC.missingMessage() を出す）。
 */
function readSeminarFlags() {
  const maps = SRC.list(/^seminar_map_ch\d+\.jsonl$/);
  if (!maps.length) return null;
  const seen = new Map();
  const get = (c) => {
    if (!seen.has(c)) seen.set(c, { basic: false, adv: false, process: false, span: 99, where: {} });
    return seen.get(c);
  };
  maps.forEach((f) => parseJsonl(fs.readFileSync(SRC.at(f), 'utf8')).forEach((o) => {
    (o.codes || []).forEach((c) => {
      const s = get(c);
      s.where[o.level] = true;
      if (BASIC[o.level]) {
        s.basic = true;
        // 基本での「またがり」だけを見る（下げの根拠になるのは基本側の出題）
        if (o.codes.length < s.span) s.span = o.codes.length;
      } else s.adv = true;
    });
  }));
  SRC.list(/^seminar_process_ch\d+\.jsonl$/).forEach((f) =>
    parseJsonl(fs.readFileSync(SRC.at(f), 'utf8')).forEach((o) =>
      (o.codes || []).forEach((c) => { get(c).process = true; })));
  seen.forEach((s) => {
    s.seminarMap = s.basic ? '基本' : (s.adv ? '発展' : 'なし');
    s.whereText = LEVELS.filter((L) => s.where[L]).join('+');
  });
  return seen;
}

module.exports = { MATRIX_PATH, readMatrix, readOverrides, readSeminarFlags, parseJsonl };
