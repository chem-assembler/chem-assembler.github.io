/**
 * 「同点の主鎖」を数える（DESIGN_practice_revision.md §8-2 / 発注書 D「先に測ること」）。
 *
 *   node tools/count-mainchain-ties.js            … 要約だけ
 *   node tools/count-mainchain-ties.js --list     … 「本当に違う2本以上」の中身を全部出す
 *   node tools/count-mainchain-ties.js --check    … 手検算（3-メチルペンタン・3-エチルペンタンほか）
 *
 * ============================================================================
 * ★ 何をどう数えるか（次に数え直す人が同じ定義で数えられるように、先に書く）
 * ============================================================================
 *
 * 母数: assembler/stages.json（120件）＋ assembler/compounds.json（939件）＝ 1059件。
 *       同じ分子が両方に出るので、**canonicalCode で重複を畳んだ数**も併せて出す。
 *
 * --- 数え方1: IUPAC 主鎖候補の同点（★ これが画面に効く数） ---
 *
 * `iupacNameDetail` は主鎖候補 `cands` を「-OH 最多 → 多重結合最多 → 最長」で絞り、
 * 残った同点を `named.sort`（OH位置最小 → 多重結合位置最小 → 置換基数最多 →
 * 置換基位置最小 → 辞書順）で1本に決める。**帯を描くのはその1本**。
 * ここで数える「同点」は `cands.length >= 2`、すなわち
 * **`_iupacNameForMainChain` が何回呼ばれたか**。
 *
 * ⚠ 候補の取り出しは**再実装しない**。`vm` コンテキストの
 *   `_iupacNameForMainChain` を包んで、実装が実際に渡してきた鎖をそのまま記録する。
 *   （chemistry.js はトップレベル関数宣言なので、vm のグローバルに乗っており差し替えが効く）
 *
 * --- 数え方2: 原子集合で見るか、順序付きの経路で見るか ---
 *
 * `cands` は `_iupacPath(adj, leaves[i], leaves[j])` を **i<j でだけ**作るので、
 * **両端の入れ替え（番号の向き）は1通りとして数えている** ＝ 原子集合の数。
 * 向きを別と数える「順序付き経路」の数は、炭素2個以上の鎖なら **原子集合の数 × 2**。
 * 向きは `_iupacNameForMainChain` が内部で両方向を評価して選び、
 * その理由を `dirReason`（'ol'|'unsat'|'ene'|'sub'|'alpha'|'tie'）で返す。
 * ★ **本ツールの「N通り」は既定で原子集合の数**。順序付きの数も要約に併記する。
 *
 * --- 数え方3: 最長の炭素鎖（純グラフ。IUPAC の主鎖ではない） ---
 *
 * 発注書の問いは「最長の炭素鎖が複数通り取れる分子」。IUPAC の主鎖は
 * 「最長」より先に -OH と多重結合を見るので、**別物**。両方出す。
 * 純グラフ側は「炭素だけの部分グラフの最長単純パス」＝ 非環式なら葉と葉を結ぶ道なので、
 * 実装（`iupacNameDetail` の `cands` 生成）と同じ葉ペア列挙で全部出す。
 * ⚠ **環を含む分子は数えない**（最長単純パスの全列挙は別問題）。件数は別途出す。
 * 検算として、列挙した最長鎖の中に `findLongestCarbonChain(mol)` の結果が
 * 必ず入っていることを毎件確かめる。
 *
 * --- 「自己同型で移り合うだけ」かの判定 ---
 *
 * ⚠ **新しい同型判定は書かない。** `canonicalRowsCore(n, adj, labels, null, collect)` は
 * 最小行配列を達成する全割当（＝自己同型の個数だけある）を集める仕掛けを既に持っている
 * （`stereoIsomorphismCompare` / `canonicalStereoCode` が使っているのと同じ道具）。
 * 基礎グラフは `buildHeavyGraph`（重原子・自由価標ラベル・芳香族正規化）＝ `canonicalCode` と同一。
 *
 *   P0 = collect[0]（頂点→位置）を固定し、各 Pk について φ(i) = P0⁻¹[Pk[i]] とすると、
 *   φ は分子の自己同型。これを全部作って、候補の原子集合を φ で写して軌道に分ける。
 *
 * 2本の候補が同じ軌道にある ＝ **どちらを選んでも同じ図・同じ名前**（見せる値打ちが無い）。
 * 軌道が2つ以上ある ＝ **本当に違う2本以上**（規則で一方が選ばれる。ここに「なぜ？」が実在する）。
 *
 * --- 数え方4: 「規則が割り切った」件数（★ 測って初めて見えた区分） ---
 *
 * 名前が付く鎖の分子について、次の2つを並べる:
 *   L = 最長炭素鎖（純グラフ）の**軌道**の数
 *   C = IUPAC 主鎖候補（`cands`）の**軌道**の数
 * L>=2 かつ C==1 ＝ **最長鎖は本当に複数あるのに、-OH／多重結合の規則が1本に割り切った**。
 * ここには「なぜこの鎖か」が実在し、しかも**答えが1行で言える**（同点ではない）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const ctx = vm.createContext({ window: {}, performance: { now: () => Date.now() } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
const W = ctx.window;

// ---- 実装が渡してきた主鎖候補をそのまま記録する（再実装しない） ----
const origNameForMainChain = ctx._iupacNameForMainChain;
let capture = null;
ctx._iupacNameForMainChain = function (adj, haloAdj, cbond, chain, ohSet) {
    const r = origNameForMainChain.apply(this, arguments);
    if (capture) capture.push({ chain: chain.slice(), named: r });
    return r;
};

function build(target) {
    const mol = new W.Molecule();
    const ids = target.atoms.map(a => mol.addAtom(a.element, a.x, a.y).id);
    (target.bonds || []).forEach(b => mol.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
    return mol;
}

// ---- 自己同型の全体（既存の canonicalRowsCore の collect をそのまま使う） ----
function automorphismsOf(mol) {
    const { heavy, index, labels, adj } = ctx.buildHeavyGraph(mol);
    const n = heavy.length;
    if (!n) return null;
    const placements = [];
    ctx.canonicalRowsCore(n, adj, labels, null, placements);
    if (!placements.length) return null;
    const P0 = placements[0];
    const posToVertex = new Array(n);
    for (let i = 0; i < n; i++) posToVertex[P0[i]] = i;
    // φ: 重原子 index → 重原子 index
    const maps = placements.map(Pk => {
        const phi = new Array(n);
        for (let i = 0; i < n; i++) phi[i] = posToVertex[Pk[i]];
        return phi;
    });
    return { index, maps, idOf: heavy.map(a => a.id) };
}

// 候補（原子IDの集合）を自己同型の軌道に分ける
function orbitsOfCandidates(mol, chains) {
    const auto = automorphismsOf(mol);
    if (!auto) return null;
    const keyOf = set => [...set].sort().join(',');
    const sets = chains.map(ch => new Set(ch.map(id => auto.index.get(id))));
    const keys = sets.map(keyOf);
    const parent = keys.map((_, i) => i);
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const keyIndex = new Map(keys.map((k, i) => [k, i]));
    for (let i = 0; i < sets.length; i++) {
        for (const phi of auto.maps) {
            const img = keyOf(new Set([...sets[i]].map(v => phi[v])));
            if (keyIndex.has(img)) uni(i, keyIndex.get(img));
        }
    }
    const groups = new Map();
    for (let i = 0; i < sets.length; i++) {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(i);
    }
    return { orbits: [...groups.values()], autoCount: auto.maps.length };
}

// ---- 純グラフの最長炭素鎖を全部（非環式のみ） ----
function longestCarbonChains(mol) {
    if (ctx.findAnyCycle(mol)) return null;         // 環は数えない
    const carbons = mol.atoms.filter(a => a.element === 'C');
    if (!carbons.length) return [];
    if (carbons.length === 1) return [[carbons[0].id]];
    const cset = new Set(carbons.map(a => a.id));
    const adj = new Map(carbons.map(a => [a.id, []]));
    mol.bonds.forEach(b => {
        if (!cset.has(b.atomId1) || !cset.has(b.atomId2)) return;
        adj.get(b.atomId1).push(b.atomId2); adj.get(b.atomId2).push(b.atomId1);
    });
    // 連結成分ごとに（炭素が分かれる分子＝エーテル等）
    const seen = new Set();
    const comps = [];
    for (const a of carbons) {
        if (seen.has(a.id)) continue;
        const q = [a.id]; seen.add(a.id); const comp = [];
        while (q.length) { const x = q.shift(); comp.push(x); adj.get(x).forEach(y => { if (!seen.has(y)) { seen.add(y); q.push(y); } }); }
        comps.push(comp);
    }
    const out = [];
    for (const comp of comps) {
        if (comp.length === 1) { out.push([[comp[0]]]); continue; }
        const leaves = comp.filter(id => adj.get(id).length <= 1);
        const paths = [];
        for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
            paths.push(pathBetween(adj, leaves[i], leaves[j]));
        }
        const best = Math.max(...paths.map(p => p.length));
        out.push(paths.filter(p => p.length === best));
    }
    // 分子全体の「最長」は最も長い成分のもの
    const bestLen = Math.max(...out.map(g => g[0].length));
    return out.filter(g => g[0].length === bestLen).reduce((a, b) => a.concat(b), []);
}
function pathBetween(adj, s, t) {
    const prev = new Map([[s, null]]);
    const q = [s];
    while (q.length) {
        const x = q.shift();
        if (x === t) break;
        adj.get(x).forEach(y => { if (!prev.has(y)) { prev.set(y, x); q.push(y); } });
    }
    const out = [];
    for (let x = t; x !== null && x !== undefined; x = prev.get(x)) out.push(x);
    return out.reverse();
}

// ============================ 集計 ============================
const entries = [];
[['stages', 'stages.json'], ['compounds', 'compounds.json']].forEach(([tag, file]) => {
    JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).forEach(e => {
        if (e.target && e.target.atoms) entries.push({ tag, id: e.id, name: e.name, formula: e.formula, target: e.target });
    });
});

const seenCode = new Set();
const stat = {
    total: entries.length, uniq: 0,
    named: 0, chain: 0, ether: 0, nullName: 0,
    tie: 0, tieOneOrbit: 0, tieMultiOrbit: 0, tieOrdered: 0,
    lcTotal: 0, lcCyclic: 0, lcTie: 0, lcOneOrbit: 0, lcMultiOrbit: 0,
    lcMismatch: 0,
    ruleResolved: 0            // 数え方4: L>=2 かつ C==1
};
const ruleResolvedRows = [];
const multiOrbitRows = [];
const lcMultiOrbitRows = [];

for (const e of entries) {
    const mol = build(e.target);
    let code = '';
    try { code = W.canonicalCode(mol); } catch (err) { code = 'ERR'; }
    if (seenCode.has(code)) continue;   // 同じ分子は1回だけ数える
    seenCode.add(code);
    stat.uniq++;

    // --- 数え方1・2: IUPAC 主鎖候補 ---
    capture = [];
    let detail = null;
    try { detail = W.iupacNameDetail(mol); } catch (err) { detail = null; }
    const cands = capture; capture = null;
    if (!detail) stat.nullName++;
    else {
        stat.named++;
        if (detail.kind === 'ether') stat.ether++; else stat.chain++;
    }
    if (detail && detail.kind === 'chain' && cands.length >= 2) {
        stat.tie++;
        if (cands[0].chain.length >= 2) stat.tieOrdered += cands.length * 2; else stat.tieOrdered += cands.length;
        const r = orbitsOfCandidates(mol, cands.map(c => c.chain));
        if (r && r.orbits.length >= 2) {
            stat.tieMultiOrbit++;
            multiOrbitRows.push({ e, detail, cands, orbits: r.orbits, autoCount: r.autoCount });
        } else stat.tieOneOrbit++;
    }

    // --- 数え方3: 純グラフの最長炭素鎖 ---
    const lc = longestCarbonChains(mol);
    if (lc === null) { stat.lcCyclic++; }
    else if (lc.length) {
        stat.lcTotal++;
        // 検算: findLongestCarbonChain の答えが列挙の中にあること
        try {
            const one = W.findLongestCarbonChain(mol) || [];
            const k = [...one].sort().join(',');
            if (one.length && !lc.some(p => [...p].sort().join(',') === k)) stat.lcMismatch++;
        } catch (err) { /* ignore */ }
        if (lc.length >= 2) {
            stat.lcTie++;
            const r = orbitsOfCandidates(mol, lc);
            if (r && r.orbits.length >= 2) {
                stat.lcMultiOrbit++; lcMultiOrbitRows.push({ e, lc, orbits: r.orbits, detail });
                // 数え方4: 最長鎖は本当に複数あるのに、主鎖候補は1本に絞れた
                if (detail && detail.kind === 'chain' && cands.length === 1) {
                    stat.ruleResolved++;
                    ruleResolvedRows.push({ e, detail, lcOrbits: r.orbits.length, lcLen: lc[0].length, mainLen: detail.mainChain.length });
                }
            } else stat.lcOneOrbit++;
        }
    }
}

