/**
 * クイズの出題プールの分野・範囲を数える（Node で実行。ブラウザ不要）
 *
 *   node tools/quiz-scope-census.js
 *   node tools/quiz-scope-census.js --list=その他      … その分野の名前を全部出す
 *   node tools/quiz-scope-census.js --level=1          … そのレベルの名前を全部出す
 *
 * ねらい:
 *   DESIGN_compound_coverage.md §2 の但し書き
 *   「内訳を数え直すときは、分類器を tools/ に置いて次の人が同じ数字を出せるようにすること」
 *   に従う。**分類の定義は assembler/quiz.js に1つだけ置き、ここはそれを読んで数えるだけ**
 *   （数字と画面が食い違わないようにするため。定義を書き写さない）。
 *
 * 数えるもの:
 *   ① 分野（脂肪族・芳香族・天然有機化合物・高分子・その他）ごとの件数。
 *      **「その他」＝どこにも入らなかったもの**で、これを隠さずに出すのがこの表の要。
 *   ② 範囲（レベル1 教科書 / 2 ＋命名の練習台 / 3 すべて）ごとの件数。
 *   ③ quiz-scope.json の名簿が、ライブラリの名前と実際に一致しているか（打ち間違いの検出）。
 *
 * 終了コードは 0（計測）。ただし ③ で一致しない名前があれば 1 を返す（それは事故なので）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, n), 'utf8'));

// **`window` はサンドボックス自身にする**（`window: {}` にしてはいけない）。
// chemistry.js は `window.ringAtomIds = …` で公開し、quiz.js は素の名前 `ringAtomIds(…)` で
// 呼ぶ。ブラウザでは window ＝ グローバルなので同じものを指すが、`window: {}` だと
// 別物になり、**環の判定が黙って空になって分類の数字が変わる**（実際に一度そうなった:
// その他 4件 と出て、正しくは 37件）
const sandbox = { performance: { now: () => 0 }, console };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
// quiz.js は STAGES / COMPOUNDS / QUIZ_SCOPE をグローバルとして読む（実体は game.js が持つ）。
// ここでは JSON をそのまま置き、game の代わりに最小限のスタブを渡す
ctx.STAGES = load('stages.json');
ctx.COMPOUNDS = load('compounds.json');
ctx.QUIZ_SCOPE = load('quiz-scope.json');
vm.runInContext(fs.readFileSync(path.join(ROOT, 'quiz.js'), 'utf8'), ctx);
const W = ctx.window;

// game.createTargetFromData / computeMolecularFormula の代わり（トポロジーだけ使う）
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
const argOf = (n) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : null;
};

console.log(`出題プール ${lib.length} 件（stages.json ${ctx.STAGES.length} ＋ compounds.json ${ctx.COMPOUNDS.length}）`);

console.log('\n=== ① 分野（大きなくくり・構造から導出） ===');
const byField = {};
lib.forEach(e => { (byField[e.field] = byField[e.field] || []).push(e.name); });
['すべて'].concat(W.QUIZ_FIELDS).forEach(f => {
    if (f === 'すべて') return;
    const n = (byField[f] || []).length;
    const note = f === 'その他' ? '   ← どこにも入らなかったもの' : '';
    console.log(`  ${f.padEnd(10)} ${String(n).padStart(5)} 件${note}`);
});
const unknown = (byField['その他'] || []).length;
console.log(`  （分類できた率 ${((lib.length - unknown) / lib.length * 100).toFixed(1)}%）`);

console.log('\n=== ② 範囲（レベル。「高校で扱うか」は導出できないので名簿で決める） ===');
W.QUIZ_SCOPE_LEVELS.forEach(s => {
    const upto = lib.filter(e => e.scopeLevel <= s.level).length;
    const only = lib.filter(e => e.scopeLevel === s.level).length;
    console.log(`  ${String(s.level)} ${s.label.padEnd(20)} このレベルだけ ${String(only).padStart(5)} 件 ／ 累計 ${String(upto).padStart(5)} 件`);
});

console.log('\n=== ①×② の交差 ===');
console.log('  ' + 'レベル'.padEnd(8) + W.QUIZ_FIELDS.map(f => f.padStart(12)).join(''));
W.QUIZ_SCOPE_LEVELS.forEach(s => {
    const row = W.QUIZ_FIELDS.map(f =>
        String(lib.filter(e => e.scopeLevel <= s.level && e.field === f).length).padStart(12));
    console.log('  ' + `≦${s.level}`.padEnd(8) + row.join(''));
});

console.log('\n=== ③ quiz-scope.json の名簿の照合 ===');
const names = new Set(lib.map(e => e.name));
const listed = (ctx.QUIZ_SCOPE.textbook || []);
const missing = listed.filter(n => !names.has(n));
const stageNames = new Set(ctx.STAGES.map(s => s.name));
const redundant = listed.filter(n => stageNames.has(n));
console.log(`  名簿 ${listed.length} 件 ／ ライブラリに無い名前 ${missing.length} 件 ／ すでにお題にある名前 ${redundant.length} 件`);
if (missing.length) console.log('    無い: ' + missing.join(' / '));
if (redundant.length) console.log('    お題と重複（消してよい）: ' + redundant.join(' / '));

const listField = argOf('list');
if (listField) {
    console.log(`\n--- 分野「${listField}」の全件 ---`);
    console.log((byField[listField] || []).join(' / '));
}
const listLevel = argOf('level');
if (listLevel) {
    console.log(`\n--- レベル ${listLevel} の全件 ---`);
    console.log(lib.filter(e => String(e.scopeLevel) === listLevel).map(e => e.name).join(' / '));
}

process.exit(missing.length ? 1 : 0);
