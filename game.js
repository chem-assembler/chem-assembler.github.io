/**
 * Game Logic for Chem-Assembler
 * 画面の描画更新、インタラクション、ステージ進行、およびUIイベントを制御します。
 */

// グリッドスナップの設定
const GRID_SIZE = 42;

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
    },
    {
        name: "乳酸",
        formula: "CH₃CH(OH)COOH",
        desc: "運動時の疲労物質や、ヨーグルトなどの乳製品に含まれる酸味成分。中心の炭素(C)は4つの異なる原子団（H、CH₃、OH、COOH）と結合しており、不斉炭素原子となっています。",
        hint: "中心のCから、左にC(メチル基)、上にO(ヒドロキシ基)、右にC(カルボキシ基)を単結合で伸ばします。さらに右のCには上に=O、右に-OHを配置します。",
        createTarget: () => {
            const m = new Molecule();
            const c1 = m.addAtom('C', 400, 300); // 不斉炭素
            const c2 = m.addAtom('C', 358, 300); // メチル基
            const o1 = m.addAtom('O', 400, 258); // ヒドロキシ基
            const c3 = m.addAtom('C', 442, 300); // カルボキシ基炭素
            const o2 = m.addAtom('O', 442, 258); // カルボキシ基 =O
            const o3 = m.addAtom('O', 484, 300); // カルボキシ基 -OH

            m.addBond(c1.id, c2.id, 1);
            m.addBond(c1.id, o1.id, 1);
            m.addBond(c1.id, c3.id, 1);
            m.addBond(c3.id, o2.id, 2);
            m.addBond(c3.id, o3.id, 1);
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
        this.asymmetricMode = false;   // 不斉炭素マークモードが ON かどうか
        
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

        // 正解の例示・不斉炭素関連のDOM要素
        this.btnShowTarget = document.getElementById('btn-show-target');
        this.btnCloseTarget = document.getElementById('btn-close-target');
        this.targetModal = document.getElementById('target-modal');
        this.checkAsymmetricMode = document.getElementById('check-asymmetric-mode');
        this.targetBonds = document.getElementById('target-bonds');
        this.targetAtoms = document.getElementById('target-atoms');
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
            this.fitCanvasToTarget();
            this.updateDrawing();
        });

        this.btnNextStage.addEventListener('click', () => {
            this.winModal.classList.add('hidden');
            const nextIdx = (this.currentStageIndex + 1) % STAGES.length;
            this.stageSelect.value = nextIdx;
            this.loadStage(nextIdx);
        });

        // 不斉炭素マークモードのON/OFF切り替え
        this.checkAsymmetricMode.addEventListener('change', (e) => {
            this.asymmetricMode = e.target.checked;
            this.clearUIOverlay();
            this.updateDrawing();
        });

        // お手本モーダルの表示
        this.btnShowTarget.addEventListener('click', () => {
            this.renderTargetAnswer();
            this.targetModal.classList.remove('hidden');
        });

        this.btnCloseTarget.addEventListener('click', () => {
            this.targetModal.classList.add('hidden');
        });

        // SVGキャンバス上でのインタラクション
        this.svg.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.svg.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.svg.addEventListener('mouseleave', () => this.clearUIOverlay());
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
                    this.fitCanvasToTarget();
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
            bonds: this.userMolecule.bonds,
            deletedBonds: this.userMolecule.deletedBonds
        });
        this.history.push(serialized);
        if (this.history.length > 30) this.history.shift(); // 履歴最大30件
    }

    undo() {
        if (this.history.length === 0) return;
        const previousState = JSON.parse(this.history.pop());
        
        this.userMolecule = new Molecule();
        if (previousState.deletedBonds) {
            this.userMolecule.deletedBonds = previousState.deletedBonds;
        }
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
        
        // 不斉炭素モードを解除・チェックボックスをOFFに初期化
        this.asymmetricMode = false;
        if (this.checkAsymmetricMode) {
            this.checkAsymmetricMode.checked = false;
        }

        const stage = STAGES[index];
        this.targetName.textContent = stage.name;
        this.targetFormula.textContent = stage.formula;
        this.targetDesc.textContent = stage.desc;
        this.verifyResult.classList.add('hidden');
        
        this.fitCanvasToTarget(); // ステージのターゲットサイズに自動フィット
        this.updateDrawing();
    }

    // マウス位置からグリッド座標へのスナップ (増築可能交点へのマグネット吸着)
    getSnappedCoords(e) {
        const rect = this.svg.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        
        // 現在の viewBox 値を動的に取得して正確にスケール＆オフセット変換
        const viewBox = this.svg.viewBox.baseVal;
        const vx = viewBox.x;
        const vy = viewBox.y;
        const vw = viewBox.width;
        const vh = viewBox.height;
        
        const scaleX = vw / rect.width;
        const scaleY = vh / rect.height;
        const x = vx + rawX * scaleX;
        const y = vy + rawY * scaleY;
        
        // 1. 初回の配置（キャンバスにまだ重原子がない場合）
        const heavyAtoms = this.userMolecule.atoms.filter(a => a.element !== 'H');
        if (heavyAtoms.length === 0) {
            const snapX = Math.round(x / GRID_SIZE) * GRID_SIZE;
            const snapY = Math.round(y / GRID_SIZE) * GRID_SIZE;
            return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: true };
        }
        
        // 2. すでに原子がある場合：接続可能な「正規の増築可能座標」をすべてリストアップ
        const validCoords = [];
        this.userMolecule.atoms.forEach(atom => {
            if (atom.element === 'H') return;
            
            // 接続元の原子に空き結合手がある場合のみ、周りに接続可能
            if (this.userMolecule.getFreeValency(atom.id) < 1) return;

            const dirs = [];

            // ベンゼン環の炭素、または C=C 二重結合を持つ炭素であるかの判定
            const isBenzeneAtom = !!(atom.benzeneCenter && atom.benzeneAngle !== undefined);
            
            let isDoubleBondC = false;
            let dbNeighbor = null;
            if (atom.element === 'C') {
                const neighbors = this.userMolecule.getNeighbors(atom.id);
                dbNeighbor = neighbors.find(n => n.atom.element === 'C' && n.type === 2);
                if (dbNeighbor) {
                    isDoubleBondC = true;
                }
            }

            if (isBenzeneAtom) {
                // 【ベンゼン環炭素】ベンゼン環の外側への延長線上スナップガイド点のみ追加 (直角4方向は追加しない)
                dirs.push({
                    x: atom.benzeneCenter.x + (GRID_SIZE * 1.666) * Math.cos(atom.benzeneAngle),
                    y: atom.benzeneCenter.y + (GRID_SIZE * 1.666) * Math.sin(atom.benzeneAngle)
                });
            } else if (isDoubleBondC && dbNeighbor) {
                // 【C=C二重結合炭素】二重結合の相手から120度外側の2方向のみ追加 (直角4方向は追加しない)
                const baseAngle = Math.atan2(dbNeighbor.atom.y - atom.y, dbNeighbor.atom.x - atom.x);
                const angles = [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3];
                angles.forEach(ang => {
                    dirs.push({
                        x: atom.x + GRID_SIZE * Math.cos(ang),
                        y: atom.y + GRID_SIZE * Math.sin(ang)
                    });
                });
            } else {
                // 【通常の原子 (sp3炭素など)】水平・垂直方向の GRID_SIZE 離れた4交点
                dirs.push(
                    { x: atom.x + GRID_SIZE, y: atom.y },
                    { x: atom.x - GRID_SIZE, y: atom.y },
                    { x: atom.x, y: atom.y + GRID_SIZE },
                    { x: atom.x, y: atom.y - GRID_SIZE }
                );
            }

            // すでに他の重原子が置かれている座標は除外
            dirs.forEach(pt => {
                const existing = this.findAtomAt(pt.x, pt.y, 8);
                if (!existing) {
                    validCoords.push(pt);
                }
            });
        });

        // マウス座標に最も近い有効な座標を探す
        let bestCoord = null;
        let minDistance = 35; // スナップ吸着しきい値 (35px以内ならマグネット吸着)

        validCoords.forEach(pt => {
            const dx = pt.x - x;
            const dy = pt.y - y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < minDistance) {
                minDistance = dist;
                bestCoord = pt;
            }
        });

        if (bestCoord) {
            // スナップ可能な点が見つかった
            return { x: bestCoord.x, y: bestCoord.y, rawX: x, rawY: y, isValid: true };
        } else {
            // 範囲外：配置不可（吸着せず基本グリッドを返すが isValid = false）
            const snapX = Math.round(x / GRID_SIZE) * GRID_SIZE;
            const snapY = Math.round(y / GRID_SIZE) * GRID_SIZE;
            return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: false };
        }
    }

    handleMouseMove(e) {
        const coords = this.getSnappedCoords(e);
        this.coordDisplay.textContent = `X: ${Math.round(coords.rawX)}, Y: ${Math.round(coords.rawY)} (Snap: ${coords.x}, ${coords.y})`;
        
        // 1. 結合線ドラッグ中のプレビュー描画
        if (this.selectedTool === 'bond' && this.isDragging && this.bondStartAtom) {
            this.drawBondPreview(this.bondStartAtom.x, this.bondStartAtom.y, coords.rawX, coords.rawY);
        }
        // 2. 原子配置モード（ツールが 'select' かつ モジュールが選択されていない、かつ ドラッグ移動中でない、かつ マウスの下に既存原子がない）
        else if (this.selectedTool === 'select' && !this.selectedModule && !this.isDragging) {
            const clickedAtom = this.findAtomAt(coords.rawX, coords.rawY);
            
            if (!clickedAtom && coords.isValid) {
                // 最も近い親原子を探してプレビューに繋ぐ結合を描く
                const nearest = this.findNearestAtom(coords.x, coords.y);
                const parentAtom = nearest ? nearest.atom : null;
                this.drawAtomPreview(this.selectedAtomType, coords.x, coords.y, parentAtom);
            } else {
                // 有効な位置でない、または既存アトムの上ならプレビューを消去
                this.clearUIOverlay();
            }
        }
    }

    handleMouseDown(e) {
        const coords = this.getSnappedCoords(e);
        const clickedAtom = this.findAtomAt(coords.rawX, coords.rawY);
        
        // --- 不斉炭素マークモード (ON) 時の特別処理 ---
        if (this.asymmetricMode) {
            if (clickedAtom && clickedAtom.element === 'C') {
                this.saveState();
                clickedAtom.isAsymmetricMarked = !clickedAtom.isAsymmetricMarked;
                this.updateDrawing();
            }
            return; // 不斉マークモード時は他の配置/編集動作を完全にブロック
        }

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
                    this.autoLayoutBonds();
                    this.updateDrawing();
                } else {
                    // 【最新ルール】別元素への直接上書きを廃止。異なる元素またはロックされた原子をクリックした場合は移動ドラッグを開始
                    this.isDragging = true;
                    this.draggedAtom = clickedAtom;
                    this.saveState();
                }
            } else {
                // 空き地をクリックしたら原子を新規配置 (有効な増築点であればサイレントに配置)
                if (coords.isValid) {
                    this.saveState();
                    this.userMolecule.addAtom(this.selectedAtomType, coords.x, coords.y);
                    this.autoConnectAdjacentAtoms();
                    this.autoLayoutBonds();
                    this.updateDrawing();
                }
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
            this.autoLayoutBonds();
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
            this.autoLayoutBonds();
            this.updateDrawing();
        } else if (this.selectedTool === 'bond' && this.bondStartAtom) {
            const endAtom = this.findAtomAt(coords.rawX, coords.rawY);
            // 別の原子に着地したか
            if (endAtom && endAtom.id !== this.bondStartAtom.id) {
                const existing = this.userMolecule.getBond(this.bondStartAtom.id, endAtom.id);
                if (existing) {
                    const maxType = this.getMaxBondType(this.bondStartAtom.element, endAtom.element);
                    if (maxType > 1) {
                        const currentType = Number(existing.type) || 1;
                        let nextType = currentType;
                        let found = false;

                        for (let i = 1; i <= maxType; i++) {
                            let testType = currentType + i;
                            if (testType > maxType) {
                                testType = 1;
                            }
                            if (testType === currentType) break;

                            const diff = testType - currentType;
                            const free1 = this.userMolecule.getFreeValency(this.bondStartAtom.id);
                            const free2 = this.userMolecule.getFreeValency(endAtom.id);

                            if (diff <= 0 || (free1 >= diff && free2 >= diff)) {
                                nextType = testType;
                                found = true;
                                break;
                            }
                        }

                        if (found && nextType !== currentType) {
                            this.saveState();
                            this.userMolecule.addBond(this.bondStartAtom.id, endAtom.id, nextType);
                        }
                    }
                } else {
                    // 新規結合を結ぶのに十分な空き結合手があるかチェック
                    // 選択された結合次数がそもそも両原子の限界を超えていないかもチェック
                    const maxType = this.getMaxBondType(this.bondStartAtom.element, endAtom.element);
                    const reqType = Math.min(this.selectedBondType, maxType);
                    if (this.userMolecule.getFreeValency(this.bondStartAtom.id) >= reqType && this.userMolecule.getFreeValency(endAtom.id) >= reqType) {
                        this.saveState();
                        this.userMolecule.addBond(this.bondStartAtom.id, endAtom.id, reqType);
                    }
                }
            }
            // プレビュー消去
            this.clearUIOverlay();
        }
        
        this.isDragging = false;
        this.draggedAtom = null;
        this.bondStartAtom = null;
        this.autoLayoutBonds();
        this.updateDrawing();
    }

    // 座標近くにある原子を取得（クリック判定半径は広めの28px）
    findAtomAt(x, y, radius = 28) {
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
            if (moduleType === 'benzene' || moduleType === 'cyclopentane' || moduleType === 'cyclohexane') {
                // 環モジュールのいずれかの頂点が既存原子に近いか
                let R = GRID_SIZE * 0.833;
                let count = 6;
                if (moduleType === 'cyclopentane') {
                    R = GRID_SIZE * 0.85;
                    count = 5;
                } else if (moduleType === 'cyclohexane') {
                    R = GRID_SIZE;
                    count = 6;
                }
                for (let i = 0; i < count; i++) {
                    let ang;
                    if (moduleType === 'benzene') {
                        ang = (i * Math.PI) / 3;
                    } else if (moduleType === 'cyclohexane') {
                        ang = (i * Math.PI) / 3 - Math.PI / 2;
                    } else {
                        ang = i * (2 * Math.PI / 5) - Math.PI / 2;
                    }
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

        if (moduleType === 'benzene' || moduleType === 'cyclopentane' || moduleType === 'cyclohexane') {
            // 環モジュールの配置
            let R = GRID_SIZE * 0.833;
            let count = 6;
            if (moduleType === 'cyclopentane') {
                R = GRID_SIZE * 0.85;
                count = 5;
            } else if (moduleType === 'cyclohexane') {
                R = GRID_SIZE;
                count = 6;
            }

            const newCAtoms = [];
            for (let i = 0; i < count; i++) {
                let ang;
                if (moduleType === 'benzene') {
                    ang = (i * Math.PI) / 3;
                } else if (moduleType === 'cyclohexane') {
                    ang = (i * Math.PI) / 3 - Math.PI / 2;
                } else {
                    ang = i * (2 * Math.PI / 5) - Math.PI / 2;
                }
                const c = this.userMolecule.addAtom('C', x + R * Math.cos(ang), y + R * Math.sin(ang));
                if (moduleType === 'benzene') {
                    c.benzeneCenter = { x, y };
                    c.benzeneAngle = ang;
                }
                newCAtoms.push(c);
            }
            // 環状に結合を張る
            for (let i = 0; i < count; i++) {
                const next = (i + 1) % count;
                const type = (moduleType === 'benzene' && i % 2 === 0) ? 2 : 1;
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
        this.autoLayoutBonds();
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

    // 原子配置プレビュー（半透明の丸と元素記号、および結合線の表示）
    drawAtomPreview(element, x, y, parentAtom) {
        this.clearUIOverlay();

        // 1. 親原子がある場合、そこからのプレビュー結合線を描画 (半透明)
        if (parentAtom) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const dx = x - parentAtom.x;
            const dy = y - parentAtom.y;
            const len = Math.sqrt(dx*dx + dy*dy);
            if (len > 0) {
                const ux = dx / len;
                const uy = dy / len;
                const offsetStart = 10;
                const offsetEnd = element === 'H' ? 6 : 10;
                line.setAttribute('x1', parentAtom.x + ux * offsetStart);
                line.setAttribute('y1', parentAtom.y + uy * offsetStart);
                line.setAttribute('x2', x - ux * offsetEnd);
                line.setAttribute('y2', y - uy * offsetEnd);
                line.setAttribute('stroke', 'rgba(255, 255, 255, 0.25)');
                line.setAttribute('stroke-width', '2');
                line.setAttribute('stroke-dasharray', '3,3');
                this.uiGroup.appendChild(line);
            }
        }

        // 2. 半透明の原子球
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', element === 'H' ? '6' : '10');
        circle.setAttribute('fill', '#0f141c');
        circle.setAttribute('stroke', `var(--color-${element.toLowerCase()})`);
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('opacity', '0.45'); // 半透明
        this.uiGroup.appendChild(circle);

        // 3. 半透明の原子文字
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y + (element === 'H' ? 2.0 : 3.0));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'svg-atom-text');
        text.setAttribute('fill', `var(--color-${element.toLowerCase()})`);
        text.style.fontSize = element === 'H' ? '6.5px' : '9px';
        text.textContent = element;
        text.setAttribute('opacity', '0.45'); // 半透明
        this.uiGroup.appendChild(text);
    }

    clearUIOverlay() {
        this.uiGroup.innerHTML = '';
    }

    // 二重結合 (C=C) は 120度方向、三重結合 (C≡C) は 180度直線方向、それ以外の sp3 重原子は直角グリッド上に自動アジャストする
    autoLayoutBonds() {
        let changed = false;
        
        // 1. sp2 (二重結合) および sp (三重結合) の自動レイアウト
        this.userMolecule.bonds.forEach(bond => {
            if (bond.type !== 2 && bond.type !== 3) return; // 二重結合(2)または三重結合(3)のみ対象
            
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2 || a1.element !== 'C' || a2.element !== 'C') return;
            
            // ベンゼン環の原子は除外
            if (a1.benzeneCenter || a2.benzeneCenter) return;
            
            const adjustNeighbors = (centerAtom, partnerAtom) => {
                const neighbors = this.userMolecule.getNeighbors(centerAtom.id)
                    .filter(n => n.atom.id !== partnerAtom.id && n.atom.element !== 'H');
                
                if (neighbors.length === 0) return;
                
                const baseAngle = Math.atan2(partnerAtom.y - centerAtom.y, partnerAtom.x - centerAtom.x);
                
                let targetAngles = [];
                if (bond.type === 2) {
                    // 二重結合：120度外側の2方向
                    targetAngles = [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3];
                } else if (bond.type === 3) {
                    // 三重結合：180度反対側の直線上の1方向のみ
                    targetAngles = [baseAngle + Math.PI];
                }
                
                neighbors.forEach((n, idx) => {
                    const neighborAtom = n.atom;
                    
                    // ズレをチェックし、最も近い角度を選ぶ（三重結合の場合は1つだけなのでそれを選ぶ）
                    let bestAngle = targetAngles[0];
                    let minDist = Infinity;
                    
                    targetAngles.forEach(ang => {
                        const tx = centerAtom.x + GRID_SIZE * Math.cos(ang);
                        const ty = centerAtom.y + GRID_SIZE * Math.sin(ang);
                        const d = Math.sqrt((neighborAtom.x - tx)**2 + (neighborAtom.y - ty)**2);
                        if (d < minDist) {
                            minDist = d;
                            bestAngle = ang;
                        }
                    });
                    
                    // もし 2px 以上ズレている場合、正しい位置に強制移動
                    if (minDist > 2) {
                        const targetX = centerAtom.x + GRID_SIZE * Math.cos(bestAngle);
                        const targetY = centerAtom.y + GRID_SIZE * Math.sin(bestAngle);
                        
                        // サブツリー全体を平行移動
                        const dx = targetX - neighborAtom.x;
                        const dy = targetY - neighborAtom.y;
                        
                        this.translateSubtree(neighborAtom.id, centerAtom.id, dx, dy, new Set());
                        changed = true;
                    }
                });
            };
            
            adjustNeighbors(a1, a2);
            adjustNeighbors(a2, a1);
        });

        // 2. sp3 (単結合のみ) の重原子を、最も近い直角グリッド交点 (GRID_SIZE の倍数) に吸着アジャスト
        //    ※ただし、sp2/sp の自動レイアウトによって配置されたものは直角グリッドから外れるため、
        //      「二重結合または三重結合に接続していない重原子」のみをスナップ対象とする。
        const sp3Atoms = this.userMolecule.atoms.filter(atom => {
            if (atom.element === 'H') return false;
            if (atom.benzeneCenter) return false; // ベンゼンは固定レイアウト
            
            // この原子が二重結合(2)または三重結合(3)に接続されているかチェック
            const neighbors = this.userMolecule.getNeighbors(atom.id);
            const hasSp2SpBond = neighbors.some(n => n.type === 2 || n.type === 3);
            return !hasSp2SpBond;
        });

        sp3Atoms.forEach(atom => {
            const targetX = Math.round(atom.x / GRID_SIZE) * GRID_SIZE;
            const targetY = Math.round(atom.y / GRID_SIZE) * GRID_SIZE;
            
            const dx = targetX - atom.x;
            const dy = targetY - atom.y;
            
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                // 【超重要】分子全体の累積ズレや振動を防ぐため、隣接するsp2/sp炭素（二重/三重結合の端の炭素）を
                // parentId に設定して translateSubtree を呼び出す。
                // これにより、二重結合・三重結合の中心骨格側は絶対に移動せず、
                // sp3に戻った枝原子の方向だけが元の直角グリッド位置に引き戻されます。
                const neighbors = this.userMolecule.getNeighbors(atom.id);
                const barrierNeighbor = neighbors.find(n => {
                    if (n.atom.element !== 'C') return false;
                    const cNeighbors = this.userMolecule.getNeighbors(n.atom.id);
                    return cNeighbors.some(cn => cn.type === 2 || cn.type === 3);
                });

                const parentId = barrierNeighbor ? barrierNeighbor.atom.id : null;
                
                // もし barrierNeighbor も存在しない（＝分子全体が完全な単結合sp3鎖である）場合、
                // 新規配置やドラッグ移動によってすでにグリッド交点に正しく置かれているため、
                // 平行移動による累積的なズレや振動を防ぐため、全体移動（parentId = null）は実行しない！
                if (parentId !== null) {
                    this.translateSubtree(atom.id, parentId, dx, dy, new Set());
                    changed = true;
                }
            }
        });
        
        if (changed) {
            this.updateDrawing();
        }
    }

    // 特定の原子から先のサブツリー全体を平行移動させる再帰ヘルパー
    translateSubtree(atomId, parentId, dx, dy, visited) {
        visited.add(atomId);
        const atom = this.userMolecule.atoms.find(a => a.id === atomId);
        if (atom) {
            atom.x += dx;
            atom.y += dy;
        }
        
        const neighbors = this.userMolecule.getNeighbors(atomId)
            .filter(n => n.atom.id !== parentId && n.atom.element !== 'H');
            
        neighbors.forEach(n => {
            if (!visited.has(n.atom.id)) {
                this.translateSubtree(n.atom.id, atomId, dx, dy, visited);
            }
        });
    }

    // 正解の例示（お手本）をレンダリングする
    renderTargetAnswer() {
        this.targetBonds.innerHTML = '';
        this.targetAtoms.innerHTML = '';

        const targetMol = STAGES[this.currentStageIndex].createTarget();
        const heavyAtoms = targetMol.atoms.filter(a => a.element !== 'H');
        if (heavyAtoms.length === 0) return;

        // 1. バウンディングボックスの計算とセンタリング
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        heavyAtoms.forEach(a => {
            if (a.x < minX) minX = a.x;
            if (a.x > maxX) maxX = a.x;
            if (a.y < minY) minY = a.y;
            if (a.y > maxY) maxY = a.y;
        });

        // ターゲット側水素も含めるため、水素も計算
        const hydrogens = targetMol.calculateHydrogens();
        hydrogens.forEach(h => {
            if (h.x < minX) minX = h.x;
            if (h.x > maxX) maxX = h.x;
            if (h.y < minY) minY = h.y;
            if (h.y > maxY) maxY = h.y;
        });

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        // target-svg の中心 (200, 200) に平行移動するためのオフセット
        const offsetX = 200 - cx;
        const offsetY = 200 - cy;

        // 2. 結合の描画
        // ① 水素の結合
        hydrogens.forEach(h => {
            const parent = targetMol.atoms.find(a => a.id === h.parentId);
            if (parent) {
                this.renderTargetBond(parent.x + offsetX, parent.y + offsetY, h.x + offsetX, h.y + offsetY, 1, true);
            }
        });

        // ② 重原子間の結合
        targetMol.bonds.forEach(bond => {
            const a1 = targetMol.atoms.find(a => a.id === bond.atomId1);
            const a2 = targetMol.atoms.find(a => a.id === bond.atomId2);
            if (a1 && a2 && a1.element !== 'H' && a2.element !== 'H') {
                this.renderTargetBond(a1.x + offsetX, a1.y + offsetY, a2.x + offsetX, a2.y + offsetY, bond.type, false);
            }
        });

        // 3. 原子の描画
        // ① 水素
        hydrogens.forEach(h => {
            this.renderTargetAtom(h.element, h.x + offsetX, h.y + offsetY);
        });

        // ② 重原子
        heavyAtoms.forEach(a => {
            this.renderTargetAtom(a.element, a.x + offsetX, a.y + offsetY);
        });
    }

    renderTargetAtom(element, x, y) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', element === 'H' ? '6' : '10');
        circle.setAttribute('fill', '#0f141c');
        circle.setAttribute('stroke', `var(--color-${element.toLowerCase()})`);
        circle.setAttribute('stroke-width', '2');
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y + (element === 'H' ? 2.0 : 3.0));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'svg-atom-text');
        text.setAttribute('fill', `var(--color-${element.toLowerCase()})`);
        text.style.fontSize = element === 'H' ? '6.5px' : '9px';
        text.textContent = element;

        group.appendChild(circle);
        group.appendChild(text);
        this.targetAtoms.appendChild(group);
    }

    renderTargetBond(x1, y1, x2, y2, type, isHConnection = false) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len === 0) return;
        
        const ux = dx / len;
        const uy = dy / len;

        const offsetStart = 10;
        const offsetEnd = isHConnection ? 6 : 10;
        
        const sx = x1 + ux * offsetStart;
        const sy = y1 + uy * offsetStart;
        const ex = x2 - ux * offsetEnd;
        const ey = y2 - uy * offsetEnd;

        const strokeColor = isHConnection ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)';

        if (type === 1) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', sx);
            line.setAttribute('y1', sy);
            line.setAttribute('x2', ex);
            line.setAttribute('y2', ey);
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-width', isHConnection ? '1.5' : '3');
            this.targetBonds.appendChild(line);
        } else if (type === 2) {
            const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            const nx = -uy * 2.5;
            const ny = ux * 2.5;
            
            line1.setAttribute('x1', sx + nx);
            line1.setAttribute('y1', sy + ny);
            line1.setAttribute('x2', ex + nx);
            line1.setAttribute('y2', ey + ny);
            line1.setAttribute('stroke', strokeColor);
            line1.setAttribute('stroke-width', '2.2');
            
            line2.setAttribute('x1', sx - nx);
            line2.setAttribute('y1', sy - ny);
            line2.setAttribute('x2', ex - nx);
            line2.setAttribute('y2', ey - ny);
            line2.setAttribute('stroke', strokeColor);
            line2.setAttribute('stroke-width', '2.2');
            
            this.targetBonds.appendChild(line1);
            this.targetBonds.appendChild(line2);
        }
    }

    // SVG描画の更新
    updateDrawing() {
        this.atomsGroup.innerHTML = '';
        this.bondsGroup.innerHTML = '';
        
        // 自動補完水素(H)の計算
        const hydrogens = this.userMolecule.calculateHydrogens();

        // 1. 水素(H)の結合線のみを最背面に描画（太い重原子間結合の下を通す）
        hydrogens.forEach(h => {
            const parent = this.userMolecule.atoms.find(a => a.id === h.parentId);
            if (parent) {
                this.renderBond(parent.x, parent.y, h.x, h.y, 1, true); // 水素の結合は常に単結合
            }
        });

        // 2. 重原子間の結合線を描画
        this.userMolecule.bonds.forEach(bond => {
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return;
            
            this.renderBond(a1.x, a1.y, a2.x, a2.y, bond.type, false, bond);
        });

        // 3. 水素原子(H)自体の描画
        hydrogens.forEach(h => {
            this.renderAtom(h.id, h.element, h.x, h.y, false);
        });

        // 4. 重原子の描画 (一番手前に描くため最後に行う)
        this.userMolecule.atoms.forEach(atom => {
            this.renderAtom(atom.id, atom.element, atom.x, atom.y, atom.isLocked, atom.isAsymmetricMarked);
        });
    }

    renderAtom(id, element, x, y, isLocked, isAsymmetricMarked = false) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'svg-atom-node');
        group.setAttribute('data-id', id);
        
        // 原子球（背景）
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', element === 'H' ? '6' : '10'); // 原子の大きさを約80%に縮小 (H:6px, 重原子:10px)
        circle.setAttribute('fill', '#0f141c');
        circle.setAttribute('stroke', `var(--color-${element.toLowerCase()})`);
        circle.setAttribute('stroke-width', '2');
        if (isLocked) {
            circle.setAttribute('stroke-dasharray', '3,3');
        }
        
        // 原子文字
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y + (element === 'H' ? 2.0 : 3.0)); // 文字の垂直揃えを小さくなった半径に合わせて微調整
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'svg-atom-text');
        text.setAttribute('fill', `var(--color-${element.toLowerCase()})`);
        text.style.fontSize = element === 'H' ? '6.5px' : '9px'; // フォントサイズも縮小
        text.textContent = element;

        group.appendChild(circle);
        group.appendChild(text);

        // 不斉炭素マーク (*) の描画
        if (element === 'C' && isAsymmetricMarked) {
            const star = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            star.setAttribute('x', x + 7.5);
            star.setAttribute('y', y - 4);
            star.setAttribute('class', 'svg-asymmetric-star');
            star.style.fontSize = '12px';
            star.textContent = '*';
            group.appendChild(star);
        }
        
        this.atomsGroup.appendChild(group);
    }

    renderBond(x1, y1, x2, y2, type, isHConnection = false, bondObj = null) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len === 0) return;
        
        const ux = dx / len;
        const uy = dy / len;

        // 原子ラベルと重ならないよう、端を少し縮める (重原子は半径10, 水素は半径6に適合)
        const offsetStart = 10;
        const offsetEnd = isHConnection ? 6 : 10;
        
        const sx = x1 + ux * offsetStart;
        const sy = y1 + uy * offsetStart;
        const ex = x2 - ux * offsetEnd;
        const ey = y2 - uy * offsetEnd;

        const strokeColor = isHConnection ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)';

        // 1. 見た目の線（ビジュアル）を描画する
        if (type === 1) {
            // 単結合
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', sx);
            line.setAttribute('y1', sy);
            line.setAttribute('x2', ex);
            line.setAttribute('y2', ey);
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-width', '3');
            line.setAttribute('pointer-events', 'none'); // クリック判定を透過
            this.bondsGroup.appendChild(line);
        } else if (type === 2) {
            // 二重結合 (平行な2本の線)
            const nx = -uy;
            const ny = ux;
            const gap = 5; // 線どうしの隙間を広げて視認性アップ

            for (let offset of [-gap, gap]) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', sx + nx * offset);
                line.setAttribute('y1', sy + ny * offset);
                line.setAttribute('x2', ex + nx * offset);
                line.setAttribute('y2', ey + ny * offset);
                line.setAttribute('stroke', strokeColor);
                line.setAttribute('stroke-width', '2.5');
                line.setAttribute('pointer-events', 'none');
                this.bondsGroup.appendChild(line);
            }
        } else if (type === 3) {
            // 三重結合
            const nx = -uy;
            const ny = ux;
            const gap = 6.5;

            // 中央、左、右
            const offsets = [-gap, 0, gap];
            offsets.forEach(offset => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', sx + nx * offset);
                line.setAttribute('y1', sy + ny * offset);
                line.setAttribute('x2', ex + nx * offset);
                line.setAttribute('y2', ey + ny * offset);
                line.setAttribute('stroke', strokeColor);
                line.setAttribute('stroke-width', offset === 0 ? '2.5' : '1.8');
                line.setAttribute('pointer-events', 'none');
                this.bondsGroup.appendChild(line);
            });
        }

        // 2. 判定用の透明な太い線を重ねて描画し、クリック・ダブルクリックイベントをアタッチする
        if (!isHConnection && bondObj) {
            const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hitLine.setAttribute('x1', sx);
            hitLine.setAttribute('y1', sy);
            hitLine.setAttribute('x2', ex);
            hitLine.setAttribute('y2', ey);
            hitLine.setAttribute('stroke', '#ffffff');
            hitLine.setAttribute('stroke-opacity', '0'); // イベントを検知する透明設定
            hitLine.setAttribute('stroke-width', '20');    // 判定範囲をさらに広げて20pxに設定（クリックしやすく）
            hitLine.style.cursor = 'pointer';
            hitLine.setAttribute('class', 'svg-bond-hitbox');
            
            // ネイティブのclickとdblclickイベントを使用し、タイマー遅延を完全に排除
            hitLine.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // キャンバス全体のmousedown（原子の上書き・配置）が走るのを完全に阻止！
            });
            hitLine.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleBondInteraction(bondObj, false); // シングルクリックで次数トグル
            });
            hitLine.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.handleBondInteraction(bondObj, true); // ダブルクリックで切断
            });
            hitLine.addEventListener('contextmenu', (e) => {
                e.preventDefault(); // ブラウザの右クリックメニューを抑制
                e.stopPropagation();
                this.handleBondInteraction(bondObj, true); // 右クリックで切断
            });
            this.bondsGroup.appendChild(hitLine);
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
            // 1. 分子トポロジー構造の一致判定
            const isStructureCorrect = verifyMolecule(this.userMolecule, targetMolecule);
            if (!isStructureCorrect) {
                this.verifyResult.className = "result-message error";
                this.verifyResult.textContent = "不一致です。結合の数や種類、繋がっている原子の順番を確認してください。";
                return;
            }

            // 2. 不斉炭素マークモード (ON) 時の不斉炭素マーク判定
            if (this.asymmetricMode) {
                // ユーザーの全炭素（C）について、本物であるかとマーク状態が一致しているか走査
                const carbonAtoms = this.userMolecule.atoms.filter(a => a.element === 'C');
                
                let asymmetricErrors = [];
                carbonAtoms.forEach(atom => {
                    const actualAsymmetric = this.userMolecule.isAsymmetricCarbon(atom.id);
                    const userMarked = atom.isAsymmetricMarked;
                    
                    if (actualAsymmetric && !userMarked) {
                        asymmetricErrors.push(`(X:${Math.round(atom.x)}, Y:${Math.round(atom.y)}) の炭素は不斉炭素ですが、* マークがありません。`);
                    } else if (!actualAsymmetric && userMarked) {
                        asymmetricErrors.push(`(X:${Math.round(atom.x)}, Y:${Math.round(atom.y)}) の炭素に * マークがありますが、これは不斉炭素ではありません。`);
                    }
                });

                if (asymmetricErrors.length > 0) {
                    this.verifyResult.className = "result-message error";
                    this.verifyResult.textContent = "分子構造は合っていますが、不斉炭素（C*）のマーク指定が正しくありません。\n" + asymmetricErrors[0];
                    return;
                }
            }

            // 3. すべて合格
            this.verifyResult.className = "result-message success";
            this.verifyResult.textContent = "正解です！構造および不斉炭素の位置が完全に一致しました！";
            
            // 勝利モーダルの表示
            this.showWinModal(stage);
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

    // 隣接する重原子どうしを自動で単結合で結ぶ (グリッド接続は60pxに厳格に制限)
    autoConnectAdjacentAtoms() {
        const threshold = GRID_SIZE + 2; // GRID_SIZE 付近のみ許可するよう厳格化
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
                    // 基本：水平または垂直に直線上に並んでいる場合のみ自動結合
                    const isHorizontal = Math.abs(dy) < 2; // 許容ズレを2pxに厳格化
                    const isVertical = Math.abs(dx) < 2;
                    let allowConnect = isHorizontal || isVertical;

                    // 【例外1】ベンゼン環のスナップガイド点に置かれた原子の場合
                    if (!allowConnect) {
                        const checkBenzeneGuide = (benzeneAtom, targetAtom) => {
                            if (benzeneAtom.benzeneCenter && benzeneAtom.benzeneAngle !== undefined) {
                                // ベンゼン頂点から外側に伸ばしたガイド点 (GRID_SIZE * 1.666 = 70px)
                                const sx = benzeneAtom.benzeneCenter.x + (GRID_SIZE * 1.666) * Math.cos(benzeneAtom.benzeneAngle);
                                const sy = benzeneAtom.benzeneCenter.y + (GRID_SIZE * 1.666) * Math.sin(benzeneAtom.benzeneAngle);
                                const d = Math.sqrt((targetAtom.x - sx)**2 + (targetAtom.y - sy)**2);
                                return d < 2; // 完全にスナップ吸着しているため2px以内で判定
                            }
                            return false;
                        };
                        if (checkBenzeneGuide(a1, a2) || checkBenzeneGuide(a2, a1)) {
                            allowConnect = true;
                        }
                    }

                    // 【例外2】C=C 二重結合の120度スナップガイド点に置かれた原子の場合
                    if (!allowConnect) {
                        const checkCcGuide = (cAtom, targetAtom) => {
                            if (cAtom.element !== 'C') return false;
                            
                            // 相手側の二重結合炭素を探す
                            const neighbors = this.userMolecule.getNeighbors(cAtom.id);
                            const dbNeighbor = neighbors.find(n => n.atom.element === 'C' && n.type === 2);
                            if (dbNeighbor) {
                                const baseAngle = Math.atan2(dbNeighbor.atom.y - cAtom.y, dbNeighbor.atom.x - cAtom.x);
                                // 120度外側のガイド点（距離 GRID_SIZE）
                                const angles = [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3];
                                return angles.some(ang => {
                                    const sx = cAtom.x + GRID_SIZE * Math.cos(ang);
                                    const sy = cAtom.y + GRID_SIZE * Math.sin(ang);
                                    const d = Math.sqrt((targetAtom.x - sx)**2 + (targetAtom.y - sy)**2);
                                    return d < 2; // 完全にスナップ吸着しているため2px以内で判定
                                });
                            }
                            return false;
                        };
                        if (checkCcGuide(a1, a2) || checkCcGuide(a2, a1)) {
                            allowConnect = true;
                        }
                    }

                    if (allowConnect) {
                        // 既に結合が存在しない場合、かつ手動削除履歴に含まれない場合、かつ両原子に空き手が1以上ある場合のみ単結合(1)を追加する
                        const key = [a1.id, a2.id].sort().join('_');
                        if (!this.userMolecule.deletedBonds.includes(key) && !this.userMolecule.getBond(a1.id, a2.id)) {
                            if (this.userMolecule.getFreeValency(a1.id) >= 1 && this.userMolecule.getFreeValency(a2.id) >= 1) {
                                console.log(`[AutoConnect] ${a1.element}(${a1.x}, ${a1.y}) - ${a2.element}(${a2.x}, ${a2.y}) dist=${dist.toFixed(1)} dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
                                this.userMolecule.addBond(a1.id, a2.id, 1);
                            }
                        }
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
            // シングルクリックで結合次数のトグル (移行可能な有効な次数を探索)
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return;

            const maxType = this.getMaxBondType(a1.element, a2.element);
            if (maxType <= 1) return; // 単結合しか作れない結合（例: C-Cl）は変更不可

            const currentType = Number(bond.type) || 1;
            let nextType = currentType;
            let found = false;

            // 最大 maxType 回ループして、次に移行可能な結合次数を探索する
            for (let i = 1; i <= maxType; i++) {
                let testType = currentType + i;
                if (testType > maxType) {
                    testType = 1;
                }
                if (testType === currentType) break; // 一周したら終了

                const diff = testType - currentType;
                const free1 = this.userMolecule.getFreeValency(bond.atomId1);
                const free2 = this.userMolecule.getFreeValency(bond.atomId2);

                // 減らすトグルであるか、または増やすのに十分な空き手がある場合のみ許可
                if (diff <= 0 || (free1 >= diff && free2 >= diff)) {
                    nextType = testType;
                    found = true;
                    break;
                }
            }

            if (found && nextType !== currentType) {
                this.saveState();
                bond.type = nextType;
                this.autoLayoutBonds();
                this.updateDrawing();
            }
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
    isNearAnyExistingAtom(x, y, threshold = 75) {
        const nearest = this.findNearestAtom(x, y);
        return nearest ? nearest.distance <= threshold : false;
    }

    // 指定された座標から最も近い既存原子を探す
    findNearestAtom(x, y) {
        let bestDist = Infinity;
        let nearest = null;
        this.userMolecule.atoms.forEach(atom => {
            const dx = atom.x - x;
            const dy = atom.y - y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < bestDist) {
                bestDist = dist;
                nearest = atom;
            }
        });
        return nearest ? { atom: nearest, distance: bestDist } : null;
    }

    // 正解ターゲット分子の大きさにキャンバスを自動フィットさせる
    fitCanvasToTarget() {
        const stage = STAGES[this.currentStageIndex];
        const targetMolecule = stage.createTarget();
        
        const bounds = this.calculateTargetBounds(targetMolecule);
        const W = bounds.maxX - bounds.minX;
        const H = bounds.maxY - bounds.minY;
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        
        // 余白を含めた視野の広さを計算 (GRID_SIZE = 60なので、左右120px、上下90px程度の余白)
        let viewW = Math.max(360, W + 240); // 最小幅を360pxに設定
        let viewH = Math.max(270, H + 180); // 最小高さを270pxに設定
        
        // アスペクト比を 4:3 (800:600) に維持する
        if (viewW / viewH > 4 / 3) {
            viewH = viewW * (3 / 4);
        } else {
            viewW = viewH * (4 / 3);
        }
        
        const vx = cx - viewW / 2;
        const vy = cy - viewH / 2;
        
        this.svg.setAttribute('viewBox', `${vx} ${vy} ${viewW} ${viewH}`);
    }

    // ターゲット分子の座標境界を計算
    calculateTargetBounds(targetMolecule) {
        if (targetMolecule.atoms.length === 0) {
            return { minX: 400, maxX: 400, minY: 300, maxY: 300 };
        }
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        targetMolecule.atoms.forEach(atom => {
            minX = Math.min(minX, atom.x);
            maxX = Math.max(maxX, atom.x);
            minY = Math.min(minY, atom.y);
            maxY = Math.max(maxY, atom.y);
        });
        
        return { minX, maxX, minY, maxY };
    }

    // 接続している2つの原子の元素種から、化学的に取り得る最大結合次数 (1:単, 2:二重, 3:三重) を返す
    getMaxBondType(element1, element2) {
        const getValency = (elem) => {
            switch(elem) {
                case 'C': return 4;
                case 'N': return 3;
                case 'O': return 2;
                case 'Cl': return 1;
                case 'H': return 1;
                default: return 1;
            }
        };
        // 両原子の最大手の最小値、かつ現実の共有結合の最大次数である 3 を限界値とする
        return Math.min(getValency(element1), getValency(element2), 3);
    }
}

// 起動
window.addEventListener('DOMContentLoaded', () => {
    window.game = new Game();
});
