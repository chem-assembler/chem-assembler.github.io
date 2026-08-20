/**
 * クイズの題材を「図の大きさ」で並べる（Node で実行。ブラウザ不要）
 *
 *   node tools/quiz-size-census.js                  … 境目（重原子12〜22）を並べる
 *   node tools/quiz-size-census.js --min=10 --max=30
 *   node tools/quiz-size-census.js --level=1        … そのレベルだけ（既定は 1＝教科書）
 *   node tools/quiz-size-census.js --level=all
 *   node tools/quiz-size-census.js --compare        … C14 前後の鎖式と、同じ大きさの芳香族を並べる
 *   node tools/quiz-size-census.js --dropped        … **いま実際に外れているもの**（v1435 の上限）
 *   node tools/quiz-size-census.js --esters         … 二価以上のエステルが巻き添えになっていないか
 *
 * **なぜ要るか**（ORDER_quiz_2026-08-20.md §3・ユーザー検品）:
 * 「ステアリン酸などは題材としてあまり適していない」に対して、
 * ユーザーの返事は「**問題を見ながら検討したい。C14の鎖式炭化水素はかなり複雑に感じるが、
 * 芳香族ならばそこまで複雑ではない**」。
 * ＝ **重原子数だけでは測れない**という指摘なので、
 * 数字の表ではなく「**この分子が出たら難しすぎるか**」を人が見て決められる形で並べる。
 *
 * **2026-08-21・上限が入った（v1435）。** ユーザーの決定は
 * 「**鎖10で油脂以外は問題ないかと思います**」「**クイズでは区切ってよい**」。
 * 物差しは「環の外の最長鎖」で、**クイズの出題プールにだけ**効く（`assembler/quiz.js` の
 * `QUIZ_CHAIN_MAX`）。`--dropped` / `--esters` が、いま外れているものを数え直す口。
 *
 * ⚠ サンドボックスの作り方は tools/quiz-scope-census.js と同じ（`window` は
 * サンドボックス自身にすること。`window: {}` にすると環の判定が黙って空になる）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, n), 'utf8'));

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

const argv = process.argv.slice(2);
const argOf = (n, d) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : d;
};
const has = (n) => argv.includes(`--${n}`);

/**
 * 骨格の別（芳香族 → 環式 → 鎖式）。
 * ⚠ 分野（compoundFieldOf）とは別の軸。分野は「教科書の章」に近い分け方で、
 * こちらは**図の読みにくさ**を決める骨格の形。
 */
function skeletonOf(mol) {
    const ring = W.ringAtomIds(mol);
    if (W.findAromaticBondKeys(mol).size > 0) return '芳香族';
    if (ring.size > 0) return '環式';
    return '鎖式';
}

/** 環の数（独立した環の数＝結合数 − 原子数 + 連結成分数。重原子だけで数える） */
function ringCount(mol) {
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    const ids = new Set(heavy.map(a => a.id));
    const bonds = mol.bonds.filter(b => ids.has(b.atomId1) && ids.has(b.atomId2));
    // 連結成分の数
    const seen = new Set();
    let comps = 0;
    heavy.forEach(a => {
        if (seen.has(a.id)) return;
        comps++;
        const stack = [a.id];
        while (stack.length) {
            const id = stack.pop();
            if (seen.has(id)) continue;
            seen.add(id);
            bonds.forEach(b => {
                if (b.atomId1 === id && !seen.has(b.atomId2)) stack.push(b.atomId2);
                if (b.atomId2 === id && !seen.has(b.atomId1)) stack.push(b.atomId1);
            });
        }
    });
    return bonds.length - heavy.length + comps;
}

/**
 * 環に入っていない炭素の、いちばん長い連なり（＝目で追う「直鎖」の長さ）。
 *
 * ⚠ **本体は `assembler/quiz.js` の `longestChainOutsideRing`**（v1435 で上限の物差しに
 * 昇格したので、ここに写しを持たない）。写しを置くと、実装を直したときに
 * **この census だけ古い数字を出し続ける**——発注書の表が実装と食い違う形になる。
 */
const longestChainOutsideRing = W.longestChainOutsideRing;