// ============================ 出力 ============================
const A = process.argv.slice(2);
const P = s => process.stdout.write(s + '\n');

P('== 母数 ==');
P(`  stages.json + compounds.json の分子   : ${stat.total} 件`);
P(`  canonicalCode で重複を畳んだ数        : ${stat.uniq} 件`);
P(`  iupacNameDetail が名前を返した        : ${stat.named} 件（鎖 ${stat.chain} / エーテル ${stat.ether}）`);
P(`  名前が付かない（対象外）              : ${stat.nullName} 件`);
P('');
P('== 数え方1: IUPAC 主鎖候補の同点（帯を描く1本の候補が複数）==');
P(`  (1) 主鎖候補が複数ある分子            : ${stat.tie} 件  ★ 原子集合で数えた本数`);
P(`      同じ分子を「順序付きの経路」で数えると、その候補は合計 ${stat.tieOrdered} 通り（＝ 原子集合 × 2 方向）`);
P(`  (2) うち 全候補が1つの自己同型軌道    : ${stat.tieOneOrbit} 件  ＝ どれを選んでも同じ図・同じ名前`);
P(`  (3) うち 軌道が2つ以上（本当に違う）  : ${stat.tieMultiOrbit} 件  ★ これが調査の答え`);
P('');
P('== 数え方3: 最長の炭素鎖（純グラフ。IUPAC の主鎖とは別物）==');
P(`  非環式で数えられた分子                : ${stat.lcTotal} 件（環を含むため数えなかった: ${stat.lcCyclic} 件）`);
P(`  (1) 最長鎖が複数通り取れる分子        : ${stat.lcTie} 件`);
P(`  (2) うち 全部が1つの自己同型軌道      : ${stat.lcOneOrbit} 件`);
P(`  (3) うち 軌道が2つ以上                : ${stat.lcMultiOrbit} 件`);
P(`  検算: findLongestCarbonChain の答えが列挙に無かった件数 = ${stat.lcMismatch}（0 であること）`);
P('');
P('== 数え方4: 規則が割り切った件数（最長鎖は本当に複数・IUPAC 主鎖候補は1本）==');
P(`  L>=2 かつ C==1 で名前が付く分子      : ${stat.ruleResolved} 件  ★ 「なぜこの鎖か」に答えがある形`);
ruleResolvedRows.forEach(r => P(`      - ${r.e.name}（${r.e.formula}）名前=${r.detail.name}`
    + ` 最長鎖 ${r.lcLen}炭素 ${r.lcOrbits}軌道 → 主鎖 ${r.mainLen}炭素 1本`));

