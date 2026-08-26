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
    // I = ヨードホルム CHI₃ とヨードホルム反応のために足した元素（価標1・2026-08-04）。
    // 追加は VALENCIES だけでは済まない: 色（style.css の --color-i・stereo.js の対応表）と
    // CIP の原子番号（CIP_ATOMIC_NUMBER）を同時に入れる（開発方針 4章5）。
    // 命名側（IUPAC_HALOGEN の 'ヨード'）はもともと I を持っていたので変更なし。
    // **Na と同じくパレットには出さない**: 375px 縦で原子ボタンを7個目にすると帯が
    // 265→310px（+45px）伸び、その後ろの環・官能基が同じだけ画面外へ動く（DESIGN_entry_points.md A-1）。
    // I は「ヨードホルム反応の生成物」と「名称から呼び出す CHI₃」として現れれば単元が成立する
    'I': 1,
    'S': 6,
    'H': 1,
    // Na = カルボン酸の塩（-COONa）を書くための元素（価標1）。**イオンや電荷はモデルに持ち込まない**:
    // 高校の教科書が CH₃COONa・C₁₇H₃₅COONa と線で書くのに合わせ、-COO-Na を単結合1本で表す
    // （2026-08-01・検品レビュー A-1）。パレットには出さず、けん化の生成物としてだけ現れる
    'Na': 1,
    // K = Na とまったく同じ流儀のカリウム（価標1・2026-08-04）。**-COOK を単結合1本で書く**。
    // KOH でのけん化とフタル酸水素カリウムのための受け皿で、パレットには出さない
    'K': 1,
    // R = アルキル基の「付け根（自由結合手）」を表す擬似元素（価標1）。パレットには出さず、
    // アルキル基の書き出し練習でのみ自動配置する。R が付いた炭素の水素が1つ減る（結合手が使われる）
    'R': 1
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
        // 硫黄は文脈で価数が変わる（S=O があれば6価、なければ2価）。
        // 6価固定だと C-S-C の硫黄に空き価標が4残り、自動水素が描かれてしまう
        const maxVal = maxValencyOf(this, atomId);
        const usedVal = this.getUsedValency(atomId);
        // ニトロ基 N(=O)(-O) の単結合O: 電荷分離形の O⁻ に相当し、実際にはHが付かない。
        // 自動水素・分子式・配置スナップの対象から除くため空き価標0として扱う（開発方針 4章-2。
        // ニトロベンゼンの分子式が C₆H₆NO₂ と誤表示されていた不具合の修正）
        if (atom.element === 'O' && usedVal === 1) {
            const nb = this.getNeighbors(atomId);
            if (nb.length === 1 && nb[0].type === 1 && nb[0].atom.element === 'N' &&
                this.getUsedValency(nb[0].atom.id) >= 4 &&
                this.getNeighbors(nb[0].atom.id).some(n => n.type === 2 && n.atom.element === 'O')) {
                return 0;
            }
        }
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
                // 二重結合（C=C）の端にある原子は、化学的に正しい120度（平面三角形型）で水素を配置。
                // 配置数は空き結合手の数まで（C=C端の炭素は2個だが、C=N端の窒素は1個。
                // 固定で2個描くとイミンの N が NH₂ のまま表示される不具合があった）
                if (neighbors.length === 1) {
                    const baseAngle = bondedAngles[0];
                    const cands = [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3];
                    for (let i = 0; i < Math.min(freeVal, cands.length); i++) {
                        hAngles.push(cands[i]);
                    }
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

            // 水素の長さを、その向きの混雑に応じて短くする（P9-5e。夜間監査のフォロー）。
            // 向きの選び方（上の候補選択）だけでは足りない: 非結合原子が配置の許容下限
            // （MIN_CLEARANCE 27.3px）ぎりぎりの28pxに合法配置されると、そちらを向いた水素は
            // 28 − 16 = 12px まで寄ってしまう。**向きを変えられないときは長さで逃がす**。
            // 作図データ（重原子の座標）は動かさないので、判定・反応・エクスポートには影響しない。
            // 監査 v232 の実測: 自動水素の重なり 1008件（Br付近481件が最多）。すべて乱操作後の状態で、
            // 出荷ライブラリの419件には1件も無い
            const H_MIN_GAP = 13;  // 水素と非結合原子の目標距離（監査の閾値12pxより少し余裕をとる）
            const H_MIN_LEN = 9;   // これ以上は縮めない（結合線が見えなくなる）
            const obstacles = this.atoms.filter(o => o.id !== atom.id && o.element !== 'H' &&
                !neighbors.some(n => n.atom.id === o.id));
            const lengthFor = (ang) => {
                const cos = Math.cos(ang), sin = Math.sin(ang);
                // 近いものが無ければ既定の長さ。あれば 16→9 の範囲で縮めて逃がす
                for (let len = bondLen; len >= H_MIN_LEN; len -= 1) {
                    const hx = atom.x + len * cos, hy = atom.y + len * sin;
                    if (!obstacles.some(o => Math.hypot(hx - o.x, hy - o.y) < H_MIN_GAP)) return len;
                }
                return H_MIN_LEN;
            };

            // 水素座標を登録
            hAngles.forEach(ang => {
                const len = lengthFor(ang);
                hydrogens.push({
                    id: `h_${atom.id}_${Math.random().toString(36).substr(2, 5)}`,
                    parentId: atom.id,
                    x: atom.x + len * Math.cos(ang),
                    y: atom.y + len * Math.sin(ang),
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

    // sp3炭素（C・すべて単結合・結合手4本）か判定する
    isSp3Carbon(atomId) {
        const atom = this.atoms.find(a => a.id === atomId);
        if (!atom || atom.element !== 'C') return false;
        const neighbors = this.getNeighbors(atomId);
        if (neighbors.some(n => n.type > 1)) return false;
        const heavyCount = neighbors.filter(n => n.atom.element !== 'H').length;
        return heavyCount + this.getFreeValency(atomId) === 4;
    }

    // 特定の炭素が「不斉炭素（Asymmetric Carbon）」であるか判定。
    // 置換基の比較には根付き正準コード（rootedFragmentCode）を使い、
    // 環を含む置換基でも厳密に同一性を判定する（P8-2で旧serializeSubtreeを置換）。
    isAsymmetricCarbon(atomId) {
        if (!this.isSp3Carbon(atomId)) return false;
        const neighbors = this.getNeighbors(atomId);
        const heavyNeighbors = neighbors.filter(n => n.atom.element !== 'H');
        const hCount = this.getFreeValency(atomId);

        // 4つの置換基（水素＋重原子側の断片コード）がすべて互いに異なるか
        const substituentStrings = [];
        for (let i = 0; i < hCount; i++) {
            substituentStrings.push('H');
        }
        heavyNeighbors.forEach(n => {
            substituentStrings.push(rootedFragmentCode(this, n.atom.id, atomId));
        });
        return new Set(substituentStrings).size === 4;
    }
}

/**
 * ベンゼン環（＝6員環で単結合・二重結合が交互に並ぶ環＝ケクレ構造）を検出し、
 * その環に属する結合のキー ('id1_id2'、ID昇順) の集合を返します。
 * ケクレ構造の二重結合の位置は化学的に無意味（共鳴）なので、
 * 検証時にこの集合に含まれる結合の次数差を吸収するために使います（開発方針 4章-3）。
 */
/**
 * その原子の使用価標が許容範囲かを判定する（P9-5 監査で発見した不整合の修正）。
 * ニトロ基の N は電荷分離形 N(=O)(-O) として4本を許容する慣例（開発方針 4章-2）だが、
 * その根拠となる「=O と -O の両方を持つ」パターンが崩れた場合は不正として扱う。
 */
/**
 * その原子が取れる価標の上限。硫黄だけは文脈で変わる（P12-8。ユーザー要望「加硫」の下ごしらえ）。
 *
 * 実際の化学では S は
 *   ・チオール -SH / チオエーテル C-S-C / ジスルフィド -S-S-  … **2価**
 *   ・スルホ基 -SO₃H / 硫酸                                   … **6価**
 * と使い分ける。6価に固定していたため C-S-C を作ると空き価標が4残り、
 * 架橋の硫黄に自動水素が描かれてしまっていた（SH₄ のような有り得ない形）。
 *
 * 判別は「**S=O を持てば6価、持たなければ2価**」。ライブラリで S を含むのは
 * ベンゼンスルホン酸だけで、その S は C,O(=),O(=),O ＝ S=O を2本持つので6価と判定され、
 * 既存データは無回帰（ニトロ特例と同じ「パターンで見分ける」やり方）。
 */
// 価数が「分子の形」で決まる元素。S は maxValencyOf が 6↔2 を切り替え、
// N は isValencyValid がニトロ基・アンモニウム型に限って4本目を許す（ついでに
// ニトロ基の単結合Oは getFreeValency が水素0本にする＝O もこの2元素が居るときだけ動く）。
// **ここに元素を足したら、異性体列挙の足切り（enumerateConstitutionalIsomers）も一緒に見直すこと**
const CONTEXTUAL_VALENCY_ELEMENTS = ['S', 'N'];

function maxValencyOf(mol, atomId) {
    const atom = mol.atoms.find(a => a.id === atomId);
    if (!atom) return 0;
    const base = VALENCIES[atom.element] || 0;
    if (atom.element !== 'S') return base;
    const hasSulfonylOxygen = mol.getNeighbors(atomId)
        .some(n => n.type === 2 && n.atom.element === 'O');
    return hasSulfonylOxygen ? 6 : 2;
}

function isValencyValid(mol, atomId) {
    const atom = mol.atoms.find(a => a.id === atomId);
    if (!atom) return true;
    const max = maxValencyOf(mol, atomId);
    const used = mol.getUsedValency(atomId);
    if (used <= max) return true;
    // 窒素が4本になってよい「文脈」はいまのところ2つ。硫黄の 6↔2（maxValencyOf）と同じ考え方で、
    // **パターンで見分けて許す**。ここを「N は常に4価」にしてはいけない——
    // それだとアミン -NH₂（単結合1本）の空き価標が2→3 になり、**すべてのアミンが -NH₃ で描かれる**
    if (atom.element === 'N' && used === 4) {
        const nb = mol.getNeighbors(atomId);
        // ① ニトロ基 -N(=O)(-O)（電荷分離形。開発方針 4章-2）
        if (nb.some(n => n.type === 2 && n.atom.element === 'O') &&
            nb.some(n => n.type === 1 && n.atom.element === 'O')) return true;
        // ② アンモニウム型 … **単結合4本で、相手が C か H**（2026-08-04）。
        //    第四級アンモニウム（コリン・ベタイン・逆性石けん）がこれに当たる。
        //    ジアゾニウム N≡N⁺ は三重結合を含む別のパターンなので、ここでは通さない（対象外）。
        //    ⚠ この文脈は **`getFreeValency` を変えない**（maxValencyOf は3のままなので
        //    4本使った時点で空き0＝自動水素は出ない）。したがって「4本目を引けるようになる」
        //    わけではなく、**データや反応が作った N(4) を検証が弾かなくなる**だけ。
        //    手で描けるようにするには別途モジュールが要る（DEVELOPMENT.md の申し送り）
        return nb.length === 4 &&
               nb.every(n => n.type === 1 && (n.atom.element === 'C' || n.atom.element === 'H'));
    }
    return false;
}

/**
 * 構造異性体の全列挙（P9-3）。重原子の組成と水素数を与えると、その分子式を満たす
 * 連結グラフをすべて生成し、正準コードで重複を除いて返す純粋関数。
 * 高校範囲の分子式（重原子7個程度まで）を想定し、それを超える場合は overflow を返す。
 */
// nodeLimit は探索ノード数の上限。不飽和度の高い分子式（例: C₆H₆ は217種）は
// 組み合わせが急増するため、UIが固まらない範囲（実測で約1秒）で打ち切って overflow を返す。
// ノード数での打ち切りにすることで、同じ入力なら常に同じ結果になる（再現性を確保）
//
// ⚠ 価数モデルは **`VALENCIES` を直に読んではいけない**（v621。DESIGN_compound_coverage.md §9.6-6）。
// アプリが許す価数は文脈で決まる（`maxValencyOf` の S 6↔2・`isValencyValid` の N の4価特例）ので、
// `VALENCIES` で打ち切ると **実アプリが許す構造を列挙器が作れない**:
//   ・ニトロ基の N が一度も出てこない（VALENCIES.N = 3 で止まるため）
//   ・S=O を持たない S を6価として数えるので、水素の数＝分子式が本体と食い違う
// そのせいでニトロメタン・ニトロエタン・チオフェンが audit.html のライブラリ検査
// 「異性体列挙に自分自身が含まれない」で落ちていた。
// **DFS の上限は緩く取り、最終判定は本体と同じ関数（isValencyValid / getFreeValency）で行う。**
function enumerateConstitutionalIsomers(elements, hCount, nodeLimit = 600000) {
    const n = elements.length;
    if (n === 0 || n > 8) return { isomers: [], overflow: n > 8 };

    // 探索中の上限。**判定ではなく枝刈りのための上限**なので、文脈で許される最大値を取る。
    // N は 4（ニトロ基 N(=O)(-O)- と アンモニウム型）。
    //
    // ⚠ S は「VALENCIES の 6 のままでよい（実際の2価は record() の isValencyValid が落とす）」
    //   としていたが、**それでは遅すぎた**（2026-08-09・v950）。S の枝を6本まで伸ばして
    //   葉で捨てるので、探索木が桁で膨らむ。実測（重原子6個・不飽和度0）:
    //     C₄H₁₀O₂   54ms /28種  ←→  C₄H₁₀S₂  4505ms /28種（83倍）
    //     C₃H₈O₃    33ms /28種  ←→  C₃H₈S₃  11998ms /28種（364倍）
    //   **答えは1種も違わない**＝膨らんだぶんはすべて葉で捨てられていた。
    //
    //   `maxValencyOf` が S に6を返す条件は **S=O（O への二重結合）を持つこと** だけなので、
    //   分子式に O が1個も無ければ **どの S も2価にしかなり得ない**。ここは化学の言い換えで、
    //   モデルを曲げてはいない（O があるときは 6 のまま ＝ スルホ基は今までどおり出る）
    const oCount = elements.reduce((s, e) => s + (e === 'O' ? 1 : 0), 0);
    const sMax = oCount === 0 ? 2 : (VALENCIES.S || 6);
    const max = elements.map(e => (e === 'N' ? 4 : (e === 'S' ? sMax : (VALENCIES[e] || 0))));
    const pairs = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    }
    // 各頂点について、その頂点が関わる最後のペアの位置（次数が確定する時点＝枝刈りに使う）
    const lastPairOf = new Array(n).fill(-1);
    pairs.forEach(([i, j], k) => {
        lastPairOf[i] = k;
        lastPairOf[j] = k;
    });

    const used = new Array(n).fill(0);
    const adj = Array.from({ length: n }, () => []);
    const isomers = [];
    const seen = new Set();
    let nodes = 0;
    let overflow = false;

    const isConnected = () => {
        const visited = new Set([0]);
        const stack = [0];
        while (stack.length) {
            const v = stack.pop();
            adj[v].forEach(([u]) => {
                if (!visited.has(u)) {
                    visited.add(u);
                    stack.push(u);
                }
            });
        }
        return visited.size === n;
    };

    // 価数が文脈で動く元素（S・N）を含むかどうかで、葉の判定を2通りに分ける。
    // **含まないなら従来どおり**（VALENCIES で数えた空き価標＝本物なので、1回の合計で決まる）。
    // ここを一本化して常に Molecule を組み立てると、葉が数十万ある分子式（C₇H₁₆）で4倍遅くなる
    const contextual = elements.some(e => CONTEXTUAL_VALENCY_ELEMENTS.includes(e));
    // 文脈つきのときに使う空き価標の上下限。実際の空き価標が動く幅は決まっている:
    //   ・S … S=O が無ければ2価・あれば6価        → 下限 2 / 上限 6
    //   ・N … 4本目が許されるのは特例のときだけ   → いずれにせよ max(0, 3-used)
    //   ・O … ニトロ基の単結合Oだけ空き0          → 下限は used===1 のとき 0
    // 上下限に入らない枝は Molecule を組み立てずに捨てる（組み立てと正準コードが重いため）
    const minMax = elements.map(e => (e === 'S' ? 2 : (VALENCIES[e] || 0)));

    const record = () => {
        if (contextual) {
            let hi = 0, lo = 0;
            for (let i = 0; i < n; i++) {
                const cap = VALENCIES[elements[i]] || 0;
                hi += Math.max(0, cap - used[i]);
                lo += (elements[i] === 'O' && used[i] === 1) ? 0 : Math.max(0, minMax[i] - used[i]);
            }
            if (hCount < lo || hCount > hi) return;
        } else {
            let freeSum = 0;
            for (let i = 0; i < n; i++) freeSum += max[i] - used[i];
            if (freeSum !== hCount) return;
        }
        if (!isConnected()) return;
        const mol = new Molecule();
        const ids = elements.map(e => mol.addAtom(e, 0, 0).id);
        for (let v = 0; v < n; v++) {
            adj[v].forEach(([u, t]) => {
                if (u > v) mol.addBond(ids[v], ids[u], t);
            });
        }
        // 最終判定は**本体と同じ関数**で行う。VALENCIES を直に読まないのが肝
        // （S の 6↔2・N の4価特例は分子の形を見ないと決まらない）
        if (contextual) {
            if (!ids.every(id => isValencyValid(mol, id))) return;
            let freeSum = 0;
            for (const id of ids) freeSum += mol.getFreeValency(id);
            if (freeSum !== hCount) return;
        }
        const code = canonicalCode(mol);
        if (seen.has(code)) return;
        seen.add(code);
        isomers.push(mol);
    };

    // 次数が確定した頂点 v が S として辻褄が合うか。2本まで（＝2価）ならいつでも可、
    // 3本以上使うなら S=O が要る。S 以外はいつでも真
    const sulfurSettled = (v) => {
        if (elements[v] !== 'S' || used[v] <= 2) return true;
        return adj[v].some(([u, t]) => t === 2 && elements[u] === 'O');
    };

    const dfs = (k) => {
        if (overflow) return;
        if (++nodes > nodeLimit) {
            overflow = true;
            return;
        }
        if (k === pairs.length) {
            record();
            return;
        }
        const [i, j] = pairs[k];
        const maxType = Math.min(3, max[i] - used[i], max[j] - used[j]);
        for (let t = 0; t <= maxType; t++) {
            if (t > 0) {
                used[i] += t;
                used[j] += t;
                adj[i].push([j, t]);
                adj[j].push([i, t]);
            }
            // 枝刈り: その頂点に関わるペアが尽きたのに結合0本なら、連結分子にならない
            let ok = true;
            if (n > 1) {
                if (lastPairOf[i] === k && adj[i].length === 0) ok = false;
                if (ok && lastPairOf[j] === k && adj[j].length === 0) ok = false;
            }
            // 枝刈り: 次数が確定した S が「2本を超えて使っているのに S=O を持たない」なら、
            // この先どう伸ばしても `isValencyValid` が葉で捨てる（`maxValencyOf` の 6↔2）。
            // 葉の判定を**確定した瞬間に前倒しする**だけなので、答えは1種も変わらない。
            // O が無い式では上の sMax=2 が同じことを入口で済ませているので、ここは O 混じり専用
            if (ok && sMax > 2 && n > 1) {
                if (lastPairOf[i] === k && !sulfurSettled(i)) ok = false;
                if (ok && lastPairOf[j] === k && !sulfurSettled(j)) ok = false;
            }
            if (ok) dfs(k + 1);
            if (t > 0) {
                used[i] -= t;
                used[j] -= t;
                adj[i].pop();
                adj[j].pop();
            }
            if (overflow) return;
        }
    };
    dfs(0);
    return { isomers, overflow };
}

/**
 * ベンゼン環を**種**として置いた異性体列挙（DESIGN_isomer_practice.md §11・2026-08-07）
 *
 * `enumerateConstitutionalIsomers` は総当たりなので、不飽和度4の式（C₈H₁₀ など）で
 * 3523種・26秒かかる（DEVELOPMENT.md §7-1d の実測）。**探索を速くするのではなく、
 * 探索空間そのものを変える**のがこの関数の役目:
 *
 *   ①ベンゼン環（C6・ケクレ交互）を1つ固定で置く
 *   ②残った重原子を1〜6個の置換基に分ける
 *   ③各置換基の骨格を `enumerateConstitutionalIsomers([...原子, 'R'], hs)` で作る
 *     （'R' は付け根を表す価標1の擬似元素。アルキル基の練習と同じ流儀）
 *   ④置換基を環の6箇所に配り、`canonicalCode` で重複を畳む
 *
 * **対称性（6回回転＋鏡＝12通り）を自前で数え上げない**のが肝。配り方を素直に全部作って
 * 正準コードに任せる。自前で畳むと o- の裏返しのような場合を必ずどこかで取りこぼす。
 * ケクレ構造の位相（置換位置が二重結合側か単結合側か）も `canonicalCode` が芳香族結合を
 * 'a' に潰して吸収するので、o-キシレンが2種に割れることはない。
 *
 * ⚠ **この関数が返すのは「ベンゼン環をもつ異性体」だけで、分子式の全異性体ではない。**
 * 呼ぶ側は必ずそう表示すること（C₈H₁₀ には非芳香族の異性体も理論上は大量にある）。
 */
// 環の外に置ける重原子の数。**この線は実測で引いた**（DEVELOPMENT.md §7-1f）:
// 4個までは最悪 426ms（C₇H₉ONS）だが、5個にすると S を含む式が **13.2秒**（C₆H₆S₅）
// かかる。硫黄は価標6のため置換基の骨格が桁違いに増える（ユーザー報告の 5.9秒／16.5秒と同じ罠）
const BENZENE_REST_MAX = 4;
// 置換基1つあたりの不飽和度の上限。**性能と教育の両方の門番**:
//   ・性能 … これが無いと C₁₂H₁₀ で 15.4 秒（環外6個の高度不飽和な骨格を数え上げるため）
//   ・教育 … 高校で出る置換基は -CH₃・-OH・-Cl（0）／-CH=CH₂・-CHO・-COOH（1）／-C≡CH・-CN（2）。
//            3以上は小員環や累積二重結合ばかりで、練習の邪魔にしかならない
//            （実例: C₁₀H₈ はこの門が無いと 28種の奇形を出す。あってもナフタレンは出ない＝§11-3）
const BENZENE_SUB_DOU_MAX = 2;

// 置換基 S–（'R' が付け根）の不飽和度。hs はその置換基がもつ水素の数。
// 付け根の結合手を水素1個と同じに数えるので (… − hs − 1 …)
function benzeneSubUnsaturation(S, hs) {
    let c = 0, n = 0, x = 0;
    S.forEach(e => {
        if (e === 'C') c++;
        else if (e === 'N') n++;
        else if (e === 'Cl' || e === 'Br' || e === 'I') x++;
    });
    return (2 * c + 2 + n - hs - 1 - x) / 2;
}

function enumerateBenzeneRingIsomers(elements, hCount, options = {}) {
    const restMax = options.restMax || BENZENE_REST_MAX;
    const subDouMax = options.subDouMax === undefined ? BENZENE_SUB_DOU_MAX : options.subDouMax;
    const none = ok => ({ isomers: [], overflow: false, applicable: ok });

    if (!Array.isArray(elements)) return none(false);
    if (elements.filter(e => e === 'C').length < 6) return none(false); // 環を作る炭素が足りない

    // 炭素6個を環に取り、残りを置換基の材料にする
    const rest = [];
    let ringC = 0;
    elements.forEach(e => {
        if (e === 'C' && ringC < 6) ringC++;
        else rest.push(e);
    });
    const m = rest.length;
    // **数える前に断る**（learn.js の門番と同じ考え方）。ここを越えると硫黄で十数秒固まる
    if (m > restMax) return { isomers: [], overflow: true, applicable: true };

    // 置換基を環に付けて1つの分子を組み立てる。subs = [{ pos, frag }]
    const buildOne = (subs) => {
        const mol = new Molecule();
        const ring = [];
        for (let i = 0; i < 6; i++) ring.push(mol.addAtom('C', 0, 0).id);
        // ケクレ交互（二重・単・二重…）。位相は canonicalCode が吸収するので固定でよい
        for (let i = 0; i < 6; i++) mol.addBond(ring[i], ring[(i + 1) % 6], i % 2 === 0 ? 2 : 1);
        subs.forEach(({ pos, frag }) => {
            const map = new Map();
            let anchor = null;
            frag.atoms.forEach(a => {
                if (a.element === 'R') { anchor = a.id; return; } // 付け根は環の炭素で置き換える
                map.set(a.id, mol.addAtom(a.element, 0, 0).id);
            });
            frag.bonds.forEach(b => {
                // ⚠ Bond は端点をID順に正規化するので、付け根がどちら側かは**両方見る**
                //   （原子IDは乱数。順序に頼らない＝開発方針の申し送り）
                if (b.atomId1 === anchor) mol.addBond(ring[pos], map.get(b.atomId2), b.type);
                else if (b.atomId2 === anchor) mol.addBond(ring[pos], map.get(b.atomId1), b.type);
                else mol.addBond(map.get(b.atomId1), map.get(b.atomId2), b.type);
            });
        });
        return mol;
    };

    // 置換基なし＝ベンゼンそのもの
    if (m === 0) {
        return hCount === 6
            ? { isomers: [buildOne([])], overflow: false, applicable: true }
            : none(true);
    }

    // ① 残りの重原子を1〜6個のブロック（＝置換基）に分ける。中身の多重集合が同じ分け方は畳む
    const partitions = [];
    const blocks = [];
    const split = (i) => {
        if (i === m) { partitions.push(blocks.map(b => b.slice())); return; }
        for (let b = 0; b < blocks.length; b++) {
            blocks[b].push(i); split(i + 1); blocks[b].pop();
        }
        if (blocks.length < 6) { blocks.push([i]); split(i + 1); blocks.pop(); }
    };
    split(0);
    const seenPart = new Set();
    const groupSets = [];
    partitions.forEach(p => {
        const sigs = p.map(b => b.map(i => rest[i]).sort().join(',')).sort();
        const key = sigs.join('|');
        if (seenPart.has(key)) return;
        seenPart.add(key);
        groupSets.push(sigs.map(s => s.split(',')));
    });

    // ② ブロック（元素の多重集合）＋水素数 → その置換基の骨格一覧。同じ問い合わせは使い回す
    const fragCache = new Map();
    const fragmentsOf = (S, hs) => {
        const key = S.join(',') + '#' + hs;
        if (fragCache.has(key)) return fragCache.get(key);
        const out = enumerateConstitutionalIsomers(S.concat(['R']), hs, 4000000);
        const r = out.overflow ? null : out.isomers; // null = 打ち切り（呼ぶ側が overflow にする）
        fragCache.set(key, r);
        return r;
    };
    // すべて単結合の木にしたときの水素数＝その置換基がもてる水素の最大
    const hMaxOf = S => S.reduce((a, e) => a + (VALENCIES[e] || 0), 0) - 2 * (S.length - 1) - 1;

    const isomers = [];
    const seen = new Set();
    let overflow = false;

    // ④ 置換基の並び frags を環の相異なる6箇所へ配る（重複は canonicalCode が畳む）
    const placeOnRing = (frags) => {
        const used = [];
        const rec = (gi) => {
            if (overflow) return;
            if (gi === frags.length) {
                const mol = buildOne(frags.map((f, i) => ({ pos: used[i], frag: f })));
                const code = canonicalCode(mol);
                if (!seen.has(code)) { seen.add(code); isomers.push(mol); }
                return;
            }
            for (let p = 0; p < 6; p++) {
                if (used.indexOf(p) >= 0) continue;
                used.push(p); rec(gi + 1); used.pop();
            }
        };
        rec(0);
    };
    // ③ 各ブロックの骨格を1つずつ選ぶ
    const chooseFrags = (lists) => {
        const pick = [];
        const rec = (gi) => {
            if (overflow) return;
            if (gi === lists.length) { placeOnRing(pick.slice()); return; }
            lists[gi].forEach(f => { pick.push(f); rec(gi + 1); pick.pop(); });
        };
        rec(0);
    };

    groupSets.forEach(groups => {
        if (overflow) return;
        const k = groups.length;
        // 置換されなかった環炭素が水素を1個ずつ持つ ＝ 置換基が分け合う水素は hCount − (6 − k)
        const budget = hCount - (6 - k);
        if (budget < 0) return;
        const lists = [];
        const distribute = (gi, remain) => {
            if (overflow) return;
            if (gi === k) { if (remain === 0) chooseFrags(lists.slice()); return; }
            const S = groups[gi];
            const hi = Math.min(remain, hMaxOf(S));
            for (let hs = hi; hs >= 0; hs--) {
                // **列挙に入る前に**不飽和度で弾く（ここが性能と教育範囲の両方の門番）
                if (benzeneSubUnsaturation(S, hs) > subDouMax) continue;
                const fr = fragmentsOf(S, hs);
                if (fr === null) { overflow = true; return; }
                if (!fr.length) continue;
                lists.push(fr);
                distribute(gi + 1, remain - hs);
                lists.pop();
                if (overflow) return;
            }
        };
        distribute(0, budget);
    });

    return { isomers: overflow ? [] : isomers, overflow, applicable: true };
}

/**
 * 分子の自動レイアウト（P9-3b）。座標を持たない分子（異性体列挙の結果など）に、
 * このアプリの直交作図コンセプトに沿ったグリッド座標を割り当てる純粋関数。
 * - 環は長方形/家型のテンプレート（手描きの縮合環と同じ流儀）で配置
 * - 鎖は親からの直進を優先し、塞がっていれば直交方向へ折れる
 * 見た目専用であり、検証はトポロジーのみという方針（開発方針4章）は変わらない。
 */
function findAnyCycle(mol) {
    const parent = new Map();
    const visited = new Set();
    let cycle = null;
    const dfs = (id, from) => {
        if (cycle) return;
        visited.add(id);
        for (const n of mol.getNeighbors(id)) {
            if (cycle) return;
            if (n.atom.id === from) continue;
            if (visited.has(n.atom.id)) {
                // 閉路発見: id から祖先 n.atom.id まで parent を遡って経路を作る
                const path = [id];
                let cur = id;
                while (cur !== n.atom.id && parent.has(cur)) {
                    cur = parent.get(cur);
                    path.push(cur);
                }
                if (cur === n.atom.id) cycle = path;
                return;
            }
            parent.set(n.atom.id, id);
            dfs(n.atom.id, id);
        }
    };
    for (const a of mol.atoms) {
        if (!visited.has(a.id)) dfs(a.id, null);
        if (cycle) break;
    }
    return cycle;
}

function layoutMolecule(mol) {
    const G = 42;
    if (mol.atoms.length === 0) return;
    const placed = new Map();
    const occupied = [];
    const isFree = (x, y) => occupied.every(p => Math.hypot(p.x - x, p.y - y) >= G * 0.6);
    const put = (id, x, y) => {
        placed.set(id, { x, y });
        occupied.push({ x, y });
    };

    // 1. 環があれば最初の環をテンプレートで置く（3員=直角三角形、5員=家型、6員=長方形）
    const RING_TEMPLATES = {
        3: [[0, 0], [G, 0], [G, G]],
        4: [[0, 0], [G, 0], [G, G], [0, G]],
        5: [[0, 0], [G, 0], [2 * G, 0], [2 * G, G], [0, G]],
        6: [[0, 0], [G, 0], [2 * G, 0], [2 * G, G], [G, G], [0, G]],
        7: [[0, 0], [G, 0], [2 * G, 0], [3 * G, 0], [3 * G, G], [G, G], [0, G]],
        8: [[0, 0], [G, 0], [2 * G, 0], [3 * G, 0], [3 * G, G], [2 * G, G], [G, G], [0, G]]
    };
    const cycle = findAnyCycle(mol);
    if (cycle && RING_TEMPLATES[cycle.length]) {
        RING_TEMPLATES[cycle.length].forEach(([x, y], i) => put(cycle[i], x, y));
    }

    // 2. 残りをBFSで配置（直進優先 → 直交 → 距離2倍 → 周辺の螺旋探索）
    if (placed.size === 0) {
        const start = mol.atoms.find(a => mol.getNeighbors(a.id).length <= 1) || mol.atoms[0];
        put(start.id, 0, 0);
    }
    const parentDir = new Map();
    const queue = [...placed.keys()];
    while (queue.length) {
        const id = queue.shift();
        const pos = placed.get(id);
        const inDir = parentDir.get(id) || { dx: G, dy: 0 };
        mol.getNeighbors(id).forEach(n => {
            if (placed.has(n.atom.id)) return;
            const prefs = [
                [inDir.dx, inDir.dy], [inDir.dy, -inDir.dx],
                [-inDir.dy, inDir.dx], [-inDir.dx, -inDir.dy]
            ];
            let spot = null;
            for (const mult of [1, 2]) {
                for (const [dx, dy] of prefs) {
                    const x = pos.x + dx * mult;
                    const y = pos.y + dy * mult;
                    if (isFree(x, y)) {
                        spot = { x, y, dx, dy };
                        break;
                    }
                }
                if (spot) break;
            }
            if (!spot) {
                outer: for (let r = 1; r <= 5; r++) {
                    for (let ax = -r; ax <= r; ax++) {
                        for (let ay = -r; ay <= r; ay++) {
                            const x = pos.x + ax * G;
                            const y = pos.y + ay * G;
                            if ((ax !== 0 || ay !== 0) && isFree(x, y)) {
                                spot = { x, y, dx: G, dy: 0 };
                                break outer;
                            }
                        }
                    }
                }
            }
            put(n.atom.id, spot.x, spot.y);
            parentDir.set(n.atom.id, { dx: spot.dx, dy: spot.dy });
            queue.push(n.atom.id);
        });
    }
    mol.atoms.forEach(a => {
        const p = placed.get(a.id);
        a.x = p.x;
        a.y = p.y;
    });
}

/**
 * 縮約表示（カード化）できる官能基を検出する（P9-2）。
 * 環や主鎖そのものは縮約しない（作図の骨格が消えないようにするため）。
 * 返り値: [{ label, anchorIds, memberIds }]
 *   anchorIds: 分子側の接続点（この原子は残す）。
 *     **末端の基（-COOH・-CHO・-NO₂・-SO₃H）は1つ**、
 *     **中間の原子団（エステル -COO-）は両側で2つ**（DESIGN_chain_condense.md「中間の原子団を畳む」）
 *   memberIds: 隠して1枚のカードにまとめる原子
 */
function findCondensableGroups(mol) {
    const groups = [];
    const heavyNb = (id) => mol.getNeighbors(id).filter(n => n.atom.element !== 'H');
    // memberIds を隠しても aId と bId がまだつながっているか
    // ＝ その原子団が環の一辺である、ということ（環状エステルを外すのに使う）
    const stillConnected = (aId, bId, hide) => {
        const skip = new Set(hide);
        const seen = new Set([aId]);
        const stack = [aId];
        while (stack.length) {
            const id = stack.pop();
            for (const n of mol.getNeighbors(id)) {
                const nid = n.atom.id;
                if (skip.has(nid) || seen.has(nid)) continue;
                seen.add(nid);
                stack.push(nid);
            }
        }
        return seen.has(bId);
    };

    mol.atoms.forEach(a => {
        // ニトロ基 -N(=O)(-O) / スルホ基 -SO₃H: N/S に酸素だけがぶら下がる形
        if (a.element === 'N' || a.element === 'S') {
            const nb = heavyNb(a.id);
            const oxygens = nb.filter(n => n.atom.element === 'O' && heavyNb(n.atom.id).length === 1);
            const others = nb.filter(n => n.atom.element !== 'O');
            if (others.length !== 1) return;
            if (a.element === 'N' && oxygens.length === 2 &&
                oxygens.some(n => n.type === 2) && oxygens.some(n => n.type === 1)) {
                groups.push({ label: 'NO₂', anchorIds: [others[0].atom.id],
                              memberIds: [a.id, ...oxygens.map(n => n.atom.id)] });
            } else if (a.element === 'S' && oxygens.length === 3) {
                groups.push({ label: 'SO₃H', anchorIds: [others[0].atom.id],
                              memberIds: [a.id, ...oxygens.map(n => n.atom.id)] });
            }
            return;
        }
        if (a.element !== 'C') return;
        const nb = heavyNb(a.id);
        const dblO = nb.filter(n => n.type === 2 && n.atom.element === 'O' && heavyNb(n.atom.id).length === 1);
        if (dblO.length !== 1) return;
        const sglO = nb.filter(n => n.type === 1 && n.atom.element === 'O' && heavyNb(n.atom.id).length === 1);
        const carbons = nb.filter(n => n.atom.element === 'C');
        if (sglO.length === 1 && carbons.length === 1) {
            // カルボキシ基 -COOH（末端）
            groups.push({ label: 'COOH', anchorIds: [carbons[0].atom.id],
                          memberIds: [a.id, dblO[0].atom.id, sglO[0].atom.id] });
            return;
        }
        if (sglO.length === 0 && carbons.length === 1 && mol.getFreeValency(a.id) >= 1) {
            // アルデヒド基 -CHO（末端）
            groups.push({ label: 'CHO', anchorIds: [carbons[0].atom.id],
                          memberIds: [a.id, dblO[0].atom.id] });
            return;
        }
        // エステル結合 -COO-（発注書 A・2026-08-15）。示性式 CH₃COOC₂H₅ を出すための
        // **中間の原子団**で、-COOH と違って両側に骨格が残る（DESIGN_chain_condense.md「中間の原子団を畳む」）
        if (sglO.length !== 0) return;
        const bridgeO = nb.filter(n => n.type === 1 && n.atom.element === 'O' && heavyNb(n.atom.id).length === 2);
        if (bridgeO.length !== 1) return;
        const oId = bridgeO[0].atom.id;
        const far = heavyNb(oId).find(n => n.atom.id !== a.id);
        // 向こう側は炭素であること。R（高分子の擬似元素）や N の先には出さない
        if (!far || far.atom.element !== 'C') return;
        // 酸無水物 -C(=O)-O-C(=O)- は対象外。両側の炭素が同じ O を取り合って
        // **カードが2枚重なって出る**（どちらから見てもエステルの形をしている）
        if (heavyNb(far.atom.id).some(n => n.type === 2 && n.atom.element === 'O')) return;
        const members = [a.id, dblO[0].atom.id, oId];
        if (carbons.length === 1) {
            // R-COO-R'（酢酸エチル型）。**環状エステルは畳まない** ——
            // カードが環の一辺になり、環だと読めなくなる（末端の基を環で畳まないのと同じ理由）
            if (stillConnected(carbons[0].atom.id, far.atom.id, members)) return;
            groups.push({ label: 'COO', anchorIds: [carbons[0].atom.id, far.atom.id],
                          memberIds: members });
        } else if (carbons.length === 0 && mol.getFreeValency(a.id) >= 1) {
            // H-COO-R'（ギ酸メチル型）。アシル側に炭素が無いので骨格は R' だけ残る＝
            // アンカーは1つ。ラベルに H を含めないと HCOOCH₃ が CH₃ に見えてしまう
            groups.push({ label: 'HCOO', anchorIds: [far.atom.id], memberIds: members });
        }
    });
    return groups;
}

// 官能基・特徴構造の検出（P9-1 M1）。プロパティ表示と反応ルールの適用判定に使う純粋関数。
// 返り値: [{ type, label, atomIds }]（同種の基は複数エントリになる）
function findFunctionalGroups(mol) {
    const groups = [];
    const arom = findAromaticBondKeys(mol);
    const aromAtoms = new Set();
    mol.bonds.forEach(b => {
        const key = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        if (arom.has(key)) {
            aromAtoms.add(b.atomId1);
            aromAtoms.add(b.atomId2);
        }
    });
    const heavyNb = (id) => mol.getNeighbors(id).filter(n => n.atom.element !== 'H');

    mol.atoms.forEach(a => {
        if (a.element === 'C') {
            const nb = heavyNb(a.id);
            // ニトリル -C≡N（アセトニトリル・アクリロニトリル）。C=O を持たないので
            // 下の doubleO の関門より先に見る（DESIGN_compound_coverage.md §9.6-2）
            if (nb.some(n => n.type === 3 && n.atom.element === 'N')) {
                const nn = nb.find(n => n.type === 3 && n.atom.element === 'N');
                groups.push({ type: 'nitrile', label: 'ニトリル（シアノ基）', atomIds: [a.id, nn.atom.id] });
                return;
            }
            const doubleO = nb.filter(n => n.type === 2 && n.atom.element === 'O');
            if (doubleO.length !== 1) return;
            const singleO = nb.filter(n => n.type === 1 && n.atom.element === 'O');
            const carbons = nb.filter(n => n.atom.element === 'C');
            if (singleO.length >= 1) {
                // -C(=O)-O- : 先のOが末端ならカルボキシ基、C-O-Cならエステル結合
                const o = singleO[0].atom;
                const oBeyond = heavyNb(o.id).filter(n => n.atom.id !== a.id);
                if (oBeyond.length === 0) {
                    groups.push({ type: 'carboxyl', label: 'カルボキシ基（カルボン酸）', atomIds: [a.id, doubleO[0].atom.id, o.id] });
                } else if (oBeyond.length === 1 &&
                           (oBeyond[0].atom.element === 'Na' || oBeyond[0].atom.element === 'K')) {
                    // -C(=O)-O-Na / -C(=O)-O-K ＝ カルボン酸の塩
                    // （けん化の生成物。脂肪酸ナトリウムなら石けん）。
                    // **K を見落としていた**（DESIGN_compound_coverage.md §9.6-8）——
                    // すぐ下の sulfonate は Na/K の両方を見ているのに、ここだけ Na だけだったので、
                    // 酢酸カリウム・フタル酸水素カリウムが「官能基にあてはまらない」で範囲外に落ちていた。
                    // K は KOH でのけん化とフタル酸水素カリウムのために足した元素（§6-1）
                    const metal = oBeyond[0].atom.element;
                    groups.push({
                        type: 'carboxylate',
                        label: `カルボン酸の塩（-COO${metal}）`,
                        atomIds: [a.id, doubleO[0].atom.id, o.id, oBeyond[0].atom.id]
                    });
                } else if (oBeyond.length === 1 && oBeyond[0].atom.element === 'C') {
                    groups.push({ type: 'ester', label: 'エステル結合', atomIds: [a.id, doubleO[0].atom.id, o.id] });
                }
            } else if (nb.some(n => n.type === 1 && n.atom.element === 'N')) {
                // アミド -C(=O)-N<（アセトアミド・ペプチド結合・ナイロン）。
                // **ここが無かったので、アミドが「アルデヒド基」として拾われていた**
                // （C に =O が1本・炭素が1つなので下の分岐に落ちる。§9.6-2 の表示の不具合）。
                // ⚠ アミドの N 側は今までどおり amino としても数える。reactor.js が
                //    isAmideNitrogen で除いている前提を崩さないため（DEVELOPMENT.md の申し送り）
                const an = nb.find(n => n.type === 1 && n.atom.element === 'N');
                groups.push({ type: 'amide', label: 'アミド結合', atomIds: [a.id, doubleO[0].atom.id, an.atom.id] });
            } else if (mol.getFreeValency(a.id) >= 1) {
                // アルデヒド -CHO。**条件は「カルボニル炭素に水素が残っていること」**（教科書の定義そのもの）。
                // 以前は「隣の炭素が1つ以下」で見ていたため、**水素ではない隣を水素と同一視**していた:
                //   -CO-R  … R は「この先も骨格が続く」印の擬似元素（価標1）で、水素ではない。
                //            ナイロン66・PET の端がアルデヒドになり、**銀鏡反応・フェーリング液が陽性**に出ていた
                //   -CO-Cl … 塩化アセチル・塩化ベンゾイル・塩化プロピオニルも同じ理由でアルデヒド扱い。
                //            塩化アセチルは**ヨードホルム反応まで陽性**になっていた（CH₃-CO- が拾われるため）
                // 空き価標＝暗黙の水素なので、この1条件で両方ふさがる。同じ判定は
                // describeStructure と findCondensableGroups が先に採っていた（そちらは正しかった）
                groups.push({ type: 'aldehyde', label: 'アルデヒド基', atomIds: [a.id, doubleO[0].atom.id] });
            } else if (carbons.length === 2) {
                groups.push({ type: 'ketone', label: 'ケトン（カルボニル基）', atomIds: [a.id, doubleO[0].atom.id] });
            }
            // ⚠ **ここに落ちる -CO-R・-CO-Cl は、どの型でも返さない**（ケトンに寄せてはいけない）。
            //   R の向こうに何が続くかは図から決まらない —— ナイロン66 の R は N（アミド）、
            //   PET の R は O（エステル）が続く。ケトンと断定すると「アミド・エステルをケトンと呼ぶ」
            //   別の誤りに置き換わるだけになる。塩化アシルも高校ではケトンに分類しない。
            //   **「アルデヒドではない」は R の中身によらず確実に言えるが、「ケトンである」は言えない**
            //   ——言えることだけを返し、言えないものは黙るのがこの関数の安全側（§18.1 の申し送り）
        } else if (a.element === 'Cl' || a.element === 'Br' || a.element === 'I') {
            // ハロゲン化物 -X（クロロシクロヘキサン・ヨードホルム）。§9.6-2 の補正B。
            // ハロゲンだけを持つ分子が「官能基にあてはまらない」で範囲外に落ちていた
            const nb = heavyNb(a.id);
            if (nb.length === 1 && nb[0].type === 1 && nb[0].atom.element === 'C') {
                groups.push({ type: 'halide', label: 'ハロゲン（ハロゲン化物）', atomIds: [a.id, nb[0].atom.id] });
            }
        } else if (a.element === 'S') {
            // スルホ基 -SO₃H とその塩 -SO₃Na（ベンゼンスルホン酸ナトリウム）。§9.6-2 の補正B。
            // S の価数は文脈で決まる（S=O があれば6価）ので、=O を2本持つことを条件にする
            const nb = heavyNb(a.id);
            const dblO = nb.filter(n => n.type === 2 && n.atom.element === 'O');
            const sglO = nb.filter(n => n.type === 1 && n.atom.element === 'O');
            if (dblO.length >= 2 && sglO.length >= 1) {
                const beyond = heavyNb(sglO[0].atom.id).filter(n => n.atom.id !== a.id);
                const ids = [a.id, ...dblO.map(n => n.atom.id), sglO[0].atom.id];
                if (beyond.length === 1 && (beyond[0].atom.element === 'Na' || beyond[0].atom.element === 'K')) {
                    // 見出しの元素は実物に合わせる（-SO₃Na / -SO₃K）。carboxylate と同じ書き方
                    groups.push({ type: 'sulfonate', label: `スルホン酸の塩（-SO₃${beyond[0].atom.element}）`, atomIds: [...ids, beyond[0].atom.id] });
                } else if (beyond.length === 0) {
                    groups.push({ type: 'sulfo', label: 'スルホ基（スルホン酸）', atomIds: ids });
                }
            }
        } else if (a.element === 'O') {
            const nb = heavyNb(a.id);
            if (nb.length === 1 && nb[0].type === 1 && nb[0].atom.element === 'C' && mol.getFreeValency(a.id) >= 1) {
                const c = nb[0].atom;
                const cNb = heavyNb(c.id);
                if (cNb.some(n => n.type === 2 && n.atom.element === 'O')) return; // カルボキシ基のOH側（C側で計上）
                if (aromAtoms.has(c.id)) {
                    groups.push({ type: 'phenol', label: 'フェノール性ヒドロキシ基', atomIds: [a.id, c.id] });
                } else if (cNb.some(n => n.type >= 2)) {
                    // C=C-OH（エノール形）: 通常のアルコールと区別する。不安定でケト形に
                    // 互変異性するため、酸化・脱水・エステル化などのアルコール反応の対象外
                    groups.push({ type: 'enol', label: 'エノール形のヒドロキシ基（不安定）', atomIds: [a.id, c.id] });
                } else {
                    // アルコールの級数 ＝ -OH の付いた炭素に**炭素が何本ついているか**。
                    // ⚠ **`R` も1本と数える**（v966）。R は「この先も骨格が続く」印なので、
                    //   数えないと**同じ繰り返し単位なのに端だけ級数が下がる**:
                    //   ポリビニルアルコール R-[CH₂-CH(OH)]×3-R の -OH は3つとも2級だが、
                    //   R 側の1つだけ「1級アルコール」と出ていた（-CO-R と同じ取り違え。§20）。
                    //   ここは -CO-R（型そのものが R の中身で変わる）と違い、
                    //   **ヒドロキシ基であること自体は R によらず確定している**ので、黙らずに数える
                    const deg = Math.min(3, cNb.filter(n => n.atom.element === 'C' || n.atom.element === 'R').length);
                    const types = ['alcohol0', 'alcohol1', 'alcohol2', 'alcohol3'];
                    const labels = ['ヒドロキシ基（メタノール型）', '1級アルコール', '2級アルコール', '3級アルコール'];
                    groups.push({ type: types[deg], label: labels[deg], atomIds: [a.id, c.id] });
                }
            } else if (nb.length === 2 && nb.every(n => n.type === 1 && n.atom.element === 'C')) {
                // C-O-C: どちらかがカルボニル炭素ならエステルの一部なので除外
                const esterSide = nb.some(n => heavyNb(n.atom.id).some(x => x.type === 2 && x.atom.element === 'O'));
                if (!esterSide) {
                    groups.push({ type: 'ether', label: 'エーテル結合', atomIds: [nb[0].atom.id, a.id, nb[1].atom.id] });
                }
            }
        } else if (a.element === 'N') {
            const nb = heavyNb(a.id);
            const hasDoubleO = nb.some(n => n.type === 2 && n.atom.element === 'O');
            const hasSingleO = nb.some(n => n.type === 1 && n.atom.element === 'O');
            if (hasDoubleO && hasSingleO) {
                groups.push({ type: 'nitro', label: 'ニトロ基', atomIds: [a.id] });
                return;
            }
            // アミン（DESIGN_compound_coverage.md §9.6-7）。**級数はアルコールと同じく
            // 「N についた炭素の数」で決める**。以前は `getFreeValency >= 1`
            // ＝「N に水素が残っている」を条件にしていたため、**3級アミンは官能基が
            // 1つも立たず、findOutOfScopeMotifs の「高校で習う官能基にあてはまらない」で
            // 範囲外に落ちていた**（トリメチルアミンは登録ずみなのに範囲外だった）。
            // アミンの級数は教科書項目なので、これは表示の不具合。
            //
            // ⚠ 巻き込んではいけない N が4つある。除き方は下の4行がそれぞれ担当する:
            //   ニトロ    … 上で return 済み（N(=O)(-O) の価標4本の特例）
            //   ニトリル  … C≡N は炭素側で nitrile として拾う。ここは単結合だけを見るので入らない
            //   アミド    … 隣の炭素が =O を持つ N。amide が既に立っているので二重に数えない
            //   アンモニウム … 結合4本（isValencyValid の N(4) 特例）。塩であってアミンではない
            if (nb.length === 0 || !nb.every(n => n.type === 1)) return;
            // N についてよい重原子は炭素だけ。N-N・N-O・N-S・N-X は findOutOfScopeMotifs の担当
            if (!nb.every(n => n.atom.element === 'C')) return;
            if (mol.getNeighbors(a.id).length >= 4) return;
            if (nb.some(n => heavyNb(n.atom.id).some(x => x.type === 2 && x.atom.element === 'O'))) return;
            const nDeg = Math.min(3, nb.length);
            const aminTypes = [null, 'amine1', 'amine2', 'amine3'];
            const aminLabels = [null, '1級アミン', '2級アミン', '3級アミン'];
            groups.push({ type: aminTypes[nDeg], label: aminLabels[nDeg], atomIds: [a.id] });
        }
    });

    // C=C / C≡C（芳香環の交互二重結合は除く）
    mol.bonds.forEach(b => {
        if (b.type !== 2 && b.type !== 3) return;
        const a1 = mol.atoms.find(x => x.id === b.atomId1);
        const a2 = mol.atoms.find(x => x.id === b.atomId2);
        if (!a1 || !a2 || a1.element !== 'C' || a2.element !== 'C') return;
        const key = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        if (arom.has(key)) return;
        groups.push(b.type === 2
            ? { type: 'cc_double', label: 'C=C二重結合（アルケン）', atomIds: [a1.id, a2.id] }
            : { type: 'cc_triple', label: 'C≡C三重結合（アルキン）', atomIds: [a1.id, a2.id] });
    });

    // 芳香環（縮合環は結合数から環数を近似）
    if (arom.size > 0) {
        const rings = Math.max(1, Math.round(arom.size / 6));
        for (let i = 0; i < rings; i++) {
            groups.push({ type: 'aromatic', label: 'ベンゼン環（芳香族）', atomIds: [] });
        }
    }
    return groups;
}

/**
 * 高校化学の標準的な分類（カルボン酸・エステル・アルコール…）に載せてはいけない
 * 構造かどうかを見る（レビュー項目12）。異性体の全列挙は「価標が合う」だけを条件に
 * トポロジーを吐くので、過酸化環（1,2-ジオキセタン）やジェミナルジオールのような
 * 教科書に出てこない・単独では存在しにくい構造まで同じ土俵に並んでしまう。
 * それらを官能基の優先度だけで既存カテゴリへ流し込むと、初学者が
 * 「C₂H₄O₂ のエーテルにはこんなのもある」と誤って覚える。
 *
 * 見つかった理由を [{ type, label }…] で返す（空配列＝標準の分類でよい）。
 * 判定はトポロジーのみ（座標は見ない）。DOM非依存。
 */
function findOutOfScopeMotifs(mol) {
    const motifs = [];
    const heavyNb = (id) => mol.getNeighbors(id).filter(n => n.atom.element !== 'H');
    // ③（同じ炭素に2本）で見るヘテロ原子は -OH・-NH₂ の O・N だけ。
    // **ここに S やハロゲンを混ぜてはいけない**——ジクロロメタン・クロロホルムのような
    // 同じ炭素に2本のハロゲンが付く形は高校で普通に描く（ジェミナルジオールとは別物）
    const isHetero = (el) => el === 'O' || el === 'N';
    // ①（ヘテロ原子どうしの結合）で見るヘテロ原子。こちらは S とハロゲンも含む
    // （DESIGN_compound_coverage.md §9.6-1。いままで H₂N-SH・H₂N-Cl・HS-SH・H₂N-Br が
    //  普通の分類へ流れていた）
    const isHeteroForBond = (el) => isHetero(el) || el === 'S' || el === 'Cl' || el === 'Br' || el === 'I';

    // ニトロ基の N とスルホ基の S は、それぞれ N-O・S-O を持つのが正しい姿なので
    // ヘテロ原子どうしの検査から外す（許してよいヘテロ間結合はこの2つだけ）
    const nitroN = new Set();
    const sulfonylS = new Set();
    mol.atoms.forEach(a => {
        const nb = heavyNb(a.id);
        if (a.element === 'N') {
            if (nb.some(n => n.type === 2 && n.atom.element === 'O') &&
                nb.some(n => n.type === 1 && n.atom.element === 'O')) nitroN.add(a.id);
        } else if (a.element === 'S') {
            if (nb.some(n => n.type === 2 && n.atom.element === 'O')) sulfonylS.add(a.id);
        }
    });

    // ① ヘテロ原子どうしが直接つながる（-O-O-・N-N・N-O・S-S・N-Cl）。
    //    過酸化物・ヒドラジン・オキシム・ジスルフィド・ハロアミンなど
    let peroxide = false, heteroBond = false;
    mol.bonds.forEach(b => {
        const a1 = mol.atoms.find(x => x.id === b.atomId1);
        const a2 = mol.atoms.find(x => x.id === b.atomId2);
        if (!a1 || !a2 || !isHeteroForBond(a1.element) || !isHeteroForBond(a2.element)) return;
        if (nitroN.has(a1.id) || nitroN.has(a2.id)) return;
        // スルホ基の S=O / S-OH（相手が O のときだけ許す。S-N や S-Cl は許さない）
        if ((sulfonylS.has(a1.id) && a2.element === 'O') ||
            (sulfonylS.has(a2.id) && a1.element === 'O')) return;
        if (a1.element === 'O' && a2.element === 'O') peroxide = true;
        else heteroBond = true;
    });
    if (peroxide) motifs.push({ type: 'peroxide', label: '過酸化物（-O-O-）' });
    if (heteroBond) motifs.push({ type: 'hetero_bond', label: 'ヘテロ原子どうしのつながり（N-N・N-O・S-S など）' });

    // ② エノール形（C=C-OH）。ただちにケト形へ移るので、単独の化合物としては数えない
    if (findFunctionalGroups(mol).some(g => g.type === 'enol')) {
        motifs.push({ type: 'enol', label: 'エノール形（ケト形に変わる）' });
    }

    // ③ 同じ炭素に -OH / -NH₂ が2つ以上（ジェミナルジオール・ヘミアセタールなど）。
    //    カルボニル炭素（-COOH・エステル）は「=O ＋ -O-」で正しい形なので除く
    mol.atoms.forEach(a => {
        if (a.element !== 'C') return;
        const nb = heavyNb(a.id);
        if (nb.some(n => n.type === 2 && n.atom.element === 'O')) return;
        const singles = nb.filter(n => n.type === 1 && isHetero(n.atom.element));
        if (singles.length >= 2) motifs.push({ type: 'gem_diol', label: '同じ炭素に -OH・-NH₂ が2つ' });
    });

    // ④ ヘテロ原子を含むのに官能基が1つも見つからない（分類する足がかりが無い）。
    //    これを拾わないと「酸素を含むのに鎖式炭化水素」という表示になる
    if (motifs.length === 0 &&
        mol.atoms.some(a => a.element !== 'C' && a.element !== 'H') &&
        findFunctionalGroups(mol).length === 0) {
        motifs.push({ type: 'no_group', label: '高校で習う官能基にあてはまらない' });
    }

    // 同じ理由が複数の原子から出ることがある（gem-ジオールが2か所など）ので畳む
    const seen = new Set();
    return motifs.filter(m => (seen.has(m.type) ? false : (seen.add(m.type), true)));
}

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
 * 重原子グラフの共通構成（正準コードの土台）。
 * 重原子だけを取り、ラベルは「元素＋自由価標」、結合はベンゼン環を 'a' に正規化した種別。
 *
 * ⚠ **この構成を各所で書き写さないこと。** 同値関係（コード一致＝同じ分子）は
 *   この3つ（どの原子を取るか・ラベル・結合の正規化）で決まるので、写しが増えると
 *   片方だけ直る日が来る。`canonicalCode` / `canonicalStereoCode` /
 *   `stereoIsomorphismCompare` / `_heavyAtomRanks` はすべてここを通る。
 *
 * 返り値: { heavy, index: Map<atomId, 番号>, labels: string[], adj: [{j, t}][] }
 */
function buildHeavyGraph(mol) {
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    const arKeys = findAromaticBondKeys(mol);
    const index = new Map(heavy.map((a, i) => [a.id, i]));
    const labels = heavy.map(a => `${a.element}${mol.getFreeValency(a.id)}`);
    const adj = heavy.map(() => []);
    mol.bonds.forEach(b => {
        if (!index.has(b.atomId1) || !index.has(b.atomId2)) return;
        const key = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        const t = arKeys.has(key) ? 'a' : String(b.type);
        adj[index.get(b.atomId1)].push({ j: index.get(b.atomId2), t });
        adj[index.get(b.atomId2)].push({ j: index.get(b.atomId1), t });
    });
    return { heavy, index, labels, adj };
}

/**
 * 1次元 Weisfeiler-Leman による反復精緻化（P8-2）。
 * 「自分の色と、隣の（結合種別つき）色の多重集合」で塗り直す操作を n 回繰り返し、
 * 頂点ごとの**同型不変なクラス番号** `'c0'`, `'c1'`, … を返す（番号は署名の辞書順）。
 *
 * ⚠ **これがこのファイルで唯一の WL 実装**。同じ判定を2か所に置かないこと
 *   （このリポジトリは同名2実装で1日に2回踏んでいる: `pointSegmentDistance` の
 *    重複と、主鎖選びが `findLongestCarbonChain` と `iupacName` に分かれていた件）。
 *   使い手は2つ:
 *   - `canonicalRowsCore` … クラス番号を**行文字列にそのまま埋める**（＝正準コードの一部）
 *   - `_heavyAtomRanks`   … クラス番号を整数の順位として使い、同点の炭素鎖を割る
 *
 * ⚠ **回数を減らす「最適化」をしてはいけない**（等価分割に達したら打ち切る、など）。
 *   分割そのものは安定しても、**番号の付き直しは止まらない** —— 次の周回の署名は
 *   `'c0'`,`'c1'`,…,`'c10'` の**文字列**を辞書順に並べ直すので（`'c10' < 'c2'`）、
 *   打ち切る位置で最終的なクラス番号が変わる。番号は `canonicalCode` の出力文字列に
 *   そのまま現れるため、打ち切りは**公開済みのコードを丸ごと変える**。
 */
function wlRefine(n, adj, labels) {
    let cls = labels.map(l => l);
    for (let iter = 0; iter < n; iter++) {
        const sigs = cls.map((cv, i) =>
            cv + '|' + adj[i].map(e => e.t + ':' + cls[e.j]).sort().join(','));
        const uniq = [...new Set(sigs)].sort();
        const renum = new Map(uniq.map((s, k) => [s, 'c' + k]));
        cls = sigs.map(s => renum.get(s));
    }
    return cls;
}

/**
 * 正準コード探索の共通コア（P8-2）。
 * 頂点0..n-1、adj[i]=[{j, t}]（tは結合タイプ文字）、labels[i]=原子ラベル。
 * Weisfeiler-Leman型の反復精緻化（`wlRefine`）で同型不変なクラスを割り当てたのち、
 * 「各位置で行文字列が最小になる候補だけに分岐する」バックトラックで
 * 行配列（辞書順最小）を求める。同型なグラフは必ず同じ行配列になる。
 * forcedFirst を指定するとその頂点を先頭位置に固定する（根付きコード用）。
 * collect に配列を渡すと、最小行配列を達成する頂点→位置の割当（＝自己同型の個数だけある）を
 * すべて収集する（P12-7 M0: 立体記述子の層を自己同型で畳むために使う）。
 * 辞書順比較は接頭辞優越なので、最適な割当は必ず「各段で行文字列最小の候補」を通る。
 * よって既存の分岐がそのまま全最適割当を訪問しており、収集は探索コストを増やさない。
 */
function canonicalRowsCore(n, adj, labels, forcedFirst = null, collect = null) {
    if (n === 0) return [];

    // 1. WL精緻化（同型不変なクラス番号。n回で必ず安定する）
    const cls = wlRefine(n, adj, labels);

    // 2. 最小コード探索
    const placedPos = new Array(n).fill(-1);
    const rows = [];
    let bestRows = null;

    const rowStringFor = (i) => {
        const edges = adj[i]
            .filter(e => placedPos[e.j] >= 0)
            .map(e => placedPos[e.j] + e.t)
            .sort()
            .join('.');
        return `${labels[i]}[${cls[i]}](${edges})`;
    };
    const cmpRows = (a, b) => {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
            if (a[i] < b[i]) return -1;
            if (a[i] > b[i]) return 1;
        }
        return a.length - b.length;
    };
    const search = () => {
        const k = rows.length;
        if (k === n) {
            if (bestRows === null || cmpRows(rows, bestRows) < 0) {
                bestRows = [...rows];
                if (collect) {
                    collect.length = 0;
                    collect.push([...placedPos]);
                }
            } else if (collect && cmpRows(rows, bestRows) === 0 && collect.length < 20000) {
                // 同着＝自己同型による別割当。上限は病的な高対称グラフでの暴走防止
                // （対象の分子サイズでは到達しない。placedPos[i]=頂点iの位置）
                collect.push([...placedPos]);
            }
            return;
        }
        // 行文字列が最小の候補だけに分岐（同値候補＝ほぼ自己同型なので分岐数は小さい）
        let minRow = null;
        let cands = [];
        for (let i = 0; i < n; i++) {
            if (placedPos[i] >= 0) continue;
            if (k === 0 && forcedFirst !== null && i !== forcedFirst) continue;
            const r = rowStringFor(i);
            if (minRow === null || r < minRow) {
                minRow = r;
                cands = [i];
            } else if (r === minRow) {
                cands.push(i);
            }
        }
        cands.forEach(i => {
            placedPos[i] = k;
            rows.push(minRow);
            search();
            rows.pop();
            placedPos[i] = -1;
        });
    };
    search();
    return bestRows || [];
}

/**
 * 分子グラフの正準コードを返す（P8-2）。
 * 同値関係は verifyMolecule と同一: 重原子グラフ＋各原子の自動H数＋結合次数
 * （ベンゼン環の結合は 'a' に正規化してケクレ位相を同一視）。立体は区別しない。
 * 同値な分子は必ず同じ文字列になり、コード一致⇔グラフ同型として使える。
 */
function canonicalCode(mol) {
    const { heavy, labels, adj } = buildHeavyGraph(mol);
    if (heavy.length === 0) return '';

    // 連結成分ごとに正準化し、成分コードをソートして結合する。
    // （同一の成分が複数ある非連結分子で、成分間のタイ分岐が組合せ爆発するのを防ぐ。
    //   成分正準コードの多重集合は非連結グラフの完全な同型不変量なので正しさも保たれる）
    const compOf = new Array(heavy.length).fill(-1);
    let compCount = 0;
    for (let s = 0; s < heavy.length; s++) {
        if (compOf[s] >= 0) continue;
        const stack = [s];
        compOf[s] = compCount;
        while (stack.length) {
            const i = stack.pop();
            adj[i].forEach(e => {
                if (compOf[e.j] < 0) {
                    compOf[e.j] = compCount;
                    stack.push(e.j);
                }
            });
        }
        compCount++;
    }
    const compCodes = [];
    for (let cidx = 0; cidx < compCount; cidx++) {
        const nodes = [];
        for (let i = 0; i < heavy.length; i++) {
            if (compOf[i] === cidx) nodes.push(i);
        }
        const local = new Map(nodes.map((gi, li) => [gi, li]));
        const subLabels = nodes.map(gi => labels[gi]);
        const subAdj = nodes.map(gi => adj[gi].map(e => ({ j: local.get(e.j), t: e.t })));
        compCodes.push(canonicalRowsCore(nodes.length, subAdj, subLabels, null).join(';'));
    }
    compCodes.sort();
    return compCodes.join('/');
}

/**
 * 中心原子から見た1本の枝を、**中心から数えた階層（シェル）ごとの組成**として返す。
 * 「なぜこの炭素が不斉なのか」を1原子ずつ辿って納得するための道具（P12-8。ユーザー要望）。
 *
 * 例: シクロヘキサン環の炭素から見た2方向は、分子式では同じに見えるが、
 * 置換基の位置がずれていれば**どこかの階層で組成が食い違う**。その階層を指させる。
 *
 * 返り値: [{ depth, atoms:[{element, freeValency}], text }]（text は 'C,C' のような並び）
 * 水素は数えない（作図では自動補完で、階層の比較には効かない）。
 * CIP の順位付けはここではしない（順位づけは cipRank（発注書 4b・v440）の仕事）。
 * ここでやるのは「辿って、食い違う場所を指す」ことだけ。
 */
function branchShells(mol, rootId, excludeId, maxDepth = 8) {
    const shells = [];
    const seen = new Set([excludeId]);
    let frontier = [rootId];
    seen.add(rootId);
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
        const atoms = frontier
            .map(id => mol.atoms.find(a => a.id === id))
            .filter(Boolean)
            .map(a => ({ element: a.element, freeValency: mol.getFreeValency(a.id) }));
        // 並び順が枝の書き方に依存しないよう、元素記号で並べてから文字列にする
        const text = atoms.map(a => a.element).sort().join(',');
        shells.push({ depth, atoms, text });
        const next = [];
        frontier.forEach(id => {
            mol.getNeighbors(id).forEach(n => {
                if (n.atom.element === 'H' || seen.has(n.atom.id)) return;
                seen.add(n.atom.id);
                next.push(n.atom.id);
            });
        });
        frontier = next;
    }
    return shells;
}

/**
 * 2本の枝のシェル列を比べて、**最初に食い違う階層**を返す（1始まり）。
 * 同じなら null（＝この2本は辿っても区別できない）。
 * 片方が先に尽きた場合は、その次の階層を食い違いとする。
 */
function firstDifferingShell(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const ta = a[i] ? a[i].text : null;
        const tb = b[i] ? b[i].text : null;
        if (ta !== tb) return i + 1;
    }
    return null;
}

