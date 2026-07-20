/**
 * Chemistry Logic for Chem-Assembler
 * 原子、結合、分子データ構造、およびトポロジー判定（グラフ同型性）を管理します。
 */

// 各原子の最大価標（結合手の数）
const VALENCIES = {
    'C': 4,
    'O': 2,
    'N': 3,
    'Cl': 1,
    'Br': 1,
    'S': 6,
    'H': 1
};

class Atom {
    constructor(id, element, x, y, isLocked = false) {
        this.id = id;
        this.element = element; // 'C', 'O', 'N', 'Cl', 'H'
        this.x = x; // 画面上の描画位置（またはグリッド座標）
        this.y = y;
        this.isLocked = isLocked; // 固定原子か
        this.isAsymmetricMarked = false; // ユーザーが不斉炭素としてマークしたか
    }
}

class Bond {
    constructor(atomId1, atomId2, type = 1) {
        // IDの小さい方を常に atomId1 にして一意にする
        if (atomId1 < atomId2) {
            this.atomId1 = atomId1;
            this.atomId2 = atomId2;
        } else {
            this.atomId1 = atomId2;
            this.atomId2 = atomId1;
        }
        this.type = parseInt(type); // 1: 単結合, 2: 二重結合, 3: 三重結合
    }
}

/**
 * 分子構造クラス
 */
class Molecule {
    constructor() {
        this.atoms = []; // Atom オブジェクトのリスト
        this.bonds = []; // Bond オブジェクトのリスト
        this.deletedBonds = []; // 手動で削除された結合のキー (例: 'atom1_atom2') のリスト
    }

    addAtom(element, x, y, isLocked = false) {
        const id = 'atom_' + Math.random().toString(36).substr(2, 9);
        const atom = new Atom(id, element, x, y, isLocked);
        this.atoms.push(atom);
        return atom;
    }

    removeAtom(atomId) {
        // 削除される原子に関連する結合を特定し、deletedBonds 履歴からは除外（原子自体が消えるため）
        const relatedBonds = this.getBondsForAtom(atomId);
        relatedBonds.forEach(b => {
            const key = [b.atomId1, b.atomId2].sort().join('_');
            this.deletedBonds = this.deletedBonds.filter(k => k !== key);
        });

        this.atoms = this.atoms.filter(a => a.id !== atomId);
        // 関連する結合も削除
        this.bonds = this.bonds.filter(b => b.atomId1 !== atomId && b.atomId2 !== atomId);
    }

    addBond(atomId1, atomId2, type = 1) {
        if (atomId1 === atomId2) return null;
        
        // 手動で結合が結ばれた場合は、削除履歴から削除
        const key = [atomId1, atomId2].sort().join('_');
        this.deletedBonds = this.deletedBonds.filter(k => k !== key);

        // 既存の結合があるかチェック
        const existing = this.getBond(atomId1, atomId2);
        if (existing) {
            existing.type = type; // 結合種の上書き
            return existing;
        }

        const bond = new Bond(atomId1, atomId2, type);
        this.bonds.push(bond);
        return bond;
    }

    removeBond(atomId1, atomId2) {
        const id1 = atomId1 < atomId2 ? atomId1 : atomId2;
        const id2 = atomId1 < atomId2 ? atomId2 : atomId1;
        
        // 削除履歴に登録
        const key = [id1, id2].sort().join('_');
        if (!this.deletedBonds.includes(key)) {
            this.deletedBonds.push(key);
        }

        this.bonds = this.bonds.filter(b => !(b.atomId1 === id1 && b.atomId2 === id2));
    }

    getBond(atomId1, atomId2) {
        const id1 = atomId1 < atomId2 ? atomId1 : atomId2;
        const id2 = atomId1 < atomId2 ? atomId2 : atomId1;
        return this.bonds.find(b => b.atomId1 === id1 && b.atomId2 === id2) || null;
    }

    // 特定の原子に接続している結合リストを取得
    getBondsForAtom(atomId) {
        return this.bonds.filter(b => b.atomId1 === atomId || b.atomId2 === atomId);
    }

