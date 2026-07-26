/**
 * 反応実行エンジン（P9-1 M2 / 設計: DESIGN_reaction_execution.md）
 * 「⚗ この分子の反応」カードに、いま描かれている分子へ適用できる反応を列挙し、
 * 選ぶと分子グラフを書き換えて生成物へ変化させる。実行は通常の編集と同じく
 * saveState を積むので Undo/Redo がそのまま効く。名称判定カードが答え合わせを兼ねる。
 */

// ---- 共通ヘルパー ----

// 指定原子が属する連結成分（分子）の原子IDの集合
function componentOf(mol, atomId) {
    const seen = new Set([atomId]);
    const stack = [atomId];
    while (stack.length) {
        const id = stack.pop();
        mol.getNeighbors(id).forEach(n => {
            if (!seen.has(n.atom.id)) {
                seen.add(n.atom.id);
                stack.push(n.atom.id);
            }
        });
    }
    return seen;
}

// 脱離した酸素を分子の外側（右上）へ退避させる。結合を失ったOは自動水素で水 H₂O として描かれる
// （反応機構データと同じ「原子は消さない」原則）
function parkAsWater(mol, oId) {
    const o = mol.atoms.find(a => a.id === oId);
    const others = mol.atoms.filter(a => a.id !== oId);
    if (!o || others.length === 0) return;
    const maxX = Math.max(...others.map(a => a.x));
    const minY = Math.min(...others.map(a => a.y));
    const x = Math.round((maxX + GRID_SIZE * 2) / GRID_SIZE) * GRID_SIZE;
    let y = Math.round(minY / GRID_SIZE) * GRID_SIZE;
    while (others.some(a => Math.hypot(a.x - x, a.y - y) < GRID_SIZE * 0.65)) y += GRID_SIZE;
    o.x = x;
    o.y = y;
}

// 相手分子（movingIds）を平行移動して、attachId の原子を anchorId の隣（1グリッドの直交方向）に
// 置くための移動量を求める。既存原子と重なる配置は採用しない。見つからなければ null
function planAttachment(mol, anchorId, attachId, movingIds, ignoreIds = []) {
    const anchor = mol.atoms.find(a => a.id === anchorId);
    const attach = mol.atoms.find(a => a.id === attachId);
    if (!anchor || !attach) return null;
    const moving = new Set(movingIds);
    const ignore = new Set(ignoreIds);
    const statics = mol.atoms.filter(a => !moving.has(a.id) && !ignore.has(a.id) && a.element !== 'H');
    const MIN_CLEARANCE = GRID_SIZE * 0.65;
    const dirs = [0, -Math.PI / 2, Math.PI / 2, Math.PI]; // 右・上・下・左
    for (const ang of dirs) {
        const tx = anchor.x + GRID_SIZE * Math.cos(ang);
        const ty = anchor.y + GRID_SIZE * Math.sin(ang);
        const dx = tx - attach.x;
        const dy = ty - attach.y;
        const ok = [...moving].every(id => {
            const a = mol.atoms.find(x => x.id === id);
            if (!a) return true;
            const nx = a.x + dx;
            const ny = a.y + dy;
            return statics.every(s => Math.hypot(s.x - nx, s.y - ny) >= MIN_CLEARANCE);
        });
        if (ok) return { dx, dy };
    }
    return null;
}

function translateAtoms(mol, ids, dx, dy) {
    ids.forEach(id => {
        const a = mol.atoms.find(x => x.id === id);
        if (a) {
            a.x += dx;
            a.y += dy;
        }
    });
}

const ALCOHOL_TYPES = ['alcohol0', 'alcohol1', 'alcohol2', 'alcohol3'];

// 新しい原子を atomId の隣（1グリッドの直交方向）に置ける空き位置を返す。なければ null
function freeSpotAround(mol, atomId, reserved = []) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a) return null;
    const MIN_CLEARANCE = GRID_SIZE * 0.65;
    const dirs = [0, -Math.PI / 2, Math.PI / 2, Math.PI];
    for (const ang of dirs) {
        const x = a.x + GRID_SIZE * Math.cos(ang);
        const y = a.y + GRID_SIZE * Math.sin(ang);
        if (mol.atoms.some(o => o.id !== atomId && o.element !== 'H' &&
            Math.hypot(o.x - x, o.y - y) < MIN_CLEARANCE)) continue;
        if (reserved.some(p => Math.hypot(p.x - x, p.y - y) < MIN_CLEARANCE)) continue;
        return { x, y };
    }
    return null;
}

// 切り離された分子（movingIds）を他の原子と重ならない位置まで引き離す移動量を返す
function separateComponent(mol, movingIds) {
    const moving = new Set(movingIds);
    const statics = mol.atoms.filter(a => !moving.has(a.id) && a.element !== 'H');
    if (statics.length === 0) return { dx: 0, dy: 0 };
    const G = GRID_SIZE;
    const offsets = [[0, 2 * G], [2 * G, 0], [0, -2 * G], [-2 * G, 0],
                     [0, 3 * G], [3 * G, 0], [2 * G, 2 * G], [-2 * G, 2 * G]];
    for (const [dx, dy] of offsets) {
        const ok = movingIds.every(id => {
            const a = mol.atoms.find(x => x.id === id);
            if (!a) return true;
            return statics.every(s => Math.hypot(s.x - (a.x + dx), s.y - (a.y + dy)) >= G * 0.65);
        });
        if (ok) return { dx, dy };
    }
    return null;
}

// 芳香環の置換可能な炭素（空き価標のある環炭素）を [id] の配列で返す
function aromaticSites(mol, kind) {
    const keys = findAromaticBondKeys(mol);
    const ids = new Set();
    mol.bonds.forEach(b => {
        const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        if (keys.has(k)) {
            ids.add(b.atomId1);
            ids.add(b.atomId2);
        }
    });
    // 価標が空いていても、その置換基を置く空間が無ければ**候補に出さない**
    // （P12-8。「検出はするが実行すると失敗する」候補をユーザーに見せないため）
    return [...ids]
        .filter(id => mol.getFreeValency(id) >= 1)
        .filter(id => !kind || attachGroup(mol, id, kind, true))
        .map(id => [id]);
}

// 環の外向き（結合済みの隣接原子と反対方向）に伸ばせる位置の候補を返す。
// 直交に限らず環の角度に沿った方向も試すため、六角形の頂点からでも自然に外へ伸ばせる
function outwardCandidates(mol, atomId) {
    const a = mol.atoms.find(x => x.id === atomId);
    if (!a) return [];
    const MIN_CLEARANCE = GRID_SIZE * 0.65;
    const nb = mol.getNeighbors(atomId).filter(n => n.atom.element !== 'H');
    let base = 0;
    if (nb.length > 0) {
        let sx = 0, sy = 0;
        nb.forEach(n => {
            const t = Math.atan2(n.atom.y - a.y, n.atom.x - a.x);
            sx += Math.cos(t);
            sy += Math.sin(t);
        });
        base = Math.atan2(-sy, -sx);
    }
    const angles = [base, base + Math.PI / 6, base - Math.PI / 6,
                    base + Math.PI / 3, base - Math.PI / 3, base + Math.PI / 2, base - Math.PI / 2];
    const out = [];
    angles.forEach(ang => {
        const x = a.x + GRID_SIZE * Math.cos(ang);
        const y = a.y + GRID_SIZE * Math.sin(ang);
        if (mol.atoms.some(o => o.id !== atomId && o.element !== 'H' &&
            Math.hypot(o.x - x, o.y - y) < MIN_CLEARANCE)) return;
        out.push({ x, y, angle: ang });
    });
    return out;
}

// 置換基（ニトロ基・スルホ基・ハロゲン）を指定原子に取り付ける。追加した原子IDを返す。
// 置換基を「かたまり」として扱い、酸素まで含めて重ならない向きを探す
// （ニトロ基の酸素どうしが4pxまで接近する不具合の修正。P9-5監査で発見）
/**
 * 芳香環などに置換基を付ける。dryRun=true なら**実際には付けず、置ける場所があるかだけ**を返す
 * （P12-8 反応判定の精査。検出段階で「実行できない候補」を出さないために使う）。
 */
function attachGroup(mol, cId, kind, dryRun = false) {
    const MIN_CLEARANCE = GRID_SIZE * 0.65;
    const anchorElement = kind === 'nitro' ? 'N' : (kind === 'sulfo' ? 'S' : kind);
    // アンカー（N/S/ハロゲン）から見た枝の配置。ニトロは N(=O)(-O) の電荷分離形、
    // スルホ基 -SO₃H は S を6価として扱う（開発方針 4章-2 / 硫黄の扱い）
    const branchesOf = (angle) => {
        if (kind === 'nitro') {
            return [{ element: 'O', angle: angle + Math.PI / 2, type: 2 },
                    { element: 'O', angle: angle - Math.PI / 2, type: 1 }];
        }
        if (kind === 'sulfo') {
            return [{ element: 'O', angle: angle + Math.PI / 2, type: 2 },
                    { element: 'O', angle: angle - Math.PI / 2, type: 2 },
                    { element: 'O', angle: angle, type: 1 }];
        }
        return [];
    };

    for (const spot of outwardCandidates(mol, cId)) {
        const branches = branchesOf(spot.angle).map(b => ({
            ...b,
            x: spot.x + GRID_SIZE * Math.cos(b.angle),
            y: spot.y + GRID_SIZE * Math.sin(b.angle)
        }));
        const points = [{ x: spot.x, y: spot.y }, ...branches];
        const hitsExisting = points.some(p => mol.atoms.some(o =>
            o.id !== cId && o.element !== 'H' && Math.hypot(o.x - p.x, o.y - p.y) < MIN_CLEARANCE));
        const hitsSelf = points.some((p, i) => points.some((q, j) =>
            j > i && Math.hypot(p.x - q.x, p.y - q.y) < MIN_CLEARANCE));
        if (hitsExisting || hitsSelf) continue;
        if (dryRun) return true; // 置ける場所が見つかった（実際には置かない）

        const anchor = mol.addAtom(anchorElement, spot.x, spot.y);
        mol.addBond(cId, anchor.id, 1);
        const added = [anchor.id];
        branches.forEach(b => {
            const atom = mol.addAtom(b.element, b.x, b.y);
            mol.addBond(anchor.id, atom.id, b.type);
            added.push(atom.id);
        });
        return added;
    }
    if (dryRun) return false; // 置ける場所が無い
    throw new Error('置換基を置く空間がありません。まわりを空けてから実行してください');
}