if (A.includes('--list')) {
    P('');
    P('== 数え方1 (3) の中身（主鎖候補の軌道が2つ以上）==');
    if (!multiOrbitRows.length) P('  （0件）');
    multiOrbitRows.forEach(r => {
        P(`  - ${r.e.name}（${r.e.formula}・${r.e.tag}/${r.e.id}）`);
        P(`      選ばれた名前: ${r.detail.name}   dirReason=${r.detail.dirReason}   自己同型 ${r.autoCount} 個`);
        r.orbits.forEach((o, k) => {
            const names = [...new Set(o.map(i => r.cands[i].named && r.cands[i].named.name))];
            P(`      軌道${k + 1}: 候補 ${o.length} 本 / 名前 ${names.join(' , ')}`);
        });
    });
    P('');
    P('== 数え方3 (3) の中身（最長炭素鎖の軌道が2つ以上）==');
    if (!lcMultiOrbitRows.length) P('  （0件）');
    lcMultiOrbitRows.forEach(r => {
        P(`  - ${r.e.name}（${r.e.formula}・${r.e.tag}/${r.e.id}）鎖長 ${r.lc[0].length} / 候補 ${r.lc.length} 本 / 軌道 ${r.orbits.length} 個`
            + `   名前=${r.detail ? r.detail.name : '(名前なし)'}`);
    });
}

