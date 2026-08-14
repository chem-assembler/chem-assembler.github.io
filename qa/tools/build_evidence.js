#!/usr/bin/env node
// 4つの根拠を1つの `evidence` にまとめ、§7-2 の表から difficulty を導く。
//
//   node qa/tools/build_evidence.js            # 分布を出すだけ（書かない）
//   node qa/tools/build_evidence.js --write    # questions.json に evidence と difficulty を入れる
//
// 出典（DESIGN_difficulty_frequency.md §7-4 の表）:
//   evidence.textbook       … textbook_by_item.jsonl の scope（本文 / 発展欄 / 見あたらない）★材料は外
//   evidence.seminar        … seminar_process_ch*.jsonl と seminar_map_ch*.jsonl        ★材料は外
//   evidence.exam.asAnswer  … data/exam_answer_type.jsonl の asAnswer が true の回数
//   evidence.exam.asTool    … data/exam_usage.jsonl の via に「手筋」を含む問題の数
//
// ⚠ ★の材料は **リポジトリの外**（`source_paths.js`）。qa/ の下は Pages がそのまま配るので、
//   傍用問題集の索引を公開することになってしまう。**出すのは区分の語だけ**で、問題番号は出さない。
//
// ⚠ **`priority` はここでは決めない。** §7-3 が「閾値は先に決めない。データが揃ってから
//   分布を見て決める」と明記している（§3-5 の轍 —— 初期案の対応表を先に作って外した）。
//   このツールは回数をそのまま持たせるところまでで、分布を印字して終わる。
//
// ⚠ **「判定していない」を 0 と書かない。** ①の判定は 274コード中50コードにしか付いていない。
//   0 と書くと「一度も解答になっていない」と読めてしまい、§7-3 の
//   「出ていない＝優先度が低い、とは言わない」に反する。判定が無いコードは asAnswer を持たせない。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const Q_PATH = path.join(ROOT, 'questions.json');
// ⚠ セミナー・教科書の材料は **リポジトリの外**（公開しないため。source_paths.js に理由）。
//    入試の材料（exam_*.jsonl）は出典を示してよいので qa/data/ のまま。
const SRC = require('./source_paths');
const parseJsonl = (text) => text.trim().split('\n')
    .filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((o) => !o._readme);
/** セミナー・教科書の材料（リポジトリの外） */
const readSrc = (f) => parseJsonl(fs.readFileSync(SRC.at(f), 'utf8'));
/** 入試の材料（qa/data/ ＝ 配信物と同居してよい） */
const readJsonl = (f) => parseJsonl(fs.readFileSync(path.join(DATA, f), 'utf8'));

const Q = JSON.parse(fs.readFileSync(Q_PATH, 'utf8'));
const items = Q.patterns || Q.items;

// ---- ① 教科書での扱い ----
const tb = new Map();
readSrc('textbook_by_item.jsonl').forEach((r) => tb.set(r.code, r));

// ---- ② セミナーでの扱い（プロセス > 基本 > 発展 > 未登場）----
const seminar = new Map();
const chapters = SRC.list(/^seminar_map_ch\d+\.jsonl$/);
chapters.forEach((f) => readSrc(f).forEach((r) => {
    const lv = String(r.level || '').startsWith('基本') ? '基本' : '発展';
    (r.codes || []).forEach((c) => {
        // 基本が1つでもあれば基本（片側の論法・§7-2「基本に出る → Lv ≤ 2」は強い信号）
        if (seminar.get(c) !== '基本') seminar.set(c, lv);
    });
}));
// プロセスは最強。あとから上書きする
SRC.list(/^seminar_process_ch\d+\.jsonl$/)
    .forEach((f) => readSrc(f).forEach((r) => (r.codes || []).forEach((c) => seminar.set(c, 'プロセス'))));

// ---- ③ ①解答になる回数（判定のあるコードだけ）----
const asAnswer = new Map();   // code → { yes, judged }
readJsonl('exam_answer_type.jsonl').forEach((r) => {
    if (!asAnswer.has(r.code)) asAnswer.set(r.code, { yes: 0, judged: 0 });
    const a = asAnswer.get(r.code);
    if (r.asAnswer === true) { a.yes++; a.judged++; } else if (r.asAnswer === false) a.judged++;
    // null は「判定できず」。母数にも入れない
});

// ---- ④ 手筋として使われた回数 ----
const asTool = new Map();
readJsonl('exam_usage.jsonl').forEach((r) => {
    const n = (r.problems || []).filter((p) => (p.via || []).includes('手筋')).length;
    if (n) asTool.set(r.code, n);
});

// ---- §7-2 の表を「片側の論法が許す範囲」まで広げたもの ----
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
const TABLE = {
    '本文':       { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 3], '未登場': [1, 2] },
    '発展欄':     { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 4], '未登場': [2, 4] },
    '見あたらない': { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 4], '未登場': [1, 4] },
};
// 教科書の判定が弱い（matchLen < 12）ときは表を使わず、セミナー側の片側の論法だけで挟む
const SEMINAR_ONLY = { 'プロセス': [1, 1], '基本': [1, 2], '発展': [3, 4], '未登場': [1, 4] };

