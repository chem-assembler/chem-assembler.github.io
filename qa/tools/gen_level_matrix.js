#!/usr/bin/env node
/**
 * Lv の根拠の表（マトリックス）を作る。
 *
 *   node qa/tools/gen_level_matrix.js          … 差分があるかだけ見る（あれば終了コード1）
 *   node qa/tools/gen_level_matrix.js --write  … data/level_matrix.jsonl と LEVEL_MATRIX.md を書き出す
 *
 * ## 何が正か（2026-09-17・ユーザー提案「レベル分けの根拠をマトリックスで保存」）
 *
 * | 欄 | 正 | 手で書くか |
 * |---|---|---|
 * | `lv`（現在の Lv） | `questions.json` の `difficulty` | ✕ |
 * | `textbook` `textbookWeak` `seminar` `exam` | `questions.json` の `evidence`（build_evidence.js が入れる） | ✕ |
 * | `seminarMap` | セミナーの問題だけで見た区分（材料はリポジトリの外・source_paths.js） | ✕ |
 * | `asToolNow` | **evidence.exam.asTool が今の入試データより古いときだけ**、今の値（`data/exam_usage.jsonl`） | ✕ |
 * | `lvBy` | **根拠1つずつから出る Lv の区間** `{ textbook: [lo,hi], seminar: [lo,hi], exam: null }`（level_rules.js の evidenceLv。null ＝ 規則なし） | ✕ |
 * | `ruleSeminar` | §3-2 の規則（apply_seminar_levels.js）が出す値 | ✕ |
 * | `tableRange` `ruleTable` | §7-2 の表の許容区間と、そこへ挟んだ値（build_evidence.js） | ✕ |
 * | **`override`** | **この表の行そのもの**（`{ lv, from, date, reason, ref }`） | **○ ここだけ** |
 * | `final` | `override` があればその値、無ければ `lv` | ✕ |
 *
 * ★ **手で書くのは `override` だけ。** 書き出すときは既存の表から `override` を拾って残し、
 *   ほかの欄は作り直す（＝ 機械の欄は手で直しても次の生成で消える）。
 * ★ `LEVEL_MATRIX.md` は人が読む一覧で、**完全な生成物**。手で直さない。
 *
 * ## 上書きを足す手順
 *
 * 1. `questions.json` の `difficulty` を直す
 * 2. `data/level_matrix.jsonl` のその行の `"override":null` を
 *    `{"lv":2,"from":3,"date":"2026-09-15","reason":"…","ref":"v112"}` にする
 * 3. `node qa/tools/gen_level_matrix.js --write`
 * 4. qa/test.html（「Lv の根拠の表」の節）が、表と questions.json と道具の関所を突き合わせる
 */
'use strict';

const fs = require('fs');
const path = require('path');
const RULES = require('./level_rules');
const MATRIX = require('./level_matrix');
const SRC = require('./source_paths');

const QA = path.resolve(__dirname, '..');
const JSONL = MATRIX.MATRIX_PATH;
const MD = path.join(QA, 'LEVEL_MATRIX.md');

const Q = JSON.parse(fs.readFileSync(path.join(QA, 'questions.json'), 'utf8'));
// 入試の今のデータ（evidence.exam.asTool が古いかを見る。⚠ questions.json の値は変えない）
const toolNow = new Map();
MATRIX.parseJsonl(fs.readFileSync(path.join(QA, 'data', 'exam_usage.jsonl'), 'utf8'))
  .filter((o) => !o._readme).forEach((o) => toolNow.set(o.code, RULES.asToolOf(o.problems)));
const flags = MATRIX.readSeminarFlags();
if (!flags) { console.log(SRC.missingMessage()); process.exit(2); }

const oldRows = MATRIX.readMatrix();
const overrides = new Map();
oldRows.forEach((r) => { if (r.override) overrides.set(r.code, r.override); });
const known = new Set(Q.patterns.map((p) => p.code));
const orphan = [...overrides.keys()].filter((c) => !known.has(c));
if (orphan.length) {
  console.log('✗ 上書きのある行が questions.json に無い: ' + orphan.join(' ') + '（コードの改名なら行を移す）');
  process.exit(1);
}