// アセチル基 CH₃CO- を指定原子（フェノールのO・アミンのN）に取り付ける（P9-1検収フォロー）。
// 置換基をかたまりとして扱い、カルボニルOとメチルCまで含めて重ならない向きを探す
function attachAcetyl(mol, targetId) {
    const MIN_CLEARANCE = GRID_SIZE * 0.65;
    for (const spot of outwardCandidates(mol, targetId)) {
        const branches = [
            { element: 'O', type: 2,
              x: spot.x + GRID_SIZE * Math.cos(spot.angle + Math.PI / 2),
              y: spot.y + GRID_SIZE * Math.sin(spot.angle + Math.PI / 2) },
            { element: 'C', type: 1,
              x: spot.x + GRID_SIZE * Math.cos(spot.angle),
              y: spot.y + GRID_SIZE * Math.sin(spot.angle) }
        ];
        const points = [{ x: spot.x, y: spot.y }, ...branches];
        const hitsExisting = points.some(p => mol.atoms.some(o =>
            o.id !== targetId && o.element !== 'H' && Math.hypot(o.x - p.x, o.y - p.y) < MIN_CLEARANCE));
        const hitsSelf = points.some((p, i) => points.some((q, j) =>
            j > i && Math.hypot(p.x - q.x, p.y - q.y) < MIN_CLEARANCE));
        if (hitsExisting || hitsSelf) continue;
        const cAcyl = mol.addAtom('C', spot.x, spot.y);
        mol.addBond(targetId, cAcyl.id, 1);
        const added = [cAcyl.id];
        branches.forEach(b => {
            const atom = mol.addAtom(b.element, b.x, b.y);
            mol.addBond(cAcyl.id, atom.id, b.type);
            added.push(atom.id);
        });
        return added;
    }
    throw new Error('アセチル基を置く空間がありません。まわりを空けてから実行してください');
}

// 多重結合（非芳香族の C=C / C≡C）の一覧を [id1, id2] の配列で返す
function multipleBondSites(mol) {
    return findFunctionalGroups(mol)
        .filter(g => g.type === 'cc_double' || g.type === 'cc_triple')
        .map(g => g.atomIds);
}

// 多重結合への付加の共通処理。elemA/elemB は付加する元素（null は水素＝自動水素に任せる）。
// 片側だけに置換基が付く場合（HX・H₂O）はマルコフニコフ則で置換基の多い炭素側に付ける
function addAcrossMultipleBond(game, site, elemA, elemB, caption) {
    const mol = game.userMolecule;
    const [id1, id2] = site;
    const bond = mol.getBond(id1, id2);
    if (!bond || bond.type < 2) throw new Error('多重結合が見つかりません');

    let cX = id1, cY = id2;
    if (elemA && !elemB) {
        const subs = (id, other) => mol.getNeighbors(id)
            .filter(n => n.atom.element === 'C' && n.atom.id !== other).length;
        if (subs(id2, id1) > subs(id1, id2)) {
            cX = id2;
            cY = id1;
        }
    }

    bond.type -= 1;
    const added = [];
    const reserved = [];
    [[cX, elemA], [cY, elemB]].forEach(([cid, el]) => {
        if (!el) return; // 水素は明示原子にせず自動水素に任せる
        const spot = freeSpotAround(mol, cid, reserved);
        if (!spot) throw new Error('付加する原子を置く空間がありません。結合を伸ばして空間を作ってから実行してください');
        reserved.push(spot);
        const atom = mol.addAtom(el, spot.x, spot.y);
        mol.addBond(cid, atom.id, 1);
        added.push(atom.id);
    });
    return { caption, changed: [id1, id2, ...added] };
}

