/**
 * Game Logic for Chem-Assembler
 * 画面の描画更新、インタラクション、ステージ進行、およびUIイベントを制御します。
 */

let STAGES = [];
const GRID_SIZE = 42;

class Game {
    constructor() {
        this.currentStageIndex = 0;
        this.userMolecule = new Molecule();
        this.selectedTool = 'select'; // 'select', 'bond', 'erase'
        this.selectedBondType = 1;     // 1, 2, 3
        this.selectedAtomType = 'C';   // 'C', 'O', 'N', 'Cl'
        this.selectedModule = null;    // 'benzene', 'oh', 'cooh', 'nh2'
        this.asymmetricMode = false;   // 荳肴哩轤ｭ邏�繝槭�繧ｯ繝｢繝ｼ繝峨′ ON 縺九←縺�°
        
        // 繝峨Λ繝�げ迥ｶ諷�
        this.isDragging = false;
        this.draggedAtom = null;
        this.bondStartAtom = null;
        
        // 螻･豁ｴ繧ｹ繧ｿ繝�け (邁｡譏填ndo逕ｨ)
        this.history = [];

        this.initDOMElements();
        this.initEventListeners();
        
        // 最初のシリーズの最初のステージをロード
        // ズーム＆パン用の状態変数
        this.pan = {
            isPanning: false,
            startX: 0,
            startY: 0,
            startViewX: 0,
            startViewY: 0
        };
        const firstStageIdx = parseInt(this.stageSelect.value);
        this.loadStage(isNaN(firstStageIdx) ? 0 : firstStageIdx);
    }

    initDOMElements() {
        this.svg = document.getElementById('chem-svg');
        this.atomsGroup = document.getElementById('atoms-group');
        this.bondsGroup = document.getElementById('bonds-group');
        this.uiGroup = document.getElementById('ui-group');
        
        this.coordDisplay = document.getElementById('coord-display');
        this.btnVerify = document.getElementById('btn-verify');
        this.btnClearAll = document.getElementById('btn-clear-all');
        this.seriesSelect = document.getElementById('select-series');
        this.stageSelect = document.getElementById('select-stage');
        
        this.targetName = document.getElementById('target-name');
        this.targetFormula = document.getElementById('target-formula');
        this.targetDesc = document.getElementById('target-desc');
        this.verifyResult = document.getElementById('verify-result');
        
        this.winModal = document.getElementById('win-modal');
        this.btnNextStage = document.getElementById('btn-next-stage');

        // 豁｣隗｣縺ｮ萓狗､ｺ繝ｻ荳肴哩轤ｭ邏�髢｢騾｣縺ｮDOM隕∫ｴ�
        this.btnShowTarget = document.getElementById('btn-show-target');
        this.btnCloseTarget = document.getElementById('btn-close-target');
        this.targetModal = document.getElementById('target-modal');
        this.checkAsymmetricMode = document.getElementById('check-asymmetric-mode');
        this.targetBonds = document.getElementById('target-bonds');
        this.targetAtoms = document.getElementById('target-atoms');
        this.winMolDetails = document.getElementById('win-mol-details');

        // 繧ｹ繝��繧ｸ驕ｸ謚櫁い縺ｮ霑ｽ蜉�
        // シリーズ選択肢の追加
        const seriesSet = new Set();
        STAGES.forEach(s => {
            if (s.series) seriesSet.add(s.series);
        });
        seriesSet.forEach(seriesName => {
            const opt = document.createElement('option');
            opt.value = seriesName;
            opt.textContent = seriesName;
            this.seriesSelect.appendChild(opt);
        });

        // 最初のシリーズのステージリストを初期構築
        this.btnResetView = document.getElementById("btn-reset-view");
        if (this.seriesSelect.value) {
            this.updateStageOptions(this.seriesSelect.value);
        }
    }

    // 指定されたシリーズに属するステージで問題ドロップダウンを再構築する
    updateStageOptions(selectedSeries) {
        this.stageSelect.innerHTML = '';
        let count = 1;
        STAGES.forEach((stage, idx) => {
            if (stage.series === selectedSeries) {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = `${count}. ${stage.name}`;
                this.stageSelect.appendChild(opt);
                count++;
            }
        });
    }

