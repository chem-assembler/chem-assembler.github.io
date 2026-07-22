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
function aromaticSites(mol) {
    const keys = findAromaticBondKeys(mol);
    const ids = new Set();
    mol.bonds.forEach(b => {
        const k = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        if (keys.has(k)) {
            ids.add(b.atomId1);
            ids.add(b.atomId2);
        }
    });
    return [...ids].filter(id => mol.getFreeValency(id) >= 1).map(id => [id]);
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
function attachGroup(mol, cId, kind) {
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
    throw new Error('置換基を置く空間がありません。まわりを空けてから実行してください');
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
        label: '分子内脱水（-H₂O） → アルケン',
        detect(mol) {
            const sites = [];
            findFunctionalGroups(mol)
                .filter(g => ['alcohol1', 'alcohol2', 'alcohol3'].includes(g.type))
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
        label: '芳香族置換: ニトロ化（濃硝酸＋濃硫酸）',
        detect: aromaticSites,
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
        label: '芳香族置換: スルホン化（濃硫酸）',
        detect: aromaticSites,
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
        label: '芳香族置換: 塩素化（Cl₂・鉄触媒）',
        detect: aromaticSites,
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
    }
];

class Reactor {
    constructor(game) {
        this.game = game;
        this.actionsEl = document.getElementById('reaction-actions');
        this.picking = null; // {rule, sites} 適用箇所の選択待ち
    }

    // 「⚗ この分子の反応」カードのボタン列を再構築する（updateDrawing のたびに呼ばれる）
    refresh() {
        if (!this.actionsEl) return;
        this.actionsEl.innerHTML = '';
        this.picking = null;
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return;
        const mol = this.game.userMolecule;
        if (mol.atoms.filter(a => a.element !== 'H').length === 0) return;

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
        g.saveState();
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
        g.updateDrawing();
        if (result.changed) {
            const atoms = result.changed
                .map(id => g.userMolecule.atoms.find(a => a.id === id))
                .filter(Boolean);
            g.highlightAtoms(atoms); // 変化した箇所をハイライトで示す
        }
        g.showToast(result.caption, 6500, 'success');
    }
}