// ---- 反応ルール（detect は適用箇所の配列を返す。apply は分子を書き換える） ----
const REACTION_RULES = [
    {
        id: 'oxidize_primary',
        label: '酸化 [O] → アルデヒド',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'alcohol1' || g.type === 'alcohol0')
                .filter(g => mol.getFreeValency(g.atomIds[1]) >= 1)
                .map(g => g.atomIds); // [OのID, CのID]
        },
        apply(game, site) {
            const [oId, cId] = site;
            game.userMolecule.getBond(oId, cId).type = 2;
            return {
                caption: '酸化されてアルデヒドになりました（R-CH₂-OH + [O] → R-CHO + H₂O）。アルデヒドはさらに酸化されるとカルボン酸になります。銀鏡反応・フェーリング液の還元を示すのはこの構造です。',
                changed: [oId, cId]
            };
        }
    },
    {
        id: 'oxidize_secondary',
        label: '酸化 [O] → ケトン',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'alcohol2')
                .filter(g => mol.getFreeValency(g.atomIds[1]) >= 1)
                .map(g => g.atomIds);
        },
        apply(game, site) {
            const [oId, cId] = site;
            game.userMolecule.getBond(oId, cId).type = 2;
            return {
                caption: '2級アルコールが酸化されてケトンになりました（R-CH(OH)-R\' + [O] → R-CO-R\' + H₂O）。ケトンはアルデヒドと違い、それ以上酸化されにくい構造です。',
                changed: [oId, cId]
            };
        }
    },
    {
        id: 'oxidize_aldehyde',
        label: '酸化 [O] → カルボン酸',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'aldehyde')
                .filter(g => mol.getFreeValency(g.atomIds[0]) >= 1)
                .map(g => g.atomIds); // [カルボニルC, =O]
        },
        apply(game, site) {
            const cId = site[0];
            const mol = game.userMolecule;
            // 空き位置を確認して -OH の O を追加する。方向を計算するだけでは、
            // その位置に既存原子があると完全に重なってしまう（P9-5監査で発見）
            const spot = freeSpotAround(mol, cId);
            if (!spot) throw new Error('-OH を置く空間がありません。まわりを空けてから実行してください');
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(cId, o.id, 1);
            return {
                caption: 'アルデヒドが酸化されてカルボン酸になりました（R-CHO + [O] → R-COOH）。1級アルコールから2段階の酸化で到達する終点です。',
                changed: [cId, o.id]
            };
        }
    },
    {
        id: 'oxidize_tertiary_info',
        label: '⚠ 酸化（3級アルコール）',
        info: true,
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'alcohol3')
                .map(g => g.atomIds);
        },
        apply() {
            return {
                caption: '3級アルコールは、-OH のついた炭素に水素がないため酸化されにくい構造です（級の判定: OHのつく炭素に結合する炭素の数 = 3）。'
            };
        }
    },
    {
        id: 'dehydration_intra',
        mechanismId: 'ethanol_e1',
        label: '分子内脱水（-H₂O） → アルケン',
        detect(mol) {
            const sites = [];
            // 適用条件（P12-8 反応判定の精査）: 高校で扱う分子内脱水は
            // 「アルコール（-OH がひとつだけ）」に限られる。糖・多価アルコール・
            // α-ヒドロキシ酸などに適用すると、教科書では扱わない生成物を提示してしまうため、
            // **他の官能基を持つ分子や -OH が複数ある分子では候補に出さない**（＝判断できないものは出さない）
            const groups = findFunctionalGroups(mol);
            const alcohols = groups.filter(g => ['alcohol1', 'alcohol2', 'alcohol3'].includes(g.type));
            if (alcohols.length !== 1) return sites; // 多価アルコール・糖は対象外
            const blocking = groups.filter(g =>
                !['alcohol1', 'alcohol2', 'alcohol3'].includes(g.type) && g.type !== 'aromatic');
            if (blocking.length > 0) return sites; // カルボニル・カルボキシ・エステル・エーテル等があれば対象外
            alcohols
                .forEach(g => {
                    const [oId, aId] = g.atomIds;
                    const alpha = mol.atoms.find(a => a.id === aId);
                    const aNb = mol.getNeighbors(aId).filter(n => n.atom.element !== 'H');
                    if (aNb.some(n => n.type >= 2)) return; // α炭素に多重結合がある場合は対象外
                    // β候補: αに単結合した炭素で、Hがあり多重結合を持たないもの
                    const betas = aNb.filter(n =>
                        n.atom.element === 'C' && n.type === 1 &&
                        mol.getFreeValency(n.atom.id) >= 1 &&
                        !mol.getNeighbors(n.atom.id).some(x => x.type >= 2));
                    if (betas.length === 0) return;
                    // ザイツェフ則: 結合する炭素が多い（＝Hが少ない）β側を主生成物として選ぶ
                    betas.sort((p, q) =>
                        mol.getNeighbors(q.atom.id).filter(x => x.atom.element === 'C').length -
                        mol.getNeighbors(p.atom.id).filter(x => x.atom.element === 'C').length);
                    sites.push([oId, aId, betas[0].atom.id]);
                });
            return sites;
        },
        apply(game, site) {
            const [oId, aId, bId] = site;
            const mol = game.userMolecule;
            mol.removeBond(oId, aId);
            mol.getBond(aId, bId).type = 2;
            // 脱離した水（O + 自動H×2）は分子の外側へ平行移動して残す
            parkAsWater(mol, oId);
            return {
                caption: '分子内脱水で C=C 二重結合ができ、水 H₂O が脱離しました（濃硫酸・約160〜170℃の条件に相当）。β炭素が複数あるときは、Hの少ない炭素側から抜ける主生成物を表示しています（ザイツェフ則）。',
                changed: [aId, bId]
            };
        }
    },
    {
        id: 'esterification',
        mechanismId: 'esterification',
        label: 'エステル化（カルボン酸＋アルコール, -H₂O）',
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            const carboxyls = groups.filter(g => g.type === 'carboxyl');
            // フェノールは対象外: カルボン酸との直接エステル化は進みにくく、
            // 教科書では無水酢酸によるアセチル化で扱う（P9-1検収での化学的修正）
            const alcohols = groups.filter(g => ALCOHOL_TYPES.includes(g.type));
            const sites = [];
            carboxyls.forEach(cx => {
                const comp = componentOf(mol, cx.atomIds[0]);
                alcohols.forEach(al => {
                    if (comp.has(al.atomIds[0])) return; // 分子間反応のみ（分子内エステル化は対象外）
                    sites.push([cx.atomIds[0], cx.atomIds[2], al.atomIds[0], al.atomIds[1]]);
                });
            });
            return sites;
        },
        apply(game, site) {
            const [cId, ohOId, alcOId] = site;
            const mol = game.userMolecule;
            const movingIds = [...componentOf(mol, alcOId)];
            // アルコール分子を平行移動し、そのOをカルボニル炭素の隣へ（脱離するOHは判定から除く）
            const plan = planAttachment(mol, cId, alcOId, movingIds, [ohOId]);
            if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
            mol.removeBond(cId, ohOId);
            translateAtoms(mol, movingIds, plan.dx, plan.dy);
            mol.addBond(cId, alcOId, 1);
            parkAsWater(mol, ohOId);
            return {
                caption: 'エステル化（縮合）が起こりました。カルボン酸の -OH とアルコールの -H がとれて水になり、エステル結合 -COO- ができます（濃硫酸を触媒に加熱）。同位体で調べると、水の酸素はカルボン酸側から来ることが分かっています。',
                changed: [cId, alcOId]
            };
        }
    },
    {
        id: 'esterification_phenol_info',
        label: '⚠ エステル化（フェノールは進行しにくい）',
        info: true,
        detect(mol) {
            const groups = findFunctionalGroups(mol);
            const carboxyls = groups.filter(g => g.type === 'carboxyl');
            const phenols = groups.filter(g => g.type === 'phenol');
            const sites = [];
            carboxyls.forEach(cx => {
                const comp = componentOf(mol, cx.atomIds[0]);
                phenols.forEach(ph => {
                    if (!comp.has(ph.atomIds[0])) sites.push([cx.atomIds[0], ph.atomIds[0]]);
                });
            });
            return sites;
        },
        apply() {
            return {
                caption: 'フェノールとカルボン酸のエステル化は原理的には可能ですが、フェノールの-OHはベンゼン環との共役で反応性が低く、平衡も生成物側に偏りにくいため、ほとんど進行しません。実際には、カルボン酸より反応性の高い無水酢酸 (CH₃CO)₂O を使ってエステル化します（アセチル化）。下の「アセチル化」ボタンで実行できます。'
            };
        }
    },
    {
        id: 'acetylation_anhydride',
        label: 'アセチル化（無水酢酸 (CH₃CO)₂O）',
        detect(mol) {
            // 対象はフェノールの-OHとアミンの-NH₂（教科書の定番: フェノール→酢酸フェニル、
            // アニリン→アセトアニリド、サリチル酸→アセチルサリチル酸）
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'phenol' || g.type === 'amino')
                .map(g => [g.atomIds[0]]);
        },
        apply(game, site) {
            const added = attachAcetyl(game.userMolecule, site[0]);
            return {
                caption: '無水酢酸によるアセチル化で、-OH / -NH₂ の水素がアセチル基 CH₃CO- に置き換わりました（副生成物は酢酸）。無水酢酸はカルボン酸より反応性が高いため、直接エステル化が進みにくいフェノールもエステルにできます。アニリンからはアセトアニリド（解熱剤）、サリチル酸からはアセチルサリチル酸（アスピリン）が得られます。',
                changed: [site[0], ...added]
            };
        }
    },
    {
        id: 'dehydration_inter',
        label: '分子間脱水（アルコール2分子, -H₂O） → エーテル',
        detect(mol) {
            const alcohols = findFunctionalGroups(mol).filter(g => ALCOHOL_TYPES.includes(g.type));
            const sites = [];
            for (let i = 0; i < alcohols.length; i++) {
                for (let j = i + 1; j < alcohols.length; j++) {
                    const a = alcohols[i];
                    const b = alcohols[j];
                    if (componentOf(mol, a.atomIds[0]).has(b.atomIds[0])) continue; // 別分子どうしのみ
                    sites.push([a.atomIds[0], a.atomIds[1], b.atomIds[0], b.atomIds[1]]);
                }
            }
            return sites;
        },
        apply(game, site) {
            const [oAId, , oBId, cBId] = site;
            const mol = game.userMolecule;
            // B分子のうち、脱離するOを除いた部分を移動させてAのOに結合する
            const movingIds = [...componentOf(mol, cBId)].filter(id => id !== oBId);
            const plan = planAttachment(mol, oAId, cBId, movingIds, [oBId]);
            if (!plan) throw new Error('生成物を配置する空間がありません。分子を離してから実行してください');
            mol.removeBond(oBId, cBId);
            translateAtoms(mol, movingIds, plan.dx, plan.dy);
            mol.addBond(oAId, cBId, 1);
            parkAsWater(mol, oBId);
            return {
                caption: '分子間脱水（縮合）でエーテル結合 C-O-C ができました。アルコール2分子から水1分子がとれる反応です（エタノールでは約130〜140℃。より高温の160〜170℃では分子内脱水が優先してアルケンになります）。',
                changed: [oAId, cBId]
            };
        }
    },
    {
        id: 'add_br2',
        mechanismId: 'ethene_br2',
        label: '付加: Br₂（臭素水の脱色）',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, 'Br', 'Br',
                '臭素 Br₂ が付加しました。赤褐色の臭素水が脱色されるこの反応は、C=C や C≡C（不飽和結合）の検出に使われます。');
        }
    },
    {
        id: 'add_h2',
        label: '付加: H₂（水素化・Ni触媒）',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, null, null,
                '水素 H₂ が付加しました（ニッケルや白金を触媒に加熱）。不飽和結合が減って飽和に近づきます。植物油に水素を付加して固める硬化油（マーガリンの原料）はこの反応の応用です。');
        }
    },
    {
        id: 'add_hbr',
        label: '付加: HBr（マルコフニコフ則）',
        detect: multipleBondSites,
        apply(game, site) {
            return addAcrossMultipleBond(game, site, 'Br', null,
                '臭化水素 HBr が付加しました。左右非対称なアルケンでは「H はすでに H の多い炭素へ、X は置換基の多い炭素へ」付く主生成物を示しています（マルコフニコフ則）。');
        }
    },
    {
        id: 'add_water',
        mechanismId: 'ethene_h2o',
        label: '付加: H₂O（酸触媒・水和）',
        detect: multipleBondSites,
        apply(game, site) {
            const mol = game.userMolecule;
            const bond = mol.getBond(site[0], site[1]);
            if (bond && bond.type === 3) {
                // アルキンの水和: エノール（C=C-OH）は不安定なので、教科書どおり
                // ケト・エノール互変異性でケト形（C=O）を直接生成する
                // （アセチレン→アセトアルデヒド、プロピン→アセトン）
                const [id1, id2] = site;
                const subs = (id, other) => mol.getNeighbors(id)
                    .filter(n => n.atom.element === 'C' && n.atom.id !== other).length;
                const cX = subs(id2, id1) > subs(id1, id2) ? id2 : id1; // マルコフニコフ則
                const spot = freeSpotAround(mol, cX);
                if (!spot) throw new Error('生成物を配置する空間がありません。まわりを空けてから実行してください');
                bond.type = 1;
                const o = mol.addAtom('O', spot.x, spot.y);
                mol.addBond(cX, o.id, 2);
                return {
                    caption: '三重結合に水が付加しました。まず不安定なエノール（C=C-OH）ができますが、ただちにケト形（C=O）へ変化します（ケト・エノール互変異性）。アセチレンからはアセトアルデヒドが得られます（かつてのアセトアルデヒド工業的製法）。',
                    changed: [id1, id2, o.id]
                };
            }
            return addAcrossMultipleBond(game, site, 'O', null,
                '水 H₂O が付加してアルコールになりました（リン酸などの酸触媒）。エテンからエタノールを作る工業的製法がこの反応です。非対称アルケンではマルコフニコフ則に従う主生成物を示しています。');
        }
    },
    {
        id: 'aromatic_nitration',
        mechanismId: 'benzene_nitration',
        label: '芳香族置換: ニトロ化（濃硝酸＋濃硫酸）',
        detect: (mol) => aromaticSites(mol, 'nitro'),
        apply(game, site) {
            const added = attachGroup(game.userMolecule, site[0], 'nitro');
            return {
                caption: 'ベンゼン環がニトロ化されました。濃硝酸と濃硫酸の混酸から生じたニトロニウムイオン NO₂⁺ が環を攻撃する求電子置換反応です。付加ではなく置換になるのは、芳香族性を保つ方が安定なためです。',
                changed: [site[0], ...added]
            };
        }
    },
    {
        id: 'aromatic_sulfonation',
        mechanismId: 'benzene_sulfonation',
        label: '芳香族置換: スルホン化（濃硫酸）',
        detect: (mol) => aromaticSites(mol, 'sulfo'),
        apply(game, site) {
            const added = attachGroup(game.userMolecule, site[0], 'sulfo');
            return {
                caption: 'ベンゼン環がスルホン化され、スルホ基 -SO₃H が付きました（濃硫酸と加熱）。生成物のベンゼンスルホン酸は強酸で、水に溶けやすくなります。',
                changed: [site[0], ...added]
            };
        }
    },
    {
        id: 'aromatic_halogenation',
        mechanismId: 'benzene_chlorination',
        label: '芳香族置換: 塩素化（Cl₂・鉄触媒）',
        detect: (mol) => aromaticSites(mol, 'Cl'),
        apply(game, site) {
            const added = attachGroup(game.userMolecule, site[0], 'Cl');
            return {
                caption: 'ベンゼン環が塩素化されました（鉄または塩化鉄(III)を触媒に Cl₂ と反応）。触媒が Cl-Cl 結合を分極させ、塩素が求電子剤として働きます。同時に塩化水素 HCl が発生します。',
                changed: [site[0], ...added]
            };
        }
    },
    {
        id: 'hydrolysis_ester',
        mechanismId: 'saponification',
        label: 'けん化・加水分解（エステル + H₂O）',
        detect(mol) {
            return findFunctionalGroups(mol)
                .filter(g => g.type === 'ester')
                .map(g => g.atomIds); // [カルボニルC, =O, -O-]
        },
        apply(game, site) {
            const [cId, , oId] = site;
            const mol = game.userMolecule;
            // エステルの C-O 結合を切る（アシル-酸素開裂）。O はアルコール側に残る
            mol.removeBond(cId, oId);
            const alcIds = [...componentOf(mol, oId)];
            if (!alcIds.includes(cId)) {
                // 環状エステル（ラクトン）でなければアルコール分子として引き離す
                const sep = separateComponent(mol, alcIds);
                if (sep) translateAtoms(mol, alcIds, sep.dx, sep.dy);
            }
            const spot = freeSpotAround(mol, cId);
            if (!spot) throw new Error('生成物を配置する空間がありません。結合を伸ばして空間を作ってから実行してください');
            const o = mol.addAtom('O', spot.x, spot.y);
            mol.addBond(cId, o.id, 1);
            return {
                caption: 'エステルが加水分解されて、カルボン酸とアルコールに分かれました。水酸化ナトリウムを使う場合は「けん化」と呼ばれ、生成物はカルボン酸の塩になります（油脂のけん化＝セッケンの製法）。塩になると逆のエステル化が起こらないため、反応は完全に進みます。',
                changed: [cId, o.id]
            };
        }
    },

    // ===== 鎖状⇄環状の平衡（グルコースの環化・開環／変旋光。P12-7 M2d） =====
    // 糖の環化は「C5 の -OH 酸素が C1 のカルボニル炭素を攻撃して環を閉じる」分子内反応。
    // 立体は自分で導出せず、**登録済みエントリ（鎖状・α/β ピラノース）の座標を対応表で移す**。
    // 対応表は Node で検証済み（環化結果の立体コードが登録 α/β と完全一致）。
    // 対象はグルコースに限定する（他のアルドースはフィッシャー⇄ハースの面対応が別で、
    // 誤った立体を生む危険があるため。将来エントリを揃えてから拡張する）。
    {
        id: 'cyclize_glucose_beta',
        label: '環化 → β-D-グルコピラノース',
        morphStages: 'moveFirst', // ①環の形に折りたたむ → ②結合ができて環が閉じる
        detect(mol) { return detectGlucoseChain(mol); },
        apply(game, site) { return applyCyclize(game, site, 'β-D-グルコピラノース'); }
    },
    {
        id: 'cyclize_glucose_alpha',
        label: '環化 → α-D-グルコピラノース',
        morphStages: 'moveFirst', // ①環の形に折りたたむ → ②結合ができて環が閉じる
        detect(mol) { return detectGlucoseChain(mol); },
        apply(game, site) { return applyCyclize(game, site, 'α-D-グルコピラノース'); }
    },
    {
        id: 'open_glucopyranose',
        label: '開環 → 鎖状の D-グルコース',
        morphStages: 'bondsFirst', // ①環の配置のまま開く → ②鎖状に整列する
        detect(mol) { return detectGlucopyranose(mol); },
        apply(game, site) { return applyOpenRing(game, site); }
    }
];

