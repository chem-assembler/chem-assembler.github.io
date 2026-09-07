/**
 * `canonicalCode` / `iupacName` / 分子式 / 原子ごとの空き価標 / 官能基 を
 * stages.json ＋ compounds.json の全件について書き出す。
 *
 *   node tools/dump-canonical.js > before.txt
 *   （chemistry.js を直す）
 *   node tools/dump-canonical.js > after.txt
 *   diff before.txt after.txt        … **登録済みの分子について 0 行**であること
 *
 * WL 精緻化の一本化（v1365）や電荷の導入（I-3・DESIGN_ion_layer.md §3-3）のように
 * 「土台（`chemistry.js`）を触ったが、登録済みの分子の同値関係・分子式・自動水素には
 * 1文字も触っていない」ことを示すための道具。変更の前後でこれを走らせ、
 * **diff が 0行**であることを見せる（v550・N1 と同じやり方）。
 * 立体レイヤ（canonicalStereoCode）も併せて出す ── 同じ基礎グラフ構成を共有するため。
 *
 * 1件1行・タブ区切り。列は
 *   1 tag（stages / compounds）  2 添字  3 id  4 正準コード  5 IUPAC 名（無ければ空）
 *   6 立体コード  7 分子式（Hill 順・自動水素込み）
 *   8 原子ごとの「元素＋空き価標（＋電荷）」を原子の並び順に `,` でつないだもの
 *   9 価標検査（`isValencyValid` が全原子で真なら ok）  10 官能基の型（ソート済み）
 *
 * ⚠ 列 8 の書き方は `buildHeavyGraph` のラベル（`heavyAtomLabel`）とは**別に**ここで組む
 *   ＝ ラベルの作り方そのものを変えたときにも差分が読める（ラベルを借りると同じ変更が両側に効く）。
 * ⚠ 分子式は `game.js computeMolecularFormula` の写し（あちらは DOM 前提で vm に載らない）。
 *   Hill 順・自動水素込み・電荷の記号は付けない（`D-I6` は未決）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const ctx = vm.createContext({ window: {}, performance: { now: () => Date.now() } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
const W = ctx.window;

function build(target) {
    const mol = new W.Molecule();
    const ids = target.atoms.map(a => {
        const atom = mol.addAtom(a.element, a.x, a.y);
        // 面マークと電荷はデータに直接持つ印（座標に現れない）。落とすと別の分子を測ることになる
        if (a.haworthFace === 1 || a.haworthFace === -1) atom.haworthFace = a.haworthFace;
        if (a.charge) atom.charge = a.charge;
        return atom.id;
    });
    (target.bonds || []).forEach(b => mol.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
    return { mol, ids };
}

// stereo の記述子は保存形（添字キー）なので、実際の原子IDへ読み替える
function stereoArgs(entry, ids) {
    const st = entry.stereo || {};
    const atomParity = {};
    Object.keys(st.atomParity || {}).forEach(k => { atomParity[ids[Number(k)]] = st.atomParity[k]; });
    const bondGeo = {};
    Object.keys(st.bondGeo || {}).forEach(k => {
        const [i, j] = k.split('_').map(Number);
        const a = ids[i], b = ids[j];
        bondGeo[a < b ? `${a}_${b}` : `${b}_${a}`] = st.bondGeo[k];
    });
    return { atomParity, bondGeo };
}

// 分子式（Hill 順・自動水素込み）。`game.js computeMolecularFormula` の写し
// ★ 正味の電荷が 0 でないときだけ右肩の記号を添える（D-I6・2026-09-06 ユーザー決定）。
//   ⚠ 添字は素の数字のまま（この列は diff で読むためのもの）だが、**電荷の記号は付ける**
//   ＝ 次に土台を触る人がこの列を物差しにできるように、game.js と同じ規則を写す
function formulaOf(mol) {
    const counts = {};
    let hCount = 0;
    let charge = 0;
    mol.atoms.forEach(a => {
        counts[a.element] = (counts[a.element] || 0) + 1;
        hCount += mol.getFreeValency(a.id);
        charge += a.charge || 0;
    });
    if (hCount > 0) counts.H = (counts.H || 0) + hCount;
    const order = [];
    if (counts.C) order.push('C');
    if (counts.H) order.push('H');
    Object.keys(counts).filter(e => e !== 'C' && e !== 'H').sort().forEach(e => order.push(e));
    const sup = (n) => String(n).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]).join('');
    const q = charge ? (Math.abs(charge) > 1 ? sup(Math.abs(charge)) : '') + (charge > 0 ? '⁺' : '⁻') : '';
    return order.map(e => counts[e] === 1 ? e : e + counts[e]).join('') + q;
}

// 原子ごとの「元素＋空き価標（＋電荷）」。並びはデータの原子順
function freeValencies(mol) {
    return mol.atoms.map(a => {
        const q = a.charge || 0;
        const qs = q ? (q > 0 ? '+' : '-') + (Math.abs(q) > 1 ? Math.abs(q) : '') : '';
        return `${a.element}${mol.getFreeValency(a.id)}${qs}`;
    }).join(',');
}

const rows = [];
const files = [['stages', 'stages.json'], ['compounds', 'compounds.json']];
files.forEach(([tag, file]) => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    list.forEach((e, i) => {
        if (!e.target || !e.target.atoms) return;
        const { mol, ids } = build(e.target);
        let code = '', name = '', scode = '', formula = '', free = '', valid = '', groups = '';
        try { code = W.canonicalCode(mol); } catch (err) { code = 'ERR:' + err.message; }
        try { name = W.iupacName(mol) || ''; } catch (err) { name = 'ERR:' + err.message; }
        try {
            const s = stereoArgs(e, ids);
            scode = W.canonicalStereoCode(mol, s.atomParity, s.bondGeo);
        } catch (err) { scode = 'ERR:' + err.message; }
        try { formula = formulaOf(mol); } catch (err) { formula = 'ERR:' + err.message; }
        try { free = freeValencies(mol); } catch (err) { free = 'ERR:' + err.message; }
        try {
            valid = mol.atoms.every(a => W.isValencyValid(mol, a.id)) ? 'ok' : 'INVALID';
        } catch (err) { valid = 'ERR:' + err.message; }
        try {
            groups = W.findFunctionalGroups(mol).map(g => g.type).sort().join(',');
        } catch (err) { groups = 'ERR:' + err.message; }
        rows.push([tag, i, e.id, code, name, scode, formula, free, valid, groups].join('\t'));
    });
});
process.stdout.write(rows.join('\n') + '\n');
