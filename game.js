/**
 * Game Logic for Chem-Assembler
 * 画面の描画更新、インタラクション、ステージ進行、およびUIイベントを制御します。
 */

// グリッドスナップの設定
const GRID_SIZE = 40;

// ステージ定義
const STAGES = [
    {
        name: "水",
        formula: "H₂O",
        desc: "生命に不可欠な最も基本的な化合物です。酸素原子(O)に2つの水素原子(H)が結合しています。",
        hint: "酸素(O)を1つ配置するだけで、自動的に2つの水素(H)が補完されます。",
        createTarget: () => {
            const m = new Molecule();
            m.addAtom('O', 400, 300);
            // Hは自動的に補完・比較されるため、重原子のみ定義
            return m;
        }
    },
    {
        name: "二酸化炭素",
        formula: "CO₂",
        desc: "温暖化ガスとしても知られる無色無臭の気体。炭素(C)を中心に、両側に酸素(O)がそれぞれ二重結合で結合しています。",
        hint: "Cを中心に、左右のOへ「二重結合」を繋ぎましょう。",
        createTarget: () => {
            const m = new Molecule();
            const c = m.addAtom('C', 400, 300);
            const o1 = m.addAtom('O', 320, 300);
            const o2 = m.addAtom('O', 480, 300);
            m.addBond(c.id, o1.id, 2);
            m.addBond(c.id, o2.id, 2);
            return m;
        }
    },
    {
        name: "エタノール",
        formula: "CH₃CH₂OH",
        desc: "お酒のアルコール成分であり、消毒液としても使われます。2つの炭素(C)が繋がり、その端にヒドロキシ基(-OH)が結合しています。",
        hint: "C - C - O の順に単結合で繋ぎましょう。Hは自動で入ります。官能基パレットの「-OH」を使うこともできます。",
        createTarget: () => {
            const m = new Molecule();
            const c1 = m.addAtom('C', 360, 300);
            const c2 = m.addAtom('C', 440, 300);
            const o = m.addAtom('O', 520, 300);
            m.addBond(c1.id, c2.id, 1);
            m.addBond(c2.id, o.id, 1);
            return m;
        }
    },
    {
        name: "酢酸",
        formula: "CH₃COOH",
        desc: "食酢に含まれる酸味成分。炭素(C)の隣の炭素に、二重結合の酸素(=O)と単結合のヒドロキシ基(-OH)が繋がっています。",
        hint: "カルボキシ基(-COOH)を炭素に繋ぐか、C-Cを繋いだ後、先端のCに=Oと-OHを手動で配置します。",
        createTarget: () => {
            const m = new Molecule();
            const c1 = m.addAtom('C', 360, 300);
            const c2 = m.addAtom('C', 440, 300);
            const o1 = m.addAtom('O', 440, 220); // =O
            const o2 = m.addAtom('O', 520, 300); // -OH
            m.addBond(c1.id, c2.id, 1);
            m.addBond(c2.id, o1.id, 2);
            m.addBond(c2.id, o2.id, 1);
            return m;
        }
    },
    {
        name: "ベンゼン",
        formula: "C₆H₆",
        desc: "代表的な芳香族化合物。6つの炭素(C)が六角形を形成し、単結合と二重結合が交互に配置（共鳴）しています。",
        hint: "「ベンゼン環」モジュールを使って一発配置すると簡単です。",
        createTarget: () => {
            const m = new Molecule();
            const R = 40;
            const cx = 400, cy = 300;
            const cIds = [];
            
            // 6つの炭素を配置
            for (let i = 0; i < 6; i++) {
                const ang = (i * Math.PI) / 3;
                const c = m.addAtom('C', cx + R * Math.cos(ang), cy + R * Math.sin(ang));
                cIds.push(c.id);
            }
            
            // 一重結合と二重結合を交互に繋ぐ
            for (let i = 0; i < 6; i++) {
                const next = (i + 1) % 6;
                const bType = i % 2 === 0 ? 2 : 1;
                m.addBond(cIds[i], cIds[next], bType);
            }
            return m;
        }
    }
];

