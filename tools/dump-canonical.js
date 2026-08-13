/**
 * `canonicalCode` / `iupacName` を stages.json ＋ compounds.json の全件について書き出す。
 *
 *   node tools/dump-canonical.js > before.txt
 *
 * WL 精緻化の一本化（v1365）のように「同値関係には触っていない」ことを示すための道具。
 * 変更の前後でこれを走らせ、**diff が 0行**であることを見せる（v550・N1 と同じやり方）。
 * 立体レイヤ（canonicalStereoCode）も併せて出す ── 同じ基礎グラフ構成を共有するため。
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
    const ids = target.atoms.map(a => mol.addAtom(a.element, a.x, a.y).id);
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

const rows = [];
const files = [['stages', 'stages.json'], ['compounds', 'compounds.json']];
files.forEach(([tag, file]) => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    list.forEach((e, i) => {
        if (!e.target || !e.target.atoms) return;
        const { mol, ids } = build(e.target);
        let code = '', name = '', scode = '';
        try { code = W.canonicalCode(mol); } catch (err) { code = 'ERR:' + err.message; }
        try { name = W.iupacName(mol) || ''; } catch (err) { name = 'ERR:' + err.message; }
        try {
            const s = stereoArgs(e, ids);
            scode = W.canonicalStereoCode(mol, s.atomParity, s.bondGeo);
        } catch (err) { scode = 'ERR:' + err.message; }
        rows.push([tag, i, e.id, code, name, scode].join('\t'));
    });
});
process.stdout.write(rows.join('\n') + '\n');