const rows = [];
items.forEach((it) => {
    const t = tb.get(it.code);
    const scope = t ? t.scope : '見あたらない';
    const weak = !t || t.weak === true;
    const sem = seminar.get(it.code) || '未登場';
    const ans = asAnswer.get(it.code);
    const tool = asTool.get(it.code) || 0;

    const range = (weak ? SEMINAR_ONLY[sem] : TABLE[scope][sem]);
    const cur = it.difficulty;
    const next = (cur >= range[0] && cur <= range[1]) ? cur : (cur < range[0] ? range[0] : range[1]);

    const ev = { textbook: scope, seminar: sem };
    if (weak) ev.textbookWeak = true;
    const exam = {};
    if (ans && ans.judged > 0) exam.asAnswer = ans.yes;
    if (tool) exam.asTool = tool;
    if (Object.keys(exam).length) ev.exam = exam;

    rows.push({ it, ev, cur, next, range, weak, scope, sem, ans, tool });
});

// ---- 分布を出す ----
const tally = (f) => rows.reduce((a, r) => (a[f(r)] = (a[f(r)] || 0) + 1, a), {});
console.log(`知識項目 ${rows.length} 件\n`);
console.log('■ 教科書での扱い     ', JSON.stringify(tally((r) => r.scope)));
console.log('  うち判定が弱い     ', rows.filter((r) => r.weak).length, '件（表を使わずセミナー側だけで挟む）');
console.log('■ セミナーでの扱い   ', JSON.stringify(tally((r) => r.sem)));
console.log('■ difficulty 変化    ', JSON.stringify(tally((r) => (r.cur === r.next ? '据え置き' : `${r.cur}→${r.next}`))));
console.log('■ difficulty 分布    ', '前', JSON.stringify(tally((r) => r.cur)), '→ 後', JSON.stringify(tally((r) => r.next)));

const judged = rows.filter((r) => r.ev.exam && r.ev.exam.asAnswer !== undefined);
const withTool = rows.filter((r) => r.tool > 0);
console.log(`\n■ ①解答になる（判定があるコードだけ）… ${judged.length} 件 / ${rows.length}`);
console.log('   回数の分布', JSON.stringify(judged.reduce((a, r) => (a[r.ev.exam.asAnswer] = (a[r.ev.exam.asAnswer] || 0) + 1, a), {})));
console.log(`■ ②手筋として使われる … ${withTool.length} 件 / ${rows.length}`);
const bins = { '0': 0, '1': 0, '2-3': 0, '4-9': 0, '10-19': 0, '20-39': 0, '40+': 0 };
rows.forEach((r) => {
    const n = r.tool;
    const k = n === 0 ? '0' : n === 1 ? '1' : n <= 3 ? '2-3' : n <= 9 ? '4-9' : n <= 19 ? '10-19' : n <= 39 ? '20-39' : '40+';
    bins[k]++;
});
console.log('   回数の分布', JSON.stringify(bins));

console.log('\n■ ①と②の重なり');
const both = rows.filter((r) => r.ev.exam && r.ev.exam.asAnswer > 0 && r.tool > 0).length;
const onlyA = rows.filter((r) => r.ev.exam && r.ev.exam.asAnswer > 0 && !r.tool).length;
const onlyB = rows.filter((r) => (!r.ev.exam || !(r.ev.exam.asAnswer > 0)) && r.tool > 0).length;
const none = rows.filter((r) => (!r.ev.exam || !(r.ev.exam.asAnswer > 0)) && !r.tool).length;
console.log(`   ①も②もある ${both} / ①だけ ${onlyA} / ②だけ ${onlyB} / どちらも無い ${none}`);
console.log('   ⚠ 「どちらも無い」は「優先度が低い」ではない（§7-3）。判定が付いたコードは 274 中 50 だけ');

console.log('\n■ ①が多い順（上位15）');
judged.sort((a, b) => (b.ev.exam.asAnswer - a.ev.exam.asAnswer) || (b.tool - a.tool)).slice(0, 15)
    .forEach((r) => console.log(`   ①${String(r.ev.exam.asAnswer).padStart(2)}  ②${String(r.tool).padStart(3)}  Lv${r.next}  ${r.it.code}`));
console.log('\n■ ②が多い順（上位15）');
[...withTool].sort((a, b) => b.tool - a.tool).slice(0, 15)
    .forEach((r) => console.log(`   ②${String(r.tool).padStart(3)}  ①${r.ev.exam && r.ev.exam.asAnswer !== undefined ? String(r.ev.exam.asAnswer).padStart(2) : '未'}  Lv${r.next}  ${r.it.code}`));

if (process.argv.includes('--changes')) {
    console.log('\n■ difficulty が動く項目（根拠つき）');
    rows.filter((r) => r.cur !== r.next)
        .sort((a, b) => (a.cur - a.next) - (b.cur - b.next) || a.it.code.localeCompare(b.it.code))
        .forEach((r) => console.log(`   Lv${r.cur}→${r.next}  ${r.it.code.padEnd(34)} 教科書:${r.scope}${r.weak ? '(弱)' : ''} / セミナー:${r.sem}`));
}

if (!process.argv.includes('--write')) { console.log('\n（--write で questions.json に入れる。priority はまだ入れない）'); process.exit(0); }

rows.forEach((r) => { r.it.evidence = r.ev; r.it.difficulty = r.next; });
fs.writeFileSync(Q_PATH, JSON.stringify(Q, null, 2) + '\n');
console.log(`\n→ questions.json に evidence を入れ、difficulty を ${rows.filter((r) => r.cur !== r.next).length} 件更新した`);
