/**
 * クイズの「官能基・骨格の軸」（E1）を数える（Node で実行。ブラウザ不要）
 *
 *   node tools/quiz-group-census.js
 *   node tools/quiz-group-census.js --group=alkane            … その値の全件を出す
 *   node tools/quiz-group-census.js --group=ester --scope=basic --field=芳香族
 *
 * ねらい:
 *   `?group=` を張る前に「**その値で何件残るか**」を数えられるようにする。
 *   数えないまま qa 側にリンクを足すと、着地して初めて 0 件と分かる。
 *
 * ⚠ **分類の定義は `assembler/quiz.js` の `compoundGroupsOf` に1つだけ置き、
 *   ここはそれを読んで数えるだけ**（`tools/quiz-scope-census.js` と同じ流儀。
 *   規則を書き写すと、直したときに数字と画面が黙ってずれる）。
 *
 * 終了コードは 0（計測）。ただし `--group=` に知らない値を渡したときだけ 1 を返す。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, n), 'utf8'));

// **`window` はサンドボックス自身にする**（`window: {}` にしてはいけない）。
// 理由は tools/quiz-scope-census.js の同じ場所に書いてある（環の判定が黙って空になる）
const sandbox = { performance: { now: () => 0 }, console };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
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

const wantGroup = argOf('group');
const scope = argOf('scope') || 'named';
const field = argOf('field') || 'all';

console.log(`出題プール ${lib.length} 件（stages.json ${ctx.STAGES.length} ＋ compounds.json ${ctx.COMPOUNDS.length}）`);
console.log(`絞り込みの前提: 範囲=${scope} ／ 分野=${field} ／ 図の長さの上限=${W.QUIZ_CHAIN_MAX}`);

/** `?group=` を効かせた状態で件数を数える（実際の出題と同じ関数を通す） */
function countWith(group, sc, fl) {
    W.QUIZ_GROUP_OVERRIDE = group || '';
    const hit = lib.filter(e => W.entryInQuizScope(e, sc, fl));
    W.QUIZ_GROUP_OVERRIDE = '';
    return hit;
}

console.log('\n=== ① 値ごとの件数（左: プール全体 ／ 右: 上の前提で絞ったあと） ===');
console.log('  ' + '値'.padEnd(14) + 'ラベル'.padEnd(24) + '全体'.padStart(6) + '  絞り込み後');
W.QUIZ_GROUPS.forEach(g => {
    const all = lib.filter(e => (e.groups || []).includes(g.value)).length;
    const narrowed = countWith(g.value, scope, field).length;
    const mark = g.kind === 'skeleton' ? '骨格' : '官能基';
    console.log(`  ${g.value.padEnd(14)}${(g.label + `[${mark}]`).padEnd(24)}${String(all).padStart(6)}${String(narrowed).padStart(12)}`);
});

console.log('\n=== ② どの値にも入らなかったもの（分類器の外れ） ===');
const none = lib.filter(e => !(e.groups || []).length);
console.log(`  ${none.length} 件（${((lib.length - none.length) / lib.length * 100).toFixed(1)}% は分類できた）`);
if (none.length) console.log('    ' + none.slice(0, 40).map(e => e.name).join(' / ') +
    (none.length > 40 ? ` …ほか ${none.length - 40} 件` : ''));

if (wantGroup) {
    const known = W.QUIZ_GROUPS.some(g => g.value === wantGroup);
    if (!known) {
        console.log(`\n⚠ 知らない値「${wantGroup}」（使えるのは ${W.QUIZ_GROUPS.map(g => g.value).join(' / ')}）`);
        process.exit(1);
    }
    const hit = countWith(wantGroup, scope, field);
    console.log(`\n--- group=${wantGroup} ／ scope=${scope} ／ field=${field} の全 ${hit.length} 件 ---`);
    console.log(hit.map(e => e.name).join(' / '));
}

process.exit(0);