    // 特定の原子に隣接する原子のリストを取得
    getNeighbors(atomId) {
        const neighbors = [];
        this.bonds.forEach(b => {
            if (b.atomId1 === atomId) {
                const neighbor = this.atoms.find(a => a.id === b.atomId2);
                if (neighbor) neighbors.push({ atom: neighbor, type: b.type });
            } else if (b.atomId2 === atomId) {
                const neighbor = this.atoms.find(a => a.id === b.atomId1);
                if (neighbor) neighbors.push({ atom: neighbor, type: b.type });
            }
        });
        return neighbors;
    }

    // 現在使われている結合手の総数を計算
    getUsedValency(atomId) {
        const neighbors = this.getNeighbors(atomId);
        return neighbors.reduce((sum, n) => sum + n.type, 0);
    }

    // 残りの結合手（水素が必要な数）を計算
    getFreeValency(atomId) {
        const atom = this.atoms.find(a => a.id === atomId);
        if (!atom) return 0;
        const maxVal = VALENCIES[atom.element] || 0;
        const usedVal = this.getUsedValency(atomId);
        return Math.max(0, maxVal - usedVal);
    }

    /**
     * 水素原子(H)の自動レイアウト位置を計算する
     * 各重原子ごとに、接続された他の重原子と反対方向にHを放射状に配置する座標を返す
     */
    calculateHydrogens() {
        const hydrogens = []; // 描画用の一時的な水素座標リスト

        this.atoms.forEach(atom => {
            if (atom.element === 'H') return; // 水素自体からはさらに水素を生やさない
            
            const freeVal = this.getFreeValency(atom.id);
            if (freeVal <= 0) return;

            const neighbors = this.getNeighbors(atom.id).filter(n => n.atom.element !== 'H');
            
            // 1. 実際に結合している隣接重原子への角度 (絶対に水素を生やしてはならない方向)
            const bondedAngles = neighbors.map(n => Math.atan2(n.atom.y - atom.y, n.atom.x - atom.x));

            // 2. 結合していないが、近く（75px以内）にある重原子への角度 (できれば避けたい方向)
            const nonBondedNearAngles = [];
            this.atoms.forEach(other => {
                if (other.id === atom.id || other.element === 'H') return;
                if (neighbors.some(n => n.atom.id === other.id)) return;
                
                const dx = other.x - atom.x;
                const dy = other.y - atom.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist <= 75) {
                    nonBondedNearAngles.push(Math.atan2(dy, dx));
                }
            });

            // 避けるための全対象角度
            const allAvoidAngles = [...bondedAngles, ...nonBondedNearAngles];

            // 水素を伸ばす基本の長さ（小さくなった原子に合わせて 16px に設定）
            const bondLen = 16;

            let hAngles = [];

            // 多重結合を優先的にチェック（三重→二重の順。混在は価標上まれだが三重を優先）
            const hasTripleBond = neighbors.some(n => n.type === 3);
            const hasDoubleBond = neighbors.some(n => n.type === 2);

            if (neighbors.length === 0) {
                // 近隣原子がない場合、四方に等間隔で配置
                for (let i = 0; i < freeVal; i++) {
                    hAngles.push((i * Math.PI) / 2); // 90度刻み
                }
            } else if (hasTripleBond && neighbors.length === 1) {
                // 三重結合の端の原子（H–C≡C– など）は直線形(sp)：
                // 残りのHは結合の反対側（180°）に配置する（手書きの H–C≡C–H と同じ描き方。開発方針1.1章）
                hAngles.push(bondedAngles[0] + Math.PI);
            } else if (hasDoubleBond) {
                // 二重結合（C=C）の端にある炭素は、化学的に正しい120度（平面三角形型）で水素を配置
                if (neighbors.length === 1) {
                    const baseAngle = bondedAngles[0];
                    hAngles.push(baseAngle + (2 * Math.PI) / 3);
                    hAngles.push(baseAngle - (2 * Math.PI) / 3);
                } else if (neighbors.length === 2 && freeVal === 1) {
                    // 二重結合と単結合が1つずつある場合、残りの1つのHは空き方向に伸ばす
                    let diff = bondedAngles[1] - bondedAngles[0];
                    while (diff < -Math.PI) diff += 2 * Math.PI;
                    while (diff > Math.PI) diff -= 2 * Math.PI;
                    const avgAngle = bondedAngles[0] + diff / 2 + Math.PI;
                    hAngles.push(avgAngle);
                }
            } else {
                // 直交（sp3）原子の水素配置：接続元が斜めでも、水素は絶対座標のグリッド方向（上下左右）に伸ばす
                const candidates = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
                const available = [];
                
                candidates.forEach(cand => {
                    // ① 実際に結合している方向と重なる・非常に近い（角度差45度以内）場合は、無条件で完全除外！
                    const isBondDirection = bondedAngles.some(ang => {
                        let diff = Math.abs(cand - ang);
                        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                        return diff < Math.PI / 4;
                    });
                    if (isBondDirection) return;

                    // ② すべての避けるべき角度（非結合隣接など）との角度差が60度以内かチェック
                    const tooClose = allAvoidAngles.some(ang => {
                        let diff = Math.abs(cand - ang);
                        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                        return diff < Math.PI / 3; // 60度以内なら除外
                    });
                    
                    if (!tooClose) {
                        available.push(cand);
                    }
                });
                
                // 必要な数だけ利用可能な候補から採用
                for (let i = 0; i < Math.min(freeVal, available.length); i++) {
                    hAngles.push(available[i]);
                }
                
                // 足りない場合は、結合している方向以外のスロットから補填する
                if (hAngles.length < freeVal) {
                    const backupCandidates = candidates.filter(c => {
                        // 実際に結合している方向からは45度以上離れているもののみバックアップ許可
                        const isBondDirection = bondedAngles.some(ang => {
                            let diff = Math.abs(c - ang);
                            while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                            return diff < Math.PI / 4;
                        });
                        return !isBondDirection && !available.includes(c);
                    });

                    // 近隣の非結合重原子からできるだけ遠い順にソート
                    backupCandidates.sort((c1, c2) => {
                        const minDist1 = nonBondedNearAngles.length > 0 ? Math.min(...nonBondedNearAngles.map(ang => {
                            let diff = Math.abs(c1 - ang);
                            while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                            return diff;
                        })) : Math.PI;
                        
                        const minDist2 = nonBondedNearAngles.length > 0 ? Math.min(...nonBondedNearAngles.map(ang => {
                            let diff = Math.abs(c2 - ang);
                            while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                            return diff;
                        })) : Math.PI;
                        
                        return minDist2 - minDist1; // 遠い順
                    });
                    
                    const needed = freeVal - hAngles.length;
                    for (let i = 0; i < Math.min(needed, backupCandidates.length); i++) {
                        hAngles.push(backupCandidates[i]);
                    }
                }
            }

            // 水素座標を登録
            hAngles.forEach(ang => {
                hydrogens.push({
                    id: `h_${atom.id}_${Math.random().toString(36).substr(2, 5)}`,
                    parentId: atom.id,
                    x: atom.x + bondLen * Math.cos(ang),
                    y: atom.y + bondLen * Math.sin(ang),
                    element: 'H'
                });
            });
        });