/**
 * 中心原子(excludeId)を通らずに root から到達できる断片の、rootを先頭に固定した
 * 正準コードを返す（不斉炭素の置換基比較用）。H数は元の分子での値を使い、
 * 中心との結合が存在する文脈を保つ。
 */
function rootedFragmentCode(mol, rootId, excludeId) {
    const arKeys = findAromaticBondKeys(mol);
    const fragIds = [rootId];
    const seen = new Set([excludeId, rootId]);
    const stack = [rootId];
    while (stack.length) {
        const id = stack.pop();
        mol.getNeighbors(id).forEach(n => {
            if (n.atom.element === 'H' || seen.has(n.atom.id)) return;
            seen.add(n.atom.id);
            fragIds.push(n.atom.id);
            stack.push(n.atom.id);
        });
    }
    const index = new Map(fragIds.map((id, i) => [id, i]));
    const labels = fragIds.map(id => {
        const a = mol.atoms.find(at => at.id === id);
        return `${a.element}${mol.getFreeValency(id)}`;
    });
    const adj = fragIds.map(() => []);
    mol.bonds.forEach(b => {
        if (!index.has(b.atomId1) || !index.has(b.atomId2)) return;
        const key = b.atomId1 < b.atomId2 ? `${b.atomId1}_${b.atomId2}` : `${b.atomId2}_${b.atomId1}`;
        const t = arKeys.has(key) ? 'a' : String(b.type);
        adj[index.get(b.atomId1)].push({ j: index.get(b.atomId2), t });
        adj[index.get(b.atomId2)].push({ j: index.get(b.atomId1), t });
    });
    return canonicalRowsCore(fragIds.length, adj, labels, 0).join(';');
}

