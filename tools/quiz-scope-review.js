/**
 * 名簿115件を**人が目で通して ○× を付けるための一覧**（C2・2026-08-25）
 *
 *   node tools/quiz-scope-review.js              … 表で出す（既定）
 *   node tools/quiz-scope-review.js --todo       … 未検分だけ
 *   node tools/quiz-scope-review.js --flagged    … 目印の付いた8件だけ
 *   node tools/quiz-scope-review.js --tsv        … 表計算に貼れる形（タブ区切り）
 *   node tools/quiz-scope-review.js --jsonl      … quiz-scope.json の survey に**貼れる行**を出す
 *
 * ⚠⚠ **「教科書に載っているか」を判定するのはユーザー。** この道具は判定しない。
 *    出すのは「判定に要る材料」だけ ——
 *    分野・現在の範囲・出どころ（この行を消したら本当に落ちるのか）・図の大きさ・検分の記録。
 *
 * ★ **いちばん効く欄は「出どころ」**。名簿の行には2種類ある:
 *    「名簿だけ」… この行を消すと範囲『教科書』から**実際に落ちる** ＝ ○× に意味がある
 *    「お題と同じ構造」… 別名でお題に載っているので、**行を消しても落ちない** ＝ 行のほうが要らない
 *    区別しないと、消しても何も起きない行に時間を使うことになる。
 *
 * 書き込み先は `assembler/quiz-scope.json` の `survey`（1行1件・末尾に追記のみ・書き戻し禁止）。
 * `verdict` に ○ か × 、`seen` に**どの教科書で見たか**を書く。
 * ⚠ `×` を書くと実際にプールから落ちる（quiz.js の `applyQuizTraits`）。空欄は今までどおり残る。
 *
 * 終了コードは 0。ただし survey に textbook に無い名前があれば 1（打ち間違いは事故なので）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, n), 'utf8'));

// **`window` はサンドボックス自身にする**（理由は tools/quiz-scope-census.js の同じ場所）
const sandbox = { performance: { now: () => 0 }, console };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
ctx.STAGES = load('stages.json');
ctx.COMPOUNDS = load('compounds.json');
ctx.QUIZ_SCOPE = load('quiz-scope.json');
vm.runInContext(fs.readFileSync(path.join(ROOT, 'quiz.js'), 'utf8'), ctx);
const W = ctx.window;

const game = {
    createTargetFromData(stage) {
        const m = new W.Molecule();
        if (!stage || !stage.target) return m;
        const added = stage.target.atoms.map(a => m.addAtom(a.element, a.x, a.y));
        stage.target.bonds.forEach(b => {
            const p = added[b.atom1Index], q = added[b.atom2Index];
            if (p && q) m.addBond(p.id, q.id, b.type);
        });
        return m;
    },
    computeMolecularFormula(mol) {
        const cnt = {};
        mol.atoms.forEach(a => { cnt[a.element] = (cnt[a.element] || 0) + 1; });
        let h = cnt.H || 0;
        mol.atoms.forEach(a => { if (a.element !== 'H') h += Math.max(0, mol.getFreeValency(a.id)); });
        cnt.H = h;
        const order = ['C', 'H', ...Object.keys(cnt).filter(e => e !== 'C' && e !== 'H').sort()];
        return order.filter(e => cnt[e]).map(e => e + (cnt[e] > 1 ? cnt[e] : '')).join('');
    }
};

const lib = W.buildCompoundLibrary(game);
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);

const SCOPE = ctx.QUIZ_SCOPE;
const listed = SCOPE.textbook || [];
const survey = {};
(SCOPE.survey || []).forEach(r => { if (r && r.name) survey[r.name] = r; });

// お題（stages.json）の正準コード。名簿の行が「お題と同じ構造」かを見るのに使う。
// ⚠ **名前ではなく構造で照合する**（別名で登録されていても取りこぼさない。
//   applyQuizTraits が同じ照合をしているので、ここも同じ物差しでなければ答えがずれる）
const stageCodes = new Set();
for (let i = 0; i < ctx.STAGES.length; i++) {
    if (lib[i] && lib[i].mol.atoms.length) stageCodes.add(W.canonicalCode(lib[i].mol));
}
const byName = {};
lib.forEach(e => { if (!byName[e.name]) byName[e.name] = e; });

const rows = listed.map((name, i) => {
    const e = byName[name] || null;
    const code = e && e.mol.atoms.length ? W.canonicalCode(e.mol) : null;
    const fromStage = !!(code && stageCodes.has(code));
    const s = survey[name] || {};
    return {
        no: i + 1,
        name,
        field: e ? e.field : '（ライブラリに無い）',
        formula: e ? e.formula : '-',
        chain: e ? e.chainOutsideRing : 0,
        groups: e ? (e.groups || []).join('・') : '',
        // ★ この行を消したら本当に落ちるか
        origin: fromStage ? 'お題と同じ構造（行を消しても落ちない）' : '名簿だけ（消すと落ちる）',
        verdict: String(s.verdict || '').trim(),
        seen: String(s.seen || '').trim(),
        flag: String(s.flag || '').trim()
    };
});

let view = rows;
if (has('todo')) view = rows.filter(r => !r.verdict);
if (has('flagged')) view = rows.filter(r => r.flag);

if (has('jsonl')) {
    // quiz-scope.json の survey に**そのまま貼れる**行（末尾に追記する用）。
    // すでに survey にある名前は出さない（重複を作らないため）
    view.filter(r => !survey[r.name]).forEach(r => {
        console.log(JSON.stringify({ name: r.name, verdict: '', seen: '' }, null, 0) + ',');
    });
    process.exit(0);
}

if (has('tsv')) {
    console.log(['No', '名前', '分野', '分子式', '官能基・骨格', '出どころ', '検分', 'どの教科書で見たか', '目印'].join('\t'));
    view.forEach(r => console.log([r.no, r.name, r.field, r.formula, r.groups,
        r.origin, r.verdict || '未', r.seen, r.flag ? '⚠' : ''].join('\t')));
    process.exit(0);
}

// --- 表 ---
const w = (s, n) => {
    // 全角を2幅で数える（そろえないと日本語の表が崩れて読めない）
    const width = (t) => [...String(t)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
    let out = String(s);
    while (width(out) < n) out += ' ';
    return out;
};

console.log(`名簿 ${listed.length} 件 ／ 検分ずみ ${rows.filter(r => r.verdict).length} 件 ／ 未検分 ${rows.filter(r => !r.verdict).length} 件`);
console.log('⚠ 教科書に載っているかを判定するのはユーザーです。この一覧は材料を並べるだけで、判定はしません。');
console.log('  書き込み先: assembler/quiz-scope.json の "survey"（1行1件・末尾に追記のみ）。');
console.log('  verdict に ○（残す）／ ×（外す）、seen に**どの教科書で見たか**。× は実際にプールから落ちます。');
console.log(`  貼れる行を出す: node tools/quiz-scope-review.js --todo --jsonl\n`);

console.log('  ' + w('No', 5) + w('印', 4) + w('名前', 40) + w('分野', 18) + w('出どころ', 34) + w('検分', 6) + 'どの教科書で見たか');
console.log('  ' + '-'.repeat(124));
view.forEach(r => {
    console.log('  ' + w(r.no, 5) + w(r.flag ? '⚠' : '', 4) + w(r.name, 40) + w(r.field, 18) +
        w(r.origin, 34) + w(r.verdict || '未', 6) + r.seen);
});

const redundant = rows.filter(r => r.origin.startsWith('お題'));
if (redundant.length) {
    console.log(`\n⚠ 「お題と同じ構造」が ${redundant.length} 件あります（この行は消しても範囲は変わりません）:`);
    console.log('  ' + redundant.map(r => r.name).join(' / '));
}
const flagged = rows.filter(r => r.flag);
if (flagged.length) {
    console.log(`\n⚠ 目印の付いた ${flagged.length} 件（前レーンが「教科書から外れて見える」とした。**判定ではありません**）:`);
    console.log('  ' + flagged.map(r => `${r.name}[${r.verdict || '未'}]`).join(' / '));
}
const rejected = [...W.quizScopeRejectedNames()];
console.log(`\n検分で × が付いて範囲「教科書」から外れているもの: ${rejected.length} 件` +
    (rejected.length ? '\n  ' + rejected.join(' / ') : ''));

// survey に textbook へ無い名前があれば事故（打ち間違い）
const stray = Object.keys(survey).filter(n => !listed.includes(n));
if (stray.length) {
    console.log(`\n❌ survey にあるのに textbook に無い名前 ${stray.length} 件: ${stray.join(' / ')}`);
    process.exit(1);
}
process.exit(0);
