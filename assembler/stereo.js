/**
 * 立体対照ビュー（P7-5-M1 / 設計: DESIGN_3d_correspondence.md）
 * 選択した sp3 炭素を中心に、教科書のくさび形表記（wedge-dash）で
 * 「作図は90°だが実際は正四面体（約109.5°）」であることを対照提示する。
 * パズルの作図・判定には一切影響しない別枠表示。
 *
 * P12-7 M3（DESIGN_stereochemistry.md）: 疑似3D回転ビューアを併設。
 * chemistry.js の tetrahedralDirs / parityFromDirs（Fable 実装のコア）を呼び、
 * ユーザーが実際に描いた立体（フィッシャー投影・ハース環）と一致する3D配置を回して見せる。
 * 依存ライブラリなし（自前の回転行列＋弱い透視投影＋画家のアルゴリズム）。
 *
 * P12-8: 環の「横から見る」ビュー（⬡ タブ）を併設。環を平面とみなし、環原子を z=0 の面に、
 * 環外置換基を haworthFace（無ければ描かれた縦位置）に応じて z=±d に置いた模型を、
 * カメラの倒し角 0°（描いたハース図そのもの）〜90°（真横）で連続的に見られるようにした。
 * 平面近似（いす形ではない）であることは画面に必ず明示する。
 *
 * P12-8: くさび図をフィッシャー投影の規約（縦=紙面の奥・横=紙面の手前）に作り直し、
 * chemistry.js の fischerSlots が読めた配置をそのまま描く（従来の独自形は左右が正反対で
 * 4方向が同一平面に乗り、手性を表現できなかった）。あわせて3Dビューに「回転軸」を追加し、
 * 中心炭素から各置換基へ伸びる結合を軸にした回転（ロドリゲスの回転公式）を選べるようにした。
 */

// 置換基の表示ラベル（単原子なら OH / NH2 / CH3 形式、枝なら組成式）
function substituentLabel(mol, rootId, centerId) {
    const root = mol.atoms.find(a => a.id === rootId);
    const beyond = mol.getNeighbors(rootId)
        .filter(n => n.atom.id !== centerId && n.atom.element !== 'H');
    if (beyond.length === 0) {
        const h = mol.getFreeValency(rootId);
        const sub = (n) => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        return root.element + (h > 0 ? 'H' + (h > 1 ? sub(h) : '') : '');
    }
    // よく出る官能基は組成式ではなく慣用の書き方にする（P12-8。ユーザー要望:
    // 原子を組み立てて作った -COOH が "CHO₂" と出ていた）
    const conventional = conventionalGroupLabel(mol, rootId, centerId);
    if (conventional) return conventional;
    return fragmentFormula(mol, rootId, centerId);
}

/**
 * 置換基が定番の官能基なら慣用表記（-COOH・-CHO・-CH₂OH・-C≡N など）を返す。
 * 当てはまらなければ null（呼び出し側が組成式にフォールバックする）。
 * 表示専用の処理で、判定・立体コードには一切影響しない。
 */
function conventionalGroupLabel(mol, rootId, centerId) {
    const root = mol.atoms.find(a => a.id === rootId);
    if (!root || root.element !== 'C') return null;
    const nbrs = mol.getNeighbors(rootId).filter(n => n.atom.id !== centerId);
    const heavy = nbrs.filter(n => n.atom.element !== 'H');
    const oDouble = heavy.filter(n => n.type === 2 && n.atom.element === 'O');
    const oSingle = heavy.filter(n => n.type === 1 && n.atom.element === 'O');
    const nTriple = heavy.filter(n => n.type === 3 && n.atom.element === 'N');
    const isTerminal = a => mol.getNeighbors(a.id).filter(x => x.atom.id !== rootId && x.atom.element !== 'H').length === 0;

    // -COOH（カルボキシ基）: =O ひとつと -OH ひとつ
    if (heavy.length === 2 && oDouble.length === 1 && oSingle.length === 1 &&
        isTerminal(oSingle[0].atom) && mol.getFreeValency(oSingle[0].atom.id) === 1) {
        return 'COOH';
    }
    // -CHO（アルデヒド）: =O のみで、根の炭素に水素が1つ
    if (heavy.length === 1 && oDouble.length === 1 && mol.getFreeValency(rootId) === 1) {
        return 'CHO';
    }
    // -CH₂OH（ヒドロキシメチル）: -OH のみで、根の炭素に水素が2つ
    if (heavy.length === 1 && oSingle.length === 1 && mol.getFreeValency(rootId) === 2 &&
        isTerminal(oSingle[0].atom) && mol.getFreeValency(oSingle[0].atom.id) === 1) {
        return 'CH₂OH';
    }
    // -C≡N（ニトリル）
    if (heavy.length === 1 && nTriple.length === 1 && isTerminal(nTriple[0].atom)) {
        return 'C≡N';
    }
    return null;
}

// 疑似3D表示のパラメータ（SVG座標系。x=右・y=下・z=手前が正。chemistry.js の面の向きと同じ）
// 結合を軸に回すとき、他の3置換基が中心原子の丸と重なって「その場で回っている」ように
// 見えて分かりにくかったため、**幾何（109.5°）は変えずに**中心を小さく・結合を長くして
// 円すいの動きを見えやすくした（P12-8。傘を閉じる＝角度を変える案は正しさを損なうので不採用）
const STEREO3D_BOND = 78;    // 結合の長さ
const STEREO3D_PERSP = 340;  // 弱い透視投影の視点距離（大きいほど正射影に近い）
const STEREO3D_HUB = 13;     // 中心炭素の円の半径
// 画面基準（軸を選んでいないとき）のドラッグの効き（SVG座標1単位あたりの回転角）。
// 1/結合長 ＝「手前の置換基が指と同じだけ動く」倍率で、軸を選んだときの「掴んだ置換基が
// 指に付いてくる」と同じ手ざわりになる（従来のクライアント1pxあたり 0.01rad は
// 図が縮んで表示されると効きが変わっていた。SVG座標で持てば図に対して一定）
const STEREO3D_DRAG_GAIN = 1 / STEREO3D_BOND;
// 「この置換基を掴んだ」とみなす距離（SVG座標）。置換基の楕円は半径 11〜33 x 15 なので、
// 少し外れて掴んでも取りこぼさない値にする
const STEREO3D_GRAB_R = 45;
// 回転軸を選んだときの見下ろし角（P12-8）。0 だと軸以外の2つが真上に重なって見えるので少し傾ける
const STEREO3D_AXIS_TILT = -0.42;
// 回転軸を画面上のどの向きに構えるか（P12-8。SVG座標系: x=右・y=下・z=手前が正）。
// 'away'（奥）は軸を視線方向に置く＝**ニューマン投影に近い見え方**で、
// 残り3つが 120° 間隔に開いて回る向きが読める（R/S の考え方に直結）
const STEREO3D_AXIS_FACING = {
    up: [0, -1, 0],
    away: [0, 0, -1],
    right: [1, 0, 0],
    left: [-1, 0, 0]
};

// フィッシャー投影の各スロットが指す3D方向（縦=紙面の奥・横=紙面の手前。SVG座標系で z+ が手前）。
// この4本は同一平面に乗らないので、スロット割り当てだけで手性（パリティ）が決まる。
// くさび図の並べ替えが「パリティを保つ操作」であることの根拠であり、テストの機械検証にも使う（P12-8）。
const FISCHER_SLOT_DIRS = {
    up: [0, -1, -1], right: [1, 0, 1], down: [0, 1, -1], left: [-1, 0, 1]
};
// 上を固定して残り3つが回るときの軌跡（P12-8。ユーザー要望「軌跡を円弧の投影に近づける」）。
// right/down/left の3スロットは、この楕円上でちょうど120°間隔に並ぶ（実測: 119.5/120.0/120.5°）。
// これは十字の配置が「上の結合を軸とする円すいの投影」であることの現れで、
// 角度を±120°動かせば**本物の円運動の投影＝楕円弧**の軌跡になる（直線移動より実際の動きに近い）
const WEDGE_ARC = { cx: -0.7, cy: 32.7, rx: 110.9, ry: 55.3 };
// スロットの日本語名（説明文で「どこが食い違っているか」を言葉でも示すため。P12-8）
const WEDGE_SLOT_JA = { up: '上', right: '右', down: '下', left: '左' };
// 環の「横から見る」ビューのパラメータ（P12-8）。
// 環を平面とみなし、環原子を z=0 の面に、環外置換基を face(±1) に応じて z=±depth に置く。
// カメラの倒し角 0°＝ユーザーが描いたハース図そのもの、90°＝真横（環が線に潰れる）。
const RING_VIEW_PERSP = 900;  // 弱い透視投影の視点距離（大きいほど正射影に近い。環全体を歪ませすぎない）
const RING_VIEW_RADIUS = 118; // 原点からこの半径に収まるよう模型を拡大縮小する（どの向きでも枠内）
// ラベルの当たり判定（横半径）。真横にすると同じ面の置換基が近づくので、重なったら外へずらす
const RING_LABEL_HALF = (label, k) => (9 + 4.3 * String(label).length) * k;
const RING_LABEL_STEP = 27;   // ずらす量（1段ぶん）
const RING_LABEL_STEPS = 3;   // 最大で何段までずらすか
// 面を「描かれた縦位置」から導くときの許容（chemistry.js の readRingParityFromHaworth と同じ±25°）
const RING_FACE_TOL = Math.cos(25 * Math.PI / 180);
// 環ビューの ⟲⟳ ボタン1回あたりの回転角。30°なら12回で一周し、六員環では
// 「隣の炭素が正面に来る」1/12 ずつの刻みになるので変化が読み取りやすい
const RING_YAW_STEP_DEG = 30;
// カメラの倒し角の上限（DESIGN_sugar.md §3-4 R-1）。**90° ではなく 180°** まで開けてある。
// 90° を越えると環の向こう側が見えてきて、180° で「裏返したハース図」になる。
// これは rotateZX の angleX=π ＝ (x,y,z)→(x,−y,−z) で、「上下入替」と「たどる向き逆」が
// **同時に**起きる回転（行列式 +1）＝ 分子は1つも変わらない（環をもつ糖16件で立体コード 16/16 同一）。
// ⚠ 上下だけを入れ替える（面内180°回転）と鏡像になってしまう ——「裏返し」との違いがここ。
const RING_TILT_MAX_DEG = 180;
const RING_TILT_MAX = RING_TILT_MAX_DEG * Math.PI / 180;
// 分子全体ビュー（M4a）: 模型をこの半径に収める／弱透視の視点距離
const MOL_VIEW_RADIUS = 118;
const MOL_VIEW_PERSP = 900;
// 環ビューを使えない理由（タブの無効化理由として表示する）
const RING_NO_RING_REASON =
    'この分子には環がないため「⬡ 環を横から」は使えません（環をつくると、環の上下＝α/β を横から見られます）。';
// このビューは「環を平面とみなし、置換基が上下に突き出す」模型なので、
// 平面近似が成り立たない環では使わせない（P12-8。ユーザー指摘「糖以外の環でも有効になっている」）。
//
// ⚠ v1441 で断り文を直した。**二糖は縮合環ではない**（-O- 1本でつないだ独立な2つの環）のに、
// 判定が「閉路数 ≠ 1」だったせいで縮合環と同じ文で断っていた（DESIGN_sugar.md §3-1）。
// いまは「原子を共有しているか」で割り、共有していない2つの環（二糖）は受け入れる。
const RING_FUSED_REASON =
    'この分子は2つの環が原子を共有しているため「⬡ 環を横から」は使えません' +
    '（このビューは環を平面とみなす模型なので、縮合環やスピロ環では上下の意味が決まりません）。';
const RING_MANY_REASON =
    'この分子には環が3つ以上あるため「⬡ 環を横から」は使えません' +
    '（この模型が扱えるのは、環1つか、-O- のような橋1つでつながった環2つまでです）。';
const RING_LINK_REASON =
    'この分子の2つの環は、原子1つの橋ではつながっていないため「⬡ 環を横から」は使えません' +
    '（二糖のグリコシド結合 -O- のように、環と環が1原子で結ばれている形だけを扱います）。';
const RING_BRIDGE_FACE_REASON =
    '2つの環をつなぐ橋の原子が、どちらの環から見ても上下（面）を読めないため「⬡ 環を横から」は使えません' +
    '（橋を環炭素の真上・真下に描くか、その炭素のもう1本の置換基を縦に描くと読めるようになります）。';
const RING_UNSATURATED_REASON =
    'この環は二重結合を含むため「⬡ 環を横から」は使えません' +
    '（ベンゼン環のような平面の環では、置換基が上下に出ないので横から見ても意味がありません）。';
// ⚠ **「2つの環が同じ平面にある」は仮定**（qa/KNOWLEDGE_CAVEATS.md の型。DESIGN_sugar.md §3-5）。
// 断定しないこと ——実際にはグリコシド結合 -O- のまわりが回るので相対的な向きは決まっていない。
const RING_COPLANAR_CAVEAT =
    '⚠ この図は「2つの環が同じ平面にある」と**決めて**描いています（そういう仮定で見ている図です）。' +
    '実際にはグリコシド結合 -O- のまわりが回るので、2つの環の相対的な向きは1つに決まっていません' +
    '（結晶や酵素の中では特定の向きに固定されますが、水に溶けているときは移り変わります）。' +
    'ただし上下（α/β）はどの向きでも変わらないので、この図で読める α/β は正しいままです。';

// くさび図のクリック判定領域（スロットごと。互いに重ならない矩形 [x, y, w, h]）
const WEDGE_SLOT_LAYOUT = {
    up: { lx: 0, ly: -78, hit: [-38, -104, 76, 90] },
    down: { lx: 0, ly: 88, hit: [-38, 14, 76, 90] },
    right: { lx: 96, ly: 5, hit: [42, -24, 94, 48] },
    left: { lx: -98, ly: 5, hit: [-136, -24, 94, 48] }
};

