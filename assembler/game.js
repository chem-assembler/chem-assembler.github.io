/**
 * Game Logic for Chem-Assembler
 * 画面の描画更新、インタラクション、ステージ進行、およびUIイベントを制御します。
 */

/**
 * 学習の手ごたえを GA4 へ送る（SNS_PLAN.md の北極星「SNS経由の週間アクティブ利用」）。
 * ページを開いた回数だけでは「3秒で閉じた人」と「10問解いた人」が同じ1になるため、
 * **実際に学習が起きたこと**を数えるための最小の計測。
 * 送るのは行為の種類だけで、**個人を特定する情報は一切送らない**（privacy.html の記載どおり）。
 * gtag が無い環境（回帰テスト・夜間監査・file:// 直開き）では何もしない。
 */
function slTrack(name, params) {
    try {
        if (window.gtag) window.gtag('event', name, params || {});
    } catch (e) { /* 計測の失敗でアプリを止めない */ }
}

let STAGES = [];
let COMPOUNDS = []; // 名称判定用の追加ライブラリ（compounds.json。ステージ未収録の有名化合物）
const GRID_SIZE = 42;
// 作図できる座標の上限（px）。これを超えた位置には原子を置けない（getSnappedCoords が弾く）。
// 名称呼び出しの並べ方もこの値を守る必要があるので、両方から見える場所に置く
const CANVAS_LIMIT = 5000;
// 名称呼び出しで分子を右へ並べるときの1段の幅。これを超えたら下の段へ折り返す。
// 上限（5000）まで一直線に並べると、端の分子が編集できない場所に入ってしまう
const SUMMON_ROW_WIDTH = 2400;

// 複数分子があるときの識別記号（P12-8。ユーザー要望）。
// **A/B/C は使わない**: C＝炭素・B＝ホウ素・N・O・S と元素記号がぶつかる。
// α/β も糖のアノマー表記で使っているので避ける。丸数字はどちらともぶつからない
const MOLECULE_MARKS = [
    '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
    '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
    '㉑', '㉒', '㉓', '㉔', '㉕', '㉖', '㉗', '㉘', '㉙', '㉚',
    '㉛', '㉜', '㉝', '㉞', '㉟'
];
function moleculeMark(i) {
    return MOLECULE_MARKS[i] || `(${i + 1})`;
}

// 分子の下の見出し（🔍 ① 乳酸）の枠の高さ。**これが分子モーダルの入口**なので、
// 押せるものの下限（32px。style.css 論点C・TAP1）を割らない大きさにする。
// **34 なのは 32 ちょうどだと境界で揺れるから**（#summon-input で実発生。しきい値と実寸が
// 一致すると、サブピクセルの丸めで判定が反転して落ちたり通ったりする）
const LABEL_CHIP_HEIGHT = 34;

// 「🎯 反応させる分子を選ぶ」で同時に選べる分子の数（レビュー項目15）。
// 4 なのは**グリセリン＋脂肪酸3分子＝油脂**が高校化学でいちばん分子数の多い反応列だから。
// 一度に全部が反応するわけではなく、同じ反応を繰り返す間ずっと絞り込みを効かせるための上限
const MAX_REACTION_SELECTION = 4;