// ---- 鎖状⇄環状の共通処理（P12-7 M2d） ----

// 登録エントリ（compounds.json）の target を名前で引く
function registeredTarget(name) {
    const list = (typeof COMPOUNDS !== 'undefined' && COMPOUNDS) || (typeof window !== 'undefined' && window.COMPOUNDS) || [];
    const e = list.find(c => c.name === name);
    return e ? e.target : null;
}

// 分子が登録エントリ（名前）と同一物か、立体込みで判定する。
// 立体コードが一致＝同じ立体異性体（描いた向きの違いは正しく別物として扱われる）
function isRegisteredCompound(mol, name) {
    const t = registeredTarget(name);
    if (!t || typeof canonicalStereoCode !== 'function') return false;
    const ref = new Molecule();
    const ids = t.atoms.map(a => ref.addAtom(a.element, a.x, a.y).id);
    t.bonds.forEach(b => ref.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
    const code = m => canonicalStereoCode(m, {
        atomParity: { ...readAtomParityFromFischer(m), ...readRingParityFromHaworth(m) }
    });
    return canonicalCode(mol) === canonicalCode(ref) && code(mol) === code(ref);
}

// 鎖状 D-グルコースを検出し、[C1..C6, O(カルボニル), O2, O3, O4, O5, O6] の順にIDを返す。
// 順序は登録エントリ（compounds.json の D-グルコース（鎖状））の原子並びと同じ意味づけ。
function detectGlucoseChain(mol) {
    if (!isRegisteredCompound(mol, 'D-グルコース（鎖状）')) return [];
    // C1 = C=O を持つ炭素（アルデヒド）
    let c1 = null, oCarbonyl = null;
    mol.atoms.forEach(a => {
        if (a.element !== 'C') return;
        const dbl = mol.getNeighbors(a.id).find(n => n.type === 2 && n.atom.element === 'O');
        if (dbl) { c1 = a; oCarbonyl = dbl.atom; }
    });
    if (!c1) return [];
    // 炭素鎖を C1 から順にたどる
    const carbons = [c1];
    const seen = new Set([c1.id]);
    while (carbons.length < 6) {
        const last = carbons[carbons.length - 1];
        const next = mol.getNeighbors(last.id).find(n => n.atom.element === 'C' && !seen.has(n.atom.id));
        if (!next) return [];
        seen.add(next.atom.id);
        carbons.push(next.atom);
    }
    // 各炭素の -OH 酸素（C1 のカルボニル O は除く）
    const ohOf = c => {
        const n = mol.getNeighbors(c.id).find(x => x.atom.element === 'O' && x.type === 1);
        return n ? n.atom : null;
    };
    const ohs = carbons.slice(1).map(ohOf);
    if (ohs.some(o => !o)) return [];
    return [[...carbons.map(c => c.id), oCarbonyl.id, ...ohs.map(o => o.id)]];
}

// α/β-D-グルコピラノースを検出し、[C1..C6, O(アノマーOH), O2, O3, O4, O5(環内), O6] を返す
function detectGlucopyranose(mol) {
    const name = ['β-D-グルコピラノース', 'α-D-グルコピラノース'].find(n => isRegisteredCompound(mol, n));
    if (!name) return [];
    const ringIds = ringAtomIdsOf(mol);
    const ringO = mol.atoms.find(a => a.element === 'O' && ringIds.has(a.id));
    if (!ringO) return [];
    // 環内酸素の隣の炭素2つ: C1 は環外に -OH（酸素）、C5 は環外に -CH2OH（炭素）
    const nbrs = mol.getNeighbors(ringO.id).filter(n => ringIds.has(n.atom.id) && n.atom.element === 'C');
    if (nbrs.length !== 2) return [];
    // 環外の隣接原子（指定元素）を返す。getNeighbors は {atom, type} を返すので atom を取り出す
    const exoOf = (c, el) => {
        const n = mol.getNeighbors(c.id).find(x => !ringIds.has(x.atom.id) && x.atom.element === el);
        return n ? n.atom : null;
    };
    let c1 = null, c5 = null, anomerO = null;
    nbrs.forEach(n => {
        const o = exoOf(n.atom, 'O');
        if (o) { c1 = n.atom; anomerO = o; } else if (exoOf(n.atom, 'C')) { c5 = n.atom; }
    });
    if (!c1 || !c5 || !anomerO) return [];
    // C1 から環をたどって C2,C3,C4,C5 の順に得る
    const carbons = [c1];
    const seen = new Set([c1.id, ringO.id]);
    while (carbons.length < 5) {
        const last = carbons[carbons.length - 1];
        const next = mol.getNeighbors(last.id).find(n => ringIds.has(n.atom.id) && n.atom.element === 'C' && !seen.has(n.atom.id));
        if (!next) return [];
        seen.add(next.atom.id);
        carbons.push(next.atom);
    }
    const c6 = exoOf(c5, 'C');
    if (!c6) return [];
    const o6 = mol.getNeighbors(c6.id).find(n => n.atom.element === 'O');
    if (!o6) return [];
    const ohs = carbons.slice(1, 4).map(c => {
        const o = mol.getNeighbors(c.id).find(n => !ringIds.has(n.atom.id) && n.atom.element === 'O');
        return o ? o.atom : null;
    });
    if (ohs.some(o => !o)) return [];
    return [[...carbons.map(c => c.id), c6.id, anomerO.id, ...ohs.map(o => o.id), ringO.id, o6.atom.id]];
}

// いずれかの環に属する原子ID集合（chemistry.js の環判定と同じ考え方）
function ringAtomIdsOf(mol) {
    const inRing = new Set();
    mol.bonds.forEach(bond => {
        const visited = new Set([bond.atomId1]);
        const stack = [bond.atomId1];
        while (stack.length) {
            const id = stack.pop();
            mol.bonds.forEach(b => {
                if (b === bond) return;
                const other = b.atomId1 === id ? b.atomId2 : b.atomId2 === id ? b.atomId1 : null;
                if (other && !visited.has(other)) { visited.add(other); stack.push(other); }
            });
        }
        if (visited.has(bond.atomId2)) { inRing.add(bond.atomId1); inRing.add(bond.atomId2); }
    });
    return inRing;
}

// site（鎖状の並び）を、登録された環エントリの座標へ移して環を閉じる。
// 鎖状 index → 環 index の対応（Node 検証済み）:
//   C1..C5 → 環 C1..C5 ／ C6 → 環の CH2OH 炭素 ／ カルボニルO → アノマーOH ／
//   C2..C4 の OH → 同左 ／ **C5 の OH 酸素 → 環内酸素** ／ C6 の OH → 同左
function applyCyclize(game, site, ringName) {
    const t = registeredTarget(ringName);
    if (!t) throw new Error('環状の登録データが見つかりません');
    const mol = game.userMolecule;
    const [c1, c2, c3, c4, c5, c6, oCarb, o2, o3, o4, o5, o6] = site;
    // site の並び（鎖状） → 登録環エントリの原子 index
    const RING_INDEX = [1, 2, 3, 4, 5, 10, 6, 7, 8, 9, 0, 11];
    const order = [c1, c2, c3, c4, c5, c6, oCarb, o2, o3, o4, o5, o6];
    // 現在の重心を保って配置する（描いた場所の近くに出す）
    const cur = order.map(id => mol.atoms.find(a => a.id === id));
    const cx = cur.reduce((s, a) => s + a.x, 0) / cur.length;
    const cy = cur.reduce((s, a) => s + a.y, 0) / cur.length;
    const tx = t.atoms.reduce((s, a) => s + a.x, 0) / t.atoms.length;
    const ty = t.atoms.reduce((s, a) => s + a.y, 0) / t.atoms.length;
    order.forEach((id, i) => {
        const a = mol.atoms.find(x => x.id === id);
        const ref = t.atoms[RING_INDEX[i]];
        a.x = ref.x - tx + cx;
        a.y = ref.y - ty + cy;
    });
    // 結合の書き換え: C1=O を単結合に（→ アノマーの -OH）、C5 の OH 酸素と C1 を結んで環を閉じる
    mol.getBond(c1, oCarb).type = 1;
    mol.addBond(o5, c1, 1);
    const isBeta = ringName.startsWith('β');
    return {
        caption: `鎖状のグルコースが環を閉じて${ringName}になりました。アニメーションは2段階です: ①まず鎖が環の形に折りたたまれ（C5 の -OH が C1 に近づく）、②そのあと結合ができて環が閉じます。C5 の -OH の酸素が C1（アルデヒドの炭素）を攻撃して結合し、C=O が -OH に変わります。このとき新しくできた C1 の -OH が環の上側を向くと β、下側を向くと α です（${isBeta ? 'β' : 'α'}）。水溶液中では鎖状を経由して α と β が行き来し、この平衡を変旋光といいます。「開環 → 鎖状の D-グルコース」でもとに戻せます。`,
        changed: [c1, oCarb, o5]
    };
}

// 環状（α/β）を開いて鎖状 D-グルコースに戻す（環化の逆）
function applyOpenRing(game, site) {
    const t = registeredTarget('D-グルコース（鎖状）');
    if (!t) throw new Error('鎖状の登録データが見つかりません');
    const mol = game.userMolecule;
    const [c1, c2, c3, c4, c5, c6, anomerO, o2, o3, o4, ringO, o6] = site;
    // 環の並び → 鎖状エントリの原子 index（applyCyclize の逆写像）
    const CHAIN_INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const order = [c1, c2, c3, c4, c5, c6, anomerO, o2, o3, o4, ringO, o6];
    const cur = order.map(id => mol.atoms.find(a => a.id === id));
    const cx = cur.reduce((s, a) => s + a.x, 0) / cur.length;
    const cy = cur.reduce((s, a) => s + a.y, 0) / cur.length;
    const tx = t.atoms.reduce((s, a) => s + a.x, 0) / t.atoms.length;
    const ty = t.atoms.reduce((s, a) => s + a.y, 0) / t.atoms.length;
    order.forEach((id, i) => {
        const a = mol.atoms.find(x => x.id === id);
        const ref = t.atoms[CHAIN_INDEX[i]];
        a.x = ref.x - tx + cx;
        a.y = ref.y - ty + cy;
    });
    // 環内酸素と C1 の結合を切り、アノマーの -OH を C=O に戻す
    mol.removeBond(ringO, c1);
    mol.getBond(c1, anomerO).type = 2;
    return {
        caption: '環が開いて鎖状の D-グルコースになりました。アニメーションは2段階です: ①まず環の配置のまま C1 と環内酸素の結合だけが切れ（教科書の「開いた瞬間」の形）、②そのあと鎖状の形に整列します。C1 の -OH が C=O（アルデヒド）に戻り、環内の酸素は C5 の -OH に戻ります。鎖状ではアルデヒド基が現れるため、銀鏡反応やフェーリング液の還元を示します（グルコースが還元糖である理由）。ここから「環化」を選ぶと α・β のどちらにもなれます。',
        changed: [c1, anomerO, ringO]
    };
}

class Reactor {
    constructor(game) {
        this.game = game;
        this.actionsEl = document.getElementById('reaction-actions');
        this.picking = null; // {rule, sites} 適用箇所の選択待ち
        // 直近反応のスナップショット（前後比較・機構ジャンプ用。P12-5 第1弾）。
        // { ruleId, mechanismId, label, before, after }。before/after はキャンバス全体の
        // 独立コピー（原子ID付き）。直近1件のみ保持し、次の反応で上書き・全消去/モード離脱で破棄
        this.lastReaction = null;
        this.compareOverlay = document.getElementById('rx-compare-overlay');
        this._compareScale = 'md';
        this._compareOpen = false;
        // 実行時モーフィング（P12-5 第2弾）。表示のみ・分子データには一切影響しない
        this._morphing = false;
        this._morphSkip = false;
        this._morphGen = 0;
        // 2段階モーフィングの中間で停止しているときの状態（P12-7 M2f）。
        // { mid, after, gen, highlight } を保持し、クリックで第2段階へ進む
        this._morphPause = null;
    }

    // 「⚗ この分子の反応」カードのボタン列を再構築する（updateDrawing のたびに呼ばれる）
    refresh() {
        if (!this.actionsEl) return;
        this.actionsEl.innerHTML = '';
        this.picking = null;
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return;
        const mol = this.game.userMolecule;
        if (mol.atoms.filter(a => a.element !== 'H').length === 0) {
            // 全消去したら前後比較の記録・モーフィング再生は破棄する（設計 8.1）。
            // 呼び出し元 updateDrawing が空画面を描いた後なので、世代を進めて走行中ループを無効化する
            this._morphGen++;
            this._morphing = false;
            this._morphSkip = false;
            this.exitCompare();
            return;
        }

        REACTION_RULES.forEach(rule => {
            let sites = [];
            try {
                sites = rule.detect(mol);
            } catch (e) {
                console.error('反応ルール検出エラー:', rule.id, e);
                return;
            }
            if (sites.length === 0) return;
            const btn = document.createElement('button');
            btn.className = 'view-btn';
            btn.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px;';
            btn.textContent = rule.label + (sites.length > 1 && !rule.info ? `（${sites.length}箇所）` : '');
            btn.addEventListener('click', () => this.onRuleClick(rule, sites));
            this.actionsEl.appendChild(btn);
        });

        // 直近反応があれば「前後を見る」ボタンを出す（P12-5 第1弾）
        if (this.lastReaction) {
            const cmp = document.createElement('button');
            cmp.className = 'view-btn';
            cmp.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
                'border-color:var(--neon-blue); color:var(--neon-blue);';
            cmp.textContent = `🔍 反応の前後を見る（${this.lastReaction.label}）`;
            cmp.addEventListener('click', () => this.openCompare());
            this.actionsEl.appendChild(cmp);
            // 機構が登録されている反応なら、機構ビューアへジャンプするボタンも出す
            if (this.lastReaction.mechanismId) {
                this.actionsEl.appendChild(this.makeMechanismButton());
            }
        }
    }

    // 「この反応の機構を見る（代表例）」ボタンを作る（反応カード・比較オーバーレイで共用）
    makeMechanismButton() {
        const mech = document.createElement('button');
        mech.className = 'view-btn';
        mech.style.cssText = 'text-align:left; font-size:12px; padding:6px 8px; ' +
            'border-color:var(--neon-pink); color:var(--neon-pink);';
        mech.textContent = '⚗ この反応の機構を見る（代表例）';
        mech.addEventListener('click', () => this.jumpToMechanism());
        return mech;
    }

    // 反応機構ビューア（学習モード）へ切り替えて、対応する機構を代表例の分子で再生する。
    // ユーザーの分子そのものではなく代表例で再生する旨を注記する（設計 8.1）
    jumpToMechanism() {
        const rx = this.lastReaction;
        const mechanismId = rx && rx.mechanismId;
        if (!mechanismId) return;
        const rp = window.reactionPlayer;
        if (!rp || !rp.reactions.length) {
            this.game.showToast('反応機構データが読み込まれていません。');
            return;
        }
        const idx = rp.reactions.findIndex(r => r.id === mechanismId);
        if (idx < 0) {
            this.game.showToast('対応する反応機構が見つかりませんでした。');
            return;
        }
        this.closeCompare();
        // setMode('learn') は exitCompare 経由で lastReaction を破棄するため、idx は先に確定済み
        this.game.setMode('learn');
        if (rp.selectEl) rp.selectEl.value = String(idx);
        rp.enter(idx);
        this.game.showToast('※ あなたの分子そのものではなく、代表例の分子で機構を再生します。', 6000, 'success');
    }

    onRuleClick(rule, sites) {
        if (rule.info) {
            // 解説のみ（実行なし・Undo履歴も積まない）
            this.game.showToast(rule.apply().caption, 6000, 'success');
            return;
        }
        this.narrow(rule, sites);
    }

    // 適用箇所が複数あるときは、候補を分けている原子だけをハイライトしてクリックで絞り込む。
    // 1クリックで決まらない場合（カルボン酸×アルコールの組み合わせなど）は繰り返し絞り込む
    narrow(rule, sites) {
        if (sites.length === 1) {
            this.execute(rule, sites[0]);
            return;
        }
        this.picking = { rule, sites };
        const ids = new Set();
        sites.forEach(s => s.forEach(id => ids.add(id)));
        const distinguishing = [...ids].filter(id => !sites.every(s => s.includes(id)));
        const pickIds = distinguishing.length ? distinguishing : [...ids];
        const atoms = pickIds
            .map(id => this.game.userMolecule.atoms.find(a => a.id === id))
            .filter(Boolean);
        this.game.highlightAtoms(atoms);
        this.game.showToast('反応させたい箇所（ハイライトした原子）をクリックしてください。', 5000, 'success');
    }

    // 適用箇所の選択モード中、キャンバスのクリックを消費する（game.handleMouseDown から呼ばれる）
    handlePick(atom) {
        if (!this.picking) return false;
        const { rule, sites } = this.picking;
        this.picking = null;
        this.game.clearUIOverlay();
        if (atom) {
            const matched = sites.filter(s => s.includes(atom.id));
            if (matched.length === 1) {
                this.execute(rule, matched[0]);
                return true;
            }
            if (matched.length > 1) {
                this.narrow(rule, matched); // まだ決まらないので再度選ばせる
                return true;
            }
        }
        this.game.showToast('適用箇所の選択を解除しました。');
        return true;
    }

    execute(rule, site) {
        const g = this.game;
        // 2段階モーフィングの中間で止まっている状態から次の反応を実行するときは、
        // **画面に見えている中間の配置**を実際の座標として引き継ぐ（P12-7 M2f）。
        // これをしないと、内部で確定済みの「整列後」の座標から変化が始まり、
        // 見えている図と繋がらない（開環で止めた図から環化すると飛んで見える）。
        // 座標だけの引き継ぎなので、結合・元素・判定には影響しない（座標は見た目専用）
        this.adoptPausedLayout();
        g.saveState();
        // 反応前のキャンバス全体を写す（差分ハイライトのため原子ID付き。apply が壊す前に取る）
        const before = this.snapshotMolecule(g.userMolecule);
        let result;
        try {
            result = rule.apply(g, site);
        } catch (e) {
            console.error('反応実行エラー:', rule.id, e);
            // 途中まで書き換えている可能性があるため、開始時の状態へ確実に戻す
            // （履歴を捨てるだけでは中途半端な分子が残ってしまう）
            const saved = g.history.pop();
            if (saved) g.restoreState(JSON.parse(saved));
            g.showToast('この反応は実行できませんでした: ' + e.message);
            return;
        }
        // 直近反応を記録（前後比較・機構ジャンプ・モーフィングで共用）
        this.lastReaction = {
            ruleId: rule.id,
            mechanismId: rule.mechanismId || null,
            label: rule.label,
            before,
            after: this.snapshotMolecule(g.userMolecule)
        };
        if (this._compareOpen) this.closeCompare(); // 前の比較が開いていれば閉じる（次の反応で上書き）
        // 生成物データは確定済み。前→後をモーフィングで見せ、完了後に通常描画＋変化箇所ハイライト
        this.animateExecution(before, this.lastReaction.after, result, rule.morphStages || null);
    }

    // ===== 実行時モーフィング（P12-5 第2弾。表示のみ・検証/Undo/監査には一切影響しない） =====

    // 反応適用後の見せ方。分子データは即確定させ（通常描画・カード更新・解説を同期で行う）、
    // その上で約0.8秒のモーフィング（前→後）を表示のみ重ねる。完了時に通常描画へ戻して自動水素を出す。
    // reduced-motion 環境や rAF が無い場合はアニメせず即確定（＝「検証はトポロジーのみ」に整合）
    // 中間スナップショットを作る（2段階モーフィング用。P12-7 M2f）。
    // 'bondsFirst': 結合だけ先に変え、原子は反応前の位置のまま（開環＝ほぼ環の配置のまま開く）
    // 'moveFirst' : 配置だけ先に動かし、結合は反応前のまま（環化＝先に環の形へ折りたたむ）
    buildMidSnapshot(before, after, mode) {
        const beforeById = new Map(before.atoms.map(a => [a.id, a]));
        const afterById = new Map(after.atoms.map(a => [a.id, a]));
        if (mode === 'bondsFirst') {
            const atoms = after.atoms.map(a => {
                const b = beforeById.get(a.id);
                return b ? { ...a, x: b.x, y: b.y } : { ...a };
            });
            return { atoms, bonds: after.bonds.map(b => ({ ...b })) };
        }
        const atoms = before.atoms.map(a => {
            const af = afterById.get(a.id);
            return af ? { ...a, x: af.x, y: af.y } : { ...a };
        });
        return { atoms, bonds: before.bonds.map(b => ({ ...b })) };
    }

    // スナップショットから一時的な Molecule を作る（中間状態の自動水素を計算するため）
    molFromSnapshot(snap) {
        const m = new Molecule();
        snap.atoms.forEach(a => m.atoms.push(new Atom(a.id, a.element, a.x, a.y)));
        snap.bonds.forEach(b => m.bonds.push(new Bond(b.atomId1, b.atomId2, b.type)));
        return m;
    }

    // 中間状態を静止画として描く。**自動水素も計算して描く**ので、
    // 「開いた瞬間」の水素の数・位置が正しく見える（P12-7 M2f。ユーザー要望）
    renderStaticSnapshotWithHydrogens(snap) {
        const g = this.game;
        g.atomsGroup.innerHTML = '';
        g.bondsGroup.innerHTML = '';
        const m = this.molFromSnapshot(snap);
        const hs = m.calculateHydrogens();
        hs.forEach(h => {
            const p = m.atoms.find(a => a.id === h.parentId);
            if (p) g.renderBond(p.x, p.y, h.x, h.y, 1, true);
        });
        m.bonds.forEach(b => {
            const a1 = m.atoms.find(a => a.id === b.atomId1);
            const a2 = m.atoms.find(a => a.id === b.atomId2);
            if (a1 && a2) g.renderBond(a1.x, a1.y, a2.x, a2.y, b.type, false);
        });
        hs.forEach((h, i) => g.renderAtom(`morphH_${i}`, 'H', h.x, h.y, false));
        m.atoms.forEach(a => g.renderAtom(`morph_${a.id}`, a.element, a.x, a.y, false));
    }

    // 2段階モーフィングの中間で止まっているとき、画面に見えている中間の配置を
    // 実際の分子の座標として引き継ぎ、停止状態を解除する（P12-7 M2f）。
    // 「見えている図から次の変化が始まる」ようにするための処理で、座標のみを触る。
    // 引き継がない場合は内部で確定済みの最終配置（例: 整列後の鎖状）から変化が始まってしまう。
    adoptPausedLayout() {
        const p = this._morphPause;
        if (!p) return false;
        this._morphPause = null;
        this._morphing = false;
        this._morphSkip = false;
        this._morphGen++; // 走行中のループがあれば無効化する
        const mol = this.game.userMolecule;
        p.mid.atoms.forEach(sa => {
            const a = mol.atoms.find(x => x.id === sa.id);
            if (a) { a.x = sa.x; a.y = sa.y; }
        });
        this.game.updateDrawing();
        return true;
    }

    // 中間で止めた2段階モーフィングの続き（第2段階）を再生する。クリックで呼ばれる
    advanceMorph() {
        const p = this._morphPause;
        if (!p) return false;
        this._morphPause = null;
        const gen = p.gen;
        if (this._morphGen !== gen) return false;
        const smoothstep = t => t * t * (3 - 2 * t);
        animateFramesLoop(
            800,
            t => { if (this._morphGen === gen) this.renderMorphFrame(p.mid, p.after, smoothstep(t)); },
            () => this._morphSkip || this._morphGen !== gen
        ).then(() => {
            if (this._morphGen !== gen) return;
            this._morphing = false;
            this.game.updateDrawing();
            p.highlight();
        });
        return true;
    }

    animateExecution(before, after, result, morphStages = null) {
        const g = this.game;
        // まず生成物を確定表示（判定・カード・名称は同期で最終状態に。テスト・監査に影響させない）
        g.updateDrawing();
        g.showToast(result.caption, 6500, 'success');
        const highlight = () => {
            if (result.changed) {
                const atoms = result.changed
                    .map(id => g.userMolecule.atoms.find(a => a.id === id))
                    .filter(Boolean);
                g.highlightAtoms(atoms); // 変化した箇所をハイライトで示す
            }
        };
        if (this._reducedMotion() || typeof requestAnimationFrame !== 'function' || !before || !after) {
            highlight();
            return;
        }
        // モーフィングは表示のみの上書き。世代トークンで多重・中断を安全に扱う
        const gen = ++this._morphGen;
        this._morphing = true;
        this._morphSkip = false;
        this.renderMorphFrame(before, after, 0); // 先に反応前を描き、生成物→反応物のちらつきを防ぐ
        const smoothstep = t => t * t * (3 - 2 * t);
        // 変化が大きい反応（環化・開環）は2段階に分けて見せる。前半＝最小限の変化（結合だけ／配置だけ）、
        // 後半＝残りの変化。中間で少し止めて、どこが変わったか目で追えるようにする（P12-7 M2f）
        const mid = morphStages ? this.buildMidSnapshot(before, after, morphStages) : null;
        if (mid) {
            // 第1段階だけ再生し、**中間状態で止める**（自動水素つきで静止表示）。
            // 続きはユーザーのクリックで進める＝じっくり観察できる（P12-7 M2f。ユーザー要望）
            animateFramesLoop(
                700,
                t => { if (this._morphGen === gen) this.renderMorphFrame(before, mid, smoothstep(t)); },
                () => this._morphSkip || this._morphGen !== gen
            ).then(() => {
                if (this._morphGen !== gen) return;
                if (this._morphSkip) { // 途中でタップされたら最終状態へ
                    this._morphing = false;
                    g.updateDrawing();
                    highlight();
                    return;
                }
                this._morphPause = { mid, after, gen, highlight };
                this.renderStaticSnapshotWithHydrogens(mid);
                const next = morphStages === 'bondsFirst' ? '鎖状に整列します' : '結合ができて環が閉じます';
                g.showToast(`①第1段階（${morphStages === 'bondsFirst' ? '環の形のまま結合が切れた' : '環の形に折りたたんだ'}状態）で止めています。ここで水素の数と位置も確認できます。画面をクリックすると②${next}。`, 9000);
            });
            return;
        }
        animateFramesLoop(
            800,
            t => { if (this._morphGen === gen) this.renderMorphFrame(before, after, smoothstep(t)); },
            () => this._morphSkip || this._morphGen !== gen
        ).then(() => {
            if (this._morphGen !== gen) return; // 別の描画に上書きされた（多重反応・中断）
            this._morphing = false;
            g.updateDrawing(); // 自動水素を含む最終分子を描き直す
            highlight();
        });
    }

    _reducedMotion() {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // 進行中のモーフィングを即終了して最終描画へ戻す（世代を進めて走行中ループの完了処理を無効化）
    finalizeMorph() {
        if (!this._morphing) return;
        this._morphGen++;
        this._morphing = false;
        this._morphSkip = false;
        this._morphPause = null; // 2段階の途中で止めていた状態も破棄する
        this.game.updateDrawing();
    }

    // 再生中のキャンバス操作の窓口（game.handleMouseDown から呼ばれる）。
    // 再生中はモーフィングを即終了する。適用箇所の選択待ち（picking）中は操作を続行させ、
    // それ以外の通常タップは「スキップのみ」として true（＝イベント消費）を返す
    skipMorph() {
        if (!this._morphing) return false;
        const wasPicking = this.picking; // finalizeMorph の再描画で picking が消えるため退避・復元
        // 2段階の中間で止まっているときは「スキップ」ではなく第2段階へ進む（P12-7 M2f）
        if (this._morphPause) {
            this.advanceMorph();
            this.picking = wasPicking;
            return !wasPicking;
        }
        this.finalizeMorph();
        this.picking = wasPicking;
        return !wasPicking;
    }

    // before/after を t(0→1) で補間した描画データを返す純関数。原子はID対応で照合し、
    // 共通原子は座標を線形補間、脱離原子はフェードアウト、付加原子はフェードイン、
    // 結合は次数変化をクロスフェード・生成/消滅をフェードで表す（DOM非依存＝テスト可能）
    interpolateMorph(before, after, t) {
        const lerp = (a, b) => a + (b - a) * t;
        const clamp = o => Math.max(0, Math.min(1, o));
        const afterById = new Map(after.atoms.map(a => [a.id, a]));
        const beforeById = new Map(before.atoms.map(a => [a.id, a]));
        const atoms = [];
        before.atoms.forEach(a => {
            const af = afterById.get(a.id);
            if (af) atoms.push({ id: a.id, element: a.element, x: lerp(a.x, af.x), y: lerp(a.y, af.y), opacity: 1 });
            else atoms.push({ id: a.id, element: a.element, x: a.x, y: a.y, opacity: clamp(1 - t) }); // 脱離
        });
        after.atoms.forEach(a => {
            if (!beforeById.has(a.id)) atoms.push({ id: a.id, element: a.element, x: a.x, y: a.y, opacity: clamp(t) }); // 付加
        });
        const posById = new Map(atoms.map(a => [a.id, a]));
        const key = b => b.atomId1 < b.atomId2 ? `${b.atomId1} ${b.atomId2}` : `${b.atomId2} ${b.atomId1}`;
        const beforeB = new Map(before.bonds.map(b => [key(b), b]));
        const afterB = new Map(after.bonds.map(b => [key(b), b]));
        const bonds = [];
        new Set([...beforeB.keys(), ...afterB.keys()]).forEach(k => {
            const fb = beforeB.get(k), tb = afterB.get(k);
            const b = fb || tb;
            const p1 = posById.get(b.atomId1), p2 = posById.get(b.atomId2);
            if (!p1 || !p2) return;
            const push = (type, opacity) => bonds.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, type, opacity: clamp(opacity) });
            if (fb && tb) {
                if (fb.type === tb.type) push(fb.type, 1);
                else { push(fb.type, 1 - t); push(tb.type, t); } // 次数変化はクロスフェード
            } else if (fb) push(fb.type, 1 - t); // 切れる結合はフェードアウト
            else push(tb.type, t);               // 生じる結合はフェードイン
        });
        return { atoms, bonds };
    }

    // 補間1フレームを実キャンバス（atomsGroup/bondsGroup）に描く。自動水素は省略（完了時に通常描画で出る）
    renderMorphFrame(before, after, t) {
        const g = this.game;
        g.atomsGroup.innerHTML = '';
        g.bondsGroup.innerHTML = '';
        const frame = this.interpolateMorph(before, after, t);
        frame.bonds.forEach(bd => {
            const start = g.bondsGroup.childElementCount;
            g.renderBond(bd.x1, bd.y1, bd.x2, bd.y2, bd.type, false);
            for (let i = start; i < g.bondsGroup.children.length; i++) {
                g.bondsGroup.children[i].setAttribute('opacity', String(bd.opacity));
            }
        });
        frame.atoms.forEach(a => {
            const start = g.atomsGroup.childElementCount;
            g.renderAtom(`morph_${a.id}`, a.element, a.x, a.y, false);
            for (let i = start; i < g.atomsGroup.children.length; i++) {
                g.atomsGroup.children[i].setAttribute('opacity', String(a.opacity));
            }
        });
    }

    // ===== 反応の前後比較（P12-5 第1弾） =====

    // キャンバス全体を独立コピー（原子ID付き）で写す。自動水素は含めない（描画時に再計算される）
    snapshotMolecule(mol) {
        return {
            atoms: mol.atoms.map(a => ({ id: a.id, element: a.element, x: a.x, y: a.y, charge: a.charge || 0 })),
            bonds: mol.bonds.map(b => ({ atomId1: b.atomId1, atomId2: b.atomId2, type: b.type }))
        };
    }

    // スナップショット（ID基準）を target 形式（index基準）へ変換して既存の描画関数で描けるようにする
    snapshotToTarget(snapshot) {
        const idx = new Map(snapshot.atoms.map((a, i) => [a.id, i]));
        return {
            atoms: snapshot.atoms.map(a => ({ element: a.element, x: a.x, y: a.y, charge: a.charge })),
            bonds: snapshot.bonds.map(b => ({
                atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type
            }))
        };
    }

    // before/after の原子IDを突き合わせて差分を機械的に求める（reactor はIDを保持するので照合はID一致で取れる）。
    // 原子IDは "atom_xxxx" のような文字列なので、キーは区切りに   を使い、結合はオブジェクトごと保持する
    computeDiff(before, after) {
        const beforeIds = new Set(before.atoms.map(a => a.id));
        const afterIds = new Set(after.atoms.map(a => a.id));
        const heavy = a => a.element !== 'H';
        const removedAtoms = before.atoms.filter(a => !afterIds.has(a.id) && heavy(a)); // 脱離
        const addedAtoms = after.atoms.filter(a => !beforeIds.has(a.id) && heavy(a));    // 付加
        const key = b => b.atomId1 < b.atomId2 ? `${b.atomId1} ${b.atomId2}` : `${b.atomId2} ${b.atomId1}`;
        const mapOf = bonds => { const m = new Map(); bonds.forEach(b => m.set(key(b), b)); return m; };
        const beforeB = mapOf(before.bonds), afterB = mapOf(after.bonds);
        const typeAt = (m, k) => (m.has(k) ? m.get(k).type : 0);
        const seg = (snap, b) => {
            const a = snap.atoms.find(x => x.id === b.atomId1), c = snap.atoms.find(x => x.id === b.atomId2);
            return a && c ? { x1: a.x, y1: a.y, x2: c.x, y2: c.y } : null;
        };
        const lostBonds = [];   // 消えた・次数が下がった結合 → 反応前の図
        beforeB.forEach((b, k) => { if (b.type > typeAt(afterB, k)) { const s = seg(before, b); if (s) lostBonds.push(s); } });
        const gainedBonds = []; // 生成した・次数が上がった結合 → 反応後の図
        afterB.forEach((b, k) => { if (b.type > typeAt(beforeB, k)) { const s = seg(after, b); if (s) gainedBonds.push(s); } });
        return { removedAtoms, addedAtoms, lostBonds, gainedBonds };
    }

    openCompare() {
        if (!this.lastReaction || !this.compareOverlay) return;
        this._compareOpen = true;
        this.compareOverlay.classList.remove('hidden');
        this.compareOverlay.scrollTop = 0;
        this.renderCompare();
    }

    closeCompare() {
        if (this.compareOverlay) this.compareOverlay.classList.add('hidden');
        this._compareOpen = false;
    }

    // 記録ごと破棄（全消去・モード離脱時）。開いていれば閉じてから
    exitCompare() {
        this.closeCompare();
        this.lastReaction = null;
    }

    setCompareScale(scale) {
        this._compareScale = scale;
        this.renderCompare();
    }

    renderCompare() {
        const ov = this.compareOverlay;
        if (!ov || !this.lastReaction) return;
        const NS = 'http://www.w3.org/2000/svg';
        const SCALES = (typeof IP_REVIEW_SCALES !== 'undefined')
            ? IP_REVIEW_SCALES
            : { sm: { col: 118, h: 92 }, md: { col: 172, h: 128 }, lg: { col: 244, h: 182 } };
        const sc = SCALES[this._compareScale] || SCALES.md;
        const ORANGE = 'var(--neon-orange)', CYAN = 'var(--neon-blue)', GREEN = 'var(--neon-green)';
        const rx = this.lastReaction;
        const diff = this.computeDiff(rx.before, rx.after);
        ov.innerHTML = '';

        // ヘッダー: タイトル＋反応名 ＋ 図サイズ切替（小/中/大。IP_REVIEW_SCALES を共用）
        const headRow = document.createElement('div');
        headRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap;';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:15px; color:#fff; font-weight:bold;';
        title.textContent = `反応の前後 — ${rx.label}`;
        headRow.appendChild(title);
        const sizeWrap = document.createElement('div');
        sizeWrap.style.cssText = 'display:flex; gap:4px; align-items:center;';
        const sizeLabel = document.createElement('span');
        sizeLabel.style.cssText = 'font-size:11px; color:var(--text-secondary);';
        sizeLabel.textContent = '図の大きさ:';
        sizeWrap.appendChild(sizeLabel);
        [['sm', '小'], ['md', '中'], ['lg', '大']].forEach(([k, lab]) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            const on = this._compareScale === k;
            b.style.cssText = 'font-size:12px; padding:4px 10px;' +
                (on ? ' border-color:var(--neon-blue); color:var(--neon-blue);' : '');
            b.textContent = lab;
            b.addEventListener('click', () => this.setCompareScale(k));
            sizeWrap.appendChild(b);
        });
        headRow.appendChild(sizeWrap);
        ov.appendChild(headRow);

        // 2図（反応前 / 反応後）を並置
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:10px;';
        const pending = [];
        const makeFig = (caption, snapshot, marks, accent) => {
            const cell = document.createElement('div');
            cell.style.cssText = 'background:rgba(10,14,24,0.85); border:1px solid rgba(255,255,255,0.14); ' +
                'border-radius:8px; padding:4px; text-align:center; cursor:pointer;';
            cell.title = 'クリックで描画に戻る';
            const cap = document.createElement('div');
            cap.style.cssText = `font-size:12px; font-weight:bold; margin-bottom:2px; color:${accent};`;
            cap.textContent = caption;
            cell.appendChild(cap);
            const svg = document.createElementNS(NS, 'svg');
            svg.id = 'rx-cmp-svg-' + (Reactor._seq = (Reactor._seq || 0) + 1);
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', String(Math.round(sc.h * 1.25)));
            const bg = document.createElementNS(NS, 'g'); bg.setAttribute('class', 'quiz-bonds');
            const ag = document.createElementNS(NS, 'g'); ag.setAttribute('class', 'quiz-atoms');
            svg.appendChild(bg); svg.appendChild(ag);
            cell.appendChild(svg);
            cell.addEventListener('click', () => this.closeCompare());
            pending.push({ id: svg.id, snapshot, marks });
            grid.appendChild(cell);
        };
        makeFig('反応前', rx.before, {
            atoms: diff.removedAtoms.map(a => ({ x: a.x, y: a.y, color: ORANGE })),
            bonds: diff.lostBonds.map(b => ({ ...b, color: ORANGE, dashed: true }))
        }, ORANGE);
        makeFig('反応後', rx.after, {
            atoms: diff.addedAtoms.map(a => ({ x: a.x, y: a.y, color: GREEN })),
            bonds: diff.gainedBonds.map(b => ({ ...b, color: CYAN, dashed: false }))
        }, CYAN);
        ov.appendChild(grid);

        // 凡例
        const legend = document.createElement('div');
        legend.style.cssText = 'font-size:11px; color:var(--text-secondary); line-height:1.7; margin-bottom:10px;';
        legend.innerHTML = '<span style="color:var(--neon-orange);">● オレンジ</span>＝切れた結合・脱離した原子（反応前）　' +
            '<span style="color:var(--neon-blue);">● シアン</span>＝できた結合、' +
            '<span style="color:var(--neon-green);">● 緑</span>＝付加した原子（反応後）';
        ov.appendChild(legend);

        // 機構が登録されている反応なら「機構を見る（代表例）」の注記と案内を添える
        if (rx.mechanismId) {
            const note = document.createElement('div');
            note.style.cssText = 'font-size:11px; color:var(--neon-pink); line-height:1.6; margin-bottom:10px;';
            note.textContent = '※「機構を見る」を押すと学習モードに切り替わり、あなたの分子そのものではなく代表例の分子で機構を再生します。';
            ov.appendChild(note);
        }

        // 操作ボタン（戻る／機構を見る）
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'position:sticky; bottom:0; display:flex; gap:8px; padding:8px 0 2px; background:linear-gradient(transparent, rgba(6,10,20,0.92) 35%);';
        const back = document.createElement('button');
        back.className = 'primary-btn';
        back.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px;';
        back.textContent = '← 描画に戻る';
        back.addEventListener('click', () => this.closeCompare());
        btnRow.appendChild(back);
        if (rx.mechanismId) {
            const mech = this.makeMechanismButton();
            mech.style.cssText = 'flex:1 1 0; padding:9px; font-size:13px; text-align:center; ' +
                'border-color:var(--neon-pink); color:var(--neon-pink);';
            btnRow.appendChild(mech);
        }
        ov.appendChild(btnRow);

        // svg が DOM に入った後に描画（renderMoleculeIntoSvg は getElementById を使う）
        pending.forEach(p => this.renderCompareFigure(p.id, p.snapshot, p.marks));
    }

    // 1図を描き、その上に差分ハイライト（原子の枠・結合の強調）を重ねる。
    // viewBox 座標＝スナップショット座標なので、marks の x/y をそのまま使える
    renderCompareFigure(svgId, snapshot, marks) {
        renderMoleculeIntoSvg(this.game, svgId, this.snapshotToTarget(snapshot));
        const svg = document.getElementById(svgId);
        if (!svg) return;
        const NS = 'http://www.w3.org/2000/svg';
        const hi = document.createElementNS(NS, 'g');
        (marks.bonds || []).forEach(bm => {
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', bm.x1); line.setAttribute('y1', bm.y1);
            line.setAttribute('x2', bm.x2); line.setAttribute('y2', bm.y2);
            line.setAttribute('stroke', bm.color);
            line.setAttribute('stroke-width', '7');
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('opacity', bm.dashed ? '0.9' : '0.5');
            if (bm.dashed) line.setAttribute('stroke-dasharray', '3 8');
            line.setAttribute('class', 'rx-diff-mark');
            hi.appendChild(line);
        });
        (marks.atoms || []).forEach(am => {
            const c = document.createElementNS(NS, 'circle');
            c.setAttribute('cx', am.x); c.setAttribute('cy', am.y);
            c.setAttribute('r', '18');
            c.setAttribute('fill', 'none');
            c.setAttribute('stroke', am.color);
            c.setAttribute('stroke-width', '3');
            c.setAttribute('class', 'rx-diff-mark');
            hi.appendChild(c);
        });
        svg.appendChild(hi);
    }
}

// テスト（test.html）・コンソールデバッグ用にグローバル公開する。
// const はトップレベルでも window のプロパティにならないため明示が必要（chemistry.js と同じ流儀）。
if (typeof window !== 'undefined') {
    window.REACTION_RULES = REACTION_RULES;
}
