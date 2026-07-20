/**
 * Game Logic for Chem-Assembler
 * 画面の描画更新、インタラクション、ステージ進行、およびUIイベントを制御します。
 */

let STAGES = [];
let COMPOUNDS = []; // 名称判定用の追加ライブラリ（compounds.json。ステージ未収録の有名化合物）
const GRID_SIZE = 42;

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
        this.bondStretch = null;        // 結合線の伸縮ドラッグ状態（P6-2b）
        this.suppressBondClick = false; // 伸縮ドラッグ直後の合成clickで次数トグルしないためのフラグ
        
        // 履歴スタック (簡易Undo用)
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

        // 正解の例示・不斉炭素関連のDOM要素
        this.btnShowTarget = document.getElementById('btn-show-target');
        this.btnCloseTarget = document.getElementById('btn-close-target');
        this.targetModal = document.getElementById('target-modal');
        this.checkAsymmetricMode = document.getElementById('check-asymmetric-mode');
        this.targetBonds = document.getElementById('target-bonds');
        this.targetAtoms = document.getElementById('target-atoms');
        this.winMolDetails = document.getElementById('win-mol-details');

        // ステージ選択肢の追加
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

        // 結合次数切替
        document.querySelectorAll('.bond-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.bond-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedBondType = parseInt(btn.dataset.bond);
                
                // 結合次数を選択した場合、操作モードを強制的に「結合」にする
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
                
                // 原子を選択した場合、操作モードを強制的に「選択（配置）」にする
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

        // アクションボタン
        this.btnVerify.addEventListener('click', () => this.verifyCurrentStructure());
        // 作図エクスポート（P7-3）
        const btnExport = document.getElementById('btn-export-json');
        if (btnExport) {
            btnExport.addEventListener('click', () => this.exportMoleculeJson());
        }

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
        // キャンバス上の入力はPointer Eventsに統一済み（本メソッド冒頭のpointerdown/move/up参照）
        
        // キーボードショートカット (Undo, 全消去など)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.key === 'Delete') {
                e.preventDefault();
                if (this.userMolecule.atoms.length === 0) return; // 空のときは何もしない（開発方針 3.5章）
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
        
        // 不斉炭素モードを解除し、チェックボックスをOFFに初期化
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

    // マウス位置からグリッド座標へのスナップ (結合可能な交点へのマグネット吸着)
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

        // 5. 隣接重原子を取得
        const neighbors = this.userMolecule.getNeighbors(atom.id)
            .filter(n => n.atom.element !== 'H');

        // 6. 結合数と環属性に応じて候補角度を決定
        let candidateAngles = [];
        let ringSplit = null; // 側鎖2本目の振り分け情報（P6-3）

        if (isInRing) {
            // 【環状原子の場合】: 環の結合（橋でない結合）と側鎖（橋の結合）を橋判定で区別する
            const ringNeighbors = [];
            const substituents = [];
            neighbors.forEach(n => {
                const b = this.userMolecule.getBond(atom.id, n.atom.id);
                if (b && this.collectComponent(n.atom.id, b).has(atom.id)) {
                    ringNeighbors.push(n); // この結合を切っても繋がっている = 環の結合
                } else {
                    substituents.push(n); // 橋 = 側鎖
                }
            });

            if (ringNeighbors.length === 2 && substituents.length === 0) {
                // 側鎖1本目: 外向き二等分線の方向
                candidateAngles = [this.outwardBisector(atom, ringNeighbors)];
            } else if (ringNeighbors.length === 2 && substituents.length === 1) {
                // 側鎖2本目: 二等分線±30°に振り分ける（P6-3）
                const outward = this.outwardBisector(atom, ringNeighbors);
                const SPLIT = Math.PI / 6;
                candidateAngles = [outward - SPLIT, outward + SPLIT];
                // 既存の側鎖が二等分線上にあれば、配置確定時に反対側へ移す（計画はbestAngle決定後に確定）
                const sub = substituents[0].atom;
                let diff = Math.abs(Math.atan2(sub.y - atom.y, sub.x - atom.x) - outward);
                while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                if (diff < 0.12) { // 約7度以内なら二等分線上とみなす
                    ringSplit = { outward, sub };
                }
            } else {
                // 縮合環の頂点（環結合3本以上）など: 直交(90度)候補にフォールバック
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
            // 全方向が既存原子で塞がっている → 配置禁止（P6-2a）
            return { x: atom.x, y: atom.y, rawX: x, rawY: y, isValid: false, snapAtom: null, noSpace: true };
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

        // 8.5 側鎖の振り分け計画（P6-3）: 既存の側鎖（とその先の枝全体）を
        //     二等分線の反対側へ平行移動させる。移動先が塞がっている場合は移動しない。
        let adjust = null;
        if (ringSplit) {
            const mirrorAngle = 2 * ringSplit.outward - bestAngle;
            const sub = ringSplit.sub;
            const subLen = Math.hypot(sub.x - atom.x, sub.y - atom.y);
            const newSubX = atom.x + subLen * Math.cos(mirrorAngle);
            const newSubY = atom.y + subLen * Math.sin(mirrorAngle);
            const subBond = this.userMolecule.getBond(atom.id, sub.id);
            const ids = [...this.collectComponent(sub.id, subBond)];
            const dx = newSubX - sub.x;
            const dy = newSubY - sub.y;

            const movingSet = new Set(ids);
            const staticHeavy = heavyAtoms.filter(a => !movingSet.has(a.id) && a.id !== atom.id);
            const collides = ids.some(id => {
                const a = this.userMolecule.atoms.find(at => at.id === id);
                if (!a) return false;
                const nx = a.x + dx;
                const ny = a.y + dy;
                return staticHeavy.some(sa => Math.hypot(sa.x - nx, sa.y - ny) < MIN_CLEARANCE);
            });
            if (!collides) {
                adjust = {
                    ids, dx, dy,
                    // プレビュー用: 環原子→移動後の側鎖位置
                    ghost: { fromX: atom.x, fromY: atom.y, toX: newSubX, toY: newSubY }
                };
            }
        }
        const adjustSet = adjust ? new Set(adjust.ids) : null;

        // 9. 最良角度で結合長を調整
        //    MIN_CLEARANCE を満たすまで段階的に延長（最大 MAX_EXTEND まで）
        //    振り分けで移動する原子は移動後の位置で間隔を評価する
        let finalLength = null;
        for (let L = BOND_LENGTH; L <= MAX_EXTEND + 0.01; L += EXTEND_STEP) {
            const testPt = {
                x: atom.x + L * Math.cos(bestAngle),
                y: atom.y + L * Math.sin(bestAngle)
            };
            let minDist = Infinity;
            heavyAtoms.forEach(a => {
                if (a.id === atom.id) return;
                let ax = a.x;
                let ay = a.y;
                if (adjustSet && adjustSet.has(a.id)) {
                    ax += adjust.dx;
                    ay += adjust.dy;
                }
                const dx = ax - testPt.x;
                const dy = ay - testPt.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) minDist = d;
            });
            if (minDist === Infinity || minDist >= MIN_CLEARANCE) {
                finalLength = L;
                break;
            }
        }

        // 最大延長でも重なりを避けられない場合は配置を禁止する（P6-2a）。
        // ユーザーは結合線のドラッグ（伸長）で空間を作ってから配置する。
        if (finalLength === null) {
            const px = atom.x + MAX_EXTEND * Math.cos(bestAngle);
            const py = atom.y + MAX_EXTEND * Math.sin(bestAngle);
            return { x: px, y: py, rawX: x, rawY: y, isValid: false, snapAtom: null, noSpace: true };
        }

        const finalX = atom.x + finalLength * Math.cos(bestAngle);
        const finalY = atom.y + finalLength * Math.sin(bestAngle);

        // 10. キャンバス上限チェック
        if (Math.abs(finalX) > MAX_CANVAS || Math.abs(finalY) > MAX_CANVAS) {
            return { x: finalX, y: finalY, rawX: x, rawY: y, isValid: false, snapAtom: null, tooLarge: true };
        }

        return { x: finalX, y: finalY, rawX: x, rawY: y, isValid: true, snapAtom: atom, adjust };
    }

    // 環内原子の「外向き二等分線」角度（2本の環結合の平均方向の逆）を返す
    outwardBisector(atom, ringNeighbors) {
        let sumX = 0, sumY = 0;
        ringNeighbors.forEach(n => {
            const ang = Math.atan2(n.atom.y - atom.y, n.atom.x - atom.x);
            sumX += Math.cos(ang);
            sumY += Math.sin(ang);
        });
        return Math.atan2(-sumY, -sumX);
    }

    handleMouseMove(e) {
        if (this.pan.isPanning) {
            const viewBox = this.svg.viewBox.baseVal;
            const scale = this.svgUnitsPerPixel();
            viewBox.x = this.pan.startViewX - (e.clientX - this.pan.startX) * scale;
            viewBox.y = this.pan.startViewY - (e.clientY - this.pan.startY) * scale;
            return;
        }
        // 結合線の伸縮ドラッグ中はその更新のみ行う
        if (this.bondStretch) {
            this.updateBondStretch(e);
            return;
        }
        // 反応機構モード中はプレビュー等のパズル系処理を行わない（生成物予測モード中は許可）
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return;

        const coords = this.getSnappedCoords(e);
        this.coordDisplay.textContent = `X: ${Math.round(coords.rawX)}, Y: ${Math.round(coords.rawY)} (Snap: ${coords.x}, ${coords.y})`;
        
        // 1. 結合線ドラッグ中のプレビュー描画
        if (this.selectedTool === 'bond' && this.isDragging && this.bondStartAtom) {
            this.drawBondPreview(this.bondStartAtom.x, this.bondStartAtom.y, coords.rawX, coords.rawY);
        }
        // 2. 原子配置モード（ツールが 'select' かつ モジュール未選択、かつ ドラッグ移動中でない、かつ マウスの下に既存原子がない）
        else if (this.selectedTool === 'select' && !this.selectedModule && !this.isDragging) {
            const clickedAtom = this.findAtomAt(coords.rawX, coords.rawY);

            if (!clickedAtom && coords.isValid) {
                // 配置時に実際に形成される結合と同一の判定でプレビューを描く（プレビュー＝実結果を保証）
                const bondTargets = this.getPlacementBondTargets(coords);
                this.drawAtomPreview(this.selectedAtomType, coords.x, coords.y, bondTargets, coords.adjust);
            } else {
                // 有効な位置でない、または既存原子の上ならプレビューを消去
                this.clearUIOverlay();
            }
        }
    }

    // 新しい原子を coords に配置したときに結合すべき既存原子のリストを返す。
    // プレビューと実配置の両方がこの関数を使うことで「プレビュー＝実際にできる結合」を保証する。
    // 複数の原子と隣接できる位置（格子の交点など）では可能な結合をすべて返す（環を閉じられる）。
    getPlacementBondTargets(coords) {
        if (!coords.isValid) return [];
        const targets = [];
        const seen = new Set();
        const addTarget = (atom) => {
            if (atom && !seen.has(atom.id)) {
                seen.add(atom.id);
                targets.push(atom);
            }
        };

        // 1. スナップ元の原子（延長結合の場合は隣接判定距離を超えるため明示的に含める）
        if (coords.snapAtom) addTarget(coords.snapAtom);

        // 2. 配置点に直交方向で隣接し、空き価標のある重原子（autoConnectと同じ整列条件）
        const threshold = GRID_SIZE + 2;
        this.userMolecule.atoms.forEach(a => {
            if (a.element === 'H' || seen.has(a.id)) return;
            const dx = a.x - coords.x;
            const dy = a.y - coords.y;
            if (Math.sqrt(dx * dx + dy * dy) > threshold) return;
            const isAligned = Math.abs(dy) < 2 || Math.abs(dx) < 2; // 水平または垂直に整列
            if (!isAligned) return;
            if (this.userMolecule.getFreeValency(a.id) < 1) return;
            addTarget(a);
        });

        // 3. 新原子の価標を超える本数は結合しない（スナップ元を優先）
        const maxBonds = VALENCIES[this.selectedAtomType] || 0;
        return targets.slice(0, maxBonds);
    }

    handleMouseDown(e) {
        if (e.button === 2) {
            return; // 右クリックはパン専用に予約
        }
        // 反応機構モード中はパズル編集を無効化（生成物予測モード中は編集を許可）
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return;
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
                // モジュール（官能基/環）の配置処理
                this.placeModule(this.selectedModule, coords.x, coords.y, clickedAtom);
                this.selectedModule = null;
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
            } else if (clickedAtom) {
                if (!clickedAtom.isLocked && !clickedAtom.benzeneCenter) {
                    if (clickedAtom.element === this.selectedAtomType) {
                        // 同じ元素なら削除（消しゴム代わり）。削除の影響は対象原子のみ（開発方針 5章）
                        this.saveState();
                        this.userMolecule.removeAtom(clickedAtom.id);
                        this.updateDrawing();
                    } else {
                        // 異なる元素なら上書き置換（価標チェック付き）
                        this.trySwapElement(clickedAtom);
                    }
                } else if (!clickedAtom.isLocked && clickedAtom.benzeneCenter &&
                           clickedAtom.element !== this.selectedAtomType) {
                    // ベンゼン環内の原子も異なる元素への置換は許可（ピリジン等の複素環を作れるように）
                    // 同じ元素のクリックは従来通りドラッグ扱い（環原子のクリック削除はしない）
                    this.trySwapElement(clickedAtom);
                } else {
                    // ロックされた原子またはベンゼン環内の原子は移動ドラッグを開始
                    this.isDragging = true;
                    this.draggedAtom = clickedAtom;
                    this.dragStartPos = { x: clickedAtom.x, y: clickedAtom.y };
                    this.dragStartClient = { x: e.clientX, y: e.clientY };
                    this.saveState();
                }
            } else {
                // 空き地をクリックしたら原子を新規配置 (有効な境界点であればサイレントに配置)
                if (coords.tooLarge) {
                    // キャンバス上限超過: 配置不可のメッセージを表示
                    const resultDiv = document.getElementById('verify-result');
                    if (resultDiv) {
                        resultDiv.textContent = '構造が大きすぎて配置できません。キャンバスの限界（±5000px）を超えています。';
                        resultDiv.className = 'result-message error';
                        resultDiv.classList.remove('hidden');
                        setTimeout(() => resultDiv.classList.add('hidden'), 3000);
                    }
                } else if (coords.noSpace) {
                    // 重なりを避けられる空間がない → 配置禁止＋伸長操作を案内（P6-2a）
                    this.showToast('スペースが足りず配置できません。結合線をドラッグして伸ばし、空間を作ってから配置してください。');
                } else if (coords.isValid) {
                    this.saveState();
                    // プレビューと同一の判定関数で結合相手を決める（プレビュー＝実結果を保証）
                    const bondTargets = this.getPlacementBondTargets(coords);
                    const newAtom = this.userMolecule.addAtom(this.selectedAtomType, coords.x, coords.y);
                    bondTargets.forEach(t => {
                        this.userMolecule.addBond(t.id, newAtom.id, 1);
                    });
                    // 側鎖の振り分け（P6-3）: 既存の側鎖を二等分線の反対側へ平行移動
                    if (coords.adjust) {
                        coords.adjust.ids.forEach(id => {
                            const a = this.userMolecule.atoms.find(at => at.id === id);
                            if (a) {
                                a.x += coords.adjust.dx;
                                a.y += coords.adjust.dy;
                            }
                        });
                    }
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
            this.updateDrawing();
        }
    }

    handleMouseUp(e) {
        if (this.pan.isPanning) {
            this.pan.isPanning = false;
            this.svg.style.cursor = 'default';
            // ほぼ動かさず離した右クリックはパンではなく「原子の削除」として扱う
            // （ヘルプ記載の操作。右ドラッグはパンのまま。結合線の右クリック削除はヒットライン側で処理）
            const moved = Math.abs(e.clientX - this.pan.startX) > 3 ||
                          Math.abs(e.clientY - this.pan.startY) > 3;
            // 反応機構モード中は右クリック削除も無効（描画されていないパズル分子を誤って消さない。予測モード中は許可）
            if (!moved && !this.asymmetricMode && !(window.reactionPlayer && window.reactionPlayer.blocksEditing())) {
                const coords = this.getSnappedCoords(e);
                const atom = this.findAtomAt(coords.rawX, coords.rawY);
                if (atom) {
                    this.saveState();
                    this.userMolecule.removeAtom(atom.id);
                    this.updateDrawing();
                }
            }
            return;
        }

        // 結合線の伸縮ドラッグの終了
        if (this.bondStretch) {
            this.finishBondStretch(e);
            return;
        }

        if (!this.isDragging) return;

        const coords = this.getSnappedCoords(e);
        
        if (this.selectedTool === 'select' && this.draggedAtom) {
            // 移動ドラッグ終了：スナップ座標に固定
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
                this.updateDrawing();
            }
            this.dragStartPos = null;
            this.dragStartClient = null;
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
        this.updateDrawing();
    }

    // クリックされた原子を現在選択中の元素へ置換する（価標チェック付き）
    trySwapElement(atom) {
        const relatedBonds = this.userMolecule.getBondsForAtom(atom.id);
        let currentValencySum = 0;
        relatedBonds.forEach(bond => {
            currentValencySum += (Number(bond.type) || 1);
        });

        const maxValency = VALENCIES[this.selectedAtomType] || 0;

        if (currentValencySum <= maxValency) {
            // 構造を破壊せずに置換可能な場合のみ許可
            this.saveState();
            atom.element = this.selectedAtomType;
            this.updateDrawing();
        } else {
            // 置換不可のメッセージを表示
            const resultDiv = document.getElementById('verify-result');
            if (resultDiv) {
                resultDiv.textContent = `結合数が多いため、${atom.element}を${this.selectedAtomType}に置換できません。（現在の結合数: ${currentValencySum}、${this.selectedAtomType}の最大結合数: ${maxValency}）`;
                resultDiv.className = 'result-message error';
                resultDiv.classList.remove('hidden');
                setTimeout(() => resultDiv.classList.add('hidden'), 3500);
            }
        }
    }

    // ===== 結合の伸縮（P6-2b）: 結合線を軸方向にドラッグして長さをグリッド倍数で変える =====

    // 指定結合を除いた上で startId から到達できる原子ID集合を返す（橋判定・移動成分の算出用）
    collectComponent(startId, excludedBond) {
        const visited = new Set([startId]);
        const stack = [startId];
        while (stack.length) {
            const id = stack.pop();
            this.userMolecule.bonds.forEach(b => {
                if (b === excludedBond) return;
                let other = null;
                if (b.atomId1 === id) other = b.atomId2;
                else if (b.atomId2 === id) other = b.atomId1;
                if (other && !visited.has(other)) {
                    visited.add(other);
                    stack.push(other);
                }
            });
        }
        return visited;
    }

    // 結合線のドラッグ開始。橋（切ると分子が2つに分かれる結合）のみ伸縮可能で、
    // 遠い側の連結成分を剛体として動かす（環は変形せず丸ごと付いてくる）。
    // 環の内部の結合（橋でない結合）は伸縮不可。
    beginBondStretch(bond, e) {
        const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
        const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
        if (!a1 || !a2) return;

        // 橋判定: この結合を除いて a2 側から a1 に到達できるなら環内結合
        const comp2 = this.collectComponent(a2.id, bond);
        if (comp2.has(a1.id)) {
            this.bondStretch = { ringBond: true, startClient: { x: e.clientX, y: e.clientY } };
            return;
        }

        // 動かす側 = 原子数が少ない側（同数なら atomId2 側）
        const comp1 = this.collectComponent(a1.id, bond);
        const anchor = (comp1.size < comp2.size) ? a2 : a1;
        const movingIds = (comp1.size < comp2.size) ? comp1 : comp2;
        const moving = (anchor === a1) ? a2 : a1;

        const dx = moving.x - anchor.x;
        const dy = moving.y - anchor.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return;
        const axis = { x: dx / len, y: dy / len };

        const p = this.clientToSvg(e.clientX, e.clientY);
        if (!p) return;

        this.saveState();
        this.bondStretch = {
            anchor,
            axis,
            origLength: len,
            currentLength: len,
            movingIds: [...movingIds],
            origPositions: new Map([...movingIds].map(id => {
                const a = this.userMolecule.atoms.find(at => at.id === id);
                return [id, { x: a.x, y: a.y }];
            })),
            projStart: (p.x - anchor.x) * axis.x + (p.y - anchor.y) * axis.y,
            startClient: { x: e.clientX, y: e.clientY }
        };
    }

    // ドラッグ中: マウスの結合軸方向成分から新しい結合長を決め、グリッド倍数にスナップして適用する
    updateBondStretch(e) {
        const st = this.bondStretch;
        if (st.ringBond) return;
        const p = this.clientToSvg(e.clientX, e.clientY);
        if (!p) return;

        const projNow = (p.x - st.anchor.x) * st.axis.x + (p.y - st.anchor.y) * st.axis.y;
        const rawLength = st.origLength + (projNow - st.projStart);
        const snapped = Math.max(GRID_SIZE, Math.round(rawLength / GRID_SIZE) * GRID_SIZE);
        if (snapped === st.currentLength) return;

        // 移動後の各原子が静止側の原子と重ならないかチェック（配置時と同じ最小間隔）
        const delta = snapped - st.origLength;
        const minClearance = GRID_SIZE * 0.65;
        const movingSet = new Set(st.movingIds);
        const staticAtoms = this.userMolecule.atoms.filter(a => !movingSet.has(a.id));
        const collides = st.movingIds.some(id => {
            const orig = st.origPositions.get(id);
            const nx = orig.x + st.axis.x * delta;
            const ny = orig.y + st.axis.y * delta;
            return staticAtoms.some(sa => {
                const ddx = sa.x - nx;
                const ddy = sa.y - ny;
                return Math.sqrt(ddx * ddx + ddy * ddy) < minClearance;
            });
        });
        if (collides) return; // 重なる長さは採用せず、直前の有効な長さを維持

        st.movingIds.forEach(id => {
            const atom = this.userMolecule.atoms.find(a => a.id === id);
            const orig = st.origPositions.get(id);
            atom.x = orig.x + st.axis.x * delta;
            atom.y = orig.y + st.axis.y * delta;
        });
        st.currentLength = snapped;
        this.updateDrawing();
    }

    // ドラッグ終了: 実質クリック（3px以下）や長さ不変なら元に戻し、履歴も消費しない（開発方針 3.5章）
    finishBondStretch(e) {
        const st = this.bondStretch;
        this.bondStretch = null;
        const moved = Math.abs(e.clientX - st.startClient.x) > 3 ||
                      Math.abs(e.clientY - st.startClient.y) > 3;

        if (moved) {
            // ドラッグ操作だった場合、直後の合成clickによる次数トグルを抑止する
            this.suppressBondClick = true;
            setTimeout(() => { this.suppressBondClick = false; }, 0);
        }

        if (st.ringBond) {
            if (moved) {
                this.showToast('環の内部の結合は伸縮できません。環につながる結合を伸ばしてください。');
            }
            return;
        }

        if (!moved || st.currentLength === st.origLength) {
            // 変化なし: 位置を戻し、開始時に積んだ履歴を取り消す
            st.movingIds.forEach(id => {
                const atom = this.userMolecule.atoms.find(a => a.id === id);
                const orig = st.origPositions.get(id);
                if (atom && orig) {
                    atom.x = orig.x;
                    atom.y = orig.y;
                }
            });
            this.history.pop();
            // ※純クリック（移動なし）ではupdateDrawing()を呼ばない。
            //   ここでヒットラインを再生成すると、直後のclickイベントが
            //   「押下時の要素」に届かなくなり、次数トグルが動かなくなるため
            //   （エタン→エテンがクリックで作れなくなる退行の原因だった）。
            if (moved) this.updateDrawing();
        }
    }

    // 画面内トーストに一時メッセージを表示する
    showToast(message, ms = 3000, type = 'error') {
        const resultDiv = document.getElementById('verify-result');
        if (!resultDiv) return;
        resultDiv.textContent = message;
        resultDiv.className = `result-message ${type}`;
        resultDiv.classList.remove('hidden');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => resultDiv.classList.add('hidden'), ms);
    }

    // ===== 化合物名判定・分子式表示（P7-6） =====

    // 現在の分子の分子式を計算する（自動水素を含む。表記はHill方式: C→H→他はアルファベット順）
    computeMolecularFormula() {
        const counts = {};
        let hCount = 0;
        this.userMolecule.atoms.forEach(a => {
            counts[a.element] = (counts[a.element] || 0) + 1;
            hCount += this.userMolecule.getFreeValency(a.id);
        });
        if (hCount > 0) counts['H'] = (counts['H'] || 0) + hCount;

        const order = [];
        if (counts['C']) order.push('C');
        if (counts['H']) order.push('H');
        Object.keys(counts).filter(e => e !== 'C' && e !== 'H').sort().forEach(e => order.push(e));

        const sub = (n) => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        return order.map(e => counts[e] === 1 ? e : e + sub(counts[e])).join('');
    }

    // 名称判定ライブラリ（ステージ＋compounds.json）を検証用Molecule付きで遅延構築する
    getCompoundLibrary() {
        if (!this._compoundLibrary) {
            const entries = [
                ...STAGES.map(s => ({ name: s.name, target: s.target })),
                ...COMPOUNDS.map(c => ({ name: c.name, target: c.target }))
            ];
            this._compoundLibrary = entries.map(e => ({
                name: e.name,
                mol: this.createTargetFromData({ target: e.target })
            }));
        }
        return this._compoundLibrary;
    }

    // 右パネルの「いま描いている分子」表示を更新する（updateDrawingから毎回呼ばれる）
    updateCompoundInfo() {
        const nameEl = document.getElementById('compound-name');
        const formulaEl = document.getElementById('compound-formula');
        if (!nameEl || !formulaEl) return;

        if (this.userMolecule.atoms.length === 0) {
            nameEl.textContent = '—';
            formulaEl.textContent = '—';
            return;
        }
        formulaEl.textContent = this.computeMolecularFormula();

        // 生成物予測モード中は名称を伏せる（答えのヒントになりすぎるため）
        if (window.reactionPlayer && window.reactionPlayer.prediction) {
            nameEl.textContent = '？？？（予測中）';
            return;
        }

        // ライブラリとグラフ同型照合（重原子数・元素数の不一致は verifyMolecule 側で即座に弾かれる）
        const hit = this.getCompoundLibrary().find(e => verifyMolecule(this.userMolecule, e.mol));
        nameEl.textContent = hit ? hit.name : '（ライブラリに該当なし）';
    }

    // ===== 作図エクスポート（P7-3）: コンテンツ制作支援 =====

    // 現在の分子を問題データ用JSON文字列として組み立てる。
    // target: 重原子のみ（stages.json の target 形式）
    // withHydrogens: 自動水素を明示原子化したもの（reactions.json の states 形式に使用）
    buildExportJson() {
        const heavy = this.userMolecule.atoms;
        const round1 = v => Math.round(v * 10) / 10;
        const idx = new Map(heavy.map((a, i) => [a.id, i]));

        const target = {
            atoms: heavy.map(a => ({ element: a.element, x: round1(a.x), y: round1(a.y) })),
            bonds: this.userMolecule.bonds.map(b => ({
                atom1Index: idx.get(b.atomId1),
                atom2Index: idx.get(b.atomId2),
                type: b.type
            }))
        };

        const withHydrogens = {
            atoms: target.atoms.map(a => ({ ...a })),
            bonds: target.bonds.map(b => ({ ...b }))
        };
        this.userMolecule.calculateHydrogens().forEach(h => {
            const hIndex = withHydrogens.atoms.length;
            withHydrogens.atoms.push({ element: 'H', x: round1(h.x), y: round1(h.y) });
            withHydrogens.bonds.push({ atom1Index: idx.get(h.parentId), atom2Index: hIndex, type: 1 });
        });

        return JSON.stringify({ target, withHydrogens }, null, 2);
    }

    // エクスポートJSONをクリップボードへコピー（失敗時はコンソール出力にフォールバック）
    exportMoleculeJson() {
        if (this.userMolecule.atoms.length === 0) {
            this.showToast('エクスポートする分子がありません。');
            return;
        }
        const json = this.buildExportJson();
        const fallback = () => {
            console.log(json);
            this.showToast('クリップボードに書き込めないため、ブラウザのコンソールに出力しました。');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json)
                .then(() => this.showToast('分子データJSONをクリップボードにコピーしました。', 2500, 'success'))
                .catch(fallback);
        } else {
            fallback();
        }
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

    // 原子配置プレビュー（半透明の丸と元素記号、実際に形成される全結合線、
    // および側鎖振り分け（P6-3）で移動する既存側鎖の移動先ゴーストの表示）
    drawAtomPreview(element, x, y, parentAtoms, adjust = null) {
        this.clearUIOverlay();

        // 0. 側鎖振り分けのゴースト（オレンジの点線: 既存側鎖がこの位置へ移動する）
        if (adjust && adjust.ghost) {
            const g = adjust.ghost;
            const gdx = g.toX - g.fromX;
            const gdy = g.toY - g.fromY;
            const glen = Math.sqrt(gdx * gdx + gdy * gdy);
            if (glen > 0) {
                const gux = gdx / glen;
                const guy = gdy / glen;
                const gline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                gline.setAttribute('x1', g.fromX + gux * 10);
                gline.setAttribute('y1', g.fromY + guy * 10);
                gline.setAttribute('x2', g.toX - gux * 10);
                gline.setAttribute('y2', g.toY - guy * 10);
                gline.setAttribute('stroke', 'rgba(255, 165, 2, 0.5)');
                gline.setAttribute('stroke-width', '2');
                gline.setAttribute('stroke-dasharray', '3,3');
                this.uiGroup.appendChild(gline);
            }
            const gcircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            gcircle.setAttribute('cx', g.toX);
            gcircle.setAttribute('cy', g.toY);
            gcircle.setAttribute('r', '10');
            gcircle.setAttribute('fill', 'none');
            gcircle.setAttribute('stroke', 'rgba(255, 165, 2, 0.6)');
            gcircle.setAttribute('stroke-width', '1.5');
            gcircle.setAttribute('stroke-dasharray', '3,3');
            this.uiGroup.appendChild(gcircle);
        }

        // 1. 結合予定の全親原子から、プレビュー結合線を描画 (半透明)
        (parentAtoms || []).forEach(parentAtom => {
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
        });

        // 2. 半透明の原子円
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


    // 正解の例示（お手本）をレンダリングする
    renderTargetAnswer() {
        this.targetBonds.innerHTML = '';
        this.targetAtoms.innerHTML = '';

        const targetMol = this.createTargetFromData(STAGES[this.currentStageIndex]);
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

        // ターゲット側の水素も含めるため、水素も計算
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
        } else if (type === 3) {
            // 三重結合（中央＋左右の3本線。ユーザー側キャンバスのrenderBondと同じ見た目）
            const nx = -uy;
            const ny = ux;
            const gap = 5;
            [-gap, 0, gap].forEach(offset => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', sx + nx * offset);
                line.setAttribute('y1', sy + ny * offset);
                line.setAttribute('x2', ex + nx * offset);
                line.setAttribute('y2', ey + ny * offset);
                line.setAttribute('stroke', strokeColor);
                line.setAttribute('stroke-width', offset === 0 ? '2.2' : '1.6');
                this.targetBonds.appendChild(line);
            });
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

        // 5. 化合物名・分子式のライブ表示を更新（P7-6）
        this.updateCompoundInfo();
    }

    renderAtom(id, element, x, y, isLocked, isAsymmetricMarked = false) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'svg-atom-node');
        group.setAttribute('data-id', id);
        
        // 原子円（背景）
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
            // 蜊倡ｵ仙粋
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
            const gap = 5; // 線どうしの間隔を広げて視認性アップ

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
            hitLine.addEventListener('pointerdown', (e) => {
                e.stopPropagation(); // キャンバス側のpointerdown（原子の配置・削除）が走るのを阻止
                if (e.button === 0) {
                    // ドラッグ（3px超の移動）で結合の伸縮を開始。クリックとの判別はfinishBondStretch側で行う
                    this.beginBondStretch(bondObj, e);
                }
            });
            hitLine.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // キャンバス全体のmousedown（原子の上書き・配置）が走るのを完全に阻止
            });
            hitLine.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.suppressBondClick) return; // 伸縮ドラッグ直後の合成clickでは次数トグルしない
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
        const targetMolecule = this.createTargetFromData(stage);
        
        this.verifyResult.classList.remove('hidden');
        this.verifyResult.className = "result-message animate-pulse";
        this.verifyResult.textContent = "判定中...";
        
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
                // ユーザーの全炭素(C)について、本当に不斉炭素であるかとマーク状態が一致しているか走査
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

            // 3. すべて合格！（メッセージは実際に検証した内容だけを述べる: 開発方針 5章）
            this.verifyResult.className = "result-message success";
            this.verifyResult.textContent = this.asymmetricMode
                ? "正解です！構造および不斉炭素の位置が完全に一致しました！"
                : "正解です！分子構造が完全に一致しました！";
            
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

    // 隣接する重原子どうしを自動で単結合で結ぶ (グリッド接続距離に厳格に制限)
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
            // ダブルクリック（または右クリック）で結合の切断（削除）
            this.saveState();
            this.userMolecule.removeBond(bond.atomId1, bond.atomId2);
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
                this.updateDrawing();
            }
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
        const targetMolecule = this.createTargetFromData(stage);
        
        const bounds = this.calculateTargetBounds(targetMolecule);
        const W = bounds.maxX - bounds.minX;
        const H = bounds.maxY - bounds.minY;
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        
        // 余白を含めた視野の広さを計算 (左右120px、上下90px程度の余白)
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
    // 価標は VALENCIES (chemistry.js) を唯一の情報源とする（開発方針 2章）
    getMaxBondType(element1, element2) {
        const v1 = VALENCIES[element1] || 1;
        const v2 = VALENCIES[element2] || 1;
        // 両原子の最大手の最小値、かつ現実の共有結合の最大次数である 3 を限界値とする
        return Math.min(v1, v2, 3);
    }
}

// 起動
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const jsonUrl = new URL('stages.json', window.location.href).href;
        // ステージデータはキャッシュ再検証を強制する（?v=バスターが付かないため、更新が届かない事故を防ぐ）
        const response = await fetch(jsonUrl, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        STAGES = await response.json();
        window.STAGES = STAGES; // テスト（test.html）・コンソールデバッグ用に公開（letはwindowに載らないため）

        // 名称判定用の追加ライブラリ（P7-6）。なくてもアプリは動作する
        try {
            const compUrl = new URL('compounds.json', window.location.href).href;
            const compResponse = await fetch(compUrl, { cache: 'no-cache' });
            if (compResponse.ok) COMPOUNDS = await compResponse.json();
        } catch (e) {
            console.warn('compounds.json のロードに失敗（名称判定はステージのみで動作）:', e);
        }
        window.COMPOUNDS = COMPOUNDS;

        window.game = new Game();
        // 反応機構ビューアの初期化（reactions.json がなければビューアは自動で隠れる）
        window.reactionPlayer = new ReactionPlayer(window.game);
        await window.reactionPlayer.load();
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
