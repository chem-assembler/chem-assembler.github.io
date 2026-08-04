/**
 * 命名カバレッジの数え上げ（Node で実行。ブラウザ不要）
 *
 *   node tools/coverage-census.js            … 重原子4個まで
 *   node tools/coverage-census.js --max=5    … 重原子5個まで（時間がかかる）
 *   node tools/coverage-census.js --taps     … 「少ない手数で作れる形」の検査だけ
 *   node tools/coverage-census.js --list=c   … (c) の一覧を全部出す（既定は上位のみ）
 *
 * ねらい:
 *   化合物ライブラリの穴を「官能基の分類」からではなく、**利用者が実際に描くもの**から
 *   探す。自由モードで原子を数個並べた人が「名前が出ない」に当たると、そこで手が止まる。
 *   その率を推測ではなく実数で出す。
 *
 * やること:
 *   ① 重原子 N 個以下の分子（C・O・N・Cl・S・Br、結合次数1/2/3、価標を守る、連結、
 *      水素は暗黙）を全部数え上げ、canonicalCode で同型を1つに畳む
 *   ② 4つに仕分ける
 *        (a) ライブラリ（stages.json + compounds.json）で命名できる
 *        (b) iupacName で命名できる
 *        (c) 命名できない・かつ高校範囲内     ← これが穴
 *        (d) 命名できない・範囲外（findOutOfScopeMotifs が立つ）
 *   ③ 「少ない手数で作れる形」（環モジュール1つ＋官能基1〜2個）を同じ方法で仕分ける
 *
 * 判定はすべてトポロジーのみ。座標は使わないので、立体（D/L・α/β・シス/トランス）は
 * この数え上げの対象外——**同じ構造の名前が1つでも出れば (a) とみなす**。
 *
 * 終了コードは常に 0（これは検査ではなく計測）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const ctx = vm.createContext({ window: {}, performance: { now: () => 0 } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
const W = ctx.window;

// ---- 引数 ----------------------------------------------------------------
const argv = process.argv.slice(2);
const argOf = (name, def) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
};
const MAX_HEAVY = Math.min(6, Number(argOf('max', 4)));
const TAPS_ONLY = argv.includes('--taps');
const LIST_ALL = argOf('list', '') === 'c';

// パレットに出ている元素だけ（index.html の .atom-btn と同じ6種）。
// Na は「けん化の生成物としてだけ現れる」ので手では置けない。R は擬似元素
const PALETTE = ['C', 'O', 'N', 'Cl', 'S', 'Br'];
// 数え上げ中の価標の上限。N は 4 まで許して**あとで isValencyValid に落とさせる**
// （ニトロ基 N(=O)(-O)- だけが 4 本を許される特例なので、DFS では判定できない）。
// S も同じ理由で 6 まで許す（S=O が無ければ実際は2価）
const CAP = { C: 4, O: 2, N: 4, Cl: 1, S: 6, Br: 1 };

// ---- ライブラリ ----------------------------------------------------------
function loadJson(name) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

function molFromTarget(target) {
    const m = new W.Molecule();
    const ids = target.atoms.map(a => m.addAtom(a.element, a.x, a.y).id);
    target.bonds.forEach(b => m.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
    return m;
}

// 正準コード → 名前。ライブラリの照合は game.js の _compoundCodeMap と同じく
// canonicalCode で引く（立体は座標が要るのでここでは見ない＝構造が一致すれば命名できる扱い）
const LIB = new Map();
loadJson('stages.json').filter(s => s.target).forEach(s => {
    const code = W.canonicalCode(molFromTarget(s.target));
    if (!LIB.has(code)) LIB.set(code, s.name);
});
loadJson('compounds.json').forEach(c => {
    const code = W.canonicalCode(molFromTarget(c.target));
    if (!LIB.has(code)) LIB.set(code, c.name);
});

// ---- 分子の道具 ----------------------------------------------------------
function buildMol(elements, bonds) {
    const m = new W.Molecule();
    const ids = elements.map(e => m.addAtom(e, 0, 0).id);
    bonds.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
    return m;
}

function allValencyValid(mol) {
    return mol.atoms.every(a => W.isValencyValid(mol, a.id));
}

function hydrogenCount(mol) {
    return mol.atoms.reduce((s, a) => s + Math.max(0, W.maxValencyOf(mol, a.id) - mol.getUsedValency(a.id)), 0);
}

// ヒル式（C → H → 残りをアルファベット順）
function formulaOf(mol) {
    const n = {};
    mol.atoms.forEach(a => { n[a.element] = (n[a.element] || 0) + 1; });
    const h = hydrogenCount(mol);
    if (h) n.H = (n.H || 0) + h;
    const order = ['C', 'H', ...Object.keys(n).filter(e => e !== 'C' && e !== 'H').sort()];
    return order.filter(e => n[e]).map(e => e + (n[e] > 1 ? n[e] : '')).join('');
}

// 読める形にするための簡易 SMILES（正準ではない。人が見て構造を思い出せればよい）
function toSmiles(mol) {
    const atoms = mol.atoms.filter(a => a.element !== 'H');
    if (!atoms.length) return '';
    const idx = new Map(atoms.map((a, i) => [a.id, i]));
    const adj = atoms.map(() => []);
    mol.bonds.forEach(b => {
        const i = idx.get(b.atomId1), j = idx.get(b.atomId2);
        if (i === undefined || j === undefined) return;
        adj[i].push([j, b.type]);
        adj[j].push([i, b.type]);
    });
    const bk = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`);
    const sym = t => (t === 2 ? '=' : t === 3 ? '#' : '');
    const label = a => (a.element.length > 1 ? `[${a.element}]` : a.element);

    // 1回目: 木の辺と閉環の辺を分ける
    const state = atoms.map(() => 0);
    const treeKids = atoms.map(() => []);
    const closures = new Map();  // 頂点 → [[digit, type]…]
    const usedKey = new Set();
    let digit = 0;
    const roots = [];
    const scan = (v, parentKey) => {
        state[v] = 1;
        for (const [u, t] of adj[v]) {
            const key = bk(v, u);
            if (key === parentKey || usedKey.has(key)) continue;
            usedKey.add(key);
            if (state[u] === 0) {
                treeKids[v].push([u, t]);
                scan(u, key);
            } else {
                digit++;
                const d = digit < 10 ? String(digit) : `%${digit}`;
                (closures.get(v) || closures.set(v, []).get(v)).push([d, t]);
                (closures.get(u) || closures.set(u, []).get(u)).push([d, '']);
            }
        }
        state[v] = 2;
    };
    for (let v = 0; v < atoms.length; v++) if (state[v] === 0) { roots.push(v); scan(v, null); }

    // 2回目: 書き出す
    const emit = (v) => {
        let s = label(atoms[v]);
        (closures.get(v) || []).forEach(([d, t]) => { s += (t === '' ? '' : sym(t)) + d; });
        const kids = treeKids[v];
        kids.forEach(([u, t], i) => {
            const branch = sym(t) + emit(u);
            s += (i === kids.length - 1) ? branch : `(${branch})`;
        });
        return s;
    };
    return roots.map(emit).join('.');
}

// 環の大きさの一覧（ひずみ環の注記に使う）。小さい環から順に単純閉路を拾う
function ringSizes(mol) {
    const atoms = mol.atoms;
    const idx = new Map(atoms.map((a, i) => [a.id, i]));
    const adj = atoms.map(() => []);
    mol.bonds.forEach(b => {
        const i = idx.get(b.atomId1), j = idx.get(b.atomId2);
        adj[i].push(j); adj[j].push(i);
    });
    const sizes = new Set();
    // 各辺を外したときの両端間の最短距離 +1 ＝ その辺を含む最小の環
    mol.bonds.forEach(b => {
        const s = idx.get(b.atomId1), g = idx.get(b.atomId2);
        const dist = atoms.map(() => -1);
        dist[s] = 0;
        const q = [s];
        while (q.length) {
            const v = q.shift();
            for (const u of adj[v]) {
                if (v === s && u === g) continue;   // その辺だけ使わない
                if (u === s && v === g) continue;
                if (dist[u] === -1) { dist[u] = dist[v] + 1; q.push(u); }
            }
        }
        if (dist[g] > 0) sizes.add(dist[g] + 1);
    });
    return [...sizes].sort((a, b) => a - b);
}

// (c) のうち「高校ではまず描かない」ものに注記を付ける。**除外はしない**——
// findOutOfScopeMotifs が範囲外の線引きなので、そこを動かすとレーンの持ち物が変わる
function strainNote(mol) {
    const notes = [];
    const rings = ringSizes(mol);
    if (rings.some(r => r <= 4)) notes.push(`${rings.filter(r => r <= 4).join('・')}員環`);
    // 累積二重結合 C=C=C
    const dbl = new Map();
    mol.bonds.forEach(b => {
        if (b.type !== 2) return;
        dbl.set(b.atomId1, (dbl.get(b.atomId1) || 0) + 1);
        dbl.set(b.atomId2, (dbl.get(b.atomId2) || 0) + 1);
    });
    if ([...dbl.values()].some(v => v >= 2)) notes.push('累積二重結合');
    // 環の中の三重結合・環内二重結合が小さい環にある
    const ringIds = new Set();
    if (rings.length) {
        // 環に属する原子（次数の高い連結部分）はここでは厳密に求めず、三重結合が環にあるかだけ見る
        mol.bonds.forEach(b => {
            if (b.type !== 3) return;
            const sub = ringSizes(mol);
            if (sub.length) ringIds.add(1);
        });
    }
    if (ringIds.size && rings.some(r => r <= 7)) notes.push('環内の三重結合');
    return notes.join('／');
}

// ---- ① 数え上げ ----------------------------------------------------------
function* multisets(pool, size) {
    if (size === 0) { yield []; return; }
    for (let i = 0; i < pool.length; i++) {
        for (const rest of multisets(pool.slice(i), size - 1)) yield [pool[i], ...rest];
    }
}

// 与えた重原子の組成から、連結・価標妥当な分子をすべて作って正準コードで畳む
function enumerateFor(elements) {
    const n = elements.length;
    const cap = elements.map(e => CAP[e]);
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    const lastPairOf = new Array(n).fill(-1);
    pairs.forEach(([i, j], k) => { lastPairOf[i] = k; lastPairOf[j] = k; });

    const used = new Array(n).fill(0);
    const deg = new Array(n).fill(0);
    const chosen = [];
    const out = [];
    const seen = new Set();

    const connected = () => {
        const adj = Array.from({ length: n }, () => []);
        chosen.forEach(([i, j]) => { adj[i].push(j); adj[j].push(i); });
        const vis = new Set([0]); const st = [0];
        while (st.length) { const v = st.pop(); adj[v].forEach(u => { if (!vis.has(u)) { vis.add(u); st.push(u); } }); }
        return vis.size === n;
    };

    const record = () => {
        if (n > 1 && !connected()) return;
        const mol = buildMol(elements, chosen);
        if (!allValencyValid(mol)) return;      // S の2価・N の4価特例をここで落とす
        const code = W.canonicalCode(mol);
        if (seen.has(code)) return;
        seen.add(code);
        out.push({ mol, code });
    };

    const dfs = (k) => {
        if (k === pairs.length) { record(); return; }
        const [i, j] = pairs[k];
        const maxType = Math.min(3, cap[i] - used[i], cap[j] - used[j]);
        for (let t = 0; t <= maxType; t++) {
            if (t > 0) { used[i] += t; used[j] += t; deg[i]++; deg[j]++; chosen.push([i, j, t]); }
            let ok = true;
            if (n > 1) {
                if (lastPairOf[i] === k && deg[i] === 0) ok = false;
                if (ok && lastPairOf[j] === k && deg[j] === 0) ok = false;
            }
            if (ok) dfs(k + 1);
            if (t > 0) { used[i] -= t; used[j] -= t; deg[i]--; deg[j]--; chosen.pop(); }
        }
    };
    dfs(0);
    return out;
}

// ---- 範囲外判定の補正 ----------------------------------------------------
// findOutOfScopeMotifs は「異性体列挙の表示を守る」ために作られた関数で、
// **総当たりの数え上げに掛けると2か所ずれる**。どちらも実データで確認済み（下に例）。
// chemistry.js はこのレーンの持ち物ではないので、ここで補正して数え、
// 直す提案は DESIGN_compound_coverage.md に書く。
//
//   補正A（(c) → (d)）: ヘテロ原子どうしの結合の検査が O・N どうしだけを見ている
//     （`isHetero` が O/N 限定）。**S とハロゲンが漏れる**ので、H₂N-SH・H₂N-Cl・
//     HS-SH・H₂N-Br が「範囲内の穴」として残る。許してよいヘテロ間結合は
//     ニトロ基の N-O とスルホ基の S-O だけ
//   補正B（(d) → (c)）: findFunctionalGroups に**ハロゲン化物・スルホン酸・ニトリルの
//     項目が無い**ため、それしか持たない分子が「官能基にあてはまらない」で範囲外に落ちる。
//     クロロシクロヘキサン・シクロヘキサンスルホン酸が消えるのは明らかに行き過ぎ
//     （どちらも2〜3タップで描ける）

// ニトロ基の N（=O と -O を両方持つ）
function nitroNitrogens(mol) {
    const set = new Set();
    mol.atoms.forEach(a => {
        if (a.element !== 'N') return;
        const nb = mol.getNeighbors(a.id).filter(n => n.atom.element !== 'H');
        if (nb.some(n => n.type === 2 && n.atom.element === 'O') &&
            nb.some(n => n.type === 1 && n.atom.element === 'O')) set.add(a.id);
    });
    return set;
}
// スルホニルの S（=O を持つ）
function sulfonylSulfurs(mol) {
    const set = new Set();
    mol.atoms.forEach(a => {
        if (a.element !== 'S') return;
        if (mol.getNeighbors(a.id).some(n => n.type === 2 && n.atom.element === 'O')) set.add(a.id);
    });
    return set;
}

// 補正A: 許されないヘテロ原子どうしの結合があるか
function hasBadHeteroBond(mol) {
    const byId = new Map(mol.atoms.map(a => [a.id, a]));
    const nitro = nitroNitrogens(mol);
    const sulfonyl = sulfonylSulfurs(mol);
    return mol.bonds.some(b => {
        const a1 = byId.get(b.atomId1), a2 = byId.get(b.atomId2);
        if (!a1 || !a2) return false;
        if (a1.element === 'C' || a2.element === 'C' || a1.element === 'H' || a2.element === 'H') return false;
        // ニトロ基の N-O・スルホ基の S-O だけは正しい姿
        const pair = [a1, a2];
        if (pair.some(x => nitro.has(x.id)) && pair.some(x => x.element === 'O')) return false;
        if (pair.some(x => sulfonyl.has(x.id)) && pair.some(x => x.element === 'O')) return false;
        return true;
    });
}

// 補正B: 「官能基にあてはまらない」だけで落ちた分子が、実は高校範囲かを見直す。
// 非炭素の重原子が ハロゲン／スルホ基／ニトリルの N のいずれかで説明しきれれば範囲内
function explainableWithoutGroup(mol) {
    if (!mol.atoms.some(a => a.element === 'C')) return false;   // 炭素が無い分子は対象外
    const sulfonyl = sulfonylSulfurs(mol);
    return mol.atoms.every(a => {
        if (a.element === 'C' || a.element === 'H') return true;
        const nb = mol.getNeighbors(a.id).filter(n => n.atom.element !== 'H');
        if (a.element === 'Cl' || a.element === 'Br') {
            return nb.length === 1 && nb[0].type === 1 && nb[0].atom.element === 'C';
        }
        if (a.element === 'S') {
            // スルホ基 -S(=O)(=O)-O…（残り1本は炭素）
            return sulfonyl.has(a.id) && nb.filter(n => n.atom.element === 'O').length === 3 &&
                nb.some(n => n.atom.element === 'C');
        }
        if (a.element === 'O') {
            return nb.length >= 1 && nb.every(n => n.atom.element === 'C' || sulfonyl.has(n.atom.id));
        }
        if (a.element === 'N') {
            // ニトリル C≡N
            return nb.length === 1 && nb[0].type === 3 && nb[0].atom.element === 'C';
        }
        return false;
    });
}

// iupacName が命名を諦めた理由を、本体と同じ順序で言い当てる（chemistry.js の
// iupacName を読みながら書いた。**穴を埋めるのに命名器を広げるべきか**を測るための道具で、
// 判定そのものには使わない）
function iupacRejectReason(mol) {
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    const HALO = { Cl: 1, Br: 1 };
    if (heavy.some(a => a.element !== 'C' && a.element !== 'O' && !HALO[a.element])) return 'N・S を含む';
    if (!heavy.some(a => a.element === 'C')) return '炭素が無い';
    const carbonIds = new Set(heavy.filter(a => a.element === 'C').map(a => a.id));
    if (mol.bonds.some(b => b.type >= 2 && (!carbonIds.has(b.atomId1) || !carbonIds.has(b.atomId2)))) {
        return 'C=O など炭素以外の多重結合';
    }
    for (const a of heavy) {
        if (!HALO[a.element]) continue;
        const nb = mol.getNeighbors(a.id);
        if (nb.length !== 1 || nb[0].atom.element !== 'C') return 'ハロゲンの付きかたが特殊';
    }
    const oxygens = heavy.filter(a => a.element === 'O');
    const hydroxylC = [];
    let etherCount = 0;
    for (const o of oxygens) {
        const cNb = mol.getNeighbors(o.id).filter(n => n.atom.element === 'C');
        const allNb = mol.getNeighbors(o.id).filter(n => n.atom.element !== 'H');
        if (allNb.length === 1 && cNb.length === 1) hydroxylC.push(cNb[0].atom.id);
        else if (allNb.length === 2 && cNb.length === 2) etherCount++;
        else return '酸素の付きかたが特殊';
    }
    const hasMultiple = mol.bonds.some(b => b.type >= 2 && carbonIds.has(b.atomId1) && carbonIds.has(b.atomId2));
    if (oxygens.length && hasMultiple) return '不飽和アルコール／不飽和エーテル';
    if (hydroxylC.length && etherCount) return '-OH とエーテルの併存';
    if (etherCount > 1) return 'エーテルが2つ以上';
    if (new Set(hydroxylC).size !== hydroxylC.length) return '同じ炭素に -OH が2つ';
    if (W.findAnyCycle(mol)) return '環';
    return 'その他';
}

// 1件を4つに仕分ける。raw は仕様どおり（findOutOfScopeMotifs だけで (d) を決める）、
// bucket は上の補正を掛けたあと
function classify(mol, code) {
    const libName = LIB.get(code);
    if (libName) return { raw: 'a', bucket: 'a', name: libName };
    const iu = W.iupacName(mol);
    if (iu) return { raw: 'b', bucket: 'b', name: iu };
    const motifs = W.findOutOfScopeMotifs(mol);
    const reason = motifs.map(m => m.label).join('／');
    if (!motifs.length) {
        // 仕様では (c)。ヘテロ原子どうしの結合が残っていれば補正Aで (d) へ
        return hasBadHeteroBond(mol)
            ? { raw: 'c', bucket: 'd', reason: 'ヘテロ原子どうしの結合（補正A）', fixed: 'A' }
            : { raw: 'c', bucket: 'c' };
    }
    // 仕様では (d)。「官能基にあてはまらない」だけなら補正Bで (c) へ戻す
    if (motifs.length === 1 && motifs[0].type === 'no_group' &&
        !hasBadHeteroBond(mol) && explainableWithoutGroup(mol)) {
        return { raw: 'd', bucket: 'c', fixed: 'B' };
    }
    return { raw: 'd', bucket: 'd', reason };
}

function runCensus(pool = PALETTE) {
    const rows = [];
    const holes = [];   // 補正後の (c) の全件
    for (let size = 1; size <= MAX_HEAVY; size++) {
        const count = { a: 0, b: 0, c: 0, d: 0 };
        const rawCount = { a: 0, b: 0, c: 0, d: 0 };
        for (const elements of multisets(pool, size)) {
            for (const { mol, code } of enumerateFor(elements)) {
                const r = classify(mol, code);
                count[r.bucket]++;
                rawCount[r.raw]++;
                if (r.bucket === 'c') {
                    const els = [...new Set(mol.atoms.map(a => a.element))];
                    holes.push({
                        size, formula: formulaOf(mol), smiles: toSmiles(mol),
                        groups: W.findFunctionalGroups(mol).map(g => g.type),
                        note: strainNote(mol),
                        elementClass: PALETTE.filter(e => els.includes(e)).join(''),
                        reject: iupacRejectReason(mol)
                    });
                }
            }
        }
        const total = count.a + count.b + count.c + count.d;
        rows.push({ size, ...count, raw: rawCount, total });
        process.stderr.write(`  重原子${size}個 … ${total}件\n`);
    }
    return { rows, holes };
}

// ---- ③ 少ない手数で作れる形 ----------------------------------------------
// 環モジュール（index.html の .mod-btn）。座標は使わないので結合だけ
const RINGS = {
    'ベンゼン環': {
        elements: ['C', 'C', 'C', 'C', 'C', 'C'],
        bonds: [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]],
        // 置換位置の名前（0 を起点にしたときの相対位置）
        sites: { 1: 'オルト', 2: 'メタ', 3: 'パラ' }
    },
    '六員環（シクロヘキサン）': {
        elements: ['C', 'C', 'C', 'C', 'C', 'C'],
        bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1]],
        sites: { 1: '1,2-', 2: '1,3-', 3: '1,4-' }
    },
    '五員環（シクロペンタン）': {
        elements: ['C', 'C', 'C', 'C', 'C'],
        bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 0, 1]],
        sites: { 1: '1,2-', 2: '1,3-' }
    },
    'ハース環（ピラノース）': {
        elements: ['C', 'C', 'C', 'C', 'C', 'O'],
        bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1]],
        sites: {}   // 環内 O があるので位置の呼び名は付けない
    }
};

// 官能基モジュール＋1タップで置ける原子。[元素の並び, 追加の結合（0 が付け根）]
const GROUPS = {
    '-OH': { elements: ['O'], bonds: [] },
    '-COOH': { elements: ['C', 'O', 'O'], bonds: [[0, 1, 2], [0, 2, 1]] },
    '-NH₂': { elements: ['N'], bonds: [] },
    '-NO₂': { elements: ['N', 'O', 'O'], bonds: [[0, 1, 2], [0, 2, 1]] },
    '-SO₃H': { elements: ['S', 'O', 'O', 'O'], bonds: [[0, 1, 2], [0, 2, 2], [0, 3, 1]] },
    '-Cl': { elements: ['Cl'], bonds: [] },
    '-Br': { elements: ['Br'], bonds: [] },
    '-CH₃': { elements: ['C'], bonds: [] }
};

function ringPlusGroups(ring, attachments) {
    const elements = [...ring.elements];
    const bonds = ring.bonds.map(b => [...b]);
    attachments.forEach(({ site, group }) => {
        const g = GROUPS[group];
        const base = elements.length;
        g.elements.forEach(e => elements.push(e));
        bonds.push([site, base, 1]);
        g.bonds.forEach(([i, j, t]) => bonds.push([base + i, base + j, t]));
    });
    const mol = buildMol(elements, bonds);
    return allValencyValid(mol) ? mol : null;
}

function runTaps() {
    const one = [], two = [];
    Object.entries(RINGS).forEach(([ringName, ring]) => {
        // 2タップ: 環1つ＋官能基1つ
        Object.keys(GROUPS).forEach(group => {
            const mol = ringPlusGroups(ring, [{ site: 0, group }]);
            if (!mol) return;
            const r = classify(mol, W.canonicalCode(mol));
            one.push({ label: `${ringName} ＋ ${group}`, formula: formulaOf(mol), smiles: toSmiles(mol), ...r });
        });
        // 3タップ: 環1つ＋官能基2つ（位置ちがい）
        const names = Object.keys(GROUPS);
        Object.entries(ring.sites).forEach(([offset, posName]) => {
            for (let i = 0; i < names.length; i++) {
                for (let j = i; j < names.length; j++) {
                    const mol = ringPlusGroups(ring, [
                        { site: 0, group: names[i] }, { site: Number(offset), group: names[j] }
                    ]);
                    if (!mol) continue;
                    const r = classify(mol, W.canonicalCode(mol));
                    two.push({
                        label: `${ringName} ＋ ${posName}${names[i]}／${names[j]}`,
                        formula: formulaOf(mol), smiles: toSmiles(mol), ...r
                    });
                }
            }
        });
    });
    return { one, two };
}

// ---- 出力 ----------------------------------------------------------------
const pct = (x, t) => (t ? (100 * x / t).toFixed(1) : '0.0');

if (!TAPS_ONLY) {
    process.stderr.write(`数え上げ中（重原子 ${MAX_HEAVY} 個まで・元素 ${PALETTE.join('/')}）…\n`);
    const { rows, holes } = runCensus();
    console.log('');
    console.log('## ① 重原子の数ごとの命名カバレッジ');
    console.log('');
    console.log('| 重原子 | 総数 | (a)ライブラリ | (b)命名器 | (c)穴 | (d)範囲外 | 命名できない率(c/(a+b+c)) |');
    console.log('|---:|---:|---:|---:|---:|---:|---:|');
    const sum = { a: 0, b: 0, c: 0, d: 0, total: 0 };
    const rawSum = { a: 0, b: 0, c: 0, d: 0 };
    rows.forEach(r => {
        const inScope = r.a + r.b + r.c;
        console.log(`| ${r.size} | ${r.total} | ${r.a} | ${r.b} | ${r.c} | ${r.d} | ${pct(r.c, inScope)}% |`);
        ['a', 'b', 'c', 'd', 'total'].forEach(k => { sum[k] += r[k]; });
        ['a', 'b', 'c', 'd'].forEach(k => { rawSum[k] += r.raw[k]; });
    });
    const inScopeAll = sum.a + sum.b + sum.c;
    console.log(`| **計** | **${sum.total}** | **${sum.a}** | **${sum.b}** | **${sum.c}** | **${sum.d}** | **${pct(sum.c, inScopeAll)}%** |`);
    console.log('');
    console.log('補正なし（findOutOfScopeMotifs だけで (d) を決めた場合）の内訳:');
    console.log('');
    console.log('| | (a) | (b) | (c) | (d) |');
    console.log('|---|---:|---:|---:|---:|');
    console.log(`| 仕様どおり | ${rawSum.a} | ${rawSum.b} | ${rawSum.c} | ${rawSum.d} |`);
    console.log(`| 補正後 | ${sum.a} | ${sum.b} | ${sum.c} | ${sum.d} |`);

    // 元素をしぼった数え上げ。全パレットの数字は S・Br だらけの分子に引っぱられるので、
    // 「実際によく描かれる元素だけ」でも同じ計測をして、当たりやすさの見当をつける
    console.log('');
    console.log('## ①b 使える元素をしぼった場合');
    console.log('');
    console.log('| 元素 | 総数 | (a)+(b) 命名できる | (c)穴 | (d)範囲外 | 命名できない率 |');
    console.log('|---|---:|---:|---:|---:|---:|');
    [['C'], ['C', 'O'], ['C', 'O', 'N'], ['C', 'O', 'N', 'Cl'], PALETTE].forEach(pool => {
        const sub = runCensus(pool).rows.reduce((s, r) => {
            ['a', 'b', 'c', 'd', 'total'].forEach(k => { s[k] = (s[k] || 0) + r[k]; });
            return s;
        }, {});
        const named = sub.a + sub.b;
        console.log(`| ${pool.join('・')} | ${sub.total} | ${named} | ${sub.c} | ${sub.d} | ${pct(sub.c, named + sub.c)}% |`);
    });

    // (c) の内訳。どの元素の組み合わせに穴が集中しているかを見る
    console.log('');
    console.log('## ①c (c) の内訳（含む元素 × ひずみ環・累積二重結合の有無）');
    console.log('');
    const cls = new Map();
    holes.forEach(h => {
        const k = h.elementClass;
        if (!cls.has(k)) cls.set(k, { plain: 0, odd: 0 });
        cls.get(k)[h.note ? 'odd' : 'plain']++;
    });
    console.log('| 含む元素 | 注記なし | 3・4員環／累積二重結合など | 計 |');
    console.log('|---|---:|---:|---:|');
    [...cls.entries()].sort((x, y) => (y[1].plain + y[1].odd) - (x[1].plain + x[1].odd)).forEach(([k, v]) => {
        console.log(`| ${k.replace(/(Cl|Br|[CONS])/g, '$1・').replace(/・$/, '')} | ${v.plain} | ${v.odd} | ${v.plain + v.odd} |`);
    });

    // 命名器を広げれば埋まる分がどれだけあるか（chemistry.js への提案の裏づけ）
    console.log('');
    console.log('## ①d (c) を「iupacName が諦めた理由」で分ける');
    console.log('');
    const rej = new Map();
    holes.forEach(h => {
        if (!rej.has(h.reject)) rej.set(h.reject, { all: 0, plain: 0 });
        rej.get(h.reject).all++;
        if (!h.note) rej.get(h.reject).plain++;
    });
    console.log('| 諦めた理由 | (c) の件数 | うち注記なし |');
    console.log('|---|---:|---:|');
    [...rej.entries()].sort((x, y) => y[1].all - x[1].all).forEach(([k, v]) => {
        console.log(`| ${k} | ${v.all} | ${v.plain} |`);
    });

    console.log('');
    console.log('## ② (c) の一覧（命名できない・かつ高校範囲内）');
    console.log('');
    // 既定は「注記なし・C/H/O/N だけ」に絞って出す。ここが実際に足す候補になる。
    // 全部見たいときは --list=c
    const pick = LIST_ALL ? holes
        : holes.filter(h => !h.note && /^C?O?N?$/.test(h.elementClass));
    const byFormula = new Map();
    pick.forEach(h => {
        if (!byFormula.has(h.formula)) byFormula.set(h.formula, []);
        byFormula.get(h.formula).push(h);
    });
    const sorted = [...byFormula.entries()].sort((x, y) => {
        const sx = x[1][0].size, sy = y[1][0].size;
        return sx - sy || y[1].length - x[1].length || x[0].localeCompare(y[0]);
    });
    console.log(LIST_ALL
        ? `全 ${holes.length} 件（分子式 ${sorted.length} 種）`
        : `注記なし・C/H/O/N だけの ${pick.length} 件（分子式 ${sorted.length} 種）` +
          `／ (c) 全体は ${holes.length} 件。全部見るには --list=c`);
    console.log('');
    console.log('| 重原子 | 分子式 | 件数 | 構造（SMILES 風） |');
    console.log('|---:|---|---:|---|');
    sorted.forEach(([formula, list]) => {
        const s = list.map(h => h.smiles + (h.note ? `〔${h.note}〕` : '')).join(' / ');
        console.log(`| ${list[0].size} | ${formula} | ${list.length} | ${s.length > 300 ? s.slice(0, 300) + '…' : s} |`);
    });

    // ひずみ環・累積二重結合を除いた「素直に足せる」件数も出す
    const plain = holes.filter(h => !h.note);
    console.log('');
    console.log(`注記なし（ひずみ環・累積二重結合を含まない）の (c): ${plain.length} 件 / ${holes.length} 件`);
}

{
    const { one, two } = runTaps();
    const show = (title, list) => {
        const miss = list.filter(r => r.bucket === 'c' || r.bucket === 'd');
        console.log('');
        console.log(`## ${title}`);
        console.log('');
        console.log(`${list.length} 通り中 命名できるのは ${list.length - miss.length} 通り（(a) ${list.filter(r => r.bucket === 'a').length} ／ (b) ${list.filter(r => r.bucket === 'b').length}）`);
        console.log('');
        console.log('| 環モジュール | 通り | 命名できる | 名前が出ない |');
        console.log('|---|---:|---:|---:|');
        Object.keys(RINGS).forEach(ringName => {
            const sub = list.filter(r => r.label.startsWith(ringName));
            if (!sub.length) return;
            const ok = sub.filter(r => r.bucket === 'a' || r.bucket === 'b').length;
            console.log(`| ${ringName} | ${sub.length} | ${ok} | ${sub.length - ok} |`);
        });
        if (!miss.length) { console.log(''); console.log('名前が出ないものはありません。'); return; }
        console.log('');
        console.log('| 作り方 | 分子式 | 構造 | 区分 |');
        console.log('|---|---|---|---|');
        miss.forEach(r => {
            console.log(`| ${r.label} | ${r.formula} | ${r.smiles} | ${r.bucket === 'c' ? '**(c) 穴**' : '(d) ' + r.reason} |`);
        });
    };
    show('③ 2タップ（環モジュール1つ ＋ 官能基1つ）', one);
    show('④ 3タップ（環モジュール1つ ＋ 官能基2つ）', two);
}