// ===== 立体レイヤ（P12-7 M0。DESIGN_stereochemistry.md 8章） =====
// 方針: 既定の canonicalCode / verifyMolecule は一切変えない（回帰ゼロ）。
// 立体は「記述子」を引数で受け取る別関数 canonicalStereoCode がオプトインで扱う。
// 記述子は CIP を使わず、置換基の rootedFragmentCode の辞書順（＝構成的で
// ラベル付けに依存しない正準順序）を基準に定義する。
// ※ 発注書 4b（v440）で R/S の**呼び名**を出す cipRank / assignRSDescriptor を足したが、
//   それは表示専用の別関数で、この同値関係（コード一致＝同じ分子）には一切使わない。

/**
 * 不斉中心のパリティを計算する（P12-7 M0）。
 * order は中心 atomId の4置換基を「入力時の空間配置の規約」で並べた長さ4の配列
 * （重原子は原子ID・暗黙の水素は 'H'）。規約は入力層が固定していればよく
 * （例: order[0] から見て order[1]→[2]→[3] が反時計回り）、本関数はその順列が
 * 「断片コードの辞書順」の偶置換なら +1、奇置換なら -1 を返す。
 * どの2要素を入れ替えても符号が反転する＝鏡像でパリティが反転する。
 * 4置換基の断片コードが相異ならない場合（擬似不斉中心を含む）は null（M0 対象外）。
 */
function computeAtomParity(mol, atomId, order) {
    if (!Array.isArray(order) || order.length !== 4) return null;
    if (!mol.isSp3Carbon(atomId)) return null;
    // order の内容が実際の置換基集合と一致するか検証（重原子=隣接ID・'H'=自由価数）
    const heavyIds = mol.getNeighbors(atomId)
        .filter(n => n.atom.element !== 'H')
        .map(n => n.atom.id);
    const givenHeavy = order.filter(o => o !== 'H');
    const givenH = order.length - givenHeavy.length;
    if (givenH !== mol.getFreeValency(atomId)) return null;
    if (new Set(givenHeavy).size !== givenHeavy.length) return null;
    if (givenHeavy.length !== heavyIds.length ||
        !givenHeavy.every(id => heavyIds.includes(id))) return null;

    const codes = order.map(o => o === 'H' ? 'H' : rootedFragmentCode(mol, o, atomId));
    if (new Set(codes).size !== 4) return null;
    let inversions = 0;
    for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
            if (codes[i] > codes[j]) inversions++;
        }
    }
    return inversions % 2 === 0 ? 1 : -1;
}

/**
 * 立体記述子を鏡映する（P12-7 M0）。原子パリティは全反転・結合の syn/anti は不変。
 * canonicalStereoCode(mol, s) === canonicalStereoCode(mol, mirrorStereo(s)) なら
 * その分子はアキラル（メソ体の検出に使える）。
 */
function mirrorStereo(stereo) {
    const out = { atomParity: {}, bondGeo: Object.assign({}, (stereo && stereo.bondGeo) || {}) };
    const ap = (stereo && stereo.atomParity) || {};
    Object.keys(ap).forEach(k => { out.atomParity[k] = -ap[k]; });
    return out;
}

// 結合が環に含まれるか（＝その結合を除いても両端が繋がっているか）。
// getDoubleBondGeometry 内の同名ロジックと同じ判定。
function _bondInRingForStereo(mol, bond) {
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
}

/**
 * 幾何（E/Z）が定義できる C=C 結合について、各端の「基準置換基」を返す（P12-7 M1）。
 * 適格条件（canonicalStereoCode の geoEntries と同一）:
 *   - 結合次数2・両端が炭素・非環
 *   - 各端に重原子置換基（二重結合相手・水素を除く）が1〜2個
 *   - 2個ある端はその2つの rootedFragmentCode が相異なる（基準が一意に決まる）
 * 基準置換基＝断片コードが最小の重原子置換基（1個ならそれ）。
 * 戻り値: 適格なら { refA, refB }（refA は atomId1 側・refB は atomId2 側の基準置換基 atomId）、
 *         不適格なら null。
 * canonicalStereoCode（記述子照合）と readBondGeoFromCoords（座標読み取り）が共有する。
 */
function _bondGeoRefs(mol, bond) {
    if (bond.type !== 2) return null;
    const a1 = mol.atoms.find(a => a.id === bond.atomId1);
    const a2 = mol.atoms.find(a => a.id === bond.atomId2);
    if (!a1 || !a2 || a1.element !== 'C' || a2.element !== 'C') return null;
    if (_bondInRingForStereo(mol, bond)) return null;
    const refOf = (endId, otherId) => {
        const subs = mol.getNeighbors(endId)
            .filter(n => n.atom.id !== otherId && n.atom.element !== 'H')
            .map(n => ({ id: n.atom.id, code: rootedFragmentCode(mol, n.atom.id, endId) }));
        if (subs.length === 0 || subs.length > 2) return null;
        if (subs.length === 2 && subs[0].code === subs[1].code) return null;
        subs.sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
        return subs[0].id; // 断片コード最小＝基準置換基
    };
    const refA = refOf(bond.atomId1, bond.atomId2);
    const refB = refOf(bond.atomId2, bond.atomId1);
    if (refA === null || refB === null) return null;
    return { refA, refB };
}

/**
 * 分子の座標から、幾何が定義できるすべての C=C の syn/anti を読む（P12-7 M1）。
 * getDoubleBondGeometry の制限（分子内に対象1本のみ・2置換のみ）を超え、
 * 3置換アルケンや複数の C=C も読める汎用版。判定は canonicalStereoCode と同じ
 * 「基準置換基」基準・同じ約6°閾値（sin < 0.1 を直線描画＝不定とみなす）。
 * 戻り値: { 'atomId1_atomId2': 'syn'|'anti' }（キーは Bond の ID 昇順慣例）。
 *   両端の基準置換基が C=C 軸の同じ側なら 'syn'、反対側なら 'anti'。
 *   不適格な結合・どちらかの端が直線描画（不定）の結合はスキップする。
 * ※座標は原則「見た目専用」だが、二重結合まわりの幾何は 2D 構造式が幾何異性を
 *   伝える標準手段のため、命名照合に限り例外的に読む（開発方針4章-4）。
 */
function readBondGeoFromCoords(mol) {
    const out = {};
    mol.bonds.forEach(bond => {
        const refs = _bondGeoRefs(mol, bond);
        if (!refs) return;
        const a = mol.atoms.find(at => at.id === bond.atomId1);
        const b = mol.atoms.find(at => at.id === bond.atomId2);
        const ax = b.x - a.x;
        const ay = b.y - a.y;
        const axisLen = Math.hypot(ax, ay) || 1;
        const sideOf = (subId, origin) => {
            const p = mol.atoms.find(at => at.id === subId);
            const sx = p.x - origin.x;
            const sy = p.y - origin.y;
            const cross = ax * sy - ay * sx;
            const norm = cross / (axisLen * (Math.hypot(sx, sy) || 1));
            if (Math.abs(norm) < 0.1) return 0; // sin約6度未満 → 直線描画とみなす
            return Math.sign(cross);
        };
        const sa = sideOf(refs.refA, a);
        const sb = sideOf(refs.refB, b);
        if (sa === 0 || sb === 0) return; // 幾何を描き分けていない → スキップ
        out[`${bond.atomId1}_${bond.atomId2}`] = (sa === sb) ? 'syn' : 'anti';
    });
    return out;
}

/**
 * フィッシャー投影の座標から sp3 不斉中心のパリティを読む（P12-7 M2a）。
 * DESIGN_stereochemistry.md 10.2 の規約:
 *   - 対象は isAsymmetricCarbon が真の sp3 炭素のみ。
 *   - その中心の重原子置換基（H 以外の隣接原子）がすべて軸方向（上/右/下/左）に
 *     ±25°以内で並んでいること。1本でも軸から外れる中心はスキップ（記述子なし）。
 *   - 各重原子置換基をスロット [上,右,下,左] に割り当てる。同一スロットに2本入る
 *     （角度が近すぎる）なら不適格でスキップ。
 *   - 空きスロット数が暗黙水素数（getFreeValency）と一致しなければスキップ。
 *   - スロット順 [上,右,下,左] に重原子=atomId・空き=H を並べた長さ4タプルを
 *     computeAtomParity に渡す。null が返る中心はスキップ。
 * y は画面座標（下が正）。上=(0,-1)・右=(+1,0)・下=(0,+1)・左=(-1,0)。
 * スロット順 [上,右,下,左] は時計回りの固定規約で、90°回転で符号反転・
 * 180°回転で符号不変・左右反転で符号反転（＝鏡像でパリティ反転）を満たす。
 * 戻り値: { atomId: ±1 }（適格な中心のみ）。
 * ※座標は原則「見た目専用」だが、フィッシャー投影は縦=奥/横=手前の固定規約を持つ
 *   直交図であり、本アプリの直交格子と幾何が一致するため、命名照合に限り読む（開発方針4章）。
 */
/**
 * いずれかの環に属する原子IDの集合を返す（P12-7 M2b）。
 * 各結合について「その結合を除いても両端が繋がっているか」で環結合を判定し、
 * 環結合の端点を集める（_bondInRingForStereo と同じ環判定）。
 */
function _ringAtomIds(mol) {
    const inRing = new Set();
    mol.bonds.forEach(bond => {
        if (_bondInRingForStereo(mol, bond)) {
            inRing.add(bond.atomId1);
            inRing.add(bond.atomId2);
        }
    });
    return inRing;
}

/**
 * 4置換基の3D方向ベクトルからパリティ(±1)を計算する（P12-7 M2b）。
 * dirs: [{ ref, v:[x,y,z] }] 長さ4。ref は置換基の atomId または 'H'。
 * 各 ref のフラグメントコード辞書順に並べ、det[v1-v0,v2-v0,v3-v0] の符号を返す。
 * computeAtomParity（M0のタプル版）と一貫した符号関係で一致する（試作 m2b_probe.js で確認）。
 * 環中心と鎖中心は別構成のため stereoCode は比較されず、環リーダー内で自己整合すればよい。
 */
function _parityFromDirs(mol, centerId, dirs) {
    if (!Array.isArray(dirs) || dirs.length !== 4) return null;
    const withCode = dirs.map(d => ({
        code: d.ref === 'H' ? 'H' : rootedFragmentCode(mol, d.ref, centerId),
        v: d.v
    }));
    if (new Set(withCode.map(d => d.code)).size !== 4) return null; // 4置換基が相異なること
    withCode.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const [v0, v1, v2, v3] = withCode.map(d => d.v);
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const a = sub(v1, v0), b = sub(v2, v0), c = sub(v3, v0);
    const det = a[0] * (b[1] * c[2] - b[2] * c[1])
              - a[1] * (b[0] * c[2] - b[2] * c[0])
              + a[2] * (b[0] * c[1] - b[1] * c[0]);
    return det > 1e-9 ? 1 : det < -1e-9 ? -1 : null; // 平面配置（面外情報なし）は null
}

/**
 * sp3 中心の4置換基を、指定パリティに一致する正四面体配置の3D方向ベクトルに割り当てる（P12-7 M3）。
 * 疑似3D表示（回転して見せる）を、ユーザーが実際に描いた立体と一致させるための土台。
 * parity: +1 / -1（readAtomParityFromFischer・readRingParityFromHaworth が返す値）。
 *   null（立体未指定）のときは既定の配置を返す（handedness は任意＝どちらかは名乗らない）。
 * 戻り値: [{ ref, code, v:[x,y,z] }]（ref は置換基の atomId または 'H'）。
 *   4置換基が相異ならない（不斉でない）中心は null。
 * 性質: 返り値の並びに parityFromDirs を適用すると parity に一致する。
 *   回転しても不変・鏡映（x を反転）でパリティが反転する。
 */
function tetrahedralDirs(mol, atomId, parity) {
    if (!mol.isSp3Carbon(atomId)) return null;
    const refs = mol.getNeighbors(atomId)
        .filter(n => n.atom.element !== 'H')
        .map(n => n.atom.id);
    for (let i = 0; i < mol.getFreeValency(atomId); i++) refs.push('H');
    if (refs.length !== 4) return null;
    const items = refs.map(ref => ({
        ref,
        code: ref === 'H' ? 'H' : rootedFragmentCode(mol, ref, atomId)
    }));
    if (new Set(items.map(i => i.code)).size !== 4) return null; // 不斉中心のみ
    items.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    // 正四面体の頂点（原点中心。この並び自体がひとつの handedness を持つ）
    const V = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    const norm = v => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; };
    let dirs = items.map((it, i) => ({ ref: it.ref, code: it.code, v: norm(V[i]) }));
    if (parity === 1 || parity === -1) {
        // 既定配置のパリティが指定と違えば2つ入れ替えて反転させる（＝鏡像にする）
        if (parityFromDirs(dirs) !== parity) {
            const t = dirs[2].v; dirs[2].v = dirs[3].v; dirs[3].v = t;
        }
    }
    return dirs;
}

/**
 * 方向ベクトル群（[{code, v}]）のパリティを返す（P12-7 M3。_parityFromDirs の公開版）。
 * コード辞書順に並べ、det[v1-v0, v2-v0, v3-v0] の符号を取る。
 * 回転で不変・鏡映で反転する量なので、疑似3D表示の handedness 検証に使える。
 */
function parityFromDirs(dirs) {
    if (!Array.isArray(dirs) || dirs.length !== 4) return null;
    const s = [...dirs].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const [v0, v1, v2, v3] = s.map(d => d.v);
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const a = sub(v1, v0), b = sub(v2, v0), c = sub(v3, v0);
    const det = a[0] * (b[1] * c[2] - b[2] * c[1])
              - a[1] * (b[0] * c[2] - b[2] * c[0])
              + a[2] * (b[0] * c[1] - b[1] * c[0]);
    return det > 1e-9 ? 1 : det < -1e-9 ? -1 : null;
}

/**
 * ハース投影で環外に重原子が2本出ている中心（ケトースのアノマー炭素）について、
 * 「どちらが環平面の面を決めるか」を並べて返す（DESIGN_compound_coverage.md §6-3）。
 *
 * **規約**: ヘテロ原子（-OH・グリコシド結合の -O-）を炭素（-CH₂OH）より優先し、
 * 同じ元素どうしなら rootedFragmentCode の辞書順で先に来るほうを**主置換基**とする。
 * ＝ アノマー炭素では必ず**酸素側が面を決める**ので、環外1本のアルドース
 * （単一の -OH がそのまま面を決める）と読み方がそろう。
 * 戻り値は [主置換基, 劣位側] の順。
 */
function _haworthPrimaryOut(mol, centerId, outHeavy) {
    const hetero = n => (n.atom.element === 'C' ? 1 : 0); // ヘテロ原子が先
    return [...outHeavy].sort((a, b) => {
        const d = hetero(a) - hetero(b);
        if (d !== 0) return d;
        const ca = rootedFragmentCode(mol, a.atom.id, centerId);
        const cb = rootedFragmentCode(mol, b.atom.id, centerId);
        return ca < cb ? -1 : ca > cb ? 1 : 0;
    });
}

/**
 * ハース投影から環sp3不斉中心のパリティを読む（P12-7 M2b / M2c、環外2本は §6-3）。
 * DESIGN_stereochemistry.md 11.3・12章の規約:
 *   - 対象は「環に属する」sp3 不斉中心で、環隣接ちょうど2本のもの。
 *     環外の重原子置換基は **1本（＋暗黙H1本）または2本（暗黙Hなし）**。
 *   - 環隣接2本 → 2D座標そのままの面内ベクトル(z=0)。
 *   - 環外の面(±1)を z に（[0,0,+face]）、残り（暗黙H／もう1本の置換基）は反対面。
 *   - 面の決め方: (優先) 原子の haworthFace(+1=上/-1=下) が明示されていればそれ。
 *     (M2c) 未指定なら、置換基が環炭素から十分に縦（±25°以内）に描かれていれば
 *     縦位置から導出（画面上=手前+1／下=奥-1）。教科書ハース投影をそのまま描けば読める。
 *     縦から外れる・非標準構成の中心はスキップ（記述子なし）。
 *   - **環外2本のとき（フルクトフラノースの C2 など）**は、ハース投影では
 *     環平面の上と下に1本ずつ出るので**必ず反対の面に置く**。どちらを上にするかは
 *     `_haworthPrimaryOut` の主置換基（＝酸素側）の面で決める。
 *     主置換基が縦から外れて読めないときだけ、劣位側の面を読んで**反転**して使う
 *     （スクロースのグリコシド酸素のように、橋渡しの結合が斜めに描かれる図のため）。
 *     2本が**同じ面**を指す図は壊れているのでスキップする。
 *   - _parityFromDirs でパリティ。
 * フィッシャー（readAtomParityFromFischer・非環）と相互排他（環原子のみを扱う）。
 * 戻り値: { atomId: ±1 }（適格な中心のみ）。
 */
function readRingParityFromHaworth(mol) {
    const out = {};
    const ring = _ringAtomIds(mol);
    mol.atoms.forEach(center => {
        if (center.element !== 'C' || !ring.has(center.id)) return;
        if (!mol.isAsymmetricCarbon(center.id)) return;
        const nbrs = mol.getNeighbors(center.id);
        const ringNbrs = nbrs.filter(n => ring.has(n.atom.id));
        const outHeavy = nbrs.filter(n => !ring.has(n.atom.id) && n.atom.element !== 'H');
        if (ringNbrs.length !== 2) return; // 標準的な環立体中心のみ
        // 環の隣は2D座標そのまま（面内・z=0）。環外は _haworthFaceOf で面を読む
        // （面マーク haworthFace が優先、無ければ縦位置。読めなければ 0）
        const ringDirs = ringNbrs.map(n => ({
            ref: n.atom.id, v: [n.atom.x - center.x, n.atom.y - center.y, 0]
        }));
        let dirs = null;
        if (outHeavy.length === 1) {
            const face = _haworthFaceOf(center, outHeavy[0].atom);
            if (!face) return; // 縦から外れる → スキップ
            dirs = ringDirs.concat([
                { ref: outHeavy[0].atom.id, v: [0, 0, face] },
                { ref: 'H', v: [0, 0, -face] }
            ]);
        } else if (outHeavy.length === 2) {
            const [hi, lo] = _haworthPrimaryOut(mol, center.id, outHeavy);
            const faceHi = _haworthFaceOf(center, hi.atom);
            const faceLo = _haworthFaceOf(center, lo.atom);
            if (faceHi && faceLo && faceHi === faceLo) return; // 2本が同じ面 → 図が読めない
            const face = faceHi || -faceLo; // 主置換基が読めないときだけ劣位側を反転して使う
            if (!face) return;
            dirs = ringDirs.concat([
                { ref: hi.atom.id, v: [0, 0, face] },
                { ref: lo.atom.id, v: [0, 0, -face] }
            ]);
        } else {
            return;
        }
        const p = _parityFromDirs(mol, center.id, dirs);
        if (p !== null) out[center.id] = p;
    });
    return out;
}

/**
 * フィッシャー投影として読める sp3 中心について、各スロットに何が入っているかを返す（P12-8）。
 * readAtomParityFromFischer と同じ適格条件（重原子置換基がすべて軸方向±25°・スロット衝突なし・
 * 空きスロット数＝暗黙H数）で、{ up, right, down, left } を返す（値は atomId または 'H'）。
 * 読めない中心・環内の中心は null。
 * くさび図をフィッシャーの向き（縦=奥・横=手前）で描くために使う。
 * ※この向きなら4方向は同一平面に乗らないため、くさび図でも手性を表現できる
 *   （現行の「上下=紙面内・右=手前・左=奥」は左右が正反対で平面になり表現できない）。
 */
function fischerSlots(mol, atomId) {
    const ring = _ringAtomIds(mol);
    if (ring.has(atomId)) return null; // 環中心はハース側の担当
    const atom = mol.atoms.find(a => a.id === atomId);
    if (!atom || atom.element !== 'C' || !mol.isSp3Carbon(atomId)) return null;
    const AXES = [
        { key: 'up', vx: 0, vy: -1 },
        { key: 'right', vx: 1, vy: 0 },
        { key: 'down', vx: 0, vy: 1 },
        { key: 'left', vx: -1, vy: 0 }
    ];
    const COS_TOL = Math.cos(25 * Math.PI / 180);
    const slots = { up: null, right: null, down: null, left: null };
    const heavy = mol.getNeighbors(atomId).filter(n => n.atom.element !== 'H');
    for (const n of heavy) {
        const dx = n.atom.x - atom.x;
        const dy = n.atom.y - atom.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return null;
        const hit = AXES.find(ax => (dx * ax.vx + dy * ax.vy) / len >= COS_TOL);
        if (!hit || slots[hit.key] !== null) return null; // 軸外れ・スロット衝突
        slots[hit.key] = n.atom.id;
    }
    const empty = Object.keys(slots).filter(k => slots[k] === null);
    if (empty.length !== mol.getFreeValency(atomId)) return null;
    empty.forEach(k => { slots[k] = 'H'; });
    return slots;
}

/**
 * D/L の判定（`video-scripts/ORDER_stereo_puzzle.md` 第4段 4a）。
 *
 * **フィッシャー投影の基準炭素で、基準の置換基が右なら D・左なら L** という定義そのものを
 * 計算する。**CIP（R/S）とは無関係**で、順位づけには踏み込まない（R/S は assignRSDescriptor が別に出す）。
 * これまでは名前に付いた "D-"/"L-" を引いているだけで、図から計算してはいなかった。
 *
 * 基準炭素の選び方は、高校化学で出る3系統だけを扱う:
 *   ・**アミノ酸** … -NH₂ と -COOH が付いた α炭素。基準の置換基は **-NH₂**
 *   ・**それ以外** … 鎖の頭（-CHO / C=O / -COOH）から**いちばん遠い**不斉炭素（＝最下位）の **-OH**。
 *                    糖も、乳酸のような α-ヒドロキシ酸（不斉炭素が1つなので α炭素そのもの）も、
 *                    糖から作った酸（グルコン酸）も**同じ規則で揃う**。
 *                    α炭素で読む規則にすると、グルコン酸が glucose 由来なのに L と出てしまう。
 *                    **頭の候補が2つあって答えが割れる分子（酒石酸）は断定しない**
 *
 * 図の向きの扱い: 基準炭素から見て**主鎖の C1 側が上**にあるのが標準の向き。
 * 180°回した図（C1 側が下）は**同じ分子**（偶置換）だが左右も入れ替わるので、
 * そのときは左右の読みを裏返す。**主鎖が横向きの図はフィッシャー投影として読まない**（null）。
 *
 * どちらの系統にも当てはまらない・図が読めない場合は null（＝断定しない）。
 */
function assignDLDescriptor(mol) {
    const parities = readAtomParityFromFischer(mol);
    const centerIds = Object.keys(parities);
    if (!centerIds.length) return null;

    const atomOf = id => mol.atoms.find(a => a.id === id);
    const heavyNbrs = id => mol.getNeighbors(id).filter(n => n.atom.element !== 'H');
    // カルボキシ基の炭素（-COOH / -COO-Na）。**エステルは除く**——単結合の O の先が
    // 炭素につながっていたらエステルで、鎖の頭にはならない
    // （油脂のモノグリセリドを糖のように読んで L体 と言い出す事故を防ぐ）
    const isCarboxylC = id => {
        const a = atomOf(id);
        if (!a || a.element !== 'C') return false;
        const os = mol.getNeighbors(id).filter(n => n.atom.element === 'O');
        if (!os.some(n => n.type === 2)) return false;
        const single = os.filter(n => n.type === 1);
        if (!single.length) return false;
        // 塩になっていても「カルボキシ基」として読む（-COONa / -COOK。§9.6-8 で K を足した）
        return single.some(n => heavyNbrs(n.atom.id)
            .every(m => m.atom.id === id || m.atom.element === 'Na' || m.atom.element === 'K'));
    };
    // アルデヒド／ケトンのカルボニル炭素（=O をもち、**単結合の O をもたない**）。
    // エステル・カルボン酸はここに入らない
    const isCarbonylC = id => {
        const a = atomOf(id);
        if (!a || a.element !== 'C') return false;
        const os = mol.getNeighbors(id).filter(n => n.atom.element === 'O');
        return os.some(n => n.type === 2) && !os.some(n => n.type === 1);
    };
    // アミノ基の窒素（先に重原子がぶら下がっていない ＝ -NH₂ / -NH-）
    const isAminoN = (id, fromId) => {
        const a = atomOf(id);
        return !!a && a.element === 'N' &&
               heavyNbrs(id).every(n => n.atom.id === fromId);
    };

    // --- 基準炭素と基準の置換基を決める ---
    let centerId = null, refId = null, kind = null, refName = null, headId = null;

    // (1) アミノ酸: -NH₂ と -COOH が直接ついた不斉炭素（α炭素）
    for (const id of centerIds) {
        const nbrs = heavyNbrs(id);
        const n = nbrs.find(x => isAminoN(x.atom.id, id));
        const cooh = nbrs.find(x => isCarboxylC(x.atom.id));
        if (n && cooh) {
            centerId = id; refId = n.atom.id; kind = 'amino'; refName = '-NH₂';
            break;
        }
    }

    // 先がふさがっていない -OH（＝ヒドロキシ基）を中心 id の隣から探す
    const hydroxylOf = id => heavyNbrs(id).find(n => n.atom.element === 'O' &&
        heavyNbrs(n.atom.id).every(m => m.atom.id === id));
    // 重原子だけをたどった距離（幅優先）
    const distFrom = startId => {
        const dist = { [startId]: 0 };
        let wave = [startId];
        while (wave.length) {
            const next = [];
            wave.forEach(id => heavyNbrs(id).forEach(n => {
                if (dist[n.atom.id] === undefined) {
                    dist[n.atom.id] = dist[id] + 1;
                    next.push(n.atom.id);
                }
            }));
            wave = next;
        }
        return dist;
    };

    // (2) -OH で決める系統（糖・α-ヒドロキシ酸）。
    // **基準はどちらも「鎖の頭（C=O）からいちばん遠い不斉炭素」＝最下位**で、乳酸のように
    // 不斉炭素が1つなら α炭素そのものになる。糖から作った酸（グルコン酸）も同じ規則で揃う
    // ——α炭素で読むと glucose 由来なのに L と出てしまう。
    // 頭の候補が2つあって答えが割れる分子（酒石酸）は**断定しない**。
    if (!centerId) {
        const heads = mol.atoms.filter(a => isCarbonylC(a.id) || isCarboxylC(a.id));
        if (!heads.length) return null;
        let agreed = null, headAtom = null;
        for (const head of heads) {
            const dist = distFrom(head.id);
            let best = null, tie = false;
            centerIds.forEach(id => {
                if (dist[id] === undefined) return;
                if (best === null || dist[id] > dist[best]) { best = id; tie = false; }
                else if (dist[id] === dist[best]) tie = true;
            });
            if (best === null || tie) return null; // 届かない／最下位が決まらない
            if (agreed === null) { agreed = best; headAtom = head; }
            else if (agreed !== best) return null; // 頭の取り方で答えが割れる（酒石酸）
        }
        const oh = hydroxylOf(agreed);
        if (!oh) return null;
        centerId = agreed; refId = oh.atom.id; refName = '-OH'; headId = headAtom.id;
        kind = isCarbonylC(headAtom.id) ? 'sugar' : 'hydroxyacid';
    }

    // --- 図の向きを見て左右を読む ---
    const slots = fischerSlots(mol, centerId);
    if (!slots) return null;
    const slotOf = id => ['up', 'right', 'down', 'left'].find(k => slots[k] === id) || null;
    const refSlot = slotOf(refId);
    if (refSlot !== 'left' && refSlot !== 'right') return null; // 基準が縦＝標準の向きでない

    // 主鎖の C1 側（アミノ酸は -COOH、糖はカルボニルに近いほう）がどちらを向いているか
    let c1Slot = null;
    if (kind === 'amino') {
        const cooh = heavyNbrs(centerId).find(x => isCarboxylC(x.atom.id));
        c1Slot = cooh ? slotOf(cooh.atom.id) : null;
    } else {
        // 基準炭素の隣のうち、鎖の頭（C=O）へ**近づく**ほうが C1 側
        const dist = distFrom(headId);
        const toward = heavyNbrs(centerId).find(n => dist[n.atom.id] === dist[centerId] - 1);
        c1Slot = toward ? slotOf(toward.atom.id) : null;
    }
    if (c1Slot !== 'up' && c1Slot !== 'down') return null; // 主鎖が横向き＝投影として読まない

    // C1 側が下＝180°回した図。同じ分子だが左右も入れ替わっているので読みを裏返す
    const rightIsRef = (refSlot === 'right') === (c1Slot === 'up');
    return {
        letter: rightIsRef ? 'D' : 'L',
        centerId, refId, kind, refName,
        flipped: c1Slot === 'down'
    };
}

function readAtomParityFromFischer(mol) {
    const out = {};
    const ring = _ringAtomIds(mol); // 環中心は環リーダー（Haworth）の担当。相互排他
    // スロット: 0=上, 1=右, 2=下, 3=左（時計回り）
    const AXES = [
        { slot: 0, vx: 0, vy: -1 }, // 上
        { slot: 1, vx: 1, vy: 0 },  // 右
        { slot: 2, vx: 0, vy: 1 },  // 下
        { slot: 3, vx: -1, vy: 0 }  // 左
    ];
    const COS_TOL = Math.cos(25 * Math.PI / 180); // ±25°以内
    mol.atoms.forEach(center => {
        if (center.element !== 'C') return;
        if (ring.has(center.id)) return; // 環中心はスキップ（Haworth が扱う）
        if (!mol.isAsymmetricCarbon(center.id)) return;
        const heavy = mol.getNeighbors(center.id).filter(n => n.atom.element !== 'H');
        const slots = [null, null, null, null]; // [上,右,下,左] → atomId
        let ok = true;
        for (const n of heavy) {
            const dx = n.atom.x - center.x;
            const dy = n.atom.y - center.y;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) { ok = false; break; }
            let assigned = -1;
            for (const ax of AXES) {
                const cos = (dx * ax.vx + dy * ax.vy) / len;
                if (cos >= COS_TOL) { assigned = ax.slot; break; } // 軸は90°間隔ゆえ最大1つ
            }
            if (assigned < 0) { ok = false; break; }          // 軸から外れる → 不適格
            if (slots[assigned] !== null) { ok = false; break; } // スロット衝突 → 不適格
            slots[assigned] = n.atom.id;
        }
        if (!ok) return;
        const emptyCount = slots.filter(s => s === null).length;
        if (emptyCount !== mol.getFreeValency(center.id)) return; // 空き＝暗黙H数と不一致
        const tuple = slots.map(s => (s === null ? 'H' : s));
        const p = computeAtomParity(mol, center.id, tuple);
        if (p === null) return;
        out[center.id] = p;
    });
    return out;
}

/**
 * 図が「フィッシャー投影として描かれている」か（DESIGN_stereo_orientation.md・レビュー項目21）。
 * 読める不斉中心すべてで**主鎖が縦の軸に載っている**ことを要求する。
 *
 * **⚠ 2026-08-08: この関数はもう名前の門番ではない**（`game.js` の `lookupCompoundName` から外した）。
 * ユーザーの仕様確認——「フィッシャー投影による立体異性体の判定は**常に行う**。
 * ユーザーの操作によって、**立体異性体まで区別して表示するかどうかを切り替える**」——により、
 * 立体を出すかどうかは `readStereo` トグルだけで決まる。向きは見ない。
 * 経緯は DESIGN_stereo_orientation.md §4c。**関数は「図が投影として描かれているか」を
 * 知りたい場面のために残してある**（いまの呼び出し元は回帰テスト ST40 だけ）。
 *
 * 以下は門番だった頃の説明（読み取り側に掛けてはいけない理由は今も有効）:
 *
 * **これは名前を付けるときの門番で、立体の読み取りそのものには掛けない。**
 * `readAtomParityFromFischer` 側に入れると立体パズルが壊れる: パズルは3巡回で枝を
 * 動かすので、途中で主鎖が横に来る図がふつうに現れる（実測: タイムアタックの出題15問中
 * 12問が横置きの分子＝アラニン・システイン・リシン等から作られていた）。
 * **「回しても同じ分子」を教えるのがパズルの芯**なので、向きで読めなくなっては成立しない。
 *
 * 名前だけを門番にすれば、ユーザーの求め（「フィッシャーとして内部的に読んで、
 * ユーザーからはわからないようにする」）とちょうど合う。
 *
 * フィッシャーの中心が1つも無い図（環だけ・立体なし）は true（＝制約なし）。
 * ハース投影の環中心はこの関数の担当ではない。
 */
