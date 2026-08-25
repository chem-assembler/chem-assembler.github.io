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
// クイズの出題範囲の追加名簿（quiz-scope.json。{ note, textbook: [名前, …] }）。
// **構造から導出できない「高校で扱うか」だけを人が名前で印を付ける場所**（quiz.js が読む）
let QUIZ_SCOPE = { textbook: [] };
const GRID_SIZE = 42;
// 別々の分子（連結成分）の重原子どうしが、これより近づいてはいけない距離（px）。
// 新規配置（getSnappedCoords）・分子ごとの移動（canMoveComponentBy）・答案の並べ直し
// （tidyAnswerSlots）が**同じ1つのしきい値**を見る ＝ 0.0px の完全重複を作る経路を1本も残さない。
// 罠の由来は ZD の帯（tests.js）を参照
const MIN_COMPONENT_CLEARANCE = GRID_SIZE * 0.65;
// 作図できる座標の上限（px）。これを超えた位置には原子を置けない（getSnappedCoords が弾く）。
// 名称呼び出しの並べ方もこの値を守る必要があるので、両方から見える場所に置く
const CANVAS_LIMIT = 5000;
// 名称呼び出しで分子を右へ並べるときの1段の幅。これを超えたら下の段へ折り返す。
// 上限（5000）まで一直線に並べると、端の分子が編集できない場所に入ってしまう
const SUMMON_ROW_WIDTH = 2400;
// 名称呼び出しのあと、**呼んだ分子が「見えた」と言える最小の大きさ**（結合1本＝1マスの画面px）。
// 呼び出しは視野をキャンバス全体に合わせ直すので、分子が増えるほど呼んだ本人が縮む。
// 実測（1280×800・🧪自由・可視域 953×571px）: 大きい分子を14個置いたキャンバスへ
// 1-ブタノールを呼ぶと画面上 41px 幅（結合1本 13.7px・原子の丸は 5px）まで縮み、
// 端まで並んだ最悪ケースでは 7px まで落ちる ＝ 視野の中にはあるが読めも押せもしない。
// これを割ったら「呼んだ分子のほうへ視野を寄せ直す」（既存の原子は1つも動かさない）。
// 24 は原子の丸（半径10）が画面上 11px になる線で、押せるものの床 32px（TAP1）の内側にあたる
const SUMMON_MIN_BOND_PX = 24;
// 名称呼び出しの候補リスト（自前実装・v1406）で一度に描く最大件数。
// 登録は 900件超あるので、全部を DOM に起こすと1打鍵ごとに数百ノードを作り直すことになる。
// 溢れたぶんは末尾の「…ほか N 件」で件数だけ告げる（黙って切ると「無い」に見える）
const SUMMON_AC_MAX = 60;

// ===== 当たり判定の数直線（DESIGN_hit_areas.md 決定1）=====
//
//   d(最寄り原子までの距離): 0 ──── 18 ──────────── 63 ────────→
//                              その原子への操作   隣に足す（吸着）   自由配置
//                              （削除・元素置換）                （新しい分子を始める）
//
// **なぜ帯を分けるか**: もとは `findAtomAt` の 28px が先に「原子のクリック」を拾うので、
// 足すつもりで 20〜26px を押すと**先端の原子が消えた**（発注書 2d。実際に4回踏んだ）。
// 破壊的な操作をグリフの上（10px）＋余白（8px）だけに閉じ込め、その外側は全部「足す」にする。
const ATOM_TAP_RADIUS = 18;
// **非破壊の 28px は動かさない**（ドラッグの掴み・結合ツールの始点・消しゴム・立体/反応のピック）。
// ツールを選ぶ・Shift を押す、という意図表明があるので、狭める理由がない。

// 当たり判定のつまみ。既定値が本番の値で、**否定対照テスト（HA1〜HA4）が一時的に差し替える**。
// 「直したつもりで何も検査していない」を避けるために、旧挙動をコード側に残して
// **本番の経路をそのまま旧式で走らせられる**ようにしてある（テスト側で幾何を書き写すと、
// 書き写した式が古びても誰も気づかない）。
const HIT_AREAS = {
    atomTapRadius: ATOM_TAP_RADIUS,
    snapRadius: GRID_SIZE * 1.5,  // = 63px。置きたい点（42px 先）が帯の**中**に入る（±21px の余裕）
    tieBreakPx: 8,                // 成果の差がこれ以内なら「指の真下」を優先（DESIGN §1-E）
    tapMovePx: 8,                 // 押してから離すまでにこれ（client px）を超えて動いたら破壊操作は捨てる
    legacyWinner: false,          // true: 旧式の勝敗則（候補点込みの最短距離）
    legacyTapNoCancel: false,     // true: 動いたタップも実行する旧挙動（否定対照 TC5）
    legacyIsolation: false,       // true: 環モジュールの孤立禁止則を復活
    legacyGridRound: false,       // true: グリッド丸めを素の Math.round に戻す（否定対照 GR3）
    legacyBondCross: false,       // true: 結合線が原子の下をくぐる検査を外す（否定対照 BX3）
    legacyHydrogenCross: false    // true: 結合線が自動水素の下をくぐる検査を外す（否定対照 HX3）
};

/**
 * ★ 結合を作り直すときに、**追加のプロパティだけ**を引き継ぐ（v1435）。
 *
 * ⚠ **`Object.assign(bond, src)` にしてはいけない。** `Bond` のコンストラクタは
 *   「IDの小さい方を必ず `atomId1` にする」と正規化しており、`getBond()` も
 *   `removeBond()` もその不変条件の上に立っている。丸ごと上書きすると、
 *   **正規化されていない元データがそのまま入って不変条件が壊れる**。
 *
 * **実際にそうなった（実測・v1435）**: `demos-stereo.json` の V12（グルコースの変旋光）は
 *   `{"atomId1":"v12o5","atomId2":"v12c1"}` のように**逆順で書いてある**行があり、
 *   `Object.assign` にしたら `restoreState` のあと「環化 → β-D-グルコース」の反応が
 *   候補から消えた（`N2` が赤くなった）。⚠ **原子側（`Object.assign(atom, a)`）は
 *   正規化を持たないので同じ書き方で安全**、という非対称がここにある。
 *
 * 引き継ぐのは `isStereoMarked`（段1 の結合の印）のような**後から足した1ビット**だけ。
 */
function copyBondExtras(bond, src) {
    if (!src) return bond;
    Object.keys(src).forEach(k => {
        if (k === 'atomId1' || k === 'atomId2' || k === 'type') return;
        bond[k] = src[k];
    });
    return bond;
}

/**
 * 論理座標を絶対グリッド（GRID_SIZE 刻み）に丸める。**素の Math.round を使わないこと**。
 *
 * **なぜ**（要望G・2026-08-12・v1150）。
 * client 座標 → 論理座標 は `getScreenCTM()` の**逆行列**を通るので、戻ってきた値には
 * 1e-13 程度の丸め誤差が乗る。しかも誤差の向きは**行列の中身 ＝ 画面レイアウト**で変わる。
 * ふだんは無害だが、**ちょうど半格子**（…, 21, 63, …, 231, 273, …）を狙うと
 * Math.round の分かれ目のうえに乗るので、**同じ論理座標のタップが 42px 違う所に着地する**。
 *
 * 実測（810×1440・台本 V85 の点 y=273 ＝ 42×6.5）:
 *   ふつうに開く（?mode=free）  論理 y = 273                → round(6.5)                = 7 → 294
 *   収録レイアウト（?rec=）     論理 y = 272.99999999999994 → round(6.499999999999998) = 6 → 252
 * `?rec=` はヘッダーを隠すので SVG の上端が 110px → 66px へ動き、CTM の平行移動成分が
 * 変わる ＝ 誤差の向きが変わる。V85（ニコチン）の五員環がこれで 42px 上へずれ、
 * **下見は C₁₀H₁₄N₂・収録は C₉H₁₄N₂** という「下見が通ったのに収録が違う」失敗になった。
 *
 * 直し方は「**丸める前に、意味のある桁より下を落とす**」。1e-6 論理px は図の 1nm 相当なので、
 * 人の操作にも台本にも影響しない。`clientToSvg` 側で丸めないのは、拡大率のアンカーなど
 * 連続量として使う経路があるため ＝ **離散化する所でだけ離散化する**。
 */
function snapToGrid(v) {
    if (HIT_AREAS.legacyGridRound) return Math.round(v / GRID_SIZE) * GRID_SIZE;
    return Math.round(Math.round(v * 1e6) / 1e6 / GRID_SIZE) * GRID_SIZE;
}

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

// ★ 書き出し練習中だけ、見出しが自分の図から離れてよい上限（マス）と、その手前で掛ける値段（v1440）。
// **上限のほうが本体**（値段だけでは足りない ＝ 重なりの値段は**重なった図形の数だけ積み上がる**ので、
// 自動水素まで数えると 1か所で 5万・6万になり、どんな値段でも遠くのほうが安くなる。実測済み）。
// 値段は上限の内側での好み ——「1つの重なりを避けるためなら 2マスまで動く」（10000 ÷ 4000）。
// 理由と、なぜ練習の外では効かないのかは `Game#labelDriftPenalty()` に書いてある。
// ⚠ **横並びの段送り（1マス下）は 4000 < 10000 なので生きたまま。**
const LABEL_DRIFT_MAX_ROWS = 2;
const LABEL_DRIFT_PENALTY = 4000;

/* 見出しの重なり判定に使う小さな幾何（DESIGN_molecule_modal.md §12）。
   矩形は {x,y,w,h}、円は {x,y,r}、線分は {x1,y1,x2,y2,half}（half ＝ 線の太さの半分）。
   **座標はすべて SVG 単位**。画面px との換算は `labelScale()` が別に見ている */
function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function circleHitsRect(c, r) {
    const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
    const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
    return Math.hypot(c.x - nx, c.y - ny) < c.r;
}
// 線分と矩形の当たり。線分を太さぶん膨らませた帯として見るため、
// 「端点が矩形の中」「矩形の4辺と交差」「矩形の4隅が帯の中」の3つで判定する
function segmentHitsRect(s, r) {
    const inRect = (x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (inRect(s.x1, s.y1) || inRect(s.x2, s.y2)) return true;
    const edges = [
        [r.x, r.y, r.x + r.w, r.y], [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
        [r.x + r.w, r.y + r.h, r.x, r.y + r.h], [r.x, r.y + r.h, r.x, r.y]
    ];
    if (edges.some(e => segmentsCross(s.x1, s.y1, s.x2, s.y2, e[0], e[1], e[2], e[3]))) return true;
    const half = s.half || 0;
    if (half <= 0) return false;
    const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
    return corners.some(p => pointSegmentDistance(
        { x: p[0], y: p[1] }, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }) < half);
}
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const d = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const d1 = d(ax, ay, bx, by, cx, cy), d2 = d(ax, ay, bx, by, dx, dy);
    const d3 = d(cx, cy, dx, dy, ax, ay), d4 = d(cx, cy, dx, dy, bx, by);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
/**
 * 点と線分の距離。**アプリで唯一の実装**（引数はすべて `{x, y}`）。
 *
 * ⚠ もとは game.js と reactor.js に**同名で引数の形が違う実装が2つ**あった。
 * どちらも classic script のトップレベル宣言なので `window` の同じ名前を取り合い、
 * **あとから読まれる reactor.js が勝つ**（index.html の並び）。その結果
 * `segmentHitsRect` の「矩形の4隅が帯の中」の判定は `(number, number, {x1..})` を
 * `(p, a, b)` に渡していて **常に NaN → 常に false**（＝黙って効いていなかった）。
 * 同じ計算を2度書かない、という約束をここで果たす。
 */
function pointSegmentDistance(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// ===== 結合線が「別の重原子の下をくぐる」の判定（唯一の実装）=====
//
// **なぜ1本にするか**: 同じ意味の判定が別々に書かれると、片方だけ直る。
// 反応実行（reactor.js の strict）・整形モード（_hasBondThroughAtom）には
// 前からあったが、**手描きの配置だけ無かった**（発注書 §2g）。
//
// **しきい値 16px の根拠**: 素の格子で起こりうる最小は **21px（= 42·sin30°）**
// ＝ 環炭素に側鎖が2本（二等分線±30°）付いたときの「原子 ↔ 隣の結合線」。
// つまり 21px は正常な作図の下限なので、判定はそれを**明確に下回る**ところに置く。
// 下からは原子の絵（半径10px）＋線の太さで決まる ―― 16px なら白場が 6px 残って
// 「線の下に丸が潜っている」ようには見えない。
// 名称ライブラリ 923件の実測でも最小は **25.99px**（糖のハース環）で、余裕がある。
const BOND_ATOM_CLEARANCE = 16;

/**
 * **自動水素**が結合線の下をくぐる、の余白（§10-7 の決着・v1240）。**16 とは別に持つ**。
 *
 * **理由が違うから同じ数字にまとめない。** H のグリフは半径6px と重原子の絵（半径10px）より
 * 小さく、**絵が小さいぶん実害が出る距離も近い**。12px なら白場が 6px 残る ＝
 * 重原子の 16px（白場 6px）と**残す白場をそろえた**結果が 12 になる。
 *
 * **実測の裏づけ**: 登録図 939件（比較できる結合を持つ 926件）で
 * 「H の中心 ↔ その H の親原子を端点に持たない結合線」を全部測ると、
 * 最小は **14.32px**（スクロース・β-D-フルクトフラノース）、**14px 未満は 0件**、典型は 25〜26px。
 * 12px なら登録図は1件も弾かれない（余裕 2.3px）。
 */
const HYDROGEN_BOND_CLEARANCE = 12;

/**
 * 点 `a` が、線分 `p`—`q` の**下をくぐっている**か（幾何そのもの。つまみを見ない）。
 *
 * 端点のすぐそば（t が 0.02 未満／0.98 超）は見ない。そこは結合の相手そのものの領分で、
 * **原子どうしの間隔（MIN_CLEARANCE）が別に見張っている**。
 */
function underBondLine(a, p, q, clearance) {
    const L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (!L2) return false;
    const t = ((a.x - p.x) * (q.x - p.x) + (a.y - p.y) * (q.y - p.y)) / L2;
    if (t <= 0.02 || t >= 0.98) return false;
    return pointSegmentDistance(a, p, q) < clearance;
}

/** 重原子 `a` が結合線 `p`—`q` の下をくぐっているか（`a` は p・q のどちらでもない前提）。 */
function atomUnderBondLine(a, p, q, clearance = BOND_ATOM_CLEARANCE) {
    if (HIT_AREAS.legacyBondCross) return false; // 否定対照 BX3（検査を丸ごと外した旧挙動）
    return underBondLine(a, p, q, clearance);
}

/**
 * **自動水素** `h` が結合線 `p`—`q` の下をくぐっているか（`h` の親は p・q のどちらでもない前提）。
 *
 * つまみを重原子と**別に持つ**のは、否定対照を別々に走らせるため
 * （`legacyBondCross` を落とすと H の検査まで一緒に消え、HX3 が何を証明したのか読めなくなる）。
 */
function hydrogenUnderBondLine(h, p, q, clearance = HYDROGEN_BOND_CLEARANCE) {
    if (HIT_AREAS.legacyHydrogenCross) return false; // 否定対照 HX3
    return underBondLine(h, p, q, clearance);
}

/**
 * その分子で「**自動水素が、自分の親を端点に持たない結合線の下**に来ている」組の数。
 *
 * ⚠ **自動水素はモデルに存在せず、描かれているだけ**（`atoms` に H は入っていない）。
 * だから毎回 `calculateHydrogens()` で出し直す ―― 置く前の H の位置から置いたあとを
 * 推すことはできない（下の `moleculeWithCandidate` の注記）。
 */
function countHydrogenCrossings(mol) {
    const hs = mol.calculateHydrogens();
    if (hs.length === 0) return 0;
    const byId = new Map(mol.atoms.map(a => [a.id, a]));
    let n = 0;
    mol.bonds.forEach(b => {
        const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
        if (!p || !q || p.element === 'H' || q.element === 'H') return;
        hs.forEach(h => {
            if (h.parentId === p.id || h.parentId === q.id) return;
            if (hydrogenUnderBondLine(h, p, q)) n++;
        });
    });
    return n;
}

/**
 * 「この置き方をしたあとの分子」を組む（DOM も本体も触らない使い捨ての `Molecule`）。
 *
 * **なぜ本物を組むのか。** 自動水素の向きは分子ぜんたいの形で決まる ――
 * `calculateHydrogens` は結合方向に加えて **75px 以内の非結合重原子の向き（±60°）も避ける**ので、
 * 新しい原子が生えるだけで**近くの H が別の向きへ動く／消える**。しかも新しい原子自身にも
 * H が生えて、それが既存の結合線をくぐりうる。置く前の H を平行移動しても当たらない。
 *
 * `adj` は側鎖の振り分け（P6-3）。移動する原子は移動後の座標で組む。
 */
function moleculeWithCandidate(mol, parent, pt, element, adj) {
    const sim = new Molecule();
    const moved = adj ? new Set(adj.ids) : null;
    mol.atoms.forEach(a => {
        const dx = (moved && moved.has(a.id)) ? adj.dx : 0;
        const dy = (moved && moved.has(a.id)) ? adj.dy : 0;
        const na = new Atom(a.id, a.element, a.x + dx, a.y + dy, a.isLocked);
        // ベンゼン印は価標（芳香環の交互二重結合）の読みに効くので写す
        if (a.benzeneAngle !== undefined) na.benzeneAngle = a.benzeneAngle;
        sim.atoms.push(na);
    });
    mol.bonds.forEach(b => sim.bonds.push(new Bond(b.atomId1, b.atomId2, b.type)));
    const cand = sim.addAtom(element, pt.x, pt.y);
    if (parent) sim.addBond(parent.id, cand.id, 1); // `parent` なし ＝ 自由配置（結合しない）
    return sim;
}

// 「🎯 反応させる分子を選ぶ」で同時に選べる分子の数（レビュー項目15）。
// 4 なのは**グリセリン＋脂肪酸3分子＝油脂**が高校化学でいちばん分子数の多い反応列だから。
// 一度に全部が反応するわけではなく、同じ反応を繰り返す間ずっと絞り込みを効かせるための上限
const MAX_REACTION_SELECTION = 4;

/**
 * 「🎯 反応させる分子を選ぶ」を、キャンバスに分子が1つ（か0）しか無い状態で始めたときの案内
 *（v1409・ユーザー申し立て「1分子しか作っていないときにどうする？」）。
 *
 * 絞り込みは**2つ以上あって初めて意味を持つ**が、押せなくするのは間違い ——
 * 「先に1つ選んでから相手を呼ぶ」は式の左右を決める正しい順番なので、
 * ここでやることは**次の一手を書く**ことだけ。
 *
 * ⚠ 文言を1か所にする。トースト（押した瞬間・画面に出ている）と
 *    分子モーダルの `#reaction-selection`（開き直したとき）の2か所が読むので、
 *    別々に書くと片方だけ古くなる
 */
const REACTION_SELECT_LONELY_HINT =
    'いまキャンバスには分子が1つしかありません。エステル化のように2分子が要る反応は、' +
    '帯の「名称から呼び出す」で相手を出すと選べるようになります。';

/**
 * ライブラリの名前を「主名（別名1・別名2）」へ分解する（DESIGN_compound_coverage.md §5.4・§9.6-10）
 *
 * ⚠ **目印は全角の（）だけ。** 半角の `()` は複合置換基の書き方
 * （`ギ酸(1-メチルブチル)`・`N-(1-メチルブチル)ホルムアミド`）なので、ここでは分解しない。
 *
 * ⚠ **括弧の中身は3種類が混ざっている**（別名／状態／説明）。
 * 別名として拾ってよいのは「その分子の別の呼び方」だけで、
 * `D-グルコース（鎖状）` の「鎖状」は**状態**、`トリオレイン（油脂・…）` の「油脂」は**分類**、
 * `ジステアリン酸グリセリド（油脂のけん化の途中）` は**説明**。これらを別名にすると
 * 「鎖状」と打っただけで分子が出てしまう。落とし方は2つ:
 *   1. 分類語・状態語の明示リスト（`鎖状`・`油脂`・`ジペプチド`・`セッケン`）
 *   2. 「〜の〜」を含むものは説明句とみなす（`油脂のけん化の途中`・`フェノールのナトリウム塩`）
 */
/**
 * 🎲 ランダム出題の文言（発注書 D-4・v1417）。
 *
 * ⚠ **1問しかないシリーズでは「押す前に断る」**（「はじめに（操作の練習）」＝ 水 の1件だけが該当）。
 * 一巡が即座に終わる母集団で「同じ問題を出し続ける」と、**ランダムに見えて1問しか出ない**ので
 * 壊れていると読まれる。断ってシリーズを選び直してもらうほうが状態が読める。
 * ⚠ 断り文は**ボタンの下の1行（`#random-status`）とトーストの両方**が読む ＝ 定数は1つ。
 */
const RANDOM_TOO_FEW_MSG =
    'このシリーズは問題が1つしかないので、ランダム出題はできません。' +
    '上の「シリーズを選択」で別のシリーズを選んでください。';

/** 一巡し終わったとき（もう一度シャッフルして最初から出す） */
const RANDOM_WRAPPED_MSG = 'このシリーズはひととおり出ました。もう一度シャッフルして最初から出します。';

const ALIAS_STOPWORDS = new Set(['鎖状', '環状', '油脂', 'ジペプチド', 'セッケン']);

function splitCompoundName(name) {
    const m = String(name).match(/^([^（]+)（(.+)）$/);
    if (!m) return { main: String(name).trim(), aliases: [] };
    const main = m[1].trim();
    // 中は `・` `／` `/` で区切って複数取れる（`ケイ皮酸（桂皮酸・3-フェニルプロペン酸）`）
    const aliases = m[2].split(/[・／/]/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !ALIAS_STOPWORDS.has(s) && !s.includes('の') && !/[（）]/.test(s));
    return { main, aliases };
}

class Game {
    constructor() {
        this.currentStageIndex = 0;
        // 🎲 ランダム出題（発注書 D-4・v1417）。**どれもメモリだけ**（localStorage には書かない）
        this.randomBag = null;   // { series, order（シャッフル済みの添字）, pos } ＝ 一巡の記録
        this.randomRun = null;   // ランダムで出題中のシリーズ名（「次のお題へ」の行き先が変わる）
        this._rngState = null;   // 種（テストだけが setRandomSeed で入れる。null なら Math.random）
        this.userMolecule = new Molecule();
        // 「いま描いている分子」の名前と分子式（表示先はここから読む。DOM から読み返さない）
        this.compoundLabel = { name: '—', formula: '—' };
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
        // ★ 「立体が分かれる場所」の印モード（DESIGN_stereo_point.md 段1・v1435）。
        //   炭素をタップ → 原子の印（`isAsymmetricMarked`。自由モードの不斉マークと同じ1ビット）／
        //   結合をタップ → 結合の印（`isStereoMarked`）。
        //   ⚠ **`tapHasOtherMeaning()` に必ず載せること**（§4-3）。載せ忘れると結合の判定線が
        //     タップを食い、離したときの click が次数トグルへ落ちて **C=C が C≡C に化ける**
        //     （BUGNOTE_touch_ipad.md S6 と同じ型）
        this.stereoPointMode = false;
        this.condensedMode = false;    // 官能基の縮約表示（P9-2）が ON かどうか（表示のみ）
        // 命名の確認（主鎖の帯と炭素番号）の表示中かどうか（DESIGN_iupac_check.md N2）。
        // **状態は残さない**（同書 §3）ので、図が1手でも変われば `sig` が食い違って自分で消える。
        // 中身は `{ sig }` だけ ＝ 主鎖も番号も**持たない**（持つと2つ目の番号づけ経路になる）
        this.iupacNumbering = null;
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
        // 押した時点で「やると決めた破壊操作」を覚えておく箱（v1260）。
        // 実行は pointerup。離すまでに指が動いていたら**捨てる**（handleMouseUp の resolvePendingTap）
        this.pendingTap = null;
        
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
        // 置けなかったクリックのしるし専用（ui-group と違い pointermove で消さない。v1110）
        this.missGroup = document.getElementById('miss-group');

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

    // ===== 🎲 ランダム出題（発注書 D-4・v1417） =====
    //
    // ユーザーの決定（2026-08-17）は2つだけ:
    //   ① **母集団は「いま選んでいるシリーズの中」**（全ステージからではない）。
    //      シリーズ内は難易度が揃っているので体験が安定し、**シリーズを選ぶ既存の導線が
    //      そのまま使える** ＝ 保留中の D-1（シリーズの難易度）に依存せずに成立する
    //   ② **既出は一巡するまで出さない**（同じ問題が続けて出ない）
    //
    // ⚠ ②を「引くたびに既出を避けて選び直す」で書くと、残り1問のときに
    //    乱数が何度も外れる（＝終わらない繰り返し）か、避け方を間違えて重複する。
    //    **先に順序を作ってから配る**（シャッフルした列＝ `randomBag`）ので、
    //    一巡することが引き方に依らず**構造で**保証される（RD1 が N 回連続で引いて実測）。
    //
    // ⚠ **`Math.random()` を直に呼ばない。** `setRandomSeed()` で種を差し込めるようにして
    //    ある（差し込まないときだけ `Math.random()`）。回帰テストは種を固定して
    //    決定的に検査する ＝ 「たぶん大丈夫」を作らない（発注書の絶対条件2）。

    /**
     * 乱数の種を差し込む（テスト用）。`null` を渡すと `Math.random()` に戻る。
     * 本番の画面からは呼ばない ＝ 既定は素の `Math.random()`。
     */
    setRandomSeed(seed) {
        this._rngState = (seed === null || seed === undefined) ? null : (seed >>> 0);
    }

    /** 0以上1未満。種が入っているときだけ mulberry32（同じ種なら毎回同じ列） */
    nextRandom() {
        if (this._rngState === null || this._rngState === undefined) return Math.random();
        this._rngState = (this._rngState + 0x6D2B79F5) >>> 0;
        let t = this._rngState;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** そのシリーズに属するステージの添字（STAGES の並び順） */
    stageIndicesInSeries(seriesName) {
        const out = [];
        STAGES.forEach((stage, idx) => { if (stage.series === seriesName) out.push(idx); });
        return out;
    }

    /**
     * シャッフルした列を作る（Fisher-Yates）。
     * `avoidFirst` と同じ添字が先頭に来たら2番目と入れ替える
     * ＝ **いま出ている問題／直前に出した問題が続けて出ない**（決定の②の「続けて出ない」）。
     */
    buildRandomBag(seriesName, avoidFirst) {
        const order = this.stageIndicesInSeries(seriesName);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(this.nextRandom() * (i + 1));
            const t = order[i]; order[i] = order[j]; order[j] = t;
        }
        if (order.length > 1 && avoidFirst !== undefined && avoidFirst !== null && order[0] === avoidFirst) {
            const t = order[0]; order[0] = order[1]; order[1] = t;
        }
        return { series: seriesName, order, pos: 0 };
    }

    /**
     * 1問引いて読み込む。引けたら添字を、引けなかったら `null` を返す。
     *
     * ⚠ **一巡の記録はメモリだけに持つ**（`this.randomBag`。`localStorage` には書かない）。理由:
     *   ・**永続する記憶はもう1つある** —— クリア記録（`chemAssembler.cleared`）。
     *     一巡の記録まで永続させると「クリアした／出た」の2つの履歴が重なり、
     *     どちらが原因で問題が出ないのか画面から読めなくなる
     *   ・一巡は「いま続けて練習しているあいだ」の話なので、**開き直したら仕切り直し**が素直
     *   ・他アプリとキーがぶつかる余地がそもそも無くなる（`ion-equation` / `ratio` / `qa` と同じ
     *     `localStorage` を共有しているので、キーの取り合いは実在の危険）
     */
    drawRandomStage() {
        const series = this.seriesSelect ? this.seriesSelect.value : null;
        const list = this.stageIndicesInSeries(series);
        if (list.length < 2) {
            this.showToast(RANDOM_TOO_FEW_MSG, 4200);
            this.updateRandomEntry();
            if (this.seriesSelect) this.seriesSelect.focus();
            return null;
        }
        let wrapped = false;
        // シリーズが変わっていたら、そのシリーズの列を作り直す（前のシリーズの記録は捨てる）
        if (!this.randomBag || this.randomBag.series !== series) {
            this.randomBag = this.buildRandomBag(series, this.currentStageIndex);
        } else if (this.randomBag.pos >= this.randomBag.order.length) {
            // 一巡した → 断らずに、言ってからシャッフルし直す（直前の1問は先頭に置かない）
            wrapped = true;
            this.randomBag = this.buildRandomBag(series, this.randomBag.order[this.randomBag.order.length - 1]);
        }
        const bag = this.randomBag;
        const idx = bag.order[bag.pos++];
        this.randomRun = series;   // 以後の「次のお題へ」もランダムで続ける（goToNextStage）
        this.stageSelect.value = idx;
        this.loadStage(idx);
        const left = bag.order.length - bag.pos;
        this.showToast(wrapped ? RANDOM_WRAPPED_MSG
            : `🎲 ランダム出題（このシリーズは残り ${left} 問）`, wrapped ? 4200 : 2600, 'success');
        this.updateRandomEntry();
        return idx;
    }

    /** ボタンの押せる／押せないと、その下の1行（残り何問か・断り文）を実際の母集団から書き直す */
    updateRandomEntry() {
        const btn = document.getElementById('btn-random-stage');
        const status = document.getElementById('random-status');
        if (!btn && !status) return;
        const series = this.seriesSelect ? this.seriesSelect.value : null;
        const total = this.stageIndicesInSeries(series).length;
        if (btn) btn.disabled = total < 2;
        if (!status) return;
        if (total < 2) { status.textContent = RANDOM_TOO_FEW_MSG; return; }
        const bag = (this.randomBag && this.randomBag.series === series) ? this.randomBag : null;
        const left = bag ? (bag.order.length - bag.pos) : total;
        status.textContent = `このシリーズは全 ${total} 問。まだ出していない問題は ${left} 問です` +
            '（出した問題は、ひととおり出るまで再び出ません）。';
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
                // 縮尺は変わらないが**見えている範囲が動く**ので、画面外へ出た見出しの
                // 引き戻し（§13-2）をやり直す。パンで置き去りにすると名前だけ画面外に残る
                this.scheduleLabelResync();
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
                // ⚠ 置き場所は**分子モーダルの中**（DESIGN_ribbon_consolidation.md §12 ③・第4段）。
                // リボンにいたころは アイコン＋短ラベル の2段タイルで、textContent ごと入れ替えると
                // span が消えて1行に潰れた。**両方の姿を扱えるまま残す** ——
                // span があれば .tile-icon / .tile-label だけを、無ければ textContent を書き換える。
                // 移設のたびにここを書き替えずに済む（次に別の場所へ移っても壊れない）
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
                    : '-COOH・-COO-（エステル）・-NO₂ などの官能基を、1つのカードにまとめて表示します（作図データは変わりません）';
                btnCondense.classList.toggle('active', this.condensedMode);
                this.updateDrawing();
                this.showToast(this.condensedMode
                    ? '官能基をまとめて表示しています（作図データは変わっていません。クリックで元に戻せます）。'
                    : 'すべての結合を表示に戻しました。', 2500, 'success');
            });
        }

        // 全体表示リセットボタンの紐付け。
        // ⚠ **お題ではなくモードで合わせ先を決める**（v1402・FV1）。自由・学習でお題に合わせると、
        //    お題の範囲が1点に潰れて視野がそこへ飛び、描いた分子がまるごと画面外へ出ていた
        if (this.btnResetView) {
            this.btnResetView.addEventListener('click', () => {
                this.fitCanvasToView();
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
                    // 「🎯 反応させる分子を選ぶ」も同じ（v1409）。ここは `setTool()` を
                    // 通らない経路なので、列から漏れると**モジュールだけ置けない**が残る
                    this.deactivateReactionSelectMode();
                    // 「☆ 立体の場所」の印モードも同じ列（v1435）
                    if (this.deactivateStereoPointMode()) this.updateDrawing();
                } else {
                    this.selectedModule = null;
                }
            });
        });

        // ステージ変更
        this.seriesSelect.addEventListener('change', (e) => {
            const selectedSeries = e.target.value;
            this.updateStageOptions(selectedSeries);
            // 🎲 母集団が変わった ＝ ランダム出題は仕切り直し（前のシリーズの一巡の記録は捨てる）。
            // 記録はシリーズ名で持っているので、**戻ってきても続きにはならない**（そろえた挙動）
            this.randomRun = null;
            this.randomBag = null;
            this.updateRandomEntry();
            const firstStageIdx = parseInt(this.stageSelect.value);
            if (!isNaN(firstStageIdx)) {
                this.loadStage(firstStageIdx);
            }
        });

        this.stageSelect.addEventListener('change', (e) => {
            // 自分で問題を選んだら「次のお題へ」は元どおり順番に進む（一巡の記録は残す ＝
            // そのあと 🎲 を押しても、出した問題は一巡するまで出ない）
            this.randomRun = null;
            this.loadStage(parseInt(e.target.value));
        });

        // 🎲 ランダム出題（発注書 D-4・v1417）
        const btnRandom = document.getElementById('btn-random-stage');
        if (btnRandom) btnRandom.addEventListener('click', () => {
            // 引けたときだけ閉じてキャンバスへ返す（お題が決まった ＝ この画面の用は済んだ）。
            // ⚠ **断ったときは閉じない** —— シリーズを選び直してもらう画面がここだから
            if (this.drawRandomStage() !== null) this.setPuzzleOpen(false);
        });
        this.updateRandomEntry();

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

        // アクションボタン。**判定は自動になった**（2026-08-13）ので、このボタンはヒント専用
        this.btnVerify.addEventListener('click', () => this.showStageHint());
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
            // 空にした後の視野もモードで決める（v1402）。自由・学習では**お題を見に行かない**
            this.fitCanvasToView();
            this.updateDrawing();
        });

        /**
         * 正解モーダルの出口は3つ（2026-08-13 ユーザー設計）。**次に何をしたいか**で選ぶ:
         *   次のお題へ … 続ける（従来の唯一の出口）
         *   別のお題へ … 選び直す（お題モーダルを開く）
         *   閉じる     … やめる（**自由モードへ戻る**）
         * ⚠ 「閉じる」でパズルに留まらないのは、留まると**解いたお題が出たまま**になり、
         *    次に何をすればよいか分からない画面になるため。やめる人の行き先は自由モード。
         */
        this.btnNextStage.addEventListener('click', () => {
            this.winModal.classList.add('hidden');
            this.goToNextStage();
        });
        const btnPickStage = document.getElementById('btn-pick-stage');
        if (btnPickStage) {
            btnPickStage.addEventListener('click', () => {
                this.winModal.classList.add('hidden');
                this.setPuzzleOpen(true);
            });
        }
        const btnWinClose = document.getElementById('btn-win-close');
        if (btnWinClose) {
            btnWinClose.addEventListener('click', () => {
                this.winModal.classList.add('hidden');
                this.setMode('free');
            });
        }

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
                // ⚠ 下ろす道は `deactivateReactionSelectMode()` の1本にする（v1409）。
                //    ここに2本目を書くと「ボタンで下ろしたときだけ選択が残る」型の食い違いが戻る
                if (this.reactionSelectMode) {
                    this.deactivateReactionSelectMode();
                    document.getElementById('btn-tool-select').classList.add('active');
                    this.selectedTool = 'select';
                    this.clearUIOverlay();
                    this.updateDrawing();
                    return;
                }
                this.reactionSelectMode = true;
                btnRxSel.classList.add('active');
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
                // 「1分子しか作っていないときにどうする？」への答えをその場で出す（v1409）。
                // ⚠ **選べないようにはしない** —— 先に1つ選んでから相手を呼ぶ順番は正しい使い方で
                //   （先に選んだ方が式の左）、押せなくすると式の並びを決める手段が消える。
                //   足すのは「次に何をすればよいか」の1文だけ
                const lonely = this.canvasMoleculeCount() < 2;
                this.showToast(`反応させたい分子をタップしてください（${MAX_REACTION_SELECTION}つまで）。` +
                    '先に選んだ方が式の左になります。油脂のように何回も反応させるときは、' +
                    '使う分子をまとめて選んでおけます。何もない所をタップすると選び直せます。' +
                    'やめたいときは、左のパレットで道具（選択・結合・消しゴム）を選べば戻ります。' +
                    (lonely ? ' ' + REACTION_SELECT_LONELY_HINT : ''), lonely ? 9000 : 7000, 'success');
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

        // モード切替タブ（P10 M1）: モードごとに面（モーダル・作業帯）を出し分ける。
        // **確認はここ（人の操作）で挟み、setMode の中では挟まない。**
        // setMode は台本・テスト・`?open=` からも呼ばれるので、そこに確認を入れると
        // 無人再生が止まる。守りたいのは「人が押して書きかけを捨てる」場面だけ
        // ⚠ 📚 学習のタブは**リボンのタイル**（第3段）。`.mode-tab` のまま移設したので
        // この一括配線がそのまま効く ＝ **書きかけを捨てる確認（leaveGuard・§13-3）が
        // タイルにも自動で掛かる**。タイル側に別配線を足さないこと（確認が抜ける道ができる）
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', () => this.leaveGuard(tab.dataset.mode, () => {
                this.setMode(tab.dataset.mode);
                // 📚・🧩 は「モードに入る」と「メニューを開く」が同じ1手（§6-3。深さ 4段 → 2段）
                if (tab.dataset.mode === 'learn') this.setStudyOpen(true);
                if (tab.dataset.mode === 'puzzle') this.setPuzzleOpen(true);
            }));
        });
        this.setupStudyModal();
        this.setupPuzzleModal();
        this.setupLearnExit();
        // 枠の外を押したら閉じる（§22）。**持ち主の配線より先でよい** —— 押すのは
        // ボタンそのものなので、そのボタンに誰がいつ listener を足したかに依存しない
        this.setupBackdropClose();
        // 「← 自由に戻る」（DESIGN_entry_points.md §8b）。🧪 自由が標準（ホーム）で、
        // パズル・学習はそこから呼び出す行き先 ＝ 抜けて戻る道を明示する。
        // **描いている分子は保持する**（setMode は表示を切り替えるだけ）
        const backToFree = document.getElementById('btn-back-to-free');
        if (backToFree) backToFree.addEventListener('click',
            () => this.leaveGuard('free', () => this.setMode('free')));

        // ③ 作業帯の高さを CSS 変数へ流す（DESIGN_ribbon_consolidation.md §4-2）。
        // キャンバス左下の #mobile-name-chip は帯とぶつかるので、帯の高さぶん持ち上げる。
        // 説明の行数で高さが変わるため**決め打ちの数字を置かず**、実測を毎回渡す
        const strip = document.getElementById('work-strip');
        if (strip && typeof ResizeObserver === 'function') {
            new ResizeObserver(() => this.syncWorkStripHeight()).observe(strip);
        }

        // 右パネルの下シート（☰ で開き ✕ / バックドロップで閉じる。P11 M1）の配線は
        // **消した**（第5段）。開く相手のパネルが無くなったため。入口はリボンのタイルと
        // モーダル・作業帯に分かれ、「画面外の面を呼び出して閉じる」層そのものが要らなくなった

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
                    this.fitCanvasToView(); // ボタンの全消去と同じ扱い（v1402）
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
            const bond = new Bond(b.atomId1, b.atomId2, b.type);
            // 原子と同じく**シリアライズ済みの追加プロパティも復元する**（開発方針 3.5章）。
            // ⚠ ここが `new Bond(...)` だけだったので、結合に持たせた1ビット
            //   （`isStereoMarked`・v1435 の段1の印）が ↩ を1回押しただけで消えていた。
            //   原子側（`isAsymmetricMarked`）は Object.assign で守られていたので、
            //   **同じ答案の中で原子の印だけ残って結合の印が消える**という読めない壊れ方になる
            copyBondExtras(bond, b);
            this.userMolecule.bonds.push(bond);
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
        // お題を切り替えるならキャンバスは作図のものへ戻す（v1374）。
        // ビューアが開いたまま残ると編集がブロックされ、退避した答案も返らない
        this.deactivateReactionMode();
        this.currentStageIndex = index;
        this.userMolecule = new Molecule();
        this.history = [];
        this.redoStack = [];
        this._autoClearedIndex = null;   // 自動判定は1つのお題で1回だけ（maybeAutoClear）

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

        // 吸着半径は結合長より**明確に大きい** 63px（= GRID_SIZE * 1.5。DESIGN_hit_areas.md 決定1）。
        // 45 のころは「置きたい点（42px 先）の外周 3px」を狙う操作だった（実測: 46px で×）。
        const SNAP_RADIUS   = HIT_AREAS.snapRadius;
        const BOND_LENGTH   = GRID_SIZE;       // 標準結合長
        const MIN_CLEARANCE = BOND_LENGTH * 0.65; // 近接判定しきい値
        const MAX_EXTEND    = BOND_LENGTH * 2.0;  // 最大延長（2倍まで）
        const MAX_CANVAS    = CANVAS_LIMIT;    // キャンバス上限 (px。モジュール先頭で定義)

        // 1. キャンバスに原子がない場合: グリッドスナップ
        const heavyAtoms = this.userMolecule.atoms.filter(a => a.element !== 'H');
        if (heavyAtoms.length === 0) {
            const snapX = snapToGrid(x);
            const snapY = snapToGrid(y);
            return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: true, snapAtom: null };
        }

        // 2. 吸着先を決める（DESIGN_hit_areas.md 決定2）。
        //
        //    **「新しい原子が実際に出る位置」が指にいちばん近い原子が勝つ。**
        //    もとは「原子までの距離 と 候補点までの距離 の小さいほう」で持ち主を選んでいたが、
        //    候補点は**そこに置かれるとは限らない**（占有除外・クリアランス延長がこのあと入る）ので、
        //    指のそばに何も現れない原子が勝つことがあった（発注書 2d。5方位中3方位が環に横取り）。
        //    ここは既存原則「**プレビュー＝実結果**」（getPlacementBondTargets・getRingPlacementPlan）を
        //    スナップの勝敗にまで通すこと。**スコアは必ずクリアランス延長後の最終位置で取る**
        //    （延長前の候補点で取ると、近距離で環側が 5px まで寄って tie-break に入らず誤る）。
        //
        //    素の距離が近い原子を単純に勝たせるのは**採らない**（P12-8 が退行する）:
        //    メチルシクロヘキサンの2本目の出現位置は既存メチル炭素から 2·42·sin15° ≈ 21.7px しか
        //    離れておらず、素の距離ならメチルが勝つ。成果の近さなら環炭素の成果はタップ点のほぼ真下、
        //    メチルの成果は 25px 以上 → 環炭素が勝つ。
        const cands = [];
        // 候補の原子ごとに `placementFor` を呼ぶので、**分子ぜんたいで1度きりの計算**は
        // ここで持ち回る（自動水素のくぐりの基準値。`this.userMolecule` はこの間ずっと不変）。
        // 持ち回らないと、トリステアリン（63原子）で pointermove 1回が 7.5ms になる（実測）
        const memo = {};
        // 指の**真下**にいちばん近い原子（成果を数えない素の距離）。
        // 勝者がこれと食い違うとき ＝「押したのと別の原子に取られた」（v1111 の説明用）。
        let touchedAtom = null;
        let touchedDist = Infinity;
        heavyAtoms.forEach(atom => {
            if (this.userMolecule.getFreeValency(atom.id) < 1) return;
            const direct = Math.hypot(atom.x - x, atom.y - y);
            // 成果は原子から 42〜84px に出るので、これより遠い原子は計算するまでもない
            if (direct > SNAP_RADIUS + MAX_EXTEND) return;
            let score, plan = null;
            if (HIT_AREAS.legacyWinner) {
                // 旧式（否定対照 HA2 用）: 候補点込みの最短距離
                score = direct;
                this.secondBranchPoints(atom).forEach(pt => {
                    score = Math.min(score, Math.hypot(pt.x - x, pt.y - y));
                });
            } else {
                plan = this.placementFor(atom, x, y, heavyAtoms, memo);
                score = Math.hypot(plan.x - x, plan.y - y);
            }
            if (Math.min(direct, score) > SNAP_RADIUS) return; // 競う資格なし
            cands.push({ atom, direct, score, plan });
            if (direct < touchedDist) {
                touchedDist = direct;
                touchedAtom = atom;
            }
        });

        // 3. 競う原子がいない → **自由配置**（DESIGN_hit_areas.md 決定1／要望D）。
        //    もとは isValid:false('far') でクリックを黙って捨てていた。
        //    「タップは黙って捨てない。何かが見えて起きるか、理由が出るか」に寄せて、
        //    グリッドに丸めて**新しい分子として置く**。見えるので、同元素タップか Ctrl+Z で戻せる。
        //    結合は従来どおり getPlacementBondTargets が見る（直交整列した原子には自動接続）
        if (cands.length === 0) {
            const snapX = snapToGrid(x);
            const snapY = snapToGrid(y);
            if (Math.abs(snapX) > MAX_CANVAS || Math.abs(snapY) > MAX_CANVAS) {
                return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: false, snapAtom: null,
                         tooLarge: true, reason: 'toolarge' };
            }
            let crowder = null;
            let crowdDist = Infinity;
            heavyAtoms.forEach(a => {
                const d = Math.hypot(a.x - snapX, a.y - snapY);
                if (d < crowdDist) { crowdDist = d; crowder = a; }
            });
            if (crowdDist < MIN_CLEARANCE) {
                return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: false, snapAtom: null,
                         reason: 'crowded', blockedAtom: crowder };
            }
            // **自由配置にも自動水素の門番が要る**（§10-7 の決着・v1240）。
            // 新しい原子は重原子から 27.3px 以上離れていても、そこから生える H は
            // **さらに 16px 先まで届く**。吸着の側だけ塞いだ時点で残っていたくぐり
            // 110通りは**全部この経路**で、最悪は H の中心が結合線から 0.8px
            // （o-ジニトロベンゼン。ニトロ基の N-C 線の真上に H が乗る）。
            // ここには「延ばす」逃げ道が無い（結合そのものが無い）ので、理由も別に立てる
            if (!HIT_AREAS.legacyHydrogenCross) {
                const sim = moleculeWithCandidate(
                    this.userMolecule, null, { x: snapX, y: snapY }, this.selectedAtomType, null);
                if (countHydrogenCrossings(sim) > countHydrogenCrossings(this.userMolecule)) {
                    return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: false, snapAtom: null,
                             reason: 'hcrossing', blockedAtom: crowder };
                }
            }
            return { x: snapX, y: snapY, rawX: x, rawY: y, isValid: true, snapAtom: null,
                     freePlace: true };
        }

        // 勝者の決め方は**配列順に依存させない**（原子IDは乱数。CLAUDE.md の原則）。
        // いちばん良いスコアから tieBreakPx(8px) 以内は「近差」とみなし、指の真下（direct が近い方）を採る。
        // T から 20px のような近距離では環側の成果と先端の成果が 1〜2px 差まで接近するため、
        // ここで環に取られると発注書 2d の再来になる
        let best;
        if (HIT_AREAS.legacyWinner) {
            best = cands.reduce((b, c) => (c.score < b.score ? c : b));
        } else {
            const top = Math.min(...cands.map(c => c.score));
            best = cands.filter(c => c.score <= top + HIT_AREAS.tieBreakPx)
                .reduce((b, c) => (c.direct < b.direct ||
                    (c.direct === b.direct && c.score < b.score)) ? c : b);
        }
        const atom = best.atom;
        // 「取られた」の判定材料（失敗時の説明にだけ使う）
        const stolen = !!(touchedAtom && touchedAtom.id !== atom.id);
        const plan = best.plan || this.placementFor(atom, x, y, heavyAtoms, memo);
        return Object.assign({}, plan, {
            rawX: x, rawY: y,
            stolen: plan.isValid ? undefined : stolen
        });
    }

    /**
     * **原子1つ → その原子に吸着したときの最終配置**（純関数。DOM も this の状態も変えない）。
     *
     * ベンゼン特例・候補角・占有除外・クリアランス延長・キャンバス上限までを通した
     * 「**実際に置かれる場所**」を返す。getSnappedCoords はこれを勝敗のスコアにも最終結果にも使う
     * ＝ 勝った原子の成果と、実際に置かれる場所が**同じ計算**であることが構造で保証される。
     */
    placementFor(atom, x, y, heavyAtoms, memo = {}) {
        const BOND_LENGTH   = GRID_SIZE;
        const MIN_CLEARANCE = BOND_LENGTH * 0.65;
        const MAX_EXTEND    = BOND_LENGTH * 2.0;
        const EXTEND_STEP   = BOND_LENGTH * 0.15;
        const MAX_CANVAS    = CANVAS_LIMIT;

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
            const blocked = occupied || tooNear;
            // ここは長らく**何のしるしも付けずに** isValid:false を返しており、呼び出し側は
            // noSpace / tooLarge しか見ないためクリックが黙って捨てられていた（発注書 §1）
            return { x: pt.x, y: pt.y, isValid: !blocked, snapAtom: atom,
                     reason: blocked ? 'overlap' : undefined,
                     blockedAtom: blocked ? atom : undefined };
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
            return { x: atom.x, y: atom.y, isValid: false, snapAtom: null,
                     noSpace: true, reason: 'blocked', blockedAtom: atom };
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
        // 9. 最良角度で結合長を調整
        //    MIN_CLEARANCE を満たすまで段階的に延長（最大 MAX_EXTEND まで）
        //    振り分けで移動する原子は移動後の位置で間隔を評価する
        //
        // ⚠ **原子どうしの距離だけでは足りない**（発注書 §2g・ユーザー報告）。
        //    延ばした結合線が、離れたところにある重原子の**下をくぐる**ことがある:
        //    シクロヘキサン → 環炭素にメチル → そのメチルから下へエチル → 同じ環炭素に右向きで
        //    もう1本、で 48.3px に延びた結合線から **5.6px** の位置に炭素が居た（実測）。
        //    原子の絵は半径10px なので、線が丸の上に乗る ＝ 別の構造式に見える。
        //    そこで結合線と既存原子・新しい原子と既存の結合線の**両方向**を見る
        //    （`atomUnderBondLine`。reactor.js の strict・整形モードと同じ物差し）。
        const bondsOf = (adj) => {
            const set = adj ? new Set(adj.ids) : null;
            const pos = (a) => (set && set.has(a.id))
                ? { x: a.x + adj.dx, y: a.y + adj.dy } : { x: a.x, y: a.y };
            const byId = new Map(heavyAtoms.map(a => [a.id, a]));
            const segs = [];
            this.userMolecule.bonds.forEach(b => {
                const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
                if (p && q) segs.push([pos(p), pos(q)]);
            });
            return { pos, segs };
        };
        // **自動水素も同じ穴にある**（§10-7 の決着・v1240）。上の2方向はどちらも
        // `heavyAtoms` しか見ていないので、伸ばした結合線が**別の原子から生えた H の
        // グリフ（半径6px）の上**を通っても誰も止めなかった（実測: 登録図まわりの
        // 116,872 通りの置き方のうち **719 通り**でくぐり。最悪は H の中心が線の上）。
        //
        // 測り方は重原子と同じ（点と線分の距離）で、**しきい値だけ 12px と別に持つ**。
        // 数え方は「**この置き方でくぐりが増えるか**」―― 置く前から抱えているくぐり
        // （伸縮ドラッグや反応で作られた図など）を理由に、以後いっさい置けなくなるのを避ける。
        //
        // ⚠ **費用**: `calculateHydrogens` は分子ぜんたいを見るので、大物の図では効く
        //   （トリステアリン 63原子で 0.9ms/回）。基準値は `memo` に持ち回って
        //   **getSnappedCoords 1回につき1度**にする（候補の原子ごとに数え直さない）。
        const addsHydrogenCrossing = (adj, pt) => {
            if (HIT_AREAS.legacyHydrogenCross) return false; // 否定対照 HX3（費用ごと外す）
            if (memo.baseCross === undefined) memo.baseCross = countHydrogenCrossings(this.userMolecule);
            const baseCross = memo.baseCross;
            const sim = moleculeWithCandidate(
                this.userMolecule, atom, pt, this.selectedAtomType, adj);
            return countHydrogenCrossings(sim) > baseCross;
        };
        // 「置ける長さ」を探す。**振り分け（adjust）を続けたまま**を先に試し、
        // どの長さでも線がくぐるなら**振り分けをやめて**もう一度探す
        // （やめれば既存の側鎖が二等分線上に残り、新しい結合は素の 21px を確保できる）。
        // 延長は最後 ＝ 同じ長さなら「振り分けあり」を優先する順序は崩さない。
        // 返すのは `{ L }` か `{ fail }`。**どちらの門で止まったか**まで返すのは、
        // 置けなかった理由を v1111 の語彙で正しく出すため（'overlap' と 'crossing' は
        // 逃げ道が違う ―― 前者は結合を伸ばせば空くが、後者は伸ばすほど深くくぐる）
        const fitLength = (adj) => {
            const { pos, segs } = bondsOf(adj);
            const others = heavyAtoms.filter(a => a.id !== atom.id).map(pos);
            let fail = 'overlap';
            for (let L = BOND_LENGTH; L <= MAX_EXTEND + 0.01; L += EXTEND_STEP) {
                const testPt = {
                    x: atom.x + L * Math.cos(bestAngle),
                    y: atom.y + L * Math.sin(bestAngle)
                };
                if (others.some(o => Math.hypot(o.x - testPt.x, o.y - testPt.y) < MIN_CLEARANCE)) continue;
                // ここから先は「原子どうしは足りている」。以後の失敗はくぐりが原因
                fail = 'crossing';
                // 新しい結合線が、端点でない重原子の下をくぐらないか
                if (others.some(o => atomUnderBondLine(o, atom, testPt))) continue;
                // 新しい原子が、既存の結合線の下に潜り込まないか（逆向きの同じ話）
                if (segs.some(s => atomUnderBondLine(testPt, s[0], s[1]))) continue;
                // 自動水素（新しい原子から生えるぶんも、既存の原子から生えるぶんも）
                if (addsHydrogenCrossing(adj, testPt)) continue;
                return { L };
            }
            return { fail };
        };
        let fit = fitLength(adjust);
        if (fit.L === undefined && adjust) {
            const retry = fitLength(null);
            if (retry.L !== undefined) { adjust = null; fit = retry; }
        }

        // 最大延長でも重なり／くぐりを避けられない場合は配置を禁止する（P6-2a）。
        // ユーザーは結合線のドラッグ（伸長）で空間を作ってから配置する。
        if (fit.L === undefined) {
            const px = atom.x + MAX_EXTEND * Math.cos(bestAngle);
            const py = atom.y + MAX_EXTEND * Math.sin(bestAngle);
            return { x: px, y: py, isValid: false, snapAtom: null,
                     noSpace: true, reason: fit.fail, blockedAtom: atom };
        }
        const finalLength = fit.L;

        const finalX = atom.x + finalLength * Math.cos(bestAngle);
        const finalY = atom.y + finalLength * Math.sin(bestAngle);

        // 10. キャンバス上限チェック
        if (Math.abs(finalX) > MAX_CANVAS || Math.abs(finalY) > MAX_CANVAS) {
            return { x: finalX, y: finalY, isValid: false, snapAtom: null,
                     tooLarge: true, reason: 'toolarge', blockedAtom: atom };
        }

        return { x: finalX, y: finalY, isValid: true, snapAtom: atom, adjust };
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
            this.pendingTap = null;   // 2本目の指が来た時点でタップではない（v1260）
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
            this.scheduleLabelResync(); // 見えている範囲が動く（§13-2 の引き戻しをやり直す）
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
        // 1.35 印モード中（段1）: カーソル下の炭素／結合をハイライトする。
        //      ⚠ ここに分岐が無いと、下の「原子配置モード」の分岐に落ちて
        //      **置けもしない原子のゴースト**が出る（印を付ける画面で作図の予告が出る）
        else if (this.stereoPointMode) {
            this.clearUIOverlay();
            const hit = this.stereoPointUnderPoint(coords.rawX, coords.rawY);
            if (hit.atom) this.drawAsymmetricPreview(hit.atom);
            else if (hit.bond) this.drawStereoBondPreview(hit.bond);
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
            const ringPlan = this.isHaworthModule(this.selectedModule)
                ? this.getHaworthPlacementPlan(this.selectedModule, coords.rawX, coords.rawY)
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
            // **プレビューが出る場所 = タップで置ける場所**（DESIGN_hit_areas.md §3-5）。
            // もとは findAtomAt(28) で消していたので、18〜28px にプレビューの空白帯があり、
            // 「押しても何も出ない → たぶん置けない」と見えていた。ここは破壊操作と同じ 18px にそろえる
            const clickedAtom = this.findNearestAtomAt(coords.rawX, coords.rawY, HIT_AREAS.atomTapRadius);

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
        // 前の押しの控えが残っていたら捨てる（ピンチに化けた等で pointerup が届かなかった分）。
        // 残したままだと、**次に押した場所と関係のない原子**が離した瞬間に消える
        this.pendingTap = null;
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

        // --- 命名の確認（主鎖と番号）を出しているあいだは作図を止める（DESIGN_iupac_check.md §3-1）---
        // 番号は主鎖炭素の**すぐ外側**に置くので、そこへ原子を足せると
        // 「いま見えている 2 は番号なのか置いた原子なのか」が読めなくなる。
        // ⚠ **黙って消さずに理由を出す**。消す手段は同じボタン（トグル）だけにして、
        //   「なぜ置けないのか」と「どう戻すのか」を1つの文で言い切る
        if (this.iupacNumbering) {
            this.showToast('主鎖と番号を表示中は作図できません。「🔢 主鎖と番号を消す」で戻せます。', 3000);
            return;
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

        // --- 「立体が分かれる場所」の印モード (ON) 時の特別処理（v1435・段1） ---
        // ⚠ **指し方は2種類あるが、モードは1つ**（DESIGN_stereo_point.md §4-1）。
        //   炭素なら原子の印、結合なら結合の印。炭素以外の原子・何も無い所は**黙って何もしない**
        //   （「そこは違う」と言うと、指してよい場所を消去法で教えることになる）
        if (this.stereoPointMode) {
            const hit = this.stereoPointUnderPoint(coords.rawX, coords.rawY);
            if (hit.atom) {
                this.saveState();
                hit.atom.isAsymmetricMarked = !hit.atom.isAsymmetricMarked;
                this.updateDrawing();
            } else if (hit.bond) {
                this.saveState();
                hit.bond.isStereoMarked = !hit.bond.isStereoMarked;
                this.updateDrawing();
            }
            return; // 印モード時は他の配置/編集動作を完全にブロック
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
                // **破壊的な操作（削除・元素置換）は「原子の上」だけ**（DESIGN_hit_areas.md 決定1）。
                // clickedAtom の 28px のままだと、足すつもりで 20〜26px を押したときに
                // 先端の原子が消える（発注書 2d。実際に4回踏んだ）。
                // 18px を外れたら**配置経路へ落とす** ＝ その帯は「足す」になる。
                // 掴み（Shift＋ドラッグ）だけは 28px のまま（非破壊なので広くてよい）。
                //
                // **規則はこの2行だけ**（v1180・発注書 §2h。案B-2 のユーザー決定）:
                //   原子は同元素タップで消える。個々の原子は動かせない
                //   （どかすなら Shift＋ドラッグで分子ごと、間隔を空けるなら結合線のドラッグ）
                // もとは「ロック原子」と「ベンゼン環の原子」だけ 1原子のドラッグに割り当てていたが、
                // それは設計された機能ではなく**ジェスチャの割り当ての余り**だった
                // （普通の原子はタップが削除・置換で埋まっているので、**タップが空いている原子にだけ**
                //  ドラッグが残っていた）。動かすと六角形が1頂点だけ歪むうえ、
                // ベンゼンの炭素は消しゴムでは既に消せていた ＝ 守り切れていない例外だった
                const tapAtom = this.findNearestAtomAt(coords.rawX, coords.rawY, HIT_AREAS.atomTapRadius);
                const hit = tapAtom || clickedAtom;
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
                } else if (!tapAtom) {
                    this.placeAtomOrExplain(coords); // 18px の外 ＝ 消すのではなく足す
                } else {
                    // **破壊操作はここでは実行しない**（v1260）。「やる気だった操作」を覚えるだけで、
                    // 実行は pointerup（resolvePendingTap）。指が動いていたら捨てる。
                    //
                    // **なぜ mousedown に閾値を足すだけでは駄目か**: 押した瞬間にもう消えているので、
                    // 「動いたら取り消す」を書く場所が無い。動いたかどうかは離すまで分からない
                    // ＝ 判定できる時点まで**実行を遅らせる**しかない。
                    this.pendingTap = { id: hit.id, client: { x: e.clientX, y: e.clientY } };
                }
            } else {
                // 空き地をクリックしたら原子を新規配置
                this.placeAtomOrExplain(coords);
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

    // 原子を1つ置く。置けなければ**理由を出す**（v1110・発注書 要望A）。
    // もとは handleMouseDown の中に直書きだったが、
    // 「原子の近く（18〜28px）を押したら消すのではなく足す」（DESIGN_hit_areas.md 決定1）で
    // **原子の上をクリックした経路からも**ここへ落ちてくるようになったので関数にした。
    placeAtomOrExplain(coords) {
        if (!coords.isValid) {
            // **置けなかったクリックを黙って捨てない**（v1110・発注書 要望A）。
            // もとは tooLarge と noSpace だけを見ており、
            //   ・近傍原子なし（reason:'far'。v1130 で自由配置に置き換わり退場）
            //   ・ベンゼンの置換基点が塞がっている（reason:'overlap'）
            // は何も出さずに落ちていた。描いている本人には「押したのに何も起きない」
            // としか見えず、どちらに外したのか分からないので直しようがなかった。
            // なお tooLarge の案内は隠しの互換パネル（#panel-legacy は 1px に切り抜き）
            // へ書いていた ＝ **画面には一度も出ていなかった**。字幕トーストに寄せる
            this.explainPlacementMiss(coords);
            return;
        }
        this.clearPlaceMissMark(); // 置けたら直前の「外した」しるしを消す
        this.saveState();
        // プレビューと同一の判定関数で結合相手を決める（プレビュー＝実結果を保証）
        const bondTargets = this.getPlacementBondTargets(coords);
        const newAtom = this.userMolecule.addAtom(this.selectedAtomType, coords.x, coords.y);
        bondTargets.forEach(t => {
            this.userMolecule.addBond(t.id, newAtom.id, 1);
        });
        if (bondTargets.length > 0) this.maybeShowBondToggleHint();
        // ★ A1（DESIGN_isomer_practice.md §14-5）: アルキル基の書き出し練習中にかぎり、
        //   **どこにも結合しない炭素**を置いたら、その場に付け根（C1–R）が生える。
        //   ここに置く理由: 「置けたのか外したのか」の判定を持っているのはこの関数だけで、
        //   結合相手（bondTargets）が空かどうかも**ここでしか分からない**。
        //   ⚠ 元素の判定は `sproutRootFor` の側に置いてある（§14-5 の A2 ＝ 炭素以外は
        //   そのまま置かせて答え合わせで返す）。ここで元素を見ると規則が2か所に散る
        if (bondTargets.length === 0 && window.alkylPractice && window.alkylPractice.sproutRootFor) {
            window.alkylPractice.sproutRootFor(newAtom);
        }
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

    /**
     * 環でなくなった原子から「ベンゼン印」を落とす（v1180・発注書 §2h-3）。
     *
     * **印が何を意味しているか**: `benzeneCenter` / `benzeneAngle` は
     * 「この原子は**環の頂点**なので、置換基は 42px の総当たりではなく
     *  **環の外向きへ 27.97px**（GRID_SIZE*0.666）に置く」という配置の作法を指している
     * （placementFor の step 4 と autoConnectAdjacentAtoms の例外1）。
     *
     * **だから落とす条件は「環でなくなったこと」**。見かけ（六角形に見えるか・炭素6個あるか）で
     * 決めない。v1180 でベンゼンの炭素も同元素タップで消せるようにしたため、
     * 1個消すと残り5個は鎖（1,3-ペンタジエン）になる。**鎖の原子に「環の外向き」は無い**のに
     * 印だけ残ると、置換基が 42px ではなくベンゼンの作法で付き続ける（実測ずみ）。
     * 消しゴム・右クリック削除・結合の削除でも同じことが起きるので、
     * 経路ごとに書かず **描き直しのたびに前提を見直す**（updateDrawing の先頭で1回）。
     *
     * 判定は既存の `_ringAtomIdSet()`（「その結合を除いても両端が繋がっているか」＝ 環結合）を
     * そのまま使う。縮合環（ナフタレン）で片方の環だけ壊れた場合、
     * 残る環に乗っている原子は環結合を持つので印が残り、外れた原子だけ落ちる。
     * 印を持つ原子が1つも無ければ何もしない（毎フレームの費用をゼロにする）。
     */
    dropStaleBenzeneMarks() {
        const marked = this.userMolecule.atoms.filter(a => a.benzeneCenter);
        if (marked.length === 0) return false;
        const inRing = this._ringAtomIdSet();
        let changed = false;
        marked.forEach(a => {
            if (inRing.has(a.id)) return;
            delete a.benzeneCenter;
            delete a.benzeneAngle;
            changed = true;
        });
        return changed;
    }

    /**
     * 押したときに控えた破壊操作（削除・元素置換）を、離した時点で実行する（v1260）。
     *
     * **決定**（2026-08-13・ユーザー）: 「**指が動いたタップをタップと見なさない**」。
     * v1180 で個々の原子のドラッグを廃止した結果、**動かすつもりで原子を引きずると
     * 動かないのではなく消える**ようになっていた（実測: 42px 引きずると原子が1個減る）。
     * 動かせないこと自体は決定どおり（案B-2）なので、覆すのは
     * 「**動かそうとした指が黙って壊す**」ところだけ ＝ 動いたら**何もせずに終わる**。
     *
     * **閾値 8 client px の根拠**:
     *   ① 同じファイルにすでに前例がある —— 結合線の伸縮を離したときの
     *      「タップだったか動かしたか」も **8px**（`hitLine` の pointerup）。
     *      同じ問い・同じタッチ経路なので、値を割るとアプリの中で答えが2通りになる。
     *      Shift＋ドラッグの 3px はマウス専用かつ**外しても非破壊**（分子が動かないだけ）で、
     *      ここに持ってくると押しっぱなしの指ぶれで削除できなくなる
     *   ② 端末側の「タップとみなす動き幅」がおおむね 8px（Android の touch slop は 8dp）
     *   ③ **ATOM_TAP_RADIUS(18 論理px) より必ず小さい**こと。実測した縮尺は
     *      iPhone 12 で 1 client px = 0.957 論理px、Pixel 5 で 0.950、
     *      デスクトップ 1280×800 で 0.410 ＝ 8px は最悪でも **7.7 論理px**。
     *      18px を超えると「ぶれた指が隣の原子に乗る」ほうが先に起きるので、そこは割らない
     *
     * 距離は**斜めも同じ扱い**になるよう hypot で測る（軸ごとの比較だと斜め 45° で 11.3px まで
     * 許してしまう）。判定は client px ＝ 指の物理的な動き。論理px で測ると、
     * 拡大しているときだけ許容が狭くなって「拡大したら消せない」になる。
     */
    resolvePendingTap(e) {
        const p = this.pendingTap;
        this.pendingTap = null;
        if (!p) return;
        // 指が離れずに奪われた（ピンチ・OSのジェスチャ）ものは、そもそもタップではない
        if (e.type === 'pointercancel') return;
        const moved = Math.hypot(e.clientX - p.client.x, e.clientY - p.client.y);
        if (!HIT_AREAS.legacyTapNoCancel && moved > HIT_AREAS.tapMovePx) {
            // **黙って終わる**。ここで「動かせません」と言うと、動かないこと自体は
            // 決定どおり（個々の原子は動かせない）なのに毎回叱られることになる
            return;
        }
        const hit = this.userMolecule.atoms.find(a => a.id === p.id);
        if (!hit) return; // 離すまでに消えていた（Undo・反応の実行など）

        if (hit.isLocked) {
            // ロック原子（アルキル基練習の付け根 C1 と R マーカー）だけは消せない・変えられない。
            // ドラッグを外したのでここは**無反応**になる ＝ 理由を言う
            // （消しゴム側の「ここ（ロックした原子）は消せません。」と同じ語彙）
            this.showToast('ここ（ロックした原子）は消したり別の元素に変えたりできません。');
        } else if (hit.element === this.selectedAtomType) {
            // 同じ元素なら削除（消しゴム代わり）。削除の影響は対象原子のみ（開発方針 5章）。
            // **ベンゼン環の炭素もここを通る**（v1180）。ケクレ構造で持っているので
            // 1つ消せば C₆H₆「ベンゼン」→ C₅H₈「1,3-ペンタジエン」になるだけで価標も壊れない
            this.saveState();
            this.removeAtomWithSplitNotice(hit.id);
            this.updateDrawing();
        } else {
            // 異なる元素なら上書き置換（価標チェック付き。ピリジン等の複素環はこれで作る）
            this.trySwapElement(hit);
        }
    }

    handleMouseUp(e) {
        // 押したときに控えた破壊操作の決着（v1260）。パン・伸縮・ドラッグとは
        // 排他（それらの経路では pendingTap が立たない）なので、先頭で片付ける
        if (this.pendingTap) {
            this.resolvePendingTap(e);
            return;
        }
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
            // ここへ来るのは **Shift＋ドラッグ（分子ごとの移動）だけ**（v1180）。
            // 1原子のドラッグは廃止した（発注書 §2h）ので、掴んでいるあいだ原子は1つも動いていない
            // ＝ 途中経過を戻す必要はなく、離した瞬間に平行移動を1回かけるだけ。
            // マウスがほぼ動いていない「クリックしただけ」なら Undo履歴も消費しない（開発方針 3.5章）
            const moved = !this.dragStartClient ||
                Math.abs(e.clientX - this.dragStartClient.x) > 3 ||
                Math.abs(e.clientY - this.dragStartClient.y) > 3;
            if (!moved) {
                this.history.pop();
                this.updateDrawing();
            } else {
                // 分子を丸ごと平行移動（Shift+ドラッグ）。形は変えないので結合長も角度もそのまま。
                // 移動量はポインタの生の移動量を格子単位に丸めたもの（吸着は使わない）
                const raw = this.dragStartRaw || { x: this.dragStartPos.x, y: this.dragStartPos.y };
                const dx = snapToGrid(coords.rawX - raw.x);
                const dy = snapToGrid(coords.rawY - raw.y);
                if (this.moveComponentBy(this.dragWholeIds, dx, dy)) {
                    this.updateDrawing();
                } else {
                    // **置けない位置には落とさない**（読めない図を作らないため）。
                    // ここは 0.0px の完全重複を止める最後の関所でもある（v736 の実事故 →
                    // v1180 で 1原子ドラッグを廃止したので、罠はこの経路に移った）。
                    // 判定の実体は canMoveComponentBy（否定対照 ZD2 がここを外して赤を確かめる）
                    this.history.pop();
                    this.showToast('その位置には他の分子と重なるため置けません。別の場所へ動かしてください。');
                    this.updateDrawing();
                }
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
        if (!this.canMoveComponentBy(ids, dx, dy)) return false;
        this.userMolecule.atoms.forEach(a => { if (ids.has(a.id)) { a.x += dx; a.y += dy; } });
        return true;
    }

    /**
     * 連結成分 ids を (dx, dy) 動かした先が「置ける位置」か（v736 → v1180 でここへ移設）。
     *
     * **なぜ判定だけ切り出すか**: これが **0.0px の完全重複を止める最後の関所**だから。
     * v736 の実事故（重原子どうしが 15桁一致する ＝ 完全に重なった図ができる）を止めているのは
     * この1つの不等式で、当時は 1原子ドラッグの落下先（`canDropAtomAt`）に置いてあった。
     * v1180 で 1原子ドラッグを廃止した（発注書 §2h）ので、**罠ごと消えないよう**
     * Shift＋ドラッグ側へ移した。関数として名前が付いていれば否定対照（ZD2）が
     * ここを差し替えて「外すと 0.0px が必ず戻る」ことを機械で確かめられる
     * ＝ ZD1 の緑が「何も見ていないだけ」でないことが保証される。
     *
     * しきい値は新規配置（getSnappedCoords）と同じ MIN_CLEARANCE ＝ GRID_SIZE*0.65 ＝ 27.3px。
     * 自動水素は描画時に決まるので数えない。
     */
    canMoveComponentBy(ids, dx, dy) {
        const MIN_CLEARANCE = MIN_COMPONENT_CLEARANCE;
        const moving = this.userMolecule.atoms.filter(a => ids.has(a.id) && a.element !== 'H');
        const others = this.userMolecule.atoms.filter(a => !ids.has(a.id) && a.element !== 'H');
        for (const a of moving) {
            const nx = a.x + dx, ny = a.y + dy;
            for (const o of others) {
                if (Math.hypot(nx - o.x, ny - o.y) < MIN_CLEARANCE) return false;
            }
        }
        return true;
    }

    /**
     * 連結成分を「いま並んでいる順」で id 集合として返す（`splitMolecules` と同じ拾い方）。
     * ⚠ 順番は `userMolecule.atoms` の並び ＝ 図の下の ①②③ と同じ（§12-4）。
     *   並べ直しがこの順を崩すと「どれが自分の何番目の答えか」が分からなくなる
     */
    componentIdSets() {
        const seen = new Set();
        const sets = [];
        this.userMolecule.atoms.forEach(a => {
            if (seen.has(a.id)) return;
            const ids = new Set([a.id]);
            const stack = [a.id];
            seen.add(a.id);
            while (stack.length) {
                const id = stack.pop();
                this.userMolecule.getNeighbors(id).forEach(n => {
                    if (!seen.has(n.atom.id)) {
                        seen.add(n.atom.id);
                        ids.add(n.atom.id);
                        stack.push(n.atom.id);
                    }
                });
            }
            sets.push(ids);
        });
        return sets;
    }

    /**
     * ★ 答案を並べ直す（DESIGN_isomer_practice.md §12-5・W4）。
     *
     * キャンバスの `viewBox` は 800×600、格子は 42px ＝ 19×14 マス。C₄H₁₀O の異性体は
     * 1つ約 4×3 マスなので 7種で埋まり、芳香族はもっと食う。散らかった答案用紙を
     * **格子のスロットへ配り直す**ための道具。
     *
     * ★★ **やるのは成分ごとの平行移動だけ**。移動量は `GRID_SIZE` の整数倍で、
     * どの原子の**内部の相対座標**（成分の重心からの差）も 1 つも変えない。
     * これが守れているかぎり CLAUDE.md の
     *   「整形で幾何が変わるなら座標を戻す」「シス/トランスが未確定の図は整形しない」
     * に**触れずに済む** —— 剛体移動は幾何を1つも決め直さないため。検査は **IW7**。
     *
     * ★★ **回転を混ぜてはいけない**（DESIGN_isomer_practice.md §5-3・§5-6）。
     * 「縦置きなら詰められる」「90°回せば1列増える」は思いつくが、**やらない**:
     * 立体の読み（`isFischerOriented`・v446）は**縦置きの図だけをフィッシャー投影として読む**
     * ので、並べ直しが図を回すと**描いた本人が触っていないのに立体の意味が変わる**。
     * 平行移動だけなら向きは1度も動かないので、この規則を自然に満たす。
     *
     * ★ **自動では走らせない**（§12-5）。勝手に動くと、どれが自分の何番目の答えか
     * 分からなくなる ＝ 「散らかったら押す」ボタンからだけ呼ぶ。
     *
     * 落下先の決め方は分子ごとの移動（ZD の帯）と**同じ規則**を借りる ＝
     * 別の成分の重原子と `MIN_COMPONENT_CLEARANCE` より近づけない。
     * スロットの隙間（横 `GAP = GRID_SIZE * 2 = 84px` ／ **縦 `GAP_Y = GRID_SIZE * 3 = 126px`**）は、
     * 移動量を格子倍に丸めたときのずれ（最大 ±21px が両隣で逆向き ＝ 42px）を引いても 42px 残るので、
     * 構成だけで 27.3px を上回る。**それでも最後に実測で確かめ**、破っていたら
     * 1つも動かさずに戻す（判定が空振りしていないことは IW7 が別に押さえる）。
     *
     * @returns {{ moved:number, total:number, cols:number, rows:number, reason?:string }}
     */
    tidyAnswerSlots() {
        const sets = this.componentIdSets();
        if (sets.length === 0) return { moved: 0, total: 0, cols: 0, rows: 0, reason: 'empty' };

        const atomById = new Map(this.userMolecule.atoms.map(a => [a.id, a]));
        // 成分ごとの外接矩形。**自動水素は描画時に決まる**ので、置いてある原子だけを見る
        const boxes = sets.map(ids => {
            const atoms = [...ids].map(id => atomById.get(id)).filter(Boolean);
            return {
                ids,
                minX: Math.min(...atoms.map(a => a.x)), maxX: Math.max(...atoms.map(a => a.x)),
                minY: Math.min(...atoms.map(a => a.y)), maxY: Math.max(...atoms.map(a => a.y))
            };
        });

        // スロットの大きさ ＝ いちばん大きい答案 ＋ 隙間。**全スロットを同じ大きさ**にする
        // （§12-5 の「格子のスロットへ配る」）。大小を詰めると、描き足したときに
        // 並びが総入れ替えになって ①②③ の場所が毎回変わる
        const GAP = GRID_SIZE * 2;   // 84px（横。見出しは番号1文字ぶん＝36px しか無いので横は足りる）
        // ★ **縦は横より1マス広い**（v1432・ユーザー報告「番号①がまとめて下側に表示される」）。
        //   ここの隙間を**3人で取り合っている**からで、84px では1人ぶん足りていなかった:
        //     ① 見出しを置かない帯 …… 分子の下端＋1.1マス          46.2px
        //     ② 見出しチップ       …… `LABEL_CHIP_HEIGHT`           34.0px
        //     ③ **下の行の自動水素** … 重原子から 16px 伸ばして半径9 25.0px（上へ張り出す）
        //   合計 105.2px。**旧 84px だと ③ が ② に必ず食い込む**ので、並べ直した直後に
        //   どの見出しも「重なり 10000」を抱え、`placeMoleculeLabels` の段送りへ回る。
        //   段送りは距離を数えない（`labelPlacementCost`）ため遠くの空き行のほうが安く、
        //   逃げた見出しが次の見出しの既定位置に居座って**数珠つなぎに下へ流れる**
        //   ＝ 「番号が下に固まる」の正体（実測・実物の異性体20個で 7/20・最大8マス）。
        //   3マス（126px）にすると 105.2px を 21px の余裕つきで満たす。
        //
        // ⚠ **この数を定数で書けるのは、同じ v1432 で `labelScale()` が練習中 1 を返すから。**
        //   それ以前はチップが画面px 固定＝引いて見るほどモデル座標で太ったので、
        //   必要な隙間が「並べ直したあとの縮尺」で決まる鶏と卵になっていた
        //   （発注書 ORDER_isomer_2026-08-20.md §A-3 が案①を退けた理由がこれ）。
        //   ⚠ **`labelScale()` の練習中の分岐を外すなら、ここも一緒に見直すこと。**
        const GAP_Y = GRID_SIZE * 3; // 126px
        const cellW = Math.ceil((Math.max(...boxes.map(b => b.maxX - b.minX)) + GAP) / GRID_SIZE) * GRID_SIZE;
        const cellH = Math.ceil((Math.max(...boxes.map(b => b.maxY - b.minY)) + GAP_Y) / GRID_SIZE) * GRID_SIZE;

        // 列数は**全体が 4:3 に近くなる**ように選ぶ。キャンバスも「全体表示」も 4:3 なので、
        // ここを外すと細長い帯になって、合わせた視野の中で図が無駄に小さくなる
        const n = boxes.length;
        const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * (cellH / cellW) * (4 / 3))) || 1));
        const rows = Math.ceil(n / cols);

        // 起点は「いまの答案全体の左上」を格子に載せた点。原点(0,0)へ寄せると、
        // 拡大して見ていた人の視野から答案が丸ごと消える
        const originX = Math.round(Math.min(...boxes.map(b => b.minX)) / GRID_SIZE) * GRID_SIZE;
        const originY = Math.round(Math.min(...boxes.map(b => b.minY)) / GRID_SIZE) * GRID_SIZE;

        // ★ 移動量は必ず GRID_SIZE の整数倍（格子に載っていた原子は載ったまま）
        const deltas = boxes.map((b, k) => {
            const slotX = originX + (k % cols) * cellW;
            const slotY = originY + Math.floor(k / cols) * cellH;
            return {
                ids: b.ids,
                dx: Math.round((slotX - b.minX) / GRID_SIZE) * GRID_SIZE,
                dy: Math.round((slotY - b.minY) / GRID_SIZE) * GRID_SIZE
            };
        });

        const owner = new Map();
        deltas.forEach((d, k) => d.ids.forEach(id => owner.set(id, k)));
        const placed = this.userMolecule.atoms.map(a => {
            const d = deltas[owner.get(a.id)];
            return { a, x: a.x + d.dx, y: a.y + d.dy, comp: owner.get(a.id) };
        });

        // ★ 負の側へ出たぶんを、**全体で同じだけ**格子倍に押し戻す（検査は IW16）。
        //   起点は左上を格子に丸めた点なので、答案が**左端から半マス以内**にあると
        //   `originX` が答案より左（0）に落ちる。そこへ各成分を格子倍で寄せると
        //   丸めのずれ（最大 ±21px）が負に出て、**1枚でも負なら全部を取りやめていた**。
        //   全成分に同じ量を足すだけなので、剛体移動である性質も相対配置も変わらない。
        //   ⚠ 「答案が多すぎる」と案内していたが**枚数とは無関係**で、
        //   　 実際には**左上から描き始めた人だけ**が踏み、答案を消しても直らなかった。
        const minPX = Math.min(...placed.map(p => p.x));
        const minPY = Math.min(...placed.map(p => p.y));
        const shiftX = minPX < 0 ? Math.ceil(-minPX / GRID_SIZE) * GRID_SIZE : 0;
        const shiftY = minPY < 0 ? Math.ceil(-minPY / GRID_SIZE) * GRID_SIZE : 0;
        if (shiftX || shiftY) {
            deltas.forEach(d => { d.dx += shiftX; d.dy += shiftY; });
            placed.forEach(p => { p.x += shiftX; p.y += shiftY; });
        }

        // 置いた先が上限（CANVAS_LIMIT）を越えるなら何もしない。編集できない場所へ送らない
        if (placed.some(p => p.x < 0 || p.y < 0 || p.x > CANVAS_LIMIT || p.y > CANVAS_LIMIT)) {
            return { moved: 0, total: n, cols, rows, reason: 'outOfBounds' };
        }

        // ★ ZD の帯と同じ規則を実測で確かめる（0.0px の完全重複を作らない）。
        //   構成上は満たしているはずだが、**満たしていない並べ方を黙って置かない**
        const heavy = placed.filter(p => p.a.element !== 'H');
        for (let i = 0; i < heavy.length; i++) {
            for (let j = i + 1; j < heavy.length; j++) {
                if (heavy[i].comp === heavy[j].comp) continue;
                if (Math.hypot(heavy[i].x - heavy[j].x, heavy[i].y - heavy[j].y) < MIN_COMPONENT_CLEARANCE) {
                    return { moved: 0, total: n, cols, rows, reason: 'clearance' };
                }
            }
        }

        const moved = deltas.filter(d => d.dx !== 0 || d.dy !== 0).length;
        if (moved === 0) return { moved: 0, total: n, cols, rows, reason: 'alreadyTidy' };

        this.saveState();   // ↩ で1手で戻せる（並べ直しは取り消せる操作）
        placed.forEach(p => { p.a.x = p.x; p.a.y = p.y; });
        this.updateDrawing();
        // 並べ直した全体が見えるところまで視野を合わせる。**拡大率を触るのはここだけ**で、
        // 座標には手を出していない（拡大縮小・パンは従来どおりそのまま効く）
        this.fitCanvasToMolecule(this.userMolecule);
        return { moved, total: n, cols, rows };
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
        this.deactivateReactionSelectMode();
        this.deactivateStereoPointMode();
    }

    // α/β 面マークモードを解除する（他モードへ切替える既存フックから呼ぶ。P12-7 M2b）
    deactivateHaworthMode() {
        this.haworthMode = false;
        const bhm = document.getElementById('btn-haworth-mark');
        if (bhm) bhm.classList.remove('active');
    }

    /**
     * 「立体が分かれる場所」の印モードを解除する（v1435・段1）。
     * ⚠ **印は消さない**（§4-2「印を消さずに何度でも直せる」）。降ろすのはモードだけ。
     * 入口は作業帯のボタンなので、`setTool` などの既存フックからも降ろせるようにここに置く
     * （降ろしたことは `renderStrip()` の描き直しでボタンの見た目に伝わる）。
     */
    deactivateStereoPointMode() {
        if (!this.stereoPointMode) return false;
        this.stereoPointMode = false;
        this.clearUIOverlay();
        if (window.isomerPractice && window.isomerPractice.active) window.isomerPractice.renderStrip();
        return true;
    }

    /** 印モードのホバープレビュー（結合側）。原子側は `drawAsymmetricPreview` と共用 */
    drawStereoBondPreview(bond) {
        const NS = 'http://www.w3.org/2000/svg';
        const mol = this.userMolecule;
        const a = mol.atoms.find(x => x.id === bond.atomId1);
        const b = mol.atoms.find(x => x.id === bond.atomId2);
        if (!a || !b) return;
        const willUnmark = !!bond.isStereoMarked;
        const color = willUnmark ? 'rgba(200,200,200,0.9)' : 'var(--neon-orange, #ff9f43)';
        const ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('cx', (a.x + b.x) / 2);
        ring.setAttribute('cy', (a.y + b.y) / 2);
        ring.setAttribute('r', '12');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', color);
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('stroke-dasharray', '4,3');
        ring.setAttribute('pointer-events', 'none');
        this.uiGroup.appendChild(ring);
    }

    /**
     * 「🎯 反応させる分子を選ぶ」モードを解除する（v1409・ユーザー申し立て「作図できなくなる」）。
     *
     * **症状**: このモードを ON にすると `handleMouseDown` がキャンバスのタップを
     * 丸ごと選択に振り替える（「選択モード時は作図・編集を完全にブロック」）。ところが
     * **下ろす手段が `#btn-reaction-select` を押し直すことだけ**で、そのボタンは
     * 分子モーダルの中にある ＝ モーダルを閉じた瞬間、ON だと分かる手がかりが画面から消える。
     * 以後どこへ行っても1原子も置けない —— **生成物予測モードでも置けない**
     *（予測は `blocksEditing()` を false にして編集を許すが、その手前でこのモードが食う）。
     * 実測: 自由モードで分子を作る → ⚗ 反応させる・調べる → 🎯 反応させる分子を選ぶ →
     * モーダルを閉じる → キャンバスをタップ **0個のまま** → 機構ビューア → 🎯 予測 →
     * **やはり0個のまま**（`reactionSelectMode === true`）。
     *
     * **直し方**: 他のタップ横取りモード（不斉マーク・整形・ハース面）と**同じ扱いにそろえる**。
     * それらは `setTool()` が一括で下ろしていたのに、このモードだけ列から漏れていた
     *（ON にするときは向こうを下ろしているので、**片道だけ実装されていた**）。
     * ＝ 描く道具を選んだら選ぶモードは下りる。加えて `setMode()`（モードタブ）と
     * `ReactionPlayer.enter()`（機構ビューア）からも呼ぶ —— ビューアは `currentMode` を
     * 変えないので、`setMode` 経由の出口だけでは届かない（上の実測がその経路）。
     *
     * ⚠ **ここでツールを触らない。** 呼び元は `setTool()` の途中で、選び終えた道具を
     *    上書きしてしまう。ボタンの札を戻すのは `#btn-reaction-select` 自身の分岐の仕事。
     * 戻り値: 実際に下ろしたら true（下りていなければ何もしない ＝ 描画も走らせない）。
     */
    /**
     * キャンバスに載っている分子の数（v1409）。重原子を1つでも持つ連結成分だけ数える
     *（水素だけの欠片・置きかけの H は「分子」として案内に出さない）。
     * ⚠ 数え方は `splitMolecules()` に任せる ＝ 図の見出し（`markedMolecules`）と
     *   同じ切り分けを使う。ここで独自に連結成分を歩くと、番号と案内で数が食い違う
     */
    canvasMoleculeCount() {
        if (!this.splitMolecules) return 0;
        return this.splitMolecules().filter(p => p.atoms.some(a => a.element !== 'H')).length;
    }

    deactivateReactionSelectMode() {
        if (!this.reactionSelectMode) return false;
        this.reactionSelectMode = false;
        this.selectedMolecules = [];
        const btn = document.getElementById('btn-reaction-select');
        if (btn) btn.classList.remove('active');
        this.updateDrawing(); // 選択枠（青の破線＋①②）を消す
        return true;
    }

    /**
     * ===== キャンバス上の常設バッジ（v1416・発注書 A-4 の残り1） =====
     *
     * **なぜ要るか**: 「🎯 反応させる分子を選ぶ」は
     *   分子モーダルを開く → 🎯 を押す → **モーダルを閉じる** → キャンバスをタップ
     * という順で使う。ON の印は**閉じたモーダルの中のボタンの `.active` だけ**なので、
     * 実際に作業しているあいだ、画面のどこにも「いま選ぶモードです」と書いていない
     * （トーストは 7〜9 秒で消え、`#reaction-selection` の案内はモーダルを開き直した人しか読めない）。
     * v1409 で出口は4つ付いて**行き止まりは解けた**が、「いま入っている」ことは見えないままだった。
     *
     * **出し入れは状態から導く**（発注書の絶対条件4）。ここで `hidden` を付け外しする代わりに
     * `updateDrawing()` の先頭で毎回そろえる ＝ 下ろす経路が4つ（`setTool()`・`.mod-btn`・
     * `setMode()`・`ReactionPlayer.enter()`）あっても、どれも `deactivateReactionSelectMode()`
     * → `updateDrawing()` を通るので**バッジだけ残る**が起きない。
     *
     * **将来ほかのモードにも足せる形**にしてある（整形・不斉マーク・ハース面も同じ
     * `tapHasOtherMeaning()` の仲間）。⚠ ただし**今回は作らない**（範囲外）。
     * 足すときは、この関数に分岐を1つ増やすだけで器も CSS も使い回せる。
     *
     * ⚠ 文言に「**編集できません**」と書かない。いま止まっているのは
     *   `handleMouseDown` の**タップの意味だけ**で、↩ 戻す・分子ごとのドラッグ・🗑 全消去は
     *   生きている（2分子を並べて見るのに要る操作なので、そのままでよい＝ユーザー判断）。
     */
    canvasModeBadgeSpec() {
        if (this.reactionSelectMode) {
            // 数は `selectedMolecules` の生の長さではなく `selectedMoleculeSets()` で数える
            // ＝ 反応で1つに繋がった2件をまとめる規則（図の枠と同じ数）を共有する
            const n = this.selectedMoleculeSets().length;
            return {
                mode: 'reaction-select',
                title: '🎯 反応させる分子を選ぶ',
                count: `選んだ ${n}/${MAX_REACTION_SELECTION}`,
                countTitle: `いま選んでいる分子の数（${MAX_REACTION_SELECTION}つまで／先に選んだ方が式の左）`,
                // ⚠ 「編集できません」とは書かない。止まっているのはタップの意味だけで、
                //   動かす・戻す・消すは生きている（できることを必ず並べて書く）
                note: '作図（原子を置く・結合をつなぐ）はできません。'
                    + '分子を動かす・↩ 戻す・🗑 全消去はできます。',
                stop: 'やめる',
                stopTitle: '選ぶのをやめて作図に戻ります（左の道具や環・官能基のボタンを選んでも戻ります）'
            };
        }
        return null;
    }

    /** バッジをいまの状態にそろえる。**呼ぶのは `updateDrawing()` の先頭1か所だけ** */
    syncCanvasModeBadge() {
        const box = document.getElementById('canvas-mode-badge');
        if (!box) return;
        const spec = this.canvasModeBadgeSpec();
        if (!spec) {
            box.classList.add('hidden');
            box.removeAttribute('data-mode');
            this._modeBadgeKey = '';
            return;
        }
        // `#from-band`（アプリ横断の戻り道）が出ている回だけ、その実測ぶん下へ降ろす。
        // 帯の高さは文言と幅で変わるので、決め打ちの数字を置かない
        const band = document.getElementById('from-band');
        const wrap = document.getElementById('svg-wrapper');
        let top = 8;
        if (band && wrap && !band.classList.contains('hidden')) {
            const br = band.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
            if (br.height > 0) top = Math.round(br.bottom - wr.top) + 8;
        }
        box.style.top = top + 'px';
        box.classList.remove('hidden');
        // 中身は変わったときだけ組み直す（updateDrawing は作図のたびに走る）
        const key = `${spec.mode}|${spec.count}`;
        if (this._modeBadgeKey === key) return;
        this._modeBadgeKey = key;
        box.setAttribute('data-mode', spec.mode);
        box.innerHTML = '';
        const span = (cls, text) => {
            const el = document.createElement('span');
            el.className = cls;
            el.textContent = text;
            box.appendChild(el);
            return el;
        };
        span('cmb-title', spec.title);
        span('cmb-count', spec.count).title = spec.countTitle || '';
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'cmb-stop';
        stop.textContent = spec.stop;
        stop.title = spec.stopTitle;
        stop.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.stopCanvasModeBadgeMode();
        });
        box.appendChild(stop);
        span('cmb-note', spec.note);
    }

    /**
     * バッジの「やめる」。⚠ **下ろす道を5本目にしない** ——
     * `#btn-reaction-select` を押したのと同じことにして、道具の札を戻す後始末まで
     * ボタン自身の分岐（→ `deactivateReactionSelectMode()`）に任せる。
     * ボタンが取り除かれていた場合の保険として、直接下ろす道だけ残す。
     */
    stopCanvasModeBadgeMode() {
        if (this.reactionSelectMode) {
            const btn = document.getElementById('btn-reaction-select');
            if (btn) { btn.click(); return; }
            if (this.deactivateReactionSelectMode()) this.updateDrawing();
        }
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
        // もともと右パネルの #verify-result はスクロールで見切れて気づかれないことがあり、
        // キャンバス内の字幕を主役にしてあった。第5段で右パネルが消え、#verify-result は
        // 隠しの互換の器（#panel-legacy）になったので、**見えるのはこの字幕だけ**（§2-7）
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

    // ===== 置けなかったクリックの説明（v1110・発注書「作図の当たり判定」要望A） =====
    //
    // **なぜ要るか**: `getSnappedCoords` は理由を計算しているのに、呼び出し側が
    // `isValid` しか見ずに捨てていた。押した本人には「押したのに何も起きない」としか
    // 見えず、**どちらに外したのか（遠すぎ／近すぎ／別の原子に取られた）が分からない**。
    //
    // **言葉と図の役割分担**（両方を実機で試して決めた）:
    //   ・言葉（字幕トースト）… **なぜ**置けなかったか。図では説明できない
    //   ・図（miss-group のしるし）… **どこを押したか** と **どの原子が選ばれたか**。
    //     「◯◯に取られました」は原子に名前が無いので言葉で名指しできない ＝ 図で丸をつける
    //
    // **うるさくしない手当て**: 作図中は失敗が連続する。
    //   ・同じ文言は**出し直さない**（表示時間だけ延ばす ＝ 画面は動かない）
    //   ・文言が変わるときも、直前の表示から MISS_HOLD_MS は差し替えない
    //     （なぞっている最中に理由がころころ入れ替わって読めなくなるのを防ぐ）
    explainPlacementMiss(coords) {
        this.drawPlaceMissMark(coords);
        const msg = this.placementMissMessage(coords);
        const now = Date.now();
        const MISS_HOLD_MS = 800;
        if (msg !== this._missMsg && now - (this._missAt || 0) < MISS_HOLD_MS) {
            this._missAt = now; // なぞり続けているあいだは前の文言を保持する
            return;
        }
        this._missMsg = msg;
        this._missAt = now;
        this.showToast(msg, 3500);
    }

    // 置けなかった理由を日本語にする。文言に px の数字を入れない
    // （吸着半径の値は別レーン（要望B）で変わりうるので、変えると嘘になる数字を書かない）
    placementMissMessage(coords) {
        const stolen = !!coords.stolen;
        switch (coords.reason) {
            case 'toolarge':
                return 'キャンバスの限界（±5000px）です。これ以上は外へ広げられません。';
            case 'crowded':
                // 自由配置（どの原子とも競わない遠さ）でクリアランスを割った場合。
                // **「結合線を伸ばす」逃げ道は効かない**（伸ばす結合が無い）ので、
                // 延長で詰んだ 'overlap' とは別の言い方をする
                return '近すぎます。ここは となりの原子に近すぎて、新しい分子として置けません。'
                    + 'もう少し離れた場所をタップしてください。';
            case 'far':
                // v1130 で自由配置（決定1）に置き換わり、この経路は出なくなった。
                // 分岐が復活したときに黙って捨てる状態へ戻らないための受け皿として残す
                return '遠すぎます。つなげたい原子のもっと近くをタップしてください。';
            case 'blocked':
                return stolen
                    ? '近くの別の原子（図の○印）に取られました。そこは四方が埋まっていて空きがありません。'
                    : '空きがありません。四方が埋まっていて、新しい結合を出す向きがありません。';
            case 'overlap':
                return stolen
                    ? '近くの別の原子（図の○印）に取られました。そこから出すと となりの原子と重なります。'
                    : '近すぎます。ここに置くと となりの原子と重なります。'
                        + '結合線をドラッグして伸ばすと空間ができます。';
            case 'crossing':
                // 原子どうしの間隔は足りているのに、**結合線が別の原子の下をくぐる**（§2g・v1160）。
                // 'overlap' と逃げ道が違うので言い分ける ―― こちらは
                // **伸ばすほど深くくぐる**ので「結合線を伸ばす」は効かない。
                // 通り道をふさいでいる原子をどかすか、別の向きから出すのが手当て
                return stolen
                    ? '近くの別の原子（図の○印）に取られました。そこから出すと、結合線が別の原子の上を通ります。'
                    : '結合線が別の原子の上を通ってしまいます。'
                        + '別の向きをタップするか、じゃまな枝を先にどかしてください。';
            case 'hcrossing':
                // 自由配置（新しい分子として置く）で、**その原子から生える水素**が
                // 既存の結合線に重なる（§10-7 の決着・v1240）。'crossing' と言い分けるのは、
                // ここには結合線そのものが無く「結合線が…通る」が**嘘になる**から。
                // 手当ては「少しずらす」―― 自由配置は向きも長さも選べないので、
                // どかす枝の話でもない
                return 'ここに置くと、その原子から出る水素（H）が別の結合線に重なります。'
                    + 'もう少しずらした場所をタップしてください。';
            default:
                // 分岐が増えたときに黙って捨てる状態へ戻らないための受け皿
                return 'ここには置けません。位置を少しずらしてタップしてください。';
        }
    }

    // 押した点に「外した」しるしを一瞬だけ出す。
    // ⚠ `ui-group` ではなく専用の `miss-group` に描く。ui-group は次の pointermove で
    //    毎回まるごと消されるので、マウスだと出た瞬間に消えてしまう
    drawPlaceMissMark(coords) {
        if (!this.missGroup) return;
        const NS = 'http://www.w3.org/2000/svg';
        this.clearPlaceMissMark();
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('class', 'place-miss');
        const x = coords.rawX;
        const y = coords.rawY;
        // 1. 押した点（○＋×）
        const ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('cx', x);
        ring.setAttribute('cy', y);
        ring.setAttribute('r', '13');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', 'var(--neon-red, #ff2a85)');
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('stroke-dasharray', '4,3');
        g.appendChild(ring);
        [[-6, -6, 6, 6], [-6, 6, 6, -6]].forEach(([ax, ay, bx, by]) => {
            const l = document.createElementNS(NS, 'line');
            l.setAttribute('x1', x + ax); l.setAttribute('y1', y + ay);
            l.setAttribute('x2', x + bx); l.setAttribute('y2', y + by);
            l.setAttribute('stroke', 'var(--neon-red, #ff2a85)');
            l.setAttribute('stroke-width', '2');
            g.appendChild(l);
        });
        // 2. 「取られた」相手を名指しする丸と、押した点からの引き出し線
        const blocker = coords.blockedAtom;
        if (blocker && coords.reason !== 'far') {
            const mark = document.createElementNS(NS, 'circle');
            mark.setAttribute('cx', blocker.x);
            mark.setAttribute('cy', blocker.y);
            mark.setAttribute('r', '15');
            mark.setAttribute('fill', 'none');
            mark.setAttribute('stroke', 'var(--neon-orange, #ffa502)');
            mark.setAttribute('stroke-width', '2');
            g.appendChild(mark);
            const d = Math.hypot(blocker.x - x, blocker.y - y);
            if (d > 20) {
                const ux = (blocker.x - x) / d;
                const uy = (blocker.y - y) / d;
                const l = document.createElementNS(NS, 'line');
                l.setAttribute('x1', x + ux * 14); l.setAttribute('y1', y + uy * 14);
                l.setAttribute('x2', blocker.x - ux * 16); l.setAttribute('y2', blocker.y - uy * 16);
                l.setAttribute('stroke', 'var(--neon-orange, #ffa502)');
                l.setAttribute('stroke-width', '1.5');
                l.setAttribute('stroke-dasharray', '3,3');
                g.appendChild(l);
            }
        }
        this.missGroup.appendChild(g);
        this._missMarkTimer = setTimeout(() => this.clearPlaceMissMark(), 1100);
    }

    clearPlaceMissMark() {
        clearTimeout(this._missMarkTimer);
        if (this.missGroup) this.missGroup.innerHTML = '';
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
                // ⚠ **stages 側の `id` も渡す**（DEVELOPMENT.md §7-1c）。落とすと
                // stages にしかない58件が id で引けない（エチレン・アセチレン・プロペンがここ）
                ...STAGES.map(s => ({ id: s.id, name: s.name, target: s.target, stereo: s.stereo })),
                ...COMPOUNDS.map(c => ({ id: c.id, name: c.name, target: c.target, stereo: c.stereo }))
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
                    id: e.id || null,
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
            // ⚠ **畳むときに `id` を落とさない。** 同じ名前が stages と compounds の両方にある
            // 54件は、並び順の都合で **id を持たない stages 側が残る**。そのまま畳むと
            // `?summon=methane` が引けなくなるので、畳まれる側の id を残る側へ移す
            const seenKey = new Map();
            this._compoundLibrary = this._compoundLibrary.filter(e => {
                const key = `${e.name}|${e.code}|${e.stereoCode || '-'}`;
                const kept = seenKey.get(key);
                if (kept) {
                    if (!kept.id && e.id) kept.id = e.id;
                    return false;
                }
                seenKey.set(key, e);
                return true;
            });
            this._compoundCodeMap = new Map();
            this._compoundLibrary.forEach(e => {
                if (!this._compoundCodeMap.has(e.code)) this._compoundCodeMap.set(e.code, []);
                this._compoundCodeMap.get(e.code).push(e);
            });
            this._buildCompoundNameIndex();
        }
        return this._compoundLibrary;
    }

    /**
     * 名前・別名からエントリを引く索引を作る（§9.6-10）
     *
     * ライブラリの名前は「主名（別名）」の形で付ける決まりなのに、その分解を誰もして
     * いなかったので、**`エチレン` では引けず `エチレン（エテン）` と打つ必要があった**。
     * qa（一問一答）が指したい74種のうち11種がこの型で、**重みでは最大**
     * （エチレンは8項目・アセチレンは5項目から指されている）。
     *
     * ⚠ **一意に決まるときだけ採る。** 同じ主名／別名が2つ以上のエントリに当たったら
     * その鍵は捨てる（`null` を入れて以後も拾わせない）。曖昧なまま先頭を採ると、
     * 「セッケン」で5つのうちどれか1つが黙って出るような当て方になる。
     *
     * ⚠ **正式名（`e.name` そのもの）が常に勝つ。** `ブテン二酸（マレイン酸／フマル酸）` の
     * 括弧の中には**他のエントリの正式名**が入っている。索引が正式名を上書きすると
     * 「マレイン酸」がブテン二酸になってしまう。
     */
    _buildCompoundNameIndex() {
        const byName = new Set(this._compoundLibrary.map(e => e.name));
        const map = new Map();
        const claim = (key, entry) => {
            if (!key || byName.has(key)) return;   // 正式名は索引に入れない（find が先に当たる）
            if (!map.has(key)) { map.set(key, entry); return; }
            const prev = map.get(key);
            if (prev && prev.name !== entry.name) map.set(key, null); // 曖昧 ＝ 採らない
        };
        this._compoundLibrary.forEach(e => {
            const { main, aliases } = splitCompoundName(e.name);
            claim(main, e);
            aliases.forEach(a => claim(a, e));
        });
        this._compoundNameIndex = map;
        // 不変の `id` の索引（受け口① `?summon=<id>`。DEVELOPMENT.md §7-1・§7-1c）。
        // ⚠ **名前の索引とは別に持つ。** 混ぜると「id と同じ綴りの別名」が現れたとき
        // どちらの意味か分からなくなる。stages と compounds の両方が id を持ち、
        // 同名なら同じ id なので、先勝ちで拾って構わない
        const idMap = new Map();
        this._compoundLibrary.forEach(e => { if (e.id && !idMap.has(e.id)) idMap.set(e.id, e); });
        this._compoundIdIndex = idMap;
    }

    /**
     * 表示名・主名・別名のどれからでもライブラリのエントリを引く（§9.6-10）。
     * 引けなければ null。**前方一致はしない** —— `メチル` のような断片は数百件に当たるので、
     * 一致を緩めると「打った覚えのない分子が出る」ほうの事故になる。
     */
    resolveCompound(query) {
        const q = String(query == null ? '' : query).trim();
        if (!q) return null;
        const lib = this.getCompoundLibrary();
        const exact = lib.find(e => e.name === q);
        if (exact) return exact;
        // 不変の `id`（`?summon=ethylene`）。**表示名の次・別名より先**に見る ——
        // id は変わらないと約束したものなので、表示名の揺れに勝たせる理由がない代わりに、
        // 別名（表示名の一部）よりは強い
        const byId = this._compoundIdIndex.get(q);
        if (byId) return byId;
        return this._compoundNameIndex.get(q) || null;
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

    /**
     * 「いま描いている分子」の**名前と分子式を1か所で決める**（updateDrawing から毎回呼ばれる）。
     *
     * ⚠ **DOM から読み返さない**（DESIGN_ribbon_consolidation.md 第5段の下ごしらえ）。
     * v748 までは「右パネルの `#compound-name` / `#compound-formula` に書く」→
     * 「チップがその **textContent を読み返して**組み立てる」という順で、
     * **表示先が表示先に依存していた**。右パネルを消すと `#compound-name` が
     * 無くなり、`updateCompoundInfo` は冒頭で return、チップは黙って空になる
     * （§17-6 が「第5段の唯一の実装上の罠」として申し送った箇所）。
     * いまは文字列を `this.compoundLabel` に持ち、**どの表示先も同じ文字列を受け取る**。
     * 表示先が1つ消えても、残った表示先は影響を受けない。
     */
    updateCompoundInfo() {
        this.compoundLabel = this.computeCompoundLabel();
        // 右パネルの「🔍 いま描いている分子」（第5段の後は隠しの控え。台本の `?rec=` と
        // 回帰テストが `#compound-name` の textContent で名称判定を読む）
        const nameEl = document.getElementById('compound-name');
        const formulaEl = document.getElementById('compound-formula');
        if (nameEl) nameEl.textContent = this.compoundLabel.name;
        if (formulaEl) formulaEl.textContent = this.compoundLabel.formula;
        this.syncMobileNameChip();
    }

    /** 「いま描いている分子」の名前と分子式を組み立てる（表示先を1つも知らない純粋な計算） */
    computeCompoundLabel() {
        if (this.userMolecule.atoms.length === 0) return { name: '—', formula: '—' };
        const formula = this.computeMolecularFormula();

        // 生成物予測モード中は名称を伏せる（答えのヒントになりすぎるため）
        if (window.reactionPlayer && window.reactionPlayer.prediction) {
            return { name: '？？？（予測中）', formula };
        }

        // 複数の分子があるときは分子ごとに名前を出す（反応の副生成物や、名称呼び出しで
        // 複数分子を並べた場合に「該当なし」にならないようにする。P9-1 M3）
        // 分子が2つ以上あるときは①②③の番号を振り、キャンバス上の見出しと対応づける
        // （P12-8。ユーザー要望「分子に識別記号を振り、右ペインの化合物名にも反映」）。
        // A/B/C は C＝炭素・B＝ホウ素と元素記号がぶつかり、α/β は糖のアノマー表記とぶつかるので使わない。
        // 番号の付け方は markedMolecules に集約してあるので、図とずれない
        const { parts, marks } = this.markedMolecules(null);
        const names = parts.map(m => this.lookupCompoundName(m));
        const name = parts.length === 1
            ? (names[0] || '（ライブラリに該当なし）')
            : parts.map((p, i) => {
                const mark = marks.get(p);
                return (mark ? mark + ' ' : '') + (names[i] || '（該当なし）');
            }).join(' ＋ ');
        return { name, formula };
    }

    // キャンバス左下の化合物名チップ（P11-M3c。第4段から PC でも出す）を組み直す。
    // 名称があれば「名称＋分子式」、なければ分子式のみ。学習モード・空分子では消す。
    // ⚠ 材料は `this.compoundLabel`（DOM ではない）＝ 右パネルが無くても同じものが出る
    syncMobileNameChip() {
        const chip = document.getElementById('mobile-name-chip');
        if (!chip) return;
        const { name, formula } = this.compoundLabel || { name: '', formula: '' };
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
                .forEach(b => {
                    const nb = new Bond(b.atomId1, b.atomId2, b.type);
                    // 原子と同じく追加のプロパティを引き継ぐ（`isStereoMarked` ＝ 段1の結合の印）。
                    // ⚠ 落とすと、採点は**成分ごと**に見る（`markedMolecules`）ので
                    //   「画面には印が出ているのに、採点表では付いていないことになる」
                    copyBondExtras(nb, b);
                    part.bonds.push(nb);
                });
            parts.push(part);
        }
        return parts;
    }

    /**
     * ★ 「ハース環として描かれていて、環の面から立体が読める図」なら、その立体コードを返す。
     *   読めない図・ハース環でない図は null（＝ 呼び出し側は従来どおりの道を通る）。
     *
     * ⚠ **範囲はハース環に限る。フィッシャー投影には広げない。**
     *   ユーザーの発注が「**ハース環を使用したときに限った話**」（2026-08-21）だから。
     *   広げると、乳酸をフィッシャーで描いただけでトグル OFF でも「D-乳酸」を名乗り出す
     *   （実測: 門番を外して変わるのはライブラリ中この1件・v933）。
     *
     * ⚠ **`atomParity` は `readRingParityFromHaworth` だけで組む**（フィッシャーを混ぜない）。
     *   混ぜないことで**取り違えは起きない** —— `canonicalStereoCode` は
     *   「記述子のあった中心だけ」をトークンにするので、こちらが足りなければ
     *   登録側のコードと**長さが合わずに外れる**（＝ 黙って別の糖に化けることはない）。
     *   外れたときは従来どおり総称／「どれか」へ落ちる。
     */
    haworthNameStereoCode(mol) {
        if (typeof haworthSugarCycles !== 'function') return null;
        let cycles;
        try { cycles = haworthSugarCycles(mol); } catch (e) { return null; }
        if (!cycles.length) return null;
        const ringParity = readRingParityFromHaworth(mol);
        // 環の中に1つも面が読めない図（環を置いただけ・置換基が斜め）は「読めた」と言わない
        const inRing = new Set([].concat(...cycles));
        if (!Object.keys(ringParity).some(id => inRing.has(id))) return null;
        return canonicalStereoCode(mol, {
            atomParity: ringParity,
            bondGeo: readBondGeoFromCoords(mol)
        });
    }

    // 1分子の名称をライブラリから引く。見つからなければ null
    // 正準コードでO(1)照合（P8-2）。ヒット候補には念のためverifyMoleculeで最終確認を行い、
    // 立体指定（stereo）付きエントリは描かれた分子の立体コードも一致した場合のみ採用（P12-7 M1）。
    // 立体指定の無いエントリはユーザーの描き幾何を見ない（従来どおり幾何不問）。
    //
    // `opt.noStereo` … **立体は一切要らない**と呼び出し側が言い切る口（既定 false）。
    //   トグルの値に関わらず、下のハース環の例外も含めて立体を1つも見ない。
    //   ⚠ **`readStereo = false` を代わりに使ってはいけない** ——
    //   OFF は「D/L・α/β を名前に出さない」だけで、ハース環は下の例外で言い切る。
    //   「立体を混ぜない名前が欲しい」（`learn.js` の `constitutionalName`）はこちらを使うこと。
    lookupCompoundName(mol, opt) {
        this.getCompoundLibrary(); // コードMapの構築を保証
        const candidates = this._compoundCodeMap.get(canonicalCode(mol)) || [];
        const noStereo = !!(opt && opt.noStereo);
        //
        // ===== 立体を名前に出すかどうかは、**二段**で決める =====
        //
        // ⚠ **この二段は 2026-08-22 に書き直した。**それまでは
        // 「**立体を出すかどうかはトグルだけで決める**」という**一本の線**だった
        // （2026-08-08・ユーザーによる仕様の確認。「フィッシャー投影による立体異性体の判定は
        //  常に行う。ユーザーの操作によって、立体異性体まで区別して表示するかどうかを切り替える」）。
        // ⚠ **その決定を覆したのではない。適用範囲を「図から立体が決まらないもの」に限った。**
        // **トグルは撤去していない**（下の (2) がその管轄で、そこは1つも変えていない）。
        //
        //  **(1) 図から立体が決まっているか** …… ⚠ **トグルの管轄外**。決まっているなら言い切る。
        //      ハース図で置換基を環炭素の上に描くか下に描くかは**面（α/β）そのもの**なので、
        //      面が読めた時点で**どの立体異性体かは決まっている**。
        //
        //      ★ 引き直した理由（ユーザーの指摘・2026-08-22。**これが根拠**）:
        //      > **ハース環使用時に複数の異性体を提示しながら、立体視で１つの異性体を
        //      >   描画しているのは矛盾ですよね**
        //      ＝ アプリは**同じ図から**、環ビュー（🧊 環を横から）では**1つの立体異性体の模型**を
        //      組んで見せながら、名前では「どれか分からない」と言っていた。実測:
        //
        //        | 分子 | ハース図から読めた面 | 環ビューで面が読めない置換基 | 直す前の OFF の名前 |
        //        | α-D-グルコピラノース | 5 | 0本 | ⚠ 「アロース／ガラクトース ほか3種 のどれか」 |
        //        | β-D-グルコピラノース | 5 | 0本 | ⚠ 同上 |
        //        | マルトース           | 10 | 0本 | ⚠ 「セロビオース／マルトース ほか1種 のどれか」 |
        //
        //      **上下が全部確定した模型を描けている ＝ どの立体異性体かが決まっている。**
        //      決まっているものを「どれか」と言うのは、知っていることを隠しているだけ。
        //      ユーザーの言葉（同日）: 「**ハース環を使う場合は、いつでも、立体構造を
        //      特定できるはずです**」——「いつでも」なので**トグルの値を見ない**。
        //
        //      ⚠ **範囲はハース環に限る。フィッシャー投影には広げない。**
        //      ユーザーが「**ハース環を使用したときに限った話**」と明示している。
        //      フィッシャーは「縦＝奥」の約束を知らずにただ縦横に描いただけの図が大量にあり、
        //      ＝ **図が立体を主張しているとは限らない**ので (1) には入らない。
        //      （実測 v933: 広げると乳酸が OFF でも「D-乳酸」を名乗り出す）
        //
        //  **(2) 図から決まっていないものを、どう扱うか** …… ★ **ここがトグルの本来の役目**。
        //      鎖状の糖（フィッシャー投影）や、置換基を斜めに描いて面が読めなかった図が該当する。
        //      OFF なら D/L・α/β を落として総称に丸め、割れるなら
        //      「〜ほか N 種 のどれか（立体で決まります）」と断る（この振る舞いは従来どおり）。
        //      ⚠ シス/トランス（結合の幾何）は OFF でも落とさない（2026-08-02。トグルの見出しどおり）。
        //
        // **かつてここには「図が縦置きのときだけ立体を出す」門番があった**
        // （DESIGN_stereo_orientation.md 案C）。**撤回した**——向きは
        // *読める図かどうか* の話であって、*ユーザーが立体まで見たいかどうか* とは別の軸。
        // 2つを掛け合わせると、トグルを ON にしたのに図の向きしだいで出たり出なかったりする。
        // ⚠ **今回の (1) は案Cの復活ではない**: 案Cは「向きが悪ければ **ON でも出さない**」＝
        // トグルを弱める向きだったが、(1) は「図が立体を主張しているなら **OFF でも出す**」＝
        // **描かれたものを読む**向き。掛け算ではなく、先に (1) を見て、残りを (2) に渡す。
        const useStereo = this.readStereo && !noStereo;
        // (1) の判定。`opt.noStereo`（立体は一切要らない）と ON のときは計算しない
        const haworthStereo = (useStereo || noStereo) ? null : this.haworthNameStereoCode(mol);
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
                    // ★ ハース環の例外: 図から面が読めているなら、OFF でもその立体で照合する
                    if (haworthStereo !== null) {
                        return haworthStereo === e.stereoCode && verifyMolecule(mol, e.mol);
                    }
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
            // 総称が割れる ＝ **立体を見ないと区別がつかない**分子。黙って名無しにすると
            // 「描いたのに名前が出ない」になるので、候補を並べてなぜ決まらないのかを見せる
            // （トグルを ON にする動機にもなる）。
            // ⚠ **ここへ来るのは「立体が図から読めない」分子だけになった**（2026-08-22）——
            //   ハース環として描いてあって面が読める図は、上の例外で言い切ってしまう。
            //   ここに残るのは**フィッシャー投影で描いた鎖状の糖**（D-グルコースなど）や、
            //   ハース環の置換基を斜めに描いて面が読めなかった図。
            //   ＝ **「立体で決まります」は本当に決まっていないときだけ出る。**
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

    // 座標近くにある原子のうち **半径内でいちばん近いもの**（DESIGN_hit_areas.md §1-F）。
    // `findAtomAt` は `.find` なので**配列順で最初に見つかった原子**を返す ＝ 原子IDの生成順に
    // 結果が左右される（CLAUDE.md「原子IDに順序を頼らない」と同根）。
    // 破壊的な操作（削除・元素置換）は取り違えが痛いので、こちらを使う。
    findNearestAtomAt(x, y, radius = ATOM_TAP_RADIUS) {
        let best = null;
        let bestD = radius;
        this.userMolecule.atoms.forEach(atom => {
            const d = Math.hypot(atom.x - x, atom.y - y);
            if (d <= bestD) { bestD = d; best = atom; }
        });
        return best;
    }

    /**
     * ★ 印モード（段1）で、タップ点が「原子を指した」のか「結合を指した」のかを決める
     *   （DESIGN_stereo_point.md §4-1「原子と結合を1つのモードで指す」）。
     *
     * ⚠ **半径で分けてはいけない。** 原子の当たり半径は 18px（`ATOM_TAP_RADIUS`）で、
     *   結合1本は 42px（`GRID_SIZE`）しかない ＝ 両端が 18px ずつ取ると
     *   **結合に残るのは真ん中の 6px だけ**になり、事実上結合を指せない。
     *   `reshapeBondUnderPoint` が「C=C の中点は原子半径に潜る」と書いているのと同じ事情。
     *
     * → **近いほうを採る**。原子の中心までの距離と、結合の中点までの距離を比べる。
     *   42px の結合なら「両端から 10.5px までが原子・真ん中の 21px が結合」に落ちる
     *   （t≤0.25 で 42t ≤ 21−42t）。長さが変わっても比で決まるので、
     *   短い結合でも両方が指せる。
     *
     * 戻り値 `{ atom, bond }` … どちらか一方だけが非 null（何も無ければ両方 null）。
     * ⚠ 炭素以外の原子は返さない（印を付けられるのは炭素だけ・§4-1）。
     *   ただし**そこで結合に振り替えない** —— O をタップした人に結合の印が付くと、
     *   何が起きたのか読めない
     */
    stereoPointUnderPoint(rawX, rawY) {
        const atom = this.findNearestAtomAt(rawX, rawY, ATOM_TAP_RADIUS * 2);
        const bond = this.findBondAt(rawX, rawY, 14);
        const dAtom = atom ? Math.hypot(atom.x - rawX, atom.y - rawY) : Infinity;
        let dBond = Infinity;
        if (bond) {
            const a1 = this.userMolecule.atoms.find(a => a.id === bond.atomId1);
            const a2 = this.userMolecule.atoms.find(a => a.id === bond.atomId2);
            if (a1 && a2) dBond = Math.hypot((a1.x + a2.x) / 2 - rawX, (a1.y + a2.y) / 2 - rawY);
        }
        if (atom && dAtom <= dBond) return { atom: atom.element === 'C' ? atom : null, bond: null };
        if (bond && dBond < Infinity) return { atom: null, bond };
        return { atom: null, bond: null };
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
               this.isHaworthModule(moduleType);
    }

    // ハース環（糖の環）テンプレートのモジュールか（六員環＝ピラノース／五員環＝フラノース）
    isHaworthModule(moduleType) {
        return moduleType === 'haworth-pyranose' || moduleType === 'haworth-furanose';
    }

    // ハース環モジュールの中心基準の相対座標（P12-7 M2c / P12-8 フラノース）。
    // どちらも「奥辺が上・前縁が下」の平たいハース図で、環内 O → 環炭素の巡回は同じ向き。
    // **compounds.json のライブラリ図とそのまま同じ形**にしてある（ピラノースは
    // α/β-D-グルコピラノース、フラノースは v710 で入った α/β-D-フルクトフラノース）。
    // ずれると「呼び出した図」と「手で描いた図」の見た目が食い違う。
    // 縦に十分な高さを取り、前縁を奥辺より内側へ寄せてある。これにより環炭素の真上/真下へ
    // 置換基を伸ばしても隣の環原子と重ならない（正五角形だと 13px まで詰まる。FR1 参照）。
    // 環外置換基は付けない（骨格のみ。ユーザーが上下に -OH / -CH2OH を付ける）。
    static get HAWORTH_RING_SHAPES() {
        return {
            // 絶対の O(455,252)…C5(345,252) を中心(400,300)から引いた値
            'haworth-pyranose': [
                { el: 'O', dx: 55, dy: -48 }, // 0: 環内 O（右奥）
                { el: 'C', dx: 100, dy: 0 },  // 1: C1（アノマー・右）
                { el: 'C', dx: 30, dy: 48 },  // 2: C2（右手前・内側へ）
                { el: 'C', dx: -30, dy: 48 }, // 3: C3（左手前・内側へ）
                { el: 'C', dx: -100, dy: 0 }, // 4: C4
                { el: 'C', dx: -55, dy: -48 } // 5: C5（左奥）
            ],
            // 五員環は環内 O を頂点（真上・奥）に置く。フルクトフラノースなら
            // 1=C2（アノマー）・2=C3・3=C4・4=C5 に対応する。
            // 絶対の O(400,257)…C5(330,302) を重心(400,312)から引いた値
            'haworth-furanose': [
                { el: 'O', dx: 0, dy: -55 },  // 0: 環内 O（奥の頂点）
                { el: 'C', dx: 70, dy: -10 }, // 1: アノマー炭素（右）
                { el: 'C', dx: 25, dy: 38 },  // 2: 右手前（内側へ）
                { el: 'C', dx: -25, dy: 38 }, // 3: 左手前（内側へ）
                { el: 'C', dx: -70, dy: -10 } // 4: 左（環内 O の隣）
            ]
        };
    }

    // ハース環モジュールの配置計画（P12-7 M2c / P12-8）。
    // 向き固定の平たいハース環を、環内 O 付きでスタンプする。
    // 巡回順（O→アノマー炭素→…）は compounds.json の糖と同一 handedness。
    // getRingPlacementPlan と違い正多角形ではなく固定座標なので専用に持つ（ゴースト・実配置で共用）。
    getHaworthPlacementPlan(moduleType, rawX, rawY) {
        const MIN_CLEARANCE = GRID_SIZE * 0.65;
        const REL = Game.HAWORTH_RING_SHAPES[moduleType];
        // カーソルを絶対グリッドに丸めた点を中心にする（自由配置の環と同じ流儀）
        const center = { x: snapToGrid(rawX), y: snapToGrid(rawY) };
        if (!REL) return { valid: false, reason: 'overlap', vertices: [], center };
        const vertices = REL.map(r => ({ el: r.el, x: center.x + r.dx, y: center.y + r.dy, existing: null }));

        // 既存の重原子と最小間隔を確保（重なり防止）。テンプレートは縮合・マージしない固定骨格。
        const heavy = this.userMolecule.atoms.filter(a => a.element !== 'H');
        const clash = vertices.some(v => heavy.some(a => Math.hypot(a.x - v.x, a.y - v.y) < MIN_CLEARANCE));
        if (clash) {
            return { valid: false, reason: 'overlap', vertices, center };
        }
        const edges = [];
        const n = vertices.length;
        for (let i = 0; i < n; i++) edges.push({ i, j: (i + 1) % n, type: 1, exists: false });
        return { valid: true, vertices, edges, center };
    }

    // ハース環モジュールで固定骨格をキャンバスに置く（P12-7 M2c / P12-8）。saveState で Undo 可。
    placeHaworthRing(moduleType, rawX, rawY) {
        const plan = this.getHaworthPlacementPlan(moduleType, rawX, rawY);
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
            center = { x: snapToGrid(rawX), y: snapToGrid(rawY) };
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
        // 孤立配置の禁止は**廃止**（DESIGN_hit_areas.md 決定1／要望D）。
        // 「既存の分子から 75px 以内」を強制していたため、2つめの環を置ける窓が
        // クリアランス(27.3px)と 75px のあいだ ＝ 実測 72〜112px の帯しかなかった。
        // ニコチンやインジゴのように「環と環を単結合でつなぐ」分子は、まずこの帯を
        // 当てるところから始まっていた。**空いている所にはどこでも置ける**が正しい。
        // 残す門番は 頂点マージ(12px)・MIN_CLEARANCE 衝突・価標検査 の3つ。
        // ⚠ 復活させると否定対照 HA4 が赤くなる（つまみは否定対照専用。本番は false）
        if (HIT_AREAS.legacyIsolation && heavy.length > 0 && !fusion &&
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

        if (this.isHaworthModule(moduleType)) {
            // ハース環は正多角形でなく固定骨格なので専用配置（環内 O つき。P12-7 M2c）
            this.placeHaworthRing(moduleType, x, y);
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

    // その分子の中で、結合線が別の重原子の上を通っていないか（作図が読めなくなる形の検出）。
    // 判定そのものは `atomUnderBondLine`（唯一の実装）に任せる ―― 手描きの配置
    // （placementFor の 9.）と**同じ物差し**であることを構造で担保するため
    _hasBondThroughAtom(ids) {
        const mol = this.userMolecule;
        const heavy = mol.atoms.filter(a => a.element !== 'H' && ids.has(a.id));
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        return mol.bonds.some(b => {
            const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
            if (!p || !q || !ids.has(p.id) || !ids.has(q.id)) return false;
            return heavy.some(a =>
                a.id !== p.id && a.id !== q.id && atomUnderBondLine(a, p, q));
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
        // ⚠ **飾りに入力を受けさせない**（v1373）。この 7px の帯は結合の真上に描かれるので、
        // ここが当たり判定を持つと**マウスで軸をなぞったときだけ**判定線より先に当たり、
        // そのままキャンバスへ抜けて整形が効いていた ＝ 判定線の穴（S6）を隠していた。
        // 実測では軸から 3.5px 外すと帯を外れて判定線に食われ、同じ中点でも整形されなかった。
        // 「効いたり効かなかったりする」の正体なので、偶然の盾を外して経路を1本にする
        line.setAttribute('pointer-events', 'none');
        this.uiGroup.appendChild(line);
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', (a.x + b.x) / 2);
        t.setAttribute('y', (a.y + b.y) / 2 - 8);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', 'var(--neon-cyan, #00f2fe)');
        t.setAttribute('pointer-events', 'none');
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
        // キャンバスの `renderBond` と同じ目印（`_iupacLiftBondInk` が使う）。
        // サムネイルは二重結合の線が **±2.5px** しか離れていないので、帯を敷いたときの
        // つぶれ方はキャンバスより激しい ＝ ここに付け忘れると答え合わせの表だけ直らない
        const ink = (line) => {
            if (!isHConnection) line.setAttribute('class', 'svg-bond-ink');
            targetGroup.appendChild(line);
        };

        if (type === 1) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', sx);
            line.setAttribute('y1', sy);
            line.setAttribute('x2', ex);
            line.setAttribute('y2', ey);
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-width', isHConnection ? '1.5' : '3');
            ink(line);
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

            ink(line1);
            ink(line2);
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
                ink(line);
            });
        }
    }

    // SVG描画の更新
    updateDrawing() {
        // ★ 常設バッジは**いちばん先**にそろえる（v1416）。この下には反応機構ビューアが
        //   持ち主のときの早い return があり、そこで折り返すと
        //   「モードは下りたのにバッジが残る」型の食い違いが生まれる
        this.syncCanvasModeBadge();
        // ★ キャンバスの持ち主が反応機構ビューアなら、自分の分子ではなく反応の絵を描き直す
        //   （v1374・DESIGN_reaction_mechanism.md §7）。
        //   ここが無いと、スクロール・パン・ズームで走った再描画が反応の絵を消して
        //   自分の分子で塗り替え、**自分の図に反応の原子だけが乗った混ざり絵**になる。
        //   持ち主かどうかの判断はビューア側が持つ（予測モード中は人が描くので持ち主ではない）
        if (window.reactionPlayer && window.reactionPlayer.ownsCanvas && window.reactionPlayer.ownsCanvas()) {
            // ⚠ 帯の「↩ 反応前に戻す」だけはここでも合わせる（v1409）。
            //   この return より下に `reactor.refresh()` があるので、ビューアが持ち主のあいだは
            //   **札が出しっぱなしになる** ―― 指す先（自分の分子）は退避されて画面に無いのに、
            //   押せば見えていない図が書き換わる。持ち主が誰でも札は正しい状態にする
            if (window.reactor && window.reactor.syncUndoButton) window.reactor.syncUndoButton();
            window.reactionPlayer.redrawOwned();
            return;
        }
        // 描く前に「ベンゼン印」の前提（環であること）を見直す（v1180・発注書 §2h-3）。
        // 環が壊れる経路は削除・消しゴム・右クリック・結合の削除と複数あるので、
        // 経路ごとに書かず**図を描き直すたびに1回**そろえる
        this.dropStaleBenzeneMarks();
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

        // 4.5. 分子が2つ以上あるときは、図の下に①②③と名前を出す（P12-8。ユーザー要望）。
        // 自動水素も「見出しが乗ってはいけない絵」なので、計算済みのものを渡す（二度計算しない）
        this.renderMoleculeLabels(hidden, hydrogens);
        // 4.6. 分析対象の分子を琥珀の枠で囲う（レビュー項目9）。ホバーで消える uiGroup ではなく
        // 作図と同じ層に描き、更新のたびに描き直す
        this.renderFocusFrame(hidden);
        // 4.65. アルキル基練習の「答案の枠」（DESIGN_isomer_practice.md §14-4）。
        // 付け根はロック済みで触ると案内が出るが、**触る前に分かるほうが良い**ので薄い枠で囲う
        this.renderAnswerSlotFrames(hidden);
        // 4.7. 反応させる分子の選択枠（レビュー項目15）。ここも uiGroup には描かない——
        // 以前は uiGroup にあったため、**カーソルを動かしただけで枠が消えていた**
        // （プレビュー描画が uiGroup を丸ごと消すため）。油脂のように同じ反応を
        // 何回も繰り返す間ずっと出ていてほしいので、作図と同じ層へ移した
        this.renderSelectionFrames(hidden);
        // 4.8. 命名の確認（主鎖の帯と炭素番号。DESIGN_iupac_check.md N2）。
        // ここも作図と同じ層に描く ＝ カーソルを動かしただけで消えては困る。
        // **状態は残さない**ので、図が変わっていればこの中で自分から消える
        this.renderIupacNumbering(hidden, hydrogens);
        // 5. 化合物名・分子式のライブ表示を更新（P7-6）
        this.updateCompoundInfo();
        // 6. 「この分子の反応」カードの分類表示を更新（P9-1 M1）
        this.updateReactionCard();
        // 7. 異性体練習の「描きながら名称表示」モードのライブ更新（P12-1 調整）
        if (window.isomerPractice && window.isomerPractice.active) window.isomerPractice.onDrawingChange();
        // 7.5. アルキル基練習も同じくライブ更新（W3。こちらもキャンバスが答案用紙）
        if (window.alkylPractice && window.alkylPractice.active) window.alkylPractice.onDrawingChange();
        // 7.6. 立体異性体の練習も同じ（SW1。帯の「いま N個 描いてあります」が生きるのはここ）
        if (window.stereoPractice && window.stereoPractice.active) window.stereoPractice.onDrawingChange();
        // 8. パズルの自動判定（2026-08-13）。**重原子の数が合ったときだけ**同型判定まで進む
        this.maybeAutoClear();
    }

    // 分子が2つ以上あるとき、各分子の下に「① 酢酸」のような見出しを描く（P12-8。ユーザー要望）。
    // 表示だけで作図データには触れないので、判定・反応・エクスポートには影響しない。
    // 1分子のときは出さない（キャンバス左下のチップで足りており、図を邪魔するだけ）
    // 見出しを付ける分子と、その番号を決める（図と名前チップで同じ番号を使うため1か所にまとめる）。
    // 重原子1個の分子は、作図中に置きかけた孤立原子（C を1つ置いた直後など）であることが
    // 多いので対象外。ただし**反応でできた副生成物（水など）は含める**
    // （P12-8。ユーザー指摘「反応で CH4 や H2O が生じた場合は表示すべき」）
    markedMolecules(hidden) {
        const visible = (part) => part.atoms
            .filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id)));
        const parts = this.splitMolecules();
        // ⚠ **書き出し練習中はキャンバスが答案用紙**（DESIGN_isomer_practice.md §12）。
        // 番号は「2つ以上あることを示す印」ではなく**答案の欄外番号**になるので、
        // 1つでも・置きかけの1原子でも振る。ここを普段の規則のままにすると、
        // 採点表（`IsomerPractice.grade()`）が数える成分と図の番号がずれる
        const sheet = this.worksheetActive();
        const marked = parts.filter(p => {
            const atoms = visible(p);
            if (sheet) return atoms.length >= 1;
            return atoms.length >= 2 || atoms.some(a => a.fromReaction);
        });
        // 見出しは「分子が2つ以上あることを示す」ためのものなので、1つなら付けない
        if (marked.length < (sheet ? 1 : 2)) return { parts, marks: new Map() };
        const marks = new Map();
        marked.forEach((p, i) => marks.set(p, moleculeMark(i)));
        return { parts, marks };
    }

    /**
     * 書き出し練習でキャンバスが答案用紙になっている最中か（DESIGN_isomer_practice.md §12-3）。
     *
     * **名前を伏せる門番・分子モーダルの封鎖・成分ごとの番号付けが、この1つの旗だけを見る。**
     * 旗を3か所で別々に判定すると「名前を伏せる規則」が3つになり、
     * どれか1つを直し忘れた瞬間に答えが漏れる（§12-3 の実測がまさにそれだった）。
     *
     * ★ W3（§14）で**アルキル基の練習も同じ旗を立てる**。付け根 N 組を置いた答案用紙は
     * 異性体側と同じく「成分ごとに番号を振り、名前を伏せる」面なので、
     * ここに足すのが**唯一の直し方**（別の旗を立てると規則が2つになる）。
     *
     * ★ さらに**立体異性体の練習も同じ旗**（DESIGN_practice_revision.md §5-5・実測 M9）。
     * 旗を1つにする約束を作った当の穴が、立体のレーンだけ開いたままだった ——
     * 練習中に2成分目を描くと **`🔍 ① D-乳酸` `🔍 ② エタノール`** が SVG に出て、
     * `canvasEntryEnabled()` も **true** のまま ＝ 分子モーダル → 🧊立体で見る → R/S と、
     * **この練習の答えそのもの**まで一続きに届いていた（`SW4` がこの1行を見張る）。
     */
    worksheetActive() {
        const ip = window.isomerPractice;
        if (ip && ip.active && ip.problem) return true;
        const ak = window.alkylPractice;
        if (ak && ak.active && ak.problem) return true;
        const sp = window.stereoPractice;
        return !!(sp && sp.active && sp.problem);
    }

    /**
     * 図の下の見出しに出す**文字を作る唯一の入口**（DESIGN_isomer_practice.md §12-3）。
     *
     * ★ ここが**名前を伏せる門番**。書き出し練習中は番号だけを返す。
     * 実測（§12-3）では、学習モードでキャンバスに2分子を置くと
     * `🔍 ① ブタン` `🔍 ② 2-メチルプロパン` と**答えが出ていた** ——
     * `isSoleLabeledPart()` の `currentMode === 'learn'` は**1分子のときの見出し**にしか
     * 効いておらず、`markedMolecules()` が番号を振る2分子以上の経路には門番が無かった。
     * 練習が「1分子ずつ」を強制していたので表に出ていなかっただけで、
     * 答案用紙にした瞬間に開く穴だった。`IW4` がこの門番を見張っている。
     */
    captionForPart(part, mark) {
        if (this.worksheetActive()) return mark || moleculeMark(0);
        const name = this.lookupCompoundName(part) || this.computeMolecularFormula(part);
        return `🔍 ${mark ? mark + ' ' : ''}${name}`.trim();
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
     *
     * **重なりの回避は「1マス単位の縦の段送り」だけで行う**（DESIGN_molecule_modal.md §12）。
     * 既定の置き場所（分子の下端＋1.1マス）が埋まっていたら、そこから ±GRID_SIZE の整数倍だけ
     * 動かした候補を順に試す。整数マスに限るのは、**格子点との位置関係が平行移動でそのまま保たれる**
     * ため ＝ 既定で満たしている「格子点を覆わない」が、どの段へ送っても自動的に満たされる。
     *
     * **見出しは「図に紐づいた画面上の道具」**（v850・§13。ユーザー報告）。大きさは
     * `labelScale()` が画面px で固定し、段が決まったあと `stickLabelsIntoView()` が
     * **画面から出たものだけ**可視域へ引き戻す。ここまでの置き場所はモデル座標のまま
     * ＝ §12 の段送りも「格子点を覆わない」も、そのまま生きている。
     */
    renderMoleculeLabels(hidden, hydrogens) {
        const NS = 'http://www.w3.org/2000/svg';
        const { parts, marks } = this.markedMolecules(hidden);
        const listed = parts.filter(p => marks.has(p) || this.isSoleLabeledPart(p, parts, hidden));
        this._labelRects = [];
        if (!listed.length) return;
        const tappable = this.canvasEntryEnabled();
        const s = this.labelScale();
        const h = LABEL_CHIP_HEIGHT * s; // 押せるものの下限（32px。TAP1 と同じ物差し）
        const padX = 9 * s;

        // 1周目: 文字を先に敷いて幅を測る（`getBBox()` は DOM に入れてからでないと効かない）。
        // 縦の位置はまだ仮。重なりを見てから決めるので、ここでは幅と既定の上端だけ確定させる
        const items = listed.map(part => {
            const mark = marks.get(part);
            const atoms = part.atoms.filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id)));
            const xs = atoms.map(a => a.x), ys = atoms.map(a => a.y);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
            // 枠の上端は分子の下端＋1.1マス（1マス下の格子点のすぐ下）に固定し、
            // 縮小表示のぶんは**下へ**伸ばす（上へ伸ばすと格子点を覆う）
            const home = Math.max(...ys) + GRID_SIZE * 1.1;
            // ⚠ 文字を**ここで組み立てない**。門番（`captionForPart`）を通す
            const text = this.captionForPart(part, mark);
            const g = document.createElementNS(NS, 'g');
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', cx);
            t.setAttribute('y', home + h / 2 + 5.4 * s); // 5.4 ＝ 15px の文字のベースライン補正
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
            const bb = t.getBBox();
            return {
                part, atoms, g, t, home, top: home, cx, homeX: bb.x - padX,
                x: bb.x - padX, w: bb.width + padX * 2,
                minY: Math.min(...ys), maxY: Math.max(...ys),
                ids: new Set(part.atoms.map(a => a.id))
            };
        });

        // 2周目: 他の分子の絵と、先に置いた見出しを避けて段を決める
        this.placeMoleculeLabels(items, h, hidden, hydrogens);

        // 3周目: 決まった段へ文字と枠を置き、当たり判定を付ける
        items.forEach(it => {
            it.t.setAttribute('y', it.top + h / 2 + 5.4 * s);
            // 引き戻し（`stickLabelsIntoView`）で横へ寄せたぶんは文字にも掛ける。
            // ⚠ 枠だけ動かすと文字が置き去りになる（当たり判定は枠、読むのは文字）
            if (it.x !== it.homeX) it.t.setAttribute('x', it.cx + (it.x - it.homeX));
            const r = document.createElementNS(NS, 'rect');
            r.setAttribute('x', it.x);
            r.setAttribute('y', it.top);
            r.setAttribute('width', it.w);
            r.setAttribute('height', h);
            r.setAttribute('rx', String(h / 2));
            r.setAttribute('fill', tappable ? 'rgba(0,242,254,0.10)' : 'none');
            r.setAttribute('stroke', tappable ? 'rgba(0,242,254,0.5)' : 'none');
            r.setAttribute('stroke-width', String(1.5 * s));
            r.setAttribute('pointer-events', tappable ? 'fill' : 'none');
            it.g.insertBefore(r, it.t);
            // 琥珀の枠・選択枠がこの見出しを囲めるように、実際に置いた矩形を残す
            // （段送りが入ったので `labelExtent()` の「下へ何px」だけでは足りない）
            this._labelRects.push({ ids: it.ids, x: it.x, y: it.top, w: it.w, h });
            if (!tappable) return;
            it.g.style.cursor = 'pointer';
            const rep = it.atoms[0];
            const open = (e) => {
                // キャンバス側のハンドラ（原子の配置・削除）へ流さない
                e.stopPropagation();
                e.preventDefault();
                this.openMoleculeModal(rep && rep.id);
            };
            // pointerdown で開く（キャンバスの作図と同じ入力系。台本・監査は svg へ直に
            // イベントを撃つので、この見出しは踏まない ＝ 収録とファズの動きは変わらない）
            it.g.addEventListener('pointerdown', open);
        });
    }

    /**
     * 見出しどうし・見出しと他の分子の図が重ならない段を選ぶ（`renderMoleculeLabels` の2周目）。
     *
     * **動かし方は縦の段送りだけ**にして、横へは逃がさない。見出しは「真下にある分子の名前」
     * という手がかりで読むものなので、横へずらすとどの分子の名前か分からなくなる。
     * 送り幅は **1マス（GRID_SIZE）の整数倍**に限る ＝ 格子との位置関係が平行移動で保たれるので、
     * 既定の置き場所で満たしている「格子点を覆わない」がどの段でもそのまま成り立つ。
     *
     * 候補の順は「既定 → 1段下 → 分子の上 → さらに下 → さらに上」。どれを採るかは
     * **他の分子を跨いだか**（`labelPlacementCost`）で決まる:
     * - **横に並んだ分子**は既定どうしが食い合う。下は誰も塞いでいないので**1段下**で解ける
     *   ＝ 見出しは分子の真下のまま、段違いに並ぶ
     * - **上下に並んだ分子**は、下へ送ると下の分子を追い越してしまう（「①の名前が②より下」
     *   という読めない並びになる）。そこで**分子の上**へ回す
     *   ＝ ユーザー指摘の「見出しが下の分子の絵に乗る」はここで解消される
     *
     * ★ **書き出し練習中だけ、段送りの距離そのものに値段が付く**（`labelDriftPenalty`・v1440）。
     */
    placeMoleculeLabels(items, h, hidden, hydrogens) {
        const ink = this.labelInk(items, hidden, hydrogens);
        // 上の分子・左の分子から順に場所を確保する（描画順は分子の並びに依らず一定にしたい。
        // 順が揺れると、原子を1つ足しただけで見出しの段が入れ替わって見える）
        const order = items.slice().sort((a, b) => (a.maxY - b.maxY) || (a.x - b.x));
        // 否定対照の口（既定は true）。テストがこれを false にすると**段送りをしない**素の状態に戻り、
        // 「重なりを数える関数が、避けていないときはちゃんと赤くなる」ことを同じ経路で確かめられる。
        // 空振りの緑（数え方が壊れていて 0 件と言う）を防ぐための仕掛け。
        // ⚠ **引き戻し（§13-2）はこの口では止まらない**。別の症状に効く別の仕掛けなので、
        //   否定対照も別の口（`labelStickToView`）に分けてある
        if (this.labelCollisionAvoid !== false) {
            const placed = [];
            // 1段の送り幅は「枠の高さを1マスに切り上げた段数」。縮小表示では枠が1マスより高く
            // （s=3.4 で 115単位 ＝ 約3マス）なるので、1マスずつ送っても隣の枠から抜け出せない
            const need = Math.max(1, Math.ceil(h / GRID_SIZE));
            order.forEach(it => {
                // 分子の上へ回すときの段数。枠の下端が分子の上端から 1.1マス上に来る位置
                // （＝既定の裏返し）まで、1マス単位で戻す
                const up = -Math.ceil(((it.maxY - it.minY) + GRID_SIZE * 2.2 + h) / GRID_SIZE);
                // 「既定 → 1段下 → 分子の上 → 2段下 → さらに上 → …」の順に交互に広げる
                // 12段まで見る。分子が10個ばらまかれると（夜間監査のファズ）、見出しは分子より
                // 横に長いので**縦の帯を分子の数だけ**用意しないと収まらない。6段では足りなかった
                const steps = [0];
                for (let k = 1; k <= 12; k++) { steps.push(k * need); steps.push(up - (k - 1) * need); }
                // ★ 練習中だけ「図から離れる」に上限と値段を付ける（v1440・`labelDriftPenalty`）。
                //   ⚠ 測るのは**段の数ではなく図との隙間**（`labelDriftRows`）——
                //   「分子の上へ回す」候補は段数こそ大きいが図には隣接しているので、
                //   段の数で測ると**いちばん近い候補を真っ先に捨てる**
                const limit = this.labelDriftLimit();
                const drift = this.labelDriftPenalty();
                let best = 0, bestCost = Infinity;
                for (const n of steps) {
                    const rect = { x: it.x, y: it.home + n * GRID_SIZE, w: it.w, h };
                    const away = this.labelDriftRows(rect, it);
                    if (away > limit) continue;         // n=0（既定）は必ず away=0 なので候補は尽きない
                    const cost = this.labelPlacementCost(rect, it, ink, placed) + drift * away;
                    if (cost === 0) { best = n; bestCost = 0; break; }
                    if (cost < bestCost) { bestCost = cost; best = n; }
                }
                it.top = it.home + best * GRID_SIZE;
                placed.push({ x: it.x, y: it.top, w: it.w, h });
            });
        }
        this.stickLabelsIntoView(items, h, ink, order);
    }

    /**
     * 画面から出た見出しを**見えている範囲へ引き戻す**（DESIGN_molecule_modal.md §13-2。ユーザー報告）。
     *
     * 症状: 拡大すると見出しだけが画面の下へ滑り出て消える。分子は中央に見えているのに名前が無い。
     * 原因: 置き場所（分子の下端＋1.1マス）は**モデル座標**なので、拡大すると画面上の隔たりも
     * 一緒に広がる。実測（1280×800・エタノール）で viewBox 185 のとき下辺から 55px、
     * 151 のとき 150px はみ出していた。
     *
     * **見出しは「図に紐づいた画面上の道具」**なので、いちばん外側の約束は
     * 「**押せる的が画面の中に居続けること**」。既定の置き場所はモデル座標のままにして
     * （§12 の段送り・格子点の約束はそこで守られている）、**画面から出るときだけ**引き戻す。
     *
     * 引き戻し方:
     * - **縦** … 可視域の中の帯 `[上端＋余白, 下端−余白−高さ]` へ丸める。丸めた位置から
     *   チップの高さぶんずつ内側へ歩いた候補も見て、`labelPlacementCost` ＋ **格子行を跨ぐ罰**が
     *   いちばん小さい段を採る（既定の位置に近いほど有利にする同点崩し付き）
     * - **横** … はみ出したぶんだけ戻す。中央そろえは崩れるが、**画面の外は押せない**ので
     *   「真下にあるのが自分の名前」より優先する。入りきらない幅なら可視域の中央へ
     *
     * ⚠ 罰にはしない（§12-5 で「可視域を罰にすると全候補が同点になり段送りが効かなくなる」ことを
     * 実測済み）。ここは**罰ではなく、決まった段に後から掛ける平行移動**なので、段送りの結果を消さない。
     */
    stickLabelsIntoView(items, h, ink, order) {
        // 否定対照の口（既定は true）。false にすると引き戻しをやめ、拡大時に画面外へ出る素の状態に戻る
        if (this.labelStickToView === false) return;
        const view = this.visibleModelRect();
        if (!view || !(view.w > 0 && view.h > 0)) return;
        const unit = this.labelScale();      // 画面1px あたりのモデル単位
        const m = 5 * unit;                  // 縁の余白（画面 5px ぶん）
        const rectOf = (it, y, x) => ({ x: x === undefined ? it.x : x, y, w: it.w, h });
        const fits = (it) =>
            it.top >= view.y + m && it.top + h <= view.y + view.h - m &&
            it.x >= view.x + m && it.x + it.w <= view.x + view.w - m;
        // ⚠ **分子そのものが画面から出ているなら引き戻さない。**
        // 名前だけ縁に残っても「どの分子の名前か」が分からず、ただの邪魔になる
        // （実測: 引き戻すと、パンで2分子とも画面外へ送ったとき縁で見出しどうしが重なった）。
        // 分子と一緒に画面外へ去るのが正しい ＝ 直したいのは「分子は見えているのに名前だけ消える」だけ
        const visible = (it) => {
            const xs = it.atoms.map(a => a.x), r = 12;
            const x1 = Math.min(...xs) - r, x2 = Math.max(...xs) + r;
            return x1 < view.x + view.w && view.x < x2 &&
                it.minY - r < view.y + view.h && view.y < it.maxY + r;
        };

        // 画面に収まっている見出しは1pxも動かさない。先に場所を確保しておき、
        // 引き戻す側がそれを避ける（動かないものを動くものより優先する）
        const stay = order.filter(it => fits(it) || !visible(it));
        const move = order.filter(it => !fits(it) && visible(it));
        if (!move.length) return;
        const placed = stay.map(it => rectOf(it, it.top));

        const lo = view.y + m, hi = view.y + view.h - m - h;
        move.forEach(it => {
            const homeRect = rectOf(it, it.top);   // 引き戻す前（＝段送りが決めた段）
            const homeCost = this.labelPlacementCost(homeRect, it, ink, placed);
            // 横: はみ出したぶんだけ戻す（入りきらないなら可視域の中央）
            const nx = (it.w + 2 * m <= view.w)
                ? Math.min(Math.max(it.x, view.x + m), view.x + view.w - m - it.w)
                : view.x + (view.w - it.w) / 2;
            // 縦: 可視域の帯の中で、いちばん安い段を選ぶ
            let ny, bestCost;
            if (hi <= lo) {                       // 帯が取れないほど狭い（起きない想定の保険）
                ny = view.y + (view.h - h) / 2;
                bestCost = this.labelPlacementCost(rectOf(it, ny, nx), it, ink, placed);
            } else {
                const clamp = (y) => Math.min(Math.max(y, lo), hi);
                const step = Math.max(h * 1.1, GRID_SIZE * 0.3); // 格子行の隙間を探せる細かさ
                const cands = [];
                for (let n = 0; n <= 10; n++) {
                    cands.push(clamp(it.top + n * step));
                    if (n) cands.push(clamp(it.top - n * step));
                }
                ny = clamp(it.top); bestCost = Infinity;
                let bestHard = Infinity;
                // ★ 練習中は「図から離れてよい上限」を引き戻しにも掛ける（v1440）。
                //   ここを素通しにすると、段送りで抑えた番号が**引き戻しのほうで**figure から離れる
                const limit = this.labelDriftLimit();
                for (const y of cands) {
                    const rect = rectOf(it, y, nx);
                    if (this.labelDriftRows(rect, it) > limit) continue;
                    const hard = this.labelPlacementCost(rect, it, ink, placed);
                    // 格子行を跨ぐのは「そこへ原子を置けなくなる」ので嫌う（§13-3）。
                    // 重なり（10000）より軽く、跨ぎ（300）より重い
                    const cost = hard + 400 * this.labelGridRowsCrossed(rect, it)
                        + 0.5 * Math.abs(y - it.top) / view.h; // 既定に近いほど有利（同点崩し）
                    if (cost < bestCost) { bestCost = cost; bestHard = hard; ny = y; }
                    if (cost === 0) break;
                }
                bestCost = bestHard;
            }
            // ⚠ **引き戻しは「重なりを増やさない範囲でだけ」行う。**
            // 画面へ戻すために他の見出しや他の分子の絵に乗ってしまうなら、そこは戻さない
            // ——重なりはユーザーから指摘された症状（§12）で、視野と違って**利用者が動かせない**。
            // 画面外の名前は引けば見えるが、重なった名前はどうやっても読めない。
            // 実測（夜間監査ファズ・シード固定・200反復）: この歯止めが無いと 3件の重なりが出た
            //（見出しどうし2件・他の分子の図に1件）。歯止めを入れると 0件に戻る
            if (bestCost > homeCost) { placed.push(homeRect); return; }
            it.x = nx;
            it.top = ny;
            placed.push(rectOf(it, it.top));
        });
    }

    /**
     * その見出しが、自分の分子から数えた格子行（分子の下端＋1マスの整数倍）を何本跨いでいるか。
     * **数え方は回帰テスト ML3 と同じ**にそろえる（アプリとテストで物差しが違うと、
     * 「アプリは避けたつもり・テストは別の物差し」ですれ違う）。
     */
    labelGridRowsCrossed(rect, item) {
        const base = item.maxY;
        let n = 0;
        const k0 = Math.floor((rect.y - base) / GRID_SIZE) - 1;
        const k1 = Math.ceil((rect.y + rect.h - base) / GRID_SIZE) + 1;
        for (let i = k0; i <= k1; i++) {
            const gy = base + i * GRID_SIZE;
            if (gy > rect.y && gy < rect.y + rect.h) n++;
        }
        return n;
    }

    /**
     * 見出しが乗ってはいけない「絵」を集める（自分の分子は除く。自分の真下に出るのが既定なので）。
     * 原子は丸、結合は線分として持つ。**自動水素も入れる** ——見えている絵はすべて避ける対象。
     * 分子ごとの外接矩形も持ち、環の穴のような「インクは無いが分子の内側」へ潜り込むのを弱く嫌う。
     */
    labelInk(items, hidden, hydrogens) {
        const R = 13;            // 原子の丸（半径10）＋文字のはみ出しぶん
        const BOND_HALF = 5;     // 結合線の太さの半分＋少し
        const mol = this.userMolecule;
        const vis = (a) => a && !(hidden && hidden.has(a.id));
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        const discs = mol.atoms.filter(vis).map(a => ({ x: a.x, y: a.y, r: R, id: a.id }));
        (hydrogens || []).forEach(hAtom => {
            discs.push({ x: hAtom.x, y: hAtom.y, r: 9, id: hAtom.parentId });
        });
        const segs = [];
        mol.bonds.forEach(b => {
            const a1 = byId.get(b.atomId1), a2 = byId.get(b.atomId2);
            if (!vis(a1) || !vis(a2)) return;
            segs.push({ x1: a1.x, y1: a1.y, x2: a2.x, y2: a2.y, half: BOND_HALF, id: a1.id });
        });
        (hydrogens || []).forEach(hAtom => {
            const p = byId.get(hAtom.parentId);
            if (!vis(p)) return;
            segs.push({ x1: p.x, y1: p.y, x2: hAtom.x, y2: hAtom.y, half: 3, id: p.id });
        });
        // 分子ごとの外接矩形（items に無い分子＝見出しの付かない置きかけの原子も含める）
        const boxes = this.splitMolecules().map(p => {
            const at = p.atoms.filter(vis);
            if (!at.length) return null;
            const y1 = Math.min(...at.map(a => a.y)), y2 = Math.max(...at.map(a => a.y));
            return {
                ids: new Set(p.atoms.map(a => a.id)),
                x: Math.min(...at.map(a => a.x)) - 12, y: y1 - 12,
                w: Math.max(...at.map(a => a.x)) - Math.min(...at.map(a => a.x)) + 24,
                h: y2 - y1 + 24,
                topY: y1, bottomY: y2 // 「別の分子を跨いだか」を見るための素の上下端
            };
        }).filter(Boolean);
        // ⚠ ここで viewBox を渡していたが**誰も見ていなかった**（罰にはできない。§12-5）。
        // 見えている範囲は `visibleModelRect()` が `getScreenCTM()` から作り、
        // 罰ではなく**後から掛ける平行移動**（`stickLabelsIntoView`）として使う
        return { discs, segs, boxes };
    }

    /**
     * ある段に置いたときの「悪さ」。0 なら文句なし。**まずい順**に重みを付ける:
     *
     * | 重み | 何 | なぜこの順か |
     * |---|---|---|
     * | 1000000 | キャンバスの外（y<0） | 見出しごと消える。押せなくなるので論外 |
     * | 10000 | 他の分子の絵・他の見出しと重なる | **これがユーザー指摘の症状**。字が読めなくなる |
     * | 300 | 別の分子を跨ぐ | 読めはするが、どの分子の名前か分かりにくい |
     * | 10 | 環の穴などインクの無い分子の内側 | 見た目が悪いだけ。逃げ場が無ければ許す |
     *
     * ⚠ **桁を離してあるのが肝**。跨ぎ（300）は重なり（10000）より必ず軽い。
     * 近い値にすると「4つ跨ぐ（1200）くらいなら1つ重なる（1000）方が安い」と数えて、
     * 直したいはずの重なりを選ぶ（実測: 分子を10個ばらまくファズで 6% の反復が重なった）。
     */
    labelPlacementCost(rect, item, ink, placed) {
        let cost = 0;
        // キャンバスの外（y<0）へは出さない。重なりより重く見る
        // （**見えている範囲（viewBox）は条件にしない**。既定の位置ですら下辺からはみ出す
        // ことがあり、それを罰にすると全候補が同点になって段送りが効かなくなる。実測で
        // 320px・3分子のとき重なりが 0→1 に戻った。視野は利用者が動かせるが、重なりは動かせない）
        if (rect.y < 0) cost += 1000000;
        ink.discs.forEach(d => {
            if (item.ids.has(d.id)) return;                 // 自分の分子の絵は数えない
            if (circleHitsRect(d, rect)) cost += 10000;
        });
        ink.segs.forEach(sg => {
            if (item.ids.has(sg.id)) return;
            if (segmentHitsRect(sg, rect)) cost += 10000;
        });
        placed.forEach(p => { if (rectsOverlap(p, rect)) cost += 10000; });
        ink.boxes.forEach(b => {
            if (item.ids.size && b.ids.has(item.atoms[0].id)) return; // 自分の分子
            // **別の分子を跨いだ**か（＝自分の下にある分子より下、または上にある分子より上へ
            // 出てしまった）。インクは踏んでいなくても、名前がどの分子のものか読めなくなるので重い。
            // ⚠ 横に並んだ分子（自分と同じ高さ）は「跨ぐ」対象ではない。ここを区別しないと、
            //   横並びのときに既定の位置まで罰せられて、素直な段送りができなくなる
            const overX = rect.x < b.x + b.w && b.x < rect.x + rect.w;
            if (overX && b.topY > item.maxY && rect.y > b.topY) cost += 300;
            if (overX && b.bottomY < item.minY && rect.y + rect.h < b.bottomY) cost += 300;
            if (rectsOverlap(b, rect)) cost += 10;
        });
        return cost;
    }

    /**
     * ★ 段送りの「1マス動くごとの値段」（v1440・ユーザー実機報告 2026-08-21
     * 「異性体の書き出し、図が上下に隣接すると丸数字がまとめてしたに行く」）。
     *
     * **v1432 が消しそこねた経路**: あのときの直しは2つとも**隙間を作る側**だった ——
     * ② `labelScale()` を練習中 1 にしてチップが太らないようにし、
     * ①' `tidyAnswerSlots()` の縦の隙間を 126px にして「1マス＋チップ＋下の行の自動水素」を
     * 収めた。どちらも **`🧹 並べ直す` が作る配置**の話で、
     * ⚠ **人が自分で描いた配置には1つも効かない**。
     * 格子は 42px なので「2マスあけて次の答案を描く」＝ **縦の隙間 84px** はごく自然に起きるが、
     * 必要なのは 46.2（見出しを置かない帯）＋ 34（チップ）＋ 25（下の行の自動水素）＝ **105.2px**。
     * 実測（1280×800・v1439・4炭素の直鎖を縦に 84px 間隔で6個）: **6/6 が動き、最大 10マス（420px）**。
     * 126px 間隔なら 0/6。⚠ **IW17 はこの条件を見ていなかった** ——
     * (3) の「並べ直しなし」も `ipTidySheet(…, 3)` ＝ **3マスの隙間で整然と描いた答案**で、
     * 2マスの配置は「v1431 までの並べ直しの再現」＝ **ずれて当然の否定対照**として置いてあった。
     *
     * **直すのは段送りの値段のほう**（発注書 ORDER_isomer_2026-08-20.md §A-3 の案③にあたるが、
     * ⚠ **全モードには広げない**）。`labelPlacementCost` は距離をまったく数えないので、
     * 近くが埋まっていると**遠くの空き行のほうが安い** ＝ 行き場を失った番号が下へ下へと
     * 送られて最下段に固まる。ここに 1マスあたりの値段を足すと、
     * **「1つ重なるのを避けるために動いてよいのは2マスまで」**（10000 ÷ 4000）になる。
     *
     * **練習中に限る理由**（＝ 案③の害を避ける形）:
     * - 練習中の見出しは**押せない番号**（`canvasEntryEnabled()` が false。§12-3）で、
     *   仕事は「この図は何番か」だけ。**遠くへ行った時点で仕事をしていない**ので、
     *   自動水素にわずかに乗るほうがましだと言い切れる
     * - 練習の外の見出しは**名前つきの押せる的**。読めない・押しにくいほうが害が大きいので、
     *   重なりを避けるためならいくらでも動いてよい（ML 帯・夜間監査ファズの実測値を1つも動かさない）
     *
     * ⚠ **横並びの段送りは殺していない**。左右に並んだ分子の見出しどうしの食い合いは
     * **1マス下**（4000 < 10000）で解けるので、「段違いに並ぶ」既定の振る舞いはそのまま残る。
     */
    labelDriftPenalty() {
        if (this.labelDriftGuard === false) return 0;
        return this.worksheetActive() ? LABEL_DRIFT_PENALTY : 0;
    }

    /**
     * 見出しが自分の図から離れてよい上限（マス）。練習の外は `Infinity` ＝ **1px も振る舞いを変えない**。
     * ⚠ **上限のほうが値段より本体**。`labelPlacementCost` の重なりは
     * **重なった図形の数だけ 10000 が積み上がる**（自動水素も1つずつ数える）ので、
     * 実測では 1か所で 5万〜6万になり、**どんな1マスあたりの値段でも遠くの空き行のほうが安くなる**。
     *
     * ⚠ **否定対照の口（`labelDriftGuard = false`）を開けてある**（`labelCollisionAvoid` と同じ流儀）。
     * v1440 の上限は v1431 の症状（チップが画面px 固定で太る）にも**ついでに効いてしまう**ので、
     * これを閉じないと **IW17 の否定対照A・B が空振りの緑になる**（実測: 12件中 4件 → 1件に落ちた）。
     * 口を開けると v1431 の素の状態に戻り、②（`labelScale`）が何を直したのかを名指しできる。
     */
    labelDriftLimit() {
        if (this.labelDriftGuard === false) return Infinity;
        return this.worksheetActive() ? LABEL_DRIFT_MAX_ROWS : Infinity;
    }

    /**
     * その置き場所が、**自分の分子の絵から何マス離れているか**（既定の隔たり ＝ 1.1マスを 0 とする）。
     *
     * ⚠ **段の数（`n`）で測ってはいけない。** 候補には「分子の上へ回す」があり、
     * これは段の数こそ大きい（実測 −4段）が**図には隣接している**（枠の下端が分子の上端の 1.1マス上）。
     * 段の数で足切りすると、**いちばん近い候補を真っ先に捨てて**下へ流す方向へ押し戻してしまう。
     *
     * 図に重なっている置き方（またぐ形）は 0 を返す ＝ 「離れていない」。
     * 離れているかどうかだけを見る道具で、重なりの良し悪しは `labelPlacementCost` の担当。
     */
    labelDriftRows(rect, item) {
        const below = rect.y - item.maxY;              // 図の下端から枠の上端まで
        const above = item.minY - (rect.y + rect.h);   // 枠の下端から図の上端まで
        return Math.max(0, (Math.max(below, above) - GRID_SIZE * 1.1) / GRID_SIZE);
    }

    /**
     * 実際に置いた見出しの矩形（琥珀の枠・選択枠がこれを囲む）。段送りが入ると
     * 「下へ `labelExtent()` px」では足りない（上へ回ることもある）ので、描いた実物を引く。
     */
    labelRectFor(ids) {
        return (this._labelRects || []).find(r => {
            for (const id of ids) if (r.ids.has(id)) return true;
            return false;
        }) || null;
    }

    /**
     * 見出しのチップを**画面上でいつも同じ大きさ**に保つための倍率
     *（SVG単位 / 画面px。DESIGN_molecule_modal.md §13-1）。
     *
     * **見出しは図の一部ではなく、図に紐づいた「画面上の道具」**。指で押す的なので、
     * 拡縮のどちらへ動かしても画面上の高さは `LABEL_CHIP_HEIGHT` px から動かない
     * ＝ `1/k` をそのまま返す。倍率を掛けた結果が単位系で何になるかは見ない。
     *
     * ⚠ **上限も下限も置かない。** かつては `min(4, max(1, 1/k))` だった:
     * - **下限1**（拡大表示では1倍のまま図と一緒に育てる）… 引き伸ばされたチップが分子の下端＋1.1マス
     *   から画面外へ滑り出す原因の半分だった（実測: viewBox 151 で高さ 215px・幅 736px）
     * - **上限4** … 縮小表示で `1/k > 4` になると画面上の的が縮み続け、**28.3px / 26.9px** まで
     *   落ちて 32px の床を割っていた（実測・1280×800・viewBox 4587 / 4816）。
     *   もともと上限2だったのを §12-4 で4に上げた経緯があるが、**数字を上げるのは先送り**でしかない。
     *   上限が守っていたのは「引いた絵で見出しが図を覆わない」だが、**画面上では常に 34px の帯**
     *   なので、上限は覆う面積を1pxも減らしていなかった（減らしていたのは的の大きさだけ）
     *
     * 段送り（§12）の送り幅は `ceil(チップの高さ / 1マス)` マスなので、倍率と一緒に伸び縮みする
     * ＝ **画面上の送り幅もほぼ一定**に保たれ、上限を外しても重なり回避の効きは変わらない。
     * 縮尺は **`getScreenCTM()` から読む**（viewBox 比の手計算はレターボックスを見落とす。開発方針 3.3章）
     *
     * ★ **書き出し練習中だけは 1 を返す**（＝ 図と同じ縮尺。v1432・ユーザー報告
     * 「番号①がまとめて下側に表示される」／発注書 ORDER_isomer_2026-08-20.md §A-3 の案②）。
     *
     * **理由の食い違いが症状の根っこだった**:
     * - 34px の床は **押せる的だから**あるもの（TAP1 と同じ物差し）。
     *   ⚠ **練習中の見出しは押せない** —— `canvasEntryEnabled()` が `worksheetActive()` で
     *   false を返し、枠は `pointer-events:none`・塗りも線も `none` の**ただの番号**になる（§12-3）。
     *   押せないものに的の下限を使う理由は1つも無い。
     * - いっぽう置き場所（分子の下端＋1.1マス）と `tidyAnswerSlots()` の隙間
     *   （`GAP = GRID_SIZE * 2 = 84px`）は**モデル座標**。画面px 固定のチップは
     *   **引いて見るほどモデル座標で太る**ので、答案が増えるほど必ず 84px を食い破る
     *   （実測・1280×800: 答案20個で 1マス＋チップ ＝ 101.8px ＞ 84px。
     *   スマホ 375px では 184.7px）。ぶつかった見出しは `placeMoleculeLabels` の段送りで
     *   逃げるが、`labelPlacementCost` は距離を数えないので**遠くの空き行のほうが安い** ＝
     *   行き場を失った番号が下へ下へと送られて最下段に固まる（実測 最大 16マス＝672px）。
     *
     * 1 を返すと 1マス＋チップ ＝ 46.2 + 34 ＝ **80.2px** で、`GAP` の 84px の内側に必ず収まる
     * ＝ **並べ直しの有無にも、スマホにも同時に効く**（案①は隙間を広げるだけなので
     * 並べ直さない経路に届かず、案③は全モードの重なり回避の実測値を動かす）。
     *
     * ⚠ **床は置かない。** 置いた瞬間にチップがまたモデル座標で太り、同じ症状に戻る
     * （画面 12px の床でも 20個・PC で 89px ＝ 84px 超）。読みやすさは
     * **図と同じ比率で縮む**ことで担保する ＝ 番号が読めないほど引いた絵は、
     * 分子そのものも読めない（結合1本が 10px 前後）。
     */
    labelScale() {
        // ★ 書き出し練習中は「図に紐づいた画面上の道具」ではなく**図の一部（欄外番号）**。
        //   押せないので的の下限は要らない ＝ 図と同じ縮尺に戻す
        if (this.worksheetActive()) return 1;
        const m = this.svg && this.svg.getScreenCTM ? this.svg.getScreenCTM() : null;
        const k = m && m.a > 0 ? m.a : 1; // 画面px / SVG単位
        // 桁あふれよけの数値ガードだけ置く（縮尺が取れない・0 に近い異常時の保険）。
        // 実機の範囲は viewBox 150〜5000 ÷ キャンバス幅なので 0.07〜17 に収まる
        return Math.min(200, Math.max(0.005, 1 / k));
    }

    /**
     * 1マス（`GRID_SIZE` ＝ 結合1本）が**画面上で何 px**になるか。
     * 縮尺は `getScreenCTM()` から読む（viewBox 比の手計算はレターボックスを見落とす。
     * 開発方針 3.3章・`labelScale` と同じ流儀）。
     *
     * 縮尺が読めない場面（キャンバスが `display:none` など）は `Infinity` を返す
     * ＝ **判断しない**。0 を返すと「小さすぎる」と誤判定して、見えていない場面で
     * 視野を動かしてしまう
     */
    screenPxPerGrid() {
        const m = this.svg && this.svg.getScreenCTM ? this.svg.getScreenCTM() : null;
        if (!m || !(m.a > 0)) return Infinity;
        return m.a * GRID_SIZE;
    }

    /**
     * いま**画面に見えている**モデル座標の矩形（`{x, y, w, h}`）。
     * viewBox そのものではなく、`getScreenCTM()` の逆行列でキャンバスの四隅を引き戻して作る
     * ——`preserveAspectRatio` のレターボックスがあると、見えている範囲は viewBox より広い。
     * 手計算の viewBox 比では取り違える（開発方針 3.3章）。
     */
    visibleModelRect() {
        const svg = this.svg;
        if (!svg || !svg.getScreenCTM) return null;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const r = svg.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return null;
        const inv = ctm.inverse();
        const p1 = new DOMPoint(r.left, r.top).matrixTransform(inv);
        const p2 = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
        return {
            x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
            w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y)
        };
    }

    // 見出しのチップが図の下にどれだけ張り出すか（枠がこれを囲めるように、1か所で決める）
    labelExtent() {
        return GRID_SIZE * 1.1 + LABEL_CHIP_HEIGHT * this.labelScale();
    }

    /**
     * 見え方が変わったら見出しを描き直す。倍率も置き場所も**描いた時点の見え方で焼き付く**ので、
     * そのままにすると狂う。ホイールもピンチも連続で飛んでくるので1フレームに1回にまとめる。
     *
     * 呼ばないといけない場面は2つ:
     * - **拡大率が変わったとき** … 画面上の大きさが狂う（視野合わせの直後に実発生: 320px で 19px の的）
     * - **パンで見えている範囲が動いたとき**（v850）… 引き戻し（§13-2）の判断が古くなり、
     *   スクロールで画面外へ流れた見出しがそのまま置き去りになる。⚠ **縮尺が変わらないので
     *   見落としやすい**（ホイールのパン・右ドラッグのパンの2か所とも要る）
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
        // 書き出し練習中は**窓ごと閉める**（DESIGN_isomer_practice.md §12-3）。
        // モーダルは名前・分子式・異性体・立体まで見せる総合窓口なので、
        // そこだけ部分的に伏せると穴を1つずつ塞ぐ作業が始まる
        if (this.worksheetActive()) return false;
        return !this.tapHasOtherMeaning();
    }

    /**
     * **タップに別の意味があるモードか**（整形・不斉マーク・ハース面・箇所選び・機構再生）。
     * ここに載っているあいだ、キャンバスのタップは「作図」ではなくそのモードの仕事になる。
     *
     * ⚠ **一覧をここ1か所にする**のが要点。読む側が2つある:
     *   1. `canvasEntryEnabled()` … 分子の見出し（🔍）を透過に戻す
     *   2. **結合の判定線（`svg-bond-hitbox`）の pointerdown** … 伸縮を始めずキャンバスへ流す
     *
     * 2 が抜けていたせいで**整形モードのタップが判定線に食われていた**
     * （2026-08-15・ユーザー報告 → BUGNOTE_touch_ipad.md S6）。判定線は `stroke-width:20` で
     * 冒頭に `e.stopPropagation()` があるため、**結合の中央十数 px はキャンバス側の
     * モード分岐（`handleMouseDown`）に一度も届かない**。しかも無反応で済まず、
     * 離したときの `click` が次数トグルに落ちて **C=C が C≡C に化けた**（実測）。
     * v152 の「消しゴムが結合に効かない」（同 S2）とまったく同じ型で、
     * そのときは消しゴムの分岐だけを足したので**整形・各種マーク・箇所選びが取り残された**。
     * 分岐を1つずつ足す代わりに一覧を共有して、次にモードが増えても両方が同時に守られるようにする。
     */
    tapHasOtherMeaning() {
        if (this.reactionSelectMode || this.reshapeMode || this.asymmetricMode || this.haworthMode) return true;
        // ★ 「立体が分かれる場所」の印モード（v1435・段1）。**結合をタップして印を付ける**ので、
        //    ここに載っていないと判定線に食われて C=C が C≡C に化ける（§4-3・`IW26`）
        if (this.stereoPointMode) return true;
        if (window.stereoView && window.stereoView.picking) return true;
        if (window.reactor && (window.reactor.picking || window.reactor._morphing)) return true;
        if (window.reactionPlayer && window.reactionPlayer.blocksEditing()) return true;
        return false;
    }

    /**
     * 結合の判定線が「ふつうの結合操作（伸縮・次数トグル・削除）」をしてよいか。
     * `tapHasOtherMeaning()` に加えて、**主鎖と番号を出しているあいだ**も手を引く
     * （`handleMouseDown` は断り文を出して作図を止めているのに、判定線を通ると
     *   黙って次数が変わっていた ＝ 番号を出したまま構造が動く。これも実測で確認した）。
     * ⚠ `canvasEntryEnabled()` には足さない。見出し（🔍）は名前を見る窓口で、
     *   番号の表示中に閉じる理由がない
     */
    bondGestureEnabled() {
        return !this.tapHasOtherMeaning() && !this.iupacNumbering;
    }

    // 縮約表示のカードを1つ描く（P9-2）。
    // カードの向きは「その基が実際に伸びている方向」を優先しつつ、
    // 接続先の原子や他の原子と重なる向きは避ける（方向の最適化）。
    //
    // **アンカーが2つある原子団（エステル -COO-）は別の置き方をする**
    // （DESIGN_chain_condense.md「中間の原子団を畳む」）。末端の基は「アンカーから1マス外へ出す」で足りるが、
    // 中間の原子団は**両側に骨格が残る**ので、外へ出すと結合線が骨格をまたいで交差する
    renderGroupCard(group, hidden) {
        const NS = 'http://www.w3.org/2000/svg';
        const mol = this.userMolecule;
        const anchorIds = group.anchorIds || [];
        const anchors = anchorIds.map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
        const members = group.memberIds.map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
        if (anchors.length === 0 || members.length === 0) return;
        if (anchors.length >= 2) return this.renderBridgeCard(group, anchors, members, hidden);
        const anchor = anchors[0];

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
        // 見た目は通常の結合と同じだが、**数えるときに区別が要る**ので印を付ける
        // （通常の結合線と同じ色・太さなので、色で数えると骨格の結合まで拾ってしまう）
        line.setAttribute('class', 'svg-group-stub');
        line.setAttribute('stroke', 'rgba(255,255,255,0.4)');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('pointer-events', 'none');
        this.bondsGroup.appendChild(line);

        this.drawGroupCardBox(px, py, w, h, group.label);
    }

    /**
     * 中間の原子団（エステル -COO-）のカードを描く（発注書 A・2026-08-15）。
     *
     * 末端の基との違いは**アンカーが2つある**ことだけ。カードは2つのアンカーの
     * 「あいだ」に置き、左右へ1本ずつ接続線を出す ＝ 図の上では `C—[COO]—C` と読める。
     * 置き場所の候補は「2つのアンカーの中点 → 隠した原子の重心 → 中点を軸と直角に
     * ずらした2点」の順で、**表示中の原子と重なる候補を捨てる**（末端の基と同じ判定）。
     */
    renderBridgeCard(group, anchors, members, hidden) {
        const NS = 'http://www.w3.org/2000/svg';
        const mol = this.userMolecule;
        const w = group.label.length * 10 + 16;
        const h = 24;
        const [a1, a2] = anchors;
        const mx = (a1.x + a2.x) / 2, my = (a1.y + a2.y) / 2;
        const cx = members.reduce((s, a) => s + a.x, 0) / members.length;
        const cy = members.reduce((s, a) => s + a.y, 0) / members.length;
        // アンカーを結ぶ軸に直角な単位ベクトル（候補をずらす向き）
        const ax = a2.x - a1.x, ay = a2.y - a1.y;
        const len = Math.hypot(ax, ay) || 1;
        const nx = -ay / len, ny = ax / len;
        const off = GRID_SIZE * 0.8;
        const cands = [
            { x: mx, y: my }, { x: cx, y: cy },
            { x: mx + nx * off, y: my + ny * off },
            { x: mx - nx * off, y: my - ny * off }
        ];
        // アンカー自身も「重なってはいけない原子」に数える（末端の基は逆に、
        // アンカーの隣へ出すのが正しいので除外していた）
        const blockers = mol.atoms.filter(a => !hidden.has(a.id));
        let spot = cands[0];
        for (const cand of cands) {
            if (!blockers.some(b => Math.hypot(b.x - cand.x, b.y - cand.y) < GRID_SIZE * 0.8)) {
                spot = cand;
                break;
            }
        }
        const px = spot.x, py = spot.y;
        // カードの中心から角度 ang の向きに出たとき、枠の縁に当たる点（矩形とレイの交点）。
        // 末端の基は直交方向しか取らないので幅か高さの半分で足りたが、
        // ここは斜めになりうるので**両方を見て近いほうを採る**
        const edge = (ang) => {
            const c = Math.cos(ang), s = Math.sin(ang);
            const t = Math.min(Math.abs(c) > 1e-6 ? (w / 2) / Math.abs(c) : Infinity,
                               Math.abs(s) > 1e-6 ? (h / 2) / Math.abs(s) : Infinity);
            return { x: px + t * c, y: py + t * s };
        };
        anchors.forEach(anchor => {
            const ang = Math.atan2(anchor.y - py, anchor.x - px);
            const from = edge(ang);
            const line = document.createElementNS(NS, 'line');
            line.setAttribute('x1', from.x);
            line.setAttribute('y1', from.y);
            line.setAttribute('x2', anchor.x - 11 * Math.cos(ang));
            line.setAttribute('y2', anchor.y - 11 * Math.sin(ang));
            line.setAttribute('class', 'svg-group-stub');
            line.setAttribute('stroke', 'rgba(255,255,255,0.4)');
            line.setAttribute('stroke-width', '3');
            line.setAttribute('pointer-events', 'none');
            this.bondsGroup.appendChild(line);
        });
        this.drawGroupCardBox(px, py, w, h, group.label);
    }

    // 縮約カードの枠と文字（末端の基と中間の原子団で共用）
    drawGroupCardBox(px, py, w, h, label) {
        const NS = 'http://www.w3.org/2000/svg';
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
        text.textContent = label;
        g.appendChild(rect);
        g.appendChild(text);
        this.atomsGroup.appendChild(g);
    }

    // モード切替（P10 M1）: 面（リボンの点灯・モーダル・作業帯・data-modes 要素）を出し分ける。
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
        /**
         * 🎲 ランダムで出題中は、次もランダムから配る（発注書 D-4・v1417）。
         *
         * ⚠ **既定の挙動は1バイトも変えていない** —— `randomRun` は
         * 🎲 を押したときにだけ立ち、シリーズや問題を自分で選び直すと下りる。
         * ここを通さないと「🎲 → 解く →『次のステージへ』で順番に戻る」となり、
         * **ランダムに練習し続ける道が2手目で切れる**（帯の段を増やさずに済ませた代償を回収する）。
         */
        if (this.randomRun && this.seriesSelect && this.randomRun === this.seriesSelect.value) {
            if (this.drawRandomStage() !== null) return;
            this.randomRun = null;   // 引けなかった（1問しかない）ときは今までどおり次のシリーズへ
        }
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

    /**
     * 書きかけ（1個以上書いた）の練習の名前。移動先が学習なら何も消えない。
     *
     * ⚠ **異性体の書き出しはここに挙がらなくなった**（DESIGN_isomer_practice.md §12-6）。
     * 答案はキャンバスの上にあり、`stop()` はキャンバスに触らないので、
     * 学習モードを離れても図は1つも消えない ＝ 止める理由が無い。
     * ⚠ **アルキル基も W3 で同じ側へ移った**（同 §14）。
     * ⚠ **立体異性体も SW1 で移った**（DESIGN_practice_revision.md §5-2）＝
     * いま登録トレイ（`entries`）を持つ練習は**1つも無い**ので、この確認は実際には出ない。
     * それでも物差しを `entries` のまま残すのは、**トレイを持つ練習が増えたときに
     * 自動で拾える**ようにしておくため（消すと、次に足す人が同じ穴を掘る）。
     */
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

    /**
     * ③ 作業帯の1面を出し入れする（DESIGN_ribbon_consolidation.md §4-2）。
     *
     * 帯は**1つ**で、中身がモードと作業で入れ替わる。面の出し入れは持ち主
     *（reactionPlayer / 各書き出し練習）が呼ぶ ＝ `setMode` は帯の中身を知らない。
     * これは `#right-panel [data-modes]` の出し分けと**わざと別の仕組み**にしてある:
     * 作業帯に出るかどうかは「モードに居るか」ではなく「その作業を始めたか」で決まるため。
     *
     * 面が1つも出ていなければ帯ごと畳む ＝ 何もしていないときはキャンバスが丸ごと見える。
     */
    setWorkPane(paneId, on) {
        const pane = document.getElementById(paneId);
        // ★ 別の面が**新しく**出た ＝ 別の作業が始まった ＝ キャンバスの持ち主が替わる（v1374）。
        //   反応機構ビューアが開いたままだと `blocksEditing()` が true のままで、
        //   **書き出し練習が始まっているのに1画も描けない**。
        //   帯は「その作業を始めたか」で出る（上のコメント）ので、ここが
        //   ボタン経由でも `?open=` 経由でもテストの直接呼び出しでも通る共通の出口になる。
        //
        // ⚠ **「出ている面を出し直す」ときは終わらせない。** 練習の帯は個数が変わるたびに
        //    張り替えられる（learn.js の renderStrip）ので、`on` だけを見て終わらせると
        //    **生成物予測モードの1画目でビューアが勝手に閉じる**（実測でそうなった）。
        //    見るのは隠れている → 出る の**変わり目**だけにする
        if (on && paneId !== 'ws-reaction' && pane && pane.classList.contains('hidden') &&
            window.reactionPlayer && window.reactionPlayer.active) {
            window.reactionPlayer.exit();
        }
        if (pane) pane.classList.toggle('hidden', !on);
        const strip = document.getElementById('work-strip');
        if (!strip) return;
        const any = [...strip.querySelectorAll('.ws-pane')].some(p => !p.classList.contains('hidden'));
        strip.classList.toggle('hidden', !any);
        this.syncWorkStripHeight();
    }

    /** 作業帯の実測の高さを CSS 変数へ。#mobile-name-chip がこれを見て上へ逃げる */
    syncWorkStripHeight() {
        const strip = document.getElementById('work-strip');
        const h = (strip && !strip.classList.contains('hidden')) ? strip.getBoundingClientRect().height : 0;
        document.documentElement.style.setProperty('--work-strip-h', Math.round(h) + 'px');
    }

    /**
     * ③ 書き出し練習の作業帯（§4-2 の「📚 学習（書き出し）」）。
     *
     * 3種（異性体・アルキル基・立体異性体）が**同じ1面**を使い回す。
     * `spec` が null なら面ごと畳む。
     *   spec = { live: HTML文字列, progress: '2/5', actions: [{label, primary, disabled, title, onClick}] }
     *
     * ⚠ ここに置くのは**よく押す3つ**だけ（答え合わせ・確認・やめる）。付け根の置き直しと
     * 書いた図のサムネイルは Study モーダルの中に残す。帯を厚くする方が失うものが大きい。
     *
     * ⚠ **「📚 を開き直せばよい」で済むものと済まないものがある**（A・v1368 の反省）。
     * ここには元々「メニューは開き直せるので帯に無い ＝ 手が届かない にはならない」と
     * 書いてあったが、**💡ヒントだけはそれが成り立たなかった** —— 開き直すとモーダルが
     * 答案（キャンバス）を覆うので、「行き詰まった手元を見ながら押す」ができない。
     * いまヒントは `🔎 確認・ヒント` の面（オーバーレイ）に居て、帯から1手で届く。
     * **帯に足す代わりに、帯から1手の面に置く**のがこの帯の太らせない解き方。
     */
    setPracticeStrip(spec) {
        const live = document.getElementById('ws-practice-live');
        const prog = document.getElementById('ws-practice-progress');
        const acts = document.getElementById('ws-practice-actions');
        if (!live || !prog || !acts) return;
        if (!spec) { this.setWorkPane('ws-practice', false); return; }
        live.innerHTML = spec.live || '';
        prog.textContent = spec.progress || '';
        acts.innerHTML = '';
        // ★ 帯に**書かせる**欄を置けるようにした（v1435・段2「立体異性体も含めた総数」）。
        //   ⚠ 押しもの（`actions`）とは別の配列にする —— 帯の中身は「いま何をする所か」で
        //     並びが決まるので、入力欄をボタンの列に混ぜると押しどきが読めなくなる。
        //   欄は**押しものより前**に出す（数を書いてから答え合わせを押す順そのもの）
        (spec.fields || []).forEach(f => {
            const wrap = document.createElement('label');
            wrap.className = 'ws-field';
            wrap.style.cssText = 'display:inline-flex; align-items:center; gap:4px; font-size:12px; color:var(--text-secondary); white-space:nowrap;';
            if (f.title) wrap.title = f.title;
            if (f.label) wrap.appendChild(document.createTextNode(f.label));
            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.className = 'ws-field-input';
            if (f.id) input.id = f.id;
            input.value = f.value == null ? '' : String(f.value);
            if (f.placeholder) input.placeholder = f.placeholder;
            input.style.cssText = 'width:56px; padding:4px 6px; background:rgba(0,0,0,0.35); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; font-size:13px; text-align:right;';
            if (f.onInput) input.addEventListener('input', () => f.onInput(input.value));
            wrap.appendChild(input);
            if (f.suffix) wrap.appendChild(document.createTextNode(f.suffix));
            acts.appendChild(wrap);
        });
        (spec.actions || []).forEach(a => {
            const b = document.createElement('button');
            b.className = (a.primary ? 'primary-btn' : 'view-btn') + ' ws-action';
            b.textContent = a.label;
            if (a.title) b.title = a.title;
            if (a.id) b.id = a.id;
            b.disabled = !!a.disabled;
            if (a.active) b.classList.add('active');
            b.addEventListener('click', a.onClick);
            acts.appendChild(b);
        });
        this.setWorkPane('ws-practice', true);
    }

    /** ② Study モーダルの開閉（DESIGN_ribbon_consolidation.md 第3段・§6-2） */
    setStudyOpen(on) {
        const m = document.getElementById('study-modal');
        if (m) m.classList.toggle('hidden', !on);
    }

    /**
     * Study モーダルの「バトンを渡したら自分は引っ込む」配線（§6-2）。
     *
     * **列挙しないで決める。** クイズ11枚・書き出し練習3種・反応機構ビューアと、
     * ここから始まる行き先は 15通り以上あり、しかも中身は JS が動的に描く
     *（`#ip-body` などのお題ボタンは `learn.js` が毎回作り直す）。
     * ボタンの id を並べた表を持つと、練習を1つ足すたびに**書き忘れて重なる**。
     *
     * 代わりに**結果で決める**: この中で何かを押した直後に
     *   ・別のモーダルが開いた（クイズ11枚・お手本…）… molecule_modal §5-5「重ねない」
     *   ・作業帯が出た（機構の再生・書き出し練習）… キャンバスが見えていないと意味が無い
     * のどちらかになっていたら、自分を閉じる。
     *
     * ⚠ `setTimeout` は要らない。listener を**モーダル自身（祖先）**に付けているので、
     * ボタン自身の handler が先に走り終えてからここへ bubble してくる。
     * 非同期にすると、テストと台本が「押した直後」を見たときにまだ閉じていない。
     * ⚠ `change` も同じ理由で拾う（`#check-reaction-mode` の toggle と `#select-reaction`）。
     *
     * ★ **見るのは「出ているか」ではなく「この一押しで動いたか」**（v1439・ユーザー実機報告
     *   「反応の種類が選べない」）。以前は**いま作業帯が出ていれば無条件に閉じて**いたので、
     *   **すでに帯が出ているあいだは、メニューを開き直して中を触った瞬間に閉じた** ——
     *   実測（:8240・Playwright）:
     *   ```
     *   ① 一覧から1件目を選ぶ   帯=出る / メニュー=引っ込む          （ここまでは正しい）
     *   ② 📚 を押し直す         メニュー=開く / 帯=出たまま
     *   ③ ⚗️ の見出しを押す     メニュー=閉じる ❌ アコーディオンも畳まれる ❌
     *   ```
     *   ＝ **1件目を見たあと、2件目を選びに戻る道が無い**（触るたびに閉じるので永久に届かない）。
     *   バトンは①で渡し終えているのに、②③でもう一度渡したことにしていたのが誤り。
     *
     * ⚠ **列挙しない方針は変えない。** 見るものを「いま出ているか」から
     *   「押す前と押した後で、キャンバスの側（作業帯の面と中身・別のモーダル）が変わったか」
     *   に替えるだけ。**中身**まで見るのは、同じ面のまま別のお題に差し替わる経路
     *  （練習中に別のお題を押す）を落とさないため。
     */
    setupStudyModal() {
        const modal = document.getElementById('study-modal');
        if (!modal) return;
        const close = document.getElementById('btn-study-close');
        if (close) close.addEventListener('click', () => this.setStudyOpen(false));
        // キャンバスの側の様子（出ている面とその中身・別モーダルの数）
        const canvasSide = () => {
            const panes = new Map();
            document.querySelectorAll('#work-strip .ws-pane').forEach(p => {
                if (!p.classList.contains('hidden')) panes.set(p.id, p.textContent);
            });
            const others = [...document.querySelectorAll('.modal-overlay')]
                .filter(m => m !== modal && !m.classList.contains('hidden')).length;
            return { panes, others };
        };
        /**
         * 「バトンを渡した」＝ **何かが新しく出た**（面が出た・面の中身が別の作業に差し替わった・
         * 別のモーダルが開いた）。⚠ **消えたのは渡したことにしない** —— 「練習をやめる」は
         * 面を1つ引っ込めるだけで、行き先はこのメニュー自身（お題選びに戻る道・LX6）。
         */
        let before = null;
        const snap = () => { before = canvasSide(); };
        const handoff = () => {
            if (modal.classList.contains('hidden') || before === null) return;
            const now = canvasSide();
            const grew = now.others > before.others ||
                [...now.panes].some(([id, text]) => !before.panes.has(id) || before.panes.get(id) !== text);
            if (grew) this.setStudyOpen(false);
        };
        // ⚠ capture で先に控える（モーダルは祖先なので、中のボタンの handler より前に走る）
        modal.addEventListener('click', snap, true);
        modal.addEventListener('change', snap, true);
        modal.addEventListener('click', handoff);
        modal.addEventListener('change', handoff);
    }

    /**
     * ★ 学習が終わったら 🧪自由 へ戻す（v1392・ユーザー申し立て「上のタブは学習モードが
     * 選択されたまま」）。
     *
     * **症状**: 📚学習 → 書き出し練習 → 「やめる」のあと、`currentMode` は `'learn'` のままで
     * 練習の帯もお題選びも画面に無い ＝ **押せるボタンが1つも無い画面**になる。
     * クイズ11枚も同じで、モーダルを閉じるとタブだけが学習に残る。
     *
     * **なぜ出口ごとに書かないか**（`setupStudyModal` の handoff と同じ理由）。
     * 学習の終わり方は、書き出し練習3種の「やめる」がそれぞれ3か所（パネル・帯・答え合わせの面）、
     * クイズ11枚の ✕、Study モーダルの ✕、機構ビューアのチェック解除…と **20か所を超える**。
     * 表を持つと、学習コンテンツを1つ足すたびに書き忘れる。
     * **結果で決める**: 人が何かを押し終えた時点で「学習モードなのに学習の面が
     * 画面に1つも無い」なら、そこが出口だったと見なして 🧪自由 へ移す。
     *
     * ⚠ **キャンバスには触らない。** 移すのはモードだけで、図はそのまま残る
     *    （`learn.js` §12-6 —— 答案用紙ではキャンバスが成果物）。
     * ⚠ **確認を新たに出さない。** 失うものが無いので聞く理由がない。練習の**途中**で
     *    タブを押したときの確認は `leaveGuard` が持っている（そこは触っていない）。
     * ⚠ **`click` の bubble で聞く**（capture ではない）。押しものの処理が終わったあと ＝
     *    後始末が済んで面の出し入れが落ち着いた時点を見たい。capture だと
     *    「これから始まる練習」の帯がまだ出ていないので、**始めた瞬間に自由へ落ちる**。
     * ⚠ **人が押したときだけ**。`setMode` / `stop()` を直に呼ぶ台本・テスト・`?open=` は
     *    素通りする ＝ 無人再生の途中で勝手にモードが変わらない。
     *    同じ理由で、`beginSession()` が隣の練習を `stop()` する内部の受け渡しも巻き込まない
     *    （1回のクリックが終わったあとに1度だけ見るので、途中の「誰も出ていない」瞬間を拾わない）。
     */
    setupLearnExit() {
        document.addEventListener('click', () => {
            if (this.currentMode !== 'learn') return;
            if (this.learnSurfaceOpen()) return;
            this.setMode('free');
        });
    }

    /**
     * 学習の面が画面に出ているか（`setupLearnExit` の唯一の判定）。
     * **どれか1つでも出ていれば学習は続いている**とみなす。列挙するのは器の種類だけで、
     * 中身（どのクイズか・どの練習か）は数えない ＝ 学習コンテンツを足しても書き足さずに済む。
     */
    learnSurfaceOpen() {
        // ① モーダル（Study・クイズ11枚・立体対照・お手本・確認…）
        if ([...document.querySelectorAll('.modal-overlay')]
            .some(m => !m.classList.contains('hidden'))) return true;
        // ② キャンバスに重なる面（作業帯・答え合わせ／確認のオーバーレイ・前後比較）。
        //    `#work-strip` も `.canvas-overlay` なのでここで一緒に拾える
        if ([...document.querySelectorAll('.canvas-overlay')]
            .some(el => !el.classList.contains('hidden'))) return true;
        // ③ 画面には出ていなくても、続きのある学習が動いているとき（保険）
        if (window.reactionPlayer && window.reactionPlayer.active) return true;
        if ([window.isomerPractice, window.alkylPractice, window.stereoPractice]
            .some(p => p && p.active)) return true;
        return false;
    }

    /** ② Puzzle モーダルの開閉（DESIGN_ribbon_consolidation.md 第4段・§7） */
    setPuzzleOpen(on) {
        const m = document.getElementById('puzzle-modal');
        if (m) m.classList.toggle('hidden', !on);
        // 🎲 の1行（残り何問か・1問しかないシリーズの断り）は**開くたびに書き直す**
        // ＝ 閉じているあいだに進んだぶんが古いまま出ない（v1417）
        if (on) this.updateRandomEntry();
    }

    /**
     * Puzzle モーダルの配線（§7）。
     *
     * ここは Study と**同じ作法**でよい ——「お題を選んだら閉じてキャンバスへ返す」。
     * ただし判定の3点（お題名・分子式・構造判定）は**閉じても見えている**（作業帯のストリップ）ので、
     * 閉じることが機能の喪失にならない。それが §7-3 の案A を選んだ理由そのもの。
     *
     * ⚠ **列挙しないで決める**（Study と同じ・§6-2 の落とし穴②）。
     * `<select>` の change・「↷ このお題をやめて次へ」・お手本 … 行き先はどれも
     * 「お題が変わってキャンバスへ戻る」なので、**結果**で閉じる:
     *   ・別のモーダルが開いた（お手本 `#target-modal`・正解 `#win-modal`）
     *   ・お題が変わった（`currentStageIndex` が動いた）
     * ⚠ 判定オプションのスイッチ2つ（`#check-judge-asymmetric` / `#check-read-stereo`）は
     * **閉じてはいけない** —— 2つ続けて切りたい設定で、1つ触るたびに閉じると使えない。
     * `change` で拾う相手を `<select>` に絞ることでこれを満たす。
     */
    setupPuzzleModal() {
        const modal = document.getElementById('puzzle-modal');
        if (!modal) return;
        const close = document.getElementById('btn-puzzle-close');
        if (close) close.addEventListener('click', () => this.setPuzzleOpen(false));
        const handoff = (e) => {
            if (modal.classList.contains('hidden')) return;
            // 設定のトグルとラベルは「この画面に留まる」操作
            if (e.type === 'change' && !(e.target && e.target.tagName === 'SELECT')) return;
            /**
             * ⚠ **シリーズを選んだだけでは閉じない**（2026-08-13・ユーザー報告）。
             * この画面は「シリーズを選ぶ → 問題を選ぶ」の2段なのに、`<select>` の change を
             * ひとまとめに「お題が決まった」と扱っていたので、**1段目で閉じてしまい
             * 問題を選べなかった**。閉じてよいのは**2段目（#select-stage）**だけ。
             * ⚠ シリーズを変えると先頭の問題が自動で読み込まれる（`seriesSelect` の change 参照）
             * ので、**お題が変わること自体は起きる**。それでもここは閉じない
             * ——「まだ選んでいる途中」だから。閉じるかどうかは**利用者の段取り**で決める。
             */
            if (e.type === 'change' && e.target.id === 'select-series') return;
            if (e.type === 'click' && e.target.closest && e.target.closest('.toggle-container')) return;
            const otherModal = [...document.querySelectorAll('.modal-overlay')]
                .some(m => m !== modal && !m.classList.contains('hidden'));
            if (otherModal || e.type === 'change' || (e.target.closest && e.target.closest('#btn-give-up'))) {
                this.setPuzzleOpen(false);
            }
        };
        modal.addEventListener('click', handoff);
        modal.addEventListener('change', handoff);
        // お題ストリップの見出しをタップすると開く（§7-4。説明文へ1手で戻れる道）
        const head = document.getElementById('ws-target-head');
        if (head) head.addEventListener('click', () => this.setPuzzleOpen(true));
    }

    /**
     * ② 背景（枠の外）を押したら閉じる（DESIGN_ribbon_consolidation.md §22・2026-08-13 ユーザー要望）。
     *
     * それまで閉じる道は「✕／閉じるボタン」と「選び終わる」の2つしかなく、
     * **開いてしまったが何もせず戻りたい**ときに出口が見えなかった。
     *
     * ⚠ **閉じ方を書き直さない。持ち主の「閉じる」ボタンを押す**のがこの配線の要点。
     * 閉じる処理はモーダルごとに後始末が違う（⏱ タイムアタックはタイマーを止める・
     * 🔤 呼出はエラー文言を消す・◯ 環の員数は選択中のモジュールを解除する）。
     * `classList.add('hidden')` を並べた表を持つと、**後始末だけが背景クリックのときに抜ける**。
     * ボタンを押せば、持ち主が今どう閉じているかを写し取らずに済む。
     *
     * ⚠ **`#win-modal` も入れた**（2026-08-13・統合時）。
     * この配線を書いた時点では「あの1枚には閉じるボタンが無く『次のステージへ』が唯一の出口
     * ＝ 背景で消せるようにすると前へ進む道が消える」という理由で外していた。
     * ところが**同じ日に v1344 で正解モーダルの出口が3つになり**
     * （次のお題へ／別のお題へ／閉じる（自由モードへ））、**除外の理由そのものが消えた**。
     * 行き先は `btn-win-close`＝「閉じる（自由モードへ）」で、
     * 「進む道を消さない」という当初の意図はそのまま満たされる。
     * **前提が変わったことは BC4 が教えてくれた**（「#win-modal に閉じるボタンが増えている」で赤くなった）
     * ＝ 除外という判断そのものに見張りが付いていた。
     *
     * → **規則: この表に入れてよいのは「閉じる」相当のボタンを持つモーダルだけ。**
     *   出口が1つしかない画面は、先に閉じる道を足す話であってここの仕事ではない。
     *
     * ⚠ 確認（`#confirm-modal`）の行き先は **`btn-confirm-cancel`（やめておく）**。
     * 「もとにもどる」＝ 実行しない側で、取り返しのつく方に倒している。
     */
    setupBackdropClose() {
        // [モーダル, そのモーダルの「閉じる」ボタン]
        const 表 = [
            ['win-modal', 'btn-win-close'],
            ['target-modal', 'btn-close-target'],
            ['puzzle-modal', 'btn-puzzle-close'],
            ['study-modal', 'btn-study-close'],
            ['narrowing-modal', 'btn-nw-close'],
            ['count-quiz-modal', 'btn-cq-close'],
            ['stereo-quiz-modal', 'btn-sq-close'],
            ['fischer-practice-modal', 'btn-fp-close'],
            ['time-attack-modal', 'btn-ta-close'],
            ['symbol-puzzle-modal', 'btn-sp-close'],
            ['choice-quiz-modal', 'btn-pk-close'],
            ['dl-explain-modal', 'btn-dl-explain-close'],
            ['quiz-modal', 'btn-quiz-close'],
            ['molecule-modal', 'btn-molecule-modal-close'],
            ['stereo-modal', 'btn-stereo-close'],
            ['tutorial-modal', 'btn-tutorial-close'],
            ['learn-modal', 'btn-learn-close'],
            ['confirm-modal', 'btn-confirm-cancel'],
            ['summon-modal', 'btn-summon-cancel'],
            ['nring-modal', 'btn-nring-cancel'],
            ['naming-modal', 'btn-naming-close'],
        ];
        表.forEach(([modalId, closeId]) => {
            const modal = document.getElementById(modalId);
            const close = document.getElementById(closeId);
            if (!modal || !close) return;
            this.enableBackdropClose(modal, () => close.click());
        });
    }

    /**
     * 「枠の外を押したら閉じる」1枚分の配線（§22）。
     *
     * ⚠ 要点は3つ。どれか1つでも欠けると、**閉じてほしくないときに閉じる**:
     *  ① `e.target === modal` —— 枠（`.modal-content`）の中で起きたクリックは
     *     祖先の `.modal-overlay` まで bubble してくる。これを除かないと**中を押しても閉じる**
     *  ② `pointerdown` も背景だったか —— `click` は down と up の**共通の祖先**に飛ぶので、
     *     枠の中から始めて背景で指を離すと `e.target` が `modal` になる。
     *     お手本モーダル（`#target-modal`）は図をドラッグで動かせるので、
     *     これが無いと**図を動かしただけで閉じる**
     *  ③ `pointerup` も背景だったか —— ②の逆（背景から押し始めて枠の中で離す）を除く
     *
     * ⚠ 開いていないモーダルの上でのクリックは無視する（`hidden` でも listener は生きている）。
     */
    enableBackdropClose(modal, onClose) {
        if (!modal || typeof onClose !== 'function') return;
        let 押しも背景 = false;
        let 離しも背景 = false;
        modal.addEventListener('pointerdown', (e) => { 押しも背景 = (e.target === modal); });
        modal.addEventListener('pointerup', (e) => { 離しも背景 = (e.target === modal); });
        modal.addEventListener('click', (e) => {
            const 背景だけで完結した = 押しも背景 && 離しも背景 && e.target === modal;
            押しも背景 = 離しも背景 = false;
            if (!背景だけで完結した) return;
            if (modal.classList.contains('hidden')) return;
            onClose();
        });
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
        // リボンの「← 自由へ」タイルも同じ条件で出し入れする（§12-1 ユーザー決定⑤）。
        // 「🧪 自由」という**行き先のボタンは廃止**し、`.mode-tab[data-mode="free"]` を
        // **戻る導線に統合**した ＝ 標準にいる間は枠を1つも使わない。
        // ⚠ セレクタは据え置き（台本 12箇所）。⚠ 隠すのは**インラインの display**でなければ
        // ならない —— 置き場所で書いた `.canvas-header button { display:flex }`（0,1,1）に
        // クラス指定では勝てない（§15-3 の落とし穴①と同じ噛み合わせ）
        const freeTile = document.querySelector('.canvas-header .mode-tab[data-mode="free"]');
        if (freeTile) freeTile.style.display = (mode === 'free') ? 'none' : '';
        // モード別の出し分け（§8-3）。⚠ **セレクタから `#right-panel` を外した**（第5段）——
        // 右パネルが DOM から消えたので、`#right-panel [data-modes]` は誰も選ばない。
        // 段の途中で外すと「まだ右パネルに残っている要素」と「移設先の要素」の両方が動いて
        // 切り分けが崩れるため、**消す段まで待って**から外している
        document.querySelectorAll('[data-modes]').forEach(el => {
            el.style.display = el.dataset.modes.split(' ').includes(mode) ? '' : 'none';
        });
        // ⚠ ここから下の「離れるときに捨てる」処理は**確認を挟まない**。
        // 確認は `leaveGuard`（人がタブや「← 自由に戻る」を押したとき）の仕事で、
        // setMode 自体は台本・テスト・`?open=` からも呼ばれるため止めてはいけない。
        // 学習モードを離れたら Study モーダルは閉じる（第3段。開いたまま別モードの
        // 画面が裏で切り替わると、閉じた瞬間に知らない画面が出てくる）。
        // **開く方は setMode の仕事ではない** ＝ 人がタイルを押したときだけ開く
        if (mode !== 'learn') this.setStudyOpen(false);
        // 🧩 も同じ（第4段）。**開く方は setMode の仕事ではない** ＝ 人がタイルを押したときと、
        // お題ストリップの見出しをタップしたときだけ開く
        if (mode !== 'puzzle') this.setPuzzleOpen(false);
        // ③ お題ストリップは「パズルにいるあいだ」ずっと出す（§7-3 案A）。
        // ⚠ ここだけは作業帯の他の面（⚗・✏️）と出し方が違う —— あちらは「その作業を始めたか」で
        // 決まるが、お題は**モードそのもの**なので setMode が面倒を見る。
        // これが「判定はモーダルの中に入れない」を成り立たせている
        this.setWorkPane('ws-puzzle', mode === 'puzzle');
        // ③ 🧪 標準の面（名称呼び出し・🔬 調べる）も同じ扱い（第5段）。
        // 右パネルにあったころは「自由モードのあいだ出ている」ものだったので、
        // 出し方も**モードそのもの**に合わせる（`DESIGN_ui_modes.md` §7 の
        // 「自由モードの初期状態: 名称呼び出しの導線を目立たせる」）
        this.setWorkPane('ws-free', mode === 'free');
        // 学習モードを離れるときは反応機構モードを終了する
        if (mode !== 'learn' && window.reactionPlayer && window.reactionPlayer.active) {
            window.reactionPlayer.exit();
        }
        // 「🎯 反応させる分子を選ぶ」は 🧪自由 の分子モーダルの道具なので、
        // モードが変わったら下ろす（v1409。持ち越すとタップが作図に戻らない）
        this.deactivateReactionSelectMode();
        // 学習モードを離れるときは異性体練習セッションを破棄する（P12-1）。
        // ★ 例外は1つ ——「**採点して終了した練習は 🧪自由 へ持って出る**」（v1392）。
        //   `finishAnswer()` は `_finished` を立てたままセッションを生かし、帯を
        //   「🔍 結果を見る」「↻ もう一度」「やめる」に張り替える。その直後に自分で
        //   `setMode('free')` を呼ぶので、ここで無条件に `stop()` すると
        //   **採点した瞬間に結果への道ごと帯が消える**。
        //   ⚠ 持って出るのは **🧪自由 だけ**。🧩パズルへ移るときは今までどおり捨てる ——
        //     あちらは `#ws-puzzle`（お題ストリップ）が必ず出る面なので、採点済みの帯と
        //     2段に並んで「いまどちらの作業中か」が読めなくなる。
        //     自由モードは `#ws-free`（名称呼び出し・🔬調べる）の1行だけなので並べても読める。
        //   ⚠ 「↻ もう一度」を自由モードで押したときは `restartProblem()` が
        //     `setMode('learn')` で学習へ戻す ＝ `_finished` が下りた練習が
        //     自由モードに取り残されない（取り残すと、次に誰かが `setMode` を呼んだ瞬間に消える）。
        if (mode !== 'learn' && window.isomerPractice && window.isomerPractice.active &&
            !(mode === 'free' && window.isomerPractice._finished)) {
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
        // 自由モードを離れるときは前後比較の**画面を閉じ**、モーフィング再生を止める（P12-5）。
        // ⚠ **記録（`lastReaction`）は捨てない**（v1423・DESIGN_reaction_execution.md §12）。
        //   かつてここが `exitCompare()`（＝記録ごと破棄）を呼んでいたため、
        //   「⚗ この反応の機構を見る」は `setMode('learn')` を通る ＝ **機構を見にいっただけで
        //   直近の反応の記録が消え、戻ってきても「↩ 反応前に戻す」が出せなかった**。
        //   分子は `reaction.js` の `borrowCanvas()` / `returnCanvas()` が退避・復帰しているので、
        //   捨てられていたのは記録だけ ＝ 全消去用の掃除が機構ジャンプにも効いていただけだった。
        //   捨てる側（`discardLastReaction()`）は全消去と「↩ 反応前に戻す」が呼ぶ。
        //   帰ってきた図が本当に反応後のままかは `reactor.syncUndoButton()` の門番が見る
        //   ＝ 描き足していれば札は出ない（RX31 ①・RX42）
        if (mode !== 'free' && window.reactor) {
            window.reactor.finalizeMorph();
            window.reactor.closeCompare();
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
        // ⇅ 上下に裏返す の札も同じところでそろえる（糖のハース図のときだけ出る）
        this.syncHaworthFlipButton();
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

    /**
     * 名称候補を**自前の DOM で**描くコンボボックス（v1406・実発生）。
     *
     * ★ なぜ `<datalist>` をやめたか ―― ブラウザが描く部品なので、候補を選んだことを
     *   こちらのコードで知る手段が `input` / `change` しか無い。ところが候補の値が
     *   **打った文字列と1文字も違わない**とき（「1-ブタノール」を打ち切ってから
     *   先頭の完全一致を選ぶ）、値に変化が無いので**どちらのイベントも1つも出ない**。
     *   受け口を何本足しても、監視してもポーリングしても捕まらない ＝ 原理的に届かない。
     *   自前の DOM なら**クリックそのもの**を受けられるので、値が変わるかどうかと無関係になる。
     *
     * ★ 付いてくる利得:
     *   ・`autocomplete="off"` が効く（ネイティブの候補ポップアップが出ない）＝
     *     過去に入力した値がブラウザ側の履歴として復活して別の分子が呼ばれる事故が消える
     *   ・Enter をブラウザに食われない（ネイティブの候補が開いていると確定に使われていた）
     *   ・↓↑ / Enter / Esc をこちらで決められる
     *
     * ⚠ 候補の**作り方は1箇所**のまま（`this.summonNames`）。`<datalist>` を id 参照で
     *    共有していた性質をそのまま引き継ぐ ＝ 2つの入力欄が同じ並びを見る。
     * ⚠ ポップアップは **`document.body` の直下**に `position: fixed` で置く。
     *    帯（z-index 30）やモーダル（1000）の**中**に入れると、その積み重ね文脈に閉じ込められ、
     *    さらに `.modal-content` の `overflow-y: auto`（≤900px）に切られる。
     *
     * @param {HTMLInputElement} input 相手の入力欄
     * @param {() => void} commit 確定したときにやること（入力欄の値を読む）
     * @returns {{box: HTMLElement, close: () => void, open: () => void}}
     */
    attachSummonCombo(input, commit) {
        const names = this.summonNames || [];
        const box = document.createElement('div');
        box.className = 'summon-ac hidden';
        box.id = input.id + '-ac';
        box.setAttribute('role', 'listbox');
        document.body.appendChild(box);
        // ネイティブの候補・履歴・自動補完をすべて止める（自前のリストと二重に出さない）
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', box.id);
        input.setAttribute('aria-expanded', 'false');

        let 選択 = -1;
        let 閉じるタイマー = null;
        const 開いている = () => !box.classList.contains('hidden');

        const 閉じる = () => {
            clearTimeout(閉じるタイマー);
            box.classList.add('hidden');
            box.innerHTML = '';
            選択 = -1;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        };

        /** 画面のどこへ出すか。入力欄の下が狭ければ上へ返す（モーダルの中でも切れない） */
        const 置く = () => {
            const r = input.getBoundingClientRect();
            if (r.width < 1 && r.height < 1) { 閉じる(); return; }   // 入力欄が消えていたら畳む
            const 下余り = window.innerHeight - r.bottom - 6;
            const 上余り = r.top - 6;
            const 下に出す = 下余り >= 140 || 下余り >= 上余り;
            box.style.maxHeight = Math.max(88, Math.min(260, 下に出す ? 下余り : 上余り)) + 'px';
            const w = Math.max(Math.min(r.width, window.innerWidth - 8), 180);
            box.style.width = Math.round(w) + 'px';
            box.style.left = Math.round(
                Math.max(4, Math.min(r.left, window.innerWidth - 4 - w))) + 'px';
            if (下に出す) {
                box.style.top = Math.round(r.bottom + 2) + 'px';
                box.style.bottom = 'auto';
            } else {
                box.style.top = 'auto';
                box.style.bottom = Math.round(window.innerHeight - r.top + 2) + 'px';
            }
        };

        const 印をつける = () => {
            [...box.querySelectorAll('.summon-ac-item')].forEach((el, i) => {
                el.classList.toggle('on', i === 選択);
                el.setAttribute('aria-selected', i === 選択 ? 'true' : 'false');
            });
            const el = box.querySelectorAll('.summon-ac-item')[選択];
            if (el) {
                input.setAttribute('aria-activedescendant', el.id);
                if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            } else {
                input.removeAttribute('aria-activedescendant');
            }
        };

        /**
         * 絞り込みと並べ直し。
         * ⚠ **`<datalist>` のときと同じ**にする（勝手に変えない）:
         *    ・並び順 … `summonNames` の並び（表示名の昇順）のまま
         *    ・当て方 … **部分一致**（Chrome の datalist と同じ。「ブタノール」で 1-/2- が出る）
         */
        const 並べる = () => {
            const q = input.value.trim().toLowerCase();
            const 当たり = q ? names.filter(n => n.toLowerCase().includes(q)) : names;
            box.innerHTML = '';
            if (当たり.length === 0) { 閉じる(); return; }
            当たり.slice(0, SUMMON_AC_MAX).forEach((n, i) => {
                const it = document.createElement('div');
                it.className = 'summon-ac-item';
                it.id = `${box.id}-${i}`;
                it.setAttribute('role', 'option');
                it.setAttribute('aria-selected', 'false');
                it.dataset.value = n;
                it.textContent = n;
                box.appendChild(it);
            });
            if (当たり.length > SUMMON_AC_MAX) {
                const more = document.createElement('div');
                more.className = 'summon-ac-more';
                more.textContent = `…ほか ${当たり.length - SUMMON_AC_MAX} 件（もう少し打つと絞れます）`;
                box.appendChild(more);
            }
            選択 = -1;
            box.classList.remove('hidden');
            input.setAttribute('aria-expanded', 'true');
            box.scrollTop = 0;
            置く();
            印をつける();
        };

        /** 候補で確定する。⚠ **名前を覚えない**（同じ分子を続けて2つ呼ぶ道を塞がないため） */
        const 選ぶ = (v) => {
            input.value = v;
            閉じる();
            commit();
        };

        // ⚠ `pointerdown` の既定動作（focus の移動）を止める ＝ 入力欄が `blur` しない。
        //    止めないと blur → `change` が先に飛び、押した本人の操作ではなく change が呼ぶ。
        //    さらに、blur で畳む処理が click より先に走ると**押した候補が消えて空振り**する
        box.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.summon-ac-item')) e.preventDefault();
        });
        box.addEventListener('mousedown', (e) => {
            if (e.target.closest('.summon-ac-item')) e.preventDefault();
        });
        box.addEventListener('click', (e) => {
            const it = e.target.closest('.summon-ac-item');
            if (!it) return;
            選ぶ(it.dataset.value);
        });

        const 開く = () => { clearTimeout(閉じるタイマー); 並べる(); };
        input.addEventListener('focus', 開く);
        input.addEventListener('click', 開く);
        input.addEventListener('input', 開く);
        // 保険（`pointerdown` の抑止が効かないブラウザ用）。**遅らせる**のが要点で、
        // 即座に畳むと pointerup → click が届く前に候補が消える
        input.addEventListener('blur', () => {
            clearTimeout(閉じるタイマー);
            閉じるタイマー = setTimeout(閉じる, 180);
        });

        input.addEventListener('keydown', (e) => {
            const 候補 = () => box.querySelectorAll('.summon-ac-item');
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!開いている()) 並べる();
                const m = 候補().length;
                if (m === 0) return;
                選択 = e.key === 'ArrowDown'
                    ? (選択 + 1) % m
                    : (選択 <= 0 ? m - 1 : 選択 - 1);
                印をつける();
                return;
            }
            if (e.key === 'Escape') {
                if (!開いている()) return;
                e.preventDefault();
                e.stopPropagation();     // モーダルの Esc（閉じる）まで巻き込まない
                閉じる();
                return;
            }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const el = 候補()[選択];
            // ★ 候補を**選んでいる**ときはその候補で、選んでいなければ**打った文字列**で呼ぶ
            //   （後者が v1401 で入れた挙動。キーボードだけで進む人の道を変えない）
            if (el) { 選ぶ(el.dataset.value); return; }
            閉じる();
            commit();
        });

        // 画面が動いたら位置を追う（帯もモーダルも fixed なので、開いたまま追随できる）
        const 追う = () => { if (開いている()) 置く(); };
        window.addEventListener('resize', 追う);
        window.addEventListener('scroll', 追う, true);

        return { box, close: 閉じる, open: 開く };
    }

    // 名称呼び出しUIの初期化（P9-1 M1）。データロード完了後に一度だけ呼ぶ
    setupSummonUI() {
        const input = document.getElementById('summon-input');
        if (!input) return;
        // ★ 候補の名前は**ここ1つ**で作る（`<datalist>` を id 参照で共有していたのと同じ性質）。
        //   2つの入力欄（帯・モーダル）は、どちらもこの配列からリストを描く
        this.summonNames = [...new Set(this.getCompoundLibrary().map(e => e.name))].sort();
        // ★ 確定の受け口の履歴（**消さない**。同じ道を2度掘らないための記録）。
        //   ① `change` 1本だけだったころの実発生: **名前を打ち切ってから、先頭に出た
        //      完全一致の候補を選ぶと何も起きない**。`change` は「確定した値が、その欄が
        //      持っていた値と違う」ときにしか飛ばない ＝ 値の変わらない確定では出ない。
        //   ② v1401 ―― **受け口を増やしても、完全一致の候補は捕まえられない**。
        //      `<datalist>` の候補の**実際の値**は
        //          "1-ブタノール"                            ← 打った文字列と1文字も違わない
        //          "2-メチル-1-プロパノール（イソブタノール）"   ← 別名が付くので値が変わる
        //      で、値が1文字も変わらない確定では `input` も `change` も1つも出ない。
        //      変化そのものが無いので、監視してもポーリングしても検出できない。
        //      そこで「人が確定を出せる道」（下の「呼び出す」ボタンと Enter）を足した ＝ 迂回路。
        //   ③ v1406 ―― **`<datalist>` そのものをやめた**（`attachSummonCombo`）。候補を
        //      自前の DOM で描けば**クリックを直接受けられる**ので、値が変わるかどうかと
        //      無関係になる ＝ ②の迂回路ではなく、いちばん自然な操作がそのまま効く。
        //      ⚠ ②で足したボタン・Enter は**残す**（SM1・SM2 が見張る道）。
        //   ⚠ L8 は合成イベントを撃つので①②の症状では赤くならない（撃った時点で値が
        //     変わっているため）。実ブラウザの症状を見張るのは SM1〜SM6 の側。
        //
        // ⚠ 引けなかった名前だけを覚える（トーストの2連発よけ）。
        //    ボタンを押すと `blur` → `change` が**先に**飛ぶブラウザがあり、成功時は
        //    `summonMolecule` が欄を空にするので後続は空振りするが、**失敗時は欄が残る**ので
        //    同じ名前で2回鳴る。成功は1度も覚えない ＝ 同じ分子を続けて2つ呼ぶ道は塞がない。
        let 断った = null;
        let combo = null;
        const 実行 = () => {
            const name = input.value.trim();
            if (!name) return;
            if (name === 断った) return;
            const 出た = this.summonMolecule(name);
            断った = 出た ? null : name;
            // 出せたら候補も畳む（欄が空になったのにリストだけ残ると、次に打つ場所が隠れる）
            if (出た && combo) combo.close();
        };
        // ⚠ 二重発火よけ。候補を選ぶと `input` の直後に `change` も飛ぶので、
        //    **旗を立てて次の1回だけ飲む**。
        //    ★ **名前で覚える形にしてはいけない**（2度とも実測で落ちた）:
        //      「消してから同じ分子をもう一度」が効かなくなり、
        //      **同じ分子を2つ呼ぶ操作**（分子間脱水は エタノール ×2）が組めなくなる。
        let 選択で呼んだ = false;
        // 触り始めたら必ず落とす。`change` が続かなかったときに次の確定へ持ち越さないため
        input.addEventListener('focus', () => { 選択で呼んだ = false; 断った = null; });
        input.addEventListener('input', (e) => {
            断った = null;   // 1文字でも触ったら「断った名前」は無効（同じ名前でも鳴り直してよい）
            // ⚠ v1406 で自前のリストにしたあとも**この道を残す**。`<datalist>` 以外にも
            //    候補を差し込む経路（IME の変換候補・OS の自動補完・貼り付け）はあり、
            //    どれも `insertReplacementText` を名乗る。素の打鍵は必ず insertText 系が付く
            const 選んだ = e.inputType === 'insertReplacementText'
                || (!e.inputType && this.summonNames.includes(input.value));
            選択で呼んだ = 選んだ;
            if (選んだ) 実行();
        });
        input.addEventListener('change', () => {
            const 飲む = 選択で呼んだ;
            選択で呼んだ = false;
            if (!飲む) 実行();
        });

        /**
         * ★ 「呼び出す」ボタン（SM1）。**押せば必ず呼ばれる** ＝ 候補まわりの挙動に
         * 一切依存しない道。完全一致の候補を選んだあと、人が自然に行う操作はこれ。
         *
         * ⚠ `mousedown` の既定動作（focus の移動）だけ止める。止めないと押した瞬間に
         *    入力欄が `blur` → `change` を出し、**ボタンではなく `change` が呼ぶ**ことになる
         *    （結果は同じだが、押した本人の操作と処理が別物になり追いかけにくい）。
         *    focus が欄に残るので、続けて次の名前を打てるという利点もある。
         */
        const go = document.getElementById('btn-summon-go');
        if (go) {
            go.addEventListener('mousedown', (e) => e.preventDefault());
            go.addEventListener('click', () => { if (combo) combo.close(); 実行(); });
        }
        // ★ 候補リスト＋ ↓↑ / Enter / Esc（SM1・SM2・SM4）。
        //   Enter は**候補を選んでいればその候補**・選んでいなければ**打った文字列**で呼ぶ。
        //   ⚠ v1401 までは `<datalist>` が開いているあいだ Chrome が Enter を食っていた
        //      （候補の確定に使われる）。自前のリストは keydown がそのままこちらへ来る
        combo = this.attachSummonCombo(input, 実行);
        this.summonCombo = combo;
        this.setupSummonModal();
    }

    /**
     * 🔤 呼出タイル → 名称呼び出しモーダル（DESIGN_ribbon_consolidation.md §21）。
     *
     * 作業帯の `#summon-input` に**加えて**用意する2つめの入口。第5段（v771）で
     * 名称呼び出しが右パネルから作業帯へ移ったが、帯は 🧪自由でしか出ないので、
     * パズル・学習にいるあいだは名前で分子を出す手段が無かった。
     * リボンなら**全モードで同じ場所**にあり、タイル1枚の追加で段が1つも増えない（§21-2 の実測）。
     *
     * ⚠ 作業帯の入力欄は**そのまま**（消さない・移さない）。入口を増やす変更であって移設ではない。
     * ⚠ 呼び出しはキャンバスの中身を変えるので、モードタブと同じく `leaveGuard` を通す。
     *    書き出し練習の途中で押しても、書きかけを黙って捨てない。
     */
    setupSummonModal() {
        const btn = document.getElementById('btn-summon');
        const modal = document.getElementById('summon-modal');
        const input = document.getElementById('summon-modal-input');
        const msg = document.getElementById('summon-modal-msg');
        const ok = document.getElementById('btn-summon-ok');
        const cancel = document.getElementById('btn-summon-cancel');
        if (!btn || !modal || !input || !ok || !cancel) return;

        let combo = null;
        const close = () => {
            modal.classList.add('hidden');
            if (msg) msg.textContent = '';
            // ⚠ 候補リストは `document.body` の直下に居る（モーダルの中に入れると
            //    `.modal-content` の縦スクロールに切られる）ので、**モーダルと一緒に消えない**。
            //    閉じるときに明示的に畳まないと、宙に浮いたリストが画面に残る
            if (combo) combo.close();
        };
        const open = () => {
            input.value = '';
            if (msg) msg.textContent = '';
            modal.classList.remove('hidden');
            // 台本の無人再生とテストを固めないよう focus は best-effort
            try { input.focus(); } catch (e) { /* 環境によっては効かない */ }
        };
        // 呼び出しは 🧪自由の仕事（描いた分子を触れる場所）。
        // `leaveGuard` → `setMode('free')` の順は `.mode-tab` の一括配線と同じ形
        btn.addEventListener('click', () => this.leaveGuard('free', () => {
            this.setMode('free');
            open();
        }));

        const 実行 = () => {
            // ⚠ 二重発火よけ。`change` は**フォーカスが外れたときにも飛ぶ**ので、
            //    Enter で閉じた直後の blur がもう一度ここへ来て、同じ分子を2つ呼んでしまう。
            //    「閉じていたら何もしない」で足りる（閉じるのは呼び出しに成功したときだけ）
            if (modal.classList.contains('hidden')) return;
            const name = input.value.trim();
            if (!name) {
                if (msg) msg.textContent = '名前を入れてください。';
                return;
            }
            // ⚠ 引けない名前でモーダルを閉じない。閉じてしまうと、トーストは
            //    キャンバス側に出るのに入力欄は消えていて、打ち直す場所が無くなる
            if (!this.resolveCompound(name)) {
                if (msg) msg.textContent = 'その名称はライブラリにありません。候補から選んでください。';
                return;
            }
            close();
            this.summonMolecule(name);
        };
        ok.addEventListener('mousedown', (e) => e.preventDefault());   // 押す前に blur させない
        ok.addEventListener('click', () => { if (combo) combo.close(); 実行(); });
        cancel.addEventListener('click', close);
        // 候補から選んだ／Enter を押したときも同じ道を通す。
        // ⚠ Enter と ↓↑ / Esc は `attachSummonCombo` が持つ（**ここに keydown を残すと二重に呼ぶ**）。
        //    帯と**同じ仕組み**の候補リストを、同じ `summonNames` から描く（作り方は1箇所）
        input.addEventListener('change', 実行);
        combo = this.attachSummonCombo(input, 実行);
        this.summonModalCombo = combo;
        // ⚠ 背景クリックで閉じる配線は**ここには無い**。この1枚だけが持っていた振る舞いを
        //    20枚へ広げたのが `setupBackdropClose`（§22）で、そこから `btn-summon-cancel` を
        //    押す ＝ 上の `cancel.addEventListener('click', close)` を通って同じ `close()` に着く。
        //    二重に持つと、ドラッグの誤爆よけ（`enableBackdropClose` の②③）がこちらだけ抜ける
    }

    // ライブラリの化合物を名称からキャンバスへ配置する。既存分子の右側の空き位置へ
    // グリッド倍数の平行移動で置く（既存原子は動かさない）。1呼び出し=1 Undo
    summonMolecule(name) {
        // 完全一致だけでなく、主名・別名でも引く（§9.6-10。`エチレン` で `エチレン（エテン）` が出る）
        const entry = this.resolveCompound(name);
        if (!entry) {
            this.showToast('その名称はライブラリにありません。候補から選んでください。');
            return false;
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
                return false;
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
        // ★ ただし全体に合わせると、キャンバスが埋まるほど**呼んだ本人が縮む**（L9）。
        //   視野の中にはあるので「画面外」ではないが、実測で結合1本 13.7px・原子の丸 5px まで
        //   落ちる ＝ どこに出たのか読めない。ユーザーの申し立て「最初は出ず、
        //   スクロールすると急に現れる」はこの状態を指している。
        //   読める大きさを割ったときだけ、**呼んだ分子のほうへ視野を寄せ直す**。
        //   ⚠ 動かすのは見ている場所だけ。原子は1つも動かさない（この関数の不変条件）
        if (this.screenPxPerGrid() < SUMMON_MIN_BOND_PX) this.fitCanvasToMolecule(mol);
        // 別名で呼ばれたときは**ライブラリの表示名**を返す（何が出たのかが分かる）
        this.showToast(`「${entry.name}」を呼び出しました。`, 2500, 'success');
        const input = document.getElementById('summon-input');
        if (input) input.value = '';
        // 出せたかどうかを返す（横断の帯が「まだ収録されていません」と正直に言うために要る・QB）。
        // ⚠ 既存の呼び出し元（🔤 呼出モーダル・作業帯の入力欄）は戻り値を見ていない ＝ 無害
        return true;
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
        // 重原子どうしの結合線には目印の class を付ける。**この class を使うのは
        // `_iupacLiftBondInk` だけ**（主鎖の帯・かけらの光の上でも 2本線が読めるように濃くする。
        // DESIGN_iupac_check.md §3-1 の追記）。自動水素の線（0.15）は対象外なので付けない。
        // ⚠ `.svg-bond-line` という名前は使わない —— style.css に `:hover { stroke-width: 8px }`
        //   の死んだ規則が残っており、名前を合わせるとそれが生き返る
        const ink = (line) => {
            if (!isHConnection) line.setAttribute('class', 'svg-bond-ink');
            this.bondsGroup.appendChild(line);
        };

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
            ink(line);
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
                ink(line);
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
                ink(line);
            });
        }

        // 1.5 「立体が分かれる場所」の結合の印（v1435・段1）。
        //     原子側の印（`*`）と対になるもので、**見た目も同じオレンジ**にそろえる。
        //     中点にリングを1つ置くだけ ＝ 二重結合の2本線の上でも読める
        if (!isHConnection && bondObj && bondObj.isStereoMarked) {
            const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            ring.setAttribute('cx', (sx + ex) / 2);
            ring.setAttribute('cy', (sy + ey) / 2);
            ring.setAttribute('r', '9');
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke', 'var(--neon-orange, #ff9f43)');
            ring.setAttribute('stroke-width', '2');
            ring.setAttribute('class', 'svg-stereo-bond-mark');
            ring.setAttribute('pointer-events', 'none'); // 飾りに入力を受けさせない（v1373 の教訓）
            this.bondsGroup.appendChild(ring);
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
                // **タップに別の意味があるモード中は、判定線は何もせずキャンバスへ流す**
                // （整形・不斉マーク・ハース面・箇所選び・機構再生・番号の表示中）。
                // 一覧は `bondGestureEnabled()` に集約してある ―― ここで分岐を書き足すのではなく
                // あちらに足すこと（見出しの透過と同じ一覧から引くための約束。v1373）
                //
                // ⚠ **流したことを覚えておく**（`_bondToCanvas`）。離すまでにモードが自分で
                // 降りることがある ―― 立体対照の炭素選びは `handlePick` が成功した時点で
                // `picking` を false に戻すので、**click の時刻に聞き直すと「もう普通のモード」**
                // と答えてしまい、選んだ直後に C=C が C≡C へ化けた（v1373 の実測で発覚）。
                // 押した時の判断を最後まで持ち回る
                if (!this.bondGestureEnabled()) { this._bondToCanvas = true; return; }
                this._bondToCanvas = false;
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
                // ⚠ 離す側にも同じ門番が要る。**整形の cis⇄trans 反転は「同じ結合を2回続けてタップ」**
                // ＝ 自前のダブルタップ削除（400ms）とまったく同じ手つきなので、
                // ここを通すと反転しようとした人の C=C が消える
                if (this._bondToCanvas || !this.bondGestureEnabled()) return;
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
                // ⚠ **ここが「無反応」で済まなかった正体**。pointerdown をキャンバスへ流しても、
                // 離したときの click はこの判定線に届く ＝ 整形したそばから次数が上がる
                // （2-ブテンの中点タップで C=C → C≡C。v1373 以前の実測）
                if (this._bondToCanvas || !this.bondGestureEnabled()) { this._bondToCanvas = false; return; }
                if (this._bondClickSkip) { this._bondClickSkip = null; return; } // 削除済み/原子へ転送済み
                if (this.suppressBondClick) return; // 伸縮ドラッグ直後の合成clickでは次数トグルしない
                if (this.selectedTool === 'erase') return; // 消しゴム時は次数トグルしない
                this.handleBondInteraction(bondObj, false); // シングルクリックで次数トグル
            });
            hitLine.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (this._bondToCanvas || !this.bondGestureEnabled()) return; // 反転の2回目が「切断」に化けない
                this.handleBondInteraction(bondObj, true); // ダブルクリックで切断
            });
            hitLine.addEventListener('contextmenu', (e) => {
                e.preventDefault(); // ブラウザの右クリックメニューを抑制
                e.stopPropagation();
                if (!this.bondGestureEnabled()) return;
                this.handleBondInteraction(bondObj, true); // 右クリックで切断
            });
            this.bondsGroup.appendChild(hitLine);
        }
    }

    // 現在組み立てられている分子の検証
    verifyCurrentStructure() {
        const stage = STAGES[this.currentStageIndex];
        const targetMolecule = this.createTargetFromData(stage);
        
        /**
         * ⚠ **結果は必ず `showToast` にも流す**（2026-08-13・ユーザー報告で判明）。
         * `#verify-result` は第5段で右パネルごと **`#panel-legacy` の中の隠しの器**になった
         * （1px・`clip-path: inset(50%)`。style.css の注記）。書いても**誰にも見えない**ので、
         * **押しても無反応にしか見えなかった**——気づけるのは正解のときの勝利モーダルだけで、
         * 「まだ完成していないのに押した」人には何も返っていなかった。
         * 見える経路はキャンバス内の字幕（`#canvas-toast`）だけ。
         * 器のほうは回帰テストと `?rec=` の台本が読むので、**両方に書く**。
         */
        const say = (msg, type, ms) => {
            this.verifyResult.textContent = msg;
            this.verifyResult.className = 'result-message ' +
                (type === 'success' ? 'success' : type === 'error' ? 'error' : 'animate-pulse');
            this.showToast(msg, ms, type === 'success' ? 'success' : 'error');
        };
        this.verifyResult.classList.remove('hidden');
        say('判定中...', 'pending', 1200);

        // 少し遅延を入れて判定（ゲーム的演出）
        setTimeout(() => {
            // 1. 分子トポロジー構造の一致判定
            const isStructureCorrect = verifyMolecule(this.userMolecule, targetMolecule);
            if (!isStructureCorrect) {
                say('不一致です。結合の数や種類、繋がっている原子の順番を確認してください。', 'error', 5000);
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
                    say('分子構造は合っていますが、不斉炭素原子（*）のマーク指定が正しくありません。オレンジの点線でハイライトした炭素を確認してください。', 'error', 6000);
                    return;
                }
            }

            // 3. すべて合格！（メッセージは実際に検証した内容だけを述べる: 開発方針 5章）
            say(this.judgeAsymmetric
                ? '正解です！構造および不斉炭素原子の位置が完全に一致しました！'
                : '正解です！分子構造が完全に一致しました！', 'success', 3000);
            
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
    moleculeModalPart(parts) {
        const list = parts || this.splitMolecules().filter(p => p.atoms.some(a => a.element !== 'H'));
        if (!list.length) return null;
        if (this.focusedMolecule) {
            const hit = list.find(p => p.atoms.some(a => a.id === this.focusedMolecule));
            if (hit) return hit;
        }
        const { marks } = this.markedMolecules(null);
        return list.find(p => marks.has(p)) || list[0];
    }

    /**
     * モーダルが対象にしている1分子の原子ID集合（v1429）。
     * **キャンバスに分子が2つ以上あるときだけ返す**（1つなら絞る相手がいないので `null` ＝ 素通し）。
     *
     * ⚠ これは `reactor.siteFilter()` が「何も選んでいないときの既定」に使う
     *   ＝ ユーザーの実機報告「ブタン酸を見ているのにヨードホルム反応が出て、
     *   押すとケトンが反応する」の直し。**どの分子を見ているかの判定は
     *   `moleculeModalPart()` 1つだけ**にして、見出しの名前・タブ・反応の一覧が必ず同じ分子を指す。
     */
    moleculeModalAtomIds() {
        const parts = this.splitMolecules().filter(p => p.atoms.some(a => a.element !== 'H'));
        if (parts.length < 2) return null;
        const part = this.moleculeModalPart(parts);
        return part ? new Set(part.atoms.map(a => a.id)) : null;
    }

    openMoleculeModal(atomId) {
        const modal = document.getElementById('molecule-modal');
        if (!modal) return;
        // 書き出し練習中は開かない（§12-3。見出しの当たり判定は既に切ってあるが、
        // 右パネルの「🔬 この分子を調べる」など別の入口から来る道も塞ぐ）
        if (this.worksheetActive()) {
            this.showToast('練習中は分子の詳細（名前・異性体）を開けません。書き終えたら「答え合わせ」で確認しましょう。', 3000);
            return;
        }
        if (atomId) this.setFocusedMolecule(atomId);
        if (!this.moleculeModalPart()) {
            this.showToast('先に分子を作図するか、名称から呼び出してください。');
            return;
        }
        // ⚠ **先に出してから中身を組む**（v1420）。反応カードの「もう1つ分子が要る反応」は
        //    総当たりが重いので**開いているときだけ**数える（`reactor.partnerHintsVisible`）。
        //    順番が逆だと、組み立てのときはまだ隠れていて案内が生えない。
        //    開いた時点の分子で組み直すため、ここで `refresh()` を呼び直す
        //    （`refresh()` は作図のたびに走るが、閉じているあいだは案内を作っていない）
        modal.classList.remove('hidden');
        this.renderMoleculeModal();
        if (window.reactor && window.reactor.refresh) window.reactor.refresh();
    }

    closeMoleculeModal() {
        const modal = document.getElementById('molecule-modal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * 右パネルに1つだけ残した「⚗ 反応させる・調べる（反応 N件）」のラベルを更新する
     * （DESIGN_molecule_modal.md §4-2）。
     *
     * 反応ボタン列をモーダルへ移すと、「**-OH を付けた瞬間に『酸化』ボタンが生える**」という
     * 気づきが画面から消える。中身は開かないと分からないままだが、**数が増えたことだけは残す**。
     * 件数は `reactor.refresh()` が数えた「押して進められる反応」で、⚠ の解説カードや
     * 相手の呼び出し案内は含まない（＝ 0件のときは「反応 —」になる）。
     *
     * ⚠ 名札は D2（DESIGN_entry_points.md §10-2）で「🔬 この分子を調べる」から
     * 「⚗ 反応させる・調べる」へ改名した。ユーザーが欲しがった「いま描いている分子が
     * どんな反応をするか」は**このボタンそのもの**なのに、「調べる」が「反応させる」に
     * 読めず届いていなかった、という診断による。
     * ★ **件数で文言を切り替えない**（U3 の案3 は採らない）。探すもののラベルが状態で
     * 変わると、一度覚えた名前で探せなくなる ＝ 変わるのは丸括弧の中の数だけ。
     */
    syncInspectButton() {
        const btn = document.getElementById('btn-molecule-modal');
        if (!btn) return;
        const n = (window.reactor && window.reactor.executableCount) || 0;
        btn.textContent = `⚗ 反応させる・調べる（反応 ${n > 0 ? n + '件' : '—'}）`;
    }

    /* ===== ⇅ 上下に裏返す（分子まるごと・DESIGN_sugar.md §1-2b 帰結3・v1450） =====

       ★ **ユーザーの言い方**（画面の文言はこれに合わせる）:
       > **「上下を入れ替えるように裏返す（カレンダーをめくる）」**

       ⚠ **これは §1-2 の②（y 反転 ＋ たどる向き逆 ＋ 面マークも反転）ただ1つ。**
         平面のハース図で意味を保つ座標操作は②しかない ——
         **左右の鏡映も、面内180°回転（メリーゴーランド）も、鏡像の図になる**ので
         「同じ分子の置き直し」としては出さない（§1-2b の表。出題としてはクイズ側が扱う）。
       ⚠ **動かすのはいつも分子1つぶん全部。**「片方の環だけ」の反転は
         グリコシド結合を切らないと起こせない ＝ 起きえないので復活させない（v1449）。
         ★ したがって `haworthCanvasFlip` は**使わない** —— あれは環が2つある分子には
         **片方の環だけ**を当てる（`haworthFlipPlan` の `ids` がそうなっている）。
         ここで借りるのは `haworthFlipPlan(part).ok` ＝ **門番だけ**（登録 16件に一致・実測）。 */

    /** この分子（連結成分1つ）を分子まるごと裏返せるか（＝ 帯に札を出すか） */
    canFlipWholeHaworth(part) {
        if (!part) return false;
        if (!haworthFlipPlan(part).ok) return false;   // ハース図として読む糖の環があるか
        return canFlipHaworth(part, part.atoms.map(a => a.id));
    }

    /**
     * ★ 分子まるごとの上下フリップ。戻り値 `{ ok, reason }`。
     *
     * ⚠ **軸は覚える。** 折り返した図から重心を計算しなおすと、浮動小数の丸めで
     *   **16/16 とも1回目の座標に戻らない**（実測）。同じ軸をもう一度使えば **16/16 で完全一致**。
     *   覚えた軸を使ってよいのは「前回裏返した直後の図がそのまま残っているとき」だけなので、
     *   **裏返したあとの図の指紋**を一緒に覚えて、食い違ったら軸を取り直す。
     * ⚠ **立体が変わる置き直しは採らない**（`haworthCanvasFlip` の3手目と同じ約束を自分で守る）。
     */
    flipWholeHaworth() {
        const part = this.moleculeModalPart();
        if (!this.canFlipWholeHaworth(part)) return { ok: false, reason: 'gate' };
        const mol = this.userMolecule;
        const ids = part.atoms.map(a => a.id);
        const atoms = ids.map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
        if (atoms.length !== ids.length) return { ok: false, reason: 'gate' };
        const sig = this._haworthFlipSignature(atoms);
        const memo = this._haworthFlipMemo;
        let axisY;
        if (memo && memo.sig === sig) {
            axisY = memo.axisY;                      // ＝ もう一度押した ＝ 厳密な逆操作
        } else {
            const heavy = atoms.filter(a => a.element !== 'H');
            const list = heavy.length ? heavy : atoms;
            axisY = list.reduce((t, a) => t + a.y, 0) / list.length;
        }
        const print0 = this.haworthStereoFingerprint(part);
        const snap = atoms.map(a => ({ a, y: a.y, f: a.haworthFace }));
        this.saveState();
        flipHaworth(mol, ids, axisY);
        // ★ 立体が変わっていないことを確かめてから採る（変わるなら1ピクセルも残さない）
        const after = this.splitMolecules().find(p => p.atoms.some(x => x.id === ids[0]));
        if (!after || this.haworthStereoFingerprint(after) !== print0) {
            snap.forEach(s => { s.a.y = s.y; s.a.haworthFace = s.f; });
            this.history.pop();
            return { ok: false, reason: 'stereo' };
        }
        this._haworthFlipMemo = { sig: this._haworthFlipSignature(atoms), axisY };
        this.updateDrawing();
        return { ok: true, axisY };
    }

    /** 図の指紋（「前回裏返した直後のまま残っているか」を見るためだけのもの） */
    _haworthFlipSignature(atoms) {
        return atoms.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map(a => `${a.id}:${a.x},${a.y},${a.haworthFace || 0}`).join(';');
    }

    /* ===== ⇄ 左右に裏返す・⟳ 180°回す（DESIGN_sugar.md §1-2c・ユーザー発注） =====
     *
     * ★ **ユーザーの言い方**（画面の文言はこれに合わせる）:
     * > **「左右に裏返す（本のページをめくる）」／「180度メリーゴーラウンド回転」**
     *
     * ⚠ **⇅ とどこが違うか**: ⇅ は剛体（分子まるごとを1本の軸で折り返すだけ）。
     *   この2つは **x 鏡映／180°回転のあとに、置換基を付け根の環炭素について上下に付け替える**。
     *   付け替えを外すと**16件すべてが鏡像の図**になる（＝ v1451 の罠そのもの。KV3 が見張る）。
     * ⚠ **札の門番は ⇅ と共有**（`haworthTurnPlan` が `haworthFlipPlan` に相乗り）＝
     *   3つの札は必ず一緒に出入りする。
     * ⚠ **軸を覚えない**のは手抜きではない。軸（ハース糖の環原子の重心）は
     *   この2操作で**不変**なので、取り直しても同じ値になる ＝ 2回押せば1ピクセルの誤差もなく戻る
     *   （実測 16/16。⇅ が `_haworthFlipMemo` を要るのは重原子の重心を軸にしているから）。
     */

    /** この分子（連結成分1つ）を ⇄ / ⟳ で置き直せるか（＝ 帯に札を出すか） */
    canReframeWholeHaworth(part) {
        if (!part) return false;
        if (typeof haworthTurnPlan !== 'function') return false;
        return haworthTurnPlan(part).ok;
    }

    /**
     * ★ 分子まるごとの ⇄（`'leftright'`）／⟳（`'halfturn'`）。戻り値 `{ ok, reason }`。
     * ⚠ **門番は ⇅ と同じ最後の関所**: 当てたあとに図から立体コードを読み直し、
     *   元と食い違ったら**1ピクセルも残さず巻き戻す**（黙って鏡像の図を作らない）。
     */
    reframeWholeHaworth(kind) {
        const part = this.moleculeModalPart();
        if (!this.canReframeWholeHaworth(part)) return { ok: false, reason: 'gate' };
        const plan = haworthTurnPlan(part);
        const mol = this.userMolecule;
        const atoms = plan.ids.map(id => mol.atoms.find(a => a.id === id)).filter(Boolean);
        if (atoms.length !== plan.ids.length) return { ok: false, reason: 'gate' };
        const print0 = this.haworthStereoFingerprint(part);
        const snap = atoms.map(a => ({ a, x: a.x, y: a.y, f: a.haworthFace }));
        this.saveState();
        if (!haworthTurn(mol, plan, kind)) { this.history.pop(); return { ok: false, reason: 'gate' }; }
        const after = this.splitMolecules().find(p => p.atoms.some(x => x.id === plan.ids[0]));
        if (!after || this.haworthStereoFingerprint(after) !== print0) {
            snap.forEach(s => { s.a.x = s.x; s.a.y = s.y; s.a.haworthFace = s.f; });
            this.history.pop();
            return { ok: false, reason: 'stereo' };
        }
        // ⇅ の覚えは無効になる（図が変わったので、次の ⇅ は軸を取り直すのが正しい）
        this._haworthFlipMemo = null;
        this.updateDrawing();
        return { ok: true, axis: plan.axis };
    }

    /**
     * 帯の札の出し入れ（`reactor.syncUndoButton` と同じ流儀・作図のたびに呼ばれる）。
     * ⚠ **自由モードだけ**。パズル中は図を書き換えられるとお題の判定が意味を失う。
     * ⚠ **3つの札（⇅・⇄・⟳）は一緒に出入りする**（門番を共有しているのだから、
     *   片方だけ出ると「この糖は裏返せるのに回せない」という嘘になる）。
     */
    syncHaworthFlipButton() {
        const btn = document.getElementById('btn-flip-updown');
        if (!btn) return false;
        const part = this.moleculeModalPart();
        const free = this.currentMode === 'free';
        const on = free && this.canFlipWholeHaworth(part);
        btn.classList.toggle('hidden', !on);
        const turn = free && this.canReframeWholeHaworth(part);
        ['btn-flip-leftright', 'btn-turn-half'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.classList.toggle('hidden', !turn);
        });
        return on;
    }

    // 見出し（名前・分子式）と、分子が2つ以上あるときの①②③タブを描く
    renderMoleculeModal() {
        const part = this.moleculeModalPart();
        if (!part) return;
        // ⚗ 反応は**自由モードだけ**（第2段）。モーダルの中は `data-modes` の出し分けに
        // 乗せていないので、ここで出し分ける。パズル中に分子を書き換えられると、お題の判定が意味を失う
        const rx = document.getElementById('mm-reaction');
        if (rx) rx.style.display = (this.currentMode === 'free') ? '' : 'none';
        const nameEl = document.getElementById('mm-name');
        const formulaEl = document.getElementById('mm-formula');
        const tabsEl = document.getElementById('mm-tabs');
        // 🔢 のボタンは「いま出ているか」で文言が変わる（入口は2つ・状態は1つ）
        this.syncIupacNumberingButtons();
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

    /* ===== ハース環の置き直し（DESIGN_sugar.md 段4-b・§1-2b。v1450 で作り直した） =====

       ⚠ **「片方の環だけを裏返す」ボタンは置かない。** v1445〜v1446 には分子モーダルに
       「⇅ 五員環を裏返す」という節があったが、v1447 で節ごと外した。理由は 2 行:

       - **分子まるごとの裏返しには意味がある。**「同じ分子を違う向きで描いた図」を見抜くのは
         それ自体が力で、入試の応用問題の型でもある（例: マルトースを上下反転した図を並べて
         正しい図を選ばせる）。⚠ **その土台は残してある** ——
         `haworthCanvasFlip` は環が1つの分子には**分子まるごと**の反転として当たる。
       - ⚠ **二糖の「片方の環だけ」の反転は、グリコシド結合を切らないと起こせない。**
         そして切る操作こそが加水分解である。＝ つながったままの二糖に対して
         片方だけ裏返すボタンは、**起きえないことを押させていた**。

       したがってキャンバスで図が置き直されるのは**加水分解の瞬間だけ**（下の
       `redrawProductsAsStandalone`）で、そこで動くのは**切り離されて1分子になった単糖**
       ＝ やはり「分子まるごと」である。

       ⚠ **v1447 は「たどる向き」だけを直していた（`restoreHaworthOrientation`）。足りなかった。**
       向きをそろえても**環の O の位置まではそろわない**ので、ユーザーから
       「上下逆に見える」と報告が出た。v1450 で**図そのものを写す**形（乙案）に替えた。 */

    /** 立体まで込みの指紋（置き直しの前後で「同じ分子のまま」かを確かめるのに使う） */
    haworthStereoFingerprint(mol) {
        return canonicalCode(mol) + '|' + canonicalStereoCode(mol, {
            atomParity: { ...readAtomParityFromFischer(mol), ...readRingParityFromHaworth(mol) },
            bondGeo: readBondGeoFromCoords(mol)
        });
    }

    /**
     * ★ この断片（連結成分1つ）を**その分子を単独で描くときの図**へ写す対応を返す。
     *   引けなければ `null`（＝ 触らない）。
     *
     * 「単独で描くときの図」はライブラリの作図から取ってくる（`getCompoundLibrary`）。
     * ⚠ **これは目的ではなく手段。** 目的は下の `redrawProductsAsStandalone` にある
     *   「加水分解の前後で分子の形を対応させる」で、**その対応先を "単独で描いたときの図" に
     *   取っている**、という関係。ここを目的だと読むと「図の整形機能」に化けて、
     *   加水分解と切り離して呼ばれるようになる。
     * ⚠ **名前の文字列では引かない。** `lookupCompoundName` は「〜ほか N 種 のどれか」を
     *   返すことがあり、そこから作図は取れない。**言い切れる（候補が1件に絞れる）ときだけ**
     *   採るので、ここでは構造と立体コードで直に引く。
     * ⚠ **「立体を名前に反映する」トグルには依らない。** 図の描き方は名前の出し方とは別の軸。
     * ⚠ **原子IDに順序を頼らない**（IDは乱数・DEVELOPMENT.md の既知の地雷）。対応づけは
     *   **立体込みの同型写像**（`stereoIsomorphismCompare`）で取り、
     *   読めた立体中心が**全部一致する写像**でなければ採らない。
     *
     * 戻り値 `{ name, spots }` … `spots` は 断片のatomId → 単独の図の原子。
     */
    standaloneDrawingOf(part) {
        // 明示の H は同型写像（重原子だけ）に乗らないので写せない ＝ 触らない
        if (part.atoms.some(a => a.element === 'H')) return null;
        this.getCompoundLibrary(); // コードMapの構築を保証
        const stereoOf = m => ({
            atomParity: { ...readAtomParityFromFischer(m), ...readRingParityFromHaworth(m) },
            bondGeo: readBondGeoFromCoords(m)
        });
        const st = stereoOf(part);
        const code = canonicalStereoCode(part, st);
        const hits = (this._compoundCodeMap.get(canonicalCode(part)) || [])
            .filter(e => e.stereoCode && e.stereoCode === code && verifyMolecule(part, e.mol));
        if (hits.length !== 1) return null;  // 言い切れないなら触らない
        const entry = hits[0];
        if (entry.mol.atoms.some(a => a.element === 'H')) return null;
        const cmp = stereoIsomorphismCompare(part, st, entry.mol, stereoOf(entry.mol));
        if (!cmp || !cmp.total || cmp.matched !== cmp.total) return null;
        const spots = new Map();
        for (const a of part.atoms) {
            const t = entry.mol.atoms.find(x => x.id === cmp.map[a.id]);
            if (!t) return null;             // 写せない原子が1つでもあれば採らない
            spots.set(a.id, t);
        }
        // ⚠ 結合次数まで対応していることを確かめる。同型写像はベンゼン環の結合を
        //   芳香族に正規化して比べるので、**ケクレの位相が入れ替わった写像**もありうる
        //   （糖では起きないが、ここは「図をまるごと写す」ので位相が変わると別の絵になる）
        for (const b of part.bonds) {
            const t = entry.mol.getBond(spots.get(b.atomId1).id, spots.get(b.atomId2).id);
            if (!t || t.type !== b.type) return null;
        }
        return { name: entry.name, spots };
    }

    /**
     * ★ **何のためにあるか**（ユーザーの言葉・2026-08-22／2026-08-24 の検収条件）:
     *   **「フリップするのは加水分解前後の分子の形に対応するためです」**
     *   **「スクロースの加水分解は、反応前後の分子の表示が、どちらも教科書の図になるように」**
     *
     * 二糖の中では、片方の環は相手とつながる都合で**単独で描くときと違う形**に描かれている
     * （教科書のスクロースのフルクトース環がその代表）。切って1分子になった瞬間その理由は
     * 消えるので、**切り離された単糖を「その分子を単独で描くときの図」で描き直す**
     * ＝ 切る前の図と切ったあとの図が、同じものを指していると読める。
     *
     * ⚠ **向き（たどる向き）だけを直すのでは足りない**（v1447 の `restoreHaworthOrientation`
     *   がそれで、ユーザーから「上下逆に見える」と報告が出た。`DESIGN_sugar.md` §1-2b 帰結2）。
     *   向きをそろえても**環の O の位置まではそろわない**ので、図はまだ教科書と違う。
     *   **図そのものを写す**（乙案）と、検収条件を構成的に満たせる。
     * ⚠ **位置は保つ** —— 写すのは形だけで、置き場所は断片の重心のまま
     *   （＝ 単独の図と**平行移動を除いて完全一致**する）。重なったら呼び出し側の
     *   逃がし方（`opt.escape`）で平行移動だけ足す。
     *
     * ⚠ **加水分解のときだけ呼ぶこと。** 作図のたびに呼ぶと、
     *   ユーザーが自分で置いた図をアプリが勝手に描き直す（前後の対応とは無関係な書き換え）。
     * ⚠ **分子の名前で分岐しない**（スクロース名指しのハードコードを置かない）。
     * ⚠ **名前が引けない断片は触らない**（`standaloneDrawingOf` が `null` を返す）。
     * ⚠ **立体が変わる描き直しは1つも採らない**（写しの上で指紋を突き合わせてから本物へ移す）。
     *
     * `opt.escape(mol, ids)` … 逃がし方（`{dx,dy}` か `null` を返す）。省くと逃がさない。
     * `opt.overlaps(mol, ids)` … 重なっているか（省くと横方向の押し広げをしない）。
     *   ⚠ **`escape` と同じ物差しのものを渡すこと**（別々に持つと、並べた図を逃がす側が飛ばす）。
     * `opt.alignRow` … 生成物2つを**横一列にそろえる**（`alignRedrawnProductsInRow`）。
     *   ⚠ **既定は「そろえない」。** そろえるのは加水分解の生成物だけで、
     *   一般の反応配置（`planAttachment` などの置き場所）には手を出さない。
     *
     * 戻り値は**あとで前後の対応をアニメーションにする人のための材料**（描き直さなければ空配列）:
     *   `[{ ids, name, reshaped, before: [{id,x,y}...], after: [{id,x,y}...] }]`
     *   —— `before` と `after` は**同じ順序・同じ長さ**なので、そのまま補間できる。
     *   `reshaped` は「平行移動だけでは重ならなかった」＝ 形が変わったかどうか。
     */
    redrawProductsAsStandalone(opt) {
        opt = opt || {};
        const plans = [];
        this.splitMolecules().filter(p => p.atoms.some(a => a.element !== 'H')).forEach(part => {
            const drawing = this.standaloneDrawingOf(part);
            if (!drawing) return;
            const print0 = this.haworthStereoFingerprint(part);
            const before = part.atoms.map(a => ({ id: a.id, x: a.x, y: a.y }));
            // 位置は保つ ＝ 単独の図に**重心を合わせる平行移動**だけを足す
            const n = part.atoms.length;
            const cx = before.reduce((t, p) => t + p.x, 0) / n;
            const cy = before.reduce((t, p) => t + p.y, 0) / n;
            let tx = 0, ty = 0;
            part.atoms.forEach(a => { const t = drawing.spots.get(a.id); tx += t.x; ty += t.y; });
            tx = cx - tx / n; ty = cy - ty / n;
            let moved = 0;
            part.atoms.forEach(a => {
                const t = drawing.spots.get(a.id);
                const nx = t.x + tx, ny = t.y + ty;
                const b = before.find(p => p.id === a.id);
                moved = Math.max(moved, Math.hypot(nx - b.x, ny - b.y));
                a.x = nx; a.y = ny;
                // ⚠ 面マークも図の一部（座標より優先されるので、置いてきぼりにすると
                //   その1中心だけ鏡像になる。`DESIGN_sugar.md` §1-3 の地雷）
                if (t.haworthFace === 1 || t.haworthFace === -1) a.haworthFace = t.haworthFace;
                else delete a.haworthFace;
            });
            // ★ 判断は写し（part）の上で終わらせる。採らないときは本物に1ピクセルも触れていない
            if (this.haworthStereoFingerprint(part) !== print0) return;
            plans.push({ part, name: drawing.name, before, reshaped: moved > 0.001 });
        });
        if (!plans.length) return [];
        // --- ここから本物へ写す ---
        plans.forEach(({ part }) => part.atoms.forEach(p => {
            const a = this.userMolecule.atoms.find(x => x.id === p.id);
            if (!a) return;
            a.x = p.x; a.y = p.y;
            if (p.haworthFace === 1 || p.haworthFace === -1) a.haworthFace = p.haworthFace;
            else delete a.haworthFace;
        }));
        // ★ 生成物を横一列にそろえる（平行移動だけ。頼まれたときだけ ＝ 加水分解の経路だけ）。
        // ⚠ 重なりの物差しは**このあと逃がす側と同じもの**を渡す（`opt.overlaps`）
        if (opt.alignRow) this.alignRedrawnProductsInRow(plans, opt.overlaps &&
            (ids => opt.overlaps(this.userMolecule, ids)));
        // 重なったら逃がす（平行移動だけなので、図は単独の図と一致したまま）
        if (opt.escape) plans.forEach(({ part }) => {
            const ids = part.atoms.map(a => a.id);
            const sep = opt.escape(this.userMolecule, ids);
            if (!sep) return;
            ids.forEach(id => {
                const a = this.userMolecule.atoms.find(x => x.id === id);
                if (a) { a.x += sep.dx; a.y += sep.dy; }
            });
        });
        return plans.map(({ part, name, before, reshaped }) => ({
            ids: part.atoms.map(a => a.id),
            name, reshaped, before,
            after: part.atoms.map(a => {
                const real = this.userMolecule.atoms.find(x => x.id === a.id);
                return { id: a.id, x: real ? real.x : a.x, y: real ? real.y : a.y };
            })
        }));
    }

    /**
     * ★ 描き直した生成物2つを**横一列にそろえる**（`DESIGN_sugar.md` §4-9d）。
     *
     * **ユーザーの言葉**（2026-08-25・v1452 の実機確認後）:
     * > **「加水分解後に、フルクトース分子がグルコース分子の横に並ぶ方がよいです」**
     *
     * v1452 の描き直しは**各断片の重心を保つ**ので、生成物の置き場所は
     * 「切る前にその断片があった場所」のまま。ところが切るときの引き離し
     * （`separateComponent`）は**真下へ 2 マス**動かすので、実測で**環中心の y が
     * 245〜272px ずれる**（＝ 斜め下に落ちて見える）。横には並んでいなかった。
     *
     * ⚠ **やるのは平行移動だけ。** 描き直した図の中身（形・向き・面マーク）には
     *   1ピクセルも触らない ＝ 教科書の図のまま。だから SG18 の
     *   「単独の図と平行移動を除いて完全一致」はそのまま緑で両立する。
     * ⚠ **左右の順は切る前のまま**（左にあった断片が左）。並べ替えると
     *   「グリコシド結合のどちら側だったか」が読めなくなる。
     * ⚠ **高さの基準は2断片の中間**（片方だけを動かさない）＝ **全体の重心が動かない**。
     * ⚠ **横は「重ならない最小の平行移動」だけ**。足りていれば 0。
     *   図が飛ぶのがいちばん読みにくいので、間隔をそろえに行かない。
     * ⚠ **重なりの物差しは自分で持たない** —— `overlaps(ids)` を呼び出し側からもらう
     *   （加水分解なら `componentOverlaps` ＝ **このあと逃がす側と同じ物差し**）。
     *   ここで別の物差しを持つと「並べたのに、逃がす側は重なっていると言って
     *   真下へ 2 マス飛ばす」が起きる（v1453 の実装中に実際に起きた:
     *   矩形の隙間 68.8px を「空いている」と見たが、逃がす側の閾値は 71.5px だった）。
     * ⚠ **キャンバスに他の分子がいるときは触らない。** そろえた先で三者目と
     *   衝突しうるが、その解決は「並べる」の仕事ではない（加水分解の生成物2つだけの話）。
     * ⚠ **押し広げても重なりが解けないなら、動かす前に戻す**（並べ損なうより、
     *   図が飛ばないほうがよい ＝ そのときは従来どおり逃がす側に任せる）。
     *
     * 戻り値は実際に当てた平行移動（当てなければ `null`）。
     */
    alignRedrawnProductsInRow(plans, overlaps) {
        if (!plans || plans.length !== 2) return null;
        if (typeof haworthSugarCycles !== 'function') return null;
        const mol = this.userMolecule;
        // キャンバスに他の分子がいるなら触らない
        if (this.splitMolecules().filter(p => p.atoms.some(a => a.element !== 'H')).length !== 2) return null;
        const info = plans.map(({ part }) => {
            let cycles;
            try { cycles = haworthSugarCycles(part); } catch (e) { return null; }
            if (cycles.length !== 1) return null;        // ハース図の環がちょうど1つの断片だけ
            const ring = cycles[0].map(id => mol.atoms.find(a => a.id === id));
            if (ring.some(a => !a)) return null;
            return {
                ids: part.atoms.map(a => a.id).filter(id => mol.atoms.some(a => a.id === id)),
                cx: ring.reduce((t, a) => t + a.x, 0) / ring.length,
                cy: ring.reduce((t, a) => t + a.y, 0) / ring.length
            };
        });
        if (info.some(x => !x || !x.ids.length)) return null;
        const [L, R] = info.slice().sort((a, b) => a.cx - b.cx);   // 左右の順はそのまま
        const undo = mol.atoms.map(a => ({ a, x: a.x, y: a.y }));
        const shift = (part, dx, dy) => part.ids.forEach(id => {
            const a = mol.atoms.find(x => x.id === id);
            if (a) { a.x += dx; a.y += dy; }
        });
        // 高さ: 環中心の y を2つの中間へ（移動量は打ち消し合う ＝ 全体の重心は動かない）
        const midY = (L.cy + R.cy) / 2;
        let dyL = midY - L.cy, dyR = midY - R.cy, push = 0;
        shift(L, 0, dyL); shift(R, 0, dyR);
        // 横: 重なっているあいだだけ、少しずつ半分ずつ外へ（＝ 重ならない最小の平行移動）
        if (typeof overlaps === 'function') {
            const STEP = GRID_SIZE / 4, LIMIT = GRID_SIZE * 3;
            while (overlaps(L.ids) || overlaps(R.ids)) {
                if (push >= LIMIT) {                     // 解けない ＝ 動かす前に戻す
                    undo.forEach(s => { s.a.x = s.x; s.a.y = s.y; });
                    return null;
                }
                shift(L, -STEP / 2, 0); shift(R, STEP / 2, 0);
                push += STEP;
            }
        }
        return { dyL, dyR, push, ringGapX: (R.cx - L.cx) + push };
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
        // 🔢 命名の確認（DESIGN_iupac_check.md N2）。**入口は2つ・状態は1つ**。
        // モーダル側は下の捕獲フェーズが画面を閉じてくれるので、ここは切り替えるだけでよい
        ['btn-iupac-numbering', 'mm-btn-iupac-numbering'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', () => this.toggleIupacNumbering());
        });
        // ⇅ 上下に裏返す（帯の札。DESIGN_sugar.md §1-2b 帰結3）。
        // ⚠ 入口は帯の1つだけ ＝ モーダルには置かない（§6-2a の実測で下は画面の外）
        const flipBtn = document.getElementById('btn-flip-updown');
        if (flipBtn) flipBtn.addEventListener('click', () => {
            const r = this.flipWholeHaworth();
            if (!r.ok) this.showToast('この分子は上下に裏返せません（ハース図の糖の環がある分子だけです）');
        });
        // ⇄ 左右に裏返す・⟳ 180°回す（DESIGN_sugar.md §1-2c）。⇅ と同じ帯・同じ門番
        [['btn-flip-leftright', 'leftright', '左右に裏返せません'],
         ['btn-turn-half', 'halfturn', '180°回せません']].forEach(([id, kind, ng]) => {
            const b = document.getElementById(id);
            if (b) b.addEventListener('click', () => {
                const r = this.reframeWholeHaworth(kind);
                if (!r.ok) this.showToast(`この分子は${ng}（ハース図の糖の環がある分子だけです）`);
            });
        });
        // **子を開くときは自分を閉じる**（DESIGN_molecule_modal.md §5-5）。
        // 14枚のモーダルはすべて z-index:1000 で、重ねると ✕ が2つ並ぶ絵になる。
        // ここを**捕獲フェーズ**で受けるのは、ボタン自身に付いた「開く」処理より先に
        // 走らせるため（同じ要素に付けた listener は登録順に走るので、あちらには勝てない）。
        // タブ（分子の切替）と閉じるボタンは、この画面に留まるので対象外。
        //
        // **第2段の反応ボタン列もこの1本で面倒を見る**（§2-5・§5-3）。
        // 適用箇所の選択（narrow）・実行のモーフィング・前後比較オーバーレイは
        // **すべてキャンバスの上**で起きるので、全画面のモーダルが乗ったままだと1つも見えない。
        // 「🎯 反応させる分子を選ぶ」も同じで、選ぶ相手はキャンバスにいる。
        //
        // ⚠ **試薬の瓶（#mm-reagents）だけはこの一括処理から外す**（第3段・
        // `DESIGN_reagent_palette.md` §4.3 と `DESIGN_molecule_modal.md` §5-3）。
        // 瓶は押しても反応が起きるとは限らず、**空振りのときは分子が1原子も変わらない**ので
        // 閉じる理由がない（閉じてしまうと「効きません」の説明が出た瞬間に消える）。
        // 条件を選ぶ画面も同じ節の中に出るため、節ごと除外する。
        // **閉じるかどうかは reactor.runReagentHit が反応が進むときだけ自分で決める**
        // ⚠ **「＋ ◯◯ を呼び出す → 反応」の札もこの一括処理から外す**（v1420）。
        // この札は**途中で止まることがある**（相手を呼び出せない・呼べても箇所が生えない）。
        // 一律に閉じると、止まった理由を出した画面ごと消えて
        // 「押したのに何も起きない」＝ 直そうとしていた症状そのものに戻る。
        // **通ったときに閉じるのは `reactor.runPartnerHint` の仕事**（箇所選びも実行も
        // キャンバスの上で起きるので、進むときは1箇所でも複数箇所でも必ず閉じる）。
        // 目印は `data-partner`（札を作る `makePartnerHintButton` が1か所で付ける）。
        // ⚠ **行き止まりの掲示板（`#rx-deadend`）も節ごと外す**（v1420）。
        //    「うまくいかない、と知らせる」を押すと、クリップボードが使えない環境では
        //    **その場に本文を出して選んでもらう**。閉じてしまうと逃げ道が出た瞬間に消える
        //    ＝ 行き止まりを知らせる道そのものが行き止まりになる（実測で起きた）
        modal.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('button');
            if (!btn || btn === close || btn.closest('#mm-tabs') || btn.closest('#mm-reagents') ||
                btn.closest('#rx-deadend') || btn.dataset.partner) return;
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
    /**
     * ★ 答案の枠（DESIGN_isomer_practice.md §14-4）。
     *
     * 付け根（ロックした R を含む成分）を薄い破線で囲い、**罫線が引いてある答案用紙**に見せる。
     * §14-4 の決定は「**トーストを増やす方向へ行かない。見た目を強くする**」——
     * ロック原子はタップすれば案内が出るが、触ったあとに叱るより触る前に分かるほうが良い。
     *
     * ⚠ 囲うのは「C1–R の2原子」ではなく**その成分ぜんぶ**。枠は答案1枚の輪郭なので、
     *   炭素を伸ばしたら一緒に育たないと「枠の外に答案がはみ出す」絵になる。
     * ⚠ **表示だけ**（`atomsGroup` に描いて次の更新で消える）。作図データには触らない
     */
    renderAnswerSlotFrames(hidden) {
        const ak = window.alkylPractice;
        if (!ak || !ak.active || !ak.problem) return;
        const NS = 'http://www.w3.org/2000/svg';
        this.splitMolecules().forEach(part => {
            if (!part.atoms.some(a => a.element === 'R' && a.isLocked)) return;
            const atoms = part.atoms.filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id)));
            if (!atoms.length) return;
            const pad = 26;
            const x1 = Math.min(...atoms.map(a => a.x)) - pad;
            const x2 = Math.max(...atoms.map(a => a.x)) + pad;
            const y1 = Math.min(...atoms.map(a => a.y)) - pad;
            // 図の下には ① の欄外番号が出るので、それも枠の中へ入れる
            const y2 = Math.max(...atoms.map(a => a.y)) + this.labelExtent() + 6;
            const r = document.createElementNS(NS, 'rect');
            r.setAttribute('x', x1); r.setAttribute('y', y1);
            r.setAttribute('width', x2 - x1); r.setAttribute('height', y2 - y1);
            r.setAttribute('rx', '12');
            r.setAttribute('fill', 'none');
            r.setAttribute('stroke', 'var(--color-cyan, #00f2fe)');
            r.setAttribute('stroke-width', '1.5');
            r.setAttribute('stroke-dasharray', '7,7');
            r.setAttribute('opacity', '0.32');
            r.setAttribute('pointer-events', 'none');
            r.setAttribute('class', 'ak-slot-frame');
            this.atomsGroup.appendChild(r);
        });
    }

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
        let x1 = Math.min(...atoms.map(a => a.x)) - pad;
        let x2 = Math.max(...atoms.map(a => a.x)) + pad;
        let y1 = Math.min(...atoms.map(a => a.y)) - pad;
        // 図の下には 🔍①名前 の見出しが出るので、それを枠の中へ入れる
        // （張り出しは labelExtent が1か所で決める。DESIGN_molecule_modal.md 第1段）
        let y2 = Math.max(...atoms.map(a => a.y)) + this.labelExtent() + 6;
        // 見出しが重なり回避で段送りされていたら、実際に置いた矩形で囲み直す（§12）
        const lr = this.labelRectFor(new Set(info.part.atoms.map(a => a.id)));
        if (lr) {
            x1 = Math.min(x1, lr.x - 6); x2 = Math.max(x2, lr.x + lr.w + 6);
            y1 = Math.min(y1, lr.y - 6); y2 = Math.max(y2, lr.y + lr.h + 6);
        }
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
            let x1 = Math.min(...atoms.map(a => a.x)) - pad;
            let x2 = Math.max(...atoms.map(a => a.x)) + pad;
            let y1 = Math.min(...atoms.map(a => a.y)) - pad;
            // 図の下には「🔍 ① 酢酸」の見出しが出るので、それを枠の中へ入れる
            // （張り出しは labelExtent が1か所で決める。DESIGN_molecule_modal.md 第1段）
            let y2 = Math.max(...atoms.map(a => a.y)) + this.labelExtent() + 12;
            // 見出しが重なり回避で段送りされていたら、実際に置いた矩形で囲み直す（§12）
            const lr = this.labelRectFor(ids);
            if (lr) {
                x1 = Math.min(x1, lr.x - 6); x2 = Math.max(x2, lr.x + lr.w + 6);
                y1 = Math.min(y1, lr.y - 6); y2 = Math.max(y2, lr.y + lr.h + 6);
            }
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

    /* ===== 命名の確認（主鎖の帯と炭素番号）— DESIGN_iupac_check.md N2 =====
     *
     * ★ **門番は1行**（同書 §N-4）:
     *     主鎖と番号を描いてよいのは `iupacNameDetail(mol)` が非 null を返したときだけで、
     *     描くのは**それが返したものだけ**。
     *   新しい対応範囲リストはここに作らない —— 作れば `iupacName` の実装と二重管理になり、
     *   片方だけ伸びた日に「名前は出るのに番号が出ない（逆も）」が黙って生まれる。
     *   この1行のおかげで、環・芳香族・カルボニル・エノール形・不飽和エーテル・
     *   分岐ポリオール・ヘテロ原子・**複数分子**が自動的に番号なしになる（IN3 が見張る）。
     *
     * ★ **主鎖は帯（線）で示す。丸で囲む `highlightAtoms` は使わない**（同書 §3-1）。
     *   丸は「この原子が問題」の語彙（不斉・エラー箇所）で既に埋まっている。主鎖は「この道」。
     */

    /**
     * いま描いてある図の指紋。**状態を残さない**ための唯一の道具（§3）。
     * これが変われば主鎖も番号も消す ＝「描き替えたら消える」。
     * 見え方（拡大率・パン）は含めない ＝ 図が同じなら動かしても消えない。
     */
    _iupacNumberingSignature() {
        const m = this.userMolecule;
        return m.atoms.map(a => `${a.id}:${a.element}:${Math.round(a.x)}:${Math.round(a.y)}`).sort().join(',') +
            '|' + m.bonds.map(b => `${b.atomId1}-${b.atomId2}:${b.type}`).sort().join(',');
    }

    /** 書き出しの最中は出さない（DESIGN_isomer_practice.md §13 の面の分け方）。主鎖と番号は答えの一部 */
    _iupacNumberingBlockedByPractice() {
        if (this.worksheetActive()) return true;
        return !!(window.alkylPractice && window.alkylPractice.active);
    }

    /**
     * ★ 門番。キャンバスの図について「描いてよいもの」を**1回の計算から**取り出す。
     *
     * 返すのは `iupacNameDetail`（付け根 R があれば `iupacAlkylDetailFromR`）が返したものだけで、
     * ここで鎖を選び直したり最長鎖を計算し直したりは**しない**。
     * `findLongestCarbonChain` は IUPAC の主鎖ではない（実測 84件中 16件が食い違い、
     * うち14件は炭素数が同じ）ので、ここから呼んではいけない —— IN2 が名指しで見張っている。
     *
     * @returns null | { kind:'chain', chain, name }
     *              | { kind:'alkyl', chain, name, systematic }
     *              | { kind:'ether', groups, name }
     */
    iupacNumberingDetail() {
        const mol = this.userMolecule;
        if (!mol || !mol.atoms.some(a => a.element !== 'H')) return null;
        // 付け根マーカー R が付いていればアルキル基として読む（§4）。
        // **付け根が必ず C1** で、向きを選ぶ余地が無い ＝ 主鎖の場合より単純
        if (mol.atoms.some(a => a.element === 'R')) {
            if (typeof iupacAlkylDetailFromR !== 'function') return null;
            const d = iupacAlkylDetailFromR(mol);
            if (!d || !d.mainChain || !d.mainChain.length) return null;
            return { kind: 'alkyl', chain: d.mainChain, name: d.name, systematic: d.systematic || d.name };
        }
        if (typeof iupacNameDetail !== 'function') return null;
        const d = iupacNameDetail(mol);
        // ★ 糖（ハース図）は `iupacNameDetail` が null を返すところ ＝ **いままで何も出なかった面**
        //   にだけ相乗りする（§N-7）。糖でない分子の 🔢 はここから先で1ピクセルも変わらない
        if (!d) return this.sugarNumberingDetail(mol);
        // エーテルは**主鎖に番号をつけない**（未対応ではなく規則そのもの。§N-5）
        if (d.kind === 'ether') return d.groups && d.groups.length === 2
            ? { kind: 'ether', groups: d.groups, name: d.name, parts: d.nameParts } : null;
        if (d.kind !== 'chain' || !d.mainChain || !d.mainChain.length) return null;
        // parts / locants / dirReason は「名称の説明」（設計回 E）が使う。
        // ⚠ **ここでも新しい計算はしない。**門番が持ち出すのは `iupacNameDetail` が返したものだけ
        return { kind: 'chain', chain: d.mainChain, name: d.name,
            parts: d.nameParts, locants: d.locants, dirReason: d.dirReason };
    }

    /**
     * ★ 糖（ハース図）の炭素番号（`DESIGN_iupac_check.md` §N-7・ユーザー発注 2026-08-25）。
     *
     * ⚠ **新しい面は作らない。** 🔢 の帯・添え字・字幕をそのまま使い、
     *   `iupacNameDetail` が null を返す分子（＝ いままで「環が基本骨格です」と断っていた面）に
     *   **糖のときだけ**乗る。糖でない分子の 🔢 の見た目は1ピクセルも変わらない。
     *
     * ★ **帯（鎖に沿う色）は出さない**（ユーザー決定 2026-08-25「帯は不要です」）。
     *   帯の語彙は「この道が主鎖 ＝ 名前の骨格」で、糖の番号は主鎖の選び方から出ていない
     *   （環の酸素の隣を C1 と決める別の規則）。引くと「この鎖から名前が出た」という嘘になる。
     *   ⚠ 環に沿わせる案も採らない —— 環内の O には番号が無いので、帯と番号が食い違う。
     *
     * ⚠ **分子が2つ以上なら出さない**（既存の 'multi' の言い分けをそのまま通す）。
     *
     * @returns null | { kind:'sugar', labels:Map(atomId→'1'/'1′'), name, note, rings }
     */
    sugarNumberingDetail(mol) {
        if (typeof haworthCarbonNumbers !== 'function') return null;
        if (this.countMolecules() !== 1) return null;
        const r = haworthCarbonNumbers(mol);
        if (!r.ok || !r.labels.size) return null;
        const 二糖 = r.rings.length === 2;
        const ketose = r.rings.some(g => g.ketose);
        const note = 二糖
            ? '糖の番号は環ごとに振り、片方に ′ を付けます（つないだ相手の側）。起点は環の酸素の隣＝アノマー炭素です。'
            : `環の酸素の隣（アノマー炭素）が C${r.rings[0].anomerNumber} です` +
              (ketose ? '（ケトースなので、その上の -CH₂OH が C1）。' : '。') +
              '環の酸素には番号を振りません。';
        return { kind: 'sugar', labels: r.labels, rings: r.rings,
                 name: this.lookupCompoundName(mol) || this.computeMolecularFormula(mol), note };
    }

    /** 表示中か（帯・番号を出しているあいだは作図を止める。§3-1） */
    iupacNumberingActive() { return !!this.iupacNumbering; }

    /**
     * 表示の入切。**主鎖も番号も覚えない** ＝ 描くたびに同じ1回の計算から取り直す。
     * `part` は「名称の説明」で押されているかけらの添字だけ（かけらの中身は覚えない）。
     */
    setIupacNumbering(on) {
        this.iupacNumbering = on ? { sig: this._iupacNumberingSignature(), part: null } : null;
        this.syncIupacNumberingButtons();
        this.updateDrawing();
    }

    /**
     * ★ 言い分け（DESIGN_iupac_check.md §N-5）。**この図に何と言うか**を1か所で決める。
     *
     * 門番（`iupacNumberingDetail`）は「出す／出さない」しか答えない。それをそのまま画面に
     * 流すと「出せません」の一語になり、**なぜ出ないのか**が生徒に伝わらない ——
     * とくに困るのが**エーテル**で、あれは未対応ではなく「主鎖に番号をつけない」という
     * **規則そのもの**（標準6問の23件中4件・C₄H₁₀O は7種中3種がエーテル）。
     * ここで「未対応です」と言うと、主力問題の半分弱で機能が消えたように見える。
     * `aromaticOnly` の回で「開発ログに記録しました」を生徒に見せた失敗と同じ轍
     * （DESIGN_isomer_practice.md §11-4・BZ5）。**正しく描けた人に不具合の顔を見せない。**
     *
     * ⚠ **門番はここで緩めない。** 分けるのは**言い方だけ**で、出せないものは出さないまま
     *   （`ok:false` の回は `setIupacNumbering(true)` を呼ばない ＝ IN3 が見張る）。
     * ⚠ **理由の一覧をここで新しく作らない。** `code` は
     *   「門番が断ったあとに、その分子を見て分かること」だけで決める ＝
     *   `iupacName` の対応範囲リストの二重管理にはならない（§N-4）。
     *
     * @returns { code, ok, message, det } — code は
     *   'chain' | 'alkyl' | 'ether'（出せる）／
     *   'empty' | 'practice' | 'multi' | 'ring' | 'unsupported'（出せない）
     */
    iupacNumberingNotice() {
        const mol = this.userMolecule;
        if (!mol || !mol.atoms.some(a => a.element !== 'H')) {
            return { code: 'empty', ok: false, det: null,
                message: 'キャンバスに分子がありません。分子を描くか「🔤 名前から呼び出す」で呼び出してから押してください。' };
        }
        // 書き出しの最中は「出せない」ではなく「いまは出さない」（答えの一部・§13 の面の分け方）
        if (this._iupacNumberingBlockedByPractice()) {
            return { code: 'practice', ok: false, det: null,
                message: '練習中は主鎖と番号を出せません（答えの一部になるため）。書き終えたら「答え合わせ」で確認しましょう。' };
        }
        const det = this.iupacNumberingDetail();
        if (det && det.kind === 'ether') {
            // ★ 未対応の言い訳ではなく**規則**。だから「まだ扱いません」と言ってはいけない
            const gs = det.groups.map(g => g.name).join(' と ');
            return { code: 'ether', ok: true, det,
                message: `エーテルは主鎖に番号をつけません。両側のアルキル基（${gs}）の名前で呼びます。` };
        }
        if (det && det.kind === 'sugar') {
            // ★ 未対応の言い訳ではなく**別の規則**。「環はまだ扱いません」と言ってはいけない
            //   （糖の番号は主鎖の選び方ではなく、環の酸素の隣を起点にする決まりで振る）
            return { code: 'sugar', ok: true, det,
                message: `ハース投影の炭素番号を出しました（${det.name}）。${det.note}表示中は作図できません（もう一度押すと消えます）。` };
        }
        if (det && det.kind === 'alkyl') {
            // 付け根 R が必ず C1（§4）。向きを選ぶ余地が無いことを言い切る
            return { code: 'alkyl', ok: true, det,
                message: `アルキル基として読みました。付け根（R）が C1 です ＝ ${det.systematic}。もう一度押すと消えます。` };
        }
        if (det) {
            // N-6: 番号を生んだ名前を、断り文のほうにも書いておく（帯の見出しと同じ名前）
            return { code: 'chain', ok: true, det,
                message: `主鎖と番号を出しました（${det.name}）。表示中は作図できません（もう一度押すと消えます）。` };
        }
        // ===== ここから「出せない」の言い分け =====
        // 順番は**手当ての近さ**で決める。分子を1つにするのがいちばん早い手当てなので先に見る
        const n = this.countMolecules();
        if (n >= 2) {
            return { code: 'multi', ok: false, det: null,
                message: `キャンバスに分子が${n}つあります。主鎖と番号は1つの分子について決まるので、1つだけにしてから押してください。` };
        }
        if (typeof findAnyCycle === 'function' && findAnyCycle(mol)) {
            return { code: 'ring', ok: false, det: null,
                message: '環が基本骨格です。環の番号づけはこのアプリではまだ扱いません（オレンジの点線が環です）。' };
        }
        return { code: 'unsupported', ok: false, det: null,
            message: 'この官能基の系統名はこのアプリではまだ扱いません（画面の名前は名称ライブラリから引いています）。' };
    }

    /** トグル（分子モーダルの `🔢 主鎖と番号を見る` と、自由モードの帯の同名ボタンが共有する） */
    toggleIupacNumbering() {
        if (this.iupacNumbering) {
            this.setIupacNumbering(false);
            return;
        }
        // ★ 出せるかどうかは門番だけが決める。ここに「対応している形」の一覧を書かない
        const notice = this.iupacNumberingNotice();
        if (!notice.ok) {
            // 環は**言葉だけでは指せない**（「環」がどれか図の上で分からない）ので丸で名指しする。
            // 丸は「この原子が問題」の語彙（§3-1）＝ ここでは主鎖の帯ではなく丸が正しい
            if (notice.code === 'ring') {
                const byId = new Map(this.userMolecule.atoms.map(a => [a.id, a]));
                this.highlightAtoms((findAnyCycle(this.userMolecule) || []).map(id => byId.get(id)).filter(Boolean));
            }
            this.showToast(notice.message, 4000);
            return;
        }
        this.setIupacNumbering(true);
        this.showToast(notice.message, notice.code === 'chain' ? 3000 : 4000, 'success');
    }

    /** 2つの入口（帯・分子モーダル）の見た目を状態にそろえる */
    syncIupacNumberingButtons() {
        const on = !!this.iupacNumbering;
        ['btn-iupac-numbering', 'mm-btn-iupac-numbering'].forEach(id => {
            const b = document.getElementById(id);
            if (!b) return;
            b.textContent = on ? '🔢 主鎖と番号を消す' : '🔢 主鎖と番号を見る';
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.classList.toggle('active', on);
        });
    }

    /**
     * 主鎖の帯と番号をキャンバスへ描く（`updateDrawing` の最後）。
     * 図が変わっていたら、ここで自分から消える（§3「状態は残さない」）。
     */
    renderIupacNumbering(hidden, hydrogens) {
        if (!this.iupacNumbering) { this.renderIupacNameParts(null); return; }
        const off = () => {
            this.iupacNumbering = null; this.syncIupacNumberingButtons(); this.renderIupacNameParts(null);
        };
        if (this.iupacNumbering.sig !== this._iupacNumberingSignature()) return off();
        if (this._iupacNumberingBlockedByPractice()) return off();
        const det = this.iupacNumberingDetail();
        if (!det) return off();
        // 名称の説明（設計回 E）。**番号と同じ帯・同じ出入り**で、押されたかけらは図の上で光る
        this.renderIupacNameParts(det);
        this._iupacGlow(det, hidden);
        // 帯と光の上でも二重結合の2本線が読めるように、結合線を濃くする（C-2）。
        // ⚠ 糖は帯も光も敷かない（下の 'sugar' の枝）ので、濃くする理由も無い ＝
        //   図は**番号が増えるだけ**で、線の見え方は 🔢 を押す前と1ピクセルも変わらない
        if (det.kind !== 'sugar') this._iupacLiftBondInk(this.bondsGroup);

        const visible = (id) => !(hidden && hidden.has(id));
        const byId = new Map(this.userMolecule.atoms.map(a => [a.id, a]));
        const lines = [];
        if (det.kind === 'ether') {
            // エーテルは番号ではなく**両側のアルキル基を2色で塗り分ける**（§N-5）
            const COLORS = ['var(--neon-orange, #ffa502)', 'var(--neon-pink, #ff2a85)'];
            det.groups.forEach((g, i) => {
                const ids = new Set(g.ids);
                this.userMolecule.bonds.forEach(b => {
                    if (!ids.has(b.atomId1) || !ids.has(b.atomId2)) return;
                    if (!visible(b.atomId1) || !visible(b.atomId2)) return;
                    this._iupacBand(byId.get(b.atomId1), byId.get(b.atomId2), COLORS[i], this.bondsGroup);
                });
                // 炭素1個の基（メチル）は結合が無いので、帯の代わりに短い印を置く
                if (g.ids.length === 1 && visible(g.rootId)) {
                    const a = byId.get(g.rootId);
                    if (a) this._iupacBand({ x: a.x - 7, y: a.y }, { x: a.x + 7, y: a.y }, COLORS[i], this.bondsGroup);
                }
                const pts = g.ids.map(id => byId.get(id)).filter(a => a && visible(a.id));
                if (pts.length) {
                    const cx = pts.reduce((s, a) => s + a.x, 0) / pts.length;
                    const cy = pts.reduce((s, a) => s + a.y, 0) / pts.length;
                    this._iupacText(cx, cy - 26, g.name, COLORS[i], 11, this.atomsGroup);
                }
            });
            lines.push(`🔢 ${det.name}`);
            lines.push('エーテルは主鎖に番号をつけません。両側のアルキル基の名前で呼びます。');
        } else if (det.kind === 'sugar') {
            // ★ **帯は引かない**（ユーザー決定 2026-08-25）。ハース環に「主鎖」は無い ＝
            //   鎖に沿う色を出すと「この鎖から名前が出た」という嘘になる。出すのは番号だけ。
            //   ⚠ `_iupacLiftBondInk` も呼ばない（帯・光の下敷きが無いのだから濃くする理由が無い）
            det.labels.forEach((label, id) => {
                const a = byId.get(id);
                if (!a || !visible(id)) return;
                this._iupacSubscript(this._iupacAtomText(this.atomsGroup, a), label);
            });
            lines.push(`🔢 ${det.name}`);
            lines.push(det.note);
        } else {
            const chain = det.chain.map(id => byId.get(id)).filter(Boolean);
            // 帯（この道）。**番号順の隣どうし**だけを結ぶ ＝ 並べ替えない・逆にしない
            for (let k = 0; k + 1 < chain.length; k++) {
                if (!visible(chain[k].id) || !visible(chain[k + 1].id)) continue;
                this._iupacBand(chain[k], chain[k + 1], 'var(--neon-orange, #ffa502)', this.bondsGroup);
            }
            if (chain.length === 1 && visible(chain[0].id)) {
                this._iupacBand({ x: chain[0].x - 7, y: chain[0].y }, { x: chain[0].x + 7, y: chain[0].y },
                    'var(--neon-orange, #ffa502)', this.bondsGroup);
            }
            // 番号は**炭素の字そのものの添え字**（`C₁`）。番号 k の炭素 = chain[k-1]（添字そのまま）
            chain.forEach((a, i) => {
                if (!visible(a.id)) return;
                this._iupacSubscript(this._iupacAtomText(this.atomsGroup, a), i + 1);
            });
            // ★ N-6: **番号を生んだ名前を必ず同じ画面に出す。**
            //   `lookupCompoundName` は compounds.json を先に引くので、画面の名前は
            //   「イソブタン」のような慣用名になりうる。そのまま番号を描くと
            //   **画面に出ていない名前の番号**を見せることになる ＝ 系統名を主・慣用名を副
            if (det.kind === 'alkyl') {
                lines.push(det.systematic && det.systematic !== det.name
                    ? `🔢 ${det.name}（＝${det.systematic}）` : `🔢 ${det.name}`);
                lines.push('付け根（R）に付いた炭素が C1 です。');
            } else {
                lines.push(`🔢 ${det.name}`);
                const lib = this.lookupCompoundName(this.userMolecule);
                // ライブラリ名が系統名を**含んでいる**ときは添えない
                // （「2-メチル-1-プロパノール（イソブタノール）」——読み手には同じ名前が2回並ぶだけ）
                if (lib && lib !== det.name && lib.indexOf(det.name) < 0) lines.push(`（慣用名: ${lib}）`);
            }
        }
        lines.push('※ 番号の表示中は作図できません。');
        this._iupacCaption(lines, hidden, hydrogens);
    }

    /* ===== 名称の説明（DESIGN_iupac_check.md §3・§5。設計回 E1〜E3）=====
     *
     * ★ **名前を部品に割るだけ**で、面は増やさない（E1）。番号を出しているとき、その番号を
     *   生んだ名前は N-6 の規則で既に同じ画面に出ている。ここでやるのは、その名前を
     *   **押せるかけらに割り、押されたかけらに対応する原子を光らせる**ことだけ。
     *
     * ⚠ **かけらは `iupacNameDetail().nameParts` をそのまま出す。**説明のために名前を
     *   組み立て直さない —— 作れば「名前を作る場所が2つ」になり、片方だけ伸びた日に
     *   説明と名前が黙って食い違う（§N-1 と同じ家族の罠）。**IN10 が連結の一致を見張る。**
     * ⚠ **門番は N-4 のまま。**`iupacNameDetail` が null なら説明も出さない
     *   （`renderIupacNumbering` が det を取れなければ `renderIupacNameParts(null)` に落ちる）。
     *   ここに「対応している形」の一覧を新しく作らない。
     */

    /**
     * かけら1つに対応する原子ID（**`mainChain` と `locants`・`groups` からだけ**引く。IN11）。
     *
     * ⚠ 同じ炭素に**別々の置換基が2つ**付いている場合（1-クロロ-1-メチル…）、
     *   'sub' のかけらはその炭素に付く枝を**まとめて**光らせる。どの枝がどの名前かを
     *   ここで決めるには**アルキル基の命名をもう一度回す**ことになり、
     *   「名前を作る場所が2つ」の罠に自分から入る。位置番号までは正しく指せているので、
     *   その手前で止める（実測: ライブラリと標準6問の範囲では 1炭素2置換基は稀）。
     */
    iupacPartAtoms(det, part) {
        if (!det || !part) return [];
        const mol = this.userMolecule;
        const out = new Set();
        if (det.kind === 'ether') {
            if (part.role === 'ether-group') {
                (part.groups || []).forEach(i => (det.groups[i] ? det.groups[i].ids : []).forEach(id => out.add(id)));
            } else if (part.role === 'ether-suffix') {
                // エーテルの酸素＝ 炭素2個と単結合でつながる O（この分子に1個だけ。門番が保証している）
                mol.atoms.forEach(a => {
                    if (a.element !== 'O') return;
                    if (mol.getNeighbors(a.id).filter(n => n.atom.element === 'C').length === 2) out.add(a.id);
                });
            }
            return [...out];
        }
        const chain = det.chain || [];
        const at = (loc) => chain[loc - 1];
        const chainSet = new Set(chain);
        if (part.role === 'stem' || part.role === 'sat') { chain.forEach(id => out.add(id)); return [...out]; }
        if (part.role === 'sub') {
            (part.locs || []).forEach(loc => {
                const cid = at(loc);
                if (cid == null) return;
                out.add(cid);
                // その炭素から主鎖の外へ出る枝（ハロゲン1個の枝も同じ扱い）
                mol.getNeighbors(cid).forEach(n => {
                    const a = n.atom;
                    if (a.element === 'H' || chainSet.has(a.id) || a.element === 'O') return;
                    const st = [a.id], seen = new Set([a.id, cid]);
                    while (st.length) {
                        const x = st.pop();
                        out.add(x);
                        mol.getNeighbors(x).forEach(m2 => {
                            if (m2.atom.element === 'H' || chainSet.has(m2.atom.id) || seen.has(m2.atom.id)) return;
                            seen.add(m2.atom.id); st.push(m2.atom.id);
                        });
                    }
                });
            });
            return [...out];
        }
        const locs = part.locs || [];
        if (part.kind === 'ol') {
            locs.forEach(loc => {
                const cid = at(loc);
                if (cid == null) return;
                // 位置番号（`-1-`）は**その炭素**を指し、接尾辞（`ノール`）は**その -OH** を指す
                if (part.role === 'locant') out.add(cid);
                else mol.getNeighbors(cid).forEach(n => {
                    if (n.atom.element === 'O' && mol.getNeighbors(n.atom.id).filter(x => x.atom.element !== 'H').length === 1) out.add(n.atom.id);
                });
            });
            return [...out];
        }
        if (part.kind === 'ene' || part.kind === 'yne') {
            locs.forEach(loc => {
                // 多重結合は「loc 番と loc+1 番のあいだ」。位置番号は始点、接尾辞は両端
                if (at(loc) != null) out.add(at(loc));
                if (part.role !== 'locant' && at(loc + 1) != null) out.add(at(loc + 1));
            });
            return [...out];
        }
        return [...out];
    }

    /**
     * ★ 番号の「向き」の理由を1行で言う（設計回 E3）。
     * 生徒が間違えるのは「どちら端から数えるか」で、その理由は `_iupacNameForMainChain` が
     * **決めた直後に捨てていた**（実測 M15）。`dirReason` を返してもらって文にするだけ。
     * ⚠ **文はここが持つ**（chemistry.js は構造だけを返す）。
     */
    iupacDirectionReason(det) {
        if (!det || det.kind !== 'chain' || !det.dirReason) return '';
        const L = det.locants || {};
        const j = (arr) => (arr && arr.length ? arr.join('・') : '');
        switch (det.dirReason) {
            case 'ol': return `-OH が ${j(L.ol) || '1'} 番になる向きを選びました（-OH の番号がいちばん小さくなる向き）。`;
            case 'unsat': return `多重結合（C=C・C≡C）が早く来る向きを選びました（${j((L.ene || []).concat(L.yne || [])) || '—'} 番）。`;
            case 'ene': return '二重結合が早く来る向きを選びました。';
            case 'sub': return `置換基が早く来る向きを選びました（${j((L.subs || []).map(s => s.loc)) || '—'} 番）。`;
            case 'alpha': return '位置番号は両向きで同じだったので、名前の早い置換基が小さい番号になる向きを選びました。';
            case 'tie': return 'どちら向きでも同じでした（番号の付き方が変わらない形です）。';
            default: return '';
        }
    }

    /* ===== 幹の中の2色（発注書 C-1・2026-08-17 ユーザー判断）=====
     *
     * ユーザー申し立て:「エタンの切り方は エ｜タン の方が自然」。**切り方は変えない**
     * （`エ｜タ｜ノール` の3片になる／`1,3-ブタ｜ジエン` の「タ」は飽和の印ではない／
     *   語尾がタン・パン・サン・ナン・カンと一定でない ＝ 一般化しないと実測で確認済み）。
     * 代わりに**幹のボタンの中を2色に塗り分ける**。`nameParts` は1バイトも変わらないので
     * `IN10`（かけらを繋ぐと名前に戻る）は無傷で、アルコールもジエンも壊れない。
     *
     * ★ これで初めて画面に出るもの: **エタン / エテン / エチン の対比**。
     *   3つとも語尾のかけらは「ン」で字面が同じで、単／二重／三重を分けている
     *   **幹の最後の字（タ / テ / チ）** が幹の中に埋まって見えなくなっていた。
     */

    /**
     * 幹のかけらを「数詞（炭素数）｜段（結合の種類）」に割る。**割れなければ null**
     * ＝ 呼ぶ側は従来どおり1色で描く（黙って間違った位置で割るより、割らないほうがよい）。
     *
     * ⚠ **名前の文字列を切り直して境目を求めない。**数詞は `size`（主鎖の炭素数）から
     *   `IUPAC_NUMERAL` を引く ＝ 幹の表（`IUPAC_ALKANE_STEM` ほか）と同じ出どころ。
     *   文字数で機械的に割ると `ペンタ`（ペン+タ）と `プロパ`（プロ+パ）で境目が違うので必ず破綻する。
     * ⚠ **段の意味は「どの表から来た幹か」で決める**（字面から推し量らない）。
     *   `IUPAC_ENE_STEM` から来ていれば二重結合、`IUPAC_YNE_STEM` なら三重結合。
     *   アルカンの幹（`IUPAC_ALKANE_STEM`）でも、後ろに `ジエン`・`ジイン` が続くときは
     *   **飽和の印ではなく つなぎの母音**（buta-diene の a）なので `link` と言い分ける
     *   —— ここを「単結合」と説明したら**化学的に誤り**になる（ブタジエンに単結合の印は無い）。
     *
     * @returns null | { numeral, stage, kind:'sat'|'ene'|'yne'|'link', size }
     */
    iupacStemSplit(parts, i) {
        const p = parts && parts[i];
        if (!p || p.role !== 'stem') return null;
        if (typeof IUPAC_NUMERAL === 'undefined' || typeof IUPAC_ALKANE_STEM === 'undefined') return null;
        const n = p.size;
        const num = IUPAC_NUMERAL[n];
        // 数詞が前置きになっていない幹（将来 表を増やして数詞を書き忘れた等）は割らない
        if (!num || p.text.indexOf(num) !== 0 || p.text.length <= num.length) return null;
        let kind = null;
        if (IUPAC_ENE_STEM[n] === p.text) kind = 'ene';
        else if (IUPAC_YNE_STEM[n] === p.text) kind = 'yne';
        else if (IUPAC_ALKANE_STEM[n] === p.text || IUPAC_ALKANE_STEM[n] + 'ン' === p.text) {
            // ★ `1,3-ブタジエン` の「タ」＝ つなぎの母音（飽和の印ではない）
            const nx = parts[i + 1];
            kind = (nx && nx.role === 'suffix' && (nx.kind === 'ene' || nx.kind === 'yne')) ? 'link' : 'sat';
        }
        if (!kind) return null;
        return { numeral: num, stage: p.text.slice(num.length), kind, size: n };
    }

    /**
     * 同じ炭素数の「単／二重／三重」の親分子の名前と、その段の字。説明の中で対比を見せるためだけに使う。
     * ★ **分子の名前を作り直しているのではない**（作っているのは無置換の親アルカン・アルケン・
     *   アルキンの見本で、画面の名前は `nameParts` から出たものをそのまま使っている）。
     * 3つそろわない炭素数（C1・C11・C12 はアルケン／アルキンの幹が無い）では null。
     */
    _iupacStageTriple(n) {
        if (typeof IUPAC_NUMERAL === 'undefined') return null;
        const num = IUPAC_NUMERAL[n];
        const a = IUPAC_ALKANE_STEM[n], e = IUPAC_ENE_STEM[n], y = IUPAC_YNE_STEM[n];
        if (!num || !a || !e || !y) return null;
        const st = (s) => s.slice(num.length);
        return { names: [a + 'ン', e + 'ン', y + 'ン'], stages: [st(a), st(e), st(y)] };
    }

    /** かけらを押したときに出す1行（文は画面側が持つ）。`i` があれば隣のかけらも見る */
    _iupacPartNote(det, part, parts, i) {
        if (!part) return '';
        const j = (arr) => (arr && arr.length ? arr.join('・') : '');
        // 幹の分割（数詞｜段）と、同じ炭素数の単／二重／三重の対比
        const sp = (parts && i != null) ? this.iupacStemSplit(parts, i) : null;
        const prev = (parts && i != null) ? this.iupacStemSplit(parts, i - 1) : null;
        const tri = (t) => (t ? `（${t.names.join('・')}で ${t.stages.join('→')} と変わります）` : '');
        switch (part.role) {
            case 'sub': return `置換基「${part.label}」が ${j(part.locs)} 番の炭素に付いています。`;
            case 'stem': {
                if (!sp) return `主鎖の炭素が ${part.size} 個であることを表す幹です。`;
                const head = `「${sp.numeral}」＝ 主鎖の炭素が ${sp.size} 個。`;
                const t = this._iupacStageTriple(sp.size);
                if (sp.kind === 'link') {
                    // ★ ここを「単結合」と言ったら誤り。ブタジエンに単結合の印は無い
                    return `${head}「${sp.stage}」は次の接尾辞につなぐ母音で、結合の種類の印ではありません（二重・三重結合は接尾辞のほうが表しています）。`;
                }
                const mean = sp.kind === 'ene' ? '炭素間に二重結合 C=C がある'
                    : sp.kind === 'yne' ? '炭素間に三重結合 C≡C がある'
                    : '炭素間がすべて単結合である';
                return `${head}「${sp.stage}」＝ ${mean}ことを表す段です${tri(t)}。`;
            }
            case 'sat': {
                // ⚠ 旧文「「ン」＝ 炭素間はすべて単結合（アルカン）という印です」は**画面と食い違っていた**
                //   —— エタン・エテン・エチンは3つとも「ン」で終わる。分けているのは直前の段
                if (!prev) return '「ン」はアルカンの語尾です。単／二重／三重を分けているのは直前の幹の最後の字です。';
                const t = this._iupacStageTriple(prev.size);
                return t
                    ? `「ン」は語尾で、${t.names.join('・')}のどれにも付きます。単／二重／三重を分けているのは直前の「${prev.stage}」です。`
                    : `「ン」は語尾です。炭素間がすべて単結合であることは直前の「${prev.stage}」が表しています。`;
            }
            case 'locant':
                if (part.kind === 'ol') return `-OH が付いている炭素の番号です（${j(part.locs)} 番）。`;
                if (part.kind === 'yne') return `三重結合が始まる炭素の番号です（${j(part.locs)} 番）。`;
                return `二重結合が始まる炭素の番号です（${j(part.locs)} 番）。`;
            case 'suffix':
                // ⚠ 「」で引くのは**画面に出ている字**にする（`エタノール` に「オール」という
                //   並びは無く、かけらは「ノール」。同じ食い違いが「エン」で申し立てられた）
                if (part.kind === 'ol') return `「${part.text}」＝ -OH（ヒドロキシ基）を持つことを表す接尾辞です（-オール）。`;
                // ⚠ 単一の不飽和では、このかけらの字面は「ン」1字（「エン」「イン」という並びは
                //   画面に**存在しない**）。説明と字面をそろえる ＝ 二重／三重を示しているのは直前の段
                if (part.text === 'ン') {
                    const mean = part.kind === 'yne' ? '三重結合 C≡C' : '二重結合 C=C';
                    if (!prev) return `「ン」は語尾です。${mean} を示しているのは直前の幹の最後の字です。`;
                    const t = this._iupacStageTriple(prev.size);
                    return t
                        ? `「ン」は語尾で、${t.names.join('・')}のどれにも付きます。${mean} を示しているのは直前の「${prev.stage}」です。`
                        : `「ン」は語尾です。${mean} を示しているのは直前の「${prev.stage}」です。`;
                }
                if (part.kind === 'yne') return `「${part.text}」＝ 炭素間に三重結合 C≡C が ${(part.locs || []).length} 個 あることを表します。`;
                return `「${part.text}」＝ 炭素間に二重結合 C=C が ${(part.locs || []).length} 個 あることを表します。`;
            case 'ether-group': return (part.groups || []).length === 2
                ? `両側とも同じアルキル基「${part.label}」なので「ジ」が付きます。`
                : `エーテルの片側のアルキル基「${part.label}」です。`;
            case 'ether-suffix': return 'エーテルは主鎖に番号をつけません。両側のアルキル基の名前で呼びます。';
            default: return '';
        }
    }

    /**
     * 帯の「名前の部品」行を組む。`det` が null なら行ごと消す（＝ 門番 N-4 がそのまま効く）。
     */
    renderIupacNameParts(det) {
        const row = document.getElementById('iupac-parts-row');
        const box = document.getElementById('iupac-parts');
        const note = document.getElementById('iupac-parts-note');
        if (!row || !box || !note) return;
        const parts = det && det.parts;
        if (!parts || !parts.length) {
            row.classList.add('hidden');
            box.textContent = ''; note.textContent = '';
            return;
        }
        row.classList.remove('hidden');
        box.textContent = '';
        const sel = this.iupacNumbering ? this.iupacNumbering.part : null;
        parts.forEach((p, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'iupac-part';
            b.dataset.part = String(i);
            // ★ 幹だけは中を2色に塗り分ける（数詞＝炭素数／段＝結合の種類）。
            //   ⚠ **ボタンは1つのまま**（割ると `nameParts` と1対1でなくなり、
            //     押したときに何を光らせるかが壊れる）。割れない幹は従来どおり1色
            const sp = this.iupacStemSplit(parts, i);
            if (sp) {
                b.classList.add('iupac-part-stem');
                b.dataset.stage = sp.kind;
                const span = (cls, txt) => {
                    const s = document.createElement('span');
                    s.className = cls; s.textContent = txt;
                    return s;
                };
                b.appendChild(span('stem-num', sp.numeral));
                b.appendChild(span('stem-stage stem-stage-' + sp.kind, sp.stage));
            } else {
                b.textContent = p.text;
            }
            b.setAttribute('aria-pressed', sel === i ? 'true' : 'false');
            b.title = this._iupacPartNote(det, p, parts, i);
            b.addEventListener('click', () => {
                if (!this.iupacNumbering) return;
                // もう一度押したら消す（トグル）＝ 押しっぱなしで図が光り続けない
                this.iupacNumbering.part = (this.iupacNumbering.part === i) ? null : i;
                this.updateDrawing();
            });
            box.appendChild(b);
        });
        const dir = this.iupacDirectionReason(det);
        const pick = (sel != null && parts[sel]) ? this._iupacPartNote(det, parts[sel], parts, sel) : '';
        // 向きの理由は**常に見えている**（押していないときの既定の1行）。
        // かけらを押したらその説明を前に出し、位置番号のかけらでは向きの理由も一緒に見せる
        note.textContent = pick
            ? (parts[sel].role === 'locant' && dir ? `${pick} ${dir}` : pick)
            : (dir || (det.kind === 'ether' ? 'エーテルは主鎖に番号をつけません。' : ''));
    }

    /** 押されたかけらに対応する原子を光らせる（結合線の下に敷く。丸のハイライトとは別の語彙） */
    _iupacGlow(det, hidden) {
        const sel = this.iupacNumbering ? this.iupacNumbering.part : null;
        if (sel == null || !det.parts || !det.parts[sel]) return;
        const byId = new Map(this.userMolecule.atoms.map(a => [a.id, a]));
        this.iupacPartAtoms(det, det.parts[sel]).forEach(id => {
            if (hidden && hidden.has(id)) return;
            const a = byId.get(id);
            if (!a) return;
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', a.x); c.setAttribute('cy', a.y); c.setAttribute('r', '14');
            c.setAttribute('fill', 'var(--color-cyan, #00e8ff)');
            c.setAttribute('opacity', '0.30');
            c.setAttribute('pointer-events', 'none');
            c.setAttribute('class', 'iupac-part-glow');
            this.bondsGroup.insertBefore(c, this.bondsGroup.firstChild);
        });
    }

    /**
     * すでに描かれている**その原子の文字**（`<text class="svg-atom-text">`）を引き当てる。
     * キャンバスは `data-id` を持っているのでそれで引き、持たない図（クイズ・サムネイル。
     * `renderTargetAtom` は id を書かない）では**座標で引く**。
     * ⚠ 座標の照合は `renderAtom` / `renderTargetAtom` が使う基準線ぶん（重原子 +3.0）を含める。
     *   ずれたら「引けなかった」で静かに番号が消えるので、呼ぶ側は null を無視してよい。
     */
    _iupacAtomText(group, atom) {
        if (!group || !atom) return null;
        if (atom.id) {
            const byId = group.querySelector(`.svg-atom-node[data-id="${atom.id}"] text.svg-atom-text`);
            if (byId) return byId;
        }
        return [...group.querySelectorAll('text.svg-atom-text')].find(t =>
            Math.abs(parseFloat(t.getAttribute('x')) - atom.x) < 0.6 &&
            Math.abs(parseFloat(t.getAttribute('y')) - (atom.y + 3.0)) < 0.6) || null;
    }

    /**
     * 炭素番号を**その炭素の字の添え字**にする（`C₁`）。2026-08-15 のユーザー判断。
     *
     * **なぜ離れた場所に置くのをやめたか**: 以前は 10°刻み × 半径 16〜32px を掃いて
     * 「自動水素にも隣の炭素にも重ならない空き」を探していた（`_iupacOutward`・v1369）。
     * 重なりは消えたが、番号が炭素から **29〜35px**（結合長 42px の 7〜8割）離れ、
     * 直鎖では 1 が左上・2/3 が真下・4/5 が真上…と**散った**。
     * 添え字にすると「どの炭素の番号か」は**探索の出来ではなく構造で決まる** ——
     * 番号は必ずその炭素の丸の中にあり、外に置き場所を探す必要がそもそも無くなる。
     *
     * **やり方（3案のうち③）**: 丸は広げない・数字を縁にまたがせない。
     * `C` と数字を**1つの `<text>` に入れて中央揃え**にする ＝ ブラウザが `C` を左へ寄せ、
     * 「C₁」がひとまとまりの記号として真ん中に載る。書体が何であっても揃う。
     *
     * **2桁（デカンの C₁₀）**: そのままだと丸からはみ出す書体がある（Orbitron は幅広）。
     * 実測して `MAX_W` を超えたら、**添え字の字だけを小さくして**詰める（1桁は素のまま）。
     * ⚠ `textLength` で全体を横に潰す手も試したが、それだと **`C` まで一緒に細る** ——
     *   同じ図の中で番号の付いた炭素だけ字の形が変わって見える。実際に小さいのは添え字のほうだけ。
     * `MAX_W` の出どころ: 添え字の枠の下端は中心から約 6.1px 下（`3.0 + SUB_DY` ＋ 書体の下ばり）。
     * 丸の内側（半径 10 − 縁 1 ＝ 9）に角を収めるには半幅 √(9² − 6.1²) ≒ 6.6 —— 実測の
     * 余裕を見て **全幅 14.0px**（このとき四隅の最遠は 9.3px ＜ 丸の半径 10px。IN7 が見張る）。
     *
     * ⚠ 表示倍率「小」での読みやすさは**範囲外**（DESIGN_iupac_check.md §3-1 の追記）。
     */
    _iupacSubscript(atomText, n) {
        if (!atomText) return null;
        const NS = 'http://www.w3.org/2000/svg';
        const SUB_SIZE = 6, SUB_DY = 1.8, MAX_W = 14.0, MIN_SIZE = 4.2;
        // 2回呼ばれても増えないように、素の元素記号を取り直す（`C1` の `C` を拾う）
        const first = atomText.firstElementChild;
        const base = ((first ? first.textContent : atomText.textContent) || 'C').trim() || 'C';
        atomText.textContent = '';
        atomText.removeAttribute('textLength');
        atomText.removeAttribute('lengthAdjust');
        const sym = document.createElementNS(NS, 'tspan');
        sym.textContent = base;
        const sub = document.createElementNS(NS, 'tspan');
        sub.setAttribute('class', 'iupac-number');
        sub.setAttribute('dy', String(SUB_DY));
        sub.setAttribute('fill', 'var(--neon-orange, #ffa502)');
        sub.style.fontSize = SUB_SIZE + 'px';
        sub.textContent = String(n);
        atomText.appendChild(sym);
        atomText.appendChild(sub);
        // はみ出すぶんだけ**添え字の字を小さくして**詰める。
        // ⚠ 図が隠れていると測れない（0 が返る）ので、そのときは触らない
        //   —— 隠れた図の見た目は誰も見ておらず、次に開いたときに描き直される
        const measure = (el) => { try { return el.getComputedTextLength(); } catch (e) { return 0; } };
        const w = measure(atomText), ws = measure(sub);
        if (w > MAX_W && ws > 0) {
            // 減らしたい幅は全部添え字から出す（`C` は縮めない）
            const size = Math.max(MIN_SIZE, SUB_SIZE * (ws - (w - MAX_W)) / ws);
            sub.style.fontSize = size.toFixed(2) + 'px';
            // それでも収まらない書体のための最後の手当て（`C` ごと詰める）
            if (measure(atomText) > MAX_W) {
                atomText.setAttribute('textLength', String(MAX_W));
                atomText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            }
        }
        return sub;
    }

    /**
     * 主鎖の帯 1本（太い半透明の線）。**丸で囲まない**（§3-1）。
     * ⚠ 結合線の**下に敷く**（`firstChild` の前へ差し込む）。上に乗せると二重結合の2本線が
     * 帯に飲まれて、C=C がどこか読めなくなる（2-メチルプロペンで実際にそう見えた）
     */
    _iupacBand(p1, p2, color, target) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
        line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '11');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', '0.42');
        line.setAttribute('pointer-events', 'none');
        line.setAttribute('class', 'iupac-band');
        target.insertBefore(line, target.firstChild);
    }

    /**
     * ★ 帯・かけらの光を敷いたら、**その図の結合線を濃く描き直す**（C-2・ユーザー申し立て
     * 「名称のマーカー：C=C に重なるとどこが二重結合かわからなくなる」）。
     *
     * **何が起きていたか（実測。2-ブテンを呼び出して 🔢 を押した状態）**
     * 帯も光も結合線の**下**にあり、線そのものは隠れていない —— なのに読めなくなるのは、
     * 二重結合の *2本の線のあいだ* が塗りつぶされるから。帯は太さ 11px（±5.5）で、
     * 二重結合の2本線（±5・太さ 2.5）の**すきまをまるごと覆う**。すきまが地の色から
     * オレンジに変わると、2本線は「太い1本の帯」に見える。
     * 線（rgba(255,255,255,0.4)）と すきま のコントラスト比の実測:
     *
     * | 状態 | 比 |
     * |---|--:|
     * | 番号を出していない（地の色） | 3.78 |
     * | 帯だけ | 2.61 |
     * | かけらの光だけ（cyan 0.30） | 2.85 |
     * | 帯＋光（`ン` を押した状態） | **2.08** |
     *
     * **なぜこの直し方か**
     * - 帯は残す（DESIGN_iupac_check.md §3-1「主鎖は帯（線）で示す。丸は使わない」）。
     *   細める・薄めるでは足りない（薄さ 0.2 でも 3.52 までしか戻らず、帯のほうが読めなくなる）
     * - **光は円のままにしないといけない**（§3-0。輪にすると「この原子が問題」＝
     *   不斉・エラー箇所の丸と語彙がぶつかる）。帯だけをどうにかしても光の 2.85 が残る
     * - 線を濃くすれば、帯・光のどちらが下にあっても効く ＝ **1つの手当てで両方が直る**。
     *   物差しは「**番号を出していないときの読みやすさ（3.78）を下回らない**」。
     *   0.92 での実測は 帯 6.78 ／ 光 8.10 ／ 帯＋光 **4.28** で、いちばん悪い場合でも素の図より読める
     * - 幾何は 1px も動かさない ＝ `IN7`（番号が丸に収まる）・当たり判定・整形に触らない
     *
     * 対象は `svg-bond-ink`（重原子どうしの線）だけ。自動水素の線は帯の下に来ないので触らない。
     * 一時表示なので後始末は要らない —— 次の `updateDrawing` が線を作り直す。
     *
     * @returns 濃くした線の本数
     */
    _iupacLiftBondInk(group) {
        if (!group) return 0;
        const lines = group.querySelectorAll('line.svg-bond-ink');
        lines.forEach(l => {
            l.setAttribute('stroke', 'rgba(255,255,255,0.92)');
            l.classList.add('iupac-bond-lifted');
        });
        return lines.length;
    }

    /** 番号・基の名前の文字（原子の文字 9px より小さくして外周へ逃がす。§3-1） */
    _iupacText(x, y, s, color, size, target, cls) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x); t.setAttribute('y', y);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('fill', color);
        t.setAttribute('font-size', String(size));
        t.setAttribute('font-weight', '700');
        t.setAttribute('paint-order', 'stroke');
        t.setAttribute('stroke', 'rgba(7,9,12,0.9)');
        t.setAttribute('stroke-width', '3');
        t.setAttribute('pointer-events', 'none');
        if (cls) t.setAttribute('class', cls);
        t.textContent = s;
        target.appendChild(t);
        return t;
    }

    /**
     * 図の上に説明を積む（いちばん上が名前）。図の下は `🔍 名前` の見出しが使っている。
     * ⚠ 逃がす高さは **26px に戻した**（v1371）。v1369 で 36px に広げたのは、
     *   番号が原子から最大 32px 外へ逃げていたため（ヘキサンで字幕との隔たりが 13.3px）。
     *   番号が炭素の中の添え字になった今、番号は図の外へ出ない ＝ 元の 26px で足りる
     *   （実測: ヘキサンで 26.0px）。広げたままだと図と説明が理由なく離れる。
     */
    _iupacCaption(lines, hidden, hydrogens) {
        const pts = [
            ...this.userMolecule.atoms.filter(a => a.element !== 'H' && !(hidden && hidden.has(a.id))),
            ...(hydrogens || [])
        ];
        if (!pts.length || !lines.length) return;
        const cx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2;
        let y = Math.min(...pts.map(p => p.y)) - 26;
        for (let i = lines.length - 1; i >= 0; i--) {
            this._iupacText(cx, y, lines[i], i === 0 ? 'var(--neon-orange, #ffa502)' : 'var(--text-secondary, #b9c3d0)',
                i === 0 ? 12 : 10, this.atomsGroup);
            y -= (i === 0 ? 16 : 14);
        }
    }

    /**
     * アルキル基の練習（§4・場所3）の**呼び出し口**。
     * `renderMoleculeIntoSvg`（quiz.js）で描いたサムネイルに、付け根 C1 からの番号を重ねる。
     *
     * ⚠ **繋ぎ込みは learn.js の担当**（このレーンは learn.js を触らない）。
     *   ここは「同じ1回の計算から出た鎖を、同じ規則で描く」ところまでを用意しただけ。
     *   ★ 呼ぶ側は `iupacAlkylNameFromR` で名前を出しているはずなので、
     *     番号と名前は自動的に同じ計算から出る（N-6）。
     *
     * @param svgId  renderMoleculeIntoSvg に渡したのと同じ SVG の id
     * @param target 同じ target データ（同じ座標の分子をもう一度組み立てて、鎖を取り直す）
     * @returns 描けたら true（対応外・付け根なしは false）
     */
    drawAlkylNumberingIntoSvg(svgId, target) {
        const svg = document.getElementById(svgId);
        if (!svg || typeof iupacAlkylDetailFromR !== 'function') return false;
        const bonds = svg.querySelector('.quiz-bonds'), atoms = svg.querySelector('.quiz-atoms');
        if (!bonds || !atoms) return false;
        const mol = this.createTargetFromData({ target });
        const d = iupacAlkylDetailFromR(mol);
        if (!d || !d.mainChain || !d.mainChain.length) return false;
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        const chain = d.mainChain.map(id => byId.get(id)).filter(Boolean);
        for (let k = 0; k + 1 < chain.length; k++) {
            this._iupacBand(chain[k], chain[k + 1], 'var(--neon-orange, #ffa502)', bonds);
        }
        // 番号はキャンバスと同じ**炭素の字の添え字**（`C₁`）。
        // ⚠ **付け根の `R` には添え字を付けない。** `R` は鎖の一員ではなく「この先に何かが続く」
        //   という置き換え記号で、番号を持たない（字幕も「付け根（R）に付いた炭素が C1 です」と言う）。
        //   `R₀` のようなものを描くと、R が 0 番の炭素であるかのように読めてしまう
        chain.forEach((a, i) => this._iupacSubscript(this._iupacAtomText(atoms, a), i + 1));
        this._iupacLiftBondInk(bonds);   // 帯の上でも 2本線が読めるように（C-2）
        return true;
    }

    /**
     * ★ 答え合わせの表（DESIGN_practice_revision.md §8・F）の**呼び出し口**。
     * `renderMoleculeIntoSvg`（quiz.js）で描いたサムネイルに、キャンバスと**同じ**
     * 主鎖の帯と `C₁` の添え字を重ねる。`drawAlkylNumberingIntoSvg` の兄弟で、
     * ちがうのは「付け根 R がある基」ではなく**ふつうの分子**を見るところだけ。
     *
     * ★ **描き直さない**（§8-1 の指示）。帯（`_iupacBand`）・添え字（`_iupacSubscript`）・
     *   基の名前（`_iupacText`）・エーテルの2色（§N-5）はキャンバスと同じ道具をそのまま使う。
     *   ⚠ 数字の大きさも位置も `_iupacSubscript` が決める ＝ 図の大きさ（小/中/大）を変えても
     *     **番号は必ず炭素の丸の中**（IN7 と同じ物差し。サムネイルは viewBox が分子の座標系
     *     そのものなので、縮尺が変わっても user unit での関係は動かない）。
     *
     * ★ **門番は N-4 のまま**（`iupacNameDetail` が返したものだけを描く）。
     *   環・芳香族・カルボニルは null になり、**何も描かずに false を返す**
     *   ＝ 表の行に「出せません」の顔を出さない。
     *
     * @param svgId  renderMoleculeIntoSvg に渡したのと同じ SVG の id
     * @param target 同じ target データ（同じ座標の分子をもう一度組み立てて、鎖を取り直す）
     * @returns 描けたら true（対応外は false）
     */
    drawIupacNumberingIntoSvg(svgId, target) {
        const svg = document.getElementById(svgId);
        if (!svg || typeof iupacNameDetail !== 'function') return false;
        const bonds = svg.querySelector('.quiz-bonds'), atoms = svg.querySelector('.quiz-atoms');
        if (!bonds || !atoms) return false;
        const mol = this.createTargetFromData({ target });
        const d = iupacNameDetail(mol);
        if (!d) return false;
        const byId = new Map(mol.atoms.map(a => [a.id, a]));
        if (d.kind === 'ether') {
            // エーテルは番号ではなく**両側のアルキル基を2色で塗り分ける**（§N-5）。
            // C₄H₁₀O は7種のうち3種がエーテル ＝ ここで無言になると主力問題の半分弱で機能が消える
            if (!d.groups || d.groups.length !== 2) return false;
            const COLORS = ['var(--neon-orange, #ffa502)', 'var(--neon-pink, #ff2a85)'];
            d.groups.forEach((grp, i) => {
                const ids = new Set(grp.ids);
                mol.bonds.forEach(b => {
                    if (!ids.has(b.atomId1) || !ids.has(b.atomId2)) return;
                    this._iupacBand(byId.get(b.atomId1), byId.get(b.atomId2), COLORS[i], bonds);
                });
                // 炭素1個の基（メチル）は結合が無いので、帯の代わりに短い印を置く
                if (grp.ids.length === 1) {
                    const a = byId.get(grp.rootId);
                    if (a) this._iupacBand({ x: a.x - 7, y: a.y }, { x: a.x + 7, y: a.y }, COLORS[i], bonds);
                }
                const pts = grp.ids.map(id => byId.get(id)).filter(Boolean);
                if (pts.length) {
                    const cx = pts.reduce((s, a) => s + a.x, 0) / pts.length;
                    const cy = pts.reduce((s, a) => s + a.y, 0) / pts.length;
                    this._iupacText(cx, cy - 26, grp.name, COLORS[i], 11, atoms, 'iupac-group-name');
                }
            });
            this._iupacLiftBondInk(bonds);   // 帯の上でも 2本線が読めるように（C-2）
            return true;
        }
        if (d.kind !== 'chain' || !d.mainChain || !d.mainChain.length) return false;
        const chain = d.mainChain.map(id => byId.get(id)).filter(Boolean);
        for (let k = 0; k + 1 < chain.length; k++) {
            this._iupacBand(chain[k], chain[k + 1], 'var(--neon-orange, #ffa502)', bonds);
        }
        if (chain.length === 1) {
            this._iupacBand({ x: chain[0].x - 7, y: chain[0].y }, { x: chain[0].x + 7, y: chain[0].y },
                'var(--neon-orange, #ffa502)', bonds);
        }
        chain.forEach((a, i) => this._iupacSubscript(this._iupacAtomText(atoms, a), i + 1));
        this._iupacLiftBondInk(bonds);   // 帯の上でも 2本線が読めるように（C-2）
        return true;
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

    /**
     * 💡 ヒント（2026-08-13 ユーザー設計）。**お題がどんな仲間の化合物か**を出す。
     *
     * 段は「**ヒント（分類）→ お手本（答えの図）**」。お手本は答えそのものなので、
     * その手前に「名前は知らないが、分類が分かれば描ける」段を1つ置く。
     * 例: マレイン酸 →「炭素間の二重結合 C=C ×1 ／ カルボキシ基 -COOH ×2」。
     *
     * 中身は `describeStructure`（骨格・多重結合・官能基を短い日本語で返す表示専用の解析）。
     * ⚠ 判定には使わない関数なので、**ここでしか使わない**（正誤は正準コードの同型判定が持つ）。
     */
    showStageHint() {
        const stage = STAGES[this.currentStageIndex];
        const target = this.createTargetFromData(stage);
        const points = (typeof describeStructure === 'function' ? describeStructure(target) : []) || [];
        if (points.length) {
            this.showToast('ヒント: ' + points.join(' ／ '), 7000, 'success');
            return;
        }
        // 炭素をふくまない小さな分子（水など）は骨格も官能基も立たない。
        // 空のヒントを出すと「押しても何も出ない」に戻るので、原子の内訳で返す
        const count = {};
        target.atoms.filter(a => a.element !== 'H').forEach(a => { count[a.element] = (count[a.element] || 0) + 1; });
        const body = Object.entries(count).map(([el, n]) => `${el} ${n}個`).join(' ／ ');
        this.showToast('ヒント: 水素以外の原子は ' + (body || 'ありません'), 7000, 'success');
    }

    /**
     * **正解したら自動でクリアにする**（2026-08-13 ユーザー設計）。
     *
     * 名称チップが作りながら名前を出すので、「合っているか確かめる」ボタンは
     * **押す前から答えが分かっている儀式**になっていた（全117お題で名前が出ることを実測）。
     * ボタンは 💡 ヒントへ譲り、判定は編集のたびに自動で走らせる。
     *
     * ⚠ **重原子の数で先に足切りする。** `verifyMolecule` は正準コードの同型判定なので、
     * 描画のたびに毎回通すのは重い。数が違えば絶対に一致しないので、そこで弾く。
     * ⚠ **1つのお題で1回だけ**（`_autoClearedIndex`）。モーダルを閉じたあとに
     * もう一度描き変えるたび出てくると邪魔になる。
     * ⚠ 不斉炭素の判定オプションが ON のときは**マークも合ってから**クリアにする
     *   ——構造が合った瞬間に終わると、マークを付ける機会が消えるため。
     */
    maybeAutoClear() {
        if (this.currentMode !== 'puzzle') return;
        if (this._autoClearedIndex === this.currentStageIndex) return;
        const stage = STAGES[this.currentStageIndex];
        if (!stage) return;
        const mine = this.userMolecule.atoms.filter(a => a.element !== 'H');
        if (!mine.length) return;
        const target = this.createTargetFromData(stage);
        const theirs = target.atoms.filter(a => a.element !== 'H');
        if (mine.length !== theirs.length) return;          // 足切り（ほとんどはここで返る）
        if (!verifyMolecule(this.userMolecule, target)) return;
        if (this.judgeAsymmetric) {
            const wrong = this.userMolecule.atoms.filter(a => a.element === 'C')
                .some(a => this.userMolecule.isAsymmetricCarbon(a.id) !== a.isAsymmetricMarked);
            if (wrong) return;                              // マークがまだ ＝ 完成ではない
        }
        this._autoClearedIndex = this.currentStageIndex;
        // 描画の途中から勝利モーダルへ入らない（再入を避けて次のタスクへ回す）
        setTimeout(() => {
            this.showToast(this.judgeAsymmetric
                ? '正解です！構造および不斉炭素原子の位置が完全に一致しました！'
                : '正解です！分子構造が完全に一致しました！', 3000, 'success');
            this.markStageCleared(stage.name);
            slTrack('stage_clear', { app: 'assembler', stage: stage.name });
            this.showWinModal(stage);
        }, 0);
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

    /**
     * 🔍 **「全体表示」が合わせる先を、モードで決める**（v1402・FV1〜FV3）。
     *
     * ★ 実発生（ユーザー申し立て 2026-08-17）:「分子を呼び出して表示したとき、全体表示、で
     *   それらの分子が枠内に入らない」。統合レーンの実測（1920×1080・ステアリン酸8個＝160原子）:
     *
     *   | | 見えている | 見えていない |
     *   |---|---|---|
     *   | 呼び終えた直後 | 160 | 0 |
     *   | **「全体表示」を押した後** | **12** | **148** |
     *
     *   原因は `fitCanvasToTarget()` が**お題**（`STAGES[currentStageIndex]`）に合わせていたこと。
     *   🧪自由モードには**お題が無い**ので、お題の範囲が (400,300) の1点に潰れ、
     *   既定の視野 360×270 がそこへ飛ぶ ＝ **名前と逆のことをしている**。
     *
     * **モードごとの合わせ先**（ここが唯一の宣言場所）:
     *   ・🧩パズル … **お題**（`fitCanvasToTarget`）。お題を組み立てるのが目的の図なので、
     *                 描きかけが小さいうちに視野が動くほうが困る。**既存の振る舞いを1つも変えない**
     *   ・🧪自由   … **描いたもの全体**。ここがユーザーの申し立てそのもの
     *   ・📚学習   … **描いたもの全体**。キャンバスが答案用紙で、お題の図もその上に置かれる
     *                 （`learn.js` の `loadBase()` が既に `fitCanvasToMolecule(g.userMolecule)` で
     *                 答案全体に合わせている ＝ 学習の側はもともとこちらの流儀）。
     *                 学習でお題に合わせると、答案を増やすほど視野から外れていくことになる
     *
     * ⚠ 空のときは**お題を見に行かない**。自由・学習で空のキャンバスにパズルのお題の視野を
     *    当てると、次に描き始める場所が押した瞬間にずれる。空の分子に合わせれば
     *    `calculateTargetBounds` の既定（400,300 の1点）から 360×270 が出る ＝ 1点には潰れない。
     */
    fitCanvasToView() {
        if (this.currentMode === 'puzzle') {
            this.fitCanvasToTarget();
            return;
        }
        this.fitCanvasToMolecule(this.userMolecule || new Molecule());
    }

    /**
     * **キャンバスの上に貼ってある帯が、どれだけ内側を食っているか**を px で返す（2026-08-11）。
     *
     * `#work-strip`・`#summon-input`・リボンは `.canvas-overlay` などとして
     * **意図的にキャンバスへ重ねてある**（DESIGN_ribbon_consolidation.md §4-2）。
     * そのため「SVG の箱の真ん中」に分子を置くと、**端が帯の下へ入って押せなくなる**。
     * 監査の③画面サイズ検査がこれを 21件見つけた（携帯小・タブレットの二糖など）。
     *
     * 上下だけを見る。左右に貼る帯は無く、幅の狭い装飾（トーストなど）まで数えると
     * 視野が無駄に縮むため。**実際に重なっている帯だけ**を測る（hidden は自然に 0 になる）。
     */
    obstructedInsets() {
        const zero = { top: 0, right: 0, bottom: 0, left: 0 };
        if (!this.svg || !this.svg.getBoundingClientRect) return zero;
        const r = this.svg.getBoundingClientRect();
        if (!r.width || !r.height) return zero;
        const out = { top: 0, right: 0, bottom: 0, left: 0 };

        /**
         * ① **切り取られている分**。`#canvas-container` は `overflow:hidden` で、
         * SVG の箱（`viewBox` の 4:3 の固有比を持つ）がそこからはみ出すことがある
         * （style.css §「min-height:0 を外すと…」の実測どおり）。はみ出した側は
         * 描かれていても見えないし押せないので、**帯と同じ扱いで内側へ食わせる**。
         */
        const clip = this.svg.closest('#canvas-container') || this.svg.parentElement;
        if (clip && clip.getBoundingClientRect) {
            const c = clip.getBoundingClientRect();
            out.top = Math.max(out.top, c.top - r.top);
            out.left = Math.max(out.left, c.left - r.left);
            out.right = Math.max(out.right, r.right - c.right);
            out.bottom = Math.max(out.bottom, r.bottom - c.bottom);
        }

        /**
         * ② **キャンバスに重ねて置く帯**。`#work-strip`・`#summon-input`・リボンは
         * 意図してキャンバスへ重ねてある（DESIGN_ribbon_consolidation.md §4-2）ので、
         * その下に分子を置くと押せない。**ここが唯一の宣言場所**。
         * 幅（高さ）の半分以上をまたぐものだけを「床・天井・壁」として数える
         * ——トーストのような小さい浮きもので視野が縮むのを避けるため。
         */
        ['#work-strip', '#summon-input', '.canvas-header'].forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return; // 非表示
                const b = el.getBoundingClientRect();
                if (!b.width || !b.height) return;
                if (b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom) return;
                const spanX = Math.min(b.right, r.right) - Math.max(b.left, r.left);
                if (spanX < r.width * 0.5) return;
                if (b.top - r.top <= r.height * 0.5) out.top = Math.max(out.top, Math.min(b.bottom, r.bottom) - r.top);
                else out.bottom = Math.max(out.bottom, r.bottom - Math.max(b.top, r.top));
            });
        });

        // 食い過ぎると視野が発散するので、各軸あわせて 60% までに抑える
        for (const [a, b, size] of [['top', 'bottom', r.height], ['left', 'right', r.width]]) {
            const cap = size * 0.6;
            if (out[a] + out[b] > cap) {
                const k = cap / (out[a] + out[b]);
                out[a] *= k; out[b] *= k;
            }
        }
        for (const k of ['top', 'right', 'bottom', 'left']) out[k] = Math.max(0, out[k]);
        return out;
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

        /**
         * **帯の下へ分子を置かない**（2026-08-11）。
         * 空いている高さの割合ぶん視野を広げ、そのぶん中心を空いている側へ寄せる。
         * 広げるだけだと分子が小さくなるだけで帯の下から出ないし、
         * 寄せるだけだと今度は反対側の端がはみ出す。**両方いる。**
         */
        const rect = this.svg.getBoundingClientRect ? this.svg.getBoundingClientRect() : null;
        let vx = cx - viewW / 2;
        let vy = cy - viewH / 2;
        if (rect && rect.width > 0 && rect.height > 0) {
            const ins = this.obstructedInsets();
            const freeW = rect.width - ins.left - ins.right;
            const freeH = rect.height - ins.top - ins.bottom;
            if (freeW > 0 && freeH > 0 && (ins.top || ins.bottom || ins.left || ins.right)) {
                // 縦横で必要な倍率の大きいほうを採る（4:3 を保つため両軸に同じ倍率をかける）
                const ratio = Math.max(rect.width / freeW, rect.height / freeH);
                viewW *= ratio;
                viewH *= ratio;
                // 空いている領域の中心に、分子の中心が重なるように原点を決める
                vx = cx - viewW * ((ins.left + freeW / 2) / rect.width);
                vy = cy - viewH * ((ins.top + freeH / 2) / rect.height);
            }
        }

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
 * - `summon=<id または名称>` … 先に分子を呼び出す（`open=stereo` `open=isomer` は分子が要る）。
 *   **`open` が無くても効く**。id は compounds.json の不変 id（DEVELOPMENT.md §7-1）
 * - `formula=<分子式>` … `open=isomer` と組で「異性体の**書き出し**」を始める（例 `C4H10`）
 * - `reagent=<瓶id または反応ルールid>` … summon した分子に対し試薬を選んだ状態にする。
 *   **`open` が無くても効く**
 * - `id=<機構id>` … `open=mechanism` と組で、登録済み14件のうち1つを開く
 * - `scope=<basic|named|all>` / `field=<脂肪族 など>` … クイズの**出題範囲を絞る**
 *   （`open=quiz` `open=naming` と組。→ applyQuizScopeParams）
 *
 * ⚠ **知らない引数・知らない値は無視して普通に開く**（前方互換）。qa 側が新しい語彙を
 * 先に配っても、こちらが追いつくまでの間エラーで止まらないため。
 *
 * ⚠ **`?rec=` が付いているときは何もしない。** 収録の1手目を汚さないため（設計書 §6 Step 4）。
 */
const OPEN_TARGETS = {
    // モードだけ
    free: { mode: 'free' },
    puzzle: { mode: 'puzzle' },
    learn: { mode: 'learn' },
    // 📚 学習 → 🎓 クイズに挑戦（① 見比べる）
    // `scopeSel` / `fieldSel` … 出題範囲のつまみを持つクイズだけが名乗る（→ applyQuizScopeParams）
    quiz: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-quiz',
            scopeSel: 'quiz-scope', fieldSel: 'quiz-field' },
    naming: { mode: 'learn', acc: 'learn-acc-quiz', btn: 'btn-naming',
              scopeSel: 'naming-scope', fieldSel: 'naming-field' },
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

/* ===== アプリ横断の「来た道」（QB） =====
 *
 * CLAUDE.md:「アプリ横断のリンクは往復にする。両方向とも『来た道』を帯で示して戻れるようにする。
 * 片道だと辞書引きの流れがそこで途切れる」
 *
 * ⚠ **ここに持ってよいのは URL の形だけ**（ion-equation ⇄ ratio と同じ約束）。
 *    受け取った `code` が何を意味するかは**知らない**し、知ろうとしてはいけない。
 *    相手の項目表をこちらに複製すると、相手が項目を足した瞬間に黙って古くなる。
 *    こちらは受け取った文字列を**そのまま返す**だけで、
 *    **どこへ着地させるかは相手が決める**（`?code=` を受けた qa 側の仕事）。
 *
 * 逆向き（qa → こちら）で「何を見せるか」を決めているのも相手側で、
 * その対応表は `qa/data/assembler_links.jsonl` にある。こちらは `?summon=` 等の
 * **受け口の形だけ**を約束し、どの分子を指すかの判断は持たない。依存は両向きとも
 * 「自分のことだけ知っている」に保たれる。
 */
const CROSS_APP_FROM = {
    qa: { label: '一問一答', url: '../qa/' }
};

/* 帯を出す。戻り値はテスト用の要約（出さなかったときは null）。
 * `summoned` は summonMolecule の結果（分子を頼まれていないときは undefined）。 */
function renderFromBand(params, summoned) {
    const box = document.getElementById('from-band');
    if (!box) return null;
    const key = (params.get('from') || '').trim().toLowerCase();
    const app = CROSS_APP_FROM[key] || null;
    box.innerHTML = '';
    // 知らない相手からの `?from=` は**無視する**（未知パラメータは無視、の前方互換をここでも守る）。
    // 行き先を推測して作ると、綴りを間違えたリンクが死んだ戻り道を生む
    if (!app) { box.classList.add('hidden'); return null; }

    const code = (params.get('code') || '').trim();
    let back = app.url;
    if (code) back += '?code=' + encodeURIComponent(code) + '&from=assembler';

    // 分子を頼まれたのに出せなかった ＝ 黙って白紙にしない。
    // トーストは数秒で消えるが、帯は残るので「なぜ空なのか」が後からでも読める
    const miss = !!params.get('summon') && summoned === false;

    const where = document.createElement('span');
    where.className = 'fb-where' + (miss ? ' fb-miss' : '');
    where.textContent = miss
        ? `${app.label}から来ましたが、この分子はまだ収録されていません（キャンバスは空のままです）`
        : `${app.label}から来ました`;

    const link = document.createElement('a');
    link.className = 'fb-back';
    link.href = back;
    link.textContent = `← ${app.label}へ戻る`;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fb-close';
    close.title = 'この帯を閉じる';
    close.setAttribute('aria-label', 'この帯を閉じる');
    close.textContent = '✕';
    close.addEventListener('click', () => box.classList.add('hidden'));

    box.append(where, link, close);
    box.classList.remove('hidden');
    return { app: key, code, back, miss };
}

function applyOpenParam(search) {
    let params;
    try { params = new URLSearchParams(search); } catch (e) { return null; }
    if (params.get('rec')) return null; // 収録中は手を出さない
    const name = (params.get('open') || '').trim().toLowerCase();
    const target = OPEN_TARGETS[name] || null;

    // ⚠ **`open` が無くても、分子と試薬の指定だけは効かせる**（§7-1 の受け口①③）。
    // v801 までは `open` が無いと即 return していたので、`?summon=<名称>` 単独は
    // 何も起きなかった。qa（一問一答）が張りたいのは「分子を1つ出すだけ」が最多なので、
    // ここで止めると受け口の半分が使えない。**モードは 🧪自由**（描いた分子を触れる場所）
    if (!target && (params.get('summon') || params.get('reagent'))) window.game.setMode('free');
    if (target && target.mode) window.game.setMode(target.mode);

    // シリーズの指定（部分一致）。ハブの単元名とシリーズ名は綴りが完全には一致しないので、
    // 完全一致にすると単元名を1文字変えただけで黙って効かなくなる
    const series = params.get('series');
    if (series) {
        const sel = document.getElementById('select-series');
        const hit = sel ? [...sel.options].find(o => o.value.includes(series)) : null;
        if (hit) {
            sel.value = hit.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    // 分子の指定（open=stereo / open=isomer はキャンバスが空だと調べようがない）。
    // **`id` でも表示名でも主名でも別名でも引ける**（受け口① `?summon=<id>`。§7-1）
    const summon = params.get('summon');
    const summoned = summon ? window.game.summonMolecule(summon) : undefined;
    // 試薬・反応の指定（受け口③ `?reagent=`）。**分子を出した後**でなければ空振りする。
    // 瓶の id とルールの id を両方受ける（瓶を持たないルールが5件ある）
    const reagent = (params.get('reagent') || '').trim();
    if (reagent && window.reactor) window.reactor.selectReagent(reagent);

    // 受け口⑤ `?from=<アプリ>&code=<相手のコード>` … 来た道の帯（QB）。
    // ⚠ **`if (!target) return null` より前**に置く。qa から来る導線で最も多いのは
    //    `?open=` を持たない `?summon=` 単独なので、後ろに置くと**戻り道が出る場面が半分になる**。
    //    `?open=isomer&formula=` も下で早期 return するため、ここが唯一の共通点
    window.__fromBand = renderFromBand(params, summoned);

    if (!target) return null;

    // 受け口② `?open=isomer&formula=<式>` … 異性体の**書き出し**を分子式つきで開く。
    // ⚠ ここは id ではなく**分子式が正しい**。C₄H₁₀ が2種類あることを答えさせるのが課題なので、
    // 一意に決まらないほうが目的に合う。`formula` が無いときは従来どおり
    // 「いま描いている分子の異性体を調べる」（`btn-isomers`）＝ 前方互換
    const formula = (params.get('formula') || '').trim();
    if (name === 'isomer' && formula && window.isomerPractice) {
        window.game.setMode('learn');
        window.game.setStudyOpen(true);
        const acc = document.getElementById('learn-acc-practice');
        if (acc) acc.open = true;
        window.isomerPractice.startFromFormula(formula);
        return name;
    }

    if (target.acc) {
        // アコーディオン3つは **Study モーダルの中**（第3段）。開けておかないと、
        // 「?open=practice で着いたのに画面には何も起きていない」ように見える。
        // ⚠ ここで開けても、直後の `target.btn.click()` が別のモーダルを開けば
        // `setupStudyModal` の bubble 配線が拾って自動で閉じる ＝ 重ならない
        window.game.setStudyOpen(true);
        const acc = document.getElementById(target.acc);
        if (acc) acc.open = true;
    }
    if (target.btn) {
        const btn = document.getElementById(target.btn);
        if (btn) btn.click();
    }
    // ボタンが無い行き先（分子モーダルはキャンバスの見出しから開くので id 付きのボタンが無い）
    if (target.fn) target.fn();

    // 受け口④ `?open=mechanism&id=<機構id>` … 14件のうち1つを選んで開く。
    // `id` が無い・知らない id のときは従来どおり**箱を開けるだけ**（前方互換）
    if (name === 'mechanism') {
        const mid = (params.get('id') || '').trim();
        if (mid && window.reactionPlayer) window.reactionPlayer.openById(mid);
    }

    // 受け口⑥ `?scope=` / `?field=` … クイズの出題範囲を絞る。**ボタンを押した後**でなければ
    // つまみがまだ作られていない（`populateScopeSelect` は各クイズの `open()` の中で走る）
    window.__openFilters = applyQuizScopeParams(target, params);
    return name;
}

/* ===== 受け口⑥ クイズの出題範囲（2026-08-22・ユーザー申し立て） =====
 *
 * ユーザー原文:「**qa アルカンの命名を練習する → 命名クイズ分野を問わない に飛ばされる**」
 *
 * **実測（v1448）**: `?open=naming` で着地すると 出題範囲は「教科書（お題と定番）・306件」／
 * 分野は「**分野を問わない・1059件**」で、1問目に 1-ナフトール（芳香族）が出た。
 * 原因は **qa が渡していない**のではなく、**こちらに受け口が無かった**こと
 * （`applyOpenParam` が受けるのは series / summon / formula / reagent / id の5つだけで、
 * v1430 で人が触るつまみにした「出題範囲（レベル＋分野）」を外から指す口が無い）。
 * ＝ qa 側でいくら語彙を足しても届かない。だからこちらに口を開ける。
 *
 * ⚠ **押すのは既存のつまみ**（`#naming-scope` / `#naming-field` など）。
 * 新しい絞り込みの規則をここに書かない —— 書くと同じ規則が2箇所に散り、
 * `entryInQuizScope` を直したときに黙ってずれる。
 *
 * ⚠ **知らない値は無視する**（前方互換。`<option>` に無い値は入れない）。
 * qa が新しい分野名を先に配っても、ここが追いつくまでの間つまみが空になったりしない。
 *
 * ⚠ **値を2つとも入れてから change を1回だけ投げる。** `computePool()` は
 * scope と field を両方読むので、片方ずつ投げると**中間状態で1問出題してしまう**
 * （＝押した人には「絞る前の問題が一瞬出る」ように見える）。
 *
 * @returns 実際に効かせたもの（テスト QF1〜QF3 の物差し）。何も効かなければ null
 */
function applyQuizScopeParams(target, params) {
    if (!target) return null;
    const want = [
        { sel: target.scopeSel, key: 'scope' },
        { sel: target.fieldSel, key: 'field' }
    ];
    let last = null;
    const done = {};
    want.forEach(w => {
        const value = (params.get(w.key) || '').trim();
        if (!w.sel || !value) return;
        const el = document.getElementById(w.sel);
        if (!el) return;
        // 知らない値は捨てる（前方互換）。`<option>` の value と完全一致だけを採る
        if (![...el.options].some(o => o.value === value)) return;
        el.value = value;
        done[w.key] = value;
        last = el;
    });
    if (!last) return null;
    last.dispatchEvent(new Event('change', { bubbles: true }));
    return done;
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

        // クイズの出題範囲「教科書レベル」の追加名簿（2026-08-20）。
        // **compounds.json に列を足さずに済ませるための別ファイル**（1行1件・追記のみ）。
        // 「高校で扱うか」は構造からは決まらない（実測: 導出で判定できたのは 1059 件中 275 件だけ）
        // ので、導出で拾えない定番だけをここに名前で置く。無くてもアプリは動作する
        try {
            const scopeUrl = new URL('quiz-scope.json', window.location.href).href;
            const scopeRes = await fetch(scopeUrl, { cache: 'no-cache' });
            if (scopeRes.ok) QUIZ_SCOPE = await scopeRes.json();
        } catch (e) {
            console.warn('quiz-scope.json のロードに失敗（出題範囲はお題のみで動作）:', e);
        }
        window.QUIZ_SCOPE = QUIZ_SCOPE;
        // 定数・純関数の公開（テストが同じ定義を参照できるようにする。const は window に載らない）
        window.GRID_SIZE = GRID_SIZE;
        window.MIN_COMPONENT_CLEARANCE = MIN_COMPONENT_CLEARANCE;
        window.CANVAS_LIMIT = CANVAS_LIMIT;
        window.SUMMON_ROW_WIDTH = SUMMON_ROW_WIDTH;
        // 反応で選べる分子の上限（PM5 が「重合で並べる数がここを超えていない」ことを見る）
        window.MAX_REACTION_SELECTION = MAX_REACTION_SELECTION;
        // 名称呼び出しの「見えた」の床（L9 がアプリと**同じ定義**で測るために出す）
        window.SUMMON_MIN_BOND_PX = SUMMON_MIN_BOND_PX;
        window.ATOM_TAP_RADIUS = ATOM_TAP_RADIUS;
        // 当たり判定のつまみ（否定対照 HA1〜HA4 が一時的に差し替えて「外すと赤くなる」ことを示す）
        window.HIT_AREAS = HIT_AREAS;
        // 絶対グリッドへの丸め（否定対照 GR3 が legacyGridRound 経由で旧式に戻す）
        window.snapToGrid = snapToGrid;
        window.moleculeMark = moleculeMark;
        // 「1分子しかないとき」の次の一手（v1409）。トーストと分子モーダルの2か所が読む文言を
        // **1つの定数**にしてあるので、RX34 はその定数そのものが両方に出ているかを見る
        window.REACTION_SELECT_LONELY_HINT = REACTION_SELECT_LONELY_HINT;
        // 🎲 ランダム出題の断り文・一巡の知らせ（v1417）。**トーストとボタンの下の1行が同じ定数を読む**
        // ので、RD2 はその定数そのものが両方に出ているかを見る
        window.RANDOM_TOO_FEW_MSG = RANDOM_TOO_FEW_MSG;
        window.RANDOM_WRAPPED_MSG = RANDOM_WRAPPED_MSG;
        window.LABEL_CHIP_HEIGHT = LABEL_CHIP_HEIGHT;
        window.LABEL_DRIFT_PENALTY = LABEL_DRIFT_PENALTY;
        window.LABEL_DRIFT_MAX_ROWS = LABEL_DRIFT_MAX_ROWS;
        // 見出しの重なり判定（テストと監査が**同じ定義**で数えられるように出す。
        // 別の式で数えると「アプリは避けたつもり・テストは別の物差し」で緑が空振りする）
        window.rectsOverlap = rectsOverlap;
        window.circleHitsRect = circleHitsRect;
        window.segmentHitsRect = segmentHitsRect;
        // 「結合線が別の重原子の下をくぐる」の判定（唯一の実装）。
        // 手描きの配置・整形モード・夜間監査が**同じ物差し**で数えるために出す
        window.pointSegmentDistance = pointSegmentDistance;
        window.atomUnderBondLine = atomUnderBondLine;
        window.BOND_ATOM_CLEARANCE = BOND_ATOM_CLEARANCE;
        // 「結合線が自動水素の下をくぐる」の判定（§10-7 の決着・v1240）。**しきい値は別**
        window.hydrogenUnderBondLine = hydrogenUnderBondLine;
        window.countHydrogenCrossings = countHydrogenCrossings;
        window.HYDROGEN_BOND_CLEARANCE = HYDROGEN_BOND_CLEARANCE;

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
        window.dlExplain = new DLExplain(window.game); // 「D体・L体の決め方」の説明（発注書 F-2）

        // 立体対照ビュー（P7-5-M1）
        window.stereoView = new StereoView(window.game);

        // 名称呼び出しUI（P9-1 M1）: ライブラリ確定後に候補を構築
        window.game.setupSummonUI();

        // 反応実行エンジン（P9-1 M2）
        window.reactor = new Reactor(window.game);
        // 絞り込みモード（DESIGN_narrowing_mode.md）。
        // renderMoleculeIntoSvg（quiz.js）と layoutMolecule を借りるので、クイズ群より後に置く。
        // ⚠ **ここで例外が飛んでも後ろの初期化を止めない。** 起動列の途中なので、
        //    絞り込みモードの不具合でアプリ全体が立ち上がらなくなるのが最悪の壊れ方
        //    （M5 のパネルを足したとき、要素が1つ欠けただけで実際にそうなった）
        try {
            window.narrowing = new NarrowingMode(window.game);
        } catch (e) {
            console.error('絞り込みモードの初期化に失敗（他の機能は動きます）:', e);
        }
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
        // 横断の戻り道（QB）。テストが「相手の URL の形」を知る唯一の口
        window.CROSS_APP_FROM = CROSS_APP_FROM;
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