        // 3. 水素(H)原子同士の衝突判定と、自動スライド引っ込め処理 (H同士の重なり回避)
        const minAllowedDist = 22; // H同士がこれより近づいたら引っ込める
        const shortLen = 11.5;    // 衝突時に引っ込める結合長 (Cの半径10pxの外輪から55%〜60%露出させる)

        for (let i = 0; i < hydrogens.length; i++) {
            for (let j = i + 1; j < hydrogens.length; j++) {
                const h1 = hydrogens[i];
                const h2 = hydrogens[j];
                
                // 異なる親原子から生えている水素同士のみチェック
                if (h1.parentId === h2.parentId) continue;

                const dx = h1.x - h2.x;
                const dy = h1.y - h2.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < minAllowedDist) {
                    // 両方の水素をそれぞれの親原子の方へ引っ込める (結合長を shortLen に縮小)
                    const p1 = this.atoms.find(a => a.id === h1.parentId);
                    const p2 = this.atoms.find(a => a.id === h2.parentId);
                    
                    if (p1 && p2) {
                        // 親からの角度を算出して再配置
                        const ang1 = Math.atan2(h1.y - p1.y, h1.x - p1.x);
                        const ang2 = Math.atan2(h2.y - p2.y, h2.x - p2.x);

                        h1.x = p1.x + shortLen * Math.cos(ang1);
                        h1.y = p1.y + shortLen * Math.sin(ang1);

                        h2.x = p2.x + shortLen * Math.cos(ang2);
                        h2.y = p2.y + shortLen * Math.sin(ang2);
                    }
                }
            }
        }

        return hydrogens;
    }

    // 炭素から特定の隣接原子方向へ伸びる部分木を再帰的にシリアライズ (グラフ同型判定の簡易版)
    serializeSubtree(currentAtomId, parentAtomId, visitedAtomIds) {
        visitedAtomIds.add(currentAtomId);
        const atom = this.atoms.find(a => a.id === currentAtomId);
        if (!atom) return '';

        // 隣接する結合と原子をリストアップ（親方向は除く）
        const neighbors = this.getNeighbors(currentAtomId)
            .filter(n => n.atom.id !== parentAtomId);
            
        // この原子から生える水素(H)の数も置換基に含める
        const hCount = this.getFreeValency(currentAtomId);
        
        const childrenStrings = [];
        for (let i = 0; i < hCount; i++) {
            childrenStrings.push("H");
        }
        
        neighbors.forEach(n => {
            if (visitedAtomIds.has(n.atom.id)) {
                // ループ・環状構造の検出：環としての識別子を返す
                childrenStrings.push(`Cycle_${n.atom.element}`);
            } else {
                const subStr = this.serializeSubtree(n.atom.id, currentAtomId, new Set(visitedAtomIds));
                childrenStrings.push(`(${n.type})${subStr}`);
            }
        });
        
        // 順序に依存しないようにソートして結合
        childrenStrings.sort();
        return `${atom.element}[${childrenStrings.join(',')}]`;
    }

    // 特定の炭素が「不斉炭素（Asymmetric Carbon）」であるか判定
    isAsymmetricCarbon(atomId) {
        const atom = this.atoms.find(a => a.id === atomId);
        if (!atom || atom.element !== 'C') return false;

        // sp3 炭素である必要がある (結合数の合計が 4 かつ、すべて単結合であること)
        const neighbors = this.getNeighbors(atomId);
        
        // 二重結合や三重結合がある場合は不斉炭素にならない
        const hasMultipleBond = neighbors.some(n => n.type > 1);
        if (hasMultipleBond) return false;

        // 結合手が4つに伸びているか (隣接重原子と補完水素の合計が4)
        const heavyNeighbors = neighbors.filter(n => n.atom.element !== 'H');
        const hCount = this.getFreeValency(atomId);
        if (heavyNeighbors.length + hCount !== 4) return false;

        // 4つの置換基のシリアライズ文字列を取得
        const substituentStrings = [];
        
        // 水素置換基
        for (let i = 0; i < hCount; i++) {
            substituentStrings.push("H");
        }

        // 重原子置換基
        heavyNeighbors.forEach(n => {
            const visited = new Set([atomId]);
            const serialized = this.serializeSubtree(n.atom.id, atomId, visited);
            substituentStrings.push(serialized);
        });

        // 4つの置換基がすべて互いに異なっているか判定
        const uniqueSet = new Set(substituentStrings);
        return uniqueSet.size === 4;
    }
}