class Game {
    constructor() {
        this.currentStageIndex = 0;
        this.userMolecule = new Molecule();
        this.selectedTool = 'select'; // 'select', 'bond', 'erase'
        this.selectedBondType = 1;     // 1, 2, 3
        this.selectedAtomType = 'C';   // 'C', 'O', 'N', 'Cl'
        this.selectedModule = null;    // 'benzene', 'oh', 'cooh', 'nh2'
        this.nringSize = 6;            // 任意員環の員数（選択時にモーダルで決める。既定6）
        this.asymmetricMode = false;   // 不斉炭素マークの編集モード（左パレットのボタン。P10 M2）
        this.judgeAsymmetric = false;  // 構造判定で不斉炭素マークも採点するか（パズルの判定オプション。P10 M2）
        this.reshapeMode = false;      // シス/トランス整形モード（左パレットのボタン。P12-7 先行）
        this._reshapeLastBond = null;  // 直近に整形した C=C のキー（再タップで cis⇄trans 反転するため）
        this.haworthMode = false;      // α/β 面マークモード（環外置換基の上下面を編集。P12-7 M2b）
        this.condensedMode = false;    // 官能基の縮約表示（P9-2）が ON かどうか（表示のみ）
        // 反応させる分子を選ぶモード（C-1。2026-08-01 ユーザー要望）。
        // タップした分子を MAX_REACTION_SELECTION 個まで順に選び、
        // 反応カードを「その分子でできる反応」に絞る。
        // 選んだ順が式の並びになる（先に選んだ方が左）。中身は代表原子のIDの配列
        this.reactionSelectMode = false;
        this.selectedMolecules = [];
        // 「⚗ この分子の反応」カードがいま分析している分子（レビュー項目9）。中身は代表原子のID。
        // **反応の絞り込み（selectedMolecules）とは別物**で、こちらは分類表示の対象を指すだけ。
        // 図では実線＋淡い光の枠（琥珀）で示し、選択枠（青の破線＋①②）と見分けられるようにする
        this.focusedMolecule = null;

        // ドラッグ状態
        this.isDragging = false;
        this.draggedAtom = null;
        this.dragWholeIds = null;       // Shift+ドラッグ中に丸ごと動かす分子の原子ID集合（P12-8）
        this.bondStartAtom = null;
        this.bondStretch = null;        // 結合線の伸縮ドラッグ状態（P6-2b）
        this.suppressBondClick = false; // 伸縮ドラッグ直後の合成clickで次数トグルしないためのフラグ
        
        // 履歴スタック (Undo/Redo用)
        this.history = [];
        this.redoStack = [];

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
        this.checkJudgeAsymmetric = document.getElementById('check-judge-asymmetric');
        // 立体（D/L・α/β）を名前に反映するか（P12-7 M2e。ユーザー要望「明示的に切り替えたい」）。
        // OFF のときは座標から立体を読まず、立体異性体を区別しない総称名で表示する
        this.checkReadStereo = document.getElementById('check-read-stereo');
        // **既定は OFF**（2026-08-02 ユーザー判断。Gemini レビュー項目22）。
        // 初学者が教科書どおり直交で描いただけで「D-アラニン」「L-乳酸」と出て
        // 「アラニンを作ったのに D- とついていて間違いか？」と迷うため。
        // 立体を学びたい人がトグルを ON にしたときだけ D/L・α/β を名前に出す。
        // 一度でも切り替えた人の設定は localStorage から復元するので、既定の変更で上書きしない
        this.readStereo = false;
        try {
            const saved = localStorage.getItem('chemAssembler.readStereo');
            if (saved !== null) this.readStereo = saved === '1';
        } catch (e) { /* noop */ }
        if (this.checkReadStereo) this.checkReadStereo.checked = this.readStereo;
        this.targetBonds = document.getElementById('target-bonds');
        this.targetAtoms = document.getElementById('target-atoms');
        this.targetSvg = document.getElementById('target-svg');
        this.targetSvgWrapper = document.getElementById('target-svg-wrapper');
        // お手本モーダルの見え方（レビュー項目10）。**表示専用の状態**で、
        // STAGES のデータにも判定（verifyMolecule）にも触らない
        this.targetView = { zoom: 1, cx: 0, cy: 0, base: null, condense: false, condensable: false, condenseChosen: false };
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

    // 指定されたシリーズに属するステージで問題ドロップダウンを再構築する（クリア済みは✓表示: P7-4）
    updateStageOptions(selectedSeries) {
        const cleared = this.getClearedSet();
        this.stageSelect.innerHTML = '';
        let count = 1;
        STAGES.forEach((stage, idx) => {
            if (stage.series === selectedSeries) {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = `${cleared.has(stage.name) ? '✓ ' : ''}${count}. ${stage.name}`;
                this.stageSelect.appendChild(opt);
                count++;
            }
        });
    }

    // クリア済みステージ名の集合をlocalStorageから読み出す（P7-4）
    getClearedSet() {
        try {
            return new Set(JSON.parse(localStorage.getItem('chemAssembler.cleared') || '[]'));
        } catch (e) {
            return new Set();
        }
    }

    // ステージのクリアを記録し、ドロップダウンの✓表示を更新する（P7-4）
    markStageCleared(name) {
        const cleared = this.getClearedSet();
        if (cleared.has(name)) return;
        cleared.add(name);
        try {
            localStorage.setItem('chemAssembler.cleared', JSON.stringify([...cleared]));
        } catch (e) {
            // プライベートブラウジング等で保存できない場合は表示のみ諦める
        }
        this.updateStageOptions(this.seriesSelect.value);
        this.stageSelect.value = this.currentStageIndex;
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
                this.scheduleLabelResync(); // 縮尺が変わったので分子の見出しを描き直す
            } else {
                // 2本指スクロールによるパン（平行移動）
                const scale = this.svgUnitsPerPixel();
                viewBox.x += e.deltaX * scale;
                viewBox.y += e.deltaY * scale;
            }
        }, { passive: false });

        // 画面の大きさが変わると SVG の縮尺も変わる（viewBox はそのままでも CTM が変わる）ので、
        // 見出しのチップを描き直して画面上の大きさを保つ
        window.addEventListener('resize', () => this.scheduleLabelResync());

        // ブラウザ標準の右クリックメニューは抑止（右ドラッグパンに割り当てるため）
        this.svg.addEventListener('contextmenu', (e) => e.preventDefault());

        // 官能基の縮約表示トグル（P9-2）: 表示だけの切替で、作図データは変えない
        const btnCondense = document.getElementById('btn-condense');
        if (btnCondense) {
            btnCondense.addEventListener('click', () => {
                this.condensedMode = !this.condensedMode;
                // リボンのタイルは アイコン＋短ラベル の2段（v650）。textContent ごと入れ替えると
                // span が消えて1行に潰れるので、**中の .tile-label / .tile-icon だけ**を書き換える
                const icon = btnCondense.querySelector('.tile-icon');
                const label = btnCondense.querySelector('.tile-label');
                if (icon && label) {
                    icon.textContent = this.condensedMode ? '🔗' : '🔤';
                    label.textContent = this.condensedMode ? '結合表示' : 'まとめる';
                } else {
                    btnCondense.textContent = this.condensedMode ? '🔤 結合をすべて表示' : '🔤 官能基をまとめる';
                }
                btnCondense.title = this.condensedMode
                    ? '官能基のカード表示をやめて、すべての結合を線で表示します'
                    : '-COOH や -NO₂ などの官能基を、1つのカードにまとめて表示します（作図データは変わりません）';
                btnCondense.classList.toggle('active', this.condensedMode);
                this.updateDrawing();
                this.showToast(this.condensedMode
                    ? '官能基をまとめて表示しています（作図データは変わっていません。クリックで元に戻せます）。'
                    : 'すべての結合を表示に戻しました。', 2500, 'success');
            });
        }

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
        this.touchEditSnapshot = null;   // 1本目のタッチ指が編集する前の状態（ピンチに化けたら巻き戻す）
        this.touchEditHistoryLen = 0;

        this.svg.addEventListener('pointerdown', (e) => {
            if (this.trackPointerDown(e, true) !== 'proceed') return;

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

            // 2本指ジェスチャ: ピンチズーム＋ドラッグでパン（P11-M2d）
            // 開始時に中点の下にあった論理座標(anchor)を常に現在の中点の真下に保つ。
            // 指の間隔の変化=ズーム、中点の移動=パン として同時に効く
            if (this.pinch && this.activePointers.size >= 2) {
                e.preventDefault();
                const pts = [...this.activePointers.values()];
                const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (this.pinch.startDist > 0 && dist > 0 && this.pinch.anchor) {
                    const ratio = this.pinch.startDist / dist;
                    const viewBox = this.svg.viewBox.baseVal;

                    const newWidth = this.pinch.startWidth * ratio;
                    const newHeight = this.pinch.startHeight * ratio;
                    if (newWidth < 150 || newWidth > 5000) return;
                    viewBox.width = newWidth;
                    viewBox.height = newHeight;
                    this.scheduleLabelResync(); // 縮尺が変わったので分子の見出しを描き直す

                    // 新しい倍率のCTMで現在の中点の論理座標を取り、anchorとのずれ分だけ平行移動
                    const p = this.clientToSvg((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
                    if (!p) return;
                    viewBox.x += this.pinch.anchor.x - p.x;
                    viewBox.y += this.pinch.anchor.y - p.y;
                }
                return;
            }

            this.handleMouseMove(e);
        });

        // pointerupはキャンバス外で指・ボタンを離しても検知できるようwindowで受ける
        const onPointerEnd = (e) => {
            clearTimeout(this._bondPressTimer); // 結合の長押し削除タイマーは指が離れたら無効
            this.activePointers.delete(e.pointerId);
            this.touchEditSnapshot = null; // ピンチへの巻き戻し猶予は最初のpointerupまで
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

        // iPad/iOS Safari 対策（P12-B1 S1）: Safari独自のジェスチャイベント（ページ全体の
        // ピンチズーム）をアプリ領域では抑止する。touch-action:none はキャンバス要素にしか
        // 効かず、2本目の指がパネルや余白に落ちるとページズームが勝ってしまうため、
        // document 全体で止める。モーダル内だけは文字拡大の余地を残すため除外。
        // GestureEvent は Safari 専用のため、他ブラウザではリスナーが無反応なだけで無害
        ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
            document.addEventListener(type, (e) => {
                if (!(e.target instanceof Element) || !e.target.closest('.modal-overlay')) {
                    e.preventDefault();
                }
            }, { passive: false });
        });

        // ツール切替（data-tool を持つ Select/Bond/Erase のみ。btn-asym-mark は別扱い）
        // アクティブなツールの再タップは解除＝Selectへ復帰。モバイルでは
        // Selectボタンを非表示にしているため、これが唯一の戻り道（P11-M2b）
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (btn.classList.contains('active') && btn.dataset.tool !== 'select') {
                    this.setTool('select');
                } else {
                    this.setTool(btn.dataset.tool);
                }
            });
        });

        // 結合次数切替
        document.querySelectorAll('.bond-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.bond-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedBondType = parseInt(btn.dataset.bond);

                // 結合次数を選択した場合、操作モードを強制的に「結合」にする
                // （.click()だと結合ツールが既にアクティブなとき再タップ解除が発火するため直接設定）
                this.setTool('bond');
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
                    // 任意員環は先に員数を選ばせる（選択後はカーソルにゴーストが追従し、
                    // クリックで他の環と同じように配置できる。P12-調整）
                    if (this.selectedModule === 'n-ring') {
                        this.pendingRing = null; // カーソル配置モード（旧: クリック後モーダルではない）
                        if (this.nringModal) this.nringModal.classList.remove('hidden');
                    }
                    // モジュール配置時は一時的に選択ツール扱いにする
                    this.selectedTool = 'select';
                    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                    document.getElementById('btn-tool-select').classList.add('active');
                    // 不斉炭素マークモードは解除する（モジュール配置と競合し、
                    // クリックが不斉マークに奪われてモジュールが置けなくなるため）
                    if (this.asymmetricMode) {
                        this.asymmetricMode = false;
                        const bam = document.getElementById('btn-asym-mark');
                        if (bam) bam.classList.remove('active');
                        this.updateDrawing();
                    }
                    // シス/トランス整形モードもモジュール配置と競合するので解除する
                    if (this.reshapeMode) {
                        this.reshapeMode = false;
                        this._reshapeLastBond = null;
                        const brs = document.getElementById('btn-cistrans-reshape');
                        if (brs) brs.classList.remove('active');
                        this.updateDrawing();
                    }
                    // α/β 面マークモードもモジュール配置と競合するので解除する
                    if (this.haworthMode) {
                        this.deactivateHaworthMode();
                        this.updateDrawing();
                    }
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

        // 任意員環の員数選択モーダル（P7-4: prompt撲滅）
        this.nringModal = document.getElementById('nring-modal');
        const nringChoices = document.getElementById('nring-choices');
        if (this.nringModal && nringChoices) {
            for (let k = 3; k <= 8; k++) {
                const b = document.createElement('button');
                b.textContent = `${k}員環`;
                b.className = 'view-btn';
                b.style.padding = '12px';
                b.addEventListener('click', () => {
                    this.nringModal.classList.add('hidden');
                    this.nringSize = k; // 以後のゴースト／配置はこの員数で行う
                    if (this.pendingRing) {
                        // 旧経路（クリック→モーダル）互換: その場で配置
                        const p = this.pendingRing;
                        this.pendingRing = null;
                        this.placeModule('n-ring', p.x, p.y, p.clickedAtom, k);
                    } else {
                        this.showToast(`${k}員環を選びました。キャンバス上でゴーストを見ながらクリックで配置できます。`, 3000, 'success');
                    }
                });
                nringChoices.appendChild(b);
            }
            document.getElementById('btn-nring-cancel').addEventListener('click', () => {
                this.nringModal.classList.add('hidden');
                if (!this.pendingRing) {
                    // 員数選択をキャンセル: モジュール選択自体も解除する
                    this.selectedModule = null;
                    document.querySelectorAll('.mod-btn').forEach(bb => bb.classList.remove('active'));
                }
                this.pendingRing = null;
            });
        }

        // アクションボタン
        this.btnVerify.addEventListener('click', () => this.verifyCurrentStructure());
        // 作図エクスポート（P7-3）
        const btnExport = document.getElementById('btn-export-json');
        if (btnExport) {
            btnExport.addEventListener('click', () => this.exportMoleculeJson());
        }

        this.btnClearAll.addEventListener('click', () => {
            // 「全消去」は巻矢印まで含めて消す。原子が空でも矢印だけ浮いて残るのを防ぐため、
            // Undo履歴の判定より先に解除する（検品レビュー 17）
            this.deactivateReactionMode();
            if (this.userMolecule.atoms.length === 0) return; // 空のときはUndo履歴を消費しない（開発方針 3.5章）
            this.saveState();
            this.userMolecule = new Molecule();
            this.fitCanvasToTarget();
            this.updateDrawing();
        });

        this.btnNextStage.addEventListener('click', () => {
            this.winModal.classList.add('hidden');
            this.goToNextStage();
        });

        // 「↷ このお題をやめて次へ」（ユーザー判断 C・2026-08-05）。
        // **パズルには「やめる」が無かった。** 解けないときの逃げ道は「お手本を見る」だけで、
        // それは *答えを見る* であって *やめる* ではない。書き出し練習には「🔍 答え合わせ」と
        // 「練習をやめる」の2通りがあるのに、パズルには片方しか無かった。
        // 描いたものが消えるので B と同じ確認を挟む（空のキャンバスなら黙って進む）。
        const btnGiveUp = document.getElementById('btn-give-up');
        if (btnGiveUp) {
            btnGiveUp.addEventListener('click', () => {
                const go = () => this.goToNextStage();
                if (this.userMolecule.atoms.length === 0) { go(); return; }
                this.askConfirm('このお題をやめて次へ進みます',
                    'いま描いている図は消えます。答えを見たいだけなら「お手本を見る」を使ってください。',
                    '次のお題へ', go);
            });
        }

        // 判定オプション: 不斉炭素マークも採点するか（パズル。P10 M2）
        if (this.checkJudgeAsymmetric) {
            this.checkJudgeAsymmetric.addEventListener('change', (e) => {
                this.judgeAsymmetric = e.target.checked;
            });
        }

        // 立体を名前に反映するトグル（P12-7 M2e）。切り替えたら名称表示を作り直す
        if (this.checkReadStereo) {
            this.checkReadStereo.addEventListener('change', (e) => {
                this.setReadStereo(e.target.checked);
            });
        }

        // 不斉炭素マークの編集モード（左パレットのトグルボタン。P10 M2）
        const btnAsymMark = document.getElementById('btn-asym-mark');
        if (btnAsymMark) {
            btnAsymMark.addEventListener('click', () => {
                this.asymmetricMode = !this.asymmetricMode;
                btnAsymMark.classList.toggle('active', this.asymmetricMode);
                if (this.asymmetricMode) {
                    // 通常ツール・モジュール選択を解除する（マーク編集は排他モード）
                    this.selectedModule = null;
                    document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    // シス/トランス整形モード・面マークモードと排他
                    this.reshapeMode = false;
                    this._reshapeLastBond = null;
                    const brs = document.getElementById('btn-cistrans-reshape');
                    if (brs) brs.classList.remove('active');
                    this.deactivateHaworthMode();
                } else {
                    // 解除時は選択ツールに戻す
                    document.getElementById('btn-tool-select').classList.add('active');
                    this.selectedTool = 'select';
                }
                this.clearUIOverlay();
                this.updateDrawing();
            });
        }

        // 反応させる分子を選ぶモード（反応カードのトグルボタン。C-1。2026-08-01 ユーザー要望）。
        // 化学モデルには触れない。選ぶと反応カードが「その分子でできる反応」だけに絞られ、
        // 2つ選ぶと**先に選んだ方が式の左**になる（反応後の並びがそのまま式の並びになる）
        const btnRxSel = document.getElementById('btn-reaction-select');
        if (btnRxSel) {
            btnRxSel.addEventListener('click', () => {
                this.reactionSelectMode = !this.reactionSelectMode;
                btnRxSel.classList.toggle('active', this.reactionSelectMode);
                if (this.reactionSelectMode) {
                    // 他の編集モードとは排他（作図の手が滑って分子が壊れるのを防ぐ）
                    this.selectedModule = null;
                    document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    this.asymmetricMode = false;
                    const bam = document.getElementById('btn-asym-mark');
                    if (bam) bam.classList.remove('active');
                    this.reshapeMode = false;
                    const brs = document.getElementById('btn-cistrans-reshape');
                    if (brs) brs.classList.remove('active');
                    this.deactivateHaworthMode();
                    this.showToast(`反応させたい分子をタップしてください（${MAX_REACTION_SELECTION}つまで）。` +
                        '先に選んだ方が式の左になります。油脂のように何回も反応させるときは、' +
                        '使う分子をまとめて選んでおけます。何もない所をタップすると選び直せます。', 6000, 'success');
                } else {
                    this.selectedMolecules = [];
                    document.getElementById('btn-tool-select').classList.add('active');
                    this.selectedTool = 'select';
                }
                this.clearUIOverlay();
                this.updateDrawing();
            });
        }

        // シス/トランス整形モードの編集モード（左パレットのトグルボタン。P12-7 先行）
        // 化学モデルには一切触れない純粋な作図支援。整形モードで C=C（非環）をタップすると
        // 両端の置換基を ±120° に整え、同じ結合の再タップで cis⇄trans を反転する。
        const btnReshape = document.getElementById('btn-cistrans-reshape');
        if (btnReshape) {
            btnReshape.addEventListener('click', () => {
                this.reshapeMode = !this.reshapeMode;
                btnReshape.classList.toggle('active', this.reshapeMode);
                this._reshapeLastBond = null;
                if (this.reshapeMode) {
                    // 通常ツール・モジュール選択・不斉マーク編集を解除する（排他モード）
                    this.selectedModule = null;
                    document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    this.asymmetricMode = false;
                    const bam = document.getElementById('btn-asym-mark');
                    if (bam) bam.classList.remove('active');
                    this.deactivateHaworthMode();
                } else {
                    document.getElementById('btn-tool-select').classList.add('active');
                    this.selectedTool = 'select';
                }
                this.clearUIOverlay();
                this.updateDrawing();
            });
        }

        // α/β 面マークの編集モード（左パレットのトグルボタン。P12-7 M2b）
        // 環外置換基（環Cに単結合で付く環外の重原子）をタップすると haworthFace を
        // 上(+1)/下(-1) にトグルする。環の α/β 立体を「面」として明示する教育 UI。
        const btnHaworth = document.getElementById('btn-haworth-mark');
        if (btnHaworth) {
            btnHaworth.addEventListener('click', () => {
                this.haworthMode = !this.haworthMode;
                btnHaworth.classList.toggle('active', this.haworthMode);
                if (this.haworthMode) {
                    // 通常ツール・モジュール選択・不斉マーク・整形モードと排他
                    this.selectedModule = null;
                    document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                    this.asymmetricMode = false;
                    const bam = document.getElementById('btn-asym-mark');
                    if (bam) bam.classList.remove('active');
                    this.reshapeMode = false;
                    this._reshapeLastBond = null;
                    const brs = document.getElementById('btn-cistrans-reshape');
                    if (brs) brs.classList.remove('active');
                } else {
                    document.getElementById('btn-tool-select').classList.add('active');
                    this.selectedTool = 'select';
                }
                this.clearUIOverlay();
                this.updateDrawing();
            });
        }

        // お手本モーダルの表示
        this.setupTargetZoom();
        this.btnShowTarget.addEventListener('click', () => {
            // 開くたびに畳み方も拡大も仕切り直す（前の分子で選んだ状態を持ち越さない）
            this.targetView.condenseChosen = false;
            this.renderTargetAnswer(true);
            this.targetModal.classList.remove('hidden');
        });

        this.btnCloseTarget.addEventListener('click', () => {
            this.targetModal.classList.add('hidden');
        });

        // モード切替タブ（P10 M1）: 右パネルの内容をモードごとに出し分ける。
        // **確認はここ（人の操作）で挟み、setMode の中では挟まない。**
        // setMode は台本・テスト・`?open=` からも呼ばれるので、そこに確認を入れると
        // 無人再生が止まる。守りたいのは「人が押して書きかけを捨てる」場面だけ
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', () => this.leaveGuard(tab.dataset.mode,
                () => this.setMode(tab.dataset.mode)));
        });
        // 「← 自由に戻る」（DESIGN_entry_points.md §8b）。🧪 自由が標準（ホーム）で、
        // パズル・学習はそこから呼び出す行き先 ＝ 抜けて戻る道を明示する。
        // **描いている分子は保持する**（setMode は表示を切り替えるだけ）
        const backToFree = document.getElementById('btn-back-to-free');
        if (backToFree) backToFree.addEventListener('click',
            () => this.leaveGuard('free', () => this.setMode('free')));

        // スマホ用: 右パネルの下シートの開閉（P11 M1）
        const openSheet = () => document.body.classList.add('sheet-open');
        const closeSheet = () => document.body.classList.remove('sheet-open');
        const sheetToggle = document.getElementById('mobile-sheet-toggle');
        if (sheetToggle) sheetToggle.addEventListener('click', openSheet);
        const sheetClose = document.getElementById('sheet-close');
        if (sheetClose) sheetClose.addEventListener('click', closeSheet);
        const sheetBackdrop = document.getElementById('sheet-backdrop');
        if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeSheet);

        // SVGキャンバス上でのインタラクション
        // キャンバス上の入力はPointer Eventsに統一済み（本メソッド冒頭のpointerdown/move/up参照）
        
        // Undo/Redoボタン（キーボードのないスマホ向け。PCでも視認できる場所に常設。P11-M2c）
        const btnUndo = document.getElementById('btn-undo');
        if (btnUndo) btnUndo.addEventListener('click', () => this.undo());
        const btnRedo = document.getElementById('btn-redo');
        if (btnRedo) btnRedo.addEventListener('click', () => this.redo());

        // キーボードショートカット (Undo, 全消去など)
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            // Redo: Ctrl+Y または Ctrl+Shift+Z（P7-4）
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
                e.preventDefault();
                this.redo();
            }
            if (e.key === 'Delete') {
                e.preventDefault();
                this.deactivateReactionMode(); // Deleteの全消去もボタンと同じ扱いにする（検品レビュー 17）
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

    // 現在の状態を文字列にシリアライズする（Undo/Redo共用）
    serializeState() {
        return JSON.stringify({
            atoms: this.userMolecule.atoms,
            bonds: this.userMolecule.bonds,
            deletedBonds: this.userMolecule.deletedBonds
        });
    }

    // 反応機構モードを解除して巻矢印（#arrows-group）を消す。
    // 反応機構ビューアが読み込まれていない構成でも動くよう、ここで存在確認を包む（検品レビュー 16・17）
    deactivateReactionMode() {
        return !!(window.reactionPlayer && window.reactionPlayer.deactivate());
    }

    // シリアライズ済み状態から分子を復元する（Undo/Redo共用）
    restoreState(state) {
        // 履歴を巻き戻すなら反応機構の表示は無効になる。巻矢印を残すと
        // 復元した分子の上に古い矢印が浮く（検品レビュー 16）
        this.deactivateReactionMode();
        this.userMolecule = new Molecule();
        if (state.deletedBonds) {
            this.userMolecule.deletedBonds = state.deletedBonds;
        }
        state.atoms.forEach(a => {
            const atom = new Atom(a.id, a.element, a.x, a.y, a.isLocked);
            // シリアライズ済みの全プロパティ（isAsymmetricMarked, benzeneCenter, benzeneAngle 等）を
            // 機械的に復元する。個別コピーだと復元漏れが起きるため（開発方針 3.5章）。
            Object.assign(atom, a);
            this.userMolecule.atoms.push(atom);
        });
        state.bonds.forEach(b => {
            this.userMolecule.bonds.push(new Bond(b.atomId1, b.atomId2, b.type));
        });
        // 状態を巻き戻したら整形の「同じ結合の再タップ」判定はリセットする
        this._reshapeLastBond = null;
        this.updateDrawing();
        this.verifyResult.classList.add('hidden');
    }

    saveState() {
        this.history.push(this.serializeState());
        if (this.history.length > 30) this.history.shift(); // 履歴最大30件
        this.redoStack = []; // 新しい操作を行ったらRedo履歴は無効になる
    }

    undo() {
        this.deactivateReactionMode(); // 履歴が空でも巻矢印だけは残さない（検品レビュー 16）
        if (this.history.length === 0) return;
        this.redoStack.push(this.serializeState()); // Redo用に現在の状態を退避
        this.restoreState(JSON.parse(this.history.pop()));
    }

    redo() {
        this.deactivateReactionMode();
        if (!this.redoStack || this.redoStack.length === 0) return;
        this.history.push(this.serializeState());
        this.restoreState(JSON.parse(this.redoStack.pop()));
    }

    // JSONで定義された問題構造データからMoleculeオブジェクトを動的に生成する
    createTargetFromData(stage) {
        const m = new Molecule();
        if (!stage || !stage.target) return m;
        
        const addedAtoms = [];
        stage.target.atoms.forEach(atomData => {
            const a = m.addAtom(atomData.element, atomData.x, atomData.y);
            // ハース面マーク（環の α/β）はデータに直接持つので復元する（P12-7 M2b）。
            // 面は座標に現れないため haworthFace の値そのものを読む。
            if (atomData.haworthFace === 1 || atomData.haworthFace === -1) {
                a.haworthFace = atomData.haworthFace;
            }
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
        this.redoStack = [];

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
        
        // ステージ切替時は不斉マーク編集モードを解除（判定オプションは維持）
        this.asymmetricMode = false;
        const bam = document.getElementById('btn-asym-mark');
        if (bam) bam.classList.remove('active');
        // シス/トランス整形モードも解除
        this.reshapeMode = false;
        this._reshapeLastBond = null;
        const brs = document.getElementById('btn-cistrans-reshape');
        if (brs) brs.classList.remove('active');
        // α/β 面マークモードも解除
        this.deactivateHaworthMode();

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
        const MAX_CANVAS    = CANVAS_LIMIT;    // キャンバス上限 (px。モジュール先頭で定義)

        // 1. キャンバスに原子がない場合: グリッドスナップ
        const heavyAtoms = this.userMolecule.atoms.filter(a => a.element !== 'H');
        if (heavyAtoms.length === 0) {
            const snapX = Math.round(x / GRID_SIZE) * GRID_SIZE;
            const snapY = Math.round(y / GRID_SIZE) * GRID_SIZE;
            return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: true, snapAtom: null };
        }

        // 2. マウスに最も近い（空き原子価がある）重原子を探す。
        //    ただし距離は「原子そのものまで」だけでなく「**そこに置いたら新しい原子が出る位置**まで」
        //    も見る（P12-8。ユーザー指摘「メチルシクロヘキサンの同じCに2本目を付ける判定が狭い」）。
        //    側鎖が1本ある環炭素の2本目は二等分線±30°に出るが、その位置は環炭素より
        //    既存の側鎖に近いため、素直にドラッグすると側鎖のほうに吸着してしまっていた。
        //    実測では2本目の出現位置(379,222)/(421,222)に対し、環炭素の吸着範囲は y≥238 までしか届かなかった
        let nearestAtom = null;
        let nearestDist = SNAP_RADIUS;
        heavyAtoms.forEach(atom => {
            if (this.userMolecule.getFreeValency(atom.id) < 1) return;
            let dist = Math.hypot(atom.x - x, atom.y - y);
            this.secondBranchPoints(atom).forEach(pt => {
                dist = Math.min(dist, Math.hypot(pt.x - x, pt.y - y));
            });
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

        // 4. ベンゼン環炭素: center方向（置く向きは従来どおり）
        if (atom.benzeneCenter && atom.benzeneAngle !== undefined) {
            // ガイド点は「中心から固定 42×1.666=69.97px」ではなく「**頂点の実位置**から外へ 27.97px」。
            // 縮合は既存結合（20〜95px）をそのまま辺に使い半径 L のベンゼンを作れる
            // （getRingPlacementPlan）ので、中心からの固定距離だと半径 L>70 の環では
            // 頂点の**内側** L−69.97px に isValid=true で置けてしまった
            // （v510 夜間監査: L=80→C-O 10.0px・L=84.88→C-C 14.9px の重なり 13 issue）。
            // 向きは作成時の benzeneAngle を使う（環は回転しないので、伸縮・丸ごと移動で
            // benzeneCenter が置き去りになっても正しい）。標準の環（半径42）では従来と同一の点になる
            const pt = {
                x: atom.x + (BOND_LENGTH * 0.666) * Math.cos(atom.benzeneAngle),
                y: atom.y + (BOND_LENGTH * 0.666) * Math.sin(atom.benzeneAngle)
            };
            const occupied = !!this.findAtomAt(pt.x, pt.y, 8);
            // 以前はこの8pxの占有判定だけで可否を決めており、他の経路が守っている
            // MIN_CLEARANCE（27.3px）を通らなかった。そのため環の近くに別の分子や環があると、
            // 置換基が非結合原子の 12〜23px まで寄って置けてしまった
            // （P9-5e。夜間監査の「原子の重なり」約530件。実測: ベンゼンの隣に環があるとき
            //  Br が既存の C から 12.9px の位置に isValid=true で置けた）
            const tooNear = heavyAtoms.some(o =>
                o.id !== atom.id && Math.hypot(o.x - pt.x, o.y - pt.y) < MIN_CLEARANCE);
            return { x: pt.x, y: pt.y, rawX: x, rawY: y, isValid: !occupied && !tooNear, snapAtom: atom };
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

            // 直交作図の環（長方形の六員環・家型の五員環など）の判定:
            // 環の隣接2方向がどちらも水平/垂直なら、二等分線±30°ではなく格子方向へ置く（P7-8）。
            // モジュールの正多角形環（隣接方向が60°系）は従来の二等分線ロジックを維持する
            const isAxisAligned = (ang) => {
                const m = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
                return Math.min(m, Math.PI / 2 - m) < 0.09; // 約5度以内
            };
            const ringDirs = ringNeighbors.map(n => Math.atan2(n.atom.y - atom.y, n.atom.x - atom.x));

            // ハース環（酸素を含む環＝糖のピラノース環）の環外側鎖は、真上・真下を優先候補にする。
            // 「上に置けば手前(+1)・下に置けば奥(-1)」で立体の面が決まる体験にする（P12-7 M2c）。
            // 全炭素環（ベンゼン・シクロヘキサン）には反応しないので既存作図に影響しない。
            const isHaworthRingCarbon = atom.element === 'C' && this._atomInOxygenRing(atom.id);
            if (isHaworthRingCarbon && ringNeighbors.length === 2) {
                candidateAngles = [-Math.PI / 2, Math.PI / 2]; // -90°=真上 / +90°=真下（画面yは下が正）
            } else if (ringNeighbors.length === 2 && ringDirs.every(isAxisAligned)) {
                // 格子上の環: 空いている直交方向を候補にする（手描きの縮合環・側鎖の継続を自然に）
                candidateAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
            } else if (ringNeighbors.length === 2 && substituents.length === 0) {
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
                // 縮合環の頂点（環結合3本以上）など: どちらか一方の環に偏らないよう、
                // すべての隣接方向がつくる「最も広い空き角の二等分線」を第一候補にする（P9-8）。
                // 直交候補もフォールバックとして残す
                candidateAngles = [this.largestGapDirection(atom, neighbors), 0, Math.PI / 2, Math.PI, -Math.PI / 2];
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

    // 側鎖が1本ある環炭素に「2本目の側鎖」が置かれる位置（二等分線±30°）を返す。
    // 吸着先を決めるときの手がかりに使う（getSnappedCoords の 2.）。
    // 該当しない原子では空配列を返すので、他の作図には影響しない。
    // 条件は getSnappedCoords の 6. の「側鎖2本目」分岐と**同じ**にそろえてある
    // （ハース環と格子上の環は候補角が別なので対象外）
    secondBranchPoints(atom) {
        const mol = this.userMolecule;
        if (!atom || atom.element === 'H') return [];
        // 環結合2本＋側鎖1本＝重原子の隣が3つ。ここで先に弾いて連結成分の探索を避ける
        const neighbors = mol.getNeighbors(atom.id).filter(n => n.atom.element !== 'H');
        if (neighbors.length !== 3) return [];
        const ringNeighbors = [], substituents = [];
        neighbors.forEach(n => {
            const b = mol.getBond(atom.id, n.atom.id);
            if (b && this.collectComponent(n.atom.id, b).has(atom.id)) ringNeighbors.push(n);
            else substituents.push(n);
        });
        if (ringNeighbors.length !== 2 || substituents.length !== 1) return [];
        if (atom.element === 'C' && this._atomInOxygenRing(atom.id)) return [];
        const isAxisAligned = (ang) => {
            const m = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
            return Math.min(m, Math.PI / 2 - m) < 0.09;
        };
        const ringDirs = ringNeighbors.map(n => Math.atan2(n.atom.y - atom.y, n.atom.x - atom.x));
        if (ringDirs.every(isAxisAligned)) return [];
        const outward = this.outwardBisector(atom, ringNeighbors);
        const SPLIT = Math.PI / 6;
        return [outward - SPLIT, outward + SPLIT].map(ang => ({
            x: atom.x + GRID_SIZE * Math.cos(ang),
            y: atom.y + GRID_SIZE * Math.sin(ang)
        }));
    }

    // 既存の隣接原子がつくる「最も広く空いた角」の二等分線方向を返す（P9-8）。
    // 縮合環の接合原子のように、どちらか一方の環に偏らず空間の中央へ置換基を伸ばすのに使う。
    largestGapDirection(atom, neighbors) {
        const angs = neighbors
            .map(n => Math.atan2(n.atom.y - atom.y, n.atom.x - atom.x))
            .sort((a, b) => a - b);
        if (angs.length === 0) return 0;
        if (angs.length === 1) return Math.atan2(Math.sin(angs[0] + Math.PI), Math.cos(angs[0] + Math.PI));
        let bestGap = -1, bestMid = 0;
        for (let i = 0; i < angs.length; i++) {
            const a1 = angs[i];
            const a2 = (i + 1 < angs.length) ? angs[i + 1] : angs[0] + 2 * Math.PI;
            const gap = a2 - a1;
            if (gap > bestGap) {
                bestGap = gap;
                bestMid = (a1 + a2) / 2;
            }
        }
        return Math.atan2(Math.sin(bestMid), Math.cos(bestMid)); // -π〜πに正規化
    }

    // ポインタ登録とピンチ開始判定（キャンバス直下・結合ヒットライン共通の前処理）。
    // 戻り値が 'proceed' のときだけ呼び出し元は通常の編集処理へ進む。
    // preventTouchDefault: タッチ時に合成マウスイベントを抑止するか。キャンバス側は二重発火
    // （タップ配置→即削除バグ）防止に必須。ヒットライン側は合成clickで次数トグルするため抑止しない。
    trackPointerDown(e, preventTouchDefault) {
        // 幽霊ポインタの掃除（P12-B1 S5対策）: iOS Safariがジェスチャを奪うと pointerup/
        // pointercancel が届かないまま activePointers に指が残り、以後は1本指でも
        // size>=2 と誤認（ピンチ扱い/ignore）して一切の作図ができなくなる。
        // isPrimary なタッチは「新しいタッチ列の開始」＝他に実在する指は無いことが
        // 保証される（Pointer Events仕様）ので、残留分をここで破棄して自動復旧する
        if (e.pointerType === 'touch' && e.isPrimary) {
            this.activePointers.clear();
            this.pinch = null;
        }
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (e.pointerType !== 'touch') return 'proceed';
        if (preventTouchDefault) e.preventDefault();

        if (this.activePointers.size === 2) {
            // ピンチ開始: 進行中の単一指操作（ドラッグ・伸縮）をキャンセルし、
            // 1本目の指のpointerdownが行った編集（原子の配置・伸縮の履歴積みなど）は巻き戻す
            if (this.touchEditSnapshot !== null) {
                const historyLen = this.touchEditHistoryLen;
                this.restoreState(JSON.parse(this.touchEditSnapshot));
                this.history.length = Math.min(this.history.length, historyLen);
                this.touchEditSnapshot = null;
            }
            const pts = [...this.activePointers.values()];
            const viewBox = this.svg.viewBox.baseVal;
            this.pinch = {
                startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
                startWidth: viewBox.width,
                startHeight: viewBox.height,
                // 開始時に2本指の中点の下にあった論理座標。移動中はこの点を常に
                // 中点の真下に保つことで、ズームと同時に2本指ドラッグのパンが効く
                anchor: this.clientToSvg((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2)
            };
            this.isDragging = false;
            this.draggedAtom = null;
            this.dragWholeIds = null;
            this.dragStartRaw = null;
            this.bondStartAtom = null;
            this.bondStretch = null;
            this.clearUIOverlay();
            return 'pinch';
        }
        if (this.pinch || this.activePointers.size > 2) return 'ignore';

        // 1本目のタッチ: ピンチに化けたときに巻き戻せるよう編集前の状態を控える
        this.touchEditSnapshot = this.serializeState();
        this.touchEditHistoryLen = this.history.length;
        return 'proceed';
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
        // 表示はスナップ後の格子座標だけにする（P12-8）。生のマウス座標まで並べると
        // 桁数によって表示幅が 60px〜276px と大きく変わり、リボンの横幅を食っていた。
        // 生の座標は作図データの検算でまれに使うので tooltip に回す
        this.coordDisplay.textContent = `X: ${coords.x}, Y: ${coords.y}`;
        this.coordDisplay.title =
            `スナップ後の格子座標です（マウス位置は X: ${Math.round(coords.rawX)}, Y: ${Math.round(coords.rawY)}）`;
        
        // 1. 結合線ドラッグ中のプレビュー描画
        if (this.selectedTool === 'bond' && this.isDragging && this.bondStartAtom) {
            this.drawBondPreview(this.bondStartAtom.x, this.bondStartAtom.y, coords.rawX, coords.rawY);
        }
        // 1.2 不斉炭素マークモード中: カーソル下の炭素にマーク予定のプレビューを出す（P9-7）
        else if (this.asymmetricMode) {
            this.clearUIOverlay();
            const hovered = this.findAtomAt(coords.rawX, coords.rawY);
            if (hovered && hovered.element === 'C') {
                this.drawAsymmetricPreview(hovered);
            }
        }
        // 1.3 シス/トランス整形モード中: カーソル下の整形可能な C=C をハイライト（P12-7）
        else if (this.reshapeMode) {
            this.clearUIOverlay();
            const hit = this.reshapeBondUnderPoint(coords.rawX, coords.rawY);
            if (hit.bond && hit.eligible) this.drawReshapePreview(hit.bond);
        }
        // 1.4 α/β 面マークモード中: カーソル下の環外置換基（面マーク対象）をハイライト（P12-7 M2b）
        else if (this.haworthMode) {
            this.clearUIOverlay();
            const hovered = this.findAtomAt(coords.rawX, coords.rawY);
            if (this._isHaworthFaceTarget(hovered)) this.drawHaworthPreview(hovered);
        }
        // 1.5 環モジュール選択中: 配置予定の環のゴーストを表示（P7-8）。
        //     n-ring は選択時に決めた員数（this.nringSize）でゴーストを出す
        else if (this.selectedTool === 'select' && this.isRingModule(this.selectedModule)) {
            this.clearUIOverlay();
            const rc = this.selectedModule === 'n-ring' ? this.nringSize : null;
            const ringPlan = this.selectedModule === 'haworth-pyranose'
                ? this.getHaworthPlacementPlan(coords.rawX, coords.rawY)
                : this.getRingPlacementPlan(this.selectedModule, coords.rawX, coords.rawY, rc);
            this.drawRingGhost(ringPlan);
        }
        // 1.6 官能基モジュール選択中: 接続先原子にホバーで配置予定のゴーストを表示（P7-9）
        else if (this.selectedTool === 'select' && this.selectedModule && !this.isRingModule(this.selectedModule)) {
            this.clearUIOverlay();
            const baseAtom = this.findAtomAt(coords.rawX, coords.rawY);
            if (baseAtom && baseAtom.element !== 'H') {
                this.drawFunctionalGroupGhost(this.getFunctionalGroupPlan(this.selectedModule, baseAtom), baseAtom);
            }
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
        // 反応モーフィング再生中はタップでスキップ即完了（それ以外の入力は無視。P12-5 第2弾）
        if (window.reactor && window.reactor.skipMorph()) return;
        // 反応機構モード中はパズル編集を無効化（生成物予測モード中は編集を許可）
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return;
        const coords = this.getSnappedCoords(e);
        const clickedAtom = this.findAtomAt(coords.rawX, coords.rawY);

        // 立体対照ビューの炭素選択モード中はクリックを立体表示に使う（P7-5-M1）
        if (window.stereoView && window.stereoView.picking) {
            window.stereoView.handlePick(clickedAtom);
            return;
        }

        // 反応実行の適用箇所選択モード中はクリックを箇所選択に使う（P9-1 M2）
        if (window.reactor && window.reactor.picking) {
            if (window.reactor.handlePick(clickedAtom)) return;
        }

        // --- 反応させる分子を選ぶモード (ON) 時の特別処理（C-1） ---
        if (this.reactionSelectMode) {
            this.toggleMoleculeSelection(clickedAtom);
            return; // 選択モード時は作図・編集を完全にブロック
        }

        // --- シス/トランス整形モード (ON) 時の特別処理 ---
        if (this.reshapeMode) {
            this.handleReshapeTap(coords);
            return; // 整形モード時は他の配置/編集動作を完全にブロック
        }

        // --- 不斉炭素マークモード (ON) 時の特別処理 ---
        if (this.asymmetricMode) {
            if (clickedAtom && clickedAtom.element === 'C') {
                this.saveState();
                clickedAtom.isAsymmetricMarked = !clickedAtom.isAsymmetricMarked;
                this.updateDrawing();
            }
            return; // 不斉マークモード時は他の配置/編集動作を完全にブロック
        }

        // --- α/β 面マークモード (ON) 時の特別処理（P12-7 M2b） ---
        if (this.haworthMode) {
            if (this._isHaworthFaceTarget(clickedAtom)) {
                this.saveState();
                // 未設定→上(+1)→下(-1)→上… とトグル（初期値は +1）
                clickedAtom.haworthFace = (clickedAtom.haworthFace === 1) ? -1 : 1;
                this.updateDrawing();
            } else if (clickedAtom) {
                this.showToast('面マークできるのは環の炭素に付いた環外置換基（-OH の O や -CH2OH の C）だけです。');
            }
            return; // 面マークモード時は他の配置/編集動作を完全にブロック
        }

        if (this.selectedTool === 'select') {
            if (this.selectedModule) {
                // モジュール（官能基/環）の配置処理。環はカーソル生座標から配置計画を立てる（P7-8）
                const rc = this.selectedModule === 'n-ring' ? this.nringSize : null;
                this.placeModule(this.selectedModule, coords.rawX, coords.rawY, clickedAtom, rc);
                this.selectedModule = null;
                document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
                // 結合の判定領域上をクリックして配置した場合、直後の合成clickによる次数トグルを抑止
                this.suppressBondClick = true;
                setTimeout(() => { this.suppressBondClick = false; }, 0);
            } else if (clickedAtom) {
                if (e.shiftKey) {
                    // Shift+ドラッグ = 掴んだ原子の属する分子を丸ごと動かす（P12-8。ユーザー要望）。
                    // 反応実行は場所が足りないと「分子を離してから実行してください」と案内するのに、
                    // 離す手段が無かった。**削除・元素置換より先に判定する**
                    // （select ツールでは素の原子のクリックは削除/置換になるため、後ろに置くと届かない）
                    this.isDragging = true;
                    this.draggedAtom = clickedAtom;
                    this.dragStartPos = { x: clickedAtom.x, y: clickedAtom.y };
                    this.dragStartClient = { x: e.clientX, y: e.clientY };
                    this.dragWholeIds = this.collectComponent(clickedAtom.id, null);
                    // 分子ごとの移動では、掴んだ原子を**吸着候補に寄せない**。
                    // 吸着は「隣に結合を作る位置」へ引っ張るので、分子を離したいのに
                    // 相手分子へ吸い寄せられる。ポインタの移動量を格子単位に丸めて平行移動する
                    this.dragStartRaw = { x: coords.rawX, y: coords.rawY };
                    this.saveState();
                } else if (!clickedAtom.isLocked && !clickedAtom.benzeneCenter) {
                    if (clickedAtom.element === this.selectedAtomType) {
                        // 同じ元素なら削除（消しゴム代わり）。削除の影響は対象原子のみ（開発方針 5章）
                        this.saveState();
                        this.removeAtomWithSplitNotice(clickedAtom.id);
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
                    this.dragWholeIds = null;
                    this.dragStartRaw = null;
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
                    if (bondTargets.length > 0) this.maybeShowBondToggleHint();
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
            // ロックした原子（練習の付け根など）・付け根の結合手は消せない
            if (clickedAtom && clickedAtom.isLocked) { this.showToast('ここ（ロックした原子）は消せません。'); return; }
            if (clickedBond && this.isAnchorBond(clickedBond)) { this.showToast('付け根の結合手は消せません。'); return; }

            this.saveState();
            if (clickedAtom) {
                this.removeAtomWithSplitNotice(clickedAtom.id);
            } else {
                this.userMolecule.removeBond(clickedBond.atomId1, clickedBond.atomId2);
                // 消しゴムで結合を消す経路にだけ価標の検査が無く、スルホ基の最後の S=O を
                // 消すと「結合3〜4本に対して上限2」の硫黄が作れてしまっていた
                // （v341 の夜間監査で63件。右クリック削除 removeBondByGesture と
                //  原子削除 removeAtomWithSplitNotice には元から入っている）
                if (this.revertIfValencyBroken([clickedBond.atomId1, clickedBond.atomId2])) return;
            }
            this.updateDrawing();
        }
    }

    // 分子（連結成分）の個数を数える
    countMolecules() {
        const seen = new Set();
        let count = 0;
        this.userMolecule.atoms.forEach(a => {
            if (seen.has(a.id)) return;
            count++;
            const stack = [a.id];
            seen.add(a.id);
            while (stack.length) {
                const id = stack.pop();
                this.userMolecule.getNeighbors(id).forEach(n => {
                    if (!seen.has(n.atom.id)) {
                        seen.add(n.atom.id);
                        stack.push(n.atom.id);
                    }
                });
            }
        });
        return count;
    }

    // 原子を削除し、分子が複数に分かれた場合は案内トーストを出す（P7-10）。
    // 分割自体は仕様（複数分子の作図は許可。将来の反応実行モードでも必要）だが、
    // 意図しない切断に気づけるよう通知し、Ctrl+Z での復帰を案内する
    removeAtomWithSplitNotice(atomId) {
        const before = this.countMolecules();
        // 消したあとに価標が壊れうるのは、結合を失う側＝隣の原子（硫黄の S=O など）
        const neighbors = this.userMolecule.getNeighbors(atomId).map(n => n.atom.id);
        this.userMolecule.removeAtom(atomId);
        if (this.revertIfValencyBroken(neighbors)) return;
        const after = this.countMolecules();
        if (after > before) {
            this.showToast(`原子の削除で分子が${after}個に分かれました。意図しない場合は ↩ 戻す（Ctrl+Z）で戻せます。`, 3500, 'success');
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
                if (atom && !atom.isLocked) { // ロックした原子（練習の付け根など）は右クリックでも消さない
                    this.saveState();
                    const neighbors = this.userMolecule.getNeighbors(atom.id).map(n => n.atom.id);
                    this.userMolecule.removeAtom(atom.id);
                    if (this.revertIfValencyBroken(neighbors)) return;
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
            } else if (this.dragWholeIds) {
                // 分子を丸ごと平行移動（Shift+ドラッグ）。形は変えないので結合長も角度もそのまま。
                // 移動量はポインタの生の移動量を格子単位に丸めたもの（吸着は使わない）
                const raw = this.dragStartRaw || { x: this.dragStartPos.x, y: this.dragStartPos.y };
                const dx = Math.round((coords.rawX - raw.x) / GRID_SIZE) * GRID_SIZE;
                const dy = Math.round((coords.rawY - raw.y) / GRID_SIZE) * GRID_SIZE;
                if (this.moveComponentBy(this.dragWholeIds, dx, dy)) {
                    this.updateDrawing();
                } else {
                    // 他の分子と重なる位置には置かない（読めない図を作らないため）
                    this.history.pop();
                    this.showToast('その位置には他の分子と重なるため置けません。別の場所へ動かしてください。');
                }
            } else {
                this.draggedAtom.x = coords.x;
                this.draggedAtom.y = coords.y;
                this.autoConnectAdjacentAtoms();
                this.updateDrawing();
            }
            this.dragStartPos = null;
            this.dragStartClient = null;
            this.dragWholeIds = null;
            this.dragStartRaw = null;
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
                        this.maybeShowBondToggleHint();
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
        const prev = atom.element;
        // 置換後の妥当性を、その原子だけでなく隣接原子についても確認する。
        // 隣接まで見ないと、ニトロ基の -O を別の元素に置換したときに中心のNが
        // 4本結合のまま取り残される（P9-5 監査で発見）
        atom.element = this.selectedAtomType;
        const targets = [atom.id, ...this.userMolecule.getNeighbors(atom.id).map(n => n.atom.id)];
        const invalid = targets.find(id => !isValencyValid(this.userMolecule, id));
        atom.element = prev;

        if (!invalid) {
            this.saveState();
            atom.element = this.selectedAtomType;
            this.updateDrawing();
            return;
        }

        const used = this.userMolecule.getUsedValency(atom.id);
        const maxValency = VALENCIES[this.selectedAtomType] || 0;
        this.showToast(invalid === atom.id
            ? `結合数が多いため、${prev}を${this.selectedAtomType}に置換できません。（現在の結合数: ${used}、${this.selectedAtomType}の最大結合数: ${maxValency}）`
            : 'この置換をすると、隣の原子の結合数が正しくなくなるため実行できません（ニトロ基などの構造が壊れます）。');
    }

    // ===== 結合の伸縮（P6-2b）: 結合線を軸方向にドラッグして長さをグリッド倍数で変える =====

    // 指定結合を除いた上で startId から到達できる原子ID集合を返す（橋判定・移動成分の算出用）
    // 連結成分（分子）を丸ごと (dx, dy) だけ平行移動する（P12-8。Shift+ドラッグ）。
    // 動かした先で**別の分子と近づきすぎる**なら何もせず false を返す。
    // 形（結合長・角度・トポロジー）は一切変えないので、検証や立体の読みには影響しない。
    // 自動結合はしない。分子を離すための操作であって、くっつけるための操作ではないため
    moveComponentBy(ids, dx, dy) {
        if (!ids || ids.size === 0 || (dx === 0 && dy === 0)) return true;
        const MIN_CLEARANCE = GRID_SIZE * 0.65;
        const moving = this.userMolecule.atoms.filter(a => ids.has(a.id));
        const others = this.userMolecule.atoms.filter(a => !ids.has(a.id) && a.element !== 'H');
        for (const a of moving) {
            if (a.element === 'H') continue;
            const nx = a.x + dx, ny = a.y + dy;
            for (const o of others) {
                if (Math.hypot(nx - o.x, ny - o.y) < MIN_CLEARANCE) return false;
            }
        }
        moving.forEach(a => { a.x += dx; a.y += dy; });
        return true;
    }

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

    // 進行中の伸縮ドラッグを「無かったこと」にする（位置を戻し、開始時に積んだ履歴を取り消す）。
    // タッチの長押し/ダブルタップ削除は pointerdown で始まった伸縮の最中に割り込むため必要
    cancelBondStretch() {
        const st = this.bondStretch;
        if (!st) return;
        this.bondStretch = null;
        if (st.ringBond) return; // 環内結合は履歴を積んでいない
        st.movingIds.forEach(id => {
            const atom = this.userMolecule.atoms.find(a => a.id === id);
            const orig = st.origPositions.get(id);
            if (atom && orig) {
                atom.x = orig.x;
                atom.y = orig.y;
            }
        });
        this.history.pop();
    }

    // 結合をジェスチャ（消しゴム・長押し・ダブルタップ・右クリック）から安全に削除する。
    // 既に消えている場合の二重削除（Android では contextmenu と長押しタイマーが両方
    // 発火しうる）を防ぎ、進行中の伸縮ドラッグは巻き戻してから削除する
    /**
     * 直前の saveState() まで巻き戻して操作を取り消す。価標が壊れたときだけ使う。
     *
     * 硫黄の許容価標は S=O の有無で 6↔2 と文脈で変わるため、**結合や原子を減らす操作でも**
     * 上限のほうが大きく下がって違反が残ることがある。スルホ基の片方を単結合にしてから
     * 残る S=O を消すと、結合3本に対して上限2になる（v331/v338 の夜間監査で検出）。
     * 元素表だけを見る空き価標の計算では捕まらないので、変更を当てたあとに確かめる。
     */
    revertIfValencyBroken(ids) {
        const mol = this.userMolecule;
        const broken = ids.some(id => mol.atoms.some(a => a.id === id) && !isValencyValid(mol, id));
        if (!broken) return false;
        const saved = this.history.pop();
        if (saved) this.restoreState(JSON.parse(saved)); // restoreState が再描画まで行う
        this.showToast('この操作は取り消しました。硫黄は S=O があってはじめて6本の手を持てるため、' +
            '最後の S=O を消すと残りの結合の数が合わなくなります。' +
            '先に S-O を二重結合へ戻すか、硫黄ごと消してください。');
        return true;
    }

    removeBondByGesture(bond) {
        if (!this.userMolecule.getBond(bond.atomId1, bond.atomId2)) return false;
        if (this.isAnchorBond(bond)) { this.showToast('付け根の結合手は消せません。'); return false; }
        this.cancelBondStretch();
        this.saveState();
        this.userMolecule.removeBond(bond.atomId1, bond.atomId2);
        if (this.revertIfValencyBroken([bond.atomId1, bond.atomId2])) return false;
        this.updateDrawing();
        return true;
    }

    // 付け根マーカー R につながる「結合手」の結合か（アルキル基練習で削除を禁じる）
    isAnchorBond(bond) {
        const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
        const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
        return (a1 && a1.element === 'R') || (a2 && a2.element === 'R');
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
    // 操作モードを設定し、排他関係（モジュール選択・不斉マーク編集）を解除する
    setTool(tool) {
        this.selectedTool = tool;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
        if (btn) btn.classList.add('active');
        this.selectedModule = null;
        document.querySelectorAll('.mod-btn').forEach(b => b.classList.remove('active'));
        this.asymmetricMode = false;
        const bam = document.getElementById('btn-asym-mark');
        if (bam) bam.classList.remove('active');
        this.reshapeMode = false;
        this._reshapeLastBond = null;
        const brs = document.getElementById('btn-cistrans-reshape');
        if (brs) brs.classList.remove('active');
        this.deactivateHaworthMode();
    }

    // α/β 面マークモードを解除する（他モードへ切替える既存フックから呼ぶ。P12-7 M2b）
    deactivateHaworthMode() {
        this.haworthMode = false;
        const bhm = document.getElementById('btn-haworth-mark');
        if (bhm) bhm.classList.remove('active');
    }

    // 初めて結合ができたときに一度だけ、結合線タップで次数を変えられることを案内する。
    // モバイルでは結合タイプボタンを非表示にしているため、この導線が代替になる（P11-M2b）
    maybeShowBondToggleHint() {
        try {
            if (localStorage.getItem('chemHintBondToggle')) return;
            localStorage.setItem('chemHintBondToggle', '1');
        } catch (e) { return; }
        this.showToast('💡 結合線をタップすると 単 → 二重 → 三重 と切り替えられます', 6000, 'success');
    }

    showToast(message, ms = 3000, type = 'error') {
        // 描画エリア内にも字幕として出す（P12-8。ユーザー要望）。
        // 右パネルの #verify-result はスクロールで見切れて気づかれないことがあるため、
        // キャンバス内の字幕を主役にする（#verify-result も従来どおり更新して互換を保つ）
        const canvasToast = document.getElementById('canvas-toast');
        if (canvasToast) {
            canvasToast.textContent = message;
            canvasToast.className = type; // success / error
            clearTimeout(this._canvasToastTimer);
            this._canvasToastTimer = setTimeout(() => {
                if (canvasToast.textContent === message) canvasToast.className = 'hidden';
            }, ms);
        }
        const resultDiv = document.getElementById('verify-result');
        if (!resultDiv) return;
        resultDiv.textContent = message;
        resultDiv.className = `result-message ${type}`;
        resultDiv.classList.remove('hidden');
        clearTimeout(this._toastTimer);
        // 自分の表示中だけ隠す（後から別の判定結果等が出た場合はそれを消さない）
        this._toastTimer = setTimeout(() => {
            if (resultDiv.textContent === message) resultDiv.classList.add('hidden');
        }, ms);
    }

    // ===== 化合物名判定・分子式表示（P7-6） =====

    // 分子式を計算する（自動水素を含む。表記はHill方式: C→H→他はアルファベット順）
    computeMolecularFormula(mol = this.userMolecule) {
        const counts = {};
        let hCount = 0;
        mol.atoms.forEach(a => {
            counts[a.element] = (counts[a.element] || 0) + 1;
            hCount += mol.getFreeValency(a.id);
        });
        if (hCount > 0) counts['H'] = (counts['H'] || 0) + hCount;

        const order = [];
        if (counts['C']) order.push('C');
        if (counts['H']) order.push('H');
        Object.keys(counts).filter(e => e !== 'C' && e !== 'H').sort().forEach(e => order.push(e));

        const sub = (n) => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        return order.map(e => counts[e] === 1 ? e : e + sub(counts[e])).join('');
    }

    // 名称判定ライブラリ（ステージ＋compounds.json）を検証用Molecule付きで遅延構築する。
    // 立体指定（stereo）付きエントリを先頭に置き、優先的に照合する（P8-1 → P12-7 M1）。
    // あわせて正準コード→エントリのMapを作り、照合をO(1)にする（P8-2）
    getCompoundLibrary() {
        if (!this._compoundLibrary) {
            // ステージ側の stereo も渡す。落とすと「立体指定なしの同名エントリ」が生まれ、
            // 立体を指定していない糖が糖名に一致してしまう（ラインナップ拡充のときテストST3が検出）
            const entries = [
                ...STAGES.map(s => ({ name: s.name, target: s.target, stereo: s.stereo })),
                ...COMPOUNDS.map(c => ({ name: c.name, target: c.target, stereo: c.stereo }))
            ];
            // 立体情報を持つエントリ（stereo 記述子 or target に haworthFace）を先に照合する。
            // これにより「立体指定つき」が「総称（立体なし）」より優先して当たる。
            const hasStereoInfo = (e) => !!e.stereo ||
                (e.target && e.target.atoms &&
                 e.target.atoms.some(a => a.haworthFace === 1 || a.haworthFace === -1));
            entries.sort((a, b) => (hasStereoInfo(b) ? 1 : 0) - (hasStereoInfo(a) ? 1 : 0));
            this._compoundLibrary = entries.map(e => {
                const mol = this.createTargetFromData({ target: e.target });
                // 鎖・非環の立体は stereo.atomParity/bondGeo（添字→ID 写像。M1/M2a）、
                // 環の立体は target の haworthFace から readRingParityFromHaworth で読む（M2b）。
                // 両者は相互排他（非環中心／環中心）ゆえキー衝突なく合流できる。
                const mapped = e.stereo ? this._mapStereoToMol(e.stereo, mol) : {};
                const ringParity = readRingParityFromHaworth(mol);
                let stereoCode = null;
                if (e.stereo || Object.keys(ringParity).length > 0) {
                    stereoCode = canonicalStereoCode(mol, {
                        atomParity: { ...(mapped.atomParity || {}), ...ringParity },
                        bondGeo: mapped.bondGeo
                    });
                }
                // 結合の幾何（シス/トランス）だけのコード。「立体を名前に反映する」が OFF でも
                // **シス/トランスは残す**ために使う（2026-08-02）。トグルの見出しは
                // 「立体（D/L・α/β）」であり、幾何異性は高校化学の基本語なので落とさない
                let geoCode = null;
                if (mapped.bondGeo && Object.keys(mapped.bondGeo).length > 0) {
                    geoCode = canonicalStereoCode(mol, { atomParity: {}, bondGeo: mapped.bondGeo });
                }
                return {
                    name: e.name,
                    stereoCode,
                    geoCode,
                    mol,
                    code: canonicalCode(mol)
                };
            });
            // 同じ化合物が stages.json と compounds.json の両方にある（＝ステージにも出す）ことは
            // あるし、1つの化合物を複数のシリーズに置くこともある。**名前も構造も同じ重複は畳む**。
            // 畳まないと照合の候補が無駄に増え、「同一構造に複数の名前」の検査（F8）も
            // 同じ名前を2つ数えて落ちる（ラインナップ拡充のとき実際に落ちた）
            const seenKey = new Set();
            this._compoundLibrary = this._compoundLibrary.filter(e => {
                const key = `${e.name}|${e.code}|${e.stereoCode || '-'}`;
                if (seenKey.has(key)) return false;
                seenKey.add(key);
                return true;
            });
            this._compoundCodeMap = new Map();
            this._compoundLibrary.forEach(e => {
                if (!this._compoundCodeMap.has(e.code)) this._compoundCodeMap.set(e.code, []);
                this._compoundCodeMap.get(e.code).push(e);
            });
        }
        return this._compoundLibrary;
    }

    // 立体を名前に反映するかを切り替える（P12-7 M2e。ユーザー要望「明示的に切り替えたい」）。
    // 設定は localStorage に保存し、名称表示をその場で作り直す
    setReadStereo(on) {
        this.readStereo = !!on;
        if (this.checkReadStereo) this.checkReadStereo.checked = this.readStereo;
        try { localStorage.setItem('chemAssembler.readStereo', this.readStereo ? '1' : '0'); } catch (e) { /* noop */ }
        this.updateDrawing();
    }

    // compounds.json の立体記述子（target.atoms の添字キー）を、
    // createTargetFromData で生成した mol の実行時 atomId へ写像する（P12-7 M1）。
    // bondGeo のキー "i_j"（i,j は添字）→ 実際の Bond の ID 昇順キー。
    // atomParity のキー "i"（添字）→ atomId。将来の sp3 記述子に備えて両対応。
    _mapStereoToMol(stereo, mol) {
        const out = {};
        const idAt = (idx) => (mol.atoms[idx] ? mol.atoms[idx].id : null);
        if (stereo.bondGeo) {
            out.bondGeo = {};
            Object.keys(stereo.bondGeo).forEach(k => {
                const [i, j] = k.split('_').map(Number);
                const id1 = idAt(i), id2 = idAt(j);
                if (id1 == null || id2 == null) return;
                const bond = mol.getBond(id1, id2);
                if (!bond) return;
                out.bondGeo[`${bond.atomId1}_${bond.atomId2}`] = stereo.bondGeo[k];
            });
        }
        if (stereo.atomParity) {
            out.atomParity = {};
            Object.keys(stereo.atomParity).forEach(k => {
                const id = idAt(Number(k));
                if (id != null) out.atomParity[id] = stereo.atomParity[k];
            });
        }
        return out;
    }

    // 右パネルの「いま描いている分子」表示を更新する（updateDrawingから毎回呼ばれる）
    updateCompoundInfo() {
        const nameEl = document.getElementById('compound-name');
        const formulaEl = document.getElementById('compound-formula');
        if (!nameEl || !formulaEl) return;

        if (this.userMolecule.atoms.length === 0) {
            nameEl.textContent = '—';
            formulaEl.textContent = '—';
            this.syncMobileNameChip();
            return;
        }
        formulaEl.textContent = this.computeMolecularFormula();

        // 生成物予測モード中は名称を伏せる（答えのヒントになりすぎるため）
        if (window.reactionPlayer && window.reactionPlayer.prediction) {
            nameEl.textContent = '？？？（予測中）';
            this.syncMobileNameChip();
            return;
        }

        // 複数の分子があるときは分子ごとに名前を出す（反応の副生成物や、名称呼び出しで
        // 複数分子を並べた場合に「該当なし」にならないようにする。P9-1 M3）
        // 分子が2つ以上あるときは①②③の番号を振り、キャンバス上の見出しと対応づける
        // （P12-8。ユーザー要望「分子に識別記号を振り、右ペインの化合物名にも反映」）。
        // A/B/C は C＝炭素・B＝ホウ素と元素記号がぶつかり、α/β は糖のアノマー表記とぶつかるので使わない。
        // 番号の付け方は markedMolecules に集約してあるので、図とずれない
        const { parts, marks } = this.markedMolecules(null);
        const names = parts.map(m => this.lookupCompoundName(m));
        nameEl.textContent = parts.length === 1
            ? (names[0] || '（ライブラリに該当なし）')
            : parts.map((p, i) => {
                const mark = marks.get(p);
                return (mark ? mark + ' ' : '') + (names[i] || '（該当なし）');
            }).join(' ＋ ');
        this.syncMobileNameChip();
    }

    // モバイル用の化合物名チップ（キャンバス左下）を右パネルの表示と同期する。
    // 名称があれば「名称＋分子式」、なければ分子式のみ。学習モード・空分子では消す（P11-M3c）
    syncMobileNameChip() {
        const chip = document.getElementById('mobile-name-chip');
        if (!chip) return;
        const name = document.getElementById('compound-name')?.textContent || '';
        const formula = document.getElementById('compound-formula')?.textContent || '';
        if (this.currentMode === 'learn' || this.userMolecule.atoms.length === 0) {
            chip.textContent = '';
            return;
        }
        const hasName = name && name !== '—' && !name.startsWith('（ライブラリに該当なし）');
        chip.textContent = hasName ? `${name}　${formula}` : formula;
    }

    // 連結成分ごとに独立した Molecule を作って返す（描画・判定には影響しない一時オブジェクト）
    splitMolecules() {
        const remaining = new Set(this.userMolecule.atoms.map(a => a.id));
        const parts = [];
        while (remaining.size > 0) {
            const startId = remaining.values().next().value;
            const ids = new Set([startId]);
            const stack = [startId];
            while (stack.length) {
                const id = stack.pop();
                this.userMolecule.getNeighbors(id).forEach(n => {
                    if (!ids.has(n.atom.id)) {
                        ids.add(n.atom.id);
                        stack.push(n.atom.id);
                    }
                });
            }
            ids.forEach(id => remaining.delete(id));
            const part = new Molecule();
            this.userMolecule.atoms.filter(a => ids.has(a.id)).forEach(a => {
                const na = new Atom(a.id, a.element, a.x, a.y, a.isLocked);
                Object.assign(na, a);
                part.atoms.push(na);
            });
            this.userMolecule.bonds
                .filter(b => ids.has(b.atomId1) && ids.has(b.atomId2))
                .forEach(b => part.bonds.push(new Bond(b.atomId1, b.atomId2, b.type)));
            parts.push(part);
        }
        return parts;
    }

    // 1分子の名称をライブラリから引く。見つからなければ null
    // 正準コードでO(1)照合（P8-2）。ヒット候補には念のためverifyMoleculeで最終確認を行い、
    // 立体指定（stereo）付きエントリは描かれた分子の立体コードも一致した場合のみ採用（P12-7 M1）。
    // 立体指定の無いエントリはユーザーの描き幾何を見ない（従来どおり幾何不問）。
    lookupCompoundName(mol) {
        this.getCompoundLibrary(); // コードMapの構築を保証
        const candidates = this._compoundCodeMap.get(canonicalCode(mol)) || [];
        // 立体を名前に反映するのは、**フィッシャー投影として描かれた図だけ**
        // （DESIGN_stereo_orientation.md・レビュー項目21 の2点目）。
        // 主鎖を横に並べた普通の構造式は「立体を指定していない図」なので、
        // トグルが ON でも総称で名乗る。ここを通すと、たまたま十字になっただけの
        // アラニン・セリン・乳酸に D-/L- が付いてしまう。
        // **門番は名前だけに掛ける**（立体の読み取り自体に掛けるとパズルが壊れる。
        // 理由は chemistry.js の isFischerOriented の説明）
        const useStereo = this.readStereo &&
            (typeof isFischerOriented !== 'function' || isFischerOriented(mol));
        // ユーザー分子の立体コードは座標から読んだ結合幾何（E/Z）＋フィッシャー投影の
        // sp3 パリティ（P12-7 M2a）で構成する。立体指定エントリが候補にあるときだけ計算する。
        let userStereoCode = null;
        let userGeoCode = null;
        const hit = candidates.find(e => {
            if (e.stereoCode) {
                // 「立体を名前に反映する」が OFF のとき、**D/L・α/β は落とすが
                // シス/トランス（結合の幾何）は残す**（2026-08-02。トグルの見出しどおり）。
                // 幾何だけのコードを持つエントリは、幾何だけで照合する
                if (!useStereo) {
                    if (!e.geoCode) return false; // D/L・α/β の指定 → 総称名に落とす
                    if (userGeoCode === null) {
                        userGeoCode = canonicalStereoCode(mol, {
                            atomParity: {}, bondGeo: readBondGeoFromCoords(mol)
                        });
                    }
                    return userGeoCode === e.geoCode && verifyMolecule(mol, e.mol);
                }
                if (userStereoCode === null) {
                    userStereoCode = canonicalStereoCode(mol, {
                        atomParity: { ...readAtomParityFromFischer(mol), ...readRingParityFromHaworth(mol) },
                        bondGeo: readBondGeoFromCoords(mol)
                    });
                }
                if (userStereoCode !== e.stereoCode) return false;
            }
            return verifyMolecule(mol, e.mol);
        });
        if (hit) return hit.name;
        // 「立体を名前に反映する」が OFF のとき、**立体つきの登録しか無い分子**（糖など）は
        // ここまでで候補が全滅して名無しになってしまう。アラニンや乳酸には総称の登録が
        // あるので落ちてこないが、グルコースには無い ＝「描いたのに名前が出ない」になる。
        // そこで**接頭辞を外した総称**に落とす（2026-08-02。既定を OFF にしたときに発覚）。
        // 候補の総称が割れる場合（別の分子に化ける）は名乗らない
        if (!useStereo) {
            const bases = new Set();
            candidates.forEach(e => {
                if (!e.stereoCode || !verifyMolecule(mol, e.mol)) return;
                // 立体の印は名前のどこにあっても外す（「α-D-グルコース（α-D-グルコピラノース）」は
                // かっこの中にも付いている）
                bases.add(e.name.replace(/[αβ]-|[DL]-/g, ''));
            });
            if (bases.size === 1) return [...bases][0];
            // 総称が割れる ＝ **立体を見ないと区別がつかない**分子（アルドヘキソースなど）。
            // 黙って名無しにすると「描いたのに名前が出ない」になるので、候補を並べて
            // なぜ決まらないのかを見せる（トグルを ON にする動機にもなる）
            if (bases.size > 1) {
                const list = [...bases].sort();
                const head = list.slice(0, 2).join('／');
                return (list.length <= 2 ? head : `${head}ほか${list.length - 2}種`) +
                    ' のどれか（立体で決まります）';
            }
        }
        // ライブラリに無ければ IUPAC 系統名を試す（非環式アルカンのみ対応。P12-3 第2弾）
        return iupacName(mol) || null;
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
            // ハース面マーク（環の α/β）があれば埋め込む（コンテンツ制作で作図→エクスポート用。P12-7 M2b）
            atoms: heavy.map(a => (a.haworthFace === 1 || a.haworthFace === -1)
                ? { element: a.element, x: round1(a.x), y: round1(a.y), haworthFace: a.haworthFace }
                : { element: a.element, x: round1(a.x), y: round1(a.y) }),
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

    // 環・官能基モジュールの配置（n-ringは員数モーダルを経由して ringCount 付きで再入する）
    isRingModule(moduleType) {
        return moduleType === 'benzene' || moduleType === 'cyclopentane' ||
               moduleType === 'cyclohexane' || moduleType === 'n-ring' ||
               moduleType === 'haworth-pyranose';
    }

    // ハース環（ピラノース）モジュールの配置計画（P12-7 M2c）。
    // 向き固定の平たいハース六角形（上下辺が水平・横長）を、環内 O 付きでスタンプする。
    // 巡回順 O→C1→C2→C3→C4→C5 は compounds.json の α/β-D-グルコピラノースと同一 handedness。
    // getRingPlacementPlan と違い正多角形ではなく固定座標なので専用に持つ（ゴースト・実配置で共用）。
    getHaworthPlacementPlan(rawX, rawY) {
        const MIN_CLEARANCE = GRID_SIZE * 0.65;
        // 中心基準の相対座標（絶対の O(455,252)…C5(345,252) を中心(400,300)から引いた値）。
        // 縦に十分な高さを取り、前縁(C2,C3)を奥辺(O,C5)より内側へ寄せる。これにより
        // 環炭素の真上/真下へ置換基を伸ばしても隣の環原子と重ならない（縦置き入力の余裕を確保）。
        // 環外置換基は付けない（骨格のみ。ユーザーが上下に -OH / -CH2OH を付ける）。
        const REL = [
            { el: 'O', dx: 55, dy: -48 }, // 0: 環内 O（右奥）
            { el: 'C', dx: 100, dy: 0 },  // 1: C1（アノマー・右）
            { el: 'C', dx: 30, dy: 48 },  // 2: C2（右手前・内側へ）
            { el: 'C', dx: -30, dy: 48 }, // 3: C3（左手前・内側へ）
            { el: 'C', dx: -100, dy: 0 }, // 4: C4
            { el: 'C', dx: -55, dy: -48 } // 5: C5（左奥）
        ];
        // カーソルを絶対グリッドに丸めた点を中心にする（自由配置の環と同じ流儀）
        const center = {
            x: Math.round(rawX / GRID_SIZE) * GRID_SIZE,
            y: Math.round(rawY / GRID_SIZE) * GRID_SIZE
        };
        const vertices = REL.map(r => ({ el: r.el, x: center.x + r.dx, y: center.y + r.dy, existing: null }));

        // 既存の重原子と最小間隔を確保（重なり防止）。テンプレートは縮合・マージしない固定骨格。
        const heavy = this.userMolecule.atoms.filter(a => a.element !== 'H');
        const clash = vertices.some(v => heavy.some(a => Math.hypot(a.x - v.x, a.y - v.y) < MIN_CLEARANCE));
        if (clash) {
            return { valid: false, reason: 'overlap', vertices, center };
        }
        const edges = [];
        for (let i = 0; i < 6; i++) edges.push({ i, j: (i + 1) % 6, type: 1, exists: false });
        return { valid: true, vertices, edges, center };
    }

    // ハース環モジュールで固定骨格をキャンバスに置く（P12-7 M2c）。saveState で Undo 可。
    placeHaworthPyranose(rawX, rawY) {
        const plan = this.getHaworthPlacementPlan(rawX, rawY);
        if (!plan.valid) {
            this.showToast('既存の原子と重なるため、ここにはハース環を置けません。位置を少しずらしてください。');
            return; // 配置しない場合はUndo履歴を消費しない（開発方針 3.5章）
        }
        this.saveState();
        const ringAtoms = plan.vertices.map(v => this.userMolecule.addAtom(v.el, v.x, v.y));
        plan.edges.forEach(e => this.userMolecule.addBond(ringAtoms[e.i].id, ringAtoms[e.j].id, e.type));
        this.autoConnectAdjacentAtoms();
        this.updateDrawing();
    }

    // ある原子が「酸素を含む環（＝ピラノース環などのハース環）」に属するか（P12-7 M2c）。
    // 環外側鎖を縦（真上・真下）へスナップする対象を、糖の環に限定するために使う。
    // ベンゼン・シクロヘキサンなど全炭素環には反応しない。分子は小さいので単純DFSで十分。
    _atomInOxygenRing(atomId) {
        const mol = this.userMolecule;
        const hasO = (path) => path.some(id => {
            const a = mol.atoms.find(x => x.id === id);
            return a && a.element === 'O';
        });
        const dfs = (cur, prev, path) => {
            const nbrs = mol.getNeighbors(cur).filter(n => n.atom.element !== 'H');
            for (const n of nbrs) {
                if (n.atom.id === prev) continue;
                if (n.atom.id === atomId && path.length >= 3) {
                    if (hasO(path)) return true; // atomId を含む環に O があればハース環
                } else if (!path.includes(n.atom.id) && path.length < 7) {
                    if (dfs(n.atom.id, cur, [...path, n.atom.id])) return true;
                }
            }
            return false;
        };
        return dfs(atomId, null, [atomId]);
    }

    // 環モジュールの配置計画（P7-8）。ゴーストプレビューと実配置の両方がこの関数を使うことで
    // 「見えた通りに置かれる」ことを保証する（getPlacementBondTargets と同じ原則）。
    // カーソルが既存結合の縮合位置（その結合を1辺とする正N角形の中心）に近ければ縮合に吸着し、
    // それ以外は絶対グリッドに丸めた自由配置。頂点は12px以内の既存原子にマージする。
    getRingPlacementPlan(moduleType, rawX, rawY, ringCount = null) {
        const MERGE_DIST = 12;
        const MIN_CLEARANCE = GRID_SIZE * 0.65;
        const FUSION_SNAP = 40; // この距離内に縮合候補の中心があれば縮合を優先

        let count = 6;
        let R = GRID_SIZE * 0.833;
        let angleOffset = 0; // benzene は頂点が左右（既存動作の維持）
        if (moduleType === 'n-ring') {
            count = ringCount || 6;
            R = GRID_SIZE / (2 * Math.sin(Math.PI / count));
            angleOffset = -Math.PI / 2;
        } else if (moduleType === 'cyclopentane') {
            count = 5;
            R = GRID_SIZE * 0.85;
            angleOffset = -Math.PI / 2;
        } else if (moduleType === 'cyclohexane') {
            count = 6;
            R = GRID_SIZE;
            angleOffset = -Math.PI / 2;
        }

        const heavy = this.userMolecule.atoms.filter(a => a.element !== 'H');

        // --- 縮合候補: 既存の重原子間結合を新しい環の1辺として使う（向き任意・辺長に環を合わせる） ---
        let fusion = null;
        this.userMolecule.bonds.forEach(b => {
            const a1 = this.userMolecule.atoms.find(a => a.id === b.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === b.atomId2);
            if (!a1 || !a2 || a1.element === 'H' || a2.element === 'H') return;
            const L = Math.hypot(a2.x - a1.x, a2.y - a1.y);
            if (L < 20 || L > 95) return; // 極端な長さの辺は環の辺として使わない
            const mx = (a1.x + a2.x) / 2, my = (a1.y + a2.y) / 2;
            let nx = -(a2.y - a1.y) / L, ny = (a2.x - a1.x) / L;
            if ((rawX - mx) * nx + (rawY - my) * ny < 0) { nx = -nx; ny = -ny; } // カーソル側へ
            const Rf = L / (2 * Math.sin(Math.PI / count));
            const cx = mx + Rf * Math.cos(Math.PI / count) * nx;
            const cy = my + Rf * Math.cos(Math.PI / count) * ny;
            const d = Math.hypot(rawX - cx, rawY - cy);
            if (d < FUSION_SNAP && (!fusion || d < fusion.d)) {
                fusion = { d, a1, a2, cx, cy, Rf };
            }
        });

        let center, vertices = [];
        if (fusion) {
            // 縮合: 共有辺の両端を隣接頂点0・1として残りを回転で求める
            center = { x: fusion.cx, y: fusion.cy };
            const ang1 = Math.atan2(fusion.a1.y - center.y, fusion.a1.x - center.x);
            const ang2 = Math.atan2(fusion.a2.y - center.y, fusion.a2.x - center.x);
            let step = 2 * Math.PI / count;
            const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
            if (Math.abs(norm(ang1 + step - ang2)) > 0.01) step = -step;
            for (let k = 0; k < count; k++) {
                const ang = ang1 + step * k;
                vertices.push({ x: center.x + fusion.Rf * Math.cos(ang), y: center.y + fusion.Rf * Math.sin(ang) });
            }
        } else {
            // 自由配置: カーソルを絶対グリッドに丸めた点が中心
            center = {
                x: Math.round(rawX / GRID_SIZE) * GRID_SIZE,
                y: Math.round(rawY / GRID_SIZE) * GRID_SIZE
            };
            for (let k = 0; k < count; k++) {
                const ang = (moduleType === 'benzene') ? k * Math.PI / 3 : k * 2 * Math.PI / count + angleOffset;
                vertices.push({ x: center.x + R * Math.cos(ang), y: center.y + R * Math.sin(ang) });
            }
        }

        // 頂点の解決: 12px以内の既存重原子にマージ。同一原子への二重マージは不正
        vertices.forEach(v => {
            v.existing = heavy.find(a => Math.hypot(a.x - v.x, a.y - v.y) <= MERGE_DIST) || null;
        });
        const mergedIds = vertices.filter(v => v.existing).map(v => v.existing.id);
        if (new Set(mergedIds).size !== mergedIds.length) {
            return { valid: false, reason: 'overlap', vertices, center };
        }
        // 新規頂点は既存原子（マージ対象を除く）と最小間隔を確保（環と既存分子の重なり防止）
        const mergedSet = new Set(mergedIds);
        const clash = vertices.some(v => !v.existing && heavy.some(a =>
            !mergedSet.has(a.id) && Math.hypot(a.x - v.x, a.y - v.y) < MIN_CLEARANCE));
        if (clash) {
            return { valid: false, reason: 'overlap', vertices, center };
        }
        // 孤立配置の禁止（従来ルール踏襲）
        if (heavy.length > 0 && !fusion &&
            !vertices.some(v => this.isNearAnyExistingAtom(v.x, v.y))) {
            return { valid: false, reason: 'isolated', vertices, center };
        }

        // 辺の計画: 既存結合は温存。ベンゼンは「二重結合を持たない頂点どうし」に貪欲に
        // 二重結合を割り当てる（縮合してもケクレ交互が破綻しない）
        const hasDouble = new Set();
        const keyOf = (v, idx) => v.existing ? 'a:' + v.existing.id : 'n:' + idx;
        vertices.forEach((v, i) => {
            if (v.existing && this.userMolecule.getNeighbors(v.existing.id).some(n => n.type === 2)) {
                hasDouble.add(keyOf(v, i));
            }
        });
        const edges = [];
        for (let i = 0; i < count; i++) {
            const j = (i + 1) % count;
            const vi = vertices[i], vj = vertices[j];
            const exists = !!(vi.existing && vj.existing &&
                this.userMolecule.getBond(vi.existing.id, vj.existing.id));
            let type = 1;
            if (!exists && moduleType === 'benzene') {
                const ki = keyOf(vi, i), kj = keyOf(vj, j);
                if (!hasDouble.has(ki) && !hasDouble.has(kj)) {
                    type = 2;
                    hasDouble.add(ki);
                    hasDouble.add(kj);
                }
            }
            edges.push({ i, j, type, exists });
        }
        // 何も追加されない配置（既存の環への重ね置き）は不正扱い
        if (!vertices.some(v => !v.existing) && edges.every(e => e.exists)) {
            return { valid: false, reason: 'overlap', vertices, center };
        }
        // 価標チェック: マージ原子へ追加される結合次数が空き価標を超えないか
        const addedOrder = new Map();
        edges.forEach(e => {
            if (e.exists) return;
            [e.i, e.j].forEach(idx => {
                const v = vertices[idx];
                if (v.existing) addedOrder.set(v.existing.id, (addedOrder.get(v.existing.id) || 0) + e.type);
            });
        });
        for (const [id, add] of addedOrder) {
            if (this.userMolecule.getFreeValency(id) < add) {
                return { valid: false, reason: 'valency', vertices, center };
            }
        }

        return { valid: true, vertices, edges, center };
    }

    // 環モジュールのゴーストプレビュー（P7-8）: 配置予定の環の輪郭を描く。
    // マージされる頂点（吸着）は白抜きの丸で示し、置けない場合は赤で示す
    drawRingGhost(plan) {
        const NS = 'http://www.w3.org/2000/svg';
        const color = plan.valid ? 'rgba(0, 242, 254, 0.75)' : 'rgba(255, 90, 90, 0.85)';
        const poly = document.createElementNS(NS, 'polygon');
        poly.setAttribute('points', plan.vertices.map(v => `${v.x},${v.y}`).join(' '));
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', color);
        poly.setAttribute('stroke-width', '3');
        poly.setAttribute('stroke-dasharray', '6,5');
        this.uiGroup.appendChild(poly);
        plan.vertices.forEach(v => {
            const c = document.createElementNS(NS, 'circle');
            c.setAttribute('cx', v.x);
            c.setAttribute('cy', v.y);
            c.setAttribute('r', v.existing ? 8 : 5);
            c.setAttribute('fill', v.existing ? 'none' : color);
            c.setAttribute('stroke', color);
            c.setAttribute('stroke-width', '2');
            this.uiGroup.appendChild(c);
        });
    }

    placeModule(moduleType, x, y, clickedAtom, ringCount = null) {
        const isRing = this.isRingModule(moduleType);

        if (moduleType === 'haworth-pyranose') {
            // ハース環は正多角形でなく固定骨格なので専用配置（環内 O つき。P12-7 M2c）
            this.placeHaworthPyranose(x, y);
            return;
        }

        if (moduleType === 'n-ring' && ringCount === null) {
            // 員数はモーダルで選ばせる（開発方針3.4: prompt/alertは使わない）
            this.pendingRing = { x, y, clickedAtom };
            this.nringModal.classList.remove('hidden');
            return;
        }

        if (isRing) {
            // 配置計画はゴーストプレビューと同一の判定（プレビュー＝実結果を保証）
            const plan = this.getRingPlacementPlan(moduleType, x, y, ringCount);
            if (!plan.valid) {
                const msg = plan.reason === 'isolated'
                    ? '既存の分子から離れた場所には配置できません。つなげたい場所の近くをクリックしてください。'
                    : plan.reason === 'valency'
                        ? '縮合先の原子に空き価標が足りないため、ここには環を作れません。'
                        : '既存の原子と重なるため、ここには配置できません。位置を少しずらしてください。';
                this.showToast(msg);
                return; // 配置しない場合はUndo履歴を消費しない（開発方針 3.5章）
            }
            this.saveState();
            const ringAtoms = plan.vertices.map(v =>
                v.existing || this.userMolecule.addAtom('C', v.x, v.y));
            if (moduleType === 'benzene') {
                ringAtoms.forEach((c, i) => {
                    c.benzeneCenter = { x: plan.center.x, y: plan.center.y };
                    c.benzeneAngle = Math.atan2(plan.vertices[i].y - plan.center.y, plan.vertices[i].x - plan.center.x);
                });
            }
            plan.edges.forEach(e => {
                if (!e.exists) this.userMolecule.addBond(ringAtoms[e.i].id, ringAtoms[e.j].id, e.type);
            });
            this.autoConnectAdjacentAtoms();
            this.updateDrawing();
            return;
        }

        // 官能基モジュールは接続先原子が必須。配置できない場合はUndo履歴を消費せずに案内する（開発方針 3.5章）
        if (!clickedAtom) {
            this.showToast('官能基を結合するには、接続先の既存の原子（Cなど）をクリックしてください。');
            return;
        }

        // 配置計画はゴーストプレビューと同一の判定（プレビュー＝実結果を保証）
        const plan = this.getFunctionalGroupPlan(moduleType, clickedAtom);
        if (!plan.valid) {
            const msg = plan.reason === 'valency'
                ? 'この原子には空き価標がないため、官能基を結合できません。'
                : '既存の原子と重なるため、ここには官能基を配置できません。';
            this.showToast(msg);
            return; // 配置しない場合はUndo履歴を消費しない（開発方針 3.5章）
        }

        this.saveState();
        const placed = plan.atoms.map(a => this.userMolecule.addAtom(a.element, a.x, a.y));
        plan.bonds.forEach(b => {
            const from = b.from === -1 ? clickedAtom : placed[b.from];
            const to = b.to === -1 ? clickedAtom : placed[b.to];
            this.userMolecule.addBond(from.id, to.id, b.type);
        });
        this.autoConnectAdjacentAtoms();
        this.updateDrawing();
    }

    // 官能基モジュールの配置計画（P7-9）。ゴーストプレビューと実配置の両方がこの関数を使う。
    // atoms: 追加する原子（座標・元素）、bonds: from/to は atoms の添字（-1 は接続先の既存原子）
    getFunctionalGroupPlan(moduleType, baseAtom) {
        // 接続先の空き価標が無ければ、方向を変えても置けない
        if (this.userMolecule.getFreeValency(baseAtom.id) < 1) {
            return { atoms: [], bonds: [], targetAng: 0, valid: false, reason: 'valency' };
        }

        // 空いている方向を特定する。隣接が2つ以上（環の原子・接合原子など）では、
        // どちらか一方の環に偏らないよう「最も広い空き角の二等分線」を使う（P9-8）。
        // 単純な鎖の原子（隣接0〜1）では手描きの直交作図を保つため90°単位に丸める。
        const heavyNb = this.userMolecule.getNeighbors(baseAtom.id).filter(n => n.atom.element !== 'H');
        let preferred = 0;
        if (heavyNb.length >= 2) {
            preferred = this.largestGapDirection(baseAtom, heavyNb);
        } else if (heavyNb.length === 1) {
            const a = Math.atan2(heavyNb[0].atom.y - baseAtom.y, heavyNb[0].atom.x - baseAtom.x);
            preferred = Math.round((a + Math.PI) / (Math.PI / 2)) * (Math.PI / 2);
        }

        // 指定の向き・距離で官能基の原子/結合を組み立てる（-1=接続先の既存原子）
        const buildAt = (ang, reach) => {
            const dx = reach * Math.cos(ang), dy = reach * Math.sin(ang);
            const atoms = [], bonds = [];
            if (moduleType === 'oh') {
                atoms.push({ element: 'O', x: baseAtom.x + dx, y: baseAtom.y + dy });
                bonds.push({ from: -1, to: 0, type: 1 });
            } else if (moduleType === 'cooh') {
                const cx = baseAtom.x + dx, cy = baseAtom.y + dy;
                atoms.push({ element: 'C', x: cx, y: cy });
                bonds.push({ from: -1, to: 0, type: 1 });
                atoms.push({ element: 'O', x: cx + GRID_SIZE * Math.cos(ang + Math.PI / 2), y: cy + GRID_SIZE * Math.sin(ang + Math.PI / 2) });
                bonds.push({ from: 0, to: 1, type: 2 });
                atoms.push({ element: 'O', x: cx + GRID_SIZE * Math.cos(ang), y: cy + GRID_SIZE * Math.sin(ang) });
                bonds.push({ from: 0, to: 2, type: 1 });
            } else if (moduleType === 'nh2') {
                atoms.push({ element: 'N', x: baseAtom.x + dx, y: baseAtom.y + dy });
                bonds.push({ from: -1, to: 0, type: 1 });
            } else if (moduleType === 'no2') {
                const nx = baseAtom.x + dx, ny = baseAtom.y + dy;
                atoms.push({ element: 'N', x: nx, y: ny });
                bonds.push({ from: -1, to: 0, type: 1 });
                // ニトロ基は N(=O)(-O) で構築する（開発方針 4章-2。N(=O)(=O) は価標超過）
                atoms.push({ element: 'O', x: nx + GRID_SIZE * Math.cos(ang + Math.PI / 2), y: ny + GRID_SIZE * Math.sin(ang + Math.PI / 2) });
                bonds.push({ from: 0, to: 1, type: 2 });
                atoms.push({ element: 'O', x: nx + GRID_SIZE * Math.cos(ang - Math.PI / 2), y: ny + GRID_SIZE * Math.sin(ang - Math.PI / 2) });
                bonds.push({ from: 0, to: 2, type: 1 });
            } else if (moduleType === 'so3h') {
                // スルホ基 -SO₃H は S(=O)(=O)(-OH)。硫黄は6価として扱う（開発方針5章）
                const sx = baseAtom.x + dx, sy = baseAtom.y + dy;
                atoms.push({ element: 'S', x: sx, y: sy });
                bonds.push({ from: -1, to: 0, type: 1 });
                atoms.push({ element: 'O', x: sx + GRID_SIZE * Math.cos(ang + Math.PI / 2), y: sy + GRID_SIZE * Math.sin(ang + Math.PI / 2) });
                bonds.push({ from: 0, to: 1, type: 2 });
                atoms.push({ element: 'O', x: sx + GRID_SIZE * Math.cos(ang - Math.PI / 2), y: sy + GRID_SIZE * Math.sin(ang - Math.PI / 2) });
                bonds.push({ from: 0, to: 2, type: 2 });
                atoms.push({ element: 'O', x: sx + GRID_SIZE * Math.cos(ang), y: sy + GRID_SIZE * Math.sin(ang) });
                bonds.push({ from: 0, to: 3, type: 1 }); // -OH（Hは自動補完）
            }
            return { atoms, bonds };
        };

        const MIN_CLEARANCE = GRID_SIZE * 0.65;
        const clashes = (atoms) => atoms.some(p => this.userMolecule.atoms.some(a =>
            a.id !== baseAtom.id && a.element !== 'H' && Math.hypot(a.x - p.x, a.y - p.y) < MIN_CLEARANCE));

        // 好みの向きを先頭に、空いている直交4方向を候補にする。
        // 各方向で標準の結合長（1マス）→ 伸ばした結合長（2マス）の順に試し、
        // 環などで詰まっていても外側に伸ばして置けるようにする（P9-7）。
        const dirs = [preferred, preferred + Math.PI / 2, preferred - Math.PI / 2, preferred + Math.PI];
        for (const reach of [GRID_SIZE, GRID_SIZE * 2]) {
            for (const ang of dirs) {
                const plan = buildAt(ang, reach);
                if (!clashes(plan.atoms)) {
                    return { atoms: plan.atoms, bonds: plan.bonds, targetAng: ang, valid: true };
                }
            }
        }
        // どの向き・距離でも重なる場合は、好みの向きの標準位置を赤ゴーストとして返す
        const fallback = buildAt(preferred, GRID_SIZE);
        return { atoms: fallback.atoms, bonds: fallback.bonds, targetAng: preferred, valid: false, reason: 'overlap' };
    }

    // 不斉炭素マークモードのホバープレビュー（P9-7）。
    // マーク済みなら「外す」ことを示すグレー、未マークなら不斉炭素かどうかで色分けした破線リングと * を出す
    drawAsymmetricPreview(atom) {
        const NS = 'http://www.w3.org/2000/svg';
        const willUnmark = atom.isAsymmetricMarked;
        const isAsym = this.userMolecule.isAsymmetricCarbon(atom.id);
        // マーク追加時: 実際に不斉炭素ならオレンジ、そうでなければ赤（誤マークの警告）
        const color = willUnmark ? 'rgba(200,200,200,0.9)'
            : (isAsym ? 'var(--neon-orange, #ff9f43)' : 'rgba(255, 90, 90, 0.85)');
        const ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('cx', atom.x);
        ring.setAttribute('cy', atom.y);
        ring.setAttribute('r', '15');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', color);
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('stroke-dasharray', '4,3');
        this.uiGroup.appendChild(ring);
        const star = document.createElementNS(NS, 'text');
        star.setAttribute('x', atom.x + 7.5);
        star.setAttribute('y', atom.y - 4);
        star.setAttribute('text-anchor', 'middle');
        star.setAttribute('fill', color);
        star.style.fontSize = '13px';
        star.textContent = willUnmark ? '×' : '*';
        this.uiGroup.appendChild(star);
    }

    // ===== α/β 面マークモード（P12-7 M2b・環の立体をハース面として明示） =====

    // いずれかの環に属する原子IDの集合（chemistry.js の _ringAtomIds と同じ環判定：
    // ある結合を除いても両端が繋がっていれば環結合、その端点が環原子）。
    // ハース環（酸素をちょうど1個含む5〜7員環＝糖の環）の「手前側」の環結合キー集合を返す。
    // 教科書のハース投影は手前の辺を太く描く慣習があるため、それを再現する（P12-7 M2c 仕上げ）。
    // ※判定は座標のみを見る**表示専用**の処理。同一判定・検証・立体コードには一切影響しない。
    //   全炭素環（ベンゼン・シクロヘキサン）は酸素を含まないので対象外＝従来どおりの太さ。
    _haworthFrontBondKeys() {
        const mol = this.userMolecule;
        const ring = this._ringAtomIdSet();
        if (ring.size === 0) return new Set();
        const keys = new Set();
        const seen = new Set();
        ring.forEach(startId => {
            if (seen.has(startId)) return;
            // 環原子だけの部分グラフの連結成分＝ひとつの環（縮環は1成分にまとまるが員数条件で除外される）
            const comp = new Set([startId]);
            const stack = [startId];
            seen.add(startId);
            while (stack.length) {
                const id = stack.pop();
                mol.getNeighbors(id).forEach(n => {
                    if (ring.has(n.atom.id) && !seen.has(n.atom.id)) {
                        seen.add(n.atom.id);
                        comp.add(n.atom.id);
                        stack.push(n.atom.id);
                    }
                });
            }
            const atoms = [...comp].map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
            if (atoms.length < 5 || atoms.length > 7) return;                       // 糖の環のみ
            if (atoms.filter(a => a.element === 'O').length !== 1) return;          // 環内酸素ちょうど1個
            const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
            mol.bonds.forEach(b => {
                if (!comp.has(b.atomId1) || !comp.has(b.atomId2)) return;
                const a1 = mol.atoms.find(a => a.id === b.atomId1);
                const a2 = mol.atoms.find(a => a.id === b.atomId2);
                if (!a1 || !a2) return;
                // 両端が環の中心より手前（画面下側）＝手前の辺
                if (a1.y >= cy - 1 && a2.y >= cy - 1) keys.add(`${b.atomId1}_${b.atomId2}`);
            });
        });
        return keys;
    }

    _ringAtomIdSet() {
        const mol = this.userMolecule;
        const inRing = new Set();
        mol.bonds.forEach(bond => {
            const visited = new Set([bond.atomId1]);
            const stack = [bond.atomId1];
            while (stack.length) {
                const id = stack.pop();
                mol.bonds.forEach(bd => {
                    if (bd === bond) return;
                    let other = bd.atomId1 === id ? bd.atomId2 : bd.atomId2 === id ? bd.atomId1 : null;
                    if (other != null && !visited.has(other)) { visited.add(other); stack.push(other); }
                });
            }
            if (visited.has(bond.atomId2)) { inRing.add(bond.atomId1); inRing.add(bond.atomId2); }
        });
        return inRing;
    }

    // 面マークの対象か：環に属する炭素に単結合で付く、環に属さない重原子（-OH の O、-CH2OH の C 等）。
    _isHaworthFaceTarget(atom, ringSet = null) {
        if (!atom || atom.element === 'H') return false;
        const ring = ringSet || this._ringAtomIdSet();
        if (ring.has(atom.id)) return false; // 環内原子は対象外
        return this.userMolecule.getNeighbors(atom.id).some(n =>
            n.type === 1 && n.atom.element === 'C' && ring.has(n.atom.id));
    }

    // 面マーク対象のホバープレビュー。現在の面（未設定/上/下）に応じて色と記号を出す。
    drawHaworthPreview(atom) {
        const NS = 'http://www.w3.org/2000/svg';
        const face = atom.haworthFace;
        // 次にトグルされる面（未設定・下→上、上→下）を予告する
        const next = (face === 1) ? -1 : 1;
        const color = next === 1 ? 'var(--neon-orange, #ff9f43)' : 'rgba(120, 190, 255, 0.95)';
        const ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('cx', atom.x);
        ring.setAttribute('cy', atom.y);
        ring.setAttribute('r', '14');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', color);
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('stroke-dasharray', '4,3');
        this.uiGroup.appendChild(ring);
        const glyph = document.createElementNS(NS, 'text');
        glyph.setAttribute('x', atom.x + 11);
        glyph.setAttribute('y', atom.y - 8);
        glyph.setAttribute('text-anchor', 'middle');
        glyph.setAttribute('fill', color);
        glyph.style.fontSize = '12px';
        glyph.textContent = next === 1 ? '▲' : '▼';
        this.uiGroup.appendChild(glyph);
    }

    // ===== シス/トランス整形モード（P12-7 先行・化学モデル非依存の作図支援） =====
    // C=C（非環・両端C）まわりの置換基を ±120° の教科書レイアウトへ整える。現在描かれて
    // いる側（外積の符号。getDoubleBondGeometry と同じ規約）を保存して cis/trans の意図を
    // 変えない。同じ結合を再タップすると、タップ位置に近い側の炭素の置換基だけを C=C 軸に
    // 対して鏡映し、反対側の炭素は動かさずに cis⇄trans を反転する。座標のみを動かす。

    // タップ点直下の「整形可能な C=C」を探す。C=C の中点は原子半径(28px)に潜るため、
    // 直下の炭素に接続する C=C も候補にする。対象外の結合を触ったかを区別できるよう
    // { bond, eligible } を返す（bond=null は結合に触れていない）。
    reshapeBondUnderPoint(rawX, rawY) {
        const mol = this.userMolecule;
        const eligible = (b) => !!b && b.type === 2 && this._isNonRingCC(b);
        const atom = this.findAtomAt(rawX, rawY);
        if (atom && atom.element === 'C') {
            const doubles = mol.getBondsForAtom(atom.id).filter(b => b.type === 2);
            const good = doubles.find(eligible);
            if (good) return { bond: good, eligible: true };
            if (doubles.length) return { bond: doubles[0], eligible: false };
        }
        const nearBond = this.findBondAt(rawX, rawY, 14);
        if (nearBond) return { bond: nearBond, eligible: eligible(nearBond) };
        return { bond: null, eligible: false };
    }

    // 両端が C で環に含まれない結合か（環判定は getDoubleBondGeometry と同じBFS規約）
    _isNonRingCC(bond) {
        const mol = this.userMolecule;
        const a = mol.atoms.find(x => x.id === bond.atomId1);
        const b = mol.atoms.find(x => x.id === bond.atomId2);
        if (!a || !b || a.element !== 'C' || b.element !== 'C') return false;
        const visited = new Set([bond.atomId1]);
        const stack = [bond.atomId1];
        while (stack.length) {
            const id = stack.pop();
            mol.bonds.forEach(bd => {
                if (bd === bond) return;
                let other = null;
                if (bd.atomId1 === id) other = bd.atomId2;
                else if (bd.atomId2 === id) other = bd.atomId1;
                if (other && !visited.has(other)) { visited.add(other); stack.push(other); }
            });
        }
        return !visited.has(bond.atomId2); // 結合を除いても繋がっていれば環内 → 非対象
    }

    // ある sp2 炭素の置換基（重原子・相手炭素とH以外）
    _vinylSubs(carbon, otherCarbon) {
        return this.userMolecule.getNeighbors(carbon.id)
            .filter(n => n.atom.id !== otherCarbon.id && n.atom.element !== 'H')
            .map(n => n.atom);
    }

    /**
     * 名称から呼び出した分子の C=C まわりを ±120° に整える（C-4。2026-08-01 ユーザー要望
     * 「直交（90°）ではなく 120° にしたい」）。
     *
     * **手で作図するときの直交は今までどおり**（DEVELOPMENT.md の「直交作図は意図された仕様」）。
     * 例外にするのは**呼び出した分子の、環に含まれない C=C のまわりだけ**。マレイン酸のように
     * 置換基が真上に立つ図は四角く見えて、二重結合の平面らしさが伝わらないため。
     *
     * 整形は整形モードのタップと同じ `reshapeDoubleBond`（現在の側＝cis/trans を保つ）を使う。
     * 当てたあと次のどれかに当たったら**座標を元に戻す**:
     *
     * 1. **座標から読める C=C の幾何が変わった**。図から立体を読む以上、整形が E/Z を
     *    書き換えてはいけない。とくに「2-ブテン」「ブテン二酸」のように**わざと
     *    シス/トランス未確定で登録してある分子**は、整形すると trans 既定で確定してしまい、
     *    名称チップが「トランス-2-ブテン」に変わる。未確定を確定させるのは
     *    整形モードのタップ（ユーザーの明示操作）の仕事で、呼び出しがやることではない
     * 2. **結合が別の重原子を貫通した**（メタクリル酸メチルで実際に起きた）。
     *    120°に開いた枝が別の枝の上に乗ると、かえって読めない図になる
     * 3. **重原子どうしが MIN_CLEARANCE より近づいた**（アクリル酸で実際に起きた。v434）。
     *    貫通しなくても、枝が 30°（＝直交作図と 120° の差）ずれるだけで
     *    2×GRID_SIZE×sin15° ＝ 21.7px まで詰まる。アクリル酸では -COOH の枝ごと 30° 回り、
     *    カルボニルの O がビニル炭素の 21.7px 隣に来ていた
     *    （夜間監査 v365 の「原子の重なり C-O 21.7px」33件の正体）。
     *    枝は剛体で動くので分子の中では貫通せず、1・2 のどちらにも掛からなかった
     */
    reshapeVinylAngles(atomIds) {
        const mol = this.userMolecule;
        const ids = new Set(atomIds);
        const targets = mol.bonds.filter(b =>
            b.type === 2 && ids.has(b.atomId1) && ids.has(b.atomId2) && this._isNonRingCC(b));
        if (!targets.length) return;
        const MIN_CLEARANCE = GRID_SIZE * 0.65;
        const geoOf = () => (typeof readBondGeoFromCoords === 'function'
            ? JSON.stringify(readBondGeoFromCoords(mol)) : '');
        targets.forEach(bond => {
            const cA = mol.atoms.find(x => x.id === bond.atomId1);
            const cB = mol.atoms.find(x => x.id === bond.atomId2);
            const subsA = this._vinylSubs(cA, cB);
            const subsB = this._vinylSubs(cB, cA);
            if (!subsA.length && !subsB.length) return;
            const before = geoOf();
            const gapBefore = this._minHeavyGap(ids);
            const saved = mol.atoms.map(a => ({ a, x: a.x, y: a.y }));
            this.reshapeDoubleBond(bond, subsA, subsB);
            const gapAfter = this._minHeavyGap(ids);
            // 元から詰まっていた図はそのまま通す。**整形で詰めた**ときだけ戻す
            const squeezed = gapAfter < MIN_CLEARANCE && gapAfter < gapBefore - 1e-6;
            if (geoOf() !== before || this._hasBondThroughAtom(ids) || squeezed) {
                saved.forEach(s => { s.a.x = s.x; s.a.y = s.y; });
            }
        });
    }

    /**
     * 動かす原子（ids）の重原子と、キャンバス上の全重原子との最短距離。
     * 相手側を ids に絞らないのは、整形が**先に置いてある別の分子**へ枝を寄せることもあるため
     * （呼び出しの配置は GRID_SIZE の間隔を空けるが、そのあとの整形はそれを知らない）。
     */
    _minHeavyGap(ids) {
        const heavy = this.userMolecule.atoms.filter(a => a.element !== 'H');
        let min = Infinity;
        heavy.forEach(a => {
            if (!ids.has(a.id)) return;
            heavy.forEach(b => {
                if (b.id === a.id) return;
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < min) min = d;
            });
        });
        return min;
    }

    // その分子の中で、結合線が別の重原子の上を通っていないか（作図が読めなくなる形の検出）
    _hasBondThroughAtom(ids) {
        const mol = this.userMolecule;
        const heavy = mol.atoms.filter(a => a.element !== 'H' && ids.has(a.id));
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        return mol.bonds.some(b => {
            const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
            if (!p || !q || !ids.has(p.id) || !ids.has(q.id)) return false;
            const L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
            if (!L2) return false;
            return heavy.some(a => {
                if (a.id === p.id || a.id === q.id) return false;
                const t = ((a.x - p.x) * (q.x - p.x) + (a.y - p.y) * (q.y - p.y)) / L2;
                if (t <= 0.02 || t >= 0.98) return false;
                return Math.hypot(a.x - (p.x + t * (q.x - p.x)), a.y - (p.y + t * (q.y - p.y))) < 16;
            });
        });
    }

    // 整形モードでのタップ処理。初回タップ＝±120°整形、同じ結合の再タップ＝cis⇄trans反転。
    handleReshapeTap(coords) {
        const hit = this.reshapeBondUnderPoint(coords.rawX, coords.rawY);
        if (!hit.bond) { this._reshapeLastBond = null; return; }
        if (!hit.eligible) {
            this.showToast('整形できるのは環に含まれない C=C 二重結合だけです。');
            return;
        }
        const bond = hit.bond;
        const key = [bond.atomId1, bond.atomId2].sort().join('_');
        const isFlip = (this._reshapeLastBond === key);
        const mol = this.userMolecule;
        const cA = mol.atoms.find(x => x.id === bond.atomId1);
        const cB = mol.atoms.find(x => x.id === bond.atomId2);
        const subsA = this._vinylSubs(cA, cB);
        const subsB = this._vinylSubs(cB, cA);
        // 無置換（エテン等）は動かすものがないので無反応（キーだけ更新）
        if (subsA.length === 0 && subsB.length === 0) { this._reshapeLastBond = key; return; }
        this.saveState();
        if (isFlip) this.flipCisTrans(bond, coords);
        else this.reshapeDoubleBond(bond, subsA, subsB);
        this._reshapeLastBond = key;
        this.updateDrawing();
    }

    // C=C 両端の置換基を軸から ±120° に再配置する。各結合の現在の長さは維持し、
    // 現在の側（外積の符号）を保存。2置換（各端1本）で側が不定なら trans 既定で展開。
    reshapeDoubleBond(bond, subsA, subsB) {
        const mol = this.userMolecule;
        let cA = mol.atoms.find(x => x.id === bond.atomId1);
        let cB = mol.atoms.find(x => x.id === bond.atomId2);
        // **軸の向きは座標で決める**（DEVELOPMENT.md「順序が要る所は必ず座標で決める」）。
        // 原子IDは乱数で Bond が端点をIDで正規化するため、bond.atomId1 がどちらの炭素かは
        // 呼び出しのたびに変わる。下の「側（+1/-1）」は軸 (ax,ay) の向きで符号が反転するので、
        // 軸が揺れると**側が不定（rawSide=0）な置換基に当てる ±1 の意味が裏返り**、
        // 同じ分子を呼び出しても置換基が上に付いたり下に付いたりした
        // （イソプレンで実測。鎖の座標が毎回変わり、加硫の架橋が3本つながらず2本で止まる
        //   ＝ RX13 が約10%落ちる原因。v377）
        if (cB.x < cA.x || (cB.x === cA.x && cB.y < cA.y)) {
            [cA, cB] = [cB, cA];
            [subsA, subsB] = [subsB, subsA];
        }
        const ax = cB.x - cA.x, ay = cB.y - cA.y;
        const L = Math.hypot(ax, ay) || 1;
        const ux = ax / L, uy = ay / L;
        const rot = (vx, vy, deg) => {
            const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
            return { x: vx * c - vy * s, y: vx * s + vy * c };
        };
        // 軸(ax,ay)に対する向き/点の側（+1/-1、ほぼ直線は0）
        const sideOfDir = (dx, dy) => {
            const cr = ax * dy - ay * dx;
            return Math.abs(cr) < 1e-9 ? 0 : Math.sign(cr);
        };
        const rawSide = (atom, carbon) => {
            const sx = atom.x - carbon.x, sy = atom.y - carbon.y;
            const cross = ax * sy - ay * sx;
            const norm = cross / (L * (Math.hypot(sx, sy) || 1));
            if (Math.abs(norm) < 0.1) return 0; // sin約6度未満 → 側が不定
            return Math.sign(cross);
        };
        // 2置換（各端1本ずつ）のときだけ、不定側を trans 既定で補完する
        const forced = {};
        if (subsA.length === 1 && subsB.length === 1) {
            let sA = rawSide(subsA[0], cA), sB = rawSide(subsB[0], cB);
            if (sA === 0 && sB === 0) { sA = 1; sB = -1; }
            else if (sA === 0) sA = -sB;
            else if (sB === 0) sB = -sA;
            forced[subsA[0].id] = sA;
            forced[subsB[0].id] = sB;
        }
        const place = (carbon, subs, dirUx, dirUy) => {
            const dP = rot(dirUx, dirUy, 120), dM = rot(dirUx, dirUy, -120);
            const sP = sideOfDir(dP.x, dP.y); // dP の側（+1/-1）
            let usedP = false, usedM = false;
            subs.forEach(sub => {
                const len = Math.hypot(sub.x - carbon.x, sub.y - carbon.y) || GRID_SIZE;
                let want = (forced[sub.id] !== undefined) ? forced[sub.id] : rawSide(sub, carbon);
                if (want === 0) want = usedP ? -1 : 1;
                const wantsPlus = (want === sP);
                let dir;
                if (wantsPlus && !usedP) { dir = dP; usedP = true; }
                else if (!wantsPlus && !usedM) { dir = dM; usedM = true; }
                else if (!usedP) { dir = dP; usedP = true; }
                else { dir = dM; usedM = true; }
                const nx = carbon.x + dir.x * len;
                const ny = carbon.y + dir.y * len;
                this._moveSubtree(sub, [cA.id, cB.id], nx - sub.x, ny - sub.y);
            });
        };
        place(cA, subsA, ux, uy);
        place(cB, subsB, -ux, -uy);
    }

    // タップ位置に近い側の炭素の置換基部分木だけを C=C 軸に対して鏡映（cis⇄trans反転）
    flipCisTrans(bond, coords) {
        const mol = this.userMolecule;
        const cA = mol.atoms.find(x => x.id === bond.atomId1);
        const cB = mol.atoms.find(x => x.id === bond.atomId2);
        const dA = Math.hypot(coords.rawX - cA.x, coords.rawY - cA.y);
        const dB = Math.hypot(coords.rawX - cB.x, coords.rawY - cB.y);
        const nearC = dA <= dB ? cA : cB;
        const farC = nearC === cA ? cB : cA;
        const ax = cB.x - cA.x, ay = cB.y - cA.y;
        const L = Math.hypot(ax, ay) || 1;
        const ux = ax / L, uy = ay / L;
        // near 側の原子集合（far 炭素で遮断し、C=C を越えない）
        const visited = new Set([farC.id, nearC.id]);
        const stack = [nearC.id];
        const ids = [];
        while (stack.length) {
            const id = stack.pop();
            ids.push(id);
            mol.getNeighbors(id).forEach(n => {
                if (!visited.has(n.atom.id)) { visited.add(n.atom.id); stack.push(n.atom.id); }
            });
        }
        ids.forEach(id => {
            const a = mol.atoms.find(x => x.id === id);
            if (!a) return;
            const wx = a.x - nearC.x, wy = a.y - nearC.y;
            const dot = wx * ux + wy * uy;
            const alongX = ux * dot, alongY = uy * dot;
            a.x = nearC.x + alongX - (wx - alongX);
            a.y = nearC.y + alongY - (wy - alongY);
        });
    }

    // root から到達できる原子（blockedIds を越えない）を dx,dy だけ剛体移動する
    _moveSubtree(root, blockedIds, dx, dy) {
        const mol = this.userMolecule;
        const visited = new Set(blockedIds);
        visited.add(root.id);
        const stack = [root.id];
        const ids = [];
        while (stack.length) {
            const id = stack.pop();
            ids.push(id);
            mol.getNeighbors(id).forEach(n => {
                if (!visited.has(n.atom.id)) { visited.add(n.atom.id); stack.push(n.atom.id); }
            });
        }
        ids.forEach(id => {
            const a = mol.atoms.find(x => x.id === id);
            if (a) { a.x += dx; a.y += dy; }
        });
    }

    // 整形モードのホバーで、整形可能な C=C をハイライト表示（P12-7）
    drawReshapePreview(bond) {
        const NS = 'http://www.w3.org/2000/svg';
        const mol = this.userMolecule;
        const a = mol.atoms.find(x => x.id === bond.atomId1);
        const b = mol.atoms.find(x => x.id === bond.atomId2);
        if (!a || !b) return;
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', a.x);
        line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x);
        line.setAttribute('y2', b.y);
        line.setAttribute('stroke', 'var(--neon-cyan, #00f2fe)');
        line.setAttribute('stroke-width', '7');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', '0.5');
        this.uiGroup.appendChild(line);
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', (a.x + b.x) / 2);
        t.setAttribute('y', (a.y + b.y) / 2 - 8);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', 'var(--neon-cyan, #00f2fe)');
        t.style.fontSize = '14px';
        t.textContent = '⇄';
        this.uiGroup.appendChild(t);
    }

    // 官能基モジュールのゴーストプレビュー（P7-9）
    drawFunctionalGroupGhost(plan, baseAtom) {
        const NS = 'http://www.w3.org/2000/svg';
        const color = plan.valid ? 'rgba(0, 242, 254, 0.75)' : 'rgba(255, 90, 90, 0.85)';
        const pos = (i) => (i === -1 ? baseAtom : plan.atoms[i]);
        plan.bonds.forEach(b => {
            const p = pos(b.from), q = pos(b.to);
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', p.x);
            line.setAttribute('y1', p.y);
            line.setAttribute('x2', q.x);
            line.setAttribute('y2', q.y);
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', b.type === 2 ? '4' : '2.5');
            line.setAttribute('stroke-dasharray', '5,4');
            this.uiGroup.appendChild(line);
        });
        plan.atoms.forEach(a => {
            const c = document.createElementNS(NS, 'circle');
            c.setAttribute('cx', a.x);
            c.setAttribute('cy', a.y);
            c.setAttribute('r', 9);
            c.setAttribute('fill', 'rgba(10, 14, 30, 0.7)');
            c.setAttribute('stroke', color);
            c.setAttribute('stroke-width', '2');
            this.uiGroup.appendChild(c);
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', a.x);
            t.setAttribute('y', a.y + 4);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('fill', color);
            t.style.fontSize = '12px';
            t.textContent = a.element;
            this.uiGroup.appendChild(t);
        });
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


    // 正解の例示（お手本）をレンダリングする。
    //
    // レビュー項目10: 以前は viewBox が `0 0 400 400` の固定で、図を中心へ平行移動するだけだった。
    // 大きい分子は枠からはみ出して**半分見えない**（ステアリン酸で 56 原子中 29 個が枠の外）。
    // いまは ①長い鎖を畳み ②図の大きさに合わせて viewBox を張り直し ③ピンチ／ホイール／
    // ドラッグで拡大できる。**どれも表示専用**で、`STAGES[].target` のデータには一切触らない
    // （判定 `verifyMolecule` は元の target のまま。TG1 でそれを検査に固定している）。
    //
    // @param resetView 見え方（拡大率・位置）を全体表示に戻すか。モーダルを開くときは true、
    //   畳み表示の切り替えなど**同じ分子を描き直すだけ**のときは false
    renderTargetAnswer(resetView = true) {
        this.targetBonds.innerHTML = '';
        this.targetAtoms.innerHTML = '';

        const stage = STAGES[this.currentStageIndex];
        const rawTarget = stage && stage.target;
        // 長く続く -CH₂- を (CH₂)ₙ に畳む（v432・quiz.js の共有部品。呼ぶだけで中身は変えない）。
        // 畳めない分子なら null で、今までどおり素のまま描く
        const foldable = (rawTarget && window.condenseChainForDisplay)
            ? window.condenseChainForDisplay(rawTarget) : null;
        this.targetView.condensable = !!foldable;

        // 素のままの図を先に組んで、**この画面で字が読める大きさに収まるか**を見る。
        // **お手本は正解構造そのもの**なので、読めるなら畳まない（炭素を1つずつ数えられる形で出す）。
        // ボタンで選び直したあとは、その選択を尊重する
        const plain = this.measureTargetFigure(() => this.createTargetFromData(stage));
        if (rawTarget && !this.targetView.condenseChosen) {
            this.targetView.condense = !!foldable && this.targetTextTooSmall(plain);
        }
        const condensed = this.targetView.condense ? foldable : null;

        const fig = condensed ? this.measureTargetFigure(() => this.createTargetFromData({ target: condensed })) : plain;
        const { mol: targetMol, heavyAtoms, hydrogens } = fig;
        if (heavyAtoms.length === 0) return;

        // 1. 結合の描画（座標はそのまま描き、枠合わせは viewBox が行う）
        // ① 水素の結合
        hydrogens.forEach(h => {
            const parent = targetMol.atoms.find(a => a.id === h.parentId);
            if (parent) {
                this.renderTargetBond(parent.x, parent.y, h.x, h.y, 1, true);
            }
        });

        // ② 重原子間の結合
        targetMol.bonds.forEach(bond => {
            const a1 = targetMol.atoms.find(a => a.id === bond.atomId1);
            const a2 = targetMol.atoms.find(a => a.id === bond.atomId2);
            if (a1 && a2 && a1.element !== 'H' && a2.element !== 'H') {
                this.renderTargetBond(a1.x, a1.y, a2.x, a2.y, bond.type, false);
            }
        });

        // 2. 原子の描画
        // ① 水素
        hydrogens.forEach(h => {
            this.renderTargetAtom(h.element, h.x, h.y);
        });

        // ② 重原子
        heavyAtoms.forEach(a => {
            this.renderTargetAtom(a.element, a.x, a.y);
        });

        // ③ 畳んだ鎖の「(CH₂)ₙ」を、結合線の上に台紙つきで置く
        if (condensed) {
            (condensed.labels || []).forEach(l => this.renderTargetChainLabel(l.x, l.y, l.text));
        }

        // 3. 図に合わせて viewBox を張り直す
        this.fitTargetView(fig, resetView);
        this.syncTargetViewUI(!!condensed);
    }

    // お手本に出す分子を組み、水素も含めた広がりを測る（描画はまだしない）
    measureTargetFigure(build) {
        const mol = build();
        const heavyAtoms = mol.atoms.filter(a => a.element !== 'H');
        const hydrogens = mol.calculateHydrogens();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        [...heavyAtoms, ...hydrogens].forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
        return { mol, heavyAtoms, hydrogens, minX, minY, maxX, maxY };
    }

    // この画面で描いたとき、原子の字（9px）が小さくなりすぎる図か。
    // 枠の大きさは index.html の #target-svg-wrapper のインラインスタイルと対で決めている
    // （max-width:420px / max-height:min(55vh,420px)・.modal-content は 94vw ＋ padding 18px）。
    // **片方を変えたらもう片方も直すこと**。モーダルは描画時点ではまだ hidden なので、
    // 実測（getBoundingClientRect）は 0 になる ＝ 画面の寸法から見積もる
    targetTextTooSmall(fig) {
        const box = this.targetBoxSize(fig);
        return 9 * box.scale < 7.2;
    }

    // 図の広がりから、枠の大きさと図の縮尺を見積もる
    targetBoxSize(fig) {
        const frame = this.targetFrame(fig);
        const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
        const boxW = Math.min(420, Math.max(200, vw * 0.94 - 36));
        const boxH = Math.min(boxW / frame.ratio, 0.55 * vh, 420);
        return { boxW, boxH, scale: Math.min(boxW / frame.w, boxH / frame.h) };
    }

    // 畳んだ鎖のラベル「(CH₂)ₙ」を1つ描く（結合線と重なって読めなくならないよう台紙を敷く）
    /**
     * `(CH₂)ₙ` のラベルを1枚置く。**お手本モーダルとキャンバスで共用する**（項目25）。
     * 置き場所が違うだけなので `parent` を引数にした（既定はお手本の層）。
     * レーンI の申し送り「この十数行が quiz.js と game.js に二重にある」への一部回答:
     * game.js 側の2か所（お手本・キャンバス）はこれで1つになる。
     */
    renderTargetChainLabel(x, y, text, parent) {
        const layer = parent || this.targetAtoms;
        const NS = 'http://www.w3.org/2000/svg';
        const box = document.createElementNS(NS, 'rect');
        box.setAttribute('x', x - 30);
        box.setAttribute('y', y - 11);
        box.setAttribute('width', 60);
        box.setAttribute('height', 22);
        box.setAttribute('rx', 5);
        box.setAttribute('fill', 'rgba(15,20,28,0.95)');
        box.setAttribute('stroke', 'rgba(255,255,255,0.25)');
        this.targetAtoms.appendChild(box);
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', x);
        t.setAttribute('y', y + 5);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'chain-condensed');
        t.textContent = text;
        layer.appendChild(t);
    }

    // お手本の「全体が入る枠」（viewBox の元になる矩形）と、枠の縦横比を図から決める
    targetFrame(fig) {
        // 原子の丸は半径10なので、22 あれば丸の外にまだ余白が残る
        const pad = 22;
        let x = fig.minX - pad, y = fig.minY - pad;
        let w = (fig.maxX - fig.minX) + pad * 2, h = (fig.maxY - fig.minY) + pad * 2;
        // 小さい分子（メタン等）が大写しになりすぎないための下限。作図の刻みは 42px なので
        // 240 は「原子が横に5〜6個」ぶんにあたる
        const MIN = 240;
        if (w < MIN) { x -= (MIN - w) / 2; w = MIN; }
        if (h < MIN) { y -= (MIN - h) / 2; h = MIN; }
        // 枠の縦横比も図に合わせる（横長の分子で縦が余ると、そのぶん図が小さく描かれる）。
        // 極端な比は枠が細くなりすぎるので 0.75〜2.2 に収める
        return { x, y, w, h, ratio: Math.min(2.2, Math.max(0.75, w / h)) };
    }

    // 図に合わせて枠と viewBox を張り直す（レビュー項目10）
    fitTargetView(fig, resetView) {
        const f = this.targetFrame(fig);
        this.targetView.base = { x: f.x, y: f.y, w: f.w, h: f.h };
        if (resetView || !isFinite(this.targetView.cx)) {
            this.targetView.zoom = 1;
            this.targetView.cx = f.x + f.w / 2;
            this.targetView.cy = f.y + f.h / 2;
        }
        if (this.targetSvgWrapper) {
            this.targetSvgWrapper.style.aspectRatio = `${f.ratio.toFixed(3)} / 1`;
        }
        this.applyTargetView();
    }

    // いまの拡大率・中心から viewBox を作る。中心は「全体の枠」の中に留める（図を見失わないため）
    applyTargetView() {
        const v = this.targetView;
        const b = v.base;
        if (!b || !this.targetSvg) return;
        v.zoom = Math.min(6, Math.max(1, v.zoom));
        const w = b.w / v.zoom, h = b.h / v.zoom;
        const clamp = (c, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(c, lo), hi));
        v.cx = clamp(v.cx, b.x + w / 2, b.x + b.w - w / 2);
        v.cy = clamp(v.cy, b.y + h / 2, b.y + b.h - h / 2);
        this.targetSvg.setAttribute('viewBox', `${v.cx - w / 2} ${v.cy - h / 2} ${w} ${h}`);
        const label = document.getElementById('target-zoom-label');
        if (label) label.textContent = `${Math.round(v.zoom * 100)}%`;
        if (this.targetSvgWrapper) {
            this.targetSvgWrapper.style.cursor = v.zoom > 1 ? 'grab' : 'default';
        }
    }

    // 畳み表示まわりの見出し・ボタンを、いまの状態に合わせる
    syncTargetViewUI(isCondensed) {
        const note = document.getElementById('target-condense-note');
        if (note) note.classList.toggle('hidden', !isCondensed);
        const btn = document.getElementById('btn-target-condense');
        if (btn) {
            btn.classList.toggle('hidden', !this.targetView.condensable);
            btn.textContent = isCondensed ? '⛓ 鎖を伸ばす' : '⛓ 鎖を畳む';
        }
    }

    // お手本の拡大操作（ピンチ・ホイール・ドラッグ・ダブルタップ・ボタン）を繋ぐ。
    // 座標の変換は getScreenCTM() で行う（viewBox 比の手計算は禁止。CLAUDE.md）
    setupTargetZoom() {
        const wrap = this.targetSvgWrapper;
        if (!wrap || wrap.dataset.zoomReady) return;
        wrap.dataset.zoomReady = '1';

        const toSvg = (clientX, clientY) => {
            const ctm = this.targetSvg.getScreenCTM();
            if (!ctm) return null;
            const p = this.targetSvg.createSVGPoint();
            p.x = clientX; p.y = clientY;
            return p.matrixTransform(ctm.inverse());
        };

        // 指（カーソル）が触れている点が動かないように拡大する
        const zoomAt = (factor, clientX, clientY) => {
            const v = this.targetView;
            const before = toSvg(clientX, clientY);
            const next = Math.min(6, Math.max(1, v.zoom * factor));
            if (next === v.zoom) return;
            v.zoom = next;
            this.applyTargetView();
            const after = toSvg(clientX, clientY);
            if (before && after) {
                v.cx += before.x - after.x;
                v.cy += before.y - after.y;
                this.applyTargetView();
            }
        };
        this.zoomTargetAt = zoomAt;

        // 枠の中心を基準に拡大する（ボタン用）
        const zoomCenter = factor => {
            const r = wrap.getBoundingClientRect();
            zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
        };
        this.zoomTargetBy = zoomCenter;

        wrap.addEventListener('wheel', e => {
            if (!this.targetView.base) return;
            e.preventDefault();
            zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
        }, { passive: false });

        const pointers = new Map();
        let pinchDist = 0, last = null, moved = 0, lastTapAt = 0;

        wrap.addEventListener('pointerdown', e => {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 1) { last = { x: e.clientX, y: e.clientY }; moved = 0; }
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
            }
            // 枠の外まで指が出てもドラッグを追い続ける。**捕まえられなくても致命的ではない**ので
            // 例外は握りつぶす（生きていないポインタIDだと投げる。アプリはJSエラーを画面に出すため）
            try { if (wrap.setPointerCapture) wrap.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        });

        wrap.addEventListener('pointermove', e => {
            if (!pointers.has(e.pointerId) || !this.targetView.base) return;
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinchDist > 0 && d > 0) {
                    zoomAt(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
                }
                pinchDist = d;
                moved = 999;
                return;
            }
            if (!last) return;
            moved += Math.hypot(e.clientX - last.x, e.clientY - last.y);
            if (this.targetView.zoom > 1) {
                // 掴んだ点が指について来るように、SVG座標での移動量ぶん中心をずらす
                const from = toSvg(last.x, last.y);
                const to = toSvg(e.clientX, e.clientY);
                if (from && to) {
                    this.targetView.cx -= to.x - from.x;
                    this.targetView.cy -= to.y - from.y;
                    this.applyTargetView();
                }
                wrap.style.cursor = 'grabbing';
            }
            last = { x: e.clientX, y: e.clientY };
        });

        const endPointer = e => {
            const wasSingle = pointers.size === 1;
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinchDist = 0;
            if (pointers.size === 0) {
                if (this.targetView.zoom > 1) wrap.style.cursor = 'grab';
                // ダブルタップ／ダブルクリックで拡大（すでに拡大していれば全体へ戻す）
                if (wasSingle && moved < 8 && e.type === 'pointerup') {
                    const now = performance.now();
                    if (now - lastTapAt < 320) {
                        lastTapAt = 0;
                        if (this.targetView.zoom > 1) this.resetTargetView();
                        else zoomAt(2.5, e.clientX, e.clientY);
                    } else {
                        lastTapAt = now;
                    }
                }
                last = null;
            }
        };
        wrap.addEventListener('pointerup', endPointer);
        wrap.addEventListener('pointercancel', endPointer);
        // ダブルタップの2回目でテキスト選択やページズームが走らないように
        wrap.addEventListener('dblclick', e => e.preventDefault());

        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        on('btn-target-zoom-in', () => zoomCenter(1.5));
        on('btn-target-zoom-out', () => zoomCenter(1 / 1.5));
        on('btn-target-zoom-reset', () => this.resetTargetView());
        on('btn-target-condense', () => {
            this.targetView.condense = !this.targetView.condense;
            this.targetView.condenseChosen = true; // 以後この分子では自動判定に戻さない
            this.renderTargetAnswer(true);
        });
    }

    // 拡大をやめて全体表示に戻す
    resetTargetView() {
        const b = this.targetView.base;
        if (!b) return;
        this.targetView.zoom = 1;
        this.targetView.cx = b.x + b.w / 2;
        this.targetView.cy = b.y + b.h / 2;
        this.applyTargetView();
    }

    // 原子1個をミニ描画する（出力先グループを指定可能。既定はお手本モーダル。クイズ等からも流用）
    renderTargetAtom(element, x, y, targetGroup = this.targetAtoms) {
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
        targetGroup.appendChild(group);
    }

    // 結合1本をミニ描画する（出力先グループを指定可能。既定はお手本モーダル。クイズ等からも流用）
    renderTargetBond(x1, y1, x2, y2, type, isHConnection = false, targetGroup = this.targetBonds) {
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
            targetGroup.appendChild(line);
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

            targetGroup.appendChild(line1);
            targetGroup.appendChild(line2);
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
                targetGroup.appendChild(line);
            });
        }
    }

    // SVG描画の更新
    updateDrawing() {
        this.atomsGroup.innerHTML = '';
        this.bondsGroup.innerHTML = '';

        // 官能基の縮約表示（P9-2）: 対象の原子・結合を隠し、1枚のカードとしてまとめて描く。
        // 作図データ自体は変えない（表示だけの切替なので、判定・反応・エクスポートに影響しない）
        const condensed = this.condensedMode ? findCondensableGroups(this.userMolecule) : [];
        const hidden = new Set();
        condensed.forEach(g => g.memberIds.forEach(id => hidden.add(id)));

        // 長い -CH₂- の並びも同じトグルで畳む（項目25・第2段。DESIGN_chain_condense.md）。
        // **新しいボタンは足さない** ——「🔤 官能基をまとめる」は既に「表示だけを畳む」
        // トグルで、油脂を読むときに畳みたいのは官能基と鎖の両方だから。入口も増えない。
        //
        // **クイズの図（第1段）と違い、原子は動かさない。** あちらは畳んだぶん向こう側を
        // 手前へ寄せて幅を縮めるが、キャンバスでは**そこにある原子をタップして編集する**ので、
        // 動かすと当たり判定がずれる。ここは「隠してラベルを1枚置く」だけにする
        // （ステアリン酸なら重原子16個とその結合が消えるので、寄せなくても十分に読みやすくなる）。
        const chainLabels = [];
        if (this.condensedMode && typeof findCondensableChainRuns === 'function') {
            const idx = new Map(this.userMolecule.atoms.map((a, i) => [a.id, i]));
            const view = {
                atoms: this.userMolecule.atoms,
                bonds: this.userMolecule.bonds
                    .filter(b => idx.has(b.atomId1) && idx.has(b.atomId2))
                    .map(b => ({ atom1Index: idx.get(b.atomId1), atom2Index: idx.get(b.atomId2), type: b.type }))
            };
            findCondensableChainRuns(view).forEach(({ run, a, b }) => {
                // 官能基カードと取り合いにならないよう、既に隠れている原子を含む鎖は畳まない
                if (run.some(i => hidden.has(this.userMolecule.atoms[i].id))) return;
                run.forEach(i => hidden.add(this.userMolecule.atoms[i].id));
                const pa = this.userMolecule.atoms[a], pb = this.userMolecule.atoms[b];
                const sub = String(run.length).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
                chainLabels.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, text: `(CH₂)${sub}` });
            });
        }

        // 自動補完水素(H)の計算（隠した原子のHは描かない）
        const hydrogens = this.userMolecule.calculateHydrogens().filter(h => !hidden.has(h.parentId));

        // 1. 水素(H)の結合線のみを最背面に描画（太い重原子間結合の下を通す）
        hydrogens.forEach(h => {
            const parent = this.userMolecule.atoms.find(a => a.id === h.parentId);
            if (parent) {
                this.renderBond(parent.x, parent.y, h.x, h.y, 1, true); // 水素の結合は常に単結合
            }
        });

        // 2. 重原子間の結合線を描画（ハース環の手前側は太く＝教科書の慣習。表示専用）
        const frontKeys = this._haworthFrontBondKeys();
        this.userMolecule.bonds.forEach(bond => {
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (!a1 || !a2) return;
            if (hidden.has(a1.id) || hidden.has(a2.id)) return;

            const isFront = frontKeys.has(`${bond.atomId1}_${bond.atomId2}`);
            this.renderBond(a1.x, a1.y, a2.x, a2.y, bond.type, false, bond, isFront);
        });

        // 3. 水素原子(H)自体の描画
        hydrogens.forEach(h => {
            this.renderAtom(h.id, h.element, h.x, h.y, false);
        });

        // 4. 重原子の描画 (一番手前に描くため最後に行う)
        this.userMolecule.atoms.forEach(atom => {
            if (hidden.has(atom.id)) return;
            this.renderAtom(atom.id, atom.element, atom.x, atom.y, atom.isLocked, atom.isAsymmetricMarked, atom.haworthFace);
        });

        // 4.5 縮約カードの描画（P9-2）
        condensed.forEach(g => this.renderGroupCard(g, hidden));

        // 4.5b 畳んだ -CH₂- の並び（項目25・第2段）。両端を1本の線でつなぎ、
        // 中点に `(CH₂)ₙ` を置く。結合線は隠した原子ぶん消えているので、ここで引き直す
        chainLabels.forEach(l => {
            this.renderBond(l.ax, l.ay, l.bx, l.by, 1, false);
            this.renderTargetChainLabel((l.ax + l.bx) / 2, (l.ay + l.by) / 2, l.text, this.atomsGroup);
        });

        // 4.5. 分子が2つ以上あるときは、図の下に①②③と名前を出す（P12-8。ユーザー要望）
        this.renderMoleculeLabels(hidden);
        // 4.6. 分析対象の分子を琥珀の枠で囲う（レビュー項目9）。ホバーで消える uiGroup ではなく
        // 作図と同じ層に描き、更新のたびに描き直す
        this.renderFocusFrame(hidden);
        // 4.7. 反応させる分子の選択枠（レビュー項目15）。ここも uiGroup には描かない——
        // 以前は uiGroup にあったため、**カーソルを動かしただけで枠が消えていた**
        // （プレビュー描画が uiGroup を丸ごと消すため）。油脂のように同じ反応を
        // 何回も繰り返す間ずっと出ていてほしいので、作図と同じ層へ移した
        this.renderSelectionFrames(hidden);
        // 5. 化合物名・分子式のライブ表示を更新（P7-6）
        this.updateCompoundInfo();
        // 6. 「この分子の反応」カードの分類表示を更新（P9-1 M1）
        this.updateReactionCard();
        // 7. 異性体練習の「描きながら名称表示」モードのライブ更新（P12-1 調整）
        if (window.isomerPractice && window.isomerPractice.active) window.isomerPractice.onDrawingChange();
    }

    // 分子が2つ以上あるとき、各分子の下に「① 酢酸」のような見出しを描く（P12-8。ユーザー要望）。
    // 表示だけで作図データには触れないので、判定・反応・エクスポートには影響しない。
    // 1分子のときは出さない（右パネルとモバイルのチップで足りており、図を邪魔するだけ）
    // 見出しを付ける分子と、その番号を決める（図と右パネルで同じ番号を使うため1か所にまとめる）。
    // 重原子1個の分子は、作図中に置きかけた孤立原子（C を1つ置いた直後など）であることが
    // 多いので対象外。ただし**反応でできた副生成物（水など）は含める**
    // （P12-8。ユーザー指摘「反応で CH4 や H2O が生じた場合は表示すべき」）
    markedMolecules(hidden) {
        const visible = (part) => part.atoms
            .filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id)));
        const parts = this.splitMolecules();
        const marked = parts.filter(p => {
            const atoms = visible(p);
            return atoms.length >= 2 || atoms.some(a => a.fromReaction);
        });
        // 見出しは「分子が2つ以上あることを示す」ためのものなので、1つなら付けない
        if (marked.length < 2) return { parts, marks: new Map() };
        const marks = new Map();
        marked.forEach((p, i) => marks.set(p, moleculeMark(i)));
        return { parts, marks };
    }

    /**
     * 分子の下の見出し（`🔍 ① 乳酸`）を描く。**これが分子モーダルの入口**
     * （DESIGN_molecule_modal.md §10-1・ユーザー決定）。
     *
     * **1分子でも出す**（同書 §10-2 の宿題への回答）。見出しはもともと「番号を振る」ためのもので
     * 2分子以上でしか出なかったが、入口を兼ねる以上、**1分子のときに入口が消える**のは通らない。
     * 意味を「番号」から「**名前＋入口**」に変え、名前が引けないときは分子式を出す
     * （作図の途中でも押せる＝異性体・立体はライブラリに無い分子でも調べられる）。
     * ⚠ ただし**学習モードと生成物予測中は出さない**。`#compound-info`（`puzzle free`）と
     * `#mobile-name-chip` が名前を伏せているのと同じ扱いにする（練習と予測の答えになるため）。
     *
     * **当たり判定は文字の帯だけ**（同書 §10-1 の実測）。見出しを当たり判定にすると
     * 「見出しの位置に原子を置けなくなる」——これは実在する制約なので、次の3つで折り合いをつけた:
     *   1. **半マス下げた**（1.15 → 1.65マス）。実測で見出しの矩形は分子の下端＋31〜52px にあり、
     *      **1マス下の格子点（＋42px）を完全に覆っていた**。1.65マスなら矩形は ＋52〜73px ＝
     *      格子点 ＋42 と ＋84 のちょうど中間に落ち、どちらの点にも原子（半径10px）を置ける
     *   2. 帯の幅は**文字の幅ぶん**だけ（左右 9px の余白のみ）。分子の真下の1列以外は塞がない
     *   3. **タップに意味があるモード中は透過に戻す**（`canvasEntryEnabled`）
     *
     * 押せることは**枠と 🔍 で常時見せる**。タッチには hover が無いので、hover には頼らない。
     */
    renderMoleculeLabels(hidden) {
        const NS = 'http://www.w3.org/2000/svg';
        const { parts, marks } = this.markedMolecules(hidden);
        const listed = parts.filter(p => marks.has(p) || this.isSoleLabeledPart(p, parts, hidden));
        const tappable = this.canvasEntryEnabled();
        const s = this.labelScale();
        listed.forEach(part => {
            const mark = marks.get(part);
            const atoms = part.atoms.filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id)));
            const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
            // 枠の上端は分子の下端＋1.1マス（1マス下の格子点のすぐ下）に固定し、
            // 縮小表示のぶんは**下へ**伸ばす（上へ伸ばすと格子点を覆う）
            const top = Math.max(...ys) + GRID_SIZE * 1.1;
            const h = LABEL_CHIP_HEIGHT * s; // 押せるものの下限（32px。TAP1 と同じ物差し）
            const name = this.lookupCompoundName(part) || this.computeMolecularFormula(part);
            const text = `🔍 ${mark ? mark + ' ' : ''}${name}`.trim();
            const g = document.createElementNS(NS, 'g');
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', cx);
            t.setAttribute('y', top + h / 2 + 5.4 * s); // 5.4 ＝ 15px の文字のベースライン補正
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('font-size', String(15 * s));
            t.setAttribute('font-weight', '700');
            t.setAttribute('fill', 'var(--color-cyan, #00f2fe)');
            t.setAttribute('paint-order', 'stroke');
            t.setAttribute('stroke', 'rgba(7,9,12,0.85)');
            t.setAttribute('stroke-width', String(4 * s));
            t.setAttribute('pointer-events', 'none'); // 当たり判定は下の枠に持たせる
            t.textContent = text;
            g.appendChild(t);
            this.atomsGroup.appendChild(g);
            // 枠（チップ）。文字を測ってから敷くので、いったん DOM に入れてから getBBox する
            const bb = t.getBBox();
            const padX = 9 * s;
            const r = document.createElementNS(NS, 'rect');
            r.setAttribute('x', bb.x - padX);
            r.setAttribute('y', top);
            r.setAttribute('width', bb.width + padX * 2);
            r.setAttribute('height', h);
            r.setAttribute('rx', String(h / 2));
            r.setAttribute('fill', tappable ? 'rgba(0,242,254,0.10)' : 'none');
            r.setAttribute('stroke', tappable ? 'rgba(0,242,254,0.5)' : 'none');
            r.setAttribute('stroke-width', String(1.5 * s));
            r.setAttribute('pointer-events', tappable ? 'fill' : 'none');
            g.insertBefore(r, t);
            if (!tappable) return;
            g.style.cursor = 'pointer';
            const rep = atoms[0];
            const open = (e) => {
                // キャンバス側のハンドラ（原子の配置・削除）へ流さない
                e.stopPropagation();
                e.preventDefault();
                this.openMoleculeModal(rep && rep.id);
            };
            // pointerdown で開く（キャンバスの作図と同じ入力系。台本・監査は svg へ直に
            // イベントを撃つので、この見出しは踏まない ＝ 収録とファズの動きは変わらない）
            g.addEventListener('pointerdown', open);
        });
    }

    /**
     * 見出しのチップを**画面上でいつも同じ大きさ**に保つための倍率。
     *
     * チップは指で押す的なので、画面上の高さが 32px を割ってはいけない。ところが SVG の中身は
     * viewBox の縮尺で伸び縮みするので、**320px 幅では 32単位が 16px にしか見えなかった**（実測）。
     * 縮小表示のときだけ倍率を掛けて画面上の大きさを保つ（拡大表示では1倍のまま ＝ 図と一緒に育つ）。
     * 上限を付けるのは、うんと引いた絵で見出しが図を覆わないようにするため。
     * 縮尺は **`getScreenCTM()` から読む**（viewBox 比の手計算はレターボックスを見落とす。開発方針 3.3章）
     */
    labelScale() {
        const m = this.svg && this.svg.getScreenCTM ? this.svg.getScreenCTM() : null;
        const k = m && m.a > 0 ? m.a : 1; // 画面px / SVG単位
        // 上限は2倍。ここを外すと、うんと引いた絵で隣り合う分子の見出しどうしが重なる
        return Math.min(2, Math.max(1, 1 / k));
    }

    // 見出しのチップが図の下にどれだけ張り出すか（枠がこれを囲めるように、1か所で決める）
    labelExtent() {
        return GRID_SIZE * 1.1 + LABEL_CHIP_HEIGHT * this.labelScale();
    }

    /**
     * 見え方（拡大率）が変わったら見出しを描き直す。倍率は描いた時点の縮尺で焼き付くので、
     * ズームのあとそのままにすると**画面上の大きさが狂う**（呼び出し直後の視野合わせで実発生:
     * 320px で 19px の的になっていた）。ホイールもピンチも連続で飛んでくるので1フレームに1回にまとめる。
     */
    scheduleLabelResync() {
        if (this._labelResyncPending) return;
        this._labelResyncPending = true;
        requestAnimationFrame(() => {
            this._labelResyncPending = false;
            if (this.userMolecule && this.userMolecule.atoms.length) this.updateDrawing();
        });
    }

    /**
     * 「1分子だけのときに見出しを出す対象か」。`markedMolecules` が番号を振らない
     * （＝重原子2個以上の分子が1つしかない）ときに、その1つだけを見出しの対象にする。
     * 置きかけの孤立原子には出さない条件は `markedMolecules` と同じにそろえる。
     */
    isSoleLabeledPart(part, parts, hidden) {
        if (this.currentMode === 'learn') return false; // 学習の練習では名前を伏せる
        if (window.reactionPlayer && window.reactionPlayer.prediction) return false; // 予測中は答えになる
        const visible = (p) => p.atoms.filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id)));
        const ok = (p) => { const v = visible(p); return v.length >= 2 || v.some(a => a.fromReaction); };
        if (!ok(part)) return false;
        return parts.filter(ok).length === 1;
    }

    /**
     * キャンバスの見出しからモーダルを開けるか。
     * **タップに別の意味があるモードでは透過に戻す**（DESIGN_molecule_modal.md §10-1）。
     * 選択・各種マーク・箇所選び・機構再生の最中は、見出しもただの文字に戻る。
     */
    canvasEntryEnabled() {
        if (this.reactionSelectMode || this.reshapeMode || this.asymmetricMode || this.haworthMode) return false;
        if (window.stereoView && window.stereoView.picking) return false;
        if (window.reactor && (window.reactor.picking || window.reactor._morphing)) return false;
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return false;
        return true;
    }

    // 縮約表示のカードを1つ描く（P9-2）。
    // カードの向きは「その基が実際に伸びている方向」を優先しつつ、
    // 接続先の原子や他の原子と重なる向きは避ける（方向の最適化）
    renderGroupCard(group, hidden) {
        const NS = 'http://www.w3.org/2000/svg';
        const mol = this.userMolecule;
        const anchor = mol.atoms.find(a => a.id === group.anchorId);
        const members = group.memberIds.map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
        if (!anchor || members.length === 0) return;

        const cx = members.reduce((s, a) => s + a.x, 0) / members.length;
        const cy = members.reduce((s, a) => s + a.y, 0) / members.length;
        const base = Math.atan2(cy - anchor.y, cx - anchor.x);
        // 元の向きに近い順（±90°、180°）に直交方向の候補を並べる
        const snapped = Math.round(base / (Math.PI / 2)) * (Math.PI / 2);
        const candidates = [snapped, snapped + Math.PI / 2, snapped - Math.PI / 2, snapped + Math.PI];
        const w = group.label.length * 10 + 16;
        const h = 24;
        // カードの中心までの距離は「アンカーからカード手前の辺まで丸1マス空ける」ように決める。
        // これでアンカーの炭素とカードの間に、通常の結合と同じ長さの接続線が引ける（COOH等）
        const halfExtent = (cand) => (Math.abs(Math.cos(cand)) > 0.5 ? w / 2 : h / 2);
        const blockers = mol.atoms.filter(a => !hidden.has(a.id) && a.id !== anchor.id);
        let ang = candidates[0];
        for (const cand of candidates) {
            const d = GRID_SIZE + halfExtent(cand);
            const px = anchor.x + d * Math.cos(cand);
            const py = anchor.y + d * Math.sin(cand);
            if (!blockers.some(b => Math.hypot(b.x - px, b.y - py) < GRID_SIZE * 0.8)) {
                ang = cand;
                break;
            }
        }

        const dist = GRID_SIZE + halfExtent(ang);
        const px = anchor.x + dist * Math.cos(ang);
        const py = anchor.y + dist * Math.sin(ang);

        // 接続線: アンカーの炭素の縁から、カード手前の辺まで（通常の結合と同じ見た目の1本）
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', anchor.x + 11 * Math.cos(ang));
        line.setAttribute('y1', anchor.y + 11 * Math.sin(ang));
        line.setAttribute('x2', px - halfExtent(ang) * Math.cos(ang));
        line.setAttribute('y2', py - halfExtent(ang) * Math.sin(ang));
        line.setAttribute('stroke', 'rgba(255,255,255,0.4)');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('pointer-events', 'none');
        this.bondsGroup.appendChild(line);

        const g = document.createElementNS(NS, 'g');
        g.setAttribute('class', 'svg-group-card');
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', px - w / 2);
        rect.setAttribute('y', py - h / 2);
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('rx', '7');
        rect.setAttribute('fill', 'rgba(0, 242, 254, 0.14)');
        rect.setAttribute('stroke', 'var(--color-cyan, #00f2fe)');
        rect.setAttribute('stroke-width', '1.6');
        const text = document.createElementNS(NS, 'text');
        text.setAttribute('x', px);
        text.setAttribute('y', py + 5);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#dffbff');
        text.setAttribute('class', 'svg-atom-text');
        text.style.fontSize = '14px';
        text.textContent = group.label;
        g.appendChild(rect);
        g.appendChild(text);
        this.atomsGroup.appendChild(g);
    }

    // モード切替（P10 M1）: 右パネルの data-modes 要素を出し分ける。
    // 作図中の分子は保持し、表示だけを切り替える（判定・反応・エクスポートには影響しない）
    /**
     * 次のお題へ。正解後（🎉）と「↷ やめて次へ」で共用する。
     *
     * ⚠ **シリーズの最後（や1問しかないシリーズ）では次のシリーズへ移る。**
     * 以前はシリーズ内で先頭へ巻き戻していたので、**1問だけのシリーズ
     *（既定の「はじめに（操作の練習）」がそう）では押しても何も起きなかった**。
     * 正解後は次の問題が無いと気づけるが、「やめて次へ」では**行き止まりに見える**。
     */
    goToNextStage() {
        const inSeries = (name) => STAGES
            .map((stage, idx) => (stage.series === name ? idx : -1))
            .filter(i => i >= 0);
        const here = this.seriesSelect.value;
        const list = inSeries(here);
        const pos = list.indexOf(this.currentStageIndex);
        if (pos !== -1 && pos + 1 < list.length) {
            this.stageSelect.value = list[pos + 1];
            this.loadStage(list[pos + 1]);
            return;
        }
        // このシリーズは終わり → 次のシリーズの先頭へ（最後なら最初のシリーズへ戻る）
        const series = [...new Set(STAGES.map(s => s.series))];
        const si = series.indexOf(here);
        const nextSeries = series[(si + 1) % series.length];
        const nextList = inSeries(nextSeries);
        if (!nextList.length) return;
        this.seriesSelect.value = nextSeries;
        this.updateStageOptions(nextSeries);
        this.stageSelect.value = nextList[0];
        this.loadStage(nextList[0]);
        this.showToast(`「${nextSeries}」に進みました。`, 2600, 'success');
    }

    /**
     * 書きかけの練習が消える場面で確認を出す（ユーザー判断 B・2026-08-05）。
     *
     * **これまでは無言で消えていた。** 学習モードを離れると setMode が
     * isomerPractice / alkylPractice / stereoPractice を stop() するため、
     * 「← 自由に戻る」を押しただけで書いた図が失われていた。
     * 入口の見直しで「抜ける」が押しやすくなるほど事故が増えるので、ここで止める。
     *
     * **確認するのは実際に書きかけがあるときだけ**（`entries.length > 0`）。
     * 始めただけ・0個のときは黙って進む ＝ 空の確認で邪魔しない。
     */
    leaveGuard(next, proceed) {
        const pending = this.pendingPractices(next);
        if (!pending.length) { proceed(); return; }
        this.askConfirm(
            `${pending.join('・')}の書きかけが消えます`,
            'このまま移動すると、書いた図は保存されません。戻って「🔍 答え合わせ」を押すと採点できます。',
            '移動する', proceed);
    }

    /** 書きかけ（1個以上書いた）の練習の名前。移動先が学習なら何も消えない */
    pendingPractices(next) {
        if (next === 'learn') return [];
        const out = [];
        const chk = (p, label) => {
            if (p && p.active && Array.isArray(p.entries) && p.entries.length > 0) out.push(label);
        };
        chk(window.isomerPractice, '異性体の書き出し練習');
        chk(window.alkylPractice, 'アルキル基の書き出し練習');
        chk(window.stereoPractice, '立体異性体の書き出し練習');
        return out;
    }

    /**
     * アプリの中で完結する確認（`window.confirm` は使わない）。
     * 素の confirm はスレッドを止めるので、**台本の無人再生とヘッドレステストが固まる**。
     * ここはコールバック方式なので、開いたままでも他の処理は動く。
     */
    askConfirm(title, body, okLabel, onOk) {
        const modal = document.getElementById('confirm-modal');
        if (!modal) { onOk(); return; }   // 器が無い環境では止めない
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-body').textContent = body;
        const ok = document.getElementById('btn-confirm-ok');
        const cancel = document.getElementById('btn-confirm-cancel');
        ok.textContent = okLabel;
        const close = () => {
            modal.classList.add('hidden');
            ok.onclick = null; cancel.onclick = null;
        };
        ok.onclick = () => { close(); onOk(); };
        cancel.onclick = close;
        modal.classList.remove('hidden');
    }

    setMode(mode) {
        // 知らない値は**標準の🧪自由**へ（DESIGN_entry_points.md §8b。以前は🧩パズル）
        if (!['puzzle', 'learn', 'free'].includes(mode)) mode = 'free';
        this.currentMode = mode;
        document.querySelectorAll('.mode-tab').forEach(t =>
            t.classList.toggle('active', t.dataset.mode === mode));
        // 「← 自由に戻る」は行き先（パズル・学習）にいるときだけ出す
        const backToFree = document.getElementById('btn-back-to-free');
        if (backToFree) backToFree.style.display = (mode === 'free') ? 'none' : 'block';
        document.querySelectorAll('#right-panel [data-modes]').forEach(el => {
            el.style.display = el.dataset.modes.split(' ').includes(mode) ? '' : 'none';
        });
        // ⚠ ここから下の「離れるときに捨てる」処理は**確認を挟まない**。
        // 確認は `leaveGuard`（人がタブや「← 自由に戻る」を押したとき）の仕事で、
        // setMode 自体は台本・テスト・`?open=` からも呼ばれるため止めてはいけない。
        // 学習モードを離れるときは反応機構モードを終了する
        if (mode !== 'learn' && window.reactionPlayer && window.reactionPlayer.active) {
            window.reactionPlayer.exit();
        }
        // 学習モードを離れるときは異性体練習セッションを破棄する（P12-1）
        if (mode !== 'learn' && window.isomerPractice && window.isomerPractice.active) {
            window.isomerPractice.stop();
        }
        // 学習モードを離れるときはアルキル基練習セッションを破棄する（P12-3）
        if (mode !== 'learn' && window.alkylPractice && window.alkylPractice.active) {
            window.alkylPractice.stop();
        }
        // 学習モードを離れるときは立体異性体練習セッションを破棄する（P12-8 M2.5 その4）
        if (mode !== 'learn' && window.stereoPractice && window.stereoPractice.active) {
            window.stereoPractice.stop();
        }
        // 自由モードを離れるときは反応の前後比較を破棄し、モーフィング再生を止める（P12-5）
        if (mode !== 'free' && window.reactor) {
            window.reactor.finalizeMorph();
            window.reactor.exitCompare();
        }
        // パズル以外へ移ると判定結果表示は消す（トーストの残りが紛らわしいため）
        if (mode !== 'puzzle') {
            const vr = document.getElementById('verify-result');
            if (vr && vr.classList.contains('result-message')) vr.classList.add('hidden');
        }
        try { localStorage.setItem('chemAssembler.mode', mode); } catch (e) { /* privateモード等 */ }
        // モバイルの名前チップはモードで表示/非表示が変わるため同期する
        if (this.userMolecule) this.syncMobileNameChip();
    }

    /**
     * 「⚗ 反応」の分類を表示する（P9-1 M1）。
     * **表示先は分子モーダルの中**（DESIGN_molecule_modal.md 第2段で `#reaction-card` から移した）。
     * 呼ばれる頻度は変わらない（作図のたび）＝ 開いた瞬間にはもう最新になっている。
     */
    updateReactionCard() {
        // 実行可能な反応のボタン列も同時に再構築する（P9-1 M2）
        if (window.reactor) window.reactor.refresh();
        // 右パネルに残すのは**件数だけ**（同書 §4-1）。reactor.refresh() が数え終わった直後に書き換える
        this.syncInspectButton();
        const el = document.getElementById('molecule-props');
        if (!el) return;
        const heavy = this.userMolecule.atoms.filter(a => a.element !== 'H');
        if (heavy.length === 0) {
            // ⚠ **方角で場所を指さない**（index.html の初期文言と同じ文にそろえる）。
            // A-4 で名称呼び出しが「下の検索」でなくなり、第2段でこの節が**モーダルへ移った**ので
            // 「上の」でもなくなった。呼び出し欄は右パネル（モバイルではシート）に残っていて、
            // この文はモーダルの中に出る ＝ 位置関係を言うと必ずまた嘘になる
            el.textContent = '分子を作図するか、「名称から分子を呼び出す」で分子を出すと、ここに分類が表示されます。';
            return;
        }
        // 分子が2つ以上あるときは「どの分子の話か」を必ず言う（レビュー項目9）。
        // 全部を混ぜた一覧だと、キャンバスのどちらの分子の分類なのか画面から読み取れない
        const info = this.focusedMoleculeInfo(null);
        if (!info) {
            const molCount = this.countMolecules();
            const prefix = molCount > 1 ? `【${molCount}分子】 ` : '';
            el.textContent = prefix + this.functionalGroupSummary(this.userMolecule);
            return;
        }
        el.innerHTML = '';
        // ⚠ ①②③のチップはここには**もう描かない**（DESIGN_molecule_modal.md 第2段）。
        // この節は分子モーダルの中へ移り、**すぐ上に同じ役目の `#mm-tabs` がある**ので、
        // 残すと同じタブが2段に並ぶ。切り替えの窓口は `#mm-tabs` に一本化する
        // （どちらも `setFocusedMolecule()` を呼ぶだけで、選択 `selectedMolecules` には触れない）
        const line = document.createElement('div');
        const name = this.lookupCompoundName(info.part) || 'この分子';
        line.textContent = `⚗ 分析中: ${info.mark} ${name} … ${this.functionalGroupSummary(info.part)}`;
        el.appendChild(line);
        // 下の反応ボタンは**キャンバス全体**を見て出している（エステル化のように2分子が要る
        // 反応があるため）。分析中の分子だけを書くと、ボタンの根拠が読めなくなるので全体も残す。
        // ただし「どちらの分子の話か」が分かるよう、必ず見出しを付ける（レビュー項目9）
        const all = document.createElement('div');
        all.style.cssText = 'color:var(--text-secondary); font-size:11px;';
        all.textContent = `【${this.countMolecules()}分子】 キャンバス全体: ${this.functionalGroupSummary(this.userMolecule)}`;
        el.appendChild(all);
    }

    // 官能基の一覧を1行の文にする（「⚗ この分子の反応」カードの分類表示）
    functionalGroupSummary(mol) {
        const groups = findFunctionalGroups(mol);
        if (groups.length === 0) return '特徴的な官能基はありません（炭化水素など）。';
        const counts = new Map();
        groups.forEach(g => counts.set(g.label, (counts.get(g.label) || 0) + 1));
        return [...counts].map(([label, n]) => n > 1 ? `${label}×${n}` : label).join('、');
    }

    // 名称呼び出しUIの初期化（P9-1 M1）。データロード完了後に一度だけ呼ぶ
    setupSummonUI() {
        const input = document.getElementById('summon-input');
        const list = document.getElementById('summon-list');
        if (!input || !list) return;
        [...new Set(this.getCompoundLibrary().map(e => e.name))].sort().forEach(n => {
            const opt = document.createElement('option');
            opt.value = n;
            list.appendChild(opt);
        });
        input.addEventListener('change', () => {
            const name = input.value.trim();
            if (name) this.summonMolecule(name);
        });
    }

    // ライブラリの化合物を名称からキャンバスへ配置する。既存分子の右側の空き位置へ
    // グリッド倍数の平行移動で置く（既存原子は動かさない）。1呼び出し=1 Undo
    summonMolecule(name) {
        const entry = this.getCompoundLibrary().find(e => e.name === name);
        if (!entry) {
            this.showToast('その名称はライブラリにありません。候補から選んでください。');
            return;
        }
        // ライブラリの分子（共有インスタンス）を汚さないよう、新しいIDでディープコピーする。
        // IDを振り直すことで、同じ化合物を複数回呼び出しても衝突しない
        const src = entry.mol;
        const idMap = new Map();
        const mol = new Molecule();
        src.atoms.forEach(a => {
            const na = mol.addAtom(a.element, a.x, a.y);
            idMap.set(a.id, na.id);
        });
        src.bonds.forEach(b => mol.addBond(idMap.get(b.atomId1), idMap.get(b.atomId2), b.type));
        const user = this.userMolecule;
        let dx = 0, dy = 0;
        if (user.atoms.length > 0) {
            // 横に並べる基準は「**いまの段**の右端」。全体の右端を見ると、折り返した直後も
            // 前の段の右端と比べてしまい、1段に1分子しか入らなくなる（実測で45分子が48段になった）
            const bottomY = Math.max(...user.atoms.map(a => a.y));
            const bottomRow = user.atoms.filter(a => a.y > bottomY - GRID_SIZE * 4);
            const maxX = Math.max(...bottomRow.map(a => a.x));
            const minNX = Math.min(...mol.atoms.map(a => a.x));
            // 縦の位置合わせも同じ段を基準にする（全体平均だと折り返した後に上へ引かれる）
            const avgY = bottomRow.reduce((s, a) => s + a.y, 0) / bottomRow.length;
            const avgNY = mol.atoms.reduce((s, a) => s + a.y, 0) / mol.atoms.length;
            dx = Math.round((maxX + GRID_SIZE * 2 - minNX) / GRID_SIZE) * GRID_SIZE;
            dy = Math.round((avgY - avgNY) / GRID_SIZE) * GRID_SIZE;

            // 右へ一直線に並べ続けると、10分子ほどで作図の上限 |x| > 5000 を超える。
            // そこから先も呼び出し自体は成功するが、その位置では**新しい原子を置けない**
            // （getSnappedCoords が tooLarge で弾く）ので、編集も反応もできない分子ができる。
            // 一定の幅を超えたら下の段へ折り返す（P12-8。ユーザー指摘のオーバーフロー対策）
            const maxNX = Math.max(...mol.atoms.map(a => a.x));
            if (maxNX + dx > SUMMON_ROW_WIDTH) {
                const minX = Math.min(...user.atoms.map(a => a.x));
                const maxY = Math.max(...user.atoms.map(a => a.y));
                const minNY = Math.min(...mol.atoms.map(a => a.y));
                dx = Math.round((minX - minNX) / GRID_SIZE) * GRID_SIZE;
                // 段の間隔は3マス。図の下に出す①②③の見出し（+1.15マス）と重ならない幅にする
                dy = Math.round((maxY + GRID_SIZE * 3 - minNY) / GRID_SIZE) * GRID_SIZE;
            }
            // 段の右端は「いまの段」だけを見て決めるため、**上の段が右へ伸びている**と
            // 新しい分子が既存の原子に重なる（v331 夜間監査で完全一致 0.0px を4件検出）。
            // 段の判定はそのままに、重なったときだけ1マスずつ下げて空きを探す
            const tooClose = (ddy) => mol.atoms.some(n => user.atoms.some(a =>
                Math.hypot(a.x - (n.x + dx), a.y - (n.y + ddy)) < GRID_SIZE));
            for (let k = 0; k < 40 && tooClose(dy); k++) dy += GRID_SIZE;

            // 折り返しても収まらないなら、黙って編集できない場所へ置かずに理由を出す
            const outX = Math.max(...mol.atoms.map(a => Math.abs(a.x + dx)));
            const outY = Math.max(...mol.atoms.map(a => Math.abs(a.y + dy)));
            if (outX > CANVAS_LIMIT || outY > CANVAS_LIMIT) {
                this.showToast('キャンバスの端まで分子が並びました。' +
                    'これ以上置くと編集できない場所になるため、呼び出しを止めました。' +
                    '不要な分子を消すか、全消去してからやり直してください。');
                return;
            }
        }
        this.saveState();
        mol.atoms.forEach(a => {
            a.x += dx;
            a.y += dy;
            a.isLocked = false;
            user.atoms.push(a);
        });
        mol.bonds.forEach(b => user.bonds.push(b));
        // 呼び出した分子の C=C まわりだけ ±120° に整える（C-4。手描きの直交はそのまま）
        this.reshapeVinylAngles(mol.atoms.map(a => a.id));
        this.updateDrawing();
        // お題ではなく**呼び出した結果のキャンバス全体**に合わせる。
        // ステアリン酸など既定の視野に収まらない分子を呼んでも画面外に出ない
        this.fitCanvasToMolecule(user);
        this.showToast(`「${name}」を呼び出しました。`, 2500, 'success');
        const input = document.getElementById('summon-input');
        if (input) input.value = '';
    }

    renderAtom(id, element, x, y, isLocked, isAsymmetricMarked = false, haworthFace = null) {
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

        // α/β 面マーク（ハース投影）の描画（P12-7 M2b）。
        // 上(+1)=塗り三角のくさび（▲）、下(-1)=中抜き＋破線の三角（▽）で面の向きを示す。
        if (haworthFace === 1 || haworthFace === -1) {
            const NS = 'http://www.w3.org/2000/svg';
            const up = haworthFace === 1;
            const cxb = x - 11, cyb = y - 9; // 原子の左上に配置（不斉星の * と重ならない側）
            const tri = document.createElementNS(NS, 'path');
            // 上向き/下向きの小三角（1辺約8px）
            const d = up
                ? `M ${cxb} ${cyb + 3.5} L ${cxb - 4} ${cyb + 3.5} L ${cxb - 2} ${cyb - 3.5} Z`
                : `M ${cxb} ${cyb - 3.5} L ${cxb - 4} ${cyb - 3.5} L ${cxb - 2} ${cyb + 3.5} Z`;
            tri.setAttribute('d', d);
            tri.setAttribute('class', 'svg-haworth-face');
            if (up) {
                tri.setAttribute('fill', 'var(--neon-orange, #ff9f43)');
                tri.setAttribute('stroke', 'none');
            } else {
                tri.setAttribute('fill', 'none');
                tri.setAttribute('stroke', 'rgba(120, 190, 255, 0.95)');
                tri.setAttribute('stroke-width', '1.2');
                tri.setAttribute('stroke-dasharray', '2,1.4');
            }
            group.appendChild(tri);
        }

        this.atomsGroup.appendChild(group);
    }

    renderBond(x1, y1, x2, y2, type, isHConnection = false, bondObj = null, isHaworthFront = false) {
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
            // 単結合（ハース環の手前側は太く描いて奥行きを示す＝教科書の慣習）
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', sx);
            line.setAttribute('y1', sy);
            line.setAttribute('x2', ex);
            line.setAttribute('y2', ey);
            line.setAttribute('stroke', isHaworthFront ? 'rgba(255,255,255,0.72)' : strokeColor);
            line.setAttribute('stroke-width', isHaworthFront ? '6' : '3');
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
            
            // ネイティブのclickとdblclickイベントを使用し、タイマー遅延を完全に排除。
            // タッチ用に消しゴム・長押し・自前ダブルタップの削除導線を追加（P12-B1 S2/S4）
            hitLine.addEventListener('pointerdown', (e) => {
                // モジュール配置中は結合操作を奪わず、キャンバス側の配置処理へ流す。
                // （結合の判定領域上のクリックが握りつぶされ、モジュールが「効かない」ように
                //   見えるバグの修正。P7-10）
                if (this.selectedModule) return;
                e.stopPropagation(); // キャンバス側のpointerdown（原子の配置・削除）が走るのを阻止
                this._bondClickSkip = null; // 前回の消し込みフラグを掃除
                // タッチ指をピンチ判定に参加させる（結合上から始まる2本指ズームを可能にする）
                if (this.trackPointerDown(e, false) !== 'proceed') return;

                // 消しゴム: 結合をタップ/クリックで即削除（P12-B1 S2。従来はこの判定線が
                // pointerdown を握るため、キャンバス側の消しゴム処理に結合が届かなかった）
                if (this.selectedTool === 'erase' && e.button === 0) {
                    if (this.removeBondByGesture(bondObj)) this._bondClickSkip = 'deleted';
                    return;
                }

                // 判定線は太い(20px)ため原子の周縁タップを奪うことがある。指の下に原子が
                // あるなら原子操作（同元素タップ削除・ドラッグ等）を優先する（P12-B1 S4）。
                // 半径16px = 描画半径10pxより少し広く、標準結合(42px)の中点21pxには届かない値
                // （findAtomAtの既定28pxだと結合中点のタップまで原子扱いになり次数トグルが死ぬ）
                if (e.button === 0) {
                    const c0 = this.getSnappedCoords(e);
                    if (this.findAtomAt(c0.rawX, c0.rawY, 16)) {
                        this._bondClickSkip = 'atom';
                        this.handleMouseDown(e);
                        return;
                    }
                }

                if (e.button === 0) {
                    // ドラッグ（3px超の移動）で結合の伸縮を開始。クリックとの判別はfinishBondStretch側で行う
                    this.beginBondStretch(bondObj, e);
                    // タッチの長押し（550ms・ほぼ動かさない）で削除。iOSはdblclick/contextmenuが
                    // 当てにならないため、タッチ共通の確実な削除導線を自前で持つ（P12-B1 S2/S3）
                    if (e.pointerType === 'touch') {
                        const startX = e.clientX, startY = e.clientY, pid = e.pointerId;
                        clearTimeout(this._bondPressTimer);
                        this._bondPressTimer = setTimeout(() => {
                            const p = this.activePointers.get(pid);
                            if (!p || this.pinch) return; // 指が離れた/ピンチに化けたら何もしない
                            if (Math.hypot(p.x - startX, p.y - startY) > 12) return; // ドラッグ中
                            if (this.removeBondByGesture(bondObj)) {
                                this._bondClickSkip = 'deleted';
                                this.showToast('結合を削除しました。', 1500, 'success');
                            }
                        }, 550);
                    }
                }
            });
            hitLine.addEventListener('pointerup', (e) => {
                clearTimeout(this._bondPressTimer);
                if (e.pointerType !== 'touch' || this._bondClickSkip) return;
                // 伸縮ドラッグの終わりはタップではない（直後のタップを「2回目」と誤認して
                // 削除しないよう、移動があった場合はタップ履歴ごと破棄する）
                const st = this.bondStretch;
                if (st && (Math.abs(e.clientX - st.startClient.x) > 8 ||
                           Math.abs(e.clientY - st.startClient.y) > 8)) {
                    this._lastBondTap = null;
                    return;
                }
                // タッチのダブルタップ検出（400ms以内の同一結合への2タップで削除）。
                // iOS Safariはタッチでdblclickを発火しないことがあるため自前判定（P12-B1 S2）
                const key = bondObj.atomId1 + '_' + bondObj.atomId2;
                const now = Date.now();
                if (this._lastBondTap && this._lastBondTap.key === key && now - this._lastBondTap.t < 400) {
                    this._lastBondTap = null;
                    if (this.removeBondByGesture(bondObj)) this._bondClickSkip = 'deleted';
                } else {
                    this._lastBondTap = { key, t: now };
                }
            });
            hitLine.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // キャンバス全体のmousedown（原子の上書き・配置）が走るのを完全に阻止
            });
            hitLine.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.suppressBondClick) return; // 伸縮ドラッグ直後の合成clickでは次数トグルしない
                if (this._bondClickSkip) { this._bondClickSkip = null; return; } // 削除済み/原子へ転送済み
                if (this.selectedTool === 'erase') return; // 消しゴム時は次数トグルしない
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

            // 2. 判定オプション「不斉炭素も判定する」がON時の不斉炭素マーク判定（P10 M2）
            if (this.judgeAsymmetric) {
                // ユーザーの全炭素(C)について、本当に不斉炭素であるかとマーク状態が一致しているか走査
                const carbonAtoms = this.userMolecule.atoms.filter(a => a.element === 'C');
                
                // マーク状態が実際と食い違う炭素を収集し、座標文字列ではなく
                // キャンバス上のハイライトで示す（P7-4）
                const wrongAtoms = carbonAtoms.filter(atom =>
                    this.userMolecule.isAsymmetricCarbon(atom.id) !== atom.isAsymmetricMarked);

                if (wrongAtoms.length > 0) {
                    this.highlightAtoms(wrongAtoms);
                    this.verifyResult.className = "result-message error";
                    this.verifyResult.textContent =
                        "分子構造は合っていますが、不斉炭素原子（*）のマーク指定が正しくありません。オレンジの点線でハイライトした炭素を確認してください。";
                    return;
                }
            }

            // 3. すべて合格！（メッセージは実際に検証した内容だけを述べる: 開発方針 5章）
            this.verifyResult.className = "result-message success";
            this.verifyResult.textContent = this.judgeAsymmetric
                ? "正解です！構造および不斉炭素原子の位置が完全に一致しました！"
                : "正解です！分子構造が完全に一致しました！";
            
            // クリア記録と勝利モーダルの表示
            this.markStageCleared(stage.name);
            slTrack('stage_clear', { app: 'assembler', stage: stage.name });
            this.showWinModal(stage);
        }, 800);
    }

    /**
     * 反応させる分子の選択をタップで切り替える（C-1。2026-08-01 ユーザー要望）。
     * 何もない所をタップしたら全解除。選び直しやすいよう、上限を超えたら古い方を捨てる。
     * 選択は**代表原子のID**で覚える（分子は反応で作り替わるので、原子IDの集合では追えない）。
     */
    toggleMoleculeSelection(atom) {
        if (!atom) {
            this.selectedMolecules = [];
            this.updateDrawing();
            return;
        }
        const comp = this.moleculeAtomIdsOf(atom.id);
        const hit = this.selectedMolecules.findIndex(id => comp.has(id));
        if (hit >= 0) {
            this.selectedMolecules.splice(hit, 1); // もう一度タップで解除
        } else {
            this.selectedMolecules.push(atom.id);
            while (this.selectedMolecules.length > MAX_REACTION_SELECTION) {
                this.selectedMolecules.shift();
            }
            // 選んだ分子を「⚗ この分子の反応」の分析対象にも合わせる（レビュー項目9）。
            // これがキャンバス側から分析対象を切り替える手段になる（見出しのタップは
            // 作図と取り合いになるので採らない）
            this.focusedMolecule = atom.id;
        }
        this.updateDrawing();
    }

    // その原子が属する分子（連結成分）の原子IDの集合
    moleculeAtomIdsOf(atomId) {
        const seen = new Set([atomId]);
        const stack = [atomId];
        while (stack.length) {
            const cur = stack.pop();
            this.userMolecule.bonds.forEach(b => {
                const next = b.atomId1 === cur ? b.atomId2 : b.atomId2 === cur ? b.atomId1 : null;
                if (next && !seen.has(next)) { seen.add(next); stack.push(next); }
            });
        }
        return seen;
    }

    /**
     * 選択中の分子（代表原子ID）ごとの原子ID集合。選択が反応で消えた場合は取り除く。
     *
     * **同じ連結成分を指す選択はまとめる**（レビュー項目15）。エステル化のように
     * 2分子が1つに繋がる反応のあとは、選んだ2つの代表原子が同じ分子の中に並ぶ。
     * そのまま2件として数えると「2分子を選んでいる」ことになり、
     * 分子間反応だけに絞る条件（9.3節）が二度と満たされず、次の反応が消えてしまう。
     * 残すのは**先に選んだ方**＝式の左。
     */
    selectedMoleculeSets() {
        const alive = this.selectedMolecules
            .filter(id => this.userMolecule.atoms.some(a => a.id === id));
        const sets = [];
        const kept = [];
        alive.forEach(id => {
            if (sets.some(s => s.has(id))) return;
            sets.push(this.moleculeAtomIdsOf(id));
            kept.push(id);
        });
        this.selectedMolecules = kept;
        return sets;
    }

    /**
     * 「⚗ この分子の反応」カードがいま分析している分子を決める（レビュー項目9）。
     *
     * 分子が2つ以上あるときだけ意味を持つ（1分子なら指すものが1つしかなく、
     * 枠を出しても図を汚すだけ）。明示指定が無い／その分子が反応や削除で消えたときは
     * ① ＝ 最初の分子に戻す。番号は `markedMolecules` が付ける丸数字と同じものを使うので、
     * 図の見出し・右パネルの化合物名・この枠がすべて同じ番号を指す。
     */
    focusedMoleculeInfo(hidden) {
        const { parts, marks } = this.markedMolecules(hidden || null);
        const listed = parts.filter(p => marks.has(p));
        if (listed.length < 2) return null;
        let part = null;
        if (this.focusedMolecule) {
            part = listed.find(p => p.atoms.some(a => a.id === this.focusedMolecule)) || null;
        }
        /**
         * **`explicit` ＝ 利用者が自分で選んだ分子か**（2026-08-05・C-9）。
         * 選んでいないときも `listed[0]` を返し続けるのは、右パネルの分類が
         * 「どの分子の話か」を言えなくなるため（レビュー項目9）。
         * **図の琥珀の枠だけは、この旗が立つまで描かない**（renderFocusFrame が見る）
         * ＝ 誰も選んでいないのにアプリが1つを指すと、「◯◯はどれ？」と
         * 考えている生徒の邪魔になるうえ、動画では答えが漏れる。
         */
        const explicit = !!part;
        if (!part) part = listed[0];
        return { part, mark: marks.get(part), listed, marks, explicit };
    }

    // 分析対象を切り替える（カードのチップ・「🎯 反応させる分子を選ぶ」のタップから呼ばれる）
    setFocusedMolecule(atomId) {
        if (!this.userMolecule.atoms.some(a => a.id === atomId)) return;
        this.focusedMolecule = atomId;
        this.updateDrawing();
    }

    /* ===== 分子モーダル（DESIGN_molecule_modal.md 第1段） =====
       「この分子について」をまとめて開く面。第1段で入るのは **🔬 調べる（📚 異性体・🧊 立体）**だけで、
       ⚗ 反応と試薬は第2段以降。**実体は既存のモーダルのまま**で、ここはボタンを集めた入口。 */

    /**
     * モーダルが対象にしている1分子（連結成分）。
     * 分析対象（`focusedMolecule`）と同じ考え方でそろえる ＝ 図の琥珀の枠・右パネルの分類・
     * この画面がいつも同じ分子を指す。**選択（`selectedMolecules`）とは混ぜない**。
     */
    moleculeModalPart() {
        const parts = this.splitMolecules().filter(p => p.atoms.some(a => a.element !== 'H'));
        if (!parts.length) return null;
        if (this.focusedMolecule) {
            const hit = parts.find(p => p.atoms.some(a => a.id === this.focusedMolecule));
            if (hit) return hit;
        }
        const { marks } = this.markedMolecules(null);
        return parts.find(p => marks.has(p)) || parts[0];
    }

    openMoleculeModal(atomId) {
        const modal = document.getElementById('molecule-modal');
        if (!modal) return;
        if (atomId) this.setFocusedMolecule(atomId);
        if (!this.moleculeModalPart()) {
            this.showToast('先に分子を作図するか、名称から呼び出してください。');
            return;
        }
        this.renderMoleculeModal();
        modal.classList.remove('hidden');
    }

    closeMoleculeModal() {
        const modal = document.getElementById('molecule-modal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * 右パネルに1つだけ残した「🔬 この分子を調べる（反応 N件）」のラベルを更新する
     * （DESIGN_molecule_modal.md §4-2）。
     *
     * 反応ボタン列をモーダルへ移すと、「**-OH を付けた瞬間に『酸化』ボタンが生える**」という
     * 気づきが画面から消える。中身は開かないと分からないままだが、**数が増えたことだけは残す**。
     * 件数は `reactor.refresh()` が数えた「押して進められる反応」で、⚠ の解説カードや
     * 相手の呼び出し案内は含まない（＝ 0件のときは「反応 —」になる）。
     */
    syncInspectButton() {
        const btn = document.getElementById('btn-molecule-modal');
        if (!btn) return;
        const n = (window.reactor && window.reactor.executableCount) || 0;
        btn.textContent = `🔬 この分子を調べる（反応 ${n > 0 ? n + '件' : '—'}）`;
    }

    // 見出し（名前・分子式）と、分子が2つ以上あるときの①②③タブを描く
    renderMoleculeModal() {
        const part = this.moleculeModalPart();
        if (!part) return;
        // ⚗ 反応は**自由モードだけ**（第2段）。`data-modes` は #right-panel の中しか見ないので
        // ここで出し分ける。パズル中に分子を書き換えられると、お題の判定が意味を失う
        const rx = document.getElementById('mm-reaction');
        if (rx) rx.style.display = (this.currentMode === 'free') ? '' : 'none';
        const nameEl = document.getElementById('mm-name');
        const formulaEl = document.getElementById('mm-formula');
        const tabsEl = document.getElementById('mm-tabs');
        if (nameEl) nameEl.textContent = this.lookupCompoundName(part) || '（ライブラリに該当なし）';
        if (formulaEl) formulaEl.textContent = this.computeMolecularFormula(part);
        if (!tabsEl) return;
        tabsEl.innerHTML = '';
        const { parts, marks } = this.markedMolecules(null);
        const listed = parts.filter(p => marks.has(p));
        if (listed.length < 2) return; // 1分子なら切り替える先が無い
        listed.forEach(p => {
            const rep = p.atoms.find(a => a.element !== 'H') || p.atoms[0];
            const on = p.atoms.some(a => part.atoms.some(b => b.id === a.id));
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'mm-tab';
            chip.textContent = `${marks.get(p)} ${this.lookupCompoundName(p) || this.computeMolecularFormula(p)}`;
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
            if (on) chip.classList.add('active');
            chip.addEventListener('click', () => {
                if (rep) this.setFocusedMolecule(rep.id);
                this.renderMoleculeModal();
            });
            tabsEl.appendChild(chip);
        });
    }

    // モーダルの配線（起動時に一度だけ）
    setupMoleculeModal() {
        const modal = document.getElementById('molecule-modal');
        if (!modal) return;
        const close = document.getElementById('btn-molecule-modal-close');
        if (close) close.addEventListener('click', () => this.closeMoleculeModal());
        // 右パネルの控えの入口（第2段）。主の入口はキャンバスの見出しのタップ（§10-1）で、
        // こちらは PC で手が届く場所と、反応の件数の置き場所を兼ねる
        const open = document.getElementById('btn-molecule-modal');
        if (open) open.addEventListener('click', () => this.openMoleculeModal());
        // **子を開くときは自分を閉じる**（DESIGN_molecule_modal.md §5-5）。
        // 14枚のモーダルはすべて z-index:1000 で、重ねると ✕ が2つ並ぶ絵になる。
        // ここを**捕獲フェーズ**で受けるのは、ボタン自身に付いた「開く」処理より先に
        // 走らせるため（同じ要素に付けた listener は登録順に走るので、あちらには勝てない）。
        // タブ（分子の切替）と閉じるボタンは、この画面に留まるので対象外。
        //
        // **第2段の反応ボタン列もこの1本で面倒を見る**（§2-5・§5-3）。
        // 適用箇所の選択（narrow）・実行のモーフィング・前後比較オーバーレイは
        // **すべてキャンバスの上**で起きるので、全画面のモーダルが乗ったままだと1つも見えない。
        // 「🎯 反応させる分子を選ぶ」も同じで、選ぶ相手はキャンバスにいる
        modal.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('button');
            if (!btn || btn === close || btn.closest('#mm-tabs')) return;
            this.closeMoleculeModal();
        }, true);
    }

    /**
     * 分析対象の分子を琥珀色の枠で囲う（表示のみ。作図データには触れない。レビュー項目9）。
     *
     * **「🎯 反応させる分子を選ぶ」の選択枠（青・破線・番号バッジは左上）とは見た目を分ける。**
     * 同じ絵にすると「分類を見ている分子」と「反応を絞っている分子」の2つの状態が混ざる。
     * こちらは実線＋外側に淡い光、見出しは枠の**右上**に「⚗ 分析中」と出す。
     */
    renderFocusFrame(hidden) {
        const info = this.focusedMoleculeInfo(hidden);
        // **利用者が自分で分子を選ぶまで枠は出さない**（2026-08-05・C-9）。
        // 以前は既定で ① に付いたので、「◯◯はどれ？」と問う場面で
        // アプリが勝手に答えを指していた（動画では冒頭で答えが漏れた）
        if (!info || !info.explicit) return;
        const NS = 'http://www.w3.org/2000/svg';
        const atoms = info.part.atoms
            .filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id)));
        if (!atoms.length) return;
        const pad = 24;
        const x1 = Math.min(...atoms.map(a => a.x)) - pad;
        const x2 = Math.max(...atoms.map(a => a.x)) + pad;
        const y1 = Math.min(...atoms.map(a => a.y)) - pad;
        // 図の下には 🔍①名前 の見出しが出るので、それを枠の中へ入れる
        // （張り出しは labelExtent が1か所で決める。DESIGN_molecule_modal.md 第1段）
        const y2 = Math.max(...atoms.map(a => a.y)) + this.labelExtent() + 6;
        const rect = (w, color, opacity) => {
            const r = document.createElementNS(NS, 'rect');
            r.setAttribute('x', x1); r.setAttribute('y', y1);
            r.setAttribute('width', x2 - x1); r.setAttribute('height', y2 - y1);
            r.setAttribute('rx', '14');
            r.setAttribute('fill', 'none');
            r.setAttribute('stroke', color);
            r.setAttribute('stroke-width', String(w));
            r.setAttribute('opacity', String(opacity));
            r.setAttribute('pointer-events', 'none');
            this.atomsGroup.appendChild(r);
        };
        rect(9, 'var(--neon-orange, #ffa502)', 0.18); // 外側のぼんやりした光
        rect(2, 'var(--neon-orange, #ffa502)', 0.95); // 内側の実線
        // 見出しは枠の**右上**に出す（レビュー項目15）。枠の下だと図の下の見出し
        // 「③ エタノール」とちょうど同じ高さに来て、文字が重なって両方読めなくなる。
        // 左上は選択枠の番号バッジが使うので、空いている右上へ置く
        const tag = document.createElementNS(NS, 'text');
        tag.setAttribute('x', x2 - 8);
        tag.setAttribute('y', y1 - 7);
        tag.setAttribute('text-anchor', 'end');
        tag.setAttribute('fill', 'var(--neon-orange, #ffa502)');
        tag.setAttribute('font-size', '13');
        tag.setAttribute('font-weight', '700');
        tag.setAttribute('paint-order', 'stroke');
        tag.setAttribute('stroke', 'rgba(7,9,12,0.85)');
        tag.setAttribute('stroke-width', '4');
        tag.setAttribute('pointer-events', 'none');
        tag.textContent = '⚗ 分析中';
        this.atomsGroup.appendChild(tag);
    }

    /**
     * 選択中の分子を枠・薄い塗り・番号バッジで示す（表示のみ。作図データには触れない）。
     * 番号は**選んだ順**＝式の並びで、先に選んだ方が反応後に左へ来る。
     *
     * **番号に丸数字（①②）は使わない**（レビュー項目15）。丸数字は図の下の見出し
     * `renderMoleculeLabels` が「キャンバスの通し番号」として使っていて、意味が食い違う。
     * エタノール→酢酸の順に選ぶと「見出しでは①酢酸なのに選択枠では②酢酸」になっていた。
     * こちらは塗りバッジの算用数字にして、記号そのものを分ける。
     *
     * 薄い塗りは**結合線より後ろ**（bondsGroup の先頭）に差し込む。分子が3つ4つと増えると
     * 枠線だけではどれが選ばれているか一目で読めない。
     */
    renderSelectionFrames(hidden) {
        const sets = this.selectedMoleculeSets();
        if (!sets.length) return;
        const NS = 'http://www.w3.org/2000/svg';
        sets.forEach((ids, i) => {
            const atoms = this.userMolecule.atoms
                .filter(a => ids.has(a.id) && a.element !== 'H' && !(hidden && hidden.has(a.id)));
            if (!atoms.length) return;
            const pad = 30;
            const x1 = Math.min(...atoms.map(a => a.x)) - pad;
            const x2 = Math.max(...atoms.map(a => a.x)) + pad;
            const y1 = Math.min(...atoms.map(a => a.y)) - pad;
            // 図の下には「🔍 ① 酢酸」の見出しが出るので、それを枠の中へ入れる
            // （張り出しは labelExtent が1か所で決める。DESIGN_molecule_modal.md 第1段）
            const y2 = Math.max(...atoms.map(a => a.y)) + this.labelExtent() + 12;
            const rect = (extra) => {
                const r = document.createElementNS(NS, 'rect');
                r.setAttribute('x', x1); r.setAttribute('y', y1);
                r.setAttribute('width', x2 - x1); r.setAttribute('height', y2 - y1);
                r.setAttribute('rx', '12');
                r.setAttribute('pointer-events', 'none');
                Object.entries(extra).forEach(([k, v]) => r.setAttribute(k, v));
                return r;
            };
            // 塗りは最背面（結合線の下）へ。作図の線と文字を濁らせない
            this.bondsGroup.insertBefore(
                rect({ fill: 'var(--neon-blue)', opacity: '0.09', stroke: 'none' }),
                this.bondsGroup.firstChild);
            this.atomsGroup.appendChild(rect({
                fill: 'none',
                stroke: 'var(--neon-blue)',
                'stroke-width': '2',
                'stroke-dasharray': '7,5'
            }));
            // 番号バッジ（塗りの角丸＋濃い文字）。枠の左上に載せる
            const bw = 22, bh = 20;
            const badge = document.createElementNS(NS, 'rect');
            badge.setAttribute('x', x1); badge.setAttribute('y', y1 - bh + 2);
            badge.setAttribute('width', bw); badge.setAttribute('height', bh);
            badge.setAttribute('rx', '6');
            badge.setAttribute('fill', 'var(--neon-blue)');
            badge.setAttribute('pointer-events', 'none');
            this.atomsGroup.appendChild(badge);
            const num = document.createElementNS(NS, 'text');
            num.setAttribute('x', x1 + bw / 2);
            num.setAttribute('y', y1 - bh + 2 + bh * 0.72);
            num.setAttribute('text-anchor', 'middle');
            num.setAttribute('fill', '#07090c');
            num.setAttribute('font-size', '13');
            num.setAttribute('font-weight', '700');
            num.setAttribute('pointer-events', 'none');
            num.textContent = String(i + 1);
            this.atomsGroup.appendChild(num);
            // 順番の意味は1番だけに書き添える（全部に書くと図がうるさい）
            if (i === 0 && sets.length >= 2) {
                const note = document.createElementNS(NS, 'text');
                note.setAttribute('x', x1 + bw + 5);
                note.setAttribute('y', y1 - bh + 2 + bh * 0.72);
                note.setAttribute('fill', 'var(--neon-blue)');
                note.setAttribute('font-size', '12');
                note.setAttribute('font-weight', '700');
                note.setAttribute('paint-order', 'stroke');
                note.setAttribute('stroke', 'rgba(7,9,12,0.85)');
                note.setAttribute('stroke-width', '4');
                note.setAttribute('pointer-events', 'none');
                note.textContent = '式の左';
                this.atomsGroup.appendChild(note);
            }
        });
    }

    // 指定原子をオレンジの点線円でハイライトする（次のプレビュー更新で自然に消える）。
    //
    // 半径は**その原子の自動水素まで含む大きさ**にする。17px 固定だと、自動水素
    // （中心から16px・円の半径6px＝外周22px）のちょうど上を点線が通り、輪どうしが
    // 重なって何を指しているのか読めなかった（2026-08-01 の検品指摘 C-3）。
    // 水素を持たない原子は従来どおり 17px（重原子の円は半径10px なので余裕がある）。
    highlightAtoms(atoms) {
        this.clearUIOverlay();
        const hByParent = new Map();
        this.userMolecule.calculateHydrogens().forEach(h => {
            if (!hByParent.has(h.parentId)) hByParent.set(h.parentId, []);
            hByParent.get(h.parentId).push(h);
        });
        atoms.forEach(a => {
            const hs = hByParent.get(a.id) || [];
            // いちばん遠い自動水素の外周（中心までの距離＋H円の半径6）に余白3を足す
            const reach = hs.reduce((m, h) => Math.max(m, Math.hypot(h.x - a.x, h.y - a.y)), 0);
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', a.x);
            c.setAttribute('cy', a.y);
            c.setAttribute('r', String(hs.length ? Math.round(reach + 9) : 17));
            c.setAttribute('fill', 'none');
            c.setAttribute('stroke', 'var(--neon-orange)');
            c.setAttribute('stroke-width', '2.5');
            c.setAttribute('stroke-dasharray', '4,3');
            this.uiGroup.appendChild(c);
        });
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
                                // ベンゼン頂点の実位置から外側に伸ばしたガイド点 (GRID_SIZE * 0.666 = 28px)。
                                // getSnappedCoords の step 4 と同じ式にそろえる（v510。中心からの固定距離だと
                                // 縮合で半径が 42 でない環のガイド点とずれ、置けたのに自動結合されない）
                                const sx = benzeneAtom.x + (GRID_SIZE * 0.666) * Math.cos(benzeneAtom.benzeneAngle);
                                const sy = benzeneAtom.y + (GRID_SIZE * 0.666) * Math.sin(benzeneAtom.benzeneAngle);
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
            // ダブルクリック（または右クリック）で結合の切断（削除）。
            // タッチの自前ダブルタップ検出と二重に走っても安全なようヘルパー経由で消す
            this.removeBondByGesture(bond);
        } else {
            if (!this.userMolecule.getBond(bond.atomId1, bond.atomId2)) return; // 削除済みの残クリック
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

                // 増やすには両端に十分な空き手が要る。
                // 減らす向きも「必ず安全」ではない: 硫黄の許容価標は S=O の有無で 6↔2 と
                // 文脈で変わるため、最後の S=O を単結合に落とすと used が1減るのと同時に
                // 上限が 6→2 へ落ち、差し引きで価標違反が残る（スルホ基。v331 監査で36件検出）。
                // 元素だけを見る空き手の計算では捕まらないので、変更を仮に当てて実際に検査する
                if (diff > 0 && !(free1 >= diff && free2 >= diff)) continue;
                const prevType = bond.type;
                bond.type = testType;
                const stillValid = isValencyValid(this.userMolecule, bond.atomId1) &&
                                   isValencyValid(this.userMolecule, bond.atomId2);
                bond.type = prevType;
                if (stillValid) {
                    nextType = testType;
                    found = true;
                    break;
                }
            }

            if (found && nextType !== currentType) {
                this.saveState();
                bond.type = nextType;
                this.updateDrawing();
                return;
            }
            // 行き先がひとつも無いのは、下げると価標が壊れる場合（スルホ基の最後の S=O など）。
            // 黙って効かないと「タップが拾われていない」と誤解されるので理由を出す
            if (!found && (a1.element === 'S' || a2.element === 'S')) {
                this.showToast('この結合は変えられません。スルホ基などの硫黄は S=O があってはじめて6本の手を持てるため、' +
                    'この二重結合を単結合にすると結合数が合わなくなります。');
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
        this.fitCanvasToMolecule(this.createTargetFromData(stage));
    }

    // 指定した分子が収まるように視野を合わせる。fitCanvasToTarget は「お題」に合わせるので、
    // 名称呼び出しのように**いま置いた分子**を見せたい場面ではこちらを使う
    // （ステアリン酸のような長鎖は既定の視野 360px の2倍以上あり、画面外に出てしまう）
    fitCanvasToMolecule(targetMolecule) {
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
        // 視野を合わせると縮尺が変わる。**呼び出しの直後がこれ**で、描いたあとに視野が動くため
        // 見出しのチップだけ古い倍率で残る（320px で 32px のはずの的が 19px になっていた）
        this.scheduleLabelResync();
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

/**
 * クイズの「沈んでいた出題」を直接のボタンにする配線（A-7・DESIGN_entry_points.md §6 Step 4）。
 *
 * **なぜ要るか**: D体・L体はどれ？（`#pk-kind`）・同じ？違う？（同）・タイムアタックの上級
 * （`#ta-mode`）は、モーダルを開いて `<select>` を切り替えるまで存在が見えなかった。
 * 立体まわりだけで select に 15通りが沈んでいる（設計書 §2-5）。
 *
 * **新しい出題は1つも作らない。** やるのは「select を指定の値にしてから、いつものボタンを押す」だけ。
 * 出題のロジックは quiz.js のまま ＝ ここが壊れても本体のクイズは動く。
 * ボタン側は `data-quiz-open`（開く先のボタンの id から `btn-` を除いたもの）・
 * `data-quiz-select`・`data-quiz-value` の3つで宣言する。
 */
function setupQuizShortcuts() {
    document.querySelectorAll('[data-quiz-open]').forEach(btn => {
        btn.addEventListener('click', () => {
            const sel = document.getElementById(btn.dataset.quizSelect);
            const open = document.getElementById(`btn-${btn.dataset.quizOpen}`);
            if (!sel || !open) return;
            sel.value = btn.dataset.quizValue;
            // change は投げない（open() が続けて出題するので、二重に出題させない）
            open.click();
        });
    });
}

/**
 * 深いリンク `?open=<名前>`（A-6・DESIGN_entry_points.md §6 Step 4。診断 D3）
 *
 * **なぜ要るか**: 化学レンズのハブは単元行に「パズルでみる有機化学 — **命名クイズ**」
 * 「— **反応機構ビューア**」と機能名まで書いているのに、リンクは7本とも `/assembler/` の
 * トップに着地していた。命名クイズに辿り着くには、そこから
 * **☰ → 📚 学習 → 🎓 クイズに挑戦 → 📝 命名クイズ の4手**が要る（設計書 §2-9）。
 *
 * **新しい画面は作らない。** やるのは「モードを選ぶ → アコーディオンを開く → ボタンを押す」を
 * 人の代わりに踏むだけ。押すのは既存の id なので、行き先の中身が変わっても追随する。
 *
 * 添える引数:
 * - `series=<部分一致>` … パズルのシリーズを選ぶ（ハブの単元行と対応させるため）
 * - `summon=<化合物名>` … 先に分子を呼び出す（`open=stereo` `open=isomer` は分子が要る）
 *
 * ⚠ **`?rec=` が付いているときは何もしない。** 収録の1手目を汚さないため（設計書 §6 Step 4）。
 */
const OPEN_TARGETS = {
    // モードだけ
    free: { mode: 'free' },
    puzzle: { mode: 'puzzle' },
    learn: { mode: 'learn' },
    // 📚 学習 → 🎓 クイズに挑戦（① 見比べる）
    quiz: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-quiz' },
    naming: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-naming' },
    stereoquiz: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-stereo-quiz' },
    choicequiz: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-choice-quiz' },
    // 📚 学習 → 🎓 クイズに挑戦（② 並べ替える・③ 数える）
    symbolpuzzle: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-symbol-puzzle' },
    timeattack: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-time-attack' },
    fischer: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-fischer-practice' },
    countquiz: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-count-quiz' },
    // 📚 学習 → アコーディオンを開くところまで（中で何をするかは本人が選ぶ）
    practice: { mode: 'learn', acc: 'learn-acc-practice' },
    mechanism: { mode: 'learn', acc: 'reaction-box' },
    // 🧪 自由（＝標準）で、いま描いている分子を調べる。分子が無ければボタン側が案内を出す。
    // ⚠ 📚・🧊 は分子モーダルの中へ移ったが、**行き先は1手のまま**にする（設計書 §4-2）。
    // 隠れているボタンでも `click()` は効くので、分子モーダルを開かずに相手を直接開ける
    isomer: { mode: 'free', btn: 'btn-isomers' },
    stereo: { mode: 'free', btn: 'btn-stereo' },
    // 分子モーダルそのもの（DESIGN_molecule_modal.md §5-1 の「外」経路）
    molecule: { mode: 'free', fn: () => window.game.openMoleculeModal() },
    // どこからでも: 操作ガイド
    help: { btn: 'btn-help' }
};

function applyOpenParam(search) {
    let params;
    try { params = new URLSearchParams(search); } catch (e) { return null; }
    if (params.get('rec')) return null; // 収録中は手を出さない
    const name = (params.get('open') || '').trim().toLowerCase();
    const target = OPEN_TARGETS[name];
    if (!target) return null;

    if (target.mode) window.game.setMode(target.mode);

    // シリーズの指定（部分一致）。ハブの単元名とシリーズ名は綴りが完全には一致しないので、
    // 完全一致にすると単元名を1文字変えただけで黙って効かなくなる
    const series = params.get('series');
    if (series) {
        const sel = document.getElementById('select-series');
        const hit = [...sel.options].find(o => o.value.includes(series));
        if (hit) {
            sel.value = hit.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    // 分子の指定（open=stereo / open=isomer はキャンバスが空だと調べようがない）
    const summon = params.get('summon');
    if (summon) window.game.summonMolecule(summon);

    if (target.acc) {
        const acc = document.getElementById(target.acc);
        if (acc) acc.open = true;
    }
    if (target.btn) {
        const btn = document.getElementById(target.btn);
        if (btn) btn.click();
    }
    // ボタンが無い行き先（分子モーダルはキャンバスの見出しから開くので id 付きのボタンが無い）
    if (target.fn) target.fn();
    return name;
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
        // 定数・純関数の公開（テストが同じ定義を参照できるようにする。const は window に載らない）
        window.GRID_SIZE = GRID_SIZE;
        window.CANVAS_LIMIT = CANVAS_LIMIT;
        window.moleculeMark = moleculeMark;

        window.game = new Game();
        // 反応機構ビューアの初期化（reactions.json がなければビューアは自動で隠れる）
        window.reactionPlayer = new ReactionPlayer(window.game);
        await window.reactionPlayer.load();

        // 学習クイズ（P8-3: 同じ化合物？ / P8-4: 命名）
        window.quiz = new SameCompoundQuiz(window.game);
        window.namingQuiz = new NamingQuiz(window.game);
        window.stereoQuiz = new StereoQuiz(window.game); // 立体異性体クイズ（P12-8 M2.5）
        window.countQuiz = new StereoCountQuiz(window.game); // 立体異性体の総数当て（P12-8 M2.5）
        window.fischerPractice = new FischerPractice(window.game); // フィッシャー投影の操作練習（M2.5-B）
        window.timeAttack = new StereoTimeAttack(window.game); // 立体のタイムアタック（M2.5-C）
        window.symbolPuzzle = new SymbolPuzzle(); // 記号パズル（模式模型。ORDER 第2段。分子に依存しない）
        window.choiceQuiz = new StereoChoiceQuiz(window.game); // 「同じ立体はどれ？」4択（ORDER 第3段）

        // 立体対照ビュー（P7-5-M1）
        window.stereoView = new StereoView(window.game);

        // 名称呼び出しUI（P9-1 M1）: ライブラリ確定後に候補を構築
        window.game.setupSummonUI();

        // 反応実行エンジン（P9-1 M2）
        window.reactor = new Reactor(window.game);
        // 学習ビュー（P9-3）
        window.learnView = new LearnView(window.game);
        // 異性体の書き出し練習（P12-1 M1）
        window.isomerPractice = new IsomerPractice(window.game);
        // アルキル基の書き出し練習（P12-3）
        window.alkylPractice = new AlkylPractice(window.game);
        // 立体異性体の書き出し練習（P12-8 M2.5 その4）
        window.stereoPractice = new StereoIsomerPractice(window.game);
        // 分子モーダル（DESIGN_molecule_modal.md 第1段）。
        // 中のボタン（📚 異性体・🧊 立体）を持つ学習ビュー・立体ビューの生成より**後**に配線する
        // ——「子を開く前に自分を閉じる」を捕獲フェーズで受けるので順序に依存しないが、
        // 押したときに相手が居ることを保証するため
        window.game.setupMoleculeModal();
        // チュートリアル（P9-6）
        window.tutorialPlayer = new TutorialPlayer(window.game);
        // 学習タブの「沈んでいた出題」への近道（A-7）。クイズ本体の生成より後に配線する
        setupQuizShortcuts();

        // モード初期化（P10 M1）: 前回のモードを復元。**既定は🧪自由**
        // （DESIGN_entry_points.md §8b。自由を標準にし、パズル・学習は呼び出す行き先にした）
        let savedMode = 'free';
        try { savedMode = localStorage.getItem('chemAssembler.mode') || 'free'; } catch (e) { /* noop */ }
        window.game.setMode(savedMode);
        window.game.updateReactionCard();

        // 深いリンク（A-6）。**前回のモードの復元より後**に踏む ＝ URL の指定が勝つ。
        // 収録（?rec=）のときは applyOpenParam 側で何もしない
        // 受け口の一覧はハブ側のリンクと突き合わせるためテストへ公開する（EP6）
        window.applyOpenParam = applyOpenParam;
        window.OPEN_TARGETS = OPEN_TARGETS;
        applyOpenParam(window.location.search);

        // 全データのロードと初期化が完了したことを示すフラグ（test.htmlの起動待ちに使用）
        window.appReady = true;
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