function isFischerOriented(mol) {
    const parities = readAtomParityFromFischer(mol);
    const ids = Object.keys(parities);
    if (!ids.length) return true;
    const isChainC = ref => {
        if (ref === 'H') return false;
        const a = mol.atoms.find(x => x.id === ref);
        return !!a && a.element === 'C';
    };
    return ids.every(id => {
        const s = fischerSlots(mol, id);
        if (!s) return false;
        if (!isChainC(s.up) || !isChainC(s.down)) return false;   // 縦が主鎖でない
        if (isChainC(s.left) && isChainC(s.right)) return false;  // 縦横とも炭素2つ＝主鎖を決められない
        return true;
    });
}

// ===== R/S 判定（CIP。発注書 第4段 4b・DESIGN_rs_descriptor.md） =====
// **2026-08-02 の方針変更**: R/S（CIP の順位付け）はこれまで「やらないこと」だったが、
// 発注書 第4段 4b として「図から R/S を計算する」を追加した。ただし役割は**呼び名だけ**:
// 同値関係（同じ分子か）は今までどおり rootedFragmentCode 基準の canonicalStereoCode で
// 閉じており、ここで作る順位は同型判定・異性体列挙・メソ体の畳み込みに一切影響しない。
// 扱わないもの（断定しない＝null）: 同位体・擬似不斉（CIP Rule 4/5）・環の中の中心
// （ハースの担当）・R（アルキル基の付け根）を含む図・順位が同点のまま尽きる場合。

// CIP 規則1a で使う原子番号。アプリに置ける元素だけ持つ（R は擬似元素なので載せない）
const CIP_ATOMIC_NUMBER = { H: 1, C: 6, N: 7, O: 8, Na: 11, S: 16, Cl: 17, Br: 35, I: 53, K: 19 };

/**
 * CIP 順位づけ用の階層木（hierarchical digraph）を作る（発注書の要件2）。
 * ・多重結合は両端に**複製原子**（子を持たない葉）として展開する
 * ・環の閉じる結合（経路上の先祖へ戻る結合）も複製原子で止める。ケクレ構造の
 *   ベンゼンは書かれた単・二重結合をそのまま使う（CIP の mancude 環の平均化には
 *   踏み込まない。ライブラリでフェニル基を持つ不斉中心はフェニルアラニンだけで、
 *   その順位は環に入る前に決まるため結果には影響しない）
 * ・暗黙の水素は z=1 の葉として加える
 * ・children は優先順位の高い順に並べて返す（球ごとの比較が親の順位に沿って揃うように）
 */
function _cipBranchTree(mol, id, parentId, ancestors, budget) {
    if (++budget.n > 20000) throw new Error('cip-budget'); // 環が多い図で木が膨らんだら諦める
    const atom = mol.atoms.find(a => a.id === id);
    const node = { z: CIP_ATOMIC_NUMBER[atom.element], children: [] };
    const path = new Set(ancestors);
    path.add(id);
    const leaf = z => ({ z, children: [] });
    mol.getNeighbors(id).forEach(n => {
        if (n.atom.element === 'H') { node.children.push(leaf(1)); return; }
        const zn = CIP_ATOMIC_NUMBER[n.atom.element];
        if (n.atom.id === parentId) {
            // 親そのものは木の辺なので数えず、多重結合ぶんだけ複製原子を足す
            for (let i = 1; i < n.type; i++) node.children.push(leaf(zn));
            return;
        }
        if (path.has(n.atom.id)) {
            // 環の閉じ: 先祖へ戻る結合は辿らず、結合次数ぶんの複製原子で止める
            for (let i = 0; i < n.type; i++) node.children.push(leaf(zn));
            return;
        }
        node.children.push(_cipBranchTree(mol, n.atom.id, id, path, budget));
        for (let i = 1; i < n.type; i++) node.children.push(leaf(zn));
    });
    for (let i = 0; i < mol.getFreeValency(id); i++) node.children.push(leaf(1));
    node.children.sort((a, b) => _cipCompare(b, a));
    return node;
}

/**
 * 階層木2本の CIP 比較（規則1a）。a が優先なら +1・劣後なら -1・区別できなければ 0。
 * **球（シェル）ごとに比べてから深くへ進む**のが肝: 対応する節どうしを親の順位順に
 * ペアにし、その球の原子番号列に差があればそこで決める。1本目の枝を掘り切ってから
 * 2本目へ行く素朴な深さ優先は CIP と食い違う——たとえば
 *   -CH(CH₂CH₂OH)(CH₃) と -CH(CH₂CH₂CH₃)(CH₂CH₃) は第3球の4つ目で C と H に分かれ、
 *   そこで後者が勝つ。掘り切る実装だと第1枝の第4球にある O が先に効いて逆になる。
 * ST36 でこの形を固定している。
 * 足りない側は幻原子（z=0）として比べる。
 */
function _cipCompare(a, b) {
    let pairs = [[a, b]];
    while (pairs.length) {
        for (const [pa, pb] of pairs) {
            const za = pa ? pa.z : 0;
            const zb = pb ? pb.z : 0;
            if (za !== zb) return za > zb ? 1 : -1;
        }
        const next = [];
        for (const [pa, pb] of pairs) {
            const ca = pa ? pa.children : [];
            const cb = pb ? pb.children : [];
            const m = Math.max(ca.length, cb.length);
            for (let i = 0; i < m; i++) next.push([ca[i] || null, cb[i] || null]);
        }
        pairs = next;
    }
    return 0;
}

/**
 * 中心 centerId の4置換基を CIP 優先順位の高い順に並べて返す（発注書の要件1〜3）。
 * 戻り値: [ref, ref, ref, ref]（ref は隣接原子の atomId、暗黙の水素は 'H'）。
 * sp3 でない・置換基が4つでない・順位が同点のまま尽きる（＝そもそも不斉でないか
 * 擬似不斉）・R などの順位づけできない擬似元素を含む場合は null（断定しない）。
 * 座標には依存しない純関数（図の読みは assignRSDescriptor 側の仕事）。
 */
function cipRank(mol, centerId) {
    if (!mol.isSp3Carbon(centerId)) return null;
    if (!mol.atoms.every(a => CIP_ATOMIC_NUMBER[a.element])) return null;
    const budget = { n: 0 };
    let items;
    try {
        items = mol.getNeighbors(centerId)
            .filter(n => n.atom.element !== 'H')
            .map(n => ({ ref: n.atom.id,
                         tree: _cipBranchTree(mol, n.atom.id, centerId, new Set([centerId]), budget) }));
    } catch (e) {
        return null; // 木が大きすぎて辿りきれない → 断定しない
    }
    for (let i = 0; i < mol.getFreeValency(centerId); i++) {
        items.push({ ref: 'H', tree: { z: 1, children: [] } });
    }
    if (items.length !== 4) return null;
    items.sort((a, b) => _cipCompare(b.tree, a.tree));
    for (let i = 0; i + 1 < items.length; i++) {
        if (_cipCompare(items[i].tree, items[i + 1].tree) === 0) return null; // 同順位＝断定しない
    }
    return items.map(it => it.ref);
}

/**
 * 図（フィッシャー投影として読める十字）から各不斉中心の R/S を判定する
 * （発注書の要件4。DESIGN_rs_descriptor.md 3章）。
 * フィッシャーの約束「縦=奥・横=手前」で読む: 最下位が縦（奥）なら残り3つの
 * 見た目の回る向きをそのまま（時計回り=R）、横（手前）なら裏返して読む。
 *
 * **主鎖が縦に描かれた図だけを読む**（4a と同じ門番。縦が炭素2つ・横が炭素2つでない）。
 * 十字に見えるだけの図に記号を付けないため: ライブラリの素のアラニン・システイン・
 * フェニルアラニン・酒石酸は -COOH と側鎖を**横**に並べた普通の構造式で、投影の約束
 * （縦=奥）を使うつもりで描かれていない。ここを通すと、立体を指定していない図に
 * 「これは R」と言い出す（システインは L 体が (R) になる有名な例外まであるので、
 * 向きの取り違えは静かに正反対の答えを出す）。180°回した図は同じ記号になり、
 * 90°回した図は縦横が入れ替わるのでこの門番が落とす。
 * 戻り値: { atomId: { letter:'R'|'S', order, lowestSlot, lowestFront } }。
 *   order は cipRank の並び（高→低）、lowestSlot は最下位のスロット、
 *   lowestFront は最下位が手前（横）だったか（解説で「裏返して読んだ」と言うため）。
 * 読めて順位が付く中心が1つも無ければ null。
 */
function assignRSDescriptor(mol) {
    const out = {};
    const SLOT_VEC = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
    mol.atoms.forEach(center => {
        if (center.element !== 'C' || !mol.isAsymmetricCarbon(center.id)) return;
        const slots = fischerSlots(mol, center.id); // 環中心・読めない十字はここで null
        if (!slots) return;
        // 主鎖が縦か（＝フィッシャー投影として描かれた図か）を確かめる
        const isC = ref => ref !== 'H' && mol.atoms.find(a => a.id === ref).element === 'C';
        if (!isC(slots.up) || !isC(slots.down)) return;      // 縦が主鎖でない
        if (isC(slots.left) && isC(slots.right)) return;     // 縦横どちらも炭素2つ＝主鎖を決められない
        const order = cipRank(mol, center.id);
        if (!order) return;
        const slotOf = ref => ['up', 'right', 'down', 'left'].find(k => slots[k] === ref);
        const lowestSlot = slotOf(order[3]);
        const [p1, p2, p3] = order.slice(0, 3).map(r => SLOT_VEC[slotOf(r)]);
        const cross = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
        const lowestFront = lowestSlot === 'left' || lowestSlot === 'right';
        let cw = cross > 0;            // 画面は y が下向きなので、正＝見た目の時計回り
        if (lowestFront) cw = !cw;     // 最下位が手前（横）にある図は読みが裏返る
        out[center.id] = { letter: cw ? 'R' : 'S', order, lowestSlot, lowestFront };
    });
    return Object.keys(out).length ? out : null;
}

/**
 * 立体込みの正準コード（P12-7 M0）。既定の canonicalCode には一切影響しない。
 * stereo = {
 *   atomParity: { atomId: +1|-1 },        // computeAtomParity の値
 *   bondGeo:    { 'id1_id2': 'syn'|'anti' } // キーはID昇順。基準置換基（各端で
 *                // 断片コード最小の重原子置換基）が同じ側なら 'syn'、反対なら 'anti'
 * }
 * 同値関係: 「基礎グラフの同型 φ が存在し、φ で対応する中心・結合の記述子が一致する」
 * ⇔ コード一致。記述子はラベル無依存（断片コード基準）なので、正準ラベリングを
 * 達成する全割当（＝自己同型の軌道）にわたり立体トークン列を最小化すれば正準になる。
 * メソ体は「パリティを入れ替える自己同型」で同一コードに畳まれる。
 * 無効な記述子（不斉でない中心・幾何が定義できない結合）は黙って無視する。
 */
function canonicalStereoCode(mol, stereo) {
    const atomParity = (stereo && stereo.atomParity) || {};
    const bondGeo = (stereo && stereo.bondGeo) || {};

    // 基礎グラフは canonicalCode と同一の構成（重原子・自由価ラベル・芳香族正規化）
    const { heavy, index, labels, adj } = buildHeavyGraph(mol);
    if (heavy.length === 0) return '|';

    // 有効な原子パリティ記述子を重原子indexへ（不斉中心のみ。擬似不斉は M0 対象外）。
    // 原子IDは 'atom_xxx' 形式の文字列なのでキーはそのまま使う
    const parityOf = new Map();
    Object.keys(atomParity).forEach(id => {
        const p = atomParity[id];
        if (!index.has(id) || (p !== 1 && p !== -1)) return;
        if (!mol.isAsymmetricCarbon(id)) return;
        parityOf.set(index.get(id), p);
    });

    // 有効な結合幾何記述子を [重原子index2つ] へ。キーは既存の結合キー慣例
    // 'atomId1_atomId2'（Bond が ID 昇順を保証）。ID自体に '_' を含むため分解はせず、
    // 結合側からキーを構成して照合する。
    // 幾何が定義できる条件: 非環の C=C で、両端に重原子置換基が1個以上あり、
    // 2個ある端はその2つの断片コードが相異なる（基準置換基が一意に決まる）こと。
    const geoEntries = [];
    mol.bonds.forEach(bond => {
        const g = bondGeo[`${bond.atomId1}_${bond.atomId2}`];
        if (g !== 'syn' && g !== 'anti') return;
        if (!_bondGeoRefs(mol, bond)) return; // 適格判定は readBondGeoFromCoords と共通
        geoEntries.push({ i: index.get(bond.atomId1), j: index.get(bond.atomId2), g: g === 'syn' ? 'c' : 't' });
    });

    // 連結成分ごとに正準化（canonicalCode と同じ分割）し、
    // 各成分で「最適割当すべてにわたる立体トークン列の最小」を層として付ける
    const compOf = new Array(heavy.length).fill(-1);
    let compCount = 0;
    for (let s = 0; s < heavy.length; s++) {
        if (compOf[s] >= 0) continue;
        const stack = [s];
        compOf[s] = compCount;
        while (stack.length) {
            const i = stack.pop();
            adj[i].forEach(e => {
                if (compOf[e.j] < 0) {
                    compOf[e.j] = compCount;
                    stack.push(e.j);
                }
            });
        }
        compCount++;
    }
    const compCodes = [];
    for (let cidx = 0; cidx < compCount; cidx++) {
        const nodes = [];
        for (let i = 0; i < heavy.length; i++) {
            if (compOf[i] === cidx) nodes.push(i);
        }
        const local = new Map(nodes.map((gi, li) => [gi, li]));
        const subLabels = nodes.map(gi => labels[gi]);
        const subAdj = nodes.map(gi => adj[gi].map(e => ({ j: local.get(e.j), t: e.t })));
        const placements = [];
        const rows = canonicalRowsCore(nodes.length, subAdj, subLabels, null, placements).join(';');

        let bestLayer = null;
        placements.forEach(pp => {
            const toks = [];
            parityOf.forEach((p, gi) => {
                if (compOf[gi] !== cidx) return;
                toks.push('s' + pp[local.get(gi)] + (p > 0 ? '+' : '-'));
            });
            geoEntries.forEach(e => {
                if (compOf[e.i] !== cidx) return;
                const p1 = pp[local.get(e.i)];
                const p2 = pp[local.get(e.j)];
                toks.push('g' + Math.min(p1, p2) + '-' + Math.max(p1, p2) + e.g);
            });
            const layer = toks.sort().join(',');
            if (bestLayer === null || layer < bestLayer) bestLayer = layer;
        });
        compCodes.push(rows + '|' + (bestLayer || ''));
    }
    compCodes.sort();
    return compCodes.join('/');
}

/**
 * 2つの分子の原子対応を**正準ラベリング（グラフの同型写像）**で決め、対応する
 * 立体記述子（不斉炭素のパリティ・C=C の syn/anti）を中心ごとに比較する
 * （M2.5-A 重ね合わせビューの中核。DOM非依存の純ロジック）。
 * 座標では対応づけない（描き方が違うだけで破綻するため）。
 *
 * 同型写像の全体は「A の正準割当を1つ固定し、B の正準割当（自己同型の個数だけある）を
 * 全列挙して合成する」ことで尽くせる。そのなかで**一致数が最大**になる対応を返すので、
 * 「最もよく重なる対応でも食い違いが残る」＝重ね合わせられない、が正確に言える
 * （同じ分子どうしなら必ず全一致の対応が見つかる。canonicalStereoCode と同じ根拠）。
 *
 * 返り値: { map, centers, geos, matched, total }
 *   map:     { AのatomId: BのatomId }（重原子のみ）
 *   centers: [{ a, b, match }]（両方でパリティが読めた不斉炭素）
 *   geos:    [{ a: [id1,id2], b: [id1,id2], match }]（C=C の syn/anti）
 * つながり方が違う（同型でない）・重原子が非連結・比べる立体が無いときは null。
 */
function stereoIsomorphismCompare(molA, stereoA, molB, stereoB) {
    // 基礎グラフは canonicalCode / canonicalStereoCode と同一の構成
    // （重原子・自由価ラベル・芳香族正規化）。同値関係を揃えるため変えないこと
    const build = (mol) => {
        const { heavy, index, labels, adj } = buildHeavyGraph(mol);
        if (heavy.length === 0) return null;
        // 重ね合わせは1分子どうしの比較にだけ使う（非連結だと成分の対応づけが別問題になる）
        const seen = new Array(heavy.length).fill(false);
        const stack = [0];
        seen[0] = true;
        let cnt = 1;
        while (stack.length) {
            adj[stack.pop()].forEach(e => {
                if (!seen[e.j]) { seen[e.j] = true; cnt++; stack.push(e.j); }
            });
        }
        if (cnt !== heavy.length) return null;
        const placements = [];
        const rows = canonicalRowsCore(heavy.length, adj, labels, null, placements).join(';');
        return { heavy, index, rows, placements };
    };
    const A = build(molA);
    const B = build(molB);
    if (!A || !B || A.rows !== B.rows) return null; // 同型でなければ対応づけできない

    // 有効な記述子を重原子indexへ（適格判定は canonicalStereoCode と共通）
    const parityOf = (mol, stereo, G) => {
        const out = new Map();
        const ap = (stereo && stereo.atomParity) || {};
        Object.keys(ap).forEach(id => {
            const p = ap[id];
            if (!G.index.has(id) || (p !== 1 && p !== -1)) return;
            if (!mol.isAsymmetricCarbon(id)) return;
            out.set(G.index.get(id), p);
        });
        return out;
    };
    const geoOf = (mol, stereo, G) => {
        const out = new Map(); // 'i_j'（index昇順）→ 'syn'|'anti'
        const bg = (stereo && stereo.bondGeo) || {};
        mol.bonds.forEach(bond => {
            const g = bg[`${bond.atomId1}_${bond.atomId2}`];
            if (g !== 'syn' && g !== 'anti') return;
            if (!_bondGeoRefs(mol, bond)) return;
            const i = G.index.get(bond.atomId1);
            const j = G.index.get(bond.atomId2);
            out.set(`${Math.min(i, j)}_${Math.max(i, j)}`, g);
        });
        return out;
    };
    const parA = parityOf(molA, stereoA, A);
    const parB = parityOf(molB, stereoB, B);
    const geoA = geoOf(molA, stereoA, A);
    const geoB = geoOf(molB, stereoB, B);

    // A の割当を1つ固定し、B の全割当と合成する。任意の同型写像 φ に対して
    // pB = pA0∘φ⁻¹ は同じ最小行配列を達成する割当なので必ず placements に現れる
    // ＝この列挙で同型写像を尽くせる（パリティは断片コード基準でラベル無依存なので直接比べられる）
    const pA0 = A.placements[0];
    let best = null;
    B.placements.forEach(pB => {
        const posToB = new Array(pB.length);
        pB.forEach((pos, j) => { posToB[pos] = j; });
        const phi = pA0.map(pos => posToB[pos]); // A頂点i → B頂点
        const centers = [];
        parA.forEach((p, i) => {
            const q = parB.get(phi[i]);
            if (q === undefined) return; // 片方でしか読めない中心は比べない
            centers.push({ a: A.heavy[i].id, b: B.heavy[phi[i]].id, match: p === q });
        });
        const geos = [];
        geoA.forEach((g, key) => {
            const [i, j] = key.split('_').map(Number);
            const bi = phi[i], bj = phi[j];
            const q = geoB.get(`${Math.min(bi, bj)}_${Math.max(bi, bj)}`);
            if (q === undefined) return;
            geos.push({ a: [A.heavy[i].id, A.heavy[j].id], b: [B.heavy[bi].id, B.heavy[bj].id], match: g === q });
        });
        const matched = centers.filter(x => x.match).length + geos.filter(x => x.match).length;
        if (!best || matched > best.matched) {
            const map = {};
            phi.forEach((bj, i) => { map[A.heavy[i].id] = B.heavy[bj].id; });
            best = { map, centers, geos, matched, total: centers.length + geos.length };
        }
    });
    return best && best.total > 0 ? best : null;
}

/**
 * 中心(excludeId)を除いて root から到達できる断片の組成式（自動H込み・Hill表記）を返す。
 * 立体対照ビューの置換基ラベルなどの表示用。
 */