/**
 * ベンゼン環（＝6員環で単結合・二重結合が交互に並ぶ環＝ケクレ構造）を検出し、
 * その環に属する結合のキー ('id1_id2'、ID昇順) の集合を返します。
 * ケクレ構造の二重結合の位置は化学的に無意味（共鳴）なので、
 * 検証時にこの集合に含まれる結合の次数差を吸収するために使います（開発方針 4章-3）。
 */
function findAromaticBondKeys(mol) {
    const aromatic = new Set();
    const bondKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;

    // 各原子を起点に、長さ6の単純閉路をDFSで列挙する。
    // 重複列挙を避けるため、起点IDが閉路中の最小IDになる経路のみ探索する。
    const findSixCycles = (startId) => {
        const cycles = [];
        const path = [startId];
        const dfs = (currentId) => {
            const neighbors = mol.getNeighbors(currentId).filter(n => n.atom.element !== 'H');
            for (const n of neighbors) {
                if (n.atom.id === startId && path.length === 6) {
                    cycles.push([...path]);
                } else if (path.length < 6 && n.atom.id > startId && !path.includes(n.atom.id)) {
                    path.push(n.atom.id);
                    dfs(n.atom.id);
                    path.pop();
                }
            }
        };
        dfs(startId);
        return cycles;
    };

    mol.atoms.forEach(atom => {
        if (atom.element === 'H') return;
        findSixCycles(atom.id).forEach(cycle => {
            // 環に沿った結合次数を取得し、単・二重の交互配置(1,2,1,2,1,2 または 2,1,2,1,2,1)か判定
            const types = [];
            for (let i = 0; i < 6; i++) {
                const b = mol.getBond(cycle[i], cycle[(i + 1) % 6]);
                if (!b) return;
                types.push(b.type);
            }
            const isAlternating = types.every((t, i) => t === (i % 2 === 0 ? types[0] : types[1]));
            const isKekule = isAlternating &&
                ((types[0] === 1 && types[1] === 2) || (types[0] === 2 && types[1] === 1));
            if (isKekule) {
                for (let i = 0; i < 6; i++) {
                    aromatic.add(bondKey(cycle[i], cycle[(i + 1) % 6]));
                }
            }
        });
    });
    return aromatic;
}