const lib = W.buildCompoundLibrary(game);
// 同じ名前の重複登録（別表記）は1件に畳む
const seen = new Set();
const rows = [];
lib.forEach(e => {
    if (seen.has(e.name) || !e.mol.atoms.length) return;
    seen.add(e.name);
    const heavy = e.mol.atoms.filter(a => a.element !== 'H').length;
    rows.push({
        name: e.name, heavy, formula: e.formula, level: e.scopeLevel, field: e.field,
        skel: skeletonOf(e.mol), rings: ringCount(e.mol), chain: longestChainOutsideRing(e.mol),
        // エステル結合の数（ユーザーが名指しで心配した「入試の2価以上のエステル」を数える）
        esters: W.findFunctionalGroups(e.mol).filter(g => g.type === 'ester').length
    });
});
rows.sort((a, b) => a.heavy - b.heavy || a.name.localeCompare(b.name, 'ja'));

const levelArg = argOf('level', '1');
const inLevel = (r) => levelArg === 'all' || r.level <= Number(levelArg);
const min = Number(argOf('min', 12)), max = Number(argOf('max', 22));

const fmt = (r) =>
    `  ${String(r.heavy).padStart(3)}  ${r.skel.padEnd(4)} 環${r.rings}  鎖${String(r.chain).padStart(2)}  ` +
    `${r.formula.padEnd(12)} L${r.level}  ${r.name}`;

