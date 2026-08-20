/**
 * 「立体が分かれる場所」を数える（Node で実行。ブラウザ不要）
 *
 *   node tools/stereo-point-census.js
 *   node tools/stereo-point-census.js --list=C5H10   … その式の全異性体を1件ずつ出す
 *
 * ねらい:
 *   DESIGN_stereo_point.md §1 の数を、次の人が同じ手で出せるようにする
 *   （DESIGN_compound_coverage.md §2「分類器を tools/ に置く」に従う）。
 *   ⚠ **判定の定義は assembler/chemistry.js に1つだけ置き、ここはそれを読んで数えるだけ**。
 *   stereoUnitsOf / countStereoisomers / mirrorStereo を書き写さない
 *   （数字と画面が食い違わないようにするため）。
 *
 * 数えるもの:
 *   ① StereoCountQuiz の出題プールを「不斉炭素だけ / C=C だけ / 両方」で分ける
 *   ② 書き出し練習のお題候補ごとに、立体が分かれる場所をもつ異性体が何件あるか
 *   ③ 立体異性体まで含めた総数（＝ DESIGN_stereo_point.md の段2 の答え）
 *   ④ 2ⁿ が崩れる（畳み込む）分子と、その理由（メソ体 / それ以外）
 *
 * 終了コードは常に 0（これは計測であって検査ではない）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, n), 'utf8'));

// **`window` はサンドボックス自身にする**（`window: {}` にしてはいけない）。
// 理由は tools/quiz-scope-census.js の同じ場所のコメントを参照（環の判定が黙って空になる）
const sandbox = { performance: { now: () => Date.now() }, console };
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
        const added = stage.target.atoms.map(a => {
            const at = m.addAtom(a.element, a.x, a.y);
            if (a.haworthFace) at.haworthFace = a.haworthFace;
            return at;
        });
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
const argOf = (n) => {
    const hit = argv.find(a => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : null;
};

// ===== ① StereoCountQuiz の出題プール =====
// ⚠ プールの作り方は quiz.js の StereoCountQuiz.build() をなぞる（同じ除外規則を使う）
const lib = W.buildCompoundLibrary(game);
const pool = [];
const seenCode = new Set();
lib.forEach(e => {
    if (W.StereoCountQuiz.isPolymerFragment(e.mol)) return;          // 高分子は出題しない
    const info = W.countStereoisomers(e.mol, W.StereoCountQuiz.UNIT_LIMIT);
    if (info.overflow || info.naive < 2) return;                     // 単位0個・数え切れないものは除く
    const code = W.canonicalCode(e.mol);
    if (seenCode.has(code)) return;                                  // D体/L体などの重複を1つに
    seenCode.add(code);
    pool.push(Object.assign({}, e, info, { code }));
});

const typeOf = (r) => (r.centers > 0 && r.bonds > 0) ? '両方'
    : (r.centers > 0 ? '不斉炭素だけ' : (r.bonds > 0 ? 'C=C だけ' : '場所なし'));

console.log(`=== ① StereoCountQuiz の出題プール ${pool.length} 件 ===`);
['不斉炭素だけ', 'C=C だけ', '両方'].forEach(k => {
    const a = pool.filter(p => typeOf(p) === k);
    const f = a.filter(p => p.folded).length;
    console.log(`  ${k}: ${a.length} 件（${(a.length / pool.length * 100).toFixed(1)}%）／うち畳み込み ${f}`);
});
const byCount = {};
pool.forEach(p => { byCount[p.count] = (byCount[p.count] || 0) + 1; });
console.log('  答えの分布: ' + Object.keys(byCount).map(Number).sort((a, b) => a - b)
    .map(c => `${c}種 ${byCount[c]}`).join(' / '));
const two = byCount[2] || 0;
console.log(`  ⚠ 「2種」だけで ${two} 件（${(two / pool.length * 100).toFixed(1)}%）＝ 2 と答えれば当たる割合`);

// ===== ④ 畳み込みの理由 =====
// メソ体の見分けは chemistry.js の mirrorStereo のコメントどおり
//   canonicalStereoCode(mol, s) === canonicalStereoCode(mol, mirrorStereo(s)) ⇔ その配置はアキラル
// 「畳み込みがある かつ 不斉炭素が1個以上 かつ アキラルな種が1個以上」をメソ体と呼ぶ。
// トリオレイン（不斉0・C=C だけ）はこの条件で正しく外れる
function foldDetail(mol) {
    const u = W.stereoUnitsOf(mol);
    const n = u.centers.length + u.bonds.length;
    if (n === 0) return { kinds: 1, achiral: 1, chiral: 0, reason: null };
    const seen = new Set();
    let achiral = 0, chiral = 0;
    for (let mask = 0; mask < (1 << n); mask++) {
        const atomParity = {}, bondGeo = {};
        u.centers.forEach((id, k) => { atomParity[id] = (mask >> k & 1) ? 1 : -1; });
        u.bonds.forEach(([i, j], k) => {
            bondGeo[`${i}_${j}`] = (mask >> (u.centers.length + k) & 1) ? 'syn' : 'anti';
        });
        const s = { atomParity, bondGeo };
        const c = W.canonicalStereoCode(mol, s);
        if (seen.has(c)) continue;
        seen.add(c);
        if (c === W.canonicalStereoCode(mol, W.mirrorStereo(s))) achiral++; else chiral++;
    }
    const folded = seen.size < (1 << n);
    const reason = !folded ? null
        : (u.centers.length > 0 && achiral > 0 ? 'meso' : 'symmetry');
    return { kinds: seen.size, achiral, chiral, reason };
}

console.log('\n=== ④ 2ⁿ が崩れる分子と、その理由 ===');
pool.filter(p => p.folded).forEach(p => {
    const d = foldDetail(p.mol);
    console.log(`  ${p.name}: 不斉${p.centers}/C=C${p.bonds} 2ⁿ=${p.naive} → ${p.count}` +
        `（鏡像が自分自身 ${d.achiral}・キラル ${d.chiral}）＝ ${d.reason === 'meso' ? 'メソ体' : 'メソ体ではない（回転対称など）'}`);
});

// ===== ②③ 書き出し練習のお題候補 =====
// ⚠ nodeLimit は learn.js の IP_ENUM_LIMIT に合わせる。既定の 600000 のままだと
//   C₆H₁₄・C₆H₁₂ が overflow になり、画面で開ける式が「開かない」と出て食い違う
const IP_ENUM_LIMIT = 4000000;
const FORMULAS = ['C4H10', 'C5H12', 'C3H8O', 'C6H14', 'C4H8', 'C4H10O',
                  'C5H10', 'C5H12O', 'C6H12', 'C5H8', 'C3H6', 'C4H8O'];

function parseFormula(f) {
    const out = [];
    const re = /([A-Z][a-z]?)(\d*)/g;
    let m;
    while ((m = re.exec(f)) !== null) {
        if (!m[1]) continue;
        const n = m[2] ? parseInt(m[2], 10) : 1;
        for (let i = 0; i < n; i++) out.push(m[1]);
    }
    return out;
}
// 重原子グラフの辺数が頂点数以上なら環がある（列挙の出力は連結）
const hasRing = (mol) => mol.bonds.length >= mol.atoms.filter(a => a.element !== 'H').length;

const nameByCode = new Map();
lib.forEach(e => { const c = W.canonicalCode(e.mol); if (!nameByCode.has(c)) nameByCode.set(c, e.name); });
function nameOf(mol) {
    const c = W.canonicalCode(mol);
    if (nameByCode.has(c)) return nameByCode.get(c);
    try { const n = W.iupacName(mol); if (n) return `${n}（IUPAC）`; } catch (e) { /* 名前が出なくても数は数える */ }
    return '(名称なし)';
}