class StereoView {
    constructor(game) {
        this.game = game;
        this.picking = false; // 対象炭素の選択待ち状態
        this.modal = document.getElementById('stereo-modal');
        this.svg = document.getElementById('stereo-svg');
        this.captionEl = document.getElementById('stereo-caption');

        // P12-7 M3: 疑似3D回転ビューア
        this.titleEl = document.getElementById('stereo-title');
        this.svg3d = document.getElementById('stereo-3d-svg');
        this.noteEl = document.getElementById('stereo-3d-note');
        this.paneWedge = document.getElementById('stereo-pane-wedge');
        this.pane3d = document.getElementById('stereo-pane-3d');
        this.tabWedge = document.getElementById('btn-stereo-tab-wedge');
        this.tab3d = document.getElementById('btn-stereo-tab-3d');
        this.spinBtn = document.getElementById('btn-stereo-spin');
        this.mirrorBtn = document.getElementById('btn-stereo-mirror');
        this.axisRow = document.getElementById('stereo-axis-row'); // P12-8: 回転軸の切り替え

        // P12-8: くさび図のローテーション（クリックした枝を上へ）＋鏡像比較
        this.wedgeMirrorBtn = document.getElementById('btn-stereo-wedge-mirror');
        this.wedgeResetBtn = document.getElementById('btn-stereo-wedge-reset');
        this.wedgeNoteEl = document.getElementById('stereo-wedge-note');
        // P12-8: 枝を1原子ずつ辿って比べる表示（ユーザー要望）
        this.branchBtn = document.getElementById('btn-stereo-branches');
        this.branchNoteEl = document.getElementById('stereo-branch-note');
        if (this.branchBtn) {
            this.branchBtn.addEventListener('click', () => {
                const on = this.branchNoteEl && this.branchNoteEl.classList.contains('hidden');
                if (on) this.renderBranchCompare();
                if (this.branchNoteEl) this.branchNoteEl.classList.toggle('hidden', !on);
                this.branchBtn.textContent = on ? '🔎 枝の比較を閉じる' : '🔎 枝を辿って比べる';
            });
        }
        // P12-8 M2.5 その3: R・S の読み物からの導線。
        // **どちらが最下位かをアプリが決めているわけではない**（H は原子番号が最小なので、
        // 中心に H が付いていれば必ず最下位という一般則をそのまま使うだけ）。
        // ここでするのは**姿勢を作ること**だけで、順位づけと記号の判定は
        // chemistry.js の cipRank / assignRSDescriptor が持つ（updateRsReadout で表示する）。
        // 役割を分けているのは、姿勢は「見え方」で判定は「化学の事実」だから ——
        // 3Dビューは軸をどこへ向けても分子を変えないので、判定結果と独立でよい
        this.rsTips = document.getElementById('stereo-rs-tips');
        // R・S の判定の表示（発注書 第4段 4b の UI 側）
        this.rsRowEl = document.getElementById('stereo-rs-row');
        this.rsLetterEl = document.getElementById('stereo-rs-letter');
        this.rsWhyEl = document.getElementById('stereo-rs-why');
        this.rsFaceHBtn = document.getElementById('btn-stereo-rs-face-h');
        if (this.rsFaceHBtn) this.rsFaceHBtn.addEventListener('click', () => this.faceHydrogenAway());
        this.wedgeMirror = false;    // くさび図を鏡像と並べているか
        // P12-8: 鏡像ペインの並べ方（'symmetric' = 鏡に映したまま／'align' = 偶置換だけで極力そろえる）
        this.wedgeMirrorLayout = 'symmetric';
        this.wedgeLayoutRow = document.getElementById('stereo-wedge-layout-row');
        this.wedgeLayoutBtnSym = document.getElementById('btn-stereo-wedge-layout-symmetric');
        this.wedgeLayoutBtnAlign = document.getElementById('btn-stereo-wedge-layout-align');
        this._viewSlots = null;      // 今表示しているスロット割り当て（ref。読めない中心は null）
        this._mirrorSlots = null;    // 鏡像ペインのスロット割り当て
        this._fallbackLabels = null; // （旧）スロットが読めないときの「一例」配置のラベル
        this._provisional = false;   // 立体が読めない図に「仮の立体」を当てているか（項目23）
        this._baseSlots = null;      // 「元の並びに戻す」の戻り先（読めた図＝描いたまま／仮＝仮の初期配置）
        this._wedgeMoved = false;    // 一度でも並べ替えたか（説明の出し分け）
        this._wedgeCycled = false;   // 上を固定した巡回を使ったか（同上）

        // P12-8: 環の「横から見る」ビュー（環を平面とみなした模式図）
        this.tabRing = document.getElementById('btn-stereo-tab-ring');
        this.paneRing = document.getElementById('stereo-pane-ring');
        this.ringSvg = document.getElementById('stereo-ring-svg');
        this.ringNoteEl = document.getElementById('stereo-ring-note');
        this.ringHintEl = document.getElementById('stereo-ring-hint');
        this.ringTiltInput = document.getElementById('stereo-ring-tilt');
        this.ringTiltValueEl = document.getElementById('stereo-ring-tilt-value');
        this.ringBtnSide = document.getElementById('btn-stereo-ring-side');
        this.ringBtnHaworth = document.getElementById('btn-stereo-ring-haworth');
        this.ringBtnFlip = document.getElementById('btn-stereo-ring-flip');
        this.ringBtnH = document.getElementById('btn-stereo-ring-h');
        this.ringBtnReset = document.getElementById('btn-stereo-ring-reset');
        // P12-8 M4a: 分子全体の立体ビュー
        this.tabMol = document.getElementById('btn-stereo-tab-mol');
        this.paneMol = document.getElementById('stereo-pane-mol');
        this.molSvg = document.getElementById('stereo-mol-svg');
        this.molNoteEl = document.getElementById('stereo-mol-note');
        this.molYawValueEl = document.getElementById('stereo-mol-yaw-value');
        this.molBtnSpin = document.getElementById('btn-stereo-mol-spin');
        this.molBtnH = document.getElementById('btn-stereo-mol-h');
        this.molYaw = 0;             // 縦軸まわり
        this.molPitch = 0;           // 横軸まわり
        this.molShowH = true;        // 正四面体の4本目が見えるよう既定で表示
        this.molSpin = !StereoView.prefersReducedMotion();
        this._molModel = null;       // buildMolecule3D の結果（テストが参照する内部状態）
        this._molRaf = null;
        this._molDrag = null;
        this.ringYawValueEl = document.getElementById('stereo-ring-yaw-value');
        this.ringBtnYawCcw = document.getElementById('btn-stereo-ring-yaw-ccw');
        this.ringBtnYawCw = document.getElementById('btn-stereo-ring-yaw-cw');
        this.ringTilt = Math.PI / 2; // カメラの倒し角（0=ハース図のまま／π/2=真横）
        this.ringYaw = 0;            // 環の面に垂直な軸まわりの回転（横ドラッグ・⟲⟳ボタン）
        this.ringShowH = false;      // 環炭素の暗黙Hも描くか
        this._ringCycle = null;      // 表示中の環（原子IDを一周の順に並べたもの）
        this._ringModel = null;      // 環の3Dモデル（テストが参照する内部状態）
        this._ringDrawn = null;      // 実際に投影した画面座標（同上）
        this._ringDrag = null;
        // 二糖で「もう一方の環を裏返すか」をユーザーが手で決めたときだけ入る（null = 自動）。
        // 自動は「橋の面がそろう向き」＝ 教科書の向き（DESIGN_sugar.md §3-4 R-3）
        this._ringFlipUser = null;
        this.ringBtnFlipRing = document.getElementById('btn-stereo-ring-flipring');

        this.mode = 'wedge';   // 'wedge' | '3d' | 'ring'
        this.mirror = false;   // 鏡像と並べるモード
        // P12-8: 3Dビューの鏡像ペインの構え方
        //   'symmetric' … 本当の鏡像配置のまま（「鏡に映すとこうなる」）
        //   'align'     … 鏡像側の回転軸をオリジナルと同じ画面上の向きに合わせる
        //                 （軸を揃えても残り3つが重ならない＝非重ね合わせが直接見える）
        this.mirrorLayout = 'symmetric';
        this.mirrorLayoutRow = document.getElementById('stereo-mirror-layout-row');
        this.mirrorLayoutBtnSym = document.getElementById('btn-stereo-mirror-layout-symmetric');
        this.mirrorLayoutBtnAlign = document.getElementById('btn-stereo-mirror-layout-align');
        this.angleX = 0;       // X軸まわり（上下の傾き）
        this.angleY = 0;       // Y軸まわり（左右の回転）
        this.axisIndex = null; // 回転軸に選んだ結合（_dirs の添字。null = 画面基準）
        this.axisAngle = 0;    // 選んだ結合まわりの回転角
        this.axisFacing = 'auto'; // 軸を画面上のどの向きに構えるか（P12-8）
        this._alignM = null;      // 向きを合わせる回転行列（axisFacing が auto 以外のとき）
        this._wedgeAnimGen = 0;   // くさび図の移動アニメの世代（連打時に追い越すため）
        this._lastCycleDir = null; // 直近の巡回方向（'cw'|'ccw'）。回転方向の矢印表示に使う
        this.autoRotate = !StereoView.prefersReducedMotion();
        this._raf = null;
        this._drag = null;
        this._dirs = null;     // 基準の方向ベクトル [{ref, code, v}]（テストが参照する内部状態）
        this._drawn = null;    // 実際に描いた回転後のベクトル { left, right }（同上）
        this._parity = null;   // 描かれた立体から読めたパリティ（読めなければ null）
        this._slots = null;    // フィッシャー投影として読めたスロット（読めなければ null）
        this._isAsym = false;

        // 立体表示ボタンは「まず開く」（P12-8 ユーザー要望）。中心炭素を選ぶ操作を
        // 入り口の必須手順にすると、立体ビューにたどり着く前に止まってしまう。
        // 中心を選び直したい人はモーダル内の「別の炭素を選ぶ」から選択モードに入る
        // 分子モーダルの「🧊 立体で見る」。**見出しで選んでいる分子**を渡す
        // （分子モーダルを経由せず ?open=stereo から押されたときは、分析対象＝①が返る）
        document.getElementById('btn-stereo').addEventListener('click', () =>
            this.openAuto(this.game.moleculeModalPart ? this.game.moleculeModalPart() : null));
        this.pickBtn = document.getElementById('btn-stereo-pick');
        this.centerLabelEl = document.getElementById('stereo-center-label');
        if (this.pickBtn) this.pickBtn.addEventListener('click', () => this.startPicking());
        document.getElementById('btn-stereo-close').addEventListener('click', () => this.close());
        // 枠外（オーバーレイ部分）のクリックでも閉じる（P12-8。ユーザー要望）。
        // 中身のクリックで閉じないよう、イベントの発生元がオーバーレイ自身のときだけ閉じる
        this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
        this.tabWedge.addEventListener('click', () => this.setMode('wedge'));
        this.tab3d.addEventListener('click', () => this.setMode('3d'));
        // P12-8: 環ビューのタブと操作（環が無い分子ではタブを無効化するので click は飛ばない）
        if (this.tabRing) this.tabRing.addEventListener('click', () => this.setMode('ring'));
        if (this.ringBtnSide) this.ringBtnSide.addEventListener('click', () => this.setRingCamera('side'));
        if (this.ringBtnHaworth) this.ringBtnHaworth.addEventListener('click', () => this.setRingCamera('haworth'));
        if (this.ringBtnFlip) this.ringBtnFlip.addEventListener('click', () => this.setRingCamera('flip'));
        if (this.ringBtnFlipRing) this.ringBtnFlipRing.addEventListener('click', () => this.toggleRingFlip());
        if (this.ringBtnH) this.ringBtnH.addEventListener('click', () => this.setRingShowH(!this.ringShowH));
        if (this.ringBtnReset) this.ringBtnReset.addEventListener('click', () => this.setRingCamera('side'));
        // 縦軸まわりの回転はドラッグでもできるが、操作が見えないのでボタンでも刻む（P12-8）
        if (this.ringBtnYawCcw) this.ringBtnYawCcw.addEventListener('click', () => this.nudgeRingYaw(-RING_YAW_STEP_DEG));
        if (this.ringBtnYawCw) this.ringBtnYawCw.addEventListener('click', () => this.nudgeRingYaw(RING_YAW_STEP_DEG));
        // P12-8 M4a: 分子全体の立体ビュー
        if (this.tabMol) this.tabMol.addEventListener('click', () => this.setMode('mol'));
        const molYawCcw = document.getElementById('btn-stereo-mol-yaw-ccw');
        const molYawCw = document.getElementById('btn-stereo-mol-yaw-cw');
        if (molYawCcw) molYawCcw.addEventListener('click', () => this.nudgeMolYaw(-RING_YAW_STEP_DEG));
        if (molYawCw) molYawCw.addEventListener('click', () => this.nudgeMolYaw(RING_YAW_STEP_DEG));
        if (this.molBtnSpin) this.molBtnSpin.addEventListener('click', () => this.setMolSpin(!this.molSpin));
        if (this.molBtnH) this.molBtnH.addEventListener('click', () => this.setMolShowH(!this.molShowH));
        const molReset = document.getElementById('btn-stereo-mol-reset');
        if (molReset) molReset.addEventListener('click', () => this.resetMolView());
        this.bindMolDrag();
        if (this.ringTiltInput) {
            this.ringTiltInput.addEventListener('input', () => this.setRingTiltDeg(+this.ringTiltInput.value));
        }
        this.spinBtn.addEventListener('click', () => this.setAutoRotate(!this.autoRotate));
        this.mirrorBtn.addEventListener('click', () => this.setMirror(!this.mirror));
        this.wedgeCwBtn = document.getElementById('btn-stereo-wedge-cw');
        this.wedgeCcwBtn = document.getElementById('btn-stereo-wedge-ccw');
        if (this.wedgeCwBtn) this.wedgeCwBtn.addEventListener('click', () => this.cycleWedge('cw'));
        if (this.wedgeCcwBtn) this.wedgeCcwBtn.addEventListener('click', () => this.cycleWedge('ccw'));
        if (this.wedgeMirrorBtn) this.wedgeMirrorBtn.addEventListener('click', () => this.setWedgeMirror(!this.wedgeMirror));
        if (this.wedgeResetBtn) this.wedgeResetBtn.addEventListener('click', () => this.resetWedge());
        this.wedgeCommitBtn = document.getElementById('btn-stereo-wedge-commit');
        if (this.wedgeCommitBtn) this.wedgeCommitBtn.addEventListener('click', () => this.commitProvisional());
        // P12-8: 鏡像ペインの配置モード切替（くさび図・3D）
        if (this.wedgeLayoutBtnSym) this.wedgeLayoutBtnSym.addEventListener('click', () => this.setWedgeMirrorLayout('symmetric'));
        if (this.wedgeLayoutBtnAlign) this.wedgeLayoutBtnAlign.addEventListener('click', () => this.setWedgeMirrorLayout('align'));
        if (this.mirrorLayoutBtnSym) this.mirrorLayoutBtnSym.addEventListener('click', () => this.setMirrorLayout('symmetric'));
        if (this.mirrorLayoutBtnAlign) this.mirrorLayoutBtnAlign.addEventListener('click', () => this.setMirrorLayout('align'));
        this.svg.addEventListener('click', (e) => this.handleWedgeClick(e));
        document.getElementById('btn-stereo-reset').addEventListener('click', () => this.resetAngles());
        this.svg3d.addEventListener('dblclick', () => this.resetAngles());
        // 画面幅が変わったら（回転・リサイズ）レイアウトを組み直す（P12-8。縦横で配置が変わるため）
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (this.modal.classList.contains('hidden')) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.renderWedgeAll();
                this.render3D();
                this.renderRing();
            }, 150);
        });
        this.bindDrag();
        this.bindRingDrag();
        this.updateSpinButton();
    }

    /**
     * スマホ縦画面など横幅の狭い環境か（P12-8）。鏡像2ペインを横並びにすると各ペインが
     * 小さくなりすぎるため、この場合は上下に積むレイアウトへ切り替える
     */
    static isNarrowLayout() {
        return typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 760;
    }

    static prefersReducedMotion() {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * 立体ビューの既定の中心炭素を選ぶ（P12-8 ユーザー要望「不斉中心を選ばなくても立体に行ける」）。
     * 見どころのある炭素を優先する。① 不斉炭素（鏡像異性体の話ができる）
     * ② 重原子の置換基が多い炭素（メチル基より情報がある）③ 描いた順。
     * sp3炭素が無い分子（ベンゼン・アルケンだけ等）は null。
     */
    autoCenter(mol) {
        const sp3 = mol.atoms.filter(a => a.element === 'C' && mol.isSp3Carbon(a.id));
        if (sp3.length === 0) return null;
        const heavy = (a) => mol.getNeighbors(a.id).filter(n => n.atom.element !== 'H').length;
        const score = (a) => (mol.isAsymmetricCarbon(a.id) ? 100 : 0) + heavy(a);
        return sp3.reduce((best, a) => (score(a) > score(best) ? a : best), sp3[0]);
    }

    /**
     * 立体表示ボタン: 中心を選ばせずにそのまま開く。
     *
     * `target`（連結成分1つ）を渡すと**その分子だけ**を見る。分子モーダルの見出しで
     * 選んだ分子がここへ来る（DESIGN_molecule_modal.md §2-3。それまでは
     * 「キャンバス全部から sp3炭素を探す」しかなく、**どの分子の炭素かを選べなかった**）。
     * 渡さなければ従来どおりキャンバス全体から選ぶ。
     */
    openAuto(target) {
        this.picking = false;
        const mol = target || this.game.userMolecule;
        const atom = this.autoCenter(mol);
        if (atom) { this.show(atom); return; }
        // sp3炭素が無くても、分子全体の立体は見られる（ベンゼン・ナフタレンなど。M4c）。
        // くさび図と1炭素の3Dは中心が要るので、そのときだけ理由を出して閉じる
        this._scope = target || null;
        const model = this.buildMolModel();
        if (model && model.ok) { this.showWhole(); return; }
        this._scope = null;
        this.game.showToast('立体を見られる sp3炭素（すべて単結合の炭素）がありません。' +
            '二重結合・三重結合・芳香環の炭素は平面なので、正四面体の立体配置は決まりません。');
    }

    /**
     * 中心炭素を選ばずに「分子全体」だけを開く（P12-8 M4c）。
     * ベンゼンのように sp3炭素が1つも無い分子でも、分子全体の立体は意味がある。
     * くさび図・1炭素の3Dは中心が要るのでタブを無効化する。
     */
    showWhole() {
        // 対象の分子が指定されていれば（分子モーダルの見出しで選んだ分子）それだけを見る
        const mol = this._scope || this.game.userMolecule;
        this.mol = mol;
        this.centerId = null;
        this._parity = null;
        this._slots = null;
        this._isAsym = false;
        this.molYaw = 0;
        this.molPitch = 0;
        this.ringTilt = Math.PI / 2;
        this.ringYaw = 0;
        this._ringFlipUser = null;   // 二糖の裏返しは開くたびに自動（＝そろった向き）へ戻す
        this.buildRingModel();
        this.updateRingTabState();
        this.buildMolModel();
        this.updateMolTabState();
        const why = 'この分子には sp3炭素（すべて単結合の炭素）が無いため、1つの炭素まわりの図は描けません。';
        [this.tabWedge, this.tab3d].forEach(t => { if (t) { t.disabled = true; t.title = why; } });
        if (this.centerLabelEl) this.centerLabelEl.textContent = '分子全体を表示しています';
        if (this.pickBtn) this.pickBtn.disabled = true;
        this.updateRsTipsButton(); // 中心が無いので「H を奥に」は使えない
        this.updateRsReadout();    // 中心が無いので R・S の欄ごと隠す
        if (this.captionEl) this.captionEl.textContent = why;
        this.modal.classList.remove('hidden');
        this.setMode('mol');
    }

    // 中心炭素を選び直す（モーダル内の「別の炭素を選ぶ」から）
    startPicking() {
        this.close();
        this.picking = true;
        this.game.showToast('立体表示したい sp3炭素（すべて単結合の炭素）をキャンバスでクリックしてください。', 4000, 'success');
    }

    // キャンバスのクリック時に game 側から呼ばれる。選択モード中なら true を返して通常編集を止める
    handlePick(atom) {
        if (!this.picking) return false;
        this.picking = false;
        if (!atom || !this.game.userMolecule.isSp3Carbon(atom.id)) {
            this.game.showToast('sp3炭素（すべて単結合の炭素）を選んでください。二重・三重結合を持つ炭素や他の元素は対象外です。');
            return true;
        }
        this.show(atom);
        return true;
    }

    close() {
        this.stopSpin();
        this.stopMolSpin();
        this.modal.classList.add('hidden');
    }

    // 「いまどの炭素を中心にしているか」の表示。中心を自動で選ぶようにしたので、
    // 選び直せること・他に候補があることが分かるようにする（P12-8）
    updateCenterLabel(mol, atom) {
        if (!this.centerLabelEl) return;
        // 中心を選んで開いたときは、くさび図・3D・選び直しを使える状態に戻す
        // （分子全体だけを開いた直後に別の分子を開く場合があるため）
        [this.tabWedge, this.tab3d].forEach(t => { if (t) { t.disabled = false; t.title = ''; } });
        if (this.pickBtn) this.pickBtn.disabled = false;
        const others = mol.atoms
            .filter(a => a.element === 'C' && a.id !== atom.id && mol.isSp3Carbon(a.id)).length;
        const kind = mol.isAsymmetricCarbon(atom.id) ? '不斉炭素原子' : 'sp3炭素';
        // キャンバスに分子が2つ以上あるときは、**どの分子の炭素を見ているか**を出す。
        // 出さないと「他に sp3炭素が N 個」の N が別の分子の炭素まで数えていて紛らわしい
        // （P12-8。ユーザー要望「どの分子を対象にするか識別する仕組みが必要」）
        this.centerLabelEl.textContent = `中心の炭素: ${kind}` +
            (others > 0 ? `（他に sp3炭素が ${others} 個）` : '') +
            this.componentSuffix(atom.id);
    }

    /**
     * いまの中心炭素の R・S（と、同じ中心の D・L）を出す（発注書 第4段 4b の UI 側）。
     *
     * 判定そのものは chemistry.js の `assignRSDescriptor` / `assignDLDescriptor` が持つ。
     * ここは**出す／出さないの説明**が仕事で、判定は一切やり直さない。
     *
     * ⚠ **記号が出ないほうが普通**である。`assignRSDescriptor` はフィッシャー投影として
     * 主鎖を縦に描いた十字しか読まない（読める中心はライブラリ全体で13件）。
     * 黙って空欄にすると「壊れている」に見えるので、**出せないときは必ず理由を書く**。
     * 理由は chemistry.js:assignRSDescriptor の門番と同じ順で当てて作る
     * （不斉か → 十字に読めるか → 主鎖が縦か → 順位が付くか）。門番を直すときは
     * ここも合わせること。ST42 が「記号が出た＝判定が返った」の一致を固定している。
     */
    updateRsReadout() {
        const letterEl = this.rsLetterEl, whyEl = this.rsWhyEl;
        if (!letterEl || !whyEl) return;
        const mol = this.mol, centerId = this.centerId;
        if (this.rsRowEl) this.rsRowEl.classList.toggle('hidden', !mol || !centerId);
        if (!mol || !centerId) { letterEl.textContent = ''; whyEl.textContent = ''; return; }

        const rs = (typeof assignRSDescriptor === 'function') ? assignRSDescriptor(mol) : null;
        const hit = rs && rs[centerId];
        // **D・L は分子にひとつ、R・S は不斉炭素ごと**という違いがそのまま出る所。
        // D・L は基準炭素（アミノ酸ならα炭素・糖ならいちばん下の不斉炭素）でしか決めないので、
        // いま見ている中心とは限らない。違う炭素のものを「この炭素の D・L」として並べると
        // 嘘になるので、**並べるのは同じ中心のときだけ**にして、違うときは下の文で断る
        // （グルコースは C2 を見ていても D体。黙って消えると「出ないのは壊れているから」に見える）
        const dl = (typeof assignDLDescriptor === 'function') ? assignDLDescriptor(mol) : null;
        const dlHere = dl && dl.centerId === centerId ? dl : null;
        const dlElsewhere = dl && dl.centerId !== centerId
            ? `※ この分子ぜんたいは ${dl.letter}体 です。D・L は分子にひとつだけ、決まった炭素` +
              `（${dl.kind === 'amino' ? '-COOH の隣のα炭素' : '鎖の頭からいちばん遠い不斉炭素'}）の ` +
              `${dl.refName} が右か左かで決めるので、いま見ている炭素では決めません。` +
              'R・S は不斉炭素ごとに付く、という違いです。'
            : null;

        if (hit) {
            const names = hit.order.map(ref => this.labelOf(ref));
            letterEl.innerHTML = `<b style="color:var(--neon-green);">R・S: (${hit.letter})</b>` +
                (dlHere ? `　／　<b style="color:var(--color-cyan);">D・L: ${dlHere.letter}体</b>` : '');
            // 見かけの回り方。最下位が手前（横）にある図は、読みを裏返して記号にしている
            const seen = (hit.letter === 'R') !== hit.lowestFront ? '時計回り' : '反時計回り';
            const where = { up: '上', right: '右', down: '下', left: '左' }[hit.lowestSlot];
            const lines = [
                `優先順位は ${names.join(' ＞ ')}。最下位の ${names[3]} は${where}（紙面の` +
                (hit.lowestFront ? '手前' : '奥') + `）にあります。`,
                `残り3つ ${names.slice(0, 3).join('→')} は見かけ上${seen}なので、` +
                (hit.lowestFront
                    ? '最下位が手前にあるぶん読みを裏返して '
                    : 'そのまま読んで ') + `(${hit.letter}) です。`,
                '※ 「↻ 残り3つを回す」で並べ替えても記号は変わりません（同じ分子だから）。' +
                `「🪞 鏡像と並べる」の右側は反対の (${hit.letter === 'R' ? 'S' : 'R'}) です。`
            ];
            if (dlHere) {
                lines.push('※ D・L と R・S は別の規約です。対応が決まっているわけではなく、' +
                    'L なのに (R) になる例（システイン）もあります。');
            } else if (dlElsewhere) {
                lines.push(dlElsewhere);
            }
            whyEl.textContent = lines.join('\n');
            return;
        }

        letterEl.innerHTML = '<b style="color:var(--text-secondary);">R・S: この図では判定していません</b>' +
            (dlHere ? `　／　<b style="color:var(--color-cyan);">D・L: ${dlHere.letter}体</b>` : '');
        whyEl.textContent = this.rsUnreadableReason(mol, centerId) +
            (dlElsewhere ? '\n' + dlElsewhere : '');
    }

    /**
     * R・S を出せない理由。`assignRSDescriptor` が黙る条件を同じ順に当てて言葉にする。
     * **「直し方」まで書く**のが要点で、理由だけだと行き止まりに見える。
     */
    rsUnreadableReason(mol, centerId) {
        if (!mol.isAsymmetricCarbon(centerId)) {
            return 'この炭素は不斉炭素原子ではないので、R・S という区別そのものがありません' +
                '（同じ置換基があると、鏡に映しても重ね合わせられます）。';
        }
        if (StereoView.isRingAtom(mol, centerId)) {
            return '環の中の炭素です。R・S はフィッシャー投影の十字から読んでいるので、' +
                '環（ハース投影）の中心では判定しません。環の立体は「⬍ α/β 面マーク」と' +
                '「⬡ 環を横から」で扱います。';
        }
        const slots = (typeof fischerSlots === 'function') ? fischerSlots(mol, centerId) : null;
        if (!slots) {
            return '置換基が縦・横の軸から外れているため、フィッシャー投影として読めません。' +
                '4つの枝を上下左右に描くと読めるようになります' +
                (this._provisional ? '（下の「✓ この立体で図を確定する」でも揃えられます）' : '') + '。';
        }
        const isC = ref => ref !== 'H' && mol.atoms.find(a => a.id === ref).element === 'C';
        if (!isC(slots.up) || !isC(slots.down) || (isC(slots.left) && isC(slots.right))) {
            return '主鎖が縦に描かれていないため、判定しません。フィッシャー投影は' +
                '主鎖を縦に描く約束で、「縦が奥・横が手前」もそのときだけ成り立ちます。' +
                '十字に見えるだけの普通の構造式に記号を付けると、立体を指定していない図に' +
                '嘘の答えを出すことになります（主鎖を縦にして描き直すと判定します）。';
        }
        return '4つの枝に優先順位を付けられませんでした（辿っても差が出ない、または' +
            'R（任意のアルキル基）のように原子番号が決まらないものを含んでいます）。';
    }

    /**
     * 中心から伸びる枝を1原子ずつ辿り、どこで食い違うかを文章で出す（P12-8。ユーザー要望）。
     * 環の炭素が不斉なとき「分子式では同じに見えるのに、なぜ不斉なのか」を指せる。
     * **ここは順位づけをしない**（順位は cipRank の担当）。役割は「4本のどこで初めて
     * 食い違うか」を辿って示すことで、順位が付かない中心――環の中・同点――でも使える。
     */
    renderBranchCompare() {
        const el = this.branchNoteEl;
        if (!el) return;
        const mol = this.mol;
        const centerId = this.centerId;
        if (!mol || !centerId || typeof branchShells !== 'function') {
            el.textContent = '中心の炭素を選んでから使えます。';
            return;
        }
        const nb = mol.getNeighbors(centerId).filter(n => n.atom.element !== 'H');
        if (nb.length < 2) { el.textContent = '枝が1本以下なので比べられません。'; return; }
        const branches = nb.map(n => ({
            id: n.atom.id,
            head: n.atom.element,
            shells: branchShells(mol, n.atom.id, centerId)
        }));
        const lines = [];
        lines.push('中心から1原子ずつ外へ数えた、各層にある原子の種類です（水素は数えません）。');
        branches.forEach((b, i) => {
            const seq = b.shells.map(s => `${s.depth}:${s.text}`).join('  ');
            lines.push(`枝${i + 1}（${b.head}から）  ${seq}`);
        });
        // 総当たりで最初に食い違う層を出す
        const pairs = [];
        for (let i = 0; i < branches.length; i++) {
            for (let j = i + 1; j < branches.length; j++) {
                const d = firstDifferingShell(branches[i].shells, branches[j].shells);
                pairs.push({ i, j, d });
            }
        }
        const same = pairs.filter(p => p.d === null);
        lines.push('');
        pairs.filter(p => p.d !== null).forEach(p => {
            lines.push(`枝${p.i + 1} と 枝${p.j + 1} は 第${p.d}層 で初めて違います。`);
        });
        if (same.length) {
            same.forEach(p => lines.push(`枝${p.i + 1} と 枝${p.j + 1} は辿っても同じです（この2本が同じなら、この炭素は不斉になりません）。`));
        }
        const isAsym = mol.isAsymmetricCarbon(centerId);
        lines.push('');
        lines.push(isAsym
            ? 'この炭素は4方向すべてが異なるため不斉炭素原子です。上の「初めて違う層」が、その根拠にあたります。'
            : 'この炭素は不斉ではありません（同じ枝があります）。');
        lines.push('※ これは順位づけそのものではなく、どこで違うかを辿って示したものです。' +
            '順位から決まる R・S の記号は、上の「R・S:」の欄に出ます。');
        el.textContent = lines.join('\n');
    }

    /** 分子が2つ以上あるとき「＠〇〇（2つのうち1つめ）」のような但し書きを返す。1つなら空文字 */
    componentSuffix(atomId) {
        const parts = this.componentsInfo();
        if (parts.length < 2) return '';
        const i = parts.findIndex(p => p.ids.has(atomId));
        if (i < 0) return '';
        return ` ／ ${parts.length}つある分子のうち「${parts[i].name}」`;
    }

    /** その原子が属する分子（連結成分）。見つからなければ null（＝キャンバス全体を使う） */
    componentOf(atomId) {
        if (!this.game || typeof this.game.splitMolecules !== 'function') return null;
        return this.game.splitMolecules().find(p => p.atoms.some(a => a.id === atomId)) || null;
    }

    /** キャンバス上の分子（連結成分）ごとに、原子IDの集合と名前を返す */
    componentsInfo() {
        if (!this.game || typeof this.game.splitMolecules !== 'function') return [];
        return this.game.splitMolecules().map((part, i) => ({
            ids: new Set(part.atoms.map(a => a.id)),
            name: this.game.lookupCompoundName(part) || `分子${i + 1}`
        }));
    }

    show(atom) {
        const mol = this.game.userMolecule;
        this.mol = mol;
        this.centerId = atom.id;
        // 「🧊 分子全体」タブが見せる範囲は**中心炭素のいる分子**にする（M4a のときは
        // キャンバス全部を組んでいたので、2分子あると関係ない分子まで一緒に回っていた。
        // DESIGN_molecule_modal.md §2-3「調べる道具は分子を選べない」）
        this._scope = this.componentOf(atom.id);
        const labels = [];
        mol.getNeighbors(atom.id)
            .filter(n => n.atom.element !== 'H')
            .forEach(n => labels.push(substituentLabel(mol, n.atom.id, atom.id)));
        for (let i = 0; i < mol.getFreeValency(atom.id); i++) {
            labels.push('H');
        }

        // 描かれた立体を読む（フィッシャー投影＝非環／ハース環＝環。両者は相互排他）
        const parities = Object.assign({}, readAtomParityFromFischer(mol), readRingParityFromHaworth(mol));
        const p = parities[atom.id];
        this._parity = (p === 1 || p === -1) ? p : null;
        this._isAsym = mol.isAsymmetricCarbon(atom.id);
        this.updateCenterLabel(mol, atom);
        // 不斉中心なら「読めた立体に一致する」正四面体配置。不斉でなければ既定配置（手性は名乗らない）
        this._tetra = tetrahedralDirs(mol, atom.id, this._parity);
        this._dirs = this._tetra || this.defaultDirs(mol, atom.id);

        // くさび図はフィッシャー投影の規約（縦=紙面の奥・横=紙面の手前）で描く（P12-8）。
        // この向きなら4方向は同一平面に乗らないため、くさび図でも手性を表現できる。
        // fischerSlots が読めたら「ユーザーが描いた配置そのまま」を描く。読めない中心
        // （軸から外れた作図・環の中の炭素）は従来どおり一例として描き、その旨を明示する。
        const slots = (typeof fischerSlots === 'function') ? fischerSlots(mol, atom.id) : null;
        this._slots = slots;
        // くさび図の並べ替え状態を初期化（毎回「描いたまま」から始める）
        this.wedgeMirror = false;
        this.wedgeMirrorLayout = 'symmetric';
        this._wedgeMoved = false;
        this._wedgeCycled = false;
        this._lastCycleDir = null;
        this._mirrorSlots = null;
        if (slots) {
            this._viewSlots = Object.assign({}, slots);
            this._fallbackLabels = null;
            this._provisional = false;
        } else {
            // **立体が読めない図でも操作できるようにする**（Gemini レビュー項目23。2026-08-02）。
            // 以前はここで `_viewSlots = null` にして鏡像・回転を全部無効にしていたため、
            // フィッシャーの作図規約を知らない初学者が立体学習の入口に入れなかった。
            // いまは**仮の割り当て**を作って操作を解放し、「仮である」ことを文で明示する
            // （名前の D/L は従来どおり名乗らない＝描いていない立体を主張しない、は保つ）。
            this._viewSlots = this.provisionalSlots(mol, atom.id);
            this._fallbackLabels = null;
            this._provisional = !!this._viewSlots;
        }
        // 「⟲ 元の並びに戻す」の戻り先。読めた図なら描いたまま、仮なら仮の初期配置
        this._baseSlots = this._viewSlots ? Object.assign({}, this._viewSlots) : null;
        this.renderWedgeAll();

        // 教育文言と不斉判定の連携
        let stereoText;
        if (this._isAsym) {
            stereoText = `この炭素は不斉炭素原子です。4つの置換基（${labels.join('、')}）がすべて異なるため、鏡に映した分子とは重ね合わせられません（鏡像異性体が存在します）。`;
        } else {
            const seen = new Set();
            const dup = labels.find(l => seen.size === seen.add(l).size) ||
                        labels.find((l, i) => labels.indexOf(l) !== i);
            stereoText = `同じ置換基（${dup ?? labels[0]}）が複数あるため、この炭素は不斉炭素原子ではありません。`;
        }
        let originNote;
        if (slots) {
            originNote = '※あなたが描いた向きのまま、縦を奥・横を手前として並べています。';
            if (this._parity) originNote += 'くさび図・3Dビューとも、あなたが描いた立体を反映しています。';
            else if (!this._isAsym) originNote += 'この炭素は不斉ではないので、どう並べても同じ分子です。';
        } else if (StereoView.isRingAtom(mol, atom.id)) {
            originNote = '※環の中の炭素なので、くさび図の並びは一例です（フィッシャー投影としては読みません）。' +
                         '環の立体は「⬍ α/β 面マーク」と「🧊 3Dで回す」で確認できます。';
        } else {
            originNote = '※この描き方では立体が指定されていません（並びは一例です）。' +
                         '置換基をフィッシャー投影の軸方向（縦・横）に描くと、くさび図もその向きになります。';
        }
        this.captionEl.textContent =
            'くさび図はフィッシャー投影の規約で描いています。縦（上・下）は紙面の奥＝ハッシュ（刻み線）、横（左・右）は紙面の手前＝▶（黒いくさび）への結合です。\n' +
            '作図では90°の直交で描いていますが、実際のsp3炭素の結合角は約109.5°で、4つの置換基は正四面体の頂点方向に伸びています。\n' +
            stereoText + '\n' +
            originNote;

        // 3Dビューは毎回リセット（正面・鏡像オフ・回転軸は画面基準）してから開く
        this.mirror = false;
        this.mirrorLayout = 'symmetric';
        this.angleX = 0;
        this.angleY = 0;
        this.axisIndex = null;
        this.axisAngle = 0;
        this.updateMirrorButton();
        this.buildAxisButtons();
        this.updateRsTipsButton();
        // R・S の判定（_provisional が決まった後でないと「確定する」の案内を出し分けられない）
        this.updateRsReadout();

        // P12-8: 環ビューも毎回リセット（真横・Hなし）してから組み直す
        this.ringTilt = Math.PI / 2;
        this.ringYaw = 0;
        this.ringShowH = false;
        this._ringFlipUser = null;   // 二糖の裏返しは開くたびに自動（＝そろった向き）へ戻す
        this.buildRingModel();
        this.updateRingTabState();
        this.renderRing();
        // 分子全体の立体（M4a）。組めない分子ではタブを無効化して理由を出す
        this.molYaw = 0;
        this.molPitch = 0;
        this.buildMolModel();
        this.updateMolTabState();

        this.setMode('wedge');
        this.render3D();
        this.modal.classList.remove('hidden');
    }

    // 表示ラベル（ref は置換基の atomId または 'H'）
    labelOf(ref) {
        return ref === 'H' ? 'H' : substituentLabel(this.mol, ref, this.centerId);
    }

    // 不斉でない中心（メタン等）の既定の正四面体配置。手性は意味を持たない
    defaultDirs(mol, atomId) {
        const refs = mol.getNeighbors(atomId)
            .filter(n => n.atom.element !== 'H')
            .map(n => n.atom.id);
        for (let i = 0; i < mol.getFreeValency(atomId); i++) refs.push('H');
        if (refs.length !== 4) return null;
        const items = refs.map(ref => ({
            ref,
            code: ref === 'H' ? 'H' : rootedFragmentCode(mol, ref, atomId)
        }));
        items.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
        const V = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
        const norm = v => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; };
        return items.map((it, i) => ({ ref: it.ref, code: it.code, v: norm(V[i]) }));
    }

    // ===== くさび図（P12-8: フィッシャー投影の規約＋ローテーション／鏡像比較） =====

    /**
     * フィッシャー投影で「許される」並べ替え（P12-8）。
     * key に指定したスロットの中身が up に来るように、スロットの中身を動かした新しい割り当てを返す。
     *   up   : 何もしない（恒等）
     *   down : 180°回転 = (up down)(left right) … 転置2回＝偶置換
     *   right: left を固定した3巡回 up→down→right→up … 偶置換
     *   left : right を固定した3巡回 up→down→left→up … 偶置換
     * すべて偶置換なので parityFromDirs（＝手性）は不変＝表示中の分子は変わらない。
     * 逆に、90°回転や2つの入れ替え（奇置換）は鏡像異性体にすり替わるので絶対に使わない。
     */
    static rotateSlotsTo(slots, key) {
        const s = slots;
        if (key === 'down') return { up: s.down, right: s.left, down: s.up, left: s.right };
        if (key === 'right') return { up: s.right, right: s.down, down: s.up, left: s.left };
        if (key === 'left') return { up: s.left, right: s.right, down: s.up, left: s.down };
        return { up: s.up, right: s.right, down: s.down, left: s.left };
    }

    /**
     * 上の枝を固定したまま、残りの3つ（右・下・左）を巡回させる（P12-8。ユーザー要望）。
     * 3巡回は偶置換なので**パリティは不変＝分子は変わらない**。
     * dir='cw'（右回り）: right→down→left→right ／ dir='ccw'（左回り）はその逆。
     * どちらも偶置換なので両方向とも化学的に正しい（3回続けると元の並びに戻る）。
     * 「固定した1つ以外の3つの巡回順（＝手性）は変わらない」ことを体感させるのが目的で、
     * R/S 判定（最下位を奥に置いて残り3つの回る向きを読む）の考え方に直結する。
     */
    static cycleOthers(slots, dir) {
        const s = slots;
        if (dir === 'ccw') return { up: s.up, right: s.down, down: s.left, left: s.right };
        return { up: s.up, right: s.left, down: s.right, left: s.down }; // cw
    }

    /**
     * 鏡像: スロットの入れ替え1回（転置＝奇置換）→ パリティが反転する＝鏡像異性体。
     *
     * 既定は左右の入れ替え。ただし**左右が同じ置換基だと絵が1ミリも変わらない**
     * （2-プロパノールは左右とも CH₃）。鏡に映したのに同じ図が出るので、
     * 「鏡像を作った」という操作そのものが画面から消えてしまう
     * （2026-08-01 の検品指摘 B-2。V10 でこれを踏んだ）。
     *
     * そこで codeOf（置換基の中身を比べる関数）が渡されたときは、
     * **見た目が実際に変わる入れ替えを選ぶ**。転置はどれも奇置換なので、
     * どの2つを入れ替えても得られるのは同じ鏡像異性体＝化学的には等価。
     * すべての転置で絵が変わらない場合（4つとも同じ置換基）は左右のまま返す。
     */
    static mirrorSlots(slots, codeOf) {
        const swap = (a, b) => {
            const out = Object.assign({}, slots);
            out[a] = slots[b];
            out[b] = slots[a];
            return out;
        };
        const leftRight = swap('left', 'right');
        if (typeof codeOf !== 'function') return leftRight;
        const K = ['up', 'right', 'down', 'left'];
        const visible = s => K.some(k => codeOf(s[k]) !== codeOf(slots[k]));
        if (visible(leftRight)) return leftRight;
        // 左右が同じ中身だったとき: 上下 → 上と左右 → 下と左右 の順に、見た目が変わるものを採る
        for (const [a, b] of [['up', 'down'], ['up', 'left'], ['up', 'right'],
                              ['down', 'left'], ['down', 'right']]) {
            const cand = swap(a, b);
            if (visible(cand)) return cand;
        }
        return leftRight;
    }

    /**
     * 「許される並べ替え」だけで到達できる配置をすべて列挙する（P12-8）。
     * 生成元は rotateSlotsTo（180°回転・1つを固定した3巡回）と cycleOthers（上を固定した3巡回）だけ、
     * すなわち**偶置換のみ**なので、ここに現れる配置はすべて元と同じ分子（パリティ不変）。
     * 置換基がすべて異なれば 12 通り（＝4文字の偶置換 A4 の位数）になる。
     * 「どれだけ回しても鏡像には一致しない」ことを総当たりで示すための土台。
     */
    static evenArrangements(slots) {
        const K = ['up', 'right', 'down', 'left'];
        const key = s => K.map(k => String(s[k])).join('|');
        const out = [Object.assign({}, slots)];
        const seen = new Set([key(slots)]);
        for (let i = 0; i < out.length; i++) {
            const cur = out[i];
            const next = [
                StereoView.rotateSlotsTo(cur, 'down'),
                StereoView.rotateSlotsTo(cur, 'right'),
                StereoView.rotateSlotsTo(cur, 'left'),
                StereoView.cycleOthers(cur, 'cw'),
                StereoView.cycleOthers(cur, 'ccw')
            ];
            next.forEach(s => {
                const k = key(s);
                if (!seen.has(k)) { seen.add(k); out.push(s); }
            });
        }
        return out;
    }

    /**
     * slots を（偶置換だけで）target にできるだけ近づけた配置を返す（P12-8）。
     * idOf は「同じ中身とみなす鍵」（既定は ref そのもの。呼び出し側は正準コードを渡して
     * 化学的に等価な枝＝同じ、として比べる）。
     * slots が target の鏡像（奇置換ぶん違う）なら、一致するスロットは最大でも2つにしかならない
     * （奇置換の不動点は転置の2個が最大・4巡回は0個）。この「必ず残る食い違い」が
     * 「鏡像異性体は回転では重ね合わせられない」ことの証拠になる。
     */
    static bestAlignedArrangement(slots, target, idOf) {
        const K = ['up', 'right', 'down', 'left'];
        const id = idOf || (r => String(r));
        const all = StereoView.evenArrangements(slots);
        let best = all[0], bestScore = -1;
        all.forEach(s => {
            const n = K.filter(k => id(s[k]) === id(target[k])).length;
            // 同点なら「上（基準として読みやすい位置）が一致するもの」を選ぶ
            const score = n * 10 + (id(s.up) === id(target.up) ? 1 : 0);
            if (score > bestScore) { bestScore = score; best = s; }
        });
        return best;
    }

    // スロットの中身を「化学的に等価かどうか」で比べるための鍵（同じ枝は同じコードになる）
    slotCode(ref) {
        if (ref === 'H' || ref === undefined || ref === null) return 'H';
        return typeof rootedFragmentCode === 'function'
            ? rootedFragmentCode(this.mol, ref, this.centerId) : String(ref);
    }

    // 鏡像ペインを「並びを揃える」モードで作る（偶置換だけで viewSlots に最接近させる）
    alignedMirrorFor(viewSlots) {
        const base = StereoView.mirrorSlots(viewSlots);
        return StereoView.bestAlignedArrangement(base, viewSlots, r => this.slotCode(r));
    }

    // 現在の左右のくさび図で中身が食い違っているスロット（不斉中心なら必ず2つ残る）
    wedgeMismatchSlots() {
        if (!this._viewSlots || !this._mirrorSlots) return [];
        return ['up', 'right', 'down', 'left']
            .filter(k => this.slotCode(this._mirrorSlots[k]) !== this.slotCode(this._viewSlots[k]));
    }

    // 「並びを揃える」モードで鏡像を表示中か（このとき操作は両ペインへ同じように掛ける）
    isWedgeAligned() {
        return this.wedgeMirror && !!this._mirrorSlots && this.wedgeMirrorLayout === 'align';
    }

    /** 鏡像ペインの並べ方を切り替える（P12-8。'symmetric' | 'align'） */
    setWedgeMirrorLayout(mode) {
        this.wedgeMirrorLayout = mode === 'align' ? 'align' : 'symmetric';
        if (this._viewSlots && this.wedgeMirror) {
            // どちらのモードでも鏡像（＝奇置換ぶん違う配置）であることは変えない。
            // symmetric は左右入れ替えそのもの、align はそれを偶置換で揃え直しただけ
            this._mirrorSlots = this.wedgeMirrorLayout === 'align'
                ? this.alignedMirrorFor(this._viewSlots)
                : StereoView.mirrorSlots(this._viewSlots, r => this.slotCode(r));
        }
        this._lastCycleDir = null;
        this.renderWedgeAll();
    }

    // スロット割り当てを parityFromDirs に渡せる形（{ref, code, v}）にする。
    // v はフィッシャー規約の3D方向。並べ替えの正しさ（パリティ不変）の機械検証に使う
    slotDirs(slots) {
        if (!slots || !this.mol) return null;
        return ['up', 'right', 'down', 'left'].map(k => ({
            ref: slots[k],
            code: slots[k] === 'H' ? 'H' : rootedFragmentCode(this.mol, slots[k], this.centerId),
            v: FISCHER_SLOT_DIRS[k]
        }));
    }

    // 表示中のくさび図のパリティ（which: 'left'=あなたの分子 / 'right'=鏡像）
    wedgeParity(which) {
        const dirs = this.slotDirs(which === 'right' ? this._mirrorSlots : this._viewSlots);
        return dirs && typeof parityFromDirs === 'function' ? parityFromDirs(dirs) : null;
    }

    // くさび図のクリック: その置換基が上に来るように並べ替える（パリティを保つ偶置換のみ）
    handleWedgeClick(e) {
        if (!this._viewSlots) return; // 立体未指定・環中心では並べ替えない
        const el = e.target && e.target.closest ? e.target.closest('[data-slot]') : null;
        if (!el) return;
        const slot = el.getAttribute('data-slot');
        if (!slot || !WEDGE_SLOT_LAYOUT[slot]) return;
        const paneEl = el.closest('[data-pane]');
        const pane = paneEl ? paneEl.getAttribute('data-pane') : 'left';
        if (slot === 'up') {
            // 上はすでに上にあるので、代わりに**上を固定して残りの3つを巡回**させる（P12-8）。
            // これも偶置換なので分子は変わらず、「固定した1つ以外の巡回順は変わらない」＝
            // R/S の考え方（最下位を奥にして残り3つの回る向きを読む）の土台になる
            // 「並びを揃える」モードでは両ペインを揃えたまま動かす
            this.cycleWedge('cw', this.isWedgeAligned() ? undefined : pane);
            return;
        }
        this.rotateWedge(pane, slot);
    }

    rotateWedge(pane, slot) {
        if (!this._viewSlots || !WEDGE_SLOT_LAYOUT[slot]) return false;
        const target = pane === 'right' ? this._mirrorSlots : this._viewSlots;
        if (!target) return false;
        // 「並びを揃える」モードでは、同じ**位置の**並べ替え（rotateSlotsTo は key だけで決まる
        // 位置の置換）を両ペインに掛ける。一致しているスロットの組はそのまま保たれるので、
        // 揃えた関係（＝食い違いが2か所だけ）を崩さずに回せる
        const both = this.isWedgeAligned();
        const beforeLeft = Object.assign({}, this._viewSlots);
        const beforeRight = this._mirrorSlots ? Object.assign({}, this._mirrorSlots) : null;
        if (both || pane !== 'right') this._viewSlots = StereoView.rotateSlotsTo(this._viewSlots, slot);
        if ((both || pane === 'right') && this._mirrorSlots) {
            this._mirrorSlots = StereoView.rotateSlotsTo(this._mirrorSlots, slot);
        }
        this._wedgeMoved = true;
        this._lastCycleDir = null; // 「上へ持ってくる」操作は巡回ではないので方向表示は消す
        // どの枝がどこへ動いたかをアニメーションで見せる（両ペインを1回のループで同時に動かす）
        const plans = [];
        if (both || pane !== 'right') plans.push({ pane: 'left', from: beforeLeft, to: this._viewSlots });
        if ((both || pane === 'right') && beforeRight && this._mirrorSlots) {
            plans.push({ pane: 'right', from: beforeRight, to: this._mirrorSlots });
        }
        this.animateWedgeMove(plans);
        return true;
    }

    /**
     * 上の枝を固定して残りの3つを巡回させる（P12-8。ユーザー要望）。
     * pane を省略すると両方のペイン（自分と鏡像）に同じ向きの巡回を適用する。
     * cw / ccw どちらも偶置換なので分子は変わらない（3回で元に戻る）。
     */
    cycleWedge(dir, pane) {
        if (!this._viewSlots) return false;
        if (this.isWedgeAligned()) pane = undefined; // 揃えたまま動かす（両ペインに同じ巡回）
        const beforeLeft = Object.assign({}, this._viewSlots);
        const beforeRight = this._mirrorSlots ? Object.assign({}, this._mirrorSlots) : null;
        if (!pane || pane === 'left') this._viewSlots = StereoView.cycleOthers(this._viewSlots, dir);
        if ((!pane || pane === 'right') && this._mirrorSlots) {
            this._mirrorSlots = StereoView.cycleOthers(this._mirrorSlots, dir);
        }
        this._wedgeMoved = true;
        this._wedgeCycled = true;
        this._lastCycleDir = dir; // 回転方向の明示（弧矢印）に使う
        // 移動をアニメーションで見せる（どれがどこへ動いたかを追えるように）
        const cyclePlans = [];
        if (!pane || pane === 'left') cyclePlans.push({ pane: 'left', from: beforeLeft, to: this._viewSlots });
        if ((!pane || pane === 'right') && beforeRight && this._mirrorSlots) {
            cyclePlans.push({ pane: 'right', from: beforeRight, to: this._mirrorSlots });
        }
        this.animateWedgeMove(cyclePlans);
        return true;
    }

    /**
     * 立体が読めない図のための**仮のスロット割り当て**（項目23）。
     * 置換基を「ラベルの長い順・同じなら文字順」で 上→下→右→左 に置く。
     * 以前この並びで「一例」の絵だけを描いていたので、**見た目は今までと同じ**まま、
     * 中身を ref（原子IDまたは 'H'）にして操作できるようにしたもの。
     * sp3 でない・置換基が4つに満たない中心では null（そこは操作を解放しない）。
     */
    provisionalSlots(mol, centerId) {
        const heavy = mol.getNeighbors(centerId).filter(n => n.atom.element !== 'H');
        const free = mol.getFreeValency(centerId);
        if (heavy.length + free !== 4) return null;
        const refs = heavy
            .map(n => ({ ref: n.atom.id, label: substituentLabel(mol, n.atom.id, centerId) }))
            .concat(Array.from({ length: free }, () => ({ ref: 'H', label: 'H' })))
            .sort((a, b) => b.label.length - a.label.length || a.label.localeCompare(b.label));
        return { up: refs[0].ref, down: refs[1].ref, right: refs[2].ref, left: refs[3].ref };
    }

    /**
     * 「✓ この立体で図を確定する」（項目23）。いま画面に出ている仮の立体のとおりに、
     * **キャンバスの図そのもの**を書き換えて確定させる。置換基の枝を中心まわりに剛体回転で
     * 動かし、根の原子をフィッシャー投影の十字（縦・横）へ乗せる。
     *
     * **自動ではやらない。** 見たいだけで開いた人の作図が黙って変わるのは乱暴だし、
     * 角度を揃える処理は重なりや貫通を起こしうるため（v352 の整形で踏んだのと同種）。
     * 押したときだけ実行し、**書き換えた図から立体を読み直して**、狙いどおりの並びに
     * なっていること・原子が重なっていないことを確かめてから確定する。だめなら何もしない。
     */
    commitProvisional() {
        if (!this._provisional || !this._viewSlots) return false;
        const mol = this.game.userMolecule;
        const center = mol.atoms.find(a => a.id === this.centerId);
        if (!center) return false;
        const step = 42; // 作図グリッド
        const DIR = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

        // 枝（中心を通らずに届く原子）を集める
        const branchOf = (rootId) => {
            const seen = new Set([this.centerId, rootId]);
            const stack = [rootId], out = [rootId];
            while (stack.length) {
                mol.getNeighbors(stack.pop()).forEach(n => {
                    if (n.atom.element === 'H' || seen.has(n.atom.id)) return;
                    seen.add(n.atom.id); out.push(n.atom.id); stack.push(n.atom.id);
                });
            }
            return out;
        };

        const moves = new Map(); // atomId → {x,y}
        const used = new Set();
        for (const slot of ['up', 'right', 'down', 'left']) {
            const ref = this._viewSlots[slot];
            if (ref === 'H' || ref === undefined) continue; // 暗黙の H は動かすものが無い
            const root = mol.atoms.find(a => a.id === ref);
            if (!root) return false;
            const dx = root.x - center.x, dy = root.y - center.y;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) return false;
            // いまの向き → スロットの向き への回転（枝の形は変えない）
            const [tx, ty] = DIR[slot];
            const cos = (dx * tx + dy * ty) / len;
            const sin = (dx * ty - dy * tx) / len; // 回転角の符号は「現在 → 目標」
            for (const id of branchOf(ref)) {
                if (used.has(id)) return false; // 枝が共有されている＝環を含む
                used.add(id);
                const a = mol.atoms.find(x => x.id === id);
                const px = a.x - center.x, py = a.y - center.y;
                moves.set(id, {
                    x: Math.round(center.x + px * cos + py * sin),
                    y: Math.round(center.y - px * sin + py * cos)
                });
            }
            // 根はきっちり軸上の1刻みに置き直す（±25°の許容ではなく、ぴったり合わせる）
            moves.set(ref, { x: center.x + tx * step, y: center.y + ty * step });
        }
        if (!moves.size) return false;

        // 当ててみて、重なりが無く・狙いどおりに読めることを確かめる
        const before = mol.atoms.map(a => ({ id: a.id, x: a.x, y: a.y }));
        this.game.saveState(); // ↩ 戻す で元に戻せるようにする
        moves.forEach((p, id) => {
            const a = mol.atoms.find(x => x.id === id);
            if (a) { a.x = p.x; a.y = p.y; }
        });
        const tooClose = mol.atoms.some((a, i) =>
            mol.atoms.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < 21));
        const after = (typeof fischerSlots === 'function') ? fischerSlots(mol, this.centerId) : null;
        const same = after && ['up', 'right', 'down', 'left']
            .every(k => after[k] === this._viewSlots[k]);
        if (tooClose || !same) {
            before.forEach(p => {
                const a = mol.atoms.find(x => x.id === p.id);
                if (a) { a.x = p.x; a.y = p.y; }
            });
            if (this.game.history && this.game.history.length) this.game.history.pop();
            if (this.wedgeNoteEl) {
                this.wedgeNoteEl.textContent =
                    'この図はこのままでは十字に並べられませんでした（置換基どうしが重なります）。' +
                    'キャンバスで枝を少し動かしてから、もう一度お試しください。';
            }
            return false;
        }
        this.game.updateDrawing();
        this.show(center); // 書き換えた図から読み直す＝仮ではなく「描いた立体」になる
        return true;
    }

    // 「⟲ 元の並びに戻す」: 描いたときの並び（読めなければ仮の初期配置）に戻す
    resetWedge() {
        const base = this._slots || this._baseSlots;
        if (!base) return;
        this._viewSlots = Object.assign({}, base);
        this._mirrorSlots = this.wedgeMirrorLayout === 'align'
            ? this.alignedMirrorFor(this._viewSlots)
            : StereoView.mirrorSlots(base, r => this.slotCode(r));
        this._wedgeMoved = false;
        this._wedgeCycled = false;
        this._lastCycleDir = null;
        this.renderWedgeAll();
    }

    setWedgeMirror(on) {
        if (!this._viewSlots) { this.wedgeMirror = false; this.renderWedgeAll(); return; }
        this.wedgeMirror = !!on;
        if (this.wedgeMirror) {
            if (this.wedgeMirrorLayout === 'align') {
                this._mirrorSlots = this.alignedMirrorFor(this._viewSlots);
            } else if (!this._mirrorSlots) {
                this._mirrorSlots = StereoView.mirrorSlots(this._viewSlots, r => this.slotCode(r));
            }
        }
        this.renderWedgeAll();
    }

    // くさび図全体を描く（鏡像モードなら「あなたの分子」と「🪞 鏡像」を左右に並べる）
    /**
     * 並べ替えアニメの補間（純関数。P12-8）。スロット a から b へ動く途中 e∈[0,1] の、
     * **最終位置 b からのずれ**を返す（要素は b に描かれているので、それをずらして途中を表す）。
     * 直線だと中心を横切って見分けづらいため、進行方向に垂直へ膨らませて弧にする。
     * e=0 で a の位置、e=1 でずれ0（＝b の位置）。rAF に依存せず検証できるよう切り出してある。
     */
    static wedgeTweenOffset(a, b, e, fromSlot, toSlot) {
        // right/down/left どうしの移動は「上の結合を軸にした円すいの回転」なので、
        // その投影＝楕円弧に沿って動かす（P12-8。直線だと実際の動きから離れて見える）
        const arc = StereoView.wedgeArcPath(fromSlot, toSlot, e);
        if (arc) {
            // 端点は必ずスロット位置に一致させる（楕円は近似なので、ずれを線形に打ち消す）
            const p0 = StereoView.wedgeArcPath(fromSlot, toSlot, 0);
            const p1 = StereoView.wedgeArcPath(fromSlot, toSlot, 1);
            const x = arc.x + (1 - e) * (a.lx - p0.x) + e * (b.lx - p1.x);
            const y = arc.y + (1 - e) * (a.ly - p0.y) + e * (b.ly - p1.y);
            return { dx: x - b.lx, dy: y - b.ly };
        }
        // 上との出入り（クリックで上へ持ってくる操作）は円すいの回転ではないので、
        // 進行方向に垂直へ膨らませた弧で見せる
        const dx = b.lx - a.lx, dy = b.ly - a.ly;
        const len = Math.hypot(dx, dy) || 1;
        const bulge = Math.sin(Math.PI * e) * 20;
        const x = a.lx + dx * e + (-dy / len) * bulge;
        const y = a.ly + dy * e + (dx / len) * bulge;
        return { dx: x - b.lx, dy: y - b.ly };
    }

    /** スロットの楕円上の角度（ラジアン）。right/down/left のみ。上は軸なので対象外 */
    static wedgeArcAngle(slot) {
        const lay = WEDGE_SLOT_LAYOUT[slot];
        if (!lay || slot === 'up') return null;
        return Math.atan2((lay.ly - WEDGE_ARC.cy) / WEDGE_ARC.ry, (lay.lx - WEDGE_ARC.cx) / WEDGE_ARC.rx);
    }

    /**
     * from → to の楕円弧上の点（e∈[0,1]）。3スロットは120°間隔なので、
     * 近いほうの回り（±120°）でつなぐ＝実際の円すい回転と同じ向きになる。
     * 上が絡む移動は null（円すいの回転ではないため）。
     */
    static wedgeArcPath(fromSlot, toSlot, e) {
        const a0 = StereoView.wedgeArcAngle(fromSlot);
        const a1 = StereoView.wedgeArcAngle(toSlot);
        if (a0 === null || a1 === null) return null;
        let d = a1 - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const th = a0 + d * e;
        return {
            x: WEDGE_ARC.cx + WEDGE_ARC.rx * Math.cos(th),
            y: WEDGE_ARC.cy + WEDGE_ARC.ry * Math.sin(th)
        };
    }

    /**
     * 並べ替えを**アニメーションで見せる**（P12-8。ユーザー要望「変化が分かりづらい」）。
     * 各置換基のラベルが「元のスロット → 新しいスロット」へ弧を描いて移動するのを見せてから、
     * 通常の描画に戻す。表示だけの演出で、スロットの中身（＝分子）は呼び出し前に確定している。
     * prefers-reduced-motion の環境ではアニメを省いて即座に描き直す。
     * dir を渡すと回転方向（cw/ccw）の弧矢印も一緒に出す。
     */
    animateWedgeMove(plans) {
        this.renderWedgeAll();
        if (StereoView.prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return;
        // 鏡像と並べているときは**両ペインを同時に**動かす（P12-8。ユーザー要望）。
        // 以前はペインごとに呼んでいたため、内側の renderWedgeAll が DOM を作り直して
        // 先に始めたアニメが宙に浮き、片方しか動かなかった
        const els = [];
        (plans || []).forEach(plan => {
            if (!plan || !plan.from || !plan.to) return;
            const paneEl = this.svg.querySelector(`[data-pane="${plan.pane}"]`);
            if (!paneEl) return;
            const fromOf = {};
            ['up', 'right', 'down', 'left'].forEach(k => { fromOf[String(plan.from[k])] = k; });
            ['up', 'right', 'down', 'left'].forEach(k => {
                const src = fromOf[String(plan.to[k])];
                if (!src || src === k) return;
                const el = paneEl.querySelector(`text[data-slot="${k}"]`);
                if (el) els.push({ el, a: WEDGE_SLOT_LAYOUT[src], b: WEDGE_SLOT_LAYOUT[k], from: src, to: k });
            });
        });
        if (!els.length) return;
        const gen = ++this._wedgeAnimGen;
        const dur = 420;
        const start = performance.now();
        const step = (now) => {
            if (this._wedgeAnimGen !== gen) return; // 次の操作に追い越された
            const t = Math.min(1, (now - start) / dur);
            const e = t * t * (3 - 2 * t); // smoothstep
            els.forEach(({ el, a, b, from, to }) => {
                const o = StereoView.wedgeTweenOffset(a, b, e, from, to);
                el.setAttribute('transform', `translate(${o.dx}, ${o.dy})`);
                el.setAttribute('opacity', String(0.55 + 0.45 * e));
            });
            if (t < 1) requestAnimationFrame(step);
            else els.forEach(({ el }) => { el.removeAttribute('transform'); el.removeAttribute('opacity'); });
        };
        requestAnimationFrame(step);
    }

    /**
     * 現在の回転方向（右回り／左回り）を弧矢印で示す（P12-8。ユーザー要望「回転方向を明示したい」）。
     * 上の枝は固定なので、弧は残り3つが通る右・下・左の側だけを回る形にする。
     */
    drawCycleArrow(paneCx, dir, paneCy = 0) {
        const NS = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('data-cycle-arrow', dir);
        g.setAttribute('pointer-events', 'none');
        // 3つの移動それぞれの軌跡に沿って矢印を出す（P12-8。ユーザー要望「3か所表示」）。
        // 軌跡は移動アニメと同じ楕円弧なので、実際に動く道筋の上に矢印が乗る
        const order = dir === 'cw' ? [['right', 'down'], ['down', 'left'], ['left', 'right']]
                                   : [['down', 'right'], ['left', 'down'], ['right', 'left']];
        order.forEach(([from, to]) => {
            // 弧の中ほど（15%〜75%）だけを描いて、ラベルと重ならないようにする
            const pts = [];
            for (let i = 0; i <= 10; i++) {
                const e = 0.15 + (0.75 - 0.15) * (i / 10);
                const pt = StereoView.wedgeArcPath(from, to, e);
                if (pt) pts.push([paneCx + pt.x, paneCy + pt.y]);
            }
            if (pts.length < 2) return;
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', 'M ' + pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L '));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'var(--neon-purple)');
            path.setAttribute('stroke-width', '2.5');
            path.setAttribute('stroke-dasharray', '6 4');
            path.setAttribute('opacity', '0.9');
            path.setAttribute('data-arc', from + '-' + to);
            g.appendChild(path);
            // 矢尻は弧の終端で、進行方向（接線）を向ける
            const last = pts[pts.length - 1], prev = pts[pts.length - 2];
            const deg = Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180 / Math.PI;
            const head = document.createElementNS(NS, 'path');
            head.setAttribute('d', 'M 0 0 L -10 4.5 L -10 -4.5 Z');
            head.setAttribute('fill', 'var(--neon-purple)');
            head.setAttribute('transform', 'translate(' + last[0].toFixed(1) + ', ' + last[1].toFixed(1) + ') rotate(' + deg.toFixed(1) + ')');
            g.appendChild(head);
        });
        const cap = document.createElementNS(NS, 'text');
        cap.setAttribute('x', paneCx);
        cap.setAttribute('y', paneCy + 126);
        cap.setAttribute('text-anchor', 'middle');
        cap.setAttribute('fill', 'var(--neon-purple)');
        cap.setAttribute('font-size', '11');
        cap.textContent = dir === 'cw' ? '↻ 右回りに移動しました' : '↺ 左回りに移動しました';
        g.appendChild(cap);
        this.svg.appendChild(g);
    }

    renderWedgeAll() {
        const NS = 'http://www.w3.org/2000/svg';
        this.svg.innerHTML = '';
        const two = this.wedgeMirror && !!this._viewSlots && !!this._mirrorSlots;
        // 2ペインのときは viewBox が倍幅になるぶん SVG の実寸も広げる（P12-8。ユーザー指摘:
        // 鏡像と並べると縮小されて読みづらい）。max-width:100% があるので、画面が狭ければ
        // 自動的に収まる範囲まで縮む＝従来より小さくなることはない
        // スマホ縦画面では横並びだと各ペインが小さくなるので**上下に積む**（P12-8。ユーザー指摘）
        const stacked = two && StereoView.isNarrowLayout();
        // 広い画面では図の左に操作と解説を置く2カラムにしているが、2ペインのときは図が612pxに
        // 広がって右カラムが痩せ、解説が縦に伸びる。図が広いときは1カラムに戻す（CSS側で判定）
        if (this.paneWedge) this.paneWedge.classList.toggle('wide-figure', two);
        if (stacked) {
            this.svg.setAttribute('viewBox', '-165 -300 330 600');
            this.svg.setAttribute('width', 330);
            this.svg.setAttribute('height', 600);
        } else {
            this.svg.setAttribute('viewBox', two ? '-306 -142 612 292' : '-165 -150 330 300');
            this.svg.setAttribute('width', two ? 612 : 330);
            this.svg.setAttribute('height', two ? 292 : 300);
        }
        const interactive = !!this._viewSlots;
        const labelsOf = (slots) => ({
            up: this.labelOf(slots.up), right: this.labelOf(slots.right),
            down: this.labelOf(slots.down), left: this.labelOf(slots.left)
        });
        // 「並びを揃える」モードでは、揃えきれずに残った食い違いを枠で示す（P12-8）
        const aligned = two && this.wedgeMirrorLayout === 'align';
        const mismatch = aligned ? this.wedgeMismatchSlots() : [];
        if (two) {
            const ox = stacked ? 0 : -158, ox2 = stacked ? 0 : 158;
            const oy = stacked ? -150 : 0, oy2 = stacked ? 150 : 0;
            this.drawWedgePane(labelsOf(this._viewSlots), ox, 'left', 'あなたの分子', interactive, mismatch, oy);
            this.drawWedgePane(labelsOf(this._mirrorSlots), ox2, 'right', '🪞 鏡像', interactive, mismatch, oy2);
            if (aligned) {
                const cap = document.createElementNS(NS, 'text');
                cap.setAttribute('x', 0);
                cap.setAttribute('y', stacked ? 292 : 142);
                cap.setAttribute('text-anchor', 'middle');
                cap.setAttribute('font-size', '11.5');
                cap.setAttribute('data-align-caption', mismatch.length ? 'mismatch' : 'match');
                cap.setAttribute('fill', mismatch.length ? 'var(--neon-orange)' : 'var(--neon-green)');
                cap.textContent = mismatch.length
                    ? `⚠ 枠の${mismatch.length}か所だけが違います＝重ね合わせられません`
                    : '✔ すべて一致しました＝回転だけで重ね合わせられます';
                this.svg.appendChild(cap);
            }
            const sep = document.createElementNS(NS, 'line');
            // 積んだときは横線で仕切る
            sep.setAttribute('x1', stacked ? -150 : 0); sep.setAttribute('y1', stacked ? 0 : -128);
            sep.setAttribute('x2', stacked ? 150 : 0); sep.setAttribute('y2', stacked ? 0 : 128);
            sep.setAttribute('stroke', 'rgba(0,242,254,0.35)');
            sep.setAttribute('stroke-width', 1.5);
            sep.setAttribute('stroke-dasharray', '5 5');
            this.svg.appendChild(sep);
        } else {
            this.drawWedgePane(this._viewSlots ? labelsOf(this._viewSlots) : this._fallbackLabels,
                0, 'left', null, interactive, []);
        }
        // 現在の回転方向を明示する（P12-8。ユーザー要望）。直近に巡回した向きを弧矢印で示す
        if (this._lastCycleDir && this._viewSlots) {
            this.drawCycleArrow(two && !stacked ? -158 : 0, this._lastCycleDir, stacked ? -150 : 0);
            if (two) this.drawCycleArrow(stacked ? 0 : 158, this._lastCycleDir, stacked ? 150 : 0);
        }
        this.updateWedgeButtons();
        this.updateWedgeNote();
    }

    // 1枚分のくさび図。中心C から4方向へ結合を描く。
    // 縦（上・下）＝紙面の奥 → 破線くさび（ハッシュ）／横（左・右）＝紙面の手前 → 塗りくさび（▶）。
    // labels は { up, right, down, left } の表示ラベル。
    // 検証しやすいよう、ペインに data-pane、各結合・ラベル・当たり判定に data-slot / data-bond を付ける。
    drawWedgePane(labels, ox, pane, title, interactive, mismatch, oy = 0) {
        const NS = 'http://www.w3.org/2000/svg';
        const root = document.createElementNS(NS, 'g');
        root.setAttribute('data-pane', pane);
        // oy はスマホ縦画面で2ペインを上下に積むときに使う（P12-8）
        root.setAttribute('transform', `translate(${ox},${oy})`);
        this.svg.appendChild(root);

        const text = (parent, x, y, str, slot, size = 15, color = '#f5f6fa') => {
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', x); t.setAttribute('y', y);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'svg-atom-text');
            t.setAttribute('fill', color);
            t.setAttribute('data-slot', slot);
            t.style.fontSize = size + 'px';
            t.textContent = str;
            parent.appendChild(t);
        };
        // 塗りくさび（手前）: 中心側が細く、置換基側が広い三角形
        const wedge = (parent, slot, sx) => {
            const p = document.createElementNS(NS, 'polygon');
            p.setAttribute('points', `${16 * sx},0 ${66 * sx},-9 ${66 * sx},9`);
            p.setAttribute('fill', 'rgba(255,255,255,0.85)');
            p.setAttribute('data-slot', slot);
            p.setAttribute('data-bond', 'wedge');
            parent.appendChild(p);
        };
        // 破線くさび＝ハッシュ（奥）: 中心に近いほど短い刻み線を並べる
        const hash = (parent, slot, sy) => {
            const g = document.createElementNS(NS, 'g');
            g.setAttribute('data-slot', slot);
            g.setAttribute('data-bond', 'hash');
            for (let i = 0; i < 6; i++) {
                const y = (20 + i * 9) * sy;
                const h = 3.5 + i * 1.4;
                const l = document.createElementNS(NS, 'line');
                l.setAttribute('x1', -h); l.setAttribute('y1', y);
                l.setAttribute('x2', h); l.setAttribute('y2', y);
                l.setAttribute('stroke', 'rgba(255,255,255,0.75)');
                l.setAttribute('stroke-width', 2.2);
                l.setAttribute('stroke-linecap', 'round');
                g.appendChild(l);
            }
            parent.appendChild(g);
        };

        ['up', 'down', 'right', 'left'].forEach(slot => {
            const lay = WEDGE_SLOT_LAYOUT[slot];
            const g = document.createElementNS(NS, 'g');
            g.setAttribute('class', 'wedge-slot' + (interactive ? ' clickable' : ''));
            g.setAttribute('data-slot-group', slot);
            root.appendChild(g);
            if (slot === 'up') hash(g, 'up', -1);
            else if (slot === 'down') hash(g, 'down', 1);
            else wedge(g, slot, slot === 'right' ? 1 : -1);
            text(g, lay.lx, lay.ly, labels[slot], slot);
            // 透明の当たり判定（細い結合・短いラベルでも掴めるように）
            const r = document.createElementNS(NS, 'rect');
            r.setAttribute('x', lay.hit[0]); r.setAttribute('y', lay.hit[1]);
            r.setAttribute('width', lay.hit[2]); r.setAttribute('height', lay.hit[3]);
            r.setAttribute('fill', 'transparent');
            r.setAttribute('data-slot', slot);
            r.setAttribute('data-hit', '1');
            g.appendChild(r);
        });

        text(root, 0, 5, 'C', 'center', 17, 'var(--color-c)');
        if (title) text(root, 0, -120, title, 'title', 13, 'var(--text-secondary)');

        // 「並びを揃える」モードで揃えきれなかったスロットを枠で囲む（P12-8）。
        // 左右どちらのペインにも同じ位置に出して、見比べる場所をはっきりさせる
        (mismatch || []).forEach(slot => {
            const lay = WEDGE_SLOT_LAYOUT[slot];
            if (!lay) return;
            const box = document.createElementNS(NS, 'rect');
            box.setAttribute('x', lay.hit[0] + 4); box.setAttribute('y', lay.hit[1] + 4);
            box.setAttribute('width', lay.hit[2] - 8); box.setAttribute('height', lay.hit[3] - 8);
            box.setAttribute('rx', 9);
            box.setAttribute('fill', 'none');
            box.setAttribute('stroke', 'var(--neon-orange)');
            box.setAttribute('stroke-width', 2);
            box.setAttribute('stroke-dasharray', '7 5');
            box.setAttribute('pointer-events', 'none');
            box.setAttribute('data-mismatch', slot);
            root.appendChild(box);
        });
    }

    updateWedgeButtons() {
        const usable = !!this._viewSlots;
        if (this.wedgeMirrorBtn) {
            this.wedgeMirrorBtn.textContent = this.wedgeMirror ? '🪞 鏡像を消す' : '🪞 鏡像と並べる';
            this.wedgeMirrorBtn.disabled = !usable;
        }
        if (this.wedgeResetBtn) this.wedgeResetBtn.disabled = !usable;
        // 「この立体で図を確定する」は**仮の立体のときだけ**出す（読めた図には要らない）
        if (this.wedgeCommitBtn) {
            this.wedgeCommitBtn.classList.toggle('hidden', !(usable && this._provisional));
        }
        // 巡回も並べ替えと同じく、立体が読めた中心でのみ使える
        if (this.wedgeCwBtn) this.wedgeCwBtn.disabled = !usable;
        if (this.wedgeCcwBtn) this.wedgeCcwBtn.disabled = !usable;
        // 鏡像の並べ方（鏡面対称／並びを揃える）は鏡像と並べているときだけ意味がある（P12-8）
        if (this.wedgeLayoutRow) {
            this.wedgeLayoutRow.classList.toggle('hidden', !(usable && this.wedgeMirror));
        }
        if (this.wedgeLayoutBtnSym) {
            this.wedgeLayoutBtnSym.classList.toggle('active', this.wedgeMirrorLayout !== 'align');
        }
        if (this.wedgeLayoutBtnAlign) {
            this.wedgeLayoutBtnAlign.classList.toggle('active', this.wedgeMirrorLayout === 'align');
        }
    }

    updateWedgeNote() {
        if (!this.wedgeNoteEl) return;
        const parts = [];
        if (!this._viewSlots) {
            parts.push('この中心では立体を組み立てられません（置換基が4つそろっていないか、環の中の炭素です）。');
        } else if (this._provisional) {
            // 項目23: 読めない図でも操作は解放するが、**仮であることを必ず先に言う**
            parts.push('⚠ この図では立体が決まっていないので、「仮の立体」で表示しています（並びは一例です）。' +
                       'このまま回したり鏡像と並べたりして、立体の考え方を試せます。');
            parts.push('この仮の立体で図を決めたいときは「✓ この立体で図を確定する」を押してください。' +
                       'キャンバスの置換基がフィッシャー投影の十字（縦・横）に並び、以後は' +
                       '描いた立体として読まれます（↩ 戻す で元に戻せます）。');
        } else {
            parts.push('置換基（文字・結合）をクリックすると、その置換基が上に来るように並べ替えます。' +
                       '上の枝をクリック（または「↻ 残り3つを回す」）すると、上を固定したまま残りの3つが入れ替わります。');
            if (this._wedgeCycled) {
                parts.push('上の1つを固定して残り3つを回しても分子は変わりません（3つの巡回＝入れ替え2回分）。' +
                           '3回続けると元の並びに戻ります。右回り・左回りのどちらも同じ分子のままです。' +
                           'この「固定した1つ以外の回る向きは変わらない」という性質が、R/S（最も優先順位の低い基を' +
                           '奥に置いて、残り3つの回る向きを読む）の考え方の土台になります。');
            }
            if (this._wedgeMoved) {
                parts.push('この操作では分子は変わりません（フィッシャー投影で許される動かし方です）。' +
                           '180°回転や「1つを固定した3つの巡回」は入れ替え2回分にあたるので、鏡像にはなりません。');
            }
            if (this.wedgeMirror) {
                parts.push('左右を入れ替えると鏡像異性体になります（くさび図では1回の入れ替えで鏡像）。上下の入れ替えだけでも鏡像です。');
                parts.push(this._isAsym
                    ? '左右の図は鏡像の関係です。許される並べ替えをどう重ねても重ね合わせられません（＝鏡像異性体）。'
                    : 'この炭素は不斉ではないので、並べ替えても同じ分子です。');
                // P12-8: 鏡像ペインの並べ方（鏡面対称／並びを揃える）の解説
                if (this.wedgeMirrorLayout === 'align') {
                    const miss = this.wedgeMismatchSlots();
                    const total = StereoView.evenArrangements(StereoView.mirrorSlots(this._viewSlots)).length;
                    parts.push(`「並びを揃える」: 許される並べ替え（偶置換）${total}通りをすべて試して、` +
                               'いちばんオリジナルに近づく並びにしてあります。');
                    parts.push(miss.length
                        ? `それでもオレンジの枠の${miss.length}か所（${miss.map(k => WEDGE_SLOT_JA[k]).join('と')}）だけは` +
                          '入れ替わったまま残ります。この食い違いは1回の入れ替え（奇置換）ぶんで、' +
                          '偶置換をどう重ねても消せません＝回転では重ね合わせられない、が目で見えます。'
                        : 'この炭素では食い違いが残らず、すべて一致しました＝鏡像と回転だけで重ね合わせられます（不斉ではありません）。');
                    parts.push('このモードでは、どちらの図を動かしても両方が同じように動きます（揃えた関係を保ったまま回せます）。');
                } else {
                    parts.push('「鏡面対称」: 鏡に映したままの配置です（左右が入れ替わって見えます）。' +
                               '「並びを揃える」に切り替えると、許される並べ替えだけでオリジナルにできるだけ近づけ、' +
                               'それでも残る食い違いを枠で示します。');
                }
            }
        }
        this.wedgeNoteEl.textContent = parts.join('\n');
        // 中心が変わったら枝の比較は閉じ直す（古い中心の内容が残らないように）
        if (this.branchNoteEl && !this.branchNoteEl.classList.contains('hidden')) this.renderBranchCompare();
    }

    // 中心の隣接どうしが中心を経由せずに繋がっていれば環内の原子（案内文言の出し分け用）
    static isRingAtom(mol, atomId) {
        const nbrs = mol.getNeighbors(atomId).map(n => n.atom.id);
        for (let i = 0; i < nbrs.length; i++) {
            for (let j = i + 1; j < nbrs.length; j++) {
                const seen = new Set([atomId]);
                const stack = [nbrs[i]];
                while (stack.length) {
                    const cur = stack.pop();
                    if (cur === nbrs[j]) return true;
                    if (seen.has(cur)) continue;
                    seen.add(cur);
                    mol.getNeighbors(cur).forEach(n => { if (!seen.has(n.atom.id)) stack.push(n.atom.id); });
                }
            }
        }
        return false;
    }

    // ===== 疑似3D回転ビューア（P12-7 M3） =====

    setMode(mode) {
        // 環が無い分子で環ビューは開けない（タブは無効化してあるが、直接呼ばれても守る）
        if (mode === 'ring' && !this._ringModel) mode = 'wedge';
        if (mode === 'mol' && !(this._molModel && this._molModel.ok)) mode = 'wedge';
        // 中心炭素を選んでいないとき（分子全体だけを開いたとき）はくさび図・1炭素3Dへ行かせない
        if (this.centerId === null && mode !== 'mol' && mode !== 'ring') {
            mode = (this._molModel && this._molModel.ok) ? 'mol' : 'ring';
        }
        this.mode = mode;
        const on3d = mode === '3d';
        const onRing = mode === 'ring';
        const onMol = mode === 'mol';
        this.paneWedge.classList.toggle('hidden', on3d || onRing || onMol);
        this.pane3d.classList.toggle('hidden', !on3d);
        if (this.paneRing) this.paneRing.classList.toggle('hidden', !onRing);
        if (this.paneMol) this.paneMol.classList.toggle('hidden', !onMol);
        this.tabWedge.classList.toggle('active', !on3d && !onRing && !onMol);
        this.tab3d.classList.toggle('active', on3d);
        if (this.tabRing) this.tabRing.classList.toggle('active', onRing);
        if (this.tabMol) this.tabMol.classList.toggle('active', onMol);
        if (this.titleEl) {
            this.titleEl.textContent = onRing ? '⬡ 環を横から見る'
                : onMol ? '🧊 分子全体の立体構造'
                : on3d ? '🧊 実際の立体構造（3Dで回す）' : '🧊 実際の立体構造（くさび形表記）';
        }
        if (on3d) {
            this.render3D();
            this.startSpin();
        } else {
            this.stopSpin();
        }
        if (onRing) this.renderRing();
        if (onMol) { this.renderMol(); this.startMolSpin(); } else { this.stopMolSpin(); }
    }

    setMirror(on) {
        this.mirror = !!on;
        this.updateMirrorButton();
        this.render3D();
    }

    /**
     * 3Dビューの鏡像ペインの構え方を切り替える（P12-8。'symmetric' | 'align'）。
     * どちらのモードでも「鏡像であること」（parityFromDirs が左右で逆）は変えない。
     * align は鏡像側に**回転（行列式 +1）だけ**を追加で掛けるので、手性は不変。
     */
    setMirrorLayout(mode) {
        this.mirrorLayout = mode === 'align' ? 'align' : 'symmetric';
        this.updateMirrorButton();
        this.render3D();
    }

    // 鏡像側の軸をオリジナルの軸に重ねる回転行列（align モードかつ結合を軸に選んでいるときだけ）。
    // 鏡像の基準ベクトルは x 反転なので、軸も x 反転した axM をオリジナルの ax へ合わせる
    mirrorAlignMatrix() {
        if (this.mirrorLayout !== 'align') return null;
        const ax = this.axisVector();
        if (!ax) return null; // 画面基準では「揃えるべき軸」がない
        return StereoView.alignRotation([-ax[0], ax[1], ax[2]], ax);
    }

    updateMirrorButton() {
        if (this.mirrorBtn) this.mirrorBtn.textContent = this.mirror ? '🪞 鏡像を消す' : '🪞 鏡像と並べる';
        // 配置モードの切り替えは鏡像と並べているときだけ出す。
        // 「軸を揃える」は回転軸に結合を選んでいるときにだけ意味があるので、それ以外では無効化
        if (this.mirrorLayoutRow) this.mirrorLayoutRow.classList.toggle('hidden', !this.mirror);
        const onAxis = this.axisIndex !== null;
        if (this.mirrorLayoutBtnSym) {
            this.mirrorLayoutBtnSym.classList.toggle('active', this.mirrorLayout !== 'align');
        }
        if (this.mirrorLayoutBtnAlign) {
            this.mirrorLayoutBtnAlign.classList.toggle('active', this.mirrorLayout === 'align' && onAxis);
            this.mirrorLayoutBtnAlign.disabled = !onAxis;
            this.mirrorLayoutBtnAlign.style.opacity = onAxis ? '' : '0.45';
        }
    }

    setAutoRotate(on) {
        this.autoRotate = !!on;
        this.updateSpinButton();
        if (this.autoRotate) this.startSpin(); else this.stopSpin();
    }

    updateSpinButton() {
        if (this.spinBtn) this.spinBtn.textContent = this.autoRotate ? '⏸ 自動回転を止める' : '▶ 自動回転';
    }

    // ===== 回転軸の切り替え（P12-8） =====

    // 回転軸に選んだ結合の方向ベクトル（画面基準なら null）
    axisVector() {
        if (this.axisIndex === null || !this._dirs || !this._dirs[this.axisIndex]) return null;
        return this._dirs[this.axisIndex].v;
    }

    /** 中心から H へ伸びる結合が _dirs の何番目か（中心未選択・H無しなら null。P12-8 M2.5 その3） */
    hydrogenAxisIndex() {
        if (this.centerId === null || !this._dirs) return null;
        const i = this._dirs.findIndex(d => d.ref === 'H');
        return i < 0 ? null : i;
    }

    /**
     * 中心の H への結合を回転軸にして、その結合を視線の奥へ向ける（P12-8 M2.5 その3）。
     * 読み物②の「最下位を奥に置く」を、文字で読むだけでなく実際の図で構えられるようにする導線。
     * 姿勢を作るだけで、R か S かはアプリからは言わない
     */
    faceHydrogenAway() {
        const i = this.hydrogenAxisIndex();
        if (i === null) return;
        this.setMode('3d');
        this.axisFacing = 'away';  // setAxis → faceAxis がこの向きを見て構える
        this.setAxis(i);
        // 読み物を開いたまま押すと、切り替わった3Dビューは**開いたアコーディオンより上**に
        // あるので画面の外に残り、「押しても何も起きない」ように見えていた（レビュー項目4）。
        // 読み物を畳んで、3Dビューの位置までスクロールして見せる
        if (this.rsTips) this.rsTips.open = false;
        this.revealPane(this.pane3d);
    }

    /**
     * モーダルの中の指定した要素を、見える位置までスクロールして出す（レビュー項目4）。
     * `.modal-content` に overflow:auto が付くのは小画面のときだけなので、
     * **実際にスクロールできる祖先**を探して動かす。見つからなければ（＝desktop で
     * モーダル自体が縮んで収まる場合）ブラウザの scrollIntoView に任せる
     */
    revealPane(el) {
        if (!el || !el.getBoundingClientRect) return;
        const box = StereoView.scrollableAncestor(el);
        if (!box) {
            // 枠が縮んで丸ごと収まる場合（desktop 幅）。ブラウザに任せる
            if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            return;
        }
        // **いったん先頭に戻してから測る**。読み物を畳んだ直後は中身が縮んだぶんの
        // scrollTop の詰め直しがまだ効いておらず、そのまま足すと行き先が下へずれて
        // 3Dビューが枠の上へ外れる（レビュー項目4の再現時に実際にそうなった）。
        // 先頭からの距離なら、いま何ピクセル送られているかを読まずに決まる
        box.scrollTop = 0;
        const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
        const y = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, top - 12));
        if (y <= 0) return; // 先頭のままで見えている
        if (box.scrollTo) box.scrollTo({ top: y, behavior: StereoView.prefersReducedMotion() ? 'auto' : 'smooth' });
        else box.scrollTop = y;
    }

    /** el を実際にスクロールできる祖先要素（無ければ null） */
    static scrollableAncestor(el) {
        const win = el.ownerDocument && el.ownerDocument.defaultView;
        if (!win) return null;
        let n = el.parentElement;
        while (n && n !== el.ownerDocument.body) {
            const oy = win.getComputedStyle(n).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
            n = n.parentElement;
        }
        return null;
    }

    /** 「H を奥に向けて構える」の使える／使えないを、いまの中心炭素に合わせて更新する */
    updateRsTipsButton() {
        const btn = this.rsFaceHBtn;
        if (!btn) return;
        const ok = this.hydrogenAxisIndex() !== null;
        btn.disabled = !ok;
        btn.style.opacity = ok ? '' : '0.45';
        btn.title = ok
            ? '中心の炭素から H へ伸びる結合を回転軸にして、その結合を視線の奥へ向けます（3Dビューに切り替わります）'
            : 'いまの中心の炭素には H が付いていないため使えません。3Dビューで「回転軸」に置換基を選び、「軸の向き: 奥」を押してください。';
    }

    // index: _dirs の添字（その置換基への結合が軸）、null なら画面基準に戻す
    setAxis(index) {
        this.axisIndex = (index === null || index === undefined) ? null : index;
        // 「軸を揃える」は結合を軸に選んでいるときだけ意味を持つので、画面基準に戻したら鏡面対称へ戻す
        if (this.axisIndex === null) this.mirrorLayout = 'symmetric';
        this.axisAngle = 0;
        this.faceAxis();
        this.updateAxisButtons();
        this.updateMirrorButton(); // 「軸を揃える」の使える／使えないが軸の有無で変わる
        this.render3D();
        this.startSpin();
    }

    buildAxisButtons() {
        const row = this.axisRow;
        if (!row) return;
        row.innerHTML = '';
        const cap = document.createElement('span');
        cap.textContent = '回転軸:';
        row.appendChild(cap);
        const mk = (label, index, id) => {
            const b = document.createElement('button');
            b.className = 'view-btn stereo-axis-btn';
            b.style.cssText = 'margin:0; font-size:11px; padding:4px 9px;';
            b.textContent = label;
            b.id = id;
            b.dataset.axisIndex = (index === null ? '' : String(index));
            b.addEventListener('click', () => this.setAxis(index));
            row.appendChild(b);
        };
        mk('画面', null, 'btn-stereo-axis-screen');
        (this._dirs || []).forEach((d, i) => mk(this.labelOf(d.ref), i, 'btn-stereo-axis-' + i));

        // 軸を画面上のどの向きに構えるか（P12-8。ユーザー要望）。
        // 「奥」はニューマン投影に近い見え方で、残り3つの回る向きが読める
        const wrap = document.createElement('span');
        wrap.id = 'stereo-facing-row';
        wrap.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-left:10px;';
        const cap2 = document.createElement('span');
        cap2.textContent = '軸の向き:';
        wrap.appendChild(cap2);
        const FACINGS = [
            ['自動', 'auto', '軸を画面と平行に構えて少し見下ろします'],
            ['奥', 'away', '軸を視線の方向（奥）に向けます。ニューマン投影に近い見え方で、残り3つの回る向きが読めます'],
            ['上', 'up', '軸を画面の上に向けます'],
            ['右', 'right', '軸を画面の右に向けます'],
            ['左', 'left', '軸を画面の左に向けます']
        ];
        FACINGS.forEach(([label, key, title]) => {
            const b = document.createElement('button');
            b.className = 'view-btn stereo-facing-btn';
            b.style.cssText = 'margin:0; font-size:11px; padding:4px 9px;';
            b.textContent = label;
            b.id = 'btn-stereo-facing-' + key;
            b.dataset.facing = key;
            b.title = title;
            b.addEventListener('click', () => this.setAxisFacing(key));
            wrap.appendChild(b);
        });
        row.appendChild(wrap);
        this.updateAxisButtons();
    }

    updateAxisButtons() {
        if (!this.axisRow) return;
        const cur = this.axisIndex === null ? '' : String(this.axisIndex);
        this.axisRow.querySelectorAll('.stereo-axis-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.axisIndex === cur);
        });
        // 軸の向きは「結合を軸に選んでいるとき」だけ意味があるので、画面基準では無効化する
        const onAxis = this.axisIndex !== null;
        this.axisRow.querySelectorAll('.stereo-facing-btn').forEach(b => {
            b.classList.toggle('active', onAxis && b.dataset.facing === this.axisFacing);
            b.disabled = !onAxis;
            b.style.opacity = onAxis ? '' : '0.45';
        });
    }

    // ロドリゲスの回転公式（単位ベクトル k のまわりに角 th だけ v を回す）。k が null なら素通し
    static spinAround(v, k, th) {
        if (!k) return v;
        const L = Math.hypot(k[0], k[1], k[2]);
        if (L < 1e-9) return v;
        const u = [k[0] / L, k[1] / L, k[2] / L];
        const c = Math.cos(th), s = Math.sin(th);
        const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        return [
            v[0] * c + cr[0] * s + u[0] * dot * (1 - c),
            v[1] * c + cr[1] * s + u[1] * dot * (1 - c),
            v[2] * c + cr[2] * s + u[2] * dot * (1 - c)
        ];
    }

    // 軸を横から見る向きに構え直す（軸を選んでいなければ正面に戻す）
    faceAxis() {
        const a = this.axisVector();
        this._alignM = null;
        if (!a) {
            this.angleX = 0;
            this.angleY = 0;
            return;
        }
        // 軸の向きを指定しているときは、その向きへ合わせ込む（P12-8。ユーザー要望）。
        // 'away'（奥）はニューマン投影に近い見え方で、残り3つの回る向きが読める＝R/S の考え方に直結
        const target = STEREO3D_AXIS_FACING[this.axisFacing];
        if (target) {
            this._alignM = StereoView.alignRotation(a, target);
            this.angleX = 0;
            this.angleY = 0;
            this.pickAxisPhase(a);
            return;
        }
        // 'auto': まず軸を画面に平行（z=0）にし、そのうえで少し見下ろす。
        // 傾けないと軸以外の2つが同じ位置に投影されて重なってしまう
        this.angleY = Math.atan2(a[2], a[0]);
        this.angleX = STEREO3D_AXIS_TILT;
        this.pickAxisPhase(a);
    }

    // 軸以外の3つが中心の円に隠れない位相から始める（真正面／真後ろを向くと見えなくなる）
    pickAxisPhase(a) {
        if (!this._dirs) return;
        let best = 0, bestScore = -Infinity;
        for (let i = 0; i < 24; i++) {
            const th = i * Math.PI / 12;
            let score = Infinity;
            this._dirs.forEach((d, j) => {
                if (j === this.axisIndex) return;
                const v = this.rotate(StereoView.spinAround(d.v, a, th));
                score = Math.min(score, Math.hypot(v[0], v[1]));
            });
            if (score > bestScore) { bestScore = score; best = th; }
        }
        this.axisAngle = best;
    }

    /** 回転軸を画面上のどの向きに構えるかを切り替える（P12-8。'auto'|'up'|'away'|'right'|'left'） */
    setAxisFacing(facing) {
        this.axisFacing = STEREO3D_AXIS_FACING[facing] || facing === 'auto' ? facing : 'auto';
        this.faceAxis();
        this.updateAxisButtons();
        this.render3D();
    }

    resetAngles() {
        this.axisAngle = 0;
        this.faceAxis();
        this.render3D();
    }

    startSpin() {
        if (this._raf !== null || !this.autoRotate || this.mode !== '3d') return;
        let last = null;
        const step = (t) => {
            if (last === null) last = t;
            const dt = Math.min(50, t - last);
            last = t;
            // 軸を選んでいればその結合まわり、そうでなければ画面のY軸まわりに回す（約40°/秒）
            if (this.axisVector()) this.axisAngle += dt * 0.0007;
            else this.angleY += dt * 0.0007;
            this.render3D();
            this._raf = requestAnimationFrame(step);
        };
        this._raf = requestAnimationFrame(step);
    }

    stopSpin() {
        if (this._raf !== null) {
            cancelAnimationFrame(this._raf);
            this._raf = null;
        }
    }

    // ドラッグ（マウス・タッチ共通）で回す。慣性なし
    bindDrag() {
        const svg = this.svg3d;
        if (!svg) return;
        svg.addEventListener('pointerdown', (e) => {
            this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY, p: this.svgPoint3d(e) };
            this.stopSpin(); // 掴んでいる間は自動回転を止める
            svg.style.cursor = 'grabbing';
            try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 非対応環境では無視 */ }
            e.preventDefault();
        });
        svg.addEventListener('pointermove', (e) => {
            if (!this._drag || this._drag.id !== e.pointerId) return;
            const dx = e.clientX - this._drag.x;
            const dy = e.clientY - this._drag.y;
            this._drag.x = e.clientX;
            this._drag.y = e.clientY;
            // どこを掴んでいるかが要るので SVG 座標へ直す（クライアント⇔SVG は getScreenCTM 必須）
            const prev = this._drag.p;
            const now = this.svgPoint3d(e);
            this._drag.p = now || prev;
            if (prev && now) {
                this.rotateByDrag(now[0] - prev[0], now[1] - prev[1],
                                  (prev[0] + now[0]) / 2, (prev[1] + now[1]) / 2);
            } else {
                this.rotateBy(dx * 0.01, dy * 0.01); // CTM が取れない環境では従来どおり
            }
            e.preventDefault();
        });
        const end = () => {
            if (!this._drag) return;
            this._drag = null;
            svg.style.cursor = 'grab';
            this.startSpin(); // 離したら自動回転を再開（OFFなら何もしない）
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
    }

    rotateBy(dYaw, dPitch) {
        if (this.axisVector()) {
            this.axisAngle += dYaw; // 軸を選んでいるときは横方向のドラッグ＝その結合まわりの回転
        } else {
            this.angleY += dYaw;
            this.angleX -= dPitch; // 下へドラッグ＝手前の置換基が下がる
        }
        this.render3D();
    }

    /** クライアント座標を3DビューのSVG座標へ（getScreenCTM 必須。取れなければ null） */
    svgPoint3d(e) {
        const svg = this.svg3d;
        if (!svg || !svg.getScreenCTM || !svg.createSVGPoint) return null;
        const m = svg.getScreenCTM();
        if (!m) return null;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const q = pt.matrixTransform(m.inverse());
        return [q.x, q.y];
    }

    /**
     * ドラッグ1回ぶんの移動を回転に変える（レビュー項目13）。
     *
     * 従来は「横ドラッグ＝軸まわりの回転」と決め打ちしていたので、軸の構え方によっては
     * ドラッグの向きと分子の回る向きが直交していた（既定の 'auto' は軸をほぼ水平に構えるので、
     * 横へドラッグすると置換基は**縦に**動く。「奥」に構えると画面内の回転になる）。
     * 掴んだ点が軸まわりに動く向き（速度 ω×g）を求め、そこへドラッグを射影して角度を決めると、
     * **掴んだ置換基が指に付いてくる**＝どの構え方でも向きが一致する。
     * dx,dy と px,py は SVG 座標（px,py はドラッグ区間の中点＝掴んでいる点）
     */
    rotateByDrag(dx, dy, px, py) {
        const ax = this.axisVector();
        if (!ax) {
            // 画面基準（軸なし）は従来どおりのターンテーブル。横＝左右に回す・縦＝見下ろす
            this.rotateBy(dx * STEREO3D_DRAG_GAIN, dy * STEREO3D_DRAG_GAIN);
            return;
        }
        const pane = this.paneOfPoint(px, py);
        const drawn = this._drawn && (pane.right ? this._drawn.right : this._drawn.left);
        if (!drawn) return;
        // 鏡面対称の鏡像ペインは左ペインを画面上で x 反転した像。反射 M では M(u×v) = -(Mu×Mv)
        // なので、軸を反転したうえで回る向きも逆になる
        // （「軸を揃える」の鏡像は**回転**で作っているので、この付け替えは要らない）
        const flip = pane.right && this.mirrorLayout !== 'align';
        const a0 = this.rotate(ax); // 画面から見た軸の向き（rotate は真の回転なので長さ1のまま）
        const a = flip ? [-a0[0], a0[1], a0[2]] : a0;
        const g = this.grabPoint(drawn, px - pane.ox, py - pane.oy);
        const t = [a[1] * g[2] - a[2] * g[1], a[2] * g[0] - a[0] * g[2], a[0] * g[1] - a[1] * g[0]];
        const n2 = t[0] * t[0] + t[1] * t[1]; // 画面に見えている動きの大きさ
        if (n2 < 0.04) return; // 軸のほぼ真上を掴んでいる＝どちらへ動かしても画面上は動かない
        const th = (flip ? -1 : 1) * ((dx * t[0] + dy * t[1]) / STEREO3D_BOND) / n2;
        // モデル空間の軸 ax まわりの角と画面上の軸 a まわりの角は同じ（回転の共役）
        this.axisAngle += Math.max(-0.35, Math.min(0.35, th));
        this.render3D();
    }

    /**
     * 掴んだ画面の点に対応する立体上の点（回転後・画面基準の単位ベクトル）。
     * **近くに置換基があればその実際の向きを使う**のが肝で、球の手前側に載せて済ませると
     * 奥を向いている置換基を掴んだときに動きが左右逆になる（奥の点は手前の点と逆に流れるため）。
     * 近くに何も無ければ「球を掴んでいる」とみなして手前側の点に載せる
     */
    grabPoint(drawn, px, py) {
        let best = null, bestD = STEREO3D_GRAB_R;
        drawn.forEach(d => {
            if (d.idx === this.axisIndex) return; // 軸の上の置換基は回しても動かない
            const k = STEREO3D_PERSP / (STEREO3D_PERSP - d.v[2] * STEREO3D_BOND);
            const dist = Math.hypot(d.v[0] * STEREO3D_BOND * k - px, d.v[1] * STEREO3D_BOND * k - py);
            if (dist < bestD) { bestD = dist; best = d.v; }
        });
        return best || StereoView.arcballPoint(px, py, STEREO3D_BOND);
    }

    /** ドラッグ点がどちらのペインの中かと、そのペインの中心（鏡像を並べていないときは原点） */
    paneOfPoint(px, py) {
        if (!this.mirror) return { ox: 0, oy: 0, right: false };
        if (StereoView.isNarrowLayout()) { // 縦画面では鏡像を下に積んでいる
            return py > 0 ? { ox: 0, oy: 114, right: true } : { ox: 0, oy: -114, right: false };
        }
        return px > 0 ? { ox: 120, oy: 0, right: true } : { ox: -120, oy: 0, right: false };
    }

    /**
     * 掴んだ画面上の点を半径 r の球の**手前側**に載せる（アークボール）。球の外なら縁に丸める。
     * SVG座標系のまま（x=右・y=下・z=手前）返すので、そのまま外積に使える
     */
    static arcballPoint(px, py, r) {
        const u = px / r, v = py / r;
        const d2 = u * u + v * v;
        if (d2 >= 1) { const n = Math.sqrt(d2); return [u / n, v / n, 0]; }
        return [u, v, Math.sqrt(1 - d2)];
    }

    // Y軸→X軸の順に回す（回転なので行列式は +1 のまま＝パリティ不変）
    /**
     * ロドリゲスの回転行列（軸 k・角 th）。軸の向きを画面上の指定方向へ合わせるのに使う（P12-8）
     */
    static rodriguesMatrix(k, th) {
        const c = Math.cos(th), s = Math.sin(th), C = 1 - c;
        const [x, y, z] = k;
        return [
            [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
            [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
            [z * x * C - y * s, z * y * C + x * s, c + z * z * C]
        ];
    }

    /**
     * ベクトル a を画面上の向き t に重ねる回転行列を返す（P12-8。回転軸の向きの調整）。
     * オイラー角（Y→X）だけでは任意の向きに合わせられない（右・左に向けられない）ため、
     * 軸の向きを指定したときは行列で合わせる。
     */
    static alignRotation(a, t) {
        const dot = a[0] * t[0] + a[1] * t[1] + a[2] * t[2];
        const cr = [a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]];
        const s = Math.hypot(cr[0], cr[1], cr[2]);
        if (s < 1e-9) {
            if (dot > 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // すでに同じ向き
            // 正反対: 適当な垂直軸まわりに180°回す
            const p = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
            const c2 = [a[1] * p[2] - a[2] * p[1], a[2] * p[0] - a[0] * p[2], a[0] * p[1] - a[1] * p[0]];
            const n = Math.hypot(c2[0], c2[1], c2[2]) || 1;
            return StereoView.rodriguesMatrix([c2[0] / n, c2[1] / n, c2[2] / n], Math.PI);
        }
        return StereoView.rodriguesMatrix([cr[0] / s, cr[1] / s, cr[2] / s], Math.atan2(s, dot));
    }

    /** 3x3 行列をベクトルに掛ける（P12-8。鏡像側の軸合わせで使う） */
    static applyMatrix(m, v) {
        return [
            m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
        ];
    }

    /**
     * Y軸（左右）→X軸（上下）の順に回した結果を返す（回転なので行列式は +1＝パリティ不変）。
     * 3Dビューと環ビューで同じ式を使うため static に切り出してある（P12-8）。
     */
    static rotateYX(v, angleY, angleX) {
        const cx = Math.cos(angleX), sx = Math.sin(angleX);
        const cy = Math.cos(angleY), sy = Math.sin(angleY);
        const x1 = v[0] * cy + v[2] * sy;
        const y1 = v[1];
        const z1 = -v[0] * sy + v[2] * cy;
        return [x1, y1 * cx - z1 * sx, y1 * sx + z1 * cx];
    }

    // 環ビュー専用の回転（P12-8。ユーザー指摘「自動回転/ドラッグ回転が意図した挙動でない」）。
    // 環モデルは z=0 平面に組んである＝**環の法線は z 軸**なので、面内で回すには z 軸まわりに回す。
    // rotateYX は画面の縦軸（y）まわりに回すが、その軸は環の平面**内**にあるため、
    // 回すと環が裏返る動きになり、真横から見ていると環そのものが画面上で傾いてしまっていた。
    // 先に z 軸で回してから（メリーゴーランド）、カメラの倒し角 angleX を掛ける
    static rotateZX(v, angleZ, angleX) {
        const cz = Math.cos(angleZ), sz = Math.sin(angleZ);
        const cx = Math.cos(angleX), sx = Math.sin(angleX);
        const x1 = v[0] * cz - v[1] * sz;
        const y1 = v[0] * sz + v[1] * cz;
        const z1 = v[2];
        return [x1, y1 * cx - z1 * sx, y1 * sx + z1 * cx];
    }

    rotate(v) {
        // 軸の向きを指定しているときは合わせ込みの行列を使う（オイラー角では表せない向きがあるため）
        if (this._alignM) {
            const m = this._alignM;
            return [
                m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
                m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
                m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
            ];
        }
        return StereoView.rotateYX(v, this.angleY, this.angleX);
    }

    render3D() {
        const svg = this.svg3d;
        if (!svg) return;
        svg.innerHTML = '';
        if (!this._dirs) { this._drawn = null; return; }
        // 選んだ結合まわりに回してから画面の回転をかける（どちらも回転なのでパリティは不変）
        const ax = this.axisVector();
        const turn = (v) => this.rotate(StereoView.spinAround(v, ax, this.axisAngle));
        const left = this._dirs.map((d, i) => ({ ref: d.ref, code: d.code, idx: i, v: turn(d.v) }));
        // 鏡像ペインの作り方は2モード（P12-8）。どちらでも parityFromDirs は左右で逆＝鏡像のまま。
        //  'symmetric'（既定）… **画面空間で**鏡映する。左ペインの最終ベクトル（視点変換まで済んだもの）
        //     の x を反転するだけなので、どんな回転・軸・向きでも常に厳密な鏡像になり、
        //     左右が完全に同期して動く。
        //     （分子空間で鏡映してから同じ視点変換をかける方法は、鏡映 M と回転 R が可換でない
        //       ＝ M·R(a,θ) = R(Ma,−θ)·M ため、画面上の鏡像にならず左右の動きがずれる。v191 の不具合）
        //  'align'（軸を揃える）… 分子空間で鏡映して**別の分子**にしたうえで、鏡像側の軸を
        //     オリジナルの軸へ重ねる回転を先に掛け、そのあとオリジナルと同じ軸・同じ角・同じ視点変換を
        //     掛ける。軸が画面上の同じ位置・向きに来るので「軸を揃えても残り3つは重ならない」＝
        //     非重ね合わせが直接見える（左右は鏡像の見た目にはならない。それが狙い）
        let right = null;
        if (this.mirror) {
            const alignM = this.mirrorAlignMatrix();
            if (alignM) {
                right = this._dirs.map((d, i) => ({
                    ref: d.ref, code: d.code, idx: i,
                    v: this.rotate(StereoView.spinAround(
                        StereoView.applyMatrix(alignM, [-d.v[0], d.v[1], d.v[2]]), ax, this.axisAngle))
                }));
            } else {
                right = left.map(d => ({
                    ref: d.ref, code: d.code, idx: d.idx, v: [-d.v[0], d.v[1], d.v[2]]
                }));
            }
        }
        this._drawn = { left, right };

        // 鏡像と並べるときは SVG の実寸も広げる（縮小されて読みづらくならないように。P12-8）
        const stacked3d = this.mirror && StereoView.isNarrowLayout();
        // くさび図と同じ理由で、鏡像を並べているあいだは2カラムをやめる
        if (this.pane3d) this.pane3d.classList.toggle('wide-figure', !!this.mirror);
        if (stacked3d) {
            // 縦画面では鏡像を下に積む（横並びだと小さくなりすぎるため。P12-8）
            svg.setAttribute('viewBox', '-120 -228 240 456');
            svg.setAttribute('width', 240);
            svg.setAttribute('height', 456);
        } else {
            svg.setAttribute('viewBox', this.mirror ? '-240 -114 480 228' : '-120 -114 240 228');
            svg.setAttribute('width', this.mirror ? 480 : 330);
            svg.setAttribute('height', this.mirror ? 228 : 240);
        }
        if (right) {
            this.drawPane(left, stacked3d ? 0 : -120, 'あなたの分子', stacked3d ? -114 : 0);
            this.drawPane(right, stacked3d ? 0 : 120, '🪞 鏡像', stacked3d ? 114 : 0);
            const NS = 'http://www.w3.org/2000/svg';
            const sep = document.createElementNS(NS, 'line');
            sep.setAttribute('x1', stacked3d ? -104 : 0); sep.setAttribute('y1', stacked3d ? 0 : -104);
            sep.setAttribute('x2', stacked3d ? 104 : 0); sep.setAttribute('y2', stacked3d ? 0 : 104);
            sep.setAttribute('stroke', 'rgba(0,242,254,0.35)');
            sep.setAttribute('stroke-width', 1.5);
            sep.setAttribute('stroke-dasharray', '5 5');
            svg.appendChild(sep);
        } else {
            this.drawPane(left, 0, null);
        }
        this.updateNote();
    }

    // 1枚分の疑似3D図。奥から順に描く（画家のアルゴリズム）＋奥ほど小さく・暗く
    drawPane(dirs, ox, title, oy = 0) {
        const items = dirs.map(d => {
            const k = STEREO3D_PERSP / (STEREO3D_PERSP - d.v[2] * STEREO3D_BOND); // 手前(z+)ほど大きい
            return {
                ref: d.ref, z: d.v[2], k, axis: d.idx === this.axisIndex,
                x: ox + d.v[0] * STEREO3D_BOND * k,
                y: oy + d.v[1] * STEREO3D_BOND * k
            };
        });
        items.push({ center: true, z: 0, k: 1, x: ox, y: 0 });
        items.sort((a, b) => a.z - b.z);
        items.forEach(it => {
            const g = this.svgGroup(0.45 + 0.55 * (it.z + 1) / 2); // 奥ほど暗い
            if (it.center) {
                this.circle(g, it.x, it.y, STEREO3D_HUB, 'var(--color-c)', 3);
                this.text(g, it.x, it.y + 6, 'C', 17, 'var(--color-c)');
                return;
            }
            const label = this.labelOf(it.ref);
            // 回転軸に選んだ結合は色を変えて強調する（P12-8。--neon-blue が水色の定義済み変数）
            const color = it.axis ? 'var(--neon-blue)' : StereoView.colorOf(label);
            const len = Math.hypot(it.x - ox, it.y);
            const t = len > 1 ? Math.min(0.9, STEREO3D_HUB / len) : 0; // 中心の円のふちから結合線を引く
            this.line(g, ox + (it.x - ox) * t, it.y * t, it.x, it.y, (it.axis ? 4.6 : 2.6) * it.k, color);
            // ラベルが長い置換基（CH₃・CHO₂ など）は横長の楕円にして文字がはみ出さないようにする
            this.ellipse(g, it.x, it.y, (11 + 4.6 * label.length) * it.k, 15 * it.k, color, (it.axis ? 3.4 : 2.2) * it.k);
            this.text(g, it.x, it.y + 4.5 * it.k, label, 12.5 * it.k, color);
        });
        if (title) this.text(this.svg3d, ox, -92, title, 13, 'var(--text-secondary)');
    }

    updateNote() {
        if (!this.noteEl) return;
        const parts = [];
        if (this._parity) {
            parts.push('あなたが描いた立体をそのまま3Dにしています。ドラッグ（スワイプ）で好きな向きに回せます。');
        } else {
            parts.push('この描き方では立体が指定されていません（フィッシャー投影の軸方向に描くか、ハース環の上下に置くと指定できます）。' +
                       '下の図は正四面体の一例で、鏡像のどちらであるかは決めていません。');
        }
        if (this.axisVector()) {
            const name = this.labelOf(this._dirs[this.axisIndex].ref);
            parts.push(`「${name}」への結合を軸に回しています（水色の結合）。軸の上の置換基は動かず、残り3つが円すいをえがきます。` +
                       '結合を軸に回しても同じ分子です（回転では鏡像になりません）。' +
                       '回したい置換基をつまんで、その置換基が進みたい向きへドラッグしてください（軸に沿った向きには動きません）。');
        }
        if (this.mirror) {
            parts.push(this._isAsym
                ? '左右は鏡像の関係です。同じように回転させても重ね合わせられません（＝鏡像異性体）。'
                : 'この炭素は不斉ではないので、回すと重なります（左右は同じ分子です）。');
            // P12-8: 鏡像ペインの構え方の解説
            if (this.mirrorLayout === 'align' && this.axisVector()) {
                const name = this.labelOf(this._dirs[this.axisIndex].ref);
                parts.push(`「軸を揃える」: 鏡像側にも回転だけを加えて、「${name}」への軸を左と同じ向きに構えています。` +
                           '軸の上の置換基はぴったり重なりますが、残り3つは回る向きが左右で逆なので、' +
                           'どれだけ回しても重なりません。これが「鏡像異性体は回転では重ね合わせられない」ことの意味です。');
            } else {
                parts.push('「鏡面対称」: 右は左を画面の左右で鏡に映したままの配置です。' +
                           'どちらを回しても左右がぴったり同じように動きます（常に厳密な鏡像）。' +
                           '回転軸に結合を選んで「軸を揃える」にすると、鏡像側の軸を左と同じ向きに構え直して、' +
                           '「軸を揃えても重ならない」ことを確かめられます。');
            }
        }
        this.noteEl.textContent = parts.join('\n');
    }


    // ===== 環の「横から見る」ビュー（P12-8） =====

    /** from から to への最短経路（blocked は通らない）。最小の環を見つけるのに使う */
    static shortestPathAvoiding(mol, from, to, blocked) {
        const prev = new Map([[from, null]]);
        const queue = [from];
        while (queue.length) {
            const cur = queue.shift();
            if (cur === to) {
                const out = [];
                let c = cur;
                while (c !== null && c !== undefined) { out.push(c); c = prev.get(c); }
                return out.reverse();
            }
            for (const n of mol.getNeighbors(cur)) {
                if (n.atom.id === blocked || prev.has(n.atom.id)) continue;
                prev.set(n.atom.id, cur);
                queue.push(n.atom.id);
            }
        }
        return null;
    }

    /** atomId を通る最小の環（原子IDを一周の順に並べた配列）。環に属さなければ null */
    static ringCycleThrough(mol, atomId) {
        const nbrs = mol.getNeighbors(atomId).map(n => n.atom.id);
        let best = null;
        for (let i = 0; i < nbrs.length; i++) {
            for (let j = i + 1; j < nbrs.length; j++) {
                const path = StereoView.shortestPathAvoiding(mol, nbrs[i], nbrs[j], atomId);
                if (path && (!best || path.length < best.length)) best = path;
            }
        }
        return best ? [atomId].concat(best) : null;
    }

    /** 表示する環を決める。選んだ炭素が環にいればその環、いなければ分子の中で最小の環 */
    static findRingCycle(mol, preferId) {
        if (!mol) return null;
        if (preferId !== null && preferId !== undefined) {
            const c = StereoView.ringCycleThrough(mol, preferId);
            if (c) return c;
        }
        let best = null;
        mol.atoms.forEach(a => {
            const c = StereoView.ringCycleThrough(mol, a.id);
            if (c && (!best || c.length < best.length)) best = c;
        });
        return best;
    }

    /**
     * 環外置換基がどちらの面に出ているか（+1=上（手前）／-1=下（奥）／0=決められない）。
     * 規約は chemistry.js の readRingParityFromHaworth と同一:
     *   haworthFace(±1) が明示されていればそれ、無ければ縦（±25°以内）に描かれた位置から導く。
     * ここで面を読み替えないことが「命名で使う立体＝画面に見える立体」の一致を保証する。
     */
    static faceOfSubstituent(center, sub) {
        if (sub.haworthFace === 1 || sub.haworthFace === -1) return sub.haworthFace;
        const dx = sub.x - center.x, dy = sub.y - center.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6 || Math.abs(dy) / len < RING_FACE_TOL) return 0; // 縦から外れる＝読まない
        return dy < 0 ? 1 : -1; // 画面yは下が正。上（手前）=+1・下（奥）=-1
    }

    /** 連結成分の中にある環を、重複なく（同じ原子集合は1つに）並べて返す */
    static findRingCycles(mol, comp) {
        const seen = new Set();
        const out = [];
        [...comp].forEach(id => {
            const c = StereoView.ringCycleThrough(mol, id);
            if (!c) return;
            const key = c.slice().sort().join('|');
            if (seen.has(key)) return;
            seen.add(key);
            out.push(c);
        });
        return out;
    }

    /**
     * 橋渡しの原子（グリコシド酸素）の面を、片方の環から読む。
     *
     * ⚠ **スクロースはここが素直に読めない。**フルクトース環の C2 から橋の O へ出る結合は
     * 縦から 30° 傾いていて、§12.1 の ±25° を外れる（DESIGN_sugar.md §3-2 の実測）。
     * そこで `readRingParityFromHaworth` が使っているのと**同じ規約**で救う
     * （DESIGN_compound_coverage.md §6-3）—— ハース投影では環外に2本出る炭素の
     * 2本は**必ず反対の面**なので、もう1本（-CH₂OH）が縦に描かれていれば、その反対が橋の面。
     *
     * ⚠ **これは「推測」ではなく、アプリが名前を読むときに使っているのと同じ規約**だが、
     * 図の橋の結合そのものからは読めていないので `derived: true` を立てて**画面に書く**。
     * 戻り値: { face: +1|-1|0, derived: boolean, via: 使った置換基の原子|null }
     */
    static bridgeFaceOf(mol, host, sub, inRing) {
        const direct = StereoView.faceOfSubstituent(host, sub);
        if (direct) return { face: direct, derived: false, via: null };
        const others = mol.getNeighbors(host.id)
            .filter(n => !inRing.has(n.atom.id) && n.atom.element !== 'H' && n.atom.id !== sub.id);
        if (others.length === 1) {
            const f = StereoView.faceOfSubstituent(host, others[0].atom);
            if (f) return { face: -f, derived: true, via: others[0].atom };
        }
        return { face: 0, derived: false, via: null };
    }

    /**
     * ハース図の炭素番号をたどる向き（+1 = 見た目の時計回り／-1 = 反時計回り／0 = 決められない）。
     * ハース投影の約束では**環の酸素の隣のアノマー炭素**（環外に酸素を持つ側）が番号の起点なので、
     * 「環の O → アノマー炭素」の向きに一周した符号付き面積の符号がそのまま番号の向きになる。
     * 画面座標は下が正なので、面積が正 ＝ 見た目の時計回り。
     * ⚠ **教科書のスクロースはグルコース側が時計回り・フルクトース側が反時計回り**で、
     *    ここが「フルクトース環が裏返して描かれている」ことの数での現れ（DESIGN_sugar.md §5-2）。
     */
    static ringNumberingSense(mol, cycle, pts) {
        const n = cycle.length;
        const oi = cycle.findIndex(id => {
            const a = mol.atoms.find(x => x.id === id);
            return a && a.element === 'O';
        });
        if (oi < 0) return 0;
        const inRing = new Set(cycle);
        const isAnomer = id => mol.getNeighbors(id)
            .some(x => !inRing.has(x.atom.id) && x.atom.element === 'O');
        const next = cycle[(oi + 1) % n], prev = cycle[(oi + n - 1) % n];
        const dir = isAnomer(next) ? 1 : isAnomer(prev) ? -1 : 0;
        if (!dir) return 0;
        let area = 0;
        for (let k = 0; k < n; k++) {
            const p = pts[((oi + dir * k) % n + n) % n];
            const q = pts[((oi + dir * (k + 1)) % n + n) % n];
            area += p[0] * q[1] - q[0] * p[1];
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
     */
    static orderDisaccharideRings(mol, cycles, bridge) {
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

    /**
     * 環の3Dモデルを組み立てる（P12-8。二糖は v1441 で追加）。
     *   環原子     … 描かれた2D座標のまま z=0 の平面に置く
     *   環外置換基 … 描かれた2D座標のまま、面(±1)に応じて z=±depth に置く
     *   暗黙H     … 標準構成（環外の重原子1本）の環炭素だけ、置換基の反対側・反対の面に置く
     * この置き方だと、カメラの倒し角0°の見え方が**ユーザーが描いたハース図そのもの**になり、
     * 倒していくと環が線に潰れて置換基が上下に突き出す（＝α/β が直接見える）。
     * ※あくまで平面近似で、いす形のアキシャル/エカトリアルは表現できない（画面に明示する）。
     *
     * **二糖（原子1つの橋でつながった環2つ）**（DESIGN_sugar.md §3-4 R-2）:
     *   2つの環を**同じ z=0 平面**に置く ＝ ★ ユーザーの言う「2つのハース環が同一平面」。
     *   ⚠ このとき橋の酸素は**両方の環の置換基を兼ねる**ので z を1つに決めなければならないが、
     *     面は「その環の炭素から見た縦位置」で決まるため**両側から別々に読める**。実測では
     *     マルトースだけ一致し、セロビオース・ラクトースは食い違い、スクロースは片側が読めない。
     *   ⚠ **食い違うときは環Bを裏返す。**裏返しは (x,y,z)→(x,−y,−z) の**回転**（行列式 +1）で、
     *     置換基の上下と番号をたどる向きが**同時に**入れ替わるので**分子は1つも変わらない**。
     *     ＝「同一平面で見せる」には裏返しが要る（(2) と (3) は同じ機能）。
     *   ⚠ 絵としては環Bの**自分の重心**で折り返す（＝その場で裏返る。相手の環に重ならない）。
     *     分子そのものを裏返す `flipHaworth` の軸は**橋の原子の y** でなければならないが、
     *     両者は**縦の平行移動ぶんしか違わない**ので、面（z）と立体はまったく同じ。
     */
    buildRingModel() {
        this._ringCycle = null;
        this._ringModel = null;
        this._ringDrawn = null;
        const mol = this.mol;
        if (!mol) return null;
        this._ringUnavailReason = null;
        const focus = StereoView.findRingCycle(mol, this.centerId);
        if (!focus || focus.length < 3) return null;

        // このビューは「環を平面とみなし、置換基が上下に突き出す」模型なので、
        // 平面近似が成り立たない環は対象外にする（P12-8。ユーザー指摘）。
        //   ・縮合環/スピロ … 隣の環の原子が「置換基」として扱われ、上下の意味が決まらない
        //   ・環が3つ以上   … この模型の想定外
        //   ・環内に多重結合 … ベンゼン環のような平面の環では置換基が上下に出ない
        // ⚠ **橋1本でつないだ環2つ（二糖）はここを通す**（v1441。それまでは縮合環と同じ文で断っていた）
        const comp = new Set([focus[0]]);
        const stack = [focus[0]];
        while (stack.length) {
            const id = stack.pop();
            mol.getNeighbors(id).forEach(n => {
                if (!comp.has(n.atom.id)) { comp.add(n.atom.id); stack.push(n.atom.id); }
            });
        }
        const compBonds = mol.bonds.filter(b => comp.has(b.atomId1) && comp.has(b.atomId2));
        const loops = compBonds.length - comp.size + 1;
        let cycles;
        if (loops === 1) {
            cycles = [focus];
        } else if (loops === 2) {
            const all = StereoView.findRingCycles(mol, comp);
            const disjoint = all.length === 2 && !all[0].some(id => all[1].includes(id));
            if (!disjoint) { this._ringUnavailReason = RING_FUSED_REASON; return null; }
            cycles = all;
        } else {
            this._ringUnavailReason = RING_MANY_REASON;
            return null;
        }
        for (const cyc of cycles) {
            for (let i = 0; i < cyc.length; i++) {
                const b = mol.getBond(cyc[i], cyc[(i + 1) % cyc.length]);
                if (!b || b.type !== 1) {
                    this._ringUnavailReason = RING_UNSATURATED_REASON;
                    return null;
                }
            }
        }

        // ===== 二糖: 橋を見つけ、A/B を決め、橋の面が両側でそろうかを見る =====
        let bridge = null, bridgeInfo = null, flipB = false;
        if (cycles.length === 2) {
            bridge = haworthRingBridge(mol, cycles[0], cycles[1]);
            if (!bridge) { this._ringUnavailReason = RING_LINK_REASON; return null; }
            cycles = StereoView.orderDisaccharideRings(mol, cycles, bridge);
            bridge = haworthRingBridge(mol, cycles[0], cycles[1]); // A/B を入れ替えたので取り直す
            const both = new Set(cycles[0].concat(cycles[1]));
            const fa = StereoView.bridgeFaceOf(mol, bridge.hostA, bridge.atom, both);
            const fb = StereoView.bridgeFaceOf(mol, bridge.hostB, bridge.atom, both);
            if (!fa.face || !fb.face) {
                // ⚠ どちらかの面が読めない ＝ **黙って推測しない**（読めない側を勝手に決めない）
                this._ringUnavailReason = RING_BRIDGE_FACE_REASON;
                return null;
            }
            // ★ 面が食い違うなら環Bを裏返す（＝そろえる）。ユーザーが手で切り替えたらそれに従う
            const need = fa.face !== fb.face;
            flipB = this._ringFlipUser === null ? need : !!this._ringFlipUser;
            bridgeInfo = {
                atomId: bridge.atom.id, hostAId: bridge.hostA.id, hostBId: bridge.hostB.id,
                faceA: fa.face, faceB: fb.face,
                derivedA: fa.derived, derivedB: fb.derived,
                derivedViaA: fa.via ? substituentLabel(mol, fa.via.id, bridge.hostA.id) : null,
                derivedViaB: fb.via ? substituentLabel(mol, fb.via.id, bridge.hostB.id) : null,
                need, flipped: flipB,
                // そろったか ＝ 環B側の面（裏返したなら反転）が環A側と一致するか
                aligned: (flipB ? -fb.face : fb.face) === fa.face
            };
        }
        this._ringCycle = focus;

        const inRing = new Set([].concat(...cycles));
        const allRingAtoms = [].concat(...cycles).map(id => mol.atoms.find(a => a.id === id));
        if (allRingAtoms.some(a => !a)) return null;
        const cx = allRingAtoms.reduce((s, a) => s + a.x, 0) / allRingAtoms.length;
        const cy = allRingAtoms.reduce((s, a) => s + a.y, 0) / allRingAtoms.length;

        // 面の厚み depth: 環外置換基が実際に描かれている距離の平均（無ければ環結合長の 0.6 倍）。
        // 「描いた図と同じ長さだけ上下に出る」ので、真横にしたときの見た目が作図と地続きになる
        let bondSum = 0, bondN = 0;
        cycles.forEach(cyc => {
            const p = cyc.map(id => mol.atoms.find(a => a.id === id));
            for (let i = 0; i < p.length; i++) {
                const a = p[i], b = p[(i + 1) % p.length];
                bondSum += Math.hypot(b.x - a.x, b.y - a.y);
                bondN++;
            }
        });
        const subDist = [];
        allRingAtoms.forEach(a => {
            mol.getNeighbors(a.id).forEach(n => {
                if (inRing.has(n.atom.id) || n.atom.element === 'H') return;
                subDist.push(Math.hypot(n.atom.x - a.x, n.atom.y - a.y));
            });
        });
        const depth = subDist.length
            ? subDist.reduce((s, v) => s + v, 0) / subDist.length
            : 0.6 * (bondSum / Math.max(1, bondN));

        const nodes = [];
        const bonds = [];
        const bridgeAtomId = bridge ? bridge.atom.id : null;
        let bridgeNodeIdx = -1;
        const rings = [];

        cycles.forEach((cyc, ci) => {
            const flip = ci === 1 && flipB;
            const ringAtoms = cyc.map(id => mol.atoms.find(a => a.id === id));
            // 裏返しの折り返し軸は**その環自身の重心**（絵としてはその場で裏返る）。
            // 分子を裏返す flipHaworth の軸（橋の原子の y）とは縦の平行移動ぶんしか違わない
            const ringCy = ringAtoms.reduce((s, a) => s + a.y, 0) / ringAtoms.length;
            const X = a => a.x - cx;
            const Y = a => (flip ? 2 * ringCy - a.y : a.y) - cy;
            const F = f => (flip ? -f : f);
            const base = nodes.length;
            ringAtoms.forEach(a => {
                nodes.push({
                    kind: 'ring', atomId: a.id, hostId: null, element: a.element,
                    label: a.element, face: 0, ring: ci, v: [X(a), Y(a), 0]
                });
            });
            for (let i = 0; i < ringAtoms.length; i++) {
                bonds.push({ a: base + i, b: base + (i + 1) % ringAtoms.length, kind: 'ring' });
            }
            ringAtoms.forEach((a, ri) => {
                const outs = mol.getNeighbors(a.id)
                    .filter(n => !inRing.has(n.atom.id) && n.atom.element !== 'H');
                // 橋の原子の面は bridgeFaceOf の答え（§6-3 の救いを含む）を使う
                const faceOf = (host, sub) => sub.id === bridgeAtomId
                    ? (host.id === bridge.hostA.id ? bridgeInfo.faceA : bridgeInfo.faceB)
                    : StereoView.faceOfSubstituent(host, sub);
                outs.forEach(n => {
                    if (n.atom.id === bridgeAtomId && bridgeNodeIdx >= 0) {
                        // 橋は2つの環に1つだけ置く（環Bからは結合を足すだけ）
                        bonds.push({ a: base + ri, b: bridgeNodeIdx, kind: 'sub' });
                        return;
                    }
                    const face = faceOf(a, n.atom);
                    nodes.push({
                        kind: 'sub', atomId: n.atom.id, hostId: a.id, element: n.atom.element,
                        // ⚠ 橋のラベルは「相手の糖まるごと」になってしまうので元素記号にする
                        label: n.atom.id === bridgeAtomId
                            ? n.atom.element : substituentLabel(mol, n.atom.id, a.id),
                        face: F(face), ring: ci,
                        v: [X(n.atom), Y(n.atom), F(face) * depth]
                    });
                    bonds.push({ a: base + ri, b: nodes.length - 1, kind: 'sub' });
                    if (n.atom.id === bridgeAtomId) bridgeNodeIdx = nodes.length - 1;
                });
                // 暗黙H（環sp3炭素で環外の重原子がちょうど1本・面が読めた場合のみ）。
                // readRingParityFromHaworth が「H は反対の面」と読むのと同じ置き方にする
                const face = outs.length === 1 ? faceOf(a, outs[0].atom) : 0;
                if (a.element === 'C' && face !== 0 && mol.getFreeValency(a.id) >= 1) {
                    const s = outs[0].atom;
                    nodes.push({
                        kind: 'h', atomId: null, hostId: a.id, element: 'H', label: 'H',
                        face: F(-face), ring: ci,
                        v: [X(a) - (s.x - a.x), Y(a) - (flip ? -1 : 1) * (s.y - a.y), F(-face) * depth]
                    });
                    bonds.push({ a: base + ri, b: nodes.length - 1, kind: 'h' });
                }
            });
            const pts = ringAtoms.map(a => [X(a), Y(a)]);
            rings.push({
                cycle: cyc, base, size: cyc.length, flipped: flip,
                sense: StereoView.ringNumberingSense(mol, cyc, pts),
                label: StereoView.ringSugarLabel(mol, cyc)
            });
        });

        // どの向きに回してもはみ出さないよう、原点からの最大距離で拡大率を決める
        let radius = 1;
        nodes.forEach(n => { radius = Math.max(radius, Math.hypot(n.v[0], n.v[1], n.v[2])); });
        this._ringModel = {
            cycle: cycles[0], cycles, rings, nodes, bonds, depth, radius,
            scale: RING_VIEW_RADIUS / radius,
            center: { x: cx, y: cy },
            bridge: bridgeInfo
        };
        return this._ringModel;
    }

    /** 環の呼び名（「六員環」「五員環」）。二糖の説明文でどちらの環かを言うために使う */
    static ringSugarLabel(mol, cycle) {
        const JA = { 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八' };
        return (JA[cycle.length] || cycle.length) + '員環';
    }

    // ===== 分子全体の立体ビュー（P12-8 M4a。DESIGN_3d_correspondence.md 6章）=====
    // 模型づくりは chemistry.js の buildMolecule3D（DOM非依存）。ここは表示だけ。
    // 描画は環ビューと同じ流れ（模型→回転→弱透視→奥から描く）

    buildMolModel() {
        this._molModel = null;
        if (typeof buildMolecule3D !== 'function') return null;
        // 組むのは**いま見ている分子**だけ（_scope。指定が無ければ従来どおりキャンバス全体）
        const r = buildMolecule3D(this._scope || this.game.userMolecule);
        if (!r.ok) { this._molModel = r; return r; }
        this._molModel = Object.assign({}, r, { scale: MOL_VIEW_RADIUS / r.radius });
        return this._molModel;
    }

    /** 分子全体タブを使えるか（組めない分子は無効化して理由を出す）。show() から呼ぶ */
    updateMolTabState() {
        const m = this._molModel;
        const ok = !!(m && m.ok);
        if (this.tabMol) {
            this.tabMol.disabled = !ok;
            this.tabMol.title = ok
                ? '分子全体を立体で回します（作図の直交座標ではなく、正しい結合角で組み直した模型です）'
                : (m && m.reason) || '分子全体の立体は組み立てられません。';
            this.tabMol.setAttribute('data-mol-available', ok ? '1' : '0');
        }
    }

    molYawDeg() {
        const d = Math.round(this.molYaw * 180 / Math.PI) % 360;
        return d < 0 ? d + 360 : d;
    }

    nudgeMolYaw(deg) { this.molYaw += deg * Math.PI / 180; this.renderMol(); }

    resetMolView() { this.molYaw = 0; this.molPitch = 0; this.renderMol(); }

    setMolShowH(on) { this.molShowH = !!on; this.renderMol(); }

    setMolSpin(on) {
        this.molSpin = !!on;
        if (this.molSpin && this.mode === 'mol') this.startMolSpin(); else this.stopMolSpin();
        this.updateMolButtons();
    }

    startMolSpin() {
        this.stopMolSpin();
        if (!this.molSpin) { this.updateMolButtons(); return; }
        const step = () => {
            this.molYaw += 0.012;
            this.renderMol();
            this._molRaf = requestAnimationFrame(step);
        };
        this._molRaf = requestAnimationFrame(step);
    }

    stopMolSpin() {
        if (this._molRaf) { cancelAnimationFrame(this._molRaf); this._molRaf = null; }
    }

    bindMolDrag() {
        const svg = this.molSvg;
        if (!svg) return;
        svg.addEventListener('pointerdown', (e) => {
            this._molDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
            this.setMolSpin(false); // つかんだら自動回転は止める（手で見たい向きに合わせられる）
            svg.style.cursor = 'grabbing';
            try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 非対応環境では無視 */ }
            e.preventDefault();
        });
        svg.addEventListener('pointermove', (e) => {
            if (!this._molDrag || this._molDrag.id !== e.pointerId) return;
            this.molYaw += (e.clientX - this._molDrag.x) * 0.01;
            this.molPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
                this.molPitch + (e.clientY - this._molDrag.y) * 0.01));
            this._molDrag.x = e.clientX;
            this._molDrag.y = e.clientY;
            this.renderMol();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
            svg.addEventListener(type, () => { this._molDrag = null; svg.style.cursor = 'grab'; });
        });
    }

    updateMolButtons() {
        if (this.molYawValueEl) this.molYawValueEl.textContent = this.molYawDeg() + '°';
        if (this.molBtnSpin) {
            this.molBtnSpin.textContent = this.molSpin ? '⏸ 自動回転を止める' : '▶ 自動で回す';
            this.molBtnSpin.classList.toggle('active', this.molSpin);
        }
        if (this.molBtnH) {
            this.molBtnH.textContent = this.molShowH ? 'H を隠す' : 'H も表示';
            this.molBtnH.classList.toggle('active', this.molShowH);
        }
    }

    updateMolNote() {
        if (!this.molNoteEl) return;
        const m = this._molModel;
        if (!m || !m.ok) { this.molNoteEl.textContent = (m && m.reason) || ''; return; }
        const heavy = m.nodes.filter(n => n.kind === 'atom').length;
        const hs = m.nodes.filter(n => n.kind === 'h').length;
        const hasRing = !!(this._ringModel && this._ringModel.nodes);
        // キャンバスに分子が2つ以上あると、この図には**全部が入る**。
        // 1つの分子の模型だと誤解されないよう、何が入っているかを先に言う
        // （P12-8。ユーザー要望「どの分子を対象にするか識別する仕組みが必要」）
        const parts = this.componentsInfo();
        const multi = parts.length >= 2
            ? `この図には ${parts.length} つの分子が入っています（${parts.map(p => p.name).join(' ／ ')}）。` +
              `位置関係は作図とは関係なく、重ならないように並べたものです。\n`
            : '';
        this.molNoteEl.textContent = multi +
            `重原子 ${heavy} 個・水素 ${hs} 個の模型です。この図は作図の座標をそのまま持ち上げたものでは` +
            `ありません（作図は直交格子＝結合角90°のため、そのまま立体にすると誤った形になります）。` +
            `結合のつながりと、あなたが描いた立体（くさび・ハース図の面・シス/トランス）だけを使い、` +
            `鎖の結合角を 109.5°／120°／180° で組み直しています。\n` +
            `不斉炭素原子の手前・奥、C=C のシス/トランス、環の置換基の上下は、` +
            `描いた図から読んだものと一致します（回しても入れ替わりません）。` +
            (hasRing ? '\n環は平面とみなし、正多角形に組み直しています（ハース図は遠近を出すため潰して描くので、そのままでは結合の長さが揃いません）。' : '');
    }

    renderMol() {
        const svg = this.molSvg;
        if (!svg) return;
        svg.innerHTML = '';
        this.updateMolButtons();
        this.updateMolNote();
        const m = this._molModel;
        if (!m || !m.ok) return;
        const s = m.scale;
        const pts = m.nodes.map((n, i) => {
            const r = StereoView.rotateYX([n.v[0] * s, n.v[1] * s, n.v[2] * s], this.molYaw, this.molPitch);
            const k = MOL_VIEW_PERSP / (MOL_VIEW_PERSP - r[2]);
            return { i, node: n, z: r[2], k, x: r[0] * k, y: r[1] * k };
        });
        this._molDrawn = pts;
        const shown = p => p.node.kind !== 'h' || this.molShowH;
        const items = [];
        m.bonds.forEach(b => {
            const p = pts[b.a], q = pts[b.b];
            if (!shown(p) || !shown(q)) return;
            items.push({ z: (p.z + q.z) / 2, draw: () => this.drawMolBond(p, q, b.order) });
        });
        pts.forEach(p => { if (shown(p)) items.push({ z: p.z, draw: () => this.drawMolNode(p) }); });
        items.sort((a, b) => a.z - b.z);
        items.forEach(it => it.draw());
    }

    drawMolBond(p, q, order) {
        const g = this.svgGroupIn(this.molSvg, StereoView.ringShade((p.z + q.z) / 2));
        g.setAttribute('data-mol-bond', String(order));
        const isH = p.node.kind === 'h' || q.node.kind === 'h';
        const w = (isH ? 1.6 : 3) * ((p.k + q.k) / 2);
        const color = isH ? 'rgba(255,255,255,0.5)' : 'var(--neon-blue)';
        this.line(g, p.x, p.y, q.x, q.y, w, color);
        if (order >= 2 && !isH) {
            // 多重結合は線を横にずらして重ねる（次数が見えるように）
            const dx = q.x - p.x, dy = q.y - p.y;
            const L = Math.hypot(dx, dy) || 1;
            const off = 3.2 * ((p.k + q.k) / 2);
            for (let s = 1; s < order; s++) {
                const d = (s % 2 === 1 ? 1 : -1) * off * Math.ceil(s / 2);
                this.line(g, p.x - dy / L * d, p.y + dx / L * d, q.x - dy / L * d, q.y + dx / L * d, w * 0.7, color);
            }
        }
    }

    drawMolNode(p) {
        const n = p.node;
        const g = this.svgGroupIn(this.molSvg, StereoView.ringShade(p.z));
        g.setAttribute('data-mol-node', n.kind);
        if (n.atomId !== null && n.atomId !== undefined) g.setAttribute('data-atom-id', String(n.atomId));
        const color = StereoView.colorOf(n.label);
        const focus = n.atomId === this.centerId;
        const r = (n.kind === 'h' ? 7 : 11) * p.k;
        this.circle(g, p.x, p.y, r, color, (focus ? 4 : n.kind === 'h' ? 1.5 : 2.4) * p.k);
        this.text(g, p.x, p.y + (n.kind === 'h' ? 3.4 : 4.5) * p.k, n.label, (n.kind === 'h' ? 10 : 13) * p.k, color);
    }

    /** カメラの倒し角（度）。0=ハース図のまま・90=真横・180=裏返したハース図 */
    ringTiltDeg() { return Math.round(this.ringTilt * 180 / Math.PI); }

    setRingTiltDeg(deg) {
        const d = Math.max(0, Math.min(RING_TILT_MAX_DEG, Number(deg) || 0));
        this.ringTilt = d * Math.PI / 180;
        this.renderRing();
    }

    /** 縦軸まわりの回転角（度・0〜359に丸めた表示用の値） */
    ringYawDeg() {
        const d = Math.round(this.ringYaw * 180 / Math.PI) % 360;
        return d < 0 ? d + 360 : d;
    }

    /** 縦軸まわりに回す（ボタン用。ドラッグと同じ回転を決まった刻みで行う） */
    nudgeRingYaw(deg) {
        this.ringYaw += deg * Math.PI / 180;
        this.renderRing();
    }

    /**
     * カメラのプリセット（'haworth'=描いたハース図と同じ向き／'side'=真横／'flip'=裏返す）。
     *
     * ⚠ **'flip'（倒し角180°）はハース図を裏返した図そのもの**（DESIGN_sugar.md §3-4 R-1）。
     * `rotateZX` の angleX=π は (x,y,z)→(x,−y,−z) ＝ 「上下入替」と「たどる向き逆」が
     * 同時に起きる回転なので、**分子は1つも変わらない**（環をもつ糖16件で立体コード 16/16 同一）。
     * 教材としての芯はここ ——「上下だけ入れ替えた図は別の分子だが、裏返した図は同じ分子」。
     */
    setRingCamera(which) {
        this.ringYaw = 0;
        this.ringTilt = which === 'haworth' ? 0 : which === 'flip' ? Math.PI : Math.PI / 2;
        this.renderRing();
    }

    setRingShowH(on) {
        this.ringShowH = !!on;
        this.renderRing();
    }

    /**
     * 二糖の「もう一方の環を裏返す」を切り替える（DESIGN_sugar.md §3-4 R-3）。
     *
     * 既定（`_ringFlipUser === null`）は**橋の面がそろう向き** ＝ 教科書の向き
     * （スクロースならフルクトース環が反時計回り）。押すと `compounds.json` に登録されている
     * ままの向き（16件すべて時計回り）へ戻り、もう一度押すと戻る。**行き来できることが要**
     * ——入試の「どれが正しい図か」は、この2枚を見比べる問いだから。
     * ⚠ **どちらの向きでも分子は同じ**（裏返しは回転なので立体コードも名前も変わらない）。
     */
    toggleRingFlip() {
        const m = this._ringModel;
        if (!m || !m.bridge) return;
        this._ringFlipUser = !m.bridge.flipped;
        this.buildRingModel();
        this.renderRing();
    }

    // 横ドラッグ＝環を縦軸まわりに回す（＝独楽回転）／縦ドラッグ＝カメラの倒し角（0〜180°）
    rotateRingBy(dYaw, dTilt) {
        this.ringYaw += dYaw;
        this.ringTilt = Math.max(0, Math.min(RING_TILT_MAX, this.ringTilt + dTilt));
        this.renderRing();
    }

    bindRingDrag() {
        const svg = this.ringSvg;
        if (!svg) return;
        svg.addEventListener('pointerdown', (e) => {
            this._ringDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
            svg.style.cursor = 'grabbing';
            try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 非対応環境では無視 */ }
            e.preventDefault();
        });
        svg.addEventListener('pointermove', (e) => {
            if (!this._ringDrag || this._ringDrag.id !== e.pointerId) return;
            const dx = e.clientX - this._ringDrag.x;
            const dy = e.clientY - this._ringDrag.y;
            this._ringDrag.x = e.clientX;
            this._ringDrag.y = e.clientY;
            this.rotateRingBy(dx * 0.01, dy * 0.01);
            e.preventDefault();
        });
        const end = () => {
            if (!this._ringDrag) return;
            this._ringDrag = null;
            svg.style.cursor = 'grab';
        };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
    }

    /** 奥ほど暗くする（3Dビューと同じ画家のアルゴリズムの一部） */
    static ringShade(z) {
        const t = (z + RING_VIEW_RADIUS) / (2 * RING_VIEW_RADIUS);
        return 0.45 + 0.55 * Math.max(0, Math.min(1, t));
    }

    renderRing() {
        const svg = this.ringSvg;
        this._ringDrawn = null;
        if (!svg) return;
        svg.innerHTML = '';
        this.updateRingButtons();
        this.updateRingNote();
        const m = this._ringModel;
        if (!m) return;
        const NS = 'http://www.w3.org/2000/svg';
        const s = m.scale;
        // 模型 → 回転（Z=環の面内で回す・X=カメラの倒し角）→ 弱い透視投影
        const pts = m.nodes.map((n, i) => {
            const r = StereoView.rotateZX([n.v[0] * s, n.v[1] * s, n.v[2] * s], this.ringYaw, this.ringTilt);
            const k = RING_VIEW_PERSP / (RING_VIEW_PERSP - r[2]);
            return { i, node: n, z: r[2], k, x: r[0] * k, y: r[1] * k };
        });
        const shown = p => p.node.kind !== 'h' || this.ringShowH;
        this.staggerRingLabels(pts.filter(shown));
        this._ringDrawn = pts;

        // 環が張る「面」を薄く敷く（平面とみなしていることが一目で分かる。真横では線に潰れる）。
        // 二糖では2枚敷く ＝ **2つの環が同じ平面に乗っている**ことがそのまま絵に出る
        (m.rings || [{ base: 0, size: m.cycle.length }]).forEach((r, ri) => {
            const poly = document.createElementNS(NS, 'polygon');
            const seq = [];
            for (let i = 0; i < r.size; i++) {
                const p = pts[r.base + i];
                seq.push(p.x.toFixed(1) + ',' + p.y.toFixed(1));
            }
            poly.setAttribute('points', seq.join(' '));
            poly.setAttribute('fill', 'rgba(0,242,254,0.10)');
            poly.setAttribute('stroke', 'rgba(0,242,254,0.35)');
            poly.setAttribute('stroke-width', '1.2');
            poly.setAttribute('stroke-dasharray', '5 4');
            poly.setAttribute('data-ring-plane', String(ri + 1));
            svg.appendChild(poly);
        });

        // 奥から順に描く（画家のアルゴリズム）。結合は中点の z で並べる
        const items = [];
        m.bonds.forEach(b => {
            const p = pts[b.a], q = pts[b.b];
            if (!shown(p) || !shown(q)) return;
            items.push({ z: (p.z + q.z) / 2, draw: () => this.drawRingBond(p, q, b.kind) });
        });
        pts.forEach(p => { if (shown(p)) items.push({ z: p.z, draw: () => this.drawRingNode(p) }); });
        items.sort((a, b) => a.z - b.z);
        items.forEach(it => it.draw());
    }

    /**
     * 重なったラベルを面の外側へずらす（P12-8。表示だけの調整で、上下＝面の別は保つ）。
     * 真横にすると同じ面の置換基が同じ高さに並ぶため、横に近い位置のものが重なってしまう。
     */
    staggerRingLabels(pts) {
        [-1, 1].forEach(dir => { // dir=-1: 画面の上側（手前の面）／+1: 下側（奥の面）
            const list = pts
                .filter(p => (p.node.kind === 'sub' || p.node.kind === 'h') &&
                             (dir < 0 ? p.y < 0 : p.y >= 0))
                .sort((a, b) => a.x - b.x);
            const placed = [];
            list.forEach(cur => {
                for (let step = 0; step <= RING_LABEL_STEPS; step++) {
                    const y = cur.y + dir * RING_LABEL_STEP * step;
                    const clash = placed.some(o =>
                        Math.abs(cur.x - o.x) < RING_LABEL_HALF(cur.node.label, cur.k) +
                                                RING_LABEL_HALF(o.node.label, o.k) + 3 &&
                        Math.abs(y - o.y) < 26);
                    if (!clash || step === RING_LABEL_STEPS) { cur.y = y; break; }
                }
                placed.push(cur);
            });
        });
    }

    drawRingBond(p, q, kind) {
        const g = this.svgGroupIn(this.ringSvg, StereoView.ringShade((p.z + q.z) / 2));
        g.setAttribute('data-ring-bond', kind);
        let w = (kind === 'ring' ? 3.4 : kind === 'h' ? 1.8 : 2.4) * ((p.k + q.k) / 2);
        // ハース投影の慣習にならい、**手前側の環結合を太く**描く（P12-8。ユーザー要望）。
        // 手前かどうかは 3D モデルの z（カメラ側が正）で決めるので、環を回しても正しく入れ替わる。
        // 倒し角0°（ハース図の向き）では環が z=0 平面にあり差が出ないため、そのときは効かない
        const zMid = (p.z + q.z) / 2;
        if (kind === 'ring' && zMid > 1) {
            g.setAttribute('data-ring-front', '1');
            w *= 1.7;
        }
        const color = kind === 'ring' ? 'var(--neon-blue)' : 'rgba(255,255,255,0.6)';
        this.line(g, p.x, p.y, q.x, q.y, w, color);
    }

    drawRingNode(p) {
        const n = p.node;
        const g = this.svgGroupIn(this.ringSvg, StereoView.ringShade(p.z));
        g.setAttribute('data-ring-node', n.kind);
        g.setAttribute('data-face', String(n.face));
        if (n.atomId !== null && n.atomId !== undefined) g.setAttribute('data-atom-id', String(n.atomId));
        const color = StereoView.colorOf(n.label);
        if (n.kind === 'ring') {
            // 立体表示のために選んだ炭素は太い枠で示す（どこを見ているか迷わないように）
            const focus = n.atomId === this.centerId;
            this.circle(g, p.x, p.y, 11 * p.k, color, (focus ? 4 : 2.4) * p.k);
            this.text(g, p.x, p.y + 4.5 * p.k, n.label, 13 * p.k, color);
        } else {
            const dim = n.kind === 'h';
            this.ellipse(g, p.x, p.y, RING_LABEL_HALF(n.label, p.k), 13.5 * p.k, color,
                (dim ? 1.5 : 2.4) * p.k);
            this.text(g, p.x, p.y + 4.2 * p.k, n.label, 12 * p.k, color);
        }
    }

    /** 環タブを使えるか（環がなければ無効化して理由を出す）。show() から呼ぶ */
    updateRingTabState() {
        const ok = !!this._ringModel;
        if (this.tabRing) {
            this.tabRing.disabled = !ok;
            this.tabRing.title = ok
                ? '環を平面とみなして真横から見ます（置換基が上下どちらに出ているかが直接見えます）'
                : (this._ringUnavailReason || RING_NO_RING_REASON);
            this.tabRing.setAttribute('data-ring-available', ok ? '1' : '0');
        }
        if (this.ringHintEl) {
            this.ringHintEl.textContent = ok ? '' : (this._ringUnavailReason || RING_NO_RING_REASON);
            this.ringHintEl.classList.toggle('hidden', ok);
        }
    }

    updateRingButtons() {
        const deg = this.ringTiltDeg();
        if (this.ringTiltInput && String(this.ringTiltInput.value) !== String(deg)) {
            this.ringTiltInput.value = String(deg);
        }
        if (this.ringTiltValueEl) this.ringTiltValueEl.textContent = deg + '°';
        if (this.ringYawValueEl) this.ringYawValueEl.textContent = this.ringYawDeg() + '°';
        // 倒し角は 0〜180° まで開いているので、「真横」は 90° の近くだけ光らせる（180° でも光らない）
        if (this.ringBtnSide) this.ringBtnSide.classList.toggle('active', deg >= 88 && deg <= 92);
        if (this.ringBtnHaworth) this.ringBtnHaworth.classList.toggle('active', deg <= 2);
        if (this.ringBtnFlip) this.ringBtnFlip.classList.toggle('active', deg >= 178);
        if (this.ringBtnH) {
            this.ringBtnH.textContent = this.ringShowH ? 'H を隠す' : 'H も表示';
            this.ringBtnH.classList.toggle('active', this.ringShowH);
        }
        // 二糖のときだけ「もう一方の環を裏返す」を出す（環1つの分子には意味が無い操作）
        const br = this._ringModel && this._ringModel.bridge;
        if (this.ringBtnFlipRing) {
            this.ringBtnFlipRing.classList.toggle('hidden', !br);
            if (br) {
                const other = this._ringModel.rings[1];
                this.ringBtnFlipRing.textContent = br.flipped
                    ? `⇅ ${other.label}を登録の向きへ` : `⇅ ${other.label}を裏返す`;
                this.ringBtnFlipRing.classList.toggle('active', br.flipped);
                this.ringBtnFlipRing.title = br.flipped
                    ? 'いまは橋の酸素の上下が2つの環でそろう向き（教科書の向き）です。押すと、アプリに登録されているままの向きに戻ります（どちらも同じ分子です）。'
                    : 'いまはアプリに登録されているままの向きです。押すと、橋の酸素の上下が2つの環でそろう向き（教科書の向き）になります（どちらも同じ分子です）。';
            }
        }
    }

    updateRingNote() {
        if (!this.ringNoteEl) return;
        const m = this._ringModel;
        if (!m) { this.ringNoteEl.textContent = this._ringUnavailReason || RING_NO_RING_REASON; return; }
        const deg = this.ringTiltDeg();
        const up = m.nodes.filter(n => n.kind === 'sub' && n.face === 1).length;
        const down = m.nodes.filter(n => n.kind === 'sub' && n.face === -1).length;
        const flat = m.nodes.filter(n => n.kind === 'sub' && n.face === 0).length;
        // 糖（環に酸素を含む＝ピラノース環）以外では「ハース図」「α/β」は的外れなので言い換える
        // （P12-8。ユーザー指摘「解説文が糖前提になっている」）
        const isSugarRing = (this._ringCycle || []).some(id => {
            const a = this.mol && this.mol.atoms.find(x => x.id === id);
            return a && a.element === 'O';
        });
        const parts = [];
        if (m.bridge) {
            // ===== 二糖（環2つ）=====
            // ⚠ **「同一平面」は仮定**だと真っ先に言う（断定しない。DESIGN_sugar.md §3-5）
            parts.push(RING_COPLANAR_CAVEAT);
            const a = m.rings[0], b = m.rings[1];
            const sense = r => r.sense === 1 ? '時計回り' : r.sense === -1 ? '反時計回り' : '向きは決められません';
            parts.push(`2つの環（${a.label}と${b.label}）を同じ平面（z=0）に置き、-O- 1本でつないでいます。` +
                       `炭素番号をたどる向きは ${a.label}が${sense(a)}・${b.label}が${sense(b)} です。`);
            if (m.bridge.flipped) {
                parts.push(`★ ${b.label}のほうは**裏返して**置いています。こうしないと、橋の酸素の上下が` +
                           '2つの環で食い違って「同じ平面」に置けません。' +
                           '裏返すと「置換基の上下」と「番号をたどる向き」が同時に入れ替わるので、' +
                           '分子は同じままです（アプリが出す名前も変わりません）。' +
                           '⚠ 片方だけ ——たとえば上下だけを入れ替える—— と別の分子（鏡像体）になります。' +
                           'スクロースのフルクトース環が教科書で「ふつうと逆向き（反時計回り）」に' +
                           '描かれるのは、この裏返しのためです。');
            } else if (m.bridge.need) {
                parts.push('⚠ いまは「⇅」で登録どおりの向きに戻しているので、橋の酸素の上下が' +
                           `2つの環で食い違っています（${a.label}から見ると${m.bridge.faceA === 1 ? '上' : '下'}・` +
                           `${b.label}から見ると${m.bridge.faceB === 1 ? '上' : '下'}）。` +
                           'この図では「同じ平面」の仮定が成り立ちません。もう一度押すと、そろえた向きに戻ります。');
            } else {
                parts.push(`橋の酸素の上下は、2つの環のどちらから読んでも${m.bridge.faceA === 1 ? '上' : '下'}で` +
                           '一致しているので、裏返さずにそのまま同じ平面に置けています。');
            }
            if (m.bridge.derivedA || m.bridge.derivedB) {
                // ⚠ 読めなかった側は**推測ではなく規約**で埋めたが、そう書かないと黙って決めたことになる
                const side = m.bridge.derivedB ? b.label : a.label;
                const via = m.bridge.derivedB ? m.bridge.derivedViaB : m.bridge.derivedViaA;
                parts.push(`※ ${side}側では、橋への結合が縦から外れて描かれているため上下を直接は読めません。` +
                           `代わりに、同じ炭素のもう1本（${via}）が縦に描かれていることを使い、` +
                           'ハース投影では環外の2本が必ず反対の面に出るという約束からその反対の面と' +
                           '決めています（アプリが名前を読むときと同じ規約です）。');
            }
            parts.push('横方向のドラッグ（⟲⟳ボタン）は、2つの環をその面のまま独楽のように回します。' +
                       '縦方向のドラッグでは倒し角が変わります。' +
                       '真横（90°）にすると2つの環がひとつの線に潰れ、置換基だけが上下に突き出します。');
            this.ringNoteEl.textContent = parts.join('\n');
            return;
        }
        if (isSugarRing) {
            parts.push(`${m.cycle.length}員環を平面とみなし、環の原子を平面（z=0）に、環外の置換基を` +
                       `上の面（手前）か下の面（奥）に置いた模型です。上下は、あなたが描いたハース図の縦位置と` +
                       `「⬍ α/β 面マーク」から読んでいます（上 ${up} 個・下 ${down} 個）。`);
        } else {
            parts.push(`${m.cycle.length}員環を平面とみなし、環の原子を平面（z=0）に、環外の置換基を` +
                       `上の面（手前）か下の面（奥）に置いた模型です。上下は、あなたが環炭素の真上・真下に` +
                       `描いたかと「⬍ 面マーク」から読んでいます（上 ${up} 個・下 ${down} 個）。`);
        }
        if (flat && up + down === 0) {
            // 上下が1つも決まっていない＝この図は面について何も言っていない。
            // 斜めの結合から「たぶん上」と推測してはいけない（描いていない立体を作ることになる）
            parts.push(`※ この図は置換基の上下を指定していません（${flat} 個とも平面上に置いています）。` +
                       '斜めに描かれた結合からは上下を決められないので、勝手には決めません。' +
                       '環炭素の真上・真下に描くか「⬍ 面マーク」で指定すると、横から見たときに突き出します。');
        } else if (flat) {
            parts.push(`※ ${flat} 個の置換基は縦に描かれていないため面が決まりません（平面上に置いています）。` +
                       '環炭素の真上・真下に描くか「⬍ 面マーク」で指定すると読めるようになります。');
        }
        if (deg <= 2) {
            parts.push('いまの倒し角 0° では、環はあなたが描いたハース図とまったく同じ位置に並びます' +
                       '（上の面の置換基は手前にあるぶん、ほんの少し大きく見えます）。' +
                       'スライダーを右へ動かすか「⬡ 真横」を押すと、この立体をそのまま横へ倒していけます。');
        } else if (deg >= 88 && deg <= 92) {
            parts.push('いまの倒し角 90°（真横）では環が線に潰れ、置換基だけが上下に突き出します。' +
                       '置換基が上か下かが、そのまま目で見えます（糖なら α/β や各OHの向きにあたります）。');
        } else if (deg >= 178) {
            // ★ ここが「見かけが変わっても同じ分子」を見せる場所（DESIGN_sugar.md §3-5）
            parts.push('いまの倒し角 180° では、環を裏返して見ています（裏返したハース図）。' +
                       '上下（手前と奥）が入れ替わって見えますが、分子は同じままです。');
            parts.push('裏返すと「置換基の上下」と「炭素番号をたどる向き」が同時に入れ替わります。' +
                       'この2つはセットなので分子は変わりません（アプリが出す名前も変わりません）。' +
                       '⚠ 片方だけ ——たとえば上下だけを入れ替える—— と、別の分子（鏡像体）になってしまいます。');
        } else if (deg > 92) {
            parts.push(`いまの倒し角は ${deg}° で、環を裏側から見ています。手前と奥が入れ替わって見えます` +
                       '（180° まで倒すと、裏返したハース図になります）。');
        } else {
            parts.push(`いまの倒し角は ${deg}° です。0°（ハース図そのもの）と 90°（真横）を連続で行き来できるので、` +
                       'ハース図が「何を描いた図なのか」がつながります。' +
                       'さらに 180° まで倒すと、環を裏返した図（同じ分子）になります。');
        }
        parts.push('横方向のドラッグ（⟲⟳ボタン）は、環をその面のまま独楽のように回します。' +
                   'これも分子を変えない操作です。縦方向のドラッグでは倒し角が変わります。');
        this.ringNoteEl.textContent = parts.join('\n');
    }

    // ===== SVG 小道具 =====

    static colorOf(label) {
        const el = /^(Cl|Br)/.test(label) ? label.slice(0, 2) : label.slice(0, 1);
        const map = { C: '--color-c', O: '--color-o', N: '--color-n', H: '--color-h',
                      S: '--color-s', Cl: '--color-cl', Br: '--color-br', I: '--color-i' };
        return `var(${map[el] || '--color-c'})`;
    }

    // 任意の親に半透明グループを作る（環ビューが自分の SVG へ描くために使う。P12-8）
    svgGroupIn(parent, opacity) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('opacity', Math.max(0.3, Math.min(1, opacity)).toFixed(3));
        parent.appendChild(g);
        return g;
    }

    svgGroup(opacity) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('opacity', Math.max(0.3, Math.min(1, opacity)).toFixed(3));
        this.svg3d.appendChild(g);
        return g;
    }

    line(parent, x1, y1, x2, y2, w, color) {
        const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('x1', x1.toFixed(2)); l.setAttribute('y1', y1.toFixed(2));
        l.setAttribute('x2', x2.toFixed(2)); l.setAttribute('y2', y2.toFixed(2));
        l.setAttribute('stroke', color);
        l.setAttribute('stroke-width', w.toFixed(2));
        l.setAttribute('stroke-linecap', 'round');
        parent.appendChild(l);
    }

    ellipse(parent, cx, cy, rx, ry, color, w) {
        const e = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        e.setAttribute('cx', cx.toFixed(2)); e.setAttribute('cy', cy.toFixed(2));
        e.setAttribute('rx', rx.toFixed(2)); e.setAttribute('ry', ry.toFixed(2));
        e.setAttribute('fill', 'rgba(15,20,28,0.94)');
        e.setAttribute('stroke', color);
        e.setAttribute('stroke-width', w.toFixed(2));
        parent.appendChild(e);
    }

    circle(parent, cx, cy, r, color, w) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', cx.toFixed(2)); c.setAttribute('cy', cy.toFixed(2));
        c.setAttribute('r', r.toFixed(2));
        c.setAttribute('fill', 'rgba(15,20,28,0.94)');
        c.setAttribute('stroke', color);
        c.setAttribute('stroke-width', w.toFixed(2));
        parent.appendChild(c);
    }

    text(parent, x, y, str, size, color) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x.toFixed(2)); t.setAttribute('y', y.toFixed(2));
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'svg-atom-text');
        t.setAttribute('fill', color);
        t.style.fontSize = size.toFixed(1) + 'px';
        t.textContent = str;
        parent.appendChild(t);
    }
}
