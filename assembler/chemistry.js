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
    // N は 4（ニトロ基 N(=O)(-O)- と アンモニウム型）。S は VALENCIES の 6 のままでよい
    // （S=O を持たない硫黄の実際の2価は record() の isValencyValid が落とす）
    const max = elements.map(e => (e === 'N' ? 4 : (VALENCIES[e] || 0)));
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
 * 「1つの原子に、末端の枝だけがぶら下がっている」基だけを対象とし、
 * 環や主鎖の一部は縮約しない（作図の骨格が消えないようにするため）。
 * 返り値: [{ label, anchorId, memberIds }]
 *   anchorId: 分子側の接続点（この原子は残す）
 *   memberIds: 隠して1枚のカードにまとめる原子（anchor から先の枝）
 */
function findCondensableGroups(mol) {
    const groups = [];
    const heavyNb = (id) => mol.getNeighbors(id).filter(n => n.atom.element !== 'H');

    mol.atoms.forEach(a => {
        // ニトロ基 -N(=O)(-O) / スルホ基 -SO₃H: N/S に酸素だけがぶら下がる形
        if (a.element === 'N' || a.element === 'S') {
            const nb = heavyNb(a.id);
            const oxygens = nb.filter(n => n.atom.element === 'O' && heavyNb(n.atom.id).length === 1);
            const others = nb.filter(n => n.atom.element !== 'O');
            if (others.length !== 1) return;
            if (a.element === 'N' && oxygens.length === 2 &&
                oxygens.some(n => n.type === 2) && oxygens.some(n => n.type === 1)) {
                groups.push({ label: 'NO₂', anchorId: others[0].atom.id,
                              memberIds: [a.id, ...oxygens.map(n => n.atom.id)] });
            } else if (a.element === 'S' && oxygens.length === 3) {
                groups.push({ label: 'SO₃H', anchorId: others[0].atom.id,
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
            groups.push({ label: 'COOH', anchorId: carbons[0].atom.id,
                          memberIds: [a.id, dblO[0].atom.id, sglO[0].atom.id] });
        } else if (sglO.length === 0 && carbons.length === 1 && mol.getFreeValency(a.id) >= 1) {
            // アルデヒド基 -CHO（末端）
            groups.push({ label: 'CHO', anchorId: carbons[0].atom.id,
                          memberIds: [a.id, dblO[0].atom.id] });
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
                } else if (oBeyond.length === 1 && oBeyond[0].atom.element === 'Na') {
                    // -C(=O)-O-Na ＝ カルボン酸の塩（けん化の生成物。脂肪酸ナトリウムなら石けん）
                    groups.push({
                        type: 'carboxylate',
                        label: 'カルボン酸の塩（-COONa）',
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
            } else if (carbons.length <= 1) {
                groups.push({ type: 'aldehyde', label: 'アルデヒド基', atomIds: [a.id, doubleO[0].atom.id] });
            } else if (carbons.length === 2) {
                groups.push({ type: 'ketone', label: 'ケトン（カルボニル基）', atomIds: [a.id, doubleO[0].atom.id] });
            }
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
                    groups.push({ type: 'sulfonate', label: 'スルホン酸の塩（-SO₃Na）', atomIds: [...ids, beyond[0].atom.id] });
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
                    const deg = Math.min(3, cNb.filter(n => n.atom.element === 'C').length);
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
            } else if (nb.length >= 1 && nb.every(n => n.type === 1) && mol.getFreeValency(a.id) >= 1) {
                groups.push({ type: 'amino', label: 'アミノ基', atomIds: [a.id] });
            }
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
    const isHetero = (el) => el === 'O' || el === 'N';

    // ニトロ基の N は N-O 結合を持つのが正しい姿なので、ヘテロ原子どうしの検査から外す
    const nitroN = new Set();
    mol.atoms.forEach(a => {
        if (a.element !== 'N') return;
        const nb = heavyNb(a.id);
        if (nb.some(n => n.type === 2 && n.atom.element === 'O') &&
            nb.some(n => n.type === 1 && n.atom.element === 'O')) nitroN.add(a.id);
    });

    // ① ヘテロ原子どうしが直接つながる（-O-O-・N-N・N-O）。過酸化物・ヒドラジン・オキシムなど
    let peroxide = false, heteroBond = false;
    mol.bonds.forEach(b => {
        const a1 = mol.atoms.find(x => x.id === b.atomId1);
        const a2 = mol.atoms.find(x => x.id === b.atomId2);
        if (!a1 || !a2 || !isHetero(a1.element) || !isHetero(a2.element)) return;
        if (nitroN.has(a1.id) || nitroN.has(a2.id)) return;
        if (a1.element === 'O' && a2.element === 'O') peroxide = true;
        else heteroBond = true;
    });
    if (peroxide) motifs.push({ type: 'peroxide', label: '過酸化物（-O-O-）' });
    if (heteroBond) motifs.push({ type: 'hetero_bond', label: 'N-N・N-O のつながり' });

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
 * 正準コード探索の共通コア（P8-2）。
 * 頂点0..n-1、adj[i]=[{j, t}]（tは結合タイプ文字）、labels[i]=原子ラベル。
 * Weisfeiler-Leman型の反復精緻化で同型不変なクラスを割り当てたのち、
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
    let cls = labels.map(l => l);
    for (let iter = 0; iter < n; iter++) {
        const sigs = cls.map((cv, i) =>
            cv + '|' + adj[i].map(e => e.t + ':' + cls[e.j]).sort().join(','));
        const uniq = [...new Set(sigs)].sort();
        const renum = new Map(uniq.map((s, k) => [s, 'c' + k]));
        cls = sigs.map(s => renum.get(s));
    }

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
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    if (heavy.length === 0) return '';
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
 * ハース投影から環sp3不斉中心のパリティを読む（P12-7 M2b / M2c）。
 * DESIGN_stereochemistry.md 11.3・12章の規約:
 *   - 対象は「環に属する」sp3 不斉中心で、環隣接ちょうど2本＋環外の重原子置換基1本
 *     ＋暗黙H1本の標準構成のもの。
 *   - 環隣接2本 → 2D座標そのままの面内ベクトル(z=0)。
 *   - 環外置換基の面(±1)を z に（[0,0,+face]）、暗黙H → 反対面（[0,0,-face]）。
 *   - 面の決め方: (優先) 原子の haworthFace(+1=上/-1=下) が明示されていればそれ。
 *     (M2c) 未指定なら、置換基が環炭素から十分に縦（±25°以内）に描かれていれば
 *     縦位置から導出（画面上=手前+1／下=奥-1）。教科書ハース投影をそのまま描けば読める。
 *     縦から外れる・非標準構成の中心はスキップ（記述子なし）。
 *   - _parityFromDirs でパリティ。
 * フィッシャー（readAtomParityFromFischer・非環）と相互排他（環原子のみを扱う）。
 * 戻り値: { atomId: ±1 }（適格な中心のみ）。
 */
function readRingParityFromHaworth(mol) {
    const out = {};
    const ring = _ringAtomIds(mol);
    const VERT_TOL = Math.cos(25 * Math.PI / 180); // 縦から±25°以内
    mol.atoms.forEach(center => {
        if (center.element !== 'C' || !ring.has(center.id)) return;
        if (!mol.isAsymmetricCarbon(center.id)) return;
        const nbrs = mol.getNeighbors(center.id);
        const ringNbrs = nbrs.filter(n => ring.has(n.atom.id));
        const outHeavy = nbrs.filter(n => !ring.has(n.atom.id) && n.atom.element !== 'H');
        if (ringNbrs.length !== 2 || outHeavy.length !== 1) return; // 標準的な環立体中心のみ
        let face = outHeavy[0].atom.haworthFace;
        if (face !== 1 && face !== -1) {
            // 面マーク未指定 → ハース投影の縦位置から導出（M2c）。
            const sx = outHeavy[0].atom.x - center.x;
            const sy = outHeavy[0].atom.y - center.y;
            const len = Math.hypot(sx, sy);
            if (len < 1e-6 || Math.abs(sy) / len < VERT_TOL) return; // 縦から外れる → スキップ
            face = sy < 0 ? 1 : -1; // 画面yは下が正。上(手前)=+1・下(奥)=-1
        }
        const dirs = [
            { ref: ringNbrs[0].atom.id, v: [ringNbrs[0].atom.x - center.x, ringNbrs[0].atom.y - center.y, 0] },
            { ref: ringNbrs[1].atom.id, v: [ringNbrs[1].atom.x - center.x, ringNbrs[1].atom.y - center.y, 0] },
            { ref: outHeavy[0].atom.id, v: [0, 0, face] },
            { ref: 'H', v: [0, 0, -face] }
        ];
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
        return single.some(n => heavyNbrs(n.atom.id)
            .every(m => m.atom.id === id || m.atom.element === 'Na'));
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
    const heavy = mol.atoms.filter(a => a.element !== 'H');
    if (heavy.length === 0) return '|';
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
        const heavy = mol.atoms.filter(a => a.element !== 'H');
        if (heavy.length === 0) return null;
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
    const i = heavy.filter(a => a.element === 'I').length;
    const s = heavy.filter(a => a.element === 'S').length;
    if (cl) points.push(`塩素 Cl ×${cl}`);
    if (br) points.push(`臭素 Br ×${br}`);
    if (i) points.push(`ヨウ素 I ×${i}`);
    if (s) points.push('硫黄を含む（スルホ基など）');

    return points;
}

// ===== 異性体練習の系統分類（P12-1 M2）。表示・ヒント専用の純粋関数で、検証には使わない =====

// 端点IDの小さい向きに正規化した経路どうしを辞書式比較する（両方向の同一経路を同一視）
function _cmpCarbonPath(a, b) {
    if (a.length === 0 || b.length === 0) return a.length - b.length;
    const na = a[0] <= a[a.length - 1] ? a : a.slice().reverse();
    const nb = b[0] <= b[b.length - 1] ? b : b.slice().reverse();
    const m = Math.min(na.length, nb.length);
    for (let i = 0; i < m; i++) { if (na[i] !== nb[i]) return na[i] - nb[i]; }
    return na.length - nb.length;
}

// 炭素だけの部分グラフでの最長単純パス（＝最長炭素鎖）を原子ID列で返す。
// longestCarbonChain（長さのみ）の経路版。結果は決定的（同長なら端点ID列で一意化）。
// 環を含む分子では最長単純パスを返すが、主鎖の概念は環では別扱い
// （呼び出し側で findAnyCycle により環を検出して分岐する）。
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
    let best = [cIds[0]];
    const path = [];
    const visited = new Set();
    const dfs = (id) => {
        if (path.length > best.length ||
            (path.length === best.length && _cmpCarbonPath(path, best) < 0)) best = path.slice();
        adj.get(id).forEach(n => {
            if (!visited.has(n)) {
                visited.add(n); path.push(n);
                dfs(n);
                path.pop(); visited.delete(n);
            }
        });
    };
    cIds.slice().sort((a, b) => a - b).forEach(s => {
        visited.clear(); visited.add(s); path.length = 0; path.push(s);
        dfs(s);
    });
    return best;
}

// 異性体を系統分類するキー（表示の系統順ソートと、ヒントの系列内訳・書き出し手順に使う）。
// 返り値: {
//   funcType, funcRank,   官能基カテゴリ（第一ソートキー）
//   cyclic, chainLen,     環の有無・主鎖（最長炭素鎖）長／環では総炭素数
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
                // -OH のついた主鎖炭素の位置
                for (const a of cAtoms) {
                    if (!posMap.has(a.id)) continue;
                    const hasOH = mol.getNeighbors(a.id).some(n => n.atom.element === 'O' &&
                        n.type === 1 && mol.getFreeValency(n.atom.id) >= 1 &&
                        mol.getNeighbors(n.atom.id).filter(m => m.atom.element !== 'H').length === 1);
                    if (hasOH) return posMap.get(a.id);
                }
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
function _iupacAssemble(stem, subs, omitLocants) {
    if (!stem) return null;
    const byName = new Map();
    subs.forEach(s => {
        if (!byName.has(s.name)) byName.set(s.name, { key: s.key, locs: [] });
        byName.get(s.name).locs.push(s.loc);
    });
    const groups = [...byName.entries()].map(([name, g]) => ({ name, key: g.key, locs: g.locs.slice().sort((a, b) => a - b) }));
    // アルファベット順（倍数接頭辞は無視＝name基準のkeyで比較）
    groups.sort((a, b) => a.key.localeCompare(b.key) || a.name.localeCompare(b.name));
    const part = groups.map(g => {
        const body = (IUPAC_MULT[g.locs.length] || '') + g.name;
        return omitLocants ? body : `${g.locs.join(',')}-${body}`;
    }).join(omitLocants ? '' : '-');
    // 幹が位置番号（数字）で始まる場合（例: 2-ブテン）は、置換基部との間にハイフンを入れる
    const sep = (part && /^\d/.test(stem)) ? '-' : '';
    return part + sep + stem;
}

// 炭素ペアのキー（結合次数の参照用）
function _iupacCKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

// 不飽和の接尾辞つき幹を作る。eneLocs/yneLocs=昇順の位置番号配列、n=主鎖炭素数。
// 例: (4,[2],[]) → "2-ブテン"、(3,[1],[]) → "プロペン"（位置省略）、(4,[1,3],[]) → "1,3-ブタジエン"、
// (4,[],[2]) → "2-ブチン"。エン・イン混在（エンイン）は未対応で null
function _iupacUnsatCore(n, eneLocs, yneLocs) {
    const e = eneLocs.length, y = yneLocs.length;
    if (e === 0 && y === 0) return IUPAC_ALKANE_STEM[n] ? IUPAC_ALKANE_STEM[n] + 'ン' : null;
    const omit = (e + y === 1) && n <= 3; // 二重/三重結合の位置が一意なら省略（エテン・プロペン・エチン・プロピン）
    if (y === 0) {
        if (e === 1) { const s = IUPAC_ENE_STEM[n]; return s ? (omit ? '' : eneLocs[0] + '-') + s + 'ン' : null; }
        return IUPAC_ALKANE_STEM[n] ? eneLocs.join(',') + '-' + IUPAC_ALKANE_STEM[n] + (IUPAC_MULT[e] || '') + 'エン' : null;
    }
    if (e === 0) {
        if (y === 1) { const s = IUPAC_YNE_STEM[n]; return s ? (omit ? '' : yneLocs[0] + '-') + s + 'ン' : null; }
        return IUPAC_ALKANE_STEM[n] ? yneLocs.join(',') + '-' + IUPAC_ALKANE_STEM[n] + (IUPAC_MULT[y] || '') + 'イン' : null;
    }
    return null; // エンイン混在は未対応
}

const _iupacSortNum = arr => arr.slice().sort((a, b) => a - b);

// アルコール（-オール）の接尾辞つき幹。olLocs=昇順のOH位置番号。飽和のみ対応（不飽和アルコールは呼び出し側で除外）。
// 例: (1,[]) は該当なし、(2,[1])→"エタノール"（省略）、(3,[1])→"1-プロパノール"、(2,[1,2])→"1,2-エタンジオール"
function _iupacOlCore(n, olLocs) {
    const k = olLocs.length;
    const stem = IUPAC_ALKANE_STEM[n];
    if (!k || !stem) return null;
    if (k === 1) {
        const omit = n <= 2; // メタノール・エタノールは位置が一意なので省略
        return (omit ? '' : olLocs[0] + '-') + stem + 'ノール';
    }
    return olLocs.join(',') + '-' + stem + 'ン' + (IUPAC_MULT[k] || '') + 'オール';
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
            subs.push({ loc: idx + 1, name: g.name, key: g.key });
        }
        (haloAdj.get(cid) || []).forEach(h => subs.push({ loc: idx + 1, name: h, key: IUPAC_SORTKEY[h] }));
    }
    return subs;
}

// アルキル基（置換基）の命名。adj=炭素隣接Map、haloAdj=炭素→ハロゲン名配列、
// root=付け根（この基のC1）、blocked=辿ってはいけない炭素集合（親側）。
// 返り値 {name, key} または null。分岐・ハロゲンを再帰処理し、慣用名があれば置き換える
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
    let best = null;
    cands.forEach(chain => {
        if (!IUPAC_YL_STEM[chain.length]) return;
        const subs = _iupacCollectSubs(subAdj, haloAdj, chain);
        if (subs === null) return;
        const nm = _iupacAssemble(IUPAC_YL_STEM[chain.length], subs);
        const locs = subs.map(s => s.loc).sort((a, b) => a - b);
        if (!best || _iupacCmpLocants(locs, best.locs) < 0 ||
            (_iupacCmpLocants(locs, best.locs) === 0 && nm.localeCompare(best.nm) < 0)) best = { nm, locs };
    });
    if (!best) return null;
    const name = IUPAC_RETAINED[best.nm] || best.nm;
    const key = IUPAC_SORTKEY[name] || IUPAC_SORTKEY[best.nm] || name;
    return { name, key };
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

// 分子を非環式アルキル基として命名する（root を付け根＝C1 とみなす）。アルキル基の書き出し練習・デバッグ用。
// 付け根マーカー R は無視する（H と同様に炭素骨格には含めない）
function iupacAlkylGroupName(mol, rootId) {
    const cs = mol.atoms.filter(a => a.element === 'C');
    if (!cs.length || mol.bonds.some(b => b.type !== 1)) return null;
    if (mol.atoms.some(a => a.element !== 'C' && a.element !== 'H' && a.element !== 'R' && !IUPAC_HALOGEN[a.element])) return null;
    const adj = new Map(cs.map(a => [a.id, []]));
    mol.bonds.forEach(b => { if (adj.has(b.atomId1) && adj.has(b.atomId2)) { adj.get(b.atomId1).push(b.atomId2); adj.get(b.atomId2).push(b.atomId1); } });
    if (!adj.has(rootId)) return null;
    const r = iupacAlkylName(adj, _iupacHaloAdj(mol, cs.map(a => a.id)), rootId, new Set());
    return r ? r.name : null;
}

// 付け根マーカー R が付いた分子をアルキル基として命名する（R に結合した炭素を C1 とみなす）
function iupacAlkylNameFromR(mol) {
    const rAtoms = mol.atoms.filter(a => a.element === 'R');
    if (rAtoms.length !== 1) return null;
    const cNb = mol.getNeighbors(rAtoms[0].id).filter(n => n.atom.element === 'C');
    if (cNb.length !== 1) return null;
    return iupacAlkylGroupName(mol, cNb[0].atom.id);
}

// エーテル R-O-R' を慣用名「ジアルキルエーテル／アルキルアルキルエーテル」で命名する（高校の流儀）。
// oId=エーテルの酸素。両側のアルキル基が命名できなければ null
function _iupacEtherName(adj, haloAdj, mol, oId) {
    const cNb = mol.getNeighbors(oId).filter(n => n.atom.element === 'C');
    if (cNb.length !== 2) return null;
    const g1 = iupacAlkylName(adj, haloAdj, cNb[0].atom.id, new Set());
    const g2 = iupacAlkylName(adj, haloAdj, cNb[1].atom.id, new Set());
    if (!g1 || !g2) return null;
    if (g1.name === g2.name) return 'ジ' + g1.name + 'エーテル';
    const [a, b] = g1.key.localeCompare(g2.key) <= 0 ? [g1, g2] : [g2, g1];
    return a.name + b.name + 'エーテル';
}

// 非環式の炭化水素（アルカン・アルケン・アルキン）・ハロゲン化物・アルコール・エーテルの IUPAC 系統名。対応外は null
function iupacName(mol) {
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
    if (oxygens.length && hasMultiple) return null;      // 不飽和アルコール／不飽和エーテルは未対応
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
    if (etherCount === 1) return _iupacEtherName(adj, haloAdj, mol, oxygens.find(o => mol.getNeighbors(o.id).filter(n => n.atom.element === 'C').length === 2).id);

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
    return named[0].name;
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
        return { subs, eneLocs, yneLocs, olLocs };
    };
    const f = evalDir(chain), r = evalDir(chain.slice().reverse());
    if (!f || !r) return null;
    const subLocs = d => d.subs.map(x => x.loc).sort((a, b) => a - b);
    let d;
    const cOl = _iupacCmpLocants(_iupacSortNum(f.olLocs), _iupacSortNum(r.olLocs));
    const cUn = _iupacCmpLocants(_iupacSortNum(f.eneLocs.concat(f.yneLocs)), _iupacSortNum(r.eneLocs.concat(r.yneLocs)));
    const cEne = _iupacCmpLocants(_iupacSortNum(f.eneLocs), _iupacSortNum(r.eneLocs));
    const cSub = _iupacCmpLocants(subLocs(f), subLocs(r));
    if (cOl !== 0) d = cOl < 0 ? f : r;
    else if (cUn !== 0) d = cUn < 0 ? f : r;
    else if (cEne !== 0) d = cEne < 0 ? f : r;
    else if (cSub !== 0) d = cSub < 0 ? f : r;
    else {
        const seq = s => s.subs.slice().sort((a, b) => a.key.localeCompare(b.key) || a.loc - b.loc).map(x => x.loc);
        const ff = seq(f), rr = seq(r); d = f;
        for (let i = 0; i < ff.length; i++) { if (ff[i] !== rr[i]) { d = ff[i] < rr[i] ? f : r; break; } }
    }
    const eL = _iupacSortNum(d.eneLocs), yL = _iupacSortNum(d.yneLocs), oL = _iupacSortNum(d.olLocs);
    const core = hasOh ? _iupacOlCore(n, oL) : _iupacUnsatCore(n, eL, yL);
    if (!core) return null;
    const name = _iupacAssemble(core, d.subs, n === 1 && !hasOh); // メタン系ハロゲン化物のみ置換基位置を省略
    if (!name) return null;
    return { name, subCount: d.subs.length, olLocs: oL, unsat: _iupacSortNum(eL.concat(yL)), locants: subLocs(d) };
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
    window.tetrahedralDirs = tetrahedralDirs;
    window.buildMolecule3D = buildMolecule3D;
    // C=C の基準置換基（テスト・検証ツールが幾何を照合するのに使う）
    window.bondGeoRefs = _bondGeoRefs;
    window.ringAtomIds = _ringAtomIds;
    window.stereoUnitsOf = stereoUnitsOf;
    window.countStereoisomers = countStereoisomers;
    window.parityFromDirs = parityFromDirs;
    window.rootedFragmentCode = rootedFragmentCode;
    window.branchShells = branchShells;
    window.firstDifferingShell = firstDifferingShell;
    window.fragmentFormula = fragmentFormula;
    window.findFunctionalGroups = findFunctionalGroups;
    window.findOutOfScopeMotifs = findOutOfScopeMotifs;
    window.findCondensableGroups = findCondensableGroups;
    window.enumerateConstitutionalIsomers = enumerateConstitutionalIsomers;
    window.isValencyValid = isValencyValid;
    window.maxValencyOf = maxValencyOf;
    window.layoutMolecule = layoutMolecule;
    window.findAnyCycle = findAnyCycle;
    window.findLongestCarbonChain = findLongestCarbonChain;
    window.isomerSeriesKey = isomerSeriesKey;
    window.iupacName = iupacName;
    window.iupacAlkylGroupName = iupacAlkylGroupName;
    window.iupacAlkylNameFromR = iupacAlkylNameFromR;
}