/**
 * グラフ同型性判定 (Graph Isomorphism) を用いて、
 * ユーザーが作った分子構造がお題の分子構造と一致しているかを判定します。
 * 水素(H)は除外し、重原子間のトポロジー（元素種と結合次数）で比較します。
 * ベンゼン環の結合は「芳香族」として扱い、ケクレ位相の違い（二重結合の位置）は不問とします。
 */
function verifyMolecule(userMol, targetMol) {
    // 1. 重原子（H以外）のみを抽出
    const userHeavyAtoms = userMol.atoms.filter(a => a.element !== 'H');
    const targetHeavyAtoms = targetMol.atoms.filter(a => a.element !== 'H');

    // 重原子数が一致しない場合は即座に不一致
    if (userHeavyAtoms.length !== targetHeavyAtoms.length) return false;

    // 各元素の個数チェック
    const getCounts = (atoms) => {
        const counts = {};
        atoms.forEach(a => counts[a.element] = (counts[a.element] || 0) + 1);
        return counts;
    };
    const userCounts = getCounts(userHeavyAtoms);
    const targetCounts = getCounts(targetHeavyAtoms);

    for (let el in targetCounts) {
        if (userCounts[el] !== targetCounts[el]) return false;
    }

    // 重原子間の結合のみをフィルタリング
    const getHeavyBonds = (mol) => {
        return mol.bonds.filter(b => {
            const a1 = mol.atoms.find(a => a.id === b.atomId1);
            const a2 = mol.atoms.find(a => a.id === b.atomId2);
            return a1 && a2 && a1.element !== 'H' && a2.element !== 'H';
        });
    };
    const userHeavyBonds = getHeavyBonds(userMol);
    const targetHeavyBonds = getHeavyBonds(targetMol);

    if (userHeavyBonds.length !== targetHeavyBonds.length) return false;

    // 各重原子が接続している水素(H)の個数が一致しているかも後で検証に含める
    // （または自動補完されているので、重原子の結合が正しければ自動的にH数も合致しますが、
    // ユーザー自身が手動で余計なHを追加していないかも考慮するため、H接続数も検証の要件に入れます）
    const getUserHCount = (atomId) => userMol.getFreeValency(atomId); // ユーザーが自動補完で埋めるはずのH数
    const getTargetHCount = (atomId) => targetMol.getFreeValency(atomId);

    // 2. バックトラッキングによるマッチング探索
    const n = userHeavyAtoms.length;
    const mapping = {}; // userAtomId -> targetAtomId
    const usedTargetIds = new Set();

    // ベンゼン環に属する結合は次数比較を 'ar'（芳香族）に正規化し、ケクレ位相の違いを吸収する
    const userAromaticKeys = findAromaticBondKeys(userMol);
    const targetAromaticKeys = findAromaticBondKeys(targetMol);
    const bondKeyOf = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;

    // 隣接行列/リストを使いやすくしておく
    const getUserNeighbors = (atomId) => {
        return userHeavyBonds
            .filter(b => b.atomId1 === atomId || b.atomId2 === atomId)
            .map(b => {
                const nId = b.atomId1 === atomId ? b.atomId2 : b.atomId1;
                const type = userAromaticKeys.has(bondKeyOf(atomId, nId)) ? 'ar' : b.type;
                return { id: nId, type: type };
            });
    };

    const getTargetBondType = (id1, id2) => {
        const idA = id1 < id2 ? id1 : id2;
        const idB = id1 < id2 ? id2 : id1;
        const bond = targetHeavyBonds.find(b => b.atomId1 === idA && b.atomId2 === idB);
        if (!bond) return 0;
        return targetAromaticKeys.has(bondKeyOf(idA, idB)) ? 'ar' : bond.type;
    };

    function checkConsistency(uId, tId) {
        // 1. 元素種が一致するか
        const uAtom = userHeavyAtoms.find(a => a.id === uId);
        const tAtom = targetHeavyAtoms.find(a => a.id === tId);
        if (uAtom.element !== tAtom.element) return false;

        // 2. 必要な水素の数が一致するか（これにより、不飽和度や不対電子対が一致するか確認できる）
        if (getUserHCount(uId) !== getTargetHCount(tId)) return false;

        // 3. すでにマッピングされている隣接原子との結合状態（結合の有無と結合次数）が一致するか
        const uNeighbors = getUserNeighbors(uId);
        for (let un of uNeighbors) {
            const mappedTargetId = mapping[un.id];
            if (mappedTargetId) {
                // ターゲット側にも同じ結合が存在し、かつ結合次数が一致するか
                const targetBondType = getTargetBondType(tId, mappedTargetId);
                if (targetBondType !== un.type) {
                    return false;
                }
            }
        }
        return true;
    }

    function search(index) {
        if (index === n) return true; // 全原子のマッチング完了

        const uAtom = userHeavyAtoms[index];

        for (let i = 0; i < n; i++) {
            const tAtom = targetHeavyAtoms[i];
            if (usedTargetIds.has(tAtom.id)) continue;

            if (checkConsistency(uAtom.id, tAtom.id)) {
                // マッピング仮決定
                mapping[uAtom.id] = tAtom.id;
                usedTargetIds.add(tAtom.id);

                if (search(index + 1)) return true;

                // バックトラック
                delete mapping[uAtom.id];
                usedTargetIds.delete(tAtom.id);
            }
        }
        return false;
    }

    return search(0);
}

