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
    'H': 1
};

class Atom {
    constructor(id, element, x, y, isLocked = false) {
        this.id = id;
        this.element = element; // 'C', 'O', 'N', 'Cl', 'H'
        this.x = x; // 画面上の描画位置（またはグリッド座標）
        this.y = y;
        this.isLocked = isLocked; // 固定原子か
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
    }

    addAtom(element, x, y, isLocked = false) {
        const id = 'atom_' + Math.random().toString(36).substr(2, 9);
        const atom = new Atom(id, element, x, y, isLocked);
        this.atoms.push(atom);
        return atom;
    }

    removeAtom(atomId) {
        this.atoms = this.atoms.filter(a => a.id !== atomId);
        // 関連する結合も削除
        this.bonds = this.bonds.filter(b => b.atomId1 !== atomId && b.atomId2 !== atomId);
    }

    addBond(atomId1, atomId2, type = 1) {
        if (atomId1 === atomId2) return null;
        
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

            // 二重結合を優先的にチェック
            const hasDoubleBond = neighbors.some(n => n.type === 2);

            if (neighbors.length === 0) {
                // 近隣原子がない場合、四方に等間隔で配置
                for (let i = 0; i < freeVal; i++) {
                    hAngles.push((i * Math.PI) / 2); // 90度刻み
                }
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
}

/**
 * グラフ同型性判定 (Graph Isomorphism) を用いて、
 * ユーザーが作った分子構造がお題の分子構造と一致しているかを判定します。
 * 水素(H)は除外し、重原子間のトポロジー（元素種と結合次数）で比較します。
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

    // 隣接行列/リストを使いやすくしておく
    const getUserNeighbors = (atomId) => {
        return userHeavyBonds
            .filter(b => b.atomId1 === atomId || b.atomId2 === atomId)
            .map(b => {
                const nId = b.atomId1 === atomId ? b.atomId2 : b.atomId1;
                return { id: nId, type: b.type };
            });
    };

    const getTargetBondType = (id1, id2) => {
        const idA = id1 < id2 ? id1 : id2;
        const idB = id1 < id2 ? id2 : id1;
        const bond = targetHeavyBonds.find(b => b.atomId1 === idA && b.atomId2 === idB);
        return bond ? bond.type : 0;
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