// ---- 行を作る ----
const rows = Q.patterns.map((p) => {
  const ev = p.evidence || {};
  const lv = p.difficulty;
  const seminar = ev.seminar || '未登場';
  const f = flags.get(p.code);
  const seminarMap = f ? f.seminarMap : 'なし';
  const range = RULES.tableRange(ev.textbook, ev.textbookWeak === true, seminar);
  const override = overrides.get(p.code) || null;
  const row = { code: p.code, unit: p.unit, lv: lv, final: RULES.finalLv(lv, override), override: override };
  row.textbook = ev.textbook || '見あたらない';
  if (ev.textbookWeak) row.textbookWeak = true;
  row.seminar = seminar;
  row.seminarMap = seminarMap;
  if (ev.exam) row.exam = ev.exam;
  const now = toolNow.get(p.code) || 0;
  if (now !== ((ev.exam && ev.exam.asTool) || 0)) row.asToolNow = now;
  row.lvBy = RULES.evidenceLv(ev);
  row.ruleSeminar = RULES.seminarRule(lv, seminarMap, seminar === 'プロセス');
  row.tableRange = range;
  row.ruleTable = RULES.clamp(lv, range);
  return row;
});

const bad = rows.filter((r) => r.final !== r.lv);
if (bad.length) {
  console.log('✗ 上書きの値と questions.json の difficulty が違う: ' +
    bad.map((r) => r.code + '（上書き ' + r.final + ' / difficulty ' + r.lv + '）').join(' / ') +
    '\n  questions.json の difficulty を上書きの値に直してから走らせる');
  process.exit(1);
}

// ---- 人が読む一覧 ----
const unitName = {};
Q.units.forEach((u) => { unitName[u.id] = u.name; });
const groupOf = {};
Q.patterns.forEach((p) => { groupOf[p.code] = p.group || ''; });
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
const tbText = (r) => r.textbook + (r.textbookWeak ? '（弱）' : '');
const semText = (r) => (r.seminar === 'プロセス' && r.seminarMap !== 'なし') ? 'プロセス＋' + r.seminarMap : r.seminar;
const examText = (r) => {
  const e = r.exam || {};
  return '①' + (e.asAnswer === undefined ? '未' : e.asAnswer) + ' ②' + (e.asTool || 0) +
    (r.asToolNow !== undefined ? '→' + r.asToolNow : '');
};
// 根拠1つずつの区間を短く書く。いまの Lv（最終）が区間の外なら、押している向きを添える
const shortRange = (g) => g[0] === g[1] ? String(g[0])
  : (g[0] === 1 && g[1] === 4 ? '—' : (g[0] === 1 ? '≤' + g[1] : (g[1] === 4 ? '≥' + g[0] : g[0] + '〜' + g[1])));
const byText = (r, k) => {
  const g = r.lvBy[k];
  if (!g) return '';   // 規則なし（空欄）
  const d = RULES.push(r.final, g);
  return shortRange(g) + (d === 'up' ? ' **↑**' : d === 'down' ? ' **↓**' : '');
};
const pushes = (r) => ['textbook', 'seminar'].filter((k) => RULES.push(r.final, r.lvBy[k]));
const ruleSemText = (r) => r.ruleSeminar === r.lv ? String(r.ruleSeminar) : '**' + r.ruleSeminar + '** ⚠';
const rangeText = (r) => r.tableRange[0] === r.tableRange[1] ? String(r.tableRange[0]) : r.tableRange[0] + '〜' + r.tableRange[1];
const ruleTabText = (r) => r.ruleTable === r.lv ? rangeText(r)
  : (r.tableRange[0] === r.tableRange[1] ? '**' + rangeText(r) + '** ⚠' : rangeText(r) + ' **→' + r.ruleTable + '** ⚠');
const ovText = (r) => r.override ? '**' + r.override.from + '→' + r.override.lv + '**（' + r.override.date + '）' : '';
const differs = (r) => r.ruleSeminar !== r.lv || r.ruleTable !== r.lv;