function fragmentFormula(mol, rootId, excludeId) {
    const ids = [rootId];
    const seen = new Set([excludeId, rootId]);
    const stack = [rootId];
    while (stack.length) {
        const id = stack.pop();
        mol.getNeighbors(id).forEach(n => {
            if (n.atom.element === 'H' || seen.has(n.atom.id)) return;
            seen.add(n.atom.id);
            ids.push(n.atom.id);
            stack.push(n.atom.id);
        });
    }
    const counts = {};
    let h = 0;
    ids.forEach(id => {
        const a = mol.atoms.find(at => at.id === id);
        counts[a.element] = (counts[a.element] || 0) + 1;
        h += mol.getFreeValency(id);
    });
    if (h > 0) counts['H'] = (counts['H'] || 0) + h;
    const order = [];
    if (counts['C']) order.push('C');
    if (counts['H']) order.push('H');
    Object.keys(counts).filter(e => e !== 'C' && e !== 'H').sort().forEach(e => order.push(e));
    const sub = (n) => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
    return order.map(e => counts[e] === 1 ? e : e + sub(counts[e])).join('');
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
        } else if (ns.length === 1 && ns[0].atom.element === 'C' && ns[0].type === 1 && mol.getFreeValency(n.id) === 2
                   && !mol.getNeighbors(ns[0].atom.id).some(x => x.atom.element === 'O' && x.type === 2)) {
            // 隣の炭素が C=O を持つ N は**アミド結合の N** であってアミノ基ではない
            // （アセトアミド・尿素は塩基性を示さない）。下のカルボニル系で amide として数える。
            // findFunctionalGroups も同じ条件でアミンから除いている（§9.6-7 の4つの除外の3つめ）
            nh2++;
        }
    });

    // カルボニル系（-COOH / エステル / カルボン酸の塩 / アミド / -CHO / ケトン）。
    // **分岐の順番も条件も findFunctionalGroups とそろえる**（§20.7）。片方だけが知っている型が
    // あると、同じ図の説明が画面ごとに食い違う——実際、この関数だけアミドを知らなかったため、
    // ナイロン66 が「ケトンの C=O ×6」、アセトアミドが「ケトンの C=O ×1 ＋ アミノ基 -NH2 ×1」と出ていた
    let cooh = 0, ester = 0, cho = 0, ketone = 0, amide = 0;
    const saltMetals = new Map(); // 金属元素 → -COO(金属) の本数（Na と K がある）
    const carbonylC = new Set();
    heavy.filter(a => a.element === 'C').forEach(c => {
        const ns = mol.getNeighbors(c.id);
        if (!ns.some(x => x.atom.element === 'O' && x.type === 2)) return;
        carbonylC.add(c.id);
        const sglOs = ns.filter(x => x.atom.element === 'O' && x.type === 1);
        const hasOH = sglOs.some(x => mol.getFreeValency(x.atom.id) >= 1);
        const hasOR = sglOs.some(x => mol.getNeighbors(x.atom.id).filter(y => y.atom.element === 'C').length === 2);
        const salt = sglOs.map(x => mol.getNeighbors(x.atom.id).find(y => y.atom.element === 'Na' || y.atom.element === 'K'))
                          .find(y => y);
        if (hasOH) cooh++;
        else if (hasOR) ester++;
        else if (salt) saltMetals.set(salt.atom.element, (saltMetals.get(salt.atom.element) || 0) + 1);
        else if (ns.some(x => x.atom.element === 'N' && x.type === 1)) amide++;
        else if (mol.getFreeValency(c.id) >= 1) cho++;
        else if (ns.filter(x => x.atom.element === 'C').length === 2) ketone++;
        // ⚠ **ここに落ちる -CO-R・-CO-Cl は何も言わない**（ケトンに寄せてはいけない）。
        //   R の向こうが図から決まらないので型を決められない——ナイロン66 の R は N（アミド）、
        //   PET の R は O（エステル）が続く。以前は else でケトンにまとめていたため、
        //   高分子2件の端1本ずつと塩化アシル3件が「ケトンの C=O」と出ていた（§20.2 と同じ判断）
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
    saltMetals.forEach((n, metal) => points.push(`カルボン酸の塩 -COO${metal} ×${n}`));
    // N が置換されたアミド（N,N-ジメチルホルムアミドなど21件）も含むので -CO-NH- とは書けない
    if (amide) points.push(`アミド結合 -CO-N< ×${amide}`);
    if (cho) points.push(`アルデヒド基 -CHO ×${cho}`);
    if (ketone) points.push(`ケトンの C=O ×${ketone}`);
    if (oh) points.push(`ヒドロキシ基 -OH ×${oh}`);
    if (ether) points.push(`エーテル結合 -O- ×${ether}`);
    if (nh2) points.push(`アミノ基 -NH2 ×${nh2}`);
    if (no2) points.push(`ニトロ基 -NO2 ×${no2}`);

    const cl = heavy.filter(a => a.element === 'Cl').length;
    const br = heavy.filter(a => a.element === 'Br').length;
    const i = heavy.filter(a => a.element === 'I').length;
    const s = heavy.filter(a => a.element === 'S').length;
    if (cl) points.push(`塩素 Cl ×${cl}`);
    if (br) points.push(`臭素 Br ×${br}`);
    if (i) points.push(`ヨウ素 I ×${i}`);
    if (s) points.push('硫黄を含む（スルホ基など）');

    return points;
}

// ===== 異性体練習の系統分類（P12-1 M2）。表示・ヒント専用の純粋関数で、検証には使わない =====

/**
 * 重原子ごとの**同型不変な順位**（同点の炭素鎖候補を「構造だけ」で選び分けるための物差し）。
 *
 * ⚠ **原子IDに順序を頼らない**。IDは `addAtom` が `'atom_' + Math.random().toString(36)` で
 *   作る**文字列**で、同じ化合物でも作り直すたびに変わる（記録「原子IDに順序を頼らない」）。
 *
 * **v1365 以前の壊れ方**: `_cmpCarbonPath` が端点IDを `na[i] - nb[i]` と**引き算**していた。
 *   文字列どうしの引き算は必ず `NaN` で、`NaN < 0` は false ＝ **同点処理は一度も走っていなかった**。
 *   開始点の並べ替え `cIds.slice().sort((a, b) => a - b)` も比較関数が NaN なので無効。
 *   実際に選ばれる鎖は DFS が最初に見つけたもの ＝ **原子の作成順**で決まっていて、
 *   同じ化合物でも compounds.json 由来と `enumerateConstitutionalIsomers` 由来で結果が違った
 *   （2-メチルプロペン ほか）。関数の頭にあった「結果は決定的」は事実ではなかった。
 *
 * **文字列比較に直すだけでは足りない**（別レーンが両方実装して実測した）:
 *   同じ 2-メチルプロペンを30回組み立てて返る最長鎖は、**ID辞書順だと6通り**（毎回サイコロ）。
 *   IDが乱数である以上ID順は構造と無関係で、「同じ化合物なら同じ鎖」には**原理的にならない**。
 *   さらに、`IN2` の凍結16件のうち**14件**は、同点の最長鎖（原子集合で2〜6通り）の
 *   **ちょうど1通りだけ**が `iupacNameDetail().mainChain` と一致していた
 *   ＝ ID順＝乱択にすると **IN2 が実行のたびに赤緑する**（否定対照が否定対照でなくなる）。
 *
 * そこで **WL 精緻化（`wlRefine`）の同型不変なクラス番号**をそのまま順位に使う。
 * 土台のグラフは `buildHeavyGraph` ＝ `canonicalCode` と**同じ関数**なので、
 * ラベル（元素＋自由価標）も芳香族結合の 'a' 正規化も定義上ずれない
 * （ケクレ位相の違いも同じように吸収される）。
 * ★ **ここで WL を書き足さないこと。** 同じ判定が2か所になった瞬間に片方だけ直る日が来る
 *   （`wlRefine` の見出しコメントを読むこと）。
 *
 * **残る同点**は「WL で区別できない原子どうし」。炭素骨格が非環式なら重原子グラフは森で、
 * WL の分割は自己同型の軌道と一致するので、どれを選んでも下流の出力は同じ。
 *
 * 返り値: Map<atomId, number>（水素は含まない）
 */
function _heavyAtomRanks(mol) {
    const { heavy, labels, adj } = buildHeavyGraph(mol);
    if (heavy.length === 0) return new Map();
    const cls = wlRefine(heavy.length, adj, labels);
    // クラス番号 'cN' の N をそのまま順位に使う（署名の辞書順＝同型不変な並び）
    return new Map(heavy.map((a, i) => [a.id, Number(cls[i].slice(1))]));
}

// 経路を**順位列**にして辞書式比較する（両方向の同一経路を同一視し、小さい向きに正規化）。
// 比べるのは原子IDではなく `_heavyAtomRanks` の順位 ＝ 構造だけで決まる整数
function _cmpCarbonPath(a, b, rankOf) {
    if (a.length === 0 || b.length === 0) return a.length - b.length;
    const na = _normCarbonPath(a, rankOf), nb = _normCarbonPath(b, rankOf);
    const m = Math.min(na.length, nb.length);
    for (let i = 0; i < m; i++) {
        const ra = rankOf.get(na[i]), rb = rankOf.get(nb[i]);
        if (ra !== rb) return ra - rb;
    }
    return na.length - nb.length;
}

// 順位列が小さくなる向きに揃えた経路を返す（順位列が回文なら向きは構造では決まらないので元のまま）
function _normCarbonPath(p, rankOf) {
    for (let i = 0, j = p.length - 1; i < j; i++, j--) {
        const ra = rankOf.get(p[i]), rb = rankOf.get(p[j]);
        if (ra !== rb) return ra < rb ? p : p.slice().reverse();
    }
    return p;
}

// 炭素だけの部分グラフでの最長単純パス（＝最長炭素鎖）を原子ID列で返す。
// longestCarbonChain（長さのみ）の経路版。
// 環を含む分子では最長単純パスを返すが、主鎖の概念は環では別扱い
// （呼び出し側で findAnyCycle により環を検出して分岐する）。
//
// **同点は構造だけで決める**（`_heavyAtomRanks` の順位列が最小のもの）。
// ＝ 同じ化合物なら、どう作った分子でも同じ鎖が返る。v1365 以前は原子の作成順で変わっていた
// （事故の詳細は `_heavyAtomRanks` の見出しコメント。否定対照は tests.js の IP10）。
//
// ⚠ **これは IUPAC の主鎖ではない**（-OH・多重結合・置換基数の規則が先に来る）。
//   **名前を出す画面の主鎖・番号に使ってはいけない**。→ `iupacNameDetail`（DESIGN_iupac_check.md）
//   食い違いの実測は **v1365 で測り直した**（同点を構造で決めるようにした副作用）:
//   - 直す前 … 84件中 16件が食い違い、うち14件は炭素数が同じ
//   - 直した後 … DESIGN_iupac_check.md §6 の凍結リストを参照
//   **一致が増えても両者は別物**。食い違いは必ず**原子集合**で見ること
//   （炭素数だけを突き合わせる検査は素通りする）。否定対照は tests.js の IN2。
function findLongestCarbonChain(mol) {
    const cIds = mol.atoms.filter(a => a.element === 'C').map(a => a.id);
    if (cIds.length === 0) return [];
    const cSet = new Set(cIds);
    const adj = new Map(cIds.map(id => [id, []]));
    mol.bonds.forEach(b => {
        if (cSet.has(b.atomId1) && cSet.has(b.atomId2)) {
            adj.get(b.atomId1).push(b.atomId2);
            adj.get(b.atomId2).push(b.atomId1);
        }
    });
    const rankOf = _heavyAtomRanks(mol);
    let best = [];
    const path = [];
    const visited = new Set();
    const dfs = (id) => {
        if (path.length > best.length ||
            (path.length === best.length && _cmpCarbonPath(path, best, rankOf) < 0)) best = path.slice();
        adj.get(id).forEach(n => {
            if (!visited.has(n)) {
                visited.add(n); path.push(n);
                dfs(n);
                path.pop(); visited.delete(n);
            }
        });
    };
    // 始点の順も構造で決める（残る同点は WL で区別できない原子どうし＝どれを選んでも同じ）
    cIds.slice().sort((a, b) => rankOf.get(a) - rankOf.get(b)).forEach(s => {
        visited.clear(); visited.add(s); path.length = 0; path.push(s);
        dfs(s);
    });
    return _normCarbonPath(best, rankOf);
}

// 異性体を系統分類するキー（表示の系統順ソートと、ヒントの系列内訳・書き出し手順に使う）。
//
// ⚠ **表示・ヒント専用で検証には使わない**。とくに `chainLen` は
//   **主鎖長ではなく最長鎖長**（findLongestCarbonChain の長さ）である。
//   IUPAC の主鎖は -OH・多重結合・置換基数の規則が先に来るので別物で、
//   **番号や主鎖の表示に使ってはいけない**。→ `iupacNameDetail`（DESIGN_iupac_check.md §N-3）
//
// ⚠ **`findLongestCarbonChain` の同点の選び方は、ここに効く**（W2 以降は点数にも効く）。
//   同点の鎖をすべて総当たりして測った実測（非環式732件・別レーン）では、
//   **揺れるのは 21件、しかも `locant`（と、それを最後尾に持つ `cmp`）だけ**だった
//   —— `seriesLabel`・`chainLen`・`sideSizes`・`gemPair`・`category` はどの鎖を選んでも同じ。
//   最長鎖が C=C や -OH の炭素を含まないことがあるのが原因（2-メチルプロペンの locant は
//   1 にも 2 にもなる）。環分子は `cyclic` で分岐して最長鎖を呼ばないので無関係。
//   **「locant だけだから軽い」ではない**: v1341（W2）でヒントの段2が `isomerSeriesKey` の
//   系列内訳になり、**押すと減点される**ようになった。同じ問題で見出しと並び順が
//   分子の作り方で変わるのは、点数の付く画面としては通らない。
//   だから v1365 で同点を構造で決めた（`_heavyAtomRanks`）。否定対照は tests.js の IP10。
//
// 返り値: {
//   funcType, funcRank,   官能基カテゴリ（第一ソートキー）
//   cyclic, chainLen,     環の有無・最長炭素鎖長（★IUPAC 主鎖ではない）／環では総炭素数
//   sideSizes, gemPair,   側鎖の炭素数（降順）・同一炭素上のメチル2個か
//   locant,               主特性基／二重結合の位置番号（両方向で最小。無ければ null）
//   seriesLabel,          系列の見出し（位置ずらしを畳んだ粒度。ヒントの内訳に使う）
//   category,             書き出し手順テンプレの種別
//   cmp                   安定ソート用の比較配列
// }
function isomerSeriesKey(mol) {
    const cAtoms = mol.atoms.filter(a => a.element === 'C');
    const cIds = new Set(cAtoms.map(a => a.id));
    const cyclic = !!findAnyCycle(mol);
    const types = new Set(findFunctionalGroups(mol).map(g => g.type));

    let funcType = 'alkane', funcRank = 0;
    if (types.has('alcohol1')) { funcType = 'ol1'; funcRank = 20; }
    else if (types.has('alcohol2')) { funcType = 'ol2'; funcRank = 21; }
    else if (types.has('alcohol3')) { funcType = 'ol3'; funcRank = 22; }
    else if (types.has('alcohol0')) { funcType = 'ol'; funcRank = 23; }
    else if (types.has('ether')) { funcType = 'ether'; funcRank = 30; }
    else if (types.has('cc_triple')) { funcType = 'yne'; funcRank = 12; }
    else if (types.has('cc_double')) { funcType = 'ene'; funcRank = 10; }

    const chain = cyclic ? [] : findLongestCarbonChain(mol);
    const chainLen = cyclic ? cAtoms.length : chain.length;

    // 側鎖（主鎖に乗らない炭素）のサイズと、同一炭素上のメチル2個（gem）判定
    const sideSizes = [];
    let gemPair = false;
    if (!cyclic && chain.length) {
        const mainSet = new Set(chain);
        chain.forEach(cid => {
            const branchRoots = mol.getNeighbors(cid)
                .filter(n => n.atom.element === 'C' && !mainSet.has(n.atom.id))
                .map(n => n.atom.id);
            const branchSizes = branchRoots.map(rootId => {
                // 主鎖に戻らずに辿れる炭素数（側鎖の大きさ）
                const seen = new Set([...mainSet, rootId]);
                let cnt = 1; const st = [rootId];
                while (st.length) {
                    const x = st.pop();
                    mol.getNeighbors(x).forEach(n => {
                        if (n.atom.element === 'C' && !seen.has(n.atom.id)) {
                            seen.add(n.atom.id); cnt++; st.push(n.atom.id);
                        }
                    });
                }
                return cnt;
            });
            branchSizes.forEach(s => sideSizes.push(s));
            if (branchSizes.filter(s => s === 1).length >= 2) gemPair = true;
        });
        sideSizes.sort((a, b) => b - a);
    }

    // 主特性基／二重結合の位置番号を、主鎖の番号付け両方向で最小化して求める
    let locant = null;
    if (!cyclic && chain.length) {
        const n = chain.length;
        const posMaps = [
            new Map(chain.map((id, i) => [id, i + 1])),
            new Map(chain.map((id, i) => [id, n - i]))
        ];
        const locantOf = (posMap) => {
            if (funcType.startsWith('ol')) {
                // -OH のついた主鎖炭素の位置。**いちばん小さい番号**を取る
                // （v1365 以前はここが `for ... return` で、-OH が2つ以上ある分子では
                //   **原子の作成順に最初に見つかったもの**を返していた ＝ グリセリン・
                //   乳酸・グルコースなど、作り直すだけで locant が変わっていた。
                //   下の ene/yne と枝の分岐は最初から Math.min で揃っている）
                let mnOH = Infinity;
                for (const a of cAtoms) {
                    if (!posMap.has(a.id)) continue;
                    const hasOH = mol.getNeighbors(a.id).some(n => n.atom.element === 'O' &&
                        n.type === 1 && mol.getFreeValency(n.atom.id) >= 1 &&
                        mol.getNeighbors(n.atom.id).filter(m => m.atom.element !== 'H').length === 1);
                    if (hasOH) mnOH = Math.min(mnOH, posMap.get(a.id));
                }
                if (mnOH !== Infinity) return mnOH;
            } else if (funcType === 'ene' || funcType === 'yne') {
                const t = funcType === 'ene' ? 2 : 3;
                let mn = Infinity;
                mol.bonds.forEach(b => {
                    if (b.type === t && posMap.has(b.atomId1) && posMap.has(b.atomId2)) {
                        mn = Math.min(mn, posMap.get(b.atomId1), posMap.get(b.atomId2));
                    }
                });
                if (mn !== Infinity) return mn;
            }
            // 官能基がなければ最小の側鎖位置（枝の位置）
            let mn = Infinity;
            chain.forEach(cid => {
                const hasBranch = mol.getNeighbors(cid).some(nn => nn.atom.element === 'C' && !posMap.has(nn.atom.id));
                if (hasBranch) mn = Math.min(mn, posMap.get(cid));
            });
            return mn === Infinity ? null : mn;
        };
        const cand = posMaps.map(locantOf).filter(v => v !== null);
        if (cand.length) locant = Math.min(...cand);
    }

    // 系列の見出し（位置ちがいを畳んだ粒度）
    const funcLabel = { ol1: '第1級アルコール', ol2: '第2級アルコール', ol3: '第3級アルコール',
        ol: 'アルコール', ether: 'エーテル', ene: 'アルケン', yne: 'アルキン', alkane: '' }[funcType] || '';
    let skeleton;
    if (cyclic) {
        skeleton = `環（炭素${chainLen}）`;
    } else if (sideSizes.length === 0) {
        skeleton = `直鎖（主鎖${chainLen}）`;
    } else {
        const parts = [];
        const methyls = sideSizes.filter(s => s === 1).length;
        const ethyls = sideSizes.filter(s => s === 2).length;
        const bigger = sideSizes.filter(s => s >= 3);
        if (methyls === 1) parts.push('メチル基1つ');
        if (methyls >= 2) parts.push(gemPair ? 'メチル基2つ（同じ炭素）' : 'メチル基2つ（別の炭素）');
        if (ethyls) parts.push(`エチル基${ethyls > 1 ? ethyls + 'つ' : '1つ'}`);
        bigger.forEach(s => parts.push(`炭素${s}個の側鎖`));
        skeleton = `主鎖${chainLen}＋${parts.join('・')}`;
    }
    const seriesLabel = funcLabel ? `${skeleton}の${funcLabel}` : skeleton;

    // 書き出し手順テンプレの種別
    let category;
    if (cyclic || funcType === 'ene' || funcType === 'yne') category = 'unsat_ring';
    else if (funcType.startsWith('ol') || funcType === 'ether') category = 'position';
    else if (sideSizes.reduce((s, v) => s + v, 0) === 2) category = 'sidechain2';
    else if (sideSizes.length > 0) category = 'branch';
    else category = 'straight';

    const cmp = [funcRank, -chainLen, -(sideSizes.reduce((s, v) => s + v, 0)),
        gemPair ? 1 : 0, locant == null ? 99 : locant];

    return { funcType, funcRank, cyclic, chainLen, sideSizes, gemPair, locant, seriesLabel, category, cmp };
}

// ===== IUPAC系統名（P12-3 第2弾: 非環式アルカン＋アルキル基名） =====
// 対応範囲は「炭素と水素のみ・単結合のみ・非環式・単一分子」の飽和炭化水素（アルカン）。
// それ以外は null を返し、呼び出し側（lookupCompoundName）はライブラリ照合にフォールバックする。

const IUPAC_ALKANE_STEM = { 1: 'メタ', 2: 'エタ', 3: 'プロパ', 4: 'ブタ', 5: 'ペンタ', 6: 'ヘキサ',
    7: 'ヘプタ', 8: 'オクタ', 9: 'ノナ', 10: 'デカ', 11: 'ウンデカ', 12: 'ドデカ' };
const IUPAC_YL_STEM = { 1: 'メチル', 2: 'エチル', 3: 'プロピル', 4: 'ブチル', 5: 'ペンチル', 6: 'ヘキシル',
    7: 'ヘプチル', 8: 'オクチル', 9: 'ノニル', 10: 'デシル' };
// アルケン（-エン）・アルキン（-イン）の幹（末尾に 'ン' を付けて単一不飽和名にする）。
// 例: ブテ+ン=ブテン、ブチ+ン=ブチン。ジエン等は IUPAC_ALKANE_STEM＋倍数接頭辞＋エン/イン を使う
const IUPAC_ENE_STEM = { 2: 'エテ', 3: 'プロペ', 4: 'ブテ', 5: 'ペンテ', 6: 'ヘキセ', 7: 'ヘプテ', 8: 'オクテ', 9: 'ノネ', 10: 'デセ' };
const IUPAC_YNE_STEM = { 2: 'エチ', 3: 'プロピ', 4: 'ブチ', 5: 'ペンチ', 6: 'ヘキシ', 7: 'ヘプチ', 8: 'オクチ', 9: 'ノニ', 10: 'デシ' };
// 幹の前半＝**数詞**（炭素数）。上の3つの幹の表の「共通の頭」で、残った後半（段）が結合の種類を表す。
//   エタ / エテ / エチ → 数詞 `エ`（炭素2個）＋ 段 `タ`（単）/`テ`（二重）/`チ`（三重）
//   プロパ / プロペ / プロピ → 数詞 `プロ` ＋ 段 `パ`/`ペ`/`ピ`
// ★ **炭素数 `size` から引く表**にしてある。名前を文字数で機械的に割ると
//   `ペンタ`（ペン+タ）と `プロパ`（プロ+パ）で境目の位置が違うので必ず破綻する。
//   割った結果を使うのは表示（game.js の名称の説明）だけで、**名前の作り方には一切関与しない**
//   ＝ `nameParts` は1バイトも変わらない（`IN10` が連結一致を見張り続ける）。
// ⚠ 幹の表を増やしたらここも増やすこと。`SC1` が3つの幹の表と突き合わせて見張る
//   （数詞が前置きになっていない・数詞が無い炭素数があれば赤くなる）。
const IUPAC_NUMERAL = { 1: 'メ', 2: 'エ', 3: 'プロ', 4: 'ブ', 5: 'ペン', 6: 'ヘキ',
    7: 'ヘプ', 8: 'オク', 9: 'ノ', 10: 'デ', 11: 'ウンデ', 12: 'ドデ' };
const IUPAC_MULT = { 1: '', 2: 'ジ', 3: 'トリ', 4: 'テトラ', 5: 'ペンタ', 6: 'ヘキサ', 7: 'ヘプタ', 8: 'オクタ' };
// 体系置換基名 → 慣用（保持）名。分岐アルキル基は高校教科書でおなじみの名で表す
const IUPAC_RETAINED = {
    '1-メチルエチル': 'イソプロピル',
    '2-メチルプロピル': 'イソブチル',
    '1-メチルプロピル': 'sec-ブチル',
    '1,1-ジメチルエチル': 'tert-ブチル',
    '3-メチルブチル': 'イソペンチル',
    '2,2-ジメチルプロピル': 'ネオペンチル'
};
// 置換基のアルファベット順ソートキー（IUPAC: 倍数接頭辞ジ/トリは無視。エチル<メチル）
const IUPAC_SORTKEY = {
    'メチル': 'methyl', 'エチル': 'ethyl', 'プロピル': 'propyl', 'ブチル': 'butyl',
    'ペンチル': 'pentyl', 'ヘキシル': 'hexyl', 'ヘプチル': 'heptyl', 'オクチル': 'octyl',
    'イソプロピル': 'isopropyl', 'イソブチル': 'isobutyl', 'sec-ブチル': 'butyl', 'tert-ブチル': 'butyl',
    'イソペンチル': 'isopentyl', 'ネオペンチル': 'neopentyl',
    'フルオロ': 'fluoro', 'クロロ': 'chloro', 'ブロモ': 'bromo', 'ヨード': 'iodo'
};
// ハロゲン置換基（接頭辞）。ハロゲンは主鎖に入らず、炭素に1本の単結合で付く末端置換基
const IUPAC_HALOGEN = { F: 'フルオロ', Cl: 'クロロ', Br: 'ブロモ', I: 'ヨード' };

// 位置番号セット（昇順配列）の辞書式比較。最初に差が出た番号が小さい方を優先
function _iupacCmpLocants(a, b) {
    const L = Math.min(a.length, b.length);
    for (let i = 0; i < L; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
}

// 木構造（アルカン骨格）における a→b の一意パスを炭素IDの配列で返す
function _iupacPath(adj, a, b) {
    const parent = new Map([[a, null]]);
    const st = [a];
    while (st.length) {
        const x = st.pop();
        if (x === b) break;
        (adj.get(x) || []).forEach(n => { if (!parent.has(n)) { parent.set(n, x); st.push(n); } });
    }
    if (!parent.has(b)) return [];
    const path = [];
    for (let cur = b; cur != null; cur = parent.get(cur)) path.push(cur);
    return path.reverse();
}

// 主鎖 chain の各炭素に付く置換基 subs から名前部品を組む。
// stem = 親アルカン幹（例 ブタン）または yl幹（例 ブチル）。subs=[{loc,name,key}]。
// omitLocants=true のときは位置番号を省く（メタン誘導体など位置が一意で曖昧さが無い場合）
//
// ★ `out` を渡すと「名称の説明」用の**部品の列**を `out.parts` に置く
//   （DESIGN_iupac_check.md §3 の名称の説明）。**部品は名前を組み立て直したものではない** ——
//   ここで連結している当のかけらをそのまま並べるので、`parts.map(p=>p.text).join('')` は
//   返り値の文字列と**常に1バイト単位で一致する**（IN10 が見張る）。
//   別関数で名前を割り直す実装にすると「名前を作る場所が2つ」になり、片方だけ伸びた日に
//   説明と名前が黙って食い違う（§N-1 と同じ家族の罠）。
//   `out.coreParts` = 幹側のかけら（呼び出し元＝ `_iupacOlCore` / `_iupacUnsatCore` が組む）。
//
// ★ **複合置換基（置換基そのものが置換されているもの）は括弧で囲む**
//   （DESIGN_iupac_check.md §11。`2-(クロロメチル)プロパン`）。`subs[i].composite` が真のときだけ。
//   囲まないと基の中の位置番号が主鎖の位置番号と地続きになり、`2-1-クロロメチルプロパン` のように
//   **どちらの番号か読めない文字列**になる。囲むかどうかは名前を作るこの1か所だけが決める。
//   ⚠ 同じ複合置換基が2つ以上あるときは **ビス／トリス** が要る（`ジ(クロロメチル)` は誤り）ので、
//   **名前を返さない（null）**。壊れた名前を返さないのがこのリポジトリの流儀。
function _iupacAssemble(stem, subs, omitLocants, out) {
    if (!stem) return null;
    const byName = new Map();
    subs.forEach(s => {
        if (!byName.has(s.name)) byName.set(s.name, { key: s.key, locs: [], composite: !!s.composite });
        byName.get(s.name).locs.push(s.loc);
    });
    const groups = [...byName.entries()].map(([name, g]) => ({ name, key: g.key, locs: g.locs.slice().sort((a, b) => a - b), composite: g.composite }));
    // 同じ複合置換基が複数 ＝ ビス／トリスが要る（範囲外。§11-2）
    if (groups.some(g => g.composite && g.locs.length >= 2)) return null;
    // アルファベット順（倍数接頭辞は無視＝name基準のkeyで比較）
    groups.sort((a, b) => a.key.localeCompare(b.key) || a.name.localeCompare(b.name));
    const bodies = groups.map(g => {
        const body = (IUPAC_MULT[g.locs.length] || '') + (g.composite ? `(${g.name})` : g.name);
        return omitLocants ? body : `${g.locs.join(',')}-${body}`;
    });
    const glue = omitLocants ? '' : '-';
    const part = bodies.join(glue);
    // 幹が位置番号（数字）で始まる場合（例: 2-ブテン）は、置換基部との間にハイフンを入れる
    const sep = (part && /^\d/.test(stem)) ? '-' : '';
    if (out) {
        // 置換基のかけら。2つ目からは**つなぎのハイフンを頭に付けて**持つ（欠けたら連結が崩れる）
        const ps = bodies.map((t, i) => ({
            text: (i === 0 ? '' : glue) + t, role: 'sub',
            locs: groups[i].locs.slice(), label: groups[i].name
        }));
        const core = (out.coreParts && out.coreParts.length ? out.coreParts : [{ text: stem, role: 'stem' }])
            .map(p => Object.assign({}, p));
        // 置換基部との間のハイフンは**幹側の先頭のかけら**が持つ（`-1-` の形になる）
        if (sep) core[0] = Object.assign({}, core[0], { text: sep + core[0].text });
        out.parts = ps.concat(core);
    }
    return part + sep + stem;
}

// 炭素ペアのキー（結合次数の参照用）
function _iupacCKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

// 不飽和の接尾辞つき幹を作る。eneLocs/yneLocs=昇順の位置番号配列、n=主鎖炭素数。
// 例: (4,[2],[]) → "2-ブテン"、(3,[1],[]) → "プロペン"（位置省略）、(4,[1,3],[]) → "1,3-ブタジエン"、
// (4,[],[2]) → "2-ブチン"。エン・イン混在（エンイン）は未対応で null
// out（配列）を渡すと、返す文字列を作った**かけら**をそのまま push する（`_iupacAssemble` 参照）。
// かけらの text を順に連結したものが返り値と一致する ＝ 名前を割り直す実装にはしない
function _iupacUnsatCore(n, eneLocs, yneLocs, out) {
    const e = eneLocs.length, y = yneLocs.length;
    const push = (text, role, extra) => { if (out) out.push(Object.assign({ text, role }, extra || {})); };
    if (e === 0 && y === 0) {
        if (!IUPAC_ALKANE_STEM[n]) return null;
        push(IUPAC_ALKANE_STEM[n], 'stem', { size: n });
        push('ン', 'sat');
        return IUPAC_ALKANE_STEM[n] + 'ン';
    }
    const omit = (e + y === 1) && n <= 3; // 二重/三重結合の位置が一意なら省略（エテン・プロペン・エチン・プロピン）
    if (y === 0) {
        if (e === 1) {
            const s = IUPAC_ENE_STEM[n];
            if (!s) return null;
            if (!omit) push(eneLocs[0] + '-', 'locant', { kind: 'ene', locs: eneLocs.slice() });
            push(s, 'stem', { size: n });
            push('ン', 'suffix', { kind: 'ene', locs: eneLocs.slice() });
            return (omit ? '' : eneLocs[0] + '-') + s + 'ン';
        }
        if (!IUPAC_ALKANE_STEM[n]) return null;
        push(eneLocs.join(',') + '-', 'locant', { kind: 'ene', locs: eneLocs.slice() });
        push(IUPAC_ALKANE_STEM[n], 'stem', { size: n });
        push((IUPAC_MULT[e] || '') + 'エン', 'suffix', { kind: 'ene', locs: eneLocs.slice() });
        return eneLocs.join(',') + '-' + IUPAC_ALKANE_STEM[n] + (IUPAC_MULT[e] || '') + 'エン';
    }
    if (e === 0) {
        if (y === 1) {
            const s = IUPAC_YNE_STEM[n];
            if (!s) return null;
            if (!omit) push(yneLocs[0] + '-', 'locant', { kind: 'yne', locs: yneLocs.slice() });
            push(s, 'stem', { size: n });
            push('ン', 'suffix', { kind: 'yne', locs: yneLocs.slice() });
            return (omit ? '' : yneLocs[0] + '-') + s + 'ン';
        }
        if (!IUPAC_ALKANE_STEM[n]) return null;
        push(yneLocs.join(',') + '-', 'locant', { kind: 'yne', locs: yneLocs.slice() });
        push(IUPAC_ALKANE_STEM[n], 'stem', { size: n });
        push((IUPAC_MULT[y] || '') + 'イン', 'suffix', { kind: 'yne', locs: yneLocs.slice() });
        return yneLocs.join(',') + '-' + IUPAC_ALKANE_STEM[n] + (IUPAC_MULT[y] || '') + 'イン';
    }
    return null; // エンイン混在は未対応
}

const _iupacSortNum = arr => arr.slice().sort((a, b) => a - b);

// アルコール（-オール）の接尾辞つき幹。olLocs=昇順のOH位置番号、eneLocs/yneLocs=不飽和の位置番号。
// 例: (2,[1])→"エタノール"（省略）、(3,[1])→"1-プロパノール"、(2,[1,2])→"1,2-エタンジオール"、
//     (3,[1],[2])→"2-プロペン-1-オール"、(3,[1],[],[2])→"2-プロピン-1-オール"、
//     (4,[1,4],[2])→"2-ブテン-1,4-ジオール"
// 不飽和アルコールは v625 で対応（DESIGN_compound_coverage.md §9.6-3）。
// **不飽和のときは -オール の位置番号を省略しない**（2-プロペン-1-オール の「1」が要る）
// out（配列）については `_iupacUnsatCore` と同じ（返す文字列を作ったかけらをそのまま push する）
function _iupacOlCore(n, olLocs, eneLocs = [], yneLocs = [], out) {
    const k = olLocs.length;
    const stem = IUPAC_ALKANE_STEM[n];
    if (!k || !stem) return null;
    const e = eneLocs.length, y = yneLocs.length;
    if (e && y) return null;   // エンイン混在は未対応（_iupacUnsatCore と同じ線引き）
    const push = (text, role, extra) => { if (out) out.push(Object.assign({ text, role }, extra || {})); };
    const olTail = { kind: 'ol', locs: olLocs.slice() };
    if (!e && !y) {
        if (k === 1) {
            const omit = n <= 2; // メタノール・エタノールは位置が一意なので省略
            if (!omit) push(olLocs[0] + '-', 'locant', olTail);
            push(stem, 'stem', { size: n });
            push('ノール', 'suffix', olTail);
            return (omit ? '' : olLocs[0] + '-') + stem + 'ノール';
        }
        push(olLocs.join(',') + '-', 'locant', olTail);
        push(stem + 'ン', 'stem', { size: n });
        push((IUPAC_MULT[k] || '') + 'オール', 'suffix', olTail);
        return olLocs.join(',') + '-' + stem + 'ン' + (IUPAC_MULT[k] || '') + 'オール';
    }
    let unsat;
    if (y === 0) {
        if (e === 1) {
            if (!IUPAC_ENE_STEM[n]) return null;
            unsat = eneLocs[0] + '-' + IUPAC_ENE_STEM[n] + 'ン';
            push(eneLocs[0] + '-', 'locant', { kind: 'ene', locs: eneLocs.slice() });
            push(IUPAC_ENE_STEM[n], 'stem', { size: n });
            push('ン', 'suffix', { kind: 'ene', locs: eneLocs.slice() });
        } else {
            unsat = eneLocs.join(',') + '-' + stem + (IUPAC_MULT[e] || '') + 'エン';
            push(eneLocs.join(',') + '-', 'locant', { kind: 'ene', locs: eneLocs.slice() });
            push(stem, 'stem', { size: n });
            push((IUPAC_MULT[e] || '') + 'エン', 'suffix', { kind: 'ene', locs: eneLocs.slice() });
        }
    } else {
        if (y === 1) {
            if (!IUPAC_YNE_STEM[n]) return null;
            unsat = yneLocs[0] + '-' + IUPAC_YNE_STEM[n] + 'ン';
            push(yneLocs[0] + '-', 'locant', { kind: 'yne', locs: yneLocs.slice() });
            push(IUPAC_YNE_STEM[n], 'stem', { size: n });
            push('ン', 'suffix', { kind: 'yne', locs: yneLocs.slice() });
        } else {
            unsat = yneLocs.join(',') + '-' + stem + (IUPAC_MULT[y] || '') + 'イン';
            push(yneLocs.join(',') + '-', 'locant', { kind: 'yne', locs: yneLocs.slice() });
            push(stem, 'stem', { size: n });
            push((IUPAC_MULT[y] || '') + 'イン', 'suffix', { kind: 'yne', locs: yneLocs.slice() });
        }
    }
    push('-' + olLocs.join(',') + '-', 'locant', olTail);
    push((IUPAC_MULT[k] || '') + 'オール', 'suffix', olTail);
    return unsat + '-' + olLocs.join(',') + '-' + (IUPAC_MULT[k] || '') + 'オール';
}

// chain（番号順の炭素配列）の各炭素に付く全置換基を {loc,name,key}[] で返す。
// 置換基＝主鎖に乗らない炭素枝（アルキル基・再帰命名）と、炭素に付いたハロゲン。命名不能なら null。
// haloAdj は炭素→付いたハロゲン置換基名の配列（whole-molから事前計算）
function _iupacCollectSubs(adj, haloAdj, chain) {
    const chainSet = new Set(chain);
    const subs = [];
    for (let idx = 0; idx < chain.length; idx++) {
        const cid = chain[idx];
        for (const nb of (adj.get(cid) || [])) {
            if (chainSet.has(nb)) continue;
            const g = iupacAlkylName(adj, haloAdj, nb, chainSet);
            if (!g) return null;
            // composite = この基そのものが置換されている ＝ 名前に括弧が要る（§11）
            subs.push({ loc: idx + 1, name: g.name, key: g.key, composite: g.composite });
        }
        (haloAdj.get(cid) || []).forEach(h => subs.push({ loc: idx + 1, name: h, key: IUPAC_SORTKEY[h] }));
    }
    return subs;
}

// アルキル基（置換基）の命名。adj=炭素隣接Map、haloAdj=炭素→ハロゲン名配列、
// root=付け根（この基のC1）、blocked=辿ってはいけない炭素集合（親側）。
// 返り値 {name, key, chain, ids} または null。分岐・ハロゲンを再帰処理し、慣用名があれば置き換える。
//
// `chain` = **この名前を作るのに実際に使った鎖**（root から始まる炭素ID列。番号 k の炭素 = chain[k-1]）。
// `ids`   = この基に属する炭素の全ID（塗り分け用）。
// `composite` = **この基そのものが置換されている**（＝ 親の名前で括弧が要る。§11）。
//   慣用名（イソプロピル・sec-ブチル…）に置き換わったものは1語なので **false**。
// ★ 鎖を返すのは、画面が主鎖を描くときに**同じ1回の計算の結果**を使えるようにするため
//   （DESIGN_iupac_check.md §4）。呼ぶ側で最長鎖を計算し直すと名前と食い違う。
//   `_iupacPath(subAdj, root, t)` が root 始まりなので **付け根は必ず C1**＝向きを選ぶ余地が無い
//
// ⚠ **入れ子（複合置換基の中の複合置換基）は扱わない**（§11-2）。角括弧 `[…]` が要るうえ、
//   どちらの候補を IUPAC が採るかは両方に名前を付けてみないと決まらない。
//   候補のどれか1本でも入れ子になるなら **null**（＝ 名前を出さない）。
function iupacAlkylName(adj, haloAdj, root, blocked) {
    const carbons = new Set([root]);
    const st = [root];
    while (st.length) {
        const x = st.pop();
        (adj.get(x) || []).forEach(nb => { if (!blocked.has(nb) && !carbons.has(nb)) { carbons.add(nb); st.push(nb); } });
    }
    const subAdj = new Map([...carbons].map(id => [id, (adj.get(id) || []).filter(nb => carbons.has(nb))]));
    // root から始まる最長鎖候補（root は必ず C1）
    const leaves = [...carbons].filter(id => subAdj.get(id).length <= 1);
    let cands = [];
    (leaves.length ? leaves : [root]).forEach(t => {
        const p = _iupacPath(subAdj, root, t);
        if (!p.length) return;
        if (!cands.length || p.length > cands[0].length) cands = [p];
        else if (p.length === cands[0].length) cands.push(p);
    });
    let best = null, nested = false;
    cands.forEach(chain => {
        if (!IUPAC_YL_STEM[chain.length]) return;
        const subs = _iupacCollectSubs(subAdj, haloAdj, chain);
        if (subs === null) return;
        if (subs.some(s => s.composite)) { nested = true; return; }   // 入れ子は扱わない（§11-2）
        // 炭素1個の基（メチル）は位置が1しかないので位置番号を書かない ＝ `クロロメチル`
        const nm = _iupacAssemble(IUPAC_YL_STEM[chain.length], subs, chain.length === 1);
        if (!nm) return;
        const locs = subs.map(s => s.loc).sort((a, b) => a - b);
        if (!best || _iupacCmpLocants(locs, best.locs) < 0 ||
            (_iupacCmpLocants(locs, best.locs) === 0 && nm.localeCompare(best.nm) < 0)) best = { nm, locs, chain, subs };
    });
    // 入れ子の候補が1本でもあれば、名前を付けられる候補が残っていても**どちらを IUPAC が採るか決められない**
    if (nested || !best) return null;
    const name = IUPAC_RETAINED[best.nm] || best.nm;
    // 複合＝ 置換基つきで組み立てた体系名が、慣用名に置き換わらずそのまま出ているとき
    const composite = (name === best.nm) && best.subs.length > 0;
    // アルファベット順のキー。複合置換基は **完全な名前の頭文字**で並べるのが IUPAC の規則なので、
    // 「基の中の置換基のキー（昇順）＋ yl 幹のキー」を繋いで作る（クロロメチル → chloro+methyl）
    const key = IUPAC_SORTKEY[name] || IUPAC_SORTKEY[best.nm] ||
        (composite ? best.subs.map(s => s.key || s.name).sort().join('') + (IUPAC_SORTKEY[IUPAC_YL_STEM[best.chain.length]] || '') : name);
    // 慣用名（sec-ブチル 等）に置き換わっても、**鎖と番号は体系名の側のもの**を返す
    // （「sec-ブチル」に番号は無い。§4・N-6 の「番号を生んだ名前を併記する」規則）
    return { name, key, chain: best.chain, ids: [...carbons], systematic: best.nm, composite };
}

// 炭素→その炭素に付いたハロゲン置換基名の配列 を分子から作る
function _iupacHaloAdj(mol, carbonIds) {
    const cset = new Set(carbonIds);
    const halo = new Map(carbonIds.map(id => [id, []]));
    mol.atoms.forEach(a => {
        const hn = IUPAC_HALOGEN[a.element];
        if (!hn) return;
        const cNb = mol.getNeighbors(a.id).filter(n => cset.has(n.atom.id));
        cNb.forEach(n => halo.get(n.atom.id).push(hn));
    });
    return halo;
}

// 分子を非環式アルキル基として命名し、**その名前を作るのに使った鎖**も返す
// （root を付け根＝C1 とみなす）。アルキル基の書き出し練習・命名の確認（DESIGN_iupac_check.md §4）用。
// 付け根マーカー R は無視する（H と同様に炭素骨格には含めない）。
// 返り値 null | { name, mainChain, rootId, ids, systematic }。付け根 = mainChain[0] = C1
function iupacAlkylGroupDetail(mol, rootId) {
    const cs = mol.atoms.filter(a => a.element === 'C');
    if (!cs.length || mol.bonds.some(b => b.type !== 1)) return null;
    if (mol.atoms.some(a => a.element !== 'C' && a.element !== 'H' && a.element !== 'R' && !IUPAC_HALOGEN[a.element])) return null;
    const adj = new Map(cs.map(a => [a.id, []]));
    mol.bonds.forEach(b => { if (adj.has(b.atomId1) && adj.has(b.atomId2)) { adj.get(b.atomId1).push(b.atomId2); adj.get(b.atomId2).push(b.atomId1); } });
    if (!adj.has(rootId)) return null;
    const r = iupacAlkylName(adj, _iupacHaloAdj(mol, cs.map(a => a.id)), rootId, new Set());
    return r ? { name: r.name, mainChain: r.chain, rootId, ids: r.ids, systematic: r.systematic } : null;
}

// 上の薄い包み（名前だけ要る呼び出し元のため。**規則を足すならこちらではなく詳細版へ**）
function iupacAlkylGroupName(mol, rootId) {
    const d = iupacAlkylGroupDetail(mol, rootId);
    return d ? d.name : null;
}

// 付け根マーカー R が付いた分子をアルキル基として命名し、鎖も返す
// （R に結合した炭素を C1 とみなす）。返り値 null | { name, mainChain, rootId, ids, systematic }
function iupacAlkylDetailFromR(mol) {
    const rAtoms = mol.atoms.filter(a => a.element === 'R');
    if (rAtoms.length !== 1) return null;
    const cNb = mol.getNeighbors(rAtoms[0].id).filter(n => n.atom.element === 'C');
    if (cNb.length !== 1) return null;
    return iupacAlkylGroupDetail(mol, cNb[0].atom.id);
}

// 上の薄い包み
function iupacAlkylNameFromR(mol) {
    const d = iupacAlkylDetailFromR(mol);
    return d ? d.name : null;
}

// エーテル R-O-R' を慣用名「ジアルキルエーテル／アルキルアルキルエーテル」で命名する（高校の流儀）。
// oId=エーテルの酸素。両側のアルキル基が命名できなければ null。
// 返り値 null | { name, groups: [{ids, rootId, name, mainChain}, …]（2つ・名前に出る順） }。
// ★ エーテルは主鎖に番号をつけない（規則そのもので、未対応ではない。DESIGN_iupac_check.md §N-5）
function _iupacEtherDetail(adj, haloAdj, mol, oId) {
    const cNb = mol.getNeighbors(oId).filter(n => n.atom.element === 'C');
    if (cNb.length !== 2) return null;
    const r1 = cNb[0].atom.id, r2 = cNb[1].atom.id;
    const g1 = iupacAlkylName(adj, haloAdj, r1, new Set());
    const g2 = iupacAlkylName(adj, haloAdj, r2, new Set());
    if (!g1 || !g2) return null;
    const grp = (g, rootId) => ({ ids: g.ids, rootId, name: g.name, mainChain: g.chain });
    // 名称の説明用のかけら（`_iupacAssemble` と同じ約束＝ text を順に連結すると name と一致する）。
    // 両側が同じ基のときは「ジ＋基名」で1つのかけら ＝ 押すと**両方の基**が光る（groups:[0,1]）
    if (g1.name === g2.name) return {
        name: 'ジ' + g1.name + 'エーテル', groups: [grp(g1, r1), grp(g2, r2)],
        parts: [{ text: 'ジ' + g1.name, role: 'ether-group', groups: [0, 1], label: g1.name },
                { text: 'エーテル', role: 'ether-suffix' }]
    };
    const [a, b] = g1.key.localeCompare(g2.key) <= 0 ? [[g1, r1], [g2, r2]] : [[g2, r2], [g1, r1]];
    return {
        name: a[0].name + b[0].name + 'エーテル', groups: [grp(a[0], a[1]), grp(b[0], b[1])],
        parts: [{ text: a[0].name, role: 'ether-group', groups: [0], label: a[0].name },
                { text: b[0].name, role: 'ether-group', groups: [1], label: b[0].name },
                { text: 'エーテル', role: 'ether-suffix' }]
    };
}

/**
 * 非環式の炭化水素（アルカン・アルケン・アルキン）・ハロゲン化物・アルコール・エーテルの
 * IUPAC 系統名と、**その名前を作るのに実際に使った主鎖・番号の向き**。対応外は null。
 *
 * ★ `iupacName` はこの関数の薄い包み。名前と主鎖は必ず**同じ1回の計算**から出る
 *   （DESIGN_iupac_check.md §N-1）。「最長の炭素鎖」は IUPAC の主鎖ではないので、
 *   画面が `findLongestCarbonChain` で計算し直すと**名前と黙って食い違う**
 *   （実測 84件中 16件・うち14件は炭素数が同じ）。同点の主鎖候補もある（31件）ので、
 *   **後から計算し直す設計は原理的に成立しない**。
 *
 * 返り値 {
 *   name,       // 従来 iupacName が返していた文字列と 1バイトも変わらない
 *   kind,       // 'chain' | 'ether'
 *   mainChain,  // 番号順の炭素ID配列。番号 k の炭素 = mainChain[k-1]。kind==='ether' では null
 *   groups,     // kind==='ether' のときだけ [{ids, rootId, name, mainChain}, …]（2つ）。他は null
 *   locants,    // { ol, ene, yne, subs:[{loc,key,name}] } 説明文用。kind==='ether' では null
 *   nameParts,  // ★ 名称の説明用の**かけらの列**（下記）
 *   dirReason   // ★ 番号の向きを決めた比較（'ol'|'unsat'|'ene'|'sub'|'alpha'|'tie'）。ether は null
 * }
 *
 * ★ `nameParts` = `[{ text, role, ... }]`。**名前を割り直したものではない** ——
 *   `name` を組み立てるときに連結した当のかけらをそのまま並べたもので、
 *   `nameParts.map(p => p.text).join('')` は `name` と**常に1バイト単位で一致する**（IN10）。
 *   role と付随する値（画面はこれだけを見て光らせる原子を決める。IN11）:
 *     'sub'          … 置換基（`2-メチル`）。`locs` ＝ 位置番号の配列・`label` ＝ 基の名前
 *     'locant'       … 位置番号（`-1-`）。`kind` ＝ 'ol'|'ene'|'yne'・`locs`
 *     'stem'         … 幹（`プロパ`）。`size` ＝ 主鎖の炭素数
 *     'suffix'       … 接尾辞（`ノール`）。`kind`・`locs` は locant と同じ意味
 *     'sat'          … 飽和の印（アルカンの `ン`）
 *     'ether-group'  … エーテルの基。`groups` ＝ `groups[]` の添字の配列
 *     'ether-suffix' … `エーテル`
 *
 * 使う側の禁止事項:
 *   ・`mainChain` は**そのまま添字で番号にする**。並べ替えない・逆にしない・最小化し直さない
 *   ・`findLongestCarbonChain` / `isomerSeriesKey().chainLen` を番号や主鎖の表示に使わない
 *   ・**この関数が null を返したものには、主鎖も番号も描かない**（門番 §N-4）
 *   ・**説明のために名前を作り直さない。**部品は `nameParts` を使う（IN10 が見張る）
 */
function iupacNameDetail(mol) {
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    if (!heavy.length) return null;
    if (heavy.some(a => a.element !== 'C' && a.element !== 'O' && !IUPAC_HALOGEN[a.element])) return null; // C/O/ハロゲンのみ
    const carbons = heavy.filter(a => a.element === 'C');
    if (!carbons.length) return null;
    const carbonIds = new Set(carbons.map(a => a.id));
    // 多重結合は炭素間のみ
    if (mol.bonds.some(b => b.type >= 2 && (!carbonIds.has(b.atomId1) || !carbonIds.has(b.atomId2)))) return null;
    // ハロゲンは炭素1個にだけ単結合で付く末端置換基
    for (const a of heavy) {
        if (!IUPAC_HALOGEN[a.element]) continue;
        const nb = mol.getNeighbors(a.id);
        if (nb.length !== 1 || nb[0].atom.element !== 'C') return null;
    }
    // 酸素の分類: -OH（炭素1個・単結合）か エーテル（炭素2個・単結合）。それ以外（C=O・ペルオキシド等）は未対応
    const oxygens = heavy.filter(a => a.element === 'O');
    const hydroxylC = [];
    let etherCount = 0;
    for (const o of oxygens) {
        if (mol.bonds.some(b => (b.atomId1 === o.id || b.atomId2 === o.id) && b.type !== 1)) return null;
        const cNb = mol.getNeighbors(o.id).filter(n => n.atom.element === 'C');
        const allNb = mol.getNeighbors(o.id);
        if (allNb.length === 1 && cNb.length === 1) hydroxylC.push(cNb[0].atom.id);
        else if (allNb.length === 2 && cNb.length === 2) etherCount++;
        else return null;
    }
    const hasMultiple = mol.bonds.some(b => b.type >= 2 && carbonIds.has(b.atomId1) && carbonIds.has(b.atomId2));
    // 不飽和アルコール（アリルアルコール・プロパルギルアルコール等）は v625 で対応した
    // （DESIGN_compound_coverage.md §9.6-3）。ただし次の2つは今も未対応:
    //   ・不飽和エーテル（メチルビニルエーテル）… 慣用名の流儀なので「ビニル」「アリル」という
    //     **アルケニル基の名前**が要る。iupacAlkylName は結合次数を見ないので流用できない
    //     （DEVELOPMENT.md の申し送り）
    //   ・エノール形 C=C-OH … findOutOfScopeMotifs が「ケト形に変わる」として範囲外にしている
    //     形なので、名前を付けると分類と食い違う
    if (etherCount && hasMultiple) return null;
    if (hasMultiple) {
        const multipleC = new Set();
        mol.bonds.forEach(b => {
            if (b.type < 2 || !carbonIds.has(b.atomId1) || !carbonIds.has(b.atomId2)) return;
            multipleC.add(b.atomId1); multipleC.add(b.atomId2);
        });
        if (hydroxylC.some(id => multipleC.has(id))) return null;   // エノール形
    }
    if (hydroxylC.length && etherCount) return null;     // OHとエーテルの併存は未対応
    if (etherCount > 1) return null;                     // 複数エーテルは未対応
    // 同一炭素に複数OH（ゲミナルジオール等）は未対応
    if (new Set(hydroxylC).size !== hydroxylC.length) return null;

    // 環（炭素環・芳香環・エポキシド等）は未対応
    if (findAnyCycle(mol)) return null;
    const adj = new Map(carbons.map(a => [a.id, []]));
    const cbond = new Map();
    mol.bonds.forEach(b => {
        if (!carbonIds.has(b.atomId1) || !carbonIds.has(b.atomId2)) return;
        adj.get(b.atomId1).push(b.atomId2); adj.get(b.atomId2).push(b.atomId1);
        cbond.set(_iupacCKey(b.atomId1, b.atomId2), b.type);
    });
    const haloAdj = _iupacHaloAdj(mol, carbons.map(a => a.id));

    // エーテルは慣用名で（炭素は O をはさんで2成分に分かれるので連結性は要求しない）
    if (etherCount === 1) {
        const e = _iupacEtherDetail(adj, haloAdj, mol, oxygens.find(o => mol.getNeighbors(o.id).filter(n => n.atom.element === 'C').length === 2).id);
        return e ? { name: e.name, kind: 'ether', mainChain: null, groups: e.groups, locants: null,
            nameParts: e.parts, dirReason: null } : null;
    }

    // 非エーテル: 炭素が1つの連結成分であること
    const seen = new Set([carbons[0].id]);
    const q = [carbons[0].id];
    while (q.length) { const x = q.shift(); adj.get(x).forEach(n => { if (!seen.has(n)) { seen.add(n); q.push(n); } }); }
    if (seen.size !== carbons.length) return null;

    const ohSet = new Set(hydroxylC);
    const totalMult = [...cbond.values()].filter(t => t >= 2).length;

    // 主鎖候補: 主特性基(-OH)を最も多く含む → 多重結合を最も多く含む → 最長 の炭素鎖
    const ohIn = path => path.filter(c => ohSet.has(c)).length;
    const multIn = path => { let c = 0; for (let k = 0; k + 1 < path.length; k++) if ((cbond.get(_iupacCKey(path[k], path[k + 1])) || 1) >= 2) c++; return c; };
    let cands;
    if (carbons.length === 1) {
        cands = [[carbons[0].id]];
    } else {
        const leaves = carbons.filter(a => adj.get(a.id).length <= 1).map(a => a.id);
        const paths = [];
        for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) paths.push(_iupacPath(adj, leaves[i], leaves[j]));
        if (!paths.length) return null;
        const bestOh = Math.max(...paths.map(ohIn));
        if (bestOh < ohSet.size) return null;            // 全OHを1本の鎖に収められない（分岐ポリオール・未対応）
        let pool = paths.filter(p => ohIn(p) === bestOh);
        const bestMult = Math.max(...pool.map(multIn));
        if (bestMult < totalMult) return null;
        pool = pool.filter(p => multIn(p) === bestMult);
        const bestLen = Math.max(...pool.map(p => p.length));
        cands = pool.filter(p => p.length === bestLen);
    }
    if (!IUPAC_ALKANE_STEM[cands[0].length]) return null;

    const named = cands.map(chain => _iupacNameForMainChain(adj, haloAdj, cbond, chain, ohSet)).filter(Boolean);
    if (!named.length) return null;
    // 同点主鎖: OH位置番号最小 → 多重結合位置最小 → 置換基数最多 → 置換基位置最小 → 辞書順
    named.sort((a, b) => _iupacCmpLocants(a.olLocs, b.olLocs) || _iupacCmpLocants(a.unsat, b.unsat) ||
        (b.subCount - a.subCount) || _iupacCmpLocants(a.locants, b.locants) || a.name.localeCompare(b.name, 'ja'));
    // ★ 最後に選ばれた 1本をそのまま持ち出す（捨てない）。ここが「決める場所」で、他には無い
    const best = named[0];
    return {
        name: best.name, kind: 'chain', mainChain: best.chain, groups: null,
        locants: { ol: best.olLocs, ene: best.eneLocs, yne: best.yneLocs, subs: best.subs },
        nameParts: best.parts, dirReason: best.dirReason
    };
}

// 非環式の炭化水素・ハロゲン化物・アルコール・エーテルの IUPAC 系統名。対応外は null。
// ★ `iupacNameDetail` の薄い包み。**命名の規則をここに足さないこと**
//   （足すと主鎖・番号を返す経路を迂回し、名前とハイライトが食い違う。DESIGN_iupac_check.md §N-1）
function iupacName(mol) {
    const d = iupacNameDetail(mol);
    return d ? d.name : null;
}

// 1本の主鎖候補について、両方向で番号付けし規則に沿って名前を作る。
// 番号付けの優先順位: 主特性基(-OH)の位置番号を最小 → 多重結合の位置番号を最小（二重結合優先）→ 置換基の位置番号最小 → アルファベット
function _iupacNameForMainChain(adj, haloAdj, cbond, chain, ohSet) {
    const n = chain.length;
    const hasOh = ohSet && ohSet.size > 0;
    const evalDir = (order) => {
        const subs = _iupacCollectSubs(adj, haloAdj, order);
        if (subs === null) return null;
        const eneLocs = [], yneLocs = [], olLocs = [];
        for (let i = 0; i < order.length; i++) if (ohSet && ohSet.has(order[i])) olLocs.push(i + 1);
        for (let i = 0; i + 1 < order.length; i++) {
            const t = cbond.get(_iupacCKey(order[i], order[i + 1])) || 1;
            if (t === 2) eneLocs.push(i + 1); else if (t === 3) yneLocs.push(i + 1);
        }
        // ★ order（＝番号順の原子ID列）を捨てない。採用した向きの order がそのまま主鎖の番号になる
        //   （DESIGN_iupac_check.md §N-2）。ここで捨てると、画面が向きを選び直すことになる
        return { order, subs, eneLocs, yneLocs, olLocs };
    };
    const f = evalDir(chain), r = evalDir(chain.slice().reverse());
    if (!f || !r) return null;
    const subLocs = d => d.subs.map(x => x.loc).sort((a, b) => a - b);
    let d;
    const cOl = _iupacCmpLocants(_iupacSortNum(f.olLocs), _iupacSortNum(r.olLocs));
    const cUn = _iupacCmpLocants(_iupacSortNum(f.eneLocs.concat(f.yneLocs)), _iupacSortNum(r.eneLocs.concat(r.yneLocs)));
    const cEne = _iupacCmpLocants(_iupacSortNum(f.eneLocs), _iupacSortNum(r.eneLocs));
    const cSub = _iupacCmpLocants(subLocs(f), subLocs(r));
    // ★ **どの比較で向きが決まったか**を1つだけ持ち出す（`dirReason`。DESIGN_iupac_check.md §5）。
    //   生徒が間違えるのは「どちら端から数えるか」で、その理由はここで**分岐した直後に捨てていた**。
    //   ⚠ 名前の出力は1バイトも変わらない（下の分岐はそのまま。足したのは代入1つだけ）。
    //   IN12 が `compounds.json` 全件で出力不変を、IN13 が6通りとも実際に出ることを見張る
    let dirReason;
    if (cOl !== 0) { d = cOl < 0 ? f : r; dirReason = 'ol'; }
    else if (cUn !== 0) { d = cUn < 0 ? f : r; dirReason = 'unsat'; }
    else if (cEne !== 0) { d = cEne < 0 ? f : r; dirReason = 'ene'; }
    else if (cSub !== 0) { d = cSub < 0 ? f : r; dirReason = 'sub'; }
    else {
        const seq = s => s.subs.slice().sort((a, b) => a.key.localeCompare(b.key) || a.loc - b.loc).map(x => x.loc);
        const ff = seq(f), rr = seq(r); d = f; dirReason = 'tie';
        for (let i = 0; i < ff.length; i++) { if (ff[i] !== rr[i]) { d = ff[i] < rr[i] ? f : r; dirReason = 'alpha'; break; } }
    }
    const eL = _iupacSortNum(d.eneLocs), yL = _iupacSortNum(d.yneLocs), oL = _iupacSortNum(d.olLocs);
    const coreParts = [];
    const core = hasOh ? _iupacOlCore(n, oL, eL, yL, coreParts) : _iupacUnsatCore(n, eL, yL, coreParts);
    if (!core) return null;
    const out = { coreParts, parts: null };
    const name = _iupacAssemble(core, d.subs, n === 1 && !hasOh, out); // メタン系ハロゲン化物のみ置換基位置を省略
    if (!name) return null;
    // chain = 採用した向きの原子ID列。番号 k の炭素 = chain[k-1]（向きは配列の順そのもの）
    return {
        name, chain: d.order, subCount: d.subs.length, subs: d.subs, parts: out.parts, dirReason,
        olLocs: oL, eneLocs: eL, yneLocs: yL, unsat: _iupacSortNum(eL.concat(yL)), locants: subLocs(d)
    };
}

// テスト（test.html）およびコンソールデバッグ用にグローバル公開する。
// class宣言・const はトップレベルでも window のプロパティにならないため明示が必要。
/**
 * 立体を決める単位（不斉炭素と、シス/トランスが意味を持つ C=C）を返す（P12-8 M2.5）。
 * ここは構造（つながり方）だけで決まり、描かれた立体には依存しない。
 */
function stereoUnitsOf(mol) {
    const centers = mol.atoms
        .filter(a => a.element === 'C' && mol.isSp3Carbon(a.id) && mol.isAsymmetricCarbon(a.id))
        .map(a => a.id);
    const bonds = mol.bonds
        .filter(b => _bondGeoRefs(mol, b))
        .map(b => [b.atomId1, b.atomId2]);
    return { centers, bonds };
}

/**
 * 立体異性体の総数を数える（P12-8 M2.5「総数当て」の判定）。
 *
 * 素朴には「立体の単位が n 個なら 2ⁿ 通り」だが、実際にはそれより少なくなることがある。
 * 理由は2通りあり、どちらも**同じ仕組み**で正しく扱える:
 *   ① メソ体 … 分子内に対称面があり、(R,S) と (S,R) が同一（酒石酸: 2²=4 → 3）
 *   ② 環などの回転対称 … 数え始める位置が違うだけで同じ分子
 *      （乳酸3分子の環状エステル: 2³=8 → 4。RRS・RSR・SRR がひとつ）
 * canonicalStereoCode は分子の自己同型すべてで最小化するので、
 * 2ⁿ 通りを全部作ってコードの種類を数えれば、①②とも自動的に畳み込まれる。
 *
 * 返り値 { count, naive, centers, bonds, folded, overflow }
 *   count = 実際の種類数 / naive = 2ⁿ / folded = 畳み込みが起きたか
 * 単位が limit を超える分子は組合せが増えすぎるので overflow を返す（数えない）。
 */
function countStereoisomers(mol, limit = 12) {
    const { centers, bonds } = stereoUnitsOf(mol);
    const n = centers.length + bonds.length;
    const base = { centers: centers.length, bonds: bonds.length, naive: Math.pow(2, n) };
    if (n === 0) return Object.assign({ count: 1, folded: false, overflow: false }, base);
    if (n > limit) return Object.assign({ count: null, folded: false, overflow: true }, base);
    const seen = new Set();
    const total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
        const atomParity = {};
        const bondGeo = {};
        centers.forEach((id, k) => { atomParity[id] = (mask >> k & 1) ? 1 : -1; });
        bonds.forEach(([i, j], k) => {
            bondGeo[`${i}_${j}`] = (mask >> (centers.length + k) & 1) ? 'syn' : 'anti';
        });
        seen.add(canonicalStereoCode(mol, { atomParity, bondGeo }));
    }
    return Object.assign({ count: seen.size, folded: seen.size < base.naive, overflow: false }, base);
}

