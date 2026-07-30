/**
 * compounds.json / stages.json の機械検証（Node で実行。ブラウザ不要）
 *
 *   node tools/verify-compounds.js
 *
 * 化合物データを追加・修正したときに、投入前・コミット前に必ず通すためのツール。
 * chemistry.js を読み込んで実アプリと同じ判定を使うので、ここを通れば
 * 「価標が壊れている」「既存と区別できない」「図が重なっている」事故は防げる。
 *
 * 検査項目:
 *   1. 価標が妥当か（isValencyValid。ニトロ基の N=4 の特例も実アプリと同じ扱い）
 *   2. 重原子どうし・自動水素込みで近すぎる原子が無いか（監査ページと同じ閾値の考え方）
 *   3. 命名の一意性: 「正準コード＋立体コード」が他エントリと衝突していないか（テスト F8 と同じ性質）
 *   4. 立体記述子が読めるか（stereo を持つエントリ／haworthFace を持つエントリ）
 *
 * 終了コード 0 = 合格、1 = 問題あり（内容は標準出力に出す）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// アプリ本体は assembler/ 配下（2026-07-26 の構成変更でルートはハブページになった）
const ROOT = path.resolve(__dirname, '..', 'assembler');
const ctx = vm.createContext({ window: {}, performance: { now: () => 0 } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
const W = ctx.window;

const HEAVY_MIN = 24;  // 重原子どうしの最小距離（px）。これ未満は作図が窮屈
const HYDROGEN_MIN = 11;   // 自動水素を含めた最小距離（px）。これ未満は不合格
const HYDROGEN_WARN = 12;  // 警告どまり（既存データに 11.5px のものがあり、見た目は許容範囲）

function loadJson(name) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

function buildMolecule(target) {
    const m = new W.Molecule();
    const ids = target.atoms.map(a => {
        const atom = m.addAtom(a.element, a.x, a.y);
        if (a.haworthFace === 1 || a.haworthFace === -1) atom.haworthFace = a.haworthFace;
        return atom.id;
    });
    target.bonds.forEach(b => m.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
    return { mol: m, ids };
}

// データの立体記述子（添字キー）を実行時IDへ写像する（game.js の _mapStereoToMol と同じ考え方）
function mapStereo(stereo, mol, ids) {
    const out = { atomParity: {}, bondGeo: {} };
    if (stereo && stereo.atomParity) {
        Object.keys(stereo.atomParity).forEach(k => { out.atomParity[ids[Number(k)]] = stereo.atomParity[k]; });
    }
    if (stereo && stereo.bondGeo) {
        Object.keys(stereo.bondGeo).forEach(k => {
            const [i, j] = k.split('_').map(Number);
            const bond = mol.getBond(ids[i], ids[j]);
            if (bond) out.bondGeo[`${bond.atomId1}_${bond.atomId2}`] = stereo.bondGeo[k];
        });
    }
    return out;
}

function stereoCodeOf(entry) {
    const { mol, ids } = buildMolecule(entry.target);
    const mapped = entry.stereo ? mapStereo(entry.stereo, mol, ids) : { atomParity: {}, bondGeo: {} };
    const fromCoords = {
        ...W.readAtomParityFromFischer(mol),
        ...W.readRingParityFromHaworth(mol)
    };
    const hasStereo = !!entry.stereo || Object.keys(fromCoords).length > 0;
    const atomParity = Object.keys(mapped.atomParity).length ? mapped.atomParity : fromCoords;
    return {
        mol,
        code: W.canonicalCode(mol),
        stereoCode: hasStereo
            ? W.canonicalStereoCode(mol, { atomParity, bondGeo: mapped.bondGeo })
            : null,
        readable: Object.keys(fromCoords).length
    };
}

function minDistances(mol) {
    const heavy = mol.atoms;
    let minHeavy = Infinity;
    for (let i = 0; i < heavy.length; i++) {
        for (let j = i + 1; j < heavy.length; j++) {
            minHeavy = Math.min(minHeavy, Math.hypot(heavy[i].x - heavy[j].x, heavy[i].y - heavy[j].y));
        }
    }
    const points = [...heavy, ...mol.calculateHydrogens()];
    let minAll = Infinity;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
            if (d > 0.5) minAll = Math.min(minAll, d);
        }
    }
    return { minHeavy, minAll };
}

const problems = [];
const warnings = [];
const entries = [
    ...loadJson('stages.json').filter(s => s.target).map(s => ({ name: s.name, target: s.target, source: 'stages.json' })),
    ...loadJson('compounds.json').map(c => ({ name: c.name, target: c.target, stereo: c.stereo, source: 'compounds.json' }))
];

const seen = new Map();
entries.forEach(entry => {
    const where = `${entry.source} / ${entry.name}`;
    let info;
    try {
        info = stereoCodeOf(entry);
    } catch (e) {
        problems.push(`${where}: 分子を構築できません（${e.message}）`);
        return;
    }
    // 1. 価標
    info.mol.atoms.forEach(a => {
        if (!W.isValencyValid(info.mol, a.id)) {
            problems.push(`${where}: ${a.element} の価標が超過しています（(${Math.round(a.x)},${Math.round(a.y)})）`);
        }
    });
    // 2. 近すぎる原子
    const { minHeavy, minAll } = minDistances(info.mol);
    if (minHeavy < HEAVY_MIN) {
        problems.push(`${where}: 重原子どうしが近すぎます（最小 ${minHeavy.toFixed(1)}px < ${HEAVY_MIN}px）`);
    }
    if (minAll < HYDROGEN_MIN) {
        problems.push(`${where}: 自動水素を含めて近すぎます（最小 ${minAll.toFixed(1)}px < ${HYDROGEN_MIN}px）`);
    } else if (minAll < HYDROGEN_WARN) {
        warnings.push(`${where}: 自動水素がやや近い（${minAll.toFixed(1)}px）`);
    }
    // 3. 命名の一意性（正準コード＋立体コード）
    const key = info.code + '|' + (info.stereoCode || '');
    if (seen.has(key) && seen.get(key) !== entry.name) {
        problems.push(`${where}: 「${seen.get(key)}」と区別できません（構造も立体も同一）`);
    } else {
        seen.set(key, entry.name);
    }
    // 4. 硫黄の価数（v283 で文脈依存にした。S=O を持てば6価、なければ2価）。
    //    以前は「S は6価固定なのでチオールは登録できない」という検査だったが、
    //    価数を直したので**検査の前提が古くなった**。いまは「文脈どおりの価数か」を見る。
    //    スルホ基は置換しきって空き0、チオール -SH は水素1つが正しい
    info.mol.atoms.forEach(a => {
        if (a.element !== 'S') return;
        const hasSulfonyl = info.mol.getNeighbors(a.id)
            .some(n => n.type === 2 && n.atom.element === 'O');
        const free = info.mol.getFreeValency(a.id);
        const used = info.mol.getUsedValency(a.id);
        if (hasSulfonyl && used + free !== 6) {
            problems.push(`${where}: S=O を持つ硫黄の価標が ${used + free}（スルホ基は6価）`);
        }
        if (!hasSulfonyl && used + free !== 2) {
            problems.push(`${where}: S=O を持たない硫黄の価標が ${used + free}` +
                `（チオール・チオエーテル・ジスルフィドは2価。6価のままなら余分な水素が描かれます）`);
        }
    });
    // 5. 立体記述子の妥当性
    if (entry.stereo && !info.stereoCode) {
        problems.push(`${where}: stereo が指定されているのに立体コードを作れません`);
    }
    const hasFaceData = entry.target.atoms.some(a => a.haworthFace === 1 || a.haworthFace === -1);
    if (hasFaceData && info.readable === 0) {
        problems.push(`${where}: haworthFace があるのに環の立体を読み取れません（環の構成が非標準の可能性）`);
    }
});

console.log(`検査した化合物: ${entries.length} 件`);
if (warnings.length) {
    console.log(`△ 警告 ${warnings.length} 件（不合格ではない。既存データにも同程度のものがある）:`);
    warnings.forEach(w => console.log('  - ' + w));
}
if (problems.length === 0) {
    console.log('✅ 不合格の問題はありません');
    process.exit(0);
}
console.log(`❌ ${problems.length} 件の問題:`);
problems.forEach(p => console.log('  - ' + p));
process.exit(1);