if (A.includes('--enum')) {
    // ★ 書き出し練習の「正解の図」は compounds.json ではなく列挙エンジンが作る。
    //   DESIGN_iupac_check.md §1-1 の「同点 31件」もこの母数（(b) の 169異性体）で測ったもの。
    //   同じ土俵で数え直して、31件がいまも正しいかを見る。
    const SETS = {
        '標準6問（C₄H₁₀/C₅H₁₂/C₃H₈O/C₆H₁₄/C₄H₈/C₄H₁₀O）': [
            [['C', 'C', 'C', 'C'], 10], [['C', 'C', 'C', 'C', 'C'], 12], [['C', 'C', 'C', 'O'], 8],
            [['C', 'C', 'C', 'C', 'C', 'C'], 14], [['C', 'C', 'C', 'C'], 8], [['C', 'C', 'C', 'C', 'O'], 10]
        ],
        '§1-1 (b) の範囲（標準6問＋C₅H₁₂O/C₅H₁₀/C₆H₁₂/C₄H₆/C₅H₁₀O/C₄H₉Cl/C₅H₁₁Cl）': [
            [['C', 'C', 'C', 'C'], 10], [['C', 'C', 'C', 'C', 'C'], 12], [['C', 'C', 'C', 'O'], 8],
            [['C', 'C', 'C', 'C', 'C', 'C'], 14], [['C', 'C', 'C', 'C'], 8], [['C', 'C', 'C', 'C', 'O'], 10],
            [['C', 'C', 'C', 'C', 'C', 'O'], 12], [['C', 'C', 'C', 'C', 'C'], 10], [['C', 'C', 'C', 'C', 'C', 'C'], 12],
            [['C', 'C', 'C', 'C'], 6], [['C', 'C', 'C', 'C', 'C', 'O'], 10],
            [['C', 'C', 'C', 'C', 'Cl'], 9], [['C', 'C', 'C', 'C', 'C', 'Cl'], 11]
        ]
    };
    Object.keys(SETS).forEach(label => {
        const seen = new Set();
        let n = 0, named = 0, chain = 0, tie = 0, one = 0, multi = 0, resolved = 0;
        const rows = [], resRows = [];
        SETS[label].forEach(([els, h]) => {
            const res = W.enumerateConstitutionalIsomers(els, h);
            (res.isomers || []).forEach(mol => {
                const code = W.canonicalCode(mol);
                if (seen.has(code)) return;
                seen.add(code); n++;
                capture = [];
                let d = null;
                try { d = W.iupacNameDetail(mol); } catch (err) { d = null; }
                const cs = capture; capture = null;
                if (!d) return;
                named++;
                if (d.kind !== 'chain') return;
                chain++;
                if (cs.length < 2) {
                    // 数え方4: 最長鎖は複数（2軌道以上）だが、主鎖候補は1本
                    const lc = longestCarbonChains(mol) || [];
                    if (lc.length >= 2) {
                        const rr = orbitsOfCandidates(mol, lc);
                        if (rr && rr.orbits.length >= 2) {
                            resolved++;
                            resRows.push(`      - ${d.name}  最長鎖 ${lc[0].length}炭素 ${rr.orbits.length}軌道 → 主鎖 ${d.mainChain.length}炭素 1本`);
                        }
                    }
                    return;
                }
                tie++;
                const r = orbitsOfCandidates(mol, cs.map(c => c.chain));
                if (r && r.orbits.length >= 2) {
                    multi++;
                    const names = r.orbits.map(o => [...new Set(o.map(i => cs[i].named && cs[i].named.name))].join('/'));
                    rows.push(`      ★ ${d.name}  軌道${r.orbits.length}個: ${names.join('  |  ')}`);
                } else one++;
            });
        });
        P('');
        P(`== 列挙エンジンの母数: ${label} ==`);
        P(`  異性体（重複を畳んだ数）  : ${n}`);
        P(`  名前が付いた / うち鎖     : ${named} / ${chain}`);
        P(`  (1) 主鎖候補が同点        : ${tie} 件`);
        P(`  (2) うち 1軌道（等価）    : ${one} 件`);
        P(`  (3) うち 2軌道以上        : ${multi} 件`);
        rows.forEach(x => P(x));
        P(`  (4) 規則が割り切った      : ${resolved} 件（最長鎖は2軌道以上・主鎖候補は1本）`);
        resRows.forEach(x => P(x));
    });
}