const out = [];
out.push('# Lv の根拠の表（マトリックス）');
out.push('');
out.push('一問一答の全項目について、**Lv（difficulty）を決める材料と、決まった値**を1行ずつ並べたもの。');
out.push('Lv の基準は [DESIGN_difficulty_frequency.md](DESIGN_difficulty_frequency.md) の §3-2（セミナーの片側の論法）と §7-2（教科書 × セミナーの表）。');
out.push('');
out.push('⚠ **このファイルは `qa/tools/gen_level_matrix.js` が生成する。** 手で直さない。');
out.push('正は `qa/data/level_matrix.jsonl`（1行1項目）。**手で書くのはその `override` 欄だけ**で、ほかの欄は `questions.json` とセミナーの材料から作り直す。');
out.push('ずれると回帰テスト（qa/test.html「Lv の根拠の表」）が鳴る。');
out.push('');
out.push('★ **上書きのある項目は、Lv を書き換える道具（`apply_seminar_levels.js`・`build_evidence.js`）が動かさない。**');
out.push('★ **機械の目安と食い違う Lv には、必ず上書きの記録を付ける**（無いとテストが鳴る ＝ 根拠の無い手直しを残さない）。');
out.push('');
out.push('## 欄の読み方');
out.push('');
out.push('| 欄 | 意味 |');
out.push('|---|---|');
out.push('| 現在 | `questions.json` の `difficulty` |');
out.push('| 教科書 | 本文 / 発展欄 / 見あたらない。（弱）は一致が短く、§7-2 の表を使わずセミナー側だけで挟む |');
out.push('| 教科書→Lv | **教科書だけから見た Lv**。本文 ≤3（強い）／発展欄 ≥2（弱い）／見あたらない・（弱） —（何も言えない） |');
out.push('| セミナー | プロセス / 基本 / 発展 / 未登場。「プロセス＋発展」はプロセスに出るうえ、問題では発展にだけ出る |');
out.push('| セミナー→Lv | **セミナーだけから見た Lv**。プロセス 1（強い）／基本 ≤2（強い）／発展 ≥3（弱い）／未登場 —（何も言えない） |');
out.push('| 入試 | ① 解答になった回数（未 ＝ 判定していない）／② 手筋として使われた問題数。**「②44→84」は evidence の値が古く、今の入試データでは 84**（下の節） |');
out.push('| 入試→Lv | **規則なし（空欄）**。§7-2「出題頻度は difficulty に混ぜない」・§7-3「閾値は先に決めない」。入試は優先度（priority）の材料 |');
out.push('| 目安 §3-2 | `apply_seminar_levels.js` の規則が出す値（基本に出て Lv3以上 → 2／発展にだけ出て Lv2以下 → 3／ほかは動かさない） |');
out.push('| 目安 §7-2 | `build_evidence.js` の許容区間（教科書 × セミナー）。いまの Lv が区間の外なら ⚠ と行き先 |');
out.push('| 上書き | ユーザーが決めた値（元→上書き・日付）。理由は上の節 |');
out.push('| 最終 | 上書きがあればその値、無ければ現在の値。**現在と必ず一致する** |');
out.push('');
out.push('**↑ ↓ の読み方**: 根拠ごとの Lv の欄で、いまの Lv（最終）が**その根拠の区間の外**にあるとき、');
out.push('その根拠が Lv を**押し上げている（↑）／押し下げている（↓）**。「≥」は上へ押す側の根拠、「≤」は下へ押す側の根拠で、いまの Lv が区間の中なら矢印は付かない。');
out.push('規則は `qa/tools/level_rules.js`（`BY_TEXTBOOK`・`BY_SEMINAR`・`BY_EXAM`）の1か所。');
out.push('');
out.push('⚠ 目安 §7-2 の区間は、ほとんどの欄で「教科書の区間 ∩ セミナーの区間」になるが、**3つの欄だけ違う**（`NOT_INTERSECTION`）:');
out.push('本文×未登場 は ≤3 でなく 1〜2（§7-2 の ※）／発展欄×プロセス は共通部分が空で 1（強い信号を採る）／発展欄×基本 は 2 でなく 1〜2（弱い発展欄より強い基本を採る）。');
out.push('');

const ov = rows.filter((r) => r.override);
out.push('## ユーザーの上書き（' + ov.length + '件）');
out.push('');
out.push('| コード | 元 | 上書き | 日付 | 理由 | 記録 | 教科書→Lv | セミナー→Lv | 目安 §3-2 | 目安 §7-2 |');
out.push('|---|--:|--:|---|---|---|---|---|--:|---|');
ov.forEach((r) => {
  out.push('| `' + r.code + '` | ' + r.override.from + ' | **' + r.override.lv + '** | ' + r.override.date + ' | ' +
    cell(r.override.reason) + ' | ' + cell(r.override.ref || '') + ' | ' + byText(r, 'textbook') + ' | ' + byText(r, 'seminar') + ' | ' +
    ruleSemText(r) + ' | ' + ruleTabText(r) + ' |');
});
out.push('');

const loose = rows.filter((r) => !r.override && differs(r));
out.push('## 機械の目安と食い違う項目（上書きの記録なし・' + loose.length + '件）');
out.push('');
if (!loose.length) {
  out.push('なし。機械の目安と食い違う Lv は、すべて上の上書きに記録がある。');
} else {
  out.push('| コード | 現在 | 目安 §3-2 | 目安 §7-2 |');
  out.push('|---|--:|--:|---|');
  loose.forEach((r) => out.push('| `' + r.code + '` | ' + r.lv + ' | ' + ruleSemText(r) + ' | ' + ruleTabText(r) + ' |'));
}
out.push('');