/**
 * ★ 立体の単位を1つ指す**唯一のキーの作り方**（DESIGN_stereo_point.md §8-2）。
 *
 * `canonicalStereoCode` の `bondGeo` と同じ `'id1_id2'` の形にそろえる。
 * ⚠ **原子IDに `_` が入る**（`atom_9f3k…`）ので、このキーは**分解できない**。
 *   受け取る側は必ずこの関数で作ったキーどうしを突き合わせること
 *   （`split('_')` で戻そうとすると黙って壊れる）。
 */
function stereoBondKey(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * ★ 2ⁿ が崩れた（畳み込みが起きた）**理由**を見分ける（DESIGN_stereo_point.md §1-4）。
 *
 * `countStereoisomers` は `folded`（畳み込んだか）しか返さないが、
 * 「なぜ少ないのか」を画面で言うには理由が要る。**新しい化学は1行も書かない** ——
 * 判定は既存の `canonicalStereoCode` ＋ `mirrorStereo` の組み合わせだけ:
 *
 *   畳み込みがある かつ 不斉炭素が1個以上 かつ 鏡像が自分自身の種が1個以上 → 'meso'
 *   畳み込みがある それ以外                                              → 'symmetry'
 *   畳み込みが無い・数え切れない                                         → null
 *
 * ⚠ トリオレイン（C=C 3本・不斉炭素0個）は「鏡像が自分自身」の種を6つ持つが、
 *   **不斉炭素が0個なのでメソ体とは呼ばない**。上の「不斉炭素が1個以上」がそれを弾く。
 *
 * 実測での期待値（DESIGN_stereo_point.md §1-4 の表）:
 *   酒石酸 / 1,2-ジメチルシクロプロパン / 1,2-ジメチルシクロブタン … 'meso'
 *   乳酸3分子の環状エステル … 'symmetry' ／ トリオレイン … 'symmetry'（meso ではない）
 *   2-ブテン・乳酸（畳み込み無し） … null
 */
function stereoFoldReason(mol, limit = 12) {
    const { centers, bonds } = stereoUnitsOf(mol);
    const n = centers.length + bonds.length;
    if (n === 0 || n > limit) return null;
    const naive = Math.pow(2, n);
    const codes = new Map(); // code -> その種を代表する記述子（鏡像を作るのに使う）
    const total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
        const atomParity = {};
        const bondGeo = {};
        centers.forEach((id, k) => { atomParity[id] = (mask >> k & 1) ? 1 : -1; });
        bonds.forEach(([i, j], k) => {
            bondGeo[`${i}_${j}`] = (mask >> (centers.length + k) & 1) ? 'syn' : 'anti';
        });
        const code = canonicalStereoCode(mol, { atomParity, bondGeo });
        if (!codes.has(code)) codes.set(code, { atomParity, bondGeo });
    }
    if (codes.size >= naive) return null;          // 畳み込みが起きていない
    if (centers.length === 0) return 'symmetry';   // 不斉炭素が無い＝メソ体とは呼ばない
    let achiral = 0;
    codes.forEach((stereo, code) => {
        if (canonicalStereoCode(mol, mirrorStereo(stereo)) === code) achiral++;
    });
    return achiral > 0 ? 'meso' : 'symmetry';
}

// ===== 分子全体の3D配置（P12-8 M4a。DESIGN_3d_correspondence.md 6章）=====
// 作図座標は使わない。このアプリの作図は直交格子（結合角90°）が仕様なので、
// そのまま立体にすると「結合角90°の分子模型」＝化学的に誤った図になる。
// トポロジーと、描いた図から読んだ立体記述子だけから、正しい結合角で組み直す。

// 重原子どうしの結合長を1とし、水素は 0.7 にする（実測比 C-H 1.09Å / C-C 1.54Å ≒ 0.71）。
// 一律1にすると水素が実際より外へ出て、1,3位の水素どうしが重なって見えてしまう
const M3D_H_BOND = 0.7;
const M3D_TETRA = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
const M3D_TRIGONAL = [[1, 0, 0], [-0.5, Math.sqrt(3) / 2, 0], [-0.5, -Math.sqrt(3) / 2, 0]];
const M3D_LINEAR = [[1, 0, 0], [-1, 0, 0]];

function _v3n(v) { const L = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / L, v[1] / L, v[2] / L]; }
function _v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function _v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function _v3cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
// axis（単位ベクトル）まわりに角 t だけ回す（ロドリゲスの回転公式）。
// 真の回転（行列式+1）なので手性は保たれる。これが M4 設計の要点
function _v3rot(v, axis, t) {
    const c = Math.cos(t), s = Math.sin(t), d = _v3dot(axis, v) * (1 - c);
    const k = _v3cross(axis, v);
    return [v[0] * c + k[0] * s + axis[0] * d,
            v[1] * c + k[1] * s + axis[1] * d,
            v[2] * c + k[2] * s + axis[2] * d];
}
// u に垂直な成分を取り出して正規化する（ねじれ角の基準づくり）。潰れたら null
function _perp(v, u) {
    const d = _v3dot(v, u);
    const w = [v[0] - u[0] * d, v[1] - u[1] * d, v[2] - u[2] * d];
    return Math.hypot(w[0], w[1], w[2]) < 1e-6 ? null : _v3n(w);
}
// u に垂直な任意の単位ベクトル
function _anyPerp(u) {
    return _v3n(_v3cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
}
// from を to に重ねる最小回転を関数として返す（どちらも単位ベクトル）
function _alignRot(from, to) {
    const d = Math.max(-1, Math.min(1, _v3dot(from, to)));
    if (d > 1 - 1e-9) return (v) => v;
    if (d < -1 + 1e-9) { const ax = _anyPerp(from); return (v) => _v3rot(v, ax, Math.PI); }
    const ax = _v3n(_v3cross(from, to)), t = Math.acos(d);
    return (v) => _v3rot(v, ax, t);
}
// u まわりで a を b に向ける符号つき角度（a・b は u に垂直な単位ベクトル）
function _signedAngle(a, b, u) {
    return Math.atan2(_v3dot(_v3cross(a, b), u), _v3dot(a, b));
}
/**
 * 環の炭素についた置換基が、環のどちらの面にあるか（+1=上/手前・-1=下/奥・0=読めない）。
 * readRingParityFromHaworth と同じ規約: 面マーク（haworthFace）が最優先、
 * 無ければハース投影の縦位置（画面yは下が正なので、上にあれば+1）から導く。
 */
function _haworthFaceOf(center, sub) {
    if (sub.haworthFace === 1 || sub.haworthFace === -1) return sub.haworthFace;
    const sx = sub.x - center.x, sy = sub.y - center.y;
    const len = Math.hypot(sx, sy);
    if (len < 1e-6 || Math.abs(sy) / len < RING_FACE_COS_TOL) return 0;
    return sy < 0 ? 1 : -1;
}
const RING_FACE_COS_TOL = Math.cos(25 * Math.PI / 180);

// fromId 側へ戻らずに refId から辿れる原子の数（暗黙水素も数える）＝置換基の大きさ
function _subtreeSize(mol, refId, fromId) {
    const seen = new Set([fromId, refId]);
    const stack = [refId];
    let n = 1 + mol.getFreeValency(refId);
    while (stack.length) {
        const id = stack.pop();
        mol.getNeighbors(id).forEach(nb => {
            if (nb.atom.element === 'H' || seen.has(nb.atom.id)) return;
            seen.add(nb.atom.id);
            n += 1 + mol.getFreeValency(nb.atom.id);
            stack.push(nb.atom.id);
        });
    }
    return n;
}

/**
 * 原子まわりの「方向スロット」を作る。返り値は [{ref, isH, v}]。
 * ref は隣接原子の id（暗黙水素は 'H0','H1',… だが、原子IDも文字列なので
 * 見分けには必ず isH を使うこと）。
 * スロット数は σ結合の相手数ではなく**電子対の数**で決める:
 *   三重結合あり→直線(2) / 二重結合あり→平面三角(3) / それ以外→正四面体(4)。
 * O（2結合）・N（3結合）も非共有電子対を数に入れて正四面体扱いにする
 * （実測 104.5°・107° への近似）。σの本数がそれを超える場合（-SO₃H の S）はσに合わせる。
 * sp3 の不斉中心は tetrahedralDirs をそのまま使う＝**描いた立体と同じ手性**になる。
 */
function _localDirs(mol, atomId, parity) {
    const nbs = mol.getNeighbors(atomId).filter(n => n.atom.element !== 'H');
    const hCount = mol.getFreeValency(atomId);
    const sigma = nbs.length + hCount;
    if (sigma === 0) return { fixed: true, slots: [] };
    const maxType = nbs.reduce((m, n) => Math.max(m, n.type), 1);
    let k = maxType >= 3 ? 2 : maxType === 2 ? 3 : 4;
    k = Math.max(k, sigma);
    if (k > 4) return null; // 5配位以上は扱わない
    if (k === 4) {
        const t = tetrahedralDirs(mol, atomId, parity);
        // 不斉中心のときだけ返る。その場合 H は最大1本なので 'H0' で一意。
        // fixed=true ＝ 置換基の入れ替えは禁止（手性が変わるため）
        if (t) {
            return { fixed: true,
                slots: t.map(d => ({ ref: d.ref === 'H' ? 'H0' : d.ref, isH: d.ref === 'H', v: d.v })) };
        }
    }
    const base = (k === 2 ? M3D_LINEAR : k === 3 ? M3D_TRIGONAL : M3D_TETRA).map(_v3n);
    const refs = nbs.map(n => ({ ref: n.atom.id, isH: false }));
    for (let i = 0; i < hCount; i++) refs.push({ ref: 'H' + i, isH: true });
    return { fixed: false, slots: refs.map((s, i) => ({ ref: s.ref, isH: s.isH, v: base[i] })) };
}

/**
 * 単環の原子を一周の順に並べて返す（縮合環・分岐がある環系では null）。
 * 環を正多角形に組み直すために使う。
 */
function _ringCycleOrder(mol, sys, ringIds) {
    if (sys.length < 3) return null;
    const nbrsIn = (id) => mol.getNeighbors(id)
        .filter(n => ringIds.has(n.atom.id) && sys.includes(n.atom.id))
        .map(n => n.atom.id);
    if (sys.some(id => nbrsIn(id).length !== 2)) return null; // 縮合環（3本以上）は対象外
    const order = [sys[0]];
    let prev = null, cur = sys[0];
    for (let i = 1; i < sys.length; i++) {
        const next = nbrsIn(cur).find(x => x !== prev);
        if (next === undefined || order.includes(next)) return null;
        order.push(next);
        prev = cur;
        cur = next;
    }
    return nbrsIn(cur).includes(order[0]) ? order : null;
}

// 互いにつながった環の原子をひとまとまり（環系）にして返す。縮合環は1つの環系になる
function _ringSystems(mol, ringIds) {
    const seen = new Set();
    const out = [];
    ringIds.forEach(start => {
        if (seen.has(start)) return;
        const sys = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const id = stack.pop();
            sys.push(id);
            mol.getNeighbors(id).forEach(n => {
                if (!ringIds.has(n.atom.id) || seen.has(n.atom.id)) return;
                seen.add(n.atom.id);
                stack.push(n.atom.id);
            });
        }
        out.push(sys);
    });
    return out;
}

/* ==========================================================================
 * ハース図を「見かけだけ」置き直す2つの操作（DESIGN_sugar.md §1-2・§4-6）
 *
 * 入試では「マルトースを上下反転した図」「教科書のフルクトース」のように、
 * **見かけが変わっても同じ分子だと見抜けるか**が問われる。
 * アプリは α/β を**描かれた縦位置**から読む（DESIGN_stereochemistry.md §12.1 の
 * 明示の例外）ので、図を動かすと立体の読みが動く。動かしてよいのは**2つだけ**:
 *
 *   ① 上下反転（裏返す）  … y を反転し、面マーク（haworthFace）も一緒に反転する。
 *      3D では (x,y,z) → (x,−y,−z) ＝ **面内の軸まわりの180°回転**（行列式 +1）。
 *      「上下入替」と「たどる向き逆」が**同時に**起きるので立体は動かない。
 *   ② 独楽回転（環の面内で回す）… 環原子を、置換基ごと**環の席をずらして**置き直す。
 *      3D では環に垂直な軸まわりの回転。置換基の縦位置（＝面）はそのまま運ばれる。
 *
 * ⚠ **鏡映は入れない**（別の化合物になる）。⚠ **図をそのまま面内で180°回すのも入れない** ——
 * それは「上下だけ入れ替える」であって、ハース投影の約束（上に描く＝手前）を通すと
 * **鏡像**になる（実測: 環をもつ糖16件すべてで立体コードが変わる）。
 * 紙の上で図をくるっと回すのが 3D の回転でも、**ハース図は向きの固定された表記**なのでそうなる。
 *
 * 実測（登録 1,059 件の全数。tests.js の SG1〜SG5 が同じことを見張る）:
 *   ① 正しい反転 16/16 立体保存 ／ 上下だけ 0/16 ／ 向きだけ 0/16 ／ 面マーク直し忘れ 8/16
 *   ② 独楽回転 16/16 立体保存（全ステップ数・環系 438 個で穴ゼロ）
 * ========================================================================== */

/** ids（省略時は全原子）の指す原子だけを返す */
function _atomsOfIds(mol, ids) {
    if (!ids) return mol.atoms.slice();
    const set = ids instanceof Set ? ids : new Set(ids);
    return mol.atoms.filter(a => set.has(a.id));
}

/**
 * 上下反転（裏返す）を当ててよいか（DESIGN_sugar.md §4-6）。
 *
 * ⚠ **フィッシャー投影として読める中心が1つでもあれば断る。** フィッシャーは
 * 「縦＝奥・横＝手前」なので、y を反転すると**奥の2本を入れ替えただけ**になり
 * ＝ その中心は鏡像に化ける（ハース図と逆に、反転が読みの約束を壊す側）。
 * 環（ハース）の中心はフィッシャーとは相互排他なので、糖の環はここを通る。
 *
 * 全登録 1,059 件で、この門番は**過不足なく一致した**
 * （許して変わったもの 0 件／断ったのに安全だったもの 0 件）。
 */
function canFlipHaworth(mol, ids) {
    const atoms = _atomsOfIds(mol, ids);
    if (!atoms.length) return false;
    const set = new Set(atoms.map(a => a.id));
    return !Object.keys(readAtomParityFromFischer(mol)).some(id => set.has(id));
}

/**
 * 上下反転（裏返す）を当てる。y を折り返し、**面マークも一緒に反転**する。
 * ⚠ 面マークを直し忘れると、マークを持つ登録8件だけが鏡像に化ける（§1-3）。
 * データ（compounds.json）は触らず、**コード側で座標とマークの両方を回す**のが約束。
 *
 * `axisY` を省くと**その集合の重原子の重心**で折り返す（分子まるごとを裏返す既定の使い方）。
 *
 * ⚠⚠ **`ids` で一部だけを裏返すときは `axisY` を省いてはいけない**（v1442 で実測）。
 * 一部だけを動かすと、**動かさなかった側との境目の結合**（二糖ならグリコシド酸素 -O-）だけが
 * 「片方だけ動いた」状態になり、その結合の**縦位置＝面の読み**が回転と合わなくなる。
 * 正しい軸は**境目の原子（動かさない側に残す原子）の y** で、そこを軸にすると
 *   境目の結合ベクトルが**ちょうど y 反転**する ＝ 面の符号が反転し、**縦からの角度は変わらない**
 *   （＝ ±25° の読める/読めないも変わらない）
 * ので、動いた側の環中心のパリティが**回転として**保たれる。
 *
 * 実測（二糖4件 × どちらの環を動かすかの2通り ＝ 8ケース。tests.js の SG9）:
 *   軸＝橋の酸素の y … **8/8 で立体コード同一** ／ 軸＝集合の重心（既定） … **8/8 で立体コードが変わる**
 * ⚠ 既定の軸は「分子まるごと」専用だと思うこと。
 */