/**
 * 分子内の「幾何が定義できる二重結合」からシス/トランスを判定する（P8-1）。
 * 対象: 環に含まれない C=C で、両端の炭素がそれぞれ二重結合相手以外に
 * ちょうど1個の重原子置換基を持つもの（2置換アルケン）。
 * 戻り値: 'cis' | 'trans' | null（対象結合がない・複数ある・直線描画で不定）
 * ※座標は原則「見た目専用」だが、二重結合まわりの幾何は2D構造式が
 *   幾何異性を伝える標準的な手段のため、命名表示に限り例外的に読む（開発方針4章-4）。
 */
function getDoubleBondGeometry(mol) {
    // この結合が環に含まれるか（=結合を除いても両端が繋がっているか）
    const bondInRing = (bond) => {
        const visited = new Set([bond.atomId1]);
        const stack = [bond.atomId1];
        while (stack.length) {
            const id = stack.pop();
            mol.bonds.forEach(b => {
                if (b === bond) return;
                let other = null;
                if (b.atomId1 === id) other = b.atomId2;
                else if (b.atomId2 === id) other = b.atomId1;
                if (other && !visited.has(other)) {
                    visited.add(other);
                    stack.push(other);
                }
            });
        }
        return visited.has(bond.atomId2);
    };

    const results = [];
    mol.bonds.forEach(bond => {
        if (bond.type !== 2) return;
        const a = mol.atoms.find(at => at.id === bond.atomId1);
        const b = mol.atoms.find(at => at.id === bond.atomId2);
        if (!a || !b || a.element !== 'C' || b.element !== 'C') return;
        if (bondInRing(bond)) return;

        const subsA = mol.getNeighbors(a.id).filter(n => n.atom.id !== b.id && n.atom.element !== 'H');
        const subsB = mol.getNeighbors(b.id).filter(n => n.atom.id !== a.id && n.atom.element !== 'H');
        if (subsA.length !== 1 || subsB.length !== 1) return; // 2置換アルケンのみ対象

        // C=C軸に対する置換基の側を外積の符号で判定（ほぼ直線上なら不定）
        const ax = b.x - a.x;
        const ay = b.y - a.y;
        const axisLen = Math.hypot(ax, ay) || 1;
        const sideOf = (p, origin) => {
            const sx = p.x - origin.x;
            const sy = p.y - origin.y;
            const cross = ax * sy - ay * sx;
            const norm = cross / (axisLen * (Math.hypot(sx, sy) || 1));
            if (Math.abs(norm) < 0.1) return 0; // sin約6度未満 → 直線描画とみなす
            return Math.sign(cross);
        };
        const sa = sideOf(subsA[0].atom, a);
        const sb = sideOf(subsB[0].atom, b);
        if (sa === 0 || sb === 0) {
            results.push(null); // 幾何を描き分けていない
        } else {
            results.push(sa === sb ? 'cis' : 'trans');
        }
    });

    // 対象の二重結合がちょうど1本で、かつ幾何が確定しているときのみ返す
    if (results.length === 1 && results[0] !== null) return results[0];
    return null;
}