const detail = {};
FORMULAS.forEach(f => {
    const all = parseFormula(f);
    const heavy = all.filter(e => e !== 'H');
    const r = W.enumerateConstitutionalIsomers(heavy, all.length - heavy.length, IP_ENUM_LIMIT);
    if (r.overflow) { detail[f] = null; return; }
    detail[f] = r.isomers.map(mol => {
        const u = W.stereoUnitsOf(mol);
        const info = W.countStereoisomers(mol, 8);
        return { mol, centers: u.centers.length, bonds: u.bonds.length,
                 count: info.count, naive: info.naive, folded: info.folded, ring: hasRing(mol) };
    });
});

function report(title, pick) {
    console.log(`\n=== ${title} ===`);
    console.log('式\t構造\t場所あり\t不斉だけ\tC=Cだけ\t両方\t場所の総数\t立体込み\t畳み込み種');
    FORMULAS.forEach(f => {
        if (!detail[f]) { console.log(`${f}\t（列挙が overflow）`); return; }
        const rows = detail[f].filter(pick);
        if (!rows.length) return;
        const wp = rows.filter(r => r.centers + r.bonds > 0);
        const c = (k) => wp.filter(r => typeOf(r) === k).length;
        console.log([f, rows.length, wp.length, c('不斉炭素だけ'), c('C=C だけ'), c('両方'),
            rows.reduce((s, r) => s + r.centers + r.bonds, 0),
            rows.reduce((s, r) => s + r.count, 0),
            rows.filter(r => r.folded).length].join('\t'));
    });
}
report('② お題候補ぜんぶ（環を含む）', () => true);
report('② お題候補・鎖式に絞ったとき', (r) => !r.ring);

console.log('\n⚠ 「立体込み」が段2の答え（DESIGN_stereo_point.md §5）。「構造」との差が、いま画面に出ていない数。');

const listed = argOf('list');
if (listed) {
    console.log(`\n=== ${listed} の全異性体 ===`);
    if (!detail[listed]) {
        console.log('  そのお題は列挙できない（FORMULAS に無いか overflow）');
    } else {
        detail[listed].forEach((r, i) => {
            const d = r.folded ? foldDetail(r.mol) : null;
            console.log(`  ${String(i + 1).padStart(2)}. [${r.ring ? '環' : '鎖'}] 不斉${r.centers}/C=C${r.bonds}` +
                ` 2ⁿ=${r.naive} → ${r.count}種${d ? `（${d.reason === 'meso' ? 'メソ体' : '回転対称など'}）` : ''}  ${nameOf(r.mol)}`);
        });
    }
}