function flipHaworth(mol, ids, axisY) {
    const atoms = _atomsOfIds(mol, ids);
    if (!atoms.length) return false;
    let cy = axisY;
    if (typeof cy !== 'number' || !isFinite(cy)) {
        const base = atoms.filter(a => a.element !== 'H');
        const list = base.length ? base : atoms;
        cy = list.reduce((t, a) => t + a.y, 0) / list.length;
    }
    atoms.forEach(a => {
        a.y = 2 * cy - a.y;
        if (a.haworthFace === 1 || a.haworthFace === -1) a.haworthFace = -a.haworthFace;
    });
    return true;
}

/**
 * 「この環（＋そのぶら下がり）だけ」を指す原子IDの集合を返す —— **部分反転の呼び方**（v1442）。
 *
 * 環から外へ出る枝を1本ずつ辿り、**その枝の中に別の環が入っていれば丸ごと捨てる**。
 * ＝ 二糖なら、グリコシド酸素 -O- から先（相手の環）は入らず、**橋の酸素そのものも入らない**。
 * 橋の酸素を動かさない側に残すのは、それが `flipHaworth` の軸（＝境目の原子の y）になるから。
 *
 * 使い方は必ずこの3行で組にする（軸を省くと立体が変わる。上の ⚠⚠ を参照）:
 *   const ids = haworthRingSideIds(mol, cycleB);
 *   const br  = haworthRingBridge(mol, cycleA, cycleB);
 *   if (canFlipHaworth(mol, ids)) flipHaworth(mol, ids, br.atom.y);
 */
function haworthRingSideIds(mol, cycle) {
    const ring = _ringAtomIds(mol);
    const own = new Set(cycle);
    const out = new Set(cycle);
    cycle.forEach(rid => {
        mol.getNeighbors(rid).forEach(n => {
            if (own.has(n.atom.id) || out.has(n.atom.id)) return;
            // 枝を丸ごと集める（自分の環は通らない）
            const branch = [];
            const seen = new Set([n.atom.id]);
            const stack = [n.atom.id];
            let hitsOtherRing = false;
            while (stack.length) {
                const cur = stack.pop();
                branch.push(cur);
                if (ring.has(cur) && !own.has(cur)) hitsOtherRing = true;
                mol.getNeighbors(cur).forEach(m => {
                    if (own.has(m.atom.id) || seen.has(m.atom.id)) return;
                    seen.add(m.atom.id);
                    stack.push(m.atom.id);
                });
            }
            if (!hitsOtherRing) branch.forEach(x => out.add(x));
        });
    });
    return out;
}

/**
 * 2つの環をつないでいる「橋」の原子を返す（二糖のグリコシド酸素）。
 * 見つからない（環どうしが直結している・橋が2原子以上ある）なら null。
 * 戻り値: { atom, hostA, hostB }（hostA は cycleA 側の環原子）
 */
function haworthRingBridge(mol, cycleA, cycleB) {
    const inA = new Set(cycleA), inB = new Set(cycleB);
    let found = null;
    mol.atoms.forEach(a => {
        if (inA.has(a.id) || inB.has(a.id)) return;
        const heavy = mol.getNeighbors(a.id).filter(n => n.atom.element !== 'H');
        const hostA = heavy.filter(n => inA.has(n.atom.id));
        const hostB = heavy.filter(n => inB.has(n.atom.id));
        if (hostA.length === 1 && hostB.length === 1 && heavy.length === 2) {
            if (found) { found = null; return; } // 橋が2本以上 ＝ この模型の想定外
            found = { atom: a, hostA: hostA[0].atom, hostB: hostB[0].atom };
        }
    });
    return found;
}

/** 描かれた環が凸多角形か（どの頂点でも曲がる向きが同じか）。独楽回転の前提 */
function _ringDrawnConvex(mol, cycle) {
    const p = cycle.map(id => mol.atoms.find(a => a.id === id));
    if (p.some(a => !a)) return false;
    let sign = 0;
    for (let i = 0; i < p.length; i++) {
        const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
        const cross = (a.x - b.x) * (c.y - b.y) - (a.y - b.y) * (c.x - b.x);
        if (Math.abs(cross) < 1e-6) return false;
        const s = cross > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
    }
    return true;
}

/**
 * 独楽回転できる環を、一周の順に並べた原子IDの配列で返す（複数の環があれば複数返す）。
 * 縮合環・スピロ・環どうしが直結したもの（ビフェニル）は `_ringCycleOrder` が断る。
 * ⚠ 凸でない環も断る —— パリティの符号は「どの頂点でも曲がる向きが同じ」ことに拠っている。
 */
function haworthSpinCycles(mol) {
    const ringIds = _ringAtomIds(mol);
    if (!ringIds.size) return [];
    return _ringSystems(mol, ringIds)
        .map(sys => _ringCycleOrder(mol, sys, ringIds))
        .filter(cycle => cycle && _ringDrawnConvex(mol, cycle));
}

/** 独楽回転を当ててよいか（cycle は haworthSpinCycles が返したもの） */
function canSpinHaworthRing(mol, cycle) {
    return Array.isArray(cycle) && cycle.length >= 3 && _ringDrawnConvex(mol, cycle);
}

/**
 * 独楽回転を当てる。環の「席」を steps 個ずらし、各環原子を**ぶら下がりごと平行移動**する。
 *
 * 環の頂点の集合は変わらない（同じ多角形のまま）ので、環結合はそのまま隣どうしを結ぶ。
 * 置換基は親の環原子と同じ量だけ動く ＝ **縦位置（面）が1つも動かない**。
 * ＝ 環に垂直な軸まわりの回転そのもので、立体は保たれる。
 * ⚠ 図をアフィン変換で回すのではない。それをすると置換基が斜めになって面が読めなくなる。
 */
function spinHaworthRing(mol, cycle, steps) {
    if (!canSpinHaworthRing(mol, cycle)) return false;
    const n = cycle.length;
    const k = ((Math.round(steps) % n) + n) % n;
    if (k === 0) return true;
    const inRing = new Set(cycle);
    const seat = cycle.map(id => {
        const a = mol.atoms.find(x => x.id === id);
        return { x: a.x, y: a.y };
    });
    // 環原子ごとの「ぶら下がり」＝環を通らずに辿れる原子（二糖なら相手の環も丸ごと入る）
    const groups = cycle.map(id => {
        const members = [id];
        const seen = new Set([id]);
        const stack = [id];
        while (stack.length) {
            const cur = stack.pop();
            mol.getNeighbors(cur).forEach(nb => {
                if (inRing.has(nb.atom.id) || seen.has(nb.atom.id)) return;
                seen.add(nb.atom.id);
                members.push(nb.atom.id);
                stack.push(nb.atom.id);
            });
        }
        return members;
    });
    const before = new Map();
    mol.atoms.forEach(a => before.set(a.id, { x: a.x, y: a.y }));
    groups.forEach((members, i) => {
        const dx = seat[(i + k) % n].x - seat[i].x;
        const dy = seat[(i + k) % n].y - seat[i].y;
        members.forEach(id => {
            const a = mol.atoms.find(x => x.id === id);
            const s = before.get(id);
            if (a && s) { a.x = s.x + dx; a.y = s.y + dy; }
        });
    });
    return true;
}

/* ==========================================================================
 * キャンバスの図で環を裏返す（DESIGN_sugar.md 段4-b・v1445）
 *
 * 環ビュー（`stereo.js`）の裏返しは**模型の中だけ**の話で、キャンバスの座標は
 * 1ピクセルも動かさない。ここは**キャンバスの図そのもの**を置き直す側で、
 * ⚠ **同じ環が裏返る**ように環の並べ方（`orderHaworthRings`）を共有している。
 *
 * ⚠⚠ `DESIGN_3d_correspondence.md` §7.3 の「絵の軸（環の重心）と分子の軸（橋の y）は
 * 縦の平行移動ぶんしか違わないので面と立体は同じ」は、**キャンバスには当てはまらない**。
 * 環ビューは**面を先に読んでから絵を折る**ので平行移動が効かないが、キャンバスは
 * **折った座標から面を読み直す**ので、橋の結合の向きが変わって読みが変わる
 * （実測: 軸＝橋の y は 8/8 で立体保存・軸＝環の重心は 1/8・軸＝既定は 0/8）。
 *
 * 手順は3手（`haworthCanvasFlip`）:
 *   ① `flipHaworth(mol, ids, 軸)`  … 軸は環が2つなら橋の y・1つなら重心
 *   ② 相手から離れる向きへ縦にずらす（重なりを解く）
 *   ③ ★ `canonicalStereoCode` が変わっていないか確かめ、変わっていたら**巻き戻す**
 * ⚠ ③を省くと、条件を満たさない図で**黙って鏡像に化ける**（半分だけの操作は 0/16）。
 * ========================================================================== */

/**
 * ハース投影の炭素番号の起点（環の O）と、そこから番号が進む向きを返す。
 * ハース投影の約束では**環の酸素の隣のアノマー炭素**（環外に酸素を持つ側）が起点なので、
 * 「環の O → アノマー炭素」がそのまま番号の向きになる。
 * ⚠ **これが「この環はハース図として読む糖の環か」の門番**でもある ——
 * シクロヘキサノンやベンゼンは環内に O が無い（または隣がアノマーでない）ので null。
 * 戻り値 { oIndex, dir(+1/-1) } / null
 */
function haworthNumberingStart(mol, cycle) {
    const n = cycle.length;
    const oIndex = cycle.findIndex(id => {
        const a = mol.atoms.find(x => x.id === id);
        return a && a.element === 'O';
    });
    if (oIndex < 0) return null;
    const inRing = new Set(cycle);
    const isAnomer = id => mol.getNeighbors(id)
        .some(x => !inRing.has(x.atom.id) && x.atom.element === 'O');
    const next = cycle[(oIndex + 1) % n], prev = cycle[(oIndex + n - 1) % n];
    const dir = isAnomer(next) ? 1 : isAnomer(prev) ? -1 : 0;
    return dir ? { oIndex, dir } : null;
}

/**
 * 描かれた環の炭素番号をたどる向き（+1 = 見た目の時計回り／-1 = 反時計回り／0 = 決められない）。
 * 画面座標は下が正なので、符号付き面積が正 ＝ 見た目の時計回り。
 * ⚠ **教科書のスクロースはグルコース側が時計回り・フルクトース側が反時計回り**で、
 *    ここが「フルクトース環が裏返して描かれている」ことの数での現れ（DESIGN_sugar.md §5-2）。
 */
function haworthRingSense(mol, cycle) {
    const st = haworthNumberingStart(mol, cycle);
    if (!st) return 0;
    const n = cycle.length;
    const p = cycle.map(id => mol.atoms.find(a => a.id === id));
    if (p.some(a => !a)) return 0;
    let area = 0;
    for (let k = 0; k < n; k++) {
        const a = p[((st.oIndex + st.dir * k) % n + n) % n];
        const b = p[((st.oIndex + st.dir * (k + 1)) % n + n) % n];
        area += a.x * b.y - b.x * a.y;
    }
    return area > 0 ? 1 : area < 0 ? -1 : 0;
}

/**
 * 二糖の2つの環を [動かさない環A, 裏返すかもしれない環B] の順に並べる。
 * **選んだ炭素に依らず決まる**ようにしてある（同じ分子はいつも同じ絵になる）:
 *   ① 橋をアノマー炭素で持っている側（＝グリコシドを供与した側）を B にする
 *   ② 両方／どちらもアノマーなら（スクロース・トレハロース型）、**大きい環を A** にする
 *      ＝ スクロースではグルコース（六員）が A・フルクトース（五員）が B になり、
 *        教科書どおり「フルクトース側だけが裏返る」（DESIGN_sugar.md §5-2）
 * ⚠ **環ビュー（`StereoView.orderDisaccharideRings`）とキャンバスの裏返しはこの1本を共有する。**
 *    別々に持つと「横から見たときと図とで裏返る環が違う」が起こりうる。
 */
function orderHaworthRings(mol, cycles, bridge) {
    const anomeric = (cycle, hostId) => {
        const o = cycle.find(id => {
            const a = mol.atoms.find(x => x.id === id);
            return a && a.element === 'O';
        });
        return o !== undefined && mol.getNeighbors(o).some(n => n.atom.id === hostId);
    };
    const a0 = anomeric(cycles[0], bridge.hostA.id);
    const a1 = anomeric(cycles[1], bridge.hostB.id);
    if (a0 !== a1) return a0 ? [cycles[1], cycles[0]] : [cycles[0], cycles[1]];
    if (cycles[0].length !== cycles[1].length) {
        return cycles[0].length > cycles[1].length ? [cycles[0], cycles[1]] : [cycles[1], cycles[0]];
    }
    return cycles.slice();
}

/** 立体まで込みの正準コード（裏返しの前後で変わっていないことを確かめるのに使う） */
function _haworthCodes(mol) {
    return canonicalCode(mol) + '|' + canonicalStereoCode(mol, {
        atomParity: { ...readAtomParityFromFischer(mol), ...readRingParityFromHaworth(mol) },
        bondGeo: readBondGeoFromCoords(mol)
    });
}

/**
 * その環を「ハース図として読む糖の環」とみなしてよいか（キャンバスの ⇅ を出す門番）。
 * ⚠ `haworthNumberingStart` だけでは**ラクトンと酸無水物も通る**（環の O の隣の C が
 * カルボニル酸素を持つので「アノマーらしく」見える。実測: 登録 22件のうち 6件がこれ）。
 * アノマー炭素は **sp3 の炭素**（二重結合を持たない）なので、そこで切り分ける ＝ 残るのは
 * ピラノース10・フラノース2・二糖4 の16件。⚠ 裏返しても壊れないことは別の話（16件とも安全）で、
 * ここは**裏返す意味がある図か**（α/β を担っている図か）の線引き。
 */
function _haworthSugarCycle(mol, cycle) {
    const st = haworthNumberingStart(mol, cycle);
    if (!st) return null;
    const anomerId = cycle[((st.oIndex + st.dir) % cycle.length + cycle.length) % cycle.length];
    const a = mol.atoms.find(x => x.id === anomerId);
    if (!a || a.element !== 'C') return null;
    if (mol.getNeighbors(anomerId).some(n => n.type > 1)) return null;
    return st;
}

/**
 * ★ その分子の中で「ハース図として読む糖の環」になっている閉路を並べて返す（無ければ空配列）。
 *
 * `_haworthSugarCycle` の門番そのものを外から使えるようにしただけのもの。
 * ⚠ **`haworthFlipPlan` と分けてある理由**: フリップの下ごしらえは
 * 「環は2つまで」「橋1原子でつながっている」「裏返しても鏡像にならない」という
 * **裏返し固有の条件**を足している。**ハース図かどうかを聞きたいだけの側**
 * （名前を言い切ってよいかの判定 ＝ `lookupCompoundName`）にそれらは関係ない。
 * 登録16件では両者は一致するが、**一致は結果であって定義ではない**
 * （環3つの糖を将来登録すれば、裏返せなくても名前は言い切れるべき）。
 */
function haworthSugarCycles(mol) {
    return haworthSpinCycles(mol).filter(c => _haworthSugarCycle(mol, c));
}

/**
 * キャンバスで裏返す環の下ごしらえ。**連結成分1つ**を渡すこと。
 * 戻り値 { ok:true, rings, target, ids, axisY, senses } / { ok:false, reason }
 *   reason: 'none'（ハース図として読む環が無い）／'many'（環が3つ以上）／
 *           'link'（環2つだが橋1原子でつながっていない）／'gate'（裏返すと鏡像になる図）
 */
function haworthFlipPlan(mol) {
    const cycles = haworthSugarCycles(mol);
    if (!cycles.length) return { ok: false, reason: 'none' };
    if (cycles.length > 2) return { ok: false, reason: 'many' };
    let rings = cycles, ids, axisY;
    if (cycles.length === 2) {
        const br0 = haworthRingBridge(mol, cycles[0], cycles[1]);
        if (!br0) return { ok: false, reason: 'link' };
        rings = orderHaworthRings(mol, cycles, br0);
        const bridge = haworthRingBridge(mol, rings[0], rings[1]); // A/B を入れ替えたので取り直す
        ids = [...haworthRingSideIds(mol, rings[1])];
        axisY = bridge.atom.y; // ⚠ 軸は橋の原子の y（重心にすると 8/8 で鏡像になる）
    } else {
        // 環が1つ ＝ 分子まるごとを裏返す。軸は重原子の重心（`flipHaworth` の既定と同じ式）
        ids = mol.atoms.map(a => a.id);
        const heavy = mol.atoms.filter(a => a.element !== 'H');
        const list = heavy.length ? heavy : mol.atoms;
        axisY = list.reduce((t, a) => t + a.y, 0) / list.length;
    }
    if (!canFlipHaworth(mol, ids)) return { ok: false, reason: 'gate' };
    return {
        ok: true, rings, target: rings[rings.length - 1], ids, axisY,
        senses: rings.map(c => haworthRingSense(mol, c))
    };
}

/* ==========================================================================
 * ⇄ 左右に裏返す・⟳ 180°回す（DESIGN_sugar.md §1-2c の追補）
 *
 * ★ §1-2b 帰結3（「出してよい操作は②の上下フリップだけ」）は**剛体の座標変換に限った話**で、
 *   狭すぎた。**「環は動かし、置換基は付け根の環炭素について上下を付け替える」描き直し**まで
 *   許すと、意味を保つ図はちょうど4枚になる（クラインの四元群）:
 *
 *     元 ／ ② 上下フリップ（y 鏡映）／ ⇄ 左右フリップ（x 鏡映＋付け替え）／ ⟳ 180°回転＋付け替え
 *
 *   証拠は教科書自身が両方を印刷していること —— セロビオースの裏返った環は②、
 *   **スクロース中のフルクトース環は⇄**（v1448 の登録がまさにこれ。実測でも、単独の
 *   β-D-フルクトフラノースに `haworthTurn(..., 'leftright')` を当てた図と、スクロースの
 *   フルクトース側は**平行移動を除いて1px も違わない**）。
 *
 * ⚠ **罠（v1451 の「どれが同じ分子？」）とは別の絵。** あちらは**付け替えをしない**素朴な
 *   x 鏡映・面内180°回転 ＝ 鏡像の図（実測 0/16）。付け替えを入れると 16/16 で立体が保たれる。
 *   ＝ 付け替えを外すのが、この2操作の否定対照そのもの。
 *
 * ⚠ **軸は「ハース糖の環原子の重心」**（`flipHaworth` の既定＝重原子の重心ではない）。
 *   環原子は剛体変換だけを受け、付け替えでは動かない ＝ **この軸は操作で不変**なので
 *   ① 図が押すたびに横へ流れない（環はその場に留まる）
 *   ② 2回押せば**軸を覚えていなくても**1ピクセルの誤差もなく元に戻る（実測 16/16）
 *   ＝ ⇅（`flipHaworth` の重心軸）が `_haworthFlipMemo` を要るのとは事情が違う。
 * ========================================================================== */

/**
 * 環に属さない原子それぞれについて、ぶら下がっている環原子（＝付け根）の一覧を返す。
 * Map(atomId → [rootId, ...])。
 *
 * ⚠ **二糖の橋の酸素は付け根が2つになる**（両側の環から辿り着ける）。呼ぶ側は
 * その2つの y の平均で折り返す —— 登録4件では hostA/hostB の y は 300/300（マルトース等）と
 * 300/290（スクロース）で、平均で折り返しても面の符号は両側とも反転し、
 * 縦からの角度も ±25° の内側に収まる（実測。門番が最後に検算する）。
 */
function haworthBranchRoots(mol, ids) {
    const inSet = ids ? (ids instanceof Set ? ids : new Set(ids)) : null;
    const ring = _ringAtomIds(mol);
    const roots = new Map();
    ring.forEach(rid => {
        if (inSet && !inSet.has(rid)) return;
        // 付け根 rid から「環を通らずに」辿れる原子は、すべて rid にぶら下がっている
        const seen = new Set([rid]);
        const stack = [rid];
        while (stack.length) {
            const cur = stack.pop();
            mol.getNeighbors(cur).forEach(n => {
                const id = n.atom.id;
                if (seen.has(id) || ring.has(id)) return;
                if (inSet && !inSet.has(id)) return;
                seen.add(id);
                if (!roots.has(id)) roots.set(id, []);
                roots.get(id).push(rid);
                stack.push(id);
            });
        }
    });
    return roots;
}

/**
 * ⇄ / ⟳ の下ごしらえ。**連結成分1つ**を渡すこと。
 * 戻り値 { ok:true, ids, cycles, axis:{x,y}, roots } / { ok:false, reason }
 *   reason は `haworthFlipPlan` のもの（'none'/'many'/'link'/'gate'）＋
 *            'ring'（糖の環でない環が混じっている ＝ 付け替えの付け根が決まらない）
 *
 * ★ **門番は `haworthFlipPlan` に相乗りする** ＝ 3つの札（⇅・⇄・⟳）は必ず一緒に出入りする。
 *   別々の門番を書くと「⇅ は出るのに ⇄ は出ない糖」が黙って生まれる。
 */
function haworthTurnPlan(mol) {
    const base = haworthFlipPlan(mol);
    if (!base.ok) return base;
    const cycles = haworthSugarCycles(mol);
    const ringIds = _ringAtomIds(mol);
    const sugarRing = new Set();
    cycles.forEach(c => c.forEach(id => sugarRing.add(id)));
    // 糖の環でない環（ベンゼン環など）が混じると、その環は付け替えの barrier に当たって
    // 取り残され、枝の途中で図が裂ける。**登録16件では起きない**が、起きたら断る
    if ([...ringIds].some(id => !sugarRing.has(id))) return { ok: false, reason: 'ring' };
    const pts = mol.atoms.filter(a => sugarRing.has(a.id));
    if (!pts.length) return { ok: false, reason: 'none' };
    const ids = mol.atoms.map(a => a.id);
    return {
        ok: true, ids, cycles,
        axis: { x: pts.reduce((t, a) => t + a.x, 0) / pts.length,
                y: pts.reduce((t, a) => t + a.y, 0) / pts.length },
        roots: haworthBranchRoots(mol, ids)
    };
}

/**
 * ★ 環のテンプレートの**広い辺と狭い辺を入れ替える**（`haworthTurn` の③。DESIGN_sugar.md §4-10d）。
 *
 * ★ **なぜ要るか（ユーザーの言葉）**:
 * > 5番の炭素の ↑ にはスペースがあるので、もともと多くの原子を付けられる。
 * > 環を左右反転すると ↑ だった原子団が ↓ になるため、もともと原子を追加できなかった位置に潜り込む。
 *
 * ★ **実測: ハース環のテンプレートは上下に非対称**（環の頂点の集合が y 鏡映で自分に重なる登録は
 *   **0/16**。x 鏡映では 13/16 で自分に重なる）。ピラノースの型は
 *   **奥の辺（上段）が幅 110px・手前の辺（下段）が幅 60px** で、そのため頂点ごとの
 *   「置換基を置ける余地」（真上・真下へ伸ばして環の辺に当たるまで）が食い違う:
 *
 *     上段 C5 / 環O … 上=∞ ／ **下=79px**   ← 76px の CH₂OH を折り返すと残り 2.4px
 *     下段 C3 / C2  … **上=96px** ／ 下=∞    （96 ＝ 環の高さいっぱい）
 *     中段 C4 / C1  … 上=∞ ／ 下=∞          （★ フラノースの C5 はここ ＝ だから無事だった）
 *
 * ⚠ **①の x 鏡映はこの非対称を動かさない**ので、②で下を向いた C5 の枝が「余地 79px」の側に入る。
 *   ＝ **「置換基が向く側」と「余白のある側」が食い違う**。⇅（剛体の y 鏡映）が無事なのは、
 *   広い辺も狭い辺も原子と一緒に動く ＝ 外側が外側のままだから（実測: ⇅ は 0/16 で食い込まない）。
 *
 * ★ **③はその食い違いを畳む** —— 段（同じ y の環原子のかたまり）を上下で対にして、
 *   **x の並びだけを入れ替える**。原子の y も、どの段にいるかも、環のたどる順も変えないので
 *   立体の読みに触らない（実測 16/16 で保存）。結果として
 *   **⇄ の多角形は ⇅ の多角形と一致し・⟳ の多角形は元の多角形と一致する**（実測）
 *   ＝ **この app がすでに印刷している2つの形しか出ない**。
 *
 * ⚠ **五員環では何も起きない**（段が 1/2/2 で対にならない）＝ 無事だったものを触らない。
 * ⚠ **手描きの図では、入れ替えて多角形が凸でなくなるならその環は触らない**
 *   （凸のまま向きが変わらなければ、環の結合ベクトルの行列式の符号は全頂点で保たれる）。
 */
function _haworthSwapRingRows(mol, plan) {
    const byId = new Map(mol.atoms.map(a => [a.id, a]));
    // 多角形が「凸で、たどる向きがそろっている」か（＝ 各頂点の外積の符号が全部同じ）
    const convexSign = (cycle) => {
        const p = cycle.map(id => byId.get(id));
        if (p.some(a => !a)) return 0;
        let sign = 0;
        for (let i = 0; i < p.length; i++) {
            const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
            const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            if (Math.abs(cr) < 1e-9) return 0;
            const s = cr > 0 ? 1 : -1;
            if (sign === 0) sign = s; else if (sign !== s) return 0;
        }
        return sign;
    };
    const dxOf = new Map();
    (plan.cycles || []).forEach(cycle => {
        const before = convexSign(cycle);
        if (!before) return;                       // 凸でない環は触らない（手描きの図）
        // 段（同じ y の環原子）を上から順に
        const rows = new Map();
        cycle.forEach(id => {
            const a = byId.get(id);
            const k = a.y.toFixed(6);
            if (!rows.has(k)) rows.set(k, []);
            rows.get(k).push(a);
        });
        const list = [...rows.entries()]
            .sort((p, q) => parseFloat(p[0]) - parseFloat(q[0])).map(e => e[1]);
        const undo = [];
        for (let i = 0, k = list.length; i < Math.floor(k / 2); i++) {
            const A = list[i].slice().sort((p, q) => p.x - q.x);
            const B = list[k - 1 - i].slice().sort((p, q) => p.x - q.x);
            if (A.length !== B.length) continue;   // 対にならない段（五員環の頂点）は触らない
            const ax = A.map(a => a.x), bx = B.map(a => a.x);
            A.forEach((a, j) => { undo.push([a, a.x]); a.x = bx[j]; });
            B.forEach((a, j) => { undo.push([a, a.x]); a.x = ax[j]; });
        }
        if (convexSign(cycle) !== before) {        // 入れ替えて形が壊れるなら戻す
            undo.forEach(([a, x]) => { a.x = x; });
            return;
        }
        undo.forEach(([a, x]) => { dxOf.set(a.id, (dxOf.get(a.id) || 0) + a.x - x); });
    });
    if (!dxOf.size) return;
    // 枝は付け根と同じだけ横へ動く（付け根が2つ ＝ 二糖の橋の O は平均）
    const jobs = [];
    plan.roots.forEach((rootIds, id) => {
        const a = byId.get(id);
        const ds = rootIds.map(r => dxOf.get(r) || 0);
        if (a && ds.length) jobs.push({ a, dx: ds.reduce((t, v) => t + v, 0) / ds.length });
    });
    jobs.forEach(j => { j.a.x += j.dx; });
}

/**
 * ★ ⇄（左右に裏返す）／⟳（180°回す）を図に当てる。
 *
 * `plan` は **その連結成分について作った** `haworthTurnPlan` の戻り値、
 * `mol` は実体（キャンバスの分子。`plan.ids` の原子だけを動かす）。
 * `kind` は `'leftright'`（x 鏡映＋付け替え）か `'halfturn'`（180°回転＋付け替え）。
 *
 * 面マーク（`haworthFace`）の扱いは**操作ごとに手で決めない**。動かした手ごとに素直に:
 *   - 剛体の手で y が反転したら反転する（'halfturn' だけ）
 *   - 付け替えで枝が上下に移ったら反転する（両方）
 * ＝ ⇄ は正味1回反転・⟳ は正味そのまま。これが §1-2c の表の「f 反転／f 保存」と一致する。
 *
 * ★ **手は3つある**（③は v1461 で足した。§4-10d）:
 *   ① 剛体（x 鏡映 or 180°回転）／② 付け替え（枝を付け根の y で縦に折り返す）／
 *   ③ **環のテンプレートの広い辺・狭い辺を入れ替える**（`_haworthSwapRingRows`）。
 *   ③が無いと、②で下を向いた C5 の CH₂OH が環の内側 **2.4px** まで入る（14/16 件）。
 *   ⚠ ③は**原子の y も、どの段にいるかも、たどる順も変えない** ＝ 立体の読みには触らない。
 *
 * ⚠ 呼ぶ側は**当てたあとに図から立体コードを読み直し、変わっていたら巻き戻す**こと
 *   （黙って鏡像の図を作らないための最後の関所。`game.reframeWholeHaworth`）。
 */
function haworthTurn(mol, plan, kind) {
    if (!plan || !plan.ok) return false;
    if (kind !== 'leftright' && kind !== 'halfturn') return false;
    const byId = new Map(mol.atoms.map(a => [a.id, a]));
    const moving = plan.ids.map(id => byId.get(id));
    if (moving.some(a => !a)) return false;
    const flipMark = (a) => { if (a.haworthFace === 1 || a.haworthFace === -1) a.haworthFace = -a.haworthFace; };
    // ① 剛体の手（環もろとも）
    moving.forEach(a => {
        a.x = 2 * plan.axis.x - a.x;
        if (kind === 'halfturn') { a.y = 2 * plan.axis.y - a.y; flipMark(a); }
    });
    // ② 付け替え（**①のあとの付け根の y** について、枝を縦に折り返す）
    const jobs = [];
    plan.roots.forEach((rootIds, id) => {
        const a = byId.get(id);
        const ys = rootIds.map(r => byId.get(r)).filter(Boolean).map(r => r.y);
        if (a && ys.length) jobs.push({ a, ry: ys.reduce((t, v) => t + v, 0) / ys.length });
    });
    jobs.forEach(j => { j.a.y = 2 * j.ry - j.a.y; flipMark(j.a); });
    // ③ ★ 環のテンプレートの広い辺・狭い辺を入れ替える（＝ 余白のある側も一緒に移す）。
    //    ①②だけだと C5 の CH₂OH が環の内側 2.4px まで入る。詳しくは `_haworthSwapRingRows`
    _haworthSwapRingRows(mol, plan);
    return true;
}

/* ==========================================================================
 * 糖の炭素番号（🔢 主鎖と番号を見る に相乗りする・ユーザー発注 2026-08-25）
 *
 * ★ **表は持たない。** アノマー炭素は**グラフから**決める ——
 *   「環内の O と環外の O の両方が付く環炭素」で、それはすでに
 *   `haworthNumberingStart` が門番として読んでいるものそのもの。
 *   ＝ 名前（α-D-グルコース…）を引かずに番号が振れる ＝ ライブラリに無い糖でも動く。
 *
 * ★ **たどる向きの総当たりは要らない。** 環内 O を挟んでアノマー炭素の反対側が
 *   いちばん大きい番号の環炭素（ピラノースなら C5・フルクトフラノースなら C5）＝
 *   `haworthNumberingStart` の `dir` がそのまま番号の進む向き。
 *
 * ⚠ **アルドースかケトースかも表を引かない**: アノマー炭素に**環外の炭素**が付いていれば
 *   ケトース（その炭素が C1・アノマーは C2）、付いていなければアルドース（アノマーが C1）。
 * ========================================================================== */

/** 環1つぶんの炭素番号（環内の O には番号を振らない）。読めなければ null */
function _haworthRingCarbonNumbers(mol, cycle) {
    const st = haworthNumberingStart(mol, cycle);
    if (!st) return null;
    const n = cycle.length;
    const at = (i) => mol.atoms.find(a => a.id === cycle[((i % n) + n) % n]);
    const anomer = at(st.oIndex + st.dir);
    if (!anomer || anomer.element !== 'C') return null;
    const inRing = new Set(cycle);
    const exoC = (id) => mol.getNeighbors(id)
        .filter(x => !inRing.has(x.atom.id) && x.atom.element === 'C').map(x => x.atom);
    // ケトース（フルクトフラノース型）＝ アノマー炭素に環外の炭素が付いている
    const branch = exoC(anomer.id);
    const ketose = branch.length > 0;
    if (ketose && branch.length !== 1) return null;   // アノマーに枝が2本 ＝ 想定外
    const numbers = new Map();
    let k = ketose ? 2 : 1;
    let last = null;
    for (let i = 1; i < n; i++) {                     // 環内の O（i=0）は飛ばす
        const a = at(st.oIndex + st.dir * i);
        if (!a || a.element !== 'C') return null;     // 環内に O が2つ ＝ 糖として読まない
        numbers.set(a.id, k++);
        last = a;
    }
    if (ketose) numbers.set(branch[0].id, 1);         // アノマーの上の -CH₂OH が C1
    // 最後の環炭素から外へ伸びる炭素の鎖を続ける（ピラノースなら C6）
    let cur = last, guard = 0;
    while (cur && guard++ < 12) {
        const next = exoC(cur.id).filter(a => !numbers.has(a.id));
        if (next.length !== 1) break;                 // 枝分かれ・行き止まり
        numbers.set(next[0].id, k++);
        cur = next[0];
    }
    return { anomerId: anomer.id, anomerNumber: ketose ? 2 : 1, ketose, numbers };
}