/**
 * C原子とC-C結合だけの部分グラフでの最長鎖の長さを返す（無環分子向け。全点BFS）
 */
function longestCarbonChain(mol) {
    const cIds = mol.atoms.filter(a => a.element === 'C').map(a => a.id);
    const cSet = new Set(cIds);
    let best = cIds.length > 0 ? 1 : 0;
    cIds.forEach(start => {
        const dist = new Map([[start, 1]]);
        const queue = [start];
        while (queue.length) {
            const id = queue.shift();
            mol.getNeighbors(id).forEach(n => {
                if (!cSet.has(n.atom.id) || dist.has(n.atom.id)) return;
                dist.set(n.atom.id, dist.get(id) + 1);
                if (dist.get(n.atom.id) > best) best = dist.get(n.atom.id);
                queue.push(n.atom.id);
            });
        }
    });
    return best;
}

/**
 * 分子の「構造のポイント」（骨格・多重結合・官能基）を短い日本語の配列で返す。
 * クイズの解説など表示専用の簡易解析であり、検証には使わない。
 */
function describeStructure(mol) {
    const points = [];
    const heavy = mol.atoms;
    const cCount = heavy.filter(a => a.element === 'C').length;

    // 連結成分数 → 独立環数（結合数 - 原子数 + 成分数）
    const seen = new Set();
    let comps = 0;
    heavy.forEach(a => {
        if (seen.has(a.id)) return;
        comps++;
        const stack = [a.id];
        seen.add(a.id);
        while (stack.length) {
            const id = stack.pop();
            mol.getNeighbors(id).forEach(n => {
                if (!seen.has(n.atom.id)) {
                    seen.add(n.atom.id);
                    stack.push(n.atom.id);
                }
            });
        }
    });
    const ringCount = mol.bonds.length - heavy.length + comps;
    const aromaticKeys = findAromaticBondKeys(mol);
    const aromaticRings = Math.round(aromaticKeys.size / 6);

    // 骨格
    if (aromaticRings > 0) points.push(aromaticRings === 1 ? 'ベンゼン環' : `ベンゼン環 ×${aromaticRings}`);
    const nonAromaticRings = ringCount - aromaticRings;
    if (nonAromaticRings > 0) points.push(`環構造 ×${nonAromaticRings}`);
    if (ringCount === 0 && cCount >= 1) points.push(`最長の炭素鎖 C${longestCarbonChain(mol)}`);

    // 多重結合（ベンゼン環内は除く）
    const bondKeyOf = (b) => b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
    const elemOf = (id) => (mol.atoms.find(a => a.id === id) || {}).element;
    let cc2 = 0, cc3 = 0, cn3 = 0;
    mol.bonds.forEach(b => {
        if (aromaticKeys.has(bondKeyOf(b))) return;
        const e1 = elemOf(b.atomId1);
        const e2 = elemOf(b.atomId2);
        if (b.type === 2 && e1 === 'C' && e2 === 'C') cc2++;
        if (b.type === 3 && e1 === 'C' && e2 === 'C') cc3++;
        if (b.type === 3 && ((e1 === 'C' && e2 === 'N') || (e1 === 'N' && e2 === 'C'))) cn3++;
    });
    if (cc2) points.push(`C=C二重結合 ×${cc2}`);
    if (cc3) points.push(`C≡C三重結合 ×${cc3}`);
    if (cn3) points.push(`ニトリル基 -C≡N ×${cn3}`);

    // 窒素系官能基（ニトロ基のNを先に特定してアミノ基と区別）
    let nh2 = 0, no2 = 0;
    const no2N = new Set();
    heavy.filter(a => a.element === 'N').forEach(n => {
        const ns = mol.getNeighbors(n.id);
        const dblO = ns.filter(x => x.atom.element === 'O' && x.type === 2).length;
        const sglO = ns.filter(x => x.atom.element === 'O' && x.type === 1).length;
        if (dblO >= 1 && sglO >= 1) {
            no2++;
            no2N.add(n.id);
        } else if (ns.length === 1 && ns[0].atom.element === 'C' && ns[0].type === 1 && mol.getFreeValency(n.id) === 2) {
            nh2++;
        }
    });

    // カルボニル系（-COOH / エステル / -CHO / ケトン）
    let cooh = 0, ester = 0, cho = 0, ketone = 0;
    const carbonylC = new Set();
    heavy.filter(a => a.element === 'C').forEach(c => {
        const ns = mol.getNeighbors(c.id);
        if (!ns.some(x => x.atom.element === 'O' && x.type === 2)) return;
        carbonylC.add(c.id);
        const sglOs = ns.filter(x => x.atom.element === 'O' && x.type === 1);
        const hasOH = sglOs.some(x => mol.getFreeValency(x.atom.id) >= 1);
        const hasOR = sglOs.some(x => mol.getNeighbors(x.atom.id).filter(y => y.atom.element === 'C').length === 2);
        if (hasOH) cooh++;
        else if (hasOR) ester++;
        else if (mol.getFreeValency(c.id) >= 1) cho++;
        else ketone++;
    });

    // 酸素系（カルボニル・ニトロに関与しないO）
    let oh = 0, ether = 0;
    heavy.filter(a => a.element === 'O').forEach(o => {
        const ns = mol.getNeighbors(o.id);
        if (ns.some(x => carbonylC.has(x.atom.id) || no2N.has(x.atom.id))) return;
        const cNeighbors = ns.filter(x => x.atom.element === 'C' && x.type === 1);
        if (cNeighbors.length === 1 && mol.getFreeValency(o.id) >= 1) oh++;
        else if (cNeighbors.length === 2) ether++;
    });

    if (cooh) points.push(`カルボキシ基 -COOH ×${cooh}`);
    if (ester) points.push(`エステル結合 -COO- ×${ester}`);
    if (cho) points.push(`アルデヒド基 -CHO ×${cho}`);
    if (ketone) points.push(`ケトンの C=O ×${ketone}`);
    if (oh) points.push(`ヒドロキシ基 -OH ×${oh}`);
    if (ether) points.push(`エーテル結合 -O- ×${ether}`);
    if (nh2) points.push(`アミノ基 -NH2 ×${nh2}`);
    if (no2) points.push(`ニトロ基 -NO2 ×${no2}`);

    const cl = heavy.filter(a => a.element === 'Cl').length;
    const br = heavy.filter(a => a.element === 'Br').length;
    const s = heavy.filter(a => a.element === 'S').length;
    if (cl) points.push(`塩素 Cl ×${cl}`);
    if (br) points.push(`臭素 Br ×${br}`);
    if (s) points.push('硫黄を含む（スルホ基など）');

    return points;
}

// テスト（test.html）およびコンソールデバッグ用にグローバル公開する。
// class宣言・const はトップレベルでも window のプロパティにならないため明示が必要。
if (typeof window !== 'undefined') {
    window.Molecule = Molecule;
    window.Atom = Atom;
    window.Bond = Bond;
    window.VALENCIES = VALENCIES;
    window.getDoubleBondGeometry = getDoubleBondGeometry;
    window.describeStructure = describeStructure;
    window.longestCarbonChain = longestCarbonChain;
}