const pushed = rows.filter((r) => pushes(r).length);
out.push('## 根拠がいまの Lv を押し上げ／押し下げている項目（' + pushed.length + '件）');
out.push('');
out.push('根拠1つずつの区間から見て、いまの Lv がその外にある項目。上書きした項目か、目安 §7-2 で強い信号が弱い信号に勝った項目のどちらか。');
out.push('');
if (!pushed.length) out.push('なし。');
else {
  out.push('| コード | 最終 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 上書き |');
  out.push('|---|--:|---|---|---|---|---|');
  pushed.forEach((r) => out.push('| `' + r.code + '` | ' + r.final + ' | ' + tbText(r) + ' | ' + byText(r, 'textbook') + ' | ' +
    semText(r) + ' | ' + byText(r, 'seminar') + ' | ' + ovText(r) + ' |'));
}
out.push('');

const stale = rows.filter((r) => r.asToolNow !== undefined);
out.push('## 入試の手筋の数が古い項目（' + stale.length + '件）');
out.push('');
out.push('`questions.json` の `evidence.exam.asTool` は、`build_evidence.js --write` を最後に回した時点の入試データで数えてある。');
out.push('そのあと `data/exam_usage.jsonl` が広がった（1年ぶん → 2年ぶん）ので、今のデータで数え直すと違う。一覧の入試の欄は「②古い値→今の値」と並べて書く（表では `asToolNow`）。');
out.push('⚠ **入試は Lv の規則に入らない**（入試→Lv は規則なし）ので、Lv にも目安にも効かない。**questions.json の値はこの表では変えない。**');
out.push('');

const dist = {};
rows.forEach((r) => { dist[r.final] = (dist[r.final] || 0) + 1; });
out.push('## 全項目（' + rows.length + '件）');
out.push('');
out.push('Lv の分布: ' + [1, 2, 3, 4].map((n) => 'Lv' + n + ' ' + (dist[n] || 0) + '件').join('・'));
out.push('');
Q.units.forEach((u) => {
  const rs = rows.filter((r) => r.unit === u.id);
  if (!rs.length) return;
  out.push('### ' + u.id + '（' + (unitName[u.id] || '') + '・' + rs.length + '件）');
  out.push('');
  out.push('| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |');
  out.push('|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|');
  rs.forEach((r) => {
    out.push('| `' + r.code + '` | ' + cell(groupOf[r.code]) + ' | ' + r.lv + ' | ' + tbText(r) + ' | ' + byText(r, 'textbook') + ' | ' +
      semText(r) + ' | ' + byText(r, 'seminar') + ' | ' + examText(r) + ' | ' + byText(r, 'exam') + ' | ' + ruleSemText(r) + ' | ' + ruleTabText(r) + ' | ' + ovText(r) + ' | ' + r.final + ' |');
  });
  out.push('');
});
out.push('---');
out.push('');
out.push('生成元: `qa/questions.json`（' + rows.length + '件）・`qa/data/level_matrix.jsonl` の override 欄・`qa/data/exam_usage.jsonl`・セミナーの材料（リポジトリの外） ／ 生成器: `qa/tools/gen_level_matrix.js`');
out.push('');

const jsonlText = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const mdText = out.join('\n');

// ---- 書き出す / 差分を見る ----
// ⚠ 作業ツリーは autocrlf で CRLF になりうるので、改行をそろえてから比べる
const norm = (s) => s.replace(/\r\n/g, '\n');
const same = (f, text) => fs.existsSync(f) && norm(fs.readFileSync(f, 'utf8')) === text;
const summary = rows.length + '件・上書き ' + ov.length + '件・上書きの記録なしの食い違い ' + loose.length + '件・根拠が押している ' +
  pushed.length + '件・入試の手筋の数が古い ' + stale.length + '件';
if (same(JSONL, jsonlText) && same(MD, mdText)) { console.log('変わりなし（' + summary + '）'); process.exit(0); }
if (!process.argv.includes('--write')) {
  console.log('差分あり（' + summary + '）。--write で書き出す');
  process.exit(1);
}
fs.writeFileSync(JSONL, jsonlText, 'utf8');
fs.writeFileSync(MD, mdText, 'utf8');
console.log('→ ' + path.relative(process.cwd(), JSONL) + ' / ' + path.relative(process.cwd(), MD) + '（' + summary + '）');
loose.forEach((r) => console.log('  ⚠ 食い違い（記録なし） Lv' + r.lv + ' §3-2→' + r.ruleSeminar + ' §7-2→' + r.ruleTable + '  ' + r.code));