    initEventListeners() {
        // マウスホイール・タッチパッド2本指スワイプによるパン＆ズーム
        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const viewBox = this.svg.viewBox.baseVal;

            // ctrlKey はタッチパッドのピンチズーム時、または Ctrl+ホイール時に true になる
            if (e.ctrlKey) {
                // カーソル直下の論理座標を軸にviewBoxを拡縮する（カーソル位置が画面上で動かない）
                const p = this.clientToSvg(e.clientX, e.clientY);
                if (!p) return;

                const zoomIntensity = 0.05;
                const delta = e.deltaY < 0 ? 1 - zoomIntensity : 1 + zoomIntensity;

                const newWidth = viewBox.width * delta;
                if (newWidth < 150 || newWidth > 5000) return;

                viewBox.x = p.x - (p.x - viewBox.x) * delta;
                viewBox.y = p.y - (p.y - viewBox.y) * delta;
                viewBox.width = newWidth;
                viewBox.height = viewBox.height * delta;
            } else {
                // 2本指スクロールによるパン（平行移動）
                const scale = this.svgUnitsPerPixel();
                viewBox.x += e.deltaX * scale;
                viewBox.y += e.deltaY * scale;
            }
        }, { passive: false });

        // ブラウザ標準の右クリックメニューは抑止（右ドラッグパンに割り当てるため）
        this.svg.addEventListener('contextmenu', (e) => e.preventDefault());

        // 全体表示リセットボタンの紐付け
        if (this.btnResetView) {
            this.btnResetView.addEventListener('click', () => {
                this.fitCanvasToTarget();
            });
        }

        // ポインタ入力（マウス・タッチ・ペン）の統一ハンドラ（開発方針 3.4章）
        // タッチはpreventDefaultで合成マウスイベントの二重発火（タップ配置→即削除バグ）を防ぎ、
        // 2本指はピンチズームとして扱う。座標は常にイベント自身から取得する。
        this.activePointers = new Map(); // pointerId -> {x, y}
        this.pinch = null;               // ピンチ中: {startDist, startWidth, startHeight}

        this.svg.addEventListener('pointerdown', (e) => {
            this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (e.pointerType === 'touch') {
                e.preventDefault();

                if (this.activePointers.size === 2) {
                    // ピンチ開始: 進行中の単一指操作（ドラッグ等）はキャンセル
                    const pts = [...this.activePointers.values()];
                    const viewBox = this.svg.viewBox.baseVal;
                    this.pinch = {
                        startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
                        startWidth: viewBox.width,
                        startHeight: viewBox.height
                    };
                    this.isDragging = false;
                    this.draggedAtom = null;
                    this.bondStartAtom = null;
                    this.clearUIOverlay();
                    return;
                }
                if (this.pinch || this.activePointers.size > 2) return;
            }

            if (e.button === 2) {
                // 右ボタンドラッグ: パン開始（PC用）
                e.preventDefault();
                const viewBox = this.svg.viewBox.baseVal;
                this.pan.isPanning = true;
                this.pan.startX = e.clientX;
                this.pan.startY = e.clientY;
                this.pan.startViewX = viewBox.x;
                this.pan.startViewY = viewBox.y;
                this.svg.style.cursor = 'grabbing';
                return;
            }

            this.handleMouseDown(e);
        });

        this.svg.addEventListener('pointermove', (e) => {
            if (this.activePointers.has(e.pointerId)) {
                this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }

            // 2本指ピンチズーム
            if (this.pinch && this.activePointers.size >= 2) {
                e.preventDefault();
                const pts = [...this.activePointers.values()];
                const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (this.pinch.startDist > 0 && dist > 0) {
                    const ratio = this.pinch.startDist / dist;
                    const viewBox = this.svg.viewBox.baseVal;
                    // ピンチ中心の論理座標を軸にviewBoxを拡縮する
                    const p = this.clientToSvg((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
                    if (!p) return;

                    const newWidth = this.pinch.startWidth * ratio;
                    const newHeight = this.pinch.startHeight * ratio;
                    if (newWidth < 150 || newWidth > 5000) return;

                    const scaleX = newWidth / viewBox.width;
                    const scaleY = newHeight / viewBox.height;
                    viewBox.x = p.x - (p.x - viewBox.x) * scaleX;
                    viewBox.y = p.y - (p.y - viewBox.y) * scaleY;
                    viewBox.width = newWidth;
                    viewBox.height = newHeight;
                }
                return;
            }

            this.handleMouseMove(e);
        });

        // pointerupはキャンバス外で指・ボタンを離しても検知できるようwindowで受ける
        const onPointerEnd = (e) => {
            this.activePointers.delete(e.pointerId);
            if (this.pinch) {
                // ピンチ終了（指が1本以下になったら解除）。タップ操作としては処理しない
                if (this.activePointers.size < 2) this.pinch = null;
                return;
            }
            this.handleMouseUp(e);
        };
        window.addEventListener('pointerup', onPointerEnd);
        window.addEventListener('pointercancel', onPointerEnd);
        this.svg.addEventListener('pointerleave', () => this.clearUIOverlay());

        // 繝��繝ｫ蛻�崛
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedTool = btn.dataset.tool;
                this.selectedModule = null; // 繝｢繧ｸ繝･繝ｼ繝ｫ驕ｸ謚槭ｒ隗｣髯､
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
            });
        });

        // 邨仙粋謨ｰ蛻�崛
        document.querySelectorAll('.bond-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.bond-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedBondType = parseInt(btn.dataset.bond);
                
                // 邨仙粋驕ｸ謚槭ｒ縺励◆蝣ｴ蜷医∵桃菴懊Δ繝ｼ繝峨ｒ蠑ｷ蛻ｶ逧�↓縲檎ｵ仙粋縲阪↓縺吶ｋ
                document.getElementById('btn-tool-bond').click();
            });
        });

        // 蜴溷ｭ仙�譖ｿ
        document.querySelectorAll('.atom-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.atom-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedAtomType = btn.dataset.atom;
                this.selectedModule = null; // 繝｢繧ｸ繝･繝ｼ繝ｫ驕ｸ謚槭ｒ隗｣髯､
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                
                // 蜴溷ｭ宣∈謚槭ｒ縺励◆蝣ｴ蜷医∵桃菴懊Δ繝ｼ繝峨ｒ蠑ｷ蛻ｶ逧�↓縲碁∈謚橸ｼ磯�鄂ｮ�峨阪↓縺吶ｋ
                document.getElementById('btn-tool-select').click();
            });
        });

        // 螳倩�蝓ｺ/迺ｰ繝｢繧ｸ繝･繝ｼ繝ｫ
        document.querySelectorAll('.mod-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const wasActive = btn.classList.contains('active');
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                if (!wasActive) {
                    btn.classList.add('active');
                    this.selectedModule = btn.dataset.module;
                    // 繝｢繧ｸ繝･繝ｼ繝ｫ驟咲ｽｮ譎ゅ�荳譎ら噪縺ｫ驕ｸ謚槭ヤ繝ｼ繝ｫ謇ｱ縺�↓縺吶ｋ
                    this.selectedTool = 'select';
                    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                    document.getElementById('btn-tool-select').classList.add('active');
                } else {
                    this.selectedModule = null;
                }
            });
        });

        // 繧ｹ繝��繧ｸ螟画峩
        this.seriesSelect.addEventListener('change', (e) => {
            const selectedSeries = e.target.value;
            this.updateStageOptions(selectedSeries);
            const firstStageIdx = parseInt(this.stageSelect.value);
            if (!isNaN(firstStageIdx)) {
                this.loadStage(firstStageIdx);
            }
        });

        this.stageSelect.addEventListener('change', (e) => {
            this.loadStage(parseInt(e.target.value));
        });

        // 繧｢繧ｯ繧ｷ繝ｧ繝ｳ繝懊ち繝ｳ
        this.btnVerify.addEventListener('click', () => this.verifyCurrentStructure());
        this.btnClearAll.addEventListener('click', () => {
            if (this.userMolecule.atoms.length === 0) return; // 空のときはUndo履歴を消費しない（開発方針 3.5章）
            this.saveState();
            this.userMolecule = new Molecule();
            this.fitCanvasToTarget();
            this.updateDrawing();
        });

        this.btnNextStage.addEventListener('click', () => {
            this.winModal.classList.add('hidden');
            
            // 現在のシリーズに属するステージの絶対インデックス一覧を取得
            const currentSeries = this.seriesSelect.value;
            const seriesStageIndices = [];
            STAGES.forEach((stage, idx) => {
                if (stage.series === currentSeries) {
                    seriesStageIndices.push(idx);
                }
            });
            
            // 現在の絶対インデックスの位置を探し、次へ進める
            const currentPos = seriesStageIndices.indexOf(this.currentStageIndex);
            let nextIdx = seriesStageIndices[0]; // デフォルトは最初に戻る
            if (currentPos !== -1 && currentPos + 1 < seriesStageIndices.length) {
                nextIdx = seriesStageIndices[currentPos + 1];
            }
            
            this.stageSelect.value = nextIdx;
            this.loadStage(nextIdx);
        });

        // 荳肴哩轤ｭ邏�繝槭�繧ｯ繝｢繝ｼ繝峨�ON/OFF蛻�ｊ譖ｿ縺�
        this.checkAsymmetricMode.addEventListener('change', (e) => {
            this.asymmetricMode = e.target.checked;
            this.clearUIOverlay();
            this.updateDrawing();
        });

        // 縺頑焔譛ｬ繝｢繝ｼ繝繝ｫ縺ｮ陦ｨ遉ｺ
        this.btnShowTarget.addEventListener('click', () => {
            this.renderTargetAnswer();
            this.targetModal.classList.remove('hidden');
        });

        this.btnCloseTarget.addEventListener('click', () => {
            this.targetModal.classList.add('hidden');
        });

        // SVG繧ｭ繝｣繝ｳ繝舌せ荳翫〒縺ｮ繧､繝ｳ繧ｿ繝ｩ繧ｯ繧ｷ繝ｧ繝ｳ
        // キャンバス上の入力はPointer Eventsに統一済み（本メソッド冒頭のpointerdown/move/up参照）
        
        // 繧ｭ繝ｼ繝懊�繝峨す繝ｧ繝ｼ繝医き繝�ヨ (Undo/Redo, 繝��繝ｫ蛻�崛縺ｪ縺ｩ)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.key === 'Delete') {
                e.preventDefault();
                if (this.userMolecule.atoms.length === 0) return; // 空のときは何もしない（開発方針 3.5章）
                if (confirm("縺吶∋縺ｦ縺ｮ蜴溷ｭ舌→邨仙粋繧呈ｶ亥悉縺励∪縺吶°��")) {
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
        // 邁｡譏薙ョ繧｣繝ｼ繝励さ繝斐�縺ｫ繧医ｋ迥ｶ諷九�菫晏ｭ�
        const serialized = JSON.stringify({
            atoms: this.userMolecule.atoms,
            bonds: this.userMolecule.bonds,
            deletedBonds: this.userMolecule.deletedBonds
        });
        this.history.push(serialized);
        if (this.history.length > 30) this.history.shift(); // 螻･豁ｴ譛螟ｧ30莉ｶ
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
            // シリアライズ済みの全プロパティ（isAsymmetricMarked, benzeneCenter, benzeneAngle 等）を
            // 機械的に復元する。個別コピーだと復元漏れが起きるため（開発方針 3.5章）。
            Object.assign(atom, a);
            this.userMolecule.atoms.push(atom);
        });
        previousState.bonds.forEach(b => {
            this.userMolecule.bonds.push(new Bond(b.atomId1, b.atomId2, b.type));
        });
        this.updateDrawing();
        this.verifyResult.classList.add('hidden');
    }

    // JSONで定義された問題構造データからMoleculeオブジェクトを動的に生成する
    createTargetFromData(stage) {
        const m = new Molecule();
        if (!stage || !stage.target) return m;
        
        const addedAtoms = [];
        stage.target.atoms.forEach(atomData => {
            const a = m.addAtom(atomData.element, atomData.x, atomData.y);
            addedAtoms.push(a);
        });
        
        stage.target.bonds.forEach(bondData => {
            const atom1 = addedAtoms[bondData.atom1Index];
            const atom2 = addedAtoms[bondData.atom2Index];
            if (atom1 && atom2) {
                m.addBond(atom1.id, atom2.id, bondData.type);
            }
        });
        
        return m;
    }

    loadStage(index) {
        this.currentStageIndex = index;
        this.userMolecule = new Molecule();
        this.history = [];
        
        // ドロップダウンの表示を同期させる
        const loadedStage = STAGES[index];
        if (loadedStage) {
            if (this.seriesSelect && this.seriesSelect.value !== loadedStage.series) {
                this.seriesSelect.value = loadedStage.series;
                this.updateStageOptions(loadedStage.series);
            }
            if (this.stageSelect && parseInt(this.stageSelect.value) !== index) {
                this.stageSelect.value = index;
            }
        }
        
        // 荳肴哩轤ｭ邏�繝｢繝ｼ繝峨ｒ隗｣髯､繝ｻ繝√ぉ繝�け繝懊ャ繧ｯ繧ｹ繧丹FF縺ｫ蛻晄悄蛹�
        this.asymmetricMode = false;
        if (this.checkAsymmetricMode) {
            this.checkAsymmetricMode.checked = false;
        }

        const stage = STAGES[index];
        this.targetName.textContent = stage.name;
        this.targetFormula.textContent = stage.formula;
        this.targetDesc.textContent = stage.desc;
        this.verifyResult.classList.add('hidden');
        
        this.fitCanvasToTarget(); // 繧ｹ繝��繧ｸ縺ｮ繧ｿ繝ｼ繧ｲ繝�ヨ繧ｵ繧､繧ｺ縺ｫ閾ｪ蜍輔ヵ繧｣繝�ヨ
        this.updateDrawing();
    }

    // 繝槭え繧ｹ菴咲ｽｮ縺九ｉ繧ｰ繝ｪ繝�ラ蠎ｧ讓吶∈縺ｮ繧ｹ繝翫ャ繝� (蠅礼ｯ牙庄閭ｽ莠､轤ｹ縺ｸ縺ｮ繝槭げ繝阪ャ繝亥精逹)
    // クライアント座標(clientX/Y)をSVGのviewBox論理座標へ変換する。
    // preserveAspectRatio(レターボックス)を正しく考慮するため、手計算ではなく必ずCTMを使うこと（開発方針 3.3章）。
    clientToSvg(clientX, clientY) {
        const ctm = this.svg.getScreenCTM();
        if (!ctm) return null;
        return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    }

    // 画面1pxあたりのviewBox論理単位（一様スケール）。パンの移動量変換に使う。
    svgUnitsPerPixel() {
        const ctm = this.svg.getScreenCTM();
        if (!ctm) return 1;
        return 1 / ctm.a; // meet指定では縦横同一スケールのため a のみで足りる
    }

    // マウス位置からスナップ座標への変換（ハイブリッド方式）
    // 空きスペース → グリッドスナップ（手作図感覚を維持）
    // 既存原子付近 → ベクトルベースで幾何学的に最適位置に自動配置
    //               近接する場合は結合長を延長して見やすさを確保
    getSnappedCoords(e) {
        const p = this.clientToSvg(e.clientX, e.clientY);
        const x = p ? p.x : 0;
        const y = p ? p.y : 0;

        const SNAP_RADIUS   = 45;              // 既存原子への吸着半径 (px)
        const BOND_LENGTH   = GRID_SIZE;       // 標準結合長
        const MIN_CLEARANCE = BOND_LENGTH * 0.65; // 近接判定しきい値
        const MAX_EXTEND    = BOND_LENGTH * 2.0;  // 最大延長（2倍まで）
        const EXTEND_STEP   = BOND_LENGTH * 0.15; // 延長ステップ
        const MAX_CANVAS    = 5000;            // キャンバス上限 (px)

        // 1. キャンバスに原子がない場合: グリッドスナップ
        const heavyAtoms = this.userMolecule.atoms.filter(a => a.element !== 'H');
        if (heavyAtoms.length === 0) {
            const snapX = Math.round(x / GRID_SIZE) * GRID_SIZE;
            const snapY = Math.round(y / GRID_SIZE) * GRID_SIZE;
            return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: true, snapAtom: null };
        }

        // 2. マウスに最も近い（空き原子価がある）重原子を探す
        let nearestAtom = null;
        let nearestDist = SNAP_RADIUS;
        heavyAtoms.forEach(atom => {
            if (this.userMolecule.getFreeValency(atom.id) < 1) return;
            const dx = atom.x - x;
            const dy = atom.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestAtom = atom;
            }
        });

        // 3. 近傍原子なし → グリッドスナップ（フォールバック）
        if (!nearestAtom) {
            const snapX = Math.round(x / GRID_SIZE) * GRID_SIZE;
            const snapY = Math.round(y / GRID_SIZE) * GRID_SIZE;
            return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: false, snapAtom: null };
        }

        const atom = nearestAtom;

        // 4. ベンゼン環炭素: center方向（既存動作を完全維持）
        if (atom.benzeneCenter && atom.benzeneAngle !== undefined) {
            const pt = {
                x: atom.benzeneCenter.x + (BOND_LENGTH * 1.666) * Math.cos(atom.benzeneAngle),
                y: atom.benzeneCenter.y + (BOND_LENGTH * 1.666) * Math.sin(atom.benzeneAngle)
            };
            const occupied = !!this.findAtomAt(pt.x, pt.y, 8);
            return { x: pt.x, y: pt.y, rawX: x, rawY: y, isValid: !occupied, snapAtom: atom };
        }

        // 環内原子判定 (3員環〜8員環に対応するDFS閉路検出)
        const checkIsInRing = (atomId) => {
            const visited = new Set();
            let foundRing = false;
            
            const dfs = (currentId, depth) => {
                if (depth > 8) return;
                visited.add(currentId);
                const neighbors = this.userMolecule.getNeighbors(currentId)
                    .filter(n => n.atom.element !== 'H');
                
                for (const n of neighbors) {
                    if (n.atom.id === atomId && depth >= 3) {
                        foundRing = true;
                        return;
                    }
                    if (!visited.has(n.atom.id)) {
                        dfs(n.atom.id, depth + 1);
                        if (foundRing) return;
                    }
                }
                visited.delete(currentId);
            };
            
            dfs(atomId, 1);
            return foundRing;
        };

        const isInRing = checkIsInRing(atom.id);

        // 5. 隣接重原子へのベクトル方向を取得
        const neighbors = this.userMolecule.getNeighbors(atom.id)
            .filter(n => n.atom.element !== 'H');
        const bondAngles = neighbors.map(n =>
            Math.atan2(n.atom.y - atom.y, n.atom.x - atom.x)
        );

        // 6. 結合数と環属性に応じて候補角度を決定
        let candidateAngles = [];

        if (isInRing) {
            // 【環状原子の場合】: 幾何学的に外向きにスナップさせる
            if (bondAngles.length === 2) {
                // 通常の環内炭素（2結合）: 外向き二等分線の方向
                let sumX = 0, sumY = 0;
                bondAngles.forEach(ang => {
                    sumX += Math.cos(ang);
                    sumY += Math.sin(ang);
                });
                const outward = Math.atan2(-sumY, -sumX);
                candidateAngles = [outward];
            } else {
                // 環状だが結合が1本または3本以上: 直交(90度)候補
                candidateAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
            }
        } else {
            // 【鎖式原子（直鎖・通常の分岐）の場合】: 基本直交（90度単位）で4方向への結合を完全にサポート！
            // 既存の隣接結合の方向と直接重ならない方向（座標衝突ベース判定）を候補にする
            candidateAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        }

        // 7. 候補座標を生成（既存原子に重複する点は除外）
        const candidatePoints = [];
        candidateAngles.forEach(ang => {
            const pt = {
                x: atom.x + BOND_LENGTH * Math.cos(ang),
                y: atom.y + BOND_LENGTH * Math.sin(ang),
                angle: ang
            };
            
            // すでにこの原子（atom）からその座標（pt）の近くへ結合が伸びているかチェック（結合相手の存在確認）
            const isOccupied = neighbors.some(n => {
                const dx = n.atom.x - pt.x;
                const dy = n.atom.y - pt.y;
                return Math.sqrt(dx*dx + dy*dy) <= 15; // 15px以内なら既にそこに隣接原子が存在する
            });

            if (!isOccupied && !this.findAtomAt(pt.x, pt.y, 8)) {
                candidatePoints.push(pt);
            }
        });

        if (candidatePoints.length === 0) {
            return { x: atom.x, y: atom.y, rawX: x, rawY: y, isValid: false, snapAtom: null };
        }

        // 8. 複数の候補点がある場合、マウスカーソルに最も近い候補点を選択する（上・下の分岐をマウスで選べるようにするため）
        let bestPoint = candidatePoints[0];
        let minMouseDist = Infinity;
        candidatePoints.forEach(pt => {
            const dx = pt.x - x;
            const dy = pt.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minMouseDist) {
                minMouseDist = dist;
                bestPoint = pt;
            }
        });

        const bestAngle = bestPoint.angle;

        // 9. 最良角度で結合長を調整
        //    MIN_CLEARANCE を満たすまで段階的に延長（最大 MAX_EXTEND まで）
        let finalLength = BOND_LENGTH;
        for (let L = BOND_LENGTH; L <= MAX_EXTEND + 0.01; L += EXTEND_STEP) {
            const testPt = {
                x: atom.x + L * Math.cos(bestAngle),
                y: atom.y + L * Math.sin(bestAngle)
            };
            let minDist = Infinity;
            heavyAtoms.forEach(a => {
                if (a.id === atom.id) return;
                const dx = a.x - testPt.x;
                const dy = a.y - testPt.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) minDist = d;
            });
            if (minDist === Infinity || minDist >= MIN_CLEARANCE) {
                finalLength = L;
                break;
            }
            if (L + EXTEND_STEP > MAX_EXTEND) {
                finalLength = MAX_EXTEND; // 限界まで延長
            }
        }

        const finalX = atom.x + finalLength * Math.cos(bestAngle);
        const finalY = atom.y + finalLength * Math.sin(bestAngle);

        // 10. キャンバス上限チェック
        if (Math.abs(finalX) > MAX_CANVAS || Math.abs(finalY) > MAX_CANVAS) {
            return { x: finalX, y: finalY, rawX: x, rawY: y, isValid: false, snapAtom: null, tooLarge: true };
        }

        return { x: finalX, y: finalY, rawX: x, rawY: y, isValid: true, snapAtom: atom };
    }

    handleMouseMove(e) {
        if (this.pan.isPanning) {
            const viewBox = this.svg.viewBox.baseVal;
            const scale = this.svgUnitsPerPixel();
            viewBox.x = this.pan.startViewX - (e.clientX - this.pan.startX) * scale;
            viewBox.y = this.pan.startViewY - (e.clientY - this.pan.startY) * scale;
            return;
        }

        const coords = this.getSnappedCoords(e);
        this.coordDisplay.textContent = `X: ${Math.round(coords.rawX)}, Y: ${Math.round(coords.rawY)} (Snap: ${coords.x}, ${coords.y})`;
        
        // 1. 邨仙粋邱壹ラ繝ｩ繝�げ荳ｭ縺ｮ繝励Ξ繝薙Η繝ｼ謠冗判
        if (this.selectedTool === 'bond' && this.isDragging && this.bondStartAtom) {
            this.drawBondPreview(this.bondStartAtom.x, this.bondStartAtom.y, coords.rawX, coords.rawY);
        }
        // 2. 蜴溷ｭ宣�鄂ｮ繝｢繝ｼ繝会ｼ医ヤ繝ｼ繝ｫ縺� 'select' 縺九▽ 繝｢繧ｸ繝･繝ｼ繝ｫ縺碁∈謚槭＆繧後※縺�↑縺�√°縺､ 繝峨Λ繝�げ遘ｻ蜍穂ｸｭ縺ｧ縺ｪ縺�√°縺､ 繝槭え繧ｹ縺ｮ荳九↓譌｢蟄伜次蟄舌′縺ｪ縺�ｼ�
        else if (this.selectedTool === 'select' && !this.selectedModule && !this.isDragging) {
            const clickedAtom = this.findAtomAt(coords.rawX, coords.rawY);
            
            if (!clickedAtom && coords.isValid) {
                // 譛繧りｿ代＞隕ｪ蜴溷ｭ舌ｒ謗｢縺励※繝励Ξ繝薙Η繝ｼ縺ｫ郢九＄邨仙粋繧呈緒縺�
                const nearest = this.findNearestAtom(coords.x, coords.y);
                const parentAtom = nearest ? nearest.atom : null;
                this.drawAtomPreview(this.selectedAtomType, coords.x, coords.y, parentAtom);
            } else {
                // 譛牙柑縺ｪ菴咲ｽｮ縺ｧ縺ｪ縺�√∪縺溘�譌｢蟄倥い繝医Β縺ｮ荳翫↑繧峨�繝ｬ繝薙Η繝ｼ繧呈ｶ亥悉
                this.clearUIOverlay();
            }
        }
    }

    handleMouseDown(e) {
        if (e.button === 2) {
            return; // 右クリックはパン専用に予約
        }
        const coords = this.getSnappedCoords(e);
        const clickedAtom = this.findAtomAt(coords.rawX, coords.rawY);


        
        // --- 荳肴哩轤ｭ邏�繝槭�繧ｯ繝｢繝ｼ繝� (ON) 譎ゅ�迚ｹ蛻･蜃ｦ逅� ---
        if (this.asymmetricMode) {
            if (clickedAtom && clickedAtom.element === 'C') {
                this.saveState();
                clickedAtom.isAsymmetricMarked = !clickedAtom.isAsymmetricMarked;
                this.updateDrawing();
            }
            return; // 荳肴哩繝槭�繧ｯ繝｢繝ｼ繝画凾縺ｯ莉悶�驟咲ｽｮ/邱ｨ髮�虚菴懊ｒ螳悟�縺ｫ繝悶Ο繝�け
        }

        if (this.selectedTool === 'select') {
            if (this.selectedModule) {
                // 繝｢繧ｸ繝･繝ｼ繝ｫ�亥ｮ倩�蝓ｺ/迺ｰ�蛾�鄂ｮ蜃ｦ逅�
                this.placeModule(this.selectedModule, coords.x, coords.y, clickedAtom);
                this.selectedModule = null;
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
            } else if (clickedAtom) {
                if (!clickedAtom.isLocked && !clickedAtom.benzeneCenter) {
                    if (clickedAtom.element === this.selectedAtomType) {
                        // 同じ元素なら削除（消しゴム代わり）。削除の影響は対象原子のみ（開発方針 5章）
                        this.saveState();
                        this.userMolecule.removeAtom(clickedAtom.id);
                        this.autoLayoutBonds();
                        this.updateDrawing();
                    } else {
                        // 異なる元素なら上書き置換チェック（価標制限）
                        const relatedBonds = this.userMolecule.getBondsForAtom(clickedAtom.id);
                        let currentValencySum = 0;
                        relatedBonds.forEach(bond => {
                            currentValencySum += (Number(bond.type) || 1);
                        });
                        
                        const maxValency = VALENCIES[this.selectedAtomType] || 0;
                        
                        if (currentValencySum <= maxValency) {
                            // 構造を破壊せずに置換可能な場合のみ許可
                            this.saveState();
                            clickedAtom.element = this.selectedAtomType;
                            this.updateDrawing();
                        } else {
                            // 置換不可のメッセージを表示
                            const resultDiv = document.getElementById('verify-result');
                            if (resultDiv) {
                                resultDiv.textContent = `結合数が多いため、${clickedAtom.element}を${this.selectedAtomType}に置換できません。（現在の結合数: ${currentValencySum}、${this.selectedAtomType}の最大結合数: ${maxValency}）`;
                                resultDiv.className = 'result-message error';
                                resultDiv.classList.remove('hidden');
                                setTimeout(() => resultDiv.classList.add('hidden'), 3500);
                            }
                        }
                    }
                } else {
                    // ロックされた原子またはベンゼン環内の原子は移動ドラッグを開始
                    this.isDragging = true;
                    this.draggedAtom = clickedAtom;
                    this.dragStartPos = { x: clickedAtom.x, y: clickedAtom.y };
                    this.dragStartClient = { x: e.clientX, y: e.clientY };
                    this.saveState();
                }
            } else {
                // 遨ｺ縺榊慍繧偵け繝ｪ繝�け縺励◆繧牙次蟄舌ｒ譁ｰ隕城�鄂ｮ (譛牙柑縺ｪ蠅礼ｯ臥せ縺ｧ縺ゅｌ縺ｰ繧ｵ繧､繝ｬ繝ｳ繝医↓驟咲ｽｮ)
                if (coords.tooLarge) {
                    // キャンバス上限超過: 配置不可のメッセージを表示
                    const resultDiv = document.getElementById('verify-result');
                    if (resultDiv) {
                        resultDiv.textContent = '構造が大きすぎて配置できません。キャンバスの限界（±5000px）を超えています。';
                        resultDiv.className = 'result-message error';
                        resultDiv.classList.remove('hidden');
                        setTimeout(() => resultDiv.classList.add('hidden'), 3000);
                    }
                } else if (coords.isValid) {
                    this.saveState();
                    const newAtom = this.userMolecule.addAtom(this.selectedAtomType, coords.x, coords.y);
                    if (coords.snapAtom) {
                        // 拡張結合でも確実に結合を張る（autoConnect の距離閾値を超える場合があるため）
                        this.userMolecule.addBond(coords.snapAtom.id, newAtom.id, 1);
                    } else {
                        this.autoConnectAdjacentAtoms();
                    }
                    this.autoLayoutBonds();
                    this.updateDrawing();
                }
            }
        } else if (this.selectedTool === 'bond') {
            if (clickedAtom) {
                // 邨仙粋縺ｮ謠冗判髢句ｧ�
                this.isDragging = true;
                this.bondStartAtom = clickedAtom;
            }
        } else if (this.selectedTool === 'erase') {
            // 消しゴムツール: 原子または結合を消去。削除の影響は対象のみ（開発方針 5章）
            // 何も消えない空振りクリックではUndo履歴を消費しない（開発方針 3.5章）
            const clickedBond = clickedAtom ? null : this.findBondAt(coords.rawX, coords.rawY);
            if (!clickedAtom && !clickedBond) return;

            this.saveState();
            if (clickedAtom) {
                this.userMolecule.removeAtom(clickedAtom.id);
            } else {
                this.userMolecule.removeBond(clickedBond.atomId1, clickedBond.atomId2);
            }
            this.autoLayoutBonds();
            this.updateDrawing();
        }
    }

    handleMouseUp(e) {
        if (this.pan.isPanning) {
            this.pan.isPanning = false;
            this.svg.style.cursor = 'default';
            return;
        }

        if (!this.isDragging) return;
        
        const coords = this.getSnappedCoords(e);
        
        if (this.selectedTool === 'select' && this.draggedAtom) {
            // 遘ｻ蜍輔ラ繝ｩ繝�げ邨ゆｺ�ｼ壹せ繝翫ャ繝怜ｺｧ讓吶↓蝗ｺ螳�
            // マウスがほぼ動いていない「クリックしただけ」の場合は、原子を元の位置に留め、
            // Undo履歴も消費しない（開発方針 3.5章）。
            // ※以前は無移動クリックでもスナップ座標が代入され、原子が隣の候補点へ飛ぶバグがあった。
            const moved = !this.dragStartClient ||
                Math.abs(e.clientX - this.dragStartClient.x) > 3 ||
                Math.abs(e.clientY - this.dragStartClient.y) > 3;
            if (!moved && this.dragStartPos) {
                this.draggedAtom.x = this.dragStartPos.x;
                this.draggedAtom.y = this.dragStartPos.y;
                this.history.pop();
                this.updateDrawing();
            } else {
                this.draggedAtom.x = coords.x;
                this.draggedAtom.y = coords.y;
                this.autoConnectAdjacentAtoms();
                this.autoLayoutBonds();
                this.updateDrawing();
            }
            this.dragStartPos = null;
            this.dragStartClient = null;
        } else if (this.selectedTool === 'bond' && this.bondStartAtom) {
            const endAtom = this.findAtomAt(coords.rawX, coords.rawY);
            // 蛻･縺ｮ蜴溷ｭ舌↓逹蝨ｰ縺励◆縺�
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
                    // 譁ｰ隕冗ｵ仙粋繧堤ｵ舌�縺ｮ縺ｫ蜊∝�縺ｪ遨ｺ縺咲ｵ仙粋謇九′縺ゅｋ縺九メ繧ｧ繝�け
                    // 驕ｸ謚槭＆繧後◆邨仙粋谺｡謨ｰ縺後◎繧ゅ◎繧ゆｸ｡蜴溷ｭ舌�髯千阜繧定ｶ�∴縺ｦ縺�↑縺�°繧ゅメ繧ｧ繝�け
                    const maxType = this.getMaxBondType(this.bondStartAtom.element, endAtom.element);
                    const reqType = Math.min(this.selectedBondType, maxType);
                    if (this.userMolecule.getFreeValency(this.bondStartAtom.id) >= reqType && this.userMolecule.getFreeValency(endAtom.id) >= reqType) {
                        this.saveState();
                        this.userMolecule.addBond(this.bondStartAtom.id, endAtom.id, reqType);
                    }
                }
            }
            // 繝励Ξ繝薙Η繝ｼ豸亥悉
            this.clearUIOverlay();
        }
        
        this.isDragging = false;
        this.draggedAtom = null;
        this.bondStartAtom = null;
        this.autoLayoutBonds();
        this.updateDrawing();
    }

    // 蠎ｧ讓呵ｿ代￥縺ｫ縺ゅｋ蜴溷ｭ舌ｒ蜿門ｾ暦ｼ医け繝ｪ繝�け蛻､螳壼濠蠕��蠎�ａ縺ｮ28px��
    findAtomAt(x, y, radius = 28) {
        return this.userMolecule.atoms.find(atom => {
            const dx = atom.x - x;
            const dy = atom.y - y;
            return Math.sqrt(dx*dx + dy*dy) <= radius;
        }) || null;
    }

    // 蠎ｧ讓呵ｿ代￥縺ｫ縺ゅｋ邨仙粋邱壹ｒ蜿門ｾ�
    findBondAt(x, y, threshold = 10) {
        return this.userMolecule.bonds.find(bond => {
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return false;
            
            // 轤ｹ縺ｨ邱壼�縺ｮ霍晞屬
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

    // 迺ｰ繝ｻ螳倩�蝓ｺ繝｢繧ｸ繝･繝ｼ繝ｫ縺ｮ驟咲ｽｮ
    placeModule(moduleType, x, y, clickedAtom) {
        // 環モジュールかどうかの判定と初期パラメータ決定
        const isRing = (moduleType === 'benzene' || moduleType === 'cyclopentane' || moduleType === 'cyclohexane' || moduleType === 'n-ring');
        let count = 6;
        let R = GRID_SIZE * 0.833;
        
        if (isRing && moduleType === 'n-ring') {
            const input = prompt("環の員数を入力してください (3〜8):", "7");
            if (!input) return;
            const nRingCount = parseInt(input);
            if (isNaN(nRingCount) || nRingCount < 3 || nRingCount > 8) {
                alert("3から8の数値を入力してください。");
                return;
            }
            count = nRingCount;
            // 正N角形の一辺の長さを GRID_SIZE にするための外接円半径の計算公式
            R = GRID_SIZE / (2 * Math.sin(Math.PI / count));
        } else if (moduleType === 'cyclopentane') {
            R = GRID_SIZE * 0.85;
            count = 5;
        } else if (moduleType === 'cyclohexane') {
            R = GRID_SIZE;
            count = 6;
        }

        // モジュール配置時の孤立制限チェック
        if (this.userMolecule.atoms.length > 0) {
            let canPlace = false;
            if (isRing) {
                for (let i = 0; i < count; i++) {
                    let ang;
                    if (moduleType === 'benzene') {
                        ang = (i * Math.PI) / 3;
                    } else {
                        ang = i * (2 * Math.PI / count) - Math.PI / 2;
                    }
                    const bx = x + R * Math.cos(ang);
                    const by = y + R * Math.sin(ang);
                    if (this.isNearAnyExistingAtom(bx, by)) {
                        canPlace = true;
                        break;
                    }
                }
            } else if (clickedAtom) {
                canPlace = true;
            }
            if (!canPlace) return; // 孤立した位置なら配置しない
        }

        // 官能基モジュールは接続先原子が必須。配置できない場合はUndo履歴を消費せずに案内する（開発方針 3.5章）
        if (!isRing && !clickedAtom) {
            alert("官能基を結合するには、接続先の既存の原子（Cなど）をクリックしてください。");
            return;
        }

        this.saveState();

        if (isRing) {
            const newCAtoms = [];
            for (let i = 0; i < count; i++) {
                let ang;
                if (moduleType === 'benzene') {
                    ang = (i * Math.PI) / 3;
                } else {
                    ang = i * (2 * Math.PI / count) - Math.PI / 2;
                }
                // 重複原子マージ処理（縮合環・複数環の接続サポート）
                const targetX = x + R * Math.cos(ang);
                const targetY = y + R * Math.sin(ang);
                let existing = this.userMolecule.atoms.find(a => {
                    if (a.element === 'H') return false;
                    const dx = a.x - targetX;
                    const dy = a.y - targetY;
                    return Math.sqrt(dx*dx + dy*dy) <= 12; // 12px以内なら同じ原子とみなす
                });
                const c = existing ? existing : this.userMolecule.addAtom('C', targetX, targetY);
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
            // 官能基の配置
            const baseAtom = clickedAtom;
            
            // 空いている方向を特定
            const neighbors = this.userMolecule.getNeighbors(baseAtom.id);
            const angles = neighbors.map(n => Math.atan2(n.atom.y - baseAtom.y, n.atom.x - baseAtom.x));
            
            // デフォルトは右方向（0ラジアン）
            let targetAng = 0;
            if (angles.length > 0) {
                let sumX = 0, sumY = 0;
                angles.forEach(ang => {
                    sumX += Math.cos(ang);
                    sumY += Math.sin(ang);
                });
                targetAng = Math.atan2(-sumY, -sumX);
                targetAng = Math.round(targetAng / (Math.PI / 2)) * (Math.PI / 2);
            }

            const dx = GRID_SIZE * Math.cos(targetAng);
            const dy = GRID_SIZE * Math.sin(targetAng);

            if (moduleType === 'oh') {
                const o = this.userMolecule.addAtom('O', baseAtom.x + dx, baseAtom.y + dy);
                this.userMolecule.addBond(baseAtom.id, o.id, 1);
            } else if (moduleType === 'cooh') {
                const c = this.userMolecule.addAtom('C', baseAtom.x + dx, baseAtom.y + dy);
                this.userMolecule.addBond(baseAtom.id, c.id, 1);
                
                const angO1 = targetAng + Math.PI / 2;
                const o1 = this.userMolecule.addAtom('O', c.x + GRID_SIZE * Math.cos(angO1), c.y + GRID_SIZE * Math.sin(angO1));
                this.userMolecule.addBond(c.id, o1.id, 2);

                const o2 = this.userMolecule.addAtom('O', c.x + GRID_SIZE * Math.cos(targetAng), c.y + GRID_SIZE * Math.sin(targetAng));
                this.userMolecule.addBond(c.id, o2.id, 1);
            } else if (moduleType === 'nh2') {
                const n = this.userMolecule.addAtom('N', baseAtom.x + dx, baseAtom.y + dy);
                this.userMolecule.addBond(baseAtom.id, n.id, 1);
            } else if (moduleType === 'no2') {
                const nAtom = this.userMolecule.addAtom('N', baseAtom.x + dx, baseAtom.y + dy);
                this.userMolecule.addBond(baseAtom.id, nAtom.id, 1);
                const angO1 = targetAng + Math.PI / 2;
                const angO2 = targetAng - Math.PI / 2;
                const oA = this.userMolecule.addAtom('O', nAtom.x + GRID_SIZE * Math.cos(angO1), nAtom.y + GRID_SIZE * Math.sin(angO1));
                const oB = this.userMolecule.addAtom('O', nAtom.x + GRID_SIZE * Math.cos(angO2), nAtom.y + GRID_SIZE * Math.sin(angO2));
                // ニトロ基は N(=O)(-O) で構築する。N(=O)(=O) は価標超過であり、
                // 正解データ(stages.json)の結合次数とも一致しなくなる（開発方針 4章-2）。
                this.userMolecule.addBond(nAtom.id, oA.id, 2);
                this.userMolecule.addBond(nAtom.id, oB.id, 1);
            }
        }
        this.autoConnectAdjacentAtoms();
        this.autoLayoutBonds();
        this.updateDrawing();
    }

    // 邨仙粋謠冗判荳ｭ縺ｮ繝励Ξ繝薙Η繝ｼ�井ｸ譎ら噪縺ｪ遐ｴ邱夊｡ｨ遉ｺ縺ｪ縺ｩ��
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

    // 蜴溷ｭ宣�鄂ｮ繝励Ξ繝薙Η繝ｼ�亥濠騾乗�縺ｮ荳ｸ縺ｨ蜈�ｴ�險伜捷縲√♀繧医�邨仙粋邱壹�陦ｨ遉ｺ��
    drawAtomPreview(element, x, y, parentAtom) {
        this.clearUIOverlay();

        // 1. 隕ｪ蜴溷ｭ舌′縺ゅｋ蝣ｴ蜷医√◎縺薙°繧峨�繝励Ξ繝薙Η繝ｼ邨仙粋邱壹ｒ謠冗判 (蜊企乗�)
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

        // 2. 蜊企乗�縺ｮ蜴溷ｭ千帥
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', element === 'H' ? '6' : '10');
        circle.setAttribute('fill', '#0f141c');
        circle.setAttribute('stroke', `var(--color-${element.toLowerCase()})`);
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('opacity', '0.45'); // 蜊企乗�
        this.uiGroup.appendChild(circle);

        // 3. 蜊企乗�縺ｮ蜴溷ｭ先枚蟄�
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y + (element === 'H' ? 2.0 : 3.0));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'svg-atom-text');
        text.setAttribute('fill', `var(--color-${element.toLowerCase()})`);
        text.style.fontSize = element === 'H' ? '6.5px' : '9px';
        text.textContent = element;
        text.setAttribute('opacity', '0.45'); // 蜊企乗�
        this.uiGroup.appendChild(text);
    }

    // 縺薙�蜴溷ｭ舌′縲∝�蟄仙�縺ｧ莠碁㍾邨仙粋縺ｾ縺溘�荳蛾㍾邨仙粋縺ｮ縺�★繧後°繧呈怏縺吶ｋ轤ｭ邏�縺ｮ譫昴ヤ繝ｪ繝ｼ縺ｫ螻槭＠縺ｦ縺�ｋ縺句�蟶ｰ蛻､螳�
    belongsToSp2SpTree(atomId, visited = new Set()) {
        visited.add(atomId);
        
        const neighbors = this.userMolecule.getNeighbors(atomId);
        
        // 1. 閾ｪ霄ｫ縺御ｺ碁㍾邨仙粋(2)縺倶ｸ蛾㍾邨仙粋(3)縺ｫ逶ｴ謗･郢九′縺｣縺ｦ縺ｋ縺
        const hasSp2Sp = neighbors.some(n => n.type === 2 || n.type === 3);
        if (hasSp2Sp) return true;
        
        // 2. 髫｣謗･縺吶ｋ驥榊次蟄舌蜈医′郢九′縺｣縺ｦ縺ｋ縺句蟶ｰ謗｢邏｢
        for (let i = 0; i < neighbors.length; i++) {
            const nextAtom = neighbors[i].atom;
            if (nextAtom.element === 'H') continue;
            if (!visited.has(nextAtom.id)) {
                if (this.belongsToSp2SpTree(nextAtom.id, visited)) {
                    return true;
                }
            }
        }
        return false;
    }

    clearUIOverlay() {
        this.uiGroup.innerHTML = '';
    }

    // 莠碁㍾邨仙粋 (C=C) 縺ｯ 120蠎ｦ譁ｹ蜷代∽ｸ蛾㍾邨仙粋 (C竕｡C) 縺ｯ 180蠎ｦ逶ｴ邱壽婿蜷代√◎繧御ｻ･螟悶� sp3 驥榊次蟄舌�逶ｴ隗偵げ繝ｪ繝�ラ荳翫↓閾ｪ蜍輔い繧ｸ繝｣繧ｹ繝医☆繧�
    autoLayoutBonds() {
        // ドリフトバグを完全に防止するため、自動レイアウト調整は無効化しました。
        // ハイブリッドスナップが配置時点で最適な角度に吸着するため、この処理は不要です。
    }

    // 迚ｹ螳壹�蜴溷ｭ舌°繧牙�縺ｮ繧ｵ繝悶ヤ繝ｪ繝ｼ蜈ｨ菴薙ｒ蟷ｳ陦檎ｧｻ蜍輔＆縺帙ｋ蜀榊ｸｰ繝倥Ν繝代�
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

    // 豁｣隗｣縺ｮ萓狗､ｺ�医♀謇区悽�峨ｒ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ縺吶ｋ
    renderTargetAnswer() {
        this.targetBonds.innerHTML = '';
        this.targetAtoms.innerHTML = '';

        const targetMol = this.createTargetFromData(STAGES[this.currentStageIndex]);
        const heavyAtoms = targetMol.atoms.filter(a => a.element !== 'H');
        if (heavyAtoms.length === 0) return;

        // 1. 繝舌え繝ｳ繝�ぅ繝ｳ繧ｰ繝懊ャ繧ｯ繧ｹ縺ｮ險育ｮ励→繧ｻ繝ｳ繧ｿ繝ｪ繝ｳ繧ｰ
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        heavyAtoms.forEach(a => {
            if (a.x < minX) minX = a.x;
            if (a.x > maxX) maxX = a.x;
            if (a.y < minY) minY = a.y;
            if (a.y > maxY) maxY = a.y;
        });

        // 繧ｿ繝ｼ繧ｲ繝�ヨ蛛ｴ豌ｴ邏�繧ょ性繧√ｋ縺溘ａ縲∵ｰｴ邏�繧りｨ育ｮ�
        const hydrogens = targetMol.calculateHydrogens();
        hydrogens.forEach(h => {
            if (h.x < minX) minX = h.x;
            if (h.x > maxX) maxX = h.x;
            if (h.y < minY) minY = h.y;
            if (h.y > maxY) maxY = h.y;
        });

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        // target-svg 縺ｮ荳ｭ蠢� (200, 200) 縺ｫ蟷ｳ陦檎ｧｻ蜍輔☆繧九◆繧√�繧ｪ繝輔そ繝�ヨ
        const offsetX = 200 - cx;
        const offsetY = 200 - cy;

        // 2. 邨仙粋縺ｮ謠冗判
        // 竭� 豌ｴ邏�縺ｮ邨仙粋
        hydrogens.forEach(h => {
            const parent = targetMol.atoms.find(a => a.id === h.parentId);
            if (parent) {
                this.renderTargetBond(parent.x + offsetX, parent.y + offsetY, h.x + offsetX, h.y + offsetY, 1, true);
            }
        });

        // 竭｡ 驥榊次蟄宣俣縺ｮ邨仙粋
        targetMol.bonds.forEach(bond => {
            const a1 = targetMol.atoms.find(a => a.id === bond.atomId1);
            const a2 = targetMol.atoms.find(a => a.id === bond.atomId2);
            if (a1 && a2 && a1.element !== 'H' && a2.element !== 'H') {
                this.renderTargetBond(a1.x + offsetX, a1.y + offsetY, a2.x + offsetX, a2.y + offsetY, bond.type, false);
            }
        });

        // 3. 蜴溷ｭ舌�謠冗判
        // 竭� 豌ｴ邏�
        hydrogens.forEach(h => {
            this.renderTargetAtom(h.element, h.x + offsetX, h.y + offsetY);
        });

        // 竭｡ 驥榊次蟄�
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

    // SVG謠冗判縺ｮ譖ｴ譁ｰ
    updateDrawing() {
        this.atomsGroup.innerHTML = '';
        this.bondsGroup.innerHTML = '';
        
        // 閾ｪ蜍戊｣懷ｮ梧ｰｴ邏�(H)縺ｮ險育ｮ�
        const hydrogens = this.userMolecule.calculateHydrogens();

        // 1. 豌ｴ邏�(H)縺ｮ邨仙粋邱壹�縺ｿ繧呈怙閭碁擇縺ｫ謠冗判�亥､ｪ縺�㍾蜴溷ｭ宣俣邨仙粋縺ｮ荳九ｒ騾壹☆��
        hydrogens.forEach(h => {
            const parent = this.userMolecule.atoms.find(a => a.id === h.parentId);
            if (parent) {
                this.renderBond(parent.x, parent.y, h.x, h.y, 1, true); // 豌ｴ邏�縺ｮ邨仙粋縺ｯ蟶ｸ縺ｫ蜊倡ｵ仙粋
            }
        });

        // 2. 驥榊次蟄宣俣縺ｮ邨仙粋邱壹ｒ謠冗判
        this.userMolecule.bonds.forEach(bond => {
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return;
            
            this.renderBond(a1.x, a1.y, a2.x, a2.y, bond.type, false, bond);
        });

        // 3. 豌ｴ邏�蜴溷ｭ�(H)閾ｪ菴薙�謠冗判
        hydrogens.forEach(h => {
            this.renderAtom(h.id, h.element, h.x, h.y, false);
        });

        // 4. 驥榊次蟄舌�謠冗判 (荳逡ｪ謇句燕縺ｫ謠上￥縺溘ａ譛蠕後↓陦後≧)
        this.userMolecule.atoms.forEach(atom => {
            this.renderAtom(atom.id, atom.element, atom.x, atom.y, atom.isLocked, atom.isAsymmetricMarked);
        });
    }

    renderAtom(id, element, x, y, isLocked, isAsymmetricMarked = false) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'svg-atom-node');
        group.setAttribute('data-id', id);
        
        // 蜴溷ｭ千帥�郁レ譎ｯ��
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', element === 'H' ? '6' : '10'); // 蜴溷ｭ舌�螟ｧ縺阪＆繧堤ｴ�80%縺ｫ邵ｮ蟆� (H:6px, 驥榊次蟄�:10px)
        circle.setAttribute('fill', '#0f141c');
        circle.setAttribute('stroke', `var(--color-${element.toLowerCase()})`);
        circle.setAttribute('stroke-width', '2');
        if (isLocked) {
            circle.setAttribute('stroke-dasharray', '3,3');
        }
        
        // 蜴溷ｭ先枚蟄�
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y + (element === 'H' ? 2.0 : 3.0)); // 譁�ｭ励�蝙ら峩謠�∴繧貞ｰ上＆縺上↑縺｣縺溷濠蠕�↓蜷医ｏ縺帙※蠕ｮ隱ｿ謨ｴ
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'svg-atom-text');
        text.setAttribute('fill', `var(--color-${element.toLowerCase()})`);
        text.style.fontSize = element === 'H' ? '6.5px' : '9px'; // 繝輔か繝ｳ繝医し繧､繧ｺ繧らｸｮ蟆�
        text.textContent = element;

        group.appendChild(circle);
        group.appendChild(text);

        // 荳肴哩轤ｭ邏�繝槭�繧ｯ (*) 縺ｮ謠冗判
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

        // 蜴溷ｭ舌Λ繝吶Ν縺ｨ驥阪↑繧峨↑縺�ｈ縺�∫ｫｯ繧貞ｰ代＠邵ｮ繧√ｋ (驥榊次蟄舌�蜊雁ｾ�10, 豌ｴ邏�縺ｯ蜊雁ｾ�6縺ｫ驕ｩ蜷�)
        const offsetStart = 10;
        const offsetEnd = isHConnection ? 6 : 10;
        
        const sx = x1 + ux * offsetStart;
        const sy = y1 + uy * offsetStart;
        const ex = x2 - ux * offsetEnd;
        const ey = y2 - uy * offsetEnd;

        const strokeColor = isHConnection ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.4)';

        // 1. 隕九◆逶ｮ縺ｮ邱夲ｼ医ン繧ｸ繝･繧｢繝ｫ�峨ｒ謠冗判縺吶ｋ
        if (type === 1) {
            // 蜊倡ｵ仙粋
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', sx);
            line.setAttribute('y1', sy);
            line.setAttribute('x2', ex);
            line.setAttribute('y2', ey);
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-width', '3');
            line.setAttribute('pointer-events', 'none'); // 繧ｯ繝ｪ繝�け蛻､螳壹ｒ騾城℃
            this.bondsGroup.appendChild(line);
        } else if (type === 2) {
            // 莠碁㍾邨仙粋 (蟷ｳ陦後↑2譛ｬ縺ｮ邱�)
            const nx = -uy;
            const ny = ux;
            const gap = 5; // 邱壹←縺�＠縺ｮ髫咎俣繧貞ｺ�￡縺ｦ隕冶ｪ肴ｧ繧｢繝��

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
            // 荳蛾㍾邨仙粋
            const nx = -uy;
            const ny = ux;
            const gap = 6.5;

            // 荳ｭ螟ｮ縲∝ｷｦ縲∝承
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

        // 2. 蛻､螳夂畑縺ｮ騾乗�縺ｪ螟ｪ縺�ｷ壹ｒ驥阪�縺ｦ謠冗判縺励√け繝ｪ繝�け繝ｻ繝繝悶Ν繧ｯ繝ｪ繝�け繧､繝吶Φ繝医ｒ繧｢繧ｿ繝�メ縺吶ｋ
        if (!isHConnection && bondObj) {
            const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hitLine.setAttribute('x1', sx);
            hitLine.setAttribute('y1', sy);
            hitLine.setAttribute('x2', ex);
            hitLine.setAttribute('y2', ey);
            hitLine.setAttribute('stroke', '#ffffff');
            hitLine.setAttribute('stroke-opacity', '0'); // 繧､繝吶Φ繝医ｒ讀懃衍縺吶ｋ騾乗�險ｭ螳�
            hitLine.setAttribute('stroke-width', '20');    // 蛻､螳夂ｯ�峇繧偵＆繧峨↓蠎�￡縺ｦ20px縺ｫ險ｭ螳夲ｼ医け繝ｪ繝�け縺励ｄ縺吶￥��
            hitLine.style.cursor = 'pointer';
            hitLine.setAttribute('class', 'svg-bond-hitbox');
            
            // 繝阪う繝�ぅ繝悶�click縺ｨdblclick繧､繝吶Φ繝医ｒ菴ｿ逕ｨ縺励√ち繧､繝槭�驕�ｻｶ繧貞ｮ悟�縺ｫ謗帝勁
            hitLine.addEventListener('pointerdown', (e) => {
                e.stopPropagation(); // キャンバス側のpointerdown（原子の配置・削除）が走るのを阻止
            });
            hitLine.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // 繧ｭ繝｣繝ｳ繝舌せ蜈ｨ菴薙�mousedown�亥次蟄舌�荳頑嶌縺阪�驟咲ｽｮ�峨′襍ｰ繧九�繧貞ｮ悟�縺ｫ髦ｻ豁｢��
            });
            hitLine.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleBondInteraction(bondObj, false); // 繧ｷ繝ｳ繧ｰ繝ｫ繧ｯ繝ｪ繝�け縺ｧ谺｡謨ｰ繝医げ繝ｫ
            });
            hitLine.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.handleBondInteraction(bondObj, true); // 繝繝悶Ν繧ｯ繝ｪ繝�け縺ｧ蛻�妙
            });
            hitLine.addEventListener('contextmenu', (e) => {
                e.preventDefault(); // 繝悶Λ繧ｦ繧ｶ縺ｮ蜿ｳ繧ｯ繝ｪ繝�け繝｡繝九Η繝ｼ繧呈椛蛻ｶ
                e.stopPropagation();
                this.handleBondInteraction(bondObj, true); // 蜿ｳ繧ｯ繝ｪ繝�け縺ｧ蛻�妙
            });
            this.bondsGroup.appendChild(hitLine);
        }
    }

    // 迴ｾ蝨ｨ邨�∩遶九※繧峨ｌ縺ｦ縺�ｋ蛻�ｭ舌�讀懆ｨｼ
    verifyCurrentStructure() {
        const stage = STAGES[this.currentStageIndex];
        const targetMolecule = this.createTargetFromData(stage);
        
        this.verifyResult.classList.remove('hidden');
        this.verifyResult.className = "result-message animate-pulse";
        this.verifyResult.textContent = "判定中...";
        
        // 蟆代＠驕�ｻｶ繧貞�繧後※蛻､螳夲ｼ医ご繝ｼ繝�逧�ｼ泌���
        setTimeout(() => {
            // 1. 蛻�ｭ舌ヨ繝昴Ο繧ｸ繝ｼ讒矩�縺ｮ荳閾ｴ蛻､螳�
            const isStructureCorrect = verifyMolecule(this.userMolecule, targetMolecule);
            if (!isStructureCorrect) {
                this.verifyResult.className = "result-message error";
                this.verifyResult.textContent = "不一致です。結合の数や種類、繋がっている原子の順番を確認してください。";
                return;
            }

            // 2. 荳肴哩轤ｭ邏�繝槭�繧ｯ繝｢繝ｼ繝� (ON) 譎ゅ�荳肴哩轤ｭ邏�繝槭�繧ｯ蛻､螳�
            if (this.asymmetricMode) {
                // 繝ｦ繝ｼ繧ｶ繝ｼ縺ｮ蜈ｨ轤ｭ邏����峨↓縺､縺�※縲∵悽迚ｩ縺ｧ縺ゅｋ縺九→繝槭�繧ｯ迥ｶ諷九′荳閾ｴ縺励※縺�ｋ縺玖ｵｰ譟ｻ
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
                    this.verifyResult.textContent = "分子構造は合っていますが、不斉炭素（*）のマーク指定が正しくありません。\n" + asymmetricErrors[0];
                    return;
                }
            }

            // 3. 縺吶∋縺ｦ蜷域�ｼ
            this.verifyResult.className = "result-message success";
            this.verifyResult.textContent = "正解です！構造および不斉炭素の位置が完全に一致しました！";
            
            // 蜍晏茜繝｢繝ｼ繝繝ｫ縺ｮ陦ｨ遉ｺ
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

    // 髫｣謗･縺吶ｋ驥榊次蟄舌←縺�＠繧定�蜍輔〒蜊倡ｵ仙粋縺ｧ邨舌� (繧ｰ繝ｪ繝�ラ謗･邯壹�60px縺ｫ蜴ｳ譬ｼ縺ｫ蛻ｶ髯�)
    autoConnectAdjacentAtoms() {
        const threshold = GRID_SIZE + 2; // GRID_SIZE 莉倩ｿ代�縺ｿ險ｱ蜿ｯ縺吶ｋ繧医≧蜴ｳ譬ｼ蛹�
        const atoms = this.userMolecule.atoms;
        
        for (let i = 0; i < atoms.length; i++) {
            for (let j = i + 1; j < atoms.length; j++) {
                const a1 = atoms[i];
                const a2 = atoms[j];
                
                // 豌ｴ邏�(H)縺ｯ閾ｪ蜍戊｣懷ｮ後＆繧後ｋ縺溘ａ辟｡隕�
                if (a1.element === 'H' || a2.element === 'H') continue;
                
                const dx = a1.x - a2.x;
                const dy = a1.y - a2.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist <= threshold) {
                    // 蝓ｺ譛ｬ�壽ｰｴ蟷ｳ縺ｾ縺溘�蝙ら峩縺ｫ逶ｴ邱壻ｸ翫↓荳ｦ繧薙〒縺�ｋ蝣ｴ蜷医�縺ｿ閾ｪ蜍慕ｵ仙粋
                    const isHorizontal = Math.abs(dy) < 2; // 險ｱ螳ｹ繧ｺ繝ｬ繧�2px縺ｫ蜴ｳ譬ｼ蛹�
                    const isVertical = Math.abs(dx) < 2;
                    let allowConnect = isHorizontal || isVertical;

                    // 縲蝉ｾ句､�1縲代�繝ｳ繧ｼ繝ｳ迺ｰ縺ｮ繧ｹ繝翫ャ繝励ぎ繧､繝臥せ縺ｫ鄂ｮ縺九ｌ縺溷次蟄舌�蝣ｴ蜷�
                    if (!allowConnect) {
                        const checkBenzeneGuide = (benzeneAtom, targetAtom) => {
                            if (benzeneAtom.benzeneCenter && benzeneAtom.benzeneAngle !== undefined) {
                                // 繝吶Φ繧ｼ繝ｳ鬆らせ縺九ｉ螟門�縺ｫ莨ｸ縺ｰ縺励◆繧ｬ繧､繝臥せ (GRID_SIZE * 1.666 = 70px)
                                const sx = benzeneAtom.benzeneCenter.x + (GRID_SIZE * 1.666) * Math.cos(benzeneAtom.benzeneAngle);
                                const sy = benzeneAtom.benzeneCenter.y + (GRID_SIZE * 1.666) * Math.sin(benzeneAtom.benzeneAngle);
                                const d = Math.sqrt((targetAtom.x - sx)**2 + (targetAtom.y - sy)**2);
                                return d < 2; // 螳悟�縺ｫ繧ｹ繝翫ャ繝怜精逹縺励※縺�ｋ縺溘ａ2px莉･蜀�〒蛻､螳�
                            }
                            return false;
                        };
                        if (checkBenzeneGuide(a1, a2) || checkBenzeneGuide(a2, a1)) {
                            allowConnect = true;
                        }
                    }

                    // 縲蝉ｾ句､�2縲舛=C 莠碁㍾邨仙粋縺ｮ120蠎ｦ繧ｹ繝翫ャ繝励ぎ繧､繝臥せ縺ｫ鄂ｮ縺九ｌ縺溷次蟄舌�蝣ｴ蜷�
                    if (!allowConnect) {
                        const checkCcGuide = (cAtom, targetAtom) => {
                            if (cAtom.element !== 'C') return false;
                            
                            // 逶ｸ謇句�縺ｮ莠碁㍾邨仙粋轤ｭ邏�繧呈爾縺�
                            const neighbors = this.userMolecule.getNeighbors(cAtom.id);
                            const dbNeighbor = neighbors.find(n => n.atom.element === 'C' && n.type === 2);
                            if (dbNeighbor) {
                                const baseAngle = Math.atan2(dbNeighbor.atom.y - cAtom.y, dbNeighbor.atom.x - cAtom.x);
                                // 120蠎ｦ螟門�縺ｮ繧ｬ繧､繝臥せ�郁ｷ晞屬 GRID_SIZE��
                                const angles = [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3];
                                return angles.some(ang => {
                                    const sx = cAtom.x + GRID_SIZE * Math.cos(ang);
                                    const sy = cAtom.y + GRID_SIZE * Math.sin(ang);
                                    const d = Math.sqrt((targetAtom.x - sx)**2 + (targetAtom.y - sy)**2);
                                    return d < 2; // 螳悟�縺ｫ繧ｹ繝翫ャ繝怜精逹縺励※縺�ｋ縺溘ａ2px莉･蜀�〒蛻､螳�
                                });
                            }
                            return false;
                        };
                        if (checkCcGuide(a1, a2) || checkCcGuide(a2, a1)) {
                            allowConnect = true;
                        }
                    }

                    if (allowConnect) {
                        // 譌｢縺ｫ邨仙粋縺悟ｭ伜惠縺励↑縺��ｴ蜷医√°縺､謇句虚蜑企勁螻･豁ｴ縺ｫ蜷ｫ縺ｾ繧後↑縺��ｴ蜷医√°縺､荳｡蜴溷ｭ舌↓遨ｺ縺肴焔縺�1莉･荳翫≠繧句�ｴ蜷医�縺ｿ蜊倡ｵ仙粋(1)繧定ｿｽ蜉�縺吶ｋ
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

    // 邨仙粋縺ｮ繧ｯ繝ｪ繝�け繝ｻ繝繝悶Ν繧ｯ繝ｪ繝�け繧､繝ｳ繧ｿ繝ｩ繧ｯ繧ｷ繝ｧ繝ｳ
    handleBondInteraction(bond, isDoubleClick) {
        if (isDoubleClick) {
            // 繝繝悶Ν繧ｯ繝ｪ繝�け縺ｧ邨仙粋縺ｮ蛻�妙�亥炎髯､��
            this.saveState();
            this.userMolecule.removeBond(bond.atomId1, bond.atomId2);
            this.updateDrawing();
        } else {
            // 繧ｷ繝ｳ繧ｰ繝ｫ繧ｯ繝ｪ繝�け縺ｧ邨仙粋谺｡謨ｰ縺ｮ繝医げ繝ｫ (遘ｻ陦悟庄閭ｽ縺ｪ譛牙柑縺ｪ谺｡謨ｰ繧呈爾邏｢)
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return;

            const maxType = this.getMaxBondType(a1.element, a2.element);
            if (maxType <= 1) return; // 蜊倡ｵ仙粋縺励°菴懊ｌ縺ｪ縺�ｵ仙粋�井ｾ�: C-Cl�峨�螟画峩荳榊庄

            const currentType = Number(bond.type) || 1;
            let nextType = currentType;
            let found = false;

            // 譛螟ｧ maxType 蝗槭Ν繝ｼ繝励＠縺ｦ縲∵ｬ｡縺ｫ遘ｻ陦悟庄閭ｽ縺ｪ邨仙粋谺｡謨ｰ繧呈爾邏｢縺吶ｋ
            for (let i = 1; i <= maxType; i++) {
                let testType = currentType + i;
                if (testType > maxType) {
                    testType = 1;
                }
                if (testType === currentType) break; // 荳蜻ｨ縺励◆繧臥ｵゆｺ�

                const diff = testType - currentType;
                const free1 = this.userMolecule.getFreeValency(bond.atomId1);
                const free2 = this.userMolecule.getFreeValency(bond.atomId2);

                // 貂帙ｉ縺吶ヨ繧ｰ繝ｫ縺ｧ縺ゅｋ縺九√∪縺溘�蠅励ｄ縺吶�縺ｫ蜊∝�縺ｪ遨ｺ縺肴焔縺後≠繧句�ｴ蜷医�縺ｿ險ｱ蜿ｯ
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
    // 謖�ｮ壹＆繧後◆蠎ｧ讓吶�霑代￥縺ｫ譌｢蟄倥�蜴溷ｭ舌′縺ゅｋ縺九メ繧ｧ繝�け縺吶ｋ
    isNearAnyExistingAtom(x, y, threshold = 75) {
        const nearest = this.findNearestAtom(x, y);
        return nearest ? nearest.distance <= threshold : false;
    }

    // 謖�ｮ壹＆繧後◆蠎ｧ讓吶°繧画怙繧りｿ代＞譌｢蟄伜次蟄舌ｒ謗｢縺�
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

    // 豁｣隗｣繧ｿ繝ｼ繧ｲ繝�ヨ蛻�ｭ舌�螟ｧ縺阪＆縺ｫ繧ｭ繝｣繝ｳ繝舌せ繧定�蜍輔ヵ繧｣繝�ヨ縺輔○繧�
    fitCanvasToTarget() {
        const stage = STAGES[this.currentStageIndex];
        const targetMolecule = this.createTargetFromData(stage);
        
        const bounds = this.calculateTargetBounds(targetMolecule);
        const W = bounds.maxX - bounds.minX;
        const H = bounds.maxY - bounds.minY;
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        
        // 菴咏區繧貞性繧√◆隕夜㍽縺ｮ蠎�＆繧定ｨ育ｮ� (GRID_SIZE = 60縺ｪ縺ｮ縺ｧ縲∝ｷｦ蜿ｳ120px縲∽ｸ贋ｸ�90px遞句ｺｦ縺ｮ菴咏區)
        let viewW = Math.max(360, W + 240); // 譛蟆丞ｹ�ｒ360px縺ｫ險ｭ螳�
        let viewH = Math.max(270, H + 180); // 譛蟆城ｫ倥＆繧�270px縺ｫ險ｭ螳�
        
        // 繧｢繧ｹ繝壹け繝域ｯ斐ｒ 4:3 (800:600) 縺ｫ邯ｭ謖√☆繧�
        if (viewW / viewH > 4 / 3) {
            viewH = viewW * (3 / 4);
        } else {
            viewW = viewH * (4 / 3);
        }
        
        const vx = cx - viewW / 2;
        const vy = cy - viewH / 2;
        
        this.svg.setAttribute('viewBox', `${vx} ${vy} ${viewW} ${viewH}`);
    }

    // 繧ｿ繝ｼ繧ｲ繝�ヨ蛻�ｭ舌�蠎ｧ讓吝｢�阜繧定ｨ育ｮ�
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

    // 謗･邯壹＠縺ｦ縺�ｋ2縺､縺ｮ蜴溷ｭ舌�蜈�ｴ�遞ｮ縺九ｉ縲∝喧蟄ｦ逧�↓蜿悶ｊ蠕励ｋ譛螟ｧ邨仙粋谺｡謨ｰ (1:蜊�, 2:莠碁㍾, 3:荳蛾㍾) 繧定ｿ斐☆
    getMaxBondType(element1, element2) {
        const getValency = (elem) => {
            switch(elem) {
                case 'C': return 4;
                case 'N': return 3;
                case 'O': return 2;
                case 'Cl': return 1;
                case 'Br': return 1;
                case 'S': return 6;
                case 'H': return 1;
                default: return 1;
            }
        };
        // 荳｡蜴溷ｭ舌譛€螟ｧ謇九譛€蟆丞€､縲√°縺､迴ｾ螳溘蜈ｱ譛臥ｵ仙粋縺ｮ譛€螟ｧ谺｡謨ｰ縺ｧ縺ゅｋ 3 繧帝剞逡悟€､縺ｨ縺吶ｋ
        return Math.min(getValency(element1), getValency(element2), 3);
    }
}

// 起動
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const jsonUrl = new URL('stages.json', window.location.href).href;
        const response = await fetch(jsonUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        STAGES = await response.json();
        window.game = new Game();
    } catch (e) {
        console.error('Failed to load stages.json:', e);
        const resultDiv = document.getElementById('verify-result');
        if (resultDiv) {
            resultDiv.textContent = 'エラー: 問題データ(stages.json)のロードに失敗しました。ローカルサーバー(http://localhost:8080など)経由で起動してください。';
            resultDiv.className = 'result-message error';
            resultDiv.classList.remove('hidden');
        }
    }
});