/**
 * ★ その分子のハース図の糖について、炭素番号の札を返す。
 * 戻り値 { ok:true, labels: Map(atomId → '1' / "1′"), rings:[…], primed:bool }
 *        / { ok:false, reason }（'none' / 'many' / 'link' / 'read'）
 *
 * **二糖は環ごとに番号を振り、片方に ′ を付ける**（マルトース C1–C4′ の型）。
 * ⚠ **′ が付くのは「グリコシドを受け取った側」**（供与した側は番号そのまま）:
 *   ① 橋を**アノマー炭素**で持っている環が1つだけなら、それが供与側 ＝ ′ 無し
 *      （マルトース・セロビオース・ラクトース。C1 – C4′ になる）
 *   ② 両方がアノマーなら（スクロース型）**大きい環を供与側**にする
 *      ＝ グルコースが 1〜6・フルクトースが 1′〜6′（教科書のスクロースの図）
 * ⚠ 環の並べ方そのものは `orderHaworthRings`（環ビューと共有）に任せる ＝
 *   **選んだ炭素に依らず、同じ分子はいつも同じ番号になる**。
 *   ただし A/B と ′ の有無は**同じものではない**（①では B が ′ 無し・②では A が ′ 無し）。
 */
function haworthCarbonNumbers(mol) {
    const cycles = haworthSugarCycles(mol);
    if (!cycles.length) return { ok: false, reason: 'none' };
    if (cycles.length > 2) return { ok: false, reason: 'many' };
    let ordered = cycles, donorIndex = 0;
    if (cycles.length === 2) {
        const br0 = haworthRingBridge(mol, cycles[0], cycles[1]);
        if (!br0) return { ok: false, reason: 'link' };
        ordered = orderHaworthRings(mol, cycles, br0);
        const bridge = haworthRingBridge(mol, ordered[0], ordered[1]);
        if (!bridge) return { ok: false, reason: 'link' };
        const anomericHost = (cycle, hostId) => {
            const o = cycle.find(id => {
                const a = mol.atoms.find(x => x.id === id);
                return a && a.element === 'O';
            });
            return o !== undefined && mol.getNeighbors(o).some(n => n.atom.id === hostId);
        };
        const a0 = anomericHost(ordered[0], bridge.hostA.id);
        const a1 = anomericHost(ordered[1], bridge.hostB.id);
        // ① 片方だけがアノマーで橋を持つ ＝ そちらが供与側（′ 無し）
        if (a0 !== a1) donorIndex = a0 ? 0 : 1;
        // ② 両方（スクロース型）＝ 大きい環を供与側にする（＝ 教科書のグルコース側）
        else donorIndex = ordered[0].length >= ordered[1].length ? 0 : 1;
    }
    const rings = [];
    const labels = new Map();
    for (let i = 0; i < ordered.length; i++) {
        const r = _haworthRingCarbonNumbers(mol, ordered[i]);
        if (!r) return { ok: false, reason: 'read' };
        const prime = ordered.length === 2 && i !== donorIndex;
        r.numbers.forEach((v, id) => labels.set(id, prime ? `${v}′` : String(v)));
        rings.push({ cycle: ordered[i], anomerId: r.anomerId, anomerNumber: r.anomerNumber,
                     ketose: r.ketose, prime, size: r.numbers.size });
    }
    return { ok: true, labels, rings, primed: ordered.length === 2 };
}

/** 動かす側と動かさない側の、結合していない重原子どうしの最短距離 */
function _haworthClearance(mol, idSet) {
    const inn = mol.atoms.filter(a => a.element !== 'H' && idSet.has(a.id));
    const out = mol.atoms.filter(a => a.element !== 'H' && !idSet.has(a.id));
    if (!inn.length || !out.length) return Infinity;
    let best = Infinity;
    inn.forEach(a => out.forEach(b => {
        if (mol.getBond(a.id, b.id)) return; // つながっている相手は近くて当たり前
        best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
    }));
    return best;
}

/** 動かす側と動かさない側をまたぐ結合（＝グリコシド結合）のいちばん長いもの */
function _haworthBridgeSpan(mol, idSet) {
    let best = 0;
    mol.bonds.forEach(b => {
        const a = mol.atoms.find(x => x.id === b.atomId1);
        const c = mol.atoms.find(x => x.id === b.atomId2);
        if (!a || !c || idSet.has(a.id) === idSet.has(c.id)) return;
        best = Math.max(best, Math.hypot(a.x - c.x, a.y - c.y));
    });
    return best;
}

/**
 * ★ キャンバスの図で環を裏返す（段4-b の本体）。**連結成分1つ**を渡すこと。
 *
 * `opt.undo`（前回の戻り値の `{dx, dy}`）を渡すと**厳密な逆操作**になる
 * （まず (−dx, −dy) 戻してから、同じ軸 `axisY` で反射する。
 *  橋の原子は動かないので軸はいつも同じ ＝ 1ピクセルの誤差もなく元の図に戻る。実測 16/16）。
 * ⚠ 逆操作を探索でやり直しても**元には戻らない** —— 探索は「相手から離れる側」しか見ないので、
 *   2回目に打ち消す向きを選べない（実測: 二糖8件中6件で図がずれたまま）。
 *
 * 置き直しの選び方（**動かさずに済むなら動かさない**）:
 *   ① ずらさずに済む（重ならない）ならそれを採る ＝ 図が飛ばない
 *   ② 駄目なら (dx, dy) を総当たりし、**橋の結合がいちばん短くなる**置き方を採る
 *      （変位の小ささではなく橋の長さで選ぶ ＝ グリコシド結合が伸びきった絵にならない）
 *   ③ ★ どの候補も `_haworthCodes` が変わらないことを確かめてから採る（変わるものは1つも採らない）
 *
 * 戻り値 { ok:true, ids, axisY, dx, dy, clearance, span, senses } / { ok:false, reason }
 */
function haworthCanvasFlip(mol, opt) {
    opt = opt || {};
    const plan = haworthFlipPlan(mol);
    if (!plan.ok) return plan;
    const { ids, axisY, rings } = plan;
    const idSet = new Set(ids);
    const before = _haworthCodes(mol);
    const snap = mol.atoms.map(a => ({ a, x: a.x, y: a.y, f: a.haworthFace }));
    const rollback = () => snap.forEach(s => { s.a.x = s.x; s.a.y = s.y; s.a.haworthFace = s.f; });
    const done = (dx, dy) => ({
        ok: true, ids, axisY, dx, dy,
        clearance: _haworthClearance(mol, idSet),
        span: _haworthBridgeSpan(mol, idSet),
        senses: rings.map(c => haworthRingSense(mol, c))
    });
    const moving = mol.atoms.filter(a => idSet.has(a.id));
    // ⚠ **裏返す前**の最短距離を控える（離れているとみなす目安に使う）。
    //   裏返したあとに測ると「もう重なっている値」を目安にしてしまい、①が必ず通る
    const clearance0 = _haworthClearance(mol, idSet);

    // --- 逆操作: 前回のずらしを戻してから、同じ軸で反射する ---
    if (opt.undo) {
        moving.forEach(a => { a.x -= opt.undo.dx || 0; a.y -= opt.undo.dy || 0; });
        flipHaworth(mol, ids, axisY);
        if (_haworthCodes(mol) !== before) { rollback(); return { ok: false, reason: 'stereo' }; }
        return done(-(opt.undo.dx || 0), -(opt.undo.dy || 0));
    }

    flipHaworth(mol, ids, axisY);
    if (rings.length === 1) {
        // 分子まるごと ＝ 相手がいないので、ずらす必要も重なりも無い
        if (_haworthCodes(mol) !== before) { rollback(); return { ok: false, reason: 'stereo' }; }
        return done(0, 0);
    }

    // 刻みは環結合の半分（＝ この作図の置換基の結合長・図の升目）
    let len = 0, cnt = 0;
    rings.forEach(cyc => {
        for (let i = 0; i < cyc.length; i++) {
            const a = mol.atoms.find(x => x.id === cyc[i]);
            const b = mol.atoms.find(x => x.id === cyc[(i + 1) % cyc.length]);
            len += Math.hypot(a.x - b.x, a.y - b.y); cnt++;
        }
    });
    const ringLen = cnt ? len / cnt : 76;
    const unit = ringLen / 2;   // ＝ この作図の置換基の結合長（図の升目）
    // 「離れている」とみなす距離 ＝ **結合1本ぶん**。⚠ 元の作図より厳しくしない
    //   （元が詰まった図なら同じくらい詰まっていれば十分。固定値にすると解の無い図が出る）
    const gap = Math.min(0.9 * unit, clearance0);

    // ① ずらさずに済むならそれを採る。⚠ **図が飛ばないのがいちばん読みやすい**し、
    //    橋の結合の長さも元のまま（軸が橋なので反転しても長さは変わらない）
    if (_haworthClearance(mol, idSet) >= gap && _haworthCodes(mol) === before) return done(0, 0);

    // ② 総当たり。⚠ 立体の検査は高い（1回 40ms 前後）ので、**先に安い条件で絞って
    //    並べ替えてから**当て、当てる回数も打ち切る。橋の長さの小さい順に見るのは、
    //    グリコシド結合が伸びきった絵（実測 335px ＝ 平常の4倍）を避けるため
    const cands = [];
    for (let ky = -6; ky <= 6; ky++) {
        for (let kx = -6; kx <= 6; kx++) {
            if (!kx && !ky) continue;
            const dx = kx * unit, dy = ky * unit;
            moving.forEach(a => { a.x += dx; a.y += dy; });
            const cl = _haworthClearance(mol, idSet);
            const span = _haworthBridgeSpan(mol, idSet);
            moving.forEach(a => { a.x -= dx; a.y -= dy; });
            if (cl >= gap) cands.push({ dx, dy, span, d: Math.hypot(dx, dy) });
        }
    }
    cands.sort((a, b) => (a.span - b.span) || (a.d - b.d));
    for (const c of cands.slice(0, 10)) {
        moving.forEach(a => { a.x += c.dx; a.y += c.dy; });
        // ★ ここが3手目。立体が変わる置き方は1つも採らない ＝ 黙って鏡像に化けない
        if (_haworthCodes(mol) === before) return done(c.dx, c.dy);
        moving.forEach(a => { a.x -= c.dx; a.y -= c.dy; });
    }
    // ③ 重なりが解けなければ**ずらさない**ところへ戻す。⚠ ずらさない置き方（軸＝橋の y）は
    //    二糖4件×2環＝8/8 で立体が保たれることが実測済みなので、ここは安全な逃げ場になる
    if (_haworthCodes(mol) === before) return done(0, 0);
    rollback();
    return { ok: false, reason: 'stereo' };
}

/**
 * 平面に敷いた環の原子まわりの方向スロットを作る（M4c）。
 * 環の隣どうしへ向かう方向は座標から決まっているので、残りをそこから組む:
 *   環の隣が3本（縮合部）… 追加なし
 *   sp2・芳香環 … 3本目は環の外向き（面内）
 *   sp3 … 残り2本は環の面の上下（±z）。どちらに置換基を置くかは
 *          ハース投影の面（面マーク or 縦位置）から決める＝描いた図と一致する
 */
function _ringSlots(mol, atomId, ringIds, pos) {
    const center = mol.atoms.find(a => a.id === atomId);
    const here = pos.get(atomId);
    const nbs = mol.getNeighbors(atomId).filter(n => n.atom.element !== 'H');
    const ringNbs = nbs.filter(n => ringIds.has(n.atom.id) && pos.has(n.atom.id));
    const outNbs = nbs.filter(n => !ringIds.has(n.atom.id));
    const hCount = mol.getFreeValency(atomId);
    if (ringNbs.length < 2) return null;
    const slots = ringNbs.map(n => ({ ref: n.atom.id, isH: false, v: _v3n(_v3sub(pos.get(n.atom.id), here)) }));
    const free = outNbs.map(n => ({ ref: n.atom.id, isH: false, face: _haworthFaceOf(center, n.atom) }));
    for (let i = 0; i < hCount; i++) free.push({ ref: 'H' + i, isH: true, face: 0 });
    if (free.length === 0) return slots;

    const d1 = slots[0].v, d2 = slots[1].v;
    const bis = _v3n([-(d1[0] + d2[0]), -(d1[1] + d2[1]), -(d1[2] + d2[2])]); // 環の外向き（面内）
    if (ringNbs.length >= 3 || free.length === 1) {
        // 縮合部（外向き1本も無い）／sp2・芳香環（外向き1本）は面内の外向きへ
        if (ringNbs.length >= 3) return slots.concat(free.map(f => ({ ref: f.ref, isH: f.isH, v: bis })));
        return slots.concat([{ ref: free[0].ref, isH: free[0].isH, v: bis }]);
    }
    if (free.length !== 2) return null;
    // sp3: 環の面の上下へ。2本のなす角が 109.47° になるよう外向きから ±54.7356° 開く
    const nrm = _v3n(_v3cross(d1, d2)); // 環は z=0 平面なので ±z を向く
    const B = 54.7356 * Math.PI / 180;
    const up = _v3n([bis[0] * Math.cos(B) + nrm[0] * Math.sin(B),
                     bis[1] * Math.cos(B) + nrm[1] * Math.sin(B),
                     bis[2] * Math.cos(B) + nrm[2] * Math.sin(B)]);
    const dn = _v3n([bis[0] * Math.cos(B) - nrm[0] * Math.sin(B),
                     bis[1] * Math.cos(B) - nrm[1] * Math.sin(B),
                     bis[2] * Math.cos(B) - nrm[2] * Math.sin(B)]);
    // z が正の方が「上（手前）＝face +1」。描いた面に合わせて割り当てる
    const plus = up[2] >= dn[2] ? up : dn;
    const minus = up[2] >= dn[2] ? dn : up;
    const sub = free.find(f => !f.isH) || free[0];
    const other = free.find(f => f !== sub);
    const face = sub.face === -1 ? -1 : 1; // 読めないときは上（既定）
    return slots.concat([
        { ref: sub.ref, isH: sub.isH, v: face === 1 ? plus : minus },
        { ref: other.ref, isH: other.isH, v: face === 1 ? minus : plus }
    ]);
}

/**
 * 分子全体の3Dモデルを組む（M4a 非環／M4b シス・トランス／M4c 環）。DOM非依存の純粋ロジック。
 * 返り値は { ok:false, reason } または
 *   { ok:true, nodes:[{kind,atomId,hostId,element,label,v}], bonds:[{a,b,order}], radius }
 * v は結合長1の模型座標。kind は 'atom'（重原子）/'h'（暗黙水素）。
 *
 * 近似（表示に必ず注記すること）: ねじれ角はアンチ固定＝教科書のジグザグに対応する
 * 代表的な形の1つ。結合長は一律。表示専用で判定・命名には一切影響しない。
 */
function buildMolecule3D(mol) {
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    if (heavy.length === 0) return { ok: false, reason: '分子が描かれていません。' };
    // 環（M4c）は「環を平面とみなす」近似で扱う。環の作図はすでに正多角形なので、
    // 描いた2D座標をそのまま平面（z=0）に敷けば結合角も正しい。
    // ただし1つの分子に離れた環系が2つ以上あると、鎖でつないだ先が合わなくなるので対象外
    const ringIds = _ringAtomIds(mol);
    const ringSystems = _ringSystems(mol, ringIds);
    // シス/トランスが意味を持つ C=C（M4b）は、**図から幾何が読み取れるときだけ**扱う。
    // 描き分けられていない図から適当に置くと、描いたものと違う分子を見せてしまう
    const geoMap = readBondGeoFromCoords(mol);
    const unreadable = mol.bonds.some(b =>
        b.type === 2 && _bondGeoRefs(mol, b) && !geoMap[`${b.atomId1}_${b.atomId2}`]);
    if (unreadable) {
        return { ok: false, reason: 'C=C のシス/トランスが図から読み取れません（左の「⇄ シス/トランス整形」で描き分けてから開いてください）。' };
    }

    const parities = Object.assign({}, readAtomParityFromFischer(mol), readRingParityFromHaworth(mol));
    const pos = new Map();      // atomId -> [x,y,z]
    const parentOf = new Map(); // atomId -> 親の atomId
    const dirsOf = new Map();   // atomId -> 回転後のスロット [{ref, isH, v}]
    const hNodes = [];          // { hostId, v }
    const placedPoints = [];    // 既に置いた全原子の座標（ねじれ角の当たり判定用）

    // 連結成分ごとに組み、横に並べる
    const seen = new Set();
    let offsetX = 0;
    for (const start of heavy) {
        if (seen.has(start.id)) continue;
        // まず成分の顔ぶれだけを集める（親はまだ決めない）
        const members = [];
        const flood = [start.id];
        seen.add(start.id);
        while (flood.length) {
            const id = flood.pop();
            members.push(id);
            mol.getNeighbors(id).forEach(n => {
                if (n.atom.element === 'H' || seen.has(n.atom.id)) return;
                seen.add(n.atom.id);
                flood.push(n.atom.id);
            });
        }
        // 環系があれば、まず環の原子を平面（z=0）に敷いてから鎖を生やす（M4c）。
        // 環の作図はすでに正多角形なので、描いた2D座標をそのまま使えば角度も正しい。
        // 環系が2つ以上ある成分は、鎖でつないだ先が合わなくなるので扱わない
        const compRings = ringSystems.filter(sys => sys.some(id => members.includes(id)));
        if (compRings.length > 1) {
            return { ok: false, reason: '環が2つ以上ある分子（環どうしが離れているもの）はまだ対応していません。' };
        }
        let seeds;
        if (compRings.length === 1) {
            const sys = compRings[0];
            const atoms = sys.map(id => mol.atoms.find(a => a.id === id));
            // 環の結合長が1になるよう縮尺を決める
            let sum = 0, cnt = 0;
            mol.bonds.forEach(b => {
                if (!sys.includes(b.atomId1) || !sys.includes(b.atomId2)) return;
                const a1 = mol.atoms.find(a => a.id === b.atomId1);
                const a2 = mol.atoms.find(a => a.id === b.atomId2);
                sum += Math.hypot(a2.x - a1.x, a2.y - a1.y);
                cnt++;
            });
            if (!(sum > 0)) return { ok: false, reason: '環の作図が読み取れませんでした。' };
            const s = cnt / sum;
            const cx = atoms.reduce((t, a) => t + a.x, 0) / atoms.length;
            const cy = atoms.reduce((t, a) => t + a.y, 0) / atoms.length;
            // 単環は**正多角形に組み直す**。作図のハース六角形は遠近を出すために潰してあり、
            // 小さい環も正三角形・正方形ぴったりには描かれていないため、そのまま回すと
            // 結合長がばらばらの模型になる（実測で最大1.8倍の差）。
            // 見た目が変わらないよう、描いた向き（最初の原子の方角と回る向き）は保つ。
            // 縮合環（ナフタレンなど）は作図が正六角形のまま並んでいるので、そのまま使う
            const order = _ringCycleOrder(mol, sys, ringIds);
            if (order) {
                const n = order.length;
                const R = 1 / (2 * Math.sin(Math.PI / n));
                const a0 = mol.atoms.find(a => a.id === order[0]);
                const a1 = mol.atoms.find(a => a.id === order[1]);
                const start = Math.atan2(a0.y - cy, a0.x - cx);
                // 描いた回り方（時計/反時計）に合わせる
                const cross = (a0.x - cx) * (a1.y - cy) - (a0.y - cy) * (a1.x - cx);
                const dir = cross >= 0 ? 1 : -1;
                order.forEach((id, i) => {
                    const th = start + dir * i * 2 * Math.PI / n;
                    const v = [offsetX + R * Math.cos(th), R * Math.sin(th), 0];
                    pos.set(id, v);
                    placedPoints.push(v);
                });
            } else {
                atoms.forEach(a => {
                    const v = [offsetX + (a.x - cx) * s, (a.y - cy) * s, 0];
                    pos.set(a.id, v);
                    placedPoints.push(v);
                });
            }
            seeds = sys.slice();
        } else {
            pos.set(members[0], [offsetX, 0, 0]);
            placedPoints.push(pos.get(members[0]));
            seeds = [members[0]];
        }
        // 置いた原子（環 or 起点）からBFSして、鎖の親子関係を決める
        const comp = seeds.slice();
        const done = new Set(seeds);
        const queue = seeds.slice();
        while (queue.length) {
            const id = queue.shift();
            mol.getNeighbors(id).forEach(n => {
                if (n.atom.element === 'H' || done.has(n.atom.id)) return;
                done.add(n.atom.id);
                parentOf.set(n.atom.id, id);
                comp.push(n.atom.id);
                queue.push(n.atom.id);
            });
        }
        for (const id of comp) {
            // 環の原子は座標が決まっているので、方向は環の形から直接作る（M4c）
            if (ringIds.has(id)) {
                const rs = _ringSlots(mol, id, ringIds, pos);
                if (!rs) return { ok: false, reason: 'この環の立体配置は組み立てられませんでした。' };
                dirsOf.set(id, rs);
                const base = pos.get(id);
                rs.forEach(d => {
                    const L = d.isH ? M3D_H_BOND : 1;
                    const at = [base[0] + d.v[0] * L, base[1] + d.v[1] * L, base[2] + d.v[2] * L];
                    if (d.isH) { hNodes.push({ hostId: id, v: at }); placedPoints.push(at); }
                    else if (!pos.has(d.ref) && parentOf.get(d.ref) === id) {
                        pos.set(d.ref, at);
                        placedPoints.push(at);
                    }
                });
                continue;
            }
            const local = _localDirs(mol, id, parities[id]);
            if (local === null) {
                return { ok: false, reason: 'この分子の立体配置は組み立てられませんでした（配位数が想定外です）。' };
            }
            const p = parentOf.get(id);
            const here0 = pos.get(id);
            let rot = (v) => v;
            if (p !== undefined) {
                const u = _v3n(_v3sub(pos.get(id), pos.get(p))); // 親→自分
                const slot = local.slots.find(d => d.ref === p);
                if (!slot) {
                    return { ok: false, reason: 'この分子の立体配置は組み立てられませんでした（親への結合が見つかりません）。' };
                }
                // 親へ向かうスロットを「親から来た向きの逆」に重ねる。回転は手性を保つ
                const r0 = _alignRot(slot.v, [-u[0], -u[1], -u[2]]);
                // 残る自由度＝結合軸まわりのねじれ角。取りうる向きは化学的に決まった
                // 数通りだけに絞り、そのなかから**既に置いた原子といちばん離れる**ものを選ぶ。
                //   単結合 … ねじれ形の3通り（アンチとその±120°）。同点ならアンチ＝ジグザグ
                //   二重結合 … 面が重なる2通り（ねじれた二重結合は化学的に誤りなので平面性が上位）
                // 総当たりの配座探索はしない（教材の模式図に必要な精度ではない）が、
                // これだけで枝分かれアルカンの枝どうしの衝突は解消する
                const gp = parentOf.get(p);
                const base = gp !== undefined ? _perp(_v3sub(pos.get(gp), pos.get(p)), u) : _anyPerp(u);
                const child = local.slots.find(d => d.ref !== p);
                const cur = child ? _perp(r0(child.v), u) : null;
                let cands = [0];
                if (base && cur) {
                    const sib = (mol.getBond(id, p) || {}).type === 2
                        ? (dirsOf.get(p) || []).find(d => d.ref !== id) : null;
                    const n1 = sib ? _perp(sib.v, u) : null;
                    if (n1) {
                        const tp = _signedAngle(cur, n1, u);
                        cands = [tp, tp + Math.PI];
                    } else {
                        const t0 = _signedAngle(cur, [-base[0], -base[1], -base[2]], u);
                        cands = [t0, t0 + 2 * Math.PI / 3, t0 - 2 * Math.PI / 3];
                    }
                }
                const parentIdx = local.slots.findIndex(d => d.ref === p);
                const freeIdx = local.slots.map((_, i) => i).filter(i => i !== parentIdx);
                // 各候補について、置換基を置く各方向の「空き具合」を測る
                const clearances = cands.map(t => {
                    const rr = (v) => _v3rot(r0(v), u, t);
                    return freeIdx.map(i => {
                        const w = rr(local.slots[i].v);
                        const at = [here0[0] + w[0], here0[1] + w[1], here0[2] + w[2]];
                        let c = Infinity;
                        placedPoints.forEach(q => {
                            if (q === here0 || q === pos.get(p)) return; // 結合で決まっている相手は除く
                            c = Math.min(c, Math.hypot(at[0] - q[0], at[1] - q[1], at[2] - q[2]));
                        });
                        return c;
                    });
                });
                // いちばん窮屈な方向がいちばんマシな候補を選ぶ。同点なら先頭＝アンチ（ジグザグ）
                let bi = 0;
                clearances.forEach((cs, i) => {
                    if (Math.min(...cs) > Math.min(...clearances[bi]) + 1e-6) bi = i;
                });
                let bt = cands[bi];
                // 二重結合のシス/トランス（M4b）: 面が重なる2通りのうち、
                // **描いた図と同じ側**になる方を選ぶ。ここは空き具合より優先する
                // （幾何を取り違えると別の分子を見せることになるため）
                let geoFixed = false;
                const pb = mol.getBond(id, p);
                if (pb && pb.type === 2) {
                    const want = geoMap[`${pb.atomId1}_${pb.atomId2}`];
                    const refs = _bondGeoRefs(mol, pb);
                    if (want && refs) {
                        const nearRef = (p === pb.atomId1) ? refs.refA : refs.refB;
                        const farRef = (p === pb.atomId1) ? refs.refB : refs.refA;
                        const va = pos.has(nearRef) ? _perp(_v3sub(pos.get(nearRef), pos.get(p)), u) : null;
                        const farSlot = local.slots.find(d => d.ref === farRef);
                        if (va && farSlot) {
                            const hit = cands.find(t => {
                                const vb = _perp(_v3rot(r0(farSlot.v), u, t), u);
                                return vb && ((_v3dot(va, vb) > 0) ? 'syn' : 'anti') === want;
                            });
                            if (hit !== undefined) { bt = hit; geoFixed = true; }
                        }
                    }
                }
                rot = (v) => _v3rot(r0(v), u, bt);
                // **不斉中心でない原子では、どの置換基をどの方向に置くかは化学的に自由**
                // （正四面体の4頂点はどれも等価）。そこで「大きい置換基ほど空いている方向へ」
                // 割り当てる。ねじれ角だけでは逃げ切れない枝どうしの重なり
                // （2,4-ジメチルペンタンのメチルどうし＝syn-ペンタン型）はこれで解ける。
                // 不斉中心は入れ替えると手性が変わるので触らない
                // geoFixed のときは入れ替え禁止。2つのスロットを入れ替えると
                // シス⇄トランスが反転してしまう
                if (!local.fixed && !geoFixed && freeIdx.length > 1) {
                    const room = freeIdx
                        .map((slotI, k) => ({ slotI, c: clearances[bi][k] }))
                        .sort((a, b) => b.c - a.c);
                    const load = freeIdx
                        .map(i => ({ ...local.slots[i], size: local.slots[i].isH ? 1 : _subtreeSize(mol, local.slots[i].ref, id) }))
                        .sort((a, b) => b.size - a.size);
                    room.forEach((r, k) => {
                        local.slots[r.slotI].ref = load[k].ref;
                        local.slots[r.slotI].isH = load[k].isH;
                    });
                }
            }
            const placed = local.slots.map(d => ({ ref: d.ref, isH: d.isH, v: rot(d.v) }));
            dirsOf.set(id, placed);
            placed.forEach(d => {
                const L = d.isH ? M3D_H_BOND : 1;
                const at = [here0[0] + d.v[0] * L, here0[1] + d.v[1] * L, here0[2] + d.v[2] * L];
                if (d.isH) { hNodes.push({ hostId: id, v: at }); placedPoints.push(at); }
                else if (!pos.has(d.ref) && parentOf.get(d.ref) === id) {
                    pos.set(d.ref, at);
                    placedPoints.push(at);
                }
            });
        }
        comp.forEach(id => { offsetX = Math.max(offsetX, pos.get(id)[0]); });
        offsetX += 3;
    }

    // 全体を重心中心に寄せてからノード化する（どの向きに回しても中央に収まる）
    const all = [...pos.values(), ...hNodes.map(h => h.v)];
    const c = [0, 1, 2].map(i => all.reduce((s, v) => s + v[i], 0) / all.length);
    const shift = (v) => [v[0] - c[0], v[1] - c[1], v[2] - c[2]];
    const nodes = [];
    const index = new Map();
    heavy.forEach(a => {
        if (!pos.has(a.id)) return;
        index.set(a.id, nodes.length);
        nodes.push({ kind: 'atom', atomId: a.id, hostId: null, element: a.element,
                     label: a.element, v: shift(pos.get(a.id)) });
    });
    const bonds = [];
    mol.bonds.forEach(b => {
        if (!index.has(b.atomId1) || !index.has(b.atomId2)) return;
        bonds.push({ a: index.get(b.atomId1), b: index.get(b.atomId2), order: b.type });
    });
    hNodes.forEach(h => {
        nodes.push({ kind: 'h', atomId: null, hostId: h.hostId, element: 'H', label: 'H', v: shift(h.v) });
        bonds.push({ a: index.get(h.hostId), b: nodes.length - 1, order: 1 });
    });
    let radius = 1;
    nodes.forEach(n => { radius = Math.max(radius, Math.hypot(n.v[0], n.v[1], n.v[2])); });
    return { ok: true, nodes, bonds, radius };
}

if (typeof window !== 'undefined') {
    window.Molecule = Molecule;
    window.Atom = Atom;
    window.Bond = Bond;
    window.VALENCIES = VALENCIES;
    window.getDoubleBondGeometry = getDoubleBondGeometry;
    window.describeStructure = describeStructure;
    window.longestCarbonChain = longestCarbonChain;
    window.canonicalCode = canonicalCode;
    window.canonicalStereoCode = canonicalStereoCode;
    window.computeAtomParity = computeAtomParity;
    window.mirrorStereo = mirrorStereo;
    window.readBondGeoFromCoords = readBondGeoFromCoords;
    window.readAtomParityFromFischer = readAtomParityFromFischer;
    window.isFischerOriented = isFischerOriented;
    window.fischerSlots = fischerSlots;
    window.assignDLDescriptor = assignDLDescriptor;
    window.cipRank = cipRank;
    window.assignRSDescriptor = assignRSDescriptor;
    window.readRingParityFromHaworth = readRingParityFromHaworth;
    // ハース図を「見かけだけ」置き直す2つの操作（上下反転・独楽回転）。鏡映は入れない
    window.canFlipHaworth = canFlipHaworth;
    window.flipHaworth = flipHaworth;
    // 部分反転（片方の環だけを裏返す）の呼び方。⚠ 軸は haworthRingBridge の橋の原子の y
    window.haworthRingSideIds = haworthRingSideIds;
    window.haworthRingBridge = haworthRingBridge;
    window.haworthSpinCycles = haworthSpinCycles;
    window.canSpinHaworthRing = canSpinHaworthRing;
    window.spinHaworthRing = spinHaworthRing;
    // キャンバスの図で環を裏返す（段4-b）。⚠ 環の並べ方は環ビューと共有する
    window.haworthNumberingStart = haworthNumberingStart;
    window.haworthRingSense = haworthRingSense;
    window.orderHaworthRings = orderHaworthRings;
    // ハース図として読む糖の環（名前を言い切ってよいかの門番。`lookupCompoundName` が使う）
    window.haworthSugarCycles = haworthSugarCycles;
    window.haworthFlipPlan = haworthFlipPlan;
    window.haworthCanvasFlip = haworthCanvasFlip;
    // ⇄ 左右に裏返す・⟳ 180°回す（§1-2c の追補。**置換基の付け替え**を伴う描き直し）
    window.haworthBranchRoots = haworthBranchRoots;
    window.haworthTurnPlan = haworthTurnPlan;
    window.haworthTurn = haworthTurn;
    // 糖の炭素番号（🔢 に相乗り）。⚠ 表は持たず、アノマー炭素はグラフから決める
    window.haworthCarbonNumbers = haworthCarbonNumbers;
    window.tetrahedralDirs = tetrahedralDirs;
    window.buildMolecule3D = buildMolecule3D;
    // C=C の基準置換基（テスト・検証ツールが幾何を照合するのに使う）
    window.bondGeoRefs = _bondGeoRefs;
    window.ringAtomIds = _ringAtomIds;
    window.stereoUnitsOf = stereoUnitsOf;
    window.countStereoisomers = countStereoisomers;
    window.stereoFoldReason = stereoFoldReason;
    window.stereoBondKey = stereoBondKey;
    window.parityFromDirs = parityFromDirs;
    window.rootedFragmentCode = rootedFragmentCode;
    window.branchShells = branchShells;
    window.firstDifferingShell = firstDifferingShell;
    window.fragmentFormula = fragmentFormula;
    window.findFunctionalGroups = findFunctionalGroups;
    window.findOutOfScopeMotifs = findOutOfScopeMotifs;
    window.findCondensableGroups = findCondensableGroups;
    window.enumerateConstitutionalIsomers = enumerateConstitutionalIsomers;
    window.enumerateBenzeneRingIsomers = enumerateBenzeneRingIsomers;
    window.benzeneSubUnsaturation = benzeneSubUnsaturation;
    window.BENZENE_REST_MAX = BENZENE_REST_MAX;
    window.BENZENE_SUB_DOU_MAX = BENZENE_SUB_DOU_MAX;
    window.findAromaticBondKeys = findAromaticBondKeys;
    window.isValencyValid = isValencyValid;
    window.maxValencyOf = maxValencyOf;
    window.layoutMolecule = layoutMolecule;
    window.findAnyCycle = findAnyCycle;
    window.findLongestCarbonChain = findLongestCarbonChain;
    window.isomerSeriesKey = isomerSeriesKey;
    window.iupacName = iupacName;
    window.iupacNameDetail = iupacNameDetail;
    window.iupacAlkylGroupName = iupacAlkylGroupName;
    window.iupacAlkylGroupDetail = iupacAlkylGroupDetail;
    window.iupacAlkylNameFromR = iupacAlkylNameFromR;
    window.iupacAlkylDetailFromR = iupacAlkylDetailFromR;
    // 幹の表と数詞の表（名称の説明が幹を「数詞｜段」に塗り分けるために引く。SC 帯が見張る）。
    // ★ 出しているのは**表そのもの**で、割る関数ではない ＝ 画面が名前を切り直す道を作らない
    window.IUPAC_ALKANE_STEM = IUPAC_ALKANE_STEM;
    window.IUPAC_ENE_STEM = IUPAC_ENE_STEM;
    window.IUPAC_YNE_STEM = IUPAC_YNE_STEM;
    window.IUPAC_NUMERAL = IUPAC_NUMERAL;
}