if (A.includes('--check')) {
    P('');
    P('== 手検算（答えが分かっているもので数え方を確かめる）==');
    const mk = spec => {   // spec: [[element, [結合先の添字, 次数], …], …]
        const mol = new W.Molecule();
        const ids = spec.map((s, i) => mol.addAtom(s[0], (i % 8) * 42, Math.floor(i / 8) * 42).id);
        spec.forEach((s, i) => s.slice(1).forEach(([j, t]) => { if (j < i) mol.addBond(ids[i], ids[j], t); }));
        return mol;
    };
    const cases = [
        ['3-メチルペンタン', [['C'], ['C', [0, 1]], ['C', [1, 1]], ['C', [2, 1]], ['C', [3, 1]], ['C', [2, 1]]]],
        ['3-エチルペンタン', [['C'], ['C', [0, 1]], ['C', [1, 1]], ['C', [2, 1]], ['C', [3, 1]], ['C', [2, 1]], ['C', [5, 1]]]],
        ['2-メチルブタン', [['C'], ['C', [0, 1]], ['C', [1, 1]], ['C', [2, 1]], ['C', [1, 1]]]],
        ['3-メチルペンタン-3-オール', [['C'], ['C', [0, 1]], ['C', [1, 1]], ['C', [2, 1]], ['C', [3, 1]], ['C', [2, 1]], ['O', [2, 1]]]],
        ['ペンタン', [['C'], ['C', [0, 1]], ['C', [1, 1]], ['C', [2, 1]], ['C', [3, 1]]]]
    ];
    cases.forEach(([label, spec]) => {
        const mol = mk(spec);
        capture = [];
        const d = W.iupacNameDetail(mol);
        const cs = capture; capture = null;
        const lc = longestCarbonChains(mol) || [];
        let orb = '-';
        if (cs.length >= 2) { const r = orbitsOfCandidates(mol, cs.map(c => c.chain)); orb = r ? r.orbits.length : '?'; }
        P(`  ${label}`);
        P(`      名前 = ${d ? d.name : '(なし)'} / dirReason = ${d ? d.dirReason : '-'}`);
        P(`      主鎖候補（原子集合） = ${cs.length} 通り / 向き込み = ${cs.length * 2} 通り / 軌道 = ${orb}`);
        P(`      最長炭素鎖（純グラフ） = ${lc.length} 通り（長さ ${lc.length ? lc[0].length : '-'}）`);
    });
}