if (has('dropped')) {
    /* ⚠ **v1435 で実際に入った上限（QUIZ_CHAIN_MAX）で、何が出題プールから外れているか。**
       「切った分が黙って消える」ことをこのリポジトリは禁じているので、
       **誰でもいつでも数え直せる形**をここに置く。画面（出題件数の行）にも件数は出る。 */
    const CAP = W.QUIZ_CHAIN_MAX;
    console.log(`=== クイズの出題プールから外れているもの（環の外の最長鎖 > ${CAP}） ===`);
    console.log('  ⚠ 効くのはクイズだけ。名称呼び出し・書き出し練習・名称ライブラリ・お題は素通り\n');
    [1, 2, 3].forEach(L => {
        const inL = rows.filter(r => r.level <= L);
        const out = inL.filter(r => r.chain > CAP);
        const arom = out.filter(r => r.skel === '芳香族');
        console.log(`  レベル≦${L}: プール ${String(inL.length).padStart(4)} 件 → 外れる ` +
            `${String(out.length).padStart(2)} 件（残り ${inL.length - out.length}）／ うち芳香族 ${arom.length} 件`);
    });
    console.log('\n  --- 外れるもの 全件（レベル3＝すべて） ---');
    console.log('  鎖N  重原子 骨格   エステル L 名前');
    rows.filter(r => r.chain > CAP).sort((a, b) => a.chain - b.chain || a.name.localeCompare(b.name, 'ja'))
        .forEach(r => console.log(`  鎖${String(r.chain).padStart(2)}  ${String(r.heavy).padStart(3)}  ` +
            `${r.skel.padEnd(4)} ×${r.esters}  L${r.level}  ${r.name}`));
} else if (has('esters')) {
    /* ⚠ ユーザーが名指しで心配したところ:「**引っかかるとすれば、入試の2価以上のエステルです**」。
       上限が二価以上のエステルを巻き添えにしていないかを、実データで数える。 */
    const CAP = W.QUIZ_CHAIN_MAX;
    const multi = rows.filter(r => r.esters >= 2).sort((a, b) => b.chain - a.chain);
    console.log(`=== エステル結合を2つ以上もつ化合物: ${multi.length} 件（上限は 鎖≦${CAP}） ===\n`);
    console.log('  エステル 鎖N 重原子 L 分子式        名前');
    multi.forEach(r => console.log(`    ×${r.esters}   鎖${String(r.chain).padStart(2)}  ` +
        `${String(r.heavy).padStart(3)}  L${r.level} ${r.formula.padEnd(14)} ${r.name}` +
        (r.chain > CAP ? '   ← 外れる' : '')));
    const out = multi.filter(r => r.chain > CAP);
    console.log(`\n  上限で外れる二価以上のエステル: ${out.length} 件` +
        (out.length ? `（${out.map(r => r.name.split('（')[0]).join('・')}）` : ''));
    const kept = multi.filter(r => r.chain <= CAP);
    console.log(`  残る ${kept.length} 件の鎖の最大値: ${Math.max(0, ...kept.map(r => r.chain))}` +
        `（上限 ${CAP} まで ${CAP - Math.max(0, ...kept.map(r => r.chain))} の余裕）`);
} else if (has('cuts')) {
    /* 上限を引いたら何が外れるか（**どこで切るかを決めるための材料**。
       ⚠ これは「もし切ったら」の表で、**いま実際に効いている上限は `--dropped`** のほう。
       v1435 で 鎖≦10 が入った後も、線を引き直したくなったときのために残してある）。
       2つの物差しを並べる:
         ・重原子数            … 図全体の大きさ
         ・環の外の最長鎖（鎖N）… 「一直線に数えさせられる長さ」 */
    console.log(`=== 上限を引いたときに外れる件数（レベル ${levelArg}） ===\n`);
    const target = rows.filter(inLevel);
    console.log('  --- 物差しA: 重原子数 ---');
    [12, 13, 14, 15, 16, 18, 20].forEach(cut => {
        const out = target.filter(r => r.heavy > cut);
        const arom = out.filter(r => r.skel === '芳香族');
        console.log(`   ≦${String(cut).padStart(2)} で外れる ${String(out.length).padStart(3)} 件` +
            `（うち芳香族 ${arom.length} 件: ${arom.slice(0, 6).map(r => r.name).join('・') || '—'}）`);
    });
    console.log('\n  --- 物差しB: 環の外の最長鎖 ---');
    [6, 8, 10, 12, 14].forEach(cut => {
        const out = target.filter(r => r.chain > cut);
        const arom = out.filter(r => r.skel === '芳香族');
        console.log(`   ≦${String(cut).padStart(2)} で外れる ${String(out.length).padStart(3)} 件` +
            `（うち芳香族 ${arom.length} 件: ${arom.slice(0, 6).map(r => r.name).join('・') || '—'}）`);
    });
    console.log('\n  --- 物差しB（鎖≦8）で外れるものの全件 ---');
    target.filter(r => r.chain > 8).forEach(r => console.log(fmt(r)));
} else if (has('compare')) {
    /* ユーザーの対比をそのまま確かめる形:
       「C14の鎖式炭化水素はかなり複雑に感じるが、芳香族ならばそこまで複雑ではない」 */
    console.log('=== C14 前後の鎖式 と、同じ重原子数の芳香族 を並べる ===');
    console.log('（重原子数が同じでも、骨格の形で読みやすさが変わるか を見るための並べ方）\n');
    for (let h = 12; h <= 22; h++) {
        const at = rows.filter(r => r.heavy === h && inLevel(r));
        if (!at.length) continue;
        const chain = at.filter(r => r.skel === '鎖式');
        const arom = at.filter(r => r.skel === '芳香族');
        const ring = at.filter(r => r.skel === '環式');
        console.log(`--- 重原子 ${h} 個 ---`);
        console.log(`  鎖式  (${chain.length}) ${chain.map(r => `${r.name}[鎖${r.chain}]`).join('・') || '—'}`);
        console.log(`  芳香族(${arom.length}) ${arom.map(r => `${r.name}[鎖${r.chain}]`).join('・') || '—'}`);
        if (ring.length) console.log(`  環式  (${ring.length}) ${ring.map(r => r.name).join('・')}`);
        console.log('');
    }
} else {
    console.log(`=== 図の大きさの境目（重原子 ${min}〜${max} 個 ／ レベル ${levelArg}） ===`);
    console.log('  重原子 骨格   環  鎖  分子式        範囲 名前');
    rows.filter(r => inLevel(r) && r.heavy >= min && r.heavy <= max).forEach(r => console.log(fmt(r)));

    console.log(`\n=== 参考: 重原子 ${max} 個より大きいもの（レベル ${levelArg}） ===`);
    rows.filter(r => inLevel(r) && r.heavy > max).forEach(r => console.log(fmt(r)));

    console.log('\n=== 骨格ごとの重原子数の分布（レベル ' + levelArg + '） ===');
    ['鎖式', '環式', '芳香族'].forEach(s => {
        const hs = rows.filter(r => inLevel(r) && r.skel === s).map(r => r.heavy).sort((a, b) => a - b);
        if (!hs.length) return;
        const q = (p) => hs[Math.min(hs.length - 1, Math.floor(hs.length * p))];
        console.log(`  ${s.padEnd(4)} ${String(hs.length).padStart(4)}件  最小 ${hs[0]} / 中央 ${q(0.5)} / 上位1割 ${q(0.9)} / 最大 ${hs[hs.length - 1]}`);
    });
}