class Game {
    constructor() {
        this.currentStageIndex = 0;
        this.userMolecule = new Molecule();
        this.selectedTool = 'select'; // 'select', 'bond', 'erase'
        this.selectedBondType = 1;     // 1, 2, 3
        this.selectedAtomType = 'C';   // 'C', 'O', 'N', 'Cl'
        this.selectedModule = null;    // 'benzene', 'oh', 'cooh', 'nh2'
        
        // ドラッグ状態
        this.isDragging = false;
        this.draggedAtom = null;
        this.bondStartAtom = null;
        
        // 履歴スタック (簡易Undo用)
        this.history = [];

        this.initDOMElements();
        this.initEventListeners();
        this.loadStage(0);
    }

    initDOMElements() {
        this.svg = document.getElementById('chem-svg');
        this.atomsGroup = document.getElementById('atoms-group');
        this.bondsGroup = document.getElementById('bonds-group');
        this.uiGroup = document.getElementById('ui-group');
        
        this.coordDisplay = document.getElementById('coord-display');
        this.btnVerify = document.getElementById('btn-verify');
        this.btnClearAll = document.getElementById('btn-clear-all');
        this.stageSelect = document.getElementById('select-stage');
        
        this.targetName = document.getElementById('target-name');
        this.targetFormula = document.getElementById('target-formula');
        this.targetDesc = document.getElementById('target-desc');
        this.verifyResult = document.getElementById('verify-result');
        
        this.winModal = document.getElementById('win-modal');
        this.btnNextStage = document.getElementById('btn-next-stage');
        this.winMolDetails = document.getElementById('win-mol-details');

        // ステージ選択肢の追加
        STAGES.forEach((stage, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${idx + 1}. ${stage.name} (${stage.formula})`;
            this.stageSelect.appendChild(opt);
        });
    }

    initEventListeners() {
        // ツール切替
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedTool = btn.dataset.tool;
                this.selectedModule = null; // モジュール選択を解除
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
            });
        });

        // 結合数切替
        document.querySelectorAll('.bond-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.bond-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedBondType = parseInt(btn.dataset.bond);
                
                // 結合選択をした場合、操作モードを強制的に「結合」にする
                document.getElementById('btn-tool-bond').click();
            });
        });

        // 原子切替
        document.querySelectorAll('.atom-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.atom-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedAtomType = btn.dataset.atom;
                this.selectedModule = null; // モジュール選択を解除
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                
                // 原子選択をした場合、操作モードを強制的に「選択（配置）」にする
                document.getElementById('btn-tool-select').click();
            });
        });

        // 官能基/環モジュール
        document.querySelectorAll('.mod-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const wasActive = btn.classList.contains('active');
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                if (!wasActive) {
                    btn.classList.add('active');
                    this.selectedModule = btn.dataset.module;
                    // モジュール配置時は一時的に選択ツール扱いにする
                    this.selectedTool = 'select';
                    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                    document.getElementById('btn-tool-select').classList.add('active');
                } else {
                    this.selectedModule = null;
                }
            });
        });

        // ステージ変更
        this.stageSelect.addEventListener('change', (e) => {
            this.loadStage(parseInt(e.target.value));
        });

        // アクションボタン
        this.btnVerify.addEventListener('click', () => this.verifyCurrentStructure());
        this.btnClearAll.addEventListener('click', () => {
            this.saveState();
            this.userMolecule = new Molecule();
            this.updateDrawing();
        });

        this.btnNextStage.addEventListener('click', () => {
            this.winModal.classList.add('hidden');
            const nextIdx = (this.currentStageIndex + 1) % STAGES.length;
            this.stageSelect.value = nextIdx;
            this.loadStage(nextIdx);
        });

        // SVGキャンバス上でのインタラクション
        this.svg.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.svg.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // キーボードショートカット (Undo/Redo, ツール切替など)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.key === 'Delete') {
                e.preventDefault();
                if (confirm("すべての原子と結合を消去しますか？")) {
                    this.saveState();
                    this.userMolecule = new Molecule();
                    this.updateDrawing();
                    this.verifyResult.classList.add('hidden');
                }
            }
        });
    }

    saveState() {
        // 簡易ディープコピーによる状態の保存
        const serialized = JSON.stringify({
            atoms: this.userMolecule.atoms,
            bonds: this.userMolecule.bonds
        });
        this.history.push(serialized);
        if (this.history.length > 30) this.history.shift(); // 履歴最大30件
    }

    undo() {
        if (this.history.length === 0) return;
        const previousState = JSON.parse(this.history.pop());
        
        this.userMolecule = new Molecule();
        previousState.atoms.forEach(a => {
            const atom = new Atom(a.id, a.element, a.x, a.y, a.isLocked);
            if (a.benzeneCenter) atom.benzeneCenter = a.benzeneCenter;
            if (a.benzeneAngle !== undefined) atom.benzeneAngle = a.benzeneAngle;
            this.userMolecule.atoms.push(atom);
        });
        previousState.bonds.forEach(b => {
            this.userMolecule.bonds.push(new Bond(b.atomId1, b.atomId2, b.type));
        });
        this.updateDrawing();
        this.verifyResult.classList.add('hidden');
    }

    loadStage(index) {
        this.currentStageIndex = index;
        this.userMolecule = new Molecule();
        this.history = [];
        
        const stage = STAGES[index];
        this.targetName.textContent = stage.name;
        this.targetFormula.textContent = stage.formula;
        this.targetDesc.textContent = stage.desc;
        this.verifyResult.classList.add('hidden');
        
        this.updateDrawing();
    }

    // マウス位置からグリッド座標へのスナップ
    getSnappedCoords(e) {
        const rect = this.svg.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        
        // ビューボックス比率への変換 (viewBox="0 0 800 600"を考慮)
        const scaleX = 800 / rect.width;
        const scaleY = 600 / rect.height;
        const x = rawX * scaleX;
        const y = rawY * scaleY;
        
        // 基本のスナップ座標
        let snapX = Math.round(x / GRID_SIZE) * GRID_SIZE;
        let snapY = Math.round(y / GRID_SIZE) * GRID_SIZE;
        
        // ベンゼン環の延長線上スナップ点の探索
        let bestSnapDist = 20; // 吸着する閾値
        this.userMolecule.atoms.forEach(atom => {
            if (atom.benzeneCenter && atom.benzeneAngle !== undefined) {
                // 延長線上スナップ座標の計算 (頂点から外側に 40px)
                const sx = atom.benzeneCenter.x + 80 * Math.cos(atom.benzeneAngle);
                const sy = atom.benzeneCenter.y + 80 * Math.sin(atom.benzeneAngle);
                
                const dx = sx - x;
                const dy = sy - y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist < bestSnapDist) {
                    // 他にその位置にすでに原子がないか確認
                    const existing = this.findAtomAt(sx, sy, 5);
                    if (!existing) {
                        bestSnapDist = dist;
                        snapX = sx;
                        snapY = sy;
                    }
                }
            }
        });

        // C=C 二重結合からの 120度スナップ点の探索
        this.userMolecule.atoms.forEach(atom => {
            if (atom.element === 'C') {
                const neighbors = this.userMolecule.getNeighbors(atom.id);
                const doubleBondNeighbor = neighbors.find(n => n.type === 2);
                if (doubleBondNeighbor) {
                    // 二重結合の相手への角度
                    const baseAngle = Math.atan2(doubleBondNeighbor.atom.y - atom.y, doubleBondNeighbor.atom.x - atom.x);
                    
                    // 120度外側の2方向
                    const angles = [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3];
                    angles.forEach(ang => {
                        const sx = atom.x + GRID_SIZE * Math.cos(ang);
                        const sy = atom.y + GRID_SIZE * Math.sin(ang);
                        
                        const dx = sx - x;
                        const dy = sy - y;
                        const dist = Math.sqrt(dx*dx + dy*dy);
                        
                        if (dist < bestSnapDist) {
                            const existing = this.findAtomAt(sx, sy, 5);
                            if (!existing) {
                                bestSnapDist = dist;
                                snapX = sx;
                                snapY = sy;
                            }
                        }
                    });
                }
            }
        });
        
        return { x: snapX, y: snapY, rawX: x, rawY: y };
    }

    handleMouseMove(e) {
        const coords = this.getSnappedCoords(e);
        this.coordDisplay.textContent = `X: ${Math.round(coords.rawX)}, Y: ${Math.round(coords.rawY)} (Snap: ${coords.x}, ${coords.y})`;
        
        // 結合線ドラッグ中のプレビュー描画
        if (this.selectedTool === 'bond' && this.isDragging && this.bondStartAtom) {
            this.drawBondPreview(this.bondStartAtom.x, this.bondStartAtom.y, coords.rawX, coords.rawY);
        }
    }

    handleMouseDown(e) {
        const coords = this.getSnappedCoords(e);
        const clickedAtom = this.findAtomAt(coords.rawX, coords.rawY);
        
        if (this.selectedTool === 'select') {
            if (this.selectedModule) {
                // モジュール（官能基/環）配置処理
                this.placeModule(this.selectedModule, coords.x, coords.y, clickedAtom);
                this.selectedModule = null;
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
            } else if (clickedAtom) {
                if (clickedAtom.element === this.selectedAtomType && !clickedAtom.isLocked && !clickedAtom.benzeneCenter) {
                    // 同じ原子種を重ねてクリックした場合は削除 (ベンゼン環モジュールの原子以外)
                    this.saveState();
                    this.userMolecule.removeAtom(clickedAtom.id);
                    this.autoCleanIsolatedAtoms(); // 孤立した原子の自動消去
                    this.updateDrawing();
                } else if (clickedAtom.element !== this.selectedAtomType && !clickedAtom.isLocked) {
                    // 原子の上書き設置
                    this.saveState();
                    clickedAtom.element = this.selectedAtomType;
                    // ベンゼン環属性は上書きされた（Cではなくなった）時点で削除
                    delete clickedAtom.benzeneCenter;
                    delete clickedAtom.benzeneAngle;
                    this.autoConnectAdjacentAtoms();
                    this.updateDrawing();
                } else {
                    // 原子移動ドラッグの開始
                    this.isDragging = true;
                    this.draggedAtom = clickedAtom;
                    this.saveState();
                }
            } else {
                // 空き地をクリックしたら原子を新規配置
                // 孤立配置の禁止：すでに原子があり、既存原子のどれとも隣接しない位置なら配置しない
                if (this.userMolecule.atoms.length > 0 && !this.isNearAnyExistingAtom(coords.x, coords.y)) {
                    return;
                }
                this.saveState();
                this.userMolecule.addAtom(this.selectedAtomType, coords.x, coords.y);
                this.autoConnectAdjacentAtoms();
                this.updateDrawing();
            }
        } else if (this.selectedTool === 'bond') {
            if (clickedAtom) {
                // 結合の描画開始
                this.isDragging = true;
                this.bondStartAtom = clickedAtom;
            }
        } else if (this.selectedTool === 'erase') {
            // 消しゴムツール: 原子または結合を消去
            this.saveState();
            if (clickedAtom) {
                this.userMolecule.removeAtom(clickedAtom.id);
                this.autoCleanIsolatedAtoms();
            } else {
                // 結合線のクリック判定
                const clickedBond = this.findBondAt(coords.rawX, coords.rawY);
                if (clickedBond) {
                    this.userMolecule.removeBond(clickedBond.atomId1, clickedBond.atomId2);
                    this.autoCleanIsolatedAtoms();
                }
            }
            this.updateDrawing();
        }
    }

    handleMouseUp(e) {
        if (!this.isDragging) return;
        
        const coords = this.getSnappedCoords(e);
        
        if (this.selectedTool === 'select' && this.draggedAtom) {
            // 移動ドラッグ終了：スナップ座標に固定
            this.draggedAtom.x = coords.x;
            this.draggedAtom.y = coords.y;
            this.autoConnectAdjacentAtoms();
            this.updateDrawing();
        } else if (this.selectedTool === 'bond' && this.bondStartAtom) {
            const endAtom = this.findAtomAt(coords.rawX, coords.rawY);
            // 別の原子に着地したか
            if (endAtom && endAtom.id !== this.bondStartAtom.id) {
                this.saveState();
                const existing = this.userMolecule.getBond(this.bondStartAtom.id, endAtom.id);
                if (existing) {
                    // すでに結合がある場合は次数をトグル (1 -> 2 -> 3 -> 1)
                    const nextType = (existing.type % 3) + 1;
                    this.userMolecule.addBond(this.bondStartAtom.id, endAtom.id, nextType);
                } else {
                    this.userMolecule.addBond(this.bondStartAtom.id, endAtom.id, this.selectedBondType);
                }
            }
            // プレビュー消去
            this.clearUIOverlay();
        }
        
        this.isDragging = false;
        this.draggedAtom = null;
        this.bondStartAtom = null;
        this.updateDrawing();
    }

    // 座標近くにある原子を取得（クリック可能半径20px）
    findAtomAt(x, y, radius = 16) {
        return this.userMolecule.atoms.find(atom => {
            const dx = atom.x - x;
            const dy = atom.y - y;
            return Math.sqrt(dx*dx + dy*dy) <= radius;
        }) || null;
    }

    // 座標近くにある結合線を取得
    findBondAt(x, y, threshold = 10) {
        return this.userMolecule.bonds.find(bond => {
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return false;
            
            // 点と線分の距離
            const l2 = (a1.x - a2.x)**2 + (a1.y - a2.y)**2;
            if (l2 === 0) return false;
            let t = ((x - a1.x) * (a2.x - a1.x) + (y - a1.y) * (a2.y - a1.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = a1.x + t * (a2.x - a1.x);
            const projY = a1.y + t * (a2.y - a1.y);
            const dist = Math.sqrt((x - projX)**2 + (y - projY)**2);
            return dist <= threshold;
        }) || null;
    }

    // 環・官能基モジュールの配置
    placeModule(moduleType, x, y, clickedAtom) {
        // モジュール配置時の孤立制限チェック
        if (this.userMolecule.atoms.length > 0) {
            let canPlace = false;
            if (moduleType === 'benzene') {
                // ベンゼン環のいずれかの頂点が既存原子に近いか
                const R = 40;
                for (let i = 0; i < 6; i++) {
                    const ang = (i * Math.PI) / 3;
                    const bx = x + R * Math.cos(ang);
                    const by = y + R * Math.sin(ang);
                    if (this.isNearAnyExistingAtom(bx, by)) {
                        canPlace = true;
                        break;
                    }
                }
            } else if (clickedAtom) {
                // 官能基はクリックした原子に結合するため常に配置可能
                canPlace = true;
            }
            if (!canPlace) return; // 孤立した位置なら配置しない
        }

        this.saveState();

        if (moduleType === 'benzene') {
            // ベンゼン環の配置（中心をクリック座標とする）
            const R = 40;
            const newCAtoms = [];
            for (let i = 0; i < 6; i++) {
                const ang = (i * Math.PI) / 3;
                const c = this.userMolecule.addAtom('C', x + R * Math.cos(ang), y + R * Math.sin(ang));
                c.benzeneCenter = { x, y };
                c.benzeneAngle = ang;
                newCAtoms.push(c);
            }
            // 環状に交互に単結合と二重結合を張る
            for (let i = 0; i < 6; i++) {
                const next = (i + 1) % 6;
                const type = i % 2 === 0 ? 2 : 1;
                this.userMolecule.addBond(newCAtoms[i].id, newCAtoms[next].id, type);
            }
        } else if (clickedAtom) {
            // 官能基は「既存の原子をクリックして接続」する
            const baseAtom = clickedAtom;
            
            // 空いている方向を特定する
            const neighbors = this.userMolecule.getNeighbors(baseAtom.id);
            const angles = neighbors.map(n => Math.atan2(n.atom.y - baseAtom.y, n.atom.x - baseAtom.x));
            
            // 空き方向 (デフォルトは右方向＝0ラジアン)
            let targetAng = 0;
            if (angles.length > 0) {
                // 既に接続がある場合、その平均ベクトルの反対側にする
                let sumX = 0, sumY = 0;
                angles.forEach(ang => {
                    sumX += Math.cos(ang);
                    sumY += Math.sin(ang);
                });
                targetAng = Math.atan2(-sumY, -sumX);
                // 90度刻みにスナップさせる
                targetAng = Math.round(targetAng / (Math.PI / 2)) * (Math.PI / 2);
            }

            const dx = GRID_SIZE * Math.cos(targetAng);
            const dy = GRID_SIZE * Math.sin(targetAng);

            if (moduleType === 'oh') {
                // -OH 配置
                const o = this.userMolecule.addAtom('O', baseAtom.x + dx, baseAtom.y + dy);
                this.userMolecule.addBond(baseAtom.id, o.id, 1);
            } else if (moduleType === 'cooh') {
                // -COOH 配置 (C=O と -OH を配置)
                const c = this.userMolecule.addAtom('C', baseAtom.x + dx, baseAtom.y + dy);
                this.userMolecule.addBond(baseAtom.id, c.id, 1);
                
                // Cからさらに枝分かれを伸ばす
                // 進行方向（targetAng）に対して90度曲がった位置に二重結合O、直進方向に単結合OHを配置
                const angO1 = targetAng + Math.PI / 2; // 90度上/左
                const o1 = this.userMolecule.addAtom('O', c.x + GRID_SIZE * Math.cos(angO1), c.y + GRID_SIZE * Math.sin(angO1));
                this.userMolecule.addBond(c.id, o1.id, 2); // C=O (二重結合)

                const o2 = this.userMolecule.addAtom('O', c.x + GRID_SIZE * Math.cos(targetAng), c.y + GRID_SIZE * Math.sin(targetAng));
                this.userMolecule.addBond(c.id, o2.id, 1); // C-OH (単結合)
            } else if (moduleType === 'nh2') {
                // -NH2 配置
                const n = this.userMolecule.addAtom('N', baseAtom.x + dx, baseAtom.y + dy);
                this.userMolecule.addBond(baseAtom.id, n.id, 1);
            }
        } else {
            // 原子が選択されずに空地をクリックした場合は、単に新規にO/Nなどを置いて繋ぐ基礎にするためメッセージ表示
            alert("官能基を結合するには、接続先の既存の原子（Cなど）をクリックしてください。");
        }
        this.autoConnectAdjacentAtoms();
        this.updateDrawing();
    }

    // 結合描画中のプレビュー（一時的な破線表示など）
    drawBondPreview(x1, y1, x2, y2) {
        this.clearUIOverlay();
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'rgba(0, 242, 254, 0.6)');
        line.setAttribute('stroke-width', '4');
        line.setAttribute('stroke-dasharray', '5,5');
        this.uiGroup.appendChild(line);
    }

    clearUIOverlay() {
        this.uiGroup.innerHTML = '';
    }

    // SVG描画の更新
    updateDrawing() {
        this.atomsGroup.innerHTML = '';
        this.bondsGroup.innerHTML = '';
        
        // 1. 結合線の描画
        this.userMolecule.bonds.forEach(bond => {
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return;
            
            this.renderBond(a1.x, a1.y, a2.x, a2.y, bond.type, false, bond);
        });

        // 自動補完水素(H)の計算と描画
        const hydrogens = this.userMolecule.calculateHydrogens();
        hydrogens.forEach(h => {
            // 親重原子との単結合
            const parent = this.userMolecule.atoms.find(a => a.id === h.parentId);
            if (parent) {
                this.renderBond(parent.x, parent.y, h.x, h.y, 1, true); // 水素の結合は常に単結合
            }
            // 水素原子自体の描画
            this.renderAtom(h.id, h.element, h.x, h.y, false);
        });

        // 2. 原子の描画 (水素より手前に描くため最後に行う)
        this.userMolecule.atoms.forEach(atom => {
            this.renderAtom(atom.id, atom.element, atom.x, atom.y, atom.isLocked);
        });
    }

    renderAtom(id, element, x, y, isLocked) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'svg-atom-node');
        group.setAttribute('data-id', id);
        
        // 原子球（背景）
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', element === 'H' ? '10' : '15'); // Hは小さめに描画
        circle.setAttribute('fill', '#0f141c');
        circle.setAttribute('stroke', `var(--color-${element.toLowerCase()})`);
        circle.setAttribute('stroke-width', '2');
        if (isLocked) {
            circle.setAttribute('stroke-dasharray', '3,3');
        }
        
        // 原子文字
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y + (element === 'H' ? 3 : 4)); // 文字の垂直揃え微調整
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'svg-atom-text');
        text.setAttribute('fill', `var(--color-${element.toLowerCase()})`);
        text.style.fontSize = element === 'H' ? '10px' : '13px';
        text.textContent = element;

        group.appendChild(circle);
        group.appendChild(text);
        
        this.atomsGroup.appendChild(group);
    }

    renderBond(x1, y1, x2, y2, type, isHConnection = false, bondObj = null) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len === 0) return;
        
        const ux = dx / len;
        const uy = dy / len;

        // 原子ラベルと重ならないよう、端を少し縮める (重原子は半径15, 水素は半径10)
        const offsetStart = 15;
        const offsetEnd = isHConnection ? 10 : 15;
        
        const sx = x1 + ux * offsetStart;
        const sy = y1 + uy * offsetStart;
        const ex = x2 - ux * offsetEnd;
        const ey = y2 - uy * offsetEnd;

        const strokeColor = isHConnection ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)';

        // 結合線イベントの設定 (水素以外の結合のみ、クリック・ダブルクリックを追加)
        const setupBondEvents = (line, bObj) => {
            line.setAttribute('class', 'svg-bond-line');
            if (isHConnection || !bObj) {
                this.bondsGroup.appendChild(line);
                return;
            }
            
            let clickTimer = null;
            line.addEventListener('click', (e) => {
                e.stopPropagation();
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                    this.handleBondInteraction(bObj, true); // ダブルクリックで切断
                } else {
                    clickTimer = setTimeout(() => {
                        clickTimer = null;
                        this.handleBondInteraction(bObj, false); // シングルクリックで次数トグル
                    }, 220);
                }
            });
            this.bondsGroup.appendChild(line);
        };

        if (type === 1) {
            // 単結合
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', sx);
            line.setAttribute('y1', sy);
            line.setAttribute('x2', ex);
            line.setAttribute('y2', ey);
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-width', '4');
            setupBondEvents(line, bondObj);
        } else if (type === 2) {
            // 二重結合 (平行な2本の線)
            // 法線ベクトル
            const nx = -uy;
            const ny = ux;
            const gap = 3; // 線どうしの隙間

            for (let offset of [-gap, gap]) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', sx + nx * offset);
                line.setAttribute('y1', sy + ny * offset);
                line.setAttribute('x2', ex + nx * offset);
                line.setAttribute('y2', ey + ny * offset);
                line.setAttribute('stroke', strokeColor);
                line.setAttribute('stroke-width', '3');
                setupBondEvents(line, bondObj);
            }
        } else if (type === 3) {
            // 三重結合
            const nx = -uy;
            const ny = ux;
            const gap = 5;

            // 中央、左、右
            const offsets = [-gap, 0, gap];
            offsets.forEach(offset => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', sx + nx * offset);
                line.setAttribute('y1', sy + ny * offset);
                line.setAttribute('x2', ex + nx * offset);
                line.setAttribute('y2', ey + ny * offset);
                line.setAttribute('stroke', strokeColor);
                line.setAttribute('stroke-width', offset === 0 ? '3' : '2');
                setupBondEvents(line, bondObj);
            });
        }
    }

    // 現在組み立てられている分子の検証
    verifyCurrentStructure() {
        const stage = STAGES[this.currentStageIndex];
        const targetMolecule = stage.createTarget();
        
        this.verifyResult.classList.remove('hidden');
        this.verifyResult.className = "result-message animate-pulse";
        this.verifyResult.textContent = "構造判定中...";
        
        // 少し遅延を入れて判定（ゲーム的演出）
        setTimeout(() => {
            const isCorrect = verifyMolecule(this.userMolecule, targetMolecule);
            
            if (isCorrect) {
                this.verifyResult.className = "result-message success";
                this.verifyResult.textContent = "正解です！構造が完全に一致しました！";
                
                // 勝利モーダルの表示
                this.showWinModal(stage);
            } else {
                this.verifyResult.className = "result-message error";
                this.verifyResult.textContent = "不一致です。結合の数や種類、繋がっている原子の順番を確認してください。";
            }
        }, 800);
    }

    showWinModal(stage) {
        this.winMolDetails.innerHTML = `
            <h3>${stage.name}</h3>
            <div class="formula-badge" style="margin:10px auto;">${stage.formula}</div>
            <p>${stage.desc}</p>
        `;
        setTimeout(() => {
            this.winModal.classList.remove('hidden');
        }, 1200);
    }

    // 隣接する重原子どうしを自動で単結合で結ぶ
    autoConnectAdjacentAtoms() {
        const threshold = 45; // 40px (GRID_SIZE) + α の許容範囲
        const atoms = this.userMolecule.atoms;
        
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                const a1 = atoms[i];
                const a2 = atoms[j];
                
                // 水素(H)は自動補完されるため無視
                if (a1.element === 'H' || a2.element === 'H') continue;
                
                const dx = a1.x - a2.x;
                const dy = a1.y - a2.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist <= threshold) {
                    // 既に結合が存在しない場合、単結合(1)を追加する
                    if (!this.userMolecule.getBond(a1.id, a2.id)) {
                        this.userMolecule.addBond(a1.id, a2.id, 1);
                    }
                }
            }
        }
    }

    // 結合のクリック・ダブルクリックインタラクション
    handleBondInteraction(bond, isDoubleClick) {
        if (isDoubleClick) {
            // ダブルクリックで結合の切断（削除）
            this.saveState();
            this.userMolecule.removeBond(bond.atomId1, bond.atomId2);
            this.autoCleanIsolatedAtoms(); // 孤立した原子のクリーンアップ
            this.updateDrawing();
        } else {
            // シングルクリックで結合次数のトグル (1 -> 2 -> 3 -> 1)
            this.saveState();
            bond.type = (bond.type % 3) + 1;
            this.updateDrawing();
        }
    }

    // 接続している重原子がない（孤立した）原子を自動消去
    autoCleanIsolatedAtoms() {
        if (this.userMolecule.atoms.length <= 1) return;
        
        const toRemove = [];
        this.userMolecule.atoms.forEach(atom => {
            if (atom.isLocked) return;
            
            const neighbors = this.userMolecule.getNeighbors(atom.id);
            if (neighbors.length === 0) {
                toRemove.push(atom.id);
            }
        });
        
        if (toRemove.length > 0) {
            toRemove.forEach(id => {
                this.userMolecule.removeAtom(id);
            });
        }
    }

    // 指定された座標の近くに既存の原子があるかチェックする
    isNearAnyExistingAtom(x, y, threshold = 45) {
        return this.userMolecule.atoms.some(atom => {
            const dx = atom.x - x;
            const dy = atom.y - y;
            return Math.sqrt(dx*dx + dy*dy) <= threshold;
        });
    }
}

// 起動
window.addEventListener('DOMContentLoaded', () => {
    window.game = new Game();
});
